/**
 * visibleListAdvance.ts -- RX-02b (Reviewer Experience Wave 1, 2026-07-29).
 * The post-decision advance, computed over the CURRENTLY DISPLAYED order
 * instead of the domain's structural order.
 *
 * Why this exists: after a decision, FocusNavigator's reconcile()
 * (navigator.ts) advances focus via findByPredicate() over
 * itemIdsForStage()'s raw structural order -- correctly so on its side
 * (Phase 9's "FocusNavigator must never depend on rendered/UI-only state"
 * boundary), but wrong for the reviewer whenever Item Check's
 * search/sort/filter, Category Check's narrowing, or Group Check's sort
 * makes the displayed order diverge from the structural one: focus jumps to
 * the structurally-adjacent item, which under a sort is some visually
 * arbitrary row, and under a filter may not be on screen at all. app.ts
 * intercepts UNCONDITIONALLY after any decision that resolves the focused
 * item (see dispatchReviewWithVisibleAdvance) and re-selects the id this
 * function returns -- unconditional because gating on "did the domain's
 * answer fall off the visible list" fails under sorting-without-filtering,
 * where every item is still present but structural-order advancement is
 * still wrong. This mirrors the interception shape moveWithinVisibleList
 * already established for arrow keys.
 *
 * SEMANTICS -- deliberately identical to navigator.ts's
 * findByPredicate(dir: "forward") (itself Python's
 * next_undecided_after_decision), minus the wrap that goToAdjacentInVisibleList
 * gives "]"/"[":
 *   1. scan FORWARD from the position after `currentId` for the nearest
 *      unresolved id;
 *   2. failing that, scan BACKWARD from the position before `currentId`
 *      (this backward fallback is RX-12's acceptance criterion: a reviewer
 *      deciding the last visible item with unresolved work above them must
 *      be carried back up to it, exactly as the domain already does in
 *      structural order -- a forward-only scan here would silently destroy
 *      that existing property);
 *   3. failing that, return null: REMAIN on the current item. No wrap from
 *      end to beginning ("]"/"[" wrap by design; a post-decision advance
 *      teleporting the reviewer from the bottom of the list to the top is
 *      exactly the disorientation this wave removes).
 *
 * ARCHITECTURAL CONSTRAINT, load-bearing: `visibleIds` and `isResolved`
 * are PARAMETERS. This function must never fetch UI state (or any state)
 * itself -- the caller snapshots the visible list BEFORE dispatching the
 * decision (the pre-decision order is the order the reviewer was actually
 * looking at, and under "Unreviewed only" the just-decided item vanishes
 * from a post-decision evaluation, leaving no anchor), and later
 * frozen-result-set work should change what callers pass as `visibleIds`,
 * never this algorithm. Pure and DOM-free; unit-tested in
 * verify/visible-list-advance-verification.ts.
 */
export function advanceWithinVisibleList(
  currentId: string | null,
  visibleIds: readonly string[],
  isResolved: (id: string) => boolean
): string | null {
  if (visibleIds.length === 0) return null;
  // An absent/null currentId scans the whole list forward from the start --
  // defensive only; callers snapshot pre-decision, when the current item is
  // still in the visible list.
  const idx = currentId !== null ? visibleIds.indexOf(currentId) : -1;
  for (let i = idx + 1; i < visibleIds.length; i++) {
    if (!isResolved(visibleIds[i]!)) return visibleIds[i]!;
  }
  for (let i = idx - 1; i >= 0; i--) {
    if (!isResolved(visibleIds[i]!)) return visibleIds[i]!;
  }
  return null;
}
