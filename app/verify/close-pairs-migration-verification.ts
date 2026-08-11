/**
 * close-pairs-migration-verification.ts -- Close Pairs migration (AG,
 * 2026-08-10): Group Check is no longer a top-level workflow stage; its
 * population reviews inside Ambiguity Check as the "Close Pairs" category.
 * Boundary coverage for the parts of that migration that live below
 * `src/ui/app.ts` (which has zero exports and cannot be imported by any
 * test -- see the 2026-08-08 forensic audit; this file does not attempt to
 * close that pre-existing gap, only to cover the new domain-layer behavior
 * this migration adds on top of it):
 *
 *   1. navigation/workflow.ts -- the TWO-PREDICATE split:
 *      `activeWorkflowStages` (valid RESTING stages -- group-check stays a
 *      member on its own merits, and ambiguity-check's own membership now
 *      ALSO reflects group-check's population) vs `navigableWorkflowStages`
 *      (top-level NAVIGATION stops -- group-check is never a member).
 *   2. navigation/stages.ts -- `combineAmbiguityAndGroupStatus` /
 *      `ambiguityDisplayStatus`: additive raw-unit composition, not a
 *      blended percentage (see that function's own doc comment).
 *   3. navigation/navigator.ts -- `createInitialFocusState` and `moveStage`
 *      now route through `navigableWorkflowStages` (never land ON
 *      group-check); `reconcile()` still uses `activeWorkflowStages`
 *      unchanged, so a reviewer resting in Ambiguity Check is not evicted
 *      onward while Close Pairs work remains, and a reviewer resting IN
 *      group-check (Close Pairs) is not evicted just because it lost its
 *      tab.
 *   4. The progression matrix from the migration brief's §12: ordinary
 *      Ambiguity crossed with Close Pairs, all six combinations.
 *   5. Persisted `stage: "group-check"` resume positions.
 *
 * "Existing Group Check behavior preserved" (focused group, remaining
 * cells, Separate these/Use/Source, K/C/R/I/F, member expansion, sorting)
 * is NOT re-tested here: renderGroupStage, groupRovingFocus, and
 * keymap.ts's group-check block were not modified by this migration (they
 * still key on `FocusTarget.stage === "group-check"`, unchanged), and
 * group-check-revision-verification.ts / group-bulk-actions-verification.ts
 * already cover that machinery -- both still pass unmodified.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/close-pairs-migration-verification.ts
 */

import { OoxmlDocumentParser } from "../src/io/DocumentParser.ts";
import { RegexDetectionEngine } from "../src/engines/DetectionEngine.ts";
import { RegexCandidateQualityEngine, buildDefaultScoringProfileSnapshot } from "../src/engines/CandidateQualityEngine.ts";
import { RegexEntityResolutionEngine } from "../src/engines/EntityResolutionEngine.ts";
import { RegexOccurrenceClassifier } from "../src/engines/OccurrenceClassifier.ts";
import { DurableReviewEngine } from "../src/engines/ReviewEngine.ts";
import { createReviewSession } from "../src/engines/review/session.ts";
import { DeterministicFocusNavigator } from "../src/engines/FocusNavigator.ts";
import { ambiguityDisplayStatus, combineAmbiguityAndGroupStatus, computeStageStatus } from "../src/engines/navigation/stages.ts";
import { activeWorkflowStages, navigableWorkflowStages, isStageActive } from "../src/engines/navigation/workflow.ts";
import { createInitialFocusState, restoreFocusState, reconcile } from "../src/engines/navigation/navigator.ts";
import type { FocusState } from "../src/domain/FocusState.ts";
import type { DetectionGroupingContext } from "../src/engines/DetectionGroupingContext.ts";
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
    return `2026-08-10T00:00:${String(tick % 60).padStart(2, "0")}.${String(Math.floor(tick / 60)).padStart(3, "0")}Z`;
  };
}

