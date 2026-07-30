/**
 * Verification for Feature 001 (first post-migration feature), terminology
 * and scope revised in v9 (Commands.ts): Group Check's four bulk review
 * commands -- confirmGroup ("Keep as-is") / flattenGroup ("Rename") /
 * redactGroup ("Redact") / ignoreGroup ("Ignore"). rejectGroup was removed
 * in v9 -- see Commands.ts's v9 changelog note for why. Same property/
 * behavior-suite spirit as review-engine-verification.ts/focus-navigator-
 * verification.ts/workspace-integration.ts/audit-exporter-verification.ts
 * -- there is no Python-exported fixture for this (Python's real
 * group-level bulk vocabulary was never captured as a domain-parity
 * fixture either), so this proves the properties directly, exercised
 * through the REAL ReviewWorkspace + WorkspaceCommandDispatcher against a
 * real fixture (entity-resolution-001, the only fixture with real
 * multi-candidate entity groups) -- never by reaching into ReviewEngine/
 * session.ts internals directly.
 *
 * Covers: Keep as-is (confirmGroup), Rename (flattenGroup), Redact
 * (redactGroup), Ignore (ignoreGroup), a mixed workflow (bulk followed by
 * Not Quite on the SAME group), bulk after partial individual review,
 * save/reload equivalence, focus reconciliation (no special-case logic --
 * the existing reconcile() pipeline), readiness/unresolved-count updates,
 * export readiness, and audit representation (including the
 * wentThroughNotQuite fix -- see AuditExporter.ts's Feature 001 doc-comment
 * update).
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/group-bulk-actions-verification.ts
 */

import { ReviewWorkspace } from "../src/workspace/Workspace.ts";
import { InMemorySessionRepository } from "./support/InMemorySessionRepository.ts";
import { WorkspaceCommandDispatcher } from "../src/workspace/CommandDispatcher.ts";
import { deserializeWorkspaceSaveFile } from "../src/workspace/WorkspaceSaveFile.ts";
import type { AuditRecord } from "../src/domain/AuditRecord.ts";
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
    return `2026-07-31T00:00:${String(tick).padStart(2, "0")}.000Z`;
  };
}

/** Walks group-check from the first item, collecting up to `count` distinct
 *  group IDs in traversal order -- purely via the dispatcher's own
 *  navigation surface, matching workspace-integration.ts's
 *  findSecondGroupId() convention rather than reaching into GroupingResult
 *  directly. */
function collectGroupIds(dispatcher: WorkspaceCommandDispatcher, count: number): string[] {
  dispatcher.dispatchNavigation({ family: "navigation", type: "focusStage", stage: "group-check" });
  dispatcher.dispatchNavigation({ family: "navigation", type: "moveItem", direction: "first" });
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = dispatcher.getState().focus?.target.itemId;
    if (id && !ids.includes(id)) ids.push(id);
    dispatcher.dispatchNavigation({ family: "navigation", type: "moveItem", direction: "next" });
  }
  return ids;
}

async function freshLoadedDispatcher(): Promise<WorkspaceCommandDispatcher> {
  const workspace = new ReviewWorkspace({ clock: makeFixedClock(), sessionRepository: new InMemorySessionRepository() });
  const dispatcher = new WorkspaceCommandDispatcher(workspace);
  const file = loadSourceFile("entity-resolution-001");
  const loadResult = await dispatcher.dispatchApplication({ family: "document", type: "load", file });
  check("fixture loads cleanly for this scenario", loadResult.ok === true, loadResult.reason);
  return dispatcher;
}

