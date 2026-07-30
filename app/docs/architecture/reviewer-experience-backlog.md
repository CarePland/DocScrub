# Reviewer Experience — Implementation Backlog

**Companion to:** `reviewer-experience-review.md` (reasoning, comparison, and classification for every item here).
**Date:** 2026-07-29
**Status:** Proposed. Nothing here is approved; each item is written to be approved, deferred, or rejected individually.

Each item is independent unless a dependency is stated. Effort is S (< half a day), M (half a day to two days), L (multi-day). Acceptance criteria are written as observable behavior another engineer can verify without interpretation.

Line references of the form `app.ts:1234` are literal. References to the Python UI (`app.js:446`, `style.css:258`) refer to its embedded blocks extracted to standalone files — see `reviewer-experience-review.md`'s note on citations for the offsets into `local_web_app.py`.

Standing verification requirement for every item: `npx tsc --noEmit` clean, `npm run build` clean, and all `verify/*.ts` suites pass with zero regressions (`ls verify/*.ts | wc -l` first — the count has drifted before). Items marked **Live browser validation required** cannot be signed off from a Node harness.

---

## Index

| ID | Title | Priority | Effort | Wave |
|---|---|---|---|---|
| RX-01 | Scroll the focused item into view | Critical | XS | 1 |
| RX-02 | Post-decision advance follows the visible list | Critical | S | 1 |
| RX-12 | Advance never dead-ends (backward fallback) | High | S | 1 |
| RX-13 | Real DOM focus for the focused row | Critical | M | 1 |
| RX-30 | Keyboard coverage audit and reconciliation | Medium | S | 1 |
| RX-04 | Sticky workspace chrome | High | S | 2 |
| RX-06 | Stable result set while reviewing | High | M | 2 |
| RX-09 | Non-blocking notifications; retire `window.alert()` | High | S | 2 |
| RX-14 | Acknowledgement stops gating progression | High | S | 2 |
| RX-18 | Persistent status region | Medium | S | 2 |
| RX-23 | Decision controls only on the focused row | Medium | S | 3 |
| RX-27 | Scope the render, stop rebuilding the page | High | M | 3 |
| RX-05 | Pagination with position readout | High | M | 3 |
| RX-03 | Dense multi-column scan mode | Critical | L | 3 |
| RX-10 | 2D arrow navigation matching rendered columns | Medium | M | 3 |
| RX-22 | Single display-label vocabulary | High | S | 4 |
| RX-20 | Retire the permanent top bar | High | M | 4 |
| RX-15 | Command bar becomes legend-only | Medium | S | 4 |
| RX-07 | Query tools for Ambiguity Check and Group Check | Medium | M | 4 |
| RX-08 | Occurrence location, numbering, and highlight | Medium | S | 4 |
| RX-17 | Fix or retire Group Check 2-column mode | Medium | S | 4 |
| RX-21 | Resolve the QA stage stub | Medium | S | 4 |
| RX-25 | Accessibility baseline | Critical | M | 5 |
| RX-26 | `prefers-reduced-motion` guard | Low | XS | 5 |
| RX-28 | Empty, loading, and error states | Medium | M | 5 |
| RX-29 | Density and responsive breakpoints | Low | M | 5 |
| RX-16 | Category Check third axis + breadcrumb | Low | M | 5 |
| RX-19 | Rolling-window pace estimate | Low | S | 5 |
| RX-11 | Entity-type filter in Item Check | Low | S | 5 |
| RX-24 | Remove developer chrome from the product | Low | XS | 5 |

---

# Wave 1 — Restore keyboard trust

## RX-01 · Scroll the focused item into view

**Priority:** Critical **Effort:** XS **Dependencies:** none (simplified by RX-13)

**Current behavior.** No `scrollIntoView` call exists anywhere in `src/ui/`. Arrow-key navigation in Item Check and Ambiguity Check moves `focus.target.itemId`, repaints `.item-row-focused` on a row that may be far outside the viewport, and opens the detail panel off-screen. Group Check incidentally scrolls only because `attachRovingGridNav`'s `.focus()` call scrolls as a native side effect.

**Desired behavior.** Whenever the focused item changes and the resulting row is not fully visible, the row is scrolled into view with `block: "nearest"` — never re-centering an already-visible row, never smooth-scrolling.

**Reviewer benefit.** Keyboard navigation stops moving an invisible cursor. A reviewer holding ↓ sees the list track their movement.

**Why this matters.** `review-workspace-specification.md` §10.2 records "minimizing scrolling / never feeling lost" as **[BUILT]**. It is not. This is the most disorienting behavior in the application and the cheapest to fix.

**Recommended approach.** At the end of `render()`, after the existing search-input and inline-editor focus restoration, locate the element carrying `.item-row-focused` and call `scrollIntoView({ block: "nearest" })`. Guard on the element existing. If RX-13 lands first, this comes free from the native `.focus()` call and this item reduces to a verification task.

**Affected files.** `src/ui/app.ts` (`render()`).

**Architectural risk.** None. Pure UI-layer, no domain contact.

**Verification.** **Live browser validation required.** With ≥ 100 candidates in Item Check: hold ↓ and confirm the focused row remains visible throughout; confirm an already-visible row does not jump or re-centre; repeat in Ambiguity Check; confirm no regression to Group Check's existing scroll behavior.

**Acceptance criteria.**
1. After any focus change in Item Check, Ambiguity Check, or Group Check, the focused row's bounding box is fully within the scroll viewport.
2. If the focused row was already fully visible before the change, scroll position is unchanged.
3. Scrolling is instantaneous, not animated.
4. Changing focus does not scroll the page when the focused item is not currently rendered (e.g. filtered out) — no exception is thrown.

---

## RX-02 · Post-decision advance follows the visible list

**Priority:** Critical **Effort:** S **Dependencies:** none

**Current behavior.** `decideAndAdvance` → `dispatcher.dispatchReview` → `FocusNavigator.reconcile()`, which advances via `findUnresolved(itemIdsForStage(...))` — the structural order. Item Check's sort/search/filter and Group Check's sort are invisible to it. Under an active sort, focus jumps to a structurally-adjacent item that may be far away in the displayed order. Under an active filter, focus can land on a candidate that is not rendered at all, leaving nothing visibly focused and the next keystroke acting on an invisible item.

**Desired behavior.** After a decision in Item Check or Group Check, focus advances to the next unresolved item **in the currently displayed order**, restricted to items currently rendered.

**Reviewer benefit.** The view goes where the reviewer expects. No silent jumps; no acting on something off-list.

**Why this matters.** This is the identical root cause you reported as "arrow keys jump out of sequence" during the Group Check revision. That report was fixed correctly via `moveWithinVisibleList`, but the fix covered only `moveItem` commands from `keymap.ts`. The post-decision advance path was never routed through it. Fixing one and not the other means the two ways of moving through a list disagree.

**Recommended approach.** Add a UI-layer post-decision reconciliation in `decideAndAdvance` (and its group counterpart), mirroring the existing `moveWithinVisibleList` interception: after dispatching, if the resulting `focus.target.itemId` is not present in the current visible list, dispatch `navigation.selectItem` for the next unresolved id in the visible list. Deliberately keep this in `app.ts` — `FocusNavigator` must not learn about UI-only narrowing (Phase 9 boundary).

Also close the documented scope limit in `moveWithinVisibleList`'s own doc comment: extract Category Check's `stateFiltered`/`categoryFilter` narrowing out of `renderCategoryCheckPanel`'s DOM pass into a side-effect-free function both the renderer and `visibleItemCheckIds()` can call, so arrow keys and post-decision advance both respect Category Check narrowing.

**Affected files.** `src/ui/app.ts` (`decideAndAdvance`, `decideGroupAndAdvance`, `visibleItemCheckIds`, `renderCategoryCheckPanel`).

**Architectural risk.** Low. Additive UI-layer interception; no domain change. The `FocusNavigator` boundary is preserved.

**Verification.** New pure-function suite for the extracted Category Check filter. **Live browser validation required** for the advance behavior.

