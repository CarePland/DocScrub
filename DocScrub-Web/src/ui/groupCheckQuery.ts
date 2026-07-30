/**
 * groupCheckQuery.ts -- pure, DOM-free sort logic for Group Check's group
 * list, mirroring itemCheckQuery.ts's own separation (Milestone 2): UI-layer
 * ephemeral display logic, not domain logic. It only orders which of
 * GroupingResult's already-computed entityGroupProposals are rendered
 * first; it never reads ReviewSession beyond the same simple per-member
 * decision lookup groupDisplayDecision() (coverage.ts) already exposes.
 *
 * SCOPE DECISION (Group Check revision, 2026-07-29): unlike Item Check's
 * queryItemCheck(), this intentionally has no free-text search or
 * filter-preset layer -- Andrew's request was specifically about
 * navigation order following whatever's currently SORTED and about the
 * compact/color-coded layout; search/filter for Group Check is a
 * plausible future extension (see workspace-interaction-revision's sibling
 * findings doc) but wasn't asked for here, and Group Check's list is
 * typically far smaller than Item Check's full candidate list (entity
 * groups, not every raw candidate), so the scaling pressure that justified
 * Item Check's fuller query layer doesn't obviously apply yet.
 *
 * WHY THIS EXISTS AT ALL (root cause this file fixes): FocusNavigator's
 * moveItem traverses itemIdsForStage("group-check", ...)'s raw,
 * EntityResolutionEngine-produced order -- deterministic, but with no
 * relationship to whatever order the reviewer currently has on screen.
 * Before this revision Group Check had no sort control, so this couldn't
 * yet diverge; adding sort without ALSO redirecting arrow-key navigation
 * through it (see app.ts's moveWithinVisibleList) would have reintroduced,
 * inside Group Check, the exact "arrow keys jump out of sequence relative
 * to what's displayed" defect Andrew reported from Item Check.
 */

import type { ReviewSession } from "../domain/ReviewSession.js";
import type { EntityGroupProposal } from "../engines/EntityResolutionEngine.js";
import { groupDisplayDecision, type GroupDisplayDecision } from "../engines/review/coverage.js";

export type GroupSortOrder = "confidence-desc" | "confidence-asc" | "member-count-desc" | "member-count-asc" | "alphabetical";

export const GROUP_SORT_ORDERS: readonly { key: GroupSortOrder; label: string }[] = [
  { key: "confidence-desc", label: "Confidence (high to low)" },
  { key: "confidence-asc", label: "Confidence (low to high)" },
  { key: "member-count-desc", label: "Members (most to fewest)" },
  { key: "member-count-asc", label: "Members (fewest to most)" },
  { key: "alphabetical", label: "Alphabetical (A to Z)" },
];

export interface GroupQueryFacts {
  group: EntityGroupProposal;
  displayDecision: GroupDisplayDecision;
}

export function buildGroupQueryFacts(groups: EntityGroupProposal[], session: ReviewSession): GroupQueryFacts[] {
  return groups.map((group) => ({ group, displayDecision: groupDisplayDecision(group, session) }));
}

/** Same tie-break discipline as itemCheckQuery.ts's compareCandidates(): every
 *  branch ends on groupId so results stay stable and directly testable. */
export function compareGroups(a: GroupQueryFacts, b: GroupQueryFacts, order: GroupSortOrder): number {
  const idTiebreak = () => a.group.groupId.localeCompare(b.group.groupId);
  switch (order) {
    case "confidence-desc":
      return b.group.originalProposalConfidence - a.group.originalProposalConfidence || idTiebreak();
    case "confidence-asc":
      return a.group.originalProposalConfidence - b.group.originalProposalConfidence || idTiebreak();
    case "member-count-desc":
      return b.group.candidateIds.length - a.group.candidateIds.length || idTiebreak();
    case "member-count-asc":
      return a.group.candidateIds.length - b.group.candidateIds.length || idTiebreak();
    case "alphabetical":
      return a.group.canonicalName.localeCompare(b.group.canonicalName) || idTiebreak();
    default: {
      const exhaustive: never = order;
      return exhaustive;
    }
  }
}

/** The one entry point app.ts calls -- sorts, does not filter. Pure
 *  function of its inputs; no hidden state. */
export function sortGroups(facts: GroupQueryFacts[], order: GroupSortOrder): GroupQueryFacts[] {
  return [...facts].sort((a, b) => compareGroups(a, b, order));
}
