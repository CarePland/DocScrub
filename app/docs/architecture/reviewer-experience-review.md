# Reviewer Experience Review — Python DocScrub vs. DocScrub-Web

**Date:** 2026-07-29
**Scope:** Interaction design and reviewer workflow only. No implementation.
**Reference for reviewer interaction:** `work/pii_docx_redactor/local_web_app.py` (the embedded HTML/CSS/JS reviewer UI, lines 1181–5104).
**Reference for architecture:** `DocScrub-Web/src/` (engines, domain, workspace) — treated as canonical and not under review here.

**A note on citations.** Line references of the form `app.ts:1234` and `index.html:56` are literal line numbers in those files. References of the form `app.js:446` and `style.css:258` refer to the Python UI's embedded blocks *extracted to standalone files* for analysis — `style.css` = `local_web_app.py` lines 1186–1584, `app.js` = lines 1697–5101. Add the respective offset to locate them in `local_web_app.py` itself.
**Companion document:** `reviewer-experience-backlog.md` (every recommendation below as a discrete, approvable work item with acceptance criteria).

---

## How to read this document

This is not a widget inventory. `review-workspace-specification.md` already does that job well, and I have deliberately not repeated it. This document asks one question of every interaction:

> Which implementation better serves a reviewer processing hundreds or thousands of entities with speed, confidence, and minimal cognitive effort?

Findings are classified **Preserve Web**, **Recreate Python**, **Adapt**, or **Remove**. Every claim about current behavior was verified by reading the source, not inferred from documentation — including several places where the existing documentation and the code disagree. Those disagreements are called out explicitly rather than silently resolved.

I have also flagged things you did not ask for, and pushed back on three conclusions recorded in the current design documents that I believe are wrong. That is the part of this review most likely to be useful, and the part most likely to annoy you.

---

## Part 0 — The finding that explains most of the others

Before the itemized list, one structural observation, because roughly half of the individual findings are downstream of it.

**The Python app and the browser app have fundamentally different viewport models, and only one of them was designed.**

Python's Results stage renders candidates as a **five-column grid of compact chips** (`style.css:258`: `.review-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 7px }`), each `min-height: 42px`, showing name + occurrence count and nothing else. Status is carried entirely by fill color, with a `✓` prefix injected via CSS on resolved items (`style.css:267`). Fifty candidates — one page — occupy roughly 500 vertical pixels. When one candidate is focused and expanded, the grid collapses to a single column for that item (`candidateGridColumnCount()` returns 1 while anything is expanded) and the detail panel takes the full width, in place.

So Python has **two modes** in one surface:

1. **Scan mode** — a dense, color-coded field you read like a heat map. Fifty items at a glance, decisions visible as color, no per-row controls competing for attention.
2. **Work mode** — one item, fully expanded, full-width evidence, keyboard actions.

DocScrub-Web has only work mode. `renderCandidateStage` (`app.ts:1990–2080`) emits one full-width `.item-row` per candidate, each carrying a checkbox, a text label, a confidence badge, and four decision buttons — always, for every candidate, whether focused or not. `.item-list` is `flex-direction: column` (`index.html:70`). Fifty candidates occupy roughly 2,200 vertical pixels: four screens of scrolling to see what Python shows in half a screen.

Everything about scanability, density, fatigue, scrolling, and "where am I" traces back to this. It is not a styling gap. It is a missing interaction mode.

I do not think this happened because anyone decided the row list was better. I think it happened because `app.ts`'s own header still says *"Keep UI intentionally simple. Do not spend time on animations, visual polish, styling, responsiveness..."* — a Phase 10 instruction that was correct for Phase 10 and has quietly outlived its usefulness through four milestones and six revisions. The row list is the thin-UI placeholder, still load-bearing.

---

## Part 1 — Preserve Web

These are places where the browser implementation is objectively better and Python should not be copied back.

### PW-1. Non-linear stage tabs with live per-stage counts
Python renders every stage as a `<details>` panel on one long scrolling page (Ambiguity Check, Group Check, Category Check, Results, all open by default). That is genuinely worse at scale: four independently-paginated lists stacked vertically means the reviewer's context is defined by scroll position, which nothing preserves. The Web tabs with `(unresolved/total)` counts in each label (`renderStageTabs`, `app.ts:1155`) preserve "Completion Beats Movement" more honestly than Python's layout does, because the count is visible *without* opening the stage. **Confirmed settled by you during Milestone 1; nothing here reopens it.**

