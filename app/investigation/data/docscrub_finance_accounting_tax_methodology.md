# DocScrub Finance / Accounting / Tax Terminology Pack — Methodology

## Purpose

This artifact is a deterministic semantic-evidence pack for DocScrub. Its bounded claim is: **“this phrase is attested finance/accounting/tax terminology.”** It is not a classifier, blacklist, PII detector, tax/financial advice system, or inference engine about a person's actual finances.

Physical artifact identity: `FinanceAccountingTaxEvidence`. The CSV keeps an explicit `source_domain` (`FINANCE`, `ACCOUNTING`, or `TAX`) plus `source_family`, so downstream evidence traces can distinguish IRS tax evidence, SEC securities evidence, Treasury/USSGL accounting evidence, CFPB consumer-finance evidence, and other authorities without shipping three separately maintained files.

## Research date and source strategy

Research checked current public sources on 2026-08-10. Federal/public sources were preferred over commercial dictionaries. Principal included families:

- IRS: Understanding Taxes glossary; Forms/Instructions; Form 1040 schedules; employment-tax guidance; Publication 551 basis terminology.
- SEC / Investor.gov: investor glossary, EDGAR/form terminology, and the SEC beginner guide to financial statements.
- CFPB: public financial-terms and mortgage key-term glossaries.
- CFTC: Futures Glossary.
- Federal Reserve: banking/market and acronym glossaries, plus payments terminology.
- FDIC: EDIE deposit-insurance glossary and BankFind terminology.
- U.S. Treasury Bureau of the Fiscal Service: U.S. Standard General Ledger (USSGL) accounting framework and selected account titles.

The dataset is intentionally practical rather than exhaustive. It does not attempt to ingest every possible XBRL element, every IRS form, every CFTC glossary entry, or every USSGL account.


## Source and licensing status summary

| Source family | Included in CSV? | Status / treatment |
|---|---:|---|
| IRS | Yes | U.S. federal tax authority; used for terminology and form/schedule names. Definitions are not copied. |
| SEC / Investor.gov | Yes | U.S. federal securities authority; public glossary and filing terminology used. Definitions are not copied. |
| CFPB | Yes | U.S. federal consumer-finance authority; public glossary/key-term terminology used. |
| CFTC | Yes | U.S. federal derivatives authority; public Futures Glossary terminology used. |
| Federal Reserve | Yes | Federal Reserve public glossaries/acronyms/payments terminology used. |
| FDIC | Yes | Federal deposit-insurance/banking terminology used from public glossaries. |
| Treasury USSGL | Yes | Federal accounting chart/framework used for accounting concepts and selected account titles. |
| FASB GAAP Taxonomy | No bulk ingest | Copyrighted; authorized-use conditions and third-party components apply. Source reviewed, but taxonomy not copied wholesale. https://www.fasb.org/projects/fasb-taxonomies/gaap-financial-reporting-taxonomy |
| GASB pronouncements | No | Financial Accounting Foundation copyright notices apply; some materials include third-party copyrighted content. https://www.gasb.org/standards-and-guidance/pronouncements |
| AICPA/CIMA standards/site content | No | Copyright/permission controlled; proprietary standards were not scraped. https://www.aicpa-cima.com/help/terms-and-conditions |
| Commercial dictionaries/tax products | No | Rejected in favor of authoritative public sources and to avoid redistribution ambiguity. |

## Licensing / copyright treatment

Federal agency webpages and federal-source terminology were used as the primary redistributable evidence base. The pack stores short terminology strings and provenance URLs; it does **not** reproduce source definitions.

### Restricted / conservatively excluded sources

- **FASB / GAAP Financial Reporting Taxonomy:** researched but not bulk-copied. FASB's taxonomy materials carry copyright and an Authorized Uses regime; some uses are royalty-free, but conditions and third-party components apply. Because DocScrub needs a low-friction redistributable evidence pack, this build does not ingest the taxonomy wholesale.
- **GASB:** not used as a bulk vocabulary source in this build. Public accessibility was not treated as blanket redistribution permission.
- **AICPA/CIMA:** excluded as a vocabulary source because site/standards content is copyrighted and permission-controlled; no proprietary standards were scraped.
- **Commercial financial dictionaries / tax products:** rejected in favor of public authorities.

These sources may still be useful as non-redistributed validation references in future research, subject to license review.

## Row model and provenance

The CSV is an **evidence-record table**. A normalized phrase can have more than one row when multiple authorities or domains attest it. This is deliberate: e.g., `basis` can retain IRS tax evidence and CFTC futures-market evidence independently. Exact duplicate evidence records from the same source are removed.

Minimum requested fields are present, plus: `source_domain`, optional `source_id`, `acronym`, and `acronym_expansion`.

`source_attested=true` means the displayed/source form was taken from or directly attested by the cited source family. `derived_variant=true` rows are explicitly non-source-attested mechanical variants and link to `parent_term`.

## Normalization policy

`normalized_term` is produced deterministically:

1. Unicode NFKC normalization.
2. Normalize curly apostrophes/quotation marks to ASCII equivalents.
3. Normalize Unicode dash/minus variants to ASCII hyphen.
4. Unicode case-fold.
5. Collapse internal whitespace to one ASCII space and trim ends.
6. **Do not remove punctuation, tokenize, stem, lemmatize, fuzz-match, or synonym-expand.**

