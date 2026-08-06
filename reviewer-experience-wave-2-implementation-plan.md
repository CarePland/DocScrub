# Reviewer Experience — Wave 2 Implementation Plan

**Class: working — retired (2026-07-30).** Executed; `reviewer-experience-wave-2-findings.md` is the record of what actually landed. Not authoritative for current behavior.

**Companion to:** `reviewer-experience-backlog.md` (approved), `reviewer-experience-wave-1-implementation-plan.md`, `reviewer-experience-wave-1-findings.md`.
**Date:** 2026-07-29
**Precondition:** Wave 1's live browser pass came back clean — RX-14, RX-01, RX-02a, RX-02b confirmed. (The findings doc's status line still reads "Browser validation pending"; that record should be updated.)
**Purpose:** Implementation sequencing only. No design changes, no new features, no re-litigation.
**Constraint honored:** RX-13 remains excluded. Nothing below implements it or prepares for it.

Every line reference was verified against the post-Wave-1 source.

---

## Selection

Wave 1's shape was four items — two XS, two S — one new pure module each for the two behavioral items, two new verify suites, one browser pass, zero domain contact. Wave 2 matches that: **five items, all XS/S, no M, no medium-risk item, one browser pass.**

### Recommended set

| # | Item | Backlog wave | Effort | Why now |
|---|---|---|---|---|
| 1 | Wave 1 closeout — three call sites | — | XS | Closes an asymmetry Wave 1 created |
| 2 | **RX-22** Single display-label vocabulary | 4 | S | Must precede any new reviewer-facing message strings |
| 3 | **RX-04** Sticky workspace chrome | 2 | S | Completes RX-01; draws the seam RX-27 needs |
| 4 | **RX-18** Persistent status region | 2 | S | The channel RX-09 and RX-06 both consume |
| 5 | **RX-09** Retire `window.alert()` | 2 | S | 13 blocking dialogs, including the highest-stakes failure in the product |
| — | *RX-26 `prefers-reduced-motion`* | 5 | XS | Optional rider; see Riders |

Three of the five are the backlog's own Wave 2 (RX-04, RX-18, RX-09). Two changes to that grouping, both argued below: **RX-22 pulled forward from Wave 4**, and **RX-06 held back to Wave 3**.

### Why RX-22 moves forward

RX-18 and RX-09 exist to write reviewer-facing sentences. Bulk-action results are named explicitly in RX-18's own acceptance criteria (#3), and bulk actions are decision actions — the natural message is "Changed 12 candidates." Today the display vocabulary is still split: the statistics bar hard-codes `Rename` (`app.ts:1123`), the decided-row label interpolates `decided.decision` directly (`app.ts:2197`), and the filter preset reads `Renamed` (`itemCheckQuery.ts:49`), while the buttons already say "Change." Build the notification layer first and every new message string becomes a *new* leak site, to be found and fixed later by grep. Build the map first and the notification layer consumes it by default.

This is the only reordering in this wave motivated by avoiding churn rather than by dependency, and it is a small one: RX-22 is one exhaustive `Record` plus roughly four substitution sites.

### Why RX-06 is held

RX-06 (stable result set) is the largest reviewer benefit remaining below Wave 3, and Wave 1 was deliberately built so it would be a caller change — `advanceWithinVisibleList` takes `visibleIds` as a parameter precisely so RX-06 supplies a frozen list without touching the algorithm. That payoff is real and it is waiting.

It is held for two honest reasons, one soft and one about scope:

- **Soft dependency on RX-18.** RX-06's `Refresh list (N)` control, and its requirement to clear the frozen set on document load, resume, and stage change (AC #6), are state transitions the reviewer cannot otherwise see. "Filter re-applied. 240 results." is RX-18's own worked example. Doing RX-06 first means either no narration or an ad-hoc one that RX-18 then replaces. This is a soft dependency, not a hard one — RX-06 would function without it.
- **Scope.** It is the only M in the backlog's Wave 2, it introduces the wave's only new persistent UI state, and it carries a documented failure mode (a stale frozen set outliving a document reload). Adding it here makes Wave 2 measurably larger than Wave 1 rather than approximately equal, which is what was asked for.

**Correcting an overstatement from the Wave 1 plan:** that document implied RX-06 and RX-05 should ship together because pagination must be computed over the frozen set. On closer reading that constraint is satisfied additively — RX-05 pages over `resultSetIds` whenever RX-06 exists — so it is not a hard "same wave" requirement. RX-06 leading Wave 3, with RX-05 immediately after, is the better sequence, but the reason is ordering convenience, not necessity.

