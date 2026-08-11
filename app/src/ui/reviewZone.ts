/**
 * REVIEW ZONE (AG, 2026-08-06). Design record:
 * `20260806-review-zone-design.md` (repo-parent root).
 *
 * The block of cards the reviewer is looking at is promoted from a
 * rendering artifact to the SCOPE OF BULK ACTIONS. Andrew's framing:
 *
 *   "Treating the 2 col area as the 'review zone' and making the global
 *   'Keep all' etc buttons only impact that area. Solves two problems --
 *   encourages more granular review and prevents someone from just wiping
 *   out 150 items without fairly reviewing."
 *
 *   "process a limited number is a design decision to make review
 *   practical ... the metrics need to show *good* decisions, not *massive*
 *   ones."
 *
 * This is a deliberate product stance, not a safety hack. A future reader
 * WILL find a bulk action that refuses to cover an obviously-coverable set
 * and be tempted to lift the bound. Read the design doc first; §11 records
 * the agreed way that bound comes off if it ever should (a confirmation
 * naming the population, added on evidence of user demand -- not a silent
 * widening).
 *
 * ---------------------------------------------------------------------
 * WHY A DYNAMIC MEMBER COUNT IS FINE
 * ---------------------------------------------------------------------
 *
 * The grids are `repeat(auto-fill, minmax(14rem, 1fr))`, so the column
 * count follows window width, zoom and font size. The first objection to
 * this design was that an audit record reading "bulk keep, 12 items" would
 * have no principled account of why it was 12.
 *
 * That objection was withdrawn, and why it was wrong is the load-bearing
 * idea here: the problem was never that the count is dynamic, it was that
 * a scope you cannot NAME in an audit record is bad. Those separate. A
 * zone of any size is fully accountable as long as its membership is
 * MATERIALIZED rather than reconstructed -- the action records the ids it
 * actually covered. "Why four?" is never answered from a rule; the record
 * says which four.
 *
 * ---------------------------------------------------------------------
 * WHY THIS MODULE IS PURE, AND MUST STAY PURE
 * ---------------------------------------------------------------------
 *
 * The tempting implementation is to read the rendered grid when the button
 * is pressed -- `measuredColumnCount()` in app.ts already does exactly
 * that for arrow navigation, so the machinery is sitting right there. Do
 * not use it for decisions.
 *
 * A decision path whose scope depends on layout can only be verified in a
 * browser, and this repository's verification environment has none (see
 * verify/ui-smoke.ts's own disclosure). That is the same structural blind
 * spot that let the Type Check member-cursor advance regress three times.
 * Measurement enters here as a PARAMETER (`size`), never as a DOM read, so
 * every rule below is a pure function of (ordered ids, resolved set, size)
 * and is pinned by verify/review-zone-verification.ts without a browser.
 */

/**
 * THE ZONE HOLDS 24 ITEMS. A HARD CONSTANT (AG, 2026-08-06).
 *
 * Andrew, after browsing his own cells: "How is 24 items as a zone max? I
 * did a cursory browsing through many of the cells and that seems far in
 * excess of the text typical in a focus item view." His live document
 * agrees -- median 2 occurrences per candidate, 62% at two or fewer, so
 * the typical item really is far sparser than a screenful.
 *
 * WHY 24 SPECIFICALLY, beyond "about a screenful": it is a RECTANGLE at
 * every common column count. 24 = 2x12 = 3x8 = 4x6 = 6x4 = 8x3 = 12x2. The
 * zone is a subset of a longer list, so the reviewer has to be able to SEE
 * where it stops, and a straight bottom edge does that for free at any
 * window width. 20 is ragged at three columns; 25 is ragged at almost
 * everything. 24 is the smallest number in that neighbourhood that is
 * clean across the range of layouts this grid actually produces.
 *
 * WHY IT SUPERSEDES A MEASURED SIZE, which is the more important change.
 * This was `columns x 2 rows`, which meant zone size depended on a DOM
 * measurement -- the one impure input in this design, the one thing that
 * needed a module variable, a render-tail sync, and a paragraph of
 * justification about why it was safe. A constant needs none of that:
 * `syncZoneColumnCount()` and `zoneColumnCount` are deleted, and the zone
 * is now a pure function of the queue alone.
 *
 * It also ends a real inconsistency. The measured version made the zone
 * "the block beside the panel," but the panel's own CSS defined that block
 * as "the rows that fit next to it" -- roughly forty cards at full height,
 * not four. Two definitions of the same thing were live at once, and the
 * grid rendered forty cells with nothing marking which four a bulk action
 * would touch. The zone is 24, full stop; it no longer tries to be
 * whatever the layout happens to produce, and the band separator is what
 * shows where it ends.
 */
