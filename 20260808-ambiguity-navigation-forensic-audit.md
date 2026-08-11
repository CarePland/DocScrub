# Ambiguity Check — Forensic Stabilization Audit

**Date:** 2026-08-08
**Scope:** Why previously-fixed Ambiguity navigation behavior keeps regressing, and why full verification passes immediately before manual failure.
**Status:** Diagnosis only. No production code modified.

---

## Verdict up front

Your suspicion is substantially correct, but not in the way the symptom list suggests.

DocScrub has **one clean navigation state machine and two undeclared ones**. The domain
model (`FocusNavigator` / `navigator.ts`) is well-built, pure, documented, and genuinely
tested. The problem is entirely above it: `src/ui/app.ts` grew a **second** review-position
model out of ~40 module-level mutable variables plus live DOM reads, and a **third**
(completion/acknowledgement/stage-advance) that runs on a 700 ms timer over a pre-dispatch
snapshot. All three write to review position. None of them can see the others' state.

And the reason none of this is caught: **`src/ui/app.ts` has zero `export` statements.**
15,147 lines, 0 exports. Nothing in it can be imported by a test. Every "regression test"
protecting these behaviors is a **regular expression matched against the source file read
as text**. `npm test` exits 1 with "No test runner installed yet."

That is not a coverage gap. It is a structural impossibility. You are not *acting* as the
regression suite by habit — you are the **only executor of `app.ts` that exists**.

---

## A. ROOT CAUSE

Three structural causes, in order of how much they explain.

### A1. Review position is stored in ~40 independent module-level variables, not a model

`app.ts` holds review position across at least these, each independently mutable, none
validated against the others:

| Variable | Line | Role |
|---|---|---|
| `structuralCardFocusPending` | 1396 | proposal cursor |
| `lastRenderedActiveStage` | 1397 | written by render, **read by decision logic** |
| `lastRenderedSectionedCategoryId` | 1398 | written by render, **read by decision logic** |
| `lastRenderedFocusedItemId` | 1097 | render-tail focus gate |
| `activeZoneAnchorBySection` | 1399 | Zone origin per section |
| `focusPanelEntered` | 1091 | interaction depth |
| `triageExpandedId` | 994 | expanded row |
| `rovingFocusPending` | 1384 | deferred DOM focus |
| `detailPanelFocusPending` | 1044 | deferred panel focus |
| `groupRovingFocus` | 1351 | group grid cursor |
| `typeCheckCursor` | 11118 | type-check member cursor |
| `selectedCandidateIds` | 1176 | bulk selection |
| `inlineEditor` | 537 | editor ownership |

`structuralCardFocusPending` alone has **29 assignment sites** (lines 1771, 1804, 3566,
3569, 6123, 6127, 7273, 7522, 8847, 8995, 9094, 9120, 9125, 9292, 9327, 9354, 9504, 9791,
9802, 9865, 12336, 12347, 12359, 12414, 13477, 14877, 15025, 15028, …) and 57 references.

