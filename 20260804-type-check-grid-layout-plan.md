# Type Check — Member Grid Layout

**Status:** Implemented, then PARTLY SUPERSEDED the same day — read §S first.
**Date:** 2026-08-04

---

## §S. What shipped differs from this plan (AG, same-day revisions)

This document planned the first pass and is accurate about the diagnosis,
the shared-geometry refactor, and the per-type track table. Three of its
decisions were then overtaken by later instructions. Recorded here rather
than edited away, so the reasoning chain stays legible.

| This plan said | What shipped | Why |
| --- | --- | --- |
| Decision buttons on the active cell, in a height-reserved band | **No controls in the cell at all** — name + count only | AG: *"simply the text in the cell, the count, and let the main panel do the work"* |
| Inline ① conclusion chips in the cell's band | **Chips live in the inspector**, for the active member | Same instruction. This reverses the 2026-08-03 in-cell placement; the route survives, its location moved |
| Items left (3fr), inspector right (2fr), one split | **Inspector left (2fr), items right (3fr), plus a second full-width region below** | AG: *"put the panel on left"*, then the two-region spec |

**The reserved band is gone entirely.** It existed to stop an active cell
growing and reflowing the collection; with no per-cell controls there is
nothing to reveal, so the hazard was removed rather than defended against.
§2.3 of this document describes a mechanism no longer in the code.

**The layout is now two regions, not one split** — the first contiguous run
of cells beside the inspector, the remainder in a full-width grid directly
below, with one ordered collection and one cursor across both. That answers
the dead-space-beside-a-short-panel problem this plan never addressed. No
float, masonry, or overlay. See `index.html`'s member-grid block and
`layoutMemberRegions` / `memberGridTarget` in `app.ts` for the shipped
design; §3's keyboard grammar survives, extended with the seam rules.

