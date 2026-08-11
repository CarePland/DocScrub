/**
 * type-check-full-retirement-verification.ts -- widen Type Check's active-
 * population retirement boundary (AG, 2026-08-11, follow-up to the
 * 2026-08-10 "Covered by group" cleanup): after a hard reload, a member
 * that is INDIVIDUALLY resolved (a direct decision -- not still marked
 * "Covered by group") kept rendering as an active row in Type Check's
 * member list, because `typeCheckSummaries()` (app.ts) only excluded
 * `isRetiredByGroupCoverage()` candidates (group coverage, no direct
 * decision) -- see group-coverage-retirement-verification.ts. The fix
 * widens that ONE exclusion in app.ts from `isRetiredByGroupCoverage` to
 * `isItemResolvedInState("item-check", id, state)` -- the SAME domain
 * resolved predicate already authoritative for Item Check's own work queue,
 * `reconcile()`'s advance, and the Decision Tracker (see this file's own
 * "ONE 'IS THIS CANDIDATE FINISHED' TEST" comment in app.ts). No second
 * rule was introduced; this suite exists because app.ts itself has zero
 * exports and cannot be unit-tested (see the 2026-08-08 forensic audit) --
 * it pins the SAME underlying predicate `typeCheckSummaries()` now calls,
 * against every case the migration brief's verify list asks for:
 *
 *   1. a directly decided member retires (the case that was NOT retiring
 *      before this change -- the actual bug);
 *   2. a group-covered member (no direct decision) retires -- unchanged
 *      from the 2026-08-10 pass, reproduced here as a regression guard;
 *   3. an unresolved member does not retire;
 *   4. resetting a direct decision (the real `resetDecisions` command)
 *      makes the member eligible again -- nothing is stored, so this falls
 *      out of "derive, never cache" rather than needing new invalidation
 *      logic, but it is worth proving rather than assuming;
 *   5. the same "derive fresh" property for group coverage specifically:
 *      the predicate reads live groupDecisions, so a member's retirement
 *      is not sticky once its covering group decision is gone -- tested as
 *      a state property of the predicate itself, since no dedicated
 *      "un-confirm a group" command exists to drive it through end-to-end
 *      (resetDecisions only clears entries in candidateDecisions -- see
 *      test 6 below for the honest boundary of what it can and cannot
 *      reach);
 *   6. resetDecisions is a no-op on a group-covered-only member -- it has
 *      no candidateDecisions entry to clear, so "makes it eligible again"
 *      for THAT case requires undoing the group's own decision, not this
 *      command -- documented rather than silently assumed.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/type-check-full-retirement-verification.ts
 */

import { OoxmlDocumentParser } from "../src/io/DocumentParser.ts";
import { RegexDetectionEngine } from "../src/engines/DetectionEngine.ts";
import { RegexCandidateQualityEngine, buildDefaultScoringProfileSnapshot } from "../src/engines/CandidateQualityEngine.ts";
import { RegexEntityResolutionEngine } from "../src/engines/EntityResolutionEngine.ts";
import { DurableReviewEngine } from "../src/engines/ReviewEngine.ts";
import { createReviewSession } from "../src/engines/review/session.ts";
import { isItemResolved } from "../src/engines/navigation/stages.ts";
import { isRetiredByGroupCoverage } from "../src/engines/review/coverage.ts";
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
    return `2026-08-11T00:00:${String(tick % 60).padStart(2, "0")}.${String(Math.floor(tick / 60)).padStart(3, "0")}Z`;
  };
}

