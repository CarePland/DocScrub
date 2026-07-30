/**
 * app.ts — Phase 10's "thin UI." A single, deliberately plain entry point
 * wiring one ReviewWorkspace + one WorkspaceCommandDispatcher into visible,
 * clickable DOM. No framework, no build step beyond `tsc` itself (this
 * repo has no npm registry access for a bundler -- see README.md,
 * "Environment constraints" -- and every import in src/ already uses
 * explicit `.js`-suffixed specifiers for exactly this reason: plain `tsc`
 * emission produces a module graph a browser can load natively).
 *
 * Per Andrew's Phase 10 instruction: "Keep UI intentionally simple. Do not
 * spend time on animations, visual polish, styling, responsiveness, design
 * systems... A deliberately plain UI is acceptable." Consistent with that,
 * this file:
 * - re-renders the entire content area from scratch on every state change
 *   (no incremental DOM diffing) -- correct and simple, not fast, which is
 *   the right trade-off for a functional-integration milestone;
 * - uses window.prompt() for Rename/Redact replacement text entry rather
 *   than an inline editor component;
 * - carries no CSS beyond what index.html's own minimal inline style block
 *   provides (enough to make five stages and a Not Quite panel visually
 *   distinguishable, nothing more).
 *
 * ARCHITECTURAL BOUNDARY this file itself must respect (same rule as every
 * engine below it): app.ts renders and forwards commands. It does not
 * decide reviewer intent (ReviewEngine's job), compute focus (FocusNavigator's
 * job), or duplicate "is this item resolved" logic beyond the simplest
 * possible display check (a candidate has ANY direct decision recorded --
 * see renderItemRow below) -- the authoritative resolved/unresolved signal
 * for gating (unresolvedItemCount, reviewComplete) always comes from
 * WorkspaceState.readiness, never recomputed here.
 *
 * MILESTONE 2 ("Review at Scale", 2026-07-28) adds: Item Check search/
 * advanced-filter/sort (src/ui/itemCheckQuery.ts, a pure module kept
 * separate from this file for independent unit-testability), multi-select
 * bulk actions (Redact/Keep/Ignore/Rename selected, via the new
 * review.bulkApplyDecision command), cross-stage quick-jump navigation
 * (Next undecided / Previous decision / Next ambiguity / Jump to category,
 * all UI-composed over existing navigation.selectItem/focusStage/moveItem
 * primitives -- see goToAdjacentInVisibleList's doc comment for why), and
 * an always-visible CommandBar. See
 * docs/detection/milestone-2-review-at-scale.md.
 */

import { ReviewWorkspace } from "../workspace/Workspace.js";
import { WorkspaceCommandDispatcher } from "../workspace/CommandDispatcher.js";
import { deserializeWorkspaceSaveFile, serializeWorkspaceSaveFile, createWorkspaceSaveFile } from "../workspace/WorkspaceSaveFile.js";
import { shouldIgnoreKeyboardEvent } from "../engines/navigation/keymap.js";
import { isItemResolved } from "../engines/navigation/stages.js";
import type { WorkflowStage } from "../domain/FocusState.js";
import type { AnyCommand, ReviewCommand, ReviewTransactionResult } from "../domain/Commands.js";
import { advanceWithinVisibleList } from "./visibleListAdvance.js";
import { DeterministicExplanationEngine } from "../engines/ExplanationEngine.js";
import { buildExplanationContext } from "../engines/explanation/explanation-builder.js";
import { groupReviewOccurrencesForCandidate, type OccurrenceGroup } from "../engines/OccurrenceClassifier.js";
import type { Candidate } from "../domain/DocumentModel.js";
import type { CandidateQualityAssessment, ExpertExplanation, QualityResult, Recommendation, StandardExplanation } from "../domain/Evidence.js";
import { categoryRuleLabel } from "../engines/quality/category-rule-labels.data.js";
import {
  FILTER_PRESETS,
  SORT_ORDERS,
  createDefaultQueryState,
  queryItemCheck,
  type CandidateQueryFacts,
  type FilterPreset,
  type ItemCheckQueryState,
} from "./itemCheckQuery.js";
import { GROUP_SORT_ORDERS, buildGroupQueryFacts, sortGroups, type GroupSortOrder } from "./groupCheckQuery.js";
import { narrowByCategoryView, type CandidateReviewStatus, type CategoryReviewState, type CategoryViewFacts } from "./itemCheckCategoryView.js";
import { groupDisplayDecision, groupLiveConfidence, memberLiveConfidence, candidateLiveConfidence, type GroupDisplayDecision, type LiveConfidence } from "../engines/review/coverage.js";
import type { CandidateDecisionKind, ReviewSession } from "../domain/ReviewSession.js";
import type { SessionSummary } from "../io/LocalSessionRepository.js";
import type { ReplacementRuleConfig, ReplacementStrategy, TypeReplacementRule } from "../domain/ReplacementRule.js";
import { decisionProvenance, decisionProvenanceSuffix } from "./decisionProvenance.js";
import { APP_VERSION } from "./version.js";
import { RegexEntityResolutionEngine, type EntityGroupProposal } from "../engines/EntityResolutionEngine.js";

// MILESTONE 3, Phase 1: onPersistenceChange re-renders whenever a
// background autosave finishes (success or failure) -- FOUND DURING BROWSER
// VALIDATION: without this, the persistence-status line's underlying value
// was always correct, but the DOM never refreshed to show it changing,
// since autosave is deliberately fire-and-forget and nothing else in this
// file re-renders on its own. `render` is referenced here before its own
// declaration further down -- safe, since `function render()` is hoisted.
const workspace = new ReviewWorkspace({ onPersistenceChange: () => render() });
const dispatcher = new WorkspaceCommandDispatcher(workspace);

/**
 * MILESTONE 1, PHASE 1 (2026-07-28): ExplanationEngine has a real
 * implementation now (see that file's own doc comment) -- one shared,
 * stateless instance, called on demand per candidate exactly the way
 * architecture v0.2 §6.5 describes ("invoked on demand by the UI... per
 * candidate"), never for every candidate up front.
 */
const explanationEngine = new DeterministicExplanationEngine();

/**
 * GROUP CHECK PYTHON-PARITY REVISION (2026-07-29): one shared, stateless
 * instance, same rationale as `explanationEngine` above --
 * `recalculateConfidence()` is a pure function of its arguments with no
 * internal state of its own; this exists only so app.ts has something to
 * call it on (Workspace.ts keeps its OWN internal resolution engine
 * private, and rightly so -- that one runs entity resolution itself at
 * detection time, a materially different responsibility from re-deriving a
 * DISPLAY confidence figure on demand here).
 */
const resolutionEngine = new RegexEntityResolutionEngine();

/**
 * WORKSPACE INTERACTION REVISION (2026-07-29): the CandidateDetailPanel is
 * no longer an independently-toggled piece of UI state. Andrew's own
 * framing -- "expansion should become the normal browsing state rather
 * than an optional action" -- means the expanded candidate is simply
 * WHICHEVER candidate currently has focus (`state.focus.target.itemId`,
 * already real FocusNavigator state, not a second parallel notion of
 * "open"). Selecting a candidate (click OR keyboard move) already changes
 * focus; that change alone now IS "auto-expand the new one, auto-collapse
 * the old one, exactly one open at a time" -- no separate Set to keep in
 * sync, no Detail/Close button, no D/./Space toggle (all removed; see
 * decisionButtons()' and STAGE_SHORTCUT_LEGEND's doc comments). See
 * docs/detection/workspace-interaction-revision.md.
 *
 * `acknowledgement` is the one genuinely new piece of ephemeral UI state
 * this revision adds: after a decision is dispatched, FocusNavigator's own
 * reconcile() has ALREADY synchronously advanced focus to the next
 * unresolved item (see navigator.ts's reconcile() -- this is existing,
 * pre-built behavior, not new logic). RX-14 (2026-07-29): this field is
 * now PURELY VISUAL -- while set, the just-decided row shows the pulse
 * highlight and "✓ Saved" badge, but it no longer holds that row expanded
 * or delays revealing the already-advanced focus. The reviewer still sees
 * "Read -> Decide -> Immediate Feedback -> Continue", with the feedback
 * (pulse on the leaving row) and the continue (next row expanding) now
 * happening in the same instant instead of ACKNOWLEDGEMENT_MS apart.
 *
 * GENERALIZED (2026-07-29, interaction model revision): originally only a
 * per-candidate `{ stage, candidateId }` shape. Andrew, after using the
 * shipped app: "clicking one of the 'buttons' needs to result in a visual
 * confirmation... a brief 0.5-1sec UI experience... This should also be the
 * case when selecting one of the KNRIQ options." That means every decision
 * action, not just Item/Ambiguity Check's per-candidate ones -- Group
 * Check's row-level bulk actions and Not Quite's per-member actions
 * genuinely had NO acknowledgement at all before this (a real, disclosed
 * gap this closes, not a deliberate prior omission Andrew asked to keep).
 * `AcknowledgementTarget` now has three shapes -- one per kind of row this
 * app can decide something about -- and `acknowledge()`/`isAcknowledged()`
 * below are the single choke point every decision path (candidate, group,
 * not-quite-member) goes through, so the pulse/highlight treatment (see
 * index.html's `.row-acknowledged` pulse animation) stays consistent
 * everywhere rather than three independently-maintained copies.
 */
type AcknowledgementTarget =
  | { kind: "candidate"; stage: WorkflowStage; candidateId: string }
  | { kind: "group"; groupId: string }
  | { kind: "not-quite-member"; groupId: string; candidateId: string };

let acknowledgement: (AcknowledgementTarget & { timeoutHandle: ReturnType<typeof window.setTimeout> }) | null = null;

/** Andrew's own explicit range: "a brief 0.5-1sec UI experience." */
const ACKNOWLEDGEMENT_MS = 700;

function isAcknowledged(target: AcknowledgementTarget): boolean {
  if (!acknowledgement) return false;
  if (target.kind === "candidate") return acknowledgement.kind === "candidate" && acknowledgement.stage === target.stage && acknowledgement.candidateId === target.candidateId;
  if (target.kind === "group") return acknowledgement.kind === "group" && acknowledgement.groupId === target.groupId;
  return acknowledgement.kind === "not-quite-member" && acknowledgement.groupId === target.groupId && acknowledgement.candidateId === target.candidateId;
}

/** Starts (or restarts) the acknowledgement window for `target` -- does NOT
 *  dispatch anything itself; callers dispatch first, then call this, then
 *  render() (see decideAndAdvance and its group/not-quite-member
 *  counterparts below for the shared shape). Cancels any still-ticking
 *  acknowledgement first, the same "cancel-then-restart" discipline this
 *  file's autosave queue already uses for a different overlapping-async
 *  concern -- a fast reviewer deciding the next thing before the timeout
 *  fires would otherwise race two overlapping acknowledgements. */
function acknowledge(target: AcknowledgementTarget): void {
  if (acknowledgement) window.clearTimeout(acknowledgement.timeoutHandle);
  const timeoutHandle = window.setTimeout(() => {
    acknowledgement = null;
    render();
  }, ACKNOWLEDGEMENT_MS);
  acknowledgement = { ...target, timeoutHandle };
}

/**
 * INLINE EDITOR REVISION (2026-07-29): replaces every window.prompt() call
 * in this file for Rename/Redact replacement-text entry. Andrew's own
 * framing: a native browser prompt() -- "a Chrome-specific 'update' popup
 * at the top of the page" -- is "unacceptable for both scope and UX" next
 * to everything else in this workspace, which never leaves the page to ask
 * a question. Three call sites needed this (candidate-level Rename/Redact
 * in decisionButtons(), the Milestone 2 bulk-selection Rename/Redact in
 * dispatchBulkDecision(), and Not Quite's per-member Rename/Redact in
 * renderGroupStage()) -- one small piece of ephemeral UI state and one
 * render helper cover all three, keyed by which target the editor is
 * currently open for, matching this file's established "ephemeral
 * interaction state lives in a module-level variable, not a new domain
 * concept" pattern (see acknowledgement, above).
 *
 * Rename structurally REQUIRES non-empty text (renameCandidate.replacement
 * is a plain `string`, not optional -- Commands.ts); Redact's replacement
 * is always optional (falls back to a type-appropriate placeholder at
 * output-generation time) -- so confirming an empty Redact editor is a
 * normal, common, one-keystroke (Enter) action, while an empty Rename
 * editor's Confirm/Enter is a no-op, exactly mirroring the old
 * `if (replacement) ...` guard every prompt() call site used to have.
 *
 * Deliberately does NOT extend to Group Check's own bulk-level Redact
 * (redactGroup, which also accepts an optional replacement) or Rename
 * (flattenGroup, which takes no text at all) -- those act on every member
 * of a proposed group at once and are meant to stay a single fast tap to
 * accept the proposal broadly; adding a mandatory extra step there wasn't
 * part of Andrew's request and would slow down Group Check's single most
 * common action. A per-member override is already available via Not Quite,
 * which DOES get the inline editor.
 *
 * `"group-subset"` scope added (2026-07-29, Group Check Python-parity
 * revision): the row-level Rename/Redact buttons now ALSO open this editor
 * -- previously excluded per the note above, but Andrew's follow-up request
 * explicitly asked for exactly this (a radio quick-pick among the group's
 * own already-seen spellings, or free text), which needs somewhere to live.
 * `allSelected` records whether every member of the group was included when
 * the editor opened (see `confirmInlineEditor`'s own branch for why this
 * matters -- it decides whether confirming can still go through the
 * existing confirmGroup/redactGroup/flattenGroup commands unchanged, or
 * must fall through to `bulkApplyDecision`).
 */
type InlineEditorTarget =
  | { scope: "candidate"; stage: WorkflowStage; candidateId: string; action: "Rename" | "Redact" }
  | { scope: "bulk"; candidateIds: string[]; action: "Rename" | "Redact" }
  | { scope: "not-quite-member"; groupId: string; candidateId: string; action: "Rename" | "Redact" }
  | { scope: "group-subset"; groupId: string; candidateIds: string[]; allSelected: boolean; action: "Rename" | "Redact" };

let inlineEditor: (InlineEditorTarget & { draftText: string; customInputActive: boolean }) | null = null;

/** Per-target draft cache (2026-07-29, interaction model revision). Andrew,
 *  after using the shipped editors: "the keyboard K/C/R/I/F should always
 *  change the buttons, even if they have been selected. So going from
 *  Change to Keep as-is should change the button highlight to Keep as-is.
 *  However, state should be preserved, so that if they go back to Change,
 *  their prior edits will still be there." `inlineEditor` itself now closes
 *  the moment a DIFFERENT decision commits for the same candidate/group/
 *  member (see decideAndAdvance and its group/not-quite-member counterparts
 *  below), so the draft has to live somewhere that outlives the editor
 *  being open -- this cache is that somewhere. Cleared only on an explicit
 *  Cancel (a real "never mind, forget this text" signal) or a successful
 *  Confirm of that same draft (the text is now the live decision itself,
 *  not something to restore later) -- see confirmInlineEditor/
 *  cancelInlineEditor. Keyed structurally, not just by candidateId, so
 *  Change and Redact drafts on the same candidate never collide. */
const draftTextCache = new Map<string, string>();

function draftCacheKey(target: InlineEditorTarget): string {
  switch (target.scope) {
    case "candidate":
      return `candidate:${target.stage}:${target.candidateId}:${target.action}`;
    case "bulk":
      return `bulk:${target.action}`;
    case "not-quite-member":
      return `not-quite-member:${target.groupId}:${target.candidateId}:${target.action}`;
    case "group-subset":
      return `group-subset:${target.groupId}:${target.action}`;
  }
}

function isEditingCandidate(candidateId: string, stage: WorkflowStage, action: "Rename" | "Redact"): boolean {
  return inlineEditor?.scope === "candidate" && inlineEditor.stage === stage && inlineEditor.candidateId === candidateId && inlineEditor.action === action;
}

function isEditingBulk(action: "Rename" | "Redact"): boolean {
  return inlineEditor?.scope === "bulk" && inlineEditor.action === action;
}

function isEditingNotQuiteMember(groupId: string, candidateId: string, action: "Rename" | "Redact"): boolean {
  return (
    inlineEditor?.scope === "not-quite-member" &&
    inlineEditor.groupId === groupId &&
    inlineEditor.candidateId === candidateId &&
    inlineEditor.action === action
  );
}

function isEditingGroupSubset(groupId: string, action: "Rename" | "Redact"): boolean {
  return inlineEditor?.scope === "group-subset" && inlineEditor.groupId === groupId && inlineEditor.action === action;
}

/** `initialText` (2026-07-29): lets the group-level Rename editor open
 *  pre-filled with the group's own canonical name -- matching Python's
 *  "Rename selected as:" field, which defaults to the current name rather
 *  than blank, since the common case is confirming or lightly adjusting it,
 *  not typing from scratch. Every other call site omits it (blank, as
 *  before). */
function openInlineEditor(target: InlineEditorTarget, initialText = ""): void {
  const cachedDraft = draftTextCache.get(draftCacheKey(target));
  inlineEditor = { ...target, draftText: cachedDraft ?? initialText, customInputActive: false };
  render();
}

/** Applies whichever target is currently open, using `text` as the
 *  reviewer's typed replacement -- called from both the editor's Confirm
 *  button and its input's own Enter key. Rename silently refuses an empty
 *  string (see this state's own doc comment above); Redact and every other
 *  action treat an empty string as "use the default," matching what a
 *  one-click Redact/Keep/Ignore already did before this revision existed. */
function confirmInlineEditor(text: string): void {
  if (!inlineEditor) return;
  const trimmed = text.trim();
  if (inlineEditor.action === "Rename" && trimmed.length === 0) return;
  const target = inlineEditor;
  inlineEditor = null;
  draftTextCache.delete(draftCacheKey(target)); // committed, not a draft to restore anymore
  if (target.scope === "candidate") {
    if (target.action === "Rename") {
      decideAndAdvance({ family: "review", type: "renameCandidate", candidateId: target.candidateId, replacement: trimmed }, target.candidateId, target.stage);
    } else {
      decideAndAdvance(
        { family: "review", type: "redactCandidate", candidateId: target.candidateId, ...(trimmed ? { replacement: trimmed } : {}) },
        target.candidateId,
        target.stage
      );
    }
  } else if (target.scope === "bulk") {
    // RX-02b: same visible-order advance as dispatchBulkDecision's own
    // Keep/Ignore path -- see dispatchReviewWithVisibleAdvance.
    const result = dispatchReviewWithVisibleAdvance({
      family: "review",
      type: "bulkApplyDecision",
      candidateIds: target.candidateIds,
      decision: target.action,
      ...(trimmed ? { replacement: trimmed } : {}),
    });
    if (result.ok) selectedCandidateIds.clear();
    else window.alert(`Bulk action failed: ${result.reason}`);
    render();
  } else if (target.scope === "not-quite-member") {
    decideNotQuiteMemberAndRender(
      {
        family: "review",
        type: "applyNotQuiteMember",
        groupId: target.groupId,
        candidateId: target.candidateId,
        action: target.action,
        ...(trimmed ? { draftReplacement: trimmed } : {}),
      },
      target.groupId,
      target.candidateId
    );
  } else {
    // "group-subset": if the reviewer left this exactly at its default
    // (every member still selected, AND -- for Rename -- the text is still
    // the group's own unmodified canonical name; for Redact, blank) route
    // through the SAME existing group-level command a plain one-click
    // Keep-as-is/Ignore already uses (confirmGroup/redactGroup/flattenGroup)
    // -- preserves that command's EntityGroupDecision stamp (audit trail,
    // and the `reviewerConfirmed` live-confidence bonus) exactly as before
    // this revision. Any real change -- a narrower selection, a different
    // spelling chosen, custom text typed -- is precisely what
    // bulkApplyDecision already exists for (Milestone 2), so it's used
    // directly rather than stretching flattenGroup/redactGroup (which
    // structurally can't carry arbitrary text) to cover it.
    const group = dispatcher.getState().grouping?.entityGroupProposals.find((g) => g.groupId === target.groupId);
    if (target.action === "Redact" && target.allSelected && trimmed.length === 0) {
      decideGroupAndAdvance({ family: "review", type: "redactGroup", groupId: target.groupId }, target.groupId);
    } else if (target.action === "Rename" && target.allSelected && group && trimmed === group.canonicalName) {
      decideGroupAndAdvance({ family: "review", type: "flattenGroup", groupId: target.groupId }, target.groupId);
    } else {
      decideGroupBulkAndRender(
        {
          family: "review",
          type: "bulkApplyDecision",
          candidateIds: target.candidateIds,
          decision: target.action,
          ...(trimmed ? { replacement: trimmed } : {}),
        },
        target.groupId
      );
    }
  }
}

