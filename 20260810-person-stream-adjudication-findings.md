# Person-Stream Adjudication — Findings

**Date:** 2026-08-10
**Result: one rule shipped (inert), five rejected. No behavioural change. 83/83 suites green.**

The finding that made this pass work is not statistical. It is that **Person signals are not all claims about the same thing** — some are claims about the candidate span, some about a token inside it — and that the code proves which is which.

---

## 1. The distinction that does the work

`scoring.ts` sets `known_personal_name_token` like this:

```ts
let hasKnownGivenNameToken = false;
for (const t of tokenSet) {
  if (KNOWN_GIVEN_NAMES_SET.has(t)) { hasKnownGivenNameToken = true; break; }
}
```

**It breaks on the first match.** The category means "*some* token is a known given name" — a claim about a token, not about the span. That is why `If Joan` routes to **People**: the claim is true, and it is not a claim about `If Joan`.

Applying the same reading to the producing code of every Person signal:

| Signal | Scope | Why (from the producing code) | Units | Person rate |
|---|---|---|---|---|
| `person/census-token-membership` | **component** | fires when every token appears *somewhere* in name data | 85 | 39% |
| `person/census-name-structure` | **candidate-span** | tests first *and* last token for agreeing first/surname roles | 43 | **40%** |
| `person/name-lexicon` | **component** | `known_personal_name_token`, first-match-break (above) | 39 | **81%** |
| `person/variant-form-*` | component | resemblance between one *token* and an attested form | 1 | — |
| `person/anchor:*` | candidate-span | requires `FULL_NAME_SHAPE_RE` of the candidate itself | 0 here, **active in production** |
| `person/nearby-title` | neighbourhood | honorific *adjacent* to the span | 0 here, active in production |
| `person/contextual-usage:*` | neighbourhood | grammatical role of the span; fired on `Academic Senate`, `San Diego` | 0 here, active in production |
| `person/entity-linkage` | inherited | from a partner candidate | 0 here |

### ⚠️ The result that kills the obvious rule

**Candidate-span evidence has a 40% person rate — no better than component evidence.** `census-name-structure` fires happily on `Cal State`, `Last Day`, `Happy Birthday Eve`. So "require evidence about the span" is *not* a sufficient condition, and the rule built on it (P-1) fails accordingly.

What *is* true: **component-level evidence *alone* is much worse.**

| Evidence scope of the Person reading | Units | People | Non-people | Boundary |
|---|---|---|---|---|
| candidate-span + component | 40 | 17 | 23 | 0 |
| candidate-span only | 30 | 16 | 13 | 1 |
| **component only** | **27** | **4** | **21** | **2** |

---

## 2. Population measured — and what it is not

**182 candidates: 43 named production witnesses + the 139-unit residue. 97 carry a Person reading.**

> ⚠️ **Two production channels could not be reproduced.** `occurrence-context` and `document-consistency` fire on **0 units** here and are **active in production**. Every measurement below is bounded to candidate-intrinsic evidence.
>
> This also means **the counts here cannot be extrapolated to your 601/273**. Different population, different evidence environment. What transfers is the *semantics* of each signal, which is a property of the code.

---

## 3. Rules measured — the asymmetric tradeoff, not an accuracy score

| Rule | Removed | **REAL PEOPLE LOST** | Non-people removed | Verdict |
|---|---|---|---|---|
| **P-1** span evidence required | 27 | **4** — Perias Nelly, Chriztopher Johnson, Fox Liud | 21 | **REJECTED** |
| **P-2** token-membership alone (any length) | 30 | **2** — Chelsey, Agnes | 28 | **REJECTED** |
| **P-3** ordinary-language demotes | 23 | **10** — Andrew, Margaret, Patrick, Joan, Julie, Diana, Sarah, Christopher, Will Diana, Agnes | 12 | **REJECTED** |
| **P-4** place demotes | 4 | 0 | 4 | **REJECTED** — see below |
| **P-5** single-witness component | 26 | **4** | 20 | **REJECTED** |
| **P-6** multi-token, membership only | **17** | **0** | **17** | **SHIPPED** |

