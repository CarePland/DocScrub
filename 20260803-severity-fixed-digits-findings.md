# Severity-Fixed Section Digits + Kind-Group Change/Redact All

**Date:** 2026-08-03 (fourth pass)
**Reported on:** "Possible numeric pattern," Ambiguity Check.
**Decisions taken:** severity-fixed digits · both Change all and Redact all ·
fix the term sections in the same pass (all three per AG).

---

## 1. The defect this uncovered

Digits were assigned **positionally**: *"the last numbered action lands
exactly on the ceiling,"* so one action was ⑨, two were ⑧⑨, three ⑦⑧⑨. ⑨
meant *the rightmost button*, not a kind of move.

The term sections declare `[Ignore all, Redact all]`. So today, live:

> **⑧ = Ignore all, ⑨ = Redact all**

The destructive action sat on the one key the codebase explicitly teaches
as *"the section's main move — a reviewer who learns '9 is the section's
main move' is never wrong."* On the sections a reviewer clears fastest.

AG twice called ⑨ the leave-as-is key in the conversation that produced this
change. **The scheme had already mistaught its own author** — which is the
strongest evidence available that it was wrong, and why the ⑦ instinct in
the original request was a fix rather than a preference.

Naively appending "Redact all" to the numeric-pattern group would have made
it *worse*: two actions → Accept demoted to ⑧, Redact promoted to ⑨.

---

## 2. The replacement

**The higher the digit, the safer the action.**

| Digit | Severity | Meaning |
| --- | --- | --- |
| ⑨ | safe | Keep / Ignore / accept the recommendation |
| ⑧ | change | Rename — opens the replacement editor |
| ⑦ | redact | Redact — opens the replacement editor |
| ⑥, ⑤… | safe overflow | a second agree-move (see §3) |

A digit means the same thing on every section at every count, and the key
nearest muscle memory cannot destroy anything. **Gaps are meaningful**: a
section offering Ignore-all and Redact-all numbers ⑨ and ⑦ with no ⑧ —
"Change isn't available here" rather than silently promoting Redact. (AG,
unprompted: *"It's fine to have 7 and 9 without 8 if so."*)

Severity is **derived** from the operation each action already carries
(`sectionActionSeverity`), never declared beside it — a vocabulary author
cannot get a digit wrong because they never state one.

### Term sections, fixed

`institutional` / `calendar` / `common-words`: **⑨ = Ignore all, ⑦ = Redact
all** (was ⑧ / ⑨). Pinned by a suite check asserting no declared vocabulary
anywhere puts a redact action on ⑨.

---

## 3. ⚠️ The first draft was wrong, and the suite caught it

My first cut numbered only the *first* action of each severity and left a
second unnumbered — which I described in the code as a small cost landing on
"a secondary alternative."

**It wasn't small. Six live vocabularies would have silently lost a keycap**
— shortened-names (both tiers), nicknames, org-aliases, acronyms (both
tiers). The safe class is genuinely multi-valued in a way the destructive
classes are not: "Use full names" beside "Keep shortened names" are two
different agree-moves a reviewer picks between, not a primary and a leftover.

Fixed by overflowing second safe actions to **⑥ and downward — below the
reserved ⑧/⑦ pair, never through it**, so a Change-all or Redact-all added
later can't find its digit taken. Nothing loses a keycap.

**Accepted cost:** digits don't always read in order across a row (⑨ ⑥ ⑦ is
real). What's preserved in exchange is the property that matters — one digit,
one meaning, everywhere, and ⑨ never destructive.

**Future refinement, deliberately not taken:** the honest ladder has four
classes — leave-alone / accept-DocScrub's-value / use-my-typed-value / redact
— mapping onto ⑨⑧⑦⑥ with no overflow at all. That moves Redact off ⑦, the
digit you specifically chose, so it's a conversation, not a refactor.

---

## 4. Kind-group Change all / Redact all

Non-acronym structural kind groups now offer all three:

```
⑨ Accept All Remaining    ⑧ Change all…    ⑦ Redact all…
```

**One key, then the inline editor** — as requested, and not a new
interaction: Type Check's cards already answer `c`/`r` by opening this same
editor over the type's remaining members, and the editor's render tail puts
the cursor in the blank. So ⑦ → type → Enter is the whole gesture.

New editor scope `relationship-kind` (rather than borrowing `bulk`) because
the narration names the kind and the id set is derived per-card:
`remainingIdsInRelationshipKind` mirrors `acceptAllInRelationshipKind`
exactly — addressed proposals skipped, **each card's unchecked members
excluded**. A reviewer who unticks a member on one card and then presses ⑦
must not have that member redacted anyway.

**Offered on every non-acronym kind, not numeric patterns alone** — a digit
meaning Redact-all on one structural group and nothing on the next is the
per-surface drift this pass removes. The acronym group is left alone: its two
accepts *are* its change vocabulary.

---

## 5. Verification

- `tsc --noEmit` clean; `npm run build` clean.
- **46 of 46 suites pass.**
- `section-action-digits-verification.ts` substantially rewritten: 52 checks
  (was ~40). The positional expectations were **superseded, not weakened** —
  and the defect that superseded them is now itself pinned. New properties:
  ⑨ is never destructive in any arrangement; a digit means the same thing
  regardless of position; overflow steps down from ⑥ and never through ⑧/⑦;
  the real term-section vocabulary numbers ⑨/⑦; no declared vocabulary
  repeats a destructive severity.
- One `ui-smoke.ts` string assertion updated — it belonged to the concurrent
  Review Scope work and pinned a call-site literal that gained an argument.
  The invariant (gate and renderer read one assignment) is unchanged.

**Pending live-browser validation**

1. ⑦ on a numeric-pattern card opens the editor with the cursor in the blank;
   type + Enter redacts the whole group.
2. ⑧ likewise for Change all.
3. Term sections render ⑨ Ignore all / ⑦ Redact all, and **⑧ does nothing**
   there rather than falling through to something surprising.
4. The ⑨⑥⑦ arrangement on acronyms/shortened-names — whether the out-of-order
   digit reads as a system or as a mistake. **The judgment call I'd most
   like your eyes on.**
5. Item digit ceiling drops to ⑤ where safe-overflow reaches ⑥; confirm
   identity options truncate rather than collide.
6. Unticking a member on one card, then pressing ⑦, leaves that member alone.

---

## 6. Concurrent editing, again

`app.ts` reported as modified on disk mid-edit, and the `ui-smoke` failure
above came from Review Scope checks added during this session. Everything
reconciles and all 46 pass together — but four passes from me landed in that
file today alongside your work, and the digit change touches a shared
policy module. Worth a look at the combined diff before you trust it.
