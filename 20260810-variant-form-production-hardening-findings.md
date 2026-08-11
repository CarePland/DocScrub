# Variant-Form Production Hardening — Findings

**Date:** 2026-08-10
**Result: 15 production firings → 1 person-supporting. `Chriztopher Johnson` preserved for a general structural reason. 84/84 suites green, zero behavioural change.**

---

## 1. Root cause — and it is not what it looked like

The explainer reconstructs `documentAttestedTokens` from all 601 exported values exactly as Workspace does, and **reproduces the browser export precisely — 15 candidates, 15 candidates.** Every number below is therefore faithful to what actually ran.

Every false match has the same shape:

```
Services    ~ SERVIES     surname, 0.933   len 8/7
Scheduler   ~ SCHEDLER    surname, 0.941   len 9/8
Managers    ~ MANGERS     surname, 0.933   len 8/7
Reminders   ~ REINDERS    surname, 0.941   len 9/8
Sesion      ~ SESSION     surname, 0.923   len 6/7
```

versus the one true positive:

```
Chriztopher ~ CHRISTOPHER  given (TOP-1000), 0.909   len 11/11
```

**`SERVIES`, `SCHEDLER`, `MANGERS` and `REINDERS` are all real, attested Census surnames.** They are also all rare. The matcher did nothing wrong; the *inference* from the match is worthless.

### The mechanism

> **The Census surname tail is a near-cover of English orthography.** 195,310 entries include a long tail of rare surnames, so almost any long English word sits one deletion away from one of them.

Discovering that a common word resembles a rare name tells you nothing about the candidate.

### What it is *not* — each ruled out by measurement

| Hypothesised cause | Verdict |
|---|---|
| Plural morphology | **No.** The inflection probe returns `-` for all 17 relationships. `SERVICES`→`SERVIES` is a deletion, not a plural relationship |
| Affix guard failing | **No.** All differ *internally*; prefix and suffix containment are both false, so the guard correctly does not apply |
| Phonetic collisions | **No.** No phonetic matcher ships — Double Metaphone/Soundex/NYSIIS were rejected earlier at 93–99% false rates |
| Document-local matching | **Largely no.** 15 of 17 relationships are reference matches; only 2 are document-local |
| Short-distance orthographic | **Partly** — but length and threshold are not the discriminator. All sit at 0.92–0.95, and so does the true positive at 0.909. **Moving the threshold would kill Chriztopher before it killed Services.** |
| Candidate composition | **No.** Fires at every position and token count, including single tokens |

**No stemmer was introduced.** The morphology probe is descriptive only, and it found nothing — which is itself the finding that killed the plural hypothesis.

---

## 2. Before table — all 15, explained

