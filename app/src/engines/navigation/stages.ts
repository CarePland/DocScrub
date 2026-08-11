/**
 * stages.ts -- derives each workflow stage's traversable item list, its
 * outstanding REVIEW ARTIFACTS, and its resolved/completion status fresh
 * from (DetectionResult, GroupingResult, ReviewSession) every time. No
 * caching, nothing stored: this is exactly the "derive, never duplicate
 * ReviewEngine state" requirement from Andrew's Phase 9 instruction, made
 * structural rather than aspirational.
 *
 * TWO AXES OF WORK (AG, 2026-08-02): traversable ITEMS (below) and
 * non-traversable ARTIFACTS (see the REVIEW ARTIFACTS block further down).
 * A stage is finished only when both are. "The active workflow should
 * represent all remaining review work, not only unresolved candidates."
 *
 * ITEM IDENTITY PER STAGE (stable domain IDs, never array position):
 * - ambiguity-check: candidateId, one per GroupingResult.ambiguityProposals
 *   entry (already deterministically ordered by EntityResolutionEngine --
 *   see phase-6-findings.md -- so no re-sorting is needed here).
 * - group-check: groupId, one per GroupingResult.entityGroupProposals
 *   entry (likewise already deterministic).
 * - type-check (PHASE 2, 2026-08-02): SemanticTypeId, one per POPULATED
 *   semantic type in display order -- read directly from
 *   context.semanticTypes (computed once per load by Workspace from
 *   domain/semanticTypes.ts's semanticTypeFor(); see
 *   DetectionGroupingContext.ts). Traversal units are TYPES, not
 *   candidates, per Andrew's explicit Phase 2 spec. Contexts built
 *   without semanticTypes (parity suites, bare instances) yield an empty
 *   list -- the stage then reads as empty and the conditional workflow
 *   hides it.
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
 * - type-check: a TYPE is resolved once every member candidate is
 *   resolved via the same candidateResolvedStatus rule item-check uses --
 *   "a type is considered complete when all of its members have been
 *   resolved through the existing candidate decision pipeline" (AG,
 *   Phase 2 spec, verbatim). Derive-don't-duplicate made structural: no
 *   type-level durable decision exists anywhere, so this CANNOT drift
 *   from the per-candidate truth.
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
    case "type-check":
      return (context.semanticTypes ?? []).map((g) => g.typeId);
    case "item-check":
      return context.detection.candidates.map((c) => c.id);
    case "qa":
    case "output":
      return [];
  }
}

/**
 * THE WORK QUEUE, as distinct from the traversal universe above (AG,
 * 2026-08-02, "Item Check shows remaining work"): Item Check's items minus
 * the ones already resolved -- what the reviewer still has to decide.
 * Every other stage returns itemIdsForStage() unchanged.
 *
 * WHY item-check ONLY, and not simply "the unresolved subset of any stage".
 * Group Check's rows are entity groupings the reviewer reads as a set, and
 * a decided group still carries the outcome label groupDisplayDecision()
 * computes for it -- that row IS the answer, so retiring it would delete
 * the result rather than the work. Item Check is the one stage whose rows
 * are a queue of individual questions, so it is the one stage where
 * "answered" and "no longer belongs here" mean the same thing. Written as
 * an explicit stage check rather than a general rule because it is a claim
 * about Item Check specifically, and a future stage should have to opt in
 * deliberately.
 *
 * WHY A SECOND FUNCTION RATHER THAN NARROWING itemIdsForStage ITSELF.
 * The two lists answer genuinely different questions and both are needed:
 *   - itemIdsForStage = every item that EXISTS at this stage. FocusNavigator
 *     traverses it (navigator.ts) and it must stay complete: findByPredicate
 *     already skips resolved items on its own, so narrowing it would change
 *     no navigation behavior while quietly making decided candidates
 *     unreachable -- including after an undo, when they must come back.
 *     computeStageStatus() also keeps counting it, so the tab still reads
 *     (remaining / everything detected). That denominator IS the progress
 *     signal; recomputing it from this list would make every stage read
 *     (N/N) and destroy the thing the shrinking queue is meant to show.
 *   - this = what is still the reviewer's to decide. The queue Item Check
 *     renders, nothing else.
 * Signature and posture deliberately mirror reviewArtifactIdsForStage()
 * below -- session-aware, omits things that are not work rather than
 * reporting them resolved, same file, same shape.
 *
 * NOTHING IS STORED, so reappearance needs no machinery: undo a decision,
 * revoke a group decision, or import a session where one is absent, and
 * isItemResolved() simply stops returning true on the next read and the
 * item is back in the queue. A stored "retired" flag would have needed an
 * invalidation path for each of those and could still have gone stale,
 * stranding work where no reviewer would look for it again.
 *
 * PARTIAL COVERAGE STAYS, via isItemResolved -> candidateResolvedStatus,
 * which only reports "resolved" when EVERY occurrence is accounted for. A
 * candidate whose occurrences a group decision covered only partly remains
 * in the queue in full. That distinction is load-bearing in a redaction
 * tool: retiring it would drop the uncovered occurrences out of review
 * entirely, which is a false negative reaching a released document.
 */
