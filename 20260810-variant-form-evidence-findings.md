# Variant-Form Evidence Layer — Findings

**Date:** 2026-08-10
**Scope:** deterministic, conservative variant-form evidence, between Phase A and Phase B
**Status: shipped inert. One method enabled of six investigated. No semantic behaviour changed.**

The headline is a rejection: **every phonetic method was measured and rejected.** Double Metaphone finds `CHRIZTOPHER ~ CHRISTOPHER` correctly — and 460 other Census names alongside it. It is not wrong; it is uninformative, which for a privacy product is worse.

What shipped is one orthographic method against Census only, with two exclusion rules that the measurements forced, and the motivating case works.

---

## 1. Existing machinery found

The instruction said not to build a parallel fuzzy subsystem if suitable primitives exist. They did, and one of them turned out to be the right answer.

| Found | What it is | Used? |
|---|---|---|
| **`sequenceRatio()`** (`engines/entity-resolution/sequence-ratio.ts`) | Faithful port of Python `difflib.SequenceMatcher.ratio()` — Ratcliff/Obershelp. Written for byte-exact parity with the Python oracle. | **Yes — this is the shipped comparison** |
| **`DecisionReuseEngine` Tier 3** | Already does conservative fuzzy matching at **threshold 0.90, margin 0.05**, with a documented "fail closed" rationale: *"misapplying a decision to the wrong real-world entity is materially worse than an unhelpful suggestion"* | **Yes — threshold adopted, not reinvented** |
| `RelatedNameProvider` / `full-value-aliases` | Curated nickname + alias libraries with strengths | Not needed — different question (known aliases, not near-forms) |
| `personGroupKey()` = `person:{last}:{firstInitial}` | Existing document-local name grouping | Informed the document-local design |
| `identity-cleanup.classifyIdentityToken` | `name` / `ordinary` / `unknown` per token | Not needed |
| `normalizeForCensusLookup` | NFD + accent-fold + uppercase | **Yes — the matching key, unchanged** |

**No phonetic or edit-distance code existed anywhere.** Nine modules carry an explicit `DELIBERATELY NOT DONE: fuzzy matching, edit distance, phonetic matching` note. This work is the first deliberate exception, and it is scoped to one module that decides nothing.

Adopting `sequenceRatio` rather than adding Levenshtein was the instruction's preference and turned out to be technically better — see §2.

---

## 2. Algorithms investigated

`investigation/variant-form-algorithms.ts`. Negative corpus: the **51,666 ordinary English words** the quality engine already recognises, none of which is a person. Positive witnesses from the real Census corpus (195,310 tokens).

**The deciding question:** what share of ordinary words acquire a "name variant"? A method near 100% carries no information at all.

| Method | False rate | Mean matches | Verdict |
|---|---|---|---|
| Soundex, len≥3 | **99.3%** | — | **Rejected.** Mean bucket 37 names, largest 777 |
| Double Metaphone, len≥6 | **93.3%** | **58.2** | **Rejected.** Finds `CHRIZTOPHER~CHRISTOPHER` — and 460 others |
| NYSIIS, len≥6 | 27.5% | 21.5 | **Rejected.** Best phonetic option; 21 candidate forms is not a relationship |
| DM + seqRatio ≥ 0.80 | 28.2% | 2.8 | **Rejected.** Worse than orthographic alone, adds nothing |
| Damerau-Levenshtein ≤1, any length | 35.8% (**100%** at len 3–4) | — | **Rejected.** A flat edit budget is indefensible |
| seqRatio ≥ 0.90, len≥6 | 15.4% | 1.9 | Rejected |
| seqRatio ≥ 0.92, len≥6 | 10.8% | 1.5 | Rejected — **loses the motivating case** (0.909 < 0.92) |
| **seqRatio ≥ 0.90, len≥8** | **4.0%** | **1.1** | **ADOPTED** |

### Why sequence ratio beats edit distance

Ratcliff/Obershelp is `2M/(m+n)` — **length-normalized by construction**. One character of difference scores 0.909 in an 11-character token and ~0.75 in a 4-character token. Measured consequence: at length 3–4 the ratio has a **0%** false rate where `damerau ≤ 1` has **100%**. A raw edit-distance threshold has to bolt length-awareness on afterwards and gets it wrong.

The length floor of 8 sits on top of that because the 5–7 band still admits 40% of ordinary words.