**Still open:** extend the two-region concept to Item Check and Ambiguity
Check, which have the same wasted space beside their panels (AG: *"they
should all be a similar experience"*).

---
**Instruction (AG):** *"a redesign of this to have multiple items per row.
This should be dynamic, meaning 2 items per row if the data fits best, or 3
if there're more room, etc. We have this implemented elsewhere in grid
layouts. I'd like the behavior to be internally consistent with key nav to
what we have in other areas too. This should be specific to Type Check."*

**Supersedes in part:** `20260803-type-check-selection-spec.md` §6 build
order — its step 1 (side-by-side split) never landed and is folded in here.

---

## 0. Diagnosis: why Type Check is the odd one out

Andrew's read is right, and the reason is worth stating precisely because it
determines the shape of the fix.

Every other item surface in the app renders its collection as an auto-fill
grid of **compact cells**:

| Surface | Container | Track | Cell |
| --- | --- | --- | --- |
| Item Check (by category) | `.results-grid` | `minmax(15rem, 1fr)` | `.result-cell` |
| Item Check / Ambiguity (queue) | `.triage-grid` | `minmax(14rem, 1fr)` | `.triage-row` |
| Category narrowing | `.category-grid` | `minmax(16.5rem, 1fr)` | `.category-cell` |
| Relationship members | `.relationship-members-grid` | `minmax(11rem, 1fr)` | — |
| **Type Check members** | **`.type-member-rows`** | **`flex-direction: column`** | **`.type-member-row`** |

Type Check's own *type cards* are already an auto-fill grid
(`.type-cards`, `minmax(200px, 1fr)`). It is only the **member list inside
an opened type** that is a single stacked column. So this is not a stage
that missed the grid language — it is one surface inside it that did.

**The mechanical cause is the buttons.** `.triage-row` is dense because it
carries no decision buttons at all: checkbox, state glyph, token,
suggestion chip, chevron. Decisions there come from the keyboard on the
focused row, from digit chips, or from the section headings.
`.type-member-row` carries the full four — `decisionButtons()` renders
Keep as-is / Change / Redact / Ignore into every single row, plus the
suggestion chips, plus the `✓ Keep` state label. That is ~28rem of
content per row, which is exactly why the row is full-width.

Changing `display: flex; flex-direction: column` to `display: grid` without
addressing the row's payload produces a two-column layout of rows that are
each too cramped to use. **The cell language is the redesign; the grid
declaration is one line of it.**

Two secondary blockers:

1. **The People detail panel** (`renderCandidateDetailPanel`) is appended
   *into* the `rows` container, between member rows. As a grid child it
   would either sit in one cell (broken) or span all columns and cut the
   grid in two at whatever row is focused — the precise defect rejected on
   2026-08-03 ("making user decisions across the entire collection of items
   is difficult unless they are all in the same grid").
2. **Member navigation is 1-D.** `handleTypeCheckKey` moves the cursor
   `±1` for all four arrows. On a grid that means Down moves one cell
   right, which is the "the cursor went somewhere I did not point it" class
   of bug the spreadsheet model exists to prevent.

---

## 1. Decisions taken (AG, 2026-08-04)

| Question | Decision |
| --- | --- |
| Decision buttons in the cell | **Active cell only** — the cursor's cell shows its action cluster; inactive cells do not |
| Column count driver | **Per-type track minimum** — the `minmax()` floor varies by `SemanticTypeId` |
| People detail panel | **Side-by-side pane now** — land spec §6 step 1 with this change |

Everything below implements those three.

---

## 2. Layout

### 2.1 The grid

```css
.type-member-rows {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--type-track), 1fr));
  grid-auto-rows: var(--type-cell-height);
  gap: 0.3rem;
}
```

`auto-fill` + `minmax(floor, 1fr)` is the mechanism every other grid here
uses, and it is literally what Andrew asked for: it fits as many whole
tracks as the container allows and distributes the slack, so the same type
renders 2-up in a narrow window and 5-up in a wide one with no breakpoints
and no measurement. `.type-member-rows-compact` survives as a modifier on
the *cell*, not the container.

`grid-auto-rows` as a **fixed track** is not decoration — see §2.3. The
`.category-grid` precedent already sets a fixed `grid-auto-rows: 2.4rem`
for the same reason (uniform tracks that a cell can span an exact multiple
of).

### 2.2 Per-type track minimum

The types differ by more than an order of magnitude in label length —
`Information Technology Services` and `PDF` are in the same list today.
One global floor makes one of them wrong. A `--type-track` custom property
is set on the container from a table keyed by `SemanticTypeId`:

```ts
const TYPE_TRACK_MIN: Record<SemanticTypeId, string> = {
  people:            "20rem",  // full names, frequently three tokens
  emails:            "18rem",  // addresses do not wrap gracefully
  phones:            "14rem",
  organizations:     "20rem",  // "Communication Center", "Enrollment Systems"
  acronyms:          "14rem",  // "PERC", "FYI" — but see the expansion case
  identifiers:       "14rem",
  "dates-terms":     "16rem",
  "document-titles": "22rem",  // titles run longest
  other:             "18rem",  // heterogeneous by definition; the safe middle
};
```

(Keys are the exact `SemanticTypeId` union — note `"dates-terms"` and
`"document-titles"` are hyphenated; declaration order follows
`SEMANTIC_TYPE_ORDER` so the table reads in the order the cards render.)

```
```

**Why a table and not measurement.** A render-tail measurement of the
widest label (the `sizeCategoryCells` / `alignConfidenceColumns`
precedent) would adapt to the actual document, which is genuinely better in
principle. It was not chosen because the *worst* label sets the track for
all of them — one 40-character outlier in Acronyms (`Post Enrollment
Requisite Checking`) would collapse a 5-column grid to 2 for the 50 short
ones it sits beside. The declarative table is the calmer artifact: a floor
per type is a product judgment about that category, and it holds still
between documents.

**The values above are starting points, not measurements.** They should be
set against a real document in the browser before the pass is called done;
the table exists precisely so that tuning is a one-line edit per type.

**Cross-check the floor against §2.3** — the track minimum can never be
narrower than the reserved action band needs.

### 2.3 The cell, and the reflow problem "active cell only" creates

Showing controls only on the active cell is the highest-density option that
keeps one-click decisions, but it has one failure mode that must be
designed out rather than accepted: **if the cell grows when it becomes
active, every cell after it in the grid moves.** Moving the cursor would
then re-lay-out the collection under the reviewer's hand — worse than the
vertical jerk the side-by-side pane was built to eliminate, because it is
horizontal and happens on every arrow key.

**The fix is a reserved band that is never empty.** Every member cell has
the same two-band internal layout and therefore the same fixed height:

```
┌─────────────────────────────────────────┐
│ ☐  Information Technology Services  (1) │  ← identity band
│ [reserved band]                         │  ← always present, height fixed
└─────────────────────────────────────────┘
```

The reserved band's content is a function of cell state, and all three
states occupy exactly one button-row of height:

| Cell state | Reserved band holds |
| --- | --- |
| undecided, inactive | its suggestion chip (`① Institutional term`) or nothing |
| undecided, **active** | the action cluster — `Keep as-is · Change · Redact · Ignore` |
| decided | `✓ Keep` / `✓ Redact` / `✓ Covered by group` |

So the band is not dead space in the common case — it carries the chip that
the current design already renders inline, and the decision label the
current design already renders inline. It simply guarantees a fixed
occupancy so the grid cannot reflow. Motion is structurally impossible
rather than merely avoided, which is the same standard §1 of the selection
spec set for the pane.

**The active cell's chips move to the pane, not into a third band.** The
active cell would otherwise want chips *and* actions simultaneously, which
is two bands and a height change. This is the documented **ONE CONTROL,
ONE PLACE** rule (AG, 2026-08-03) applied verbatim: an expanded triage row
does not repeat its suggestion chips because the panel header renders the
same buttons from the same recommendation. Here the pane is showing the
active member, so the pane carries its chips.

**The action cluster must not wrap.** `.action-cluster` (built 2026-08-03
as a reusable utility) wraps `[K][C][R][I]` into a 2×2 block under
pressure — excellent behavior on a card, fatal here, because wrapping is a
height change. Two guards, both required:

1. Every `TYPE_TRACK_MIN` value must be ≥ the one-line width of the four
   buttons at their current labels. Measure once; if a type's desired
   floor is narrower than that, that type's floor is raised to it. This is
   the constraint that makes the table in §2.2 non-arbitrary.
2. The band declares `flex-wrap: nowrap` explicitly rather than inheriting.
   Should the labels ever lengthen, the failure is horizontal clipping in
   one cell, not a grid-wide reflow.

   ⚠️ **This override goes on the Type Check band, never on
   `.action-cluster` itself.** `ui-smoke.ts` asserts by regex that
   `.action-cluster` declares `flex-wrap: wrap` — that wrap *is* the
   utility's whole priority statement, and three other surfaces depend on
   it. Scope the `nowrap` to `.type-member-actions.action-cluster`, and
   note that doing so means Type Check adopts the cluster for its
   *content-yields-last* half (`.action-cluster-content` on the value) and
   deliberately opts out of the ladder. That is a legitimate composition,
   but it should be stated in the stylesheet where the override lives, or
   the next reader will read it as a mistake.

Applying `.action-cluster-content` to the value span keeps the *label* the
shrink victim of last resort with a working ellipsis, which is the
principle that block already states: known controls yield shape before
unknown content yields characters.

**The checkbox slot stays as-is.** `.type-member-check` is a fixed-width
slot present on decided rows too, so the value column aligns across mixed
lists (ui-smoke asserts both the class and its CSS — do not disturb).

### 2.4 Side-by-side pane

Reuse the geometry `.triage-split` and `.scope-split` already share:

```css
.type-split { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 0.75rem; align-items: start; }
@media (max-width: 1239.98px) { .type-split { grid-template-columns: minmax(0, 1fr); } }
```

Pane first in DOM order so reading order and visual order agree and the
stacked layout below the breakpoint puts the pane on top — the same
arrangement, and the same reasoning, as `.triage-split`.

The pane follows the member cursor and holds the active member's detail
panel — **for every type, not only People**. Today People is special-cased
because the panel is inline and would have made the other eight lists
unusably tall; in a column of its own that constraint is gone. The other
eight types keep compact *cells*; what changes is that their active member
now has somewhere to show evidence, which is a strict gain. If that proves
noisy in use, the per-type gate is one condition and can come back.

With no member cursor set, the pane shows the type-level summary
(`appendCandidateReduction` over `remaining`, plus the bulk bar's scope) —
it must never be empty, or the 40% column reads as broken.

**Not in scope:** spec §1's selection-mode pane swap ("12 selected" +
global application buttons). That is the design bet the spec deliberately
sequenced last, and it should be judged after this layout is in hand.
This plan makes it cheap to add; it does not add it.

**Known duplication, flagged not fixed:** `.type-split` will be the *third*
copy of this geometry. The right end state is one `.focus-split` utility
the three compose from. It is not done here because `ui-smoke.ts` asserts
the exact literal text of both existing declarations (lines ~202-206 and
~527-528), and rewriting a suite expectation in the same pass that changes
the behavior it guards is how a regression gets ratified. Recorded as
follow-up debt with a named cost, per the documentation standard.

---

## 3. Keyboard

### 3.1 The grammar, stated

Inside an opened type, with a member cursor set:

| Key | Behavior | Consistent with |
| --- | --- | --- |
| `←` / `→` | ±1 in member order, clamped | `moveWithinResultsGrid` |
| `↑` / `↓` | ± measured column count, clamped | `moveWithinResultsGrid` |
| `↑` from the **first row** | back out to card level | today's "Up past the first backs out" (.16) |
| `←` at index 0 | back out to card level | today's behavior, preserved |
| `Esc` | back out to card level | unchanged |
| `Tab` | cursor stands down, keymap moves to next type | unchanged |
| `K` `C` `R` `I` | act on the cursor member | unchanged |
| digits | accept the cursor member's suggestion | unchanged |

Three points deserve their reasoning on the record.

**Member order *is* visual reading order, so nothing about auto-advance
changes.** `summary.candidateIds` is the render order, and an auto-fill
grid fills row-major. Therefore index *n+1* is the cell to the right,
wrapping to the start of the next row — exactly the assumption
`moveWithinResultsGrid` already makes for `.triage-grid`.
`nextUnresolvedTypeMember()` and `decideTypeMemberAndAdvance()` are
correct as written and are not touched.

**"Up backs out" must generalize from index 0 to the first row.** Today
the escape hatch is `!forward && idx === 0`. Under a grid that strands
cells 1..cols-1 — the reviewer on the second cell of row one presses Up and
nothing happens, with no indication that Up is the way out. New rule:
`idx - cols < 0` backs out. This is the 2-D reading of the same sentence,
not a new behavior.

**`↓` at the last row clamps; it does not enter the pane.** This is the one
place Type Check will *not* match the sectioned queue, where Down was
deliberately repurposed to hand DOM focus into the detail panel (AG,
2026-08-02: "the nav needs to allow down arrow to enter the actual focus
area"). It is not carried over because the situations differ: on the queue
the row *is* the focused item and the panel is a level deeper, whereas here
the reviewer is already inside the type and the pane follows the cursor
automatically — there is no second level for Down to enter. Flagged
explicitly rather than assumed; if Down-into-the-pane proves wanted for
People's occurrence evidence, it is an additive branch.

### 3.2 The shared-geometry refactor

Two small extractions, so the two surfaces cannot drift:

**(a) `gridStep()` — the movement math, made pure.**

```ts
function gridStep(idx: number, count: number, cols: number, key: string): number | null
```

Lifted verbatim out of `moveWithinResultsGrid`, which then calls it. Type
Check's member mover calls the same function. One definition of "what an
arrow key means on a grid", testable without a DOM.

**(b) `measuredColumnCount()` takes an anchor *element*, not an id.**

The current signature takes `anchorId` and resolves it through
`gridContainerForItem()`, which looks up `[data-item-id="…"]` and calls
`.closest(".triage-grid, .results-grid")`. Neither applies to a member
cell: members are keyed `data-type-member-id` (the type card owns
`data-item-id`), so a naive reuse would resolve the anchor to the **type
card** and measure the wrong grid.

Change the parameter to `anchorEl: HTMLElement | null`. `moveWithinResultsGrid`
keeps calling `gridContainerForItem()` and passes the result; Type Check
resolves `[data-type-member-id]`→`.closest(".type-member-rows")` itself.
No selector-string surgery, callers keep owning their own selectors, and
`columnsAcross()` stays the single geometry definition. The global fallback
(and the verify harness's fake DOM, which implements neither `closest` nor
layout) is unaffected.

This also discharges the constraint the selection spec listed in its §7:
*"`measuredColumnCount` needs a cursor anchor on any grid whose column
count can differ per section."* With the pane taking 40%, the member grid
is narrower than the type-card grid above it — two grids, two column
counts, on one page.

**Domain boundary:** all of this stays in the UI layer.
`FocusNavigator`/`keymap.ts` never learn about column counts —
`measuredColumnCount`'s own doc comment records that 2-D movement depends
on rendered viewport width and "must never" enter the domain. The member
cursor is presentation state (`typeCheckCursor`) and stays that way.

### 3.3 Out of scope, but noticed

**The type *card* grid is navigated linearly.** `.type-cards` has been an
auto-fill grid since Phase 2, but `keymap.ts`'s `type-check` branch
resolves `↑`/`←` to `moveItem previous` and `→` to `moveItem next` — so
`↑` on the card in column 4 of row 2 goes to column 3 of row 2, not to
row 1. (`↓` is taken by "enter the members", correctly and deliberately.)

This is a pre-existing inconsistency of exactly the kind Andrew is asking
to remove, on the same stage, and it is *not* addressed here — the
instruction named the member list, and folding a keymap change into a
layout pass would mix two risk profiles in one diff. Recorded so the choice
is visible: it is a small follow-on (`↑` = `-cols` when the anchor grid is
`.type-cards`), and it wants a decision about what `↑` from row one does,
since Escape already owns "leave the stage".

---

## 4. Build order

1. **Extract `gridStep()`; re-point `measuredColumnCount()` at an anchor
   element.** Pure refactor, zero behavior change, full suite green before
   anything visual moves.
2. **`.type-split` + move the People panel into the pane.** Layout only,
   member list still a stacked column. Verifiable on its own: the panel
   stops cutting the list.
3. **The grid + the reserved-band cell.** `TYPE_TRACK_MIN`, fixed
   `grid-auto-rows`, action cluster on the active cell, chips to the pane.
4. **Grid arrow keys** (§3.1) — last, so the geometry it measures is
   already the geometry that ships.

Steps 1, 2 and 4 are extensions of landed patterns. Step 3 is the only one
carrying genuine design risk, and it is isolated.

---

## 5. Verification

**Must stay green, unweakened:**

- `ui-smoke.ts` `.type-member-check` assertions (class + CSS) — the
  fixed-width slot is unchanged by this plan.
- `ui-smoke.ts` `[data-type-member-id]` scroll-into-view assertion and the
  `.item-row, .type-member-row { scroll-margin-top: … }` rule — grid
  membership does not change either, but row-wise scrolling should be
  re-checked live once cells are 2-up.
- `ui-smoke.ts` `.triage-grid` / `.triage-split` / `.scope-split` literal
  assertions — untouched by construction (§2.4).
- `ui-smoke.ts` `.action-cluster` assertions — this plan *adds* a consumer;
  it must not alter the utility. Specifically the regex requiring
  `flex-wrap: wrap` + `justify-content: flex-end` + `flex-shrink: 100` on
  `.action-cluster`, and the one requiring `.action-cluster` to have **no**
  `min-width: 0` while `.action-cluster-content` does. See §2.3's warning.
- `ui-smoke.ts` member-cursor scroll-target assertion — it pins the exact
  source line `const memberId = typeCheckCursor?.candidateId;`. The cursor
  model is unchanged by this plan, so this should not move; if a refactor
  makes it move, the scroll behavior needs re-verifying live at 2-up.
- `semantic-types-verification.ts`, `decision-reduction-verification.ts`,
  `review-scope-verification.ts` — no domain change is proposed, so any
  movement here means the domain boundary leaked.

**New assertions to add:**

- `.type-member-rows` declares `display: grid` with an `auto-fill` track.
- `gridStep()` is called by both movers (source assertion, the pattern
  ui-smoke already uses for shared-utility adoption).
- A pure unit check of `gridStep` at the four edges: first row up, last row
  down, index 0 left, last index right.

**Cannot be suite-verified — requires live browser:**

- That the reserved band actually prevents reflow at every viewport width
  (the whole premise of §2.3).
- That `TYPE_TRACK_MIN` values produce sensible column counts on a real
  document — these are estimates, not measurements.
- That the action cluster never wraps inside a cell at the narrowest
  rendered track.
- Column-count measurement against the *narrowed* member grid beside the
  pane.

Per repo practice the findings report separates these two lists.

---

## 6. Judgment calls, stated for the record

1. **Reserved band rather than accepting reflow.** "Active cell only" is
   only viable if the cell's height is state-independent; the alternative
   (let the active cell grow) reflows the collection on every arrow key.
   Reviewer impact if wrong: one line of vertical space per cell that a
   decided item does not strictly need.
2. **Per-type table over measured tracks.** Adapts less; holds still more.
   The outlier-sets-the-track failure of measurement is the deciding
   factor. Revisit if real documents show the table is consistently wrong
   for one type.
3. **Pane for all nine types, not just People.** Removes a special case
   whose original justification (inline panel makes long lists unusable)
   no longer applies once the panel is in its own column. Reversible with
   one condition.
4. **`↓` clamps rather than entering the pane.** Divergence from the
   sectioned queue, reasoned in §3.1. Most likely of these four to be
   revised in use.
5. **`←` at index 0 backs out** rather than clamping like the Results grid.
   Preserves today's Type Check behavior exactly; the alternative is a
   silent regression in a key that already works.
6. **Third copy of the split geometry accepted**, with the consolidation
   named as debt rather than done mid-pass (§2.4).
