# Normalization processing step

**Date:** 2026-08-03 · **Version:** `v2026-08-03.05`
**Spec:** Andrew's "Implement a Normalization processing step" message (2026-08-03)
**Status:** implementation complete, all suites green, **browser validation pending**

---

## What this is for

Not better detection — a better review.

The detector is doing its job correctly when it captures `Thanks, Andrew`:
that really is a capitalized token sequence in the document. But the
reviewer does not have a question about "Thanks, Andrew." They have a
question about **Andrew**, and the pipeline was asking it seven times.

From Andrew's real transcript, before this pass:

| candidate | occurrences |
|---|---|
| `Andrew` | 46 |
| `Thanks Andrew` | 10 |
| `Thanks, Andrew` | 5 |
| `Hi Andrew` | 4 |
| `Good Afternoon Andrew` | 2 |
| `And Thank You Andrew` | 2 |
| `Andrew  Are` | 1 |

Six of those seven decisions are the reviewer re-answering a question they
already answered. Normalization removes them from the review without
removing them from the record.

## Pipeline position

```
Detection → NORMALIZATION → Grouping → Type Check → Item Check
```

Operates only on detected entity spans, never on raw document text. The
original `DocumentModel` and the original `DetectionResult` both remain
unchanged and are held alongside the normalized stream in `Workspace`.

## The rule: one rule, three gates

A person candidate is normalized when **all three** hold.

**1. Affix gate.** Stripping only *leading* and *trailing* tokens that
existing curated evidence classifies as ordinary language leaves a
non-empty remainder. Interior tokens are never touched. Edge punctuation
comes off after the tokens do.

**2. Corroboration gate.** The remainder resolves — through the
**detector's own key function** — to a candidate this same document
independently detected. The pass never invents an entity the detector did
not find on its own.

**3. Name-evidence gate.** That corroborating candidate carries positive
person-name evidence from `CandidateQualityEngine`.

Gate 3 is what makes gate 2 safe, and it is not theoretical. On Andrew's
transcript `May Session` strips to `May`, and `May` **is** a detected
candidate — gate 2 alone would have merged a calendar term into a person.
The quality engine had already classified it `calendar_term` with no name
evidence, so gate 3 refuses. Same for `For Fall` → `Fall`
(`season_or_academic_term`), `The Reg` → `Reg`, `Correct Begin` →
`Correct`.

This is precisely the class of Frankenstein identity the `.09`
identity-cleanup pass minted on its first cut (`May Dates`, `Fall Term`).
The lesson from that session is applied here up front rather than
rediscovered.

## What is never normalized

Every case from the specification falls out of the three gates rather than
needing a special case:

| case | why it is refused |
|---|---|
| `Chris` → `Christopher` | expansion, not stripping — gate 1 never fires |
| `Garcia` → `Margaret Garcia` | same |
| `Associate Dean` → `Dean` | `Associate` is not ordinary language (gate 1); `Dean` has no name evidence (gate 3) |
| `Engineering, Computer Science` → `Computer Science` | splitting a list is a structural claim, not affix removal |
| `Like` / `Will` discarded | **this pass never discards a candidate** |

`Will` is additionally protected by the quality data's own
`ambiguous_lexical_token` judgment — classified `unknown`, never
`ordinary` — so `Will Diana` stays intact.

**Invariants, suite-enforced rather than asserted:** occurrence count is
invariant; every occurrence id survives unchanged; `startOffset` /
`endOffset` / `text` / `context` are untouched; no occurrence is orphaned;
the input `DetectionResult` is not mutated.

## Three findings worth recording

### 1. Redacting the original span would have deleted the reviewer's prose

`DocumentRebuilder` edits by `occurrence.text`. Merging `Thanks, Andrew`
into `Andrew` and redacting would have produced `[REDACTED PERSON]` where
the document said `Thanks, Andrew` — quietly deleting the word "Thanks"
from a document whose whole purpose is faithful redaction.

The specification said original spans keep driving highlighting, evidence,
QA and audit; it did not say what the *rebuild* should use. Raised with
Andrew rather than assumed. **His call: narrow the effective span.**

