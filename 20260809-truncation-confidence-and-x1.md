# Truncation, Confidence Language, and the X1 Measurement

**Date:** 2026-08-09
**Status:** 67/67 suites, `tsc` and build clean.
**Production changes:** the confidence-language correction only. **No truncation fix was needed** (§1). **X1 was not implemented** — measurement only.
**Verdict (§10): D — the existing representation fixes alone justify one small pass before X1.** The measurement changed my recommendation; §10 says why.

---

## 1. Truncation finding — no fix required

**`Term Withdra` and its siblings are source text. DocScrub did not cut them.**

`FALLBACK_PERSON_RE`'s token is `\p{Lu}\p{Ll}{1,30}` followed by `UNICODE_WORD_END`. The lowercase run is **greedy** and the match must end on a word boundary, so given complete source text it consumes the whole word:

```
"Term Withdrawals are due Friday"          ->  "Term Withdrawals"
"Student Final Exams begin Monday"         ->  "Student Final Exams"
"Virtual Clearinghouse Academic records"   ->  "Virtual Clearinghouse Academic"
"Priority Registration opens next week"    ->  "Priority Registration"
```

It is **structurally incapable of stopping mid-word.** The only way to obtain `Term Withdra` is for the document to contain `Term Withdra` — entirely expected in a PeopleSoft/CMS correspondence set, which abbreviates field labels aggressively in its own UI.

Two independent confirmations:

- `classifyTruncation` defaults to `source-literal` and only claims damage on positive evidence — the word must **continue in the parsed block**. Its own comment names PeopleSoft labels (`Acad Struc`, `Appt Nbr`, `Comm Gen`) as the expected population here.
- The live run over **5,854 occurrences** found 7 severed and 2 token-ceiling. All nine were identifier-shaped and became oracle deviations #4 and #5. None of Andrew's fragments appeared.

**So the answer is the one you invited: these are source-literal, and "fixing" them would invent text that never existed.**

**What I added instead: a guard against a future fix.** `verify/source-literal-truncation-verification.ts` (19 checks) proves the detector cannot sever a complete word, that abbreviated source is reproduced faithfully, and — the control that makes the rest mean anything — that a genuinely severed span *is* still classified as a defect with its orphaned remainder reported. The corruption case is asserted as a resulting string in both directions:

```
source-literal:  "Term Withdra is a field label"   -> "[REDACTED] is a field label"     clean
had it severed:  "Term Withdrawals are due"        -> "[REDACTED]wals are due"          corrupt
```

---

## 2. Confidence language — fixed

### The defect

```ts
const entity = entityPhrase(entityType);   // <- the DETECTOR's type
if (likelihood >= 95) return `Almost certainly ${entity}`;
```

Noun from the detector, adverb from the score — and the score measures name-*likeness*, a weighted sum over capitalization and frequency:

```
Amy Miller      79  positiveReasons ["strong_name_structure"]  -> "Likely a person's name."
Grade Rosters   79  positiveReasons ["strong_name_structure"]  -> "Likely a person's name."
Degree Planner  99  positiveReasons ["strong_name_structure"]  -> "Almost certainly a person's name."
```

A real person and a table column received the identical sentence, because the evidence is identical. The copy was not optimistic — it was **reporting a distinction the pipeline had not made**.

### The fix

Two new exports in `explanation-builder.ts`; the ported `confidenceOpener` is left byte-identical and still exported, so the parity suite that pins it is untouched.

- `SHAPE_OR_FREQUENCY_REASONS` — the positive reasons that describe the *string* rather than its meaning: name structure, surname-given structure, initials, single-token shape, the three frequency bonuses, `heading_context`. Everything absent from it (known name tokens, honorifics, email, signature, contextual rules) legitimately speaks to personhood.
- `isShapeOnlyPersonClaim(entityType, positiveReasons)` — normalizes snake/kebab on both sides, and **requires at least one positive reason**: "no evidence at all" is a different case with its own wording, and folding it in would change a second thing under cover of the first.
- `evidenceFaithfulOpener(...)` — identical to `confidenceOpener` except in the shape-only person case, where the noun becomes *"name-shaped text"*.
- `NO_NAME_EVIDENCE_CLAUSE` — appended so the reviewer does not have to notice which evidence is *missing* from a list.

