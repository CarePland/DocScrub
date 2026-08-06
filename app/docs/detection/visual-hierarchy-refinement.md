# Visual Hierarchy Refinement (2026-08-01, v2026-08-01.01)

Spec: Andrew's side-by-side screenshot review (chat, 2026-08-01) comparing
the current build against the Python reference — six numbered lessons plus
a closing principle: "a visual hierarchy that makes the review items clear
but pulls additional details into the background... [section titles] can be
either different or less visually dominant than the actual items to
review."

Two points were clarified by direct question before implementation:

- **"needs attention" pill** ("not good" in both builds): Andrew's answer
  was "figure out better placement." Resolution: the words survive but move
  out of the title line into the confidence column, stacked under the % in
  the same slot "was x%" already uses (`.attention-note`, rendered inside
  `renderConfidenceBadge`). The signal keeps its vocabulary and its amber
  hue; it no longer breaks the name's prominence or the % column's vertical
  scan line.
- **Always-visible justification** (Andrew flagged he may have changed his
  mind): chose "Auto-open Why? on focus" — structure unchanged, the focused
  item's Why? `<details>` defaults open. A reviewer who explicitly closes
  it stays closed *for that candidate* across background autosave renders
  (new `closedDetailsKeys` companion to `openDetailsKeys` in `detailsEl`,
  which now takes a `defaultOpen` parameter); the next candidate's Why?
  opens fresh under its own key.

## What changed

1. **Primary text large, counts de-emphasized — every cell type.**
   `.result-cell-name` 1.05rem / count 0.78rem muted; `.category-cell-label`
   0.98rem / count 0.8rem; `.group-row-label` 1.12rem; `.member-name` 1rem;
   `.detail-title-name` 1.3rem / count 0.82rem; `.triage-token` 1rem.
   Counts and metadata split into dedicated spans (`.row-count`,
   `.item-row-title`/`.item-row-meta`) where they previously shared the
   name's text node — display-only; search haystacks, decision vocabulary,
   and RX-22 display-label mapping untouched.
2. **Buttons: same font, much less padding.** Global `button` padding
   0.38/0.7rem → 0.24/0.55rem, reverting the visual-weight pass's padding
   increase while keeping its 600 weight.
