/**
 * End-to-end integration verification for Phase 10: ReviewWorkspace +
 * WorkspaceCommandDispatcher, composing all eight coordinated components
 * (DocumentParser, DetectionEngine, CandidateQualityEngine,
 * EntityResolutionEngine, OccurrenceClassifier, ReviewEngine,
 * FocusNavigator, OutputVerifier/DocumentRebuilder) against REAL domain-
 * parity fixtures, through the dispatcher's own command surface -- never
 * by reaching into engine internals directly, since the whole point of
 * this suite is to prove the WIRING is correct, not to re-prove any single
 * engine's own behavior (that's what production-parity.ts,
 * detection-parity.ts, quality-parity.ts, entity-resolution-parity.ts,
 * occurrence-classification-parity.ts, review-engine-verification.ts, and
 * focus-navigator-verification.ts already do, and continue to do
 * unchanged -- this suite adds a layer, it does not replace any of them).
 *
 * Exercises the realistic workflow Andrew's Phase 10 instruction lists:
 * load document, run pipeline, review ambiguity, review groups, review
 * items, enter/resume Not Quite, rename/redact/ignore, save session,
 * reload session (including a wrong-document rejection case), resume
 * focus, complete review, and verify output readiness/export gating
 * (including verification staleness after a post-verification decision
 * change).
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/workspace-integration.ts
 */

import { ReviewWorkspace } from "../src/workspace/Workspace.ts";
import { InMemorySessionRepository } from "./support/InMemorySessionRepository.ts";
import { WorkspaceCommandDispatcher, explainCommandRouting } from "../src/workspace/CommandDispatcher.ts";
import { deserializeWorkspaceSaveFile } from "../src/workspace/WorkspaceSaveFile.ts";
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

/** A fixed clock so the whole scenario is reproducible run-to-run, matching
 *  the convention already established in review-engine-verification.ts and
 *  focus-navigator-verification.ts. */
function makeFixedClock(): () => string {
  let tick = 0;
  return () => {
    tick += 1;
    return `2026-07-29T00:00:${String(tick).padStart(2, "0")}.000Z`;
  };
}

