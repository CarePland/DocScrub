# ADR-007: Central CommandDispatcher with namespaced command families

Status: accepted, revised in v0.2 (register priority: Recommended (revised))
Date: 2026-07-27 (v0.2 register)

> Retroactive record, extracted 2026-07-30 from the v0.2 target
> architecture's ADR register (§16) and the Architecture Review Board
> report, per the documentation initiative (Phase 2). The decision itself
> was made 2026-07-27 (v0.2) unless noted; this file records it, it did
> not create it.

## Context
Keyboard, pointer, toolbar, and future inputs need one command path
(v0.2 §4.6) — but v0.1 proposed one flat 15-command vocabulary and one flat
dispatch signature, which the ARB flagged as a pre-decided information
architecture and a future "dumping ground."

## Decision
Commands are namespaced by family — `review.*` (ReviewEngine),
`navigation.*` (FocusNavigator), `document.*` and `history.*`
(application) — and the dispatcher routes by family with per-family result
types, not one flat channel.

## Alternatives
Flat vocabulary (v0.1) — rejected per ARB R-adjacent finding §4.12.
Per-component ad hoc callbacks — violates §4.6.

## Consequences
New commands slot into a family or justify a new one; the dispatcher can
honestly reject an unowned family (`history.*` today) instead of faking it;
`explainCommandRouting()` can answer "why did this route there."

## Current status (2026-07-30)
[BUILT] — `src/workspace/CommandDispatcher.ts` (Phase 10; deliberately in
the composition layer, not `src/engines/`).

## Sources
v0.2 §6.10, §9, §12; ARB report §4.3, §4.12;
`../../detection/phase-10-findings.md`.