export const ZONE_CAPACITY = 24;
export const ZONE_HALF_CAPACITY = 12;

export interface ReviewZone {
  /** The ids the zone holds, in display order -- the materialized
   *  membership that makes the action auditable. */
  ids: string[];
  /** How many undecided items the zone was drawn FROM. `ids.length <
   *  available` is exactly the state in which the bound is doing
   *  something, and is what lets a label say "4 of 37". */
  available: number;
  /** True while the bound is actually holding something back. */
  bounded: boolean;
}

/**
 * The zone: the next `size` UNRESOLVED items, in display order.
 *
 * SKIPPED ITEMS ROLL FORWARD, and they do so for free. Andrew: "skipped
 * items become part of the next group, for simplicity." A skipped item is
 * not a new concept -- DocScrub has no Skip decision, so "skipped" just
 * means still unresolved. The zone is therefore always "the first `size`
 * of what is left", and an item passed over stays at the front until it is
 * decided.
 *
 * THE CONSEQUENCE WORTH KNOWING: this needs NO NEW PERSISTENCE. No skip
 * list, no zone pointer, nothing to serialize, nothing to restore. The
 * zone is recomputed from the resolved set on every consult, so it
 * survives save/resume by construction and cannot drift from the decisions
 * it is derived from -- the same "derive, don't duplicate" property
 * decisionsMade() relies on. An earlier draft of this design used explicit
 * paging (items [i..i+N)) and would have needed all of it.
 *
 * CALLERS PASS ALREADY-FILTERED IDS. `orderedUndecidedIds` is the caller's
 * own undecided set, in the caller's own display order, because each
 * surface already computes and DISPLAYS its own remaining count beside
 * where the zone lands and the two numbers must agree -- the same
 * contract, and the same reasoning, as decisionReduction's local figures.
 */
export function reviewZone(orderedUndecidedIds: readonly string[], size: number = ZONE_CAPACITY): ReviewZone {
  const bound = Math.max(1, Math.floor(size));
  const ids = orderedUndecidedIds.slice(0, bound);
  return { ids, available: orderedUndecidedIds.length, bounded: orderedUndecidedIds.length > ids.length };
}

/** The band/rest split a sectioned grid paints. Both halves are DRAWN --
 *  `rest` goes inside the collapsed `<details>`, not into nothing. */
export interface ZonePartition<T> {
  /** The zone plus any already-resolved cells that sort before its end:
   *  what the grid draws above the disclosure. */
  band: T[];
  /** The withheld remainder, in cell order. Empty when `banded` is false. */
  rest: T[];
  /** True while the bound is actually holding something back -- the only
   *  state in which a band separator and a disclosure should be drawn. */
  banded: boolean;
}

/**
 * THE BAND/REST SPLIT, OVER ANY REVIEW CELL (2026-08-07).
 *
 * Extracted from app.ts's renderGrid closure so the rule is pinned without a
 * browser, which is this module's whole premise (see the purity note above:
 * "a decision path whose scope depends on layout can only be verified in a
 * browser, and this repository's verification environment has none"). The
 * partition decides which cells a bulk control can reach, so it is a
 * decision path, not decoration.
 *
 * GENERIC IN THE CELL because the zone bounds REVIEW TARGETS, not
 * candidates: a relationship proposal is a first-class review cell and
 * competes for the same capacity. `isUnresolved` is supplied by the caller
 * for the same reason -- a candidate is unresolved when it carries no
 * decision, a proposal when any member still lacks one, and this module has
 * no business knowing either rule.
 *
 * THE INVARIANT THE ADVANCE DEPENDS ON: `band` holds the first `size`
 * unresolved cells in cell order and `rest` holds everything else in cell
 * order, so `[...band, ...rest].filter(isUnresolved)` is EQUAL to
 * `cells.filter(isUnresolved)`. The painted order and the derived target
 * order therefore present the same unresolved sequence, which is the only
 * sequence a post-decision advance ever traverses -- and it is why the
 * target derivation must stay zone-unaware (zone membership changes on every
 * decision; a target order that moved with it would shift the list under the
 * reviewer). Pinned by verify/review-zone-verification.ts.
 */
