# DocScrub Higher Education Terminology Reference Dataset

Generated: 2026-08-10

## Purpose

This dataset is a deterministic semantic-evidence reference for DocScrub. A match means only that a phrase is attested in higher-education terminology sources. Dictionary membership **does not determine DocScrub's final semantic type**, and the `semantic_hint` field is intentionally coarse.

## Dataset summary

- Total rows: 1,394
- Source-attested rows: 1,218
- Mechanically derived variants: 176
- Unique normalized terms: 1,373
- Collision risk: LOW 1,000; MEDIUM 293; HIGH 101
- Semantic hints:
  - ACADEMIC_CONCEPT: 403
  - DOCUMENT_SYSTEM: 158
  - PROCESS_EVENT: 96
  - ROLE: 129
  - ORGANIZATION: 86
  - OTHER_DOMAIN_TERM: 522
  - AMBIGUOUS: 0

### Rows by source family

- NCES/IPEDS: 728
- NCES/CEDS: 465
- Federal Student Aid glossary: 72
- Public institutional catalog/registrar glossary: 67
- Sector enrollment reporting glossary: 35
- Public institutional registrar glossary: 27

## Source strategy

The dataset uses two federal sources as the main backbone:

1. **NCES/IPEDS Glossary 2025-26.** The current IPEDS glossary is distributed by NCES as a downloadable CSV and supplies standardized postsecondary terms spanning admissions, enrollment, completions, finance, staffing, institutional characteristics, academic calendars, student aid, and related reporting concepts.
   - Source: https://surveys.nces.ed.gov/ipeds/api/downloads/IPEDSGlossary.csv
   - Current survey-material context: https://nces.ed.gov/ipeds/use-the-data/annual-survey-forms-packages-archived

2. **Common Education Data Standards (CEDS) Version 13.** Only elements explicitly associated with the CEDS `Postsecondary` domain were ingested from the current CEDS spreadsheet. Term-specific CEDS URLs are retained where supplied by the source workbook.
   - Source workbook: https://ceds.ed.gov/data/xls/CEDS-V13-with-Extend.xlsx

Targeted operational coverage was then added from:
- Federal Student Aid Handbook Glossary: https://fsapartners.ed.gov/knowledge-center/fsa-handbook/glossary
- UC Berkeley Office of the Registrar Enrollment Glossary: https://registrar.berkeley.edu/enrollment/glossary/
- UT Austin Office of the Registrar Glossary of Catalog Terminology: https://registrar.utexas.edu/catalogs/glossary
- National Student Clearinghouse Compliance Central Glossary: https://help.studentclearinghouse.org/compliancecentral/knowledge-base/glossary/

These targeted additions strengthen registrar, catalog/curriculum, student-record, enrollment-reporting, and financial-aid terminology that may be sparse or phrased differently in the federal standards.

## Provenance and licensing considerations

Every row includes `source`, `source_url`, and `source_family`. CEDS rows retain term-specific URLs when the workbook supplies them.

NCES publications commonly state that information is in the public domain unless specifically noted. Nevertheless, this dataset does not copy source definitions; it records term labels and provenance. Federal Student Aid is also a U.S. Department of Education source, but downstream users should still preserve attribution and verify any source-specific notices if redistributing more than factual term labels.

The non-federal sources should be treated more conservatively. The dataset records only short terminology labels, not glossary definitions or explanatory prose. UC and National Student Clearinghouse materials carry their own copyright notices/terms. Their inclusion here is intended as provenance-backed attestation evidence, not as a claim that their full glossaries are freely redistributable. Before broad external distribution of the reference dataset, legal/licensing review of non-federal rows is advisable.

## Normalization

`normalized_term` is generated deterministically:

1. Unicode NFKC normalization.
2. Normalize smart apostrophes/dashes.
3. Lowercase.
4. Convert `&` to `and`.
5. Replace remaining punctuation with spaces.
6. Collapse repeated whitespace.

The original source form remains in `term`. The normalized value is for matching/deduplication only and should not be displayed as authoritative terminology.

Exact duplicate term/source pairs were removed. Terms attested by different source families may remain as separate provenance rows when appropriate.

## Derived variants

`derived_variant=false` means the row is directly source-attested as a term/element label.

`derived_variant=true` is used only for narrow mechanical transformations of a source-attested parenthetical form, principally:
- stripping a terminal parenthetical acronym/code; or
- extracting that terminal acronym/code as a standalone matching variant.

For example, a source term such as `Satisfactory Academic Progress (SAP)` can produce `Satisfactory Academic Progress` and `SAP`. Notes identify the parent source form and the derivation rule. No free-form synonym expansion was used.

## Semantic hints

`semantic_hint` is assigned by deterministic lexical rules and is intentionally coarse:

- `ORGANIZATION`
- `DOCUMENT_SYSTEM`
- `PROCESS_EVENT`
- `ROLE`
- `ACADEMIC_CONCEPT`
- `OTHER_DOMAIN_TERM`
- `AMBIGUOUS`

The hints are evidence features, not final entity labels. They should be benchmarked against DocScrub's existing person/non-person witnesses and combined with context, extraction behavior, frequency, capitalization, and other signals.

## Collision risk

`collision_risk` is a deterministic warning, not an exclusion criterion.

- `HIGH`: especially generic single words or known ordinary-English/personal-name collisions (for example terms such as `Grant`, `Dean`, `May`, `Major`, `Section`, or `Spring`).
- `MEDIUM`: acronyms/codes, short multiword phrases containing collision-prone tokens, and some name-like financial-aid terminology.
- `LOW`: phrases with relatively specific higher-education lexical context.

Collision-prone terms are deliberately retained because they can still supply useful weak evidence when DocScrub has surrounding context.

## Coverage

The combined sources cover admissions, applicants, enrollment and registration, student records, grades, academic standing, courses and sections, curriculum/catalog concepts, degrees and credentials, majors/minors/concentrations, academic calendars and terms, transfer/completion concepts, financial aid, federal student-aid administration, institutional organization and roles, reporting files and systems, and a broad set of postsecondary data elements.

The dataset is intentionally not tailored to a single DocScrub test document.

## Limitations

- It is U.S.-centric and especially strong on federal reporting/Title IV terminology.
- CEDS element names can be system/data-model phrases rather than phrases commonly seen in prose; this is intentional but should be weighted accordingly.
- Institutional terminology varies widely (`withdrawal`, `cancellation`, `drop`, `term`, `session`, etc.).
- Some acronyms are highly ambiguous outside higher education.
- Source inclusion does not imply semantic uniqueness; many terms are ordinary English.
- The heuristic `semantic_hint` and `collision_risk` fields should be benchmarked before production use.
- This version does not include exhaustive vendor-specific SIS vocabulary (PeopleSoft, Banner, Workday Student, Colleague) because the goal is a vendor-neutral reference and licensing/provenance is less straightforward.
- This version does not ingest entire copyrighted professional standards/taxonomies where redistribution terms were unclear.

## Recommended benchmark use

Treat a terminology hit as one feature: “this phrase is attested higher-education terminology.” Benchmark source-attested and derived rows separately, and measure false-person suppression particularly for `HIGH` and `MEDIUM` collision-risk terms. Consider source-family weighting so federal standards, operational registrar glossaries, and derived acronyms do not contribute identical evidence strength.
