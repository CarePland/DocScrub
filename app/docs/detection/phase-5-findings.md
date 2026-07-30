# Phase 5 findings — CandidateQualityEngine port

Reference: `docs/architecture/DocScrub-Web_Target_Architecture_v0.2.docx` §6.4
(CandidateQualityEngine) and Andrew's "Phase 5 (CandidateQualityEngine)"
instruction (2026-07-27). Continues from Phase 4
(`docs/detection/phase-4-findings.md`), which closed the detection slice of
Gate B.

## What the Python oracle actually is

`redactor/candidate_quality.py` (1017 lines) is a separate post-detection
scoring pass, confirmed by reading `scripts/export_fixtures.py` directly:
detection runs first (`detect_all_candidates`), then
`apply_candidate_quality(candidates)` mutates each `Candidate` in place with
nine additional fields (`quality`, `quality_status`, `candidate_score`,
`quality_reasons`, `quality_explanation`, `suggested_type`,
`quality_evidence_breakdown`, `quality_positive_reasons`,
`quality_filter_rules`). It depends on three merged lexicon sources:
`DEFAULT_QUALITY_DICTIONARIES` (a small hardcoded set, ~16 rules),
`config/candidate-quality/*.txt` + `config/lexical_evidence/*.txt` (tens of
thousands of real terms across the two directories), and an optional
repo-root `candidate_quality_terms.json` override.

## What was ported

- `src/engines/quality/quality-dictionaries.data.ts` — the merged, already-
  computed `QUALITY_DICTIONARIES` (and `EVIDENCE_WEIGHTS`,
  `STATUS_THRESHOLDS`, `KNOWN_GIVEN_NAMES`, `KNOWN_SURNAMES`, and three
  smaller rule-name sets) extracted by importing the *live* Python module
  and dumping its runtime values, not by re-implementing its file-loading/
  merge logic in TypeScript — see "The lexicon-loading bug" below for why
  this mattered more than expected. Regenerate via
  `scripts/generate_quality_dictionaries.py` (see that script's own header
  for the exact invocation). `QUALITY_DICTIONARIES_DATA`'s key order is
  Python's real dict insertion order, not alphabetically sorted — an
  earlier draft of the generation script sorted keys "for determinism"
  without checking whether Python's order already was alphabetical (it
  isn't: `pronoun_or_determiner` comes first, not `abbreviation`), which
  would have silently produced reason-order mismatches despite identical
  scores. Caught before it reached the port itself.
- `src/engines/quality/scoring.ts` — a faithful, line-cited port of
  `score_candidate_quality()` and every helper it calls (`_tokens`,
  `_normalized_text`, `_normalized_token_set`, `_is_heading_like`,
  `_appears_in_email`, `_near_title`, `_signature_evidence`,
  `_positive_evidence`, `_dictionary_rules`, `_is_likely_acronym`,
  `_shape_rules`, `_single_token_classifications`, `_quality_evidence`,
  `_score_from_evidence`, `_status_from_score`, `_quality_from_score`,
  `_scored_result`, `_filter_result`). See that file's own top doc comment
  for the full list of shape differences from Python and how each is
  bridged (nested vs. flat occurrences, no per-occurrence location string,
  `candidate.text` = TS's `displayValue`, profile-driven weights instead of
  hardcoded constants).
- `src/engines/CandidateQualityEngine.ts` — `RegexCandidateQualityEngine`,
  the adapter that groups `DetectionResult.occurrences` by candidate,
  builds the `blockId -> ContentBlock` lookup `scoring.ts` needs, calls
  `scoreCandidateQuality()` once per candidate, and translates the result
  into this domain's `QualityResult` shape. Also exports
  `buildDefaultScoringProfileSnapshot()`, which populates a
  `ScoringProfileSnapshot` (ADR-015) from the ported Python constants.
- `src/domain/Evidence.ts` — additive v2 extension: `QualityLabel`,
  `CandidateQualityAssessment`, and `QualityResult.assessmentByCandidate`.
  The original three `Record`s (`evidenceByCandidate`/`scoreByCandidate`/
  `recommendationByCandidate`) are unchanged.

## The lexicon-loading bug (the significant finding this pass)

While cross-checking `scoring.ts` against `synthetic-transcript-001`'s
fixture, two candidates disagreed: `person:email transcript` (fixture:
Possible/66; TS: Unlikely/1) and `person:robert lee` (fixture: Possible/74;
TS: Strong/99). Before assuming a TS bug, the fixture's exact
Candidate/Occurrence data was fed straight into the *live* Python
`score_candidate_quality()` — and live Python **also** disagreed with its
own fixture, agreeing with the TS port instead.

