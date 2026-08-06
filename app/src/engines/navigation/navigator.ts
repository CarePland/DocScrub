/**
 * navigator.ts -- the FocusNavigator reducer + reconciliation logic. Pure,
 * synchronous, DOM-free (architecture v0.2 §6.9, ADR-014). Mirrors the
 * "reducer over durable state" shape ReviewEngine.ts's session.ts already
 * established in Phase 8, applied to TRANSIENT focus state instead.
 *
 * ORACLE GROUNDING (Phase 9): redactor/review_queue.py is the one clean,
 * already-tested Python module for this domain --
 * visible_items/first_active_key/reconcile_active_key/move_active_key/
 * next_undecided_after_decision are ported faithfully below (see each
 * function's doc comment for the exact citation). Everything else
 * (group-level arrow movement, Not Quite panel arrow movement, stage
 * sectioning, context-sensitive keyboard resolution) exists only as
 * embedded client JS in local_web_app.py, mixed with DOM/rendering
 * concerns -- ported as clean domain logic here, not verbatim, per
 * Andrew's explicit "resolve by active context... not one global switch
 * statement... no DOM references" constraints. See
 * docs/detection/phase-9-findings.md for the full record.
 *
 * DELIBERATELY NOT PORTED: local_web_app.py's 2D grid arrow movement
 * (`candidateGridColumnCount()`-based Left/Right/Up/Down) -- it depends on
 * rendered viewport width, which FocusNavigator must never query (no DOM
 * references, no rendered-element positions). `moveItem` is 1-dimensional,
 * matching review_queue.py's own already-tested oracle exactly. A future
 * Workspace UI (Phase 10) may layer a 2D visual mapping on top entirely
 * within the UI layer.
 */

import type { ItemMoveDirection, NavigationCommand } from "../../domain/Commands.js";
import type { FocusPanel, FocusState, FocusTarget, WorkflowStage } from "../../domain/FocusState.js";
import { WORKFLOW_STAGE_ORDER } from "../../domain/FocusState.js";
import type { ReviewSession } from "../../domain/ReviewSession.js";
import type { CommandResult } from "../../domain/Commands.js";
import type { FocusResumePosition } from "../../domain/FocusResumePosition.js";
import type { OccurrenceClassificationResult } from "../OccurrenceClassifier.js";
import { itemIdsForStage, isItemResolved } from "./stages.js";
import { activeWorkflowStages, nearestActiveStage } from "./workflow.js";
import type { DetectionGroupingContext } from "../DetectionGroupingContext.js";

export interface NavigationContext extends DetectionGroupingContext {
  classification: OccurrenceClassificationResult;
}

export interface NavigationOutcome {
  focus: FocusState;
  result: CommandResult;
}

function okOutcome(focus: FocusState): NavigationOutcome {
  return { focus, result: { ok: true } };
}

function failOutcome(focus: FocusState, reason: string): NavigationOutcome {
  return { focus, result: { ok: false, reason } };
}

function findGroupCandidateIds(context: NavigationContext, groupId: string): string[] {
  return context.grouping.entityGroupProposals.find((g) => g.groupId === groupId)?.candidateIds ?? [];
}

/**
 * Port of redactor/review_queue.py's first_active_key(): the first
 * UNDECIDED (here: unresolved) item, or the first item overall if every
 * item is already resolved (Python: `visible[0].key if visible else
 * None`).
 */
function firstActiveItemId(itemIds: string[], stage: WorkflowStage, context: DetectionGroupingContext, session: ReviewSession): string | null {
  if (itemIds.length === 0) return null;
  return itemIds.find((id) => !isItemResolved(stage, id, context, session)) ?? itemIds[0]!;
}

/**
 * Port of redactor/review_queue.py's reconcile_active_key(): keep the
 * current active item if it's still in the (stage's) item list, otherwise
 * fall back to firstActiveItemId.
 */
function reconcileActiveItemId(itemIds: string[], activeId: string | null, stage: WorkflowStage, context: DetectionGroupingContext, session: ReviewSession): string | null {
  if (itemIds.length === 0) return null;
  if (activeId !== null && itemIds.includes(activeId)) return activeId;
  return firstActiveItemId(itemIds, stage, context, session);
}

