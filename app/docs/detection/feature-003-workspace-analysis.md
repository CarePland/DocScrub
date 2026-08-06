# Feature 003: Workspace Analysis

Third feature built after the migration was declared complete (Gates
A-E, `phase-12-findings.md`), following Feature 001
(`feature-001-group-bulk-actions.md`) and Feature 002
(`feature-002-decision-reuse.md`). Like both, this is product evolution
with no Python oracle -- verified as a deterministic property/behavior
suite, not diffed against `redactor/*.py`. Architecturally distinct from
both prior features: `ADR-019-workspace-analysis-independence.md`
records the decision to build it as a self-contained subsystem rather
than extend the existing review pipeline.

## Design rationale

Andrew's prompt asked for two things at once: a capability ("analyze a
collection of imported documents and determine how strongly they relate
to each other") and a constraint on how to build it (developed
concurrently with other active review-pipeline work, minimal overlap
with Ambiguity/Group/Item Check and Triage, no refactor of existing
architecture). The constraint drove the architecture at least as much as
the capability did -- see ADR-019 for the full reasoning, including the
three alternatives considered and rejected.

The purpose is deliberately narrow: "which documents belong to the same
semantic world," never PII, entity, redaction, or decision-propagation
questions -- those remain entirely the review pipeline's job. Evidence
must be deterministic and specific (shared identifiers, organizations,
email domains, acronyms, distinctive terms), explicitly *not*
generic-vocabulary or formatting-driven, because a false cross-document
relationship is worse than a missed one. Every architectural decision
below traces back to those two sentences.

## Where the code lives

```
src/workspace-analysis/
  domain/WorkspaceAnalysisModel.ts       -- the vocabulary
  engine/fingerprint.ts                  -- text -> DocumentFingerprint
  engine/scoring.ts                      -- pairwise evidence + score
  engine/clustering.ts                   -- clique-based grouping
  engine/WorkspaceAnalysisEngine.ts      -- analyzeWorkspace() entry point
  io/extractText.ts                      -- File -> InputDocument (async)
  state/WorkspaceAnalysisCommands.ts     -- accept/split/merge/reset
  state/WorkspaceAnalysisSession.ts      -- the state container
  ui/dom.ts                              -- local el()/button() helpers
  ui/renderWorkspaceAnalysisPage.ts      -- the standalone page
verify/workspace-analysis-verification.ts
```

Zero files under `src/domain/`, `src/engines/`, `src/workspace/`, or
`src/ui/` were modified except `src/ui/app.ts`, which gained exactly the
one entry point described below. No existing type, reducer, command
family, or verification suite was touched.

## The engine: fingerprint -> score -> cluster

**`fingerprint.ts`** extracts eight purpose-built features per document
from its flattened plain text: `distinctiveTerms` (capitalized
multi-word phrases, generic-opener-filtered), `organizations`
(capitalized phrases ending in a small Inc/LLC/Corp-style suffix list),
`emailDomains` (excluding a public-provider stoplist), `identifiers`
(matter/case/docket-number patterns and generic alphanumeric codes),
`acronyms` (repeated all-caps tokens, ultra-common ones excluded),
`termFrequency` (stopword-filtered word counts, the vocabulary-overlap
input), `filenameTokens`, and `structureSignature` (a coarse paragraph-
count/length bucket). Every heuristic was written fresh for this
subsystem -- none of it imports from `src/engines/DetectionEngine.ts` or
`src/engines/quality/`'s dictionaries, even though a few heuristics
(identifiers, organizations) resemble detection patterns on the surface.
That resemblance is coincidental (both domains look for similar English
business-document patterns); reusing the actual detection code would
have been exactly the semantic dependency the independence requirement
forbids.