export function partitionByZone<T>(
  cells: readonly T[],
  isUnresolved: (cell: T) => boolean,
  size: number = ZONE_CAPACITY
): ZonePartition<T> {
  const bound = Math.max(1, Math.floor(size));
  const unresolved = cells.filter(isUnresolved);
  // Not banded when the bound withholds nothing: a section whose remaining
  // work already fits draws no separator and no "0 more" disclosure.
  if (unresolved.length <= bound) return { band: [...cells], rest: [], banded: false };
  const zoneEnd = unresolved[bound - 1]!;
  const endIndex = cells.indexOf(zoneEnd);
  return { band: cells.slice(0, endIndex + 1), rest: cells.slice(endIndex + 1), banded: true };
}

export interface ActiveQueuePartition<T> {
  /** The cells currently inside the bounded review zone. */
  active: T[];
  /** The continuous queue after the active zone, including retired cells. */
  rest: T[];
  /** Active followed by rest: the full painted order. */
  ordered: T[];
  /** Whole half-zone chunks that have completed and moved to the end. */
  retired: T[];
  bounded: boolean;
}

/**
 * Ambiguity Check's conveyor-belt queue (AG, 2026-08-08).
 *
 * The older Review Zone compacted after every individual decision because
 * it was defined as "the next 24 unresolved." That was correct for the
 * original bulk-safety problem, but wrong for Ambiguity's manual-review
 * rhythm: a reviewer deciding cells one at a time needs the map to hold
 * still until a meaningful block of work is done.
 *
 * So this helper retires cells in 12-cell chunks, derived strictly from
 * completion state. A half-zone whose every target is resolved moves to the
 * end of the queue; unfinished chunks keep their internal order and remain
 * ahead of the retired portion. Bulk actions naturally retire a whole
 * 24-cell active zone because the unresolved members they mutate become
 * resolved while any preexisting decisions in that zone were resolved
 * already. No interaction counter or persisted cursor is needed.
 *
 * `anchor` is a display-only category-arrival correction. Some category
 * cursors intentionally land on "the first unreviewed item for this
 * category" even when that item would otherwise sit past the first 24
 * cells in the current grouped/tiered display order. Without an anchor the
 * focus panel can show that item while the side active-zone grid starts
 * somewhere else, putting the selected cell down in the continuation. The
 * anchor rotates only the still-open queue, keeps the same 24-cell bound,
 * and does not serialize anything; completed categories still use
 * completedQueuePartition's canonical first-24 presentation.
 */
export function activeQueuePartition<T>(
  cells: readonly T[],
  isResolved: (cell: T) => boolean,
  size: number = ZONE_CAPACITY,
  halfSize: number = ZONE_HALF_CAPACITY,
  anchor?: T
): ActiveQueuePartition<T> {
  const activeSize = Math.max(1, Math.floor(size));
  const chunkSize = Math.max(1, Math.floor(halfSize));
  const chunks: T[][] = [];
  for (let i = 0; i < cells.length; i += chunkSize) chunks.push(cells.slice(i, i + chunkSize));

  const open: T[][] = [];
  const retired: T[][] = [];
  for (const chunk of chunks) {
    if (chunk.length > 0 && chunk.every(isResolved)) retired.push(chunk);
    else open.push(chunk);
  }

  const rawOpenCells = open.flat();
  const anchorIndex = anchor === undefined ? -1 : rawOpenCells.indexOf(anchor);
  const openCells = anchorIndex > 0 ? [...rawOpenCells.slice(anchorIndex), ...rawOpenCells.slice(0, anchorIndex)] : rawOpenCells;
  const retiredCells = retired.flat();
  const active = openCells.slice(0, activeSize);
  const rest = [...openCells.slice(activeSize), ...retiredCells];
  const ordered = [...active, ...rest];
  return { active, rest, ordered, retired: retiredCells, bounded: rest.length > 0 };
}

