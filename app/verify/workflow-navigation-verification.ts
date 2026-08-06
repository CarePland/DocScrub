/**
 * workflow-navigation-verification.ts -- Phase 2, Type Check Integration
 * and Workflow Navigation (AG, 2026-08-02). Boundary coverage for:
 *
 *   1. navigation/workflow.ts -- the CONDITIONAL WORKFLOW derivation
 *      (active = stages that currently contain work + inherently-required
 *      qa/output), nearestActiveStage totality.
 *   2. navigation/stages.ts -- the "type-check" stage's traversal
 *      (semantic type ids from context.semanticTypes; a type resolves
 *      when every member candidate resolves via the EXISTING pipeline).
 *   3. navigation/navigator.ts -- moveStage over the ACTIVE list (hidden
 *      stages skipped, boundary clamped at the active list's ends),
 *      createInitialFocusState/restoreFocusState landing on active
 *      stages, and reconcile()'s stage relocation (with the open-Not
 *      Quite pin exception).
 *   4. navigation/keymap.ts -- shifted arrows resolve to NOTHING (the
 *      stage-movement layer owns them now); type-check's own
 *      between-card arrow/Tab bindings; type-check letters deliberately
 *      unresolved (UI-owned bulk).
 *   5. workspace/Workspace.ts end-to-end -- semanticTypes computed once
 *      per load, exposed via WorkspaceState AND the navigator's context;
 *      full review completion relocates focus to qa and shrinks the
 *      active workflow to qa/output.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/workflow-navigation-verification.ts
 */

