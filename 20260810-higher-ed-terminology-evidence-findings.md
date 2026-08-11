# Higher-Education Terminology Reference — Integration Findings

**Date:** 2026-08-10
**Status:** implemented and suite-verified. **Inert in production by design** — no scoring, routing, gating or recommendation path reads it.
**Scope:** one independent deterministic evidence family. Geography (GNIS) untouched; no shared abstraction invented.

---

## 1. Files changed

**New**

| File | Role |
|---|---|
| `app/scripts/generate_higher_ed_terminology.py` | CSV → TypeScript asset generator. Asserts normalization parity on every row. |
| `app/src/engines/knowledge/higher-ed-terminology.data.ts` | GENERATED. 1,394 rows / 1,373 terms, 0.17 MiB. |
| `app/src/engines/knowledge/HigherEdTerminologyEvidence.ts` | The lookup + evidence record + reviewer prose. Pure, DOM-free. |
| `app/verify/higher-ed-terminology-evidence-verification.ts` | 101 assertions. |
| `app/investigation/higher-ed-benchmark.ts` | Offline benchmark against the 139-unit live C1 residue. Investigation only. |
| `app/investigation/data/docscrub_higher_ed_terminology.csv` | Source, vendored beside the Census CSV so the asset is reproducible. |
| `app/investigation/data/docscrub_higher_ed_terminology_methodology.md` | Source methodology. |

**Modified — three files, all additive**

| File | Change |
|---|---|
| `app/src/domain/semanticTypes.ts` | One optional field on `SemanticTypeFacts`: `higherEdTerminologyAttested?: boolean`. No branch reads it. |
| `app/src/workspace/Workspace.ts` | Computes the evidence per candidate on load; new `getHigherEdTerminologyEvidence()`; passes the fact to `typeCheckSectionFor`. |
| `app/src/ui/app.ts` | New read-only diagnostic `__docscrub.referenceEvidence()`. |

Nothing was removed, renamed or re-weighted. `scoring.ts`, `patterns.ts`, `recommendations.ts`, the contextual-person-evidence family, `person-evidence-gate.ts`, `cross-candidate-evidence.ts` and every detector are untouched.

---

## 2. How normalization and lookup work

**Normalization** (`normalizeForHigherEdLookup`) reproduces the source dataset's own six documented steps:

1. NFKC
2. smart apostrophes/dashes → ASCII
3. lowercase
4. `&` → ` and `
5. every non-alphanumeric run → **SPACE**
6. collapse, trim

**Step 5 is load-bearing and deliberately differs from `normalizeForCensusLookup`,** which strips punctuation to nothing. Census keys are single tokens; these are multi-word phrases, and stripping would fuse tokens into keys the sources never contained. The GNIS benchmark reached the identical conclusion for the identical reason (§4). Two normalizers, two key spaces, one documented reason each.

**Drift protection.** The normalizer exists twice — Python in the generator, TypeScript at runtime. Two implementations of one algorithm is exactly the shape that drifts silently, and a drift here is not a build error but a lookup that quietly misses. So both ends assert:

- the generator re-derives `normalized_term` from `term` on all 1,394 rows and **refuses to write the asset** if any row disagrees;
- the verify suite re-normalizes all 1,394 shipped source terms and requires each to reproduce its own key.

Both currently pass 1394/1394. Every rule is exercised by real rows: 4 terms contain `&`, 2 contain a smart apostrophe, hundreds contain hyphens, slashes and parentheses.

**Lookup** is exact match on the normalized key against a `Map<string, HigherEdAttestation[]>` built lazily on first call. No fuzzy matching, edit distance, stemming, plural folding, acronym expansion or synonym expansion. Note that `Accrediting agencies` and `Accrediting bodies` ship as two separate rows precisely because the dataset enumerates variants rather than deriving them — and nothing at runtime derives them either.

**Return shape.** A hit returns every attesting row plus derived summaries: `sourceFamilies`, `semanticHints`, `highestCollisionRisk` (max across rows — a warning on any row is a warning), `multiplyAttested`, `hasSourceAttestedRow`, `tokenCount`. A miss returns `null`, and `null` means *not attested in this dataset* and nothing else.

