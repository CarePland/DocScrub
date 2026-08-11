# Decision Reduction Metrics — Implementation Findings

**Class: working (2026-08-03).** Implementation record for the Decision
Reduction feature. The canonical vocabulary now lives in
`app/docs/product/glossary.md` ("Decision Reduction vocabulary"); the
canonical mechanism lives in the header of
`app/src/metrics/decisionReduction.ts`. This document records what was
built, what was decided, and what is still unverified.

**Version:** `v2026-08-03.08`
**Suite:** `app/verify/decision-reduction-verification.ts` — 152/152
**Battery:** all 46 `verify/` suites pass; `tsc --noEmit` and `tsc` clean.

**Five passes, same day.** The feature was specified, then revised four
times by AG as it became real. This document records the *current* design;
superseded states are noted only where the reasoning still matters.

| Pass | Change |
| --- | --- |
| 1 | Static metric: a property of detection, deliberately unmoving |
| 2 | **Running tally**: global scopes to completed work, local to remaining |
| 3 | **Decision Tracker**: one titled Made / Avoided / Fewer panel |
| 4 | **Interaction-forward**: Made counts human decisions, not units |
| 5 | **Work avoided in time**: a fourth, deliberately conservative *estimate* |

The arc is worth recording, because passes 1 and 4 are near-opposites and
the reversal was correct. Pass 1 optimized for a metric that could not be
gamed. Pass 4 optimized for a metric the reviewer can *feel*. What made
the reversal safe was AG's observation that the threat model was
imaginary: DocScrub proposes the category actions, using them is the
designed path, there is no leaderboard, and — decisively — a degenerate
select-all is unreachable because the product requires a degree of review.
An engineering objection that assumes a user attacking their own audit
trail deserves less weight than a reviewer being able to feel progress.

---

## 1. The definition, and why it is the one that was built

> *"'Actual review decisions' means the number of distinct review units
> DocScrub presents for judgment — not the number of actions the reviewer
> has already taken."* — AG

This defines the **decision unit**, and it survived every revision: it is
still what the *reduction model* counts, and what every local equation
reports. What pass 4 changed is narrower than it first appears — not what
a unit is, but what the tracker's **Made** counts.

**The two live side by side, deliberately:**

| | Counts | Where |
| --- | --- | --- |
| Decision **units** | things presented for judgment | local equations, occurrence coverage, the floor figure |
| Decisions **made** | human gestures | the Decision Tracker's first cell |

The unit model retains the technique-independence property — resolving
forty items one at a time and in a single keystroke produce identical unit
figures, still asserted in the suite. The tracker's Made deliberately does
*not*: that is the whole point of pass 4, and section 2a records why the
objection it overrides turned out to be weaker than it looked.

It holds by construction rather than by care: `decisionReduction.ts` does
not import `ReviewSession` and receives no decision state through any
argument. It is a pure fold over whatever units it is handed. **All five
passes required zero change to that calculation** — later passes changed
which units each caller supplies and composed a second module beside it,
which is exactly what the scope contract is for.

---

## 2. The exact definition of a decision unit

**One thing a review surface presents for judgment, together with the
document occurrences that judging it disposes of.**

Which entity that *is* depends on the surface, and this is deliberate:

| Surface | Decision unit | Why |
| --- | --- | --- |
| Document (global) | each detected candidate | every occurrence belongs to exactly one candidate; a candidate is the finest unit at which a decision is durably recorded |
| Item Check, Ambiguity Check | candidate | the row the reviewer judges |
| Type Check | candidate | a type card summarizes entities; the reviewer judges entities |
| **Group Check** | **the group row** | the reviewer decides a *group*; one row disposes of every occurrence of every member |

Group Check is the case that justifies the whole API shape. Its unit is not
a candidate, so a candidate-id-shaped interface would have made it a
special case. `mergedUnit(groupId, members)` makes it an ordinary caller.

Two consequences worth stating plainly:

- **The same candidates legitimately produce different figures on
  different surfaces.** Three candidates in one group read as `1 / N` in
  Group Check and `3 / N` in Item Check. Both are true about the surface
  they describe.
- **Review artifacts (structural relationship proposals) are not decision
  units.** They require reviewer action but cover no occurrences, so they
  have no reduction to express. Including them would have inflated
  `decisionUnitCount` without adding to `occurrenceCount` — i.e. it would
  have *lowered* the avoided figure for a document with more work in it.

