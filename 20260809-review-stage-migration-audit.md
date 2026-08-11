# Review Stage Migration Audit — Carrying the Ambiguity Interaction Model Forward

**Date:** 2026-08-09
**Status:** Audit only. No production code modified.
**Basis:** current code as of the Ambiguity stabilization (52/52 suites green), plus two instrumented live runs.

---

## Correction before anything else

In my last two reports I said the remaining-count predicate ignores proposal **dismissals**. **That was wrong.** `stageCategories` (app.ts:8257) and the section heading (app.ts:6924) both check `relationshipDismissals` explicitly. That claim came from a synthetic probe of a hypothetical rule, not from the shipped one.

The real predicate divergence is different, larger, and — critically — **latent in Ambiguity but live in Item Check**. It is §D1 below and it is the single most important finding in this audit.

That's twice now a claim of mine has survived only until it was executed. I'd rather flag the pattern than have you discover it.

---

## A. CURRENT ARCHITECTURE MAP

`WORKFLOW_STAGE_ORDER = ["ambiguity-check", "group-check", "type-check", "item-check", "qa", "output"]`

Item Check runs **after** Group Check. That ordering is load-bearing for §D1.

### A1. What is genuinely shared today

`renderSectionedQueue` has exactly **two** callers: `renderTriageQueue` (Item Check Triage) and `renderAmbiguityQueue`. Nothing else in the app uses it.

| Concern | Ambiguity | Item Check Triage | Shared? |
|---|---|---|---|
| Section/category model | `sectionedQueueModel` | `sectionedQueueModel` | **Yes** |
| Queue renderer | `renderSectionedQueue` | `renderSectionedQueue` | **Yes** |
| Only-active-category filter | `visibleSections` (app.ts:6895) | same | **Yes** |
| Category pills | `renderSectionPills` via `sectionedQueueStage` | same | **Yes** |
| Cell keyboard grammar | `handleTriageKey` | `handleTriageKey` | **Yes** |
| Per-unit advance | `dispatchReviewWithVisibleAdvance` | same | **Yes** |
| Completion advance + **new guards** | `advanceAfterSectionCompletion` | same | **Yes** |
| Category arrival | `selectStageCategoryCursor` | same | **Yes** |
| Enter/Escape depth | `focusPanelEntered` | same | **Yes** |
| Proposal cursor | `structuralCardFocusPending` | same (app.ts:6422) | **Yes** |
| Grid arrows | `moveWithinResultsGrid` / sectioned arrows | same | **Yes** |

**Item Check Triage is already ~70% the Ambiguity stage.** The prior Codex audit called it "shares the sectioned-queue renderer" — that is correct but understates it: they share the model, the navigation, the arrival rule, the advance path, and both stabilization guards I just landed.

### A2. The hidden divergence — the Zone is *not* shared

This is behind a single call-site facade and is easy to miss. Four functions branch on stage:

```
orderedReviewTargetsForGrid   (3321)  item-check → [...gridTargets]        (no zone at all)
activeReviewTargetsForGrid    (3330)  item-check → partitionByZone(...).band
restReviewTargetsForGrid      (3341)  item-check → partitionByZone(...).rest
activeZoneAnchorForGrid       (3349)  item-check → undefined               (no anchor)
displayedReviewTargetsForSectionedStage (3361) item-check → flat, unordered by zone
headingActionScope            (10086) item-check → reviewZone(undecided, 24)
```

Two different Zone semantics:

- **Item Check — `partitionByZone` / `reviewZone`:** "the next 24 unresolved," **recompacts on every decision**. The original bulk-safety model.
- **Ambiguity — `activeQueuePartition`:** the **conveyor** — 12-cell chunk retirement, arrival anchor rotation, stable map. Built 2026-08-08 specifically because compaction was wrong for manual one-at-a-time review.

The Ambiguity design doc's own reasoning ("a reviewer deciding cells one at a time needs the map to hold still until a meaningful block of work is done") applies to Item Check Triage identically — it is the same manual rhythm. But Item Check still has the compacting model.

