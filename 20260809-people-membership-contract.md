# Item Check → People: Membership Contract Investigation

**Date:** 2026-08-09
**Status:** investigation. **No production behaviour changed.** One read-only diagnostic added (`__docscrub.people()`).
**Awaiting:** the live counterfactual before any recommendation is acted on.

---

## A. Root cause

Item Check's People section has **no membership contract at all**. It is a fallback.

`src/ui/triageQueue.ts`:

```ts
export function triageSectionFor(archetype, detectedType) {
  switch (archetype) {
    ...
    case "uncertain":
    case null:
      return detectedType === "person" ? "people" : "other";
  }
}
```

Every candidate that fails to match an archetype and was detected by a person regex lands in **Likely People**. `FALLBACK_PERSON_RE` matches any run of 2–6 capitalized words, so "any capitalized phrase we could not explain" is the actual membership rule.

**This was already diagnosed and fixed — on the other stage.** From the same file, dated 2026-08-02:

> A null archetype maps to "other" EVEN for detectedType "person" — unlike `triageSectionFor`'s null→people case. Andrew's own observation: *"many of the 'person' classified items are clearly not people."* In this stage a person-typed candidate with NO derivable conclusion is exactly the phrase-completion junk ("Did", "Correct", "And") that must NOT be presented as a person-name section the reviewer is invited to bulk-accept.

Ambiguity Check diverged deliberately. **Item Check never received the same correction.** The defect is not new and not subtle — it is a known divergence that was applied to one stage.

There is a second, independent cause, below.

---

## B. Current routing architecture

```
detector (FALLBACK_PERSON_RE, LAST_FIRST_PERSON_RE)
   └─> detectedType: "person"                      <- a regex verdict
         └─> deriveRecommendation()  -> archetype  <- ui/recommendations.ts
               └─> triageSectionFor(archetype, detectedType)
                     └─> Likely People
```

Answering the specific questions:

| question | answer |
|---|---|
| Is membership driven by `detectedType`? | **Yes**, whenever no archetype is derived. |
| Can later evidence override it? | **Only via the archetype.** If no archetype matches, `detectedType` decides and nothing else is consulted. |
| Is archetype/type information ignored? | **`semanticTypeFor()` is ignored entirely.** Type Check has a better classifier and Item Check never calls it. |
| Can a candidate have strong institutional/ordinary/calendar evidence and still be routed to People? | **Yes — routinely.** See the token gate below. |
| Is "Almost certainly a person's name" derived from the same logic? | **No — separate layer.** The section explanation is static text in `TRIAGE_SECTION_EXPLANATIONS`; per-item confidence comes from the quality score. Neither is derived from anything that checked whether the item denotes a person. |

### The token gate — the second root cause

`ui/recommendations.ts`:

```ts
if (hasCategory(facts, ...INSTITUTIONAL_CATEGORIES) && facts.personTokenCount <= 2) → institutional-term
if (singleTokenNonName && hasCategory(facts, ...CALENDAR_CATEGORIES))              → calendar-term
if (singleTokenNonName && hasCategory(facts, ...COMMON_WORD_CATEGORIES))           → common-word
```

`singleTokenNonName` requires **`personTokenCount <= 1`**.

So a **multi-token phrase can never earn the calendar or common-word archetype, no matter what evidence it carries.** The evidence is computed, present, and discarded. Verified against the real quality engine:

```
Good Morning             tok=2  ord=YES  ["greeting-or-courtesy"]                              -> PEOPLE
Course Catalog           tok=2  ord=YES  ["common-english-word","address-suffix"]              -> PEOPLE
Spring Semester          tok=2  ord=YES  ["season-or-academic-term","address-suffix","all-…"]  -> PEOPLE
Service Indicator Codes  tok=3  ord=YES  ["common-english-word"]                               -> PEOPLE
Hello All                tok=2  ord=YES  ["greeting-or-courtesy"]                              -> PEOPLE
Thanks Andrew            tok=2  ord=YES  ["greeting-or-courtesy","interjection-casual"]        -> PEOPLE
Winter Grading           tok=2           ["season-or-academic-term"]                           -> PEOPLE
Fully Online             tok=2           ["season-or-academic-term"]                           -> PEOPLE
```

`Spring Semester` carries **both** a calendar category and a common-word category and is still filed under Likely People, because it has two words.

