# Group Check Python-parity revision (2026-07-29)

## Origin

Andrew, reacting to the command bar + inline editors revision
(`command-bar-inline-editors-revision.md`): "this is a huge improvement.
I'd like to incorporate more functionality from the Python version,"
attaching two screenshots of `local_web_app.py`'s Group Check UI and
describing three things missing from DocScrub-Web's version:

1. **Per-member checkboxes.** "Select All, select specific items/deselect.
   Standard checkbox behavior. Each cited item is a checked option, not
   just a list." Selecting a subset changes the bulk-action button labels
   ("Rename selected", "Keep selected as-is", etc.) to reflect the narrowed
   scope.
2. **Radio quick-pick for rename text.** "The radio buttons... offer the
   ability to select one of the 'found' results as the text to replace,
   without requiring typing... folks won't want to type most of these."
3. **Per-item live confidence.** "The percentages are listed for each
   individual item separately. If an item is modified by the user the
   visible score goes to 100% and this will impact the overall item
   score."

Andrew flagged the screenshot was Group Check while DocScrub-Web's most
recent inline-editor work was on Ambiguity Check, but "the principle is
similar," and offered to pull Python documentation if needed.

Three clarifying questions were asked and answered before implementation:

- **Group expand/collapse**: add a new expand toggle, separate from
  keyboard focus, matching Python's `expandedGroups` -- confirmed.
