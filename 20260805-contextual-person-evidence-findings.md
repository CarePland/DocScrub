# Contextual Person Evidence — implementation findings

**Date:** 2026-08-05
**Scope:** `app/src/engines/contextual-person-evidence/` (new), composed into
`engines/quality/scoring.ts`, `engines/CandidateQualityEngine.ts`,
`engines/normalization/normalization.ts`, `workspace/Workspace.ts`.
**Suite:** `app/verify/contextual-person-evidence-verification.ts` — 77/77.

---

## What was built

Eleven rules in two families, contributing **one** evidence chip.

**Sentence-level usage** (reads the occurrence context string):

| Rule | Wt | Fires on |
| --- | ---: | --- |
| `contextual_direct_address` | 40 | `Hi Jordan,` · `Thanks, Alex.` · `Casey, could you review this?` |
| `contextual_attribution` | 40 | `Jordan said…` · `according to Alex` · `Casey wrote…` |
| `contextual_coordination` | 34 | `Jordan and the director` · `Alex and Susan` · `the chair and Casey` |
| `contextual_person_list` | 32 | `Jordan, Alex, and Casey` |
| `contextual_possessive` | 30 | `Jordan's office` |
| `contextual_human_subject` | 30 | `Jordan approved the request.` |
| `contextual_human_object` | 24 | `Contact Jordan.` · `We asked Casey.` |

**Anchor / representative context** (reads block adjacency):

| Rule | Wt | Fires on |
| --- | ---: | --- |
| `anchor_full_name_with_role` | 50 | `Jordan Lee, Director of Finance` · `Alex Rivera — Senior Counsel` |
| `anchor_signature_block` | 48 | name line + role/org line(s) across separate blocks |
| `anchor_name_with_email` | 42 | `Casey Morgan (cmorgan@example.edu)` |
| `anchor_full_name_with_organization` | 40 | `Jordan Lee, Human Resources` |

---

## Five findings worth keeping

### 1. The gate matters more than the weight

`scoreCandidateQuality` early-returns `filterResult()` whenever there are
negative filter rules and **zero** positive reasons — discarding structure and
landing the candidate at the floor. Whether a contextual rule enters
`positiveReasons` flips that branch, which is worth more than any number.

"May" in `Thanks, May, for the update.`:

```
before:  calendar_term −22, common_english_word −28, no positives
         → gate → score 1, Unlikely
after:   skips the gate → single-token branch
         35 −4 +40 +8 −50 = 29 → To Review, Possible
```

The lexical negatives **survive in the sum**. Contextual evidence overcomes the
ambiguity without erasing it — the specified behaviour, produced by arithmetic
rather than a special case. Suite section 9 asserts all of it, including that
`May` is *not* promoted to Strong.

### 2. Correlated evidence must not be summed

The suggested weights (+24…+60) sit at or above the strongest lexical signals
on a base-35, 1–99 clamped scale. Free accumulation puts three hits on a bare
first name at 135 → clamped 99, tied with `Jordan Lee, Director of Finance` and
tied with each other. The score stops ranking exactly where ranking matters.

`Jordan said…`, `Jordan approved it`, `Jordan's office` are three observations
of **one** fact. So:

```
strongest + 0.4·second + 0.2·third + 0.1·each remaining, capped at 55
```

One cap across both families. Base 35 + 55 = **90**: maximal contextual
evidence with zero lexical support reaches Strong — correct, a signature block
with a role line *is* strong evidence for a name no lexicon has seen — while
never clamping the scale, so lexical evidence still discriminates above it.

Applied at the source too: `attribution` **suppresses** `human_subject`,
because "said" is deliberately in both lexicons and one observation must not
count twice.

### 3. The anchor family could not have been built from the context string

`contextSnippet()` is ±70 chars **inside one ContentBlock**. A signature block
is three blocks; a name with the email on the next line is two. Both of your
headline anchor examples are invisible to it, and an implementation built on it
alone would have silently never fired them. The anchor rules read
`DocumentModel` block adjacency instead — `CandidateQualityEngine` already
receives the document, so nothing new had to be threaded through.

Same class as the heading-context interface gap: the behaviour could not be
implemented from the inputs available, so the inputs were corrected.

### 4. `_appears_in_email` misses your own second example

The ported rule splits the local part on `[a-z]+` and requires a whole-token
match, so `cmorgan` yields one token equal to neither "casey" nor "morgan" —
`Casey Morgan (cmorgan@example.edu)` does not fire it. The anchor rule uses
substring containment of a ≥4-character name token, which fires correctly. The
ported rule is untouched; this is additive.

### 5. The anchor pass moves the score barely, and the explanation a lot

Every occurrence-scanning helper in the port already uses "any occurrence
matches" — already a max across occurrences. Selecting a strongest occurrence
changes almost no scoring outcome. Its real value is choosing what the reviewer
is **shown**. Built and documented as that, not dressed up as scoring.

---

## Decisions taken inside the four you answered

**One chip, not eleven.** The evidence panel's contract is that displayed
weights sum to the score. A capped, diminishing family cannot honour that if
each member renders at its base weight (column sums to +140 beside a score that
moved 55); rendering members at discounted values is honest arithmetic and
unreadable evidence ("Possessive form, +6"). So the family contributes one
weighted chip — **"Used as a person"** — and the individual usages travel to the
explanation as prose beside the representative example. One new chip on a
55-chip panel, no new colour, palette untouched.

