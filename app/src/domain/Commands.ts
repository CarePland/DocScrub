/**
 * Namespaced command vocabulary — architecture v0.2 §9. Split into four
 * discriminated families (review / navigation / document / history) instead
 * of one flat command enum, so CommandDispatcher can route by family without
 * becoming, in its own words, "a dumping ground" (§6.10). Exact command names
 * may still change; the family boundaries should not.
 *
 * v2 (Phase 8): redactCandidate gained an optional `replacement`. Confirmed
 * by reading local_web_app.py's update_decision() directly: Python's
 * decision.replacement is settable regardless of whether the decision is
 * RENAME or REDACT (both branches accept a reviewer-supplied override
 * string; REDACT just defaults to a type-appropriate placeholder like
 * "[REDACTED EMAIL]" when unset, computed at output-generation time, not
 * here). Additive -- existing single-field callers remain valid.
 *
 * v3 (Phase 9): NavigationCommand was replaced wholesale.
 * OBJECTIVE INTERFACE DEFECT: the v2 shape (moveResult/moveControl/
 * moveCategory/selectControl) could not express any of what
 * FocusNavigator's real behavior needs -- stage movement, unresolved-only
 * traversal, entering/closing a focused item, or Not Quite member
 * movement -- because it predates the concrete workflow-stage and
 * focus-target model this phase had to design from Python's real
 * behavior (see FocusNavigator.ts and docs/detection/phase-9-findings.md).
 * `moveControl`/`moveCategory`/`selectControl`/`activeCategory` were
 * speculative placeholders from an earlier design pass with no concrete
 * behavior ever identified for them (no Python behavior maps onto a
 * generic "focused control" or "category" concept once Category Check is
 * folded into Item Check -- see findings doc); removed rather than kept
 * as permanent dead vocabulary, per "do not preserve an inadequate stub
 * merely to avoid a justified correction."
 *
 * v4 (Phase 11): ApplicationCommand gained `generateAudit`, routed to
 * ReviewWorkspace.generateAudit() (see Workspace.ts/AuditExporter.ts).
 * Additive -- existing commands are unaffected.
 *
 * v5 (Feature 001, first post-migration feature): ReviewCommand gained
 * three group-level bulk actions -- confirmGroup/rejectGroup/flattenGroup --
 * closing the one scope gap Gate E's side-by-side acceptance review
 * flagged (docs/detection/phase-12-findings.md): Python's real UI lets a
 * reviewer resolve an entire proposed entity group in one action; until
 * this feature, the only group-level path in this port was Not Quite
 * (member-by-member). See docs/detection/feature-001-group-bulk-actions.md
 * for full design rationale. Additive -- existing commands are unaffected.
 *
 * v6 (Feature 002, Decision Reuse -- "Review once. Apply everywhere."):
 * ReviewCommand gained applyDecisionReuse, and ApplicationCommand gained
 * importDecisions. The MATCHING computation (which prior decisions apply to
 * which current candidates, and why) deliberately happens OUTSIDE
 * ReviewEngine, in a new stateless DecisionReuseEngine (same category as
 * EntityResolutionEngine/CandidateQualityEngine: a pure engine that
 * computes a proposal, not a review-state owner) -- applyDecisionReuse's
 * payload is that engine's ALREADY-COMPUTED proposal list. ReviewEngine's
 * job stays exactly what it has always been: apply decisions to durable
 * state, one candidate at a time, via the same decideCandidate() helper
 * every other command uses (see session.ts's applyDecisionReuse case for
 * why it also never overwrites an existing decision, reviewer- or
 * import-sourced). importDecisions carries a File because reading it is
 * genuine I/O, matching document.load's own precedent -- Workspace parses
 * it, runs DecisionReuseEngine, then dispatches applyDecisionReuse to its
 * own ReviewEngine, exactly the same "async orchestration boundary, no
 * business logic of its own" role Workspace already plays for
 * loadDocument()/generateOutput(). See
 * docs/detection/feature-002-decision-reuse.md. Additive -- existing
 * commands are unaffected.
 *
 * v7 (Milestone 2, "Review at Scale"): ReviewCommand gained
 * bulkApplyDecision -- Item Check's multi-select bulk actions (Redact
 * selected / Keep selected / Ignore selected / Rename selected), the
 * generalization of Feature 001's group-level bulk commands to an
 * arbitrary, reviewer-selected candidateId list instead of a group's fixed
 * membership. Applies the SAME decision to every listed candidate via the
 * same decideCandidate() helper every other command uses (see session.ts's
 * case), so every resulting CandidateDecision is byte-identical to what a
 * reviewer would get by deciding each candidate individually -- there is no
 * separate "bulk decision" concept in the domain model, only a batched way
 * of applying ordinary ones. This is also why bulk operations need no
 * special "undo" mechanism: nothing about a bulk-applied decision is any
 * less reversible than a direct one -- both are a plain CandidateDecision
 * entry a reviewer can freely re-decide at any time. ItemMoveDirection also
 * gained `previousDecided` -- the mirror-image counterpart FocusNavigator's
 * existing `previousUnresolved`/`nextUnresolved` pair established by
 * symmetry (see navigator.ts's `findUnresolved` doc comment) needed for
 * Milestone 2's "Previous decision" workspace-navigation command. A
 * symmetric `nextDecided` was deliberately NOT added: no UI consumer needs
 * it (Milestone 2's navigation list asks for "Next undecided," which is the
 * ALREADY-EXISTING `nextUnresolved`, not a decided-forward jump), and this
 * file's own v3 note already established the precedent of not carrying
 * speculative, currently-unused command vocabulary. Additive -- existing
 * commands are unaffected.
 *
 * v8 (Milestone 3, "Reviewer Productivity", Phase 1): ApplicationCommand
 * gained `resumeSession` -- loads a document from a previously autosaved
 * `SessionRecord` (src/io/LocalSessionRepository.ts) by `documentId` rather
 * than a fresh `File` from a picker, the one input `document.load` cannot
 * express (a resume has no File until ReviewWorkspace.resumeFromRepository()
 * reconstructs one from stored bytes). Routed to
 * ReviewWorkspace.resumeFromRepository(), which then reuses
 * loadDocument()'s existing documentId-gated restore path unchanged -- this
 * is a new INPUT to that path, not a new restore mechanism. Additive --
 * existing commands are unaffected.
 *
 * v9 (group-level terminology revision, 2026-07-28): Andrew's own review of
 * Feature 001 corrected its account of "his instruction." The Confirm/
 * Reject/Flatten vocabulary was never a deliberately-narrowed subset of
 * Python's five-way group actions -- it was Andrew's own attempt to find
 * transferable terms that read consistently across every "cell" region of
 * the app (Item Check, Not Quite, Group Check alike), and it broke down
 * specifically because "Flatten" doesn't describe anything when a group has
 * exactly one member. The corrected, standardized vocabulary matches Item
 * Check's own decision terms exactly: Rename / Keep-as-is / Redact / Ignore
 * / Not Quite. Concretely: `confirmGroup` and `flattenGroup` are UNCHANGED
 * at the command/type level (only their UI labels change, to "Keep as-is"
 * and "Rename" respectively -- see app.ts); `redactGroup` and `ignoreGroup`
 * are NEW, bulk-applying Redact/Ignore to every member the same way
 * confirmGroup bulk-applies Keep (see session.ts's cases) -- these fill the
 * `r`/`i` keyboard slots keymap.ts deliberately left reserved since Feature
 * 001 specifically for this; `rejectGroup` is REMOVED (command, `x`
 * keybinding, and UI button) -- it has no counterpart in the corrected
 * five-term vocabulary and no Python precedent. `EntityGroupDecision`'s
 * `"Rejected"` union member is left in place in ReviewSession.ts for
 * backward compatibility with sessions saved before this revision; no
 * command produces it going forward. See
 * docs/detection/feature-001-group-bulk-actions.md for the amendment.
 *
 * v10 (Ambiguity Check correction, 2026-07-28): ReviewCommand gained
 * `linkAmbiguousCandidate`. Andrew traced a real document where a full name
 * (e.g. "Andrew Goodloe") mentioned with only one spelling, followed by
 * bare first-name references ("Andrew"), never reached Ambiguity Check at
 * all -- see resolution.ts's top doc comment for the full defect trace.
 * Fixing the evidence gap alone was not enough: even when Ambiguity Check
 * DID correctly flag a candidate (two-plus people sharing a first name,
 * each with a spelling-variant pair), there was no command to actually act
 * on `AmbiguityProposal.candidateGroupOptions` -- Ambiguity Check reused
 * Item Check's plain Keep/Rename/Redact/Ignore vocabulary with no way to
 * record which entity a candidate was confirmed to refer to.
 * `ReviewSession.ambiguityResolutions` and `ReviewEventKind`'s
 * "ambiguity-resolved" have existed in the schema since ADR-008/Phase 8
 * (see ReviewSession.ts) but were never written to by any command --
 * confirmed dormant directly in FocusState.ts's own "CONFIRMED FINDING"
 * doc comment. This command finally activates that schema: the reviewer
 * confirms candidateId refers to the entity identified by groupId (which
 * may be a real EntityGroupProposal.groupId, if one already independently
 * exists, or a solitary anchor's synthetic bucket key -- both share the
 * same personGroupKey-derived id scheme, see resolution.ts). Declining a
 * suggestion ("refers to another person" / "not a name in this context")
 * needs no new command -- the existing keepCandidate/renameCandidate/
 * redactCandidate/ignoreCandidate commands already work unmodified in
 * Ambiguity Check for that. See docs/detection/
 * ambiguity-anchor-correction.md. Additive -- existing commands are
 * unaffected.
 */

