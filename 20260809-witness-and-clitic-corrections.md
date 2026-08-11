# A1 + B — Witness Eligibility and Clitic Normalization

**Date:** 2026-08-09
**Status:** landed. 65/65 suites, `tsc` and build clean. Awaiting live measurement.
**Predecessor:** `20260809-residual-population-evidence-audit.md`
**Classification:** both are **correctness fixes to DocScrub-only evidence layers**. Neither is an oracle deviation — see §4.

The residual gate's acceptance criteria are **unchanged**. Both changes correct the evidence feeding it; any additional resolutions are the existing conservative gate reacting to better inputs.

---

## 1. A1 — witness eligibility

**File:** `src/engines/review/documentNameEvidence.ts`, wired in `residualReviewGate.ts`.

`buildFullNameTokenIndex` accepted any multi-token candidate typed `person` as evidence that its tokens might be names. `detectedType: "person"` is a regex artifact — `FALLBACK_PERSON_RE` matches any run of 2–6 capitalized words — so `Good Morning` was testifying that `Morning` is somebody's name.

The signature changed from a single positional predicate to a `WitnessEligibility` options object with two named predicates. A witness must now carry **neither** institutional evidence (pre-existing) **nor** positive ordinary-language evidence (new), the latter reusing the gate's own `ORDINARY_LANGUAGE_CATEGORIES`.

Nothing new is introduced: the gate already decides that a candidate carrying ordinary-language evidence *is* ordinary language. This applies that same judgement one level up, to the phrase acting as a witness.

**What it deliberately does not do.** It does not retype, suppress, or resolve the phrase. `Good Morning` remains a person-typed candidate and remains reviewable in its own right — asserted in the suite. The only thing withdrawn is its authority to speak about *other* candidates. Ambiguity-proposal and entity-group evidence are untouched, also asserted.

### The fix that was tried and falsified

"Require the witness to carry a positive name-structure category" does not work. `Last Call` and `Agnes Wu` are **category-identical** — both `["moderate_frequency_bonus", "strong_name_structure"]` — because at the lexical level there is no difference between them. Recorded as an executable control so it isn't retried.

### Two honest limits

1. **Name-shaped ordinary phrases still witness.** `Last Call`, `Message List`, `Preview Day` carry no ordinary-language category. Asserted as *unfixed* rather than omitted.
2. **Calendar categories are not ordinary-language categories.** This corrects a claim in the predecessor document, which said discriminator 2 "catches the greeting and calendar witnesses." It caught `Tuesday, March` via `all_common_dictionary_words`, **not** via anything calendrical. `calendar_term`, `calendar_abbreviation` and `season_or_academic_term` are absent from `ORDINARY_LANGUAGE_CATEGORIES`, so `Happy Friday` and `Winter Grading` still witness. Found by the new suite, not predicted.

Fixing (2) means widening the gate's own acceptance vocabulary, which this pass was explicitly scoped out of.

---

## 2. B — clitic normalization

**File:** `src/engines/contextual-person-evidence/contextual-person-evidence.ts`.

Two defects, **one mechanism**.

Guard 1 looked its capability question up on the *inflected* surface, so a base that is in the lexicon did not protect the form built on it: `we` is in `sentence_fragment_word`, `we'll` is in nothing. Separately, the possessive rule read the trailing `'s` of `Here's` as possession, when it contracts *is*.

`clitcBase()` strips a final `'s|'ll|'m|'d|'re|'ve` (both apostrophe characters), and Guard 1 tests the surface **or** its base.

**No possessive-specific rule was added.** Guard 1 already suppresses every usage rule, `contextual_possessive` among them, so once `here's` normalizes to `here` the false possessive disappears through the mechanism that already exists. A parallel "is this really possession?" test was written and deleted — two authorities on one question drift.

**Genuine possessives are untouched because stripping decides nothing; the lexicon decides.** `Amy's → amy`, `Berhanu's → berhanu`, `Sonoma's → sonoma` — none is in either lexicon, none is suppressed. Asserted directly, alongside `Will's`, `May's` and `Rose's`.

Scope is anchored to the end of the surface, so `O'Brien` and `D'Angelo` are untouched.

### The one judgment call: `it` and `here`

Clitic normalization alone does not fix `It's` or `Here's` — `it` and `here` are in **neither** capability lexicon. They belong in `pronoun_or_determiner`, and they cannot be put there: `quality-dictionaries.data.ts` is **generated** from the Python oracle's config and says *do not hand-edit*. An addition would be silently reverted by the next regeneration and would make the port diverge invisibly.

So they live in a two-entry `CLAUSE_SUBJECT_FUNCTION_WORDS` constant next to the guard, with the justification recorded per word:

- **`it`** — the lexicon already carries `he`, `she`, `they`, `them`. Its absence is a gap in an enumeration, not a distinction.
- **`here`** — the lexicon already carries `there`, likewise not a pronoun or determiner but a locative/expletive adverb, present because *"There's a problem"* behaves the way the list is used for. *"Here's the roster"* is the identical construction.

**Why this is not the dictionary-widening this codebase keeps refusing.** `ui/recommendations.ts` is right that widening a *name* dictionary makes the failure rarer without changing its shape — names are an open class, so there is always a next unlisted one. **Function words are a closed class.** Completing one is finite work with an end state.

Deliberately not completed further: `us`, `me`, `him`, `her`, `my`, `your`, `our` were not observed, and adding them "for consistency" would be the same speculative move in the opposite direction.