---

## 2a. The Decision Tracker (passes 3–4)

```
Decision Tracker
 12        436        97%
Made     Avoided     Fewer
```

```
Made    = human decisions actually made
Avoided = covered occurrences - Made
Fewer   = Avoided / covered occurrences
```

**"Treat all this way" is one decision, even across nine items** — and
Avoided is then everything the reviewer never had to touch, *including*
the eight items that action swept up without their being opened. That
inclusion is the point of pass 4: the unit-based Avoided silently refused
to count them, under-reporting exactly what DocScrub is best at.

`Made + Avoided = covered occurrences` still holds, so the panel cannot
contradict itself: every occurrence in the completed work is either
something the reviewer decided, or something they didn't have to.
Asserted in the suite, in both the bulk and the individual world.

**The tracker performs no arithmetic of its own.**
`metrics/decisionTracker.ts` composes two halves that already existed:
occurrence coverage from the unchanged shared `decisionReduction`
calculation, and human effort from the review event log. It adds one
subtraction and one division.

### What counts as one human decision

Not "an event in the log." **A decision counts when it newly resolved at
least one candidate that is still resolved now** — the event log walked in
order against the *current* resolved set. Three properties fall out with
no special cases:

- **Re-deciding an item resolves nothing new → doesn't count.** This was a
  live defect in pass 3: Made incremented when the reviewer merely changed
  their mind. AG's assessment — *"#3 should not have made it into the
  design"* — is right; a tracker that climbs when no work happened is a
  click counter in the bad sense.
- **A group action over partly-decided members counts once**, for what it
  newly resolved, and never again for what it overwrote.
- **A reversed decision takes its gesture with it**, because those units
  leave the current resolved set — which is also what keeps the identity
  above exact rather than approximately true.

Made is therefore derived from history but describes the present: *the
gestures that produced the resolved set you have right now.*

Two vocabulary details the walk has to get right, both verified against
`session.ts` rather than assumed: batch member events are appended
*before* their summary event, so they buffer until the anchor closes the
gesture; and decision reuse tags its per-candidate events `source:
"imported"` rather than with a `via*` flag, so a purely `via*`-based test
would have counted an imported prior review as one decision per candidate
instead of one gesture.

### 2a-i. Work avoided, in time (pass 5) — the only estimate

```
Decision Tracker
 12      436      97%      3.4  days of work
Made   Avoided   Fewer          avoided
```

**The multiplicand is the whole design.**

```
time avoided = avoided occurrence-level reviews × observed individual pace
```

2026-08-08 correction: this originally used avoided decision *units*.
That made the time estimate answer a different question than the visible
`Avoided` cell. The reviewer-facing metric now prices the same count the
panel shows: covered occurrences minus decisions made. The figure is still
knowingly low because it ignores discovery time entirely and measures pace
only from already-presented individual decisions.

**Conservatism, itemized:**

| Choice | Alternative rejected | Effect |
| --- | --- | --- |
| Avoided occurrence-level reviews | Avoided decision units | matches the panel's exact Avoided count |
| Individual decisions only | All gestures | one bulk keystroke says nothing about one decision's cost |
| Pace is a **median** | Mean | see below — the largest single correction |
| Idle gaps **discarded** | Capped at the ceiling | capping drags any average toward 120s |
| Wall-clock days/weeks | Working days (8h) / weeks (40h) | ~3× smaller |
| ≥3 observed decisions | Show from the first | no fabricated first number |

**The median is the largest single correction**, and it was a real defect
in the first build. Decision times are a tight cluster of a few seconds
with a long right tail of distraction: a ninety-second glance at an inbox
is not deliberation, but a *mean* prices it as though it were, and with a
small sample two of those multiply the figure. On gaps of
`5, 5, 5, 5, 110, 115` the mean is ~41s and the median is 5s — **eightfold,
on identical behavior.** Asserted in the suite with that exact
distribution.

This is also why the idle ceiling stays at two minutes rather than being
tightened. AG asked whether long gaps were controlled for; the honest
answer was "partly — over the ceiling yes, under it not at all," and the
fix belonged in the statistic, not in a second threshold. With a robust
estimator doing the outlier work, tightening the cut would start
discarding genuinely slow-but-real decisions, biasing the figure by
throwing away signal rather than by choosing a defensible method. One
principled conservative choice beats two arbitrary ones.

