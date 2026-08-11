# Government / Public Administration Terminology Evidence — Integration Findings

**Date:** 2026-08-10
**Status:** shipped inert. No scoring, routing, recommendation or classification behaviour changed.
**Author:** integration pass (AG direction)

---

## The semantic contract

```
GovernmentPublicAdminEvidence means:

"This phrase is attested government/public-administration terminology
 according to the cited source."

It does NOT mean:

"Therefore this phrase is not a person."
```

It also does not mean "this phrase is government-related in this document" — the
lookup cannot see the document — and it does not mean "this phrase denotes a
government organization", which is the collapse this particular family is most
exposed to (see §7).

---

## 1. Architecture discovered

The reference-evidence architecture had moved substantially since the last
context. What exists now:

| Layer | File | Role |
|---|---|---|
| Shared substrate | `src/engines/knowledge/DomainReferenceEvidence.ts` | Row model, pack asset format, index build, the one lookup, the one explainer. Families: finance, legal, employment-HR |
| Pre-substrate packs | `HigherEdTerminologyEvidence.ts`, `MedicalEvidence.ts` | Own record shapes; read through their own APIs, deliberately not migrated |
| Entity reference | `CensusNameEvidence.ts`, `GnisPlaceEvidence.ts` | Different question, different shape |
| Fan-out | `ReferenceEvidence.ts` | `referenceEvidenceFor(phrase)` asks every channel and resolves none; `terminologyChannelsOf` is a uniform view; `referenceEvidenceAuditRows` flattens the determination path |
| Per-candidate | `Workspace.getReferenceEvidence()` | Computes the fan-out once per candidate |
| Diagnostic | `__docscrub.referenceEvidence([phrase])` | **Already family-agnostic** — driven by `terminologyChannelsOf`, not by per-family blocks |
| Generator | `scripts/generate_domain_terminology_pack.py` | One generator, per-pack config in `PACKS` |

**Concurrency note.** The Employment/HR integration landed *during* this pass —
between the first inspection and the first edit. The generator gained a
`consumer` key, a `licensing_columns` mechanism and an `employment_hr` entry;
`ReferenceEvidence.ts` gained Medical and Employment/HR channels; and the app.ts
diagnostic was rewritten to be generic. Every one of those was adopted rather
than worked around. Nothing pre-existing was reverted or rewritten.

## 2. How Government plugs in

Through the seams that already existed, additively:

- **One member** on `DomainReferenceFamilyId` (`"government-public-admin"`).
- **One field + one call + one view case + one audit block** in `ReferenceEvidence.ts`.
- **Two new `PACKS` keys** in the generator (`authority_column`, `jurisdiction_column`) plus the pack entry.
- **Zero changes** to `Workspace.ts` — the fan-out already carries it per candidate.
- **Zero changes** to the `__docscrub.referenceEvidence()` diagnostic — it is
  already driven by `terminologyChannelsOf`, so government appears in coverage,
  per-hit provenance, and the multi-family cross-view with no edit at all. The
  one app.ts edit made was a stale count in a log string (`"five partial
  datasets"` → `"these partial datasets"`, now seven channels).

The row contract, the intern-table format, and every other pack's shipped asset
are untouched.

### The one thing that did not fit, and how it was resolved

The pack carries `jurisdiction`, which the shared row model has no column for.
Widening `DomainReferencePackAsset` would have meant regenerating **every**
pack's asset — the worst possible shared-file change while four integrations are
in flight. It is constant (`US_FEDERAL`) across all 412 rows, so:

- the generator **asserts it is single-valued** and emits one constant;
- the provider carries it on its own evidence alias (`DomainReferenceEvidence<"government-public-admin"> & { jurisdiction: string }`);
- **if a v2 varies it, the generator stops.** Converting it to a row column is a
  shared-contract change and should be a decision, not a silent widening.

The rule generalises and is recorded in `DomainReferenceEvidence.ts`: a
pack-specific field that does not vary is not a reason to widen a shape every
other pack depends on.

