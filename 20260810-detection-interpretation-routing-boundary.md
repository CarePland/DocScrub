# Detection → Interpretation → Review Routing

**Date:** 2026-08-10
**Status:** investigation and architecture design. **No production code changed.** One investigation-only harness added at `app/investigation/interpretation-counterfactual.ts` — deliberately outside `verify/`, so the suite runner never picks it up, and imported by nothing.
**Verdict (§12): B — the boundary is right, and one bounded evidence capability is missing before it stops merely renaming the pile.**

> **SUPERSEDED IN PART, 2026-08-10.** Capability X (occurrence `groupKind`) was measured live and **failed** — 9 of 139, all-heading 0 of 139. §12's nomination is withdrawn. Two other things in this document also changed: §4 misclassified two evidence signals (see the correction box in §4.0), and the last-first representation defect has since been fixed (oracle deviation #8). The successor document is `20260810-cross-candidate-composition.md`, which supersedes §12 with verdict **A** on a different and measured signal. Everything in §1–§11 stands except where those two corrections apply.

Reading order: this starts from `20260809-people-architecture-verdict.md`, `-residual-population-evidence-audit.md`, `-people-membership-contract.md`, `-people-residue-routing-rules.md`, `-truncation-confidence-and-x1.md` and the live witness-audit output. Their findings are carried forward, not re-derived. Every code-level claim below was re-verified against the source, and §2 and §9 correct one of them.

---

## 0. The finding that should be read before the architecture