**Suppressed rather than guessed.** Fewer than three observed individual
decisions, or nothing avoided yet, renders nothing at all.

**A standing caution.** Six deliberately conservative choices are now
stacked on this one figure. Each is individually defensible and the
direction is the right one for a compliance-adjacent tool — underselling
is the safe error — but "deliberately cautious" can shade into
"systematically wrong in a known direction." The large offsetting term
(discovery cost, entirely conceded) is what keeps this on the right side
of that line today. A seventh reduction should not be added without
re-examining whether the estimate still means anything.

**The unit ladder** walks minutes → hours → days → weeks → years, taking the
first step whose *rounded* value is still below its own ceiling — which is
what promotes 3,599s to "1.0 hours" instead of the nonsensical "60.0
minutes". Tested at every boundary.

**Presentation carries the distinction.** Number at the same size as the
exact three, but with a wrapping phrase beside it rather than a stacked
one-word label. The different *shape* is the signal: this should not read as
a fourth measurement of the same kind. "Avoided" rather than "saved" — it
names work that did not have to happen, not a benefit banked.

**And it can account for itself.** An "i" control opens three plain-language
paragraphs beneath the panel: the pace measured and its sample size, the
arithmetic with this document's real numbers, and an explicit statement that
the figure is cautious and the true saving is likely larger. Every number in
the prose comes from the estimate object, so the explanation cannot describe
a calculation that did not happen. The suite asserts the text never claims
time was "saved" and makes no productivity or cost claim.

**Residual risk, recorded honestly.** This is the one figure in DocScrub
that is a model rather than a count, and it sits beside three that are
exact. If it ever reads as implausible, the doubt will spread to the true
numbers — which is the specific cost of having it at all. The mitigations
are the conservatism above, the visual distinction, and the explanation; the
verdict needs real documents.

### The consequence, accepted deliberately

Because Made falls when the reviewer works by category, **Avoided rises
when they do.** Passes 1–3 treated that as the hazard to design around;
pass 4 accepts it, on AG's reasoning that the degenerate case
(select-all → Ignore for a perfect score) is unreachable in a product that
requires a degree of review, and that there is no adversary — the number
is for the reviewer, about their own work.

The knock-on: **there is no longer a fixed end state.** The unit-based
figure is now a *floor* — "at least N avoided, more if you work by
category" — where pass 3 called it a ceiling. Workspace Metrics is
relabelled accordingly and the suite asserts the wording.

### Presentation

Titled panel behind the same hairline seam, values in the strip's own
weight with a smaller title line, so the two stacked lines occupy the
vertical space the label+value pairs beside them already used — no header
height increase. No status color band: a band asserts "low / getting there
/ good," a claim about *completion*, and Fewer sits near its final value
from the first decision onward. No suppression: the panel holds position
and reads an honest `0 / 0 / 0%` on a fresh document, which is also the
baseline that makes the first decision visibly move it.

---

## 2b. Running behavior (pass 2)

- **Global** scopes to units resolved *so far*: starts at zero, only
  climbs, lands **exactly** on the document's full reduction at completion
  (asserted by equality, not approximation).
- **Local** scopes to what *remains* on that surface — matching AG's
  original wording, *"the equation intentionally begins with the actual
  remaining decisions"* — shrinking as the surface is worked and
  suppressing entirely once it is finished.
- **Each local surface supplies its own remaining set** rather than this
  code filtering, because each already displays a remaining count beside
  where the figure lands and the two numbers on one line must agree.

**Decision reuse.** The ceiling never moves for reuse — a reused decision
is still a decision unit, per AG's rule. But the *running* tally does
advance on import, because those units genuinely became resolved. That is
reuse showing as completed work, not as a bonus: the units stay in the
denominator exactly as if decided by hand, so an imported document and a
hand-reviewed one land on the same final figure. Both directions tested.

---

## 3. The scope contract

```ts
interface ReviewUnit { id: string; occurrenceIds: readonly string[] }
decisionReduction(scope: Iterable<ReviewUnit> | null | undefined): DecisionReduction
```

