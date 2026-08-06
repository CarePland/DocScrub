# Keyboard Navigation Completeness Review

**Class: working — active (2026-07-30).** Review only; feeds the future `app/docs/reviewer/keyboard-interaction.md` (initiative Phase 3). Not citable as canonical authority.

**Date:** 2026-07-30
**Scope:** Review only — no implementation. Walks the reviewer workflow stage by stage against the shipped implementation (`app/src/ui/app.ts`, `app/src/engines/navigation/keymap.ts`, `navigator.ts`) plus the in-flight changes recorded in `20260730-DocScrub-responsetoClaude-ImplementationFindings.docx`.
**Note on timing:** `app.ts` advanced mid-review (4,137 → 4,232 lines). The findings-doc items — Shift+1–5 stage switching, Show All joining Shift+Arrow grid nav, cumulative filters, the "show empty categories" checkbox — landed while this review was underway. Every claim below was re-verified against the 11:12 state of the file; items closed by that work are recorded as closed, not re-raised as gaps.
**Premise honored:** the existing keyboard model is intentional and established. Every recommendation below extends an existing mechanism; none introduces a new interaction paradigm. Where a gap is already covered by a decision in the findings doc, it is marked **[in flight]** rather than re-recommended.

---

## 0. The existing model, as found (baseline for everything below)

Two cooperating layers, both deliberate:

1. **Domain keymap** (`keymap.ts` → `resolveKeyboardCommand`): pure, DOM-free, context = `FocusState.target`. Decisions K/C/R/I (C and R deliberately resolve to null and fall through to the UI editor), F (Fix this), arrows/Tab/Home/End as `moveItem`, Not Quite arrows + K/I + Escape.
2. **UI fallback chain** (`app.ts` global keydown, only after the keymap returns null): `/` search, `]`/`[` undecided/decided jumps, `S` Source toggle, `C`/`R` inline-editor openers. Arrow `moveItem` commands are intercepted and re-routed through the *visible* order (`visibleItemCheckIds` / `visibleGroupIds`) — one source of truth for "what's on screen" and "what keys traverse."

Focus is two-tiered, also deliberately: **virtual focus** (FocusNavigator's item cursor; DOM focus stays on `<body>`, global shortcuts live) and **real DOM focus** (Group Check's roving grid, inline editors, search box), with `shouldIgnoreKeyboardEvent` + the `isRovingFocusElement` UI-layer exception mediating between them. Expansion is focus; the Command Bar derives its legend from live state.

This is a sound architecture. The gaps below are almost all places where a control lives in **native-DOM-focus land** while the reviewer lives in **virtual-focus land**, and no bridge was built — not flaws in the model, but unfinished coverage of it.

---

## 1. Interactions already well-covered

These need nothing. Listed so the gaps are read against what already works.