**Acceptance criteria.**
1. With Item Check sorted alphabetically and no filter, deciding an item moves focus to the next undecided item **in alphabetical order**, not structural order.
2. With the "Unreviewed only" preset active, deciding an item moves focus to another item that is currently rendered; a row is visibly focused and expanded after every decision.
3. In Category Check view with "To Review" selected and a category filter active, arrow keys and post-decision advance traverse only candidates matching both narrowings.
4. In Group Check with sort set to "Alphabetical," deciding a group advances to the next undecided group in alphabetical order.
5. `FocusNavigator`/`navigator.ts` is unchanged by this item.

---

## RX-12 · Advance never dead-ends (backward fallback)

**Priority:** High **Effort:** S **Dependencies:** RX-02 (share the same code path)

**Current behavior.** `findUnresolved(itemIds, index, "forward", ...)` scans forward only. A reviewer who decides the last undecided item near the bottom of a list, with undecided items remaining above, is left with focus clamped at the end and no automatic route back.

**Desired behavior.** If no unresolved item exists forward of the current position, scan backward from the current position before giving up. Only when no unresolved item exists in either direction does focus remain where it is.

**Reviewer benefit.** The reviewer is never stranded at the end of a list with work still outstanding.

**Why this matters.** Python does this explicitly (`nextUndecidedAfter`, `app.js:446–451`: forward loop, then backward loop, then fall back to current). It is a small behavior that removes a whole category of "why isn't it moving?" moments.

**Recommended approach.** Implement in the RX-02 UI-layer advance helper over the visible list. Do **not** change `findUnresolved` in `navigator.ts` — that would alter tested domain behavior for a UI-motivated reason, and the visible-list helper is where the reviewer-facing semantics belong.

**Affected files.** `src/ui/app.ts`.

**Architectural risk.** None if kept in the UI layer as described.

**Verification.** Unit-testable as a pure function over an id list plus a resolved-predicate. **Live browser validation** for the end-of-list case.

**Acceptance criteria.**
1. Deciding the last undecided item in a list, with undecided items remaining earlier in that list, moves focus backward to the nearest earlier undecided item.
2. When every item in the visible list is decided, focus remains on the just-decided item and no navigation occurs.
3. Backward scan stops at the start of the visible list; it does not wrap past it.

---

## RX-13 · Real DOM focus for the focused row

**Priority:** Critical **Effort:** M **Dependencies:** none — but blocks RX-01's simplification, RX-10, and most of RX-25

**Current behavior.** Two focus models coexist. Item Check and Ambiguity Check simulate focus: rows are `<div>`s with a click handler on an inner `<span>`, `document.activeElement` stays on `<body>` after every render, and `.item-row-focused` is painted purely from `FocusState`. Group Check uses **real** DOM focus via `attachRovingGridNav`, which immediately collided with `shouldIgnoreKeyboardEvent`'s blanket block and required `isRovingFocusElement` as a narrow exception.

**Desired behavior.** The focused candidate/group row is a real focusable element (`tabindex="-1"`) that receives `.focus()` after render. `shouldIgnoreKeyboardEvent`'s call site is widened from "is anything focused" to "is focus inside a text-entry control," so shortcuts work while a row (or a roving-grid control) has focus.

**Reviewer benefit.** The reviewer sees a real, browser-native focus ring; the browser scrolls the focused row into view automatically; screen readers announce movement; and the same focus model applies in every stage.

**Why this matters.** `review-workspace-specification.md` §7.6 records body-focus as intentional and correct. That claim began as an observation about a re-render side effect and is now paying for itself in RX-01, an absent focus ring, zero accessibility, and a second focus model with a bespoke exception. Python's `.candidate-cell` is a plain `<button>` that gets real focus, and its keyboard gate asks *where* focus is (`resultGridHasKeyboardFocus`) rather than *whether* anything has it.

**Recommended approach.**
1. Give `.item-row` / `.group-row` `tabindex="-1"` and move the click handler from the inner label to the row.
2. In `render()`, focus the row carrying `.item-row-focused` (guard: skip if an inline editor or the search input has claimed focus — both already have restoration logic that must take priority).
3. Replace the `shouldIgnoreKeyboardEvent(activeTag) && !isRovingFocusElement(activeEl)` gate in the global keydown handler with a positive check: ignore shortcuts only when focus is inside `input[type=text]`/`input[type=search]`/`textarea`/`select`, or inside an open `.inline-editor`. Leave `keymap.ts`'s ported `shouldIgnoreKeyboardEvent` **unchanged** — it stays a faithful DOM-free port; the widened rule is a UI-layer decision, consistent with `isRovingFocusElement`'s own precedent.
4. Add `:focus-visible` styling for `.item-row` / `.group-row`.
5. `isRovingFocusElement` should be reviewed for possible removal once the gate is positive rather than exclusionary.

**Affected files.** `src/ui/app.ts` (`renderCandidateStage`, `renderGroupStage`, `render()`, global keydown handler, possibly delete `isRovingFocusElement`), `index.html` (focus styles).

**Architectural risk.** **Medium — the highest in this backlog.** It changes the keyboard gate, which every shortcut depends on. Two specific hazards: (a) a focus grab fighting the inline editor's own restoration, (b) shortcuts firing while a text field has focus. Both are covered by acceptance criteria below.

**Verification.** Extend `verify/focus-navigator-verification.ts` where domain-observable. **Live browser validation required and non-negotiable** — this item cannot be signed off from Node.

**Acceptance criteria.**
1. After any focus change, `document.activeElement` is the row element carrying `.item-row-focused`, in all three item-bearing stages.
2. A visible `:focus-visible` ring is rendered on the focused row.
3. Typing in the Item Check search input does **not** trigger K/C/R/I; the typed characters appear in the input.
4. Typing in an open inline editor does **not** trigger K/C/R/I; Enter confirms and Escape cancels as before.
5. With an inline editor open, `render()` focuses the editor's input or current quick-pick chip — not the row.
6. Group Check's roving grid navigation (Left/Right across row controls, Up/Down between row and members) is unchanged.
7. Tab from a focused row still moves to the next item, not to a browser-focusable element in the top bar.
8. `src/engines/navigation/keymap.ts` is unchanged by this item.

---

## RX-30 · Keyboard coverage audit and reconciliation

**Priority:** Medium **Effort:** S **Dependencies:** RX-13 (audit after the focus model settles)

**Current behavior.** Shortcut coverage differs per stage in ways the command bar states but does not explain: `/` and `[`/`]` are Item Check only; Enter/Escape are unbound in Group Check; directional row navigation exists only in Group Check; `q` is now bound to nothing after the Not Quite → Fix this rebinding; and PageUp/PageDown is documented in `phase-9-findings.md` as ported but is bound to nothing.

**Desired behavior.** A single reconciled shortcut table, with every difference either eliminated or recorded with a stated reason. The two documentation discrepancies (PageUp/PageDown, `q`) are resolved.

**Reviewer benefit.** The reviewer can form one mental model of the keyboard instead of three.

**Why this matters.** Individually defensible gaps compound into a keyboard that behaves differently depending on where you are, which is precisely the cost a keyboard-first design exists to avoid.

**Recommended approach.** Produce the table, decide each row (implement / deliberately omit with a reason / correct the doc), update `keymap.ts`'s doc comment and `review-workspace-specification.md` §7.3 to match reality. Bind PageUp/PageDown or correct `phase-9-findings.md`; add an explicit "`q` is intentionally unbound" note.

**Affected files.** `src/engines/navigation/keymap.ts` (doc comment, possibly bindings), `docs/architecture/review-workspace-specification.md`, `docs/detection/phase-9-findings.md`.

**Architectural risk.** Low.

**Verification.** `verify/focus-navigator-verification.ts` gains a case per newly-bound key.

**Acceptance criteria.**
1. A shortcut table exists in `keymap.ts`'s doc comment listing every key × every stage, with each cell marked bound / deliberately unbound (with reason).
2. `review-workspace-specification.md` §7.3 matches that table exactly.
3. PageUp/PageDown is either bound and tested, or `phase-9-findings.md` is corrected to state it was not ported.
4. No key resolves to different commands in two stages without an explicit recorded reason.

---

