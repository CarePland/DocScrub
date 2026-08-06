# Type Check — Selection & Bulk Application

**Status:** Specification. Not implemented. Prepared to go.
**Date:** 2026-08-03
**Depends on:** the side-by-side focus pane and row selection landed in the
sectioned queue the same day (`20260803-side-by-side-focus-pane-findings.md`,
and §7 below).

---

## 0. The instruction

> *"Type Check is really great. It will absolutely win this if it can more
> closely mirror the layout in Item Check. However, I have specific ideas
> here. 1) Allow checkbox selection of these items individually. 2) Building
> on that, Select All/Deselect All via a single checkbox at top. 3) A global
> application button system of [(1) These are all people], [(2) These are
> not people]. this has been done elsewhere and there are existing workflow
> directions. I think (2) applies ignore to them, for instance. 4) Once
> someone starts checking items, I'd like to allow the detail area to
> collapse. However, that would jerk the grid around. So this is the only
> question really."* — AG

---

## 1. Answer to (4), the only question

**Adopt the side-by-side layout first, and the question dissolves — but
"collapse" is the wrong verb for what should happen.**

Today Type Check stacks vertically: type cards, then the focused entity's
detail panel inline, then the entity list. Collapsing the panel in that
arrangement moves everything below it up, which is the jerk. That is the
same defect the sectioned queue had this morning, and it has the same fix:
put the panel in its own column beside the list. Then the panel's height
is a property of the *left* column and the list's rows never move —
vertical motion is structurally impossible, not merely avoided.

**But do not then collapse the pane to nothing**, because that trades a
vertical jerk for a worse horizontal one: an empty 60% column either wastes
the space or gets reclaimed, and reclaiming it re-wraps the item grid from
two columns to five under the reviewer's cursor. Horizontal reflow of the
thing you are mid-click on is worse than vertical.

### The recommendation: the pane changes *content*, never size

Give the left pane two modes:

| Reviewer is… | Left pane holds |
| --- | --- |
| deciding one item at a time | that item's detail panel (today's content) |
| building a selection (≥1 checked) | the **selection workspace**: "12 selected", the global application buttons from (3), and what they will do |

Nothing moves. Ever. Only the pane's contents swap — and they swap to
exactly what is useful in the mode the reviewer just entered. The reviewer
who starts checking boxes was not reading the detail panel anyway; they get
their bulk controls in the place their eyes already are, at a fixed screen
position, with the item list beside it completely still.

This also settles where (3)'s buttons live, which the instruction leaves
open. They are not a third row of chrome competing with the existing
per-type bulk bar — they are what the workspace *becomes* when a selection
exists.

**Fallbacks, in order,** if the mode-swap proves wrong in use:

1. **Literal collapse, fixed columns.** Pane empties, `grid-template-columns`
   untouched. Zero motion, at the cost of visible empty space.
2. **Scroll-anchor compensation** in a stacked layout: measure the panel
   height before collapse and subtract it from `scrollTop`. Keeps the list
   visually still without side-by-side. Not recommended — it is fragile
   across sticky-chrome height changes, and `--workspace-chrome-height` is
   already a measured, moving quantity here.

---

## 2. (1) Per-item checkboxes

Direct reuse of what landed today. Type Check's entity rows are candidate
rows (`unresolvedTypeMembers`, `group.candidateIds` — app.ts:7260), so
`selectedCandidateIds` works unchanged. **Do not introduce a second
selection model.**

- Checkbox on **undecided rows only**, in a fixed-width `.triage-check-slot`
  so decided rows stay column-aligned (see §7's note — this is the
  alignment trap, and it is not obvious until you see a mixed list).
- `stopPropagation` on the checkbox's click, or building a selection drags
  the detail pane along one item at a time.
- **No new key binding.** A native `<input type="checkbox">` is already
  fully covered: Tab reaches it, `shouldIgnoreKeyboardEvent` (keymap.ts:120)
  leaves Space native so it toggles, and the region model's universal escape
  rung already names "a row checkbox reached by native Tab" as its reason
  for existing (app.ts, gate 2). Verify this holds on the Type Check surface
  before assuming it — the guard is `tag === "input"` inside
  `handleTriageKey`, and Type Check does not route through that handler.
  **If it does not hold, Shift+Space, per AG.**

## 3. (2) Select all / deselect all

`appendHeadingSelectionControls(host, ids, state)` (app.ts) is already
generic over host and id list — reusable verbatim.

- **Tri-state.** `indeterminate` when some but not all are checked; without
  it a partially-checked type reads as unchecked and the next click destroys
  work the reviewer meant to add to. From indeterminate, clicking selects
  all (the additive reading).
