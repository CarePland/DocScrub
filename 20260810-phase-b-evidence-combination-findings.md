# Phase B — Evidence Combination: Findings

**Date:** 2026-08-10
**Verdict: NO COMBINATION RULE IS JUSTIFIED. No behavioural change shipped.**

The measurement answers the Phase B question directly and negatively: **no evidence combination in the real population beats its parts.** One pair is measurably *worse* than its better half. The information is concentrated in a single evidence class, not in patterns.

One inert, additive production change shipped — evidence lineage — because the investigation demonstrated a specific failure that a future combiner would otherwise walk into.

---

## 1. Architecture found

Inspected before designing. The tree has generalized beyond the prompt's description.

**Concurrent work is live in this tree.** `git status` shows another workstream editing `semanticTypes.ts`, `scoring.ts`, `contextual-person-evidence/*`, `patterns.ts`, `review/session.ts`, `previewGate.ts` and a new `src/account/*` auth module. **I touched none of those.** My changes are confined to two files nobody else has open.

### Evidence classes (8, all present)

| Class | Directness | Units firing (n=139) |
|---|---|---|
| `detector-assertion` | detector-derived | 0 |
| `exact-phrase-attestation` | direct | 3 |
| `lexicon-recognition` | lexical | **31** |
| `compositional-structure` | direct, assembled from parts | **33** |
| `token-membership` | direct, weakest claim | **55** |
| `variant-form` | **relational / inherited** | 1 |
| `occurrence-context` | contextual | 0 |
| `document-consistency` | structural | 0 |

Interpretations (11): `person`, `place`, `organization`, `domain-terminology`, `identifier`, `acronym`, `date-or-term`, `document-title`, `email`, `phone`, `ordinary-language`.

State concepts: `unsupported` / `single` / `contested` (interpretation layer); `rejectedType` + `undetermined` (routing layer); `Recommendation`; `AutomaticResolution`; the person-protection gate.

### Existing combination mechanisms — there are four, and none is a scorer

1. `semanticTypeFor` — first-match-wins chain → one `SemanticTypeId`.
2. `typeCheckSectionFor` — adds `rejectedType`, still one section.
3. `personEvidenceReasons` — **the closest existing precedent**: returns *which* protections fired, not a boolean. Disqualifier-style, deliberately not weights.
4. `residualReviewGate.evaluateCandidate` — five sequential guards, first match wins.

**Nothing anywhere assigns numeric weight to evidence.** That is the precedent Phase B was asked to respect and it survives intact.

### Production consumers of interpretation results

`Workspace.ts` (stores the map) and `src/ui/app.ts` (`__docscrub.interpret()` console diagnostic). **Both inert.** No scorer, router, gate, recommendation or export reads a profile.

---

## 2. A harness bug that would have produced the wrong answer

The first run of the combination harness reported `lexicon-recognition: 0 units` on a population containing `Andrew` and `Tamara`. That is impossible, and it was: `scoreCandidateQuality` returns a **flat** `ScoredQuality`, not `{ assessment }`. I read `scored.assessment`, got `undefined`, and `qualityCategoriesOf(undefined)` dutifully returned `[]` for all 139 units.

**The defensive default is what hid it** — a function returning an empty list for a missing input turns a wiring bug into a plausible-looking measurement. Every conclusion below comes from the corrected harness, and the fix is documented at the call site.

### ⚠️ This also overturns a Phase A conclusion of mine

Phase A reported: *"24 person readings rest only on token membership; 14 are real people, 10 are not — a demotion rule would cost 14 real people."*

With real quality evidence supplied, the same 139 units give:

| | Phase A harness (reference evidence only) | Phase B harness (+ real quality evidence) |
|---|---|---|
| token-membership-only units | 24 | **9** |
| …actually people | **14** | **0** |
| …actually non-people | 10 | **9** |

Same corpus, opposite conclusion. The difference is entirely which evidence channels the harness supplied. Phase A flagged this limitation explicitly, and it turned out to matter enormously.

**Neither number is the production configuration** — production also has anchors, titles, entity linkage and cross-candidate evidence, all of which are still absent here (measured at 0 units). That instability is itself a finding, and it is the single strongest argument against shipping a rule keyed on this population.

---

## 3. Combination patterns measured

139 live-residue units, real quality categories + real reference evidence.

### Outcomes

| Outcome | Total | truth: person | truth: non-person |
|---|---|---|---|
| `single` | 54 | 22 | 32 |
| `contested` | 10 | 8 | 2 |
| `unsupported` | 72 | **0** | 72 |

### Observed patterns (top)