3. **Confidence column.** `.confidence-plain` 0.92rem → 1.08rem, right-
   aligned within itself, parent and member figures the SAME size ("the
   child record %s would be same size but directly underneath"). True
   vertical alignment is a render-tail measurement
   (`alignConfidenceColumns`): per group cell, the member figure's right
   edge is pushed left via margin-right to meet the parent figure's
   measured right edge.
4. **Category cells.** Light-tinted rectangles (`--pill-bg`, warm-greige
   family to match the .23 canvas trial) replacing white 999px pills;
   min column 15rem → 16.5rem (fewer wrapped labels); fixed
   `grid-auto-rows: 2.4rem` with a render-tail pass (`sizeCategoryCells`)
   granting wrapped labels `grid-row: span 2` — a two-line cell occupies
   exactly two tracks, so the grid stays unbroken with generous padding.
5. **FILTER placement.** `.category-header-row` is a 1fr/1fr grid — the
   FILTER group anchors at the horizontal midline (the Python reference's
   near-center placement), stacking below 900px.
6. **Section titles recede.** "Results" and the triage section titles take
   the small-caps muted label treatment the other section labels already
   used. (The triage half was superseded the same day by v2026-08-01.02's
   category-first pass, which deliberately re-emphasizes triage headings —
   see design-notes.md; the Results treatment and the principle stand.)
7. **Redaction Rules, Python layout** (`renderRedactionRulesPanel`
   rebuilt). Simple mode per type: bold humanized type name, **Apply to
   all / Sequential** radios, always-visible labelled **Replacement Text**
   input (prefilled from the engine's own `genericPlaceholder`, now
   additively exported), inline **Preview:** of the resulting placeholder,
   italic **autosaves** note. An **Advanced** checkbox (first element in
   the panel body) swaps in the pre-revision raw strategy select +
   `{n}`-template input — the full engine vocabulary remains reachable.

## Judgment calls (underspecified points, per the documentation standard)

- **Sequential mapping**: simple-mode Sequential commits
  `{strategy:"custom", customTemplate: withNumberingToken(text)}` —
  "[REDACTED ID]" → "[REDACTED ID {n}]" → "[REDACTED ID 001]", matching
  Andrew's "[ID 3], [ID 7]" example — rather than the engine's plain
  `"sequential"` strategy (`[TYPE 001]`, which ignores the text and would
  make the input and the preview disagree, as Python's own panel did).
  Alternatives: plain sequential (rejected: input/preview mismatch);
  engine change (rejected: no engine change needed). Plain sequential
  remains selectable under Advanced. Roundtrip is clean: templates with
  `{n}` read back as Sequential with the token stripped for display.
- **Apply to all with the default text stays `generic`** — no config churn
  for the untouched case; any other text commits a fixed custom template.
- **Advanced checkbox placement**: inside the panel body, not beside the
  `<summary>` title as in the Python screenshot — a checkbox inside
  `<summary>` fights the disclosure toggle's click. Small, disclosed
  deviation.
- **Alignment scope**: `alignConfidenceColumns` applies only positive
  deltas. Fix this (Not Quite) member rows carry MORE right-side controls
  than their parent row; forcing alignment there would wedge a dead gap
  between their % and their buttons, so those rows keep their natural
  position. Cross-row alignment of top-level group rows relies on their
  identical button groups, as before; a row mid-"n selected" relabel can
  drift a few px while the selection is narrowed.
- **Attention note requires a rendered %**: the note now lives inside the
  confidence element. `groupNeedsAttention`/`memberNeedsAttention` are
  only true for undecided/mixed states, which always render a %, so no
  signal is lost — verified by reading both predicates, not assumed.
- **`attentionPill()` removed** (both call sites migrated); the
  `.attention-pill` CSS class is gone with it.

## Verification

- `npx tsc --noEmit` clean; full `npm run build` (dist emitted — the
  browser serves dist/).
- All **33** `verify/*.ts` suites pass (counted via `ls verify/*.ts`,
  run with `--experimental-strip-types --experimental-loader
  ./verify/ts-loader.mjs`), zero regressions. No suite exercises these
  UI-layer changes beyond ui-smoke's structural checks; no suite
  expectations were touched.
- NOTE: a concurrent session landed v2026-07-30.23 (canvas greige) and
  v2026-08-01.02 (category-first triage) while this pass was in flight;
  `--pill-bg` was chosen to sit in .23's warm family, and .02's triage
  heading emphasis supersedes this pass's triage-title demotion (recorded
  in design-notes.md). Suites were run against the merged tree.

## Browser validation — COMPLETED LIVE (2026-08-01, Andrew's Chrome,
localhost:8000, dist force-refreshed via the cache:"reload" ritual,
v2026-08-01.02 confirmed on-page, Teams-full-transcript document resumed)

1. **Category grid** ✓ — 39 cells at exactly two heights (38px singles,
   83px = two fixed tracks + gap); the two wrapped labels ("Expanded
   common language token", "Signature Or Email Header Context") were the
   spanned ones; background rgb(235,235,231); FILTER group left edge at
   x=1079 on a 2133px window (midline).
2. **Group Check** ✓ — screenshot-confirmed layout; measured member %
   right edges 1684/1684/1684 against parent right edge 1684 (pixel-exact
   column); 8 `.attention-note` elements under their %s, 0 legacy
   `.attention-pill`; confidence at 17.28px (1.08rem).
3. **Why? auto-open** ✓ — open on arrival for the focused Results-grid
   item. (Close-persistence across autosave renders not separately
   exercised live; covered by the closedDetailsKeys mechanism.)
4. **Redaction rules** ✓ — all five type rows render radios/text/preview/
   autosaves with correct defaults; round-trip exercised live: Person →
   Sequential showed "Preview: [PERSON REDACTED 001]" (committed config
   verified by re-render), then → Apply to all restored
   "[PERSON REDACTED]" / generic. Config left exactly as found.
   Generated-output content with a sequential rule not exercised (would
   have written output against Andrew's live session).
5. **Buttons** ✓ tighter throughout, no clipped labels (screenshot).
