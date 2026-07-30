# Phase 6 findings — EntityResolutionEngine port

Reference: `docs/architecture/DocScrub-Web_Target_Architecture_v0.2.docx` §6.6
(EntityResolutionEngine) and Andrew's "Phase 6 (EntityResolutionEngine)"
instruction (2026-07-28). Continues from Phase 5
(`docs/detection/phase-5-findings.md`), which closed the quality-scoring
slice of Gate B.

## What the Python oracle actually is

`redactor/entity_resolution.py` (229 lines) is a small, self-contained
module with three public functions: `build_entity_groups()` (proposes
which candidates represent the same person), `build_ambiguous_matches()`
(flags short person references that could plausibly belong to more than
one proposed group), and `calculate_entity_confidence()` (recomputes a
group's confidence for a possibly reviewer-adjusted subset of its
members). It operates entirely on `Candidate` objects already produced by
detection and scored by quality -- it does not detect or score anything
itself.

A critical scoping finding, confirmed by reading `detectors.py` and
`entity_resolution.py` side by side rather than assuming: **most of the
"variant matching" surface Andrew's instruction listed is not actually
entity-resolution's job in this pipeline.** `detectors.py`'s own
`normalize_candidate()` already comma-swaps `"Smith, Jane"` to
`"Jane Smith"` *before* generating a candidate key -- so "Last, First vs.
First Last" is resolved at the detection layer, and entity-resolution
never sees two separate candidates for it. Similarly, exact duplicates
(same text, different casing/whitespace) are already one candidate by
construction. What's actually left for entity-resolution to do is
narrower than the instruction's scenario list implied: group a short,
single-token person reference (e.g. a bare "Maria") into the one full-name
bucket it plausibly belongs to, or flag it as ambiguous if more than one
bucket could claim it.

## What was ported

- `src/engines/entity-resolution/sequence-ratio.ts` -- a from-scratch port
  of CPython's `difflib.SequenceMatcher(None, a, b).ratio()` (Ratcliff/
  Obershelp string similarity). No JS equivalent exists, and confidence
  scores need exact parity, not "similarly shaped" output from a different
  metric (Levenshtein, Jaro-Winkler, etc. do not produce the same ratios).
  Verified byte-exact against live Python for 9 hand-picked string pairs
  (`verify/sequence-ratio-smoke.ts`) before it was ever wired into scoring.
- `src/engines/entity-resolution/resolution.ts` -- a faithful, line-cited
  port of `build_entity_groups()`, `build_ambiguous_matches()`,
  `calculate_entity_confidence()`, and every helper (`_tokens`,
  `_clean_token`, `_display_name`, `_person_group_key`, `_group_key`,
  `_person_tokens`, `_is_short_person_reference`, `_excluded_keys`,
  `_member_score`). See that file's own top doc comment for the full list
  of shape differences from Python and how each is bridged.
- `src/engines/EntityResolutionEngine.ts` -- `RegexEntityResolutionEngine`,
  the adapter implementing the (interface-fixed, see below)
  `EntityResolutionEngine`. Exposes both `propose()` (mirrors
  `build_entity_groups`/`build_ambiguous_matches`) and
  `recalculateConfidence()` (mirrors `calculate_entity_confidence`).
- `src/domain/DocumentModel.ts` / `src/domain/Evidence.ts` -- unchanged;
  no new fields were needed there this pass (Candidate/QualityResult
  already carried everything entity-resolution needs).

## Domain parity, measured

