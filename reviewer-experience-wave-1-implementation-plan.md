# Reviewer Experience — Wave 1 Implementation Plan

**Class: working — retired (2026-07-30).** Executed in full; `reviewer-experience-wave-1-findings.md` is the record of what actually landed. Not authoritative for current behavior.

**Companion to:** `reviewer-experience-backlog.md` (approved), `reviewer-experience-review.md` (design reasoning, closed).
**Date:** 2026-07-29
**Purpose:** Implementation sequencing only. No design changes, no new items, no re-litigation of accepted conclusions.
**Constraint honored:** RX-13 is excluded. Nothing below implements it, prepares for it, or depends on it.

Every line reference below was verified against the current source, not taken from the backlog.

---

## Evaluation

### 1. Are RX-01, RX-02, RX-12, RX-14 the correct first-wave items?

Yes — with one reclassification. All four are UI-layer only, all four are XS/S, none touches `keymap.ts`, `navigator.ts`, or any domain type, and none requires RX-13. That is the right risk profile for a first wave handed to an engineer new to the file.

Pulling **RX-14 forward from Wave 2 into Wave 1 is not just defensible, it is mechanically necessary** — see Hidden Dependency #1. It is also the only one of the four that changes behavior Andrew specified explicitly, so its presence in this list is being read as approval.

