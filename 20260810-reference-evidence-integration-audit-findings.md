# Reference Evidence Integration Audit — Findings

**Date:** 2026-08-10
**Scope:** repository-wide audit of the deterministic semantic reference-evidence system across all eight families
**Verdict:** the architecture had already converged before this pass began. Three gaps were real and are now closed. **No semantic behaviour changed.**

---

## 0. Executive summary

The prompt anticipated that a shared substrate "may already have emerged." It had — and further than expected. `DomainReferenceEvidence.ts` (the substrate), `ReferenceEvidence.ts` (the read-only aggregate fan-out), the per-candidate `Workspace.getReferenceEvidence()` collection point, and a family-generic console diagnostic (`__docscrub.channels()`) all existed and were coherent on arrival. Steps 2, 3, 4 and 5 of the instruction were therefore **audits that passed**, not work items.

Three things were genuinely missing, and all three are now delivered:

| Gap | Closed by |
|---|---|
| No harness measured all eight families **simultaneously** — each existing one measured *one arriving pack* against whatever existed when it landed | `investigation/reference-evidence-matrix.ts` |
| No measurement of the layer's actual cost — laziness and negligibility were asserted, never measured | `investigation/reference-evidence-perf.mjs` |
| Inertness was asserted per family, raggedly; nothing stated the **complete** consumer set in one place, and no test could catch a rule reading two inert facts *jointly* | `verify/reference-evidence-inertness-verification.ts` |

Three findings warrant attention before the combination layer is designed. They are in §5 and §7; the largest is that **32.9% of GNIS multi-token place names also carry Census personal-name structure**, and GNIS Policy B currently downgrades only 2.6% of that population.

---

## 1. Architecture found

### 1.1 What existed, unmodified by this pass

```
src/engines/knowledge/
├── DomainReferenceEvidence.ts     shared substrate: row model, asset wire format,
│                                  buildDomainReferenceIndex(), lookupDomainReference(),
│                                  explainDomainReferenceEvidence()
├── ReferenceEvidence.ts           the fan-out: referenceEvidenceFor(), attestingChannels(),
│                                  terminologyChannelsOf(), referenceEvidenceAuditRows()
├── CensusNameEvidence.ts          bespoke (identity — different question)
├── GnisPlaceEvidence.ts           bespoke (identity — different question)
├── HigherEdTerminologyEvidence.ts bespoke (pre-substrate)
├── MedicalEvidence.ts             bespoke (pre-substrate, concurrent arrival)
├── LegalTerminologyEvidence.ts        ┐
├── FinanceAccountingTaxEvidence.ts    │ substrate-backed
├── EmploymentHrEvidence.ts            │ (type alias + own normalizer + 3 thin wrappers)
└── GovernmentPublicAdminEvidence.ts   ┘
```

`ReferenceEvidence.ts` already erases the substrate/bespoke distinction for every consumer: `terminologyChannelsOf()` presents a uniform view over all six terminology families regardless of how each stores its rows, and `referenceEvidenceAuditRows()` already adapts both pre-substrate shapes (it derives higher-ed's missing `sourceAttested` column from `!derivedVariant`, and maps medical's `authorityLevel` onto `sourceAuthorityLevel`).

### 1.2 Architectural differences caused by concurrent development — and why each exists

Every difference found is **deliberate and documented at its site**. None was "fixed."

