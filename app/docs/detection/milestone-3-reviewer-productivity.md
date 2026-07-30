# Milestone 3 — Reviewer Productivity

Implements Andrew's Milestone 3 instruction in full: persistent browser-local
review sessions (autosave, refresh recovery, explicit save, resume), a
Recent Documents landing experience, a configurable `ReplacementRuleEngine`,
richer imported-decision provenance, and reviewer-facing statistics
throughout the workspace.

## What was implemented

**Phase 1 — `LocalSessionRepository`** (`src/io/LocalSessionRepository.ts`'s
schema/interface, `src/io/IndexedDbSessionRepository.ts`'s real browser
implementation). A `SessionRecord` reuses `WorkspaceSaveFile` as-is for the
actual review state ("preserve the current review state rather than
reconstructing it indirectly," per Andrew's own instruction) and adds
session-level metadata (`documentId`, `fileName`, `savedAt`, `lastOpenedAt`,
`completionPercent`). Stored in IndexedDB (`docscrub-sessions` /
`sessions`, keyed by `documentId`), capped at the 10 most recently opened
documents via `evictOldestBeyondCap()`. `ReviewWorkspace` autosaves through a
serialized `autosaveQueue: Promise<void>` (prevents overlapping writes from
racing) on every document load and every focus reconciliation (i.e., after
every reviewer action), and exposes an explicit `saveReviewSessionExplicit()`
for the existing "Save Session" button. `resumeFromRepository(documentId)`
reconstructs a full workspace — detection, quality, grouping, and the
persisted `ReviewSession` — from a stored record alone, with no need to
re-supply the original file (see "Architectural decisions" for the one place
this isn't fully true).

**Phase 2 — Recent Documents** (`refreshRecentSessions()` /
`renderRecentDocuments()` in `app.ts`). The landing page now lists up to 10
recently opened documents, each showing file name, completion percentage,
and relative last-opened time, with one-click Resume and Remove. Explicitly
not a document manager — no folders, no search, no bulk operations — per
Andrew's own scope note.

**Phase 3 — `ReplacementRuleEngine`** (`src/domain/ReplacementRule.ts`,
`src/engines/ReplacementRuleEngine.ts`). A new, pure, stateless engine
computing a `Map<candidateId, replacementText>` from a
`ReplacementRuleConfig` (one rule per detected type) and the current
decisions. Precedence: a reviewer's own explicit replacement (from Rename,
or a typed-in Redact override) always wins; otherwise the configured
strategy applies. Wired into `DocumentRebuilder.rebuild()` via a new,
additive, optional fourth parameter (every existing call site is
unaffected) and surfaced in the Output stage as a "Redaction rules" panel
with a live preview.

**Phase 4 — Imported Decision Visibility** (`src/ui/decisionProvenance.ts`).
A pure function computing one of three states — `reviewer`, `imported`, or
`imported-then-overridden` — reusing `wasEverImported()` (now exported from
`AuditExporter.ts`) rather than reimplementing the event-log walk. Item Check
rows now show "(Imported)" or "(Modified from import)" as appropriate,
distinguishing Feature 002's existing tag from a reviewer's subsequent
override of it.

**Phase 5 — Review Statistics** (`renderReviewStatistics()` in `app.ts`).
A single-line stats bar visible on every stage: completion percentage,
Keep/Rename/Redact/Ignore distribution, ambiguity count, and an estimated
time remaining (extrapolated from the reviewer's own average pace on
already-decided items). Entity-type counts are tucked behind a collapsed
"By type" `<details>` rather than always shown, per Andrew's "favor clarity
over quantity" instruction.

## Architectural decisions

1. **Andrew's four named placeholder strategies (generic, sequential,
   category-specific, reviewer-defined) were consolidated into three
   implementation strategies** (`generic` | `sequential` | `custom`),
   recorded here rather than silently narrowed: "category-specific" (a
   fixed label per type) and "reviewer-defined" (the same mechanism,
   reviewer-authored) both reduce to `custom` with an optional `{n}` token
   that numbers each candidate of that type sequentially when present. This
   is one config shape doing the work of two named strategies, not a
   dropped capability.
2. **`DocumentRebuilder.rebuild()`'s new `replacements` parameter is
   additive, not a signature replacement** — the established "objective
   interface defect fix" convention in this codebase (extend a shape that
   can't express a new real requirement, never break existing callers).
   `verify/production-parity.ts`'s three existing call sites needed zero
   changes.
