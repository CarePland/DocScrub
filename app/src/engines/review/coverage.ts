/**
 * coverage.ts -- shared "is this candidate resolved" computation, factored
 * out so ReviewEngine.ts's candidateStatus() and FocusNavigator's stage/
 * traversal logic (src/engines/navigation/stages.ts) call the exact same
 * function instead of each re-deriving it. Both need it; duplicating it
 * would risk the two silently drifting apart over time, which is exactly
 * what Andrew's Phase 9 instruction warns against ("avoid caches that can
 * silently diverge from the source models").
 *
 * Pure wrapper around ReviewSession.ts's already-existing
 * resolvedStatusOf() -- this file only assembles that function's inputs
 * from a DetectionResult + ReviewSession, it does not reimplement the
 * resolved/partial/unresolved rule itself.
 */

import type { Candidate } from "../../domain/DocumentModel.js";
import type { QualityResult } from "../../domain/Evidence.js";
import { resolvedStatusOf, type CandidateDecisionKind, type OccurrenceCoverage, type ReviewSession } from "../../domain/ReviewSession.js";
import { decisionSummary, type DecisionSummary } from "../../domain/DecisionPrecedence.js";
import type { DetectionResult } from "../DetectionEngine.js";
import type { EntityGroupProposal, EntityResolutionEngine } from "../EntityResolutionEngine.js";

/** Every occurrenceId belonging to a candidate that is a confirmed member
 *  of some resolved EntityGroupDecision -- i.e. occurrences considered
 *  "covered" by a Group Check / Not Quite resolution even without a
 *  direct per-candidate decision. */
export function coveredOccurrenceIdsByResolvedGroups(session: ReviewSession, detection: DetectionResult): Set<string> {
  const candidatesById = new Map<string, Candidate>(detection.candidates.map((c) => [c.id, c]));
  const covered = new Set<string>();
  for (const group of Object.values(session.groupDecisions)) {
    for (const candidateId of group.confirmedMemberCandidateIds) {
      const candidate = candidatesById.get(candidateId);
      if (!candidate) continue;
      for (const occurrenceId of candidate.occurrenceIds) covered.add(occurrenceId);
    }
  }
  return covered;
}

export function candidateResolvedStatus(session: ReviewSession, detection: DetectionResult, candidateId: string): OccurrenceCoverage {
  const candidate = detection.candidates.find((c) => c.id === candidateId);
  const occurrenceIds = candidate?.occurrenceIds ?? [];
  const coveredByResolvedGroups = coveredOccurrenceIdsByResolvedGroups(session, detection);
  /*
   * AUTOMATIC RESOLUTIONS SETTLE A CANDIDATE (AG, 2026-08-09).
   *
   * `hasDirectDecision` is now "somebody settled this" rather than "the
   * reviewer decided this". Both a reviewer/imported CandidateDecision and
   * an automatic resolution satisfy it, because this predicate answers
   * "does this candidate still owe the workflow an answer" -- and it does
   * not, either way.
   *
   * WHAT THIS DELIBERATELY DOES NOT DO is tell the two apart. It cannot:
   * "resolved" is one bit. Everything that needs the distinction --
   * `decisionsMade`, the audit export, the metrics split -- reads the two
   * records directly, which is exactly why they were kept structurally
   * separate rather than merged behind a source enum.
   *
   * Precedence is not handled here because it cannot arise: decideCandidate()
   * clears any automatic resolution for the candidate it decides, so the two
   * are never both present.
   */
  const hasDirectDecision =
    candidateId in session.candidateDecisions || Boolean(session.automaticResolutions?.[candidateId]);
  return resolvedStatusOf(occurrenceIds, coveredByResolvedGroups, hasDirectDecision);
}

