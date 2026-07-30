# Milestone 2 — Review at Scale

Implements Andrew's Milestone 2 instruction in full: Item Check search,
advanced filters, bulk operations, better sorting, workspace navigation,
and an always-visible Command Bar. Also records his explicit resequencing
decision — moving `ReplacementRuleEngine` out of the immediate next phase
and into Milestone 3 — in
`docs/architecture/review-workspace-reconstruction.md`'s roadmap (Phase B).

## What was implemented

**Item Check Search** (`src/ui/itemCheckQuery.ts`, wired into
`src/ui/app.ts`'s `renderItemCheckToolbar`) — a single free-text box
matching, case-insensitively, against every field Andrew named: candidate
text, replacement text, category, review state, likelihood, ambiguity, and
entity type. Updates the workspace on every keystroke. Because this app
re-renders its entire DOM tree from scratch on every state change (an
established, deliberate simplicity trade-off since Phase 10), a naive
keystroke-triggered re-render would destroy and recreate the search
`<input>` every time, losing focus and cursor position after the first
character. `render()` now restores both from a small piece of pending state
captured just before each re-render — the one genuinely new plumbing this
feature needed.

**Advanced Filters** — eight combinable preset chips (Unreviewed only,
High confidence, Ambiguous, People, Organizations, Ignored, Renamed,
Redacted), ANDed together when more than one is active. "High confidence"
reuses the same 90% threshold the candidate badges already use rather than
inventing a second number. "Organizations" required a real design decision
— see below.

**Bulk Operations** — checkboxes on every Item Check row, a selection
toolbar (count, Select all visible, Clear selection), and Keep/Rename/
Redact/Ignore selected buttons, all backed by a new `review.bulkApplyDecision`
command.

**Better Sorting** — a select control (List view only) offering all five
of Andrew's named orders plus their natural opposite directions:
confidence, occurrence count, alphabetical, review state, entity type.

**Workspace Navigation** — Next undecided / Previous decision (`]`/`[`,
scoped to the currently visible filtered list), Next ambiguity (jumps to
Ambiguity Check's own next-unresolved item from anywhere), and Jump to
category (a dropdown that switches straight to Item Check's By Category
view, pre-filtered).

**Command Bar** — a persistent bar rendered on every stage (Andrew's
"always," not Python's narrower Group-Check-only scope): the current
stage's keyboard legend, the current Item Check selection count, and the
navigation quick-jump actions above.

## Architectural decisions

1. **`itemCheckQuery.ts` is a new, separate pure module,** not inline
   ephemeral state in `app.ts` the way Milestone 1's smaller
   `categoryReviewState`/`categoryFilter` were. This milestone's
   search/filter/sort logic is meaningfully more complex — a multi-field
   search, an eight-way combinable preset set, five sort orders — and
   deserves independent unit-testability without a DOM. It remains
   UI-layer, ephemeral, and non-domain per v0.2 §7.3: it narrows and orders
   an already-computed candidate list and never reads or writes
   `ReviewSession`.
2. **Scoped to Item Check only, not Ambiguity Check.** Ambiguity Check's
   candidate set is inherently small (only candidates with 2+ plausible
   group homes); "review documents with several thousand candidates" is
   specifically an Item Check problem. Bulk multi-select follows the same
   scoping.
3. **"Organizations" required an honest design call.** This pipeline's
   `DetectionEngine` never assigns a `detectedType` of `"organization"` —
   confirmed directly against the code, which only ever produces person,
   email, phone, cin, and long_numeric_id (a faithful port of Python's own
   detectors; neither oracle has NER-based organization detection). A
   literal `detectedType === "organization"` filter would silently match
   zero candidates forever. Instead, "Organizations" matches candidates
   carrying any of `CandidateQualityEngine`'s organization-signaling
   evidence categories (department-organization, institution-acronym,
   institution-term, organization-suffix) — the closest honest match to
   Andrew's request given what this pipeline actually detects, documented
   in `itemCheckQuery.ts` rather than built as a dead control.
4. **`review.bulkApplyDecision` generalizes Feature 001's group-level bulk
   commands** (Confirm/Reject/Flatten Group) from a group's fixed
   membership to an arbitrary reviewer-selected candidateId list, applying
   one decision to every listed candidate via the exact same
   `decideCandidate()` helper every other command uses. This is also the
   answer to "preserve undo": nothing about a bulk-applied decision is any
   less reversible than a direct one — both are a plain `CandidateDecision`
   a reviewer can freely re-decide at any time. No new undo mechanism was
   built (none exists anywhere in this codebase yet — `history.undo` is
   still honestly rejected by `CommandDispatcher`), and none was needed.
   Unlike `applyDecisionReuse` (Feature 002), a bulk action DOES overwrite
   an existing decision — it is a direct, deliberate reviewer action, not a
   passive import.
5. **`previousDecided` is a new, small domain addition** (`ItemMoveDirection`
   in `Commands.ts`, a case in `navigator.ts`'s `moveWithinItems`), needed
   because "Previous decision" has no existing mirror in the
   `nextUnresolved`/`previousUnresolved` pair. `navigator.ts`'s
   `findUnresolved()` was refactored (behavior-preserving) into a generic
   `findByPredicate()` so the new direction reuses the exact same
   wrap-around scan logic with the opposite predicate, rather than
   duplicating it. A symmetric `nextDecided` was deliberately not added —
   no UI consumer needs it, and this file's own precedent already warns
   against carrying speculative, unused command vocabulary.
6. **"Next undecided"/"Previous decision" are UI-composed, not direct
   dispatches of the domain's own `moveItem(nextUnresolved/previousDecided)`.**
   `FocusNavigator`'s traversal list is the stage's FULL candidate list,
   with no notion of Milestone 2's UI-only search/filter narrowing
   (correctly so — Phase 9 already established that `FocusNavigator` must
   never depend on rendered/UI-only state). Jumping within the full list
   while a filter is active would land a reviewer on an item they can't
   currently see, contradicting Andrew's own "navigation should require
   minimal scrolling... a reviewer should never feel lost" success
   criterion. `goToAdjacentInVisibleList()` in `app.ts` performs the same
   wrap-around scan directly over the currently filtered/sorted list,
   dispatching the existing `navigation.selectItem` command to land on the
   result. "Next ambiguity," by contrast, dispatches the domain's own
   `moveItem(nextUnresolved)` directly, because Ambiguity Check has no
   Milestone 2 search/filter layer — its full list is always what's
   visible.
7. **The Command Bar renders on every stage,** not just Group Check
   (Python's own narrower `#groupCommandBar` scope). Andrew's instruction
   said "should always expose" available shortcuts/selection/actions — an
   explicit, stated generalization, the same kind of evolution already
   recorded for the stage-tab design in Milestone 1.
8. **`ReplacementRuleEngine` moved to Milestone 3,** per Andrew's own
   explicit reasoning (quoted in his instruction): it introduces genuinely
   new domain logic and answers a customization question, not the more
   urgent "can I review a large document efficiently" question this
   milestone's tools answer directly. Recorded in place in
   `docs/architecture/review-workspace-reconstruction.md`'s Phase B/roadmap
   sections rather than silently left stale.

## Verification results

New suite `verify/milestone-2-review-at-scale-verification.ts` (91 checks,
four parts): Part 1 unit-tests every pure function in `itemCheckQuery.ts`
directly (no DOM, no fixture) — search across all seven named fields, all
eight filter presets including the high-confidence threshold boundary and
the organizations evidence-category interpretation, AND-combination
semantics, all seven sort orders including tie-breaks and the
undefined-likelihood convention, and `queryItemCheck()` end-to-end. Part 2
exercises `review.bulkApplyDecision` through the real
`ReviewWorkspace`/`WorkspaceCommandDispatcher` against
`synthetic-transcript-001` (10 real candidates spanning all five entity
types, likelihoods 1–99): Keep/Rename/Redact/Ignore application, the
required-replacement-for-Rename / optional-for-Redact rules, empty-selection
and all-invalid-id rejection, partial-invalid-id skipping, direct-overwrite
semantics, the event log (per-candidate `candidate-decided` events tagged
`viaBulkApply` plus one summary `bulk-decided` event with accurate counts),
and verification-staleness invalidation after a bulk change following
`generateOutput()`. Part 3 covers `previousDecided`'s forward-scan,
immediate-predecessor, and wrap-around cases, plus the zero-decided-items
graceful fallback. Part 4 checks the "ambiguous" preset against
`entity-resolution-001`'s REAL, oracle-verified `ambiguityProposals`
membership rather than a synthetic assumption.

Full regression battery re-run after every change, zero regressions:
`production-parity` 14/14, `detection-parity` 12/12, `quality-parity`
12/12, `entity-resolution-parity` 13/13, `occurrence-classification-parity`
13/13, `review-engine-verification` 43/43, `focus-navigator-verification`
99/99, `workspace-integration` 65/65, `audit-exporter-verification` 63/63,
`group-bulk-actions-verification` 83/83, `decision-reuse-verification`
117/117, `explanation-engine-verification` 61/61,
`milestone-2-review-at-scale-verification` 91/91, `ui-smoke` 4/4. `tsc
--noEmit` and `tsc` (full build) both clean throughout.

## Browser validation

Real click-through via Claude in Chrome against `synthetic-transcript-001`.
Confirmed: the search box narrows the list correctly on every keystroke
while keeping focus and cursor position (typing "robert" live-narrowed 10
candidates to exactly 2, with the input never losing focus); the "People"
filter chip correctly isolated the 4 person-type candidates, badge colors
intact; the default confidence-desc sort order correctly produced a
99/99/99/99/99/99/99/87/44/1 ordering with a stable id tie-break among
equal scores; selecting two candidates and clicking a bulk action correctly
applied Redact to both, cleared the selection, and updated Item Check's tab
count from 10/10 to 8/10; the `]` key correctly jumped from an undecided
candidate to the next undecided one in list order; the `[` key correctly
jumped backward to the nearest already-decided candidate; the `/` key
correctly focused the search box from anywhere in Item Check; "Next
ambiguity" correctly switched to Ambiguity Check and gracefully no-op'd on
this fixture's empty ambiguity list (it has no proposed ambiguity
candidates); "Jump to category" correctly switched to By Category view,
selected the "To Review" state, and filtered to exactly the one candidate
carrying the chosen category's evidence. One incidental, informative
finding, not a defect: searching the literal word "person" matched all 10
candidates, including non-person-typed ones, because `CandidateQualityEngine`
tags every non-person candidate with a `deterministic-non-person-type`
evidence category, and "person" is a literal substring of "non-person" —
confirmed by testing a more specific query ("robert"), which narrowed
correctly to exactly the two matching candidates. Since Andrew's
instruction explicitly lists "category" as a search field, this is a
correct (if occasionally surprising) consequence of substring matching
against category content, not a bug, and is left as-is.

## Remaining work for the next milestone

Per Andrew's own instruction, Milestone 3 ("Reviewer Productivity") is now:
`LocalSessionRepository` autosave, resume review, recent documents,
recovery after refresh, imported-decision visibility (Feature 002's
existing "(Imported)" tag could grow richer presentation here),
`ReplacementRuleEngine` (moved here from the original Phase B), and review
statistics. Milestone 4 ("Production Polish") follows after that:
typography, spacing, color refinement, iconography, empty/loading states,
minimal animation, accessibility, responsive behavior, onboarding, and
attorney usability improvements.