---

## 3. Where the evidence enters the pipeline

`Workspace.loadDocument()`, alongside the existing Census computation, for **every** candidate — not only person-typed ones. That widening is deliberate: the point of a domain reference is to describe candidates the person pipeline never proposed.

From there it goes exactly two places:

1. **`Workspace.getHigherEdTerminologyEvidence()`** — the full evidence map, for diagnostics and audit.
2. **`SemanticTypeFacts.higherEdTerminologyAttested`**, passed into `typeCheckSectionFor`. **Carried, never branched on.**

That second one is the judgment call worth stating plainly. The field is present so the future combination change is a local edit at a documented call site rather than a plumbing exercise; it is inert so that presence cannot quietly become behaviour. Section 11 of the verify suite pins the inertness across 8 fact shapes × 2 rejection states — 26 assertions that the semantic type and the routing section are identical with the flag off and on. If someone adds a branch, the suite fails, and that is the intent. It is not a ban on ever using the evidence; it is a requirement that using it be a reviewed change rather than a one-liner.

**Deliberately NOT wired into `person-evidence-gate.ts`.** That gate takes evidence *for* personhood. Terminology attestation is not that, and its inverse — "attested terminology, therefore not a person" — is the failure the dataset's own `collision_risk` column exists to warn about.

---

## 4. How collisions are represented

They are **retained and surfaced, never resolved.** Three mechanisms:

- **`collisionRisk` per row, `highestCollisionRisk` per hit.** Carried through to the reviewer prose: a HIGH-risk hit produces the line *"This term is flagged as collision-prone — it is also ordinary English or a common personal name, so terminology attestation alone says little here."* The doubt lands with the reviewer, who can see the document; this layer cannot.
- **`semanticHints` is a list, not a value.** Rows may disagree, and disagreement is information this layer must not collapse.
- **All attesting rows are returned.** 21 normalized terms have more than one row; the interesting ones cross source families (`academic year` → IPEDS + Federal Student Aid; `white` → IPEDS + CEDS). Corroboration across independent families is the unit the source methodology recommends weighting on, and collapsing to a key set would destroy it before the layer that wants it exists.

**The measurement behind all of this.** I intersected the dataset's single-token terms with the shipped Census asset: **34 overlap, 19 of them flagged HIGH.**

```
White    IPEDS + CEDS   Census first name AND surname, both Top-1000
Major    UT Austin      Census first name AND surname
Minor    UT Austin      Census first name AND surname
Race · Session · Course · Degree · Credit · School · Track · Freshman · Cookie
```

This is the same shape as the two failures already on record — Census attestation protecting 80 of 106 known non-people, and 7 of 7 single-token GNIS place hits being real people — arriving from a third source. `tokenCount` is exposed for the same reason, since a combination layer will very likely want to price single-token higher-ed hits differently. **This module does not act on it.** Single-token and HIGH-risk hits are matched and returned in full, with their warnings attached.

---

## 5. Tests added and results

`verify/higher-ed-terminology-evidence-verification.ts` — **101 assertions, 101 passed, 0 failed.** Every case you listed is covered:

| Required case | Witness | Result |
|---|---|---|
| Unambiguous higher-ed phrase | `Academic Calendar` | hit, LOW, UT Austin, hint + URL carried |
| Multi-token phrase | `Cost of Attendance` (3), `Degree or Certificate Seeking Student` (5) | hit; `Attendance` alone misses; no substring matching |
| Normalization / case differences | 7 surface forms of `Cost of Attendance` | all reach one key; input echoed unmodified |
| Derived variant | `SAP`, `Satisfactory Academic Progress` | flagged derived, `hasSourceAttestedRow: false`, notes name the parent |
| Multiple provenance rows | `Academic Year` (FSA + IPEDS), `White` (IPEDS + CEDS) | both rows retained, both source forms kept |
| HIGH collision risk | `White`, `Major` | returned in full, warning surfaced to reviewer |
| Plausible person-name collision | `White`, `Major`, `Minor`, `Race`, `Session`, `Course` | asserted attested **and** Census-attested simultaneously |
| Phrase not in dataset | `Academic Senate`, `Grade Rosters`, `Term Withdrawals`, `Registrar`, `Dean`, `Spring`, `Grant`, `Amy Miller`, `San Diego`, `Good Morning` | all miss |
| Membership does not force classification | 8 fact shapes × 2 rejection states | type and section identical with flag off/on |

