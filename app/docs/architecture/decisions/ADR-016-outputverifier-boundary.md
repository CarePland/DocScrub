# ADR-016: OutputVerifier as the boundary between DocumentRebuilder and AuditExporter

Status: accepted, new in v0.2 (register priority: Recommended — NEW)
Date: 2026-07-27 (v0.2 register)

> Retroactive record, extracted 2026-07-30 from the v0.2 target
> architecture's ADR register (§16) and the Architecture Review Board
> report, per the documentation initiative (Phase 2). The decision itself
> was made 2026-07-27 (v0.2) unless noted; this file records it, it did
> not create it.

## Context
v0.1 had AuditExporter consuming "verification results" that
DocumentRebuilder produced, with no stated boundary — hidden coupling
between two components §10 claimed were separate (ARB §4.4).

## Decision
A dedicated OutputVerifier rescans the generated DOCX and produces a
VerificationReport value object; AuditExporter consumes the report, never
rebuilder internals. Verify, don't just trust: generation and verification
are different acts with different owners.

## Alternatives
Rebuilder self-reporting success — rejected; the component that made the
change grading its own work is the coupling and the credibility problem in
one.

## Consequences
The verification verdict is a first-class, explainable artifact (fidelity
findings, not a bare boolean — the Feature 001 silent-FAILED fix enforced
this); staleness derivation (see
`../../product/invariants.md#verification-staleness-is-derived`) hangs off
this seam.

## Current status (2026-07-30)
[BUILT] — `OoxmlOutputVerifier` (Phase 3), consumed by AuditExporter
(Phase 11).

## Sources
ARB report §4.4; v0.2 §6.14, §10;
`../../detection/feature-001-group-bulk-actions.md`.
