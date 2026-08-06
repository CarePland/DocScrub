# Phase 2 — Type Check Integration and Workflow Navigation

**Date:** 2026-08-02 · **Version:** v2026-08-02.25 · **Work item:** Task #49
**Authorization:** Andrew's "Phase 2 – Type Check Integration and Workflow
Navigation" spec, plus two follow-ups the same session: the conditional-
workflow requirement ("make workflow stages conditional") and the final
authorization message (vocabulary reconciliation, collision rule, build
order). Implemented in Andrew's specified order: workflow domain →
FocusNavigator traversal → keyboard pipeline → Type Check UI → tests at
each boundary.

## What shipped

### 1. Workflow domain (`src/domain/FocusState.ts`, `src/engines/navigation/workflow.ts`)

- `WorkflowStage` gained `"type-check"` between `group-check` and
  `item-check`. Canonical order is now Ambiguity → Group → Type → Item →
  QA → Output. Additive for saved `FocusResumePosition` values.
- **One conditional-workflow derivation** — `workflow.ts`:
  `isStageActive(status)` (qa/output always; otherwise
  `unresolvedCount > 0`) and `activeWorkflowStages(context, session)`
  (derived fresh, never cached). Consumers: stage tabs, Shift+←/→
  traversal, the navigator's `moveStage`, `createInitialFocusState`,
  `restoreFocusState`, and `reconcile()` — exactly one rule feeding tabs,
  traversal, progress, focus targets, and completion, per the spec's
  "same active workflow definition" requirement.
- "Contains work" is **resolution-based, not existence-based**, matching
  Andrew's own examples ("No unresolved groups: omit Group Check"): a
  stage whose every item is decided disappears exactly like one that
  never had items.

### 2. Type Check traversal (`stages.ts`, `navigator.ts`, `DetectionGroupingContext.ts`, `Workspace.ts`)

- Traversal units are **semantic types, not candidates**:
  `itemIdsForStage("type-check")` returns the populated type ids in
  `SEMANTIC_TYPE_ORDER`, read from a new OPTIONAL
  `DetectionGroupingContext.semanticTypes` membership list. A type is
  resolved when **every member candidate resolves through the existing
  pipeline** (`candidateResolvedStatus` — group-covered members count as
  done). No type-level durable decision exists anywhere; audit and
  session schemas are untouched.
