# Phase 12 findings: Gate E — Side-by-Side Acceptance

Companion to phase-4 through phase-11-findings.md and phase-10.1-findings.md
(real browser validation). This is the acceptance-criteria doc's own final
gate: a comprehensive side-by-side review of the complete fixture corpus,
treating Python as the behavioral oracle, answering one question — can the
TypeScript implementation now replace Python for its currently supported
scope?

## Methodology

Two passes, not one. First, every verification suite that exists across
Phases 3–11 was re-run in full against the current `src/` (not re-derived
from memory of prior runs) — see "Suite re-run" below. Second, every
findings doc from Phase 4 through Phase 11, plus the acceptance-criteria
doc's own Gate A–D sections, was read directly this phase (not summarized
from README text) to compile an exhaustive deviation list, which is then
reclassified below under Andrew's five-category Gate E scheme (A–E) — a
different, and stricter, scheme than the four-category
objective-defect/additive-requirement/approved-deviation/architectural-change
framework used during Phases 3–11 itself. The two schemes are reconciled
explicitly per item below, not silently merged.

Python's own test suite (`pytest`) could not be re-run in this sandbox — no
network access to install it, confirmed again this pass (`pip3 install
pytest` → `403 Forbidden` proxy error). `python3 -m py_compile redactor/*.py`
succeeds (no syntax errors), and Andrew independently confirmed the full
pytest suite passes on his own machine on 2026-07-27 (recorded in the
acceptance-criteria doc's Phase 1 completion gate) — that confirmation is
relied on here rather than re-derived, since re-derivation isn't possible in
this environment.

## Fixture corpus

13 domain-parity fixtures exist and were all exercised: `comments-001`,
`content-control-001`, `diacritics-001`, `drawing-objects-001`,
`entity-resolution-001`, `field-codes-001`, `footer-001`, `hyperlink-001`,
`nested-table-001`, `run-split-name-001`, `synthetic-transcript-001`,
`text-box-001`, `tracked-changes-001`. `fixtures/interaction/` and
`fixtures/performance/` are confirmed empty (`ls`, this pass) — consistent
with every prior phase's finding that no Python oracle export exists for
either family; Gate C and Gate D already closed against the amended
"deterministic property/behavior verification" standard for exactly this
reason, and that reasoning is not re-litigated here.

No fixture was cherry-picked or skipped. Every suite below runs its full,
unmodified fixture set.

## Comparison strategy

For domain intelligence (detection, quality, entity resolution, occurrence
classification) — direct fixture-diff harnesses (`*-parity.ts`) already
compare TS output field-by-field against Python's own `expected/*.json`
exports. For review interaction, focus/navigation, workspace integration,
and audit export — no Python oracle export exists (Python's own
implementation is Flask handlers + embedded client JS, not a clean testable
module; established and re-confirmed in Phases 8–11), so comparison is via
deterministic property/behavior suites exercising the equivalent state
transitions against real pipeline output, per the same amended Gate C/D
standard. For the real browser click-through (Phase 10.1) — direct
observation of the compiled app running against real fixtures in real
Chrome, already completed and not repeated this phase (no code changed
since that pass that would invalidate it).

## Suite re-run (complete, this pass)

| Suite | Result |
|---|---|
| `production-parity.ts` | 14/14 |
| `detection-parity.ts` | 12/12 fixtures |
| `quality-parity.ts` | 12/12 fixtures |
| `entity-resolution-parity.ts` | 13/13 fixtures |
| `occurrence-classification-parity.ts` | 13/13 fixtures |
| `sequence-ratio-smoke.ts` | 9/9 |
| `scoring-smoke.ts` | 12/12 |
| `review-engine-verification.ts` | 43/43 |
| `focus-navigator-verification.ts` | 96/96 |
| `workspace-integration.ts` | 65/65 |
| `audit-exporter-verification.ts` | 63/63 |
| `ui-smoke.ts` | 4/4 |
| `tsc --noEmit` / real `tsc` emit | both clean |

Sum of numeric checks: 356. Zero regressions found against the prior
phase's own reported counts (each identical to the count reported when that
suite was first built).

