# ADR-013: EntityResolutionEngine / OccurrenceClassifier separation

Status: accepted, new in v0.2 (register priority: Required — NEW)
Date: 2026-07-27 (v0.2 register)

> Retroactive record, extracted 2026-07-30 from the v0.2 target
> architecture's ADR register (§16) and the Architecture Review Board
> report, per the documentation initiative (Phase 2). The decision itself
> was made 2026-07-27 (v0.2) unless noted; this file records it, it did
> not create it.

## Context
The ARB's R2: v0.1's single GroupingEngine conflated identity resolution
(stateful, reviewer-decided, audit-bearing) with occurrence structural
classification (pure, deterministic, display-only) — two natures, two test
obligations, one module.

## Decision
Split: EntityResolutionEngine proposes Ambiguity/Group Check items and is
tested with reviewer-decision fixtures; OccurrenceClassifier is a pure
function classifying occurrence structure for display/navigation, sitting
beside DocumentModel, never producing reviewable proposals. Reviewer-facing
stage names ("Group Check") are untouched.

## Alternatives
Keeping one GroupingEngine — rejected: a change aimed at one half can
silently affect the other, and one suite must then cover both natures.

## Consequences
The parity-critical classification core and the audit-bearing resolution
logic evolve and verify independently; the ambiguity anchor correction
landed entirely in resolution with zero classifier involvement — the split
doing its job.

## Current status (2026-07-30)
[BUILT] — `src/engines/entity-resolution/` (Phase 6),
`src/engines/occurrence-classifier/` (Phase 7).

## Sources
ARB report R2, §4.9; v0.2 §6.6–6.7; Phase 6/7 findings;
`../../detection/ambiguity-anchor-correction.md`.
