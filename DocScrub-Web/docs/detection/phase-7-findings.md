# Phase 7 findings: OccurrenceClassifier

Full port record for the OccurrenceClassifier slice (Gate B, final component).
Companion to phase-4-findings.md (DetectionEngine), phase-5-findings.md
(CandidateQualityEngine), and phase-6-findings.md (EntityResolutionEngine).

## What Python's oracle actually is

`redactor/occurrence_groups.py` (121 lines) is deliberately narrow: it
implements exactly ONE semantic rule -- `occurrence_group_kind()` classifies
each occurrence as `"standalone"` or `"contextual"` depending on whether
"substantive" (non-artifact, alphanumeric-bearing) text remains in the
occurrence's context snippet once the matched span itself is stripped out.
`group_occurrences()` buckets occurrences by that rule, in input order, into
however many of `GROUP_ORDER = ("standalone", "contextual")` are non-empty.

`OccurrenceGroupKind` is declared as an 8-value `Literal`
(`standalone`/`contextual`/`quoted`/`header`/`footer`/`table`/`ocr`/`other`)
and `GROUP_LABELS` maps all 8 to display strings, but `GROUP_ORDER` -- the
only tuple `group_occurrences()` actually iterates -- and
`occurrence_group_kind()` -- the only function that ever assigns a kind --
together only ever produce `"standalone"` or `"contextual"`. Confirmed by
reading the full source: the other 6 kinds are aspirational vocabulary with
no implemented rule anywhere in `work/pii_docx_redactor`. Ported faithfully:
the TS type still declares all 8 values (so a future rule addition on either
side doesn't force a schema change), but `occurrenceGroupKind()` only ever
returns the same two values Python does.

## What was ported (parity-critical core)

`src/engines/occurrence-classifier/classification.ts` -- a line-cited port
of `occurrence_group_kind()`, `group_occurrences()`, and every helper they
depend on (`_normalize_text`, `_strip_match_from_context`,
`_has_substantive_surrounding_text`), plus the `GROUP_ORDER`/`GROUP_LABELS`/
`SUBSTANTIVE_RE`/`BRACKETED_RE`/`ARTIFACT_TOKEN_RE`/`EDGE_PUNCTUATION_RE`
constants.

Two quirks confirmed by reading the Python source directly (not inferred)
and preserved exactly:

- `ARTIFACT_TOKEN_RE`'s `\\n`/`\\r`/`\\t` alternatives match a literal
  backslash followed by the letter n/r/t (a copy-paste artifact resembling
  the two-character sequence `\n`), NOT an actual newline/CR/tab control
  character -- because the Python source is a raw string
  (`r"...\\n..."`), whose backslash-backslash becomes a regex-escaped
  literal backslash. Confirmed via direct source reading, not guessed.
- `_has_substantive_surrounding_text` checks `SUBSTANTIVE_RE` against the
  RAW token but checks `ARTIFACT_TOKEN_RE` against the token with edge
  punctuation stripped -- an asymmetry that is exactly what Python's source
  does, not a simplification introduced during porting.
- `_normalize_text` replaces a literal U+00A0 (non-breaking space) with a
  plain space, distinct from its own subsequent `\s+` collapse -- confirmed
  by byte inspection (`od -c`), not assumed from visual rendering.

### Verification against live Python (before being trusted further)

Following the same discipline applied to `sequence-ratio.ts` in Phase 6:
`occurrenceGroupKind()` was cross-checked against a live
`redactor.occurrence_groups.occurrence_group_kind()` invocation for:

- all 13 real occurrences in the `synthetic-transcript-001` fixture
  (13/13 exact match, including the natural standalone/contextual split
  within the same `person:robert lee` candidate's two occurrences), and
- 12 hand-picked synthetic edge cases specifically targeting the
  artifact-token asymmetry (`L`/`R`/`br`/`lr` single-letter artifacts,
  punctuation-only remainders, digit tokens, real-NBSP vs. plain-space
  variants, the bracket-strip vs. text-strip fallback path).

22/22 exact match. No behavioral difference found; no deviation to record
for this function.

## What was built additively (no Python equivalent)

Andrew's Phase 7 instruction explicitly asks for occurrences classified
"using: document block, occurrence order, surrounding context, content
type, source reference, entity group, confidence, quality assessment" --
none of which `occurrence_groups.py`'s own (intentionally narrow) output
carries. This is new, reviewer-facing infrastructure built on top of the
parity-critical core, not a reproduction of anything in Python:

- **`StructuredContext`** (`{before, match, after}`) -- computed directly
  from the owning `ContentBlock.text` at the occurrence's own offsets, with
  the same window=70 Python's own `context_snippet()`/`contextSnippet()`
  uses, rather than string-parsing the already-bracketed rendered context.
  Verified byte-identical to the occurrence's own `text` for `match`, and
  reconstructs the same substring Python's own rendered context shows.
- **`ReviewOccurrence`** -- one record per occurrence, cross-referencing
  `DetectionResult` (detectedType, detectorConfidence), `QualityResult`
  (quality label, numeric score), `GroupingResult` (entityGroupId, when the
  occurrence's candidate is a group member), and `DocumentModel`
  (blockKind, sourceRef) onto the occurrence -- plus an explicit `order`
  field (see "Ordering" below). Every field is EXPOSED from an
  already-computed source, never invented.
- **`OccurrenceClassificationResult`** (`{schemaVersion, groups,
  reviewOccurrences}`) -- `groups` is the Python-parity bucketing (now
  populated with `ReviewOccurrence[]` instead of plain `Occurrence[]`);
  `reviewOccurrences` is the full enriched, explicitly-ordered list.

### Ordering: made explicit where Python leaves it incidental

Reading `group_occurrences()` directly confirms Python never sorts --
bucket-internal order is simply whichever order occurrences happened to
arrive in during detection, not a tested contract anywhere in the Python
test suite. Andrew's instruction explicitly asks for ordering that is
"stable regardless of JavaScript iteration order, Map insertion order,
parser traversal differences, future optimization work," and to document
explicitly any ordering rule that's implicit in Python.

Since Python has no real ordering guarantee to preserve, this port
introduces one: `reviewOccurrences` is sorted by `(ContentBlock.order,
Occurrence.startOffset)` -- natural document reading order. This is not a
cosmetic no-op: confirmed directly by dumping both orderings for
`synthetic-transcript-001`, `DetectionResult.occurrences`' raw order groups
ALL regex-type candidates (email/cin/phone/long_numeric_id, from
`detectRegexCandidates`) before ANY person candidates (from
`detectPeople`, which runs second in `detectAllCandidatesWorking`) --
meaning the raw order is not document order at all. The explicit sort
turns that into true top-to-bottom reading order. `groups[].occurrences`
inherit this same order (each bucket is populated by filtering the already-
sorted `reviewOccurrences`, not re-bucketing in original detection order).

This is a documented, deliberate additive design decision, not a deviation
from a real Python requirement -- Python's own order was never a
requirement to begin with.

## Interface defect fix (6th instance of the established pattern)

`OccurrenceClassifier.classify()` originally took only `Occurrence[]` --
structurally unable to reach `ContentBlock` text/kind (for structured
context and navigation metadata) or `Candidate`/`QualityResult`/
`GroupingResult` (for confidence/quality/entity-group cross-referencing).
Same category of objective interface defect found in every prior phase
(Phase 3 x2, Phase 5, Phase 6). Fixed by taking `document`, `detection`,
`quality`, and `grouping` directly, following the same "document/detection
first" parameter-ordering convention already established.

## Additive schema changes

- `OccurrenceGroup.occurrences` upgraded from `Occurrence[]` to
  `ReviewOccurrence[]` -- classified as an additive domain requirement, not
  a breaking change, since nothing yet consumes the old shape (ReviewEngine
  doesn't exist yet). The low-level, parity-critical `classification.ts`
  keeps its own separate `OccurrenceBucket<T>` type operating on plain
  `Occurrence[]`, specifically so it stays directly comparable against
  Python's own `occurrence_groups.json` without being coupled to the
  enrichment layer's shape.
- `StructuredContext`, `ReviewOccurrence`, `OccurrenceClassificationResult`
  -- new types, described above.

## Fixture-driven verification

`verify/occurrence-classification-parity.ts` runs the real
`RegexOccurrenceClassifier` against all 13 domain-parity fixtures and
checks: group-level ordering/kind/label, group membership (by normalized
`candidateId@start-end` identity rather than raw ID strings -- see "ID
format" deviation below), context-extraction fidelity (`context.match`
byte-identical to occurrence text; reconstructed `before+match+after`
matches Python's own rendered context once its bracket/ellipsis formatting
is stripped), navigation metadata (blockId/blockKind/sourceRef against the
owning `ContentBlock`), explicit deterministic ordering (`order` field
matches array index; `(blockOrder, startOffset)` non-decreasing across the
array), determinism (`classify()` re-run on identical inputs produces
byte-identical JSON), and entity-group cross-reference correctness.

**13/13 fixtures pass.** Mismatches attributable to already-approved,
pre-existing Phase 3/4 detection-scope extras (hyperlink-target, comment,
and tracked-deletion block coverage; the content-control-001 deviation) are
reported separately as approved extras, using the exact same convention
`detection-parity.ts` already established -- not new Phase 7 findings.

### ID-format deviation (inherited, not introduced this phase)

TS occurrence IDs use `block.id` (e.g. `block-7`) where Python's use a
human-readable location string (e.g. `body table 1 table r2c1 paragraph
1`) as the ID's middle segment -- an already-documented Phase 4 deviation
(see `DetectionEngine.ts`'s `flatten()`). This phase's parity harness
compares by normalized `(candidateId, start, end)` identity rather than raw
ID string equality specifically to avoid re-flagging this as a new Phase 7
problem.

## Fixture corpus assessment (no new fixture needed)

Andrew's Phase 7 instruction asks for coverage of: multiple occurrences of
one entity, overlapping entities, adjacent entities, entities spanning
multiple content blocks, repeated names, comment/content-control
occurrences, tracked-change occurrences, and mixed content ordering.
Reviewed the existing 13-fixture corpus directly rather than assuming a new
fixture was needed:

- **Multiple occurrences of one entity / repeated names**: `person:jane
  smith` (4 occurrences across 4 different blocks) and `person:robert lee`
  (2 occurrences, one standalone in a table cell, one contextual in body
  prose) in `synthetic-transcript-001`.
- **Overlapping entities**: `phone:5559876543` and
  `long_numeric_id:5559876543` in `synthetic-transcript-001` occupy the
  identical character span (`block-8:12-24`) as two different candidate
  types -- confirmed both classify and order correctly with a stable
  tie-break, a real case, not a hypothetical.
- **Adjacent entities**: `person:synthetic teams` (offset 0) and
  `person:email transcript` (offset 20) sit back-to-back in the same
  paragraph in `synthetic-transcript-001`.
- **Entities spanning multiple content blocks**: covered by the repeated-
  name cases above (a single candidate's occurrences legitimately spanning
  many blocks). A single OCCURRENCE spanning multiple blocks is not
  representable in this domain model at all -- `Occurrence.startOffset`/
  `endOffset` are block-local by construction -- so this is not an
  applicable gap.
- **Comment / content-control / tracked-change occurrences**:
  `comments-001`, `content-control-001`, `tracked-changes-001` fixtures
  already exist and are exercised by the parity harness.
- **Mixed content ordering**: confirmed directly (see "Ordering" above)
  that `DetectionResult.occurrences`' raw order is NOT document order for
  every fixture with both regex-type and person candidates -- i.e. this
  scenario is exercised by essentially the entire corpus, not a special
  case needing a dedicated fixture.

No new fixture was built this phase; the existing corpus already exercises
every requested scenario, verified above rather than assumed.

## Newly discovered risk, found and fixed this pass

`scripts/export_fixtures.py`'s `build_case()` unconditionally rewrites
`manifest.json` on every run, and its manifest dict has never included a
`deviations` key -- silently destroying any hand-curated, approved-
deviation record the next time a fixture is regenerated. This is exactly
how `content-control-001`'s "Desmond Okonkwo" deviation -- described as
already-recorded in `phase-4-findings.md` -- ended up missing from that
fixture's actual `manifest.json`, causing `verify/detection-parity.ts` to
report a false FAIL (11/12, not the 12/12 previously reported) when re-run
at the start of this phase per Andrew's "re-run all prior verification
suites" instruction.

Fixed two ways: (1) restored the missing `deviations` entry to
`content-control-001/manifest.json`; (2) patched `export_fixtures.py` to
read and preserve any existing `deviations` array before overwriting
`manifest.json`, so future fixture regeneration (this script's `build_case`
is also reused by `build_structural_fixtures.py`) cannot silently repeat
this loss. `detection-parity.ts` now passes 12/12 again.

## Verification suites re-run this pass

- `verify/production-parity.ts`: 14/14
- `verify/detection-parity.ts`: 12/12 (after the manifest fix above)
- `verify/quality-parity.ts`: 12/12
- `verify/entity-resolution-parity.ts`: 13/13
- `verify/sequence-ratio-smoke.ts`: 9/9
- `verify/scoring-smoke.ts`: 12/12
- `verify/occurrence-classification-parity.ts` (new): 13/13
- `tsc --noEmit`: zero errors across all of `src/`

## Gate B status

With OccurrenceClassifier complete and verified, all four Gate B
components (DetectionEngine, CandidateQualityEngine,
EntityResolutionEngine, OccurrenceClassifier) are real, fixture-verified
production code. **Gate B (Domain Parity) is closed.**

## Recommended next target

Gate C (Review Interaction Parity): `ReviewEngine` (including Not Quite)
and `FocusNavigator`, against the not-yet-populated Interaction Fixtures
(`fixtures/interaction/`). This is the first component that introduces
durable review STATE (Keep/Rename/Redact/Ignore decisions, Group Check
confirmation) rather than pure derived/proposal data -- a different risk
profile than anything ported so far.