---

## Recommended Wave 2

Ordered. Each step independently committable and revertible.

### Step 1 — Wave 1 closeout: three call sites owe Category Check narrowing

Wave 1's findings disclosed that `]`/`[` and the command bar's Next undecided / Previous decision buttons compute their visible list inline and do **not** apply Category Check narrowing, now asymmetric because arrow keys and post-decision advance do. Verified, plus a **third site the findings doc did not name**:

- `renderCommandBar` — `app.ts:2823` (feeds both buttons)
- `handleScaleNavigationKey` — `app.ts:3051` (feeds both `]` and `[`)
- `jumpToFirstSearchResult` — `app.ts:2082` (**unnamed in the findings doc**: pressing Enter in the search box can select a candidate that is not displayed while By Category is active)

All three call `queryItemCheck(...)` inline and stop there. Replace each with `visibleItemCheckIds(state)` (`app.ts:2067`), which now applies the narrowing through RX-02a's pure helper.

This is a behavior change, deliberately deferred out of RX-02a because that step's contract was "no behavior change." It belongs here, not in RX-30 — RX-30 is a documentation and reconciliation item; this is three lines closing a correctness gap in code that shipped four steps ago. Leaving it means a reviewer inside Category Check has two sets of navigation keys that disagree about what the list is, which is the exact defect class RX-02 existed to remove.

No new suite; extend `verify/item-check-category-view-verification.ts` if a pure assertion is available, otherwise fold into the browser pass.

### Step 2 — RX-22 · Single display-label vocabulary

`const DECISION_DISPLAY_LABEL: Record<CandidateDecisionKind, string>` — exhaustive by construction, in `src/ui/`. `"Rename" → "Change"`, the rest identity.

Substitute at the verified leak sites:

- Decided-row label — `app.ts:2197` (interpolates `decided.decision` directly)
- Review statistics bar — `app.ts:1123`. Its counts are already a `Record<CandidateDecisionKind, number>` (`app.ts:1059`); **render by iterating the display map rather than hand-writing the template string**, so a future decision kind cannot be silently omitted from the bar.
- Filter preset label — `itemCheckQuery.ts:49` (`"Renamed"`)
- Group action labels and the command-bar legend — audit `commandBarLegend`'s three strings (`app.ts:2748–2750`) and the Not Quite variant (`app.ts:2784`); several already read "Change," so this is a consistency check, not a rewrite.

Do **not** touch `CandidateDecisionKind`'s literal `"Rename"`, the `renameCandidate`/`flattenGroup`/`enterNotQuite` command names, the `InlineEditorTarget` action union (`app.ts:228–231`), `GROUP_ROW_DECISION_CLASS` keys, or any serialization. The durable audit vocabulary is correct and stays. RX-22's AC #4 is explicit: saved sessions, audit CSV, and `decisions.json` must still contain `"Rename"`.

Verification: extend `verify/ui-smoke.ts` with a structural assertion that no rendering site interpolates a decision kind directly. Fully Node-verifiable — no browser needed for the substitution itself.

### Step 3 — RX-04 · Sticky workspace chrome

`index.html` currently contains **zero** `position:`, `overflow:`, or `scroll-margin` declarations — verified. The whole page scrolls as one.

Two things this step must get right, both about later waves:

**Exclude the top bar from the sticky container.** Group the document line, persistence status, import banner, statistics, warnings, stage tabs, and command bar (`render()`, `app.ts` — the block between `container.appendChild(topBar)` and `const body = el("div", { class: "stage-body" })`) into a `.workspace-chrome` container. Leave `topBar` — the four raw file inputs — outside it. Sticky-ing the top bar makes the sticky region tall enough to eat the viewport, and RX-20 deletes that bar entirely, so it would be a second CSS pass over the same rule.

**Make `.workspace-chrome` a real container node, not a cosmetic class.** Append it once, have the chrome renderers write into it. This matters beyond this item: RX-27 ("scope the render") needs exactly this boundary — `renderChrome()` versus `renderStageBody()` — and if RX-04 draws it as a real DOM seam, RX-27 becomes a much smaller change. If RX-04 instead styles a flat sequence of siblings, RX-27 has to do the grouping work anyway.