Root cause: `redactor/candidate_quality.py` resolves its lexicon
directories via `Path.cwd()` (`LEXICON_DIR`, `LEXICAL_EVIDENCE_DIR`,
`LOCAL_DICTIONARY_PATH` — lines 183-185), not relative to the package's own
file location. `scripts/export_fixtures.py` and
`scripts/build_structural_fixtures.py` are documented and normally invoked
as `cd DocScrub-Web && python3 scripts/export_fixtures.py` — meaning
`Path.cwd()` was `DocScrub-Web/`, which has no `config/` directory at all.
Every domain-parity fixture this repository has ever generated therefore
captured `candidate_quality` scoring under a **silently degraded** oracle
state: `QUALITY_DICTIONARIES` fell back to just the ~16 built-in
`DEFAULT_QUALITY_DICTIONARIES` entries (`common_english_word` ends up
completely empty, for example), never loading any of the tens of thousands
of real terms in `config/candidate-quality/*.txt` or
`config/lexical_evidence/*.txt`. Confirmed directly: importing
`candidate_quality` with cwd = `DocScrub-Web/` yields `len(QUALITY_DICTIONARIES) == 16`
and an empty `common_english_word`; importing it with cwd =
`work/pii_docx_redactor` (the correct context — matching `pytest.ini`'s
`pythonpath = .` and how the Flask apps are actually run in production)
yields the full merged set.