3. **`decisionProvenance.ts` is a new, separate pure module**, not inline
   logic in `app.ts`, for the same reason `itemCheckQuery.ts` was pulled out
   in Milestone 2: it's non-trivial UI-adjacent logic that deserves
   independent unit-testability without a DOM. It remains UI-layer, not
   domain — it only interprets already-computed `ReviewSession` data for
   display.
4. **`resumeFromRepository()` does not require re-uploading the original
   file for the common case.** `Workspace.loadDocument()` retains the raw
   file bytes it parsed, and those bytes are persisted as part of the
   session record, so a resumed session reconstructs detection, quality,
   grouping, and review state from storage alone. The "+ original docx"
   file input in the UI exists for the one case that can't work this way:
   Generate Output needs to splice replacement text back into the *original*
   OOXML package, and re-parsing a document from stored bytes forward
   through the whole pipeline on every resume would be wasteful when the
   reviewer is only continuing to review, not about to export. This was a
   deliberate scope boundary, not an oversight — confirmed by the browser
   validation below, where a resumed session correctly showed all 10 real
   candidates from storage with no re-upload needed for reviewing.
5. **Two real bugs were found and fixed during browser validation, not
   designed around** (see below for how they were found). Both fixes are
   additive and narrowly scoped — no workflow was redesigned.

### Bug fixes found via browser validation (this session)

**Bug 1 — persistence status window.** `loadDocument()` never scheduled an
autosave for a freshly loaded, zero-decision document (only
`reconcileFocus()` did, and that only fires after a reviewer action) — so an
untouched document would never appear in Recent Documents and the
persistence-status line would read "Saving…" forever. Fixed by calling
`this.scheduleAutosave()` at the end of `loadDocument()`.

**Bug 2 — stale persistence status after the fix above.** Even after Bug 1's
fix, the UI kept showing "Saving…" after the autosave had actually
completed (confirmed by inspecting IndexedDB directly) — nothing ever
re-rendered after the fire-and-forget autosave finished in the background.
Fixed with a new `onPersistenceChange?: () => void` callback on
`WorkspaceDependencies`, invoked in `persistCurrentSession()` on both the
success and failure paths, wired in `app.ts` as
`new ReviewWorkspace({ onPersistenceChange: () => render() })`.

**Bug 3 — `<details>` panels collapsing on their own interaction.** Found
while live-testing the Redaction Rules panel: changing a per-type strategy
dropdown immediately closed the very panel the reviewer was looking at.
Root cause: every `render()` rebuilds the DOM tree from scratch, and none of
this app's five `<details>` elements (Redaction rules, By type, Occurrence
Browser, Expert View, each Occurrence group) persisted open/closed state
across a rebuild — previously latent because nothing forced a re-render
*while* one was open, until Bug 2's fix made background autosave-driven
re-renders routine. That combination meant any expanded panel could now
silently snap shut moments after opening, with no visible cause, directly
undermining Andrew's own "calm, predictable, low cognitive load" bar for
this milestone. Fixed with one small, reusable `detailsEl(key, attrs)`
helper (module-level `Set<string>` of open keys, toggle listener syncs it)
applied to all five call sites rather than patching only the one panel that
happened to surface it — the failure mode was systemic, so the fix is too.
**This is one to watch going forward**: any future `<details>` (or similar
locally-stateful DOM) should go through `detailsEl()`, not a bare `el("details")`.

**Bug 4 — blank page on startup if IndexedDB is unavailable.** Found by the
Node-side `ui-smoke.ts` structural check, not the browser (Node has no
`indexedDB` global, which incidentally reproduces the exact failure mode a
real browser would hit under a storage restriction). The module's very
first `render()` call was gated behind
`refreshRecentSessions().then(render)` with no error handling — a rejected
`listRecentSessions()` call (private browsing, blocked storage, quota,
transient IndexedDB lock) would leave the reviewer looking at a permanently
blank page, unable even to load a new document. Fixed by catching inside
`refreshRecentSessions()` and degrading to an empty Recent Documents list
rather than blocking startup — Recent Documents is a convenience, not a
requirement to use the app.

## Verification results

New suite `verify/milestone-3-reviewer-productivity-verification.ts` (70
checks, six parts): Part 1 exercises `LocalSessionRepository`'s contract
against the `InMemorySessionRepository` test double (save/load/delete/
listRecent/cap eviction/quota status). Part 2 exercises autosave and
explicit-save through the real `ReviewWorkspace` against the real
`synthetic-transcript-001` fixture, including the zero-decision-on-load case
(Bug 1). Part 3 proves `resumeFromRepository()` restores full review state
(not just metadata) across two independently-constructed workspace
instances sharing one repository. Part 4 unit-tests
`ReplacementRuleEngine.computeReplacements()` in isolation: precedence
(explicit replacement always wins), generic/sequential/custom strategies,
independent per-type sequential counters. Part 5 is an integration test —
rebuilds the real fixture with a sequential person-name config and confirms
`[PERSON 001]`/`[PERSON 002]` literally appear in the rebuilt document via
an actual `python-docx` text extraction, not just the engine's in-memory
map. Part 6 unit-tests `decisionProvenance()`'s three states and suffix
labels.