Result:

```
shape-only:  "Possibly name-shaped text because it follows a strong personal-name pattern. No name evidence was found."
real name :  "Almost certainly a person's name because it follows a strong personal-name pattern and it contains a known personal-name token."
```

**Only the noun moves.** Scores, bands, the `<opener> because <evidence>` grammar, routing, sectioning and decisions are all untouched. A high score on a shape-only candidate is not wrong — the engine really is confident the string is name-shaped — so the fix lets the sentence say that rather than suppressing the number.

### Consumers checked

| consumer | effect |
|---|---|
| `app.ts` detail-panel verdict (`detail-verdict`) | updated; reads `positiveReasons` the state already holds |
| `buildStandardSummary` → `buildExplanation("standard")` | updated |
| **audit narrative** — same function | **changes, intentionally.** An audit record asserting personhood on capitalization evidence is exactly the artifact worth not writing. The module header already flags that these strings reach audit; called out rather than buried. |
| `confidenceBand` (the "Highly likely" chip) | **untouched** — it labels the score, and the score is unchanged |
| expert/short views, accessibility text | untouched |

### Oracle deviation #7 — recorded

Python has no equivalent branch. **Classification: truthfulness fix** — the oracle's sentence is a claim about the document that the oracle's own evidence does not support. Verified by `verify/evidence-faithful-confidence-verification.ts` (34 checks), whose load-bearing half is that every candidate with real name evidence keeps Python's exact wording.

### One residual, disclosed rather than fixed

The evidence clause still reads *"because it follows a strong personal-name pattern"* — the ported evidence vocabulary. Slightly undercuts the correction. Rewriting the evidence phrase table is a wider change than this pass was scoped for.

### A test that failed on a rename

