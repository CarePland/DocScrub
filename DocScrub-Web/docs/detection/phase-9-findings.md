# Phase 9 findings: FocusNavigator (interaction/focus model)

Full port record for the FocusNavigator slice (Gate C, second component).
Companion to phase-8-findings.md. Andrew's Phase 9 instruction keeps his
Model/Interaction/Interface phase boundary intact: Phase 8 built durable
review STATE (ReviewEngine); this phase builds transient interaction FOCUS
(FocusNavigator) on top of it; Phase 10 (Workspace/CommandDispatcher UI
wiring) is next, not this phase's concern.

## Why there is no fixture-parity harness this phase

Same reasoning as Phase 8, for the same underlying reason: focus/navigation
state is transient client-side interaction state in the existing Python
application, not domain intelligence Python exports as a fixture. There is
no `expected/focus-state.json` anywhere for `export_fixtures.py` to produce.
`verify/focus-navigator-verification.ts` is therefore a property/behavior
suite (96 checks), run against REAL pipeline output (Detection ->
CandidateQuality -> EntityResolution -> OccurrenceClassifier) through a REAL
`DurableReviewEngine`, exactly matching Andrew's ask for "a dedicated
verification suite using real pipeline output."

## What Python's oracle actually is, and isn't

Unlike Phase 8 (state scattered across several modules with no single clean
implementation), navigation has one genuinely clean, already-tested Python
module: `redactor/review_queue.py` --

- `QueueItem`, `visible_items()` -- the traversable item list for a given
  view.
- `first_active_key()` -- first UNDECIDED item, or the first item overall
  if everything is already decided.
- `reconcile_active_key()` -- keep the current active item if it's still in
  the visible list, else fall back to `first_active_key()`.
- `move_active_key()` -- ArrowDown/Up/Home/End/PageDown/PageUp, clamping
  (not wrapping) at both ends, `page_size = 8`.
- `next_undecided_after_decision()` -- forward search, then backward, then
  self-fallback.
- `shortcut_to_action()` -- k/n/r/i -> Keep/Rename/Redact/Ignore,
  case-insensitive, no modifiers.
- `should_ignore_keyboard_event()` -- input/textarea/select/button tags, or
  an explicit editable flag.

