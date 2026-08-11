# Employment / Human Resources Terminology Evidence — Integration Findings

**Date:** 2026-08-10
**Status:** Shipped, inert. No production classifier, scorer, gate or router consumes it.
**Pack:** `docscrub-employment-hr-terminology/2026-08-10` — 267 attestation rows over 252 normalized keys.

---

## 1. The semantic boundary

Employment/HR evidence establishes only that a phrase is **attested employment/HR terminology
according to identified sources**. It does not establish that the phrase is or is not a person,
organization, place, legal term, government term, or any other final semantic type.

A phrase may simultaneously carry Census name evidence, GNIS place evidence, and legal, higher-ed,
finance, medical, government and employment/HR terminology evidence. Those overlaps are preserved
and are not resolved anywhere in this work.

---

## 2. What the repository already had, and what was reused

By the time this pack arrived the tree had converged on a shared shape, so the integration is
almost entirely reuse:

| Existing thing | Used how |
|---|---|
| `engines/knowledge/DomainReferenceEvidence.ts` | The substrate. Row model, index build, lookup, explanation wording — all shared. One union member added. |
| `scripts/generate_domain_terminology_pack.py` | One `PACKS` entry added. No new generator script. |
| `engines/knowledge/ReferenceEvidence.ts` | The fan-out. One import, one field, one `terminologyChannelsOf` case, one audit-row block. |
| `Workspace.getReferenceEvidence()` | A generic per-candidate collection point that landed from concurrent pack work. Employment/HR joined it **for free** — no edit to `Workspace.ts`. |
| `__docscrub.channels()` | A family-agnostic console diagnostic, also concurrent. Picks up the new family with **no edit to `app.ts`**. |

Higher-ed and Medical were left on their own pre-substrate record shapes, per their own documented
decisions. Nothing belonging to another pack was refactored.

**Note on the generator:** regenerating the *finance* asset now produces a comment-only diff against
the shipped file — a concurrent edit revised its `collision_blurb` after the asset was last built.
The shipped finance asset was restored byte-identical and left alone; that is that pack's call, not
this one's. Legal regenerates byte-identical.

---

## 3. Files

**Added**

```
investigation/data/docscrub_employment_hr_terms.csv                    (versioned source, 267 rows)
investigation/data/docscrub_employment_hr_methodology.md               (source methodology)
investigation/data/docscrub_employment_hr_source_collision_report.json (the pack's own pre-measured overlaps)
src/engines/knowledge/employment-hr-terminology.data.ts                (GENERATED runtime asset)
src/engines/knowledge/EmploymentHrEvidence.ts                          (provider)
verify/employment-hr-evidence-verification.ts                          (247 assertions)
investigation/employment-hr-overlap.ts                                 (collision harness)
20260810-employment-hr-terminology-evidence-findings.md                (this file)
```

**Modified**

```
scripts/generate_domain_terminology_pack.py        + PACKS["employment_hr"], + licensing side table,
                                                   + `consumer` config key (replaces a hardcoded ternary)
src/engines/knowledge/DomainReferenceEvidence.ts   + one member on DomainReferenceFamilyId
src/engines/knowledge/ReferenceEvidence.ts         + one channel (import, field, call, view case, audit block)
```

No scoring, detection, review, routing, recommendation or UI module was modified.

---

## 4. Representation

`DomainReferenceEvidence<"employment-hr-terminology">` — the shared record. Per lookup:
every attesting row (term as the source wrote it, semantic hints, sub-domain, source name, URL,
source family, authority level, source-attested flag, derived-variant flag, parent term, collision
risk, acronym pair, notes), plus `multiplyAttested`, `sourceFamilies`, `subDomains`, `semanticHints`,
`highestCollisionRisk` and `tokenCount`.

A miss returns `null`. There is deliberately no "empty evidence" object, because an empty object
invites being read as a negative finding.

