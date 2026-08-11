# Residual Population — Upstream Evidence Audit

**Date:** 2026-08-09
**Status:** analysis only. **No production behaviour changed.** The residual gate is untouched and still unshipped.
**Scope:** the 466 retained units from the live run (600 candidates, 134 automatically resolved).

What changed on disk: `__docscrub.profile()` was rewritten (diagnostics), and one reproduction suite was added (`verify/full-name-token-witness-verification.ts`). 63/63 suites, `tsc` and build clean.

---

## 0. First, a correction to my own last claim

**The `nearby_title` fix released zero units, and could never have released any.**

The gate's name test is:

```ts
hasKnownNameEvidence:
  categories.some((c) => NAME_EVIDENCE_CATEGORIES.includes(c)) ||
  documentNameEvidenceFor(candidate, nameEvidenceInputs, fullNameTokens).has
```

`nearby_title` is a **`positiveReason`**. No gate input reads `positiveReasons`. So deviation #6 was structurally incapable of changing a gate outcome, and the live numbers confirm it exactly: **134 resolved / 466 retained before the fix, 134 / 466 after**, with the name-held population at 76 in both runs.

Two things follow, and they point in opposite directions:

- The fix is still **correct**. `[Andrew] met with Dr. Garcia` really was attributing Garcia's honorific to Andrew, and `ui/recommendations.ts` *does* read `positiveReasons` — so the recommendation layer was being fed a false claim. As a precision fix it stands.
- The fix was **not** a workload fix, and I presented it as a candidate for one. The old profiler even carried a "narrow `nearby_title`" row in its would-release table — a number that was pinned at zero by construction. I could have checked which inputs the gate reads before predicting; I didn't.

This is the sixth time this session evidence has corrected me, and the pattern is consistent: the logic has held up, the **scoping and adapter judgments** have not. I've changed the profiler accordingly — every "would release" figure below is now produced by **re-running the real `evaluateCandidate`** over modified facts, not by a heuristic that resembles it, and the profiler self-checks its reconstruction against the actual run before reporting anything.

---

## Finding 1 — document-derived name recognition

### 1.1 The structural cause

`buildFullNameTokenIndex()` accepts as a name witness any multi-token candidate whose `detectedType` is `"person"`.

**`detectedType: "person"` is a regex artifact, not evidence.**

```
FALLBACK_PERSON_RE     any run of 2–6 capitalized words
LAST_FIRST_PERSON_RE   Capitalized, Capitalized
```

Neither consults a name lexicon — which is exactly *why* the module used them (the fix would otherwise be circular). But it means every capitalized phrase in an email thread is a name witness for each of its own tokens:

| phrase | witnesses | reached the live retained set |
|---|---|---|
| `Good Morning` | `Morning`, `Good` | `Morning` ✔ |
| `Thank You` | `Thank`, `You` | `Thank` ✔ |
| `Last Call` | `Last`, `Call` | `Last` ✔ |
| `Message List` | `Message`, `List` | — |
| `Winter Grading` | `Winter`, `Grading` | — |
| `Tuesday, March` | `Tuesday`, `March` | — |

Reproduced end-to-end in `verify/full-name-token-witness-verification.ts` (27 checks), including the assertion that the detector really does type these as `person`.

### 1.2 Why the existing witness filter misses them

The institutional filter was added for a real case — `Enrollment Services Team` was witnessing `Enrollment`. It works for phrases carrying institutional categories, and the suite pins that it still does.

But it **enumerates one way of not being a name rather than requiring some way of being one.** A greeting, a calendar phrase, or a phrase carrying no category at all sails straight through:

```
Records Team        institutional=true    ["institution-term","department-organization","organization-suffix"]
Good Morning        institutional=false   ["greeting-or-courtesy"]
Tuesday, March      institutional=false   ["calendar-term","ambiguous-lexical-token","calendar-abbreviation",…]
Winter Grading      institutional=false   ["season-or-academic-term"]
```

### 1.3 The obvious fix does not work

**Discriminator 1 — "require the witness to carry a positive name-structure category."** Falsified by this suite's own control:

```
Last Call      ["moderate-frequency-bonus","strong-name-structure"]
Agnes Wu       ["moderate-frequency-bonus","strong-name-structure"]     <- identical
Message List   ["moderate-frequency-bonus","strong-name-structure"]
Preview Day    ["moderate-frequency-bonus","strong-name-structure"]
```

`Last Call` and `Agnes Wu` are **category-identical**. The quality layer has no signal that separates them, because at the lexical level there isn't one — both are two capitalized words of moderate frequency. Recorded as a failing-by-design assertion so this isn't rediscovered.