Implemented as an additive optional `Occurrence.effectiveSpan`, plus one
canonical `redactionSpanOf()` helper in `DocumentModel.ts` that both
`DocumentRebuilder` and `OutputVerifier` route through. The helper exists
because the failure mode of forgetting the field is silent and asymmetric:
no crash, no type error, just prose quietly disappearing from output. Same
treatment as the `InlineEditorTarget` render sites — one named accessor,
every consumer through it.

Narrowing `OutputVerifier` is also **stricter**, not just more faithful:
after the merge, the string that must not survive is `Andrew`, and
checking for the longer `Thanks, Andrew` would have passed trivially while
real residual PII sat in the output.

`DOCUMENT_MODEL_SCHEMA_VERSION` is deliberately **not** bumped: the
parser's output shape is unchanged, and no persisted artifact carries
occurrences.

### 2. Transitive chains are structurally impossible, not merely filtered

Affix stripping is greedy from both ends, so a retained remainder never
itself has a strippable edge — meaning a merge target can never also be a
merge source. `Thanks Hi Andrew` resolves *directly* to `Andrew` in one
hop; it never routes through `Hi Andrew`.

`normalizeDetection()` keeps an explicit no-chaining filter anyway as
defense-in-depth against a future non-greedy rule, and the suite pins the
structural property. If that check ever fails, the filter has started
earning its keep and the reasoning needs revisiting.

### 3. A latent performance trap in `classifyIdentityToken`

`identity-cleanup.ts`'s `classifyIdentityToken(token, lexicons =
buildLexicons())` rebuilds the full 2,708-row related-names CSV and every
quality dictionary **per call** when the second argument is omitted.
Harmless while the only caller hoisted its own copy; **686ms for one
document** the moment a per-token caller appeared.

Fixed with a memoized `sharedIdentityLexicons()` rather than by hoisting
at the new call site, so the trap cannot be re-sprung by the next caller.
**686ms → 7.7ms.**

## Deliberate, disclosed judgment calls

**Person candidates only.** Emails, phones, CINs and long numeric ids have
no conversational wrapper to remove — the detector already normalizes them
to digits/address form — so running this pass over them could only produce
a false positive.

**Quality is evaluated twice.** The safety gate needs an assessment before
normalization can run, and normalization changes occurrence counts
(`Andrew` goes 46 → 70), which is itself scoring evidence. Reusing the
first pass downstream would leave assessments keyed to candidates that no
longer exist and frequency evidence that is quietly wrong. Measured cost
on the 609-candidate transcript: 46ms, run twice. Alternatives considered
and rejected: gating on lexicon name evidence instead of quality
categories (this is exactly what admits `May Session` → `May`); caching
the first assessment (stale by construction).

**`good` is a bigram, not a prefix token.** "Good morning Andrew" is
handled by matching `good` + a time-of-day tail, not by adding `good` to
the prefix lexicon — `good` alone is an ordinary adjective and heads real
surnames (Good, Goodman, Goodwin). The greeting is the pair.

**Two additive lexicons, both deliberately short.**
`DOCUMENT_NOISE_TOKENS` (trailing only: transcripts, attachment, agenda,
minutes…) and `CONVERSATIONAL_PREFIX_TOKENS` (leading only: dear, fyi, cc,
re…). Words that could be surnames — Fields, Rivers, Banks, Page, Marks —
are excluded on purpose; a longer list is not a better list here. Both are
module-owned, in the `SENTENCE_CONTEXT_TOKENS` precedent; no parity
dictionary is touched.

**`surname_given_structure` counts as name evidence,
`strong_name_structure` does not.** The former (weight 50, the "Last,
First" comma form) is what carries `Goodloe, Andrew Are` →
`Goodloe, Andrew`. The latter (weight 35) is a weaker shape test that
matches ordinary capitalized bigrams — `Grades Due` carries it on Andrew's
transcript, and including it would have merged `Spring Grades Due` into
it.

**Relationship to `identity-cleanup.ts`.** They answer different questions
at different points and share their *evidence*, not their *logic*:
identity-cleanup runs after grouping over ambiguity proposals and asks "is
this a plausible identity to offer?"; normalization runs before grouping
over candidates and asks "is this the same review candidate as one we
already have?" `classifyIdentityToken()` is imported rather than
reimplemented so the two can never drift on what counts as ordinary
language.

## Result on Andrew's real transcript

```
candidatesBefore   609
candidatesAfter    590
candidatesCollapsed 19
occurrencesRehomed  57
spansNarrowed       57
spansLeftWhole       0
normalizeDetection  9.4ms
```

All 19 collapses inspected individually; **zero false positives.**

```
"Andrew" (70 after)          ← Thanks Andrew · Thanks, Andrew · Hi Andrew
                               · Andrew Are · Good Afternoon Andrew
                               · And Thank You Andrew
