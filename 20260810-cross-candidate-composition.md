# Cross-Candidate Composition — Findings and Verdict

**Date:** 2026-08-10
**Supersedes:** §12 of `20260810-detection-interpretation-routing-boundary.md` (Capability X). §1–§11 of that document stand, as corrected there.
**Production changes:** exactly one — oracle deviation #8, the last-first representation fix (§2). Plus read-only diagnostic instrumentation.
**Verification:** 67/67 suites, 0 failures. `tsc --noEmit` clean. `tsc` build clean.
**Verdict (§13): A — GO.**

---

## 1. Findings carried forward

Preserved as instructed; each re-verified against source during this pass unless marked.

- Detection and semantic interpretation are too tightly coupled. `scoring.ts` early-returns for non-person detections, so every quality score is conditional on the person regex.
- `strong_name_structure` is shape evidence. `TWO_NAME_RE` is two capitalized tokens.
- Detector provenance must not become semantic truth. `triageSectionFor`'s `case null: detectedType === "person" ? "people" : "other"` is the live counterexample.
- `contextual_person_evidence` contains false positives — Academic Senate, Computer Science, External Education, San Diego, Word Documents, Residency Specialists.
- **Capability X failed.** 9/139 fired; all-heading/table 0/139; base rate 3% across all 569 person candidates. Prose contains both real people and administrative phrases. Nomination withdrawn.
- R4 removed 0 on the live residue.
- The current evidence representation makes real people and obvious non-people indistinguishable.
- Four of the highest-occurrence residue candidates are real people hit by the last-first defect: `Goodloe, Andrew` (742 occurrences), `Perias, Nelly` (724), `Yamada, Tamara` (547), `Collier, Tanesha` (400).
- Separating detection from interpretation eliminates false semantic claims without misclassifying known people — but left the unresolved population too large.

### 1.1 The evidence-taxonomy correction, made durable

`email_address_evidence` and `signature_or_email_header_context` are **NOT class-A semantic-positive person evidence.** They are **class E — corroboration / proximity only.**

Falsified by the live run:

```
Degree Planner       99   small_frequency_bonus, email_address_evidence, strong_name_structure
Automate Approvals   88   single_occurrence, signature_or_email_header_context, strong_name_structure
```

Both are non-people; both would have been routed PEOPLE/supported by the contract as first written. Neither signal is a claim about the candidate — both are claims about its *neighbourhood*, and in a mail corpus proximity to an address or signature block is close to ambient. Recorded in `20260810-detection-interpretation-routing-boundary.md` §4.0 and amended in that document's §4 table in place.

---

## 2. Oracle deviation #8 — the last-first representation fix

### The defect

`scoring.ts` tested `LAST_FIRST_RE` and returned before reaching the known-given-name lookup, which lived inside the `TWO_NAME_RE` branch below it. Same person, two spellings, two different evidence records:

```
Christopher Cobb     strong_name_structure + known_personal_name_token
Cobb, Christopher    surname_given_structure                            <- nothing
```

`christopher`, `nelly`, `tamara`, `andrew` and `tanesha` are **all already in `KNOWN_GIVEN_NAMES`**. The lexicon had the answer; the branch order hid it.

### The fix

The lookup is hoisted above both branches and consumed by both. `KNOWN_GIVEN_NAMES` is untouched — no widening, no new source, no new rule. Roughly fifteen lines.

**Classification: correctness / representation consistency.** Python shares the branch order, so this is a deliberate divergence from the oracle, recorded at the hoist site in `scoring.ts` and pinned by `verify/last-first-name-evidence-verification.ts` (48 checks).

### Blast radius — measured, not asserted

| surface | effect |
|---|---|
| score | 94 → 99 (clamped) for an affected candidate |
| status / quality label | **unchanged** — both sides were already `ToReview` / `Strong` |
| categories | gain `known_personal_name_token`; `hasKnownNameEvidence()` becomes true |
| archetype | **unchanged** — every archetype gate reading name evidence also requires `personTokenCount <= 1`, and a last-first candidate has two tokens |
| review tier | may move `null` → `needs-review` where identity options exist — the intended correction |
| `semanticTypeFor` | unchanged; `surname-given-structure` already routed these to `people` |
| residual gate | unchanged; rule 1 is single-token-only |
| ambiguity routing | `nameEvidence` flips true, so affected units move out of Other Words |
| audit narrative | *"Likely name-shaped text. No name evidence was found."* → *"Almost certainly a person's name."* |