/**
 * Port of redactor/review_queue.py's next_undecided_after_decision(),
 * generalized twice over:
 *
 * 1. (Phase 9) To run in either direction -- Python only ever searches
 *    forward-then-wrap-backward; Andrew's Phase 9 instruction explicitly
 *    requires BOTH "next unresolved" and "previous unresolved", so the
 *    mirror-image backward variant was constructed by symmetry, not found
 *    in Python -- documented as an intentional, symmetric extension, not a
 *    deviation from any real Python behavior since Python never modeled the
 *    reverse direction at all.
 * 2. (Milestone 2, "Review at Scale") To search by an arbitrary predicate
 *    rather than a hardcoded "is this item unresolved" test -- extracted
 *    from the original findUnresolved() (still exported below, unchanged
 *    behavior, now a thin wrapper) so that "Previous decision"'s
 *    previousDecided direction can reuse the exact same wrap-around scan
 *    logic with the OPPOSITE predicate (isItemResolved) instead of
 *    duplicating it. This is a refactor, not a behavior change: nextUnresolved/
 *    previousUnresolved produce byte-identical results to before.
 *
 * Search order for `dir === "forward"` (identical to Python): strictly
 * after `fromIndex` to the end, THEN strictly before `fromIndex` in
 * reverse, THEN fall back to the item at `fromIndex` itself even though
 * it may not satisfy the predicate (Python: `return visible[index].key`) --
 * this is why a caller is never left with no target at all as long as the
 * item list is non-empty.
 */
function findByPredicate(itemIds: string[], fromIndex: number, dir: "forward" | "backward", predicate: (id: string) => boolean): string | null {
  if (itemIds.length === 0) return null;
  const n = itemIds.length;
  const idx = Math.min(Math.max(fromIndex, 0), n - 1);
  if (dir === "forward") {
    for (let i = idx + 1; i < n; i++) if (predicate(itemIds[i]!)) return itemIds[i]!;
    for (let i = idx - 1; i >= 0; i--) if (predicate(itemIds[i]!)) return itemIds[i]!;
  } else {
    for (let i = idx - 1; i >= 0; i--) if (predicate(itemIds[i]!)) return itemIds[i]!;
    for (let i = idx + 1; i < n; i++) if (predicate(itemIds[i]!)) return itemIds[i]!;
  }
  return itemIds[idx]!;
}

function findUnresolved(itemIds: string[], fromIndex: number, dir: "forward" | "backward", stage: WorkflowStage, context: DetectionGroupingContext, session: ReviewSession): string | null {
  return findByPredicate(itemIds, fromIndex, dir, (id) => !isItemResolved(stage, id, context, session));
}

/** Milestone 2 ("Review at Scale") -- the mirror-image predicate of
 *  findUnresolved(), for the `previousDecided` ItemMoveDirection (see
 *  Commands.ts's v7 changelog note for why no `nextDecided` counterpart
 *  exists). */
function findDecided(itemIds: string[], fromIndex: number, dir: "forward" | "backward", stage: WorkflowStage, context: DetectionGroupingContext, session: ReviewSession): string | null {
  return findByPredicate(itemIds, fromIndex, dir, (id) => isItemResolved(stage, id, context, session));
}

function moveWithinItems(itemIds: string[], activeId: string | null, direction: ItemMoveDirection, stage: WorkflowStage, context: DetectionGroupingContext, session: ReviewSession): string | null {
  if (itemIds.length === 0) return null;
  const index = activeId !== null ? itemIds.indexOf(activeId) : -1;
  switch (direction) {
    case "first":
      return itemIds[0]!;
    case "last":
      return itemIds[itemIds.length - 1]!;
    case "next":
      return itemIds[Math.min(itemIds.length - 1, index + 1)]!;
    case "previous":
      return itemIds[Math.max(0, index - 1)]!;
    case "nextUnresolved":
      return findUnresolved(itemIds, index, "forward", stage, context, session);
    case "previousUnresolved":
      return findUnresolved(itemIds, index, "backward", stage, context, session);
    case "previousDecided":
      return findDecided(itemIds, index, "backward", stage, context, session);
  }
}