**Gate 3 takes a strength threshold, not a vocabulary entry.** You said
contextual evidence should count for normalization's name-evidence gate. It
could not be routed through `qualityCategoriesOf()` — that returns "filterRules
if any, else reasons", so for exactly the ambiguous candidates this is meant to
help ("May", carrying `calendar_term`) the positive reasons are invisible.
`NormalizationInputs` gains `contextualStrengthOf` and gate 3 accepts ≥ 30.
At 30 a lone `human_object` (24) cannot authorize a merge, while any strong
usage or any anchor can — the gate keeps the teeth that stop
`May Session → May`, and gains the evidence you asked it to see.

**Contextual evidence is recomputed after normalization**, for the same reason
quality is: merging seven variants of "Andrew" changes which occurrences the
surviving candidate owns, and therefore which sentences its evidence and its
representative example come from.

---

## Verification

Full battery re-run. `npx tsc --noEmit` clean.

**Python parity intact, no fixture deviations:**

| Suite | Result |
| --- | --- |
| `quality-parity` | **12/12 fixtures fully match Python quality scoring** |
| `detection-parity` | 12/12 |
| `entity-resolution-parity` | 13/13 |
| `occurrence-classification-parity` | 13/13 |
| `production-parity` | 14/14 |

This holds because the pass is composed **in**, not built in.
`scoreCandidateQuality()` takes contextual evidence as an optional parameter
defaulting to none; the parity harness passes three arguments and exercises the
untouched port. Belt and braces: a profile weight of `0` disables the family
outright, asserted in suite section 1.

**New:** `contextual-person-evidence-verification` — **77/77**.

**Zero regression across:** ambiguity-anchor 45/45 · bulk-decision-workflow
38/38 · decision-memory · decision-precedence · decision-reuse 117/117 ·
document-display 10/10 · document-reopen · document-scores · entity-registry
45/45 · focus-navigator 107/107 · full-value-alias 34/34 · group-bulk-actions
92/92 · group-check-revision 17/17 · identity-cleanup 20/20 ·
item-check-category-view 18/18 · item-check-work-queue 40/40 · live-confidence
13/13 · milestone-2 91/91 · milestone-3 70/70 · **normalization 66/66** ·
parsing-helpers 38/38 · preferred-actions 14/14 · review-engine 43/43 ·
review-scope 24/24 · scoring-smoke · section-action-digits 47/47 ·
semantic-relationship 30/30 · semantic-types 15/15 · sequence-ratio 9/9 ·
structural-relationship 32/32 · triage-queue 63/63 · visible-list-advance 25/25
· workflow-navigation 64/64 · workspace-analysis 37/37 ·
workspace-integration 63/63 · workspace-metrics 14/14.

**Two ui-smoke assertions updated, intent preserved** (now 133/133 on the
checks this work touches): the polarity check pinned the literal call string
`scoreCandidateQuality(candidate, occurrences, blocksById, profile.weights, reviewThreshold)`
and broke on reformatting — it now asserts the same thing as a pattern, more
directly. The chip-label collision check hard-coded 55 labels; it is 56, and
the count is meant to be updated deliberately like this when a rule is added.

---

## ⚠️ One failure left standing, deliberately — needs your call

`audit-exporter-verification` — **62/63**:

```
FAIL raw candidate text "Andrew Goodloe" does not appear in any artifact
```

**This is not a new leak, and I did not weaken the check.** `entityGroups[].canonicalName`
has always carried a raw detected name into the audit artifact. With the family
disabled the same fixture emits:

```
[["person:jackson:a", "Andrew Jackson", "Refined"]]
```

— also raw candidate text, but "Andrew Jackson" is not one of the four strings
the check happens to watch for. My change shifted which group the fixture's
Refined-group scenario lands on, from `person:jackson` to `person:goodloe`, and
"Andrew Goodloe" *is* on the list. **The check was passing by coincidence.**

So there is a real, pre-existing conflict between two things the exporter is
doing: the artifact deliberately excludes raw text everywhere (it does not even
carry the ±70-char context snippets the Python oracle's CSV leaks), and
`canonicalName` is raw text by design.

The question is yours, because it trades privacy against auditability:

- **Keep `canonicalName`** and scope the leak check to the fields that are
  genuinely meant to be text-free, documenting canonicalName as a disclosed
  exception. An audit record naming no entity is harder to audit.
- **Drop or hash `canonicalName`**, keeping `groupId` (already
  `person:goodloe:a` — lowercased, but still derived from the name).
- **Keep it, gated** on an export option, the way a reviewer-facing vs.
  release-facing artifact would differ anyway.

I have not touched the exporter or the assertion. Fixing this by editing either
one is the move that hides the finding.

---

## Also observed, not acted on

**Concurrent editing.** Four suites passed in the first full battery and failed
in the second, all on prose assertions in work I never touched —
`confidenceOpener` bands rewritten from "We believe this is a person's name" to
"Almost certainly a person's name" (`explanation-builder.ts`, modified
mid-session), plus `decision-reduction` and `recommendations` wording. Left
alone as your in-flight work: explanation-engine 50/61, decision-reduction
150/152, recommendations 43/45, ui-smoke's confidence-band check.

**Not covered here (browser-only):** how the single chip plus representative
example reads in the focus panel, and whether "Used as a person" is the right
words on screen. `npm run build` has not been run — `dist/` is stale relative to
these changes, so nothing has been validated live.
