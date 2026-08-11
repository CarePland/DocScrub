# DocScrub MedicalEvidence terminology pack — methodology

**Artifact version:** 2026-08-10-v1  
**Evidence family:** `MedicalEvidence`  
**Purpose:** deterministic exact-match evidence that a phrase is attested medical/healthcare terminology. It is not a classifier, blacklist, PII list, diagnosis engine, or clinical decision system.

## Deliverable summary

- Source-attested rows: **374**
- Derived variants: **7**
- Total rows: **381**
- Normalized unique terms: **378**
- Source families: {'CMS': 78, 'CDC': 111, 'NLM_MESH': 192}
- Abbreviation rows: **43**
- Collision risk: {'LOW': 327, 'HIGH': 38, 'MEDIUM': 16}

### Semantic-hint counts

- `AMBIGUOUS`: 42
- `ANATOMY`: 33
- `BILLING_CODING`: 41
- `CONDITION`: 34
- `DOCUMENT`: 11
- `IDENTIFIER_TYPE`: 1
- `MEDICAL_CONCEPT`: 59
- `MEDICATION`: 21
- `ORGANIZATION_DEPARTMENT`: 36
- `OTHER_DOMAIN_TERM`: 8
- `PROCEDURE`: 27
- `PROCESS_EVENT`: 30
- `ROLE`: 18
- `TEST`: 20

## Architecture

This pack must remain a named evidence channel:

```text
MedicalEvidence
```

A future trace can independently report, for example:

```text
Medical reference:
    exact match: "prior authorization"
    source family: CMS
    semantic hint: PROCESS_EVENT
```

Other evidence families (Census names, GNIS geography, legal terminology, higher education, etc.) remain independent and may support or contradict a candidate.

## Selection policy

This first benchmarkable pack intentionally favors **high-confidence, authoritative terminology** over maximal clinical completeness. It combines:

1. a deliberately limited set of high-confidence canonical 2026 MeSH headings;
2. CMS administrative, coverage, coding and billing vocabulary;
3. CDC healthcare-personnel, infection-control and epidemiology terminology;
4. explicit source-attested abbreviations from CDC;
5. a very small number of deterministic orthographic variants.

The pack does **not** attempt to mirror the entire MeSH release. Full-scale ingestion should be a later, separately benchmarked expansion.

## Normalization

Exact lookup normalization is deterministic:

1. Unicode NFKC;
2. trim leading/trailing whitespace;
3. convert Unicode dash variants to ASCII `-`;
4. collapse repeated whitespace;
5. Unicode casefold.

No stemming, fuzzy matching, phonetic matching, token reordering, synonym inference, or edit-distance matching is used.

`term` preserves the display/source form. `normalized_term` is lookup-only.

## Semantic hints

Hints are deliberately coarse. They are evidence labels rather than clinical ontology assertions:

`MEDICAL_CONCEPT`, `CONDITION`, `PROCEDURE`, `MEDICATION`, `TEST`, `ANATOMY`, `DOCUMENT`, `PROCESS_EVENT`, `ROLE`, `ORGANIZATION_DEPARTMENT`, `BILLING_CODING`, `IDENTIFIER_TYPE`, `OTHER_DOMAIN_TERM`, `AMBIGUOUS`.

Abbreviations are usually labeled `AMBIGUOUS` unless the source form itself is unambiguously domain-specific.

## Derived variants

Only a handful of conservative orthographic variants are included (primarily hyphen/spacing forms). Every such row has:

- `source_attested = FALSE`
- `derived_variant = TRUE`
- `parent_term` pointing to the source-attested form

No generated clinical synonyms are included.

## Collision analysis

`collision_risk` is a deterministic warning layer, not a deletion rule.

- `HIGH`: short abbreviations and obvious name/place/common-word collisions.
- `MEDIUM`: ordinary-English single-word terms likely to occur outside medicine.
- `LOW`: longer or strongly domain-specific terms.

Collision notes are retained. Real medical terms are not removed merely because they collide.

Examples: `CASE`, `CLAIM`, `PROVIDER`, `CPT`, `RT`, and `IV` are legitimate healthcare terms but require independent evidence before semantic classification.

## Privacy distinction

Membership means only: **the phrase is attested healthcare terminology**.

It must never be transformed into an assertion that a person has a diagnosis, underwent a procedure, takes a medication, or has any other health status. For example, a document occurrence of `Diabetes Mellitus` is terminology evidence only.

## Licensing and source availability

### safe/usable for derived distributable pack

**NLM MeSH 2026.** NLM states that it freely provides MeSH data. Republishing/redistribution requires acknowledgement of NLM and either keeping the data current or clearly identifying the MeSH version / warning that the redistributed copy may not be current. This artifact identifies itself as a 2026 benchmark pack and points to the current NLM download page.

**CMS webpages/glossary.** This pack uses federal CMS-authored terms and labels, not lengthy CMS definitions. It does not reproduce AMA CPT descriptors.

**CDC webpages/glossaries.** This pack uses federal CDC-authored terms and source-attested abbreviations, not long-form glossary definitions.

