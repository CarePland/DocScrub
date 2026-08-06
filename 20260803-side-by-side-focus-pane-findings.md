# Side-by-Side Focus Pane — Implementation Findings

**Date:** 2026-08-03
**Surface:** `renderSectionedQueue` — the sectioned queue shared by **Item
Check (By Category)** and **Ambiguity Check**.
**Instruction (AG):** *"side-by-side makes a huge amount of sense. The
detail panel doesn't need the full screen width. Once the editing in a
section is complete, it reverts to standard grid. I suggest more than 50%
for the focus panel for width. Maybe 60% or 2/3. Something that comfortably
allows two columns of items to the right of it, with responsiveness
behaving as it currently does to easily allow shifting to one column. So,
that is, don't mess up the responsiveness — it's behaving admirably!"*

---

## 1. What changed

### The problem being solved

The detail panel was a full-width grid child (`.triage-expanded {
grid-column: 1 / -1 }`) inserted directly beneath its own row. That
**split the section's grid in two** at whatever row happened to be
focused, and re-cut it at a different row on every focus move. Andrew's
diagnosis: *"making user decisions across the entire collection of items is
difficult unless they are all in the same grid."*

### The change

The panel moves out of the grid flow into a column beside it:

```
.triage-split                     (grid, 3fr / 2fr)
├── .triage-focus-pane            60% — the open detail panel(s)
└── .triage-grid                  40% — the unbroken item grid, two columns
```

Neither region can push the other, so **both are spatially stable** —
which is what neither panel-above-grid nor panel-below-grid could offer.
An item cell is the *same width it was before* (~238px at a 1300px window);
there are simply fewer per row.

### Files touched

| File | Change |
| --- | --- |
| `src/ui/app.ts` — `renderSectionedQueue` | Panels collected into `focusPanels[]`, emitted into `.triage-focus-pane` instead of appended into the grid |
| `src/ui/app.ts` — `measuredColumnCount` | New optional `anchorId`; factored out `columnsAcross` + `gridContainerForItem` |
| `src/ui/app.ts` — `moveWithinResultsGrid` | Passes the cursor id as the measurement anchor; stale invariant comment corrected |
| `index.html` | `.triage-split`, `.triage-focus-pane`, breakpoint; `.triage-expanded` no longer spans the grid |
| `verify/ui-smoke.ts` | 7 new structural source checks |

**`.triage-grid`'s own rule is byte-for-byte unchanged.**

---

## 2. Judgment calls

### 2.1 60/40, not 2/3 — the two-column requirement is the binding constraint

Andrew offered "60% or 2/3." These are not interchangeable here, because
the *second* requirement ("comfortably allows two columns") sets a floor
under the item column.

Two 14rem tracks + gutter = **452px**. Content width ≈ viewport − ~110px
(page padding 2rem×2, stage padding 1rem×2, split gap).

| Viewport | Item col @ 1/3 | Item col @ 2/5 |
| --- | --- | --- |
| 1300px | ~397px → **1 column** | ~476px → **2 columns** |
| 1440px | ~443px → **1 column** | ~532px → **2 columns** |
| 1800px | ~563px → 2 columns | ~676px → 2 columns |

2/3 does not clear the bar until ~1470px. **60/40 is the widest panel that
still delivers two columns at ordinary laptop widths**, so the two stated
constraints resolve to 60/40. Flagging explicitly because the instruction
named 2/3 as an option and this rejects it on measurement rather than
taste — trivially reversible (`3fr`→`2fr`, `2fr`→`1fr`) if the panel
proves too cramped in real use and one item column is acceptable.

### 2.2 Stacking breakpoint at 1240px, not the repo's existing 1199.98px

`.review-workbench` stacks at 1199.98px, and consistency argued for
reusing it. Rejected: solving the two-column bar for the viewport gives
**~1240px**, and between 1200–1240 a 1199.98 breakpoint would produce a
one-column strip of items beside a panel — the split still paying its
layout cost while no longer preserving anything. Below 1240 the regions
stack and the grid gets the full width back. Approximate by construction
(chrome heights wrap); the failure mode either side is one column of
items, not a broken layout.

### 2.3 Pane first in the DOM

The pane renders on the left, so DOM order = visual order and no CSS
reordering is needed — avoiding the tab-order/visual-order divergence that
`order`/`grid-column` placement would introduce. It also means the stacked
layout needs no extra rule: the pane lands on top, which is the right way
round for a keyboard-driven surface (fixed workspace, moving map).