function cancelInlineEditor(): void {
  // Explicit Cancel is a real "never mind, forget this text" signal --
  // unlike switching to a different decision (Keep/Ignore/a different
  // group action), which preserves the draft in draftTextCache instead.
  if (inlineEditor) draftTextCache.delete(draftCacheKey(inlineEditor));
  inlineEditor = null;
  render();
}

/** Renders the open editor's input + Confirm/Cancel controls, appended
 *  inline right where the Rename/Redact button that opened it lives --
 *  never a separate dialog/popup. Deliberately does NOT re-render on every
 *  keystroke (unlike the Item Check search input -- see
 *  searchInputFocusPending's doc comment): nothing else on screen needs to
 *  reflect the draft text live, so the input can just be left alone by
 *  render() while the reviewer types, which sidesteps the focus/cursor-loss
 *  problem entirely rather than solving it. `inlineEditor.draftText` is
 *  still kept in sync on every keystroke so that if render() DOES fire from
 *  an unrelated source while this is open (background autosave's
 *  onPersistenceChange, the same class of surprise documented for
 *  <details> elements elsewhere in this file), the freshly rebuilt input
 *  shows the reviewer's own in-progress text rather than reverting to
 *  empty -- render()'s own focus-restoration pass (see its end) then
 *  re-focuses this input and places the caret at the end, a deliberately
 *  simpler fallback than full cursor-position tracking for what should be a
 *  rare mid-edit interruption.
 *
 * `quickPicks` (2026-07-29, Group Check Python-parity revision; REVISED
 * same day per Andrew's direct follow-up on the shipped UI) -- optional
 * quick-pick options for each distinct spelling already seen among the
 * members being renamed. Originally radio inputs that only staged a choice
 * into draftText (still requiring a separate Confirm/Enter-in-the-input
 * step); Andrew's own words after using it: "hitting Enter here [a
 * selected option] ought to approve this and auto-move to the next item...
 * even if they are not in the text input," and "let's make the
 * alternatives something besides radio buttons... selectable but not quite
 * buttons. Each gets highlighted with focus, encouraging enter." So each
 * quick-pick is now a plain `<button>` ("button light" styling, see
 * index.html) whose click/Enter/Space calls `confirmInlineEditor` directly
 * with that value -- one action, not two -- and reconcileFocus's existing
 * post-command advance (CommandDispatcher.ts, already fires on every
 * review command) does the "move to the next item" part with zero new
 * navigation logic, same as it always has. Left/Right/Up/Down arrow keys
 * rove focus across the chip row (native `<button>` Tab order already
 * covers the deliberate case; arrows are the added nicety matching the
 * radio-group muscle memory this replaces). "Something else" is the LAST
 * chip in the same row, per Andrew's explicit reframing -- not a separate
 * always-visible field bolted on top: it is a third option, not a fallback
 * area outside the option set. Selecting it does NOT submit; it reveals
 * the free-text input beneath, pre-filled with whatever draftText already
 * was (the group's canonical name, or the last quick-pick clicked before
 * switching) -- "it can even still populate with the selected [option's]
 * text -- that will be useful for minor edits," so a reviewer who wants
 * "Andrew Jackson" with one letter changed never retypes the whole name.
 * The input's own Enter-to-confirm-and-advance behavior is unchanged.
 * Omitted (or empty) everywhere a single candidate is being renamed, where
 * "distinct spellings among the selection" would just be that one
 * candidate's own text -- not a meaningful choice; that case still renders
 * as a plain text input, unchanged. */
function renderInlineEditor(container: HTMLElement, placeholder: string, quickPicks: string[] = []): void {
  if (!inlineEditor) return;
  const current = inlineEditor;
  const wrap = el("div", { class: "inline-editor" });

  // A draft that doesn't literally match any quick pick (e.g. the group's
  // canonical name happens to differ from every selected member's own
  // displayValue) has nowhere else to live but the free-text field, so
  // custom-input mode is forced on rather than silently hiding the
  // reviewer's own pre-filled text behind an extra "Something else" click
  // they never asked to make.
  const showCustomInput = quickPicks.length === 0 || current.customInputActive || !quickPicks.includes(current.draftText);

  if (quickPicks.length > 0) {
    const picks = el("div", { class: "inline-editor-quick-picks" });
    picks.setAttribute("role", "group");
    const optionValues = [...quickPicks, null]; // null = the trailing "Something else" chip
    const chips: HTMLButtonElement[] = [];
    const focusChip = (fromIndex: number, delta: number) => {
      if (chips.length === 0) return;
      chips[(fromIndex + delta + chips.length) % chips.length]!.focus();
    };
    optionValues.forEach((value, index) => {
      const chip =
        value === null
          ? button("Something else…", () => {
              if (!inlineEditor) return;
              inlineEditor.customInputActive = true;
              render();
            })
          : button(value, () => confirmInlineEditor(value));
      chip.classList.add("inline-editor-quick-pick");
      const isCurrent = value === null ? showCustomInput : !showCustomInput && value === current.draftText;
      if (isCurrent) chip.classList.add("inline-editor-quick-pick-current");
      chip.addEventListener("keydown", (event) => {
        if (event.key === "ArrowRight" || event.key === "ArrowDown") {
          event.preventDefault();
          focusChip(index, 1);
        } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
          event.preventDefault();
          focusChip(index, -1);
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancelInlineEditor();
        }
      });
      chips.push(chip);
      picks.appendChild(chip);
    });
    wrap.appendChild(picks);
  }

  if (showCustomInput) {
    const input = el("input", { type: "text", class: "inline-editor-input", placeholder }) as HTMLInputElement;
    input.value = current.draftText;
    input.addEventListener("input", () => {
      if (!inlineEditor) return;
      inlineEditor.draftText = input.value;
      draftTextCache.set(draftCacheKey(inlineEditor), input.value); // write-through, see draftTextCache's own doc comment
    });
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        confirmInlineEditor(input.value);
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancelInlineEditor();
      }
    });
    wrap.appendChild(input);
    wrap.appendChild(button("Confirm", () => confirmInlineEditor(input.value)));
  }
  wrap.appendChild(button("Cancel", cancelInlineEditor));
  container.appendChild(wrap);
}

/** Renders a confidence figure the way every badge in this file now needs
 *  to (2026-07-29, Group Check Python-parity revision): `${current}%`, plus
 *  a muted "was X%" note when `live.prior` is present -- matching Python's
 *  own `confidence !== analysisConfidence` gate for showing that note at
 *  all (see coverage.ts's `LiveConfidence` doc comment). `extraClass` lets
 *  callers keep their own existing class (`badge`, `member-confidence`)
 *  alongside the confidence-level color class this already applied. */
function renderConfidenceBadge(live: LiveConfidence, extraClass = "badge"): HTMLElement {
  const node = el("span", { class: `${extraClass} ${confidenceBadgeClass(live.current)}` }, `${live.current}%`);
  if (live.prior !== undefined) node.appendChild(el("span", { class: "prior-score" }, `was ${live.prior}%`));
  return node;
}

/**
 * MILESTONE 1, PHASE 2 (2026-07-28): Category Check is a presentation-only
 * aggregation over the SAME Item Check candidate pool (see
 * docs/architecture/review-workspace-reconstruction.md §1.10 -- "not new
 * domain state... a different aggregation and filter view"), so its state
 * lives here as ephemeral UI state, exactly like `acknowledgement` above,
 * not as new FocusNavigator/ReviewEngine state. RX-02a (2026-07-29):
 * CategoryReviewState itself now lives in itemCheckCategoryView.ts,
 * alongside the pure narrowing helper both the renderer and keyboard
 * navigation share -- the ephemeral state variables stay here.
 */
let itemCheckViewMode: "list" | "category" = "list";
let categoryReviewState: CategoryReviewState = "toReview";
let categoryFilter: string | null = null;

/**
 * MILESTONE 2 ("Review at Scale", 2026-07-28): search/filter/sort state
 * (see src/ui/itemCheckQuery.ts) and multi-select state -- both ephemeral
 * UI-layer state per the same v0.2 §7.3 rationale as the Category Check
 * state above, scoped to Item Check only (see itemCheckQuery.ts's own
 * "SCOPE DECISION" note). `selectedCandidateIds` is cleared whenever the
 * underlying candidate identity changes (a fresh document load), matching
 * this file's established pattern for every other ephemeral Set.
 */
let itemCheckQueryState: ItemCheckQueryState = createDefaultQueryState();
const selectedCandidateIds = new Set<string>();

/**
 * GROUP CHECK REVISION (2026-07-29): Group Check's own sort order and
 * layout mode -- ephemeral UI-layer state, same rationale as
 * itemCheckQueryState above. Default sort matches Item Check's own default
 * (confidence-desc) for consistency across the workspace. Layout defaults
 * to the single-column list (the lower-risk default); the 2-column grid is
 * an explicit opt-in via the toolbar toggle.
 */
let groupCheckSortOrder: GroupSortOrder = "confidence-desc";
let groupCheckLayout: "list" | "grid" = "list";

/**
 * GROUP CHECK PYTHON-PARITY REVISION (2026-07-29): a group's member
 * breakdown (checkboxes, per-member live confidence, Context) is now
 * reachable WITHOUT entering Not Quite -- a third, distinct reviewer intent
 * alongside "act on the whole group in one tap" (the existing bulk row
 * buttons) and "decide every member one at a time" (Not Quite, unchanged).
 * Originally this was a manually-toggled `expandedGroupIds` Set,
 * deliberately separate from keyboard focus, matching Python's own
 * `expandedGroups`. Andrew's later interaction-model follow-up reversed
 * that: "I want the default for a selected item/row to be expanded --
 * encourage them to review it by seeing everything rather than making
 * rapid decisions." `expandedGroupIds` and its ▸/▾ toggle button were
 * removed entirely; a group's expansion is now computed the same way
 * Item/Ambiguity Check's candidate expansion already worked (see
 * renderCandidateStage's `isExpanded` and its own doc comment) --
 * `isFocused || isAcknowledging`, inline in renderGroupStage below. No
 * separate Set to keep in sync, no toggle affordance to discover.
 *
 * `groupUncheckedMemberIds` mirrors Python's `groupUnchecked[groupId]`
 * exactly: a per-group Set of EXCLUDED member ids, never inclusions -- so a
 * freshly-seen group needs no initialization step, "select all" is simply
 * "forget this group's entry," and the bulk row actions' default behavior
 * (acting on every member) requires no special-casing, it's just what
 * happens when the exclusion set is empty. See `groupSelectedMemberIds()`.
 */
const groupUncheckedMemberIds = new Map<string, Set<string>>();

function groupSelectedMemberIds(group: EntityGroupProposal): string[] {
  const unchecked = groupUncheckedMemberIds.get(group.groupId);
  if (!unchecked || unchecked.size === 0) return group.candidateIds;
  return group.candidateIds.filter((id) => !unchecked.has(id));
}

function toggleMemberChecked(group: EntityGroupProposal, candidateId: string): void {
  let unchecked = groupUncheckedMemberIds.get(group.groupId);
  if (!unchecked) {
    unchecked = new Set();
    groupUncheckedMemberIds.set(group.groupId, unchecked);
  }
  if (unchecked.has(candidateId)) unchecked.delete(candidateId);
  else unchecked.add(candidateId);
  render();
}

function setAllMembersChecked(group: EntityGroupProposal, checked: boolean): void {
  if (checked) groupUncheckedMemberIds.delete(group.groupId);
  else groupUncheckedMemberIds.set(group.groupId, new Set(group.candidateIds));
  render();
}

/**
 * DIRECTIONAL ROW NAVIGATION (2026-07-29, interaction model revision).
 * Andrew, citing Python's own Group Check screen: "when an item is
 * highlighted arrows function directionally within the opened item --
 * pressing right moves right to whatever else is in that row, left the
 * same, and up/down between rows within the opened item." This is a
 * roving-tabindex grid over the EXPANDED group's own focusable controls --
 * row 0 is the group's own checkbox plus Keep/Change/Redact/Ignore/Fix
 * this buttons (exactly what's visually one row in the UI); rows 1..N are
 * each member's own checkbox in the breakdown list beneath it. This moves
 * REAL DOM focus, not a second parallel "selection" concept -- Python's own
 * UI does the same, and matching it means a keyboard-only reviewer gets
 * exactly the behavior they already expect from the tool this replaces.
 *
 * Andrew's own follow-up sentence -- "If opened, Tab and shift+tab will
 * select the next item" -- deliberately keeps Tab OUT of this grid
 * entirely: Tab always means "next item" (see keymap.ts's tabDirection),
 * whether a group is collapsed or expanded, never "next control in this
 * row." Only the four arrow keys are grid-scoped.
 *
 * SCOPE TRIM (disclosed): only Group Check gets this in this revision.
 * Item/Ambiguity Check's decision buttons are unaffected -- their K/C/R/I
 * shortcuts already act on the whole candidate without a button click
 * first, so there's less to gain, and both of Andrew's own reference
 * screenshots were Group Check. Extending this there is a cheap, natural
 * follow-up if he wants the same affordance.
 *
 * Only wired for the group that is CURRENTLY EXPANDED -- renderGroupStage
 * builds a grid and calls attachRovingGridNav for that one row only.
 * Collapsed rows' buttons stay plain, unmanaged DOM elements: a stray
 * click-focus on one of them can't leave the app half-wired into a grid
 * that no longer matches what's on screen.
 *
 * `groupRovingFocus` is the one new piece of ephemeral state this needs --
 * which cell currently holds focus, keyed by groupId so switching to a
 * DIFFERENT expanded group starts fresh at (0, 0) instead of remembering a
 * stale position from whichever group was open before (see
 * rovingGridPosition). Restored after every render() -- which tears down
 * and rebuilds this row's DOM from scratch, exactly like
 * searchInputFocusPending/renderInlineEditor's own end-of-render .focus()
 * calls above already do for the same from-scratch-rebuild reason -- but
 * ONLY when this group is the one actually expanded AND no inline editor
 * is open, so an incidental re-render (autosave) never yanks focus away
 * from text a reviewer is actively typing elsewhere.
 */
let groupRovingFocus: { groupId: string; row: number; col: number } | null = null;

/** Clamps any remembered position to the CURRENT grid's shape (a group's
 *  member count, or its own available buttons, can change between renders
 *  -- e.g. a Not Quite completion collapsing a row) and defaults to (0, 0)
 *  for a group `groupRovingFocus` doesn't (yet) have an entry for. */
function rovingGridPosition(grid: HTMLElement[][], groupId: string): { row: number; col: number } {
  if (groupRovingFocus?.groupId === groupId && grid.length > 0) {
    const row = Math.min(Math.max(groupRovingFocus.row, 0), grid.length - 1);
    const rowLength = grid[row]?.length ?? 1;
    const col = Math.min(Math.max(groupRovingFocus.col, 0), rowLength - 1);
    return { row, col };
  }
  return { row: 0, col: 0 };
}

/** Attaches the arrow-key roving-focus handler to `containers` (the row
 *  element and, when rendered, the member-list element) -- `stopPropagation`
 *  keeps these keydowns from ever reaching the document-level listener, so
 *  there's no need to special-case them in that listener's own gate. Only
 *  fires when `event.target` is actually one of `grid`'s own tracked
 *  elements, so an arrow key pressed anywhere else inside these containers
 *  (there isn't anywhere else today, but this stays correct if that
 *  changes) falls through untouched. */
function attachRovingGridNav(containers: HTMLElement[], grid: HTMLElement[][], groupId: string): void {
  const handler = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    let row = -1;
    let col = -1;
    for (let r = 0; r < grid.length; r++) {
      const c = (grid[r] ?? []).indexOf(event.target as HTMLElement);
      if (c !== -1) {
        row = r;
        col = c;
        break;
      }
    }
    if (row === -1) return;
    const currentRow = grid[row];
    if (!currentRow) return;
    event.preventDefault();
    event.stopPropagation();
    let nextRow = row;
    let nextCol = col;
    if (event.key === "ArrowRight") nextCol = Math.min(col + 1, currentRow.length - 1);
    else if (event.key === "ArrowLeft") nextCol = Math.max(col - 1, 0);
    else if (event.key === "ArrowDown") nextRow = Math.min(row + 1, grid.length - 1);
    else if (event.key === "ArrowUp") nextRow = Math.max(row - 1, 0);
    // Moving to a different row keeps the same column when that row is wide
    // enough, otherwise lands on its last available control -- every row
    // this grid ever builds has at least one column.
    const targetRow = grid[nextRow] ?? currentRow;
    if (nextRow !== row) nextCol = Math.min(col, targetRow.length - 1);
    groupRovingFocus = { groupId, row: nextRow, col: nextCol };
    targetRow[nextCol]?.focus();
  };
  for (const container of containers) container.addEventListener("keydown", handler);
}

/** Set just before a search-input-triggered render() so the freshly rebuilt
 *  search <input> (a NEW DOM node -- this file re-renders everything from
 *  scratch every time, see this file's top doc comment) can have focus and
 *  cursor position restored after being recreated. Without this, every
 *  keystroke in the search box would lose focus, making "search updates
 *  immediately" while typing effectively unusable. Consumed and cleared at
 *  the end of render(). */
let searchInputFocusPending: { start: number; end: number } | null = null;

/**
 * MILESTONE 3 ("Reviewer Productivity", Phase 1/2): `recentSessions` is a
 * cached snapshot of listRecentSessions() -- a real read, but async, and
 * render() itself is synchronous and called from many places (every
 * dispatch handler, every keypress) per this file's own "re-render
 * everything from scratch" model. Rather than making render() itself async
 * (which would ripple through every call site), this cache is refreshed
 * explicitly via refreshRecentSessions() at startup and after any action
 * that could change it (load/resume/remove), then read synchronously by
 * render() -- the same "fetch, cache, render from cache" shape this file
 * already uses for nothing else because no other data source in this app
 * is async at read time; this is the first one. `showingLanding` is a
 * small piece of UI-only state (not gated by WorkspaceState.documentLoaded)
 * so a reviewer can navigate BACK to the Recent Documents list without a
 * page refresh even though the previously loaded document's Workspace
 * state (and its autosave) is untouched -- picking a different document
 * (via Resume or a fresh file) simply replaces it, exactly as loading a
 * first document would.
 */
let recentSessions: SessionSummary[] = [];
let showingLanding = false;

// Deliberately swallows a failure here rather than letting it propagate:
// the very first render() in this file is gated on this promise resolving
// (see the module's final `void refreshRecentSessions().then(render)`
// line), so an unhandled rejection -- e.g. IndexedDB unavailable in
// private browsing, blocked by a storage policy, or transiently locked --
// would leave a reviewer staring at a permanently blank page with no
// feedback and no way to even load a new document. That directly
// contradicts this milestone's own resilience goal. Recent Documents is a
// convenience, not a requirement to use the app, so on failure this
// degrades to an empty list and lets the rest of the app render normally;
// found via the ui-smoke.ts structural check, not designed around.
async function refreshRecentSessions(): Promise<void> {
  try {
    recentSessions = await dispatcher.listRecentSessions();
  } catch (error) {
    console.warn("Recent Documents unavailable -- continuing without it.", error);
    recentSessions = [];
  }
}

const STAGE_LABELS: Record<WorkflowStage, string> = {
  "ambiguity-check": "Ambiguity Check",
  "group-check": "Group Check",
  "item-check": "Item Check",
  qa: "QA",
  output: "Output",
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const b = el("button", {}, label);
  b.disabled = disabled;
  b.addEventListener("click", onClick);
  return b;
}

// MILESTONE 3 fix (found via browser validation, not designed around):
// onPersistenceChange (Phase 1) calls render() after every background
// autosave completes, independent of anything the reviewer does. Because
// render() rebuilds the whole DOM tree from scratch every time, any
// <details> element the reviewer had expanded -- Redaction rules, By type,
// Occurrence Browser, Expert View -- would silently collapse a moment
// after being opened, with no visible cause. That directly undermines the
// "calm, predictable, low cognitive load" bar this milestone sets for
// itself. Fix: persist each <details>'s open/closed state across renders
// in a small module-level set, keyed by a caller-supplied stable id (DOM
// identity doesn't survive a rebuild, so the key can't be the element).
const openDetailsKeys = new Set<string>();