- **Computed over the supplied scope only.** No function reaches for
  document-wide state.
- **`Candidate` satisfies `ReviewUnit` structurally**, so candidate-based
  surfaces pass candidates directly — a lookup, not a conversion.
- **Units deduplicate by `id`**; occurrences deduplicate across the whole
  scope. An occurrence covered by two units counts once — it is one place
  in the document and would have been read once either way.
- **Invalid input is absorbed, never thrown on.** `null`/`undefined`
  scopes, missing or non-array `occurrenceIds`, `null` entries and empty
  ids all degrade to "covers nothing." This feeds a strip that re-renders
  on every keystroke; a metric is not worth taking the workspace down for.
- **`avoidedDecisionCount` is floored at zero.** Unreachable with real
  units (every candidate has ≥ 1 occurrence), but the module is generic
  and a negative "decisions avoided" is not a number the product should be
  able to display.

### Overlap across stages

**Local figures overlap and do not sum.** A candidate is counted inside its
Group Check merged unit, inside its Type Check card, and inside its Item
Check section. Each figure is true about its own surface; none are parts of
a whole.

Handled by *not building the thing that would imply otherwise*: no total,
no "N of M" framing, no progress bar, no two local figures placed in one
row inviting arithmetic. The suite asserts the over-count directly
("overlapping scopes deliberately over-count when summed") so the property
is recorded as intended rather than discovered later as a bug report.

---

## 4. Insertion points

**Module (new).** `app/src/metrics/decisionReduction.ts` — pure, no DOM, no
`ReviewSession`. Beside `workspaceMetrics.ts`, deliberately **not** in
`ui/documentScores.ts`, whose own header declares it a temporary
development feature expected to disappear.

**Shared resolution split (new).** `partitionCandidatesByResolution()` in
`app/src/engines/review/coverage.ts` — the one answer to "which candidates
are done," as a set. The tracker's scope and the Consolidation report had
each grown their own filter (one via `isItemResolved`, one via
`resolvedStatusOf`); both correct, both the same rule expressed twice,
which is the divergence that file's header exists to prevent. Also
resolves a real performance trap: filtering through the single-candidate
`candidateResolvedStatus` rebuilds the group-coverage set per candidate,
and the tracker recomputes on every render.

*This is the "cleaner architectural home" the instruction invited — and
notably it was not a new module. The right place already existed.*

**Global.** `renderDecisionTracker()` in `app.ts`, called from
`renderReviewStatus()` — the titled panel after the hairline seam, scoped
to the resolved partition.

**Local** — all through three functions in `app.ts` (`candidateUnits`,
`appendReductionFigure`, `appendCandidateReduction`) and no fourth. Every
scope is the surface's own **remaining** set:

| Location | Scope |
| --- | --- |
| `renderSectionedQueue` section heading (Item Check *By Category*, Ambiguity Check) | `remainingIds` — undecided members |
| `renderSectionedQueue` tier heading | `tierRemainingIds` |
| `renderTypeCheckStage` type card | `unresolvedTypeMembers(summary, state)` |
| `renderTypeReviewSurface` header | `remaining` — the array its bulk buttons act on |
| `renderGroupCheckToolbar` | one merged unit per **unresolved** visible group |
| `renderBulkToolbar` (Item Check list view) | selection if non-empty, else visible list — narrowed to undecided |

**Reused.** `workspaceMetrics.ts`'s Consolidation section consumes the
module; it previously summed `occurrenceIds.length` in two places of its
own. It now shows both scopes: `decision-units` is the **ceiling** (every
detected candidate) and `avoided` is the **running** figure the tracker
shows, with a note naming the ceiling it is climbing toward. Its
reviewer-*activity* entries (`actions-so-far`, `items-covered`,
`occurrences-covered`) remain live — and `actions-so-far` deliberately
*diverges* from `items-covered` as bulk actions are used, which is
precisely the divergence the tracker refuses to reward.

### Forward compatibility with the Selection Inspector

No redesign is required. An Inspector grouping is a scope; a summarized
grouping like *Common English Words (23)* passes its candidate set to
`appendReductionFigure` and gets `23 / 418 = 395 decisions avoided` from
the same renderer. The **scope-follows-selection** behavior the Inspector
needs already exists, arrived at through the ordinary scope contract in the
Item Check bulk bar rather than through anything Inspector-specific.