**`scroll-margin-top` on rows is mandatory in this step, not optional.** See Hidden Dependency #1 — this is the one place in Wave 2 that can regress already-validated code. Express the chrome height as a CSS custom property and use it for both the sticky offset and `scroll-margin-top`, so RX-20 changes one value.

AC #3 (no sticky chrome on the landing view) is free: `render()` returns early on the landing branch before any chrome is built.

**Live browser validation required** — including the RX-01 re-check with the first and last rows of a long list.

### Step 4 — RX-18 · Persistent status region

One `role="status" aria-live="polite" aria-atomic="true"` element and one `setStatus(text)` writer. Latest message only, not a log.

**Put the element in static `index.html` markup, outside `#app`.** Positioned by CSS to read as part of the chrome; not built by `render()`. Reasons, in order of weight:

1. `render()` clears `container.innerHTML` on every state change, including background autosave renders (`onPersistenceChange`). A region built inside `render()` has its content destroyed by any incidental re-render — this is the project's documented recurring failure class (search-input focus, `<details>` open state), and it would need a third variant of the same workaround.
2. The most likely failure a reviewer ever sees is a document load failure (`app.ts:825`), which fires **while the landing view is showing** — after `render()`'s early return, where no chrome exists. A region inside the workspace chrome has nowhere to render that message.
3. It is immune to RX-27 by construction.

The precedent is already in the file: `.app-version` is static `index.html` markup written once from `app.ts` outside the render cycle, with a `typeof document.querySelector === "function"` guard for the fake DOM. Follow that shape exactly.

Write only on discrete events, never from `render()`. Minimum per AC #3: filter re-application, bulk action results, decision-import results, and every refused or no-op action.

### Step 5 — RX-09 · Retire `window.alert()`

Verified count: `grep -c 'window.alert(' src/ui/app.ts` → **14** = 13 live calls (`app.ts:332, 825, 835, 839, 851, 872, 898, 925, 949, 1380, 1909, 2682, 2913`) plus one doc-comment mention at `app.ts:938`.

The 13 sites are **three kinds, not two.** The backlog describes toast-versus-banner; the third kind is the one RX-18 was built for:

- **Refusals** (`872` "No document loaded — nothing to save", `898` "No current redacted output — generate output first", `2913` "Pick both the saved session JSON and the original .docx"). These are not failures; they are the app declining and explaining why. → status region, no toast, no banner. This is precisely the case RX-18 cites Python for ("This candidate was resolved in Group Check…"), and Web currently has no channel for it.
- **Recoverable failures** (`332`, `925`, `949`, `1380`, `1909`, `835`, `839`) → transient toast, ~1.3s visible with a fade, plus a status-region write.
- **Failures requiring action** (`2682` output generation — the highest-stakes moment in the product; `825` document load; `851` session resume) → persistent dismissible inline banner, reusing `renderImportSummaryBanner`'s existing shape rather than a second banner mechanism.

The toast host goes in static `index.html` alongside the status region, for the same three reasons.

`app.ts:938`'s comment records a real Feature 002 decision (the import handler deliberately does not announce success via a dialog). **Reword it, do not delete it** — AC #1's grep must return 0, and losing the rationale to satisfy a grep would be the wrong trade.

Every converted site must remain visible for at least the toast duration and must still be logged. AC #5: notifications must not shift page layout — overlay or reserved space, never inserted flow content.

**Live browser validation required**, specifically the output-generation failure path.

### Riders

**RX-26 (`prefers-reduced-motion`, XS, backlog Wave 5)** — three lines of CSS in `index.html`, which Step 3 already opens. Wave 1 raised its salience: with `isAcknowledging` removed from expansion, the pulse plus colour plus badge is now the *entire* acknowledgement signal, firing on every decision with no guard. The colour change and `✓ Saved` badge already carry the meaning unaided, so `@media (prefers-reduced-motion: reduce) { .row-acknowledged-pulse { animation: none } }` costs nothing and loses nothing. Drop it without disturbing the wave if you'd rather keep Wave 5 intact.

### Validation

One live browser pass at the end of Step 5. Requires `npm run build` (full emit — `dist/` is what the browser serves) and Andrew running `start-server.command`.

Steps 1 and 2 are Node-verifiable. Steps 3, 4, and 5 are not, in whole or part.

Standing requirement: `npx tsc --noEmit` clean, `npm run build` clean, all suites green. **Count is currently 26** (`ls verify/*.ts | wc -l`) — confirm rather than trusting it.

