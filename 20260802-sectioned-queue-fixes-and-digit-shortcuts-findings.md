# Sectioned-Queue Fixes + Section-Action Digit Shortcuts — Findings

Implementation report for the 2026-08-02 prompt
`20260802-sectioned-queue-fixes-and-digit-shortcuts-prompt.md`.
Versions shipped: **v2026-08-02.26** (Pass A), **v2026-08-02.27**
(Pass B2+B3), and **v2026-08-02.28** (Pass C — the active-work model
correction Andrew authorized after reading §6 below; see §8). Pass B1
required no work — see *Divergences* below.

Verification battery, all passes: `npx tsc --noEmit` clean, `npm run
build` clean, **40/40 suites green** (39 before this work; one new suite),
zero regressions, no expectation weakened. Live browser validation was
performed against `http://localhost:8000` on the served build
(v2026-08-02.28 confirmed in `dist/ui/version.js` and on the page).

---

## 1. What shipped

### Pass A — the rows↔cards seam (v2026-08-02.26)

Both reported bugs share one root cause: on the sectioned-queue stages
(Ambiguity Check; Item Check's Triage view) the rows and the structural
relationship cards render as ONE displayed collection, and the arrow-key
grammar already treats them that way — but the post-decision advance and
the viewport scroll still only knew rows.

**A1 — post-decision advance dead-ended at the last row.** Fixed at both
row-advance paths:

- `dispatchReviewWithVisibleAdvance` (the per-decision choke point): when
  `advanceWithinVisibleList` returns null (every visible row resolved), the
  advance now continues into the first UNADDRESSED structural card instead
  of re-selecting the just-decided row.
- `runSectionAction` (the green section buttons): same continuation when
  the section's anchor advance finds no unresolved row.

Both go through one new helper, `continueIntoStructuralCards(state)`, which
sets `structuralCardFocusPending` and returns — the caller's existing single
`render()` then paints the card born selected + expanded, and the render
tail's `pendingCardId` restore supplies DOM focus. This is the
DETERMINISTIC-RENDER pattern, and it is strictly cheaper than
`advanceStructuralCursor`'s two renders (that one runs *after* its caller's
render, so it has no choice).

"First unaddressed card" is derived from **state**, not from the rendered
tree's `relationship-card-addressed` class, because the advance runs before
the render that would carry fresh classes — a DOM read would answer from the
previous frame. Displayed order comes from a new pure function,
`structuralCardDisplayOrder` (triageQueue.ts), which reproduces
`renderStructuralRelationships`'s own layout rule (kind groups in
first-appearance order, input order preserved within each). The module that
decides what the reviewer *sees* is the module the keyboard consults.

Two filters mirror the renderer exactly so the cursor can never point at a
card that isn't on screen: dismissed proposals, and proposals whose members
are absent from detection.

`continueIntoStructuralCards` is deliberately **inert when a card already
holds the cursor** — that means the reviewer is working the card half, where
`advanceStructuralCursor` owns the advance (forward-from-current, then
backward: a strictly better answer than "first unaddressed"). Without this
guard, every card decision would take both advances and briefly expand the
wrong card between two renders.

