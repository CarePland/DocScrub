# ADR-010: IndexedDB/OPFS local persistence

Status: accepted (register priority: Recommended)
Date: 2026-07-27 (v0.2 register)

> Retroactive record, extracted 2026-07-30 from the v0.2 target
> architecture's ADR register (§16) and the Architecture Review Board
> report, per the documentation initiative (Phase 2). The decision itself
> was made 2026-07-27 (v0.2) unless noted; this file records it, it did
> not create it.

## Context
Never losing reviewer work (v0.2 §8) requires durable browser-side
persistence without any server.

## Decision
LocalSessionRepository persists sessions to IndexedDB (structured state),
with OPFS contemplated for larger artifacts and File System Access API for
explicit export locations. Autosave covers every domain transition,
including Not Quite drafts; quota problems must surface a blocking warning
plus a forced-export path, not silent failure.

## Alternatives
localStorage — size/structure limits; no. Server persistence — violates
ADR-002. Requiring OPFS at launch — deliberately left open (v0.2 §17).

## Consequences
Storage quota is a named product risk with a UX contract; graceful
degradation when IndexedDB is unavailable is required (a Milestone 3 fix
made this real).

## Current status (2026-07-30)
[BUILT] — `IndexedDbSessionRepository` (Milestone 3): autosave, refresh
recovery, Recent Documents. The full quota contract (proactive threshold +
forced export) remains the one open edge — see
`../../product/invariants.md#never-lose-reviewer-work`. OPFS: unused.

## Sources
v0.2 §6.12, §8; ARB report §4.10;
`../../detection/milestone-3-reviewer-productivity.md`.