**Flagged for AG:** the correct long-term home is Python's `config/candidate-quality`, from which these would flow into the generated file and the local constant could be deleted. That is an *oracle* change, not a port deviation, and was not made unilaterally. The suite asserts neither word is upstream yet, so if that change ever lands, the suite fails and the duplicate gets removed rather than quietly kept.

---

## 3. Tests added

| suite | checks | covers |
|---|---|---|
| `verify/witness-eligibility-verification.ts` | 30 | A1 both directions; every eligibility decision from real `scoreCandidateQuality` output, never a hand-supplied category list |
| `verify/contextual-clitic-guard-verification.ts` | 62 | B: normalization, both defects, genuine possessives, name collisions, acronym controls |
| `verify/full-name-token-witness-verification.ts` | 32 | updated: now a historical reproduction plus a closing block asserting the production configuration is fixed |

The load-bearing halves, in both new suites, are the preservation cases rather than the suppressions:

- `Amy's`, `Berhanu's`, `Sonoma's`, `Will's`, `May's`, `Rose's` keep person evidence
- `Amy` and `Rose` keep name evidence — because the *witness* (`Amy Nakamura`) carries no ordinary-language category, even though the token itself is ordinary vocabulary. That separation is the whole point of A1.
- `NSC`, `PERC`, `ITS`, `CommGen`, `OSD's` keep their evidence. **An acronym acting as a grammatical subject is not a detector defect** — it is ambiguity for a reviewer, and a version of this guard that swept them up would have looked like a bigger win and been a worse product.

---

## 4. Oracle deviation status

**Neither change is an oracle deviation.**

- `documentNameEvidence.ts` has no Python counterpart — it is the DocScrub-only fix for the entity-resolution signal `ui/recommendations.ts` asked for.
- The Contextual Person Evidence pass has no Python counterpart either. (`redactor/occurrence_groups.py` contains the string `"contextual"`, but as an occurrence-group label — unrelated.)
- `quality-dictionaries.data.ts` is **byte-identical to the oracle**; nothing was added to it.

One divergence worth recording, below the level of a deviation: DocScrub's capability guard now knows two function words the oracle's `pronoun_or_determiner` does not. This affects only a DocScrub-only feature and never the ported scoring path.

---

## 5. Interaction between A1 and B, and what the counterfactuals will not deliver

**They are not independent, and the measured 29 is an upper bound.**

The gate's retention reasons are first-match-wins, so removing evidence does not release a candidate — it moves it to the next test. A candidate freed from rule 2 may still be caught by rule 3, and one freed from rule 3 may still be caught by rule 4.

Both counterfactuals were deliberately crude, in the direction that overstates:

- **A1's counterfactual dropped the `full-name-token` source entirely (21).** The implementation drops only witnesses carrying ordinary-language evidence. `Agnes Wu` and `Last Call` both keep witnessing. **Real A1 < 21**, and I cannot narrow it further without the live witness table.
- **B's counterfactual suppressed contextual evidence for every clitic-shaped candidate (8)** — including `OSD's` and `Berhanu's`, which the implementation deliberately preserves.

**Prediction for B, made before the run: 7, not 8.** Checking the production categories of the live clitic population:

```
Here's    ["contraction","expanded-common-language-token"]                  -> resolves
That's    ["contraction","expanded-common-language-token"]                  -> resolves
It's      ["contraction","expanded-common-language-token"]                  -> resolves
It's      ["contraction","expanded-common-language-token"]                  -> resolves
We'll     ["contraction","expanded-common-language-token"]                  -> resolves
I'm       ["pronoun-or-determiner","contraction","expanded-…","all-common"] -> resolves
I'll      ["pronoun-or-determiner","contraction","expanded-…","all-common"] -> resolves
I'd       ["contraction"]                                                   -> RETAINED
OSD's     ["unknown-capitalized-token"]                                     -> untouched
Berhanu's ["unknown-capitalized-token"]                                     -> untouched
```

`I'd` carries **only** `contraction`, and `contraction` is not in `ORDINARY_LANGUAGE_CATEGORIES`. It will fall through B and be retained by rule 4 — "no positive ordinary-language evidence" — one category short.

**So: expect strictly fewer than 29.** If the live number comes in at 29 or above, something else changed and it should be investigated rather than celebrated.

**The cheapest identified follow-up, not done here:** `contraction` is a category the pipeline already computes and the gate's rule-4 vocabulary does not recognize. A contraction *is* ordinary language. Adding it would be widening the gate's acceptance criteria, which this pass was scoped out of — so it is recorded rather than taken.

---

## 6. An assumption that proved wrong

`tsconfig.json` has `"include": ["src/**/*.ts"]`. **The `verify/` directory is not type-checked.**

The A1 signature change silently broke the call site in `full-name-token-witness-verification.ts` — passing a bare function where an options object is now expected means *neither* predicate is set. `tsc --noEmit` was clean; the suite caught it at runtime only because it carries explicit assertions about the institutional filter still working.

Had those assertions been written in the other direction, the change would have **weakened a test rather than failing it**. Worth fixing separately — the verify suites are the primary behavioral evidence in this codebase and they are the part the type checker does not see.

---

## 7. To run

Rebuild, hard-reload, load the document **fresh**, then:

```js
__docscrub.gate()
__docscrub.profile()
```

The profiler and all `__docscrub` diagnostics are preserved. Its first line reports reconstruction fidelity — if it says `DIVERGENT`, discard everything after it.

Expected: **more than 134 resolved, fewer than 163.** Any other result is a finding, not a number to tune toward.