### usable only with attribution/conditions

**LOINC.** Valuable for laboratory tests, measurements, observations, and documents, but the current LOINC license has attribution/notice requirements and includes some third-party content with additional notices. A production redistribution should ingest only fields/content whose license obligations are fully implemented, preserving any required per-code notices. Not copied into this v1 artifact.

**RxNorm — NLM-created normalized names/codes.** NLM states that RxNorm normalized names and RXCUIs created by NLM are public domain, but the full dataset contains proprietary source content. The Current Prescribable Content subset can be downloaded without a UMLS license and is a strong future source, provided ingestion is restricted to redistributable NLM/FDA/CMS content and the requested NLM acknowledgement/currentness conditions are implemented. Not copied into this v1 artifact.

### useful for research but unsuitable for silent redistribution

**UMLS Metathesaurus.** The 2026AA license explicitly restricts distribution of the Metathesaurus and subsets except under specified conditions, and incorporated vocabularies have source-specific restriction categories. UMLS should be treated as a research/integration framework, not as a source to silently dump into a distributable DocScrub CSV.

**SNOMED CT.** U.S. access is available through NLM under the SNOMED/UMLS affiliate licensing framework. Vendor/product use and derivative distribution carry licensing obligations. No SNOMED CT terms were copied into this distributable v1 pack.

### rejected from this deliverable

**AMA CPT descriptive terminology/codes.** CMS explains that HCPCS Level I is CPT maintained by the AMA. The pack records generic terms such as `Current Procedural Terminology` and `CPT` as CMS-attested coding vocabulary, but does not reproduce CPT code descriptors.

**Unvetted hospital glossaries / commercial medical dictionaries.** Excluded because an authoritative federal source was sufficient for this benchmark and redistribution status was less clear.

## Source inventory


### MeSH 2026

- URL: https://www.nlm.nih.gov/databases/download/mesh.html
- Family: `NLM_MESH`
- Authority: `US_FEDERAL_CONTROLLED_VOCABULARY`
- Status: **safe/usable for derived distributable pack**
- Note: NLM freely provides MeSH data; redistribution is allowed with NLM acknowledgement and version/currentness notice.

### CMS Glossary

- URL: https://www.cms.gov/glossary
- Family: `CMS`
- Authority: `US_FEDERAL_AGENCY`
- Status: **safe/usable for derived distributable pack**
- Note: Federal CMS terminology page; pack reproduces terms, not long definitions.

### CMS HCPCS Overview

- URL: https://www.cms.gov/medicare/coding-billing/healthcare-common-procedure-system
- Family: `CMS`
- Authority: `US_FEDERAL_AGENCY`
- Status: **safe/usable for derived distributable pack**
- Note: Uses CMS-authored HCPCS overview terminology; does not reproduce AMA CPT descriptors/codes.

### CDC HCP Terminology

- URL: https://www.cdc.gov/infection-control/hcp/healthcare-personnel-infrastructure-routine-practices/terminology.html
- Family: `CDC`
- Authority: `US_FEDERAL_AGENCY`
- Status: **safe/usable for derived distributable pack**
- Note: Federal CDC terminology and abbreviations; terms only.

### CDC Epidemiology Glossary

- URL: https://www.cdc.gov/reproductive-health/glossary/index.html
- Family: `CDC`
- Authority: `US_FEDERAL_AGENCY`
- Status: **safe/usable for derived distributable pack**
- Note: Federal CDC glossary; terms only.

### CDC Environmental Infection Control Glossary

- URL: https://www.cdc.gov/infection-control/hcp/environmental-control/glossary.html
- Family: `CDC`
- Authority: `US_FEDERAL_AGENCY`
- Status: **safe/usable for derived distributable pack**
- Note: Federal CDC glossary; terms only.

## Major gaps

This v1 is intentionally not clinically exhaustive. Important gaps for later, separately licensed/benchmarked expansion include:

- full MeSH descriptor/entry-term ingestion with stable MeSH UIDs;
- RxNorm prescribable medication names and RXCUIs;
- LOINC laboratory/imaging/document terms and codes with complete license/third-party notice handling;
- specialty-specific procedure vocabulary;
- robust provider-role taxonomy;
- device vocabulary;
- encounter/order/document workflow terms from additional authoritative federal sources;
- abbreviation disambiguation tables with multiple expansions;
- formal Census/GNIS collision joins rather than the lightweight heuristic warnings used here;
- ICD-10-CM code-title ingestion after a dedicated redistribution/license check;
- SNOMED CT integration only under an explicit product licensing plan.

## Benchmarking recommendations

Before integration, benchmark at least:

1. exact-match recall on real healthcare documents;
2. false-positive rate on non-healthcare documents;
3. collision behavior for short abbreviations and ordinary-English terms;
4. contribution of `MedicalEvidence` when independent Census/GNIS/legal/higher-ed evidence disagrees;
5. incremental value of each future source family before adding it.

Do not let dictionary membership determine final semantic type by itself.
