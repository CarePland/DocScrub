/**
 * Verification harness for Phase 9: DeterministicFocusNavigator (src/engines/
 * FocusNavigator.ts) and its supporting pure modules navigation/navigator.ts
 * (applyNavigationCommand/reconcile/restoreFocusState), navigation/stages.ts
 * (itemIdsForStage/isItemResolved/computeStageStatus), navigation/keymap.ts
 * (resolveKeyboardCommand), and domain/FocusResumePosition.ts.
 *
 * Like verify/review-engine-verification.ts, this is a property/behavior
 * suite, not a fixture-diff-against-Python harness: there is no Python
 * "expected focus state" fixture -- Python's own navigation state
 * (activeKey, notQuiteActiveMember, etc.) is transient client-side JS, never
 * persisted or exported as a domain-parity fixture. Run against REAL
 * pipeline output (Detection -> Quality -> EntityResolution ->
 * OccurrenceClassifier) through a REAL DurableReviewEngine, per Andrew's
 * Phase 9 instruction ("a dedicated verification suite using real pipeline
 * output").
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/focus-navigator-verification.ts
 */

import { OoxmlDocumentParser } from "../src/io/DocumentParser.ts";
import { RegexDetectionEngine } from "../src/engines/DetectionEngine.ts";
import { RegexCandidateQualityEngine, buildDefaultScoringProfileSnapshot } from "../src/engines/CandidateQualityEngine.ts";
import { RegexEntityResolutionEngine } from "../src/engines/EntityResolutionEngine.ts";
import { RegexOccurrenceClassifier } from "../src/engines/OccurrenceClassifier.ts";
import { DurableReviewEngine } from "../src/engines/ReviewEngine.ts";
import { createReviewSession } from "../src/engines/review/session.ts";
import { serializeReviewSession, deserializeReviewSession } from "../src/engines/review/serialization.ts";
import { DeterministicFocusNavigator } from "../src/engines/FocusNavigator.ts";
import { itemIdsForStage, isItemResolved } from "../src/engines/navigation/stages.ts";
import { WORKFLOW_STAGE_ORDER } from "../src/domain/FocusState.ts";
import type { FocusState } from "../src/domain/FocusState.ts";
import { deserializeFocusResumePosition, serializeFocusResumePosition } from "../src/domain/FocusResumePosition.ts";
import type { FocusResumePosition } from "../src/domain/FocusResumePosition.ts";
import type { DetectionResult } from "../src/engines/DetectionEngine.ts";
import type { GroupingResult } from "../src/engines/EntityResolutionEngine.ts";
import type { OccurrenceClassificationResult } from "../src/engines/OccurrenceClassifier.ts";
import { loadSourceFile } from "./fixture-io.ts";

const FIXED_SCORING_TIMESTAMP = "2026-07-27T00:00:00.000Z";

/** Each engine gets its OWN independent tick counter -- same rationale as
 *  review-engine-verification.ts's makeFixedClock(). */
function makeFixedClock(): () => string {
  let tick = 0;
  return () => {
    tick += 1;
    return `2026-07-28T00:00:${String(tick).padStart(2, "0")}.000Z`;
  };
}

interface Fixture {
  detection: DetectionResult;
  grouping: GroupingResult;
  classification: OccurrenceClassificationResult;
}

async function loadFixture(caseId: string): Promise<Fixture> {
  const file = loadSourceFile(caseId);
  const model = await new OoxmlDocumentParser().parse(file);
  const detection = new RegexDetectionEngine().detect(model);
  const profile = buildDefaultScoringProfileSnapshot(FIXED_SCORING_TIMESTAMP);
  const quality = new RegexCandidateQualityEngine().evaluate(model, detection, profile);
  const grouping = new RegexEntityResolutionEngine().propose(detection, quality);
  const classification = new RegexOccurrenceClassifier().classify(model, detection, quality, grouping);
  return { detection, grouping, classification };
}

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

function freshReviewEngine(fixture: Fixture, sessionId: string): DurableReviewEngine {
  const clock = makeFixedClock();
  const session = createReviewSession(sessionId, "doc-under-test", clock());
  return new DurableReviewEngine(fixture.detection, fixture.grouping, session, clock);
}

function freshNavigator(fixture: Fixture, session: ReturnType<DurableReviewEngine["getState"]>): DeterministicFocusNavigator {
  return new DeterministicFocusNavigator(fixture, session);
}

