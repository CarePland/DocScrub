# DocScrub-Web — Sectioned-Queue Fixes + Section-Action Digit Shortcuts

Implementation prompt (Andrew, 2026-08-02). Treat this as an engineering
specification per `app/CLAUDE.md` and
`app/docs/architecture/implementation-philosophy.md` — read both before
writing code. Work in `app/`. The behavioral oracle rules, the
documentation standard, and the findings-report expectation all apply.

## Before you start — non-negotiable working rules

1. **Concurrent sessions are common in this repo.** Re-read any region of
   `src/ui/app.ts` immediately before editing it; never assume a
   remembered shape. Check `src/ui/version.ts` before bumping.
2. **Verification battery**: `npx tsc --noEmit`, `npm run build` (the
   browser serves `dist/`), then every suite:
   `for f in verify/*.ts; do node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs "$f" || break; done`
   (the `--experimental-loader ./verify/ts-loader.mjs` flag is REQUIRED —
   without it every suite fails with ERR_MODULE_NOT_FOUND and looks like
   mass breakage). Count suites with `ls verify/*.ts | wc -l`; zero
   regressions; never weaken an expectation.
3. **Version ritual**: bump `APP_VERSION` (`v2026-MM-DD.NN`, next
   counter) + a design-notes entry, same commit, every visible change.
4. **Live validation**: Andrew's server is `http://localhost:8000`. After
   `npm run build`, force-refresh dist in the page
   (`performance.getEntriesByType("resource")` → `fetch(u,{cache:"reload"})`
   → reload). To load a test document programmatically: fetch
   `/fixtures/domain-parity/entity-resolution-001/source/synthetic_entity_resolution.docx`
   (produces entity groups) or
   `/fixtures/browser-validation/semantic-relationships-phase2.docx`
   (produces an ambiguity sectioned queue + structural cards), build a
   `File`, set it on the hidden `.top-bar input[type=file]` via
   `DataTransfer`, dispatch `change`.
5. **Established laws you must not break** (all documented at their code
   sites): the ONE-DIGIT-SPACE law (`identityDigitAssignments` in
   `src/ui/recommendations.ts` — every digit surface derives from one
   pure function; renderer and key handler can never drift); the
   NAV-ORDER rule (any code dispatching review commands routes through
   `dispatchReviewWithVisibleAdvance` OR does an explicit displayed-order
   re-select — see `runSectionAction` for the pattern; raw
   `dispatcher.dispatchReview` leaves focus in structural order); the
   DETERMINISTIC-RENDER rule (selection-state changes never rely on a
   focus event's side effect for their render — set cursor, `render()`,
   let the render-tail pending restores supply DOM focus); INSIDE-AN-ITEM
   grammar (arrows within a surface, Tab between items); fake-DOM guards
   on anything touching `document` at module eval or in render-tail
   helpers (see `verify/ui-smoke.ts` — fake elements have `setAttribute`
   but no `.style`, document has no `querySelector`).
6. `keymap.ts` / `FocusNavigator` / `stages.ts` are a faithful domain
   port — all of this work is UI-layer (`app.ts`, `triageQueue.ts`,
   `recommendations.ts`, `index.html`, pure `src/ui/*` modules).

## Pass A — the rows↔cards seam (two bugs, one root cause)

