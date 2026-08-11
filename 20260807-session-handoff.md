# DocScrub session handoff — 2026-08-07

Everything below is **built, type-checked, and passing the full `verify/` battery**
(0 failures). Work in `app/`.

---

## FIRST: the build trap that cost this session an hour

- `npm run typecheck` = `tsc --noEmit` — **writes nothing.**
- `npm run build` = `tsc` — emits to `dist/`.

The browser loads `dist/ui/app.js`. I ran `--noEmit` repeatedly and reported
changes as live that were sitting in source only. **`index.html` is not
compiled**, so CSS edits appear on refresh while TS edits silently do not — which
is exactly what makes it hard to notice.

`verify/ui-smoke.ts` does not catch this: it *imports* `dist/ui/app.js`, so it
happily validates a stale build against fresh source and reports all green. A
cheap mtime assertion in ui-smoke would close it.

**Always run `./node_modules/.bin/tsc` (no flag) before telling Andrew to refresh.**

---

## Open threads, in the order I'd take them

### 1. The advance audit (biggest; one defect, three faces)

The post-decision advance model predates proposals-being-cells. Three reports
today, one cause:

| Symptom | Path | Cause |
|---|---|---|
| ↑ from first proposal card → Other Words | `moveStructuralCardFocus` | Backed out to the **stage's** last row. **FIXED today** — now the last row of the card's own `.triage-section`, resolved via DOM. |
| `Keep as-is` on MAY → Institutional, skipping remaining Acronyms | per-item advance | Walks the visible **candidate** list; Acronyms' remaining work is proposals, so the list is empty and it falls through to the next section. |
| Accept 3 acronyms → Other Words (a *complete* category), skipping Numeric (incomplete, earlier) | `acceptAllInRelationshipKind` (app.ts ~8590) | **No advance at all** — no `selectItem`, no `advanceAfterSectionCompletion`, no `continueIntoStructuralCards`. Focus stays on now-resolved items and the landing section is whatever `visibleSections` recomputes to. |

Precedent worth reading first: the **COMPLETION-PATH AUDIT** comment at
`app.ts:~6320` found this exact shape for the section-accept buttons and fixed
it. This path was missed.

**Recommended approach:** do not add a fourth point fix. Audit every path that
resolves work on the sectioned-queue stages against one question — *after this,
where is the nearest remaining work in display order?* — with proposals and
candidates in **one** ordering rather than two. That generalises the
`advanceAfterSectionCompletion` (app.ts:7269) / `continueIntoStructuralCards`
(app.ts:~3112) pair and retires all three symptoms.

### 2. Contextual person evidence — why Amy/Kyle are in "Other Words"

**The pass IS active** (checked): `Workspace.ts:541-542` runs
`evaluateContextualPersonEvidence` and passes it to `qualityEngine.evaluate`;
Gate 3 wired at `Workspace.ts:534`. Eleven rules exist
(`engines/contextual-person-evidence/`), anchors weighted above usages:

```
anchor_full_name_with_role 50 · anchor_signature_block 48 · anchor_name_with_email 42
anchor_full_name_with_organization 40 · contextual_direct_address 40
contextual_attribution 40 · contextual_coordination 34 · contextual_person_list 32
contextual_possessive 30 · contextual_human_subject 30 · contextual_human_object 24
```

Amy's actual source text:

> "im so surprised **[Amy] doesn't know** how to answer **her own** Staff questions"

That should hit `contextual_human_subject` (Amy as subject of "doesn't know")
**and** `contextual_possessive` ("her own"). Amy's card shows **no "Used as a
person" chip at all**, while Andrew's card does. So rules exist, pass runs,
sentence should trigger two — and nothing fired.

**Test in this order** (later hypotheses are unfalsifiable if an earlier one holds):

1. Does the occurrence even reach `evaluateContextualPersonEvidence`? (normalization /
   occurrence classifier may exclude the block)
2. Do the two rules fire on that literal string? Suspect `human_subject`'s verb list
   vs. contracted "doesn't know"; `possessive` may require adjacency.
3. If they fire, does `combineContextualWeights` (diminishing multipliers for
   correlated signals, cap +55 on base 35) leave enough to flip the archetype off
   `common-word`?

`verify/contextual-person-evidence-verification.ts` exists and passes, so this is
uncovered. Adding Amy's literal sentence as a case is the fastest pin.

**Andrew's framing:** fix the *logic*, not Amy/Kyle as edge cases.

