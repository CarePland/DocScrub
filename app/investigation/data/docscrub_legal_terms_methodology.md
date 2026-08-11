# DocScrub Legal Terminology Evidence Pack — Methodology

**Dataset version:** 2026-08-10  
**Purpose:** deterministic semantic evidence only. A match means *“this phrase is attested legal terminology (or a conservatively derived form of an attested term)”*. It is not a blacklist, PII list, classifier, or routing rule.

## Deliverables and counts

- Unique source-attested terms: **428**
- Derived variants: **17**
- Unique normalized terms: **445**
- Total rows: **445**

### Counts by semantic hint

- AMBIGUOUS: 1
- COURT_PROCEDURE: 99
- DOCUMENT: 108
- IDENTIFIER_TYPE: 4
- LEGAL_CONCEPT: 213
- ORGANIZATION: 23
- OTHER_DOMAIN_TERM: 26
- PROCESS_EVENT: 55
- ROLE: 64

### Counts by source family (source-attested rows)

- DOJ_GLOSSARY: 10
- FEDERAL_APPELLATE_COURT: 6
- FEDERAL_BANKRUPTCY_BILLING: 6
- FEDERAL_BANKRUPTCY_COURT: 5
- FEDERAL_COURT_EFILING: 8
- FEDERAL_DISTRICT_COURT_ADR: 8
- FEDERAL_DISTRICT_COURT_PROCEDURE: 7
- FEDERAL_JUDICIARY_GLOSSARY: 206
- FEDERAL_REGULATOR_EMPLOYMENT: 6
- FEDERAL_REGULATOR_IP: 44
- FEDERAL_REGULATOR_PRIVACY_SECURITY: 14
- FEDERAL_REGULATOR_SECURITIES: 46
- STATE_JUDICIARY_GLOSSARY: 54
- STATE_JUDICIARY_PROBATE: 6
- STATE_JUDICIARY_PROCEDURE: 6

### Collision-risk distribution

- HIGH: 81
- LOW: 247
- MEDIUM: 117

## Architecture

Each row preserves a source-attested display form and a deterministic normalized form. `source_attested=true` means the term itself was observed in the cited official source. `derived_variant=true` means the row was mechanically derived from a source-attested parent and the parent is named in `parent_term`.

Multiple independent attestations are merged into one row where the normalized term is the same; source names, URLs, families, and authority labels are retained as pipe-separated provenance. This avoids turning the pack into a generic undifferentiated “dictionary hit.”

A downstream evidence claim can therefore retain a path such as:

`source family -> source URL -> attested term -> normalized match -> LegalEvidence claim -> later semantic interpretation`

No DocScrub production integration or routing decision is included here.

## Controlled semantic hints

The pack uses only these coarse hints:

- `ORGANIZATION`
- `ROLE`
- `DOCUMENT`
- `PROCESS_EVENT`
- `LEGAL_CONCEPT`
- `COURT_PROCEDURE`
- `IDENTIFIER_TYPE`
- `OTHER_DOMAIN_TERM`
- `AMBIGUOUS`

A row may carry more than one hint separated by `|` when the attested term genuinely spans coarse categories. Hints are deliberately non-final: they describe useful evidence, not a classification verdict.

## Collision analysis

`collision_risk` is `LOW`, `MEDIUM`, or `HIGH`.

High-risk examples include ordinary English (`answer`, `brief`, `file`, `record`, `motion`), common surnames or name-like forms (`Doe`, `Judge`, `Levy`), generic organizational/role language (`court`, `counsel`, `neutral`), and acronyms with strong non-legal meanings (`NDA`, `AO`, `NOA`). Legitimate legal terms are retained rather than deleted; ambiguity is represented explicitly.

This is intentional for DocScrub: a legal attestation should be one evidence channel that can compete or combine with CensusNameEvidence, GnisPlaceEvidence, HigherEdEvidence, and future domain packs.

## Deterministic normalization policy

1. Apply Unicode NFKC.
2. Map curly single/double quotation marks to ASCII quotes.
3. Map en dash, em dash, and Unicode minus to ASCII hyphen.
4. Apply Unicode `casefold()`.
5. Collapse whitespace runs to one ASCII space and trim ends.
6. Remove spaces immediately around `/` and `-`.
7. Preserve all other punctuation, digits, parentheses, apostrophes, and word order.
8. Do **not** stem, lemmatize, fuzzy match, reorder tokens, or invent synonyms.

This deliberately favors precision and traceability over recall. For example, `motion for summary judgment` does not automatically match a reordered or approximate phrase.

## Derived variants

Derived rows are conservative and provenance-preserving. Current derivations are limited to:
- explicit acronyms/abbreviations present in source forms or definitions;
- an explicit alias (`no contest`, `341 Meeting`);
- simple punctuation variants such as hyphen removal/addition.