### The compositional gate

Requiring an exactly-attested partner token, measured against 23 boundary fragments and domain phrases:

| Configuration | Negatives admitted |
|---|---|
| seqRatio ≥ 0.90, len≥6 | 4 of 23 |
| Double Metaphone, len≥6 | 8 of 23 |
| **seqRatio ≥ 0.90, len≥8** | **0 of 23** |

### Self-validation, and one thing I could not verify

Every algorithm was spot-checked against published reference values **before** measurement, because a buggy implementation misleads in either direction. Two Double Metaphone checks failed on the first run and found real bugs (the `-THOM-` exception; Greek initial `CHR-` → K). Both fixed.

One published vector (`Thompson → TMSN`) I could not confirm offline; my implementation yields `TMPS`. **I dropped the check rather than adjust the expectation to match my output** — silently rewriting an expectation to match behaviour is the one thing a spot check must never do. It does not affect the conclusion: no single consonant rule moves a 93% false rate.

---

## 3. Final evidence model

`src/engines/interpretation/variant-form-evidence.ts`

```ts
VariantRelationship {
  observedForm        // verbatim, with its own casing. NEVER rewritten
  observedNormalized  // matching artifact only, never display text
  matchedForm         // NOT a replacement, NOT a correction, NOT a suggestion
  method              // "orthographic-near-form" | "document-local-variant"
  similarity          // Ratcliff/Obershelp. A MEASUREMENT, never a confidence
  source              // "us-census-2020/docscrub-aggregate" | "document-local"
  matchedFirstAttested, matchedSurnameAttested   // role of the MATCHED form
  tokenIndex, tokenCount                          // structural position
}
```

### Signal class: `variant-form` — new, and deliberately not `token-membership`

| | Claim |
|---|---|
| `token-membership` | "this exact string appears in a list" |
| `variant-form` | "this string does **not** appear in the list but resembles something that does" |

Folding the second into the first would erase the distinction Phase A exists to preserve and make inherited evidence indistinguishable from direct evidence. It is marked `compositional: true` and carries its measured failure mode as data.

**One signal per observed token, not one per matched form.** Two matched forms for one token produce one signal — otherwise a denser reference corpus would look like stronger evidence, which is counting by the back door. Both matched forms survive on the evidence record.

The compositional case gets a **different signal id** (`person/variant-form-with-attested-partner` vs `person/variant-form`) because the measurement says they are different, so Phase B can distinguish them without this module deciding that it should.

### Never calling the observed form wrong

Asserted **structurally**, not by output: the suite scans the module's own code for `misspell`, `typo`, `correction`, `shouldBe`, `intendedForm`, `suggestion`, `didYouMean`, `autocorrect` and fails if any appears. An output check passes right up until someone adds a `suggestion` field.

Reviewer wording: *"The observed form 'Chriztopher' is closely similar to 'CHRISTOPHER'… The observed spelling is what appears in the document and is not being questioned."*

---

## 4. Reference sources enabled

| Source | Enabled | Why |
|---|---|---|
| **U.S. Census names** | **Yes** | The only source where a near-form has a clear semantic reading, and the only one that survived measurement |
| **Document-local** (Census-attested tokens elsewhere in the same document) | **Yes**, len≥5 | Runs against a few hundred tokens rather than 195,310 — accidental-match probability lower by ~3 orders of magnitude. Contributed **0 rows** on the live residue; see §9 |
| Six terminology packs | **No** | Not measured as useful, and the noise risk is exactly what the prompt warned about |
| GNIS | **No** | Phonetically and orthographically similar place names are extremely common, and GNIS already has 36,119 keys overlapping Census structure. Symmetry is not a reason |
| DocScrub lexicons | **No** | No measured case for it |

---

## 5. `Chriztopher Johnson` — determination path

```
observed        "Chriztopher Johnson"
tokens          CHRIZTOPHER (11)  JOHNSON (7)

JOHNSON         exactly attested (first=true, surname=true)
                -> no variant lookup; becomes compositional corroboration

CHRIZTOPHER     not attested. Length 11 >= 8, eligible.
                generated  ~1,200 candidates (head/tail buckets, +/-1 length)
                admitted   CHRITOPHER   similarity 0.952  (first)
                           CHRISTOPHER  similarity 0.909  (first + surname)

profile         person   [variant-form]
                  "The observed form 'Chriztopher' is closely similar to
                   'CHRITOPHER', 'CHRISTOPHER', attested as first name /
                   surname in U.S. Census name data. The observed spelling
                   stands as written. Another token (JOHNSON) is itself
                   exactly attested."
                signalId  person/variant-form-with-attested-partner
outcome         single (was: unsupported)
routing         Undetermined — UNCHANGED
```