Institutional is gated at `<= 2`, which is why `Records Team` and `Academic Records` *do* route correctly — but `Service Indicator Codes` (3 tokens) cannot.

---

## Trace: `Academic Senate`, end to end

**1. Why detected.** `FALLBACK_PERSON_RE` matches any run of 2–6 capitalized words. `Academic Senate` qualifies on shape alone. No name lexicon is consulted — deliberately; the detector is high-recall by design.

**2. Why it survived.** The residual gate's rule 1 is `tokenCount !== 1 → "multi-token phrase"`, out of scope. It was never assessed.

**3. Why routed to People.** Its production categories are:

```
Academic Senate  ["moderate-frequency-bonus", "strong-name-structure"]
```

No institutional category, no calendar category, no ordinary-language category. Every archetype test fails, so it reaches `case null: return detectedType === "person" ? "people" : "other"`.

**4. Why the UI implies a person.** It does not derive that. The heading says "Likely personal names" as static text because the item is in the section, and the section is where unexplained person-typed items go. **The confidence language is not evidence about this item; it is a property of the bucket.** That is the most damaging part: the UI is asserting something no code ever checked.

**5. Which existing evidence already says otherwise.** This is the uncomfortable answer:

```
Academic Senate  ["moderate-frequency-bonus", "strong-name-structure"]
Agnes Wu         ["moderate-frequency-bonus", "strong-name-structure"]
```

**Category-identical.** No existing quality evidence contradicts People membership — because `strong_name_structure` is a claim about **capitalization shape**, not about names. The same collision appeared in the witness audit (`Last Call` vs `Agnes Wu`) and it is the same underlying fact.

So `Academic Senate` is *not* an instance of "evidence was ignored." It is an instance of **"shape was mistaken for evidence."** These are different defects and they need different fixes.

---

## C. Two failure families, and why the distinction decides the design

| family | example | evidence exists? | fixable by routing? |
|---|---|---|---|
| **I. Evidence discarded by a token gate** | `Good Morning`, `Spring Semester`, `Course Catalog`, `Service Indicator Codes`, `Hello All` | **yes** — ordinary/calendar categories present | **yes** |
| **II. Shape mistaken for evidence** | `Academic Senate`, `Grade Rosters`, `Financial Aid`, `Message List`, `Preview Day` | **no** — category-identical to real names | **no**, not by categories |

Family I is a routing bug. Family II is a **membership-contract** problem: nothing in the lexical layer can separate a two-capitalized-word department from a two-capitalized-word person.

Family II *is* separable — but only by evidence the routing layer never consults.

---

## D. Proposed membership contract

Two contracts, priced separately, because they are independent decisions.

### C1 — route through the classifier that already exists

`semanticTypeFor()` (`src/domain/semanticTypes.ts`) is a better classifier than `triageSectionFor` in every respect that matters here:

- **no token gate anywhere**
- routes organizations, calendar, acronyms, identifiers, document titles on evidence
- **requires positive name structure for `people`**, and falls back to `other`, not to `people`

Item Check simply does not call it. C1 replaces the `detectedType` fallback with it:

```
semanticTypeFor -> people        => People
                   organizations => Institutional
                   dates-terms   => Calendar
                   acronyms      => Acronyms
                   document-titles => Institutional
                   other         => Other / Needs Individual Review
```

This is a **deletion of a fallback, not a new rule system**, and it fixes all of family I. It leaves family II in People, because `semanticTypeFor` accepts `strong-name-structure` as name evidence too.

### C2 — the actual membership contract

> **A candidate appears in People only if production evidence positively supports a person reading. Capitalization shape is not evidence.**

Positive evidence, all of it already computed and none of it currently consulted by routing:

1. **name lexicon** — `known_personal_name_token` / `known_first_name` / `known_name_structure`
2. **contextual person evidence** — the sentence treats it as a person (`Agnes Wu approved…`); a department in a noun phrase does not fire these
3. **ambiguity proposal** — entity resolution proposed an identity for it
4. **entity group membership** — resolution grouped it with other spellings of one person

`strong_name_structure`, `surname_given_structure` and `moderate_frequency_bonus` are **shape**, and shape alone routes to *Other / Needs Individual Review* rather than to People.

### Is the taxonomy the problem?

**Partly, and in one specific place.** The seven sections are sound, but there is no home for the largest real population: *name-shaped, unconfirmed*. `Other / Needs Individual Review` is semantically correct for it and — importantly — carries **no bulk vocabulary**, so nothing there can be swept. But if C2 relocates a large number of units, "Other" becomes the biggest section on the stage, which is honest but not calm.

