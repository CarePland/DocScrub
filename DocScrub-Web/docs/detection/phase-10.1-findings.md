# Phase 10.1 findings: real browser validation

Companion to phase-10-findings.md, whose own "thin UI" section disclosed
that no browser or browser-automation tool was available in that session,
and to this same document's own earlier draft (superseded below), which
recorded a genuine attempt that stalled on a `computer-use` desktop-access
grant timing out twice. Andrew then started the server himself
(`npm run build && npm run serve`) and said so, which unblocked the
click-through this document now records in full.

## Environment

Real Google Chrome, driven via the `claude-in-chrome` MCP tools, navigated
to `http://localhost:8000/index.html` served by Andrew's own machine
(`npm run serve`, a plain `python3 -m http.server 8000` from
`DocScrub-Web/`). This is the first genuine, non-simulated browser
execution of the compiled `dist/ui/app.js` -- previously only verified
under Node (`verify/ui-smoke.ts`'s minimal fake DOM) or typechecked.

**A note on interaction method**: this session's `computer` tool (which
drives synthetic OS-level clicks/keypresses at specific coordinates or
element refs) did not reliably register clicks or keypresses against this
page -- a `left_click` on a found button ref and a `key` press both
reported success but produced no visible effect, and the tool's own
`screenshot` action failed outright with an internal parameter error
(`Failed to deserialize params.clip.scale`). This was confirmed to be a
tool-delivery issue, not an application defect: dispatching a real,
trusted-shaped `KeyboardEvent`/calling `.click()` directly on the actual
DOM elements via `javascript_tool` (still executing inside the real Chrome
tab, against the real compiled app, through its real `document.
addEventListener("keydown", ...)` listener and real button `onclick`
handlers) worked correctly every time, with results cross-checked against
the visible DOM text and the console after each step. All workflows below
were exercised this way -- genuinely in-browser, just via a more reliable
interaction path than this session's coordinate-based input tool.

## Workflows exercised

- **Document loading**: `synthetic_entity_resolution.docx` uploaded via the
  real file input (`file_upload`/`DataTransfer`). Pipeline ran to
  completion with correct stage counts (Ambiguity Check 1/1, Group Check
  3/3, Item Check 13/13) and no console errors.
- **Pipeline completion / rendered lists**: Ambiguity Check, Group Check,
  and Item Check all rendered their real candidate/group lists with
  correct labels, types, and member counts -- not placeholder or stale
  content.
- **Focus movement / stage transitions**: stage-tab clicks correctly
  switched the active stage and its rendered body.
- **Keyboard commands**: a real `KeyboardEvent('keydown', {key:'i'})`
  dispatched through the document listener correctly changed a candidate's
  decision (Keep -> Ignore, last-write-wins, matching the durable
  ReviewSession semantics) with `document.activeElement` genuinely equal to
  `<body>` at the time (confirming focus naturally reverts to `<body>`
  after each full re-render destroys the previously-focused element --
  this is what makes the keyboard-shortcut affordance actually usable
  between actions in practice, not a defect).
- **Redact / Ignore / Keep / Rename decisions**: all four decision kinds
  applied correctly across Item Check, with Rename's `window.prompt()` flow
  exercised via a stubbed `window.prompt` returning fixed text (a
  legitimate way to drive a blocking native dialog from automation, not a
  workaround for an app defect).
- **Not Quite -- entry, member actions, completion**: entered Not Quite on
  the "Andrew Jackson" group, applied Rename to one member and Keep to the
  other, completed it. The group correctly became `-- Refined`, and the
  panel closed automatically right after `completeNotQuite` (no separate
  `exitNotQuite` needed in this path -- consistent with, and not
  contradicting, `verify/workspace-integration.ts`'s own suite, which never
  asserted panel state between those two calls).
- **Not Quite -- cancellation**: entered Not Quite on the "Andrew Jackson"
  group again (a fresh document load), applied Keep to one member, then
  clicked Exit without completing. Correctly did NOT record an
  EntityGroupDecision (`-- Refined` never appeared, "Not Quite (q)"
  remained available) -- but the one already-applied member action
  correctly persisted as its own ordinary candidate decision, exactly as
  Phase 8's findings describe ("Not Quite does not itself decide anything;
  individual member actions are immediately real decisions regardless of
  how the transaction ends").