### PW-2. Expansion derived from focus rather than tracked separately
`isExpanded = focus.target.stage === stage && focus.target.itemId === candidateId` (`app.ts:2003`). Python maintains a parallel `expanded` Set and has to hand-carry it across every navigation call (`setActive`'s `keepDetailOpen`, `preserveDetailForActiveCandidate`, `focusGroupWithOpenTransfer`'s `transferOpen`, `navigateActiveGroup`'s `keepExpanded` — four separate places re-implementing "keep the panel open as I move"). The derived version is strictly better and eliminates that class of drift. **Keep.**

*(One consequence needs fixing — see RX-14 — but the principle is right.)*

### PW-3. The command bar rendering on every stage
Python's `#groupCommandBar` only ever appears inside Group Check (`commandBarContextForElement` returns `null` for anything outside `#entityGroups`, `app.js:333`). Generalizing it was the right call. *(Its current **contents** are a different matter — see RX-15.)*

### PW-4. Inline editors and quick-pick chips instead of `window.prompt()`
Python's Results-stage rename editor is inline, but its Ambiguity Check still uses a raw `window.prompt()` (`completeAmbiguousAction`, `app.js:741`). Web's editor is inline everywhere, caches drafts per scope+action so switching decisions doesn't discard typed text, and pre-focuses the chip matching the current default so accepting is one Enter. That is better than Python in three separate ways. **Keep.**

### PW-5. `FocusNavigator`'s DOM-free boundary
Python's keyboard handling is one 350-line `document.addEventListener("keydown")` with a long ordered if-chain of `.closest()` checks (`app.js:2867–3185`). It works, but it is unreadable and untestable, and its behavior depends on which DOM ancestor happens to match first. `keymap.ts`'s pure `(FocusState, KeyEvent) → AnyCommand` is a genuine architectural improvement. **Keep — and keep 2D navigation out of it (see RX-10).**

### PW-6. Decision Reuse and decision provenance
No Python analog exists. Three deterministic tiers, never-overwrite, and three-state provenance labelling are strictly additive reviewer value. **Keep.**

### PW-7. Derived completion and verification staleness
Computed fresh rather than stored as a clearable flag. Python stores `review_finished_at` in mutable state. **Keep.**

### PW-8. Audit artifacts that exclude raw candidate text
A deliberate, correct divergence from Python's more content-heavy CSV. **Keep.**

---

## Part 2 — Recreate Python

Ordered by reviewer impact, not by effort.

### RX-01. Nothing scrolls the focused item into view — *Critical*

**Verified:** `grep -rn 'scrollIntoView' src/ui/` returns **zero matches** across the entire UI layer.

Python calls `scrollIntoView({ block: "nearest" })` in five places — `setActive`, `setActiveGroup`, `setActiveAmbiguous`, `toggleCandidateDetail`, and after every `navigateActiveGroup`/`navigateActiveGroupSequence`.

In DocScrub-Web, pressing ↓ past the bottom of the viewport moves an *invisible* focus. `.item-row-focused` is applied to a row the reviewer cannot see, the detail panel opens off-screen, and K/C/R/I then act on an item nobody is looking at. The only reason this is survivable today is that Group Check accidentally gets scrolling for free: `rovingGrid[position.row]?.[position.col]?.focus()` (`app.ts:2407`) calls native `.focus()`, which scrolls by default. Item Check and Ambiguity Check have no such path.

This directly contradicts `review-workspace-specification.md` §10.2, which records "minimizing scrolling / never feeling lost" as **[BUILT]**. It is not built. This is the single highest-severity finding in this review, and it is roughly five lines of code.

**Reviewer benefit:** keyboard navigation stops silently lying about where you are.
**Classification: Recreate Python. Difficulty: XS. Risk: none.**

---

### RX-02. After a decision, focus advances through the *structural* list, not the visible one — *Critical*

**Verified:** `decideAndAdvance` → `dispatcher.dispatchReview` → `CommandDispatcher` → `FocusNavigator.reconcile()`. `reconcile()` (`navigator.ts`) advances via `findUnresolved(itemIds, …)` where `itemIds = itemIdsForStage(target.stage, context)` — the raw structural order. Nothing intercepts it.

This is the *same defect* you reported in the Group Check revision ("arrow keys jump out of sequence"). That report was root-caused correctly and fixed with `moveWithinVisibleList` — **but the fix was applied only to arrow keys.** Post-decision auto-advance was never routed through it. So today:

- Sort Item Check alphabetically, decide an item → focus jumps to whatever is structurally next, which may be 400 rows away in the displayed order.
- Apply the "Unreviewed only" filter, decide an item → focus can land on a candidate **that is not rendered at all**, at which point nothing on screen appears focused or expanded, and the next keystroke acts on an invisible item.

Python has no such problem because `nextUndecidedAfter(visibleCandidates(), key)` (`app.js:446`) is computed over the *visible* list by construction.

Python also does something Web does not: if no undecided item exists **forward**, it scans **backward** before giving up (`app.js:448–450`). It never dead-ends the reviewer at the bottom of a list with work still above them. `findUnresolved(…, "forward")` has no such fallback.

**Reviewer benefit:** the view never jumps somewhere the reviewer didn't ask to go; the workflow never dead-ends.
**Classification: Recreate Python. Difficulty: S. Risk: low — mirrors an interception pattern that already exists.**

---

### RX-03. The dense scan mode does not exist — *Critical*

See Part 0. Concretely:

| | Python | DocScrub-Web |
|---|---|---|
| Collapsed candidate presentation | 42px chip, name + count | full-width row: checkbox, label, badge, 4 buttons |
| Columns | 5 | 1 |
| Items per 500px | ~50 | ~11 |
| Decision visibility when collapsed | fill color + CSS `✓` prefix | trailing text `-- Rename` |
| Controls on unfocused rows | none | 4 buttons + checkbox, always |

The buttons on every unfocused row are the part I'd push on hardest. A reviewer scanning 500 candidates is shown 2,000 buttons they are not going to click, each one a small attention cost, each one widening the row and reducing the number of items visible. Python shows decision controls only where a decision is being made.

**Reviewer benefit:** the difference between reading a list and reading a page. This is where reviewer fatigue on a large document actually comes from.
**Classification: Recreate Python (adapted — see RX-23 for the button half). Difficulty: L. Risk: medium (largest visual change in this review).**

---

### RX-04. No sticky chrome — the reviewer scrolls away from their own controls — *High*

**Verified:** `grep -n 'position:' index.html` returns nothing. Python: `header { position: sticky; top: 0; z-index: 4 }` (`style.css:7`).

In DocScrub-Web, scrolling into a long candidate list scrolls away the stage tabs, the command bar (with the entire shortcut legend), the review statistics, the persistence status, and the search box — all of it. To check "how many left in this stage" or "what does F do again," the reviewer scrolls to the top and back.

Compounding it: `.stage-body` has no independent scroll container, so the whole page scrolls as one.

**Reviewer benefit:** progress and vocabulary remain continuously available; the reviewer stops paying a scroll tax for orientation.
**Classification: Recreate Python. Difficulty: S (CSS only). Risk: none.**

---

### RX-05. No pagination; every candidate is in the DOM at all times — *High*

**Verified:** `renderCandidateStage` loops over the entire filtered `candidateIds` with no slicing. There is no page size, no pager, no virtualization anywhere in `src/ui/`.

Python paginates at 25/50/100/250 with a persistent `Showing 1–50 of 1,247 · Page 1 of 25` line (`renderPager`, `app.js:790`), plus per-stage pagers for Ambiguity Check and Group Check.

Two distinct costs, and the second is the one that matters more:

1. **Performance.** `render()` clears and rebuilds the *entire* container — top bar, four file inputs, statistics, tabs, command bar, and every candidate row with its five controls — on every state change. Search fires `render()` on every keystroke (`app.ts:1678–1682`). At 2,000 candidates that is ~12,000 DOM nodes rebuilt per keypress.
2. **Orientation.** `Showing 1–50 of 1,247` gives a 1,200-item job a shape. An infinite scroll gives it none. `review-workspace-specification.md` files pagination as "Nice-to-have (contingent)" on performance grounds alone — I think that undersells it. The psychological function is the stronger argument.

**Classification: Recreate Python. Difficulty: M. Risk: low.**

---

### RX-06. Deciding an item makes it vanish from under the cursor — *High*

**Verified:** In Category Check view, `itemCheckCandidateStatus` returns `"resolved"` the moment a decision exists, and `stateFiltered` filters by `categoryReviewState` (`app.ts:1577`). With "To Review" selected — which `jumpToCategory` sets as the *default* — deciding a candidate removes it from the list on the very next render, and every row below it shifts up. The same happens in list view with the "Unreviewed only" preset active.

Python solves this deliberately and it is the most under-appreciated idea in the Python UI. `qualityResultSetCandidates()` (`app.js:226`) **freezes result-set membership** when the navigator path changes, and keeps decided items in place. A separate `Accept changes (N)` control (`updateAcceptResultChangesControls`, `app.js:203`) lets the reviewer explicitly re-categorize when *they* are ready, with an inline `Y/N` confirm rather than a modal.

`review-workspace-specification.md` §7.3 dismisses this as a "live-rescore reconciliation workflow" that "may not even be applicable to this architecture, since the pipeline runs once per document load." **I think that reads the mechanism at the wrong level.** Rescoring is the *occasion* Python built it for; list stability is what it *does*, and list stability is exactly as necessary in an architecture that scores once. The reviewer-facing problem — "the thing I just decided disappeared and everything moved" — is architecture-independent.

**Reviewer benefit:** the list holds still. The reviewer can decide ten items in a row without re-finding their place after each one, and can see what they just did.
**Classification: Recreate Python (mechanism), Adapt (naming — "Accept changes" is opaque). Difficulty: M. Risk: low.**

---

### RX-07. Ambiguity Check and Group Check have almost no query tools — *Medium*

| Control | Python: Ambiguity | Python: Group | Web: Ambiguity | Web: Group |
|---|---|---|---|---|
| Search | ✓ | ✓ | ✗ | ✗ |
| Type filter | ✓ | ✓ | ✗ | ✗ |
| Sort | 3 orders | 5 orders | ✗ | 5 orders |
| Direction | ✓ | ✓ | ✗ | ✗ |
| Page size + pager | ✓ | ✓ | ✗ | ✗ |

The Group Check revision recorded this as deliberate — "Group Check's list doesn't yet have Item Check's scale problem." That is true for a 40-group document and false for a 400-group one, and groups scale with document size the same way candidates do. Ambiguity Check having *nothing* is harder to defend: it has no toolbar of any kind (`renderCandidateStage` calls the toolbars only when `stage === "item-check"`).

Notably, Python's `erSort` includes a **`needs_review` sort** — "show me the groups that need attention first." Web's `GROUP_SORT_ORDERS` has no equivalent, despite `groupDisplayDecision` already computing a `needsAttention` state. That is a one-line addition that directly serves triage.

**Classification: Recreate Python. Difficulty: M. Risk: low (reuses `itemCheckQuery.ts`'s shape).**

---

### RX-08. Evidence snippets lost their location and their highlight — *Medium*

**Verified:** Web renders `${before}[${match}]${after}` as plain text (`app.ts:1413, 1430`). Python renders `${n}. ${occ.location}: ${occ.context}` (`renderOccurrenceBlocks`, `app.js:1789`) and converts the bracket markers into real `<mark>` elements (`highlightedContext`, `app.js:1111`).

Two regressions in one line:

1. **The location is gone.** Python tells the reviewer *where in the document* each occurrence sits. Web shows the text with no anchor. For an attorney deciding whether "Chris" in paragraph 4 is the same Chris as in paragraph 40, that is the load-bearing fact.
2. **The match isn't visually distinguished.** Literal `[` and `]` characters in a wall of muted grey text is the weakest possible way to say "this is the bit that matters." `<mark>` costs nothing.

Occurrences are also unnumbered, so the "All occurrences (17)" browser gives no way to refer to one.

**Classification: Recreate Python. Difficulty: S. Risk: none.**

---

### RX-09. Thirteen `window.alert()` call sites remain — *High*

**Verified:** thirteen live `window.alert()` calls in `app.ts` (lines 326, 817, 827, 831, 843, 864, 890, 917, 941, 1264, 1760, 2519, 2720), covering the failure paths for load, resume, save, generate-output, audit, import, and every bulk action.

You already made this call once. Feature 002 found a blocking `alert()` on *successful* import, you called `prompt()` "unacceptable for both scope and UX," and that single instance was replaced with a non-modal banner. The pattern was never generalized. Python has had a non-blocking `#actionToast` with `role="status"` / `aria-live="polite"` since the beginning (`app.js:302`), plus a quiet persistent `status()` line for lower-priority messages.

The most consequential one: **output generation failure** (`app.ts:2519`). That is the highest-stakes moment in the entire product, and it currently interrupts with an OS-chrome dialog that reads as a browser error rather than a considered application response.

**Classification: Recreate Python (the toast component). Difficulty: S. Risk: none.**

---

### RX-10. Arrow keys ignore the rendered layout — *Medium*

`keymap.ts:200–201` maps **ArrowRight ≡ ArrowDown ≡ next** and **ArrowLeft ≡ ArrowUp ≡ previous**. In a one-column list that is merely redundant. In Group Check's two-column grid mode (`groupCheckLayout === "grid"`, `index.html:229`), it is wrong: pressing → moves to the item rendered *below-left*.

Python computes column count from actual DOM geometry — `candidateGridColumnCount()` measures `offsetTop` collisions (`app.js:529`), and `navigateActiveGroup` does true spatial nearest-neighbour scoring with `getBoundingClientRect` (`app.js:1439). This is a genuinely sophisticated piece of work and it is why Python's five-column grid is navigable at all.

**The existing decision to keep this out of `FocusNavigator` is correct and should not be revisited** (`review-workspace-specification.md` §7.2). This is a UI-layer translation on top of the 1D primitive, exactly as that section anticipates. It becomes required the moment RX-03 lands.

**Classification: Recreate Python, UI layer only. Difficulty: M. Risk: low — additive interception, same shape as `moveWithinVisibleList`.**

---

### RX-11. No entity-type filter in Item Check — *Low*

Python has a Type dropdown on Results, Ambiguity Check, and Group Check, populated dynamically from the candidate pool. Web has fixed presets — "People" and "Organizations" — where "Organizations" is already documented as a proxy over evidence categories because no `organization` detected type exists. A generic type dropdown is more honest and more general, and would let a reviewer work all `email` candidates as a batch, which today is only reachable through free-text search.

**Classification: Recreate Python. Difficulty: S.**

---

## Part 3 — Adapt

Python had the right idea; the browser implementation should modernize rather than copy.

### RX-13. Two focus models coexist, and the wrong one is dominant — *Critical*

This is the architectural root of RX-01, RX-10, and most of RX-25.

`review-workspace-specification.md` §7.6 records, as a confirmed-intentional property, that *"after every full re-render, `document.activeElement` genuinely reverts to `<body>`"* and that this is *"what makes the keyboard-shortcut affordance actually usable between actions in practice, not a defect."*

**I think this is a rationalization of an architectural side effect, and it has become load-bearing.** It is true that body-focus makes `shouldIgnoreKeyboardEvent` pass. But look at what it costs:

- The focused row cannot be scrolled into view by the browser, because the browser doesn't know anything is focused (RX-01).
- There is no `:focus-visible` ring. The only focus cue is `.item-row-focused`, a *simulated* focus painted from application state.
- No screen reader is ever told anything moved. Nothing is announced, ever (RX-25).
- Tab from `<body>` would ordinarily land on the first browser-focusable element — one of the four file inputs in the top bar. The app only escapes this because `keymap.ts` intercepts Tab first.
- **The app already broke this rule and had to build a patch.** `attachRovingGridNav` gives Group Check's controls *real* DOM focus on purpose, which immediately made `shouldIgnoreKeyboardEvent` block every shortcut — requiring `isRovingFocusElement` (`app.ts:2942`) as a narrowly-scoped exception. That exception is the tell: the "focus lives in application state" model does not survive contact with controls that need real focus, and Group Check now runs a different focus model than Item Check.

Python does the simple thing: `.candidate-cell` is a `<button>`, and `setActive` calls `cell?.focus()`. Real DOM focus, real focus ring (`style.css:261`), free scroll-into-view, and screen-reader-legible — with `shouldIgnoreKeyboardEvent` handled by Python's own `resultGridHasKeyboardFocus()` check, which asks *where* focus is rather than *whether* something has it.

**Recommendation:** make the focused candidate/group row a real focusable element (`tabindex="-1"`, focused after render), and widen the keyboard gate from "is anything focused" to "is focus inside a text-entry control." Then RX-01, the focus ring, and the a11y baseline all fall out of one change instead of three.

**Classification: Adapt (Python's mechanism, modernized as roving tabindex). Difficulty: M. Risk: medium — touches the keyboard gate, needs real browser validation.**

---

### RX-14. The acknowledgement gates progression, and briefly opens two panels at once — *High*

Current behavior (`app.ts:151–178, 2002–2005`): after every decision, `acknowledgement` holds for `ACKNOWLEDGEMENT_MS = 700`, during which the just-decided row is *kept expanded* while real focus has already moved on. Two consequences:

1. **Two detail panels are open simultaneously for 700ms.** `isExpanded = isAcknowledging || isFocused` means the decided row and the newly-focused row both render expanded. This contradicts the interaction contract you set ("only one item may be expanded at a time") for 700ms out of every decision cycle.
2. **The app gets slower the faster the reviewer works.** For a reviewer clearing 800 candidates, that is ~9 minutes of deliberately-inserted latency. Worse, it inverts the feedback: an expert working at speed is held back by an affordance designed to reassure a beginner.

Python gets the same reassurance for free and without the cost: `acknowledgeAction()` fires a **non-blocking corner toast** (`app.js:321`) while the view advances immediately. Feedback and progression are decoupled.

**Recommendation:** keep the pulse — it is a good, calm cue and you asked for it specifically. Play it on the *leaving* row while focus and expansion advance immediately, and drop `isAcknowledging` from the `isExpanded` expression. The reviewer still sees the decision land; nothing waits for them to see it.

This is your call, not mine — you asked for the 0.5–1s beat explicitly. But I'd separate "the decision was accepted" (which should be instantaneous and non-blocking) from "here is a 700ms animation" (which should never gate the next action).

**Classification: Adapt. Difficulty: S. Risk: low.**

---

### RX-15. The command bar is doing three jobs — *Medium*

`renderCommandBar` (`app.ts:2649`) emits, in one horizontal strip: the shortcut legend, a selection count, a "Next undecided" button, a "Previous decision" button, a "Next ambiguity" button, and a "Jump to category" `<select>`.

Python's command bar is **only** a contextual keyboard legend. It has no buttons, it derives entirely from where DOM focus is, and — importantly — it *animates itself out of existence* when there is no relevant context (`style.css:124`: `max-height: 0; opacity: 0; visibility: hidden`, with a 140ms transition). It is present when useful and absent otherwise.

Three specific problems with the current mix:

- A reference strip that also contains actions trains the reviewer to look there for both, so neither reads quickly.
- `Next ambiguity` renders on **every** stage including Output and the empty QA stub.
- "Jump to category" is the third overlapping way to filter by category (alongside the By Category view and its own chip row).

**Recommendation:** the bar becomes purely the contextual legend (keeping the excellent `commandBarLegend()` derivation). The navigation actions move into the stage toolbar where the other stage-scoped controls already live.

**Classification: Adapt. Difficulty: S. Risk: none.**

---

### RX-16. Category Check is missing its third axis — *Low*

Python's quality navigator is three levels — **Review State → Category → Context** — with live counts at each level and a breadcrumb path label (`qualityPathLabel()`, `app.js:288`). The Context axis is category-aware: inside "Likely acronym" it offers All Caps / Contains Periods / Institution Context / Repeated; inside "Unknown capitalized token" it offers Single Occurrence / Sentence Initial / Mid-Sentence / High Likelihood (`contextOptionsForCategory`, `app.js:149`).

Web has the first two axes. The deferral is documented and was reasonable. Worth noting what's actually lost: the Context axis is what turns "review 340 unknown capitalized tokens" into "review the 45 sentence-initial ones, which are almost certainly false positives, as one batch." That is a genuinely large time saving on exactly the category that produces the most noise.

The breadcrumb is also missing — Web shows chips but no "Total / Likely acronym / All Caps" path line, so a reviewer three levels deep has no single-glance statement of what they're looking at.

**Classification: Adapt (the Context predicates should be derived from the TS quality model, not ported verbatim from Python's regex heuristics). Difficulty: M.**

---

### RX-17. Group Check's two-column mode is broken and its member list escapes its row — *Medium*

**Verified:** in `renderGroupStage`, the member list is appended to `list` as a **sibling** of the group row (`app.ts:2391`), not nested inside it. In `.group-list-grid` (a two-column CSS grid), `.group-members` therefore becomes its own grid cell and renders in the **adjacent column**, visually detached from the group it belongs to. `.not-quite-panel` has `grid-column: 1 / -1` to work around exactly this; `.group-members` does not.

Combined with RX-10 (arrows treat the two-column grid as 1D), the "2-column view" toggle currently produces a layout whose members are misplaced and whose navigation doesn't match what's on screen.

**Recommendation:** either give `.group-members` the same `grid-column: 1 / -1` and add the 2D arrow mapping, or retire the toggle until RX-10 lands. Shipping a broken mode behind a button is worse than not offering it.

**Classification: Adapt. Difficulty: S.**

---

### RX-18. There is no quiet status channel — *Medium*

Python has two feedback registers: the transient toast for decisions, and a persistent, unobtrusive `status()` line (`app.js:300`) for lower-priority narration — *"Detail opened."*, *"Changes accepted. Results recategorized."*, *"This candidate was resolved in Group Check. Open detail to inspect it."*

That last one is worth dwelling on: Python explains a *refusal*. Web has no channel for that at all, so a refused action is either an `alert()` or silence. Silence is the current default for most of them.

**Recommendation:** one persistent `aria-live="polite"` status region, used for both the toast (RX-09) and quiet narration. This also gives RX-25 its announcement channel for free.

**Classification: Adapt. Difficulty: S.**

---

### RX-19. The time estimate is a lifetime average and never recovers — *Low*

`estimateRemainingReviewTime` (`app.ts:1075`) computes `(last - first) / (n - 1)` over **all** `candidate-decided` events. That includes the initial orientation period, every coffee break, and any overnight gap. One lunch break permanently inflates the estimate for the rest of the session, because a lifetime mean cannot shed an outlier.

The principle behind it — "no AI, just the reviewer's own pace" — is right and should be kept. A **median over the last ~20 decisions** is equally explainable, equally trivial arithmetic, and roughly ten times more accurate. A number offered to build confidence should not be quietly wrong.

**Classification: Adapt. Difficulty: S.**

---

## Part 4 — Remove

Both implementations fall short; neither should be copied.

### RX-20. The permanent top bar — *High*

`render()` unconditionally emits, above everything, on every stage, for the whole session: a "Load document" file input, a "← Documents" button, "Save Session", a "Resume session" label plus **two more file inputs** plus a "Resume" button, and an "Import prior decisions" file input. That is **four raw `<input type="file">` elements permanently occupying the top of a reviewer's workspace.**

Python's `.filebar` is smaller but has the same disease — a file input, a Scan button, and a Generate Output button always visible — plus a "Restart local app" developer button shipped in the reviewer UI.

Neither is right. Raw file inputs are the least attractive control in HTML, they are needed roughly twice per session, and they sit in the position of highest visual priority. They also make the Tab order start with three file pickers.

**Recommendation:** document-lifecycle actions belong in a single collapsed menu or on the landing page. The workspace header should carry the document name, progress, and stage tabs — nothing else.

**Classification: Remove (both). Difficulty: M. Risk: low.**

---

### RX-21. The QA stage stub — *Medium*

The QA tab renders: *"No interactive QA model in this build -- see phase-9-findings.md ('qa'/'output' have no per-item traversal)."*

An empty tab that cites an internal findings document is developer scaffolding in a reviewer product. It also consumes a slot in the stage tab bar, which is the primary progress indicator, and it appears in every `moveStage` traversal.

The specification names this as genuinely undecided. It should be decided: remove the tab, or give it content. Leaving it is the one option that costs the reviewer something every session.

**Classification: Remove (pending your decision on repurposing). Difficulty: S.**

---

### RX-22. Terminology drifts within a single screen — *High*

Verified inconsistencies visible simultaneously in Item Check:

| Surface | Word used |
|---|---|
| Decision button | **Change** |
| Decided row label (`app.ts:2037`, renders `decided.decision`) | **Rename** |
| Statistics bar (`app.ts:1115`) | **Rename** |
| Filter preset chip | **Renamed** |
| Bulk action button | **Change selected** |
| Command bar legend | **C Change** |

And for Not Quite: button **Fix this**, panel heading **Fix this -- members:**, exit button **Exit (Escape)**, completion button **Done fixing** — but the underlying command remains `enterNotQuite`, and the specification, findings docs, and CSS class names all still say "Not Quite."

The decision to keep `"Rename"` as the durable audit/schema vocabulary is correct and should not change. The problem is that there is no single **display** mapping, so the durable vocabulary leaks into reviewer-facing surfaces wherever a decision string is rendered directly.

**Recommendation:** one `DECISION_DISPLAY_LABEL` map, used at every rendering site. Nothing reads `decision.decision` into the DOM directly.

**Classification: Remove the drift (not the underlying vocabulary). Difficulty: S. Risk: none.**

---

### RX-23. Decision controls on every row — *Medium*

Covered under RX-03 but separable and independently shippable: render Keep/Change/Redact/Ignore only on the **focused/expanded** row. Unfocused rows show name, count, type, confidence, and decision state.

This halves row height, roughly doubles items-per-screen, and removes ~4N buttons from the DOM — a large fraction of RX-05's performance concern — without waiting for the full grid redesign.

**Classification: Remove. Difficulty: S. Risk: low.**

---

### RX-24. Developer chrome in the product — *Low*

`index.html:276`: *"Review Workspace -- Milestone 3 (Reviewer Productivity). See docs/architecture/review-workspace-reconstruction.md."* — shipped as the app subtitle, on every screen. Similarly the QA stub's `phase-9-findings.md` citation.

The version label (`v2026-07-29.04`) should stay; it serves a real purpose you defined. The milestone name and doc paths should not.

**Classification: Remove. Difficulty: XS.**

---

## Part 5 — Things you did not ask about

### RX-25. There is not a single accessibility primitive in the application — *Critical for production*

**Verified:** `grep -c 'aria-' src/ui/app.ts index.html` → **0 and 0.** No `role=`. No `aria-label`. No `aria-live`. No `aria-pressed`. No `<h1>`–`<h6>` structure inside the workspace. No `:focus-visible` styling except on the quick-pick chips.

Python — which nobody audited for accessibility either — nonetheless has `role="status"` and `aria-live="polite"` on the toast, `aria-live="polite"` on the restart status, `aria-hidden` toggling on the command bar, `aria-pressed` on candidate cells, `aria-label` on the shortcut legend and confidence badges, and `:focus-visible` outlines throughout. It got these for free by building out of semantic `<button>` elements instead of `<div>`s with click handlers.

This is documented in the specification as a known Milestone 4 gap, so it is not news. Two things make it worth restating here:

1. **The intended users are attorneys**, which is a population with a meaningfully higher-than-baseline rate of accommodation needs, and a professional context where accessibility is frequently a procurement requirement rather than a nicety.
2. **It is mostly free if RX-13 lands first.** Real focus on real focusable elements, plus the status region from RX-18, plus `aria-pressed` on decision buttons, covers the large majority of the gap. Doing RX-13 without doing the a11y baseline at the same time wastes the opportunity.

### RX-26. No `prefers-reduced-motion` guard
`.row-acknowledged-pulse` runs a scale transform on every decision — hundreds of times per session — with no reduced-motion media query. For a vestibular-sensitive reviewer that is not a small thing at that repetition rate. Three lines.

### RX-27. Full-page rebuild on every keystroke
`render()` clears `#app` and rebuilds everything, including the top bar's four file inputs and the statistics block, on every search keystroke, every decision, and every background autosave. The rebuild is *why* focus is lost, *why* `<details>` state needed a helper, *why* the search input needs `searchInputFocusPending`, and *why* the inline editor deliberately avoids re-rendering while typing. Four separate workarounds for one root cause.

I am **not** recommending a framework — the no-bundler constraint is sound and should hold. I am recommending scoping the rebuild: the top bar, statistics, tabs, and command bar are cheap to update in place, and only the stage body genuinely needs rebuilding. That alone would retire two of the four workarounds and make RX-05's list large enough to matter.

### RX-28. No empty, loading, or error states
Parsing a large `.docx` blocks with no indication. Empty stages render a bare sentence with no suggested next action. Errors are `alert()`s (RX-09).

### RX-29. Responsiveness is one breakpoint
`@media (max-width: 900px)` collapsing `.expert-grid` is the entire responsive story in `index.html`. Python, by contrast, adapts density at two breakpoints — `.review-grid` drops from 5 columns to 4 below 1550px and to 2 below 1000px, and the quality grid, stage bars, and queue tools all reflow alongside it (`style.css:382–392`). There is also no adaptation upward: a reviewer on a 27" monitor gets the same single column of full-width rows as a laptop user, which is precisely where a multi-column grid pays off most.

### RX-30. Shortcut coverage is uneven across stages

| Key | Item Check | Ambiguity Check | Group Check |
|---|---|---|---|
| K / C / R / I | ✓ | ✓ | ✓ |
| F (Fix this) | — | — | ✓ |
| Home / End | ✓ | ✓ | ✓ |
| `/` search | ✓ | ✗ (no search) | ✗ (no search) |
| `[` / `]` | ✓ | ✗ | ✗ |
| Enter / Escape | ✓ | ✓ | ✗ |
| Directional row nav | ✗ | ✗ | ✓ |

The gaps are individually defensible and collectively confusing: the reviewer cannot form a single mental model of "what the keyboard does here," because the answer genuinely differs per stage in ways the command bar states but does not explain. Python's coverage is more uniform because its stages are more uniform.

Also unresolved and flagged in the specification: **PageUp/PageDown** is documented in `phase-9-findings.md` as ported, and is not bound to anything. And **`q` is now bound to nothing** after the Not Quite → Fix this rebinding, which is fine, but is the kind of thing worth an explicit note in the keymap so it isn't rediscovered later.

---

## Part 6 — Challenges to your assumptions

Four things I think the current documentation has settled incorrectly.

**1. "Focus reverting to `<body>` is correct, not a defect."**
(`review-workspace-specification.md` §7.6.) Addressed in RX-13. This started as an observation about a re-render side effect and hardened into a design principle. It is now paying for itself in a missing scroll-into-view, an absent focus ring, zero screen-reader support, and a second focus model inside Group Check with a bespoke exception to keep it working. I'd retire the claim.

**2. "The Accept-changes / result-set-freeze workflow may not be applicable to this architecture."**
(§7.3.) Addressed in RX-06. The mechanism was built for rescoring; what it *does* is hold the list still while the reviewer works. That need does not depend on when scoring happens.

**3. "Minimizing scrolling / never feeling lost — [BUILT]."**
(§10.2.) Addressed in RX-01. Nothing scrolls the focused item into view. This should be corrected in the specification independent of whether the fix ships.

**4. "Pagination — Nice-to-have (contingent), only if a multi-thousand-candidate document proves it necessary."**
Addressed in RX-05. Framed purely as a performance question. The stronger argument is that `Showing 1–50 of 1,247` is how a reviewer knows how big the job is and how far in they are, and no amount of scrolling substitutes for it.

**One more, offered as an observation rather than a finding:** the last six revisions have all been reactive — you use the app, notice friction, and send a precise instruction. That loop has produced consistently good work. But it optimizes locally: each revision fixes the friction you hit, in the stage you were in, with the layout you had. Every finding in Part 0 and Part 2 above is something that loop structurally cannot surface, because you never hit it — you are testing on documents small enough that a single-column list scrolls fine, and you already know every shortcut. The density and scale problems only appear on a 1,200-candidate document reviewed by someone who has never seen the app.

If you have a genuinely large fixture, reviewing 200 candidates in it end-to-end yourself would likely surface more than the next three revisions of the current loop.

---

## Part 7 — Recommended implementation sequence

Five waves. The ordering is driven by three constraints: fix correctness before appearance; do the enabling change before the changes that depend on it; and never do a large visual change while a navigation defect is still live, because you will not be able to tell which one broke.

### Wave 1 — Restore keyboard trust *(RX-13, RX-01, RX-02, RX-12, RX-30 audit)*
Nothing else matters if the reviewer cannot trust where focus is. RX-13 (real DOM focus) is the enabler: it makes RX-01 nearly free, makes RX-10 tractable, and unblocks RX-25. RX-02 is a correctness bug with a known-good fix pattern already in the file. These are small, high-confidence, and independently verifiable.

**Why first:** every subsequent wave is harder to validate while navigation is unreliable. Also the highest benefit-per-line in the entire backlog.

### Wave 2 — Stop the view fighting the reviewer *(RX-06, RX-04, RX-14, RX-09, RX-18)*
List stability, sticky chrome, non-gating acknowledgement, and a real feedback channel. Together these change the app from "the page moves when I work" to "the page holds still and tells me what happened."

**Why second:** all are low-risk and independently shippable, and RX-18's status region is a prerequisite for RX-09 and a large part of RX-25.

### Wave 3 — Density and scale *(RX-23, RX-27, RX-05, RX-03, RX-10)*
Deliberately ordered smallest-first *within* the wave. RX-23 (buttons only on the focused row) delivers a large share of RX-03's benefit at a fraction of the risk and validates the direction before committing to the full grid. RX-27 and RX-05 make a dense list affordable. RX-03 then lands with 2D navigation (RX-10) alongside it, because a five-column grid without 2D arrows is unusable.

**Why third:** it is the largest change in the review, and it should not be attempted before Waves 1–2 have made the interaction model trustworthy and observable.

### Wave 4 — Consistency and coverage *(RX-22, RX-20, RX-15, RX-07, RX-08, RX-21, RX-17)*
Vocabulary, chrome, command bar scope, per-stage query tools, evidence presentation, and the two unresolved stubs. Grouped because they are all "the workspace should be uniform" changes and reviewing them together is cheaper than reviewing them separately.

### Wave 5 — Production polish *(RX-25, RX-26, RX-28, RX-29, RX-16, RX-19, RX-11, RX-24)*
The named Milestone 4 content, plus the smaller adaptations. RX-25 is marked Critical but sits here deliberately: doing it before RX-13 would mean instrumenting a DOM structure that RX-13 replaces.

### A note on validation
Three consecutive revisions (command bar + inline editors, Group Check Python-parity, quick-pick chips) shipped **without live browser click-through**, for a documented and legitimate environment reason. The specific things those revisions changed — which control has real DOM focus, whether Tab correctly skips the roving grid, whether the pulse reads as intended — are precisely the things a Node harness cannot observe.

Wave 1 makes this worse before it makes it better: it changes the focus model. **I would not start Wave 1 without a live validation pass available**, and I would validate at the end of every wave rather than at the end of the sequence.

---

## Executive Summary

### The five highest-impact improvements

1. **RX-13 — Give the focused row real DOM focus.** One change that simultaneously fixes scroll-into-view, restores a real focus ring, unblocks the accessibility baseline, makes 2D navigation tractable, and retires the second, divergent focus model Group Check had to invent. Everything else in Wave 1 is downstream of it.

2. **RX-02 — Post-decision advance must follow the visible list.** A correctness defect: under an active sort or filter, deciding an item can move focus to a candidate that isn't rendered. This is the same root cause as the arrow-key defect you already reported and fixed — the fix simply wasn't applied to this path.

3. **RX-03 — Recreate the dense scan mode.** Python shows ~50 candidates per screen; the browser shows ~11. On a large document this is the difference between reading a list and reading a page, and it is the primary source of reviewer fatigue that no amount of shortcut polish will offset.

4. **RX-06 — Stop the list moving under the reviewer.** Deciding an item under a "To Review" filter makes it vanish and shifts every row below it. Python's frozen result set solves this deliberately; the current documentation dismisses the mechanism for a reason I believe is mistaken.

5. **RX-01 — Scroll the focused item into view.** Listed separately from RX-13 because it is five lines and should ship regardless. Today, keyboard navigation moves a focus indicator the reviewer cannot see.

### The three best benefit-per-effort improvements

1. **RX-01 — `scrollIntoView` on focus change.** Roughly five lines; removes the most disorienting behavior in the app.
2. **RX-04 — Sticky workspace chrome.** CSS only, no logic change; keeps progress, stage tabs, and the shortcut legend permanently available instead of scrolled away.
3. **RX-22 — One display-label map for decisions.** A single map plus call-site substitution; eliminates "Change / Rename / Renamed" appearing simultaneously on one screen.

### The three architectural decisions that should not change

1. **`FocusNavigator` stays DOM-free.** 2D navigation, visible-list ordering, and viewport concerns belong in the UI layer. RX-10 and RX-02 are both explicitly UI-layer interceptions for this reason. The boundary has held under real pressure and is worth its cost.

2. **Expansion is derived from focus, never tracked separately.** Python re-implements "keep the panel open while moving" in four places. The derived version is correct and eliminates a whole class of drift. RX-14 fixes a consequence of the *acknowledgement* overlay, not of the derivation.

3. **No bundler; full-rebuild rendering as the base model.** The zero-dependency constraint and explicit `.js` specifiers are sound. RX-27 recommends *scoping* the rebuild, not replacing the model — no framework, no diffing library, just not rebuilding four file inputs on every keystroke.

### Concerns to resolve before further feature development

1. **The keyboard model is not trustworthy.** RX-01 and RX-02 mean a reviewer can decide an item they cannot see. Any new feature built on top of this inherits it. Fix before adding.

2. **Two focus models now coexist.** Group Check uses real DOM focus with a bespoke keyboard-gate exception; Item and Ambiguity Check use simulated focus. Every new interactive control has to pick one, and the choice is currently made by accident. Settle this (RX-13) before more controls are added.

3. **Live browser validation has lapsed for three consecutive revisions.** Not a criticism — the environment reason is real and was disclosed each time. But the deferred items are all focus and animation behavior, which is exactly what the next wave of work touches. Re-establish the validation loop first.

4. **Zero accessibility primitives, shipping to attorneys.** Known and deliberately deferred, so this is a scheduling concern rather than an oversight. The specific point is that RX-13 is the natural moment to close most of it, and doing RX-13 without it means instrumenting the same code twice.

5. **The "thin UI" premise has expired.** `app.ts`'s own header still describes itself as a deliberately plain functional-integration placeholder. Four milestones and six interaction revisions later, it is the product. Retiring that framing explicitly would make it easier to justify the kind of work in Wave 3, which currently reads as violating an instruction that no longer applies.