| Difference | Why it exists | Action |
|---|---|---|
| Five normalizers, all different (higher-ed → space; finance → punctuation preserved; legal → preserved + slash/hyphen space-stripping; census → punctuation stripped to nothing; GNIS → space + accent-fold + uppercase; medical → punctuation-preserving, unlike both its siblings) | Each **source methodology documents a different one**. `Form 10-K ≠ Form 10K` is forced by the finance data, not by taste. Unifying would silently change what a shipped family means. | Left alone. Each pack's Python generator re-derives `normalized_term` from `term` and asserts equality per row, so a TS normalizer cannot drift from its shipped keys without the generator failing loudly. |
| Terminology packs return `null` on a miss; Census and GNIS always return a record whose own field says "found nothing" | Different questions. `null` avoids an empty object being misread as a negative finding; Census/GNIS carry per-token roles and strength that have no null analogue. | Left alone; documented in `ReferenceEvidence.ts` so callers cannot conflate them. |
| Higher-ed uses `semanticHint` (singular); substrate uses `semanticHints` (plural) | Legal genuinely assigns two hints to one term (`Complaint` = DOCUMENT + COURT_PROCEDURE); higher-ed's source assigns one. | Left alone; the fan-out normalizes. |
| Government carries `jurisdiction`, a fact the shared row model has no column for | Resolved **without widening the row contract**: the value is constant across the pack, so its generator asserts that and emits one constant, carried on the family's own evidence alias. | This is the right precedent and should be followed: *a pack-specific field that does not vary is not a reason to widen a shape every other pack's shipped asset depends on.* |
| GNIS calls `censusRoleFor` internally (Policy B suppression) | Intentional intra-evidence-layer dependency. GNIS is therefore **not** independent of Census. | Documented here; it matters for §5, where "independent corroboration" is claimed. |

---

## 2. Changes made

Three files added. **No existing file was modified.** No production module was touched.

| File | Purpose | Kind |
|---|---|---|
| `app/investigation/reference-evidence-matrix.ts` | The complete N×N collision measurement across all eight families | Investigation only; not in the battery |
| `app/investigation/reference-evidence-perf.mjs` | Asset-parse / index-build / lookup / heap / shipped-bytes measurement | Investigation only; not in the battery |
| `app/verify/reference-evidence-inertness-verification.ts` | One inertness contract for all eight families, including a behavioural cross-product test | **Added to the verification battery** (82 files, 80 runnable suites) |

Because nothing in `src/` changed, behavioural equivalence is guaranteed by construction rather than by comparison — but it was verified anyway (§7).

---

## 3. Final evidence architecture

```
                    referenceEvidenceFor(phrase)          ← the only entry point a
                              │                             consumer needs to know
        ┌─────────────────────┴─────────────────────┐
        │                                           │
  IDENTITY / REFERENCE                     DOMAIN TERMINOLOGY
  (claims about the REFERENT)              (claims about the PHRASE)
        │                                           │
   ┌────┴────┐              ┌────────┬────────┬─────┴───┬─────────┬──────────┐
 census    gnis          higher-ed  legal  medical   finance   empl/HR   government
 (name    (place                    └──────┬───────┘  └────────┬─────────┘
 structure) strength)              pre-substrate       DomainReferenceEvidence
                                    own record shape    shared row model
        └──────────────────────────┬──────────────────────────┘
                                   ▼
              ReferenceEvidenceChannels   — heterogeneous, on purpose
              terminologyChannelsOf()     — uniform VIEW, not a storage collapse
              referenceEvidenceAuditRows()— flat, self-contained provenance rows
              attestingChannels()         — names only; declaration-ordered, NOT precedence
                                   ▼
                        Workspace.getReferenceEvidence()
                        one entry per candidate, computed once at load
                                   ▼
                        __docscrub.channels()   ← the ONLY consumer
```

The identity/terminology split of Step 3 is preserved. Census and GNIS are **not** forced into the terminology abstraction: a Census hit ("this phrase has personal-name structure") and a Legal hit ("this phrase is attested vocabulary") are different claims about different things, and `referenceEvidenceAuditRows()` deliberately excludes Census and GNIS rather than inventing empty provenance columns for them.

### Properties verified as holding

- **Absence is not counter-evidence.** No channel exposes a field that could be read as a negative finding; asserted in `reference-evidence-verification.ts`.
- **Collisions are preserved.** Multiple channels may be simultaneously true and all survive; nothing collapses them.
- **No provider has precedence.** No ordering, weight, score, `mostLikelyType` or tie-break exists anywhere in the layer.
- **No aggregate vote.** None was computed in this pass.

---

## 4. Family inventory