function detailsEl(key: string, attrs: Record<string, string> = {}): HTMLDetailsElement {
  const node = el("details", attrs);
  node.open = openDetailsKeys.has(key);
  node.addEventListener("toggle", () => {
    if (node.open) openDetailsKeys.add(key);
    else openDetailsKeys.delete(key);
  });
  return node;
}

function root(): HTMLElement {
  const found = document.getElementById("app");
  if (!found) throw new Error("index.html must contain <div id=\"app\"></div>");
  return found;
}

async function handleLoadFile(file: File): Promise<void> {
  const result = await dispatcher.dispatchApplication({ family: "document", type: "load", file });
  if (!result.ok) window.alert(`Failed to load document: ${result.reason}`);
  else showingLanding = false;
  await refreshRecentSessions();
  render();
}

async function handleResumeSession(sessionFile: File, docxFile: File): Promise<void> {
  const text = await sessionFile.text();
  const parsed = deserializeWorkspaceSaveFile(text);
  if (!parsed.ok) {
    window.alert(`That save file could not be read: ${parsed.reason}`);
    return;
  }
  const result = await dispatcher.loadSavedSession(docxFile, parsed.saveFile);
  if (!result.ok) window.alert(result.reason);
  else showingLanding = false;
  await refreshRecentSessions();
  render();
}

/** MILESTONE 3, Phase 1/2 -- "recovery after refresh"/"resume previous
 *  review" via Recent Documents, with no file picker involved: the browser
 *  itself already has the original bytes (see SessionRecord in
 *  LocalSessionRepository.ts). */
async function handleResumeFromRecent(documentId: string): Promise<void> {
  const result = await dispatcher.dispatchApplication({ family: "document", type: "resumeSession", documentId });
  if (!result.ok) window.alert(`Could not resume that document: ${result.reason}`);
  else showingLanding = false;
  await refreshRecentSessions();
  render();
}

/** The only Recent Documents management affordance this milestone adds --
 *  deliberately just "remove," per Andrew's "do not implement a
 *  document-management system." Does not touch the currently loaded
 *  document even if it happens to be the one removed from the list; it
 *  only stops that document from being offered as a resume target next
 *  time. */
async function handleRemoveRecentSession(documentId: string): Promise<void> {
  await dispatcher.deleteStoredSession(documentId);
  await refreshRecentSessions();
  render();
}

