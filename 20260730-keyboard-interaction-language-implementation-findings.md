# Keyboard Interaction Language — Implementation Findings

**Class: working — active (2026-07-30).** Not citable as canonical authority.

**Date:** 2026-07-30
**Scope:** Implementation of the accepted keyboard review + Andrew's interaction-language refinements. Working code, verified: `tsc` clean, `dist/` rebuilt, ui-smoke 15/15, focus-navigator 105/105, workspace-integration 63/63, item-check-category-view 18/18, milestone-2 91/91, group-check-revision 17/17, review-engine 43/43, visible-list-advance 19/19, bulk-decision-workflow 38/38.
**Files touched:** `src/ui/app.ts`, `src/engines/navigation/keymap.ts` (one binding), `index.html` (CSS only).

---

## 1. What was implemented

### The grammar, as shipped

| Key | Meaning | Where |
|---|---|---|
| K / C / R / I | Decide the focused object | unchanged |
| X | Toggle the focused candidate's selection | Item Check (both views; the Results grid's only selection affordance, shown via an inset ring) |
| 1–9 | Link the numbered Possible identity (options now render numbered) | Ambiguity + Item Check, incl. from inside the detail panel |
| Shift+K/C/R/I | Apply to the selection (C/R open the existing bulk editor; empty selection gets a teaching refusal) | Item Check |
| Shift+X | Select / clear all visible | Item Check |
| Shift+Arrows | Steer the whole narrowing column: Review State row ↔ Filter row ↔ Show All ↔ category grid | By Category |
| Shift+1–5 | Stage switch (pre-existing; now also works from Chrome mode) | everywhere |
| Enter | Go deeper / commit: confirm editor (unchanged) · **enter the detail panel** (reactivated `enterItem`) · **Done fixing** (new keymap binding → `completeNotQuite`) | context-dependent |
| Escape | Back out exactly one level: editor → panel → search → chrome region → failure banner → Review mode (universal rung: any natively-focused stray control blurs back to Review mode) | everywhere |
| F6 / , | Cycle interface regions: top bar → workspace chrome → stage controls → back to Review mode | everywhere |

### Region model (the judgment call you asked for)

I implemented your two-state model, not the review's original R10, and I'm now convinced yours is right. **Review mode** and **Chrome mode** are distinct: chrome clicks perform their action and return to Review mode (most chrome clicks re-render, which already drops focus to `<body>` for free; a delegated click listener covers the non-rendering handlers like Save Session/downloads — the entire G3 dead zone closed by mode discipline, zero per-button exceptions). F6/"," enters chrome intentionally; inside it, native Tab/typing/selects work untouched; Escape (or cycling past the last region) returns. The alternative — letting K fire while an arbitrary button has focus — would have made "what does this key do right now" depend on invisible DOM focus state; two named modes with a narrated transition (`setStatus`) is strictly less to hold in one's head.

Region key: **F6 primary** (desktop convention), **"," as the layout-stable, Fn-free equivalent** — every browser-safe Command combination is already claimed by the browser itself, so a plain unbound punctuation key in the app's fully-owned keyspace was the smallest coherent decision. One sharp edge caught in self-review: "," must stay typeable in the search box, so from text-entry controls only F6 cycles. Recorded as revisable.

Regions are coarse by design: all of Item Check's stage controls (view toggle, search/presets/sort, category panel, bulk toolbar) render into **one** `.keyboard-region` wrapper — cycling is a three-press round-trip, never a six-press tour. Group Check's sort toolbar (previously keyboard-unreachable, period) is its stage's one region.

### Detail panel as a depth level

Enter dispatches the (previously inert) `enterItem` **and** hands real DOM focus to the panel's first control; Tab/arrows/Enter/Space are native inside (the `<details>`, identity options); Escape dispatches `closeItem` and returns. Decision letters and identity digits **fall through** while inside the panel — the panel belongs to the focused candidate, so K from mid-evidence decides-and-advances and lands you back in Review mode on the next item with no explicit exit. Panel focus survives incidental re-renders (autosave) but deliberately **not** decision advances — distinguished by whether the focused itemId changed since the last render (`lastRenderedFocusedItemId`).