**P-3 deserves emphasis.** Your instruction said ordinary-language overlap must not demote Person. The measurement says exactly how much that caution is worth: **10 real people**, including `Andrew` and `Joan`. Ordinary-language overlap is lexical, not semantic.

**P-4 is the interesting rejection.** It loses zero people and reclassifies all four cleanly (`San Diego`, `East Bay`, `San Marcos` → place). **I rejected it anyway**, because it is "Place beats Person" — a semantic priority table. The reference audit measured **35,174 GNIS keys carrying Census personal-name structure**; the rule is categorically wrong at that scale even though it looks perfect on four witnesses. `San Diego` carries candidate-span structure *and* place attestation, so both readings are independently justified and both should survive. That is different from Place winning.

**P-2's losses are a coverage gap, not a semantic error.** `Chelsey` and `Agnes` are real first names that DocScrub's `KNOWN_GIVEN_NAMES` does not contain. The codebase's own stated remedy applies: *"more positive-evidence capability, not a softer contract."*

---

## 4. The shipped rule

**`person-adjudication/multi-token-membership-only`**

> For a multi-token candidate, a Person reading whose *only* signal is Census token membership is not affirmative Person evidence about the candidate.

**17 removed, 0 real people lost.** Population: `New Student`, `Last Date`, `Start Date`, `End Date`, `Class Level`, `Staff Course`, `Grade Pro`, `Grad App`, `First Fight`, `Stern Mass`, `Records Team`, `Staff Run Query`, …

Three reasons it survived where the others did not:

1. **The semantic argument stands alone.** Token membership is a claim about tokens; on a multi-token candidate it has said nothing about the span. This is not curve-fitting.
2. **It never reaches real people.** Every multi-token person in the population also carries candidate-span structure *or* a name-lexicon match. The rule requires *every* signal to be token membership.
3. **It is monotone-safe against the evidence I could not measure.** Because it requires `every` signal to be token membership, *any* additional signal — including the context and document-consistency channels absent here — makes it **stop** firing. Missing evidence can only cause it to over-fire in measurement, never in production. That is the property that made it shippable despite the harness gap.

### Reclassification: what the system already knows

| Disposition | Count | Examples |
|---|---|---|
| exactly one alternative → **reclassify** | 2 | `Records Team` → organization, `Staff Run Query` → ordinary-language |
| multiple alternatives → contested | 0 | — |
| no alternative → **Undetermined** | 15 | `New Student`, `Class Level`, `Last Date`, `Grade Pro` |

**"Not Person" implies nothing about what a candidate is.** Reclassification is proposed only when exactly one alternative is already affirmatively supported; everything else goes to Undetermined. Mostly the system does *not* already know — 15 of 17.

---

## 5. Boundary defects — a different problem, reported separately

| Candidate | Section | Person signal | Scope |
|---|---|---|---|
| `If Joan` | **people** | `person/name-lexicon` | component |
| `Regarding Summer` | dates-terms | `person/name-lexicon` | component |
| `Records, Thanks Andrew` | **organizations** | `person/census-name-structure` | candidate-span |
| `When Ruth` | undetermined | (none) | — |
| `Did Dr` | undetermined | (none) | — |
| `Thanks Andrew` | undetermined | (none) | — |

These have a **wrong span, not wrong semantics.** The evidence about the name token inside them is correct. `If Joan` reaching People is an extraction defect wearing a semantic costume, and P-6 does *not* remove it — deliberately. A Person rule that swallowed these would be masking the real defect.

**Recommendation: fix the extraction boundary separately.** Three of the six already land in Undetermined, so the exposure is narrower than it looks.

---

## 6. Behavioural changes

**None.**

| Surface | Change |
|---|---|
| Person interpretations in production | **0** — nothing consumes the adjudication |
| Type Check routing | **0** |
| Recommendations / protection gates / grouping / automatic resolution / audit | **0** |

