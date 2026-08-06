# Sectioned Queue — Row Selection & Bulk Label Correction

**Date:** 2026-08-03 (second pass, on top of the side-by-side focus pane)
**Surface:** `renderSectionedQueue` — Item Check (By Category) and Ambiguity Check.

---

## 1. The label defect — confirmed, and worse than reported

AG asked whether the section button should say "Ignore all" because
"isn't that what the (9) button is doing?" **Yes.** `triageQueue.ts` read:

```ts
bulk("Leave all as-is", "Ignore", "Treat every remaining item as institutional terminology…")
```

The button dispatched **Ignore** while wearing the words of **Keep as-is** —
and the cards directly beneath it render `[Keep as-is] [Change] [Redact]
[Ignore]` as four distinct decisions. Same words, different decision, one
screen. Pressing it turned the section Ignore-purple, contradicting the
unified decision color system's premise in the one channel (words) that
system does not police.

Three sections carried it: institutional, calendar, common-words.

**The fix was already sitting in the codebase.** `decisionLabels.ts` defines
`DECISION_BULK_ALL_LABEL.Ignore = "Ignore all"` and
`DECISION_BULK_SELECTED_LABEL.Ignore = "Ignore selected"` — for exactly this
— and these call sites simply weren't consulting it. New `bulkScoped(decision,
hint)` derives both scope forms from that map, so the rename and the
selected-scope wording arrive together and a future decision kind gets both
for free. Not new vocabulary: "derive, don't duplicate," now the fourth time.

**Corroboration:** Type Check's own bulk bar has used `decisionBulkLabel(…,
"all")` all along — "Keep all as-is (135)", "Ignore all (135)"
(app.ts:7397–7404). This rename moved the queue *toward* Type Check.

### Per AG: the two stragglers stay

`"Not people — leave as-is"` and `"Not acronyms — leave as-is"` also dispatch
Ignore and were left alone. They are a different shape: the `Not X —` prefix
disambiguates, and they name a category *conclusion* rather than a bare
decision. That distinction became load-bearing — see §2.

---

## 2. Two label families, and why it matters for selection

Scoping buttons to a checked subset forced the vocabulary to split:

| Family | Examples | Selected form |
| --- | --- | --- |
| **Scope-naming** | "Ignore all", "Redact all", "Accept All Remaining" | required — "all" would lie |
| **Conclusion-naming** | "These are people's names", "Keep abbreviations", "Not people — leave as-is", "Use full names" | none — already scope-neutral |

A conclusion-naming label is a statement about what the items *are*, equally
true of three of them as of fifty. Genericizing them to "Keep selected"
would destroy the category conclusion that is the entire point of the
phrasing. `SectionAction.selectedLabel` is present on the first family only,
and `triage-queue-verification.ts` now asserts that correspondence as a rule
over the whole vocabulary (`/\ball\b/` ⇒ has a selected form, and nothing
else does) rather than as string comparisons a fourth section could evade.

The reviewer still learns the scope in both cases: the heading carries an
`N selected` indicator whenever a selection is active. Stating scope once in
the heading beats smuggling a count into every button — the same principle
`TRIAGE_SECTION_EXPLANATIONS` already follows.

---

## 3. Selection

- **Reuses `selectedCandidateIds`** — the Milestone 2 set Item Check's list
  view already owns. No second selection model.
- **Undecided rows only**, per AG. Section actions already act on remaining
  items exclusively, so a checkbox on a decided row would let a reviewer
  build a selection whose count overstates what any button changes.
- **Fixed-width slot on every row.** `.triage-state` beside it is a
  fixed-width alignment slot; rendering the checkbox only where it applies
  without reserving its space would shift every *completed* row's token half
  a character left of its neighbours', turning the column that slot exists
  to create back into a ragged edge.
- **Tri-state select-all.** `indeterminate` when partially checked —
  otherwise a partly-checked section reads as unchecked and the next click
  destroys work. From indeterminate, clicking selects all (additive).
- **The select-all follows the buttons, not the section**: title line at 0/1
  tiers, tier heading at 2 — mirroring `emitSectionActions`' `numbered`
  argument for the same reason. A checkbox whose set no adjacent button acts
  on looks broken.
- **Checkbox clicks `stopPropagation`** over the row's own click handler, or
  building a selection would drag the detail pane along one item at a time.

### Scope is computed in exactly one place

`headingActionScope` lives inside `headingSectionActions` — the single
builder that **both** the renderer (which paints keycaps) and
`activeScopeSectionActions` (which the digit handler runs) consult. Any
other placement would let the button a reviewer *reads* and the digit they
*press* scope to different sets: the ONE-DIGIT-SPACE failure, one level up.

Rule: a heading scopes to its own remaining items ∩ the checked set,
falling back to all-remaining when that intersection is empty. Selection is
global state, but every consumer here is section-local, so checking items in
Institutional Terminology cannot change what Acronyms' buttons do.

---

## 4. Keyboard — no new binding, deliberately

AG: *"If the existing Tab rulebook won't work here, then Shift+Space."*

It works. Verified in source:

1. `handleTriageKey` returns false when `tag === "input"` — Space is **not**
   intercepted and toggles the checkbox natively.
2. `shouldIgnoreKeyboardEvent` (keymap.ts:120) already blanket-suppresses app
   keys while an input holds focus, so nothing else fires behind it.
3. The region model's universal escape rung **already names this control**:
   *"a row checkbox reached by native Tab … Without this, native Tab into a
   row control was a dead end with no keyboard exit at all."* Escape backs
   out to Review mode.
4. `.triage-row` is not a `.group-row`/`.member-row`, so `isRovingFocusElement`
   correctly does not claim it.

Tab reaches it, Space toggles it, Escape leaves. Adding Shift+Space would
have duplicated a working native affordance with a second grammar to learn.

---

## 5. Verification

**Suite-verified**

- `npx tsc --noEmit` clean; `npm run build` clean (full emit).
- **44 of 44 `verify/*.ts` suites pass** (count re-taken, not remembered).
  Zero regressions; no expectation weakened.
- 6 new checks in `triage-queue-verification.ts`: no Ignore action wears
  Keep's "all as-is" wording; the three term sections say "Ignore all"; the
  two surviving "leave as-is" Ignore labels are exactly the conclusion-naming
  pair AG chose to keep; every "all" label declares a selected form and no
  other does; selected forms come from the canonical map.
  One stale check *renamed*: `"term sections lead with the Ignore decision
  (Leave all as-is)"` asserted only `op.kind` — its title described a label it
  never checked, which is how the defect survived a suite that touched it.
- 9 new `ui-smoke.ts` structural checks covering §3 and §4.

**Pending live-browser validation**

1. Checkbox column alignment against a section of mixed decided/undecided rows.
2. Tri-state select-all, including the indeterminate → select-all click.
3. ⑧/⑨ keycaps act on the *selected* subset when one exists — the invariant
   §3 exists to protect, and the only one whose failure is silent.
4. Label swap: `Ignore all` → `Ignore selected` with the heading's `N selected`.
5. Tab → checkbox → Space toggles → Escape exits, on the real surface.
6. A checkbox click does not move the detail pane.
7. Selection cleared after a scoped action, painted in the same frame.
8. Whether the checkbox column reads as clutter in the now-narrower (40%)
   item grid. Unverifiable here; the honest risk of adding a control to a
   grid that was just made narrower on purpose.

**Not verified anywhere:** rendered pixel widths (no headless browser in this
environment).

---

## 6. Judgment calls

1. **`Accept All Remaining` also scopes to the selection** ("Accept Selected"),
   though only the tier-action buttons were named in the instruction. Item
   Check's triage view has checkboxes and exactly this one button; leaving it
   unscoped would have made the checkboxes there do nothing visible.
2. **No count in the selected label** (`Ignore selected`, not `Ignore selected
   (3)`) — the heading indicator carries it. This diverges from Type Check's
   `Ignore all (135)`; §5 of the Type Check spec proposes settling it toward
   the heading.
3. **Selection cleared *before* dispatch** rather than after: the ids are
   already captured, and the dispatch paths end in their own `render()`, so
   clearing first paints the emptied checkboxes in the same frame as the
   decision. Observably different only if a dispatch failed in a way that left
   work undone, which these ops cannot.
4. **`selectedCandidateIds` is not cleared on stage or view-mode change.**
   Pre-existing behavior, deliberately untouched — but it now has a second
   surface, so a selection built in Item Check's list view is live in the
   triage view. Believed harmless (scope is section-local) but **flagged as a
   real question**: should switching stages clear the selection?
