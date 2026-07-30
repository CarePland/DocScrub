# Phase 10 findings: Workspace integration & CommandDispatcher

Full record for the first integration phase. Companion to phase-8-findings.md
(ReviewEngine) and phase-9-findings.md (FocusNavigator). Where Phases 8/9
built two independent, independently-verified engines, this phase composes
them (plus the six earlier Gate A/B engines) into one working application
without redesigning any of them -- exactly Andrew's stated charter: "This
phase should wire existing engines together. It should not redesign them."

## Why there is no fixture-parity harness this phase either

Same underlying reason as Phases 8/9, one level up the stack: there is no
Python "workspace" or "command dispatcher" module to port -- Python's
integration logic is Flask route handlers in `local_web_app.py`, mixed with
HTML rendering and client-JS state, not a clean, testable orchestration
layer. `verify/workspace-integration.ts` is therefore, like its two
predecessors, a property/behavior suite -- except this one exercises the
REAL pipeline end-to-end through real fixtures rather than testing one
engine's contract in isolation. It is additive to, not a replacement for,
every existing engine-level suite (all of which are re-run unchanged below).

## What Workspace actually is

`src/workspace/Workspace.ts`'s `ReviewWorkspace` is the composition root.
It owns exactly one thing no existing engine owns: the SEQUENCE of calls
that turns a `File` into pipeline output, a durable review session, and
interaction focus, plus a small set of derived display signals. Concretely:

```
File -> DocumentParser.parse() -> DocumentModel
     -> DetectionEngine.detect() -> DetectionResult        (sync)
     -> CandidateQualityEngine.evaluate() -> QualityResult  (sync)
     -> EntityResolutionEngine.propose() -> GroupingResult  (sync)
     -> OccurrenceClassifier.classify() -> OccurrenceClassificationResult (sync)
     -> new DurableReviewEngine(...)                        (Phase 8)
     -> new DeterministicFocusNavigator(...)                (Phase 9)
```

Everything from DetectionEngine through OccurrenceClassifier is already
synchronous and deterministic (true of each engine individually, confirmed
by their own doc comments in Phases 4-7) -- a genuine, useful discovery for
this phase: `loadDocument()` only needs to be `async` for the ONE real I/O
boundary (reading the `File`), not because "running a pipeline" is
inherently async. `generateOutput()` is the other genuine async boundary
(rebuild + independently re-verify, both real ZIP I/O). This keeps "sync
logic sync, async only at true I/O boundaries" true at the orchestration
layer, not just within each engine.

Workspace deliberately owns almost no logic of its own. The one place it
combines two already-derived facts into a third is `readiness.exportEnabled
= verificationCurrent && verificationPassed === true` -- pure
orchestration arithmetic over `OutputVerifier`'s own `passed` field, never a
duplicated pass/fail rule.

## Integration assumption #1: verification staleness is derived, not tracked

Andrew's instruction explicitly warns against "duplicated business logic"
for export gating. The naive approach -- a boolean flag set by
`generateOutput()` and cleared by every mutating command -- requires every
future call site that changes `ReviewSession` to remember to clear it,
which is exactly the kind of thing that quietly rots. Instead,
`WorkspaceState.readiness.verificationCurrent` is computed fresh on every
`getState()` call by comparing the `VerificationReport`'s captured
`ReviewSession.updatedAt` against the CURRENT session's `updatedAt`. A
mismatch means the report describes a rebuild of a session that no longer
exists, so it's treated as absent (`verification: null`) rather than
returned stale. There is no boolean to forget to flip.
`verify/workspace-integration.ts`'s "Verification staleness" section proves
this: generating output, then making one more decision, flips
`verificationCurrent`/`exportEnabled` back to false with NO explicit
invalidation call anywhere in the test.

## Integration assumption #2: session restore is gated on documentId, not per-candidate revalidation