The candidate moved from *"no affirmative evidence supports any reading"* to *"a person reading is supported, by a named relationship to a named attested form."* Its Type Check routing is byte-identical.

---

## 6. `Cashay` / `Cache` — the premise resolves differently against real data

The prompt supposed `Cashay` attested and `Cache` reachable only phonetically. **Against the shipped corpus both are exactly attested Census first names.**

```
CACHE   census role: firstAttested=true,  surnameAttested=false
CASHAY  census role: firstAttested=true,  surnameAttested=false
```

So no variant lookup runs on either — exact evidence short-circuits it. And the phonetic relationship the prompt anticipated is real but never consulted:

```
soundex(CACHE) = soundex(CASHAY) = C200          identical
DM(CACHE)      = DM(CASHAY)      = KX            identical
sequenceRatio(CACHE, CASHAY)     = 0.545         far below 0.90
```

The contested outcome the prompt wanted still happens, from stronger evidence:

```
"Cache"  (with ordinary-language quality evidence)

  person             [token-membership]     "Cache" occurs in Census name data
  ordinary-language  [lexicon-recognition]  common-english-word

  outcome: contested — neither reading suppressed
```

**Phonetic similarity did not collapse the competing interpretations, because it was never consulted.** The suite pins this directly: `Cache` acquires no relationship to `CASHAY` even when `CASHAY` is in the document-local set.

---

## 7. Safety witnesses

| Category | Result |
|---|---|
| **Short tokens** (`Jon`, `Don`, `Ron`, `Jan`, `Dan`, `May`, `Will`, `Bill`, `Term`, `Plan`) | **0 relationships.** Below both length floors. Measured context: `damerau ≤1` gives `JON` 38 neighbours, `DAN` 53, and a Double Metaphone bucket of 407 |
| **Ordinary words** | 4.0% false rate at the shipped configuration, down from 99.3% (Soundex) |
| **Boundary fragments** (`FYI, Berhanu`, `When Ruth`, `Did Dr`, `If Joan`, `Everyone, Same`, `VA, VET`) | **0 relationships.** Not rescued |
| **Domain phrases** (`Transfer Credit`, `Associate Dean`, `Academic Senate`, `Term Withdrawals`, `Systemwide Registrars`, `Degree Planner`, …) | **0 relationships** |
| **Exact names** (`Johnson`, `Yazmine Guzmán`, `Amy Miller`, `Cache`, `Cashay`) | **0 relationships** — exact evidence is never routed through fuzzy matching |
| **Multi-token composition** | Variant + exact partner gets a *different signal id* from variant alone |
| **Live residue non-people** (106 units) | **0 acquired any variant relationship** |

### ⚠️ Two false-positive classes the measurements caught

Both were found *after* the first implementation, and both would have shipped without the harnesses.

**A. Trailing affix — inflection.** The first version's four residue relationships were three inflections and one real match:

```
Graded      ~ GRADE      0.909    (GRADE is a Census surname)
Grades      ~ GRADE      0.909
Presidents  ~ PRESIDENT  0.947
```

**Compositional corroboration did not save two of them** — `HAPPY` and `DUE` are themselves Census-attested.

**B. Leading affix — truncation.** Found by the verification suite *after* A was fixed:

```
Transfer  ~ RANSFER  0.933    (RANSFER is a Census surname)
```

That is the exact shape an extraction-boundary error takes — and DocScrub already models it elsewhere as `truncated_variant`.

**Fix:** containment at *either* end is refused. If one form is a prefix or a suffix of the other, the entire difference is an affix, which is morphology or truncation — not a spelling variant. The module already forbids stemming as a semantic claim; admitting these would be that claim by another route.

Cost: a genuine variant differing only by a leading or trailing character (`Yazmin`/`Yazmine`) is refused. Conservative direction, and such forms are usually attested in their own right.

---

## 8. Population measurements

139-unit live residue, reference evidence only (no quality categories or context — those need a loaded document).

