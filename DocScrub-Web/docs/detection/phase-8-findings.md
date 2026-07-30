# Phase 8 findings: ReviewEngine (durable review state)

Full port record for the ReviewEngine slice (Gate C, first component).
Companion to phase-4/5/6/7-findings.md. Andrew's Phase 8 instruction
explicitly separates this phase (durable review STATE) from Phase 9
(FocusNavigator, interaction) and Phase 10 (Command Bar/Workspace,
interface) -- this document only covers state.

## Why there is no fixture-parity harness this phase

Phases 4-7 each had a clean Python module to port faithfully and a
Python-generated fixture to diff TS output against exactly. ReviewEngine is
different: it owns durable REVIEWER INTENT, not derived document
intelligence, and Python has no equivalent clean module -- decision
recording is spread across `redactor/models.py` (data classes),
`redactor/decisions.py` (default-decision construction, JSON
serialize/deserialize, save/load), `redactor/review_queue.py` (an
action-name <-> Decision vocabulary table, plus keyboard/navigation
functions that are Phase 9's concern, not ported here), and
`local_web_app.py`'s `update_decision()`/`update_entity_group()` HTTP
handlers, which mix real domain logic with Flask/UI plumbing in one big
mutable global `state` dict. There is no `expected/review-session.json`
fixture anywhere, because Python's own persisted state
(`local_web_app.py`'s `save_state()`) is unversioned server-runtime state,
not something `export_fixtures.py` ever captures as a domain-parity
artifact.

So verification for this phase (`verify/review-engine-verification.ts`) is
a property/behavior suite, not a diff harness -- it checks the exact
properties Andrew's instruction lists (decision persistence, reload
fidelity, deterministic serialization, decision precedence, rename
propagation, Ignore behavior, Not Quite behavior, repeated save/load
cycles), running against REAL candidate and entity-group IDs pulled through
the full Detection -> Quality -> EntityResolution pipeline against real
fixtures (`synthetic-transcript-001`, `entity-resolution-001`), not
hand-typed placeholder IDs.

## Starting point: an already-ARB-reviewed schema

Unlike every prior phase, the domain schema for this slice already existed
in detail before this pass started: `src/domain/ReviewSession.ts` and
`src/domain/NotQuite.ts` were built during an earlier architecture-review
pass (ADR-008 revised, the ARB review's first required finding), and
`src/domain/Commands.ts`'s `ReviewCommand` union and
`src/engines/ReviewEngine.ts`'s interface were likewise already specified.
This phase's job was largely to implement that already-designed contract
faithfully against the Python oracle's actual behavior, not to design a new
schema from scratch -- consistent with "extend existing patterns over
replacing them." Only one schema field was added
(`redactCandidate.replacement?`, additive, see below); everything else in
`ReviewSession.ts`/`NotQuite.ts`/`Commands.ts` was implemented as-is.

## What Python's oracle actually does

- `redactor/models.py`: `Decision` (UNDECIDED/NOT_SENSITIVE/KEEP/RENAME/
  REDACT/REVIEW) and `OccurrenceDecision` (UNDECIDED/KEEP/REDACT) are two
  separate decision levels -- candidate-wide ("everywhere") vs. per-
  occurrence override, respectively. `CandidateDecision` bundles a
  `decision`, `replacement`, `occurrence_decisions` map, group/lifecycle
  metadata (`canonical_group_id`, `review_stage`, `review_status`,
  `reviewer_decision`, `decision_timestamp`, `inherited_decision_source`),
  and occurrence-coverage bookkeeping.
- `local_web_app.py`'s `update_decision()`: a plain overwrite --
  `decision.decision = ACTION_TO_DECISION.get(action, decision.decision)`.
  There is no separate precedence table anywhere in the codebase. This is
  the entire mechanism behind Andrew's "Rename supersedes Keep": whichever
  decision was dispatched most recently for a candidate simply IS its
  current decision, because there is only ever one current value per
  candidate, never an accumulating log of prior ones.
- `redactor/docx_writer.py`: `Decision.KEEP`/`RENAME`/`REDACT` drive a
  document-wide find/replace (`selected_replacement_rules`); `Decision.
  REVIEW` instead consults the per-occurrence `occurrence_decisions` map,
  redacting only occurrences explicitly marked `OccurrenceDecision.REDACT`.
  `Decision.NOT_SENSITIVE`/`UNDECIDED` produce no replacement rule at all.
- "Not Quite" is NOT a `Decision` enum value anywhere in the Python data
  model. It exists only as: (a) `CandidateDecision.review_stage`/
  `review_status`/`reviewer_decision` free-form string fields, and (b) an
  append-only, untyped list of dicts (`local_web_app.py`'s
  `entity_group_reviews`) recording group-level review actions with real
  provenance (timestamp, reviewer, group_id, selected/deselected
  candidates, prior_states/resulting_states). This confirms the already-
  designed TS schema's choice to model Not Quite as its own `NotQuiteState`
  sub-state rather than a `CandidateDecisionKind` value was correct before
  this phase even started.

## Two oracle-corrected assumptions

Reading only `local_web_app.py`'s handler code first suggested two
behaviors that turned out to be wrong once `tests/
test_local_web_app_modes.py` was read directly:

1. **Assumed**: entering "Not Quite" on a group might pre-populate or imply
   some decision for its members. **Actual** (`test_not_quite_marks_
   proposal_without_hiding_members`): a bare "Not Quite" action changes
   *no* candidate's decision at all (`Decision.UNDECIDED` for every member,
   confirmed by direct assertion), and the group continues to be
   re-surfaced by `resolution_routes()` afterward. This is the literal
   mechanism behind "Not Quite intentionally preserves unresolved work" --
   ported as: `enterNotQuite` populates `NotQuiteState.members` structurally
   but touches zero `CandidateDecision` entries.
2. **Assumed**: "Not Quite Complete" would require every member to have
   been individually resolved first (a natural-sounding gate). **Actual**
   (`test_not_quite_complete_requires_explicit_stage_completion`): the test
   calls `update_decision()` directly for two candidates (bypassing any
   per-member Not-Quite editor entirely), fires "Not Quite Complete", and
   asserts the decisions are *unchanged* and the completion still succeeds
   -- no `allMembersHandled` gate exists in the oracle at all. `completeNot
   Quite()` was implemented to match exactly: it never requires
   `allMembersHandled`, and never force-decides any member. It only stamps
   canonical group membership (`EntityGroupDecision{decision:"Refined"}`,
   mirroring Python's `canonical_group_id = f"entity:{group_id}"` being
   applied to every member regardless of their individual decision status)
   and records the completion event.

Both findings are directly asserted in `verify/review-engine-verification.ts`
(not just implemented and hoped-for), citing the exact Python test each one
corrects.

## What was deliberately not ported, and why

- **`Decision.REVIEW` / per-occurrence `OccurrenceDecision`**: real fields
  in Python's data model, consumed downstream by `docx_writer.py` and
  `audit.py` -- but confirmed via exhaustive grep across `local_web_app.py`
  to be never actually set by the shipped product's UI (no `action:
  "Review"` request anywhere, no per-occurrence decision endpoint). A real
  capability the domain model supports but the actual product does not
  currently expose. Andrew's own Phase 8 minimum bar (Keep/Rename/Redact/
  Ignore/Not Quite) doesn't include it, and the already-ARB-reviewed
  `CandidateDecision` schema has no field for it either. Porting it now
  would be exactly the "premature generalized infrastructure" Andrew's
  standing constraints warn against, for a workflow the real product
  doesn't use. If a future phase needs it (e.g. wiring occurrence-level
  redaction into DocumentRebuilder), it can be added additively then,
  following the same interface-defect-fix precedent used repeatedly in this
  migration.
- **Entity-group bulk actions** (`update_entity_group()`'s "Flatten"/"Keep
  as-is"/"Redact"/"Ignore"/"Skip" applied to a whole proposed group at
  once, and `entity_group_exclusions`' per-member exclude mechanic): real
  Python behavior, but inherently tied to presenting and interacting with a
  Group Check screen -- deferred to Gate C's FocusNavigator (Phase 9) and
  Workspace (Phase 10) per Andrew's own explicit Model/Interaction/
  Interface phase boundary. `EntityGroupDecision`/`AmbiguityResolution`
  remain in the schema (already there from ADR-008); `completeNotQuite`
  DOES populate `EntityGroupDecision` (as `"Refined"`) since Not Quite's
  commands already existed in `Commands.ts` as of this phase's charter --
  only the *other* group-level actions (confirm/reject/skip a whole group,
  resolve an ambiguity) are left unpopulated this phase, explicitly, not
  silently.

## Interface/schema changes

- **Additive**: `Commands.ts`'s `redactCandidate` gained an optional
  `replacement?: string`. Confirmed by reading `update_decision()` directly:
  Python's `decision.replacement` is settable regardless of whether the
  decision is RENAME or REDACT -- REDACT just defaults to a type-
  appropriate placeholder (`"[REDACTED EMAIL]"`, etc.) when unset, computed
  at output-generation time, not here. Existing single-field callers remain
  valid.
- No other schema changes were needed. `ReviewSession.ts`/`NotQuite.ts`
  were implemented as already designed.

## Approved deviation

Entering Not Quite for a **different** group while one is already open is
**rejected** here (`"another Not Quite group is already open; exit it
first"`), not silently swapped. Python's client JS (`enterNotQuite`) does
`notQuiteGroups.clear(); notQuiteGroups.add(group.id)` -- silently
discarding any in-progress (but not yet individually-decided) panel state
for the previously open group. Since `ReviewEngine` is the durable-state
authority (not a disposable UI component), and Andrew's instruction
explicitly asks to avoid "implicit precedence rules hidden inside UI code,"
this makes the constraint explicit and rejects the command with a reason
instead of silently losing state. Any candidate decisions already applied
via `applyNotQuiteMember` are unaffected either way, in both Python and
here, since those commit immediately.

## Additive design decision: versioned persistence

Python's own `save_state()`/`load_saved_state()` write a single flat JSON
blob with **no version field at all** -- confirmed by reading `save_state()`
directly; there is no `"schemaVersion"` key anywhere in the dict it builds.
This is a genuine, confirmed gap in the oracle, not something to reproduce
faithfully: an unversioned save format cannot safely evolve, directly
conflicting with Andrew's explicit "treat saved review sessions as
versioned artifacts... future migration" ask. Since there is no real Python
contract to preserve here, `src/engines/review/serialization.ts` introduces
an explicit, enforced `schemaVersion` at the load boundary
(`deserializeReviewSession`/`migrateReviewSession`), with a documented
migration-ladder structure (`switch (version) { case 1: ...; }`, empty
today since v1 is the only version that has ever existed) ready for a
future schema bump to extend without changing any call site. This is the
same category of judgment call as Phase 7's explicit document-order sort:
an additive improvement, not a deviation, because there was no real Python
guarantee to deviate from.

## Incremental-update strategy

`ReviewSession`'s durable fields (`candidateDecisions`, `groupDecisions`,
`ambiguityResolutions`) are plain `Record<string, X>` maps. Every reducer
transition in `src/engines/review/session.ts` only ever touches the one
key it's responsible for (e.g. `{...session.candidateDecisions, [id]:
newDecision}`), so only the affected candidate/group is ever recomputed --
this falls out of the reducer's shape by construction, not from any added
optimization machinery. No extra incremental-computation infrastructure was
introduced, matching Andrew's "correctness remains more important than
optimization" note directly.

## Verification

`verify/review-engine-verification.ts`: 43/43 checks, covering decision
persistence and precedence (Keep -> Rename -> Redact -> Ignore all
overwrite the same single current decision, confirmed as one object, not an
accumulating log), rename-text validation (blank text rejected, both for
direct `renameCandidate` and for a Not Quite member's Rename action),
Ignore's non-destructive guarantee (the underlying `DetectionResult`
candidate is provably untouched), deterministic serialization (identical
state serializes to byte-identical JSON), reload fidelity (serialize ->
deserialize -> re-serialize is stable), five repeated save/load cycles with
no drift, malformed/future-schema-version save-file rejection (never
throws; always returns a typed failure), the full Not Quite lifecycle
against a REAL entity group from `entity-resolution-001` (enter/apply-
member/complete/exit, including both oracle-corrected assumptions above,
plus the approved cross-group-rejection deviation), rejection of applying a
decision for a non-member candidate, and full-sequence determinism across
two independently constructed engines given identical commands and clock.

All prior suites re-run with zero regression: production-parity 14/14,
detection-parity 12/12, quality-parity 12/12, entity-resolution-parity
13/13, occurrence-classification-parity 13/13, sequence-ratio-smoke 9/9,
scoring-smoke 12/12. `tsc --noEmit` clean across all of `src/`.

## Recommended next target

Phase 9: FocusNavigator -- keyboard-first navigation over
OccurrenceClassifier's `ReviewOccurrence[]`/groups, using `ReviewEngine`'s
`getState()`/`candidateStatus()` to know what's still unresolved, without
FocusNavigator itself ever deciding anything (that boundary is now real,
not aspirational: `ReviewEngine` is a real, independently constructible,
independently verified component FocusNavigator can depend on today).
