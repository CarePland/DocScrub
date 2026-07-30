/**
 * stages.ts -- derives each workflow stage's traversable item list and
 * resolved/completion status fresh from (DetectionResult, GroupingResult,
 * ReviewSession) every time. No caching, nothing stored: this is exactly
 * the "derive, never duplicate ReviewEngine state" requirement from
 * Andrew's Phase 9 instruction, made structural rather than aspirational.
 *
 * ITEM IDENTITY PER STAGE (stable domain IDs, never array position):
 * - ambiguity-check: candidateId, one per GroupingResult.ambiguityProposals
 *   entry (already deterministically ordered by EntityResolutionEngine --
 *   see phase-6-findings.md -- so no re-sorting is needed here).
 * - group-check: groupId, one per GroupingResult.entityGroupProposals
 *   entry (likewise already deterministic).
 * - item-check: candidateId, one per DetectionResult.candidates entry
 *   (already deterministic -- see phase-4-findings.md's OrderedDict-
 *   equivalent Map insertion-order note). Folds Python's "Category Check"
 *   and "Results" into one list -- see FocusState.ts's top doc comment
 *   for the full reconciliation record.
 * - qa / output: no item list (see FocusState.ts).
 *
 * RESOLVED RULES, oracle-grounded:
 * - ambiguity-check and item-check: a candidate is resolved once it has
 *   ANY CandidateDecision (Keep/Rename/Redact/Ignore) OR its occurrences
 *   are fully covered by a resolved entity group -- delegates to
 *   review/coverage.ts's candidateResolvedStatus(), the exact same
 *   function ReviewEngine.candidateStatus() uses, so the two can never
 *   silently diverge. Confirmed via local_web_app.py's
 *   update_ambiguous_match(): ambiguity resolution IS a plain candidate
 *   decision, nothing more specialized -- see FocusState.ts's "CONFIRMED
 *   FINDING" note.
 * - group-check: a group is resolved once it has an EntityGroupDecision
 *   (Confirmed/Rejected/Refined) OR every one of its proposed member
 *   candidateIds already has its own direct CandidateDecision (covers a
 *   reviewer who decided each member individually without ever dispatching
 *   a group-level command -- matches "skip items no longer reviewable
 *   because of a prior decision").
 */

import type { EntityGroupProposal } from "../EntityResolutionEngine.js";
import type { ReviewSession } from "../../domain/ReviewSession.js";
import type { StageCompletionStatus, StageStatus, WorkflowStage } from "../../domain/FocusState.js";
import { WORKFLOW_STAGE_ORDER } from "../../domain/FocusState.js";
import { candidateResolvedStatus } from "../review/coverage.js";
import type { DetectionGroupingContext } from "../DetectionGroupingContext.js";

export function itemIdsForStage(stage: WorkflowStage, context: DetectionGroupingContext): string[] {
  switch (stage) {
    case "ambiguity-check":
      return context.grouping.ambiguityProposals.map((p) => p.candidateId);
    case "group-check":
      return context.grouping.entityGroupProposals.map((g) => g.groupId);
    case "item-check":
      return context.detection.candidates.map((c) => c.id);
    case "qa":
    case "output":
      return [];
  }
}

function findGroup(context: DetectionGroupingContext, groupId: string): EntityGroupProposal | undefined {
  return context.grouping.entityGroupProposals.find((g) => g.groupId === groupId);
}

export function isItemResolved(stage: WorkflowStage, itemId: string, context: DetectionGroupingContext, session: ReviewSession): boolean {
  switch (stage) {
    case "ambiguity-check":
    case "item-check":
      return candidateResolvedStatus(session, context.detection, itemId).status === "resolved";
    case "group-check": {
      if (session.groupDecisions[itemId]) return true;
      const group = findGroup(context, itemId);
      if (!group) return true; // no such group anymore -- treat as not-reviewable, matching "skip items no longer reviewable"
      return group.candidateIds.every((candidateId) => candidateId in session.candidateDecisions);
    }
    case "qa":
    case "output":
      return false;
  }
}

export function computeStageStatus(stage: WorkflowStage, context: DetectionGroupingContext, session: ReviewSession): StageStatus {
  if (stage === "qa" || stage === "output") {
    const itemCheckComplete = computeStageStatus("item-check", context, session).completion === "complete";
    return { stage, hasItems: false, available: itemCheckComplete, completion: itemCheckComplete ? "complete" : "unresolved", itemCount: 0, unresolvedCount: 0 };
  }
  const itemIds = itemIdsForStage(stage, context);
  const unresolvedCount = itemIds.filter((id) => !isItemResolved(stage, id, context, session)).length;
  const completion: StageCompletionStatus = itemIds.length === 0 ? "empty" : unresolvedCount === 0 ? "complete" : "unresolved";
  return { stage, hasItems: itemIds.length > 0, available: true, completion, itemCount: itemIds.length, unresolvedCount };
}

export function computeAllStageStatuses(context: DetectionGroupingContext, session: ReviewSession): StageStatus[] {
  return WORKFLOW_STAGE_ORDER.map((stage) => computeStageStatus(stage, context, session));
}