/**
 * DECISION TRACKER (AG, 2026-08-03): every candidate split into the ones
 * the reviewer has finished with and the ones still owed a decision, by
 * the SAME rule `candidateResolvedStatus` applies to one candidate --
 * including the part that is easy to get wrong on your own, that a
 * candidate covered by a resolved group counts as resolved without a
 * direct decision of its own.
 *
 * WHY THIS EXISTS RATHER THAN CALLERS FILTERING. Two callers needed
 * "which candidates are done" as a SET rather than one at a time: the
 * Decision Tracker's running scope (ui/app.ts) and the Workspace Metrics
 * Consolidation report (metrics/workspaceMetrics.ts). Each had written
 * its own filter -- one through `isItemResolved`, one through
 * `resolvedStatusOf` directly. Both were correct, and both were the same
 * rule expressed twice, which is exactly the divergence this file's own
 * header was written to prevent. One function now answers it for both.
 *
 * Also the reason this is a partition and not a predicate: the covered-
 * occurrence set is built ONCE here, where `candidateResolvedStatus`
 * rebuilds it per call. Filtering a few hundred candidates through the
 * single-candidate function is quadratic, and the tracker recomputes on
 * every render.
 *
 * `partiallyResolved` candidates count as REMAINING -- they still owe the
 * reviewer a decision, and the tracker must never call work finished that
 * the workflow still lists as outstanding.
 */
export interface ResolutionPartition {
  resolved: Candidate[];
  remaining: Candidate[];
}

export function partitionCandidatesByResolution(session: ReviewSession, detection: DetectionResult): ResolutionPartition {
  const coveredByResolvedGroups = coveredOccurrenceIdsByResolvedGroups(session, detection);
  const resolved: Candidate[] = [];
  const remaining: Candidate[] = [];
  for (const candidate of detection.candidates) {
    const status = resolvedStatusOf(candidate.occurrenceIds, coveredByResolvedGroups, candidate.id in session.candidateDecisions);
    (status.status === "resolved" ? resolved : remaining).push(candidate);
  }
  return { resolved, remaining };
}

/**
 * What a Group Check row should DISPLAY as its current outcome, derived
 * fresh from each member's own CandidateDecision every time -- never a
 * stored field. `EntityGroupDecision.decision` (Confirmed/Rejected/Refined,
 * see ReviewSession.ts) is too coarse for this purpose on its own: every one
 * of confirmGroup/redactGroup/ignoreGroup stamps "Confirmed" regardless of
 * WHICH bulk action was actually applied, and completeNotQuite/flattenGroup
 * both stamp "Refined" regardless of whether the reviewer's per-member
 * choices inside Not Quite came out uniform or mixed. The group's real
 * "what happened" story is always fully recoverable from its members'
 * candidateDecisions directly, so that -- not the coarser label -- is what
 * this reads.
 *
 * Workspace interaction revision (2026-07-29): Andrew asked that a Not Quite
 * group where every member was manually decided the same way (e.g. all
 * Keep) should, once the reviewer leaves it, simply read as that single
 * decision -- "you manually chose that path line by line, so let's reflect
 * the outcome." Confirmed as the intended rule: mixed member decisions stay
 * flagged for attention rather than being collapsed to a guessed outcome.
 * Requires NO new stored state or explicit "collapse on exit" step: this
 * function already recomputes the uniform/mixed distinction from
 * candidateDecisions on every call, so the row simply reflects it the next
 * time it renders -- which happens automatically the moment Not Quite
 * closes, because WorkspaceCommandDispatcher's existing reconcileFocus()
 * already re-renders after every review command (see
 * docs/detection/workspace-interaction-revision.md's "derive, don't
 * duplicate" note on this same mechanism). "Leaving focus" needed no new
 * code to detect; it was already an event this codebase reacts to.
 *
 * `undecided`: no member has any CandidateDecision yet -- the group's
 * ordinary default, deliberately NOT flagged for attention (most groups
 * start here; flagging all of them would make the signal meaningless).
 *
 * `uniform`: every member is individually decided and all decisions match
 * -- whether that came from a bulk group command, flattenGroup, a completed
 * Not Quite pass, or the reviewer deciding each member separately from Item
 * Check without ever touching Group Check at all. The single shared
 * decision is what the row should show, colored and checkmarked
 * accordingly, in place of the group's confidence score.
 *
 * `needsAttention`: some members decided and others not, or members decided
 * differently from one another. Genuinely ambiguous or incomplete -- stays
 * flagged rather than collapsed to a guess, per Andrew's confirmed rule.
 */