**Provenance the shared row model has no column for** — `source_tier`, `license_status`,
`retrieval_date` — is constant per source family (the generator asserts it) and ships as a side
table, `employmentHrSourceLicensing()`, rather than being folded into `notes`. Folding it in would
have rewritten provenance prose the source wrote and put licensing text in a field reviewers read
while judging a candidate.

The CSV's own pre-measured overlap columns (`census_attested`, `legal_overlap`, …) are **not**
ingested. They are a snapshot of someone else's measurement against a different tree; §7 re-measures
against the live assets instead, which is the number that can't go stale.

---

## 5. Normalization

Six deterministic steps, reproducing the source methodology exactly:
NFKC → curly quotes/apostrophes to ASCII → Unicode dashes to ASCII hyphen → casefold → collapse
whitespace and trim → exact normalized lookup. Punctuation is otherwise preserved, so `401(k) plan`,
`SF-50` and `12-month period` survive as written.

This is byte-for-byte the Finance policy, arrived at independently, and is **implemented separately
anyway**. Two methodologies agreeing today is a measured fact, not a shared dependency: giving them
one normalizer would mean a future revision of either methodology silently changing what the other
family means. The generator re-derives `normalized_term` from `term` in Python and asserts equality
on every row — **267/267** — and the suite re-derives every shipped key through the TypeScript
implementation, so the two cannot drift silently.

Not done, anywhere: fuzzy matching, edit distance, stemming, lemmatization, substring matching,
token reordering, plural generation, guessed abbreviation expansion, synonym invention, LLM
expansion.

---

## 6. The O*NET decision, carried into the code

O*NET 30.3 is CC BY 4.0 and usable, and was deliberately not bulk-ingested in v1: importing the
occupational-title universe would turn an HR-*administration* vocabulary into a role/title
dictionary, and job titles collide with personal names far more aggressively than administrative
terminology does. That reasoning is recorded in `EmploymentHrEvidence.ts`'s header rather than only
in the methodology, because the tempting future change — "the pack is small, add the titles" — is
one whose cost lands on person detection, not on that module.

---

## 7. Collision measurement (re-measured against live assets)

Run: `node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs investigation/employment-hr-overlap.ts`

Each comparison runs through the target pack's **own public API**, never a raw key comparison,
because the normalization policies deliberately differ.

| Family | Intersections | Single-token | HIGH risk | Acronyms |
|---|---|---|---|---|
| Higher education | 3 | 0 | 0 | 0 |
| Finance / accounting / tax | 5 | 4 | 4 | 1 |
| Legal | 10 | 8 | 8 | 0 |
| Medical | 4 | 3 | 3 | 3 |
| Government / public admin | 9 | 4 | 3 | 0 |
| Census (all tokens name-attested) | 18 | 3 | 3 | — |
| GNIS places | 0 | 0 | 0 | 0 |

- **Legal (10):** appeal · appellant · arbitration · arbitrator · beneficiary · harassment · reasonable accommodation · retaliation · transfer · undue hardship
- **Finance (5):** appeal · arbitration · beneficiary · Employee Retirement Income Security Act · ERISA
- **Higher-ed (3):** 12-month period · credit hours · position title
- **Medical (4):** ADA · FMLA · PEP · sick leave
- **Government (9):** accession · General Schedule · grade · job grading · pay system · position classification · qualification requirements · retirement · series
- **Census single-token (3):** ADA · ERISA · grade

35 of 252 terms carry at least one other family's evidence. The pack's own report predicted census 3,
legal 10, higher-ed 2, finance 5; the live measurement agrees except higher-ed, where 3 rather than 2
terms hit because this tree's higher-ed asset also attests `12-month period`.

**These are measurements of semantic ambiguity, not defects.** Nothing was removed to improve any
number, and nothing was tuned toward the test document. Government/public admin overlapping most is
expected and is not duplication: OPM/MSPB/FLRA terminology also attested by a government-wide
administrative source is *two independent attestations of one phrase*, which is exactly what the
combination layer will want to weigh.

`grade` is the term to remember. It is OPM classification terminology, government terminology, and a
Census-attested surname, all correct at once. One `Grade` is enough to sink any rule that reads
terminology membership as evidence against personhood.