async function main(): Promise<void> {
  console.log("--- Setup: confirm entity-resolution-001 has at least 2 real groups ---");
  // NOTE (2026-07-28): this fixture used to have 3 real (2+-member) entity
  // groups -- Jackson, Goodloe, and an "Alvarez"/"Maria" bucket. That third
  // bucket only ever reached 2 members because buildEntityGroups() used to
  // silently auto-merge the bare short reference "Maria" into "Maria
  // Alvarez"'s bucket with no reviewer confirmation -- exactly the defect
  // the ambiguity-anchor correction fixed (see resolution.ts's top doc
  // comment and docs/detection/ambiguity-anchor-correction.md). Post-fix,
  // "Maria" is correctly routed to Ambiguity Check instead, so that bucket
  // now has only its one real full-name member and no longer reaches the
  // 2-member grouping threshold. The fixture now legitimately has 2 real
  // groups, not 3 -- this is the corrected ground truth, not a fixture bug.
  const setupDispatcher = await freshLoadedDispatcher();
  const setupState = setupDispatcher.getState();
  const groupStage = setupState.stageStatuses.find((s) => s.stage === "group-check")!;
  check("fixture has at least 2 proposed groups", groupStage.itemCount >= 2, `itemCount=${groupStage.itemCount}`);
  const [groupA, groupB] = collectGroupIds(setupDispatcher, 2);
  check("collected 2 distinct group IDs", !!groupA && !!groupB && groupA !== groupB);

  console.log("--- Confirm Group ---");
  {
    const dispatcher = await freshLoadedDispatcher();
    const [gA] = collectGroupIds(dispatcher, 1);
    const before = dispatcher.getState();
    const group = before.grouping!.entityGroupProposals.find((g) => g.groupId === gA)!;

    const result = dispatcher.dispatchReview({ family: "review", type: "confirmGroup", groupId: gA! });
    check("confirmGroup succeeds", result.ok === true, result.reason);

    const state = dispatcher.getState();
    check("group decision is Confirmed", state.reviewSession?.groupDecisions[gA!]?.decision === "Confirmed");
    check(
      "confirmedMemberCandidateIds is every proposed member",
      JSON.stringify([...(state.reviewSession?.groupDecisions[gA!]?.confirmedMemberCandidateIds ?? [])].sort()) ===
        JSON.stringify([...group.candidateIds].sort())
    );
    for (const candidateId of group.candidateIds) {
      check(`member ${candidateId} received a real Keep decision (not left Undecided)`, state.reviewSession?.candidateDecisions[candidateId]?.decision === "Keep");
    }
    check(
      "no member-by-member review was required -- no Not Quite transaction was ever opened",
      state.reviewSession?.activeNotQuite === null
    );
  }

  console.log("--- Redact Group ---");
  {
    const dispatcher = await freshLoadedDispatcher();
    const [gA] = collectGroupIds(dispatcher, 1);
    const before = dispatcher.getState();
    const group = before.grouping!.entityGroupProposals.find((g) => g.groupId === gA)!;

    const result = dispatcher.dispatchReview({ family: "review", type: "redactGroup", groupId: gA! });
    check("redactGroup succeeds", result.ok === true, result.reason);

    const state = dispatcher.getState();
    check("group decision is Confirmed (accepts the grouping, same as Keep as-is)", state.reviewSession?.groupDecisions[gA!]?.decision === "Confirmed");
    check(
      "confirmedMemberCandidateIds is every proposed member",
      JSON.stringify([...(state.reviewSession?.groupDecisions[gA!]?.confirmedMemberCandidateIds ?? [])].sort()) ===
        JSON.stringify([...group.candidateIds].sort())
    );
    for (const candidateId of group.candidateIds) {
      check(`member ${candidateId} received a real Redact decision (not left Undecided)`, state.reviewSession?.candidateDecisions[candidateId]?.decision === "Redact");
    }
  }

  console.log("--- Redact Group with an explicit replacement override ---");
  {
    const dispatcher = await freshLoadedDispatcher();
    const [gA] = collectGroupIds(dispatcher, 1);
    const before = dispatcher.getState();
    const group = before.grouping!.entityGroupProposals.find((g) => g.groupId === gA)!;

    const result = dispatcher.dispatchReview({ family: "review", type: "redactGroup", groupId: gA!, replacement: "[GROUP REDACTED]" });
    check("redactGroup with an explicit replacement succeeds", result.ok === true, result.reason);

    const state = dispatcher.getState();
    for (const candidateId of group.candidateIds) {
      check(
        `member ${candidateId} received the explicit replacement override`,
        state.reviewSession?.candidateDecisions[candidateId]?.decision === "Redact" && state.reviewSession.candidateDecisions[candidateId]?.replacement === "[GROUP REDACTED]"
      );
    }
  }

  console.log("--- Ignore Group ---");
  {
    const dispatcher = await freshLoadedDispatcher();
    const [gA] = collectGroupIds(dispatcher, 1);
    const before = dispatcher.getState();
    const group = before.grouping!.entityGroupProposals.find((g) => g.groupId === gA)!;

    const result = dispatcher.dispatchReview({ family: "review", type: "ignoreGroup", groupId: gA! });
    check("ignoreGroup succeeds", result.ok === true, result.reason);

    const state = dispatcher.getState();
    check("group decision is Confirmed (accepts the grouping, same as Keep as-is)", state.reviewSession?.groupDecisions[gA!]?.decision === "Confirmed");
    for (const candidateId of group.candidateIds) {
      check(`member ${candidateId} received a real Ignore decision (not left Undecided)`, state.reviewSession?.candidateDecisions[candidateId]?.decision === "Ignore");
    }
  }

  console.log("--- Flatten Group ---");
  {
    const dispatcher = await freshLoadedDispatcher();
    const [gA] = collectGroupIds(dispatcher, 1);
    const before = dispatcher.getState();
    const group = before.grouping!.entityGroupProposals.find((g) => g.groupId === gA)!;

    const result = dispatcher.dispatchReview({ family: "review", type: "flattenGroup", groupId: gA! });
    check("flattenGroup succeeds", result.ok === true, result.reason);

    const state = dispatcher.getState();
    check("group decision is Refined (same outcome a manual Not-Quite-then-complete pass would produce)", state.reviewSession?.groupDecisions[gA!]?.decision === "Refined");
    for (const candidateId of group.candidateIds) {
      const decision = state.reviewSession?.candidateDecisions[candidateId];
      check(`member ${candidateId} was renamed to the group's canonical name`, decision?.decision === "Rename" && decision.replacement === group.canonicalName);
    }
  }

  console.log("--- Flatten Group + generateOutput: rebuild terminates and any verification failure is explained ---");
  {
    // Regression coverage for two real defects found and fixed while
    // validating this feature (see docs/detection/
    // feature-001-group-bulk-actions.md): (1) redactParagraph() in
    // ooxml/rebuild.ts looped forever whenever a Rename's replacement text
    // equalled its own search text -- which flattenGroup produces routinely,
    // since the canonical member's own text often already IS the group's
    // canonical name; (2) OutputVerifier's ordinary body-text rescan could
    // set passed=false with zero FidelityFindings to explain why. Every
    // fixture member here decides Keep except the flattened group, so this
    // exercises exactly the flatten-produces-identical-text path.
    const dispatcher = await freshLoadedDispatcher();
    const [gA] = collectGroupIds(dispatcher, 1);
    dispatcher.dispatchReview({ family: "review", type: "flattenGroup", groupId: gA! });

    dispatcher.dispatchNavigation({ family: "navigation", type: "focusStage", stage: "item-check" });
    let guard = 0;
    let state = dispatcher.getState();
    while (state.stageStatuses.find((s) => s.stage === "item-check")!.unresolvedCount > 0 && guard < 50) {
      const itemId = state.focus?.target.itemId;
      if (!itemId) break;
      dispatcher.dispatchReview({ family: "review", type: "keepCandidate", candidateId: itemId });
      state = dispatcher.getState();
      guard += 1;
    }
    dispatcher.dispatchNavigation({ family: "navigation", type: "focusStage", stage: "ambiguity-check" });
    let ambiguityGuard = 0;
    let ambiguityState = dispatcher.getState();
    while (ambiguityState.stageStatuses.find((s) => s.stage === "ambiguity-check")!.unresolvedCount > 0 && ambiguityGuard < 10) {
      const itemId = ambiguityState.focus?.target.itemId;
      if (!itemId) break;
      dispatcher.dispatchReview({ family: "review", type: "keepCandidate", candidateId: itemId });
      ambiguityState = dispatcher.getState();
      ambiguityGuard += 1;
    }
    check("review completes after flattening one group and keeping everything else", dispatcher.getState().readiness.reviewComplete === true);

    const t0 = Date.now();
    const generateResult = await dispatcher.dispatchApplication({ family: "document", type: "generateOutput" });
    const elapsedMs = Date.now() - t0;
    check("generateOutput terminates promptly after a Flatten Group whose canonical name matches a member's own text", generateResult.ok === true, generateResult.reason);
    check("generateOutput does not hang -- completes in well under a second, not the infinite loop this reproduced before the rebuild.ts fix", elapsedMs < 5000, `elapsedMs=${elapsedMs}`);

    const afterState = dispatcher.getState();
    if (afterState.verification && afterState.verification.passed === false) {
      check(
        "if verification fails for this scenario, it is never silent -- at least one FidelityFinding explains why (the OutputVerifier.ts explainability fix)",
        afterState.verification.fidelityFindings.length > 0
      );
    } else {
      check("verification report is present after generateOutput", afterState.verification !== null);
    }
  }

  console.log("--- Bulk after partial individual review (Flatten overwrites a prior manual decision) ---");
  {
    const dispatcher = await freshLoadedDispatcher();
    const [gA] = collectGroupIds(dispatcher, 1);
    const state0 = dispatcher.getState();
    const group = state0.grouping!.entityGroupProposals.find((g) => g.groupId === gA)!;
    const firstMember = group.candidateIds[0]!;

    const preResult = dispatcher.dispatchReview({ family: "review", type: "redactCandidate", candidateId: firstMember });
    check("a manual Redact decision is applied to one member before flattening", preResult.ok === true, preResult.reason);
    check("the manual decision is visible before the bulk action", dispatcher.getState().reviewSession?.candidateDecisions[firstMember]?.decision === "Redact");

    const flattenResult = dispatcher.dispatchReview({ family: "review", type: "flattenGroup", groupId: gA! });
    check("flattenGroup succeeds even when a member already has a manual decision", flattenResult.ok === true, flattenResult.reason);

    const state = dispatcher.getState();
    check(
      "flatten overwrites the earlier manual Redact with Rename -- same last-write-wins rule as every other candidate decision",
      state.reviewSession?.candidateDecisions[firstMember]?.decision === "Rename" && state.reviewSession.candidateDecisions[firstMember]?.replacement === group.canonicalName
    );
  }

  console.log("--- Mixed workflow: bulk action followed by Not Quite on the SAME group ---");
  {
    const dispatcher = await freshLoadedDispatcher();
    const [gA] = collectGroupIds(dispatcher, 1);
    const state0 = dispatcher.getState();
    const group = state0.grouping!.entityGroupProposals.find((g) => g.groupId === gA)!;

    const confirmResult = dispatcher.dispatchReview({ family: "review", type: "confirmGroup", groupId: gA! });
    check("confirmGroup succeeds as the first step of the mixed workflow", confirmResult.ok === true, confirmResult.reason);
    check("group reads Confirmed before Not Quite is entered", dispatcher.getState().reviewSession?.groupDecisions[gA!]?.decision === "Confirmed");

    const enterResult = dispatcher.dispatchReview({ family: "review", type: "enterNotQuite", groupId: gA! });
    check("entering Not Quite on an already-Confirmed group is allowed (no special-case rejection)", enterResult.ok === true, enterResult.reason);

    const firstMember = group.candidateIds[0]!;
    const renameResult = dispatcher.dispatchReview({
      family: "review",
      type: "applyNotQuiteMember",
      groupId: gA!,
      candidateId: firstMember,
      action: "Rename",
      draftReplacement: "Manually Chosen Name",
    });
    check("renaming one member inside the subsequent Not Quite transaction succeeds", renameResult.ok === true, renameResult.reason);
    for (const candidateId of group.candidateIds) {
      if (candidateId === firstMember) continue;
      dispatcher.dispatchReview({ family: "review", type: "applyNotQuiteMember", groupId: gA!, candidateId, action: "Keep" });
    }
    const completeResult = dispatcher.dispatchReview({ family: "review", type: "completeNotQuite", groupId: gA! });
    check("completeNotQuite succeeds after the earlier bulk confirm", completeResult.ok === true, completeResult.reason);
    dispatcher.dispatchReview({ family: "review", type: "exitNotQuite", groupId: gA! });

    const state = dispatcher.getState();
    check(
      "the group decision is overwritten from Confirmed to Refined -- last-write-wins, no precedence table",
      state.reviewSession?.groupDecisions[gA!]?.decision === "Refined"
    );
    check(
      "the manually renamed member reflects the Not Quite choice, not the earlier bulk Keep",
      state.reviewSession?.candidateDecisions[firstMember]?.decision === "Rename" && state.reviewSession.candidateDecisions[firstMember]?.replacement === "Manually Chosen Name"
    );
  }

  console.log("--- Rejection of a bulk action while Not Quite is open for the SAME group ---");
  {
    const dispatcher = await freshLoadedDispatcher();
    const [gA] = collectGroupIds(dispatcher, 1);
    const enterResult = dispatcher.dispatchReview({ family: "review", type: "enterNotQuite", groupId: gA! });
    check("Not Quite opens for the guard-clause scenario", enterResult.ok === true, enterResult.reason);

    const confirmWhileOpen = dispatcher.dispatchReview({ family: "review", type: "confirmGroup", groupId: gA! });
    check("confirmGroup is rejected while Not Quite is open for this same group", confirmWhileOpen.ok === false && !!confirmWhileOpen.reason);
    const redactWhileOpen = dispatcher.dispatchReview({ family: "review", type: "redactGroup", groupId: gA! });
    check("redactGroup is rejected while Not Quite is open for this same group", redactWhileOpen.ok === false && !!redactWhileOpen.reason);
    const ignoreWhileOpen = dispatcher.dispatchReview({ family: "review", type: "ignoreGroup", groupId: gA! });
    check("ignoreGroup is rejected while Not Quite is open for this same group", ignoreWhileOpen.ok === false && !!ignoreWhileOpen.reason);
    const flattenWhileOpen = dispatcher.dispatchReview({ family: "review", type: "flattenGroup", groupId: gA! });
    check("flattenGroup is rejected while Not Quite is open for this same group", flattenWhileOpen.ok === false && !!flattenWhileOpen.reason);
  }

  console.log("--- Bulk action on a DIFFERENT group while Not Quite is open elsewhere is allowed ---");
  {
    const dispatcher = await freshLoadedDispatcher();
    const [gA, gB] = collectGroupIds(dispatcher, 2);
    const enterResult = dispatcher.dispatchReview({ family: "review", type: "enterNotQuite", groupId: gA! });
    check("Not Quite opens for group A", enterResult.ok === true, enterResult.reason);

    const confirmOtherGroup = dispatcher.dispatchReview({ family: "review", type: "confirmGroup", groupId: gB! });
    check("confirmGroup on a DIFFERENT group succeeds while Not Quite is open elsewhere", confirmOtherGroup.ok === true, confirmOtherGroup.reason);
    check("group B reads Confirmed", dispatcher.getState().reviewSession?.groupDecisions[gB!]?.decision === "Confirmed");
    check("group A's Not Quite transaction is untouched by the other group's bulk action", dispatcher.getState().reviewSession?.activeNotQuite?.groupId === gA);
  }

  console.log("--- Unknown group ID is rejected cleanly for all four commands ---");
  {
    const dispatcher = await freshLoadedDispatcher();
    check("confirmGroup on an unknown group fails cleanly", dispatcher.dispatchReview({ family: "review", type: "confirmGroup", groupId: "no-such-group" }).ok === false);
    check("redactGroup on an unknown group fails cleanly", dispatcher.dispatchReview({ family: "review", type: "redactGroup", groupId: "no-such-group" }).ok === false);
    check("ignoreGroup on an unknown group fails cleanly", dispatcher.dispatchReview({ family: "review", type: "ignoreGroup", groupId: "no-such-group" }).ok === false);
    check("flattenGroup on an unknown group fails cleanly", dispatcher.dispatchReview({ family: "review", type: "flattenGroup", groupId: "no-such-group" }).ok === false);
  }

  console.log("--- Focus reconciliation: no special-case logic, the existing pipeline handles bulk actions ---");
  {
    const dispatcher = await freshLoadedDispatcher();
    const [gA] = collectGroupIds(dispatcher, 1);
    dispatcher.dispatchNavigation({ family: "navigation", type: "selectItem", itemId: gA! });
    const beforeFocus = dispatcher.getState().focus;
    check("focus is on the target group before the bulk action", beforeFocus?.target.itemId === gA);

    const result = dispatcher.dispatchReview({ family: "review", type: "confirmGroup", groupId: gA! });
    check("confirmGroup succeeds", result.ok === true, result.reason);

    const afterFocus = dispatcher.getState().focus;
    check("focus reconciled without error after the bulk action (a valid target still exists)", afterFocus !== null && afterFocus !== undefined);
    check(
      "focus remains a valid, resolvable target -- deterministic reconciliation, not a special bulk-action path",
      afterFocus!.target.stage === "group-check" || afterFocus!.target.stage === "item-check"
    );
  }

  console.log("--- Readiness / unresolved-count updates ---");
  {
    const dispatcher = await freshLoadedDispatcher();
    const beforeState = dispatcher.getState();
    const beforeUnresolvedItems = beforeState.stageStatuses.find((s) => s.stage === "item-check")!.unresolvedCount;

    const [gA] = collectGroupIds(dispatcher, 1);
    const group = beforeState.grouping!.entityGroupProposals.find((g) => g.groupId === gA)!;
    dispatcher.dispatchReview({ family: "review", type: "confirmGroup", groupId: gA! });

    const afterState = dispatcher.getState();
    const afterUnresolvedItems = afterState.stageStatuses.find((s) => s.stage === "item-check")!.unresolvedCount;
    check(
      "unresolvedCount in item-check drops by exactly the confirmed group's member count",
      afterUnresolvedItems === beforeUnresolvedItems - group.candidateIds.length,
      `before=${beforeUnresolvedItems} after=${afterUnresolvedItems} members=${group.candidateIds.length}`
    );
  }

  console.log("--- Export readiness: decide everything via a mix of bulk + individual, then generate output ---");
  let exportDispatcher!: WorkspaceCommandDispatcher;
  {
    exportDispatcher = await freshLoadedDispatcher();
    // Only 2 real groups exist post-correction (see the Setup section's
    // note above) -- confirmGroup (Confirmed via Keep) and flattenGroup
    // (Refined via Rename) between them already exercise both group-level
    // decision kinds this combined scenario needs to show together.
    // redactGroup's own "Confirmed" stamping is already independently
    // verified in the standalone "--- Redact Group ---" section above; no
    // coverage is lost by not repeating it here against a 3rd group this
    // fixture no longer has.
    const [gA, gB] = collectGroupIds(exportDispatcher, 2);
    exportDispatcher.dispatchReview({ family: "review", type: "confirmGroup", groupId: gA! });
    exportDispatcher.dispatchReview({ family: "review", type: "flattenGroup", groupId: gB! });

    // Decide any remaining item-check candidates individually (the two
    // bulk actions above decide their own members, so this covers whatever
    // the fixture has outside those two groups, not a required cleanup
    // step the way it was for the now-removed Reject Group).
    exportDispatcher.dispatchNavigation({ family: "navigation", type: "focusStage", stage: "item-check" });
    let guard = 0;
    let state = exportDispatcher.getState();
    while (state.stageStatuses.find((s) => s.stage === "item-check")!.unresolvedCount > 0 && guard < 50) {
      const itemId = state.focus?.target.itemId;
      if (!itemId) break;
      exportDispatcher.dispatchReview({ family: "review", type: "keepCandidate", candidateId: itemId });
      state = exportDispatcher.getState();
      guard += 1;
    }
    // Ambiguity Check may still have an item resolved via the same
    // candidate-decision vocabulary -- decide it too if present.
    exportDispatcher.dispatchNavigation({ family: "navigation", type: "focusStage", stage: "ambiguity-check" });
    let ambiguityGuard = 0;
    let ambiguityState = exportDispatcher.getState();
    while (ambiguityState.stageStatuses.find((s) => s.stage === "ambiguity-check")!.unresolvedCount > 0 && ambiguityGuard < 10) {
      const itemId = ambiguityState.focus?.target.itemId;
      if (!itemId) break;
      exportDispatcher.dispatchReview({ family: "review", type: "keepCandidate", candidateId: itemId });
      ambiguityState = exportDispatcher.getState();
      ambiguityGuard += 1;
    }

    const finalState = exportDispatcher.getState();
    check("review is complete after the mixed bulk + individual workflow", finalState.readiness.reviewComplete === true, `unresolved=${finalState.readiness.unresolvedItemCount}`);

    const generateResult = await exportDispatcher.dispatchApplication({ family: "document", type: "generateOutput" });
    check("generateOutput succeeds", generateResult.ok === true, generateResult.reason);
    const afterGenerate = exportDispatcher.getState();
    check("verification is current immediately after generating", afterGenerate.readiness.verificationCurrent === true);
    check(
      "exportEnabled follows the same existing rule -- no bulk-specific export logic was introduced",
      afterGenerate.readiness.exportEnabled === (afterGenerate.readiness.verificationCurrent && afterGenerate.readiness.verificationPassed === true)
    );
  }

  console.log("--- Save/reload equivalence for bulk-produced decisions ---");
  {
    const saveResult = await exportDispatcher.dispatchApplication({ family: "document", type: "saveReviewSession" });
    check("saveReviewSession succeeds after a bulk-heavy workflow", saveResult.ok === true, saveResult.reason);
    const savedJson = exportDispatcher.getLastSaveFile();
    check("a save file is produced", typeof savedJson === "string" && savedJson.length > 0);

    if (savedJson) {
      const deserialized = deserializeWorkspaceSaveFile(savedJson);
      check("the save file deserializes cleanly", deserialized.ok === true);
      if (deserialized.ok) {
        const reloadedWorkspace = new ReviewWorkspace({ clock: makeFixedClock(), sessionRepository: new InMemorySessionRepository() });
        const reloadedDispatcher = new WorkspaceCommandDispatcher(reloadedWorkspace);
        const sameFileAgain = loadSourceFile("entity-resolution-001");
        const restoreResult = await reloadedDispatcher.loadSavedSession(sameFileAgain, deserialized.saveFile);
        check("reloading restores the bulk-produced session", restoreResult.ok === true, restoreResult.reason);

        const reloadedState = reloadedDispatcher.getState();
        check(
          "reloaded groupDecisions (Confirmed/Refined/Rejected) exactly match the saved session's",
          JSON.stringify(reloadedState.reviewSession?.groupDecisions) === JSON.stringify(deserialized.saveFile.reviewSession.groupDecisions)
        );
        check(
          "reloaded candidateDecisions exactly match the saved session's",
          JSON.stringify(reloadedState.reviewSession?.candidateDecisions) === JSON.stringify(deserialized.saveFile.reviewSession.candidateDecisions)
        );

        console.log("--- Stale reconciliation still works after reload (no bulk-specific staleness path) ---");
        check("verification is stale (null) immediately after a fresh reload (never persisted across reload)", reloadedDispatcher.getState().verification === null);
      }
    }
  }

  console.log("--- Audit representation of bulk-produced decisions ---");
  {
    const auditResult = await exportDispatcher.dispatchApplication({ family: "document", type: "generateAudit" });
    check("generateAudit succeeds after a bulk-heavy workflow", auditResult.ok === true, auditResult.reason);
    const artifacts = exportDispatcher.getLastAuditArtifacts();
    check("audit artifacts are produced", artifacts !== null);

    if (artifacts) {
      const record = JSON.parse(artifacts.auditReport) as AuditRecord;
      const confirmedGroups = record.entityGroups.filter((g) => g.decision === "Confirmed");
      const refinedByFlatten = record.entityGroups.find((g) => g.decision === "Refined");

      // One "Confirmed" group (gA, Keep as-is) is present in this scenario
      // -- redactGroup's independent "also stamps Confirmed" property (see
      // session.ts's redactGroup case) is verified directly in the
      // standalone "--- Redact Group ---" section above, against its own
      // fresh dispatcher, not repeated here (see this scenario's setup
      // comment for why only 2 real groups are available to it now).
      check("at least one Confirmed group is represented in the audit record (Keep as-is)", confirmedGroups.length >= 1);
      check("a Refined (renamed/flattened) group is represented in the audit record", !!refinedByFlatten);
      for (const group of confirmedGroups) {
        check(`Confirmed group ${group.groupId}'s confirmedMemberCandidateIds is non-empty (all members)`, group.confirmedMemberCandidateIds.length > 0);
      }
      check(
        "a group resolved via flattenGroup (not completeNotQuite) reads wentThroughNotQuite: false -- the Feature 001 AuditExporter fix",
        refinedByFlatten !== undefined && refinedByFlatten.wentThroughNotQuite === false
      );

      const keepGroup = confirmedGroups.find((g) => {
        const member = record.candidates.find((c) => g.confirmedMemberCandidateIds.includes(c.candidateId));
        return member?.decision === "Keep";
      });
      // redactGroup's own "member decision is Redact, not Undecided"
      // property is verified directly in the standalone "--- Redact
      // Group ---" section above (against its own fresh dispatcher) --
      // not repeated here now that this combined scenario only has 2 real
      // groups to work with (see this scenario's setup comment).
      check("a Keep-as-is (confirmGroup) member's audited decision is Keep, not Undecided -- avoids the resolvedStatus/decision mismatch", !!keepGroup);
      const keepMember = keepGroup && record.candidates.find((c) => keepGroup.confirmedMemberCandidateIds.includes(c.candidateId));
      check("the Keep-as-is member's resolvedStatus reads resolved", keepMember?.resolvedStatus === "resolved");

      check("no raw candidate text or context leaks into the audit report for bulk-produced entries either", !artifacts.auditReport.includes("Priya Natarajan"));
    }
  }

  console.log(`\n${passCount}/${passCount + failCount} checks passed`);
  process.exitCode = failCount === 0 ? 0 : 1;
}

main();