async function main(): Promise<void> {
  const file = loadSourceFile("entity-resolution-001");
  const model = await new OoxmlDocumentParser().parse(file);
  const detection = new RegexDetectionEngine().detect(model);
  const quality = new RegexCandidateQualityEngine().evaluate(model, detection, buildDefaultScoringProfileSnapshot("2026-08-11T00:00:00.000Z"));
  const grouping = new RegexEntityResolutionEngine().propose(detection, quality);
  const context = { detection, grouping };

  console.log("--- 1/3. The three population states, over the SAME predicate typeCheckSummaries() now calls ---");
  {
    const clock = makeFixedClock();
    const session = createReviewSession("s-basic", "doc-under-test", clock());
    const engine = new DurableReviewEngine(detection, grouping, session, clock);
    const [unresolvedId, directId] = detection.candidates.map((c) => c.id);
    check("fixture precondition: at least two candidates available", !!unresolvedId && !!directId);

    check("unresolved candidate: NOT retired (isItemResolved false)", isItemResolved("item-check", unresolvedId!, context, engine.getState()) === false);

    engine.dispatch({ family: "review", type: "keepCandidate", candidateId: directId! });
    const afterDirect = engine.getState();
    check(
      "1a. a DIRECTLY decided member retires -- the actual bug this pass fixes: isItemResolved is now true, and it was NOT the case that only group coverage produced this",
      isItemResolved("item-check", directId!, context, afterDirect) === true
    );
    check(
      "...and confirm the OLD, narrower predicate would have wrongly kept it in the active population (this is exactly the gap widened)",
      isRetiredByGroupCoverage(afterDirect, detection, directId!) === false,
      "isRetiredByGroupCoverage correctly excludes direct decisions from ITS OWN narrower meaning -- typeCheckSummaries no longer calls it alone"
    );
  }

  console.log("--- 2/3. Group-covered member (no direct decision) still retires -- regression guard on the 2026-08-10 behavior ---");
  {
    const clock = makeFixedClock();
    const session = createReviewSession("s-covered", "doc-under-test", clock());
    const engine = new DurableReviewEngine(detection, grouping, session, clock);
    const group = grouping.entityGroupProposals.find((g) => g.candidateIds.length >= 2);
    if (!group) {
      check("fixture provides a multi-member group", false, "none found -- re-check the fixture before trusting anything below");
    } else {
      engine.dispatch({ family: "review", type: "enterNotQuite", groupId: group.groupId } as never);
      const decidedMember = group.candidateIds[0]!;
      const carriedMember = group.candidateIds[1]!;
      engine.dispatch({ family: "review", type: "keepCandidate", candidateId: decidedMember } as never);
      const completed = engine.dispatch({ family: "review", type: "completeNotQuite", groupId: group.groupId } as never);
      check("Not Quite completes on the fixture's group", completed.ok);
      const after = engine.getState();

      check("the carried member has no direct CandidateDecision of its own", !after.candidateDecisions[carriedMember]);
      check(
        "2a. the group-covered (carried) member retires -- isItemResolved is true purely via group coverage",
        isItemResolved("item-check", carriedMember, context, after) === true
      );
      check(
        "2b. isRetiredByGroupCoverage (the narrower predicate) agrees for this specific case -- both routes to retirement land on the same member here",
        isRetiredByGroupCoverage(after, detection, carriedMember) === true
      );
    }
  }

  console.log("--- 3/3. Reset makes a member eligible again -- 'nothing is stored' proven, not assumed ---");
  {
    const clock = makeFixedClock();
    const session = createReviewSession("s-reset", "doc-under-test", clock());
    const engine = new DurableReviewEngine(detection, grouping, session, clock);
    const directId = detection.candidates[0]!.id;

    engine.dispatch({ family: "review", type: "keepCandidate", candidateId: directId });
    check("precondition: candidate is resolved after a direct decision", isItemResolved("item-check", directId, context, engine.getState()) === true);

    const resetOutcome = engine.dispatch({ family: "review", type: "resetDecisions", candidateIds: [directId], scope: "zone" });
    check("resetDecisions succeeds against a directly decided candidate", resetOutcome.ok === true, resetOutcome.ok ? "" : resetOutcome.reason);
    const afterReset = engine.getState();
    check("...the direct decision is actually gone", !(directId in afterReset.candidateDecisions));
    check(
      "3a. RESET MAKES IT ELIGIBLE AGAIN: isItemResolved flips back to false with no other change -- typeCheckSummaries will render this row again on the very next call, with no cache to invalidate",
      isItemResolved("item-check", directId, context, afterReset) === false
    );

    // The honest boundary: resetDecisions clears candidateDecisions entries
    // only (see session.ts's resetDecisionBatch, which requires
    // `candidateId in candidateDecisions`) -- it cannot reach a
    // group-covered-but-undecided member, because that member never had an
    // entry there to clear.
    const group = grouping.entityGroupProposals.find((g) => g.candidateIds.length >= 2);
    if (group) {
      const engine2 = new DurableReviewEngine(detection, grouping, createReviewSession("s-reset-2", "doc-under-test", clock()), clock);
      engine2.dispatch({ family: "review", type: "enterNotQuite", groupId: group.groupId } as never);
      const decidedMember = group.candidateIds[0]!;
      const carriedMember = group.candidateIds[1]!;
      engine2.dispatch({ family: "review", type: "keepCandidate", candidateId: decidedMember } as never);
      engine2.dispatch({ family: "review", type: "completeNotQuite", groupId: group.groupId } as never);
      const beforeAttempt = engine2.getState();
      check("precondition: the carried member is retired via group coverage only", isItemResolved("item-check", carriedMember, context, beforeAttempt) === true && !beforeAttempt.candidateDecisions[carriedMember]);
      const attempt = engine2.dispatch({ family: "review", type: "resetDecisions", candidateIds: [carriedMember], scope: "zone" });
      check(
        "3b. resetDecisions REFUSES on a group-covered-only member (nothing to reset there) -- 'eligible again' for this case is a property of the group decision, not this command",
        attempt.ok === false,
        `ok=${attempt.ok}`
      );
      check("...and it remains retired (unchanged) after the refused attempt", isItemResolved("item-check", carriedMember, context, engine2.getState()) === true);

      // The predicate itself, proven live, not assumed: with the covering
      // group decision removed from session state, the SAME candidate,
      // SAME occurrences, is unresolved again -- this is what "derive,
      // never cache" guarantees will happen automatically once the
      // reviewer's own action (e.g. exiting/undoing a confirmed group
      // through whatever product surface offers that) removes the
      // covering decision; no separate invalidation path is required.
      const withoutGroupDecision = { ...beforeAttempt, groupDecisions: {} };
      check(
        "3c. removing the covering group decision from session state alone flips the SAME predicate back to unresolved -- confirms retirement is never sticky",
        isItemResolved("item-check", carriedMember, context, withoutGroupDecision) === false
      );
    }
  }

  console.log(`\n${passCount}/${passCount + failCount} checks passed`);
  process.exitCode = failCount === 0 ? 0 : 1;
}

await main();
