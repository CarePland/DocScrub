# Stabilization Pass — Step 1 Result: STOP

**Date:** 2026-08-08
**Status:** Halted at step 1 per your rule of engagement. **No production code modified.**
**Repo state:** clean of my changes — `verify/` back to 52 files, `src/` untouched.

---

## What happened

I wrote the acceptance test and a faithful, line-cited port of the pre-stabilization
`app.ts` rules ("legacy engine"), then ran the audit's §G sequence against it.

**It largely passed.** 18 of 19 steps, and the single failure was an artifact of my port,
not a reproduction of your bugs.

Per your instruction — and my own — I stopped rather than proceeding to change production
behavior on a diagnosis the evidence does not support.

---

## What the probes actually proved

I then tested each mechanism claim from audit §B in isolation.

| # | Audit claim | Verdict | Evidence |
|---|---|---|---|
| 1 | Zone-scope mislabel lets "zone exhausted" read as "category complete" → premature stage advance (**my Failure 4 mechanism**) | **REFUTED** | Searched 400 randomized resolution states over a 36-cell category: an active zone that is entirely resolved while `rest` still holds unresolved work is **structurally unreachable**. The 12-cell chunk retirement in `activeQueuePartition` guarantees every open chunk contains at least one unresolved cell, so the active 24 always contains unresolved work. The mislabel is real as *naming*, but it cannot fire. |
| 2 | Category-order arrival diverges from zone/display-order arrival | **REFUTED** | Constructed the retirement-rotation case (13 of 30 resolved). Both orders return `candidate:c14`. Chunk retirement moves whole chunks, so the first unresolved unit is the same under either traversal. |
| 3 | Raw `candidateDecisions[id]` diverges from the proposal-aware predicate | **CONFIRMED** | After a proposal is *dismissed* ("Unrelated"), `stageCategories` (app.ts:8264) counts it as remaining; `isReviewDisplayTargetResolved` (app.ts:3341) counts it resolved. Pill reads **2**, truth is **1**. |
| 4 | `selectStageCategoryCursor` can land on a **resolved** unit while unresolved work remains | **CONFIRMED** | app.ts:12345 is `candidateIds.find(id => !decisions[id]) ?? candidateIds[0]`. In a category whose candidates are *all* resolved but whose **proposals are not**, the `??` fallback fires and arrival lands on `candidateIds[0]` — a settled candidate — while `cp1` sits unresolved. The proposal branch below is unreachable because it is gated on the candidate list being empty. |

**Claim 4 is very likely your Failure 3** ("a category opened on its LAST item rather than
its first unresolved item"). The rule lands on a *settled* candidate rather than the first
unresolved unit; which cell that appears to be on screen depends on the rendered order.

---

## Where I was wrong, specifically

Two errors, and they compound.

**1. I attributed Failure 4 to a mechanism that cannot fire.** I read
`snapshotCurrentScopeCompletionAnchor` storing a Zone in a field named `sectionTargetKeys`,
saw the mislabel, and inferred the consequence without checking whether the state was
reachable. It is not — `activeQueuePartition`'s chunk retirement defends against it. That
was reasoning from a naming smell to a behavioral claim. I flagged it as unproven in the
audit, which was right, but I still built the implementation sequence on top of it.

**2. The deeper error: my acceptance test could not have proven the diagnosis either way.**
The confirmed structural findings — 29 write sites on `structuralCardFocusPending`, DOM as a
source of category truth, render mutating navigation state, the 700 ms timer — are all
defects of **stateful, asynchronous, DOM-coupled coordination**. A pure-model test cannot
express any of them. I proposed a test at the wrong level: right *scope* (category
traversal), wrong *layer*.

So step 1 as I sequenced it was not satisfiable. Extracting a pure `reviewPosition.ts`
would have been real work that made the code better and **would not have fixed Failures 1, 2,
or 4** — you would have run a clean document and hit them again, which is precisely the
cycle you asked me to break.

---

## What still stands

Everything in audit §A and §C was directly verified, not inferred, and none of it is
affected:

- `src/ui/app.ts` — 15,147 lines, **0 exports**. Confirmed.
- `verify/ui-smoke.ts` — 194 checks, **346 assertions matching `app.ts` read as text**.
  Confirmed. The Failure 1 coverage is `appSource.includes("completing proposal 2 of 4 advances to")`.
- `npm test` → exits 1. Confirmed.
- `structuralCardFocusPending` — 29 write sites, named `Pending`, used as durable cursor. Confirmed.
- `activeStructuralProposalId()` reads `document.activeElement`, and feeds
  `currentStageCategoryId()`. Confirmed.
- Render tail (app.ts:13477) nulls the cursor based on a DOM query result. Confirmed.
- Three advance mechanisms, one on a 700 ms timer over a pre-dispatch snapshot. Confirmed.

The architecture finding holds. **My mechanism-to-symptom mapping did not.**

---

## Revised plan

The correction is to the *order*, not the destination.

**Step 0 (new, and now the real step 1): make the stateful layer observable.**
Extract app.ts's review-position coordination into a module with an injected environment —
no DOM, no timers, no module-level mutables — exposing the current position as a value.
Nothing about behavior changes; this is purely "make the thing that breaks inspectable."
Only then can an acceptance test drive the transitions that actually fail.

**Then** the pure model, the cursor collapse, and the advance unification proceed as
sequenced — but each is now verifiable rather than hoped-at.

**Available immediately and independently:** Claims 3 and 4 are confirmed, isolated, and
small. Each is a genuine defect with a clear fix and a real behavioral test, and neither
depends on the extraction:

- **Claim 4** — make category arrival select the first unresolved **unit** (either kind),
  not the first unresolved candidate with a fallback. Likely resolves Failure 3.
- **Claim 3** — route the pill/remaining counts through the proposal-aware predicate.
  Will visibly change pill numbers; they are currently wrong after any dismissal.

---

## What I need from you

Three options, and I'd rather you pick than assume:

**A. Fix Claims 3 and 4 now, defer the extraction.** Small, confirmed, independently
testable. Probably gets you further into a clean run than you got last time, without
committing to the larger consolidation. Does **not** address Failures 1, 2, or 4.

**B. Do the extraction first (step 0), then re-diagnose Failures 1/2/4 with real
observability.** Slower to first visible improvement, but it is the only path that stops
you being the regression suite. My recommendation, with A folded in along the way.

**C. Instrument instead.** Before any refactor, add temporary position-transition logging
to the real app so your next manual run *captures* the actual state at the moment of
failure. Cheapest way to convert Failures 1/2/4 from hypotheses into facts — and it uses a
run you were going to do anyway.

Honestly: **C then B** is what I'd choose. My mechanism guesses were wrong twice today
because I was reasoning about a stateful system from static reading. One instrumented run
would replace all of that guessing with data, and it costs you one document.

I did not proceed past step 1, and I'd rather ask than pick for you.
