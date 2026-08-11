# DocScrub Government / Public Administration Terminology Evidence Pack — Methodology

**Dataset version:** 2026-08-10  
**Evidence family:** `government_public_admin`

## Bounded semantic claim

A hit means only:

> “This phrase is attested government/public-administration terminology according to the cited source.”

It does **not** mean “therefore this phrase is not a person,” and it does not override Census, GNIS, Legal, Employment/HR, Finance/Accounting/Tax, Higher Education, Medical, or later context evidence.

## Dataset summary

- Evidence rows (including explicitly attested acronym rows): **412**
- Unique normalized lookup forms: **409**
- Source families: **7**
- Collision risk: **{'MEDIUM': 263, 'HIGH': 66, 'LOW': 83}**
- Exact Census-name collisions: **32**
- Existing-pack exact overlaps measured: **{'higher_ed': 7, 'legal': 7, 'finance_accounting_tax': 7, 'medical': 2}**

### Rows by source family

- `FAR_PART_2`: 103
- `FEDERAL_REGISTER`: 27
- `FOIA_GOV`: 40
- `GRANTS_GOV`: 73
- `NARA_RM`: 125
- `OPM_CLASSIFICATION`: 15
- `USAGOV_AGENCIES`: 29

### Rows by semantic hint

- `ADMINISTRATIVE_PROCEEDING`: 2
- `DATA_SYSTEM`: 35
- `DOCUMENT`: 48
- `DOCUMENT_SYSTEM`: 14
- `EMPLOYMENT_ADMIN`: 15
- `ENFORCEMENT_COMPLIANCE`: 12
- `FISCAL_ADMIN`: 22
- `GOVERNMENT_STRUCTURE`: 18
- `IDENTIFIER_TYPE`: 16
- `LEGAL_ADMIN`: 9
- `ORGANIZATION`: 37
- `OTHER_DOMAIN_TERM`: 3
- `PROCESS_EVENT`: 45
- `PROCUREMENT`: 35
- `PROGRAM_ADMIN`: 20
- `PROPERTY_ADMIN`: 4
- `PUBLIC_SERVICE`: 2
- `RECORDS_INFORMATION`: 30
- `ROLE`: 33
- `RULEMAKING`: 12

## Source decisions

### Accepted

1. **Grants.gov Grant Terminology** — authoritative federal grants lifecycle vocabulary: awards, applications, assistance listings, recipients/subrecipients, grant identifiers, and grant-administration roles.
2. **Federal Acquisition Regulation Part 2 (Acquisition.gov)** — authoritative procurement/acquisition definitions and contracting administration terminology. This pack uses a curated subset of source-attested terms rather than blindly converting every FAR definition into a government-domain word.
3. **FOIA.gov glossary (DOJ/OIP)** — strong public-records and administrative-appeals terminology.
4. **NARA Records Management Key Terms and Acronyms** — unusually useful records-management vocabulary including schedules, disposition, retention, records systems, and agency records roles.
5. **FederalRegister.gov Reader Aids / rulemaking materials** — rulemaking/document types and public-comment terminology. The 900-term CFR indexing vocabulary was researched but **not bulk-ingested** because most entries are regulated subject matter rather than public-administration terminology.
6. **OPM Classification & Qualifications** — a small, deliberately bounded federal-employment/classification slice.
7. **USAGov agency index** — only a small sample of official organization names, tagged `OFFICIAL_ORGANIZATION`, to keep organizational identity distinguishable from general government terminology.

### Rejected / deliberately not bulk-ingested

- **Federal Register CFR Topics (900 terms):** authoritative, but primarily a subject-matter indexing vocabulary (aircraft, agriculture, accounting, etc.). Bulk inclusion would make this pack a broad regulated-domain ontology rather than a public-administration reference.
- **Complete USAGov agency directory:** authoritative but would turn the pack into an organization directory. Only a small organization-name slice is retained to exercise the distinct organization-evidence metadata path.
- **eCFR / CFR wholesale:** authoritative but far too broad; individual regulatory definitions should be added only when they supply a bounded public-administration subdomain.
- **Commercial government dictionaries / procurement glossaries:** excluded.
- **State/local glossaries in v1:** not needed for baseline coverage. Future additions should carry explicit jurisdiction and rights review. No state/local terminology is silently treated as universal.

## Licensing / provenance

Federal works are generally outside U.S. copyright under 17 U.S.C. §105, while federal publications can contain third-party copyrighted material. The dataset therefore stores **short term labels and provenance, not source definitions**.

NARA states that works it produces are public domain and available under CC0. DOJ states that, unless otherwise indicated, information on DOJ websites is public domain and may be copied/distributed. Organization seals/logos and third-party content are not included.

Every row carries source URL, responsible authority, jurisdiction, source family, retrieval date, and a conservative license-status string.

## Deterministic normalization

