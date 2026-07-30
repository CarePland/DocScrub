# Ambiguity anchor correction (2026-07-28)

## Andrew's report

In a real document, `Andrew Goodloe` was already detected as a person, while five occurrences of the bare first name `Andrew` appeared downstream as a separate 45%-quality person candidate. Ambiguity Check never proposed the connection between them -- Andrew asked for a trace of why, the smallest architectural correction, a regression-risk analysis for people who share a first name, and verification.

## Root-cause trace

Four candidate layers were considered, per Andrew's own framing: candidate generation, entity-linking evidence, ambiguity routing, thresholding, resolved-item suppression.

**Candidate generation (`DetectionEngine.ts`) -- not the bug.** `detectPeople()`'s single-name person path only emits a bare-first-name candidate at all once it occurs `>=2` times in the document (`singleNameCounts.get(key) >= 2`). `Andrew` occurred 5 times, so it was generated correctly, with `detectedType: "person"`.

**Resolved-item suppression (`stages.ts`/`coverage.ts`) -- not the bug.** `isItemResolved()` already derives "resolved" from `candidateResolvedStatus()`, which checks `session.candidateDecisions` and resolved-group coverage. This machinery works correctly and needed no changes -- the actual defect happened one step earlier: `Andrew` was never being offered a decision path (link or decline) that would populate it, in the way it should have been.

**Entity-linking evidence + ambiguity routing (`entity-resolution/resolution.ts`) -- the actual defect, two compounding problems in the same file:**

1. `buildAmbiguousMatches()` sourced its "which entities could this first name plausibly refer to" evidence from the FINAL, already-filtered `groups` list -- i.e. only person buckets that had independently reached `buildEntityGroups()`'s `>=2`-member threshold for real grouping (typically via a spelling-variant pair like `Andrew Goodloe` + `A. Goodloe`). A person mentioned with only ONE full-name spelling never reaches that threshold on its own and was therefore invisible to ambiguity matching entirely -- not merged, not flagged, just silently absent from both `groups` and the ambiguity list.

2. Separately, `buildEntityGroups()` auto-merged a first-name-only candidate into a bucket whenever EXACTLY ONE full-name bucket matched its first name -- silently, before Ambiguity Check ever saw it, with no reviewer confirmation, no event, no audit trail. Combined with (1): exactly one match meant a silent, unreviewable auto-merge; two or more matches meant neither full-name bucket reached the threshold on its own (each stayed at size 1), so no group formed and no ambiguity was proposed either -- the first name fell through as an ordinary, disconnected candidate that was never linked to anyone.

Andrew's document hit case (1): one full-name spelling of `Andrew Goodloe`, so the bare `Andrew` candidate was simply invisible to both mechanisms.

**Thresholding -- a symptom, not a separate defect.** The `>=2`-member threshold itself is correct and necessary for *grouping* (it is what keeps a single stray mention from silently merging into an unrelated candidate). The defect was reusing that same threshold as the *evidence source for ambiguity*, conflating "is this a confirmed group" with "does a plausible entity exist to ask the reviewer about." Those are different questions and needed different answers.

**Not a TS-introduced regression.** `redactor/entity_resolution.py`'s own `build_entity_groups()`/`build_ambiguous_matches()` were read directly and have the identical defect -- this was faithfully ported, not introduced during migration. `tests/test_entity_resolution.py`'s own `test_groups_person_name_variants_conservatively` and `test_ambiguous_short_name_routes_to_ambiguous_matching` only ever test scenarios where each full name independently already has 2+ spelling variants (e.g. `Andrew Goodloe` + `A. Goodloe`) -- never a solitary full name -- which is exactly why this gap was never caught by either codebase's own tests.

## The fix

`src/engines/entity-resolution/resolution.ts`:

- Removed `buildEntityGroups()`'s silent short-name auto-merge entirely. A first-name-only candidate is never merged into any bucket automatically; whether it plausibly belongs to a full-name entity is now always a question for the reviewer, never an automatic decision.
- Added `buildFullNameAnchorBuckets()`: every detected full-name (2+ token) person candidate, bucketed by the same `last-name:first-initial` key `buildEntityGroups` uses, but WITHOUT its `>=2`-member threshold. A person mentioned with only one spelling is just as real an entity as one mentioned with several -- they differ only in how much independent support exists, not in whether they're a legitimate link target.
- Rewrote `buildAmbiguousMatches()` to source its evidence from these anchor buckets instead of the post-filter `groups` list, and to propose ambiguity whenever `>=1` anchor matches (not only `>=2`). A solitary anchor is presented as a possibility the reviewer confirms or declines -- never auto-linked.