function handleSaveSession(): void {
  const state = dispatcher.getState();
  if (!state.documentLoaded || !state.reviewSession || !state.documentId) {
    window.alert("No document loaded -- nothing to save.");
    return;
  }
  // saveReviewSession's own dispatch path also works (and is what the
  // integration suite exercises), but building the file directly here lets
  // the download happen synchronously from this click handler without an
  // extra state read-back -- same data, same functions, no duplicated
  // logic (createWorkspaceSaveFile/serializeWorkspaceSaveFile are the exact
  // functions document.saveReviewSession uses internally).
  const resumePosition = state.focus
    ? { schemaVersion: 1 as const, stage: state.focus.target.stage, itemId: state.focus.target.itemId, savedAt: new Date().toISOString() }
    : undefined;
  const saveFile = createWorkspaceSaveFile(state.documentId, new Date().toISOString(), state.reviewSession, resumePosition);
  const json = serializeWorkspaceSaveFile(saveFile);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = el("a", { href: url, download: `docscrub-session-${state.documentId.slice(0, 12)}.json` });
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function handleDownloadOutput(): void {
  const blob = workspace.getRebuiltOutput();
  if (!blob) {
    window.alert("No current redacted output -- generate output first (and note it becomes stale again after any further decision).");
    return;
  }
  const url = URL.createObjectURL(blob);
  const state = dispatcher.getState();
  const link = el("a", { href: url, download: `redacted-${state.fileName ?? "document.docx"}` });
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Shared download helper for the text-based audit artifacts (JSON/CSV) --
 *  handleDownloadOutput above stays separate since it downloads a Blob of
 *  actual DOCX bytes, not a string this file itself constructed. */
function downloadText(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = el("a", { href: url, download: filename });
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

async function handleGenerateAudit(): Promise<void> {
  const result = await dispatcher.dispatchApplication({ family: "document", type: "generateAudit" });
  if (!result.ok) window.alert(`Failed to generate audit record: ${result.reason}`);
  render();
}

/** Feature 002 (Decision Reuse). Imports a previously exported decisions.json
 *  (Download Decisions (JSON), above) into the CURRENT document's review --
 *  reused decisions appear inline in Item Check/Ambiguity Check immediately
 *  afterward, tagged "(Imported)" (see renderCandidateStage below), with no
 *  separate preview/confirmation step: nothing here is hidden or finalized
 *  any differently than an ordinary decision, so the reviewer loses nothing
 *  by seeing results immediately and overriding any of them exactly like a
 *  fresh decision (Keep/Rename/Redact/Ignore all work unchanged).
 *
 *  Deliberately does NOT window.alert() a success summary (only failure --
 *  matching every other handler in this file, e.g. handleLoadFile/
 *  handleGenerateAudit, which alert on failure only). A native alert()
 *  blocks the page's own JS thread until dismissed, which is exactly the
 *  kind of interruption "without overwhelming the interface" argues
 *  against for routine success -- the "(Imported)" tags rendered inline
 *  immediately below, plus the numeric stage-tab counts changing, ARE the
 *  success feedback. renderImportSummaryBanner (below) surfaces the same
 *  numbers non-modally instead. */
async function handleImportDecisions(file: File): Promise<void> {
  const result = await dispatcher.dispatchApplication({ family: "document", type: "importDecisions", file });
  if (!result.ok) window.alert(`Failed to import decisions: ${result.reason}`);
  render();
}

/** Non-modal counterpart to the alert() this file deliberately does NOT
 *  show on a successful import (see handleImportDecisions's own comment) --
 *  a small, dismissable-by-scrolling-past summary line, not a dialog the
 *  reviewer must acknowledge before continuing. Renders nothing once there
 *  is no summary for the CURRENT document (getLastDecisionReuseSummary()
 *  is cleared on loadDocument(), same as the audit/save caches). */
function renderImportSummaryBanner(container: HTMLElement): void {
  const summary = workspace.getLastDecisionReuseSummary();
  if (!summary) return;
  const banner = el("p", { class: "import-summary" });
  banner.textContent =
    `Last import: ${summary.appliedCount} decision(s) reused from a prior review` +
    ` (${summary.tierCounts["exact-key"]} exact match, ${summary.tierCounts["grouped-alias"]} grouped alias,` +
    ` ${summary.tierCounts["similarity-threshold"]} similarity match); ${summary.skippedAlreadyDecidedCount} skipped (already decided).`;
  container.appendChild(banner);
}

/** Coarse "how long ago" text -- deliberately approximate (minute/hour/day
 *  granularity only), matching this app's general "informational, not
 *  precise" treatment of timestamps elsewhere (e.g. audit records show ISO
 *  timestamps verbatim; this is the one place a rounded, human-friendly
 *  form is more useful than exactness, since Recent Documents is a
 *  "was this recent enough to be what I'm looking for" scan, not a record). */
function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * MILESTONE 3, Phase 1/2 ("recovery after refresh" / Recent Documents).
 * Renders nothing when there is nothing stored yet -- a first-time reviewer
 * with no prior sessions sees exactly the same landing page as before this
 * milestone, not an empty section header (Andrew: "do not implement a
 * document-management system" -- an empty list is clutter, not a feature).
 * Each row surfaces exactly the fields Andrew's Phase 2 instruction names
 * (recently opened, last review date, completion %) plus the one action
 * ("resume directly from the landing page") and the one management
 * affordance this milestone adds (remove).
 */
function renderRecentDocuments(container: HTMLElement): void {
  if (recentSessions.length === 0) return;
  const section = el("div", { class: "recent-documents" });
  section.appendChild(el("strong", {}, "Recent documents"));
  const list = el("div", { class: "recent-documents-list" });
  for (const summary of recentSessions) {
    const row = el("div", { class: "recent-document-row" });
    row.appendChild(el("span", { class: "recent-document-name" }, summary.fileName));
    row.appendChild(
      el(
        "span",
        { class: "recent-document-meta" },
        `${summary.completionPercent}% complete (${summary.reviewedCandidateCount}/${summary.totalCandidateCount}) · last opened ${formatRelativeTime(summary.lastOpenedAt)}`
      )
    );
    row.appendChild(button("Resume", () => void handleResumeFromRecent(summary.documentId)));
    row.appendChild(button("Remove", () => void handleRemoveRecentSession(summary.documentId)));
    list.appendChild(row);
  }
  section.appendChild(list);
  container.appendChild(section);
}

/**
 * MILESTONE 3, Phase 1 -- reviewer-facing confidence signal for autosave
 * (Andrew's success criterion: "complete long-running reviews confidently
 * without worrying about losing work"). `lastAutosaveAt === updatedAt` is
 * the same staleness comparison technique Workspace.ts's own
 * `verifiedSessionUpdatedAt` uses elsewhere in this codebase -- no separate
 * boolean to forget to flip; it is derived fresh from WorkspaceState every
 * render(). Quota warnings take priority over the ordinary saved/saving
 * text since they are the one signal that means autosave may stop working
 * soon even though it has been succeeding so far.
 */
function renderPersistenceStatus(container: HTMLElement, state: ReturnType<WorkspaceCommandDispatcher["getState"]>): void {
  const status = el("span", { class: "persistence-status" });
  if (state.persistence.lastAutosaveError) {
    status.textContent = `Could not save locally: ${state.persistence.lastAutosaveError}`;
    status.classList.add("persistence-status-error");
  } else if (state.persistence.quotaStatus === "exceeded") {
    status.textContent = "Local storage is full -- recent changes may not be saved.";
    status.classList.add("persistence-status-error");
  } else if (state.persistence.quotaStatus === "approaching-limit") {
    status.textContent = "Local storage is nearly full.";
    status.classList.add("persistence-status-warn");
  } else if (state.reviewSession && state.persistence.lastAutosaveAt === state.reviewSession.updatedAt) {
    status.textContent = "All changes saved";
  } else {
    status.textContent = "Saving…";
  }
  container.appendChild(status);
}

/** MILESTONE 3, Phase 3 ("ReplacementRuleEngine"). Reused decision
 *  distribution + entity-type counts helper -- also used by
 *  renderReviewStatistics() below. Kept a plain function rather than a
 *  method anywhere; it reads only already-computed WorkspaceState fields,
 *  the same "derive, don't own" boundary as every other render* helper in
 *  this file. */
function decisionDistribution(session: ReviewSession | null): Record<CandidateDecisionKind, number> {
  const counts: Record<CandidateDecisionKind, number> = { Keep: 0, Rename: 0, Redact: 0, Ignore: 0 };
  if (!session) return counts;
  for (const decision of Object.values(session.candidateDecisions)) counts[decision.decision]++;
  return counts;
}

function entityTypeCounts(candidates: Candidate[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const candidate of candidates) counts.set(candidate.detectedType, (counts.get(candidate.detectedType) ?? 0) + 1);
  return counts;
}

/**
 * Simple, explainable estimated-completion heuristic (Andrew's Phase 5
 * bullet): average time-per-decision so far, extrapolated across the
 * remaining unresolved count. Deliberately NOT a model or a prediction --
 * just arithmetic over this session's own `candidate-decided` event
 * timestamps (already durable, already there), consistent with CLAUDE.md's
 * "keep AI explainable rather than magical" -- there is no AI here at all,
 * only a rate computed from the reviewer's own observed pace. Returns null
 * (rendered as absent, not as a guess) whenever there isn't enough history
 * to compute a rate yet, rather than showing a number built from one data
 * point.
 */
function estimateRemainingReviewTime(session: ReviewSession | null, remainingCount: number): string | null {
  if (!session || remainingCount <= 0) return null;
  const decidedEvents = session.events.filter((event) => event.kind === "candidate-decided");
  if (decidedEvents.length < 2) return null;
  const first = Date.parse(decidedEvents[0]!.at);
  const last = Date.parse(decidedEvents[decidedEvents.length - 1]!.at);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first) return null;
  const msPerDecision = (last - first) / (decidedEvents.length - 1);
  const estimatedMinutes = Math.round((msPerDecision * remainingCount) / 60000);
  if (estimatedMinutes < 1) return "less than a minute";
  if (estimatedMinutes < 60) return `~${estimatedMinutes} min`;
  const hours = Math.round(estimatedMinutes / 6) / 10;
  return `~${hours} hr`;
}

/**
 * MILESTONE 3, Phase 5 ("Review Statistics"). One compact row, always
 * visible once a document is loaded -- Andrew: "assist reviewer awareness
 * rather than becoming dashboards... favor clarity over quantity." Every
 * number here is read or trivially derived from WorkspaceState the same
 * way readiness/stageStatuses already are elsewhere in this file; nothing
 * here recomputes resolved/unresolved status independently (this file's
 * own architectural boundary, stated at its top). Entity-type counts are
 * the one genuinely secondary stat Andrew's list names ("entity counts")
 * -- tucked behind a <details> toggle rather than added to the always-
 * visible row, so the primary row stays scannable at a glance.
 */
function renderReviewStatistics(container: HTMLElement, state: ReturnType<WorkspaceCommandDispatcher["getState"]>): void {
  const candidates = state.detection?.candidates ?? [];
  const total = candidates.length;
  if (total === 0) return;
  const reviewed = total - state.readiness.unresolvedItemCount;
  const completionPercent = Math.round((reviewed / total) * 100);
  const distribution = decisionDistribution(state.reviewSession);
  const ambiguityCount = state.grouping?.ambiguityProposals.length ?? 0;
  const estimate = estimateRemainingReviewTime(state.reviewSession, state.readiness.unresolvedItemCount);

  const stats = el("div", { class: "review-stats" });
  stats.appendChild(el("span", { class: "review-stats-item" }, `${completionPercent}% complete (${reviewed}/${total})`));
  stats.appendChild(
    el("span", { class: "review-stats-item" }, `Keep ${distribution.Keep} · Rename ${distribution.Rename} · Redact ${distribution.Redact} · Ignore ${distribution.Ignore}`)
  );
  if (ambiguityCount > 0) stats.appendChild(el("span", { class: "review-stats-item" }, `${ambiguityCount} ambiguous`));
  if (estimate) stats.appendChild(el("span", { class: "review-stats-item" }, `${estimate} remaining`));

  const byType = entityTypeCounts(candidates);
  if (byType.size > 0) {
    const details = detailsEl("review-stats-by-type", { class: "review-stats-by-type" });
    details.appendChild(el("summary", {}, "By type"));
    const list = el("ul", {});
    for (const [type, count] of [...byType.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      list.appendChild(el("li", {}, `${type}: ${count}`));
    }
    details.appendChild(list);
    stats.appendChild(details);
  }
  container.appendChild(stats);
}

/**
 * MILESTONE 1 (2026-07-28): explicit design decision from Andrew, recorded
 * here per this file's own "document architectural decisions" convention --
 * confirmed to DIFFER from docs/architecture/review-workspace-reconstruction.md
 * §1.1/§2 item 7's read of Python's "all stages simultaneously visible,
 * collapsible" layout. These five tabs are horizontal WORKSPACE tabs, not
 * wizard steps: a reviewer may switch to any stage at any time, regardless
 * of completion, exactly like FocusNavigator's own `moveStage`/`focusStage`
 * already allow at the command level (see FocusState.ts's "Not a wizard"
 * doc comment) -- nothing here disables or gates a tab on a prior stage's
 * completion. "Completion Beats Movement" (v0.2 §4.4) is preserved through
 * a different mechanism than Python's single-scrolling-page layout: each
 * tab's own label carries a live unresolved/total count so a reviewer
 * always sees what's left in a stage without having to open it, and
 * decisions never disappear or move to another tab merely because they
 * were made (Item Check keeps a decided candidate in place with its
 * decision shown inline, exactly as before). This reconstruction doc's own
 * §2 gap item 7 is superseded by this instruction, not silently
 * contradicted -- see docs/architecture/review-workspace-reconstruction.md's
 * Milestone 1 addendum.
 */
function renderStageTabs(container: HTMLElement, activeStage: WorkflowStage, statuses: ReturnType<WorkspaceCommandDispatcher["getState"]>["stageStatuses"]): void {
  const tabs = el("div", { class: "stage-tabs" });
  for (const status of statuses) {
    const label = `${STAGE_LABELS[status.stage]}${status.hasItems ? ` (${status.unresolvedCount}/${status.itemCount})` : ""}`;
    const isActive = status.stage === activeStage;
    const tab = button(label, () => {
      dispatcher.dispatchNavigation({ family: "navigation", type: "focusStage", stage: status.stage });
      render();
    });
    tab.className = isActive ? "tab tab-active" : "tab";
    // Deliberately NOT disabled -- an empty/not-yet-relevant stage is still
    // freely switchable (non-linear workspace tabs, not a wizard); the
    // title only informs, it never gates.
    if (!status.available) tab.title = "Nothing to review here yet";
    tabs.appendChild(tab);
  }
  container.appendChild(tabs);
}

/**
 * WORKSPACE INTERACTION REVISION: reviewer actions only -- Keep/Rename/
 * Redact/Ignore. The Detail/Close button that used to sit here is REMOVED,
 * not just relabeled: expansion is no longer an independent state a
 * button could toggle (see `acknowledgement`'s doc comment above), so
 * there is nothing left for such a button to do. Evaluated per Andrew's
 * explicit instruction to consider removing it entirely rather than
 * retaining it out of habit. Ambiguity linking also no longer lives here
 * -- see renderPossibleIdentities(), called from inside the detail panel
 * instead, since "ambiguity choices are evidence, not actions."
 */
function decisionButtons(candidateId: string, stage: WorkflowStage, container: HTMLElement): void {
  container.appendChild(button("Keep", () => decideAndAdvance({ family: "review", type: "keepCandidate", candidateId }, candidateId, stage)));

  // RELABELED (2026-07-29, interaction model revision): "Rename" -> "Change"
  // (key C, not N) -- Andrew's own reasoning, "allows the first letter of
  // the word to be the command." Display-only; the underlying decision
  // string stays "Rename" (CandidateDecisionKind, renameCandidate) -- see
  // keymap.ts's top doc comment for why that vocabulary is deliberately
  // left alone.
  const renameEditing = isEditingCandidate(candidateId, stage, "Rename");
  const renameBtn = button("Change", () => openInlineEditor({ scope: "candidate", stage, candidateId, action: "Rename" }));
  renameBtn.classList.toggle("action-editing", renameEditing);
  container.appendChild(renameBtn);

  const redactEditing = isEditingCandidate(candidateId, stage, "Redact");
  const redactBtn = button("Redact", () => openInlineEditor({ scope: "candidate", stage, candidateId, action: "Redact" }));
  redactBtn.classList.toggle("action-editing", redactEditing);
  container.appendChild(redactBtn);

  container.appendChild(button("Ignore", () => decideAndAdvance({ family: "review", type: "ignoreCandidate", candidateId }, candidateId, stage)));

  if (renameEditing) renderInlineEditor(container, "Replacement text (required)");
  if (redactEditing) renderInlineEditor(container, "Optional replacement text (blank = default placeholder)");
}

/** The reviewer-visible list for `stage`, in displayed order -- the
 *  snapshot dispatchReviewWithVisibleAdvance() captures BEFORE dispatching.
 *  item-check: search/sort/filter (+ Category Check narrowing) via
 *  visibleItemCheckIds(); group-check: the active sort via
 *  visibleGroupIds(); ambiguity-check: its full traversal list IS the
 *  visible list (no search/filter/sort layer -- see itemCheckQuery.ts's
 *  SCOPE DECISION note), so the structural proposal order is returned
 *  as-is. qa/output have no item list. */
function snapshotVisibleIdsForStage(stage: WorkflowStage, state: ReturnType<WorkspaceCommandDispatcher["getState"]>): string[] | null {
  switch (stage) {
    case "item-check":
      return visibleItemCheckIds(state);
    case "group-check":
      return visibleGroupIds(state);
    case "ambiguity-check":
      return state.grouping?.ambiguityProposals.map((p) => p.candidateId) ?? [];
    case "qa":
    case "output":
      return null;
  }
}

/** UI-side resolved test, delegating to the domain's own isItemResolved()
 *  (stages.ts) -- the exact predicate reconcile() itself advances by, so
 *  the visible-order advance below can never disagree with the domain
 *  about WHAT counts as resolved (group coverage, member-by-member group
 *  resolution, and plain candidate decisions all included), only about
 *  which ORDER to scan in. Deliberately not a re-implementation: app.ts's
 *  own boundary comment forbids duplicating resolved/unresolved logic. */
function isItemResolvedInState(stage: WorkflowStage, itemId: string, state: ReturnType<WorkspaceCommandDispatcher["getState"]>): boolean {
  if (!state.detection || !state.grouping || !state.reviewSession) return false;
  return isItemResolved(stage, itemId, { detection: state.detection, grouping: state.grouping }, state.reviewSession);
}

/**
 * RX-02b (2026-07-29): the ONE review-dispatch path every decision in this
 * file routes through, wrapping dispatcher.dispatchReview() with the
 * visible-order post-decision advance. Shape, per interception step:
 *
 *   1. BEFORE dispatching, snapshot the focused item and the visible
 *      ordered ids for its stage -- pre-decision, because under
 *      "Unreviewed only" (or Category Check's default "To Review") the
 *      just-decided item vanishes from a post-decision evaluation of the
 *      list, leaving no anchor for "next"; the pre-decision order is also
 *      simply the order the reviewer was looking at when they acted.
 *   2. Dispatch as before -- CommandDispatcher still runs
 *      FocusNavigator.reconcile() on success; nothing suppresses it. The
 *      domain's own answer stays authoritative for everything but display
 *      order.
 *   3. If the decision RESOLVED the item the reviewer was on, recompute
 *      the advance over the SNAPSHOT via advanceWithinVisibleList()
 *      (forward, then backward, then stay -- no wrap; see that module's
 *      doc comment) and, when it differs from where reconcile() landed,
 *      re-select it through the ordinary navigation.selectItem command.
 *
 * The interception is UNCONDITIONAL over the visible list -- never gated on
 * "did reconcile()'s answer fall off the visible list": under a sort with
 * no filter every item is still present, the gate would never fire, and
 * focus would still jump to the structurally-adjacent row. Guards, each
 * preserving an existing behavior rather than adding one:
 *   - failed dispatch: no advance (focus never moved before either);
 *   - an open Not Quite panel after dispatch: reconcile()'s own
 *     panel-following is correct and selectItem is rejected while a panel
 *     is open -- member decisions inside the panel deliberately do not
 *     move stage-level focus;
 *   - the focused item is still unresolved after the dispatch (a decision
 *     on some OTHER row via mouse, an ambiguity link that doesn't resolve,
 *     enterNotQuite, an exited-incomplete Not Quite): reconcile() already
 *     keeps focus exactly where it is, and so does this.
 *
 * `FocusNavigator`/`navigator.ts`/`keymap.ts` are untouched: this is a
 * UI-layer interception over UI-only display order, the same boundary
 * moveWithinVisibleList's doc comment already records. Callers still
 * render() exactly once, after this returns (two dispatches, one render --
 * goToNextAmbiguity's existing precedent).
 */
function dispatchReviewWithVisibleAdvance(command: ReviewCommand): ReviewTransactionResult {
  const before = dispatcher.getState();
  const preTarget = before.focus?.target ?? null;
  const stage = preTarget?.stage ?? null;
  const preItemId = preTarget?.itemId ?? null;
  const visibleIds = stage !== null && preItemId !== null ? snapshotVisibleIdsForStage(stage, before) : null;

  const result = dispatcher.dispatchReview(command);
  if (!result.ok || stage === null || preItemId === null || visibleIds === null) return result;

  const after = dispatcher.getState();
  if (after.focus?.target.panel.kind === "not-quite") return result;
  if (!isItemResolvedInState(stage, preItemId, after)) return result;

  // null = every visible item is resolved: REMAIN on the item just decided
  // (re-selecting it if reconcile() wandered off to a structurally-adjacent
  // but currently-hidden unresolved item -- focus must never land on a row
  // the reviewer cannot see).
  const target = advanceWithinVisibleList(preItemId, visibleIds, (id) => isItemResolvedInState(stage, id, after)) ?? preItemId;
  if (target !== after.focus?.target.itemId) {
    dispatcher.dispatchNavigation({ family: "navigation", type: "selectItem", itemId: target });
  }
  return result;
}

/**
 * Dispatches a review decision (Keep/Rename/Redact/Ignore, or an ambiguity
 * link -- same call site, same rhythm for both per Andrew's "this follows
 * the same interaction philosophy as Keep/Rename/Ignore/Redact") and starts
 * a purely visual acknowledgement pulse on the just-decided candidate.
 * `WorkspaceCommandDispatcher.dispatchReview()` already triggers
 * `FocusNavigator.reconcile()` on success (CommandDispatcher.ts), which
 * advances focus to the next unresolved item synchronously -- this function
 * does not compute or duplicate that, but (RX-02b, 2026-07-29) it routes
 * the dispatch through dispatchReviewWithVisibleAdvance, which re-selects
 * the advance target over the DISPLAYED order whenever the reviewer's
 * active sort/filter/narrowing makes that diverge from the domain's
 * structural order -- see that function's doc comment. RX-14 (2026-07-29): the
 * acknowledgement no longer delays revealing the advanced focus -- the next
 * row expands immediately while the leaving row pulses behind it (see
 * `acknowledgement`'s own doc comment). A fast reviewer deciding the next
 * item before the timeout fires would be confusing (two overlapping
 * acknowledgements racing to clear each other), so any pending timer is
 * cancelled first -- the same "cancel-then-restart" discipline this file's
 * autosave queue already uses for a different overlapping-async concern.
 */
function decideAndAdvance(command: AnyCommand, candidateId: string, stage: WorkflowStage): void {
  // Switching decisions (2026-07-29): a candidate-scope editor open for
  // THIS candidate closes the moment a different decision commits --
  // draftTextCache already holds whatever was typed (write-through on every
  // keystroke, see renderInlineEditor), so this loses nothing; it just
  // stops a stale editor from lingering open under a row whose decision has
  // already changed underneath it. A no-op when confirmInlineEditor already
  // cleared inlineEditor itself (the Change/Redact-confirm path).
  if (inlineEditor?.scope === "candidate" && inlineEditor.candidateId === candidateId) inlineEditor = null;
  if (command.family === "review") dispatchReviewWithVisibleAdvance(command);
  acknowledge({ kind: "candidate", stage, candidateId });
  render();
}

/** Group-level counterpart to decideAndAdvance() -- see AcknowledgementTarget's
 *  doc comment for why every decision action needs this now, not just
 *  per-candidate ones. Used for the "everyone selected" bulk actions
 *  (confirmGroup/ignoreGroup/redactGroup/flattenGroup), which never fail
 *  validation the way a narrowed bulkApplyDecision call can. */
function decideGroupAndAdvance(command: AnyCommand, groupId: string): void {
  if (inlineEditor?.scope === "group-subset" && inlineEditor.groupId === groupId) inlineEditor = null;
  if (command.family === "review") dispatchReviewWithVisibleAdvance(command);
  acknowledge({ kind: "group", groupId });
  render();
}

/** Same, for the checked-SUBSET bulk path (Keep selected/Ignore selected,
 *  and confirmInlineEditor's own group-subset fallback for a narrowed
 *  selection or custom text) -- these route through bulkApplyDecision,
 *  which CAN fail (e.g. an empty candidate list), so this preserves the
 *  alert-on-fail handling every one of those call sites used to duplicate
 *  individually, rather than losing it in the generalization. */
function decideGroupBulkAndRender(command: AnyCommand, groupId: string): void {
  if (command.family !== "review") return;
  if (inlineEditor?.scope === "group-subset" && inlineEditor.groupId === groupId) inlineEditor = null;
  // RX-02b: a subset decision can RESOLVE the whole group (group resolution
  // is derived from member decisions -- groupDisplayDecision), so this path
  // needs the same visible-order advance as the all-selected one above.
  const result = dispatchReviewWithVisibleAdvance(command);
  if (!result.ok) {
    window.alert(`Action failed: ${result.reason}`);
    render();
    return;
  }
  acknowledge({ kind: "group", groupId });
  render();
}

/** Not Quite member counterpart -- Keep/Ignore (direct) and Change/Redact
 *  (via confirmInlineEditor's not-quite-member branch) all route through
 *  here now. Previously these got NO acknowledgement at all (see
 *  AcknowledgementTarget's doc comment) -- a real gap, not by design. */
function decideNotQuiteMemberAndRender(command: AnyCommand, groupId: string, candidateId: string): void {
  if (inlineEditor?.scope === "not-quite-member" && inlineEditor.groupId === groupId && inlineEditor.candidateId === candidateId) inlineEditor = null;
  // RX-02b: routed through the shared choke point for uniformity, but its
  // open-panel guard makes this a provable no-advance while Not Quite is
  // open -- reconcile()'s own panel-following behavior stays authoritative
  // for member-by-member work, exactly as before.
  if (command.family === "review") dispatchReviewWithVisibleAdvance(command);
  acknowledge({ kind: "not-quite-member", groupId, candidateId });
  render();
}

/**
 * "Possible identities" -- moved inside the detail panel (see
 * renderCandidateDetailPanel) per Andrew's explicit "ambiguity choices are
 * evidence, not actions... they belong alongside Explanation/Representative
 * snippets/Occurrence Browser/Expert View." Renders every proposed option
 * as one clickable, immediately-selecting row -- deliberately the SAME
 * structure whether there is exactly one option ("display it naturally...
 * selecting it immediately performs the link, no additional confirmation
 * button") or several ("present them as a selectable list... selecting a
 * candidate should immediately perform the link"): a list of one is still
 * a list, and forking the markup by option count would be exactly the
 * kind of incidental interface-mechanics Andrew's instruction asks to
 * minimize, not preserve. Declining every option still needs no dedicated
 * affordance -- Keep/Rename/Redact/Ignore in the row above already cover
 * it. Not gated to the ambiguity-check stage: a candidate's proposed
 * identities are evidence about that candidate wherever it's being looked
 * at, Item Check included.
 */
function renderPossibleIdentities(candidateId: string, stage: WorkflowStage, state: ReturnType<WorkspaceCommandDispatcher["getState"]>, container: HTMLElement): void {
  const proposal = state.grouping?.ambiguityProposals.find((p) => p.candidateId === candidateId);
  if (!proposal || proposal.candidateGroupOptions.length === 0) return;
  const resolved = state.reviewSession?.ambiguityResolutions[candidateId];

  container.appendChild(el("div", { class: "detail-section-title" }, "Possible identities"));
  const list = el("div", { class: "possible-identity-list" });
  for (const option of proposal.candidateGroupOptions) {
    const isCurrent = resolved?.resolvedGroupId === option.groupId;
    const optionButton = el("button", {
      class: isCurrent ? "possible-identity-option possible-identity-option-current" : "possible-identity-option",
    });
    optionButton.appendChild(el("span", { class: "possible-identity-name" }, option.canonicalName));
    optionButton.appendChild(el("span", { class: `badge ${confidenceBadgeClass(option.confidence)}` }, `${option.confidence}%`));
    if (isCurrent) optionButton.appendChild(el("span", { class: "possible-identity-check" }, "✓ Linked"));
    optionButton.addEventListener("click", () =>
      decideAndAdvance({ family: "review", type: "linkAmbiguousCandidate", candidateId, groupId: option.groupId }, candidateId, stage)
    );
    list.appendChild(optionButton);
  }
  container.appendChild(list);
}

function confidenceBadgeClass(likelihood: number): "badge-good" | "badge-warn" | "badge-caution" {
  if (likelihood >= 90) return "badge-good";
  if (likelihood >= 80) return "badge-warn";
  return "badge-caution";
}

function recommendationLabel(recommendation: Recommendation): string {
  return recommendation === "ToReview" ? "To Review" : "Unlikely";
}

/** Matches Python's `displayDetector()` mapping -- only the sources this
 *  codebase's DetectionEngine actually produces are included (no spaCy/
 *  dictionary/hybrid detectors exist here, unlike Python's fuller pipeline);
 *  an unrecognized source falls back to the raw value, exactly like
 *  Python's own `labels[value] || value`. */
function displayDetector(source: string): string {
  const labels: Record<string, string> = {
    regex: "Regex",
    "fallback-name-regex": "Fallback Regex",
    "fallback-single-name-regex": "Fallback Regex",
  };
  return labels[source] ?? source;
}

/**
 * CandidateDetailPanel -- badges, ExplanationEngine's Standard View summary,
 * representative context snippets, Possible identities (when this candidate
 * has a live ambiguity proposal), a collapsible occurrence browser (grouped
 * by OccurrenceClassifier's kind buckets), and a collapsible Expert View
 * (positive/negative/neutral evidence, diagnostic categories, raw scoring
 * explanation, detector).
 *
 * WORKSPACE INTERACTION REVISION (2026-07-29): ordering changed from
 * Python's original badges -> summary -> snippets -> occurrences -> Expert
 * View to insert "Possible identities" between snippets and occurrences,
 * per Andrew's explicit instruction that ambiguity choices "belong
 * alongside Explanation, Representative snippets, Occurrence Browser,
 * Expert View" as evidence answering "what is this?", positioned right
 * after the evidence that most directly explains it (the snippets) and
 * before the deeper-dive sections (occurrences, Expert View). Everything
 * else about this panel's structure is unchanged from the original
 * structural port -- see docs/architecture/review-workspace-reconstruction.md
 * §1.6 for that record.
 */
function renderCandidateDetailPanel(
  container: HTMLElement,
  candidate: Candidate,
  quality: QualityResult | null,
  reviewOccurrences: OccurrenceGroup[],
  existingDecision: string | undefined,
  stage: WorkflowStage,
  state: ReturnType<WorkspaceCommandDispatcher["getState"]>
): void {
  const evidence = quality?.evidenceByCandidate[candidate.id] ?? [];
  const likelihood = quality?.scoreByCandidate[candidate.id] ?? 0;
  const recommendation: Recommendation = quality?.recommendationByCandidate[candidate.id] ?? "ToReview";
  const assessment: CandidateQualityAssessment | undefined = quality?.assessmentByCandidate[candidate.id];

  const context = buildExplanationContext({
    candidateId: candidate.id,
    entityType: candidate.detectedType,
    likelihood,
    recommendation,
    occurrenceCount: candidate.occurrenceIds.length,
    evidence,
    assessment,
    ...(existingDecision !== undefined ? { existingDecision } : {}),
  });
  const standard = explanationEngine.explain(context, "standard") as StandardExplanation;
  const expert = explanationEngine.explain(context, "expert") as ExpertExplanation;

  const panel = el("div", { class: "detail-panel" });

  const badges = el("div", { class: "detail-badges" });
  badges.appendChild(el("span", { class: `badge ${confidenceBadgeClass(likelihood)}` }, `${likelihood}%`));
  badges.appendChild(el("span", { class: "badge" }, candidate.detectedType));
  badges.appendChild(el("span", { class: "badge" }, recommendationLabel(recommendation)));
  panel.appendChild(badges);

  panel.appendChild(el("p", { class: "detail-summary" }, standard.summary));

  const snippetsHeading = el("div", { class: "detail-section-title" }, "Representative snippets");
  panel.appendChild(snippetsHeading);
  const allOccurrences = reviewOccurrences.flatMap((group) => group.occurrences);
  if (allOccurrences.length === 0) {
    panel.appendChild(el("p", { class: "hint" }, "No occurrences recorded."));
  } else {
    for (const occurrence of allOccurrences.slice(0, 5)) {
      panel.appendChild(
        el("p", { class: "context-snippet" }, `${occurrence.context.before}[${occurrence.context.match}]${occurrence.context.after}`)
      );
    }
  }

  renderPossibleIdentities(candidate.id, stage, state, panel);

  const occurrenceDetails = detailsEl(`occurrence-browser:${candidate.id}`, { class: "occurrence-browser" });
  occurrenceDetails.appendChild(el("summary", {}, `All occurrences (${candidate.occurrenceIds.length})`));
  if (reviewOccurrences.length === 0) {
    occurrenceDetails.appendChild(el("p", { class: "hint" }, "No occurrences recorded."));
  } else {
    for (const group of reviewOccurrences) {
      const groupDetails = detailsEl(`occurrence-group:${candidate.id}:${group.label}`, { class: "occurrence-group" });
      groupDetails.appendChild(el("summary", {}, `${group.label} (${group.occurrenceCount})`));
      for (const occurrence of group.occurrences) {
        groupDetails.appendChild(
          el("p", { class: "context-snippet" }, `${occurrence.context.before}[${occurrence.context.match}]${occurrence.context.after}`)
        );
      }
      occurrenceDetails.appendChild(groupDetails);
    }
  }
  panel.appendChild(occurrenceDetails);

  const expertDetails = detailsEl(`expert-view:${candidate.id}`, { class: "expert-view" });
  expertDetails.appendChild(el("summary", {}, "Expert View"));
  const expertGrid = el("div", { class: "expert-grid" });

  const factsColumn = el("div", {});
  factsColumn.appendChild(el("div", { class: "detail-section-title" }, "Likelihood"));
  factsColumn.appendChild(el("p", {}, `${expert.likelihood}%`));
  factsColumn.appendChild(el("div", { class: "detail-section-title" }, "Recommendation"));
  factsColumn.appendChild(el("p", {}, recommendationLabel(expert.recommendation)));
  factsColumn.appendChild(el("div", { class: "detail-section-title" }, "Current disposition"));
  factsColumn.appendChild(el("p", {}, expert.currentDisposition));
  factsColumn.appendChild(el("div", { class: "detail-section-title" }, "Type"));
  factsColumn.appendChild(el("p", {}, candidate.detectedType));
  factsColumn.appendChild(el("div", { class: "detail-section-title" }, "Detector"));
  factsColumn.appendChild(el("p", {}, `${displayDetector(candidate.source)} (${candidate.source})`));
  expertGrid.appendChild(factsColumn);

  const evidenceColumn = el("div", {});
  const evidenceList = (label: string, items: ExpertExplanation["positiveEvidence"]): void => {
    evidenceColumn.appendChild(el("div", { class: "detail-section-title" }, label));
    if (items.length === 0) {
      evidenceColumn.appendChild(el("p", { class: "hint" }, "None recorded."));
      return;
    }
    const list = el("ul", {});
    for (const item of items) {
      const sign = item.weight > 0 ? "+" : "";
      list.appendChild(el("li", {}, `${sign}${item.weight} ${item.expert}`));
    }
    evidenceColumn.appendChild(list);
  };
  evidenceList("Positive evidence", expert.positiveEvidence);
  evidenceList("Negative evidence", expert.negativeEvidence);
  evidenceList("Neutral evidence", expert.neutralEvidence);
  expertGrid.appendChild(evidenceColumn);

  const diagnosticColumn = el("div", {});
  diagnosticColumn.appendChild(el("div", { class: "detail-section-title" }, "Diagnostic categories"));
  diagnosticColumn.appendChild(
    el("p", {}, expert.diagnosticCategories.length ? expert.diagnosticCategories.map(categoryRuleLabel).join(", ") : "None recorded")
  );
  diagnosticColumn.appendChild(el("div", { class: "detail-section-title" }, "Raw scoring explanation"));
  diagnosticColumn.appendChild(el("p", {}, expert.rawScoringExplanation || "No explanation recorded."));
  expertGrid.appendChild(diagnosticColumn);

  expertDetails.appendChild(expertGrid);
  panel.appendChild(expertDetails);

  container.appendChild(panel);
}

/** Per-candidate decision command types that get the acknowledgement +
 *  delayed-advance treatment (see decideAndAdvance's doc comment) --
 *  deliberately NOT bulkApplyDecision/confirmGroup/etc., which apply to
 *  many candidates or a whole group at once and have no single row to
 *  hold an acknowledgement on. */
const CANDIDATE_DECISION_TYPES = new Set(["keepCandidate", "renameCandidate", "redactCandidate", "ignoreCandidate", "linkAmbiguousCandidate"]);

function dispatchAndRender(command: AnyCommand): void {
  // Route keyboard-shortcut-driven decisions (K/N/R/I, resolved by
  // keymap.ts and dispatched here, not through decisionButtons()' own
  // button handlers) through the SAME decideAndAdvance() acknowledgement
  // path mouse clicks use -- otherwise "Read -> Decide -> Immediate
  // Feedback -> Continue" would only ever apply to mouse users, which
  // directly contradicts this revision's "keyboard navigation" requirement.
  if (command.family === "review" && CANDIDATE_DECISION_TYPES.has(command.type)) {
    const candidateId = (command as { candidateId: string }).candidateId;
    const stage = dispatcher.getState().focus?.target.stage ?? "item-check";
    decideAndAdvance(command, candidateId, stage);
    return;
  }
  // RX-02b: review commands that reach this generic path (completeNotQuite,
  // exitNotQuite, enterNotQuite, ...) also route through the visible-order
  // choke point -- completing a Not Quite whose members are all decided
  // resolves the group, which must advance in DISPLAYED group order under
  // an active sort, not structural order. The choke point's own guards make
  // it a no-op for every review command that doesn't resolve the focused
  // item (enterNotQuite included).
  if (command.family === "review") dispatchReviewWithVisibleAdvance(command);
  else if (command.family === "navigation") dispatcher.dispatchNavigation(command);
  else if (command.family === "history") dispatcher.dispatchHistory(command);
  render();
}

/** Item Check's candidate pool, independent of Category Check filtering --
 *  the pool Category Check's aggregation counts/filters run over (see
 *  docs/architecture/review-workspace-reconstruction.md §1.10: Category
 *  Check is a view over this same pool, not a separate candidate list). */
function itemCheckCandidateStatus(candidate: Candidate, state: ReturnType<WorkspaceCommandDispatcher["getState"]>): CandidateReviewStatus {
  const decided = state.reviewSession?.candidateDecisions[candidate.id];
  if (decided) return "resolved";
  const recommendation = state.quality?.recommendationByCandidate[candidate.id];
  return recommendation === "Unlikely" ? "unlikely" : "toReview";
}

function candidateCategories(candidate: Candidate, state: ReturnType<WorkspaceCommandDispatcher["getState"]>): string[] {
  const assessment = state.quality?.assessmentByCandidate[candidate.id];
  if (!assessment) return [];
  return assessment.filterRules.length ? assessment.filterRules : assessment.reasons;
}

/** RX-02a -- builds the CategoryViewFacts array itemCheckCategoryView.ts's
 *  pure narrowing helper needs, from the same per-candidate reads
 *  renderCategoryCheckPanel already performed inline
 *  (itemCheckCandidateStatus/candidateCategories). Mirrors
 *  buildCandidateQueryFacts() below: not a new source of truth, just a
 *  stable, DOM-free shape to filter over. */
function buildCategoryViewFacts(candidateIds: string[], state: ReturnType<WorkspaceCommandDispatcher["getState"]>): CategoryViewFacts[] {
  const facts: CategoryViewFacts[] = [];
  for (const candidateId of candidateIds) {
    const candidate = state.detection?.candidates.find((c) => c.id === candidateId);
    if (!candidate) continue;
    facts.push({ candidateId, status: itemCheckCandidateStatus(candidate, state), categories: candidateCategories(candidate, state) });
  }
  return facts;
}

function renderItemCheckViewToggle(container: HTMLElement): void {
  const toggle = el("div", { class: "view-toggle" });
  const listButton = button("List", () => {
    itemCheckViewMode = "list";
    render();
  });
  const categoryButton = button("By Category", () => {
    itemCheckViewMode = "category";
    render();
  });
  listButton.classList.toggle("chip-active", itemCheckViewMode === "list");
  categoryButton.classList.toggle("chip-active", itemCheckViewMode === "category");
  toggle.appendChild(listButton);
  toggle.appendChild(categoryButton);
  container.appendChild(toggle);
}

/**
 * MILESTONE 1, PHASE 2 -- Category Check aggregation/drill-down over the
 * SAME Item Check candidate pool (`candidateIds`, unchanged): a Review
 * State row (Total/To Review/Unlikely/Resolved) and a Category row
 * (evidence-category counts within the selected review state), matching
 * Python's qualityPanel's two outer axes.
 *
 * DOCUMENTED, INTENTIONAL SCOPING DECISION (per Andrew's "document
 * intentional deviations" instruction): Python has a THIRD axis inside
 * Category Check -- a per-category Context filter (e.g. "Single
 * Occurrence"/"Sentence Initial" within "Unknown capitalized token"). That
 * third axis is deliberately deferred out of Milestone 1 -- the two-axis
 * drill-down already delivers the core capability Andrew's Phase 2
 * instruction asks for (working "all Known-first-name matches" as a batch),
 * and the Context axis is a smaller, separable refinement, not required for
 * a first attorney reviewer to use Category Check meaningfully. See
 * docs/architecture/review-workspace-reconstruction.md §1.10.
 *
 * Returns the filtered candidateId list for the caller to render with the
 * SAME per-candidate row/decision-button code Item Check's list view
 * already uses -- Category Check narrows which candidates are shown, it
 * does not introduce a second way of rendering a candidate.
 */
function renderCategoryCheckPanel(container: HTMLElement, state: ReturnType<WorkspaceCommandDispatcher["getState"]>, candidateIds: string[]): string[] {
  const candidates = candidateIds
    .map((id) => state.detection?.candidates.find((c) => c.id === id))
    .filter((candidate): candidate is Candidate => Boolean(candidate));

  // RX-02a: both narrowing passes (review state here, category at the
  // bottom) now come from itemCheckCategoryView.ts's pure helper -- the
  // SAME function visibleItemCheckIds() applies for keyboard navigation, so
  // rendered membership and keyboard-traversed membership cannot drift.
  // The chip COUNTS below remain computed inline: they are presentation
  // (how many candidates WOULD each chip show), not membership.
  const categoryFacts = buildCategoryViewFacts(candidates.map((c) => c.id), state);
  const stateFilteredIds = new Set(narrowByCategoryView(categoryFacts, { reviewState: categoryReviewState, categoryFilter: null }));
  const stateFiltered = candidates.filter((candidate) => stateFilteredIds.has(candidate.id));

  const categoryCounts = new Map<string, number>();
  for (const candidate of stateFiltered) {
    for (const category of candidateCategories(candidate, state)) {
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
    }
  }
  const sortedCategories = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const panel = el("div", { class: "category-check-panel" });

  const stateRow = el("div", { class: "category-nav-row" });
  const stateOptions: { key: CategoryReviewState; label: string }[] = [
    { key: "total", label: "Total" },
    { key: "toReview", label: "To Review" },
    { key: "unlikely", label: "Unlikely" },
    { key: "resolved", label: "Resolved" },
  ];
  for (const option of stateOptions) {
    const count = candidates.filter((candidate) => option.key === "total" || itemCheckCandidateStatus(candidate, state) === option.key).length;
    const chip = button(`${option.label} (${count})`, () => {
      categoryReviewState = option.key;
      categoryFilter = null;
      render();
    });
    chip.classList.toggle("chip-active", categoryReviewState === option.key);
    stateRow.appendChild(chip);
  }
  panel.appendChild(stateRow);

  const categoryRow = el("div", { class: "category-nav-row" });
  const showAllChip = button(`Show All (${stateFiltered.length})`, () => {
    categoryFilter = null;
    render();
  });
  showAllChip.classList.toggle("chip-active", categoryFilter === null);
  categoryRow.appendChild(showAllChip);
  for (const [category, count] of sortedCategories) {
    const chip = button(`${categoryRuleLabel(category)} (${count})`, () => {
      categoryFilter = category;
      render();
    });
    chip.classList.toggle("chip-active", categoryFilter === category);
    categoryRow.appendChild(chip);
  }
  panel.appendChild(categoryRow);

  container.appendChild(panel);

  return narrowByCategoryView(categoryFacts, { reviewState: categoryReviewState, categoryFilter });
}

/**
 * MILESTONE 2 -- builds the CandidateQueryFacts array itemCheckQuery.ts's
 * pure query function needs, from data app.ts already reads elsewhere for
 * rendering (likelihood, decision, categories) plus one new lookup
 * (ambiguity-proposal membership). Not a new source of truth -- every field
 * here is read directly from WorkspaceState/QualityResult/GroupingResult,
 * never recomputed.
 */
function buildCandidateQueryFacts(candidateIds: string[], state: ReturnType<WorkspaceCommandDispatcher["getState"]>): CandidateQueryFacts[] {
  const ambiguousIds = new Set(state.grouping?.ambiguityProposals.map((p) => p.candidateId) ?? []);
  const facts: CandidateQueryFacts[] = [];
  for (const candidateId of candidateIds) {
    const candidate = state.detection?.candidates.find((c) => c.id === candidateId);
    if (!candidate) continue;
    facts.push({
      candidate,
      likelihood: state.quality?.scoreByCandidate[candidateId],
      decision: state.reviewSession?.candidateDecisions[candidateId],
      isAmbiguous: ambiguousIds.has(candidateId),
      categories: candidateCategories(candidate, state),
    });
  }
  return facts;
}

/**
 * MILESTONE 2 -- Item Check's search box, advanced-filter preset chips, and
 * sort order select. Search updates the workspace immediately (an "input"
 * listener re-renders on every keystroke -- see searchInputFocusPending's
 * doc comment for how focus survives that). Sort is only offered in List
 * view -- Category view's own grouping already imposes its own order, so a
 * second, competing sort control there would be confusing, not useful (a
 * deliberate scope decision, not an oversight).
 */
function renderItemCheckToolbar(container: HTMLElement): void {
  const toolbar = el("div", { class: "item-check-toolbar" });

  const searchInput = el("input", {
    type: "search",
    placeholder: "Search text, replacement, category, type... (/)",
    class: "item-check-search-input",
  }) as HTMLInputElement;
  searchInput.value = itemCheckQueryState.searchText;
  searchInput.addEventListener("input", () => {
    itemCheckQueryState = { ...itemCheckQueryState, searchText: searchInput.value };
    searchInputFocusPending = { start: searchInput.selectionStart ?? searchInput.value.length, end: searchInput.selectionEnd ?? searchInput.value.length };
    render();
  });
  searchInput.addEventListener("keydown", (event) => {
    // "Jump to search result" (Milestone 2 Workspace Navigation): Enter
    // moves focus straight to the first candidate in the CURRENTLY
    // FILTERED list and returns keyboard control to the workspace, so a
    // reviewer can search then immediately use k/n/r/i without touching the
    // mouse. Scoped to this input's own listener (not the global keydown
    // handler) because shouldIgnoreKeyboardEvent() deliberately suppresses
    // ALL global shortcut resolution while an <input> has focus -- exactly
    // the behavior wanted for every OTHER key typed here, just not Enter.
    if (event.key === "Enter") {
      event.preventDefault();
      jumpToFirstSearchResult();
    }
  });
  toolbar.appendChild(searchInput);

  const presetRow = el("div", { class: "filter-preset-row" });
  for (const preset of FILTER_PRESETS) {
    const isActive = itemCheckQueryState.activePresets.has(preset.key);
    const chip = button(preset.label, () => {
      const next = new Set(itemCheckQueryState.activePresets);
      if (next.has(preset.key)) next.delete(preset.key);
      else next.add(preset.key);
      itemCheckQueryState = { ...itemCheckQueryState, activePresets: next };
      render();
    });
    chip.classList.toggle("chip-active", isActive);
    presetRow.appendChild(chip);
  }
  toolbar.appendChild(presetRow);

  if (itemCheckViewMode === "list") {
    const sortLabel = el("label", {}, "Sort: ");
    const sortSelect = el("select", { class: "sort-select" }) as HTMLSelectElement;
    for (const order of SORT_ORDERS) {
      const option = el("option", { value: order.key }, order.label);
      if (order.key === itemCheckQueryState.sortOrder) option.setAttribute("selected", "selected");
      sortSelect.appendChild(option);
    }
    sortSelect.addEventListener("change", () => {
      itemCheckQueryState = { ...itemCheckQueryState, sortOrder: sortSelect.value as ItemCheckQueryState["sortOrder"] };
      render();
    });
    sortLabel.appendChild(sortSelect);
    toolbar.appendChild(sortLabel);
  }

  container.appendChild(toolbar);
}

/**
 * MILESTONE 2 -- dispatches review.bulkApplyDecision for the CURRENT
 * selection. Rename prompts once for a single shared replacement string
 * applied to every selected candidate -- the same "prompt once, apply to
 * every member" interaction the group-level Rename action (flattenGroup)
 * already established for a group's canonical name, reused here for an
 * arbitrary selection.
 * Clears the selection on success (matching decisionButtons' own per-
 * candidate buttons, which don't leave any lingering "this was just
 * decided" UI state either) but deliberately leaves it in place on failure,
 * so a rejected bulk action doesn't force the reviewer to re-select
 * everything to try again.
 */
function dispatchBulkDecision(decision: CandidateDecisionKind): void {
  const candidateIds = [...selectedCandidateIds];
  if (candidateIds.length === 0) return;
  // Rename/Redact need reviewer-entered text (Rename requires it, Redact
  // accepts it optionally) -- both now open the same inline editor
  // confirmInlineEditor's own "bulk" branch dispatches from, rather than
  // this function dispatching them directly. Keep/Ignore need no text and
  // dispatch immediately, unchanged.
  if (decision === "Rename" || decision === "Redact") {
    openInlineEditor({ scope: "bulk", candidateIds, action: decision });
    return;
  }
  // RX-02b: a bulk decision that includes the focused candidate resolves
  // it, so this path advances in visible order through the same choke
  // point as the per-candidate buttons.
  const result = dispatchReviewWithVisibleAdvance({ family: "review", type: "bulkApplyDecision", candidateIds, decision });
  if (result.ok) selectedCandidateIds.clear();
  else window.alert(`Bulk action failed: ${result.reason}`);
  render();
}

/**
 * MILESTONE 2 -- selection summary + bulk action buttons, scoped to
 * whatever Item Check currently shows (`visibleCandidateIds`, i.e. AFTER
 * search/filter/Category-Check narrowing) so "Select all visible" can never
 * silently select something the reviewer can't currently see.
 */
function renderBulkToolbar(container: HTMLElement, visibleCandidateIds: string[], state: ReturnType<WorkspaceCommandDispatcher["getState"]>): void {
  const bar = el("div", { class: "bulk-toolbar" });
  bar.appendChild(el("span", { class: "bulk-selection-count" }, `${selectedCandidateIds.size} selected`));
  bar.appendChild(
    button(`Select all visible (${visibleCandidateIds.length})`, () => {
      for (const id of visibleCandidateIds) selectedCandidateIds.add(id);
      render();
    })
  );
  bar.appendChild(
    button("Clear selection", () => {
      selectedCandidateIds.clear();
      render();
    }, selectedCandidateIds.size === 0)
  );
  if (selectedCandidateIds.size > 0) {
    bar.appendChild(button("Keep selected", () => dispatchBulkDecision("Keep")));
    bar.appendChild(button("Change selected", () => dispatchBulkDecision("Rename")));
    bar.appendChild(button("Redact selected", () => dispatchBulkDecision("Redact")));
    bar.appendChild(button("Ignore selected", () => dispatchBulkDecision("Ignore")));
    if (isEditingBulk("Rename")) {
      // Rename radio quick-pick (2026-07-29, Group Check Python-parity
      // revision extended to Item Check's own bulk selection): distinct
      // spellings already present among the SELECTED candidates, same
      // rationale as Group Check's member quick-pick -- a reviewer picking
      // several similarly-spelled entries can standardize on one without
      // typing it.
      const quickPicks = [
        ...new Set(
          [...selectedCandidateIds]
            .map((id) => state.detection?.candidates.find((c) => c.id === id)?.displayValue)
            .filter((value): value is string => Boolean(value))
        ),
      ];
      renderInlineEditor(bar, `Replacement text for all ${selectedCandidateIds.size} selected (required)`, quickPicks);
    }
    if (isEditingBulk("Redact")) renderInlineEditor(bar, `Optional replacement text for all ${selectedCandidateIds.size} selected (blank = default placeholder)`);
  }
  container.appendChild(bar);
}

/**
 * MILESTONE 2 Workspace Navigation -- "Next undecided" / "Previous
 * decision" over the CURRENTLY VISIBLE (filtered/sorted) Item Check list,
 * wrapping at either end. Deliberately a UI-layer composition over
 * navigation.selectItem rather than a dispatch of the domain's own
 * moveItem(nextUnresolved)/(previousDecided): FocusNavigator's traversal
 * list is the STAGE's full candidate list, with no notion of Milestone 2's
 * UI-only search/filter narrowing (correctly so -- see Phase 9's own
 * "FocusNavigator must never depend on rendered/UI-only state" boundary).
 * Jumping within the full list while a filter is active would be
 * surprising (landing on an item the reviewer can't currently see),
 * contradicting Andrew's own "navigation should require minimal scrolling...
 * a reviewer should never feel lost" success criterion.
 */
function goToAdjacentInVisibleList(visibleCandidateIds: string[], state: ReturnType<WorkspaceCommandDispatcher["getState"]>, wantDecided: boolean, dir: "forward" | "backward"): void {
  if (visibleCandidateIds.length === 0) return;
  const currentId = state.focus?.target.stage === "item-check" ? state.focus.target.itemId : null;
  const currentIndex = currentId ? visibleCandidateIds.indexOf(currentId) : -1;
  const n = visibleCandidateIds.length;
  const isDecided = (id: string) => Boolean(state.reviewSession?.candidateDecisions[id]);
  const matches = (id: string) => isDecided(id) === wantDecided;
  const scan = (start: number, step: number): string | null => {
    let i = start;
    for (let count = 0; count < n; count++) {
      i = ((i % n) + n) % n;
      if (matches(visibleCandidateIds[i]!)) return visibleCandidateIds[i]!;
      i += step;
    }
    return null;
  };
  const target =
    dir === "forward" ? scan(currentIndex === -1 ? 0 : currentIndex + 1, 1) : scan(currentIndex === -1 ? n - 1 : currentIndex - 1, -1);
  if (target) {
    dispatcher.dispatchNavigation({ family: "navigation", type: "selectItem", itemId: target });
    render();
  }
}

/**
 * NAV-ORDER FIX (Group Check revision, 2026-07-29): Andrew reported arrow-
 * key browsing "jumping out of sequence" and asked whether it followed the
 * active sort or some predefined order -- it was the latter.
 * FocusNavigator's moveItem (bound to every arrow key + Home/End via
 * keymap.ts) always traverses itemIdsForStage()'s raw, structural order,
 * which has no relationship to Item Check's own search/sort/filter
 * (itemCheckQueryState) or Group Check's new sort (groupCheckSortOrder) --
 * correctly so on FocusNavigator's side (Phase 9's "must never depend on
 * rendered/UI-only state" boundary, same reasoning goToAdjacentInVisibleList
 * above already documents), but that boundary only says WHERE the fix
 * can't live, not that there shouldn't be one.
 *
 * This is that fix, generalizing goToAdjacentInVisibleList's own pattern
 * (already correct for "]"/"[") from "scan for the next matching item" to
 * plain sequential movement, clamped at both ends -- matching moveWithinItems'
 * own next/previous/first/last semantics (Math.min/Math.max, not wrapping)
 * exactly, just computed over the CURRENTLY DISPLAYED order instead of the
 * structural one. The keydown handler below intercepts moveItem commands
 * for item-check/group-check and redirects them here instead of dispatching
 * them verbatim, the same interception shape decideAndAdvance already
 * established for per-candidate decisions.
 *
 * (The KNOWN SCOPE LIMIT this comment used to disclose -- Category Check's
 * chip narrowing being invisible to arrow-key movement because it was
 * computed inline in renderCategoryCheckPanel's DOM pass -- is RESOLVED as
 * of RX-02a, 2026-07-29: the narrowing now lives in
 * itemCheckCategoryView.ts as a pure function, and visibleItemCheckIds()
 * applies it whenever the By Category view is active.)
 */
type SequentialMoveDirection = "next" | "previous" | "first" | "last";

/** Keymap.ts's arrow-key/Home/End bindings only ever produce these four
 *  moveItem directions for item-check/group-check (see keymap.ts's
 *  resolveKeyboardCommand) -- nextUnresolved/previousUnresolved/
 *  previousDecided reach FocusNavigator only via UI-composed dispatches
 *  (goToNextAmbiguity, goToAdjacentInVisibleList) that never pass through
 *  this interception point. Narrowing here rather than widening
 *  moveWithinVisibleList's signature keeps that function's own contract
 *  simple and keeps this a defensive, exhaustiveness-safe check rather than
 *  an assumption. */
function isSequentialDirection(direction: string): direction is SequentialMoveDirection {
  return direction === "next" || direction === "previous" || direction === "first" || direction === "last";
}

function moveWithinVisibleList(visibleIds: string[], currentId: string | null, direction: SequentialMoveDirection): void {
  if (visibleIds.length === 0) return;
  let target: string | null;
  if (direction === "first") target = visibleIds[0]!;
  else if (direction === "last") target = visibleIds[visibleIds.length - 1]!;
  else {
    const currentIndex = currentId ? visibleIds.indexOf(currentId) : -1;
    if (direction === "next") target = currentIndex === -1 ? visibleIds[0]! : (visibleIds[Math.min(visibleIds.length - 1, currentIndex + 1)] ?? null);
    else target = currentIndex === -1 ? visibleIds[visibleIds.length - 1]! : (visibleIds[Math.max(0, currentIndex - 1)] ?? null);
  }
  if (target !== null) {
    dispatcher.dispatchNavigation({ family: "navigation", type: "selectItem", itemId: target });
    render();
  }
}

/** The Item Check counterpart to visibleGroupIds() (see that function's doc
 *  comment, near renderGroupStage) -- the currently displayed order after
 *  search/sort/filter, same list renderCandidateStage itself renders from.
 *  RX-02a (2026-07-29): while the By Category view is active, its two
 *  narrowing axes (categoryReviewState/categoryFilter) now apply here too,
 *  through the SAME pure helper renderCategoryCheckPanel renders from --
 *  previously this returned the un-narrowed list, so arrow keys inside
 *  Category Check traversed candidates the reviewer couldn't see. */
function visibleItemCheckIds(state: ReturnType<WorkspaceCommandDispatcher["getState"]>): string[] {
  const candidateIds = state.detection?.candidates.map((c) => c.id) ?? [];
  const listIds = queryItemCheck(buildCandidateQueryFacts(candidateIds, state), itemCheckQueryState).map((f) => f.candidate.id);
  if (itemCheckViewMode !== "category") return listIds;
  return narrowByCategoryView(buildCategoryViewFacts(listIds, state), { reviewState: categoryReviewState, categoryFilter });
}

/** "Jump to search result": moves focus straight to the FIRST candidate in
 *  the currently filtered Item Check list -- called from the search
 *  input's own Enter handler (see renderItemCheckToolbar). No-op on an
 *  empty result set. */
function jumpToFirstSearchResult(): void {
  const state = dispatcher.getState();
  if (state.focus?.target.stage !== "item-check") return;
  const candidateIds = state.detection?.candidates.map((c) => c.id) ?? [];
  const filtered = queryItemCheck(buildCandidateQueryFacts(candidateIds, state), itemCheckQueryState);
  if (filtered.length === 0) return;
  dispatcher.dispatchNavigation({ family: "navigation", type: "selectItem", itemId: filtered[0]!.candidate.id });
  render();
}

/**
 * "Next ambiguity" -- jumps to Ambiguity Check's OWN next-unresolved
 * candidate from anywhere in the workspace, composed from two existing
 * primitives (focusStage then moveItem/nextUnresolved) rather than a new
 * domain command -- Ambiguity Check has no Milestone 2 search/filter layer
 * (see itemCheckQuery.ts's scope note), so its FULL traversal list is
 * always what's visible, and the domain's own nextUnresolved is exactly
 * right here (unlike Item Check's filtered-list case above).
 */
function goToNextAmbiguity(): void {
  dispatcher.dispatchNavigation({ family: "navigation", type: "focusStage", stage: "ambiguity-check" });
  dispatcher.dispatchNavigation({ family: "navigation", type: "moveItem", direction: "nextUnresolved" });
  render();
}

/** "Jump to category": switches to Item Check's By Category view, pre-
 *  filtered to `category`, defaulting the review-state axis to "To Review"
 *  (the useful default for "let me work this category now" -- a reviewer
 *  jumping to a category almost always wants the undecided members, not
 *  the ones already resolved). */
function jumpToCategory(category: string): void {
  dispatcher.dispatchNavigation({ family: "navigation", type: "focusStage", stage: "item-check" });
  itemCheckViewMode = "category";
  categoryReviewState = "toReview";
  categoryFilter = category;
  render();
}

function renderCandidateStage(container: HTMLElement, state: ReturnType<WorkspaceCommandDispatcher["getState"]>, stage: "ambiguity-check" | "item-check"): void {
  let candidateIds =
    stage === "ambiguity-check"
      ? (state.grouping?.ambiguityProposals.map((p) => p.candidateId) ?? [])
      : (state.detection?.candidates.map((c) => c.id) ?? []);

  if (stage === "item-check") {
    renderItemCheckViewToggle(container);
    renderItemCheckToolbar(container);
    // Search + advanced filters narrow the pool BEFORE Category Check's own
    // state/category chips further narrow it -- Category Check remains a
    // view over "whatever Item Check would otherwise show" (Milestone 1's
    // own framing), now including Milestone 2's search/filter layer.
    const filteredFacts = queryItemCheck(buildCandidateQueryFacts(candidateIds, state), itemCheckQueryState);
    candidateIds = filteredFacts.map((f) => f.candidate.id);
    if (itemCheckViewMode === "category") {
      const filtered = renderCategoryCheckPanel(container, state, candidateIds);
      candidateIds = filtered;
    }
    renderBulkToolbar(container, candidateIds, state);
  }

  if (candidateIds.length === 0) {
    container.appendChild(el("p", {}, "Nothing to review in this stage."));
    return;
  }
  const list = el("div", { class: "item-list" });
  for (const candidateId of candidateIds) {
    const candidate = state.detection?.candidates.find((c) => c.id === candidateId);
    if (!candidate) continue;
    const decided = state.reviewSession?.candidateDecisions[candidateId];
    // RX-01 (2026-07-29): `data-item-id` is the stable DOM->item lookup
    // contract for candidate rows -- scrollFocusedRowIntoView() finds its
    // target by focus state through this attribute rather than by a
    // presentation class (`.item-row-focused`'s meaning has already drifted
    // once; a domain id cannot). Also the intended id->element mapping for
    // later row-geometry work, instead of each feature inventing its own.
    const row = el("div", { class: "item-row", "data-item-id": candidateId });
    // WORKSPACE INTERACTION REVISION: the expanded candidate IS the focused
    // one (see `acknowledgement`'s doc comment) -- no separate open/closed
    // state to track. RX-14 (2026-07-29): a pending acknowledgement no
    // longer holds the leaving row expanded -- it contributes ONLY the
    // pulse/badge treatment below, so exactly one row (the focused one)
    // is expanded and carries `.item-row-focused` at any moment, and the
    // view advances the instant a decision lands rather than after
    // ACKNOWLEDGEMENT_MS.
    const isAcknowledging = isAcknowledged({ kind: "candidate", stage, candidateId });
    const isExpanded = state.focus?.target.stage === stage && state.focus.target.itemId === candidateId;
    if (isExpanded) row.classList.add("item-row-focused");
    if (isAcknowledging) row.classList.add("item-row-acknowledged", "row-acknowledged-pulse");
    // Feature 002 introduced the "(Imported)" suffix for a decision whose
    // CURRENT source is still "imported". MILESTONE 3, Phase 4 ("Imported
    // Decision Visibility") extends this to the three states Andrew's
    // instruction names explicitly: reviewer-original (no suffix, unchanged
    // default), imported-and-still-unmodified ("(Imported)", unchanged),
    // and imported-then-since-overridden ("(Modified from import)", new) --
    // reusing AuditExporter.ts's own wasEverImported() event-log walk
    // rather than a second implementation of "was this ever imported."
    // Deliberately still an inline suffix, not a separate badge/column, per
    // "increase reviewer confidence without creating clutter."
    const provenance = decisionProvenance(state.reviewSession, candidateId, decided);
    const imported = provenance === "imported";
    // MILESTONE 2 -- multi-select checkbox, Item Check only (see
    // itemCheckQuery.ts's "SCOPE DECISION" note on why Ambiguity Check does
    // not get one). Purely ephemeral selection state; selecting a candidate
    // has no effect on any decision until a bulk action button is actually
    // clicked.
    if (stage === "item-check") {
      const checkbox = el("input", { type: "checkbox", class: "bulk-select-checkbox" }) as HTMLInputElement;
      checkbox.checked = selectedCandidateIds.has(candidateId);
      checkbox.addEventListener("click", (event) => event.stopPropagation());
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selectedCandidateIds.add(candidateId);
        else selectedCandidateIds.delete(candidateId);
        render();
      });
      row.appendChild(checkbox);
    }
    const label = el(
      "span",
      {},
      `${candidate.displayValue} (${candidate.detectedType})${decided ? ` -- ${decided.decision}${decisionProvenanceSuffix(provenance)}` : ""}`
    );
    if (imported && decided?.importEvidence) label.title = decided.importEvidence.description;
    else if (provenance === "imported-then-overridden") {
      label.title = "Originally reused from a prior review, then changed during this review.";
    }
    label.addEventListener("click", () => {
      // An explicit selection is the reviewer deliberately moving on --
      // don't let a still-ticking acknowledgement from a DIFFERENT
      // candidate hold its row open a moment longer than this new choice.
      if (acknowledgement) {
        window.clearTimeout(acknowledgement.timeoutHandle);
        acknowledgement = null;
      }
      dispatcher.dispatchNavigation({ family: "navigation", type: "selectItem", itemId: candidateId });
      render();
    });
    row.appendChild(label);
    if (isAcknowledging) row.appendChild(el("span", { class: "ack-badge" }, "✓ Saved"));
    if (state.quality) {
      // LIVE CONFIDENCE (2026-07-29, Group Check Python-parity revision,
      // extended to Item Check/Ambiguity Check per Andrew's own "extend to
      // Item Check/Ambiguity Check as well" instruction): a decided
      // candidate's badge jumps to 100% with a "was X%" note, using its own
      // already-computed analysis score as the prior -- see
      // candidateLiveConfidence's own doc comment for why this is the
      // simpler, flat-candidate counterpart to Group Check's blended
      // groupLiveConfidence rather than sharing that machinery.
      const analysisScore = state.quality.scoreByCandidate[candidateId];
      if (analysisScore !== undefined) {
        row.appendChild(renderConfidenceBadge(candidateLiveConfidence(analysisScore, Boolean(decided))));
      }
    }
    decisionButtons(candidateId, stage, row);
    list.appendChild(row);

    if (candidate && isExpanded) {
      const reviewOccurrences = state.classification
        ? groupReviewOccurrencesForCandidate(candidateId, state.classification.reviewOccurrences)
        : [];
      renderCandidateDetailPanel(list, candidate, state.quality, reviewOccurrences, decided?.decision, stage, state);
    }
  }
  container.appendChild(list);
}

/** Row-level CSS class per uniform decision -- muted background, one hue
 *  per outcome (see index.html's .group-row-* rules). Keyed by
 *  CandidateDecisionKind so it stays exhaustive if that union ever grows. */
const GROUP_ROW_DECISION_CLASS: Record<CandidateDecisionKind, string> = {
  Keep: "group-row-keep",
  Rename: "group-row-rename",
  Redact: "group-row-redact",
  Ignore: "group-row-ignore",
};

/** Which of the four bulk group buttons corresponds to a given uniform
 *  decision -- used to apply the "currently active" emphasis class to
 *  exactly one button, the same pattern candidate rows already use. */
const GROUP_ACTION_DECISION_CLASS: Record<CandidateDecisionKind, string> = GROUP_ROW_DECISION_CLASS;

/**
 * GROUP CHECK REVISION (2026-07-29): the currently-displayed group order --
 * i.e. groupCheckSortOrder applied to state.grouping's groups. This is the
 * SAME function both renderGroupStage (below) and the keyboard-navigation
 * interception (see moveWithinVisibleList's call site near the bottom of
 * this file) call, so "what's on screen" and "what arrow keys traverse"
 * can never independently drift -- the exact bug Andrew reported ("browsing
 * items using arrows seems to be jumping out of sequence"): FocusNavigator's
 * own itemIdsForStage("group-check", ...) is a fixed, sort-independent
 * order (stages.ts, by design -- FocusNavigator must never depend on
 * rendered/UI-only state), so once Group Check gained a sort control,
 * something in the UI layer had to redirect arrow-key movement through the
 * visible order instead, mirroring how goToAdjacentInVisibleList already
 * does this for Item Check's "]"/"[" shortcuts.
 */
function visibleGroupIds(state: ReturnType<WorkspaceCommandDispatcher["getState"]>): string[] {
  const groups = state.grouping?.entityGroupProposals ?? [];
  if (!state.reviewSession) return groups.map((g) => g.groupId);
  const facts = buildGroupQueryFacts(groups, state.reviewSession);
  return sortGroups(facts, groupCheckSortOrder).map((f) => f.group.groupId);
}

function renderGroupCheckToolbar(container: HTMLElement): void {
  const bar = el("div", { class: "group-check-toolbar" });
  bar.appendChild(el("label", { class: "group-sort-label" }, "Sort:"));
  const sortSelect = el("select", { class: "sort-select" });
  for (const order of GROUP_SORT_ORDERS) {
    const option = el("option", { value: order.key }, order.label);
    if (order.key === groupCheckSortOrder) option.setAttribute("selected", "selected");
    sortSelect.appendChild(option);
  }
  sortSelect.addEventListener("change", () => {
    groupCheckSortOrder = sortSelect.value as GroupSortOrder;
    render();
  });
  bar.appendChild(sortSelect);
  const layoutToggle = button(groupCheckLayout === "list" ? "2-column view" : "1-column view", () => {
    groupCheckLayout = groupCheckLayout === "list" ? "grid" : "list";
    render();
  });
  layoutToggle.classList.add("group-layout-toggle");
  bar.appendChild(layoutToggle);
  container.appendChild(bar);
}

/** Group Check's confidence badge -- live where possible (session +
 *  detection + quality all present, the ordinary case once a document is
 *  loaded), falling back to the group's static `originalProposalConfidence`
 *  otherwise (matches this row's behavior before the Python-parity
 *  revision, so an edge case with incomplete state degrades to the OLD
 *  correct behavior rather than a crash or a fabricated number). */
function groupRowConfidence(
  group: EntityGroupProposal,
  state: ReturnType<WorkspaceCommandDispatcher["getState"]>,
  selectedCandidateIds: readonly string[]
): LiveConfidence {
  if (state.reviewSession && state.detection && state.quality) {
    return groupLiveConfidence(group, state.detection, state.quality, state.reviewSession, selectedCandidateIds, resolutionEngine);
  }
  return { current: Math.round(group.originalProposalConfidence) };
}

function renderGroupStage(container: HTMLElement, state: ReturnType<WorkspaceCommandDispatcher["getState"]>): void {
  const groupsById = new Map((state.grouping?.entityGroupProposals ?? []).map((g) => [g.groupId, g]));
  if (groupsById.size === 0) {
    container.appendChild(el("p", {}, "No proposed entity groups."));
    return;
  }
  const notQuite = state.focus?.target.panel.kind === "not-quite" ? state.focus.target.panel : null;
  const session = state.reviewSession;

  renderGroupCheckToolbar(container);

  const list = el("div", { class: groupCheckLayout === "grid" ? "item-list group-list-grid" : "item-list" });
  for (const groupId of visibleGroupIds(state)) {
    const group = groupsById.get(groupId);
    if (!group) continue;
    const display: GroupDisplayDecision = session ? groupDisplayDecision(group, session) : { kind: "undecided" };
    const notQuiteOpenHere = notQuite?.groupId === group.groupId;
    // DEFAULT-EXPAND REVISION (2026-07-29): expansion now follows focus,
    // exactly like Item/Ambiguity Check's candidate rows (see
    // renderCandidateStage's isExpanded) -- see the removed
    // expandedGroupIds's doc comment, above groupUncheckedMemberIds, for the
    // full history of this reversal. RX-14 (2026-07-29): isAcknowledging no
    // longer holds the leaving row open -- it contributes only the
    // pulse/highlight treatment below (matching the candidate-stage rows),
    // so exactly one group row is expanded at any moment and the view
    // advances the instant a decision lands.
    const isAcknowledging = isAcknowledged({ kind: "group", groupId: group.groupId });
    const isFocused = state.focus?.target.stage === "group-check" && state.focus.target.itemId === group.groupId;
    const isExpanded = isFocused;
    // GROUP CHECK PYTHON-PARITY REVISION: the checked subset only matters
    // while Not Quite is closed for THIS group -- Not Quite's own per-member
    // granularity supersedes it entirely for that group (see
    // groupSelectedMemberIds's own doc comment on why "unchecked" defaults
    // to empty, i.e. everyone selected).
    const selectedIds = notQuiteOpenHere ? group.candidateIds : groupSelectedMemberIds(group);
    const allSelected = selectedIds.length === group.candidateIds.length;

    // RX-01: same stable row-lookup contract as candidate rows -- see
    // renderCandidateStage's `data-item-id` note.
    const row = el("div", { class: "item-row group-row", "data-item-id": group.groupId });
    if (display.kind === "uniform") row.classList.add(GROUP_ROW_DECISION_CLASS[display.decision]);
    if (display.kind === "needsAttention") row.classList.add("group-row-attention");
    if (isFocused) row.classList.add("item-row-focused");
    if (isAcknowledging) row.classList.add("item-row-acknowledged", "row-acknowledged-pulse");

    // DIRECTIONAL ROW NAVIGATION: the roving-focus grid for THIS group, only
    // ever wired up (attachRovingGridNav, below) when isExpanded -- see that
    // function's own doc comment for the full design. Declared here,
    // unconditionally, so the `!notQuite` blocks below can push into
    // rovingGridRow0 as they build each control without needing to
    // duplicate this array's creation in both places. `rovingGridRow0` is a
    // plain alias for `rovingGrid[0]` -- guaranteed to exist since it's
    // initialized right here -- so the rest of this function doesn't have
    // to keep re-asserting that against noUncheckedIndexedAccess.
    const rovingGrid: HTMLElement[][] = [[]];
    const rovingGridRow0 = rovingGrid[0]!;

    // Member-selection checkbox (tri-state) -- hidden under the exact same
    // condition the bulk action buttons already were (any Not Quite open
    // anywhere in this stage), since a checked subset has no meaning while
    // a group is being decided member-by-member instead.
    if (!notQuite) {
      const parentCheckbox = el("input", { type: "checkbox", class: "group-parent-checkbox" }) as HTMLInputElement;
      parentCheckbox.checked = allSelected;
      parentCheckbox.indeterminate = selectedIds.length > 0 && !allSelected;
      parentCheckbox.addEventListener("click", (event) => event.stopPropagation());
      parentCheckbox.addEventListener("change", () => setAllMembersChecked(group, parentCheckbox.checked));
      row.appendChild(parentCheckbox);
      rovingGridRow0.push(parentCheckbox);
    }

    const selectionNote = !notQuite && !allSelected && selectedIds.length > 0 ? ` — ${selectedIds.length} of ${group.candidateIds.length} selected` : "";
    const label = el("span", { class: "group-row-label" }, `${group.canonicalName} (${group.candidateIds.length})${selectionNote}`);
    label.addEventListener("click", () => {
      dispatcher.dispatchNavigation({ family: "navigation", type: "selectItem", itemId: group.groupId });
      render();
    });
    row.appendChild(label);

    // COMPACT LAYOUT (2026-07-29): once a group's outcome is uniform across
    // every member, that outcome IS the reviewed state -- there is no more
    // uncertainty left for a confidence score to communicate, so a
    // checkmark replaces it (mirrors Andrew's own working layout: "check if
    // used approved, which then knocks the score to 100% since it's
    // reviewed"). Anything not yet uniform still shows the group's LIVE
    // confidence (Python-parity revision) -- the checked subset's blended
    // score, with decided members already contributing 100%, "was X%" shown
    // only when that live figure differs from the original analysis.
    if (display.kind === "uniform" && !isExpanded) {
      row.appendChild(el("span", { class: "group-reviewed-check" }, "✓ Reviewed"));
    } else {
      row.appendChild(renderConfidenceBadge(groupRowConfidence(group, state, selectedIds.length > 0 ? selectedIds : group.candidateIds)));
      if (display.kind === "needsAttention") row.appendChild(el("span", { class: "badge badge-caution" }, "needs attention"));
    }

    if (!notQuite) {
      // Feature 001, relabeled in the v9 terminology revision, extended by
      // the Group Check Python-parity revision (2026-07-29) to act on the
      // CHECKED SUBSET instead of always every member: labels adapt
      // ("Rename" vs "Rename selected") the same way Python's
      // `groupActionLabels()` does, and Keep/Ignore still route through the
      // original confirmGroup/ignoreGroup commands when every member is
      // selected (preserving their EntityGroupDecision stamp exactly as
      // before) but fall through to bulkApplyDecision (Milestone 2) the
      // moment the selection narrows -- see that command's own "no group
      // decision stamped for an arbitrary selection" precedent, which is
      // exactly correct here too: a partial action isn't the group being
      // formally accepted as originally proposed. Rename/Redact now ALWAYS
      // open the inline editor (see InlineEditorTarget's "group-subset"
      // scope) rather than dispatching immediately, so the reviewer can
      // pick a spelling or type custom text -- confirmInlineEditor's own
      // branch decides whether that still collapses to the original
      // flattenGroup/redactGroup command (default text, everyone selected)
      // or needs bulkApplyDecision.
      const scopeSuffix = allSelected ? "" : " selected";
      const actions = el("div", { class: "group-row-actions" });
      const disabled = selectedIds.length === 0;
      const keepBtn = button(
        `Keep${scopeSuffix} as-is`,
        () => {
          if (allSelected) {
            decideGroupAndAdvance({ family: "review", type: "confirmGroup", groupId: group.groupId }, group.groupId);
          } else {
            decideGroupBulkAndRender({ family: "review", type: "bulkApplyDecision", candidateIds: selectedIds, decision: "Keep" }, group.groupId);
          }
        },
        disabled
      );
      const renameEditing = isEditingGroupSubset(group.groupId, "Rename");
      const renameBtn = button(
        `Change${scopeSuffix}`,
        () => openInlineEditor({ scope: "group-subset", groupId: group.groupId, candidateIds: selectedIds, allSelected, action: "Rename" }, group.canonicalName),
        disabled
      );
      renameBtn.classList.toggle("action-editing", renameEditing);
      const redactEditing = isEditingGroupSubset(group.groupId, "Redact");
      const redactBtn = button(
        `Redact${scopeSuffix}`,
        () => openInlineEditor({ scope: "group-subset", groupId: group.groupId, candidateIds: selectedIds, allSelected, action: "Redact" }),
        disabled
      );
      redactBtn.classList.toggle("action-editing", redactEditing);
      const ignoreBtn = button(
        `Ignore${scopeSuffix}`,
        () => {
          if (allSelected) {
            decideGroupAndAdvance({ family: "review", type: "ignoreGroup", groupId: group.groupId }, group.groupId);
          } else {
            decideGroupBulkAndRender({ family: "review", type: "bulkApplyDecision", candidateIds: selectedIds, decision: "Ignore" }, group.groupId);
          }
        },
        disabled
      );
      const byDecision: Record<CandidateDecisionKind, HTMLButtonElement> = { Keep: keepBtn, Rename: renameBtn, Redact: redactBtn, Ignore: ignoreBtn };
      if (display.kind === "uniform") byDecision[display.decision].classList.add("group-action-active", GROUP_ACTION_DECISION_CLASS[display.decision]);
      const fixThisBtn = button("Fix this", () => dispatchAndRender({ family: "review", type: "enterNotQuite", groupId: group.groupId }));
      actions.appendChild(keepBtn);
      actions.appendChild(renameBtn);
      actions.appendChild(redactBtn);
      actions.appendChild(ignoreBtn);
      actions.appendChild(fixThisBtn);
      row.appendChild(actions);
      rovingGridRow0.push(keepBtn, renameBtn, redactBtn, ignoreBtn, fixThisBtn);

      if (renameEditing) {
        const quickPicks = [
          ...new Set(
            selectedIds
              .map((id) => state.detection?.candidates.find((c) => c.id === id)?.displayValue)
              .filter((value): value is string => Boolean(value))
          ),
        ];
        renderInlineEditor(row, "Or enter another value", quickPicks);
      }
      if (redactEditing) renderInlineEditor(row, "Optional replacement text (blank = default placeholder)");
    }
    list.appendChild(row);

    // Member breakdown: Not Quite (fully granular, one member decided at a
    // time) always wins when open for this group -- unchanged from before.
    // Otherwise, the NEW explicit expand toggle reveals the same member
    // list with checkboxes and each member's own live confidence, without
    // entering Not Quite at all (Group Check Python-parity revision).
    if (notQuiteOpenHere) {
      const panel = el("div", { class: "not-quite-panel" });
      panel.appendChild(el("strong", {}, "Fix this -- members:"));
      for (const candidateId of group.candidateIds) {
        const candidate = state.detection?.candidates.find((c) => c.id === candidateId);
        const memberRow = el("div", { class: "item-row" });
        if (notQuite.activeMemberId === candidateId) memberRow.classList.add("item-row-focused");
        if (isAcknowledged({ kind: "not-quite-member", groupId: group.groupId, candidateId })) memberRow.classList.add("item-row-acknowledged", "row-acknowledged-pulse");
        memberRow.appendChild(el("span", {}, candidate ? `${candidate.displayValue} (${candidate.detectedType})` : candidateId));
        memberRow.appendChild(
          button("Keep", () => decideNotQuiteMemberAndRender({ family: "review", type: "applyNotQuiteMember", groupId: group.groupId, candidateId, action: "Keep" }, group.groupId, candidateId))
        );
        const memberRenameEditing = isEditingNotQuiteMember(group.groupId, candidateId, "Rename");
        const memberRenameBtn = button("Change", () => openInlineEditor({ scope: "not-quite-member", groupId: group.groupId, candidateId, action: "Rename" }));
        memberRenameBtn.classList.toggle("action-editing", memberRenameEditing);
        memberRow.appendChild(memberRenameBtn);
        const memberRedactEditing = isEditingNotQuiteMember(group.groupId, candidateId, "Redact");
        const memberRedactBtn = button("Redact", () => openInlineEditor({ scope: "not-quite-member", groupId: group.groupId, candidateId, action: "Redact" }));
        memberRedactBtn.classList.toggle("action-editing", memberRedactEditing);
        memberRow.appendChild(memberRedactBtn);
        memberRow.appendChild(
          button("Ignore", () => decideNotQuiteMemberAndRender({ family: "review", type: "applyNotQuiteMember", groupId: group.groupId, candidateId, action: "Ignore" }, group.groupId, candidateId))
        );
        panel.appendChild(memberRow);
        if (memberRenameEditing) renderInlineEditor(panel, "Replacement text (required)");
        if (memberRedactEditing) renderInlineEditor(panel, "Optional replacement text (blank = default placeholder)");
      }
      panel.appendChild(button("Done fixing", () => dispatchAndRender({ family: "review", type: "completeNotQuite", groupId: group.groupId })));
      panel.appendChild(button("Exit (Escape)", () => dispatchAndRender({ family: "review", type: "exitNotQuite", groupId: group.groupId })));
      list.appendChild(panel);
    } else if (isExpanded) {
      const unchecked = groupUncheckedMemberIds.get(group.groupId);
      const members = el("div", { class: "group-members" });
      for (const candidateId of group.candidateIds) {
        const candidate = state.detection?.candidates.find((c) => c.id === candidateId);
        const memberRow = el("div", { class: "member-row" });
        const checkbox = el("input", { type: "checkbox" }) as HTMLInputElement;
        checkbox.checked = !(unchecked?.has(candidateId) ?? false);
        checkbox.addEventListener("change", () => toggleMemberChecked(group, candidateId));
        memberRow.appendChild(checkbox);
        memberRow.appendChild(
          el("span", { class: "member-name" }, candidate ? `${candidate.displayValue} (${candidate.occurrenceIds.length})` : candidateId)
        );
        const memberLive =
          session && state.detection && state.quality
            ? memberLiveConfidence(group, candidateId, state.detection, state.quality, session, resolutionEngine)
            : { current: Math.round(group.memberConfidences[candidateId] ?? group.originalProposalConfidence) };
        memberRow.appendChild(renderConfidenceBadge(memberLive, "member-confidence"));
        members.appendChild(memberRow);
        rovingGrid.push([checkbox]);
      }
      list.appendChild(members);

      // DIRECTIONAL ROW NAVIGATION: wire up only for this one expanded
      // group (rovingGrid[0] is only non-empty when `!notQuite` built the
      // checkbox/action-button row above -- an empty row 0 means every
      // group's action row is hidden right now because SOME group's Not
      // Quite panel is open elsewhere, so there is nothing coherent to
      // navigate). Focus is restored to the remembered cell after this
      // from-scratch render only when no inline editor is open anywhere --
      // an open editor's own restore-focus call (renderInlineEditor, above)
      // takes priority, matching this row's own Rename/Redact buttons
      // opening that very editor inside this row.
      if (rovingGridRow0.length > 0) {
        attachRovingGridNav([row, members], rovingGrid, group.groupId);
        if (!inlineEditor) {
          const position = rovingGridPosition(rovingGrid, group.groupId);
          rovingGrid[position.row]?.[position.col]?.focus();
        }
      }
    }
  }
  container.appendChild(list);
}

const REPLACEMENT_STRATEGY_LABELS: Record<ReplacementStrategy, string> = {
  generic: "Generic placeholder",
  sequential: "Sequential numbering",
  custom: "Custom template",
};

/** Replaces one entity type's rule in the CURRENT config and dispatches
 *  the whole updated config -- setReplacementRuleConfig replaces the whole
 *  object (see Commands.ts's own doc comment on why), so every caller
 *  composes the full next config from dispatcher.getReplacementRuleConfig()
 *  rather than sending a partial update. */
async function applyReplacementRuleChange(detectedType: string, rule: TypeReplacementRule): Promise<void> {
  const config = dispatcher.getReplacementRuleConfig();
  const nextConfig: ReplacementRuleConfig = { ...config, [detectedType]: rule };
  await dispatcher.dispatchApplication({ family: "document", type: "setReplacementRuleConfig", config: nextConfig });
  render();
}

/**
 * MILESTONE 3, Phase 3 ("ReplacementRuleEngine"). Andrew framed this
 * milestone's Phase 3 as configuring OUTPUT behavior, so this panel lives
 * inside the Output stage rather than as a separate top-level tab -- a
 * reviewer configures redaction placeholders where they already are when
 * that decision becomes relevant (about to generate output), not earlier
 * as a setup step disconnected from the document it applies to. Only one
 * row per entity type actually PRESENT in this document (not every type
 * the pipeline could ever detect) -- an empty document shows no panel at
 * all, and a document with only emails/phones shows no "person" row,
 * matching this app's general "don't render dead controls" precedent
 * (Milestone 2's own "Organizations" filter design note).
 */
function renderRedactionRulesPanel(container: HTMLElement, state: ReturnType<WorkspaceCommandDispatcher["getState"]>): void {
  const candidates = state.detection?.candidates ?? [];
  const types = [...new Set(candidates.map((c) => c.detectedType))].sort();
  if (types.length === 0) return;
  const config = dispatcher.getReplacementRuleConfig();

  const panel = detailsEl("redaction-rules-panel", { class: "redaction-rules-panel" });
  panel.appendChild(el("summary", {}, "Redaction rules"));
  panel.appendChild(
    el("p", { class: "hint" }, "Choose how each entity type is replaced when redacted. A candidate's own explicit replacement text (from Rename, or a typed-in Redact override) always takes precedence over these rules.")
  );

  for (const type of types) {
    const rule: TypeReplacementRule = config[type] ?? { strategy: "generic" };
    const row = el("div", { class: "redaction-rule-row" });
    row.appendChild(el("span", { class: "redaction-rule-type" }, type));

    const select = el("select") as HTMLSelectElement;
    for (const strategy of Object.keys(REPLACEMENT_STRATEGY_LABELS) as ReplacementStrategy[]) {
      const option = el("option", { value: strategy }, REPLACEMENT_STRATEGY_LABELS[strategy]);
      if (strategy === rule.strategy) option.setAttribute("selected", "selected");
      select.appendChild(option);
    }

    const templateInput = el("input", { type: "text", placeholder: "e.g. [WITNESS {n}]" }) as HTMLInputElement;
    templateInput.value = rule.customTemplate ?? "";
    templateInput.style.display = rule.strategy === "custom" ? "" : "none";
    templateInput.title = "Optional {n} token numbers each candidate of this type sequentially (e.g. [WITNESS 001], [WITNESS 002]).";

    select.addEventListener("change", () => {
      const strategy = select.value as ReplacementStrategy;
      void applyReplacementRuleChange(type, strategy === "custom" ? { strategy, customTemplate: templateInput.value } : { strategy });
    });
    templateInput.addEventListener("change", () => {
      void applyReplacementRuleChange(type, { strategy: "custom", customTemplate: templateInput.value });
    });

    row.appendChild(select);
    row.appendChild(templateInput);
    panel.appendChild(row);
  }

  // Live preview -- ONLY candidates that would actually use engine-resolved
  // text right now (a Redact/Rename decision already made, with no
  // reviewer-typed replacement of their own -- see
  // ReplacementRuleEngine.computeReplacements()'s own precedence note).
  // Deliberately does not fabricate preview text for undecided candidates:
  // showing a placeholder for something that isn't actually going to be
  // redacted yet would misrepresent what generateOutput() will really do.
  const preview = dispatcher.previewReplacements(config);
  if (preview && preview.size > 0) {
    const previewSection = el("div", { class: "redaction-rules-preview" });
    previewSection.appendChild(el("div", { class: "detail-section-title" }, "Preview"));
    let shown = 0;
    for (const text of preview.values()) {
      if (shown >= 5) break;
      previewSection.appendChild(el("p", { class: "context-snippet" }, text));
      shown++;
    }
    panel.appendChild(previewSection);
  }

  container.appendChild(panel);
}

function renderOutputStage(container: HTMLElement, state: ReturnType<WorkspaceCommandDispatcher["getState"]>): void {
  renderRedactionRulesPanel(container, state);
  if (!state.readiness.reviewComplete) {
    container.appendChild(el("p", {}, `Review is not complete yet -- ${state.readiness.unresolvedItemCount} item(s) still unresolved in Item Check.`));
  } else {
    container.appendChild(
      button("Generate Output", async () => {
        const result = await dispatcher.dispatchApplication({ family: "document", type: "generateOutput" });
        if (!result.ok) window.alert(`Failed to generate output: ${result.reason}`);
        render();
      })
    );
    if (state.verification) {
      const report = el("div", { class: "verification-report" });
      report.appendChild(el("p", {}, `Verification: ${state.verification.passed ? "PASSED" : "FAILED"}`));
      report.appendChild(el("p", {}, `Warnings: ${state.readiness.verificationWarningCount}, Blockers: ${state.readiness.verificationBlockerCount}`));
      for (const finding of state.verification.fidelityFindings) {
        report.appendChild(el("p", {}, `[${finding.severity}] ${finding.category}: ${finding.description}`));
      }
      container.appendChild(report);
    }
    if (state.readiness.exportEnabled) {
      container.appendChild(button("Download Redacted Document", handleDownloadOutput));
    }
  }

  // Audit record: deliberately NOT gated on reviewComplete/exportEnabled --
  // see AuditRecord.ts's "Audit generation before successful verification"
  // section. It documents review state as of generation time (including
  // any unresolved items or a missing/failed verification), rather than
  // certifying a clean result.
  const auditSection = el("div", { class: "audit-section" });
  auditSection.appendChild(el("strong", {}, "Audit record"));
  auditSection.appendChild(
    el(
      "p",
      {},
      "Available regardless of review completeness or verification status -- records what the review looked like at generation time, including any unresolved items or verification gaps, rather than certifying a clean result."
    )
  );
  auditSection.appendChild(button("Generate Audit Record", handleGenerateAudit));
  const artifacts = dispatcher.getLastAuditArtifacts();
  if (artifacts) {
    const idPrefix = state.documentId?.slice(0, 12) ?? "document";
    auditSection.appendChild(
      button("Download Audit Report (JSON)", () => downloadText(`audit-report-${idPrefix}.json`, artifacts.auditReport, "application/json"))
    );
    auditSection.appendChild(
      button("Download Redaction Log (CSV)", () => downloadText(`audit-log-${idPrefix}.csv`, artifacts.csv, "text/csv"))
    );
    auditSection.appendChild(
      button("Download Decisions (JSON)", () => downloadText(`audit-decisions-${idPrefix}.json`, artifacts.decisionsJson, "application/json"))
    );
    auditSection.appendChild(
      button("Download QA Metrics (JSON)", () => downloadText(`audit-qa-metrics-${idPrefix}.json`, artifacts.qaMetricsJson, "application/json"))
    );
  }
  container.appendChild(auditSection);
}

/** Per-stage keyboard legend text -- a direct transcription of keymap.ts's
 *  own documented vocabulary (see that file's top doc comment and
 *  docs/architecture/review-workspace-reconstruction.md §1.5's keyboard
 *  table), not a new shortcut scheme. Kept as one small lookup here rather
 *  than duplicated logic, since keymap.ts's resolveKeyboardCommand() has no
 *  natural "describe yourself as text" form to call instead. This is now
 *  the FALLBACK/default text for a stage with no more specific context --
 *  see commandBarLegend() below, which is what actually decides what to
 *  show on any given render. */
const STAGE_SHORTCUT_LEGEND: Record<WorkflowStage, string> = {
  // WORKSPACE INTERACTION REVISION: "D/./Space Detail" removed from both
  // rows below -- there is no longer a detail panel toggle to bind a key
  // to (the focused candidate's panel is always showing; see
  // `acknowledgement`'s doc comment).
  "ambiguity-check": "K Keep · C Change · R Redact · I Ignore · ↑↓←→ Move · Tab Next item",
  "group-check": "K Keep as-is · C Change · R Redact · I Ignore · F Fix this · ↑↓←→ Move · Tab Next item",
  "item-check": "K Keep · C Change · R Redact · I Ignore · / Search · [ Prev decided · ] Next undecided · Tab Next item",
  qa: "No per-item keyboard model in this build.",
  output: "",
};

/**
 * DYNAMIC COMMAND BAR (2026-07-29): per Andrew's own screenshot reference
 * (Python's top command bar, whose text changes with focus -- "↑↓ Navigate
 * Rows · ↔ Row Controls · Space Close Group..." while a group is open,
 * different text otherwise) and his explicit complaint that per-button
 * "(k)"/"(n)"/"(r)"/"(i)"/"(q)" hints were redundant clutter once a
 * shortcut vocabulary is already stated once, prominently, in one place.
 * `STAGE_SHORTCUT_LEGEND` above was already that "one place," but it was
 * static per stage -- it kept describing Group Check's bulk K/N/R/I/Q
 * vocabulary even while a Not Quite panel was open and those letters meant
 * something completely different (or nothing), and kept describing
 * Item Check/Ambiguity Check's K/N/R/I even while an inline Rename/Redact
 * editor was open and every one of those letters was just being typed as
 * text. This function derives the ACTUALLY-CURRENT vocabulary fresh every
 * render from the same state renderCommandBar already reads -- "derive,
 * don't duplicate," the same shape this file already uses for
 * groupDisplayDecision and expansion-follows-focus (see
 * docscrub-web-conventions memory) -- rather than a second, independently-
 * maintained copy of "what does K do right now."
 */
function commandBarLegend(state: ReturnType<WorkspaceCommandDispatcher["getState"]>, activeStage: WorkflowStage): string {
  if (inlineEditor) {
    return inlineEditor.action === "Rename"
      ? "Enter Confirm replacement · Esc Cancel"
      : "Enter Confirm (blank = default placeholder) · Esc Cancel";
  }
  if (activeStage === "group-check") {
    const notQuiteOpen = state.focus?.target.panel.kind === "not-quite";
    return notQuiteOpen
      ? "K Keep member · C Change member · R Redact member · I Ignore member · ↑↓ Move member · Esc Exit Fix this"
      : STAGE_SHORTCUT_LEGEND["group-check"];
  }
  return STAGE_SHORTCUT_LEGEND[activeStage];
}

/**
 * MILESTONE 2 -- CommandBar, per the reconstruction doc's #1.2 component
 * table and Andrew's explicit "should always expose: available shortcuts,
 * current selection, contextual actions" instruction. Andrew's "always"
 * (not "only inside Group Check," Python's own narrower scope for
 * `#groupCommandBar`) is a deliberate, explicit generalization -- the same
 * kind of evolution already recorded for the stage-tab design in Milestone
 * 1 -- so this renders on every stage, not just Group Check.
 *
 * Contents, in order: (1) the current stage's shortcut legend -- always
 * present, satisfying "the reviewer should rarely need the mouse" by making
 * the vocabulary discoverable without a memorized cheat sheet; (2) current
 * selection + contextual bulk actions, ONLY meaningful in Item Check, so
 * rendered only there; (3) cross-stage quick-jump actions (Next undecided,
 * Previous decision, Next ambiguity, Jump to category), the Milestone 2
 * Workspace Navigation commands -- these are buttons, not dedicated
 * keyboard letters, beyond `[`/`]` for the two most-used ones (see
 * STAGE_SHORTCUT_LEGEND and the global keydown handler below): binding a
 * new mnemonic letter to each of "Next ambiguity"/"Jump to category" would
 * add more shortcuts to memorize than it saves, contradicting "reduce
 * cognitive load" for a pair of comparatively infrequent actions.
 */
function renderCommandBar(container: HTMLElement, state: ReturnType<WorkspaceCommandDispatcher["getState"]>, activeStage: WorkflowStage): void {
  const bar = el("div", { class: "command-bar" });

  const legend = commandBarLegend(state, activeStage);
  if (legend) bar.appendChild(el("span", { class: "command-bar-legend" }, legend));

  if (activeStage === "item-check") {
    if (selectedCandidateIds.size > 0) {
      bar.appendChild(el("span", { class: "command-bar-selection" }, `${selectedCandidateIds.size} selected`));
    }
    const candidateIds = state.detection?.candidates.map((c) => c.id) ?? [];
    const visible = queryItemCheck(buildCandidateQueryFacts(candidateIds, state), itemCheckQueryState).map((f) => f.candidate.id);
    bar.appendChild(button("Next undecided", () => goToAdjacentInVisibleList(visible, state, false, "forward")));
    bar.appendChild(button("Previous decision", () => goToAdjacentInVisibleList(visible, state, true, "backward")));
  }
  bar.appendChild(button("Next ambiguity", goToNextAmbiguity));

  if (activeStage === "item-check") {
    const categories = new Set<string>();
    for (const candidate of state.detection?.candidates ?? []) {
      for (const category of candidateCategories(candidate, state)) categories.add(category);
    }
    if (categories.size > 0) {
      const jumpLabel = el("label", {}, "Jump to category: ");
      const jumpSelect = el("select", { class: "jump-category-select" }) as HTMLSelectElement;
      jumpSelect.appendChild(el("option", { value: "" }, "—"));
      for (const category of [...categories].sort()) {
        jumpSelect.appendChild(el("option", { value: category }, categoryRuleLabel(category)));
      }
      jumpSelect.addEventListener("change", () => {
        if (jumpSelect.value) jumpToCategory(jumpSelect.value);
      });
      jumpLabel.appendChild(jumpSelect);
      bar.appendChild(jumpLabel);
    }
  }

  container.appendChild(bar);
}

/**
 * RX-01 (2026-07-29): after every full rebuild, bring the focused item's
 * row back into the viewport. Keyed off `state.focus.target.itemId` via the
 * rows' `data-item-id` attribute (the stable lookup contract added in the
 * same wave), NOT off `.item-row-focused` -- a presentation class is not an
 * identity contract, and this stays correct even if that class's styling
 * duties change again. `block: "nearest"` (with default instant behavior,
 * no `smooth`) is deliberate: a row already fully visible is left exactly
 * where it is -- no re-centering, no jump -- and an off-screen row is
 * brought to the nearest edge, which is the least-motion answer to "hold
 * Arrow Down past the viewport." With RX-13 excluded from this wave, this
 * named function is the application's PERMANENT scroll mechanism (not a
 * bridge to browser-native focus scrolling), which is why it is a single
 * named function with a single call site in render()'s tail rather than an
 * inline querySelector. Guards: the verify harness's fake DOM (see
 * verify/ui-smoke.ts) implements neither querySelector nor scrollIntoView,
 * and render()'s landing-page path returns before reaching this -- the
 * typeof checks keep this safe even if a future caller reaches it anyway,
 * following the established `app.ts` fake-DOM precedent (see the
 * APP_VERSION block at the bottom of this file).
 */
function scrollFocusedRowIntoView(container: HTMLElement, state: ReturnType<WorkspaceCommandDispatcher["getState"]>): void {
  const itemId = state.focus?.target.itemId;
  if (!itemId) return;
  if (typeof container.querySelector !== "function") return;
  const escaped = typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(itemId) : itemId.replace(/["\\]/g, "\\$&");
  const row = container.querySelector<HTMLElement>(`[data-item-id="${escaped}"]`);
  if (row && typeof row.scrollIntoView === "function") row.scrollIntoView({ block: "nearest" });
}

function render(): void {
  const state = dispatcher.getState();
  const container = root();
  container.innerHTML = "";

  const topBar = el("div", { class: "top-bar" });
  const fileInput = el("input", { type: "file", accept: ".docx" }) as HTMLInputElement;
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) void handleLoadFile(file);
  });
  topBar.appendChild(el("label", {}, "Load document: "));
  topBar.appendChild(fileInput);

  if (state.documentLoaded) {
    topBar.appendChild(
      button("← Documents", () => {
        showingLanding = true;
        render();
      })
    );
    topBar.appendChild(button("Save Session", handleSaveSession));

    const resumeLabel = el("span", {}, "  Resume session: session JSON ");
    const sessionInput = el("input", { type: "file", accept: ".json" }) as HTMLInputElement;
    const docxLabel = el("span", {}, " + original docx ");
    const docxInput = el("input", { type: "file", accept: ".docx" }) as HTMLInputElement;
    const resumeButton = button("Resume", () => {
      const sessionFile = sessionInput.files?.[0];
      const docxFile = docxInput.files?.[0];
      if (sessionFile && docxFile) void handleResumeSession(sessionFile, docxFile);
      else window.alert("Pick both the saved session JSON and the original .docx file.");
    });
    topBar.appendChild(resumeLabel);
    topBar.appendChild(sessionInput);
    topBar.appendChild(docxLabel);
    topBar.appendChild(docxInput);
    topBar.appendChild(resumeButton);

    // Feature 002: import a previously exported decisions.json (from an
    // earlier review of an earlier version of this document, or any
    // document -- matching is deterministic and simply finds nothing to
    // reuse if the candidates don't correspond). Kept to a single label +
    // file input, no extra dialog, per "do not overwhelm the interface."
    const importLabel = el("span", {}, "  Import prior decisions: ");
    const importInput = el("input", { type: "file", accept: ".json", title: "A decisions.json file previously downloaded via Download Decisions (JSON)" }) as HTMLInputElement;
    importInput.addEventListener("change", () => {
      const file = importInput.files?.[0];
      if (file) void handleImportDecisions(file);
      importInput.value = "";
    });
    topBar.appendChild(importLabel);
    topBar.appendChild(importInput);
  }
  container.appendChild(topBar);

  if (!state.documentLoaded || showingLanding) {
    container.appendChild(el("p", {}, state.documentLoaded ? "Pick a document or resume a recent one." : "No document loaded yet."));
    renderRecentDocuments(container);
    return;
  }

  container.appendChild(el("p", {}, `File: ${state.fileName}`));
  renderPersistenceStatus(container, state);
  renderImportSummaryBanner(container);
  renderReviewStatistics(container, state);
  if (state.processingWarnings.length > 0) {
    const warnings = el("div", { class: "warnings" });
    warnings.appendChild(el("strong", {}, "Processing warnings:"));
    for (const warning of state.processingWarnings) warnings.appendChild(el("p", {}, warning));
    container.appendChild(warnings);
  }

  const activeStage = state.focus?.target.stage ?? "ambiguity-check";
  renderStageTabs(container, activeStage, state.stageStatuses);

  // DYNAMIC COMMAND BAR (2026-07-29): moved above the stage body, matching
  // Andrew's own screenshot reference (Python's equivalent bar sits at the
  // top, always visible without scrolling past the candidate/group list
  // first) -- previously rendered after the body, at the very bottom.
  renderCommandBar(container, state, activeStage);

  const body = el("div", { class: "stage-body" });
  if (activeStage === "ambiguity-check" || activeStage === "item-check") {
    renderCandidateStage(body, state, activeStage);
  } else if (activeStage === "group-check") {
    renderGroupStage(body, state);
  } else if (activeStage === "qa") {
    body.appendChild(el("p", {}, "No interactive QA model in this build -- see phase-9-findings.md ('qa'/'output' have no per-item traversal)."));
  } else {
    renderOutputStage(body, state);
  }
  container.appendChild(body);

  // RX-01: keep the focused row visible after every rebuild. Deliberately
  // BEFORE the searchInputFocusPending/inlineEditor focus restorations
  // below, not after -- input.focus() performs its own scroll, and whoever
  // focuses last must win: a reviewer mid-keystroke in the search box (or
  // mid-edit in an inline editor) must never have their text-entry control
  // pushed back out of view by the row scroll.
  scrollFocusedRowIntoView(container, state);

  // MILESTONE 2 -- restore focus/cursor position to the just-rebuilt search
  // <input> if it had focus before this render() call (see
  // searchInputFocusPending's own doc comment for why this is necessary
  // given this file's "rebuild everything from scratch" render model).
  if (searchInputFocusPending) {
    const pending = searchInputFocusPending;
    searchInputFocusPending = null;
    const input = container.querySelector<HTMLInputElement>(".item-check-search-input");
    if (input) {
      input.focus();
      input.setSelectionRange(pending.start, pending.end);
    }
  }

  // INLINE EDITOR REVISION -- focus the freshly rebuilt editor's primary
  // control so opening it (or an incidental re-render, e.g. background
  // autosave, while it's open) never leaves the reviewer having to click
  // into it manually. When the free-text input is showing, that's the
  // input, same as before. When quick-pick chips are showing instead
  // (2026-07-29 chip revision), focus goes to the CURRENT chip -- the one
  // matching draftText, or "Something else" if none matches -- so a
  // reviewer who just opened the editor can hit Enter immediately to
  // accept the pre-filled default and advance, without an extra Tab first.
  // See renderInlineEditor's own doc comment for why this deliberately
  // doesn't try to preserve an exact mid-edit cursor position the way the
  // search input above does.
  if (inlineEditor) {
    const input = container.querySelector<HTMLInputElement>(".inline-editor-input");
    if (input) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    } else {
      const currentChip = container.querySelector<HTMLButtonElement>(".inline-editor-quick-pick-current");
      const firstChip = container.querySelector<HTMLButtonElement>(".inline-editor-quick-pick");
      (currentChip ?? firstChip)?.focus();
    }
  }
}