**Discriminator 2 — "exclude a witness carrying positive ordinary-language evidence."** The exact mirror of the gate's own rule 4, reusing `ORDINARY_LANGUAGE_CATEGORIES` rather than inventing a list. The argument in one line: *a phrase the pipeline already calls ordinary language cannot be the evidence that one of its tokens is a name.*

```
catches: Good Morning, Thank You, Tuesday, March
misses:  Last Call, Message List, Preview Day, Winter Grading
preserves: Agnes Wu, Cobb, Christopher       <- both genuine names
```

Partial, and the partiality is measured rather than glossed.

### 1.4 What is NOT yet established

`The` and `Grades` get **no witness** in the offline reproduction. Something else is supplying their name evidence — `ambiguity-proposal` or `entity-group-member`. The profiler now splits the 62 by actual source and prints, for every `full-name-token` retention, the phrase that witnessed it. **That measurement is pending Andrew's run**, and the release estimate for the witness narrowing depends on it.

I am not claiming `full-name-token` explains all 62. It explains the class I could reproduce.

---

## Finding 2 — contextual person evidence, rule by rule

Audited against the implementation. Three of these are demonstrated defects, two are genuinely ambiguous material that should stay, and one is a product question rather than a bug.

### 2.1 A structural defect spanning two rules: the clitic suffix

`Here's`, `That's`, `It's`, `It’s` are retained by **`contextual_possessive`**:

```ts
function possessive(parts: ContextParts): boolean {
  if (/['’]s$/.test(parts.match.trim())) return true;
  ...
}
```

`Here's` is *"here is"*. `That's` is *"that is"*. The rule cannot distinguish the possessive clitic from the contracted copula, and reads a grammatical fact that isn't there.

The same suffix defeats **Guard 1** and produces the `human_subject` cases:

| candidate | stem | stem in Guard 1's capability set? | escapes? |
|---|---|---|---|
| `We'll` | `we` | **yes** | yes — lookup is on the raw display value |
| `I’m`, `I’ll`, `I'd` | `i` | **yes** | yes |
| `That's` | `that` | **yes** | yes |
| `Here's` | `here` | **no** — absent from both lexicons | yes |
| `It's`, `It’s` | `it` | **no** — absent from both lexicons | yes |

So there are two sub-defects, and they need different fixes:

1. **Clitic suffix defeats the lookup.** Guard 1 tests `displayValue` against `pronoun_or_determiner ∪ sentence_fragment_word`; `we` is in that set, `we'll` is not. Stripping a trailing clitic before the lookup fixes `We'll`, `I’m`, `I’ll`, `I'd`, `That's` using the lexicon that already exists.
2. **Lexicon coverage gap.** `here` and `it` are in neither lexicon at any spelling. That is a dictionary question, and dictionary-widening is the move this codebase has repeatedly and correctly declined.

Also visible here: `It's` and `It’s` are **two separate candidates** differing only in apostrophe character. That is an alias observation, not a rule observation — see Finding 4.

**Classification:** correctness fix (sub-defect 1). **False-suppression risk: very low** — the guard set is pinned by `contextual-person-guards-verification.ts` to contain no name/word collision, and stripping a clitic cannot introduce one.

### 2.2 Not defects — acronyms doing human-ish things

`PERC`, `CommGen`, `ITS`, `NSC` fire `human_subject` / `direct_address` / `human_object` because the sentences genuinely treat them as actors: *"PERC will run overnight"*, *"contact ITS"*. This is precisely Andrew's own standard — `[NSC] reports the full list` **may remain genuinely ambiguous**.

These are **entity-type** questions, not grammar defects. The rule is reporting the sentence correctly. Suppressing them would be tuning to reduce a count.

**Recommendation: leave alone.** Population ≈ 6–8 of the 40.

### 2.3 Direct address to a collective — a product question, not a bug

`Team`, `Faculty` fire `contextual_direct_address` on *"Hi Team,"* / *"Thanks, Faculty"*. The rule is working: these **are** direct address. The inference `addressee ⇒ person` is what fails, and greetings address groups constantly.

The only available fix is a lexicon of collective addressees — in a file whose stated first principle is **"NO LEXICAL MATCHING, ANYWHERE."** That is an architectural decision, not a bug fix, and it belongs to Andrew rather than to this pass. Flagged, not proposed.

### 2.4 Smaller demonstrated defects