import type { MemberAction } from "./NotQuite.js";
import type { WorkflowStage } from "./FocusState.js";
import type { DecisionReuseProposal } from "./DecisionReuse.js";
import type { CandidateDecisionKind } from "./ReviewSession.js";
import type { ReplacementRuleConfig } from "./ReplacementRule.js";

// ---- review.* -- routed to ReviewEngine ------------------------------

export type ReviewCommand =
  | { family: "review"; type: "keepCandidate"; candidateId: string }
  | { family: "review"; type: "renameCandidate"; candidateId: string; replacement: string }
  | { family: "review"; type: "redactCandidate"; candidateId: string; replacement?: string }
  | { family: "review"; type: "ignoreCandidate"; candidateId: string }
  | { family: "review"; type: "enterNotQuite"; groupId: string }
  | {
      family: "review";
      type: "applyNotQuiteMember";
      groupId: string;
      candidateId: string;
      action: MemberAction;
      draftReplacement?: string;
    }
  | { family: "review"; type: "completeNotQuite"; groupId: string }
  | { family: "review"; type: "exitNotQuite"; groupId: string }
  /** "Keep as-is" at the group level (UI label; see app.ts) -- accepts a
   *  proposed entity group exactly as presented, bulk-applying Keep to
   *  every member via the same decideCandidate() helper every other
   *  command uses. See session.ts's confirmGroup case for why bulk-applying
   *  a real per-candidate decision is necessary, not optional. */
  | { family: "review"; type: "confirmGroup"; groupId: string }
  /** "Redact" at the group level -- bulk-applies Redact to every member,
   *  mirroring the direct redactCandidate command's optional replacement
   *  override (defaults to a type-appropriate placeholder at output-
   *  generation time when unset). Added in the v9 terminology revision to
   *  fill the `r` keyboard slot keymap.ts reserved for exactly this since
   *  Feature 001. */
  | { family: "review"; type: "redactGroup"; groupId: string; replacement?: string }
  /** "Ignore" at the group level -- bulk-applies Ignore to every member.
   *  Added in the v9 terminology revision to fill the `i` keyboard slot
   *  keymap.ts reserved for exactly this since Feature 001. */
  | { family: "review"; type: "ignoreGroup"; groupId: string }
  /** "Rename" at the group level (UI label; see app.ts -- this command was
   *  named `flattenGroup` before the v9 terminology revision and is
   *  unchanged here). Bulk-applies the group's own already-computed
   *  canonical name to every member via the same Rename path a reviewer
   *  would use one member at a time inside Not Quite -- produces the same
   *  resulting session state a manual per-member pass followed by
   *  completion would, without opening a Not Quite transaction at all. */
  | { family: "review"; type: "flattenGroup"; groupId: string }
  /** Bulk-applies an already-computed batch of decision-reuse proposals
   *  (Feature 002) -- see this file's v6 changelog note. Never overwrites a
   *  candidate that already has ANY decision (reviewer- or
   *  import-sourced); see session.ts's own case for why "import fills
   *  gaps, it never contests existing state" is the correct default here. */
  | { family: "review"; type: "applyDecisionReuse"; proposals: DecisionReuseProposal[] }
  /** Milestone 2 ("Review at Scale") -- see this file's v7 changelog note.
   *  Applies ONE decision to every listed candidateId, via the same
   *  decideCandidate() path every direct per-candidate command uses.
   *  `replacement` is REQUIRED when decision is "Rename" (one shared
   *  replacement string applied to every selected candidate, same
   *  shared-text pattern flattenGroup already uses for a group's canonical
   *  name) and OPTIONAL when decision is "Redact" (same optional-override
   *  semantics as the direct redactCandidate command). Ignored for "Keep"/
   *  "Ignore". Candidate IDs not found in the current document are skipped,
   *  not rejected (defensive; matches confirmGroup/flattenGroup's own
   *  precedent) -- but if EVERY id is invalid the whole command fails
   *  rather than silently succeeding as a no-op. */
  | {
      family: "review";
      type: "bulkApplyDecision";
      candidateIds: string[];
      decision: CandidateDecisionKind;
      replacement?: string;
    }
  /** Ambiguity Check correction (v10) -- the reviewer confirms candidateId
   *  refers to the entity identified by groupId, one of that candidate's
   *  own AmbiguityProposal.candidateGroupOptions. Applies Keep (preserving
   *  the candidate's own original surface text -- never rewritten to the
   *  linked entity's canonical name; that is what flattenGroup's explicit
   *  Rename is for, a different, separately-chosen action) via the same
   *  decideCandidate() helper every other command uses, and records the
   *  linkage in `ReviewSession.ambiguityResolutions` for audit purposes.
   *  Declining a suggestion has no dedicated command -- dispatch
   *  keepCandidate/renameCandidate/redactCandidate/ignoreCandidate directly
   *  instead, exactly as Ambiguity Check already allows today. */
  | { family: "review"; type: "linkAmbiguousCandidate"; candidateId: string; groupId: string };

