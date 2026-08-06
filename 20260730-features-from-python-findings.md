# Features from Python — Implementation Findings

**Class: working — active (2026-07-30).** Browser validation pending. Not citable as canonical authority.

**Spec:** `20260730-DocScrub-featuresFromPython.docx` (treated as the specification; Python behavior as target, with the document's explicit change requests applied on top).
**Date:** 2026-07-30
**Status:** Implementation complete. All automated verification green (26 suites; tsc + full build clean; `dist/` freshly emitted). **Browser validation pending** — this pass is overwhelmingly visual/interactive; the checklist below is the contract for the live pass.
**Stop conditions:** none hit. No requirement proved impossible; every ambiguity was resolved from the spec's own screenshots or the Python target and is disclosed under Judgment Calls.

---

## What was implemented, per spec item

### 1. Decision color vocabulary (pale region / saturated buttons / highly-saturated selected)
- Candidate rows (Item Check List view + Ambiguity Check) now take their decision's pale background (`group-row-*`, the shared vocabulary), and the selected decision's button gets the solid highly-saturated treatment (`group-action-active`) — previously only Group Check rows had this.
- The fifth hue: **Fix this = gray** (`--notquite`), applied as the emphasized state on groups with member-by-member fixes (mixed outcomes), matching the reference screenshots.
- Result cells (new grid) tint by decision the same way.

### 2. Two-column layout above a width threshold
- Group Check's manual 1-/2-column toggle is **removed**; `.group-list` becomes a two-column grid automatically at ≥ 1280px (CSS only). Each group's row + member breakdown is wrapped in one `.group-cell` so an expanded group stays inside its own column (per the reference); a Fix this panel spans both columns.
- Navigation is row-major by construction: CSS grid auto-flow keeps DOM order reading across each row, and every sequential path (Tab, post-decision advance, `]`/`[`) follows DOM order — "perusing a horizontal row completely before moving to the next row" with zero JS awareness of column count. (The spec's prose definition was followed; its inline example appears garbled and was read per the prose.)

### 3. Needs-attention pills
- Members: pill when **undecided and live confidence < 80** (the caution band — inferred from the reference: 62%/70% flagged, 91% not).
- Groups: pill when member decisions disagree (existing "needsAttention" display kind) **or** the group is undecided and any member is flagged — "something *internally* that needs attention" (explains the reference's 70%-with-pill vs. 72%-without: a flagged member, not the group's own figure). Uniform (addressed) groups never show it. The old "needs attention" caution *badge* is replaced by the pill, placed by the name.

### 4. Circled check replaces percentages on addressed items
- One glyph everywhere (`.reviewed-check`, a circled ✓ with the decision in its tooltip): decided candidate rows (replacing the old "100% · was X%" pill), collapsed uniform group rows (replacing the "✓ Reviewed" explanatory pill), decided members, and decided result cells.

### 5. "was x%" stacked under the revised percentage
- Group and member confidences render as plain bold colored text (no pill chrome) with the grey italic "was x%" stacked **underneath** (`.confidence-plain`) — the reference's exact treatment, chosen for 2-column horizontal economy.

### 6. Group Check focus-item layout + Source
- Member rows: checkbox · bold name (count) · confidence/check · pill · **Source** button at the right edge — the clean main-plus-sub-items layout.
- **Context → "Source"** (change request): the button reveals an inline panel of that member's occurrence snippets with the actual reference highlighted in amber (`<mark class="source-match">`), up to 8 snippets plus an "…and N more" note. Also added to Fix this member rows (the Python analog had context there too).
- **"S" key** toggles the Source panel. Verified before binding: `keymap.ts` never bound "s" (Save had no keybinding in this build — "should already be deprecated" was already true), so this is a pure UI-layer key in the same fallback chain as `/`, `]`, `[`, C/R; **keymap.ts is untouched**. Target resolution: the active Fix this member; else the member row holding roving DOM focus; else the focused group's first member.
- **"S Source" appears dynamically in the command bar** whenever Source buttons are on screen (a focused/expanded group, or an open Fix this panel).
- Arrows travel all elements within the focus item: the Source buttons joined the roving-focus grid (checkbox → Source within a row; up/down between member rows and the action row), so panels read as one navigable area.

### 7. Visual weight
- Buttons: heavier (600) with more padding, app-wide. Group names 700 and larger; member names bolder; counts as muted bold "(n)".
- Every `<details>` in the app now uses **larger, borderless ▸/▾ arrows** (default disclosure marker suppressed).

### 8. Item Check — "By Category" is the default view
- `itemCheckViewMode` defaults to `"category"`. List view remains one click away, unchanged (including its per-row KCRIQ buttons).

### 9. Category Check header — Review State and Filters, distinct colors
- Labelled groups: **REVIEW STATE** (Total · Resolved · Unlikely · To Review — the reference's order) in the blue accent; **FILTER** in its own purple hue (`--filter-hue`). Chips show label + count.
- **Filter semantics, per spec:** the Filter row's **Show All** is always present and *negates* the other filters (the axis is single-select with "all" as no-op); clicking a specific category **opens up** Single Occurrence / Multiple Occurrences / High Likelihood (with counts); the small **Show All N** link next to CATEGORY clears the category selection; **Total** clears every filter and the FILTER group **disappears entirely**.
- The third axis is pure and shared: `itemCheckCategoryView.ts` gained `CategoryContextFilter` + `matchesContextFilter` (Single = exactly 1 occurrence; Multiple = >1; High Likelihood = the shared ≥90 threshold), consumed identically by the renderer and `visibleItemCheckIds()` — keyboard membership cannot drift from rendered membership. This closes the reconstruction doc's long-deferred "third axis."
- Categories render as a **grid of cells** (label left, count right), selected cell highlighted.

### 10. Unhelpful filter labels
- `known-personal-name-token` → **"Contains a known name"**; `small-frequency-bonus` → **"Mentioned only twice"** (verified against `scoring.ts`: the rule fires at exactly count = 2). Display labels only — rule ids, weights, and audit artifacts untouched. Relabeled rather than removed: the evidence is real; the vocabulary was the problem.

### 11. Results — tight grid with auto-opening full view
- Results section: heading ("Results · N results · State / Category"), bulk toolbar, the **expanded full view** for the focused candidate, then the **compact cell grid** (bold name + (count) only). Cells tint + circled-check when decided; the focused cell is outlined; clicking or arriving by keyboard focuses it — and since expansion follows focus, "navigating through the grid auto-opens each subsequent item into the full view" holds by construction.
- Expanded full view: **bold Name + small (x) count header**, the three pills (color-coded %, Type, Likelihood), the deterministic natural-language explanation, **"Sources"** (renamed from "Representative snippets", everywhere), All occurrences with its high-level kind groupings, and Expert View.
- **Spec-directed omission:** no K/C/R/I buttons in the cells or the panel this phase — the spec's closing note assigns "the same KCRIQ buttons here" to the *next* phase, and the Python reference panel has none. The keyboard path is complete (K/C/R/I decide the focused item; the Change/Redact inline editors render inside the expanded panel's header so typed text has a home), bulk actions cover the mouse path, and List view's buttons are unchanged.

### 12. Grid keyboard navigation — two parallel cell sets
- **Arrows over Results**: spreadsheet semantics — Left/Right one cell (clamped, no wrap), Up/Down one *row* via the **measured** column count (cells sharing the first cell's `offsetTop`), staying put at grid edges. Measured, not assumed: the grids are `auto-fill` and re-wrap with the viewport. This is the UI-side 2D layer FocusNavigator's doc comment explicitly reserved for the UI (rendered-geometry dependence).
- **Shift+Arrows over Categories**: same spreadsheet traversal over the category cells; selection is `categoryFilter` (a UI narrowing concept — the domain has no category cursor), each move re-baselines the context filter and re-renders Results ("changing categories dynamically changes the Results"), with an RX-18 status narration.
- Command-bar legend in By Category advertises both sets: "↑↓←→ Results · Shift+↑↓←→ Categories".
- Tab and Home/End stay sequential over the visible order — row-major by DOM construction.

---

## Files changed

| File | Change |
|---|---|
| `app/src/ui/app.ts` | category view default + third-axis state; Category Check header/grid rebuild; Results grid + expanded view; grid + category keyboard nav (`measuredColumnCount`, `moveWithinResultsGrid`, `moveCategorySelection`); Source panels + `S` handler + roving integration; group-cell 2-col restructure; decided-state visuals (rows, buttons, circled check, pills); legend updates; "Sources" rename; detail-panel header mode |
| `app/src/ui/itemCheckCategoryView.ts` | `CategoryContextFilter` axis (+ facts fields, `matchesContextFilter`, `CATEGORY_CONTEXT_FILTERS`) |
| `app/src/engines/quality/category-rule-labels.data.ts` | two human labels (display data only) |
| `app/index.html` | all new CSS (header groups, category/results grids, circled check, stacked confidence, pills, Source panel/highlight, gray Fix this, auto 2-col, visual-weight pass, borderless details arrows); removed obsolete 2-col-toggle CSS |
| `app/verify/item-check-category-view-verification.ts` | extended for the third axis (**18 checks**, was 12) |
| `app/verify/ui-smoke.ts` | 3 new structural checks (**15 checks**, was 12) |

**Untouched, deliberately:** `keymap.ts` (verified "s" was free — the S binding is UI-layer), `FocusNavigator`/`navigator.ts`/`stages.ts`, all domain vocabulary, commands, and serialization. Zero suite expectations weakened.

## Automated verification

26/26 suites green (count re-confirmed), including the extended pure suite for the three-axis narrowing (18/18) and ui-smoke's structural checks (15/15). `npx tsc --noEmit` clean; `npm run build` clean — `dist/` is current for the browser.

**Node-verified:** the third-axis narrowing semantics (incl. Show-All-negates, composition, thresholds), the renames (structural), By-Category default (structural). **Not Node-verifiable (browser-only):** everything visual (color tiers, circled checks, stacked was-%, pills, visual weight, 2-col), all grid geometry navigation (offsetTop measurement needs layout), Source panels, the S key, and the auto-expanding full view. That is most of this pass — the checklist below is the real acceptance test.

## Manual browser validation checklist

Prereqs: `start-server.command`; a document with ≥ 100 candidates; window wide enough for 2 columns, then narrow.

**Item Check / Category Check**
1. Open Item Check: **By Category is the default**. Header shows REVIEW STATE (blue) and FILTER (purple) with counts; CATEGORY grid below with the small "Show All N" link.
2. Click a category: FILTER expands to Show All / Single Occurrence / Multiple Occurrences / High Likelihood with counts; pick each and confirm Results narrow accordingly; pick Show All and confirm it negates them.
3. Click **Total**: everything lists; the FILTER group disappears entirely. Click Resolved/Unlikely/To Review: counts and Results behave.
4. Confirm the two renamed chips read "Contains a known name" / "Mentioned only twice".
5. Results: tight cells (bold name + count). Arrow through them — Left/Right one cell, Up/Down one *row*; the expanded full view above the grid follows focus. Resize the window so the grid re-wraps and confirm Up/Down still moves one visual row (measured columns).
6. **Shift+Arrows** move the category selection through the category grid like a spreadsheet; Results change live; the status bar narrates each re-application.
7. Expanded view: bold name (count), three pills, plain-language explanation, **Sources**, All occurrences (borderless ▸ arrows), Expert View. Press K/I on a focused item — decides and advances; press C — the Change editor appears inside the expanded panel; type + Enter commits.
8. Decide items: cell tints to the decision color with a circled ✓; the pulse fires on the leaving cell; no dialogs.
9. List view: rows now tint by decision, decided rows show the circled ✓ (no percentage), and the chosen decision's button is solid/saturated. `]`/`[`, search-Enter, bulk bar all still respect the narrowing.

**Group Check**
10. Wide window: two columns, reading order across rows (Tab: col 1 → col 2 → next row). Narrow window: one column. No layout toggle button.
11. Group rows: bold larger names, needs-attention pills on unaddressed flagged groups, plain bold % with "was x%" stacked under where revised, circled ✓ on collapsed decided groups, decision-colored rows/buttons incl. **gray emphasized Fix this** on mixed groups.
12. Expanded group: clean member list — checkbox, bold name (count), member % or circled ✓, pill on flagged members, **Source** at the right.
13. Click Source: inline panel with snippets, the reference highlighted in amber. Press **S**: toggles the panel for the roving-focused member (arrow into a member row first); with no member focused, the first member's panel toggles. Legend shows "· S Source".
14. Open Fix this: member rows also carry Source; S toggles the active member's panel; deciding members still works; the panel spans both columns in 2-col mode.
15. Arrows inside the expanded group travel checkbox → Source → next row as one continuous area.

## Judgment calls & deviations (all disclosed, none silent)

1. **KCRIQ buttons omitted from the Results grid/panel** — the spec's own phase note; keyboard/bulk/List-view paths keep every decision reachable. Flagged as the explicit next phase.
2. **No "Close" button on the expanded panel** (Python has one): this build has no independent expansion state to close — expansion *is* focus. Adding a Close that can't close would fake a state that doesn't exist. Raise if you want an explicit collapse state added instead.
3. **Two-column tab-order example** in the doc contradicts its own prose; the prose ("peruse a horizontal row completely before moving to the next row") was implemented.
4. **needs-attention thresholds** inferred from the screenshots (undecided + live confidence < 80; group flag driven by members). One number, shared with the badge caution band.
5. **Relabel, not remove**, for the two "terrible" filter chips.
6. **2-column breakpoint = 1280px** ("a certain window width" was unspecified).
7. **S with no member focused** toggles the first member's panel (predictable landing); Source snippets cap at 8 with a "more" note.
8. **Category cells only** are Shift+Arrow-navigable; the "Show All" link remains mouse-only (it lives outside the cell grid's geometry). Clearing via keyboard = Shift+Left to the first cell then mouse, or the Total/state chips.
9. Review-state chip order switched to the Python reference (Total · Resolved · Unlikely · To Review); switching state or category re-baselines the context filter to Show All.
10. Python's "show empty categories" checkbox and category-sort dropdown were **not** added — they appear in screenshots but not in the spec text, and the spec governs.
11. Result cells drop the "✓ Saved" text badge during the acknowledgement pulse (cells are deliberately tight; the pulse + circled check carry it). Row views keep the badge.

---

## Follow-up (same day): arrows enter the item; Source follows selection

From Andrew's live browser feedback on the Group Check screenshot.

### Root cause found: a real pre-existing bug, not a design gap
Down-arrow leaving the item instead of entering it was the roving grid's focus restore being a **silent no-op**: it called `.focus()` from inside `renderGroupStage`, but `render()` only attaches the stage body to the document *after* the stage renderers return — focusing a detached element does nothing, DOM focus fell to `<body>`, and arrows bubbled to the document handler where the keymap resolved them to between-item moves. The directional-row-navigation design ("only the four arrow keys are grid-scoped; Tab means next item") had been dead-on-arrival in the browser for this path. Fixed by deferring the restore through a `rovingFocusPending` slot applied in `render()`'s tail (the same deferred-focus shape the search input already uses). **Result: Down from the group's own row now enters the item and highlights the first member row** (new `.member-row:focus-within` row highlight), Up/Down move through members, Tab still moves between items.

### Source panel: at most one, and it follows the selection
`openSourceKeys` (a Set of independently-open panels) is replaced by a single `sourceViewFor` — the one open panel, owned by the selected member, matching the expansion-follows-selection model used at every other level:

- **S on a collapsed panel:** expands it; from the item's top level, the selection also moves into the first member row, so the highlighted row and the open panel agree, and further arrows continue from there. (Reading of "move focus to the first source item": the first member row — the item that owns sources; snippets themselves are not focus stops, they have no actions. Disclosed.)
- **S on an expanded panel:** collapses it.
- **Arrowing to another member with a panel open:** the current panel closes and the newly selected member's opens (implemented at the keypress in the roving handler, since those moves don't otherwise re-render). Moving back up to the group's own action row — no member selected — closes the panel. Inside Fix this, the panel follows `activeMemberId` the same way; switching focused groups clears a panel left behind (reconciled at render).
- Mouse parity: clicking a Source button opens that member's panel *and* makes it the roving-active row (focus restores to the clicked button across the re-render), so keyboard continues coherently from a mouse action.

Verification: tsc clean, full build clean, 26/26 suites green (UI-layer only; the fix and the follow behavior are browser-observable — add to the live checklist: Down enters members from a focused group; S from top level opens + highlights the first member; S again collapses; Down while viewing a source swaps the panel to the next member; same inside Fix this).

---

## Response actions (from `20260730-DocScrub-responsetoClaude-ImplementationFindings.docx`)

All acted on directly, per the document.

1. **Filters always visible; Review State + Filter cumulative.** The "Total hides Filters / filters appear only with a category" reading is reversed: all four Filter chips (with counts) render at all times, selectable with or without a category and under any review state — "view all Single occurrences" now works from anywhere. Clicking **Total** resets the Filter to Show All (and clears the category, per the original spec); switching among Resolved/Unlikely/To Review now **keeps** both the category and the Filter in effect. *Disclosed supersession:* this overrides the previously-approved "re-baseline context filter on state/category switch" (judgment call #9) — the cumulative-filters instruction is later and more specific, and the "view all Single occurrences" workflow depends on the filter surviving those clicks. Category clicks and Shift+Arrow category moves likewise no longer reset the Filter. If you wanted category changes to still reset it, say so — one line each.
2. **Show All is keyboard-navigable** as a virtual position before the category grid: Shift+Down/Right from Show All enters the first cell; Shift+Up from any top-row cell (and Shift+Left from the first cell) returns to Show All. Judgment call #8 is thereby closed.
3. **Pills share the title line** with the bold name + count in the expanded full view.
4. **%/✓ column beside the buttons:** the confidence figure or circled check now carries `margin-left: auto` on group rows, candidate rows, and member rows, so they right-align directly left of Keep-as-is (or Source, for members) and form a scannable vertical column, per the Python template.
5. **Two-column tab order** — confirmed no change needed: the grid is row-major DOM order, so Tab already reads 1-2 / 3-4 across each row (Shift+Tab reverses). Display and traversal agree by construction.
6. **KCRIQ buttons now render in the expanded Results panel** (whole-item actions, same `decisionButtons()` choke point as the row views — active-decision emphasis, decision colors, and the Change/Redact inline editors included; the earlier header-mode editor stopgap is replaced by the buttons' own editors). **Constraint, stopped-and-explained rather than substituted:** "editing … each constituent element" cannot be implemented in the UI alone — the domain records decisions per *candidate* (`ReviewSession.candidateDecisions`); a per-*occurrence* decision has no domain representation, no serialization, and no audit vocabulary. Constituent-level editing therefore needs a domain-model extension (a per-occurrence decision or exclusion concept flowing through ReviewEngine → rebuild → audit) — a real, separately-scoped feature, not a rendering change. Awaiting your direction on that scope.
7. **"show empty categories"** checkbox added beside the Category header (off by default): reveals zero-count categories (muted) under the current narrowing. The spec doc should gain this line, per "update spec" — noted here as the spec's own record until the docx is revised.
8. **Shift+1…5 switch stage tabs** (Ambiguity/Group/Item/QA/Output, workflow order). Matched by `event.code` (physical digit row) so it works on any keyboard layout where Shift+1 types "!". Advertised compactly in the command bar as "⇧1–5 Stages" (full mapping in its tooltip) rather than numbering the tabs — the "without cluttering" option. Keymap untouched; it's a UI-layer fallback like `/`, `]`, `[`, and S.
9. **Implementation Philosophy + Documentation Standard installed as standing repo policy**, verbatim, in `app/docs/architecture/implementation-philosophy.md`, with `app/CLAUDE.md` and `app/AGENTS.md` carrying the condensed form so Claude-based and non-Claude tools alike load it automatically in every future session — no re-stating needed. Both note that workflow-describing comments are product contract and that every underspecified judgment must be documented with assumption/reasoning/alternatives/impact.

Verification after all response actions: `tsc --noEmit` clean, `npm run build` clean (`dist/` current), 26/26 suites green.

---

## Item-scheme containment model (AG, 2026-07-30, four live-feedback messages consolidated)

The four requests (pending-decision preview; completed-color continuity on selection; scheme cascading to child areas; nav-blue only for unprocessed items) resolve into **one rule**: *an item is always contained by exactly one color scheme, chosen by precedence, and that scheme flows to every inline derived area.*

**Precedence** (per item): (1) the **pending** decision while a Change/Redact editor is open — row tint + solid button in the target hue, so the reviewer immediately knows they are "moving towards a different outcome"; committed-decision emphasis is suppressed for the duration, and Cancel reverts by plain re-render (the preview is pure derived state, nothing to undo). (2) The **committed** uniform decision — and when such an item becomes the active navigated item it does **not** turn nav-blue: its background keeps the decision scheme, with the accent surviving only as the border highlight that marks "active" (continuity of visuals). (3) **Nav-blue** for the focused-but-unprocessed item, with the same containment behavior.

**Containment cascade:** the scheme is expressed as CSS variables on the `.group-cell` (`--item-hue` / `--item-tint` / `--item-tint-contrast`, one class per scheme incl. `group-cell-nav`): member rows take the soft tint; the Source panel and the selected-member emphasis take a slightly **contrasting shade of the same hue** — never accent blue inside a decided item. The candidate detail panel (list view and the category-view expanded panel) is the analogous child area and takes the same scheme via `schemeClass`. Applied likewise to Not Quite member rows (pending preview per member).

**Judgment calls:** contrast-tier hex values (`#dcefe3` green etc.) are one step deeper than the existing `*-soft` palette, same hue family — eyeball-tuned, easy to adjust. Mixed-decision ("needs attention") groups have no uniform scheme and use nav-blue when focused.

**Contextual member decisions (AG follow-up, same day):** K/C/R/I inside an expanded group now apply to *whichever row is active*: at the item's top level they act on the whole item (unchanged keymap path); when a member row holds the roving focus they decide **that member** without entering Fix this (K/I direct; C/R open the member's own inline editor under its row, pending preview outranking the containment scheme on that row). After a member decision the selection advances to the next **unedited** member — skipping decided ones — wrapping to the **topmost** unedited member when the just-decided was the last unedited below; when none remain, the group resolves and the ordinary stage-level advance takes over, so finishing the last member flows straight into the next group. An open Source panel follows the advance. The command-bar legend now switches to member vocabulary ("K Keep member …") the moment a member row becomes active — the one real ambiguity in this model is *which level the letters act on*, and the legend + member-row highlight carry that. Row changes inside the item now re-render (legend/scheme stay truthful; the deferred focus restore holds the cell). **On the wrap being "odd":** disclosed as deliberate and sound, not nuts — a member list is short, fully on screen, and worked as a bounded set, so wrap = "finish the set" and cannot disorient; the stage-level no-wrap rule exists for long scrolling lists where a bottom-to-top teleport loses the reviewer. Both behaviors are documented at their definitions. "F" stays whole-item everywhere (Fix this has no per-member meaning). Version label bumped to **v2026-07-30.02** with a cumulative design-notes entry (several earlier changes today shipped without bumps — a miss against version.ts's own convention, corrected and noted there).

**Fix this in amber (AG follow-up, same day):** the paradigm now covers the open Fix this session as its own scheme — supersedes the earlier "Not Quite panel deliberately unschemed" judgment. While a Fix this panel is open, the item is contained by **amber** (the warn family, the hue the needs-attention pill already speaks): group row, panel, member rows, and any Source panel inside, with the active member and Source taking the contrasting amber shade. A member's own open Change/Redact editor still outranks the amber on that one row (same precedence as everywhere). Exiting/completing reverts by plain re-render, exactly like Cancel. Full scheme precedence is now: **open Fix this (amber) → pending Change/Redact editor (target hue) → committed decision (continuity) → nav-blue (unprocessed focused)**. Disclosed: the solid **gray** Fix this button emphasis on already-fixed mixed groups stays gray — that marks the *committed* fixed-mixed state per the original spec ("Not Quite: same but gray"), distinct from the amber *active* session; say the word if you'd rather the whole Fix this identity go amber.

Verification: tsc + build clean, 26/26 suites green. Browser checks: open Change on a Keep-decided group — row, members, and Source flip to blue scheme, Change goes solid, Cancel restores green everywhere; select a decided group — green background retained with blue active border; select an undecided group — blue containment including members and Source panel. Browser-validation additions: filter chips visible and selectable under Total and with no category; state clicks preserving filter selections; Shift+Up-to-Show-All; pills on the title line; the %/✓ column alignment; KCRIQ in the expanded panel (mouse + K/C/R/I keyboard both, editor inside the panel); empty-categories toggle; Shift+1–5 from every stage.