async function main(): Promise<void> {
  // Real pipeline output -- entity-resolution-001 has BOTH ambiguity
  // proposals and entity groups (same fixture workflow-navigation-
  // verification.ts uses), so every scenario below is built by SELECTIVELY
  // emptying one axis or the other from real detection/grouping output,
  // never by hand-authoring synthetic candidates.
  const file = loadSourceFile("entity-resolution-001");
  const model = await new OoxmlDocumentParser().parse(file);
  const detection = new RegexDetectionEngine().detect(model);
  const quality = new RegexCandidateQualityEngine().evaluate(model, detection, buildDefaultScoringProfileSnapshot("2026-08-10T00:00:00.000Z"));
  const grouping = new RegexEntityResolutionEngine().propose(detection, quality);
  const classification = new RegexOccurrenceClassifier().classify(model, detection, quality, grouping);
  const context: DetectionGroupingContext = { detection, grouping, classification };

  check("fixture precondition: has ambiguity proposals", grouping.ambiguityProposals.length > 0, `${grouping.ambiguityProposals.length}`);
  check("fixture precondition: has entity groups", grouping.entityGroupProposals.length > 0, `${grouping.entityGroupProposals.length}`);

  // Zero-Close-Pairs context: real ambiguity proposals, no groups at all.
  const onlyAmbiguity: DetectionGroupingContext = { ...context, grouping: { ...grouping, entityGroupProposals: [] } };
  // Zero-ordinary-ambiguity context: real groups, no ambiguity proposals.
  const onlyGroups: DetectionGroupingContext = { ...context, grouping: { ...grouping, ambiguityProposals: [] } };

  console.log("--- combineAmbiguityAndGroupStatus / ambiguityDisplayStatus: additive raw counts ---");
  {
    const session = createReviewSession("s-combine", "doc-under-test", "2026-08-10T00:00:01.000Z");
    const ambiguity = computeStageStatus("ambiguity-check", context, session);
    const closePairs = computeStageStatus("group-check", context, session);
    const combined = combineAmbiguityAndGroupStatus(ambiguity, closePairs);
    check("combined itemCount is the raw sum", combined.itemCount === ambiguity.itemCount + closePairs.itemCount);
    check("combined unresolvedCount is the raw sum", combined.unresolvedCount === ambiguity.unresolvedCount + closePairs.unresolvedCount);
    check("combined stage identity stays 'ambiguity-check'", combined.stage === "ambiguity-check");
    check("artifact figures come from ambiguity alone (group-check has none)", combined.artifactCount === ambiguity.artifactCount && combined.unresolvedArtifactCount === ambiguity.unresolvedArtifactCount);
    check("ambiguityDisplayStatus(context, session) matches the manual combine", JSON.stringify(ambiguityDisplayStatus(context, session)) === JSON.stringify(combined));

    // Zero Close Pairs: the combined status must read IDENTICALLY to plain
    // ambiguity-check status -- folding in "nothing" changes nothing.
    const bareAmbiguity = computeStageStatus("ambiguity-check", onlyAmbiguity, session);
    const bareClosePairs = computeStageStatus("group-check", onlyAmbiguity, session);
    check("zero groups: closePairs status reads 'empty'", bareClosePairs.completion === "empty" && bareClosePairs.itemCount === 0);
    check(
      "zero groups: combined status equals plain ambiguity-check status",
      JSON.stringify(combineAmbiguityAndGroupStatus(bareAmbiguity, bareClosePairs)) === JSON.stringify(bareAmbiguity)
    );

    // Resolve every ordinary ambiguity item; groups remain untouched.
    const engine = new DurableReviewEngine(detection, grouping, session, makeFixedClock());
    const ambiguityIds = grouping.ambiguityProposals.map((p) => p.candidateId);
    engine.dispatch({ family: "review", type: "bulkApplyDecision", candidateIds: ambiguityIds, decision: "Keep" });
    const ambiguityDone = computeStageStatus("ambiguity-check", context, engine.getState());
    const groupsStillOpen = computeStageStatus("group-check", context, engine.getState());
    check("ordinary ambiguity items all resolved", ambiguityDone.unresolvedCount === 0, `${ambiguityDone.unresolvedCount}`);
    check("groups remain unresolved", groupsStillOpen.unresolvedCount > 0, `${groupsStillOpen.unresolvedCount}`);
    const stillCombined = combineAmbiguityAndGroupStatus(ambiguityDone, groupsStillOpen);
    check(
      "combined completion is 'unresolved' when ordinary ambiguity is done but Close Pairs isn't (the case the brief's §6 warns about)",
      stillCombined.completion === "unresolved",
      stillCombined.completion
    );
    check("combined unresolvedCount equals Close Pairs' alone in this state", stillCombined.unresolvedCount === groupsStillOpen.unresolvedCount);
  }

  console.log("--- navigableWorkflowStages: Group Check is NEVER a top-level stop ---");
  {
    const session = createReviewSession("s-nav", "doc-under-test", "2026-08-10T00:00:01.000Z");
    check(
      "both axes have work: navigableWorkflowStages omits group-check, activeWorkflowStages includes it",
      !navigableWorkflowStages(context, session).includes("group-check") && activeWorkflowStages(context, session).includes("group-check")
    );
    check(
      "ambiguity-check is present in the navigable list (it has its own work here)",
      navigableWorkflowStages(context, session).includes("ambiguity-check")
    );

    // Zero ordinary ambiguity, groups exist -- ambiguity-check must STILL
    // be a navigable stop (the brief's explicit "zero ordinary ambiguity
    // but Close Pairs exist" case): the reviewer reaches Close Pairs
    // exclusively through the Ambiguity Check tab/category, so if the tab
    // vanished here Close Pairs would be unreachable.
    const onlyGroupsActive = navigableWorkflowStages(onlyGroups, session);
    check(
      "zero ordinary ambiguity + groups exist: ambiguity-check is STILL navigable",
      onlyGroupsActive.includes("ambiguity-check"),
      onlyGroupsActive.join(",")
    );
    check("...and group-check itself is still never a stop", !onlyGroupsActive.includes("group-check"));

    // Zero everything under Ambiguity Check (neither axis has work) --
    // ambiguity-check must NOT be navigable, same as before this migration.
    const bothEmptySession = createReviewSession("s-both-empty", "doc-under-test", "2026-08-10T00:00:01.000Z");
    const engineBothEmpty = new DurableReviewEngine(detection, grouping, bothEmptySession, makeFixedClock());
    engineBothEmpty.dispatch({
      family: "review",
      type: "bulkApplyDecision",
      candidateIds: [...new Set([...grouping.ambiguityProposals.map((p) => p.candidateId), ...grouping.entityGroupProposals.flatMap((g) => g.candidateIds)])],
      decision: "Keep",
    });
    const bothDoneActive = navigableWorkflowStages(context, engineBothEmpty.getState());
    check(
      "both ordinary ambiguity and Close Pairs fully resolved: ambiguity-check drops out of the navigable list",
      !bothDoneActive.includes("ambiguity-check"),
      bothDoneActive.join(",")
    );
  }

  console.log("--- createInitialFocusState / moveStage never land ON group-check ---");
  {
    // Zero ordinary ambiguity, groups exist: a fresh session must open
    // onto ambiguity-check (to reach Close Pairs), never group-check
    // directly and never skip past it to type-check.
    const session = createReviewSession("s-init", "doc-under-test", "2026-08-10T00:00:01.000Z");
    const initial = createInitialFocusState(onlyGroups, session);
    check("fresh session with only Close Pairs work lands on ambiguity-check, not group-check", initial.target.stage === "ambiguity-check", initial.target.stage);

    // moveStage next/previous, from every stage, never produces group-check.
    const nav = new DeterministicFocusNavigator(context, session);
    nav.dispatch({ family: "navigation", type: "focusStage", stage: "ambiguity-check" }, session);
    nav.dispatch({ family: "navigation", type: "moveStage", direction: "next" }, session);
    check("moveStage next from ambiguity-check skips group-check entirely", nav.getFocus().target.stage !== "group-check", nav.getFocus().target.stage);
    const navigable = navigableWorkflowStages(context, session);
    check(
      "...landing on the stage that actually follows ambiguity-check in the navigable list",
      nav.getFocus().target.stage === navigable[navigable.indexOf("ambiguity-check") + 1],
      nav.getFocus().target.stage
    );
    nav.dispatch({ family: "navigation", type: "focusStage", stage: "output" }, session);
    nav.dispatch({ family: "navigation", type: "moveStage", direction: "previous" }, session);
    check("moveStage previous, walking all the way back, still never lands on group-check", nav.getFocus().target.stage !== "group-check", nav.getFocus().target.stage);
  }

  console.log("--- reconcile(): resting in Ambiguity Check is not evicted while Close Pairs remains (the brief's §6) ---");
  {
    const clock = makeFixedClock();
    const session = createReviewSession("s-reconcile", "doc-under-test", clock());
    const engine = new DurableReviewEngine(detection, grouping, session, clock);
    const nav = new DeterministicFocusNavigator(context, engine.getState());
    nav.dispatch({ family: "navigation", type: "focusStage", stage: "ambiguity-check" }, engine.getState());

    // Resolve every ordinary ambiguity candidate in one dispatch (mirrors a
    // reviewer deciding their last row) -- groups are untouched.
    const ambiguityIds = grouping.ambiguityProposals.map((p) => p.candidateId);
    engine.dispatch({ family: "review", type: "bulkApplyDecision", candidateIds: ambiguityIds, decision: "Keep" });
    const focus = nav.reconcile(engine.getState());
    check(
      "deciding the last ordinary ambiguity item does NOT auto-advance past Ambiguity Check while Close Pairs is unresolved",
      focus.target.stage === "ambiguity-check",
      focus.target.stage
    );
    check(
      "...and item-check specifically was not silently reached",
      focus.target.stage !== "item-check" && focus.target.stage !== "type-check"
    );

    // Now also resolve every group. Reconcile should finally relocate
    // forward, since ambiguity-check (combined) is genuinely exhausted.
    const groupMemberIds = [...new Set(grouping.entityGroupProposals.flatMap((g) => g.candidateIds))];
    engine.dispatch({ family: "review", type: "bulkApplyDecision", candidateIds: groupMemberIds, decision: "Keep" });
    const focusAfterGroups = nav.reconcile(engine.getState());
    check(
      "once Close Pairs is ALSO resolved, reconcile finally relocates forward off ambiguity-check",
      focusAfterGroups.target.stage !== "ambiguity-check",
      focusAfterGroups.target.stage
    );
    check("...and never relocates TO group-check", focusAfterGroups.target.stage !== "group-check");
  }

  console.log("--- reconcile(): resting IN group-check (Close Pairs) is not evicted just because it lost its tab ---");
  {
    const clock = makeFixedClock();
    const session = createReviewSession("s-in-group", "doc-under-test", clock());
    const engine = new DurableReviewEngine(detection, grouping, session, clock);
    const nav = new DeterministicFocusNavigator(context, engine.getState());
    nav.dispatch({ family: "navigation", type: "focusStage", stage: "group-check" }, engine.getState());
    check("focusStage into group-check still lands there (it is a real WorkflowStage)", nav.getFocus().target.stage === "group-check", nav.getFocus().target.stage);
    const before = nav.getFocus().target.itemId;

    // Decide something ELSE (an ordinary ambiguity candidate) -- reconcile
    // runs after every dispatch. Resting focus inside group-check, itself
    // still unresolved, must not move.
    const otherCandidateId = grouping.ambiguityProposals[0]!.candidateId;
    engine.dispatch({ family: "review", type: "keepCandidate", candidateId: otherCandidateId });
    const focus = nav.reconcile(engine.getState());
    check("an unrelated decision elsewhere does not evict focus resting in group-check", focus.target.stage === "group-check", focus.target.stage);
    check("...and the specific group cursor is unchanged", focus.target.itemId === before);
  }

  console.log("--- Persisted stage: a stale 'group-check' resume position ---");
  {
    const session = createReviewSession("s-resume", "doc-under-test", "2026-08-10T00:00:01.000Z");
    const groupId = grouping.entityGroupProposals[0]!.groupId;

    // The group this position names still has unresolved work: it stays a
    // legitimate resting place (navigableWorkflowStages excludes it as a
    // DESTINATION, but activeWorkflowStages -- what reconcile checks --
    // still includes it on its own merits).
    const resumed: FocusState = restoreFocusState({ schemaVersion: 1, stage: "group-check", itemId: groupId, savedAt: "2026-08-10T00:00:02.000Z" }, context, session);
    check("a stale group-check resume position, still unresolved, resolves right back into group-check", resumed.target.stage === "group-check", resumed.target.stage);
    check("...naming the same group", resumed.target.itemId === groupId, `${resumed.target.itemId}`);

    // Now the same position, but every group is already resolved -- must
    // NOT strand the reviewer on (or crash resolving) a stage that no
    // longer has work, same graceful-degradation guarantee every other
    // stale resume position already has.
    const clock = makeFixedClock();
    const engine = new DurableReviewEngine(detection, grouping, createReviewSession("s-resume-2", "doc-under-test", clock()), clock);
    const groupMemberIds = [...new Set(grouping.entityGroupProposals.flatMap((g) => g.candidateIds))];
    engine.dispatch({ family: "review", type: "bulkApplyDecision", candidateIds: groupMemberIds, decision: "Keep" });
    const resumedAfterResolved: FocusState = restoreFocusState(
      { schemaVersion: 1, stage: "group-check", itemId: groupId, savedAt: "2026-08-10T00:00:03.000Z" },
      context,
      engine.getState()
    );
    check(
      "a stale group-check resume position, now resolved, relocates via the SAME rule as any other stale resume (never lands on group-check itself)",
      resumedAfterResolved.target.stage !== "group-check",
      resumedAfterResolved.target.stage
    );
    check(
      "...and lands on a genuinely active stage",
      activeWorkflowStages(context, engine.getState()).includes(resumedAfterResolved.target.stage)
    );
  }

  console.log("--- Progression matrix (migration brief §12) ---");
  {
    const scenarios: Array<{ label: string; ctx: DetectionGroupingContext; resolveAmbiguity: boolean; resolveGroups: boolean }> = [
      { label: "ordinary ambiguity unresolved + Close Pairs unresolved", ctx: context, resolveAmbiguity: false, resolveGroups: false },
      { label: "ordinary ambiguity complete + Close Pairs unresolved", ctx: context, resolveAmbiguity: true, resolveGroups: false },
      { label: "ordinary ambiguity unresolved + Close Pairs complete", ctx: context, resolveAmbiguity: false, resolveGroups: true },
      { label: "both complete", ctx: context, resolveAmbiguity: true, resolveGroups: true },
      { label: "zero Close Pairs", ctx: onlyAmbiguity, resolveAmbiguity: false, resolveGroups: false },
      { label: "zero ordinary ambiguity but Close Pairs exist", ctx: onlyGroups, resolveAmbiguity: false, resolveGroups: false },
    ];
    for (const scenario of scenarios) {
      const clock = makeFixedClock();
      const session = createReviewSession(`s-matrix-${scenario.label.replace(/\W+/g, "-")}`, "doc-under-test", clock());
      const engine = new DurableReviewEngine(detection, grouping, session, clock);
      if (scenario.resolveAmbiguity) {
        const ids = scenario.ctx.grouping.ambiguityProposals.map((p) => p.candidateId);
        if (ids.length > 0) engine.dispatch({ family: "review", type: "bulkApplyDecision", candidateIds: ids, decision: "Keep" });
      }
      if (scenario.resolveGroups) {
        const ids = [...new Set(scenario.ctx.grouping.entityGroupProposals.flatMap((g) => g.candidateIds))];
        if (ids.length > 0) engine.dispatch({ family: "review", type: "bulkApplyDecision", candidateIds: ids, decision: "Keep" });
      }
      const combined = ambiguityDisplayStatus(scenario.ctx, engine.getState());
      const expectComplete = scenario.resolveAmbiguity && scenario.resolveGroups;
      // "zero Close Pairs" / "zero ordinary ambiguity" scenarios: complete
      // only in the trivial sense of never having had work on the empty
      // axis -- their own resolve flags are both false, so completion
      // tracks whichever axis is real and non-empty (not yet resolved).
      const isTrivialAxisScenario = scenario.ctx !== context;
      const expected = isTrivialAxisScenario ? false : expectComplete;
      check(`${scenario.label}: combined completion is ${expected ? "'complete'" : "NOT 'complete'"}`, (combined.completion === "complete") === expected, combined.completion);

      // Item Check must be unreachable through NORMAL (automatic) progression
      // -- reconcile() -- whenever Ambiguity Check (combined) still has work.
      const nav = new DeterministicFocusNavigator(scenario.ctx, engine.getState());
      nav.dispatch({ family: "navigation", type: "focusStage", stage: "ambiguity-check" }, engine.getState());
      const reconciled = nav.reconcile(engine.getState());
      const ambiguityStillHasWork = combined.completion !== "complete";
      check(
        `${scenario.label}: reconcile() from ambiguity-check ${ambiguityStillHasWork ? "stays within it" : "may relocate onward"}`,
        ambiguityStillHasWork ? reconciled.target.stage === "ambiguity-check" : true,
        reconciled.target.stage
      );
      if (ambiguityStillHasWork) {
        check(`${scenario.label}: item-check specifically was not silently reached`, reconciled.target.stage !== "item-check");
      }
    }
  }

  console.log(`\n${passCount}/${passCount + failCount} checks passed`);
  process.exitCode = failCount === 0 ? 0 : 1;
}

await main();