# Wave 2 — Stop the view fighting the reviewer

## RX-04 · Sticky workspace chrome

**Priority:** High **Effort:** S **Dependencies:** none

**Current behavior.** `index.html` contains no `position: sticky` or `position: fixed`. The whole page scrolls as one, so scrolling into a long candidate list scrolls away the stage tabs, command bar, review statistics, persistence status, and search box.

**Desired behavior.** The stage tabs, command bar, and review statistics remain visible while the stage body scrolls beneath them.

**Reviewer benefit.** Progress counts and the shortcut legend stay available; the reviewer stops scrolling to the top for orientation and back down to resume.

**Why this matters.** Python's `header` is `position: sticky; top: 0; z-index: 4`. This is a one-line difference with a continuous cost.

**Recommended approach.** Wrap the document line, statistics, stage tabs, and command bar in a `.workspace-chrome` container with `position: sticky; top: 0; z-index: 2` and an opaque background. Verify it does not obscure the focused row during RX-01's `scrollIntoView` — `block: "nearest"` respects sticky elements only if `scroll-margin-top` is set on the rows; add it.

**Affected files.** `index.html` (CSS), `src/ui/app.ts` (`render()` grouping only — no logic change).

**Architectural risk.** None.

**Verification.** **Live browser validation required.**

**Acceptance criteria.**
1. Scrolling to the bottom of a 200-candidate list keeps stage tabs, command bar, and statistics visible.
2. The sticky chrome never overlaps the focused row after a keyboard-driven scroll (verify with the first and last items in a long list).
3. Sticky chrome does not appear on the landing/Recent Documents view.

---

## RX-06 · Stable result set while reviewing

**Priority:** High **Effort:** M **Dependencies:** none

**Current behavior.** In Category Check view with `categoryReviewState === "toReview"` (the default `jumpToCategory` sets), deciding a candidate immediately removes it from the rendered list and shifts every subsequent row up. The same occurs in list view with the "Unreviewed only" preset active.

**Desired behavior.** Membership of the currently displayed result set is frozen when the reviewer changes the query (search, preset, sort, review state, category). Decisions made within that set do **not** remove items from it — the item stays in place, visibly showing its new decision. A `Refresh list (N)` control re-applies the filter when the reviewer chooses.

**Reviewer benefit.** The list holds still. A reviewer can decide ten items in sequence without re-finding their place, and can see what they just did.

**Why this matters.** Python implements exactly this (`qualityResultSetCandidates`, `qualityPendingChangeKeys`, `acceptQualityResultChanges`). `review-workspace-specification.md` §7.3 dismisses it as a "live-rescore reconciliation workflow" that may not apply here. Rescoring was Python's *occasion* for building it; **list stability is what it does**, and that need is architecture-independent.

**Recommended approach.** Add module-level `resultSetSignature: string | null` and `resultSetIds: string[]` to `app.ts`, mirroring Python's shape. Recompute `resultSetIds` when the signature (search text + preset set + sort + review state + category) changes; otherwise intersect the freshly-filtered pool with `resultSetIds`. Track `pendingChangeIds: Set<string>` for items decided within the frozen set and surface a count. Naming: Python's "Accept changes" is opaque — prefer `Refresh list (N)` or `Re-apply filter (N)`, which says what it does.

**Affected files.** `src/ui/app.ts`, `src/ui/itemCheckQuery.ts` (signature helper — keep the freeze logic pure and unit-testable).

**Architectural risk.** Low, but there is a real failure mode: a stale frozen set outliving a document reload. Clear it on document load, resume, and stage change.

**Verification.** New pure-function suite for signature computation and freeze/intersect semantics. **Live browser validation required.**

**Acceptance criteria.**
1. With "Unreviewed only" active, deciding a candidate leaves it in place in the list, showing its new decision inline.
2. The row below the decided candidate does not move.
3. A `Refresh list (N)` control appears with N = number of decided-but-still-shown items, and is disabled when N = 0.
4. Activating it re-applies the current filter, removes the now-non-matching items, and resets N to 0.
5. Changing the search text, any preset, the sort order, the review state, or the category re-freezes the set and resets N to 0.
6. Loading a new document or resuming a session clears the frozen set entirely.

---

## RX-09 · Non-blocking notifications; retire `window.alert()`

**Priority:** High **Effort:** S **Dependencies:** RX-18 (shares the status region)

**Current behavior.** Thirteen live `window.alert()` call sites in `app.ts` (lines 326, 817, 827, 831, 843, 864, 890, 917, 941, 1264, 1760, 2519, 2720), covering the failure paths for document load, session resume, save, output generation, audit generation, decision import, and every bulk action.

**Desired behavior.** All twelve route through a non-blocking notification component: a transient toast for successes and recoverable failures, a persistent inline banner for failures the reviewer must act on (output generation, session resume).

**Reviewer benefit.** Nothing interrupts the workflow with OS chrome; failures read as considered application responses rather than browser errors.

**Why this matters.** You already made this call: Feature 002 replaced a success `alert()` with a non-modal banner, and you called `prompt()` "unacceptable for both scope and UX." The pattern was never generalized. The most consequential remaining case is output-generation failure (`app.ts:2519`) — the highest-stakes moment in the product.

**Recommended approach.** One `notify(message, level)` helper writing to the RX-18 status region, plus a transient toast modeled on Python's `#actionToast` (~1.3s visible, 180ms fade). Failures requiring action render as a dismissible inline banner near the control that triggered them, reusing `renderImportSummaryBanner`'s existing shape rather than inventing a second banner mechanism.

**Affected files.** `src/ui/app.ts` (12 call sites + new helper), `index.html` (toast/banner CSS).

**Architectural risk.** Low. One hazard: silently swallowing an error that previously blocked. Every converted site must remain visible for at least the toast duration and must be logged.

**Verification.** `verify/ui-smoke.ts` asserts zero `window.alert` references remain. **Live browser validation required** for the output-failure path specifically.

**Acceptance criteria.**
1. `grep -c 'window.alert(' src/ui/app.ts` returns 0 (currently 14 matches: 13 calls plus one doc-comment mention, which should also be updated).
2. Every previously-alerting failure produces a visible message without blocking interaction.
3. Output-generation failure produces a persistent inline banner, dismissible, stating the reason.
4. Success messages auto-dismiss within 2 seconds; failure messages do not auto-dismiss.
5. Notifications never shift page layout (overlay or reserved space, not inserted flow content).

---

## RX-14 · Acknowledgement stops gating progression

**Priority:** High **Effort:** S **Dependencies:** none

**Current behavior.** `isExpanded = isAcknowledging || isFocused` keeps the just-decided row expanded for `ACKNOWLEDGEMENT_MS = 700` while real focus has already advanced. Two consequences: two detail panels render expanded simultaneously for 700ms, and a fast reviewer is held for 700ms per decision (~9 minutes over 800 candidates).

**Desired behavior.** Focus and expansion advance immediately on decision. The acknowledgement pulse plays on the **leaving** row while the new row is already focused and expanded. Exactly one detail panel is expanded at any instant.

**Reviewer benefit.** The reviewer still sees each decision land, but the app never gets slower the faster they work.

**Why this matters.** You asked for the 0.5–1s beat explicitly, and the pulse is a good, calm cue worth keeping. The part worth reconsidering is coupling it to progression. Python gets the same reassurance from a non-blocking toast while the view advances immediately — feedback and progression are decoupled.

**This item changes behavior you specified, so it needs your explicit approval rather than being folded into a wave.**

**Recommended approach.** Remove `isAcknowledging` from the `isExpanded` expressions in `renderCandidateStage` and `renderGroupStage`. Keep `acknowledge()`, `isAcknowledged()`, `.item-row-acknowledged`, and `.row-acknowledged-pulse` exactly as they are — they apply to the leaving row, which remains in the list. Optionally shorten `ACKNOWLEDGEMENT_MS` to ~400ms now that it no longer gates anything.

**Affected files.** `src/ui/app.ts` (two `isExpanded` expressions).

**Architectural risk.** None. `acknowledgement` remains the same ephemeral state; only its effect on expansion is removed.

