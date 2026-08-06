# DocScrub Product Evolution

**Class: historical — narrative record.** Extended by dated sections as
eras close; existing sections are not rewritten. Created 2026-07-30 by
extracting the build history that had accreted in `../../README.md`
(documentation initiative, Phase 2). This tells the story once, in order;
the per-pass evidence remains in `../detection/` and the other findings
documents cited throughout — this narrative never replaces them.

---

## Era 1 — The Python original (the oracle)

DocScrub began as a local Python utility, `work/pii_docx_redactor/`: a
single-file HTTP server (`local_web_app.py`, 5,000+ lines of serving,
rendering, persistence, keyboard handling, and orchestration) wrapping
genuinely good domain modules under `redactor/` — deterministic detection,
candidate-quality scoring, entity resolution, occurrence classification,
explanations, replacement rules, a keyboard-driven review queue. The
product intelligence was proven; the host was not a long-term
architecture. The lasting decision from this era: the Python application
would be treated as a **behavioral oracle and regression specification**,
never as code to clone and never (per Andrew's standing instruction) as
code to keep improving — later defect fixes land in DocScrub-Web with the
deviation disclosed, not in Python.

## Era 2 — Target architecture and the ARB review (2026-07-27)

A v0.1 target architecture proposed the browser-local rebuild. The
Architecture Review Board reviewed it against the live Python codebase and
returned conditional approval with five Required findings — most notably
that "Not Quite," the product's one documented exception to "items do not
disappear on click," was real six-variable state in Python yet invisible
in the architecture (R1), and that one "GroupingEngine" conflated
audit-bearing identity resolution with pure display classification (R2).
The v0.2 revision accepted the findings: EntityResolutionEngine and
OccurrenceClassifier split, FocusNavigator named, commands namespaced,
Not Quite modeled as explicit ReviewEngine sub-state, ScoringProfileSnapshot
pinned per session, OutputVerifier inserted as the rebuild/audit seam,
synchronous engines with async only at real I/O, and an 18-entry ADR
register. This era's vocabulary — the Sock Principle, "Completion Beats
Movement" — became the project's load-bearing philosophy.

Record: `decisions/` (the extracted ADR register),
`../../../DocScrub-Web_Architecture_Review_Report.docx`,
`DocScrub-Web_Target_Architecture_v0.2.docx` (this directory).

## Era 3 — The migration: Phases 1–12, Gates A–E (closed 2026-07-28)

The Python-to-TypeScript migration ran as twelve phases against five
acceptance gates, with golden fixtures exported from live Python as the
specification. The OOXML feasibility spike ran first (the single largest
named unknown), and produced the era's best surprise: no OOXML/ZIP library
was needed at all — `CompressionStream`/`DecompressionStream` covered it.
Each engine phase was a faithful, line-cited port accepted against fixture
diffs: Detection (Phase 4), CandidateQuality (5 — which also uncovered
that every fixture ever generated had silently used a degraded lexicon,
fixed and regenerated), EntityResolution (6), OccurrenceClassifier (7,
closing Gate B), ReviewEngine (8), FocusNavigator (9), Workspace +
CommandDispatcher and the first real UI (10, click-tested in real Chrome
in 10.1 with zero defects), AuditExporter (11, closing Gate D — two Python
content-leak export behaviors deliberately not replicated), and the Gate E
side-by-side acceptance (12): all 13 domain-parity fixtures, every
deviation classified under the A–E scheme, zero Category D or E findings,
zero unresolved behavioral differences. From Gate E on, **the TypeScript
implementation is the production reference implementation** and the
project moved to normal feature-based development.

Record: `../detection/phase-4-findings.md` … `phase-12-findings.md`,
`../ooxml-spike/`, `phase-1-acceptance-criteria.md` (this directory).

## Era 4 — Features and milestones (2026-07-28)

Post-migration work followed the same rigor as the migration itself.
Feature 001 (Group Check bulk actions) closed the one scope gap Gate E had
flagged — and browser validation surfaced two real latent defects (an
infinite loop in the rebuild replace logic; a silent verification-FAILED
state), both fixed, plus a same-day terminology amendment aligning group
actions to Item Check's vocabulary. Feature 002 (Decision Reuse — "Review
once. Apply everywhere.") added the first genuinely new engine since the
migration: three deterministic reuse tiers, the never-overwrite rule, and
the three-way reviewer/imported/overridden-import audit distinction. The
ambiguity anchor correction fixed a genuine, pre-existing Python oracle
bug (a person mentioned with one spelling was invisible to ambiguity
matching; a silent auto-merge existed) — the model case for fixing the
product rather than preserving oracle defects. In parallel, three
milestones rebuilt the thin integration UI into a production reviewer
workspace: evidence and explanations surfaced (Milestone 1), review at
scale — search, filters, sorts, bulk actions, quick-jump, command bar
(Milestone 2), and reviewer productivity — persistent IndexedDB sessions,
Recent Documents, replacement rules, provenance, statistics (Milestone 3,
four real bugs found in validation and fixed).

Record: `../detection/feature-001…`/`feature-002…`,
`../detection/ambiguity-anchor-correction.md`,
`../detection/milestone-{1,2,3}-*.md`.

## Era 5 — Interaction refinement: revisions and the reviewer-experience waves (2026-07-29 → in progress)

With the workspace functionally complete, attention turned to how it
*feels* under real use — Andrew's stated philosophy: minimize UI
manipulation time, maximize evidence-evaluation time. A run of same-week
revisions landed: auto-expansion derived from focus, automatic
progression with a brief acknowledgement, inline editors replacing every
`window.prompt()`, the context-sensitive command bar, compact color-coded
Group Check with visible-order-aware arrow navigation, per-member
checkboxes and quick-pick chips, the Change/Fix-this relabels (display
only; durable vocabulary unchanged), and roving-grid keyboard focus. A
systematic Python-vs-Web reviewer-experience review then produced a
30-item classified backlog (preserve/recreate/adapt/remove) executed as
waves: Wave 1 "restore keyboard trust" (complete, browser-validated),
Wave 2 "stop the view fighting the reviewer" (implemented; browser
validation pending for three steps), Waves 3–5 open. This era is still
in progress; its durable conclusions will be promoted into the planned
`reviewer/` documentation once the waves land.

Record: `../detection/*-revision.md`, `reviewer-experience-review.md` and
`reviewer-experience-backlog.md` (this directory), the wave documents at
the repository root (working class).

## Turning points

Four shifts explain most of the current shape. **Oracle, not blueprint:**
Python's behavior was the spec, but its host, its export content leaks,
and eventually its own defects were not — deviation became a first-class,
classified object. **Structure before UI:** engines, workspace, and
dispatcher existed and were verified before any real interface; every UI
revision since has repeatedly cost "zero new domain logic," which is the
architecture paying rent. **Migration rigor became permanent culture:**
findings docs, deviation disclosure, and real-browser validation were
migration tooling that simply never stopped. **Judgment stayed human:**
from the ARB's Not Quite finding to the auto-merge removal to Decision
Reuse's never-overwrite rule, every era re-derived the same principle now
recorded as `../../product/invariants.md#reviewer-is-the-decision-maker`.

## Where the full record lives

Phase/milestone/feature/revision detail: `../detection/` (immutable).
Gate closure: `phase-1-acceptance-criteria.md`. OOXML feasibility:
`../ooxml-spike/`. Decisions: `decisions/`. UI change log:
`design-notes.md`. Current truth: `../README.md` (map) → the canonical
layer.