| Candidate | Tok | Observed | Pos | Matched | Role | Method | Sim | Len | Partner | Other PERSON | Competitors | Section |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Academic Services | 2 | Services | 2/2 | SERVIES | surname | ortho | 0.933 | 8/7 | – | (none) | org, domain | organizations |
| **Chriztopher Johnson** | 2 | Chriztopher | 1/2 | **CHRISTOPHER** | **given+surname** | ortho | 0.909 | 11/11 | JOHNSON | (none) | (none) | undetermined |
| Chriztopher Johnson | 2 | Chriztopher | 1/2 | CHRITOPHER | given | ortho | 0.952 | 11/10 | JOHNSON | (none) | (none) | undetermined |
| Chriztopher Johnson | 2 | Chriztopher | 1/2 | CHRISTOPHER | given+surname | doc-local | 0.909 | 11/11 | JOHNSON | (none) | (none) | undetermined |
| Civitas College Scheduler | 3 | Scheduler | 3/3 | SCHEDLER | surname | ortho | 0.941 | 9/8 | COLLEGE | contextual-usage:human-subject | org | organizations |
| College Scheduler | 2 | Scheduler | 2/2 | SCHEDLER | surname | ortho | 0.941 | 9/8 | COLLEGE | (none) | org, domain | organizations |
| Good Morning Registrar Managers | 4 | Managers | 4/4 | MANGERS | surname | ortho | 0.933 | 8/7 | GOOD,MORNING | (none) | org, domain, ordinary | organizations |
| Hi Managers | 2 | Managers | 2/2 | MANGERS | surname | ortho | 0.933 | 8/7 | HI | (none) | domain, ordinary | undetermined |
| Information Technology Services | 3 | Services | 3/3 | SERVIES | surname | ortho | 0.933 | 8/7 | – | (none) | org, domain, acronym | acronyms |
| Managers | 1 | Managers | 1/1 | MANGERS | surname | ortho | 0.933 | 8/7 | – | (none) | ordinary | undetermined |
| May Sesion Grade | 3 | Sesion | 2/3 | SESSION | surname | doc-local | 0.923 | 6/7 | MAY,GRADE | name-lexicon, census-name-structure | date-or-term | dates-terms |
| Registrar Managers | 2 | Managers | 2/2 | MANGERS | surname | ortho | 0.933 | 8/7 | – | (none) | org, domain | organizations |
| Reminders | 1 | Reminders | 1/1 | REINDERS | surname | ortho | 0.941 | 9/8 | – | (none) | ordinary | undetermined |
| Scheduler | 1 | Scheduler | 1/1 | SCHEDLER | surname | ortho | 0.941 | 9/8 | – | (none) | (none) | undetermined |
| Services Indicators | 2 | Services | 1/2 | SERVIES | surname | ortho | 0.933 | 8/7 | – | (none) | org, domain | organizations |
| Standard Support Services | 3 | Services | 3/3 | SERVIES | surname | ortho | 0.933 | 8/7 | STANDARD | (none) | org, domain | organizations |
| Student Records Services | 3 | Services | 3/3 | SERVIES | surname | ortho | 0.933 | 8/7 | STUDENT,RECORDS | (none) | org, domain | organizations |

**The pattern is visible in one column: `role`.** Every false target is surname-only and rare. The true target is Top-1000 given.

---

## 3. Hypotheses measured on the real 601

| Hypothesis | Kept of 15 | Chriztopher survives |
|---|---|---|
| H-1 exact-attested partner | 8 | yes |
| H-2 multi-token only | 12 | yes |
| H-3 other Person evidence present | 2 | **no** |
| H-4 no competing institutional reading | 5 | yes |
| H-5 matched form is a given name | **1** | yes |
| H-6 partner + given name | **1** | yes |
| **H-7 matched form is COMMON (Top-1000)** | **1** | **yes** |
| H-8 common + partner | **1** | yes |

H-3 is instructive: it *fails* the positive witness. `Chriztopher Johnson` has no other Person signal — which is exactly why variant evidence was built.

Four hypotheses score identically, so **the choice was made on principle, not on the numbers:**

- **H-5 (given names only)** — semantically wrong. Surnames are legitimate name evidence; a misspelled `Johnsen` should still relate to `JOHNSON`.
- **H-6** — inherits H-5's flaw and additionally kills single-token variants.
- **H-8** — the partner conjunct changes no row here. Unearned complexity.
- **H-7** — reads the corpus's own prevalence flag. Preserves surname variants when the surname is common. **Adopted.**

---

## 4. Hardening implemented

**Invariant:** *a variant relationship supports PERSON only when the matched reference form is Top-1000 in at least one role.*

| | |
|---|---|
| **Permits** | relationships to common name forms — `CHRISTOPHER`, `JOHNSON`, `MILLER`, `GUZMAN` |
| **Rejects** | relationships to rare tail forms — `SERVIES`, `SCHEDLER`, `MANGERS`, `REINDERS`, `SESSION`, `CHRITOPHER` |
| **Source** | the shipped Census asset's own `firstTop1000` / `surnameTop1000` flags. Not a threshold, not a score, not a weight |
| **Safety shape** | an admission restriction — can only ever *remove* person support, never add it. Reads no context and no document population |

