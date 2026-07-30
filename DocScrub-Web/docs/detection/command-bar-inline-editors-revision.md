# Command bar + inline editors revision (2026-07-29)

## What Andrew asked for

Four items, sent together with three screenshots of `local_web_app.py`'s
(the Python oracle) Group Check / Item Check UI as design reference:

1. Remove the "(k)"/"(n)"/"(r)"/"(i)"/"(q)" letter hints embedded on every
   individual action button, in favor of one dynamic command bar (matching
   Python's own top bar, whose text changes with focus context) that states
   the current shortcut vocabulary in one place.
2. A bug report: "the action buttons appear to not work... no perceptible
   update visually" for both mouse clicks and keyboard-focused activation.
3. Replace `window.prompt()` for Rename/Redact/Not Quite text entry with
   inline contextual editors -- called out explicitly as "unacceptable for
   both scope and UX."
4. Append a same-day counter to the version label (`v2026-07-29.01`) so a
   refresh visibly proves it picked up the latest build.

## Investigation: the "no visible update" report

Before touching any UI code, this was investigated by reading (not
assuming) `keymap.ts`'s `resolveKeyboardCommand()`. It has its own doc
comment recording an already-known, already-disclosed gap: for a focused
candidate in Item Check/Ambiguity Check, and for the active member inside
an open Not Quite panel, the keymap deliberately returns `null` for the
"n" and "r" keys -- Rename always needs, and Redact optionally accepts,
reviewer-typed text a bare keydown can't supply, so the keymap intentionally
left "open an editor" to a UI layer that was never actually built. Only
`window.prompt()`, reachable by mouse only, ever satisfied that need.

Net effect, prior to this revision: K and I (and every mouse click) already
worked correctly -- confirmed by this session's own prior real-browser
validation of the workspace interaction revision and the Group Check
revision. Only the keyboard "n"/"r" path, in exactly those two contexts,
was a silent no-op with no error and no visible effect at all. This is a
real, disclosed, root-caused defect, not a caching artifact -- though
staleness was also a live possibility Andrew's own version-counter request
(#4) exists to rule out going forward, and both are treated as legitimate
here.

## What changed

**Inline editors** (`app.ts`): a new small piece of ephemeral UI state,
`inlineEditor`, keyed by which target (a candidate, a bulk selection, or a
Not Quite member) currently has its Rename or Redact editor open, plus one
`renderInlineEditor()` helper appended right next to the button that opened
it -- never a separate dialog. Replaces `window.prompt()` at every call
site that had it (`decisionButtons()`'s Rename, the Milestone 2 bulk
toolbar's Rename, Not Quite's per-member Rename) and additionally gives
Redact the same inline optional-text capability everywhere Rename has it
(previously Redact never offered typed text at all, mouse or keyboard --
always the default placeholder). Rename structurally requires non-empty
text (`renameCandidate.replacement` is a plain `string`); Redact's is
always optional, so confirming an empty Redact editor with Enter is still
a normal one-keystroke action, not a forced extra step.

Deliberately does **not** extend to Group Check's own bulk-level Redact
(`redactGroup`, which also accepts an optional replacement) or Rename
(`flattenGroup`, which takes no text at all) -- see the code comment on
`inlineEditor`'s declaration for the reasoning: those apply to every member
of a proposed group at once and are meant to stay a single fast tap: a
per-member override is already available via Not Quite, which does get the
inline editor.

**Keyboard fallback** (`app.ts`'s `handleInlineEditorOpenKey()`, wired into
the same fallback chain as `handleScaleNavigationKey`): pressing "n"/"r" in
the two contexts keymap.ts intentionally left unresolved now opens the same
inline editor a mouse click would. This closes the root-caused gap from the
investigation above.

**Dynamic command bar** (`app.ts`'s `commandBarLegend()`): the command bar,
moved from below the stage body to above it (matching the screenshot
reference -- visible without scrolling), now derives its legend text fresh
every render from the same "derive, don't duplicate" pattern this codebase
already uses for `groupDisplayDecision()` and expansion-follows-focus:
different text while an inline editor is open (Enter/Esc), different text
while a Not Quite panel is open (member-level K/N/R/I, ↑↓, Esc) vs. not
(group-level bulk K/N/R/I/Q), and the existing per-stage default otherwise.
Every button's embedded letter hint was removed to match (Keep/Rename/
Redact/Ignore/Not Quite, Keep selected/Rename selected/etc., Next
undecided/Previous decision) -- the command bar is now the one place that
vocabulary is stated.

**Version scheme** (`version.ts`): every version now carries a zero-padded
two-digit same-day counter starting at `.01`, not just a bare `v<date>` for
the first change of the day -- `v2026-07-29.01` for this change. A bare
same-day version couldn't visibly change again that day, defeating the
label's one job on exactly the days with more than one change.

## Verification

`npx tsc --noEmit` and a full `npx tsc` build both clean. All 22
`verify/*.ts` suites pass with zero regressions (counts unchanged from the
Group Check revision's own record, since this was a UI-layer-only change
with no new domain logic to cover).

**Live browser click-through was not completed this session.** Claude in
Chrome drives Andrew's own real Chrome browser via its extension, not this
sandbox -- confirmed by a working navigation to a real external site, and
by the sandbox's own `python3 -m http.server 8000` returning a Chrome error
page (unreachable) rather than the app when navigated to from that same
tab. There is no bridge between the two. This is disclosed here rather than
silently skipped or assumed to have passed. Andrew's own refresh, once he
sees the version label change to `v2026-07-29.01`, is the practical
validation path for this change.