**RX-12 is reclassified.** Its stated premise is wrong (Hidden Dependency #2): the backward fallback already exists in the domain. RX-12 is therefore not a feature to add but a property to *preserve* while RX-02 replaces the domain's advance with a visible-list advance. It becomes an acceptance criterion of RX-02, not a separate task.

**RX-30 stays out of Wave 1**, correctly — but Wave 1 adds one new fact to its table (Hidden Dependency #6), so it should be scheduled soon rather than deferred indefinitely. With RX-13 excluded, RX-30's stated dependency is void.

### 2. Should any be merged?

**Yes: RX-02 and RX-12 become one task.** They are the same function. Implementing RX-12 separately would mean writing the advance helper twice, and implementing RX-02 *without* RX-12 would introduce a dead-end regression the app does not currently have.

### 3. Should any be split?

**Yes: RX-02 splits into two commits.**

- **RX-02a — extract Category Check's narrowing into a pure function.** Currently computed inline inside `renderCategoryCheckPanel`'s DOM pass (`app.ts:1577–1632`), which is why `moveWithinVisibleList` carries a documented scope limit (`app.ts:1872–1881`). Pure refactor: zero behavior change, fully unit-testable, and it independently fixes an already-shipped arrow-key defect inside Category Check.
- **RX-02b — the visible-list post-decision advance** (including RX-12's fallback), which consumes RX-02a's function.

Refactor first, behavior second. RX-02a is verifiable in Node; RX-02b is not. Keeping them separate means a browser-validation failure in RX-02b never puts the refactor in question.

### 4. Hidden implementation dependencies?

Eight. See the dedicated section — three of them would cost real debugging time if discovered live.

### 5. Will any of this create rework later?

Effectively none, **conditional on two implementation choices**: the advance helper must take `visibleIds: string[]` as a parameter rather than fetching it internally, and rows must carry `data-item-id`. Both are covered in Notes for Fable. Get those two wrong and RX-06 and RX-05 each force a rewrite of Wave 1 code rather than a change of caller.

### 6. Safest implementation order?

1. **RX-14** — remove `isAcknowledging` from both `isExpanded` expressions
2. **RX-01** — `scrollFocusedRowIntoView()`
3. **RX-02a** — extract the Category Check narrowing (pure, no behavior change)
4. **RX-02b + RX-12** — visible-list post-decision advance with backward fallback

### 7. Greatest reviewer benefit per unit of effort?

**RX-14, by a wide margin.** It is the deletion of `isAcknowledging ||` from two expressions (`app.ts:2003`, `app.ts:2187`). It removes ~9 minutes of inserted latency over an 800-candidate document, eliminates the two-panels-open contract violation, unifies what `.item-row-focused` means across all three stages, and is the enabling condition for RX-01 being correct. Net negative lines of code.

**RX-01 second** — a handful of lines against the most disorienting behavior in the app.

RX-02b is the largest reviewer benefit in absolute terms but is S rather than XS, and is the only item in the wave that can plausibly go wrong.

### 8. What should definitely wait?

- **RX-23 and RX-03** — both change what "a row" is, which invalidates RX-01's scroll target and the acknowledgement pulse's host element. Doing either before Wave 1 is validated means re-verifying Wave 1.
- **RX-06** — the pre-decision snapshot in RX-02b covers Wave 1's correctness need. RX-06 then *supplies* that snapshot instead of the ad-hoc one. Doing it now converts a two-line call-site change into an M-effort item inside a wave that should stay XS/S.
- **RX-27** — medium architectural risk. It relocates the render tail where RX-01's hook lives; a three-line move later is cheaper than validating a partial-render model and a focus-model change in the same pass.
- **RX-05, RX-10, RX-25, RX-20** — all either depend on the above or are Wave 3+ by their own dependencies.

---

## Recommended Wave 1

Ordered. Each step is independently committable and independently revertible.

### Step 1 — RX-14 · Acknowledgement stops gating progression

Remove `isAcknowledging ||` from the two `isExpanded` expressions:

- `app.ts:2003` (`renderCandidateStage`)
- `app.ts:2187` (`renderGroupStage`)

Keep `acknowledge()`, `isAcknowledged()`, `ACKNOWLEDGEMENT_MS`, `.item-row-acknowledged`, `.row-acknowledged-pulse`, and the `✓ Saved` badge (`app.ts:2055`) exactly as they are. They already target the leaving row, which stays in the list.

Optional, and safe: shorten `ACKNOWLEDGEMENT_MS` to ~400ms now that nothing waits on it. Recommend leaving it at 700 for this wave — changing it in the same commit makes a perceptual browser-validation judgment harder to attribute.

**Side effect worth knowing:** in `renderCandidateStage` the `.item-row-focused` class is applied on `isExpanded` (`app.ts:2004`), while `renderGroupStage` applies it on `isFocused` only (`app.ts:2199`). This step makes the two agree without any additional edit.

### Step 2 — RX-01 · Scroll the focused item into view

Add one named function and call it from `render()`:

```ts
function scrollFocusedRowIntoView(container: HTMLElement): void {
  const row = container.querySelector<HTMLElement>(".item-row-focused");
  if (row && typeof row.scrollIntoView === "function") {
    row.scrollIntoView({ block: "nearest" });
  }
}
```

**Call it *before* the `searchInputFocusPending` and `inlineEditor` focus restoration blocks** (`app.ts:2787–2819`), not after. The backlog's recommended approach says after; that is wrong — `input.focus()` performs its own scroll, and running the row scroll last can push an open inline editor back out of view. Whoever focuses last should win, and that must be the text-entry control.

No `scroll-margin-top` in this wave. It becomes required with RX-04's sticky chrome and is that item's obligation; adding it now introduces an unexplained offset with nothing above the list to justify it.

### Step 3 — RX-02a · Extract the Category Check narrowing

Pull the two filter passes out of `renderCategoryCheckPanel` (`app.ts:1577–1579` and `app.ts:1629–1631`) into a side-effect-free function — suggested `src/ui/itemCheckCategoryView.ts`, following the established per-stage-module pattern (`itemCheckQuery.ts`, `groupCheckQuery.ts`):

```ts
narrowByCategoryView(facts, { reviewState, categoryFilter }): string[]
```

`renderCategoryCheckPanel` then calls it for its returned id list, and `visibleItemCheckIds` (`app.ts:1917`) calls it too when `itemCheckViewMode === "category"`. The chip *counts* stay in the renderer — they are presentation, and pulling them out would widen this commit for no gain.

New pure-function suite. No behavior change to the rendered list; the observable change is that arrow keys inside Category Check begin respecting the narrowing, which closes the scope limit disclosed at `app.ts:1872–1881`. Delete that disclosure comment as part of this step.

### Step 4 — RX-02b + RX-12 · Visible-list post-decision advance

One pure helper, two call sites.

```ts
// Forward from currentId, then backward, then stay. No wrap.
// Mirrors navigator.ts's findByPredicate(dir: "forward") semantics,
// computed over the DISPLAYED order instead of the structural one.
function nextUnresolvedInVisibleList(
  visibleIds: string[],
  currentId: string | null,
  isResolved: (id: string) => boolean
): string | null
```

Wire into `decideAndAdvance` (`app.ts:1227`) and `decideGroupAndAdvance` (`app.ts:1246`), following `moveWithinVisibleList`'s existing interception shape:

1. **Before** dispatching, snapshot `visibleIds` (`visibleItemCheckIds(state)` / `visibleGroupIds(state)`) and the current `itemId`.
2. Dispatch the review command as today (`reconcile()` still runs; do not try to suppress it).
3. Compute the advance target from the **snapshot**.
4. If it differs from `state.focus.target.itemId`, dispatch `navigation.selectItem` for it.
5. `acknowledge()`, then a single `render()` — one render, not two.

`FocusNavigator`, `keymap.ts`, and `navigator.ts` are untouched. The interception is unconditional, not conditional on the domain's answer falling off-list — see Hidden Dependency #3.

New pure-function suite for the helper (id list + resolved-predicate, no DOM). Extend `verify/focus-navigator-verification.ts` only if something domain-observable changed; nothing should have.

### Validation

One live browser pass at the end of Step 4, covering all four items together on a document with ≥ 100 candidates. Per the standing project constraint, this requires Andrew running `start-server.command` himself — and `npm run build` (full emit, not `--noEmit`) must run first, since the browser serves `dist/`.

If Andrew is available mid-wave, a check after Step 2 is worth taking: it is the cheapest point at which the focus model becomes visible, and every later step is easier to judge once the viewport tracks focus.

Standing requirement, unchanged: `npx tsc --noEmit` clean, `npm run build` clean, and all suites green. **`ls verify/*.ts | wc -l` currently returns 24** — confirm rather than trusting a remembered count.

---

## Rationale

**Why RX-14 first.** It is the smallest change in the wave and it is a precondition for RX-01 being correct rather than merely present (Hidden Dependency #1). Doing RX-01 first produces a visible double-scroll on every decision that looks exactly like a bug in RX-01, and an engineer new to this file would reasonably spend an hour on the wrong function. Two deleted tokens remove the whole failure mode.

**Why RX-01 second.** It is the only item in the wave whose effect is directly observable, and it makes the remaining two steps far easier to validate — you cannot judge whether a post-decision advance went to the right row if the row is off-screen. Buying observability for a handful of lines, before doing the work that needs observing, is the highest-leverage ordering available here.

**Why the refactor before the behavior.** RX-02a is Node-verifiable and behavior-neutral; RX-02b is neither. Separating them means the harder, browser-only change lands on top of an already-green foundation, and a failed browser pass has exactly one candidate cause.

**Why RX-02b last.** It is the only item that can plausibly be wrong in a way `tsc` will not catch. Landing it last means everything beneath it is already validated, and a revert is a single commit.

**What this order deliberately avoids:** changing what a row is (RX-23/RX-03), changing how rendering works (RX-27), or introducing new persistent UI state (RX-06/RX-05) while the navigation model is being corrected. Each of those individually would make a browser-validation failure ambiguous, and this wave has one browser pass to spend.

---

## Hidden Dependencies

Things the backlog did not state. The first three are the ones that would cost real time.

### 1. `.item-row-focused` is not unique, and does not mean the same thing in every stage

`renderCandidateStage` applies the class on `isExpanded`, which includes `isAcknowledging` (`app.ts:2003–2004`). `renderGroupStage` applies it on `isFocused` only (`app.ts:2199`).

So for `ACKNOWLEDGEMENT_MS` after every Item Check or Ambiguity Check decision, **two rows carry `.item-row-focused`** — the leaving row and the newly-focused row. `querySelector` returns the first in document order, which on a forward advance is the *leaving* row. RX-01 implemented alone would therefore scroll to the row the reviewer just left, wait 700ms for the acknowledgement timer to fire its own `render()`, and then scroll to the correct row. A visible double-jump on every single decision, in two of three stages, and absent from the third.

RX-14 makes the class unique and consistent. This is the mechanical reason RX-14 belongs in Wave 1 and belongs first.

*(Alternative, if RX-14 were ever pulled back out: key the scroll off `state.focus.target.itemId` via a `data-item-id` lookup instead of the class. Worth doing anyway — see Notes for Fable #2.)*

### 2. RX-12's premise is factually incorrect — the backward fallback already exists

The backlog states that `findUnresolved(itemIds, index, "forward", …)` "scans forward only." It does not. `findByPredicate` (`navigator.ts:109–120`) scans forward from `idx+1` to the end, **then backward from `idx-1` to 0**, then falls back to the item at `idx`. Its own doc comment says "identical to Python," and Python's `nextUndecidedAfter` (`local_web_app.py:2142–2148`) has exactly that shape. `reconcile()` calls it at `navigator.ts:328`.

A reviewer today is **not** stranded at the bottom of a list with work above them — in structural order.

This inverts RX-12's meaning entirely. It is not a gap to fill; it is a property RX-02 would *silently destroy* if the new visible-list helper scanned forward only. Written as a separate later item, RX-02 ships a regression and RX-12 fixes it. Written as one task, nothing ever breaks. `reviewer-experience-review.md`'s corresponding claim (§RX-02, "`findUnresolved(…, 'forward')` has no such fallback") should be corrected in the record.

### 3. RX-02's recommended approach does not satisfy RX-02's own acceptance criteria

The backlog says: "after dispatching, **if** the resulting `focus.target.itemId` is not present in the current visible list, dispatch `navigation.selectItem` for the next unresolved id in the visible list."

That guard only fires under an active *filter*. Under an active *sort* with no filter — RX-02's acceptance criterion #1, and criterion #4 for Group Check — every item is in the visible list, the guard never fires, and focus still jumps to the structurally-adjacent item. The stated approach fails the stated criteria.

The interception must be **unconditional**, exactly like `moveWithinVisibleList` (`app.ts:2972–2980`): after any decision that resolves the focused item, compute the target over the displayed order and select it. Do not gate on where the domain landed.

### 4. The visible list must be snapshotted before the decision is dispatched

Under "Unreviewed only", or Category Check with "To Review" (which `jumpToCategory` sets by default, `app.ts:1959`), the just-decided candidate is gone from the freshly-filtered list on the very next evaluation. `visibleIds.indexOf(currentId)` returns −1, and there is no anchor from which "next" means anything.

Capture `visibleIds` and `currentId` **before** `dispatcher.dispatchReview()`. The pre-decision order is the order the reviewer was actually looking at, which is the correct semantics regardless.

This is the mechanical seed of RX-06: the frozen result set is a durable, reviewer-visible version of the same snapshot. Parameterizing the helper (Notes for Fable #1) means RX-06 changes the caller and not the helper.

### 5. A fourth decision path may need the same interception

RX-02 names `decideAndAdvance` and `decideGroupAndAdvance`. There are two more paths that dispatch review commands and therefore trigger `reconcile()`:

- `decideNotQuiteMemberAndRender` (`app.ts:1276`) — operates inside an open Not Quite panel, and `reconcile()` step 1 follows the panel rather than advancing through the stage list. Almost certainly needs nothing.
- `decideGroupBulkAndRender` (`app.ts:1259`) — the checked-subset path. Group resolution is *derived* from member decisions (`groupDisplayDecision`), so a subset decision can resolve the group, at which point `reconcile()` advances in structural order under an active group sort — the same defect, at a call site the backlog does not mention.

**Verify both in the browser rather than assuming either way.** If `decideGroupBulkAndRender` does need it, it is one additional call to the same helper.

### 6. `]` and `[` wrap; the new advance will not

`goToAdjacentInVisibleList` (`app.ts:1825–1847`) scans with modular arithmetic over `n` positions — it wraps around the end of the list. That is shipped, working behavior for `]`/`[` in Item Check.

The new advance does forward → backward → stay, with no wrap. So after Wave 1 the file contains two different answers to "next undecided in the visible list": `]` lands on the earliest undecided item in the list; auto-advance lands on the nearest *earlier* undecided item. Both are defensible; having both silently is the same class of problem RX-02 exists to fix, one level down.

Handle it cheaply: give the shared helper an explicit `wrap` option, have `]`/`[` pass `wrap: true` (zero behavior change, zero regression risk) and the advance pass `wrap: false`, and record the difference in the helper's doc comment. RX-30 then has one more row already answered rather than a discrepancy to rediscover.

### 7. The Node harness cannot observe any of this, and can be broken by it

`verify/ui-smoke.ts` installs a deliberately minimal fake DOM: `FakeElement` has **no `querySelector`** and no `scrollIntoView`, and `FakeClassList` implements **only `add`** (`ui-smoke.ts:41–82`). `render()` returns early on the landing path (`app.ts:2748`), so additions to the render *tail* are safe today — but anything added *above* that early return must be guarded, following the existing precedent at `app.ts:3009` (`typeof document.querySelector === "function"`).

Practical consequence: the only Wave 1 assertions available in Node are RX-02a's pure filter suite, RX-02b's pure helper suite, and a structural check. RX-01 and RX-14 are browser-only, without exception.

### 8. Rows carry no stable identity in the DOM

`el("div", { class: "item-row" })` (`app.ts:1995`) — no id, no data attribute. Every DOM→candidate mapping in this file currently goes through closures. RX-01 works around it with a class query; RX-05's `pageForKey`, RX-10's column-count geometry, and RX-03's grid cells all need a real id→element mapping. Adding `data-item-id` now is one attribute (see Notes for Fable #2).

---

## Future Rework

**Nothing in this wave becomes throwaway** if the two implementation choices in Notes for Fable are followed. Assessed individually:

| Item | Fate in later waves |
|---|---|
| RX-14's deletion | Permanent. Nothing later restores acknowledgement-gated expansion. |
| RX-01's `scrollFocusedRowIntoView()` | Permanent and load-bearing. Re-verified (not rewritten) after RX-03 and RX-05. |
| RX-02a's extracted filter | Compounds directly: named as a dependency by RX-16, feeds RX-06's signature and RX-05's paging. |
| RX-02b's advance helper | Compounds: consumed by RX-05 (`pageForKey` on every render), RX-06 (frozen set as the id source), RX-07 (per-stage query tools), RX-10 (2D movement over the same list). |

Two things to be aware of rather than act on:

**Excluding RX-13 changes RX-01's status.** The backlog treats RX-01 as nearly free once RX-13 lands, reducing to a verification task. Without RX-13, `scrollFocusedRowIntoView()` is the application's permanent scroll mechanism rather than a bridge. That raises the bar on how it is written — a named function with a single call site, not an inline `querySelector` buried in the render tail — and it means RX-03 and RX-05 each carry an explicit obligation to re-verify it rather than inheriting browser-native behavior for free. Stated once; not an argument to reopen the exclusion.

**RX-06 will absorb the snapshot, not discard it.** The pre-decision `visibleIds` capture in Step 4 is the same concept RX-06 makes durable and reviewer-visible. Provided the helper takes the array as a parameter, RX-06 changes one line at each call site and the helper and its test suite survive untouched.

---

## Notes for Fable

**1. The advance helper takes `visibleIds: string[]` as a parameter. It does not call `visibleItemCheckIds()` itself.**
This is the single most important instruction in this document. It keeps the helper pure and unit-testable in Node, it forces the pre-decision snapshot (Hidden Dependency #4) to be explicit at the call site rather than accidental, and it is what makes RX-06 a caller change instead of a rewrite. Same rule for the resolved-predicate: pass it in.

**2. Add `data-item-id` to every `.item-row` / `.group-row` as part of Step 2.**
One attribute in two places (`app.ts:1995`, `app.ts:2196`). RX-01 can then find its target by focus state rather than by a CSS class whose meaning has already drifted once, and RX-05/RX-10/RX-03 inherit a real id→element mapping instead of each inventing one. Not scope creep — it is the cheapest available insurance against Hidden Dependencies #1 and #8.

**3. `FocusNavigator`, `navigator.ts`, and `keymap.ts` must be byte-identical after this wave.**
Every fix here is a UI-layer interception. This boundary (Phase 9's "must never depend on rendered/UI-only state") has held under real pressure and is one of the three architectural decisions the review explicitly recorded as settled. If a change appears to require touching one of those files, that is a signal to stop and raise it, not to proceed — `moveWithinVisibleList`'s and `isRovingFocusElement`'s doc comments are the precedent for how such a thing gets handled instead.

**4. Read the doc comments before editing around them, and update them in the same commit.**
This file's comments carry the *reasoning* for decisions that look arbitrary — `acknowledgement`'s comment explains why there is no separate expansion state; `moveWithinVisibleList`'s explains why the fix cannot live in the domain; `goToAdjacentInVisibleList`'s explains why `]`/`[` are UI-composed rather than domain dispatches. Three specific comments become stale in this wave and must be corrected, not left: `decideAndAdvance`'s claim that it "only delays REVEALING the already-new focus" (`app.ts:1210–1226`, no longer true after Step 1 and materially expanded after Step 4), the `isAcknowledging` explanations at `app.ts:1996–2001` and `app.ts:2177–2184`, and `moveWithinVisibleList`'s KNOWN SCOPE LIMIT paragraph (`app.ts:1872–1881`, resolved by Step 3).

**5. One `render()` per user action.**
Step 4 dispatches twice (review, then navigation) but must render once, at the end. Two renders per decision would double the cost of the most frequent action in the app and could produce a visible intermediate frame — and with RX-01 in place, a visible intermediate *scroll*. `goToNextAmbiguity` (`app.ts:1945–1949`) is the existing precedent for two dispatches and one render.

**6. Do not "fix" the acknowledgement while you are in there.**
Step 1 removes `isAcknowledging` from two `isExpanded` expressions and nothing else. The pulse, the colour change, the `✓ Saved` badge, the 700ms timer, and the cancel-then-restart discipline all stay. The pulse is a cue Andrew asked for specifically; only its coupling to progression is being removed.

**7. `npm run build` before asking for browser validation, every time.**
`tsc --noEmit` passing does not update `dist/`, and `dist/` is what the browser serves. This has been forgotten before.

**8. Report what you could not verify.**
Wave 1 is almost entirely browser-observable-only (Hidden Dependency #7). A findings doc that says "Steps 1 and 2 are unvalidated pending a live pass" is worth considerably more than one that implies otherwise. This project's standing practice is to disclose the gap rather than skip past it.
