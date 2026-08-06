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

/**
 * The THIRD narrowing axis (2026-07-30, Python-parity feature pass):
 * Python's Category Check carries a per-category "Filter" row -- Show All /
 * Single Occurrence / Multiple Occurrences / High Likelihood -- that opens
 * when a specific category is selected. This was the reconstruction doc's
 * §1.10 "deliberately deferred third axis"; the 2026-07-30 feature spec
 * (`20260730-DocScrub-featuresFromPython.docx`) brings it in, with the
 * spec's own semantics: "Show All is a Filter that shows all the time.
 * However, if Show All is selected, it should show all and negate the
 * other filters" -- i.e. the axis is single-select, and "all" is the
 * no-op member. "Total" under Review State clears every filter (the
 * caller resets this axis to "all" at that click site; the Filter row is
 * hidden entirely while reviewState === "total").
 */
export type CategoryContextFilter = "all" | "single-occurrence" | "multiple-occurrences" | "high-likelihood";

export const CATEGORY_CONTEXT_FILTERS: readonly { key: CategoryContextFilter; label: string }[] = [
  { key: "all", label: "Show All" },
  { key: "single-occurrence", label: "Single Occurrence" },
  { key: "multiple-occurrences", label: "Multiple Occurrences" },
  { key: "high-likelihood", label: "High Likelihood" },
];

/** Same threshold as itemCheckQuery.ts's HIGH_CONFIDENCE_THRESHOLD and the
 *  green badge band -- one number, not a second opinion. */
export const HIGH_LIKELIHOOD_THRESHOLD = 90;

export function matchesContextFilter(facts: CategoryViewFacts, filter: CategoryContextFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "single-occurrence":
      return facts.occurrenceCount === 1;
    case "multiple-occurrences":
      return facts.occurrenceCount > 1;
    case "high-likelihood":
      return (facts.likelihood ?? 0) >= HIGH_LIKELIHOOD_THRESHOLD;
    default: {
      const exhaustive: never = filter;
      return exhaustive;
    }
  }
}

/** Everything narrowByCategoryView() needs about one candidate, gathered by
 *  the caller from WorkspaceState (app.ts's buildCategoryViewFacts) -- the
 *  same "facts in, ids out" shape CandidateQueryFacts already established. */
export interface CategoryViewFacts {
  candidateId: string;
  status: CandidateReviewStatus;
  /** Evidence-category rule ids -- see candidateCategories() in app.ts. */
  categories: string[];
  /** For the Single/Multiple Occurrence context filters. */
  occurrenceCount: number;
  /** For the High Likelihood context filter; undefined (unscored) never
   *  qualifies as high-likelihood, mirroring itemCheckQuery's own
   *  `?? 0` treatment. */
  likelihood: number | undefined;
}

export interface CategoryViewNarrowing {
  reviewState: CategoryReviewState;
  /** null = the "Show All" link next to Categories (no category narrowing). */
  categoryFilter: string | null;
  /** The Filter row's axis -- "all" = its Show All chip (no narrowing). */
  contextFilter: CategoryContextFilter;
}

/**
 * Applies Category Check's three narrowing passes -- review state, then
 * category, then the context filter -- preserving the input order
 * (Category Check imposes no sort of its own; the incoming order is Item
 * Check's own search/filter/sort output, and this function must not
 * reorder it). Returns candidateIds. Pure function of its inputs; no
 * hidden state.
 */
export function narrowByCategoryView(facts: readonly CategoryViewFacts[], view: CategoryViewNarrowing): string[] {
  return facts
    .filter((f) => view.reviewState === "total" || f.status === view.reviewState)
    .filter((f) => view.categoryFilter === null || f.categories.includes(view.categoryFilter))
    .filter((f) => matchesContextFilter(f, view.contextFilter))
    .map((f) => f.candidateId);
}
