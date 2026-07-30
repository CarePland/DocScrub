# Phase 4 findings — DetectionEngine port

Reference: `docs/architecture/DocScrub-Web_Target_Architecture_v0.2.docx` §6.3
(DetectionEngine) and Andrew's "Phase 4 (Detection Engine & Domain Parity)"
instruction (2026-07-27). Continues from Phase 3
(`docs/ooxml-spike/phase-2-findings.md`, `construct-support-matrix.md`),
which closed out the OOXML parse/rebuild/verify layer.

## What the Python oracle actually is

Before porting anything, the oracle itself needed reading, not assuming.
`redactor/detectors.py` (241 lines) is the entire detection surface. Two
findings from that reading changed the shape of this pass:

1. **There is no email/phone/URL/date/organization/location detector
   taxonomy in Python.** Andrew's suggested implementation order ("email,
   phone, URLs, IDs, dates, organizations, people, locations, remaining
   heuristic detectors") describes a plausible detector roadmap, but
   Python's actual `detected_type` vocabulary is exactly five values:
   `email`, `phone`, `cin`, `long_numeric_id`, `person`. There is no URL
   detector, no organization detector, no location detector -- dates only
   appear as a *false-positive suppressor* (`_is_date_or_page_number`),
   never as something detected and surfaced. Porting detectors Python
   doesn't have would be invention, not migration -- "treat Python as the
   behavioral oracle" ruled that out. This pass ports exactly Python's five
   types, faithfully, and nothing else.

2. **spaCy is not the deterministic baseline.** `detect_people()` tries
   spaCy NER first and only falls back to regex heuristics if spaCy is
   unavailable. spaCy is not installed in this environment
   (`ModuleNotFoundError: No module named 'spacy'`), so no way exists here
   to even confirm its behavior as an oracle. More importantly:
   `scripts/export_fixtures.py` (which generated every fixture this
   migration verifies against) and every test in `tests/test_detectors.py`
   / `tests/test_docx_flow.py` explicitly call
   `detect_all_candidates(..., use_spacy=False)`. Python's own test suite
   and fixture generator treat the regex-fallback path as the behavior
   worth pinning down. Combined with Andrew's explicit Phase 4 instruction
   to avoid machine-learning inference in the core pipeline, three
   independent reasons converge on the same answer: port the deterministic
   regex-fallback path, not spaCy NER. If a real deployment runs with spaCy
   installed, its person-detection behavior would differ from this port --
   a known, accepted divergence, not a silently missed one.

## What was ported

`src/engines/detectors/patterns.ts` -- every regex and stop list from
`detectors.py`, cited inline against the exact Python source line. No
pattern needed restructuring for JavaScript's `RegExp`: negative lookbehind
(`(?<!\d)`), word boundaries, and case-insensitivity all behave the same.

`src/engines/DetectionEngine.ts` (`RegexDetectionEngine`) -- a faithful
port of `detect_regex_candidates()`, `detect_people()`'s regex-fallback
path, and `detect_all_candidates()`'s merge logic, including:

- `normalize_candidate()` -- candidate key derivation, including the
  person-specific "Last, First" -> "First Last" rewrite and digit-only
  normalization for phone/cin/long_numeric_id.
- `context_snippet()` -- the `[...]`-bracketed context window.
- `_is_date_or_page_number()` -- suppresses phone/cin/long_numeric_id
  matches that are actually dates or nearby page numbers.
- `_has_capitalized_neighbor()` -- suppresses single-name matches that are
  actually part of a longer capitalized phrase.
- The two-pass single-first-name heuristic: collect all candidate single
  names across every block first, then only emit occurrences for names
  that repeat at least twice -- exactly Python's order of operations.

## Domain parity, measured

`verify/detection-parity.ts` runs the real `RegexDetectionEngine` against
all 12 fixtures and diffs the result against Python's own
`expected/candidates.json` + `expected/occurrences.json` (generated with
`use_spacy=False`, confirmed by reading `export_fixtures.py` directly --
meaning the oracle that produced every fixture already IS the path this
engine ports). Comparison covers candidate key, `displayValue`,
`detectedType`, `source`, `confidence`, and per-occurrence `text`/`start`/
`end` (both Python and this engine use paragraph-local offsets, so direct
numeric comparison is valid, not just text comparison).

**Result: 12/12 fixtures match exactly** for body/header/footer content --
zero missing candidates, zero field mismatches, zero unexplained extras.

Three fixtures show additional candidates beyond Python's output, all
expected and all attributable to Phase 3 architectural decisions rather
than detection bugs:

- `comments-001`: "Priscilla Nakamura", found only in the `comment` block
  Python's pipeline never scans.
