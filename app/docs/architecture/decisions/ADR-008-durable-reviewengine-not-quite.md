# ADR-008: Durable ReviewEngine, including Not Quite sub-state

Status: accepted, revised in v0.2 (register priority: Required (revised))
Date: 2026-07-27 (v0.2 register)

> Retroactive record, extracted 2026-07-30 from the v0.2 target
> architecture's ADR register (§16) and the Architecture Review Board
> report, per the documentation initiative (Phase 2). The decision itself
> was made 2026-07-27 (v0.2) unless noted; this file records it, it did
> not create it.

## Context
The ARB's first Required finding (R1): "Not Quite" — the product's one
documented exception to "items do not disappear on click," and the concrete
embodiment of Completion Beats Movement — was real, six-variable client
state in Python yet entirely invisible in the v0.1 architecture.

## Decision
ReviewEngine owns all durable review behavior, and Not Quite is modeled as
an explicit, named ReviewEngine sub-state scoped to one group: members,
per-member actions, replacement drafts, active member, transaction status —
with its own `review.enterNotQuite` / `applyNotQuiteMember` /
`completeNotQuite` / `exitNotQuite` commands and its own fixtures.
In-progress drafts are an open domain transaction (durable, autosaved), not
UI state, because they hold values that could reach the output document.

## Alternatives
Leaving Not Quite to be improvised in the UI during Phase 5 (the v0.1
default) — rejected: an architecture that documents an exception must model
it as explicitly as the rule it exempts.

## Consequences
Refresh mid-edit cannot silently discard reviewer work; the durable/UI
boundary for drafts is decided once (v0.2 §6.8), not re-litigated per
feature.

## Current status (2026-07-30)
[BUILT] — `src/domain/NotQuite.ts`, `src/engines/review/` (Phase 8;
MemberAction gained "Ignore" in Phase 9 as an objective interface defect
fix).

## Sources
ARB report R1, §4.6; v0.2 §4.5, §6.8; `../../detection/phase-8-findings.md`.
