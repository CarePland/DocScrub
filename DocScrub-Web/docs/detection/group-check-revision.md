# Group Check revision (2026-07-29)

## Andrew's request

Andrew shared three screenshots of `local_web_app.py`'s (the Python oracle
app) Group Check UI -- a compact, color-coded row layout he had been
prototyping by hand-editing the Python app's embedded HTML/CSS/JS directly,
using it as a fast design sandbox. Confirmed explicitly: **this work lands
in DocScrub-Web, not Python** ("Do not fix Python. that will not be further
developed. Incorporate these into the new version"). Four asks:

1. Arrow-key navigation was "jumping out of sequence." Question: is
   browsing linked to the active sort order, or a predefined order the
   arrows use? "If there is, it should be dynamic based on what the user is
   actually seeing."
2. Make the compact layout work: muted background per row, a checkmark
   replacing the confidence score once a group is "approved"/reviewed, a
   2-column option, and color-coding by decision type (Keep/Rename/
   Redact/Ignore), with the currently-active decision's button "more
   emphatic but not aggressive."
3. Not Quite should ALWAYS show the granular per-member Keep/Rename/
   Redact/Ignore view (the screenshot showing group-level "Rename
   selected/Keep selected as-is/..." buttons instead is "a little weird and
   shouldn't be an option" while inside Not Quite).
4. If every member of a Not Quite group ends up decided the same way,
   the group should read as that single decision once the reviewer leaves
   it ("you manually chose that path line by line, so let's reflect the
   outcome"). Confirmed via follow-up: a MIXED outcome should stay flagged
   for attention rather than being collapsed to a guess.

## Root cause: arrow-key nav order

`FocusNavigator`'s `moveItem` (bound to every arrow key + Home/End via
`keymap.ts`) always traverses `itemIdsForStage()`'s raw, structural order --
`GroupingResult.entityGroupProposals`' own array order for Group Check,
`DetectionResult.candidates`' own array order for Item Check. That's
correct and deliberate on FocusNavigator's side (Phase 9's "must never
depend on rendered/UI-only state" boundary), but it means arrow keys have
never followed whatever the reviewer currently has on screen. Item Check
already had a search/sort/filter layer (Milestone 2); Group Check had none
at all before this revision, so nothing could yet diverge there -- adding a
sort control to Group Check without also fixing this would have
reintroduced, inside Group Check, the exact defect Andrew reported from
Item Check.

The fix stays entirely in the UI layer, generalizing a pattern that already
existed: `goToAdjacentInVisibleList()` (Milestone 2) already redirects
Item Check's `]`/`[` (Next undecided/Previous decision) shortcuts through
the currently-visible filtered list instead of dispatching a raw `moveItem`
command, for exactly this reason. `app.ts` now has a sibling,
`moveWithinVisibleList()`, generalizing that from "scan for the next
matching item" to plain sequential movement (clamped at both ends, matching
`moveWithinItems`' own next/previous/first/last semantics exactly). The
`keydown` handler intercepts `moveItem` commands for `item-check`/
`group-check` and redirects them through this function over the currently
displayed order (`visibleItemCheckIds()` / `visibleGroupIds()`) instead of
dispatching them verbatim -- the same interception shape the workspace
interaction revision's `decideAndAdvance()` already established for
per-candidate decisions. Ambiguity Check is untouched: it has no sort/
filter layer, so its full traversal list already IS the visible list.

**Known, disclosed scope limit**: Item Check's Category Check view mode
narrows the pool further (`categoryFilter`/`categoryReviewState`), computed
inline inside `renderCategoryCheckPanel`'s own DOM-producing pass. This
revision's fix does not additionally account for that narrowing -- arrow-key
order while inside Category Check still follows the full Item Check sort,
not the category-narrowed view. Wiring that in cleanly needs
`renderCategoryCheckPanel`'s filtering logic pulled out of its
DOM-rendering path first; a real but separable follow-up, not folded into
this pass.

## Group Check gains a sort control

Group Check had never received its own Milestone-2-equivalent pass (Item
Check's Search/Sort/Filter/Bulk work never extended to it). This revision
adds one, deliberately smaller than Item Check's: `src/ui/groupCheckQuery.ts`
provides five sort orders (confidence, member count, alphabetical, each with
a direction) but no free-text search or filter presets -- Andrew's request
was specifically about navigation order and the compact layout, and Group
Check's list is typically far smaller than Item Check's full candidate
list, so the scaling pressure that justified Item Check's fuller query
layer doesn't obviously apply yet. Deferred, not declined, if it turns out
to be needed later.

## The compact, color-coded layout

`renderGroupStage()` in `app.ts` was rewritten around one new derived
concept: **what a Group Check row should DISPLAY is not the same thing as
`EntityGroupDecision.decision`.** That field (`Confirmed`/`Rejected`/
`Refined`) is real but too coarse for this purpose -- `confirmGroup`,
`redactGroup`, and `ignoreGroup` all stamp `"Confirmed"` regardless of which
bulk action was actually applied, and `completeNotQuite`/`flattenGroup` both
stamp `"Refined"` regardless of whether the reviewer's per-member choices
inside Not Quite came out uniform or mixed. The row's real "what happened"
story was always fully recoverable from its members' own
`CandidateDecision`s, so a new function reads that directly instead:

```
groupDisplayDecision(group, session): 
  { kind: "undecided" }
  | { kind: "uniform", decision: CandidateDecisionKind }
  | { kind: "needsAttention" }
```

(`src/engines/review/coverage.ts`, alongside `candidateResolvedStatus()`,
the same file's existing "derive, don't duplicate" resolved-status helper.)
`undecided`: no member has any decision yet -- the ordinary default,
deliberately not flagged (most groups start here). `uniform`: every member
individually decided, all the same -- whether that came from a bulk group
command, `flattenGroup`, a completed Not Quite pass, or the reviewer
deciding each member separately from Item Check without ever touching Group
Check at all; `groupDisplayDecision` doesn't care how the state was
reached, only what it currently is. `needsAttention`: some members decided
differently, or some decided and others not.

The row then renders from this derived value: a muted, decision-colored
background (`group-row-keep`/`-rename`/`-redact`/`-ignore`, or
`group-row-attention` for `needsAttention`); a green "✓ Reviewed" badge
replacing the confidence score once `uniform` (there's no more uncertainty
left for a score to communicate); and, among the four bulk buttons, the one
matching the current uniform decision gets `.group-action-active` --
solid-colored with white text, "emphatic but not aggressive" per Andrew's
own phrasing, reusing `--caution`'s already-muted brick-red for Redact
rather than reaching for a harsher alarm color. Rename and Ignore each
needed their own hue (`--rename`/`--ignore-color`, new CSS variables) --
`--accent` was already spoken for as the row-focus color and `--good`/
`--caution` for Keep/Redact.

The 2-column layout is a toolbar toggle (`groupCheckLayout`, module-level
UI state, defaulting to the lower-risk single column) applying
`.group-list-grid` (CSS grid, two columns) to the same row markup -- no
separate grid-specific component.

## Not Quite: always granular, and the auto-collapse behavior

DocScrub-Web's Not Quite panel already only ever rendered the granular
per-member view -- there was no "bulk-selected" alternate rendering to
remove; that defect (screenshot 2) exists only in the Python app's own,
separately-maintained client code, not here. This revision preserves that
invariant explicitly while restyling the panel, and states it as a
constraint in the row-rendering code's own comment so it isn't
reintroduced by a future change.

The auto-collapse behavior Andrew asked for -- a Not Quite group that ends
up uniformly decided should simply read as that decision once the reviewer
leaves it -- **required no new code beyond `groupDisplayDecision` itself.**
Two already-existing mechanisms compose to produce exactly this:

1. `groupDisplayDecision` is derived fresh from `candidateDecisions` on
   every render, not stored -- so the moment every member happens to share
   a decision, the NEXT render already shows it as `uniform`, regardless of
   why or when that state was reached.
2. `FocusNavigator`'s `applyNavigationCommand` refuses `moveItem`/
   `selectItem` while a Not Quite panel is open (`"a Not Quite panel is
   open; use moveNotQuiteMember instead"`) -- so "leaving" a Not Quite
   group can only happen via `exitNotQuite`/`completeNotQuite`, both of
   which clear `session.activeNotQuite`. `reconcile()` (already invoked
   after every review command since Phase 9/10, per the workspace
   interaction revision's own finding about `reconcileFocus()`) then drops
   the panel from focus on the very next render.

Point 2 IS "leaving focus," and point 1 means the row is already showing
the right thing the instant that happens. No stored "collapse on exit"
step, no new event to detect -- this is the same "derive, don't duplicate"
payoff the interaction revision's acknowledgement/auto-advance mechanism
got from `reconcileFocus()`, one layer up.

For the mixed case (Andrew's confirmed rule: "stay in Not Quite"), nothing
special had to be built either -- `groupDisplayDecision` simply doesn't
return `uniform` when the members disagree, so the row shows
`needsAttention` instead, with no button highlighted. A group that's fully
decided but disagreeing among its members is intentionally still counted
"resolved" for stage-completion purposes (`isItemResolved`'s pre-existing,
unchanged rule: resolved once every member has a decision, uniform or not)
-- "resolved" and "cleanly uniform" are different, both real, questions, and
conflating them would have been the wrong fix.

## Verification

New suite: `verify/group-check-revision-verification.ts`, 17 checks --
`groupDisplayDecision()` for undecided/each of the four uniform-decision
cases/Andrew's exact Not-Quite-all-Keep scenario/mixed/partial/reached-via-
Item-Check-alone/defensive-empty-group, and `compareGroups()`/`sortGroups()`
for all five sort orders plus determinism (no mutation, stable tie-break on
groupId). The nav-order interception itself (`moveWithinVisibleList` and
its `keydown` wiring) is UI-layer and not separately unit-tested, the same
precedent `goToAdjacentInVisibleList` already established before it -- real
browser validation covers it instead.

Full regression battery: all 20 verification suites (19 pre-existing + the
new one), zero regressions. `tsc --noEmit` and the full `tsc` build both
clean.

**Real browser validation**, against `synthetic_entity_resolution.docx`:
confirmed the toolbar (Sort dropdown, 2-column toggle) renders and works;
confirmed the compact color-coded rows -- entering Not Quite for the Andrew
Jackson group, deciding both members Keep, exiting: the row switched from
"91%" to a green "✓ Reviewed" badge with a solid-green active "Keep as-is"
button, `Group Check (1/2)` dropped to reflect it, and the tally line
updated to `Keep 2` -- all in the same render, no extra reviewer action
beyond Exit. Repeated for the Andrew Goodloe group with mismatched member
decisions (Keep, then Redact): the row stayed `86% needs attention`, no
button highlighted, confirming the mixed case is never collapsed to a
guess. Confirmed the always-granular Not Quite panel (no alternate bulk
view exists to show). Confirmed the 2-column grid renders both rows side by
side. Confirmed the nav-order fix directly: switched Group Check's sort to
Alphabetical (reordering Andrew Goodloe before Andrew Jackson), clicked
Andrew Goodloe to focus it, pressed the right-arrow key, and focus moved to
Andrew Jackson -- the next item in the DISPLAYED order. Repeated for Item
Check: switched sort to Alphabetical, pressed the up-arrow key from the
last displayed row (`Synthetic Entity Resolution Case`) and focus moved to
`Susan Whitmore`, the item immediately before it alphabetically -- not
whatever the raw detection-order "previous" item would have been (a
different, non-adjacent candidate under the old behavior, per this same
document's earlier detection-order finding in the workspace interaction
revision's browser validation).

No defects found.