Resuming a saved `ReviewSession` (`Workspace.loadDocument(file,
restoreSession)`) only adopts the saved session if its `documentId` matches
the freshly re-parsed document's own `documentId` (a SHA-256 content hash --
`DocumentModel.ts`). Since Detection/Quality/EntityResolution/
OccurrenceClassifier are pure deterministic functions of `DocumentModel`
content, re-parsing byte-identical bytes reproduces byte-identical
candidate/group/occurrence IDs -- a documentId match is sufficient proof the
saved session's IDs are still meaningful, with no need to revalidate every
candidateId/groupId individually against the fresh pipeline output. A
mismatch is rejected outright (the document still loads, with a fresh
session) rather than silently adopting a session whose IDs may not
correspond to anything real. Verified directly:
`verify/workspace-integration.ts`'s "Wrong-document session-restore
rejection" section loads a save file captured from `entity-resolution-001`
against `synthetic-transcript-001` and confirms the mismatch is rejected
while the (different) document still loads cleanly with an empty session.

## Integration assumption #3: `history.*` is honestly rejected, not faked

No engine in this codebase owns reversible history. `ReviewSession`'s own
reducer (`session.ts`, Phase 8) only ever applies a command forward and
appends an event -- there is no reverse transition, command log replay, or
snapshot stack anywhere. Andrew's instruction to "avoid embedding business
logic inside the dispatcher" cuts both ways here: building a fake undo
stack inside `WorkspaceCommandDispatcher` purely because Phase 10 wires
commands together would put reversible-history logic in the architecturally
worst-suited place to own it. `dispatchHistory()` therefore always returns
`{ok: false, reason: "..."}`, explained, not thrown, not faked. If a future
phase adds real undo/redo, it belongs on `ReviewEngine`, with this method
changed to route to it.

## A real gap found and fixed while building the UI: WorkspaceState needed pipeline outputs

The first draft of `WorkspaceState` exposed only status counts (`StageStatus[]`)
and the durable session -- no way for a UI to render an actual list of
candidates or groups to click on, only the single currently-focused item.
Andrew's own instruction lists "pipeline outputs" as one of the things
`WorkspaceState` should represent; the first draft missed it. Fixed by
adding `detection`/`quality`/`grouping`/`classification` as direct,
read-only references to each engine's own already-computed return value --
not a derived copy, not a new "display list" structure. This is exactly the
kind of thing built first, then caught by actually trying to use it for
something real (the UI), rather than by review alone -- worth recording
since it's the one interface correction this phase required.

## Structural (non-behavioral) reorganization: CommandDispatcher moved

`CommandDispatcher.ts` previously lived at `src/engines/CommandDispatcher.ts`,
placed there by early scaffolding before the Workspace/composition-layer
concept existed. It has been moved to `src/workspace/CommandDispatcher.ts`,
alongside the new `Workspace.ts`/`WorkspaceSaveFile.ts` -- both are
composition-layer code that COORDINATES engines, not an engine that OWNS
behavior itself, so it no longer belongs in `src/engines/`. Purely
mechanical: no import elsewhere in the codebase referenced the old path
(confirmed by grep before moving), and the interface itself was only
corrected in content (see below), not further reshaped by the move.

## Interface correction: `CommandDispatcher.dispatchNavigation`'s return type

Already flagged as a to-do in Phase 9's own doc comment on the (then still
unimplemented) `CommandDispatcher.ts`: `dispatchNavigation` returned
`FocusState` in its original v1 shape, assuming `dispatch()` itself both
applied a command AND returned the resulting focus -- not how
`FocusNavigator` actually works after Phase 9 (`dispatch()` returns whether
the command was accepted; a caller reads focus separately). Corrected to
`CommandResult` this phase, with zero call-site impact (no implementing
class existed anywhere yet).

## Command-routing explanation

Andrew's instruction: "The dispatcher should be able to explain why a
command resolved to a particular action." Implemented as
`explainCommandRouting()` -- a small, pure, deterministic function from any
`AnyCommand` to a one-line description of which engine it routes to and
why. Deliberately NOT conflated with `ExplanationEngine` (which remains a
signature only): that engine's job is translating `Evidence[]` into
reviewer-facing prose about WHY a candidate was flagged -- a completely
different kind of "explain" than "which engine does this command go to."

## The thin UI