| | |
|---|---|
| Units acquiring any variant-form signal | **1 of 139** |
| …that you read as people | **1** (`Chriztopher Johnson`) |
| …that you read as non-people | **0** |
| Non-person units acquiring any relationship | **0 of 106** |

**Precision 1/1. Coverage 1.** That is the intended shape: the instruction said precision matters more than coverage, and a layer that rescues one real person while touching zero non-people is the conservative result, not a disappointing one.

**Why so few:** of 285 residue tokens, only **54 are reference-eligible** (not already exactly attested, and ≥8 characters). 191 tokens are 7 characters or shorter. The floor that makes the layer safe is also what makes it narrow.

---

## 9. Ablation

| Configuration | Units with variant evidence | truth: person | truth: non-person |
|---|---|---|---|
| exact evidence only | 0 | 0 | 0 |
| **+ reference orthographic variants** | **1** | **1** | **0** |
| + document-local variants (shipped) | 1 | 1 | 0 |

**Document-local variant matching contributed zero rows** on this document. It is retained, but that is a judgment call worth stating plainly:

- **For:** it costs nothing measurable, it is a distinct and inspectable method, and the residue is a poor test — it contains no case where a document spells the same person two ways, which is the population the mechanism exists for.
- **Against:** by the standard applied to phonetics, a mechanism with zero measured contribution has not earned its place.

**If you want it removed, say so and it goes.** I kept it because its failure mode differs from the reference method's and the measurement is uninformative rather than negative — but I am not going to claim it is justified by evidence, because it is not.

---

## 10. Performance

Decomposed, because a single per-candidate figure is misleading here.

| Cost | Value |
|---|---|
| Lazy index build (one-time, first lookup) | **~30–88 ms** — comparable to the Census index's own 48 ms |
| Per **distinct reference-eligible** token, cold | **~110 µs** |
| Per candidate, steady state (memo warm) | **7–10 µs** |
| Live-residue first pass (139 units, 54 eligible tokens) | **15 ms** |
| Estimated 569-candidate document | **~15 ms + index build** |

Three optimizations, each forced by measurement and each proved transparent:

1. **Ends-agreement filter** — at threshold 0.90 with m ≥ 8 and |m−n| ≤ 1, at most one character position can differ, so a match must agree on the first two or the last two characters. Four comparisons.
2. **Multiset bound** — matched characters can never exceed the multiset intersection. O(m+n) with one scratch array.
3. **Per-token memo** on the reference path only. **Not** on the document-local path, which depends on the caller's per-document set — a cache keyed only on the token would leak one document's attestations into another's evidence.

Index shape: keyed on **both** first-two and last-two characters (which the ends-agreement proof makes complete). Measured effect: token-weighted mean bucket **1,795 → 333**, a 5.4× reduction in comparisons per probe.

**Before optimization: 2,529 µs/candidate — 1.44 seconds for a 569-candidate document**, roughly 500× the entire eight-family reference layer. That was the first working version, and it is why the harness measures rather than assumes.

> Honest note: this remains the most expensive single evidence component, and the cold figure in the harness (426 µs/candidate) is dominated by one-time index construction and JIT warm-up amortized over only 139 units — not by algorithmic cost. The steady-state 7–10 µs is the number that generalizes.

---

## 11. Behavioural safety

**Inert.** Nothing reads a variant relationship except the interpretation profile, which nothing in production reads either.

- The module has **exactly one importer**: `candidate-interpretation.ts`.
- Ten decision modules asserted to contain no mention of variant evidence: `semanticTypes`, `scoring`, `CandidateQualityEngine`, `EntityResolutionEngine`, `DecisionReuseEngine`, `residualReviewGate`, `person-evidence-gate`, `AuditExporter`, `recommendations`, `triageQueue`.
- No `ruleId`, no `AutomaticResolution`, no entity merging (`merge|EntityGroup|confirmGroup` all absent).
- **`Chriztopher Johnson` still routes to Undetermined**, with no rejected hypothesis. Variant evidence changed the profile and changed no routing.
- Person-protection gate untouched — it still reads Census *structure*, never token membership, and no variant signal reaches it.

### One architectural invariant I broke and then fixed