| Pattern | Units | People | Non-people |
|---|---|---|---|
| `(none)` | 75 | 0 | 72 |
| `person{compositional-structure, token-membership}` | 18 | 4 | 14 |
| `person{compositional-structure, lexicon-recognition, token-membership}` | 11 | 9 | 2 |
| `person{token-membership}` | 9 | **0** | **9** |
| `ordinary-language{lexicon} + person{lexicon, token-membership}` | 8 | **8** | **0** |
| `person{lexicon-recognition, token-membership}` | 7 | 6 | 1 |
| `person{lexicon-recognition}` | 5 | 2 | 3 |
| `person{compositional-structure, token-membership} + place{exact-phrase}` | 2 | 0 | 2 |
| `person{variant-form}` | 1 | 1 | 0 |
| `domain-terminology{exact-phrase}` | 1 | 0 | 1 |

Only two interpretation pairs ever compete: `ordinary-language × person` (8 units, **all 8 real people**) and `person × place` (2 units, **both non-people**).

---

## 4. ⚠️ The deciding measurement: no combination beats its parts

| Class | Units | Person rate | Alone | Person rate alone |
|---|---|---|---|---|
| `lexicon-recognition` | 31 | **81%** | 5 | 40% |
| `token-membership` | 55 | 49% | 9 | **0%** |
| `compositional-structure` | 33 | 39% | 2 | 0% |
| `variant-form` | 1 | 100% | 1 | 100% *(n=1)* |

**Pairs, with lift over the better single part:**

| Pair | Units | Pair rate | Best part | **Lift** |
|---|---|---|---|---|
| `lexicon-recognition + compositional-structure` | 11 | 82% | 81% | **+1 pt** |
| `lexicon-recognition + token-membership` | 26 | 88% | 81% | **+8 pts** |
| `compositional-structure + token-membership` | 31 | 42% | 49% | **−7 pts** |

Three results, and they point the same way:

1. **`lexicon + compositional` adds one point.** That is noise, not a rule.
2. **`lexicon + token` adds eight points — but the two are not independent.** A DocScrub name-lexicon token is almost always also Census-attested, so this is one fact arriving twice, not two witnesses agreeing.
3. **`compositional + token` has NEGATIVE lift.** Adding Census token membership to Census name structure makes the person reading *less* likely. Two signals, one corpus. This is the clearest possible demonstration that co-occurrence is not corroboration.

**The information is concentrated in one class (`lexicon-recognition`, 81% vs 39–49%), not in patterns.** Phase B went looking for compositional structure in the evidence and the data says it is not there.

---

## 5. Rules considered — all rejected

Every rule was written down *before* measurement, so none could be fitted to the population.

| Rule | Units | Person / Non-person | Verdict |
|---|---|---|---|
| **B-1** variant + exactly-attested partner | 1 | 1 / 0 | **REJECTED — n=1.** Cannot justify anything. `Chriztopher Johnson` is a witness, not a target |
| **B-2** variant alone | 0 | — | **REJECTED — never fires** on the real population |
| **B-3** Census structure + name lexicon | 11 | 9 / 2 | **REJECTED — 82% precision**, and only +1 pt over lexicon alone. Wrong on `Angeles, CA` and `Level, Early` |
| **B-4** token-membership only ⇒ too weak | 9 | 0 / 9 | **REJECTED** — clean *here*, but the Phase A harness gave 14/10 on the same corpus (§2). Acting on a measurement that flips with harness fidelity is exactly the failure mode this phase exists to avoid. Also a demotion rule, which the safe-asymmetry principle disfavours |
| **B-5** person vs ordinary-language ⇒ contested | 8 | 8 / 0 | **NOT A RULE — already the behaviour.** And note: any rule letting ordinary-language demote person would be wrong 8/8 |
| **B-6** person vs domain terminology | 0 | — | Never fires on this document |
| **B-7** person vs place ⇒ contested | 2 | 0 / 2 | **NOT A RULE — already the behaviour** |
| **B-8** multiple domain families | 0 | — | Never fires on this document |

**Rules implemented: none.**

The two "rules" that measure well (B-5, B-7) are descriptions of what the model already does. Preserving contested readings is Phase A behaviour, and both populations confirm it is right — in *opposite* directions (person×ordinary is 8/8 people; person×place is 0/2). A rule resolving either would be wrong on the other.

---

## 6. Evidence dependence — the one thing worth shipping

| Dependence | Units |
|---|---|
| Census structure + Census token membership (one derived from the other) | **31** |
| GNIS place + any person signal (GNIS consults Census for Policy B) | 2 |
| variant-form + Census (variant target *is* a Census form) | 0 (on this document) |