/**
 * MILESTONE 2 Workspace Navigation shortcuts -- "/" focuses Item Check's
 * search box (matching the reconstruction doc's §1.5 keyboard table, which
 * already documented this exact binding as Python-intentional, just never
 * implemented before this milestone); "]"/"[" are Next-undecided/Previous-
 * decision over the CURRENTLY VISIBLE filtered list (see
 * goToAdjacentInVisibleList's own doc comment for why these are new,
 * UI-composed bindings rather than a direct dispatch of the domain's
 * moveItem command). Only takes over when
 * dispatcher.resolveKeyboardCommand() has no domain-level meaning for the
 * key (checked first, below), so it can never shadow a real
 * review/navigation command. (The D/./Space detail-toggle shortcut that
 * used to sit alongside this one is REMOVED -- see `acknowledgement`'s doc
 * comment: there is no longer an independent detail-panel-open state for
 * a key to toggle.)
 */
function handleScaleNavigationKey(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
  const state = dispatcher.getState();
  if (state.focus?.target.stage !== "item-check") return false;
  if (event.key === "/") {
    const input = document.querySelector<HTMLInputElement>(".item-check-search-input");
    if (!input) return false;
    input.focus();
    input.select();
    return true;
  }
  const candidateIds = state.detection?.candidates.map((c) => c.id) ?? [];
  const visible = queryItemCheck(buildCandidateQueryFacts(candidateIds, state), itemCheckQueryState).map((f) => f.candidate.id);
  if (event.key === "]") {
    goToAdjacentInVisibleList(visible, state, false, "forward");
    return true;
  }
  if (event.key === "[") {
    goToAdjacentInVisibleList(visible, state, true, "backward");
    return true;
  }
  return false;
}