**Verification.** **Live browser validation required** — the whole point is perceptual.

**Acceptance criteria.**
1. Immediately after a decision, exactly one row carries `.item-row-focused` and exactly one detail panel is rendered.
2. The just-decided row shows the acknowledgement pulse and colour change while the newly-focused row is already expanded.
3. Deciding ten items in rapid succession (faster than `ACKNOWLEDGEMENT_MS`) produces ten advances with no dropped or duplicated focus, and never more than one pulse at a time.
4. Keyboard-driven and mouse-driven decisions behave identically.

---

## RX-18 · Persistent status region

**Priority:** Medium **Effort:** S **Dependencies:** none — enables RX-09 and part of RX-25

**Current behavior.** No status channel. Refused or no-op actions are silent. The persistence line is the only always-present text feedback and reports only save state.

**Desired behavior.** One `aria-live="polite"` region in the workspace chrome, used for transient toasts (RX-09), quiet narration ("Filter re-applied. 240 results."), and explanations of refusals.

**Reviewer benefit.** The application explains itself instead of doing nothing visible.

**Why this matters.** Python has this (`status()`, `app.js:300`) and uses it for things Web currently cannot express at all — notably explaining a *refusal*: "This candidate was resolved in Group Check. Open detail to inspect it." Web has no channel for that, so those cases are silent.

**Recommended approach.** A single `<div role="status" aria-live="polite" aria-atomic="true">` in the sticky chrome (RX-04). One `setStatus(text)` writer. Deliberately not a log — the region shows the latest message only, matching Python.

**Affected files.** `src/ui/app.ts`, `index.html`.

**Architectural risk.** None. One caution: writing to it on every `render()` would cause continuous screen-reader chatter — write only on discrete events.

**Verification.** `verify/ui-smoke.ts` structural check. **Live browser validation** with VoiceOver for announcement behavior.

**Acceptance criteria.**
1. A single `role="status" aria-live="polite"` element exists and persists across renders.
2. It is written to only on discrete reviewer-visible events, never on every render.
3. At minimum: filter re-application, bulk action results, decision-import results, and every refused/no-op action write to it.
4. Its content is not cleared by an unrelated `render()`.

---

# Wave 3 — Density and scale

## RX-23 · Decision controls only on the focused row

**Priority:** Medium **Effort:** S **Dependencies:** none — validates RX-03's direction cheaply

**Current behavior.** Every candidate row renders Keep, Change, Redact, Ignore plus a selection checkbox, whether focused or not. At 500 candidates that is ~2,500 controls in the DOM.

**Desired behavior.** Unfocused rows render name, occurrence count, type, confidence badge, and decision state only. Decision controls render on the focused/expanded row.

**Reviewer benefit.** Roughly halves row height, roughly doubles items visible per screen, and removes the strongest source of visual competition from a scanning surface.

**Why this matters.** A reviewer scanning 500 candidates is shown 2,000 buttons they will not click. Python shows decision controls only where a decision is being made. This delivers a meaningful share of RX-03's benefit at a fraction of the risk, and is a good way to confirm the direction before committing to the full grid.

**Recommended approach.** Move the `decisionButtons(...)` call inside the `if (isExpanded)` branch in `renderCandidateStage`. Keep the bulk-select checkbox on all rows (it is a multi-select affordance, not a decision control) — or move it behind the bulk toolbar's own "select mode," which is a separate decision worth making explicitly.

**Affected files.** `src/ui/app.ts` (`renderCandidateStage`).

**Architectural risk.** Low. One real trade-off: mouse users lose one-click deciding of an unfocused row and must click the row first. Given the keyboard-first design, that is acceptable — but it is a genuine regression for mouse-driven review and should be confirmed with you.

**Verification.** **Live browser validation required.**

**Acceptance criteria.**
1. Unfocused candidate rows contain no `<button>` elements other than the row itself.
2. The focused row renders all four decision controls.
3. Clicking an unfocused row focuses it and reveals its controls in a single click.
4. Keyboard K/C/R/I on a focused row is unchanged.
5. Measured on a ≥ 200-candidate document, items visible in a 900px viewport increase by ≥ 60%.

---

## RX-27 · Scope the render, stop rebuilding the page

**Priority:** High **Effort:** M **Dependencies:** none — prerequisite for RX-03/RX-05 being affordable

**Current behavior.** `render()` sets `container.innerHTML = ""` and rebuilds everything — top bar with four file inputs, document line, persistence status, import banner, statistics, warnings, stage tabs, command bar, and the entire stage body — on every state change, including every search keystroke and every background autosave.

**Desired behavior.** Only the region that changed is rebuilt. The stage body rebuilds on state change; chrome updates in place.

**Reviewer benefit.** Search stays responsive on large documents; incidental re-renders stop disturbing whatever the reviewer was doing.

**Why this matters.** This single behavior is the root cause of four separate workarounds already in the file: `searchInputFocusPending`, the `detailsEl` open-key registry, the inline editor's deliberate no-re-render-while-typing design, and the roving-grid focus restoration. Fixing the cause retires at least two of them.

**Explicitly not recommended:** a framework, a bundler, or a diffing library. The zero-dependency, explicit-`.js`-specifier constraint is sound and should hold.

**Recommended approach.** Split `render()` into `renderChrome()` (in-place text updates against persistent nodes, no `innerHTML` clear) and `renderStageBody()` (existing rebuild, scoped to `.stage-body`). Keep the current rebuild semantics inside the stage body so no new correctness questions are introduced. Once chrome is stable across renders, re-evaluate whether `detailsEl`'s registry and `searchInputFocusPending` are still needed.

