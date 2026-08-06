# ADR-017: Closed, typed telemetry schema

Status: accepted, new in v0.2 (register priority: Required — NEW); dormant — no telemetry exists yet
Date: 2026-07-27 (v0.2 register)

> Retroactive record, extracted 2026-07-30 from the v0.2 target
> architecture's ADR register (§16) and the Architecture Review Board
> report, per the documentation initiative (Phase 2). The decision itself
> was made 2026-07-27 (v0.2) unless noted; this file records it, it did
> not create it.

## Context
The highest-consequence failure mode in the architecture: a crash reporter
or analytics breadcrumb serializing document content is a privacy incident,
not a bug. v0.1 named the risk but proposed only policy language.

## Decision
If and when telemetry exists, events use a closed, typed schema — no
free-form object logging anywhere in the system — enforced by the shape of
the TelemetryEvent type itself, not by review discipline. Document content
is prohibited from crash reports, breadcrumbs, logs, analytics, and
third-party payloads.

## Alternatives
Policy-only language — explicitly rejected in v0.2 as insufficient
mechanism.

## Consequences
Any future telemetry/diagnostics feature starts from the closed schema;
"just log the object" is architecturally unavailable. Which fields belong
in the schema remains an open decision (v0.2 §17).

## Current status (2026-07-30)
[DESIGNED, dormant] — no telemetry code exists in `src/` today; the
decision constrains future work rather than describing current code.

## Sources
ARB report §4.8; v0.2 §11, §17.