/**
 * INLINE EDITOR REVISION -- UI-level fallback for the "c" (Change, formerly
 * "n"/Rename -- see keymap.ts's top doc comment) and "r" (Redact) keys in
 * exactly the contexts keymap.ts's resolveKeyboardCommand() deliberately
 * resolves to null for: a focused candidate in Item Check/Ambiguity Check,
 * an active member inside an open Not Quite panel, and (2026-07-29,
 * interaction model revision) a focused group in Group Check with no Not
 * Quite panel open -- Rename/Redact need reviewer-typed text a bare keydown
 * can't supply, so the keymap intentionally leaves "which editor to open"
 * to a UI layer. Before this function existed, that UI layer was never
 * built -- window.prompt() was reachable only by clicking the Rename/Redact
 * buttons with a mouse, so pressing "n" or "r" via keyboard in the first
 * two contexts produced no error and no effect at all. That is very likely
 * the real explanation behind "the action buttons appear to not work" (see
 * the investigation note on this file's own findings doc): K and I (and
 * every mouse click) already worked; N and R, specifically via keyboard,
 * specifically in those two contexts, did not -- a genuine, disclosed gap,
 * not a caching artifact. Mirrors handleScaleNavigationKey's own shape
 * (called from the same fallback chain, only after resolveKeyboardCommand
 * has confirmed the key has no direct domain meaning) so it can never
 * shadow a real review/navigation command.
 *
 * The Group Check branch (new) mirrors exactly what the row's own Change/
 * Redact buttons do -- same `groupSelectedMemberIds`/`allSelected`
 * computation, same "group-subset" scope, same canonical-name prefill for
 * Change -- closing the pre-existing inconsistency where Group Check's
 * keyboard path used to bypass the editor via a direct flattenGroup/
 * redactGroup dispatch while the buttons never did.
 */