`verify/entity-resolution-parity.ts` runs the real
`RegexEntityResolutionEngine` (fed by the real `RegexDetectionEngine` and
`RegexCandidateQualityEngine`, exactly matching the production pipeline
order) against all 13 fixtures and diffs group membership, group ordering,
canonical name, detected type, group confidence, per-member confidence,
ordered reasons, and ambiguity proposals (candidate, ordered possible
groups with each option's own canonical name and confidence) against
Python's `expected/entity-groups.json` + `expected/ambiguity-proposals.json`.

**Result: 13/13 fixtures match exactly.** 11 of the 12 pre-existing
fixtures have zero entity groups or ambiguity proposals (their candidates
never happen to share a grouping key) and matched trivially; `run-split-
name-001` has one real 2-member group ("Participant Priya Natarajan" +
"Priya Natarajan", grouped via a field-code/plain-text variant) that
matched exactly including confidence and reasons.

## New fixture: `entity-resolution-001`

Built specifically for this phase (`scripts/build_entity_resolution_
fixtures.py`) since no existing fixture exercised real multi-candidate
grouping or ambiguity. Constructed candidate-by-candidate, then run
through the *actual* Python oracle to confirm behavior rather than
hand-predicting it (Andrew's explicit "oracle-first" instruction) --
several assumptions were revised after seeing the real output (documented
below). Confirmed via the real pipeline, not asserted:

1. **Variant grouping via first-name bucket**: "Maria Alvarez" (a single
   merged candidate -- see finding 6 below) plus a repeated bare "Maria"
   short reference group into one entity (confidence 46 -- the bare
   reference's low structural/quality signal pulls the group's min-based
   confidence down from the full name's own 90).
2. **Ambiguity between two same-first-name people**: "Andrew Goodloe" and
   "Andrew Jackson" each needed a second same-initial variant ("Andy
   Goodloe" / "Andy Jackson") to become real 2-member groups in the first
   place -- a bare "Andrew" then becomes AMBIGUOUS between both
   (confidences 86 and 91). Modeled directly on
   `tests/test_entity_resolution.py`'s own ambiguity test shape.
3. **Must-not-merge**: "Carlos Mendez" / "Elena Mendez" share a surname but
   different first initials and never appear in the same group --
   confirmed the group key is last-name **+ first-initial**, not surname
   alone.
4. **Singleton**: "Priya Natarajan" appears once, forms no group, and
   raises no ambiguity proposal.
5. **A confirmed Python quirk, documented rather than silently
   normalized**: "Dr Susan Whitmore" (title with no trailing period, so
   `detectors.py`'s `FALLBACK_PERSON_RE` sweeps the title into the
   detected candidate text as a genuine third token) does **not** merge
   with plain "Susan Whitmore" elsewhere in the same document, because
   `_person_group_key()` uses the candidate's *first* token as the group's
   initial -- `"dr"` for the titled form, `"susan"` for the plain form,
   producing different group keys (`person:whitmore:d` vs.
   `person:whitmore:s`) even though a human reviewer would recognize both
   as the same person. This is a real, product-relevant characteristic of
   the oracle, ported faithfully rather than "fixed" during migration --
   see "Documented deviations," below, for why this is flagged rather than
   silently worked around.
6. **Confirms detection, not entity-resolution, owns Last/First
   normalization**: "Alvarez, Maria" (comma form) and "Maria Alvarez"
   (plain form) are pre-merged into one candidate by
   `detectors.py`'s `normalize_candidate()` before entity-resolution ever
   runs -- exactly the scoping finding above, demonstrated concretely
   rather than just asserted.

`scripts/export_fixtures.py`'s `entity_groups_json`/`ambiguous_json`
construction was also expanded this pass -- the pre-existing version only
captured `id`/`canonicalName`/`memberKeys`, omitting `detectedType`,
`confidence`, `memberConfidences`, and `reasons` entirely, which would have
made real parity verification (confidence values, ordered evidence) on
this and every future entity-resolution fixture impossible. All 12
pre-existing fixtures were regenerated to pick up the expanded fields;
verified `candidates.json`/`occurrences.json` are byte-identical to before
the regeneration (only `entity-groups.json`/`ambiguity-proposals.json`
gained fields), so no detection or quality-scoring behavior was disturbed.

## Interface defect fixed

`EntityResolutionEngine.propose()` originally took only a `QualityResult`.
`QualityResult` (`src/domain/Evidence.ts`) carries scores/evidence/
assessments keyed by candidate ID, but not the underlying `Candidate` data
(`displayValue`, `detectedType`, `confidence`, `occurrenceIds`) that
grouping fundamentally operates on -- Python's `build_entity_groups` takes
`candidates: list[Candidate]` directly. This is the same category of
objective interface defect Phase 3 found twice (`DocumentRebuilder`/
`OutputVerifier` missing a `DetectionResult` parameter) and Phase 5 found
once (`CandidateQualityEngine.evaluate()` missing a `DocumentModel`
parameter): the interface as specified could not be implemented at all,
not a matter of taste. Fixed by adding a `detection: DetectionResult`
parameter, following the same parameter-ordering convention already
established by the prior two fixes.

## Additive schema changes

`EntityGroupProposal` gained `canonicalName`, `detectedType`,
`memberConfidences`, and `reasons`. `AmbiguityProposal` gained
`candidateGroupOptions` (canonical name + confidence per option, not just
bare group IDs -- a reviewer cannot meaningfully choose between bare IDs
alone). All existing fields on both types are unchanged; nothing that
depended on the pre-Phase-6 shape breaks. `EntityResolutionEngine` also
gained a second method, `recalculateConfidence()`, mirroring Python's
`calculate_entity_confidence()` -- classified as an additive domain
requirement (Python's public API includes this function; the original
TS interface simply hadn't been extended to it yet), not an architectural
change.

## Documented deviations

1. **`casefold()` vs `toLowerCase()`.** Same deviation as Phases 4/5;
   `_clean_token()` and the SequenceMatcher inputs both fold case via
   Python's `casefold()`. ASCII-range verified, zero observed impact.
2. **`entity_resolution.py`'s own `_tokens()` does not NFKC-normalize**,
   unlike `candidate_quality.py`'s `_tokens()` (which does) -- confirmed by
   reading both functions side by side. A genuine, minor asymmetry between
   the two Python modules, ported faithfully rather than harmonized away.
3. **Python's built-in `round()` uses round-half-to-even; JS's
   `Math.round()` always rounds .5 up.** `calculate_entity_confidence()` is
   the one call site that uses Python's `round()`, and its input (a
   weighted average of integer member scores) can land exactly on a .5
   tie. A dedicated `pythonRound()` helper was written rather than risking
   a silent off-by-one.
4. **Two of Python's exclusion filters in `build_entity_groups` are
   provably redundant.** `removed_keys` (built from `_excluded_keys()`,
   the union of every value across the whole `exclusions` dict) already
   filters candidates before they ever reach a bucket; a second, later
   per-key filter (`included = [c for c in members if c.key not in
   exclusions.get(key, [])]`) can therefore never actually remove
   anything, since anything it would remove was already excluded by the
   first filter. Confirmed by tracing `_excluded_keys()`'s definition.
   This port applies the removal once rather than mechanically
   reproducing dead code -- behaviorally identical, not a deviation in
   outcome, only in code shape.
5. **The title-prefix / group-key quirk (finding 5 above) is ported
   faithfully, not corrected.** A title token swept into a detected
   candidate's text can silently prevent that candidate from merging with
   an untitled mention of the same person, because the group key is
   keyed off whichever token happens to be *first*, not off a
   title-stripped name. This is a genuine product-relevant limitation of
   the current oracle (and therefore of this port, by design) worth
   surfacing to Andrew as a possible future product-improvement candidate
   for the TS side -- but not something to silently "fix" while parity is
   still being established, per Andrew's explicit instruction.
6. **`INITIAL_SURNAME_RE`/`SURNAME_INITIALS_RE`-shaped candidates (e.g.
   "J. Smith") are effectively unreachable under the deterministic
   pipeline.** Confirmed while designing this phase's fixture:
   `detectors.py`'s `FALLBACK_PERSON_RE` requires `[A-Z][a-z]{1,30}` per
   token (a capital letter followed by *at least one* lowercase letter),
   so a bare initial like `"J"` can never match as a name token in the
   first place, and `LAST_FIRST_PERSON_RE` has the same requirement on
   both sides of the comma. This means `candidate_quality.py`'s own
   `INITIAL_SURNAME_RE`/`SURNAME_INITIALS_RE` structural-scoring paths
   (already ported faithfully in Phase 5) are similarly unreachable under
   `use_spacy=False` -- not a Phase 6 bug, a retroactive confirmation that
   Phase 5's port of those regexes, while faithful, scores a shape the
   regex-only detector never actually produces. Noted for completeness,
   not treated as something to change.

## Effect on Gate B (Domain Parity)

As of this pass: **detection, quality scoring, AND entity resolution are
all at full parity** across every fixture that exercises them (13/13 for
entity resolution, 12/12 for quality, 12/12 candidate/occurrence parity
for detection minus the one already-approved content-control deviation).
Gate B is not yet fully closed -- `OccurrenceClassifier` (structural
display grouping, explicitly NOT this phase's job per Andrew's
architectural-boundary instruction) and explanation generation remain
signature-only interfaces. This pass closes the entity-resolution slice of
Gate B completely. Recommended next implementation target:
`OccurrenceClassifier`.