export type GroupDisplayDecision =
  | { kind: "undecided"; summary: DecisionSummary }
  | { kind: "uniform"; decision: CandidateDecisionKind; summary: DecisionSummary }
  | { kind: "needsAttention"; summary: DecisionSummary };

/**
 * UNIFIED DECISION COLOR SYSTEM (AG, 2026-08-03): `summary` carries the
 * same member decisions resolved through `DecisionPrecedence.ts` -- the
 * dominant decision that speaks for the card's tint, plus every additional
 * decision present, for the pills.
 *
 * ADDITIVE ON PURPOSE. `kind` keeps its exact prior meaning and every
 * existing consumer keeps working unchanged, because "is this group
 * uniform / mixed / untouched" turned out to be a genuinely different
 * question from "what color is this card," and both are still asked:
 *   - `kind === "uniform"` still gates the collapsed checkmark that
 *     replaces a confidence score (there is no uncertainty left to express
 *     as a percentage only when EVERY member agrees -- a card that is
 *     dominantly Redact with one Keep still has a real score).
 *   - `kind === "needsAttention"` still drives the gray Fix this emphasis
 *     and the per-member "needs attention" notes -- "this group wants
 *     member-by-member work," which remains true regardless of how the
 *     card is tinted.
 * What CHANGED is only that the card no longer paints AMBER for
 * `needsAttention`: mixed decisions are now expressed by the dominant tint
 * plus pills, per Andrew's 2026-08-03 direction, so amber is freed to mean
 * exactly one thing (an open Fix this session). Nothing here weakened --
 * one consumer of this value stopped reading it for color.
 *
 * Both halves are derived in the SAME pass over the same member decisions,
 * so `kind` and `summary` cannot disagree with each other or with the
 * decisions they describe.
 */
export function groupDisplayDecision(group: EntityGroupProposal, session: ReviewSession): GroupDisplayDecision {
  const decisions = group.candidateIds.map((id) => session.candidateDecisions[id]?.decision ?? null);
  const summary = decisionSummary(decisions);
  if (decisions.length === 0 || decisions.every((d) => d === null)) return { kind: "undecided", summary };
  const first = decisions[0]!;
  const allSame = first !== null && decisions.every((d) => d === first);
  return allSame ? { kind: "uniform", decision: first, summary } : { kind: "needsAttention", summary };
}

/**
 * LIVE CONFIDENCE (2026-07-29, Group Check Python-parity revision). What a
 * confidence badge should DISPLAY right now: `current` is the number to
 * show; `prior` is present only when it's worth a "was X%" note (i.e. it
 * differs from `current`) -- matching Python's own
 * `memberScore === 100 && priorScore !== 100` gate for showing that note at
 * all, rather than showing "was X%" on every render.
 *
 * Ports Python's `scoreMemberAgainstCanonical()`/`dynamicGroupConfidence()`
 * wrapper layer: a member that already has a reviewer decision (Keep/
 * Rename/Redact/Ignore) contributes 100 to the blend, full stop -- the
 * reviewer looked at it and made a call, so there's no more analysis
 * uncertainty left to express as a percentage. An undecided member still
 * shows its ordinary analysis-time score. `calculateEntityConfidence`
 * itself (resolution.ts) stays decision-agnostic; this function is the
 * "caller who knows about ReviewSession" its own doc comment anticipates.
 *
 * Deliberately does NOT recompute live against an in-progress, unconfirmed
 * rename draft the way Python's client JS does while its editor is still
 * open (see this feature's own findings doc for why -- it would require
 * the inline editor to re-render every keystroke, reintroducing a focus-
 * loss problem this codebase deliberately avoided when the inline editor
 * was built). `canonicalName`, when supplied, should be the group's real,
 * already-committed name (or an override about to be confirmed), never a
 * live keystroke-by-keystroke draft.
 */