**`scoring.ts`** computes each document pair's relationship as an
additive, per-category-**capped** score in [0, 1]. The cap matters more
than the per-item weight: no single evidence category can push a pair
over the threshold on its own if that category is capped low enough.
Concretely, `vocabulary-overlap` (cosine similarity over term frequency)
and `structure-similarity` (matching paragraph/length bucket) -- the two
signals easiest to trigger by pure coincidence -- are capped at 0.15 and
0.05 respectively; even combined with `filename-similarity`'s 0.15 cap,
three generic signals together (0.35) still fall short of
`MINIMUM_RELATIONSHIP_THRESHOLD = 0.45`. Crossing the threshold requires
at least one specific signal: a shared identifier (cap 0.5), organization
(0.35), or email domain (0.3), or enough distinctive terms/acronyms to
add up. This is the concrete mechanism behind "generic-word/formatting-
driven false similarity" staying impossible by construction, not by
tuning luck -- `verify/workspace-analysis-verification.ts` asserts the
worked combination directly (two documents sharing only generic
vocabulary and structure score well under threshold, regardless of how
much filler text is added).

**`clustering.ts`** groups documents by **clique**, not connected
components: every member of a proposed cluster must independently
satisfy the threshold with every *other* member, not merely be
transitively reachable through a "bridge" document. This is the direct
implementation of "false relationships are worse than missed
opportunities" -- a generic cover letter that happens to relate weakly
to two otherwise-unrelated matters can belong to two separate clusters,
but can never drag those two matters into the same cluster as each
other. Cliques are found via Bron-Kerbosch (no pivoting, sorted
candidates at every step, for deterministic enumeration), then assigned
to non-overlapping groupings by a deterministic priority order (larger
cliques first, then stronger, then a lexicographic tie-break) --
partitioning rather than allowing overlap keeps each document's "current
grouping" unambiguous for the UI's accept/split/merge actions. A
document left over after a higher-priority clique claims its
higher-priority members can still form its own smaller grouping later in
the same pass, since every subset of a clique remains a valid clique.

**`WorkspaceAnalysisEngine.ts`** ties the three together as
`analyzeWorkspace(documents) -> WorkspaceAnalysisResult`, sorting input
by `documentId` first so output never depends on caller-supplied array
order -- confirmed directly in verification (identical documents, two
different input orders, byte-identical `JSON.stringify` output).

## The independence boundary, enforced structurally

`analyzeWorkspace()`'s only parameter is
`WorkspaceAnalysisInputDocument[]` -- there is no `ReviewSession`,
`ReviewWorkspace`, or decision-state parameter to pass even if a caller
wanted to. Beyond that type-level guarantee,
`verify/workspace-analysis-verification.ts` greps every import
specifier across every file in `src/workspace-analysis/` and asserts
each one either resolves inside the subsystem or is on a four-item
allowlist (`sha256Hex`, and three OOXML parsing functions), consumed
only by `io/extractText.ts`. A second, belt-and-suspenders check scans
those same import specifiers (not doc-comment prose, which legitimately
explains what *isn't* imported and why) for any mention of
`src/domain/`, `src/engines/`, `src/workspace/`, `src/ui/`, or
`DocumentParser`. Both checks pass today; either failing would mean the
independence guarantee had been silently broken by a later change --
the same "the pattern must not exist in the file" technique
`verify/ui-smoke.ts` already uses for RX-09/RX-22.

## State container: accept, split, merge -- no override

`WorkspaceAnalysisSession` starts every document in exactly one
grouping (one per proposed cluster, one singleton per unrelated
document) and exposes three mutating commands plus `reset`:

- **`accept-grouping`** -- confirms a proposed grouping as-is; changes
  only its display status, not its membership.
- **`split-grouping`** -- requires `newGroups` to be an exact partition
  of the target grouping's current members (nothing added, nothing
  dropped); rejected otherwise. Never needs a threshold check, since
  every subset of an already-valid grouping remains internally valid.