### Filter navigation prototype (the second judgment call)

Shipped as one vertical column with a hybrid rule: **within** a header row, Shift+Left/Right selects (each row is single-select, so position *is* selection and results change live, chip-click side effects included — Total still clears everything); **between** rows, Shift+Up/Down travels without selecting. The cursor row's active chip carries a visible ring (`.chip-nav-cursor`); mouse clicks move the cursor too, so keyboard and mouse never disagree about position; view switches reset it.

**Honest evaluation:** the geometry mostly holds, but the grammar bends in one place — vertical movement *selects* inside the category grid (spreadsheet) yet *travels* between header rows. I chose travel-only for the header rows because selecting-while-passing would re-filter three times on the way down and, worse, force a category-clearing pass through Show All. The seam is Show All: going **up** from a selected category cell still selects Show All en route (your approved landed behavior), so reaching the Filter row from deep in the grid clears the category selection. With cumulative filters, "change the Filter while keeping my category" is a real workflow this frustrates. It didn't feel confusing in walkthrough — but it will be *felt* in a two-hour session. If it bites, the consistent fix is making Up-from-top-row travel to Show All without selecting it (Show All then selects only via Shift+Left from the first cell, or click) — one line, but it revises a behavior you explicitly specified, so it waits for your verdict from use.

---

## 2. Intentionally deferred

- **Full region cycling into the review list itself** (F6 as a three-way review↔chrome↔panel rotor): Enter/Escape already own the depth axis; F6 owns sideways. Collapsing them into one rotor would blur the depth/breadth distinction the grammar just established.
- **Shift+F6 reverse cycling** — three regions; forward + Escape covers it. Add only if a real session shows backtracking friction.
- **`moveStage` key binding** (relative stage prev/next) — direct jump via Shift+1–5 is strictly better with five stages.
- **Numbered options beyond 9** — unnumbered, click/Tab-reachable; >9 identities is already a pathological proposal.
- **Chrome-region focus preservation across incidental re-renders** — an autosave completing while you're mid-Tab through chrome drops you back to Review mode. Rare (autosave follows *changes*), low-stakes, and the fix (per-region focus memory) isn't worth its state until real use complains.
- **The review's R8 hatch key** — subsumed by the region model; no separate toolbar-focus key needed.

## 3. Needs real-world testing (the two-hour-reviewer critique)

Ranked by how much I expect actual use to move the design:

1. **The Show All pass-through** (above) — the one place the grammar visibly bends. Watch for: reaching for the Filter row and losing your category.
2. **Post-decision panel behavior.** Deciding from inside the panel returns you to Review mode on the next item. If your reviewing rhythm turns out to be "read evidence → decide → read next evidence," pressing Enter after every decision will feel like a tax within twenty minutes — the fix (stay in panel-depth across advances) is one condition, but it changes what Enter means at rest, so it needs felt evidence first.
3. **"," vs F6 in the hand.** Comma is home-row-adjacent and I suspect it becomes the real region key with F6 vestigial. If so, the hint text should lead with it.
4. **X + Shift+K/C/R/I cadence at scale.** The vocabulary is coherent, but bulk work's real test is whether X-X-X-Shift+K beats Shift+X-then-prune on a 40-item category. The status region narrates counts on every toggle; if that narration turns to noise after an hour, it should throttle to selection milestones.
5. **Enter = Done fixing** silently no-ops when members are undecided (parity with the button's existing behavior). If that reads as a dead key in practice, it should `refuse()` with the undecided count — three lines, waiting on evidence it's needed.
6. **F6 in Firefox/Safari** — F6 is deliverable and preventDefault-able in Chromium; other engines contest it for their own pane cycling. "," is the guaranteed path everywhere; verify F6 per-browser during the manual click-through.

## 4. Documentation posture

Every addition carries the why-comment discipline: the region model's rationale lives on the REGION MODEL block by the keydown listener; the grammar's conditional legend derivation in `commandBarLegend`; each judgment call is marked and attributed. The keymap change is one binding (`Enter → completeNotQuite`) with its non-shadowing verification recorded in place.
