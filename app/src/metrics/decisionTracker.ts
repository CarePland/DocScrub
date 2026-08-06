/**
 * decisionTracker.ts -- the DECISION TRACKER's figures (AG, 2026-08-03,
 * third revision: "user-interaction-forward").
 *
 *     Decision Tracker
 *     12        436        97%
 *     Made    Avoided     Fewer
 *
 * WHAT CHANGED, AND WHY IT IS A DIFFERENT MODEL. Earlier passes counted
 * `Made` as decision UNITS resolved -- a bulk action over nine items
 * advanced it by nine. Andrew's revision makes it what the reviewer
 * actually did: "I selected 'treat all this way'" is ONE decision, even
 * across nine items. Avoided then becomes what he described -- "the total
 * decisions NOT made, including the eight additional items I didn't have
 * to manually go through."
 *
 *     Made    = human decisions actually made
 *     Avoided = covered occurrences - Made
 *     Fewer   = Avoided / covered occurrences
 *
 * `Made + Avoided = covered occurrences` still holds exactly, so the panel
 * remains internally consistent: every occurrence in the completed work is
 * either something the reviewer decided, or something they didn't have to.
 *
 * THE CONSEQUENCE, ACCEPTED DELIBERATELY. Because Made falls when the
 * reviewer works by category, Avoided RISES when they do. Earlier passes
 * treated that as a hazard (a metric that rewards coarser review). Andrew's
 * position, which resolves it: DocScrub proposes the category actions, using
 * them IS the designed path, there is no leaderboard, and a degenerate
 * select-all is unreachable anyway because the product requires a degree of
 * review. So there is no "ceiling" figure any more -- see
 * workspaceMetrics.ts, where the unit-based number is now correctly labeled
 * a FLOOR ("at least this many, more if you work by category").
 *
 * ================= WHAT COUNTS AS ONE HUMAN DECISION ==================
 *
 * NOT simply "an event in the log," and this is the part that has to be
 * right -- an earlier build let Made increment when the reviewer merely
 * CHANGED THEIR MIND about an item they had already decided, which Andrew
 * correctly called a defect that should never have shipped. A tracker that
 * climbs when no new work happened is a click counter in the bad sense.
 *
 * The rule: **a decision counts when it newly resolved at least one
 * candidate that is still resolved now.** Walking the event log in order
 * against the CURRENT resolved set gives three properties for free:
 *
 *   - Re-deciding an item resolves nothing new       -> does not count.
 *   - `confirmGroup` over a group where three members were already decided
 *     counts ONCE for the six it newly resolved, and never again for the
 *     three it overwrote.
 *   - A decision later reversed drops out of the current resolved set, so
 *     its gesture leaves Made too, and the identity above survives.
 *
 * Made is therefore derived from history but describes the PRESENT: it is
 * "the gestures that produced the resolved set you have right now."
 *
 * NO NEW PERSISTENCE. The event log is the existing audit trail and
 * already survives save/resume, so the tracker restores exactly on reopen
 * without storing a counter anywhere -- the same property workspaceMetrics
 * relies on.
 */

import type { ReviewEvent, ReviewSession } from "../domain/ReviewSession.js";
import { decisionReduction, type ReviewUnit } from "./decisionReduction.js";

/**
 * Payload flags marking a `candidate-decided` event as part of a BATCH --
 * one reviewer gesture, many per-candidate events. Mirrors the vocabulary
 * `applyDecisionBatch` stamps (engines/review/session.ts) and that
 * workspaceMetrics.ts's own activity tally already reads.
 *
 * `source: "imported"` is included for a reason worth stating: decision
 * reuse writes `source: "imported"` rather than a `via*` flag, so a purely
 * `via*`-based test would count an import of 100 prior decisions as 100
 * separate human decisions. It is one gesture -- the reviewer chose to
 * import -- anchored by the `decisions-imported` event.
 */
const BATCH_FLAGS = ["viaBulkApply", "viaGroupConfirm", "viaGroupRedact", "viaGroupIgnore", "viaGroupFlatten"] as const;

/** The summary events `applyDecisionBatch` callers append AFTER their run
 *  of per-candidate events -- one per reviewer gesture. */