---

## Rationale

**Why the closeout first.** It is three lines, it finishes work already in the reviewer's hands, and it is the only item in the wave that fixes a live inconsistency rather than adding something. Cheapest possible thing to have behind you.

**Why RX-22 second.** It has no dependencies and it is a precondition for Steps 4 and 5 not creating new vocabulary leaks. It is also fully Node-verifiable, so it lands green before the wave's first browser-only work begins.

**Why RX-04 third.** It completes RX-01 rather than merely sitting beside it, and it establishes the chrome/body DOM seam that RX-18's positioning and RX-27's render split both want. Doing it before RX-18 means the status region is positioned against a chrome that already exists, instead of being placed and then moved.

**Why RX-18 before RX-09.** RX-09 is 13 call sites consuming a channel. Building the consumers before the channel means inventing a temporary one.

**Why RX-09 last.** It is the broadest change in the wave — 13 sites across load, resume, save, output, audit, import, and every bulk path — and the one whose failure mode is silence rather than a visible error. Landing it on top of a validated chrome and a validated status region means a browser-validation failure has one candidate cause.

**What this order deliberately avoids:** new persistent UI state (RX-06), any change to what a row is (RX-23/RX-03), and any change to how rendering works (RX-27). Wave 2 has one browser pass to spend, and each of those would make a failure ambiguous.

---

## Hidden Dependencies

### 1. RX-04 can silently regress RX-01, which is already validated

This is the most important item in this document. RX-01 shipped with **no `scroll-margin-top`**, correctly — there was nothing above the list to collide with, and the Wave 1 plan assigned the offset to RX-04 as its own obligation. The moment `.workspace-chrome` becomes `position: sticky`, `scrollIntoView({ block: "nearest" })` will happily park the focused row *underneath* it: `"nearest"` treats the row as visible when it is behind a sticky overlay, because the sticky element is not part of the scrollport calculation.

Symptom: keyboard navigation appears to work, but the focused row hides behind the chrome at the top edge of travel — intermittently, depending on scroll direction. It will read as an RX-01 defect and it is not one.

`scroll-margin-top` on `.item-row` / `.group-row`, equal to the chrome's rendered height, is therefore part of Step 3 and not a follow-up. RX-04's own AC #2 already demands this ("the sticky chrome never overlaps the focused row after a keyboard-driven scroll, verified with the first and last items in a long list") — worth reading as a regression test on Wave 1, not a new requirement.

### 2. The status region cannot live inside `render()`

Covered in Step 4 and repeated here because the backlog says the opposite ("a single `<div>` in the sticky chrome (RX-04)"). Under this app's full-rebuild render model, a status message written into an `#app` descendant is destroyed by the next incidental `render()` — and background autosave calls `render()` on its own. A reviewer would see messages vanish within milliseconds, non-deterministically. Static markup outside `#app` is the fix, and it also resolves the landing-page case in Hidden Dependency #3.

### 3. The first failure a reviewer ever sees fires before any chrome exists

`handleLoadFile`'s failure alert (`app.ts:825`) and the resume failure (`851`) both execute from the landing view, and `render()` returns early on that branch (`app.ts` landing branch) before the document line, statistics, stage tabs, or command bar are built. Any notification host placed inside the workspace chrome has nowhere to put those two messages — which are, between them, the most probable first error in a session. Static hosts outside `#app` handle both without a special case.

### 4. Wave 2 quietly starts RX-25

`grep -c 'aria-\|role=' src/ui/app.ts index.html` → **0 and 0**, verified. RX-18's `role="status"` / `aria-live="polite"` and RX-09's toast will be the application's first accessibility primitives.

That is fine and it compounds — but build them so RX-25 extends rather than replaces: one `setStatus()` writer, `aria-atomic="true"`, and a single element rather than per-message nodes. RX-25's AC #4 ("deciding a candidate produces one screen-reader announcement naming the candidate and the decision") then becomes a call added to an existing channel. Note the interaction with Step 2: that announcement will want the display label, not `"Rename"`.

### 5. RX-09's AC #1 fails on a doc comment, not a call

`grep -c 'window.alert('` returns 14, of which one (`app.ts:938`) is prose recording a Feature 002 decision. An engineer chasing "returns 0" will either miss it and fail the AC, or delete a comment that should be reworded. Called out so neither happens.

### 6. RX-18 has an unstated obligation to Step 1