## 3. Files added / modified

**Added**

```
src/engines/knowledge/GovernmentPublicAdminEvidence.ts          provider
src/engines/knowledge/government-public-admin-terminology.data.ts  GENERATED asset (43 KiB)
verify/government-public-admin-evidence-verification.ts         214 assertions
investigation/data/docscrub_government_public_admin_terms.csv   versioned source
investigation/data/docscrub_government_public_admin_methodology.md
```

**Modified (all additive)**

```
scripts/generate_domain_terminology_pack.py     +pack entry, +authority/constant side tables
src/engines/knowledge/DomainReferenceEvidence.ts +1 family literal, +doc note
src/engines/knowledge/ReferenceEvidence.ts       +import/+field/+call/+view case/+audit block
investigation/domain-reference-overlap.ts        +government pack, +medical/employment lookups, +§4b acronyms
src/ui/app.ts                                    one stale log string
```

**Not shipped:** `build_government_public_admin_pack.py`,
`verify_government_public_admin_pack.py`, `VERIFICATION_RESULTS.txt`,
`government_public_admin_manifest.json`, and the CSV's `collision_census_name` /
`cross_evidence_overlaps` research columns. The last two are the pack author's
own pre-computed overlap claims; collisions were re-measured against the
repository's actually-shipped assets instead (§8), which is the only honest way
to do it.

## 4. Dataset actually shipped

| | |
|---|---|
| Attestation rows | **412** |
| Distinct normalized keys | **409** |
| Multiply attested keys | 3 (`contract`, `federal agency`, `series`) |
| Derived variants | **0** — nothing in this pack was mechanically generated |
| Collision risk | LOW 83 · MEDIUM 263 · HIGH 66 |
| Source families | 7 (FAR_PART_2 103, NARA_RM 125, GRANTS_GOV 73, FOIA_GOV 40, USAGOV_AGENCIES 29, FEDERAL_REGISTER 27, OPM_CLASSIFICATION 15) |
| Sub-domains | 11, incl. OFFICIAL_ORGANIZATION 29 |
| Acronym rows | 129, every one source-attested |
| Jurisdiction | US_FEDERAL (constant) |

Regeneration is byte-identical (verified).

## 5. Normalization

Six steps, matching the methodology's §Deterministic normalization exactly —
identical to the Legal policy, arrived at independently, and **aliased rather
than merged** so a later revision of either methodology can move without
dragging the other:

1. NFKC → 2. curly quotes → ASCII → 3. Unicode dashes/minus → ASCII hyphen →
4. casefold → 5. collapse whitespace/trim → 6. remove spaces around `/` and `-`.
All other punctuation, digits, apostrophes and token order preserved.

Two implementations (Python generator, TypeScript provider) with **412/412
parity asserted in both** — the generator refuses to emit on mismatch, and the
verify suite re-derives every shipped key.

**Step 6 is inert on v1 data.** No shipped row contains a space adjacent to `/`
or `-`, so the finance policy would reproduce all 412 keys too. It is
implemented because the contract is what gets implemented, and it is pinned in
the suite with synthetic input (`pre - award` → `pre-award`) precisely because
the dataset cannot pin it.

No stemming, lemmatization, fuzzy matching, edit distance, token reordering,
substring matching, synonym expansion, or model inference.

## 6. Provenance representation

Every attestation carries: source name, URL, source family, authority level,
sub-domain, semantic hints (list), source-attested flag, derived-variant flag,
parent term, collision risk, acronym, acronym expansion, notes. Plus two
per-family side tables and one pack constant:

- `GOVERNMENT_SOURCE_AUTHORITIES` — `NARA_RM` → "National Archives and Records
  Administration". A source family is a machine key; an audit path has to be
  able to print the body behind it.
- `GOVERNMENT_SOURCE_LICENSING` — per-family licence + retrieval date (NARA CC0,
  DOJ public-domain-unless-indicated, etc.) for downstream redistribution.
- `GOVERNMENT_JURISDICTION`.