function firstOccurrenceIdForCandidate(context: NavigationContext, candidateId: string): string | undefined {
  return context.classification.reviewOccurrences.find((o) => o.candidateId === candidateId)?.occurrenceId;
}

/**
 * Returns `target` with `occurrenceId` OMITTED rather than set to
 * `undefined` -- required under `exactOptionalPropertyTypes: true`, which
 * treats an explicit `occurrenceId: undefined` as distinct from (and
 * disallowed in place of) simply not having the key. Every "clear the
 * drilled-down occurrence" site below uses this instead of spreading a
 * literal `undefined`.
 */
function clearOccurrence(target: FocusTarget): FocusTarget {
  const { occurrenceId: _drop, ...rest } = target;
  void _drop;
  return rest;
}

/** Focus target used when a stage is freshly entered (moveStage/focusStage,
 *  and the initial state) -- lands on the first unresolved item, matching
 *  firstActiveItemId's own semantics. */
function arrivalTarget(stage: WorkflowStage, context: NavigationContext, session: ReviewSession): FocusTarget {
  const itemIds = itemIdsForStage(stage, context);
  return { stage, itemId: firstActiveItemId(itemIds, stage, context, session), panel: { kind: "none" } };
}

export function createInitialFocusState(context: NavigationContext, session: ReviewSession): FocusState {
  // CONDITIONAL WORKFLOW (Phase 2, 2026-08-02): a fresh session starts on
  // the FIRST ACTIVE stage, not unconditionally on ambiguity-check -- a
  // document with no ambiguity proposals opens directly onto whatever its
  // workflow actually begins with ("a workflow assembled for the document
  // in front of the reviewer"). nearestActiveStage from ambiguity-check ==
  // "first active stage overall", since ambiguity-check is canonical-first.
  const active = activeWorkflowStages(context, session);
  return { target: arrivalTarget(nearestActiveStage("ambiguity-check", active), context, session), textInputActive: false };
}

/**
 * Bootstraps focus for a session that may (or may not) have a saved
 * FocusResumePosition -- see domain/FocusResumePosition.ts's top doc
 * comment for the full lifecycle/correctness rationale. `resume` is
 * OPTIONAL and its stage/itemId are treated as a mere hint: the candidate
 * target it produces is run straight through reconcile(), the exact same
 * staleness-recovery path used after every ordinary ReviewEngine change,
 * so a resume position pointing at a since-resolved item or a stage/item
 * that no longer exists can never produce an invalid focus target -- it
 * simply falls through to the same "advance to nearest unresolved item"
 * behavior reconcile() already guarantees. No resume position at all
 * (undefined) is exactly equivalent to createInitialFocusState().
 */
export function restoreFocusState(resume: FocusResumePosition | undefined, context: NavigationContext, session: ReviewSession): FocusState {
  if (resume === undefined) {
    return createInitialFocusState(context, session);
  }
  const candidate: FocusState = {
    target: { stage: resume.stage, itemId: resume.itemId, panel: { kind: "none" } },
    textInputActive: false,
  };
  return reconcile(candidate, context, session);
}