// ---- navigation.* -- routed to FocusNavigator -------------------------
//
// See this file's v3 changelog note (top) for why this union looks
// nothing like its v2 shape.

export type ItemMoveDirection = "next" | "previous" | "nextUnresolved" | "previousUnresolved" | "first" | "last" | "previousDecided";

export type NavigationCommand =
  /** Moves the focused item within the CURRENT stage's own traversal
   *  list (ambiguityProposals / entityGroupProposals / candidates) --
   *  matches redactor/review_queue.py's move_active_key/
   *  next_undecided_after_decision (ported faithfully; see
   *  navigation/navigator.ts). Deliberately 1-dimensional: Python's own
   *  clean, already-tested oracle module has no notion of columns or
   *  2D grid movement -- that only exists in local_web_app.py's client
   *  JS as a viewport-width-dependent visual layer
   *  (`candidateGridColumnCount()`), which FocusNavigator must not
   *  depend on (no DOM references, no rendered-element queries). A
   *  future Workspace UI (Phase 10) may map ArrowLeft/Right to
   *  next/previous and ArrowUp/Down to "move by visual row" using its
   *  own column count entirely within the UI layer. */
  | { family: "navigation"; type: "moveItem"; direction: ItemMoveDirection }
  /** Jumps directly to a specific item by its stable domain ID within
   *  the current stage -- candidateId or groupId as appropriate. */
  | { family: "navigation"; type: "selectItem"; itemId: string }
  /** Moves between workflow stages in either direction, or jumps
   *  directly to a named stage. Never rejected for "unavailable"
   *  stages -- StageStatus.available is informational for the UI to act
   *  on, not a hard gate (Andrew: "do not invent wizard-style
   *  progression"). */
  | { family: "navigation"; type: "moveStage"; direction: "next" | "previous" }
  | { family: "navigation"; type: "focusStage"; stage: WorkflowStage }
  /** "Enter/open focused item": for item-check/ambiguity-check, drills
   *  into the focused candidate's first occurrence (Andrew's explicit
   *  "occurrence" focus dimension, jump-to-source). closeItem returns to
   *  the item level ("close/return to parent context"). Entering/
   *  exiting Not Quite itself is a REVIEW command (review.enterNotQuite/
   *  review.exitNotQuite) with durable effect; FocusNavigator only
   *  reconciles its own panel to match afterward -- see reconcile() in
   *  navigation/navigator.ts. */
  | { family: "navigation"; type: "enterItem" }
  | { family: "navigation"; type: "closeItem" }
  /** Moves the active member cursor within an OPEN Not Quite panel.
   *  Rejected if no Not Quite panel is currently open. */
  | { family: "navigation"; type: "moveNotQuiteMember"; direction: "next" | "previous" };