---

## 5. Judgment calls

**1. Rounding — this one was a real defect, caught by AG's own example.**
`2,324 / 2,486` is `93.4835%`. Rounded to one decimal that is `93.5%`;
rounded to a whole percent that is `93%`. Both are correct *independently*
— but the first implementation rounded in the model and again at the
display, and `93.4835 → 93.5 → 94%` produced **94%** where the spec's
headline example says **93%**. Resolved by keeping `fewerDecisionPercent`
**exact** and rounding exactly once, in `formatFewerDecisionsPercent()`.
The suite now guards this case by name.

**2. Suppression is enforced in the module, not at call sites.**
`shouldDisplayReduction()` collapses all three of AG's rules (empty scope,
units equal to occurrences, zero avoided) into one predicate, so a new call
site cannot forget it.

**3. Suppression deliberately does *not* apply to the Decision Tracker.**
The panel holds its position in the chrome and reads an honest
`0 / 0 / 0%` on a fresh document — which is also the baseline that makes
the first decision visibly move it. A panel that appeared only after the
first decision would be a panel nobody learns to watch.

**4. The tracker takes no status color band.** A band asserts "low /
getting there / good," a claim about *completion*. Fewer sits near its
final value from the first decision onward. This is also the reason for
the seam: undifferentiated figures in one row read as one kind of number.

**5. The Group Check figure lives on the toolbar, not on group rows.** A
per-row figure would have been `1 / N` on every row — technically true,
visually noise, and competing with the row's decision color, which is
spoken for (see the unified decision color system).

**6. Reuse: the ceiling holds, the tally advances.** A reused decision is
still a decision unit, so importing prior decisions cannot move the
document's ceiling. But it *does* advance the running tracker, because
those units genuinely became resolved. Both directions are tested. This is
the one behavior the original spec did not anticipate, and it is worth a
second look in real use: **a reviewer who imports a full prior decision
set sees Made jump to near-complete without having worked for it.** That
is factually correct and arguably the best possible moment to show the
number — but if it reads as hollow, the fix is a distinct treatment for
reused units, not a change to the arithmetic.

**7. Local figures use each surface's own "remaining" rule, not one
shared rule.** The sectioned queue counts remaining by direct candidate
decision; Type Check counts by `isItemResolvedInState`, which also honors
group coverage. Imposing one rule would have made an equation contradict
the "N remaining" sitting inches away on the same line. Notably this is
the *opposite* choice from judgment call 8 — and for the opposite reason:
here two nearby numbers must agree with each other; there two distant
consumers must agree with the domain.

**8. The resolved/remaining split moved into `coverage.ts`.** See
Insertion points. The instruction invited a cleaner home if one emerged;
the cleaner home turned out to be a function in a file that already
existed for exactly this purpose, not a new module.

**9. Version label.** Bumped to `v2026-08-03.03`, following AG's own
`.02` (Review Scope Pass 1). The intermediate `.01` static presentation
never had a browser session and is superseded rather than historical.

---

## 6. Verified by suite

`verify/decision-reduction-verification.ts`, 152 checks:

- **Pure calculation** — empty/null/undefined/malformed scopes; the basic
  relationship; AG's 162 / 2,486 / 2,324 / 93% example reproduced exactly;
  duplicate occurrence coverage (union, not sum, and within a single unit);
  duplicate units collapsing by id; zero-reduction scopes; the
  more-units-than-occurrences floor; rounding including the double-rounding
  regression guard; `mergedUnit` union semantics and the group-row vs.
  members contrast; the equation text including singular/plural and
  thousands grouping; all four suppression rules.
- **The unit model's technique-independence** (still true of the *local*
  equations, which remain unit-based) — the same twelve candidates
  resolved item-by-item and in one bulk keystroke give identical units,
  occurrences and reduction.
- **The running tally** — zero on a fresh document (and `0%`, not `NaN%`);
  one decision on an N-occurrence item avoiding exactly N−1; monotonic
  across individual + bulk + group actions; landing **exactly** on the
  unit-based floor when the last item resolves, on all three fields.
