# Reviewer Experience — Wave 1 Findings

**Class: working (2026-07-30).** Wave 1 record, complete and browser-validated. Durable conclusions await promotion into `app/docs/` (documentation initiative, Phase 3); until promoted, this document is not citable as canonical authority.

**Companion to:** `reviewer-experience-wave-1-implementation-plan.md` (followed), `reviewer-experience-backlog.md`, `reviewer-experience-review.md`.
**Date:** 2026-07-29
**Status:** Complete and **browser-validated** (updated 2026-07-29, per the Wave 2 implementation plan's precondition note: the live pass came back clean — RX-14, RX-01, RX-02a, RX-02b all confirmed). The "Browser validation pending" caveats below are retained as a record of what the Node harness could and could not claim at implementation time.

## Milestones

The working folder is not a git repository, so no commits could be created. The wave was implemented and verified as five commit-shaped milestones, each independently revertible; suggested messages if this is committed elsewhere:

1. **RX-14** — `acknowledgement no longer gates progression (visual pulse only; one expanded row at all times)`
2. **RX-01** — `scroll focused row into view after render; add data-item-id row lookup contract`
3. **RX-02a** — `extract Category Check narrowing into pure itemCheckCategoryView.ts; arrow keys respect it`
4. **RX-02b** — `unconditional visible-order post-decision advance via advanceWithinVisibleList (RX-12 fallback preserved)`
5. **Verification** — `add two pure verify suites; full suite run (26/26 green), tsc clean, build clean`

Verification was also run incrementally after each milestone (`tsc --noEmit` after every step; relevant suites after each).

---

## 1. RX-14 — Acknowledgement no longer gates progression

### Implementation
Removed `isAcknowledging` from both `isExpanded` expressions: `renderCandidateStage` (Item Check + Ambiguity Check) and `renderGroupStage`. The acknowledgement is now purely visual — the leaving row still gets `.item-row-acknowledged`, `.row-acknowledged-pulse`, and the `✓ Saved` badge for `ACKNOWLEDGEMENT_MS`, but it is no longer expanded and no longer carries `.item-row-focused`. Exactly one detail panel and one focused-row class exist at a time in the candidate stages, and `renderCandidateStage` now applies `.item-row-focused` on focus alone, agreeing with `renderGroupStage`.

Preserved exactly: the pulse, `ACKNOWLEDGEMENT_MS` (left at 700ms per the plan — no perceptual variable changed in the same wave), the `✓ Saved` badge, decision feedback classes, the cancel-then-restart timer discipline, and the immediate (now immediately *revealed*) focus advance.

Three stale doc comments corrected in the same step, per plan Note #4: the `acknowledgement` state's own comment (it claimed to "DELAY revealing" the advance), `decideAndAdvance`'s comment (same claim), and both `isAcknowledging` explanations at the two render sites.

### Files Changed
- `src/ui/app.ts` (only)

### Architectural Fit
Pure UI-presentation change; no domain surface touched. Removes the one place where a UI timer disagreed with FocusNavigator about what "focused" means.

### Automated Verification
`tsc --noEmit` clean; `ui-smoke` 4/4. Nothing more is honestly claimable — see harness limits.

### Browser Validation Required
Yes — simultaneous-expansion absence, pulse timing, and immediate advance are all perceptual. Steps below.

### Deviations
None.

---

## 2. RX-01 — Focused item scrolls into view

### Implementation
- Added `data-item-id` to every candidate row and group row — the stable DOM→item lookup contract.
- Added `scrollFocusedRowIntoView(container, state)`: looks up the row for `state.focus.target.itemId` via `[data-item-id="…"]` (with `CSS.escape` where available), then `scrollIntoView({ block: "nearest" })` — instantaneous, and a fully-visible row is left untouched (no re-centering).
- Single call site in `render()`'s tail, **before** the `searchInputFocusPending` and `inlineEditor` focus restorations, so a text-entry control focused afterward always wins the final scroll (per the plan's correction of the backlog's "after" recommendation).
- No `scroll-margin-top` (RX-04's obligation, not this wave's).

### Files Changed
- `src/ui/app.ts` (only)

### Architectural Fit
Lookup is keyed off FocusNavigator's own state through a domain id, not a presentation class — immune to the class-meaning drift Hidden Dependency #1 documented, and safe to implement now only because RX-14 landed first (no second row claiming focus during acknowledgement). Guarded with `typeof` checks following the file's established fake-DOM precedent. With RX-13 excluded, this is documented in-code as the permanent scroll mechanism.

### Automated Verification
`tsc --noEmit` clean; `ui-smoke` 4/4 (module evaluation and landing render survive the fake DOM). Scroll behavior itself is not observable in Node.

### Browser Validation Required
Yes — all of it. Steps below.

### Deviations
None. (Plan's illustrative snippet queried `.item-row-focused`; the spec's `data-item-id` contract was used instead, as instructed.)

---

## 3. RX-02a — Category Check narrowing extracted into a pure helper

### Implementation
New module `src/ui/itemCheckCategoryView.ts` (per-stage-module pattern, like `itemCheckQuery.ts`/`groupCheckQuery.ts`):

- `narrowByCategoryView(facts, { reviewState, categoryFilter }): string[]` — both filter passes (review-state chips, then category chips), order-preserving, side-effect-free.
- `CategoryReviewState` moved here from `app.ts`; new `CandidateReviewStatus = Exclude<CategoryReviewState, "total">` (and `itemCheckCandidateStatus`'s return type tightened to it — "total" is a filter option, never a per-candidate status).

In `app.ts`:
- `buildCategoryViewFacts()` gathers `{candidateId, status, categories}` from the same reads the renderer already performed (`itemCheckCandidateStatus`/`candidateCategories`) — status logic is passed in as data, not duplicated in the pure module.
- `renderCategoryCheckPanel` derives both its state-filtered set and its returned id list from the helper. Chip *counts* remain inline in the renderer (presentation, per plan).
- `visibleItemCheckIds()` applies the same helper when `itemCheckViewMode === "category"` — the disclosed observable change: arrow keys inside Category Check now respect the narrowing, closing the KNOWN SCOPE LIMIT documented at `moveWithinVisibleList`. That disclosure paragraph was replaced with a resolution note in the same commit.

Rendered-list membership and order are unchanged (verified by inspection: the helper is a literal extraction of the two inline `.filter()` passes).

### Files Changed
- `src/ui/itemCheckCategoryView.ts` (new)
- `src/ui/app.ts`
- `verify/item-check-category-view-verification.ts` (new)

### Architectural Fit
UI-layer narrowing over already-computed domain output; DOM-free; no ReviewSession/QualityResult reads inside the pure module. Renderer and keyboard navigation now share one membership/order source, so they cannot drift.

### Automated Verification
New pure suite: **12/12** — both axes individually and combined, "total"/Show All passthrough, multi-category matching, empty narrowing, order preservation (reversed input stays reversed), input non-mutation. `tsc --noEmit` clean.

### Browser Validation Required
Only the arrow-keys-respect-narrowing behavior (folded into the RX-02 steps below); the filtering itself is fully Node-verified.

### Deviations
- Module named `itemCheckCategoryView.ts` with the plan's suggested `narrowByCategoryView` signature (facts-based, so the helper stays pure).
- **Disclosed, not fixed:** `]`/`[` (`handleScaleNavigationKey`) and the command bar's "Next undecided"/"Previous decision" buttons compute their visible list inline via `queryItemCheck` and do **not** apply Category Check narrowing — a pre-existing inconsistency now more visible because arrow keys do. Fixing it is two call sites switching to `visibleItemCheckIds()`, but it is a behavior change outside this wave's spec ("do not change behavior during this step") and is left for the RX-30 consistency table rather than done silently.

---

## 4. RX-02b — Post-decision advance follows visible order (RX-12 preserved)

### Implementation
New module `src/ui/visibleListAdvance.ts`:

```ts
advanceWithinVisibleList(currentId, visibleIds, isResolved): string | null
```

Semantics, per spec: start strictly after `currentId`; nearest unresolved forward; else nearest unresolved backward (RX-12's fallback, mirroring `navigator.ts`'s `findByPredicate(dir: "forward")` over displayed order); else `null` = remain on the current item. **No wrap** — deliberately unlike `]`/`[`, and the difference is recorded in the module doc comment. The helper takes `visibleIds` and `isResolved` as parameters and fetches nothing internally — later frozen-result-set work (RX-06) changes the caller's `visibleIds`, not this algorithm.

In `app.ts`, one choke point wraps the review dispatch for *every* decision path:

`dispatchReviewWithVisibleAdvance(command)`:
1. **Before** dispatching: snapshot the focused item and `snapshotVisibleIdsForStage()` (item-check → `visibleItemCheckIds`, now including Category Check narrowing; group-check → `visibleGroupIds`; ambiguity-check → its structural list, which *is* its visible list).
2. Dispatch as before — `reconcile()` still runs, unsuppressed.
3. If the dispatch succeeded, no Not Quite panel is open afterward, and the previously-focused item **became resolved**: compute the target from the pre-decision snapshot (unconditionally — never gated on whether the domain's answer fell off the visible list, per Hidden Dependency #3) and, if it differs from where `reconcile()` landed, dispatch a plain `navigation.selectItem`. A `null` advance re-selects the just-decided item, so focus can never be dragged to a structurally-adjacent but hidden unresolved item.

The resolved predicate is the domain's own `isItemResolved()` (`stages.ts`) via a thin `isItemResolvedInState()` — the exact predicate `reconcile()` advances by, so UI and domain can only ever disagree about scan *order*, never about what "resolved" means. Group resolution via member-by-member decisions and coverage-based candidate resolution are therefore handled for free.

**Decision-path audit** (per spec, beyond the two primary helpers):

| Path | Routed through choke point | Effect |
|---|---|---|
| `decideAndAdvance` (candidate: buttons, keyboard K/I, ambiguity links, inline-editor confirms) | yes | visible-order advance |
| `decideGroupAndAdvance` (confirmGroup/ignoreGroup/redactGroup/flattenGroup) | yes | visible-order advance |
| `decideGroupBulkAndRender` (checked-subset bulk — can resolve the group via derived resolution) | yes | visible-order advance |
| `decideNotQuiteMemberAndRender` | yes, but the open-panel guard makes it a provable no-advance | unchanged (reconcile's panel-following stays authoritative, exactly as the plan predicted) |
| `dispatchAndRender` generic review branch (**found in audit**: `completeNotQuite`/`exitNotQuite` — completing a fully-decided Not Quite resolves the group and previously advanced structurally under a sort) | yes | visible-order advance; `enterNotQuite` and exit-incomplete are no-ops via the guards |
| `dispatchBulkDecision` + `confirmInlineEditor`'s bulk branch (**found in audit**: Item Check bulk actions that include the focused candidate resolve it — same structural-advance defect) | yes | visible-order advance |

Mouse and keyboard behavior remain identical (both funnel through the same functions). Deciding a *non-focused* row by mouse while the focused row is still unresolved leaves focus where it is — exactly today's behavior, preserved by the "focused item became resolved" guard rather than by accident. One `render()` per user action throughout (the choke point never renders).

### Files Changed
- `src/ui/visibleListAdvance.ts` (new)
- `src/ui/app.ts`
- `verify/visible-list-advance-verification.ts` (new)

### Architectural Fit
`FocusNavigator`, `navigator.ts`, `keymap.ts`, `stages.ts`: **byte-identical** (Note-for-Fable #3 honored). The interception is UI-layer, over UI-only display order, following `moveWithinVisibleList`'s established shape; the domain is consulted (read-only) for the resolved predicate rather than re-implemented, per app.ts's own boundary comment. Visible ordering stays a UI concern; the advance algorithm knows nothing about filters, sorting, or rendering.

### Automated Verification
New pure suite: **19/19** — visible-order advancement, forward skipping, backward fallback (nearest-above, several variants — RX-12), all-visible-resolved → remain, no wrapping (three variants including first-item and last-item cases), sorted visible lists (displayed order beats structural), narrowed visible lists (hidden items unreachable; fully-resolved narrowed list remains in place even with hidden unresolved items), defensive edges (empty list, null/absent currentId), and forward-beats-backward parity with `findByPredicate`. `tsc --noEmit` clean. `focus-navigator-verification` still 105/105 (nothing domain-observable changed, as required).

### Browser Validation Required
The snapshot→dispatch→re-select wiring through the live dispatcher and render loop. Steps below.

### Deviations
- Helper named per this prompt's preferred conceptual shape (`advanceWithinVisibleList(currentId, visibleIds, isResolved)`) rather than the plan's `nextUnresolvedInVisibleList(visibleIds, currentId, isResolved)` — same semantics, prompt's signature.
- The interception lives in **one** shared choke point rather than duplicated at each call site — this is how the audit's three additional paths (generic review branch, two bulk paths) got covered without three re-implementations. The plan's five-step interception shape is implemented verbatim inside it.
- Plan Hidden Dependency #6 *offered* a `wrap` option on the shared helper with `]`/`[` routed through it. Not done: this prompt requires only that wrapping not be copied into the advance, and rerouting `]`/`[` is an unrelated refactor. The now-real discrepancy (`]`/`[` wrap; auto-advance does not) is recorded in `visibleListAdvance.ts`'s doc comment for RX-30.

---

## Verification summary

- Suite count confirmed by counting, not memory: **24 before this wave, 26 after** (two new pure suites).
- All 26 suites pass, exit code 0 each (`fixture-io.ts`'s last line is a long-standing Node warning; its checks pass).
- `npx tsc --noEmit`: clean. `npm run build`: clean — **`dist/` is freshly emitted**, so the browser will serve this wave's code (Note #7).
- Suites re-run in full after the final milestone; also run incrementally per milestone.

## Limits of the Node harness (what is NOT verified)

Per Hidden Dependency #7, honestly: `verify/ui-smoke.ts`'s fake DOM has no useful `querySelector`, no `scrollIntoView`, and a `classList` implementing only `add`. Consequently:

- **RX-14 is not verified in Node.** Simultaneous expansion, the pulse, and immediate advance are unobservable here.
- **RX-01 is not verified in Node.** Scroll behavior is unobservable here.
- **RX-02b's pure algorithm is fully verified; its live wiring is not.** The snapshot/dispatch/re-select path through the real dispatcher and render loop needs a browser.
- RX-02a's filtering is fully verified; that the renderer displays exactly the helper's list needs eyes on a browser.

## Manual browser validation steps

Prereqs: `npm run build` has been run (it has); serve via `start-server.command`; load a document with **≥ 100 candidates**.

**RX-14**
1. In Item Check, decide items rapidly (mouse K/I buttons and keyboard K/I both).
2. Confirm the leaving row pulses (highlight + `✓ Saved`) while the next row expands **immediately** — no 700ms wait.
3. Confirm at every moment exactly one detail panel is open and one row is highlighted as focused.
4. Repeat in Ambiguity Check (decide or link identities) and Group Check (Keep as-is/Ignore on collapsed rows — leaving row pulses, next group expands immediately).

**RX-01**
1. Hold Arrow Down past the bottom of the viewport. Confirm the focused row stays visible, hugging the bottom edge (no centering).
2. Arrow Up back through — same at the top edge.
3. Move between two fully visible rows: confirm **no scrolling at all** (no re-centering of an already-visible row).
4. Decide an item near the bottom edge: confirm the single advance lands visibly with no double-jump (the RX-14-first ordering exists to prevent exactly that).
5. Repeat in all three review stages.
6. While the Item Check search box is focused and results shrink, confirm the search box never gets scrolled out of view (row scroll runs before input focus restoration).

**RX-02**
1. Item Check, List view, sort **Alphabetical**. Decide several items; confirm advancement follows alphabetical order, not detection order.
2. Activate **Unreviewed only**; decide items; confirm focus never lands on a hidden item (including after deciding the last visible one).
3. By Category view: pick a category chip; confirm arrow keys traverse only the narrowed list (RX-02a); decide items and confirm advancement stays within the narrowed list.
4. Group Check with alphabetical sort: decide groups (both all-selected actions and a checked-subset bulk action that completes a group — `decideGroupBulkAndRender` path); confirm advancement follows the sorted order.
5. Group Check: open Fix this, decide every member, **Done fixing** — confirm focus advances to the next unresolved group in *sorted* order (the audit-found `completeNotQuite` path).
6. Backward fallback (RX-12): with unresolved items above and none below, decide the last unresolved visible item — confirm focus moves *up* to the nearest unresolved item.
7. Decide the only remaining unresolved visible item — confirm focus **remains** on it (no wrap to the top, no jump to a hidden item).
8. Spot-check that mouse clicks and keyboard produce identical advancement, and that deciding a *non-focused* row by mouse leaves focus where it was.

## Stop conditions

None triggered. No change required RX-13, `FocusNavigator`, domain ordering, a new interaction model, restructuring, or unrelated cleanup.

## Complete file manifest

| File | Change |
|---|---|
| `src/ui/app.ts` | RX-14, RX-01, RX-02a wiring, RX-02b choke point + call-site routing, stale comments corrected |
| `src/ui/itemCheckCategoryView.ts` | new (RX-02a pure helper + `CategoryReviewState`/`CandidateReviewStatus`) |
| `src/ui/visibleListAdvance.ts` | new (RX-02b pure helper) |
| `verify/item-check-category-view-verification.ts` | new (12 checks) |
| `verify/visible-list-advance-verification.ts` | new (19 checks) |

No other file was modified. `FocusNavigator.ts`, `navigator.ts`, `keymap.ts`, `stages.ts`, and all domain/workspace/io modules are untouched.
