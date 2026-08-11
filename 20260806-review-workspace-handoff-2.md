# Review Workspace — session handoff 2 (2026-08-06, later)

**Read this and `20260806-review-workspace-handoff.md` if you are picking up
DocScrub-Web review-surface work.** Everything below shipped unless marked
OPEN. `tsc` clean, 51/51 suites, ui-smoke at 152 checks.

**Revised 2026-08-07.** §4 and §6 were re-checked against the running app
rather than against this file, and several claims did not survive it. What
changed is marked REVISED at the section; everything else stands.

### How to read the OPEN items

Every OPEN item below is tagged, because the four kinds take different
work and mixing them is how a wording fix gets postponed behind an
architecture debate:

| Tag | Means |
|---|---|
| **DEFECT** | Objectively wrong right now. Ships broken; needs no ruling. |
| **UX GAP** | Works as built, but the built thing leaves a reviewer stuck. |
| **ARCHITECTURE** | A decision about where something lives. Needs reasoning, not a patch. |
| **PREFERENCE** | Looks or reads better. Legitimate, and never urgent. |
| **FUTURE** | Real, not now, and recorded so it is not rediscovered. |

A DEFECT with a known cause should not wait on the ARCHITECTURE item it
happens to touch. That is the trap §6.3 fell into for a day.

---

## 0. Start here: the one open defect

**Keyboard traversal inside a MIXED category is broken.** `MAY → ITS` works,
then the cursor sticks and cannot move in either direction.

Diagnosed, not guessed. Three links in the chain were fixed this session; a
fourth remains:

1. ~~coordinate-space mismatch in `moveWithinResultsGrid`~~ — fixed.
2. ~~caller passed the stale item cursor~~ — fixed.
3. ~~`gridContainerForItem` knew only `data-item-id`~~ — fixed.
4. **The rows-then-cards seam in the keydown handler intercepts the arrow
   before the mover runs and re-pins to the FIRST proposal every time.**

That seam (`continueIntoStructuralCards`, plus `moveStructuralCardFocus` and
`advanceStructuralCursor`) was built when cards rendered in a separate tree
BELOW the queue. They are now cells in the same grid, so the seam is
actively fighting the mover.

