# Feature 002: Decision Reuse ("Review once. Apply everywhere.")

Second feature built after the migration was declared complete (Gates A-E,
`docs/detection/phase-12-findings.md`), immediately following Feature 001
(`docs/detection/feature-001-group-bulk-actions.md`). Like Feature 001, this
is product evolution, not a migration task -- there is no Python oracle for
this behavior; it is verified as a deterministic property/behavior suite
against real fixtures, not diffed against `redactor/*.py`.

## Design rationale

A reviewer who has already reviewed Version 1 of a document should not have
to re-decide every candidate from scratch when Version 2 arrives with minor
edits. Andrew's instruction is explicit that the goal is not merely saving
clicks: it is making subsequent reviews dramatically faster **while
preserving reviewer trust and control**. Every design decision below traces
back to that one sentence.

Three architectural facts, confirmed by reading the existing code (not
assumed), shaped the whole design:

1. **Candidate keys are already a pure function of normalized text +
   detected type.** `DetectionEngine.ts`'s `normalizeCandidate()` produces
   e.g. `"person:andrew jackson"` from normalized text alone -- nothing
   session- or document-instance-specific. This means the *same* real-world
   entity, referred to with the *same* normalized text, produces the
   *identical* `candidateId` string across two independently parsed
   documents. Exact-key matching is therefore not a heuristic at all; it is
   a direct consequence of how detection already works, and costs one map
   lookup.
2. **`DocumentRebuilder` reads only `session.candidateDecisions`, never
   `session.groupDecisions`.** Feature 001 found this the hard way (its own
   "Correctness finding" section). It is equally true here: whatever gets
   reused must land in `candidateDecisions` to actually affect the output,
   not just read as "resolved" via group coverage.
3. **A `CandidateDecision` is a single current value, overwritten in
   place, with no precedence table** (`session.ts`'s own top doc comment,
   unchanged since Phase 8). This is exactly the mechanism that makes a
   reviewer override "just work" with zero special-case code: overriding an
   imported decision is nothing more than dispatching an ordinary command
   that replaces the whole `CandidateDecision` object.

## Architecture: where the new code lives, and why

Per Andrew's explicit constraint ("do not introduce a second review
engine... ReviewEngine should remain the owner of review semantics"), the
feature is split exactly the way every other engine/Workspace/
CommandDispatcher boundary already is in this codebase:

- **`DecisionReuseEngine`** (`src/engines/DecisionReuseEngine.ts`, new) --
  a stateless, pure engine, the same shape and role as
  `EntityResolutionEngine`/`CandidateQualityEngine`: it *computes* a
  proposal (`proposeReuse(detection, grouping, imported) ->
  DecisionReuseProposal[]`) and touches no session state at all. This is
  where all three matching tiers live (see below). It is the first
  genuinely new engine added since Gate E closed -- there is no Python
  module it ports.
- **`ReviewEngine` gains one command: `applyDecisionReuse`**
  (`src/domain/Commands.ts` v6, implemented in
  `src/engines/review/session.ts`). Its payload is the *already-computed*
  `DecisionReuseProposal[]` -- the reducer only applies it, via the exact
  same `decideCandidate()` helper every other command uses, tagged with
  `source: "imported"` and the proposal's own evidence. ReviewEngine still
  owns review semantics (deciding candidates); it does not own entity
  matching (a different concern, same category as grouping).
- **`Workspace.importDecisions(file)`** (new method) is the one place that
  sequences the two: read the file (genuine I/O, same as `loadDocument()`),
  parse it, call `DecisionReuseEngine.proposeReuse()`, dispatch
  `applyDecisionReuse` to its own `ReviewEngine`, then `reconcileFocus()` --
  the identical "dispatch, then reconcile" sequence
  `WorkspaceCommandDispatcher.dispatchReview()` already uses for every other
  `review.*` command, just performed here because computing the proposals
  first requires an async file read.
- **`CommandDispatcher` gains one route**: `document.importDecisions ->
  Workspace.importDecisions()`, structurally identical to
  `document.generateAudit`. No new logic of its own.

Zero lines were added to `CommandDispatcher`'s routing logic beyond one
`case`, and zero lines were added to `FocusNavigator`. This mirrors Feature
001's own empirical finding that the architecture routes new review
behavior generically.