**I am not recommending a new section yet.** Whether one is needed depends entirely on the live size of that population, which is what the diagnostic measures. If it is large, the right answer is probably a named section (*"Name-shaped — unconfirmed"*) whose vocabulary is individual review only. If it is small, Other absorbs it.

---

## E. Counterfactual — measurement pending

`__docscrub.people()` re-runs the **real** `buildTriageSections`, `semanticTypeFor` and contextual-evidence lookups over the live document and reports:

- current People count
- People under C1, with every relocated unit and its destination listed
- People under C2, broken down by which evidence retained it
- the full list of units C2 would relocate
- a **false-exclusion review table**: multi-occurrence name-shaped units C2 would move, sorted by occurrence count — the place a real person would show up if this contract is wrong

**Predictions, recorded before the run so they can be scored:**

- **C1 will materially reduce People.** Confident: greeting, calendar and common-word categories are demonstrably present on multi-token phrases and currently discarded.
- **C2 will reduce it much further**, because `strong_name_structure` fires on any two capitalized words and is probably the single most common category in the section.
- **C2 will exclude some real people.** Certain, not possible. A person named once, in a distribution list, whose surname is unlisted, has no corroborating evidence at all.

**I am not recommending C2 until those numbers are on the table.** If C1 alone gets People to a trustworthy population, C2 is unnecessary risk. If the residue is dominated by family II, C1 alone is cosmetic and C2 is the real answer.

---

## F. Risks

**False exclusion of real people — the one that matters.** C2's failure mode is a genuine name relocated to Other. Four things bound it, and the fourth is the important one:

1. Nothing is dropped, resolved, or hidden. The unit stays in Item Check with the same decision vocabulary.
2. `Other / Needs Individual Review` has **no bulk actions**, so a misrouted person cannot be swept by a section-level accept — arguably *safer* than today, where a real name sits inside People's bulk-Keep blast radius.
3. Contextual person evidence is broad: one sentence anywhere in the document treating the candidate as a person is enough.
4. **Today's People section is not protecting them anyway.** A trustworthy 40-unit People section that a reviewer actually reads is better protection for a real name than a 269-unit section they skim — and the current section's bulk-accept is what puts real names at risk of a careless Keep.

**Other risks.**

- *Other becomes the largest section.* Honest, possibly not calm. Taxonomy question above.
- *C1 changes a shipped surface.* Items move between categories; any saved decisions are unaffected (decisions are per-candidate, not per-section), but a returning reviewer sees a different layout.
- *`semanticTypeFor` is not perfect either.* It accepts `strong-name-structure` as people evidence, which is exactly family II. C1 alone does not fix `Academic Senate`, and I would rather say that plainly than let C1's numbers imply otherwise.
- *Bulk-accept semantics shift.* If People shrinks to a high-confidence population, "Accept All Remaining" becomes a much stronger and more useful action. That is a benefit, but it is a behaviour change worth stating.

---

## G. Smallest implementation path

Staged, each stage independently measurable, in ascending order of risk:

1. **Remove the token gate on calendar and common-word archetypes** (`singleTokenNonName` → drop the `<= 1` for these two branches; keep the name-category guard). Pure defect fix — evidence already present, arbitrarily ignored. Fixes `Good Morning`, `Spring Semester`, `Hello All`, `Course Catalog`.
2. **Raise the institutional gate** from `<= 2` to no gate, or to a measured bound. Fixes `Service Indicator Codes`.
3. **C1 — replace the `detectedType` fallback with `semanticTypeFor`.** Deletes a fallback; adds no rules.
4. **C2 — the person-evidence requirement.** Only if the live numbers show family II dominates, and only after the false-exclusion table has been read.

Steps 1–2 are contained changes to `recommendations.ts` and should be measurable on their own. Step 3 is the architectural correction. Step 4 is the product decision, and it is yours rather than mine.

**Not doing:** string blacklists, per-phrase rules, grammar tuning, recall reduction, silent suppression, or relabelling the section.

---

## To run

Rebuild, hard-reload, load the document fresh, then:

```js
__docscrub.people()
```

Then, if you want the gate numbers from the A1/B pass in the same session:

```js
__docscrub.gate()
__docscrub.profile()
```