- **`Also`** (`direct_address`). *"Also, can you send…"* — a sentence adverb, a comma, and a second-person continuation satisfy the follow-on shape. Real defect; population 1 visible.
- **`Having`** (`attribution`). *"Having said that…"* — a gerund followed by an attribution verb. This is Guard 3 (participle) territory, already proposed and deliberately not landed. Population 1.
- **`Scheduling`, `Housing`** (`coordination`). `NAME_SHAPED_RE` accepts any capitalized word, so *"Scheduling and Records"* reads as a coordination of two people. Real defect — but narrowing it risks *"Alex and Susan"*, which is the rule's whole purpose. **Higher false-suppression risk than anything else in this section.** Population ≈ 2–4.

### 2.5 True positives that must survive any change

`Garcia` (attribution), `Joanne` (human_object), `Berhanu's` (possessive — genuine possession), `Provost` (a role, plausibly a person). Pinned by the existing positive controls.

---

## Finding 3 — the multi-token classifier and the 261

### 3.1 Why `Tuesday, March` was called "likely person (last-first form)"

The test was:

```ts
: /,/.test(v) ? "likely person (last-first form)"
```

**Literally "contains a comma."** Two independent false-positive layers stacked:

1. The **detector** types `Tuesday, March` as `person` (`LAST_FIRST_PERSON_RE` = `Capitalized, Capitalized`).
2. The **profiler** then classified it by punctuation while ignoring production evidence that already had the answer.

Production evidence, which the classifier never consulted:

```
Tuesday, March      ["calendar-term","ambiguous-lexical-token","calendar-abbreviation","all-common-dictionary-words"]
Cobb, Christopher   ["moderate-frequency-bonus","surname-given-structure"]
```

`surname_given_structure` is a real positive category for the last-first form. The classifier now uses it and reports comma-forms **lacking** it as their own bucket, so the `Tuesday, March` class is visible rather than absorbed.

A second bug found while reading it: the old classifier built a `nameTokenIndex` and **never used it**, so "likely person (name evidence)" was static-lexicon-only.

### 3.2 Known type ≠ known decision

Andrew's distinction is the load-bearing one here, and it changes what the 261 are worth.

Suppose the 41 institutional phrases were classified perfectly. DocScrub would then know `Academic Records` is an institution. It still would **not** know whether Andrew wants to Keep, Change, or Redact it — that is a policy about this document, and different documents answer differently.

So **class B is not an auto-resolution opportunity.** It is a **bulk-judgment** opportunity: 41 review units that could plausibly be settled by one category action. That lands on the human-judgment axis, not the review-unit axis, and it argues for making the existing category action reach them rather than for a new gate rule.

The only classes where DocScrub could claim to already know the *decision* are:

- **A. ordinary phrases** — the gate's existing rule 4, extended past the single-token bound. `Good Morning` is the same case as `Morning`, and the token-count check in rule 1 is the only thing keeping it out.
- **D. aliases** — where a decision already exists on a sibling unit. That is decision propagation, not classification.

Classes C and E remain human work by design.

### 3.3 The measurement

The reclassification into A/B/C/D/E, the full list of the genuinely-ambiguous residue, and the comma-forms-without-structure bucket are all in the rewritten `profile()`. **Pending Andrew's run.**

---

## Finding 4 — aliases and entity families

Two distinct phenomena, deliberately measured separately (the old profiler measured only the first, and only within the multi-token population):

1. **Exact duplicate families** — same normalized string, different spelling. `It's` / `It’s` is a confirmed live instance: the apostrophe character alone produces two review units for one word. These share a judgment trivially, and the evidence justifying propagation is *identity*.
2. **Containment families** — a single-token residual unit whose token appears inside a multi-token residual unit (`Andrew` ⊂ `Goodloe, Andrew`). These plausibly share a judgment, but the evidence justifying propagation is **entity resolution's**, not string matching's — and propagating on string containment alone would re-introduce exactly the error Finding 1 documents (`Morning` ⊂ `Good Morning`).

Both now measured across **all 466** residual units. **Pending Andrew's run.**

**Currently unsupported alias classes**, from reading the model: apostrophe/Unicode spelling variants, case variants, and last-first ↔ first-last of the same person are not unified into one review unit; each is an independent Item Check unit with an independent decision.

---

## Review units vs human judgments

Kept separate throughout, per instruction:

| axis | what moves it |
|---|---|
| **review units** (466) | gate rules, evidence corrections, alias unification |
| **human judgments** | Zone bulk actions, category actions, decision propagation across a family |

Finding 1 and Finding 2.1 move review units. Finding 3.2 moves human judgments **without** moving review units — 41 units, potentially one action. Those are not interchangeable and should not be summed.