Two additions beyond the list: full-dataset normalization parity (§2), and an explanation-wording guard that fails if any reviewer-facing line ever draws a conclusion about the referent (`is not a person`, `therefore`, `organization`, `keep`, `redact`).

**Regression battery.** `npx tsc --noEmit` clean. `npm run build` clean. **73 of 73 `verify/*-*.ts` suites pass, 0 failures** (72 pre-existing + the new one). No suite expectation was weakened.

**Offline benchmark** (`investigation/higher-ed-benchmark.ts`), against the same 139-unit live C1 residue the GNIS benchmark used:

```
units 139   hits 1
   Financial Aid  [non-person]  multi-token  MEDIUM  OTHER_DOMAIN_TERM  IPEDS
single-token hits 0     false hits on known people 0     person/hed conflicts 0
```

**Read this as sparse-but-clean, not as a payoff.** Zero false hits on 30 known people is a genuinely good separation — cleaner on this population than Census managed. But one unit of 139 is not a workload result, and the residue is by construction the population where person detection already fired, which is where a domain reference should be *expected* to be sparse. The interesting population is the 281-entity Other bucket and the Organizations bucket, neither of which exists in the offline snapshot. `__docscrub.referenceEvidence()` is the instrument for that and its figures supersede these.

---

## 6. Interaction with the concurrent geographic work

**There is nothing to collide with in this branch, and I checked before assuming.** GNIS is benchmark-only: `20260810-gnis-place-evidence-benchmark.md` §Status says so explicitly, the harness is `investigation/gnis_benchmark.py`, and `grep` confirms nothing in `src/` reads it. So there was no emerging reference-evidence abstraction to reuse, and per your instruction I implemented in isolation rather than guessing at unfinished architecture.

Three real interactions worth flagging to whoever lands geography:

1. **We independently reached the same normalization conclusion** — punctuation collapses to a space, not to nothing, because both datasets are multi-word and Census is not. If a shared normalizer is ever extracted, that is the shape it should have, and the Census one must stay separate.

2. **We independently reached the same architectural conclusion.** GNIS §13: *"the immediate architectural requirement is not a PLACE type — it is the ability to represent person evidence + place evidence → conflict, which the current interpreter cannot express."* Higher-ed hits the identical wall from a different direction (`White` is terminology and a Top-1000 surname). Two families now want the same missing layer. That is a stronger argument for building it than either made alone, and it is the same "representational collapse" already recorded in the interpretation-boundary verdict.

3. **The single-token trap generalizes.** GNIS measured 7/7 single-token place hits were real people. Higher-ed's overlap with Census is 34 single-token terms, 19 HIGH. Whatever rule geography adopts for single-token matches, higher-ed should be evaluated against the same rule rather than getting its own — but that decision belongs in the combination layer, not in either lookup.

**Merge risk: low.** My three modified files are `semanticTypes.ts` (one optional field appended to an interface), `Workspace.ts` (one import, one field, one getter, one block, one line in the facts literal) and `app.ts` (one import, one diagnostic, one doc-comment line). A geography pass will touch `Workspace.ts` in the same region — the conflict, if any, will be adjacent-line and mechanical.

---

## 7. Deliberately NOT integrated — the combination-layer backlog

Everything here is a decision I declined to make on my own, not an oversight:

1. **No score, weight or `Evidence` item.** A weight-0 `neutral` Evidence entry would have been expressible in the existing type, but `Evidence.category` feeds `qualityCategoriesOf` and the chip row, so it would mint a reviewer-visible chip for a signal that decides nothing. The contextual-person-evidence family already documents refusing exactly this ("ONE CHIP, NOT ELEVEN"). Deferred.