### 3. Tier ordering in term sections ("Will" bubbles up)

Andrew: *"Will is flagged (correctly) as likely NOT a name. So it should stay
here, but should bubble up to the top of the list."*

The mechanism already exists — `deriveReviewTier` + tier-group rendering
(`app.ts:~6299`) partitions a section into *"Strong Recommendations" / "Needs
Review"* with per-tier sub-headings and bulk actions. Other Words renders
untiered, so either the derivation isn't firing for this archetype or everything
lands in one tier.

Discriminating signal is already computed: a **recognized identity option**
(`recognizedOption()` in `ui/recommendations.ts` — Will has "Will Diana" 95%,
"Grading" has nothing) and `KNOWN_NAME_CATEGORIES`.

Two settled design points:
- This reorder is **safe** in a way the cycling-block ones were not: it is a
  stable sort computed at render from detection facts, so it never moves under
  the reviewer on decision. Do not conflate the two.
- The top tier **needs a heading that makes the claim** (e.g. "Might be names" over
  "Ordinary words") — per the section model, the explanation lives once in the heading.
- It splits the section's bulk action in two. That is an improvement (today
  "These are all words, not names (23)" silently includes the items most likely to
  be wrong) but it changes what one keystroke does.

Related, worth deciding first: **is Other Words admitting items by absence?**
The term archetypes are meant to be a *positive* claim ("the detector said person,
but it is really a common word"). Amy's card shows the "Common word" chip
**unmatched** while the section claims exactly that. Also check the
`ALL_COMMON_DICTIONARY_WORDS` trap — "Amy"/"Kyle" are names that appear in word
lists, not words.

---

## Shipped today (all verified)

**Decision rationale — the "Amy → Common word" bug.** Decided triage rows
rendered `rec.suggestions[0].label` unconditionally, so pressing ② "Person's name"
still displayed "→ Common word". `CandidateDecision.rationale?: string` now records
the claim actually accepted, written when a chip or identity option is pressed.
Additive/optional on the Feature 002 `source`/`importEvidence` precedent — **no
schema bump, no migration entry**; old saves degrade to decision labels.
`decideCandidate`'s optional tail became an options bag (7 call sites, all in
`engines/review/session.ts`).

- **Audit export gets `rationaleKind` ("identity-link" | "suggested-claim"), never the
  text.** A rationale can be a person's canonical name; exporting it verbatim would
  reopen the leak `AuditedEntityGroup.groupId` became an opaque alias to close, and
  violate the standing "minimize sensitive data in the audit report" instruction.
- **`DecisionMemory` does not propagate rationale** across documents — it is the prior
  reviewer's claim.

**Setup wizard on every refresh.** Root cause: Andrew's `auth.users` row predates the
`AFTER INSERT` trigger in `202608060001`, so he has no `profiles` row.
`markOnboardingComplete` used `.update()`, and **PostgREST does not error on a
zero-row UPDATE** — silent no-op forever. Fixes: new
`supabase/migrations/202608060004_backfill_existing_accounts.sql` (idempotent;
mirrors `create_profile_and_personal_organization()`; does **not** mint a personal org
for a user who already has a membership), plus `.select("id")` + throw-on-zero-rows in
`previewGate.ts`. **Migration still needs to be run against Supabase.**

Open question left for Andrew: `loadAccountState`'s synthesized-profile fallback
converts "your account is broken" into "you're a brand new user". Suggested an
`isSynthesized: true` flag rather than dropping the fallback.

**Viewport / snapping.**
- A pending blocking prompt now owns the viewport: `scrollFocusedRowIntoView` bails
  while `reopenPrompt` is set and scrolls the panel to `block:"start"`.
- The deferred `window.scrollTo(savedY)` in `applyStoredUiState` re-checks at fire time.
- New `resetViewportSnapAnchors()` clears anchors at document boundaries.
- **Section snap gated to keyboard**: `lastInputWasPointer`, maintained by two
  capture-phase listeners (`pointerdown` → true, `keydown` → false), same mechanism as
  `:focus-visible`. Clicking a visible row in another section no longer scrolls the page
  out from under the click.

**The `↔` pair token.** Undecided triage rows show `Andrew ↔ Andrew Goodloe`.
`confidentCounterpartFor(recommendation)` reads the suggestion's own label for `link`
ops (`identitySuggestions` is the sole producer and its label *is* the canonical name)
and `op.replacement` for `change-to`. `keep`/`ignore` term claims are **excluded** — "Amy
↔ Common word" would be a category error; ↔ means "these denote the same thing".
Not gated to Ambiguity Check.

