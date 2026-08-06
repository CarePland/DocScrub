# ADR-005: DocumentRebuilder as reconstruction boundary

Status: accepted (register priority: Recommended)
Date: 2026-07-27 (v0.2 register)

> Retroactive record, extracted 2026-07-30 from the v0.2 target
> architecture's ADR register (§16) and the Architecture Review Board
> report, per the documentation initiative (Phase 2). The decision itself
> was made 2026-07-27 (v0.2) unless noted; this file records it, it did
> not create it.

## Context
Applying decisions to OOXML (cross-run replacement, relationships,
headers/footers) is intricate and must not smear across the codebase; the
original file must never be modified.

## Decision
DocumentRebuilder alone builds the output: original DocumentModel +
completed ReviewSession + replacement plan → a newly generated DOCX. As of
v0.2 it no longer owns verification — its output is the generated DOCX,
nothing else (see ADR-016).

## Alternatives
Rebuild-plus-verify in one component — rejected by the ARB coupling
finding. In-place mutation — never on the table; the tool generates a new
file (also a trust/comms point, ARB §4.5).

## Consequences
Surgical cross-run replacement lives in one place (`src/io/ooxml/rebuild.ts`),
which is also where its hardest defect (the Feature 001 infinite loop) was
found and fixed once, for every caller.

## Current status (2026-07-30)
[BUILT] — `OoxmlDocumentRebuilder` (Phase 3), extended additively for
replacement rules (Milestone 3).

## Sources
v0.2 §6.13, §10; ARB report §4.4;
`../../detection/feature-001-group-bulk-actions.md`.
