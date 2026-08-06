# Group-Scope Chords (Opt/Alt + K C R I U)

**Date:** 2026-08-03 (fifth pass)
**Supersedes:** the severity-fixed digit band from the fourth pass, written
roughly two hours earlier.

---

## 1. What changed, and why the previous pass was wrong

**AG:** *"R and C … may be true within an item, but not across all items.
There does need to be a 'specialness' about the key command — it needs to be
acknowledged that this is a higher scope level."*

Correct, and the codebase had already reached the same conclusion from the
other direction. `handleScopeModeKey`'s mis-target guard **refuses** plain
`K/C/R/I` whenever a wider scope is active, on the recorded grounds that
*"any candidate-targeted key must first ask what the working object is,"*
and its refusal text says outright: *"the section buttons decide whole
sections."*

So my earlier suggestion — hand group scope to `⇧R` — would have re-opened
the exact failure that guard exists to prevent. A modifier answers the
"which object?" question **inside the keystroke**, which is why the bare
letter can go on meaning precisely what it always meant.

### The chords

| Key | Effect |
| --- | --- |
| `Opt K` / `Opt C` / `Opt R` / `Opt I` | apply that decision to the whole active group |
| `Opt U` | Unrelated — structural cards only |

Scope is resolved through `activeScopeSectionActions` — **the same list**
the heading renderer paints keycaps from and the digit handler runs. A chord
can only ever fire a button the reviewer can actually see, on the scope the
heading is describing. That is the ONE-DIGIT-SPACE discipline extended to a
second key population rather than a parallel mechanism invented beside it.

### Why ⌥ and not ⌃

`⌃K` and `⌃U` are macOS system text-field bindings (kill-to-end-of-line,
delete-to-start) — and the Change/Redact flows *open a text field*, so they
would collide inside the very workflow that uses them. `⌃R` is reload and
`⌃U` view-source on Windows/Linux Chrome; a missed `preventDefault` on a
redaction key reloads the app mid-review.

⌥'s freedom on this app's target platforms was already investigated and
written down when the filter column took ⌥+Arrows. This reuses that finding
rather than re-litigating it. Cost: ⌥+letter emits composed characters on
macOS (`⌥R` → `®`), so the handler matches **`event.code`** — the same
layout-independence precedent the digit handler already set.

### "Opt" spelled out, platform-detected

Per AG (*"I never have memorized the weird glyphs"*), caps read **`Opt R`**
on a Mac and **`Alt R`** on a PC, never `⌥`. One module-level constant
(`OPTION_KEY_LABEL`), triple-guarded: `userAgentData` → legacy `platform` →
user-agent → default. Defaults to **"Alt"** when undetectable, deliberately:
a Mac user reading "Alt" still finds the key (it's printed on the same
keycap), whereas a PC user reading "Opt" has no key by that name at all.

One spelling function (`groupScopeChordLabel`) feeds both the keycap and the
command-bar legend, so painted and handled can't drift.

---

## 2. The digit scheme, unwound

This is the entailed consequence, and it is a **reversal of this morning's
fourth pass** — flagging it rather than burying it.

Decision-kind actions now carry a chord and are **excluded from numbering**
(one control with two accelerators is one too many). What remains in the
digit space is only *named conclusions that have no letter*: "Use full
names", "Accept as acronyms", "Accept All Remaining" — where each item takes
its **own** suggestion, so no single letter describes the action. That is
the population digits exist for, and it is why the digit space doesn't
simply disappear.

With destructive actions gone from it, digits revert to plain **positional**
assignment from ⑨. Every vocabulary collapses to **at most two** numbered
actions. The severity band, `SECTION_ACTION_DIGIT`, and the ⑥ overflow that
produced the ⑨⑥⑦ arrangement you flagged are all gone.

**The safety property survives — as a structural fact rather than an
arithmetic scheme.** A destructive action isn't numbered *at all*, so ⑨
cannot be Redact all. The suite asserts exactly that over the real
vocabulary:

> *"NOTHING DESTRUCTIVE IS EVER NUMBERED, anywhere in the declared
> vocabulary"* — and *"every action is reachable: each has a chord OR a
> digit, never neither, never both."*

That second one is the invariant worth keeping long-term: it catches both a
new action nobody can reach and a new action with two competing keys.

---

## 3. Verification

- `tsc --noEmit` clean; `npm run build` clean.
- **46 of 46 suites pass.**
- `section-action-digits-verification.ts` rewritten again (47 checks). The
  severity expectations were **superseded, not weakened**; the properties
  they protected are re-pinned in the stronger structural form above.
- 8 new `ui-smoke.ts` chord checks: `event.code` matching; scope borrowed
  from `activeScopeSectionActions`; editor owns every key; never both a
  chord and a digit; modifier spelled out and platform-detected; guarded
  fallback; one spelling function for cap and legend; the chord cap's CSS.

**Pending live-browser validation**

1. `Opt R` on a numeric-pattern kind group opens the editor with the cursor
   in the blank; type + Enter redacts the group.
2. `Opt K` / `Opt I` commit immediately with narration.
3. The cap reads **`Opt R`** on your Mac (this is the one I most want
   eyes on — the detection is untestable here).
4. A chord with no matching action refuses and *names what the group does
   offer*, rather than dying silently.
5. Term sections show ⑨ only for Accept-style actions; Ignore all and Redact
   all now wear `Opt I` / `Opt R`.
6. `Opt`+arrows still moves the filter column — the two ⌥ handlers must not
   shadow each other (they take disjoint keys, but confirm).

---

## 4. Your auto-nav report — first look, not yet fixed

> *"when I complete a global update it doesn't auto-nav me to the next item
> needing help."*

I looked; here's the likely shape so it's not lost.

`runSectionAction` (row sections) **does** advance — it carries the
2026-08-02 NAV-ORDER FIX that snapshots displayed order and re-selects the
first unresolved item after the section's last member, falling through to
`continueIntoStructuralCards`.

`acceptAllInRelationshipKind` (the structural kind-group accepts — ⑨ *Accept
All Remaining*, *Accept as acronyms*, *Accept written out*) **does not**. It
ends at `setStatus(...)` + `render()` with no cursor move. Compare the
*Unrelated* button two functions away, which calls `advanceStructuralCursor`
on success, and the per-card bulk path, which routes through
`dispatchReviewWithVisibleAdvance`. So the group-level accept looks like the
one bulk path on that surface that never got an advance — consistent with
"global update doesn't move me on."

My new `Opt C` / `Opt R` group actions go through
`dispatchReviewWithVisibleAdvance`, so they *should* advance — but they
advance the **row** cursor, and if you fired them while standing on a
structural card the cursor may land somewhere unrelated. That's a second,
distinct bug in the same area and it would be mine.

Not touching it this pass — it wants its own diagnosis, and the fix probably
belongs in one place (a group-level advance that respects
`structuralCardFocusPending`) rather than sprinkled across call sites. Say
the word and I'll take it.

---

## 5. Standing note

`app.ts` changed on disk under me again this pass — the concurrent work had
already added the `relationship-kind` editor's render site, which my fourth
pass left dangling (a scope with a draft-cache key and a confirm path but no
render site — exactly the inline-editor-contract trap, and I should have
caught it). Five passes from me landed in that file today alongside yours.
Worth reading the combined diff before trusting it.