**Consequence:** the advance traverses a *different order* on the two stages, and `displayedReviewTargetsForSectionedStage` returns a zone-ordered list for Ambiguity and a flat one for Item Check. Both feed the same advance functions.

### A3. The non-sectioned stages

| Stage/view | Renderer | Navigation | Category state | Focus panel | Zone | Shared with Ambiguity |
|---|---|---|---|---|---|---|
| **Item Check — List** | inline in `renderCheckStage` | `moveWithinVisibleList` over `visibleItemCheckIds` | none (flat list + toolbar filters) | **inline row expansion** | `reviewZone` via `headingActionScope` | decision keys, colors, `decideAndAdvance` |
| **Item Check — By Category** | `itemCheckCategoryView.ts` (pure narrowing) + inline grid | `moveWithinResultsGrid` (2-D, measured columns) | `categoryFilter` / `categoryReviewState` / `categoryContextFilter` — **its own filter model, not sections** | inline expansion | same | decision keys, colors |
| **Group Check / Not Quite** | `renderGroupStage` | `groupRovingFocus` (row/col) + domain `moveNotQuiteMember` | none | inline member expansion | none | decision vocabulary only |
| **Type Check** | `renderTypeCheckStage` / `renderTypeReviewSurface` | `typeCheckCursor` (**4th parallel cursor**) | none | `.type-focus-pane` (gets the entered ring) | none | `focusPanelEntered`, digits |

Four independent cursors exist app-wide: `focus.target.itemId` (domain), `structuralCardFocusPending`, `groupRovingFocus`, `typeCheckCursor`.

### A4. DOM / render-time influence on navigation truth

Unchanged from the audit, and it now spans both sectioned stages:

- `activeStructuralProposalId()` reads `document.activeElement` → feeds `currentStageCategoryId()`.
- Render tail (app.ts ~13477) nulls the proposal cursor from a DOM query result.
- `lastRenderedActiveStage` / `lastRenderedSectionedCategoryId` written by render, read by decision logic.

**Two instrumented runs produced zero `DOM-as-position-truth` events.** The structure is real; the live frequency is low. That lowers its priority relative to §D1, and I'd rather say so than keep citing the audit's original severity.

### A5. Assessment of the prior Codex audit (`20260808-check-stage-ui-audit.md`)

Read against current code: **directionally right, architecturally silent.** It is a UI/visual audit. Its recommendations ("bring List and By Category to the same hard depth model", "preserve Item Check's selection model", "Group Check's review unit is a group — that is a real difference") all hold up.

What it misses, and what changes the plan:

- No mention of the Zone divergence (§A2) — the single largest structural gap.
- No mention of the resolved-predicate split (§D1) — the one that will actively break Item Check.
- It treats Triage as "already shares the renderer," under-weighting that Triage also inherits every navigation guard, which is both the opportunity and the risk.
- It predates the stabilization entirely, so it has no view on what must *not* be cloned.

Use it for the visual target. Do not use it for sequencing.

---

## B. AMBIGUITY CARRYOVER MATRIX

| Concept | Classification | Action |
|---|---|---|
| Section/category model (`sectionedQueueModel`) | **A — shared and safe** | Reuse directly |
| Category pills, only-active-category | **A** | Reuse directly |
| Cell/row compact scanning object | **A** | Reuse directly |
| Enter = depth, never decides | **B — shared, needs hardening** | Shared flag `focusPanelEntered`, but Item Check List/By Category never set it. Formalize before extending |
| Escape = exit depth | **B** | Same |
| Category arrival (`firstUnresolvedReviewTarget`) | **A** (new, shared, tested) | Reuse directly |
| Per-unit advance | **A** | Reuse directly |
| Category boundary + completion gate | **A** (new, shared, tested) | Reuse directly |
| Acknowledgement pulse | **B** | Presentation-correct, but the cursor pin-back produces a two-cursor frame (§D2) |
| **Zone semantics** | **C — parallel duplication** | Two algorithms, one facade. **Unify before migrating** |
| **Resolved predicate** | **C — and actively dangerous** | ~32 raw sites vs domain predicate. **Prerequisite** |
| Selection + bulk actions | **B** | Shared `selectedCandidateIds`, but scope built from the raw predicate (§D1) |
| Decision keys / colors / tints | **A** | Already one vocabulary |
| Proposal (relationship) units | **B** | Shared machinery, dual-cursor risk (§D2) |
| Item Check search/sort/filter toolbar | **D — stage-specific** | Item Check reviews a large pool; Ambiguity does not. **Keep** |
| By Category filter grid + 2-D results | **D** | A genuine exploration tool, not a review queue. **Keep as a finding surface** |
| Group Check group-as-unit + Not Quite | **D** | Review unit really is a group. **Keep** |
| Type Check member cursor | **D** in semantics, **C** in mechanism | Concept is stage-specific; a 4th bespoke cursor is not |
| Inline row expansion (List / By Category) | **E — legacy** | Migrate to focus panel |
| Group Check inline member expansion | **E**, low priority | Migrate after Item Check |