Its name says `Pending` — it was born a *render intent* ("re-focus this card after the
rebuild"). It is now the **authoritative proposal cursor**, read by
`currentReviewDisplayTargetKey`, `currentStageCategoryId`, `currentSectionedQueueContext`,
`handleTriageKey`, and the advance path. A variable whose name promises it is transient,
whose semantics are durable, written from 29 places, is exactly the shape that produces
"we fixed it and it came back."

**Category: objective defect.** Not style, not preference.

### A2. The DOM is a source of navigation truth

`activeStructuralProposalId()` (line ~9182):

```ts
function activeStructuralProposalId(): string | null {
  if (structuralCardFocusPending) return structuralCardFocusPending;
  const active = document.activeElement as HTMLElement | null;
  const fromActive = active?.closest?.("[data-proposal-id]")?.getAttribute("data-proposal-id") ?? null;
  if (fromActive) return fromActive;
  return document.querySelector<HTMLElement>(".triage-row-focused[data-proposal-id], .relationship-card[data-proposal-id]:focus")
    ?.getAttribute("data-proposal-id") ?? null;
}
```

This is called by **`currentStageCategoryId()`** (line 8277) — the function that answers
*"which category is the reviewer in?"*

So the answer to "which category am I in" depends on `document.activeElement`. Browser
focus is influenced by clicks, `innerHTML = ""` (which drops focus to `<body>`), the
acknowledgement timer, `scrollIntoView`, and the four separate deferred `.focus()` calls in
the render tail. **Category identity is downstream of browser focus accidents.**

This directly violates the repo's own stated boundary in `AGENTS.md`
("`FocusNavigator`/`navigator.ts`/`keymap.ts` never depend on rendered/UI-only state") —
the boundary was honored in the domain layer and then reinvented, inverted, in the UI layer.

### A3. Render mutates navigation state

The render tail (lines ~13467–13480) does this:

```ts
const pendingCardId = structuralCardFocusPending as string | null;
if (pendingCardId) {
  const cardEl = ...querySelectorAll(".relationship-card")...
  const rowEl  = ...querySelectorAll(".triage-row[data-proposal-id]")...
  if (!cardEl && !rowEl) {
    structuralCardFocusPending = null;  // proposal cell gone: cursor dies with it
    focusPanelEntered = false;
  }
  ...
}
```

**Rendering deletes the cursor based on what it did or did not find in the DOM.** This is
Failure 2 verbatim — and the "fix" for Failure 2 was to add `rowEl` to the search, i.e. to
widen the query rather than remove render's authority to destroy the cursor. The next
render site that doesn't paint a matching selector (a filter, a Zone bound, a collapsed
tier, a pill that hides sibling sections — and note line 6836 deliberately renders **only
the focused category**) reproduces the same class of bug with a new selector.

Render is not a pure function of state here. It is a **second writer**.

---

## B. STATE / NAVIGATION MAP

You asked for all twelve. Here they are, with what each treats as authoritative.

### The three competing "resolved" predicates

1. **`isItemResolved`** — `src/engines/navigation/stages.ts`. Domain truth. Candidates only.
   Used by `FocusNavigator.reconcile`.
2. **`isReviewDisplayTargetResolved`** — `app.ts:3341`. Domain truth **plus** proposals plus
   `relationshipDismissals`. Used by the visible-order advance.
3. **Raw `candidateDecisions[id]` truthiness** — **32 sites in `app.ts`**, including
   `selectStageCategoryCursor` (12345), `jumpToSection` (12334), and `stageCategories`
   (8264, the number printed on the pills).

These do not agree. #3 ignores group coverage, semantic types, and proposal dismissal.
The pill says "(3) remaining", the domain thinks 1, the display advance thinks 2.

### The three competing orderings

1. **`itemIdsForStage`** — domain/structural order over the whole stage.
2. **`sectionDisplayTargets`** — section order, candidates then proposals.
3. **`orderedReviewTargetsForGrid`** — **Zone-anchored** order, via
   `activeQueuePartition(..., ZONE_CAPACITY=24, activeZoneAnchorForGrid(...))`.

`arrivalTarget()` in the domain lands on the first unresolved item of the **whole stage**.
The UI then *derives* which category to paint from that item. Those two steps have no
shared definition of "first."

### The three competing advance mechanisms

| # | Mechanism | Where | Ordering | Triggered by |
|---|---|---|---|---|
| 1 | `FocusNavigator.reconcile()` | `navigator.ts` | domain order | every successful dispatch, automatically |
| 2 | `dispatchReviewWithVisibleAdvance()` | `app.ts:3686` | display order snapshot | every review dispatch, overrides #1 |
| 3 | `advanceAfterSectionCompletion()` | `app.ts:8029` | pre-dispatch snapshot | **700 ms timer** after acknowledgement |