Full regression battery re-run after every change, zero regressions:
`production-parity` 14/14, `detection-parity` 12/12, `quality-parity`
12/12, `entity-resolution-parity` 13/13, `occurrence-classification-parity`
13/13, `sequence-ratio-smoke` 9/9, `scoring-smoke` 12/12,
`review-engine-verification` 43/43, `focus-navigator-verification` 99/99,
`workspace-integration` 65/65, `audit-exporter-verification` 63/63,
`ui-smoke` 4/4 (was crashing before Bug 4's fix — see above),
`group-bulk-actions-verification` 83/83, `decision-reuse-verification`
117/117, `milestone-2-review-at-scale-verification` 91/91,
`explanation-engine-verification` 61/61,
`milestone-3-reviewer-productivity-verification` 70/70. `tsc` (full build)
clean throughout. Five of these suites (`workspace-integration`,
`audit-exporter-verification`, `group-bulk-actions-verification`,
`decision-reuse-verification`, `milestone-2-review-at-scale-verification`)
needed a one-line update each to inject `InMemorySessionRepository` instead
of defaulting to the real, Node-incompatible `IndexedDbSessionRepository` —
mechanical, not a behavior change.

## Browser validation

Real click-through via Claude in Chrome against `synthetic-transcript-001`,
served over `http://localhost:8000` (not `file://`). Confirmed, in order:

- **Recent Documents resume** correctly reconstructed a full 10-candidate
  review session from IndexedDB alone, with accurate completion stats.
- **A real page refresh** (full navigation reload, not an in-app state
  reset) correctly preserved a Redact decision made moments earlier —
  Recent Documents showed "10% complete (1/10)" immediately after reload,
  and Resume correctly restored the exact decision. This is the one thing
  Milestone 3's own success criteria call out as impossible to prove without
  a real browser, and it passed.
- **Persistence status** ("All changes saved") updated automatically after
  a background autosave completed, with no extra reviewer action needed —
  direct confirmation that Bug 2's fix works, not just that its unit test
  passes.
- **Review statistics** updated live after a bulk Redact-all action (10%→
  100% complete, Redact 0→10) without a page reload.
- **The Redaction Rules panel bug (Bug 3) was found live**, not anticipated
  — changing the "person" strategy to Sequential numbering visibly collapsed
  the panel before the fix, and stayed open through the same interaction
  (plus a subsequent Generate Output click) after it.
- **Generate Output**, with `person` set to Sequential numbering, produced
  "Verification: PASSED" and a working "Download Redacted Document" button
  with no console errors. (The specific sequential-numbering-reaches-the-
  real-docx claim is proven deterministically by Part 5's `python-docx`
  extraction in Node, not re-derived from the download here — the browser
  trial's value is confirming the same code path runs cleanly end-to-end
  under real DOM/Blob/download-trigger conditions, which it did.)
- No console errors were observed at any point in this session.

One thing this session did **not** re-click-through live: importing a
`decisions.json` file to exercise the new "(Modified from import)" label
end-to-end in the browser. That interaction path itself (the file input,
`Workspace.importDecisions()`) was already validated during Feature 002;
what's new in Phase 4 is only the label logic, which has full unit coverage
in Part 6 above using real `ReviewSession` shapes. Recommended before this
is called fully done: one real import → override → confirm the new label
click-through, folded into Milestone 4's browser pass if not sooner.

## Remaining work before Milestone 4 (Production Polish)

Per Andrew's own roadmap, Milestone 4 covers typography, spacing, color
refinement, iconography, empty/loading states, minimal animation,
accessibility, responsive behavior, onboarding, and attorney usability
improvements. Specific to what this milestone touched:

- The Phase 4 import-visibility click-through gap noted above.
- `detailsEl()`'s fix is now the established pattern for any future locally-
  stateful DOM element under this app's "rebuild everything" render model —
  worth a short note in the architecture doc so it isn't reinvented or
  regressed.
- No accessibility pass has been done on the new controls (Redaction Rules
  panel, Recent Documents rows, statistics bar) — deferred to Milestone 4 by
  design, not an oversight of this milestone.