No synonym is created from model intuition. Pure capitalization variants are generally unnecessary because normalization already casefolds them.

## Sources used

Primary authoritative sources:
- U.S. Courts / Administrative Office: federal legal glossary.
- U.S. Department of Justice: Justice 101 legal glossary.
- U.S. Court of Appeals for the Ninth Circuit: federal/appellate glossary.
- U.S. Bankruptcy Court, District of Nevada: bankruptcy terminology.
- PACER / CM/ECF: federal e-filing and docket terminology.
- U.S. District Court, Northern District of California: filing-under-seal and ADR/settlement terminology.
- U.S. Bankruptcy Court, Western District of Texas: professional compensation/retainer terminology.
- U.S. Securities and Exchange Commission: capital-formation and securities terminology.
- U.S. Patent and Trademark Office: patent/trademark terminology.
- Federal Trade Commission: Safeguards Rule privacy/security terminology.
- U.S. Equal Employment Opportunity Commission: employment-discrimination terminology.
- California Courts / California superior-court self-help glossaries: civil procedure, discovery, and probate terminology.

The CSV preserves the exact URL(s) used for each row.

## Licensing and provenance caveats

Federal executive-agency material is generally a work of the U.S. Government and therefore not subject to U.S. copyright under 17 U.S.C. § 105; DOJ also expressly states that, unless otherwise indicated, information on DOJ websites is public domain and may be copied and distributed. The pack nevertheless stores terms and provenance, not copied source definitions.

State judiciary pages are treated more conservatively. The pack records short factual terms attested on those pages and does **not** reproduce their glossary definitions. State-site copyright and reuse policies can differ by jurisdiction, so downstream redistribution should continue to retain attribution/provenance and avoid copying expressive definitions unless separately cleared.

The Legal Information Institute (Cornell) was researched but **not used as a dataset source** because its LII compilations are licensed with attribution, noncommercial, and share-alike conditions; that is a poor fit for an unrestricted commercial DocScrub reference pack.

Commercial dictionaries/taxonomies (for example Westlaw/Practical Law, Lexis, Bloomberg Law, Black's Law Dictionary) were not scraped or imported.

## Sources rejected / not incorporated

- **Cornell LII/Wex compilations:** useful secondary reference, but the published LII compilation license includes noncommercial/share-alike restrictions. Rejected for pack ingestion.
- **Commercial legal dictionaries and taxonomies:** proprietary; rejected absent an explicit redistribution license.
- **Search-result snippets from commercial practice guides:** rejected as provenance even where they confirmed familiar terminology.
- **Archived or superseded government manuals:** generally avoided where current glossaries or court pages supplied equivalent evidence.
- **Definitions from state-court glossaries:** not copied; only the factual term labels are retained.
- **Broad financial glossaries:** not imported wholesale. SEC terms were selected where they are useful in legal/corporate/securities documents, to avoid swallowing the future FinanceTaxEvidence channel.

## Coverage notes and gaps

This is a broad practical **v1 evidence pack**, not an ontology of American law. Strongest coverage is federal litigation/court procedure, bankruptcy, securities/capital formation, IP prosecution, basic employment discrimination, privacy/security compliance, California civil procedure, e-filing/docket language, ADR, and a small legal-billing slice.

Material gaps intentionally left for later expansion or a second legal-pack pass include:
- deeper contracts drafting vocabulary (representations, warranties, covenants, indemnities, conditions precedent, boilerplate clauses);
- M&A and corporate-governance documents beyond capital formation;
- state-by-state family law and probate vocabulary;
- real-estate transactional instruments and land-record terminology;
- labor relations/NLRA terminology;
- tax controversy (best coordinated with FinanceTaxEvidence);
- immigration;
- environmental law;
- healthcare regulatory law;
- antitrust;
- detailed privacy regimes outside the FTC/GLBA slice;
- legal matter-management and billing codes (e.g. proprietary UTBMS/LEDES taxonomies require separate licensing review);
- court-specific docket-event vocabularies at scale;
- common Latin maxims beyond terms directly present in the selected official glossaries.

## Benchmarking recommendation

The next step should be exactly the frozen-witness benchmark described for DocScrub. Measure this pack independently first:

1. exact normalized hits against frozen person witnesses;
2. exact normalized hits against frozen non-person witnesses;
3. collision review by risk tier and semantic hint;
4. source-family contribution analysis;
5. only after those results, decide whether and how `LegalEvidence` participates in interpretation/routing.

Do not tune the vocabulary against the witness set before recording the baseline. The witness benchmark should evaluate this finished pack, not silently reshape it.