| # | Family | Kind | Rows / Terms | Runtime API | Normalization | Provenance | Suite |
|---|---|---|---|---|---|---|---|
| 1 | **Census** `us-census-2020/docscrub-aggregate` | identity / human-name | 195,310 entries | `censusNameEvidenceFor`, `censusRoleFor`, `explainCensusNameEvidence` | punctuation → nothing; single-token keys | bit-packed flags (first/surname attested, Top-1000) | `census-name-evidence-verification.ts` |
| 2 | **GNIS** `usgs-gnis/domestic-names-national` | identity / geographic-name | 109,680 entries | `gnisPlaceEvidenceFor`, `explainGnisPlaceEvidence` | punctuation → space, accent-fold, uppercase | feature-class flags + Policy B suppression reason | `gnis-place-evidence-verification.ts` |
| 3 | **Higher Education** `docscrub-higher-ed-terminology/2026-08-10` | domain terminology | 1,394 / 1,373 | `higherEdTerminologyFor`, `isAttestedHigherEdTerminology`, `explain…` | non-alphanumeric run → space | own record: source, URL, family, derivedVariant, risk, notes | `higher-ed-terminology-evidence-verification.ts` |
| 4 | **Legal** `docscrub-legal-terminology/2026-08-10` | domain terminology | 449 / 445 | `legalTerminologyEvidenceFor`, + 2 | punctuation preserved; spaces stripped around `/` and `-` | full substrate row (13 columns) | `legal-terminology-evidence-verification.ts` |
| 5 | **Medical** `docscrub-medical-terminology/2026-08-10-v1` | domain terminology | 381 / 378 | `medicalEvidenceFor`, + 2 | punctuation-preserving (unlike both siblings) | own record incl. `authorityLevel`, parents | `medical-evidence-verification.ts` |
| 6 | **Finance / Accounting / Tax** `docscrub-finance-accounting-tax-terminology/2026-08-10` | domain terminology | 710 / 651 | `financeAccountingTaxEvidenceFor`, + 2 | punctuation **preserved** (`Form 10-K`) | full substrate row; `subDomain` = FINANCE/ACCOUNTING/TAX | `finance-accounting-tax-evidence-verification.ts` |
| 7 | **Employment / HR** `docscrub-employment-hr-terminology/2026-08-10` | domain terminology | 267 / 252 | `employmentHrEvidenceFor`, + `employmentHrSourceLicensing()` | substrate-family policy | full substrate row + explicit licensing table | `employment-hr-evidence-verification.ts` |
| 8 | **Government / Public Admin** `docscrub-government-public-admin-terminology/2026-08-10` | domain terminology | 412 / 409 | `governmentPublicAdminEvidenceFor`, + `governmentSourceAuthorityFor()` | substrate-family policy | full substrate row + pack-constant `jurisdiction` | `government-public-admin-evidence-verification.ts` |

**Generators:** `generate_census_name_evidence.py`, `generate_gnis_place_evidence.py`, `generate_higher_ed_terminology.py`, `generate_medical_terminology.py`, and `generate_domain_terminology_pack.py` (shared by families 4, 6, 7, 8).

**Licensing metadata** is carried by Employment/HR and Government as explicit tables; Legal, Medical and Higher-ed carry it as prose in the asset header; Finance carries source URLs and authority levels but no separate licensing block. *This is the only inventory field that is genuinely inconsistent across packs* — see §9.

---

## 5. Collision results

Measured by `investigation/reference-evidence-matrix.ts` over **3,422 distinct display forms** (the union of all six terminology packs), each asked of all eight families. Evaluation took 213 ms.

Census is reported twice, deliberately:
- **census-structure** — `censusNameEvidenceFor`: does the *phrase* have personal-name structure? This is the shipped channel. It cannot fire on a single token, by construction.
- **census-token** — `censusRoleFor` on every token. Weaker, not a channel, but it is where the single-token collision population lives. Reporting only the first would understate the landscape by an order of magnitude; only the second would overstate what the channel claims.

### 5.1 Pairwise matrix

