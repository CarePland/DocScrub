# Future Features

Status: canonical
Last updated: 2026-08-01

How to read this document: a holding area for product concepts Andrew has
articulated but explicitly deferred — not scheduled, not scoped into
acceptance criteria, not part of any current wave or milestone. This is
distinct from `../architecture/reviewer-experience-backlog.md`, whose
RX-NN entries are prioritized, effort-estimated, acceptance-criteria-bearing
implementation items. Everything here is `[SPECULATIVE]` per
`../standards/documentation-standards.md`'s marker convention — proposed,
never committed to a wave. An entry graduates out of this document (and is
removed from here) when it becomes a real Larger-feature specification
(that template, from `documentation-standards.md`) or lands as an RX-NN
backlog item; this document is not the historical record of that
graduation, so no banner is left behind — the entry is just deleted once
its content lives somewhere authoritative.

---

## Dynamic Review Insights & Workload Statistics

**Status: Future enhancement — not scheduled for implementation.**

### Intent

DocScrub already computes information most review tools never expose: how
many occurrences a document contains, how many of those collapse into how
few review items via grouping, how much of that reduction the reviewer
never has to re-derive by hand. Right now that computation is invisible —
spent entirely on producing the review queue, never shown back to the
reviewer as a fact about their own document. The intent is to surface it,
briefly and periodically, as a way of making the *already-real* value of
grouping and reviewer-centric organization visible, not to gamify the
session or market the product to someone using it.

The core idea these observations should reinforce: the reviewer is making
a relatively small number of coherent review decisions instead of
repeatedly finding, reviewing, and deciding on thousands of scattered
occurrences.

### Behavior

A short observation, drawn from a rotating pool of roughly 20–30 phrasings,
surfaces periodically during review — quantifying real, currently-known
statistics rather than estimates. Tone is understated, intelligent,
occasionally dry, grounded, never exaggerated, never "fortune cookie."
These should read as interesting facts about *this document*, not as
product marketing.

**Initial version — statistics DocScrub already knows with certainty
only:**

- total occurrences detected
- review items created (candidates + groups the reviewer actually decides
  on)
- ambiguity count
- grouping reduction (occurrences → review items)
- decision reuse count
- occurrences affected by a single review item

Deliberately excluded from the initial version: any estimated time
savings. The reduction from occurrences to review items already
demonstrates the value on its own; a time estimate adds a claim DocScrub
cannot yet back with real measurement (see Later connections).

**Example observations** (Andrew's own draft phrasings, illustrative of
the target tone — not a final, locked copy list):

- "Find. Review. Decide what to do. 2,486 times? Not today."
- "Others would review 2,486 occurrences. You review 162 items."
- "2,486 occurrences became 162 review items."
- "162 review items instead of 2,486 separate occurrences."
- "One review item may represent hundreds of downstream document changes."
- "This document contains 2,486 occurrences, but only 162 review
  decisions."
- "The software organized the repetitions. You make the decisions."
- "Every review item may represent many document updates."
- "You're reviewing decisions — not chasing occurrences."
- "One decision. Hundreds of downstream edits."

### Explicit boundaries

- Not gamification. No streaks, points, or achievement framing.
- Not marketing copy. Nothing here should read as the product selling
  itself to the person already using it.
- Not an estimated-time-savings feature, initially — see Later
  connections for when that becomes appropriate.
- Not a progress bar replacement. This supplements, and does not replace,
  whatever completion/statistics surface already exists
  (Milestone 3's reviewer statistics bar).

### Invariants touched

None of `../product/invariants.md`'s existing entries are implicated —
this is a read-only, derived presentational feature over statistics the
pipeline already produces (occurrence counts, grouping, ambiguity,
decision reuse). It makes no decision, proposes nothing to accept or
reject, and does not touch the reviewer-is-the-decision-maker boundary.

### Open questions

For Andrew, before or during implementation:

1. Cadence and trigger — periodic on a timer, on stage change, on N
   decisions made, or reviewer-triggered (e.g. a small "?" affordance)?
2. Where it renders — part of the sticky workspace chrome (see RX-04),
   a dismissible corner element, or something else?
3. Whether the rotating pool is a fixed static list or generated
   per-document from a small set of templates (so "2,486" and "162"
   above are filled in per document rather than the phrasing itself being
   static text with numbers substituted).
4. Whether "occurrences affected by a single review item" should
   highlight the single largest group in the document specifically, or
   stay general.

### Later connections

Once sufficient real usage data exists, generic observations can be
replaced with statistics personalized to this reviewer's own measured
behavior, always preferring measured data over generic industry
estimates:

- estimated review time based on the reviewer's own historical review
  speed
- average review seconds per item
- average occurrences represented by each review item
- decision reuse statistics
- lifetime occurrences avoided
- lifetime estimated repetitive review avoided
- personal productivity trends

This later phase depends on a measurement mechanism DocScrub does not yet
have (per-reviewer historical timing data, persisted across sessions) —
not committed to here, just the natural next step once the initial,
certainty-only version exists and real sessions have accumulated data to
draw from.

### Design principle

The observations should never attempt to "sell" the product while the
reviewer is working. They should quietly answer one question: *how much
repetitive work did DocScrub remove from this review?* Success looks like
the reviewer thinking "I only had to review each thing once" — not "this
software keeps telling me it's saving time."