const BATCH_ANCHOR_EVENTS = new Set<string>(["bulk-decided", "group-decided", "decisions-imported"]);

function isBatchMember(payload: Record<string, unknown>): boolean {
  if (payload["source"] === "imported") return true;
  return BATCH_FLAGS.some((flag) => payload[flag] === true);
}

function candidateIdOf(event: ReviewEvent): string | null {
  const id = (event.payload as Record<string, unknown>)["candidateId"];
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * How many human decisions produced `currentlyResolvedIds`.
 *
 * `currentlyResolvedIds` is the set of candidates resolved RIGHT NOW (see
 * engines/review/coverage.ts's `partitionCandidatesByResolution`), not a
 * historical reconstruction -- that is what makes reversals and overwrites
 * fall out correctly rather than needing special cases.
 *
 * Exported separately from `decisionTrackerFigures` so the suite can pin
 * the counting rule on its own, independently of any occurrence
 * arithmetic.
 */
export function decisionsMade(session: ReviewSession | null | undefined, currentlyResolvedIds: ReadonlySet<string>): number {
  if (!session) return 0;

  const credited = new Set<string>();
  let made = 0;

  /** One gesture: counts only if it newly resolved something that is still
   *  resolved. */
  const creditGesture = (candidateIds: readonly string[]): void => {
    let isNew = false;
    for (const id of candidateIds) {
      if (!currentlyResolvedIds.has(id) || credited.has(id)) continue;
      credited.add(id);
      isNew = true;
    }
    if (isNew) made += 1;
  };

  // Per-candidate events belonging to a batch arrive BEFORE their anchor
  // event (applyDecisionBatch appends them, then its caller appends the
  // summary), so they buffer here until the anchor closes the gesture.
  let pendingBatchIds: string[] = [];

  for (const event of session.events) {
    switch (event.kind) {
      case "candidate-decided": {
        const candidateId = candidateIdOf(event);
        if (!candidateId) break;
        if (isBatchMember(event.payload as Record<string, unknown>)) pendingBatchIds.push(candidateId);
        else creditGesture([candidateId]); // an individual decision is its own gesture
        break;
      }
      // Not Quite applies a member decision WITHOUT a candidate-decided
      // event -- this event is that decision, and each one is its own
      // deliberate per-member gesture (which is the entire point of the
      // Not Quite panel).
      case "not-quite-member-applied": {
        const candidateId = candidateIdOf(event);
        if (candidateId) creditGesture([candidateId]);
        break;
      }
      default: {
        if (BATCH_ANCHOR_EVENTS.has(event.kind)) {
          creditGesture(pendingBatchIds);
          pendingBatchIds = [];
        }
        break;
      }
    }
  }
  // Defensive: a batch whose anchor event never arrived is still one
  // gesture. Cannot happen through the current command set; costs one line.
  creditGesture(pendingBatchIds);

  return made;
}

// ===========================================================================
// TIME SAVED -- the one ESTIMATE in an otherwise exact panel
// ===========================================================================

/**
 * TIME SAVED (AG, 2026-08-03). The fourth tracker figure, and the only one
 * that is a model rather than a count. Everything about its construction is
 * chosen to make it UNDERSTATE, because a number that invites an argument
 * would spread doubt to the three exact figures beside it.
 *
 * WHAT IT MULTIPLIES -- and this is the decision that matters most:
 *
 *     time saved  =  decision UNITS avoided  x  observed individual rate
 *
 * NOT occurrences avoided. Pricing all ~2,300 avoided occurrences at the
 * reviewer's per-decision rate produces "3 weeks" from an afternoon, because
 * repeated occurrences are cheap precisely BECAUSE they repeat -- the 30th
 * sighting of a name costs a fraction of the first, and that recognition
 * effect is the same phenomenon that produces the reduction in the first
 * place. Multiplying the cheapest work in the document at full price is
 * worst exactly where the number would look most impressive.
 *
 * Units are roughly 15x smaller than occurrences on a repetitive document.
 * The unit-based figure silently concedes ALL of the discovery savings --
 * the genuinely large cost DocScrub removes, which never enters the
 * measured rate because the reviewer is handed items already found. So this
 * is knowingly low. That is the intended direction of error.
 *
 * THE RATE IS MEASURED, NOT ASSUMED, and only from gaps between consecutive
 * INDIVIDUAL per-item decisions -- the one act genuinely observed. Bulk and
 * group gestures are excluded from the rate entirely: one keystroke over
 * forty items says nothing about how long one decision takes.
 *
 * THE PACE IS A MEDIAN, NOT A MEAN, and that is the main defence against
 * distraction. Decision times are a tight cluster of a few seconds with a
 * long right tail -- a reviewer glancing at their inbox for ninety seconds
 * produces a "decision" that a mean counts at full weight, and with a
 * small sample two of those can double the figure. A median barely moves.
 * Using the mean here was the single largest way this estimate could have
 * silently overstated itself.
 *
 * Gaps longer than IDLE_CEILING_SECONDS are still DISCARDED (not capped --
 * capping would drag any average toward the ceiling), but the ceiling is
 * now a coarse "they walked away" filter rather than the sole outlier
 * defence. That is also why it stays at two minutes rather than being
 * tightened further: with the median doing the real work, a tighter cut
 * would start discarding genuinely slow-but-real decisions, which biases
 * the figure by throwing away signal instead of by choosing a robust
 * statistic. One principled conservative choice beats two arbitrary ones.
 *
 * WALL-CLOCK UNITS, not working days. A day is 24h and a week is 7 days.
 * Working days (8h) and working weeks (40h) would be more evocative and
 * roughly TRIPLE the figure -- which is why they are not used here.
 *
 * Returns null (the panel shows nothing) when there is no honest basis:
 * fewer than MINIMUM_RATE_SAMPLES observed individual decisions, or nothing
 * avoided yet. A blank is better than a fabricated first number.
 */
const IDLE_CEILING_SECONDS = 120;
const MINIMUM_RATE_SAMPLES = 3;

export type TimeSavedUnit = "minutes" | "hours" | "days" | "weeks" | "years";

interface LadderStep {
  unit: TimeSavedUnit;
  label: string;
  seconds: number;
  /** Promote to the next unit at or above this many of the current unit. */
  max: number;
}

/** Ordered smallest-first. Iterating and taking the first step whose
 *  ROUNDED value is still below its own ceiling handles promotion for
 *  free: 3,599s renders "1.0 Hrs", never "60.0 Min". */
const TIME_LADDER: readonly LadderStep[] = [
  { unit: "minutes", label: "minutes of work avoided", seconds: 60, max: 60 },
  { unit: "hours", label: "hours of work avoided", seconds: 3600, max: 24 },
  { unit: "days", label: "days of work avoided", seconds: 86400, max: 7 },
  { unit: "weeks", label: "weeks of work avoided", seconds: 604800, max: 52 },
  { unit: "years", label: "years of work avoided", seconds: 31536000, max: Number.POSITIVE_INFINITY },
];

export interface TimeSavedEstimate {
  /** Decision units disposed of without an individual decision. */
  unitsAvoided: number;
  /** Observed seconds per individual decision, and how many inter-decision
   *  gaps that average came from -- exposed so the figure can be audited
   *  rather than taken on faith. */
  perDecisionSeconds: number;
  sampleCount: number;
  totalSeconds: number;
  /** One decimal, in `unit`. */
  value: number;
  unit: TimeSavedUnit;
  /** The phrase rendered beside the number, e.g. "days of work avoided".
   *  "Avoided" rather than "saved" on purpose: it names work that did not
   *  have to happen, which is what was measured, instead of claiming a
   *  benefit that was banked. */
  label: string;
  /** The number as rendered: one decimal, e.g. "3.4". */
  display: string;
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

/**
 * The observed pace of INDIVIDUAL per-item decisions: MEDIAN seconds per
 * decision, and the number of usable inter-decision gaps it was taken
 * over. Null when fewer than MINIMUM_RATE_SAMPLES usable gaps exist.
 *
 * Exported so the suite can pin the rate rule on its own, and so a future
 * surface can show "measured over N decisions" if the figure is ever
 * questioned.
 */
export function individualDecisionRate(session: ReviewSession | null | undefined): { seconds: number; samples: number } | null {
  if (!session) return null;
  const stamps: number[] = [];
  for (const event of session.events) {
    const isIndividual =
      (event.kind === "candidate-decided" && !isBatchMember(event.payload as Record<string, unknown>)) ||
      event.kind === "not-quite-member-applied";
    if (!isIndividual) continue;
    const at = Date.parse(event.at);
    if (Number.isFinite(at)) stamps.push(at);
  }
  const gaps: number[] = [];
  for (let i = 1; i < stamps.length; i += 1) {
    const gap = (stamps[i]! - stamps[i - 1]!) / 1000;
    // Discarded, not capped -- see this section's header.
    if (gap > 0 && gap <= IDLE_CEILING_SECONDS) gaps.push(gap);
  }
  if (gaps.length < MINIMUM_RATE_SAMPLES) return null;
  gaps.sort((a, b) => a - b);
  const middle = gaps.length >> 1;
  // Even counts take the mean of the two central values -- the ordinary
  // median convention. Both are real observations, so this cannot invent a
  // pace outside the observed range.
  const seconds = gaps.length % 2 === 1 ? gaps[middle]! : (gaps[middle - 1]! + gaps[middle]!) / 2;
  return { seconds, samples: gaps.length };
}

export function estimateTimeSaved(
  session: ReviewSession | null | undefined,
  resolvedUnitCount: number,
  decisionsMadeCount: number
): TimeSavedEstimate | null {
  const unitsAvoided = Math.max(0, resolvedUnitCount - decisionsMadeCount);
  if (unitsAvoided === 0) return null;
  const rate = individualDecisionRate(session);
  if (!rate) return null;

  const totalSeconds = unitsAvoided * rate.seconds;
  const base = { unitsAvoided, perDecisionSeconds: rate.seconds, sampleCount: rate.samples, totalSeconds };
  for (const step of TIME_LADDER) {
    const value = round1(totalSeconds / step.seconds);
    // Taking the first step whose ROUNDED value is still under its own
    // ceiling is what promotes 3,599s to "1.0 hours" instead of leaving it
    // as the nonsensical "60.0 minutes".
    if (value < step.max) return { ...base, value, unit: step.unit, label: step.label, display: value.toFixed(1) };
  }
  // Unreachable (the last step's ceiling is Infinity), but keeps the
  // function total rather than trusting the ladder's final entry by
  // position.
  const years = round1(totalSeconds / 31536000);
  return { ...base, value: years, unit: "years", label: "years of work avoided", display: years.toFixed(1) };
}

export interface DecisionTrackerFigures {
  /** Human decisions that produced the current resolved set. */
  decisionsMade: number;
  /** Occurrence-level reviews the reviewer did NOT have to perform:
   *  `coveredOccurrenceCount - decisionsMade`, floored at 0. */
  avoidedDecisionCount: number;
  /** Occurrences covered by the resolved units -- the occurrence-by-
   *  occurrence reviews the completed work would otherwise have required.
   *  Equals `decisionsMade + avoidedDecisionCount` by construction. */
  coveredOccurrenceCount: number;
  /** avoidedDecisionCount / coveredOccurrenceCount as a percentage,
   *  0-100, UNROUNDED -- rounded once at the display by
   *  decisionReduction.ts's `formatFewerDecisionsPercent`. See that
   *  field's own note there for the double-rounding bug this avoids. */
  fewerDecisionPercent: number;
  /** The one modeled figure -- null until there is an honest basis for it.
   *  See the TIME SAVED section header. */
  timeSaved: TimeSavedEstimate | null;
}

export const EMPTY_DECISION_TRACKER: DecisionTrackerFigures = {
  decisionsMade: 0,
  avoidedDecisionCount: 0,
  coveredOccurrenceCount: 0,
  fewerDecisionPercent: 0,
  timeSaved: null,
};

/**
 * The three panel figures, composed from the two halves that own them:
 * occurrence coverage from the shared `decisionReduction` calculation
 * (unchanged, and still what every LOCAL equation uses), and human effort
 * from the event log above. This module adds one subtraction and one
 * division; it re-implements neither half.
 *
 * `resolvedUnits` is the reviewer's completed work -- the resolved side of
 * `partitionCandidatesByResolution`. Passing units rather than a whole
 * WorkspaceState keeps this testable in isolation and keeps the scope
 * contract identical to the rest of the metric family.
 */
export function decisionTrackerFigures(
  session: ReviewSession | null | undefined,
  resolvedUnits: readonly ReviewUnit[] | null | undefined
): DecisionTrackerFigures {
  const units = resolvedUnits ?? [];
  const coverage = decisionReduction(units);
  const made = decisionsMade(session, new Set(units.map((u) => u.id)));
  const timeSaved = estimateTimeSaved(session, coverage.decisionUnitCount, made);
  const coveredOccurrenceCount = coverage.occurrenceCount;
  if (coveredOccurrenceCount === 0) return { ...EMPTY_DECISION_TRACKER, decisionsMade: made, timeSaved };
  // Floored for the same reason decisionReduction floors its own: a
  // negative "decisions avoided" is not a number the product should be
  // able to show. Reachable here only if gestures outnumber the
  // occurrences they cover -- i.e. every decided candidate is a
  // single-occurrence item decided individually, where the honest answer
  // really is "nothing was avoided."
  const avoidedDecisionCount = Math.max(0, coveredOccurrenceCount - made);
  return {
    decisionsMade: made,
    avoidedDecisionCount,
    coveredOccurrenceCount,
    fewerDecisionPercent: (100 * avoidedDecisionCount) / coveredOccurrenceCount,
    timeSaved,
  };
}

/**
 * The plain-language explanation behind the time figure -- "a rather
 * dubious sounding claim," as Andrew put it, so it has to be able to
 * account for itself on demand.
 *
 * Written to be READ BY A SKEPTIC. It names what was actually measured,
 * shows the arithmetic with this document's real numbers, and states the
 * direction of the error rather than hiding it. Nothing here is generated
 * from a template of adjectives; every number in the sentences comes from
 * the estimate itself, so the explanation cannot describe a calculation
 * that did not happen.
 */
export function explainTimeSaved(estimate: TimeSavedEstimate): string[] {
  const pace =
    estimate.perDecisionSeconds < 90
      ? `${Math.round(estimate.perDecisionSeconds)} seconds`
      : `${round1(estimate.perDecisionSeconds / 60)} minutes`;
  // PROFESSIONAL TOOL VOICE (AG, 2026-08-04). These three sentences were
  // the most conversational copy in the product -- "We timed how long you
  // take", "Yours is typically", "your own pace", "the time you would have
  // spent" -- a narrator describing what it did to a reader it addresses.
  // Rewritten to state what is TRUE rather than who observed it. The
  // skeptic-readable property the doc comment above claims is unaffected
  // and arguably strengthened: every number still comes from the estimate,
  // the arithmetic is still shown, and the direction of the error is still
  // stated -- now without a voice standing between the reader and it.
  return [
    `Measured pace: about ${pace} per decision, the middle value across ${estimate.sampleCount} items decided individually. Items decided one at a time are the only observable pace, and the median discounts pauses spent reading something else.`,
    `${estimate.unitsAvoided.toLocaleString()} items settled without individual review, covered by a category or group action. At the measured pace, handling them individually would have taken about ${estimate.value.toFixed(1)} ${estimate.unit}.`,
    // The word "saved" stays OUT, and that is a load-bearing constraint
    // rather than a wording preference: this figure measures work AVOIDED,
    // which is observable, not time saved, which is not. A tool-voice pass
    // must not quietly upgrade an observation into a benefit claim -- the
    // objective register this principle asks for is the same register that
    // forbids it. verify/decision-reduction-verification.ts enforces both
    // this and the "cautious / larger" direction-of-error statement below.
    `This estimate is deliberately cautious. It counts items only, not their repeated appearances in the document, and excludes the time to locate them. The avoided workload is very likely larger.`,
  ];
}