// ---- document.* -- application-level, may involve I/O -----------------

export type ApplicationCommand =
  | { family: "document"; type: "load"; file: File }
  | { family: "document"; type: "generateOutput" }
  | { family: "document"; type: "saveReviewSession" }
  | { family: "document"; type: "generateAudit" }
  /** Feature 002: imports a previously exported decisions.json (see this
   *  file's v6 changelog note). Deliberately NOT documentId-gated the way
   *  loadDocument()'s session-restore is -- importing across DIFFERENT
   *  document identities is the entire point of this command, not a
   *  mismatch to reject. */
  | { family: "document"; type: "importDecisions"; file: File }
  /** Milestone 3, Phase 1: resume a document from a previously autosaved
   *  SessionRecord instead of a freshly picked File. See this file's v8
   *  changelog note. */
  | { family: "document"; type: "resumeSession"; documentId: string }
  /** Milestone 3, Phase 3: replaces the active ReplacementRuleConfig used
   *  by generateOutput() (see Workspace.ts). Does not itself regenerate
   *  output -- a reviewer who changes rules and wants the rebuilt DOCX to
   *  reflect them re-runs `document.generateOutput`, the same as any other
   *  change that invalidates a previous verification pass (see Workspace.ts's
   *  top doc comment on verification staleness). */
  | { family: "document"; type: "setReplacementRuleConfig"; config: ReplacementRuleConfig };

// ---- history.* ----------------------------------------------------------

export type HistoryCommand =
  | { family: "history"; type: "undo" }
  | { family: "history"; type: "redo" };

export type AnyCommand = ReviewCommand | NavigationCommand | ApplicationCommand | HistoryCommand;

export interface ReviewTransactionResult {
  ok: boolean;
  /** Present when ok === false; a rejected command must say why (e.g. "no
   *  such candidate", "group already resolved") rather than fail silently. */
  reason?: string;
}

export interface CommandResult {
  ok: boolean;
  reason?: string;
}
