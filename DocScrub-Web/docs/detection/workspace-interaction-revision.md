# Workspace interaction revision (2026-07-29)

## Andrew's request

Not a feature request -- "a refinement of the reviewer interaction model."
The stated philosophy: minimize UI manipulation time, maximize
evidence-evaluation time. Target rhythm "Read -> Decide -> Immediate
Feedback -> Continue," replacing "Expand -> Read -> Confirm -> Close ->
Navigate." Concretely: candidates should auto-expand on selection instead
of requiring a Detail toggle; the Detail button itself should be evaluated
for removal; Ambiguity Resolution should move out of the top-level row and
into the expanded detail panel as evidence, not a separate action; single-
and multi-option ambiguity should both select-and-link immediately, with no
confirmation step; a brief (~0.5s) visual acknowledgement should confirm a
decision without interrupting flow; the just-decided candidate should then
collapse and the reviewer should advance automatically to the next one; and
the detail panel's information hierarchy should read Explanation ->
Representative snippets -> Possible identities -> Occurrences -> Expert
View. Success criteria: reviewing should feel like reviewing a stack of
documents, not operating a UI.

## What changed

**Expansion is now derived from focus, not tracked separately.** The prior
model kept `expandedCandidateIds: Set<string>` as independent UI state,
toggled by a Detail button, orthogonal to which candidate was actually
focused for keyboard navigation (`FocusState`/`FocusNavigator`). A
candidate could be focused without being expanded, or stay expanded after
focus moved elsewhere -- two sources of truth for "what am I looking at,"
which is exactly the kind of interface mechanics Andrew's philosophy singles
out. `src/ui/app.ts` no longer has that Set. A row is expanded exactly when
it is the focused item (`state.focus.target.stage === stage &&
state.focus.target.itemId === candidateId`), full stop.

**The Detail button is removed, not retained.** Evaluated per Andrew's
instruction ("only exists where it serves a genuine purpose rather than
compensating for the current navigation model") -- its only purpose was
toggling the independent expansion state above; once expansion is derived
from focus, there is nothing left for it to do. `decisionButtons()` now
renders only Keep/Rename/Redact/Ignore. `handleDetailToggleKey()` and the
D/./Space keyboard shortcut are removed entirely, and the command-bar
legend for both Ambiguity Check and Item Check no longer lists them.

**Ambiguity resolution moved into the detail panel, evidence-shaped.** The
old `ambiguityLinkButtons()` rendered "This is X (N%)" buttons at the
top-level row, alongside Keep/Rename/Redact/Ignore -- treating a linking
decision as a fifth reviewer action. It's replaced by
`renderPossibleIdentities()`, called from inside `renderCandidateDetailPanel`
between Representative snippets and the occurrence browser: a "Possible
identities" section listing every candidate group option (name + confidence
badge, "Linked" marker on the current selection). A single option is
displayed exactly like a list of several -- no special-cased markup for the
1-vs-N distinction, since Andrew's requirement is about reviewer experience
(natural display, immediate selection) not literal item-count branching, and
forking the two cases would itself be exactly the kind of unnecessary
mechanics this revision removes. Selecting any option immediately dispatches
`linkAmbiguousCandidate` -- no second confirmation, the same interaction
shape as Keep/Rename/Redact/Ignore.

**Visual acknowledgement + automatic progression.** A new module-level
`acknowledgement` variable (`{ stage, candidateId, timeoutHandle } | null`)
replaces the old `expandedCandidateIds`. Every per-candidate decision --
Keep, Rename, Redact, Ignore, or a possible-identity link, from either a
mouse click or a keyboard shortcut -- now routes through a new
`decideAndAdvance()`:

```
function decideAndAdvance(command, candidateId, stage) {
  if (acknowledgement) window.clearTimeout(acknowledgement.timeoutHandle);
  if (command.family === "review") dispatcher.dispatchReview(command);
  const timeoutHandle = window.setTimeout(() => {
    acknowledgement = null;
    render();
  }, 500);
  acknowledgement = { stage, candidateId, timeoutHandle };
  render();
}
```

The dispatch happens immediately (the decision is applied and audited the
instant it's made, exactly as before); `acknowledgement` only delays
*revealing* the next state. While it's set, the just-decided row gets a
green border/background (`.item-row-acknowledged`) and a "Saved" badge, and
-- because `decideAndAdvance` still calls `dispatchReview` synchronously --
`WorkspaceCommandDispatcher.dispatchReview()` has already called
`reconcileFocus()` and moved `FocusState` to the next unresolved item before
the 500ms timer even starts. The row stays visually expanded during the
acknowledgement window via `isAcknowledging` (independent of where focus
already moved to), so the reviewer sees the confirmation on the item they
just decided, not a jump-cut. When the timer fires, `acknowledgement` clears
and the *already-correct* focus state is simply revealed: the decided row
collapses, the next unresolved candidate is expanded.

This is the most notable finding of the whole revision: **automatic
progression required no new navigation logic.** `WorkspaceCommandDispatcher
.dispatchReview()` has called `workspace.reconcileFocus()` after every
successful review command since Phase 9/10 -- advancing focus to the next
unresolved item was already happening on every decision, synchronously, as
a structural property of the dispatcher. The old UI just never surfaced it
as forward motion, because expansion was independent, separately-tracked
state that didn't know focus had moved. The entire "automatic progression"
requirement was a **presentation** gap, not a missing domain capability --
consistent with this codebase's own "derive, don't duplicate" convention
(see `docscrub-web-conventions.md`): the fix adds a short delay before
revealing an already-computed result, not a new computation.

**Keyboard and mouse share one path.** `dispatchAndRender()` -- the generic
function keyboard shortcuts resolve through (`keymap.ts`'s
`resolveKeyboardCommand()`) -- now detects the five per-candidate decision
types (`CANDIDATE_DECISION_TYPES`) and delegates to `decideAndAdvance()`
itself, rather than only the button click handlers doing so. Pressing `k`
gets the identical acknowledgement + auto-advance rhythm as clicking Keep;
there is exactly one code path for "a decision was made about a candidate,"
regardless of input modality.

**Information hierarchy reordered.** `renderCandidateDetailPanel()` now
renders badges -> Explanation -> Representative snippets -> Possible
identities (only present when the candidate has ambiguity options) ->
Occurrence Browser -> Expert View, matching Andrew's requested order
exactly.

**Stale-timer handling.** If the reviewer clicks a different candidate
while an acknowledgement is still animating (fast reviewer, small window),
two places cancel the stale timer: `decideAndAdvance()` itself (a new
decision always wins), and the row label's click handler (explicitly
selecting a different candidate clears any acknowledgement left over from
elsewhere). Without this, a fast reviewer could see a decision's
acknowledgement "cannon-ball" back into view over a screen they'd already
moved past.