| Area | Coverage | Where |
|---|---|---|
| Item/Ambiguity/Group traversal | Arrows, Tab/Shift+Tab, Home/End over the **displayed** order; post-decision advance in visible order; scroll-into-view with real chrome-height compensation | keymap.ts, `moveWithinVisibleList`, RX-01/RX-02b/RX-04 |
| Per-item decisions | K/C/R/I (+ F in Group Check) keyboard-complete, including the C/R → inline editor path in all three contexts (candidate, group-subset, Not Quite member) | keymap.ts + `handleInlineEditorOpenKey` |
| Inline editor | Enter confirm, Esc cancel, arrow-roved quick-pick chips, focus restored across incidental re-renders, draft cache survives decision switches | `renderInlineEditor` + render() tail |
| Search (Item Check) | `/` focuses, Enter jumps to first visible result and returns control, focus/caret survives per-keystroke re-render, respects Category narrowing | `handleScaleNavigationKey`, `jumpToFirstSearchResult` |
| `]` / `[` | Next undecided / previous decided over the visible list, with a spoken refusal when empty (RX-18). Wrap-vs-no-wrap divergence already recorded for RX-30 — not re-raised here | `goToAdjacentInVisibleList` |
| By Category grids | Arrows = Results grid (spreadsheet, measured columns), Shift+Arrows = Category cells **including Show All** (virtual position before the grid; Up from the top row / Left from the first cell returns to it — landed mid-review, verified) | `moveWithinResultsGrid`, `moveCategorySelection` |
| Stage switching | **Shift+1–5 → `focusStage`, landed mid-review** — correctly matched on `event.code` (`Digit1..Digit5`, layout-independent), routed through the UI fallback chain, advertised as `⇧1–5 Stages` in the Command Bar with a per-stage tooltip. Nothing further needed | `handleStageTabKey` |
| Group Check roving grid | Within-row arrows over checkbox + action buttons, member rows, Source follows selection, deferred focus restore (the 2026-07-30 detached-element fix), `S` toggle with first-member landing | `attachRovingGridNav`, `handleSourceToggleKey` |
| Not Quite | Arrows move member, K/I decide, C/R open the member editor, Esc exits; dynamic legend switches vocabulary while open | keymap.ts not-quite branch |
| Discoverability | Command Bar legend derived fresh per render from actual state (editor open, Not Quite open, category view, Source visible) | `commandBarLegend` |
| Notifications | Toasts auto-fade with the message persisting in the status region — there is deliberately nothing to dismiss; refusals narrate via RX-18 | NOTIFICATION CHANNELS block |
| Landing page / Output stage | Native Tab traversal works (the keymap has no branch for a null-document or `output`/`qa` focus target, so Tab falls through to the browser) — file inputs, Resume/Remove, Generate/Download, redaction rules are all reachable | verified against `resolveKeyboardCommand` fall-through |

---

## 2. Gaps

Ordered by how much reviewer time they cost, not by implementation size. Each was verified against the code, not inferred.

### G1 — Structural: the workspace chrome is keyboard-unreachable from the reviewing state

In `item-check` and `group-check` with an item focused, **Tab always resolves to `moveItem` and is `preventDefault`ed** — native Tab traversal into the chrome never happens. From virtual-focus land there is no keyboard route to: stage tabs, the view toggle, Review State / Filter / preset chips, either sort select, the bulk toolbar, the Command Bar's buttons ("Next undecided", "Next ambiguity", "Jump to category"), or the failure banner's Dismiss.

The one accidental route is `/` → search input → native Tab onward — which exists only in Item Check. **Group Check's sort select is keyboard-unreachable, period.**

This is not an argument against Tab-as-next-item — that binding is explicit, correct, and matches the stated model ("Tab always means next item"). It means the chrome's controls each need either a dedicated shortcut (the high-frequency ones — G2, G4, G5, G11) or a single deliberate hatch (the long tail — see §3, R8). Every remaining gap below is partly a symptom of G1.

### G2 — Stage switching **[CLOSED mid-review]**

When this review began, tabs were click-only and the domain's `moveStage` was bound to no key. `handleStageTabKey` landed during the review and closes it cleanly: `event.code` matching (layout-independent — Shift+1 arrives as `"!"` via `event.key`), `focusStage` dispatch through the existing fallback chain, `documentLoaded` guard, compact `⇧1–5 Stages` Command Bar hint. Verified; no residual gap. One observation stands: `moveStage` (relative prev/next) remains unbound — correctly, since direct jump across five stages is strictly better.

### G3 — Clicking any chrome button creates a shortcut dead zone

After a mouse click on any chrome button (a stage tab, "Next undecided", a filter chip), DOM focus rests on that button, and `shouldIgnoreKeyboardEvent("button")` silences **every** shortcut — K, arrows, Tab, all of it — until the reviewer clicks somewhere neutral. This is the exact "buttons keep working, keyboard doesn't" trap the codebase itself diagnosed twice (the `handleInlineEditorOpenKey` doc comment; the `isRovingFocusElement` exception). Group Check's row controls are already exempted; the chrome's buttons are not.

### G4 — Multi-select and bulk actions are mouse-only

The Item Check row checkboxes and the bulk toolbar (Select all visible / Keep / Change / Redact / Ignore selected) have no keyboard path: the checkbox is not tied to virtual focus, no key toggles selection, and per G1 the toolbar buttons are unreachable. In the By Category Results grid the checkboxes don't exist at all, so bulk work there is fully mouse-bound. Milestone 2's own goal ("Review at Scale") is currently a mouse feature.