- The membership is computed **once per load** in
  `Workspace.loadDocument()` — `semanticTypeFor()` over detected type +
  quality categories (`qualityCategoriesOf`, the "filterRules if any,
  else reasons" rule now extracted to `domain/semanticTypes.ts` and
  shared with app.ts's `candidateCategories`) + structural-relationship
  kinds from the merged proposal stream — and exposed via BOTH
  `WorkspaceState.semanticTypes` and the navigator's context. One
  assignment, two consumers, no drift. Relationship *dismissals* are
  deliberately not consulted: membership is decision-blind and stable
  for the document's lifetime.
- `reconcile()`'s stage policy is **deliberately revised**: when the
  current stage leaves the active workflow (its last item was just
  decided, or a bulk/import cleared it), focus relocates to the nearest
  active stage, forward-first. An open Fix this (Not Quite) panel pins
  focus to its group — the transaction outranks stage activity. Among
  stages that remain active, the original "reconcile never changes
  stage" rule still holds.

### 3. Keyboard pipeline (`keymap.ts`, `app.ts`)

- **Shift+←/→ = previous/next ACTIVE stage** (`handleStageArrowKey`,
  dispatching the domain's own `moveStage`, which traverses the active
  list). Placed at the very top of the keydown pipeline — several local
  grammars intercept `Arrow*` wholesale and would shadow a later
  binding. Refusals: text-entry controls keep native Shift+Arrow
  selection; an open Fix this panel refuses with narration; no document.
  Every stage change narrates ("Stage: Type Check — 3 of 5").
- **Shift+digit stage navigation is REMOVED, not deprecated**:
  `handleStageTabKey`, both call sites, the per-tab ⇧n keycaps, the
  "⇧1–5 Stages" legend, and the chrome-gate special case are all gone.
- **Collision resolved deliberately** (Andrew's explicit requirement):
  Category Check's narrowing-column navigation is reassigned whole to
  **⌥(Alt)+Arrows** (`handleFilterColumnKey`; `moveFilterNavigation` and
  everything under it unchanged). Why Alt: the column's grammar uses all
  four arrows as one spatial set (←/→ select within a row, ↑/↓ travel
  between rows); splitting it across modifiers would be worse than
  moving it whole, and ⌥ has no competing binding in the app or (outside
  text entry) the browser on Andrew's platform. Advertised as
  "⌥↑↓←→ Filters" in the By Category legend. *Flagged for real-use
  verdict* — if ⌥ feels wrong in practice, the handler is one small,
  isolated function.
- keymap.ts: shifted arrows no longer resolve to `moveItem` anywhere
  (`unshiftedArrow` guard — the old behavior was an accident of a
  missing modifier check, suite-verified as such). Shift+Tab ("previous
  item") is unchanged. A `type-check` branch resolves unshifted
  arrows/Tab/Home/End to `moveItem`; decision letters deliberately
  resolve to nothing there (type-level letters are bulk actions needing
  candidateId lists the pure resolver cannot build — UI-owned, same
  division as C/R's editors everywhere else).
- Vocabulary confirmed per Andrew's reconciliation: **K=Keep, C=Change,
  R=Redact, I=Ignore; Q only where Not Quite exists. No C→N rebind.**

### 4. Type Check UI (`app.ts`, `index.html`)

- Cards per populated type (label, entity count, occurrences, remaining
  count / green "✓ Reviewed"), in an auto-fill grid; only populated
  types render. The focused card expands (expansion IS focus) into the
  per-type surface below the grid.
- Per-type surfaces: **People** = member rows + the full evidence panel
  (`renderCandidateDetailPanel`) for the active member — the spec's
  "full evidence panel with individual review", reusing Item Check's own
  panel. **All other types** = compact rows (value, count, decision
  state, K/C/R/I buttons). Every type gets a bulk bar — Keep/Ignore
  remaining as one `bulkApplyDecision`; Change…/Redact… via a new
  `type-members` inline-editor scope confirming through the same
  command. *Judgment call, disclosed:* the spec names bulk for
  emails/phones/dates-terms; one uniform bar everywhere is calmer than
  remembering which types have it, and Keep-remaining is as meaningful
  for Acronyms as for Dates.
- Member cursor (split-cursor precedent): ↓/Enter enters the member
  list, ↑/↓ move (Up past the first backs out — the panel grammar),
  K/C/R/I act on the cursor member, decisions auto-advance to the next
  unresolved member (wrapping — bounded on-screen set, the Fix this
  precedent), Esc returns to the card level, Tab leaves the item (next
  type). Command-bar legend switches between card-level ("Keep
  remaining") and member-level ("Keep member") vocabulary contextually.
- Stage tabs render only the active workflow (plus, transitionally, the
  stage focus is on). Tabs remain mouse-clickable; `focusStage` remains
  ungated at the command level ("do not invent wizard-style
  progression" survives for explicit jumps — no UI path targets hidden
  stages, but nothing at the domain level refuses one).

## Real bug found by the battery (not by inspection)

`FocusResumePosition.ts`'s `KNOWN_STAGES` was a **hand-maintained
duplicate** of `WORKFLOW_STAGE_ORDER`'s members. Adding `"type-check"`
to the union made every save file captured while focused on the new
stage fail deserialization ("invalid stage") — caught by
`audit-exporter-verification` (save/reload equivalence), the exact drift
class "derive, don't duplicate" exists to prevent. Fixed by deriving
from the canonical order; future stage additions are covered
automatically.

## Deliberate pin updates (suites encode superseded behavior)

- `focus-navigator-verification` (3 checks): initial focus now starts on
  the first ACTIVE stage, `moveStage` clamps at the active list's
  boundary, and `moveStage` from an inactive stage lands on the next
  active one — the old pins asserted focus parked on an EMPTY ambiguity
  stage, which is precisely what the conditional workflow eliminates.
- `workspace-integration` (2 checks): six stage statuses; a resume
  position naming a now-workless (hidden) stage relocates to an active
  stage instead of returning to a stage the reviewer can no longer see.

## Judgment calls and disclosures

1. **`semanticTypes.ts` moved `src/ui/` → `src/domain/`** (contents
   unchanged; still the single source of truth per the authorization).
   The navigation engine now consumes the vocabulary, and engines
   importing from `ui/` would invert the repo's layering; `domain/` is
   where engine-consumed pure vocabulary already lives (NotQuite.ts,
   StructuralRelationship.ts). Alternatives rejected: engines→ui import
   (inverted dependency); plumbing the vocabulary as anonymous data
   (would re-state the display-order policy at every call site).
2. **"Item Check should therefore contain only unresolved candidates"**
   was implemented at the workflow level — stage presence, counts, and
   focus targets all derive from unresolved work, and Item Check
   disappears entirely when nothing is left — but Item Check's internal
   list still *contains* decided candidates behind its existing
   narrowings (Resolved/Changed chips, Previous decision, search).
   Removing them outright would break Milestone 2 features Andrew
   explicitly kept (decided-item filters, `previousDecided`
   navigation). If the stricter reading is wanted (e.g. default the
   Review State narrowing to "To Review"), it is a small follow-up.
3. **Reversibility consequence of conditional stages** (flagged, not
   resolved): once every candidate is resolved, no review surface
   remains to change a decision from — the workflow is QA → Output.
   Re-deciding stays possible while any stage still shows work. This is
   the faithful reading of "the reviewer should not have to enter an
   empty stage merely to confirm that nothing is there"; if real use
   wants a way back in after completion, that should be a deliberate
   affordance, not a resurrected always-on tab.
4. **Completed types stay visible as cards** (muted, "✓ Reviewed")
   rather than vanishing: type membership is decision-blind (the
   stability contract), completing a category shouldn't reshuffle the
   card grid under the reviewer, and a completed type remains
   re-enterable for re-deciding while the stage is visible. The STAGE
   disappears when all types complete.
5. **Type Check and Item Check are both active while candidate work
   remains** — Type Check groups the same unresolved pool Item Check
   lists individually. "Nothing left after Type Check → no Item Check"
   describes the terminal state (resolve everything by type and Item
   Check never demands attention), not a partition of candidates.
6. **Digits are not bound on Type Check cards this phase** (1–9 retain
   their existing meanings elsewhere; the type surface's bulk actions
   are letters + buttons). Cheap follow-up if numbered accelerators are
   wanted here too.

## Verification

- `tsc --noEmit` and full `npm run build` clean.
- **38 suites, zero failures** (full battery re-run). New:
  `workflow-navigation-verification.ts` — **40/40** — covering the
  conditional-workflow derivation, type-check traversal/resolution over
  real pipeline output, `moveStage` skipping hidden stages + boundary
  clamps, `reconcile()` relocation + the open-Fix-this pin, initial
  focus/resume landing on active stages, the keymap's released shifted
  arrows + type-check bindings, and Workspace end-to-end (one
  assignment; full completion relocates focus to QA and shrinks the
  workflow to QA/Output). Updated deliberately:
  `focus-navigator-verification` 107/107, `workspace-integration` 63/63,
  `audit-exporter-verification` 63/63, `semantic-types-verification`
  15/15 (import path only).

## Browser validation — PENDING (Andrew)

Cowork-mode sessions cannot reach the app from Claude in Chrome (known
sandbox/network isolation). Please run `start-server.command`, hard-refresh
to **v2026-08-02.25**, and click through:

1. Load a real document → the stage tabs show ONLY stages with work (no
   ⇧n keycaps); a document with no ambiguity proposals should not show an
   Ambiguity tab at all.
2. Shift+→ / Shift+← walk the visible tabs in order, with the status
   region narrating "Stage: … — n of m"; Shift+1–5 does nothing.
3. Type Check: cards match the document's actual types (only populated
   ones); click a card → per-type surface; People shows the full
   evidence panel; a compact type (Emails/Dates) shows dense rows.
4. ↓ enters the member list, ↑/↓ move, K decides + advances with the
   pulse, C opens the inline editor, Esc backs out, Tab moves to the
   next type card. Up from the first member returns to card level.
5. Type-level K ("Keep remaining") on a small type → whole card flips to
   "✓ Reviewed"; when the last type completes, the Type Check tab
   disappears and focus lands on the next stage with work.
6. Item Check By Category: plain arrows still move the Results grid;
   ⌥(Option)+Arrows now steer the Review State/Filter/category column
   (legend says "⌥↑↓←→ Filters"); Shift+←/→ changes stages even here.
7. Decide the final candidate of the whole document → focus relocates to
   QA and only QA/Output tabs remain.
8. Refresh mid-review → the document resumes on an ACTIVE stage (a save
   made while on a since-completed stage relocates instead of opening a
   hidden tab).
9. Fix this open → Shift+←/→ refuses with the "Finish or exit Fix this"
   status message.
10. Typing in any text field (search, inline editor): Shift+←/→ selects
    text normally, ⌥+arrows move by word — neither navigates.
