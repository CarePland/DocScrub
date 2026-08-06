# Documentation Standards

Status: canonical
Last updated: 2026-07-30

How to read this document: these are the rules the DocScrub documentation
set operates under — document classes, required headers, status markers,
lifecycle rules, templates, and what counts as documentation debt. It was
established by the documentation initiative
(`20260730-documentation-initiative-plan.md`, repository root) and codifies
conventions the repository had already converged on, rather than inventing
new ones. The behavioral companion is
`../architecture/implementation-philosophy.md`, a standing requirement that
governs how implementation work itself is documented; nothing here
overrides it.

---

## Document classes

Every document in the set belongs to exactly one class.

**Canonical (living).** Describes current truth. Lives under `app/docs/`.
Updated in the same change as the behavior it describes. Obsolete content
is deleted, not preserved as narrative — history belongs in class 2. A
canonical document that has drifted from the code is a defect, the same
category as a failing verification suite.

**Historical (immutable).** Findings documents, gate records, closed
spikes, superseded specifications, the original `.docx` architecture and
review artifacts. Never rewritten. May receive only a dated amendment
(the pattern Feature 001's same-day amendment note established) or a
supersession/status banner. Historical documents answer "what happened
and why did we decide that" — their value depends on not being cleaned up.

**Working (session-scoped).** Implementation plans, reviews, and findings
produced during active work, currently living at the repository root.
A working document's lifecycle ends in one of two ways: its durable
conclusions are promoted into a canonical or historical document and it
is marked retired, or it is superseded and marked so. Working documents
are never citable as authority by canonical documents.

## Required headers

**Canonical documents** open with:

```
Status: canonical
Last updated: YYYY-MM-DD
```

plus a short "How to read this document" section where the document's
structure or evidence conventions need explaining. When a canonical
document is superseded, its `Status` line changes to
`Status: historical — superseded by <path>` and the content is left as it
stood.

**Historical documents** identify themselves as historical (a
`**Class: historical ...**` banner directly under the title) and carry a
`Superseded by` pointer when a successor exists. Documents written before
this standard are bannered as their status becomes materially ambiguous —
there is no requirement to mass-edit the archive.

**Working documents** identify themselves as working (a
`**Class: working ...**` banner) and state that they are not authoritative.
Retired working documents say `Class: working — retired (date)` and name
the document that carries their record forward.

## Status markers

The claim-level convention `../architecture/review-workspace-specification.md`
established applies set-wide:

- `[BUILT]` — implemented and confirmed in the current codebase,
  verification suites, and/or real-browser validation records.
- `[DESIGNED]` — explicitly specified, decided, or committed to, but not
  yet implemented. Design intent, not speculation.
- `[SPECULATIVE]` — proposed or implied by adjacent decisions, never
  explicitly committed to.

Use these markers when a document mixes claims at different implementation
maturity — a product overview describing built behavior alongside planned
capability, an invariant that is partially enforced. Do not decorate every
sentence: a document that is uniformly historical, or uniformly describes
built behavior, needs no markers, and a findings document's own
verified-vs-pending sections already carry this information in their
structure.

## Lifecycle rules

1. Canonical documentation changes in the same change as the behavior it
   describes (already standing, via `../architecture/implementation-philosophy.md`).
2. Obsolete canonical content is removed, not preserved as narrative.
3. Historical records are not rewritten.
4. Historical records may receive only a dated amendment or a
   supersession/status banner.
5. Durable conclusions from a working document must be promoted before
   the working document is retired.
6. Canonical documents must not cite working documents as authority.
7. Findings documents remain append-only.
8. Significant new decisions receive an ADR at decision time, numbered
   continuing from the register at `../architecture/decisions/index.md`
   (ADR-001..018, extracted 2026-07-30 from the v0.2 architecture's own
   register and the ARB report). Never renumber existing ADRs.
9. Repository-wide absence claims require repository-wide verification.
   A search limited to a subtree supports only a subtree-limited claim.
   (This rule exists because of a real defect: see the dated correction
   in `../architecture/review-workspace-specification.md`'s sources note.)

## Templates

Practical minimums, modeled on the repository's strongest existing
documents. Sections may be omitted when genuinely empty; none may be
faked.

**Canonical document**

```
# <Title>
Status: canonical
Last updated: YYYY-MM-DD
How to read this document: <one short paragraph; marker legend if used>

<content — intent before implementation; explicit boundaries;
[BUILT]/[DESIGNED]/[SPECULATIVE] where maturity is mixed>
```

**ADR** (`architecture/decisions/ADR-NNN-<slug>.md`, once Phase 2 creates
the directory)

```
# ADR-NNN: <Decision>
Status: accepted | superseded by ADR-MMM
Date: YYYY-MM-DD

## Context      <the problem and the forces on it>
## Decision     <what was decided, stated plainly>
## Alternatives <each with the reason it was rejected>
## Consequences <tradeoffs accepted, follow-on obligations>
## Sources      <findings doc / review-report citation, for retroactive ADRs>
```

**Larger-feature specification** (pre-implementation; small features go
straight to a findings doc as today)

```
# Feature NNN: <Name>
## Intent               <the reviewer problem this solves>
## Behavior             <what the reviewer experiences>
## Explicit boundaries  <what this feature is not>
## Invariants touched   <names from product/invariants.md>
## Open questions       <for Andrew, before or during implementation>
## Later connections    <what this enables but does not build>
```

**Findings / implementation report** (the structure
`docs/detection/*-findings.md` already converged on, made explicit)

```
# <Phase/Milestone/Feature/Revision>: <Name> — Findings
## What was asked
## Design decisions and judgment calls
   <each: assumption, reasoning, alternatives, reviewer impact>
## Oracle deviations           <classified A–E; "none" is a valid entry>
## Verification results        <suites, counts, zero-regression statement>
## Browser validation          <the record, or its honest absence with reason>
## Defects found and fixed     <found while validating, not designed around>
## Open questions
```

**Invariant entry** (see `../product/invariants.md` for live examples)

```
### <kebab-case-name>  [BUILT | DESIGNED]
<behavioral definition — one paragraph>
Why: <the failure this prevents>
Consequences: <what implementers must and must not do>
Verified by: <suite / spec section / code boundary>
Changing it: <what an intentional change requires>
```

## Documentation debt

Documentation debt is any gap between what the documentation set claims
and what the repository is. It is tracked informally — noticing it in a
findings doc or fixing it in passing is enough; no register, no process.
The recognized forms:

- behavior changed without the canonical document changing in the same
  pass;
- obsolete terminology remaining in a canonical document (display labels
  are defined by `src/ui/decisionLabels.ts` and the glossary, nowhere
  else);
- a historical document whose supersession is real but unbannered;
- a working document whose conclusions were never promoted before it went
  stale;
- a canonical claim with no traceable evidence (no citation, no suite, no
  code boundary) that isn't marked `[SPECULATIVE]`;
- a path, count, or existence claim that has gone stale (running totals
  in prose are the known repeat offender — prefer pointing at the thing
  over restating it).

When debt is found mid-task: fix it if the fix is small and safe; record
it in the pass's findings document if it isn't. Never silently work around
it.