All of the above were ported faithfully (see `navigation/navigator.ts` and
`navigation/keymap.ts`'s doc comments for the line-level citations).

Everything else Andrew's instruction asks for -- workflow stages, Not Quite
member navigation, group-level command resolution, context-sensitive
keyboard dispatch -- exists only as one large embedded client-JS `keydown`
handler in `local_web_app.py` (~300 lines), which resolves context via a
long, ordered if-chain over DOM `.closest()` checks
(`inAmbiguityCheck`/`activeGroupId`/`notQuiteGroup`/`resultsKeyboardActive`/
...) mixed directly with rendering and layout concerns. This was read in
full and reproduced as clean, DOM-free domain logic -- an explicit switch
over `FocusState.target` -- not ported verbatim, per Andrew's own "resolve
by active context... not one global switch statement... no DOM references"
instruction.

## The five workflow stages, and why Category Check + Results fold into one

`local_web_app.py`'s actual rendered HTML (read directly, ~lines 1585-1690)
has four review `<details>` sections in document order -- "Ambiguity Check"
(`#ambiguousResolution`), "Group Check" (`#entityResolution`), "Category
Check" (`#qualityPanel`), and an untitled exhaustive per-candidate "Results"
queue (`#review-section`) -- plus post-generation QA metrics and Output
downloads, neither of which has any interactive panel or keyboard handling.

Andrew's Phase 9 instruction lists exactly five stages using the *product's*
vocabulary: Ambiguity Check, Group Check, Item Check, QA, Output. "Item
Check" has no single Python counterpart -- it is the natural fold of
"Category Check" and "Results" into one traversable list, since both
resolve against the exact same underlying vocabulary (any `CandidateDecision`
kind) and neither has a distinct resolution mechanism of its own. This fold
is recorded as an explicit design decision (`FocusState.ts`'s top doc
comment), not a silent simplification.

## Confirmed finding: Ambiguity Check has no separate resolution mechanism

`local_web_app.py`'s `update_ambiguous_match()` was read directly and
confirmed to call the exact same `update_decision()` any other candidate
decision uses. There is no separate "pick which group" resolution mechanism
behind Ambiguity Check -- it is candidate decisions, viewed through a
different lens. This is why `stages.ts`'s `isItemResolved()` uses the
identical `candidateResolvedStatus()` helper for both `ambiguity-check` and
`item-check` (see `review/coverage.ts`, built during Phase 8 specifically so
`ReviewEngine.candidateStatus()` and this phase's stage logic could never
silently diverge).

## Deliberately not ported

- **2D grid arrow movement** (`local_web_app.py`'s
  `candidateGridColumnCount()`-based Left/Right/Up/Down remapping in the
  Results view): depends on rendered viewport width, which FocusNavigator
  must never query (no DOM references, no rendered-element positions --
  Andrew's explicit constraint). `moveItem` is deliberately 1-dimensional,
  matching `review_queue.py`'s own already-tested oracle exactly. A future
  Workspace UI (Phase 10) may layer a 2D visual mapping on top entirely
  within the UI layer, translating ArrowLeft/Right to next/previous and
  ArrowUp/Down to "move by visual row" using its own column count.
- **Group-level bulk actions** (`update_entity_group()`'s
  Flatten/Keep-as-is/Skip/exclusions): already deferred in Phase 8's own
  findings, reaffirmed here -- these remain a Phase 9/10 UI-surface concern,
  not a FocusNavigator one. `keymap.ts` resolves the one exception already
  in `ReviewCommand`'s vocabulary ("q" -> `enterNotQuite`) but does not
  invent commands for the others.
- **Presentation-only context toggles** ("c" to expand/collapse an inline
  context preview inside a Not Quite member row; "d"/"." in Ambiguity
  Check): both are pure show/hide toggles over data
  (`ReviewOccurrence.context`) already exposed by OccurrenceClassifier, with
  zero effect on `ReviewEngine` or `FocusNavigator` state -- left entirely
  to a future Workspace UI's own component state.

## Interface/schema corrections this phase

Following the same "objective interface defect" precedent used in every
prior phase (Phase 3 x2, Phase 5, 6, 7, 8):

1. **`Commands.ts`'s `NavigationCommand` union, replaced wholesale.** The
   v2 shape (`moveResult`/`moveControl`/`moveCategory`/`selectControl`) was
   a speculative placeholder from an earlier design pass, predating the
   concrete workflow-stage/focus-target model this phase had to design
   directly from Python's real behavior. No Python behavior maps onto a
   generic "focused control" or "category" concept once Category Check
   folds into Item Check. Removed rather than kept as permanent dead
   vocabulary, per Andrew's explicit "do not preserve an inadequate stub
   merely to avoid a justified correction."
2. **`src/engines/FocusNavigator.ts`'s `FocusState`/`FocusNavigator`
   interface, replaced wholesale.** The original stub
   (`activeResultId`/`focusedControlId`/`activeCategory` +
   `getFocus()`/`dispatch(command): FocusState`/
   `reconcileAfterVisibilityChange(visibleResultIds)`) was wrong in three
   concrete ways: no counterpart exists for "result"/"control"/"category"
   once stages fold as above; `dispatch(): FocusState` cannot express
   rejection (a stale itemId, a Not Quite command with no panel open),
   which Andrew's explainability requirement needs; and
   `reconcileAfterVisibilityChange(visibleResultIds: string[])` takes a bare
   ID list with no resolved/unresolved information and no `ReviewSession`,
   so it could not have implemented `reconcile_active_key`'s actual
   behavior even in principle.
3. **`src/engines/CommandDispatcher.ts`'s `dispatchNavigation` return type**,
   corrected from `FocusState` to `CommandResult` -- a direct knock-on of
   (2). No implementing class exists yet (grep-confirmed), so this had zero
   call-site impact; safe to correct now rather than carry the stale shape
   into Phase 10.
4. **`src/domain/NotQuite.ts`'s `MemberAction`, widened from `"Keep" |
   "Rename" | "Redact"` to include `"Ignore"`.** Found while building
   `keymap.ts`'s Not Quite per-member keyboard map against Python's real
   handler directly (`local_web_app.py`'s client JS maps `"i"` to
   `completeNotQuiteMember(group, key, "Ignore")` -- a real, reachable
   per-member action). Not caught by Phase 8's own typechecking because a
   narrower union is always assignable to the wider `CandidateDecisionKind`
   the reducer actually decides against -- a missing capability, not a type
   error. Additive: existing Keep/Rename/Redact usages are unaffected.
   `keymap.ts`'s own first draft had a matching bug (the "i" key resolved
   to `action: "Redact"` instead of `"Ignore"`), caught by cross-checking
   against the same Python line and fixed before this suite was written;
   `verify/focus-navigator-verification.ts`'s "Command-namespace
   resolution: Not Quite panel" section asserts the correct mapping
   directly, citing the fix.

## Deliberate, documented extension: bidirectional unresolved search

Python's `next_undecided_after_decision()` only ever searches forward, then
wraps backward. Andrew's Phase 9 instruction explicitly requires both
"next unresolved" and "previous unresolved" traversal, which Python's
own oracle never modeled in the reverse direction. `navigation/
navigator.ts`'s `findUnresolved()` was built as an intentional, symmetric
extension (backward-then-forward-then-self for `previousUnresolved`,
mirroring forward-then-backward-then-self for `nextUnresolved`) -- documented
as an addition, not a deviation from any real Python behavior, since there
is no Python behavior in the reverse direction to deviate from.

## The transient/durable split for Not Quite's active member

Two different things are both called "the active Not Quite member," and
they are deliberately NOT the same value:

- `NotQuiteState.activeMemberId` (`ReviewSession`, durable, Phase 8): which
  member the reviewer was last working on -- meant as a resume marker,
  updated only by `applyNotQuiteMember`'s committed outcome.
- `FocusPanel.activeMemberId` (`FocusState`, transient, this phase): the
  live cursor position while the panel is open, freely moved by
  `moveNotQuiteMember` on every arrow keystroke, most of which never touch
  `ReviewSession` at all.

`navigation/navigator.ts`'s `reconcile()` is the one place these two values
are synchronized: it follows an open `session.activeNotQuite` into
`FocusState`, copying its `activeMemberId` in, but `moveNotQuiteMember`
itself only ever updates the transient copy. This is the concrete
mechanism behind "never duplicate ReviewEngine state... avoid caches that
can silently diverge" -- the durable value is the single source of truth;
the transient value is reconciled from it at defined points, never treated
as a second copy of it.

## The optional resume-position model

`src/domain/FocusResumePosition.ts` -- a small, independently versioned,
OPTIONAL type (`{schemaVersion, stage, itemId, savedAt}`), deliberately kept
OUTSIDE `ReviewSession`'s own schema. Captured once, at the same moment a
caller issues `document.saveReviewSession`
(`DeterministicFocusNavigator.captureResumePosition()`), and restored via
`navigation/navigator.ts`'s `restoreFocusState()`
(`DeterministicFocusNavigator.fromResumePosition()`), which runs the
candidate focus target through the exact same `reconcile()` every other
stale-focus scenario already uses -- so a resume position naming a
since-resolved item, or a stage/item that no longer exists, degrades
gracefully to the ordinary "first unresolved item" bootstrap rather than
ever producing an invalid target. `NotQuiteState.activeMemberId` already
covers Not Quite's own in-progress resume position durably (Phase 8); this
type deliberately does not duplicate it, and does not capture
`occurrenceId`/panel state at all -- both are presentation-layer
conveniences one keystroke away from being reconstructed, not worth the
complexity of validating across a reload. `verify/focus-navigator-
verification.ts`'s "Focus resume position" section covers capture, restore,
staleness recovery, the undefined/no-resume-position case, and
serialize/deserialize round-tripping including rejection of an unknown
`schemaVersion`.

## Verification

`verify/focus-navigator-verification.ts`: 96/96 checks, covering: stable,
deterministic initial focus (two independently constructed navigators over
identical inputs produce byte-identical focus); next/previous/first/last
traversal with clamping (not wrapping) at both boundaries; `selectItem`
validation and rejection of unknown IDs; `enterItem`/`closeItem` occurrence
drill-down; all five stage transitions plus boundary clamping across
`WORKFLOW_STAGE_ORDER`; empty-stage (qa/output) graceful no-ops;
unresolved-only traversal against real ReviewEngine decisions; focus
reconciliation after each of Keep/Rename/Redact/Ignore (`dispatch()` and
`reconcile()` are confirmed to be genuinely separate -- FocusNavigator never
reacts to a ReviewEngine change until `reconcile()` is explicitly called);
the full Not Quite lifecycle against a real entity group from
`entity-resolution-001` (open/navigate-members/complete, plus a separate
cancel-without-completing scenario, both against real
`EntityGroupProposal` data); focus recovery when the active item is no
longer available; all-complete stage-status behavior (qa/output become
available once item-check is complete); command-namespace resolution
across Item Check, Group Check, and an open Not Quite panel (including the
"i"-key fix, and confirming a modified keystroke and text-input-active
state both suppress all shortcuts); the resume-position lifecycle;
deterministic focus after a full `ReviewSession` save/load cycle; and five
explicit property-style checks (next-then-previous returns to the original
item for every non-boundary position; forward traversal terminates within a
bounded step count; every visited focus target is a real stage item;
repeated `nextUnresolved` traversal reaches every genuinely unresolved item
-- none becomes unreachable; repeated reconciliation with no intervening
session change is idempotent).

One test-design bug was caught and fixed during this phase's own
verification-writing (not a product bug): an early draft of the
"previousUnresolved falls back to itself" check assumed a 3-candidate
scenario, but `synthetic-transcript-001` has 4+ candidates, so the 4th,
still-undecided candidate was a legitimate forward match for
`findUnresolved`'s backward-then-forward search -- correctly preferred over
falling back to self. Fixed by explicitly deciding every other candidate so
the scenario's "only unresolved item" premise was actually true.

All prior suites re-run with zero regression: production-parity 14/14,
detection-parity 12/12, quality-parity 12/12, entity-resolution-parity
13/13, occurrence-classification-parity 13/13, sequence-ratio-smoke 9/9,
scoring-smoke 12/12, review-engine-verification 43/43. `tsc --noEmit` clean
across all of `src/`.

## Recommended next target

Phase 10: the first thin UI integration -- wiring `ReviewEngine` and
`FocusNavigator` (both now real, independently verified components) into a
shared review workspace, plus a real `CommandDispatcher` implementation,
without undertaking final visual polish. `ExplanationEngine`,
`AuditExporter`, and `LocalSessionRepository` remain signatures only and are
not blockers for this.