2. **No `suggestedType` and no route to Organizations.** Only 86 of 1,394 rows are hinted ORGANIZATION, and the dataset's own methodology calls hints "evidence features, not final entity labels". `Cost of Attendance` is attested terminology and is not an organization. Asserted as a non-behaviour in the suite.

3. **No conflict representation.** The thing both this and GNIS actually need. `person evidence + reference evidence → CONFLICT` has no home in `CandidateInterpretation`, which carries one `semanticType` and one optional `rejectedType`. Building it is a real design task with reviewer-facing consequences, not a side effect of loading a CSV.

4. **No source-family weighting.** The methodology recommends it (federal standards vs. registrar glossaries vs. derived acronyms should not contribute identical strength). The data to do it is carried per hit; the policy is a combination-layer decision and needs a second corpus.

5. **No single-token or HIGH-risk policy.** Both populations are flagged and passed through untouched. See §6 item 3.

6. **No reference-dataset registry or shared `DomainReference` interface.** One example is not enough to shape an abstraction, and the second example is another worker's in-flight design. The seam I did leave is a naming discipline: every record carries `family: "higher-ed-terminology"`, so a heterogeneous evidence list works without a discriminator bolted on later.

7. **No audit-export surface.** `HIGHER_ED_EVIDENCE_SOURCE` and the per-hit provenance are ready for `AuditRecord`, but I did not change the export format — that is a durable serialized contract and the same open question the contextual-evidence work left for the audit exporter.

---

## 8. Judgment calls, stated explicitly

- **Every candidate, not just person-typed ones** (Workspace). Census narrows to `detectedType === "person"` because its only consumer is the person gate; narrowing here would blind the reference to exactly the candidates it is for. Cost is 1,373 keyed lookups against one lazily-built Map.
- **Vendored the source CSV** into `investigation/data/` beside `Census2020_DocScrub_NameEvidence.csv`, so the generated asset is reproducible from the repo. **Licensing note carried forward from the methodology:** the non-federal rows (UC Berkeley, UT Austin, National Student Clearinghouse — 129 rows) carry their own terms. Only short term labels are stored, no definitions or prose, but §Provenance of the methodology advises legal review before broad external redistribution. Flagging, not deciding.
- **Kept step 2 of normalization (smart quotes → ASCII) even though step 5 makes it a no-op**, since all punctuation becomes a space regardless. Fidelity to the documented six-step algorithm is worth more than removing a redundant line — if the dataset's generator ever changes step 5, step 2 starts mattering again.
- **Pinned the hint and risk vocabularies in the generator** rather than discovering them from the CSV, so an unexpected value is a loud generator failure instead of a silently widened enum the TypeScript union would then reject.
- **`highestCollisionRisk` takes the max across rows**, not the first or the modal value. A warning on any attesting row is a warning.
- **Did not add higher-ed terms to any blacklist, lexicon or dictionary**, per your constraint. `quality-dictionaries.data.ts` is untouched.

---

## 9. Suite-verified vs. pending live-browser validation

**Suite-verified:** normalization (both directions, full dataset), lookup, provenance retention, multi-attestation, derived-variant flagging, collision reporting, explanation wording, inertness through `semanticTypeFor` and `typeCheckSectionFor`, typecheck, build, and all 73 verify suites.

**Pending live-browser validation:**
- `__docscrub.referenceEvidence()` has not been run in a browser — `app.ts` has zero exports and cannot be behaviourally tested by the suite battery. It typechecks and builds; that is all the offline environment can establish.
- Real coverage on the Organizations / Acronyms / Other buckets. The offline benchmark only had the person residue.
- Load-time cost of the extra per-candidate pass on a full document. Expected to be negligible (one Map build, ~1.4k entries, then O(1) per candidate) but unmeasured on real input.

**To validate:** load the test document, run `__docscrub.referenceEvidence()`, and read sections 2 and 4. Section 4 — candidates carrying both higher-ed and person evidence — is the one that should drive the combination-layer decision.