Therefore `Form 10-K` and `Form 10K` do not become equal through normalization alone. When a punctuation/hyphenation alternate is judged mechanically safe, it is emitted as an explicit `derived_variant` row.

## Semantic hints

Hints are intentionally coarse and non-exclusive in spirit: `FINANCIAL_CONCEPT`, `ACCOUNTING_CONCEPT`, `TAX_CONCEPT`, `DOCUMENT`, `PROCESS_EVENT`, `ACCOUNT_TYPE`, `FINANCIAL_INSTRUMENT`, `ROLE`, `ORGANIZATION`, `REGULATORY_TERM`, and `OTHER_DOMAIN_TERM`. They are lookup hints, not ontology claims.

## Acronyms

Acronym/expansion pairs are included only where the source family attests the relationship. Acronym rows never imply a globally unique meaning. Examples such as `APR`, `ETF`, `FUTA`, `FCM`, and `ACH` remain evidence local to the cited source/domain.

## Collision analysis

`collision_risk` is a conservative lexical flag (`LOW`, `MEDIUM`, `HIGH`), not a deletion rule. High-risk examples include short/common words such as `basis`, `interest`, `trust`, `note`, `security`, `margin`, `position`, and `appeal`. Notes flag obvious cross-domain issues such as legal/document overlap (`Schedule`, `Form`, `trust`, `settlement`), higher-ed lexical overlap, or medical overlap (`Medicare`).

Valid finance/accounting/tax terminology is retained even when another evidence pack may also match it. Downstream routing should compare evidence channels rather than treat membership as dispositive.

## Counts

- Source-attested evidence rows: **690**
- Source-attested unique normalized terms: **631**
- Derived variants: **20**
- Normalized unique terms including derived variants: **651**
- Acronym/expansion pairs: **37**
- Cross-domain normalized-term overlaps: **16**

### Source-attested terms by domain

- ACCOUNTING: 92
- FINANCE: 451
- TAX: 147

### Source-attested rows by semantic hint

- FINANCIAL_CONCEPT: 158
- TAX_CONCEPT: 88
- DOCUMENT: 82
- FINANCIAL_INSTRUMENT: 77
- ACCOUNTING_CONCEPT: 71
- PROCESS_EVENT: 61
- ACCOUNT_TYPE: 44
- ROLE: 40
- ORGANIZATION: 35
- REGULATORY_TERM: 34

### Source-attested rows by source family

- IRS: 147
- SEC_INVESTOR_GOV: 142
- CFPB: 118
- CFTC: 87
- TREASURY_USSGL: 59
- SEC: 56
- FEDERAL_RESERVE: 55
- FDIC: 26

### Collision-risk counts (all rows)

- HIGH: 138
- LOW: 393
- MEDIUM: 179

### Cross-domain overlaps

- `account balance` — ACCOUNTING, FINANCE
- `annual report` — ACCOUNTING, FINANCE
- `basis` — FINANCE, TAX
- `capital gain` — FINANCE, TAX
- `capital loss` — FINANCE, TAX
- `credit` — ACCOUNTING, FINANCE
- `depletion` — ACCOUNTING, TAX
- `depreciation` — ACCOUNTING, TAX
- `direct deposit` — FINANCE, TAX
- `earned income` — FINANCE, TAX
- `earnings per share` — ACCOUNTING, FINANCE
- `filing` — FINANCE, TAX
- `gross income` — FINANCE, TAX
- `interest` — FINANCE, TAX
- `net income` — ACCOUNTING, FINANCE
- `tax` — FINANCE, TAX


## Rejected-source notes

- No commercial financial dictionary was scraped.
- No proprietary AICPA standards vocabulary was copied.
- No FASB/GASB standards corpus was silently converted into a redistributable word list.
- No model-generated synonym expansion was used.
- No terminology was optimized against the Higher Education witness/test document.

## Major gaps / next research candidates

1. **State/local tax:** this build stays mostly federal. A later state-tax extension could use selected state revenue departments, but would need jurisdiction tagging to avoid making state-specific language look universal.
2. **Insurance:** only finance-adjacent insurance concepts present in SEC/CFPB material are represented. A separate authoritative insurance-regulatory source (e.g., state DOI/NAIC subject to license review) could deepen this area.
3. **Corporate treasury / cash management:** Federal Reserve/CFPB coverage helps, but specialized corporate-treasury workflow terminology remains thinner than securities and consumer finance.
4. **Accounting workflow:** journal/general-ledger and federal USSGL concepts are represented, but private-sector close/consolidation terminology could be broadened from permissively reusable public sources without importing proprietary GAAP text.
5. **Tax forms:** representative high-frequency IRS forms/schedules are included, not the complete IRS forms universe.
6. **XBRL:** SEC filing-document terminology is included; the FASB GAAP taxonomy was not bulk-ingested because of its copyright/authorized-use conditions.

## Integration constraint

No production DocScrub routing or scoring changes are included. This pack is intended to be frozen and benchmarked against witness populations before any integration decision.