---

## 8. Verification

`verify/employment-hr-evidence-verification.ts` — **247 assertions, 247 passed, 0 failed.**

1. Generated asset — counts, 13-field rows, sorted keys, 15 multiply-attested keys, licensing table
2. **Normalization parity over all 267 rows** — every shipped term re-derives its own key
3. Normalization rules — casefold, whitespace, four dash variants, curly apostrophe, NFKC, punctuation preserved
4. Straightforward HR terminology — the six named examples plus source family, sub-domain and full provenance per hit
5. **Multi-token exactness** — `annual`, `leave`, `plan`, `agreement`, `bargaining`, `accommodation` are *not* attested by containment; word order is not rearranged; `collective bargaining` is attested on its own two rows, independently
6. Acronyms — FMLA, EEO, ADA, PIP, ERISA, SPD: attested, HIGH-flagged, recorded as acronyms, **no expansion invented**, ambiguity intact; `FLSA` is not inferred; `SF50` does not match `SF-50`
7. Multiple provenance — grievance (NLRB + FLRA), adverse action (EEOC + MSPB), FMLA (DOL + OPM), CBA (FLRA + NLRB): both rows, both families, both sub-domains, distinct URLs, disagreeing hints listed not resolved
8. Aggregator and audit trail — channel exposed, uniform view, one flat self-contained audit row per attestation
9. **Collision behaviour** — HR + Census, HR + Legal (all 10), HR + Finance, HR + Higher-ed, HR + Medical: both facts survive in every case
10. Negative witnesses — plurals, typos, v1 gaps, occupational titles, ordinary language, empty string
11. **Architectural invariance** (below)
12. Explanation wording — observation never verdict; collision warning surfaced, not hidden

---

## 9. Architectural invariance — the assertion that matters

Employment/HR membership has **no independent effect** on PERSON determination, semantic type,
review routing, recommendation, Keep/Rename/Redact/Ignore state, or candidate score.

This is asserted **structurally**, and deliberately. A behavioural assertion ("flip the flag, the
type is unchanged") needs a flag to flip — that is, it needs the evidence plumbed into the
classifier's input in order to prove it is ignored. Higher-ed and Medical each did that, as a
reviewed decision with a stated purpose. Employment/HR follows Legal and Finance instead, which
makes a stronger statement available:

- `EmploymentHrEvidence.ts` is imported by **exactly one** module: the read-only fan-out
- the generated asset is read by **exactly one** module: its provider
- the fan-out has **exactly two** consumers: the inert `Workspace` collection point and the console diagnostic
- `getReferenceEvidence()` has **exactly one** caller: the diagnostic
- `SemanticTypeFacts` has no employment/HR field; scoring, the residual gate and recommendations never mention the family
- the fact matrix through `semanticTypeFor` / `typeCheckSectionFor` is byte-identical even when the fact is smuggled in as an extra property

A future change that imports this family into scoring, detection, review or routing — directly, or
by growing a third consumer of the collection point — fails this suite. That is not a ban on ever
consuming the evidence. It is a requirement that doing so be a deliberate, reviewed change rather
than a quiet import.

---

## 10. Regression

- **TypeScript typecheck (`tsc --noEmit`):** clean
- **Production build (`tsc`):** clean
- **All 78 verification / parity / smoke suites:** pass, 0 failures, including every other evidence family's suite (census 111, GNIS 105, higher-ed 101, medical 204, legal 134, finance 119, cross-family reference 56)
- **No existing verification expectation was weakened, relaxed or edited.**

---

## 11. What was deliberately not done

- No combination or precedence policy between any evidence families
- No `mostLikelyType`, no weighting, no tie-break, no summary boolean
- No suppression of PERSON detection, no semantic-type change, no score delta, no routing change
- No removal of ambiguous or collision-prone terms
- No LLM-generated synonyms, and no tailoring to any test document
- No refactor of higher-ed, medical, census or GNIS
- No claim about whether an HR term near a person's name says anything about that person
