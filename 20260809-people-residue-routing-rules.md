# The C1 Residue as a Routing Problem

**Date:** 2026-08-09
**Status:** investigation. **No production behaviour changed.** One `export` keyword added (see §0). Diagnostic extended.
**Baseline:** C1 (route via `semanticTypeFor`), leaving 139 People units.

---

## 0. The one disclosed diff

`scoring.ts`'s `LEXICAL_WORDS` gained an `export`. Nothing else in that file changed and no behaviour depends on it.

The alternative was rebuilding that union inside the diagnostic — which is precisely the duplicate-lexicon drift the comment above it exists to prevent. Adding a keyword seemed the smaller sin than adding a second copy of a dictionary.

---

## 1. The structural constraint that determines every rule below

**`semanticTypeFor` tests organizations, calendar, acronyms and document-titles BEFORE people.** So by construction, the 139 carry **none** of those categories — everything that did has already been routed out by C1.

This is the finding that reframes the task. A routing rule for the residue **cannot use phrase-level quality categories**, because the useful ones are definitionally absent. It has to use evidence `semanticTypeFor` never asks for.

There is exactly one such body of evidence available, and it is already in production.

### The evidence that exists and is not consulted: per-token lexical membership

`scoring.ts` owns `LEXICAL_WORDS` — "is this an ordinary word of English" — with a doc comment explaining at length why `ALL_COMMON_DICTIONARY_WORDS` is the *wrong* set for exactly this question and why this union is the right one.

It is applied to the **compacted acronym form** and nowhere else. Its own comment says:

> Tests the COMPACTED FORM, not any constituent token … a per-token test would fire on multi-word candidates that merely contain a common word.

That is correct **for the acronym question**. For the person-phrase question, per-token is the whole point — and the "merely contains a common word" objection is answered by requiring *every* token, not any.

So the rules below are **new compositions over existing production evidence**, using the production lexicon. That classification is stated per rule in §4.

---

## 2. Scope: what no rule is allowed to touch

Every rule is gated twice before it is consulted:

1. **Shape-only** — the unit carries no `known_personal_name_token`, `known_first_name`, `known_name_structure`, `surname_given_structure`, or **`ambiguous_lexical_token`**.
2. **No person evidence of any kind** — no strong explicit evidence (lexicon / anchor / title), no contextual usage rule, no person-evidenced entity linkage.

`ambiguous_lexical_token` turns out to be doing enormous protective work already, and it is the reason these rules are safer than they look. Measured against the real engine:

```
Rose Delacroix   ambiguous_lexical_token   -> NOT shape-only, rule never applies
Mark Baker       ambiguous_lexical_token   -> protected
Jordan Rivers    ambiguous_lexical_token   -> protected
Grace Bell       ambiguous_lexical_token   -> protected
Hope Price       ambiguous_lexical_token   -> protected
Faith Moore      ambiguous_lexical_token   -> protected
Sarah Grant      ambiguous_lexical_token   -> protected
Dawn Fields      ambiguous_lexical_token   -> protected
Summer Cook      ambiguous_lexical_token   -> protected
Will Young       common_verb + ambiguous_lexical_token -> protected
May Church       calendar_term + ambiguous_lexical_token -> protected
```

The name/word collision category the pipeline already maintains removes almost the entire risk surface before any new rule runs.

---

## 3. The rules, priced offline

Measured with the real `scoreCandidateQuality` and the real `LEXICAL_WORDS`, on a **deliberately adversarial** name sample — names chosen *because* their surnames are ordinary words.

| rule | removes (inst-like) | loses (name-like) | names lost |
|---|---|---|---|
| **R1 — every token is an ordinary English word** | **20 / 24** | **1 / 6** | `Art Long` |
| R2 — final token is an ordinary English word | 21 / 24 | 3 / 6 | `Priya Church`, `Nkechi Young`, `Art Long` |
| R3 — final token is a plural ordinary noun | small | — | — |
| R4 — some token individually carries an org/calendar category | pending live | pending live | — |

**R1 is the recommendation candidate and R2 is not.** One extra removal for three times the name loss is a bad trade on a section whose entire purpose is not losing people.

Worked examples of R1 firing, all shape-only, all score 79, all currently reading *"Almost certainly a person's name"*:

