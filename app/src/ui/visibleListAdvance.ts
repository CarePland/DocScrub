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
 * ZONE-SCOPED ADVANCE (AG, 2026-08-10). The fix for "deciding the last cell
 * of the Zone throws the cursor out of the Zone."
 *
 * ═══════════════ THE OBSERVED DEFECT ═══════════════
 *
 * Ambiguity Check, category `Other Words`. The Zone held 24 cells; `Amy` (1)
 * and `Kyle` (24) were decided. Deciding `Kyle` advanced the cursor to `Math`
 * -- a cell BELOW the Zone -- rather than back to `Last` (2), the first cell
 * still needing a decision.
 *
 * The cascading consequence is the real damage: `Alt N` ("These are all words,
 * not names") is scoped to the Zone, so with focus parked outside the Zone the
 * bulk action silently did nothing.
 *
 * ═══════════════ WHY THE EXISTING GUARD DID NOT CATCH IT ═══════════════
 *
 * `advanceWithinDisplayedReviewTargets` already has the right SHAPE -- a
 * `preferredTargets` list it tries before the full sequence. But the caller
 * passed the SECTION, and a section extends past the Zone. `Kyle` is cell 24
 * of the Zone and cell 24 of a 26-cell section, so the forward scan inside the
 * "preferred" list happily walked on to `Math`.
 *
 * The preference has to be the ZONE, because the Zone -- not the section -- is
 * what bounds the bulk actions and what the reviewer is actually working.
 *
 * ═══════════════ WHY THIS WRAPS, WHERE THE LIST ADVANCE DOES NOT ═══════════════
 *
 * `advanceWithinVisibleList` deliberately refuses to wrap: a post-decision
 * advance teleporting from the bottom of a long document to the top is
 * disorienting, and that rule stands.
 *
 * A ZONE IS DIFFERENT, and the difference is bounded size. Wrapping inside a
 * 24-cell surface the reviewer can see in one screen is a carriage return, not
 * a teleport -- it lands on the first cell still needing a decision, which is
 * exactly where the reviewer expects to continue. This is why the rule lives
 * in its own function rather than as a flag on the list advance: the two have
 * genuinely different justifications and should not be able to drift into each
 * other.
 *
 * Returns null when the zone holds no unresolved work, which is the caller's
 * signal to fall through to the full sequence and leave the zone behind.
 */
export function advanceWithinZone(
  currentKey: string | null,
  zoneTargets: readonly ReviewDisplayTarget[],
  isResolved: (target: ReviewDisplayTarget) => boolean
): ReviewDisplayTarget | null {
  if (zoneTargets.length === 0) return null;
  const keys = zoneTargets.map(reviewDisplayTargetKey);
  const index = currentKey === null ? -1 : keys.indexOf(currentKey);
  /* Forward from the current cell to the end of the zone. */
  for (let i = index + 1; i < zoneTargets.length; i += 1) {
    if (!isResolved(zoneTargets[i]!)) return zoneTargets[i]!;
  }
  /* Then wrap: the first cell in the zone still needing a decision. */
  for (let i = 0; i <= index && i < zoneTargets.length; i += 1) {
    if (!isResolved(zoneTargets[i]!)) return zoneTargets[i]!;
  }
  return null;
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

/**
 * CATEGORY ARRIVAL LANDS ON THE FIRST UNRESOLVED UNIT, OF EITHER KIND
 * (AG, 2026-08-09, observed live -- a recurrence).
 *
 * THE TRACE:
 *
 *   seq 4  category.arrive  selectStageCategoryCursor
 *          category acronyms -> candidate:person:may (ALREADY RESOLVED)
 *          {candidateCount: 1, proposalCount: 3, remaining: 2}
 *
 * The reviewer opened Acronyms, which held two unresolved proposals, and
 * was placed on a candidate they had already decided. They then had to
 * pick a card by hand (seq 6) to start working.
 *
 * WHAT THE OLD RULE WAS, and why it is worth stating rather than just
 * deleting -- it looked correct, which is how it survived a previous fix:
 *
 *     candidateIds.find((id) => !decisions[id]) ?? candidateIds[0]
 *     if (firstCandidate) { select it; return }
 *     ...proposal branch...
 *
 * Two separate faults, either of which alone reproduces the symptom:
 *
 *  1. The `??` fallback lands on `candidateIds[0]` -- a RESOLVED unit --
 *     once every candidate is decided.
 *  2. The proposal branch is unreachable whenever `candidateIds` is
 *     NON-EMPTY. The function's own doc comment promised "its first
 *     unreviewed unit of EITHER type... a category holding nothing but
 *     proposals lands on a proposal"; the code delivered that only for a
 *     category with no candidates AT ALL, which is a much narrower thing
 *     than a category whose only REMAINING work is proposals.
 *
 * Candidates still lead the order -- `sectionDisplayTargets` draws them
 * before proposals, so a category with unresolved work of both kinds still
 * opens on a candidate exactly as before. What changes is that "first
 * unresolved" is now asked of the whole unit sequence instead of the
 * candidate array, which is what the documented behavior always said.
 *
 * FALLING BACK TO `targets[0]` ON A FULLY RESOLVED CATEGORY IS
 * DELIBERATE, and matches navigator.ts's own first_active_key(): a
 * finished category is still inspectable, and arriving nowhere would be
 * worse than arriving on its first cell.
 *
 * Pure and DOM-free; pinned by verify/visible-list-advance-verification.ts.
 */
export function firstUnresolvedReviewTarget(
  targets: readonly ReviewDisplayTarget[],
  isResolved: (target: ReviewDisplayTarget) => boolean
): ReviewDisplayTarget | null {
  if (targets.length === 0) return null;
  return targets.find((target) => !isResolved(target)) ?? targets[0]!;
}

/**
 * THE COMPLETION ADVANCE MAY NOT OVERRIDE A LIVE CURSOR (AG, 2026-08-08).
 *
 * ROOT CAUSE OF THE OBSERVED OVERWRITE, from the instrumented run:
 *
 *   seq 68  advance.visible      proposal:rel-acronym-ITS -> proposal:rel-acronym-PERC
 *   seq 69  cursor.write L3566   proposalCursor ITS -> PERC
 *   seq 70  advance.completion   anchor proposal:rel-acronym-QBU -> candidate:person:civitas
 *   seq 71  cursor.write L3569   proposalCursor PERC -> (none)
 *
 * `advanceAfterSectionCompletion` fired 39ms after the per-unit advance had
 * already placed the reviewer correctly on PERC, and overwrote it. It fired
 * because its call site (app.ts, acknowledgeBulkCandidateFeedback's ELSE
 * branch -- the branch reached precisely when `sectionCompletedByAnchor`
 * returned FALSE) invoked it on the sole condition that a completion anchor
 * EXISTED. `snapshotCurrentScopeCompletionAnchor` returns one for
 * essentially every decision on a sectioned stage, so a function named
 * "advance after section completion" ran on every decision, completed or
 * not, recomputing the cursor from a TRAILING anchor.
 *
 * Bounding where it could land (advanceWithinCategoryScope, below) stopped
 * it leaving the category, but not the overwrite itself: the completion
 * advance was still entitled to replace a perfectly good position with its
 * own answer. This is the gate that ends the class.
 *
 * THE RULE: a completion advance may move the reviewer only when the
 * reviewer is standing on FINISHED work. If the current unit is still
 * unresolved, someone has already placed the cursor somewhere valid --
 * the per-unit advance, or the reviewer themselves -- and the completion
 * path must leave it alone.
 *
 * WHY THIS PRESERVES THE PULSE, which is the behavior most at risk here.
 * On genuine section completion the UI deliberately pins the cursor back
 * onto the completed anchor (keepSectionVisibleForCompletionFeedback) so
 * the section stays visible while it flashes, and only then, after the
 * acknowledgement timer, calls this advance. That anchor is RESOLVED by
 * definition -- the section just completed -- so the gate opens and the
 * advance proceeds exactly as before. The bulk case is preserved for the
 * same reason: a bulk action that resolves the block under the cursor
 * leaves the cursor on resolved work, and the advance is permitted to
 * carry the reviewer past it.
 *
 * A cursor that is absent, or that has fallen off the target list
 * entirely, permits the advance: recovering from that is exactly what the
 * advance is for, and refusing would strand the reviewer.
 */
export function completionAdvanceIsPermitted(
  currentKey: string | null,
  targets: readonly ReviewDisplayTarget[],
  isResolved: (target: ReviewDisplayTarget) => boolean
): boolean {
  if (currentKey === null) return true;
  const current = targets.find((target) => reviewDisplayTargetKey(target) === currentKey);
  if (current === undefined) return true;
  return isResolved(current);
}

/**
 * THE CATEGORY BOUNDARY IS A HARD STOP (AG, 2026-08-08, observed live).
 *
 * "A category must NOT advance while unresolved review units remain in it"
 * -- Andrew's invariant, stated as a rule the advance cannot route around
 * rather than as a comment three call sites promise to honour.
 *
 * WHAT THIS FIXES, from an instrumented run rather than from reading:
 *
 *   seq 68  advance.visible      proposal:rel-acronym-ITS -> proposal:rel-acronym-PERC
 *   seq 70  advance.completion   anchor proposal:rel-acronym-QBU -> candidate:person:civitas
 *                                {sectionId: "acronyms", remaining: 2}
 *
 * The reviewer decided ITS; the per-unit advance correctly chose PERC; then
 * the section-completion advance overrode it and jumped to a DIFFERENT
 * CATEGORY while acronyms still held two unresolved units.
 *
 * The mechanism is not "zone exhaustion mistaken for completion" (an
 * earlier hypothesis, refuted by probe -- chunk retirement makes that state
 * unreachable). It is simpler and worse: the completion anchor's
 * `anchorKey` is the LAST target of the current zone scope, NOT the unit
 * the reviewer acted on. `advanceWithinReviewTargets` scans FORWARD first,
 * so advancing from a trailing anchor walks straight out of the category
 * and never reaches the unresolved units sitting BEHIND that anchor -- the
 * backward fallback is never consulted, because the forward scan succeeded.
 *
 * That single fact explains three separately-reported failures: completing
 * a relationship proposal advancing to the wrong place (the anchor is a
 * different proposal), a category "opening on its last item" (the anchor
 * trails), and a decision advancing to the next category with work
 * remaining.
 *
 * THE RULE: while the category still holds unresolved work, the advance is
 * scoped to that category, and the forward-then-backward scan therefore
 * finds the work behind the anchor instead of leaving. Only once the
 * category is genuinely complete may the advance range over the whole
 * stage -- which is exactly the documented completion behavior, now
 * conditioned on the category being complete instead of assumed.
 *
 * Pure and DOM-free so it is provable without a browser; pinned by
 * verify/visible-list-advance-verification.ts.
 */
export function advanceWithinCategoryScope(
  anchorKey: string | null,
  categoryTargets: readonly ReviewDisplayTarget[],
  stageTargets: readonly ReviewDisplayTarget[],
  isResolved: (target: ReviewDisplayTarget) => boolean
): ReviewDisplayTarget | null {
  const categoryHasWork = categoryTargets.some((target) => !isResolved(target));
  if (categoryHasWork) {
    // Scoped. If the anchor is not itself in this category the scan starts
    // from -1 and simply takes the category's first unresolved unit, which
    // is the correct landing for a trailing/foreign anchor.
    return advanceWithinReviewTargets(anchorKey, categoryTargets, isResolved);
  }
  return advanceWithinReviewTargets(anchorKey, stageTargets, isResolved);
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