"Tamara" (43 after)          ← Thanks Tamara · Thanks, Tamara · Hi Tamara
"Tanesha" (39 after)         ← Hi Tanesha · Tanesha Can
"Nelly" (21 after)           ← Hi Nelly · Thanks Nelly
"Margaret" (40 after)        ← Afternoon, Margaret
"Goodloe, Andrew" (742)      ← Goodloe,   Andrew  Are
"Collier, Tanesha" (400)     ← Collier,   Tanesha  Can
"Goodloe" (35 after)         ← Goodloe,   An
"Diana" (4) / "Sarah" (4)    ← Yes, Diana · Yes, Sarah
```

Correctly refused: `May Session`, `For Fall`, `The Reg`, `Correct Begin`,
`Thanks Mrs`, `Hi Registrars`, `Hi Managers`, `Hello All`, `Dear Student`,
`Good Morning`, `Yes Thank`, `Will Diana`, `Summer Session`,
`Term Activation`, `Spring Grades Due`, and 46 others.

## Files

| file | change |
|---|---|
| `src/engines/normalization/normalization.ts` | **new** — the pure pass |
| `src/domain/DocumentModel.ts` | additive `Occurrence.effectiveSpan`, `EffectiveSpan`, `redactionSpanOf()` |
| `src/engines/DetectionEngine.ts` | export `detectionCandidateKey` (visibility only, no behavior change) |
| `src/engines/entity-resolution/identity-cleanup.ts` | memoized `sharedIdentityLexicons()` |
| `src/workspace/Workspace.ts` | wiring; `rawDetection` + `normalization` retained; `WorkspaceState.normalization` |
| `src/io/DocumentRebuilder.ts` | edits the redaction span |
| `src/io/OutputVerifier.ts` | forbids the redaction span |
| `src/ui/app.ts` | Expert View "Normalized from" |
| `verify/normalization-verification.ts` | **new** — 66 checks |

## Verification

- `verify/normalization-verification.ts` — **66/66**
- Full battery — **46 suites, zero failures**, including
  `detection-parity`, `entity-resolution-parity`, `quality-parity`,
  `occurrence-classification-parity` and `production-parity`. The parity
  engines are byte-identical; normalization is wired at the Workspace
  level, so every parity harness constructs a bare pipeline that this pass
  never touches.
- `tsc --noEmit` and full `tsc` build both clean.
- Real-document before/after run, inspected candidate by candidate.

## Browser validation checklist (pending)

1. Load `work/pii_docx_redactor/.local_web_state/upload.docx`.
2. Item Check: search "Andrew" — expect **one** Andrew candidate, not seven.
3. Open it → **Why?** → **Expert View** → **Normalized from** lists all six
   variants with the tokens removed.
4. **All occurrences** still shows the original spans verbatim, including
   the ones reading "Thanks Andrew".
5. Confirm the occurrence count reads 70, not 46.
6. Decide Redact on `Andrew`, generate output, and confirm the document
   reads **"Thanks, [REDACTED PERSON]"** — the greeting intact.
7. Confirm verification passes (no `body-text-residual-pii` finding).
8. Confirm `May Session`, `For Fall`, `The Reg` and `Good Morning` are all
   still present as their own candidates.

## Open follow-ups for Andrew

1. **Metrics window.** `WorkspaceState.normalization.stats` is exposed but
   not yet rendered in the metrics window alongside `identityCleanup`.
   One-section addition if wanted.
2. **Decision reuse across document versions.** A decision recorded
   against the merged `Andrew` will match a future version's `Andrew` by
   exact candidate key as before; a *pre-normalization* `decisions.json`
   carrying a `Thanks Andrew` key will now fall to the grouped-alias or
   similarity tier rather than matching exactly. Worth a look if you have
   saved decision files from before today.
3. **Group-canonical display.** `Collier, Tanesha` remains the group's
   canonical name; normalization deliberately does not rename groups
   (Group Check display, replacement, and audit surfaces) — the same
   boundary the `.09` pass drew.
