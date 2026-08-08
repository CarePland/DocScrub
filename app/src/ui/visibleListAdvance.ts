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

/**
 * A review target is one reviewer-visible unit of work in the order the UI
 * paints it. Candidates and relationship proposals intentionally share the
 * same advance grammar here: completion paths should ask "what unresolved
 * target is nearest?" rather than re-walking candidate arrays, proposal
 * arrays, or structural-card fallbacks independently.
 */
export type ReviewDisplayTargetKind = "candidate" | "proposal";

export interface ReviewDisplayTarget {
  kind: ReviewDisplayTargetKind;
  id: string;
}

export function reviewDisplayTargetKey(target: ReviewDisplayTarget): string {
  return `${target.kind}:${target.id}`;
}

export function candidateReviewTarget(id: string): ReviewDisplayTarget {
  return { kind: "candidate", id };
}

export function proposalReviewTarget(id: string): ReviewDisplayTarget {
  return { kind: "proposal", id };
}

export function advanceWithinReviewTargets(
  currentKey: string | null,
  targets: readonly ReviewDisplayTarget[],
  isResolved: (target: ReviewDisplayTarget) => boolean
): ReviewDisplayTarget | null {
  const keys = targets.map(reviewDisplayTargetKey);
  const byKey = new Map(targets.map((target) => [reviewDisplayTargetKey(target), target]));
  const landingKey = advanceWithinVisibleList(currentKey, keys, (key) => {
    const target = byKey.get(key);
    return target === undefined || isResolved(target);
  });
  if (landingKey === null) return null;
  return byKey.get(landingKey) ?? null;
}

/**
 * The shape of a sectioned-queue section this module needs in order to state
 * its display order. STRUCTURAL, not an import of app.ts's
 * `SectionedQueueSection`: the rules below are the ones that decide where a
 * cursor may land, so they belong in a pure module that
 * verify/visible-list-advance-verification.ts can pin without a browser --
 * the same argument reviewZone.ts makes for keeping the zone's rules out of
 * the render path. app.ts's own interface satisfies this by construction.
 */
export interface ReviewTargetSection {
  candidateIds: readonly string[];
  relationshipProposalIds?: readonly string[] | undefined;
  tiers?: readonly { readonly candidateIds: readonly string[] }[] | undefined;
}

/**
 * THE SECTION'S CANDIDATE CELLS, GROUPED AS THE RENDERER DRAWS THEM -- one
 * group per rendered grid. A section with 0 or 1 tiers draws a single grid
 * over `candidateIds`; a section with 2+ tiers draws one grid per tier, in
 * tier order.
 *
 * This is the ONLY statement of that rule. The renderer calls it to decide
 * how many grids to draw and what goes in each; `sectionDisplayTargets`
 * calls it to decide what order the cursor walks. Two independent
 * restatements of "which cells, in which order" is exactly how paint order
 * and target order drifted apart before.
 */
export function sectionCandidateTargetGroups(section: ReviewTargetSection): ReviewDisplayTarget[][] {
  const tiers = section.tiers ?? [];
  if (tiers.length > 1) return tiers.map((tier) => tier.candidateIds.map(candidateReviewTarget));
  return [section.candidateIds.map(candidateReviewTarget)];
}

/**
 * The section's proposal cells. SECTION-SCOPED, NOT TIER-SCOPED: a tier
 * partitions the section's CANDIDATES by recommendation strength ("Strong
 * Recommendations" / "Needs Review"), a claim a relationship proposal has no
 * analogue for. So proposals belong to the section as a whole and are drawn
 * once, in their own grid after the last tier's -- which is what keeps a
 * tiered, proposal-bearing section from painting each proposal once per tier
 * while the derivation emits it once.
 */
export function sectionProposalTargets(section: ReviewTargetSection): ReviewDisplayTarget[] {
  return (section.relationshipProposalIds ?? []).map(proposalReviewTarget);
}

/**
 * EVERY GRID THIS SECTION DRAWS, IN DRAW ORDER. The renderer consumes this
 * directly -- one `renderGrid` call per entry -- so the identity
 * `sectionGridSequence(s).flat()` == `sectionDisplayTargets(s)` is what makes
 * paint order and target order agree, stated as code rather than as a comment
 * two call sites promise to honour.
 *
 * Two shapes, because tiering changes what a grid can hold:
 *
 *  - UNTIERED: ONE grid holding candidates then proposals. They share a grid
 *    on purpose -- the Review Zone then bounds both unit types against one
 *    capacity (a proposal is a first-class review cell competing for the same
 *    24), and the single blank spacer row separates the two groups inside it.
 *
 *  - TIERED (2+ tier groups): one grid per tier, because tier HEADINGS
 *    interleave the candidate grids, plus one proposal grid after the last
 *    tier. A tier partitions candidates by recommendation strength and has no
 *    claim to make about a relationship pair, so the proposals are a peer of
 *    the tier grids rather than a member of any one -- which is also what
 *    stops a proposal being drawn once per tier.
 *
 * An empty proposal grid is never emitted, so a section with no proposals
 * draws exactly its candidate grids.
 */
export function sectionGridSequence(section: ReviewTargetSection): ReviewDisplayTarget[][] {
  const groups = sectionCandidateTargetGroups(section);
  const proposals = sectionProposalTargets(section);
  if (proposals.length === 0) return groups;
  if (groups.length <= 1) return [[...(groups[0] ?? []), ...proposals]];
  return [...groups, proposals];
}

/** The section's review targets in displayed order. */
export function sectionDisplayTargets(section: ReviewTargetSection): ReviewDisplayTarget[] {
  return [...sectionCandidateTargetGroups(section).flat(), ...sectionProposalTargets(section)];
}

export function adjacentReviewTarget(
  currentKey: string | null,
  targets: readonly ReviewDisplayTarget[],
  direction: "forward" | "backward"
): ReviewDisplayTarget | null {
  if (targets.length === 0) return null;
  const keys = targets.map(reviewDisplayTargetKey);
  const idx = currentKey !== null ? keys.indexOf(currentKey) : -1;
  const next =
    direction === "forward"
      ? idx === -1
        ? 0
        : Math.min(targets.length - 1, idx + 1)
      : idx === -1
        ? targets.length - 1
        : Math.max(0, idx - 1);
  if (idx === next) return null;
  return targets[next] ?? null;
}
