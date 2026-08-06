# Type Check Chords + Completion-Path Audit

**Date:** 2026-08-03 (sixth pass)

---

## Part 1 — Opt/Alt on Type Check, and everywhere else that applies to a larger population

Type Check's four bulk buttons were built inline in the renderer, so nothing
but the renderer knew they existed and the chord handler had nothing to
resolve against. They are now `QueueSectionAction` descriptors
(`typeBulkActions`), joining the same list the sectioned-queue headings
produce — one shape, one chord vocabulary, one keycap renderer. Commands,
counts, editors and audit are untouched; only the description of them moved.

```
Keep all as-is (42)   Opt K        Change all…   Opt C
Redact all…           Opt R        Ignore all (42)   Opt I
```

**One resolver now covers every stage** (`groupScopeActions`), so no surface
can advertise a key it doesn't answer to.

Two deliberate scope calls:

- **The type chord works from a member row too.** Scope is the *open type*,
  regardless of whether the cursor descended into a member. That is the whole
  point of a modifier meaning "wider scope" — bare `R` on a member decides
  that member, `Opt R` still redacts the type. Bare letters keep their
  existing card-targeted meaning (`handleTypeCardKey`, unchanged).
- **Group Check is deliberately excluded.** Its group rows already answer
  bare `K/C/R/I/F` at group scope through the domain keymap — the group *is*
  the focused item there, so a modifier would be a second key for a scope the
  reviewer never left. Adding one would mint exactly the duplicate
  accelerator this design exists to avoid.
- **A finished type offers no chords**, so its disabled buttons never
  advertise keys that would refuse.

### Also fixed: the Type Check focus was scrolling to the wrong cursor

*"I try to nav and the focus items are so far out of the window I can't tell
what I'm doing."*

Same seam as the structural card cursor, on a third surface.
`state.focus.target.itemId` in Type Check is the **type**, not the member —
the domain has no cursor for a member row — so arrowing through a 143-entity
type moved `typeCheckCursor` (UI state) while `scrollFocusedRowIntoView` kept
aiming at the type card far above. The highlight and the viewport were
following different cursors.

Member rows carry `data-type-member-id`, so the lookup was already there.
`.type-member-row` had to be **added** to RX-04's `scroll-margin-top` rule —
it had never been a scroll target, so nothing cleared the sticky chrome for
it and the row would have arrived underneath the header.

---

## Part 2 — The completion-path audit

**Method:** every raw `dispatcher.dispatchReview(` site (which bypasses the
visible-order advance choke point) versus the 18 that route through it, then
each raw site checked for whether it advances by other means.

### The results

| Path | Before | Now |
| --- | --- | --- |
| Per-item decisions, Item Check selection bulk, per-card relationship bulk, `applyTypeBulk` | ✓ choke point | unchanged |
| `runSectionAction` | ✓ (2026-08-02 nav-order fix) | unchanged, logic extracted |
| Unrelated / `dismissRelationship` | ✓ `advanceStructuralCursor` | unchanged |
| `completeSplitReview` | ✗ cursor left on a hidden row | ✓ fixed (fifth pass) |
| **`acceptAllInSection`** | ✗ **no advance at all** | ✓ shares the extracted advance |
| **`acceptAllInRelationshipKind`** | ✗ **no advance at all** | ✓ `advanceStructuralCursor` |
| **`relationship-kind` editor confirm** | ✗ advanced the wrong cursor | ✓ card cursor when one is set |

### 1. `acceptAllInSection` — the worst finding

The 2026-08-02 NAV-ORDER FIX was written for exactly this complaint (*"I
clicked 'Leave all as-is' on Institutional Terminology and then apparently
ended up on New…"*) and landed in `runSectionAction`. **`acceptAllInSection`
sits one function away, is reachable from the same heading, and still ended
at a bare `render()` with no advance whatsoever.**

Fixing it in place would have left a third copy waiting to drift, so the
advance is now one function — `advanceAfterSectionCompletion` — that both
call. The section, not whatever holds focus, is the anchor: the cursor
continues from the section's *last* member in displayed order, because the
section is the thing just completed.

### 2. `acceptAllInRelationshipKind` — the one you reported

The kind group's ⑨ (Accept All Remaining / Accept as acronyms / Accept
written out) was the only bulk path on the structural surface that never
moved the cursor — while both its neighbours did. Now calls
`advanceStructuralCursor` anchored on the group's **last** proposal, so the
cursor continues past everything just accepted; that function already handles
"every card is addressed" by continuing into the stage's rows.

### 3. `relationship-kind` confirm — mine, from the fifth pass

`Opt C` / `Opt R` are fired while standing on a **card**, but the choke point
advances the **row** cursor — which, per the rows-then-cards seam's own note,
is merely parked wherever the row half was left, often far above and already
decided. Advancing it yanked the viewport somewhere unrelated. While the card
cursor is set, the cards are the working object, so the card advance applies.

### The shape all four shared

Something completes, and the thing meant to catch the cursor either never
ran, ran on the wrong cursor, or caught it somewhere that no longer exists.
The durable defence isn't four fixes — it's that **there is now one advance
function per surface** (rows: `advanceAfterSectionCompletion`; cards:
`advanceStructuralCursor`; items: the choke point), so a new completion path
has an obvious thing to call rather than an obvious thing to forget.

---

## Verification

- `tsc --noEmit` clean; `npm run build` clean; **46 of 46 suites pass.**
- 10 new `ui-smoke.ts` checks across both parts, including a ceiling on the
  number of raw `dispatchReview` sites — so a new bypassing call site fails
  the suite rather than shipping silently.

### Pending live-browser validation

1. `Opt K/C/R/I` on an open type, **from a member row as well as the card**.
2. Type Check member navigation keeps the highlighted row in view, clear of
   the sticky header.
3. ⑨ Accept All Remaining on a kind group advances to the next unaddressed
   card, and into the rows when the cards run out.
4. `Opt R` on a kind group lands the cursor on the next **card**, not
   somewhere in the rows.
5. Accept All Remaining on a row section advances to the next unresolved
   item (this one has never worked).
6. Group Check still answers bare `K/C/R/I/F` at group scope with no `Opt`
   equivalent — confirm that reads as consistent rather than as an omission.