/**
 * ONE ZONE ENTRY POINT, PARAMETERIZED BY RHYTHM (AG, 2026-08-09,
 * migration prerequisite D3). PREPARED, NOT YET SWITCHED ON.
 *
 * ---------------------------------------------------------------------
 * THE PROBLEM THIS EXISTS TO CLOSE
 * ---------------------------------------------------------------------
 *
 * DocScrub currently runs TWO Zone algorithms behind one call-site facade.
 * `orderedReviewTargetsForGrid`, `activeReviewTargetsForGrid`,
 * `restReviewTargetsForGrid`, `activeZoneAnchorForGrid` and
 * `headingActionScope` in app.ts each read
 *
 *     if (stage !== "ambiguity-check") { ...compacting... }
 *     ...conveyor...
 *
 * so Item Check Triage gets `partitionByZone`/`reviewZone` -- "the next N
 * unresolved, recompacted after EVERY decision" -- while Ambiguity gets
 * `activeQueuePartition` -- the conveyor, which retires whole half-zone
 * chunks and holds the map still in between.
 *
 * That is not a stage difference. It is a RHYTHM difference, and the
 * conveyor's own doc comment says so: it exists because "a reviewer
 * deciding cells one at a time needs the map to hold still until a
 * meaningful block of work is done." Item Check Triage is the same
 * one-at-a-time rhythm. The divergence is history, not design.
 *
 * ---------------------------------------------------------------------
 * WHY A PARAMETER AND NOT A THIRD BRANCH
 * ---------------------------------------------------------------------
 *
 * `if (stage !== "ambiguity-check")` inside a shared helper is exactly how
 * the two algorithms came to be one facade in the first place. A caller
 * reading the shared function's name reasonably believes both stages get
 * the same rule. So the seam moves OUT of the helper and INTO the caller's
 * declared intent: a caller states which rhythm it wants, and the helper
 * has no opinion about stages at all.
 *
 * `"conveyor"` -- chunk-retiring, stable map. Manual one-at-a-time review.
 * `"compacting"` -- recomputed from the unresolved set on every consult.
 *                   The original bulk-safety model.
 *
 * ---------------------------------------------------------------------
 * DELIBERATELY NOT WIRED UP YET
 * ---------------------------------------------------------------------
 *
 * Switching Item Check Triage from "compacting" to "conveyor" changes what
 * a bulk button covers, and the Review Zone design doc §11 reserves
 * changes to the bulk bound for Andrew rather than for whoever is holding
 * the file. This function and its tests land first so the switch, when
 * approved, is a one-line argument change against already-pinned
 * behavior -- rather than a refactor and a product decision arriving
 * together.
 *
 * Byte-identical to the two existing functions for their respective
 * rhythms; pinned as such by verify/review-zone-verification.ts.
 */