## Matching strategy: three deterministic tiers

No machine learning, no embeddings, no undocumented heuristic. Each tier is
independently a small, named, testable rule, evaluated in order -- a
candidate stops at the first tier that matches it.

**Tier 1 -- `exact-key` (confidence 100).** The current candidate's own
`candidateId` is byte-identical to a previously-decided candidate's
`candidateId`. Free, given fact (1) above. This is the common case for
"Version 2 has a few edits elsewhere but this person's name didn't change."

**Tier 2 -- `grouped-alias` (confidence 90).** A candidate with no Tier 1
match of its own, but which THIS document's own, already-computed
`EntityResolutionEngine` grouping places in the same proposed entity group
as another candidate that DID get a Tier 1 match. Reuses that sibling's
decision. This deliberately writes **no new alias-detection logic** --
"reuse existing entity-resolution infrastructure wherever practical" is
implemented literally: this tier only *consumes* `GroupingResult`, it does
not recompute name-variant logic. Concretely: if "Andrew Jackson" was
decided Redact in V1, and V2's own grouping (independently, deterministically)
groups "Andy Jackson" with "Andrew Jackson" the same way it always would,
"Andy Jackson" reuses the Redact decision too -- genuinely "review once,
apply everywhere" *within one entity*, not just across document versions.
**Ambiguity guard:** if a group's Tier-1-matched siblings disagree with each
other (different decisions or replacement text), this tier finds no match
at all for the remaining members -- silently picking one of two conflicting
prior decisions would violate "leave ambiguous entities unresolved."

**Tier 3 -- `similarity-threshold` (confidence = ratio × 100).** For a
candidate still unmatched, compares its own normalized text against every
same-detected-type imported candidate's normalized text using
`sequenceRatio()` -- the exact Ratcliff/Obershelp port
`entity_resolution.py`'s own member-scoring already uses
(`src/engines/entity-resolution/sequence-ratio.ts`), not a new or different
algorithm. **Threshold: 0.90.** Deliberately conservative, well above the
~0.8 a typical "did you mean" fuzzy-match UX would use: misapplying a
Redact/Keep decision to the wrong real-world entity is a materially worse
failure than an unhelpful suggestion, so this tier is tuned to fail closed
(leave the candidate unresolved for manual review) rather than fail open.
**Margin: 0.05.** The best match must beat the runner-up by at least this
much among same-type candidates, or the match is dropped as ambiguous --
guards against two comparably-good near-misses (e.g. a typo'd "Jon Reyes"
almost equally close to a prior "John Reyes" and a prior "Jonathan Reyes")
being resolved arbitrarily. **Type-scoped**: a phone number is never
fuzzy-compared against a person's name, even if the normalized text happened
to coincide.

Candidates with no match at any tier are left exactly as before: no
`CandidateDecision`, fully reviewable, indistinguishable from a document
that was never reviewed at all for that entity.

## What gets imported, and from where

Andrew's instruction says "support importing a previously generated
decisions JSON file" -- this is not a new file format. It is exactly
`AuditExporter.ts`'s existing `decisionsJson` export (the same file the
"Download Decisions (JSON)" button already produces), read back in by the
new inverse parser `src/io/DecisionImport.ts`
(`deserializeImportedDecisions()`). Reusing an artifact this application
already produces -- rather than inventing a second, parallel export format
-- means there is exactly one way review decisions leave this application in
writing, and exactly one way they come back in. The parser never throws
(same `{ok, reason}` convention as every other deserializer in this
codebase) and is not documentId-gated: unlike `WorkspaceSaveFile`'s restore
path (which *rejects* a documentId mismatch, because resuming session state
against the wrong document would corrupt candidateId correspondence),
importing across a *different* documentId is the entire premise of this
feature, not an error case.

## The never-overwrite rule

