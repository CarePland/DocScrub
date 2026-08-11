# Domain reference evidence

Status: canonical
Last updated: 2026-08-10

How DocScrub represents deterministic terminology reference packs, what a
match from one of them means, and — more importantly — what it does not mean.

This document covers the **Finance / Accounting / Tax** and **Legal** packs
and the shared substrate they introduced. Higher-education and medical
terminology are the same kind of evidence and obey the same contract; they
predate the substrate and keep their own module shapes for now (see
*Coexistence*, below).

## 1. What a match means

A domain reference pack answers exactly one question about a phrase:

> Is this phrase attested terminology in domain X?

A hit licenses exactly one sentence:

> "This phrase is attested finance/accounting/tax terminology."
> "This phrase is attested legal terminology."

That is the whole claim.

## 2. What a match does NOT mean

This is the load-bearing half of the contract.

**A hit does not mean "not a person."** The Legal pack contains `Doe`,
`Judge`, `Levy`, `answer`, `brief` and `record`. The Finance pack contains
`basis`, `margin`, `security`, `stock`, `gain` and `loss`. Measured against
the shipped Census asset: 52 of 445 legal terms and 61 of 651 finance terms
are Census-attested personal-name tokens in *every* token. Reading membership
as a person-suppressor reintroduces the exact failure the Census experiment
already measured and rejected, and the GNIS benchmark measured again — 7 of 7
single-token GNIS place hits on the live document were real people.

**A hit does not mean "organization," or any other type.** `semantic_hint` is
a coarse lookup hint assigned by lexical rule. Both source methodologies say
so directly: "evidence features, not final entity labels" / "hints, not final
DocScrub types." `ROLE` must not map to Person, `ORGANIZATION` must not map to
Organization, `DOCUMENT` must not map to non-Person.

**A hit does not mean the document contains financial or legal facts about
anyone.** This matters most for the finance pack, which names a sensitive
subject. `adjusted gross income` and `Schedule C` are *vocabulary*. Their
presence is evidence that a document uses financial language, and nothing
whatever about whose finances, or whether any finances are described at all.
DocScrub must never report or route on "this document contains someone's
financial information" because a terminology lookup matched.

**A miss does not mean "not domain language."** Every pack is an explicitly
partial v1 vocabulary with documented gaps — state and local tax, insurance,
corporate treasury, contracts drafting, M&A, family law, immigration,
antitrust. `condition precedent` and `force majeure` are real legal terms and
both miss. Absence of evidence is never evidence of absence, and no caller may
read a miss as counter-evidence.

**HIGH collision risk is a warning carried forward,** never an exclusion and
never a strengthener. Both source methodologies retain collision-prone terms
deliberately. Two facts stay separately available — *legal evidence exists*
AND *collision risk is high* — because suppressing the first would destroy the
signal a combination layer needs in order to see a conflict at all.

## 3. Provenance is the feature

Membership is never reduced to `dictionaryHit: true`. Each attesting row
carries its whole determination path:

```
source family -> source (+ URL) -> attested term -> normalized key
              -> evidence family -> claim
```

Concretely, for `adjusted gross income`:

| field | value |
|---|---|
| evidenceFamily | `finance-accounting-tax` |
| subDomain | `TAX` |
| sourceFamily | `IRS` |
| source | IRS Understanding Taxes – Glossary |
| sourceUrl | `https://apps.irs.gov/app/understandingTaxes/student/glossary.jsp` |
| sourceAuthorityLevel | `US_FEDERAL_TAX_AUTHORITY` |
| matchedTerm | `adjusted gross income` |
| normalizedTerm | `adjusted gross income` |
| semanticHints | `TAX_CONCEPT` |
| sourceAttested / derivedVariant | `true` / `false` |
| collisionRisk | `MEDIUM` |

**Every attesting row survives lookup.** A normalized phrase may be attested
by several authorities and which ones is the interesting part: `interest` is
attested by the CFPB, FDIC and SEC as FINANCE and by the IRS as TAX — four
rows, four authorities, two sub-domains, all retained. `Default judgment` is
attested by both the federal judiciary and a California superior court.
Corroboration across independent source families is precisely what both
methodologies recommend weighting, so picking one row here would resolve a
question this layer is not entitled to resolve.

**Source-attested and derived rows stay distinguishable.** A derived variant
is a mechanical transformation of an attested form — an acronym extraction, a
punctuation variant, an explicit alias — and names its parent. `ADR` is a
derived form of `Alternative dispute resolution (ADR)`; `cost-basis` is a
derived form of `cost basis`. Derived rows have weaker provenance and callers
are told so rather than having it silently folded in.