`person-adjudication.ts` has **zero importers**, asserted. It is not wired to the console diagnostic either, because `src/ui/app.ts` is under concurrent edit (+3,525 lines from the auth/preview workstream) and this pass did not touch it.

> **The review-burden benefit is therefore NOT delivered by this pass.** Delivering it requires routing to consume the interpretation profile — a product decision I did not take unilaterally.

**Concurrency:** `git status` shows live edits across `semanticTypes.ts`, `scoring.ts`, `contextual-person-evidence/*`, `patterns.ts`, `review/session.ts`, `previewGate.ts`, `recommendations.ts`, `triageQueue.ts`, `Workspace.ts` and new `src/account/*`. **I modified none of them.** My two production files are new; my two verify edits are to suites I wrote.

---

## 7. Performance

**0.334 µs per candidate; 0.20 ms for a 601-candidate document.** Reads already-derived evidence only; touches no reference dataset.

---

## 8. Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` / production build | **PASS** |
| Full battery (85 files; 83 runnable suites) | **83 / 83 PASS** |
| `person-adjudication-verification.ts` (new, 8 sections) | **PASS** |

Properties pinned: weak evidence cannot become affirmative Person evidence; a token-level claim cannot classify the whole candidate; single-token candidates cannot be reached (this is what protects `Chelsey`/`Agnes`); the measured people population survives; Person/Place ambiguity survives with no priority table; ordinary-language overlap does not demote; reclassification requires exactly one affirmative alternative; absence of a Person reading stays distinguishable from rejection; no confidence/weight/score/priority vocabulary exists in the module; exactly one rule id exists; nothing imports it; routing unchanged.

One existing assertion updated (importer list) because a new module reads the model — **not weakened**, extended with the reason inline. That assertion is how the new consumer got noticed.

**Green tests are not evidence the semantic policy is right.** The evidence is §3: 17 false Person readings removed, zero real people lost, and five alternative rules rejected with the exact people each would have cost.

---

## 9. Unresolved questions

1. **The two missing channels.** `occurrence-context` and `document-consistency` are active in production and invisible here. P-6 is safe against them by construction; **no other rule can be evaluated without them.** Re-running the Person harness against a real browser diagnostic export is the highest-value next measurement.
2. **Does P-6 fire on your 601-candidate document, and on what?** My 17 come from a 182-candidate proxy. The list should be checked against the real population before anything consumes it.
3. **Should the adjudication ever affect routing?** That is the whole review-burden question and it is yours. The measured basis now exists.
4. **`Chelsey` / `Agnes` are lexicon coverage gaps.** Widening `KNOWN_GIVEN_NAMES` would give them candidate-level evidence and is orthogonal to adjudication.
5. **The affirmative/protective split you hypothesised** — I did not need it. P-6 removes an *affirmative* reading that was never protective in the first place (the protection gate reads Census *structure*, never token membership, and is untouched). If routing ever consumes adjudication, the split becomes necessary; today it would be machinery with nothing to protect.

---

## 10. Files

| File | Change |
|---|---|
| `app/src/engines/interpretation/person-adjudication.ts` | **new** — scope taxonomy, one rule, disposition; inert |
| `app/verify/person-adjudication-verification.ts` | **new** — 8 sections, in the battery |
| `app/investigation/person-stream-adjudication.ts` | **new** — scope analysis, rule measurement, ablation, boundary analysis, witnesses |
| `app/verify/candidate-interpretation-verification.ts` | importer list extended, with reason |

---

## Success criterion

For a candidate carrying Person evidence, DocScrub can now answer **"do we actually have enough evidence to say this plausibly represents a person?"** with a named rule and a recorded reason — and when the answer is no, it reports what it already affirmatively knows (2 of 17) or honestly says Undetermined (15 of 17).

Real people remain protected. Genuine ambiguity remains ambiguity. The global interpretation model is untouched. What is *not* yet delivered is the reduction in review burden — that needs a routing decision.