export function reviewableItemIdsForStage(stage: WorkflowStage, context: DetectionGroupingContext, session: ReviewSession): string[] {
  const itemIds = itemIdsForStage(stage, context);
  if (stage !== "item-check") return itemIds;
  return itemIds.filter((itemId) => !isItemResolved(stage, itemId, context, session));
}

/*
 * ============================================================================
 * REVIEW ARTIFACTS (AG, 2026-08-02): outstanding reviewer work that is NOT
 * a traversable item.
 *
 * WHY THIS EXISTS. The work model counted candidates, groups and types --
 * the things arrow keys walk. The structural relationship PROPOSALS render
 * as part of the Ambiguity Check collection and demand a reviewer decision
 * exactly like a row does, but nothing in this file knew they existed. The
 * consequence was found live (2026-08-02): decide the last candidate row and
 * the stage read "complete", the conditional workflow dropped its tab, and
 * an unaddressed proposal became unreachable -- the reviewer was walked past
 * work the application itself had raised, with no indication. Andrew's
 * correction, verbatim: "The active workflow should represent all remaining
 * review work, not only unresolved candidates."
 *
 * WHY NOT JUST ADD THEM TO itemIdsForStage. Items are TRAVERSAL units:
 * FocusState.target.itemId holds one, the navigator moves between them, and
 * every stage renderer resolves one to a row. A proposal is none of those --
 * the UI gives it a separate cursor (app.ts's structuralCardFocusPending)
 * precisely because it is a different kind of object. Folding proposals into
 * the item list would put proposalIds into focus targets that no row
 * renderer can resolve. So artifacts are a PARALLEL axis with a deliberately
 * identical shape: `reviewArtifactIdsForStage` mirrors `itemIdsForStage`,
 * `isArtifactResolved` mirrors `isItemResolved`. A future artifact kind is
 * two switch cases, and nothing downstream learns a new concept.
 *
 * OWNERSHIP -- proposals belong to AMBIGUITY CHECK. They render there
 * unconditionally (category-first is that stage's only presentation, and it
 * already handles rows-empty-but-cards-present). Item Check's Triage view
 * renders the same cards as a convenience, but ONLY in that view -- a UI
 * presentation toggle this layer must never depend on (the hard domain
 * boundary this repo keeps). Counting them under Item Check would either
 * couple the domain to a view mode or overstate that stage's work. With
 * ownership on Ambiguity Check, the cards stay reachable regardless of which
 * surface the reviewer used.
 *
 * RESOLVED RULE -- "every member candidate carries a CandidateDecision",
 * which is EXACTLY the `addressed` test app.ts's card renderer uses for its
 * green completed treatment. Chosen so the stage and the card can never
 * disagree; a stage vanishing while a card still looked unaddressed is the
 * whole bug. Deliberately NOT candidateResolvedStatus() (which also honors
 * group coverage) even though this file uses it for items: it would let the
 * domain call a proposal done while its card still rendered unaddressed --
 * the same divergence in the other direction. Recorded as a divergence from
 * this file's own "never re-demand work covered by a group" rule; if a
 * group-covered proposal ever strands a reviewer, unify BOTH sides on
 * candidateResolvedStatus in one pass rather than either side alone.
 * ============================================================================
 */

/** Artifact identity per stage, stable and content-derived (proposalId --
 *  see StructuralRelationship.ts). Dismissed proposals remain present and
 *  resolved: the reviewer's "Unrelated" decision is itself a reversible
 *  state on the relationship proposal, not a reason for the proposal to
 *  vanish from the review surface. */
export function reviewArtifactIdsForStage(stage: WorkflowStage, context: DetectionGroupingContext, session: ReviewSession): string[] {
  if (stage !== "ambiguity-check") return [];
  return (context.structuralRelationships ?? []).map((p) => p.proposalId);
}

