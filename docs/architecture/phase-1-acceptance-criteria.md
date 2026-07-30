# Phase 1 Acceptance Criteria

Reference: `DocScrub-Web_Target_Architecture_v0.2.docx` §14, Migration Strategy,
Phase 1 ("Capture Python behavior with schemas and golden fixtures... Current
Python app remains canonical") and the interim-gate structure introduced in
v0.2.

This document defines what "done" means for Phase 1 specifically, and lays
out the interim gate definitions for the phases immediately following it, so
acceptance isn't decided informally as each phase wraps up.

## Phase 1 scope (this pass)

Phase 1 is foundation only: schemas, fixture structure, and an early
structural read on real-document fidelity risk. It explicitly does not
include a working browser parser, a working UI, or full fixture-corpus
coverage.

### Delivered in this pass

- [x] Versioned TypeScript domain schema (`src/domain/`, `src/engines/`,
      `src/io/`, `src/settings/`) matching every component named in
      architecture v0.2 §6, including the v0.2-only additions
      (EntityResolutionEngine, OccurrenceClassifier, FocusNavigator,
      ScoringProfileSnapshot, OutputVerifier, NotQuite sub-state,
      SettingsService trust classification).
- [x] Golden-fixture directory structure with three named families
      (`fixtures/domain-parity/`, `fixtures/interaction/`,
      `fixtures/performance/`) matching architecture v0.2 §13.
- [x] `fixtures/schema/fixture-manifest.schema.json` — a validated JSON
      Schema for fixture manifests, covering all three families including
      family-specific required fields (`performanceBudget` for performance
      fixtures, `interactionScenario` for interaction fixtures) and an
      explicit `deviations` field for recording intentional Python/TS
      behavior differences (§13's "Intentional deviations must be approved
      and recorded rather than silently accepted").
- [x] `scripts/export_fixtures.py` — a read-only exporter proving the
      fixture format end-to-end against one synthetic domain-parity case
      (`synthetic-transcript-001`), covering candidates, occurrences,
      quality scores, entity-group proposals, ambiguity proposals, and
      occurrence classification.
- [x] `scripts/ooxml_structural_spike.py` and `docs/ooxml-spike/findings.md`
      — structural (not yet fidelity-proving) analysis of a real document,
      establishing concrete, evidence-based risk priorities for the Phase 2
      browser spike (run-splitting frequency, field-code volume, drawing
      object volume, nested-table depth) instead of a generic "handle OOXML"
      goal.

### Explicitly not done in this pass (do not treat as regressions)

- No browser-side DocumentParser/DocumentRebuilder implementation. Blocked
  on: (a) choosing and installing a browser OOXML/ZIP library, which
  requires npm registry access this environment did not have, and (b) the
  Phase 2 spike itself.
- No fixture corpus beyond one synthetic case. Real (de-identified) document
  fixtures, and interaction/performance fixtures, are Phase 1 follow-up or
  later-phase work per the migration strategy.
- No `tsc` type-check of the TypeScript in `src/` (no TypeScript compiler
  installed in this environment). Every file was checked for syntax validity
  with `node --experimental-strip-types --check` (Node 22's built-in TS
  syntax stripper), which caught zero errors — a real but partial signal,
  not equivalent to full type-checking.
- No re-run of the existing Python test suite (`pytest` not installed in
  this environment). The Python source under `work/pii_docx_redactor/` was
  not modified.

### Phase 1 completion gate

Phase 1 is complete when, in addition to the above:

1. [x] `npm install && npm run typecheck` passes with zero errors on a
   machine with normal network access. **Confirmed by Andrew, 2026-07-27**,
   run from `DocScrub-Web/` after the redundant `DocScrub/DocScrub/` nesting
   was flattened. Independently re-confirmed from this environment the same
   day once `node_modules/typescript` (installed by that `npm install`)
   synced back into the mounted folder: `tsc` 5.9.3, real compiler, zero
   errors — supersedes the earlier `node --experimental-strip-types --check`
   syntax-only signal noted below.
2. [x] `pytest` passes against the unmodified `work/pii_docx_redactor/`
   suite, confirming this pass did not regress the oracle. **Confirmed by
   Andrew, 2026-07-27**, run from `work/pii_docx_redactor/` with the added
   `pytest.ini` (`pythonpath = .`) resolving the prior
   `ModuleNotFoundError: No module named 'redactor'`.
3. [x] At least 3 additional domain-parity fixture cases exist, chosen to
   cover the fidelity risks `findings.md` identified as actually present
   (run splitting, field codes, drawing objects), not just synthetic text.
   **Done, 2026-07-27** — `run-split-name-001`, `field-codes-001`,
   `drawing-objects-001` (`scripts/build_structural_fixtures.py`), all
   validated against `fixture-manifest.schema.json`. Built from synthetic
   data rather than real documents, deliberately — putting real PII into a
   committed fixture corpus would cut against the same trust-boundary
   principle (§4.1) this whole migration exists to serve.

   These three cases also produced a real finding worth carrying into Phase
   2: the current Python pipeline's *detection* already handles all three
   patterns correctly (candidates are found regardless of run-splitting,
   field-code result text, or drawing objects), because
   `docx_reader.paragraph_text()` joins all `w:t` nodes in a paragraph before
   detectors ever run. The open fidelity risk for these patterns is
   specifically in **rebuilding** — writing a replacement back across a
   run or field boundary — not in detection. Gate A in the interim-gates
   section below should weight its acceptance criteria accordingly: parser
   *extraction* parity is the lower-risk half of Gate A; rebuild fidelity
   across these same three patterns is the part actually worth scrutiny.

Phase 1 is complete.

## Interim gates for the following phases (architecture v0.2 §14)

These replace the single big-bang final acceptance gate the ARB review
flagged in v0.1. Each gate is a hard stop — do not proceed past it with a
known failure, even if later phases seem tractable in isolation.

### Gate A — Parser/Rebuilder Feasibility (after Phase 2/7)

- Browser DocumentParser extracts blocks matching domain-parity fixture
  expectations for every fixture case, including the run-splitting and
  field-code cases identified in the OOXML spike.
- Browser DocumentRebuilder output opens correctly in Word/LibreOffice and
  preserves formatting for every fixture case.
- Every fidelity gap is explicitly catalogued as a hard blocker or a
  warning-only risk (§15.4) — "silently degrades" is not an acceptable
  outcome for any case.

**Status, updated 2026-07-27, Phase 3 (see
`../../DocScrub-Web/docs/ooxml-spike/phase-2-findings.md`'s "Phase 3"
section and `../../DocScrub-Web/docs/ooxml-spike/construct-support-matrix.md`
for full detail):** the parser/rebuilder is no longer a prototype. Andrew
made four architectural decisions on the previously-open items below, and
`DocScrub-Web/src/io/` now contains a real, working implementation
(`OoxmlDocumentParser`, `OoxmlDocumentRebuilder`, `OoxmlOutputVerifier`)
built on `CompressionStream`/`DecompressionStream` -- the actual browser
Web API, not a Node stand-in. `DocScrub-Web/spike/` is retired (see its
`SUPERSEDED.md`).

- Extraction and rebuild parity: **passed**, all 12 fixture cases, verified
  against the real production code (not spike code) via
  `DocScrub-Web/verify/production-parity.ts` -- 14/14 checks, including
  independent `python-docx` re-opens and raw-ZIP residual-text checks.
  `tsc --noEmit` passes with zero errors.
- **Three of the four previously-open items are now closed by decision +
  implementation**:
  - Hyperlink targets: Andrew decided targets are sensitive content and
    silent leakage is unacceptable. `ooxml/hyperlinks.ts` now splices
    relationship targets, and `OutputVerifier` independently rescans them
    as a blocker-severity check. Verified end to end.
  - Comments: Andrew decided comments are in scope for the same review
    pipeline as ordinary text. `ooxml/comments.ts` closes this for real
    (not just a flag) by reusing the exact same redaction path as body
    text. Verified end to end, including an independent raw-ZIP check.
  - Content controls: Andrew approved the browser parser's detection of
    body-level content-control text as an intentional, permanent
    improvement over the Python oracle -- recorded as an approved
    deviation in `content-control-001`'s manifest, not left open.
- **One item remains a genuine limitation, but is no longer a silent one**:
  tracked-change deletions still cannot be safely rebuilt/redacted (per
  Andrew's decision, this is correct caution, not a gap to paper over) --
  but `OutputVerifier` now independently rescans tracked-deletion content
  in the rebuilt output and fails verification with a blocker-severity
  finding if redacted text is still present there. Proven via a dedicated
  safety-net test that specifically checks the failure path fires, not
  just that ordinary redaction succeeds.
- Two objective interface defects were found and fixed while implementing
  this for real: `DocumentRebuilder`/`OutputVerifier` had no
  `DetectionResult` parameter (neither could actually locate what to
  redact/rescan), and `DocumentModel` had nowhere to carry the original
  OOXML bytes despite `DocumentRebuilder`'s signature taking no separate
  file parameter. Both fixed; see phase-2-findings.md "Phase 3" section.
- **What Gate A still needs before full closure**: (1) running this same
  implementation in an actual browser tab (verified here under Node's
  implementation of the same standardized Web Streams APIs, not yet under
  Chrome/Firefox/Safari itself), and (2) porting `DetectionEngine` to
  TypeScript, since the verification above uses a synthetic detection
  result built from fixture data rather than a real port of Python's
  detectors -- the io/ layer is proven, detection coverage over it is not
  yet real.

### Gate B — Domain Parity (after Phase 4)

- Ported TypeScript detection/quality/entity-resolution/occurrence-
  classification output matches Domain Parity Fixtures for every fixture
  case, or every mismatch is recorded as an approved deviation in that
  fixture's `manifest.json` (`deviations` field).

**Status, 2026-07-28, Phase 7 (see
`../../DocScrub-Web/docs/detection/phase-4-findings.md`,
`../../DocScrub-Web/docs/detection/phase-5-findings.md`,
`../../DocScrub-Web/docs/detection/phase-6-findings.md`, and
`../../DocScrub-Web/docs/detection/phase-7-findings.md` for full detail):
detection, quality-scoring, entity-resolution, AND occurrence-
classification slices all complete. Gate B is closed.**

- `DocScrub-Web/src/engines/DetectionEngine.ts` (`RegexDetectionEngine`) is
  a real, working port of `redactor/detectors.py`'s deterministic
  regex-fallback path (spaCy NER intentionally not ported -- not installed
  anywhere it could be verified against, not what Python's own test suite
  or fixture generator exercise, and out of scope per Andrew's
  deterministic/explainable-only mandate for the core pipeline).
- **Candidate/occurrence parity: 12/12 fixtures match exactly**
  (`DocScrub-Web/verify/detection-parity.ts`, diffed directly against
  Python's `expected/candidates.json`/`expected/occurrences.json`) --
  candidate key, display text, detected type, source, confidence, and
  per-occurrence text/offsets all verified, not just candidate presence.
  Three fixtures show additional, individually-explained candidates beyond
  Python's own output (comments, tracked deletions, the already-approved
  content-control deviation) -- all attributable to Phase 3 decisions
  extending detection's block coverage, not detection bugs.
- Four documented deviations recorded (spaCy path, occurrence-ID content,
  `casefold` vs `toLowerCase`, block scan order) -- see phase-4-findings.md.
- `DocScrub-Web/src/engines/CandidateQualityEngine.ts`
  (`RegexCandidateQualityEngine`, backed by `src/engines/quality/scoring.ts`)
  is now a real, working port of `redactor/candidate_quality.py`'s
  `score_candidate_quality()` and every helper it depends on, including its
  full merged lexicon data (`quality-dictionaries.data.ts`, generated
  directly from the live Python module).
- **Quality-scoring parity: 12/12 fixtures match exactly**
  (`DocScrub-Web/verify/quality-parity.ts`) -- quality label, status, numeric
  score, and the complete ordered reasons list all verified against
  Python's `expected/candidates.json`, not just the final label.
- **Significant finding, fixed this pass**: every domain-parity fixture had
  been silently captured under a degraded Python oracle state, because
  `redactor/candidate_quality.py` resolves its lexicon directories via
  `Path.cwd()` and the fixture-generation scripts were invoked from a
  working directory with no `config/` folder -- meaning tens of thousands
  of real lexicon terms were silently never loaded when any prior fixture
  was generated. Fixed (`scripts/export_fixtures.py` now `chdir`s into the
  Python app's own directory before importing it) and all 12 fixtures were
  regenerated; verified that only the four quality fields changed, not
  candidate identity, detection, or occurrences. See
  phase-5-findings.md for the full writeup -- this was found via, and is
  exactly the kind of thing, evidence-driven fixture verification is
  supposed to catch.
- Nine documented deviations recorded for the quality-scoring port (heading-
  context substitute, the pre-existing "readme" pseudo-lexicon Python bug
  ported faithfully, an objective `CandidateQualityEngine.evaluate()`
  interface-signature fix, additive `QualityResult` schema extension,
  profile-driven rather than hardcoded weights/thresholds, and others) --
  see phase-5-findings.md.
- `DocScrub-Web/src/engines/EntityResolutionEngine.ts`
  (`RegexEntityResolutionEngine`, backed by `src/engines/entity-resolution/
  resolution.ts` and a from-scratch port of Python's `difflib.
  SequenceMatcher.ratio()`) is now a real, working port of
  `redactor/entity_resolution.py`'s `build_entity_groups()`,
  `build_ambiguous_matches()`, and `calculate_entity_confidence()`.
- **Entity-resolution parity: 13/13 fixtures match exactly**
  (`DocScrub-Web/verify/entity-resolution-parity.ts`) -- group membership,
  ordering, canonical name, detected type, group and per-member
  confidence, ordered reasons, and ambiguity proposals (with each option's
  own canonical name/confidence) all verified. A new fixture,
  `entity-resolution-001`, was built specifically to exercise real
  multi-candidate grouping and ambiguity (variant grouping via first-name
  bucket, ambiguity between two same-first-name people, a same-surname-
  different-initial must-not-merge pair, a title-prefix quirk, and a
  singleton) -- confirmed against the live Python oracle, not hand-
  predicted. Six documented deviations recorded, including a confirmed
  real Python quirk (a swept-in title token can silently prevent grouping
  with an untitled mention of the same person) -- see phase-6-findings.md.
- `DocScrub-Web/src/engines/OccurrenceClassifier.ts`
  (`RegexOccurrenceClassifier`, backed by `src/engines/occurrence-classifier/
  classification.ts` for the parity-critical bucketing rule and
  `occurrence-classifier.ts` for additive reviewer-ready enrichment) is now
  a real, working port of `redactor/occurrence_groups.py`'s
  `occurrence_group_kind()`/`group_occurrences()`, plus a new,
  Python-has-no-equivalent enrichment layer (`ReviewOccurrence`,
  `StructuredContext`) cross-referencing Detection/Quality/
  EntityResolution output and introducing an explicit, deterministic
  document-reading-order sort Python's own module never guaranteed.
- **Occurrence-classification parity: 13/13 fixtures match exactly**
  (`DocScrub-Web/verify/occurrence-classification-parity.ts`) -- bucket
  kind/label/membership, context-extraction byte-fidelity, navigation
  metadata, explicit deterministic ordering, determinism-on-rerun, and
  entity-group cross-reference all verified. `occurrenceGroupKind()` itself
  was cross-checked against live Python for 22 cases (13 real fixture
  occurrences + 9 hand-picked edge cases targeting the artifact-token
  asymmetry) before being trusted, matching the rigor applied to Phase 6's
  `sequence-ratio.ts` port. No new fixture was needed: the existing
  13-fixture corpus already exercises every scenario Andrew's Phase 7
  instruction requested (multiple occurrences of one entity, overlapping
  entities at an identical span, adjacent entities, repeated names,
  comment/content-control/tracked-change occurrences, and mixed content
  ordering -- confirmed, not assumed, by directly comparing raw detection
  order against the sorted output). See phase-7-findings.md for the full
  writeup.
- **Newly discovered and fixed this pass**: `scripts/export_fixtures.py`'s
  fixture-regeneration path was silently destroying any hand-curated
  `manifest.json` `deviations[]` entry on every re-run (its manifest dict
  never included that key), which had already caused `content-control-001`'s
  approved deviation record to go missing, degrading detection-parity from
  12/12 to 11/12 without anyone having touched detection code. Restored the
  missing entry and patched the script to preserve `deviations[]` across
  future regenerations -- exactly the kind of drift "keep documentation
  synchronized with implementation continuously" and fixture-driven
  verification are meant to catch. See phase-7-findings.md.
- **Gate B (Domain Parity) is closed**: all four components (Detection,
  CandidateQuality, EntityResolution, OccurrenceClassifier) are real,
  independently fixture-verified production code.

### Gate C — Review Interaction Parity (after Phase 6)

- FocusNavigator and ReviewEngine (including Not Quite) pass every
  Interaction Fixture, **where "Interaction Fixture" is satisfied by
  either**: (a) a serialized interaction fixture (a literal
  `fixtures/interaction/*.json` file diffed against a captured expected
  result), **or** (b) deterministic property/behavior verification that
  exercises the equivalent state transitions end-to-end against real
  domain-parity fixtures, when no Python oracle exists to export a literal
  fixture from in the first place. **Amended by Andrew, 2026-07-28**: the
  original wording assumed a fixture format written before
  FocusNavigator/ReviewEngine/Workspace's real shape was known; Python has
  no clean, testable interaction-state module to export fixtures from
  (`local_web_app.py`'s Flask handlers + embedded client JS, not a
  standalone module -- see phase-8/9/10-findings.md's "why there is no
  fixture-parity harness" sections), so requiring a literal fixture format
  would mean inventing one solely to satisfy stale wording rather than to
  serve any real verification need.
- Namespaced commands (`review.*`, `navigation.*`, `document.*`,
  `history.*`) are exercised by at least one fixture each (fixture in the
  sense above -- literal or property/behavior).

**Gate C is closed, 2026-07-28.** The existing suites satisfy the amended
criterion directly: `DocScrub-Web/verify/focus-navigator-verification.ts`
(96/96 checks) exercises FocusNavigator's full state-transition surface
against real `DurableReviewEngine` output, and
`DocScrub-Web/verify/workspace-integration.ts` (65/65 checks) exercises all
four namespaced command families (`review.*`, `navigation.*`, `document.*`,
`history.*`) end-to-end against real fixtures through the actual
`WorkspaceCommandDispatcher` command surface -- load, review
ambiguity/group/item candidates, the full Not Quite lifecycle (enter,
navigate, rename, complete, cancel, resume across a reload), stage
transitions, save/reload, wrong-document rejection, and generate-output
gating. No new fixture format was built, per Andrew's explicit instruction
not to invent one solely to satisfy wording that predates these components'
real shape. `review-engine-verification.ts` (43/43) is the corresponding
ReviewEngine-side coverage, already re-run clean at Gate C's prior "Status"
checkpoint below.

**Status, 2026-07-28, Phase 9 (see
`../../DocScrub-Web/docs/detection/phase-9-findings.md` for full detail):
ReviewEngine (durable review state, Phase 8) AND FocusNavigator
(interaction/focus, Phase 9) are both complete and verified.
CommandDispatcher/Workspace wiring (Phase 10, "interface") has not started,
by design -- Andrew's phase instructions explicitly separate state (8),
interaction (9), and interface (10). Gate C is not yet closed: no UI exists
to exercise Interaction Fixtures end-to-end, and namespaced commands are
only exercised by the property/behavior verification suites below, not by
Interaction Fixtures themselves (none exist yet -- see phase-9-findings.md's
"why there is no fixture-parity harness this phase").**

- `DocScrub-Web/src/engines/ReviewEngine.ts` (`DurableReviewEngine`, backed
  by `src/engines/review/session.ts` for the reducer and
  `src/engines/review/serialization.ts` for versioned save/load) is now
  real: it implements the already-ARB-reviewed `ReviewSession`/`NotQuite`
  schema (ADR-008) against the Python oracle's actual decision-recording
  behavior (`redactor/models.py`, `redactor/decisions.py`,
  `local_web_app.py`'s `update_decision()`/`update_entity_group()`).
- Unlike Phases 4-7, this is durable STATE, not derived document
  intelligence -- there is no Python-exported fixture to diff against, so
  verification (`DocScrub-Web/verify/review-engine-verification.ts`) is a
  43-check property/behavior suite instead of a fixture-parity harness,
  covering exactly what Andrew's instruction asked for: decision
  persistence, reload fidelity, deterministic serialization, decision
  precedence (Rename supersedes Keep, confirmed to be simple last-write-
  wins overwrite, not a hidden precedence table), rename propagation,
  Ignore behavior, Not Quite behavior (including two oracle-corrected
  assumptions -- see below), repeated save/load cycles, and rejection of
  malformed/future-versioned save files.
- **Two confirmed oracle findings that corrected an initial assumption**:
  reading `tests/test_local_web_app_modes.py` directly (not just the
  handler code) showed (1) a bare "Not Quite" action never touches any
  candidate's decision at all -- it is pure deferral, and (2) "Not Quite
  Complete" does NOT require every group member to have been individually
  decided first, and does not itself decide anything. Both are now
  faithfully ported and directly asserted in the verification suite rather
  than assumed from the handler code alone.
- **Deliberately not ported, documented**: per-candidate
  `Decision.REVIEW`/per-occurrence `OccurrenceDecision` (real Python fields,
  but confirmed via exhaustive grep to be never set by the actual product
  UI); and entity-group bulk actions (Flatten/Keep-as-is/Skip/exclusions)
  from `update_entity_group()`, deferred to Gate C's FocusNavigator/
  Workspace phases since they are inherently tied to the Group Check UI
  surface Andrew explicitly wants kept in a later phase.
- **One approved deviation**: entering Not Quite for a second, different
  group while one is already open is rejected outright, rather than
  silently discarding the first group's in-progress panel the way Python's
  client JS does (`notQuiteGroups.clear()`). Durable review state should
  not silently lose in-progress work.
- **Additive design decision**: `ReviewSession` save files carry an
  explicit `schemaVersion`, unlike Python's own `save_state()`/
  `load_saved_state()`, which write an unversioned flat JSON blob with no
  version field at all -- confirmed by reading `save_state()` directly.
  Since there is no real Python versioning contract to preserve, this is
  an improvement, not a deviation, with a documented migration-ladder
  structure ready for a future schema bump.
- All prior verification suites re-run with zero regression: production-
  parity 14/14, detection-parity 12/12, quality-parity 12/12,
  entity-resolution-parity 13/13, occurrence-classification-parity 13/13,
  sequence-ratio-smoke 9/9, scoring-smoke 12/12, plus the new
  review-engine-verification 43/43. `tsc --noEmit` clean.

**Phase 9 addendum**: `DocScrub-Web/src/engines/FocusNavigator.ts`
(`DeterministicFocusNavigator`, backed by `src/engines/navigation/stages.ts`,
`navigation/navigator.ts`, and `navigation/keymap.ts`) is now real: it owns
transient interaction focus -- workflow stage, active item, drilled-down
occurrence, and (while open) Not Quite member cursor -- deterministically
derived from `ReviewEngine`'s durable state, never duplicating it.

- Ported faithfully from `redactor/review_queue.py` -- the one clean,
  already-tested Python navigation module (`visible_items`/
  `first_active_key`/`reconcile_active_key`/`move_active_key`/
  `next_undecided_after_decision`/`shortcut_to_action`). Everything else
  (stage sectioning, Not Quite member navigation, context-sensitive command
  resolution) was read from `local_web_app.py`'s large embedded client-JS
  keydown handler and rebuilt as clean, DOM-free domain logic -- an
  explicit switch over focus context, not a verbatim port, per Andrew's
  "resolve by active context, not one global switch statement, no DOM
  references" instruction.
- Five workflow stages (Ambiguity Check, Group Check, Item Check, QA,
  Output) use the product's own vocabulary; "Item Check" is a confirmed,
  documented fold of Python's separate "Category Check" and "Results"
  sections, since both resolve against the same underlying candidate-
  decision vocabulary with no distinct mechanism of their own. Confirmed:
  Ambiguity Check likewise has no separate resolution mechanism --
  `update_ambiguous_match()` calls the same `update_decision()` any other
  candidate decision uses.
- **Deliberately not ported**: 2D grid arrow movement in the Results view
  (`candidateGridColumnCount()` is viewport-width-dependent -- FocusNavigator
  must never query rendered-element positions; `moveItem` stays
  1-dimensional, matching `review_queue.py`'s own oracle exactly); entity
  group bulk actions (already deferred in Phase 8, reaffirmed); "c"/"d"/"."
  presentation-only context toggles (no ReviewEngine/FocusNavigator effect,
  left to a future Workspace UI's own component state).
- **Interface corrections** (same "objective interface defect" category as
  every prior phase): `Commands.ts`'s `NavigationCommand` union replaced
  wholesale (the prior `moveResult`/`moveControl`/`moveCategory`/
  `selectControl` shape had no concrete behavior ever identified for it);
  `FocusNavigator.ts`'s own `FocusState`/`FocusNavigator` interface replaced
  wholesale (the prior stub could not express command rejection, had no
  stage concept, and its `reconcileAfterVisibilityChange` took no
  resolved/unresolved information); `CommandDispatcher.ts`'s
  `dispatchNavigation` return type corrected as a direct, zero-call-site-
  impact knock-on; `NotQuite.ts`'s `MemberAction` widened to include
  `"Ignore"` (a real, reachable Python per-member action missing from the
  Phase 8 schema, found while building the keyboard map against Python's
  real handler directly).
- **Deliberate, documented extension**: `findUnresolved()` generalizes
  Python's forward-only `next_undecided_after_decision()` into a symmetric
  bidirectional search, since Andrew's instruction explicitly requires both
  "next unresolved" and "previous unresolved" traversal, which Python never
  modeled in reverse.
- **Optional resume-position model**: `src/domain/FocusResumePosition.ts`,
  a small, independently versioned, OPTIONAL type kept outside
  `ReviewSession`'s own schema -- captured at `saveReviewSession` time,
  restored through the same `reconcile()` every stale-focus scenario uses,
  so a stale or missing resume position can never produce an invalid focus
  target. Review correctness never depends on it.
- Verification (`DocScrub-Web/verify/focus-navigator-verification.ts`):
  96/96 checks, against real pipeline output through a real
  `DurableReviewEngine` -- initial-focus determinism, traversal and
  boundary clamping, unresolved-only traversal, stage transitions, focus
  reconciliation after each decision kind, the full Not Quite lifecycle
  (including a cancel-without-completing scenario) against a real entity
  group, focus recovery from a stale active item, all-complete stage
  status, command-namespace resolution across every context (including the
  Not Quite "i"-key fix), the resume-position lifecycle, deterministic
  focus after a `ReviewSession` save/load cycle, and five explicit
  property-style checks (round-trip traversal, bounded termination, target
  validity, unresolved reachability, idempotent reconciliation).
- All prior verification suites re-run with zero regression: production-
  parity 14/14, detection-parity 12/12, quality-parity 12/12,
  entity-resolution-parity 13/13, occurrence-classification-parity 13/13,
  sequence-ratio-smoke 9/9, scoring-smoke 12/12, review-engine-verification
  43/43. `tsc --noEmit` clean.

### Gate D — Output and Audit Parity (after Phase 9)

- OutputVerifier's VerificationReport and AuditExporter's artifacts match
  Domain Parity Fixtures' expected exports for every fixture case.
- No document content is observed crossing the cloud trust boundary during
  audit export (manual + automated check against architecture v0.2 §11).

**Gate D is closed, 2026-07-28, Phase 11 (see
`../../DocScrub-Web/docs/detection/phase-11-findings.md`).**
`OutputVerifier`/`DocumentRebuilder` closed their half as of Phase 3
(status below, unchanged). `AuditExporter` is now real: it produces a
versioned, deterministic `AuditRecord` (schema in `src/domain/
AuditRecord.ts`) consuming authoritative Workspace/ReviewSession output --
never reconstructing decisions independently -- and derives a
redaction-log CSV, decisions JSON, and QA-metrics JSON from that one
record. Gate D's literal criterion assumed a Python-exported "expected
exports" fixture to diff against; as with Gate C, no such Python oracle
export exists for audit output specifically (Python's own CSV/QA-metrics/
decisions writers have negligible test coverage and were never designed as
a stable export contract -- see phase-11-findings.md's oracle-research
section), so this closes via the same amended standard Gate C now uses:
deterministic property/behavior verification exercising the equivalent
state (`verify/audit-exporter-verification.ts`, 63/63 checks: determinism,
ordering stability, complete decision representation, Not Quite outcomes,
unresolved-state handling, verification warnings, save/reload equivalence,
wrong-document protection, schema-version validation, and absence of
unnecessary source content). Two deliberate, approved deviations from
Python's actual (not merely historical) practice were made and verified:
the CSV and QA-metrics projections omit raw source document content
(context snippets, candidate literal text) that Python's own exporters
currently embed -- directly requested by Andrew's instruction to minimize
sensitive data in the audit report. No document content crosses the
trust boundary during audit export (manual check: AuditRecord and every
derived projection carry only stable IDs, type categories, decision
metadata, and operator-authored replacement text -- confirmed directly by
`verify/audit-exporter-verification.ts`'s "Absence of unnecessary source
content" section, not just asserted).

### Gate E — Side-by-Side Acceptance (Phase 12, final)

- All prior gates passed and remain passing (no silent regression).
- Full parity and UX acceptance across all three fixture families on the
  complete fixture corpus (not just the cases used for earlier gates).

**Gate E is complete, 2026-07-28, Phase 12 (see
`../../DocScrub-Web/docs/detection/phase-12-findings.md` for full detail).**
All 13 domain-parity fixtures pass every applicable suite (356 checks
across 12 suites, zero regressions against prior phases' own reported
counts); `fixtures/interaction/` and `fixtures/performance/` remain empty,
an already-approved condition of Gate C/D closure, not a new Gate E gap.
Every deviation documented across Phases 3–11 was reclassified under
Andrew's five-category Gate E scheme (A: Python bug/TS correct; B:
intentional architectural improvement; C: equivalent behavior,
differently implemented; D: unexpected difference requiring
investigation; E: TS regression) — **zero Category D findings, zero
Category E findings.** Every difference is either an approved,
already-documented improvement or behaviorally equivalent to Python.

**One item is flagged, not silently closed**: entity-group bulk actions
(Python's real UI lets a reviewer confirm/reject/flatten a whole proposed
group in one action; the TS command surface has no equivalent — only Not
Quite's member-by-member path exists today). This has been deferred,
explicitly, across Phases 8, 9, and 10 without ever being revisited;
Gate E surfaces it for an explicit decision rather than letting a
three-phase-old deferral become permanent by default. It does not block
Gate E's closure — Andrew has consistently scoped it out to this point —
but it is the one open item before Python retirement should be treated as
unconditional. See phase-12-findings.md's "Final assessment" for the full
reasoning.

**Recommendation**: the TypeScript implementation is the production
reference implementation for its currently supported, fixture-verified
scope (parsing/rebuilding, detection, quality scoring, entity resolution,
occurrence classification, review state, focus/navigation, save/resume,
output verification, and audit export). Python retirement can proceed on
that basis, contingent on Andrew's explicit call on the entity-group
bulk-action gap above.