### G5 — Ambiguity linking is mouse-only

The core act of Ambiguity Check — choosing among "Possible identities" — has no keyboard path. The option buttons live inside the detail panel (DOM-focus land, unreachable per G1); no key selects an option. K/C/R/I work, so a reviewer can *decline* every identity from the keyboard but cannot *accept* one. That inverts the stage's priority.

### G6 — Not Quite has no keyboard "Done fixing"

Inside the panel: arrows, K/I, C/R, Esc(exit) all work — but `completeNotQuite` is only the "Done fixing" button. Esc is `exitNotQuite` (abandon-without-complete), a deliberately different command. A keyboard reviewer who fixes every member must reach for the mouse to commit the fix. Enter is currently unbound in the panel context (verified: the not-quite branch never matches it).

### G7 — The expanded detail panel's internals are keyboard-inaccessible (Item/Ambiguity Check)

"All occurrences" and "Expert View" `<details>`, the occurrence-group sub-`<details>`, and the identity options all require DOM focus that can't be reached: Tab from body is consumed (G1), and — sharper — `<summary>` is **not** in `shouldIgnoreKeyboardEvent`'s tag list, so even if focus lands on a summary, Tab still resolves to `moveItem` and jumps to the next item instead of moving through the panel.

Meanwhile the domain hooks for exactly this already exist and are **inert**: Enter resolves to `enterItem` (sets `target.occurrenceId` — never read by any renderer; verified) and Escape to `closeItem` (clears it). The roving-grid comment already calls extending directional nav to Item Check "a cheap, natural follow-up." This gap has a pre-built answer waiting.

### G8 — No keyboard exit from the search box

The search input handles Enter only. Esc falls to the browser (`type=search` clears text) but never returns control to the list; with zero results Enter is a no-op and the reviewer is stranded in the input. `/` is a one-way door.

### G9 — Failure banner Dismiss is unreachable

The one notification that *requires* acknowledgement (`showFailureBanner`) offers only a button — unreachable per G1. Esc in candidate stages currently resolves to the inert `closeItem` (verified), so the key is effectively free at exactly the moment a banner is showing.

### G10 — Filter rows (Review State, Filter, presets) are click-only

Shift+Arrows now traverse the Category cells *and* Show All (landed mid-review). But the Review State chips, the Filter (context) chips, and List view's preset chips remain click-only — and the decided direction (cumulative filters, all chips always visible) makes the Filter row *more* used, not less. The new "show empty categories" checkbox (also landed mid-review; verified a native checkbox in the category header) sits in the same unreachable chrome.

### G11 — Sorting is click-only; in Group Check, unreachable

Both sort selects are native `<select>`s in the chrome. Item Check's is reachable only via the `/`-then-Tab accident; Group Check's not at all (G1). Low frequency, but "unreachable" is a different category from "inconvenient."

### G12 — View toggle (List / By Category) is click-only

Same class as G11: low-frequency, currently unreachable without a mouse.

---

## 3. Recommendations

Each is the smallest addition that completes the interaction, fits the existing paradigm, avoids browser conflicts, preserves text editing in inputs, and is discoverable through the Command Bar's existing derived-legend mechanism. New letters proposed: **X** (explicitly freed when Reject was retired — keymap.ts's own note), digits **1–9**, and nothing else; everything else reuses Enter, Escape, Shift, or existing machinery.

**R1. Stage switching — done.** `handleStageTabKey` shipped mid-review and matches what this review would have recommended exactly (event.code, `focusStage`, fallback chain, Command Bar hint). No action.

**R2. Ambiguity linking — digits 1–9 select the Nth "Possible identity"** for the focused candidate (G5). Dispatches the existing `linkAmbiguousCandidate` through `decideAndAdvance`, so pulse + advance behavior is identical to K/I — "this follows the same interaction philosophy as Keep/Rename/Ignore/Redact," which is the already-recorded intent for linking. Options render numbered (`1. Robert Smith 92%`); legend gains `1–9 Link identity` only when the focused item has a live proposal (the `commandBarLegend` pattern already does exactly this kind of conditional). Unshifted digits cannot collide with R1's Shift+digits.