function handleInlineEditorOpenKey(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
  const key = event.key.toLowerCase();
  if (key !== "c" && key !== "r") return false;
  const action = key === "c" ? "Rename" : "Redact";
  const target = dispatcher.getState().focus?.target;
  if (!target) return false;
  if (target.panel.kind === "not-quite" && target.panel.activeMemberId) {
    openInlineEditor({ scope: "not-quite-member", groupId: target.panel.groupId, candidateId: target.panel.activeMemberId, action });
    return true;
  }
  if ((target.stage === "ambiguity-check" || target.stage === "item-check") && target.itemId) {
    openInlineEditor({ scope: "candidate", stage: target.stage, candidateId: target.itemId, action });
    return true;
  }
  if (target.stage === "group-check" && target.panel.kind === "none" && target.itemId) {
    const group = dispatcher.getState().grouping?.entityGroupProposals.find((g) => g.groupId === target.itemId);
    if (!group) return false;
    const selectedIds = groupSelectedMemberIds(group);
    const allSelected = selectedIds.length === group.candidateIds.length;
    openInlineEditor(
      { scope: "group-subset", groupId: group.groupId, candidateIds: selectedIds, allSelected, action },
      action === "Rename" ? group.canonicalName : ""
    );
    return true;
  }
  return false;
}