This is a bug in the **fixture-generation tooling's working-directory
assumption**, not in `candidate_quality.py`'s scoring logic itself, and not
in the TS port (which was built by running the lexicon-dump generator
script with the correct cwd from the start, so it was already faithful to
the *real* oracle). Fix applied: `scripts/export_fixtures.py` now
`os.chdir(PII_APP_ROOT)` immediately after adding it to `sys.path` and
before importing anything from `redactor` (the chdir must happen before
`candidate_quality`'s module-level `QUALITY_DICTIONARIES = load_quality_dictionaries()`
runs, since that's where the cwd read happens) — every other path in that
script was already absolute, so this is safe.
`scripts/build_structural_fixtures.py` imports `build_case` from
`export_fixtures`, so it inherits the fix automatically without its own
edit. Both scripts remain read-only with respect to `work/pii_docx_redactor`
(the chdir only changes which directory the process's own relative-path
resolution uses, exactly restoring the working directory
`candidate_quality.py`'s own lexicon-loading code assumes).

All 12 domain-parity fixtures were regenerated with the fix in place.
Verified before/after: candidate identity, `detectedType`, `source`,
`confidence`, and every occurrence's `text`/`start`/`end`/`occurrenceIds`
are byte-identical to the previous fixtures — only the four quality fields
(`quality`, `qualityStatus`, `candidateScore`, `qualityReasons`) changed,
and only for the 7 candidates whose text happened to overlap with lexicon
entries invisible under the old, broken cwd (`transcript`→
`common_english_word`, `lee`/`grace`→`ambiguous_lexical_token`, `run`/
`field`→`address_suffix`, `table`→`document_structure_term`, `box`→
`product_system_name`). Source `.docx` file SHA-256 hashes changed across
the regeneration (expected: python-docx does not produce byte-identical
ZIPs across separate save() calls even from identical content —
established as harmless non-determinism, not a structural change).

## Domain parity, measured

`verify/quality-parity.ts` runs the real `RegexCandidateQualityEngine`
against all 12 fixtures (via the real `RegexDetectionEngine`'s output, per
Phase 4) and diffs `quality`, `qualityStatus` (mapped to TS's
`Recommendation` vocabulary), `candidateScore`, and the full ordered
`qualityReasons` list against Python's own `expected/candidates.json`.

**Result: 12/12 fixtures match exactly** — every candidate Python itself
detected and scored agrees on quality label, status, numeric score, and the
complete ordered reasons list (not just the final label). Three fixtures
have one candidate each with no expected quality data to compare against
(`comments-001`, `tracked-changes-001`, `content-control-001`'s comment/
tracked-deletion/content-control extras, already established as approved
detection-layer extras in Phase 3/4 — Python never scored them because it
never detected them).

`verify/scoring-smoke.ts` additionally cross-checks `scoring.ts` directly
(bypassing the fixture/detection layers) against six hand-picked cases,
each with expected values captured by running live Python
`score_candidate_quality()` on an equivalent `Candidate`/`Occurrence` --
covering the `LAST_FIRST_RE`, `TWO_NAME_RE` (+ known-given-name-token and
heading-context sub-paths), frequency-does-not-dominate, single-token, and
non-person paths. 12/12 assertions pass.

## Documented deviations

1. **`casefold()` vs `toLowerCase()`** — same deviation already recorded in
   Phase 4, applies again here since `normalizeLexiconEntry()` uses the
   same substitution. ASCII-range verified, zero observed impact.
2. **Heading-context substitute.** Python's `_is_heading_like()` checks
   `"header" in occurrence.location` (a human-readable string TS doesn't
   have — see Phase 4's documented deviation #2). `scoring.ts`'s
   `isHeadingLike()` instead looks up the occurrence's owning
   `ContentBlock.kind === "header"` via a `blocksById` map. Structurally
   different input, behaviorally equivalent output for every case that
   matters.
3. **The "readme" pseudo-lexicon bug, ported faithfully.**
   `config/lexical_evidence/README.txt`'s file stem is `"README"`
   (uppercase); Python's exclusion check
   `if name in {"readme", "lexicon_manifest"}` is case-sensitive and never
   matches it, so the README's own prose gets loaded as a spurious
   45-term lexicon under rule name `"readme"`. Zero scoring impact (absent
   from both `EVIDENCE_WEIGHTS` and `NEGATIVE_FILTER_RULES`, so it can only
   ever appear as an inert extra classification, never change a score or a
   filter decision) — ported faithfully into
   `quality-dictionaries.data.ts` per "port faithfully, document
   deviations, do not silently fix." Recommended to fix in Python upstream
   (lowercase the exclusion-set comparison), but out of scope for this
   migration to change the oracle.
4. **`CandidateQualityEngine.evaluate()` signature extended with a
   `document: DocumentModel` parameter.** Same category of objective
   interface defect Phase 3 found and fixed twice already
   (`DocumentRebuilder`/`OutputVerifier` both originally lacked a
   `DetectionResult` parameter they structurally needed). Here, the
   original two-parameter signature `(input, profile)` could not actually
   implement Python's heading-context behavior at all, since
   `DetectionResult` carries only `blockId` strings, not block kinds.
   Fixed by adding `document` as the first parameter, following the same
   parameter-ordering convention already established by
   `DocumentRebuilder.rebuild(document, detection, session)` and
   `OutputVerifier.verify(original, detection, session, rebuilt)`.
5. **`QualityResult` extended additively, not replaced.** Python's
   per-candidate output has fields (`quality` as a distinct axis from
   `status`, `explanation`, `suggested_type`, ordered `positive_reasons`/
   `filter_rules`) the original three `Record`s couldn't represent. Added
   one new field, `assessmentByCandidate: Record<string,
   CandidateQualityAssessment>` — the original three remain the primary
   contract for any consumer that only needs score/recommendation/raw
   evidence.
6. **Evidence.source is uniformly `"candidate-quality-engine"`.** Python's
   per-rule contribution doesn't track which specific lexicon *file*
   produced a dictionary-based classification once merged into
   `QUALITY_DICTIONARIES` (multiple `.txt` files can feed the same rule
   name) — `scoring.ts`'s `EvidenceContribution` only carries `{rule,
   label, weight}`, matching Python's own `evidence_breakdown` shape
   exactly. Finer per-rule lexicon-file provenance is a possible future
   enhancement (would require carrying lexicon-file identity through
   `quality-dictionaries.data.ts`), not a Phase 5 blocker — flagged, not
   silently glossed over.
7. **Weights/thresholds are profile-driven, never hardcoded inline** (by
   design, not a limitation). `buildDefaultScoringProfileSnapshot()` builds
   the *default* `ScoringProfileSnapshot` from the ported Python constants
   (`DEFAULT_EVIDENCE_WEIGHTS`, `DEFAULT_REVIEW_THRESHOLD`); the real
   engine reads `profile.weights`/`profile.thresholds` at scoring time.
   Parity with Python is achieved via this default profile's content, and
   ADR-015's profile-pinning architecture is genuinely exercised rather
   than bypassed.
8. **Not ported: `_context_text()`.** Confirmed dead code in Python itself
   — defined at line 663, never called anywhere in `work/pii_docx_redactor`
   including its own test suite. Noted explicitly so the omission reads as
   a finding, not an oversight.
9. **Not ported: `is_filtered_candidate()` / `candidate_quality_metrics()`.**
   UI/reporting-layer aggregation helpers used by `app.py`/
   `local_web_app.py`'s dashboard, not by the scoring pipeline itself — out
   of `CandidateQualityEngine`'s architectural responsibility ("evaluates
   candidates," architecture v0.2 §6.4). Would belong to a future
   ReviewEngine/UI metrics component if ever needed.

## Effect on Gate B (Domain Parity)

As of this pass: **detection AND quality scoring are both at full parity**
across all 12 fixtures (12/12 each, zero unexplained mismatches). Gate B is
not yet fully closed — entity resolution, occurrence classification, and
explanation generation remain signature-only interfaces. This pass closes
the quality-scoring slice of Gate B completely; entity resolution
(`EntityResolutionEngine`) is the recommended next implementation target.