**Sub-domain is preserved** where a pack distinguishes one. Finance rows carry
`FINANCE` (467), `TAX` (151) or `ACCOUNTING` (92), so an evidence trace can
say "IRS tax terminology evidence" or "Treasury/USSGL accounting terminology
evidence" rather than flattening everything into "business terminology." 16
terms are attested in more than one sub-domain and both readings survive.

## 4. Normalization

Deterministic, exact, locale-independent, lookup-only. No fuzzy matching, no
edit distance, no stemming, no lemmatization, no singular/plural folding, no
synonym expansion, no token reordering, no model inference.

**Each pack ships its own normalizer, and this is deliberate.** The policies
differ because the source methodologies differ, and the differences are forced
by the data:

| pack | policy |
|---|---|
| finance | NFKC · quotes/dashes → ASCII · casefold · collapse whitespace. **Punctuation preserved** |
| legal | as finance, **plus** spaces removed around `/` and `-` |
| higher-ed | every non-alphanumeric run → SPACE |
| medical | punctuation-preserving (see its own module) |
| census | punctuation stripped to nothing (single-token keys) |
| GNIS | punctuation → SPACE, accent-folded, uppercased |

Finance preserves punctuation because the methodology states the consequence
directly: `Form 10-K` must **not** become equal to `Form 10K`, and `12b-1
fee`, `3(c)(1)` and `401(k)` all depend on their punctuation. Where an
alternate is mechanically safe, the dataset ships it as an explicit derived
row rather than deriving it at lookup time. Legal adds the `/` and `-` spacing
rule because its sources write the same term both ways (`CM/ECF`, `CM / ECF`).

Unifying these would silently change what an existing family means in order to
make the implementations look uniform. What *is* shared is the discipline, not
the algorithm.

**Drift is caught at build time.** Each pack's Python generator re-derives
`normalized_term` from `term` using the documented policy and asserts equality
on every row; each pack's verification suite re-derives every shipped key
through the *TypeScript* normalizer and asserts the same. Two implementations
of one algorithm is exactly the shape that drifts silently, and a drift here
is not a build error — it is a lookup that quietly misses.

Normalization is for matching only. The candidate's display value is never
rewritten, the document is never rewritten, and export/audit always carry the
original text.

## 5. Collisions

Collisions are first-class information, not a problem to be solved inside a
provider. A term stays valid evidence even when several other providers also
attest the same phrase.

Measured on the shipped assets (`investigation/domain-reference-overlap.ts`):

| overlap | count |
|---|---|
| finance ∩ legal | 23 |
| finance ∩ higher-ed | 15 |
| legal ∩ higher-ed | 3 |
| finance ∩ Census (all tokens attested) | 61 of 651 — 27 single-token |
| legal ∩ Census (all tokens attested) | 52 of 445 — 29 single-token |
| higher-ed ∩ Census | 67 of 1382 — 32 single-token |
| any pack ∩ GNIS | 0 |
| finance collision risk | LOW 393 · MEDIUM 179 · HIGH 138 |
| legal collision risk | LOW 250 · MEDIUM 118 · HIGH 81 |

The sharpest case in the repository is **`ADR`**: attested by the SEC as an
American Depositary Receipt and by the federal judiciary as Alternative
Dispute Resolution. Same string, two authorities, unrelated meanings, both
rows correct. Nothing in the evidence layer picks between them.

The desired shape is:

```
candidate: "Levy"
  censusName:          surname, Top-1000
  legalTerminology:    attested, HIGH collision risk
  financeAccountingTax: (no attestation)
```

and never:

```
legal dictionary matched -> therefore not a person
```

## 6. Local and offline

Packs are bundled generated assets. No network calls, no runtime fetch from
IRS/SEC/uscourts, no cloud dependency. Every lookup is local and every index
is built lazily on first use, so a document that never reaches an evidence
family never pays for it. Source CSVs are versioned under
`investigation/data/` and assets are regenerated with
`scripts/generate_domain_terminology_pack.py`; nothing is hand-transcribed.

## 7. Licensing

**Finance / Accounting / Tax** — federal public glossaries only: IRS,
SEC/Investor.gov, CFPB, CFTC, Federal Reserve, FDIC, Treasury USSGL. The FASB
GAAP Financial Reporting Taxonomy, GASB pronouncements and AICPA/CIMA
standards were researched and deliberately **not** ingested: they carry
copyright and authorized-use conditions that are a poor fit for a
redistributable reference pack. No commercial dictionary was scraped.

