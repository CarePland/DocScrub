# ADR-015: ScoringProfileSnapshot for audit reproducibility

Status: accepted, new in v0.2 (register priority: Required — NEW)
Date: 2026-07-27 (v0.2 register)

> Retroactive record, extracted 2026-07-30 from the v0.2 target
> architecture's ADR register (§16) and the Architecture Review Board
> report, per the documentation initiative (Phase 2). The decision itself
> was made 2026-07-27 (v0.2) unless noted; this file records it, it did
> not create it.

## Context
The ARB's R4: if scoring weights/thresholds/lexicons are read live, a later
configuration change silently alters an already-scored session's Likelihood
and explanations on reload — an audit gap a FERPA-sensitive workflow cannot
absorb.

## Decision
The profile in effect at scoring time (weights, thresholds,
detector/ruleset version, lexicon versions, application version, timestamp)
is captured into the session's durable state as a ScoringProfileSnapshot.
A deliberate rescan under new rules is a new, explicitly recorded
processing revision — never an overwrite.

## Alternatives
Live-read settings at render time — rejected; it makes "explainable"
untrue on reload.

## Consequences
Historical explanations are reproducible without re-running anything;
`ReviewSession.processingRevisions` exists for rescans; settings gain the
"session-pinned" trust category (ADR-018).

## Current status (2026-07-30)
[BUILT] — `src/domain/ScoringProfileSnapshot.ts`, emitted by
CandidateQualityEngine, wired through ReviewSession (a Phase 11 wiring gap
was found and fixed, not designed around).

## Sources
ARB report R4; v0.2 §6.4, §7.2; `../../detection/phase-11-findings.md`.
