/**
 * decision-reduction-verification.ts -- DECISION REDUCTION (AG,
 * 2026-08-03, including the same day's revision to a RUNNING TALLY).
 * Covers the shared calculation in src/metrics/decisionReduction.ts, the
 * scope contract, and the property the whole definition rests on:
 *
 *   THE TALLY MEASURES COVERAGE, NOT TECHNIQUE.
 *
 * "THE ANTI-GAMING PROPERTY" in PART 2 is the most important test in this
 * file. It resolves the same twelve candidates in two fresh workspaces --
 * one item by item, one in a single bulk keystroke -- and asserts the
 * tallies are identical while the reviewer-ACTION counts differ (12 vs 1).
 * Because the metric counts decision UNITS disposed of rather than acts
 * taken, there is no way to make it climb faster by reviewing more
 * coarsely. In a tool where a missed occurrence is a disclosure, a metric
 * that rewarded blunter review would be pointed the wrong way. If a future
 * change makes bulk actions score differently from individual ones, this
 * suite is what catches it.
 *
 * The other load-bearing properties: the tally starts at zero, only ever
 * climbs, and lands EXACTLY on the document's full reduction when the last
 * item is resolved; and local figures shrink as their surface is worked
 * and suppress when it is finished.
 *
 * NOT coverable here (browser-only): the review-status strip's seam and
 * the local figures' placement/legibility on real headings. What IS
 * covered without a browser is every number and every string those
 * surfaces render -- PART 3 asserts the exact values and exact equation
 * text the UI emits, so a browser check is left confirming layout, not
 * arithmetic. See the findings doc's "remaining browser checks".
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/decision-reduction-verification.ts
 */

import { readFileSync } from "node:fs";
import { ReviewWorkspace } from "../src/workspace/Workspace.ts";
import { WorkspaceCommandDispatcher } from "../src/workspace/CommandDispatcher.ts";
import { InMemorySessionRepository } from "./support/InMemorySessionRepository.ts";
import { deriveWorkspaceMetrics, type MetricSection } from "../src/metrics/workspaceMetrics.ts";
import { partitionCandidatesByResolution } from "../src/engines/review/coverage.ts";
import { decisionTrackerFigures, decisionsMade, estimateTimeSaved, explainTimeSaved, individualDecisionRate } from "../src/metrics/decisionTracker.ts";
import type { ReviewSession } from "../src/domain/ReviewSession.ts";
import { formatPercentFigure, isRestingFigure } from "../src/metrics/percentDisplay.ts";
import {
  decisionReduction,
  formatFewerDecisionsPercent,
  formatReductionEquation,
  mergedUnit,
  shouldDisplayReduction,
  EMPTY_DECISION_REDUCTION,
  type ReviewUnit,
} from "../src/metrics/decisionReduction.ts";