/**
 * ═══════════════ THE ROLLING RHYTHM (AG, 2026-08-10) ═══════════════
 *
 * THE DEFECT BOTH EXISTING RHYTHMS SHARE. Neither moves a decided row out of
 * the working area:
 *
 *   `compacting`  `partitionByZone` returns `cells.slice(0, endIndex + 1)`,
 *                 so resolved cells stay exactly where they were, interleaved
 *                 among the unresolved ones.
 *   `conveyor`    retires a 12-cell chunk only when EVERY cell in it is
 *                 resolved, so a half-finished chunk keeps its decided rows
 *                 scattered through the zone -- by design, to hold the map
 *                 still, but at the cost Andrew named.
 *
 * Rolling separates the two things those rhythms conflated: the map should
 * hold still ENOUGH to keep the cursor predictable, while completed work
 * should stop occupying the reviewer's attention.
 *
 *     active  the first `size` UNRESOLVED cells, in canonical order
 *     rest    the remaining unresolved cells, then every resolved cell
 *
 * ═══════════════ WHY THIS NEEDS NO TRANSIENT STATE ═══════════════
 *
 * The obvious implementation keeps a `transientZoneOrder` array and mutates it
 * on each decision. This does not, and the reason matters:
 *
 *   CANONICAL ORDER CANNOT BE REWRITTEN BY ZONE INTERACTION, because zone
 *   arrangement is never stored. It is a pure function of (canonical cells,
 *   resolved set, size), recomputed on every consult.
 *
 * So "items keep their home position" is not a rule anyone has to obey -- it
 * is a property of the shape. Returning to canonical order (§8: leaving a
 * section, changing a filter, reload, stage navigation) needs no reset path
 * and no invalidation hook, because there is nothing to invalidate. This is
 * the same "derive, don't duplicate" property `reviewZone` already relies on
 * to survive save/resume.
 *
 * ═══════════════ AND WHY THE CONTIGUOUS-RUN RULE STILL MATTERS ═══════════════
 *
 * A retirement rule expressed over the CURRENT arrangement (retire only the
 * contiguous completed run touching the acted-on cell) and this derived rule
 * reach the SAME resting arrangement: previously-retired cells are already at
 * the tail, so a newly completed run joins them, and canonical order within
 * the retired region is deterministic either way.
 *
 * Where the contiguous run genuinely matters is MOTION, not state -- which
 * cells should pulse and travel together as one group. That is what
 * `contiguousCompletedRun` below is for, and keeping it out of the ordering
 * rule is what makes the ordering verifiable without a browser.
 */
export type ZoneRhythm = "conveyor" | "compacting" | "rolling";

/**
 * The rolling partition: fresh unresolved work rises, completed work settles.
 *
 * INVARIANTS, all pinned by verify/review-zone-verification.ts:
 *   - `active` contains no resolved cell, ever -- so completed work from
 *     anywhere, inside the old zone or below it, cannot bubble upward (§4).
 *   - `[...active, ...rest]` is a permutation of `cells`; nothing is dropped
 *     or hidden (§12).
 *   - the unresolved subsequence of `ordered` equals the unresolved
 *     subsequence of `cells` -- the same invariant `partitionByZone`'s post-
 *     decision advance depends on, so the advance keeps traversing a stable
 *     sequence and cannot skip a candidate (§10).
 *   - resolved cells keep canonical relative order in `rest` (§5).
 *   - identical inputs give an identical partition (§10 determinism).
 */
export function rollingQueuePartition<T>(
  cells: readonly T[],
  isResolved: (cell: T) => boolean,
  size: number = ZONE_CAPACITY
): ActiveQueuePartition<T> {
  const bound = Math.max(1, Math.floor(size));
  const unresolved: T[] = [];
  const resolved: T[] = [];
  for (const cell of cells) (isResolved(cell) ? resolved : unresolved).push(cell);
  const active = unresolved.slice(0, bound);
  const rest = [...unresolved.slice(bound), ...resolved];
  return { active, rest, ordered: [...active, ...rest], retired: resolved, bounded: rest.length > 0 };
}

/**
 * The contiguous completed run containing `decided`, in the CURRENT display
 * order -- the group that should pulse and travel together (§5).
 *
 * DISPLAY-ONLY. Nothing about ordering depends on this; it exists so the
 * animation moves `B C D E` as one unit rather than teleporting `D` and
 * stranding its neighbours.
 *
 * Returns an empty array when `decided` is not resolved or not present, so a
 * caller can treat "no run" and "no animation" identically. A resolved cell
 * separated from `decided` by an unresolved cell does NOT join the run, which
 * is the rule that stops unrelated completed work being gathered up.
 */
export function contiguousCompletedRun<T>(
  displayOrder: readonly T[],
  isResolved: (cell: T) => boolean,
  decided: T
): T[] {
  const index = displayOrder.indexOf(decided);
  if (index === -1 || !isResolved(decided)) return [];
  let start = index;
  while (start - 1 >= 0 && isResolved(displayOrder[start - 1]!)) start -= 1;
  let end = index;
  while (end + 1 < displayOrder.length && isResolved(displayOrder[end + 1]!)) end += 1;
  return displayOrder.slice(start, end + 1);
}