**Signal count vs independent witness count, person reading:**

| Shape | Units |
|---|---|
| 1 signal → 1 witness | 17 |
| **2 signals → 1 witness** | **20** |
| 2 signals → 2 witnesses | 15 |
| **3 signals → 2 witnesses** | **11** |

**31 of 63 units with a person reading — exactly half — have a signal count that overstates what is independently known.** A combiner counting signals would inflate confidence on half the population.

### What shipped

`InterpretationSignal.lineage` — **required**, declaring which bodies of fact a signal rests on, plus `sharesLineage()` and `independentWitnessGroups()`.

Required rather than optional deliberately: the signal that silently omits its lineage is precisely the one a future combiner would miscount.

This is not a weight, not a discount factor, not an input to any score. **Nothing reads it.** It exists so the measured −7pt finding is available as a compiler-checked predicate rather than as a paragraph in a document that gets lost.

Per the mid-flight instruction: this is internal machinery for testability and audit. It is not customer-facing, no reviewer-facing presentation was designed, and no confidence value was manufactured.

---

## 7. Negative evidence: none exists, and none was manufactured

Every one of the 8 distinct (interpretation, signal) pairs emitted across the population is **affirmative support** for the reading it attaches to. No signal argues against any interpretation.

The nearest thing to contradiction is `ordinary-language`, and it is affirmative support for a *different* reading — it does not deny the person reading. That is why the model needs no negative channel: competing readings are represented as competing readings.

**No negative evidence was manufactured from missing membership.** Not in Census ≠ not a person; the 72 `unsupported` units are silence, not findings.

---

## 8. Witness determination paths (before = after; nothing changed)

```
"Chriztopher Johnson"   truth=person   outcome=single   TypeCheck=undetermined
  quality: single_occurrence, strong_name_structure
  person
    + [variant-form] person/variant-form-with-attested-partner
      <- orthographic-near-form (us-census-2020, similarity 0.952)
      lineage: [us-census-name-corpus]
  rules applying: B-1 (rejected, n=1)

"Chriztopher"           truth=?        outcome=single   TypeCheck=undetermined
  person + [variant-form] person/variant-form   lineage: [us-census-name-corpus]

"Christopher"           truth=person   outcome=CONTESTED   TypeCheck=people
  person            + [lexicon-recognition] person/name-lexicon
                    + [token-membership]    person/census-token-membership
  ordinary-language + [lexicon-recognition] ordinary-language/quality-category
  -> 2 person signals, 2 independent witnesses (lexicon + Census)

"Johnson"               truth=?        outcome=CONTESTED   TypeCheck=undetermined
  person            + [token-membership] census    ordinary-language + [lexicon]

"Cache"                 truth=?        outcome=CONTESTED   TypeCheck=undetermined
  person            + [token-membership] census    ordinary-language + [lexicon]

"Cashay"                truth=?        outcome=single      TypeCheck=undetermined
  person            + [token-membership] census
```

`Cache` and `Cashay` behave exactly as the variant-form pass predicted: both exactly Census-attested, no variant relationship between them, and `Cache` correctly contested against ordinary-language.

### Representative real candidates

| Category | Example | Result |
|---|---|---|
| Census + ordinary-language | `Andrew`, `Margaret`, `Patrick` | contested — **8/8 real people** |
| Census + GNIS | `San Diego`, `San Marcos` | contested — **0/2 people** |
| Census + domain terminology | *none on this document* | — |
| Multiple terminology families | *none on this document* | — |
| Clean exact domain terminology | `Financial Aid` | `domain-terminology` only |
| Clean exact person evidence | `Goodloe, Andrew`, `Perias, Nelly` | `person`, routes to People |
| Unsupported | `Grade Rosters`, `Academic Senate` | no reading; 72 units, 0 people |
| Extraction boundary | `VA, VET`, `If Joan`, `When Ruth` | see below |

### ⚠️ A pre-existing defect found while measuring (not caused by this work)

```
"If Joan"   truth=non-person   TypeCheck=PEOPLE
  person + [lexicon-recognition] person/name-lexicon
```

An extraction-boundary fragment routes to **People** because `Joan` hits the name lexicon. This predates every pass in this series, is not fixable by evidence combination — it is a boundary/extraction problem — and is reported rather than worked around. `VA, VET` has the same shape but lands in Undetermined.

---

## 9. Behavioural changes

**None.**

