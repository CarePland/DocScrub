# Group Check keyboard and navigation revision (2026-07-29)

## Origin

Andrew, reacting to two screenshots of the shipped Group Check UI (one
collapsed, one with a group expanded to show its member breakdown), gave
six follow-up requests in one message:

1. Relabel "Rename" as "Change" -- key **C**, not N. "Allows the first
   letter of the word to be the command. Also it fits the function a bit
   better and is more generalized in case things evolve."
2. Relabel "Not Quite" as "Fix this" -- key **F**, not Q. Same reasoning.
3. "Clicking one of the 'buttons' needs to result in a visual
   confirmation.. pulsing border? some movement simulation.. a brief
   0.5-1sec UI experience that shows the user their choice was accepted.
   This should also be the case when selecting one of the KNRIQ options."
4. "The keyboard KNRIQ should always change the buttons, even if they have
   been selected. So going from Rename to Keep as-is should change the
   button highlight to Keep as-is. However, state should be preserved, so
   that if they go back to Rename, their prior edits will still be there."
5. Referencing the Python screenshot: "when collapsed, arrow keys navigate
   between items, as do Tab and shift+tab (forward/back). when an item is
   highlighted arrows function directionally within the opened item --
   pressing right moves right to whatever else is in that row, left the
   same, and up/down between rows within the opened item. If opened, Tab
   and shift+tab will select the next item."
6. "I want the default for a selected item/row to be expanded -- encourage
   them to review it by seeing everything rather than making rapid
   decisions. Tab still gets them out of it, as does pressing an approval
   decision."

Andrew also noted, as an aside not requiring action: relabeling to
Change/Fix-this "has the hidden benefit of allowing for vertical key
groupings on a QWERTY layout by larger function, but we won't tell the
customer."

## What shipped

### 1 & 2. Change / Fix this relabeling

Display text and keybindings only. The underlying decision vocabulary this
app persists and audits against -- the literal string `"Rename"` in
`CandidateDecisionKind`, and the `renameCandidate`/`flattenGroup`/
`enterNotQuite` command type names -- is deliberately unchanged. Renaming
that vocabulary too would be a real schema/parity change with migration
and audit-continuity implications, and nothing about Andrew's request
asked for it -- only the word and key a reviewer sees and presses. See
`keymap.ts`'s own top doc comment for the full reasoning.

`decisionShortcut`'s mapping (Item Check, Ambiguity Check) changed from
`{k, n, r, i}` to `{k, c, r, i}`. `groupCheckShortcut` changed from `q/k/n/r/i`
to `f/k/i` -- **c** (Change) and **r** (Redact) now deliberately resolve to
`null` at the keymap level rather than dispatching directly, closing a
real pre-existing inconsistency: Group Check's keyboard path used to
bypass the inline editor entirely (direct `flattenGroup`/`redactGroup`
dispatch, no way to pick a spelling or narrow the selection from the
keyboard) while the row's own Change/Redact *buttons* always opened it.
Both letters now fall through to the same UI-layer fallback
(`handleInlineEditorOpenKey` in app.ts), which gained a new branch for
"a focused group in Group Check with no Not Quite panel open" mirroring
exactly what the row's own buttons already do.

Resolved on my own judgment, not yet confirmed with Andrew: his message
says "I think Q can be Not Quite perhaps" in point 3, which conflicts with
point 2's explicit "F is the new operator key" for the same action. Point
2's explicit, dedicated reassignment was treated as authoritative; **Q is
not bound to anything anywhere in this revision.**

### 3 & 4. Acknowledgement pulse + draft preservation, generalized

**Acknowledgement.** Previously a single `{ stage, candidateId }` shape
covering only Item Check/Ambiguity Check decisions -- Group Check's own
bulk actions and Not Quite's per-member actions had no acknowledgement at
all (a genuine, disclosed gap, not something Andrew asked to keep).
`AcknowledgementTarget` is now a three-shape discriminated union
(`candidate` / `group` / `not-quite-member`); `acknowledge()`/
`isAcknowledged()` are the one choke point every decision path goes
through. A new `.row-acknowledged-pulse` CSS animation (0.7s, matching
`ACKNOWLEDGEMENT_MS`) layers a border-pulse + subtle scale nudge on top of
the existing `.item-row-acknowledged` color change -- the "movement
simulation" half of Andrew's request, done with `transform`/`box-shadow`
so it never reflows surrounding layout.