Mechanism 2 explicitly overrides 1 ("when it differs from where reconcile() landed, select
that target"). Mechanism 3 then overrides 2, **asynchronously, 700 ms later**
(`ACKNOWLEDGEMENT_MS = 700`, line 309), reading a `targets` array captured *before* the
dispatch, and it is the only one that can call:

```ts
if (advanceStageWhenExhausted) dispatcher.dispatchNavigation({ type: "moveStage", direction: "next" });
```

**Mechanism 3 is the strongest candidate for Failure 4.** Note that
`snapshotCurrentScopeCompletionAnchor` (7956) sets
`sectionTargetKeys: scopeTargets.map(...)` where `scopeTargets = activeReviewTargetsForGrid(...)`
— that is **the active Zone of one grid (≤24), not the section**. `sectionCompletedByAnchor`
then reports "section completed" when **the Zone** is exhausted, and
`acknowledgeCandidateDecisionFeedback` passes `advanceStageWhenExhausted = true`.
So: finish a Zone → 700 ms later, a stale-snapshot advance runs → if it returns null,
**stage advance fires while the category still has unresolved work.**

I am flagging this as the highest-probability mechanism, not as proven — confirming it
requires executing the path, which (see §C) is currently impossible.

### Point-by-point

| # | Concern | Lives in | Authoritative source | Mutated by | Overwritten at render? | Candidates vs proposals |
|---|---|---|---|---|---|---|
| 1 | Active category | `currentStageCategoryId` 8276 | **DOM focus** → `structuralCardFocusPending` → `focus.target.itemId` → `lastRenderedSectionedCategoryId` | 4 indirect sources | **Yes** (6836) | shared fn, divergent inputs |
| 2 | Active review unit | split: `focus.target.itemId` + `structuralCardFocusPending` | neither — `currentReviewDisplayTargetKey` (3327) picks by `!== null` | dispatcher + 29 sites | **Yes** (13477) | **parallel** |
| 3 | Candidate cursor | `FocusState.target.itemId` | `FocusNavigator` (clean) | dispatcher only | No | domain |
| 4 | Proposal cursor | `structuralCardFocusPending` | itself + DOM fallback | **29 sites** | **Yes** | UI-only |
| 5 | Focus-panel ownership | `focusPanelEntered` 1091 | itself | 11 sites | **Yes** (13478) | shared flag, two meanings |
| 6 | Selected/expanded row | `triageExpandedId` 994 | itself | 8 sites + render (6796, 7705) | **Yes** | candidate-only |
| 7 | Zone membership | `reviewZone.ts` (**pure, good**) | `(ordered ids, resolved set, 24)` | anchor via `activeZoneAnchorBySection` | anchor cleared 13027 | shared |
| 8 | Resolved ordering | 3 predicates × 3 orderings | none | — | — | divergent |
| 9 | Post-decision advance | 3 mechanisms above | last writer wins | — | — | unified list, divergent snapshots |
| 10 | Render-time restoration | render tail 13440–13530 | DOM query results | — | **is the overwriter** | separate paths |
| 11 | Category completion | `sectionCompletedByAnchor` 7979 | **Zone**, mislabeled as section | timer | — | shared |
| 12 | Keyboard / focus depth | `keymap.ts` (clean) + 6 UI handlers | contested | `handleTriageKey` bails when `structuralCardFocusPending !== null` (9081) | — | **parallel** |

**Answer to your explicit question:** yes. There are three overlapping navigation state
machines. The domain one is correct and is routinely overruled by the two above it.

---

## C. WHY THE TESTS PASS

This is the most important section, and the finding is unambiguous.

### `app.ts` exports nothing

```
$ grep -c "^export" src/ui/app.ts
0
```

15,147 lines. Zero exports. `advanceWithinDisplayedReviewTargets`,
`currentReviewDisplayTargetKey`, `selectStageCategoryCursor`, `sectionedQueueModel`,
`snapshotCurrentScopeCompletionAnchor`, `advanceAfterSectionCompletion`,
`currentStageCategoryId`, the render tail — **none can be imported by any test.**

`npm test` → `"No test runner installed yet -- see README.md" && exit 1`.

### So the "regression tests" assert on source text

`verify/ui-smoke.ts` is 1,478 lines: 194 `check()` calls, of which **346 assertions read
`appSource`** — obtained at line 174 as:

```ts
const appSource = readFileSync(new URL("../src/ui/app.ts", import.meta.url), "utf8");
```

**The file is read as a string.** The suite greps it.

Here is the actual test added for **your Failure 1**:

```ts
check(
  "relationship card decisions snapshot the acted-on proposal, not the stale candidate focus panel",
  /function applyRelationshipBulk\(proposalId: string[\s\S]{0,900}?structuralCardFocusPending = proposalId;[...]/.test(appSource) &&
    appSource.includes("completing proposal 2 of 4 advances to") &&
    appSource.includes("not to whatever the candidate-panel")
);
```

The clause reported to you as *"regression coverage verifies proposal 2 of 4 advances to
proposal 3"* is `appSource.includes("completing proposal 2 of 4 advances to")` — **an
assertion that a comment string is present in the file.** No proposal exists. No decision is
made. Nothing advances.

And **your Failure 2**:

```ts
check(
  "proposal cursor survives on the selected row even if the expanded detail card is absent...",
  appSource.includes('container.querySelectorAll<HTMLElement>(".triage-row[data-proposal-id]")') &&
    appSource.includes("if (!cardEl && !rowEl)") &&
    appSource.includes("proposal cell gone: cursor dies with it")
);
```

Three string matches confirming the patch was typed.

### What this means

These tests verify that **a specific patch is still physically present in the file**. They
are change-detectors for lines of code. They cannot fail for any behavioral reason, and they
cannot pass for one either. They will keep passing while the workflow is completely broken,
and they will fail spuriously on any rename or reformat.

Answering your specific questions:

- **Which verify genuine user-visible workflow invariants?** `focus-navigator-verification.ts`
  (661 lines, real engines, real dispatches) — but only for the **domain** navigator, which
  is not where the bugs are. `review-zone-verification.ts`, `visible-list-advance-verification.ts`,
  `triage-queue-verification.ts` genuinely test their pure modules. These are good tests of
  correct code.
- **Which verify implementation details?** All 346 `appSource` assertions.
- **Which reproduce narrow historical bugs without proving the contract?** Essentially every
  check added in the last two weeks, including all four of your failures.
- **What transitions are never exercised?** Every one you listed: category arrival,
  cross-unit advance, category completion gating, focus-panel depth, render-time restoration,
  and all three advance mechanisms interacting. **Zero coverage** — not weak coverage.
- **Are tests bypassing the browser/render/focus lifecycle?** Completely. `ui-smoke.ts`'s
  `FakeElement` has no `querySelector`, no `activeElement`, no focus model. It confirms the
  module loads and the empty-state render doesn't throw. The suite's own header says so
  honestly. The problem is that everything else was then piled on top of a file-reader.
- **Do assertions allow contradictory UI states?** They cannot detect UI state at all.
- **Are we accumulating patch-memorializing tests?** Yes — that is precisely and literally
  what `ui-smoke.ts` has become.

**This is why steps 5–8 of your cycle always pass. They are not measuring the product.**

---

## D. STABILIZATION PLAN

Not a rewrite. The domain layer is good and stays untouched. Four steps, smallest first.

### D1. Make `app.ts` testable — extract the review-position model (the load-bearing step)

Create `src/ui/reviewPosition.ts`: a **pure, exported, DOM-free** module owning one type:

```ts
export interface ReviewPosition {
  stage: "item-check" | "ambiguity-check";
  categoryId: string;
  unit: ReviewDisplayTarget;   // discriminated: candidate | proposal — ONE cursor, not two
  depth: "grid" | "entered";   // replaces focusPanelEntered
}
```

with pure functions taking `(sections, resolvedSet, position)` and returning a new position:

- `arriveInCategory(...)` — first unresolved unit, one definition for pills, ⌥←→, restore
- `advanceAfterDecision(...)` — the **single** advance
- `reconcilePosition(...)` — staleness recovery, no DOM
- `mayAdvanceCategory(...)` — **explicitly false while the category holds unresolved work**

This is the same discipline `reviewZone.ts` already applies, and its doc comment already
argues for exactly this ("a decision path whose scope depends on layout can only be verified
in a browser… that is the same structural blind spot that let the Type Check member-cursor
advance regress three times"). That argument was correct and should be extended, not
re-litigated.

**Your proposed architecture is right, with one correction:** you framed it as "there should
be an authoritative model." There already is one — `FocusNavigator`. The actual work is not
building a model, it is **deleting the UI's shadow model** and giving the UI layer a small
declared position type that composes with the domain one instead of overruling it. That is a
meaningfully smaller job than it sounds.

### D2. Collapse the two cursors into one

Delete `structuralCardFocusPending` as a *cursor*. `ReviewPosition.unit` is a discriminated
union; a proposal is a unit, not an exception. Retain at most one `pendingDomFocus:
ReviewDisplayTarget | null` consumed and cleared by the render tail, which **may never write
back to position**.

This alone removes: the 29 write sites, the `handleTriageKey` bail-out at 9081, the
`currentReviewDisplayTargetKey` `!== null` branch, and the whole Failure-1/Failure-2 class.

### D3. One advance, one resolved-predicate

- Delete mechanism 3's independent path. Section completion becomes a *presentation*
  concern (the acknowledgement pulse); it must not compute or dispatch navigation.
- Make `advanceAfterDecision` the only writer, called synchronously post-dispatch.
- Route all 32 raw `candidateDecisions[id]` sites through `isReviewDisplayTargetResolved`.
- Fix the mislabel: rename the Zone-scoped anchor so nothing can read "Zone exhausted" as
  "category complete."
- Gate stage advance on `mayAdvanceCategory` — which reads the category, not a snapshot.

### D4. Delete the source-text assertions

Remove the ~346 `appSource` string checks. They are not protecting anything and their
presence is actively harmful: they make a green suite mean "the patch is still typed there,"
which is how four consecutive fixes were reported as verified. Replace with behavioral tests
against the extracted module (§G).

Keep `ui-smoke.ts`'s original, honest job: module loads, initial render doesn't throw.

### The right LEVEL of testing

You named it correctly. The unit of test is **a category traversal**, not a variable
assignment. Tests should read as sequences of reviewer actions with position assertions
between them, over the pure model — no DOM, no browser, fast, and unable to pass while the
workflow is broken. One such test replaces a dozen `appSource` greps and is the only kind
that can fail for the right reason.

---

## E. RISK

Honest assessment of what this can disturb.

**High** — *Zone anchoring.* `activeZoneAnchorBySection` feeds display order, which feeds
advance order. Consolidating position changes when the anchor is set. Mitigation: port the
anchor rule verbatim into the pure model first, pin it with tests against current behavior,
then change nothing else in the same pass.

**High** — *Acknowledgement timing.* Removing the 700 ms deferred advance changes the felt
rhythm of category completion, which is a deliberate product behavior, not incidental. The
*advance* must move out of the timer; the *pulse* must stay. These need to be separated
carefully, not collapsed.

**Medium** — *Item Check triage.* The sectioned queue is shared. Item Check's Triage view
uses the same `sectionedQueueModel`, `headingActionScope`, and advance path. Fixes will land
there too — mostly correctly, but it must be re-tested, not assumed.

**Medium** — *Predicate unification.* Switching the 32 raw lookups to
`isReviewDisplayTargetResolved` **will change visible counts on the pills.** Those numbers
are currently wrong; the corrected numbers may still look like a regression to you during
testing. Worth knowing before you see it.

**Medium** — *Type Check.* `typeCheckCursor` is a fourth parallel cursor with the same shape
and, per `reviewZone.ts`'s own comment, the same regression history. It is **out of scope
here** but will look like an obvious candidate for the same treatment. Resist that in this
pass.

**Low** — *Group Check / Not Quite.* `groupRovingFocus` and the Not Quite panel pin are
genuinely separate and `reconcile()` handles them correctly. Leave them alone.

**Not a risk, but state it:** the ~346 deleted assertions will make the suite's pass count
drop sharply. That is the point, and it should not be read as lost coverage.

---

## F. IMPLEMENTATION SEQUENCE

Ordered so that each step is verifiable before the next, and no step depends on a later one.

1. **Write the acceptance test first (§G), against today's code.** Extract only what it needs
   to run. It must **fail** on the current build, reproducing at least Failures 3 and 4. If it
   passes, my diagnosis is wrong and we stop and re-examine. *No production change.*
2. **Extract `reviewPosition.ts` as a pure module, unused.** Port the existing rules verbatim,
   including the Zone anchor. Pin with tests. *No behavior change; nothing calls it yet.*
3. **Route reads through it.** `currentStageCategoryId`, `currentReviewDisplayTargetKey`,
   `selectStageCategoryCursor` become thin wrappers. **Delete the DOM fallback in
   `activeStructuralProposalId`.** Writes still go to the old variables.
4. **Route writes through it.** Collapse the two cursors (D2). `structuralCardFocusPending`
   becomes render-only `pendingDomFocus`. Render tail loses authority to null the cursor.
5. **Unify the advance (D3).** Delete mechanism 3's navigation dispatch; keep the pulse. Gate
   stage advance on `mayAdvanceCategory`.
6. **Unify the resolved-predicate.** All 32 sites. Expect pill counts to change.
7. **Delete the `appSource` assertions (D4).**
8. **You re-run the clean end-to-end document.**

Steps 1–2 are safe by construction. Step 3 is the first behavioral change and the natural
place to stop and re-test before continuing.

**Rule of engagement, restated for whoever implements this:** if any step requires breaking a
documented behavior — the Zone bound, the acknowledgement pulse, category-first presentation,
Enter-never-decides — **stop and surface the conflict.** Do not resolve it in code.

---

## G. ACCEPTANCE TEST

The behavioral sequence that defines "Ambiguity navigation is stabilized." Written against
the pure model, no browser required. Must fail today.

**Fixture:** an Ambiguity stage with three categories:
- **Cat A** — 4 candidate units, all unresolved
- **Cat B** — 3 relationship proposals, no candidates (the proposal-only case that broke)
- **Cat C** — 2 candidates + 2 proposals interleaved, plus 30 units (to force a Zone boundary at 24)

**Sequence — every assertion is on `ReviewPosition`, and every step asserts the negative too:**

```
 1. Enter Ambiguity            → position = Cat A, unit 1.        AND stage did not advance.
 2. Redact unit 1              → Cat A, unit 2.                   AND category did not advance.
 3. Keep unit 2                → Cat A, unit 3.                   AND category did not advance.
 4. Ignore unit 3              → Cat A, unit 4.                   AND category did not advance.
 5. Change unit 4              → Cat B, proposal 1.               Category advance permitted ONLY here.
 6. Decide proposal 1          → Cat B, proposal 2.               AND category did not advance.
 7. Dismiss proposal 2         → Cat B, proposal 3.               AND category did not advance.
 8. Decide proposal 3          → Cat C, unit 1.                   Category advance permitted.
 9. Work Cat C to the Zone     → position stays in Cat C.         Zone exhaustion is NOT completion.
    boundary (24 units)          Next unit is unit 25, same category.
10. Complete all of Cat C      → stage advance permitted.         ONLY here.
```

**Plus the invariant assertions, checked after every single step:**

- **I1.** Exactly one unit owns interaction. No state in which both a candidate cursor and a
  proposal cursor are set.
- **I2.** The owning unit is unresolved, unless every unit in the category is resolved.
- **I3.** `position.categoryId` contains `position.unit`. They cannot disagree.
- **I4.** Enter changes only `depth`. It never changes `unit`, and never produces a decision.
  *(Assert the decision count is unchanged across every Enter.)*
- **I5.** Escape decreases `depth` and never changes `unit` or `categoryId`.
- **I6.** No category advance occurs while `remaining(category) > 0`, under any predicate.
- **I7.** Reconciling an already-reconciled position is a no-op (idempotence — this is the
  one that catches render-time overwrites).
- **I8.** Every assertion above holds identically for candidate units and proposal units.
  Same test body, both fixtures.

**Then, separately — the thing no unit test can replace:** one scripted browser pass through
a real document, driven by keyboard only, asserting the same ten steps. The repo has honestly
disclosed for months that it has no browser in verification
(`ui-smoke.ts` header; `reviewZone.ts`'s "same structural blind spot that let the Type Check
member-cursor advance regress three times"). The blind spot was correctly identified, and the
response was to route *around* it. Steps 1–8 close most of it purely. Closing the rest needs
a real page — that is a separate decision for you, and I'd rather flag it than quietly assume
you want it.

---

## Summary

| Question | Answer |
|---|---|
| Multiple overlapping navigation state machines? | **Yes — three.** Domain (correct), UI shadow (~40 vars + DOM), completion/timer. |
| Is the architecture basically fine? | **No.** The domain layer is; the UI layer inverted its own documented boundary. |
| Is it broken enough to rewrite? | **No.** ~4 focused changes, domain untouched. |
| Why does verification pass? | `app.ts` has **0 exports**. 346 assertions grep the source file as **text**. `npm test` exits 1. |
| Is your proposed architecture right? | **Yes, with a correction:** the model exists — the work is deleting the shadow, not building a new one. |
| Why do fixes keep coming back? | Each fix widened a DOM query or added a 30th write to a cursor named `Pending`. The structure that produces the bug was never the thing being patched. |