- `tracked-changes-001`: "Beatrice Alcantara", found only in the
  `tracked-deletion` block Python's pipeline never scans.
- `content-control-001`: "Desmond Okonkwo", the body-level content-control
  candidate already recorded as an approved intentional deviation in that
  fixture's `manifest.json` (Phase 3).

This is the detection engine actually closing the hyperlink-target and
tracked-deletion coverage gap in practice, not just in the redaction
mechanism -- Phase 3 only proved that redaction/verification COULD act on
such content, using synthetic detection results. Phase 4 makes that
detection real: `RegexDetectionEngine` runs over every `ContentBlock` in
the `DocumentModel`, which includes `hyperlink` and `tracked-deletion`
blocks by construction. (Note: `hyperlink-001` itself doesn't produce an
extra hyperlink-only candidate, because the email address in its
hyperlink target is textually identical to a body-text mention already
detected -- the two occurrences correctly merge into ONE candidate rather
than appearing as a separate, unexplained extra.)

`verify/production-parity.ts` was updated to use `RegexDetectionEngine`
directly instead of constructing a synthetic `DetectionResult` from
fixture data (its previous, Phase-3-era approach) -- the full
parse -> detect -> redact -> verify chain now runs on real detection
output end to end. All 14 checks (12 fixtures + the dedicated
hyperlink-target and tracked-deletion-safety-net tests) still pass.

## Documented deviations

None of these were silently introduced -- each is deliberate and recorded
here per Andrew's "never allow undocumented differences" instruction.

1. **spaCy NER path not ported.** See "What the Python oracle actually
   is" above. Accepted, not a gap to close later without a specific
   product reason (browser-side ML inference conflicts with the
   deterministic/explainable mandate).
2. **Occurrence ID content differs cosmetically.** Python's occurrence IDs
   embed a human-readable location string (`"body paragraph 2"`); this
   port substitutes `ContentBlock.id` (e.g. `"block-4"`) at the same
   position, since `DocumentParser` does not compute Python-equivalent
   location strings (table/cell nesting isn't tracked -- see Phase 2/3
   notes on this same gap for redaction, which was similarly judged
   cosmetic there). Structurally equivalent (stable, unique within one
   parse); string content differs. No fixture comparison depends on exact
   ID string content -- comparison is by key/text/offsets instead.
3. **`casefold()` vs `toLowerCase()`.** Candidate key normalization uses
   JS's `toLowerCase()`, slightly less aggressive than Python's
   `casefold()` for a handful of non-ASCII characters (e.g. German "ß").
   Every fixture and pattern in scope is ASCII-range; hand-rolling a full
   casefold table was judged not worth the complexity against zero
   observed impact. Flagged, not silently assumed equivalent.
4. **Block scan order differs from Python's exact traversal order.**
   Python iterates body paragraphs, then body tables, then per-section
   headers, then per-section footers. This engine iterates
   `DocumentModel.blocks` sorted by `order`, which `DocumentParser`
   populates by OOXML part in alphabetical filename order (so
   `footer1.xml` before `header1.xml`, opposite Python's header-then-
   footer). This can only affect the relative ORDER occurrences are
   appended within a candidate (and therefore occurrence-index numbers in
   IDs), never which candidates or occurrences are found. Low risk, not
   worth restructuring `DocumentParser`'s part iteration for at this
   stage; flagged for awareness if occurrence ordering ever becomes
   user-visible (e.g. "first occurrence" in a future UI).

## What Phase 4 does not cover yet

`CandidateQualityEngine` (`redactor/candidate_quality.py`, 1017 lines --
`quality`, `qualityStatus`, `candidateScore`, `qualityReasons`,
`qualityEvidenceBreakdown` in every fixture's `candidates.json`) is
confirmed, by reading `export_fixtures.py`, to be a separate post-detection
scoring pass, not part of detection itself. Out of scope for this pass by
design, not by oversight -- Andrew's primary objective was explicitly
"begin implementing the real DetectionEngine." Recommended next
implementation target.

## Effect on Gate B (Domain Parity)

Gate B (architecture v0.2 §14, `phase-1-acceptance-criteria.md`) requires
ported TypeScript detection output to match Domain Parity Fixtures for
every case, or every mismatch recorded as an approved deviation. As of this
pass: **candidate/occurrence detection is at full parity** across all 12
fixtures (12/12, zero unexplained mismatches). Gate B is not yet fully
closed -- quality scoring, entity resolution, occurrence classification,
and explanation generation are all still signature-only interfaces with no
implementation. This pass closes the detection slice of Gate B completely;
the remaining slices are the next work.
