# Review Workspace — session handoff (2026-08-06)

**Read this first if you are picking up DocScrub-Web review-surface work.**
Everything below shipped on 2026-08-06 unless marked OPEN. `tsc` clean,
44/44 suites, ui-smoke at 149 checks.

---

## 0. The one process change that matters most

**A browser is now connected** (Claude-in-Chrome MCP against
`http://localhost:8000`, session shared via localStorage). Use it.

This session produced three separate wrong turns — a fixed-height focus
panel, a drawn zone band, and a whitespace separator — all of which passed
every suite and were visibly broken on screen. `verify/ui-smoke.ts` reads
**source text**: it can confirm a CSS rule exists and cannot see that it
renders wrong. That is a structural blind spot, not a gap in diligence.

The working loop, which produced everything good in the back half of the
session:

1. Inject a trial `<style>` + a MutationObserver into the live page.
2. Screenshot, let Andrew react, iterate — **nothing on disk yet**.
3. Only once he is happy, write to `index.html`/`app.ts`.
4. Reload and verify against the real DOM (measure, drive keys, assert).

Driving keys works: `document.dispatchEvent(new KeyboardEvent('keydown',
{key, altKey, shiftKey, bubbles:true, cancelable:true}))`. Two bugs this
session were found only that way.

---

## 1. Shipped — layout

**Zone grid.** Fixed `minmax(0, 34rem)` track (NOT auto-fill — "we don't
have to resize horizontally"). 1–14 items = one column; 15+ = two columns
with `grid-auto-flow: column` so 23 reads 12 down + 11 down, not
interleaved pairs. `ZONE_TWO_COLUMN_THRESHOLD = 15`. Shape comes from
`children.length` — **counted, not measured**.

**Row banding** `#f9fafc`. Deliberately NOT `--surface-muted`: that token
*is* the page background, so a banded cell read as a hole in the page.
White and the page are only nine units apart; the band has to be
distinguishable from both inside that gap.

**Section snap.** Crossing INTO a new section scrolls its heading to the
top (`block: "start"`); moving within a section keeps the least-motion
`block: "nearest"` row scroll. Snapping on every move would be jumpy —
arrival is a change of context, movement is not. `lastSnappedSectionId`
tracks it. Verified: heading lands at 236px against a 230px chrome.

**Sticky section pills.** Title + subdued `(N)` remaining count, in the
sticky chrome so `--workspace-chrome-height` measures them automatically
(230 → 273px) and the snap margin self-corrects. Finished sections mute.
A display, not a focusable region.

---

## 2. Shipped — keyboard grammar (CHANGED; read before touching keys)

The hierarchy, now explicit — **modifier strength maps to unit size**:

| Keys | Moves |
|---|---|
| `←→↑↓` | cells, within the current grid |
| `⌥←→` | sections |
| `⇧←→` | stages |

- **Arrows are pure movement.** The 2026-08-02 "DOWN ENTERS" rule is
  RETIRED. It was spatially true when the panel rendered below its row; the
  side-by-side pane moved the panel beside the list and the metaphor went
  with it.
- **Enter enters** the focus panel (falls through to the global `enterItem`
  rather than a second copy). Accept still wins when there is something to
  accept — that is the queue's core action.
- **Esc is the single exit.** "Up past the first control exits" was removed;
  it only existed to mirror ↓-enters.
- **Space selects** the focused cell's checkbox; **D** toggles details.
- **Tab keeps one meaning everywhere** — next item, including from inside
  the panel. Do not spend it; that single meaning is rare and valuable.

**`gridStep` is flow-aware.** Under column-major it inverts: `+1 = down`,
`+rows = right`. The flow is **told**, not measured —
`measuredColumnCount()` counts cells sharing the first cell's `offsetTop`
*in DOM order*, which returns 1 under column-major, so every horizontal
move would silently no-op. `columnMajorRowsOf()` reads the published class
+ custom property.

**⌥ is only partly free.** `⌥↑↓←→` is Filters in Item Check's By Category
view; `⌥K/C/R/N` is the group-scope chord. `handleSectionArrowKey` declines
unless `sectionedQueueStage()` returns a stage (null in By Category), so
they are mutually exclusive **by view, not by luck**. A future ⌥ binding
must check that guard.

---

## 3. Shipped — Review Zone (bulk-action bound)

`ZONE_CAPACITY = 24`, a hard constant. Design record:
`20260806-review-zone-design.md`. **This is a product stance, not a safety
hack** — a future reader will find a bulk action refusing an obviously
coverable set and want to lift the bound. Don't; §11 of that doc records
the agreed way it comes off (a confirmation naming the population, on
evidence of user demand).

- 24 is a rectangle at 2/3/4/6/8/12 columns — the bottom edge must be
  visible.
- Bound lands in `headingActionScope()`, the one function both the painted
  buttons and the numbered digits read.
- Skipped items roll forward → **no new persistence at all**.
- Explicit selection stays **unbounded**: check 150 boxes and you can still
  do 150. That *is* the review, and it means the escape hatch never has to
  be built.
- Labels name the blast radius: `Accept Next 24`, `… (24)`.

---

## 4. Shipped — other

- Header: command bar as a 4-row grid (Decide/Move/Scope/App); status strip
  aligned by shared row heights; Decision Tracker centred title + permanent
  Time Avoided.
- `metrics/percentDisplay.ts`: `~100%` / `~0%` where rounding would assert
  an endpoint it hasn't reached (Andrew's `1/223` case). Resting figures
  mute. **Grey means "no data", and `~0%` is what keeps that unambiguous.**