async function main(): Promise<void> {
  const transcript = await loadFixture("synthetic-transcript-001");
  const entityRes = await loadFixture("entity-resolution-001");

  console.log("--- Stable initial focus ---");
  {
    const engine = freshReviewEngine(transcript, "s-initial");
    const navA = freshNavigator(transcript, engine.getState());
    const navB = freshNavigator(transcript, engine.getState());
    check("initial focus starts in ambiguity-check", navA.getFocus().target.stage === "ambiguity-check");
    check("initial focus has no panel open", navA.getFocus().target.panel.kind === "none");
    check("initial focus has no drilled-down occurrence", navA.getFocus().target.occurrenceId === undefined);
    check("textInputActive starts false", navA.getFocus().textInputActive === false);
    check(
      "two independently-constructed navigators over identical (fixture, session) produce byte-identical initial focus -- no dependence on Map/insertion order",
      JSON.stringify(navA.getFocus()) === JSON.stringify(navB.getFocus())
    );
  }

  console.log("--- Item Check: next/previous/first/last traversal + boundary clamping ---");
  {
    const engine = freshReviewEngine(transcript, "s-traverse");
    const nav = freshNavigator(transcript, engine.getState());
    nav.dispatch({ family: "navigation", type: "focusStage", stage: "item-check" }, engine.getState());
    const itemIds = itemIdsForStage("item-check", transcript);
    check("item-check has multiple candidates to traverse in this fixture", itemIds.length > 1, `only ${itemIds.length}`);

    nav.dispatch({ family: "navigation", type: "selectItem", itemId: itemIds[0]! }, engine.getState());
    nav.dispatch({ family: "navigation", type: "moveItem", direction: "next" }, engine.getState());
    check("moveItem next advances to the second item", nav.getFocus().target.itemId === itemIds[1]);
    nav.dispatch({ family: "navigation", type: "moveItem", direction: "previous" }, engine.getState());
    check("next then previous returns to the original item", nav.getFocus().target.itemId === itemIds[0]);

    nav.dispatch({ family: "navigation", type: "moveItem", direction: "last" }, engine.getState());
    check("moveItem last lands on the final item", nav.getFocus().target.itemId === itemIds[itemIds.length - 1]);
    const atLast = nav.dispatch({ family: "navigation", type: "moveItem", direction: "next" }, engine.getState());
    check("moveItem next at the last item is a graceful no-op (never an error)", atLast.ok === true);
    check("clamped focus stays on the last item -- no wraparound", nav.getFocus().target.itemId === itemIds[itemIds.length - 1]);

    nav.dispatch({ family: "navigation", type: "moveItem", direction: "first" }, engine.getState());
    check("moveItem first lands on the first item", nav.getFocus().target.itemId === itemIds[0]);
    const atFirst = nav.dispatch({ family: "navigation", type: "moveItem", direction: "previous" }, engine.getState());
    check("moveItem previous at the first item is a graceful no-op", atFirst.ok === true);
    check("clamped focus stays on the first item -- no wraparound", nav.getFocus().target.itemId === itemIds[0]);
  }

  console.log("--- selectItem validation + occurrence drill-down (enterItem/closeItem) ---");
  {
    const engine = freshReviewEngine(transcript, "s-select");
    const nav = freshNavigator(transcript, engine.getState());
    nav.dispatch({ family: "navigation", type: "focusStage", stage: "item-check" }, engine.getState());
    const itemIds = itemIdsForStage("item-check", transcript);

    const bad = nav.dispatch({ family: "navigation", type: "selectItem", itemId: "no-such-candidate" }, engine.getState());
    check("selectItem with an unknown itemId is rejected", bad.ok === false && !!bad.reason);

    const good = nav.dispatch({ family: "navigation", type: "selectItem", itemId: itemIds[0]! }, engine.getState());
    check("selectItem with a real itemId succeeds", good.ok === true);
    check("selectItem lands exactly on the requested item", nav.getFocus().target.itemId === itemIds[0]);

    nav.dispatch({ family: "navigation", type: "enterItem" }, engine.getState());
    const hasOccurrence = transcript.classification.reviewOccurrences.some((o) => o.candidateId === itemIds[0]);
    if (hasOccurrence) {
      check("enterItem drills into the focused candidate's first occurrence", nav.getFocus().target.occurrenceId !== undefined);
      nav.dispatch({ family: "navigation", type: "closeItem" }, engine.getState());
      check("closeItem returns to the item level (no occurrence)", nav.getFocus().target.occurrenceId === undefined);
    }
  }

  console.log("--- Stage transitions + boundary clamping ---");
  {
    const engine = freshReviewEngine(transcript, "s-stages");
    const nav = freshNavigator(transcript, engine.getState());

    const atFirstStage = nav.dispatch({ family: "navigation", type: "moveStage", direction: "previous" }, engine.getState());
    check("moveStage previous at the first stage is a graceful no-op", atFirstStage.ok === true);
    check("stage stays at ambiguity-check -- no wraparound", nav.getFocus().target.stage === "ambiguity-check");

    for (const stage of WORKFLOW_STAGE_ORDER) {
      nav.dispatch({ family: "navigation", type: "focusStage", stage }, engine.getState());
      check(`focusStage lands on ${stage}`, nav.getFocus().target.stage === stage);
      check(`focusStage into ${stage} always resets the panel to none`, nav.getFocus().target.panel.kind === "none");
    }

    nav.dispatch({ family: "navigation", type: "focusStage", stage: "output" }, engine.getState());
    const atLastStage = nav.dispatch({ family: "navigation", type: "moveStage", direction: "next" }, engine.getState());
    check("moveStage next at the last stage is a graceful no-op", atLastStage.ok === true);
    check("stage stays at output -- no wraparound", nav.getFocus().target.stage === "output");

    nav.dispatch({ family: "navigation", type: "focusStage", stage: "ambiguity-check" }, engine.getState());
    nav.dispatch({ family: "navigation", type: "moveStage", direction: "next" }, engine.getState());
    check("moveStage next steps from ambiguity-check to group-check", nav.getFocus().target.stage === "group-check");
  }

  console.log("--- Empty-stage behavior (qa/output have no per-item traversal model) ---");
  {
    const engine = freshReviewEngine(transcript, "s-empty-stage");
    const nav = freshNavigator(transcript, engine.getState());
    nav.dispatch({ family: "navigation", type: "focusStage", stage: "qa" }, engine.getState());
    check("qa stage has no itemId", nav.getFocus().target.itemId === null);
    const moveInEmpty = nav.dispatch({ family: "navigation", type: "moveItem", direction: "next" }, engine.getState());
    check("moveItem within an empty stage is a graceful no-op, not an error", moveInEmpty.ok === true);
    check("itemId remains null", nav.getFocus().target.itemId === null);
  }

  console.log("--- Unresolved-only traversal (nextUnresolved / previousUnresolved) ---");
  {
    const engine = freshReviewEngine(transcript, "s-unresolved-traverse");
    const itemIds = itemIdsForStage("item-check", transcript);
    check("fixture has at least 3 item-check candidates for this test", itemIds.length >= 3, `only ${itemIds.length}`);
    if (itemIds.length >= 3) {
      engine.dispatch({ family: "review", type: "keepCandidate", candidateId: itemIds[0]! });
      engine.dispatch({ family: "review", type: "ignoreCandidate", candidateId: itemIds[1]! });
      // itemIds[2] is left undecided; every OTHER item is decided so it is
      // genuinely the only unresolved item in the stage (a fixture with
      // more than 3 candidates would otherwise leave a later item
      // undecided too, which findUnresolved's backward-then-forward search
      // would correctly prefer over falling back to self).
      for (let i = 3; i < itemIds.length; i++) {
        engine.dispatch({ family: "review", type: "keepCandidate", candidateId: itemIds[i]! });
      }
      const nav = freshNavigator(transcript, engine.getState());
      nav.dispatch({ family: "navigation", type: "focusStage", stage: "item-check" }, engine.getState());
      nav.dispatch({ family: "navigation", type: "selectItem", itemId: itemIds[0]! }, engine.getState());
      nav.dispatch({ family: "navigation", type: "moveItem", direction: "nextUnresolved" }, engine.getState());
      check("nextUnresolved skips the two already-decided items and lands on the first undecided one", nav.getFocus().target.itemId === itemIds[2]);

      nav.dispatch({ family: "navigation", type: "moveItem", direction: "previousUnresolved" }, engine.getState());
      check(
        "previousUnresolved from the only unresolved item falls back to itself -- no other unresolved item exists in either direction",
        nav.getFocus().target.itemId === itemIds[2]
      );
    }
  }

  console.log("--- Focus reconciliation after a decision (dispatch vs. reconcile are separate) ---");
  {
    const engine = freshReviewEngine(transcript, "s-reconcile-decision");
    const itemIds = itemIdsForStage("item-check", transcript);
    const nav = freshNavigator(transcript, engine.getState());
    nav.dispatch({ family: "navigation", type: "focusStage", stage: "item-check" }, engine.getState());
    nav.dispatch({ family: "navigation", type: "selectItem", itemId: itemIds[0]! }, engine.getState());
    check("focus is on the first item before any decision", nav.getFocus().target.itemId === itemIds[0]);

    engine.dispatch({ family: "review", type: "keepCandidate", candidateId: itemIds[0]! });
    check("FocusNavigator does not react to a ReviewEngine change until reconcile() is called", nav.getFocus().target.itemId === itemIds[0]);

    nav.reconcile(engine.getState());
    check("reconcile() after a decision advances off the now-resolved item", nav.getFocus().target.itemId !== itemIds[0]);
    const expectedNext = itemIds.slice(1).find((id) => !isItemResolved("item-check", id, transcript, engine.getState()));
    check("reconcile() lands on the nearest still-unresolved item, not an arbitrary one", nav.getFocus().target.itemId === expectedNext);
  }

  console.log("--- Focus reconciliation after Keep/Rename/Redact/Ignore ---");
  {
    const itemIds = itemIdsForStage("item-check", transcript);
    check("fixture has at least 4 candidates to test all four decision kinds independently", itemIds.length >= 4, `only ${itemIds.length}`);
    if (itemIds.length >= 4) {
      const [keepId, renameId, redactId, ignoreId] = itemIds;

      const engineKeep = freshReviewEngine(transcript, "s-reconcile-keep");
      const navKeep = freshNavigator(transcript, engineKeep.getState());
      navKeep.dispatch({ family: "navigation", type: "focusStage", stage: "item-check" }, engineKeep.getState());
      navKeep.dispatch({ family: "navigation", type: "selectItem", itemId: keepId! }, engineKeep.getState());
      engineKeep.dispatch({ family: "review", type: "keepCandidate", candidateId: keepId! });
      navKeep.reconcile(engineKeep.getState());
      check("focus moves off the item after Keep", navKeep.getFocus().target.itemId !== keepId);

      const engineRename = freshReviewEngine(transcript, "s-reconcile-rename");
      const navRename = freshNavigator(transcript, engineRename.getState());
      navRename.dispatch({ family: "navigation", type: "focusStage", stage: "item-check" }, engineRename.getState());
      navRename.dispatch({ family: "navigation", type: "selectItem", itemId: renameId! }, engineRename.getState());
      engineRename.dispatch({ family: "review", type: "renameCandidate", candidateId: renameId!, replacement: "Redacted Person" });
      navRename.reconcile(engineRename.getState());
      check("focus moves off the item after Rename", navRename.getFocus().target.itemId !== renameId);

      const engineRedact = freshReviewEngine(transcript, "s-reconcile-redact");
      const navRedact = freshNavigator(transcript, engineRedact.getState());
      navRedact.dispatch({ family: "navigation", type: "focusStage", stage: "item-check" }, engineRedact.getState());
      navRedact.dispatch({ family: "navigation", type: "selectItem", itemId: redactId! }, engineRedact.getState());
      engineRedact.dispatch({ family: "review", type: "redactCandidate", candidateId: redactId! });
      navRedact.reconcile(engineRedact.getState());
      check("focus moves off the item after Redact", navRedact.getFocus().target.itemId !== redactId);

      const engineIgnore = freshReviewEngine(transcript, "s-reconcile-ignore");
      const navIgnore = freshNavigator(transcript, engineIgnore.getState());
      navIgnore.dispatch({ family: "navigation", type: "focusStage", stage: "item-check" }, engineIgnore.getState());
      navIgnore.dispatch({ family: "navigation", type: "selectItem", itemId: ignoreId! }, engineIgnore.getState());
      engineIgnore.dispatch({ family: "review", type: "ignoreCandidate", candidateId: ignoreId! });
      navIgnore.reconcile(engineIgnore.getState());
      check("focus moves off the item after Ignore", navIgnore.getFocus().target.itemId !== ignoreId);
    }
  }

  console.log("--- Not Quite: open, navigate members, complete ---");
  {
    const group = entityRes.grouping.entityGroupProposals[0];
    if (!group) throw new Error("entity-resolution-001 fixture has no entity group proposals");
    const engine = freshReviewEngine(entityRes, "s-notquite-navigate");
    const nav = freshNavigator(entityRes, engine.getState());

    nav.dispatch({ family: "navigation", type: "focusStage", stage: "group-check" }, engine.getState());
    nav.dispatch({ family: "navigation", type: "selectItem", itemId: group.groupId }, engine.getState());

    engine.dispatch({ family: "review", type: "enterNotQuite", groupId: group.groupId });
    nav.reconcile(engine.getState());
    check("reconcile() follows an opened Not Quite panel into view", nav.getFocus().target.panel.kind === "not-quite");
    const panel1 = nav.getFocus().target.panel;
    check("Not Quite panel targets the correct group", panel1.kind === "not-quite" && panel1.groupId === group.groupId);
    check(
      "Not Quite panel's initial active member matches ReviewSession's own activeMemberId",
      panel1.kind === "not-quite" && panel1.activeMemberId === engine.getState().activeNotQuite?.activeMemberId
    );

    if (group.candidateIds.length > 1) {
      const panelBefore = nav.getFocus().target.panel;
      const beforeMove = panelBefore.kind === "not-quite" ? panelBefore.activeMemberId : null;
      nav.dispatch({ family: "navigation", type: "moveNotQuiteMember", direction: "next" }, engine.getState());
      const panelAfterNext = nav.getFocus().target.panel;
      const afterNext = panelAfterNext.kind === "not-quite" ? panelAfterNext.activeMemberId : null;
      check("moveNotQuiteMember next moves the transient member cursor", afterNext !== beforeMove);
      nav.dispatch({ family: "navigation", type: "moveNotQuiteMember", direction: "previous" }, engine.getState());
      const panelAfterPrevious = nav.getFocus().target.panel;
      const afterPrevious = panelAfterPrevious.kind === "not-quite" ? panelAfterPrevious.activeMemberId : null;
      check("moveNotQuiteMember next then previous returns the cursor to its original position", afterPrevious === beforeMove);
    }

    const outsideCommand = nav.dispatch({ family: "navigation", type: "moveItem", direction: "next" }, engine.getState());
    check("moveItem is rejected while a Not Quite panel is open -- use moveNotQuiteMember instead", outsideCommand.ok === false);

    for (const candidateId of group.candidateIds) {
      engine.dispatch({ family: "review", type: "applyNotQuiteMember", groupId: group.groupId, candidateId, action: "Keep" });
    }
    engine.dispatch({ family: "review", type: "completeNotQuite", groupId: group.groupId });
    engine.dispatch({ family: "review", type: "exitNotQuite", groupId: group.groupId });
    nav.reconcile(engine.getState());
    check("reconcile() clears the Not Quite panel once the transaction is exited", nav.getFocus().target.panel.kind === "none");
    check("the completed group is treated as resolved", isItemResolved("group-check", group.groupId, entityRes, engine.getState()));
  }

  console.log("--- Not Quite: cancel without completing ---");
  {
    const group = entityRes.grouping.entityGroupProposals[0]!;
    const engine = freshReviewEngine(entityRes, "s-notquite-cancel");
    const nav = freshNavigator(entityRes, engine.getState());
    nav.dispatch({ family: "navigation", type: "focusStage", stage: "group-check" }, engine.getState());
    nav.dispatch({ family: "navigation", type: "selectItem", itemId: group.groupId }, engine.getState());

    engine.dispatch({ family: "review", type: "enterNotQuite", groupId: group.groupId });
    nav.reconcile(engine.getState());
    check("Not Quite panel is open before cancel", nav.getFocus().target.panel.kind === "not-quite");

    engine.dispatch({ family: "review", type: "exitNotQuite", groupId: group.groupId }); // exit without completeNotQuite -- a cancel
    nav.reconcile(engine.getState());
    check("reconcile() clears the panel after a cancelled (uncompleted) Not Quite", nav.getFocus().target.panel.kind === "none");
    check("a cancelled Not Quite leaves the group unresolved -- no EntityGroupDecision was recorded", engine.getState().groupDecisions[group.groupId] === undefined);
    check("focus remains on the still-unresolved group after cancel", nav.getFocus().target.itemId === group.groupId);
  }

  console.log("--- Focus recovery when the active item is no longer available ---");
  {
    const engine = freshReviewEngine(transcript, "s-recovery");
    const itemIds = itemIdsForStage("item-check", transcript);
    const bogusFocus: FocusState = {
      target: { stage: "item-check", itemId: "a-candidate-id-that-was-excluded-or-removed", panel: { kind: "none" } },
      textInputActive: false,
    };
    const nav = new DeterministicFocusNavigator(transcript, engine.getState(), bogusFocus);
    nav.reconcile(engine.getState());
    check(
      "reconcile() recovers a real item after the previously-active one is no longer available",
      nav.getFocus().target.itemId !== null && itemIds.includes(nav.getFocus().target.itemId!)
    );
  }

  console.log("--- All-complete behavior ---");
  {
    const engine = freshReviewEngine(transcript, "s-all-complete");
    const itemIds = itemIdsForStage("item-check", transcript);
    for (const id of itemIds) engine.dispatch({ family: "review", type: "keepCandidate", candidateId: id });
    const session = engine.getState();

    const nav = freshNavigator(transcript, session);
    check("item-check stage status is complete once every candidate is decided", nav.stageStatus("item-check", session).completion === "complete");
    check("qa stage becomes available once item-check is complete", nav.stageStatus("qa", session).available === true);
    check("output stage becomes available once item-check is complete", nav.stageStatus("output", session).available === true);

    nav.dispatch({ family: "navigation", type: "focusStage", stage: "item-check" }, session);
    nav.dispatch({ family: "navigation", type: "selectItem", itemId: itemIds[0]! }, session);
    const nextUnresolvedResult = nav.dispatch({ family: "navigation", type: "moveItem", direction: "nextUnresolved" }, session);
    check("nextUnresolved on a fully-resolved stage is a graceful no-op, falling back to the current item", nextUnresolvedResult.ok === true);
    check("focus stays on the same item since none are unresolved", nav.getFocus().target.itemId === itemIds[0]);
  }

  console.log("--- Command-namespace resolution: Item Check ---");
  {
    const engine = freshReviewEngine(transcript, "s-keymap-item");
    const itemIds = itemIdsForStage("item-check", transcript);
    const nav = freshNavigator(transcript, engine.getState());
    nav.dispatch({ family: "navigation", type: "focusStage", stage: "item-check" }, engine.getState());
    nav.dispatch({ family: "navigation", type: "selectItem", itemId: itemIds[0]! }, engine.getState());

    const keepCmd = nav.resolveKey({ key: "k" });
    check('"k" resolves to review.keepCandidate for the focused item', JSON.stringify(keepCmd) === JSON.stringify({ family: "review", type: "keepCandidate", candidateId: itemIds[0] }));

    const ignoreCmd = nav.resolveKey({ key: "I" });
    check(
      '"I" (uppercase) resolves to review.ignoreCandidate -- case-insensitive, per review_queue.py\'s shortcut_to_action',
      JSON.stringify(ignoreCmd) === JSON.stringify({ family: "review", type: "ignoreCandidate", candidateId: itemIds[0] })
    );

    const modified = nav.resolveKey({ key: "k", meta: true });
    check("a modified keystroke (Cmd+K) is never treated as a decision shortcut", modified === null);

    const arrowNext = nav.resolveKey({ key: "ArrowDown" });
    check("ArrowDown resolves to navigation.moveItem next", JSON.stringify(arrowNext) === JSON.stringify({ family: "navigation", type: "moveItem", direction: "next" }));

    nav.setTextInputActive(true);
    const whileTyping = nav.resolveKey({ key: "k" });
    check("no key resolves to a command while a text input owns the caret", whileTyping === null);
    nav.setTextInputActive(false);
  }

  console.log("--- Command-namespace resolution: Group Check ---");
  {
    const group = entityRes.grouping.entityGroupProposals[0]!;
    const engine = freshReviewEngine(entityRes, "s-keymap-group");
    const nav = freshNavigator(entityRes, engine.getState());
    nav.dispatch({ family: "navigation", type: "focusStage", stage: "group-check" }, engine.getState());
    nav.dispatch({ family: "navigation", type: "selectItem", itemId: group.groupId }, engine.getState());

    // RELABELED (2026-07-29, interaction model revision): "q" (Not Quite)
    // -> "f" (Fix this); see keymap.ts's top doc comment.
    const enterNotQuiteCmd = nav.resolveKey({ key: "f" });
    check('"f" resolves to review.enterNotQuite for the focused group', JSON.stringify(enterNotQuiteCmd) === JSON.stringify({ family: "review", type: "enterNotQuite", groupId: group.groupId }));
    const oldNotQuiteKey = nav.resolveKey({ key: "q" });
    check('"q" no longer resolves to anything -- freed by the Not Quite -> Fix this relabeling', oldNotQuiteKey === null);

    // Feature 001 (first post-migration feature, group bulk actions),
    // terminology and scope revised in v9 (Commands.ts), letters revised
    // again in the 2026-07-29 interaction model revision: "k"/"i" still
    // resolve straight to confirmGroup/ignoreGroup (neither ever needed
    // reviewer-typed text). "n" (formerly Rename/flattenGroup) and "r"
    // (Redact/redactGroup) NO LONGER resolve directly -- both now fall
    // through to null so the UI layer's inline editor opens instead (the
    // same "c"/"r" -> editor fallback Item Check already used), closing the
    // pre-existing inconsistency where the group-level keyboard path
    // bypassed that editor while the buttons did not. "x" (Reject) remains
    // removed along with rejectGroup.
    const confirmCmdInGroupCheck = nav.resolveKey({ key: "k" });
    check(
      '"k" resolves to review.confirmGroup for the focused group',
      JSON.stringify(confirmCmdInGroupCheck) === JSON.stringify({ family: "review", type: "confirmGroup", groupId: group.groupId })
    );
    const ignoreCmdInGroupCheck = nav.resolveKey({ key: "i" });
    check(
      '"i" resolves to review.ignoreGroup for the focused group (v9: fills the slot reserved since Feature 001)',
      JSON.stringify(ignoreCmdInGroupCheck) === JSON.stringify({ family: "review", type: "ignoreGroup", groupId: group.groupId })
    );
    const changeCmdInGroupCheck = nav.resolveKey({ key: "c" });
    check('"c" (Change) no longer resolves directly -- the UI layer opens the inline editor instead', changeCmdInGroupCheck === null);
    const oldFlattenKey = nav.resolveKey({ key: "n" });
    check('"n" no longer resolves to anything -- freed by the Rename -> Change relabeling', oldFlattenKey === null);
    const redactCmdInGroupCheck = nav.resolveKey({ key: "r" });
    check('"r" (Redact) no longer resolves directly -- the UI layer opens the inline editor instead, same as "c"', redactCmdInGroupCheck === null);
    const rejectCmdInGroupCheck = nav.resolveKey({ key: "x" });
    check('"x" (Reject) no longer resolves to anything -- rejectGroup was removed in v9', rejectCmdInGroupCheck === null);

    // NEW (2026-07-29): Tab/Shift+Tab move between groups, same as
    // ArrowDown/Right and ArrowUp/Left -- see tabDirection's own doc
    // comment for why arrows are left resolving here too rather than
    // removed (a graceful fallback for whenever nothing in the row has real
    // DOM focus yet).
    const tabCmd = nav.resolveKey({ key: "Tab" });
    check('Tab resolves to navigation.moveItem "next" in Group Check', JSON.stringify(tabCmd) === JSON.stringify({ family: "navigation", type: "moveItem", direction: "next" }));
    const shiftTabCmd = nav.resolveKey({ key: "Tab", shift: true });
    check('Shift+Tab resolves to navigation.moveItem "previous" in Group Check', JSON.stringify(shiftTabCmd) === JSON.stringify({ family: "navigation", type: "moveItem", direction: "previous" }));
    const ctrlTabCmd = nav.resolveKey({ key: "Tab", ctrl: true });
    check("Ctrl+Tab is left alone (real browser tab-switching shortcut), not treated as moveItem", ctrlTabCmd === null);
  }

  console.log("--- Command-namespace resolution: Not Quite panel ---");
  {
    const group = entityRes.grouping.entityGroupProposals[0]!;
    const engine = freshReviewEngine(entityRes, "s-keymap-notquite");
    const nav = freshNavigator(entityRes, engine.getState());
    nav.dispatch({ family: "navigation", type: "focusStage", stage: "group-check" }, engine.getState());
    nav.dispatch({ family: "navigation", type: "selectItem", itemId: group.groupId }, engine.getState());
    engine.dispatch({ family: "review", type: "enterNotQuite", groupId: group.groupId });
    nav.reconcile(engine.getState());

    const activeMemberId = engine.getState().activeNotQuite?.activeMemberId;
    check("Not Quite panel has an active member to test against", !!activeMemberId);
    if (activeMemberId) {
      const keepMember = nav.resolveKey({ key: "k" });
      check(
        '"k" inside an open Not Quite panel resolves to applyNotQuiteMember Keep',
        JSON.stringify(keepMember) === JSON.stringify({ family: "review", type: "applyNotQuiteMember", groupId: group.groupId, candidateId: activeMemberId, action: "Keep" })
      );

      const ignoreMember = nav.resolveKey({ key: "i" });
      check(
        '"i" inside an open Not Quite panel resolves to applyNotQuiteMember Ignore -- the keymap bug fixed this phase',
        JSON.stringify(ignoreMember) === JSON.stringify({ family: "review", type: "applyNotQuiteMember", groupId: group.groupId, candidateId: activeMemberId, action: "Ignore" })
      );

      const escapeCmd = nav.resolveKey({ key: "Escape" });
      check("Escape inside an open Not Quite panel resolves to review.exitNotQuite", JSON.stringify(escapeCmd) === JSON.stringify({ family: "review", type: "exitNotQuite", groupId: group.groupId }));

      const moveMemberCmd = nav.resolveKey({ key: "ArrowDown" });
      check(
        "ArrowDown inside an open Not Quite panel resolves to navigation.moveNotQuiteMember next",
        JSON.stringify(moveMemberCmd) === JSON.stringify({ family: "navigation", type: "moveNotQuiteMember", direction: "next" })
      );
    }
  }

  console.log("--- Focus resume position: capture + restore ---");
  {
    const engine = freshReviewEngine(transcript, "s-resume");
    const itemIds = itemIdsForStage("item-check", transcript);
    check("fixture has at least 3 candidates for the resume-position test", itemIds.length >= 3, `only ${itemIds.length}`);
    if (itemIds.length >= 3) {
      const nav = freshNavigator(transcript, engine.getState());
      nav.dispatch({ family: "navigation", type: "focusStage", stage: "item-check" }, engine.getState());
      nav.dispatch({ family: "navigation", type: "selectItem", itemId: itemIds[2]! }, engine.getState());

      const resumePosition = nav.captureResumePosition("2026-07-28T00:00:00.000Z");
      check("captured resume position records the current stage", resumePosition.stage === "item-check");
      check("captured resume position records the current itemId", resumePosition.itemId === itemIds[2]);

      const restoredNav = DeterministicFocusNavigator.fromResumePosition(transcript, engine.getState(), resumePosition);
      check("restoring from a captured resume position lands back on the same item", restoredNav.getFocus().target.itemId === itemIds[2]);
      check("restoring from a captured resume position lands back on the same stage", restoredNav.getFocus().target.stage === "item-check");

      const staleResumePosition: FocusResumePosition = { schemaVersion: 1, stage: "item-check", itemId: "no-such-candidate-anymore", savedAt: "2026-07-28T00:00:00.000Z" };
      const recoveredNav = DeterministicFocusNavigator.fromResumePosition(transcript, engine.getState(), staleResumePosition);
      check(
        "restoring from a STALE resume position (unknown itemId) degrades gracefully to a real item, never an invalid target",
        recoveredNav.getFocus().target.itemId === null || itemIds.includes(recoveredNav.getFocus().target.itemId!)
      );

      const noResumeNav = DeterministicFocusNavigator.fromResumePosition(transcript, engine.getState(), undefined);
      const plainInitialNav = freshNavigator(transcript, engine.getState());
      check("restoring with no resume position at all is identical to the ordinary initial bootstrap", JSON.stringify(noResumeNav.getFocus()) === JSON.stringify(plainInitialNav.getFocus()));

      const deserializeResult = deserializeFocusResumePosition(JSON.parse(serializeFocusResumePosition(resumePosition)));
      check(
        "serialize/deserialize round-trips a captured resume position without loss",
        deserializeResult.ok && JSON.stringify(deserializeResult.position) === JSON.stringify(resumePosition)
      );

      const rejectBadShape = deserializeFocusResumePosition({ schemaVersion: 999, stage: "item-check", itemId: null, savedAt: "x" });
      check("an unknown schemaVersion is rejected rather than guessed at", rejectBadShape.ok === false);
    }
  }

  console.log("--- Deterministic results after a ReviewSession save/load cycle ---");
  {
    const engine = freshReviewEngine(transcript, "s-save-load-focus");
    const itemIds = itemIdsForStage("item-check", transcript);
    engine.dispatch({ family: "review", type: "keepCandidate", candidateId: itemIds[0]! });
    const nav = freshNavigator(transcript, engine.getState());
    nav.dispatch({ family: "navigation", type: "focusStage", stage: "item-check" }, engine.getState());
    nav.reconcile(engine.getState());
    const focusBeforeSaveLoad = JSON.stringify(nav.getFocus());

    const serialized = serializeReviewSession(engine.getState());
    const parsed = deserializeReviewSession(serialized);
    check("ReviewSession round-trips through save/load for this scenario", parsed.ok);
    if (parsed.ok) {
      const reloadedNav = freshNavigator(transcript, parsed.session);
      reloadedNav.dispatch({ family: "navigation", type: "focusStage", stage: "item-check" }, parsed.session);
      reloadedNav.reconcile(parsed.session);
      check("FocusNavigator produces identical focus from a reloaded session as from the original", JSON.stringify(reloadedNav.getFocus()) === focusBeforeSaveLoad);
    }
  }

  console.log("--- Property: next-then-previous returns to original (every non-boundary item) ---");
  {
    const engine = freshReviewEngine(transcript, "s-property-round-trip");
    const itemIds = itemIdsForStage("item-check", transcript);
    const nav = freshNavigator(transcript, engine.getState());
    nav.dispatch({ family: "navigation", type: "focusStage", stage: "item-check" }, engine.getState());
    let allRoundTrip = true;
    for (let i = 0; i < itemIds.length - 1; i++) {
      nav.dispatch({ family: "navigation", type: "selectItem", itemId: itemIds[i]! }, engine.getState());
      nav.dispatch({ family: "navigation", type: "moveItem", direction: "next" }, engine.getState());
      nav.dispatch({ family: "navigation", type: "moveItem", direction: "previous" }, engine.getState());
      if (nav.getFocus().target.itemId !== itemIds[i]) allRoundTrip = false;
    }
    check("next-then-previous returns to the original item for every non-boundary starting position", allRoundTrip);
  }

  console.log("--- Property: traversal termination, unresolved reachability, idempotent reconciliation ---");
  {
    const engine = freshReviewEngine(transcript, "s-properties");
    const itemIds = itemIdsForStage("item-check", transcript);
    check("fixture has candidates for property testing", itemIds.length > 0);
    if (itemIds.length > 0) {
      // Decide every other candidate so both resolved and unresolved items exist.
      itemIds.forEach((id, i) => {
        if (i % 2 === 0) engine.dispatch({ family: "review", type: "keepCandidate", candidateId: id });
      });
      const session = engine.getState();
      const unresolvedIds = new Set(itemIds.filter((id) => !isItemResolved("item-check", id, transcript, session)));

      const nav = freshNavigator(transcript, session);
      nav.dispatch({ family: "navigation", type: "focusStage", stage: "item-check" }, session);
      nav.dispatch({ family: "navigation", type: "selectItem", itemId: itemIds[0]! }, session);

      let allTargetsExist = true;
      let steps = 0;
      while (nav.getFocus().target.itemId !== itemIds[itemIds.length - 1] && steps <= itemIds.length + 1) {
        nav.dispatch({ family: "navigation", type: "moveItem", direction: "next" }, session);
        const currentId = nav.getFocus().target.itemId;
        if (currentId !== null && !itemIds.includes(currentId)) allTargetsExist = false;
        steps += 1;
      }
      check("every focus target visited during forward traversal is a real stage item", allTargetsExist);
      check(
        "forward traversal terminates at the last item within a bounded number of steps -- no infinite loop",
        nav.getFocus().target.itemId === itemIds[itemIds.length - 1]
      );

      nav.dispatch({ family: "navigation", type: "selectItem", itemId: itemIds[0]! }, session);
      const visited = new Set<string>();
      let previous: string | null = null;
      for (let i = 0; i < itemIds.length + 1; i++) {
        const current = nav.getFocus().target.itemId;
        if (current !== null) visited.add(current);
        if (current === previous) break; // converged -- fixed point reached
        previous = current;
        nav.dispatch({ family: "navigation", type: "moveItem", direction: "nextUnresolved" }, session);
      }
      const allUnresolvedReached = [...unresolvedIds].every((id) => visited.has(id));
      check("repeated nextUnresolved traversal from the first item reaches every unresolved item -- none becomes unreachable", allUnresolvedReached);

      nav.reconcile(session);
      const afterFirstReconcile = JSON.stringify(nav.getFocus());
      nav.reconcile(session);
      const afterSecondReconcile = JSON.stringify(nav.getFocus());
      check("repeated reconciliation with no intervening session change is idempotent", afterFirstReconcile === afterSecondReconcile);
    }
  }

  console.log(`\n${passCount}/${passCount + failCount} checks passed`);
  process.exitCode = failCount === 0 ? 0 : 1;
}

main();