## Deviation classification

Every deviation documented across Phases 3–11 is reclassified below under
Andrew's Gate E scheme: **A** Python bug, TS correct. **B** intentional
architectural improvement, already documented. **C** equivalent behavior,
implemented differently, no action required. **D** unexpected behavioral
difference, requires investigation. **E** TypeScript regression, must be
fixed.

**Result up front: zero Category D findings, zero Category E findings.**
Every deviation surfaced across nine phases of oracle-first porting was
either resolved at the time it was found (a bug in the port, or in the
fixture-generation tooling) or is a deliberate, already-approved decision.
One item — entity-group bulk actions — is classified B but is flagged
prominently below as the most significant scope gap remaining relative to
Python's actual UI, not because it is a new finding this phase, but because
Gate E is the right moment to make Andrew explicitly re-confirm a deferral
that has now stood, unexamined, across three phases.

### Category A — Python bug, TypeScript correct

None found. Every place TS and Python actually disagreed during
development turned out, on direct live-Python verification, to be a bug in
the **fixture-generation tooling**, not in `redactor/`'s own logic:

- The quality-scoring lexicon-loading discrepancy (Phase 5) — traced to
  `scripts/export_fixtures.py` running with the wrong working directory,
  not to `candidate_quality.py` itself. Fixed in the tooling; `redactor/`
  was not touched.
- The missing `manifest.json` `deviations[]` entry (Phase 7) — traced to
  `export_fixtures.py`'s `build_case()` unconditionally overwriting
  manifests without preserving a pre-existing `deviations` key. Fixed in
  the tooling.

Two real, product-relevant Python characteristics were found and are
**ported faithfully, not corrected**, because "port faithfully, document
deviations, do not silently fix" is the standing rule while parity is being
established:

- The "readme" pseudo-lexicon bug (`config/lexical_evidence/README.txt`
  loading as a spurious 45-term lexicon because Python's exclusion check is
  case-sensitive) — zero scoring impact, reproduced exactly, not a TS/Python
  difference at all since both behave identically.
- The title-prefix / group-key quirk ("Dr Susan Whitmore" not merging with
  "Susan Whitmore") — a real Python limitation, reproduced exactly. See
  "Remaining intentional differences" below for why this is flagged as a
  possible future TS-side improvement rather than left silent.

### Category B — Intentional architectural improvement, already documented

- spaCy NER path not ported; deterministic regex-fallback path ported
  instead (Phase 4) — matches Python's own test/fixture-generation oracle
  (`use_spacy=False`), matches Andrew's deterministic/explainable mandate.
- Hyperlink-target, comment, and tracked-deletion block coverage in
  detection (Phase 3/4) — Andrew's own architectural decisions that this
  content is in-scope, closing gaps Python's own pipeline never reaches at
  all.
- Content-control body-text detection as an approved intentional inclusion
  (Phase 3/4) — recorded in `content-control-001/manifest.json`.
- Tracked-change deletions cannot be safely rebuilt/redacted in either
  system, but TS adds an independent verification safety net (a
  blocker-severity finding if redacted text is still present there) that
  Python has no equivalent of (Phase 3).
- Profile-driven weights/thresholds instead of hardcoded constants
  (ADR-015, Phase 5) — parity achieved via the default profile's content;
  the architecture is genuinely exercised, not bypassed.
- `is_filtered_candidate()`/`candidate_quality_metrics()` not ported (Phase
  5) — UI/dashboard aggregation helpers outside `CandidateQualityEngine`'s
  architectural responsibility.
- Explicit, deterministic document-reading-order sort for
  `ReviewOccurrence[]` (Phase 7) — Python's own bucket order was never a
  tested contract; this is a genuine improvement, not a deviation from a
  real guarantee.
- `StructuredContext`/`ReviewOccurrence`/`OccurrenceClassificationResult`
  enrichment layer (Phase 7) — new reviewer-facing infrastructure with no
  Python equivalent, built on top of the parity-critical core.
