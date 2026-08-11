# Person-name evidence — architectural investigation (2026-08-07)

**Investigation only. Nothing here is implemented.** The question Andrew
asked: where does the evidence get lost?

**The short answer: it is not lost.** Every stage that could know Amy and
Kyle are names does know it, and the knowledge survives all the way into
the same struct the decision is made from. `RecommendationFacts` carries
`identityOptions` — the 90% "Amy Miller" and 95% "Kyle Francis" matches —
into `deriveRecommendation`, which computes `recognized` from them on line
282 and then, twelve lines later, refuses the name anyway because a
23-entry wordlist did not contain the token.

The evidence is not discarded. **It is outvoted, in a single boolean
expression, by a dictionary that was never designed to carry this weight.**

Everything below was verified against the running app and the actual data
files, not inferred from source.

---

## Classification of findings

| # | Finding | Class |
|---|---|---|
| 1 | Amy files as a common English word | **DEFECT** |
| 2 | Kyle is untiered and unreachable by any bulk action | **DEFECT** |
| 3 | `KNOWN_GIVEN_NAMES` is 23 transcript-harvested tokens; `lopez`/`parra` are surnames filed as given names | **DEFECT** (data) |
| 4 | `known_first_name` / `known_surname` dictionaries are **empty** (0 entries) | **DEFECT** (data) |
| 5 | Four different definitions of "has person-name evidence", three with different membership | **ARCHITECTURAL INCONSISTENCY** |
| 6 | `known-surname` is not name evidence to the sectioning predicate | **ARCHITECTURAL INCONSISTENCY** |
| 7 | Identity evidence is ANDed with lexicon evidence, never ORed | **ARCHITECTURAL INCONSISTENCY** — the core finding |
| 8 | Recognition gate is conservative on purpose (`RECOGNIZED_ANCHOR_MIN_CONFIDENCE = 70`) | **INTENTIONAL** — do not "fix" |
| 9 | Storage stays typed; sectioning is presentation-only | **INTENTIONAL** |
| 10 | Route document-level identity evidence into one canonical predicate | **FUTURE ENHANCEMENT** (§5) |

---

## 1. The pipeline