---

## Ranked opportunities

| # | mechanism | live population | defect | class | units released | false-suppression risk | priority |
|---|---|---|---|---|---|---|---|
| 1 | **witness scope** — ordinary phrases witness their own tokens | ≤ 62 of the 76 | **demonstrated**, reproduced offline 8/8 | correctness | **pending live** | low-moderate (see below) | **1** |
| 2 | **clitic suffix** defeats Guard 1 + possessive/copula conflation | ≈ 7–8 of the 40 | **demonstrated** from source | correctness | pending live | **very low** | 2 |
| 3 | **multi-token ordinary phrases** — rule 1's token bound | ≈ 46 of the 261 | not a defect; a **scope** limit | product policy | pending live | moderate | 3 |
| 4 | **alias unification** (exact spelling variants) | pending | **demonstrated** (`It's`/`It’s`) | entity resolution | pending live | very low | 4 |
| 5 | **institutional bulk action** | 41 of the 261 | not a defect | product policy | **0 units**, ≈ 40 judgments | n/a | 5 |
| 6 | `direct_address` to collectives (`Team`, `Faculty`) | ≈ 2–4 | real, but the fix contradicts the file's stated principle | architectural | small | low | hold |
| 7 | `coordination` capitalization shape | ≈ 2–4 | real | precision | small | **highest in this table** | hold |
| 8 | `Also` / `Having` (sentence adverb, gerund) | 2 | real | precision | 2 | low | hold — fold into Guard 3 |
| 9 | acronyms as human subjects (`PERC`, `ITS`, `NSC`) | ≈ 6–8 | **not a defect** | — | 0 | — | **do not change** |

**Overlaps that would otherwise inflate these:** #1 and #2 are disjoint populations (name-held vs contextual-held) because the gate's retention reasons are first-match-wins — but a candidate released by #1 may still be caught by rule 3 (contextual) or rule 4 (no ordinary evidence) *below* it. The profiler therefore reports #1, #2, and **#1+#2 combined**, each by re-running the real gate, so the combined figure is not the sum.

---

## Recommended next production change

**Narrow the full-name-token witness rule: a witness must carry no positive ordinary-language evidence.**

*Why this one:*

- **Semantic correctness.** It fixes a false claim about the document — that `Good Morning` is evidence `Morning` is somebody's name — rather than tuning a threshold. It is the same class of defect as `nearby_title`, and unlike that one it sits on a path the gate actually reads.
- **It reuses the gate's own vocabulary.** `ORDINARY_LANGUAGE_CATEGORIES`, already the basis of rule 4. No new lexicon, no new list to drift.
- **The blast radius is exactly one unshipped feature.** `documentNameEvidence` is imported by `residualReviewGate` and nothing else — verified. It cannot regress `recommendations.ts`, Ambiguity Check, or anything shipped.
- **Both genuine names survive the control**, and `Enrollment` stays excluded.

*The risk, stated plainly.* This narrows evidence for **retention**, so the failure mode is auto-resolving a name that deserved review. Three things bound it: the disposition is **Keep** (the document is never altered), the static lexicon still applies, and the ambiguity/group sources are untouched. The honest residual is a name that appears in the document *only* inside an ordinary-language phrase — and `verify/name-evidence-coverage-verification.ts` already records that a document with no witness at all leaves a bare name auto-resolving.

*Runner-up, and the case for it.* If false-suppression risk is weighted above workload, **#2 (the clitic guard)** is the better first move: the defect is more certain (`Here's` is *"here is"*, full stop), the fix is smaller, the population is smaller, and the guard set it uses is already pinned against name collisions. It is the safer change and the smaller win. I'd take #1 because #2 will still be sitting there afterwards, unchanged in cost — but the argument for reversing that order is real and I'd rather state it than bury it.

*What would change this recommendation.* If the live split shows the 62 are dominated by `ambiguity-proposal` / `entity-group-member` rather than `full-name-token`, #1's release count collapses and the ordering should change. That is precisely the measurement I have not yet made.

---

## To run

Rebuild, hard-reload, load the document **fresh**, then:

```js
__docscrub.gate()
__docscrub.profile()
```

`profile()` now reports: reconstruction fidelity (`EXACT` or `DIVERGENT` — if it says DIVERGENT, everything after it is suspect and should be discarded); the 76 split by actual source; every `full-name-token` retention with the phrase that witnessed it; all 40 contextual units with their live context strings; the 261 reclassified by production evidence; alias families across all 466; and eight counterfactuals produced by re-running the real gate.
