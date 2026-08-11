# Oracle Deviations #4 and #5 — Identifier Boundaries and the Token Ceiling

**Date:** 2026-08-09
**Required by:** `AGENTS.md` — "The Python app is the behavioral oracle; every intentional deviation is classified and recorded, never silent."
**Status:** landed. 55/55 suites, `tsc` and build clean.
**Classification:** **correctness fixes**, not behavior changes. Rationale in each entry.

---

## Why these are classified as correctness fixes

The implementation philosophy says to preserve stated reviewer behavior and make the smallest adjustment necessary. It does not extend to preserving oracle output that **damages the document DocScrub exists to protect**. Two of the three defects below were demonstrated to corrupt output — a redacted URL and a destroyed separator — on Andrew's live document, not in a thought experiment.

Each was found by running `__docscrub.truncations()` over 5,854 real occurrences and inspecting the 9 flagged. None was inferred from reading code.

---

## DEVIATION #4 — identifier boundary guards

**File:** `src/engines/detectors/patterns.ts`

### 4a. Digit runs matched inside longer alphanumeric tokens

| | |
|---|---|
| **Python** | `CIN_RE = (?<!\d)\d{9}(?!\d)` · `LONG_ID_RE = (?<!\d)(?:\d[\s-]?){10,18}\d?(?!\d)` |
| **DocScrub** | guards widened from "not a digit" to "not a digit **and not a letter**" |

Both oracle patterns guard against neighbouring **digits** only. A nine- or eleven-digit run sitting inside a longer alphanumeric token therefore matches, because the adjacent character is a letter and the digit guard cannot see it.

**Live evidence (6 of the 7 severed occurrences):**

```
https://teams.microsoft.com/l/meetup/781237504d3f8a9b   → CIN_RE matched 781237504
id=18900663687e4c1a99                                   → LONG_ID_RE matched 18900663687
ref 01200067742E5B                                      → LONG_ID_RE matched 01200067742
```

**Proven output corruption:**

```
redact 781237504 →  https://teams.microsoft.com/l/meetup/[REDACTED]d3f8a9b
```

A URL is destroyed and the document is silently wrong. No reviewer decision can prevent this — the candidate looks like a Campus ID and redacting it is the correct-looking action.

**Why not narrower.** Restricting to hex letters `[a-fA-F]` would fix the observed cases and miss `781237504zz`. The claim is "these digits are part of a larger token"; any letter makes that true.

**Preserved:** genuine identifiers delimited by whitespace or punctuation still match — `CIN 781237504`, `Student ID: 123456789.`, `(987654321)`, `id=456789012&`, and a bare `781237504`. The oracle's own digit guard is unchanged.

### 4b. `LONG_ID_RE` consumed the trailing separator

`(?:\d[\s-]?){10,18}` lets the **final** repetition eat a trailing space.

**Live evidence (the 7th severed occurrence):** `"Meeting ID: 826 0122 9711 Passcode"` matched `"826 0122 9711 "` — **including the space**, span `[12,26)`.

**Proven output corruption:** redaction yields `"[REDACTED]Passcode:"` — the separator is gone.

**Fix:** restructured to `\d(?:[\s-]?\d){9,18}` — digit, then separator-then-digit. Cannot end on a separator; spans the same 10–19 digits. Internal separators are still consumed (`123-456-789-012` intact).

---

## DEVIATION #5 — `FALLBACK_PERSON_RE` token ceiling

| | |
|---|---|
| **Python** | `(?:[A-Z][a-z]{1,30})(?:\s+(?:[A-Z][a-z]{1,30})){1,3}` — max 4 tokens |
| **DocScrub** | `{1,3}` → `{1,5}` — max 6 tokens |

A longer capitalized phrase is not skipped by the oracle, it is **cut**, and the remainder becomes its own candidate — two review units and two replacement spans covering one phrase.

**Live evidence (2 occurrences):**

```
"Post Enrollment Requisite Checking Background Process"
     → "Post Enrollment Requisite Checking" + "Background Process"
"Term Session Appt Block Appt Nbr"
     → "Term Session Appt Block" + "Appt Nbr"
```

Redacting the first half leaves `"[REDACTED] Background Process"` — a dangling fragment of a phrase the reviewer believed they had handled.

**Bound chosen by measurement, not preference.** `{1,5}` merges both live cases. `{1,7}` merges nothing further on this document and over-joins long institutional headings. Four-token person names (`Mary Jane Watson Parker`) are unaffected at every bound tested.