**The fix is a net DELETION, not another patch.** Both of those traversal
functions navigate by `document.querySelectorAll('.relationship-section
.relationship-card')` — layout reads driving navigation, the exact thing
`reviewZone.ts` warns against, and they now see one card instead of the
group. Remove the seam and both functions; movement over the anchor grid's
own cell list already handles crossing between review-unit types (see
`moveWithinResultsGrid`'s doc comment).

Do NOT add a fourth patch. Three call sites still compute in the wrong
space and a patch leaves them.

---

## 1. The process note that matters

**The browser was wedged for most of this session** — `outerWidth: 467`,
`dpr: 3`, unresponsive to `resize_window`. Screenshots captured a fragment
only. Everything visual from the header redesign onward was built from
Andrew's screenshots rather than my own eyes, and it shows: several rounds
were spent fixing things I would have caught immediately on screen (the
`.top-bar` margin pushing the header buttons up; squeezing the command card
vertically when the ask was horizontal).

`getComputedStyle` also lied repeatedly — reporting `transparent` for rules
that demonstrably matched with no competitor, which usually means a skipped
subtree. **Do not trust it as the sole check.** Get the window healthy
first; a fresh tab at default zoom, or reopening the Chrome window.

**UPDATE 2026-08-07: the browser is healthy again** — a fresh tab came up
at `innerWidth: 1865`, `dpr: 2`, and drove the app normally end to end
(resume a document, walk the pill bar, expand rows, read panels). Nothing
special was needed; the wedge did not survive a new tab. Every claim added
to this file on 2026-08-07 was taken from that session against the real
DOM, and the §4 correction is what the wedge had been hiding.

---

## 2. Shipped — the two review-unit types are one category

Andrew's ruling, verbatim, and the reason the earlier separate-category
design was reverted:

> Users do not care that one is a candidate review and the others are
> relationship proposals. ... The navigation taxonomy should reflect the
> user's work, not the underlying data structures.

- Relationship proposals file into the category a reviewer would look for
  them in (`RELATIONSHIP_KIND_SECTION`): acronym→Acronyms, numeric and
  alphanumeric→Numeric, inserted-word→Other.
- Sections carry `relationshipProposalIds` ALONGSIDE `candidateIds`, not
  merged into them: `headingActionScope`, `reviewZone`, row selection and
  the digit ceiling all mean "candidates" specifically. The split Andrew
  objected to was in the TAXONOMY; the storage staying typed costs nothing.
- A proposal renders as an ordinary row (`A ↔ B`), its card mounts in the
  detail pane, and the other unit type DIMS rather than hiding or moving.
- **No category-level bulk action in a mixed category**, his ruling: "I'd
  rather have no bulk action than a confusing one. Controls should exist
  because they solve a user problem, not because every screen is expected
  to have the same controls." Select-all is likewise absent there.
- The collection keeps its OWN globals (`Accept as acronyms (3)`), which is
  not a contradiction: those act only on the pairs.

## 3. Shipped — rules that now govern more than one surface

These were stated as general principles and implemented at shared choke
points, so they land on Item Check when it adopts this pass:

- **No global button over a single item** (`bulkWorthwhile` in
  `headingSectionActions`). A bulk control over one item is the item's own
  card, reworded, and it eats a digit from the scarce 1–9 space.
- **An action only exists if its option does** — "Accept written out" is
  derived from `preferredActionsForRelationship`, not rendered
  unconditionally with the mismatch pushed into a hint.
- **The command card advertises only keys with NO on-screen control of
  their own.** K/C/R/I moved onto the panel buttons; `1–9`, section digits,
  `⇧K/⇧C/⇧R/⇧I` were already printed on their controls; `⇧A` was retired
  (redundant, and after the two rules above it could fire where no button
  was drawn). Arrows dropped too — "users know what arrows do."
- Deleting those derived segments **deletes the Infinity–9 class of bug**:
  each worked by re-deriving a key range from a scope it did not own.

## 4. Shipped — Other Words (REVISED 2026-08-07: the routing does not work)

Andrew, on finding Kyle beside Math and Residency in Other: "These seem..
curious choices."

They arrived by the same route (person-typed, no archetype matched) but are
not the same thing. The split is now on **name evidence**
(`hasKnownNameEvidence`, exported so sectioning and archetype derivation
read one predicate):

- name evidence → the names family
- none → **Other Words** (Math, Residency, "and", "did")
- non-person, no archetype → Other, which is now what it claims to be

His reframing is the load-bearing idea, and it is the part that holds up:
*"Common English Words"* asserts DICTIONARY MEMBERSHIP, so every lexicon
gap fell through to Other. *"Other Words"* asserts only "this is a word,
not a name," which needs no entry.

**But the category is still coupled to lexicon coverage — the coupling
moved down a layer instead of coming out.** The original text of this
section claimed "name evidence → the names family (Kyle, 95% identity
match, tier Likely)". That is false against the live document, and the
correction is §6.3. Kyle is in Other Words. So is Amy. The predicate is
sound; the evidence it is allowed to see is not.

`tier === "needs-review"` was dropped from that branch — a proxy for "has
something worth reviewing" that name evidence answers directly. That part
was right, and it is not what is failing.

**The lesson worth carrying, since this file is what a future session
trusts:** the sectioning change was verified by reading the predicate and
reasoning about what it would do, not by opening the category and looking
at it. The reasoning was correct and the outcome was still wrong, because
the input to the predicate was never checked. `verify/` cannot catch this
class — `triage-queue-verification.ts` passes 66/66 by constructing
`nameEvidence: true` for its Kyle fixture, which is exactly the fact the
real document does not supply.