**Affected files.** `src/ui/app.ts` (`render()` and every `render*` helper's container assumption).

**Architectural risk.** **Medium.** Partial-update code is where stale-state bugs live, and this file's whole reliability story rests on "rebuild everything, never drift." Mitigation: keep every value in chrome derived fresh from `dispatcher.getState()` on each `renderChrome()` call — update the text of persistent nodes, never cache values.

**Verification.** `verify/ui-smoke.ts` extended for the split. **Live browser validation required**, specifically: type in search while an autosave fires, and open a `<details>` panel while an autosave fires.

**Acceptance criteria.**
1. Typing in the search input does not rebuild the top bar, statistics, stage tabs, or command bar DOM nodes (verifiable by holding a node reference across a keystroke).
2. Every chrome value (completion %, distribution, stage counts, persistence status) is still correct after any state change.
3. A background autosave completing while the reviewer types does not disturb the caret.
4. A background autosave completing while a `<details>` panel is open does not close it.
5. On a ≥ 1,000-candidate document, per-keystroke search latency is at least 3× lower than before.

---

## RX-05 · Pagination with position readout

**Priority:** High **Effort:** M **Dependencies:** RX-27 recommended first

**Current behavior.** Every filtered candidate is rendered. No page size, no pager, no position readout anywhere in `src/ui/`.

**Desired behavior.** A configurable page size (25/50/100/250, defaulting to 50) with a pager showing `Showing 1–50 of 1,247 · Page 1 of 25`, and Prev/Next controls. The page containing the focused item is selected automatically when focus moves outside the current page.

**Reviewer benefit.** The job acquires a shape and a measurable position within it, and the DOM stays a fixed size regardless of document size.

**Why this matters.** The current documentation files this as contingent on performance. The stronger argument is orientation: `Showing 1–50 of 1,247` is how a reviewer knows how big the job is and how far in they are. Infinite scroll answers neither question.

**Recommended approach.** Mirror Python's shape (`pageForKey`/`clampPage`/`renderPager`). Page state lives in `app.ts` as ephemeral UI state, keyed per stage. Critically: **`pageForKey` must run on every render** so that RX-02's focus advance automatically pulls the correct page into view — otherwise focus can land on a page that isn't displayed, reintroducing exactly the defect RX-02 fixes.

**Affected files.** `src/ui/app.ts`, `src/ui/itemCheckQuery.ts` (paging helpers as pure functions), `index.html` (pager CSS).

**Architectural risk.** Low, with one specific interaction: pagination and the RX-06 frozen result set must agree on what "the list" is. Compute paging over the frozen set, not the raw filtered pool.

**Verification.** New pure-function suite for `pageForKey`/`clampPage`. **Live browser validation required** for the focus-pulls-page behavior.

**Acceptance criteria.**
1. Item Check renders at most `pageSize` rows.
2. A readout shows `Showing X–Y of N` and `Page P of T`, both correct after any filter change.
3. Prev is disabled on the first page; Next is disabled on the last.
4. When focus moves to an item on another page (arrow keys, `]`/`[`, or post-decision advance), that page is selected and the item is scrolled into view.
5. Changing page size preserves the focused item and selects the page containing it.
6. Page resets to 1 when the query changes.
7. Group Check and Ambiguity Check gain the same pager (may ship with RX-07).

---

## RX-03 · Dense multi-column scan mode

**Priority:** Critical **Effort:** L **Dependencies:** RX-23, RX-27, RX-05, and RX-10 shipping alongside

**Current behavior.** One full-width row per candidate in a single column (`.item-list { flex-direction: column }`). ~11 candidates per 500px.

**Desired behavior.** Collapsed candidates render as compact cells in a responsive multi-column grid (target 4–6 columns at desktop width), each showing name, occurrence count, and decision state carried primarily by fill colour with a completion mark on resolved items. The focused candidate expands **in place** to full width with its detail panel, and the grid renders as a single column while anything is expanded.

**Reviewer benefit.** ~50 candidates per screen instead of ~11. Decisions readable as colour across the whole visible set. The reviewer scans a page instead of reading a list.

**Why this matters.** This is the largest single reviewer-experience gap between the two implementations and the primary source of fatigue on large documents. Python's `.review-grid` is `repeat(5, minmax(0, 1fr))` with 42px cells and a CSS-injected `✓` on resolved items; the expanded item takes the full width in place.

**Recommended approach.** Replace `.item-list`'s flex column with `display: grid; grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr))` so column count adapts to viewport width without JS. Collapsed cell content: display value, occurrence count, decision-state class. Expanded row spans `grid-column: 1 / -1`. Reuse the existing `GROUP_ROW_DECISION_CLASS` colour vocabulary so Item Check and Group Check agree on what each hue means. Ship with RX-10 — a multi-column grid whose arrow keys move 1D is worse than the current list.

Ambiguity Check should stay single-column: its rows carry possible-identity options that need width, and Python keeps `#ambiguousMatches` at one column for the same reason.

**Affected files.** `src/ui/app.ts` (`renderCandidateStage`), `index.html` (substantial CSS).

**Architectural risk.** **Medium** — largest visual change in this backlog, and it changes what "a row" means for the bulk-selection checkbox, the acknowledgement pulse, and RX-01's scroll target. All three must be re-verified.

**Verification.** **Live browser validation required**, at three viewport widths, on a ≥ 500-candidate document.

**Acceptance criteria.**
1. In a 1,440px viewport, Item Check shows ≥ 40 collapsed candidates without scrolling (assuming ≥ 40 in the filtered set).
2. Column count adapts to viewport width with no JS measurement and no horizontal scrollbar at ≥ 768px.
3. The focused candidate spans the full grid width, in place, with the detail panel directly beneath it.
4. Each of Keep / Change / Redact / Ignore has a distinct collapsed-cell fill colour, matching Group Check's existing hues.
5. Resolved candidates show a completion mark in the collapsed cell.
6. Arrow keys move by rendered geometry (RX-10): ↓ moves one visual row, → moves one visual column.
7. The acknowledgement pulse renders correctly on a collapsed cell.
8. Bulk selection remains usable; selected cells are visually distinct from decided ones.

---

## RX-10 · 2D arrow navigation matching rendered columns

**Priority:** Medium **Effort:** M **Dependencies:** ships with RX-03; also fixes RX-17

**Current behavior.** `keymap.ts:200–201` maps ArrowRight ≡ ArrowDown ≡ `next` and ArrowLeft ≡ ArrowUp ≡ `previous`. Redundant in one column; wrong in Group Check's two-column grid mode.

**Desired behavior.** In any multi-column rendered list, ↑/↓ move by one visual row (± column count) and ←/→ move by one visual column, clamped at both ends.

**Reviewer benefit.** Arrow keys move where the eye expects. Without this, a multi-column grid is not navigable by keyboard.

**Why this matters.** Python computes column count from real DOM geometry (`candidateGridColumnCount()` via `offsetTop` collisions; `navigateActiveGroup` via `getBoundingClientRect` nearest-neighbour scoring) — this is why its five-column grid works at all.

**Architecturally important:** this must stay entirely in the UI layer. `review-workspace-specification.md` §7.2's decision to keep 2D remapping out of `FocusNavigator` is correct and should not be revisited.

**Recommended approach.** Extend the existing `moveWithinVisibleList` interception. Compute column count by counting rendered cells sharing the first cell's `offsetTop` (Python's approach — simple, no `getBoundingClientRect` loop, correct for a uniform grid). Return 1 whenever anything is expanded, matching Python. Map ↓/↑ to ±columns and →/← to ±1 over the visible list.

**Affected files.** `src/ui/app.ts` (`moveWithinVisibleList` and the keydown interception).

**Architectural risk.** Low. Reads DOM geometry, which is correct in the UI layer and forbidden below it. `keymap.ts` and `navigator.ts` remain unchanged.

**Verification.** Column-count computation is unit-testable against a synthetic offset list. **Live browser validation required** for real movement.

**Acceptance criteria.**
1. In a 5-column Item Check grid, ↓ from cell 1 focuses cell 6; → focuses cell 2.
2. ↓ from the last visual row clamps (no wrap).
3. → from the last cell in a row clamps at the row end, not the next row's first cell.
4. While a candidate is expanded, ↓/↑ move to the previous/next item sequentially (column count = 1).
5. In Group Check's 2-column mode, → moves to the group rendered to the right, not the one below.
6. `src/engines/navigation/keymap.ts` and `navigator.ts` are unchanged by this item.

---

# Wave 4 — Consistency and coverage

## RX-22 · Single display-label vocabulary

**Priority:** High **Effort:** S **Dependencies:** none

**Current behavior.** Visible simultaneously in Item Check: button "Change", decided-row label "Rename" (`app.ts:2037` renders `decided.decision` directly), statistics "Rename", filter chip "Renamed", bulk button "Change selected", legend "C Change". Not Quite similarly shows "Fix this" in the UI while CSS classes, findings docs, and the specification all say "Not Quite."

**Desired behavior.** One display-label map. No reviewer-facing surface renders a raw `CandidateDecisionKind`.

**Reviewer benefit.** One word per concept. The reviewer never has to infer that "Change" and "Rename" are the same action.

**Why this matters.** Keeping `"Rename"` as the durable audit/schema vocabulary is correct and must not change — it is embedded in saved sessions and audit trails. The defect is the absence of a display mapping, which lets the durable vocabulary leak wherever a decision string is rendered directly.

**Recommended approach.** `const DECISION_DISPLAY_LABEL: Record<CandidateDecisionKind, string>` in `src/ui/`, exhaustive by construction. Substitute at every rendering site (row label, statistics, filter preset labels, bulk buttons, command bar legend, group action labels). Optionally rename CSS classes and the specification's prose, but that is cosmetic and separable.

**Affected files.** `src/ui/app.ts`, `src/ui/itemCheckQuery.ts` (preset labels).

**Architectural risk.** None. Display-only; no schema, command, or serialization change.

**Verification.** `verify/ui-smoke.ts` asserts no rendering site interpolates `decision.decision` directly.

**Acceptance criteria.**
1. A single exhaustive `Record<CandidateDecisionKind, string>` map exists.
2. Every reviewer-visible surface uses it; `grep` finds no direct interpolation of a decision kind into DOM text.
3. Deciding a candidate via "Change" produces a row label reading "Change", and the statistics bar counts it under "Change".
4. The saved session file, audit CSV, and `decisions.json` still contain `"Rename"` — no serialization change.
5. "Fix this" is used consistently in every reviewer-visible string (panel heading, exit, completion).

---

## RX-20 · Retire the permanent top bar

**Priority:** High **Effort:** M **Dependencies:** none