- `Decision.REVIEW`/per-occurrence `OccurrenceDecision` not ported (Phase
  8) — confirmed via exhaustive grep to be real Python data-model fields
  never actually set by the shipped product's UI.
- Not Quite rejects entry into a second group while one is already open,
  rather than silently discarding in-progress panel state the way Python's
  client JS does (Phase 8).
- Versioned `ReviewSession` save files (Phase 8) — Python's own
  `save_state()` has no version field at all; a genuine gap, not a
  preserved contract.
- 2D grid arrow movement not ported into the domain layer (Phase 9) —
  viewport-width-dependent, and Andrew's explicit FocusNavigator
  constraint (no DOM references, no rendered-element queries) rules it out
  at that layer; a future UI-layer visual remapping remains possible
  without touching FocusNavigator.
- **Entity-group bulk actions** (Python's `update_entity_group()`
  Flatten/Keep-as-is/Redact/Ignore/Skip, applied to a whole proposed group
  at once) **not implemented anywhere in the TS command surface.** Deferred
  in Phase 8 ("Group Check UI surface, later phase"), reaffirmed in Phase 9
  ("Phase 9/10 UI-surface concern"), and never revisited in Phase 10 (the
  actual Workspace/UI phase) or since. Confirmed this pass by direct
  inspection of `Commands.ts`'s `ReviewCommand` union and `app.ts`'s Group
  Check rendering: the only group-level action available today is entering
  Not Quite; there is no command that produces `EntityGroupDecision`'s
  `"Confirmed"` or `"Rejected"` states at all — only `"Refined"` (via Not
  Quite completion) is currently reachable, even though the schema defines
  all three. **This is not a new finding — it has been consistently and
  explicitly deferred across three phases — but it is the single largest
  functional gap relative to Python's real, actively-used UI, and Gate E is
  the right point to have Andrew explicitly re-confirm it remains
  acceptable to defer** rather than let a three-phase-old deferral become
  permanent by inertia. See "Final assessment" below for how this affects
  the retirement recommendation.
- "c"/"d"/"." presentation-only context toggles not ported (Phase 9) — zero
  effect on `ReviewEngine`/`FocusNavigator` state in Python either; pure
  show/hide UI convenience, left to a future Workspace UI's own component
  state.
- `findUnresolved()`'s bidirectional (forward AND backward) traversal
  (Phase 9) — Python's own oracle only ever searches forward-then-wrap;
  Andrew's instruction explicitly required both directions, which Python
  never modeled in reverse. An addition, not a deviation from a real
  guarantee.
- `FocusResumePosition`, an optional, independently versioned resume model
  kept outside `ReviewSession`'s schema (Phase 9) — no Python equivalent;
  degrades gracefully to "first unresolved item" if stale.
