# Detection & Classification — Handoff for a Fresh Pass

**Date:** 2026-08-03
**Status:** Investigation only. Nothing in this document has been changed.
**Why a handoff:** these are detection/quality-layer findings, surfaced from
live review during a long UI session. They deserve a pass with full context
rather than a tired one.

Ordered by consequence, not by discovery.

---

## 1. Truncated detections — a partial redaction that reads as complete

**The most serious item here.** From a live "Likely People" list:

> Virtual Clearinghouse **Academ** · Service **Indi** · Yazmine **Guzm** ·
> Science **Teach** · Science Teacher **Initiativ**

Detections are ending mid-word. The same phrase appears three times at three
lengths — *Science Teach*, *Science Teacher Initiativ*, *Science Teacher
Initiative* — so it is per-occurrence, not one bad rule.

**Why this outranks everything else:** if "Yazmine Guzmán" is only ever
detected as "Yazmine Guzm", redacting it leaves **"án"** in the released
document. The reviewer sees the truncated span, redacts exactly what they
were shown, and the output looks handled. A truncated detection is a silent
partial redaction.

### Cause A — ASCII-only patterns (provable)

`src/engines/detectors/patterns.ts`:

```js
FALLBACK_PERSON_RE = /\b(?:[A-Z][a-z]{1,30})(?:\s+(?:[A-Z][a-z]{1,30})){1,3}\b/g
SINGLE_PERSON_RE   = /\b[A-Z][a-zA-Z'’-]{2,30}\b/g
```

`[a-z]` is ASCII-only and JavaScript's `\b` is too. In **"Guzmán"** the `á`
is not a word character, so it both terminates the token *and* supplies a
legal word boundary — the truncated match "Guzm" is well-formed by the
pattern's own rules. **Every accented name in every document truncates at
the accent.**

These are ported from Python, where the same expressions behave differently:
Python's `re` is Unicode-aware by default, so `[a-z]`/`\b` there do not split
on `á`. This is a porting divergence, not an original design choice — worth
checking the whole `patterns.ts` file against the oracle for the same class
of issue, not just these two.

### Cause B — run fragmentation (hypothesis, unverified)

The other truncations lose inconsistent amounts (`Academ|y`, `Teach|er`,
`Initiativ|e`, `Indi|vidual`), which does not look like a rule. It looks like
DOCX **run boundaries falling mid-word** — formatting changes, spell-check
artifacts, tracked-change residue — so the block text the detector matches
against is already fragmented before any regex runs.

**First thing to check:** does the parser join runs within a paragraph before
detection, or does it match per-run? If per-run, no pattern fix will help.

---

## 2. Two classifiers, separately maintained, already drifted

`semanticTypeFor` (`src/domain/semanticTypes.ts`) assigns the Type Check
bucket. `deriveRecommendation` (`src/ui/recommendations.ts`) assigns the
archetype driving the chip and the Item Check section. Both read the same
quality categories, through **two hand-maintained lists**:

```
INSTITUTIONAL_CATEGORIES        semanticTypeFor → "organizations"
  department-organization         department-organization
  organization-suffix             organization-suffix
  institution-term                institution-term
  product-system-name             product-system-name
  document-structure-term    ←    (absent — routed to "document-titles")
  administrative-phrase           administrative-phrase
  legal-administrative-term       legal-administrative-term
```

One entry apart: anything carrying `document-structure-term` is a **Document
Title** to one classifier and an **Institutional term** to the other.

Second, independent mismatch: `deriveRecommendation`'s institutional branch
is gated on `personTokenCount <= 2`; `semanticTypeFor` has no such gate. So
"Office of the University Registrar" is an *organization* by type and has *no
archetype at all* by recommendation.

**Three ways out, ascending:**

1. **Share the lists.** Export the constants once, both consume them. Kills
   the `document-structure-term` drift; nearly free. Leaves the token gate.
2. **Derive one from the other**, so type and recommendation are structurally
   incapable of disagreeing. The real fix, and the shape this codebase
   prefers — but the archetype currently lives in the UI layer and
   `semanticTypes.ts` is domain, so something must move before it is legal
   under the boundary rule.
3. **A dedicated category** for the recurring "institutional term the
   detector typed as a person" cluster. Worth doing *after* the above —
   otherwise it is a fourth opinion in a system where three already disagree.

---

## 3. "Likely People" is the fallback bucket, and its Accept All is Keep

`triageSectionFor` sends **any** person-typed item with no archetype to
Likely People. A live sample of that section:

> Academic Senate (8) · Reason Code · New Student (3) · Math Option ·
> Pacific Standard Time · Clearinghouse Webinar · Level Spoofing

Almost none are people. They are Title Case phrases, which is exactly what
`FALLBACK_PERSON_RE` fires on, and the quality engine never tagged them
institutional, so they fall through to `uncertain` → people.

**Why the default points the wrong way:** Likely People's *Accept All
Remaining* applies **Keep** — a positive acknowledgement — so sweeping the
section confirms "Academic Senate" as a real entity in the registry. That is
the identity knowledge intended to stay clean for future model improvement
and the user's personal decision database.

`None are names` (added 2026-08-03) is now the escape hatch, but the *default*
still confirms. Worth deciding whether an unrecommended person-typed item
should land somewhere that does not imply personhood.

---

## 4. Acronym detection is pure shape, no lexicon

**AG:** *"please check if Acronym search is just looking for items in ALL
CAPS … e.g. CALENDAR, OPEN, NOTE, TODAY, NEWS, VETERAN. I know that acronyms
can often be words so I'm not recommending removing these examples."*

Confirmed. `src/engines/quality/scoring.ts:190`:

```js
ACRONYM_RE = /^(?:[A-Z]{2,10}|[A-Z]{1,6}\d{1,4}|(?:[A-Z]\.){2,}|…)$/
```

The first alternative is `[A-Z]{2,10}` — **any** 2–10 consecutive capitals.
`StructuralRelationshipEngine.ts:67` is barer still: `/^[A-Z]{2,10}$/`.
Neither consults a dictionary, though `quality-dictionaries.data.ts` already
ships one.

Per AG, **do not exclude dictionary words** — real acronyms often are words
(NOTE, NEWS, CARE). The useful move is to weaken the *claim*, not remove the
detection: a token that is also a common English word is a weaker acronym
signal, which could lower its confidence, or give it a second disposition
chip so the reviewer can say which it is — the same two-way shape the
person-typed and email/phone items now use.

The cheap version is one dictionary lookup feeding an existing confidence
band. No new UI, no new vocabulary.

---

## Suggested order

1. **Run fragmentation** (§1B) — one question, and it gates whether §1A
   matters at all.
2. **ASCII patterns** (§1A) — mechanical once confirmed; check the whole
   `patterns.ts` against the Python oracle, not just the two named here.
3. **Share the category lists** (§2.1) — nearly free, removes a live
   inconsistency.
4. **Acronym confidence** (§4) — small, self-contained, visible improvement.
5. **Likely People's default** (§3) and the deeper classifier unification
   (§2.2) — design conversations, not fixes.

§1 and §2/3/4 are independent; §1 is correctness, the rest is accuracy and
ergonomics.