### Discovery is demoted, not deleted

Per §3 of the instruction, generation stays broad. Two new fields on `VariantRelationship`:

- `matchedFormIsCommon` — the corpus fact
- `personSupporting` — whether this relationship may create PERSON evidence

**All 15 relationships remain on the evidence record and remain visible to diagnostics.** Only person-supporting ones reach the interpretation layer. That is the distinction between *"a variant relationship was found"* and *"a variant relationship supports PERSON"*.

**Known limitation, stated rather than discovered later:** a genuinely rare surname, misspelled, no longer produces person-supporting variant evidence. That person retains every other evidence channel, and `unsupported` has never meant "not a person".

---

## 5. After table — the same 601

| | Before | After |
|---|---|---|
| Candidates with a **discovered** variant relationship | 15 | **15** (unchanged — discovery preserved) |
| Candidates with **person-supporting** variant evidence | 15 | **1** |
| variant-form as the **only** PERSON signal | 13 | **1** |
| PERSON readings across the document | 273 | **261** (−12) |
| Candidates becoming fully unsupported | — | **1** (`Scheduler`) |

| Candidate | PERSON after | Readings that remain |
|---|---|---|
| **Chriztopher Johnson** | **KEPT** | person |
| Civitas College Scheduler | KEPT | person, organization — *survives on contextual-usage, not variant* |
| May Sesion Grade | KEPT | person, date-or-term — *survives on name-lexicon + census structure* |
| Academic Services | REMOVED | organization, domain-terminology |
| College Scheduler | REMOVED | organization, domain-terminology |
| Good Morning Registrar Managers | REMOVED | organization, domain-terminology, ordinary-language |
| Hi Managers | REMOVED | domain-terminology, ordinary-language |
| Information Technology Services | REMOVED | organization, domain-terminology, acronym |
| Managers | REMOVED | ordinary-language |
| Registrar Managers | REMOVED | organization, domain-terminology |
| Reminders | REMOVED | ordinary-language |
| Scheduler | REMOVED | **(none) → unsupported** |
| Services Indicators | REMOVED | organization, domain-terminology |
| Standard Support Services | REMOVED | organization, domain-terminology |
| Student Records Services | REMOVED | organization, domain-terminology |

**11 of the 12 removals leave an affirmative alternative already supported.** Only `Scheduler` becomes fully unsupported — correctly: nothing affirmative is known about it.

The two "accompanied" cases both survive on their *other* evidence, which is the right outcome and confirms the hardening is not over-reaching.

---

## 6. `Chriztopher Johnson` — before / after

```
BEFORE
  Chriztopher ~ CHRITOPHER   given, rare,      0.952  orthographic
  Chriztopher ~ CHRISTOPHER  given TOP-1000,   0.909  orthographic
  Chriztopher ~ CHRISTOPHER  given TOP-1000,   0.909  document-local
  -> person [variant-form] person/variant-form-with-attested-partner
  -> outcome single, TypeCheck undetermined

AFTER
  Chriztopher ~ CHRITOPHER   DISCOVERED, not person-supporting (rare target)
  Chriztopher ~ CHRISTOPHER  person-supporting (Top-1000 given)   x2 paths
  -> person [variant-form] person/variant-form-with-attested-partner
  -> outcome single, TypeCheck undetermined       ← IDENTICAL
```

**Preserved for a general structural reason: its target is a common name.** No string is hard-coded — the verification asserts that neither `CHRISTOPHER`, `CHRIZTOPHER`, `SERVIES`, `MANGERS`, `SCHEDLER` nor `REINDERS` appears anywhere in the module's code, and that person support is derived from `firstTop1000 || surnameTop1000`.

A pleasing side-effect: the *rare* co-target `CHRITOPHER` is demoted while the good one survives, so the evidence got cleaner as well as narrower.