`ui-smoke.ts` failed — not on behaviour, but because it asserts the literal string `confidenceOpener(likelihood, candidate.detectedType)`. Updated, intent preserved. **It is one of the source-text assertions already queued for replacement (task #7), and it just demonstrated exactly why.**

---

## 3. X1 dataset and method

**Dataset:** given-name lists extracted from **Faker 40.36.0** (`faker.providers.person.*`), 84 locale providers.

- **multi-locale set — 26,411** unique given names
- **EN-scoped set — 1,805** (en_US/GB/CA/AU/IE/NZ/IN/PH)
- for comparison, DocScrub's `KNOWN_GIVEN_NAMES` — **23**

**License: MIT** (OSI-approved, `joke2k/faker`). See §9 for the part that is *not* settled.

**Method.** For each candidate, take the given-name position — **token 2 for `Surname, Given`, token 1 otherwise**, which models representation defect #1 rather than being blocked by it — and test membership. Run against your person controls, your non-person controls, the known collision shape, and against DocScrub's own non-person lexicons to measure the collision *surface* independently of any one document.

---

## 4. Live measurement

### A. Real people

```
                       first token      already?  26k    1.8k EN
Amy Miller             amy              n         HIT    HIT
Jeffrey Lam            jeffrey          n         HIT    HIT
Bobbie Galaz           bobbie           n         HIT     -
Chelsye Angelina       chelsye          n          -      -
Giancarlo Banuelos     giancarlo        Y         HIT     -
Chriztopher Johnson    chriztopher      n          -      -
Perias, Nelly          nelly            n         HIT     -
Yamada, Tamara         tamara           n         HIT    HIT
Cobb, Christopher      christopher      n         HIT    HIT
Diana                  diana            Y         HIT    HIT
Sarah                  sarah            Y         HIT    HIT
                                                  9/11   6/11
```

### **The finding that changes the verdict**

Look at `Perias, Nelly`, `Yamada, Tamara`, `Cobb, Christopher`: `already = n`.

**But `nelly`, `tamara` and `christopher` are all already in DocScrub's existing 23-entry lexicon.** They read as unrecognized *only* because of representation defect #1 — the last-first branch returns before the known-given-name lookup.

So X1's marginal contribution, over and above simply fixing that branch, is much smaller than the raw 9/11 suggests:

| already works | unlocked by the **representation fix** (free) | genuinely added by **X1** | still missed |
|---|---|---|---|
| Diana, Sarah, Giancarlo | **Nelly, Tamara, Christopher** | **Amy, Jeffrey** (+ Bobbie, 26k only) | Chelsye, Chriztopher |

**A 23-entry lexicon and a 26,411-entry lexicon rescue three controls each.** That is the measurement I did not expect, and it is the whole verdict.

---

## 5. Collision analysis

### The fear largely does not materialise

```
B. NON-PERSON CONTROLS (want zero)          26k: 2/19      EN: 0/19
```

Only `math` (`Math Option`) and `reason` (`Reason Code`) collide, both in the multi-locale set only. Grade, Term, Final, Preview, Workflow, Systemwide, Degree, Start, Academic, Financial, Message, Transfer, Student, Course, Action — all clean in both.

**Collision surface, measured against DocScrub's own lexicons rather than one document:**

```
institution_term            8 terms   26k:  0 (0%)    EN: 0 (0%)
department_organization     6 terms   26k:  0 (0%)    EN: 0 (0%)
product_system_name        25 terms   26k:  0 (0%)    EN: 0 (0%)
common_english_word      1955 terms   26k: 36 (2%)    EN: 3 (0%)
document_structure_term    21 terms   26k:  3 (14%)   EN: 0 (0%)
calendar_term              19 terms   26k:  6 (32%)   EN: 2 (11%)
season_or_academic_term     7 terms   26k:  3 (43%)   EN: 1 (14%)
```

**Institutional and administrative vocabulary is essentially disjoint from given names.** Calendar vocabulary is not — but calendar candidates are already routed out by C1 before People sees them.

### The classic collision shape is not a new problem

```
Summer Session  May Term  Will Call  Rose Garden  Mark Sheet  Grace Period
Hope Center     April Deadline  June Session  Dawn Patrol  Faith Center
```

26k hits 12/12, EN hits 9/12 — **but 11 of the 12 already carry name evidence today** via `ambiguous_lexical_token`. They are already in People and X1 changes nothing about them. Only `Art Gallery` is newly affected: **one unit**.

**So the honest answer to "does a bigger lexicon just make collisions more numerous?" is no — not on this domain's vocabulary.** That is a real point in X1's favour and I am not going to understate it because the verdict lands elsewhere.

---

## 6. Missed people

`Chelsye Angelina` and `Chriztopher Johnson` are missed by **both** sets. Unusual and deliberately-varied spellings are exactly the residual, and no lexicon size fixes them — the 26k set already spans 84 locales and still misses both.

This is the honest ceiling: **a name lexicon cannot be the sole membership signal**, because the population it misses is not random. It skews toward unusual spellings, which correlates with the people a redaction tool most needs to protect.

---

## 7. Interaction with existing evidence

- **`TWO_NAME_RE` + given name** → already how `known_personal_name_token` is produced. X1 widens the input, changes no logic.
- **`surname_given_structure` + given name** → **blocked today** by representation defect #1. This is the highest-value interaction and it needs no new data.
- **Identity relationships (defect #2)** → evidence attaches to the shortened form; the full-name anchor gets nothing. `Amy` carries the proposal, `Amy Miller` receives none. Fixing the direction rescues `Amy Miller` **without X1 at all**.
- **Ordinary-language evidence** → no interaction: the collision surface is ~0% on institutional vocabulary.
- **Calendar/institutional semantic evidence** → these candidates leave under C1 before People, so the 11–43% calendar collision is not reached in practice.
- **Contextual person evidence** → orthogonal and complementary; it is the signal that would corroborate a lexicon hit.

---

## 8. Separability before / after

| population | current | + representation fixes | + representation fixes + X1 (EN) |
|---|---|---|---|
| strong/corroborated person-positive | 3 of 11 controls | **6 of 11** | **8 of 11** |
| unresolved (shape only) | 8 | 5 | 3 |
| strong/corroborated non-person | 0 | 0 | 0 |
| conflicting | 0 | 0 | 0 |

**People count: 139 in every column.** Neither change removes anything. Both improve separability, which is the precondition for safe removal — but the reviewer sees the same list.

---

## 9. Risks, licensing, maintenance

**Licensing — partially unresolved, and I am not going to hand-wave it.** Faker is MIT, which permits commercial redistribution of the *package*. What MIT does not by itself settle is the **provenance of the name data inside it**: Faker's locale providers were contributed from many sources over a decade, and the repository does not carry per-dataset provenance. For a commercial redaction product I would want either (a) a name list with explicit, documented provenance — US SSA baby names is public-domain US Government work and is the obvious candidate — or (b) counsel's sign-off on Faker's bundled data. **Marked unresolved.** It does not block the verdict below, because the verdict is not to adopt X1 yet.

**Maintenance.** A static list is inert — no updates, no network, fully deterministic, compatible with DocScrub's offline architecture. The real maintenance cost is *demographic coverage*, and that cost is open-ended: the EN set is 1,805 names and already misses Nelly, Bobbie and Giancarlo.

**False certainty.** The sharpest risk. A lexicon hit is weak evidence — `Summer Session` leads with a given name — and if it were routed as *strong* person evidence it would recreate the shape-vs-evidence conflation in a new place. It belongs as a **corroborator**, never as a sole qualifier.

**Better existing capability?** Yes: representation defects #1 and #2, which need no dataset, no license and no maintenance.

---

## 10. Verdict — **D**

### Existing representation fixes alone justify one small implementation pass before X1.

**Why not A.** X1 does not clear your own threshold. People stays at 139, the reviewer's screen is unchanged, and the marginal rescue over a free branch-order fix is **two controls** (Amy, Jeffrey).

**Why not B.** "Stop" would waste a measured, cheap, zero-risk correctness fix that is sitting right there.

**Why not C.** X1 did not fail. The collision analysis came back better than I predicted — 0/19 on your non-person controls with the EN set, ~0% on institutional vocabulary. I recommended X1 last pass and I still think it is *sound*; it is simply not the next thing.

**Why D.** The measurement showed my previous recommendation was based on a false premise. I read `Perias, Nelly` and `Cobb, Christopher` as "not in the lexicon" when they **are in the lexicon** and are hidden by a branch-order bug. Correcting that is a defect fix, not a capability, and it delivers the same number of rescued controls as a 26,411-entry dataset — with no license question, no maintenance, and no new false-certainty risk.

**And X1 cannot be judged fairly until it lands.** Three of eleven controls are false negatives caused by the adapter. Measuring a lexicon through a broken lookup is exactly the mistake you warned against.

### The proposed pass, and its limits stated plainly

1. **Representation defect #1** — move the known-given-name lookup so the `LAST_FIRST_RE` branch reaches it. Small change, **wide behavioural surface**: last-first candidates go 94 → 99, which crosses `STATUS_THRESHOLDS` and moves recommendations, tiers and Ambiguity sections. It is an **oracle deviation** (Python shares the branch order) and needs classifying, a behavioural suite, and a before/after count of what moves.
2. **Representation defect #2** — attach identity evidence to the full-name anchor as well as the shortened form. Rescues `Amy Miller` with no dataset.
3. **Re-measure X1** against the corrected baseline, then decide.

**It will not change what a reviewer sees when opening People.** By your threshold that is a failure, and I would rather say so than sell it: the honest claim is that it is a **correctness fix that makes the next change safe**, not a product improvement. If you would rather not spend the day on something with no visible payoff, **stopping after this pass is entirely defensible** — the confidence-language fix that shipped today is the one change in this whole sequence that a reviewer will actually notice, and it is already in.