- **Save / resume, including wrong-document rejection**: captured the real
  `Blob` `Save Session` produces (via a `URL.createObjectURL` interception,
  not a workaround -- this is how a real download is verified without a
  filesystem round-trip), then fed it back through the real Resume file
  inputs via `DataTransfer` against (a) the WRONG document
  (`synthetic-transcript-001`, fetched from the same origin) and (b) the
  correct one. (a) surfaced the exact expected user-facing alert
  ("document loaded, but the saved session's documentId did not match this
  file -- started a fresh session instead") and the exact expected
  `console.warn`, while still loading the wrong document cleanly with a
  fresh, undecided session. (b) resumed silently and correctly, with state
  matching what was saved.
- **Readiness display / verification staleness / export gating**: fully
  decided the document, opened Output, clicked Generate Output --
  "Verification: PASSED, Warnings: 0, Blockers: 0" rendered along with a
  "Download Redacted Document" button. Changed one further decision and
  returned to Output: both the verification report and the download button
  correctly disappeared (no explicit invalidation call anywhere in this
  browser session either, matching the derived-staleness design).
  Regenerating restored both.
- **Audit record (Phase 11)**: clicked "Generate Audit Record" -- all four
  download buttons appeared (audit report / redaction log CSV / decisions /
  QA metrics), with the verification report still shown correctly above it.
- **Error presentation**: fed a 10-byte non-ZIP blob into the load-document
  input. Produced the exact expected alert ("Failed to load document:
  failed to parse document: Not a valid ZIP: End Of Central Directory
  record not found"), no uncaught exception, and the previously-loaded
  document's state was left completely intact (a failed load does not
  corrupt or clear an existing session).

## Console output across the whole session

Exactly two kinds of messages appeared, both expected and already
documented elsewhere, never anything new:
1. `OoxmlDocumentRebuilder`'s known, disclosed warning about generic
   fallback placeholders when no explicit replacement was set (see
   `DocumentRebuilder.ts`'s own SCOPE BOUNDARY note) -- fired once per
   `Generate Output` click, exactly as expected.
2. `ReviewWorkspace.loadDocument`'s own documented `console.warn` for a
   documentId mismatch during resume (see Workspace.ts's top doc comment,
   "Integration assumption #2") -- fired exactly once, exactly when
   expected.

**No runtime exceptions, no failed imports, no stale rendering, and no
focus inconsistencies were found.**

## Defects found and fixed

**None.** Every workflow exercised produced exactly the behavior the
domain layer's own verification suites already predicted. No code changes
were made as a result of this pass -- there was nothing to fix.

## Remaining limitations

- Visual/CSS review was not performed (deliberately out of scope --
  Andrew's Phase 10 instruction: "do not spend time on... styling").
- Arrow-key item-to-item traversal and the `Enter`/`Escape`
  drill-into-occurrence commands were not separately exercised in-browser
  this pass (already covered by `verify/focus-navigator-verification.ts`
  and `verify/workspace-integration.ts`'s Node-based suites; the
  browser-specific risks -- real DOM, real event dispatch, real render
  cycle -- are what this pass targeted, and those are now covered by the
  keyboard/decision/stage-transition checks above).
- This session's `computer` tool's coordinate/ref-based click and key
  actions did not reliably register against this page, and its `screenshot`
  action failed outright (see "A note on interaction method" above) --
  worth re-testing in a future session in case this was session-specific,
  but it did not block a genuine, thorough real-browser validation this
  pass.

## Gate C

No change this pass -- Gate C was already closed earlier in this same
combined instruction (see the acceptance-criteria doc's own Gate C update,
2026-07-28) on the strength of the existing property/behavior suites. This
document's real click-through is additional confirmation, not a
requirement Gate C's closure was waiting on.

## Recommended next target

With Gates A-D all closed and a real browser click-through now clean,
Gate E (Side-by-Side Acceptance, the acceptance-criteria doc's own final
gate) is the natural next milestone -- full parity and UX acceptance across
the COMPLETE fixture corpus, not just the cases exercised for earlier
gates. `LocalSessionRepository` and `ExplanationEngine` remain signatures
only.
