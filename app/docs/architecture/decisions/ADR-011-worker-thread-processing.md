# ADR-011: Worker-thread processing

Status: open — deliberately undecided (register status: Open, gated on the OOXML spike)
Date: 2026-07-27 (v0.2 register)

> Retroactive record, extracted 2026-07-30 from the v0.2 target
> architecture's ADR register (§16) and the Architecture Review Board
> report, per the documentation initiative (Phase 2). The decision itself
> was made 2026-07-27 (v0.2) unless noted; this file records it, it did
> not create it.

## Context
Large documents might need processing off the main thread. v0.1's
conceptual interfaces quietly pre-decided this by making every pipeline
stage async — the ARB's R3 and its one direct self-contradiction finding.

## Decision
None yet, deliberately. v0.2 removed the implicit answer: pipeline engines
are synchronous and pure; async appears only at genuine I/O boundaries
(File reads, IndexedDB, Blob generation). Worker adoption waits for real
performance evidence.

## Alternatives
Async-everywhere now — rejected: materially harder to test, and it encodes
an answer to a question the register itself calls open.

## Consequences
Engines stay trivially testable as reducers; if workers are ever adopted,
the async shell wraps the same synchronous cores. Populating the
performance fixture family (ADR-009) is the natural trigger for revisiting.

## Current status (2026-07-30)
Still open and still honest: engines are synchronous; no worker exists.

## Sources
ARB report R3, §5; v0.2 §12, §16.