**Legal** — federal judiciary and federal executive-agency material (17 U.S.C.
§ 105) plus California superior-court self-help glossaries. Cornell LII/Wex
was researched and **rejected**: its compilation licence carries
noncommercial and share-alike conditions. No commercial legal dictionary
(Westlaw, Lexis, Bloomberg Law, Black's) was scraped. **State-judiciary
definitions are not reproduced** — only factual term labels are retained,
because state-site reuse policies differ by jurisdiction.

Both assets store short term strings and provenance URLs. Neither reproduces
source definitions. No vocabulary was expanded from model knowledge, and
nothing was tuned against any DocScrub witness or test document.

## 8. Coexistence with other evidence families

`engines/knowledge/ReferenceEvidence.ts` gathers every channel for a phrase
and resolves none of them:

```
candidate
  -> independent evidence channels     <- gathering ends here
  -> evidence interpretation               (does not exist yet)
  -> recommendation / routing              (unchanged)
```

`referenceEvidenceFor(phrase)` returns each family's answer side by side.
Callers do not need to know which pack to query. There is deliberately **no**
precedence order, weighting, score, `mostLikelyType`, tie-break, or boolean
that collapses several channels into one. Contradiction is the product: a
phrase carrying Census name evidence *and* legal terminology evidence is the
most informative thing these datasets can jointly report.

Channels are not normalised into a uniform record. The terminology packs
answer "is this attested vocabulary"; Census answers "does this phrase have
personal-name structure"; GNIS answers "does this name a place, and how
strongly." Forcing one struct on them would discard Census's per-token roles
and GNIS's strength/suppression. Note the differing conventions: terminology
packs return `null` on a miss, while Census and GNIS always return a record
whose own field says whether anything was found.

**Adding a family** is one field on `ReferenceEvidenceChannels`, one call in
`referenceEvidenceFor`, and one case each in `terminologyChannelsOf` and
`referenceEvidenceAuditRows` — all in that one file. It then appears in
`Workspace.getReferenceEvidence()`, in `__docscrub.channels()` and in the
overlap harness for free. This is deliberate: six domain packs were in flight
on 2026-08-10 and the previous pattern (a bespoke map, getter and loop in
`Workspace.ts`, plus a hand-written block in the console diagnostic, per
family) is a guaranteed merge conflict per pack, forever, for no behavioural
gain. The Employment/HR pack was integrated through these seams the same day
without touching `Workspace.ts` or `app.ts` at all.

`DomainReferenceEvidence.ts` is the shared substrate for packs with the common
row model: the attestation record, the pack asset format, the index builder,
the lookup and the explanation writer. Higher-ed and medical predate it and
keep their own shapes; the aggregator reads them through their own APIs and
they are unmodified. Migrating them is a later mechanical change, and the
substrate's record shape was designed to accept every field they carry.

## 9. Inertness, and where interpretation belongs

**No production decision reads any of this today.** Not extraction, not person
detection, not scoring, not confidence, not ambiguity routing, not stage
assignment, not Group Check, not Item Check, not recommendations, not
Keep/Rename/Redact/Ignore, not output. `Workspace` computes the channels per
candidate, stores them, and nothing downstream consults the map.

Higher-ed and medical each thread an inert boolean into `SemanticTypeFacts`
and assert that flipping it changes nothing. Finance and legal deliberately do
**not** add a third and fourth such field. Two reasons: a shared-type edit per
family is exactly the merge surface described above, and the channels map
already gives a combination layer the same information with strictly more
provenance. Inertness is instead pinned structurally — the facts type has no
channel through which finance or legal attestation could reach the type
functions at all, and a field cannot be flipped if it does not exist. If
someone adds one, the verification suites fail, which is the intent:
consuming this evidence should be a deliberate, reviewed change to a
documented contract rather than a quiet one-line addition.

**Where the combination layer belongs.** Between `referenceEvidenceFor` and
the recommendation/routing stage, reading the channels struct and producing
something that can represent a *conflict* rather than silently resolving one.
It does not exist and must not be improvised inside a provider, inside the
aggregator, or inside the type-check pass. The measurements in §5 exist so
that layer can be designed against evidence rather than intuition.

## 10. Where things live

| what | where |
|---|---|
| shared substrate | `src/engines/knowledge/DomainReferenceEvidence.ts` |
| finance provider | `src/engines/knowledge/FinanceAccountingTaxEvidence.ts` |
| legal provider | `src/engines/knowledge/LegalTerminologyEvidence.ts` |
| channel aggregator | `src/engines/knowledge/ReferenceEvidence.ts` |
| generated assets | `src/engines/knowledge/{finance-accounting-tax,legal}-*.data.ts` |
| generator | `scripts/generate_domain_terminology_pack.py` |
| source CSVs + methodologies | `investigation/data/` |
| overlap / witness harness | `investigation/domain-reference-overlap.ts` |
| verification | `verify/{finance-accounting-tax-evidence,legal-terminology-evidence,reference-evidence}-verification.ts` |
| console diagnostic | `__docscrub.channels()` and `__docscrub.channels("<phrase>")` |