## 5. Shipped — layout

- **One top line**: `+ New · Resume · Documents` left, wordmark centre,
  filename (small, muted) + save state + hamburger right. The document
  picker is retired. The toolbar joined the sticky chrome, which is what
  let the command card align with it.
- **Command card**: six entries, three rows, right-aligned, light border,
  keys as weighted text rather than boxed keycaps.
- **Flat surfaces**: stage body, cells and focus panel lost their borders
  and fills. Row banding survives and is now **load-bearing** — it is the
  only thing separating rows.
- Decision Tracker centred under the wordmark and demoted; the statistics
  line (`1% complete … By type`) removed, its space kept.

---

## 6. OPEN — in priority order (REVISED 2026-08-07)

1. **The mixed-category traversal seam.** §0. **DEFECT.** Still the top
   item; nothing below has moved ahead of it.

2. **Darken the row banding one step.** **PREFERENCE.** `#f9fafc` was
   chosen when cells had borders doing the separating; it now carries that
   job alone. Andrew: "it's so subtle I didn't see it until you mentioned
   it."

3. **Other Words files real names as words.** **DEFECT**, and it is not
   the item that used to sit here.

   The original entry said `common-words` "still carries
   `TRIAGE_SECTION_ACCEPT_DEFAULT: "Ignore"`" and that "its population just
   widened", so a bulk Ignore might catch an unusual surname. **Both halves
   are wrong, and they are wrong in a way that made the item look
   contained when it is not.**

   - `AMBIGUITY_QUEUE_POLICY.acceptFor` is `() => undefined` (app.ts).
     Ambiguity Check never reads `TRIAGE_SECTION_ACCEPT_DEFAULT` at all.
   - Item Check's `triageSectionFor` still routes only `archetype ===
     "common-word"` to `common-words`. **Its population did not widen.**
     The name-evidence split lives in `ambiguitySectionFor` alone.

   So the map holding `"Ignore"` governs a surface whose population is
   unchanged, and the surface whose population changed does not read that
   map. The two are independent today. **The stated risk is not live by
   the stated route.**

   It is live by another one. Verified in the browser, 2026-08-07, on the
   Teams transcript:

   - Other Words' only bulk control is its own strong-tier action, which
     applies **Ignore** over 23 items.
   - **Amy is item 1 in that tier.** Source text: "im so surprised [Amy]
     doesn't know how to answer her own Staff questions". 90% exact
     first-name match to "Amy Miller". Quality calls it "Unlikely /
     Common word".
   - **Kyle is in this category too** — 95% match to "Kyle Francis" —
     which §4 explicitly said would not happen.

   Root cause, and it is the same one as item 4: `hasKnownNameEvidence`
   gates on the curated name dictionaries, and those hold **23 given names
   and 5 surnames**. "andrew" and "tamara" are in. "amy", "kyle", "chris"
   are not. The predicate does not currently mean "has name evidence"; it
   means "is one of about thirty names we listed", and a false answer is
   indistinguishable from a genuine absence of evidence.

   Recorded at both sites (`recommendations.ts`, `ambiguitySectionFor`).
   **Do not fix by widening the dictionary** — that makes it rarer without
   changing its shape. The evidence that settles Amy and Kyle already
   exists in entity resolution and never reaches the predicate. Routing it
   in is the fix, and it is a product decision because it moves items
   between categories on a shipped surface — hence flagged, not done.

   **Traced in full: `20260807-person-name-evidence-architecture.md`.**
   Read it before touching any of this. The three corrections that matter
   to anyone working from this file:

   - **Amy and Kyle arrive by DIFFERENT routes.** Amy exits at the
     `common-word` archetype (`"amy"` is in a 51,455-entry general
     wordlist) and never consults `nameEvidence` at all; Kyle exits at the
     uncertain branch and does. **A fix aimed only at
     `hasKnownNameEvidence` repairs Kyle and leaves Amy**, which would
     look like success on the category that raised the question.
   - **The evidence is not lost anywhere.** `RecommendationFacts` carries
     `identityOptions` into `deriveRecommendation`, which computes
     `recognized` from it and then ANDs it with the dictionary. Both axes
     are in scope at the decision; the dictionary wins.
   - **There are four live definitions of "has person-name evidence"**,
     three with different membership. `known-surname` counts as name
     evidence in `normalization.ts` and does not in sectioning.

4. **The untiered tail has no bulk disposition.** **UX GAP.** Confirmed
   live, not inferred.

   Other Words shows **"0 complete • 26 remaining"** and a single bulk
   button reading **"These are all words, not names (23)"**. Nothing on
   screen accounts for the other three.

   The three are Kyle, Math and Residency. `buildAmbiguitySections` keys
   each item by `item.tier ?? "untiered"`, and untiered ids are appended
   to `candidateIds` **without forming a tier group**. Bulk actions scope
   to `tier.candidateIds` (`headingSectionActions`), so an untiered item
   is outside every bulk control the section has. The Ambiguity policy
   declares no `sectionActionsFor`, so there is no section-level fallback
   either. Ruled out the alternative reading: zero items in the section
   are decided, so 26 − 23 is not "three already handled".

   Math and Residency are additionally behind the collapsed remainder —
   the band is 24, which is the 23 tiered plus Kyle. That part is correct
   behaviour and worth knowing before someone reads a blank row as a bug.

   The sting: Math and Residency are the exact items Andrew's "curious
   choices" complaint was about, and the bulk disposition built for them
   cannot reach them. Two candidate fixes, unruled — give the section a
   `sectionActionsFor` covering its whole scope, or give untiered items a
   tier. The second is probably right (an item with no tier is a modelling
   hole, not a category) but it changes what tiers mean, so it needs a
   ruling.

5. **The quality dictionary is thin — and it is load-bearing, not
   cosmetic.** **DEFECT**, upgraded from housekeeping.

   The earlier note said "`quality-dictionaries.data.ts` is 53 lines"; it
   is 53 *very long* lines, ~628KB, so line count says nothing. The number
   that matters is the one measured above: **KNOWN_GIVEN_NAMES = 23,
   KNOWN_SURNAMES = 5.** That is what item 3 is standing on.

   Also wrong in the earlier note: "Other Words now files them correctly,
   but by FALLING THROUGH rather than by being understood." Falling
   through is right for Math and Residency and is precisely what
   misfiles Amy and Kyle. The mechanism is the same; only the input
   differs. Generated by `scripts/generate_quality_dictionaries.py` —
   widening at the source helps the term categories and does **not**
   resolve item 3.

6. **Group Check adopts this UX** — carried over. **ARCHITECTURE.** A
   *relocation, not a redesign*.

   The earlier framing — "`ZONE_CAPACITY` is still global; raise it rather
   than quietly parameterising" — asks a question that is already answered
   in the signature. `reviewZone(orderedUndecidedIds, size =
   ZONE_CAPACITY)` **already takes a size**, and both call sites already
   pass the constant explicitly. Parameterising is not something a future
   session could do quietly; the seam exists and is visible.

   The real decision is *who owns the number*:

   - **Capacity belongs to the review-unit and the grid that renders it,
     not to the review surface.** 24 was chosen because it is a rectangle
     at 2/3/4/6/8/12 columns and about a screenful of cells. Both are
     facts about cell size and column count — properties of the presented
     grid. Neither is a fact about which stage you are standing on.
   - **Keep the existing default until Group Check's rendered grid
     justifies an override.** Andrew's own open question ("longer text,
     fewer items — maybe one column") is a claim about the cells, so it
     is the right kind of reason; it just has to be *measured on the
     rendered grid* rather than assumed from the surface.
   - **Do not add a surface-specific capacity without a demonstrated
     layout need.** A per-surface knob lets two surfaces disagree about a
     question neither of them owns, and the disagreement would be
     invisible — the same second-derivation failure §7 keeps naming.

   This binds item 7: kind groups are the other caller that wants a
   capacity, and deciding them separately is how one question gets two
   answers.

7. **Extract the advance ladder.** **ARCHITECTURE.**
   `decideThroughOwningCursor()` is a patch and the bug it patches has
   regressed three times.

8. **The artifact axis is unbounded** (§12 of the zone design).
   **ARCHITECTURE.** Its stated reason is STALE — it cites a measured zone
   size that `ZONE_CAPACITY` replaced. Now that kind groups are peer
   members of categories, bounding them needs a capacity and a label,
   nothing more. Decide it *with* item 6, under the same ownership rule:
   a kind group's capacity is a fact about the card grid it renders.

9. **`.scope-split` is 3fr/2fr, inspector first** — 767px panel, 511px
   queue. **PREFERENCE**, with an argument it did not previously have.

   Still not the overflow it looks like (`minmax(0, 34rem)` is a MAX, so
   columns shrink rather than reflow). What changed is the justification.
   3fr/2fr was set when the remainder rendered open, so the queue column
   was one view of a long scroll and the inspector was the only place
   detail lived. **Collapsing the remainder made the queue column the
   whole of the visible work**, and the band inside it is capped at 24
   cells that now shrink to ~247px each to fit — while the inspector
   holds one item in 767px.

   So the density argument now points the other way. Measured on Other
   Words: band cells render at 343px inside the split while the collapsed
   remainder's cells, at full width, get 544px — the same review unit at
   two very different sizes on one screen, with the smaller one being the
   copy the reviewer is actually working in.

   **Not** a cause of item 4, though it looks adjacent: the band holds 24
   because `ZONE_CAPACITY` is counted, never measured, so Math and
   Residency fall outside it at 26 undecided regardless of how wide the
   column is. Widening the queue changes cell size, not band membership.
   Worth re-measuring before picking a ratio — the 767/511 numbers were
   taken under the old open-remainder layout.

---

## 7. Working with Andrew

- He thinks aloud; not every idea discussed is a decision. When in doubt,
  ask or treat it as exploration.
- **He is usually right about causes, not just symptoms.** "Isn't it
  redundant?" (⇧A), "why do they not show up under Acronyms?", and "these
  seem.. curious choices" each named a real architectural defect from the
  outside. Chase the cause he is pointing at rather than the pixel.
- **Push back with reasoning.** He overruled me correctly several times
  today; I overruled him with measurement twice (the 6,021px remainder that
  forced the collapsed disclosure; the 10.6 screens that made the overflow
  band a prerequisite rather than a nicety).
- Distinguish objective defects / architectural concerns / stylistic
  preference / future enhancements. Those are different categories. §6 now
  tags every open item with which one it is; keep that up, because the
  §6.3 correction only surfaced once the item was forced to say whether it
  was a defect or a decision. It had been filed as a decision and was a
  defect.
- **Verify against the document, not against the predicate.** The 2026-08-06
  Other Words work reasoned correctly about `hasKnownNameEvidence` and
  never opened the category to see what landed in it. The reasoning was
  sound and the result was still wrong, because the dictionary feeding the
  predicate holds 23 given names. A passing suite is not evidence here —
  the fixture supplies `nameEvidence: true` for its Kyle, which is exactly
  the fact the real document withholds.
- **The recurring root cause this session was ONE FACT DERIVED IN TWO
  PLACES**: the pill count vs the heading count; the pill bar's model vs
  the renderer's own `buildAmbiguitySections`; the legend's key range vs
  the buttons'; the mover's coordinate space vs the grid's. When something
  disagrees on screen, look for the second derivation first.
- Decisions get recorded **in the code**, at the site, with the reasoning
  and the rejected alternatives. That convention is why this file is short.