"Why does DocScrub say this is government terminology?" resolves to:
source family → authority (+URL) → published term → normalized key → claim.
Worked example, from the live harness:

```
Series
  government-public-admin  RECORDS_MANAGEMENT     NARA_RM              'Series'  HIGH
  government-public-admin  GOVERNMENT_EMPLOYMENT  OPM_CLASSIFICATION   'Series'  HIGH
  employment-hr-terminology  classification       OPM_CLASSIFICATION   'series'  HIGH
```

## 7. Organization-name handling

The distinction survives **as data**, never as a type:

- 29 rows carry `subDomain = OFFICIAL_ORGANIZATION` (named federal bodies).
- 37 rows carry the `ORGANIZATION` semantic hint — a **different, overlapping**
  population. The hint describes vocabulary; the sub-domain describes what kind
  of row it is. Both are carried verbatim; neither is mapped to `SemanticTypeId`.

`explainGovernmentPublicAdminEvidence` adds exactly one line for named-body rows
— *"This source lists it as an official government organization name — which is
what the dataset records, not a determination about what this phrase refers to
here"* — and general vocabulary does not get it. Both facts are asserted.

## 8. Acronym handling

129 source-attested acronym rows; zero inferred. The expansion is **provenance**
(what one authority published), never resolution of what the string means here.
`SAM` is attested by Acquisition.gov as System for Award Management **and** by
Census as a given name; both survive, neither withdraws the other. Acronym and
long form are separate keys, separately attested.

## 9. Collision measurement

Measured against every family now in the repository, using each target pack's
**own** normalizer (never raw key comparison). Measured first; nothing tuned.

| Intersection | Count | Examples |
|---|---|---|
| government ∩ **census** (every token attested) | **42 / 409** | 32 single-token; 2 all-Top-1000 (`Day`, `SAM`) |
| government ∩ **employment-HR** | 9 | Accession · General Schedule · Grade · Job Grading · Pay System · Position Classification · Qualification Requirements · Retirement · Series |
| government ∩ **higher-ed** | 7 | Applicant · Depreciation · Exclusions · Indirect Cost Rate · Role · SFA · Student Financial Aid |
| government ∩ **finance** | 7 | Asset · Budget · Depreciation · Grace Period · Inventory · Obligations · Risk |
| government ∩ **legal** | 6 | Claim · Contract · Disposition · Information System · Record · Risk Assessment |
| government ∩ **medical** | 2 | Claim · Cost Sharing |
| government ∩ **GNIS** | **0** | not distinguishing — *every* terminology pack measures 0 against GNIS |

**Riskiest single-token collisions** (Census-attested, all retained):
`Band · Contractor · Day · Grade · Notice · Offer · Record · Risk · Role · Rule ·
Search · State · Title`

**Acronym collisions**: 19 of 129 acronym rows are Census-attested personal
names — `AMS · ARO · BIA · CAGE · COR · DAL · EIS · ERA · ERK · ERKS · FAIN ·
FEA · FON · FRA · MAC · NARA · SAM · SAO · SORN`. 2 also attested higher-ed
(`SFA`, `Student Financial Aid`).

**Source-assigned risk**: government is the most warned-about pack in the
repository by proportion — its own authors flag **329 of 412 rows (80%)** MEDIUM
or HIGH, against 44% for legal and 45% for finance. That is a property of the
register public administration is written in, not a defect. Nothing was
filtered, suppressed, or down-weighted.

Live-document frozen witnesses (`investigation/live-residue.data.ts`, 136
witnesses): government attests **zero** of them. No new witness collision.

## 10. Verification

`verify/government-public-admin-evidence-verification.ts` — **214 assertions,
all passing**. Sections:

1. Generated asset (counts, row arity, intern-table invariants)
2. Normalization parity over all 412 shipped rows
3. Positive lookups across all required cases (`Notice of Proposed Rulemaking`, `Request for Records Disposition Authority`, `NPRM`, `FAIN`, `GRS`, `National Archives and Records Administration`)
4. Normalization behaviour, incl. the synthetic step-6 case
5. **Exactness** — `Proposed`, reorderings, prefixes, suffixes, plurals all miss; `Disposition` hits *because NARA ships it as its own row*, and `Authority` (the other inner token) misses
6. Provenance preserved, authority/licensing tables
7. Multi-source attestation (`Series` across NARA + OPM; `Contract`; `Federal Agency`)
8. Organization rows are a row property, not a type
9. Acronym provenance
10. Collision retention (HIGH terms return in full; the 42-term Census intersection is pinned at its measured size)
11. Cross-family coexistence + fan-out + audit-row reconstruction
12. **Inertness** — a candidate gains `government.attested = true` while `semanticTypeFor` and `typeCheckSectionFor` return exactly what they returned before
13. Explanation states an observation, never a verdict

## 11. Test and build results

```
tsc --noEmit            clean
npm run build           clean
verify battery          78 suites, 4301 assertions, 0 failures
```

**Baseline before this work:** 73 suites, 3530 assertions, 1 failure —
`ui-smoke`, "dist is stale against src" (a build-freshness artifact from
concurrent edits to `src/ui/app.ts`, not a behavioural failure). It clears after
`npm run build` and is green now.

The delta (73 → 78 suites) includes the concurrently-landed Employment/HR work
as well as this pass's 214 assertions. No pre-existing expectation was weakened,
skipped, rewritten or removed.

## 12. Explicit confirmation

**Not changed by this work:** PERSON scoring · organization scoring · place
scoring · ambiguity scoring · Type Check · recommendation logic · routing ·
Keep/Rename/Redact/Ignore · Group Check · Item Check · dictionaries and
blacklists · extraction rules · thresholds · `semanticTypeFor` ·
`typeCheckSectionFor` · `SemanticTypeFacts`.

No government term was added to any suppression list. No `if (governmentHit)
notPerson = true` exists, and §12 of the suite is a structural guard that fails
if such a field is ever introduced.

---

## 13. For the combination layer — issues found, not solved here

**a. Cross-family agreement is not necessarily independent corroboration.**
The sharpest finding of this pass. 7 of the 9 government ∩ employment-HR
overlaps trace to the **same authority ingested twice** — `OPM_CLASSIFICATION`
appears as a source family in both packs (`General Schedule`, `Grade`, `Job
Grading`, `Pay System`, `Position Classification`, `Qualification Requirements`,
`Series`). A combination layer that weights "attested by two independent
families" will over-count these. The information needed to detect it is present
(`sourceFamily` survives on every attestation), but nothing uses it yet, and the
two packs assign **different sub-domain vocabularies to the same source**
(`GOVERNMENT_EMPLOYMENT` vs `classification`). Recommend the eventual layer
weight on distinct **source families**, not distinct evidence families.

**b. Third arrival at the missing conflict layer.** Government joins higher-ed,
GNIS and the domain packs in reporting the same gap: `semanticTypeFor` returns
one id and cannot represent a candidate about which two datasets both have
something to say. Still correctly out of scope.

**c. Sub-domain vocabularies are per-pack and uncomparable.** `OFFICIAL_ORGANIZATION`,
`FINANCE`, `classification` come from different authors. Nothing compares them
today; anything that starts to will need a mapping decision made deliberately.

**d. `sourceAuthorityLevel` is degenerate here.** Constant `HIGH` across all 412
rows, so it discriminates nothing within this pack. It is carried, never
compared — consistent with the substrate's contract, but worth knowing before
anyone tries to weight on it across packs whose vocabularies differ.

**e. Higher-ed and Medical remain off the shared substrate.** Both are read
through their own APIs by the fan-out, so nothing is missing functionally, but
`referenceEvidenceAuditRows` has to special-case Medical's `authorityLevel`
field name. Migration remains a mechanical, separate change.

**f. Reference evidence is still absent from the exported `AuditRecord`.**
Deliberate — it decides nothing today. When the combination layer makes it
matter, that wiring is a decision for whoever builds it.
