/**
 * workflow.ts -- the CONDITIONAL WORKFLOW derivation (AG, Phase 2 final
 * authorization, 2026-08-02): "Build the active workflow from the ordered
 * set of stages that currently contain work, while always retaining any
 * stages that are inherently required for completion, such as QA or
 * Output. ... The progress UI, focus navigation, previous/next behavior,
 * and stage labels should all derive from the same active workflow
 * definition so hidden stages do not leave gaps, stale numbering,
 * inaccessible focus targets, or incorrect completion logic."
 *
 * This module IS that single definition. Consumers -- and there must be
 * no others computing stage visibility independently:
 *   - app.ts renderStageTabs()   -> which tabs render (hidden stages get
 *                                   no tab at all, not a disabled one)
 *   - app.ts handleStageArrowKey -> Shift+Left/Right traverse THIS list,
 *                                   never the fixed enum
 *   - navigator.ts moveStage     -> the same traversal at the domain level
 *   - navigator.ts reconcile()/createInitialFocusState -> focus targets
 *                                   can never point at (or start on) a
 *                                   hidden stage
 *
 * "CONTAINS WORK" = any unresolved ITEM or any unresolved review ARTIFACT
 * (AG, 2026-08-02: "The active workflow should represent all remaining
 * review work, not only unresolved candidates"), derived fresh from
 * computeStageStatus() every call (never cached -- the same
 * cannot-silently-diverge posture stages.ts itself takes). Note this is
 * resolution-based, not existence-based, exactly per Andrew's examples
 * ("No unresolved groups: omit Group Check" -- a stage whose every item
 * is decided disappears just like one that never had items). QA and
 * Output are ALWAYS retained as the inherently-required completion
 * stages, so the active list is never empty and a fully-reviewed
 * document's workflow reads: QA -> Output.
 *
 * DISCLOSED CONSEQUENCE (recorded in the Phase 2 findings doc): because a
 * completed work stage is hidden entirely, revisiting/changing a decision
 * after EVERY candidate is resolved has no stage surface left to do it
 * from -- re-deciding remains possible only while some stage still shows
 * work (e.g. Item Check's Resolved/Changed narrowings while it is
 * visible). This is the faithful reading of "the reviewer should not have
 * to enter an empty stage merely to confirm that nothing is there"; if
 * real use wants a way back in, a deliberate affordance (not a resurrected
 * always-on tab) is the follow-up.
 */

import type { StageStatus, WorkflowStage } from "../../domain/FocusState.js";
import { WORKFLOW_STAGE_ORDER } from "../../domain/FocusState.js";
import type { ReviewSession } from "../../domain/ReviewSession.js";
import type { DetectionGroupingContext } from "../DetectionGroupingContext.js";
import { computeStageStatus } from "./stages.js";

/** The stages a document's workflow always ends with, work or no work --
 *  "inherently required for completion" (verification and export are not
 *  optional steps a document can be born past). */
const REQUIRED_STAGES: ReadonlySet<WorkflowStage> = new Set(["qa", "output"]);

/** The one membership rule. Exported so the UI can ask "would this stage
 *  be in the active workflow" of an already-computed StageStatus without
 *  re-deriving statuses it already holds (render() receives them in
 *  WorkspaceState) -- same rule, zero recomputation.
 *
 *  ALL REMAINING WORK, NOT ONLY CANDIDATES (AG, 2026-08-02): outstanding
 *  review ARTIFACTS keep a stage active exactly as unresolved items do.
 *  Before this, "contains work" meant unresolvedCount alone, so a stage
 *  whose only remaining work was a structural relationship proposal read
 *  as finished, lost its tab, and left that proposal unreachable (found
 *  live; see stages.ts's REVIEW ARTIFACTS block for the full account).
 *  Deliberately written as a sum over the status's own fields rather than
 *  a new predicate per artifact kind: a future artifact type joins by
 *  being counted in stages.ts, and this rule never changes again. */
export function isStageActive(status: StageStatus): boolean {
  return REQUIRED_STAGES.has(status.stage) || status.unresolvedCount + status.unresolvedArtifactCount > 0;
}

/** The active workflow, in canonical order, derived fresh. Never empty:
 *  qa/output are always members. */
export function activeWorkflowStages(context: DetectionGroupingContext, session: ReviewSession): WorkflowStage[] {
  return WORKFLOW_STAGE_ORDER.filter((stage) => isStageActive(computeStageStatus(stage, context, session)));
}

/**
 * Where focus belongs when `from` is not (or is no longer) part of the
 * active workflow: the next active stage AT OR AFTER `from` in canonical
 * order, else the nearest active stage before it. Forward-first matches
 * the guided-workflow direction (finishing a stage's last item moves you
 * onward, never backward); the backward fallback covers a stage past
 * Output only in principle -- qa/output being always-active means the
 * forward scan can only miss when `from` is later than every active
 * stage, which cannot happen for a real WorkflowStage. Total: always
 * returns a member of the active list.
 */
export function nearestActiveStage(from: WorkflowStage, active: readonly WorkflowStage[]): WorkflowStage {
  const fromIndex = WORKFLOW_STAGE_ORDER.indexOf(from);
  for (let i = fromIndex; i < WORKFLOW_STAGE_ORDER.length; i++) {
    const stage = WORKFLOW_STAGE_ORDER[i]!;
    if (active.includes(stage)) return stage;
  }
  for (let i = fromIndex - 1; i >= 0; i--) {
    const stage = WORKFLOW_STAGE_ORDER[i]!;
    if (active.includes(stage)) return stage;
  }
  // Unreachable while qa/output are REQUIRED_STAGES; kept total for safety.
  return active[0] ?? "output";
}