- **`merge-groupings`** -- combines exactly two groupings, gated by
  `clustering.ts`'s `canMerge()`: refused unless the combined membership
  independently forms a valid clique. **There is no "combine anyway"
  override anywhere in the state container or UI** -- confirmed directly
  in verification (`stateSession.dispatch({type: "merge-groupings", ...})`
  against the unrelated invoice fails with an explicit reason, and a
  structural check confirms the UI module contains neither "force" nor
  "override" language).

Persistence is deliberately **not** implemented this phase -- see
"Intentional limitations" below.

## Graceful degradation

Zero documents, one document, and documents with no confident
relationships at all are not error cases: `analyzeWorkspace([])` returns
an empty result; a single document is treated as its own unrelated
document; two completely unrelated documents both land in
`unrelatedDocumentIds` with zero clusters. A thrown engine error (tested
via a stub `WorkspaceAnalysisEngine` that always throws) is caught
inside `WorkspaceAnalysisSession.loadFiles()` and turned into
`{ok: false, reason}` plus `status: "error"`, never propagated as an
uncaught exception, and leaves `documents`/`result` empty rather than
partially populated. A single unreadable imported file degrades the
same way at the extraction layer: `io/extractText.ts` falls back to
best-effort plain-text decoding of the raw bytes rather than aborting
the whole batch, so one bad file can't block analysis of the rest.

## UI: the one narrow entry point into app.ts

The standalone page (`ui/renderWorkspaceAnalysisPage.ts`) renders
entirely from `WorkspaceAnalysisSession`'s own state: an import control,
a summary line, one card per proposed grouping (member filenames,
confidence percentage, evidence descriptions, Accept/Split/Merge
controls), and a separate "Documents that appear unrelated" list. It
imports nothing from `app.ts`, `src/domain/`, `src/engines/`, or
`src/workspace/` -- including its own tiny local `el()`/`button()` DOM
helpers (`ui/dom.ts`) rather than `app.ts`'s equivalents, since the
integration direction is one-way (app.ts calls into workspace-analysis,
never the reverse).