`src/ui/app.ts` + `index.html`: a single, deliberately plain entry point
wiring one `ReviewWorkspace` + one `WorkspaceCommandDispatcher` into visible
DOM. No framework, no bundler (there is none available in this sandbox --
see README's "Environment constraints" -- and every import in `src/`
already uses explicit `.js`-suffixed specifiers for exactly this reason: a
plain `tsc` emit produces a module graph a browser can load natively, via
`<script type="module">`, no bundler required). Full re-render from scratch
on every state change (no DOM diffing), `window.prompt()` for Rename/Redact
text entry, minimal inline CSS in `index.html` just enough to make five
stages and a Not Quite panel visually distinguishable.

**Disclosed limitation, not silently glossed over**: this sandbox has no
GUI browser or browser-automation tool available, so the UI has NOT been
click-tested in an actual browser. What WAS verified: `tsc` (a real emit,
not `--noEmit`) produces a clean `dist/` whose relative `.js` imports
resolve correctly file-to-file (confirmed by inspecting the emitted output
directly), and `verify/ui-smoke.ts` imports the real compiled
`dist/ui/app.js` against a minimal fake DOM and confirms the initial
("no document loaded") render completes without throwing. This is a
genuine, if bounded, structural sanity check -- not a substitute for a real
click-through. **Recommended follow-up**: run `npm run build && npm run
serve` and open `http://localhost:8000/index.html` in an actual browser to
click through load -> review -> save/reload -> generate output by hand.

## Verification

`verify/workspace-integration.ts`: 65/65 checks, against real fixtures
(`entity-resolution-001`, `synthetic-transcript-001`) through the
dispatcher's own command surface only (never reaching into engine
internals) -- covering: every dispatch surface fails cleanly with no
document loaded (never throws); pure command-routing explanations; full
pipeline load; reviewing an ambiguity-check candidate as an ordinary
decision; the full Not Quite lifecycle (enter, navigate members, rename a
member, keep the rest, complete, exit) with focus reconciliation firing
automatically after each review command; Escape resolving to
`review.exitNotQuite` end-to-end through the keyboard resolver against a
SECOND group; deciding every remaining item-check candidate across
Keep/Redact/Ignore; review-complete gating; generate output + readiness/
export gating; verification staleness invalidation after a further decision
change, with no explicit invalidation call anywhere in the test; save
session -> full reload into a BRAND NEW Workspace/dispatcher (simulating a
real close-and-reopen) with exact decision/group-decision equality and
resumed focus; wrong-document session-restore rejection; and resuming an
IN-PROGRESS (uncompleted) Not Quite transaction across a reload, proving
reconciliation alone reopens the correct panel even though the resume
position itself only ever recorded stage+itemId.

`verify/ui-smoke.ts`: 4/4 checks (see "The thin UI" above for scope).

All prior suites re-run with zero regression: production-parity 14/14,
detection-parity 12/12, quality-parity 12/12, entity-resolution-parity
13/13, occurrence-classification-parity 13/13, sequence-ratio-smoke 9/9,
scoring-smoke 12/12, review-engine-verification 43/43,
focus-navigator-verification 96/96. `tsc --noEmit` clean across all of
`src/`; a real `tsc` emit (`npm run build`) also verified clean.

## Newly discovered risk, surfaced rather than silently absorbed

Gate C's literal acceptance criterion ("FocusNavigator and ReviewEngine pass
every Interaction Fixture") assumes a fixture FORMAT (`fixtures/
interaction/*.json`) that has never been built, because -- like Gate D's own
"no Python oracle for interaction state" gap -- there was never a Python
export to build it from. This phase's integration suite satisfies the same
underlying INTENT (namespaced commands exercised against real fixtures,
end to end) through the established property/behavior-suite pattern
instead. Recorded here as an open question for Andrew rather than resolved
unilaterally: see the Gate C addendum in `docs/architecture/
phase-1-acceptance-criteria.md`.

## Recommended next target

Two independent directions, neither blocking the other:
1. **AuditExporter** (Gate D's remaining component) -- CSV/JSON/QA-metrics/
   audit-report generation from `ReviewSession` + `VerificationReport`,
   closing Gate D.
2. **Real browser verification of the thin UI** -- a genuine click-through
   pass, ideally with a real browser-automation tool, closing the one
   disclosed gap in this phase's own verification.
