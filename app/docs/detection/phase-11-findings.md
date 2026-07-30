# Phase 11 findings: AuditExporter (Gate D)

Companion to phase-10-findings.md (Workspace/CommandDispatcher) and
phase-10.1-findings.md (the browser-validation attempt that preceded this
phase in the same combined instruction). This phase closes Gate D by
implementing the last signature-only component: `AuditExporter`.

## Python oracle research (done before any design decision)

Read directly, not assumed: `redactor/audit.py` (`write_audit_csv`),
`redactor/qa_metrics.py` (`build_qa_metrics`), `redactor/decisions.py`
(`decisions_to_json`), and their call sites in `local_web_app.py`'s
`generate_outputs()`. Concrete findings that shaped this design:

- Python produces three artifacts from one "generate outputs" action: a
  redaction-log CSV, a QA-metrics JSON, and a decisions JSON (the last one
  written as a side effect of `write_redacted_docx`, not a separate call).
- **The CSV embeds real document content on every row**: `Occurrence.context`
  is a raw ±70-character text window around each match (`context_snippet()`
  in `detectors.py`), plus the raw candidate text itself
  (`original_candidate`). This is a genuine content leak in the current
  Python implementation, not a deliberate minimal-disclosure design.
- **The QA-metrics JSON also embeds raw candidate text**
  (`candidate_records[].candidate_text`), though not surrounding prose.
- **The decisions JSON is the one Python artifact free of raw source
  content** -- decision metadata and the operator's own replacement string
  only.
- **Audit export is unconditional in Python** -- `generate_outputs()` never
  gates on its own post-write rescan (`rescan_for_originals()`); the rescan
  runs AFTER the CSV/JSON/docx are already written and is returned
  alongside them as advisory information, never annotated onto the
  already-written files. The only real export-blocking guard is a legacy
  one, unrelated to unresolved items: leftover `Decision.REVIEW` state (a
  deprecated per-occurrence review mode not present in this TS port at all).
- Undecided candidates are never excluded from export -- they're logged as
  `"Undecided (Keep)"` and counted in `decision_counts["undecided"]`.
- Document identity is a single whole-file SHA-256 of the INPUT only; there
  is no hash of the output file anywhere in Python, and no schema-version
  field in any of the three artifacts.
- The CSV writer has zero Python test coverage; only QA-metrics' pure-function
  shape has partial coverage. The audit/export behavior itself was
  effectively unspecified by Python's own test suite.

Full detail and code citations in the research transcript this phase's
design was built from; the above is what actually drove decisions below.

## What was kept from Python, and what was deliberately changed

**Kept**: audit generation is unconditional -- not gated on a passing
verification, matching `generate_outputs()`'s own unconditional behavior.
Andrew's instruction explicitly anticipates this ("if export is permitted
with warnings"), and Python's own oracle already treats the audit trail as
a record of decisions applied, not a certificate of clean output.

**Improved over Python's actual practice, not just its history**: unlike
Python's on-disk files, which carry NO record that verification ever ran or
what it found once written, this record ALWAYS embeds the verification
outcome (or its explicit `null` absence) inline -- see `readyForRelease`/
`hasOutstandingIssues` below.