export function isArtifactResolved(stage: WorkflowStage, artifactId: string, context: DetectionGroupingContext, session: ReviewSession): boolean {
  if (stage !== "ambiguity-check") return true;
  if (session.relationshipDismissals?.[artifactId]) return true;
  const proposal = (context.structuralRelationships ?? []).find((p) => p.proposalId === artifactId);
  if (!proposal) return true; // no such proposal anymore -- not reviewable, matching the item rules' own posture
  return proposal.candidateIds.every((candidateId) => candidateId in session.candidateDecisions);
}

function findSemanticTypeGroup(context: DetectionGroupingContext, typeId: string) {
  return context.semanticTypes?.find((g) => g.typeId === typeId);
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
    case "type-check": {
      const group = findSemanticTypeGroup(context, itemId);
      if (!group) return true; // no such type in this document -- not reviewable
      // NOTE: candidateResolvedStatus, not bare candidateDecisions -- a
      // member fully covered by a resolved entity group counts as done
      // here exactly as it does in item-check, so Group Check work is
      // never re-demanded type-by-type.
      return group.candidateIds.every((candidateId) => candidateResolvedStatus(session, context.detection, candidateId).status === "resolved");
    }
    case "qa":
    case "output":
      return false;
  }
}

/** The stages that hold reviewer work, in canonical order -- everything
 *  except the inherently-required completion stages. Named here because
 *  the QA/Output gate below scans them; workflow.ts's REQUIRED_STAGES is
 *  the same split seen from the other side. */
const WORK_STAGES: readonly WorkflowStage[] = WORKFLOW_STAGE_ORDER.filter((stage) => stage !== "qa" && stage !== "output");

export function computeStageStatus(stage: WorkflowStage, context: DetectionGroupingContext, session: ReviewSession): StageStatus {
  if (stage === "qa" || stage === "output") {
    // ONE DEFINITION OF "REVIEW IS DONE" (AG, 2026-08-02). This used to
    // read Item Check's completion alone -- a second, narrower rule beside
    // the workflow's own, and one that could not see a review artifact. A
    // document could therefore reach an available Output with an
    // unaddressed structural proposal still outstanding. It now asks the
    // same question the workflow membership rule asks, of every work
    // stage: is anything left. For candidate-only documents this is
    // unchanged in practice -- group/type/ambiguity items resolve as their
    // member candidates do, so Item Check finishing last is the norm.
    const workRemains = WORK_STAGES.some((workStage) => computeStageStatus(workStage, context, session).completion === "unresolved");
    return {
      stage,
      hasItems: false,
      available: !workRemains,
      completion: workRemains ? "unresolved" : "complete",
      itemCount: 0,
      unresolvedCount: 0,
      artifactCount: 0,
      unresolvedArtifactCount: 0,
    };
  }
  // DELIBERATELY itemIdsForStage, NOT reviewableItemIdsForStage (AG,
  // 2026-08-02): counts report progress, so the denominator must stay
  // "everything detected here". Counting the work queue instead would make
  // every stage read (N/N) forever -- the queue only ever holds unresolved
  // items -- which would erase the exact progress signal the shrinking
  // queue exists to reinforce. See that function's own doc comment.
  const itemIds = itemIdsForStage(stage, context);
  const unresolvedCount = itemIds.filter((id) => !isItemResolved(stage, id, context, session)).length;
  const artifactIds = reviewArtifactIdsForStage(stage, context, session);
  const unresolvedArtifactCount = artifactIds.filter((id) => !isArtifactResolved(stage, id, context, session)).length;
  // COMPLETION SPANS BOTH AXES (2026-08-02): "empty" means the stage holds
  // no work of any kind; a stage with only artifacts left is "unresolved",
  // not "complete" -- which is what keeps its tab, its traversal slot and
  // its progress contribution alive until the reviewer has actually
  // finished it.
  const completion: StageCompletionStatus =
    itemIds.length === 0 && artifactIds.length === 0 ? "empty" : unresolvedCount + unresolvedArtifactCount === 0 ? "complete" : "unresolved";
  return {
    stage,
    // Unchanged meaning: TRAVERSABLE items only. A stage with artifacts but
    // no items still has nothing for the arrow keys to walk, and callers
    // that ask this question are asking about traversal.
    hasItems: itemIds.length > 0,
    available: true,
    completion,
    itemCount: itemIds.length,
    unresolvedCount,
    artifactCount: artifactIds.length,
    unresolvedArtifactCount,
  };
}

export function computeAllStageStatuses(context: DetectionGroupingContext, session: ReviewSession): StageStatus[] {
  return WORKFLOW_STAGE_ORDER.map((stage) => computeStageStatus(stage, context, session));
}