**A2 — card-editor Confirm yanked the viewport to the stale row.**
`scrollFocusedRowIntoView` now scrolls the CARD (`[data-proposal-id=…]`)
whenever the card cursor is set. While that cursor is set the card *is* the
reviewer's working object — the row cursor is merely parked wherever the row
half was left, often far above and already decided. The scroll now follows
the same cursor the decision letters, detail expansion, and ⇧A already
follow. **No CSS was needed**: cards carry `item-row relationship-card`, so
RX-04's `.item-row { scroll-margin-top: calc(var(--workspace-chrome-height)
+ …) }` already clears the sticky chrome for them. Same RX-01
`block: "nearest"` least-motion contract; a stale cursor falls through to the
row rather than scrolling nowhere.

### Pass B2 — acronym kind-group section actions (v2026-08-02.27)

The "Possible acronym" kind-group heading now offers two explicit reviewer
decisions:

- **Accept as acronyms** — every remaining proposal standardizes on its
  brief value (e.g. `ITS`).
- **Accept written out** — the verbose value (e.g. `Information Technology
  Services`).

Per card these are exactly the existing preferred actions (digit ① =
written-out, digit ② = acronym), executed through `applyRelationshipBulk` —
the single choke path — so a group press is provably N presses of the card
buttons: same descriptor, same command, same audit. Cards missing the
requested value are skipped and narrated (RX-18), with a reason that names
*which* side was missing.

The descriptor is selected by a new **role tag**
(`PreferredActionRole: "written-out" | "acronym"`), never positionally.
This matters: a card with no written-out member returns `[acronym]`, where
index 0 is the acronym. Positional selection would silently apply the wrong
side; role selection skips and narrates. The suite asserts exactly this.

Advance after the action uses the displayed-order anchor pattern: each
`applyRelationshipBulk` carries `advanceStructuralCursor`, so after the loop
the cursor sits where the last processed card's advance left it, and
continues into the stage's first undecided row when the group is finished.

### Pass B3 — section-action digit shortcuts (v2026-08-02.27)

Green section buttons are numbered **downward from ⑨** (one → ⑨; two → ⑧ ⑨;
three → ⑦ ⑧ ⑨) while items keep numbering **upward from ①**. Two
populations, one keyboard row, growing toward each other from opposite ends —
so neither has to know the other's size to stay stable.

- **ONE assignment function**: `sectionActionDigitAssignments` in
  triageQueue.ts, generic over the descriptor type. Both the heading
  renderer (keycaps via `keycapButton`) and the key handler
  (`handleSectionActionDigitKey`) derive from it. Row sections hand it
  declared `SectionAction`s; kind groups hand it relationship descriptors;
  neither surface invents numbering.
- **Scope**: the focused row's section/tier, or — when
  `structuralCardFocusPending` is set — the selected card's kind group (the
  card-targeted-letters precedent). One derivation,
  `activeScopeSectionActions`, feeds the handler and the legend.
- **Keycaps render only on the active scope's buttons**, so the number read
  is the number pressed.
- **Collision rule** implemented literally: `identityDigitAssignments` gained
  a `ceiling` parameter (default 9, so every prior call is unchanged), and
  both its call sites pass `itemDigitCeilingBeside(sectionActionCount)`. The
  item side truncates first, and `handleSectionActionDigitKey` is ordered
  *before* `handleIdentityLinkKey` so the keystroke agrees with the paint.
- **Legend** gains a conditional segment naming the real range — "9",
  "8–9", or "7–9 Section actions" — only when the active scope declares
  actions.
- **Inert** in Split Review Mode, open inline editors, and an open Fix this
  panel; with modifiers; and where no scope declares actions.
- One CSS rule added: a numbered section button carries both
  `.preferred-action` (whose keycap is the blue accent) and
  `.triage-accept-all` (green). The keycap now takes the section green so
  "green means section-level" stays one signal.

An **invariant** the numbering depends on: a policy declares an Accept All
*or* tier actions, never both, so one heading's buttons come from one source
and one numbering pass. Today that holds by construction (the triage policy
declares no `tierActionsFor`; the ambiguity policy's `acceptFor` returns
undefined). The renderer additionally refuses to number a multi-tier
section's title line, so a future policy that broke the invariant fails
visibly rather than minting two ⑨s. The suite tests the concatenation
property directly.

---

## 2. Divergences from the prompt (the code was current)

**B1 was already done.** `handleStageTabKey`, its two call sites, the ⇧n tab
keycaps, and the Navigation card's "⇧1–5 Stages" segment are all absent from
the current tree — removed in **v2026-08-02.25** (Phase 2, same day) and
replaced by ⇧←/⇧→ relative stage movement, with the removal documented at
each former site (`renderStageTabs`, `renderCommandBar`,
`handleStageArrowKey`, and the keydown pipeline's own note). Tabs remain
clickable; F6/"," region cycling is intact; nothing new is bound to
Shift+digits. **No code change was made for B1.** Per the prompt's own rule,
the code is current and this is recorded rather than re-implemented.

**"Accept All Remaining" is not rendered on acronym kind groups.** See
judgment call J1.

---

## 3. Judgment calls

**J1 — Dropping "Accept All Remaining" from acronym kind groups only.**
*Assumption*: on acronym groups the new pair strictly supersedes it.
*Reasoning*: `acceptAllInRelationshipKind` ran each card's FIRST preferred
action, which on this kind is the written-out value — i.e. it already *was*
"Accept written out", under a name that didn't say so. Rendering all three
would put two behaviorally identical green buttons side by side, which is
the decision-tax this queue exists to remove, and would also consume a third
digit (⑦) for a duplicate.
*Alternative considered*: render all three and accept the duplicate.
*Reviewer impact*: one degenerate case loses coverage — a card whose only
preferred action is the acronym (no written-out member) was accepted by
Accept All Remaining and is now skipped by "Accept written out", narrated,
and still covered by "Accept as acronyms". Other kinds keep Accept All
Remaining unchanged. **Trivially reversible** if you want all three.

**J2 — Button order within the acronym pair.** "Accept as acronyms" (⑧)
then "Accept written out" (⑨), following the prompt's own ordering.
*Consequence worth knowing*: because digits allocate downward, the
**rightmost** button always carries ⑨ on every heading — so ⑨ is the
learnable "section's main move", and here that is "Accept written out",
which matches the card's own digit ①. If you'd rather ⑨ meant "Accept as
acronyms", swap the two entries in `relationshipKindActions`; nothing else
changes.

**J3 — Item digit ceiling is computed from the item's OWN section, not from
whatever currently holds focus.** *Reasoning*: a row's numbers must not
renumber as the cursor moves past it. A number that changes while you look
at it is worse than a number you cannot press. *Impact*: an item in a
three-action section is capped at ⑥ even at moments when no section button
is showing a keycap. Reaching ⑥ requires a candidate with six-plus identity
options; this is the "rare" case the prompt anticipated.

**J4 — Numbering `Accept All Remaining` too, not only the new pair.** The
prompt numbers "the green section-action buttons"; Accept All Remaining is
one. *Reasoning*: a uniform rule ("the green buttons are 9, 8, 7") is
learnable; "some green buttons are numbered" is not. *Impact*: Item Check's
Triage sections gain ⑨ where they previously had none.

**J5 — A 4th section action would render unnumbered rather than pushing the
reserved range to ⑥.** No declared vocabulary has four today
(`MAX_NUMBERED_SECTION_ACTIONS = 3` is both the current maximum and the
deliberate floor of the reserved range). Growing the range downward would
start eating digits items realistically reach.

**J6 — `continueIntoStructuralCards` leaves the row cursor parked on the
just-decided item** rather than clearing or moving it. The domain focus
model has no notion of a card, and the parked row is still a valid, visible
selection. Everything the reviewer perceives as "where I am" — expansion,
letters, ⇧A, digits, and now the scroll — follows the card cursor while it
is set.

---

## 4. Verified by suite (Node, no DOM)

New suite: **`verify/section-action-digits-verification.ts`** (40 checks) —
both-ends allocation; the 1/2/3-action cases; truncation at both ends; the
collision rule (item ceiling always strictly below every reserved digit, for
every count); the merge property that keeps one heading to one digit space;
and the preferredActions role tags, including the case that shows why
positional selection would be wrong.

Extended: **`verify/triage-queue-verification.ts`** (53 → 58 checks) —
`structuralCardDisplayOrder`: kind grouping by first appearance, input-order
preservation, single-kind passthrough, empty input, and permutation
(no drops or duplicates).

Full battery, both passes: 40/40 suites, zero regressions.

---

## 5. Verified live in the browser

Fixture: `/fixtures/browser-validation/semantic-relationships-phase2.docx`,
build v2026-08-02.27.

- **B2 rendering** — the "Possible acronym" heading shows "Accept as
  acronyms" and "Accept written out".
- **B3 numbering, row scope** — with a row focused, its section showed
  ⑦ Use written-out forms / ⑧ Keep abbreviations / ⑨ Redact all; other
  sections' buttons unnumbered; legend read "7–9 Section actions".
- **B3 numbering, card scope** — ArrowRight from the last row set the card
  cursor: row-section keycaps disappeared, the kind group took ⑧ Accept as
  acronyms / ⑨ Accept written out, legend switched to "8–9 Section actions".
  Exactly one scope shows keycaps at a time.
- **B3 execution** — pressing `8` ran "Accept as acronyms": both members
  took a Change decision through the ordinary path, the card became
  addressed, and the narration/progress updated.
- **A1** — with the pool filtered so one unresolved row remained, deciding
  it moved the cursor onto the first unaddressed card, which rendered
  selected, expanded (evidence + member list), and DOM-focused, with the
  numbered scope following. Previously focus stayed on the decided row.
- **A2** — instrumenting `Element.prototype.scrollIntoView` across a card
  editor's Confirm render showed the **card** as the scroll target, not the
  stale focused row. The subsequent row-targeted scrolls in the same
  sequence are `advanceStructuralCursor`'s correct cards→rows continuation
  once no unaddressed card remained.
- **Unchanged behavior spot-checked** — cards→rows continuation after the
  last card; Esc/arrow grammar; section-action advance to the next
  unresolved row in displayed order.

Note on access: the app now sits behind `previewGate.ts` (added
2026-08-01). Validation used the gate's own documented session flag
(`sessionStorage["docscrub-preview-access"] = "granted"`), not the
password form.

---

## 6. Defect discovered during validation — FIXED in Pass C (see §8)

*(Left as originally written; Andrew authorized the architectural fix in
response, which §8 records.)*


**A stage whose only remaining work is a structural relationship card
disappears from the workflow, and the proposal becomes unreachable.**

Reproduction (v2026-08-02.27, the browser-validation fixture):

1. Load the fixture. Ambiguity Check shows 1 unresolved row and 1
   unaddressed "Possible acronym" card (`rel-acronym-NSC`).
2. Decide the row.
3. The Ambiguity Check **tab vanishes** and focus relocates to Type Check —
   while the card is still unaddressed.
4. Repeat on Item Check's Triage view (decide all 11 rows): the Item Check
   tab vanishes too. Tabs are then **QA and Output only**, and the
   unaddressed proposal cannot be reached from anywhere.

Cause: Phase 2's conditional-workflow derivation (`isStageActive` /
stage completion, `engines/navigation/workflow.ts` + `stages.ts`) counts
candidate items only. Structural relationship proposals are rendered as
part of two stages' collections but are invisible to the stage work model,
so a stage reads "complete" with unreviewed proposals still on screen —
and `reconcile()` then relocates focus off it and the tab disappears.

Severity: **correctness**, not style. The reviewer can be walked past
proposals the application itself raised, with no indication anything was
skipped, and Output's "review is not complete" line does not mention them.

Why it is not fixed here: the fix belongs in the domain's stage-work
derivation, which this prompt explicitly scopes out ("`keymap.ts` /
`FocusNavigator` / `stages.ts` are a faithful domain port — all of this work
is UI-layer"). Changing what "this stage has work" means also touches
tabs, traversal, progress, focus reconciliation, and completion through the
one derivation Phase 2 deliberately unified. That is your call, not a
side effect of a bug-fix pass.

**Interaction with A1**: this is also why A1 cannot fire in the specific
case where the last unresolved row is also the stage's last unresolved
*item* — reconcile() relocates focus off the stage before the UI advance
runs, so `continueIntoStructuralCards` correctly declines (no sectioned
queue at the new focus). A1 works as specified in every case where the row
half is exhausted but the stage is not complete (filters/search/Category
Check narrowing active, or a `recommendationsOnly` section leaving items
undecided) — validated live. Once the stage-work model counts proposals,
A1 will cover the remaining case with no further change.

Suggested shape if you want it: fold "unaddressed, undismissed structural
proposals belonging to this stage" into the same derivation that answers
`hasItems`/`unresolvedCount`, so tabs, counts, traversal, and completion all
learn about cards at once — one derivation, as Phase 2 intended.

---

## 7. Files touched

| File | Change |
|---|---|
| `src/ui/triageQueue.ts` | `structuralCardDisplayOrder`; `sectionActionDigitAssignments`, `itemDigitCeilingBeside`, and the two range constants |
| `src/ui/recommendations.ts` | `identityDigitAssignments` gained an optional `ceiling` (default 9 — every prior call unchanged) |
| `src/ui/preferredActions.ts` | `PreferredActionRole` + `role` tag on acronym descriptors |
| `src/ui/app.ts` | A1 continuation (2 paths) + `firstUnaddressedStructuralCardId`; A2 card scroll; `QueueSectionAction` + `headingSectionActions` + `relationshipKindActions` + `activeScopeSectionActions` + `itemDigitCeilingFor` + `handleSectionActionDigitKey`; kind-group and sectioned-queue heading renderers; `acceptAllInRelationshipKind` role parameter; legend segment; ceiling at both identity-digit call sites |
| `index.html` | green keycap treatment for numbered section-action buttons |
| `src/ui/version.ts` | `.25` → `.26` → `.27` |
| `docs/architecture/design-notes.md` | entries for `.26` and `.27` |
| `verify/section-action-digits-verification.ts` | new suite (40 checks) |
| `verify/triage-queue-verification.ts` | +5 checks |

Domain modules (`keymap.ts`, `navigator.ts`, `stages.ts`, `FocusNavigator`)
untouched in Passes A/B, as that prompt required. Pass C changes
`stages.ts` and `workflow.ts` under Andrew's explicit authorization — see
§8.

---

## 8. Pass C — the active-work model (v2026-08-02.28)

Andrew's direction, verbatim: *"The structural-proposal issue should be
treated as an architectural defect rather than a UI bug. The active
workflow should represent all remaining review work, not only unresolved
candidates. … a stage remains active while it contains unresolved
candidates, unresolved structural proposals, or any future review
artifacts requiring reviewer action. Tabs, traversal, progress,
reconciliation, and completion should continue to derive from this single
definition."*

### The shape

`navigation/stages.ts` gains a **second axis of work** beside traversable
items, with a deliberately identical shape:

| Items (existing) | Artifacts (new) |
|---|---|
| `itemIdsForStage(stage, context)` | `reviewArtifactIdsForStage(stage, context, session)` |
| `isItemResolved(stage, id, ctx, session)` | `isArtifactResolved(stage, id, ctx, session)` |

A future artifact kind is **two switch cases in one file**, and nothing
downstream learns a new concept — which is what "or any future review
artifacts" asks for structurally rather than by promise.

`StageStatus` gains `artifactCount` / `unresolvedArtifactCount`.
`isStageActive` — still the one membership rule — becomes
`REQUIRED || unresolvedCount + unresolvedArtifactCount > 0`, written as a
sum over the status's own fields so it never changes again as artifact
kinds are added.

### Four decisions worth your eye

**C1 — Proposals belong to Ambiguity Check.** That stage renders them
unconditionally (category-first is its only presentation, and it already
handles rows-empty-but-cards-present). Item Check's Triage view renders the
same cards, but *only in that view* — a UI presentation toggle the domain
must never depend on. Counting them under Item Check would either couple
the domain to a view mode or overstate that stage's work. Consequence: Item
Check may complete and disappear while a proposal is outstanding; the cards
stay reachable because Ambiguity Check remains active.

**C2 — Separate count fields, not widened ones.** `itemCount` /
`unresolvedCount` mean *traversable items* to every existing consumer — the
navigator walks exactly `itemCount` things, and `Workspace` derives
`reviewedCandidateCount` as `totalCandidateCount - unresolvedCount`.
Folding artifacts into them would have silently corrupted that arithmetic.
`hasItems` likewise keeps its traversal meaning.

**C3 — Artifacts are NOT added to `itemIdsForStage`.** Items are traversal
units: `FocusState.target.itemId` holds one and every stage renderer
resolves one to a row. A proposal is neither — the UI gives it a separate
cursor (`structuralCardFocusPending`) precisely because it is a different
kind of object. Adding proposalIds to the item list would put focus targets
into the model that no row renderer can resolve.

**C4 — "Resolved" for a proposal = every member carries a
`CandidateDecision`.** This is exactly the `addressed` test app.ts's card
renderer uses for its green treatment, chosen so the stage and the card can
never disagree — a stage vanishing while a card still looked unaddressed is
the whole bug. It is a *deliberate divergence* from this file's own
"never re-demand work already covered by a resolved entity group" rule
(`candidateResolvedStatus`), which items use: adopting that here would let
the domain call a proposal done while its card still rendered unaddressed —
the same divergence in the other direction. **Recorded rather than
silently chosen**: if a group-covered proposal ever strands a reviewer,
unify *both* sides on `candidateResolvedStatus` in one pass, never one
side alone.

### One behavioral change beyond the literal ask

**QA/Output availability now derives from the same definition.** It read
Item Check's completion alone — a second, narrower rule sitting beside the
workflow's own, and one that could not see an artifact, which is how a
document could reach an available Output with an unaddressed proposal. It
now asks the same question of every work stage: is anything left. For
candidate-only documents this changes nothing in practice (group / type /
ambiguity items resolve as their member candidates do, so Item Check
finishing last is the norm) — and the suites confirm it. Flagged because
it widens a gate rather than merely counting more things.

The Output stage's message follows: it named Item Check candidates only, so
a document held back by a proposal read *"0 item(s) still unresolved"* — a
sentence that contradicted its own gate and hid the blocker. It now names
each axis that actually has work.

Progress follows too: `documentScores.ts` pools artifacts with items in the
Review metric. Excluding them would have let Review read 100% while the
workflow correctly showed work remaining — two answers to one question,
which is the divergence this pass removes.

### Verified by suite

`verify/workflow-navigation-verification.ts`: **40 → 64 checks.** New
coverage pins the model at the level the bug lived at — artifact ids come
from the context and no other stage owns them; a context without proposals
degrades to previous behavior; every ambiguity row resolved with the
proposal outstanding leaves `completion: "unresolved"` and the stage
*active* (with a same-session control against a proposal-free context that
does complete); deciding the members completes it; a **dismissal removes
the proposal from the model entirely** rather than reporting it resolved,
and decides nothing; `hasItems` keeps its traversal meaning; and the
QA/Output gate refuses while any work stage is unresolved, with QA and
Output agreeing.

`verify/document-scores-verification.ts`: 45 → 48, including "every item
decided but a proposal outstanding is not 100% reviewed".

Full battery: 40/40 suites, zero regressions.

### Verified live — the original repro, re-run

Same fixture, build v2026-08-02.28:

- Ambiguity Check now opens reading **(2/2)** — one row plus one proposal —
  where it previously read (1/1).
- Deciding the last candidate row: **the tab survives**, now reading
  **(1/2)**, and focus stays on the stage.
- **A1 fires as you predicted.** With reconcile no longer removing the
  stage, the advance continues into the card: selected, expanded (evidence
  + members), DOM-focused, with the numbered scope on its kind group
  (⑧ ⑨). The edge case that could not fire in Pass A now does, with no
  further change to Pass A's code.
- Output refuses and says why: *"Review is not complete yet -- 10 item(s)
  still unresolved in Item Check; 1 relationship proposal(s) still awaiting
  review in Ambiguity Check."*
- Addressing the proposal ("Accept written out") is what finally retires
  the Ambiguity Check tab, and focus relocates forward to Type Check.

### Files touched in Pass C

`src/domain/FocusState.ts` (StageStatus fields + the revised `available`
contract) · `src/engines/DetectionGroupingContext.ts` (optional
`structuralRelationships`) · `src/engines/navigation/stages.ts` (the
artifact axis, completion over both axes, the QA/Output gate) ·
`src/engines/navigation/workflow.ts` (membership rule) ·
`src/workspace/Workspace.ts` (context wiring + `readiness
.unresolvedArtifactCount`) · `src/ui/app.ts` (tab label, Output message) ·
`src/ui/documentScores.ts` (Review metric) · `src/ui/version.ts` ·
`docs/architecture/design-notes.md` · two suites.

Note: `stages.ts` was concurrently extended by another session during this
pass (`reviewableItemIdsForStage` / `isAnsweredUpstream`). Both changes
coexist cleanly — that function narrows the item *queue*, this one adds the
artifact *axis* — and its own doc comment already references
`reviewArtifactIdsForStage` as the shape it mirrors. It is not yet wired
into `computeStageStatus`; left untouched, as it is not mine.