```
┌── EXTRACTION ────────────────────────────────────────────────────────┐
│ DetectionEngine → Candidate { displayValue, detectedType:"person",   │
│                               confidence, occurrences }              │
│ CREATES: "something here looks like a person"                        │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌── QUALITY (CandidateQualityEngine / quality/scoring.ts) ─────────────┐
│ singleTokenClassifications():                                        │
│   known_first_name  ← KNOWN_GIVEN_NAMES_SET (23) ∪ dict (0 entries)  │
│   known_surname     ← KNOWN_SURNAMES (5)        ∪ dict (0 entries)   │
│   common_english_word            ← 1,960 entries                     │
│   expanded_common_language_token ← 51,455 entries                    │
│ known_personal_name_token ← only on TWO_NAME_RE multi-token text     │
│                                                                      │
│ CREATES positive name evidence:      28 tokens                       │
│ CREATES negative name evidence:  53,415 tokens                       │
│ ⚠ THE ASYMMETRY IS THE WHOLE STORY — see §3                          │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌── ENTITY RESOLUTION (resolution.ts, semantic-augmentation.ts) ───────┐
│ buildEntityGroups() → member scores → group confidence               │
│ buildFullNameAnchorBuckets() → anchors ("Amy Miller", "Kyle Francis")│
│ semantic-augmentation → AmbiguityProposalGroupOption {               │
│      groupId, canonicalName, confidence:90,                          │
│      evidence:["Exact first-name match (\"amy\")"] }                 │
│ STRENGTHENS: independent, document-level evidence that this token    │
│              resolves to a full personal name found in this document │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌── FACTS ASSEMBLY (app.ts recommendationFactsForCandidate) ───────────┐
│ RecommendationFacts {                                                │
│   categories        ← quality  (the 28-vs-53,415 axis)               │
│   identityOptions   ← entity resolution  ★ THE STRONG EVIDENCE       │
│   unrecognizedGroupIds ← anchor vetting                              │
│   personTokenCount, detectedType, qualityRecommendation }            │
│ ✔ NOTHING IS LOST HERE. Both axes arrive intact, in one struct.      │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌── DERIVATION (recommendations.ts deriveRecommendation) ──────────────┐
│ L282  recognized = identityOptions.filter(recognizedOption)  ← STRONG│
│                                                                      │
│ L304  shortened-name  ⟵ personTokenCount===1                        │
│                       ∧ hasCategory(KNOWN_NAME_CATEGORIES)  ← 28 set │
│                       ∧ recognized.length > 0                        │
│       ⚠ THE AND. Identity evidence cannot carry this branch alone.   │
│                                                                      │
│ L361  singleTokenNonName = personTokenCount<=1                       │
│                          ∧ ¬hasCategory(KNOWN_NAME_CATEGORIES)       │
│       ⚠ THE SAME PREDICATE, NEGATED, as a gate INTO the term         │
│         archetypes. identityOptions is not consulted at all.         │
│                                                                      │
│ L411  common-word ⟵ singleTokenNonName ∧ COMMON_WORD_CATEGORIES     │
│       ⚠ ← AMY EXITS HERE. Evidence discarded.                        │
│                                                                      │
│ L419+ uncertain (fallthrough)  ← KYLE EXITS HERE                     │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌── TIER (recommendations.ts deriveReviewTier) ────────────────────────┐
│ archetype ≠ uncertain ∧ suggestions>0            → "strong"          │
│   → Amy: common-word carries 2 chips             → STRONG            │
│ possiblePerson = detectedType==="person"                             │
│                ∧ hasCategory(KNOWN_NAME_CATEGORIES)   ← 28 set       │
│                ∧ identityOptions.length > 0           ← STRONG       │
│   → Kyle: fails the lexicon half                 → tier = null       │
│ ★ THIS IS THE ONLY PLACE BOTH AXES MEET. And it ANDs them.           │
└──────────────────────────────┬───────────────────────────────────────┘
                               │
┌── SECTION ASSIGNMENT (triageQueue.ts ambiguitySectionFor) ───────────┐
│ switch (archetype):                                                  │
│   "common-word" → common-words   ← AMY (nameEvidence never read)     │
│   uncertain/null → detectedType==="person"                           │
│                    ? (nameEvidence ? shortened-names : common-words) │
│                    : other        ← KYLE (nameEvidence === false)    │
│ where nameEvidence = hasKnownNameEvidence(facts)  ← the 28 set again │
└──────────────────────────────────────────────────────────────────────┘
                               ↓
                    "Other Words" — bulk action: Ignore
```

**Where evidence is created:** detection, quality, entity resolution.
**Where it is strengthened:** entity resolution and facts assembly — both
axes reach `deriveRecommendation` intact.
**Where it is discarded:** L361/L411 (Amy) and L609 (Kyle). In both cases
`identityOptions` is present in scope and not consulted, or consulted only
as an additional requirement.
**Where the decision is made:** `ambiguitySectionFor`, which by then has
nothing left to work with — the loss happened upstream.

---

## 2. Why Amy and Kyle arrive in Other Words — and they arrive differently

This matters: **a single fix aimed at `hasKnownNameEvidence` would fix
Kyle and not Amy**, which is exactly the sort of half-repair that would
look like success on the category that prompted the question.

### Amy — lost at the ARCHETYPE layer

Live evidence (Teams transcript): source text *"im so surprised [Amy]
doesn't know how to answer her own Staff questions"*. Identity option
**Amy Miller, 90%, "Exact first-name match"**. Panel reads *"Unlikely /
Highly unlikely"*, chips ① Common word ② Person's name.

1. `"amy"` ∉ `KNOWN_GIVEN_NAMES` (23 entries) → no `known_first_name`.
2. `"amy"` ∈ `expanded_common_language_token` (**51,455 entries**) →
   `COMMON_WORD_CATEGORIES` matches.