`app.ts` itself gained, in total: one import of
`WorkspaceAnalysisSession` and `renderWorkspaceAnalysisPage`; one
module-level singleton (`workspaceAnalysisSession`, constructed with no
reference to the existing `workspace`/`dispatcher`); one UI-only
navigation flag (`showingWorkspaceAnalysis`, same shape as the existing
`showingLanding`); one button on the landing/default page ("Workspace
Analysis," visible only when `!state.documentLoaded || showingLanding`
-- matching the spec's "precedes all review stages" placement); and one
early-return branch in `render()`, checked before any
`documentLoaded`-dependent logic, that renders a "Back" button plus a
single call to `renderWorkspaceAnalysisPage()`. This was added last, per
Andrew's explicit instruction, only after the subsystem's engine, model,
state, UI, and verification suite were independently complete and green.

## Verification

`verify/workspace-analysis-verification.ts`, 37 checks, covering all 8
properties from Andrew's spec explicitly:

1. **Runs without creating a review session** / **8. no dependency on
   reviewer decisions or learned knowledge** -- proven structurally (the
   import audit above), not just behaviorally, plus a type-level check
   that `analyzeWorkspace()` accepts no session/decision parameter.
2. **Runs without invoking Ambiguity/Group/Item Check** -- same
   structural import audit; none of those modules are ever imported.
3. **Stable, deterministic results** -- identical documents in two
   different input orders, and two runs on the same input, produce
   byte-identical `JSON.stringify` output.
4. **Separates unrelated documents** -- a synthetic unrelated invoice
   lands in `unrelatedDocumentIds`, never in the Smith-matter cluster; a
   generic-vocabulary-only document also fails to cluster, with the
   scoring-level check confirming *why* (score stays under threshold).
5. **Clusters clearly related documents** -- two synthetic documents
   sharing a matter number, an organization, and an email domain are
   proposed as one cluster, with `shared-identifier` evidence, at or
   above the threshold.
6. **Refuses unsupported merges** -- both at the pure `canMerge()` level
   and at the `WorkspaceAnalysisSession` level (an actual
   `merge-groupings` dispatch against the unrelated invoice fails with
   an explicit reason).
7. **Can fail / return no clusters without breaking anything** -- empty
   input, single-document input, all-unrelated input, and a simulated
   engine throw are all covered without an uncaught exception.
8. Covered under (1) above.

Plus state-container coverage (accept/split/merge/reset, including a
rejected invalid split and a successful re-merge after a split) and UI
structural checks (`window.alert(` absent, `renderWorkspaceAnalysisPage`
exported, no "force"/"override" language, `.wsa-page` CSS present in
`index.html`).

Full regression battery re-run after this feature: all 33 other
property/behavior/parity suites remain green (one of them,
`identity-cleanup-verification.ts`, gained checks of its own from
concurrent, unrelated work landing in the same session -- see
"Concurrent development" below), and `tsc`/`tsc --noEmit` are clean.
Zero regressions.

## Concurrent development: the constraint, tested in practice

This feature was built while Andrew was actively, separately editing
`src/ui/app.ts` and `src/workspace/Workspace.ts` for an unrelated
feature ("Probable Name with Inserted Word," `design-notes.md`
v2026-08-02.11) -- confirmed by catching a transient `tsc` error mid-way
through this session (a `RelationshipKind` `Record` briefly missing the
new `"inserted-word-name"` case, in files with timestamps seconds old)
that resolved itself once his edit completed. Because
`src/workspace-analysis/` shares zero files with that change, it was
unaffected throughout, and the one point of real contact -- adding the
entry point to `app.ts` -- was confirmed with Andrew directly before
touching a file he was actively hand-editing (he confirmed proceeding
was fine; the resulting diff was small and additive). This is the
concurrency requirement validated empirically, not just architecturally.

## Intentional limitations (scope, not gaps)

- **No persistence.** `WorkspaceAnalysisSession` holds documents, the
  analysis result, and grouping decisions only in memory; nothing
  survives a page reload. The spec allowed persisting the result and
  confirmed grouping structure "if needed" -- nothing downstream
  consumes either yet (no hand-off to the review pipeline exists), so
  building storage now would be speculative. Revisit if/when a future
  phase wires a confirmed workspace grouping into the review pipeline
  (see ADR-019's "Deferred, not decided against").
- **No knowledge propagation to the review pipeline.** A confirmed
  grouping today has no effect on Decision Reuse, entity resolution, or
  any other review-pipeline behavior. Explicitly out of scope per
  Andrew's instruction.
- **Merge combines exactly two groupings at a time.** Combining three
  requires two merge actions. Kept deliberately simple: each merge's
  validation and resulting audit trail ("grouping X and Y were merged
  because...") stays a single, easily-stated step.
- **Split offers a two-way partition via checkbox selection, not
  arbitrary N-way manual grouping.** A reviewer selects some members of
  a grouping and splits them into a new group versus the remainder;
  reaching a finer split takes repeated splits. This was judged
  sufficient for phase 1's UI without building a drag-and-drop or
  multi-group-builder interaction the spec didn't explicitly ask for.
- **`.docx` and best-effort plain text only.** `io/extractText.ts`
  parses OOXML text-bearing parts for `.docx` imports and falls back to
  raw UTF-8 decoding for anything else (including genuinely binary
  files, which will simply yield sparse/no extracted signal rather than
  a readable document) -- matching what DocScrub already imports
  elsewhere, not a new format commitment.
- **No real-browser click-through yet.** This session's verification is
  the structural/property suite above, run in Node; a live
  `npm run serve` click-through (load several real documents, confirm
  the proposed groupings, exercise accept/split/merge visually) is a
  recommended follow-up, consistent with this project's standing
  practice of disclosing when a live browser pass is pending rather than
  assuming it passed.
