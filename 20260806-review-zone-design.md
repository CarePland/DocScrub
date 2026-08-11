# Review Zone — design decision record

**Date:** 2026-08-06
**Status:** SHIPPED 2026-08-06. All questions resolved except §12 (the
artifact axis), which is open and unruled.
**Supersedes nothing.** Extends the Review Scope model
(`20260803-review-scope-pass-1-findings.md`, `app/src/ui/reviewScope.ts`).

---

## 1. The decision

The 2×N card block is promoted from a rendering artifact to a first-class
model concept: the **Review Zone**. Bulk actions act on the zone, not on
the section or the stage remainder.

Andrew's framing, verbatim:

> Treating the 2 col area as the "review zone" and making the global "Keep
> all" etc buttons only impact that area. Solves two problems — encourages
> more granular review and prevents someone from just wiping out 150 items
> without fairly reviewing.

> process a limited number is a design decision to make review practical.
> If users clamor for "process the whole thing" then I think we can look
> later at that. I know this will necessarily impact the metrics, but the
> metrics need to show *good* decisions, not *massive* ones.

This is a deliberate product stance, not a safety hack. It is recorded
here because a future reader will find a bulk action that refuses to cover
an obviously-coverable set and will be tempted to "fix" it.

## 1a. REVISED SAME DAY — the zone is a hard 24, not a measured size

The first implementation sized the zone `measured columns × 2 rows`.
**Andrew:** "How is 24 items as a zone max? I did a cursory browsing
through many of the cells and that seems far in excess of the text typical
in a focus item view."

Adopted. `ZONE_CAPACITY = 24`, a constant. Three things follow, and all
three are improvements over the measured version:

- **It is a rectangle at every common column count** — 24 = 2×12 = 3×8 =
  4×6 = 6×4 = 8×3 = 12×2. Since the zone is a *subset* of a longer list,
  its bottom edge has to be visible, and a straight edge does that for
  free at any width. 20 is ragged at three columns; 25 at nearly
  everything.
- **It deletes the last impure input.** `syncZoneColumnCount()` and
  `zoneColumnCount` are gone. §3 below argued at length that a measured
  size was *safe*; a constant means the argument is unnecessary.
- **It ends a live contradiction.** The measured version defined the zone
  as "the block beside the panel," while the panel's own CSS defined that
  block as "the rows that fit next to it" — roughly forty cards, not four.
  Two definitions of the same thing were in the codebase simultaneously,
  and the grid drew forty identical cells with nothing marking which four
  a bulk action would touch.

§2 and §3 below are kept because their reasoning is still what governs
zone *membership* — but the dynamic-count question they answer is now
moot, since the count is fixed.

## 2. Why a dynamic member count is acceptable

The first objection raised against this was that the block is a rendering
artifact: all three grids are `repeat(auto-fill, minmax(14rem, 1fr))`, so
the column count is a function of window width, zoom and font size. Two
columns on Andrew's window is four or five on a wide monitor. An audit
record reading "bulk keep, 12 items" would have no principled account of
why it was 12.

**That objection was withdrawn, and the reason it was wrong is worth
keeping**, because it is the load-bearing idea in this design:

> The problem was never that the count is dynamic. It was that a scope
> you cannot name in an audit record is bad. Those separate cleanly.

A zone of any size is fully accountable **provided its membership is
materialised rather than reconstructed** — the action records the actual
candidate ids it covered at the moment it fired. "Why four items?" is then
never answered from a rule; the audit says *which* four. The existing
provenance mechanism already does exactly this shape of thing (`scope?:
string` stamped at the choke point, copied into event payloads).

## 3. The architectural call

**The zone is a model concept the renderer obeys — never a DOM query at
action time.**

The tempting shortcut is to read the rendered grid when the button is
pressed; `measuredColumnCount()` already does this for arrow navigation,
so the machinery is right there. Do not use it for decisions.