The confidence-language fix (oracle deviation #7) shipped yesterday. Running the real `evidenceFaithfulOpener` over the frozen witness set today produces this:

```
Amy Miller             79   Possibly name-shaped text. No name evidence was found.
Jeffrey Lam            79   Possibly name-shaped text. No name evidence was found.
Perias, Nelly          94   Likely name-shaped text. No name evidence was found.
Cobb, Christopher      94   Likely name-shaped text. No name evidence was found.
Diana                  40   Unlikely to be a person's name.
Sarah                  40   Unlikely to be a person's name.

Academic Senate        99   Almost certainly a person's name.
Computer Science       99   Almost certainly a person's name.
External Education     99   Almost certainly a person's name.
San Diego              99   Almost certainly a person's name.
Word Documents         99   Almost certainly a person's name.
Residency Specialists  99   Almost certainly a person's name.
```

**The polarity is exactly inverted.** After a fix whose entire purpose was to stop asserting personhood on shape evidence, the *only* six units in your control set still receiving "Almost certainly a person's name" are the six false-contextual non-people — and the two units with genuine name-lexicon evidence read "Unlikely."

The mechanism is one line, and it is the thesis of this document in miniature. `scoreCandidateQualityCore` injects the contextual family into `positiveReasons`:

```ts
const positiveReasons = dedupe([...evidence.positive, ...contextualReasons]);
```

`isShapeOnlyPersonClaim` then asks whether *every* positive reason is shape-or-frequency. `contextual_person_evidence` is not in `SHAPE_OR_FREQUENCY_REASONS` — correctly, because a genuine usage observation is not shape — so its presence makes the claim read as evidenced. `Academic Senate` scores 35 + 9 + 35 + 30 = 109, clamped to 99, and the honest-sentence branch never fires.

Nobody made a mistake here. `contextual_person_evidence` genuinely is not shape. The defect is that **a usage observation and a semantic conclusion travel on the same channel**, so a false possessive reading of *"the Academic Senate's agenda"* is indistinguishable, downstream, from *"Andrew is in the signature block."*

That is the boundary you are asking about, and it is already causing reviewer-visible harm today.

---

## 1. The current pipeline, layer by layer

Traced from source. Each layer is tagged with the concepts from your list — **A** observation, **B** detector hypothesis, **C** evidence, **D** semantic interpretation, **E** review routing, **F** user-facing claim.

```
patterns.ts                    FALLBACK_PERSON_RE  = 2–6 capitalized words
                               LAST_FIRST_PERSON_RE = Cap, Cap
                               no lexicon consulted — high recall by design
                               → detectedType: "person"                          [A→B]
   │
   ▼
contextual-person-evidence/    11 rules over {before, match, after}, per
   contextual-rules.ts         occurrence, unioned per candidate, combined
   anchor-rules.ts             with diminishing returns, capped at +55.
                               ANCHOR rules (identity claims) held separate
                               from USAGE rules (grammatical role).             [C, and the tier split is correct]
   │
   ▼
quality/scoring.ts             ⚠ FIRST LINE: `if (detectedType !== "person")
                                 return deterministic_non_person_type`
                               → the entire quality engine is a
                                 person-likeness scorer CONDITIONAL ON B.       [B leaks into C]
                               Emits: reasons[], positiveReasons[],
                                 filterRules[] (= classifications), score.
                               Contextual family injected into positiveReasons. [C collapsed with D]
   │
   ▼
entity-resolution/             ambiguity proposals (bare name → full-name
   resolution.ts               anchors), entity groups, per-option confidence
   semantic-augmentation.ts    and reviewer-facing evidence lines.              [C, and directional — §2.2 of the 08-09 verdict]
   │
   ▼
occurrence-classifier/         per-occurrence groupKind ∈ {standalone,
   classification.ts           contextual}, blockKind, structured context.      [A — computed, never consulted for meaning]
   │
   ├──────────────┬──────────────────────┬─────────────────────────┐
   ▼              ▼                      ▼                         ▼
semanticTypeFor  deriveRecommendation   residualReviewGate      explanation-builder
(Type Check      → archetype            → AutomaticResolution   → confidenceOpener /
 ONLY)             │                                              evidenceFaithfulOpener
   [D, almost]     ▼                    [E, correct design]      [F]
                triageSectionFor(archetype, detectedType)
                  case null: return detectedType === "person"
                    ? "people" : "other"                         [B used directly as E]
                  │
                  ▼
                TRIAGE_SECTION_EXPLANATIONS.people
                  = "Likely personal names."                     [F derived from E, not from D]
```

### Where semantic claims enter, and where the concepts are collapsed

| # | collapse | where | consequence |
|---|---|---|---|
| 1 | **B is C** | `scoring.ts:877` — non-person detections early-return; every score is conditional on the person regex | there is no such thing as a candidate's quality independent of the detector that produced it |
| 2 | **C is D** | `scoring.ts:903` — `positiveReasons = [...evidence.positive, ...contextualReasons]` | §0: a usage observation becomes a personhood assertion |
| 3 | **A/C/D share one channel** | `qualityCategoriesOf()` returns `filterRules.length ? filterRules : reasons` | see §1.1 — the channel changes meaning depending on whether a dictionary fired |
| 4 | **D accepts shape** | `semanticTypes.ts:143` — `people` requires `known-*` **or** `strong-name-structure` **or** `surname-given-structure` | the only real classifier in the system treats capitalization as semantic evidence |
| 5 | **B is E** | `triageQueue.ts:139` | People's membership rule is "person-typed and nothing else claimed it" |
| 6 | **E is F** | `TRIAGE_SECTION_EXPLANATIONS` | "Likely personal names" is a property of the bucket, asserted over items nothing assessed |
| 7 | **F takes its noun from B** | `entityPhrase(entityType)` | partially corrected by deviation #7 — and §0 shows the correction is defeated by collapse #2 |

### 1.1 The collapse nobody has named yet

`qualityCategoriesOf` is the single input to `semanticTypeFor`, `deriveRecommendation`, `hasKnownNameEvidence` and `isNonNameAnchorEvidence`. It returns:

- **`filterRules`** when non-empty — which, in every name-structure branch, `scoredResult` sets to `classifications`: dictionary hits, i.e. genuinely semantic material.
- **`reasons`** otherwise — which is `[frequency, ...positives, ...classifications, shape]` concatenated: observation, evidence and shape in one flat array.

So the *meaning of the category channel changes* depending on whether any dictionary fired. For `Records Team` the categories are institutional facts. For `Academic Senate` — `classifications` is empty — the categories are `["moderate-frequency-bonus", "contextual-person-evidence", "strong-name-structure"]`, and `semanticTypeFor` reads `strong-name-structure` off that list and returns `people`.

**This is why C1 cannot fix `Academic Senate`, and it is a structural fact rather than a tuning problem.** Every unit in the C1 residue is, by construction, a unit for which the category channel is carrying shape rather than meaning.

---

## 2. Does an interpreter already exist?

Five functions were examined. None is the layer, and one is close.

| | `semanticTypeFor` | `deriveRecommendation` | `evaluateCandidate` (gate) | `triageSectionFor` | `c3Verdict` (diagnostic) |
|---|---|---|---|---|---|
| **inputs** | detectedType, categories, relationshipKinds | + personTokenCount, identityOptions, qualityRecommendation | flat `GateFacts` record of conclusions | archetype, detectedType | categories, contextual rules, positives, group/ambiguity linkage |
| **output vocabulary** | 9 `SemanticTypeId` | 8 archetypes (reviewer *action* vocabulary) | resolve / retain | 7 sections | keep / drop + why |
| **precedence** | explicit, most-specific-first | explicit, documented inline | five disqualifying guards | switch on archetype | strong → corroborated → shape |
| **abstention** | `other` — but overloaded: means both "classified as none of these" and "unknown" | `uncertain` — a *second* abstention in a *different* vocabulary | retain (correct) | `other` | drop |
| **consumers** | Type Check only | Item Check + Ambiguity Check + tiering | Item Check | Item Check | none — diagnostic |
| **detector-independent?** | **no** — 6 of 9 branches test `detectedType` | **no** | **no** | **no** — it *is* the detector test | mostly |
| **granularity** | candidate | candidate | candidate | candidate | candidate |
| **can express conflict?** | **no** — first match wins | **no** | no, by design (disqualifiers) | no | partially |
| **possible vs supported person?** | **no** — accepts shape as evidence | no | n/a | no | **yes** — this is the one that gets it right |

**Answer: B and C together, with a specific correction to the 2026-08-09 framing.**

`semanticTypeFor` is not "a better classifier Item Check ignores" — it is *most of the interpreter, with the shape bug*. Everything else about it is what you want: no token gate, ordered precedence, detector-independent for the branches that matter, an abstention value, decision-blind, already a first-class domain module, already consumed by the navigation layer.

But two things it lacks are not cosmetic:

1. **It has no state for "name-shaped, unresolved."** `other` is doing double duty for "interpreted as miscellaneous" and "we do not know," and those are different claims a reviewer needs told apart.
2. **It cannot express contradiction.** First-match-wins means an item with institutional evidence *and* a signature-block anchor silently becomes an organization.

And `c3Verdict` — which lives in a diagnostic and was written to be thrown away — is the only code in the repository that separates *possible person* from *supported person* on the correct grounds. That is a signal about where the missing layer belongs, not about the diagnostic.

**Recommendation: do NOT create `src/engines/semantic-classifier/`.** The abstraction is missing; the module is not.

---

## 3. The semantic contract

### Shape

```
interpretCandidate(evidence: CandidateEvidence) → SemanticInterpretation

CandidateEvidence      // typed channels, NOT one string array — see §3.2
  semanticPositive     known_first_name | known_surname | known_personal_name_token |
                       known_name_structure | nearby_title | email_address_evidence |
                       signature_or_email_header_context
  semanticNegativeStrong   institution_term | department_organization |
                       organization_suffix | product_system_name |
                       administrative_phrase | legal_administrative_term |
                       calendar_term | calendar_abbreviation |
                       season_or_academic_term | document_structure_term |
                       likely_acronym | institution_acronym
  semanticNegativeDefeasible  the ordinary-language set (see §4)
  anchors              anchor_* contextual rules — identity claims
  usages               contextual_* rules — grammatical role only
  shape                strong_name_structure | surname_given_structure |
                       initials_with_surname | weak_name_structure | …
  frequency            single_occurrence | *_frequency_bonus | frequency_saturated
  linkage              person-evidenced ambiguity/group partner (boolean)
  distribution         occurrence-distribution facts (§12 capability X)
  provenance           detectedType — CARRIED, NEVER CONSULTED for class

SemanticInterpretation
  class    SemanticTypeId ∪ { "unresolved-name-shaped" }
  support  "supported" | "corroborated" | "unsupported"
  basis    evidence ids that produced the class
  contra   evidence ids pointing the other way — recorded even when overruled
  provenance  the detector hypothesis, preserved for audit
```

### 3.1 Vocabulary — reuse, and the one addition

`SemanticTypeId` is reused verbatim. Its nine members already cover everything your proposed taxonomy names except one, and the mapping to your list is exact: `people`, `organizations` (= ORGANIZATION_OR_GROUP), `dates-terms` (= CALENDAR_OR_TERM), `document-titles` (= DOCUMENT_OR_SYSTEM), `acronyms`, `identifiers`, `emails`, `phones`, `other` (= ORDINARY_TEXT / OTHER).

**Where the existing vocabulary is inadequate, and it is exactly one place:**

`unresolved-name-shaped` has no equivalent. `other` cannot serve, because `other` is currently *supported* — it means "the evidence says miscellaneous" — and folding an unsupported state into it destroys the distinction the whole contract exists to make. This is the same conclusion the 08-09 membership contract reached from the product side ("Other reads as a dumping ground") and the same one §D of that document reached from the taxonomy side. Three independent routes to one missing member is reasonable grounds to add it.

**PLACE and PROCESS_OR_EVENT are deliberately not added.** DocScrub has no evidence that would ever populate them — there is no place lexicon and no event detector — and a class that can never be entered is an ontology, not a contract. `San Diego` belongs in `unresolved-name-shaped`, which is the truth about what DocScrub knows.

### 3.2 The contract's real content is the typed input, not the output

The output vocabulary is nearly free. **The architectural work is splitting the category channel**, because that is where detector ancestry becomes semantic truth. As long as `strong_name_structure` and `known_first_name` are two strings in one array, every consumer must remember which is which, and §0 shows what happens when one of them forgets.

### 3.3 Precedence, stated as principles rather than weights

- **P0 — provenance never determines class.** `detectedType` is carried through and is available to the audit; it is not an input to the classification. A person detector producing `Grade Rosters` establishes *person-shaped candidate*, full stop.
- **P1 — strong semantic negatives decide first**, and only from the classification-sourced channel. A `reasons` fallback is shape and must never reach this test.
- **P2 — PERSON requires semantic positive evidence**: name lexicon, honorific, email, signature, or an **anchor** contextual rule. Never shape. Never frequency.
- **P3 — shape alone → `unresolved-name-shaped`.** Never person, never non-person. This is the rule that makes `Amy Miller` and `Grade Rosters` land together, honestly, rather than being separated by a coin-flip.
- **P4 — contextual USAGE alone establishes nothing, and suppresses nothing.** It qualifies only with an independent corroborator, and it must lose the power it currently has to erase a counter-signal (§5.1).
- **P5 — two strong claims in opposition → `unresolved-name-shaped`**, with both recorded. Never resolved by score magnitude.
- **P6 — frequency contributes to confidence in an observation and to nothing else.**

---

## 4. What counts as support

Every signal below exists in production today. Classified by what it *legitimately proves*.

| signal | class | what it actually asserts |
|---|---|---|
| `known_first_name`, `known_surname`, `known_personal_name_token`, `known_name_structure` | **A — semantic positive** | a lexicon recognizes this as a name. Trustworthy; coverage is 23+5 |
| `nearby_title` | **A** | an honorific attaches to it (narrowed by deviation #6) |
| ~~`email_address_evidence`, `signature_or_email_header_context`~~ | **CORRECTED → E — corroboration only** | see the correction box below |
| `anchor_signature_block`, `anchor_full_name_with_role`, `anchor_name_with_email`, `anchor_full_name_with_organization` | **A** | identity claims, not usage claims. The tier split already exists in `CONTEXTUAL_RULE_WEIGHTS` and is correct |
| institution / department / organization-suffix / product-system / administrative / legal-administrative | **B — semantic negative (strong)** | names what the referent **is**. Absent by construction from the C1 residue |
| calendar / season / document-structure / acronym categories | **B (strong)** | same. Also absent from the residue by construction |
| greeting, interjection, pronoun, common-word, sentence-fragment, contraction, all-common-dictionary-words | **B′ — semantic negative (DEFEASIBLE)** | names what the **string** is, not what it refers to. See below |
| `strong_name_structure`, `surname_given_structure`, `initials_with_surname`, `weak_name_structure` | **C — structural / shape** | two capitalized tokens. Proves NAME-SHAPED. Proves nothing about personhood |
| `contextual_direct_address`, `_attribution`, `_coordination`, `_person_list`, `_possessive`, `_human_subject`, `_human_object` | **D — contextual** | a sentence used it in a human-ish grammatical role. Real evidence; **defeasible**, and demonstrably false on institutions |
| ambiguity proposal / entity-group membership | **E — corroboration only**, and only when the partner is itself person-evidenced | otherwise a spurious proposal corroborates itself |
| `moderate_frequency_bonus` and siblings; the **score** | **G — too noisy to support interpretation** | how often the string occurs. Zero semantic content |
| `detectedType: "person"` | **F — provenance only** | a regex matched capitalized words |
| `heading_context` | **C, contaminated** | fires if *any* occurrence is heading-like, so one header taints a real person |
| occurrence `groupKind` distribution | **not yet used** | see §12 — this is capability X |

### 4.0 CORRECTION, 2026-08-10 — two signals were misclassified above

> **`email_address_evidence` and `signature_or_email_header_context` are NOT class-A semantic-positive person evidence.** They are **class E — corroboration / proximity only**, and must never qualify a candidate as PERSON on their own.
>
> Falsified by the live run, not by argument:
>
> ```
> Degree Planner       99   small_frequency_bonus, email_address_evidence, strong_name_structure
> Automate Approvals   88   single_occurrence, signature_or_email_header_context, strong_name_structure
> ```
>
> Both are non-people. Both would have been routed **PEOPLE / supported** by the contract as first written in §3.
>
> **Why the original classification was wrong.** Neither signal is a claim about the candidate; both are claims about the candidate's *neighbourhood*. In a mail corpus — which is the only corpus DocScrub has been measured on — proximity to an address or a signature block is close to ambient, so these fire on whatever phrase happens to sit near one. `email_address_evidence` is the stronger of the two and still only says "a token of this candidate also appears inside an email address," which a department mailbox satisfies.
>
> **Consequence for the contract:** P2 loses these two members. A candidate carrying only `email_address_evidence` or `signature_or_email_header_context` is **UNRESOLVED**, not PERSON. They may corroborate contextual usage evidence under P4, exactly like `surname_given_structure`.
>
> Recorded here rather than left in conversation, per Andrew's instruction. The §4 table above is amended in place.

### 4.1 The B/B′ split is the load-bearing distinction in this section

Treating ordinary-language categories as strong negatives is precisely the mistake that made R1 remove `Amy Miller`. The first draft of the harness did exactly that and immediately classified `Diana` — which carries `known_first_name` **and** `expanded_common_language_token` — as unresolved. That is wrong, and the codebase already knows it is wrong: `ambiguous_lexical_token` (+28, protective) exists to model precisely this collision.

So: **an ordinary-language category is evidence about the string, not about the referent.** It defeats nothing that carries positive semantic evidence. It classifies only in the absence of one. Getting this wrong in either direction is the difference between a contract that protects real people and one that does not, and it cannot be recovered by weight tuning.

### 4.2 On score magnitude

`Academic Senate` scores 99. `Amy Miller` scores 79. Any contract that reads the score as semantic strength gets this population exactly backwards, and §0 is the proof that this already happened once in shipped code. **The score is a name-likeness measurement and must not appear anywhere in the interpretation.**

---

## 5. Conflict and abstention

### 5.1 The most important rule: usage evidence must lose its suppressive power

`scoring.ts:961`:

```ts
if (isHeadingLike(occurrences, blocksById) && positiveReasons.length === 0) {
```

Run against the real engine, `Academic Senate` with **every occurrence in a header block**, twice:

```
contextual = none                     score 67   reasons: moderate_frequency_bonus, strong_name_structure, heading_context
contextual = contextual_possessive    score 99   reasons: moderate_frequency_bonus, contextual_person_evidence, strong_name_structure
```

Identical structural facts. **One weak, demonstrably false possessive reading of *"the Academic Senate's agenda"* deletes the only non-person structural signal the candidate had, and moves it 32 points up the scale.**

This is the sharpest available argument for the boundary. It is not that contextual evidence is wrong — the rule reported the sentence's shape correctly. It is that *contextual evidence entered a channel where its presence was read as "this candidate has been positively identified,"* and that channel gated a structural counter-signal. Under P4 the two facts coexist: usage evidence on one side, universal heading distribution on the other, conflict recorded, class `unresolved`.

### 5.2 The four witness cases, resolved by the contract

| candidate | evidence | interpretation | why |
|---|---|---|---|
| `Amy Miller` | `strong_name_structure` only | **UNRESOLVED_NAME_SHAPED** | P3. No semantic evidence in either direction |
| `Grade Rosters` | `strong_name_structure` only | **UNRESOLVED_NAME_SHAPED** | P3. *Identical input, identical output — this is the contract working, not failing* |
| `Academic Senate` | shape + `contextual_possessive` (false) | **UNRESOLVED_NAME_SHAPED** | P4: usage alone, no corroborator. Under capability X, `organizations`/`document-titles` on distribution evidence |
| `Perias, Nelly` | `surname_given_structure` only | **UNRESOLVED** today; **PERSON/supported** once representation defect #1 is repaired — `nelly` is already in the 23-entry lexicon and the last-first branch returns before consulting it |

### 5.3 Abstention is a first-class outcome

The interpreter must be able to say *"I cannot distinguish `Amy Miller` from `Grade Rosters` with the evidence I possess"* — and the reviewer must be told that in those words. The current architecture has no way to say it, which is why it says something false instead.

---

## 6. Live-population counterfactual

### Method and its honest limit

`app/investigation/interpretation-counterfactual.ts` runs the **real** `scoreCandidateQuality` (with real contextual evidence built through the real `combineContextualWeights`), the **real** `semanticTypeFor`, `deriveRecommendation`, `triageSectionFor` and `evidenceFaithfulOpener`, then applies the §3 contract over the same evidence.

**Your live document is not in this repository.** The population is therefore every candidate string recorded across the four 2026-08-09 reports plus the frozen witness set — **91 units**, with contextual rules taken verbatim from the live witness-audit console output. This is a real sample of the live set, **enriched for the C1 residue** because that is what those reports were about. The harness reports its own enrichment:

```
sample: current People 71  →  C1 (semanticTypeFor) 53   = 75% retention
live  : current People ~269 →  C1 139                    = 52% retention
```

So the sample over-represents exactly the hard cases. Treat the Unresolved share below as an **upper bound**, and run `__docscrub.people()` for exact live counts.

### Results — 91 units

```
CURRENT (Item Check triage)          PROPOSED (routing consumes interpretation)
   people          71                   unresolved-name-shaped   51
   common-words    12                   other                    20
   institutional    4                   people                    7
   acronyms         3                   organizations             5
                                        dates-terms               4
                                        acronyms                  3
```

**Risk to real people — the number that decides everything:**

```
real people in sample                          21
  interpreted PEOPLE                             7
  interpreted UNRESOLVED (acceptable)           14
  interpreted CONFIDENTLY NON-PERSON (serious)   0
```

**Pollution:**

```
known non-people in sample                     63
  currently routed to People                    47
  still in People after interpretation           0
```

### Members

**`people` (7)** — Diana · Sarah · Giancarlo Banuelos · Christopher Cobb · Nelly Perias · Tamara Yamada · Jordan Lee

**`organizations` (5)** — Records Team · Academic Records · Enrollment Services Team · Team · Faculty
*(three of these are in People today; `Enrollment Services Team` reaches People through the token gate)*

**`dates-terms` (4)** — Spring Semester · Winter Grading · Fully Online · Tuesday, March

**`acronyms` (3)** — ITS · PERC · NSC

**`other` (20)** — Data Warehouse · Term Activation · Service Indicator Codes · Good Morning · Course Catalog · Hello All · Thanks Andrew · Thank You · Here's · That's · It's · Also · Having · Housing · Morning · Thank · Last · The · Grades · Provost

**`unresolved-name-shaped` (51)** — Amy Miller · Jeffrey Lam · Bobbie Galaz · Chelsye Angelina · Perias, Nelly · Yamada, Tamara · Cobb, Christopher · Chriztopher Johnson · Agnes Wu · Amy Nakamura · Kyle Barrera · Garcia · Joanne · Collier, Tanesha · Academic Senate · Grade Rosters · Financial Aid · Message List · Term Withdrawals · Grade Entry · Academic Service · Student Final Exam · Clearinghouse Webinar · Timekeeper Overview · Computer Science · External Education · San Diego · Word Documents · Residency Specialists · Transfer Credit · Last Call · Final Grades · Student Success · Campus Community · Help Desk · Change Request · Business Process · Staff Course · Preview Day · Final Exams · Degree Planner · Start Date · Reason Code · Student Final Exa · Term Withdra · Virtual Clearinghouse Academ · Priority Registrati · Math Option · Workflow Shift · Systemwide Meeting · Scheduling

### Separability under three variants

```
                                                          People  Unresolved  real people   false
                                                                               in People   inclusions
interpretation only                                          7        51          7/21         0
+ representation defect #1 (last-first reads the            11        47         11/21         0
  EXISTING 23-name lexicon — a one-line fix, free)
+ defect #1 + X1 (1,805-name EN list)                       15        43         15/21         0
```

Still unresolved at the best variant: `Bobbie Galaz`, `Chelsye Angelina`, `Chriztopher Johnson`, `Kyle Barrera`, `Garcia`, `Joanne`. The first three are the unusual-spelling residual §6 of the X1 measurement already identified as the honest ceiling; the last two are single tokens carrying contextual usage evidence and nothing else.

**Zero false inclusions and zero real people confidently classified as non-people, in every variant.** That is the contract's most important property and it holds because P3 sends *everything* ambiguous to one honest state rather than guessing.

---

## 7. Frozen witness set

Provenance is `detectedType: "person"` for every row — a regex verdict, carried but never consulted.

| candidate | evidence | interpretation | why | destination |
|---|---|---|---|---|
| **Amy Miller** | `strong_name_structure` | UNRESOLVED | P3 — shape only | Possible names — unconfirmed |
| **Jeffrey Lam** | `strong_name_structure` | UNRESOLVED | P3 | Possible names |
| **Bobbie Galaz** | `strong_name_structure` | UNRESOLVED | P3 | Possible names |
| **Chelsye Angelina** | `strong_name_structure` | UNRESOLVED | P3 | Possible names |
| **Perias, Nelly** | `surname_given_structure` | UNRESOLVED → **PERSON** after defect #1 | `nelly` is in the existing lexicon; the branch never asks | People |
| **Yamada, Tamara** | `surname_given_structure` | UNRESOLVED → **PERSON** after defect #1 | `tamara` likewise | People |
| **Cobb, Christopher** | `surname_given_structure` | UNRESOLVED → **PERSON** after defect #1 | `christopher` likewise | People |
| **Chriztopher Johnson** | `strong_name_structure` | UNRESOLVED | P3; no lexicon reaches this spelling | Possible names |
| **Diana** | `known_first_name` + `expanded_common_language_token` | **PERSON / supported** | P2; the ordinary-word category is defeasible (§4.1) | People |
| **Sarah** | `known_first_name` + `expanded_common_language_token` | **PERSON / supported** | same | People |
| **Academic Senate** | shape + `contextual_possessive` ×2 | UNRESOLVED | P4 — usage alone, uncorroborated | Possible names |
| **Grade Rosters** | `strong_name_structure` | UNRESOLVED | P3 — *identical to Amy Miller, by design* | Possible names |
| **Financial Aid** | `strong_name_structure` | UNRESOLVED | P3 | Possible names |
| **Message List** | `strong_name_structure` | UNRESOLVED | P3 | Possible names |
| **Term Withdrawals** | `strong_name_structure` | UNRESOLVED | P3 | Possible names |
| **Grade Entry** | `strong_name_structure` | UNRESOLVED | P3 | Possible names |
| **Academic Service** | `strong_name_structure` | UNRESOLVED | P3 | Possible names |
| **Student Final Exam** | `strong_name_structure` | UNRESOLVED | P3 | Possible names |
| **Clearinghouse Webinar** | `strong_name_structure` | UNRESOLVED | P3 | Possible names |
| **Timekeeper Overview** | `strong_name_structure` | UNRESOLVED | P3 | Possible names |
| **Computer Science** | shape + `contextual_coordination` | UNRESOLVED | P4 | Possible names |
| **External Education** | shape + `direct_address` + `human_subject` | UNRESOLVED | P4 — two usage rules are still one kind of claim | Possible names |
| **San Diego** | shape + `contextual_human_object` | UNRESOLVED | P4 | Possible names |
| **Word Documents** | shape + `contextual_direct_address` | UNRESOLVED | P4 | Possible names |
| **Residency Specialists** | shape + `contextual_coordination` | UNRESOLVED | P4 | Possible names |

**Every real person either reaches People or lands in an honestly-labelled unresolved state with no bulk vocabulary. None is confidently called a non-person.** Every non-person leaves People. Fifteen of the twenty-five land in the same bucket, which is the contract admitting what it does not know rather than manufacturing a distinction.

---

## 8. Product payoff — quantified, including the case against

### What the reviewer sees

Today: a **Likely People** section headed *"Likely personal names"*, offering **Accept All → Keep**, containing `Academic Senate`, `Grade Rosters`, `Financial Aid`, `Message List`, `Term Withdrawals`, `Grade Entry`, `Reason Code`, `Student Final Exam`, `Timekeeper Overview` — with six of them captioned *"Almost certainly a person's name."*

Under the contract, on the sample: **People 7–11, all of them real people, zero pollution.** Every section heading becomes a true statement. The bulk action *"These are people's names → Keep"* becomes trustworthy for the first time, which is the actual objective.

### Projected live

Scaling the sample's post-C1 behaviour onto the live C1 residue of 139:

```
People                    ~18   (~29 with representation defect #1 repaired)
Possible names            ~110
already-routed sections    130  (unchanged — C1 handles these today)
```

### Against my own case, and I am not going to soften this

**~110 Unresolved beside ~18–29 People is very close to the shape you named as failure.** Your own test was: *"People 35 / Unresolved 180 — then we may merely have renamed the garbage pile."* This lands nearer that than to the good case.

Three things distinguish it from a pure rename, and you should weigh them rather than take my word:

1. **The pile is renamed *truthfully*, and loses its weapon.** Today the pile is inside People, captioned "Likely personal names," under a one-key bulk Keep. A section called *"Possible names — unconfirmed"* with **no bulk vocabulary** and a per-item sentence saying *"Two capitalized words. No name evidence was found"* is a materially different object even at the same size. Today's arrangement puts real names inside a bulk-accept blast radius; that is the risk being removed.
2. **A third of the sample gained a real semantic home** — 32 of 91 to organizations, dates-terms, acronyms and other — including family-I units the token gate currently discards.
3. **§0 is fixed at the root**, not patched. No further deviation is needed on the confidence language, because the noun would come from the interpretation instead of the detector.

What it does **not** do: shrink the reviewer's total workload. Same units, better-labelled. If your threshold is "fewer things to look at," this fails it, and §12 says what would pass it.

---

## 9. UI semantics that become invalid

| phrase | site | what it currently describes | verdict under the contract |
|---|---|---|---|
| *"Likely personal names."* | `TRIAGE_SECTION_EXPLANATIONS.people` | **routing** (E) presented as interpretation | valid once People requires P2; invalid today |
| *"These are people's names" → Keep* | `triageQueue.ts:455` bulk action | routing | the dangerous one — a bulk semantic assertion over an unassessed population |
| *"Almost certainly a person's name"* | `confidenceOpener` | **confidence** (score) + **provenance** (detector) presented as interpretation | invalid. §0 shows it now fires *only* on false positives |
| *"Possibly name-shaped text. No name evidence was found."* | `evidenceFaithfulOpener` (dev. #7) | evidence — **correct**, and the only phrase in the system that is | keep; it is the model for the rest |
| *"Highly likely"* chip | `app.ts:4461` `confidenceBand` | confidence in name-*likeness* | valid in isolation, misleading beside a personhood noun. Left untouched by dev. #7, correctly |
| *"None are names"* | `app.ts:6984` | a bulk **interpretation** the reviewer asserts | valid — it is the reviewer's claim, not DocScrub's |
| *"Person's name" / "Not a name"* chips | `recommendations.ts:461` | the reviewer's disposition | valid — correctly framed as the reviewer speculating, not DocScrub concluding |
| *"Likely a shortened reference to a larger name."* | `shortened-name` archetype | evidence-backed (recognition gate) | valid |
| **audit narrative** | `buildExplanation` → `AuditExporter` | inherits every conflation above | `AuditRecord.AuditedCandidate` stores `detectedType` and **no interpreted type** — so an audit record today preserves provenance only |

**The confusion in one sentence:** the UI has four distinct concepts — provenance, evidence, interpretation, confidence — and three vocabularies, and the noun in the most prominent sentence comes from the concept with the least authority.

---

## 10. Architectural consequences

**What the interpreter owns:** the mapping from typed evidence to `{class, support, basis, contra}`. Nothing else.

**What it must not own:** detection, scoring, lexicons, thresholds, decisions, sectioning, copy. It is a pure function over facts other engines computed — the same constraint `residualReviewGate.ts` already states for itself, and that constraint has held.

Answering your specific questions:

- **Scoring precedes interpretation.** Scoring produces evidence; interpretation reads it. Reversing that would make scoring conditional on class and reintroduce the collapse one level up.
- **Detector-specific scores survive, unchanged and unread by the interpreter.** The score is still the right ranking key for review order. It is simply not a semantic input.
- **`semanticTypeFor` is *absorbed*, not replaced.** It becomes `interpretCandidate` by four bounded changes; the existing name can stay if you prefer continuity for Type Check's imports.
- **Type Check and Item Check must consume the same interpretation.** They already should — Type Check's cards and Item Check's sections currently disagree about the same candidate, which is a bug users can see.
- **Audit must preserve both.** `AuditedCandidate` gains `interpretedClass` + `support` beside the existing `detectedType`. Additive, and it is the record that makes a disputed resolution reviewable.
- **Interpretation must be recomputable when Ambiguity/Group Check creates evidence.** Linkage is an input, so confirming a group changes the answer. But the **decision-blind stability contract must hold**: a candidate must not move between sections because it was *decided*. Recompute on evidence change, never on decision change — and the existing `semanticTypeGroups` computed once at load is where that discipline currently lives.
- **Candidate-level, with occurrence-level *inputs*.** Decisions are per-candidate, so a per-occurrence class would have nowhere to go. Capability X (§12) is an occurrence-level observation aggregated to a candidate-level claim, which is the right shape.
- **Saved sessions:** interpretation is derived and must not be persisted, exactly like quality and grouping. A session saved before the change and reopened after must show the new interpretation and the *same decisions*. This is safe today because decisions are per-candidate and sections are per-render — but it must be asserted, since the section a decided item sits in will move.

---

## 11. The minimum architecture

Not a new engine. Four bounded changes:

1. **Split the category channel.** Replace the single `qualityCategoriesOf` array with a typed `CandidateEvidence` record derived from the assessment. This is the actual architecture; everything else is small once it exists. It requires no change to `scoring.ts` — the classifier is a *reader* of `filterRules`/`positiveReasons`/`contextualRules`, all of which already exist as separate fields on `ScoredQuality`.
2. **`semanticTypeFor` → `interpretCandidate`.** Same file, same vocabulary plus one member: (a) drop `strong-name-structure` / `surname-given-structure` from the people branch; (b) add `unresolved-name-shaped`; (c) take `CandidateEvidence` rather than a string array; (d) return `{class, support, basis, contra}` instead of a bare id.
3. **Item Check routes through it** — the C1 change, which is a *deletion* of the `detectedType` fallback in `triageSectionFor`.
4. **The UI noun comes from `class`, not from `entityType`.** Deviation #7's branch becomes unnecessary and can be retired rather than extended.

That is one domain module, one UI module, one call site, and one new section label. `patterns.ts`, `scoring.ts`, `contextual-rules.ts`, `anchor-rules.ts`, `resolution.ts` and `residualReviewGate.ts` are untouched.

---

## 12. Verdict

### **B — YES, BUT.**

**The post-detection interpreter is the correct missing layer, and one bounded evidence capability is missing before it materially improves review rather than relabelling it.**

Not **A**, because the measurement will not support it. On the sample, interpretation alone leaves 51 of 91 units in Unresolved and only 7 in People; projected live that is ~110 vs ~18. The reviewer's workload does not fall, and by your own §8 test that is close to the failure shape. Claiming A would repeat the mistake the 08-09 passes made three times: recommending on architecture instead of on numbers.

Not **C**, because "unify what exists" understates it. The existing machinery cannot be unified into correctness — `semanticTypeFor` accepts shape as person evidence, `positiveReasons` mixes usage with identity, and `qualityCategoriesOf` changes meaning depending on whether a dictionary fired. Those are three separate representational defects and no amount of consolidation removes them. That said, C is the *nearest* wrong answer, and its instinct — do not build a new engine — is right and is honoured in §11.

Not **D**, because the problem is not elsewhere. §0 is a shipped, reviewer-visible defect whose direct cause is the missing boundary.

Not **E**, because the diagnostic that would settle it has now been run.

### Capability X — occurrence-distribution evidence

**The interpreter has no B-side evidence for this population at all.** By construction: `semanticTypeFor` tests organizations, calendar, acronyms and document-titles *before* people, so everything with strong non-person evidence has already left. The residue is defined by having none. That is why 44 non-people and 14 real people share one bucket, and why nothing lexical can separate them — the 08-09 verdict proved that empirically and X1 proved it again.

The one signal that can, and that DocScrub already computes:

**`occurrence-classifier` assigns every occurrence a `groupKind` of `standalone` or `contextual`, and nothing consults it for meaning.** `Amy Miller` appears in message prose. `Grade Rosters`, `Reason Code`, `Start Date` and `Degree Planner` are interface and table labels that never do. A candidate **all** of whose occurrences are `standalone` — never once embedded in a sentence — is making a structural claim about itself that is genuinely in the document, is lexicon-free, is language-independent, and is the universal form of the `heading_context` idea that §2.3 of the 08-09 verdict identified and could not use.

Why this and not a bigger lexicon: it is the only candidate that moves *non-people out* rather than *people in*. X1 at 26,411 entries rescued three controls, the same as the existing 23. Distribution evidence is orthogonal to name coverage entirely, so it works on `Chelsye Angelina` and `Chriztopher Johnson` — the class no lexicon reaches.

**It is unmeasured.** I could not price it: the sample has synthetic occurrence contexts, and the live block structure is in your browser. That is the honest state, and it is the next measurement rather than the next implementation.

---

### 1. Expected reviewer-visible payoff

People falls from ~269 to ~18–29, contains only real people, and its bulk Keep becomes trustworthy. Every section heading and every per-item sentence becomes true. ~110 units move to a new, honestly-named, **bulk-action-free** section. Total workload is unchanged. With capability X, the ~110 is the number that should fall, and by how much is currently unknown.

### 2. Expected risk to real people

**Low, and lower than today.** Measured: 0 of 21 real people confidently classified as non-people, in all three variants. 14 land in Unresolved, which you have already said is acceptable. The destination has **no bulk vocabulary**, so a misrouted real name cannot be swept — unlike today, where it sits inside People's bulk-Keep blast radius. The residual risk is a reviewer skimming a large Unresolved section, which is a *presentation* risk and is the same one that exists today under a more dangerous label.

### 3. Implementation scope

**Moderate.** Small in lines, wide in surface. The four changes in §11 are contained, but items move between sections on a shipped stage, Type Check's cards change, and the section vocabulary gains a member. Budget the verification, not the code.

### 4. Components to reuse exactly as they are

`domain/semanticTypes.ts` (vocabulary, ordering, labels, `buildSemanticTypeGroups`) · `CONTEXTUAL_RULE_WEIGHTS`'s anchor/usage tier split · `ScoredQuality`'s existing separate fields · `occurrence-classifier`'s `groupKind` · `documentNameEvidence.ts`'s three-source model · `residualReviewGate.ts`'s "decision procedure over evidence" constraint, as the stated precedent · `evidenceFaithfulOpener`'s evidence-faithful *style*.

### 5. Components whose responsibilities change

`semanticTypeFor` → becomes the interpreter · `qualityCategoriesOf` → becomes a typed projection · `triageSectionFor` → loses the `detectedType` fallback · `deriveRecommendation` → keeps the archetype (an action vocabulary) but stops being the de facto type classifier · `explanation-builder` → takes its noun from `class` · `AuditedCandidate` → gains `interpretedClass` + `support`.

### 6. What must NOT change

`patterns.ts` — **detection stays broad and high-recall; that is the premise, not the problem** · `scoring.ts` — the Python port and its parity surface · `contextual-rules.ts` / `anchor-rules.ts` — the rules report sentences correctly; only how their output is *read* is wrong · `residualReviewGate` · the decision model · the acronym `human_subject` firings (`PERC`, `ITS`, `NSC`) which the 08-09 audit correctly ruled not-a-defect · the exact-key-only discipline in entity resolution.

### 7. Smallest implementation sequence, if you later approve it

1. **Measure capability X first.** Extend `__docscrub.people()` to report, for every C1-residue unit, the `standalone`/`contextual` split of its occurrences, and the counts for a candidate-level "every occurrence standalone" predicate — cross-tabulated against your person controls. **This is a diagnostic, and it decides whether the whole thing is worth building.** If real people show the same distribution as table labels, stop; the residue is not separable and the right move is the honest label alone.
2. **Representation defect #1** — move the known-given-name lookup so the last-first branch reaches it. Free, already measured, +4 real people into People. Oracle deviation; needs classification and a behavioural suite.
3. **Split the evidence channel** (§11.1). No behaviour change; every existing consumer keeps working. This is the change that makes the rest safe.
4. **`interpretCandidate`** (§11.2), with Type Check as the only consumer at first — so the vocabulary is exercised before it routes anything.
5. **Route Item Check through it** (§11.3) plus the *"Possible names — unconfirmed"* section, no bulk vocabulary.
6. **UI noun from `class`** (§11.4); retire deviation #7's branch.
7. **Audit fields.** Last, because it is additive and blocks nothing.

Steps 3–4 are inert to the reviewer. Step 5 is the visible one and is the point of no return; step 1 is what tells you whether to reach it.

---

## Appendix — running the harness

```
cd app
node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs \
     investigation/interpretation-counterfactual.ts
```

Sections: **A** current routing vs proposed interpretation, per unit · **B** section counts · **C** members by class · **D** risk to real people · **D2** the positive-reasons gate demonstration · **E** pollution removed · **F** the frozen witness set · **G** separability under three variants · **H** calibration against the live run · **I** what the UI says today.

Nothing in `src/` is imported *by* it; it imports *from* `src/` and mutates nothing.