| | higher-ed | legal | medical | finance | empl/HR | govt | census-struct | census-token | gnis |
|---|---|---|---|---|---|---|---|---|---|
| **higher-ed** | 1377 | 3 | 1 | 15 | 3 | 7 | **39** | **74** | 0 |
| **legal** | 3 | 445 | 1 | **23** | 10 | 6 | 18 | **52** | 0 |
| **medical** | 1 | 1 | 378 | 1 | 4 | 2 | 7 | 30 | 0 |
| **finance** | 15 | 23 | 1 | 651 | 5 | 7 | 20 | **65** | 0 |
| **empl/HR** | 3 | 10 | 4 | 5 | 252 | 9 | 12 | 18 | 0 |
| **govt** | 7 | 6 | 2 | 7 | 9 | 409 | 5 | **43** | 0 |

Domain↔domain collisions are **small** (1–23). The largest is Legal↔Finance (23) — securities and dispute-resolution vocabulary genuinely overlapping, which is a correct result rather than a defect. Domain↔Census-token is an order of magnitude larger and is the dominant collision class in the system.

### 5.2 Multiplicity

| Families attesting | Phrases | % of universe |
|---|---|---|
| 1 | 3,037 | 88.7% |
| 2 | 306 | 8.9% |
| **3** | **79** | **2.3%** |
| 4+ | **0** | 0% |

**No phrase anywhere is attested by four or more families.** This is a useful sizing result for the combination layer: the conflict space is shallow. It never needs to arbitrate more than three simultaneous claims, and it does so for ~2% of vocabulary.

### 5.3 Representative multi-family witnesses (3 families)

Three distinct shapes appear, and they call for different treatment:

**(a) Terminology × terminology — genuine cross-domain vocabulary.** No person or place involved.

```
Appeal        finance + legal + employment/HR
Arbitration   finance + legal + employment/HR
Beneficiary   finance + legal + employment/HR
Claim         medical + legal + government
Assets        higher-ed + finance + legal
Equity        higher-ed + finance + legal
Depreciation  higher-ed + finance + government
```

**(b) Terminology × Census structure — the dangerous class.** A phrase that is attested vocabulary *and* parses as a personal name:

```
active judge        legal      + census-structure(surname-first)
Blood Cell Count    medical    + census-structure(surname-first)
Blue Sky Laws       legal      + census-structure(first-surname)
cash flow           finance    + census-structure(first-surname)
basic pay           empl/HR    + census-structure(surname-first)
Clock hour          higher-ed  + census-structure(surname-first)
CAGE Code           government + census-structure(ambiguous-role)
Chief Information Officer  government + census-structure
```

**(c) Acronym collisions — 35 of 200 acronym-carrying phrases collide.** `ADA` (medical + employment/HR + census-token), `FMLA` (medical + employment/HR), `ADR` (finance + legal), `ERISA` (finance + employment/HR + census-token), plus a long tail of government three-letter forms that are also Census name tokens (`SAM`, `MAC`, `ERA`, `BIA`, `NARA`, `FRA`, `COR`, `CAGE`). The acronym rows are already labelled as evidence *local to the cited source and domain*, which is exactly the right representation for this.

### 5.4 Single-token collisions

**187 of 779** single-token phrases in the universe are attested by two or more families — 24%. The population is precisely the one every pack integration rediscovered independently: `White`, `Major`, `Minor`, `Race`, `Session`, `Course`, `Degree`, `School`, `Track`, `Cost`, `Credit`, `Warning`, `Freshman`, `Role`, `Claim`, `Case`, `Appeal`. The packs' own `collision_risk` columns already flag most of them HIGH.

### 5.5 ⚠️ The largest cross-family finding: GNIS × Census

The `gnis-place` column above is **zero everywhere**, and that zero measures a *policy*, not an absence: `gnisPlaceEvidenceFor` returns `"none"` for any single-token phrase because single-token names are excluded at generation. `Salem`, `Madison`, `Lincoln` and `Washington` are all real GNIS populated places and all correctly return `"none"`. So the honest measurement runs in the other direction — take the 109,680 multi-token place names GNIS *does* ship and ask what else attests them:

| Measure | Count | Share |
|---|---|---|
| GNIS keys also attested by any terminology pack | **0** | 0% |
| GNIS keys also carrying **Census personal-name structure** | **36,119** | **32.9%** |
| …of which GNIS Policy B downgrades to `"weak"` | 945 | 2.6% of the collision |
| …of which remain `"strong"` **with** a person structure | **35,174** | **97.4% of the collision** |

Witnesses: `AARONS CREEK` (surname-first), `ABE YARBROUGH` (first-surname), `ABRAMS WAY` (surname-first), `ABERDEEN PARK` (surname-first), `ABRAHAM ACRES` (first-surname), `ABRAM CENSUS DESIGNATED PLACE` (first-surname).

**This is the single largest unresolved conflict population in the evidence system, by three orders of magnitude.** It is not a defect — a third of American place names *are* derived from surnames, and Policy B deliberately suppresses only the narrow case where both roles are Census Top-1000. The conflict survives to the interpretation boundary intact, which is what it should do. But it means any future rule of the form "GNIS strong ⇒ not a person" would be wrong for a population of 35,174, and the combination layer must be designed knowing that number rather than discovering it.

*Nothing was tuned, dropped, or thresholded on the basis of any measurement in this section.*

---

## 6. Performance

Measured by `investigation/reference-evidence-perf.mjs` (Node v22.22.3, `--expose-gc`, 50,000 iterations per family over a 33-phrase realistic mix including misses).

### 6.1 Per family

| Family | asset KiB | parse ms | index ms | heap MiB | lookup µs | 569-cand ms |
|---|---|---|---|---|---|---|
| census-name | 1,879 | 12.9 | 46.0 | 13.4 | 1.13 | 0.65 |
| gnis-place | 2,265 | 16.2 | 20.9 | 11.0 | 0.60 | 0.34 |
| higher-ed | 175 | 5.1 | 2.6 | 0.5 | 0.66 | 0.37 |
| legal | 40 | 4.0 | 1.4 | 0.2 | 0.73 | 0.41 |
| medical | 32 | 2.8 | 1.3 | 0.1 | 0.58 | 0.33 |
| finance | 56 | 6.2 | 1.3 | 0.3 | 0.57 | 0.33 |
| employment/HR | 27 | 3.0 | 0.6 | 0.1 | 0.51 | 0.29 |
| government | 43 | 3.2 | 0.8 | 0.2 | 0.63 | 0.36 |

### 6.2 The aggregate — what Workspace actually calls