- A decision path whose scope depends on layout can only be verified in a
  browser, and this repository has no browser in its verification
  environment (see `verify/ui-smoke.ts`'s own disclosure). That is the
  same structural blind spot that let the member-cursor auto-advance
  regress repeatedly.
- With the zone in the model, the renderer *cannot* disagree with the
  action, because there is one list and both read it.

Shape: derive the zone's id list per render, publish it into state, have
the grid render exactly those members. Bulk actions read the model.

## 4. Zone membership

**The zone is the next N unresolved items in the visible list.**

This follows from Andrew's simplification:

> skipped items become part of the next group, for simplicity.

A "skipped" item is not a new concept — DocScrub has no Skip decision, so
skipped simply means *still unresolved*. The rule therefore collapses zone
membership to a derivation over state that already exists
(`isItemResolvedInState`), which has a consequence worth calling out:

> **No new persistence.** No skip list, no zone pointer, nothing to save or
> restore. The zone is recomputed from the resolved set, so it survives
> save/resume for free and cannot drift from it.

This is the same "derive, don't duplicate" property `decisionsMade()`
relies on (walking the event log against the *current* resolved set), and
it is why this rule is better than the "items [i..i+N)" paging model that
preceded it in discussion.

**N is quantized: `columns × 2 rows`.** Not "however many fit
vertically." Column count changes at discrete breakpoints; a row count
derived from window height would jitter on every drag of the window edge.

**Membership freezing is NOT required** — an earlier draft of this design
called for freezing the zone on entry so a mid-action resize could not
pull unreviewed items into a pending bulk action. Andrew's "next N
unresolved" rule plus the labelling rule in §5 makes that unnecessary: the
button re-renders with the live count, so there is no state in which the
action covers more than the label said. Dropping the freeze removes an
invariant that would have needed its own test and its own failure mode.

## 4a. The band is drawn, and the panel is sized by it

Enforcing the bound was not enough — the grid rendered every item in the
section as an identical cell while the buttons quietly covered only some.
**A bound the UI does not draw is a bound the reviewer cannot trust.**

The section's grid is now cut in two: the **zone band** (the 24, beside
the focus panel) and **the rest** (everything else, below a gap at full
width). The gap is Andrew's own earlier suggestion — "vertically adding a
bit of white space between the panel/zone and the rest of the list" — which
he correctly rejected at the time ("this isn't the answer either") because
the zone was not yet a visible thing for it to bound. With an explicit
24-cell band it has a job: it is the only thing on screen saying where a
bulk action stops.

**Panel height falls out of this for free.** With the rest moved outside
the split, the split holds only the panel and the band, so
`align-items: stretch` makes the panel exactly as tall as the 24 cells
beside it. That is the "fixed focus panel size" Andrew asked for, arrived
at without a measurement or a magic number — and it stays correct at every
column count, because the band it matches is a rectangle at every column
count.

Two earlier attempts at panel height are recorded because both were wrong
in instructive ways:

- `max-height` alone (original): capped the tall case, did nothing for the
  short one, so the panel still collapsed onto sparse items and shifted
  the page during navigation.
- `height: var(--focus-panel-max)` (first fix): stable, but sized by the
  *viewport* — a typical item filled under half the box. Rejected on
  sight. A content-derived fixed height was also evaluated against the
  live document and rejected on its numbers (occurrences per candidate:
  median 2, p90 11, **max 741** — the distribution has no top, so no
  fixed content height exists).

`--focus-panel-max` survives as a **ceiling** for the pathological tail,
so the panel can never grow the page without bound.

**Movement that remains, and why it is fine:** an item leaves the band
when it is *decided*. That is legible cause and effect. The original
complaint was movement while *navigating* — cells shifting under a cursor
merely passing over them. Different events; only the second is a defect.

## 5. The button names its blast radius

Bulk controls read **"Keep all 4"**, never "Keep all".

A button that cannot say 150 cannot do 150. This is most of the safety
property for almost no implementation cost, and it is what makes the
dynamic count a non-issue in practice: the reviewer is never guessing how
many items the gesture covers.

## 6. Section actions become zone actions