**Current behavior.** `render()` unconditionally emits, above everything, on every stage: a "Load document" file input, "← Documents", "Save Session", a "Resume session" label + two file inputs + a "Resume" button, and an "Import prior decisions" file input. Four raw `<input type="file">` elements permanently at the top of the workspace.

**Desired behavior.** The workspace header carries the document name, completion, and stage tabs. Document-lifecycle actions (load, save, resume, import) live behind a single collapsed "Document" menu or on the landing page.

**Reviewer benefit.** The most visually prominent area stops being occupied by controls used twice per session; the tab order stops starting with three file pickers.

**Why this matters.** Neither implementation gets this right (Python's `.filebar` has the same disease plus a "Restart local app" developer button), so this is a Remove-and-replace rather than a port.

**Recommended approach.** Move Load/Resume/Import into the Recent Documents landing view, which is already the natural home for "start or continue work." Keep only Save Session and a "Document ▾" disclosure in the workspace header. Resume-with-docx is only needed before Generate Output — move that input into the Output stage where it is actually used, which also removes the "why do I need the .docx again?" confusion at load time.

**Affected files.** `src/ui/app.ts` (`render()`, `renderRecentDocuments`, `renderOutputStage`), `index.html`.

**Architectural risk.** Low, with one real hazard: making Resume/Import harder to find. Both must remain reachable in ≤ 2 clicks from the workspace.

**Verification.** **Live browser validation required** for the full load → review → save → resume → import cycle.

**Acceptance criteria.**
1. No `<input type="file">` is rendered in the workspace header while a document is loaded.
2. Load, Resume, and Import are reachable in ≤ 2 clicks from any stage.
3. The "+ original docx" input appears in the Output stage, adjacent to Generate Output.
4. The full lifecycle (load → decide → save → reload → resume → import decisions → generate) completes without regression.
5. Tab from the first focused row does not reach a file input.

---

## RX-15 · Command bar becomes legend-only

**Priority:** Medium **Effort:** S **Dependencies:** none

**Current behavior.** `renderCommandBar` emits the shortcut legend, a selection count, "Next undecided", "Previous decision", "Next ambiguity", and a "Jump to category" select — in one strip. "Next ambiguity" renders on every stage including Output and the empty QA stub.

**Desired behavior.** The command bar contains only the contextual shortcut legend and the current selection count. Navigation actions move to the stage toolbar. Stage-irrelevant actions do not render.

**Reviewer benefit.** One place to look for "what can I press," separate from "what can I click." Each reads faster.

**Why this matters.** Python's command bar is purely a contextual legend and hides itself entirely when there is no relevant context (`max-height: 0; opacity: 0; visibility: hidden`, 140ms transition). Mixing reference and action trains the reviewer to scan the strip for both.

**Recommended approach.** Keep `commandBarLegend()` unchanged — the derivation is the good part. Move Next undecided / Previous decision / Next ambiguity / Jump to category into `renderItemCheckToolbar` (and add "Next ambiguity" to Ambiguity Check's new toolbar from RX-07). Consider Python's hide-when-empty behavior for stages with no legend.

**Affected files.** `src/ui/app.ts` (`renderCommandBar`, `renderItemCheckToolbar`).

**Architectural risk.** None.

**Acceptance criteria.**
1. The command bar contains only legend text and, in Item Check, a selection count.
2. Every navigation action previously in the bar is present in the relevant stage toolbar.
3. "Next ambiguity" does not render in Output or QA.
4. `commandBarLegend()`'s per-context derivation is unchanged.

---

## RX-07 · Query tools for Ambiguity Check and Group Check

**Priority:** Medium **Effort:** M **Dependencies:** RX-05 (share the pager)

**Current behavior.** Ambiguity Check has no toolbar at all. Group Check has sort only. Python gives both search, type filter, sort, direction, page size, and a pager.

**Desired behavior.** Both stages get search and a type filter, reusing Item Check's toolbar shape. Group Check adds a "Needs attention first" sort order. Both get RX-05's pager.

**Reviewer benefit.** The same query vocabulary works in every stage; large group and ambiguity sets become workable.

**Why this matters.** The "Group Check doesn't have Item Check's scale problem yet" reasoning is true for a 40-group document and false for a 400-group one — groups scale with document size the same way candidates do. Ambiguity Check having no tools at all is harder to defend.

**Note:** `groupDisplayDecision` already computes a `needsAttention` state, so the sort order is a near-free addition that directly serves triage — Python has it (`erSort`'s `needs_review`) and Web does not.

**Recommended approach.** Generalize `itemCheckQuery.ts`'s pure query shape rather than duplicating it; `groupCheckQuery.ts` already establishes the per-stage-module pattern. Search fields: canonical name and member display values for groups; display value and possible-identity names for ambiguity.

**Affected files.** `src/ui/app.ts`, `src/ui/groupCheckQuery.ts`, new `src/ui/ambiguityCheckQuery.ts`.

**Architectural risk.** Low. `visibleGroupIds()` already feeds `moveWithinVisibleList`, so RX-02/RX-10 pick up the new narrowing automatically — verify this rather than assuming it.

**Verification.** New pure-function suites per query module. **Live browser validation** for arrow-key order under an active filter.

**Acceptance criteria.**
1. Ambiguity Check renders a search input and a type filter; both narrow the list live.
2. Group Check renders a search input and a type filter.
3. Group Check's sort options include "Needs attention first", ordering `needsAttention` groups before all others.
4. Arrow keys and post-decision advance in both stages follow the filtered/sorted order (RX-02 interaction verified, not assumed).
5. `/` focuses the search input in whichever stage has one.

---

## RX-08 · Occurrence location, numbering, and highlight

**Priority:** Medium **Effort:** S **Dependencies:** none

**Current behavior.** Snippets render as plain text `${before}[${match}]${after}` (`app.ts:1413, 1430`) — literal square brackets, no location, no numbering.

**Desired behavior.** Each occurrence renders as `N. <location>: <before><mark>match</mark><after>`, numbered continuously across occurrence groups.

**Reviewer benefit.** The reviewer can tell *where in the document* each occurrence sits — the load-bearing fact when deciding whether two mentions refer to the same person — and the matched text is visually distinguishable at a glance.

**Why this matters.** Python renders `${globalIndex}. ${occ.location}: ${occ.context}` and converts the bracket markers into real `<mark>` elements (`highlightedContext`, `app.js:1111`). Both were lost in migration. Literal brackets in muted grey text are the weakest available way to say "this is the part that matters."

**Recommended approach.** Replace the template-string interpolation with three appended nodes (`before` text, `<mark>` with `match`, `after` text) — avoids any HTML-injection question that string concatenation would raise. Confirm what location data `ReviewOccurrence` actually carries before promising a format; if the domain lacks a usable location, that is a separate finding to raise rather than something to fabricate.

**Affected files.** `src/ui/app.ts` (`renderCandidateDetailPanel`), `index.html` (`mark` styling).

**Architectural risk.** None, provided location data already exists on `ReviewOccurrence`. If it does not, split this item.

**Acceptance criteria.**
1. Each snippet renders the matched text inside a `<mark>` with a visually distinct background.
2. No literal `[` or `]` characters are introduced by the renderer.
3. Occurrences are numbered continuously across occurrence groups within one candidate.
4. Each occurrence shows its document location when the domain provides one; when it does not, the number and text render without an empty separator.
5. Candidate text containing HTML-significant characters renders literally.

---

## RX-17 · Fix or retire Group Check 2-column mode

**Priority:** Medium **Effort:** S **Dependencies:** RX-10 for the navigation half

**Current behavior.** In `renderGroupStage`, the member list is appended to `list` as a **sibling** of the group row (`app.ts:2391`), not nested within it. Under `.group-list-grid` (a 2-column CSS grid), `.group-members` becomes its own grid cell and renders in the **adjacent column**, detached from its group. `.not-quite-panel` has `grid-column: 1 / -1` to work around exactly this; `.group-members` does not. Combined with RX-10, arrow keys also treat the 2-column grid as 1D.

**Desired behavior.** An expanded group's members render directly beneath their own group row, spanning the full grid width, and arrow keys move by rendered geometry.

**Reviewer benefit.** The 2-column mode becomes usable instead of misleading.

**Why this matters.** Shipping a visibly broken mode behind a toggle is worse than not offering it. If RX-10 is deferred, the correct interim action is to hide the toggle, not to leave it.

**Recommended approach.** Add `.group-list-grid .group-members { grid-column: 1 / -1 }`, matching the existing `.not-quite-panel` rule. Ship RX-10 alongside. If RX-10 is deferred, hide the layout toggle behind a flag.

**Worth considering while here:** Python does not offer a layout toggle at all — its Group Check goes to two columns automatically at `min-width: 1500px` (`style.css:146`). That is one fewer decision for the reviewer and one fewer piece of UI state, and it is the better model. Consider replacing the manual toggle with a media query rather than fixing it.

**Affected files.** `index.html` (CSS), `src/ui/app.ts` (`renderGroupCheckToolbar` if the toggle is hidden).

**Architectural risk.** None.

**Acceptance criteria.**
1. In 2-column mode, an expanded group's member list renders directly beneath that group's own row, full width.
2. No group row is visually adjacent to another group's member list.
3. With RX-10: → moves to the group rendered to the right; ↓ moves to the group rendered below.
4. If RX-10 is not yet shipped, the 2-column toggle is not rendered.

---

## RX-21 · Resolve the QA stage stub

**Priority:** Medium **Effort:** S (removal) / L (content) **Dependencies:** requires your decision first

**Current behavior.** The QA tab renders: *"No interactive QA model in this build -- see phase-9-findings.md ('qa'/'output' have no per-item traversal)."*

**Desired behavior.** Either the tab is removed from `WORKFLOW_STAGE_ORDER` and the tab bar, or it is given real content.

**Reviewer benefit.** The primary progress indicator stops containing a permanently empty entry that cites an internal document.

**Why this matters.** The specification records this as genuinely undecided. Leaving it undecided is the only option that costs the reviewer something every session — a wasted tab slot, a dead stop in `moveStage` traversal, and a developer-facing string in a reviewer product.

**Recommended approach.** Recommend removal. Category Check already answers the need "QA" originally described, and removing a stage is reversible while an empty tab quietly trains reviewers to skip part of the tab bar. Removal touches `WORKFLOW_STAGE_ORDER`, so check `verify/focus-navigator-verification.ts`'s stage-traversal expectations first.

**Affected files.** `src/domain/FocusState.ts`, `src/ui/app.ts`, `verify/focus-navigator-verification.ts`.

**Architectural risk.** Low but not zero — `WorkflowStage` is a domain type and may appear in serialized `FocusResumePosition` data. A saved session referencing `"qa"` must still load; add a migration fallback mapping it to `item-check`.

**Acceptance criteria.**
1. (If removed) The QA tab does not render; `moveStage` traverses Ambiguity → Group → Item → Output.
2. A saved session whose `FocusResumePosition` names the `qa` stage loads without error and lands on a valid stage.
3. No reviewer-visible string references a `docs/` path.

---

# Wave 5 — Production polish

## RX-25 · Accessibility baseline

**Priority:** Critical (for production readiness) **Effort:** M **Dependencies:** RX-13, RX-18

**Current behavior.** `grep -c 'aria-' src/ui/app.ts index.html` → **0 and 0**. No `role=`, no `aria-label`, no `aria-live`, no `aria-pressed`, no heading structure inside the workspace, no `:focus-visible` styling except on quick-pick chips.

**Desired behavior.** A WCAG 2.1 AA baseline: semantic roles, accessible names on every control, a live region for state changes, visible focus indication throughout, and verified contrast on every decision-state colour.

**Reviewer benefit.** The application is usable by reviewers who rely on assistive technology, and keyboard focus is visible to everyone.

**Why this matters.** Known and deliberately deferred, so this is a scheduling item rather than an oversight. Two things make it worth doing at this point specifically: the intended users are attorneys — a professional context where accessibility is frequently a procurement requirement — and **most of it is free once RX-13 lands.** Doing RX-13 without this means instrumenting the same DOM twice. Note that Python, which nobody audited either, got `role="status"`, `aria-live`, `aria-pressed`, `aria-label`, and `:focus-visible` for free by building out of semantic `<button>`s.

**Recommended approach.** Sequence: (1) `:focus-visible` on every interactive element; (2) accessible names on icon-only and ambiguous controls; (3) `aria-pressed` on decision buttons reflecting the current decision; (4) the RX-18 live region wired to decisions, filter changes, and stage changes; (5) `role="tablist"`/`role="tab"` on the stage tabs; (6) heading structure in the detail panel; (7) contrast audit of the eight decision-state colour pairs.

**Affected files.** `src/ui/app.ts` (broadly), `index.html`.

**Architectural risk.** Low individually; the risk is scope. Consider splitting into two items (structure/naming, then live-region/contrast) if it becomes unwieldy.

**Verification.** Automated axe-core pass if reachable without adding a dependency; otherwise a documented manual checklist. **Live browser validation required**, including a keyboard-only pass and a VoiceOver pass over one complete review cycle.

**Acceptance criteria.**
1. Every interactive element shows a visible focus indicator with ≥ 3:1 contrast against its background.
2. Every control has an accessible name; no control is announced only as "button".
3. Decision buttons expose `aria-pressed` reflecting the candidate's current decision.
4. Deciding a candidate produces one screen-reader announcement naming the candidate and the decision.
5. Stage tabs use `role="tablist"`/`role="tab"` with correct `aria-selected`.
6. All text and all decision-state colour pairs meet WCAG AA contrast (4.5:1 normal, 3:1 large).
7. One complete review cycle (load → decide 5 candidates → save) is completable using only the keyboard, with focus visible at every step.

---

## RX-26 · `prefers-reduced-motion` guard

**Priority:** Low **Effort:** XS **Dependencies:** none

**Current behavior.** `.row-acknowledged-pulse` runs a `scale(1.012)` transform plus a box-shadow animation on every decision — potentially hundreds of times per session — with no reduced-motion guard. `index.html` contains exactly one media query (`max-width: 900px`).

**Desired behavior.** Under `prefers-reduced-motion: reduce`, the acknowledgement conveys state through colour change only, with no transform or animation.

**Reviewer benefit.** A vestibular-sensitive reviewer is not subjected to hundreds of scale animations per session.

**Recommended approach.** `@media (prefers-reduced-motion: reduce) { .row-acknowledged-pulse { animation: none } }`. The `.item-row-acknowledged` colour change already carries the meaning unaided.

**Affected files.** `index.html`.

**Architectural risk.** None.

**Acceptance criteria.**
1. With reduced motion enabled at OS level, deciding a candidate produces no transform or animation.
2. The acknowledgement remains visible via colour and the `✓` badge.
3. Acknowledgement timing is unchanged.

---

## RX-28 · Empty, loading, and error states

**Priority:** Medium **Effort:** M **Dependencies:** RX-09, RX-18

**Current behavior.** Parsing a `.docx` blocks with no indication. Empty stages render a bare sentence ("Nothing to review in this stage.") with no suggested next action. Errors are `alert()`s.

**Desired behavior.** A visible progress indication during parsing/detection; empty states that state why the stage is empty and offer the next action; inline error states with a recovery path.

**Reviewer benefit.** The reviewer is never looking at a screen that does not explain itself.

**Recommended approach.** A determinate-if-possible progress indicator during load. Empty-state components carrying a cause and an action ("No ambiguous names were found in this document. → Go to Item Check"). Error states inline where the failure occurred, not in a dialog.

**Affected files.** `src/ui/app.ts`, `index.html`.

**Architectural risk.** Low. One caution: parsing is synchronous today — a progress indicator may require yielding to the event loop, which is a real change worth scoping separately if so.

**Acceptance criteria.**
1. Loading a ≥ 1MB `.docx` shows a visible progress indication within 200ms of selection.
2. Each empty stage states the reason and offers at least one next action.
3. No reviewer-facing error is presented in a modal dialog.
4. Every error state offers a recovery path (retry, choose another file, or continue).

---

## RX-29 · Density and responsive breakpoints

**Priority:** Low **Effort:** M **Dependencies:** RX-03

**Current behavior.** One media query (`max-width: 900px`, collapsing `.expert-grid`). No adaptation for wide displays; a reviewer on a 27" monitor sees the same single column as a laptop user. Python adapts at two breakpoints — its candidate grid drops 5 → 4 columns below 1550px and → 2 below 1000px, with the quality grid, stage bars, and queue tools reflowing alongside (`local_web_app.py`'s embedded CSS, lines 1568–1578).

**Desired behavior.** Column count and information density adapt across at least three breakpoints; the detail panel's three-column expert grid degrades sensibly.

**Reviewer benefit.** Wide displays — where most of this work happens — actually pay off.

**Recommended approach.** Largely free from RX-03's `auto-fill`/`minmax` grid. Remaining work: the expert grid, the toolbars' wrap behavior, and a maximum content width so text lines do not become unreadably long at 2,560px.

**Affected files.** `index.html`.

**Architectural risk.** None.

**Acceptance criteria.**
1. No horizontal scrollbar at any viewport width ≥ 768px.
2. Candidate grid column count increases at ≥ 1,600px and ≥ 2,200px.
3. Text content is capped at a readable maximum line length regardless of viewport width.
4. Toolbars wrap without overlapping at 900px.

---

## RX-16 · Category Check third axis + breadcrumb

**Priority:** Low **Effort:** M **Dependencies:** RX-02's extracted filter function

**Current behavior.** Two axes: Review State and Category. Python has three — Review State → Category → **Context** — with counts at each level and a breadcrumb path label (`qualityPathLabel()`).

**Desired behavior.** A third Context axis whose options are category-aware, plus a breadcrumb line stating the current path.

**Reviewer benefit.** Turns "review 340 unknown capitalized tokens" into "review the 45 sentence-initial ones, which are almost certainly false positives, as one batch." That is the category producing the most noise, so the saving is concentrated exactly where it is most needed.

**Why this matters.** Deliberately deferred in Milestone 1 for good reasons; worth naming precisely what is lost. The breadcrumb is separately missing — a reviewer three levels deep currently has no single-glance statement of what they are looking at.

**Recommended approach.** **Adapt, do not port.** Python's context predicates are regex heuristics over raw text (`acronymShape`, `sentencePosition`). The TS pipeline already has structured quality evidence; derive the equivalent distinctions from `CandidateQualityAssessment`/`Evidence` where possible and only fall back to text inspection where no structured signal exists. Keep the predicates in a pure module.

**Affected files.** `src/ui/app.ts` (`renderCategoryCheckPanel`), new `src/ui/categoryContext.ts`.

**Architectural risk.** Low. One hazard: predicates that silently disagree with the quality engine's own reasoning. Derive from evidence rather than re-deriving from text wherever possible.

**Acceptance criteria.**
1. Selecting a category reveals a Context row with live counts.
2. Context options differ by category, with a generic set as fallback.
3. A breadcrumb line shows `<Review State> / <Category> / <Context>`.
4. Selecting a Context narrows the list; arrow keys and post-decision advance respect the narrowing.
5. Changing Review State or Category resets Context to "Show All".

---

## RX-19 · Rolling-window pace estimate

**Priority:** Low **Effort:** S **Dependencies:** none

**Current behavior.** `estimateRemainingReviewTime` computes `(last - first) / (n - 1)` over **all** `candidate-decided` events — a lifetime mean including orientation time, breaks, and overnight gaps. One lunch break permanently inflates the estimate for the remainder of the session.

**Desired behavior.** Median inter-decision interval over the most recent ~20 decisions, discarding intervals above a sanity ceiling (e.g. 5 minutes) as breaks rather than work.

**Reviewer benefit.** A number that stays roughly true, which is the only condition under which it builds confidence rather than eroding it.

**Why this matters.** The principle — "no AI, only the reviewer's own observed pace" — is right and must be kept. A trailing median is equally explainable arithmetic and roughly an order of magnitude more accurate.

**Recommended approach.** Compute intervals between consecutive `candidate-decided` events, take the last 20, drop any above the break ceiling, take the median, multiply by remaining count. Return `null` when fewer than 5 usable intervals exist rather than showing a number built from noise.

**Affected files.** `src/ui/app.ts` (`estimateRemainingReviewTime`).

**Architectural risk.** None. Pure function.

**Verification.** Unit-testable directly with synthetic event timestamps — this should have a suite regardless of whether the algorithm changes.

**Acceptance criteria.**
1. A 30-minute gap between two decisions does not affect the estimate once 20 further decisions have been made.
2. The estimate is `null` (and renders as absent) with fewer than 5 usable intervals.
3. A steady 4-second pace with 100 remaining yields an estimate of ~7 minutes.
4. A unit suite covers: no events, one event, a break-only history, and a steady pace.

---

## RX-11 · Entity-type filter in Item Check

**Priority:** Low **Effort:** S **Dependencies:** none

**Current behavior.** Filtering by entity type is only reachable via the fixed "People"/"Organizations" presets, where "Organizations" is already documented as a proxy over evidence categories because no `organization` detected type exists. No way to work all `email` candidates as a batch except free-text search.

**Desired behavior.** A type dropdown populated from the detected types actually present, defaulting to "All".

**Reviewer benefit.** Working one entity type at a time is a natural review strategy, and is currently only approximable.

**Why this matters.** Python populates this dynamically on all three list stages. A generic dropdown is more honest than a preset that approximates a type it cannot detect.

**Recommended approach.** Add `typeFilter: string | null` to `ItemCheckQueryState`, populate options from the candidate pool's distinct `detectedType` values, and include it in RX-06's result-set signature. Consider retiring the "People"/"Organizations" presets once a real type filter exists — "Organizations" in particular is currently a documented approximation that a type filter makes redundant.

**Affected files.** `src/ui/itemCheckQuery.ts`, `src/ui/app.ts`.

**Architectural risk.** None.

**Acceptance criteria.**
1. A type dropdown lists only types present in the loaded document, plus "All".
2. Selecting a type narrows the list; combining it with search and presets narrows correctly (AND semantics).
3. The type filter participates in RX-06's result-set signature.
4. It persists across stage switches within a session.

---

## RX-24 · Remove developer chrome from the product

**Priority:** Low **Effort:** XS **Dependencies:** RX-21 for the QA string

**Current behavior.** `index.html:276` ships as the app subtitle on every screen: *"Review Workspace -- Milestone 3 (Reviewer Productivity). See docs/architecture/review-workspace-reconstruction.md."* The QA stub cites `phase-9-findings.md`.

**Desired behavior.** No internal milestone names or repository paths appear in reviewer-facing UI. The version label stays.

**Reviewer benefit.** The product stops describing its own construction to the person trying to use it.

**Why this matters.** The version label (`v2026-07-29.04`) serves a purpose you defined explicitly and should remain. The milestone name and doc paths serve only the development loop.

**Recommended approach.** Replace the subtitle with nothing, or with the document name once loaded. Keep `.app-version` and its tooltip.

**Affected files.** `index.html`, `src/ui/app.ts` (QA string, if RX-21 keeps the stage).

**Architectural risk.** None.

**Acceptance criteria.**
1. No reviewer-visible string contains "Milestone", "Phase", or a `docs/` path.
2. The version label and its tooltip are unchanged.

---

## Open questions requiring your decision, not implementation

These are carried forward rather than resolved, because they are product calls:

1. **RX-14** changes acknowledgement behavior you specified explicitly. The pulse stays; the question is whether it should gate progression. My recommendation is no, but it is your call.
2. **RX-23** trades one-click deciding of an unfocused row (a mouse-driven affordance) for roughly double the scanning density. Correct for a keyboard-first tool; worth confirming.
3. **RX-21** needs a decision on whether QA is removed or repurposed before it can be scheduled.
4. **RX-03** is the largest change here and reasonably deferred if Waves 1–2 alone are enough for now. Everything else in Wave 3 stands on its own.
5. **RX-11** raises whether the "Organizations" preset should survive a real type filter, given it is already a documented approximation.
