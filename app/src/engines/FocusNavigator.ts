/**
 * FocusNavigator — architecture v0.2 §6.9 (ADR-014). Owns transient
 * interaction focus: which workflow stage, item, occurrence, and (while a
 * Not Quite panel is open) group member currently has attention, plus
 * deterministic next/previous movement, stage-to-stage movement, and
 * command-target resolution. Reads ReviewSession/DetectionResult/
 * GroupingResult read-only to know what's resolved and what's traversable,
 * but never mutates them and never records reviewer intent itself -- that
 * remains ReviewEngine's exclusive charter (see ReviewEngine.ts's own
 * boundary note). FocusNavigator must not perform detection, scoring,
 * grouping, DOM queries, or persist transient focus as durable review
 * state.
 *
 * PRODUCTION IMPLEMENTATION (Phase 9): DeterministicFocusNavigator below
 * wires together three pure modules built earlier this phase:
 *   - navigation/stages.ts    -- per-stage item lists + resolved/completion
 *                                 status, derived fresh every call, never
 *                                 cached (so it can never silently diverge
 *                                 from ReviewEngine's own view of the
 *                                 world).
 *   - navigation/navigator.ts -- applyNavigationCommand (the focus reducer)
 *                                 + reconcile (post-session-change focus
 *                                 recovery), both ported from redactor/
 *                                 review_queue.py -- see that file's top
 *                                 doc comment for the full oracle-grounding
 *                                 citation list.
 *   - navigation/keymap.ts    -- resolveKeyboardCommand, the one allowed
 *                                 "thin adapter" from a raw key event to a
 *                                 structured command, still with no DOM
 *                                 listener of its own.
 *
 * v2 (Phase 9): this file's FocusState/FocusNavigator shapes are a wholesale
 * replacement of the original stub (activeResultId/focusedControlId/
 * activeCategory + getFocus/dispatch(command)/reconcileAfterVisibilityChange).
 * OBJECTIVE INTERFACE DEFECT: that stub predates the concrete workflow-stage
 * and focus-target model this phase had to design directly from Python's
 * real behavior (see Commands.ts's own v3 note for the sibling NavigationCommand
 * correction, and docs/detection/phase-9-findings.md for the full record).
 * Concretely wrong in three ways: (1) "activeResultId"/"focusedControlId"/
 * "activeCategory" have no counterpart once Category Check + Results are
 * folded into one Item Check stage (see FocusState.ts's stage-reconciliation
 * note) -- there is no single flat "result", nor a separate "control", nor a
 * "category" concept independent of CandidateQuality's own categories, which
 * FocusNavigator must not know about; (2) dispatch(command): FocusState
 * cannot express rejection (a stale itemId, a Not Quite command issued with
 * no panel open) -- Andrew's instruction requires deterministic, explainable
 * behavior, which means a caller must be able to tell "did this navigate"
 * apart from "was this a no-op"; (3) reconcileAfterVisibilityChange(visibleResultIds)
 * takes a bare ID list with no resolved/unresolved information and no
 * ReviewSession, so it could not have implemented reconcile_active_key's
 * actual behavior (skip resolved items, prefer the first UNDECIDED one) even
 * in principle. Kept as a corrected replacement rather than an additive
 * second interface, per Andrew's explicit "do not preserve an inadequate
 * stub merely to avoid a justified correction."
 */

import type { AnyCommand, CommandResult, NavigationCommand } from "../domain/Commands.js";
import type { FocusState, StageStatus, WorkflowStage } from "../domain/FocusState.js";
import type { ReviewSession } from "../domain/ReviewSession.js";
import { captureFocusResumePosition, type FocusResumePosition } from "../domain/FocusResumePosition.js";
import {
  applyNavigationCommand,
  createInitialFocusState,
  reconcile,
  restoreFocusState,
  type NavigationContext,
} from "./navigation/navigator.js";
import { computeAllStageStatuses, computeStageStatus } from "./navigation/stages.js";
import { resolveKeyboardCommand, type KeyEvent } from "./navigation/keymap.js";

export interface FocusNavigator {
  getFocus(): FocusState;