Step 1 makes three more navigation paths respect Category Check narrowing. Two of those (`]`/`[`) can now legitimately find nothing to move to inside a narrow category — a **refusal**, and currently silent. RX-18's AC #3 requires every refused or no-op action to write to the status region; `goToAdjacentInVisibleList`'s no-target branch (`app.ts:1843`, `if (target)`) is exactly such a site and is not in the backlog's enumeration. One line while the channel is being wired, or a silent key for another wave.

### 7. `]`/`[` still wrap; the advance still does not

Unchanged from Wave 1 and correctly recorded in `visibleListAdvance.ts`'s doc comment. Step 1 does **not** change it — routing these three call sites through `visibleItemCheckIds()` changes *which items* they consider, not the scan semantics. The divergence remains queued for RX-30, which now has three facts waiting on it (the wrap difference, this wave's refusal narration, and the `q`/PageUp-PageDown documentation discrepancies). RX-30's stated dependency on RX-13 is void; it is a cheap S and it is accumulating.

---

## Future Rework

Nothing in this wave becomes throwaway, and two items are structurally load-bearing for later work.

| Item | Fate in later waves |
|---|---|
| Step 1's three call sites | Permanent. Removes a live inconsistency; nothing later reintroduces it. |
| RX-22's label map | Permanent and widely consumed: RX-15's legend, RX-25's accessible names and announcements, RX-03's collapsed-cell colour vocabulary, RX-07's per-stage toolbars. |
| RX-04's `.workspace-chrome` | Permanent, **and it is the seam RX-27 cuts along.** Built as a real container it makes RX-27 substantially cheaper; built as cosmetic CSS it does not. Survives RX-20 provided the top bar stays outside it. |
| RX-18's status region | Permanent. RX-25 extends it; RX-06 narrates through it; RX-28's error states build on it. |
| RX-09's `notify()` | Permanent. RX-28 (empty, loading, error states) is largely a set of new callers. |

One asymmetry worth stating plainly: **RX-04's `scroll-margin-top` value is coupled to chrome height, and RX-20 changes chrome height.** Expressed as a CSS custom property that is a one-value edit; hard-coded in two rules it is a silent RX-01 regression the second time around. Same defect as Hidden Dependency #1, deferred by a wave.

---

## Notes for Fable

**1. `scroll-margin-top` is not optional and not a follow-up.** It ships in Step 3 with the sticky rule, in the same commit. Wave 1's scroll behavior is validated today; Step 3 is the only thing in Wave 2 that can take that away, and it will do so intermittently and misleadingly. Verify with the first and last rows of a ≥ 100-candidate list in both scroll directions before calling Step 3 done.

**2. The notification hosts go in static `index.html`, outside `#app`.** Two elements: the `role="status"` region and the toast host. `render()` must never create, clear, or write them. Follow `.app-version`'s existing pattern exactly, including the `typeof document.querySelector === "function"` guard — `verify/ui-smoke.ts`'s fake DOM has no `querySelector` and a `classList` implementing only `add`, and it will find this if you get it wrong.

**3. `.workspace-chrome` is a real DOM container, appended once, with the chrome renderers writing into it.** Not a class on a flat sequence of siblings. This is the difference between RX-27 being a small change and a large one.

**4. Do not touch the durable decision vocabulary in Step 2.** `CandidateDecisionKind`'s `"Rename"`, the command names, the `InlineEditorTarget` action union, `GROUP_ROW_DECISION_CLASS`'s keys, and every serialization path stay exactly as they are. This is display mapping only. If a change appears to require editing a schema or a command name, stop — that is a signal, not a task.

**5. Three kinds of message, not two.** Refusals go to the status region, recoverable failures to a toast, action-required failures to an inline banner. Sorting the 13 sites into those three buckets before writing any code is most of RX-09's actual work; the mechanical replacement is the easy part.

**6. One `render()` per user action, still.** Wave 1's choke point holds this invariant. `setStatus()` and `notify()` must not call `render()` — they write to nodes outside the render cycle, which is the whole point of Note #2.

**7. `npm run build` before asking for browser validation, every time.** `tsc --noEmit` passing does not update `dist/`, and `dist/` is what gets served.

**8. Report what you could not verify.** Steps 1 and 2 are Node-verifiable; Steps 3, 4, and 5 largely are not. A findings doc that separates "verified by suite" from "pending live pass" is worth more than one that blurs them — and Wave 1's own findings doc should have its status line updated now that its pass came back clean.
