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