```
Academic Senate    Financial Aid     Message List      Transfer Credit
Last Call          Final Grades      Student Success   Campus Community
Help Desk          Change Request    Business Process  Data Warehouse
Term Activation    Staff Course      Service Indicator Codes
```

Kept by R1, correctly:

```
Agnes Wu       "wu" is not an ordinary word
Amy Nakamura   "nakamura" is not an ordinary word
Kyle Barrera   neither token is an ordinary word
```

What R1 misses, and why: `Grade Rosters` and `Preview Day` — "rosters" and "preview" are absent from the 51k lexicon. **Lexicon gaps, not rule failures.** I am not chasing them; per your instruction, large and obvious beats complete.

### The honest false-exclusion shape

`Art Long` — a real name where **both** tokens are ordinary words, **and** neither is in the name lexicon, **and** `ambiguous_lexical_token` did not fire. That is the class R1 loses. Two things bound it: gate 2 means a single sentence anywhere in the document treating `Art Long` as a person protects it, and the destination is *Other / Needs Individual Review*, which has no bulk vocabulary — a safer place for a misrouted real name than People's bulk-Keep blast radius.

---

## 4. Ignored evidence vs. new heuristic — stated per rule

| rule | lexicon | composition | classification |
|---|---|---|---|
| R1 | **existing** (`LEXICAL_WORDS`) | **new** (per-token, universal) | **new composition over existing evidence.** Not a blacklist; generalizes to any phrase. |
| R2 | existing | new (per-token, final only) | same, weaker and riskier |
| R3 | existing | new (morphological) | new heuristic — a plural test is not currently anywhere |
| R4 | **existing** (the same categories `semanticTypeFor` uses) | **new** (applies them per token instead of per phrase) | **closest to "correcting ignored evidence"** — the categories are already trusted for routing at phrase level; R4 asks the same question of the parts |

None is a string blacklist, none names a phrase, and all of them generalize.

---

## 5. Confidence language — reported separately, as instructed

**This is not a routing defect and must not be fixed by routing.**

`explanation-builder.ts`:

```ts
export function confidenceOpener(likelihood: number, entityType: string): string {
  const entity = entityPhrase(entityType);        // <- from the DETECTOR
  if (likelihood >= 95) return `Almost certainly ${entity}`;
  if (likelihood >= 80) return `Likely ${entity}`;
```

**The noun comes from the detector; only the adverb comes from the score.** So "Almost certainly a person's name" decomposes as:

- *"a person's name"* — because `FALLBACK_PERSON_RE` matched a capitalized phrase
- *"Almost certainly"* — because the quality score is ≥ 95

The score is a **name-likeness** score, and on these items it is measuring capitalization shape. The sentence therefore attaches a high-confidence adverb to a claim **nothing ever assessed**. Measured:

```
Academic Senate    score 79   -> "Likely a person's name"
Financial Aid      score 79   -> "Likely a person's name"
Message List       score 79   -> "Likely a person's name"
Help Desk          score 79   -> "Likely a person's name"
Agnes Wu           score 79   -> "Likely a person's name"     <- identical
```

`Academic Senate` and `Agnes Wu` receive **the same score and the same sentence**, because the score cannot tell them apart either.

The diagnostic reports every residue unit with score ≥ 80, no name evidence and no person evidence, with the exact sentence the UI shows. Two independent remedies exist and both are yours to choose, later:

1. **Qualify the noun when evidence is shape-only** — the claim becomes what was actually assessed ("shaped like a name").
2. **Suppress the band** when the only positive evidence is shape, and say nothing rather than something unsupported.

I am not recommending either yet, and neither belongs in the same change as routing.

---

## 6. What is measured live, and how to get it

```js
__docscrub.people()
```

Now reports, after the C1/C2/C3 sections:

- residue size, split into **eligible** (shape-only, no person evidence) and **protected**
- per rule: how many of the 139 it removes, **every removed unit by name**, and a name-risk table (units the document spells out elsewhere in a person-evidenced full name — a signal none of the rules consult — or with 3+ occurrences)
- the full list that would **survive** R1+R4, so the remainder is visible rather than inferred
- the unsupported-confidence table

**Prediction, recorded before the run:** R1 removes a large majority of the eligible set with at most a handful of name-risk flags. If the live name-risk table is materially worse than the offline sample suggests, the sample was unrepresentative and R1 should not land — that is the test, not the removal count.
