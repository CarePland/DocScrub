# ADR-018: SettingsService trust classification

Status: accepted, new in v0.2 (register priority: Required — NEW)
Date: 2026-07-27 (v0.2 register)

> Retroactive record, extracted 2026-07-30 from the v0.2 target
> architecture's ADR register (§16) and the Architecture Review Board
> report, per the documentation initiative (Phase 2). The decision itself
> was made 2026-07-27 (v0.2) unless noted; this file records it, it did
> not create it.

## Context
"Content-derived settings must stay local" had no named enforcement owner
in v0.1; a future "sync my thresholds" feature could be built by someone
who never reads the policy paragraph (ARB §4.4).

## Decision
Every setting carries a trust category as data at the SettingsService
level: cloud-syncable, local-only, session-pinned (captured into
ScoringProfileSnapshot, ADR-015), or content-derived-never-sync.
Enforcement is structural, not prose.

## Alternatives
Policy paragraph alone — rejected for the same reason as ADR-017's.

## Consequences
Sync features consult the category, not a document; classification of
specific items (org lexicons, notably) remains an open per-setting decision
(v0.2 §17).

## Current status (2026-07-30)
[DESIGNED, types landed] — `src/settings/SettingsService.ts` defines the
trust-classification types; no cloud sync exists to exercise them, and no
findings doc records a full service implementation.

## Sources
ARB report §4.4; v0.2 §6.16, §7.4, §17.