That last row is deviation #7 working correctly for the first time on this population. **It is not a regression and was not compensated for.**

### The one test that failed, and why it was updated rather than preserved

`verify/scoring-smoke.ts` asserted `Smith, Jane → ["single_occurrence", "surname_given_structure"]`, captured from Python. `jane` is in `KNOWN_GIVEN_NAMES`. **That expectation depended on the defect**, so it was updated and annotated, and a control (`Smith, Zeeb`, given name not in the lexicon) was added beside it. Per instruction, no compensation was added to preserve the old output.

`verify/quality-parity.ts` passed unchanged — no domain-parity fixture contains a last-first name whose given name is in the lexicon, which bounds the fixture-level blast radius to zero.

---

## 3. The new baseline diagnostic

`__docscrub.people()` now opens with a **NEW BASELINE** table, because the fix changed the representation of the population and the old 139/220 must not be reasoned from. It reports person-typed candidates, Item Check → People, and that population split into *positive person evidence* / *shape-only* / *conflicting* / *no evidence at all*, plus the exact list of comma-form candidates deviation #8 rescued.

---

## 4. Feature matrix — is the information already present?

Built over the **real live 139-unit C1 residue** (transcribed from your run, with production's own occurrence counts) using only production evidence and production lexicons. `app/investigation/feature-matrix.ts`.

Single-feature separation, each measured alone:

```
feature                                        known people    known non-people    lift
known given-name token (post #8)               21/30 =  70%     2/106 =  2%        (person signal)
surname_given_structure                        10/30 =  33%     5/106 =  5%        (person signal)
R1 every token an ordinary English word         1/30 =   3%    62/106 = 58%        +55 pts
shares a token with >=3 candidates              0/30 =   0%    55/106 = 52%        +52 pts
shares a HEAD noun with >=2 candidates          0/30 =   0%    26/106 = 25%        +25 pts
is a proper prefix of another candidate         3/30 =  10%    12/106 = 11%         +1 pt
all occurrences standalone (Capability X)       0/30 =   0%     9/106 =  8%         +8 pts
```

### The finding

**The discriminating information is present, and it is not inside any single candidate — it is in the relationship between candidates.**

A human recognises `Grade Rosters` as a system term partly because the same document also contains `Grade Entry`, `Grade Posting Process`, `Grade Rosters Closed / Created / Posted`, `Incomplete Grade`, `Grade Pro`. **Domain vocabulary recurs across unrelated phrases. Personal-name tokens do not** — when a name token recurs it recurs across spellings of *one person*, and that is a relationship entity resolution already owns and the safety gate already reads.

The index, built from nothing but the document's own candidates:

```
"grade"    x8   Grade Rosters | Grade Entry | Grade Posting Process | Grade Rosters Closed/Created/Posted | Incomplete Grade | Grade Pro
"student"  x7   New Student | Student Final Exam | Student Homepage | Dear Student | Student Final Exa | Student Groups | Student Success
"rosters"  x5   Grade Rosters | Grade Rosters Closed/Created/Posted | Not Class Rosters
"term"     x5   Term Withdrawals | Term Activating | Term Withdra | Term Withdrawl | Term Withdrawls
"science"  x5   Computer Science | Science Teacher Initiativ/Initiative/Initiatives | Science Teach
"date"     x3   Last Date | End Date | Start Date
"time"     x3   End Time | Pacific Standard Time | Start Time
"reason"   x3   Action Reason | Reason Code | Reason Codes
"planner"  x3   Smart Planner | Degree Planner | My Planner
… 17 tokens at x3 or more, 0 known people among any of them
```

Where every known real person sits:

```
person                 tokenShare  headShare      person               tokenShare  headShare
Goodloe, Andrew            1          1           Amy Miller               1          1
Perias, Nelly              1          1           Bobbie Galaz             1          1
Yamada, Tamara             1          1           Chelsye Angelina         1          1
Collier, Tanesha           2          1           Jeffrey Lam              1          1
Cobb, Christopher          1          1           Chriztopher Johnson      1          1
Fox, Liud / Liudmila       2          1           Giancarlo Banuelos       1          1
```

Maximum 2, and both 2s are the *same person twice* — `Fox, Liud` / `Fox, Liudmila`, which is entity resolution's case and is protected by the gate before any rule runs.

---

## 5. Failure families

The residue is **not** 139 unrelated mistakes. Derived from the live population, not imposed:

| family | units | known non-people | known people | why the system calls them People | deterministic rule available? | collision risk |
|---|---|---|---|---|---|---|
| **F1 domain vocabulary** — a token recurs across ≥3 distinct multi-token candidates | 54 | 54 | **0** | shape only; no phrase-level category fires | **yes** — token-share index | none measured |
| **F2 head-noun paradigm** — shares a head noun with ≥2 others (`Date`/`Time`/`Deans`/`Meeting`) | 7 | 6 | **0** | same | **yes** — head index | none measured |
| **F3 truncation / abbreviation** — proper prefix of another candidate | 4 | 4 | **0** | source-literal PeopleSoft labels; detector is correct | **yes** — prefix containment | `Fox, Liud` ⊂ `Fox, Liudmila` — gate-protected |
| **F4 ordinary-language phrase** — R1 only | 23 | 22 | **1** | multi-token gate in `recommendations.ts` discards the evidence | **yes but UNSAFE** — loses `Amy Miller` | **real** |
| **F5 unreached** — no composition fires | 20 | 14 | 4 | genuinely no evidence either way | **no** | n/a |

**Your hypothesis was almost exactly right.** It is 3 mechanically addressable families (65 units), 1 addressable-but-unsafe family (23), and ~20 genuinely ambiguous units — not 139 individual failures.

---

## 6. Composition / representation / missing evidence

| family | class | justification |
|---|---|---|
| F1 | **A — COMPOSITION DEFECT** | every token, every candidate and every lexicon already exists. Nothing in the pipeline has ever asked a cross-candidate question. |
| F2 | **A — COMPOSITION DEFECT** | same index, restricted to the final token. |
| F3 | **A/B** | `truncationDiagnostics.ts` and `FullValueAliasProvider` already model this; neither is consulted for interpretation. Composition of existing output, plus a representation gap in where truncation facts are attached. |
| F4 | **B — REPRESENTATION DEFECT** | the ordinary-language evidence exists and is *discarded by a token gate* (`singleTokenNonName` requires `personTokenCount <= 1`). But the residual unsafety is genuine: `Amy` is not protected by `ambiguous_lexical_token` while `May`, `Grace`, `Will` and `Rose` are. Fixing that by widening the ambiguity lexicon is dictionary-widening and is out of scope here. |
| F5 | **C — GENUINELY MISSING EVIDENCE** | `Bobbie Galaz`, `Chelsye Angelina`, `Jeffrey Lam`, `Chriztopher Johnson` vs `Clearinghouse Webinar`, `Timekeeper Overview`, `Automate Approvals` — no available signal separates them. This is the information ceiling and it is ~20 units, not ~130. |

**No new detection capability is proposed for F1–F4.**

---

## 7. What the contextual machinery already represents

Inventory of `contextual-rules.ts` and `anchor-rules.ts`:

| role you named | represented today? |
|---|---|
| human grammatical subject | **yes** — `contextual_human_subject` |
| human recipient / object | **yes** — `contextual_human_object` |
| speech / communication attribution | **yes** — `contextual_attribution` |
| personal possessive | **yes** — `contextual_possessive` (conflates the clitic copula; known defect) |
| title + candidate | **yes** — `nearby_title`, `anchor_full_name_with_role` |
| candidate after greeting / address | **yes** — `contextual_direct_address` |
| coordination / person list | **yes** — `contextual_coordination`, `contextual_person_list` |
| **institutional subject** | **NO** |
| **object of an interface / process verb** (`open`, `select`, `submit`) | **NO** |
| **modifier of a process noun** (`process`, `form`, `report`, `code`, `page`) | **NO** |

### The asymmetry, stated plainly

**DocScrub has eleven contextual rules that can say "person" and zero that can say "not a person."** Every false firing in your witness audit is a direct consequence: *"the Academic Senate's agenda"*, *"contact External Education"*, *"ask San Diego"* are all grammatically indistinguishable from person usage **to a rule set that only knows one answer.**

This is a genuine structural gap and it is worth naming. **I am not proposing to fill it**, and the reason is in the measurement above: the three composition rules already reach 65 units with zero person risk, and building a symmetric non-person grammar would be exactly the "deterministic English-language LLM" you ruled out. Recorded as the largest known unexplored area, not nominated as work.

---

## 8. The interpreter as arbiter

The contract from §3 of the boundary document, amended by §1.1 and extended with composition evidence. Unchanged in shape: it arbitrates, it does not detect.

```
SAFETY GATE — evaluated before any composition rule is consulted.
A unit is ELIGIBLE only if it carries NONE of:
    name-lexicon evidence · surname/given structure · nearby title ·
    contextual anchor · contextual usage · person-evidenced entity linkage ·
    ambiguous_lexical_token

COMPOSITION — over eligible units only, never as a person disqualifier
    C1  a token appears in >=3 distinct multi-token candidates    -> domain vocabulary
    C2  head noun shared with >=2 distinct candidates             -> paradigm member
    C3  proper prefix of another candidate                        -> truncation/abbreviation

OUTPUT
    SUPPORTED PERSON            positive semantic evidence (never shape, never proximity)
    SUPPORTED NON-PERSON        existing SemanticTypeId, or document/system on C1–C3
    UNRESOLVED / NAME-SHAPED    shape only, no composition fires
    CONFLICTING                 person evidence AND strong non-person type — recorded, never scored away
    provenance                  detectedType, carried separately, never consulted
```

Every interpretation is explainable in deterministic terms, exactly as you framed it:

> **Detected because:** two-token name shape.
> **Interpreted as:** administrative / system term.
> **Because:** the token `grade` occurs in 8 distinct multi-token candidates in this document, and no independent person evidence is present.

No numeric confidence appears anywhere in the derivation.

---

## 9–10. Counterfactual against the live residue

Offline, real engines, real 139-unit residue. `app/investigation/feature-matrix.ts`.

```
SAFETY GATE
  eligible                       108 of 139
  known people still eligible      5 of 30   (Amy Miller, Chriztopher Johnson, Bobbie Galaz,
                                              Chelsye Angelina, Jeffrey Lam)
  people protected by gate alone  25

COMPOSED RULES over eligible units
  C1 (token >=3)                removes 54    54 known non-people    0 people lost
  C2 (head >=2)                 removes 27    26 known non-people    0 people lost
  C3 (prefix)                   removes 12    12 known non-people    0 people lost
  C1|C2|C3   <- THE SAFE SET    removes 65    64 known non-people    0 people lost
  looser token>=2 variant       removes 76    75 known non-people    0 people lost
  + R1 (ordinary-word phrase)   removes 88    86 known non-people    1 PERSON LOST (Amy Miller)
```

**R1 is excluded.** It is the only rule that loses a person, it loses the person your whole witness set exists to protect, and it is the rule that already failed this test once.

| | current | proposed (safe set) |
|---|---|---|
| Item Check → People | **220** | ~40 supported |
| known non-people in People | ~180 | **0 in People** |
| known real people in People | 30 | 30 — none lost |
| unresolved / name-shaped | — | **74** |
| reclassified non-person | — | **65** (+ the 81 C1 already routes) |
| known real people confidently non-person | — | **0** |

**Utility: 60% of known non-person pollution removed (64 of 106), 71% under the looser token≥2 variant. Safety: 0 of 30 known real people confidently classified non-person.**

### Frozen witness disposition

| witness | disposition | why |
|---|---|---|
| `Perias, Nelly`, `Yamada, Tamara`, `Cobb, Christopher`, `Goodloe, Andrew`, `Collier, Tanesha`, `Chris, Margaret` | **SUPPORTED PERSON** | deviation #8 — known given-name token now attaches |
| `Diana`, `Sarah`, `Giancarlo Banuelos`, `Andrew`, `Tamara`, `Tanesha`, `Nelly`, `Patrick`, `Joan`, `Julie`, `Gustavo`, `Vince`, `Christopher`, `Giancarlo` | **SUPPORTED PERSON** | name lexicon |
| `Fox, Liud`, `Fox, Liudmila`, `Evelyn, Joaquin`, `Francis, Kyle` | **SUPPORTED PERSON** | surname/given structure — gate-protected before composition |
| `Amy Miller`, `Jeffrey Lam`, `Bobbie Galaz`, `Chelsye Angelina`, `Chriztopher Johnson` | **UNRESOLVED / name-shaped** | no evidence either way — the acceptable outcome |
| `Grade Rosters`, `Term Withdrawals`, `Grade Entry`, `Student Groups`, `Student Final Exam`, `Reason Code`, `Start Date`, `End Date`, `Final Exams`, `Academic Senate`, `Academic Service`, `Computer Science`, `Degree Planner`, `Smart Planner` … | **SUPPORTED NON-PERSON** | C1 domain vocabulary |
| `Associate Deans`, `Associated Deans`, `Town Hall Meeting`, `Last Day`, `Preview Day`, `Unofficial Withdrawals` | **SUPPORTED NON-PERSON** | C2 head-noun paradigm |
| `Priority Reg`, `Acad Struc`, `Display Self`, `Residency Specialist` | **SUPPORTED NON-PERSON** | C3 truncation |
| `Financial Aid`, `Message List`, `Word Documents`, `Transfer Credit`, `External Education`, `San Diego`, `Timekeeper Overview`, `Clearinghouse Webinar`, `Residency Specialists`, `Automate Approvals` | **UNRESOLVED** | F4/F5 — no safe rule reaches them |

### Largest remaining unresolved families

**F5, ~20 units** — `San Diego`, `San Marcos`, `Clearinghouse Webinar`, `Timekeeper Overview`, `Residency Specialists`, `Automate Approvals`, `Southern California Shredding Coming`, `Systemwide Registrars`, `Math Option`, `Workflow Shift`, `Drop Placeholder`, `Grad App`, `Acad Structure`, `Virtual Clearinghouse Academ`, `Priority Registrati`, `From Melissa`, plus `Bobbie Galaz`, `Chelsye Angelina`, `Jeffrey Lam`, `Chriztopher Johnson`.

**F4, 22 non-people** — reachable only by R1, which is unsafe as written.

---

## 11–12. Constraints honoured

**No UI solution.** Nothing here renames People, hides counts, collapses a section or weakens copy. The 65 units move because their *classification* changed on evidence, and the evidence is quotable back to the reviewer.

**No AI, no cloud, no model.** Every input is an existing production lexicon or an index built from the document's own candidate list. Fully deterministic, reproducible, offline, and explainable in one sentence per unit. Nothing probabilistic was introduced; there are no weights and no thresholds beyond two integer counts, both of which are structural rather than tuned — and §13 says what would falsify them.

---

## 13. Verdict

### **A — GO.**

**Existing deterministic evidence, correctly represented (deviation #8) and composed cross-candidate (C1–C3), materially cleans People while preserving safety.**

Not B: no new capability is nominated, and none is needed for F1–F3. Not C: 60–71% is not "meaningful but marginal" against your 60–80% bar. Not D: the information ceiling is real but it is ~20 units, not ~130 — `Bobbie Galaz` vs `Clearinghouse Webinar` establishes it, and that pair is a fifth of the residue rather than the whole of it. Not E: the measurement is over the real live population with real engines.

**Expected reviewer-visible result:** Item Check → People falls from **220 to roughly 40**, containing only units with positive person evidence. Roughly **65 units gain a real semantic classification** with a one-sentence deterministic explanation. Roughly **74 remain honestly unresolved**. Zero known real people are confidently classified as non-people; five land in Unresolved, which you have accepted.

### The one measurement that could overturn this — run it before I build anything

**The token-share index was measured over the 139-unit residue. Live it must be built over all 569 person-typed candidates**, and I have written the diagnostic to do exactly that. The risk is directional and specific: with 569 candidates, a common given name could reach a share of 3 (`Andrew` in `Goodloe, Andrew` / `Thanks Andrew` / `Andrew Goodloe`) and start firing on people.

Two things bound it, and the diagnostic reports both: those units are **gate-protected** by the name lexicon before any rule runs, and every removal is cross-checked against `looksLikePerson` — an independent signal the rules never consult.

**If the live run shows any name-risk flag on C1–C3, the thresholds are wrong and this verdict drops to C.** That is the test, not the removal count. I have not written the interpreter and will not until you have seen those numbers.

**Command, after rebuild and a fresh document load:**

```js
__docscrub.people()
```

New sections: **NEW BASELINE** (top, post-#8) and **CROSS-CANDIDATE COMPOSITION** (bottom) — rule table with name-risk counts, the token index itself, per-rule removal lists, the counterfactual populations, and the F1–F5 family decomposition.