**Draft preservation.** `inlineEditor` now closes immediately the moment a
*different* decision commits for the same candidate/group/member (e.g.
clicking Keep while a Change editor was open for that same row), so the
button highlight always reflects the latest action pressed -- but the
in-progress draft text doesn't disappear. A new `draftTextCache: Map<string,
string>`, keyed structurally per scope+action (so Change and Redact drafts
on the same candidate never collide), is written on every keystroke and
read back when `openInlineEditor` re-opens for that same target -- cleared
only on an explicit Cancel or a successful Confirm of that draft. Three new
`decideGroupAndAdvance`/`decideGroupBulkAndRender`/
`decideNotQuiteMemberAndRender` helpers give Group Check's Keep/Ignore
buttons and Not Quite's per-member Keep/Ignore buttons the same
"close a competing editor, acknowledge, render" sequence
`decideAndAdvance` already gave candidate-level decisions.

### 5. Directional row navigation

A roving-tabindex grid (`attachRovingGridNav`, `rovingGridPosition`,
`groupRovingFocus`) over the currently **expanded** group's own focusable
controls: row 0 is the group's checkbox plus Keep/Change/Redact/Ignore/Fix
this buttons (exactly the one row those appear in visually); rows 1..N are
each member's own checkbox in the breakdown list below it. Left/Right move
within a row; Up/Down move between rows, preserving column where possible.
This moves **real DOM focus**, not a second parallel "selection" concept --
matching what Andrew's Python reference screenshot implies the original
tool already does, so a keyboard-only reviewer gets the behavior they
already expect.

Tab and Shift+Tab are deliberately **not** part of this grid at all -- per
Andrew's own closing sentence ("If opened, Tab and shift+tab will select
the next item"), Tab always means "next item," collapsed or expanded,
never "next control in this row." `keymap.ts` gained a `tabDirection()`
helper resolving bare Tab to `moveItem(next)` and Shift+Tab to
`moveItem(previous)`, added alongside the existing arrow-key bindings for
both the item-check/ambiguity-check and group-check branches of
`resolveKeyboardCommand`.

Because arrow keys pressed on a roving-grid control never reach
`document`'s keydown listener (`stopPropagation` inside the grid's own
handler), the only remaining gap was Tab/K/C/R/I/F while a grid control
has real focus: `keymap.ts`'s ported `shouldIgnoreKeyboardEvent()`
blanket-blocks every keydown while any button/input has DOM focus, which
is correct everywhere else in the app but wrong for controls this
revision deliberately focuses on purpose. A new, narrowly-scoped
`isRovingFocusElement()` check in app.ts (not a change to the ported
`shouldIgnoreKeyboardEvent` itself) unblocks exactly a checkbox/button
that is inside `.group-row`/`.member-row` **and not** inside an open
`.inline-editor` -- so the inline editor's own quick-pick chips (also
plain `<button>`s, sitting inside the same row) stay fully gated, and a
stray "k" while picking a spelling can never fire Keep behind the
reviewer's back.

Focus is restored after every render (which tears down and rebuilds this
row's DOM from scratch, same as every render in this app) using the same
"remember position, re-focus after rebuild" idiom `searchInputFocusPending`
and the inline editor's own end-of-render `.focus()` call already
established -- but only while no inline editor is open, so an incidental
re-render (autosave) never yanks focus away from text a reviewer is
actively typing elsewhere.

**Disclosed scope trim:** only Group Check gets this treatment in this
revision. Item Check/Ambiguity Check's decision buttons are unaffected --
their K/C/R/I shortcuts already act on the whole candidate without a
button click first, so there's less to gain, and both of Andrew's own
reference screenshots were Group Check. Extending it there is a cheap,
natural follow-up if he wants the same affordance. Not Quite's own
per-member arrow-key cursor (`moveNotQuiteMember`) is unchanged -- Andrew
didn't ask to change it, and it already has an equivalent (if simpler)
"arrows move a cursor" model of its own.

### 6. Default-expand

Reversed this same session's earlier "expand/collapse toggle, deliberately
separate from keyboard focus" design (`expandedGroupIds`, a manual ▸/▾
button). A group's expansion is now computed exactly the way Item/
Ambiguity Check's candidate expansion already works: `isExpanded =
isAcknowledging || isFocused`. No separate Set to keep in sync, no toggle
button to discover or forget to click -- the moment a group is the
reviewer's current focus, they see everything about it. `expandedGroupIds`
and `toggleGroupExpanded` are removed entirely, along with the now-unused
`.group-expand-toggle` CSS rule.

## Full picture: how these six pieces fit together

Andrew's six items are not independent -- 5 and 6 depend on each other
(directional row navigation only makes sense once expansion always follows
focus), and 3/4 needed to happen before 5 could be verified sensibly
(pressing an arrow to roam a row's buttons should visibly show which one
now has focus, and pressing Enter on it should visibly pulse). Built and
verified as one revision rather than staged separately.

## Verification

`npx tsc --noEmit` and a full `npx tsc` build both clean. All 24
pre-existing verification suites re-run with zero regressions (no suite
needed new cases -- this revision is DOM markup/event wiring inside
app.ts/keymap.ts, the same category of change as the original command-bar/
inline-editor revision and the quick-pick chip addendum, neither of which
needed new suites either). `focus-navigator-verification.ts` was updated
for the `f/k/i`-only `groupCheckShortcut` resolution and the new Tab/
Shift+Tab/Ctrl+Tab cases -- 105/105 passing.

## Not validated this session: live browser click-through

Same standing gap as every UI-only revision this session: Claude in Chrome
drives Andrew's own real, local browser, a genuinely separate network from
this sandbox. The roving-focus grid in particular -- which controls
receive real DOM focus, whether Tab correctly skips it, whether the pulse
animation reads as intended rather than jarring -- is exactly the kind of
thing a Node harness cannot observe. This is the piece of today's work
most worth Andrew clicking through directly via `start-server.command`
before relying on it.