---

## C. ITEM CHECK TRIAGE AS FIRST TARGET

**Yes — but not for the reason you'd expect, and not first in the sequence.**

It is the right target because it is already the same stage architecturally (§A1). Almost nothing about the *visual* migration is hard.

The complication: **Triage already silently inherited every stabilization change.** `advanceAfterSectionCompletion`, `completionAdvanceIsPermitted`, `advanceWithinCategoryScope`, `firstUnresolvedReviewTarget`, the arrival rule, the category boundary — all of these are live in Item Check Triage *right now*, and **none of my behavioral tests exercise them under Item Check's fixtures.** Every one of my 29 acceptance checks uses an Ambiguity-shaped fixture.

So the honest statement is: Triage is not a migration target so much as a stage that has *already been migrated underneath you, untested*.

**What can be reused directly:** the section model, the renderer, the pills, the arrival rule, the advance path, the boundary guard, the cell keyboard grammar, decision colors.

**What cannot:** the Zone (different algorithm), the resolved predicate (different answer), the scope inspector (Triage's permanent left-column inspector is a *deliberate* Pass-1 divergence — Ambiguity keeps the per-section split; that difference is documented and intentional, category **D**, do not collapse it).

**Does moving it first reduce future cost?** Yes, substantially — but only if the prerequisites land first. Unifying the Zone and the predicate benefits every later stage, and Triage is the cheapest place to prove them because the surrounding architecture is already shared.

**Architectural prerequisites before touching its UI:** §D1 and §D3 below. §D2 is optional-but-recommended.

---

## D. ARCHITECTURAL PREREQUISITES

### D1. The resolved-predicate split — **blocking, and it belongs in shared infrastructure**

`isItemResolved("item-check", id)` → `candidateResolvedStatus(...)` → resolved if **a direct decision exists OR the candidate's occurrences are covered by a resolved entity group** (`coveredOccurrenceIdsByResolvedGroups`, coverage.ts:27).

~32 sites in app.ts instead test `!candidateDecisions[id]` — direct decisions only. They include:

- `stageCategories.remaining` (8264) — **the pill count**
- section heading `remainingIds` / `remaining` (6910, 6926)
- `headingActionScope.undecided` (10081) — **the bulk-action scope**
- `reviewZone(undecided, …)` — **Item Check's Zone membership**
- tier remaining (7655), `remainderItemIds` (6358)

**Why this is latent in Ambiguity and live in Item Check:** Ambiguity is the *first* stage; no group decisions exist yet, so coverage is empty and the two predicates agree. Item Check is the *last* work stage, after Group Check — by then coverage is populated and **the two predicates disagree by construction**.

The concrete failure: navigation (domain predicate) treats a group-covered candidate as done and skips it; the pill and heading (raw predicate) count it as remaining. A category can read "3 remaining" that the advance considers complete — or the reverse. **That is precisely the class of bug you just spent days on, sitting in the stage you are about to migrate into.**

It also affects decisions, not just display: `headingActionScope` builds bulk scope from the raw set, so a bulk action can include candidates already resolved via group coverage.

**Fix location: shared infrastructure**, not Item Check. One exported predicate (`isReviewDisplayTargetResolved` already is the right one) applied at all counting and scoping sites. This is task #6 from the original sequence and it should now be promoted to first.

### D2. The two-cursor acknowledgement frame — **not blocking; fix in shared infrastructure when you do fix it**

From the live trace, seq 60–66:

```
seq 60  advance.visible   QBU -> civitas (categoryChanged, remaining 0)   correct
seq 62  cursor.write L3566  (none) -> QBU        pin-back for the pulse
seq 63  render  category=acronyms  item=person:civitas  card=rel-acronym-QBU   ← disagree
seq 65  advance.completion  QBU -> civitas        timer fires
seq 67  render  category=institutional  item=person:civitas  card=(none)       resolved
```

For ~700 ms, `itemId` names a unit in Institutional while `proposalCursor` names one in Acronyms, and the category derivation picks the card. It self-corrects, and no user-visible defect was reported.

**Does it carry into Item Check?** Yes. Triage sets `structuralCardFocusPending` too (app.ts:6422) and shares the pulse path, so the same frame occurs there.

**Recommendation: do not block migration on it.** It is a symptom of the dual cursor, and the real fix is collapsing candidate+proposal into one `ReviewPosition.unit` — the original tasks #2–#4. That is the largest remaining piece of work and should not be a prerequisite to a UI migration that doesn't depend on it.

But **when it is fixed, it must be fixed in shared infrastructure**, because both sectioned stages have it. Fixing it Ambiguity-side only would create exactly the parallel machine you've told me not to build.

**Interim mitigation, cheap:** add a contradiction rule to `positionTrace` that flags any frame where `categoryOf(itemId) !== categoryOf(proposalCursor)`. It converts a known-but-unquantified risk into a measured one before it becomes an Item Check bug report.

### D3. Zone unification — **blocking for Triage specifically**

Migrating Triage's visuals to the Ambiguity language while it keeps the compacting Zone would produce a stage that *looks* like Ambiguity and *behaves* differently under exactly the manual rhythm the conveyor was designed for. That is the "same appearance, parallel machine" failure you named.

Decide explicitly: does Item Check Triage adopt the conveyor? I believe yes — the design rationale is rhythm-based, not stage-based — but that is a **product decision about bulk-action safety scope**, and the Review Zone design doc §11 reserves that judgment for you.

### D4. `app.ts` remains unexportable

Nothing added here changes it. Every new shared rule must live in a pure module (`visibleListAdvance.ts`, `reviewZone.ts`, or a new one) or it cannot be tested. This is the discipline that made the last two fixes verifiable.

---

## E. MIGRATION ORDER

**Phase 0 — prerequisites (no UI change)**
1. Unify the resolved predicate (§D1). Behavioral tests with a group-coverage fixture.
2. Add the Item Check fixture to the acceptance suite — prove the guards already live in Triage actually hold there.
3. Add the cross-cursor contradiction rule (§D2 interim).
4. Decide the Zone question (§D3). If yes, unify behind one function with a per-stage parameter, not a stage branch.

**Phase 1 — Item Check Triage**
5. Visual/interaction alignment. Should be small once 1–4 land. Keep the scope inspector.

**Phase 2 — Item Check List / By Category**
6. Depth model (Enter/Escape/focus panel) for List.
7. By Category: keep the filter grid as a **finding** surface; route the act of reviewing into the same panel. Do not convert it into a third queue.

**Phase 3 — Type Check**
8. Retire `typeCheckCursor` into the shared position model. Keep member-level review semantics.

**Phase 4 — Group Check**
9. Focus panel for groups. Keep group-as-unit and Not Quite intact. Last because its review unit genuinely differs and it shares the least.

---

## F. ACCEPTANCE TESTS

Per stage, before migration, executing real behavior:

1. **Arrival** — entering a category owns its first unresolved unit, of any kind; a category whose remaining work is a different unit type still lands on work.
2. **Advance** — completing unit *n* owns unit *n+1* in the same category.
3. **Boundary** — no category advance while unresolved units remain, under **every** predicate the stage uses.
4. **Completion** — only the last unit permits leaving.
5. **Depth** — Enter changes depth only; decision count unchanged across every Enter. Escape restores depth, changes nothing else.
6. **Pulse** — completion acknowledgement never changes the owning unit except through the documented completion advance.
7. **Zone** — the displayed sequence of unresolved work is unchanged by the model (`reviewZone.ts`'s own stated invariant).
8. **Predicate agreement** — pill count, heading count, bulk scope and advance all report the same remaining set. **This is the new one and it is the one that would have caught §D1.**
9. **Selection** — bulk scope never includes a resolved unit.

**Testable without a browser:** all of 1–9, provided each rule lives in a pure module. That is the whole reason to do Phase 0 first.

**Requires a real browser:** DOM focus restoration, the entered-pane ring, scroll/section snap, 2-D arrow movement over measured columns, and the pulse's visual timing. Keep the position trace installed through each migration; it is currently the only instrument that observes these.

**Current test reality:** `item-check-work-queue`, `item-check-category-view`, `triage-queue`, `review-scope` are all genuine behavioral suites over pure modules — good, and better than I expected. But **no test executes `renderSectionedQueue` or any navigation path in `app.ts`**; `ui-smoke` is the only file that loads app.ts and it does so as text (39 triage-related, 46 zone-related, 68 scope-related source-string assertions). So Item Check's *pure* logic is tested and its *navigation* is not — the same split that produced the Ambiguity failures.

---

## G. RISKS

**Highest — shared-code regression back into Ambiguity.** Every Phase-0 change touches functions Ambiguity now depends on. The 29-check acceptance suite plus 9 boundary checks are the guard; they must run on every change, and any new shared rule needs its own behavioral test before use.

**High — §D1 will change visible numbers.** Pill and heading counts in Item Check will move when the predicate unifies. The new numbers are correct; they will look like a regression during your run. Worth expecting.

**High — Triage is already running unverified stabilization code.** If a navigation bug appears in Triage before Phase 0, it is most likely my guards meeting Item Check's different Zone/predicate, not a new defect.

**Medium — Zone change alters bulk-action scope.** `headingActionScope` feeds the "a button that cannot say 150 cannot do 150" rule. Changing Zone semantics changes what a bulk button covers. Product-visible; design doc §11 governs.

**Medium — By Category over-migration.** Its 2-D grid and narrowing model are a real exploration tool. Converting it into a third sectioned queue would destroy a genuine capability to gain visual consistency.

**Low — DOM-as-truth.** Structurally real, zero occurrences in two instrumented runs.

---

## H. WHAT NOT TO SHARE

1. **Do not share `structuralCardFocusPending` further.** It is already on two stages. Any third consumer entrenches the dual cursor. New unit types go through one `ReviewPosition.unit`.
2. **Do not generalize the scope inspector to Ambiguity.** Triage's permanent left-column inspector vs Ambiguity's per-section split is a documented, deliberate Pass-1 divergence. Different information density, different stage. Category **D**.
3. **Do not give Group Check a candidate cursor.** Its unit is a group. Sharing the *contract* is right; sharing the *unit type* is not.
4. **Do not port Item Check's search/sort/filter toolbar to Ambiguity.** Ambiguity's traversal list *is* its visible list — a documented property the advance depends on (`goToAdjacentInVisibleList`). Adding a divergent display order would reintroduce the exact gap `dispatchReviewWithVisibleAdvance` exists to paper over.
5. **Do not share the render-tail focus restoration as a pattern.** Four deferred-focus slots already exist. A fifth stage adopting the idiom multiplies the render-writes-navigation surface. Rendering requests focus; it must never own position.
6. **Do not unify the Zone by adding a third branch.** One function, parameterized. `if (stage !== "ambiguity-check")` inside a shared helper is how §A2 happened.

---

## Bottom line

Item Check Triage is the right first target, and it is closer than the prior audit suggests — but it is closer in a way that creates urgency rather than comfort: it is already running the stabilized navigation code, against a different Zone and a different resolved predicate, with no behavioral test covering that combination.

I'd do §D1 first regardless of migration. It is a live correctness defect in the stage you're about to work in, it is invisible in Ambiguity for a structural reason, and it is exactly the kind of thing that would otherwise be discovered by you, mid-run, on a clean document.