| | |
|---|---|
| `referenceEvidenceFor()`, all 8 channels | **4.79 µs per candidate** |
| 569-candidate pass (the live run's count) | **2.73 ms** |
| 2,000-candidate pass | 9.59 ms |
| Cold-load totals, every family touched | 53.4 ms parse + 74.9 ms index build, 25.8 MiB resident heap |
| Shipped bytes (`dist/`, no bundler) | **4,518 KiB** — of which Census 1,879 + GNIS 2,265 = **91%** |

### 6.3 Assessment

**The per-candidate cost is negligible and no optimization is warranted.** 2.73 ms across a whole document's candidate set is below perceptibility, and the computational shape is correct: `unique candidates × providers`, computed once in `loadDocument` and stored in a Map. Navigating between review items recomputes nothing. No bitset, binary index or lazy store should be introduced for a cost that does not exist.

**Two observations that are worth recording rather than acting on:**

1. **Laziness is at index-build granularity, not asset-fetch granularity.** Every provider imports its `.data.js` at module top level, and `Workspace.ts` imports every provider at module top level. ES modules resolve eagerly, so the browser fetches and parses all **4.5 MiB** on app load whether or not any family is consulted. The documented "a document that never reaches a family never pays for it" is true of the ~75 ms of index building and false of the ~53 ms of parsing and the 4.5 MiB transfer. This is a fair trade for an offline, browser-local tool with no network dependency — but the claim in several module headers is more optimistic than the mechanism. If transfer size ever becomes a concern, dynamic `import()` of the two large identity assets is the lever, and it is the only one worth pulling: they are 91% of the bytes.

2. **Census, GNIS, higher-ed and medical are each evaluated twice per candidate** — once in their own `loadDocument` loop populating the legacy per-family maps, and again inside `referenceEvidenceFor`. The waste is roughly 0.6 ms per document. See §9; the fix is not worth its risk.

---

## 7. Behavioural safety

### 7.1 Nothing changed, and that is provable rather than asserted

No file under `src/` was created, modified or deleted in this pass. Semantic outputs are therefore identical by construction. The full battery was run before and after; the before-run passed 79/79 and the after-run passes 80/80 (the additional suite being the one added here).

The parity suites — `production-parity`, `detection-parity`, `quality-parity`, `entity-resolution-parity`, `occurrence-classification-parity`, `identifier-shape-parity` — all pass, which pins byte-level agreement with the Python oracle.

### 7.2 ⚠️ One evidence family already affects behaviour — reported, not expanded

Per Step 8's instruction to stop and report rather than silently preserve:

> **Census name evidence is behaviourally consumed today.** `Workspace.loadDocument` passes `hasCensusNameStructure` into the person-protection gate (`engines/cross-candidate/person-evidence-gate.ts`), which determines which candidates cross-candidate interpretation is permitted to touch. This is why `Yazmine Guzmán`, `Amy Miller` and `Chelsye Angelina` reach People without shape evidence.

This coupling **predates this audit**, is documented at both ends, and was not created or widened here. Its safety rests on two properties, both of which the new suite now pins:

- **Direction.** The gate takes evidence *for* personhood only. `hasCensusNameStructure` can only ever *add* a candidate to the protected set; it can never remove one. The inverse rule — "attested terminology, therefore not a person" — would suppress real people, which is the single error class the gate exists to prevent.
- **Extent.** Exactly one call site, exactly one family. No terminology or geography disqualifier has joined it.

A second, smaller coupling exists **inside** the evidence layer: `GnisPlaceEvidence` calls `censusRoleFor` for Policy B suppression. GNIS is therefore not independent of Census, and a future combination layer must not count GNIS and Census as independent corroborating channels.

### 7.3 What the new inertness suite establishes

`verify/reference-evidence-inertness-verification.ts` asserts, for all eight families in one place:

1. **Asset isolation** — each generated asset has exactly one reader, its own provider.
2. **The complete consumer set**, named literally rather than pattern-matched. The four substrate-era packs (Legal, Finance, Employment/HR, Government) reach production *only* through the fan-out — one importer each. Census, GNIS, higher-ed and medical additionally have a legacy Workspace map.
3. **The fan-out has exactly two consumers** and `getReferenceEvidence()` exactly one caller (the diagnostic).
4. **Thirteen decision modules mention no evidence family at all** — `scoring.ts`, `CandidateQualityEngine`, `DetectionEngine`, `EntityResolutionEngine`, `OccurrenceClassifier`, `residualReviewGate`, `review/session`, `cross-candidate-evidence`, `normalization`, `AuditExporter`, `recommendations`, `triageQueue`, `reviewZone`.
5. **The one coupling is pinned** to its exact extent, with an explicit assertion that no `hasHigherEd…` / `hasMedical…` / `hasGnis…` disqualifier has joined the gate.
6. **Behavioural cross-product.** All four inert facts carried on `SemanticTypeFacts` (`censusNameStructure`, `higherEdTerminologyAttested`, `medicalTerminologyAttested`, `gnisPlaceStrength`) are toggled through their **full cross product** — 2×2×2×3 — across ten candidate populations and both gate values: **480 combinations, zero deviations** in either `semanticTypeFor` or `typeCheckSectionFor`.

   *Why the cross product matters:* every per-family suite toggles its own field alone. A rule reading two inert facts **jointly** — "higher-ed AND medical implies not a person" — would pass every single-field test and fail here. That is precisely the shape a first attempt at a combination rule takes, so it is the shape worth guarding.

7. **The exported audit is untouched.** `AuditExporter` does not import the fan-out; `AuditRecord` carries no reference-evidence field. `ReferenceEvidenceAuditRow` remains a development instrument, deliberately unwired.

---

## 8. Verification

| Check | Command | Result |
|---|---|---|
| TypeScript typecheck | `npx tsc --noEmit` | **PASS**, zero errors (4.2 s) |
| Production build | `npx tsc` | **PASS**, zero errors |
| Verification battery | all `verify/*.ts` (82 files; `fixture-io.ts` and `_probe_tmp.ts` are helpers) | **80 / 80 PASS, 0 FAIL** |
| New inertness suite | `verify/reference-evidence-inertness-verification.ts` | **PASS** — all checks, 480 behavioural combinations |
| Collision harness | `investigation/reference-evidence-matrix.ts` | Ran clean; results in §5 |
| Performance harness | `investigation/reference-evidence-perf.mjs` | Ran clean; results in §6 |

No existing expectation was weakened, deleted or rewritten. No conflict between concurrent workstreams' assumptions was found requiring reconciliation.

---

## 9. Remaining architectural debt — deliberately left alone

### 9.1 Higher-ed and Medical remain off the shared substrate — **do not migrate yet**

Step 2 permits migration only if behaviour is identical, evidence contents are identical, provenance remains available, verification demonstrates equivalence, **and the migration meaningfully reduces duplicate architecture**. The first four are achievable. **The fifth is not met**, and that is the reason to stop.

The duplication is smaller than it looks: two bespoke index decoders of 24 and 32 lines against a 34-line substrate decoder — roughly 56 lines. Against that, migration requires regenerating two shipped assets into the 13-column wire format, rewriting two verified providers, and rippling through the two legacy per-family Workspace maps and the two per-family blocks in `__docscrub.referenceEvidence()`.

Crucially, **the abstraction leak is already contained**: `terminologyChannelsOf()` and `referenceEvidenceAuditRows()` present both families identically to every consumer. No caller anywhere can tell which families are substrate-backed. Migration would therefore reduce internal line count while changing shipped data and touching verified code — a poor trade for a system whose primary safety property is that nothing changed.

**Revisit when either trigger fires:** (a) higher-ed or medical needs its asset regenerated for another reason — do it then, essentially free; or (b) a third pre-substrate-shaped pack appears, making the exception the pattern.

### 9.2 Duplicate per-candidate evaluation in `Workspace.loadDocument`

Census, GNIS, higher-ed and medical are each evaluated twice per candidate (legacy per-family loop + inside `referenceEvidenceFor`). Cost: ~0.6 ms per document.

Deriving the legacy maps from the unified map would be behaviourally identical *in principle* — but the scopes deliberately differ (census/GNIS are computed only for `detectedType === "person"`; the fan-out asks every channel of every candidate), and the census map is the input to the **one behavioural coupling in the system**. Trading 0.6 ms for a change on the person-protection path is a bad bargain. Left alone; the `getReferenceEvidence` header already documents it as a later mechanical change.

### 9.3 `__docscrub.referenceEvidence()` is superseded but retained

The family-generic `__docscrub.channels()` covers everything the older per-family instrument does, with no per-family editing. `referenceEvidence()` is deliberately retained as a working instrument with higher-ed/medical-specific detail. It can be retired once that detail is no longer wanted; retiring it now would trade a merge conflict for a behavioural risk while integrations are in flight.

### 9.4 Licensing metadata is genuinely inconsistent

The **only** inventory field that varies without a documented reason. Employment/HR and Government export explicit `SOURCE_LICENSING` tables; Legal, Medical and Higher-ed carry licensing as prose in the asset header; Finance carries source URLs and authority levels but no licensing block. This is a real (small) inconsistency rather than an intentional difference, and the substrate has no column for it. Recommended when convenient: promote `SOURCE_LICENSING` to the shared pack asset shape and have `generate_domain_terminology_pack.py` require it. Not done here — it would mean regenerating four assets, which is exactly the kind of change this pass should not make.

### 9.5 `attestingChannels()` ordering

Declaration-ordered and documented as carrying no precedence — but it *is* an ordering, and orderings acquire meaning by being read. Worth a defensive assertion in a future pass that no consumer reads `[0]`.

---

## 10. Inputs for the next pass

The combination layer now has clean inputs. What is available to it:

### 10.1 Runtime surface

```ts
referenceEvidenceFor(phrase): ReferenceEvidenceChannels
  // all 8 channels, 4.79 µs, no precedence, no vote

terminologyChannelsOf(channels): TerminologyChannelView[]
  // uniform family-agnostic view: matchedTerm, normalized, attestationRows,
  // sourceFamilies, subDomains, semanticHints, highestCollisionRisk,
  // hasSourceAttestedRow, tokenCount

referenceEvidenceAuditRows(channels): ReferenceEvidenceAuditRow[]
  // flat, self-contained: source family → source (+URL) → attested term →
  // normalized key → evidence family → claim. Answers "which path produced
  // this, and where do I go to fix it" without the object graph.

attestingChannels(channels): string[]
  // names only

Workspace.getReferenceEvidence(): ReadonlyMap<candidateId, ReferenceEvidenceChannels>
  // computed once at load, for EVERY candidate including non-hits — so
  // "asked and nothing matched" is distinguishable from "never asked"
```

The four inert facts already reach the interpretation boundary in production via `SemanticTypeFacts` (`censusNameStructure`, `higherEdTerminologyAttested`, `medicalTerminologyAttested`, `gnisPlaceStrength`). **The combination change is a local edit at an existing call site, not a plumbing exercise** — which was the whole point of carrying them.

### 10.2 Diagnostics

- `__docscrub.channels()` — coverage per family, every hit, and §3 conflicts, on the live document
- `__docscrub.channels("<phrase>")` — the full determination path for one string
- `investigation/reference-evidence-matrix.ts` — the eight-family collision landscape
- `investigation/reference-evidence-perf.mjs` — the cost budget any combination rule must fit inside
- `investigation/domain-reference-overlap.ts`, `investigation/employment-hr-overlap.ts` — per-pack integration measurements, retained

### 10.3 Measured facts the next pass should design against

1. **The conflict space is shallow.** Max 3 simultaneous families, ever. 2.3% of vocabulary. No arbitration of 4+ claims is ever needed.
2. **Domain↔domain collision is small** (1–23 per pair). Cross-domain vocabulary overlap is real but rare.
3. **The dominant collision is terminology × Census token**, concentrated in single-token phrases (187 of 779, 24%), and the packs' own `collision_risk` columns already flag most of it.
4. **GNIS × Census is the big one: 36,119 place names carry personal-name structure; 35,174 of them are `strong` and unsuppressed.** Any rule of the form "place evidence ⇒ not a person" is wrong for that population.
5. **GNIS is not independent of Census** (Policy B calls `censusRoleFor`). Do not count them as independent corroboration.
6. **Cross-family agreement between domain packs is not independent corroboration either** — several packs draw on overlapping federal source families.
7. **Acronym rows are local to their source and domain.** 35 collide across families. `ADA` is medical *and* employment/HR *and* a Census token.
8. **Cost budget:** the entire evidence layer costs 4.79 µs/candidate. A combination layer has room.

### 10.4 The architectural question this pass surfaced but does not answer

Five families have now independently arrived at the same boundary — `censusNameStructure`, `higherEdTerminologyAttested`, `gnisPlaceStrength`, `medicalTerminologyAttested`, and the four substrate packs reaching it through the fan-out — and each integration report reached the same conclusion in its own words: **`semanticTypeFor` is a first-match-wins chain returning one id, and it structurally cannot represent "affirmative PERSON evidence AND affirmative PLACE evidence."** It can only pick, and the pick order is arbitrary precedence.

That is not a bug in any family. It is the shape of the thing that does not exist yet. No weights or decision rules are proposed here; the observation is recorded only because it is the unresolved architectural question the next pass must open with.

---

## Success criterion

DocScrub can now answer, efficiently (4.79 µs) and traceably (source family → authority → attested term → normalized key → claim):

> *"What independent reference evidence do we have about this candidate?"*

across all eight families.

It does **not** use that answer to change what it thinks the candidate is.