**Two approved behavioral deviations, both directly requested by Andrew's
own instruction ("do not include source document content unnecessarily...
minimize sensitive data in the audit report")**:
1. The CSV projection carries no `context` column and no raw candidate
   text -- only stable IDs, a type category, and decision metadata.
2. The QA-metrics projection carries no `candidate_text` field -- aggregate
   counts only.

Verified directly (not just designed for): `verify/audit-exporter-
verification.ts`'s "Absence of unnecessary source content" section confirms
that real, distinctive candidate values from the fixture (e.g. "Priya
Natarajan", "Carlos Mendez") and every occurrence's raw ±70-char context
snippet appear in NONE of the four produced artifacts.

## The audit schema (`src/domain/AuditRecord.ts`)

One canonical, versioned `AuditRecord` is built once; the four returned
strings (`csv`, `decisionsJson`, `qaMetricsJson`, `auditReport`) are all
DERIVED PROJECTIONS of that one record -- assembled in one place, never
recomputed four separate times. Explicit design decisions (full rationale
in the file's own doc comment):

- **Serialization format**: JSON, matching every other durable artifact in
  this codebase.
- **Ordering guarantees**: `candidates` sorted by `candidateId`,
  `entityGroups` by `groupId`, `ambiguityResolutions` by `candidateId`; each
  candidate's own `occurrences` preserves DetectionResult's already-tested
  deterministic order rather than imposing a second one.
- **Versioning**: a literal `schemaVersion`, same convention as every other
  schema-versioned type in this codebase.
- **Missing optional values**: omitted keys, except where absence is itself
  the fact being recorded (`verification: null`, `output.outputDocumentId`
  unset) -- documented per field.
- **Relationship to the rebuilt output**: `output.outputDocumentId` is a
  SHA-256 of the rebuilt Blob's own bytes (same hash function
  `DocumentModel.documentId` uses for the input -- see `src/io/hash.ts`,
  extracted from `DocumentParser.ts` this phase so the two don't risk
  silently drifting apart). `output.available` is false whenever no
  CURRENT rebuilt output exists.
- **Audit generation before successful verification**: allowed (see "kept
  from Python" above); `readyForRelease` is computed once, here, from
  exactly the rule `Workspace.readiness.exportEnabled` already uses.

## Interface correction (same category as every prior phase)

`AuditExporter.export()`'s original signature took only `(document,
session, verification)` -- no way to know a candidate's detected type or
occurrences (DetectionResult), or an entity group's canonical name
(GroupingResult), and no way to identify the output document at all.
Widened to `(document, detection, grouping, session, verification,
rebuiltOutput)`, following the "document/detection first" ordering
convention already established by `DocumentRebuilder.rebuild()` and
`OutputVerifier.verify()`. Zero real call sites existed before this phase,
so this is a zero-impact fix.

## A real gap found while integrating, not while designing

`ReviewSession.processingRevisions` -- the field ADR-015 designates for
"pins the weights/thresholds/versions in effect at the moment a session was
scored" -- was never actually populated anywhere in Phases 8-10.
`Workspace.loadDocument()` computes a fresh `ScoringProfileSnapshot` and
hands it to `CandidateQualityEngine.evaluate()`, but nothing ever recorded
that snapshot into the session's own `processingRevisions`, which
`createReviewSession()` always initializes to `[]`. This went unnoticed
because nothing before AuditExporter needed to READ it. Fixed in
`Workspace.loadDocument()` (not in AuditExporter, which only reads the
field): a fresh session now gets one `ProcessingRevision` recorded at load
time; a RESTORED session is left alone (reopening a saved session is not a
new scoring pass -- "a deliberate rescan under new rules appends, it never
overwrites"). This is an objective interface/wiring defect, the same
category as every prior phase's DocumentRebuilder/OutputVerifier/
CandidateQualityEngine/EntityResolutionEngine fixes -- found by actually
trying to use the data, not by inspection alone.

## Wrong-document / wrong-session protection

`export()` rejects outright (throws, does not silently produce a mismatched
record) if `session.documentId` or a supplied `verification.documentId`
does not match `document.documentId` -- the same "reject a mismatch
outright" principle Workspace's own documentId-gated session restore
already uses (phase-10-findings.md, "Integration assumption #2"). Verified
directly: both mismatch cases are exercised in `verify/audit-exporter-
verification.ts`.

## Integration

`ReviewWorkspace.generateAudit()` (Workspace.ts) is the one place
AuditExporter is called -- it gathers document/detection/grouping/session/
CURRENT-verification-or-null/CURRENT-rebuilt-output-or-null (reusing the
same staleness derivation `getState()`/`getRebuiltOutput()` already use,
factored into a small private `currentVerification()` helper so the two
never diverge) and stores the result for later reading via
`getLastAuditArtifacts()`. `Commands.ts` gained one additive
`ApplicationCommand`: `document.generateAudit`. `WorkspaceCommandDispatcher`
routes it with a single line (`return this.workspace.generateAudit();`) --
per Andrew's explicit instruction, no audit assembly logic lives in the
dispatcher. The thin UI (`src/ui/app.ts`) gained a "Generate Audit Record"
button plus four download buttons (audit report / redaction log CSV /
decisions / QA metrics) in the Output stage, deliberately NOT gated on
review completeness or export-readiness -- consistent with "audit
generation before successful verification: allowed."

## Verification

`verify/audit-exporter-verification.ts`: 63/63 checks, against the real
`entity-resolution-001` fixture through `ReviewWorkspace`/
`WorkspaceCommandDispatcher`'s own command surface (plus a small number of
hand-built minimal inputs for the two mismatch-protection checks and the
verification-with-warnings check, where a deterministic edge case was
clearer to construct directly than to hope a real fixture happens to
produce it). Covers every item Andrew's instruction asked for: identical
state produces identical substantive output (generatedAt/verifiedAt aside,
both real wall-clock timestamps by design), ordering stability, complete
decision representation (Keep/Rename/Redact/Ignore/Undecided), a Not-Quite-
refined entity group, unresolved-state handling (summary counts,
hasOutstandingIssues), verification warnings/blockers, save/reload
equivalence (including output-content-identity equivalence, proving
DocumentRebuilder is a pure function of document+detection+session),
wrong-document/wrong-session protection, schema-version validation, and
absence of unnecessary source content.

All prior suites re-run with zero regression: production-parity 14/14,
detection-parity 12/12, quality-parity 12/12, entity-resolution-parity
13/13, occurrence-classification-parity 13/13, sequence-ratio-smoke 9/9,
scoring-smoke 12/12, review-engine-verification 43/43,
focus-navigator-verification 96/96, workspace-integration 65/65,
ui-smoke 4/4. `tsc --noEmit` and a real `tsc` emit both clean.

## Gate D status

**Gate D (Output and Audit Parity) is closed.** `OutputVerifier` closed its
half in Phase 3; `AuditExporter` is now real, integrated, and verified
end-to-end. See the Gate D update in `docs/architecture/
phase-1-acceptance-criteria.md`.

## Recommended next target

A real browser click-through remains the one open verification gap across
Phases 10/10.1/11 (see phase-10.1-findings.md) -- `start-server.command` is
ready to use the moment `computer-use` access is granted, or Andrew can run
`npm run build && npm run serve` himself. Beyond that: `LocalSessionRepository`
and `ExplanationEngine` remain signatures only, and Gate E (Side-by-Side
Acceptance, the acceptance-criteria doc's own final gate) is the natural
next milestone once those are addressed or explicitly deferred.