- Hamburger replaces the gear; duplicate header Admin button removed.
  Inactive menu items stay visible to everyone — deliberate, as a roadmap.
- Suggestion chips removed from sectioned-queue cards (they're in the panel).
- `decideThroughOwningCursor()` — auto-advance ladder, TACTICAL PATCH.
  See §5.
- **Bug fixed:** `⇧←→` died after clicking any row. A blanket
  `tag === "input"` guard refused on the row's **checkbox**. Caret ownership
  is what that guard protects and a checkbox owns no caret — narrowed via
  `isTextEntryElement()`. My Space-selects change had made a latent bug
  reliably reachable.

---

## 4a. Shipped — session 2 (2026-08-06, later)

- **`Infinity–9` FIXED.** The guard was on `scopeActions.length`; the
  segment advertises DIGITS, so it is now gated on `digits.length`.
  Reproduced live first (every Ambiguity section is chorded-only, so the
  whole surface showed it — wider than "one screen"), then fixed.
- **The `>24` overflow band RESTORED**, and the first attempt's failure
  finally diagnosed rather than guessed: both grids were
  `repeat(auto-fill, minmax(14rem, 1fr))` and each chose its own column
  count from its own width — 2 in the split, 4 at section width. Now the
  count is counted (`cells.length >= 15`) and the track is a MAX
  (`minmax(0, 34rem)`, columns shrink rather than reflow), so the band is
  2×12 wherever it is put. Verified stable at 24 cells / 12 rows / 610px
  across seven moves in all four directions.
- **The remainder is COLLAPSED**, which §4a of the design record did not
  specify. It said "below a gap at full width" — written before anyone
  measured it. On Likely People the remainder is 253 cells = 6,021px, so
  an open remainder leaves the scroll the band exists to end.
- **Only the focused category renders**, per Andrew's directive. A RENDER
  filter; `sections` is untouched, so nav, the advance ladder and zone
  membership are unaffected. Verified: completing Temporal advanced into
  Common English Words and the render swapped.
- **Pills take the completion vocabulary** — green + `✓` replacing the
  count. The `.section-pill-done` grey rationale is retired at the site.

Page height on Likely People, across the three changes:
**18,018px → 8,933px → 1,762px (2.1 screens).**

## 4b. Shipped — the two axes became peers

Andrew asked why "Possible acronym" did not appear under "Acronyms". It
cannot: a row section holds CANDIDATES keyed by recommendation archetype, a
kind group holds RELATIONSHIP PROPOSALS keyed by `RelationshipKind`, and a
proposal has two sides plus its own decision vocabulary. The shared word
names two different objects. **His question is good evidence the screen was
not communicating that.**

Resolved by making them PEERS rather than merging — `stageCategories()` is
one map over two renderers:

- the pill bar spans both axes; kind groups get pills and counts (in CARDS,
  the review unit on that axis);
- `⌥←→` walks both, handing the cursor between `structuralCardFocusPending`
  and the item cursor at the seam — verified in both directions;
- exactly one category renders whichever axis it is on
  (`renderStructuralRelationships` gained an `onlyKind` filter).

Deliberately NOT merged into one `candidateIds`-shaped list: that would be
the coercion the first paragraph says is wrong.

**Ambiguity labels shortened** to Andrew's list, as AMBIGUITY-ONLY
overrides — five of them are inherited from `TRIAGE_SECTION_LABELS` and
shortening at the source would have renamed Item Check too. Both facts are
now asserted in `triage-queue-verification.ts`.

## 5. OPEN — in rough priority order

1. **Finished categories VANISH from the pill bar on Item Check**, so they
   can never go green there. Not a bug in the pills — `visibleItemCheckIds`
   excludes decided items, so a finished category has no ids, produces no
   section, and leaves the model. That is the deliberate "Item Check shows
   remaining work" stance, and it now collides with two things: the pill bar
   is the stage's ONLY map once siblings are hidden, and Andrew asked for
   completion feedback that surface cannot give. Works correctly on
   Ambiguity Check (verified: Nicknames and Temporal both green with ✓).
   **This is a product question, not a fix to make quietly** — changing
   `visibleItemCheckIds` changes what Item Check is.

2. **Group Check adopts this UX** (Andrew's directive, verbatim): "There is
   no reason that Group Check cannot adopt the same UX as Ambiguity and
   Type. Simply put the expanded items, basically as-is, into the blue focus
   area. That allows for removal of the KCRIF buttons from each cell."
   A *relocation, not a redesign*. His own open question: longer text, fewer
   items — maybe one column. Note `ZONE_CAPACITY` is currently global; a
   per-surface capacity would be the first, so raise it rather than quietly
   parameterising.

3. **Extract the advance ladder.** `decideThroughOwningCursor()` is a patch.
   Advance-on-decide is still a per-call-site choice across four helpers
   (`decideAndAdvance`, `decideTypeMemberAndAdvance`,
   `decideGroupMemberAndAdvance`, `dispatchReviewWithVisibleAdvance`). Any
   new decision path that doesn't route through the ladder reintroduces the
   "completing a cell doesn't auto-advance" bug — which has now regressed
   three times.

4. **The artifact axis is unbounded** — and the reason the design record
   gives for leaving it that way is STALE. §12 says a kind group cannot be
   bounded because "the zone size is derived from the **item** grid's
   measured columns," so bounding an artifact group by an item grid's width
   "would be incoherent." That was true of the pre-§1a measured zone. It has
   not been true since: `ZONE_CAPACITY` is a constant, and
   `review-zone-verification.ts` asserts *"capacity takes no arguments —
   nothing measured feeds it."* There is no item-grid width in the
   derivation any more.

   The artifact-vs-item axis distinction still stands on its own merits, so
   this is not "therefore bound it." But the objection that closed the
   question is gone, and the question is open on its actual merits.

   It also **collides with item 2**: Group Check adopting this UX is the
   first caller that wants a per-surface capacity, and kind groups would be
   the second. Deciding them independently is how you get two answers to one
   question.

   NOW EASIER TO ACT ON: as of §4b the kind groups are peer categories with
   their own pills and their own place in `⌥←→`, so "bound the artifact
   axis" no longer needs a home invented for it — it needs a capacity and a
   label, exactly like a row section.

5. **"Acronyms (1)" and "Possible acronym (3)" now sit adjacent in one
   pill bar.** Two pills, near-identical names, different axes — the exact
   confusion that prompted Andrew's question, now compressed into 30px of
   each other. The `Possible …` prefix is the only thing distinguishing
   them, and it was chosen for a heading, not for a pill. Options: a visual
   marker on relationship pills, a separator in the bar, or shorter kind
   labels ("Acronym pairs"). **Unruled — raise it before picking one.**

6. **`~0%` beside `86% FEWER`** in the Decision Tracker reads oddly at low
   decision counts. The rule is right; the pairing may want thought.

7. **`.scope-split` is 3fr/2fr with the inspector first** — the one-item
   panel gets 767px and the whole queue gets 511px (measured). Pre-existing.
   Measured this session and it is **not** the overflow it looks like:
   `minmax(0, 34rem)` is a MAX, so the band's two columns shrink to 247px
   each rather than overflowing. Cosmetic, not structural — but 247px cells
   beside a 767px panel holding one item is still the wrong ratio, and now
   that the remainder is collapsed the queue column is the only place
   density matters. Worth a look with fresh eyes.

---

## 6. Working with Andrew

- He thinks aloud; not every idea discussed is a decision. When in doubt,
  ask or treat it as exploration.
- He wants an engineering collaborator, not an assistant. **Push back with
  reasoning** — he overruled me correctly at least twice today (the stuck
  zone; the 24-item cap) and I overruled him with data once (a
  content-derived panel height is impossible: occurrences per candidate are
  median 2, p90 11, **max 741**).
- Distinguish objective defects / architectural concerns / stylistic
  preference / future enhancements. Those are different categories.
- Decisions get recorded **in the code**, at the site, with the reasoning
  and the rejected alternatives. That convention is why this file is short.