| Surface | Change |
|---|---|
| Semantic conclusions | **0** |
| Type Check routing | **0** — 139 residue units: 23 People, 116 Undetermined, unchanged |
| Recommendations | **0** |
| Entity grouping / merging | **0** |
| Protection gates | **0** |
| Audit / export | **0** |
| Automatic resolution | **0** |

Production files changed: **two**, both in `src/engines/interpretation/`, both with exactly two importers (Workspace storage, console diagnostic). `semanticTypes.ts`, `scoring.ts`, `recommendations.ts`, the gates and the exporter were not touched — including by the concurrent workstream's edits, which I left alone.

---

## 10. Performance

| Measure | Value |
|---|---|
| Combination analysis (`independentWitnessGroups` over a full profile) | **0.187 µs / candidate** |
| 569-candidate document | **0.11 ms** |
| 2,000-candidate document | 0.37 ms |

Operates purely on already-derived evidence — **touches no reference dataset**, which is the shape the instruction required. Negligible.

---

## 11. Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **PASS** |
| `npx tsc` production build | **PASS** |
| Full battery (84 files; 82 runnable suites) | **82 / 82 PASS** |
| Parity suites (7) | **PASS** — pins byte-level agreement with the Python oracle |
| `candidate-interpretation-verification.ts` §6b (new) | **PASS** |

New assertions: every signal declares a lineage; Census structure and Census token membership **share** lineage and collapse to one witness group; GNIS declares its Census dependence; variant-form declares the Census corpus; a DocScrub lexicon and the Census corpus are **independent** and count as two groups; lineage introduced no weight/score/discount/confidence field.

One existing assertion was updated (the exact signal field set) because a field was added. **No expectation was weakened.**

---

## 12. Unresolved questions

1. **The population is not the production configuration.** `occurrence-context` and `document-consistency` fire on **0 units** here, because the harness has no surrounding prose and no candidate population. Those are exactly the channels most likely to make a combination informative. Until `__docscrub.interpret()` is run on a real document in the browser, no combination rule involving context can be evaluated at all.
2. **Would a second document change the answer?** Every measurement is one higher-ed registrar document. `person × domain-terminology` and multi-family overlap occur **zero** times here despite being the largest collision classes in the corpus audit.
3. **Is `lexicon-recognition`'s 81% a real effect or a property of this document's names?** It is the strongest single discriminator found and it is worth confirming before anything is built on it.
4. **`If Joan` → People.** A real defect, orthogonal to this work. Worth its own pass.
5. **Should the safe-asymmetry principle be settled explicitly?** Still unfalsified and unconfirmed after two passes. It keeps deciding things by default rather than by decision.

---

## 13. Recommendation for the next phase

**Do not build a combination engine.** Two passes of measurement now point the same way: the evidence is not compositional in the way the architecture anticipated, and the one place combination looked promising turned out to be dependence.

In order:

1. **Run `__docscrub.interpret()` on a real document in the browser.** Everything above is bounded by the two channels the harness cannot supply. One document load resolves it. This has been the top recommendation for three passes.
2. **Measure a second, non-higher-ed document** before trusting any single-document distribution.
3. **Fix `If Joan`** — a boundary defect with a real routing consequence, cheaper and more valuable than any combination rule measured here.
4. **Leave the interpretation layer inert.** It is doing its job: it made a negative result measurable, and it caught my own Phase A conclusion being wrong.

If a future pass does build combination, the lineage field is the guard rail: **half the person readings in this population have more signals than independent witnesses.**

---

## 14. Files

| File | Change |
|---|---|
| `app/investigation/evidence-combination-matrix.ts` | **new** — the Phase B harness: signal inventory, pattern matrix, marginal-contribution analysis, dependence, candidate rules, witnesses, performance |
| `app/src/engines/interpretation/interpretation-model.ts` | + `EvidenceLineage`, required `lineage` on `InterpretationSignal`, `sharesLineage()`, `independentWitnessGroups()` |
| `app/src/engines/interpretation/candidate-interpretation.ts` | + lineage declared at all 23 signal emission sites |
| `app/verify/candidate-interpretation-verification.ts` | + §6b lineage contract; updated signal field-set assertion |

---

## Success criterion

DocScrub can now answer:

> *Given everything independently known about this candidate, what interpretations are supported, how are those pieces of evidence related, and does their combination justify saying anything stronger?*

For the population measured, the answer to the last clause is **no** — and DocScrub can now say that structurally, with the dependence between its own signals made explicit rather than assumed. Direct, inherited, contextual, competing and absent evidence all remain distinguishable, and `contested` remains a correct conclusion rather than a failure to conclude.
