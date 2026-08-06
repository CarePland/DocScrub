# Action Cluster — content-vs-controls reflow

**Date:** 2026-08-03 (third pass)
**Reported on:** "Possible acronym" cards, Ambiguity Check.
**Instruction:** *"allow KCRU buttons to move right, pushing the rightmost
down … three buttons on top at first, and ultimately a small rectangle of
buttons 2x2"* — plus *"we should abstract this if possible in case it needs
to be applied elsewhere."*

---

## 1. What was wrong

`.relationship-card-header` was declared (2026-07-30) to keep the whole
title/button line on one horizontal row: `flex-wrap: nowrap` on the header,
on the chip group, and on the button group, with the chips carrying
`overflow: hidden; text-overflow: ellipsis` as the pressure valve.

That made the **chips** the shrink victim. At a real acronym expansion the
card rendered `Information Technology S` — the reviewer lost the very text
they were deciding about, in order to preserve four button labels they had
already read a hundred times.

**Latent bug found on the way past:** the ellipsis fallback never worked.
`text-overflow: ellipsis` does nothing on a `display: inline-flex` element,
and `.preferred-action` is one. So the chip has always *clipped mid-letter*
with no ellipsis to signal it — which is why the screenshot shows a hard cut
rather than `Information Technology…`. The mitigation that was supposed to
make truncation legible had never once run.

---

## 2. The abstraction

Per AG, built as a reusable utility, not a fix to the card that reported it.

**The principle, stated in the stylesheet:** *known controls yield SHAPE
before unknown content yields CHARACTERS.* A fixed-membership control group
whose labels the reviewer already knows can rearrange for free; variable
content they haven't read yet cannot lose characters.

**Three classes, applied by composition** (so a second surface adopts this
by adding class names, never by copying CSS):

| Class | On | Role |
| --- | --- | --- |
| `.action-cluster-host` | the row | flex row, content anchored top |
| `.action-cluster` | the button group | wraps, right-aligned, yields first |
| `.action-cluster-content` | the protected side | claims the width given back |

**Mechanism is ordinary flex wrapping** — the ladder falls straight out of
it as the host narrows, exactly as sketched:

```
[K][C][R][U]   →   [K][C][R]   →   [K][C]
                      [U]           [R][U]
```

No breakpoints, no magic widths. Every rung is the same rule at a different
width, so a cluster of three or five buttons — or one whose labels get
relabelled, as three were earlier today — reflows without anyone revisiting
the block.

### The two numbers, and why they aren't magic

- **`flex-shrink: 100` on the cluster vs `1` on the content** is the entire
  priority statement: the cluster absorbs essentially all the squeeze first.
- **The cluster is deliberately NOT given `min-width: 0`.** A wrapping flex
  container's automatic min-content floor is its *widest single button*, so
  it reflows down to one-per-line and can never clip a label. Removing that
  floor would remove the thing that makes the ladder safe. This is the one
  line most likely to be "tidied up" by a future reader, so it is called out
  in the stylesheet.

**2×2 is an outcome, not an enforced minimum.** Enforcing it would need a
`min-width` keyed to the longest label — the kind of magic number that rots
the next time a label changes. At the widths these cards occupy, four
buttons land on 2×2 naturally.

### Truncation, the last rung

Moved off the inline-flex button and onto `keycapButton`'s existing label
`<span>`, where `text-overflow` actually works. So the full degradation
ladder is now: cluster wraps → chips wrap → chip text ellipsizes. Previously
it was one rung: chip text clips.

---

## 3. Other candidate sites — NOT applied, listed for your call

The same collision exists structurally elsewhere. Left alone deliberately —
you reported one surface, and applying a layout change to surfaces you
haven't complained about is a redesign, not a fix.

| Site | Content vs. controls | Notes |
| --- | --- | --- |
| `.detail-actions` (detail panel) | recommendation chip vs. K/C/R/I | **Highest risk.** This panel moved into a 60%-wide pane this morning — I narrowed it, so if it collides, that's mine. |
| `.item-row` / Type Check rows | entity name vs. K/C/R/I | Already `flex-wrap: wrap` at the row level, so it degrades by wrapping the whole row rather than clipping. Different, milder failure. |
| `.triage-row` | token + suggestion chips vs. chevron | Now in a 40% column. Tokens already ellipsize correctly. |

Say the word and any of these becomes three class names.

---

## 4. Verification

**Suite-verified**

- `tsc --noEmit` clean; `npm run build` clean.
- **46 of 46 `verify/*.ts` suites pass** — see §5, the count changed under me.
- 6 new `ui-smoke.ts` checks: declared once as a utility; applied by
  composition; controls wrap right-aligned and shrink 100×; the cluster
  keeps its min-content floor while the content gets `min-width: 0`; the old
  chip-squeezing rules are gone; truncation sits on the span, not the
  inline-flex button.

**Pending live-browser validation** — this change is *entirely* geometry, so
proportionally more of it is unverifiable here than in the previous two
passes:

1. The ladder itself: 4-across → 3+1 → 2×2 as the card narrows.
2. That "Information Technology Services" now renders in full at the widths
   where it previously clipped.
3. `align-items: flex-start` (was `center`) — only observable once the
   cluster wraps, but check the ✓ / decision pills still sit right on a
   single-row card.
4. Chips wrapping to a second line before ellipsizing.
5. Whether a 2×2 cluster makes the card too tall to scan in the workbench
   column. The honest risk: height is what this change spends to buy width.

---

## 5. ⚠️ Concurrent editing detected

The verify suite count went **44 → 46 mid-session**, and
`src/ui/reviewScope.ts` appeared at 13:21 with `review-scope-verification.ts`
(13:38) and `decision-reduction-verification.ts` (13:28). I did not create
these. You (or another agent) were working in `app.ts` while I was.

**No conflict, and it's reconciled in the code already.** `reviewScope.ts`
introduces a scope model whose precedence includes a first-class `selection`
source, which sounded like it might collide with the section-local
`headingActionScope` I added earlier today. It doesn't —
`currentReviewScope`'s own doc comment says so explicitly:

> *"selection = checked ids intersected with that displayed list, in display
> order (**the same section-local consumers the heading buttons use remain
> untouched**)."*

Those answer different questions: `currentReviewScope` is the single
assembler for the *global* "what am I holding" scope (inspector, keyboard
gate, provenance stamp); `headingActionScope` answers "what does *this*
heading's button act on," once per heading. The single-consumer invariant
covers `resolveReviewScope`, which my code never calls.

All 46 suites — including both new ones — pass with my changes applied. But
you should know my three passes today and that work landed in the same file
in overlapping windows.