---

## 7. Orthographic vs phonetic ablation

| Mechanism | Relationships | Note |
|---|---|---|
| Orthographic (reference) | 15 | |
| Document-local | 2 | `Chriztopher~CHRISTOPHER`, `Sesion~SESSION` |
| **Phonetic** | **0 — does not ship** | Rejected earlier at 93–99% false-candidate rates |

**Orthographic matching is the source of the problem, and I'm saying so plainly.** But the fix is not to restrict it further: all 15 sit at similarity 0.92–0.95, and the true positive is the *lowest* at 0.909. Any threshold move kills Chriztopher first. The discriminator had to be the target's prevalence, not the match's tightness.

---

## 8. Remaining suspicious matches

**One:** `May Sesion Grade` retains a PERSON reading — but on `name-lexicon` + `census-name-structure` (from `May` and `Grade`), not on variant evidence. Its variant relationship `Sesion~SESSION` is now correctly demoted. Whether the *other* Person evidence is right is a Person-adjudication question, not a variant one.

`Civitas College Scheduler` retains PERSON on `contextual-usage:human-subject` — a neighbourhood-scoped signal, flagged in the Person-adjudication pass as the family that fired on `Academic Senate` and `San Diego`. Again: not a variant problem.

### Boundary defects, reported separately as instructed

`Good Morning Registrar Managers` and `Hi Managers` are **candidate-span defects** — a greeting fused to an organizational phrase. The hardening removes their PERSON reading, but it does so for the right reason (rare target) and **not because it recognised a bad boundary.** The bad span remains and should be fixed in extraction, not here.

---

## 9. Behavioural inertness

| Surface | Change |
|---|---|
| Type Check routing | **0** |
| Review-stage membership | **0** |
| Recommendations | **0** |
| Automatic resolution | **0** |
| Output | **0** |
| **P-6 adjudication population** | **0 — still exactly 17 candidates** |
| Existing user decisions | **0** |

P-6 requires *every* Person signal to be `census-token-membership`. None of the 15 variant candidates has that shape, and the 12 that lose their Person reading end with *zero* Person signals — reported as `hadPersonReading: false`, which is absence, not a P-6 rejection. **The two populations remain disjoint by construction.**

Only two production files changed, both mine: `variant-form-evidence.ts` (two fields + admission) and `candidate-interpretation.ts` (emit from supporting relationships only). No routing, scoring, recommendation, gate or export module touched. The concurrent auth/preview workstream is untouched.

The interpretation *diagnostic* will change, because the evidence changed. That is expected and is the only visible difference.

---

## 10. Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` / production build | **PASS** |
| Full battery (86 files; 84 runnable suites) | **84 / 84 PASS** |
| `variant-form-evidence-verification.ts` incl. new §6b | **PASS** |
| 601-candidate report | ran; before/after in §5 |
| P-6 report | **17 candidates, unchanged** |
| Explainer reconstruction vs browser export | **exact agreement, 15 = 15** |

New assertions: rare targets are discovered but not person-supporting; discovery survives on the record; no person signal is emitted when all relationships are non-supporting; the positive witness keeps only its common-form relationship; **no candidate or reference string is hard-coded**; person support derives from the corpus prevalence flags; no weight/score/confidence introduced; no relationship is ever person-supporting with a rare target.

One existing assertion updated — the relationship field set, because two fields were added. **Not weakened.**

**Performance unchanged** (no extra lookup; the role was already fetched): 601-candidate pass **90 ms cold, 10 ms warm** — consistent with the pre-hardening figures.

---

## Summary

The claim variant-form makes is now narrower and honest: not *"one of its words resembles a name"* but *"one of its words resembles a **common** name"*. On the real document that is the difference between 15 firings and 1.

**Root cause was a property of the corpus, not of the algorithm** — and the fix was already sitting in the shipped asset.