**Consequence to watch in live use:** Tab from a row now reaches the panel
by traversing the remaining rows first, where previously the panel sat
immediately after its own row in DOM order. Arrow/letter navigation is
unaffected (it dispatches `selectItem` and moves DOM focus explicitly).
Listed as a pending-validation item rather than pre-emptively "fixed,"
because the fix would be exactly the visual/DOM divergence just rejected.

### 2.4 Two open panels are preserved, not collapsed to one

A grid can legitimately hold two open panels — the focused row plus a row
held open by Space/chevron (`triageExpandedId`). A single-slot pane would
have silently dropped documented behavior. Both panels land in the pane,
in row order, separated by a gap. Per the Documentation Standard: a
documented behavior that becomes awkward is *identified*, not silently
changed. **Question for Andrew:** stacked panels in a 60%-wide column may
read as clutter; if Space-to-hold-open has not earned its keep, retiring
it is a cleaner answer than accommodating it — but that is a product
decision, not an implementation one.

### 2.5 Column measurement is now cursor-scoped (a latent correctness fix)

`measuredColumnCount` measured the **first** matching grid on the page.
The prior code recorded why that was safe: *"Triage's sections are separate
grids sharing one column template, so one measurement holds."* **This
change retires that invariant** — the section with an open panel wraps at
two columns while its neighbours are still full-width at five. Left alone,
Arrow Down/Up in the active section would have jumped by the *inactive*
sections' column count, i.e. skipped rows: exactly the "the cursor went
somewhere I did not point it" failure the spreadsheet model exists to
prevent.

Measurement is now scoped to the grid containing the focused cell, via the
RX-01 `data-item-id` lookup contract, falling back to the page-wide
measurement when the anchor cannot be resolved (no cursor, or the verify
harness's fake DOM). **This is strictly more correct than the old behavior
even in the old layout** — nothing ever guaranteed the first grid was the
cursor's grid; it simply could not be observed while every grid was
identical.

### 2.6 Not done: sticky pane

A pane that stays in view while the grid scrolls is the natural next step,
but it interacts with `--workspace-chrome-height` and misbehaves when the
panel is taller than the viewport. Deliberately out of scope; `align-items:
start` already pins the pane to the top of its column. Raise if scrolling
past a long section feels wrong.

---

## 3. Verification

### Suite-verified

- `npx tsc --noEmit` — clean.
- `npm run build` — clean (full emit; the browser serves `dist/`).
- **44 of 44 `verify/*.ts` suites pass** (count taken from
  `ls verify/*.ts | wc -l`, not remembered). Zero regressions; no suite
  expectation weakened.
- 7 new `verify/ui-smoke.ts` structural checks, all passing — pinning the
  invariants that would regress *silently*: the panel is never appended
  into the grid flow; pane precedes grid in DOM order; a panel-less grid
  still renders bare and full-width; the 3fr/2fr share; the 1239.98px
  breakpoint; **`.triage-grid`'s auto-fill track is unchanged**; and Up/Down
  measure the cursor's own grid.

These are source/markup assertions by necessity — the layout is geometry,
and the verify harness's fake DOM implements neither `offsetTop` nor CSS.
What they pin is the markup contract the geometry rests on.

### Pending live-browser validation

1. **The 60/40 split reads correctly at Andrew's actual window width** —
   panel comfortable, two item columns present.
2. **The 1240px stacking transition** — that the band just above it is not
   visibly cramped and the stack below it is calm.
3. **Grid stability across focus moves within a section** — the central
   claim. Moving the cursor should leave the item grid *completely still*.
4. **Arrow Up/Down step by two rows, not five**, in the active section
   while other sections are full-width (§2.5).
5. **Section-to-section transition** — the active section narrows to 40%
   while completed sections are full-width. Believed informative (the
   working section visibly opens a workspace) but unverified as *calm*.
6. **Tab order from a row into the panel** (§2.3).
7. **Two simultaneously-open panels** — focused row plus a Space-held row
   (§2.4).
8. **`scrollFocusedRowIntoView`** still targets `[data-item-id]` in the
   narrower column; unchanged in code, but the scroll geometry is new.

### Not verified anywhere

Real rendered pixel widths. The measurements in §2.1–2.2 are computed from
the stylesheet (body padding 1.75rem/2rem, `.stage-body` 1rem, root
16px ⇒ 14rem = 224px), not measured in a browser — this environment has no
headless browser (devDependencies are `typescript` only, no registry
access). If the two-column claim fails at Andrew's width, §2.1's table is
where the arithmetic is wrong, and the fix is the track minimum or the
share, not the structure.