- Scope is the type's **remaining** items, matching (1).
- Place it on the row that owns the bulk buttons — the `REMAINING` line
  beside `Keep all as-is (135)` — not on the `People (135 of 143 remaining)`
  title. A checkbox that selects a set no adjacent button acts on looks
  broken.

## 4. (3) Global application buttons

### The precedent AG remembered is real, and his guess is right

`triageQueue.ts` `AMBIGUITY_TIER_ACTIONS["shortened-names"]["needs-review"]`
already declares, verbatim:

```ts
bulk("These are people's names", "Keep",  "Treat every remaining item as a person's name, kept as written."),
bulk("Not people — leave as-is", "Ignore", "Treat every remaining item as not a person reference; the text is left alone."),
```

So: **(2) does apply Ignore**, exactly as AG guessed. **Reuse this wording
rather than "These are all people" / "These are not people"** — it is
already shipped, already verified, and already *conclusion-naming*, which
(per today's `SectionAction.selectedLabel` rule) is precisely why it stays
correct when acting on a checked subset rather than everything.

### Generalizing across nine types

Type Check has nine types, so the pair needs a per-type vocabulary:

```ts
export const TYPE_CHECK_ACTIONS: Partial<Record<SemanticTypeId, SectionAction[]>> = {
  people:  [ bulk("These are people's names", "Keep",   …),
             bulk("Not people — leave as-is", "Ignore", …) ],
  emails:  [ bulk("These are email addresses", "Keep",  …),
             bulk("Not email addresses — leave as-is", "Ignore", …) ],
  …
};
```

Declared as `SectionAction[]` **on purpose**: routing it through the
existing `headingSectionActions` → `runSectionAction` path inherits digit
assignment, keycap rendering, selection scoping, status narration, and
audit for free, and the digit assigner never learns Type Check exists.
Reimplementing any of that locally is the failure this shape prevents.

### ⚠️ The digits are ⑨ and ⑧, not ① and ②

The instruction writes "(1)" and "(2)". Those numbers are already spoken
for: item-level chips and identity options number **upward from ①**, while
section-level actions number **downward from ⑨**
(`sectionActionDigitAssignments`, the ONE-DIGIT-SPACE discipline). A
section-level button wearing ① would collide head-on with the focused
item's own first suggestion.

So the pair renders **⑨ These are people's names / ⑧ Not people — leave
as-is**, matching the sectioned queue exactly. Flagging because this is a
place where doing what was literally asked would break an invariant the
codebase already enforces in one function on purpose.

*Related:* AG referred to ⑨ as "leave all as-is" twice in this exchange
when ⑨ is in fact *Redact all* and ⑧ is the safe one. Worth watching in
live use — if the digits are not sticking, the destructive/safe ordering is
the wrong thing to be uncertain about, and reversing the assignment order
so the safest action always takes ⑨ is a cheap change.

## 5. Layout mirroring

Type Check's bulk bar **already** uses `decisionBulkLabel(…, "all")` —
"Keep all as-is (135)", "Ignore all (135)" (app.ts:7397–7404). Today's
sectioned-queue rename moved *toward* Type Check's vocabulary, not away
from anything. The two surfaces now agree.

One residual inconsistency to settle: Type Check puts counts in the labels
(`Ignore all (135)`), the sectioned queue puts the count in the heading
(`3 selected`). Pick one. Recommendation: the heading, because a count
inside a label has to be repeated on every button in the row.

## 6. Build order

1. Side-by-side split for Type Check (reuse `.triage-split`, or generalize
   it — the class name should probably lose its `triage-` prefix at that
   point, which is a rename with call sites in two files).
2. Checkboxes + select-all (§2, §3) — mechanical reuse.
3. `TYPE_CHECK_ACTIONS` + routing through `headingSectionActions` (§4).
4. Pane mode-swap (§1) — last, because it is the only genuinely new
   behavior and it wants the other three in place to be judged.

Steps 1–3 are extensions of landed patterns. Step 4 is the design bet.

## 7. Inherited constraints — read before starting

- **Fixed-width checkbox slot**, or decided rows lose column alignment.
- **`measuredColumnCount` needs a cursor anchor** on any grid whose column
  count can differ per section (retired invariant, 2026-08-03).
- **Selection scope must be computed in ONE place** that both the renderer
  and `activeScopeSectionActions` consult, or the button a reviewer reads
  and the digit they press can act on different sets.
- **Decided rows are excluded from scope before intersecting**, so a
  heading's count can never overstate what its button changes.
- **Conclusion-naming labels must not be genericized** into "Keep selected"
  — the category conclusion is the point of the phrasing.