The first draft read `census-names.data.js` directly, violating the "one asset, one reader" rule from last pass's audit. **The inertness suite caught it.** Rather than widen the allow-list, `CensusNameEvidence` grew a `censusAttestedTokens()` accessor — so the invariant survives, the asset is still parsed exactly once, and the 1.9 MB string is not split twice.

---

## 12. Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **PASS**, zero errors |
| `npx tsc` production build | **PASS**, zero errors |
| Full battery (84 files; 82 runnable suites) | **82 / 82 PASS, 0 FAIL** |
| New: `verify/variant-form-evidence-verification.ts` | **PASS** — 13 sections |
| Brute-force transparency check | **3,831,460 unfiltered comparisons, 0 divergences** |

All 17 required properties are pinned. Two existing suites needed allow-list updates for new importers; **neither was weakened** — both name the new consumer with the reason inline.

Three of my own test expectations were wrong and were corrected rather than the code:
- brute-force corpus filtered at length 8 when the index floor is 7, reporting legitimate matches as spurious;
- allow-list entries in the wrong sort order;
- (from the algorithm harness) a Double Metaphone vector I could not verify — dropped, not adjusted.

---

## 13. Recommendation for Phase B

**What Phase B can safely consume:**

1. **`variant-form` with `person/variant-form-with-attested-partner`** — variant token beside an exactly-attested partner in a multi-token candidate. Measured 0/23 false admissions on boundary and domain negatives, 1/1 precision on the residue. This is the strongest variant signal and the only one I would consider letting influence anything.
2. **The `similarity` measurement** — for display and audit. It may be compared against the threshold that admitted it. It must never be summed, averaged, or combined into a score.
3. **Method and source** — `orthographic-near-form` vs `document-local-variant` differ in failure mode and should be treated separately if they are treated at all.

**What Phase B must not do:**

- Treat a variant relationship as identity. `Chriztopher` is not `Christopher`.
- Let variant evidence **remove** any competing reading. It is inherited, weaker-provenance evidence; it should never outrank direct evidence for another interpretation.
- Merge entities on a variant relationship. Entity merging stays a separate consequential operation requiring its own justification.
- Re-enable phonetic matching without new measurement. The 93–99% false-candidate rates are properties of a 195,310-token corpus, not of the algorithms.

**Open questions for you:**

1. **Keep or drop document-local variant matching?** Zero measured contribution (§9). My inclination is to keep it one more document; yours may differ.
2. **Is the length-8 floor too conservative?** It excludes 191 of 285 residue tokens. Lowering to 6 raises the ordinary-word false rate from 4.0% to 15.4% — nearly 4×. I would not lower it without a case.
3. **Should terminology packs get variant lookup?** Not measured. The prompt was right to be cautious; I did not enable it and did not measure it, so this is genuinely open rather than settled.
4. **Does `Chriztopher Johnson` reaching `single`/person actually help you?** It still routes to Undetermined, and will keep doing so until Phase B decides what a variant-supported person reading is worth. The evidence now exists; whether it should change anything is your call.

---

## 14. Files

| File | Change |
|---|---|
| `app/src/engines/interpretation/variant-form-evidence.ts` | **new** — the module |
| `app/verify/variant-form-evidence-verification.ts` | **new** — 13 sections, in the battery |
| `app/investigation/variant-form-algorithms.ts` | **new** — algorithm measurement, self-validating |
| `app/investigation/variant-form-population.ts` | **new** — population effect, ablation, performance |
| `app/src/engines/interpretation/interpretation-model.ts` | + `variant-form` signal class |
| `app/src/engines/interpretation/candidate-interpretation.ts` | + variant signal derivation, + `documentAttestedTokens` fact |
| `app/src/engines/knowledge/CensusNameEvidence.ts` | + `censusAttestedTokens()` accessor (preserves one-asset-one-reader) |
| `app/src/workspace/Workspace.ts` | + document-attested token set, passed to the interpretation layer |
| `app/verify/reference-evidence-inertness-verification.ts` | allow-list updated, with reason |

---

## Success criterion

DocScrub can now say:

> *The observed form "Chriztopher" is closely similar to "CHRISTOPHER", attested as a first name and surname in U.S. Census name data. The observed spelling stands as written. Another token (JOHNSON) is itself exactly attested.*

and it cannot say *"Chriztopher is misspelled"* — not because the wording was chosen carefully, but because the module contains no field, function or sentence capable of expressing it, and a test fails if one appears.
