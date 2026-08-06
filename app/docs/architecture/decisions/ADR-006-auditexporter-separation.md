# ADR-006: AuditExporter separation

Status: accepted (register priority: Recommended)
Date: 2026-07-27 (v0.2 register)

> Retroactive record, extracted 2026-07-30 from the v0.2 target
> architecture's ADR register (§16) and the Architecture Review Board
> report, per the documentation initiative (Phase 2). The decision itself
> was made 2026-07-27 (v0.2) unless noted; this file records it, it did
> not create it.

## Context
Audit artifacts (CSV, decisions JSON, QA metrics, audit report) are a
distinct obligation from producing the redacted document, with different
correctness and privacy properties.

## Decision
AuditExporter is a separate module consuming ReviewSession,
candidate/evidence data, processing metadata, and a VerificationReport —
never DocumentRebuilder internals (v0.2 §6.15, §10).

## Alternatives
Folding export into output generation — rejected; the ARB flagged the
undefined v0.1 dependency between the two, resolved by ADR-016's seam.

## Consequences
All projections derive from one canonical AuditRecord schema; the
`audit-excludes-candidate-text` invariant is enforced at this single point.
Export is available regardless of review completeness (deliberate,
Phase 11).

## Current status (2026-07-30)
[BUILT] — `DeterministicAuditExporter` (Phase 11), Gate D closed.

## Sources
v0.2 §6.15, §10; `../../detection/phase-11-findings.md`.
