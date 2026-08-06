/**
 * item-check-work-queue-verification.ts -- "Item Check shows remaining
 * work" (AG, 2026-08-02).
 *
 * THE RULE UNDER TEST: Item Check's pool is the WORK QUEUE -- unresolved
 * candidates only -- so a candidate leaves the moment it is resolved,
 * whether that happened here, in Ambiguity Check, or through a Group Check
 * bulk action, and returns if the decision is undone. Counts are
 * deliberately NOT narrowed: the tab keeps reporting progress against
 * everything detected.
 *
 * WHAT THIS SUITE IS REALLY GUARDING. The rule is one line; the things
 * that can quietly break it are not:
 *   1. Reappearance must need no invalidation step. Every removal here is
 *      a derivation over ReviewSession, so undo restores the row for free
 *      -- but only for as long as nobody caches the queue. Test 4 fails
 *      the moment somebody does.
 *   2. The denominator must stay the full inventory. Counting the queue
 *      instead makes every stage read (N/N) forever and silently destroys
 *      the progress signal -- a change that breaks nothing structurally
 *      and would otherwise ship unnoticed. Test 5.
 *   3. Group Check must NOT be narrowed the same way. A decided group row
 *      carries its own outcome label; retiring it would delete the result
 *      rather than the work. Test 6.
 *   4. The escape hatch must actually fire, or "Ignored"/"Changed"/
 *      "Redacted" become three permanently-empty controls and search
 *      starts reporting decided entities as nonexistent. Test 7.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/item-check-work-queue-verification.ts
 */

import { OoxmlDocumentParser } from "../src/io/DocumentParser.ts";
import { RegexDetectionEngine } from "../src/engines/DetectionEngine.ts";
import { RegexCandidateQualityEngine, buildDefaultScoringProfileSnapshot } from "../src/engines/CandidateQualityEngine.ts";
import { RegexEntityResolutionEngine } from "../src/engines/EntityResolutionEngine.ts";
import { RegexOccurrenceClassifier } from "../src/engines/OccurrenceClassifier.ts";
import { DurableReviewEngine } from "../src/engines/ReviewEngine.ts";
import { createReviewSession } from "../src/engines/review/session.ts";
import { itemIdsForStage, reviewableItemIdsForStage, isItemResolved, computeStageStatus } from "../src/engines/navigation/stages.ts";
import { resolvedStatusOf } from "../src/domain/ReviewSession.ts";
import { createDefaultQueryState, queryRequestsDecidedItems, type FilterPreset } from "../src/ui/itemCheckQuery.ts";
import { loadSourceFile } from "./fixture-io.ts";

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

function makeFixedClock(): () => string {
  let tick = 0;
  return () => {
    tick += 1;
    return `2026-08-02T00:00:${String(tick % 60).padStart(2, "0")}.${String(Math.floor(tick / 60)).padStart(3, "0")}Z`;
  };
}