export interface LiveConfidence {
  current: number;
  prior?: number;
}

function withDecidedOverride(session: ReviewSession): (candidateId: string) => number | undefined {
  return (candidateId) => (candidateId in session.candidateDecisions ? 100 : undefined);
}

/** Group- or subset-level live confidence -- `selectedCandidateIds` narrows
 *  the blend to a checked subset (the member-checkbox revision); pass the
 *  group's full `candidateIds` for the ordinary whole-group figure. The
 *  +10 "reviewer confirmed" bonus (Python's `groupHasReviewerConfirmation`)
 *  is derived here from `session.groupDecisions`, matching Python's own
 *  `latestGroupReview` check -- present whenever any group-level bulk
 *  action (confirmGroup/redactGroup/ignoreGroup/flattenGroup/
 *  completeNotQuite) has ever stamped this group, regardless of which one. */
export function groupLiveConfidence(
  group: EntityGroupProposal,
  detection: DetectionResult,
  quality: QualityResult,
  session: ReviewSession,
  selectedCandidateIds: readonly string[],
  resolutionEngine: EntityResolutionEngine,
  canonicalName?: string
): LiveConfidence {
  const reviewerConfirmed = group.groupId in session.groupDecisions;
  const current = resolutionEngine.recalculateConfidence(
    group,
    detection,
    quality,
    selectedCandidateIds,
    canonicalName,
    reviewerConfirmed,
    withDecidedOverride(session)
  );
  const prior = resolutionEngine.recalculateConfidence(group, detection, quality, selectedCandidateIds, canonicalName, false);
  return prior !== current ? { current, prior } : { current };
}

/** A single member's own live confidence. Deliberately NOT implemented via
 *  `groupLiveConfidence(..., [candidateId], ...)` despite the overlap --
 *  that function's group-wide "+10 reviewer confirmed" bonus must NOT leak
 *  into one member's individual score (Python's own
 *  `scoreMemberAgainstCanonical` never applies it per-member, only
 *  `dynamicGroupConfidence` does, for the group total), so this calls
 *  `recalculateConfidence` directly with `reviewerConfirmed` always false. */
export function memberLiveConfidence(
  group: EntityGroupProposal,
  candidateId: string,
  detection: DetectionResult,
  quality: QualityResult,
  session: ReviewSession,
  resolutionEngine: EntityResolutionEngine,
  canonicalName?: string
): LiveConfidence {
  const current = resolutionEngine.recalculateConfidence(
    group,
    detection,
    quality,
    [candidateId],
    canonicalName,
    false,
    withDecidedOverride(session)
  );
  const prior = resolutionEngine.recalculateConfidence(group, detection, quality, [candidateId], canonicalName, false);
  return prior !== current ? { current, prior } : { current };
}

/** Item Check/Ambiguity Check counterpart -- these are flat, ungrouped
 *  candidates with no canonical-name/blend concept at this layer (each was
 *  independently detected and independently scored), so this is just the
 *  same "decided collapses uncertainty to 100%" rule without
 *  `groupLiveConfidence`'s min/mean machinery, which a lone candidate has
 *  no use for. `analysisScore` is whatever `QualityResult.scoreByCandidate`
 *  already computed at detection time -- this function does not recompute
 *  it, only decides what to DISPLAY given that score plus decision state. */
export function candidateLiveConfidence(analysisScore: number, decided: boolean): LiveConfidence {
  if (!decided) return { current: analysisScore };
  return analysisScore === 100 ? { current: 100 } : { current: 100, prior: analysisScore };
}
