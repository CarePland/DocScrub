# Structural Relationship Review — Findings

**Date:** 2026-07-30 · **Version:** v2026-07-30.03 · **Spec:** Andrew's "Feature Proposal: Structural Relationship Review" (chat, 2026-07-30), implemented under `docs/architecture/implementation-philosophy.md`.
**Status:** Implementation complete; all automated verification green (28 suites; new suite 32/32). Browser validation pending (checklist below).

## Architecture chosen

**A reusable relationship-detector framework, separate from entity ambiguity, with zero new decision granularity.**

- **`StructuralRelationshipEngine`** (`src/engines/StructuralRelationshipEngine.ts`): an ordered registry of pure `RelationshipDetector` functions over `DetectionResult.candidates`, each emitting `RelationshipProposal { proposalId, kind, candidateIds, observation, evidence }`. Adding a detector is one registry entry — the proposal shape, dismissal semantics, and UI presentation are detector-agnostic by construction (the proposal's stated objective). Deliberately **not** part of `EntityResolutionEngine`: entity ambiguity is semantic identity with resolution scoring and a Python oracle; this is non-semantic shape with exact matching and no oracle. `GroupingResult` and every parity suite are untouched.
- **Proposals are derived state**, recomputed per document load (like quality/grouping/classification), exposed as `WorkspaceState.structuralRelationships`. Proposal ids are **content-derived** (`rel-acronym-CSULA`, `rel-pattern-AAA-#####`) so the same document yields the same ids on every load — which is what makes a stored dismissal durable.
- **The only durable state is dismissals**: `ReviewSession.relationshipDismissals` (additive, *optional*, **no schema bump** — a pre-feature session simply has none, which is true; unlike entityRegistry's v2 break, absence fabricates nothing), written by the new `review.dismissRelationship` command, which appends a `relationship-dismissed` event carrying the proposal's own facts so the session/audit record stands alone without re-running detection.
- **Acceptance stores nothing**: Keep/Change/Redact All-or-Selected are ordinary `bulkApplyDecision` dispatches over the proposal's (selected) members — per-candidate decisions byte-identical to deciding each member by hand. Rebuild, audit, decisions.json, decision-reuse, and Item Review semantics are untouched by construction. A proposal reads as **addressed** when every member carries a decision — derived, never stored.
- **Stage integration**: a "Structural relationships" section renders at the top of the Ambiguity stage (before the empty-stage early return, so a document with proposals but no entity ambiguities still shows them). FocusNavigator's stage item lists are untouched — proposals are not focus items (see Judgment 4).

## The two detectors

- **Acronym** (`acronymOfValue` / `isAcronymToken`): initials of a value's capitalized words (punctuation stripped; lowercase connectors skipped by the capitalization test itself, no stopword list) matched against bare 2–10-letter uppercase tokens. All fulls + all acronym candidates sharing one token join a single proposal. Evidence: `The initials of "California State University, Los Angeles" spell "CSULA".`
- **Identifier patterns** (`shapeSignatureOf` / `isIdentifierPatternEligible`): digits→`#`, letters→`A`, separators literal; single-token, length ≥ 4, contains a digit, identifier-plausible characters only; grouped by identical signature with ≥ 2 members. Kind is `numeric-identifier` (no letters) or `alphanumeric-identifier`. Observations are the spec's sentences **verbatim**; evidence shows the exact signature (`Shared pattern: AAA-#####  (# = digit, A = letter)`), monospaced in the UI.

## Reviewer workflow

Proposal cards: kind label (`Possible acronym relationship` / `…numeric identifier pattern` / `…alphanumeric identifier pattern`), the observation, the deterministic evidence, member rows with checkboxes (Group Check's unchecked-set pattern; name + occurrence count + circled ✓ once decided), and actions **Keep All/Selected · Change All/Selected · Redact All/Selected · Unrelated** (labels adapt to selection, matching the group-row convention). Change/Redact open the standard inline editor (new `relationship` scope) with the pending-decision preview on the card, per the item-scheme paradigm; the acknowledgement pulse fires on the card. "Unrelated" narrates via the status region: *"Relationship dissolved — its candidates continue through review individually."* Addressed proposals stay visible with the circled ✓; dismissed ones disappear.

## Judgment calls (assumption · why · alternatives · reviewer impact)

1. **Email/phone candidates are excluded from identifier-pattern detection.** Their semantics are already known and typed by detection; proposing "these share a pattern" over every phone number is noise. Alternative (include them) rejected as clutter. Impact: fewer, higher-signal proposals; phones/emails still review normally.
2. **Minimum pattern group = 2 distinct candidates; minimum token length 4; single-token only.** Below these, shape collisions are coincidence, not structure. Impact: conservative proposals; thresholds are constants, trivially tunable.
3. **No relationship-level "accepted" record.** Acceptance is expressed by the decisions it produces (plus `viaBulkApply` events); storing a parallel acceptance flag would duplicate derived truth. Alternative (an `appliedRelationships` record) rejected per derive-don't-duplicate. Impact: audit shows *what happened* (decisions + batch events + dismissals); "this proposal was used" is inferable, not stamped.
4. **Proposals are not FocusNavigator items.** Teaching `stages.ts`/`navigator.ts` a second ambiguity item kind would extend the domain traversal model for items that don't gate anything (stage counts/readiness are entity-ambiguity/Item-Check based, unchanged). The section is part of the review surface; its controls are tabbable under the existing region/Escape grammar. Impact: arrows/Tab move through entity ambiguities exactly as before.
5. **Keyboard letters deferred** (see below).
6. **No "restore dismissed relationship" affordance** — not in the proposal; dismissals are durable and audited. A future "show dismissed" toggle is a cheap extension.
7. **Re-detection stability**: dismissals key on content-derived ids, so a re-load re-proposes exactly what was dismissed and the dismissal still applies. If the document changes such that the same id means a different member set, the dismissal still suppresses it — acceptable for v1 (the id embeds the structural key), noted for future revision-awareness.

## Proposal details adjusted

- "Keep/Change/Redact All / Selected" is implemented as one adaptive button set (label flips All↔Selected with the checkbox state) rather than eight buttons — the existing group-row convention.
- "Ignore" is deliberately **absent** from the relationship card (the proposal's own action list omits it); it remains available per-candidate in Item Review, as specified.

## Files changed

| File | Change |
|---|---|
| `src/domain/StructuralRelationship.ts` | new — proposal/dismissal types + design principles |
| `src/engines/StructuralRelationshipEngine.ts` | new — detector framework + acronym & identifier detectors |
| `src/domain/Commands.ts` | `review.dismissRelationship` |
| `src/domain/ReviewSession.ts` | optional `relationshipDismissals`; `relationship-dismissed` event kind |
| `src/engines/review/session.ts` | `dismissRelationship` reducer case (touches no candidate state) |
| `src/workspace/Workspace.ts` | engine wiring; `WorkspaceState.structuralRelationships` |
| `src/ui/app.ts` | Ambiguity-stage section; `relationship` inline-editor scope; bulk/dismiss handlers; status narration |
| `index.html` | card styling (monospace evidence, member list) |
| `verify/structural-relationship-verification.ts` | new — 32 checks |
| `src/ui/version.ts` + `docs/architecture/design-notes.md` | v2026-07-30.03 |

## Automated verification

28/28 suites green (count confirmed by counting), `tsc --noEmit` clean, full build clean. New suite covers: acronym primitives incl. connector-word and no-false-pair cases; signature primitives incl. exclusions; both detectors end-to-end with spec-verbatim observations; determinism (identical input → identical output) and content-derived ids; reducer semantics — **dismissal writes no candidate/group/entity state**, appends the audited event, rejects empty member lists; a dismissed proposal's member still takes an ordinary Keep; serialization round-trip with dismissals **and** a pre-feature session without the field.

## Browser validation checklist

1. Load a document containing an org name + its acronym and several same-shape identifiers → Ambiguity shows the section with correct observations/evidence; version label reads v2026-07-30.03.
2. Keep All on a proposal → members decided (visible in Item Check with circled ✓), card pulses, shows addressed ✓; status narrates.
3. Uncheck a member → buttons flip to "…Selected"; Change Selected → editor opens in the card with the blue pending preview; confirm → only selected members renamed.
4. Unrelated → card disappears; status reads the dissolution message; members still present and undecided in Item Check; save + resume → still dismissed.
5. Redact Selected with and without text; verify output rebuild redacts normally.
6. Escape/Tab behave per the existing region grammar around the new controls; no letter keys changed meaning anywhere.

## Intentionally deferred

- Dedicated keyboard letters / focus-list membership for proposal cards — pending the in-flight keyboard interaction language; the natural follow-up is registering the section as a region or folding proposals into a roving grid.
- A "show dismissed relationships" toggle; dotted-acronym variants ("U.S.C."); revision-aware dismissals; additional detectors (dates, addresses…) — the framework accepts them as registry entries.