import { OoxmlDocumentParser } from "../src/io/DocumentParser.ts";
import { RegexDetectionEngine } from "../src/engines/DetectionEngine.ts";
import { RegexCandidateQualityEngine, buildDefaultScoringProfileSnapshot } from "../src/engines/CandidateQualityEngine.ts";
import { RegexEntityResolutionEngine } from "../src/engines/EntityResolutionEngine.ts";
import { RegexOccurrenceClassifier } from "../src/engines/OccurrenceClassifier.ts";
import { DurableReviewEngine } from "../src/engines/ReviewEngine.ts";
import { createReviewSession } from "../src/engines/review/session.ts";
import { DeterministicFocusNavigator } from "../src/engines/FocusNavigator.ts";
import { itemIdsForStage, isItemResolved, computeStageStatus, reviewArtifactIdsForStage, isArtifactResolved } from "../src/engines/navigation/stages.ts";
import { applyReviewCommand } from "../src/engines/review/session.ts";
import type { RelationshipProposal } from "../src/domain/StructuralRelationship.ts";
import { activeWorkflowStages, isStageActive, nearestActiveStage } from "../src/engines/navigation/workflow.ts";
import { createInitialFocusState, restoreFocusState, reconcile } from "../src/engines/navigation/navigator.ts";
import { resolveKeyboardCommand } from "../src/engines/navigation/keymap.ts";
import { SEMANTIC_TYPE_ORDER, buildSemanticTypeGroups, qualityCategoriesOf, semanticTypeFor, type SemanticTypeGroup, type SemanticTypeId } from "../src/domain/semanticTypes.ts";
import type { FocusState } from "../src/domain/FocusState.ts";
import { ReviewWorkspace } from "../src/workspace/Workspace.ts";
import { WorkspaceCommandDispatcher } from "../src/workspace/CommandDispatcher.ts";
import { InMemorySessionRepository } from "./support/InMemorySessionRepository.ts";
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
  // Real pipeline output -- entity-resolution-001 has BOTH ambiguity
  // proposals and entity groups, so every work stage starts active.
  const file = loadSourceFile("entity-resolution-001");
  const model = await new OoxmlDocumentParser().parse(file);
  const detection = new RegexDetectionEngine().detect(model);
  const quality = new RegexCandidateQualityEngine().evaluate(model, detection, buildDefaultScoringProfileSnapshot("2026-08-02T00:00:00.000Z"));
  const grouping = new RegexEntityResolutionEngine().propose(detection, quality);
  const classification = new RegexOccurrenceClassifier().classify(model, detection, quality, grouping);

  // The SAME assignment rule Workspace.loadDocument uses (semanticTypeFor
  // over detected type + quality categories; no structural kinds here --
  // this fixture exercise doesn't need them and the field is additive).
  const assignments = new Map<string, SemanticTypeId>();
  for (const candidate of detection.candidates) {
    assignments.set(
      candidate.id,
      semanticTypeFor({ detectedType: candidate.detectedType, categories: qualityCategoriesOf(quality.assessmentByCandidate[candidate.id]), relationshipKinds: new Set() })
    );
  }
  const semanticTypes: SemanticTypeGroup[] = buildSemanticTypeGroups(assignments);
  const bareContext = { detection, grouping, classification };
  const typedContext = { detection, grouping, classification, semanticTypes };

  console.log("--- Conditional workflow derivation (workflow.ts) ---");
  {
    const session = createReviewSession("s-wf", "doc-under-test", "2026-08-02T00:00:01.000Z");
    const bareActive = activeWorkflowStages(bareContext, session);
    check(
      "bare context (no semanticTypes): type-check is HIDDEN, work stages + qa/output active",
      bareActive.join(",") === "ambiguity-check,group-check,item-check,qa,output",
      bareActive.join(",")
    );
    const typedActive = activeWorkflowStages(typedContext, session);
    check(
      "typed context: type-check joins BETWEEN group-check and item-check",
      typedActive.join(",") === "ambiguity-check,group-check,type-check,item-check,qa,output",
      typedActive.join(",")
    );
    check("qa/output are always members (inherently required)", typedActive.includes("qa") && typedActive.includes("output"));
    check(
      "nearestActiveStage is total and forward-first",
      nearestActiveStage("ambiguity-check", typedActive) === "ambiguity-check" &&
        nearestActiveStage("type-check", ["qa", "output"]) === "qa" &&
        nearestActiveStage("output", ["ambiguity-check", "qa", "output"]) === "output"
    );
  }

  console.log("--- Type Check traversal (stages.ts) ---");
  {
    const session = createReviewSession("s-types", "doc-under-test", "2026-08-02T00:00:01.000Z");
    const typeIds = itemIdsForStage("type-check", typedContext);
    check("type-check itemIds = populated semantic type ids", typeIds.length === semanticTypes.length && typeIds.length > 0, typeIds.join(","));
    check(
      "type ids appear in SEMANTIC_TYPE_ORDER display order",
      typeIds.every((id, i) => i === 0 || SEMANTIC_TYPE_ORDER.indexOf(id as SemanticTypeId) > SEMANTIC_TYPE_ORDER.indexOf(typeIds[i - 1]! as SemanticTypeId))
    );
    check("bare context yields an empty type-check item list", itemIdsForStage("type-check", bareContext).length === 0);
    check(
      "every candidate belongs to exactly one type",
      semanticTypes.reduce((n, g) => n + g.candidateIds.length, 0) === detection.candidates.length
    );

    const firstType = semanticTypes[0]!;
    check("a fresh type is unresolved", isItemResolved("type-check", firstType.typeId, typedContext, session) === false);
    const engine = new DurableReviewEngine(detection, grouping, session, makeFixedClock());
    // Resolve every member of the first type through the ORDINARY bulk
    // candidate command -- no type-level decision exists to dispatch.
    engine.dispatch({ family: "review", type: "bulkApplyDecision", candidateIds: [...firstType.candidateIds], decision: "Keep" });
    check(
      "a type resolves when ALL members resolve via the existing candidate pipeline",
      isItemResolved("type-check", firstType.typeId, typedContext, engine.getState()) === true
    );
    check("an unknown type id reads resolved (not reviewable)", isItemResolved("type-check", "no-such-type", typedContext, engine.getState()) === true);
    if (semanticTypes.length > 1) {
      check("other types remain unresolved", isItemResolved("type-check", semanticTypes[1]!.typeId, typedContext, engine.getState()) === false);
    }
  }

  console.log("--- moveStage over the ACTIVE workflow (navigator.ts) ---");
  {
    const session = createReviewSession("s-move", "doc-under-test", "2026-08-02T00:00:01.000Z");
    const engine = new DurableReviewEngine(detection, grouping, session, makeFixedClock());
    // Resolve every GROUP member individually so group-check deactivates
    // (its every proposal resolves member-by-member) while ambiguity/
    // type/item still hold work.
    const groupMemberIds = [...new Set(grouping.entityGroupProposals.flatMap((g) => g.candidateIds))];
    engine.dispatch({ family: "review", type: "bulkApplyDecision", candidateIds: groupMemberIds, decision: "Keep" });
    const active = activeWorkflowStages(typedContext, engine.getState());
    check("deciding every group member deactivates group-check", !active.includes("group-check"), active.join(","));

    const nav = new DeterministicFocusNavigator(typedContext, engine.getState());
    nav.dispatch({ family: "navigation", type: "focusStage", stage: "ambiguity-check" }, engine.getState());
    nav.dispatch({ family: "navigation", type: "moveStage", direction: "next" }, engine.getState());
    check(
      "moveStage next SKIPS the hidden group-check stage",
      nav.getFocus().target.stage === active[active.indexOf("ambiguity-check") + 1],
      nav.getFocus().target.stage
    );
    nav.dispatch({ family: "navigation", type: "focusStage", stage: "output" }, engine.getState());
    nav.dispatch({ family: "navigation", type: "moveStage", direction: "next" }, engine.getState());
    check("moveStage next clamps at the active list's end", nav.getFocus().target.stage === "output");
  }

  console.log("--- reconcile() stage relocation + Not Quite pin ---");
  {
    const clock = makeFixedClock();
    const session = createReviewSession("s-reloc", "doc-under-test", clock());
    const engine = new DurableReviewEngine(detection, grouping, session, clock);
    const nav = new DeterministicFocusNavigator(typedContext, engine.getState());
    nav.dispatch({ family: "navigation", type: "focusStage", stage: "item-check" }, engine.getState());
    // Decide EVERYTHING -- every work stage deactivates at once.
    engine.dispatch({ family: "review", type: "bulkApplyDecision", candidateIds: detection.candidates.map((c) => c.id), decision: "Keep" });
    const focus = nav.reconcile(engine.getState());
    check("full completion relocates focus forward to qa", focus.target.stage === "qa", focus.target.stage);
    check("relocated focus has no itemId (qa has no item model)", focus.target.itemId === null);
    check(
      "active workflow after full completion = qa,output",
      activeWorkflowStages(typedContext, engine.getState()).join(",") === "qa,output"
    );

    // The pin: an OPEN Not Quite transaction outranks stage activity.
    const clock2 = makeFixedClock();
    const engine2 = new DurableReviewEngine(detection, grouping, createReviewSession("s-pin", "doc-under-test", clock2()), clock2);
    const nav2 = new DeterministicFocusNavigator(typedContext, engine2.getState());
    const groupId = grouping.entityGroupProposals[0]!.groupId;
    engine2.dispatch({ family: "review", type: "enterNotQuite", groupId });
    engine2.dispatch({ family: "review", type: "bulkApplyDecision", candidateIds: detection.candidates.map((c) => c.id), decision: "Keep" });
    const pinned = nav2.reconcile(engine2.getState());
    check(
      "an open Not Quite panel PINS focus to group-check even when every stage's work is done",
      pinned.target.stage === "group-check" && pinned.target.panel.kind === "not-quite",
      `${pinned.target.stage}/${pinned.target.panel.kind}`
    );
  }

  console.log("--- Initial focus / resume land on ACTIVE stages ---");
  {
    const clock = makeFixedClock();
    const session = createReviewSession("s-init", "doc-under-test", clock());
    const engine = new DurableReviewEngine(detection, grouping, session, clock);
    // Resolve everything in ambiguity + groups: initial focus should skip
    // both and land on the first stage with work (type-check here).
    const ambiguityIds = grouping.ambiguityProposals.map((p) => p.candidateId);
    const groupMemberIds = [...new Set(grouping.entityGroupProposals.flatMap((g) => g.candidateIds))];
    engine.dispatch({ family: "review", type: "bulkApplyDecision", candidateIds: [...new Set([...ambiguityIds, ...groupMemberIds])], decision: "Keep" });
    const initial = createInitialFocusState({ ...typedContext }, engine.getState());
    const expectedFirst = activeWorkflowStages(typedContext, engine.getState())[0]!;
    check(`initial focus starts on the first ACTIVE stage (${expectedFirst})`, initial.target.stage === expectedFirst, initial.target.stage);

    const resumed: FocusState = restoreFocusState(
      { schemaVersion: 1, stage: "group-check", itemId: grouping.entityGroupProposals[0]!.groupId, savedAt: "2026-08-02T00:00:02.000Z" },
      typedContext,
      engine.getState()
    );
    check(
      "a resume position naming a now-hidden stage relocates to an active stage",
      activeWorkflowStages(typedContext, engine.getState()).includes(resumed.target.stage),
      resumed.target.stage
    );
  }

  console.log("--- Keymap: shifted arrows released to the stage layer; type-check bindings ---");
  {
    const itemFocus: FocusState = { target: { stage: "item-check", itemId: detection.candidates[0]!.id, panel: { kind: "none" } }, textInputActive: false };
    check("Shift+ArrowRight resolves to NOTHING in item-check (stage layer owns it)", resolveKeyboardCommand(itemFocus, { key: "ArrowRight", shift: true }) === null);
    check("Shift+ArrowDown resolves to nothing either (no shifted moveItem survivors)", resolveKeyboardCommand(itemFocus, { key: "ArrowDown", shift: true }) === null);
    const unshifted = resolveKeyboardCommand(itemFocus, { key: "ArrowDown" });
    check("unshifted arrows still resolve to moveItem", unshifted?.family === "navigation" && unshifted.type === "moveItem");
    check("Shift+Tab is UNCHANGED (previous item)", (() => {
      const cmd = resolveKeyboardCommand(itemFocus, { key: "Tab", shift: true });
      return cmd?.family === "navigation" && cmd.type === "moveItem" && cmd.direction === "previous";
    })());

    const groupFocus: FocusState = { target: { stage: "group-check", itemId: grouping.entityGroupProposals[0]!.groupId, panel: { kind: "none" } }, textInputActive: false };
    check("group-check: Shift+ArrowLeft resolves to nothing", resolveKeyboardCommand(groupFocus, { key: "ArrowLeft", shift: true }) === null);

    const typeFocus: FocusState = { target: { stage: "type-check", itemId: semanticTypes[0]!.typeId, panel: { kind: "none" } }, textInputActive: false };
    const typeArrow = resolveKeyboardCommand(typeFocus, { key: "ArrowDown" });
    check("type-check: unshifted arrows move between type cards (moveItem)", typeArrow?.family === "navigation" && typeArrow.type === "moveItem");
    const typeTab = resolveKeyboardCommand(typeFocus, { key: "Tab" });
    check("type-check: Tab = next type", typeTab?.family === "navigation" && typeTab.type === "moveItem" && typeTab.direction === "next");
    check("type-check: decision letters deliberately resolve to nothing (UI-owned bulk/member cursor)", resolveKeyboardCommand(typeFocus, { key: "k" }) === null && resolveKeyboardCommand(typeFocus, { key: "c" }) === null);
    check("type-check: Shift+ArrowRight resolves to nothing", resolveKeyboardCommand(typeFocus, { key: "ArrowRight", shift: true }) === null);
  }

  // ==========================================================================
  // REVIEW ARTIFACTS (AG, 2026-08-02): "The active workflow should represent
  // all remaining review work, not only unresolved candidates."
  //
  // The defect this covers, found live: every candidate row on Ambiguity
  // Check was decided, the stage read "complete", the conditional workflow
  // dropped its tab -- and an unaddressed structural relationship proposal
  // became unreachable. The reviewer was walked past work the application
  // itself had raised. These checks pin the corrected work model at the
  // level the bug lived at: membership, completion, and the QA/Output gate.
  // ==========================================================================
  console.log("--- Review artifacts keep a stage active (workflow.ts + stages.ts) ---");
  {
    const ambiguityIds = itemIdsForStage("ambiguity-check", bareContext);
    check("fixture precondition: the ambiguity stage has candidate rows", ambiguityIds.length > 0, `${ambiguityIds.length}`);
    // A proposal over two REAL candidates that are NOT ambiguity rows, so
    // resolving every row cannot incidentally resolve the artifact -- the
    // exact shape of the live repro (rows finished, card outstanding).
    const memberIds = detection.candidates.map((c) => c.id).filter((id) => !ambiguityIds.includes(id)).slice(0, 2);
    check("fixture precondition: two non-row candidates available as proposal members", memberIds.length === 2);
    const proposal: RelationshipProposal = {
      proposalId: "rel-acronym-TEST",
      kind: "acronym",
      candidateIds: memberIds,
      observation: "test proposal",
      evidence: "test evidence",
    };
    const withArtifacts = { ...bareContext, structuralRelationships: [proposal] };

    let session = createReviewSession("s-artifact", "doc-under-test", "2026-08-02T00:00:01.000Z");
    check("artifact ids come from the context's proposals", reviewArtifactIdsForStage("ambiguity-check", withArtifacts, session).join(",") === "rel-acronym-TEST");
    check("no other stage owns artifacts", (["group-check", "type-check", "item-check", "qa", "output"] as const).every((s) => reviewArtifactIdsForStage(s, withArtifacts, session).length === 0));
    check("a context without proposals has no artifacts (additive/optional)", reviewArtifactIdsForStage("ambiguity-check", bareContext, session).length === 0);
    check("an undecided proposal is unresolved", !isArtifactResolved("ambiguity-check", "rel-acronym-TEST", withArtifacts, session));
    check("an unknown artifact id is treated as not-reviewable", isArtifactResolved("ambiguity-check", "rel-nonexistent", withArtifacts, session));

    // Resolve EVERY ambiguity row. Under the old model the stage was done.
    for (const candidateId of ambiguityIds) {
      session = applyReviewCommand(session, { family: "review", type: "keepCandidate", candidateId }, withArtifacts, "2026-08-02T00:00:02.000Z").session;
    }
    const rowsDone = computeStageStatus("ambiguity-check", withArtifacts, session);
    check("every ambiguity ITEM is resolved", rowsDone.unresolvedCount === 0, `${rowsDone.unresolvedCount}`);
    check("...but the artifact still counts as outstanding work", rowsDone.unresolvedArtifactCount === 1, `${rowsDone.unresolvedArtifactCount}`);
    check("...so the stage's completion is 'unresolved', not 'complete'", rowsDone.completion === "unresolved", rowsDone.completion);
    check("...and the stage STAYS in the active workflow (the defect)", isStageActive(rowsDone));
    check("...and the active list still contains ambiguity-check", activeWorkflowStages(withArtifacts, session).includes("ambiguity-check"));
    // The control: the same session against a context with no proposals.
    check("without the proposal the same session completes the stage", !isStageActive(computeStageStatus("ambiguity-check", bareContext, session)));
    // hasItems keeps its traversal meaning -- artifacts are not traversable.
    check("hasItems still means TRAVERSABLE items only", rowsDone.hasItems === (rowsDone.itemCount > 0));

    // The QA/Output gate now asks the same question of every work stage.
    let allItems = session;
    for (const candidateId of detection.candidates.map((c) => c.id)) {
      allItems = applyReviewCommand(allItems, { family: "review", type: "keepCandidate", candidateId }, withArtifacts, "2026-08-02T00:00:03.000Z").session;
    }
    const artifactNowResolved = computeStageStatus("ambiguity-check", withArtifacts, allItems);
    check("deciding the proposal's members resolves the artifact", artifactNowResolved.unresolvedArtifactCount === 0);
    check("...and the stage finally completes", artifactNowResolved.completion === "complete" && !isStageActive(artifactNowResolved));
    check(
      "active workflow shrinks to qa,output only once artifacts are done too",
      activeWorkflowStages(withArtifacts, allItems).join(",") === "qa,output",
      activeWorkflowStages(withArtifacts, allItems).join(",")
    );

    // DISMISSAL DISSOLVES THE WORK: "Unrelated" removes the proposal from
    // the model entirely rather than reporting it resolved.
    let dismissed = session; // rows done, artifact outstanding
    dismissed = applyReviewCommand(
      dismissed,
      { family: "review", type: "dismissRelationship", proposalId: "rel-acronym-TEST", relationshipKind: "acronym", candidateIds: memberIds },
      withArtifacts,
      "2026-08-02T00:00:04.000Z"
    ).session;
    check("a dismissed proposal leaves the artifact list entirely", reviewArtifactIdsForStage("ambiguity-check", withArtifacts, dismissed).length === 0);
    const afterDismiss = computeStageStatus("ambiguity-check", withArtifacts, dismissed);
    check("...so the stage completes without any member being decided", afterDismiss.completion === "complete" && !isStageActive(afterDismiss));
    check("...and dismissal decided nothing", Object.keys(dismissed.candidateDecisions).length === Object.keys(session.candidateDecisions).length);
  }

  console.log("--- QA/Output availability derives from ALL work, not Item Check alone ---");
  {
    const ambiguityIds = itemIdsForStage("ambiguity-check", bareContext);
    const memberIds = detection.candidates.map((c) => c.id).filter((id) => !ambiguityIds.includes(id)).slice(0, 2);
    const proposal: RelationshipProposal = {
      proposalId: "rel-acronym-GATE",
      kind: "acronym",
      candidateIds: memberIds,
      observation: "test proposal",
      evidence: "test evidence",
    };
    // Decide every candidate EXCEPT the proposal's members: Item Check is
    // then incomplete too, so step to full completion in two stages.
    const withArtifacts = { ...bareContext, structuralRelationships: [proposal] };
    let session = createReviewSession("s-gate", "doc-under-test", "2026-08-02T00:00:01.000Z");
    for (const candidateId of detection.candidates.map((c) => c.id)) {
      session = applyReviewCommand(session, { family: "review", type: "keepCandidate", candidateId }, withArtifacts, "2026-08-02T00:00:02.000Z").session;
    }
    check("with everything decided, Output is available", computeStageStatus("output", withArtifacts, session).available);

    // Now the artifact-outstanding case: a fresh session where the
    // proposal's members are the ONLY undecided candidates would leave
    // Item Check unresolved too, so instead dismiss nothing and decide
    // everything but check the gate against an unresolved artifact by
    // using a proposal whose members are decided last.
    let partial = createReviewSession("s-gate-2", "doc-under-test", "2026-08-02T00:00:01.000Z");
    for (const candidateId of detection.candidates.map((c) => c.id).filter((id) => !memberIds.includes(id))) {
      partial = applyReviewCommand(partial, { family: "review", type: "keepCandidate", candidateId }, withArtifacts, "2026-08-02T00:00:02.000Z").session;
    }
    const outputPartial = computeStageStatus("output", withArtifacts, partial);
    check("Output stays unavailable while ANY work stage is unresolved", !outputPartial.available && outputPartial.completion === "unresolved");
    check("QA and Output agree (one rule, two stages)", computeStageStatus("qa", withArtifacts, partial).available === outputPartial.available);
    // qa/output never carry counts of their own -- they report the gate,
    // not the work.
    check("qa/output carry no item or artifact counts", outputPartial.itemCount === 0 && outputPartial.artifactCount === 0 && outputPartial.unresolvedArtifactCount === 0);
  }

  console.log("--- Workspace end-to-end: one assignment, one workflow ---");
  {
    const workspace = new ReviewWorkspace({ clock: makeFixedClock(), sessionRepository: new InMemorySessionRepository() });
    const loaded = await workspace.loadDocument(loadSourceFile("entity-resolution-001"));
    check("document loads", loaded.ok === true);
    const dispatcher = new WorkspaceCommandDispatcher(workspace);
    const state = dispatcher.getState();
    check("WorkspaceState.semanticTypes is computed at load", state.semanticTypes !== null && (state.semanticTypes?.length ?? 0) > 0);
    check(
      "semanticTypes membership covers every candidate exactly once",
      (state.semanticTypes ?? []).reduce((n, g) => n + g.candidateIds.length, 0) === (state.detection?.candidates.length ?? -1)
    );
    check("stageStatuses covers all six canonical stages", state.stageStatuses.length === 6 && state.stageStatuses.some((s) => s.stage === "type-check"));
    const typeStatus = state.stageStatuses.find((s) => s.stage === "type-check")!;
    check("type-check status counts TYPES, not candidates", typeStatus.itemCount === (state.semanticTypes?.length ?? -1));
    check("type-check starts with unresolved work (fixture has candidates)", typeStatus.unresolvedCount > 0);
    check(
      "isStageActive over exposed statuses matches the workflow rule",
      state.stageStatuses.filter(isStageActive).every((s) => s.stage === "qa" || s.stage === "output" || s.unresolvedCount > 0)
    );

    // Complete the whole review through ONE ordinary bulk command --
    // reconcile (dispatcher-owned) must relocate focus to qa and the
    // active workflow must shrink to the required stages.
    const allIds = (state.detection?.candidates ?? []).map((c) => c.id);
    const bulk = dispatcher.dispatchReview({ family: "review", type: "bulkApplyDecision", candidateIds: allIds, decision: "Keep" });
    check("bulk full completion dispatches cleanly", bulk.ok === true, bulk.reason);
    const after = dispatcher.getState();
    check("focus relocated to qa after the last decision", after.focus?.target.stage === "qa", after.focus?.target.stage);
    check(
      "active workflow after completion = qa,output",
      after.stageStatuses.filter(isStageActive).map((s) => s.stage).join(",") === "qa,output"
    );
  }

  console.log(`\n${passCount}/${passCount + failCount} checks passed`);
  process.exitCode = failCount === 0 ? 0 : 1;
}

await main();