The sectioned-queue stages (Ambiguity Check; Item Check's Triage view)
render rows AND structural relationship cards as one displayed
collection, but two mechanisms still only know rows:

**A1 — post-decision advance dead-ends at the last row.** Live repro:
"Residency" was the last unresolved row; clicking its ② chip applied
Ignore but focus stayed put with the panel open, while three "Possible
acronym" cards below still needed review. The post-decision advance
(`advanceWithinVisibleList` via `dispatchReviewWithVisibleAdvance`, and
the `runSectionAction` re-select) covers only row ids. Fix: when the
row-level advance finds no unresolved row target on a sectioned-queue
stage, continue into the first UNADDRESSED structural card — set
`structuralCardFocusPending = proposalId` and `render()` (the
deterministic pattern; see the "HIGHLIGHT IMPLIES DETAIL" comments at
the three existing card-entry sites). An addressed card has class
`relationship-card-addressed`; prefer deriving unaddressed from state
(`state.structuralRelationships.proposals` + `relationshipDismissals` +
`candidateDecisions`) over DOM classes.

**A2 — card-editor Confirm yanks the viewport back to the stale row.**
Live repro: Confirm on a numeric-pattern card's Redact All editor
scrolled the view up to Residency (the state-focused ROW). Root cause:
`scrollFocusedRowIntoView` (render tail) always targets
`state.focus.target.itemId`, but while `structuralCardFocusPending` is
set, the reviewer's working object is the CARD. Fix: when the card
cursor is set, scroll the card element (`[data-proposal-id="..."]`)
into view instead of the row. Do not touch the row-scroll behavior
otherwise (RX-01/RX-04 contracts: `scroll-margin-top` /
`--workspace-chrome-height` — give cards the same scroll-margin if they
lack it).

Acceptance: decide the last unresolved row while cards remain → the
first unaddressed card becomes selected+expanded, viewport moves to it;
confirm a card editor → viewport stays at the cards; Esc/arrow behavior
unchanged; suites green.

## Pass B — features

**B1 — REMOVE ⇧1–5 stage switching** (Andrew's decision, 2026-08-02 —
supersedes the earlier "permanent visual language" framing; Shift+digit
space is being freed). Remove: `handleStageTabKey` and both its call
sites (Review-mode and chrome-mode branches of the keydown pipeline);
the `⇧n` keycaps inside the stage tabs (`renderStageTabs`); the
Navigation card's "⇧1–5 Stages" segment and its tooltip text
(`renderCommandBar`). Keep: tabs clickable, F6/"," region cycling,
equal-width tab layout. Do NOT bind anything new to Shift+digits in
this pass.

**B2 — acronym kind-group section actions.** On the "Possible acronym"
kind-group heading (both sectioned stages), add two green section
actions: `Accept as acronyms` (every remaining acronym proposal takes
its BRIEF value — e.g. ITS) and `Accept written out` (the verbose
value — e.g. Information Technology Services). Per card, these are
exactly the existing preferred actions (digit 1 = full name, digit 2 =
acronym; see `preferredActionsForRelationship`); the section action
runs the chosen one for every remaining card through
`applyRelationshipBulk` (the single choke path — identical audit to
clicking each card). Afterwards advance in DISPLAYED order using the
`runSectionAction` anchor pattern (anchor = the kind group's last card;
continue per A1 if everything is resolved). Skip-and-narrate any card
missing the requested value (RX-18 `setStatus`).

**B3 — high-digit shortcuts on the green section-action buttons**
(agreed design). Reserved digits allocated DOWNWARD from 9: one action
→ ⑨; two → ⑧ ⑨; three → ⑦ ⑧ ⑨. Items keep growing up from ① (chips,
then identities — unchanged). Rules:

- ONE pure assignment function (put it beside
  `identityDigitAssignments` in `recommendations.ts`, or in
  `triageQueue.ts` if imports are cleaner) mapping a section's
  `SectionAction[]` to digits; BOTH the heading renderer (keycap on
  each green button — `keycapButton`) and the digit key handler derive
  from it. Never number a digit surface independently.
- Scope: digits act on the FOCUSED item's containing section (rows), or
  the SELECTED card's kind group (when `structuralCardFocusPending` is
  set — mind the card-targeted-letters precedent: the card cursor, not
  the row focus, is the working object). Keycaps render only on the
  active scope's buttons so the number you read is the number you press.
- Collision rule: if an item's own digit space ever reaches the
  reserved range (rare), the ITEM side truncates first (the identity
  list already truncates past ⑨).
- Execution goes through `runSectionAction` (rows) / the B2 handlers
  (kind groups) — both carry the displayed-order advance.
- `⇧A` (accept section primary) unchanged. Legend gains a conditional
  "7–9 Section actions" segment (`kseg`) when the active scope has
  actions. Digits stay inert in Split Review Mode and open editors.
- New suite (or extension of `recommendations-verification.ts` /
  `triage-queue-verification.ts`): both-ends allocation, 1/2/3-action
  cases, truncation, scope separation.

## Order and delivery

Pass A first (bug pair, one version bump + design-notes entry), then B1,
then B2+B3 together (one bump — B2's buttons are born numbered). Each
pass: full battery, live validation per the ritual above, judgment
calls documented per the standard. If anything here contradicts what
you find in the code (concurrent sessions move fast), the CODE is
current — investigate, then implement the intent, and record the
divergence in the findings.
