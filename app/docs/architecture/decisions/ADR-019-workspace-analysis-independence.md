# ADR-019: Workspace Analysis as an independent subsystem

Status: accepted, new (register priority: n/a — not part of the v0.2 register; decided at implementation time per the documentation standards' lifecycle rule 8)
Date: 2026-08-02

## Context

Andrew asked for a new capability — analyze a collection of imported
documents and propose which ones belong to the same semantic world
("workspace"), before individual document review begins — with an
explicit constraint: it must be developed **concurrently** with other
active review-pipeline work, with minimal file/type/reducer/UI/test
overlap against Ambiguity Check, Group Check, Item Check, and Triage.
The concern is concrete, not hypothetical: this feature was built in the
same working session as an unrelated, actively-edited change to
`RelationshipKind`/`app.ts`/`Workspace.ts` (the "Probable Name with
Inserted Word" feature, `design-notes.md` v2026-08-02.11) — real
concurrent development on the same files this feature might otherwise
have touched.

A second constraint shapes the module boundary itself: the analysis must
answer "do these documents belong together," never anything about PII,
entities, or redaction decisions — a different question in kind from
everything else in `src/engines/`, not just a different feature.

## Decision

Workspace Analysis is a self-contained subsystem under
`src/workspace-analysis/`, with its own domain types
(`domain/WorkspaceAnalysisModel.ts`), its own pure engine
(`engine/fingerprint.ts`, `scoring.ts`, `clustering.ts`,
`WorkspaceAnalysisEngine.ts`), its own I/O adapter
(`io/extractText.ts`), its own state container
(`state/WorkspaceAnalysisSession.ts`, `WorkspaceAnalysisCommands.ts`),
its own UI (`ui/renderWorkspaceAnalysisPage.ts`, `ui/dom.ts`), and its
own verification suite (`verify/workspace-analysis-verification.ts`).
It imports nothing from `src/domain/`, `src/engines/`, `src/workspace/`,
or `src/ui/app.ts`. The one permitted crossing into shared code is a
fixed allowlist of genuinely generic, zero-semantic-dependency OOXML/
hashing primitives (`src/io/hash.ts`'s `sha256Hex`, and three OOXML
parsing functions from `src/io/ooxml/`) — pure file-format plumbing with
no review-domain coupling, consumed by `io/extractText.ts` only.
`app.ts` gains exactly one integration point: a `showingWorkspaceAnalysis`
UI-navigation flag and one call to `renderWorkspaceAnalysisPage()`,
added only after the subsystem's engine, model, state, UI, and
verification suite were independently complete and green (37/37 checks),
per Andrew's explicit sequencing instruction.

This independence is enforced structurally, not just by convention:
`verify/workspace-analysis-verification.ts` greps every import
specifier in `src/workspace-analysis/` and fails if anything escapes the
subsystem other than the fixed allowlist — the same "the pattern must
not exist in the file" technique `verify/ui-smoke.ts` already uses for
its RX-09/RX-22 checks.

## Alternatives

**Extend `EntityResolutionEngine`/`StructuralRelationshipEngine` with a
cross-document mode.** Rejected: both engines' entire design is built
around within-document candidate/entity semantics (`Candidate`,
`EntityGroupProposal`); bending them to also answer a document-level
question would either weaken their existing contracts or require
threading a new, unrelated concept through code whose job is already
well-defined. It would also directly violate the concurrency
requirement — any change to a shared engine is exactly the collision
surface Andrew asked to avoid.

**Route document-relatedness through the existing review pipeline
(detect → quality → resolve, then aggregate).** Rejected: the hard
requirement is that Workspace Analysis run with the review pipeline
absent entirely (verified property 1/2) — decision quality, candidate
detection, and entity resolution are irrelevant to "do these documents
share a matter," and depending on them would make analysis unavailable
exactly when a reviewer most wants it: before committing to reviewing
any of the documents individually.

**A single `WorkspaceState.workspaceAnalysis` field, reducer case, and
`workspace-analysis.*` command family bolted onto the existing
`CommandDispatcher`/`ReviewSession`.** Rejected: this is the shape every
other feature in this codebase uses, but it was explicitly ruled out
here — see Context. It would add a new command family to a dispatcher
whose exhaustiveness switches are actively being extended by concurrent
work, and a new field to `WorkspaceState`/`ReviewSession`'s
serialization surface that every other reducer, save-file version, and
audit exporter would need to at least be aware of, for a feature with no
actual dependency on any of that state.

## Consequences

**Gained:** a feature that can be built, tested, and demonstrated with
zero merge risk against concurrent review-pipeline work (confirmed
empirically this session — the subsystem's own `tsc`/verification suite
stayed green throughout a live, unrelated edit to `app.ts`/`Workspace.ts`
happening in parallel); a hard architectural guarantee, not just a
convention, that document-relatedness logic can never accidentally
depend on reviewer decisions, learned knowledge, or in-progress review
state; a clique-based (not connected-components) clustering algorithm
free to be exactly as conservative as the "false relationships are worse
than missed opportunities" principle demands, unconstrained by any
existing engine's contract.

**Accepted cost:** two small `el()`/`button()` DOM helpers duplicated
rather than imported from `app.ts` (`ui/dom.ts`'s own doc comment
explains why — the integration direction is one-way, app.ts →
workspace-analysis, so importing the reverse would create exactly the
coupling this ADR avoids); no shared vocabulary with
`StructuralRelationshipEngine`'s existing `RelationshipEvidenceKind`-
shaped card rendering, even though the two features render conceptually
similar "here's why these are related" cards — a deliberate accepted
duplication over a shared abstraction that would recouple the two
subsystems.

**Deferred, not decided against:** persistence of the analysis result
and confirmed grouping structure, and any hand-off of a confirmed
workspace grouping to the review pipeline (e.g. scoping future Decision
Reuse to same-workspace documents). Nothing today consumes either, so
building storage or a hand-off contract now would be speculative. See
`docs/detection/feature-003-workspace-analysis.md`'s "Intentional
limitations" section.

## Current status (2026-08-02)

[BUILT] — `src/workspace-analysis/`, wired into `src/ui/app.ts`'s
landing page via one entry point. 37/37 subsystem checks pass; full
existing regression battery (33 other suites, 4 fixture-parity suites)
and `tsc` remain green with zero regressions.

## Sources

`docs/detection/feature-003-workspace-analysis.md`; Andrew's own
concurrency requirement and full feature prompt (this session,
2026-08-02); `verify/workspace-analysis-verification.ts`'s structural
import audit.