3. `singleTokenNonName` is true *because of step 1*.
4. L411 returns `common-word` **before** the uncertain branch is reached.
5. `deriveReviewTier`: archetype ≠ uncertain, `suggestions.length === 2`
   (the chips) → **"strong"**.
6. `ambiguitySectionFor` routes on archetype. `nameEvidence` is never
   consulted for Amy at all.

**Amy is a person's name classified as a common English word because
"amy" appears in a 51,455-entry general-language wordlist, and the only
thing that could have vetoed that — a 23-name list — did not contain her.**
The 90% identity match sat in `facts.identityOptions` throughout and was
never read on this path.

Consequence: Amy is item 1 of the strong tier, **inside** the blast radius
of Other Words' bulk Ignore.

### Kyle — lost at the SECTIONING and TIER layer

Live evidence: identity option **Kyle Francis, 95%**, tier badge "Likely",
negative chip "Unknown capitalized word". Chips ① Person's name ② Not a
name — the *uncertain* pair.

1. `"kyle"` is in **no dictionary at all** — not a name, not a common word.
2. So `singleTokenNonName` is true but no term branch matches.
3. L304 shortened-name: `recognized.length > 0` is **true** (Kyle Francis,
   95% ≥ 70, two tokens, anchor vetted) — but
   `hasCategory(KNOWN_NAME_CATEGORIES)` is false. **The AND kills it.**
4. Falls through to `uncertain`.
5. `deriveReviewTier` → `possiblePerson`: `identityOptions.length > 0` ✓,
   lexicon ✗ → **tier `null`**.
6. `ambiguitySectionFor` uncertain branch → `nameEvidence` false →
   `common-words`.

Consequence: Kyle is **untiered**, so it forms no tier group, so no bulk
control reaches it (handoff §6.4).

### The symmetry worth noticing

The same failing predicate produced **opposite** wrong outcomes: Amy was
swept *into* a bulk Ignore; Kyle was stranded *outside* every bulk action.
A predicate that is wrong in both directions at once is not a tuning
problem.

---

## 3. Is `hasKnownNameEvidence` asking the wrong question?

**Yes — but not because dictionaries are the wrong input. Because it asks
a question whose name promises far more than its implementation delivers,
and every caller believes the name.**

It is called `hasKnownNameEvidence`. It means `isOneOfTwentyEightTokens`.
A caller reading the call site cannot see the difference, and a `false`
from it is indistinguishable from a genuine absence of evidence. That is
the actual defect: **not the narrowness, but that the narrowness is
invisible at every call site.**

### Should sectioning depend on dictionary membership or accumulated evidence?

Accumulated evidence — with one important qualification in favour of the
existing design.

Dictionary membership is a fine *component*. It is cheap, deterministic,
document-independent, and it is the right signal for the negative
direction: knowing "and", "did", "grading" are ordinary words needs no
document context. **The asymmetry is what breaks it.** The lexicon holds
53,415 tokens of evidence that something is *not* a name and 28 that it
*is*, and a token absent from both is treated as "no name evidence" rather
than "no lexical opinion" — so absence of data reads as evidence of
absence.

Meanwhile the system computes, per document, exactly the positive evidence
the lexicon lacks: a high-confidence resolution to a full personal name
that appears in this document. That evidence is document-specific, which
is precisely why no general dictionary can ever supply it. **"Kyle" is not
a name in general; it is a name *in this document*, and DocScrub knows
that.**

### Are the four definitions intentionally different?

There are four live definitions:

| Site | Name | Membership |
|---|---|---|
| `ui/recommendations.ts` | `hasKnownNameEvidence` | 3: known-personal-name-token, known-first-name, known-name-structure |
| `entity-resolution/identity-cleanup.ts` | `hasKnownNameEvidence` (private) | 3: identical, **hand-duplicated** |
| `engines/normalization/normalization.ts` | `hasPersonNameEvidence` | 6: adds known-surname, surname-given-structure, initials-with-surname, nearby-title |
| `domain/semanticTypes.ts` | inline, unnamed | 5: adds strong-name-structure, surname-given-structure |

**One is intentional, three are not.**

