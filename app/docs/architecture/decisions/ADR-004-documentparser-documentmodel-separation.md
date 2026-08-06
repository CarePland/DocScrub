# ADR-004: DocumentParser and DocumentModel separation

Status: accepted (register priority: Recommended)
Date: 2026-07-27 (v0.2 register)

> Retroactive record, extracted 2026-07-30 from the v0.2 target
> architecture's ADR register (§16) and the Architecture Review Board
> report, per the documentation initiative (Phase 2). The decision itself
> was made 2026-07-27 (v0.2) unless noted; this file records it, it did
> not create it.

## Context
OOXML specifics must not leak into detection, review, or output logic.

## Decision
DocumentParser is the format boundary: it unpacks OOXML and produces a
format-neutral DocumentModel (ordered blocks, runs, stable occurrence
locations, source relationships, identity hash, feature warnings). Every
downstream component consumes DocumentModel, never raw OOXML.

## Alternatives
Letting engines read OOXML directly — couples every engine to the format;
rejected. Adopting a third-party OOXML library — made moot by the spike:
CompressionStream/DecompressionStream covered the need with no dependency.

## Consequences
The one boundary placed where future format extensibility would need it,
without building that future now (ARB §2). Fidelity risk concentrates in
parser/rebuilder and was de-risked by the early spike.

## Current status (2026-07-30)
[BUILT] — `src/io/OoxmlDocumentParser`, `src/domain/DocumentModel.ts`
(Phase 3).

## Sources
v0.2 §6.1–6.2; ARB report §2; ooxml-spike docs; Phase 3 record in
`../../ooxml-spike/phase-2-findings.md`.
