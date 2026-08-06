# Reviewer Recommendation UX — findings and implementation record

Date: 2026-07-30 · App version: v2026-07-30.07
Prompt: "Reviewer Recommendation UX" (conclusion-first inversion of the
candidate detail panel; explicitly "Do not stop after producing a UX
design document").

Status: **Implemented and verified.** tsc clean, full build clean, all 32
verification suites green (including the new
`verify/recommendations-verification.ts`, 16/16), Python parity 13/13,
bare-engine byte-identity preserved (this feature is UI-only and never
touches the engines).

---

## 1. What changed, in one paragraph

The candidate detail panel used to lead with evidence — summary sentence,
Sources, Possible identities with scores, occurrences — and left the
reviewer to derive the conclusion. It now leads with the conclusion:
a single plain-language sentence ("This looks like a shortened reference
to a larger name.") followed by numbered suggestion buttons whose labels
are the *resulting interpretations* ("① Giancarlo Banuelos",
"① Department", "① ________"), and everything explanatory moves behind
one expandable **Why?** section. Nothing was removed; the panel was
reprioritized. Pressing a digit accepts the corresponding suggestion —
keystroke-compatible with the previous "1–9 Link identity" behavior.

## 2. UX architecture review (the required pre-implementation review)

**Archetypes are a UI derivation, not an engine concept.** The tempting
design is to make "recommendation" a first-class output of the detection
or resolution engines. Rejected: the engines are oracle-locked
(resolution.ts must stay byte-identical to the Python port for bare
engines) and their outputs are already sufficient — detected type,
category chips, quality recommendation, identity options with evidence
lines, structural relationship kinds. `deriveRecommendation()` in
`src/ui/recommendations.ts` is a **pure function over those existing
facts** (`RecommendationFacts`). Consequences: zero engine changes, zero
persistence changes, parity untouched, and the module is testable in Node
without a DOM.

**Recommendation generation is separated from recommendation rendering.**
`recommendations.ts` knows nothing about the DOM; app.ts's
`recommendationForCandidate()` only assembles facts (and returns null for
already-decided candidates — a decided item needs continuity of its
decision, not a fresh pitch), `renderRecommendationHeader()` only renders,
and `runRecommendationSuggestion()` only routes each `SuggestionOp` tag to
an *existing* operation:

| SuggestionOp        | Existing path invoked                          |
|---------------------|------------------------------------------------|
| `link`              | `decideAndAdvance` → `linkAmbiguousCandidate`  |
| `ignore`            | `decideAndAdvance` → `ignoreCandidate`         |
| `change-to`         | `decideAndAdvance` → `renameCandidate`         |
| `open-redact-editor`| `openInlineEditor` (Redact, cursor in blank)   |

No new commands, no new events, no new decisions.json shapes. A
recommendation accepted via button, via digit, or ignored entirely in
favor of the ordinary K/C/R/I buttons produces identical audit trails.

**Preferred Actions independence is preserved.** Structural relationship
cards keep their own card-local digit accelerators
(`preferredActions.ts`); the two systems share the visual language
(circled digits, `preferred-action` chip class, labels-as-resulting-
states) but not code paths or key territory — card digits are local to
the focused card with stopPropagation; panel digits fire only in
candidate focus. Notably, the structural cards were **already
conclusion-first** ("Possible acronym relationship." leads the card), so
this feature brings the candidate panel into consistency with them, not
the other way around.

**Future providers fit without touching this module's callers.** A new
semantic provider (Phase 3+) that emits evidence lines automatically
flows into `identityOptions[].evidence`, which is exactly what the
alias/acronym archetypes read. A new structural detector's
`RelationshipKind` lands in `relationshipKinds`. The derivation function
grows a branch; app.ts changes not at all.

## 3. The archetypes

Precedence order (first match wins), all derived from existing facts:

1. **identifier** — typed identifier (`cin`, `long_numeric_id`) or
   membership in an identifier-pattern relationship. "This looks like an
   identifier." → `① ________` (opens the Redact editor).
2. **semantic-alias / acronym** — an identity option carries knowledge
   evidence; acronym flavor when the evidence line is an acronym
   relationship. "This looks like another name for *X*." / "This looks
   like an acronym for *X*." → the expansion(s) as link suggestions.
3. **shortened-name** — single person token with identity options (the
   Giancarlo case). "This looks like a shortened reference to a larger
   name." → the candidate full names.
4. **department-organization** — category-driven. "This looks like a
   department or organization." → `① Department` (Ignore).
5. **institutional-phrase** — category-driven. "This looks like an
   institutional name." → `① Institution` (Ignore).
6. **recurring-term** — requires **both** signals: quality says Unlikely
   *and* a common-language category (calendar/frequency). "This looks
   like a recurring document term." → `① Document term` (Ignore). One
   signal alone (e.g. the person "May Chen" hitting the calendar
   category) derives nothing — the suite enforces this with a
   counter-example.
7. **null** — an ordinary full person name, an email, a phone number: no
   recommendation, and the panel renders exactly as before minus the
   inversion (there is nothing to invert around, so the Why? section
   still hosts the standard content for layout consistency).

Suggestions cap at two on the primary surface; further identity options
remain fully available (and numbered consistently) inside Why? → Possible
identities. Order is **always** the identity-option order the engine
produced, so digit N means the same target it meant before this feature.

## 4. Language redesign

Conclusions and labels are plain reviewer language; detector vocabulary
is banned and *test-enforced* (the suite regex-checks conclusions against
detector/heuristic/vocabulary/score terms, and labels against operation
verbs). Labels are resulting states, never verbs — "Giancarlo Banuelos",
not "Link to Giancarlo Banuelos"; "Department", not "Ignore as
department". Every conclusion is hedged with "This looks like…" —
deliberate: the reviewer is authoritative and the system is presenting an
interpretation, not a verdict.

## 5. Header, consistency, and confidence review

**Confidence % stays, unchanged, as detector confidence.** Reviewed and
deliberately kept: the % is the detector's confidence that the *match is
PII*, an auditable engine output the reviewer has already learned to
read (including "was x%" continuity after decisions). Overloading it to
also mean "recommendation strength" would make one number carry two
meanings — the classic explainability failure. Recommendation strength is
instead expressed the way humans express it: **language and prominence**
(a conclusion sentence exists at all only when the facts support one;
strong evidence-backed archetypes surface the specific identity by name;
weak situations get no recommendation and the panel stays neutral).

**Header order** is now: title/actions → conclusion → suggestions → Why?
(summary, Sources, Possible identities, All occurrences, Expert View).
The pills, %/✓ column, and item-scheme containment colors are untouched.

**Consistency:** structural relationship cards (already conclusion-first,
with preferred-action digits) and the candidate panel now follow one
grammar: *conclusion sentence → numbered resulting-state chips →
expandable detail*. Legends updated: Ambiguity Check's static legend and
Item Check's conditional legend both read "1–9 Accept suggestion".

## 6. Keyboard consistency

- Digits 1–9 in candidate focus: accept the Nth suggestion; if the panel
  has more identity options than surfaced suggestions, higher digits fall
  through to the raw identity-link behavior (a superset of, and
  keystroke-compatible with, the shipped behavior).
- Out-of-range digits refuse with a count, as before.
- Card-local digits on relationship cards are unaffected (stopPropagation
  keeps territories disjoint by focus context).
- K/C/R/I/F, S (Source), Shift+1–5 (stages), arrows/Tab: unchanged.

## 7. Verification

- `verify/recommendations-verification.ts` (new, 16/16): Giancarlo
  shortened-name case; digit-order preservation and cap-at-two; alias vs
  acronym evidence flavors; category archetypes (department,
  institutional, recurring-term including the both-signals
  counter-example); identifier via type and via pattern relationship;
  banned-language rules; null fallbacks (full name, email).
- Full battery: `npx tsc --noEmit` clean; `npm run build` clean; all 32
  suites green including parity (13/13) and ui-smoke (whose "Sources"
  structural check survives the move inside Why? because the rendered
  string is unchanged).

### Browser-validation checklist (needs a human at the screen)

Using the standing validation document set:

- [ ] **Giancarlo** — panel leads with "This looks like a shortened
  reference to a larger name." + "① Giancarlo Banuelos"; pressing 1
  links and advances; Why? expands to show the old panel content intact.
- [ ] **Andy → Andrew Goodloe** — semantic-alias conclusion names Andrew
  Goodloe; the evidence lines are inside Why?, not on the surface.
- [ ] **NSC** — acronym conclusion; both expansions if ambiguous
  (National Student Clearinghouse / National Safety Council seed),
  digits matching their Possible-identities order.
- [ ] **Enrollment Services / Faculty** — "① Department" chip; accepting
  produces an ordinary Ignore in decisions.json.
- [ ] **Priority Registration** — institutional-phrase conclusion.
- [ ] **MAY** — recurring-term conclusion only when quality is Unlikely;
  verify a person named "May" gets *no* recommendation.
- [ ] **998211443 / A1234567** — "① ________" opens the Redact editor
  with the cursor in the blank.
- [ ] Decided items show **no** recommendation header (decision-color
  continuity untouched).
- [ ] Why? open/close state per candidate behaves; keyboard focus never
  escapes the roving model; legends read "1–9 Accept suggestion".
- [ ] An item with no archetype (ordinary full name) renders with no
  conclusion row and no empty gap.

## 8. Judgment calls (assumption / why / alternatives / reviewer impact)

1. **Cap suggestions at two.** *Why:* the surface is a decision prompt,
   not a menu; two covers every archetype's realistic best-answers while
   Why? retains the full list at the same digit positions.
   *Alternative:* surface all — rejected as re-creating the evidence wall
   the feature exists to remove. *Impact:* rare 3+-option cases need one
   extra disclosure click, digits still work for all of them.
2. **Decided candidates derive no recommendation.** *Why:* the committed
   decision *is* the conclusion; re-pitching would fight the
   decision-color continuity model. *Alternative:* show "You decided X" —
   redundant with the emphasized button. *Impact:* none; revisiting an
   item shows its decision as before.
3. **% kept as detector confidence** (see §5). *Alternative:* a
   recommendation-strength meter — rejected as a second number to
   explain; strength is carried by language and by whether a
   recommendation appears at all.
4. **recurring-term requires both signals** (Unlikely + common-language
   category). *Why:* either alone has false positives (person named May;
   a genuinely identifying term the quality pass didn't downrank).
   *Impact:* some true document terms get no recommendation — they still
   have the ordinary Ignore button; safer than nudging toward Ignore on
   one signal.
5. **Category chip vocabulary not yet humanized.** The chips inside Why?
   still show raw category labels in places. Flagged as a follow-on
   *data* pass (a display-label map like decisionDisplayLabel), not part
   of this structural change. Two chips were already relabeled in an
   earlier wave.
6. **Null-archetype panels still use the Why? wrapper.** *Why:* one
   layout grammar for the panel regardless of archetype presence; the
   summary simply becomes the first thing inside Why?. *Alternative:*
   keep the flat legacy layout for null cases — rejected: two layouts for
   one panel is the kind of inconsistency this feature removes.

## Addendum (same day, v2026-07-30.08): keycap digits

Andrew's live feedback: the ①-⑨ circled glyphs were illegible at button
size. Replaced everywhere with a rendered `<kbd class="keycap">` square —
5px-radius corners, semibold tabular numeral at ~label size, its own
surface with a 2px bottom edge so it reads as a physical "press this
key" cap, visually distinct from the chip it sits in. Applied uniformly
to all three 1-9 digit surfaces (recommendation suggestions,
structural-card preferred actions, Possible-identities — the old small
`.possible-identity-index` badge is retired into the same class).
`CIRCLED_DIGITS` removed from preferredActions.ts; labels remain pure
resulting states with no baked-in prefix, now suite-enforced in
preferred-actions-verification. Where this document shows "① Label",
read it as the keycap rendering. All 32 suites green, tsc + build clean.

## 9. Files touched

- `src/ui/recommendations.ts` — new pure derivation module.
- `src/ui/app.ts` — `recommendationForCandidate`,
  `runRecommendationSuggestion`, `renderRecommendationHeader`, inverted
  `renderCandidateDetailPanel` (Why? wrapper), generalized
  `handleIdentityLinkKey`, legend text.
- `index.html` — `.recommendation-conclusion`,
  `.recommendation-suggestions`, `.why-view` CSS.
- `verify/recommendations-verification.ts` — new suite.
- `src/ui/version.ts` → v2026-07-30.07;
  `docs/architecture/design-notes.md` entry.
