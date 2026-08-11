# DocScrub Employment / Human Resources Terminology Evidence Pack

## Purpose
Bounded claim: **“This phrase is attested employment/HR terminology according to source X.”**

This pack does **not** claim that the phrase is not a person, organization, place, legal term, government term, or other semantic class. It carries overlapping evidence forward.

## Version
- Pack: `employment_hr`
- Version: `2026-08-10.v1`
- Retrieval/research date: 2026-08-10
- Rows: 267
- Unique normalized terms: 252

## Architecture
The artifact is inert. It contains terminology evidence and provenance only. No row contains a final semantic type, PERSON suppression flag, scoring delta, KEEP/REDACT instruction, or precedence rule.

Normalization is deterministic and conservative:
1. Unicode NFKC
2. Unicode casefold
3. Unicode dash variants -> ASCII hyphen
4. Curly apostrophes -> ASCII apostrophe
5. collapse whitespace
6. exact normalized lookup only

No speculative synonym generation is performed.

## Accepted source families
- OPM: personnel actions; classification/qualification; pay/leave; performance management.
- DOL/WHD: FMLA administration.
- EEOC: EEO, discrimination, accommodation, retaliation and harassment administrative terminology.
- NLRB / FLRA: labor relations, bargaining, representation, grievances, ULPs.
- MSPB: merit-system and employee-relations terminology.
- OSHA: workplace injury/illness recordkeeping terminology.
- EBSA: employee-benefits / ERISA administration terminology.

The source inventory and licensing treatment are in `sources.json`.

## O*NET / SOC decision
O*NET 30.3 is usable under CC BY 4.0, but v1 deliberately does not bulk-import the occupational-title universe. Those titles are valid workforce evidence, yet they would dominate this HR-administration pack with role/title strings and greatly increase name/title collisions. Treat O*NET/SOC as a future separately measured expansion, not silent v1 scope growth.

## Collision analysis
Actual intersections were measured against the currently available DocScrub Census, Legal, Higher Education, and Finance/Accounting/Tax assets.

- Single-token Census intersections: **3**
- Legal intersections: **10**
- Higher Education intersections: **2**
- Finance/Accounting/Tax intersections: **5**
- HIGH-risk rows: **50**

Collision terms are retained. See `collision_report.json`.

Examples of expected ambiguity include ordinary words (`detail`, `grade`, `series`, `appeal`), roles (`participant`, `beneficiary`, `arbitrator`), acronyms (`ADA`, `EEO`, `FMLA`, `PIP`, `PPP`, `SPD`), and cross-domain terms (`adverse action`, `reasonable accommodation`, `grievance`, `arbitration`, `reinstatement`).

## Source/licensing discipline
The production artifact stores short terminology strings plus source metadata; it does not copy federal definitions. Commercial/proprietary HR dictionaries were rejected. Vendor HRIS vocabularies were not ingested. O*NET is recorded as CC BY 4.0 and deferred from bulk ingestion.

## Repository integration
No repository checkout was available in this session, so this deliverable does **not** claim to have modified or tested the live DocScrub source tree. The schema intentionally mirrors the existing terminology packs visible in the DocScrub Library (`term`, `normalized_term`, `semantic_hint`, provenance, source attestation, derived flag, collision risk), making later inert integration straightforward.

## Verification
Run:
```bash
python3 verify_pack.py
python3 build_pack.py
```
The verification guard explicitly rejects the presence of final semantic type, PERSON suppression, score-delta, KEEP/REDACT, or recommendation fields.

## Semantic contract
Can say:
> This phrase is attested employment/HR terminology according to source X.

Cannot say:
> Therefore this phrase is not a person.