let passCount = 0;
let failCount = 0;
function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passCount += 1;
    console.log(`  PASS ${label}`);
  } else {
    failCount += 1;
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

const metric = (sections: MetricSection[], sectionId: string, metricId: string) =>
  sections.find((s) => s.id === sectionId)?.metrics.find((x) => x.id === metricId);

/**
 * The resolved / still-remaining split, using the SAME shared rule the UI
 * surfaces use (a candidate covered by a resolved group counts as resolved
 * without a direct decision of its own). The group-coverage set is built
 * once per call rather than once per candidate.
 *
 * `resolvedCandidatesOf` is exactly the scope the review-status strip
 * supplies; `remainingCandidatesOf` is exactly what a local figure gets.
 */
type AnyState = ReturnType<WorkspaceCommandDispatcher["getState"]>;

function splitByResolution(state: AnyState) {
  const session = state.reviewSession;
  if (!session || !state.detection) return { resolved: [], remaining: [...(state.detection?.candidates ?? [])] };
  return partitionCandidatesByResolution(session, state.detection);
}

const resolvedCandidatesOf = (state: AnyState) => splitByResolution(state).resolved;
const remainingCandidatesOf = (state: AnyState) => splitByResolution(state).remaining;

/** A synthetic unit covering `count` occurrences with ids unique to `id`. */
const unit = (id: string, count: number): ReviewUnit => ({
  id,
  occurrenceIds: Array.from({ length: count }, (_, i) => `${id}#${i}`),
});

async function main(): Promise<void> {
  console.log("\n=== PART 1: the pure calculation ===\n");

  console.log("--- empty and invalid scopes are safe, never a throw ---");
  {
    check("null scope -> the empty result", JSON.stringify(decisionReduction(null)) === JSON.stringify(EMPTY_DECISION_REDUCTION));
    check("undefined scope -> the empty result", JSON.stringify(decisionReduction(undefined)) === JSON.stringify(EMPTY_DECISION_REDUCTION));
    check("empty array -> the empty result", JSON.stringify(decisionReduction([])) === JSON.stringify(EMPTY_DECISION_REDUCTION));
    // Malformed units: the strip re-renders constantly; a metric is never
    // worth taking the workspace down for.
    const malformed = decisionReduction([
      { id: "a", occurrenceIds: ["o1", "o2"] },
      { id: "b" } as unknown as ReviewUnit,
      { id: "c", occurrenceIds: null } as unknown as ReviewUnit,
      null as unknown as ReviewUnit,
    ]);
    check("units with missing/invalid occurrenceIds count as units covering nothing", malformed.decisionUnitCount === 3 && malformed.occurrenceCount === 2);
    const emptyIds = decisionReduction([{ id: "", occurrenceIds: ["o1"] }, { id: "", occurrenceIds: ["o2"] }]);
    check("id-less units are each taken at face value, not collapsed", emptyIds.decisionUnitCount === 2 && emptyIds.occurrenceCount === 2);
    check("a scope with units but zero occurrences reports 0%, not NaN", decisionReduction([{ id: "a", occurrenceIds: [] }]).fewerDecisionPercent === 0);
  }

  console.log("--- the basic relationship ---");
  {
    const r = decisionReduction([unit("a", 5), unit("b", 3), unit("c", 2)]);
    check("3 units over 10 occurrences", r.decisionUnitCount === 3 && r.occurrenceCount === 10);
    check("avoided = occurrences - units = 7", r.avoidedDecisionCount === 7);
    check("fewer decisions = 70%", r.fewerDecisionPercent === 70);
  }

  console.log("--- Andrew's stated example reproduces exactly ---");
  {
    // 162 decision units covering 2,486 occurrences.
    const units: ReviewUnit[] = [];
    let occurrence = 0;
    for (let i = 0; i < 162; i += 1) {
      // 161 units of 15 occurrences + 1 unit taking the remainder = 2,486.
      const size = i < 161 ? 15 : 2486 - 161 * 15;
      units.push({ id: `u${i}`, occurrenceIds: Array.from({ length: size }, () => `o${occurrence++}`) });
    }
    const r = decisionReduction(units);
    check("162 units / 2,486 occurrences", r.decisionUnitCount === 162 && r.occurrenceCount === 2486);
    check("= 2,324 decisions avoided", r.avoidedDecisionCount === 2324);
    // THE DOUBLE-ROUNDING REGRESSION GUARD. The true value is 93.4835%,
    // which is 93% whole and 93.5% to one decimal -- both correct
    // independently, but chaining them yields 94%, which is wrong and is
    // precisely the figure the spec's own example says should read 93%.
    // This check failed while the model pre-rounded to one decimal.
    check("= 93% fewer decisions as displayed", formatFewerDecisionsPercent(r) === "93%", `raw=${r.fewerDecisionPercent}`);
    check("one-decimal rendering is 93.5% -- and is NOT what the strip rounds", formatFewerDecisionsPercent(r, 1) === "93.5%");
    check("the model keeps the exact ratio, unrounded", Math.abs(r.fewerDecisionPercent - (100 * 2324) / 2486) < 1e-12);
  }

  console.log("--- duplicate occurrence coverage: an occurrence is one place in the document ---");
  {
    // Two units both covering o1: reviewing occurrence-by-occurrence, the
    // reviewer would still have read o1 once, so it counts once.
    const r = decisionReduction([
      { id: "a", occurrenceIds: ["o1", "o2"] },
      { id: "b", occurrenceIds: ["o1", "o3"] },
    ]);
    check("shared occurrences are counted once (union, not sum)", r.occurrenceCount === 3, `got ${r.occurrenceCount}`);
    check("avoided reflects the deduplicated count", r.avoidedDecisionCount === 1);
    // Repeated ids WITHIN one unit dedup too.
    check("occurrences repeated inside one unit dedup", decisionReduction([{ id: "a", occurrenceIds: ["o1", "o1", "o1"] }]).occurrenceCount === 1);
  }

  console.log("--- duplicate units collapse by id ---");
  {
    const u = unit("a", 4);
    const r = decisionReduction([u, u, { id: "a", occurrenceIds: ["elsewhere"] }]);
    check("the same unit supplied three times is one decision unit", r.decisionUnitCount === 1);
    check("and its duplicates contribute no extra occurrences", r.occurrenceCount === 4, `got ${r.occurrenceCount}`);
  }

  console.log("--- zero-reduction scopes, and the floor at zero ---");
  {
    const oneToOne = decisionReduction([{ id: "a", occurrenceIds: ["o1"] }]);
    check("1 unit / 1 occurrence = 0 avoided, 0%", oneToOne.avoidedDecisionCount === 0 && oneToOne.fewerDecisionPercent === 0);
    const flat = decisionReduction([unit("a", 1), unit("b", 1), unit("c", 1)]);
    check("3 single-occurrence units = 0 avoided", flat.decisionUnitCount === 3 && flat.occurrenceCount === 3 && flat.avoidedDecisionCount === 0);
    // Cannot occur with real candidates (each has >= 1 occurrence) but the
    // module is generic and must never emit a negative "avoided".
    const overSupplied = decisionReduction([
      { id: "a", occurrenceIds: ["o1"] },
      { id: "b", occurrenceIds: ["o1"] },
      { id: "c", occurrenceIds: ["o1"] },
    ]);
    check("more units than occurrences floors avoided at 0, never negative", overSupplied.avoidedDecisionCount === 0 && overSupplied.fewerDecisionPercent === 0);
  }

  console.log("--- percentage rounding: exact in the model, rounded once at the display ---");
  {
    const thirds = decisionReduction([unit("a", 3)]);
    check("1 / 3 -> 2 avoided -> 67% whole, 66.7% to one decimal", formatFewerDecisionsPercent(thirds) === "67%" && formatFewerDecisionsPercent(thirds, 1) === "66.7%");
    const sevenths = decisionReduction([unit("a", 7)]);
    check("1 / 7 -> 6 avoided -> 86% whole, 85.7% to one decimal", formatFewerDecisionsPercent(sevenths) === "86%" && formatFewerDecisionsPercent(sevenths, 1) === "85.7%");
    check("a near-total reduction never reads as a false 100%", formatFewerDecisionsPercent(decisionReduction([unit("a", 1000)]), 1) === "99.9%");
    check("no reduction is exactly 0, not -0", Object.is(decisionReduction([unit("a", 1)]).fewerDecisionPercent, 0));
    check("no reduction formats as '0%'", formatFewerDecisionsPercent(decisionReduction([unit("a", 1)])) === "0%");
    check("empty scope formats as '0%' rather than 'NaN%'", formatFewerDecisionsPercent(decisionReduction([])) === "0%");
  }

  // ENDPOINT HONESTY (AG, 2026-08-06), from live use: "I had 1/223, which
  // rounds up to 100%, but of course is not actually 100%." 0% and 100%
  // are claims, not quantities -- see metrics/percentDisplay.ts.
  console.log("--- rounding must not reach an endpoint it has not reached ---");
  {
    // Andrew's own case: one decision covering 223 occurrences.
    const andrews = decisionReduction([unit("a", 223)]);
    check(
      "1 / 223 = 99.55% reduction reads '~100%', never a bare '100%'",
      formatFewerDecisionsPercent(andrews) === "~100%",
      formatFewerDecisionsPercent(andrews)
    );
    check("and the tilde disappears at a precision where the figure is honest", formatFewerDecisionsPercent(andrews, 1) === "99.6%");
    check("a genuinely exact 100% takes no tilde", formatPercentFigure(100) === "100%");
    check("a genuinely exact 0% takes no tilde", formatPercentFigure(0) === "0%");
    check("a value rounding DOWN to zero reads '~0%'", formatPercentFigure(0.4) === "~0%");
    check("the rule holds at one decimal too", formatPercentFigure(99.96, 1) === "~100.0%" && formatPercentFigure(0.04, 1) === "~0.0%");
    check("ordinary values are untouched -- no tilde noise", formatPercentFigure(93) === "93%" && formatPercentFigure(66.7, 1) === "66.7%");
    check("non-finite input renders an exact 0%, never 'NaN%'", formatPercentFigure(Number.NaN) === "0%");
    check("out-of-range input is bounded rather than displayed", formatPercentFigure(140) === "100%" && formatPercentFigure(-3) === "0%");
    // The muting rule depends on this: grey means "no data," so a
    // displayed plain zero must never be a rounded-down non-zero.
    check("resting is EXACT zero only", isRestingFigure(0) && !isRestingFigure(0.4) && isRestingFigure(Number.NaN));
  }

  console.log("--- mergedUnit: many candidates presented as one row to judge ---");
  {
    const merged = mergedUnit("group-1", [
      { id: "c1", occurrenceIds: ["o1", "o2"] },
      { id: "c2", occurrenceIds: ["o2", "o3"] },
      { id: "c3", occurrenceIds: [] },
    ]);
    check("merged unit carries the supplied id", merged.id === "group-1");
    check("merged unit unions member occurrences without duplicates", merged.occurrenceIds.length === 3 && new Set(merged.occurrenceIds).size === 3);
    const asGroup = decisionReduction([merged]);
    const asMembers = decisionReduction([
      { id: "c1", occurrenceIds: ["o1", "o2"] },
      { id: "c2", occurrenceIds: ["o2", "o3"] },
      { id: "c3", occurrenceIds: [] },
    ]);
    check("the SAME candidates read differently as one group row vs three items", asGroup.decisionUnitCount === 1 && asMembers.decisionUnitCount === 3);
    check("and both are true about their own surface (same occurrences, different units)", asGroup.occurrenceCount === asMembers.occurrenceCount);
    check("merged over an empty member list is safe", mergedUnit("g", []).occurrenceIds.length === 0);
  }

  console.log("--- the local equation text ---");
  {
    const r = decisionReduction([...Array.from({ length: 23 }, (_, i) => unit(`u${i}`, i === 0 ? 418 - 22 : 1))]);
    check("23 units / 418 occurrences", r.decisionUnitCount === 23 && r.occurrenceCount === 418);
    check(
      "reads '23 / 418 = 395 decisions avoided' -- reviewer workload first",
      formatReductionEquation(r) === "23 / 418 = 395 decisions avoided",
      formatReductionEquation(r)
    );
    const one = decisionReduction([unit("a", 2)]);
    check("singular: '1 / 2 = 1 decision avoided'", formatReductionEquation(one) === "1 / 2 = 1 decision avoided", formatReductionEquation(one));
    // Thousands separators are locale-formatted; assert shape, not locale.
    const big = decisionReduction([unit("a", 2486)]);
    check("large figures are grouped for legibility", /^1 \/ 2.486 = 2.485 decisions avoided$/.test(formatReductionEquation(big)), formatReductionEquation(big));
  }

  console.log("--- suppression: nothing to report renders nothing ---");
  {
    check("empty scope is suppressed", shouldDisplayReduction(decisionReduction([])) === false);
    check("1 / 1 = 0 avoided is suppressed", shouldDisplayReduction(decisionReduction([{ id: "a", occurrenceIds: ["o1"] }])) === false);
    check(
      "units === occurrences is suppressed at any size",
      shouldDisplayReduction(decisionReduction([unit("a", 1), unit("b", 1), unit("c", 1)])) === false
    );
    check("a scope with real reduction is displayed", shouldDisplayReduction(decisionReduction([unit("a", 2)])) === true);
  }

  console.log("\n=== PART 2: real workspace -- scope, the running tally, Consolidation, reuse ===\n");

  const bytes = readFileSync("fixtures/domain-parity/entity-resolution-001/source/synthetic_entity_resolution.docx");
  const repository = new InMemorySessionRepository();
  const workspace = new ReviewWorkspace({ clock: () => new Date().toISOString(), sessionRepository: repository });
  const dispatcher = new WorkspaceCommandDispatcher(workspace);
  await dispatcher.dispatchApplication({ family: "document", type: "load", file: new File([bytes], "synthetic_entity_resolution.docx") });
  const state0 = dispatcher.getState();
  const candidates = state0.detection!.candidates;

  console.log("--- global document scope ---");
  {
    const global = decisionReduction(candidates);
    const independentOccurrences = new Set(candidates.flatMap((c) => c.occurrenceIds)).size;
    check("every detected candidate is a decision unit", global.decisionUnitCount === candidates.length, `${global.decisionUnitCount} vs ${candidates.length}`);
    check("occurrences match an independent recount", global.occurrenceCount === independentOccurrences);
    check("avoided = occurrences - units", global.avoidedDecisionCount === Math.max(0, independentOccurrences - candidates.length));
    check("the fixture actually has reduction to report", global.avoidedDecisionCount > 0, `avoided=${global.avoidedDecisionCount}`);
  }

  console.log("--- local scope: computed over the supplied scope ONLY ---");
  {
    const global = decisionReduction(candidates);
    const subset = candidates.slice(0, Math.max(2, Math.floor(candidates.length / 3)));
    const local = decisionReduction(subset);
    check("a local scope counts only its own units", local.decisionUnitCount === subset.length);
    check("a local scope counts only its own occurrences", local.occurrenceCount === new Set(subset.flatMap((c) => c.occurrenceIds)).size);
    check("and is bounded by the global scope it sits inside", local.occurrenceCount <= global.occurrenceCount && local.decisionUnitCount <= global.decisionUnitCount);
    // Overlap is expected and must not be "fixed" into summation.
    const firstHalf = candidates.slice(0, Math.ceil(candidates.length / 2));
    const overlapping = candidates.slice(Math.floor(candidates.length / 4));
    const sumOfParts = decisionReduction(firstHalf).decisionUnitCount + decisionReduction(overlapping).decisionUnitCount;
    check("overlapping scopes deliberately over-count when summed (they are not parts of a whole)", sumOfParts > global.decisionUnitCount);
  }

  console.log("--- group-shaped scope: one row, many candidates ---");
  {
    const group = (state0.grouping?.entityGroupProposals ?? [])[0];
    if (!group) {
      check("fixture exposes at least one entity group to test merged units", false, "no entityGroupProposals");
    } else {
      const members = candidates.filter((c) => group.candidateIds.includes(c.id));
      const asRow = decisionReduction([mergedUnit(group.groupId, members)]);
      const asItems = decisionReduction(members);
      check("a group row is exactly one decision unit", asRow.decisionUnitCount === 1);
      check("covering the same occurrences its members do", asRow.occurrenceCount === asItems.occurrenceCount);
      check("so the group row avoids strictly more than the members do", asRow.avoidedDecisionCount >= asItems.avoidedDecisionCount);
    }
  }

  console.log("--- THE RUNNING TALLY: starts at zero, climbs, lands on the ceiling ---");
  {
    // The exact scope the review-status strip supplies: resolved units only.
    const runningTally = (d: WorkspaceCommandDispatcher) => decisionReduction(resolvedCandidatesOf(d.getState()));
    const ceiling = decisionReduction(candidates);

    check("a fresh document has avoided nothing yet", runningTally(dispatcher).avoidedDecisionCount === 0);
    check("and reports 0%, not NaN%, before the first decision", formatFewerDecisionsPercent(runningTally(dispatcher)) === "0%");

    // Resolve a multi-occurrence candidate -- the tally must move.
    const firstMulti = candidates.find((c) => c.occurrenceIds.length > 1)!;
    dispatcher.dispatchReview({ family: "review", type: "keepCandidate", candidateId: firstMulti.id });
    const afterOne = runningTally(dispatcher);
    check("one decision on an N-occurrence item avoids N-1", afterOne.avoidedDecisionCount === firstMulti.occurrenceIds.length - 1);
    check("the tally never exceeds the document ceiling", afterOne.avoidedDecisionCount <= ceiling.avoidedDecisionCount);

    // Monotonic across a mix of individual, bulk and group actions.
    let previous = afterOne.avoidedDecisionCount;
    let monotonic = true;
    const undecided = () => remainingCandidatesOf(dispatcher.getState());
    for (const step of [1, 2, 3]) {
      const batch = undecided().slice(0, step * 2).map((c) => c.id);
      if (batch.length === 0) break;
      dispatcher.dispatchReview({ family: "review", type: "bulkApplyDecision", candidateIds: batch, decision: "Ignore" });
      const now = runningTally(dispatcher).avoidedDecisionCount;
      if (now < previous) monotonic = false;
      previous = now;
    }
    const group = (dispatcher.getState().grouping?.entityGroupProposals ?? [])[0];
    if (group) dispatcher.dispatchReview({ family: "review", type: "confirmGroup", groupId: group.groupId });
    if (runningTally(dispatcher).avoidedDecisionCount < previous) monotonic = false;
    check("the tally only ever climbs, across individual + bulk + group actions", monotonic);

    // Complete the review: the tally must land EXACTLY on the ceiling.
    const remaining = undecided().map((c) => c.id);
    if (remaining.length > 0) dispatcher.dispatchReview({ family: "review", type: "bulkApplyDecision", candidateIds: remaining, decision: "Keep" });
    const final = runningTally(dispatcher);
    check("every candidate is resolved at the end", undecided().length === 0);
    check("the finished tally equals the document ceiling, exactly", final.avoidedDecisionCount === ceiling.avoidedDecisionCount, `${final.avoidedDecisionCount} vs ${ceiling.avoidedDecisionCount}`);
    check("as does its unit count", final.decisionUnitCount === ceiling.decisionUnitCount);
    check("and its percentage", final.fewerDecisionPercent === ceiling.fewerDecisionPercent);
  }

  console.log("--- THE ANTI-GAMING PROPERTY: bulk and individual review tally identically ---");
  {
    // The reason the unit -- not the action -- is what gets counted. Two
    // fresh workspaces resolve the SAME candidates; one item by item, one
    // in a single bulk keystroke. If the tallies ever diverge, the metric
    // has started rewarding coarser review, which is the failure this
    // whole definition exists to prevent.
    const build = async () => {
      const w = new ReviewWorkspace({ clock: () => new Date().toISOString(), sessionRepository: new InMemorySessionRepository() });
      const d = new WorkspaceCommandDispatcher(w);
      await d.dispatchApplication({ family: "document", type: "load", file: new File([bytes], "synthetic_entity_resolution.docx") });
      return d;
    };
    const byHand = await build();
    const inBulk = await build();
    const targetIds = byHand.getState().detection!.candidates.slice(0, 12).map((c) => c.id);

    for (const id of targetIds) byHand.dispatchReview({ family: "review", type: "ignoreCandidate", candidateId: id });
    inBulk.dispatchReview({ family: "review", type: "bulkApplyDecision", candidateIds: targetIds, decision: "Ignore" });

    const tallyOf = (d: WorkspaceCommandDispatcher) => decisionReduction(resolvedCandidatesOf(d.getState()));
    const hand = tallyOf(byHand);
    const bulk = tallyOf(inBulk);
    check("identical decision units", hand.decisionUnitCount === bulk.decisionUnitCount);
    check("identical covered occurrences", hand.occurrenceCount === bulk.occurrenceCount);
    check("identical avoided count -- technique cannot move the number", hand.avoidedDecisionCount === bulk.avoidedDecisionCount, `${hand.avoidedDecisionCount} vs ${bulk.avoidedDecisionCount}`);
    check("identical percentage", hand.fewerDecisionPercent === bulk.fewerDecisionPercent);
    // ...while the ACTIVITY figures legitimately differ, which is the
    // distinction being preserved: 12 acts vs 1, same work covered.
    const acts = (d: WorkspaceCommandDispatcher) =>
      deriveWorkspaceMetrics(d.getState()).find((s) => s.id === "consolidation")?.metrics.find((x) => x.id === "actions-so-far")?.value;
    check("reviewer ACTION counts do differ (12 acts vs 1), as they should", acts(byHand) !== acts(inBulk), `${acts(byHand)} vs ${acts(inBulk)}`);
  }

  console.log("--- Consolidation consumes the shared module (no second implementation) ---");
  {
    // NOTE: `dispatcher`'s document is fully reviewed by this point, so its
    // running tally and its ceiling coincide. A partially-reviewed
    // workspace is checked immediately after, where the two must differ.
    const sections = deriveWorkspaceMetrics(dispatcher.getState());
    const ceiling = decisionReduction(dispatcher.getState().detection!.candidates);
    const running = decisionTrackerFigures(dispatcher.getState().reviewSession, resolvedCandidatesOf(dispatcher.getState()));
    check("Consolidation 'decision-units' IS the module's full-document unit count", metric(sections, "consolidation", "decision-units")?.value === ceiling.decisionUnitCount);
    check("Consolidation 'avoided' IS the tracker's avoided count", metric(sections, "consolidation", "avoided")?.value === running.avoidedDecisionCount);
    check(
      "its note carries the tracker's percent and names the unit-based floor",
      String(metric(sections, "consolidation", "avoided")?.note ?? "").includes(formatFewerDecisionsPercent(running)) &&
        String(metric(sections, "consolidation", "avoided")?.note ?? "").includes(`at least ${ceiling.avoidedDecisionCount.toLocaleString()}`),
      String(metric(sections, "consolidation", "avoided")?.note)
    );
    // The unit-based figure is a FLOOR: a category-reviewed document
    // avoids at least as much as the unit count implies, and usually more.
    check(
      "the tracker's avoided is never below the unit-based floor once review is complete",
      running.avoidedDecisionCount >= ceiling.avoidedDecisionCount,
      `${running.avoidedDecisionCount} vs floor ${ceiling.avoidedDecisionCount}`
    );
    // The counting rule, exercised directly rather than through the panel.
    check(
      "decisionsMade over an empty resolved set is 0, whatever the log holds",
      decisionsMade(dispatcher.getState().reviewSession, new Set<string>()) === 0
    );
    check(
      "the Workspace section's occurrence count comes from the same calculation",
      metric(sections, "workspace", "occurrences")?.value === ceiling.occurrenceCount
    );
    check("reviewer-activity figures remain live", (metric(sections, "consolidation", "actions-so-far")?.value as number) > 0);
    check("notes stay factual (no time/productivity claims)", !JSON.stringify(sections).match(/time saved|faster|productivity|efficien/i));

    // Partially reviewed: running must sit strictly BELOW the ceiling, or
    // the two entries have quietly collapsed into the same number.
    const partial = new ReviewWorkspace({ clock: () => new Date().toISOString(), sessionRepository: new InMemorySessionRepository() });
    const partialDispatcher = new WorkspaceCommandDispatcher(partial);
    await partialDispatcher.dispatchApplication({ family: "document", type: "load", file: new File([bytes], "synthetic_entity_resolution.docx") });
    const someMulti = partialDispatcher.getState().detection!.candidates.filter((c) => c.occurrenceIds.length > 1)[0]!;
    partialDispatcher.dispatchReview({ family: "review", type: "keepCandidate", candidateId: someMulti.id });
    const partialSections = deriveWorkspaceMetrics(partialDispatcher.getState());
    const partialCeiling = decisionReduction(partialDispatcher.getState().detection!.candidates);
    check(
      "mid-review, 'avoided so far' is strictly below the ceiling it names",
      (metric(partialSections, "consolidation", "avoided")?.value as number) < partialCeiling.avoidedDecisionCount,
      `${metric(partialSections, "consolidation", "avoided")?.value} vs ceiling ${partialCeiling.avoidedDecisionCount}`
    );
    check(
      "and the ceiling entry is unmoved by that decision",
      metric(partialSections, "consolidation", "decision-units")?.value === partialCeiling.decisionUnitCount
    );
  }

  console.log("--- decision reuse: reused decisions are still decision units ---");
  {
    // Build a prior review of the same fixture, export its decisions, and
    // import them into a fresh session. The document still REQUIRES those
    // decisions; prior work merely already answered them, which is Decision
    // Reuse's question, not this one.
    await dispatcher.dispatchApplication({ family: "document", type: "generateAudit" });
    const decisionsJson = dispatcher.getLastAuditArtifacts()?.decisionsJson;
    if (!decisionsJson) {
      check("a prior decisions.json is available for the reuse check", false, "generateAudit produced none");
    } else {
      const freshWorkspace = new ReviewWorkspace({ clock: () => new Date().toISOString(), sessionRepository: new InMemorySessionRepository() });
      const fresh = new WorkspaceCommandDispatcher(freshWorkspace);
      await fresh.dispatchApplication({ family: "document", type: "load", file: new File([bytes], "synthetic_entity_resolution.docx") });
      const ceilingBefore = decisionReduction(fresh.getState().detection!.candidates);
      const runningBefore = decisionReduction(resolvedCandidatesOf(fresh.getState()));
      const importResult = await fresh.dispatchApplication({
        family: "document",
        type: "importDecisions",
        file: new File([decisionsJson], "prior-decisions.json", { type: "application/json" }),
      });
      check("importing prior decisions succeeds", importResult.ok === true, importResult.ok === false ? importResult.reason : undefined);
      const ceilingAfter = decisionReduction(fresh.getState().detection!.candidates);
      const runningAfter = decisionReduction(resolvedCandidatesOf(fresh.getState()));

      // THE RULE: a reused decision is still a decision unit. The document
      // requires it either way, so the CEILING cannot move.
      check("the document's decision units are unchanged by reuse", ceilingAfter.decisionUnitCount === ceilingBefore.decisionUnitCount);
      check("and its full reduction ceiling is unchanged", ceilingAfter.avoidedDecisionCount === ceilingBefore.avoidedDecisionCount);

      // THE CONSEQUENCE of a running tally: those units are now RESOLVED,
      // so the tally advances. That is reuse showing up as completed work,
      // not as a bonus -- the units still sit in the denominator exactly as
      // they would had the reviewer decided them by hand.
      check("the running tally advances, because reused units really are resolved", runningAfter.avoidedDecisionCount > runningBefore.avoidedDecisionCount);
      check("a fully-reused document lands on the same figure a hand review would", runningAfter.avoidedDecisionCount === ceilingAfter.avoidedDecisionCount, `${runningAfter.avoidedDecisionCount} vs ${ceilingAfter.avoidedDecisionCount}`);
      check("reuse is never credited beyond the ceiling", runningAfter.avoidedDecisionCount <= ceilingAfter.avoidedDecisionCount);
    }
  }

  console.log("\n=== PART 3: the exact values and strings the UI renders ===\n");

  console.log("--- DECISION TRACKER: Made counts HUMAN DECISIONS ---");
  {
    const tracker = (d: WorkspaceCommandDispatcher) => {
      const s = d.getState();
      return decisionTrackerFigures(s.reviewSession, resolvedCandidatesOf(s));
    };
    const build = async () => {
      const w = new ReviewWorkspace({ clock: () => new Date().toISOString(), sessionRepository: new InMemorySessionRepository() });
      const d = new WorkspaceCommandDispatcher(w);
      await d.dispatchApplication({ family: "document", type: "load", file: new File([bytes], "synthetic_entity_resolution.docx") });
      return d;
    };

    const d0 = await build();
    const zero = tracker(d0);
    check("a fresh document reads 0 / 0 / 0%", zero.decisionsMade === 0 && zero.avoidedDecisionCount === 0 && formatFewerDecisionsPercent(zero) === "0%");

    // ONE GESTURE IS ONE DECISION. "Treat all this way" over 12 items is
    // one decision the reviewer made, not twelve.
    const twelve = d0.getState().detection!.candidates.slice(0, 12).map((c) => c.id);
    d0.dispatchReview({ family: "review", type: "bulkApplyDecision", candidateIds: twelve, decision: "Ignore" });
    const bulk = tracker(d0);
    check("one bulk action over 12 items is ONE decision made", bulk.decisionsMade === 1, `Made=${bulk.decisionsMade}`);

    // ...and the twelve items decided one at a time is twelve.
    const d1 = await build();
    for (const id of twelve) d1.dispatchReview({ family: "review", type: "ignoreCandidate", candidateId: id });
    const byHand = tracker(d1);
    check("the same twelve decided individually is TWELVE decisions made", byHand.decisionsMade === 12, `Made=${byHand.decisionsMade}`);
    check("both cover the same occurrences", bulk.coveredOccurrenceCount === byHand.coveredOccurrenceCount);
    check(
      "so working by category avoids MORE -- the point of the model",
      bulk.avoidedDecisionCount > byHand.avoidedDecisionCount,
      `${bulk.avoidedDecisionCount} vs ${byHand.avoidedDecisionCount}`
    );

    // THE PANEL'S IDENTITY, in both worlds.
    for (const [label, t] of [["bulk", bulk], ["individual", byHand]] as const) {
      check(
        `Made + Avoided = covered occurrences (${label})`,
        t.decisionsMade + t.avoidedDecisionCount === t.coveredOccurrenceCount,
        `${t.decisionsMade} + ${t.avoidedDecisionCount} != ${t.coveredOccurrenceCount}`
      );
    }
    check(
      "Fewer is Avoided as a share of that total",
      formatFewerDecisionsPercent(bulk, 4) === `${((100 * bulk.avoidedDecisionCount) / bulk.coveredOccurrenceCount).toFixed(4)}%`
    );

    // THE DEFECT THAT MUST NOT RETURN: changing your mind about an item you
    // already decided is not a new decision made.
    const d2 = await build();
    const one = d2.getState().detection!.candidates[0]!.id;
    d2.dispatchReview({ family: "review", type: "keepCandidate", candidateId: one });
    const afterFirst = tracker(d2).decisionsMade;
    d2.dispatchReview({ family: "review", type: "redactCandidate", candidateId: one });
    d2.dispatchReview({ family: "review", type: "ignoreCandidate", candidateId: one });
    check("re-deciding the same item does not advance Made", tracker(d2).decisionsMade === afterFirst, `${tracker(d2).decisionsMade} vs ${afterFirst}`);
    check("but the raw action tally does move (so the check above is not vacuous)", deriveWorkspaceMetrics(d2.getState()).find((s) => s.id === "consolidation")?.metrics.find((x) => x.id === "actions-so-far")?.value === 3);
    d2.dispatchReview({ family: "review", type: "resetDecisions", candidateIds: [one], scope: "zone" });
    check("reset drops the old decision gesture out of Made", tracker(d2).decisionsMade === 0, `Made=${tracker(d2).decisionsMade}`);
    check("reset events themselves do not inflate Made", decisionsMade(d2.getState().reviewSession, new Set(resolvedCandidatesOf(d2.getState()))) === 0);

    // A group action that overwrites members already decided counts ONCE
    // for what it newly resolved, and never again for what it overwrote.
    const d3 = await build();
    const group = d3.getState().grouping!.entityGroupProposals.find((g) => g.candidateIds.length >= 2)!;
    d3.dispatchReview({ family: "review", type: "redactCandidate", candidateId: group.candidateIds[0]! });
    const beforeGroup = tracker(d3).decisionsMade;
    d3.dispatchReview({ family: "review", type: "confirmGroup", groupId: group.groupId });
    const afterGroup = tracker(d3).decisionsMade;
    check(
      "a group action over partly-decided members adds exactly one decision",
      afterGroup === beforeGroup + 1,
      `${beforeGroup} -> ${afterGroup}`
    );
    d3.dispatchReview({ family: "review", type: "confirmGroup", groupId: group.groupId });
    check("repeating that group action adds nothing -- it resolved nothing new", tracker(d3).decisionsMade === afterGroup);

    // Importing prior decisions is ONE gesture, not one per decision.
    const d4 = await build();
    for (const id of d4.getState().detection!.candidates.map((c) => c.id)) d4.dispatchReview({ family: "review", type: "keepCandidate", candidateId: id });
    await d4.dispatchApplication({ family: "document", type: "generateAudit" });
    const priorJson = d4.getLastAuditArtifacts()!.decisionsJson;
    const d5 = await build();
    await d5.dispatchApplication({
      family: "document",
      type: "importDecisions",
      file: new File([priorJson], "prior.json", { type: "application/json" }),
    });
    const imported = tracker(d5);
    check("importing a whole prior review counts as ONE decision made", imported.decisionsMade === 1, `Made=${imported.decisionsMade}`);
    check("and its identity still holds", imported.decisionsMade + imported.avoidedDecisionCount === imported.coveredOccurrenceCount);

    // The three strings the panel renders.
    check("Made renders a grouped integer", /^[\d.,  ]+$/.test(bulk.decisionsMade.toLocaleString()));
    check("Avoided renders a grouped integer", /^[\d.,  ]+$/.test(bulk.avoidedDecisionCount.toLocaleString()));
    // `~?` is the 2026-08-06 endpoint rule (percentDisplay.ts), not slack
    // in the format: the tilde appears ONLY where the figure rounds to 0 or
    // 100 without being either. Everything else is still a bare percent.
    check("Fewer renders a whole percent", /^~?\d{1,3}%$/.test(formatFewerDecisionsPercent(bulk)), formatFewerDecisionsPercent(bulk));
    check("Fewer never exceeds 100%", bulk.fewerDecisionPercent <= 100);

    // Consolidation shows the same Made the panel does.
    const sections = deriveWorkspaceMetrics(d0.getState());
    check("Workspace Metrics 'made' matches the panel", metric(sections, "consolidation", "made")?.value === bulk.decisionsMade);
    check("Workspace Metrics 'avoided' matches the panel", metric(sections, "consolidation", "avoided")?.value === bulk.avoidedDecisionCount);
    check(
      "and the unit-based figure is now stated as a FLOOR, not a target",
      String(metric(sections, "consolidation", "avoided")?.note ?? "").includes("at least"),
      String(metric(sections, "consolidation", "avoided")?.note)
    );
  }

  console.log("--- TIME SAVED: the one modeled figure ---");
  {
    // Synthetic sessions: the estimate depends on event TIMESTAMPS, which a
    // dispatcher-driven run cannot control. Building sessions by hand is
    // the only way to pin the rate rule and the unit ladder.
    const session = (events: { kind: string; at: string; payload: Record<string, unknown> }[]): ReviewSession =>
      ({ events: events.map((e, i) => ({ id: `e${i}`, ...e })) }) as unknown as ReviewSession;
    const at = (seconds: number) => new Date(Date.UTC(2026, 7, 3, 12, 0, seconds)).toISOString();
    const individual = (secondsIn: number, id: string) => ({ kind: "candidate-decided", at: at(secondsIn), payload: { candidateId: id, decision: "Keep" } });

    console.log("  rate: measured only from consecutive INDIVIDUAL decisions");
    {
      const even = session([individual(0, "a"), individual(10, "b"), individual(20, "c"), individual(30, "d")]);
      const rate = individualDecisionRate(even);
      check("four decisions ten seconds apart -> 10s over 3 samples", rate?.seconds === 10 && rate?.samples === 3, JSON.stringify(rate));

      check("fewer than three usable gaps -> no rate at all", individualDecisionRate(session([individual(0, "a"), individual(5, "b")])) === null);
      check("a null session is safe", individualDecisionRate(null) === null);

      // An overnight gap is DISCARDED, not capped -- capping would drag the
      // mean up toward the ceiling and inflate the estimate.
      const withIdle = session([individual(0, "a"), individual(10, "b"), individual(20, "c"), individual(40000, "d"), individual(40010, "e")]);
      const idleRate = individualDecisionRate(withIdle);
      check("an idle gap is dropped rather than counted at the ceiling", idleRate?.seconds === 10, JSON.stringify(idleRate));
      check("and its neighbours still contribute", idleRate?.samples === 3, JSON.stringify(idleRate));

      // THE MEDIAN IS THE REAL OUTLIER DEFENCE. Distraction under the
      // ceiling -- a glance at the inbox, a colleague at the desk -- is
      // what a mean would price as deliberation. Gaps of 5,5,5,5,110,115
      // have a mean of ~41s and a median of 5s; the mean would have made
      // this estimate eight times larger on the same behavior.
      const distracted = session([
        individual(0, "a"),
        individual(5, "b"),
        individual(10, "c"),
        individual(15, "d"),
        individual(20, "e"),
        individual(130, "f"),
        individual(245, "g"),
      ]);
      const robust = individualDecisionRate(distracted);
      check("a distracted tail under the ceiling does not move the pace", robust?.seconds === 5, JSON.stringify(robust));
      check("but those gaps are still counted as samples", robust?.samples === 6, JSON.stringify(robust));
      const meanOfSame = [5, 5, 5, 5, 110, 115].reduce((a, b) => a + b, 0) / 6;
      check("a mean over the same gaps would have been far higher", meanOfSame > 7 * robust!.seconds, `${meanOfSame} vs ${robust!.seconds}`);

      // Even sample counts take the mean of the two central observations.
      const evenCount = individualDecisionRate(session([individual(0, "a"), individual(4, "b"), individual(10, "c"), individual(18, "d"), individual(28, "e")]));
      check("an even number of gaps medians the two central values", evenCount?.seconds === 7 && evenCount?.samples === 4, JSON.stringify(evenCount));

      // Bulk gestures say nothing about how long ONE decision takes.
      const withBulk = session([
        individual(0, "a"),
        individual(10, "b"),
        individual(20, "c"),
        individual(30, "d"),
        { kind: "candidate-decided", at: at(35), payload: { candidateId: "x", viaBulkApply: true } },
        { kind: "bulk-decided", at: at(35), payload: { appliedCount: 1 } },
      ]);
      check("batch-member events add no samples to the rate", individualDecisionRate(withBulk)?.samples === 3, JSON.stringify(individualDecisionRate(withBulk)));
      // Imported decisions are tagged `source: "imported"`, not `via*` --
      // a via*-only test would count a whole imported review as pace data.
      const withImport = session([
        individual(0, "a"),
        individual(10, "b"),
        individual(20, "c"),
        individual(30, "d"),
        { kind: "candidate-decided", at: at(31), payload: { candidateId: "y", source: "imported" } },
        { kind: "decisions-imported", at: at(31), payload: { appliedCount: 1 } },
      ]);
      check("imported decisions add no samples either", individualDecisionRate(withImport)?.samples === 3, JSON.stringify(individualDecisionRate(withImport)));
    }

    console.log("  the estimate multiplies UNITS avoided, never occurrences");
    {
      const s = session([individual(0, "a"), individual(10, "b"), individual(20, "c"), individual(30, "d")]);
      // 100 units resolved by 4 decisions -> 96 avoided, at 10s each.
      const e = estimateTimeSaved(s, 100, 4)!;
      check("96 units avoided", e.unitsAvoided === 96);
      check("at the observed 10s pace = 960s", e.totalSeconds === 960);
      check("rendered as 16.0 minutes", e.value === 16 && e.unit === "minutes", `${e.value} ${e.unit}`);
      check("label is the phrase beside the number", e.label === "minutes of work avoided", e.label);
      check("display is a bare one-decimal number", e.display === "16.0", e.display);
      check("the rate and its sample size are exposed for auditing", e.perDecisionSeconds === 10 && e.sampleCount === 3);
    }

    console.log("  suppressed rather than fabricated");
    {
      const s = session([individual(0, "a"), individual(10, "b"), individual(20, "c"), individual(30, "d")]);
      check("nothing avoided -> no estimate", estimateTimeSaved(s, 4, 4) === null);
      check("more decisions than units -> no estimate, never negative", estimateTimeSaved(s, 2, 9) === null);
      check("no observable rate -> no estimate", estimateTimeSaved(session([individual(0, "a")]), 100, 1) === null);
      check("a null session -> no estimate", estimateTimeSaved(null, 100, 1) === null);
    }

    console.log("  the unit ladder, including promotion at the boundaries");
    {
      // One unit avoided at a controlled pace lets totalSeconds be dialled
      // directly: rate = gap, units avoided = 1.
      const atPace = (secondsPerDecision: number, unitsAvoided: number) => {
        const s = session([
          individual(0, "a"),
          individual(secondsPerDecision, "b"),
          individual(secondsPerDecision * 2, "c"),
          individual(secondsPerDecision * 3, "d"),
        ]);
        return estimateTimeSaved(s, unitsAvoided + 4, 4)!;
      };
      const ladder: [number, number, string, string][] = [
        [30, 2, "minutes", "1.0"], //      60s
        [60, 60, "hours", "1.0"], //     3600s
        [60, 1440, "days", "1.0"], //   86400s
        [60, 10080, "weeks", "1.0"], // 604800s
        [120, 262800, "years", "1.0"], // 31,536,000s
      ];
      for (const [pace, units, unit, display] of ladder) {
        const e = atPace(pace, units);
        check(`${units} units at ${pace}s -> ${display} ${unit}`, e.unit === unit && e.display === display, `${e.display} ${e.unit}`);
      }
      // 3,599s must promote to "1.0 hours", never read "60.0 minutes".
      const boundary = atPace(1, 3599);
      check("3,599 seconds promotes to hours rather than reading 60.0 minutes", boundary.unit === "hours" && boundary.display === "1.0", `${boundary.display} ${boundary.unit}`);
    }

    console.log("  the plain-language explanation is generated from the same figures");
    {
      const s = session([individual(0, "a"), individual(10, "b"), individual(20, "c"), individual(30, "d")]);
      const e = estimateTimeSaved(s, 100, 4)!;
      const paragraphs = explainTimeSaved(e);
      check("three short paragraphs", paragraphs.length === 3);
      check("names the measured pace and its sample size", paragraphs[0]!.includes("10 seconds") && paragraphs[0]!.includes("3"), paragraphs[0]);
      check("names the units avoided and the resulting figure", paragraphs[1]!.includes("96") && paragraphs[1]!.includes("16.0 minutes"), paragraphs[1]);
      check("states the direction of the error rather than hiding it", /larger/.test(paragraphs[2]!) && /cautious/.test(paragraphs[2]!), paragraphs[2]);
      check("claims no time was 'saved' -- only that work was avoided", !/\bsaved\b/i.test(paragraphs.join(" ")));
      check("makes no productivity or money claim", !paragraphs.join(" ").match(/productiv|efficien|\$|cost|faster/i));
    }
  }

  console.log("--- global strip values ---");
  {
    const global = decisionReduction(resolvedCandidatesOf(dispatcher.getState()));
    const avoidedLabel = global.avoidedDecisionCount.toLocaleString();
    const percentLabel = formatFewerDecisionsPercent(global);
    check("Avoided renders a grouped integer count", /^[\d.,  ]+$/.test(avoidedLabel), avoidedLabel);
    check("Fewer Decisions renders a whole percent", /^~?\d{1,3}%$/.test(percentLabel), percentLabel);
    check("the strip's percent never exceeds 100", Math.round(global.fewerDecisionPercent) <= 100);
    check("the strip shows figures even though local suppression exists", global.avoidedDecisionCount >= 0);
  }

  console.log("--- local figures: scoped to what REMAINS, shrinking to nothing ---");
  {
    // A fresh workspace, since `dispatcher`'s document is fully reviewed --
    // which is itself the first thing to assert.
    const finished = remainingCandidatesOf(dispatcher.getState());
    check("a fully-reviewed surface has an empty remaining scope", finished.length === 0);
    check("so its local figure is suppressed entirely", shouldDisplayReduction(decisionReduction(finished)) === false);

    const local = new ReviewWorkspace({ clock: () => new Date().toISOString(), sessionRepository: new InMemorySessionRepository() });
    const localDispatcher = new WorkspaceCommandDispatcher(local);
    await localDispatcher.dispatchApplication({ family: "document", type: "load", file: new File([bytes], "synthetic_entity_resolution.docx") });
    const section = localDispatcher.getState().detection!.candidates.slice(0, 20);
    const remainingOf = (ids: readonly string[]) => {
      const remaining = new Set(remainingCandidatesOf(localDispatcher.getState()).map((c) => c.id));
      return section.filter((c) => ids.includes(c.id) && remaining.has(c.id));
    };
    const sectionIds = section.map((c) => c.id);
    const first = decisionReduction(remainingOf(sectionIds));
    check("a fresh section's figure covers all of it", first.decisionUnitCount === section.length);
    // Resolve part of the section: the figure must shrink, not grow.
    localDispatcher.dispatchReview({ family: "review", type: "bulkApplyDecision", candidateIds: sectionIds.slice(0, 8), decision: "Keep" });
    const second = decisionReduction(remainingOf(sectionIds));
    check("after deciding 8, the local scope holds 8 fewer units", second.decisionUnitCount === first.decisionUnitCount - 8);
    check("and covers strictly fewer occurrences", second.occurrenceCount < first.occurrenceCount);
    // Finish it: the figure disappears.
    localDispatcher.dispatchReview({ family: "review", type: "bulkApplyDecision", candidateIds: sectionIds, decision: "Keep" });
    check("finishing the section empties its scope", decisionReduction(remainingOf(sectionIds)).decisionUnitCount === 0);
    check("and suppresses the figure rather than showing 0 / 0", shouldDisplayReduction(decisionReduction(remainingOf(sectionIds))) === false);
  }

  console.log("--- local equation text over real review scopes ---");
  {
    const candidateUnits = (ids: readonly string[]): ReviewUnit[] => {
      const wanted = new Set(ids);
      return candidates.filter((c) => wanted.has(c.id));
    };
    const multiOccurrence = candidates.filter((c) => c.occurrenceIds.length > 1);
    if (multiOccurrence.length === 0) {
      check("fixture has multi-occurrence candidates to form a real local scope", false);
    } else {
      const scope = candidateUnits(multiOccurrence.map((c) => c.id));
      const r = decisionReduction(scope);
      check("a real local scope reports reduction", shouldDisplayReduction(r) === true);
      check(
        "its equation matches the model exactly",
        formatReductionEquation(r) ===
          `${r.decisionUnitCount.toLocaleString()} / ${r.occurrenceCount.toLocaleString()} = ${r.avoidedDecisionCount.toLocaleString()} decisions avoided`
      );
    }
    // The suppression case the rule exists for, from real data.
    const singles = candidates.filter((c) => c.occurrenceIds.length === 1);
    if (singles.length === 0) {
      console.log("  NOTE fixture has no single-occurrence candidate; 1/1 suppression covered synthetically in PART 1");
    } else {
      const single = decisionReduction(candidateUnits([singles[0]!.id]));
      check("a single-occurrence item really does produce 1 / 1 = 0", single.decisionUnitCount === 1 && single.occurrenceCount === 1 && single.avoidedDecisionCount === 0);
      check("and is suppressed rather than rendered", shouldDisplayReduction(single) === false);
      const allSingles = decisionReduction(candidateUnits(singles.map((c) => c.id)));
      check("a scope of nothing but single-occurrence items is suppressed too", shouldDisplayReduction(allSingles) === false);
    }
  }

  console.log(`\n${passCount}/${passCount + failCount} checks passed`);
  process.exitCode = failCount === 0 ? 0 : 1;
}

await main();