`src/engines/EntityResolutionEngine.ts`: threaded `qualityOf` into `buildAmbiguousMatches()` (previously only `buildEntityGroups()` received it), since anchor scoring now needs the same quality-aware `memberScore()` formula realized groups already used.

`src/domain/Commands.ts` / `src/engines/review/session.ts`: added `linkAmbiguousCandidate` (`{candidateId, groupId}`), the first command to write to `ReviewSession.ambiguityResolutions` -- a schema that has existed since ADR-008/Phase 8 but was never populated by any command until now. It validates `groupId` against the candidate's own live `AmbiguityProposal.candidateGroupOptions` (never trusted blindly), then:

- Applies **Keep**, not Rename. Linking identity ("this occurrence of `Andrew` refers to Andrew Goodloe") is not the same act as rewriting surface text -- that remains a separate, explicit Rename/Redact choice, exactly like every other candidate. This is also what makes surface-text preservation structural rather than something this command has to remember to do: `Keep` never sets a `replacement`.
- Records the linkage in `ambiguityResolutions` for audit purposes, and emits both a `candidate-decided` and an `ambiguity-resolved` event.

Declining a suggestion needed no new command: dispatching `keepCandidate` / `renameCandidate` / `redactCandidate` / `ignoreCandidate` directly, exactly as Ambiguity Check already allowed, is how a reviewer says "this isn't that person" (or isn't a name at all in this context).

`src/ui/app.ts`: added `ambiguityLinkButtons()`, rendered only on the Ambiguity Check stage -- one button per proposed option, reading `This is {canonicalName} ({confidence}%)`, with a checkmark once linked.

**Why this is the smallest correction, not a redesign:** no new domain concepts were introduced. `ambiguityResolutions` and the `ambiguity-resolved` event already existed, unused, since Phase 8 -- this closes a gap in wiring, not a gap in the schema. Occurrence inheritance is structural (a single `Candidate` already owns all its `occurrenceIds`; there was never a per-occurrence decision to reconcile). Suppression from later stages is structural (`coverage.ts`/`stages.ts` already derive "resolved" from `candidateDecisions`, unchanged). The only genuinely new code is: don't auto-merge, source evidence more broadly, and give the reviewer a button to confirm what used to be assumed.

## Regression risk: multiple people sharing a first name

This was the case most likely to break under a naive fix (e.g. "just link whenever exactly one anchor exists" would have been fine, but "always link to the first/best-scoring anchor" would have silently guessed wrong for two people). The chosen design avoids this by construction:

- `buildFullNameAnchorBuckets()` and the ambiguity loop naturally produce **all** matching anchors, not just the best one -- `Andrew Goodloe` and `Andrew Jackson` both appear as options, each with their own independently-computed confidence.
- `linkAmbiguousCandidate` requires an explicit `groupId` chosen from the candidate's own current `candidateGroupOptions` -- there is no "auto-pick the highest-confidence option" path anywhere in the reducer. A document with `N` same-first-name people always surfaces `N` options; the reviewer, not a heuristic, decides which one.
- Linking is per-candidate and one-directional: resolving `Andrew` against `Andrew Goodloe`'s anchor key touches only `Andrew`'s own `CandidateDecision`/`ambiguityResolutions` entry. `Andrew Goodloe` and `Andrew Jackson`'s own candidates and decisions are untouched -- there is no merge operation that could cross-contaminate two distinct people.
- This was independently confirmed by a fixture that predates this fix and was never designed to test it: `fixtures/domain-parity/entity-resolution-001` already contained a `Maria`/`Maria Alvarez` pairing that turned out to exercise the identical solitary-anchor defect (see "A fixture caught this defect independently" below), and a `Carlos Mendez`/`Elena Mendez` same-surname-different-first-initial pair that continues to correctly never merge, confirming the fix didn't loosen anything it shouldn't have.

## A fixture caught this defect independently

While re-running the full verification battery, `verify/entity-resolution-parity.ts` failed against `fixtures/domain-parity/entity-resolution-001` -- a fixture built months earlier for unrelated Phase 6 coverage. Its own `Maria`/`Maria Alvarez` scenario turned out to be the *same* defect: Python's oracle silently auto-merged the bare `Maria` short reference into `Maria Alvarez`'s bucket (documented in the fixture's own manifest notes as an intended "variant-grouping" feature at the time it was written). Under the fix, that bucket no longer reaches the 2-member grouping threshold and `Maria` is correctly routed to Ambiguity Check instead -- exactly mirroring the `Andrew`/`Andrew Goodloe` case, from an entirely independent document.

This is treated as an approved, disclosed deviation from the Python-exported fixture, not a fixture bug or a TS regression -- `fixtures/domain-parity/entity-resolution-001/manifest.json` now carries a `deviations[]` entry explaining it, and `verify/entity-resolution-parity.ts` compares this one fixture's `entityGroups`/`ambiguityProposals` against a locally-defined corrected expectation (values captured from a real passing run, not hand-computed) rather than the raw Python export, which still records the original buggy output on purpose as a historical record. Every other field of this fixture, and every other fixture, is still compared against the unmodified Python export.

One downstream consequence: `verify/group-bulk-actions-verification.ts` depended on this fixture having 3 real (`>=2`-member) entity groups to exercise three group-level bulk actions in one combined scenario. Post-fix it legitimately has 2 (`Andrew Jackson`, `Andrew Goodloe` -- both independently had 2 real spelling variants and are unaffected). Rather than mutate the shared fixture (9 other suites depend on it) to manufacture a third, the combined scenario was reduced to the 2 real groups; the specific property it would have lost (`redactGroup` also stamps a group-level `Confirmed` decision) remains independently verified in that suite's own standalone `--- Redact Group ---` section. No coverage was lost, no golden fixture was touched.

## Verification

New suite: `verify/ambiguity-anchor-verification.ts`, 45 checks, covering exactly Andrew's five requested scenarios plus a regression check and error paths:

- **Part A** (pure `resolution.ts` functions): one full name + matching first-name-only occurrences (A1); two people sharing that first name, both offered as distinct options (A2); first-name text with no matching full-name anchor anywhere -- confirms no ambiguity is fabricated when no evidence exists (A3); regression check that the previously-working two-independently-multi-variant-names case is unaffected, including that a realized group's anchor id is identical to its own group id (A4).
- **Part B** (full `DurableReviewEngine` + `stages.ts` pipeline): linking to a full-name entity records `Keep` with no `replacement`, populates `ambiguityResolutions`, and suppresses the candidate from both Ambiguity Check and Item Check going forward (B1); `linkAmbiguousCandidate` rejects an option that isn't one of the candidate's own live proposals (B2) and rejects a candidate that isn't currently ambiguous (B3); the two-same-first-name regression case end-to-end, confirming linking to one person leaves the other's candidate and decisions completely untouched (B4); declining via a direct `ignoreCandidate` dispatch (no `linkAmbiguousCandidate` involved) still suppresses the item correctly while leaving `ambiguityResolutions` empty, distinguishing "resolved by decline" from "resolved by link" (B5).

Full regression battery: all 18 verification suites re-run, zero regressions (`tsc --noEmit` clean throughout). Two pre-existing suites needed updates to reflect the corrected ground truth rather than the prior buggy behavior -- `entity-resolution-parity.ts` (see above) and `group-bulk-actions-verification.ts` (see above) -- both changes are additive/corrective to test expectations, not weakenings of what they verify.

**Real browser validation**: loaded `fixtures/domain-parity/entity-resolution-001/source/synthetic_entity_resolution.docx` fresh via Claude in Chrome against a locally-served build. Ambiguity Check correctly surfaced both `Andrew (person) 35%` (with `This is Andrew Goodloe (86%)` and `This is Andrew Jackson (91%)` buttons) and `Maria (person) 11%` (with `This is Maria Alvarez (90%)`). Clicking `This is Andrew Goodloe` recorded `Keep`, showed a checkmark, dropped Ambiguity Check's unresolved count from 2 to 1, and dropped Item Check's unresolved count from 13 to 12 in the same instant -- confirmed live, not just in Node. Clicking `This is Maria Alvarez` repeated the same result for Maria. Item Check's full list afterward showed `Andrew (person) -- Keep` and `Maria (person) -- Keep` (surface text unchanged, decision visible, still listed per the "items never disappear" invariant, correctly excluded from the unresolved count) alongside `Andrew Goodloe`, `Andrew Jackson`, and `Andy Jackson`/`Andy Goodloe` all remaining independent and untouched. No defects found.

## Answer to Andrew's root-cause question

Entity-linking evidence and ambiguity routing, both inside `buildAmbiguousMatches()`/`buildEntityGroups()` in `resolution.ts` -- not candidate generation, not thresholding in isolation, and not resolved-item suppression, all three of which were already correct.
