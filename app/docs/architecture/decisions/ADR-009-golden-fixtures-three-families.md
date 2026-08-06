# ADR-009: Golden fixtures as migration specification, in three families

Status: accepted, revised in v0.2 (register priority: Required (revised))
Date: 2026-07-27 (v0.2 register)

> Retroactive record, extracted 2026-07-30 from the v0.2 target
> architecture's ADR register (§16) and the Architecture Review Board
> report, per the documentation initiative (Phase 2). The decision itself
> was made 2026-07-27 (v0.2) unless noted; this file records it, it did
> not create it.

## Context
The migration needed a specification that could not drift from proven
behavior. The ARB (R5) also flagged that v0.1's parity list omitted the
very risks it named: focus/keyboard behavior and large-document scale.

## Decision
The existing Python behavior, exported as golden fixtures, is the migration
specification — split into three named families: domain-parity,
interaction, and performance (v0.2 §13).

## Alternatives
Rewriting from the architecture document — the classic drift trap,
explicitly avoided. A single undifferentiated fixture pile — rejected;
the families have different lifecycles and executors.

## Consequences
Every engine port was accepted against fixture diffs; deviations became
first-class recorded objects (see `no-silent-oracle-deviations` in
`../../product/invariants.md`).

## Current status (2026-07-30)
Domain-parity: [BUILT] (13 fixtures, Gate B/E). Interaction: satisfied via
property/behavior suites instead of exported fixtures — an explicitly
resolved Gate C judgment call, not an omission. Performance: the directory
exists and is still empty — [DESIGNED], no budgets populated yet.

## Sources
v0.2 §13; ARB report R5; `../../../fixtures/README.md`;
`../phase-1-acceptance-criteria.md` (Gate C addendum);
`../../detection/phase-12-findings.md`.