**R3. Not Quite — Enter = "Done fixing"** (G6). Enter is the app's established commit key (inline editor). Keep Esc = exit-without-complete, unchanged. Bind in the keymap's not-quite branch → `completeNotQuite`; legend while the panel is open gains `Enter Done fixing`. If a member editor is open, its own Enter already wins (input-scoped listener) — no ambiguity.

**R4. Selection & bulk — X toggles, Shift+X selects all visible, Shift+K/C/R/I apply to selection** (G4).
- `X` toggles the focused candidate's selection (works identically in List view and the Results grid, which currently has no checkboxes at all — this gives it selection for free without adding per-cell chrome the spec deliberately kept out this phase).
- `Shift+X` = Select all visible / clear (toggle, mirroring the button pair).
- `Shift+K/C/R/I` = the bulk toolbar's Keep/Change/Redact/Ignore selected. Shift+C/R open the existing bulk inline editor; Shift+K/I dispatch directly — exactly the C-R-vs-K-I split the single-item keys already have, so the vocabulary is *the same letters, Shift = "the selected set."* That modifier grammar already exists: Shift+Arrows = the parallel (category) set.
- No-op with a spoken refusal (`refuse("Nothing selected.")`, RX-18 pattern) when selection is empty. Legend shows the Shift row only while selection > 0 — the Command Bar already renders "N selected" in exactly that condition.

This is the largest single recommendation (six bindings), but it converts Milestone 2's headline capability from mouse-only to keyboard-first with zero new concepts — every binding is an existing letter plus the existing "wider set" modifier.

**R5. Detail panel entry — reactivate the inert Enter/Escape pair** (G7). Enter (`enterItem` already fires) additionally moves real DOM focus to the first interactive element of the expanded panel; Escape (`closeItem`) returns DOM focus to virtual-focus land (blur to body). While DOM focus is inside `.detail-panel`, extend the `isRovingFocusElement`-style UI-layer exception so Tab/Shift+Tab are native within the panel (this also requires *not* resolving Tab globally when the active element is inside the panel — same scoped-exception shape, no keymap.ts change, matching the "UI-layer exception checked ALONGSIDE it" precedent). This is the Group Check enter-the-item model applied to Item/Ambiguity Check, which the code comment already anticipates. `<details>` open-state persistence (`openDetailsKeys`) already survives re-renders, so keyboard toggling composes cleanly.

**R6. Search box exit — Esc blurs** (G8). Input-scoped listener beside the existing Enter one: if the input has text, let the browser's native clear happen (first Esc); if empty, blur and return control to the list (second Esc). Two-stage Esc is the platform-native pattern for `type=search`; no global handler involvement.

**R7. Failure banner — Esc dismisses** (G9). Checked at the top of the global handler, before keymap resolution, only when a banner is showing. Esc's current resolution in candidate stages is a verified no-op, so nothing is shadowed; in Not Quite, Esc keeps meaning exit (panel check first — banner dismissal yields to the more local context, consistent with the "most local context wins" ordering the fallback chain already embodies).

**R8. The chrome long tail — one deliberate hatch, not N shortcuts** (G1, G11, G12, the coming "show empty categories" checkbox, Jump-to-category, Save Session, import inputs). Rather than minting a letter per low-frequency control, add **one** binding — suggest **`,`** (comma: unbound, layout-stable, no browser meaning outside inputs; think "settings") — that moves real DOM focus to the first control of the workspace chrome, from which native Tab traverses everything (tabs → toolbar → sort → command bar), and Esc returns to the list (R5's same return path). This is `/`'s existing "one key enters DOM-focus land" pattern, generalized. It caps the shortcut budget permanently: any future chrome control is automatically reachable without a new key. The high-frequency controls still deserve their dedicated keys (R1, R4, R9) — this hatch is for everything else, and it's also the honest answer for sort and the view toggle rather than pretending they merit letters.

**R9. Filter rows join the Shift+Arrow geometry [extends the just-landed Show All work]** (G10). Show All now sits as a virtual position above the category grid. Complete the column: Shift+Up from Show All → Filter row → Review State row (with the "show empty categories" checkbox reachable at the end of one of those rows), Shift+Left/Right within a row, Shift+Down descends back. Selection acts exactly like a click (the chip handlers are already shared single functions). Zero new keys; one existing paradigm then covers the entire narrowing surface. List view's preset chips can adopt the same Shift+Arrow row nav there (the category grids don't exist in that view, so the keys are free).