export function applyNavigationCommand(focus: FocusState, command: NavigationCommand, context: NavigationContext, session: ReviewSession): NavigationOutcome {
  const { target } = focus;

  switch (command.type) {
    case "moveItem": {
      if (target.panel.kind === "not-quite") return failOutcome(focus, "a Not Quite panel is open; use moveNotQuiteMember instead");
      const itemIds = itemIdsForStage(target.stage, context);
      if (itemIds.length === 0) return okOutcome(focus); // empty stage: graceful no-op, never an error
      const newId = moveWithinItems(itemIds, target.itemId, command.direction, target.stage, context, session);
      return okOutcome({ ...focus, target: { ...clearOccurrence(target), itemId: newId } });
    }

    case "selectItem": {
      if (target.panel.kind === "not-quite") return failOutcome(focus, "a Not Quite panel is open; use moveNotQuiteMember instead");
      const itemIds = itemIdsForStage(target.stage, context);
      if (!itemIds.includes(command.itemId)) return failOutcome(focus, `no such item in stage ${target.stage}: ${command.itemId}`);
      return okOutcome({ ...focus, target: { ...clearOccurrence(target), itemId: command.itemId } });
    }

    case "moveStage": {
      // CONDITIONAL WORKFLOW (Phase 2, 2026-08-02): stage movement
      // traverses the ACTIVE workflow -- "Shift + Left/Right should
      // navigate through this active stage list, not a fixed stage enum or
      // fixed tab count" (AG, verbatim). Derived fresh every dispatch, so
      // a stage that just gained or lost work is immediately reflected.
      // If the current stage is itself no longer active (possible only
      // transiently, before the next reconcile()), movement is computed
      // from its canonical position: "next" finds the first active stage
      // after it, "previous" the nearest active one before it.
      const active = activeWorkflowStages(context, session);
      const activeIndex = active.indexOf(target.stage);
      let nextStage: WorkflowStage;
      if (activeIndex !== -1) {
        const nextIndex = command.direction === "next" ? Math.min(active.length - 1, activeIndex + 1) : Math.max(0, activeIndex - 1);
        nextStage = active[nextIndex]!;
      } else {
        const canonicalIndex = WORKFLOW_STAGE_ORDER.indexOf(target.stage);
        nextStage =
          command.direction === "next"
            ? (WORKFLOW_STAGE_ORDER.slice(canonicalIndex + 1).find((s) => active.includes(s)) ?? active[active.length - 1]!)
            : (WORKFLOW_STAGE_ORDER.slice(0, canonicalIndex).reverse().find((s) => active.includes(s)) ?? active[0]!);
      }
      if (nextStage === target.stage) return okOutcome(focus); // already at a boundary of the active workflow -- graceful no-op
      return okOutcome({ ...focus, target: arrivalTarget(nextStage, context, session) });
    }

    case "focusStage": {
      if (command.stage === target.stage) return okOutcome(focus);
      return okOutcome({ ...focus, target: arrivalTarget(command.stage, context, session) });
    }

    case "enterItem": {
      if ((target.stage === "item-check" || target.stage === "ambiguity-check") && target.itemId !== null) {
        const occurrenceId = firstOccurrenceIdForCandidate(context, target.itemId);
        if (occurrenceId === undefined) return okOutcome(focus);
        return okOutcome({ ...focus, target: { ...target, occurrenceId } });
      }
      // group-check/qa/output: no occurrence-drill-down model -- graceful
      // no-op rather than an error (expand/collapse presentation, if any,
      // is the UI layer's own concern, not FocusNavigator's -- see
      // Commands.ts's enterItem doc comment).
      return okOutcome(focus);
    }

    case "closeItem": {
      if (target.occurrenceId === undefined) return okOutcome(focus);
      const { occurrenceId: _drop, ...rest } = target;
      void _drop;
      return okOutcome({ ...focus, target: rest });
    }

    case "moveNotQuiteMember": {
      if (target.panel.kind !== "not-quite") return failOutcome(focus, "no Not Quite panel is open");
      const memberIds = findGroupCandidateIds(context, target.panel.groupId);
      if (memberIds.length === 0) return okOutcome(focus);
      const index = target.panel.activeMemberId !== null ? memberIds.indexOf(target.panel.activeMemberId) : -1;
      const nextIndex = command.direction === "next" ? Math.min(memberIds.length - 1, index + 1) : Math.max(0, index === -1 ? 0 : index - 1);
      const panel: FocusPanel = { kind: "not-quite", groupId: target.panel.groupId, activeMemberId: memberIds[nextIndex]! };
      return okOutcome({ ...focus, target: { ...target, panel } });
    }

    default: {
      const exhaustive: never = command;
      return failOutcome(focus, `unknown navigation command: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/**
 * Recomputes focus after ANY ReviewEngine/session change -- resolved
 * items, a completed/exited Not Quite panel, a group that's no longer
 * reviewable. Always succeeds (never rejected): this is reconciliation,
 * not a reviewer-initiated command. Callers invoke this after every
 * successful ReviewEngine.dispatch(), matching Andrew's explicit "restore
 * focus after a decision" / "restore focus after opening or completing
 * Not Quite" requirements as ONE mechanism rather than several scattered
 * ad hoc rules.
 *
 * STAGE-CHANGE POLICY, REVISED (Phase 2 conditional workflow, AG
 * 2026-08-02 -- deliberately superseding the original "reconcile never
 * changes target.stage" rule below): hidden stages must leave no
 * "inaccessible focus targets" (AG, verbatim), so when the CURRENT stage
 * drops out of the active workflow -- typically the instant its last
 * unresolved item is decided -- reconciliation relocates focus to the
 * nearest active stage (forward first: finishing a stage moves the
 * reviewer ONWARD through the guided workflow, which is the design
 * objective, not wizard-gating -- movement backward through the active
 * list remains freely available at all times). Two deliberate
 * exceptions: an OPEN Not Quite panel pins focus to its group (the
 * transaction outranks stage activity -- its group is often fully
 * decided mid-transaction, which is exactly when yanking focus would be
 * worst), and the original rule still holds among stages that remain
 * active.
 *
 * Original rule (still true within the active workflow): reconcile does
 * NOT otherwise change `target.stage` on its own (except to follow an
 * open Not Quite panel into group-check -- see below): moving between
 * active stages remains an explicit moveStage/focusStage action, never an
 * automatic side effect of reconciliation.
 */
export function reconcile(focus: FocusState, context: NavigationContext, session: ReviewSession): FocusState {
  let target = focus.target;

  // 1. Follow an open Not Quite panel into view, or clear a stale one.
  if (session.activeNotQuite && session.activeNotQuite.transactionStatus === "open") {
    const groupId = session.activeNotQuite.groupId;
    if (target.stage !== "group-check" || target.itemId !== groupId || target.panel.kind !== "not-quite") {
      target = { stage: "group-check", itemId: groupId, panel: { kind: "not-quite", groupId, activeMemberId: session.activeNotQuite.activeMemberId } };
    } else {
      target = { ...target, panel: { kind: "not-quite", groupId, activeMemberId: session.activeNotQuite.activeMemberId } };
    }
  } else if (target.panel.kind === "not-quite") {
    // Not Quite was completed and/or exited since we last reconciled --
    // "returning from Not Quite should restore a meaningful focus target":
    // drop the panel and fall through to the normal stage-reconciliation
    // logic below, which will advance off the group if it's now resolved.
    target = { ...target, panel: { kind: "none" } };
  }

  // 1.5. CONDITIONAL WORKFLOW (Phase 2): if the current stage has left
  // the active workflow (its last unresolved item was just decided, or a
  // bulk action/import cleared it), relocate to the nearest active stage
  // -- see this function's STAGE-CHANGE POLICY doc comment. Skipped while
  // a Not Quite panel is open (step 1 above just pinned focus to it).
  if (target.panel.kind !== "not-quite") {
    const active = activeWorkflowStages(context, session);
    if (!active.includes(target.stage)) {
      target = arrivalTarget(nearestActiveStage(target.stage, active), context, session);
    }
  }

  // 2. Reconcile the item-level focus within the (possibly just-updated)
  // current stage: stay if still valid and unresolved, else advance to
  // the nearest unresolved item, else fall back to reconcile_active_key's
  // "first active" rule.
  const itemIds = itemIdsForStage(target.stage, context);
  if (itemIds.length === 0) {
    target = { ...clearOccurrence(target), itemId: null };
  } else if (target.itemId !== null && itemIds.includes(target.itemId) && !isItemResolved(target.stage, target.itemId, context, session)) {
    // still valid and still unresolved -- keep focus exactly where it is.
  } else if (target.itemId !== null && itemIds.includes(target.itemId)) {
    // still present but now resolved (e.g. the reviewer just decided it) --
    // advance forward to the next unresolved item, matching Python's
    // next_undecided_after_decision usage after a decision is recorded.
    const index = itemIds.indexOf(target.itemId);
    const advanced = findUnresolved(itemIds, index, "forward", target.stage, context, session);
    target = { ...clearOccurrence(target), itemId: advanced };
  } else {
    // no longer present at all (excluded, or the group it belonged to
    // vanished) -- reconcile_active_key's fallback.
    target = { ...clearOccurrence(target), itemId: reconcileActiveItemId(itemIds, target.itemId, target.stage, context, session) };
  }

  return { ...focus, target };
}