Every other command in `session.ts` intentionally overwrites an existing
decision (Rename supersedes Keep, Flatten overwrites a prior manual Redact,
etc. -- "whichever decision was dispatched most recently... simply IS its
current decision"). `applyDecisionReuse` is the one exception: it **never**
overwrites a candidate that already has *any* decision, reviewer- or
import-sourced. Every other bulk command in this codebase is a direct,
deliberate reviewer action explicitly requesting an overwrite; an import is
passive and automatic by comparison, and Andrew's instruction is explicit
that "the reviewer should never lose control." Import fills gaps in
undecided candidates; it does not contest existing state, even a state an
earlier import pass itself produced.

## Explainability

`CandidateDecision` gained two additive, optional fields:
`source?: "reviewer" | "imported"` and `importEvidence?: DecisionReuseEvidence`
(`src/domain/ReviewSession.ts`; `src/domain/DecisionReuse.ts`).
`DecisionReuseEvidence` answers "why was this reused?" directly: which tier,
the matched prior candidateId, a 0-100 confidence, a human-readable
description, and tier-specific detail (the entity group for `grouped-alias`,
the raw ratio for `similarity-threshold`) -- already structured richly
enough for a future `ExplanationEngine` to consume without a schema change,
per Andrew's explicit "without implementing the full explanation UI" scope
note. The description string is surfaced today as a plain hover tooltip on
the "(Imported)" tag in Item Check/Ambiguity Check -- the minimal
"why" surfacing the instruction asked for, nothing more.

An override is a fresh `CandidateDecision` object with no `importEvidence`
of its own (the whole object is replaced, per the never-overwrite section
above's mirror image -- decideCandidate() always builds a brand-new record).
That means the *current* snapshot alone cannot answer "was this ever
imported, even if it's since been overridden?" -- which is exactly what
`AuditRecord.ts`'s `wasImported` field is for (see below), derived from the
durable, append-only event log rather than the current decision.

## Audit: the three-way distinction

`AuditedCandidate` (`src/domain/AuditRecord.ts`) gained `source`,
`wasImported`, and `importEvidence`. `wasEverImported()`
(`src/io/AuditExporter.ts`) walks `session.events` for any
`"candidate-decided"` event carrying `source: "imported"` for that
candidateId -- deliberately structured as a close sibling of Feature 001's
own `wentThroughNotQuite()` (same technique: an override replaces the
current snapshot, so only the append-only event log can answer a question
about history). Combined, the three categories Andrew's instruction asked
for read unambiguously:

| | `source` | `wasImported` | `importEvidence` |
|---|---|---|---|
| Ordinary reviewer decision | `"reviewer"` | `false` | absent |
| Untouched import | `"imported"` | `true` | present |
| Reviewer override of an import | `"reviewer"` | `true` | absent |

The re-exported `decisions.json` (`toDecisionsJson()`) deliberately does
**not** carry `source`/`wasImported`/`importEvidence` forward -- it stays
exactly as minimal as it always was. An imported-then-re-exported decision
looks like an ordinary decision to whatever reviews *that* export next,
which is a deliberate scope boundary (see below), not an oversight.

## Save/resume, no separate persistence path

`source`/`importEvidence` are ordinary fields on `CandidateDecision`, which
already round-trips through `WorkspaceSaveFile`/`serializeReviewSession()`
unchanged -- no new save-file schema, no new migration step. An imported
decision, and a reviewer's later override of it, both survive save/reload
exactly like any other decision, because they *are* just decisions.

## Verification

`verify/decision-reuse-verification.ts`, 117 checks, two parts:

**Part 1 (engine-level, 26 checks):** `DeterministicDecisionReuseEngine.
proposeReuse()` called directly against a real fixture's detection/grouping
(loaded via the same `DocumentParser -> DetectionEngine ->
CandidateQualityEngine -> EntityResolutionEngine` pipeline
`review-engine-verification.ts` already established as an accepted pattern
for exercising engines directly rather than only through Workspace). This is
what makes it possible to hit exact tier boundaries deterministically: a
single-character-drop perturbation of a real candidate key computed against
the real `sequenceRatio()`, checked against the actual 0.90/0.05 constants,
rather than hoping a fixture happens to contain a natural near-miss.
Covers: Tier 1 exact match; Tier 2 agreement and Tier 2 conflict
(hand-built 3-member group using real candidateIds, to engineer a
disagreement the real fixture's own groups don't naturally contain); Tier 3
above-threshold match, below-threshold non-match, cross-type non-match, and
an ambiguous within-margin tie; Undecided-only and empty imports.

**Part 2 (integration, 91 checks):** the full `ReviewWorkspace` +
`WorkspaceCommandDispatcher` stack, via `document.importDecisions` with real
`File` objects built from a REAL `decisionsJson` (produced by fully
reviewing a "V1" session of `entity-resolution-001` through the production
pipeline, then `generateAudit()` -- not hand-crafted). Covers: identical-
document reuse (every decided candidate reused, all Tier 1, review complete
immediately with zero further manual action); reviewer override of an
imported decision; the never-overwrite rule (a pre-existing manual decision
survives a conflicting import untouched); malformed/wrong-schema-version
import files rejected cleanly; import attempted with no document loaded;
an import with zero real matches succeeding harmlessly; save/reload
equivalence (including the override); the audit's three-way distinction;
and output generation from an entirely import-derived session (Feature
001's own "`DocumentRebuilder` only reads `candidateDecisions`" correctness
finding, now exercised for imported decisions specifically).

Full regression battery re-run after this feature: all 10 property/behavior
suites and all 4 domain-parity fixture suites (50 fixtures) remain green,
zero regressions.

## Browser validation

Real browser validation via `claude-in-chrome` against Andrew's own
`npm run serve` (`http://localhost:8000/index.html`): built a real V1
decisions.json in-page (via dynamic `import()` of the actual compiled
`dist/workspace/*.js`, exercising the real production code, not a
reimplementation), loaded a fresh copy of the same fixture into the real
running UI, imported the V1 decisions.json through the real "Import prior
decisions" file input, and confirmed: every reused candidate shows the
`(Imported)` suffix with a working hover tooltip; the non-modal import
summary banner reports correct tier counts; clicking an ordinary decision
button on an imported candidate correctly overrides it (tag disappears,
every other row unaffected); Generate Output succeeds with **Verification:
PASSED**; Generate Audit Record succeeds; zero console errors throughout the
entire load -> import -> override -> generate-output -> generate-audit
sequence.

**One real UX defect found and fixed during this validation, not before:**
the first implementation called `window.alert()` with a decision-reuse
summary on a *successful* import. A native `alert()` blocks the page's own
JS thread until a human dismisses it -- confirmed directly: a scripted
`get_page_text`/`navigate` call against the tab hung until the dialog was
dismissed. Every other alert in `app.ts` fires on *failure* only
(`handleLoadFile`, `handleGenerateAudit`, etc.); this was the first one to
also fire on success, which is both inconsistent with that established
convention and a real interruption Andrew's own "without overwhelming the
interface" instruction argues against for routine, expected outcomes.
**Fixed** by removing the success alert entirely and replacing it with a
small non-modal summary line (`renderImportSummaryBanner`) rendered inline,
alongside the `(Imported)` tags that were always the primary success signal.
The failure alert (`Failed to import decisions: ...`) is unchanged, matching
every other handler's convention.

## Intentional limitations (scope, not gaps)

- **No group-level decision replay.** Only individual `CandidateDecision`s
  are reused; an imported `EntityGroupDecision` (Confirmed/Rejected/Refined)
  is never replayed onto the current document's analogous group. Andrew's
  instruction is candidate/entity-centric ("for each detected entity...
  reuse the prior decision"), and `DocumentRebuilder` only ever reads
  `candidateDecisions` -- so candidate-level reuse is both the literal scope
  and the part that actually affects output. In practice this is invisible
  to the reviewer: once every member of a group has an individual reused
  decision (via Tier 1 directly, or Tier 2 through a matched sibling), the
  group reads as resolved through the exact same coverage rule Feature 001's
  Reject Group already relies on -- no special-casing was needed to make
  Group Check "just work" after an import.
- **Decisions.json re-export does not carry provenance forward.** An
  imported-then-later-re-exported decision looks like an ordinary decision
  to whatever reviews that later export -- a deliberate choice to keep the
  portable exchange format minimal rather than accumulate an unbounded
  provenance chain across repeated review generations.
- **No preview/confirm step before import applies.** Reused decisions
  appear immediately, exactly as if a very fast reviewer had just made them
  -- consistent with "every reused decision must remain visible,
  explainable, and overridable" (nothing is hidden or finalized any
  differently than an ordinary decision), and with this application's
  existing preference for immediate, reversible actions over modal
  confirmation dialogs.