/**
 * DIRECTIONAL ROW NAVIGATION, gate half (2026-07-29): keymap.ts's ported
 * shouldIgnoreKeyboardEvent() blanket-blocks every keydown while ANY
 * button/input/select/textarea has real DOM focus -- correct for the rest
 * of this app (a Save/Load button shouldn't eat "k"), but wrong now that
 * attachRovingGridNav gives Group Check's own checkbox/action-button row
 * real DOM focus on purpose. Without this, K/C/R/I/F and Tab would all go
 * silently dead the moment a reviewer arrow-keyed onto one of those
 * controls -- exactly the "buttons keep working, keyboard doesn't" trap
 * this file's own handleInlineEditorOpenKey doc comment already diagnosed
 * once before. Deliberately NOT a change to shouldIgnoreKeyboardEvent
 * itself (see keymap.ts's own top doc comment on keeping that a faithful,
 * DOM-free port) -- this is a UI-layer exception checked ALONGSIDE it.
 *
 * Scoped narrowly: only a checkbox or button that is (a) inside a
 * `.group-row`/`.member-row` -- i.e. one of attachRovingGridNav's own
 * tracked elements, never anything else in the app -- and (b) NOT inside
 * an open `.inline-editor` (its own chips are also plain `<button>`s
 * sitting inside `row`, and must stay fully gated so a stray "k" while
 * picking a quick-pick spelling can never fire Keep behind the reviewer's
 * back).
 */
function isRovingFocusElement(el: HTMLElement | null): boolean {
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag !== "button" && tag !== "input") return false;
  if (el.closest(".inline-editor")) return false;
  return !!el.closest(".group-row, .member-row");
}

document.addEventListener("keydown", (event) => {
  const activeEl = document.activeElement as HTMLElement | null;
  const activeTag = activeEl?.tagName ?? "";
  if (shouldIgnoreKeyboardEvent(activeTag) && !isRovingFocusElement(activeEl)) return;
  const command = dispatcher.resolveKeyboardCommand({
    key: event.key,
    meta: event.metaKey,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
  });
  if (command) {
    event.preventDefault();
    // NAV-ORDER FIX: moveItem (every arrow key + Home/End) normally goes
    // straight to dispatchAndRender, which sends it to FocusNavigator's
    // structural, sort-independent order. For the two stages with a
    // currently-displayed order that can diverge from that (Item Check's
    // search/sort/filter, Group Check's new sort), redirect through
    // moveWithinVisibleList instead -- see that function's doc comment.
    // Ambiguity Check has no such layer (its full traversal list IS the
    // visible list, per goToAdjacentInVisibleList's own doc comment), so it
    // is deliberately left going through the unmodified path below.
    if (command.family === "navigation" && command.type === "moveItem" && isSequentialDirection(command.direction)) {
      const state = dispatcher.getState();
      const stage = state.focus?.target.stage;
      if (stage === "item-check" || stage === "group-check") {
        const visibleIds = stage === "item-check" ? visibleItemCheckIds(state) : visibleGroupIds(state);
        moveWithinVisibleList(visibleIds, state.focus?.target.itemId ?? null, command.direction);
        return;
      }
    }
    dispatchAndRender(command);
    return;
  }
  if (handleScaleNavigationKey(event)) {
    event.preventDefault();
    return;
  }
  if (handleInlineEditorOpenKey(event)) {
    event.preventDefault();
  }
});

// MILESTONE 3, Phase 1/2: populate the Recent Documents cache before the
// first render so a returning reviewer sees their resumable documents
// immediately, not after a flash of an empty landing page.
void refreshRecentSessions().then(render);

// App header version label (2026-07-29): set once, outside render() -- it
// never changes at runtime, so it doesn't belong in the full-rebuild render
// cycle every other piece of dynamic UI goes through. index.html owns the
// static .app-version <span>; this is the one place that reads
// APP_VERSION, so the label can never drift from src/ui/version.ts's own
// value. Guarded on `document.querySelector` existing: verify/ui-smoke.ts's
// module-eval-safety check runs this file against a minimal fake DOM
// (Node, no real browser) that doesn't implement it -- found by that exact
// check, same as the Recent-Documents-promise fix documented above. Every
// top-level statement in this file must survive that fake DOM, not just
// the ones already gating the first render.
if (typeof document.querySelector === "function") {
  const versionLabel = document.querySelector<HTMLElement>(".app-version");
  if (versionLabel) versionLabel.textContent = APP_VERSION;
}