## What was deliberately not changed

No `ReviewSession`, `ReviewCommand`, `FocusState`, or `FocusNavigator`
change was needed. Every reviewer-facing behavior this revision touches --
which candidate is decided, what decision was recorded, which candidate
becomes focused next -- was already fully modeled; this was a UI-layer
change end to end (`src/ui/app.ts` + `index.html`'s inline `<style>`
block). No fixture, engine, or `verify/*.ts` suite needed updating: the 18
existing suites test domain/reducer/engine behavior, and only
`verify/ui-smoke.ts` touches `app.ts` at all, checking module-eval safety
against a fake DOM rather than interactive behavior -- there was no
existing seam to add interaction-model coverage to short of building a real
DOM-interaction test harness, which was judged out of scope for a UI
refinement Andrew characterized as a rhythm change, not new logic.
Reversibility was not something to build -- decisions have always been
freely re-dispatchable (no reducer-level locking exists for a "final"
decision); this revision only needed to confirm re-deciding an
already-decided candidate still triggers the same acknowledgement +
advance rhythm, which it does, since `decideAndAdvance` doesn't
distinguish a first decision from a change of mind.

## Verification

Full regression battery: all 18 verification suites re-run, identical pass
counts to the ambiguity anchor correction (604 total across the
numbered-check suites, all 12/12, 13/13, and 14/14 fixture-parity suites
still fully matching), zero regressions. `tsc --noEmit` and the full `tsc`
build (`dist/`, what the browser actually serves) both clean.

**Real browser validation**, against `synthetic_entity_resolution.docx`
served locally, covering every item on Andrew's own checklist:

- **Automatic expansion during navigation**: switching stages (Ambiguity
  Check, Item Check) auto-expanded the first unresolved candidate with no
  Detail click; clicking a different row's label auto-expanded it and
  collapsed the previous one.
- **Single expanded candidate**: confirmed throughout -- only the focused
  row ever carries `.item-row-focused` / an open detail panel.
- **Ambiguity selection, both shapes**: `Andrew (person) 35%` showed two
  possible identities (`Andrew Goodloe 86%`, `Andrew Jackson 91%`) as a
  selectable list; `Maria (person) 11%` showed one (`Maria Alvarez 90%`)
  displayed the same way, not specially. Clicking either linked immediately.
- **Immediate linking, no second confirm**: clicking a possible-identity
  option recorded the link and dropped Ambiguity Check's and Item Check's
  unresolved counts in the same instant -- no intermediate confirmation
  state existed to click through.
- **Visual acknowledgement**: confirmed live -- green border/background and
  a "Saved" badge on the just-decided row for roughly half a second.
- **Automatic progression**: confirmed via before/after screenshots --
  Andrew's row collapsed and Maria's row auto-expanded after the
  acknowledgement window elapsed, with no reviewer action in between.
- **Keyboard navigation**: focused `Priya Natarajan` by clicking its label,
  pressed `k`, and got the identical result as a mouse click -- `Priya
  Natarajan (person) -- Keep` recorded, acknowledgement shown, and focus
  auto-advanced to `Susan Whitmore`, confirming `dispatchAndRender`'s new
  `CANDIDATE_DECISION_TYPES` branch routes keyboard decisions through the
  same path as button clicks.
- **Reversibility**: re-selected the already-decided `Priya Natarajan`
  row and clicked Redact; it updated cleanly to `Priya Natarajan (person)
  -- Redact` with no locking behavior, the completion counter and per-
  decision-type tally (`Keep 2 - Rename 0 - Redact 1 - Ignore 0`) updated
  correctly, and the same acknowledgement + auto-advance rhythm fired again.

Also confirmed downstream: surface text is preserved rather than renamed to
canonical form for linked candidates (`Andrew (person) -- Keep`, `Maria
(person) -- Keep`), and every other candidate (`Andrew Goodloe`, `Andrew
Jackson`, `Andy Jackson`, `Andy Goodloe`, `Carlos Mendez`, `Elena Mendez`)
remained fully independent and untouched by any of this session's decisions
-- both pre-existing invariants, unaffected by this revision.

No defects found.