async function main(): Promise<void> {
  console.log("--- No document loaded: every dispatch surface fails gracefully, never throws ---");
  {
    const workspace = new ReviewWorkspace({ clock: makeFixedClock(), sessionRepository: new InMemorySessionRepository() });
    const dispatcher = new WorkspaceCommandDispatcher(workspace);

    const emptyState = dispatcher.getState();
    check("empty workspace reports documentLoaded: false", emptyState.documentLoaded === false);
    check("empty workspace reports no stage statuses", emptyState.stageStatuses.length === 0);
    check("empty workspace reports reviewComplete: false", emptyState.readiness.reviewComplete === false);

    const reviewResult = dispatcher.dispatchReview({ family: "review", type: "keepCandidate", candidateId: "whatever" });
    check("dispatchReview with no document loaded fails cleanly", reviewResult.ok === false && !!reviewResult.reason);

    const navResult = dispatcher.dispatchNavigation({ family: "navigation", type: "moveItem", direction: "next" });
    check("dispatchNavigation with no document loaded fails cleanly", navResult.ok === false && !!navResult.reason);

    const generateResult = await dispatcher.dispatchApplication({ family: "document", type: "generateOutput" });
    check("generateOutput with no document loaded fails cleanly", generateResult.ok === false && !!generateResult.reason);

    const saveResult = await dispatcher.dispatchApplication({ family: "document", type: "saveReviewSession" });
    check("saveReviewSession with no document loaded fails cleanly", saveResult.ok === false && !!saveResult.reason);

    const historyResult = dispatcher.dispatchHistory({ family: "history", type: "undo" });
    check(
      "history.undo is honestly rejected -- no engine owns reversible history yet",
      historyResult.ok === false && historyResult.reason!.includes("not yet implemented")
    );
  }

  console.log("--- Command-routing explanations (pure, no engine access needed) ---");
  {
    check(
      "review.* explains routing to ReviewEngine + reconciliation",
      explainCommandRouting({ family: "review", type: "keepCandidate", candidateId: "x" }).includes("ReviewEngine") &&
        explainCommandRouting({ family: "review", type: "keepCandidate", candidateId: "x" }).includes("reconcile")
    );
    check(
      "navigation.* explains routing to FocusNavigator only",
      explainCommandRouting({ family: "navigation", type: "moveItem", direction: "next" }).includes("FocusNavigator")
    );
    check(
      "document.* explains routing to Workspace orchestration",
      explainCommandRouting({ family: "document", type: "generateOutput" }).includes("Workspace")
    );
    check(
      "history.* explains that nothing owns it",
      explainCommandRouting({ family: "history", type: "redo" }).includes("no engine")
    );
  }

  console.log("--- Load document + run full pipeline ---");
  const workspace = new ReviewWorkspace({ clock: makeFixedClock(), sessionRepository: new InMemorySessionRepository() });
  const dispatcher = new WorkspaceCommandDispatcher(workspace);
  const entityResFile = loadSourceFile("entity-resolution-001");

  const loadResult = await dispatcher.dispatchApplication({ family: "document", type: "load", file: entityResFile });
  check("document.load succeeds against a real fixture", loadResult.ok === true, loadResult.reason);

  let state = dispatcher.getState();
  check("workspace reports documentLoaded: true after load", state.documentLoaded === true);
  check("workspace reports a documentId", typeof state.documentId === "string" && state.documentId.length > 0);
  check("workspace reports 5 stage statuses", state.stageStatuses.length === 5);
  check("initial focus starts in ambiguity-check", state.focus?.target.stage === "ambiguity-check");
  check("a fresh session has zero candidate decisions", Object.keys(state.reviewSession?.candidateDecisions ?? {}).length === 0);

  const ambiguityStage = state.stageStatuses.find((s) => s.stage === "ambiguity-check")!;
  const groupStage = state.stageStatuses.find((s) => s.stage === "group-check")!;
  const itemStage = state.stageStatuses.find((s) => s.stage === "item-check")!;
  check("group-check stage has at least one proposed group in this fixture", groupStage.itemCount > 0, `itemCount=${groupStage.itemCount}`);

  console.log("--- Review ambiguity (a plain candidate decision -- Phase 9's confirmed finding) ---");
  if (ambiguityStage.itemCount > 0) {
    const ambiguousCandidateId = state.stageStatuses.find((s) => s.stage === "ambiguity-check")!;
    void ambiguousCandidateId;
    // Navigate into ambiguity-check and read the actually-focused candidate
    // rather than reaching into GroupingResult directly -- exercising the
    // dispatcher's own navigation surface, not engine internals.
    dispatcher.dispatchNavigation({ family: "navigation", type: "focusStage", stage: "ambiguity-check" });
    state = dispatcher.getState();
    const focusedCandidateId = state.focus?.target.itemId;
    check("focus lands on a real candidate in ambiguity-check", typeof focusedCandidateId === "string");
    if (focusedCandidateId) {
      const decideResult = dispatcher.dispatchReview({ family: "review", type: "keepCandidate", candidateId: focusedCandidateId });
      check("reviewing an ambiguity-check candidate succeeds via the ordinary keepCandidate command", decideResult.ok === true, decideResult.reason);
      state = dispatcher.getState();
      check(
        "the decision is recorded in the SAME ReviewSession item-check reads from -- no separate ambiguity decision store",
        state.reviewSession?.candidateDecisions[focusedCandidateId]?.decision === "Keep"
      );
    }
  } else {
    check("ambiguity-check has no items in this fixture (acceptable -- skip)", true);
  }

  console.log("--- Review groups: enter Not Quite, navigate members, rename one, complete ---");
  dispatcher.dispatchNavigation({ family: "navigation", type: "focusStage", stage: "group-check" });
  state = dispatcher.getState();
  const groupId = state.focus?.target.itemId;
  check("focus lands on a real group in group-check", typeof groupId === "string");

  let renamedMemberId: string | null = null;
  if (groupId) {
    const enterResult = dispatcher.dispatchReview({ family: "review", type: "enterNotQuite", groupId });
    check("enterNotQuite succeeds for the focused group", enterResult.ok === true, enterResult.reason);
    state = dispatcher.getState();
    check("focus follows the opened Not Quite panel (reconciliation fired automatically)", state.focus?.target.panel.kind === "not-quite");

    const memberId = state.focus?.target.panel.kind === "not-quite" ? state.focus.target.panel.activeMemberId : null;
    check("Not Quite panel has an active member", typeof memberId === "string");

    if (memberId) {
      renamedMemberId = memberId;
      const renameResult = dispatcher.dispatchReview({
        family: "review",
        type: "applyNotQuiteMember",
        groupId,
        candidateId: memberId,
        action: "Rename",
        draftReplacement: "Redacted Person",
      });
      check("renaming a Not Quite member succeeds", renameResult.ok === true, renameResult.reason);
      state = dispatcher.getState();
      check("the rename is immediately visible as an ordinary candidate decision", state.reviewSession?.candidateDecisions[memberId]?.decision === "Rename");

      dispatcher.dispatchNavigation({ family: "navigation", type: "moveNotQuiteMember", direction: "next" });
      state = dispatcher.getState();

      // Keep every remaining member so completeNotQuite has real, decided
      // data underneath it (not required by Python's oracle, but a more
      // realistic end-to-end scenario than leaving them undecided). Read
      // straight off the durable session's own activeNotQuite.members --
      // the exact set enterNotQuite populated -- rather than reaching into
      // GroupingResult, which Workspace deliberately does not expose (see
      // Workspace.ts's doc comment on not duplicating engine-owned data).
      const groupCandidateIds = Object.keys(state.reviewSession?.activeNotQuite?.members ?? {});
      for (const candidateId of groupCandidateIds) {
        if (candidateId === memberId) continue;
        dispatcher.dispatchReview({ family: "review", type: "applyNotQuiteMember", groupId, candidateId, action: "Keep" });
      }

      const completeResult = dispatcher.dispatchReview({ family: "review", type: "completeNotQuite", groupId });
      check("completeNotQuite succeeds", completeResult.ok === true, completeResult.reason);
      const exitResult = dispatcher.dispatchReview({ family: "review", type: "exitNotQuite", groupId });
      check("exitNotQuite succeeds", exitResult.ok === true, exitResult.reason);
      state = dispatcher.getState();
      check("the panel closes after exiting Not Quite", state.focus?.target.panel.kind === "none");
      check("the group now has a Refined EntityGroupDecision", state.reviewSession?.groupDecisions[groupId]?.decision === "Refined");
    }
  }

  console.log("--- Escape/cancel context-sensitive routing via the keyboard resolver ---");
  {
    const secondGroupId = groupStage.itemCount > 1 ? findSecondGroupId(dispatcher) : null;
    if (secondGroupId) {
      dispatcher.dispatchNavigation({ family: "navigation", type: "focusStage", stage: "group-check" });
      dispatcher.dispatchNavigation({ family: "navigation", type: "selectItem", itemId: secondGroupId });
      const enterResult = dispatcher.dispatchReview({ family: "review", type: "enterNotQuite", groupId: secondGroupId });
      if (enterResult.ok) {
        const escapeCommand = dispatcher.resolveKeyboardCommand({ key: "Escape" });
        check("Escape resolves to review.exitNotQuite while a Not Quite panel is open", escapeCommand?.family === "review" && (escapeCommand as { type: string }).type === "exitNotQuite");
        if (escapeCommand && escapeCommand.family === "review") {
          const exitResult = dispatcher.dispatchReview(escapeCommand);
          check("dispatching the Escape-resolved command actually exits the panel", exitResult.ok === true);
          state = dispatcher.getState();
          check("panel is closed after routing Escape end-to-end", state.focus?.target.panel.kind === "none");
        }
      }
    } else {
      check("fixture has no second group to test cancel-via-Escape against (acceptable -- skip)", true);
    }
  }

  console.log("--- Review remaining items (Item Check), including rename/redact/ignore ---");
  {
    dispatcher.dispatchNavigation({ family: "navigation", type: "focusStage", stage: "item-check" });
    state = dispatcher.getState();
    let guard = 0;
    const decisionsToApply: Array<"keepCandidate" | "renameCandidate" | "redactCandidate" | "ignoreCandidate"> = [
      "keepCandidate",
      "redactCandidate",
      "ignoreCandidate",
      "keepCandidate",
    ];
    let cycle = 0;
    while (state.stageStatuses.find((s) => s.stage === "item-check")!.unresolvedCount > 0 && guard < itemStage.itemCount + 5) {
      const itemId = state.focus?.target.itemId;
      if (!itemId) break;
      const kind = decisionsToApply[cycle % decisionsToApply.length]!;
      cycle += 1;
      if (kind === "renameCandidate") {
        dispatcher.dispatchReview({ family: "review", type: "renameCandidate", candidateId: itemId, replacement: "Redacted Value" });
      } else {
        dispatcher.dispatchReview({ family: "review", type: kind, candidateId: itemId });
      }
      state = dispatcher.getState();
      guard += 1;
    }
    check("every item-check candidate is resolved after deciding each one", state.stageStatuses.find((s) => s.stage === "item-check")!.unresolvedCount === 0, `${state.stageStatuses.find((s) => s.stage === "item-check")!.unresolvedCount} left`);
  }

  console.log("--- Complete review: output/QA stages become available ---");
  {
    state = dispatcher.getState();
    check("review is now complete (output stage available)", state.readiness.reviewComplete === true);
    check("unresolved item count is zero", state.readiness.unresolvedItemCount === 0);
  }

  console.log("--- Generate output + verify readiness/export gating ---");
  {
    const generateResult = await dispatcher.dispatchApplication({ family: "document", type: "generateOutput" });
    check("generateOutput succeeds once review is complete", generateResult.ok === true, generateResult.reason);
    state = dispatcher.getState();
    check("a VerificationReport is now present", state.verification !== null);
    check("readiness.verificationCurrent is true immediately after generating output", state.readiness.verificationCurrent === true);
    check("readiness reports a boolean verificationPassed", typeof state.readiness.verificationPassed === "boolean");
    check(
      "exportEnabled exactly matches verificationCurrent && verificationPassed (no separate duplicated rule)",
      state.readiness.exportEnabled === (state.readiness.verificationCurrent && state.readiness.verificationPassed === true)
    );
  }

  console.log("--- Verification staleness: a post-verification decision invalidates it without an explicit call ---");
  {
    const beforeChange = dispatcher.getState();
    check("verification is current before making another change", beforeChange.readiness.verificationCurrent === true);
    if (renamedMemberId) {
      dispatcher.dispatchReview({ family: "review", type: "keepCandidate", candidateId: renamedMemberId });
    }
    const afterChange = dispatcher.getState();
    check("verification becomes stale (null) the moment the session changes again", afterChange.verification === null);
    check("readiness.verificationCurrent flips to false", afterChange.readiness.verificationCurrent === false);
    check("exportEnabled flips to false along with it", afterChange.readiness.exportEnabled === false);

    const regenerateResult = await dispatcher.dispatchApplication({ family: "document", type: "generateOutput" });
    check("regenerating output after the change succeeds", regenerateResult.ok === true, regenerateResult.reason);
    check("verification is current again after regenerating", dispatcher.getState().readiness.verificationCurrent === true);
  }

  console.log("--- Save session, reload session, resume focus ---");
  {
    dispatcher.dispatchNavigation({ family: "navigation", type: "focusStage", stage: "group-check" });
    const savePosition = dispatcher.getState().focus;
    const saveCommandResult = await dispatcher.dispatchApplication({ family: "document", type: "saveReviewSession" });
    check("saveReviewSession succeeds", saveCommandResult.ok === true, saveCommandResult.reason);
    const savedJson = dispatcher.getLastSaveFile();
    check("a save file JSON string is produced", typeof savedJson === "string" && savedJson!.length > 0);

    if (savedJson) {
      const deserialized = deserializeWorkspaceSaveFile(savedJson);
      check("the saved file deserializes cleanly", deserialized.ok === true);

      if (deserialized.ok) {
        // Simulate a full reload: a BRAND NEW Workspace/dispatcher, as if
        // the reviewer closed and reopened the application.
        const reloadedWorkspace = new ReviewWorkspace({ clock: makeFixedClock(), sessionRepository: new InMemorySessionRepository() });
        const reloadedDispatcher = new WorkspaceCommandDispatcher(reloadedWorkspace);
        const sameFileAgain = loadSourceFile("entity-resolution-001");

        const restoreResult = await reloadedDispatcher.loadSavedSession(sameFileAgain, deserialized.saveFile);
        check("reloading the SAME source file restores the saved session", restoreResult.ok === true, restoreResult.reason);

        const reloadedState = reloadedDispatcher.getState();
        check(
          "reloaded candidateDecisions exactly match the saved session's",
          JSON.stringify(reloadedState.reviewSession?.candidateDecisions) === JSON.stringify(deserialized.saveFile.reviewSession.candidateDecisions)
        );
        check(
          "reloaded groupDecisions exactly match the saved session's",
          JSON.stringify(reloadedState.reviewSession?.groupDecisions) === JSON.stringify(deserialized.saveFile.reviewSession.groupDecisions)
        );
        check(
          "resumed focus lands back on the stage that was active at save time",
          reloadedState.focus?.target.stage === savePosition?.target.stage
        );

        console.log("--- Wrong-document session-restore rejection ---");
        const wrongFile = loadSourceFile("synthetic-transcript-001");
        const wrongWorkspace = new ReviewWorkspace({ clock: makeFixedClock(), sessionRepository: new InMemorySessionRepository() });
        const wrongDispatcher = new WorkspaceCommandDispatcher(wrongWorkspace);
        const mismatchResult = await wrongDispatcher.loadSavedSession(wrongFile, deserialized.saveFile);
        check("restoring a save file against the WRONG document is rejected", mismatchResult.ok === false && !!mismatchResult.reason);
        check(
          "the wrong document still loads fine with a fresh session rather than failing outright",
          wrongDispatcher.getState().documentLoaded === true
        );
        check(
          "the fresh session on the wrong document has no decisions from the mismatched save file",
          Object.keys(wrongDispatcher.getState().reviewSession?.candidateDecisions ?? {}).length === 0
        );
      }
    }
  }

  console.log("--- Resume Not Quite across a reload (mid-transaction) ---");
  {
    const midWorkspace = new ReviewWorkspace({ clock: makeFixedClock(), sessionRepository: new InMemorySessionRepository() });
    const midDispatcher = new WorkspaceCommandDispatcher(midWorkspace);
    const midFile = loadSourceFile("entity-resolution-001");
    await midDispatcher.dispatchApplication({ family: "document", type: "load", file: midFile });
    midDispatcher.dispatchNavigation({ family: "navigation", type: "focusStage", stage: "group-check" });
    const midGroupId = midDispatcher.getState().focus?.target.itemId;

    if (midGroupId) {
      const enterResult = midDispatcher.dispatchReview({ family: "review", type: "enterNotQuite", groupId: midGroupId });
      check("Not Quite opened for the mid-transaction resume scenario", enterResult.ok === true, enterResult.reason);

      await midDispatcher.dispatchApplication({ family: "document", type: "saveReviewSession" });
      const midSaveJson = midDispatcher.getLastSaveFile();
      const midDeserialized = midSaveJson ? deserializeWorkspaceSaveFile(midSaveJson) : null;
      check("saving mid-Not-Quite-transaction produces a valid save file", !!midDeserialized?.ok);

      if (midDeserialized?.ok) {
        const resumedWorkspace = new ReviewWorkspace({ clock: makeFixedClock(), sessionRepository: new InMemorySessionRepository() });
        const resumedDispatcher = new WorkspaceCommandDispatcher(resumedWorkspace);
        const midFileAgain = loadSourceFile("entity-resolution-001");
        const restoreResult = await resumedDispatcher.loadSavedSession(midFileAgain, midDeserialized.saveFile);
        check("reloading a mid-Not-Quite-transaction save succeeds", restoreResult.ok === true, restoreResult.reason);

        const resumedState = resumedDispatcher.getState();
        check("the reloaded session still has an OPEN Not Quite transaction", resumedState.reviewSession?.activeNotQuite?.transactionStatus === "open");
        check(
          "focus reconciliation (run automatically during restore) re-opens the Not Quite panel on its own, even though the resume position itself only recorded stage+itemId",
          resumedState.focus?.target.panel.kind === "not-quite"
        );
        check(
          "the reconstructed panel targets the correct group",
          resumedState.focus?.target.panel.kind === "not-quite" && resumedState.focus.target.panel.groupId === midGroupId
        );
      }
    } else {
      check("fixture had no group available for the mid-transaction resume scenario (acceptable -- skip)", true);
    }
  }

  console.log(`\n${passCount}/${passCount + failCount} checks passed`);
  process.exitCode = failCount === 0 ? 0 : 1;
}

/** Navigates to the second group in group-check (if one exists) and
 *  returns its ID, purely via the dispatcher's own navigation surface --
 *  never by reaching into GroupingResult directly. */
function findSecondGroupId(dispatcher: WorkspaceCommandDispatcher): string | null {
  dispatcher.dispatchNavigation({ family: "navigation", type: "focusStage", stage: "group-check" });
  const first = dispatcher.getState().focus?.target.itemId ?? null;
  dispatcher.dispatchNavigation({ family: "navigation", type: "moveItem", direction: "next" });
  const second = dispatcher.getState().focus?.target.itemId ?? null;
  return second && second !== first ? second : null;
}

main();