Andrew, resolving the open question:

> all section actions become zone actions

So `⇧A Accept section` and the numbered section actions
(`activeScopeSectionActions` / `sectionActionDigitAssignments`) all
re-scope to the zone. Their labels change with them — an action that says
"section" while acting on a zone is the paint/keystroke disagreement the
Review Scope invariant exists to forbid.

Command-bar legend consequences (currently `sseg("⇧A", "Accept section")`
and `sseg(..., "Section actions")` in `commandBarLegend`): both strings
change. The Scope row already exists to hold them.

**Sections do not disappear** — they remain the organising and visual
grouping (tiers, categories, types). They stop being an *action* scope.

## 7. RESOLVED — a zone never straddles a section boundary

**Andrew's ruling:** "Do not straddle sections. Let each section be
contained. For now. Until someone complains. I think context trumps
merging."

Resolution (a) below, implemented. "Context trumps merging" is the durable
form of the argument and is worth keeping in those words: a section is the
context that makes its actions *mean* something, and a zone that merges
across two of them buys uniform zone sizes by spending the thing that makes
the buttons legible.

Note the deliberate expiry condition — "for now, until someone complains."
This is not a permanent architectural law; it is a default chosen because
the cost of being wrong is small and visible (a short final zone) while the
cost of the alternative is invisible (an action quietly asserting something
false about half its members).

It also cost nothing to implement: `headingActionScope` is already called
per section and per tier, so section-locality was a property of the
existing structure rather than something added.

The original question and its alternatives, kept for the record:

If the zone is "next N unresolved in the visible list" and the list is
sectioned, a zone can span two sections. Zone actions are then applied
across items from different tiers — and many of those actions are
tier-specific claims ("These are all institutional terms", "These are all
calendar terms"). Applying one to a straddling zone would assert something
false about half its members.

Two resolutions:

- **(a) Clip the zone to the current section.** Zone = next N unresolved
  *within this section*. Actions stay semantically honest. Cost: the last
  zone of a section is a short one (possibly a single item), so zone size
  varies for a second reason beyond column count.
- **(b) Let it straddle, and offer only actions valid for every member.**
  Keeps zones uniformly sized. Cost: the action list changes as the zone
  moves, for reasons that are not visible on screen — the reviewer sees a
  control disappear without being told why.

**Recommendation: (a).** DocScrub's actions are claims about their
members, and a scope that can make a claim false is worse than a scope
that is sometimes small. (b) also reintroduces exactly the "why is this
control missing?" opacity that naming the count in §5 was meant to remove.

## 8. Proposed, not yet confirmed: explicit selection stays unbounded

Offered in discussion and not objected to, but not explicitly ratified —
treat as a proposal:

> Explicit selection stays unbounded; implicit scopes are zone-bounded.

A reviewer who genuinely wants to process 150 items can check 150 boxes
and apply. That is not a loophole — checking 150 boxes *is* the review.
The value is that the "process the whole thing" escape hatch Andrew
anticipated needing later already exists and never has to be built; it was
never removed, it just stopped being the default gesture. The `selection`
scope in `reviewScope.ts` keeps its current behaviour unchanged.

## 9. Metric consequences — smaller than expected

Andrew accepted a metrics cost up front ("I know this will necessarily
impact the metrics"). The cost is real but narrow, and the reason is
already pinned by the test suite.

`Avoided = coveredOccurrences − Made`, and coverage is driven by
**occurrence multiplicity, not gesture count**. Deciding "Amy Miller" once
avoids its other 222 occurrence reviews whether that decision was made
individually or inside a bulk sweep.
`verify/decision-reduction-verification.ts` asserts this deliberately —
"THE ANTI-GAMING PROPERTY" resolves the same twelve candidates two ways,
item-by-item and in one keystroke, and checks the tallies are *identical*
while the action counts differ 12 vs 1.

So zone-bounding raises `Made` and leaves `Avoided` very nearly intact.
On the 162-unit / 2,486-occurrence example: if gestures went from ~20 to
all 162 individual, `Avoided` moves 2,466 → 2,324 and `Fewer` moves ~99%
→ 93%.

Which lands where Andrew was already pointing: `Avoided` was never
measuring massive decisions. `Fewer` and `Time Avoided` are the two that
flatter bulk gestures, and both get more honest under this change.

## 10. RESOLVED — the "stuck zone" is not a defect and gets no feature

Raised as a risk, ruled out. **Andrew:** "That's on the user, frankly.
There are plenty of options to process items. Pick one... I pretty
strongly feel this is not a UI issue."

**The concern.** Because skipped items roll forward, a reviewer who keeps
declining to decide the same hard items eventually fills the zone with
them and forward motion stops, with nothing on screen explaining why.

**Why the ruling is right**, and the supporting fact is checkable rather
than a matter of taste: `decisionButtons()` renders Keep as-is / Change /
Redact / Ignore **unconditionally on every candidate**. No item in this
application is undecidable. So there is no state in which the app has
failed to offer a way forward — only a reviewer choosing not to take one.
A zone showing nothing but the items someone has been avoiding is the
queue *doing its job*: surfacing work that is owed.

**And the stronger reason not to build relief.** Every remedy considered
(a recorded "defer" state; a zone admitting fresh items alongside capped
carry-forwards) is a snooze under another name. A snooze in a redaction
tool is a mechanism for losing an item. The pressure to decide is the
product, not friction in it.

A `zoneIsStuck()` detector was written and then **removed**, along with its
tests — a detector nothing acts on is speculative machinery, and this
design's own instruction was not to solve the problem speculatively. The
reasoning survives as a comment in `reviewZone.ts` so the concern is not
re-derived from scratch. If this is revisited, revisit the ruling; do not
start from the mechanic.

## 11. Deferred — TOP-TIER FUTURE FEATURE: large-population confirmation

Andrew, on the possibility that zone-bounding irritates users:

> It may irritate people, and if they are irritated then I can add it, but
> with a "you are bulk editing a large population. Please make sure you
> have examined all items" or something. later. put that as a top-tier
> future feature if users want it.

**Recorded as a top-tier future feature, gated on user demand.** If the
zone bound proves too restrictive in real use, the unbounded bulk action
returns *with* a confirmation naming the population size and asking the
reviewer to affirm they have examined the items — rather than simply
lifting the limit.

The ordering matters and should be preserved: the restriction ships first
and the escape hatch is added on evidence, not the reverse. Shipping the
permissive version first and tightening later is the change users
experience as a regression.

---

## 12. OPEN — the artifact axis is unbounded

The one thing still unruled.

"All section actions become zone actions" does not obviously reach
**structural-relationship cards**. `relationshipKindActions` still offers a
literal "Accept All Remaining" over a whole kind group, because those
actions act on the *artifact* axis (relationship proposals) rather than on
queue items, and the zone size is derived from the **item** grid's measured
columns. Bounding an artifact group by an item grid's width would be
incoherent.

So today a reviewer can still clear an arbitrarily large kind group in one
gesture — the exact outcome §1 exists to prevent, on a surface §1 did not
consider. Whether cards want a bound of their own (and what would measure
it) is undecided.

## Implementation notes (for whoever picks this up)

- `reviewScope.ts` gains a `review-zone` source kind. Mind the **keystone
  invariant**: `resolveReviewScope` has exactly ONE call site
  (`currentReviewScope()`), asserted structurally by `ui-smoke`. Do not
  add a second answer to "what is the current scope."
- Precedence needs deciding against the existing ladder
  (`artifact-focus > selection > item-focus > stage-remainder`). The zone
  most plausibly replaces `stage-remainder` as the widest implicit scope
  rather than being inserted mid-ladder.
- Zone membership must be pure and suite-testable — a function of
  (visible list, resolved set, N). Only N comes from measurement, and it
  should enter as a parameter, not be read inside the derivation.
- The provenance vocabulary is append-only: add `zone:N` alongside
  `selection:N` / `remainder:N`.