- **The Decision Tracker's counting rule** — `0 / 0 / 0%` at rest; one
  bulk action over 12 items is **one** decision made while the same twelve
  decided individually is **twelve**; both cover identical occurrences, so
  working by category avoids strictly more; `Made + Avoided = covered
  occurrences` in both worlds; Fewer as Avoided's share of that total.
- **The pass-3 defect, guarded by name** — re-deciding the same item three
  times does not advance Made, while the raw action tally moves to 3 (so
  the check cannot pass vacuously); a group action over partly-decided
  members adds exactly one; repeating it adds none; importing an entire
  prior review counts as **one** decision made and still satisfies the
  identity.
- **Local figures** — a fresh section covering all of itself; shrinking by
  exactly 8 units after 8 are decided; covering strictly fewer occurrences;
  emptying and **suppressing** when the section is finished.
- **Real workspace** (`entity-resolution-001`) — global scope against an
  independent recount; local scope bounded by global; overlapping scopes
  over-counting when summed; a real group as a merged unit; Consolidation
  reading the tracker's own figures and stating the unit-based number as a
  **floor** (`"at least N"`), with a partially-reviewed workspace proving
  the two have not collapsed into one number; decision reuse leaving the
  floor untouched.
- **UI-facing values** — the exact equation text a real local scope
  produces, and a genuine single-occurrence candidate from the fixture
  producing `1 / 1 = 0` and being suppressed.

Also re-run green: all 46 suites, `tsc --noEmit`, `tsc`, `ui-smoke`.

---

## 7. Remaining browser checks

Node coverage reaches every number and every string these surfaces render,
so what is left is **layout and legibility only** — but it is genuinely
unverified:

1. **Header height.** The stated constraint: the tracker must fit "without
   increasing header height." Its title line plus value row is sized to
   match the label+value pairs beside it, but this is arithmetic on
   `rem` values, not an observation. **Check this first** — if anything
   about the panel is wrong, it is most likely this.
2. **The seam.** `.decision-tracker`'s `border-left` with
   `align-self: stretch` should render a full-height hairline. Confirm it
   reads as a separator, not a table border, at narrow and wide viewports.
3. **Strip wrapping.** The strip holds three metrics, the panel, and the
   flush-right diagnostic text. Confirm no wrap or crowding at the
   narrowest supported width.
4. **Does the tracker actually feel alive?** The design intent is "mild
   gamification through truthful metrics" and "the reviewer should feel the
   tracker moving with them." Whether Made ticking up by 1 (individual) and
   by 40 (bulk) *reads* as satisfying rather than jumpy is the one question
   no test can answer. Watch it during a real review.
5. **Local figure crowding on section headings.** That line already carries
   title, `N complete • N remaining`, a select-all checkbox and up to
   several numbered action buttons — and, since AG's Review Scope Pass 1,
   sits inside the 60/40 inspector split. Confirm the figure does not push
   buttons to a second row at the narrower column width.
6. **Type card layout.** `.type-card .reduction-figure` is `display: block`
   between the counts line and the remaining line. Confirm card heights
   stay uniform across the grid.
7. **Item Check bulk bar, scope-follows-selection.** Check boxes and
   confirm the figure re-scopes to the selection and back.
8. **Suppression in the wild.** Confirm a finished section's equation
   disappears, and that a section of all single-occurrence items shows no
   figure rather than a row of `1 / 1`.
9. **Does Fewer actually vary between documents?** Still open from the
   original design discussion: it may read 90%+ on nearly every real
   document, in which case Made and Avoided carry the information and Fewer
   is decoration. The panel title now supplies the context Fewer used to
   need, so dropping it later would cost little. Needs several real
   documents to answer, not a fixture.
10. **Interaction with the Review Scope inspector.** The tracker and AG's
    new scope inspector both answer "what am I working on" at different
    altitudes. Confirm they read as complementary rather than competing for
    the same glance.

---

## 8. Not built, on purpose

- **No time, minutes, click, or productivity estimates anywhere.** The
  suite asserts the absence by regex.
- **No total across local scopes**, and no UI that implies they sum.
- **No reuse credit** in the reduction figures.
- **No new persistence.** Every figure recomputes from pipeline state that
  already survives save/resume; nothing was added to any stored schema.
- **No change to `ui/documentScores.ts`.** The temporary diagnostic scoring
  model is untouched; Decision Reduction sits beside it, not inside it.