  /**
   * Applies a reviewer-initiated navigation command (moveItem, selectItem,
   * moveStage, focusStage, enterItem, closeItem, moveNotQuiteMember).
   * `session` is read-only -- required to resolve "next/previous
   * unresolved" and to validate the command against current stage
   * membership, never written to. Deliberately does NOT auto-reconcile:
   * an explicit selectItem onto an already-resolved item (a reviewer
   * revisiting a prior decision) must not be silently redirected
   * elsewhere. Call reconcile() separately after a ReviewEngine.dispatch()
   * changes the session.
   */
  dispatch(command: NavigationCommand, session: ReviewSession): CommandResult;

  /**
   * Recomputes focus after ANY ReviewEngine/session change. Always
   * succeeds -- this is reconciliation, not a reviewer command. Callers
   * invoke this after every successful ReviewEngine.dispatch(), matching
   * "restore focus after a decision" / "restore focus after opening or
   * completing Not Quite" as one mechanism.
   */
  reconcile(session: ReviewSession): FocusState;

  /** Resolves a raw key event against the CURRENT focus to a structured
   *  command, or null if the key has no meaning here. Pure; no DOM access. */
  resolveKey(event: KeyEvent): AnyCommand | null;

  /** True while a text-entry control (rename/redact draft, Not Quite
   *  member's draft editor) owns the caret -- arrow keys move text, not
   *  focus. Set directly by the UI layer that opens/closes such a control;
   *  FocusNavigator does not infer this from any command of its own, since
   *  it has no DOM visibility into which control is actually focused. */
  setTextInputActive(active: boolean): FocusState;

  /** Derived stage availability/completion, recomputed fresh from
   *  (DetectionResult, GroupingResult, ReviewSession) every call -- never
   *  cached, so it can never silently diverge from ReviewEngine's own view. */
  stageStatus(stage: WorkflowStage, session: ReviewSession): StageStatus;
  allStageStatuses(session: ReviewSession): StageStatus[];

  /** Snapshots CURRENT focus (stage + top-level itemId only) as a
   *  FocusResumePosition, for a caller to persist alongside a saved
   *  ReviewSession -- see domain/FocusResumePosition.ts's lifecycle note.
   *  Never itself performs I/O. */
  captureResumePosition(savedAt: string): FocusResumePosition;
}

export class DeterministicFocusNavigator implements FocusNavigator {
  private focus: FocusState;
  private readonly context: NavigationContext;

  /**
   * `initialFocus`, if supplied, is trusted as-is (useful for tests placing
   * focus in an exact, deliberately-constructed state). Production callers
   * reloading a saved session should prefer the `fromResumePosition` static
   * factory below instead, which runs a saved FocusResumePosition through
   * the same staleness-recovery reconcile() every other scenario uses,
   * rather than trusting it blindly.
   */
  constructor(context: NavigationContext, session: ReviewSession, initialFocus?: FocusState) {
    this.context = context;
    this.focus = initialFocus ?? createInitialFocusState(context, session);
  }

  /**
   * Constructs a navigator for a (possibly) reloaded session, restoring
   * focus from an OPTIONAL saved FocusResumePosition. See
   * domain/FocusResumePosition.ts and navigation/navigator.ts's
   * restoreFocusState() for why this can never produce an invalid focus
   * target even from a stale or missing resume position.
   */
  static fromResumePosition(
    context: NavigationContext,
    session: ReviewSession,
    resume: FocusResumePosition | undefined,
  ): DeterministicFocusNavigator {
    return new DeterministicFocusNavigator(context, session, restoreFocusState(resume, context, session));
  }

  getFocus(): FocusState {
    return this.focus;
  }

  dispatch(command: NavigationCommand, session: ReviewSession): CommandResult {
    const outcome = applyNavigationCommand(this.focus, command, this.context, session);
    this.focus = outcome.focus;
    return outcome.result;
  }

  reconcile(session: ReviewSession): FocusState {
    this.focus = reconcile(this.focus, this.context, session);
    return this.focus;
  }

  resolveKey(event: KeyEvent): AnyCommand | null {
    return resolveKeyboardCommand(this.focus, event);
  }

  setTextInputActive(active: boolean): FocusState {
    this.focus = { ...this.focus, textInputActive: active };
    return this.focus;
  }

  stageStatus(stage: WorkflowStage, session: ReviewSession): StageStatus {
    return computeStageStatus(stage, this.context, session);
  }

  allStageStatuses(session: ReviewSession): StageStatus[] {
    return computeAllStageStatuses(this.context, session);
  }

  captureResumePosition(savedAt: string): FocusResumePosition {
    return captureFocusResumePosition(this.focus.target.stage, this.focus.target.itemId, savedAt);
  }
}