**Enter/Escape level grammar.**
- `focusPanelEntered` (was `structuralCardEntered`) is now set by **both** entry paths —
  Enter on a proposal cell, and `enterItem` for a candidate.
- **Kept separate from `detailPanelFocusPending`**, which is a one-shot consumed at the
  render tail; merging them made the ring flicker off on incidental re-renders.
- Cleared in `exitDetailPanel()` — the app's existing "leave the panel" choke point.
  *This was why Escape appeared not to work:* `isDetailPanelElement(activeEl)` matches
  hundreds of lines earlier in the keydown listener and routes Escape there directly.
- **Enter as Accept retired.** It ran `suggestions[0]` — exactly what digit ① is bound
  to — and its meaning depended on invisible data (accept when a suggestion existed,
  navigate when not). Command bar updated: `Enter → "Open panel"` everywhere (also
  replaced three `Enter → "Details"` legends, which collided with `D → Details`).
- Arrows are pure movement and clear `focusPanelEntered` in both movers.
- The render tail gives the card DOM focus **only when entered** — that focus call was
  what routed arrows to the card's own listener. The routing was the bug.

**Visual.**
- `--focus-panel-max` (bottom slack 8rem → 4rem, ~+10% height) and
  `--focus-panel-surface: #e6e8ea` — both named so the three inspector columns
  (`.triage-focus-pane`, `.type-focus-pane`, `.scope-inspector`) cannot drift.
- Focus panel: capped **and** internally scrollable; larger type (title 1.5rem).
- Blue ring on the **entire pane** when entered — 1px border + 2px shadow (a 3px border
  would reflow by 4px as the eye arrives), `position: relative; z-index: 2` because
  `.triage-section-titleline` is positioned and was covering the top edge.
- Focused cell while entered: **only the border colour dulls** (35% accent). An earlier
  `opacity: 0.4` took the text with it and read as "disabled".
- `Esc exit` hint: its own right-aligned row above the title (not on `.detail-title`'s
  flex line, which wraps and whose right edge `.detail-confidence` already claims);
  accent-coloured while entered; renders unconditionally.
- Work-region enclosure: flag-shaped outline around the green buttons + list, notch at
  `calc(60% + 0.3rem)` — derived from `3fr 2fr` + `0.75rem` gap, **must move if the split
  ratio changes**. Closed-by-default with `:has(> .triage-split)` cutting the notch.
- Green section buttons **right-aligned** (`margin-left: auto` on the first, selected via
  `:not(.triage-accept-all ~ .triage-accept-all)`).
- Section pills subordinate: 0.9rem/600 → 0.82rem/500, `line-height: 1.6` to hold the
  original height (padding alone was not enough — the line box shrinks too).
- Row banding contrast raised (white / `#e8ebf0`). **`background-color` transition moved
  off `.triage-row` onto `.decision-tinted`** — `bandGridRows` assigns the band class
  after a forced layout read, so every row resolved unbanded first and the 300ms
  transition played that correction as a visible pulse.

**Collection buttons (acronyms).**
- `QueueSectionAction.scopeCount` — an action whose reach is narrower than its host
  scope now names its own count. (For well-formed pairs both accepts still legitimately
  show the same number; it only bites on a proposal missing one side.)
- Buttons render **only while `activeUnitIsProposal`**. Reverses the earlier "always
  rendered, keycapped only when active" note — standing on MAY, those buttons describe
  a decision that is not on the table. This also dissolved the capless-button report:
  the missing cap was a symptom of a button that should not have been drawn.

---

## Settled design (do not relitigate)

The **cycling block** layout model is fully designed and recorded in memory
(`docscrub-cycling-block-design`). Not built. Fixed-height panel + fixed 2-column
block split into departing/arriving halves; cursor exhausts the block → decided
top-half cells rotate to the end of the section, undecided promote and stay, bottom
becomes top, new bottom populates. Three alternatives already rejected with reasons.
The cycle trigger is free (`reconcile()` already tries to leave the block); the pulse
must wait out `ACKNOWLEDGEMENT_MS` (700ms) or it lands on the wrong cell.

Also queued, untouched: Ambiguity Check has **no search box**
(`renderItemCheckToolbar` is Item Check only; `jumpToFirstSearchResult` early-returns
on other stages).
