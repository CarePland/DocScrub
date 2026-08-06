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
 * - originally used native browser dialogs (window.prompt() for Rename/
 *   Redact text entry, blocking alerts for errors); both are gone -- the
 *   inline editor revision (2026-07-29) replaced prompt(), and RX-09
 *   (Wave 2, 2026-07-29) replaced every blocking alert with the
 *   non-blocking status region / toast / inline-banner channels (see
 *   NOTIFICATION CHANNELS below);
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
import { isItemResolved, reviewableItemIdsForStage } from "../engines/navigation/stages.js";
// PHASE 2 (2026-08-02): the conditional-workflow membership rule -- the
// ONE derivation stage tabs, ⇧←/→ traversal, and the navigator all share.
import { isStageActive } from "../engines/navigation/workflow.js";
import type { WorkflowStage } from "../domain/FocusState.js";
import { SEMANTIC_TYPE_LABELS, buildSemanticTypeSummaries, type SemanticTypeId, type SemanticTypeSummary } from "../domain/semanticTypes.js";
import type { AnyCommand, ReviewCommand, ReviewTransactionResult } from "../domain/Commands.js";
import { advanceWithinVisibleList } from "./visibleListAdvance.js";
import { DeterministicExplanationEngine } from "../engines/ExplanationEngine.js";
// `confidenceOpener` joins the import (2026-08-04) so the panel's verdict
// line is the ENGINE'S sentence opener, not a UI paraphrase of it -- the
// words a reviewer reads come from the same function the audit narrative's
// do, and a future change to the bands lands on both at once.
import { buildExplanationContext, confidenceOpener } from "../engines/explanation/explanation-builder.js";
import { groupReviewOccurrencesForCandidate, type OccurrenceGroup } from "../engines/OccurrenceClassifier.js";
import type { Candidate } from "../domain/DocumentModel.js";
import type { CandidateQualityAssessment, ExpertExplanation, ExplanationEvidenceText, QualityResult, Recommendation, StandardExplanation } from "../domain/Evidence.js";
import { categoryRuleLabel } from "../engines/quality/category-rule-labels.data.js";
import {
  FILTER_PRESETS,
  SORT_ORDERS,
  createDefaultQueryState,
  queryItemCheck,
  queryRequestsDecidedItems,
  type CandidateQueryFacts,
  type FilterPreset,
  type ItemCheckQueryState,
} from "./itemCheckQuery.js";
import { GROUP_SORT_ORDERS, buildGroupQueryFacts, sortGroups, type GroupSortOrder } from "./groupCheckQuery.js";
import type { RelationshipKind } from "../domain/StructuralRelationship.js";
import { preferredActionsForRelationship, type PreferredActionOp, type PreferredActionRole } from "./preferredActions.js";
import { openWorkspaceMetricsWindow, syncWorkspaceMetricsWindow } from "./metricsWindow.js";
import type { RelationshipProposal } from "../domain/StructuralRelationship.js";
import {
  deriveRecommendation,
  deriveReviewTier,
  identityDigitAssignments,
  isNonNameAnchorEvidence,
  type RecommendationFacts,
  type ReviewRecommendation,
  type SuggestionOp,
} from "./recommendations.js";
import {
  AMBIGUITY_SECTION_EXPLANATIONS,
  AMBIGUITY_TIER_ACTIONS,
  TRIAGE_SECTION_ACCEPT_DEFAULT,
  TRIAGE_SECTION_EXPLANATIONS,
  ambiguityQueueOrder,
  buildAmbiguitySections,
  buildTriageSections,
  itemDigitCeilingBeside,
  sectionActionDigitAssignments,
  sectionActionChord,
  type GroupScopeChord,
  structuralCardDisplayOrder,
  triageQueueOrder,
  type AcceptAllConfig,
  type AliasFlavor,
  type AmbiguityQueueItem,
  type AmbiguitySectionId,
  type ReviewTierId,
  type SectionAction,
  type TriageQueueItem,
  type TriageSectionId,
} from "./triageQueue.js";
import { personGroupKey as resolutionPersonGroupKey, personTokens as resolutionPersonTokens } from "../engines/entity-resolution/resolution.js";
// REVIEW SCOPE, Pass 1 (AG, 2026-08-03): the scope model + resolver. See
// reviewScope.ts's top doc comment for the model and the single-consumer
// invariant; `currentReviewScope` below is the ONE assembler.
import { resolveReviewScope, scopeDescriptor, type ReviewScope } from "./reviewScope.js";
import {
  CATEGORY_CONTEXT_FILTERS,
  matchesContextFilter,
  narrowByCategoryView,
  type CandidateReviewStatus,
  type CategoryContextFilter,
  type CategoryReviewState,
  type CategoryViewFacts,
} from "./itemCheckCategoryView.js";
import { groupDisplayDecision, groupLiveConfidence, memberLiveConfidence, candidateLiveConfidence, type GroupDisplayDecision, type LiveConfidence } from "../engines/review/coverage.js";
import type { CandidateDecision, CandidateDecisionKind, ReviewSession } from "../domain/ReviewSession.js";
import type { SessionSummary } from "../io/LocalSessionRepository.js";
// REOPEN PROMPT (AG, 2026-08-03): document identity without parsing, so
// "have I seen this file before?" is answerable before paying for an
// extraction. Same derivation OoxmlDocumentParser uses, by construction.
import { documentIdForFile } from "../io/DocumentParser.js";
import type { ReplacementRuleConfig, ReplacementStrategy, TypeReplacementRule } from "../domain/ReplacementRule.js";
// REDACTION RULES, PYTHON LAYOUT (AG, 2026-08-01): the engine's own
// default placeholder text, surfaced in the panel's always-visible
// Replacement Text inputs (see renderRedactionRulesPanel).
import { DeterministicReplacementRuleEngine, genericPlaceholder } from "../engines/ReplacementRuleEngine.js";
import { decisionProvenance, decisionProvenanceSuffix } from "./decisionProvenance.js";
import { computeDocumentScores, explainScoreChange, formatScoreChange, type DocumentScoreReport, type ScoreChange } from "./documentScores.js";
import { partitionCandidatesByResolution } from "../engines/review/coverage.js";
import { decisionTrackerFigures, explainTimeSaved } from "../metrics/decisionTracker.js";
import {
  decisionReduction,
  formatFewerDecisionsPercent,
  formatReductionEquation,
  mergedUnit,
  shouldDisplayReduction,
  REDUCTION_DESCRIPTION,
  type ReviewUnit,
} from "../metrics/decisionReduction.js";
import {
  DECISION_DISPLAY_LABEL,
  DECISION_PILL_LETTER,
  decisionActionLabel,
  decisionBulkLabel,
  decisionClass,
  decisionDisplayLabel,
  decisionSummaryDescription,
} from "./decisionLabels.js";
// UNIFIED DECISION COLOR SYSTEM (AG, 2026-08-03): the one precedence order
// (Redact > Change > Keep > Ignore) and the pure summary derivation behind
// every card tint and pill row in this file. See DecisionPrecedence.ts.
import { decisionSummary, UNDECIDED_SUMMARY, type DecisionSummary } from "../domain/DecisionPrecedence.js";
// APPLICATION FRAME REFINEMENT (AG, 2026-08-01): pure truncation policy
// for the header's document identity display (see documentDisplay.ts's
// doc comment for the "open documents = working set" interpretation).
import { documentDisplaySummary } from "./documentDisplay.js";
import { APP_VERSION } from "./version.js";
import { RegexEntityResolutionEngine, type EntityGroupProposal } from "../engines/EntityResolutionEngine.js";
// WORKSPACE ANALYSIS (2026-08-02): the ONE narrow entry point into the
// standalone Workspace Analysis subsystem (src/workspace-analysis/). This
// is deliberately the only place app.ts touches that subsystem -- no
// other file here imports from src/workspace-analysis/, and nothing in
// src/workspace-analysis/ imports back from app.ts (see that subsystem's
// own doc comments, and docs/architecture/decisions/ADR-019). It was
// built, tested, and made green entirely independently before this line
// was ever written, per Andrew's explicit sequencing instruction.
import { WorkspaceAnalysisSession } from "../workspace-analysis/state/WorkspaceAnalysisSession.js";
import { renderWorkspaceAnalysisPage } from "../workspace-analysis/ui/renderWorkspaceAnalysisPage.js";

// MILESTONE 3, Phase 1: onPersistenceChange re-renders whenever a
// background autosave finishes (success or failure) -- FOUND DURING BROWSER
// VALIDATION: without this, the persistence-status line's underlying value
// was always correct, but the DOM never refreshed to show it changing,
// since autosave is deliberately fire-and-forget and nothing else in this
// file re-renders on its own. `render` is referenced here before its own
// declaration further down -- safe, since `function render()` is hoisted.
const workspace = new ReviewWorkspace({ onPersistenceChange: () => render() });
const dispatcher = new WorkspaceCommandDispatcher(workspace);

// WORKSPACE ANALYSIS (2026-08-02): its own independent state container,
// constructed with no reference to `workspace`/`dispatcher` above and no
// way to acquire one -- WorkspaceAnalysisSession's constructor takes only
// an optional engine override. Analyzing a batch of imported documents
// never creates, touches, or requires a ReviewWorkspace/ReviewSession to
// exist, by construction, not just by convention.
const workspaceAnalysisSession = new WorkspaceAnalysisSession();

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
 * NOTIFICATION CHANNELS (RX-18 + RX-09, Reviewer Experience Wave 2,
 * 2026-07-29). Three kinds of reviewer-facing message, three channels --
 * sorting a message into the right bucket is the design decision; the
 * mechanics below are deliberately small:
 *
 *   - REFUSALS (`refuse()`): the app declining and explaining why ("No
 *     document loaded -- nothing to save."). Not failures. Status region
 *     only -- no toast, no banner, nothing to dismiss.
 *   - RECOVERABLE FAILURES (`notifyToast()`): something didn't work but
 *     the reviewer's next action is simply to carry on or retry (a failed
 *     bulk action, an unreadable save file). Transient toast
 *     (~TOAST_VISIBLE_MS with a fade) + a status-region write that
 *     PERSISTS after the toast fades, so the message is never lost to a
 *     blink.
 *   - FAILURES REQUIRING ACTION (`showFailureBanner()`): the reviewer
 *     cannot proceed with what they were doing until they react (output
 *     generation failed, document load failed). Persistent dismissible
 *     inline banner (rendered by render() from `failureBanner` state --
 *     state-driven, so it survives incidental re-renders by construction,
 *     unlike direct DOM writes) + status region + console.
 *
 * `setStatus()` is RX-18's single writer: latest message only, not a log.
 * The `.status-region` / `.toast-host` elements live in STATIC index.html
 * markup outside #app (render() clears #app.innerHTML on every state
 * change, including background-autosave renders -- a message inside it
 * would vanish non-deterministically; and the most probable first error of
 * a session, a load/resume failure, fires from the landing view where no
 * workspace chrome exists at all). render() never creates, clears, or
 * writes these nodes, and none of these functions ever calls render() --
 * the one-render-per-user-action invariant holds. `.app-version`'s
 * fake-DOM guard pattern applies (verify/ui-smoke.ts's document has no
 * querySelector).
 *
 * Every site converted from a native blocking alert keeps a console record
 * (refusals at info, failures at error) -- notifications are transient;
 * the console trail is not.
 */
function setStatus(text: string): void {
  if (typeof document.querySelector !== "function") return;
  const region = document.querySelector<HTMLElement>(".status-region");
  if (region) region.textContent = text;
}

function refuse(text: string): void {
  console.info(text);
  setStatus(text);
}

/** ~1.3s inside the plan's "visible for at least the toast duration"
 *  requirement; the CSS fade (index.html) runs on top of this. */
const TOAST_VISIBLE_MS = 1300;
let toastTimeoutHandle: ReturnType<typeof window.setTimeout> | null = null;

function notifyToast(text: string): void {
  console.error(text);
  setStatus(text);
  if (typeof document.querySelector !== "function") return;
  const host = document.querySelector<HTMLElement>(".toast-host");
  if (!host) return;
  host.textContent = text;
  host.classList.add("toast-visible");
  // Cancel-then-restart, same discipline as `acknowledge()` above -- two
  // failures in quick succession restart the window rather than racing
  // two timers to hide each other's message.
  if (toastTimeoutHandle !== null) window.clearTimeout(toastTimeoutHandle);
  toastTimeoutHandle = window.setTimeout(() => {
    host.classList.remove("toast-visible");
    toastTimeoutHandle = null;
  }, TOAST_VISIBLE_MS);
}

let failureBanner: { title: string; detail: string } | null = null;

function showFailureBanner(title: string, detail: string): void {
  console.error(`${title}: ${detail}`);
  failureBanner = { title, detail };
  setStatus(`${title}: ${detail}`);
  // No render() here -- every call site already renders once at the end of
  // its own action, per this file's standing invariant.
}

/** Rendered by render() on BOTH branches -- in normal flow on the landing
 *  view (where load/resume failures actually fire) and as the first child
 *  of the sticky chrome on the workspace view (so it cannot be scrolled
 *  out of sight while unaddressed). Reuses the `.warnings` box treatment
 *  (the import banner precedent: non-modal inline content, not a dialog)
 *  plus an explicit Dismiss, the one notification in this file that asks
 *  for an acknowledgement -- these are the failures the reviewer must
 *  react to. */
function renderFailureBanner(container: HTMLElement): void {
  if (!failureBanner) return;
  const banner = el("div", { class: "warnings failure-banner" });
  banner.appendChild(el("strong", {}, failureBanner.title));
  banner.appendChild(el("p", {}, failureBanner.detail));
  banner.appendChild(
    button("Dismiss", () => {
      failureBanner = null;
      render();
    })
  );
  container.appendChild(banner);
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
  | { scope: "group-subset"; groupId: string; candidateIds: string[]; allSelected: boolean; action: "Rename" | "Redact" }
  // SPLIT REVIEW MODE (AG, 2026-08-02): a member's Change/Redact text
  // entry INSIDE an active split session -- confirm records into the
  // split buffer (recordSplitChoice), never dispatches directly.
  | { scope: "split-member"; groupId: string; candidateId: string; action: "Rename" | "Redact" }
  /** Structural Relationship Review (2026-07-30): Change/Redact
   *  All/Selected on a relationship proposal -- confirms through
   *  bulkApplyDecision over the proposal's (selected) members, exactly like
   *  the bulk scope, but anchored on the proposal so the pending preview
   *  and acknowledgement land on the proposal card. */
  | { scope: "relationship"; proposalId: string; candidateIds: string[]; action: "Rename" | "Redact" }
  /** PHASE 2, TYPE CHECK (2026-08-02): type-level "Change/Redact
   *  remaining" -- one shared replacement over the type's still-unresolved
   *  members, confirming through the SAME bulkApplyDecision every other
   *  bulk surface uses ("bulk actions should fan out through the existing
   *  candidate decision commands so there is still a single underlying
   *  decision system and a single audit model" -- AG, Phase 2 spec,
   *  verbatim). Anchored on the typeId so the editor renders inside that
   *  type's bulk bar. */
  | { scope: "type-members"; typeId: string; candidateIds: string[]; action: "Rename" | "Redact" }
  // KIND-GROUP BULK (AG, 2026-08-03): one shared replacement across every
  // remaining member of every proposal in a structural kind group. Its own
  // scope rather than `bulk` because the narration names the kind and the
  // id set is derived per-card (see remainingIdsInRelationshipKind); its
  // own scope rather than `relationship` because that one is single-
  // proposal and routes through applyRelationshipBulk's per-card path.
  | { scope: "relationship-kind"; kind: RelationshipKind; candidateIds: string[]; action: "Rename" | "Redact" };

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
    case "relationship":
      return `relationship:${target.proposalId}:${target.action}`;
    case "split-member":
      return `split-member:${target.groupId}:${target.candidateId}:${target.action}`;
    case "type-members":
      return `type-members:${target.typeId}:${target.action}`;
    case "relationship-kind":
      return `relationship-kind:${target.kind}:${target.action}`;
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

function isEditingRelationship(proposalId: string, action: "Rename" | "Redact"): boolean {
  return inlineEditor?.scope === "relationship" && inlineEditor.proposalId === proposalId && inlineEditor.action === action;
}

/** The KIND-GROUP editor (the heading's "Change all…"/"Redact all…"), as
 *  distinct from a single card's. Same shape as every other isEditing*
 *  predicate so the heading can tint its originating button exactly the way
 *  the Type Check bulk bar and the relationship cards already do. */
function isEditingRelationshipKind(kind: RelationshipKind, action: "Rename" | "Redact"): boolean {
  return inlineEditor?.scope === "relationship-kind" && inlineEditor.kind === kind && inlineEditor.action === action;
}

function isEditingTypeMembers(typeId: string, action: "Rename" | "Redact"): boolean {
  return inlineEditor?.scope === "type-members" && inlineEditor.typeId === typeId && inlineEditor.action === action;
}

function isEditingSplitMember(groupId: string, candidateId: string, action: "Rename" | "Redact"): boolean {
  return (
    inlineEditor?.scope === "split-member" &&
    inlineEditor.groupId === groupId &&
    inlineEditor.candidateId === candidateId &&
    inlineEditor.action === action
  );
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
    const command: AnyCommand =
      target.action === "Rename"
        ? { family: "review", type: "renameCandidate", candidateId: target.candidateId, replacement: trimmed }
        : { family: "review", type: "redactCandidate", candidateId: target.candidateId, ...(trimmed ? { replacement: trimmed } : {}) };
    // CONTEXTUAL MEMBER DECISIONS (AG, 2026-07-30): a candidate editor
    // opened on a GROUP MEMBER (stage "group-check") confirms through the
    // member path, so the selection advances to the next unedited member
    // exactly like a one-key K/I decision.
    const memberGroup =
      target.stage === "group-check" ? dispatcher.getState().grouping?.entityGroupProposals.find((g) => g.candidateIds.includes(target.candidateId)) : undefined;
    // PHASE 2, TYPE CHECK: a candidate editor opened on a TYPE MEMBER
    // confirms through the member-cursor path, so the cursor advances to
    // the next unresolved member exactly like a one-key K/I decision --
    // the same rule the group-member branch above established.
    const typeGroup =
      target.stage === "type-check" ? dispatcher.getState().semanticTypes?.find((g) => g.candidateIds.includes(target.candidateId)) : undefined;
    if (memberGroup) {
      decideGroupMemberAndAdvance(memberGroup, target.candidateId, command);
    } else if (typeGroup) {
      decideTypeMemberAndAdvance(typeGroup, target.candidateId, command);
    } else {
      decideAndAdvance(command, target.candidateId, target.stage);
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
    if (result.ok) {
      selectedCandidateIds.clear();
      setStatus(`${decisionDisplayLabel(target.action)} applied to ${target.candidateIds.length} candidate(s).`); // RX-18 + RX-22
    } else {
      notifyToast(`Bulk action failed: ${result.reason}`); // RX-09: recoverable
    }
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
  } else if (target.scope === "relationship") {
    // Structural Relationship Review (2026-07-30): a plain bulk decision
    // over the proposal's (selected) members -- ordinary per-candidate
    // decisions, no relationship-level stamp (the relationship was USEFUL;
    // its usefulness is recorded implicitly by the decisions it produced,
    // and the event log's viaBulkApply entries carry the batch). Routed
    // through applyRelationshipBulk -- the same single path the generic
    // buttons and the preferred-action shortcuts use.
    applyRelationshipBulk(target.proposalId, target.candidateIds, target.action, trimmed ? trimmed : undefined);
  } else if (target.scope === "split-member") {
    // SPLIT REVIEW MODE (AG, 2026-08-02): the choice goes into the split
    // BUFFER, not the dispatcher -- nothing is committed until every
    // member has a choice (completeSplitReview), so Esc can still discard
    // the whole exploration. Rename's empty-string refusal above applies
    // here identically; Redact blank = default placeholder, as everywhere.
    const group = dispatcher.getState().grouping?.entityGroupProposals.find((g) => g.groupId === target.groupId);
    if (group) recordSplitChoice(group, target.candidateId, target.action, trimmed ? trimmed : undefined);
  } else if (target.scope === "relationship-kind") {
    // Same single audit model as `type-members` -- one bulkApplyDecision
    // over an explicit id list, through the visible-advance choke point so
    // clearing a whole kind group advances like every other decision.
    const result = dispatchReviewWithVisibleAdvance({
      family: "review",
      type: "bulkApplyDecision",
      candidateIds: target.candidateIds,
      decision: target.action,
      ...(trimmed ? { replacement: trimmed } : {}),
    });
    if (result.ok) {
      setStatus(`${decisionDisplayLabel(target.action)} applied to ${target.candidateIds.length} ${RELATIONSHIP_KIND_LABEL[target.kind]} member(s).`); // RX-18 + RX-22
      // COMPLETION-PATH AUDIT (AG, 2026-08-03): the choke point above
      // advances the ROW cursor, which is the wrong cursor here -- Opt C /
      // Opt R are fired while standing on a CARD, and the row cursor is
      // merely parked wherever the row half was left (the ROWS-THEN-CARDS
      // seam's own note). Advancing it yanked the viewport somewhere
      // unrelated. While the card cursor is set, the cards are the working
      // object, so the card advance is the one that applies.
      const cardId = structuralCardFocusPending as string | null;
      if (cardId) {
        advanceStructuralCursor(cardId);
        return;
      }
    } else {
      notifyToast(`Bulk action failed: ${result.reason}`); // RX-09: recoverable
    }
    render();
  } else if (target.scope === "type-members") {
    // PHASE 2, TYPE CHECK: type-level bulk Change/Redact over the type's
    // remaining members -- plain bulkApplyDecision, single audit model.
    const result = dispatchReviewWithVisibleAdvance({
      family: "review",
      type: "bulkApplyDecision",
      candidateIds: target.candidateIds,
      decision: target.action,
      ...(trimmed ? { replacement: trimmed } : {}),
    });
    if (result.ok) {
      setStatus(`${decisionDisplayLabel(target.action)} applied to ${target.candidateIds.length} ${SEMANTIC_TYPE_LABELS[target.typeId as SemanticTypeId] ?? target.typeId} item(s).`); // RX-18 + RX-22
    } else {
      notifyToast(`Bulk action failed: ${result.reason}`); // RX-09: recoverable
    }
    render();
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
function renderInlineEditor(container: HTMLElement, placeholder: string, quickPicks: string[] = [], extraClass?: string): void {
  if (!inlineEditor) return;
  const current = inlineEditor;
  // `extraClass` (AG, 2026-08-03) exists for ONE reason: an editor hosted on
  // a heading's own title line rather than on a row of its own. The default
  // `.inline-editor` claims a full row (flex-basis: 100%), which is right
  // everywhere it has one; `.inline-editor-compact` relaxes that so the
  // SAME editor -- same input, same Confirm/Cancel, same keys -- can sit
  // beside the buttons that opened it and wrap only when space runs out.
  const wrap = el("div", { class: extraClass ? `inline-editor ${extraClass}` : "inline-editor" });

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
          // INTERACTION LANGUAGE (2026-07-30): one Escape, one level --
          // cancelling the editor is this press's whole job; without
          // stopPropagation the document-level listener would ALSO see the
          // event (banner dismissal / region exit) and back out two levels
          // in a single press.
          event.stopPropagation();
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
        event.stopPropagation(); // one Escape, one level -- see the quick-pick chips' identical note
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
function renderConfidenceBadge(live: LiveConfidence, extraClass = "badge", needsAttention = false): HTMLElement {
  const node = el("span", { class: `${extraClass} ${confidenceBadgeClass(live.current)}` }, `${live.current}%`);
  if (live.prior !== undefined) node.appendChild(el("span", { class: "prior-score" }, `was ${live.prior}%`));
  // VISUAL HIERARCHY REFINEMENT (AG, 2026-08-01, per direct question --
  // "figure out better placement"): the "needs attention" words moved out
  // of the title line and into the confidence column, stacked under the %
  // in the same slot "was x%" already uses -- the signal survives with
  // the same vocabulary, but no longer breaks either the name's
  // prominence or the % column's vertical scan line.
  if (needsAttention) node.appendChild(el("span", { class: "attention-note" }, "needs attention"));
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
 *
 * 2026-07-30 feature spec: "By Category" is now Item Check's DEFAULT view
 * ("I do want 'by Category' to be the default view upon opening Item
 * Check"), and the spec's third narrowing axis (the per-category Filter
 * row: Show All / Single Occurrence / Multiple Occurrences / High
 * Likelihood) lives in `categoryContextFilter`. Reset rules, per the spec:
 * selecting "Total" clears EVERY filter (category + context) and hides the
 * Filter row; picking a category resets the context axis to Show All (the
 * additional filters "open up" fresh); the Filter row's own Show All
 * negates the other three.
 */
let itemCheckViewMode: "list" | "category" | "triage" = "category";
// TRIAGE QUEUE (2026-07-30): at most one triage row is expanded at a time
// -- expansion is an explicit reviewer request (Space / the chevron /
// Enter on a row with nothing to accept), NOT focus, because the whole
// point of the mode is moving focus through many rows WITHOUT opening
// anything. Cleared automatically once the expanded item gets a decision
// ("when finished, collapse the row back into its compact form").
let triageExpandedId: string | null = null;
/**
 * REVIEW SCOPE, Pass 1 (AG, 2026-08-03): the reviewer explicitly WIDENED
 * out of the focused item (Escape in the triage view's Review mode) --
 * the scope resolver then skips item-focus and lands on stage-remainder,
 * which is what puts the inspector's zero state on screen. Holds the
 * itemId that was focused at the moment of widening, because validity is
 * DERIVED, not managed: the widening survives only while focus still sits
 * on exactly that item in Item Check's triage view
 * (`reconcileScopeWidening`, render()'s top). Any focus movement -- an
 * arrow key, a row click, a decision's auto-advance -- re-narrows
 * automatically with zero scattered clear() calls, the same
 * reconcile-at-render-top shape `reconcileSourceView` established.
 * Ephemeral presentation state, same class as `triageExpandedId` above.
 */
let scopeWidenedFrom: string | null = null;
let categoryReviewState: CategoryReviewState = "toReview";
let categoryFilter: string | null = null;
let categoryContextFilter: CategoryContextFilter = "all";
/** AG response (2026-07-30): the Python reference's "show empty
 *  categories" checkbox -- off by default (empty cells are clutter until
 *  you ask for them), it reveals categories with zero members under the
 *  current narrowing so a reviewer can see the whole vocabulary. */
let showEmptyCategories = false;

/**
 * INTERACTION LANGUAGE (2026-07-30, keyboard UX refinement). Two pieces of
 * ephemeral UI state for the review's region model:
 *
 * `filterHeaderRow` -- which ROW of Item Check's By Category narrowing
 * column the Shift+Arrow cursor is on. The vertical column, top to bottom:
 * Review State row -> Filter row -> the category area (Show All + grid).
 * Within the category area the existing rules are untouched (position IS
 * selection, spreadsheet-style, per the landed Show All work). Within the
 * two header rows, Shift+Left/Right SELECTS (each row is single-select, so
 * the active chip is the cursor -- position is selection there too), while
 * Shift+Up/Down TRAVELS between rows without changing any selection. The
 * cursor row's active chip carries a visible ring (`.chip-nav-cursor`) so
 * "which row am I steering" is never ambiguous. Deliberately ephemeral and
 * never persisted: it is a steering-wheel position, not a filter.
 *
 * `detailPanelFocusPending` -- set when Enter (the domain's own enterItem,
 * previously inert in this UI) asks to move REAL DOM focus into the
 * expanded detail panel; consumed at render()'s tail once the tree is
 * attached, the same deferred-focus shape rovingFocusPending and
 * searchInputFocusPending already use for the same from-scratch-rebuild
 * reason.
 */
type FilterHeaderRow = "state" | "filter" | "category";
let filterHeaderRow: FilterHeaderRow = "category";
let detailPanelFocusPending = false;

/** The focused itemId as of the LAST completed render -- lets render()
 *  distinguish "incidental rebuild of the same item" (restore panel focus)
 *  from "focus advanced to a different item" (return to Review mode). See
 *  render()'s activeWasInDetailPanel. */
let lastRenderedFocusedItemId: string | null = null;

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
 * GROUP CHECK REVISION (2026-07-29): Group Check's own sort order --
 * ephemeral UI-layer state, same rationale as itemCheckQueryState above.
 * Default sort matches Item Check's own default (confidence-desc) for
 * consistency across the workspace.
 *
 * 2026-07-30 feature spec: the manual 1-/2-column layout toggle
 * (`groupCheckLayout`) is REMOVED -- "above a certain window width the
 * screen allows two columns" is now automatic, a pure CSS media query on
 * `.group-list` (index.html). Sequential navigation (Tab / post-decision
 * advance / `]`-`[`) is DOM order, which in the row-major grid is exactly
 * the spec's "perusing a horizontal row completely before moving to the
 * next row" -- no JS knows or cares how many columns rendered.
 */
let groupCheckSortOrder: GroupSortOrder = "confidence-desc";

/**
 * 2026-07-30 feature spec (+ Andrew's same-day follow-up): the member
 * Source panel ("Context" in Python, renamed "Source"). Ephemeral
 * presentation state, exactly the class of toggle keymap.ts's top doc
 * comment deliberately did NOT port into the domain -- this is that UI.
 *
 * REVISED to at-most-ONE open panel that FOLLOWS the selected member
 * ("navigating down to the next item closes the present Source panel and
 * instead opens the Source panel of the newly selected item. Much like
 * the behavior at other levels throughout this UI") -- the same
 * expansion-follows-selection model the rows themselves use, one level
 * down. Toggled by the Source button and the "S" key
 * (handleSourceToggleKey); moved by the roving arrow handler
 * (attachRovingGridNav) and reconciled against Fix this member movement /
 * group changes at the top of render() (reconcileSourceView).
 */
let sourceViewFor: { groupId: string; candidateId: string } | null = null;

function isSourceOpen(groupId: string, candidateId: string): boolean {
  return sourceViewFor !== null && sourceViewFor.groupId === groupId && sourceViewFor.candidateId === candidateId;
}

/** Toggle from the Source BUTTON (mouse path). Opening also makes that
 *  member the roving-active row, so the follow-on arrow keys continue
 *  from the member whose sources are showing. */
function toggleSourcePanel(groupId: string, candidateId: string): void {
  if (isSourceOpen(groupId, candidateId)) {
    sourceViewFor = null;
    render();
    return;
  }
  sourceViewFor = { groupId, candidateId };
  const group = dispatcher.getState().grouping?.entityGroupProposals.find((g) => g.groupId === groupId);
  const memberIndex = group ? group.candidateIds.indexOf(candidateId) : -1;
  // col 1 = the Source button itself, so the just-clicked control keeps
  // focus across the re-render instead of hopping to the row's checkbox.
  if (memberIndex !== -1) groupRovingFocus = { groupId, row: memberIndex + 1, col: 1 };
  render();
}

/** Derived-state reconciliation, called at the top of render(): the open
 *  Source panel always belongs to the CURRENTLY selected member. Inside an
 *  open Fix this panel it follows `activeMemberId`; if the reviewer's
 *  focused group changes, a panel left open on another group closes
 *  (selection moved; the panel belongs to the selection). Roving-focus
 *  member movement is handled at the moment of the keypress instead
 *  (attachRovingGridNav) -- those moves never dispatch or re-render on
 *  their own, so render-time reconciliation cannot see them. */
function reconcileSourceView(state: ReturnType<WorkspaceCommandDispatcher["getState"]>): void {
  if (!sourceViewFor) return;
  const target = state.focus?.target;
  if (!target || target.stage !== "group-check") return; // keep across stage visits; it only renders in Group Check
  if (target.panel.kind === "not-quite") {
    if (target.panel.groupId !== sourceViewFor.groupId) sourceViewFor = null;
    else if (target.panel.activeMemberId && target.panel.activeMemberId !== sourceViewFor.candidateId) {
      sourceViewFor = { groupId: target.panel.groupId, candidateId: target.panel.activeMemberId };
    }
    return;
  }
  if (target.itemId !== sourceViewFor.groupId) sourceViewFor = null;
}

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

/**
 * FOUND VIA ANDREW'S 2026-07-30 BROWSER FEEDBACK ("down arrow navigates to
 * the next list item instead of entering the item"): the roving grid's
 * end-of-render focus restore used to call `.focus()` from INSIDE
 * renderGroupStage -- but render() only appends the stage body to the
 * document AFTER the stage renderers return, and focusing a detached
 * element is a silent no-op. DOM focus therefore fell back to <body> on
 * every render, arrow keys bubbled to the document handler, and keymap.ts
 * resolved them to between-item moveItem commands -- exactly the reported
 * symptom, and the opposite of the directional-row-navigation design
 * ("only the four arrow keys are grid-scoped; Tab means next item"). The
 * restore is now DEFERRED through this pending slot, applied in render()'s
 * tail once the tree is attached -- the same deferred-focus shape
 * searchInputFocusPending already uses for the same from-scratch-rebuild
 * reason. With focus genuinely restored, Down from the group's own row
 * ENTERS the item (highlights the first member) instead of leaving it.
 */
let rovingFocusPending: HTMLElement | null = null;
// UNIFIED WORKBENCH (2026-07-30): the structural-card KEYBOARD CURSOR,
// by proposalId (an ID, not an element -- the full rebuild replaces the
// element). Set whenever keyboard navigation or a card-local action
// focuses a card. render()'s tail RE-focuses this card whenever DOM
// focus has fallen to <body> -- a full rebuild (and this app's async
// autosave renders arrive in bursts, so a one-shot restore loses the
// second race; found live in the browser, same failure class
// rovingFocusPending fixed for the Group Check grid). NOT one-shot:
// cleared the moment the reviewer interacts anywhere outside the cards
// (pointerdown elsewhere, triage-row keys, the boundary move into the
// rows), so it can never yank focus back from real work.
let structuralCardFocusPending: string | null = null;

/** Attaches the arrow-key roving-focus handler to `containers` (the row
 *  element and, when rendered, the member-list element) -- `stopPropagation`
 *  keeps these keydowns from ever reaching the document-level listener, so
 *  there's no need to special-case them in that listener's own gate. Only
 *  fires when `event.target` is actually one of `grid`'s own tracked
 *  elements, so an arrow key pressed anywhere else inside these containers
 *  (there isn't anywhere else today, but this stays correct if that
 *  changes) falls through untouched.
 *
 *  2026-07-30 follow-up: rows 1..N are member rows (`memberIds[row - 1]`),
 *  and when a Source panel is open it FOLLOWS row movement -- moving to
 *  another member closes the current panel and opens that member's; moving
 *  back up to the group's own action row (no member selected) closes it.
 *  Those moves re-render (the panel is real DOM), so focus is handed to
 *  the deferred-restore slot rather than a stale pre-render element. */
function attachRovingGridNav(containers: HTMLElement[], grid: HTMLElement[][], groupId: string, memberIds: string[]): void {
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

    // Row changed: Source-follows-selection (a panel open for THIS group
    // moves with the selected member; none while at the item's top level),
    // and a re-render keeps the member-context command-bar legend and the
    // containment scheme truthful (CONTEXTUAL MEMBER DECISIONS, AG
    // 2026-07-30 -- K/C/R/I mean the MEMBER while a member row is active,
    // and the legend must say so the moment the row changes). The deferred
    // restore re-focuses the remembered cell after the rebuild.
    if (nextRow !== row) {
      if (sourceViewFor?.groupId === groupId) {
        const nextMemberId = nextRow >= 1 ? memberIds[nextRow - 1] : undefined;
        sourceViewFor = nextMemberId ? { groupId, candidateId: nextMemberId } : null;
      }
      render();
      return;
    }
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
/** WORKSPACE ANALYSIS (2026-08-02): same shape as `showingLanding` --
 *  transient UI-only navigation state, not gated by
 *  WorkspaceState.documentLoaded (Workspace Analysis is reachable whether
 *  or not a document is currently loaded for review, and never touches
 *  `state` either way). Set true only from the landing/default page's
 *  entry-point button; render() checks it first, before any
 *  documentLoaded-dependent branch. */
let showingWorkspaceAnalysis = false;

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

/**
 * "Opt" on a Mac, "Alt" on a PC (AG, 2026-08-03: "I always appreciate
 * having 'Opt' written out. I never have memorized the weird glyphs").
 *
 * Spelled out rather than ⌥ deliberately -- the glyph is the single least
 * recognised modifier symbol on the keyboard, and a keycap the reviewer has
 * to decode is a keycap that does not teach. The platform read is a
 * one-time module-level constant because the answer cannot change inside a
 * session, and it is triple-guarded: `userAgentData` where available, the
 * legacy `platform` string, then the user-agent, then a PC default. Every
 * access is `typeof`-guarded for the verify harness's fake DOM, which
 * supplies no `navigator` at all (the established app.ts precedent -- see
 * scrollFocusedRowIntoView's CSS.escape guard).
 *
 * Defaults to "Alt" when nothing is detectable: a Mac user reading "Alt"
 * still finds the key (it is printed on the same keycap on most Apple
 * keyboards); a PC user reading "Opt" has no key by that name at all.
 */
const OPTION_KEY_LABEL: string = (() => {
  if (typeof navigator === "undefined" || !navigator) return "Alt";
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const platform = uaData?.platform ?? (typeof navigator.platform === "string" ? navigator.platform : "") ?? "";
  const agent = typeof navigator.userAgent === "string" ? navigator.userAgent : "";
  return /mac|iphone|ipad|ipod/i.test(`${platform} ${agent}`) ? "Opt" : "Alt";
})();

/** How a group-scope chord is spelled on a keycap and in the legend. ONE
 *  function, so the cap a reviewer reads and the key the handler listens
 *  for can never disagree about which modifier this is. */
function groupScopeChordLabel(chord: GroupScopeChord): string {
  return `${OPTION_KEY_LABEL} ${chord}`;
}

const STAGE_LABELS: Record<WorkflowStage, string> = {
  "ambiguity-check": "Ambiguity Check",
  "group-check": "Group Check",
  "type-check": "Type Check",
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

// KEYCAP DIGITS (2026-07-30, Andrew's feedback on the Recommendation UX):
// the original circled-digit glyphs (①②…) rendered too small to read at
// button size -- the digit IS the keyboard shortcut's visible referent,
// so it must be as legible as the label it accompanies. Replaced with a
// rendered <kbd class="keycap"> square: the numeral sizes with the
// button's own text and the keycap styling (border + bottom edge) makes
// it read as "press this key," visually distinct from the clickable chip
// around it. Used by every 1-9 digit surface (recommendation suggestions,
// structural-card preferred actions, the Possible-identities list) so the
// shortcut language looks identical everywhere it applies.
/**
 * `cap` widened from `number` to `number | string` (AG, 2026-08-03) so a
 * button can advertise a CHORD ("Opt R") as naturally as a digit. The
 * keycap was never conceptually numeric -- it is "the thing you press" --
 * and every existing caller passing a digit is unaffected.
 */
/** Gives a rendered action button its two label forms -- the long one
 *  wherever the window has room, the terse one below the breakpoint.
 *  No-op for actions declaring only one form. */
function applyVerboseLabel(btn: HTMLButtonElement, action: QueueSectionAction): void {
  if (!action.verboseLabel) return;
  const host = Array.from(btn.children).find((child) => child.tagName.toLowerCase() === "span");
  const target = host ?? btn;
  target.textContent = "";
  target.appendChild(el("span", { class: "action-label-short" }, action.label));
  target.appendChild(el("span", { class: "action-label-long" }, action.verboseLabel));
}

function keycapButton(cap: number | string, label: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const b = el("button", { class: "preferred-action" });
  const kbd = el("kbd", { class: "keycap" }, String(cap));
  if (typeof cap === "string") kbd.classList.add("keycap-chord"); // wider glyph, not a circled digit
  b.appendChild(kbd);
  b.appendChild(el("span", {}, label));
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
/** VISUAL HIERARCHY REFINEMENT (AG, 2026-08-01): some <details> now
 *  default OPEN (the focused item's "Why?" -- evidence should be visible
 *  on the highlighted item without a click). A default-open element the
 *  reviewer explicitly closed must STAY closed across the background
 *  autosave renders, so closes are remembered per-key just like opens --
 *  otherwise the panel would silently pop back open moments after being
 *  dismissed, the same failure class the open-set itself was built for. */
const closedDetailsKeys = new Set<string>();

function detailsEl(key: string, attrs: Record<string, string> = {}, defaultOpen = false): HTMLDetailsElement {
  const node = el("details", attrs);
  node.open = openDetailsKeys.has(key) || (defaultOpen && !closedDetailsKeys.has(key));
  node.addEventListener("toggle", () => {
    if (node.open) {
      openDetailsKeys.add(key);
      closedDetailsKeys.delete(key);
    } else {
      openDetailsKeys.delete(key);
      closedDetailsKeys.add(key);
    }
  });
  return node;
}

function root(): HTMLElement {
  const found = document.getElementById("app");
  if (!found) throw new Error("index.html must contain <div id=\"app\"></div>");
  return found;
}

// ===== UI-STATE PERSISTENCE (AG, 2026-08-02) ==============================
// "If they are on tab 32 on Item Check, that's where it opens when they
// resume... Screen refreshes should not close out the document."
//
// One mechanism serves both: a DOCUMENT-TIED snapshot of presentation
// state (Andrew: "tie it to the document, not the user -- that will make
// future user account stuff much easier"), stored via the session
// repository's ui-state store (IndexedDB, beside the session record) so
// it travels with the document. The snapshot's SHAPE is owned here; the
// persistence layer treats it as opaque (PersistedUiState).
//
// Lifecycle:
//  - SAVE: debounced from render()'s tail while a document is loaded,
//    plus a pagehide flush (captures final scroll). Fire-and-forget.
//  - APPLY: after Resume (button or session-file) and after the refresh
//    auto-reopen below. Loose, versioned validation; any surprise = skip
//    that field or the whole snapshot -- never break the load.
//  - RESET: a FRESH file load (New Document picker) resets every module
//    UI variable to defaults, so new files always start at the top left.
//  - REFRESH AUTO-REOPEN: a per-tab sessionStorage pointer (deliberately
//    NOT document-tied -- "which document THIS tab had open" is tab
//    state) reopens the last document after a refresh and then applies
//    its snapshot. Dies with the browser session; a fresh visit still
//    lands on Documents.

interface UiSnapshot {
  v: 1;
  stage: WorkflowStage;
  itemId: string | null;
  panelKind: "not-quite" | null;
  itemCheckViewMode: "list" | "category" | "triage";
  categoryReviewState: CategoryReviewState;
  categoryFilter: string | null;
  categoryContextFilter: CategoryContextFilter;
  showEmptyCategories: boolean;
  itemCheckQuery: ItemCheckQueryState;
  groupCheckSortOrder: GroupSortOrder;
  triageExpandedId: string | null;
  sourceViewFor: { groupId: string; candidateId: string } | null;
  editorTarget: InlineEditorTarget | null;
  editorDraft: string;
  scrollY: number;
}

const LAST_OPEN_DOC_KEY = "docscrub-last-open-document";

function captureUiSnapshot(state: ReturnType<WorkspaceCommandDispatcher["getState"]>): UiSnapshot | null {
  if (!state.documentLoaded || !state.documentId) return null;
  const target = state.focus?.target;
  let editorTarget: InlineEditorTarget | null = null;
  if (inlineEditor) {
    const { draftText: _draft, customInputActive: _custom, ...targetOnly } = inlineEditor;
    editorTarget = targetOnly as InlineEditorTarget;
  }
  return {
    v: 1,
    stage: target?.stage ?? "ambiguity-check",
    itemId: target?.itemId ?? null,
    panelKind: target?.panel.kind === "not-quite" ? "not-quite" : null,
    itemCheckViewMode,
    categoryReviewState,
    categoryFilter,
    categoryContextFilter,
    showEmptyCategories,
    itemCheckQuery: itemCheckQueryState,
    groupCheckSortOrder,
    triageExpandedId,
    sourceViewFor,
    editorTarget,
    editorDraft: inlineEditor?.draftText ?? "",
    scrollY: typeof window !== "undefined" ? (window.scrollY ?? 0) : 0,
  };
}

/** New files start at the top left (#1) -- every module UI variable back
 *  to its declared default. Focus itself is reset by the load command. */
function resetUiToDefaults(): void {
  itemCheckViewMode = "category";
  categoryReviewState = "toReview";
  categoryFilter = null;
  categoryContextFilter = "all";
  showEmptyCategories = false;
  filterHeaderRow = "category";
  itemCheckQueryState = createDefaultQueryState();
  groupCheckSortOrder = "confidence-desc";
  triageExpandedId = null;
  scopeWidenedFrom = null; // REVIEW SCOPE, Pass 1: a widening never survives a document change
  sourceViewFor = null;
  groupRovingFocus = null;
  inlineEditor = null;
}

function applyUiSnapshot(raw: unknown): void {
  try {
    if (!raw || typeof raw !== "object" || (raw as { v?: unknown }).v !== 1) return;
    const snap = raw as UiSnapshot;
    // Module presentation state first (loosely validated; defaults win on
    // anything surprising), so the render the focus dispatches trigger
    // already shows the right view.
    if (snap.itemCheckViewMode === "list" || snap.itemCheckViewMode === "category" || snap.itemCheckViewMode === "triage") {
      itemCheckViewMode = snap.itemCheckViewMode;
    }
    categoryReviewState = snap.categoryReviewState ?? "toReview";
    categoryFilter = typeof snap.categoryFilter === "string" ? snap.categoryFilter : null;
    categoryContextFilter = snap.categoryContextFilter ?? "all";
    showEmptyCategories = Boolean(snap.showEmptyCategories);
    if (snap.itemCheckQuery && typeof snap.itemCheckQuery === "object") itemCheckQueryState = snap.itemCheckQuery;
    if (typeof snap.groupCheckSortOrder === "string") groupCheckSortOrder = snap.groupCheckSortOrder;
    triageExpandedId = typeof snap.triageExpandedId === "string" ? snap.triageExpandedId : null;
    sourceViewFor = snap.sourceViewFor && typeof snap.sourceViewFor === "object" ? snap.sourceViewFor : null;
    // Focus: stage, then item, then the Not Quite panel if one was open.
    dispatcher.dispatchNavigation({ family: "navigation", type: "focusStage", stage: snap.stage });
    if (snap.itemId) dispatcher.dispatchNavigation({ family: "navigation", type: "selectItem", itemId: snap.itemId });
    if (snap.panelKind === "not-quite" && snap.itemId) {
      dispatcher.dispatchReview({ family: "review", type: "enterNotQuite", groupId: snap.itemId });
    }
    // The open editor, draft included ("editing a specific function...
    // they should come right back there").
    if (snap.editorTarget && typeof snap.editorTarget === "object") {
      inlineEditor = { ...snap.editorTarget, draftText: typeof snap.editorDraft === "string" ? snap.editorDraft : "", customInputActive: false };
    }
    render();
    // Scroll last, after RX-01's own focused-row scroll has run -- the
    // absolute offset wins when both apply, and if layout shifted since
    // the snapshot, the focused row is already in view as the fallback.
    const y = typeof snap.scrollY === "number" ? snap.scrollY : 0;
    window.setTimeout(() => window.scrollTo({ top: y }), 80);
  } catch {
    /* a snapshot must never break a load -- fall through to defaults */
  }
}

async function applyStoredUiStateFor(documentId: string): Promise<void> {
  try {
    const stored = await dispatcher.loadUiState(documentId);
    if (stored) applyUiSnapshot(stored);
  } catch {
    /* no snapshot is a normal state */
  }
}

let uiStateSaveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleUiStateSave(): void {
  if (uiStateSaveTimer !== null) return;
  uiStateSaveTimer = setTimeout(() => {
    uiStateSaveTimer = null;
    const state = dispatcher.getState();
    const snapshot = captureUiSnapshot(state);
    if (snapshot && state.documentId) {
      void dispatcher.saveUiState(state.documentId, snapshot as unknown as Record<string, unknown>).catch(() => {
        /* best-effort by contract */
      });
    }
  }, 500);
}
// ==========================================================================

/**
 * REOPEN PROMPT (AG, 2026-08-03). Set when the reviewer picks a file that
 * the repository already holds a session for; cleared the moment they
 * choose. While set, render() draws the inline prompt and NOTHING has been
 * loaded or destroyed yet -- the picked file is held here, unparsed.
 *
 * Holding the File (rather than eagerly extracting and asking afterwards)
 * is the point: document identity is a plain content hash
 * (documentIdForFile), so "do I already know this?" is answerable from the
 * bytes alone, and a reviewer who chooses "continue existing" never pays
 * for an extraction that gets thrown away.
 */
let reopenPrompt: { file: File; documentId: string; summary: SessionSummary } | null = null;

/**
 * Entry point for the file picker and drag-drop.
 *
 * `force` skips the already-known check -- used by the prompt's own "start
 * fresh" branch, which has just deleted the stored session and genuinely
 * does want a clean extraction. Every other caller goes through the check.
 *
 * The check is deliberately scoped to THIS path (AG's own call, 2026-08-03):
 * choosing from "Choose an existing document…" or Recent Documents is
 * already an explicit "resume this one," so asking again there would be
 * re-posing a question the reviewer just answered.
 */
async function handleLoadFile(file: File, options?: { force?: boolean }): Promise<void> {
  if (!options?.force) {
    // Identity BEFORE extraction -- see reopenPrompt's doc comment. A
    // failure here (unreadable file) is left to the ordinary load path
    // below to report, rather than duplicating error handling: we simply
    // fall through as if the document were unknown.
    const known = await knownDocumentFor(file);
    if (known) {
      reopenPrompt = { file, documentId: known.documentId, summary: known };
      failureBanner = null;
      render();
      return;
    }
  }
  const result = await dispatcher.dispatchApplication({ family: "document", type: "load", file });
  if (!result.ok) {
    // RX-09: action-required -- the reviewer cannot proceed without
    // reacting (pick a different file, or investigate). Fires from the
    // landing view, where render()'s landing branch hosts the banner.
    showFailureBanner("Failed to load document", result.reason ?? "no reason given");
  } else {
    showingLanding = false;
    failureBanner = null; // a successful load supersedes any prior load/resume failure
    resetUiToDefaults(); // UI-STATE (#1): a freshly opened file starts at the top left
    focusFirstDisplayedItem(); // AG 2026-08-03: ...and on the first item the reviewer can actually SEE
  }
  // RENDER FIRST (2026-08-02, defect found live): refreshRecentSessions
  // hits IndexedDB, and a wedged database (e.g. a version upgrade blocked
  // by a stale tab) hangs its promise INDEFINITELY -- awaiting it before
  // render() silently swallowed a fully-processed document. Same failure
  // class as the blank-first-refresh fix: the reviewer's view must never
  // be hostage to a persistence call. Recents refresh in the background
  // and re-render whenever they arrive.
  render();
  // RECENTS RACE (AG, 2026-08-03: "a new document should immediately be
  // added to the document list... if you switch documents, you don't lose
  // what you just opened"). The record was already being written --
  // Workspace.loadDocument() ends with a fire-and-forget scheduleAutosave()
  // for exactly this reason -- but this refresh READ the repository before
  // that write landed, so the just-opened document was missing from the
  // list until some later, unrelated refresh happened to pick it up.
  // Waiting on autosaveSettled() first closes the race.
  //
  // Still `void`-ed and still AFTER render(), deliberately: autosaveSettled()
  // can hang on the same wedged database described above, and the rule that
  // the reviewer's view is never hostage to a persistence call applies to
  // this call exactly as much as to the refresh it now precedes. Worst case
  // is unchanged from before -- the list updates late -- never a blank page.
  void dispatcher
    .autosaveSettled()
    .then(() => refreshRecentSessions())
    .then(() => render());
}

/**
 * FIRST ITEM ON THE PAGE (AG, 2026-08-03: "when I open a new document, the
 * focus item should be the first thing on the page").
 *
 * Initial focus comes from `createInitialFocusState()`, which walks
 * `itemIdsForStage()` -- the STRUCTURAL order (for Ambiguity Check, raw
 * `GroupingResult.ambiguityProposals`). Since the AMBIGUITY CATEGORY-FIRST
 * refactor (AG, 2026-08-02) that stage renders a SECTION-GROUPED queue
 * instead, so the structurally-first proposal is routinely somewhere in the
 * middle of the page -- a reviewer opening a document found the expanded
 * item well below the fold, under whichever section happened to contain it.
 *
 * Fixed in the UI layer on purpose. `stages.ts` states plainly that
 * FocusNavigator must never depend on rendered or UI-only state, so the
 * domain cannot be taught the display order; instead the UI re-selects
 * through the displayed order right after a load. This is the same
 * correction `dispatchReviewWithVisibleAdvance()` and `runSectionAction()`
 * already apply after a decision (the NAV-ORDER rule) -- applied once more
 * at the one other moment focus is chosen without the reviewer's input.
 *
 * FRESH LOADS ONLY. The resume paths (Recent Documents, a save file, and
 * "continue existing workflow" in the reopen prompt) deliberately do NOT
 * call this: returning the reviewer exactly where they left off is what
 * FocusResumePosition is for, and AG confirmed on 2026-08-03 that continuing
 * existing work should keep that behavior.
 *
 * No-ops when the stage has no visible list (qa/output), when the list is
 * empty, or when focus already sits on the first item -- so it never
 * dispatches a redundant navigation command.
 */
/** The stored session for `file`, or null -- null also when identity or the
 *  repository lookup fails, so a hiccup in this convenience check can never
 *  block the reviewer from opening a document. Failing OPEN is correct
 *  here: the worst case is the prompt doesn't appear and the reviewer gets
 *  the pre-2026-08-03 behavior, whereas failing closed would strand them. */
async function knownDocumentFor(file: File): Promise<SessionSummary | null> {
  try {
    const documentId = await documentIdForFile(file);
    return await dispatcher.findStoredSession(documentId);
  } catch {
    return null;
  }
}

/** Continue the existing workflow -- the resume path, which restores the
 *  saved FocusResumePosition and stored UI state. Deliberately NOT a fresh
 *  extraction: nothing is re-parsed and no decision is touched. */
async function handleReopenContinue(): Promise<void> {
  const prompt = reopenPrompt;
  if (!prompt) return;
  reopenPrompt = null;
  await handleResumeFromRecent(prompt.documentId);
}

/** Replace the existing workflow with a fresh extraction. Destructive and
 *  labelled as such: the stored session (decisions, groups, Not Quite
 *  transactions, UI state) is deleted first, then the file is loaded with
 *  `force` so the check that produced this prompt doesn't fire again on the
 *  document we just deleted. */
async function handleReopenReplace(): Promise<void> {
  const prompt = reopenPrompt;
  if (!prompt) return;
  reopenPrompt = null;
  await dispatcher.deleteStoredSession(prompt.documentId);
  await handleLoadFile(prompt.file, { force: true });
}

/**
 * The inline "you've already worked on this document" region.
 *
 * COLOR (AG asked for "the same color scheme as Redact"): this uses the
 * CAUTION family (--caution/--caution-soft) rather than the
 * `.decision-redact` class, and the distinction is deliberate. Under the
 * unified decision color system (2026-08-03) a decision class asserts "this
 * candidate is being redacted"; borrowing it for a destructive-action
 * warning would put a decision hue on something that is not a decision --
 * exactly the squatting that pass spent its effort evicting. --caution is
 * the same red, and is already this app's established alert channel
 * (.warnings, .toast-host, the load-failure banner), so the reviewer reads
 * the intended "careful" without the palette losing its one meaning.
 *
 * Renders nothing at all when no prompt is pending, so both render()
 * branches can call it unconditionally.
 */
function renderReopenPrompt(container: HTMLElement): void {
  const prompt = reopenPrompt;
  if (!prompt) return;
  const { summary } = prompt;
  const panel = el("div", { class: "reopen-prompt" });

  // PROFESSIONAL TOOL VOICE (AG, 2026-08-04): was "You're opening a
  // document you've already worked on." -- narration of what the reviewer
  // is doing, addressed to them. States the fact instead. The reviewer
  // knows they opened it; what they do not know is that a session exists.
  panel.appendChild(el("p", { class: "reopen-prompt-title" }, "This document has a previous review session."));
  // The reviewer's own progress is the fact that makes this decision
  // answerable, so it is stated plainly rather than left to be recalled.
  const progress =
    summary.totalCandidateCount > 0
      ? `${summary.fileName} — ${summary.completionPercent}% reviewed (${summary.reviewedCandidateCount} of ${summary.totalCandidateCount} items decided).`
      : `${summary.fileName} — previously opened, no decisions recorded yet.`;
  panel.appendChild(el("p", { class: "reopen-prompt-detail" }, progress));

  const actions = el("div", { class: "reopen-prompt-actions" });
  actions.appendChild(
    keycapButton(1, "Open the existing document workflow", () => {
      void handleReopenContinue();
    })
  );
  const replaceBtn = keycapButton(2, "Replace with a fresh extraction", () => {
    void handleReopenReplace();
  });
  // The one irreversible choice in the region: marked so it reads as the
  // destructive path rather than a peer of "continue".
  replaceBtn.classList.add("reopen-prompt-destructive");
  actions.appendChild(replaceBtn);
  const cancelBtn = button("Cancel", handleReopenCancel);
  cancelBtn.classList.add("reopen-prompt-cancel");
  actions.appendChild(cancelBtn);
  panel.appendChild(actions);
  panel.appendChild(el("p", { class: "reopen-prompt-note" }, "Replacing deletes every decision and all progress recorded for this document. Esc cancels."));

  container.appendChild(panel);
}

/** Cancel -- the picked file is simply not opened. Whatever the reviewer
 *  had open stays exactly as it was; nothing was parsed, deleted or
 *  written, which is what makes this safe to reach with Escape. */
function handleReopenCancel(): void {
  if (!reopenPrompt) return;
  reopenPrompt = null;
  render();
}

function focusFirstDisplayedItem(): void {
  const state = dispatcher.getState();
  const stage = state.focus?.target.stage;
  if (!stage) return;
  const firstVisible = snapshotVisibleIdsForStage(stage, state)?.[0];
  if (!firstVisible || firstVisible === state.focus?.target.itemId) return;
  dispatcher.dispatchNavigation({ family: "navigation", type: "selectItem", itemId: firstVisible });
}

async function handleResumeSession(sessionFile: File, docxFile: File): Promise<void> {
  const text = await sessionFile.text();
  const parsed = deserializeWorkspaceSaveFile(text);
  if (!parsed.ok) {
    // RX-09: recoverable -- pick the right file and try again; the toast
    // fades but the message persists in the status region.
    notifyToast(`That save file could not be read: ${parsed.reason}`);
    return;
  }
  const result = await dispatcher.loadSavedSession(docxFile, parsed.saveFile);
  if (!result.ok) {
    notifyToast(result.reason ?? "Could not resume that session."); // RX-09: recoverable
  } else {
    showingLanding = false;
    failureBanner = null;
  }
  // RENDER FIRST -- same never-hostage-to-persistence rule as
  // handleLoadFile above.
  render();
  void refreshRecentSessions().then(() => render());
  // UI-STATE (#2): the session-file path is a resume too.
  if (result.ok) {
    const loadedId = dispatcher.getState().documentId;
    if (loadedId) await applyStoredUiStateFor(loadedId);
  }
}

/** MILESTONE 3, Phase 1/2 -- "recovery after refresh"/"resume previous
 *  review" via Recent Documents, with no file picker involved: the browser
 *  itself already has the original bytes (see SessionRecord in
 *  LocalSessionRepository.ts). */
async function handleResumeFromRecent(documentId: string): Promise<void> {
  const result = await dispatcher.dispatchApplication({ family: "document", type: "resumeSession", documentId });
  if (!result.ok) {
    // RX-09: action-required (the stored session may be gone or corrupt --
    // the reviewer must choose another path back to their work). Fires
    // from the landing view; the landing branch hosts the banner.
    showFailureBanner("Could not resume that document", result.reason ?? "no reason given");
  } else {
    showingLanding = false;
    failureBanner = null;
  }
  await refreshRecentSessions();
  render();
  // UI-STATE (#2/#3): resuming returns the reviewer exactly where they
  // were -- stage, item, view, filters, open editor, scroll.
  if (result.ok) await applyStoredUiStateFor(documentId);
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
    // RX-09: a refusal, not a failure -- the app declining and saying why.
    // Status region only; nothing to dismiss.
    refuse("No document loaded -- nothing to save.");
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
    // RX-09: refusal -- see handleSaveSession's note.
    refuse("No current redacted output -- generate output first (and note it becomes stale again after any further decision).");
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
  if (!result.ok) notifyToast(`Failed to generate audit record: ${result.reason}`); // RX-09: recoverable
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
 *  Deliberately does NOT interrupt with a blocking dialog on success (a
 *  real Feature 002 decision, made back when failures still used native
 *  alerts): a modal that blocks the page's own JS thread until dismissed
 *  is exactly the kind of interruption "without overwhelming the
 *  interface" argues against for routine success -- the "(Imported)" tags
 *  rendered inline immediately below, plus the numeric stage-tab counts
 *  changing, ARE the success feedback. renderImportSummaryBanner (below)
 *  surfaces the same numbers non-modally, and (RX-18, Wave 2) the status
 *  region now carries a one-line result too. RX-09 later retired the
 *  blocking dialog on the FAILURE side as well (a transient toast now),
 *  so the whole handler is non-modal -- but the success-side reasoning
 *  above predates that and stands on its own. */
async function handleImportDecisions(file: File): Promise<void> {
  const result = await dispatcher.dispatchApplication({ family: "document", type: "importDecisions", file });
  if (!result.ok) {
    notifyToast(`Failed to import decisions: ${result.reason}`); // RX-09: recoverable
  } else {
    // RX-18: decision-import results are one of the status region's named
    // obligations (AC #3).
    const summary = workspace.getLastDecisionReuseSummary();
    if (summary) setStatus(`Import complete: ${summary.appliedCount} decision(s) reused, ${summary.skippedAlreadyDecidedCount} skipped (already decided).`);
  }
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
  if (summary.origin === "decision-memory") {
    // DECISION MEMORY (AG, 2026-08-03). The reviewer did not ASK for this
    // one -- it happened on load -- so it is stated in plain terms rather
    // than in the file-import's tier vocabulary: what was carried over,
    // from how many earlier documents, and the fact that it is all
    // exact-match (which is why no tier breakdown is shown -- there is
    // nothing to break down, and printing "0 grouped alias, 0 similarity"
    // would imply tiers that were deliberately never considered here).
    const docs = summary.documentsDrawnFrom ?? 0;
    banner.textContent =
      `Carried over from your earlier reviews: ${summary.appliedCount} decision(s) applied automatically` +
      ` from ${docs} previous document${docs === 1 ? "" : "s"}, each an exact match on a value you already decided.` +
      (summary.skippedAlreadyDecidedCount > 0 ? ` ${summary.skippedAlreadyDecidedCount} skipped (already decided here).` : "") +
      ` They are marked as reused and can be changed like any other decision.`;
  } else {
    banner.textContent =
      `Last import: ${summary.appliedCount} decision(s) reused from a prior review` +
      ` (${summary.tierCounts["exact-key"]} exact match, ${summary.tierCounts["grouped-alias"]} grouped alias,` +
      ` ${summary.tierCounts["similarity-threshold"]} similarity match); ${summary.skippedAlreadyDecidedCount} skipped (already decided).`;
  }
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
// APPLICATION FRAME REFINEMENT (AG, 2026-08-01): this used to render a
// .persistence-status row inside the workspace chrome; the same derived
// states now feed the header's PERMANENT save-status slot instead
// ("provide a permanent save status area near the top of the
// application... the reviewer should not think about saving") -- see
// syncAppHeader(). The derivation is unchanged: `lastAutosaveAt ===
// updatedAt` staleness comparison, quota warnings outranking the ordinary
// saved/saving text.
function saveStatusView(state: ReturnType<WorkspaceCommandDispatcher["getState"]>): { text: string; className: string } | null {
  if (!state.documentLoaded) return null;
  if (state.persistence.lastAutosaveError) {
    return { text: `⚠ Not saving — ${state.persistence.lastAutosaveError}`, className: "save-status-error" };
  }
  if (state.persistence.quotaStatus === "exceeded") {
    return { text: "⚠ Not saving — local storage is full", className: "save-status-error" };
  }
  if (state.persistence.quotaStatus === "approaching-limit") {
    return { text: "✓ Saved — local storage nearly full", className: "save-status-warn" };
  }
  if (state.reviewSession && state.persistence.lastAutosaveAt === state.reviewSession.updatedAt) {
    return { text: "✓ All changes saved", className: "save-status-ok" };
  }
  return { text: "Saving…", className: "" };
}

/** APPLICATION FRAME REFINEMENT (AG, 2026-08-01): whether the header's
 *  inline document panel (the "+N ▾" / "▾" expansion listing the working
 *  set) is open. Ephemeral UI state, closed on outside click (wired once
 *  at startup, next to the settings menu). */
let headerDocPanelOpen = false;

/**
 * Writes the header's dynamic slots -- document identity (center), save
 * status (right) -- into the STATIC .app-header markup outside #app (the
 * .app-version precedent: render() clears #app, so anything persistent
 * lives outside it and is written, not rebuilt). Called from BOTH render()
 * branches (landing and workspace) so the frame is always current.
 *
 * Document identity states, per the spec: "No document selected" /
 * single name / up to three names / "+N ▾" expanding the inline panel.
 * "Open documents" = the working set: the ACTIVE document (bold) first,
 * then the other in-progress documents from the local vault
 * (recentSessions) as quiet one-click switches -- see
 * documentDisplay.ts's doc comment for why (single-active-document
 * domain model).
 */
function syncAppHeader(state: ReturnType<WorkspaceCommandDispatcher["getState"]>): void {
  if (typeof document.querySelector !== "function") return; // fake-DOM guard (verify/ui-smoke.ts)
  const titleHost = document.querySelector<HTMLElement>(".app-document-title");
  const panelHost = document.querySelector<HTMLElement>(".app-document-panel");
  const saveHost = document.querySelector<HTMLElement>(".app-save-status");
  if (!titleHost || !saveHost) return;

  // --- Save status ---
  const save = saveStatusView(state);
  saveHost.textContent = save?.text ?? "";
  saveHost.className = `app-save-status${save?.className ? ` ${save.className}` : ""}`;

  // --- Document identity ---
  titleHost.innerHTML = "";
  const currentName = state.documentLoaded ? state.fileName : null;
  const siblings = recentSessions.filter((s) => s.documentId !== state.documentId);
  if (!currentName) {
    titleHost.appendChild(el("span", { class: "app-document-none" }, "No document selected"));
  } else {
    const names = [currentName, ...siblings.map((s) => s.fileName)];
    const summary = documentDisplaySummary(names);
    summary.shown.forEach((name, index) => {
      if (index > 0) titleHost.appendChild(el("span", { class: "app-document-sep" }, "•"));
      if (index === 0) {
        titleHost.appendChild(el("span", { class: "app-document-current", title: name }, name));
      } else {
        // A sibling name is a one-click switch to that document.
        const sibling = siblings[index - 1]!;
        const b = el("button", { class: "app-document-sibling", title: `Resume ${name}`, type: "button" }, name);
        b.addEventListener("click", () => void handleResumeFromRecent(sibling.documentId));
        titleHost.appendChild(b);
      }
    });
  }
  if (siblings.length > 0 || (!currentName && recentSessions.length > 0)) {
    const overflow = currentName ? documentDisplaySummary([currentName, ...siblings.map((s) => s.fileName)]).overflow : recentSessions.length;
    const expand = el(
      "button",
      { class: "app-document-expand", type: "button", title: "Show all documents", "aria-expanded": String(headerDocPanelOpen) },
      `${overflow > 0 ? `+${overflow} ` : ""}${headerDocPanelOpen ? "▴" : "▾"}`
    );
    expand.addEventListener("click", (event) => {
      event.stopPropagation();
      headerDocPanelOpen = !headerDocPanelOpen;
      syncAppHeader(dispatcher.getState());
    });
    titleHost.appendChild(expand);
  } else {
    headerDocPanelOpen = false;
  }

  // --- Inline document panel ---
  if (panelHost) {
    panelHost.hidden = !headerDocPanelOpen;
    panelHost.innerHTML = "";
    if (headerDocPanelOpen) renderRecentDocuments(panelHost);
  }
}

/**
 * DYNAMIC DEFAULT-PLACEHOLDER PREVIEW (AG, 2026-08-02): "blank = default
 * placeholder" told the reviewer nothing about what the default IS. This
 * previews the EXACT text a blank Redact confirm would produce for the
 * given candidates: the REAL engine (pure/stateless, so a local instance
 * is free), the CURRENT Redaction Rules config, and the CURRENT decisions
 * plus a hypothetical replacement-less Redact on the targets -- so
 * sequential/{n} ordinals are the real ones as of now. (Honest caveat,
 * same as the Rules panel's own preview: sequential ordinals can shift if
 * earlier candidates' decisions change before output generation.)
 * Returns null when nothing is previewable (no document, unknown ids);
 * callers fall back to the old generic wording. Multi-candidate sets with
 * one shared value show it exactly; sequential ranges show "first … last".
 */
const placeholderPreviewEngine = new DeterministicReplacementRuleEngine();
function redactDefaultPreview(candidateIds: readonly string[]): string | null {
  const state = dispatcher.getState();
  const candidates = state.detection?.candidates ?? [];
  if (candidateIds.length === 0 || candidates.length === 0) return null;
  const decisions: Record<string, CandidateDecision> = { ...(state.reviewSession?.candidateDecisions ?? {}) };
  const decidedAt = new Date().toISOString();
  for (const id of candidateIds) {
    decisions[id] = { candidateId: id, decision: "Redact", decidedAt }; // hypothetical: replacement deliberately unset
  }
  const preview = placeholderPreviewEngine.computeReplacements(candidates, decisions, dispatcher.getReplacementRuleConfig());
  const values = candidateIds.map((id) => preview.get(id)).filter((v): v is string => Boolean(v));
  if (values.length === 0) return null;
  const unique = [...new Set(values)];
  if (unique.length === 1) return unique[0]!;
  return `${values[0]} … ${values[values.length - 1]}`;
}

/** The Redact editor's placeholder line, with the live default inlined. */
function redactBlankHint(candidateIds: readonly string[], prefix = "Optional replacement text"): string {
  const preview = redactDefaultPreview(candidateIds);
  return `${prefix} (blank = ${preview ?? "default placeholder"})`;
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
  // RX-22: rendered by ITERATING the display map rather than hand-writing
  // the template string -- a future CandidateDecisionKind cannot be
  // silently omitted from this bar (the map is exhaustive by construction,
  // and this loop shows whatever the map contains).
  stats.appendChild(
    el(
      "span",
      { class: "review-stats-item" },
      (Object.keys(DECISION_DISPLAY_LABEL) as CandidateDecisionKind[])
        .map((kind) => `${DECISION_DISPLAY_LABEL[kind]} ${distribution[kind]}`)
        .join(" · ")
    )
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
/**
 * DIAGNOSTIC SCORING UI (2026-07-30) -- TEMPORARY DEVELOPMENT FEATURE, per
 * Andrew's instruction: "This is not the final UI... an intentionally
 * developer-oriented diagnostic panel that helps us tune the scoring model
 * while using DocScrub on real documents." Expected to disappear or become
 * a hidden developer option once the model is validated.
 *
 * All scoring/diffing/phrasing lives in src/ui/documentScores.ts (pure,
 * suite-covered); this file only holds the two render-to-render slots
 * below and lays the results out. Both slots are UI-presentation memory of
 * the same kind as `lastRenderedFocusedItemId` -- NOT a second copy of any
 * domain state: `lastScoreReport` exists only so consecutive renders can
 * be diffed, and `lastScoreChange` only so the most recent justification
 * stays visible through renders where nothing score-relevant changed
 * (autosave ticks, panel toggles) instead of flickering away. Scores
 * themselves are recomputed fresh from WorkspaceState every render, never
 * read from these slots.
 */
let lastScoreReport: DocumentScoreReport | null = null;
let lastScoreChange: ScoreChange | null = null;

/** Renders the diagnostic text area + flush-right score labels into the
 *  stage-tab row (see render()'s `.stage-tab-row`). Plain labels with
 *  percentages -- no gauges, donuts, new colors, or large type, per the
 *  instruction. */
/** APPLICATION FRAME REFINEMENT (AG, 2026-08-01): score -> status-color
 *  band. Thresholds are a first-guess judgment call (like the score
 *  formulas themselves, declared revisable in the diagnostic-scoring
 *  findings): < 40 low (muted red), 40–79 in progress (muted amber),
 *  >= 80 approaching/at completion (muted green). Existing palette hues
 *  only -- "subtle and professional, not saturated or dashboard-like." */
function scoreStatusClass(value: number): string {
  if (value >= 80) return "score-high";
  if (value >= 40) return "score-mid";
  return "score-low";
}

/**
 * APPLICATION FRAME REFINEMENT (AG, 2026-08-01): the three document
 * scores promoted from small flush-right text beside the stage tabs to a
 * dedicated Review Status strip -- "prominent application status ...
 * core concepts of DocScrub", immediately beneath the document name and
 * above the stage tabs, answering extraction health / remaining review /
 * overall readiness at a glance. Supersedes renderScoreDiagnostics'
 * placement; the score computation, change tracking, and the
 * plain-language "why did the score change" text (still a deliberately
 * TEMPORARY dev feature -- see the diagnostic-scoring findings doc) are
 * unchanged, the explanation now riding quietly at the strip's right.
 */
function renderReviewStatus(container: HTMLElement, state: ReturnType<WorkspaceCommandDispatcher["getState"]>): void {
  const doc = workspace.getDocument();
  if (!doc || !state.documentLoaded) return;

  const report = computeDocumentScores({
    documentId: doc.documentId,
    extraction: doc,
    stageStatuses: state.stageStatuses,
    readiness: state.readiness,
  });
  if (lastScoreReport && lastScoreReport.documentId !== report.documentId) {
    // A different document is not a score "change" -- start clean.
    lastScoreChange = null;
  } else if (lastScoreReport) {
    const change = explainScoreChange(lastScoreReport, report);
    if (change) lastScoreChange = change;
  }
  lastScoreReport = report;

  const strip = el("div", { class: "review-status" });
  const scores: [string, number][] = [
    ["Extraction", report.extraction],
    ["Review", report.review],
    ["Overall", report.overall],
  ];
  for (const [label, value] of scores) {
    const item = el("div", { class: "review-status-item" });
    item.appendChild(el("span", { class: "review-status-label" }, label));
    item.appendChild(el("span", { class: `review-status-value ${scoreStatusClass(value)}` }, `${Math.round(value)}%`));
    strip.appendChild(item);
  }

  // DECISION REDUCTION (AG, 2026-08-03) -- A RUNNING TALLY OF COMPLETED
  // WORK, presented as the DECISION TRACKER panel (see
  // renderDecisionTracker).
  renderDecisionTracker(strip, state);

  const diagnostic = el("div", { class: "review-status-diagnostic" });
  if (lastScoreChange) diagnostic.textContent = formatScoreChange(lastScoreChange);
  strip.appendChild(diagnostic);
  container.appendChild(strip);
}

/**
 * DECISION TRACKER (AG, 2026-08-03) -- "one of the defining visual
 * elements of DocScrub," and a permanent Review Workspace feature.
 *
 *     Decision Tracker
 *     43        405        91%
 *     Made    Avoided     Fewer
 *
 * PURELY A PRESENTATION LAYER. Every figure comes from
 * metrics/decisionTracker.ts, which composes the shared occurrence
 * coverage (metrics/decisionReduction.ts -- unchanged, and still what
 * every LOCAL equation uses) with the human-effort count derived from the
 * review event log. This function renders; it calculates nothing.
 *
 *     Made    = human decisions actually made -- "treat all this way" is
 *               ONE decision even across nine items
 *     Avoided = the occurrence reviews the reviewer never had to perform,
 *               including the eight items a category action swept up
 *     Fewer   = Avoided as a share of the occurrences covered
 *
 * `Made + Avoided = covered occurrences`, so the panel cannot contradict
 * itself: every occurrence in the completed work is either something the
 * reviewer decided or something they didn't have to. Asserted in the
 * suite.
 *
 * THE COUNTING RULE THAT MATTERS: a decision counts when it NEWLY
 * resolved something still resolved now. Changing your mind about an item
 * you already decided does not advance Made -- an earlier build let it,
 * which was a real defect (a tracker that climbs when no new work
 * happened). See decisionTracker.ts for how the event-log walk gets this,
 * and reversals, for free.
 *
 * SCOPED TO COMPLETED WORK, via the shared resolution partition in
 * engines/review/coverage.ts -- the same rule the stage tabs, the work
 * queue and the navigator use, so the tracker moves at the exact moment
 * the rest of the app agrees an item is done.
 *
 * NO STATUS BAND (scoreStatusClass), unlike the three metrics beside it. A
 * band asserts "low / getting there / good," which is a claim about
 * completion. Fewer is near its final value from the first decision
 * onward; coloring it like a progress metric is the confusion the seam
 * exists to prevent. And no suppression: the panel holds its position and
 * reads an honest `0 / 0 / 0%` on a fresh document, which is also the
 * baseline that makes the first decision visibly move it.
 */
/** Whether the time-saved explanation is currently expanded. UI-presentation
 *  memory of the same kind as `lastRenderedFocusedItemId` -- not domain
 *  state, deliberately not persisted: a disclosure the reviewer opened to
 *  satisfy a doubt should not follow them into the next session. */
let timeSavedExplanationOpen = false;

/** The "i" affordance. A real <button>, so Tab reaches it and Space/Enter
 *  work with no key handling of our own -- the same reasoning the row
 *  checkbox relies on (see the region model's universal escape rung). The
 *  glyph is inline SVG rather than a text "i" so it stays a circle at any
 *  font size and carries no dependency. */
function timeSavedInfoControl(): HTMLElement {
  const control = button("", () => {
    timeSavedExplanationOpen = !timeSavedExplanationOpen;
    render();
  });
  control.className = "decision-tracker-info";
  control.setAttribute("aria-expanded", timeSavedExplanationOpen ? "true" : "false");
  control.setAttribute("aria-label", timeSavedExplanationOpen ? "Hide how this estimate is calculated" : "How is this estimated?");
  control.title = "How is this estimated?";
  control.innerHTML =
    '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" focusable="false">' +
    '<circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.4"/>' +
    '<circle cx="8" cy="4.6" r="0.95" fill="currentColor"/>' +
    '<path d="M8 7.1v5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
    "</svg>";
  return control;
}

function renderDecisionTracker(strip: HTMLElement, state: ReturnType<WorkspaceCommandDispatcher["getState"]>): void {
  const session = state.reviewSession;
  const resolved = session && state.detection ? partitionCandidatesByResolution(session, state.detection).resolved : [];
  const tracker = decisionTrackerFigures(session, resolved);

  const panel = el("div", { class: "decision-tracker" });
  panel.appendChild(el("div", { class: "decision-tracker-title" }, "Decision Tracker"));
  const row = el("div", { class: "decision-tracker-row" });
  const cells: [string, string][] = [
    ["Made", tracker.decisionsMade.toLocaleString()],
    ["Avoided", tracker.avoidedDecisionCount.toLocaleString()],
    ["Fewer", formatFewerDecisionsPercent(tracker)],
  ];
  for (const [label, value] of cells) {
    const cell = el("div", { class: "decision-tracker-cell" });
    cell.appendChild(el("span", { class: "decision-tracker-value" }, value));
    cell.appendChild(el("span", { class: "decision-tracker-label" }, label));
    row.appendChild(cell);
  }
  // TIME SAVED (AG, 2026-08-03): the fourth figure, laid out differently on
  // purpose -- number at the same size as the others, with its phrase
  // vertically centred to the right and free to wrap to two lines, rather
  // than a value stacked over a one-word label. The different shape is
  // itself the signal: this is the one MODELED number in a panel of exact
  // counts, and it should not read as a fourth measurement.
  //
  // Absent entirely until it can be honest -- estimateTimeSaved returns
  // null with too few observed individual decisions, or nothing avoided
  // yet, and a blank is better than a fabricated first number.
  if (tracker.timeSaved) {
    const saved = el("div", { class: "decision-tracker-cell decision-tracker-time" });
    saved.appendChild(el("span", { class: "decision-tracker-value" }, tracker.timeSaved.display));
    saved.appendChild(el("span", { class: "decision-tracker-time-label" }, tracker.timeSaved.label));
    saved.appendChild(timeSavedInfoControl());
    row.appendChild(saved);
  }
  panel.appendChild(row);
  // The explanation opens BENEATH the panel rather than floating over it:
  // no positioning maths, no layer that can trap focus, and nothing that
  // covers the metrics the reviewer was reading. A plain disclosure that
  // pushes the chrome down slightly is the calmest thing available here.
  if (timeSavedExplanationOpen && tracker.timeSaved) {
    const note = el("div", { class: "decision-tracker-note" });
    for (const paragraph of explainTimeSaved(tracker.timeSaved)) note.appendChild(el("p", {}, paragraph));
    panel.appendChild(note);
  }
  // One sentence for the whole panel rather than a tooltip per figure --
  // the three numbers describe one thing, and reading them apart is what
  // the panel exists to stop.
  const description = `${tracker.decisionsMade.toLocaleString()} decisions made, avoiding ${tracker.avoidedDecisionCount.toLocaleString()} repetitive occurrence reviews -- ${formatFewerDecisionsPercent(tracker)} fewer. ${REDUCTION_DESCRIPTION}`;
  panel.title = description;
  panel.setAttribute("aria-label", `Decision Tracker: ${description}`);
  strip.appendChild(panel);
}

/**
 * LOCAL DECISION REDUCTION (AG, 2026-08-03) -- the local half of the same
 * metric the review-status strip shows globally: `23 / 418 = 395 decisions
 * avoided`, reviewer workload first.
 *
 * SCOPED TO WHAT REMAINS, per Andrew's original wording: "the equation
 * intentionally begins with the actual remaining decisions, because that
 * is the number the reviewer owns." So a local figure shrinks as its
 * surface gets worked, and disappears entirely once the surface is
 * finished (the module's suppression rule catches the empty scope) --
 * which is also what keeps a completed section visually quiet.
 *
 * CALLERS PASS THE REMAINING IDS THEMSELVES rather than this filtering
 * them, deliberately. Each surface already computes and DISPLAYS its own
 * remaining count beside where the figure lands, and the two numbers on
 * one line must agree. The sectioned queue counts remaining by direct
 * candidate decision; Type Check counts by isItemResolvedInState (which
 * also honors group coverage). Applying one rule here would have made the
 * equation contradict the "N remaining" sitting next to it on at least one
 * surface.
 *
 * THREE functions, and no fourth anywhere in this file, so that every
 * surface asks the question the same way:
 *
 *   candidateUnits()          -- the adapter for surfaces whose review
 *                                unit IS a candidate (Item Check,
 *                                Ambiguity Check, Type Check). `Candidate`
 *                                satisfies `ReviewUnit` structurally, so
 *                                this is a lookup, not a conversion.
 *   appendReductionFigure()   -- the renderer, over ANY units. Group Check
 *                                passes merged group units through it; a
 *                                future Selection Inspector grouping
 *                                passes its own summarized set. Neither
 *                                needs a new renderer, which is the point.
 *   appendCandidateReduction()-- the two composed, for the common case.
 *
 * Suppression lives in the module (shouldDisplayReduction), not here, so a
 * new call site cannot forget it: a scope with nothing to report renders
 * NOTHING rather than a truthful-but-useless "1 / 1 = 0 decisions avoided"
 * repeated down a list.
 *
 * SCOPES DO NOT SUM. The same candidate is counted inside a Group Check
 * merged unit, inside its Type Check type, and inside its Item Check
 * section. Each figure is true about its own surface; none of them are
 * parts of a whole, and nothing here totals them or presents them
 * adjacently in a way that would invite adding them up.
 */
function candidateUnits(candidateIds: readonly string[], state: ReturnType<WorkspaceCommandDispatcher["getState"]>): ReviewUnit[] {
  const wanted = new Set(candidateIds);
  return (state.detection?.candidates ?? []).filter((candidate) => wanted.has(candidate.id));
}

function appendReductionFigure(host: HTMLElement, units: readonly ReviewUnit[]): void {
  const reduction = decisionReduction(units);
  if (!shouldDisplayReduction(reduction)) return;
  const figure = el("span", { class: "reduction-figure" }, formatReductionEquation(reduction));
  figure.title = REDUCTION_DESCRIPTION;
  host.appendChild(figure);
}

/** `remainingCandidateIds` -- the UNRESOLVED members of this surface's
 *  scope, by whatever rule the surface itself displays. See the block
 *  comment above for why the filtering is the caller's. */
function appendCandidateReduction(
  host: HTMLElement,
  remainingCandidateIds: readonly string[],
  state: ReturnType<WorkspaceCommandDispatcher["getState"]>
): void {
  appendReductionFigure(host, candidateUnits(remainingCandidateIds, state));
}

function renderStageTabs(container: HTMLElement, activeStage: WorkflowStage, statuses: ReturnType<WorkspaceCommandDispatcher["getState"]>["stageStatuses"]): void {
  const tabs = el("div", { class: "stage-tabs" });
  // CONDITIONAL WORKFLOW (AG, Phase 2, 2026-08-02): only stages in the
  // ACTIVE workflow render a tab at all -- "If a stage contains no
  // reviewable work, hide it entirely from the visible workflow" -- via
  // the SAME isStageActive rule Shift+←/→ traversal and the navigator's
  // reconcile use (navigation/workflow.ts: one derivation feeds tabs,
  // traversal, progress, focus). The stage focus currently sits on is
  // always shown even mid-transition (reconcile relocates focus off a
  // just-completed stage on the next dispatch; until then its tab
  // vanishing under the highlight would be disorienting).
  //
  // The ⇧n keycap that used to render per tab is REMOVED WITH its
  // Shift+digit binding (not just unadvertised): stage shortcuts are now
  // relative (⇧←/⇧→ over the active list), deliberately avoiding
  // "long-term coupling between shortcut numbers and workflow order" --
  // numbered shortcuts could not have survived a variable stage list.
  // Tabs remain directly clickable, per the same authorization.
  statuses
    // A FINISHED STAGE STAYS ON SCREEN (AG, 2026-08-03, live: "Ambiguity
    // Check just vanished when I finished it. That's going to be a problem
    // if someone wants to go back").
    //
    // `isStageActive` means "still has outstanding work," and using it as
    // the visibility rule conflated two different questions. A stage this
    // document never had any work for should indeed never appear -- that is
    // the conditional-workflow behavior, and it stays. But a stage the
    // reviewer just FINISHED disappearing is a different thing entirely:
    // it deletes the evidence of their own work at the moment they complete
    // it, and removes the only way back to a decision they may want to
    // revisit.
    //
    // So visibility asks "does this document have work of this kind at
    // all" (`total > 0`), while `isStageActive` keeps its existing meaning
    // untouched -- it still decides traversal and where focus reconciles
    // to, so finishing a stage still carries the reviewer onward rather
    // than parking them on completed work.
    .filter((status) => isStageActive(status) || status.stage === activeStage || status.itemCount + status.artifactCount > 0)
    .forEach((status) => {
      // ALL REMAINING WORK (AG, 2026-08-02): the count reads over BOTH
      // axes -- traversable items and review artifacts (structural
      // proposals) -- because the tab's job is to say how much is left
      // here, and the same sum decides whether this tab renders at all
      // (isStageActive). Showing only items produced the contradiction
      // that a tab could read "(0/1)" while still being active. The
      // condition is now "does this stage hold work of any kind", so a
      // stage whose only work is a proposal gets a count instead of a
      // bare label.
      const outstanding = status.unresolvedCount + status.unresolvedArtifactCount;
      const total = status.itemCount + status.artifactCount;
      // COUNT COMPLETED, NOT REMAINING (AG, 2026-08-03, live: "it's weird,
      // feels like 2/50 means I have a long way to go").
      //
      // The tab used to print `outstanding/total`, which inverted its own
      // meaning at both ends of the range. "(2/50)" was 48 items DONE with
      // 2 left -- the reviewer's best moment, rendered as their worst --
      // while "(14/14)" meant nothing had been reviewed at all, on the one
      // reading a full fraction cannot survive: a filled bar means
      // finished, everywhere, to everyone.
      //
      // `outstanding` is still what decides whether the tab renders
      // (isStageActive, unchanged) -- only the reading changed, from work
      // owed to work done. That also puts the tab in the same voice as the
      // section headings underneath it, which already lead with progress
      // ("8 complete • 0 remaining") rather than debt.
      const completed = total - outstanding;
      // THE CHECK REPLACES THE FRACTION (AG, 2026-08-03: "there should be a
      // check mark that replaces the fraction"). This is the app's existing
      // completion glyph, not a new one -- "a simple circled check mark,
      // not an entire explanatory pill … one glyph everywhere: candidate
      // rows, group rows, member rows, result cells" (2026-07-30). The
      // stage tab joins that family. "(50/50)" still asks the reviewer to
      // compare two numbers to learn something a single mark states.
      const complete = total > 0 && outstanding === 0;
      const label = complete ? `✓ ${STAGE_LABELS[status.stage]}` : `${STAGE_LABELS[status.stage]}${total > 0 ? ` (${completed}/${total})` : ""}`;
      const isActive = status.stage === activeStage;
      const tab = el("button", { class: isActive ? "tab tab-active" : "tab", type: "button" });
      // Green is the app's completion hue everywhere else (section
      // headings, done rows); a finished tab wears the same one rather
      // than inventing a "done tab" treatment. Applied ALONGSIDE
      // tab-active, so the stage you are standing in still reads as
      // selected while also reading as finished.
      if (complete) tab.classList.add("tab-complete");
      tab.appendChild(el("span", {}, label));
      tab.addEventListener("click", () => {
        dispatcher.dispatchNavigation({ family: "navigation", type: "focusStage", stage: status.stage });
        render();
      });
      // Deliberately NOT disabled -- an empty/not-yet-relevant stage is still
      // freely switchable (non-linear workspace tabs, not a wizard); the
      // title only informs, it never gates.
      // The tooltip has to tell the two zero-states apart now that both can
      // render: a finished stage and a not-yet-relevant one would otherwise
      // share the wrong sentence.
      if (complete) tab.title = `Every item here is reviewed — still open, and every decision is still changeable`;
      else if (!status.available) tab.title = "Nothing to review here yet";
      tabs.appendChild(tab);
    });
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
function decisionButtons(candidateId: string, stage: WorkflowStage, container: HTMLElement, currentDecision?: CandidateDecisionKind): void {
  // ACTION LABELS (AG, 2026-08-03): every clickable decision reads as a
  // document outcome -- "Keep as-is" says the button leaves the document
  // unchanged, which is the decision actually being made. Sourced from
  // DECISION_ACTION_LABEL so a wording change lands everywhere at once;
  // state readouts keep the noun form (see decisionLabels.ts).
  const keepBtn = button(decisionActionLabel("Keep"), () => decideAndAdvance({ family: "review", type: "keepCandidate", candidateId }, candidateId, stage));
  container.appendChild(keepBtn);

  // RELABELED (2026-07-29, interaction model revision): "Rename" -> "Change"
  // (key C, not N) -- Andrew's own reasoning, "allows the first letter of
  // the word to be the command." Display-only; the underlying decision
  // string stays "Rename" (CandidateDecisionKind, renameCandidate) -- see
  // keymap.ts's top doc comment for why that vocabulary is deliberately
  // left alone.
  const renameEditing = isEditingCandidate(candidateId, stage, "Rename");
  const renameBtn = button(decisionActionLabel("Rename"), () => openInlineEditor({ scope: "candidate", stage, candidateId, action: "Rename" }));
  renameBtn.classList.toggle("action-editing", renameEditing);
  container.appendChild(renameBtn);

  const redactEditing = isEditingCandidate(candidateId, stage, "Redact");
  const redactBtn = button(decisionActionLabel("Redact"), () => openInlineEditor({ scope: "candidate", stage, candidateId, action: "Redact" }));
  redactBtn.classList.toggle("action-editing", redactEditing);
  container.appendChild(redactBtn);

  const ignoreBtn = button(decisionActionLabel("Ignore"), () => decideAndAdvance({ family: "review", type: "ignoreCandidate", candidateId }, candidateId, stage));
  container.appendChild(ignoreBtn);

  // 2026-07-30 feature spec: processed rows carry the full color tier --
  // pale row background (renderCandidateStage), saturated buttons, and the
  // HIGHLY saturated treatment on the button that was selected -- the same
  // `group-action-active` scheme Group Check's rows already use, applied
  // to the candidate rows for one vocabulary everywhere.
  //
  // PENDING-DECISION PREVIEW (AG, 2026-07-30): while a Change/Redact
  // editor is open, the reviewer is "in a different experience, moving
  // towards a different outcome" -- the EDITING action's button takes the
  // solid emphasis immediately (and the committed decision's emphasis is
  // suppressed for the duration, so exactly one button ever reads as "the
  // outcome you are heading for"). Cancel closes the editor and the very
  // next render restores the committed decision's colors -- the preview is
  // pure derived state, nothing to undo.
  const pendingAction: CandidateDecisionKind | null = renameEditing ? "Rename" : redactEditing ? "Redact" : null;
  const byDecision: Record<CandidateDecisionKind, HTMLButtonElement> = { Keep: keepBtn, Rename: renameBtn, Redact: redactBtn, Ignore: ignoreBtn };
  if (pendingAction) {
    byDecision[pendingAction].classList.add("group-action-active", decisionClass(pendingAction));
  } else if (currentDecision) {
    byDecision[currentDecision].classList.add("group-action-active", decisionClass(currentDecision));
  }

  if (renameEditing) renderInlineEditor(container, "Replacement text (required)");
  if (redactEditing) renderInlineEditor(container, redactBlankHint([candidateId]));
}

/** PENDING-DECISION PREVIEW helper: which decision an OPEN editor is
 *  heading toward, for a given editing-state pair -- null when no editor
 *  is open (the committed decision's colors then apply as usual). */
function pendingDecisionOf(renameEditing: boolean, redactEditing: boolean): CandidateDecisionKind | null {
  return renameEditing ? "Rename" : redactEditing ? "Redact" : null;
}

/** The reviewer-visible list for `stage`, in displayed order -- the
 *  snapshot dispatchReviewWithVisibleAdvance() captures BEFORE dispatching.
 *  item-check: search/sort/filter (+ Category Check narrowing) via
 *  visibleItemCheckIds(); group-check: the active sort via
 *  visibleGroupIds(); ambiguity-check: the SECTION-grouped queue order
 *  via visibleAmbiguityIds() (AMBIGUITY CATEGORY-FIRST, AG 2026-08-02 --
 *  before that refactor the raw proposal order WAS the displayed order).
 *  qa/output have no item list. */
function snapshotVisibleIdsForStage(stage: WorkflowStage, state: ReturnType<WorkspaceCommandDispatcher["getState"]>): string[] | null {
  switch (stage) {
    case "item-check":
      return visibleItemCheckIds(state);
    case "group-check":
      return visibleGroupIds(state);
    case "ambiguity-check":
      return visibleAmbiguityIds(state);
    case "type-check":
      // PHASE 2: the displayed order IS the structural order (populated
      // types in SEMANTIC_TYPE_ORDER -- no sort/filter layer exists), so
      // the visible-advance interception is a provable no-op here; the
      // list is still returned so the choke point's resolved-item
      // re-selection logic treats type items uniformly.
      return (state.semanticTypes ?? []).map((g) => g.typeId);
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
  // Phase 2: semanticTypes included so type-check items resolve by the
  // same context the domain navigator itself reads -- omitting it would
  // make every type read "resolved" here (unknown type id) and break the
  // visible-order advance on the Type Check stage.
  return isItemResolved(
    stage,
    itemId,
    { detection: state.detection, grouping: state.grouping, ...(state.semanticTypes ? { semanticTypes: state.semanticTypes } : {}) },
    state.reviewSession
  );
}

/**
 * ROWS-THEN-CARDS SEAM, half 1 (AG, 2026-08-02, live: "Residency was the
 * last unresolved row; clicking its ② chip applied Ignore but focus stayed
 * put ... while three 'Possible acronym' cards below still needed
 * review"). The first structural card still needing attention, in
 * DISPLAYED order -- the continuation target when the row half of a
 * sectioned-queue stage runs out of unresolved work.
 *
 * Derived from STATE, never from the rendered tree's
 * `relationship-card-addressed` class: the advance runs BEFORE the render
 * that would carry the fresh classes, so a DOM read here would answer from
 * the previous frame (the exact staleness `advanceStructuralCursor` avoids
 * by running AFTER its caller's render()). "Unaddressed" is the same
 * predicate the renderer's own `addressed` flag uses -- every member
 * carries a decision -- so heading counts, card green, and this agree by
 * construction.
 *
 * Two filters mirror the renderer exactly, so this can never point at a
 * card that isn't on screen: dismissed proposals are excluded
 * (relationshipDismissals -- renderStructuralRelationships drops them), and
 * so are proposals whose members are absent from detection (the renderer's
 * `if (members.length === 0) continue`).
 */
function firstUnaddressedStructuralCardId(state: ReturnType<WorkspaceCommandDispatcher["getState"]>): string | null {
  const dismissals = state.reviewSession?.relationshipDismissals ?? {};
  const decisions = state.reviewSession?.candidateDecisions ?? {};
  const candidates = state.detection?.candidates ?? [];
  const active = (state.structuralRelationships?.proposals ?? []).filter(
    (proposal) => !dismissals[proposal.proposalId] && proposal.candidateIds.some((id) => candidates.some((c) => c.id === id))
  );
  const unaddressed = structuralCardDisplayOrder(active).find((proposal) => !proposal.candidateIds.every((id) => Boolean(decisions[id])));
  return unaddressed?.proposalId ?? null;
}

/**
 * ROWS-THEN-CARDS SEAM, half 2: the shared continuation. Called by the two
 * row-advance paths (the post-decision choke point below and
 * runSectionAction) at the moment they find NO unresolved row left --
 * previously a dead end, now the boundary the arrow keys already cross
 * (forward past the last row enters the first card; see the sectioned-queue
 * arrows branch of the keydown pipeline). Returns true when the cursor
 * moved onto a card, so callers can skip their row-re-selection.
 *
 * Deliberately inert when a card ALREADY holds the cursor: that means the
 * reviewer is working the card half, where `advanceStructuralCursor` owns
 * the advance (forward-from-current, then backward -- a strictly better
 * answer than "first unaddressed"). Without this guard every card decision
 * would take both advances and briefly expand the wrong card between the
 * two renders. Also inert off the sectioned-queue stages, where no cards
 * render at all.
 *
 * DETERMINISTIC-RENDER: this sets the cursor only. The caller renders
 * afterwards, once, with the cursor already in place -- so the card is
 * born selected+expanded and render()'s pendingCardId tail supplies DOM
 * focus. (Contrast advanceStructuralCursor, which runs after its caller's
 * render and therefore must render a second time.)
 */
function continueIntoStructuralCards(state: ReturnType<WorkspaceCommandDispatcher["getState"]>): boolean {
  if (structuralCardFocusPending !== null) return false;
  if (!sectionedQueueStage(state.focus?.target.stage)) return false;
  const proposalId = firstUnaddressedStructuralCardId(state);
  if (!proposalId) return false;
  structuralCardFocusPending = proposalId;
  return true;
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
 * render() exactly once, after this returns (two dispatches, one render).
 */
function dispatchReviewWithVisibleAdvance(command: ReviewCommand): ReviewTransactionResult {
  const before = dispatcher.getState();
  // DECISION PROVENANCE, Pass 1 (AG, 2026-08-03): stamp the scope the
  // reviewer was WORKING IN onto the commands that carry the optional
  // field (Commands.ts) -- here, at the one choke point every decision
  // path already routes through, so no caller needs to know about it.
  // "Working in", not "applied to": the command's own candidateId(s)
  // record the applied set; this records the reviewing context (item
  // scope vs selection vs remainder vs a card). Item Check only in Pass 1
  // (currentReviewScope resolves nothing elsewhere), and never overwrites
  // a stamp a future caller chose to set itself.
  if (
    (command.type === "keepCandidate" ||
      command.type === "renameCandidate" ||
      command.type === "redactCandidate" ||
      command.type === "ignoreCandidate" ||
      command.type === "bulkApplyDecision") &&
    command.scope === undefined
  ) {
    const scope = currentReviewScope(before);
    if (scope) command = { ...command, scope: scopeDescriptor(scope) };
  }
  const preTarget = before.focus?.target ?? null;
  const stage = preTarget?.stage ?? null;
  const preItemId = preTarget?.itemId ?? null;
  const visibleIds = stage !== null && preItemId !== null ? snapshotVisibleIdsForStage(stage, before) : null;

  const result = dispatcher.dispatchReview(command);
  if (!result.ok || stage === null || preItemId === null || visibleIds === null) return result;

  const after = dispatcher.getState();
  if (after.focus?.target.panel.kind === "not-quite") return result;
  if (!isItemResolvedInState(stage, preItemId, after)) return result;

  // null = every visible ROW is resolved. ROWS-THEN-CARDS SEAM (AG,
  // 2026-08-02): before treating that as the end of the queue, continue
  // into the collection's card half -- rows and cards are one displayed
  // collection on the sectioned-queue stages, and stopping at the last row
  // stranded the reviewer with unreviewed cards still on screen. The row
  // cursor deliberately stays parked on the just-decided item (it is still
  // a valid, visible selection, and the domain's focus model has no notion
  // of a card); the CARD cursor becomes the working object, which is what
  // the detail expansion, the decision letters, ⇧A, and -- since this same
  // pass -- scrollFocusedRowIntoView all follow.
  const target = advanceWithinVisibleList(preItemId, visibleIds, (id) => isItemResolvedInState(stage, id, after));
  if (target === null && continueIntoStructuralCards(after)) return result;
  // No card to continue into: REMAIN on the item just decided (re-selecting
  // it if reconcile() wandered off to a structurally-adjacent but
  // currently-hidden unresolved item -- focus must never land on a row the
  // reviewer cannot see).
  const landing = target ?? preItemId;
  if (landing !== after.focus?.target.itemId) {
    dispatcher.dispatchNavigation({ family: "navigation", type: "selectItem", itemId: landing });
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

/**
 * SPLIT REVIEW MODE (AG, 2026-08-02, "Separate These"): incorrect
 * grouping as a first-class review action. "① Separate these" enters a
 * TEMPORARY, fully-buffered split session: the group row suspends
 * (greyed, actions disabled), each member becomes an independent
 * K/C/R/I review row, and choices accumulate in `splitReview.choices` --
 * NOTHING is dispatched until every member has a choice. That buffering
 * is what makes the spec's Esc contract real: "discard the temporary
 * split session... return the UI to exactly its previous state" is
 * trivially true because no command ever ran. On completion the buffer
 * REPLAYS through the existing Fix this command sequence (enterNotQuite
 * -> applyNotQuiteMember per member -> completeNotQuite) -- the domain's
 * own member-by-member vocabulary, byte-identical audit to a manual Fix
 * this session, zero new commands (rejectGroup was deliberately removed
 * in the v9 terminology revision, and decisions are single-current-value
 * with no un-decide -- buffering is the only path to a true no-commit
 * cancel). The completed group leaves the Group Check list for this
 * session (`separatedGroupIds`, a visibleGroupIds filter); after a
 * reload it reappears as an ordinary resolved (Refined) group -- the
 * durable state is exactly a completed Fix this, disclosed in
 * design-notes.
 */
let splitReview: {
  groupId: string;
  choices: Map<string, { action: CandidateDecisionKind; replacement?: string }>;
  /** The member the highlight sits on and the letters act on. Set to the
   *  FIRST member on entry (AG, live feedback: "once you select
   *  'Separate these' the focus should automatically move to the first
   *  item -- you need to immediately review them"), moved by Up/Down,
   *  auto-advanced to the next unchosen member after each choice. */
  cursorId: string | null;
} | null = null;
/** Groups dissolved via a COMPLETED split this session -- hidden from
 *  Group Check ("the original group disappears"). Ephemeral by design. */
const separatedGroupIds = new Set<string>();

/** The member the split session's keyboard letters act on: the cursor
 *  when it still points at a group member, else the first member without
 *  a buffered choice. */
function splitActiveMemberId(group: EntityGroupProposal): string | null {
  if (!splitReview || splitReview.groupId !== group.groupId) return null;
  if (splitReview.cursorId && group.candidateIds.includes(splitReview.cursorId)) return splitReview.cursorId;
  return group.candidateIds.find((id) => !splitReview!.choices.has(id)) ?? null;
}

/** Moves the split cursor sequentially over ALL members (chosen ones
 *  included -- revisiting overwrites the buffered choice); no wrap at
 *  the edges, this app's universal rule. */
function moveSplitCursor(group: EntityGroupProposal, delta: number): void {
  if (!splitReview || splitReview.groupId !== group.groupId) return;
  const current = splitActiveMemberId(group);
  const idx = current ? group.candidateIds.indexOf(current) : -1;
  const next = idx === -1 ? 0 : Math.min(group.candidateIds.length - 1, Math.max(0, idx + delta));
  splitReview.cursorId = group.candidateIds[next] ?? null;
  render();
}

function startSplitReview(group: EntityGroupProposal): void {
  splitReview = { groupId: group.groupId, choices: new Map(), cursorId: group.candidateIds[0] ?? null };
  if (dispatcher.getState().focus?.target.itemId !== group.groupId) {
    dispatcher.dispatchNavigation({ family: "navigation", type: "selectItem", itemId: group.groupId });
  }
  setStatus("Split review: decide each member independently. Esc cancels and restores the group."); // RX-18
  render();
}

function cancelSplitReview(): void {
  if (!splitReview) return;
  if (inlineEditor?.scope === "split-member") inlineEditor = null;
  splitReview = null;
  setStatus("Split review cancelled — group restored."); // RX-18
  render();
}

function recordSplitChoice(group: EntityGroupProposal, candidateId: string, action: CandidateDecisionKind, replacement?: string): void {
  if (!splitReview || splitReview.groupId !== group.groupId) return;
  splitReview.choices.set(candidateId, { action, ...(replacement !== undefined ? { replacement } : {}) });
  if (group.candidateIds.every((id) => splitReview!.choices.has(id))) {
    completeSplitReview(group);
    return;
  }
  // Auto-advance the cursor to the next unchosen member (forward from the
  // one just decided, wrapping to the topmost unchosen -- the bounded
  // on-screen-set precedent Fix this member advance established).
  const fromIdx = group.candidateIds.indexOf(candidateId);
  const ordered = [...group.candidateIds.slice(fromIdx + 1), ...group.candidateIds.slice(0, fromIdx + 1)];
  splitReview.cursorId = ordered.find((id) => !splitReview!.choices.has(id)) ?? null;
  render();
}

function completeSplitReview(group: EntityGroupProposal): void {
  const choices = splitReview?.choices;
  splitReview = null;
  if (!choices) return;
  // Replay through the EXISTING member-by-member vocabulary -- see this
  // block's top doc comment. Order matters: the panel must be open for
  // the member applications, and completeNotQuite (via the visible-order
  // advance choke point) both stamps the group Refined and moves focus on
  // in DISPLAYED order while the group is still in the pre-filter list.
  dispatcher.dispatchReview({ family: "review", type: "enterNotQuite", groupId: group.groupId });
  for (const [candidateId, choice] of choices) {
    dispatcher.dispatchReview({
      family: "review",
      type: "applyNotQuiteMember",
      groupId: group.groupId,
      candidateId,
      action: choice.action,
      ...(choice.replacement !== undefined ? { draftReplacement: choice.replacement } : {}),
    });
  }
  // The pre-hide order, captured BEFORE the group leaves the list -- the
  // only place the separated group's position is still knowable.
  const orderBefore = visibleGroupIds(dispatcher.getState());
  dispatchReviewWithVisibleAdvance({ family: "review", type: "completeNotQuite", groupId: group.groupId });
  separatedGroupIds.add(group.groupId);
  reanchorFocusAfterSeparation(group.groupId, orderBefore);
  setStatus("Group separated — every member reviewed individually."); // RX-18
  render();
}

/**
 * FOCUS SURVIVES THE SEPARATION (AG, 2026-08-03, live: "when I 'separate
 * all' on the Group Check and then use Ignore on both separate items, the
 * nav does not auto-advance me to the next item. Instead, there is no
 * focused item at all").
 *
 * THE MECHANISM. `completeSplitReview` runs the advance choke point and
 * THEN hides the group (`separatedGroupIds`), and that order is correct and
 * documented: the choke point anchors its search on the item being decided,
 * so the group has to still be in the visible list for "what comes after
 * it" to have an answer. But the choke point's LAST RESORT, when every
 * visible row is already resolved, is to remain on the item just decided --
 * a rule written for rows that stay on screen. Here the anchor is about to
 * vanish, so focus was left pointing at a group that no longer renders:
 * not "no advance," but a cursor on an invisible row, which is exactly what
 * "there is no focused item at all" looks like.
 *
 * Separation is the only action in the app that removes a row from the
 * reviewer's view as a side effect of deciding it, so it owns the repair
 * rather than the choke point learning about a case unique to one caller.
 *
 * WHERE IT LANDS. `advanceWithinVisibleList` against the post-hide list,
 * anchored on the separated group's PREDECESSOR -- so the reviewer
 * continues from where the group was, not from the top of the list. Its
 * existing semantics do the rest (forward first, then backward, no wrap).
 * If nothing unresolved remains, focus takes the nearest still-visible
 * group anyway: a resolved-but-visible cursor is a place to stand and can
 * be navigated from, which an invisible one cannot. If Group Check has no
 * visible groups left at all, focus is left alone -- the stage is finished,
 * its tab now reads ✓, and the domain's own reconcile moves focus onward on
 * the next dispatch.
 */
function reanchorFocusAfterSeparation(separatedGroupId: string, orderBefore: readonly string[]): void {
  const state = dispatcher.getState();
  const target = state.focus?.target;
  if (target?.stage !== "group-check" || target.itemId !== separatedGroupId) return; // focus already moved somewhere real
  const remaining = visibleGroupIds(state); // the separated group is gone from this
  if (remaining.length === 0) return;
  const removedIndex = orderBefore.indexOf(separatedGroupId);
  const predecessor = removedIndex > 0 ? (orderBefore[removedIndex - 1] ?? null) : null;
  const anchor = predecessor !== null && remaining.includes(predecessor) ? predecessor : null;
  const landing =
    advanceWithinVisibleList(anchor, remaining, (id) => isItemResolvedInState("group-check", id, state)) ??
    (anchor !== null ? anchor : remaining[0]!);
  dispatcher.dispatchNavigation({ family: "navigation", type: "selectItem", itemId: landing });
}

/**
 * GROUP "USE" ACCELERATORS (AG, 2026-08-02, "Small UI refinement. Build
 * directly."): the numbered-recommendation language applied to Group
 * Check -- each member spelling carries a "① Use" action, and digits 1-9
 * commit that spelling as the group's canonical identity immediately,
 * "exactly as the numbered buttons already function elsewhere."
 * DELIBERATELY NO NEW BEHAVIOR: this dispatches precisely what confirming
 * the group's Change editor with that spelling already dispatches --
 * flattenGroup when the spelling IS the canonical name (preserving that
 * command's EntityGroupDecision stamp and reviewer-confirmed bonus,
 * exactly like the editor's own default-text collapse), bulkApplyDecision
 * Rename over every member otherwise (the editor's own
 * different-spelling path). Same commands, same audit, same advance.
 */
function useGroupSpelling(group: EntityGroupProposal, spelling: string): void {
  if (spelling === group.canonicalName) {
    decideGroupAndAdvance({ family: "review", type: "flattenGroup", groupId: group.groupId }, group.groupId);
  } else {
    decideGroupBulkAndRender(
      { family: "review", type: "bulkApplyDecision", candidateIds: [...group.candidateIds], decision: "Rename", replacement: spelling },
      group.groupId
    );
  }
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
    notifyToast(`Action failed: ${result.reason}`); // RX-09: recoverable
    render();
    return;
  }
  // RX-18: subset bulk results narrate like Item Check's (display label,
  // RX-22); the command here is always bulkApplyDecision (see doc comment).
  if (command.type === "bulkApplyDecision") {
    setStatus(`${decisionDisplayLabel(command.decision)} applied to ${command.candidateIds.length} member(s).`);
  }
  acknowledge({ kind: "group", groupId });
  render();
}

/**
 * CONTEXTUAL MEMBER DECISIONS (AG, 2026-07-30): K/C/R/I inside an
 * expanded group apply to WHICHEVER ROW IS ACTIVE -- the whole item when
 * navigation is at the item's top level, but the individual member when a
 * member row holds the roving focus, WITHOUT entering Fix this. After a
 * member decision, the selection moves to the next UNEDITED member --
 * skipping members that already carry a decision -- and when the
 * just-decided member was the last unedited one below, it wraps back up
 * to the TOPMOST unedited member. This wrap is deliberate and deliberately
 * DIFFERENT from the stage-level no-wrap advance (visibleListAdvance.ts):
 * a member list is short, fully on screen, and being worked as a bounded
 * set -- "finish the members" semantics, where wrapping cannot disorient
 * because nothing scrolls; the no-wrap rule exists for long scrolling
 * lists where a bottom-to-top teleport loses the reviewer. When NO
 * unedited member remains, the group itself resolves and the ordinary
 * stage-level visible-order advance (the choke point) takes over --
 * deciding the final member flows seamlessly into "next group."
 */
function decideGroupMemberAndAdvance(group: EntityGroupProposal, memberId: string, command: AnyCommand): void {
  if (inlineEditor?.scope === "candidate" && inlineEditor.candidateId === memberId) inlineEditor = null;
  if (command.family === "review") dispatchReviewWithVisibleAdvance(command);
  const after = dispatcher.getState();
  const decisions = after.reviewSession?.candidateDecisions ?? {};
  const ids = group.candidateIds;
  const idx = ids.indexOf(memberId);
  // Forward from the decided member, then wrap from the TOP -- the wrap
  // segment starts at index 0, so the first unedited hit is the topmost.
  const searchOrder = [...ids.slice(idx + 1), ...ids.slice(0, Math.max(idx, 0))];
  const next = searchOrder.find((id) => !decisions[id]);
  // Only steer the roving selection if the group is still the focused item
  // (deciding the last member resolves the group and the stage-level
  // advance has already moved on -- never fight it).
  if (next !== undefined && after.focus?.target.stage === "group-check" && after.focus.target.itemId === group.groupId) {
    groupRovingFocus = { groupId: group.groupId, row: ids.indexOf(next) + 1, col: 0 };
    // An open Source panel follows the selection, as everywhere.
    if (sourceViewFor?.groupId === group.groupId) sourceViewFor = { groupId: group.groupId, candidateId: next };
  }
  acknowledge({ kind: "not-quite-member", groupId: group.groupId, candidateId: memberId });
  render();
}

/** The member row (if any) currently holding roving DOM focus within the
 *  focused, expanded group -- the "individual item is active" half of the
 *  contextual-decision rule. Null at the item's top level (group checkbox
 *  or action buttons), where K/C/R/I keep their whole-item meaning. */
function activeGroupMemberContext(): { group: EntityGroupProposal; memberId: string } | null {
  const state = dispatcher.getState();
  const target = state.focus?.target;
  if (!target || target.stage !== "group-check" || target.panel.kind !== "none" || !target.itemId) return null;
  const active = document.activeElement as HTMLElement | null;
  const memberId = active?.closest?.("[data-member-id]")?.getAttribute("data-member-id") ?? null;
  if (!memberId) return null;
  const group = state.grouping?.entityGroupProposals.find((g) => g.groupId === target.itemId);
  if (!group || !group.candidateIds.includes(memberId)) return null;
  return { group, memberId };
}

/** Keydown half of the contextual rule -- runs BEFORE the domain keymap so
 *  that k/i (which the keymap would resolve to whole-group confirmGroup/
 *  ignoreGroup) act on the active member instead when one is active. C/R
 *  open the member's own inline editor (candidate scope, stage
 *  "group-check" -- rendered inside the member list; its confirm routes
 *  back through decideGroupMemberAndAdvance). "F" deliberately stays
 *  whole-item everywhere: Fix this has no per-member meaning. */
function handleGroupMemberDecisionKey(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
  const key = event.key.toLowerCase();
  if (key !== "k" && key !== "c" && key !== "r" && key !== "i") return false;
  const ctx = activeGroupMemberContext();
  if (!ctx) return false;
  if (key === "k") {
    decideGroupMemberAndAdvance(ctx.group, ctx.memberId, { family: "review", type: "keepCandidate", candidateId: ctx.memberId });
  } else if (key === "i") {
    decideGroupMemberAndAdvance(ctx.group, ctx.memberId, { family: "review", type: "ignoreCandidate", candidateId: ctx.memberId });
  } else {
    openInlineEditor({ scope: "candidate", stage: "group-check", candidateId: ctx.memberId, action: key === "c" ? "Rename" : "Redact" });
  }
  return true;
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
  // ONE DIGIT SPACE (AG, 2026-08-02): the list CONTINUES the header
  // chips' numbering instead of restarting at 1 -- an option that is
  // also a header chip reuses that chip's digit; anything else numbers
  // after the chips (so a term item's identity reads ②, reachable only
  // by reading down into the panel -- deliberate). One derivation
  // (identityDigitAssignments) shared with handleIdentityLinkKey.
  // COLLISION RULE (AG, 2026-08-02): the ceiling drops by whatever the
  // item's own section reserves for its green buttons, so the list never
  // paints a digit the section actions have claimed.
  const assignments = identityDigitAssignments(
    recommendationForCandidate(candidateId, state),
    proposal.candidateGroupOptions,
    itemDigitCeilingFor(candidateId, state)
  );
  assignments.forEach(({ option, digit }) => {
    const isCurrent = resolved?.resolvedGroupId === option.groupId;
    const optionButton = el("button", {
      class: isCurrent ? "possible-identity-option possible-identity-option-current" : "possible-identity-option",
    });
    // INTERACTION LANGUAGE (2026-07-30): options are numbered because the
    // digits now LINK the numbered identity from the keyboard (see
    // handleIdentityLinkKey) -- the number is the shortcut's visible
    // referent, not decoration. Options past the ninth (rare) remain
    // click/Enter-selectable, just unnumbered.
    if (digit !== null) optionButton.appendChild(el("kbd", { class: "keycap" }, String(digit)));
    optionButton.appendChild(el("span", { class: "possible-identity-name" }, option.canonicalName));
    optionButton.appendChild(el("span", { class: `badge ${confidenceBadgeClass(option.confidence)}` }, `${option.confidence}%`));
    if (isCurrent) optionButton.appendChild(el("span", { class: "possible-identity-check" }, "✓ Linked"));
    // Deterministic Semantic Relationship Knowledge (2026-07-30): every
    // knowledge-era option explains WHY it exists, one checkable fact per
    // line ("Same surname...", "Related-name relationship: ... (Strength 5
    // — Established)"). Present only when the workspace engine carries
    // providers; older options without evidence render exactly as before.
    if (option.evidence && option.evidence.length > 0) {
      const evidenceList = el("span", { class: "identity-evidence" });
      for (const line of option.evidence) {
        evidenceList.appendChild(el("span", { class: "identity-evidence-line" }, `✓ ${line}`));
      }
      optionButton.appendChild(evidenceList);
    }
    optionButton.addEventListener("click", () =>
      decideAndAdvance({ family: "review", type: "linkAmbiguousCandidate", candidateId, groupId: option.groupId }, candidateId, stage)
    );
    list.appendChild(optionButton);
  });
  container.appendChild(list);
}

/**
 * CONFIDENCE IS A MEASUREMENT, NOT A DECISION (AG, 2026-08-03, unified
 * decision color system). The three bands are unchanged (>=90 / >=80 /
 * below); what changed is that they no longer return the DECISION hues.
 *
 * They used to be badge-good / badge-warn / badge-caution -- i.e. the same
 * green, amber and red that mean Keep, Fix this and Redact everywhere
 * else. That produced the exact contradiction the unified system exists to
 * remove: a 72%-confidence figure rendered RED inside a card the reviewer
 * had just marked Keep (green), so the reviewer had to know WHICH KIND of
 * thing they were looking at before they could read its color. Confidence
 * now speaks in depth of ink instead (see index.html), leaving hue to mean
 * only "what was decided."
 */
function confidenceBadgeClass(likelihood: number): "confidence-high" | "confidence-mid" | "confidence-low" {
  if (likelihood >= 90) return "confidence-high";
  if (likelihood >= 80) return "confidence-mid";
  return "confidence-low";
}

/**
 * CONFIDENCE AS A WORD, NOT A PERCENTAGE (AG, 2026-08-04).
 *
 * The figure was briefly a bare "28%" in the panel header. AG's own
 * objection to colouring it turned out to apply to the number itself: a
 * percentage invites a good/bad reading that the value does not carry.
 * "Records Office, 28%" LOOKS like a poor result and is in fact a good one
 * -- the detector is saying, correctly, that this is not a person. The
 * digits made the reviewer do that inversion in their head on every item.
 *
 * A word states the claim directly and cannot be misread as a score.
 *
 * THRESHOLDS ARE INHERITED, NOT INVENTED. The top three bands are exactly
 * `confidenceOpener`'s (>=95 / >=80 / >=50) so the header word can never
 * contradict the sentence beneath it -- an item reading "Unlikely" above
 * "This may be a person's name" would be the paint/keystroke class of
 * disagreement in prose. AG asked for five bands where the opener has
 * four, so the split falls in the opener's widest band (its single
 * "unlikely" covers 0-49) at 20 -- the only place a fifth band can be
 * added without inventing a boundary the sentence does not share.
 *
 * MIDDLE BAND WORDING: "Uncertain" rather than a hedge like "Possibly".
 * The middle is the one band that is genuinely a REQUEST -- it means the
 * detector could not tell and a human has to, which is the single most
 * actionable thing this readout can say. A hedge would bury that.
 */
function confidenceBand(likelihood: number): { label: string; className: string } {
  // The INK is U-shaped, deliberately: both ends are full-strength because
  // the detector is sure in both directions, and the uncertain middle takes
  // the dotted `.confidence-low` treatment that already means "look at this
  // one." With the word carrying the direction, the emphasis is free to
  // carry the certainty -- which is what makes this readable without a hue
  // (see confidenceBadgeClass above for why hue stays out).
  if (likelihood >= 95) return { label: "Highly likely", className: "confidence-high" };
  if (likelihood >= 80) return { label: "Likely", className: "confidence-mid" };
  if (likelihood >= 50) return { label: "Uncertain", className: "confidence-low" };
  if (likelihood >= 20) return { label: "Unlikely", className: "confidence-mid" };
  return { label: "Highly unlikely", className: "confidence-high" };
}

/**
 * "IDENTICAL OR BASICALLY IDENTICAL" SOURCE SNIPPETS (AG, 2026-08-04).
 *
 * AG's own example is the rule's specification: `[Andrew 20:24]` and
 * `[Andrew 9:38]` are the same evidence twice. What differs between them is
 * a NUMBER -- a timestamp, a row id, a date, a page. That is the general
 * shape of the near-duplicate here, because a document that repeats a
 * reference in a structured context (a message list, a table, a log) varies
 * the structure's counters and nothing else.
 *
 * So the similarity key normalises exactly that and nothing more:
 *   - every run of digits collapses to a single `#`
 *   - whitespace collapses to single spaces, ends trimmed
 *   - case is ignored
 *
 * Deliberately NOT fuzzy matching (edit distance, token overlap). A fuzzy
 * threshold would eventually hide a snippet that genuinely differed, and
 * the whole purpose of Sources is to show the reviewer the evidence -- a
 * collapse rule that can silently drop distinct evidence is worse than a
 * list with some repetition in it. This rule can only ever merge snippets
 * that differ in digits, whitespace or case, which is a claim a reader can
 * verify by looking. Under-collapsing is a cosmetic miss; over-collapsing
 * would be a correctness bug.
 *
 * FIRST OCCURRENCE WINS, preserving document order -- the retained text is
 * a real snippet from the document, never a synthesised representative.
 */
function collapseSimilarSnippets(snippets: readonly string[]): { text: string; similarCount: number }[] {
  const order: { text: string; similarCount: number }[] = [];
  const seen = new Map<string, { text: string; similarCount: number }>();
  for (const snippet of snippets) {
    const key = snippet
      .replace(/\d+/g, "#")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    const existing = seen.get(key);
    if (existing) existing.similarCount += 1;
    else {
      const entry = { text: snippet, similarCount: 0 };
      seen.set(key, entry);
      order.push(entry);
    }
  }
  return order;
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
/**
 * REVIEWER RECOMMENDATION UX (2026-07-30): assembles the pure
 * recommendation facts from engine outputs the UI already reads --
 * nothing is detected, scored, or persisted here (see
 * recommendations.ts) -- and resolves suggestion ops to the SAME existing
 * operations the buttons already perform.
 */
function recommendationForCandidate(candidateId: string, state: ReturnType<WorkspaceCommandDispatcher["getState"]>): ReviewRecommendation | null {
  if (state.reviewSession?.candidateDecisions[candidateId]) return null; // decided items need no recommendation
  return triageRecommendationForCandidate(candidateId, state);
}

/**
 * TRIAGE QUEUE (2026-07-30): the decision-BLIND variant. The triage view
 * needs the recommendation for decided rows too -- an accepted row keeps
 * its "✓ Andrew → Andrew Goodloe" text, and its SECTION assignment must
 * not change the moment it is decided (rows stay put; the queue never
 * shifts under the reviewer). Recommendation GENERATION is unchanged --
 * this is the same derivation over the same facts, minus the
 * decided-items-need-no-recommendation display rule that
 * recommendationForCandidate layers on top.
 */
function triageRecommendationForCandidate(candidateId: string, state: ReturnType<WorkspaceCommandDispatcher["getState"]>): ReviewRecommendation | null {
  const facts = recommendationFactsForCandidate(candidateId, state);
  return facts ? deriveRecommendation(facts) : null;
}

/** REVIEW CONFIDENCE TIERS (AG, 2026-08-02): the facts assembly, split
 *  out of triageRecommendationForCandidate so the tier derivation
 *  (deriveReviewTier) provably reads the SAME facts as the archetype --
 *  one assembly, two pure derivations, no drift. */
function recommendationFactsForCandidate(candidateId: string, state: ReturnType<WorkspaceCommandDispatcher["getState"]>): RecommendationFacts | null {
  const candidate = state.detection?.candidates.find((c) => c.id === candidateId);
  if (!candidate) return null;
  const relationshipKinds = new Set<RelationshipKind>();
  for (const proposal of state.structuralRelationships?.proposals ?? []) {
    if (proposal.candidateIds.includes(candidateId) && !state.reviewSession?.relationshipDismissals?.[proposal.proposalId]) {
      relationshipKinds.add(proposal.kind);
    }
  }
  const identityOptions = state.grouping?.ambiguityProposals.find((p) => p.candidateId === candidateId)?.candidateGroupOptions ?? [];
  // Refinement (2026-07-30): anchor vetting. An identity option is only
  // suggestion-worthy if its anchor is a recognized ENTITY; a group whose
  // every member is quality-"Unlikely" is a phrase-completion bucket
  // ("Did Dr"), not an entity, and gets flagged so the derivation never
  // recommends it. Still purely pre-computed engine facts -- quality's
  // own per-candidate recommendation, joined by groupId.
  const unrecognizedGroupIds = new Set<string>();
  for (const option of identityOptions) {
    const group = state.grouping?.entityGroupProposals.find((g) => g.groupId === option.groupId);
    // SOLITARY ANCHORS (AG's research question, 2026-08-02, "Andrew
    // Thanks"/"Diana Yes"): the engine's 2026-07-28 correction proposes
    // options anchored on solitary full-name-shaped entities that never
    // became an EntityGroupProposal -- so the group lookup above finds
    // nothing and the original vetting silently SKIPPED them, admitting
    // exactly the phrase-completion junk the vetting exists to catch.
    // The option id for these IS the anchor-bucket key (resolution.ts's
    // personGroupKey), so the member candidates are recoverable and the
    // SAME vetting applies -- plus a second signal for name-shaped
    // phrases quality still marks ToReview ("Yes, Diana"): members whose
    // categories are non-name evidence (isNonNameAnchorEvidence) do not
    // count as recognition either. Presentation-layer only: the engine's
    // proposals are untouched; a vetoed option simply stops being a
    // SUGGESTION, and a known-name candidate left with no recognized
    // home lands in Shortened Person Names' Needs Review tier with the
    // person-question actions -- the tier model's intended home for it.
    const memberIds =
      group && group.candidateIds.length > 0
        ? group.candidateIds
        : (state.detection?.candidates ?? [])
            .filter((c) => c.detectedType === "person" && resolutionPersonTokens(c).length >= 2 && resolutionPersonGroupKey(c) === option.groupId)
            .map((c) => c.id);
    if (memberIds.length === 0) continue; // no member evidence either way: fail open (pre-existing posture)
    const noRecognizedMember = memberIds.every((id) => {
      if (state.quality?.recommendationByCandidate[id] === "Unlikely") return true;
      if (group) return false; // real groups keep the shipped Unlikely-only rule
      const assessment = state.quality?.assessmentByCandidate[id];
      const cats = assessment ? (assessment.filterRules.length ? assessment.filterRules : assessment.reasons) : [];
      return isNonNameAnchorEvidence(cats);
    });
    if (noRecognizedMember) unrecognizedGroupIds.add(option.groupId);
  }
  const facts: RecommendationFacts = {
    displayValue: candidate.displayValue,
    detectedType: candidate.detectedType,
    personTokenCount: candidate.detectedType === "person" ? resolutionPersonTokens(candidate).length : 0,
    categories: candidateCategories(candidate, state),
    qualityRecommendation: state.quality?.recommendationByCandidate[candidateId] === "Unlikely" ? "Unlikely" : "ToReview",
    identityOptions,
    relationshipKinds,
    unrecognizedGroupIds,
  };
  return facts;
}

/** Accepting a suggestion runs the EXISTING operation -- the identical
 *  paths the Possible-identities buttons, Ignore button, and Redact
 *  editor already use. One click / one keystroke; resolved. */
function runRecommendationSuggestion(candidateId: string, stage: WorkflowStage, op: SuggestionOp): void {
  if (op.kind === "link") {
    decideAndAdvance({ family: "review", type: "linkAmbiguousCandidate", candidateId, groupId: op.groupId }, candidateId, stage);
  } else if (op.kind === "keep") {
    // UNCERTAIN DISPOSITION (AG, 2026-08-02): ① "Person's name" -- the
    // same Keep the People section's accept default applies.
    decideAndAdvance({ family: "review", type: "keepCandidate", candidateId }, candidateId, stage);
  } else if (op.kind === "ignore") {
    decideAndAdvance({ family: "review", type: "ignoreCandidate", candidateId }, candidateId, stage);
  } else if (op.kind === "change-to") {
    decideAndAdvance({ family: "review", type: "renameCandidate", candidateId, replacement: op.replacement }, candidateId, stage);
  } else {
    openInlineEditor({ scope: "candidate", stage, candidateId, action: "Redact" });
  }
}

// HEADER LAYOUT REFINEMENT (2026-07-30, Andrew): the suggestion buttons
// moved OUT of the panel body and INTO the focused item's own header row,
// immediately after the title -- part of the primary decision bar rather
// than a second bar below it. The conclusion sentence and the Why?
// disclosure stay in the panel body as supporting explanation. Same
// buttons, same ops, same 1-9 digits (handleIdentityLinkKey keys off the
// focused item, not DOM position, so nothing there changed).
function recommendationSuggestionButtons(candidateId: string, stage: WorkflowStage, recommendation: ReviewRecommendation): HTMLElement {
  const wrap = el("span", { class: "recommendation-suggestions header-suggestions" });
  recommendation.suggestions.forEach((suggestion, index) => {
    wrap.appendChild(keycapButton(index + 1, suggestion.label, () => runRecommendationSuggestion(candidateId, stage, suggestion.op)));
  });
  return wrap;
}

// The panel body's share of the recommendation is now supporting
// explanation only: the conclusion sentence (the buttons live in the
// item header via recommendationSuggestionButtons above).
function renderRecommendationConclusion(panel: HTMLElement, recommendation: ReviewRecommendation): void {
  // CONCLUSION-AS-BUTTON (AG, 2026-08-02): the term archetypes carry
  // their claim in the ① chip now -- their conclusion is deliberately
  // empty, and an empty <p> would render as a stray gap.
  if (!recommendation.conclusion) return;
  panel.appendChild(el("p", { class: "recommendation-conclusion" }, recommendation.conclusion));
}

function renderCandidateDetailPanel(
  container: HTMLElement,
  candidate: Candidate,
  quality: QualityResult | null,
  reviewOccurrences: OccurrenceGroup[],
  existingDecision: string | undefined,
  stage: WorkflowStage,
  state: ReturnType<WorkspaceCommandDispatcher["getState"]>,
  // 2026-07-30 feature spec: the Results grid's expanded full view opens
  // with "the Name in bold, the count in small (x) format" -- the row list
  // already shows both on the row itself, so the header only renders when
  // the caller asks (category view's grid, where the compact cell is
  // elsewhere on screen). Header mode also hosts the whole-item KCRIQ
  // buttons (AG response, 2026-07-30). `schemeClass` is the ITEM-SCHEME
  // CASCADE (AG, same day): the panel is a child area of its item and
  // takes the item's containing color -- pending-edit target, committed
  // decision, or nav-blue for a focused unprocessed item.
  opts?: { showHeader?: boolean; schemeClass?: string }
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
  // Split on whitespace: since the unified color system (2026-08-03) a
  // scheme is a DECISION class plus a SURFACE class ("decision-keep
  // decision-tinted"), and classList.add rejects a string containing a
  // space.
  if (opts?.schemeClass) panel.classList.add(...opts.schemeClass.split(" "));

  // Refinement (2026-07-30): the % pill moved into Why? -- detector
  // confidence is a model internal; the reviewer's task is deciding what
  // to do, and the interface communicates confidence through the presence
  // and quality of recommendations instead. Type + likelihood pills stay:
  // they describe the ITEM, not the model.
  const badges = el("div", { class: "detail-badges" });
  badges.appendChild(el("span", { class: "badge" }, candidate.detectedType));
  badges.appendChild(el("span", { class: "badge" }, recommendationLabel(recommendation)));

  if (opts?.showHeader) {
    // AG response (2026-07-30): "make the pills appear on the same horiz
    // line as the bold name" -- the badges join the title row instead of
    // sitting on their own line beneath it.
    const title = el("div", { class: "detail-title" });
    title.appendChild(el("span", { class: "detail-title-name" }, candidate.displayValue));
    title.appendChild(el("span", { class: "detail-title-count" }, `(${candidate.occurrenceIds.length})`));
    title.appendChild(badges);
    /*
     * CONFIDENCE AS A BARE FIGURE, TOP RIGHT (AG, 2026-08-04: "make the
     * Detector Confidence be a simple color-temp percentage number without
     * text at top right").
     *
     * Moved out of the Why? disclosure, where it read "Detector confidence:
     * 28%" -- two words of label for one number the position can say by
     * itself. A figure alone in the header's top-right corner is the
     * conventional home for a scalar readout, and it costs the panel no
     * vertical space at all, which is the constraint this panel is under.
     *
     * NO HUE, and now no percentage either -- see confidenceBand, which
     * records why the digits were replaced by a word (AG, 2026-08-04) and
     * why the emphasis rather than the colour carries certainty. The short
     * version: confidence colour was removed on purpose in the first place
     * (a red 72% inside a green Keep card), and a percentage invited a
     * good/bad reading the value does not carry.
     */
    const band = confidenceBand(likelihood);
    const figure = el("span", { class: `detail-confidence ${band.className}` }, band.label);
    // The precise figure survives on hover -- the word is for deciding, the
    // number is for anyone who wants to audit the word.
    figure.title = `Detector confidence: ${likelihood}%`;
    title.appendChild(figure);
    panel.appendChild(title);
    // AG response (2026-07-30): the KCRIQ buttons arrive in the full view
    // ("to be implemented after this current document's revisions") --
    // whole-item actions, same decisionButtons() choke point as the row
    // views, which also hosts the Change/Redact inline editors so the
    // keyboard C/R path keeps working here. NOT yet implemented, and
    // flagged as a real constraint rather than silently substituted:
    // "editing ... each constituent element" -- the domain records
    // decisions per CANDIDATE (ReviewSession.candidateDecisions); a
    // per-OCCURRENCE decision has no domain representation, so
    // constituent-level editing needs a domain-model extension first (see
    // the findings doc).
    const actions = el("div", { class: "detail-actions" });
    // HEADER LAYOUT REFINEMENT (2026-07-30, Andrew): in the By-Category
    // expanded view this bar IS the item's primary decision bar, so the
    // recommendation suggestions lead it -- same placement contract as
    // the list-view row (suggestions after the title, before the generic
    // decisions), same ops, same 1-9 digits.
    const headerRecommendation = recommendationForCandidate(candidate.id, state);
    if (headerRecommendation && headerRecommendation.suggestions.length > 0) {
      actions.appendChild(recommendationSuggestionButtons(candidate.id, stage, headerRecommendation));
    }
    decisionButtons(candidate.id, stage, actions, existingDecision as CandidateDecisionKind | undefined);
    panel.appendChild(actions);
  } else {
    panel.appendChild(badges);
  }

  // REVIEWER RECOMMENDATION UX (2026-07-30): the panel now leads with a
  // CONCLUSION (buttons live in the item header) -- "what DocScrub thinks
  // this probably is" -- while everything that explains HOW (the
  // standard-language summary, detector confidence, Sources, the full
  // Possible-identities list, occurrences, Expert View) sits behind ONE
  // expandable "Why?" section. Refinement (same day): the recommendation
  // is deliberately RARE -- many items get a conclusion with no buttons,
  // and many get nothing at all; both render cleanly with no placeholder.
  const reviewRecommendation = recommendationForCandidate(candidate.id, state);
  if (reviewRecommendation) renderRecommendationConclusion(panel, reviewRecommendation);

  // VISUAL HIERARCHY REFINEMENT (AG, 2026-08-01, confirmed via direct
  // question): Why? AUTO-OPENS on the focused item -- "the details/
  // justification should always be visible on a highlighted item, at
  // least enough that they have to see some evidence." The panel only
  // ever renders for the focused/expanded item, so default-open here IS
  // open-on-focus; the structure inside Why? is unchanged (Andrew chose
  // auto-open over re-layering the panel), and a reviewer who closes it
  // stays closed for THIS candidate (closedDetailsKeys) while the next
  // candidate's Why? opens fresh under its own key.
  const whyDetails = detailsEl(`why:${candidate.id}`, { class: "why-view" }, true);
  /*
   * THE VERDICT RIDES THE "Why?" LINE (AG, 2026-08-04: "make the 'This may
   * be a ..' line directly right of Why? when it's expanded, and much
   * bigger").
   *
   * Put INSIDE the <summary> rather than beside it, which is a small
   * addition to what was asked and the reason to prefer it: a summary is
   * the one part of a disclosure that renders in BOTH states, so the
   * verdict survives a reviewer collapsing Why?. Previously collapsing it
   * hid the conclusion along with the evidence -- the reviewer lost the
   * answer to keep the reasoning out of the way, which is backwards.
   *
   * The size inversion is deliberate too: "Why?" is now the small muted
   * affordance and the verdict is the large text, because the verdict is
   * what the reviewer came for and "Why?" is only the door to the rest.
   */
  const whySummary = el("summary", { class: "why-summary" });
  whySummary.appendChild(el("span", { class: "why-label" }, "Why?"));
  whySummary.appendChild(el("span", { class: "detail-verdict" }, `${confidenceOpener(likelihood, candidate.detectedType)}.`));
  whyDetails.appendChild(whySummary);

  /*
   * SIGNED EVIDENCE LIST instead of the run-on sentence (AG, 2026-08-04:
   * "use what we have in lieu of rewording and implement what was built").
   *
   * The standard summary composed one paragraph of up to six clauses that
   * REVERSED POLARITY IN THE MIDDLE -- "This is unlikely to be a person's
   * name because [two reasons it is] , but [three reasons it is not]." The
   * reader had to carry the opening verdict across a "but" to know which
   * half of the sentence supported it.
   *
   * NOTHING NEW WAS WRITTEN FOR THIS. EXPLANATION_DICTIONARY has carried
   * three registers since it was ported -- short / standard / expert -- and
   * only `standard` was ever rendered. The `short` strings are already the
   * plain labels this needed ("Email evidence", "Single occurrence",
   * "Institution term"), and `expert` (already computed above for Expert
   * View) already splits them by polarity. So this is a VIEW change over
   * data the engine has always produced.
   *
   * That is also why it is NOT a deviation from the Python oracle: not one
   * dictionary string is altered, the composition logic in
   * explanation-builder.ts is untouched, and `standard.summary` is still
   * built and still used verbatim by the audit export. This changes what
   * the panel chooses to display, which is a UI concern the port never
   * governed. A wording pass over the dictionary WOULD be an oracle
   * deviation, and is deliberately not taken here.
   *
   * The verdict line keeps the engine's own opener rather than a UI
   * paraphrase, so the words a reviewer reads still come from the same
   * place the audit trail's do.
   */
  // Neutral counts toward "there is something to show" (2026-08-04): an
  // item whose evidence is ALL neutral -- entirely possible now that the
  // declared-polarity table is honoured -- would otherwise fall through to
  // the sentence and lose the context the chips exist to keep.
  if (expert.positiveEvidence.length > 0 || expert.negativeEvidence.length > 0 || expert.neutralEvidence.length > 0) {
    // INLINE, NOT STACKED (AG, 2026-08-04: "make the bulleted items in-line,
    // not list. That will help"). One wrapping flow of signed chips instead
    // of one line per item: six stacked bullets cost six lines of a panel
    // whose whole problem is vertical budget, and the items are two or three
    // words each -- far too short to earn a line apiece. Wrapping means the
    // count of lines follows the panel's width instead of the evidence
    // count, which is what makes this survive a narrow inspector.
    const evidenceFlow = el("div", { class: "evidence-flow" });
    /*
     * STRONGEST EVIDENCE FIRST (AG, 2026-08-04, from a panel reading
     * "unlikely" above three + chips and one − chip).
     *
     * The list truncates at three per polarity to match
     * buildStandardSummary's own `slice(0, 3)`. In a SENTENCE that read as
     * a summary; in a LIST it reads as exhaustive, so hidden evidence looks
     * like absent evidence and the verdict looks unsupported by its own
     * panel. Two mitigations, both cheap:
     *
     *   1. Sort by |weight| so the truncation drops the WEAKEST evidence
     *      rather than whatever happened to be last. The chip that most
     *      explains the verdict is now always the one shown.
     *   2. Say what was dropped ("+2 more"), so the reviewer knows the list
     *      is a summary and Expert View has the rest.
     *
     * NOT fixed here, and the larger half of the problem: a signed chip
     * carries no MAGNITUDE, so three weak positives sit visually equal to
     * one -40 negative. Ordering makes the strongest first but still not
     * visibly stronger. Raised separately rather than solved silently.
     */
    const byStrength = (items: readonly ExplanationEvidenceText[]): ExplanationEvidenceText[] =>
      [...items].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
    // ✓ / ✗ / • (AG, 2026-08-04). The glyph is the signal and the colour
    // only reinforces it, deliberately in that order: ✓/✗ are the decision
    // palette's Keep-green and Redact-red inside a decision-tinted panel,
    // so a colour-only cue could be read as an outcome. A check, a cross
    // and a dot say "for", "against" and "context" without needing hue at
    // all -- which is what keeps this legible to a colour-blind reviewer.
    const SIGN = { positive: "✓", negative: "✗", neutral: "•" } as const;
    const emit = (items: readonly ExplanationEvidenceText[], polarity: "positive" | "negative" | "neutral"): void => {
      const ranked = byStrength(items);
      for (const item of ranked.slice(0, 3)) {
        const chip = el("span", { class: `evidence-item evidence-${polarity}` });
        chip.appendChild(el("span", { class: "evidence-sign" }, SIGN[polarity]));
        chip.appendChild(el("span", {}, item.short));
        evidenceFlow.appendChild(chip);
      }
      if (ranked.length > 3) {
        const more = el("span", { class: "evidence-more" }, `+${ranked.length - 3} more`);
        more.title = `${ranked.length - 3} further ${polarity} signal(s) -- see Expert View`;
        evidenceFlow.appendChild(more);
      }
    };
    emit(expert.positiveEvidence, "positive");
    emit(expert.negativeEvidence, "negative");
    /*
     * NEUTRAL SIGNALS ARE SHOWN, AS CONTEXT (AG, 2026-08-04: "Keep neutral
     * signals in the explanation. Render them as neutral (•) rather than
     * positive or negative so reviewers retain the context without implying
     * they influenced the score").
     *
     * These were invisible until today -- the panel rendered only the two
     * polarised lists, and the polarity port defect meant most of what
     * SHOULD have been neutral was being shown as ± anyway (see
     * CandidateQualityEngine's DECLARED_EVIDENCE_POLARITY). Repairing that
     * defect alone would have silently deleted thirteen rules' worth of
     * context from the panel; this is the half that puts them back.
     *
     * LAST, deliberately. The reviewer's question is "for or against", and
     * the answer to it should not be interleaved with material that answers
     * neither. Context belongs after the argument, not inside it.
     */
    emit(expert.neutralEvidence, "neutral");
    whyDetails.appendChild(evidenceFlow);
  } else if (standard.summary) {
    // No polarised evidence (the neutral / "no evidence recorded" branches
    // of buildStandardSummary) -- there is no list to build, so the
    // sentence is still the only thing that can say anything.
    whyDetails.appendChild(el("p", { class: "detail-summary" }, standard.summary));
  }
  // 2026-08-04: the "Detector confidence: NN%" line that lived here is now
  // the bare figure in the panel header (see the .detail-confidence block
  // above). Stated rather than just deleted, because the 2026-07-30 note it
  // replaces made a deliberate point of DEMOTING this metric into the
  // disclosure -- moving it back up is a reversal of that placement, taken
  // on the grounds that a number with no label and no vertical cost is not
  // the same thing as a headline.

  // 2026-07-30 feature spec: "Representative Snippets ... should be
  // renamed 'Sources'."
  const snippetsHeading = el("div", { class: "detail-section-title" }, "Sources");
  whyDetails.appendChild(snippetsHeading);
  const allOccurrences = reviewOccurrences.flatMap((group) => group.occurrences);
  if (allOccurrences.length === 0) {
    whyDetails.appendChild(el("p", { class: "hint" }, "No occurrences recorded."));
  } else {
    // COLLAPSE NEAR-DUPLICATE SOURCES (AG, 2026-08-04, on a panel showing
    // "[Message List]" three times): "if we have a list where the items are
    // either identical or basically identical ... then we only want to list
    // one. we can add 'and similar' in italics directly next to the single
    // entry."
    //
    // The dedupe happens BEFORE the slice, which is most of the value: the
    // cap was showing five copies of one snippet where five DISTINCT
    // snippets existed further down the list. The reviewer now spends the
    // five slots on five different pieces of evidence.
    for (const source of collapseSimilarSnippets(allOccurrences.map((o) => `${o.context.before}[${o.context.match}]${o.context.after}`)).slice(0, 5)) {
      const line = el("p", { class: "context-snippet" }, source.text);
      if (source.similarCount > 0) {
        // Italic, immediately beside the entry, per AG. Title carries the
        // count -- "and similar" says there are more without making the
        // reviewer parse a number they usually do not need.
        const note = el("em", { class: "snippet-similar" }, " and similar");
        note.title = `${source.similarCount} more occurrence(s) in near-identical context`;
        line.appendChild(note);
      }
      whyDetails.appendChild(line);
    }
  }

  // The FULL identity list (with its evidence lines) lives here --
  // suggestions above promote the top options; disclosure keeps the rest.
  renderPossibleIdentities(candidate.id, stage, state, whyDetails);

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
  whyDetails.appendChild(occurrenceDetails);

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

  // NORMALIZATION EVIDENCE (AG, 2026-08-03). When this candidate absorbed
  // conversational variants, Expert View is the authoritative record of
  // what the detector ACTUALLY found -- listed verbatim, nothing hidden,
  // so the collapse the reviewer benefits from upstream is fully
  // accountable here. Rendered only when there is something to say, so an
  // ordinary candidate's Expert View is unchanged.
  const normalizationRecord = state.normalization?.recordsByCandidate[candidate.id];
  if (normalizationRecord && normalizationRecord.variants.length > 0) {
    const normalizedColumn = el("div", { class: "normalized-from" });
    normalizedColumn.appendChild(el("div", { class: "detail-section-title" }, "Normalized from"));
    const list = el("ul", {});
    // The surviving candidate's own detected form heads the list -- it is
    // as much a variant of the review candidate as the others, and leading
    // with it makes the collapse legible ("these all became this").
    list.appendChild(el("li", {}, `${candidate.displayValue} (as detected)`));
    for (const variant of normalizationRecord.variants) {
      const removed = [...variant.removedLeading, ...variant.removedTrailing];
      const item = el("li", {}, `${variant.displayValue} (${variant.occurrenceCount})`);
      if (removed.length > 0) {
        item.appendChild(el("span", { class: "hint" }, ` — removed ${removed.map((t) => `"${t}"`).join(", ")}`));
      }
      list.appendChild(item);
    }
    normalizedColumn.appendChild(list);
    normalizedColumn.appendChild(
      el(
        "p",
        { class: "hint" },
        "Every original detection is preserved above and still drives occurrence highlighting and audit output. Redaction replaces only the name itself, leaving the surrounding words in place."
      )
    );
    expertGrid.appendChild(normalizedColumn);
  }

  expertDetails.appendChild(expertGrid);
  // Expert View nests INSIDE "Why?" -- deterministic and transparent,
  // fully retained, one level deeper than the conclusion it supports.
  whyDetails.appendChild(expertDetails);

  panel.appendChild(whyDetails);
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
    facts.push({
      candidateId,
      status: itemCheckCandidateStatus(candidate, state),
      categories: candidateCategories(candidate, state),
      occurrenceCount: candidate.occurrenceIds.length,
      likelihood: state.quality?.scoreByCandidate[candidateId],
    });
  }
  return facts;
}

function renderItemCheckViewToggle(container: HTMLElement): void {
  const toggle = el("div", { class: "view-toggle" });
  const listButton = button("List", () => {
    itemCheckViewMode = "list";
    filterHeaderRow = "category"; // leaving By Category: reset the Shift+Arrow cursor for the next entry
    announceItemCheckNarrowing(); // RX-18: the view switch changes visible membership
    render();
  });
  const categoryButton = button("By Category", () => {
    itemCheckViewMode = "category";
    filterHeaderRow = "category"; // fresh entry starts on the category area
    announceItemCheckNarrowing(); // RX-18: the view switch changes visible membership
    render();
  });
  // TRIAGE QUEUE (2026-07-30): the high-throughput experiment -- compact
  // sectioned rows, accept-and-advance, progressive disclosure.
  const triageButton = button("Triage", () => {
    itemCheckViewMode = "triage";
    filterHeaderRow = "category";
    triageExpandedId = null;
    announceItemCheckNarrowing(); // RX-18: the view switch changes visible membership
    render();
  });
  listButton.classList.toggle("chip-active", itemCheckViewMode === "list");
  categoryButton.classList.toggle("chip-active", itemCheckViewMode === "category");
  triageButton.classList.toggle("chip-active", itemCheckViewMode === "triage");
  toggle.appendChild(listButton);
  toggle.appendChild(categoryButton);
  toggle.appendChild(triageButton);
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

  // RX-02a: every narrowing pass (review state, category, and the
  // 2026-07-30 context-filter axis) comes from itemCheckCategoryView.ts's
  // pure helper -- the SAME function visibleItemCheckIds() applies for
  // keyboard navigation, so rendered membership and keyboard-traversed
  // membership cannot drift. The chip COUNTS below remain computed inline:
  // they are presentation (how many candidates WOULD each chip show), not
  // membership.
  const categoryFacts = buildCategoryViewFacts(candidates.map((c) => c.id), state);
  const factsById = new Map(categoryFacts.map((f) => [f.candidateId, f]));
  const stateFilteredIds = new Set(narrowByCategoryView(categoryFacts, { reviewState: categoryReviewState, categoryFilter: null, contextFilter: "all" }));
  const stateFiltered = candidates.filter((candidate) => stateFilteredIds.has(candidate.id));
  // The pool the Filter row's chips count over: state + category applied,
  // context deliberately NOT -- each chip reports what IT would show.
  const stateAndCategoryFacts = narrowByCategoryView(categoryFacts, { reviewState: categoryReviewState, categoryFilter, contextFilter: "all" })
    .map((id) => factsById.get(id))
    .filter((f): f is CategoryViewFacts => Boolean(f));

  const categoryCounts = new Map<string, number>();
  // AG response (2026-07-30): "Add show empty categories" (the Python
  // reference's checkbox, previously left out because the written spec
  // didn't name it -- now it does). When on, every category present in
  // the FULL pool renders, including those with zero members under the
  // current narrowing, seeded here at 0.
  if (showEmptyCategories) {
    for (const candidate of candidates) {
      for (const category of candidateCategories(candidate, state)) {
        if (!categoryCounts.has(category)) categoryCounts.set(category, 0);
      }
    }
  }
  for (const candidate of stateFiltered) {
    for (const category of candidateCategories(candidate, state)) {
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
    }
  }
  const sortedCategories = [...categoryCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  const panel = el("div", { class: "category-check-panel" });

  // Label + count chip, matching the Python reference's "Total 614" shape
  // (count visually distinct from the label rather than parenthesized).
  const chipButton = (label: string, count: number, onClick: () => void): HTMLButtonElement => {
    const b = el("button", { class: "chip" });
    b.appendChild(el("span", { class: "chip-label" }, label));
    b.appendChild(el("span", { class: "chip-count" }, String(count)));
    b.addEventListener("click", onClick);
    return b;
  };

  // 2026-07-30 feature spec: the "clean header" -- REVIEW STATE and FILTER
  // as two labelled groups in distinct colors (blue accent vs. the filter
  // hue; see index.html). The FILTER group is hidden entirely while
  // "Total" is selected ("in this case Filters disappears entirely, as is
  // appropriate"), shows only its Show All chip until a specific category
  // is picked ("clicking a specific category should open up the additional
  // filters"), and its Show All chip negates the other three (the axis is
  // single-select; "all" is the no-op member).
  const headerRow = el("div", { class: "category-header-row" });

  const stateGroup = el("div", { class: "category-header-group" });
  stateGroup.appendChild(el("div", { class: "category-header-label" }, "Review State"));
  const stateRow = el("div", { class: "category-nav-row" });
  // Python reference order: Total · Resolved · Unlikely · To Review.
  const stateOptions: { key: CategoryReviewState; label: string }[] = [
    { key: "total", label: "Total" },
    { key: "resolved", label: "Resolved" },
    { key: "unlikely", label: "Unlikely" },
    { key: "toReview", label: "To Review" },
  ];
  for (const option of stateOptions) {
    const count = candidates.filter((candidate) => option.key === "total" || itemCheckCandidateStatus(candidate, state) === option.key).length;
    const chip = chipButton(option.label, count, () => {
      categoryReviewState = option.key;
      // AG response (2026-07-30): Review State and Filter are
      // simultaneous, CUMULATIVE filters -- switching among
      // Resolved/Unlikely/To Review keeps the category and Filter
      // selections in effect (this supersedes the earlier approved
      // re-baseline-on-state-switch; the same response's "view all Single
      // occurrences" workflow depends on the filter surviving state
      // clicks). Total alone clears everything: "If Total is selected,
      // the Filter simply resets to Show All" -- and, per the original
      // spec, Total also clears the category selection.
      if (option.key === "total") {
        categoryFilter = null;
        categoryContextFilter = "all";
      }
      filterHeaderRow = "state"; // a click moves the Shift+Arrow cursor too -- one position, either input
      announceItemCheckNarrowing(); // RX-18: filter re-application
      render();
    });
    chip.classList.add("review-state-chip");
    chip.classList.toggle("chip-active", categoryReviewState === option.key);
    // INTERACTION LANGUAGE (2026-07-30): the Shift+Arrow cursor ring --
    // rendered on the ACTIVE chip of whichever header row the cursor is on
    // (position IS selection within a single-select row), so vertical
    // travel between rows is always visibly anchored. See filterHeaderRow.
    chip.classList.toggle("chip-nav-cursor", filterHeaderRow === "state" && categoryReviewState === option.key);
    stateRow.appendChild(chip);
  }
  stateGroup.appendChild(stateRow);
  headerRow.appendChild(stateGroup);

  // AG response (2026-07-30, `responsetoClaude-ImplementationFindings`):
  // ALL four Filter chips are visible ALL the time -- the earlier
  // "Filters disappear under Total / only Show All until a category is
  // picked" reading blocked a real workflow ("someone may want to view
  // all Single occurrences. They cannot."). Review State and Filter act
  // as simultaneous, CUMULATIVE filters; selecting Total simply resets
  // the Filter to Show All (see the Total chip's own click handler). The
  // color-coded active pills clarify which are in effect.
  const filterGroup = el("div", { class: "category-header-group" });
  filterGroup.appendChild(el("div", { class: "category-header-label" }, "Filter"));
  const filterRow = el("div", { class: "category-nav-row" });
  for (const option of CATEGORY_CONTEXT_FILTERS) {
    const count = stateAndCategoryFacts.filter((f) => matchesContextFilter(f, option.key)).length;
    const chip = chipButton(option.label, count, () => {
      categoryContextFilter = option.key;
      filterHeaderRow = "filter"; // click moves the cursor -- see the state row's note
      announceItemCheckNarrowing(); // RX-18: filter re-application
      render();
    });
    chip.classList.add("filter-context-chip");
    chip.classList.toggle("chip-active", categoryContextFilter === option.key);
    chip.classList.toggle("chip-nav-cursor", filterHeaderRow === "filter" && categoryContextFilter === option.key); // see the state row's cursor note
    filterRow.appendChild(chip);
  }
  filterGroup.appendChild(filterRow);
  headerRow.appendChild(filterGroup);
  panel.appendChild(headerRow);

  // CATEGORY section: the small "Show All N" link beside the label clears
  // a specific category selection; the categories themselves render as a
  // navigable grid of cells (label left, count right -- Python reference),
  // traversed by Shift+Arrows (see the keydown handler).
  const categoryHeader = el("div", { class: "category-section-row" });
  categoryHeader.appendChild(el("span", { class: "category-header-label" }, "Category"));
  const showAllLink = button(`Show All ${stateFiltered.length}`, () => {
    categoryFilter = null; // clears the CATEGORY selection only -- the Filter axis is cumulative and stays
    filterHeaderRow = "category"; // click moves the cursor -- see the state row's note
    announceItemCheckNarrowing(); // RX-18: filter re-application
    render();
  });
  showAllLink.classList.add("category-show-all-link");
  showAllLink.classList.toggle("chip-active", categoryFilter === null);
  categoryHeader.appendChild(showAllLink);
  const emptyToggleLabel = el("label", { class: "show-empty-categories" });
  const emptyToggle = el("input", { type: "checkbox" }) as HTMLInputElement;
  emptyToggle.checked = showEmptyCategories;
  emptyToggle.addEventListener("change", () => {
    showEmptyCategories = emptyToggle.checked;
    render();
  });
  emptyToggleLabel.appendChild(emptyToggle);
  emptyToggleLabel.appendChild(el("span", {}, "show empty categories"));
  categoryHeader.appendChild(emptyToggleLabel);
  panel.appendChild(categoryHeader);

  const categoryGrid = el("div", { class: "category-grid" });
  for (const [category, count] of sortedCategories) {
    const cell = el("button", { class: "category-cell", "data-category": category });
    cell.appendChild(el("span", { class: "category-cell-label" }, categoryRuleLabel(category)));
    cell.appendChild(el("span", { class: "category-cell-count" }, String(count)));
    if (categoryFilter === category) cell.classList.add("category-cell-active");
    if (count === 0) cell.classList.add("category-cell-empty");
    cell.addEventListener("click", () => {
      categoryFilter = category;
      // AG response (2026-07-30): filters are cumulative -- picking a
      // category no longer resets the Filter axis (only Total does).
      filterHeaderRow = "category"; // click moves the cursor -- see the state row's note
      announceItemCheckNarrowing(); // RX-18: filter re-application
      render();
    });
    categoryGrid.appendChild(cell);
  }
  panel.appendChild(categoryGrid);

  container.appendChild(panel);

  return narrowByCategoryView(categoryFacts, { reviewState: categoryReviewState, categoryFilter, contextFilter: categoryContextFilter });
}

/**
 * 2026-07-30 feature spec: Category Check's Results -- "a tight grid
 * showing only the title/name and the total occurrence count." Compact
 * cells; the FOCUSED candidate renders its full view (name, count, the
 * three pills, plain-language explanation, Sources, All occurrences,
 * Expert View) in a panel ABOVE the grid, and "navigating through the grid
 * auto-opens each subsequent item into the full view" falls straight out
 * of the existing expansion-follows-focus model. Decided cells take their
 * decision's color scheme plus the circled check mark that replaces the
 * percentage everywhere in this pass.
 *
 * DELIBERATE, SPEC-DIRECTED OMISSION: no per-cell/per-panel K-C-R-I
 * buttons in this view yet -- the spec's own closing note ("Once this
 * phase is complete, we will need to add the same KCRIQ buttons here")
 * assigns them to the NEXT phase. Keyboard K/C/R/I fully works on the
 * focused item (keymap.ts is view-agnostic), the Change/Redact inline
 * editors render inside the expanded panel (renderCandidateDetailPanel's
 * header mode) so the keyboard path is complete, the bulk toolbar still
 * operates on the visible set, and List view's rows keep their buttons
 * unchanged for mouse-first work.
 */
function renderResultsGrid(container: HTMLElement, state: ReturnType<WorkspaceCommandDispatcher["getState"]>, visibleIds: string[]): void {
  const heading = el("div", { class: "results-heading" });
  heading.appendChild(el("span", { class: "results-title" }, "Results"));
  const stateLabels: Record<CategoryReviewState, string> = { total: "Total", resolved: "Resolved", unlikely: "Unlikely", toReview: "To Review" };
  const scopeText = `${visibleIds.length} result${visibleIds.length === 1 ? "" : "s"} · ${stateLabels[categoryReviewState]} / ${categoryFilter ? categoryRuleLabel(categoryFilter) : "Show All"}`;
  heading.appendChild(el("span", { class: "results-context" }, scopeText));
  container.appendChild(heading);

  if (visibleIds.length === 0) {
    container.appendChild(el("p", { class: "hint" }, "No candidates match the current narrowing."));
    return;
  }

  const focusedId = state.focus?.target.stage === "item-check" ? state.focus.target.itemId : null;
  const focusedVisible = focusedId !== null && focusedId !== undefined && visibleIds.includes(focusedId) ? focusedId : null;
  if (focusedVisible) {
    const candidate = state.detection?.candidates.find((c) => c.id === focusedVisible);
    if (candidate) {
      const decided = state.reviewSession?.candidateDecisions[focusedVisible];
      const reviewOccurrences = state.classification
        ? groupReviewOccurrencesForCandidate(focusedVisible, state.classification.reviewOccurrences)
        : [];
      // ITEM-SCHEME CASCADE (AG, 2026-07-30): same containment rule as the
      // list view -- pending target, else committed decision, else
      // nav-blue for a focused unprocessed item.
      const panelPending = pendingDecisionOf(isEditingCandidate(focusedVisible, "item-check", "Rename"), isEditingCandidate(focusedVisible, "item-check", "Redact"));
      const panelScheme = panelPending
        ? `${decisionClass(panelPending)} decision-tinted`
        : decided
          ? `${decisionClass(decided.decision)} decision-tinted`
          : "scheme-nav decision-tinted";
      renderCandidateDetailPanel(container, candidate, state.quality, reviewOccurrences, decided?.decision, "item-check", state, { showHeader: true, schemeClass: panelScheme });
    }
  }

  const grid = el("div", { class: "results-grid" });
  for (const candidateId of visibleIds) {
    const candidate = state.detection?.candidates.find((c) => c.id === candidateId);
    if (!candidate) continue;
    const decided = state.reviewSession?.candidateDecisions[candidateId];
    const cell = el("button", { class: "result-cell", "data-item-id": candidateId });
    if (decided) cell.classList.add("result-cell-decided", decisionClass(decided.decision), "decision-tinted");
    if (candidateId === focusedVisible) cell.classList.add("result-cell-focused");
    // INTERACTION LANGUAGE (2026-07-30): X-key selection is the grid's
    // ONLY selection affordance (cells are deliberately tight, no
    // checkbox), so membership must be visible on the cell itself.
    if (selectedCandidateIds.has(candidateId)) cell.classList.add("result-cell-selected");
    // RX-14's acknowledgement stays purely visual here too -- the leaving
    // cell pulses while focus (and the expanded panel) have already moved
    // on. The decided cell's own circled check carries the "saved" cue, so
    // no separate badge is added to these deliberately tight cells.
    if (isAcknowledged({ kind: "candidate", stage: "item-check", candidateId })) cell.classList.add("item-row-acknowledged", "row-acknowledged-pulse");
    if (decided) cell.appendChild(el("span", { class: "reviewed-check", title: `Reviewed -- ${decisionDisplayLabel(decided.decision)}` }, "✓"));
    cell.appendChild(el("span", { class: "result-cell-name" }, candidate.displayValue));
    cell.appendChild(el("span", { class: "result-cell-count" }, `(${candidate.occurrenceIds.length})`));
    cell.addEventListener("click", () => {
      if (acknowledgement) {
        window.clearTimeout(acknowledgement.timeoutHandle);
        acknowledgement = null;
      }
      dispatcher.dispatchNavigation({ family: "navigation", type: "selectItem", itemId: candidateId });
      render();
    });
    grid.appendChild(cell);
  }
  container.appendChild(grid);
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
    announceItemCheckNarrowing(); // RX-18: filter re-application
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
    } else if (event.key === "Escape") {
      // INTERACTION LANGUAGE (2026-07-30): Escape backs out exactly one
      // level, deterministically across browsers (native type=search
      // Escape-clears is inconsistent about firing `input`). Level one:
      // text present -- clear it here ourselves and stay in the box
      // (stopPropagation so the document-level region handler can't ALSO
      // fire and jump two levels in one press). Level two: box already
      // empty -- do nothing here and let the event bubble to the
      // document listener, whose chrome-region branch blurs back to
      // Review mode (this toolbar is a `.keyboard-region`).
      if (searchInput.value !== "") {
        event.preventDefault();
        event.stopPropagation();
        itemCheckQueryState = { ...itemCheckQueryState, searchText: "" };
        searchInputFocusPending = { start: 0, end: 0 };
        announceItemCheckNarrowing(); // RX-18: filter re-application
        render();
      }
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
      announceItemCheckNarrowing(); // RX-18: filter re-application
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
  if (result.ok) {
    selectedCandidateIds.clear();
    // RX-18: bulk results are exactly the kind of "it worked, this is what
    // happened" message the status region exists for -- display label
    // (RX-22), never the durable kind.
    setStatus(`${decisionDisplayLabel(decision)} applied to ${candidateIds.length} candidate(s).`);
  } else {
    notifyToast(`Bulk action failed: ${result.reason}`);
  }
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
    bar.appendChild(button(decisionBulkLabel("Keep", "selected"), () => dispatchBulkDecision("Keep")));
    bar.appendChild(button(decisionBulkLabel("Rename", "selected"), () => dispatchBulkDecision("Rename")));
    bar.appendChild(button(decisionBulkLabel("Redact", "selected"), () => dispatchBulkDecision("Redact")));
    bar.appendChild(button(decisionBulkLabel("Ignore", "selected"), () => dispatchBulkDecision("Ignore")));
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
    if (isEditingBulk("Redact")) renderInlineEditor(bar, redactBlankHint([...selectedCandidateIds], `Optional replacement text for all ${selectedCandidateIds.size} selected`));
  }
  // DECISION REDUCTION (AG, 2026-08-03): Item Check's list view, scoped to
  // whatever this toolbar actually acts on -- the SELECTION when one
  // exists, otherwise everything currently visible -- and in either case
  // narrowed to what still needs a decision, like every other local
  // figure. (Bulk actions themselves already act on the remaining members
  // of the selection, so this matches what pressing one would do.)
  //
  // Scope-follows-selection is deliberate and is the forward-compatible
  // half of this feature: it is precisely the behavior the coming
  // Selection Inspector needs, arrived at here through the ordinary scope
  // contract rather than through anything Inspector-specific.
  const bulkScope = selectedCandidateIds.size > 0 ? [...selectedCandidateIds] : visibleCandidateIds;
  appendCandidateReduction(bar, bulkScope.filter((id) => !isItemResolvedInState("item-check", id, state)), state);
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
  } else {
    // RX-18 (2026-07-29): previously a silent no-op -- now that "]"/"["
    // respect Category Check narrowing (Wave 2 closeout), finding nothing
    // inside a narrow category is a legitimate, common refusal and must
    // say so rather than reading as a dead key.
    refuse(wantDecided ? "No decided items in the current list." : "No undecided items in the current list.");
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
 *  (goToAdjacentInVisibleList) that never pass through
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

/**
 * 2026-07-30 feature spec: grid geometry for the two "parallel navigable
 * sets of cell items -- Categories and Results." Column count is RENDERED
 * geometry (the grids are auto-fill and re-wrap with the viewport), so it
 * is measured from the DOM at the moment of the keypress -- cells sharing
 * the first cell's offsetTop form row one. This lives here in the UI
 * layer, deliberately: FocusNavigator's own doc comment records that 2D
 * grid movement depends on rendered viewport width and "must never" enter
 * the domain (the not-ported `candidateGridColumnCount()` note) -- this is
 * that anticipated UI-side layer, finally built.
 */
/*
 * `anchorId` (AG, 2026-08-03, side-by-side focus pane): measure the grid
 * the cursor is ACTUALLY in, not the first one on the page.
 *
 * The original single-measurement shortcut is recorded below at
 * moveWithinResultsGrid: "Triage's sections are separate grids sharing one
 * column template, so one measurement holds." The focus pane retires that
 * invariant -- the section with an open panel gives its grid ~40% of the
 * width and wraps at two columns, while every other section on the page is
 * still full-width at five. Measuring globally would have made Arrow
 * Down/Up in the active section jump by the INACTIVE sections' column
 * count, i.e. skip rows, which is precisely the class of "the cursor went
 * somewhere I did not point it" bug the spreadsheet model exists to avoid.
 *
 * Scoping by the focused cell's own grid container is also strictly more
 * correct than the previous behavior even in the old layout (nothing ever
 * guaranteed the first grid was the cursor's grid); it just could not be
 * observed while every grid was identical. Falls back to the global
 * measurement whenever the anchor cannot be resolved -- an absent cursor,
 * or the verify harness's fake DOM, which implements neither `closest` nor
 * layout geometry.
 */
/*
 * `scope` IS THE ELEMENT, not an item id (TYPE CHECK MEMBER GRID, AG,
 * 2026-08-04). This took `anchorId: string` and resolved it internally
 * through `gridContainerForItem`, which hard-codes BOTH halves of the
 * lookup: the attribute (`data-item-id`) and the container list
 * (`.triage-grid, .results-grid`). Neither half fits a Type Check member
 * cell -- members are keyed `data-type-member-id` because `data-item-id`
 * on that stage belongs to the TYPE CARD (the domain's traversal unit;
 * the member cursor is presentation state). Passing a member's id would
 * therefore have silently resolved to the type card above and measured
 * the CARD grid's column count, then moved the member cursor by it: the
 * "cursor went somewhere I did not point it" failure this function
 * exists to prevent, arrived at through the function itself.
 *
 * Taking the resolved container instead lets every caller own its own
 * lookup -- `gridContainerForItem` for the id-keyed grids, a local
 * `closest` for Type Check -- while `columnsAcross` stays the single
 * definition of the geometry. The fallback contract is unchanged: a null
 * scope, or a scope with no matching cells, measures page-wide.
 */
function measuredColumnCount(cellSelector: string, scope?: HTMLElement | null): number {
  if (typeof document.querySelectorAll !== "function") return 1;
  // The scoped query keeps the CALLER'S full descendant selector (e.g.
  // ".triage-grid .triage-row"): `Element.querySelectorAll` still resolves
  // ancestors against the whole document, and the scope element is itself
  // the `.triage-grid`, so the selector matches inside it unchanged. No
  // selector string surgery, so callers keep owning their own selectors.
  if (scope && typeof scope.querySelectorAll === "function") {
    const scoped = Array.from(scope.querySelectorAll<HTMLElement>(cellSelector));
    if (scoped.length > 0) return columnsAcross(scoped);
  }
  return columnsAcross(Array.from(document.querySelectorAll<HTMLElement>(cellSelector)));
}

/** Cells sharing the first cell's `offsetTop` form row one -- the geometry
 *  half of measuredColumnCount, factored out so the scoped and global
 *  paths cannot drift apart. */
function columnsAcross(cells: readonly HTMLElement[]): number {
  if (cells.length === 0) return 1;
  const firstTop = cells[0]!.offsetTop;
  let cols = 0;
  for (const cell of cells) {
    if (cell.offsetTop === firstTop) cols += 1;
    else break;
  }
  return Math.max(1, cols);
}

/** The grid container holding a given item's cell, via the `data-item-id`
 *  lookup contract (RX-01). Null whenever the cell, `closest`, or the
 *  container is absent -- every caller falls back to a page-wide
 *  measurement rather than guessing. */
function gridContainerForItem(itemId: string): HTMLElement | null {
  return gridContainerFor(`[data-item-id="${cssAttrEscape(itemId)}"]`, ".triage-grid, .results-grid");
}

/** The member region a given cell sits in. Per-cell rather than per-page:
 *  the two regions have different widths and therefore different column
 *  counts BY DESIGN, so "the grid on this stage" is no longer a single
 *  answer -- exactly the situation measuredColumnCount's scoped anchor was
 *  introduced for on 2026-08-03. */
function memberGridContainerFor(candidateId: string): HTMLElement | null {
  return gridContainerFor(`[data-type-member-id="${cssAttrEscape(candidateId)}"]`, ".type-member-rows");
}

/**
 * ONE COLLECTION, ONE CURSOR, TWO RENDERED REGIONS (AG, 2026-08-04:
 * "Preserve one ordered member collection and one cursor/navigation model
 * across both rendered grid regions").
 *
 * The collection never splits: `group.candidateIds` stays a single ordered
 * list and the cursor is a single index into it. What is per-region is only
 * the ROW ARITHMETIC, because region 1 sits beside the inspector and region
 * 2 has the full width, so they legitimately have different column counts.
 *
 * The rules that follow from treating it as one collection:
 *
 * - LEFT/RIGHT are flat ±1 over the whole list, so the seam is invisible:
 *   Right from the last cell beside the inspector lands on the first cell
 *   below it, because that is genuinely the next member. No region logic at
 *   all -- one collection, read in order.
 *
 * - UP/DOWN move one visual row within the cursor's own region, and CROSS
 *   the seam by COLUMN POSITION rather than by index. Down from the last
 *   row of region 1 lands in region 2 under roughly where the cursor was,
 *   clamped to region 2's last column; Up from region 2's first row returns
 *   to region 1's last row the same way. Landing on "the first cell of the
 *   next region" instead would move the cursor sideways as well as down,
 *   which is the one thing a spreadsheet cursor must never do.
 *
 * - UP off the first row of region 1 backs out to the card level, the
 *   existing rung, now anchored to the top region rather than to index 0.
 *
 * Returns an index, `null` for "stay put" (a real grid edge), or "out" for
 * "leave the member level". Geometry is read at keypress time so it always
 * reflects the layout the reviewer is actually looking at.
 */
function memberGridTarget(idx: number, members: readonly string[], key: string): number | null | "out" {
  const total = members.length;
  if (total === 0) return null;
  if (idx === -1) return 0;
  // One collection: sequential movement ignores the regions entirely.
  if (key === "ArrowRight") return Math.min(total - 1, idx + 1);
  if (key === "ArrowLeft") return idx === 0 ? "out" : idx - 1;
  if (key !== "ArrowUp" && key !== "ArrowDown") return null;

  const topCount = typeof document.querySelectorAll === "function" ? document.querySelectorAll(".type-member-region-top .type-member-row").length : total;
  const topCols = measuredColumnCount(".type-member-region-top .type-member-row", gridContainerFor(".type-member-region-top .type-member-row", ".type-member-rows"));
  const restCols = measuredColumnCount(".type-member-region-rest .type-member-row", gridContainerFor(".type-member-region-rest .type-member-row", ".type-member-rows"));
  const inTop = idx < topCount;

  // WITHIN a region the step is `gridStep` -- the same function the Results
  // and triage grids move by, applied to that region's own count and column
  // width. Only the SEAM is local logic, which is the whole of what having
  // two regions costs.
  const base = inTop ? 0 : topCount;
  const cols = inTop ? topCols : restCols;
  const count = inTop ? topCount : total - topCount;
  const within = gridStep(idx - base, count, cols, key);
  if (within !== null) return base + within;

  // `null` from gridStep means "no row that way inside this region" -- so
  // this is a region boundary, and the only question is whether another
  // region lies beyond it.
  if (key === "ArrowDown") {
    if (!inTop || topCount >= total) return null; // the collection's true bottom edge
    // Seam down: same COLUMN, clamped to region 2's width. Landing on
    // region 2's first cell instead would move the cursor sideways as well
    // as down, which a spreadsheet cursor must never do.
    return Math.min(topCount + Math.min((idx - base) % cols, restCols - 1), total - 1);
  }
  if (inTop) return "out"; // above region 1's first row is the card level
  if (topCount === 0) return "out"; // region 1 empty (narrow viewport): region 2's first row IS the first row
  // Seam up: into region 1's LAST row, same column rule.
  return Math.min(topCols * Math.floor((topCount - 1) / topCols) + ((idx - base) % cols), topCount - 1);
}

/** The generic half, so a surface keyed by any attribute (Type Check's
 *  `data-type-member-id`) resolves its own grid by the same rules rather
 *  than by a second copy of them. */
function gridContainerFor(cellSelector: string, containerSelector: string): HTMLElement | null {
  if (typeof document.querySelector !== "function") return null;
  const cell = document.querySelector<HTMLElement>(cellSelector);
  if (!cell || typeof cell.closest !== "function") return null;
  return cell.closest<HTMLElement>(containerSelector);
}

/** `CSS.escape` where the browser has it, a quote/backslash escape where it
 *  does not (the verify harness's fake DOM). Was inline in
 *  gridContainerForItem; lifted out when a second attribute lookup needed
 *  the same guard. */
function cssAttrEscape(value: string): string {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(value) : value.replace(/["\\]/g, "\\$&");
}

/**
 * WHAT AN ARROW KEY MEANS ON A GRID -- the one definition (AG, 2026-08-04).
 *
 * Lifted verbatim out of moveWithinResultsGrid so Type Check's member
 * cursor can move by exactly the same rules without sharing that
 * function's dispatch (members are NOT focus items -- the cursor is
 * presentation state, so it cannot go through `navigation.selectItem`).
 * Splitting the movement math from the dispatch is what lets the two
 * surfaces agree by construction rather than by two people remembering
 * to keep them the same.
 *
 * Semantics, unchanged from the Results grid: Left/Right move one cell
 * CLAMPED at the ends (matching moveWithinVisibleList's non-wrapping
 * next/previous); Up/Down move one ROW and return null at a grid edge, so
 * the caller can tell "no move" apart from "moved to the boundary" --
 * Type Check needs that distinction, because Up off the first row is its
 * back-out-one-level rung rather than a no-op.
 *
 * Pure: index in, index out, no DOM. `cols` is supplied by the caller
 * (measuredColumnCount), which is the only part that needs layout.
 */
function gridStep(idx: number, count: number, cols: number, key: string): number | null {
  if (count === 0) return null;
  if (idx === -1) return 0;
  if (key === "ArrowRight") return Math.min(count - 1, idx + 1);
  if (key === "ArrowLeft") return Math.max(0, idx - 1);
  if (key === "ArrowDown") return idx + cols < count ? idx + cols : null;
  if (key === "ArrowUp") return idx - cols >= 0 ? idx - cols : null;
  return null;
}

/** Spreadsheet-style arrow movement over the Results grid ("U/D/L/R arrows
 *  go through the grid like a spreadsheet"): Left/Right move one cell
 *  (clamped at the ends, matching moveWithinVisibleList's non-wrapping
 *  next/previous), Up/Down move one ROW (± measured column count), staying
 *  put at a grid edge exactly like a spreadsheet cursor. Focus change =
 *  ordinary navigation.selectItem; the expanded full view follows focus by
 *  the existing model, which IS the spec's "navigating through the grid
 *  auto-opens each subsequent item into the full view." */
// `cellSelector` (2026-07-30, Triage Queue): the same spreadsheet arrows
// serve any uniform auto-fill grid of item cells -- the column count is
// measured from whichever grid is on screen.
//
// This note used to add: "Triage's sections are separate grids sharing one
// column template, so one measurement holds." That is NO LONGER TRUE as of
// the side-by-side focus pane (AG, 2026-08-03) -- the section with an open
// detail panel narrows its grid to ~40% width while its neighbours stay
// full-width, so sections on one page legitimately differ in column count.
// The cursor's own grid is therefore passed as the measurement anchor; see
// measuredColumnCount.
//
// The movement arithmetic itself now lives in `gridStep` (2026-08-04), so
// Type Check's member cursor moves by the same rules over its own grid.
// This function keeps what is specific to it: resolving the anchor by
// `data-item-id`, and dispatching the move as domain focus.
function moveWithinResultsGrid(visibleIds: string[], currentId: string | null, key: string, cellSelector = ".results-grid .result-cell"): void {
  if (visibleIds.length === 0) return;
  const idx = currentId ? visibleIds.indexOf(currentId) : -1;
  const cols = measuredColumnCount(cellSelector, currentId ? gridContainerForItem(currentId) : null);
  const target = gridStep(idx, visibleIds.length, cols, key);
  if (target === null || target === idx) return; // spreadsheet edge: stay put
  dispatcher.dispatchNavigation({ family: "navigation", type: "selectItem", itemId: visibleIds[target]! });
  render();
}

/** The PARALLEL set: Shift+Arrows traverse the Category cells "in the same
 *  manner," and changing category dynamically changes the Results --
 *  selection here is Category Check's categoryFilter, not FocusNavigator
 *  state (categories are a UI narrowing concept; the domain has no cursor
 *  for them). Cell order and geometry are read from the rendered grid so
 *  keyboard order is definitionally visual order. Entering the set from
 *  Show All (no category selected) lands on the first cell; picking a
 *  category resets the context-filter axis exactly like a mouse click. */
/**
 * INTERACTION LANGUAGE (2026-07-30): the Shift+Arrow entry point for the
 * WHOLE narrowing column, not just the category grid. Routing: the two
 * header rows (Review State, Filter) are handled by moveWithinFilterHeader;
 * the category area (Show All + grid) keeps moveCategorySelection's
 * existing, landed semantics unchanged. This function only decides which
 * of the two regimes the cursor is currently in.
 */
function moveFilterNavigation(key: string): void {
  if (filterHeaderRow === "state" || filterHeaderRow === "filter") {
    moveWithinFilterHeader(key);
    return;
  }
  moveCategorySelection(key);
}

/**
 * The header rows' half of the Shift+Arrow column. Grammar (see
 * filterHeaderRow's doc comment): within a row, Shift+Left/Right SELECTS
 * the adjacent chip -- each row is single-select, so position and selection
 * are the same thing and "Results change live" (the property Andrew liked
 * about the category grid) holds here identically, status narration
 * included. Shift+Up/Down TRAVELS between rows without changing any
 * selection -- deliberately different from the grid (where vertical
 * movement selects, spreadsheet-style), because the header rows are
 * heterogeneous single-select axes stacked vertically, not one homogeneous
 * 2D set; selecting-while-passing here would re-filter three times on the
 * way down. PROTOTYPE NOTE (disclosed, per the change request's own "if it
 * feels spatially confusing, propose an alternative"): this mixed
 * vertical semantics (travel between header rows, select within the grid)
 * is the one spot the grammar bends; the honest evaluation in the
 * implementation findings flags it for real-use judgment.
 *
 * Side effects mirror the chips' own click handlers exactly (Total clears
 * category + context; every change narrates via RX-18) -- same functions,
 * same announcements, so keyboard and mouse can never drift.
 */
function moveWithinFilterHeader(key: string): void {
  if (filterHeaderRow === "state") {
    const order: CategoryReviewState[] = ["total", "resolved", "unlikely", "toReview"];
    const idx = order.indexOf(categoryReviewState);
    if (key === "ArrowLeft" || key === "ArrowRight") {
      const next = order[key === "ArrowRight" ? Math.min(order.length - 1, idx + 1) : Math.max(0, idx - 1)]!;
      if (next === categoryReviewState) return; // row edge: stay
      categoryReviewState = next;
      if (next === "total") {
        // Same reset the Total chip's click performs -- see that handler.
        categoryFilter = null;
        categoryContextFilter = "all";
      }
      announceItemCheckNarrowing(); // RX-18: filter re-application
      render();
      return;
    }
    if (key === "ArrowDown") {
      filterHeaderRow = "filter";
      render(); // cursor ring moves; no selection change
    }
    return; // Up from the top row: stay (nothing above Review State)
  }
  // filterHeaderRow === "filter"
  const keys = CATEGORY_CONTEXT_FILTERS.map((option) => option.key);
  const idx = keys.indexOf(categoryContextFilter);
  if (key === "ArrowLeft" || key === "ArrowRight") {
    const next = keys[key === "ArrowRight" ? Math.min(keys.length - 1, idx + 1) : Math.max(0, idx - 1)]!;
    if (next === categoryContextFilter) return;
    categoryContextFilter = next;
    announceItemCheckNarrowing(); // RX-18: filter re-application
    render();
    return;
  }
  if (key === "ArrowUp") {
    filterHeaderRow = "state";
    render();
    return;
  }
  if (key === "ArrowDown") {
    filterHeaderRow = "category";
    render(); // lands back on the category area's own position (Show All, or the selected cell)
  }
}

function moveCategorySelection(key: string): void {
  if (typeof document.querySelectorAll !== "function") return;
  const cells = Array.from(document.querySelectorAll<HTMLElement>(".category-grid .category-cell"));
  if (cells.length === 0) return;
  const keys = cells.map((cell) => cell.getAttribute("data-category") ?? "");
  const cols = measuredColumnCount(".category-grid .category-cell");

  // AG response (2026-07-30): the "Show All" link is navigable too --
  // a virtual position BEFORE the grid, "despite technically not being
  // 'in' the grid": Down/Right from Show All enters the first cell;
  // Up from ANY cell in the top row (and Left from the first cell)
  // returns to Show All. The Filter axis is cumulative and unaffected.
  // INTERACTION LANGUAGE (2026-07-30): Up from Show All now continues
  // into the Filter header row (travel only, no selection change) --
  // Show All is the seam between the grid regime and the header regime.
  if (categoryFilter === null) {
    if (key === "ArrowUp") {
      filterHeaderRow = "filter";
      render();
      return;
    }
    if (key !== "ArrowDown" && key !== "ArrowRight") return; // Left from Show All: stay
    categoryFilter = keys[0]!;
    announceItemCheckNarrowing(); // RX-18: filter re-application
    render();
    return;
  }

  const idx = keys.indexOf(categoryFilter);
  let target: number | null;
  if (idx === -1) target = 0;
  else if (key === "ArrowRight") target = Math.min(keys.length - 1, idx + 1);
  else if (key === "ArrowLeft") target = idx === 0 ? -1 : idx - 1; // -1 = Show All
  else if (key === "ArrowDown") target = idx + cols < keys.length ? idx + cols : null;
  else if (key === "ArrowUp") target = idx - cols >= 0 ? idx - cols : -1; // top row -> Show All
  else target = null;
  if (target === null || target === idx) return;
  categoryFilter = target === -1 ? null : keys[target]!;
  announceItemCheckNarrowing(); // RX-18: filter re-application
  render();
}

/**
 * ITEM CHECK'S POOL (AG, 2026-08-02, "Item Check shows remaining work") --
 * what every Item Check view renders from, before search/filter/sort or
 * Category Check's own narrowing runs on top of it.
 *
 * Normally the WORK QUEUE: unresolved candidates only, delegated to the
 * domain's reviewableItemIdsForStage() (stages.ts) rather than re-derived
 * here, so "still to decide" means one thing in this app. A candidate
 * leaves the moment it is decided -- here, in Ambiguity Check, or by a
 * Group Check bulk action -- and comes back if that decision is undone.
 *
 * Widens to the FULL candidate inventory when the reviewer has explicitly
 * asked for decided work (itemCheckQuery.ts's queryRequestsDecidedItems --
 * see its doc comment for the two triggers and why each one is a request
 * rather than a guess). This is what keeps "searchability should remain
 * intact" true: the queue is a default, not a wall.
 *
 * ONE POOL FOR EVERY VIEW, deliberately. List, By Category and Triage all
 * read this, as does visibleItemCheckIds() -- so the rows on screen, the
 * Category Check counts, the arrow-key order, the post-decision advance and
 * "Select all visible" can never disagree about what Item Check contains.
 * Mirrors the context assembly isItemResolvedInState() already uses to
 * reach the domain from here; falls back to the raw candidate list before
 * a workspace is loaded.
 */
function itemCheckPoolIds(state: ReturnType<WorkspaceCommandDispatcher["getState"]>): string[] {
  const allIds = state.detection?.candidates.map((c) => c.id) ?? [];
  if (!state.detection || !state.grouping || !state.reviewSession) return allIds;
  if (queryRequestsDecidedItems(itemCheckQueryState)) return allIds;
  return reviewableItemIdsForStage(
    "item-check",
    { detection: state.detection, grouping: state.grouping, ...(state.semanticTypes ? { semanticTypes: state.semanticTypes } : {}) },
    state.reviewSession
  );
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
  const candidateIds = itemCheckPoolIds(state);
  const listIds = queryItemCheck(buildCandidateQueryFacts(candidateIds, state), itemCheckQueryState).map((f) => f.candidate.id);
  // TRIAGE QUEUE (2026-07-30): the visible order IS the section-grouped
  // queue order, so arrow keys and the post-decision auto-advance walk the
  // queue exactly as displayed -- the same "displayed order is keyboard
  // order" contract the list and category views already honor.
  if (itemCheckViewMode === "triage") return triageQueueOrder(triageItemsFor(listIds, state));
  if (itemCheckViewMode !== "category") return listIds;
  return narrowByCategoryView(buildCategoryViewFacts(listIds, state), {
    reviewState: categoryReviewState,
    categoryFilter,
    contextFilter: categoryContextFilter,
  });
}

/**
 * REVIEW SCOPE, Pass 1 (AG, 2026-08-03) -- THE single assembler.
 *
 * This is the only call site of `resolveReviewScope` in this file, and
 * every surface that explains or acts on "the current scope" reads it:
 * the inspector pane (renderScopeInspector), the scope-mode keyboard gate
 * (handleScopeModeKey), the command-bar legend, and the decision-
 * provenance stamp (dispatchReviewWithVisibleAdvance). One derivation, so
 * what is painted and what a keystroke does can never disagree about what
 * the reviewer is holding -- the card-targeted-letters discipline, one
 * level up. Enforced structurally by ui-smoke.
 *
 * Null when there is no Item Check context to resolve against (nothing
 * loaded, or focus in another stage) -- Pass 1 models Item Check only.
 *
 * Input notes:
 *  - remainder = the DISPLAYED queue (visibleItemCheckIds), not the raw
 *    pool, keeping the inspector's counts in lockstep with the rows on
 *    screen (the ONE-POOL contract). Under an active search the zero
 *    state describes what the queue shows, and says so.
 *  - selection = checked ids intersected with that displayed list, in
 *    display order (the same section-local consumers the heading buttons
 *    use remain untouched).
 *  - the artifact axis rides along (unaddressed, undismissed structural
 *    cards) so the remainder scope counts BOTH kinds of remaining work --
 *    the active-work model's whole point.
 */
function currentReviewScope(state: ReturnType<WorkspaceCommandDispatcher["getState"]>): ReviewScope | null {
  if (!state.detection) return null;
  const target = state.focus?.target;
  if (target?.stage !== "item-check") return null;
  const displayed = visibleItemCheckIds(state);
  const selected = displayed.filter((id) => selectedCandidateIds.has(id));
  return resolveReviewScope({
    remainderItemIds: displayed.filter((id) => !state.reviewSession?.candidateDecisions[id]),
    remainderArtifactIds: itemCheckViewMode === "triage" ? unaddressedStructuralCardIds(state) : [],
    selectedItemIds: selected,
    focusedItemId: target.itemId ?? null,
    artifactCursorId: itemCheckViewMode === "triage" ? (structuralCardFocusPending as string | null) : null,
    widened: scopeWidenedFrom !== null,
  });
}

/** The card half of the remaining work, in display order -- the same
 *  active/addressed rules firstUnaddressedStructuralCardId applies. */
function unaddressedStructuralCardIds(state: ReturnType<WorkspaceCommandDispatcher["getState"]>): string[] {
  const dismissals = state.reviewSession?.relationshipDismissals ?? {};
  const decisions = state.reviewSession?.candidateDecisions ?? {};
  const candidates = state.detection?.candidates ?? [];
  const active = (state.structuralRelationships?.proposals ?? []).filter(
    (proposal) => !dismissals[proposal.proposalId] && proposal.candidateIds.some((id) => candidates.some((c) => c.id === id))
  );
  return structuralCardDisplayOrder(active)
    .filter((proposal) => !proposal.candidateIds.every((id) => Boolean(decisions[id])))
    .map((proposal) => proposal.proposalId);
}

/** Widening validity is DERIVED (see scopeWidenedFrom's doc comment):
 *  still-valid only while focus sits on exactly the item the reviewer
 *  widened from, in Item Check's triage view. Runs at render()'s top,
 *  the reconcileSourceView shape. */
function reconcileScopeWidening(state: ReturnType<WorkspaceCommandDispatcher["getState"]>): void {
  if (scopeWidenedFrom === null) return;
  const target = state.focus?.target;
  if (itemCheckViewMode !== "triage" || target?.stage !== "item-check" || target.itemId !== scopeWidenedFrom) {
    scopeWidenedFrom = null;
  }
}

/** Triage sectioning inputs: id + decision-blind archetype + type. */
function triageItemsFor(candidateIds: readonly string[], state: ReturnType<WorkspaceCommandDispatcher["getState"]>): TriageQueueItem[] {
  return candidateIds.flatMap((id) => {
    const candidate = state.detection?.candidates.find((c) => c.id === id);
    if (!candidate) return [];
    return [{ id, archetype: triageRecommendationForCandidate(id, state)?.archetype ?? null, detectedType: candidate.detectedType }];
  });
}

/** AMBIGUITY CATEGORY-FIRST (AG, 2026-08-02): sectioning inputs for the
 *  Ambiguity queue -- the triage facts plus the semantic-alias FLAVOR
 *  (nickname vs organizational alias), read off the suggested option's
 *  own evidence lines. The prefixes are the providers' stable label
 *  vocabulary: RelatedNameProvider emits "Related name..." lines,
 *  FullValueAliasProvider "Alias: ..." / "Acronym: ..." (kept in sync
 *  with recommendations.ts's knowledgeBacked regex). Decision-blind for
 *  the same reason as triage: a row's section must not change the moment
 *  it is decided. */
function ambiguityItemsFor(candidateIds: readonly string[], state: ReturnType<WorkspaceCommandDispatcher["getState"]>): AmbiguityQueueItem[] {
  return candidateIds.flatMap((id) => {
    const candidate = state.detection?.candidates.find((c) => c.id === id);
    if (!candidate) return [];
    // One facts assembly, two pure derivations (archetype + tier) -- see
    // recommendationFactsForCandidate's doc comment.
    const facts = recommendationFactsForCandidate(id, state);
    const rec = facts ? deriveRecommendation(facts) : null;
    const tier = facts ? deriveReviewTier(facts, rec) : null;
    let aliasFlavor: AliasFlavor = null;
    if (rec?.archetype === "semantic-alias") {
      const options = state.grouping?.ambiguityProposals.find((p) => p.candidateId === id)?.candidateGroupOptions ?? [];
      const primaryOp = rec.suggestions[0]?.op;
      const suggestedGroupId = primaryOp?.kind === "link" ? primaryOp.groupId : undefined;
      const option = options.find((o) => o.groupId === suggestedGroupId) ?? options.find((o) => o.evidence && o.evidence.length > 0);
      aliasFlavor = option?.evidence?.some((line) => line.startsWith("Alias:")) ? "org-alias" : "nickname";
    }
    return [{ id, archetype: rec?.archetype ?? null, detectedType: candidate.detectedType, aliasFlavor, tier }];
  });
}

/** The Ambiguity stage's reviewer-visible order: the section-grouped
 *  queue order -- the same "displayed order is keyboard order" contract
 *  visibleItemCheckIds honors for the triage view. Before the
 *  category-first refactor this was the raw proposal order (the two
 *  coincided because display WAS the flat proposal list). */
function visibleAmbiguityIds(state: ReturnType<WorkspaceCommandDispatcher["getState"]>): string[] {
  const candidateIds = state.grouping?.ambiguityProposals.map((p) => p.candidateId) ?? [];
  return ambiguityQueueOrder(ambiguityItemsFor(candidateIds, state));
}

/**
 * TRIAGE QUEUE (2026-07-30, Andrew's "Implementation request -- Triage
 * Queue review mode"): compact sectioned rows optimized for throughput.
 * Progressive disclosure: a row is one line ("☐ Andrew → Andrew Goodloe");
 * accepting is ONE action (click the arrow, or Enter) and focus advances
 * to the next unresolved item through the SAME dispatchReviewWithVisible-
 * Advance choke point every decision path uses; the full existing review
 * UI (KCRIQ, conclusion, Why?, Sources, occurrences, Expert View --
 * renderCandidateDetailPanel, reused not redesigned) appears only when
 * the reviewer explicitly expands a row (Space / chevron / Enter on a row
 * with nothing to accept). Accepted rows STAY PUT with a green ✓ -- the
 * queue never shifts while the reviewer is working. Sections carry the
 * explanation once, so rows don't repeat it.
 */
function renderTriageQueue(container: HTMLElement, state: ReturnType<WorkspaceCommandDispatcher["getState"]>, candidateIds: string[]): void {
  if (candidateIds.length === 0) {
    container.appendChild(el("p", {}, "Nothing to review in this stage."));
    return;
  }
  const sections = buildTriageSections(triageItemsFor(candidateIds, state));
  // REVIEW SCOPE, Pass 1 (AG, 2026-08-03): the PERMANENT inspector. The
  // side-by-side pane graduates from a per-section split (which existed
  // only while that section held an open panel) to a workspace-level left
  // column that is ALWAYS populated -- with the focused item's detail
  // panel (the existing experience, relocated but unchanged in content),
  // or with an explanation of whatever wider scope the reviewer is
  // holding (selection / remaining work / a card). Fixed workspace,
  // moving map: neither region ever appears, disappears, or reflows the
  // other. This deliberately SUPERSEDES the 2026-08-03 side-by-side
  // finding's "once editing in a section is complete, it reverts to
  // standard grid" -- permanence IS the point of the inspector (disclosed
  // in the Pass 1 findings doc). Ambiguity Check keeps the per-section
  // split unchanged (Pass 1 does not generalize across stages).
  const scope = currentReviewScope(state);
  if (!scope) {
    renderSectionedQueue(container, state, sections, TRIAGE_QUEUE_POLICY);
    return;
  }
  const split = el("div", { class: "scope-split" });
  // Inspector FIRST in the DOM -- same reading-order/tab-order reasoning
  // as the per-section pane it replaces (see renderSectionedQueue's
  // focus-pane note); below the breakpoint it stacks on top.
  const inspector = el("div", { class: "scope-inspector" });
  const queueHost = el("div", { class: "scope-queue" });
  const pane: WorkspacePaneSink = { scopeKind: scope.source.kind, panels: [] };
  renderSectionedQueue(queueHost, state, sections, TRIAGE_QUEUE_POLICY, pane);
  renderScopeInspector(inspector, state, scope, pane.panels);
  split.appendChild(inspector);
  split.appendChild(queueHost);
  container.appendChild(split);
}

/**
 * REVIEW SCOPE, Pass 1: the inspector pane's content, by scope kind. One
 * renderer, specialized by the shape of what the reviewer is holding --
 * the single-item case IS today's detail panel, byte-identical and
 * headerless (the degenerate case, not a separate state).
 *
 * The zero state (stage-remainder) and the selection state share one
 * partition presentation: the SAME triage sections the queue itself is
 * grouped by (buildTriageSections -- one vocabulary, never a second
 * grouping that could disagree with the headings on the right). Actions
 * deliberately stay on the section headings in the queue: Pass 1 adds no
 * second dispatch surface; the heading buttons already scope themselves
 * to checked items (headingActionScope), so the selection state's
 * "largest safe decision" affordances exist and are simply POINTED AT
 * rather than duplicated. Scope-level actions inside the inspector are
 * Pass 3 (the scope-action layer), by design.
 */
function renderScopeInspector(
  host: HTMLElement,
  state: ReturnType<WorkspaceCommandDispatcher["getState"]>,
  scope: ReviewScope,
  panels: readonly HTMLElement[]
): void {
  const source = scope.source;
  if (source.kind === "item-focus") {
    // The existing single-item detail experience, relocated but unchanged
    // in content, scheme, and keyboard entry (the render-tail
    // detail-panel focus restore queries by class, not by location).
    for (const panel of panels) host.appendChild(panel);
    return;
  }

  const itemIds = scope.units.filter((u) => u.axis === "item").map((u) => u.id);
  const artifactCount = scope.units.filter((u) => u.axis === "artifact").length;
  const header = el("div", { class: "scope-inspector-header" });

  if (source.kind === "artifact-focus") {
    const proposal = (state.structuralRelationships?.proposals ?? []).find((p) => p.proposalId === source.artifactId);
    header.appendChild(el("span", { class: "scope-inspector-title" }, "Structural relationship"));
    host.appendChild(header);
    const memberCount = proposal?.candidateIds.length ?? 0;
    host.appendChild(
      el(
        "p",
        { class: "scope-inspector-note" },
        proposal
          ? `A proposed ${proposal.kind === "acronym" ? "acronym relationship" : "identifier pattern"} covering ${memberCount} item${memberCount === 1 ? "" : "s"} is selected. Its controls are on the card below the queue.`
          : "A structural relationship card is selected. Its controls are on the card below the queue."
      )
    );
    appendForcedPanels(host, panels);
    return;
  }

  const isSelection = source.kind === "selection";
  header.appendChild(el("span", { class: "scope-inspector-title" }, isSelection ? "Your selection" : "Remaining work"));
  const countBits = [`${itemIds.length} item${itemIds.length === 1 ? "" : "s"}`];
  if (artifactCount > 0) countBits.push(`${artifactCount} relationship card${artifactCount === 1 ? "" : "s"}`);
  header.appendChild(el("span", { class: "scope-inspector-count" }, countBits.join(" · ")));
  host.appendChild(header);
  // The zero state describes what the queue SHOWS (the ONE-POOL contract);
  // under an active search/filter it says so instead of silently
  // describing rows that are not on screen.
  if (!isSelection && visibleItemCheckIds(state).length < itemCheckPoolIds(state).length) {
    host.appendChild(el("p", { class: "scope-inspector-note" }, "Narrowed by your search/filter — the counts describe the rows currently shown."));
  }

  // The decision opportunities: the queue's own sections, summarized.
  for (const section of buildTriageSections(triageItemsFor(itemIds, state))) {
    const block = el("div", { class: "scope-section" });
    const title = el("div", { class: "scope-section-titleline" });
    title.appendChild(el("span", { class: "scope-section-title" }, section.label));
    title.appendChild(el("span", { class: "scope-section-count" }, String(section.candidateIds.length)));
    block.appendChild(title);
    const explanation = TRIAGE_SECTION_EXPLANATIONS[section.id];
    if (explanation) block.appendChild(el("p", { class: "scope-section-explanation" }, explanation));
    const members = el("div", { class: "scope-section-members" });
    const shown = section.candidateIds.slice(0, 12);
    for (const id of shown) {
      const candidate = state.detection?.candidates.find((c) => c.id === id);
      if (candidate) members.appendChild(el("span", { class: "scope-section-member" }, candidate.displayValue));
    }
    if (section.candidateIds.length > shown.length) {
      members.appendChild(el("span", { class: "scope-section-member scope-section-member-more" }, `+${section.candidateIds.length - shown.length} more`));
    }
    block.appendChild(members);
    host.appendChild(block);
  }

  if (isSelection) {
    const footer = el("div", { class: "scope-inspector-footer" });
    footer.appendChild(
      el("p", { class: "scope-inspector-note" }, "The green buttons on each section heading act on your checked items in that section. Decision letters return once you clear the selection.")
    );
    const clear = button("Clear selection", () => {
      selectedCandidateIds.clear();
      setStatus("Selection cleared."); // RX-18
      render();
    });
    clear.classList.add("scope-inspector-clear");
    footer.appendChild(clear);
    host.appendChild(footer);
  } else {
    host.appendChild(
      el(
        "p",
        { class: "scope-inspector-note scope-inspector-footer" },
        scopeWidenedFrom !== null
          ? "Each section heading's green buttons decide that section in one step. Enter or ↓ returns to the item you were on."
          : "Each section heading's green buttons decide that section in one step."
      )
    );
  }
  appendForcedPanels(host, panels);
}

/** Panels that must stay visible under ANY scope (a Space/chevron
 *  hold-open, an open Change/Redact editor) render after the scope
 *  content, never instead of it. */
function appendForcedPanels(host: HTMLElement, panels: readonly HTMLElement[]): void {
  for (const panel of panels) host.appendChild(panel);
}

/**
 * AMBIGUITY CATEGORY-FIRST (AG, 2026-08-02, "The ambiguity class is the
 * review unit. The individual candidates are the evidence."): the
 * Ambiguity stage's entity-ambiguity candidates render through the SAME
 * sectioned-queue renderer as Item Check's Triage view, under the
 * ambiguity section vocabulary (triageQueue.ts's buildAmbiguitySections
 * -- see its doc comment for the two deliberate mapping divergences).
 * Presentation only: rows, recommendations, the detail panel, and every
 * decision path are the shared implementations.
 */
function renderAmbiguityQueue(container: HTMLElement, state: ReturnType<WorkspaceCommandDispatcher["getState"]>, candidateIds: string[]): void {
  if (candidateIds.length === 0) return; // structural cards may still follow; the caller owns the both-empty message
  renderSectionedQueue(container, state, buildAmbiguitySections(ambiguityItemsFor(candidateIds, state)), AMBIGUITY_QUEUE_POLICY);
}

/** One section of the queue, vocabulary-agnostic -- both section builders
 *  produce this shape. REVIEW CONFIDENCE TIERS (AG, 2026-08-02):
 *  sections may optionally partition into tier groups ("Strong
 *  Recommendations" / "Needs Review"); a section without tiers renders
 *  exactly as before. */
interface SectionedQueueTierGroup {
  id: string;
  label: string;
  hint: string;
  candidateIds: string[];
}

interface SectionedQueueSection {
  id: string;
  label: string;
  candidateIds: string[];
  tiers?: SectionedQueueTierGroup[];
}

/** What varies between the two sectioned-queue surfaces: which stage the
 *  rows' focus/editors/decisions bind to, and the section vocabulary's
 *  explanation + bulk-action policy (legacy Accept All config, or the
 *  tier-action vocabulary). Everything else -- row markup, expansion,
 *  recommendations, completion greening, keyboard grammar -- is
 *  renderSectionedQueue, shared by construction: the renderer contains
 *  NO category-specific logic. */
interface SectionedQueuePolicy {
  stage: "item-check" | "ambiguity-check";
  explanationFor(sectionId: string): string | undefined;
  acceptFor(sectionId: string): AcceptAllConfig | undefined;
  acceptTitleFor(sectionId: string, config: AcceptAllConfig): string;
  /** Tier-action vocabulary (data-driven; see AMBIGUITY_TIER_ACTIONS).
   *  Absent = this surface has no tier actions (the triage view keeps
   *  its deliberate suggestion-first-with-fallback Accept All hybrid
   *  until Andrew asks it to adopt tiers). */
  tierActionsFor?(sectionId: string, tierId: string): SectionAction[] | undefined;
  /**
   * SECTION-level declared actions (AG, 2026-08-03), as distinct from the
   * tier-level vocabulary above. Needed because the triage view has no
   * tiers at all, so `tierActionsFor` never fires there -- and "None are
   * names" belongs to the Likely People SECTION, not to a tier inside it.
   */
  sectionActionsFor?(sectionId: string): SectionAction[] | undefined;
}

const TRIAGE_QUEUE_POLICY: SectionedQueuePolicy = {
  stage: "item-check",
  explanationFor: (id) => TRIAGE_SECTION_EXPLANATIONS[id as TriageSectionId],
  // The pre-existing triage vocabulary expresses only the fallback mode;
  // wrapped into AcceptAllConfig so both policies share one accept path.
  acceptFor: (id) => {
    const fallback = TRIAGE_SECTION_ACCEPT_DEFAULT[id as TriageSectionId];
    return fallback ? { fallback } : undefined;
  },
  acceptTitleFor: (id) =>
    id === "people"
      ? "Keep every undecided item as-is (items with a specific suggestion accept that suggestion instead)"
      : "Mark every undecided item as not-PII (Ignore); items with a specific suggestion accept that instead",
  // "NONE ARE NAMES" (AG, 2026-08-03). Likely People is where the
  // person-typed junk actually lands -- triageSectionFor sends every
  // `uncertain` person-typed item here, so "Thanks Andrew", "Good Morning"
  // and "Hello All" sit in the section whose premise is that these ARE
  // people. This is the group form of their own ② chip, and the only
  // section-level exit that section has ever had.
  //
  // Wording follows the items: their chip says "Not a name", not "Not
  // personal", because in a section OF names the meaningful claim is about
  // nameness. Same chord (Opt N) and same underlying Ignore as every other
  // "none are..." button -- one key, one meaning, the sentence varying with
  // what the section holds.
  //
  // Declared ONLY for people: every other triage section already states a
  // conclusion of its own, and a second button applying the same Ignore
  // would be the duplicate this vocabulary keeps avoiding.
  sectionActionsFor: (id) =>
    id === "people"
      ? [
          {
            label: "None are names",
            op: { kind: "bulk-decision", decision: "Ignore" },
            hint: "Treat every remaining item here as not a person reference -- greetings, sign-offs and stray phrases the detector read as names. The text is left alone.",
            selectedLabel: decisionBulkLabel("Ignore", "selected"),
          },
        ]
      : undefined,
};

const AMBIGUITY_QUEUE_POLICY: SectionedQueuePolicy = {
  stage: "ambiguity-check",
  explanationFor: (id) => AMBIGUITY_SECTION_EXPLANATIONS[id as keyof typeof AMBIGUITY_SECTION_EXPLANATIONS],
  // TIERS (2026-08-02): the ambiguity categories replaced the single
  // Accept All with per-tier action vocabularies -- no legacy config.
  acceptFor: () => undefined,
  acceptTitleFor: () => "",
  tierActionsFor: (sectionId, tierId) => AMBIGUITY_TIER_ACTIONS[sectionId as AmbiguitySectionId]?.[tierId as ReviewTierId],
};

/**
 * REVIEW SCOPE, Pass 1: when the caller owns a workspace-level inspector
 * (Item Check's triage view), open detail panels are collected HERE and
 * handed back through this sink instead of forming a per-section split --
 * the renderer stays vocabulary-agnostic and Ambiguity Check (no sink)
 * keeps the per-section split byte-for-byte.
 *
 * `scopeKind` also decides row expansion: a focused row expands only
 * while the ITEM is the scope. Under a wider scope (selection / remainder
 * / a card) the focused row renders as a PARKED cursor -- position
 * preserved, muted treatment, no panel -- because the inspector is
 * explaining the wider scope and exactly one surface may read as "what
 * I'm holding" at a time. Precedent: the rows-then-cards seam already
 * parks the row cursor while the card cursor is the working object.
 * Explicitly-requested panels stay visible regardless (a Space/chevron
 * hold-open, or an open Change/Redact editor -- an editing row is
 * expanded BY DEFINITION and must land somewhere visible).
 */
interface WorkspacePaneSink {
  scopeKind: "stage-remainder" | "selection" | "item-focus" | "artifact-focus";
  panels: HTMLElement[];
}

function renderSectionedQueue(
  container: HTMLElement,
  state: ReturnType<WorkspaceCommandDispatcher["getState"]>,
  sections: SectionedQueueSection[],
  policy: SectionedQueuePolicy,
  workspacePane?: WorkspacePaneSink
): void {
  const stage = policy.stage;
  // "When finished, collapse the row back": a decision on the expanded
  // item closes it -- unless its Change/Redact editor is still open.
  if (
    triageExpandedId &&
    state.reviewSession?.candidateDecisions[triageExpandedId] &&
    !isEditingCandidate(triageExpandedId, stage, "Rename") &&
    !isEditingCandidate(triageExpandedId, stage, "Redact")
  ) {
    triageExpandedId = null;
  }
  const queue = el("div", { class: "triage-queue" });
  for (const section of sections) {
    const sectionEl = el("div", { class: "triage-section" });
    // `remainingIds` (not just a count) so the section's Decision Reduction
    // figure below is scoped to EXACTLY the set this line calls remaining.
    const remainingIds = section.candidateIds.filter((id) => !state.reviewSession?.candidateDecisions[id]);
    const done = section.candidateIds.length - remainingIds.length;
    const remaining = remainingIds.length;
    // CATEGORY-FIRST REVIEW (AG, 2026-07-30): the category is the primary
    // object -- title line (name, progress, Accept All Remaining), then
    // the one-line conclusion beneath; a fully-complete category takes
    // the app's green completion styling so the interface visibly turns
    // green as review progresses and the eye hunts remaining categories.
    if (remaining === 0) sectionEl.classList.add("triage-section-complete");
    const heading = el("div", { class: "triage-section-heading" });
    const titleLine = el("div", { class: "triage-section-titleline" });
    titleLine.appendChild(el("span", { class: "triage-section-title" }, section.label));
    titleLine.appendChild(el("span", { class: "triage-section-count" }, `${done} complete • ${remaining} remaining`));
    // DECISION REDUCTION (AG, 2026-08-03): scoped to what REMAINS here, so
    // it reads as the opportunity still in front of the reviewer and
    // shrinks with the count beside it. Sits next to the progress count
    // deliberately: "N remaining" is what is left to do, "23 / 418 = 395
    // avoided" is what doing it disposes of. Vanishes when the section is
    // finished (empty scope -> suppressed).
    appendCandidateReduction(titleLine, remainingIds, state);
    // ROW SELECTION (AG, 2026-08-03): the select-all follows the buttons,
    // and in a MULTI-tier section the buttons live on the tier headings --
    // so the section title line claims it only in the 0/1-tier shapes,
    // mirroring the `numbered` argument passed to emitSectionActions below
    // for exactly the same reason.
    if ((section.tiers ?? []).length <= 1) appendHeadingSelectionControls(titleLine, section.candidateIds, state);
    // ACCEPT ALL REMAINING: applies the category interpretation to every
    // unresolved VISIBLE item -- per-item recommendations are honored
    // first, everything else takes the section's own conclusion (or, in
    // recommendationsOnly sections, stays put and is narrated). Nothing
    // disappears and every item stays individually overridable
    // afterward (ordinary decisions, ordinary audit).
    // SECTION-ACTION DIGITS (AG, 2026-08-02): emitted through the shared
    // descriptor path below, so this button is numbered by the same
    // function the digit handler reads. Tier actions join the SAME
    // titleLine list in the one-tier layout, and are therefore numbered as
    // one list -- never two independent passes that would both mint a ⑨.
    const sectionLevel = headingSectionActions(policy, section, null, state);
    heading.appendChild(titleLine);
    // Explanation sentences REMOVED from the body (AG, 2026-08-02, "remove
    // the little clarifier sentences in grey ... entirely") -- the section
    // labels carry the meaning; the sentence survives only as the title's
    // hover tooltip, so it costs no vertical space and no visual noise.
    const explanation = policy.explanationFor(section.id);
    if (explanation) (titleLine.firstChild as HTMLElement | null)?.setAttribute?.("title", explanation);
    sectionEl.appendChild(heading);
    // REVIEW CONFIDENCE TIERS (AG, 2026-08-02): a section may partition
    // into tier groups ("Strong Recommendations" / "Needs Review").
    // Rendering rules, all category-agnostic:
    //   no tiers   -> exactly the pre-tier layout (triage view, "other");
    //   one tier   -> its action buttons join the section title line
    //                 (the compact look -- no redundant sub-heading);
    //   two tiers  -> each gets a sub-heading (label + progress + its own
    //                 actions) above its own grid of rows.
    // Rows render identically in every shape (renderGrid below); actions
    // come from policy.tierActionsFor -- DATA, never renderer logic.
    const tierGroups = section.tiers ?? [];
    // SECTION-ACTION DIGITS (AG, 2026-08-02): one emitter for every green
    // section button on both surfaces. `scopeIds` says which items make
    // THIS heading the active scope; only the active scope's buttons get
    // keycaps, so the number the reviewer reads is the number that acts.
    // `numbered` is false for the section title line of a MULTI-tier
    // section: there the tier sub-headings own the numbering, and a
    // title-line list numbered beside them could mint a second ⑨. (No
    // current policy declares both -- see headingSectionActions -- so this
    // guard is a fail-visible, not a live branch.)
    const focusedItemId = state.focus?.target.itemId ?? null;
    const emitSectionActions = (actions: QueueSectionAction[], scopeIds: readonly string[], host: HTMLElement, numbered: boolean): void => {
      if (actions.length === 0) return;
      // The card cursor moves the numbered scope to the cards entirely
      // (activeScopeSectionActions), so no row heading claims digits then.
      const active = numbered && structuralCardFocusPending === null && focusedItemId !== null && scopeIds.includes(focusedItemId);
      for (const { action, digit } of sectionActionDigitAssignments(actions, (a) => a.chord)) {
        // CHORD CAPS ARE ALWAYS ADVERTISED (AG, 2026-08-03: "these do not
        // have Opt/Alt shortcuts -- review all panels and let's fix this
        // globally"). Digits keep the active-scope gate they were designed
        // for: 1-9 is a scarce shared space, so a digit may only appear on
        // the ONE heading that currently answers it. A chord is not scarce
        // -- the letter is bound to the decision, not to a slot -- so
        // hiding it taught reviewers the feature was missing on every
        // section they were not standing in.
        //
        // The honest cost is that several sections now show "Opt I" while
        // exactly one fires it, so an inactive cap renders DIMMED
        // (.action-chord-idle) rather than at full strength: the binding is
        // legible everywhere, the live target is unmistakable, and the
        // button never claims a key it will not answer.
        const chordCap = action.chord !== null ? groupScopeChordLabel(action.chord) : null;
        const cap = chordCap ?? (active ? digit : null);
        const btn = cap !== null ? keycapButton(cap, action.label, action.run) : button(action.label, action.run);
        applyVerboseLabel(btn, action);
        if (chordCap !== null && !active) btn.classList.add("action-chord-idle");
        btn.classList.add("triage-accept-all");
        btn.title = action.hint;
        host.appendChild(btn);
      }
    };
    const titleLineActions =
      tierGroups.length === 1 ? [...sectionLevel, ...headingSectionActions(policy, section, tierGroups[0]!, state)] : sectionLevel;
    emitSectionActions(titleLineActions, section.candidateIds, titleLine, tierGroups.length <= 1);
    const renderGrid = (gridIds: readonly string[]): void => {
    const grid = el("div", { class: "triage-grid" });
    // SIDE-BY-SIDE FOCUS PANE (AG, 2026-08-03) -- the detail panel moves
    // OUT of the grid flow and into a column beside it.
    //
    // Why: the panel used to be a full-width grid child inserted directly
    // beneath its own row (`.triage-expanded { grid-column: 1/-1 }`),
    // which SPLIT the section's grid in two. That reads well for a single
    // item but defeats the thing the grid exists for -- "making user
    // decisions across the entire collection of items is difficult unless
    // they are all in the same grid" (AG). Every focus move re-cut the
    // grid at a different row, so the collection never held still long
    // enough to be compared against itself.
    //
    // The panel does not need the full page width, so it takes a column
    // and the items keep an unbroken (narrower) grid beside it. Both
    // regions are then spatially stable: the panel never pushes the items
    // and the items never push the panel, which is what neither
    // panel-above-grid nor panel-below-grid could offer.
    //
    // Collected rather than appended inline because a grid can legitimately
    // hold TWO open panels at once -- the focused row plus a row held open
    // by Space/chevron (see `triageExpandedId`) -- and that documented
    // behavior is preserved: both land in the pane, in row order. Only
    // when a grid has NO open panel does it render bare and full-width
    // again ("once the editing in a section is complete, it reverts to
    // standard grid"), which is also exactly the pre-change markup, so an
    // untouched section is byte-for-byte what it was.
    const focusPanels: HTMLElement[] = [];
    for (const candidateId of gridIds) {
      const candidate = state.detection?.candidates.find((c) => c.id === candidateId);
      if (!candidate) continue;
      const decided = state.reviewSession?.candidateDecisions[candidateId];
      const rec = triageRecommendationForCandidate(candidateId, state);
      const isFocused = state.focus?.target.stage === stage && state.focus.target.itemId === candidateId;
      // An open Change/Redact editor lives inside the detail panel, so an
      // editing row is expanded BY DEFINITION (keyboard C/R from a compact
      // row lands somewhere visible, never nowhere).
      const pendingRowAction = pendingDecisionOf(isEditingCandidate(candidateId, stage, "Rename"), isEditingCandidate(candidateId, stage, "Redact"));
      // EXPANSION FOLLOWS FOCUS (AG, 2026-08-02, bug report: "if an item
      // is highlighted, it should always expand to show detail -- in all
      // screens"). This SUPERSEDES the original triage philosophy of
      // "moving focus through many rows WITHOUT opening anything"
      // (triageExpandedId's doc comment) -- the third and final surface
      // to adopt the app-wide isExpanded-includes-isFocused rule that
      // Item/Ambiguity list rows and Group Check already follow. The
      // explicit triageExpandedId path survives untouched (Space/chevron
      // can still hold open a row focus has left; the decided-row
      // auto-collapse and view-state snapshot logic keep working).
      // REVIEW SCOPE, Pass 1: under a workspace inspector, focus-derived
      // expansion applies only while the item IS the scope; explicit
      // requests (hold-open, open editor) always expand. See
      // WorkspacePaneSink's doc comment.
      const focusExpands = workspacePane ? workspacePane.scopeKind === "item-focus" : true;
      const expanded = (isFocused && focusExpands) || triageExpandedId === candidateId || pendingRowAction !== null;
      const parked = isFocused && !focusExpands && triageExpandedId !== candidateId && pendingRowAction === null;

      const row = el("div", { class: "triage-row", "data-item-id": candidateId });
      // UNIFIED DECISION COLOR SYSTEM (AG, 2026-08-03): a done row wears
      // the decision it actually received rather than a blanket green.
      // `triage-row-done` stays for the decision-independent completion
      // treatment (the ✓ takes the decision's own hue).
      if (decided) row.classList.add("triage-row-done", decisionClass(decided.decision), "decision-tinted");
      if (isFocused) row.classList.add("triage-row-focused");
      if (parked) row.classList.add("triage-row-parked");
      if (isAcknowledged({ kind: "candidate", stage, candidateId })) row.classList.add("row-acknowledged-pulse");
      // TRIAGE REFINEMENT (AG, 2026-07-30): normal rows are BARE tokens;
      // ✓ marks done, ▶ marks the highlighted row. Fixed-width slot so
      // tokens stay column-aligned either way.
      // ROW SELECTION (AG, 2026-08-03). Undecided rows only ("Item Check
      // shows remaining work"): the section buttons already act on
      // remaining items exclusively, so a checkbox on a decided row would
      // let a reviewer build a selection whose count overstates what any
      // button will change. A decided row gets an EMPTY slot of the same
      // width instead, because `.triage-state` below is a fixed-width
      // column-alignment slot and a missing checkbox would shift every
      // decided row's token half a character left of its neighbours'.
      //
      // NO NEW KEY BINDING, deliberately. This is a real
      // `<input type="checkbox">`, so the existing rulebook already
      // covers it end to end: native Tab reaches it; `handleTriageKey`
      // returns false for `tag === "input"` so Space is NOT intercepted
      // and toggles it natively; and the region model's universal escape
      // rung already names "a row checkbox reached by native Tab" as the
      // case its Escape-backs-out-one-level branch exists for. Adding
      // Shift+Space would have duplicated a working native affordance
      // with a second grammar to learn.
      const checkSlot = el("span", { class: "triage-check-slot" });
      if (!decided) {
        const check = el("input", { class: "triage-check", type: "checkbox", title: "Select for bulk action" });
        (check as HTMLInputElement).checked = selectedCandidateIds.has(candidateId);
        check.setAttribute("aria-label", `Select ${candidate.displayValue}`);
        // The row's own click handler moves the cursor; a click on the
        // checkbox must toggle selection WITHOUT also re-homing focus,
        // or building a selection would drag the detail pane along for
        // the ride, one item at a time.
        check.addEventListener("click", (event) => event.stopPropagation());
        check.addEventListener("change", () => {
          if (selectedCandidateIds.has(candidateId)) selectedCandidateIds.delete(candidateId);
          else selectedCandidateIds.add(candidateId);
          render();
        });
        checkSlot.appendChild(check);
      }
      row.appendChild(checkSlot);
      // Parked cursor wears the hollow marker: position without activation.
      row.appendChild(el("span", { class: "triage-state" }, decided ? "✓" : isFocused ? (parked ? "▷" : "▶") : ""));
      const token = el("span", { class: "triage-token" }, candidate.displayValue);
      token.title = decided ? `Reviewed -- ${decisionDisplayLabel(decided.decision)}` : candidate.detectedType;
      row.appendChild(token);
      // Inline recommendations ARE the primary interaction: the same
      // digit keycap chips as everywhere else (1 accepts the first, 2 the
      // second), no expansion required. Decided rows keep a quiet record
      // of what was suggested.
      // ONE CONTROL, ONE PLACE (AG, 2026-08-03): an EXPANDED row does not
      // repeat its suggestion chips, because this surface opens its detail
      // panel with `showHeader: true` and that header renders the very same
      // buttons from the very same recommendation (see
      // recommendationSuggestionButtons' call site in
      // renderCandidateDetailPanel) -- so an open item showed "① Andrew
      // Goodloe" twice, once in the collapsed row and again in the panel
      // immediately below it.
      //
      // Gated on `expanded` rather than on the stage: the duplication is a
      // property of this row/panel pairing, not of Ambiguity Check. Item
      // Check's own list rows (renderCandidateStage) have the inverse
      // arrangement -- they render the chips ONLY when expanded and open
      // their panel WITHOUT a header, so the row IS the header there and
      // nothing is duplicated. A stage check would have made two surfaces
      // that behave the same reason about it differently.
      //
      // Decided rows are unaffected: their quiet "→ label" record is not a
      // control, and recommendationForCandidate already returns null for a
      // decided item, so the panel header has nothing to duplicate.
      if (rec && rec.suggestions.length > 0) {
        if (decided) {
          row.appendChild(el("span", { class: "triage-arrow triage-arrow-done" }, `→ ${rec.suggestions[0]!.label}`));
        } else if (!expanded) {
          row.appendChild(recommendationSuggestionButtons(candidateId, stage, rec));
        }
      }
      const chevron = el("button", { class: "triage-expand", title: expanded ? "Collapse (Space)" : "Details (Space)" }, expanded ? "▾" : "▸");
      chevron.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleTriageExpansion(candidateId);
      });
      row.appendChild(chevron);
      row.addEventListener("click", () => {
        // HIGHLIGHT IMPLIES DETAIL (AG, 2026-08-02): selecting a row also
        // stands the card cursor down -- clicking a row previously left a
        // selected card expanded elsewhere, two highlights at once, which
        // is exactly the "where am I" ambiguity the bug report describes.
        structuralCardFocusPending = null;
        // REVIEW SCOPE, Pass 1: a row click is explicit item-directed
        // navigation, so it re-narrows a widened scope even when the
        // clicked row is the parked cursor itself (focus unchanged, so
        // reconcileScopeWidening alone would not catch it).
        scopeWidenedFrom = null;
        dispatcher.dispatchNavigation({ family: "navigation", type: "selectItem", itemId: candidateId });
        render();
      });
      grid.appendChild(row);

      if (expanded) {
        // The EXISTING detail panel, unchanged in content and scheme --
        // only its PLACEMENT moved (see the focus-pane note above).
        const panelHost = el("div", { class: "triage-expanded" });
        const reviewOccurrences = state.classification
          ? groupReviewOccurrencesForCandidate(candidateId, state.classification.reviewOccurrences)
          : [];
        const panelScheme = pendingRowAction
          ? `${decisionClass(pendingRowAction)} decision-tinted`
          : decided
            ? `${decisionClass(decided.decision)} decision-tinted`
            : "scheme-nav decision-tinted";
        renderCandidateDetailPanel(panelHost, candidate, state.quality, reviewOccurrences, decided?.decision, stage, state, { showHeader: true, schemeClass: panelScheme });
        // REVIEW SCOPE, Pass 1: with a workspace inspector, panels leave
        // the section entirely and land in the inspector column.
        if (workspacePane) workspacePane.panels.push(panelHost);
        else focusPanels.push(panelHost);
      }
    }
    if (workspacePane || focusPanels.length === 0) {
      sectionEl.appendChild(grid);
      return;
    }
    // Pane FIRST in the DOM, items second: the pane renders on the left,
    // so reading order and visual order agree and no CSS reordering (with
    // its attendant tab-order/visual-order divergence) is needed. Below
    // the split's breakpoint the same DOM order stacks the pane above the
    // grid unassisted -- the workspace stays at a fixed position and the
    // item map moves, which is the right way round for a surface driven
    // from the keyboard.
    const split = el("div", { class: "triage-split" });
    const focusPane = el("div", { class: "triage-focus-pane" });
    for (const panelHost of focusPanels) focusPane.appendChild(panelHost);
    split.appendChild(focusPane);
    split.appendChild(grid);
    sectionEl.appendChild(split);
    };
    if (tierGroups.length <= 1) {
      // Zero tiers (pre-tier layout) or one tier (actions already on the
      // title line): one grid over the section's full displayed order.
      renderGrid(section.candidateIds);
    } else {
      for (const tier of tierGroups) {
        const tierRemainingIds = tier.candidateIds.filter((id) => !state.reviewSession?.candidateDecisions[id]);
        const tierDone = tier.candidateIds.length - tierRemainingIds.length;
        const tierRemaining = tierRemainingIds.length;
        const tierHeading = el("div", { class: "review-tier-heading" });
        if (tierRemaining === 0) tierHeading.classList.add("triage-section-complete");
        const tierTitle = el("span", { class: "review-tier-title" }, tier.label);
        tierTitle.title = tier.hint; // "probably ready to accept" / "deserve a closer look"
        tierHeading.appendChild(tierTitle);
        tierHeading.appendChild(el("span", { class: "triage-section-count" }, `${tierDone} complete • ${tierRemaining} remaining`));
        // A tier is its own coherent review opportunity (its own actions,
        // its own digit scope), so it gets its own figure over its own
        // remaining set. A tier's figure and its parent section's figure
        // describe overlapping sets and are not meant to be added.
        appendCandidateReduction(tierHeading, tierRemainingIds, state);
        appendHeadingSelectionControls(tierHeading, tier.candidateIds, state);
        // Each tier heading is its own numbered scope: the digits follow
        // the tier the focused row actually sits in, matching ⇧A's own
        // tier-scoped rule.
        emitSectionActions(headingSectionActions(policy, section, tier, state), tier.candidateIds, tierHeading, true);
        sectionEl.appendChild(tierHeading);
        renderGrid(tier.candidateIds);
      }
    }
    queue.appendChild(sectionEl);
  }
  container.appendChild(queue);
}

/** One action, then advance: runs suggestion 1 through the same op
 *  resolution every other suggestion surface uses (decideAndAdvance ->
 *  visible-order advance for deciding ops; the Redact editor for
 *  identifier blanks, which auto-expands the row via the editing rule
 *  above). */
function acceptTriageRecommendation(candidateId: string, stage: "item-check" | "ambiguity-check"): void {
  const state = dispatcher.getState();
  if (state.focus?.target.itemId !== candidateId) {
    dispatcher.dispatchNavigation({ family: "navigation", type: "selectItem", itemId: candidateId });
  }
  const primary = recommendationForCandidate(candidateId, state)?.suggestions[0];
  if (!primary) return;
  runRecommendationSuggestion(candidateId, stage, primary.op);
}

function toggleTriageExpansion(candidateId: string): void {
  triageExpandedId = triageExpandedId === candidateId ? null : candidateId;
  dispatcher.dispatchNavigation({ family: "navigation", type: "selectItem", itemId: candidateId });
  render();
}

/**
 * ACCEPT ALL (Triage refinement, 2026-07-30; generalized for the
 * Ambiguity queue, AG 2026-08-02): section-level agreement with
 * DocScrub's conclusion. Per item, the item's OWN top recommendation
 * wins when one exists (link/ignore/change -- ordinary commands, ordinary
 * audit); everything else takes the section's `fallback` decision -- or,
 * in a `recommendationsOnly` section (ambiguity acronyms), stays
 * undecided and is narrated as remaining for individual review, because
 * that section's conclusion names a relationship and implies no blanket
 * Keep/Ignore for members the engine couldn't resolve. Identifier-style
 * suggestions that open the Redact editor are deliberately skipped --
 * they need reviewer input -- and identifier sections offer no Accept All
 * at all. One bulkApplyDecision covers the fallback bucket; every
 * decision remains individually re-decidable afterward. The `stage`
 * param exists for narration/advance parity only -- every dispatch here
 * is stage-independent by design.
 */
function acceptAllInSection(config: AcceptAllConfig, label: string, candidateIds: readonly string[], _stage: "item-check" | "ambiguity-check"): void {
  const fallback = config.fallback;
  if (!fallback && !config.recommendationsOnly) return;
  const state = dispatcher.getState();
  const undecided = candidateIds.filter((id) => !state.reviewSession?.candidateDecisions[id]);
  if (undecided.length === 0) return;
  // COMPLETION-PATH AUDIT (AG, 2026-08-03): this button clears a whole
  // section through raw dispatches, exactly like runSectionAction, and had
  // no advance whatsoever -- the reviewer was left parked above work they
  // had just finished. Snapshot the displayed order pre-dispatch for the
  // shared advance below.
  const visiblePre = _stage === "item-check" ? visibleItemCheckIds(state) : visibleAmbiguityIds(state);
  const { viaRecommendation, withoutSuggestion: plain } = applyOwnSuggestions(undecided, state);
  if (fallback && plain.length > 0) {
    dispatcher.dispatchReview({ family: "review", type: "bulkApplyDecision", candidateIds: plain, decision: fallback });
  }
  // RX-18: narrate exactly what happened, split by path.
  const accepted = viaRecommendation + (fallback ? plain.length : 0);
  const parts: string[] = [];
  if (fallback && plain.length > 0) parts.push(`${plain.length} as ${decisionDisplayLabel(fallback)}`);
  if (viaRecommendation > 0) parts.push(`${viaRecommendation} via their own suggestion`);
  const skipped = !fallback && plain.length > 0 ? ` ${plain.length} item(s) have no suggestion and remain for individual review.` : "";
  setStatus(`${label}: accepted ${accepted} item(s)${parts.length > 0 ? ` -- ${parts.join(", ")}` : ""}.${skipped}`);
  advanceAfterSectionCompletion(_stage, candidateIds, visiblePre);
  render();
}

/** The one per-item suggestion-accept loop both bulk surfaces share:
 *  each undecided item's OWN first recommendation applied through the
 *  ordinary review commands (link/ignore/change -- identical audit to
 *  clicking its digit chip); items without an applicable suggestion are
 *  returned untouched for the caller's fallback or narration. Editor-
 *  opening suggestions (identifier blanks) count as "without" -- they
 *  need reviewer input and are never bulk-run. */
function applyOwnSuggestions(
  undecided: readonly string[],
  state: ReturnType<WorkspaceCommandDispatcher["getState"]>
): { viaRecommendation: number; withoutSuggestion: string[] } {
  const withoutSuggestion: string[] = [];
  let viaRecommendation = 0;
  for (const id of undecided) {
    const op = recommendationForCandidate(id, state)?.suggestions[0]?.op;
    if (op?.kind === "link") {
      dispatcher.dispatchReview({ family: "review", type: "linkAmbiguousCandidate", candidateId: id, groupId: op.groupId });
      viaRecommendation += 1;
    } else if (op?.kind === "keep") {
      dispatcher.dispatchReview({ family: "review", type: "keepCandidate", candidateId: id });
      viaRecommendation += 1;
    } else if (op?.kind === "ignore") {
      dispatcher.dispatchReview({ family: "review", type: "ignoreCandidate", candidateId: id });
      viaRecommendation += 1;
    } else if (op?.kind === "change-to") {
      dispatcher.dispatchReview({ family: "review", type: "renameCandidate", candidateId: id, replacement: op.replacement });
      viaRecommendation += 1;
    } else {
      withoutSuggestion.push(id);
    }
  }
  return { viaRecommendation, withoutSuggestion };
}

/**
 * REVIEW CONFIDENCE TIERS (AG, 2026-08-02): executes one declared
 * category action (see triageQueue.ts's AMBIGUITY_TIER_ACTIONS) over a
 * tier's remaining items. Two op kinds, both resolving to EXISTING
 * paths:
 * - accept-suggestions: applyOwnSuggestions (identical audit to the
 *   digit chips); items without one stay put and are narrated.
 * - bulk-decision: ONE bulkApplyDecision; Redact carries no replacement,
 *   so each item takes the engine's default placeholder -- exactly what
 *   confirming the Redact editor blank dispatches. Explicit decision
 *   actions ("Keep shortened names") deliberately do NOT run
 *   suggestion-first: the reviewer chose the decision OVER the
 *   suggestions -- the hybrid semantic stays with the triage view's
 *   legacy Accept All only.
 * Every affected item was visible before the click, stays visible after,
 * and remains individually re-decidable -- ordinary decisions, ordinary
 * audit.
 */
function runSectionAction(action: SectionAction, sectionLabel: string, candidateIds: readonly string[], stage: "item-check" | "ambiguity-check"): void {
  const state = dispatcher.getState();
  const undecided = candidateIds.filter((id) => !state.reviewSession?.candidateDecisions[id]);
  if (undecided.length === 0) return;
  // NAV-ORDER FIX (AG, 2026-08-02, live report: "I clicked 'Leave all
  // as-is' on Institutional Terminology and then apparently ended up on
  // New... It should have proceeded to Fall, the next item in order."):
  // the raw dispatchReview calls below bypass the visible-order choke
  // point, so the dispatcher's own reconcileFocus() had already moved
  // focus in STRUCTURAL order -- the exact bug class the interception
  // exists for, at a call site it never covered. Snapshot the DISPLAYED
  // order pre-dispatch; afterwards, re-select the first still-unresolved
  // item after the section's LAST member in that order (the section is
  // the thing just completed, so it -- not whatever happened to hold
  // focus -- is the advance anchor), via the same advanceWithinVisibleList
  // + domain isItemResolved pair the choke point uses.
  const visiblePre = stage === "item-check" ? visibleItemCheckIds(state) : visibleAmbiguityIds(state);
  if (action.op.kind === "accept-suggestions") {
    const { viaRecommendation, withoutSuggestion } = applyOwnSuggestions(undecided, state);
    const skipped = withoutSuggestion.length > 0 ? ` ${withoutSuggestion.length} item(s) have no suggestion and remain for individual review.` : "";
    setStatus(`${sectionLabel} — ${action.label}: ${viaRecommendation} item(s).${skipped}`);
  } else {
    dispatcher.dispatchReview({ family: "review", type: "bulkApplyDecision", candidateIds: [...undecided], decision: action.op.decision });
    setStatus(`${sectionLabel} — ${action.label}: ${undecided.length} item(s) as ${decisionDisplayLabel(action.op.decision)}.`);
  }
  advanceAfterSectionCompletion(stage, candidateIds, visiblePre);
  render();
}

/**
 * WHERE THE CURSOR GOES AFTER A WHOLE SECTION IS COMPLETED.
 *
 * Extracted from runSectionAction (AG, 2026-08-03 completion-path audit) so
 * every "I just cleared a section" path shares one answer. It was written
 * for the 2026-08-02 NAV-ORDER FIX -- "I clicked 'Leave all as-is' on
 * Institutional Terminology and then apparently ended up on New... It should
 * have proceeded to Fall" -- and the audit found `acceptAllInSection`, one
 * function away and reachable from the very same heading, still ending at a
 * bare `render()` with no advance at all. Same bug, adjacent button; the
 * only durable fix is that there is one function to call.
 *
 * The section -- not whatever happens to hold focus -- is the anchor: it is
 * the thing just completed, so the cursor continues from its LAST member in
 * DISPLAYED order. `visiblePre` must be snapshotted before the dispatch,
 * while the section's items are still in the list.
 */
function advanceAfterSectionCompletion(
  stage: "item-check" | "ambiguity-check",
  sectionIds: readonly string[],
  visiblePre: readonly string[]
): void {
  const after = dispatcher.getState();
  const anchor = [...visiblePre].reverse().find((id) => sectionIds.includes(id));
  if (!anchor) return;
  const target = advanceWithinVisibleList(anchor, visiblePre, (id) => isItemResolvedInState(stage, id, after));
  if (target && target !== after.focus?.target.itemId) {
    dispatcher.dispatchNavigation({ family: "navigation", type: "selectItem", itemId: target });
  } else if (!target) {
    // ROWS-THEN-CARDS SEAM (AG, 2026-08-02): clearing the last section of
    // rows is the same dead end the per-item advance had -- continue into
    // the first unaddressed card rather than leaving the reviewer parked
    // above unreviewed work. The caller's single render follows.
    continueIntoStructuralCards(after);
  }
}

/*
 * ============================================================================
 * SECTION ACTIONS AS A NUMBERED KEYBOARD SCOPE (AG, 2026-08-02, agreed
 * design). The green section-level buttons -- "Leave all as-is", "Use full
 * names", "Accept All Remaining", and the acronym kind group's new pair --
 * become keyboard destinations numbered DOWNWARD from ⑨, while an item's
 * own chips and identities keep numbering UPWARD from ①.
 *
 * The whole feature rests on one rule: a numbered surface is numbered by
 * exactly one function (triageQueue.ts's sectionActionDigitAssignments),
 * consulted by BOTH the renderer that paints the keycaps and the handler
 * that acts on them -- the ONE-DIGIT-SPACE discipline, applied to a second
 * population. Everything below exists to make that literally true: the
 * descriptor type is shared, the builders are shared, and "which scope is
 * active" is one derivation both consult.
 *
 * SCOPE: the reviewer's numbered section is the one containing the thing
 * they are working -- the focused ROW's section/tier, or, when the card
 * cursor is set, the SELECTED CARD's kind group (the card-targeted-letters
 * precedent: while a card is the working object, K/C/R/I already mean the
 * card, not the row underneath). Keycaps render ONLY on the active scope's
 * buttons, so the number a reviewer reads is always the number that acts.
 * ============================================================================
 */

/** One green section-level button: what it says, what it explains, what it
 *  does. Vocabulary-agnostic on purpose -- row sections build these from
 *  declared `SectionAction` data, structural kind groups from relationship
 *  operations, and the digit assigner never learns the difference. */
interface QueueSectionAction {
  label: string;
  hint: string;
  run: () => void;
  /**
   * The SPELLED-OUT label, used wherever the row has room (AG, 2026-08-03:
   * "let's spell them out if there is space then").
   *
   * `label` keeps the terse "Change all…" form. That trailing ellipsis is
   * the OS convention for "this asks you for something rather than acting
   * now" -- but this app ALSO truncates chip text with a real ellipsis, so
   * one glyph carries two meanings, and AG read it the truncation way.
   * That is decent evidence a reviewer would too.
   *
   * Rather than choose, both ship: the sentence says what you will be asked
   * for, and narrow windows keep the terse form. Swapped in CSS
   * (.action-label-long / .action-label-short) rather than by measurement,
   * because nothing re-renders on resize and a stale measurement would be
   * worse than a breakpoint.
   *
   * Absent on every action that COMMITS immediately -- only the ones that
   * open an editor have anything to spell out.
   */
  verboseLabel?: string;
  /** How the keyboard reaches it (AG, 2026-08-03) -- a GROUP-SCOPE CHORD
   *  (⌥K/⌥C/⌥R/⌥N/⌥U) when the action IS a decision, or null when it is a
   *  named conclusion that only a digit can address. Required, not
   *  optional: a new section action must say which population it joins,
   *  because that is the whole of its keyboard identity, and the two
   *  populations must never both claim one control. */
  chord: GroupScopeChord | null;
}

/** The sections + policy currently on screen for a sectioned-queue stage
 *  -- the SAME derivation renderTriageQueue/renderAmbiguityQueue paint
 *  from, so the keyboard's idea of "the focused item's section" can never
 *  disagree with the heading the reviewer is looking at. */
function sectionedQueueModel(
  state: ReturnType<WorkspaceCommandDispatcher["getState"]>,
  queueStage: "item-check" | "ambiguity-check"
): { sections: SectionedQueueSection[]; policy: SectionedQueuePolicy } {
  if (queueStage === "item-check") {
    return { sections: buildTriageSections(triageItemsFor(visibleItemCheckIds(state), state)), policy: TRIAGE_QUEUE_POLICY };
  }
  const ids = state.grouping?.ambiguityProposals.map((p) => p.candidateId) ?? [];
  return { sections: buildAmbiguitySections(ambiguityItemsFor(ids, state)), policy: AMBIGUITY_QUEUE_POLICY };
}

/**
 * The green buttons on ONE heading, in display order.
 *
 * INVARIANT the numbering depends on: a policy declares an Accept All
 * (triage) or tier actions (ambiguity), never both -- so one heading's
 * buttons always come from one source and one numbering pass. The
 * verification suite asserts it over the real policy data; the multi-tier
 * guard in the renderer below keeps a future policy that broke it from
 * silently minting two ⑨s instead of failing visibly.
 *
 * Buttons appear only while their scope still has undecided work, exactly
 * as before -- a finished section shows its green completion styling and
 * no actions, and therefore reserves no digits.
 */
function headingSectionActions(
  policy: SectionedQueuePolicy,
  section: SectionedQueueSection,
  tier: SectionedQueueTierGroup | null,
  state: ReturnType<WorkspaceCommandDispatcher["getState"]>
): QueueSectionAction[] {
  const remaining = (ids: readonly string[]): boolean => ids.some((id) => !state.reviewSession?.candidateDecisions[id]);
  const actions: QueueSectionAction[] = [];
  const acceptConfig = policy.acceptFor(section.id);
  if (acceptConfig && remaining(section.candidateIds)) {
    const scope = headingActionScope(section.candidateIds, state);
    actions.push({
      // "Accept All Remaining" names its scope in the label, exactly like
      // "Ignore all" does, so it takes the same selected form.
      label: scope.selected ? "Accept Selected" : "Accept All Remaining",
      hint: policy.acceptTitleFor(section.id, acceptConfig),
      chord: null, // a named conclusion, not a decision kind -- digits are for exactly this
      run: () => {
        releaseSelection(scope);
        acceptAllInSection(acceptConfig, section.label, scope.ids, policy.stage);
      },
    });
  }
  // Section-level declared actions sit beside Accept All, on the section's
  // OWN scope -- the triage view has no tiers, so the tier path below never
  // reaches them.
  if (remaining(section.candidateIds)) {
    const scope = headingActionScope(section.candidateIds, state);
    for (const declared of policy.sectionActionsFor?.(section.id) ?? []) {
      actions.push({
        label: scope.selected && declared.selectedLabel ? declared.selectedLabel : declared.label,
        hint: declared.hint,
        chord: sectionActionChord(declared),
        run: () => {
          releaseSelection(scope);
          runSectionAction(declared, section.label, scope.ids, policy.stage);
        },
      });
    }
  }
  if (tier && remaining(tier.candidateIds)) {
    const scope = headingActionScope(tier.candidateIds, state);
    for (const declared of policy.tierActionsFor?.(section.id, tier.id) ?? []) {
      actions.push({
        // A conclusion-naming label ("These are people's names") has no
        // selected form and correctly keeps its wording -- the heading's
        // "N selected" indicator is what tells the reviewer the scope.
        label: scope.selected && declared.selectedLabel ? declared.selectedLabel : declared.label,
        hint: declared.hint,
        chord: sectionActionChord(declared),
        run: () => {
          releaseSelection(scope);
          runSectionAction(declared, section.label, scope.ids, policy.stage);
        },
      });
    }
  }
  return actions;
}

/**
 * ROW SELECTION (AG, 2026-08-03): what a heading's green buttons act on.
 *
 * Computed HERE, in `headingSectionActions`, on purpose -- that function is
 * the single builder both the renderer (which paints the keycaps) and
 * `activeScopeSectionActions` (which the digit handler runs) consult. Any
 * other placement would let the button a reviewer READS and the digit they
 * PRESS scope to different sets, which is the exact failure the
 * ONE-DIGIT-SPACE discipline exists to prevent, one level up.
 *
 * The rule: a heading scopes to its OWN remaining items intersected with
 * the checked set, and falls back to all-remaining when that intersection
 * is empty. Two consequences worth stating:
 *
 *  - Checking items in Institutional Terminology does NOT change what
 *    Acronyms' buttons do. Selection is global state (`selectedCandidateIds`
 *    is shared with Item Check's list view), but every consumer of it here
 *    is section-local, so a cross-section selection can never make one
 *    heading act on another heading's items.
 *  - Already-decided rows are excluded before intersecting, so the button's
 *    scope always equals what `runSectionAction` will actually change --
 *    it filters to undecided too. The count in the heading cannot overstate
 *    the effect.
 */
interface HeadingActionScope {
  ids: string[];
  selected: boolean;
}

function headingActionScope(ids: readonly string[], state: ReturnType<WorkspaceCommandDispatcher["getState"]>): HeadingActionScope {
  const undecided = ids.filter((id) => !state.reviewSession?.candidateDecisions[id]);
  const checked = undecided.filter((id) => selectedCandidateIds.has(id));
  return checked.length > 0 ? { ids: checked, selected: true } : { ids: undecided, selected: false };
}

/** Clear the acted-on rows from the selection, BEFORE dispatching: the ids
 *  are already captured in `scope`, and the dispatch paths end in their own
 *  `render()`, so clearing first is what paints the emptied checkboxes in
 *  the same frame as the decision. Matches `dispatchBulkDecision`'s
 *  "a completed bulk action leaves no lingering selection" contract. */
function releaseSelection(scope: HeadingActionScope): void {
  if (!scope.selected) return;
  for (const id of scope.ids) selectedCandidateIds.delete(id);
}

/**
 * A heading's select-all checkbox and its "N selected" indicator (AG,
 * 2026-08-03).
 *
 * Placed on WHICHEVER heading owns the green buttons -- the section title
 * line when there are 0 or 1 tiers, each tier heading when there are two.
 * The rule is not "the section heading" but "wherever the actions are,"
 * because a checkbox that selects a set no visible button acts on is worse
 * than no checkbox: it looks like it did nothing.
 *
 * TRI-STATE, not binary: `indeterminate` when some but not all of the
 * scope's remaining items are checked. Without it a partially-checked
 * section reads as unchecked, and the reviewer's next click clears work
 * they meant to add to. Clicking from indeterminate selects all (the
 * additive reading -- "I want more of these," never "throw mine away").
 *
 * The indicator is what lets conclusion-naming buttons ("These are
 * people's names") keep their scope-neutral wording while acting on a
 * subset: the scope is stated once, in the heading, rather than smuggled
 * into every label.
 */
function appendHeadingSelectionControls(
  host: HTMLElement,
  scopeIds: readonly string[],
  state: ReturnType<WorkspaceCommandDispatcher["getState"]>
): void {
  const remaining = scopeIds.filter((id) => !state.reviewSession?.candidateDecisions[id]);
  if (remaining.length === 0) return; // a finished scope has no work to select
  const checked = remaining.filter((id) => selectedCandidateIds.has(id));
  const box = el("input", { class: "triage-select-all", type: "checkbox", title: "Select every remaining item in this group" });
  const input = box as HTMLInputElement;
  input.checked = checked.length === remaining.length;
  input.indeterminate = checked.length > 0 && checked.length < remaining.length;
  box.setAttribute("aria-label", "Select all remaining in this group");
  box.addEventListener("click", (event) => event.stopPropagation());
  box.addEventListener("change", () => {
    // Read the pre-click state rather than `input.checked`: from
    // indeterminate the browser's own next value is not the one we want.
    if (checked.length === remaining.length) for (const id of remaining) selectedCandidateIds.delete(id);
    else for (const id of remaining) selectedCandidateIds.add(id);
    render();
  });
  // Call sites append title + progress count, then call this, then emit the
  // green buttons -- so inserting at the front puts the box left of the
  // heading text (its own column, like the rows'), while appending the
  // indicator lands it after the progress count and before the buttons.
  host.insertBefore(box, host.firstChild);
  if (checked.length > 0) host.appendChild(el("span", { class: "triage-selected-count" }, `${checked.length} selected`));
}

/**
 * The green buttons on a structural KIND-GROUP heading.
 *
 * ACRONYM GROUPS (AG, 2026-08-02): two explicit reviewer decisions replace
 * the generic "Accept All Remaining". Per card these are exactly the
 * existing preferred actions -- digit ① is the written-out value, digit ②
 * the acronym -- so a group button is provably N clicks of the card
 * buttons: same descriptor, same applyRelationshipBulk choke point, same
 * audit. Selecting the descriptor by ROLE, not by index, is deliberate
 * (see preferredActions.ts's PreferredActionRole).
 *
 * JUDGMENT CALL, disclosed: "Accept All Remaining" is NOT also rendered on
 * acronym groups. On this kind it ran each card's FIRST preferred action,
 * which is the written-out value -- i.e. it was already "Accept written
 * out", under a name that didn't say so. Keeping it would put two buttons
 * with identical behavior side by side, the kind of decision-tax this
 * queue exists to remove. Nothing is lost except in one degenerate case: a
 * card with NO written-out member (its only preferred action is the
 * acronym) was accepted by Accept All Remaining and is now skipped by
 * "Accept written out" -- narrated, and still covered by "Accept as
 * acronyms". Alternative considered and rejected: render all three and
 * live with the duplicate. Flagged for Andrew in the findings.
 */
function relationshipKindActions(kind: RelationshipKind, ofKind: readonly RelationshipProposal[]): QueueSectionAction[] {
  if (kind === "acronym") {
    // The acronym group's two accepts ARE its change vocabulary -- each
    // standardizes every proposal on one side of the pair -- so it declares
    // no generic Change all beside them. Both are `safe` (agree-with-
    // DocScrub moves), which means the second is unnumbered under the
    // Both are named conclusions rather than decision kinds, so both stay
    // in the digit space (⑧ ⑨) and neither takes a chord.
    return [
      {
        label: "Accept as acronyms",
        hint: "Every remaining proposal in this group standardizes on its acronym (e.g. ITS). Proposals without one are left for individual review.",
        chord: null,
        run: () => acceptAllInRelationshipKind(ofKind, "acronym"),
      },
      {
        label: "Accept written out",
        hint: "Every remaining proposal in this group standardizes on its written-out form (e.g. Information Technology Services). Proposals without one are left for individual review.",
        chord: null,
        run: () => acceptAllInRelationshipKind(ofKind, "written-out"),
      },
    ];
  }
  // KIND-GROUP TEXT-ENTRY ACTIONS (AG, 2026-08-03, on "Possible numeric
  // pattern"): "for items with a clear Redaction choice as the likely
  // outcome, we need a numbered global Redact all for the entire group …
  // a single number key, followed by an inline Redaction text input."
  //
  // Both are ONE key then the existing editor, which is not a new
  // interaction: Type Check's type cards already answer `c`/`r` by opening
  // this same editor over the type's remaining members (handleTypeCardKey),
  // and the editor's own render tail puts the cursor in the blank, so
  // ⑦ → type → Enter is the whole gesture. What is new is only the scope
  // it runs over -- every remaining member of every undismissed proposal in
  // the kind -- which is why `relationship-kind` exists as its own editor
  // scope rather than borrowing `bulk`: the narration has to name the kind,
  // and the id set has to respect each card's own member checkboxes.
  //
  // Offered on every NON-acronym kind rather than numeric patterns alone.
  // A digit that means Redact-all on one structural group and nothing on
  // the next is exactly the per-surface drift this pass removed; the
  // buttons already hide themselves when a group has no remaining work.
  const remaining = (): string[] => remainingIdsInRelationshipKind(ofKind, dispatcher.getState());
  return [
    {
      label: "Accept All Remaining",
      hint: "Apply each remaining proposal's suggested action (identifier patterns redact with the default placeholder)",
      chord: null,
      run: () => acceptAllInRelationshipKind(ofKind),
    },
    {
      label: `${decisionBulkLabel("Rename", "all")}…`,
      verboseLabel: `${decisionBulkLabel("Rename", "all")} — enter replacement`,
      hint: "Replace every remaining member of every proposal in this group with one shared replacement text.",
      chord: "C",
      run: () => openRelationshipKindEditor(kind, remaining(), "Rename"),
    },
    {
      label: `${decisionBulkLabel("Redact", "all")}…`,
      verboseLabel: `${decisionBulkLabel("Redact", "all")} — choose placeholder`,
      hint: "Redact every remaining member of every proposal in this group; blank keeps the default placeholder.",
      chord: "R",
      run: () => openRelationshipKindEditor(kind, remaining(), "Redact"),
    },
  ];
}

/**
 * Every still-undecided member the kind group's bulk actions would touch.
 *
 * Mirrors acceptAllInRelationshipKind's own member selection exactly --
 * addressed proposals skipped, each card's UNCHECKED members
 * (`relationshipUncheckedIds`) excluded -- so ⑦/⑧ act on precisely the set
 * ⑨ would have acted on. A reviewer who unticks a member on one card and
 * then presses the group key must not have that member redacted anyway;
 * that is the whole reason this is derived here rather than flattened from
 * `proposal.candidateIds`.
 */
function remainingIdsInRelationshipKind(
  proposals: readonly RelationshipProposal[],
  state: ReturnType<WorkspaceCommandDispatcher["getState"]>
): string[] {
  const decisions = state.reviewSession?.candidateDecisions ?? {};
  const ids: string[] = [];
  for (const proposal of proposals) {
    if (proposal.candidateIds.every((id) => Boolean(decisions[id]))) continue;
    const unchecked = relationshipUncheckedIds.get(proposal.proposalId);
    for (const id of proposal.candidateIds) {
      if (unchecked?.has(id)) continue;
      if (decisions[id]) continue;
      if (!ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

/** ⑧/⑦ on a structural kind group: refuse visibly when the group has
 *  nothing left (the established `refuse` shape -- never a silent no-op),
 *  otherwise open the shared editor. */
function openRelationshipKindEditor(kind: RelationshipKind, candidateIds: string[], action: "Rename" | "Redact"): void {
  if (candidateIds.length === 0) {
    refuse("Nothing remaining in this group.");
    return;
  }
  openInlineEditor({ scope: "relationship-kind", kind, candidateIds, action });
}

/**
 * WHICH SECTION THE DIGITS ACT ON -- one derivation, consulted by the
 * digit handler, the legend, and (indirectly, via the same builders) the
 * keycap renderer. Null = no numbered section scope right now, and the
 * digits keep their existing item meaning untouched.
 */
function activeScopeSectionActions(state: ReturnType<WorkspaceCommandDispatcher["getState"]>): QueueSectionAction[] {
  const queueStage = sectionedQueueStage(state.focus?.target.stage);
  if (!queueStage) return [];
  // A structural card holds the cursor: its KIND GROUP is the scope --
  // the same object ⇧A already accepts and K/C/R/I already decide.
  const cardId = structuralCardFocusPending as string | null;
  if (cardId) {
    const active = (state.structuralRelationships?.proposals ?? []).filter((p) => !state.reviewSession?.relationshipDismissals?.[p.proposalId]);
    const current = active.find((p) => p.proposalId === cardId);
    if (!current) return [];
    const ofKind = active.filter((p) => p.kind === current.kind);
    const decisions = state.reviewSession?.candidateDecisions ?? {};
    if (ofKind.every((p) => p.candidateIds.every((id) => Boolean(decisions[id])))) return []; // group finished: no buttons render
    return relationshipKindActions(current.kind, ofKind);
  }
  const itemId = state.focus?.target.itemId;
  if (!itemId) return [];
  const { sections, policy } = sectionedQueueModel(state, queueStage);
  const section = sections.find((s) => s.candidateIds.includes(itemId));
  if (!section) return [];
  const tier = section.tiers?.find((t) => t.candidateIds.includes(itemId)) ?? null;
  // Multi-tier sections number per TIER heading (see the renderer's guard):
  // the scope is the tier the item sits in, not the whole section.
  return headingSectionActions(policy, section, tier, state);
}

/**
 * How many digits the active scope's section buttons reserve, for the ITEM
 * side's ceiling. COLLISION RULE (agreed 2026-08-02): when an item's own
 * digit space would reach the reserved range, the ITEM truncates first.
 *
 * Deliberately computed from the item's OWN section rather than from
 * whatever currently holds focus: a row's numbers must not renumber as the
 * cursor moves past it. A number that changes while you look at it is
 * worse than a number you cannot press.
 */
function itemDigitCeilingFor(candidateId: string, state: ReturnType<WorkspaceCommandDispatcher["getState"]>): number {
  const queueStage = sectionedQueueStage(state.focus?.target.stage);
  if (!queueStage) return 9;
  const { sections, policy } = sectionedQueueModel(state, queueStage);
  const section = sections.find((s) => s.candidateIds.includes(candidateId));
  if (!section) return 9;
  const tier = section.tiers?.find((t) => t.candidateIds.includes(candidateId)) ?? null;
  return itemDigitCeilingBeside(
    sectionActionDigitAssignments(headingSectionActions(policy, section, tier, state), (a) => a.chord).map((a) => a.digit)
  );
}

/**
 * Digits 7–9 (whatever the active scope reserves) run its section actions.
 *
 * Ordered BEFORE handleIdentityLinkKey in the fallback chain, which is
 * what makes the collision rule real: where both populations could claim a
 * digit, the section wins the keystroke and identityDigitAssignments has
 * already declined to PAINT that number on an option, so the two agree.
 *
 * Three refusals, each matching an existing gate: an open inline editor
 * owns every key (the letters and ⇧A refuse there too); Split Review Mode
 * owns Group Check's keyboard wholesale; and a scope with no actions
 * simply falls through, leaving digits their item meaning.
 */
function handleSectionActionDigitKey(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
  if (inlineEditor || splitReview) return false;
  const match = /^Digit([1-9])$/.exec(event.code ?? "");
  if (!match) return false;
  const state = dispatcher.getState();
  if (state.focus?.target.panel.kind === "not-quite") return false;
  const actions = activeScopeSectionActions(state);
  if (actions.length === 0) return false;
  const hit = sectionActionDigitAssignments(actions, (a) => a.chord).find((a) => a.digit === Number(match[1]));
  if (!hit) return false; // a lower digit: the item's own numbering owns it
  hit.action.run();
  return true;
}

/**
 * UNIFIED WORKBENCH (2026-07-30): arrow movement between structural
 * cards, and past the last card ONWARD into the triage rows when the
 * workbench is on screen -- one logical queue: cards first, then rows.
 * (The reverse boundary -- backing out of the first triage row into the
 * last card -- lives in the triage arrows branch of the keydown
 * pipeline.) Card geometry is a vertical stack, so all four arrows map
 * to prev/next; the top edge stays put, matching every other no-wrap
 * traversal in this app.
 */
function moveStructuralCardFocus(current: HTMLElement, delta: number): void {
  const cards = Array.from(document.querySelectorAll<HTMLElement>(".relationship-section .relationship-card"));
  const idx = cards.indexOf(current);
  if (idx === -1) return;
  const next = idx + delta;
  const leaveToRow = (rowId: string | undefined): void => {
    if (!rowId) return;
    structuralCardFocusPending = null; // leaving the cards: the row cursor takes over
    dispatcher.dispatchNavigation({ family: "navigation", type: "selectItem", itemId: rowId });
    render();
  };
  // Boundaries follow DISPLAY ORDER. AMBIGUITY CATEGORY-FIRST (AG,
  // 2026-08-02): BOTH sectioned-queue stages now place the structural
  // kind-groups LAST in the collection (the triage arrangement), so the
  // geometry is uniform: backing out of the first card returns to the
  // stage's last visible row; forward past the last card stays put (the
  // bottom edge, like every no-wrap traversal in this app).
  const state = dispatcher.getState();
  const focusStage = state.focus?.target.stage;
  if (next < 0) {
    if (focusStage === "item-check" && itemCheckViewMode === "triage") {
      const ids = visibleItemCheckIds(state);
      leaveToRow(ids[ids.length - 1]);
    } else if (focusStage === "ambiguity-check") {
      const ids = visibleAmbiguityIds(state);
      leaveToRow(ids[ids.length - 1]);
    }
    return;
  }
  if (next >= cards.length) {
    return; // bottom edge: stay put
  }
  const target = cards[next]!;
  // HIGHLIGHT IMPLIES DETAIL (AG, 2026-08-02): cursor first, then a
  // deterministic render -- see the sectioned-queue boundary branch for
  // why focus()-then-set left highlighted-but-compact cards. The
  // render-tail pendingCardId restore re-focuses the fresh card.
  structuralCardFocusPending = target.getAttribute("data-proposal-id");
  render();
}

/**
 * REVIEW SCOPE mode keys, Pass 1 (AG, 2026-08-03) -- Item Check's triage
 * view only. Two jobs, both in service of the single-scope-consumer
 * invariant (keystroke and painted inspector must agree):
 *
 * 1. THE SCOPE LADDER. Escape = out one level, extended one rung UP from
 *    the item: card cursor stands down -> focused item widens to the
 *    remaining-work scope (the inspector's zero state) -> already-widest
 *    refuses with narration. Enter/↓ from the widened state return to the
 *    parked item (the symmetric re-entry; a second Enter then goes deeper
 *    into the panel, exactly as before). An Escape while a SELECTION is
 *    the scope deliberately does NOT clear it -- one keystroke destroying
 *    a hand-built selection is the tri-state-select-all failure the row
 *    selection design already refused once; clearing stays explicit
 *    (uncheck / Clear selection).
 *
 * 2. THE MIS-TARGET GUARD. While a wider scope (selection / remainder) is
 *    what the inspector explains, the focused row is a PARKED cursor with
 *    no panel on screen -- so plain decision letters and identity digits,
 *    which would silently act on that invisible row, REFUSE with guidance
 *    instead (the card-targeted-letters lesson: any candidate-targeted
 *    key must first ask what the working object is). Section-action
 *    digits pass through untouched -- they are scope-level actions and
 *    keep working; the check consults the SAME
 *    sectionActionDigitAssignments/activeScopeSectionActions pair the
 *    renderer paints keycaps from, so shown and fired stay one number.
 *    Space (hold a row's details open) also passes: an explicit request
 *    for an item's panel remains honored under any scope.
 */
function handleScopeModeKey(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
  if (inlineEditor || splitReview) return false;
  const state = dispatcher.getState();
  const target = state.focus?.target;
  if (!target || target.stage !== "item-check" || itemCheckViewMode !== "triage") return false;
  if (target.panel.kind === "not-quite") return false;
  const scope = currentReviewScope(state);
  if (!scope) return false;
  const kind = scope.source.kind;

  if (event.key === "Escape") {
    if (kind === "artifact-focus") {
      structuralCardFocusPending = null;
      setStatus("Left the cards — the row cursor takes over."); // RX-18
      render();
      return true;
    }
    if (kind === "item-focus") {
      if (!target.itemId) return false;
      scopeWidenedFrom = target.itemId;
      triageExpandedId = null; // out one level applies to a hold-open too
      setStatus("Viewing all remaining work — Enter returns to the item."); // RX-18
      render();
      return true;
    }
    if (kind === "selection") {
      refuse("Selection kept — uncheck items or use Clear selection to dismiss it.");
      return true;
    }
    refuse("Already viewing all remaining work.");
    return true;
  }

  if (kind === "item-focus" || kind === "artifact-focus") return false;

  if (kind === "stage-remainder" && scopeWidenedFrom !== null && (event.key === "Enter" || event.key === "ArrowDown")) {
    const returningTo = state.detection?.candidates.find((c) => c.id === scopeWidenedFrom)?.displayValue;
    scopeWidenedFrom = null;
    setStatus(returningTo ? `Returned to ${returningTo}.` : "Returned to the focused item."); // RX-18
    render();
    return true;
  }
  const letter = event.key.toLowerCase();
  if (letter === "k" || letter === "c" || letter === "r" || letter === "i") {
    refuse(
      kind === "selection"
        ? "A selection is active — the green section buttons act on the checked items. Clear the selection to decide items one at a time."
        : "Viewing all remaining work — Enter returns to the item; the section buttons decide whole sections."
    );
    return true;
  }
  if (kind === "selection" && event.key === "Enter") {
    refuse("A selection is active — the green section buttons act on the checked items. Clear the selection to work items one at a time.");
    return true;
  }
  const digitMatch = /^Digit([1-9])$/.exec(event.code ?? "");
  if (digitMatch) {
    const assignments = sectionActionDigitAssignments(activeScopeSectionActions(state), (a) => a.chord);
    if (assignments.some((a) => a.digit === Number(digitMatch[1]))) return false; // the section-action handler owns it
    refuse("Item digits are inactive while a wider scope is active — Enter returns to the item.");
    return true;
  }
  return false;
}

/**
 * TRIAGE QUEUE keys, active only in the triage view with a focused
 * candidate: Enter = accept the recommendation (the mode's core "single
 * action"); Enter with nothing to accept = expand (the interaction
 * language's "Enter = go deeper", which this deliberately overrides only
 * when there IS something to accept); Space = toggle details. Runs before
 * resolveKeyboardCommand so Enter never falls through to enterItem while
 * a recommendation is acceptable. Buttons/inputs keep their native keys.
 */
function handleTriageKey(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
  if (inlineEditor) return false; // the editor owns Enter/Space while open
  const state = dispatcher.getState();
  const target = state.focus?.target;
  if (!target || !target.itemId) return false;
  // AMBIGUITY CATEGORY-FIRST (AG, 2026-08-02): the sectioned queue now
  // exists on two stages -- Item Check's Triage view and the Ambiguity
  // stage (always sectioned) -- with the identical Enter-accepts /
  // Space-details grammar on both.
  const queueStage = sectionedQueueStage(target.stage);
  if (!queueStage) return false;
  // BOTH property accesses guarded (2026-08-02, found live): a keydown
  // can target a tagName-LESS node (the document itself) -- the old
  // `?.tagName.toLowerCase()` threw there, and an exception here aborts
  // the WHOLE keydown listener before resolveKeyboardCommand, killing
  // every review key. The .05 guard reorder made the Ambiguity stage
  // reach this line for every key, turning the latent trap live.
  const tag = (event.target as HTMLElement | null)?.tagName?.toLowerCase() ?? "";
  if (tag === "input" || tag === "textarea" || tag === "select" || tag === "button" || tag === "a") return false;
  if (event.key === "Enter") {
    structuralCardFocusPending = null; // working the rows now
    const primary = recommendationForCandidate(target.itemId, state)?.suggestions[0];
    if (primary) acceptTriageRecommendation(target.itemId, queueStage);
    else toggleTriageExpansion(target.itemId);
    return true;
  }
  if (event.key === " ") {
    structuralCardFocusPending = null; // working the rows now
    toggleTriageExpansion(target.itemId);
    return true;
  }
  return false;
}

/** Which stages currently present the sectioned queue: Ambiguity always
 *  (category-first is its only presentation), Item Check only in the
 *  Triage view. Null = the focused stage has no sectioned queue. */
function sectionedQueueStage(stage: WorkflowStage | undefined): "item-check" | "ambiguity-check" | null {
  if (stage === "ambiguity-check") return "ambiguity-check";
  if (stage === "item-check" && itemCheckViewMode === "triage") return "item-check";
  return null;
}

/** "Jump to search result": moves focus straight to the FIRST candidate in
 *  the currently filtered Item Check list -- called from the search
 *  input's own Enter handler (see renderItemCheckToolbar). No-op on an
 *  empty result set. */
function jumpToFirstSearchResult(): void {
  const state = dispatcher.getState();
  if (state.focus?.target.stage !== "item-check") return;
  // WAVE 2 CLOSEOUT (2026-07-29): visibleItemCheckIds(), not an inline
  // queryItemCheck() -- Enter in the search box previously could select a
  // candidate hidden by Category Check's narrowing while By Category was
  // active (a site the Wave 1 findings doc did not name; caught in the
  // Wave 2 plan's own audit).
  const visibleIds = visibleItemCheckIds(state);
  if (visibleIds.length === 0) return;
  dispatcher.dispatchNavigation({ family: "navigation", type: "selectItem", itemId: visibleIds[0]! });
  render();
}

/** "Jump to category": switches to Item Check's By Category view, pre-
 *  filtered to `category`, defaulting the review-state axis to "To Review"
 *  (the useful default for "let me work this category now" -- a reviewer
 *  jumping to a category almost always wants the undecided members, not
 *  the ones already resolved). */
/** RX-18: narrates every Item Check filter re-application ("Showing N of M
 *  candidate(s).") -- called from the discrete filter events themselves
 *  (search keystrokes, preset toggles, Category Check chips, view
 *  switches), NEVER from render(), which fires for plenty of reasons that
 *  are not filter changes (autosave, decisions, navigation). Reads the
 *  same visibleItemCheckIds() everything else uses, so the narrated count
 *  is definitionally the rendered count. */
function announceItemCheckNarrowing(): void {
  const state = dispatcher.getState();
  const total = state.detection?.candidates.length ?? 0;
  const shown = visibleItemCheckIds(state).length;
  setStatus(`Showing ${shown} of ${total} candidate(s).`);
}

function jumpToCategory(category: string): void {
  dispatcher.dispatchNavigation({ family: "navigation", type: "focusStage", stage: "item-check" });
  itemCheckViewMode = "category";
  categoryReviewState = "toReview";
  categoryFilter = category;
  filterHeaderRow = "category"; // fresh entry: the cursor starts on the category area
  announceItemCheckNarrowing(); // RX-18: this jump re-applies both narrowing axes
  render();
}

/**
 * STRUCTURAL RELATIONSHIP REVIEW (2026-07-30, Andrew's feature proposal --
 * see src/domain/StructuralRelationship.ts and
 * src/engines/StructuralRelationshipEngine.ts). A second class of
 * ambiguity, rendered as its own section at the top of the Ambiguity
 * stage: deterministic relationship PROPOSALS (acronym/full-name, shared
 * identifier patterns), each an explainable observation -- never a
 * semantic conclusion -- awaiting the reviewer's judgment.
 *
 * The review model is deliberately detector-agnostic (both detectors, and
 * any future one, share this exact presentation): observation + evidence +
 * member rows with checkboxes + the app's own bulk vocabulary. Keep/
 * Change/Redact All-or-Selected are ordinary bulkApplyDecision dispatches
 * -- per-candidate decisions, indistinguishable from deciding each member
 * by hand, so rebuild/audit/Item Check semantics are untouched and every
 * member remains fully re-decidable in Item Review afterward. "Unrelated"
 * dissolves the proposal (review.dismissRelationship -- durable, audited)
 * and nothing else: not "not PII", not "safe", not "ignore permanently".
 *
 * An ADDRESSED proposal (every member decided) stays visible with the
 * circled check -- the relationship was useful; its outcome shows.
 * Ephemeral member selection mirrors Group Check's unchecked-set pattern.
 *
 * KEYBOARD (documented judgment): the section's controls are ordinary
 * tabbable buttons under the existing region/Escape grammar; no new
 * letters are bound in this pass -- the keyboard interaction language is
 * under active concurrent development, and colliding with it would be
 * worse than deferring. Flagged in the findings doc as the natural
 * follow-up once the grammar settles.
 */
const relationshipUncheckedIds = new Map<string, Set<string>>();

function toggleRelationshipMemberChecked(proposalId: string, candidateId: string): void {
  const set = relationshipUncheckedIds.get(proposalId) ?? new Set<string>();
  if (set.has(candidateId)) set.delete(candidateId);
  else set.add(candidateId);
  relationshipUncheckedIds.set(proposalId, set);
  render();
}

/** THE one path every relationship decision takes -- the generic buttons,
 *  the inline editor's confirm (see confirmInlineEditor's relationship
 *  branch), and the PREFERRED ACTIONS (2026-07-30) all route here, so a
 *  shortcut is provably the identical operation: same command, same
 *  events, same decisions.json, same undo posture -- by construction, not
 *  by promise. */
function applyRelationshipBulk(proposalId: string, candidateIds: string[], decision: CandidateDecisionKind, replacement?: string): void {
  const result = dispatchReviewWithVisibleAdvance({
    family: "review",
    type: "bulkApplyDecision",
    candidateIds,
    decision,
    ...(replacement !== undefined ? { replacement } : {}),
  });
  if (result.ok) setStatus(`${decisionDisplayLabel(decision)} applied to ${candidateIds.length} related candidate(s).`); // RX-18 + RX-22
  else notifyToast(`Action failed: ${result.reason}`); // RX-09: recoverable
  acknowledge({ kind: "group", groupId: proposalId });
  render();
  // AUTO-ADVANCE (AG, 2026-08-01): completing a card moves the cursor to
  // the next card needing attention -- same grammar as every other
  // decision path. After render(), so the addressed state is fresh.
  if (result.ok) advanceStructuralCursor(proposalId);
}

/** The kind group that currently holds the card cursor, or null -- the one
 *  derivation the kind-group keycap renderer and activeScopeSectionActions
 *  both use to answer "is this group the active numbered scope?". */
function kindOfSelectedCard(state: ReturnType<WorkspaceCommandDispatcher["getState"]>): RelationshipKind | null {
  const cardId = structuralCardFocusPending as string | null;
  if (!cardId) return null;
  return (state.structuralRelationships?.proposals ?? []).find((p) => p.proposalId === cardId)?.kind ?? null;
}

/**
 * AMBIGUITY CATEGORY-FIRST (AG, 2026-08-02): kind-group Accept All. Per
 * remaining (not-fully-addressed) card, run ONE preferred action through
 * applyRelationshipBulk -- the same choke point the card's own buttons
 * use, so each card's outcome is audit-identical to accepting it by hand.
 * open-redact-editor actions become Redact with no replacement (the
 * engine's default placeholder -- exactly what confirming that card's
 * Redact editor blank dispatches; see redactBlankHint). Cards with no
 * matching action are left untouched and narrated. Ephemeral member
 * selections (unchecked boxes) are honored, same as the card buttons.
 *
 * WHICH action (AG, 2026-08-02, acronym kind-group actions): `choice`
 * names the preferred action to run per card. "preferred-first" is the
 * historical Accept All Remaining -- each card's own leading suggestion.
 * The acronym group's two explicit buttons instead pin the SIDE of the
 * relationship by ROLE ("acronym" = the brief value, "written-out" = the
 * verbose one), so one press standardizes a whole group the same way,
 * rather than per-card-whichever-came-first. Selecting by role, never by
 * index, is what makes a card missing one side skip-and-narrate instead of
 * silently taking the other one (see preferredActions.ts).
 *
 * ADVANCE: each applyRelationshipBulk carries the structural cursor
 * forward (advanceStructuralCursor), so after the loop the cursor sits
 * where the LAST processed card's advance left it -- the displayed-order
 * anchor pattern runSectionAction uses for rows, applied to cards, and it
 * continues into the stage's first undecided ROW when the whole group is
 * finished.
 */
function acceptAllInRelationshipKind(
  proposals: readonly RelationshipProposal[],
  choice: PreferredActionRole | "preferred-first" = "preferred-first"
): void {
  const state = dispatcher.getState();
  const decisions = state.reviewSession?.candidateDecisions ?? {};
  let accepted = 0;
  let skipped = 0;
  for (const proposal of proposals) {
    if (proposal.candidateIds.every((id) => Boolean(decisions[id]))) continue; // already addressed
    const members = proposal.candidateIds
      .map((id) => state.detection?.candidates.find((c) => c.id === id))
      .filter((candidate): candidate is Candidate => Boolean(candidate));
    const unchecked = relationshipUncheckedIds.get(proposal.proposalId);
    const selectedIds = proposal.candidateIds.filter((id) => !(unchecked?.has(id) ?? false));
    const available = preferredActionsForRelationship(proposal, members);
    const chosen = choice === "preferred-first" ? available[0] : available.find((a) => a.role === choice);
    if (!chosen || selectedIds.length === 0) {
      skipped += 1;
      continue;
    }
    if (chosen.op.kind === "bulk-change") {
      applyRelationshipBulk(proposal.proposalId, selectedIds, "Rename", chosen.op.replacement);
    } else {
      applyRelationshipBulk(proposal.proposalId, selectedIds, "Redact");
    }
    accepted += 1;
  }
  // RX-18: the summary narration lands AFTER applyRelationshipBulk's own
  // per-card lines, so the final status reflects the whole action. The
  // skip sentence names WHY a card was left behind, which differs by
  // choice: no suggestion at all vs. no value of the requested side.
  const skipReason =
    choice === "preferred-first"
      ? "have no suggested action"
      : choice === "acronym"
        ? "have no acronym value"
        : "have no written-out value";
  setStatus(`Accepted ${accepted} proposal(s).${skipped > 0 ? ` ${skipped} proposal(s) ${skipReason} and remain for individual review.` : ""}`);
  // COMPLETION-PATH AUDIT (AG, 2026-08-03, from the live report "when I
  // complete a global update it doesn't auto-nav me to the next item").
  //
  // This is the kind group's ⑨ -- Accept All Remaining / Accept as acronyms
  // / Accept written out -- and it was the ONE bulk path on the structural
  // surface that never moved the cursor. Its own neighbours already did:
  // the per-card bulk routes through the advance choke point, and Unrelated
  // calls advanceStructuralCursor directly. Reuse the latter, anchored on
  // the LAST proposal in the group, so the cursor continues past everything
  // just accepted rather than from wherever it happened to sit; that
  // function already handles "every card is addressed" by continuing into
  // the stage's rows, which is the dead end this leaves otherwise.
  //
  // `render()` is advanceStructuralCursor's own responsibility when it
  // moves (it renders twice by design -- see its note on deterministic
  // expansion), so the bare render here only runs when it declined to.
  const last = proposals[proposals.length - 1];
  if (accepted > 0 && last) {
    advanceStructuralCursor(last.proposalId);
    return;
  }
  render();
}

/**
 * AUTO-ADVANCE for structural cards (AG, 2026-08-01, "just like other
 * fields"): after a card's decision lands, move the keyboard cursor to
 * the NEXT card still needing attention -- forward first, then backward
 * (the stage-list advance grammar), and onward into the stage's first
 * undecided row when no card remains. Call AFTER render(): it reads the
 * fresh DOM's addressed classes and focuses a live element.
 */
function advanceStructuralCursor(fromProposalId: string): void {
  const cards = Array.from(document.querySelectorAll<HTMLElement>(".relationship-section .relationship-card"));
  const unaddressed = cards.filter((c) => !c.classList.contains("relationship-card-addressed"));
  if (unaddressed.length > 0) {
    const order = cards.map((c) => c.getAttribute("data-proposal-id"));
    const fromIdx = order.indexOf(fromProposalId);
    const forward = unaddressed.find((c) => order.indexOf(c.getAttribute("data-proposal-id")) > fromIdx);
    const target = forward ?? unaddressed[unaddressed.length - 1]!;
    // HIGHLIGHT IMPLIES DETAIL (AG, 2026-08-02): the caller's render()
    // ran with the OLD cursor, so the card this advances TO was just
    // rendered compact -- setting the cursor and focusing it left a
    // highlighted-but-compact card (the focus listener's guard sees the
    // cursor already equal and skips its render). One more render with
    // the new cursor expands it; the render-tail restore then focuses
    // the fresh element. Two renders per completed card is the cost of
    // deterministic expansion here -- callers would otherwise each need
    // to know the next cursor before their own render.
    structuralCardFocusPending = target.getAttribute("data-proposal-id");
    render();
    return;
  }
  // Every card is addressed: continue into the stage's rows, landing on
  // the first still-undecided one.
  const state = dispatcher.getState();
  const focusStage = state.focus?.target.stage;
  let nextRowId: string | undefined;
  if (focusStage === "ambiguity-check") {
    const proposals = state.grouping?.ambiguityProposals ?? [];
    nextRowId = (proposals.find((p) => !state.reviewSession?.candidateDecisions[p.candidateId]) ?? proposals[0])?.candidateId;
  } else if (focusStage === "item-check" && itemCheckViewMode === "triage") {
    nextRowId = visibleItemCheckIds(state).find((id) => !state.reviewSession?.candidateDecisions[id]);
  }
  if (nextRowId) {
    structuralCardFocusPending = null; // leaving the cards: the row cursor takes over
    dispatcher.dispatchNavigation({ family: "navigation", type: "selectItem", itemId: nextRowId });
    render();
  }
}

/**
 * CARD-TARGETED LETTERS (AG, 2026-08-02): while a structural card is the
 * selected working object, the decision letters mean the CARD -- the same
 * bulk operations its own buttons perform, over the same checked-member
 * selection, so audit events and decisions are identical by construction.
 * Returns false (letting the ordinary candidate paths run) whenever no
 * card cursor is set, the stage has no cards, or the key isn't a decision
 * letter. "I" is a deliberate refusal: a proposal card's vocabulary is
 * Keep / Change / Redact / Unrelated -- silently mapping Ignore to one of
 * those would be a substitution, not a synonym.
 */
function handleCardDecisionKey(key: string): boolean {
  const letter = key.toLowerCase();
  if (letter !== "k" && letter !== "c" && letter !== "r" && letter !== "i") return false;
  const proposalId = structuralCardFocusPending as string | null;
  if (!proposalId) return false;
  const state = dispatcher.getState();
  if (!sectionedQueueStage(state.focus?.target.stage)) return false;
  const proposal = (state.structuralRelationships?.proposals ?? []).find((p) => p.proposalId === proposalId);
  if (!proposal) return false;
  const unchecked = relationshipUncheckedIds.get(proposalId);
  const selectedIds = proposal.candidateIds.filter((id) => !(unchecked?.has(id) ?? false));
  if (selectedIds.length === 0) {
    refuse("No members of this proposal are checked.");
    return true;
  }
  if (letter === "k") {
    applyRelationshipBulk(proposalId, selectedIds, "Keep");
    return true;
  }
  if (letter === "c") {
    openInlineEditor({ scope: "relationship", proposalId, candidateIds: selectedIds, action: "Rename" });
    return true;
  }
  if (letter === "r") {
    openInlineEditor({ scope: "relationship", proposalId, candidateIds: selectedIds, action: "Redact" });
    return true;
  }
  refuse("This proposal takes Keep, Change, Redact, or Unrelated — Ignore applies to individual items.");
  return true;
}

// TRIMMED (2026-07-30, Andrew): drop words that don't serve the narrative
// -- "relationship"/"identifier" restate what the card already shows.
// "Possible acronym" / "Possible numeric pattern" carry the same meaning
// with less database. Display-only; RelationshipKind values unchanged.
const RELATIONSHIP_KIND_LABEL: Record<RelationshipKind, string> = {
  acronym: "Possible acronym",
  "numeric-identifier": "Possible numeric pattern",
  "alphanumeric-identifier": "Possible alphanumeric pattern",
  // AG, 2026-08-02 ("this can be a 'Probable name with inserted word'
  // category"): proposals produced by the identity-cleanup pass over
  // noisy-phrase entity groups; digit 1 = the cleaned name (bulk
  // Change), plus the standard Keep All / Redact All / Unrelated.
  "inserted-word-name": "Probable Name with Inserted Word",
};

function renderStructuralRelationships(container: HTMLElement, state: ReturnType<WorkspaceCommandDispatcher["getState"]>): void {
  const proposals = state.structuralRelationships?.proposals ?? [];
  if (proposals.length === 0) return;
  const dismissals = state.reviewSession?.relationshipDismissals ?? {};
  const active = proposals.filter((p) => !dismissals[p.proposalId]);
  if (active.length === 0) return;
  const decisions = state.reviewSession?.candidateDecisions ?? {};

  const section = el("div", { class: "relationship-section" });
  // KIND GROUPS (AG, 2026-07-30): the "Structural relationships" super-
  // title is gone; each KIND is its own titled group ("Possible acronym",
  // "Possible numeric pattern") in the same heading language as the
  // triage sections, and the cards inside carry no per-cell label --
  // smaller cells, one explanation per group. Kind order = first
  // appearance, so cards never reorder.
  const kindOrder: RelationshipKind[] = [];
  for (const proposal of active) if (!kindOrder.includes(proposal.kind)) kindOrder.push(proposal.kind);
  const groupHosts = new Map<RelationshipKind, HTMLElement>();
  for (const kind of kindOrder) {
    const ofKind = active.filter((p) => p.kind === kind);
    const addressedCount = ofKind.filter((p) => p.candidateIds.every((id) => Boolean(decisions[id]))).length;
    const heading = el("div", { class: "triage-section-heading" });
    // CATEGORY-FIRST REVIEW (AG, 2026-07-30): same progress language and
    // completion green as the triage categories.
    if (addressedCount === ofKind.length) heading.classList.add("triage-section-complete");
    const titleLine = el("div", { class: "triage-section-titleline" });
    titleLine.appendChild(el("span", { class: "triage-section-title" }, RELATIONSHIP_KIND_LABEL[kind]));
    titleLine.appendChild(el("span", { class: "triage-section-count" }, `${addressedCount} complete • ${ofKind.length - addressedCount} remaining`));
    // AMBIGUITY CATEGORY-FIRST (AG, 2026-08-02, "Accept All applies the
    // proposed interpretation to every unresolved visible item in that
    // section"): kind-group-level accept, running each remaining card's
    // FIRST preferred action through applyRelationshipBulk -- THE choke
    // point every relationship decision takes, so audit/decisions/undo
    // are per-card identical to clicking each card's own button.
    // bulk-change applies directly; open-redact-editor cards take Redact
    // with NO replacement -- the engine's default placeholder, byte-
    // identical to confirming the card's Redact editor blank (the
    // "(blank = [REDACTED ID])" semantics made first-class 2026-08-02).
    // Cards with no preferred action are skipped and narrated. Every
    // card stays visible before and after; nothing disappears.
    // SECTION ACTIONS + DIGITS (AG, 2026-08-02): the kind group's green
    // buttons now come from relationshipKindActions -- one "Accept All
    // Remaining" for identifier/inserted-word kinds, and for ACRONYM
    // groups the explicit pair ("Accept as acronyms" / "Accept written
    // out"). Numbered downward from ⑨ by the SAME assigner the row
    // sections use, and only while THIS group holds the card cursor, so
    // exactly one scope on screen shows keycaps at a time.
    if (addressedCount < ofKind.length) {
      const cursorKind = kindOfSelectedCard(state);
      const active = cursorKind === kind;
      for (const { action, digit } of sectionActionDigitAssignments(relationshipKindActions(kind, ofKind), (a) => a.chord)) {
        // Same rule as the row headings: chords always advertised, digits
        // gated to the active scope, inactive chords dimmed.
        const chordCap = action.chord !== null ? groupScopeChordLabel(action.chord) : null;
        const cap = chordCap ?? (active ? digit : null);
        const btn = cap !== null ? keycapButton(cap, action.label, action.run) : button(action.label, action.run);
        applyVerboseLabel(btn, action);
        if (chordCap !== null && !active) btn.classList.add("action-chord-idle");
        btn.classList.add("triage-accept-all");
        btn.title = action.hint;
        // ORIGINATING-BUTTON TINT (AG, 2026-08-03): while this group's
        // editor is open, the button that opened it carries `action-editing`
        // -- the same tie-back the Type Check bulk bar and the relationship
        // cards already render. Severity IS the action here: only Rename
        // declares `change` and only Redact declares `redact` (see
        // relationshipKindActions), so no separate tag is needed to know
        // which button an open editor belongs to.
        const editingAction = action.chord === "C" ? "Rename" : action.chord === "R" ? "Redact" : null;
        if (editingAction && isEditingRelationshipKind(kind, editingAction)) btn.classList.add("action-editing");
        titleLine.appendChild(btn);
      }
    }
    // THE EDITOR ITSELF (AG, 2026-08-03, fixing a dead "Change all…"/"Redact
    // all…"): these buttons set `inlineEditor` to the `relationship-kind`
    // scope, which had a draft-cache key and a confirm path but NO render
    // site -- so the click set invisible state, and every keyboard handler
    // then yielded to an editor that wasn't on screen. Rendered here, on the
    // heading's own title line, so the scope the editor acts on is the thing
    // it is physically attached to.
    //
    // DELIBERATELY OUTSIDE the `addressedCount < ofKind.length` guard above.
    // The buttons may hide themselves when a group finishes; the editor must
    // not, or a decision that completes the group mid-edit would recreate
    // exactly the invisible-state trap this change exists to remove. If the
    // state is set, it is on screen.
    const kindEditor = inlineEditor?.scope === "relationship-kind" && inlineEditor.kind === kind ? inlineEditor : null;
    if (kindEditor) {
      renderInlineEditor(
        titleLine,
        kindEditor.action === "Rename"
          ? `Replacement for all ${kindEditor.candidateIds.length} remaining in this group (required)`
          : redactBlankHint(kindEditor.candidateIds),
        [],
        "inline-editor-compact"
      );
    }
    heading.appendChild(titleLine);
    section.appendChild(heading);
    const group = el("div", { class: "relationship-kind-group" });
    section.appendChild(group);
    groupHosts.set(kind, group);
  }

  for (const proposal of active) {
    const members = proposal.candidateIds
      .map((id) => state.detection?.candidates.find((c) => c.id === id))
      .filter((candidate): candidate is Candidate => Boolean(candidate));
    if (members.length === 0) continue;
    const addressed = proposal.candidateIds.every((id) => Boolean(decisions[id]));
    const unchecked = relationshipUncheckedIds.get(proposal.proposalId);
    const selectedIds = proposal.candidateIds.filter((id) => !(unchecked?.has(id) ?? false));
    const allSelected = selectedIds.length === proposal.candidateIds.length;
    // ACTION LABELS (AG, 2026-08-03): was a `" All"`/`" Selected"` string
    // suffix. It could not survive the new wording -- "Keep all as-is" puts
    // the scope word INSIDE the phrase, so the label is looked up whole
    // (decisionBulkLabel) rather than concatenated. Carrying the scope as
    // data instead of as a string fragment is what makes that possible.
    const bulkScope: "all" | "selected" = allSelected ? "all" : "selected";
    const disabled = selectedIds.length === 0;

    const card = el("div", { class: "item-row relationship-card", "data-proposal-id": proposal.proposalId });
    // PENDING-DECISION PREVIEW: an open Change/Redact editor previews its
    // target scheme on the whole card, same paradigm as everywhere.
    const renameEditing = isEditingRelationship(proposal.proposalId, "Rename");
    const redactEditing = isEditingRelationship(proposal.proposalId, "Redact");
    const cardPending = pendingDecisionOf(renameEditing, redactEditing);
    if (cardPending) card.classList.add(decisionClass(cardPending), "decision-tinted");
    // UNIFIED DECISION COLOR SYSTEM (AG, 2026-08-03). A relationship card
    // is multi-candidate by definition, so it is the clearest case for the
    // dominant-tint + pills model: the card takes the highest-precedence
    // decision its members carry, and the pills name every other decision
    // present. This replaced a blanket green "addressed" treatment that
    // painted a fully-REDACTED card the same color as a fully-Kept one.
    // The pending editor still outranks it for the duration of the edit,
    // exactly as on every other surface.
    const cardSummary = decisionSummary(proposal.candidateIds.map((id) => decisions[id]?.decision));
    if (addressed && !cardPending) card.classList.add("relationship-card-addressed");
    if (!cardPending && cardSummary.dominant) card.classList.add(decisionClass(cardSummary.dominant), "decision-tinted");
    if (isAcknowledged({ kind: "group", groupId: proposal.proposalId })) card.classList.add("item-row-acknowledged", "row-acknowledged-pulse");
    card.title = decisionSummaryDescription(cardSummary);

    // ACTION CLUSTER (AG, 2026-08-03): the header composes the reusable
    // content-vs-controls layout (see index.html's .action-cluster block)
    // rather than declaring its own nowrap rules. The three classes are
    // applied by composition precisely so a second surface hitting the
    // same collision adopts it by adding class names, not by copying CSS.
    const headerRow = el("div", { class: "relationship-card-header action-cluster-host" });
    // KIND GROUPS (AG, 2026-07-30): the kind label lives in the group
    // heading now, not on every cell.
    if (addressed) headerRow.appendChild(el("span", { class: "reviewed-check", title: "Every related candidate has a decision" }, "✓"));
    appendDecisionPills(headerRow, cardSummary);

    // PREFERRED ACTIONS (2026-07-30): optional accelerators on the SAME
    // row as the generic actions -- no heading, no explanatory text, the
    // label IS the resulting state. Purely descriptors from the pure
    // policy module (preferredActions.ts); each op tag routes to the SAME
    // operation the generic workflow performs (applyRelationshipBulk /
    // the existing Redact editor), so audit events, decisions.json, undo,
    // and confirmations are identical by construction. A proposal with no
    // preferred actions renders exactly as before.
    const preferred = preferredActionsForRelationship(proposal, members);
    const runPreferredAction = (op: PreferredActionOp): void => {
      if (op.kind === "bulk-change") {
        applyRelationshipBulk(proposal.proposalId, selectedIds, "Rename", op.replacement);
      } else {
        // "The cursor appears in the blank": the existing editor's own
        // render-tail focus does exactly this -- typing + Enter is then
        // exactly Redact All -> replacement -> Apply.
        openInlineEditor({ scope: "relationship", proposalId: proposal.proposalId, candidateIds: selectedIds, action: "Redact" });
      }
    };
    if (preferred.length > 0) {
      // The chips are the protected side: their text is the proposal's
      // actual content ("Information Technology Services"), unknown to the
      // reviewer until read, and therefore the last thing allowed to lose
      // characters.
      const preferredGroup = el("span", { class: "preferred-actions action-cluster-content" });
      preferred.forEach((action, index) => {
        preferredGroup.appendChild(keycapButton(index + 1, action.label, () => runPreferredAction(action.op), disabled));
      });
      headerRow.appendChild(preferredGroup);
    }

    // Card-LOCAL keys, bound on the card element itself (stopPropagation
    // keeps them out of the document handler). Digits 1-9 pick a
    // preferred action (shipped behavior, unchanged). UNIFIED WORKBENCH
    // (2026-07-30): every card is now also a stop in the one review
    // queue -- arrows walk card-to-card (and onward into the triage rows
    // when the workbench is on screen), Enter accepts the first
    // preferred action -- the same Enter-accepts / arrows-move grammar
    // as the triage rows, so a structural proposal reads as "another
    // review decision," not a different subsystem.
    card.setAttribute("tabindex", "0");
    card.addEventListener("keydown", (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const focusTag = (event.target as HTMLElement | null)?.tagName?.toLowerCase() ?? ""; // both accesses guarded -- see handleTriageKey's note
      if (focusTag === "input" || focusTag === "textarea" || focusTag === "select") return;
      if (event.key === "ArrowDown") {
        event.preventDefault();
        event.stopPropagation();
        // DOWN ENTERS (AG, 2026-08-02): from the card itself, ArrowDown
        // goes INTO the card -- first inner control (member checkbox /
        // preferred action / bulk button), matching the row grammar and
        // Group Check's Down-enters-the-group. From an inner control (or
        // on a collapsed/addressed card with nothing to enter), Down
        // falls back to next-card movement, unchanged.
        if (event.target === card) {
          const inner = card.querySelector<HTMLElement>("input:not([disabled]), button:not([disabled]), select, a[href]");
          if (inner) {
            inner.focus();
            return;
          }
        }
        moveStructuralCardFocus(card, 1);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        event.stopPropagation();
        moveStructuralCardFocus(card, 1);
        return;
      }
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        event.stopPropagation();
        moveStructuralCardFocus(card, -1);
        return;
      }
      if (event.key === "Enter" && focusTag !== "button" && focusTag !== "a" && preferred.length > 0 && !disabled) {
        event.preventDefault();
        event.stopPropagation();
        structuralCardFocusPending = proposal.proposalId; // survive the re-render
        runPreferredAction(preferred[0]!.op);
        return;
      }
      const match = /^Digit([1-9])$/.exec(event.code ?? "");
      if (!match) return;
      const action = preferred[Number(match[1]) - 1];
      if (!action || disabled) return;
      event.preventDefault();
      event.stopPropagation();
      structuralCardFocusPending = proposal.proposalId; // survive the re-render
      runPreferredAction(action.op);
    });

    // Keep / Change / Redact / Unrelated: fixed membership, labels the
    // reviewer already knows -- so this is the side that yields shape,
    // reflowing 4-across -> 3+1 -> 2x2 as the card narrows.
    const actions = el("div", { class: "group-row-actions action-cluster" });
    actions.appendChild(button(decisionBulkLabel("Keep", bulkScope), () => applyRelationshipBulk(proposal.proposalId, selectedIds, "Keep"), disabled));
    const changeBtn = button(decisionBulkLabel("Rename", bulkScope), () => openInlineEditor({ scope: "relationship", proposalId: proposal.proposalId, candidateIds: selectedIds, action: "Rename" }), disabled);
    changeBtn.classList.toggle("action-editing", renameEditing);
    if (renameEditing) changeBtn.classList.add("group-action-active", decisionClass("Rename"));
    actions.appendChild(changeBtn);
    const redactBtn = button(decisionBulkLabel("Redact", bulkScope), () => openInlineEditor({ scope: "relationship", proposalId: proposal.proposalId, candidateIds: selectedIds, action: "Redact" }), disabled);
    redactBtn.classList.toggle("action-editing", redactEditing);
    if (redactEditing) redactBtn.classList.add("group-action-active", decisionClass("Redact"));
    actions.appendChild(redactBtn);
    actions.appendChild(
      button("Unrelated", () => {
        const result = dispatchReviewWithVisibleAdvance({
          family: "review",
          type: "dismissRelationship",
          proposalId: proposal.proposalId,
          relationshipKind: proposal.kind,
          candidateIds: proposal.candidateIds,
        });
        // RX-18: a dissolution is a result worth narrating -- and worth
        // saying precisely what it does NOT mean.
        if (result.ok) setStatus("Relationship dissolved -- its candidates continue through review individually.");
        else notifyToast(`Could not dismiss the relationship: ${result.reason}`); // RX-09: recoverable
        render();
        // AUTO-ADVANCE (AG, 2026-08-01): dismissing is also "done here."
        if (result.ok) advanceStructuralCursor(proposal.proposalId);
      })
    );
    headerRow.appendChild(actions);
    card.appendChild(headerRow);

    // The card's bold header already names the relationship kind (e.g.
    // "Possible acronym relationship" via RELATIONSHIP_KIND_LABEL), and
    // proposal.observation is a near-literal restatement of that same
    // label (see StructuralRelationshipEngine.ts) -- rendering it too just
    // repeats the title back to the reviewer. Only proposal.evidence (the
    // actual per-instance specifics: which initials spell the acronym,
    // what the shared pattern is) adds new information, so that's the only
    // line shown here now.
    // COLLAPSE WHEN ADDRESSED (2026-07-30, Andrew): once every member has
    // a decision, the card folds to its single header line -- the ✓, the
    // preferred actions, and the bulk buttons remain (re-deciding stays
    // one click away), but the evidence sentence and member checkboxes are
    // review-time apparatus and collapse away. An open Change/Redact
    // editor keeps the card expanded: mid-edit is not "done".
    const collapsedWhenAddressed = addressed && !renameEditing && !redactEditing;
    // COMPACT UNTIL SELECTED (AG, 2026-07-30): the evidence sentence and
    // member checkboxes now appear only while THIS card is the selected
    // one (the keyboard cursor / a click) or has an editor open -- every
    // other card is one header line, same progressive-disclosure posture
    // as the triage rows. Clicking anywhere on the card focuses it
    // (tabindex), and the focus handler below promotes that to the
    // selection cursor + a re-render.
    const selected = (structuralCardFocusPending as string | null) === proposal.proposalId;
    const showDetails = !collapsedWhenAddressed && (selected || renameEditing || redactEditing);
    card.addEventListener("focus", () => {
      if ((structuralCardFocusPending as string | null) !== proposal.proposalId) {
        structuralCardFocusPending = proposal.proposalId;
        render();
      }
    });
    if (showDetails) {
      card.appendChild(el("p", { class: "relationship-evidence" }, proposal.evidence));
    }

    // MULTI-ITEM MEMBER ROWS (2026-07-30, Andrew): members no longer
    // stack one-per-line -- the list was visually enormous for what it
    // says. Acronym cards put their (few, varied-width) members inline on
    // one row; identifier-pattern cards lay their (many, uniform-width)
    // members out as a spreadsheet-like grid, echoing Category Check's
    // Results grid cell language rather than inventing a new one -- part
    // of converging these sections on one uniform look.
    if (showDetails) {
      const memberList = el("div", {
        class: proposal.kind === "acronym" ? "relationship-members relationship-members-inline" : "relationship-members relationship-members-grid",
      });
      for (const member of members) {
        const memberRow = el("div", { class: "member-row" });
        const checkbox = el("input", { type: "checkbox" }) as HTMLInputElement;
        checkbox.checked = !(unchecked?.has(member.id) ?? false);
        checkbox.addEventListener("change", () => toggleRelationshipMemberChecked(proposal.proposalId, member.id));
        memberRow.appendChild(checkbox);
        memberRow.appendChild(el("span", { class: "member-name" }, `${member.displayValue} (${member.occurrenceIds.length})`));
        const memberDecision = decisions[member.id];
        if (memberDecision) {
          memberRow.appendChild(el("span", { class: "reviewed-check", title: `Reviewed -- ${decisionDisplayLabel(memberDecision.decision)}` }, "✓"));
        }
        memberList.appendChild(memberRow);
      }
      card.appendChild(memberList);
    }

    if (renameEditing) renderInlineEditor(card, `Replacement text for ${selectedIds.length} related candidate(s) (required)`);
    if (redactEditing) renderInlineEditor(card, redactBlankHint(selectedIds));

    groupHosts.get(proposal.kind)?.appendChild(card);
  }
  container.appendChild(section);
}

function renderCandidateStage(container: HTMLElement, state: ReturnType<WorkspaceCommandDispatcher["getState"]>, stage: "ambiguity-check" | "item-check"): void {
  // Item Check renders its WORK QUEUE, not the full candidate inventory --
  // see itemCheckWorkQueueIds(). Ambiguity Check's pool is its own proposal
  // list and is unaffected. One assignment feeds every view below (list,
  // By Category, Triage) and the bulk toolbar, so "Select all visible"
  // can never reach a candidate the queue no longer contains.
  let candidateIds = stage === "ambiguity-check" ? (state.grouping?.ambiguityProposals.map((p) => p.candidateId) ?? []) : itemCheckPoolIds(state);

  // AMBIGUITY CATEGORY-FIRST (AG, 2026-08-02, superseding the 2026-07-30
  // one-collection card/flat-item flow): the Ambiguity stage now renders
  // the SAME sectioned collection as Item Check's Triage view -- the
  // entity-ambiguity candidates grouped by ambiguity archetype
  // (buildAmbiguitySections) with heading/explanation/counts/Accept All,
  // and the structural relationship kind-groups as the collection's
  // FINAL sections, exactly the triage arrangement. One review paradigm
  // across the stages ("variations of the same review workflow"), one
  // renderer (renderSectionedQueue), one keyboard geometry
  // (rows-then-cards; see moveStructuralCardFocus). The ambiguity class
  // is the review unit; the individual candidates are the evidence.
  const listHost: HTMLElement = container;
  if (stage === "ambiguity-check") {
    const hasProposals = (state.structuralRelationships?.proposals ?? []).some((p) => !state.reviewSession?.relationshipDismissals?.[p.proposalId]);
    if (candidateIds.length === 0 && !hasProposals) {
      container.appendChild(el("p", {}, "Nothing to review in this stage."));
      return;
    }
    const collection = el("div", { class: "triage-collection" });
    renderAmbiguityQueue(collection, state, candidateIds);
    renderStructuralRelationships(collection, state);
    container.appendChild(collection);
    return;
  }

  if (stage === "item-check") {
    // INTERACTION LANGUAGE (2026-07-30): every stage-level control surface
    // (view toggle, search/filter/sort toolbar, Category Check's narrowing
    // panel, the bulk toolbar) renders into ONE `.keyboard-region` wrapper
    // -- the region the F6/","-cycle enters as a unit (see the REGION
    // MODEL block near the keydown listener). One coherent region rather
    // than four sibling micro-regions, so cycling is top-bar -> chrome ->
    // stage controls -> back to review, never a six-press tour. Purely a
    // grouping div; every renderer below is unchanged and no CSS targets
    // stage-body children by direct-child selectors (verified).
    const controls = el("div", { class: "keyboard-region stage-controls" });
    renderItemCheckViewToggle(controls);
    renderItemCheckToolbar(controls);
    // Search + advanced filters narrow the pool BEFORE Category Check's own
    // state/category chips further narrow it -- Category Check remains a
    // view over "whatever Item Check would otherwise show" (Milestone 1's
    // own framing), now including Milestone 2's search/filter layer.
    const filteredFacts = queryItemCheck(buildCandidateQueryFacts(candidateIds, state), itemCheckQueryState);
    candidateIds = filteredFacts.map((f) => f.candidate.id);
    // TRIAGE QUEUE (2026-07-30): the third view. Search/filter/sort still
    // narrow the pool (the toolbar above is shared); the bulk toolbar is
    // deliberately absent -- triage rows carry no bulk checkboxes, and the
    // mode's own accept-and-advance IS its bulk mechanism.
    if (itemCheckViewMode === "triage") {
      container.appendChild(controls);
      // TRIAGE REFINEMENT (AG, 2026-07-30, superseding the same day's
      // two-column workbench): ONE collection. The reviewer-oriented
      // sections come first; the structural relationship cards render as
      // the collection's final section -- the same cards, commands, and
      // audit trail as the Ambiguity stage, simply "another section of
      // things to clear." Keyboard: forward past the last triage row
      // continues into the cards; backing out of the first card returns
      // to the last row (see moveStructuralCardFocus).
      const collection = el("div", { class: "triage-collection" });
      renderTriageQueue(collection, state, candidateIds);
      renderStructuralRelationships(collection, state);
      container.appendChild(collection);
      return;
    }
    if (itemCheckViewMode === "category") {
      const filtered = renderCategoryCheckPanel(controls, state, candidateIds);
      candidateIds = filtered;
      // 2026-07-30 feature spec: By Category renders the tight Results
      // grid (compact name+count cells, expanded full view above), not the
      // full-width row list -- see renderResultsGrid's doc comment.
      renderBulkToolbar(controls, candidateIds, state);
      container.appendChild(controls);
      renderResultsGrid(container, state, candidateIds);
      return;
    }
    renderBulkToolbar(controls, candidateIds, state);
    container.appendChild(controls);
  }

  if (candidateIds.length === 0) {
    listHost.appendChild(el("p", {}, "Nothing to review in this stage."));
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
    // 2026-07-30 feature spec: processed rows take their decision's pale
    // background tier -- one color vocabulary across candidate rows, group
    // rows, and result cells. PENDING-DECISION PREVIEW (AG, same day): an
    // open Change/Redact editor previews the TARGET outcome's colors
    // instead -- exactly one decision class on the row at a time, so
    // Cancel reverts to the committed colors by plain re-render. The
    // focused-row continuity rules in index.html let whichever class is
    // present keep its background while focused (a completed row "should
    // not turn blue ... continuity of visuals").
    const pendingRowAction = pendingDecisionOf(isEditingCandidate(candidateId, stage, "Rename"), isEditingCandidate(candidateId, stage, "Redact"));
    if (pendingRowAction) row.classList.add(decisionClass(pendingRowAction), "decision-tinted");
    else if (decided) row.classList.add(decisionClass(decided.decision), "decision-tinted");
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
    // VISUAL HIERARCHY REFINEMENT (AG, 2026-08-01): the display value is
    // the row's primary text; the type and decided suffix render in a
    // separate small muted span. RX-22 unchanged: the decided suffix is
    // reviewer-facing text, so it uses the display label ("Change"),
    // never the durable kind ("Rename").
    const label = el("span", { class: "item-row-title" }, candidate.displayValue);
    label.appendChild(
      el(
        "span",
        { class: "item-row-meta" },
        ` (${candidate.detectedType})${decided ? ` -- ${decisionDisplayLabel(decided.decision)}${decisionProvenanceSuffix(provenance)}` : ""}`
      )
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
    // HEADER LAYOUT REFINEMENT (2026-07-30, Andrew): the focused item's
    // recommendation suggestions render right after the title, part of
    // the primary decision bar ("[1 Andrew Goodloe] ... 45% Keep Change
    // Redact Ignore"). Focused-row only -- a recommendation is part of
    // reviewing THIS item, not row decoration for the whole list -- and
    // recommendationForCandidate already returns null for decided items,
    // so no placeholder or empty space ever renders. The row is a
    // wrapping flex container, so many buttons wrap below the title
    // rather than colliding with the %/✓ column or the action buttons.
    if (isExpanded) {
      const rowRecommendation = recommendationForCandidate(candidateId, state);
      if (rowRecommendation && rowRecommendation.suggestions.length > 0) {
        row.appendChild(recommendationSuggestionButtons(candidateId, stage, rowRecommendation));
      }
    }
    if (isAcknowledging) row.appendChild(el("span", { class: "ack-badge" }, "✓ Saved"));
    // LIVE CONFIDENCE (2026-07-29, Group Check Python-parity revision,
    // extended to Item Check/Ambiguity Check per Andrew's own "extend to
    // Item Check/Ambiguity Check as well" instruction). 2026-07-30 feature
    // spec: a DECIDED candidate's percentage is now "replaced with a
    // simple circled check mark, not an entire explanatory pill" -- the
    // decision's identity lives in the tooltip, the button emphasis, and
    // the row tint; undecided candidates still show their analysis score.
    if (decided) {
      row.appendChild(el("span", { class: "reviewed-check", title: `Reviewed -- ${decisionDisplayLabel(decided.decision)}` }, "✓"));
    }
    // Refinement (2026-07-30): undecided rows no longer show the detector
    // % badge -- confidence is a model internal, moved into the panel's
    // Why? disclosure ("Detector confidence: NN%"). The ✓ column survives
    // (it communicates the REVIEWER's state, not the model's); supersedes
    // the earlier %/✓ scanning-column arrangement for the % half.
    decisionButtons(candidateId, stage, row, decided?.decision);
    list.appendChild(row);

    if (candidate && isExpanded) {
      const reviewOccurrences = state.classification
        ? groupReviewOccurrencesForCandidate(candidateId, state.classification.reviewOccurrences)
        : [];
      // ITEM-SCHEME CASCADE (AG, 2026-07-30): the detail panel is a child
      // area of this item and takes its containing color -- pending-edit
      // target, else committed decision, else nav-blue.
      const panelScheme = pendingRowAction
        ? `${decisionClass(pendingRowAction)} decision-tinted`
        : decided
          ? `${decisionClass(decided.decision)} decision-tinted`
          : "scheme-nav decision-tinted";
      renderCandidateDetailPanel(list, candidate, state.quality, reviewOccurrences, decided?.decision, stage, state, { schemeClass: panelScheme });
    }
  }
  listHost.appendChild(list);
}

/**
 * UNIFIED DECISION COLOR SYSTEM (AG, 2026-08-03): the three parallel
 * per-decision class maps that used to live here -- GROUP_ROW_DECISION_
 * CLASS (row fill), GROUP_ACTION_DECISION_CLASS (active bulk button), and
 * GROUP_CELL_SCHEME_CLASS (container cascade) -- are gone, replaced by the
 * single `decisionClass()` in ui/decisionLabels.ts.
 *
 * They were three maps because they painted three different SURFACES, not
 * because they described three different things: all three answered "which
 * hue does this decision get," and all three had to be edited in lockstep.
 * The surface is now expressed by a second class combined with the one
 * decision class -- `decision-tinted` for a filled row/panel, `item-schemed`
 * for a container that cascades to its children, `group-action-active` for
 * the solid button -- so the decision -> hue mapping exists exactly once.
 *
 * Call sites read `decisionClass(kind)` plus whichever surface class they
 * need; see index.html's "UNIFIED DECISION COLOR SYSTEM" block for what
 * each surface does with the custom properties the decision class sets.
 */

/**
 * Append the decision pills for a multi-decision card.
 *
 * The card's TINT already speaks its dominant decision; these name every
 * ADDITIONAL decision present, in the same precedence order, so:
 *   - a card with one decision gets no pills at all, and
 *   - the presence of ANY pill means "more than one thing happened here."
 * That is the whole value of the mechanism -- a badge that appears on
 * every card communicates nothing, so `additional` deliberately excludes
 * the dominant rather than repeating it (see DecisionPrecedence.ts).
 *
 * No-ops entirely for single-decision and undecided cards, so callers can
 * invoke it unconditionally rather than each repeating the emptiness
 * check. Derived fresh from the passed summary; nothing is stored.
 */
function appendDecisionPills(host: HTMLElement, summary: DecisionSummary): void {
  if (summary.additional.length === 0) return;
  const pills = el("span", { class: "decision-pills" });
  for (const kind of summary.additional) {
    // The pill's own decision class supplies --decision-hue/--decision-tint
    // for its border, fill and letter -- the same custom properties the
    // card tint uses, so a pill and a card of the same decision are the
    // same color by construction rather than by matching literals.
    const pill = el("span", { class: `decision-pill ${decisionClass(kind)}` }, DECISION_PILL_LETTER[kind]);
    pill.title = `Also contains ${decisionDisplayLabel(kind)}`;
    pills.appendChild(pill);
  }
  host.appendChild(pills);
}

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
  // SPLIT REVIEW MODE (AG, 2026-08-02): a group dissolved via a completed
  // split leaves the list -- "the original group disappears from Group
  // Check... the reviewer should never have to revisit the incorrect
  // grouping." Session-scoped by design (see splitReview's doc comment).
  return sortGroups(facts, groupCheckSortOrder)
    .map((f) => f.group.groupId)
    .filter((id) => !separatedGroupIds.has(id));
}

function renderGroupCheckToolbar(container: HTMLElement, state: ReturnType<WorkspaceCommandDispatcher["getState"]>): void {
  // `.keyboard-region`: Group Check's one stage-level control surface --
  // previously keyboard-unreachable, period (the review's G1/G11: Tab is
  // consumed by moveItem, and this stage has no "/" input to escape into).
  const bar = el("div", { class: "group-check-toolbar keyboard-region" });
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
  // DECISION REDUCTION (AG, 2026-08-03): Group Check is the surface where
  // the review unit is NOT a candidate -- the reviewer decides a GROUP,
  // and one group row disposes of every occurrence of every member. So its
  // scope is built from `mergedUnit`, one unit per visible group, and the
  // figure reads "12 / 340 = 328 decisions avoided" over group rows rather
  // than over members.
  //
  // This is exactly why the module takes ReviewUnit rather than candidate
  // ids: Group Check is a first-class caller of the same calculation, not
  // a special case bolted onto a candidate-shaped API. Its figure and Item
  // Check's cover overlapping candidates and are not additive.
  appendReductionFigure(bar, groupReviewUnits(state));
  // 2026-07-30 feature spec: the manual 1-/2-column toggle is gone --
  // column count is now automatic above a viewport-width threshold (a CSS
  // media query on .group-list; see groupCheckSortOrder's doc comment).
  container.appendChild(bar);
}

/** One decision unit per visible group row that STILL NEEDS WORK -- see the
 *  note in renderGroupCheckToolbar. Resolution uses the group-check stage's
 *  own rule (isItemResolvedInState), so the figure empties out and
 *  suppresses as the stage completes, exactly like every other surface.
 *
 *  Kept beside its only caller rather than in the shared helper block
 *  above, because "a group row is one decision" is a Group Check fact, not
 *  a general one.
 *
 *  A resolved group's members are excluded WITH it: the merged unit is
 *  built only for groups that remain, so their occurrences leave the scope
 *  too. Counting a finished group's occurrences while dropping its unit
 *  would have inflated the avoided figure. */
function groupReviewUnits(state: ReturnType<WorkspaceCommandDispatcher["getState"]>): ReviewUnit[] {
  const groupsById = new Map((state.grouping?.entityGroupProposals ?? []).map((g) => [g.groupId, g]));
  return visibleGroupIds(state).flatMap((groupId) => {
    const group = groupsById.get(groupId);
    if (!group || isItemResolvedInState("group-check", groupId, state)) return [];
    return [mergedUnit(groupId, candidateUnits(group.candidateIds, state))];
  });
}

/** 2026-07-30 feature spec: the "needs attention" pill appears on items
 *  that are STILL UNADDRESSED and internally flagged. A member is flagged
 *  while undecided with live confidence in the caution band (< 80 -- the
 *  same boundary confidenceBadgeClass's red band uses; matches the Python
 *  reference, where 62%/70% members carry the pill and 91% does not). A
 *  GROUP is flagged when its members' decisions disagree (the existing
 *  "needsAttention" display kind) or when it is undecided and ANY member
 *  is flagged -- "flagged as having something INTERNALLY that needs
 *  attention" (the reference shows a 70%-overall group with the pill and a
 *  72%-overall group without one: the difference is a flagged member, not
 *  the group's own figure). A uniform (addressed) group never shows it. */
const ATTENTION_THRESHOLD = 80;

function memberNeedsAttention(
  group: EntityGroupProposal,
  candidateId: string,
  state: ReturnType<WorkspaceCommandDispatcher["getState"]>,
  session: ReviewSession | null
): boolean {
  if (session?.candidateDecisions[candidateId]) return false;
  const live =
    session && state.detection && state.quality
      ? memberLiveConfidence(group, candidateId, state.detection, state.quality, session, resolutionEngine)
      : { current: Math.round(group.memberConfidences[candidateId] ?? group.originalProposalConfidence) };
  return live.current < ATTENTION_THRESHOLD;
}

function groupNeedsAttention(
  group: EntityGroupProposal,
  display: GroupDisplayDecision,
  state: ReturnType<WorkspaceCommandDispatcher["getState"]>,
  session: ReviewSession | null
): boolean {
  if (display.kind === "needsAttention") return true;
  if (display.kind === "uniform") return false;
  return group.candidateIds.some((candidateId) => memberNeedsAttention(group, candidateId, state, session));
}

/** 2026-07-30 feature spec: the member "Source" panel (Python's "Context",
 *  renamed per the change request) -- occurrence snippets for one member,
 *  with the actual reference highlighted in color inside each snippet. */
function renderSourcePanel(container: HTMLElement, candidateId: string, state: ReturnType<WorkspaceCommandDispatcher["getState"]>): void {
  const panel = el("div", { class: "source-panel" });
  const occurrences = state.classification
    ? groupReviewOccurrencesForCandidate(candidateId, state.classification.reviewOccurrences).flatMap((group) => group.occurrences)
    : [];
  if (occurrences.length === 0) {
    panel.appendChild(el("p", { class: "hint" }, "No occurrences recorded."));
  } else {
    for (const occurrence of occurrences.slice(0, 8)) {
      const snippet = el("p", { class: "context-snippet source-snippet" });
      snippet.appendChild(document.createTextNode(occurrence.context.before));
      snippet.appendChild(el("mark", { class: "source-match" }, occurrence.context.match));
      snippet.appendChild(document.createTextNode(occurrence.context.after));
      panel.appendChild(snippet);
    }
    if (occurrences.length > 8) {
      panel.appendChild(el("p", { class: "hint" }, `…and ${occurrences.length - 8} more (see All occurrences in Item Check).`));
    }
  }
  container.appendChild(panel);
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

  renderGroupCheckToolbar(container, state);

  // 2026-07-30 feature spec: `.group-list` flows into two columns above a
  // viewport-width threshold automatically (CSS media query, row-major
  // auto-flow -- so DOM order, and with it every sequential navigation
  // path, reads across each row before dropping to the next). Each group's
  // row + member breakdown wraps in one `.group-cell` so an expanded group
  // stays inside its own column, exactly like the Python reference.
  const list = el("div", { class: "item-list group-list" });
  for (const groupId of visibleGroupIds(state)) {
    const group = groupsById.get(groupId);
    if (!group) continue;
    const groupCell = el("div", { class: "group-cell" });
    const display: GroupDisplayDecision = session ? groupDisplayDecision(group, session) : { kind: "undecided", summary: UNDECIDED_SUMMARY };
    const notQuiteOpenHere = notQuite?.groupId === group.groupId;
    // SPLIT REVIEW MODE (AG, 2026-08-02): while this group's split
    // session is active, the group is SUSPENDED -- "we're no longer
    // deciding about the group; we're reviewing each member
    // independently." Greyed row, disabled group actions, a mode badge,
    // and the member list swaps to independent review rows below.
    const splitActiveHere = splitReview?.groupId === group.groupId;
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
    // PENDING-DECISION PREVIEW (AG, 2026-07-30): an open Change/Redact
    // editor previews the target outcome's scheme immediately (row tint +
    // solid button below) so the reviewer knows they are "moving towards a
    // different outcome"; Cancel reverts by plain re-render. Exactly one
    // decision class at a time -- pending wins over the committed display
    // decision for the duration of the edit.
    const groupPendingAction = pendingDecisionOf(isEditingGroupSubset(group.groupId, "Rename"), isEditingGroupSubset(group.groupId, "Redact"));
    // FIX THIS SCHEME (AG, 2026-07-30): an OPEN Fix this session is the
    // strongest "outcome you are heading toward" of all -- the item goes
    // AMBER for the duration (row here; panel, member rows, and Source via
    // the group-cell cascade below), the same containment paradigm as the
    // pending Change/Redact editors. Exiting or completing the session
    // reverts by plain re-render, exactly like Cancel on an editor.
    // UNIFIED DECISION COLOR SYSTEM (AG, 2026-08-03): the row's fill is
    // the HIGHEST-PRECEDENCE decision any member carries (Redact > Change
    // > Keep > Ignore), not only the uniform case -- so a group with one
    // Redact among four Keeps reads as Redact at a glance, which is the
    // decision the reviewer most needs to see from across a scrolling
    // page. The other decisions present are named by the pills below.
    //
    // This REPLACED the amber `.group-row-attention` fill for the mixed
    // case. Mixed is no longer treated as an alarm state: it is ordinary,
    // expected, and now fully described by the tint + pills. `display.kind
    // === "needsAttention"` itself survives untouched and still drives the
    // Fix this button emphasis further down -- only its claim on the COLOR
    // channel was withdrawn, which is what frees amber to mean exactly one
    // thing (an open Fix this session).
    if (notQuiteOpenHere) row.classList.add("scheme-fixthis", "decision-tinted");
    else if (groupPendingAction) row.classList.add(decisionClass(groupPendingAction), "decision-tinted");
    else if (display.summary.dominant) row.classList.add(decisionClass(display.summary.dominant), "decision-tinted");
    // ITEM-SCHEME CASCADE (AG, 2026-07-30): every item is CONTAINED by
    // exactly one color scheme, cascading to all its inline derived areas
    // (member rows, the Source panel, the selected-member emphasis)
    // through CSS variables on the group cell (.item-schemed +
    // .group-cell-<scheme>, index.html) -- "so that it all feels part of
    // the same decision." Precedence: the PENDING action while an editor
    // is open; else the committed uniform decision (continuity -- a
    // completed item never turns nav-blue, the accent survives only as
    // the active BORDER highlight); else, for the focused-but-unprocessed
    // item, the nav-blue scheme, with the same full-containment behavior.
    // Members take the scheme's soft tint; the Source panel and the
    // selected member take a slightly CONTRASTING shade of the same hue.
    // 2026-08-03: the containment scheme follows the same dominant
    // decision the row fill uses, so a mixed group contains its members in
    // its dominant hue rather than falling back to nav-blue -- the whole
    // item still reads as one decision, which is the point of the cascade.
    const effectiveScheme = groupPendingAction ?? display.summary.dominant;
    if (notQuiteOpenHere) groupCell.classList.add("item-schemed", "scheme-fixthis");
    else if (effectiveScheme) groupCell.classList.add("item-schemed", decisionClass(effectiveScheme));
    else if (isFocused) groupCell.classList.add("item-schemed", "scheme-nav");
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
    // VISUAL HIERARCHY REFINEMENT (AG, 2026-08-01): the name is the row's
    // primary text; the count (and selection note) render in a separate
    // small muted span (.row-count) rather than sharing the name's size --
    // "de-emphasizes the count by making it much smaller and in a more
    // muted grey color."
    const label = el("span", { class: "group-row-label" }, group.canonicalName);
    label.appendChild(el("span", { class: "row-count" }, ` (${group.candidateIds.length})${selectionNote}`));
    label.addEventListener("click", () => {
      dispatcher.dispatchNavigation({ family: "navigation", type: "selectItem", itemId: group.groupId });
      render();
    });
    if (splitActiveHere) {
      row.classList.add("group-row-suspended");
      label.appendChild(el("span", { class: "split-badge" }, "Split Review Mode"));
    }
    row.appendChild(label);

    // UNIFIED DECISION COLOR SYSTEM (AG, 2026-08-03): the pills naming
    // every decision present BEYOND the row's dominant tint. Appended here
    // -- after the label, before the confidence/checkmark column -- so
    // `.item-row > .decision-pills`'s `margin-left: auto` carries them to
    // the row's right edge, with the confidence figure sitting just after
    // them (a flex container gives all free space to the FIRST auto
    // margin, so the existing auto margin on the confidence column resolves
    // to zero and the two end up adjacent rather than fighting).
    // Deliberately reads the COMMITTED summary, not the pending-editor
    // preview: the pills describe what the card contains, while the tint
    // may be previewing where an open editor is heading.
    appendDecisionPills(row, display.summary);
    row.title = decisionSummaryDescription(display.summary);

    // COMPACT LAYOUT (2026-07-29): once a group's outcome is uniform across
    // every member, that outcome IS the reviewed state -- there is no more
    // uncertainty left for a confidence score to communicate, so a
    // checkmark replaces it. 2026-07-30 feature spec: that checkmark is now
    // "a simple circled check mark, not an entire explanatory pill" (the
    // decision's identity lives in the tooltip and the row's color scheme;
    // the horizontal space matters for the 2-column layout). Anything not
    // yet uniform still shows the group's LIVE confidence, now as plain
    // bold colored text with any "was X%" stacked UNDERNEATH it (less
    // horizontal space than the old inline note -- same 2-column reason).
    if (display.kind === "uniform" && !isExpanded) {
      row.appendChild(el("span", { class: "reviewed-check", title: `Reviewed -- ${decisionDisplayLabel(display.decision)}` }, "✓"));
    } else {
      // "needs attention" rides INSIDE the confidence element now (see
      // renderConfidenceBadge) -- same signal, confidence-column placement.
      row.appendChild(
        renderConfidenceBadge(
          groupRowConfidence(group, state, selectedIds.length > 0 ? selectedIds : group.candidateIds),
          "confidence-plain",
          groupNeedsAttention(group, display, state, session)
        )
      );
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
      // SPLIT REVIEW MODE: group-level actions suspend while the split
      // session is active -- the group is not the thing being decided.
      const disabled = selectedIds.length === 0 || splitActiveHere;
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
      // PENDING-DECISION PREVIEW (AG, 2026-07-30): while an editor is
      // open, the editing action's button takes the solid emphasis and the
      // committed decision's emphasis is suppressed -- exactly one button
      // ever reads as "the outcome you are heading for."
      if (groupPendingAction) byDecision[groupPendingAction].classList.add("group-action-active", decisionClass(groupPendingAction));
      else if (display.kind === "uniform") byDecision[display.decision].classList.add("group-action-active", decisionClass(display.decision));
      // SPLIT REVIEW MODE: Fix this suspends with the other group actions
      // (it was built outside the shared `disabled` flag; found live).
      const fixThisBtn = button("Fix this", () => dispatchAndRender({ family: "review", type: "enterNotQuite", groupId: group.groupId }), splitActiveHere);
      // 2026-07-30 feature spec color vocabulary: "Not Quite: same but
      // gray" -- a group whose members were individually adjusted (mixed
      // outcomes) carries the emphasized gray Fix this, matching the
      // Python reference rows.
      if (display.kind === "needsAttention") fixThisBtn.classList.add("group-action-active", "group-action-notquite");
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
      if (redactEditing) renderInlineEditor(row, redactBlankHint(selectedIds));
    }
    groupCell.appendChild(row);

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
        const memberRow = el("div", { class: "item-row", "data-member-id": candidateId });
        if (notQuite.activeMemberId === candidateId) memberRow.classList.add("item-row-focused");
        if (isAcknowledged({ kind: "not-quite-member", groupId: group.groupId, candidateId })) memberRow.classList.add("item-row-acknowledged", "row-acknowledged-pulse");
        memberRow.appendChild(el("span", {}, candidate ? `${candidate.displayValue} (${candidate.detectedType})` : candidateId));
        memberRow.appendChild(
          button(decisionActionLabel("Keep"), () => decideNotQuiteMemberAndRender({ family: "review", type: "applyNotQuiteMember", groupId: group.groupId, candidateId, action: "Keep" }, group.groupId, candidateId))
        );
        const memberRenameEditing = isEditingNotQuiteMember(group.groupId, candidateId, "Rename");
        const memberRenameBtn = button(decisionActionLabel("Rename"), () => openInlineEditor({ scope: "not-quite-member", groupId: group.groupId, candidateId, action: "Rename" }));
        memberRenameBtn.classList.toggle("action-editing", memberRenameEditing);
        memberRow.appendChild(memberRenameBtn);
        const memberRedactEditing = isEditingNotQuiteMember(group.groupId, candidateId, "Redact");
        const memberRedactBtn = button(decisionActionLabel("Redact"), () => openInlineEditor({ scope: "not-quite-member", groupId: group.groupId, candidateId, action: "Redact" }));
        memberRedactBtn.classList.toggle("action-editing", memberRedactEditing);
        memberRow.appendChild(memberRedactBtn);
        // PENDING-DECISION PREVIEW (AG, 2026-07-30): same rule as the
        // group row -- an open member editor previews its target outcome.
        const memberPending = pendingDecisionOf(memberRenameEditing, memberRedactEditing);
        if (memberPending) {
          memberRow.classList.add(decisionClass(memberPending), "decision-tinted");
          (memberPending === "Rename" ? memberRenameBtn : memberRedactBtn).classList.add("group-action-active", decisionClass(memberPending));
        }
        memberRow.appendChild(
          button(decisionActionLabel("Ignore"), () => decideNotQuiteMemberAndRender({ family: "review", type: "applyNotQuiteMember", groupId: group.groupId, candidateId, action: "Ignore" }, group.groupId, candidateId))
        );
        // 2026-07-30 feature spec: Source ("Context", renamed) is available
        // here too -- the member being fixed is exactly the one whose real
        // references matter. "S" toggles it for the active member.
        const nqSourceOpen = isSourceOpen(group.groupId, candidateId);
        const nqSourceBtn = button("Source", () => toggleSourcePanel(group.groupId, candidateId));
        nqSourceBtn.classList.add("source-button");
        nqSourceBtn.classList.toggle("action-editing", nqSourceOpen);
        memberRow.appendChild(nqSourceBtn);
        panel.appendChild(memberRow);
        if (nqSourceOpen) renderSourcePanel(panel, candidateId, state);
        if (memberRenameEditing) renderInlineEditor(panel, "Replacement text (required)");
        if (memberRedactEditing) renderInlineEditor(panel, redactBlankHint([candidateId]));
      }
      panel.appendChild(button("Done fixing", () => dispatchAndRender({ family: "review", type: "completeNotQuite", groupId: group.groupId })));
      panel.appendChild(button("Exit (Escape)", () => dispatchAndRender({ family: "review", type: "exitNotQuite", groupId: group.groupId })));
      groupCell.classList.add("group-cell-wide");
      groupCell.appendChild(panel);
    } else if (isExpanded && splitActiveHere) {
      // SPLIT REVIEW MODE (AG, 2026-08-02): each member is an INDEPENDENT
      // review row -- the existing K/C/R/I vocabulary, "exactly as Item
      // Check already does" (F is deliberately absent, as it is on Item
      // Check rows: Fix this is a group concept, and the group is
      // suspended). Choices land in the split BUFFER via
      // recordSplitChoice; a chosen member shows its pending decision's
      // color + label; the ACTIVE member (first unchosen) carries the
      // focus ring the keyboard letters act on. C/R open the standard
      // inline editor in the "split-member" scope. Completion is
      // automatic when the last member is chosen; Esc cancels the whole
      // exploration (nothing was ever dispatched).
      const members = el("div", { class: "group-members" });
      const activeMemberId = splitActiveMemberId(group);
      for (const candidateId of group.candidateIds) {
        const candidate = state.detection?.candidates.find((c) => c.id === candidateId);
        const memberRow = el("div", { class: "member-row split-member-row", "data-member-id": candidateId });
        const choice = splitReview?.choices.get(candidateId);
        const splitRename = isEditingSplitMember(group.groupId, candidateId, "Rename");
        const splitRedact = isEditingSplitMember(group.groupId, candidateId, "Redact");
        const pendingEdit = pendingDecisionOf(splitRename, splitRedact);
        if (pendingEdit) memberRow.classList.add(decisionClass(pendingEdit), "decision-tinted", "member-pending");
        else if (choice) memberRow.classList.add(decisionClass(choice.action), "decision-tinted");
        // The cursor highlight shows wherever the cursor IS (chosen rows
        // included -- revisiting overwrites the buffered choice).
        if (candidateId === activeMemberId) memberRow.classList.add("split-member-active");
        // Clicking a row moves the cursor to it (mouse parity with the
        // arrow keys).
        memberRow.addEventListener("click", (event) => {
          if ((event.target as HTMLElement | null)?.closest?.("button, input")) return;
          if (splitReview && splitReview.groupId === group.groupId && splitReview.cursorId !== candidateId) {
            splitReview.cursorId = candidateId;
            render();
          }
        });
        const memberName = el("span", { class: "member-name" }, candidate ? candidate.displayValue : candidateId);
        if (candidate) memberName.appendChild(el("span", { class: "row-count" }, ` (${candidate.occurrenceIds.length})`));
        memberRow.appendChild(memberName);
        if (choice) {
          memberRow.appendChild(
            el("span", { class: "reviewed-check", title: `Pending -- ${decisionDisplayLabel(choice.action)} (commits when every member is chosen)` }, "✓")
          );
        }
        const memberActions = el("div", { class: "group-row-actions" });
        memberActions.appendChild(button(decisionActionLabel("Keep"), () => recordSplitChoice(group, candidateId, "Keep")));
        const changeBtn = button(decisionActionLabel("Rename"), () => openInlineEditor({ scope: "split-member", groupId: group.groupId, candidateId, action: "Rename" }));
        changeBtn.classList.toggle("action-editing", splitRename);
        memberActions.appendChild(changeBtn);
        const redactBtn = button(decisionActionLabel("Redact"), () => openInlineEditor({ scope: "split-member", groupId: group.groupId, candidateId, action: "Redact" }));
        redactBtn.classList.toggle("action-editing", splitRedact);
        memberActions.appendChild(redactBtn);
        memberActions.appendChild(button(decisionActionLabel("Ignore"), () => recordSplitChoice(group, candidateId, "Ignore")));
        memberRow.appendChild(memberActions);
        const sourceOpen = isSourceOpen(group.groupId, candidateId);
        const sourceBtn = button("Source", () => toggleSourcePanel(group.groupId, candidateId));
        sourceBtn.classList.add("source-button");
        sourceBtn.classList.toggle("action-editing", sourceOpen);
        memberRow.appendChild(sourceBtn);
        members.appendChild(memberRow);
        if (splitRename) renderInlineEditor(members, "Replacement text (required)");
        if (splitRedact) renderInlineEditor(members, redactBlankHint([candidateId]));
        if (sourceOpen) renderSourcePanel(members, candidateId, state);
      }
      groupCell.appendChild(members);
    } else if (isExpanded) {
      const unchecked = groupUncheckedMemberIds.get(group.groupId);
      const members = el("div", { class: "group-members" });
      // SPLIT REVIEW MODE entry (AG, 2026-08-02): "the first numbered
      // action above the candidate list." Digit 1 = Separate these;
      // the Use accelerators follow at 2+ (see handleGroupUseKey).
      if (group.candidateIds.length > 1) {
        const separateRow = el("div", { class: "separate-these-row" });
        separateRow.appendChild(keycapButton(1, "Separate these", () => startSplitReview(group)));
        members.appendChild(separateRow);
      }
      for (const [memberIndex, candidateId] of group.candidateIds.entries()) {
        const candidate = state.detection?.candidates.find((c) => c.id === candidateId);
        const memberRow = el("div", { class: "member-row", "data-member-id": candidateId });
        const checkbox = el("input", { type: "checkbox" }) as HTMLInputElement;
        checkbox.checked = !(unchecked?.has(candidateId) ?? false);
        checkbox.addEventListener("change", () => toggleMemberChecked(group, candidateId));
        memberRow.appendChild(checkbox);
        // VISUAL HIERARCHY REFINEMENT (AG, 2026-08-01): same primary-text/
        // muted-count split as the group row above.
        const memberName = el("span", { class: "member-name" }, candidate ? candidate.displayValue : candidateId);
        if (candidate) memberName.appendChild(el("span", { class: "row-count" }, ` (${candidate.occurrenceIds.length})`));
        memberRow.appendChild(memberName);
        // GROUP "USE" ACCELERATORS (AG, 2026-08-02): "Which representation
        // should this group use?" made the primary affordance -- the same
        // numbered keycap-button language as everywhere else; click or
        // digit N commits this spelling for the whole group
        // (useGroupSpelling -- the Change editor's own paths, no new
        // behavior). Numbered through ⑨; later members (rare) keep the
        // Change editor's quick-picks.
        // Renumbered +1 (AG, 2026-08-02): digit 1 is "Separate these"
        // now; the Use accelerators follow at 2+.
        const useBtn = candidate && memberIndex < 8 ? keycapButton(memberIndex + 2, "Use", () => useGroupSpelling(group, candidate.displayValue)) : null;
        if (useBtn) memberRow.appendChild(useBtn);
        const decidedMember = Boolean(session?.candidateDecisions[candidateId]);
        const memberLive =
          session && state.detection && state.quality
            ? memberLiveConfidence(group, candidateId, state.detection, state.quality, session, resolutionEngine)
            : { current: Math.round(group.memberConfidences[candidateId] ?? group.originalProposalConfidence) };
        // 2026-07-30 feature spec: a decided member's percentage collapses
        // to the circled check (same rule as everywhere else); an undecided
        // member shows plain bold colored %, "was x%" stacked underneath,
        // and the attention pill when internally flagged.
        if (decidedMember) {
          const memberDecision = session?.candidateDecisions[candidateId]?.decision;
          memberRow.appendChild(el("span", { class: "reviewed-check", title: memberDecision ? `Reviewed -- ${decisionDisplayLabel(memberDecision)}` : "Reviewed" }, "✓"));
        } else {
          memberRow.appendChild(
            renderConfidenceBadge(memberLive, "member-confidence confidence-plain", memberNeedsAttention(group, candidateId, state, session))
          );
        }
        // 2026-07-30 feature spec: "Context" renamed "Source" -- reveals
        // this member's occurrence snippets inline, actual reference
        // highlighted. Part of the roving grid so arrow keys travel
        // checkbox -> Source within a row, and the "S" key toggles it for
        // the row that currently has roving focus.
        const sourceOpen = isSourceOpen(group.groupId, candidateId);
        const sourceBtn = button("Source", () => toggleSourcePanel(group.groupId, candidateId));
        sourceBtn.classList.add("source-button");
        sourceBtn.classList.toggle("action-editing", sourceOpen);
        memberRow.appendChild(sourceBtn);
        // CONTEXTUAL MEMBER DECISIONS (AG, 2026-07-30): K/C/R/I on an
        // active member row decide THAT member without entering Fix this.
        // The member's Change/Redact editor (candidate scope, stage
        // "group-check") renders right under the row; its pending preview
        // outranks the item's containment scheme on this one row; the
        // decided member pulses like every other decision.
        const memberEditRename = isEditingCandidate(candidateId, "group-check", "Rename");
        const memberEditRedact = isEditingCandidate(candidateId, "group-check", "Redact");
        const memberPendingAction = pendingDecisionOf(memberEditRename, memberEditRedact);
        if (memberPendingAction) memberRow.classList.add(decisionClass(memberPendingAction), "decision-tinted", "member-pending");
        if (isAcknowledged({ kind: "not-quite-member", groupId: group.groupId, candidateId })) memberRow.classList.add("item-row-acknowledged", "row-acknowledged-pulse");
        members.appendChild(memberRow);
        if (memberEditRename) renderInlineEditor(members, "Replacement text (required)");
        if (memberEditRedact) renderInlineEditor(members, redactBlankHint([candidateId]));
        if (sourceOpen) renderSourcePanel(members, candidateId, state);
        // The Use button joins the roving row between checkbox and Source.
        rovingGrid.push(useBtn ? [checkbox, useBtn, sourceBtn] : [checkbox, sourceBtn]);
      }
      groupCell.appendChild(members);

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
        attachRovingGridNav([row, members], rovingGrid, group.groupId, group.candidateIds);
        if (!inlineEditor) {
          const position = rovingGridPosition(rovingGrid, group.groupId);
          // Deferred to render()'s tail -- the stage body is not in the
          // document yet, and focusing a detached element is a silent
          // no-op (see rovingFocusPending's doc comment; this was the
          // "arrows leave the item instead of entering it" bug).
          rovingFocusPending = rovingGrid[position.row]?.[position.col] ?? null;
        }
      }
    }
    list.appendChild(groupCell);
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
/** REDACTION RULES, PYTHON LAYOUT (AG, 2026-08-01): whether the panel
 *  shows the raw strategy select + custom {n} template (the pre-revision
 *  controls) instead of the simple Apply to all / Sequential radios.
 *  Ephemeral UI state, exactly like showEmptyCategories. */
let redactionRulesAdvanced = false;

/** Derives the simple-mode view of a rule: which radio is on, and the
 *  base replacement text the input shows. "Sequential" in the simple
 *  mode means "this text, numbered" -- represented as a custom template
 *  carrying {n} (see redactionRuleFromSimpleMode below), so a custom
 *  template WITH {n} reads back as Sequential and one without reads as
 *  Apply to all. The engine's own plain "sequential" strategy
 *  ([TYPE 001] ignoring any text) remains reachable via Advanced. */
function simpleModeOfRule(type: string, rule: TypeReplacementRule): { sequential: boolean; text: string } {
  if (rule.strategy === "sequential") return { sequential: true, text: `[${type.toUpperCase()}]` };
  if (rule.strategy === "custom") {
    const template = rule.customTemplate ?? "";
    if (template.includes("{n}")) {
      // Strip the numbering token for display: "[WITNESS {n}]" shows as
      // "[WITNESS]" (withNumberingToken() re-derives the exact same
      // template on commit, so display <-> config roundtrips cleanly).
      const base = template.replace(/\s*\{n\}/g, "").trim();
      return { sequential: true, text: base || template };
    }
    return { sequential: false, text: template || genericPlaceholder(type) };
  }
  return { sequential: false, text: genericPlaceholder(type) };
}

/** Inserts the {n} numbering token into a base text: before a trailing
 *  "]" when present ("[REDACTED ID]" -> "[REDACTED ID {n}]", producing
 *  "[REDACTED ID 001]", "[REDACTED ID 002]", ... -- Andrew's "[ID 3],
 *  [ID 7]" shape), appended otherwise. Text already carrying {n} is
 *  used verbatim. */
function withNumberingToken(text: string): string {
  if (text.includes("{n}")) return text;
  const trimmed = text.trim();
  if (trimmed.endsWith("]")) return `${trimmed.slice(0, -1).trimEnd()} {n}]`;
  return `${trimmed} {n}`;
}

/** Composes the committed rule from the simple-mode controls. Apply to
 *  all with the engine's own default text stays "generic" (no config
 *  churn for the untouched case); any other text is a fixed custom
 *  template. Sequential always commits a {n} custom template derived
 *  from the visible text, so the preview, the input, and the generated
 *  output can never disagree. */
function redactionRuleFromSimpleMode(type: string, sequential: boolean, rawText: string): TypeReplacementRule {
  const text = rawText.trim() || genericPlaceholder(type);
  if (sequential) return { strategy: "custom", customTemplate: withNumberingToken(text) };
  if (text === genericPlaceholder(type)) return { strategy: "generic" };
  return { strategy: "custom", customTemplate: text };
}

/** Reviewer-facing type label: "long_numeric_id" -> "Long Numeric Id"
 *  (the Python reference's row titles). Display-only. */
function redactionRuleTypeLabel(type: string): string {
  return type
    .split(/[_\s]+/)
    .map((word) => (word ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(" ");
}

function renderRedactionRulesPanel(container: HTMLElement, state: ReturnType<WorkspaceCommandDispatcher["getState"]>): void {
  const candidates = state.detection?.candidates ?? [];
  const types = [...new Set(candidates.map((c) => c.detectedType))].sort();
  if (types.length === 0) return;
  const config = dispatcher.getReplacementRuleConfig();

  const panel = detailsEl("redaction-rules-panel", { class: "redaction-rules-panel" });
  panel.appendChild(el("summary", {}, "Redaction rules"));
  // REDACTION RULES, PYTHON LAYOUT (AG, 2026-08-01): the Advanced toggle
  // sits first inside the panel body (beside-the-title placement would put
  // a checkbox inside <summary>, where its click fights the disclosure
  // toggle -- a deliberate small deviation from the reference screenshot).
  const advancedLabel = el("label", { class: "redaction-rules-advanced" });
  const advancedToggle = el("input", { type: "checkbox" }) as HTMLInputElement;
  advancedToggle.checked = redactionRulesAdvanced;
  advancedToggle.addEventListener("change", () => {
    redactionRulesAdvanced = advancedToggle.checked;
    render();
  });
  advancedLabel.appendChild(advancedToggle);
  advancedLabel.appendChild(el("span", {}, "Advanced"));
  panel.appendChild(advancedLabel);
  panel.appendChild(
    el("p", { class: "hint" }, "Choose how each entity type is replaced when redacted. A candidate's own explicit replacement text (from Rename, or a typed-in Redact override) always takes precedence over these rules.")
  );

  for (const type of types) {
    const rule: TypeReplacementRule = config[type] ?? { strategy: "generic" };
    const row = el("div", { class: "redaction-rule-row" });
    row.appendChild(el("span", { class: "redaction-rule-type" }, redactionRuleTypeLabel(type)));

    if (redactionRulesAdvanced) {
      // Advanced: the raw strategy select + custom {n} template -- the
      // full engine vocabulary, unchanged from the pre-revision panel.
      const select = el("select") as HTMLSelectElement;
      for (const strategy of Object.keys(REPLACEMENT_STRATEGY_LABELS) as ReplacementStrategy[]) {
        const option = el("option", { value: strategy }, REPLACEMENT_STRATEGY_LABELS[strategy]);
        if (strategy === rule.strategy) option.setAttribute("selected", "selected");
        select.appendChild(option);
      }
      const templateInput = el("input", { type: "text", placeholder: "e.g. [WITNESS {n}]", class: "redaction-rule-input" }) as HTMLInputElement;
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
    } else {
      // Simple mode (the Python reference's layout): Apply to all /
      // Sequential radios, a labelled Replacement Text input, an inline
      // Preview of the resulting placeholder, and the autosaves note.
      const mode = simpleModeOfRule(type, rule);

      const textInput = el("input", { type: "text", class: "redaction-rule-input" }) as HTMLInputElement;
      textInput.value = mode.text;

      const commit = (sequential: boolean): void => {
        void applyReplacementRuleChange(type, redactionRuleFromSimpleMode(type, sequential, textInput.value));
      };

      const modes = el("div", { class: "redaction-rule-modes" });
      const radioName = `redaction-mode-${type}`;
      const makeRadio = (labelText: string, sequential: boolean, checked: boolean): HTMLLabelElement => {
        const label = el("label", { class: "redaction-rule-mode" });
        const radio = el("input", { type: "radio", name: radioName }) as HTMLInputElement;
        radio.checked = checked;
        radio.addEventListener("change", () => {
          if (radio.checked) commit(sequential);
        });
        label.appendChild(radio);
        label.appendChild(el("span", {}, labelText));
        return label;
      };
      modes.appendChild(makeRadio("Apply to all", false, !mode.sequential));
      modes.appendChild(makeRadio("Sequential", true, mode.sequential));
      row.appendChild(modes);

      const textField = el("div", { class: "redaction-rule-text" });
      textField.appendChild(el("span", { class: "redaction-rule-text-label" }, "Replacement Text"));
      textField.appendChild(textInput);
      row.appendChild(textField);
      // Commits on blur/Enter ("change"), never per keystroke -- the same
      // leave-the-input-alone-while-typing choice the inline editors made
      // (see docscrub conventions on which inputs re-render per keystroke).
      textInput.addEventListener("change", () => commit(mode.sequential));

      const previewText = mode.sequential ? withNumberingToken(textInput.value).replace(/\{n\}/g, "001") : textInput.value;
      row.appendChild(el("span", { class: "redaction-rule-preview" }, `Preview: ${previewText}`));
      row.appendChild(el("span", { class: "redaction-rule-autosaves" }, "autosaves"));
    }
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

// ===========================================================================
// PHASE 2, TYPE CHECK STAGE (AG, 2026-08-02): "Type Check presents detected
// entities grouped by semantic type ... The traversal units are semantic
// types rather than individual candidates." Cards per populated type
// (entity count, occurrences, remaining), the FOCUSED type expanded into a
// per-type review surface (expansion IS focus, the app-wide rule), member
// decisions through the ordinary candidate commands, bulk actions through
// bulkApplyDecision -- no new decision or audit model anywhere.
//
// Per-type surface depth ("each type should present a review experience
// appropriate for that class"):
//   - People: member rows PLUS the full evidence detail panel
//     (renderCandidateDetailPanel, header mode) for the active member --
//     the spec's "full evidence panel with individual review", reusing the
//     exact panel Item Check's category view already renders.
//   - Everything else: compact rows (value, count, decision state, K/C/R/I)
//     with the bulk bar carrying the weight -- emails/phones/dates-terms
//     are exactly the "compact rows with appropriate bulk actions" cases.
//   Every type gets the same bulk bar (Keep/Change/Redact/Ignore
//   remaining): the spec names bulk for emails/phones/dates-terms and
//   nothing forbids it elsewhere; one uniform bar is calmer than
//   remembering which types have it (disclosed judgment call, findings doc).
// ===========================================================================

/** The member cursor inside the focused (expanded) type card -- the same
 *  presentation-state shape as splitReview.cursorId (the split cursor
 *  precedent, .23): Down/Enter enters the member list, Up/Down move,
 *  letters act on the cursor member, decisions auto-advance to the next
 *  unresolved member (wrapping -- bounded on-screen set, the Fix this
 *  precedent), Escape returns to the card level. Cleared whenever the
 *  focused type changes (reconcileTypeCursor, called from
 *  renderTypeCheckStage). */
let typeCheckCursor: { typeId: string; candidateId: string } | null = null;

function typeGroupFor(typeId: string | null, state: ReturnType<WorkspaceCommandDispatcher["getState"]>): { typeId: SemanticTypeId; candidateIds: readonly string[] } | null {
  if (!typeId) return null;
  return state.semanticTypes?.find((g) => g.typeId === typeId) ?? null;
}

/** A type's members still needing a decision -- the "remaining" every bulk
 *  action and count below acts on. Resolution via the domain's own
 *  candidate rule (isItemResolvedInState delegating to stages.ts), so
 *  group-covered members are never re-demanded here. */
function unresolvedTypeMembers(group: { candidateIds: readonly string[] }, state: ReturnType<WorkspaceCommandDispatcher["getState"]>): string[] {
  return group.candidateIds.filter((id) => !isItemResolvedInState("item-check", id, state));
}

function nextUnresolvedTypeMember(group: { candidateIds: readonly string[] }, afterId: string, state: ReturnType<WorkspaceCommandDispatcher["getState"]>): string | null {
  const members = group.candidateIds;
  const idx = members.indexOf(afterId);
  for (let step = 1; step <= members.length; step++) {
    const candidate = members[(idx + step) % members.length]!;
    if (candidate !== afterId && !isItemResolvedInState("item-check", candidate, state)) return candidate;
  }
  return null;
}

/** Member-decision path for Type Check -- dispatch through the standard
 *  choke point, pulse the member, advance the cursor to the next
 *  unresolved member (wrap; null when the type just resolved -- the
 *  dispatcher's own reconcile has already advanced the TYPE focus, and
 *  the cursor stands down with nothing left to point at). */
function decideTypeMemberAndAdvance(group: { typeId: SemanticTypeId; candidateIds: readonly string[] }, candidateId: string, command: AnyCommand): void {
  if (inlineEditor?.scope === "candidate" && inlineEditor.candidateId === candidateId) inlineEditor = null;
  if (command.family === "review") dispatchReviewWithVisibleAdvance(command);
  acknowledge({ kind: "candidate", stage: "type-check", candidateId });
  const after = dispatcher.getState();
  const nextId = nextUnresolvedTypeMember(group, candidateId, after);
  typeCheckCursor = nextId && after.focus?.target.stage === "type-check" ? { typeId: group.typeId, candidateId: nextId } : null;
  render();
}

/** Type-level bulk Keep/Ignore over the remaining members -- one
 *  bulkApplyDecision, narrated. Change/Redact go through the
 *  "type-members" inline-editor scope instead (they carry text). */
function applyTypeBulk(
  group: { typeId: SemanticTypeId; candidateIds: readonly string[] },
  decision: "Keep" | "Ignore",
  state: ReturnType<WorkspaceCommandDispatcher["getState"]>,
  /** The scoped subset (a checked selection). Absent = every remaining
   *  member, which is the pre-selection behavior verbatim. */
  ids?: readonly string[]
): void {
  const remaining = ids ? [...ids] : unresolvedTypeMembers(group, state);
  if (remaining.length === 0) {
    refuse("Nothing remaining in this type.");
    return;
  }
  const result = dispatchReviewWithVisibleAdvance({ family: "review", type: "bulkApplyDecision", candidateIds: remaining, decision });
  if (result.ok) {
    setStatus(`${decisionDisplayLabel(decision)} applied to ${remaining.length} ${SEMANTIC_TYPE_LABELS[group.typeId]} item(s).`); // RX-18
  } else {
    notifyToast(`Bulk action failed: ${result.reason}`); // RX-09
  }
  typeCheckCursor = null;
  render();
}

/** Builds the display summaries from the load-time membership + fresh
 *  per-render decided state -- membership never moves (decision-blind
 *  stability contract), counts always current. */
function typeCheckSummaries(state: ReturnType<WorkspaceCommandDispatcher["getState"]>): SemanticTypeSummary[] {
  const items = (state.semanticTypes ?? []).flatMap((group) =>
    group.candidateIds.flatMap((id) => {
      const candidate = state.detection?.candidates.find((c) => c.id === id);
      if (!candidate) return [];
      return [{ id, type: group.typeId, occurrenceCount: candidate.occurrenceIds.length, decided: isItemResolvedInState("item-check", id, state) }];
    })
  );
  return buildSemanticTypeSummaries(items);
}

function renderTypeCheckStage(container: HTMLElement, state: ReturnType<WorkspaceCommandDispatcher["getState"]>): void {
  const summaries = typeCheckSummaries(state);
  if (summaries.length === 0) {
    container.appendChild(el("p", {}, "No detected entities to review by type."));
    return;
  }
  const focusedTypeId = state.focus?.target.stage === "type-check" ? state.focus.target.itemId : null;
  // Cursor hygiene: the cursor follows the focused type only -- a stale
  // cursor from a previously focused type (tab click, ⇧←/→, reconcile
  // advance) stands down rather than pointing at an off-screen member.
  if (typeCheckCursor && typeCheckCursor.typeId !== focusedTypeId) typeCheckCursor = null;
  const session = state.reviewSession;

  const intro = el("p", { class: "type-check-intro" });
  intro.textContent = "Decide whole categories before Item Check: what remains after this stage is only what genuinely needs individual attention.";
  container.appendChild(intro);

  const cards = el("div", { class: "type-cards" });
  for (const summary of summaries) {
    const remaining = summary.entityCount - summary.decidedCount;
    const isFocused = summary.id === focusedTypeId;
    const card = el("div", {
      class: `type-card${isFocused ? " type-card-focused" : ""}${remaining === 0 ? " type-card-complete" : ""}`,
      "data-item-id": summary.id,
      tabindex: "-1",
    });
    // UNIFIED DECISION COLOR SYSTEM (AG, 2026-08-03): a type card is a
    // card like any other -- it takes the highest-precedence decision its
    // member candidates carry, with pills for the rest. Type Check has no
    // durable type-level decision of its own by design (see stages.ts:
    // "a type is considered complete when all of its members have been
    // resolved"), so this derives from the same per-candidate decisions
    // every other surface reads. That is what makes the color mean the
    // same thing here as in Group Check without any shared state.
    const typeDecisions = decisionSummary(session ? summary.candidateIds.map((id) => session.candidateDecisions[id]?.decision) : []);
    if (typeDecisions.dominant) card.classList.add(decisionClass(typeDecisions.dominant), "decision-tinted");
    card.title = decisionSummaryDescription(typeDecisions);
    const nameRow = el("div", { class: "type-card-name-row" });
    nameRow.appendChild(el("div", { class: "type-card-name" }, summary.label));
    appendDecisionPills(nameRow, typeDecisions);
    card.appendChild(nameRow);
    card.appendChild(el("div", { class: "type-card-counts" }, `${summary.entityCount} entit${summary.entityCount === 1 ? "y" : "ies"} · ${summary.occurrenceCount.toLocaleString()} occurrence${summary.occurrenceCount === 1 ? "" : "s"}`));
    // DECISION REDUCTION (AG, 2026-08-03): a type card already states
    // "N entities · M occurrences" one line above -- the figure below
    // states what that relationship MEANS as a workload, which is the
    // thing the counts alone leave the reviewer to compute. Scoped to the
    // type's REMAINING members, matching the "N remaining" line under it,
    // so a fully-reviewed type shows "✓ Reviewed" and no equation.
    //
    // This is also the shape the future Selection Inspector's summarized
    // groupings take ("Common English Words (23)" plus its own equation):
    // same scope model, same renderer, no redesign required to get there.
    appendCandidateReduction(card, unresolvedTypeMembers(summary, state), state);
    card.appendChild(
      remaining === 0
        ? el("div", { class: "type-card-remaining type-card-remaining-done" }, "✓ Reviewed")
        : el("div", { class: "type-card-remaining" }, `${remaining} remaining`)
    );
    card.addEventListener("click", () => {
      dispatcher.dispatchNavigation({ family: "navigation", type: "selectItem", itemId: summary.id });
      typeCheckCursor = null;
      render();
    });
    cards.appendChild(card);
  }
  container.appendChild(cards);

  const focused = summaries.find((s) => s.id === focusedTypeId);
  if (focused) renderTypeReviewSurface(container, focused, state);
}

/**
 * Type Check's bulk bar AS DESCRIPTORS (AG, 2026-08-03: "Type Check --
 * Keep all as-is, change all etc need to have the same Opt/Alt controls").
 *
 * The four buttons were previously built inline in the renderer, which
 * meant nothing but the renderer knew they existed -- so the chord handler
 * had nothing to resolve against. Expressed as `QueueSectionAction`s, they
 * join the SAME list the sectioned-queue headings produce: one shape, one
 * chord vocabulary, one keycap renderer, and the key a reviewer presses is
 * by construction the button they can see. Commands, counts, editors and
 * audit are untouched -- only the description of them moved.
 */
function typeBulkActions(
  typeId: SemanticTypeId,
  group: { typeId: SemanticTypeId; candidateIds: readonly string[] },
  remaining: readonly string[],
  state: ReturnType<WorkspaceCommandDispatcher["getState"]>
): QueueSectionAction[] {
  const label = SEMANTIC_TYPE_LABELS[typeId];
  // SELECTION SCOPING (AG, 2026-08-03: "have the option buttons at top
  // dynamically update to 'Keep selected..' etc ... However, if no items
  // are selected I want the 'Keep all' options to work").
  //
  // Not contradictory -- it is the rule the sectioned queue headings have
  // used since row selection landed, reused verbatim here: a heading acts
  // on its own remaining items INTERSECTED with the checked set, and falls
  // back to all-remaining when that intersection is empty. One function
  // (`headingActionScope`) answers it for every surface, so Type Check
  // cannot drift from the queue.
  const scope = headingActionScope(group.candidateIds, state);
  const bulkLabel = (kind: "Keep" | "Rename" | "Redact" | "Ignore"): string => decisionBulkLabel(kind, scope.selected ? "selected" : "all");
  const openEditor = (action: "Rename" | "Redact"): void =>
    openInlineEditor({
      scope: "type-members",
      typeId,
      candidateIds: scope.ids,
      action,
    });
  const actions: QueueSectionAction[] = [
    {
      label: `${bulkLabel("Keep")} (${scope.ids.length})`,
      hint: `Keep every remaining ${label} item exactly as written.`,
      chord: "K",
      run: () => {
        releaseSelection(scope);
        applyTypeBulk(group, "Keep", dispatcher.getState(), scope.ids);
      },
    },
    {
      label: `${bulkLabel("Rename")}…`,
      verboseLabel: `${bulkLabel("Rename")} — enter replacement`,
      hint: `Replace every remaining ${label} item with one shared replacement text.`,
      chord: "C",
      run: () => openEditor("Rename"),
    },
    {
      label: `${bulkLabel("Redact")}…`,
      verboseLabel: `${bulkLabel("Redact")} — choose placeholder`,
      hint: `Redact every remaining ${label} item; blank keeps the default placeholder.`,
      chord: "R",
      run: () => openEditor("Redact"),
    },
  ];
  // "NONE ARE PERSONAL" REPLACES "Ignore all" (AG, 2026-08-03), and only on
  // the two types where the assertion is meaningful.
  //
  // The generic Ignore-all button is retired as a user option everywhere.
  // On Emails and Phones it is replaced by the same claim the per-item
  // chip makes, at group scope: these are the two detections that ARE
  // inherently about personal data, so "none are personal" is both accurate
  // and useful -- role addresses and switchboard lines are the whole reason
  // the false-positive case exists.
  //
  // Every other type is deliberately left without it, per AG: on
  // Organizations, Dates / Terms or Document Titles the sentence is nearly
  // tautological -- of course a document title is not personal -- and a
  // button whose claim is obvious reads as noise rather than as an action.
  if (typeId === "emails" || typeId === "phones") {
    actions.push({
      // Scope-neutral wording, so no "selected" variant is needed: "none
      // are personal" is equally true of three checked items as of eight,
      // and the count beside it already states which. Same reasoning the
      // queue's conclusion labels follow.
      label: `None are personal (${scope.ids.length})`,
      hint: `Treat every remaining ${label} item as not personal information -- shared inboxes, published lines, and the like.`,
      chord: "N",
      run: () => {
        releaseSelection(scope);
        applyTypeBulk(group, "Ignore", dispatcher.getState(), scope.ids);
      },
    });
  }
  return actions;
}

/**
 * THE one "apply to the larger population I am standing in" resolver
 * (AG, 2026-08-03). Every chord, every keycap and every refusal reads it,
 * so no surface can advertise a key it does not answer to -- the same
 * single-derivation discipline `activeScopeSectionActions` already applies
 * within the sectioned queues, lifted one level to cover the stages.
 *
 * Type Check's group is the OPEN TYPE, deliberately regardless of whether
 * the cursor sits on the type card or has descended into a member row:
 * that is the entire point of a modifier meaning "wider scope" -- from
 * inside a member, Opt+R still redacts the type. The bare letters keep
 * their existing card-targeted meaning (handleTypeCardKey, unchanged), so
 * nothing a reviewer already knows stops working.
 *
 * Group Check is deliberately ABSENT: its group rows already answer bare
 * K/C/R/I/F at group scope through the domain keymap's own group
 * vocabulary -- the group IS the focused item there, so a modifier would
 * be a second key for a scope the reviewer never left. Adding one would
 * mint the duplicate accelerator this design exists to avoid.
 */
function groupScopeActions(state: ReturnType<WorkspaceCommandDispatcher["getState"]>): QueueSectionAction[] {
  const target = state.focus?.target;
  if (target?.stage === "type-check") {
    const group = (state.semanticTypes ?? []).find((g) => g.typeId === target.itemId);
    if (!group) return [];
    const remaining = unresolvedTypeMembers(group, state);
    if (remaining.length === 0) return []; // a finished type offers nothing, exactly like a finished section
    return typeBulkActions(group.typeId, group, remaining, state);
  }
  return activeScopeSectionActions(state);
}

/** The focused type's review surface -- "selecting a type opens a
 *  lightweight review optimized for that category." */
function renderTypeReviewSurface(container: HTMLElement, summary: SemanticTypeSummary, state: ReturnType<WorkspaceCommandDispatcher["getState"]>): void {
  const group = { typeId: summary.id, candidateIds: summary.candidateIds };
  const remaining = unresolvedTypeMembers(group, state);
  const surface = el("div", { class: "type-review-surface" });

  const header = el("div", { class: "type-review-header" });
  header.appendChild(el("span", { class: "detail-title-name" }, summary.label));
  header.appendChild(el("span", { class: "detail-title-count" }, `(${remaining.length} of ${summary.entityCount} remaining)`));
  // The opened type's own figure, over exactly the scope its bulk bar acts
  // on -- `remaining` is the same array the "Keep all as-is (N)" buttons
  // below are counted from.
  appendCandidateReduction(header, remaining, state);
  surface.appendChild(header);

  // Bulk bar -- fan-out through existing candidate commands only.
  const bulkBar = el("div", { class: "type-bulk-bar" });
  bulkBar.appendChild(el("span", { class: "command-card-label" }, "Remaining"));
  // The SAME tri-state select-all the queue headings use -- it was written
  // generic over (host, ids, state) precisely so a second surface could
  // adopt it by calling it, and this is that surface.
  appendHeadingSelectionControls(bulkBar, group.candidateIds, state);
  // RENDERED FROM THE DESCRIPTORS (AG, 2026-08-03), so the Opt/Alt cap a
  // reviewer reads here is minted by the same list the chord handler runs.
  // Keycaps only while the type still HAS remaining work -- a finished
  // type's disabled buttons must not advertise keys that would refuse.
  for (const action of typeBulkActions(summary.id, group, remaining, state)) {
    const live = remaining.length > 0 && action.chord !== null;
    const btn = live ? keycapButton(groupScopeChordLabel(action.chord!), action.label, action.run) : button(action.label, action.run, remaining.length === 0);
    applyVerboseLabel(btn, action);
    btn.title = action.hint;
    // The originating-button tint, preserved: an open editor belongs to the
    // button that opened it, and chord IS the action here (only Change
    // declares "C", only Redact declares "R").
    const editing = action.chord === "C" ? "Rename" : action.chord === "R" ? "Redact" : null;
    if (editing) btn.classList.toggle("action-editing", isEditingTypeMembers(summary.id, editing));
    bulkBar.appendChild(btn);
  }
  surface.appendChild(bulkBar);
  if (inlineEditor?.scope === "type-members" && inlineEditor.typeId === summary.id) {
    renderInlineEditor(surface, inlineEditor.action === "Rename" ? "Replacement for all remaining (required)" : redactBlankHint(inlineEditor.candidateIds));
  }

  // MEMBER GRID + FOCUS PANE (AG, 2026-08-04). Two regions side by side:
  // the collection (left, 3fr) and the active member's evidence (right,
  // 2fr). Items first in the DOM so reading order matches visual order --
  // see index.html's .type-split block for why the shares are inverted
  // relative to .triage-split.
  const split = el("div", { class: "type-split" });
  // REGION 1 receives EVERY cell at render time; layoutMemberRegions (a
  // render-tail measurement, since only the attached tree knows how many
  // whole rows fit beside the inspector) moves the overflow into region 2.
  // Rendering all-then-moving rather than measuring-then-rendering keeps
  // this a single render pass -- the DOM move is a reparent, not a rebuild,
  // so no listener or focus state is disturbed.
  const rows = el("div", { class: "type-member-rows type-member-region-top" });
  const rest = el("div", { class: "type-member-rows type-member-region-rest" });
  // Per-type track floor -- the "dynamic" in "2 items per row if the data
  // fits best, or 3 if there're more room" is auto-fill's job; the floor is
  // what stops Acronyms and Document Titles being given the same width.
  rows.style.setProperty("--type-track", TYPE_TRACK_MIN[summary.id]);
  rest.style.setProperty("--type-track", TYPE_TRACK_MIN[summary.id]);

  // The active member: the cursor when set (keyboard mode). Drives the
  // cell highlight and the revealed action cluster.
  const activeMemberId = typeCheckCursor?.typeId === summary.id ? typeCheckCursor.candidateId : null;
  // The PANE's member falls back to the first unresolved one, so the pane
  // never opens empty-handed -- the same fallback the People panel used
  // when it lived inline, preserved verbatim.
  const paneMemberId = activeMemberId ?? remaining[0] ?? summary.candidateIds[0] ?? null;
  for (const candidateId of summary.candidateIds) {
    const candidate = state.detection?.candidates.find((c) => c.id === candidateId);
    if (!candidate) continue;
    const resolved = isItemResolvedInState("item-check", candidateId, state);
    const decided = state.reviewSession?.candidateDecisions[candidateId];
    const isActive = candidateId === activeMemberId;
    const acknowledged = isAcknowledged({ kind: "candidate", stage: "type-check", candidateId });
    const row = el("div", {
      class: `type-member-row${isActive ? " type-member-row-active" : ""}${resolved ? " type-member-row-decided" : ""}${acknowledged ? " row-acknowledged-pulse" : ""}`,
      "data-type-member-id": candidateId,
    });
    // UNIFIED DECISION COLOR SYSTEM (AG, 2026-08-03): a decided member row
    // wears its own decision, which also supplies --decision-hue to the
    // "✓ Keep"/"✓ Redact" label and the acknowledgement pulse inside it.
    if (decided) row.classList.add(decisionClass(decided.decision), "decision-tinted");
    row.addEventListener("click", (event) => {
      // Row click selects (moves the cursor); button clicks inside keep
      // their own handlers -- don't re-render focus out from under them.
      if ((event.target as HTMLElement | null)?.closest("button, input")) return;
      typeCheckCursor = { typeId: summary.id, candidateId };
      render();
    });
    // ROW SELECTION (AG, 2026-08-03), on the same terms as the queue rows:
    // undecided rows only, because the bulk bar acts on remaining items
    // exclusively and a checkbox on a settled row would let the count
    // overstate what any button changes. The empty slot on decided rows
    // keeps the value column aligned.
    const checkSlot = el("span", { class: "type-member-check" });
    if (!decided && !resolved) {
      const check = el("input", { class: "triage-check", type: "checkbox", title: "Select for bulk action" });
      (check as HTMLInputElement).checked = selectedCandidateIds.has(candidateId);
      check.setAttribute("aria-label", `Select ${candidate.displayValue}`);
      check.addEventListener("click", (event) => event.stopPropagation());
      check.addEventListener("change", () => {
        if (selectedCandidateIds.has(candidateId)) selectedCandidateIds.delete(candidateId);
        else selectedCandidateIds.add(candidateId);
        render();
      });
      checkSlot.appendChild(check);
    }
    /*
     * THE CELL IS THE NAME (AG, 2026-08-04: "simply the text in the cell,
     * the count, and let the main panel do the work"). `.result-cell`'s
     * shape, deliberately -- see index.html's cell block for the full
     * reasoning, including the note that removing the inline ① chips
     * REVERSES a stated instruction from 2026-08-03 and does so knowingly.
     *
     * The decided state keeps the app's one-glyph language (`.reviewed-check`
     * -- "One glyph everywhere: candidate rows, group rows, member rows,
     * result cells") rather than a worded label, because at this type scale
     * a "✓ Keep as-is" string would compete with the name it sits beside.
     * The decision is still legible as colour: the cell wears its own
     * decision tint, and the glyph takes that hue.
     */
    row.appendChild(checkSlot);
    const label = el("span", { class: "type-member-value" }, candidate.displayValue);
    label.title = decided ? `Reviewed — ${decisionDisplayLabel(decided.decision)}` : candidate.displayValue;
    row.appendChild(label);
    row.appendChild(el("span", { class: "type-member-count" }, `(${candidate.occurrenceIds.length})`));
    if (decided) {
      row.appendChild(el("span", { class: "reviewed-check" }, "✓"));
    } else if (resolved) {
      // No decision of its own to show a glyph for -- this one has to say
      // WHY it is settled, or it reads as an item nobody has reached yet.
      row.appendChild(el("span", { class: "type-member-decision" }, "✓ Covered by group"));
    }
    rows.appendChild(row);
  }
  // THE PANE, for every type rather than People alone (AG, 2026-08-04).
  // People was special-cased because an inline panel would have made the
  // other eight lists unusably tall -- a constraint that disappears once
  // the panel has a column of its own. The other eight now get evidence
  // for their active member too, which is a strict gain; if it proves
  // noisy the per-type gate is one condition and can come back.
  const pane = el("div", { class: "type-focus-pane" });
  const paneCandidate = paneMemberId ? (state.detection?.candidates.find((c) => c.id === paneMemberId) ?? null) : null;
  if (paneCandidate && state.classification) {
    const paneDecision = state.reviewSession?.candidateDecisions[paneCandidate.id];
    const reviewOccurrences = groupReviewOccurrencesForCandidate(paneCandidate.id, state.classification.reviewOccurrences);
    renderCandidateDetailPanel(pane, paneCandidate, state.quality, reviewOccurrences, paneDecision?.decision, "type-check", state, {
      // showHeader: true, unlike the old inline panel -- in a column of its
      // own the panel is no longer sitting directly beneath the row that
      // names it, so it has to name itself or the reviewer cannot tell which
      // member they are looking at. It is also what makes the cell's
      // reduction to name-and-count safe: the header carries the active
      // member's suggestion chips and decisions, so nothing the cells gave
      // up is unreachable -- ONE CONTROL, ONE PLACE (AG, 2026-08-03),
      // resolved in the panel's favour here.
      showHeader: true,
      ...(paneDecision ? {} : { schemeClass: "scheme-nav decision-tinted" }),
    });
  } else {
    // Never an empty inspector column -- it reads as broken chrome.
    pane.appendChild(el("p", { class: "type-focus-empty" }, "Select an item to see where it appears in the document."));
  }
  // INSPECTOR FIRST (AG, 2026-08-04: "let's put the panel on left") -- and
  // first in the DOM as well as on screen, so reading order, tab order and
  // visual order agree without CSS reordering, and the sub-breakpoint stack
  // puts the inspector on top. Same arrangement as .triage-split.
  split.appendChild(pane);
  split.appendChild(rows);
  surface.appendChild(split);
  // REGION 2 -- directly below the split, full width. Emitted empty; the
  // render-tail pass fills it from region 1's overflow. `:empty` collapses
  // it when everything fits beside the inspector.
  surface.appendChild(rest);
  container.appendChild(surface);
}

/**
 * The auto-fill track FLOOR, per semantic type (AG, 2026-08-04).
 *
 * The column count itself is `auto-fill`'s job and follows the viewport --
 * "2 items per row if the data fits best, or 3 if there're more room."
 * What this table supplies is the minimum a track may shrink to, and it is
 * per-type because the nine types differ by an order of magnitude in label
 * length: "Information Technology Services" and "PDF" are in the same list
 * in a real document today. A single global floor is necessarily wrong for
 * one end of that range.
 *
 * WHY A TABLE AND NOT A MEASUREMENT. Measuring the widest rendered label
 * (the sizeCategoryCells / alignConfidenceColumns precedent) adapts to the
 * actual document, which is better in principle and was the first
 * instinct. It loses on the distribution: the WIDEST label sets the track
 * for all of them, so one 40-character outlier in Acronyms ("Post
 * Enrollment Requisite Checking") collapses a five-column grid to two for
 * the fifty short labels sitting beside it. A floor per type is the calmer
 * artifact -- it is a product judgment about the category, and it holds
 * still between documents.
 *
 * The 14rem lower bound survives from the version of this table that had
 * to fit four decision buttons on one line inside the cell. The cell is
 * name-and-count now (AG, 2026-08-04) so that constraint is gone, and
 * these floors are now purely about label legibility -- they could go
 * narrower. Left where they are pending a look at a real document, since
 * narrower tracks mean more columns and the right answer is a judgment
 * about scanning, not arithmetic.
 *
 * These are considered starting points. They want checking against a real
 * document in the browser; the table exists so that tuning is a one-line
 * edit per type rather than a layout change.
 */
const TYPE_TRACK_MIN: Record<SemanticTypeId, string> = {
  people: "20rem", // full names, frequently three tokens
  emails: "18rem", // addresses do not wrap or truncate gracefully
  phones: "14rem",
  organizations: "20rem", // "Communication Center", "Enrollment Systems"
  acronyms: "14rem", // "PERC", "FYI" -- the expansions are the outliers, deliberately not accommodated
  identifiers: "14rem",
  "dates-terms": "16rem",
  "document-titles": "22rem", // titles run longest of the nine
  other: "18rem", // heterogeneous by definition; the safe middle
};

/**
 * Type Check keyboard (PHASE 2) -- runs BEFORE resolveKeyboardCommand
 * (the keymap's type-check branch handles between-card movement; this
 * handler owns the INSIDE of the focused card, the same division as
 * handleSplitReviewKey/handleGroupMemberDecisionKey). Grammar, per the
 * app-wide inside-an-item rules: Down/Enter enter the member list;
 * Up/Down move the cursor; K/C/R/I act on the cursor member; Escape backs
 * out to the card level; Tab stands the cursor down and falls through to
 * the keymap ("Tab always leaves the entire item"). At the CARD level,
 * K/I bulk-decide the remaining members and C/R open the type-level
 * editor -- "plain key = focused object", and the focused object is the
 * type.
 */
function handleTypeCheckKey(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
  if (inlineEditor) return false; // typing owns the keys; the editor's own listeners handle confirm/cancel
  const state = dispatcher.getState();
  if (!state.documentLoaded) return false;
  const target = state.focus?.target;
  if (!target || target.stage !== "type-check" || !target.itemId) return false;
  const group = typeGroupFor(target.itemId, state);
  if (!group) return false;
  const key = event.key;
  const letter = key.length === 1 ? key.toLowerCase() : key;

  if (typeCheckCursor && typeCheckCursor.typeId === target.itemId) {
    const current = typeCheckCursor.candidateId;
    if (key === "Escape") {
      typeCheckCursor = null;
      render();
      return true;
    }
    if (key === "Tab") {
      typeCheckCursor = null; // Tab leaves the item; keymap moves to the next type
      return false;
    }
    if (key.startsWith("Arrow")) {
      /*
       * SPREADSHEET ARROWS OVER THE MEMBER GRID (AG, 2026-08-04: "I'd like
       * the behavior to be internally consistent with key nav to what we
       * have in other areas too").
       *
       * This moved ±1 for all four arrows, which was correct while the
       * member list was one stacked column and became wrong the moment it
       * became a grid: Down would have moved one cell to the RIGHT. Now
       * `gridStep` -- the same function the Results and triage grids move
       * by -- decides, over a column count measured from THIS grid (the
       * pane narrows it relative to the type-card grid above, so a
       * page-wide measurement would skip rows).
       *
       * Members are decided rows included, clamped at the ends: a decided
       * cell stays visitable for re-deciding, unchanged.
       *
       * MEMBER ORDER IS VISUAL READING ORDER, which is what makes this
       * safe: `candidateIds` is the render order and auto-fill fills
       * row-major, so index n+1 is the cell to the right, wrapping to the
       * next row. That is the same assumption moveWithinResultsGrid
       * already makes, and it is why `nextUnresolvedTypeMember`'s
       * auto-advance needed no change at all.
       */
      const members = group.candidateIds;
      const idx = members.indexOf(current);
      const next = memberGridTarget(idx, members, event.key);

      /*
       * "out" -- LEAVING THE MEMBER LEVEL. memberGridTarget returns it for
       * Up off the first row of the TOP region, and for Left at index 0.
       *
       * The Up rung was `idx === 0` before the grid, which would have
       * stranded cells 1..cols-1: the reviewer on the second cell of row
       * one presses Up, nothing happens, and nothing indicates that Up was
       * ever the way out. Now it is "no row above me", which is the 2-D
       * reading of the same sentence -- the detail panel's "Up past the
       * first control backs out one level" grammar (.16), unchanged in
       * intent and now correct in two dimensions and across two regions.
       *
       * ArrowLeft at index 0 keeps backing out too. The Results grid would
       * clamp there instead, and consistency would argue for it, but this
       * key works today and silently turning it into a no-op would be a
       * regression in the name of tidiness. Divergence recorded, not
       * resolved.
       *
       * ArrowDown at the last row CLAMPS -- it deliberately does not hand
       * focus into the inspector the way Down does on the sectioned queue
       * (AG, 2026-08-02: "the nav needs to allow down arrow to enter the
       * actual focus area"). The situations differ: there the row IS the
       * focused item and the panel is a level deeper, whereas here the
       * reviewer is already inside the type and the inspector follows the
       * cursor by itself -- there is no second level for Down to enter.
       * Flagged as the most likely of these rules to want revisiting.
       */
      if (next === "out") {
        typeCheckCursor = null;
        render();
        return true;
      }
      if (next !== null && next !== idx) {
        typeCheckCursor = { typeId: group.typeId, candidateId: members[next]! };
        render();
      }
      return true;
    }
    if (letter === "k" || letter === "i") {
      decideTypeMemberAndAdvance(
        group,
        current,
        letter === "k" ? { family: "review", type: "keepCandidate", candidateId: current } : { family: "review", type: "ignoreCandidate", candidateId: current }
      );
      return true;
    }
    if (letter === "c" || letter === "r") {
      openInlineEditor({ scope: "candidate", stage: "type-check", candidateId: current, action: letter === "c" ? "Rename" : "Redact" });
      return true;
    }
    return false;
  }

  // Card level.
  if (key === "ArrowDown" || key === "Enter") {
    const entry = unresolvedTypeMembers(group, state)[0] ?? group.candidateIds[0];
    if (!entry) return false;
    typeCheckCursor = { typeId: group.typeId, candidateId: entry };
    render();
    return true;
  }
  if (letter === "k" || letter === "i") {
    applyTypeBulk(group, letter === "k" ? "Keep" : "Ignore", state);
    return true;
  }
  if (letter === "c" || letter === "r") {
    const remaining = unresolvedTypeMembers(group, state);
    if (remaining.length === 0) {
      refuse("Nothing remaining in this type.");
      return true;
    }
    openInlineEditor({ scope: "type-members", typeId: group.typeId, candidateIds: remaining, action: letter === "c" ? "Rename" : "Redact" });
    return true;
  }
  return false;
}

function renderOutputStage(container: HTMLElement, state: ReturnType<WorkspaceCommandDispatcher["getState"]>): void {
  renderRedactionRulesPanel(container, state);
  if (!state.readiness.reviewComplete) {
    // SAY WHAT IS ACTUALLY OUTSTANDING (AG, 2026-08-02). This line named
    // Item Check candidates only, so a document held back by an
    // unaddressed structural proposal read "0 item(s) still unresolved"
    // -- a message that contradicted its own gate and hid the real
    // blocker. Both axes now, each mentioned only when it has work, so
    // the ordinary candidate case is worded exactly as before.
    const parts: string[] = [];
    if (state.readiness.unresolvedItemCount > 0) parts.push(`${state.readiness.unresolvedItemCount} item(s) still unresolved in Item Check`);
    if (state.readiness.unresolvedArtifactCount > 0) {
      parts.push(`${state.readiness.unresolvedArtifactCount} relationship proposal(s) still awaiting review in Ambiguity Check`);
    }
    // Fallback wording covers the remaining case -- work outstanding on
    // Group Check or Type Check, which the QA/Output gate now also
    // respects -- rather than rendering an empty sentence.
    container.appendChild(el("p", {}, `Review is not complete yet -- ${parts.length > 0 ? parts.join("; ") : "some stages still have unresolved work"}.`));
  } else {
    container.appendChild(
      button("Generate Output", async () => {
        const result = await dispatcher.dispatchApplication({ family: "document", type: "generateOutput" });
        // RX-09: the highest-stakes failure in the product -- the reviewer
        // has finished a full review and cannot get their document out.
        // Persistent banner (first child of the sticky chrome, cannot be
        // scrolled away), never a 1.3s toast.
        if (!result.ok) showFailureBanner("Failed to generate output", result.reason ?? "no reason given");
        else failureBanner = null; // a successful generation supersedes a prior output failure
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
// COMMAND-BAR KEYCAPS (AG, 2026-08-01): the legend is structured data now,
// not prose -- each segment is key(s) + label so the keys can render in the
// same faux-keycap language the digit accelerators already use ("implement
// the same square key-encapsulation visual language here"). Multi-character
// keys ("Enter", "Tab", "⇧← ⇧→", the arrow clusters "↑↓←→"/"⌥↑↓←→") render
// as wider rectangles, per Andrew's explicit direction; chords keep the
// modifier glyph inside the cap ("⇧K"). A `text` segment is plain prose
// with no key at all (QA's no-model note).
type LegendSegment = { keys: string[]; label: string } | { text: string };

/** Shorthand segment builder -- one key or several alternative keys
 *  (rendered as adjacent caps, e.g. F6 and "," both cycling regions),
 *  then the muted label. */
function kseg(keys: string | string[], label: string): LegendSegment {
  return { keys: Array.isArray(keys) ? keys : [keys], label };
}

const STAGE_SHORTCUT_LEGEND: Record<WorkflowStage, LegendSegment[]> = {
  // WORKSPACE INTERACTION REVISION: "D/./Space Detail" removed from both
  // rows below -- there is no longer a detail panel toggle to bind a key
  // to (the focused candidate's panel is always showing; see
  // `acknowledgement`'s doc comment).
  // INTERACTION LANGUAGE (2026-07-30): "1–9 Link" (ambiguity's numbered
  // identities), "X Select" (Item Check's selection toggle), and "Enter
  // Details" (go deeper into the focused item's panel) join the base
  // vocabulary. Selection's Shift row is appended CONDITIONALLY by
  // commandBarLegend (only while something is selected), keeping the
  // resting legend compact.
  "ambiguity-check": [
    kseg("K", "Keep"),
    kseg("C", "Change"),
    kseg("R", "Redact"),
    kseg("I", "Ignore"),
    kseg("1–9", "Accept suggestion"),
    kseg("Enter", "Details"),
    // DOWN ENTERS (AG, 2026-08-02): ↓ goes INTO the focused item's
    // panel; ←→↑ and Tab move between items (sectioned-queue grammar).
    kseg("↓", "Enter item"),
    kseg("←→↑", "Move"),
    kseg("Tab", "Next item"),
  ],
  "group-check": [
    kseg("K", "Keep as-is"),
    kseg("C", "Change"),
    kseg("R", "Redact"),
    kseg("I", "Ignore"),
    kseg("F", "Fix this"),
    // SPLIT REVIEW MODE + GROUP "USE" (AG, 2026-08-02): digit 1 separates
    // the group; digits 2+ use member N's spelling for the whole group.
    kseg("1", "Separate"),
    kseg("2–9", "Use spelling"),
    kseg("↑↓←→", "Move"),
    kseg("Tab", "Next item"),
  ],
  // TYPE CHECK (PHASE 2, 2026-08-02): card-level resting vocabulary --
  // K/C/R/I act on the TYPE's remaining members ("plain key = focused
  // object"); ↓/Enter enter the member list (the member-level variant is
  // derived contextually in commandBarLegend, same as Group Check's).
  "type-check": [
    kseg("K", "Keep remaining"),
    kseg("C", "Change remaining"),
    kseg("R", "Redact remaining"),
    kseg("I", "Ignore remaining"),
    kseg("↓", "Enter members"),
    kseg("←→↑", "Move"),
    kseg("Tab", "Next type"),
  ],
  "item-check": [
    kseg("K", "Keep"),
    kseg("C", "Change"),
    kseg("R", "Redact"),
    kseg("I", "Ignore"),
    kseg("X", "Select"),
    kseg("Enter", "Details"),
    kseg("/", "Search"),
    kseg("[", "Prev"),
    kseg("]", "Next undecided"),
    kseg("Tab", "Next item"),
  ],
  qa: [{ text: "No per-item keyboard model in this build." }],
  output: [],
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
function commandBarLegend(state: ReturnType<WorkspaceCommandDispatcher["getState"]>, activeStage: WorkflowStage): LegendSegment[] {
  if (inlineEditor) {
    // Dynamic default-placeholder preview (2026-08-02): the legend shows
    // the same live default the editor's own placeholder shows.
    const editorIds: readonly string[] =
      inlineEditor.scope === "candidate" || inlineEditor.scope === "not-quite-member" || inlineEditor.scope === "split-member"
        ? [inlineEditor.candidateId]
        : inlineEditor.scope === "bulk"
          ? [...selectedCandidateIds]
          : inlineEditor.candidateIds;
    const redactLabel = `Confirm (blank = ${redactDefaultPreview(editorIds) ?? "default placeholder"})`;
    return [kseg("Enter", inlineEditor.action === "Rename" ? "Confirm replacement" : redactLabel), kseg("Esc", "Cancel")];
  }
  if (activeStage === "group-check") {
    // SPLIT REVIEW MODE (AG, 2026-08-02): its own vocabulary while the
    // session is active -- member letters + Esc, nothing group-level.
    if (splitReview && state.focus?.target.itemId === splitReview.groupId) {
      return [
        kseg("K", "Keep member"),
        kseg("C", "Change member"),
        kseg("R", "Redact member"),
        kseg("I", "Ignore member"),
        kseg("Esc", "Cancel split"),
      ];
    }
    const notQuiteOpen = state.focus?.target.panel.kind === "not-quite";
    // INTERACTION LANGUAGE (2026-07-30): Enter = Done fixing joins the
    // Not Quite vocabulary (keymap.ts's completeNotQuite binding) --
    // Enter commits, Esc leaves without completing.
    // CONTEXTUAL MEMBER DECISIONS (AG, 2026-07-30): while a member row is
    // the active one inside the expanded group, K/C/R/I mean the MEMBER --
    // the legend must say which level the letters act on.
    const memberActive =
      !notQuiteOpen && groupRovingFocus !== null && groupRovingFocus.groupId === state.focus?.target.itemId && groupRovingFocus.row >= 1;
    const base = notQuiteOpen
      ? [
          kseg("K", "Keep member"),
          kseg("C", "Change member"),
          kseg("R", "Redact member"),
          kseg("I", "Ignore member"),
          kseg("↑↓", "Move member"),
          kseg("Enter", "Done fixing"),
          kseg("Esc", "Exit"),
        ]
      : memberActive
        ? [
            kseg("K", "Keep member"),
            kseg("C", "Change member"),
            kseg("R", "Redact member"),
            kseg("I", "Ignore member"),
            kseg("F", "Fix this"),
            kseg("↑↓", "Members"),
            kseg("Tab", "Next item"),
          ]
        : STAGE_SHORTCUT_LEGEND["group-check"];
    // 2026-07-30 feature spec: "[S]ource will also appear dynamically in
    // the Commander Bar when the Context button is visible" -- Source
    // buttons render on member rows, which are on screen whenever a group
    // is expanded (the focused group always is) or a Fix this panel is
    // open.
    const sourceVisible = notQuiteOpen || Boolean(state.focus?.target.itemId);
    return sourceVisible ? [...base, kseg("S", "Source")] : base;
  }
  if (activeStage === "type-check") {
    // TYPE CHECK (PHASE 2): member mode switches the letters' object from
    // the type to the CURSOR MEMBER -- the legend must say which, the same
    // rule Group Check's member-context legend established.
    if (typeCheckCursor) {
      return [
        kseg("K", "Keep member"),
        kseg("C", "Change member"),
        kseg("R", "Redact member"),
        kseg("I", "Ignore member"),
        // 2026-08-04: the member list is a GRID now -- ↑↓ move a row, ←→
        // move a cell. The legend said "↑↓ Members" while the list was one
        // column, where the two readings were the same thing; under a grid
        // they are not, and a legend that names only half the arrows would
        // leave the other half undocumented on the surface that changed.
        kseg("←→", "Member"),
        kseg("↑↓", "Row"),
        kseg("Esc", "Back to types"),
        kseg("Tab", "Next type"),
      ];
    }
    return STAGE_SHORTCUT_LEGEND["type-check"];
  }
  if (activeStage === "item-check" || activeStage === "ambiguity-check") {
    // REVIEW SCOPE, Pass 1: while a wider scope is what the inspector
    // explains, the legend must say what the keys ACTUALLY do there --
    // advertising "K Keep" while the mis-target guard refuses K is the
    // exact paint/keystroke disagreement the invariant forbids. Derived
    // fresh from the same currentReviewScope every other consumer reads.
    if (activeStage === "item-check" && itemCheckViewMode === "triage") {
      const scopeKind = currentReviewScope(state)?.source.kind;
      if (scopeKind === "selection") {
        return [
          kseg("1–9", "Section actions (checked)"),
          kseg(`${OPTION_KEY_LABEL} K/C/R/N`, "Decide the group"),
          kseg("Space", "Hold details open"),
          kseg("←→↑", "Move cursor"),
          kseg("Tab", "Next item"),
        ];
      }
      if (scopeKind === "stage-remainder") {
        return [
        kseg("Enter", "Return to item"),
        kseg("1–9", "Section actions"),
        kseg(`${OPTION_KEY_LABEL} K/C/R/N`, "Decide the group"),
        kseg("←→↑", "Move & return"),
        kseg("Space", "Hold details open"),
      ];
      }
    }
    // 2026-07-30 feature spec + interaction language: By Category
    // advertises its parallel cell sets (arrows = Results, Shift+Arrows =
    // the whole narrowing column); the selection vocabulary's Shift row
    // appears only while a selection exists (the same condition the "N
    // selected" chip renders under), and "1–9 Link identity" only while
    // the focused candidate actually has identities to link -- derive,
    // don't clutter.
    const legend =
      activeStage === "item-check" && itemCheckViewMode === "category"
        ? [
            kseg("K", "Keep"),
            kseg("C", "Change"),
            kseg("R", "Redact"),
            kseg("I", "Ignore"),
            kseg("X", "Select"),
            kseg("Enter", "Details"),
            kseg("↑↓←→", "Results"),
            // PHASE 2: the narrowing column moved to ⌥ when ⇧←/→ became
            // stage movement -- see handleFilterColumnKey.
            kseg("⌥↑↓←→", "Filters"),
            kseg("/", "Search"),
            kseg("]", "Next undecided"),
            kseg("Tab", "Next item"),
          ]
        : sectionedQueueStage(activeStage)
          ? // TRIAGE QUEUE (2026-07-30; the Ambiguity stage joined via
            // AMBIGUITY CATEGORY-FIRST, AG 2026-08-02): the sectioned
            // queue's core vocabulary -- Enter accepts (or opens details
            // when nothing is acceptable), Space discloses, Shift+A
            // accepts the focused item's whole section; K/C/R/I still
            // decide the focused row.
            [
              kseg("Enter", "Accept"),
              kseg("Space", "Details"),
              kseg("⇧A", "Accept section"),
              // DOWN ENTERS (AG, 2026-08-02): ↓ goes INTO the focused
              // item; ←→↑ and Tab move between items.
              kseg("↓", "Enter item"),
              kseg("←→↑", "Move"),
              kseg("K", "Keep"),
              kseg("C", "Change"),
              kseg("R", "Redact"),
              kseg("I", "Ignore"),
              // "]"/"[" remain Item Check bindings (goToAdjacentInVisible-
              // List's own scope) -- not advertised where they are inert.
              ...(activeStage === "item-check" ? [kseg("]", "Next undecided")] : []),
            ]
          : [...STAGE_SHORTCUT_LEGEND[activeStage]];
    // REVIEWER RECOMMENDATION UX (2026-07-30): digits accept the focused
    // item's suggestions (which subsume identity links) -- advertised
    // only while suggestions actually exist; derive, don't clutter.
    // Both queue stages (2026-08-02): the same digits, the same rule.
    const focusedId = state.focus?.target.itemId;
    const hasSuggestions = Boolean(
      focusedId &&
        ((recommendationForCandidate(focusedId, state)?.suggestions.length ?? 0) > 0 ||
          state.grouping?.ambiguityProposals.some((p) => p.candidateId === focusedId && p.candidateGroupOptions.length > 0))
    );
    if (hasSuggestions) legend.push(kseg("1–9", "Accept suggestion"));
    // SECTION-ACTION DIGITS (AG, 2026-08-02): advertised only when the
    // active scope actually declares actions, and labelled with the exact
    // digits it reserves -- derive, don't clutter (the same rule the
    // suggestion segment above follows). The range is stated from the
    // reserved floor up to ⑨ so it always names real, pressable keys:
    // one action reads "9", two read "8–9", three "7–9".
    const scopeActions = activeScopeSectionActions(state);
    if (scopeActions.length > 0) {
      const digits = sectionActionDigitAssignments(scopeActions, (a) => a.chord)
        .map((a) => a.digit)
        .filter((d): d is number => d !== null);
      const lowest = Math.min(...digits);
      legend.push(kseg(lowest === 9 ? "9" : `${lowest}–9`, "Section actions"));
    }
    if (activeStage === "item-check" && selectedCandidateIds.size > 0) {
      legend.push(kseg(["⇧K", "⇧C", "⇧R", "⇧I"], "Apply to selected"));
      legend.push(kseg("⇧X", "Clear visible"));
    }
    return legend;
  }
  return STAGE_SHORTCUT_LEGEND[activeStage];
}

/** Renders one legend segment: `<kbd class="keycap">` per key (the app's
 *  one faux-key visual, sized by its label -- see index.html's .keycap
 *  note), then the muted label; or plain text for key-less segments. */
function legendSegmentEl(segment: LegendSegment): HTMLElement {
  if ("text" in segment) return el("span", { class: "legend-text" }, segment.text);
  const entry = el("span", { class: "legend-entry" });
  for (const key of segment.keys) entry.appendChild(el("kbd", { class: "keycap" }, key));
  entry.appendChild(el("span", { class: "legend-label" }, segment.label));
  return entry;
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
 * Contents, in order (revised by the 2026-08-01 command-bar refinement):
 * (1) the current stage's shortcut legend, keycap-rendered -- always
 * present, satisfying "the reviewer should rarely need the mouse" by making
 * the vocabulary discoverable without a memorized cheat sheet; (2) current
 * selection + the Next undecided / Previous decision quick-jumps, ONLY
 * meaningful in Item Check, so rendered only there (buttons rather than
 * new mnemonic letters beyond `[`/`]`, per the original Milestone 2
 * cognitive-load reasoning); (3) the NAVIGATION CARD at the far right --
 * application-wide movement only (⇧←/⇧→ stages since Phase 2, F6/,
 * regions, Jump to category), visually separated from the item-command
 * legend. "Next
 * ambiguity" was removed 2026-08-01 as vestigial (see the note at its old
 * render site below).
 */
function renderCommandBar(container: HTMLElement, state: ReturnType<WorkspaceCommandDispatcher["getState"]>, activeStage: WorkflowStage): void {
  // COMMAND CARD PLACEMENT (AG, 2026-08-02): the two-section card moved UP
  // out of the workspace's top band into the chrome's status row -- the
  // previously empty space right of the Review Status scores and the
  // statistics line, above the stage tabs ("the exact same panel, same
  // functions, just up above"). Still inside the sticky chrome, so it
  // remains visible while scrolling and still re-derives its contents
  // from focus context every render. The band itself survives as a slim
  // surface edge (see render()) so the stage-encapsulation geometry --
  // active tab terminating into the workspace surface -- is unchanged.
  const card = el("div", { class: "command-card" });

  // --- Section 1: Current Review (the focused item's own vocabulary) ---
  const legend = commandBarLegend(state, activeStage);
  // SECTION LABELS REMOVED (AG, 2026-08-03): "Current Review" and
  // "Navigation" were pinned to the card's far left by
  // `.command-card-label`'s `margin-right: auto` while the keycaps packed
  // right, so as the shortcut list grew the labels ended up stranded
  // across an ever-widening gutter -- and they were never carrying
  // information: "Enter Accept · Space Details" says what it is. Cutting
  // them lets the card hug the keycaps, which is where the border belongs.
  //
  // The naming survives as `aria-label` on each row: the grouping is still
  // real and still useful non-visually, it just does not need to be drawn.
  const reviewRow = el("div", { class: "command-card-row", "aria-label": "Current review shortcuts" });
  for (const segment of legend) reviewRow.appendChild(legendSegmentEl(segment));
  if (activeStage === "item-check") {
    if (selectedCandidateIds.size > 0) {
      reviewRow.appendChild(el("span", { class: "command-bar-selection" }, `${selectedCandidateIds.size} selected`));
    }
    // WAVE 2 CLOSEOUT (2026-07-29): visibleItemCheckIds(), not an inline
    // queryItemCheck() -- this button pair previously ignored Category
    // Check's narrowing, so "Next undecided" could select a candidate the
    // reviewer couldn't see while By Category was active. One source of
    // "what is the visible list," same as arrow keys and the post-decision
    // advance. These live in Current Review: they move through the
    // review's own items, not around the application.
    const visible = visibleItemCheckIds(state);
    reviewRow.appendChild(button("Next undecided", () => goToAdjacentInVisibleList(visible, state, false, "forward")));
    reviewRow.appendChild(button("Previous decision", () => goToAdjacentInVisibleList(visible, state, true, "backward")));
  }
  // A stage with no per-item vocabulary (Output; QA's text-only note
  // still renders) shows only the Navigation section -- no empty row.
  // `> 0`, not `> 1`: this guard used to allow for the always-present
  // label sitting at child zero. With the label gone, `> 1` would have
  // silently dropped a row carrying exactly one shortcut.
  if (reviewRow.childNodes.length > 0) card.appendChild(reviewRow);

  // --- Section 2: Navigation (application-wide movement) ---
  // PHASE 2 (AG, 2026-08-02): relative workflow navigation -- ⇧←/→ over
  // the ACTIVE stage list -- replaces the ⇧1–5 stage digits entirely.
  const navCard = el("div", {
    class: "command-card-row",
    "aria-label": "Navigation shortcuts",
    title: "Shift+← previous stage · Shift+→ next stage (through the stages that currently contain work) · F6 or , cycles interface regions (Esc returns to review)",
  });
  navCard.appendChild(legendSegmentEl(kseg("⇧← ⇧→", "Stages")));
  navCard.appendChild(legendSegmentEl(kseg(["F6", ","], "Regions")));
  // "Next ambiguity" REMOVED (AG, 2026-08-01, "vestigial ... confirm that
  // before removing" -- confirmed): it was Milestone 2's cross-stage
  // quick-jump (focusStage + moveItem/nextUnresolved), built before stage
  // tabs carried live counts, before ⇧1–5 stage switching existed, and
  // before every decision auto-advanced to the next unresolved item
  // (reconcileFocus). Today the Ambiguity tab's own count says whether
  // ambiguity work remains, the tab (or ⇧←/→ since Phase 2 -- an
  // ambiguity stage with work is IN the active list) goes there, and
  // auto-advance walks the unresolved items -- the button's compound jump saved one
  // keypress and rendered on every stage including Output/QA (a placement
  // the reviewer-experience review had already flagged, RX-20).

  if (activeStage === "item-check") {
    const categories = new Set<string>();
    for (const candidate of state.detection?.candidates ?? []) {
      for (const category of candidateCategories(candidate, state)) categories.add(category);
    }
    if (categories.size > 0) {
      // Jump to category joins the Navigation card (AG, 2026-08-01) --
      // it moves the reviewer around the application's narrowing, so it
      // belongs with the other application-navigation controls rather
      // than floating detached in the bar. The placeholder option carries
      // the label; no separate text label needed inside the compact card.
      const jumpSelect = el("select", { class: "jump-category-select" }) as HTMLSelectElement;
      jumpSelect.appendChild(el("option", { value: "" }, "Jump to category…"));
      for (const category of [...categories].sort()) {
        jumpSelect.appendChild(el("option", { value: category }, categoryRuleLabel(category)));
      }
      jumpSelect.addEventListener("change", () => {
        if (jumpSelect.value) jumpToCategory(jumpSelect.value);
      });
      navCard.appendChild(jumpSelect);
    }
  }

  card.appendChild(navCard);
  container.appendChild(card);
}

/**
 * VISUAL HIERARCHY REFINEMENT (AG, 2026-08-01): a wrapped (two-line)
 * category cell spans exactly TWO fixed grid tracks -- "the two line pills
 * fill exactly twice the space of two single pills, meaning the grid is
 * unbroken, there is plenty of padded space for the multi-line pill." CSS
 * alone cannot know whether a label wrapped, so this is a render-tail
 * measurement over the freshly attached tree (the same deferred-layout
 * pattern as syncWorkspaceChromeHeight): a label taller than ~1.5 line
 * heights has wrapped, and its cell gets `grid-row: span 2` against the
 * grid's fixed `grid-auto-rows` track. Runs BEFORE scrollFocusedRowIntoView
 * so scrolling targets the final geometry. Fake-DOM guard per this file's
 * established precedent (verify/ui-smoke.ts implements no querySelectorAll/
 * getComputedStyle).
 */
function sizeCategoryCells(container: HTMLElement): void {
  if (typeof container.querySelectorAll !== "function" || typeof getComputedStyle !== "function") return;
  for (const cell of Array.from(container.querySelectorAll<HTMLElement>(".category-grid .category-cell"))) {
    const label = cell.querySelector<HTMLElement>(".category-cell-label");
    if (!label || typeof label.getBoundingClientRect !== "function") continue;
    const lineHeightPx = parseFloat(getComputedStyle(label).lineHeight);
    const threshold = Number.isFinite(lineHeightPx) ? lineHeightPx * 1.5 : 30;
    if (label.getBoundingClientRect().height > threshold) cell.style.gridRow = "span 2";
  }
}

/**
 * TYPE CHECK'S TWO MEMBER REGIONS (AG, 2026-08-04) -- the render-tail half
 * of the layout described in index.html's member-grid block.
 *
 * The renderer emits every cell into region 1 (beside the inspector); this
 * moves the overflow into region 2 (full width, directly below). It has to
 * happen here rather than in the renderer because "how many whole rows fit
 * beside the inspector" is RENDERED GEOMETRY -- it depends on the pane's
 * measured height, the auto-fill column count at this viewport, and the
 * cell height that falls out of the type scale. Same deferred-layout
 * pattern as sizeCategoryCells, and it runs BEFORE scrollFocusedRowIntoView
 * so the scroll targets the final position of a cell that may have moved.
 *
 * WHOLE ROWS ONLY. The cut is taken at a row boundary (cells grouped by
 * offsetTop), never mid-row, so region 2 always begins a fresh row and the
 * two regions never appear to interleave. A cell is moved only if its row's
 * BOTTOM would fall past the inspector -- a partially-visible final row
 * beside the pane would look like a rendering fault.
 *
 * The move is a reparent of existing nodes, not a rebuild: listeners,
 * checkbox state and the acknowledgement pulse all survive, which is why
 * render-all-then-move is cheaper AND safer here than measure-then-render.
 *
 * ROW BANDING rides along in the same pass (AG: "alternating white/grey for
 * the rows to help keep track"), for the reason it cannot be CSS: with
 * `auto-fill` the column count is a layout result, so no `nth-child`
 * modulus can express "every other row". Banded per region, since the two
 * have different column counts and a parity carried across the seam would
 * be meaningless.
 *
 * Fake-DOM guard per this file's established precedent -- verify/ui-smoke.ts
 * implements neither layout geometry nor `getBoundingClientRect`.
 */
function layoutMemberRegions(container: HTMLElement): void {
  if (typeof container.querySelector !== "function") return;
  const top = container.querySelector<HTMLElement>(".type-member-region-top");
  const rest = container.querySelector<HTMLElement>(".type-member-region-rest");
  const pane = container.querySelector<HTMLElement>(".type-focus-pane");
  if (!top || !rest || !pane || typeof pane.getBoundingClientRect !== "function") return;
  const cells = Array.from(top.children).filter((n): n is HTMLElement => (n as HTMLElement).classList?.contains("type-member-row"));
  if (cells.length === 0) return;

  // Group into visual rows by offsetTop -- the same primitive columnsAcross
  // uses, generalized from "the first row" to "every row".
  const rows: HTMLElement[][] = [];
  let currentTop: number | null = null;
  for (const cell of cells) {
    if (cell.offsetTop !== currentTop) {
      rows.push([]);
      currentTop = cell.offsetTop;
    }
    rows[rows.length - 1]!.push(cell);
  }

  // The cut: the first row whose bottom edge falls past the inspector's.
  // Everything from there down belongs to region 2.
  const paneBottom = pane.getBoundingClientRect().bottom;
  let cut = rows.length;
  for (let r = 0; r < rows.length; r++) {
    const cell = rows[r]![0]!;
    if (typeof cell.getBoundingClientRect !== "function") return;
    if (cell.getBoundingClientRect().bottom > paneBottom) {
      cut = r;
      break;
    }
  }
  for (let r = cut; r < rows.length; r++) {
    for (const cell of rows[r]!) rest.appendChild(cell);
  }

  // Band each region by its own visual rows, AFTER the move (region 2's
  // rows re-wrap at the full width, so its geometry only exists now).
  bandGridRows(top);
  bandGridRows(rest);
}

/** Alternating row fill over one auto-fill grid, by measured row rather
 *  than by child index -- see layoutMemberRegions for why CSS cannot. */
function bandGridRows(grid: HTMLElement): void {
  const cells = Array.from(grid.children).filter((n): n is HTMLElement => (n as HTMLElement).classList?.contains("type-member-row"));
  let currentTop: number | null = null;
  let rowIndex = -1;
  for (const cell of cells) {
    if (cell.offsetTop !== currentTop) {
      currentTop = cell.offsetTop;
      rowIndex += 1;
    }
    cell.classList.toggle("type-member-row-band", rowIndex % 2 === 1);
  }
}

/**
 * VISUAL HIERARCHY REFINEMENT (AG, 2026-08-01): member-row percentages
 * align in the SAME vertical column as their parent group row's -- "the
 * child record %s would be same size but directly underneath" (Python
 * reference's scannable % column). The parent's % sits left of its action
 * buttons while a member's sits left of only a Source button, so their
 * natural right edges differ by the width of that control gap; this
 * measures the difference per group after layout and pushes each member's
 * figure left via margin-right (margin-left:auto absorbs the shift).
 * Only positive deltas are applied: a Fix this member row carries MORE
 * controls than its parent, and forcing alignment there would wedge a
 * large dead gap between its % and its buttons -- those rows keep their
 * natural position (disclosed in the findings doc). Re-runs on every
 * render; the from-scratch rebuild means no stale inline margins survive.
 */
function alignConfidenceColumns(container: HTMLElement): void {
  if (typeof container.querySelectorAll !== "function") return;
  for (const groupCell of Array.from(container.querySelectorAll<HTMLElement>(".group-cell"))) {
    // UNIFORM CONFIDENCE SLOT (AG, 2026-08-02, "Make the Use buttons
    // vertically aligned"): within one group's member list, every
    // .confidence-plain takes the WIDTH OF THE WIDEST one -- a "needs
    // attention" note under any member's % widens that slot, and without
    // equalization the Use buttons (which sit immediately left of the
    // slot) stagger row to row. Per-group by design: "if no needs
    // attention warning, they can naturally be closer to the
    // percentages" -- a group with only plain %s equalizes to the plain
    // width. The slot's interior stays right-aligned (align-items:
    // flex-end), so the %s keep their shared right edge. Runs BEFORE the
    // right-edge pass below, which re-measures the widened rects. A
    // decided member's ✓ (fixed-size circle -- min-width would deform
    // it) instead takes the width shortfall as extra right margin, so
    // ITS left edge (and its Use button) joins the same column; its
    // right edge deliberately yields.
    const memberConfs = Array.from(groupCell.querySelectorAll<HTMLElement>(".member-row > .confidence-plain"));
    const memberChecks = Array.from(groupCell.querySelectorAll<HTMLElement>(".member-row > .reviewed-check"));
    let maxWidth = 0;
    for (const conf of memberConfs) {
      if (typeof conf.getBoundingClientRect !== "function") continue;
      maxWidth = Math.max(maxWidth, conf.getBoundingClientRect().width);
    }
    if (maxWidth > 0) {
      for (const conf of memberConfs) conf.style.minWidth = `${Math.ceil(maxWidth)}px`;
    }

    const parentConf = groupCell.querySelector<HTMLElement>(":scope > .item-row > .confidence-plain, :scope > .item-row > .reviewed-check");
    if (!parentConf || typeof parentConf.getBoundingClientRect !== "function") continue;
    const parentRight = parentConf.getBoundingClientRect().right;
    for (const memberConf of memberConfs) {
      const delta = memberConf.getBoundingClientRect().right - parentRight;
      if (delta > 1) memberConf.style.marginRight = `calc(0.35rem + ${Math.round(delta)}px)`;
    }
    for (const check of memberChecks) {
      if (typeof check.getBoundingClientRect !== "function") continue;
      const rect = check.getBoundingClientRect();
      const shortfall = maxWidth > 0 ? Math.max(0, maxWidth - rect.width) : 0;
      const delta = rect.right - parentRight;
      const extra = Math.round((delta > 1 ? delta : 0) + shortfall);
      if (extra > 0) check.style.marginRight = `calc(0.35rem + ${extra}px)`;
    }
  }
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
  if (typeof container.querySelector !== "function") return;
  const escape = (value: string): string =>
    typeof CSS !== "undefined" && typeof CSS.escape === "function" ? CSS.escape(value) : value.replace(/["\\]/g, "\\$&");
  // ROWS-THEN-CARDS SEAM, half 3 (AG, 2026-08-02, live: "Confirm on a
  // numeric-pattern card's Redact All editor scrolled the view up to
  // Residency"). While the structural-card cursor is set, THE CARD is the
  // reviewer's working object -- the row cursor is merely parked wherever
  // the row half was left (see dispatchReviewWithVisibleAdvance's seam
  // note), often far above and already decided. Scrolling to it is the
  // viewport equivalent of the mis-targeted decision letters this cursor
  // already fixed: the eye gets yanked away from the thing being worked.
  // So the scroll follows the same cursor everything else follows.
  //
  // Cards carry class `item-row relationship-card`, so RX-04's
  // `.item-row { scroll-margin-top: calc(var(--workspace-chrome-height) + ...) }`
  // already clears the sticky chrome for them -- no new CSS, same RX-01
  // `block: "nearest"` least-motion contract (a card already fully visible
  // does not move, which is what makes Confirm feel like it stayed put).
  // A stale cursor pointing at a card that no longer renders falls through
  // to the row below rather than scrolling nowhere; render()'s tail clears
  // it in the same frame.
  const cardId = structuralCardFocusPending as string | null;
  if (cardId) {
    const card = container.querySelector<HTMLElement>(`[data-proposal-id="${escape(cardId)}"]`);
    if (card && typeof card.scrollIntoView === "function") {
      card.scrollIntoView({ block: "nearest" });
      return;
    }
  }
  // TYPE CHECK'S MEMBER CURSOR (AG, 2026-08-03, live: "on the Type Check I
  // try to nav and the focused items are so far out of the window I can't
  // tell what I'm doing").
  //
  // Same seam as the structural card cursor above, on a third surface.
  // `state.focus.target.itemId` in Type Check is the TYPE, not the member --
  // the domain has no cursor for a member row, so arrowing down through a
  // 143-entity type moved `typeCheckCursor` (UI state) while this function
  // kept aiming at the type card far above. The highlight and the viewport
  // were following different cursors, which is precisely the "where am I"
  // failure the card seam already fixed once.
  //
  // Member rows carry `data-type-member-id` (their own lookup contract,
  // parallel to RX-01's `data-item-id`). `.type-member-row` had to be ADDED
  // to RX-04's `scroll-margin-top` rule -- it was never a scroll target
  // before, so nothing had cleared the sticky chrome for it and the row
  // would have arrived underneath the header. RX-01's least-motion
  // `block: "nearest"` contract is otherwise unchanged: a row already fully
  // visible does not move.
  const memberId = typeCheckCursor?.candidateId;
  if (memberId) {
    const memberRow = container.querySelector<HTMLElement>(`[data-type-member-id="${escape(memberId)}"]`);
    if (memberRow && typeof memberRow.scrollIntoView === "function") {
      memberRow.scrollIntoView({ block: "nearest" });
      return;
    }
  }
  const itemId = state.focus?.target.itemId;
  if (!itemId) return;
  const row = container.querySelector<HTMLElement>(`[data-item-id="${escape(itemId)}"]`);
  if (row && typeof row.scrollIntoView === "function") row.scrollIntoView({ block: "nearest" });
}

/**
 * RX-04 (2026-07-29): publishes the sticky chrome's ACTUAL rendered height
 * as `--workspace-chrome-height` on :root, consumed by the rows'
 * `scroll-margin-top` (index.html) so RX-01's
 * scrollIntoView({block:"nearest"}) aims below the real obstruction.
 *
 * Measured, never assumed: the chrome's height is not a constant -- it
 * wraps at narrow viewport widths (top rows are all flex-wrap), and it
 * grows/shrinks with processing warnings, the import summary and failure
 * banners, the statistics bar's "By type" <details> toggle, and per-stage
 * command-bar legends. A hard-coded desktop value would under-report the
 * obstruction exactly when it matters (narrow window, warnings present)
 * and silently regress RX-01. Called from render()'s tail -- synchronously
 * BEFORE scrollFocusedRowIntoView, which depends on the value -- and again
 * from a ResizeObserver on the chrome element itself, which catches height
 * changes that happen WITHOUT a render (viewport resize re-wrapping the
 * chrome, the <details> toggle, font settling). `null` (landing view: no
 * chrome exists) resets to 0px.
 *
 * Fake-DOM guards, per the established app.ts precedent: the verify
 * harness's document has no documentElement, its elements no offsetHeight,
 * and Node has no ResizeObserver.
 */
function syncWorkspaceChromeHeight(chrome: HTMLElement | null): void {
  const rootStyle = document.documentElement?.style;
  if (!rootStyle || typeof rootStyle.setProperty !== "function") return;
  // APPLICATION FRAME REFINEMENT (AG, 2026-08-01): the sticky app header
  // is now part of the total obstruction. Two published values: the
  // header's own height (the chrome offsets its sticky `top` by it) and
  // the SUM (what scroll-margin-top and the workbench max-height calcs
  // actually need to clear). Same measured-never-assumed contract as
  // before -- the header wraps at narrow widths too.
  const header = typeof document.querySelector === "function" ? document.querySelector<HTMLElement>(".app-header") : null;
  const headerHeight = header && typeof header.offsetHeight === "number" ? header.offsetHeight : 0;
  rootStyle.setProperty("--app-header-height", `${headerHeight}px`);
  const height = chrome && typeof chrome.offsetHeight === "number" ? chrome.offsetHeight : 0;
  rootStyle.setProperty("--workspace-chrome-height", `${height + headerHeight}px`);
}

let workspaceChromeResizeObserver: ResizeObserver | null = null;

function observeWorkspaceChromeHeight(chrome: HTMLElement | null): void {
  if (typeof ResizeObserver !== "function") return;
  workspaceChromeResizeObserver?.disconnect();
  workspaceChromeResizeObserver = null;
  if (!chrome) return;
  workspaceChromeResizeObserver = new ResizeObserver(() => syncWorkspaceChromeHeight(chrome));
  workspaceChromeResizeObserver.observe(chrome);
}

/**
 * APPLICATION FRAME REFINEMENT (AG, 2026-08-01): the session-file
 * utilities demoted OUT of the toolbar -- "Save Session / Resume Session /
 * Original DOCX controls expose implementation details rather than
 * reviewer tasks." Nothing is deleted: a portable session copy, resuming
 * from explicit files (the cross-machine path IndexedDB autosave cannot
 * cover), and Feature 002's decision import all live here, behind one
 * quiet disclosure on the documents view. Autosave (Milestone 3) already
 * keeps this browser current without any of these -- which is exactly why
 * they no longer deserve toolbar prominence.
 */
function renderSessionTools(container: HTMLElement, state: ReturnType<WorkspaceCommandDispatcher["getState"]>): void {
  const tools = detailsEl("session-tools", { class: "session-tools" });
  tools.appendChild(el("summary", {}, "Session tools"));

  const saveRow = el("div", { class: "session-tools-row" });
  saveRow.appendChild(button("Save session copy", handleSaveSession, !state.documentLoaded));
  saveRow.appendChild(el("span", { class: "hint" }, "Autosave keeps this browser current; this downloads a portable JSON copy."));
  tools.appendChild(saveRow);

  const resumeRow = el("div", { class: "session-tools-row" });
  resumeRow.appendChild(el("span", {}, "Resume from files: session JSON "));
  const sessionInput = el("input", { type: "file", accept: ".json" }) as HTMLInputElement;
  resumeRow.appendChild(sessionInput);
  resumeRow.appendChild(el("span", {}, " + original docx "));
  const docxInput = el("input", { type: "file", accept: ".docx" }) as HTMLInputElement;
  resumeRow.appendChild(docxInput);
  resumeRow.appendChild(
    button("Resume from files", () => {
      const sessionFile = sessionInput.files?.[0];
      const docxFile = docxInput.files?.[0];
      if (sessionFile && docxFile) void handleResumeSession(sessionFile, docxFile);
      else refuse("Pick both the saved session JSON and the original .docx file."); // RX-09: refusal
    })
  );
  tools.appendChild(resumeRow);

  // Feature 002: import a previously exported decisions.json (from an
  // earlier review of an earlier version of this document, or any
  // document -- matching is deterministic and simply finds nothing to
  // reuse if the candidates don't correspond).
  const importRow = el("div", { class: "session-tools-row" });
  importRow.appendChild(el("span", {}, "Import prior decisions: "));
  const importInput = el("input", { type: "file", accept: ".json", title: "A decisions.json file previously downloaded via Download Decisions (JSON)" }) as HTMLInputElement;
  importInput.disabled = !state.documentLoaded;
  importInput.addEventListener("change", () => {
    const file = importInput.files?.[0];
    if (file) void handleImportDecisions(file);
    importInput.value = "";
  });
  importRow.appendChild(importInput);
  if (!state.documentLoaded) importRow.appendChild(el("span", { class: "hint" }, "(load a document first)"));
  tools.appendChild(importRow);

  container.appendChild(tools);
}

function render(): void {
  const state = dispatcher.getState();
  // 2026-07-30 follow-up: the open Source panel is derived state one level
  // below focus -- reconcile it before building any DOM (see
  // reconcileSourceView).
  reconcileSourceView(state);
  // REVIEW SCOPE, Pass 1: the Escape-widening is derived state one level
  // ABOVE focus -- reconcile it the same way, before any DOM builds.
  reconcileScopeWidening(state);
  rovingFocusPending = null; // never let a stale element from a prior render receive focus
  // INTERACTION LANGUAGE (2026-07-30): if DOM focus was inside the detail
  // panel when this render started AND the focused ITEM is unchanged (an
  // incidental rebuild -- background autosave, a <details> toggle), the
  // panel focus is restored at the tail, same discipline as the search
  // input/roving grid. When the item DID change (a decision advanced
  // focus), the reviewer intentionally moved on -- focus drops back to
  // Review mode rather than silently re-entering the NEXT item's panel.
  const activeWasInDetailPanel = isDetailPanelElement(document.activeElement as HTMLElement | null) && state.focus?.target.itemId === lastRenderedFocusedItemId;
  const container = root();
  container.innerHTML = "";

  // APPLICATION FRAME REFINEMENT (AG, 2026-08-01): the header frame's
  // dynamic slots (document identity, save status) are written on every
  // render, both branches -- the frame orients the reviewer before the
  // workspace does anything.
  syncAppHeader(state);

  // WORKSPACE ANALYSIS (2026-08-02): checked first, before any
  // documentLoaded-dependent branch below -- Workspace Analysis is
  // reachable independent of review-pipeline state, so this early return
  // never touches `state.documentLoaded`, the workspace chrome, or
  // anything else the rest of render() builds. This IS the one narrow
  // entry point: a "Back" button plus a single call to
  // renderWorkspaceAnalysisPage(), which owns everything drawn beneath it.
  if (showingWorkspaceAnalysis) {
    const wsaTopBar = el("div", { class: "top-bar" });
    wsaTopBar.appendChild(
      button("Back", () => {
        showingWorkspaceAnalysis = false;
        render();
      })
    );
    container.appendChild(wsaTopBar);
    const workspaceAnalysisContainer = el("div", { class: "workspace-analysis-container" });
    container.appendChild(workspaceAnalysisContainer);
    renderWorkspaceAnalysisPage(workspaceAnalysisContainer, workspaceAnalysisSession);
    // Same RX-04 discipline as the landing branch below: no sticky chrome
    // on this page, and any stale review-workspace chrome height is
    // cleared so it can't leave a phantom scroll margin behind.
    observeWorkspaceChromeHeight(null);
    syncWorkspaceChromeHeight(null);
    return;
  }

  // Toolbar: left-aligned primary actions (desktop convention), replacing
  // the old strip of raw file inputs. "New Document" fronts a hidden file
  // input; "Resume" + the existing-document select reopen vault documents;
  // "Documents" opens the documents view. Save Session / session-JSON
  // resume / decision import moved to Session tools on the documents view
  // (implementation details demoted, not deleted -- see
  // renderSessionTools).
  const topBar = el("div", { class: "top-bar" });
  // Hidden via the style ATTRIBUTE, not .style.display -- ui-smoke's fake
  // DOM elements have setAttribute but no CSSStyleDeclaration, and this
  // line runs on the landing render that suite exercises.
  const fileInput = el("input", { type: "file", accept: ".docx", style: "display: none" }) as HTMLInputElement;
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) void handleLoadFile(file);
  });
  topBar.appendChild(fileInput);
  const newDocButton = button("New Document", () => fileInput.click());
  newDocButton.classList.add("primary-action");
  topBar.appendChild(newDocButton);
  if (recentSessions.length > 0) {
    const docSelect = el("select", { class: "doc-select" }) as HTMLSelectElement;
    docSelect.appendChild(el("option", { value: "" }, "Choose an existing document…"));
    for (const summary of recentSessions) {
      const option = el("option", { value: summary.documentId }, summary.fileName);
      if (summary.documentId === state.documentId) option.setAttribute("disabled", "disabled");
      docSelect.appendChild(option);
    }
    const resumeButton = button("Resume", () => {
      // Explicit selection wins; otherwise the most recent OTHER document
      // (resuming the one already open would just re-parse it).
      const target = docSelect.value || recentSessions.find((s) => s.documentId !== state.documentId)?.documentId || "";
      if (!target) {
        refuse("No other document to resume."); // RX-09: refusal, status region only
        return;
      }
      void handleResumeFromRecent(target);
    });
    resumeButton.classList.add("primary-action");
    topBar.appendChild(resumeButton);
    topBar.appendChild(docSelect);
  }
  if (state.documentLoaded && !showingLanding) {
    topBar.appendChild(
      button("Documents", () => {
        showingLanding = true;
        render();
      })
    );
  }
  if (state.documentLoaded && showingLanding) {
    topBar.appendChild(
      button("Back to review", () => {
        showingLanding = false;
        render();
      })
    );
  }
  // WORKSPACE ANALYSIS (2026-08-02): the entry point lives on the
  // default/landing page only, matching the spec's "precedes all review
  // stages" placement -- it's what a reviewer can reach before (or
  // between) loading anything for individual review.
  if (!state.documentLoaded || showingLanding) {
    topBar.appendChild(
      button("Workspace Analysis", () => {
        showingWorkspaceAnalysis = true;
        render();
      })
    );
  }
  container.appendChild(topBar);
  // REOPEN PROMPT (AG, 2026-08-03): rendered immediately BELOW the toolbar
  // buttons and ABOVE everything else, full width, pushing the rest of the
  // workspace down -- AG's own placement ("inline is good, it can push the
  // entire workspace down and fill the horiz space above all elements
  // except the buttons, which will be immediately above it"). Drawn on
  // BOTH branches below (landing and loaded), since a reviewer can pick a
  // known file from either.
  renderReopenPrompt(container);

  if (!state.documentLoaded || showingLanding) {
    // RX-09: load/resume failures fire from THIS branch -- the banner must
    // render here, not only inside the workspace chrome (which doesn't
    // exist yet at that moment).
    renderFailureBanner(container);
    container.appendChild(el("p", {}, state.documentLoaded ? "Pick a document or resume a recent one." : "No document loaded yet."));
    renderRecentDocuments(container);
    renderSessionTools(container, state);
    // RX-04 AC #3: no sticky chrome on the landing view -- none was built,
    // and the height property is reset so a stale workspace value can
    // never leave phantom scroll margins behind (the sticky header's own
    // height is still published -- see syncWorkspaceChromeHeight).
    observeWorkspaceChromeHeight(null);
    syncWorkspaceChromeHeight(null);
    return;
  }

  // RX-04 (2026-07-29): everything between the top bar and the stage body
  // renders into ONE real container -- `.workspace-chrome`, the sticky
  // unit -- appended once, with the chrome renderers writing into it. A
  // real DOM node rather than a class on flat siblings, deliberately: this
  // is the chrome/body seam later render-scoping (RX-27) cuts along.
  // The toolbar stays outside and scrolls away (2026-08-01 frame
  // refinement: its actions are rare; the STICKY frame is the app header
  // plus this chrome -- syncWorkspaceChromeHeight publishes their
  // combined obstruction).
  const chrome = el("div", { class: "workspace-chrome" });
  // RX-09: first child of the sticky chrome -- an unaddressed
  // action-required failure cannot be scrolled out of sight. (Its
  // appearance changes the chrome's height; syncWorkspaceChromeHeight
  // measures after it renders, so the scroll margin follows.)
  renderFailureBanner(chrome);
  // APPLICATION FRAME REFINEMENT (AG, 2026-08-01): the old "File: ..."
  // line and the persistence-status row are gone from the chrome -- the
  // document name and save state live in the permanent header frame now
  // (syncAppHeader). In their place, Review Status: Extraction / Review /
  // Overall as prominent application status ("visual importance
  // comparable to the stage navigation"), immediately beneath the
  // document name and above the stage tabs.
  // COMMAND CARD PLACEMENT (AG, 2026-08-02): the status row pairs the
  // left-stacked Review Status scores + statistics line with the command
  // card on the right -- filling the previously empty right half of this
  // band, above the stage tabs. Both halves are inside the sticky chrome,
  // so nothing lost its always-visible behavior.
  const activeStage = state.focus?.target.stage ?? "ambiguity-check";
  const statusRow = el("div", { class: "chrome-status-row" });
  const statusLeft = el("div", { class: "chrome-status-left" });
  renderReviewStatus(statusLeft, state);
  renderReviewStatistics(statusLeft, state);
  statusRow.appendChild(statusLeft);
  renderCommandBar(statusRow, state, activeStage);
  chrome.appendChild(statusRow);
  renderImportSummaryBanner(chrome);
  if (state.processingWarnings.length > 0) {
    const warnings = el("div", { class: "warnings" });
    warnings.appendChild(el("strong", {}, "Processing warnings:"));
    for (const warning of state.processingWarnings) warnings.appendChild(el("p", {}, warning));
    chrome.appendChild(warnings);
  }

  renderStageTabs(chrome, activeStage, state.stageStatuses);
  // STAGE ENCAPSULATION (AG, 2026-08-01, revised 2026-08-02): the band no
  // longer hosts the command card, but it remains the workspace surface's
  // sticky TOP EDGE -- the thing the active tab visually terminates into.
  chrome.appendChild(el("div", { class: "workspace-top workspace-top-slim" }));
  container.appendChild(chrome);

  const body = el("div", { class: "stage-body" });
  if (activeStage === "ambiguity-check" || activeStage === "item-check") {
    renderCandidateStage(body, state, activeStage);
  } else if (activeStage === "group-check") {
    renderGroupStage(body, state);
  } else if (activeStage === "type-check") {
    renderTypeCheckStage(body, state);
  } else if (activeStage === "qa") {
    body.appendChild(el("p", {}, "No interactive QA model in this build -- see phase-9-findings.md ('qa'/'output' have no per-item traversal)."));
  } else {
    renderOutputStage(body, state);
  }
  container.appendChild(body);

  // RX-04: measure the freshly built chrome and publish its height BEFORE
  // the row scroll below reads scroll-margin-top -- the whole tree is in
  // the document at this point, so offsetHeight is the real, post-layout
  // obstruction (wrapped lines, banners, warnings and all). The observer
  // then keeps it current between renders.
  syncWorkspaceChromeHeight(chrome);
  observeWorkspaceChromeHeight(chrome);

  // VISUAL HIERARCHY REFINEMENT (AG, 2026-08-01): both measurement passes
  // run on the attached tree BEFORE the row scroll below -- spanning a
  // wrapped category cell changes the grid's geometry, and the scroll
  // must target where the focused row finally sits.
  sizeCategoryCells(container);
  alignConfidenceColumns(container);
  // Type Check's member cells may MOVE between regions here, so this runs
  // with the other geometry passes and before the focus scroll below.
  layoutMemberRegions(container);

  // RX-01: keep the focused row visible after every rebuild. Deliberately
  // BEFORE the searchInputFocusPending/inlineEditor focus restorations
  // below, not after -- input.focus() performs its own scroll, and whoever
  // focuses last must win: a reviewer mid-keystroke in the search box (or
  // mid-edit in an inline editor) must never have their text-entry control
  // pushed back out of view by the row scroll.
  scrollFocusedRowIntoView(container, state);

  // 2026-07-30 follow-up: apply the roving grid's deferred focus restore
  // now that the whole tree is attached (focusing a detached element is a
  // silent no-op -- the root cause of "arrows leave the item instead of
  // entering it"; see rovingFocusPending). Before the text-entry
  // restorations below, which must always win the final focus.
  // (Widened read: TS's control-flow analysis still sees the `= null` from
  // this function's first lines and doesn't track the assignment made
  // inside renderGroupStage between the two.)
  const pendingCell = rovingFocusPending as HTMLElement | null;
  if (pendingCell) {
    rovingFocusPending = null;
    if (typeof pendingCell.focus === "function") pendingCell.focus();
  }

  // UNIFIED WORKBENCH (2026-07-30): re-focus the structural card the
  // keyboard cursor is on, by proposalId against the FRESH tree --
  // persistent while the reviewer works the cards, and only when focus
  // was actually LOST to the rebuild (activeElement fell to <body>);
  // see structuralCardFocusPending's declaration.
  const pendingCardId = structuralCardFocusPending as string | null;
  if (pendingCardId) {
    const cardEl = Array.from(container.querySelectorAll<HTMLElement>(".relationship-card")).find(
      (c) => c.getAttribute("data-proposal-id") === pendingCardId
    );
    if (!cardEl) {
      structuralCardFocusPending = null; // card gone (e.g. dismissed): cursor dies with it
    } else if ((document.activeElement === document.body || document.activeElement === null) && typeof cardEl.focus === "function") {
      cardEl.focus();
    }
  }

  // INTERACTION LANGUAGE (2026-07-30): hand DOM focus to the expanded
  // detail panel -- either because Enter just asked to go deeper
  // (detailPanelFocusPending) or because focus was already in the panel
  // before an incidental rebuild (activeWasInDetailPanel; see render()'s
  // top). First control in document order: the identity options when
  // present, else the occurrence-browser summary. Mutually exclusive with
  // the roving grid's restore (different stages) and deliberately BEFORE
  // the text-entry restorations below, which must always win final focus.
  if (detailPanelFocusPending || activeWasInDetailPanel) {
    detailPanelFocusPending = false;
    const firstPanelControl = container.querySelector<HTMLElement>(
      ".detail-panel summary, .detail-panel button:not([disabled]), .detail-panel input, .detail-panel select"
    );
    if (firstPanelControl && typeof firstPanelControl.focus === "function") firstPanelControl.focus();
  }
  lastRenderedFocusedItemId = state.focus?.target.itemId ?? null;

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

  // UI-STATE PERSISTENCE (AG, 2026-08-02): every render is a chance the
  // presentation state changed -- schedule a debounced document-tied
  // snapshot save, and keep the per-tab "last open document" pointer
  // current so a refresh reopens this document (see the UI-STATE block
  // near captureUiSnapshot for the full lifecycle).
  scheduleUiStateSave();
  // WORKSPACE METRICS (AG, 2026-08-02): keep the detached window in step
  // with every re-render (decisions, bulk actions, loads, resumes) --
  // constant-time no-op while it's closed.
  syncWorkspaceMetricsWindow(state);
  try {
    if (state.documentLoaded && state.documentId) sessionStorage.setItem(LAST_OPEN_DOC_KEY, state.documentId);
    else sessionStorage.removeItem(LAST_OPEN_DOC_KEY);
  } catch {
    /* pointer is a convenience; refresh just lands on Documents */
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
  // WAVE 2 CLOSEOUT (2026-07-29): visibleItemCheckIds(), not an inline
  // queryItemCheck() -- "]"/"[" previously ignored Category Check's
  // narrowing (see renderCommandBar's identical note). Scan semantics are
  // unchanged: these still wrap, deliberately (see visibleListAdvance.ts's
  // doc comment for the recorded wrap-vs-no-wrap divergence, queued for
  // RX-30).
  const visible = visibleItemCheckIds(state);
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
 * PHASE 2, WORKFLOW NAVIGATION (AG, 2026-08-02): Shift+←/→ move to the
 * previous/next stage of the ACTIVE workflow -- REPLACING the Shift+1-5
 * stage digits entirely (handleStageTabKey and its ⇧n tab keycaps are
 * REMOVED, not merely deprecated, per "replace stage-number navigation
 * with relative workflow navigation ... intentionally avoids creating
 * long-term coupling between shortcut numbers and workflow order").
 * Dispatches the domain's own navigation.moveStage, whose traversal is
 * the active-stage list (navigator.ts) -- so this handler, the tabs, and
 * reconcile() all read the same workflow derivation.
 *
 * Placement: called at the TOP of the keydown pipeline (before the detail
 * panel gate, the split/card handlers, and the keymap resolver), because
 * several local grammars intercept `Arrow*` wholesale and would shadow a
 * later binding -- stage movement must outrank every within-stage grammar
 * ("Shift + Left / Right → Move between workflow stages" sits at the TOP
 * of Andrew's key-scope hierarchy). Three refusals, each deliberate:
 *   - text-entry controls keep native Shift+Arrow text selection (the
 *     same caret-ownership rule keymap.ts's textInputActive expresses);
 *   - an open Fix this (Not Quite) panel owns the context -- reconcile()
 *     would immediately pull focus back to it, so switching stages
 *     mid-transaction would be a lie; narrated rather than silent;
 *   - no document loaded: nothing to navigate.
 */
function handleStageArrowKey(event: KeyboardEvent): boolean {
  if (!event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return false;
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return false;
  const activeEl = document.activeElement as HTMLElement | null;
  const tag = activeEl?.tagName.toLowerCase() ?? "";
  if (tag === "input" || tag === "textarea" || tag === "select") return false; // native Shift+Arrow selection
  const state = dispatcher.getState();
  if (!state.documentLoaded) return false;
  if (state.focus?.target.panel.kind === "not-quite") {
    setStatus("Finish or exit Fix this before changing stages."); // RX-18
    return true;
  }
  dispatcher.dispatchNavigation({ family: "navigation", type: "moveStage", direction: event.key === "ArrowRight" ? "next" : "previous" });
  const landed = dispatcher.getState();
  const stage = landed.focus?.target.stage;
  if (stage) {
    const activeStages = landed.stageStatuses.filter(isStageActive).map((s) => s.stage);
    const position = activeStages.indexOf(stage);
    setStatus(`Stage: ${STAGE_LABELS[stage]}${position !== -1 ? ` — ${position + 1} of ${activeStages.length}` : ""}.`); // RX-18
  }
  render();
  return true;
}

/**
 * PHASE 2 COLLISION RESOLUTION (AG, 2026-08-02): Category Check's
 * narrowing-column navigation (Review State row / Filter row / Show All +
 * category grid -- moveFilterNavigation and everything under it,
 * unchanged) is now ⌥(Alt)+Arrows, DELIBERATELY REASSIGNED from
 * Shift+Arrows rather than silently dropped, per Andrew's explicit
 * instruction. Why Alt: Shift now belongs to workflow-stage movement at
 * the top of the key hierarchy; the column's grammar uses all four
 * arrows as one spatial set (←/→ select within a row, ↑/↓ travel between
 * rows), and splitting that set across modifiers (Shift for two arrows,
 * something else for the other two) would be worse than moving it whole.
 * Alt carries no competing binding anywhere in this app, and outside
 * text-entry controls no browser default on the platforms this app
 * targets. Advertised in the By Category legend ("⌥↑↓←→ Filters");
 * narration on every change is moveFilterNavigation's own, unchanged.
 */
function handleFilterColumnKey(event: KeyboardEvent): boolean {
  if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return false;
  if (!event.key.startsWith("Arrow")) return false;
  const state = dispatcher.getState();
  if (!state.documentLoaded) return false;
  if (state.focus?.target.stage !== "item-check" || itemCheckViewMode !== "category") return false;
  moveFilterNavigation(event.key);
  return true;
}

/**
 * 2026-07-30 feature spec: the "S" key toggles the focused member's Source
 * panel ("a new key command 'S', which will replace 'Save' (that should
 * already be deprecated), will toggle expand/collapse of the Context
 * inline panel"). Verified against keymap.ts before binding: "s" resolves
 * to nothing anywhere in the domain keymap -- Save never had a keybinding
 * in this build, so the letter is free and this stays a pure UI-layer
 * fallback (same chain as "/", "]", "[", and the C/R editor-openers; the
 * keymap file is untouched). Python precedent: the analogous context
 * toggle was deliberately NOT ported into the domain (keymap.ts's own
 * "NOT PORTED" note calls it a pure presentation toggle that belongs to
 * the UI) -- this is that UI, with S as the letter per the change request.
 *
 * Semantics (Andrew's 2026-07-30 follow-up, verbatim):
 *   - S on a collapsed Source panel: expand it; and if navigation is
 *     still at the TOP LEVEL of the item (no member row selected yet),
 *     move the selection into the first member row -- so the panel that
 *     just opened belongs to the row that is now highlighted, and further
 *     arrows continue from there.
 *   - S on an expanded Source panel: collapse it.
 *   - Only ONE panel is ever open, and it follows the selected member
 *     (attachRovingGridNav / reconcileSourceView) -- moving to the next
 *     item closes this panel and opens that item's.
 */
function handleSourceToggleKey(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
  if (event.key.toLowerCase() !== "s") return false;
  const target = dispatcher.getState().focus?.target;
  if (!target || target.stage !== "group-check") return false;
  if (target.panel.kind === "not-quite") {
    if (!target.panel.activeMemberId) return false;
    if (isSourceOpen(target.panel.groupId, target.panel.activeMemberId)) sourceViewFor = null;
    else sourceViewFor = { groupId: target.panel.groupId, candidateId: target.panel.activeMemberId };
    render();
    return true;
  }
  if (!target.itemId) return false;
  const group = dispatcher.getState().grouping?.entityGroupProposals.find((g) => g.groupId === target.itemId);
  if (!group) return false;
  const active = document.activeElement as HTMLElement | null;
  const focusedMemberId = active?.closest?.("[data-member-id]")?.getAttribute("data-member-id") ?? null;
  const memberInGroup = focusedMemberId !== null && group.candidateIds.includes(focusedMemberId);
  const memberId = memberInGroup ? focusedMemberId : group.candidateIds[0];
  if (!memberId) return false;
  if (isSourceOpen(group.groupId, memberId)) {
    // S on an expanded panel: collapse.
    sourceViewFor = null;
    render();
    return true;
  }
  // S on a collapsed panel: expand -- and from the item's top level, move
  // the selection into that (first) member row so panel and highlight
  // agree; toggleSourcePanel() already places roving focus on the member.
  toggleSourcePanel(group.groupId, memberId);
  return true;
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

/**
 * REGION MODEL (2026-07-30, keyboard UX refinement -- Andrew's "Region
 * Navigation as a first-class architectural concept"). The application has
 * exactly two interaction states:
 *
 *   REVIEW MODE -- DOM focus rests on <body> (or inside the roving grid /
 *   detail panel, which belong to the review surface); the virtual-focus
 *   keyboard model owns every key. This is where the reviewer lives.
 *
 *   CHROME MODE -- DOM focus is inside an interface region (`.top-bar`,
 *   `.workspace-chrome`, or a `.keyboard-region` stage-control surface);
 *   native browser traversal (Tab/Shift+Tab, arrows in selects, typing in
 *   inputs) owns every key EXCEPT Escape (back to Review mode), F6/","
 *   (cycle to the next region), and Shift+1-5 (stage switch -- the tabs
 *   live in the chrome, so switching from chrome is coherent).
 *
 * Entry is always INTENTIONAL: F6 (the desktop-convention "cycle interface
 * regions" key) or "," from Review mode. "," is the macOS-friendly
 * equivalent -- Apple keyboards demote function keys behind Fn, and every
 * browser-safe Command combination is already claimed by the browser
 * itself (Cmd+1-9 tabs, Cmd+L, Cmd+F...), so a plain unbound punctuation
 * key in the app's own fully-owned key space is the smallest coherent
 * choice ("settings live behind Cmd+, " is the closest muscle-memory
 * cousin). Recorded as revisable from real use, per the change request.
 *
 * Exit is symmetric and universal: Escape from anywhere in chrome returns
 * to Review mode; cycling past the LAST region also returns to Review mode
 * (F6 round-trips rather than trapping). Clicking a chrome button never
 * enters Chrome mode at all -- the click performs its action and focus
 * returns to the review surface (most chrome clicks re-render, which
 * rebuilds the DOM and drops focus to <body> for free; the delegated
 * click listener below covers the few non-rendering handlers like Save
 * Session / the download buttons). This was Andrew's explicit judgment
 * call, chosen over the review's alternative (allowing global shortcuts
 * while arbitrary buttons keep focus): two clean states beat one blurred
 * one, and it composes with `shouldIgnoreKeyboardEvent` instead of
 * carving button-by-button exceptions through it.
 */
function isRegionCycleKey(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  return event.key === "F6" || (event.key === "," && !event.shiftKey);
}

function isChromeRegionElement(el: HTMLElement | null): boolean {
  if (!el || typeof el.closest !== "function") return false;
  if (el.closest(".inline-editor")) return false; // the editor is review-surface text entry, wherever it renders
  return Boolean(el.closest(".top-bar, .workspace-chrome, .keyboard-region"));
}

function isDetailPanelElement(el: HTMLElement | null): boolean {
  if (!el || typeof el.closest !== "function") return false;
  if (el.closest(".inline-editor")) return false; // same carve-out as the roving grid's
  return Boolean(el.closest(".detail-panel"));
}

function chromeRegionRoots(): HTMLElement[] {
  if (typeof document.querySelectorAll !== "function") return [];
  return Array.from(document.querySelectorAll<HTMLElement>(".top-bar, .workspace-chrome, .keyboard-region"));
}

/** First keyboard-operable control of a region -- `summary` included
 *  (natively focusable, hosts the stats "By type" toggle), disabled
 *  buttons excluded. Returns whether focus actually landed, so the cycle
 *  can skip a region that happens to render nothing focusable. */
function focusFirstIn(region: HTMLElement): boolean {
  if (typeof region.querySelector !== "function") return false;
  const first = region.querySelector<HTMLElement>("button:not([disabled]), input, select, summary");
  if (!first || typeof first.focus !== "function") return false;
  first.focus();
  return document.activeElement === first;
}

function exitToReviewMode(): void {
  const active = document.activeElement as HTMLElement | null;
  if (active && typeof active.blur === "function") active.blur();
  setStatus("Review mode."); // RX-18: mode changes narrate
}

/** F6/",": from Review mode, enter the first region; from region N, move
 *  to region N+1; past the last, return to Review mode (a round-trip, not
 *  a trap). DOM order is visual order (top bar, then chrome, then the
 *  stage's own controls), so the cycle reads top-to-bottom. */
function cycleChromeRegion(from: HTMLElement | null): void {
  const regions = chromeRegionRoots();
  const currentIndex = from ? regions.findIndex((region) => region.contains(from)) : -1;
  for (let i = currentIndex + 1; i < regions.length; i++) {
    if (focusFirstIn(regions[i]!)) {
      setStatus("Interface region — Tab moves, F6/, next region, Esc returns to review."); // RX-18
      return;
    }
  }
  exitToReviewMode();
}

/**
 * DETAIL PANEL AS A DEPTH LEVEL (2026-07-30): Enter goes deeper, Escape
 * comes back out. Enter's domain command (enterItem) has been dispatched
 * since Phase 9 but was inert in this UI (no renderer read
 * `target.occurrenceId` -- the review's G7); it now ALSO moves real DOM
 * focus into the expanded panel, where native Tab traverses the
 * occurrence-browser/Expert-View `<details>` and the identity options.
 * Decision letters and the identity digits still fall through to the
 * global resolver while inside the panel -- the panel belongs to the
 * focused candidate, so K/C/R/I/1-9 keep meaning exactly what they mean
 * outside it; deciding re-renders, focus drops to <body>, and the
 * reviewer is back in Review mode on the next item without an explicit
 * exit. Escape dispatches closeItem (the symmetric domain hook) and
 * blurs.
 */
function exitDetailPanel(): void {
  const active = document.activeElement as HTMLElement | null;
  if (active && typeof active.blur === "function") active.blur();
  dispatcher.dispatchNavigation({ family: "navigation", type: "closeItem" });
  setStatus("Review mode.");
  render();
}

/** INSIDE-AN-ITEM GRAMMAR (AG, 2026-08-02): arrow movement through the
 *  expanded detail panel's own visible controls -- the panel-depth
 *  equivalent of Group Check's roving grid. No wrap at the bottom edge
 *  (this app's universal no-wrap rule); Up past the FIRST control backs
 *  out one level, mirroring how ArrowDown entered. Only visible controls
 *  participate (children of a closed <details> have no offsetParent). */
function movePanelFocus(activeEl: HTMLElement | null, delta: number): void {
  const panel = activeEl?.closest?.(".detail-panel") as HTMLElement | null;
  if (!panel || !activeEl) return;
  const controls = Array.from(
    panel.querySelectorAll<HTMLElement>("summary, button:not([disabled]), input:not([disabled]), select, a[href]")
  ).filter((c) => c.offsetParent !== null);
  const idx = controls.indexOf(activeEl);
  if (idx === -1) {
    controls[0]?.focus();
    return;
  }
  const next = idx + delta;
  if (next < 0) {
    exitDetailPanel(); // Up past the top: out one level, Review mode
    return;
  }
  if (next >= controls.length) return; // bottom edge: stay put
  controls[next]!.focus();
}

/** INSIDE-AN-ITEM GRAMMAR (AG, 2026-08-02): Tab from inside the panel
 *  leaves the ENTIRE item -- the same next/previous-item move Review
 *  mode's Tab performs, over the same visible display order (the
 *  nav-order interception's own lists), landing back in Review mode
 *  where the newly focused item auto-expands. */
function moveItemFromPanel(direction: "next" | "previous"): void {
  const active = document.activeElement as HTMLElement | null;
  if (active && typeof active.blur === "function") active.blur();
  const state = dispatcher.getState();
  const stage = state.focus?.target.stage;
  if (stage !== "item-check" && stage !== "group-check" && stage !== "ambiguity-check") return;
  const visibleIds = stage === "item-check" ? visibleItemCheckIds(state) : stage === "group-check" ? visibleGroupIds(state) : visibleAmbiguityIds(state);
  moveWithinVisibleList(visibleIds, state.focus?.target.itemId ?? null, direction);
}

/**
 * SELECTION VOCABULARY (2026-07-30): X toggles the focused candidate's
 * selection; Shift+X selects/clears all visible; Shift+K/C/R/I apply the
 * bulk decision to the selection. The grammar is the existing one, said
 * out loud: plain letter = the focused item, Shift = the wider set (the
 * modifier Shift+Arrows already gave to the parallel category structure).
 * "X" is the letter Feature 001's Reject binding explicitly freed
 * (keymap.ts's own note) -- verified still unbound everywhere. Item Check
 * only, matching the selection model's own scope (itemCheckQuery.ts's
 * SCOPE DECISION); in the By Category Results grid this is the ONLY
 * selection affordance (the tight cells deliberately carry no checkbox),
 * shown via `.result-cell-selected`. Shift+C/R open the existing bulk
 * inline editor -- the same C/R-need-text vs K/I-dispatch-directly split
 * the single-item letters have always had.
 */
/**
 * ACCEPT ALL AS A KEYBOARD DESTINATION (AG, 2026-08-02, "Accept All
 * should become a first-class keyboard destination"): Shift+A accepts
 * all remaining in the section the reviewer is currently working --
 * the focused row's section, or the focused structural card's kind
 * group. Grammar fit (keyboard interaction language, 2026-07-30):
 * plain key = the focused object, Shift = the wider set it belongs to
 * -- exactly the Shift+K/Shift+X precedent. The per-section buttons
 * remain ordinary tabbable stops, so pointer and chrome-traversal paths
 * still exist; Shift+A is the Review-mode accelerator. Sections with no
 * Accept All policy refuse with narration (RX-18), never die silently.
 */
function handleAcceptAllKey(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey || !event.shiftKey) return false;
  if (event.key.toLowerCase() !== "a") return false;
  if (inlineEditor) return false;
  const state = dispatcher.getState();
  const queueStage = sectionedQueueStage(state.focus?.target.stage);
  if (!queueStage) return false;
  // A structural card holds the cursor: accept its whole kind group.
  if (structuralCardFocusPending) {
    const proposals = (state.structuralRelationships?.proposals ?? []).filter((p) => !state.reviewSession?.relationshipDismissals?.[p.proposalId]);
    const current = proposals.find((p) => p.proposalId === structuralCardFocusPending);
    if (current) {
      acceptAllInRelationshipKind(proposals.filter((p) => p.kind === current.kind));
      return true;
    }
  }
  const itemId = state.focus?.target.itemId;
  if (!itemId) return false;
  if (queueStage === "item-check") {
    const sections = buildTriageSections(triageItemsFor(visibleItemCheckIds(state), state));
    const section = sections.find((s) => s.candidateIds.includes(itemId));
    if (!section) return false;
    const config = TRIAGE_QUEUE_POLICY.acceptFor(section.id);
    if (!config) {
      refuse(`${section.label} has no Accept All -- these items are reviewed individually.`);
      return true;
    }
    acceptAllInSection(config, section.label, section.candidateIds, queueStage);
    return true;
  }
  // TIERS (2026-08-02): in the Ambiguity queue, Shift+A runs the FIRST
  // declared action of the focused item's tier -- the tier's primary
  // recommendation, same as clicking its leading button.
  const sections = buildAmbiguitySections(ambiguityItemsFor(state.grouping?.ambiguityProposals.map((p) => p.candidateId) ?? [], state));
  const section = sections.find((s) => s.candidateIds.includes(itemId));
  if (!section) return false;
  const tier = section.tiers.find((t) => t.candidateIds.includes(itemId));
  const primary = tier ? AMBIGUITY_TIER_ACTIONS[section.id]?.[tier.id]?.[0] : undefined;
  if (!primary) {
    refuse(`${section.label} has no bulk actions -- these items are reviewed individually.`);
    return true;
  }
  runSectionAction(primary, section.label, tier!.candidateIds, queueStage);
  return true;
}

/**
 * GROUP-SCOPE CHORDS (AG, 2026-08-03): Opt/Alt + K/C/R/I/U applies that
 * decision to the whole group the reviewer is standing in.
 *
 * THE PROBLEM IT SOLVES, in AG's words: *"R and C ... may be true within an
 * item, but not across all items. There does need to be a 'specialness'
 * about the key command -- it needs to be acknowledged that this is a
 * higher scope level."* The app had already reached that conclusion from
 * the other direction: handleScopeModeKey REFUSES plain K/C/R/I whenever a
 * wider scope is active, because "any candidate-targeted key must first ask
 * what the working object is." The modifier answers that question in the
 * keystroke itself, which is why the bare letter can go on meaning exactly
 * what it has always meant.
 *
 * SCOPE RESOLUTION IS BORROWED, NEVER RE-DERIVED. `activeScopeSectionActions`
 * is the same function the heading renderer paints keycaps from and the
 * digit handler runs -- so a chord can only ever fire the button the
 * reviewer can actually see, on the scope the heading is describing. That
 * is the ONE-DIGIT-SPACE discipline extended to a second key population
 * rather than a parallel mechanism invented beside it.
 *
 * MATCHED ON `event.code`, NOT `event.key`: Option+R emits "®" on macOS
 * (and assorted dead keys elsewhere), so the character is useless for
 * identification. The identity-digit handler already matches Digit1-9 by
 * code for the same layout-independence reason; this is that precedent,
 * applied to letters.
 *
 * REFUSALS ARE NARRATED, never silent -- and they teach: a chord with no
 * matching action in this scope says which chords this group does offer.
 */
function handleGroupScopeChordKey(event: KeyboardEvent): boolean {
  if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return false;
  const match = /^Key([KCRNU])$/.exec(event.code ?? "");
  if (!match) return false;
  if (inlineEditor || splitReview) return false; // an open editor owns every key, as everywhere
  const chord = match[1] as GroupScopeChord;
  const state = dispatcher.getState();
  const actions = groupScopeActions(state);
  if (actions.length === 0) {
    // REFUSE, DON'T FALL SILENT (AG, 2026-08-03). Now that every section
    // advertises its chord permanently, a reviewer WILL press one while
    // parked somewhere that resolves no group -- on a structural card whose
    // kind group is finished, or between sections. Falling through made it a
    // dead key that taught nothing. Refusing names the requirement, matching
    // every other refusal in this app.
    //
    // Only on the stages that HAVE group scopes: elsewhere the key genuinely
    // is not ours and must keep falling through untouched.
    const stage = state.focus?.target.stage;
    if (stage === "type-check" || sectionedQueueStage(stage) !== null) {
      refuse(`${groupScopeChordLabel(chord)} applies to a group — move into one first.`);
      return true;
    }
    return false;
  }
  const hit = actions.find((action) => action.chord === chord);
  if (!hit) {
    const offered = actions
      .map((action) => (action.chord === null ? null : groupScopeChordLabel(action.chord)))
      .filter((label): label is string => label !== null);
    refuse(
      offered.length > 0
        ? `${groupScopeChordLabel(chord)} does not apply to this group — it offers ${offered.join(" and ")}.`
        : `${groupScopeChordLabel(chord)} does not apply to this group — its actions are numbered instead.`
    );
    return true;
  }
  hit.run();
  return true;
}

function handleSelectionKey(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  const state = dispatcher.getState();
  if (state.focus?.target.stage !== "item-check") return false;
  const key = event.key.toLowerCase();
  if (key === "x" && !event.shiftKey) {
    const itemId = state.focus.target.itemId;
    if (!itemId) return false;
    if (selectedCandidateIds.has(itemId)) selectedCandidateIds.delete(itemId);
    else selectedCandidateIds.add(itemId);
    setStatus(`${selectedCandidateIds.size} selected.`); // RX-18
    render();
    return true;
  }
  if (key === "x" && event.shiftKey) {
    const visible = visibleItemCheckIds(state);
    if (visible.length === 0) {
      refuse("Nothing visible to select.");
      return true;
    }
    const allSelected = visible.every((id) => selectedCandidateIds.has(id));
    for (const id of visible) {
      if (allSelected) selectedCandidateIds.delete(id);
      else selectedCandidateIds.add(id);
    }
    setStatus(allSelected ? `Visible selection cleared — ${selectedCandidateIds.size} selected.` : `${selectedCandidateIds.size} selected.`);
    render();
    return true;
  }
  if (event.shiftKey && (key === "k" || key === "c" || key === "r" || key === "i")) {
    if (selectedCandidateIds.size === 0) {
      // RX-18: a refusal, not a silent dead key -- and it teaches the
      // vocabulary at the exact moment it's needed.
      refuse("Nothing selected — X selects the focused item, Shift+X selects all visible.");
      return true;
    }
    const decision: CandidateDecisionKind = key === "k" ? "Keep" : key === "c" ? "Rename" : key === "r" ? "Redact" : "Ignore";
    dispatchBulkDecision(decision);
    return true;
  }
  return false;
}

/**
 * IDENTITY LINKING BY NUMBER (2026-07-30): digits 1-9 link the Nth
 * "Possible identity" for the focused candidate -- the missing half of
 * Ambiguity Check's keyboard model (K/C/R/I could DECLINE every identity
 * but nothing could ACCEPT one). Routes through the same decideAndAdvance
 * path the option buttons click into, so the pulse + visible-order
 * advance are identical -- linking "follows the same interaction
 * philosophy as Keep/Rename/Ignore/Redact," which is that feature's own
 * recorded intent. Matched on `event.code` (Digit1-9) for layout
 * independence -- unshifted digits are themselves shifted characters on
 * AZERTY and others (the rationale the removed Shift+digit stage switch
 * also used; the rationale outlives it). Works wherever
 * the identity list renders (Ambiguity Check AND Item Check -- the panel
 * is deliberately not stage-gated), and from inside the detail panel,
 * whose key fall-through includes digits.
 */
/** GROUP "USE" ACCELERATORS (AG, 2026-08-02): digit N while a Group Check
 *  group is focused commits member N's spelling as the group's canonical
 *  identity -- the keyboard half of the member rows' "① Use" buttons,
 *  through the identical useGroupSpelling path. Inert while a Fix this
 *  panel or an inline editor is open (typed digits there are text). */
function handleGroupUseKey(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
  const match = /^Digit([1-9])$/.exec(event.code ?? "");
  if (!match) return false;
  if (inlineEditor) return false;
  if (splitReview) return false; // in the split session, letters review members; digits are inert
  const state = dispatcher.getState();
  const target = state.focus?.target;
  if (!target || target.stage !== "group-check" || !target.itemId) return false;
  if (target.panel.kind === "not-quite") return false;
  const group = state.grouping?.entityGroupProposals.find((g) => g.groupId === target.itemId);
  if (!group) return false;
  const digit = Number(match[1]);
  // SPLIT REVIEW MODE (AG, 2026-08-02): 1 = Separate these; the Use
  // accelerators follow at 2+ ("Numbers: 1 = Separate these, 2+ = Use
  // this representation").
  if (digit === 1) {
    if (group.candidateIds.length > 1) startSplitReview(group);
    else refuse("This group has a single member — nothing to separate.");
    return true;
  }
  const candidateId = group.candidateIds[digit - 2];
  if (!candidateId) {
    refuse(`Only ${group.candidateIds.length} spelling${group.candidateIds.length === 1 ? "" : "s"} in this group (digits 2–${group.candidateIds.length + 1}).`);
    return true;
  }
  const candidate = state.detection?.candidates.find((c) => c.id === candidateId);
  if (!candidate) return false;
  useGroupSpelling(group, candidate.displayValue);
  return true;
}

/** SPLIT REVIEW MODE keys (AG, 2026-08-02): while a split session is
 *  active on the focused group, K/C/R/I act on the ACTIVE member (first
 *  without a buffered choice) -- "continue working exactly as they
 *  already do," just into the buffer -- and Escape cancels the whole
 *  session. Runs BEFORE resolveKeyboardCommand so the letters never
 *  reach the group-level commands while the group is suspended. Inert
 *  while an inline editor is open (its own keys own the field). */
function handleSplitReviewKey(event: KeyboardEvent): boolean {
  if (!splitReview) return false;
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
  if (inlineEditor) return false;
  const state = dispatcher.getState();
  const target = state.focus?.target;
  if (!target || target.stage !== "group-check" || target.itemId !== splitReview.groupId) return false;
  if (event.key === "Escape") {
    cancelSplitReview();
    return true;
  }
  const group = state.grouping?.entityGroupProposals.find((g) => g.groupId === splitReview!.groupId);
  if (!group) return false;
  // ARROWS MOVE THE MEMBER CURSOR (AG, live feedback: "the down arrow
  // nav is now broken. I expected to be able to select Staff Homepage") --
  // the inside-an-item grammar: arrows within the split session's
  // members, intercepted here so they never fall through to the stage's
  // between-item grid movement while the group is suspended.
  if (event.key === "ArrowDown" || event.key === "ArrowRight") {
    moveSplitCursor(group, 1);
    return true;
  }
  if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
    moveSplitCursor(group, -1);
    return true;
  }
  const key = event.key.toLowerCase();
  if (key !== "k" && key !== "c" && key !== "r" && key !== "i") return false;
  const activeId = splitActiveMemberId(group);
  if (!activeId) return false;
  if (key === "k") recordSplitChoice(group, activeId, "Keep");
  else if (key === "i") recordSplitChoice(group, activeId, "Ignore");
  else if (key === "c") openInlineEditor({ scope: "split-member", groupId: group.groupId, candidateId: activeId, action: "Rename" });
  else openInlineEditor({ scope: "split-member", groupId: group.groupId, candidateId: activeId, action: "Redact" });
  return true;
}

function handleIdentityLinkKey(event: KeyboardEvent): boolean {
  // REVIEWER RECOMMENDATION UX (2026-07-30): digits 1-9 now mean "accept
  // DocScrub recommendation N" for the focused candidate -- ONE keyboard
  // language across surfaces. For identity-backed items the suggestions
  // ARE the ambiguity options in their existing order, so the shipped
  // "link identity option N" behavior is preserved keystroke-for-
  // keystroke; other archetypes gain an accept key where they previously
  // had none. Items with no recommendation fall back to linking any raw
  // identity options directly (pre-recommendation behavior), and digits
  // past the suggestion count refuse with a count, exactly as before.
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
  const match = /^Digit([1-9])$/.exec(event.code ?? "");
  if (!match) return false;
  const state = dispatcher.getState();
  const target = state.focus?.target;
  if (!target || !target.itemId) return false;
  if (target.stage !== "ambiguity-check" && target.stage !== "item-check" && target.stage !== "type-check") return false;
  if (target.panel.kind === "not-quite") return false;
  const digit = Number(match[1]);

  // TYPE CHECK'S MEMBER CURSOR (AG, 2026-08-03, live: "pressing 1 ... did
  // nothing at all").
  //
  // A bug I introduced one pass earlier: Type Check's member rows gained
  // inline numbered chips, but this handler was gated to Item Check and
  // Ambiguity Check, so every one of those numbers was painted and none of
  // them could be pressed. Rendering a keycap without wiring its key is the
  // one failure the ONE-DIGIT-SPACE discipline is supposed to make
  // impossible, and I reached it from the other direction -- by adding a
  // renderer rather than a number.
  //
  // The second half is the same seam the scroll fix hit: in Type Check
  // `target.itemId` is the TYPE, because the domain has no cursor for a
  // member row. The digit must act on `typeCheckCursor`'s candidate, and
  // only while that cursor genuinely sits inside the focused type -- a
  // stale cursor from another type must not silently take the keystroke.
  const candidateId =
    target.stage === "type-check"
      ? typeCheckCursor?.typeId === target.itemId
        ? typeCheckCursor.candidateId
        : null
      : target.itemId;
  if (!candidateId) return false;

  // ONE DIGIT SPACE (AG, 2026-08-02): digits 1..S accept the header
  // suggestion chips; digits past S reach the Possible-identities
  // options that are NOT already header chips, using the SAME
  // identityDigitAssignments derivation the list renders with -- the
  // number the reviewer read is the number the keyboard acts on, always.
  const recommendation = recommendationForCandidate(candidateId, state);
  const suggestions = recommendation?.suggestions ?? [];
  if (digit <= suggestions.length && suggestions.length > 0) {
    runRecommendationSuggestion(candidateId, target.stage, suggestions[digit - 1]!.op);
    return true;
  }

  const proposal = state.grouping?.ambiguityProposals.find((p) => p.candidateId === candidateId);
  // Same ceiling the list PAINTS with (renderPossibleIdentities) -- one
  // derivation, so an option the reviewer can see numbered is exactly an
  // option this handler will act on.
  const assignments = proposal
    ? identityDigitAssignments(recommendation, proposal.candidateGroupOptions, itemDigitCeilingFor(candidateId, state))
    : [];
  if (suggestions.length === 0 && assignments.length === 0) return false;
  const hit = assignments.find((a) => a.digit === digit);
  if (!hit) {
    const total = suggestions.length + assignments.filter((a) => a.digit !== null && a.digit > suggestions.length).length;
    refuse(`Only ${total} numbered option${total === 1 ? "" : "s"} for this item.`);
    return true;
  }
  decideAndAdvance({ family: "review", type: "linkAmbiguousCandidate", candidateId, groupId: hit.option.groupId }, candidateId, target.stage);
  return true;
}

// REGION MODEL: "clicking a toolbar control performs its action and
// returns to Review mode." Most chrome clicks re-render, which rebuilds
// the DOM and drops focus to <body> on its own; this covers the handlers
// that deliberately DON'T render (Save Session, the download buttons) so
// no chrome button ever retains focus and silences the shortcut layer --
// the review's G3 dead zone, closed by mode discipline instead of
// per-button exceptions. Scoped to buttons only: selects and inputs NEED
// retained focus to operate, and they live inside regions where Escape
// already provides the exit.
if (typeof document.addEventListener === "function") {
  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    const btn = target && typeof target.closest === "function" ? target.closest("button") : null;
    if (!btn || !isChromeRegionElement(btn)) return;
    queueMicrotask(() => {
      if (document.activeElement === btn && typeof btn.blur === "function") btn.blur();
    });
  });
}

document.addEventListener("keydown", (event) => {
  const activeEl = document.activeElement as HTMLElement | null;
  const activeTag = activeEl?.tagName ?? "";

  // REOPEN PROMPT (AG, 2026-08-03) -- checked FIRST, before every other
  // gate including the chrome-region and text-entry gates. While the prompt
  // is up the reviewer has exactly one question to answer and the workspace
  // beneath it is not actionable, so the prompt owns the keyboard outright.
  // Handling it here also means its digits can never collide with the
  // ONE-DIGIT-SPACE assignments (identityDigitAssignments / section
  // actions): those handlers are simply never reached while it is open.
  if (reopenPrompt) {
    if (event.key === "Escape") {
      event.preventDefault();
      handleReopenCancel();
      return;
    }
    if (event.key === "1") {
      event.preventDefault();
      void handleReopenContinue();
      return;
    }
    if (event.key === "2") {
      event.preventDefault();
      void handleReopenReplace();
      return;
    }
    // Everything else is swallowed rather than passed through: a stray
    // shortcut acting on the workspace behind an unanswered prompt is
    // exactly the kind of "something happened and I don't know what"
    // moment this app is built to avoid.
    return;
  }

  // REGION MODEL, gate 1 -- CHROME MODE: native traversal owns everything
  // except the three deliberate cross-cutting keys (Escape out, F6/","
  // onward, ⇧←/→ stage movement). Checked BEFORE the tag gate: chrome
  // hosts <summary> elements (the stats "By type" toggle), which
  // shouldIgnoreKeyboardEvent's faithful port doesn't list, and Tab from
  // one must stay native here, not become moveItem.
  if (isChromeRegionElement(activeEl)) {
    if (event.key === "Escape") {
      event.preventDefault();
      exitToReviewMode();
      return;
    }
    // "," must remain a TYPEABLE character wherever text entry lives (the
    // search box is inside a chrome region) -- only F6 cycles from a
    // text-entry control; "," cycles from buttons/summaries, where it
    // types nothing. Caught in self-review, not by a reviewer.
    const isTextEntry = activeTag.toLowerCase() === "input" || activeTag.toLowerCase() === "textarea" || activeTag.toLowerCase() === "select";
    if (isRegionCycleKey(event) && !(isTextEntry && event.key === ",")) {
      event.preventDefault();
      cycleChromeRegion(activeEl);
      return;
    }
    // PHASE 2: ⇧←/→ replaces the removed Shift+digit stage switch as the
    // one stage-movement key that works from chrome too (its own
    // text-entry guard keeps Shift+Arrow selection in the search box).
    if (handleStageArrowKey(event)) {
      event.preventDefault(); // stage switch re-renders; focus drops to <body> = Review mode
      return;
    }
    return;
  }

  // PHASE 2, WORKFLOW NAVIGATION: ⇧←/→ = previous/next ACTIVE stage,
  // application-wide -- checked before every within-stage grammar (detail
  // panel arrows, split cursor, category-column navigation, the keymap
  // resolver) because stage movement sits at the TOP of the key-scope
  // hierarchy and must never be shadowed by a local arrow grammar. See
  // handleStageArrowKey's doc comment for its own deliberate refusals.
  if (handleStageArrowKey(event)) {
    event.preventDefault();
    return;
  }

  // REGION MODEL, gate 2 -- DETAIL PANEL (a DEPTH level of the review
  // surface, not chrome). REVISED (AG, 2026-08-02): "tab should leave the
  // entire item. arrows should navigate within" -- the panel now follows
  // the SAME inside-an-item grammar the Group Check roving grid
  // established (2026-07-29, point 5: Tab/Shift+Tab always mean
  // next/previous ITEM, never next control; arrows move within). The old
  // native-Tab-through-the-panel behavior was this gate's original
  // choice, and it inverted that documented grammar. Arrows rove the
  // panel's visible controls (movePanelFocus; Up past the first backs
  // out one level, mirroring Down-enters); text-entry controls keep
  // native caret arrows; Enter/Space stay native (activate buttons,
  // toggle <details>); Escape backs out one level; decision letters and
  // identity digits still FALL THROUGH to the resolver below -- they
  // act on the focused candidate exactly as before.
  const inDetailPanel = isDetailPanelElement(activeEl);
  if (inDetailPanel) {
    if (event.key === "Escape") {
      event.preventDefault();
      exitDetailPanel();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      moveItemFromPanel(event.shiftKey ? "previous" : "next");
      return;
    }
    if (event.key.startsWith("Arrow")) {
      const tagLower = activeTag.toLowerCase();
      if (tagLower === "input" || tagLower === "textarea" || tagLower === "select") return; // native caret/option movement
      event.preventDefault();
      movePanelFocus(activeEl, event.key === "ArrowDown" || event.key === "ArrowRight" ? 1 : -1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") return;
  } else if (shouldIgnoreKeyboardEvent(activeTag) && !isRovingFocusElement(activeEl)) {
    // ESCAPE LADDER, universal rung: a control that is neither chrome nor
    // panel nor roving grid (a row checkbox reached by native Tab, a
    // redaction-rules input in Output...) still honors "Escape backs out
    // one level" -- back to Review mode. Without this, native Tab into a
    // row control was a dead end with no keyboard exit at all. The inline
    // editor is unaffected: its own listeners stopPropagation their
    // Escape before this can see it.
    if (event.key === "Escape") {
      event.preventDefault();
      exitToReviewMode();
    }
    return;
  }

  // Review mode: F6/"," intentionally enters the first interface region.
  if (isRegionCycleKey(event)) {
    event.preventDefault();
    cycleChromeRegion(null);
    return;
  }

  // ESCAPE LADDER, workspace level: with every more-local context already
  // handled above (editor: its own stopPropagation'd listener; chrome/
  // panel: gates 1-2; search: its input listener; Not Quite: keymap's
  // exitNotQuite below), a remaining Escape dismisses the one
  // acknowledgement-requiring notification. Ordered BEFORE keymap
  // resolution because Escape otherwise resolves to closeItem -- a
  // verified no-op in candidate stages (occurrenceId is cleared by
  // exitDetailPanel), which would silently eat the key.
  if (event.key === "Escape" && failureBanner && !inlineEditor && dispatcher.getState().focus?.target.panel.kind !== "not-quite") {
    event.preventDefault();
    failureBanner = null;
    setStatus("Failure notice dismissed."); // RX-18
    render();
    return;
  }

  // CONTEXTUAL MEMBER DECISIONS (AG, 2026-07-30): checked BEFORE the
  // domain keymap -- k/i would otherwise resolve to the whole-group
  // confirmGroup/ignoreGroup even while an individual member row is the
  // active one. Top-level focus falls through to the keymap unchanged, so
  // KCRIF at the item's top level still applies to the whole item.
  if (handleGroupMemberDecisionKey(event)) {
    event.preventDefault();
    return;
  }

  // REVIEW SCOPE, Pass 1 (AG, 2026-08-03): the scope ladder (Escape
  // widens / Enter re-narrows) and the wider-scope mis-target guard --
  // BEFORE handleTriageKey, or Enter from the widened state would fall
  // through and accept a recommendation on the PARKED row the reviewer
  // has explicitly stepped away from.
  if (handleScopeModeKey(event)) {
    event.preventDefault();
    return;
  }

  // TRIAGE QUEUE (2026-07-30): Enter = accept / Space = details, only in
  // the triage view -- intercepted before resolveKeyboardCommand so Enter
  // doesn't fall through to enterItem while a recommendation is
  // acceptable (see handleTriageKey's doc comment).
  if (handleTriageKey(event)) {
    event.preventDefault();
    return;
  }

  // SPLIT REVIEW MODE (AG, 2026-08-02): most specific context first --
  // while the focused group's split session is active, K/C/R/I review the
  // active MEMBER (into the buffer) and Escape cancels the session. Must
  // run before resolveKeyboardCommand, which would otherwise route the
  // letters to the suspended group's own commands.
  if (handleSplitReviewKey(event)) {
    event.preventDefault();
    return;
  }

  // TYPE CHECK (PHASE 2, 2026-08-02): inside-the-focused-card grammar --
  // member cursor movement, cursor-member decisions, card-level bulk
  // letters. Before resolveKeyboardCommand for the same reason as the
  // split/member handlers: the keymap would otherwise route arrows to
  // between-card movement while the cursor is inside a card.
  if (handleTypeCheckKey(event)) {
    event.preventDefault();
    return;
  }

  // CARD-TARGETED LETTERS (AG, 2026-08-02, from a live mis-target: while
  // working a proposal card, pressing C opened Change on the state-focused
  // ROW hidden elsewhere -- an already-decided, completely different
  // item). "Plain key = focused object": while a structural card is the
  // selected working object (its cursor is set), K/C/R/I act on THE CARD,
  // through the exact functions its own buttons call -- never on the
  // item-model row underneath. Runs BEFORE resolveKeyboardCommand, which
  // would otherwise route K to keepCandidate(focused row).
  if (!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && handleCardDecisionKey(event.key)) {
    event.preventDefault();
    return;
  }

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
      // 2026-07-30 feature spec: while By Category is active, arrow keys
      // move through the Results GRID like a spreadsheet. Tab and
      // Home/End deliberately fall through to the sequential path below --
      // sequential order over a row-major grid IS "perusing a horizontal
      // row completely before moving to the next row."
      // PHASE 2 COLLISION RESOLUTION (AG, 2026-08-02, explicitly required
      // to be deliberate, not silent): the narrowing column's Shift+Arrow
      // navigation moved to ALT+Arrows (handleFilterColumnKey, in the
      // fallback chain) -- Shift+←/→ is now workflow-stage movement
      // everywhere, and keeping Shift+↑/↓ alone here would have split one
      // spatial grammar across two modifiers. Alt keeps all four arrows
      // together; ⌥ has no competing binding in this app or (outside text
      // entry) the browser. The old shiftKey branch here is gone because
      // the keymap no longer resolves shifted arrows to moveItem at all.
      if (stage === "item-check" && itemCheckViewMode === "category" && event.key.startsWith("Arrow")) {
        moveWithinResultsGrid(visibleItemCheckIds(state), state.focus?.target.itemId ?? null, event.key);
        return;
      }
      // SECTIONED QUEUE arrows (TRIAGE QUEUE 2026-07-30; extended to the
      // Ambiguity stage by AMBIGUITY CATEGORY-FIRST, AG 2026-08-02): the
      // same spreadsheet arrows over the queue rows -- Up/Down move by
      // measured column count, Left/Right sequentially, exactly the
      // Results-grid model -- on BOTH stages that present the sectioned
      // collection. The structural kind-groups sit at the END of the
      // collection on both, so moving FORWARD past the last row continues
      // into the first card -- one queue, in display order; the reverse
      // boundary lives in moveStructuralCardFocus.
      const queueStage = sectionedQueueStage(stage);
      if (queueStage && event.key.startsWith("Arrow")) {
        const visibleIds = queueStage === "item-check" ? visibleItemCheckIds(state) : visibleAmbiguityIds(state);
        const currentId = state.focus?.target.itemId ?? null;
        // DOWN ENTERS (AG, 2026-08-02): "the nav needs to allow down arrow
        // to enter the actual focus area. then Tab to go between items" --
        // Group Check's grammar generalized to the sectioned queue.
        // ArrowDown on the focused row hands real DOM focus INTO its
        // expanded detail panel (the same detailPanelFocusPending
        // mechanism Enter Details uses; Escape backs out, per the
        // universal out-one-level rule). Moving BETWEEN items is
        // Tab / Left / Right / Up; the old Down-moves-a-grid-row
        // spreadsheet motion is deliberately superseded on this surface,
        // per Andrew's direct instruction.
        if (event.key === "ArrowDown" && currentId !== null && visibleIds.includes(currentId)) {
          structuralCardFocusPending = null;
          detailPanelFocusPending = true;
          render();
          return;
        }
        if (event.key === "ArrowRight" && currentId !== null && visibleIds.indexOf(currentId) === visibleIds.length - 1) {
          const cards = document.querySelectorAll<HTMLElement>(".relationship-section .relationship-card");
          const first = cards[0];
          if (first) {
            // HIGHLIGHT IMPLIES DETAIL (AG, 2026-08-02 bug report): set the
            // cursor FIRST and render deterministically -- the old
            // focus()-then-set order relied on the card's focus listener
            // to trigger the expanding render, and whenever the cursor was
            // already set (or the listener's guard skipped), the reviewer
            // got a highlighted-but-compact card. render()'s tail re-focuses
            // the fresh card via the pendingCardId restore (activeElement
            // falls to body during the rebuild), so DOM focus still lands.
            structuralCardFocusPending = first.getAttribute("data-proposal-id");
            render();
            return;
          }
        }
        structuralCardFocusPending = null; // working the rows now: the card cursor stands down
        moveWithinResultsGrid(visibleIds, currentId, event.key, ".triage-grid .triage-row");
        return;
      }
      if (stage === "item-check" || stage === "group-check" || stage === "ambiguity-check") {
        // ambiguity-check joined 2026-08-02: its displayed order is now the
        // SECTION-grouped queue, which diverges from FocusNavigator's raw
        // proposal order -- the exact NAV-ORDER class of bug this
        // interception exists to prevent (Home/End and sequential moves).
        const visibleIds = stage === "item-check" ? visibleItemCheckIds(state) : stage === "group-check" ? visibleGroupIds(state) : visibleAmbiguityIds(state);
        moveWithinVisibleList(visibleIds, state.focus?.target.itemId ?? null, command.direction);
        return;
      }
    }
    // INTERACTION LANGUAGE (2026-07-30): Enter = go deeper. enterItem has
    // resolved here since Phase 9 but was inert in this UI; it now also
    // hands real DOM focus to the expanded detail panel (deferred through
    // detailPanelFocusPending, consumed at render()'s tail -- the panel
    // element doesn't exist until the re-render). The domain command still
    // dispatches first: occurrenceId tracking stays live for whatever
    // later builds on it.
    if (command.family === "navigation" && command.type === "enterItem") {
      const stage = dispatcher.getState().focus?.target.stage;
      if (stage === "item-check" || stage === "ambiguity-check") {
        dispatcher.dispatchNavigation(command);
        detailPanelFocusPending = true;
        render();
        return;
      }
    }
    dispatchAndRender(command);
    return;
  }
  // (Phase 2: the Shift+digit stage fallback that sat here is REMOVED with
  // handleStageTabKey itself -- ⇧←/→ stage movement runs at the TOP of
  // this listener, before every within-stage grammar.)
  // Before handleFilterColumnKey: both are ⌥-gated, but that one takes only
  // Arrows and this one only KeyK/C/R/I/U, so the order is documentation of
  // intent rather than a live tie-break. Before the section-action digits
  // for the reason that matters: chords and digits address the SAME action
  // list, and a chorded action is never numbered, so whichever runs first
  // finds the same single button.
  if (handleGroupScopeChordKey(event)) {
    event.preventDefault();
    return;
  }
  if (handleFilterColumnKey(event)) {
    event.preventDefault();
    return;
  }
  if (handleScaleNavigationKey(event)) {
    event.preventDefault();
    return;
  }
  if (handleSourceToggleKey(event)) {
    event.preventDefault();
    return;
  }
  if (handleAcceptAllKey(event)) {
    event.preventDefault();
    return;
  }
  if (handleSelectionKey(event)) {
    event.preventDefault();
    return;
  }
  // SECTION-ACTION DIGITS (AG, 2026-08-02): BEFORE handleIdentityLinkKey
  // on purpose -- that ordering is the collision rule ("the ITEM side
  // truncates first"): the section owns the reserved high digits, and
  // identityDigitAssignments has already declined to paint them on an
  // option, so what is shown and what fires stay the same number.
  if (handleSectionActionDigitKey(event)) {
    event.preventDefault();
    return;
  }
  if (handleIdentityLinkKey(event)) {
    event.preventDefault();
    return;
  }
  if (handleGroupUseKey(event)) {
    event.preventDefault();
    return;
  }
  if (handleInlineEditorOpenKey(event)) {
    event.preventDefault();
  }
});

// UNIFIED WORKBENCH (2026-07-30): any pointer interaction outside the
// structural cards stands the card keyboard-cursor down, so render()'s
// focus restore can never yank focus back from real work elsewhere (see
// structuralCardFocusPending's declaration).
document.addEventListener("pointerdown", (event) => {
  if (structuralCardFocusPending === null) return;
  const target = event.target as HTMLElement | null;
  if (!target || typeof target.closest !== "function" || !target.closest(".relationship-card")) {
    structuralCardFocusPending = null;
  }
});

// MILESTONE 3, Phase 1/2: populate the Recent Documents cache before the
// first render so a returning reviewer sees their resumable documents
// immediately, not after a flash of an empty landing page.
// 2026-08-01 (blank-first-refresh fix, belt to serve.py's braces): the
// first render must never be hostage to this promise. refreshRecentSessions
// swallows rejections, but Chrome's IndexedDB open can simply STALL on a
// cold start -- if it hasn't settled quickly, render the landing page
// anyway; the recent list fills in via the later render when it does.
{
  let firstRenderDone = false;
  // UI-STATE PERSISTENCE (#3, AG 2026-08-02): a refresh reopens the
  // document this tab had open and restores its snapshot -- runs once,
  // after the first render, and only if nothing is loaded yet (a direct
  // fresh visit has no pointer and lands on Documents as always).
  let autoReopenAttempted = false;
  const attemptAutoReopen = (): void => {
    if (autoReopenAttempted) return;
    autoReopenAttempted = true;
    try {
      const lastOpen = sessionStorage.getItem(LAST_OPEN_DOC_KEY);
      if (lastOpen && !dispatcher.getState().documentLoaded) {
        void handleResumeFromRecent(lastOpen);
      }
    } catch {
      /* no pointer, or storage unavailable -- land on Documents */
    }
  };
  const initialRender = (): void => {
    firstRenderDone = true;
    render();
    attemptAutoReopen();
  };
  void refreshRecentSessions().then(initialRender);
  setTimeout(() => {
    if (!firstRenderDone) initialRender();
  }, 1200);
}

// UI-STATE PERSISTENCE: flush a final snapshot (with the closing scroll
// position) as the page goes away -- the debounced save may not have
// fired. pagehide over beforeunload: fires on bfcache entry too.
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("pagehide", () => {
    if (uiStateSaveTimer !== null) {
      clearTimeout(uiStateSaveTimer);
      uiStateSaveTimer = null;
    }
    const state = dispatcher.getState();
    const snapshot = captureUiSnapshot(state);
    if (snapshot && state.documentId) {
      void dispatcher.saveUiState(state.documentId, snapshot as unknown as Record<string, unknown>).catch(() => {
        /* best-effort */
      });
    }
  });
}

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

// APPLICATION FRAME REFINEMENT (AG, 2026-08-01): one-time wiring for the
// header's static controls -- the settings gear (menu toggle + About line
// showing the version) and the outside-click dismissal shared by the
// settings menu and the document panel. Wired ONCE here rather than in
// render() because the header lives in static markup outside #app (the
// .app-version precedent above); syncAppHeader() only ever writes the
// dynamic slots. All guarded for the fake DOM, same as the version label.
if (typeof document.querySelector === "function" && typeof document.addEventListener === "function") {
  const settingsButton = document.querySelector<HTMLElement>(".app-settings-button");
  const settingsMenu = document.querySelector<HTMLElement>(".app-settings-menu");
  const aboutItem = document.querySelector<HTMLElement>(".app-settings-about");
  if (aboutItem) aboutItem.textContent = `About DocScrub — ${APP_VERSION}`;
  // WORKSPACE METRICS (AG, 2026-08-02): opens the read-only telemetry
  // window; render()'s tail keeps it synced. Purely observational --
  // review runs identically whether this is ever clicked.
  const metricsItem = document.querySelector<HTMLElement>(".app-settings-metrics");
  if (metricsItem) {
    metricsItem.addEventListener("click", () => {
      if (settingsMenu) settingsMenu.hidden = true;
      if (openWorkspaceMetricsWindow()) syncWorkspaceMetricsWindow(dispatcher.getState());
      else notifyToast("The browser blocked the metrics window -- allow pop-ups for this site and try again.");
    });
  }
  if (settingsButton && settingsMenu) {
    settingsButton.addEventListener("click", (event) => {
      event.stopPropagation();
      settingsMenu.hidden = !settingsMenu.hidden;
    });
  }
  document.addEventListener("click", (event) => {
    const target = event.target as HTMLElement | null;
    if (settingsMenu && !settingsMenu.hidden && !(target && settingsMenu.contains(target))) settingsMenu.hidden = true;
    if (headerDocPanelOpen) {
      const panel = document.querySelector<HTMLElement>(".app-document-panel");
      const title = document.querySelector<HTMLElement>(".app-document-title");
      if (!(target && ((panel && panel.contains(target)) || (title && title.contains(target))))) {
        headerDocPanelOpen = false;
        syncAppHeader(dispatcher.getState());
      }
    }
  });
}