**R10. Chrome buttons stop eating shortcuts** (G3). Extend the existing UI-layer exception (the `isRovingFocusElement` pattern — deliberately not a keymap.ts change) so a plain `<button>` inside `.command-bar`, `.stage-tabs`, or the toolbars does not suppress shortcut resolution, *except* buttons inside `.inline-editor` (already carved out, must stay gated). Space/Enter still activate the focused button natively before the global handler matters, so nothing double-fires. Alternative considered: `blur()` after click — rejected, it breaks focus-visible expectations and R8's Tab traversal.

### Recommendation interactions (why this set is coherent)

- Unshifted letters = focused item; **Shift+letter = the wider set** (selection, all-visible); **Shift+digit = stages** (now shipped); **digit = identity options**; **Shift+arrows = the parallel filter/category grids**. Four rules cover every addition. One collision to note for R4: Shift+X (select all visible) and Shift+digits share the modifier but not keys — no conflict; the only genuine reserved namespace is Shift+arrows in By Category view, which R9 deliberately extends rather than competes with.
- Enter/Esc gain no new *meanings* — Enter commits/enters (editor, Done fixing, panel), Esc leaves the most local thing (editor → panel → search → banner). The fallback chain's existing "most local context first" ordering resolves all of them without priority tables.
- Everything surfaces through `commandBarLegend`'s existing conditional derivation; nothing needs a static cheat sheet.
- No browser conflicts introduced: no Ctrl/Cmd combinations at all, and text inputs keep native behavior via the untouched `shouldIgnoreKeyboardEvent` core.

---

## 4. Interactions that should intentionally remain mouse-driven (or mouse-first)

- **Toast dismissal** — nothing to dismiss by design (auto-fade + persistent status region). Correct as-is; adding a key would imply a state that doesn't exist, the same reasoning as the removed Close button.
- **Session file plumbing** (load document, resume JSON+docx pair, import decisions) — native file inputs require the OS picker anyway; reachable via R8's hatch and native Tab on the landing page. Dedicated shortcuts would save nothing.
- **Redaction rules configuration** — set-once-per-document, lives in the natively Tab-navigable Output stage. Covered; needs nothing.
- **Recent Documents management (Remove)** — rare, destructive-ish, landing page is natively navigable. Fine as-is.
- **Jump to category / Next ambiguity buttons** — the recorded rationale (a mnemonic letter each would cost more than it saves) still holds; R8 makes them reachable without one.
- **Sort & view toggle** — mouse-*first*, not mouse-only: reachable via R8 rather than dedicated keys, unless real usage shows sort churn is frequent (then a cycle key can be revisited with evidence).

---

## 5. Known items deliberately not re-raised

- `]`/`[` wrap vs. post-decision-advance no-wrap divergence — recorded in `visibleListAdvance.ts`, queued for RX-30.
- KCRIQ buttons in the Results grid/panel — findings doc assigns them to the next phase; R2/R4 are complementary (keyboard reaches what the buttons will later reach by mouse), not a substitute.
- `FocusState.textInputActive` is never set by the UI (it gates on DOM tags instead) — a latent domain affordance, harmless, worth one line in RX-30's consistency table rather than action here.

---

## 6. Suggested sequencing (if/when implemented)

R1 is already done. Cheap and self-contained next: R3, R6, R7 (three tiny scoped bindings). Then R2 (pure fallback-chain addition, mirrors the just-shipped `handleStageTabKey` shape exactly). Then R10 + R5 together (they share the scoped-exception mechanism). Then R9, riding the just-landed Show All geometry while it's fresh. R4 and R8 last — largest surface, and R8's hatch benefits from R5/R10's focus-return machinery existing first.