- **Build order**: checkboxes+labels, radio quick-pick, and live confidence
  recalculation as one cohesive revision, not staged -- confirmed ("all
  three together").
- **Scope**: whether this applies to Group Check only or extends to Item
  Check/Ambiguity Check's flat (non-grouped) candidates too. Andrew chose
  **extend to Item Check/Ambiguity Check as well**, overriding the
  Group-Check-only default this session recommended.

## What shipped

### 1. Member checkboxes + subset bulk actions (Group Check)

`groupUncheckedMemberIds: Map<string, Set<string>>` mirrors Python's
`groupUnchecked[groupId]` exactly: it stores only **exclusions**, never
inclusions, so "select all" is simply deleting the map entry and a
freshly-seen group needs no initialization. A tri-state parent checkbox
(all / some / none) sits above each group's member list; each member row
has its own checkbox. The bulk-action buttons' labels and behavior adapt
to the current selection:

- **All members selected** (the ordinary, unmodified case): Rename/Redact/
  Keep/Ignore fall through to the original `confirmGroup`/`redactGroup`/
  `ignoreGroup` commands, preserving the exact `EntityGroupDecision`
  stamping behavior (audit trail, `reviewerConfirmed` bonus eligibility)
  those commands have always had.
- **A narrowed subset, or custom Rename/Redact text**: routes through
  `bulkApplyDecision` (already built for Milestone 2's multi-select
  toolbar), which by design stamps per-candidate decisions without a group-
  level `EntityGroupDecision`. This is a deliberate architectural choice,
  not an oversight -- see "Why the two paths" below.

### 2. Group expand/collapse toggle

A new, third UI mode for Group Check (`expandedGroupIds: Set<string>`),
explicitly distinct from both keyboard focus (`state.focus`) and Not
Quite's own panel state -- matching Python's `expandedGroups`. Toggled via
a ▸/▾ control, persists independently of focus. When expanded (and Not
Quite isn't open for that group), each member renders as a row: checkbox,
name, and its own live confidence badge.

### 3. Rename radio quick-pick

The inline editor (`renderInlineEditor`) now optionally renders a small set
of radio options above its text input -- the group's or selection's
distinct display values -- so accepting one of the "found" spellings never
requires typing. Selecting a radio is a deliberate, infrequent click, not a
keystroke, so the editor re-renders on selection with no focus-loss
concern (unlike the text input itself, which deliberately does not
re-render per keystroke -- see the command-bar revision's own notes on
this). Extended to Item Check's bulk-selection Rename flow as well, not
just Group Check.

### 4. Live confidence recalculation

New `src/engines/review/coverage.ts` exports:

- `groupLiveConfidence(group, detection, quality, session,
  selectedCandidateIds, resolutionEngine, canonicalName?)` -- the group's
  (or a checked subset's) live confidence, including the +10
  reviewer-confirmed bonus when `session.groupDecisions` has an entry for
  this group.
- `memberLiveConfidence(...)` -- one member's own live confidence, with the
  bonus deliberately excluded (see below).
- `candidateLiveConfidence(analysisScore, decided)` -- the flat-candidate
  counterpart for Item Check/Ambiguity Check: a decided candidate simply
  reads 100, an undecided one shows its ordinary analysis score.

All three return a `LiveConfidence { current: number; prior?: number }`;
`prior` is present only when it differs from `current`, driving a "was X%"
note -- matching Python's own `memberScore === 100 && priorScore !== 100`
gate for showing the note at all.

## Architecture: where "live" confidence belongs

Python's own code draws a real layering boundary here, and this revision
follows it rather than inventing a new one. `entity_resolution.py`'s
`calculate_entity_confidence()` is decision-agnostic -- it has no concept
of a review session, just candidates and quality scores. The "if this
member already has a reviewer decision, treat its score as 100"
substitution lives entirely in `local_web_app.py`'s client JS
(`scoreMemberAgainstCanonical()`), a thin wrapper the backend engine never
sees.

DocScrub-Web's `EntityResolutionEngine`/`resolution.ts` is the direct port
of the backend engine and needed to stay that way -- `ReviewEngine`/
`FocusNavigator` and other domain-layer consumers depend on it staying
session-agnostic. So `calculateEntityConfidence()` gained one new,
**optional** 7th parameter, `memberScoreOverride?: (candidateId: string) =>
number | undefined`, used only inside the `scores` map
(`memberScoreOverride?.(candidate.id) ?? memberScore(...)`). Omitting it
reproduces the exact prior behavior byte for byte -- confirmed in
`verify/live-confidence-verification.ts`, Part A. `groupLiveConfidence()`/
`memberLiveConfidence()` (the new `coverage.ts` functions) are the actual
"caller who knows about `ReviewSession`" this parameter anticipated; they
live in the review layer, not the engine.

This also meant `RegexEntityResolutionEngine.recalculateConfidence()` --
already a pre-existing, Phase-6-built, previously-**unused** (zero call
sites) faithful port of Python's `calculate_entity_confidence()` -- could
be extended and put to real use for the first time, rather than
reimplementing the confidence formula from scratch. Reusing it instead of
duplicating it was a meaningful risk reduction: the min/mean/anchor-penalty
math was already fixture-verified.

### Why the +10 bonus splits between group and member

Python's `dynamicGroupConfidence` applies the reviewer-confirmed +10 bonus;
`scoreMemberAgainstCanonical` (the per-member figure) never does. Confirmed
by reading both functions side by side rather than assuming symmetry. This
is why `memberLiveConfidence()` is NOT implemented as
`groupLiveConfidence(..., [candidateId], ...)` despite the overlap in
inputs -- that shortcut would leak the group-level bonus into an
individual member's score. `memberLiveConfidence()` instead calls
`recalculateConfidence()` directly with `reviewerConfirmed` always `false`.
Verified explicitly in `verify/live-confidence-verification.ts` (a case
constructs a group with a `groupDecisions` entry and confirms the member's
own live score is strictly lower than what the same solo-candidate subset
would show via `groupLiveConfidence`).

## Deliberate scope trim: no recompute during an open rename draft

Python's client JS recalculates a member's live score as the reviewer
types in the rename editor, before Accept. This revision does **not**
replicate that. Doing so would require the inline editor to re-render on
every keystroke, directly reversing an earlier, deliberate design decision
from the command-bar revision (avoiding per-keystroke re-renders in the
inline editor specifically to prevent focus and cursor loss). Live
confidence here recomputes against the group's real, already-committed
`canonicalName` (or an override about to be confirmed) -- never a live
keystroke-by-keystroke draft. `groupLiveConfidence()`'s doc comment states
this explicitly for future readers. This is a disclosed trade-off, not an
oversight: Andrew should know the badge won't visibly move while a rename
is mid-edit, only once it's accepted.

## Verification

`verify/live-confidence-verification.ts` (new, 13/13 checks): Part A
exercises `calculateEntityConfidence()`'s new override parameter directly
(omitting it reproduces prior behavior exactly; overriding a member's
score raises the blend; full override + `reviewerConfirmed` saturates at
the 100 cap; `analysisMemberScore` matches the plain per-member ingredient
the blend uses). Part B exercises the three `coverage.ts` functions
(no-decision groups show no prior note; a single decided member produces a
higher current score with a prior note; a `groupDecisions` entry raises
group confidence via the bonus while a member's own score stays unaffected
by it; `groupLiveConfidence` narrowed to one candidate matches
`memberLiveConfidence` for that candidate when no bonus is in play;
`candidateLiveConfidence`'s undecided/decided-below-100/decided-at-100
cases).

Full regression: `npx tsc --noEmit` clean, all 24 verification suites
(23 pre-existing + this new one) pass with zero regressions.

## Not validated this session: live browser click-through

As with the command-bar revision, Claude in Chrome drives Andrew's own
real, local browser -- a genuinely separate network from this sandbox's
`python3 -m http.server`. Confirmed again this session (fresh server,
`curl` succeeded from inside the sandbox; `navigate` to
`http://localhost:8000` from Claude in Chrome failed with "Frame with ID 0
is showing error page," while a control navigation to `https://example.com`
succeeded from the same tab). All of the checkbox/expand-toggle/radio-
pick/live-confidence UI in `app.ts` is therefore unverified by an actual
click-through this session -- type-checked, built, and logic-tested via
the new suite, but not visually confirmed. Andrew should validate via
`start-server.command` before relying on this in real use.

## Addendum (same day): quick-pick chips revision

After using the shipped feature, Andrew asked for a real interaction
change to the radio quick-picks specifically: "hitting Enter here [a
selected option] ought to approve this and auto-move to the next item...
even if they are not in the text input," and to restyle the alternatives
as "selectable but not quite buttons. Each gets highlighted with focus,
encouraging enter" rather than radio inputs. He also reframed the
free-text field itself as a third option ("something else") in the same
row, rather than an always-visible separate control -- with the important
constraint that switching to it should still pre-fill from whatever was
last selected, "useful for minor edits."

Each quick-pick is now a plain `<button>` ("button light" pill styling,
`index.html`) whose click/Enter/Space calls `confirmInlineEditor()`
directly with that value -- one action, not the previous two-step
select-then-Confirm. No new "advance to next item" logic was needed:
`WorkspaceCommandDispatcher.dispatchReview()` already calls
`reconcileFocus()` after every review command (the same mechanism
documented in the Workspace interaction revision and the Group Check
revision before it), so committing a quick-pick advances focus exactly the
way every other decision in this app already does -- the change is purely
that committing now takes one interaction instead of two. Left/Right/Up/
Down arrow keys rove focus across the chip row (native `<button>` Tab
order already covers linear traversal; arrows are the added nicety
matching the radio-group muscle memory this replaces). "Something else…"
is the last chip in the row; selecting it does not submit -- it reveals
the free-text input beneath, pre-filled with whatever `draftText` already
held (the group's canonical name, or the last chip clicked before
switching), so a reviewer nudging one letter of "Andrew Jackson" never
retypes the whole name. A draft that doesn't literally match any quick
pick (the canonical name differs from every selected member's own
`displayValue`) forces custom-input mode on by default, rather than hiding
the reviewer's own pre-filled text behind an extra click they never asked
to make. Opening the editor now focuses the chip matching the current
default (or "Something else…" if in custom-input mode), so accepting the
pre-filled suggestion is a single Enter keystroke with no Tab first.

No new pure-function logic was added (this is DOM markup/event wiring
inside `renderInlineEditor`, the same category of change as the original
command-bar/inline-editor revision), so no new verify suite was needed;
`tsc --noEmit`, a full `tsc` build, and the complete 24-suite battery all
pass with zero regressions. Live browser click-through was not completed
this session for the same sandbox-network-isolation reason as above --
this is the piece of today's work most worth Andrew clicking through
directly, since keyboard focus/roving/Enter-to-submit behavior is exactly
the kind of thing a Node harness can't observe.
