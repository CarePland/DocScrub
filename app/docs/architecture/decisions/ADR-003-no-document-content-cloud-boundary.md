# ADR-003: No document-content cloud boundary

Status: accepted (register priority: Required)
Date: 2026-07-27 (v0.2 register)

> Retroactive record, extracted 2026-07-30 from the v0.2 target
> architecture's ADR register (§16) and the Architecture Review Board
> report, per the documentation initiative (Phase 2). The decision itself
> was made 2026-07-27 (v0.2) unless noted; this file records it, it did
> not create it.

## Context
Future cloud services (auth, licensing, org configuration, telemetry) must
coexist with the browser-local promise (ADR-002). "We respect privacy" is
not testable; a boundary must name what may not cross it.

## Decision
Cloud services must not ordinarily receive: source files, document text,
candidates, occurrences, replacement values, review decisions, generated
documents, or audit contents (v0.2 §11). The boundary is specific and
falsifiable — the ARB singled this specificity out as a strength.

## Alternatives
Policy-only privacy language — explicitly rejected in v0.2, which added
mechanism (ADR-017's closed telemetry schema, ADR-018's per-setting trust
classification) after the ARB noted v0.1 had named the risk without an
enforcement point.

## Consequences
Error reporting, analytics, logs, and support tooling are the
highest-consequence leak paths and are architecturally constrained;
`audit-excludes-candidate-text` (see `../../product/invariants.md`) is this
decision's audit-artifact corollary.

## Current status (2026-07-30)
[BUILT] trivially — no cloud integration exists yet, so nothing crosses.
The decision's real force arrives with the first cloud feature.

## Sources
v0.2 §11; ARB report §2, §4.8.