**The ceiling still exists** — a seven-token run is still bounded. Any bound has a boundary; this one is placed where the evidence put it.

---

## Known limitation recorded, not fixed

`[A-Z][a-z]{1,30}` requires at least one lowercase character, so a bare **middle initial** matches no token position. `"Tamara L Yamada"` yields nothing from `FALLBACK_PERSON_RE` — at `{1,3}` and `{1,5}` alike, verified by reconstructing the original bound.

The name is still detected: Andrew's document contains `"Yamada, Tamara L"`, which `LAST_FIRST_PERSON_RE` picks up as `"Yamada, Tamara"` (its optional third token has the same lowercase requirement, so the initial is dropped).

This is **pre-existing**, unrelated to either deviation, and a candidate for a later pass. Recorded rather than dropped from the suite so it is not silently rediscovered.

---

## Verification

`verify/identifier-boundary-verification.ts` — **34 behavioral checks**, no source-text assertions. Includes the actual replacement splice for both corruption cases, so "would corrupt output" is asserted as a resulting string rather than claimed.

Positive coverage is deliberately as heavy as negative: the risk of a boundary fix is over-tightening, so genuine identifiers, phone numbers, internal separators, and the oracle's original digit guard are all asserted to still behave.

`verify/truncation-diagnostics-verification.ts` updated: the five-token case now asserts the fix holds, while the classifier is still proven to recognize four-token fragments — a diagnostic that stopped detecting the class the moment one instance was fixed would be useless for the next.

### Parity suites: green, but they do not cover this

All five parity suites pass. **That is weaker evidence than it appears**, and stating it plainly matters more than the green:

```
parity fixture candidates: 52
  9-digit CIN shapes:        0
  10+ digit LONG_ID shapes:  0
  5+ token phrases:          0
```

The domain-parity fixtures contain **none** of the shapes these deviations touch. They pass because they cannot fail. The real evidence is the new behavioral suite plus the live-document diagnostic, and the fixture corpus should gain these shapes before it is trusted on this ground.

---

## Residual risk

**Under-detection of long identifiers adjacent to letters.** If a real Campus ID ever appears as `CIN781237504` with no delimiter, it is now missed. Judged the safer failure: a missed candidate is visible in QA, a corrupted URL is not.

**Slightly longer person candidates.** `{1,5}` produces up to six-token candidates, which will change some Ambiguity/Type Check groupings. Should reduce Item Check volume marginally (two units become one) — the opposite direction from Phase 2's concern, so worth watching in the next measurement rather than assuming.

**The fixture gap above** is the one I would close before the next oracle-adjacent change.

---

## DEVIATION #6 — `nearby_title` scope

**File:** `src/engines/quality/scoring.ts`

| | |
|---|---|
| **Python** | `NEAR_TITLE_BEFORE_RE.test(before) \|\| TITLE_RE.test(context)` |
| **DocScrub** | whole-context branch deleted; title must be attached to, or immediately precede, the candidate |

The second branch tested the **entire 140-character window**, so a title anywhere in it fired — after the candidate, in a different sentence, or belonging to someone else.

```
before  anywhere  fires
true    true      true   "Dr. [Garcia] will review it"                    correct
false   true      true   "[The] Reg audit report came in.  Dr. Garcia..."
false   true      true   "[Grades] are due Friday, per Dean Martinez"
false   true      true   "[Morning] everyone -- Dr. Lopez is out today"
false   true      true   "[Andrew] met with Dr. Garcia"
```

The last row is the defect stated plainly: **the rule attributed one person's honorific to a different candidate.** On the live document it was the sole remaining reason `The` was held as "recognized as a name", alongside `Last`, `Thank`, `Grades`, `Morning`.

**Replacement, not just deletion.** The whole-context branch also carried the case where the candidate's OWN text is the titled name (`Dr. Garcia` detected as one candidate). Deleting it alone would have narrowed a bad rule by losing a good signal — the classic failure of an over-eager precision fix — so `nearTitle` now also tests the candidate's display value.

**Classification: precision fix.** The oracle's answer is a false claim about the document, and the evidence layer's credibility is what the residual gate rests on.

**Verified by** `verify/nearby-title-scope-verification.ts` — 23 behavioral checks over the real quality engine, weighted equally between "must still fire" (honorific-before-name, attached title) and "must not fire" (other person's title, title after, across a sentence boundary, ordinary words near titled people).
