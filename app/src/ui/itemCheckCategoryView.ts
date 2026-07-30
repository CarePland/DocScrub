/**
 * itemCheckCategoryView.ts -- RX-02a (Reviewer Experience Wave 1,
 * 2026-07-29). The pure, side-effect-free form of Category Check's two
 * narrowing axes (review-state chips and category chips), extracted from
 * renderCategoryCheckPanel's DOM-producing pass in app.ts so that the
 * renderer and keyboard navigation (visibleItemCheckIds) consume the SAME
 * function -- visible membership and visible order can therefore never
 * silently drift between "what's on screen" and "what the arrow keys
 * traverse", the exact defect class moveWithinVisibleList's former KNOWN
 * SCOPE LIMIT paragraph disclosed for this view.
 *
 * Follows the established per-stage-module pattern (itemCheckQuery.ts,
 * groupCheckQuery.ts): pure display logic over facts a caller builds from
 * WorkspaceState, DOM-free, independently unit-testable in Node (see
 * verify/item-check-category-view-verification.ts). ARCHITECTURAL
 * BOUNDARY, same as those modules: this is UI-layer narrowing over
 * ALREADY-COMPUTED domain output. It never reads ReviewSession or
 * QualityResult itself -- `status` and `categories` arrive precomputed
 * (app.ts's itemCheckCandidateStatus()/candidateCategories(), the same
 * functions the renderer already used inline), so no resolved/unresolved or
 * evidence logic is duplicated here.
 */

/** The review-state axis of Category Check's chip row -- "total" is the
 *  "show every state" chip; the other three are itemCheckCandidateStatus()'s
 *  actual per-candidate statuses. Moved here from app.ts (RX-02a) so the
 *  pure helper and the UI state it narrows by share one definition. */
export type CategoryReviewState = "total" | "resolved" | "unlikely" | "toReview";

/** What a single candidate can actually BE -- "total" is a filter option,
 *  never a per-candidate status. */
export type CandidateReviewStatus = Exclude<CategoryReviewState, "total">;

/** Everything narrowByCategoryView() needs about one candidate, gathered by
 *  the caller from WorkspaceState (app.ts's buildCategoryViewFacts) -- the
 *  same "facts in, ids out" shape CandidateQueryFacts already established. */
export interface CategoryViewFacts {
  candidateId: string;
  status: CandidateReviewStatus;
  /** Evidence-category rule ids -- see candidateCategories() in app.ts. */
  categories: string[];
}

export interface CategoryViewNarrowing {
  reviewState: CategoryReviewState;
  /** null = the "Show All" chip (no category narrowing). */
  categoryFilter: string | null;
}

/**
 * Applies Category Check's two narrowing passes -- review state first, then
 * category -- preserving the input order (Category Check imposes no sort of
 * its own; the incoming order is Item Check's own search/filter/sort
 * output, and this function must not reorder it). Returns candidateIds.
 * Pure function of its inputs; no hidden state.
 */
export function narrowByCategoryView(facts: readonly CategoryViewFacts[], view: CategoryViewNarrowing): string[] {
  return facts
    .filter((f) => view.reviewState === "total" || f.status === view.reviewState)
    .filter((f) => view.categoryFilter === null || f.categories.includes(view.categoryFilter))
    .map((f) => f.candidateId);
}