- CSV and QA-metrics projections omit raw source-document content (context
  snippets, candidate literal text) that Python's own exporters currently
  embed (Phase 11) — directly requested by Andrew ("minimize sensitive
  data in the audit report"), verified absent from all four artifacts.
- `AuditRecord` always embeds the verification outcome (or its explicit
  absence) inline (Phase 11) — Python's on-disk audit files carry no record
  that verification ever ran; a genuine improvement over Python's actual
  practice, not just its history.
- Explicit `schemaVersion` on every durable/exported artifact
  (`ReviewSession`, `AuditRecord`) — Python's equivalents are unversioned
  flat JSON with no version field anywhere; a genuine gap closed, not a
  preserved Python contract.

### Category C — Equivalent behavior, implemented differently, no action required

- `casefold()` vs `toLowerCase()` (Phases 4/5/6) — ASCII-range verified
  across all 13 fixtures with zero observed impact. Theoretical exception:
  a small set of non-ASCII characters (e.g. German "ß") fold differently
  between the two functions; no fixture exercises this today, so it is a
  documented, unverified theoretical edge rather than a confirmed
  behavioral difference. Recommended (not required) future fixture
  coverage if non-ASCII PII becomes a realistic input class.
- Occurrence-ID content differs cosmetically (`block-4` vs `"body
  paragraph 2"`, Phase 4) — structurally equivalent, string content
  differs; no fixture comparison depends on ID string content.
- Block scan order differs (footer-before-header vs Python's
  header-before-footer, Phase 4) — affects only relative occurrence
  ordering within a candidate, never which candidates/occurrences are
  found.
- Heading-context substitute: `ContentBlock.kind === "header"` lookup vs
  Python's `"header" in occurrence.location` string check (Phase 5) —
  structurally different input, behaviorally equivalent output.
- `entity_resolution.py`'s `_tokens()` not NFKC-normalizing, unlike
  `candidate_quality.py`'s (Phase 6) — a genuine Python-internal asymmetry
  between its own two modules, ported faithfully as-is on both sides, so TS
  and Python still agree with each other.
- Python's round-half-to-even vs JS's round-half-up (Phase 6) — resolved
  via a dedicated `pythonRound()` helper; no observable difference remains.
- A redundant Python exclusion filter applied once instead of reproducing
  dead code (Phase 6) — behaviorally identical outcome, code-shape only.
- `INITIAL_SURNAME_RE`/`SURNAME_INITIALS_RE`-shaped candidates unreachable
  under the deterministic (non-spaCy) pipeline in both systems (Phase 6) —
  shared unreachability, not a TS-introduced gap.
- ID-format deviation in `OccurrenceClassifier` output, inherited from
  Phase 4's occurrence-ID deviation (Phase 7) — same equivalence rationale.
- `history.undo`/`history.redo` always rejected (Phase 10) — Python has no
  real reversible-history mechanism either (decisions are simple
  last-write-wins overwrites with no revision log); both systems lack the
  capability equally, so this is not a TS-introduced gap.
- Not ported: `_context_text()` (Phase 5) — confirmed dead code in Python
  itself, never called anywhere in `work/pii_docx_redactor` including its
  own test suite.

### Category D — Unexpected behavioral difference, requires investigation

None. Every genuinely unexpected disagreement found during development
(the lexicon cwd bug, the manifest-destruction bug) was investigated
immediately when found and resolved before being carried forward — see
Category A.

### Category E — TypeScript regression, must be fixed

None. Nothing that previously worked in this TS port has stopped working;
no suite shows a new failure relative to its own prior run.

## Regressions found and fixed this pass

None. All 356 checks across 12 suites match their previously-reported
counts exactly; `tsc` is clean under both `--noEmit` and a real emit. No
code changes were made during Gate E, consistent with Andrew's "do not add
new product features during Gate E... only implement changes required to
resolve genuine acceptance failures" — there were no acceptance failures to
resolve.

## Remaining intentional differences (not blockers)

- The title-prefix/group-key quirk (Phase 6): a real, confirmed Python
  limitation ported faithfully. Worth surfacing as a **possible future
  product improvement** for the TS side specifically (stripping a
  recognized title token before deriving the group key), but explicitly
  not something to fix silently while parity is the goal, and not required
  for Python retirement since TS behavior matches Python's own here.
- Entity-group bulk actions (see Category B above) — the one open item
  worth a fresh, explicit decision from Andrew before treating "replace
  Python" as unconditional. Everything else Gate E reviewed is either
  equivalent or already an approved improvement.
- Arrow-key traversal's 1D-vs-2D feel (Phase 9) — functionally complete
  (every item is reachable via next/previous/first/last/nextUnresolved/
  previousUnresolved), but will not spatially match a multi-column visual
  grid the way Python's client JS does, unless a future UI layer adds its
  own 2D visual remapping on top of `moveItem`.
- Non-ASCII casefold edge case (see Category C) — theoretical, unverified,
  no fixture exercises it.

## Acceptance matrix

| Fixture | Passed | Documented deviations | Unresolved issues | Notes |
|---|---|---|---|---|
| comments-001 | Yes | 1 approved extra candidate (comment-block coverage, Cat. B) | None | All suites pass |
| content-control-001 | Yes | 1 approved extra candidate (content-control body text, Cat. B) | None | Only fixture with an explicit `manifest.json` `deviations[]` entry |
| diacritics-001 | Yes | None | None | All suites pass |
| drawing-objects-001 | Yes | None | None | All suites pass |
| entity-resolution-001 | Yes | Title-prefix/group-key quirk exercised and matched (Cat. C); ambiguity + grouping scenarios match exactly | None | Purpose-built for entity-resolution/ambiguity coverage; also exercises Not Quite lifecycle in review-engine/focus-navigator/workspace/audit suites |
| field-codes-001 | Yes | None | None | All suites pass |
| footer-001 | Yes | None | None | All suites pass |
| hyperlink-001 | Yes | Hyperlink-target detection/redaction coverage (Cat. B) | None | Dedicated hyperlink-target-redaction safety-net test also passes |
| nested-table-001 | Yes | None | None | All suites pass |
| run-split-name-001 | Yes | None | None | Exercises real 2-member entity group (field-code/plain-text variant) |
| synthetic-transcript-001 | Yes | Block-scan-order (Cat. C) exercised (regex-type vs person-type ordering) | None | Primary fixture for review-engine/focus-navigator/workspace suites |
| text-box-001 | Yes | None | None | All suites pass |
| tracked-changes-001 | Yes | 1 approved extra candidate (tracked-deletion coverage, Cat. B); tracked-deletion-safety-net verified separately | None | Redaction of tracked-deletion content correctly remains blocked, with a verification-level blocker confirming the failure path fires |

All 13 fixtures pass. Zero unresolved issues at the fixture level.
`fixtures/interaction/` and `fixtures/performance/` remain empty by design
(no Python oracle export ever existed for either family); this is a
standing, already-approved condition of Gate C/D closure, not a Gate E
finding.

## Recommendation regarding Python retirement

**Conditional yes.** For every fixture-driven, oracle-comparable behavior —
detection, quality scoring, entity resolution, occurrence classification,
output rebuild/verification, review-state persistence, focus/navigation,
and audit export — the TypeScript implementation matches Python exactly or
deliberately improves on it, with every difference classified and none left
Category D or E. The real browser click-through (Phase 10.1) found zero
application defects. The one open item is not a correctness gap but a
**scope gap**: Group Check bulk actions (confirm/reject/flatten a whole
proposed entity group in one action) exist in Python's real UI and do not
exist anywhere in the TS command surface today. Recommend Andrew make one
explicit call before treating Python retirement as unconditional: either
(a) confirm this capability is genuinely out of scope for the currently
supported feature set (in which case retirement can proceed today), or (b)
treat it as the next implementation target before retirement (in which
case it is a small, well-scoped addition — one new `ReviewCommand` variant
plus routing — not a redesign).

## Final assessment

**Is the browser-local TypeScript implementation now the production
reference implementation for currently supported functionality?**

For document parsing/rebuilding, detection, quality scoring, entity
resolution, occurrence classification, output verification, review-state
persistence (Keep/Rename/Redact/Ignore/Not Quite), focus/keyboard
navigation, save/resume, and audit export: **yes.** Every one of these has
been fixture-verified against the real Python oracle (or, where no oracle
export exists, verified via deterministic property/behavior suites against
real pipeline output), click-tested in a real browser with zero defects,
and had every observed difference classified and resolved or explicitly
approved. No unsupported-format claims are being made here (OCR, PDF, and
other document formats remain out of scope, as always).

For whole-group bulk review actions specifically: **not yet** — this one
capability from Python's real UI has no TS equivalent, a fact known since
Phase 8 and re-confirmed, not newly discovered, this phase. Whether this
blocks retirement is Andrew's call, not an engineering one: it depends on
whether that specific interaction pattern is something reviewers actually
rely on in practice, which is product knowledge this review does not have
access to.

## Gate E status

**Gates A through E are complete for the currently supported feature set**,
with the one explicit exception noted above surfaced for Andrew's decision
rather than resolved unilaterally (Gate E's own instruction: implement only
what's needed to resolve genuine acceptance failures — this is a scope
question, not an acceptance failure). `LocalSessionRepository` and
`ExplanationEngine` remain signatures only and were never in scope for
Gate E.