1. Unicode NFKC.
2. Smart quotation marks → ASCII quotation marks.
3. En/em/minus dash variants → ASCII hyphen.
4. Unicode casefold.
5. Collapse whitespace to one ASCII space and trim.
6. Remove spaces immediately around `/` and `-`.
7. Preserve all other punctuation, digits, apostrophes, and token order.
8. No stemming, lemmatization, fuzzy matching, token reordering, or model-generated synonym expansion.

Acronyms are separate production rows **only when the authoritative source explicitly supplies the acronym/abbreviation relationship**.

## Schema

- `term`: source display form or explicitly source-attested acronym.
- `normalized_term`: deterministic lookup key.
- `semantic_hint`: coarse evidence description; not a final type.
- `category`: public-administration subdomain.
- `jurisdiction`: currently `US_FEDERAL`.
- `source_*`: authority/provenance.
- `source_attested`: true for every v1 production row.
- `derived_variant`: false in v1; no unsourced variants were generated.
- `parent_term`: expansion/parent when an acronym is represented.
- `acronym`, `acronym_expansion`: populated only for explicit source pairs.
- `collision_risk`: lexical warning, never a deletion/suppression rule.
- `collision_census_name`: exact normalized intersection with the available Census evidence asset.
- `cross_evidence_overlaps`: exact intersections measured against currently available evidence assets.
- `license_status`, `retrieval_date`, `notes`: audit support.

## Collision / ambiguity analysis

### Census exact-name collisions

**32** exact normalized government rows are also attested by the available Census name asset.

Examples: AMS, ARO, BIA, Band, CAGE, COR, Contractor, DAL, Day, EIS, ERA, ERK, ERKS, FAIN, FEA, FON, FRA, Grade, MAC, NARA, Notice, Offer, Record, Risk, Role, Rule, SAM, SAO, SORN, Search, State, Title.

These terms are **retained**. Census and government evidence can both be true.

### Existing evidence-pack intersections


- **higher_ed: 7** exact row-level overlaps. Examples: Applicant, Depreciation, Exclusions, Indirect Cost Rate, Role, SFA, Student Financial Aid.
- **legal: 7** exact row-level overlaps. Examples: Claim, Contract, Disposition, Information System, Record, Risk Assessment.
- **finance_accounting_tax: 7** exact row-level overlaps. Examples: Asset, Budget, Depreciation, Grace Period, Inventory, Obligations, Risk.
- **medical: 2** exact row-level overlaps. Examples: Claim, Cost Sharing.

Expected overlap is substantial: `Contract`, `Claim`, `Depreciation`, `Student Financial Aid`, `Educational Institutions`, `Series`, `Title`, `Budget`, and similar terms can legitimately belong to multiple evidence channels.

### Ambiguous acronyms

Acronym rows are intentionally evidence-local. `SAM`, `COR`, `CIO`, `IT`, `ERA`, `ARC`, `ACF`, `AMS`, `ARS`, and others are **not** claimed to have a unique global meaning. Their row says only that the cited government source attests that expansion.

### Common-English collisions

Single/common words such as `Access`, `Asset`, `Award`, `Band`, `Budget`, `Claim`, `Contract`, `Day`, `Grade`, `Notice`, `Record`, `Risk`, `Rule`, `Search`, `Series`, `State`, and `Title` remain in the dataset with `HIGH` collision risk where source-attested.

## Architecture / integration

This artifact is intentionally inert. It is suitable for a read-only evidence service such as:

```text
candidate
  -> normalized exact lookup
  -> GovernmentPublicAdminEvidence
       attested
       semanticHint
       category
       jurisdiction
       provenance[]
       collisionRisk
       overlap flags
  -> later context/policy layer
```

No scoring, routing, PERSON suppression, semantic-type change, or precedence rule is defined here.

The existing DocScrub higher-ed work already established the appropriate pattern: reference evidence can be exposed read-only and separately from scoring/routing. Repository integration should reuse that abstraction rather than create a government-specific policy shortcut.

## Verification recommendations

A repository integration should pin at least:

1. exact hit for a specific phrase such as `Notice of Proposed Rulemaking`;
2. exact hit for a multi-token records phrase such as `Request for Records Disposition Authority`;
3. explicit acronym/expansion pair such as `NPRM`;
4. common-word collision such as `Record` or `Title`;
5. multi-attestation where the same normalized term appears in more than one source;
6. phrase miss / no substring matching;
7. case and Unicode-normalization parity;
8. government + Census simultaneous evidence;
9. government + Legal / Finance / Higher-Ed simultaneous evidence where present;
10. explanation text that never concludes “not a person,” “keep,” “redact,” or “therefore”;
11. semantic type and routing identical with government evidence disabled/enabled.

## Repository status

No source repository checkout was available to this build environment, so **no production source files, scoring, routing, or test expectations were changed here**. The pack and deterministic builder are ready to be vendored into the repository and wired through the already-established inert reference-evidence surface.

## What this pack can and cannot say

It **can** say: “This phrase is attested government/public-administration terminology according to source X.”

It **cannot** say: “Therefore this phrase is not a person,” nor can it decide whether the phrase denotes an organization, role, place, document, program, or ordinary-English usage in the document being reviewed.