async function main(): Promise<void> {
  const file = loadSourceFile("entity-resolution-001");
  const model = await new OoxmlDocumentParser().parse(file);
  const detection = new RegexDetectionEngine().detect(model);
  const quality = new RegexCandidateQualityEngine().evaluate(model, detection, buildDefaultScoringProfileSnapshot("2026-08-02T00:00:00.000Z"));
  const grouping = new RegexEntityResolutionEngine().propose(detection, quality);
  const classification = new RegexOccurrenceClassifier().classify(model, detection, quality, grouping);
  const context = { detection, grouping, classification };
  const freshSession = () => createReviewSession("s", "doc-under-test", "2026-08-02T00:00:01.000Z");

  console.log("--- 1. A fresh document: the queue IS the inventory ---");
  {
    const session = freshSession();
    const queue = reviewableItemIdsForStage("item-check", context, session);
    const all = itemIdsForStage("item-check", context);
    check("nothing decided yet, so nothing is retired", queue.length === all.length && all.length > 0, `${queue.length}/${all.length}`);
    check("queue preserves the structural order it narrows", queue.join(",") === all.join(","));
  }

  console.log("--- 2. Deciding one candidate retires exactly that candidate ---");
  {
    const session = freshSession();
    const engine = new DurableReviewEngine(detection, grouping, session, makeFixedClock());
    const target = itemIdsForStage("item-check", context)[0]!;
    const before = reviewableItemIdsForStage("item-check", context, engine.getState()).length;
    const res = engine.dispatch({ family: "review", type: "keepCandidate", candidateId: target });
    check("decision dispatched cleanly", res.ok === true, res.ok ? "" : res.reason);
    const queue = reviewableItemIdsForStage("item-check", context, engine.getState());
    check("the decided candidate is gone from the queue", !queue.includes(target));
    check("exactly one candidate left the queue", queue.length === before - 1, `${queue.length} vs ${before - 1}`);
    check(
      "every id still in the queue is genuinely unresolved",
      queue.every((id) => !isItemResolved("item-check", id, context, engine.getState()))
    );
    check("the candidate still EXISTS -- retired from the queue, not deleted", itemIdsForStage("item-check", context).includes(target));
  }

  console.log("--- 3. A Group Check bulk action retires every member ---");
  {
    const session = freshSession();
    const engine = new DurableReviewEngine(detection, grouping, session, makeFixedClock());
    const group = grouping.entityGroupProposals.find((g) => g.candidateIds.length > 1) ?? grouping.entityGroupProposals[0]!;
    const before = reviewableItemIdsForStage("item-check", context, engine.getState()).length;
    const res = engine.dispatch({ family: "review", type: "confirmGroup", groupId: group.groupId });
    check("confirmGroup dispatched cleanly", res.ok === true, res.ok ? "" : res.reason);
    const queue = reviewableItemIdsForStage("item-check", context, engine.getState());
    check(
      "no member of the confirmed group remains in Item Check's queue",
      group.candidateIds.every((id) => !queue.includes(id)),
      group.candidateIds.filter((id) => queue.includes(id)).join(",")
    );
    check("the queue shrank by exactly the group's size", queue.length === before - group.candidateIds.length, `${before} -> ${queue.length}, group=${group.candidateIds.length}`);
    check("non-members are untouched", queue.every((id) => !group.candidateIds.includes(id)) && queue.length > 0);
  }

  console.log("--- 4. Reappearance is free: the queue is a pure function of the session ---");
  {
    // ReviewSession is immutable, so the session value from BEFORE the
    // group decision is exactly the value undo (or a reverted import, or
    // a reloaded save file) restores. Asking the queue about that value
    // and getting the original list back is the property that makes
    // reappearance need no invalidation step at all -- and it is the check
    // that fails the day somebody memoizes this.
    const session = freshSession();
    const engine = new DurableReviewEngine(detection, grouping, session, makeFixedClock());
    const group = grouping.entityGroupProposals.find((g) => g.candidateIds.length > 1) ?? grouping.entityGroupProposals[0]!;
    const sessionBefore = engine.getState();
    const baseline = reviewableItemIdsForStage("item-check", context, sessionBefore);
    engine.dispatch({ family: "review", type: "confirmGroup", groupId: group.groupId });
    const shrunk = reviewableItemIdsForStage("item-check", context, engine.getState());
    check("queue shrank first", shrunk.length < baseline.length, `${baseline.length} -> ${shrunk.length}`);
    check("the pre-decision session was not mutated by the dispatch", Object.keys(sessionBefore.groupDecisions).length === 0);
    const restored = reviewableItemIdsForStage("item-check", context, sessionBefore);
    check(
      "every retired member is back, in its original position -- nothing cached, nothing to invalidate",
      restored.join(",") === baseline.join(","),
      `${restored.length} vs ${baseline.length}`
    );
    check("and the members specifically are present again", group.candidateIds.every((id) => restored.includes(id)));
  }

  console.log("--- 5. Counts still report progress against the FULL inventory ---");
  {
    const session = freshSession();
    const engine = new DurableReviewEngine(detection, grouping, session, makeFixedClock());
    const totalDetected = detection.candidates.length;
    const before = computeStageStatus("item-check", context, engine.getState());
    check("denominator starts at everything detected", before.itemCount === totalDetected, `${before.itemCount} vs ${totalDetected}`);
    const group = grouping.entityGroupProposals.find((g) => g.candidateIds.length > 1) ?? grouping.entityGroupProposals[0]!;
    engine.dispatch({ family: "review", type: "confirmGroup", groupId: group.groupId });
    const after = computeStageStatus("item-check", context, engine.getState());
    check("denominator does NOT shrink with the queue -- it is the progress signal", after.itemCount === totalDetected, `${after.itemCount} vs ${totalDetected}`);
    check("numerator drops by the work actually completed", after.unresolvedCount === before.unresolvedCount - group.candidateIds.length, `${before.unresolvedCount} -> ${after.unresolvedCount}`);
    check(
      "unresolvedCount still equals the queue length -- the two views agree on what is left",
      after.unresolvedCount === reviewableItemIdsForStage("item-check", context, engine.getState()).length
    );
  }

  console.log("--- 6. Only Item Check is narrowed ---");
  {
    const session = freshSession();
    const engine = new DurableReviewEngine(detection, grouping, session, makeFixedClock());
    const group = grouping.entityGroupProposals.find((g) => g.candidateIds.length > 1) ?? grouping.entityGroupProposals[0]!;
    engine.dispatch({ family: "review", type: "confirmGroup", groupId: group.groupId });
    const state = engine.getState();
    for (const stage of ["ambiguity-check", "group-check", "type-check", "qa", "output"] as const) {
      check(
        `${stage} is returned unchanged (a decided group row still carries its own outcome)`,
        reviewableItemIdsForStage(stage, context, state).join(",") === itemIdsForStage(stage, context).join(",")
      );
    }
    check("the decided group is still present in Group Check", reviewableItemIdsForStage("group-check", context, state).includes(group.groupId));
  }

  console.log("--- 7. The escape hatch: decided work stays reachable ---");
  {
    const base = createDefaultQueryState();
    check("a plain default query asks for remaining work only", queryRequestsDecidedItems(base) === false);
    check("search text widens the pool -- searchability remains intact", queryRequestsDecidedItems({ ...base, searchText: "Jackson" }) === true);
    check("whitespace-only search does NOT widen it", queryRequestsDecidedItems({ ...base, searchText: "   " }) === false);
    for (const preset of ["ignored", "renamed", "redacted"] as FilterPreset[]) {
      check(`the "${preset}" preset widens the pool (otherwise it could never match anything)`, queryRequestsDecidedItems({ ...base, activePresets: new Set([preset]) }) === true);
    }
    for (const preset of ["unreviewed", "high-confidence", "ambiguous", "people", "organizations"] as FilterPreset[]) {
      check(`the "${preset}" preset does NOT widen it`, queryRequestsDecidedItems({ ...base, activePresets: new Set([preset]) }) === false);
    }
  }

  console.log("--- 8. Occurrence-level safety: partial coverage is never 'resolved' ---");
  {
    // Guarded at the pure-function level the queue rule keys on. A
    // candidate whose occurrences a group covered only PARTLY must never
    // read "resolved", because retiring it would drop the uncovered
    // occurrences out of review entirely -- a false negative reaching a
    // released document, the one error class worth paying for here.
    const partial = resolvedStatusOf(["o1", "o2", "o3"], new Set(["o1", "o2"]), false);
    check("partial coverage reports 'partially-resolved', not 'resolved'", partial.status === "partially-resolved", partial.status);
    check("it reports the uncovered remainder honestly", partial.unresolvedOccurrenceCount === 1, String(partial.unresolvedOccurrenceCount));
    const full = resolvedStatusOf(["o1", "o2"], new Set(["o1", "o2"]), false);
    check("full coverage with no direct decision DOES resolve", full.status === "resolved");
    const none = resolvedStatusOf(["o1"], new Set(), false);
    check("no coverage and no decision stays unresolved", none.status === "unresolved");
  }

  console.log(`\n${passCount}/${passCount + failCount} checks passed`);
  process.exitCode = failCount === 0 ? 0 : 1;
}

await main();