export function zonePartition<T>(
  cells: readonly T[],
  isResolved: (cell: T) => boolean,
  rhythm: ZoneRhythm,
  size: number = ZONE_CAPACITY,
  halfSize: number = ZONE_HALF_CAPACITY,
  anchor?: T
): ActiveQueuePartition<T> {
  if (rhythm === "rolling") return rollingQueuePartition(cells, isResolved, size);
  if (rhythm === "conveyor") {
    return anchor === undefined
      ? activeQueuePartition(cells, isResolved, size, halfSize)
      : activeQueuePartition(cells, isResolved, size, halfSize, anchor);
  }
  // COMPACTING: expressed through partitionByZone so the band/rest split
  // stays byte-identical to what Item Check paints today. Note the
  // inverted predicate -- partitionByZone takes `isUnresolved`, a signature
  // difference that is itself a small trap this wrapper now absorbs.
  const partition = partitionByZone(cells, (cell) => !isResolved(cell), size);
  const rest = partition.banded ? partition.rest : [];
  return {
    active: partition.band,
    rest,
    ordered: [...partition.band, ...rest],
    retired: [],
    bounded: rest.length > 0,
  };
}

/**
 * Completed-category presentation for Ambiguity Check (AG, 2026-08-08).
 *
 * This is intentionally NOT the live conveyor. Once the UI has advanced a
 * category into its completed presentation, the reviewer needs an
 * inspectable finished view: canonical order, first 24 beside the focus
 * panel, and any remaining cells continuing below. Decisions stay intact;
 * this helper only partitions display cells.
 */
export function completedQueuePartition<T>(cells: readonly T[], size: number = ZONE_CAPACITY): ActiveQueuePartition<T> {
  const activeSize = Math.max(1, Math.floor(size));
  const active = cells.slice(0, activeSize);
  const rest = cells.slice(activeSize);
  const ordered = [...active, ...rest];
  return { active, rest, ordered, retired: [], bounded: rest.length > 0 };
}

/**
 * The count a bulk control must name. Andrew's rule, and most of the
 * safety property for almost no cost: a button that cannot SAY 150 cannot
 * DO 150.
 *
 * This also dissolves the last practical worry about the dynamic size --
 * the reviewer never has to guess how many items a gesture covers, because
 * the control re-renders with the live figure. That is why zone membership
 * does NOT need to be frozen on entry (an earlier draft required it, to
 * stop a mid-action window resize from pulling unreviewed items into a
 * pending action); there is no state in which the action covers more than
 * the label just said.
 */
export function zoneActionLabel(base: string, count: number): string {
  return `${base} (${count})`;
}

/**
 * THE "STUCK ZONE" -- RAISED, RULED ON, AND DELIBERATELY NOT A FEATURE
 * (AG, 2026-08-06). Recorded because the concern is easy to re-derive and
 * the answer is not obvious from the code.
 *
 * The concern: because skipped items roll forward, a reviewer who keeps
 * declining to decide the same hard items eventually fills the zone with
 * them, and forward motion stops. A `zoneIsStuck()` detector was written
 * for this and then removed.
 *
 * Andrew's ruling: "That's on the user, frankly. There are plenty of
 * options to process items. Pick one... this is not a UI issue."
 *
 * He is right, and the supporting fact is checkable: `decisionButtons()`
 * renders Keep as-is / Change / Redact / Ignore unconditionally on every
 * candidate. There is no item in this application that cannot be decided,
 * so there is no state where the app has failed to offer a way forward --
 * only a reviewer choosing not to take one. A zone showing nothing but the
 * items someone has been avoiding is the queue DOING ITS JOB: surfacing
 * work that is owed.
 *
 * And the stronger reason not to build the relief: anything that eased it
 * would be a snooze, and a snooze in a redaction tool is a mechanism for
 * losing an item. The pressure to decide is the product.
 *
 * If this is ever revisited, revisit the ruling above -- not the mechanic.
 */