- `normalization.ts` is **intentional and well-reasoned** — its comment
  explains precisely why `surname_given_structure` is in and
  `strong_name_structure` is out ("Grades Due" carries the latter). That
  is a deliberate, documented, locally-justified membership. Keep it.
- `identity-cleanup.ts` is a **hand copy** whose own comment says it is
  "the recommendation layer's KNOWN_NAME_CATEGORIES". A copy that names
  its original is a copy waiting to drift.
- `semanticTypes.ts` is an **inline list with no constant and no
  rationale**. It is wider than `recommendations.ts` for no stated reason.
- The `recommendations.ts` set is the **narrowest of the four** and is the
  one wired to the most user-visible consequences.

The sharpest expression of the inconsistency: **`known-surname` is name
evidence to normalization and is not name evidence to sectioning.** So a
recognized surname — one of the five — would still route to Other Words.
Nobody decided that; it is what happens when four lists exist.

### The finding underneath all of it

`deriveReviewTier` (L609) is **the only place in the codebase where lexicon
evidence and identity evidence meet**:

```ts
hasCategory(facts, ...KNOWN_NAME_CATEGORIES) && facts.identityOptions.length > 0
```

The composition is already there — it is simply the wrong operator. The
system has the right shape and the wrong logic, which is why this reads as
an inconsistency rather than a missing feature.

---

## 4. Proposal — one canonical predicate, no behavior change on day one

### Design

Add to `ui/recommendations.ts` a single graded predicate that returns
*why*, not just *whether*:

```ts
export type NameEvidenceSource =
  | "lexicon-given-name"      // known-first-name / known-personal-name-token
  | "lexicon-surname"         // known-surname   (today: silently ignored)
  | "name-structure"          // known-name-structure, surname-given-structure
  | "resolved-identity";      // ★ a recognized full-name home in THIS document

export interface PersonNameEvidence {
  sources: readonly NameEvidenceSource[];
  /** Lexicon-only. EXACTLY today's answer. */
  readonly lexical: boolean;
  /** Lexicon OR document-resolved identity. Tomorrow's answer. */
  readonly any: boolean;
}

export function personNameEvidence(facts: RecommendationFacts): PersonNameEvidence;
```

`resolved-identity` reuses the **existing** `recognizedOption()` gate — no
new confidence model, no new threshold, no new tuning surface. It is the
same recognition test `deriveRecommendation` already trusts to drive
suggestion buttons.

Then:

```ts
/** @deprecated prefer personNameEvidence(). Kept as the shipped answer. */
export function hasKnownNameEvidence(facts: RecommendationFacts): boolean {
  return personNameEvidence(facts).lexical;   // byte-identical behavior
}
```

**Day one changes nothing.** Every caller keeps reading `.lexical`, which
is the current predicate by construction. The switch to `.any` becomes a
one-line, per-call-site, reviewable decision — which is the point, because
the four call sites do **not** all want the same answer (§4.3).

### Why this shape rather than the obvious alternatives

- **Not "widen the dictionary."** Andrew's instinct is right. Adding
  "amy" and "kyle" makes the failure rarer without changing its shape; the
  next unlisted surname reproduces it exactly. It also cannot work in
  principle — the evidence that settles these two is document-specific.
- **Not "delete the dictionary."** It is genuinely the right signal for
  the negative direction and for document-independent judgements.
- **Not "unify all four definitions into one list."** `normalization.ts`
  has a documented, locally-correct membership; forcing it to share would
  destroy real reasoning to satisfy a tidiness goal. Unify the *question*
  and the *vocabulary*, not necessarily the answer.
- **Returning sources rather than a boolean** is what makes the narrowness
  visible. `sources: []` and `sources: ["lexicon-given-name"]` are
  different facts that today are both `false`/`true` with no way to tell
  "no evidence" from "no lexical opinion."

### Affected call sites

| # | Site | Today | Under proposal | Behavior change |
|---|---|---|---|---|
| 1 | `recommendations.ts:304` shortened-name gate | `hasCategory(...)` ∧ `recognized>0` | `.any` ∧ `recognized>0` | **Kyle gains an archetype.** Biggest single change. |
| 2 | `recommendations.ts:361` `singleTokenNonName` | `¬hasCategory(...)` | `¬.any` | **Amy stops being a common-word.** |
| 3 | `recommendations.ts:609` `deriveReviewTier` | `hasCategory(...)` ∧ `identityOptions>0` | `.any` | Kyle gains tier `needs-review`. |
| 4 | `app.ts:5848` `nameEvidence` | `hasKnownNameEvidence` | `.any` | Sectioning follows 1–3. |
| 5 | `identity-cleanup.ts:224` | private copy | import the shared vocabulary | Engine layer — **defer**, see risk. |
| 6 | `semanticTypes.ts:143` | inline list | named constant, membership unchanged | None (naming only). |
| 7 | `normalization.ts:224` | own 6-category set | unchanged, documented as deliberate | None. |

Sites 1–4 are the shipped-behavior surface. Sites 5–7 are consistency
cleanup and can land independently and first.

### Where flipping to `.any` would change visible behavior

This is the list to review before flipping anything:

1. **Items move between categories on a shipped surface.** Kyle leaves
   Other Words for Shortened Names. Any reviewer mid-session sees a
   recount. Decisions already made are keyed by candidate id and are
   unaffected, but the *queue order* changes.
2. **Amy's chips change** from ① Common word ② Person's name to the
   uncertain pair, or to a shortened-name suggestion — a different digit
   meaning for the same keystroke. Worth a deliberate look under the
   one-digit-space discipline.
3. **Tier populations shift**, which moves the strong-tier bulk scope, and
   the bulk *count* on a button changes. §6.4's untiered-tail gap shrinks
   but does not close — untiered items still form no group.
4. **Other Words shrinks**, possibly a lot. The 23-item strong tier is
   built substantially from `expanded_common_language_token` hits; any of
   those with a recognized identity option leave. Measure before flipping.
5. **Decision Tracker / "decisions avoided" figures move**, because
   section populations feed them.
6. **`hasKnownNameEvidence` is UI-layer, not engine-layer**, so the
   Python parity suites (`detection-parity`, `quality-parity`,
   `entity-resolution-parity`, `production-parity`) do **not** cover it.
   Confirmed by inspection. Sites 1–4 carry **no parity risk**. Site 5
   (`identity-cleanup.ts`) is inside the engine and **does** — which is
   why it should be vocabulary-only and land separately.

### Migration risk

**Low for the refactor, entirely concentrated in the flip.**

- The refactor is provably behavior-preserving: `.lexical` is the current
  expression, and `hasKnownNameEvidence` keeps returning it.
- The existing suites will not catch a regression in the flip.
  `triage-queue-verification.ts` passes 66/66 today *while the live app
  misfiles Kyle*, because its fixture constructs `nameEvidence: true`
  directly. **Any work here needs fixtures built from real candidate
  facts, not from hand-set booleans** — otherwise the tests keep agreeing
  with whatever the code does.
- Flip one call site at a time, in the order 3 → 1 → 2 → 4 (tier first: it
  is the least visible and it closes part of §6.4 on its own).

### Open questions for Andrew

1. **Should `resolved-identity` alone be sufficient, or should it require
   the detector to have said "person"?** Kyle and Amy both satisfy both,
   so the live cases do not discriminate. I lean toward requiring
   `detectedType === "person"` — it costs nothing here and keeps
   organization aliases out.
2. **Does a recognized surname count?** Fixing #6 (adding
   `known-surname`) is a one-line change with its own behavior surface,
   independent of the identity work. It could ship first.
3. **`lopez` and `parra` are in both `KNOWN_GIVEN_NAMES` and
   `KNOWN_SURNAMES`.** Data defect, independent of all the above, and
   `scripts/generate_quality_dictionaries.py` is where it originates.
4. **Is the 28-token positive lexicon meant to be a seed or a
   deliverable?** If a seed, the whole design should stop treating lexicon
   absence as evidence — which is what this proposal does.
