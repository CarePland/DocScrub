# ADR-012: Schema and session versioning

Status: accepted (register priority: Required)
Date: 2026-07-27 (v0.2 register)

> Retroactive record, extracted 2026-07-30 from the v0.2 target
> architecture's ADR register (§16) and the Architecture Review Board
> report, per the documentation initiative (Phase 2). The decision itself
> was made 2026-07-27 (v0.2) unless noted; this file records it, it did
> not create it.

## Context
Python's own save format was unversioned; saved sessions must survive
application evolution.

## Decision
Every persisted session carries an explicit schemaVersion; loading
validates it and migrates through a documented ladder. Policy now,
machinery later: the ARB explicitly warned against building a generalized
migration framework before several real schema versions exist.

## Alternatives
Unversioned saves (the Python status quo) — rejected as a known trap.
A general migration framework upfront — rejected as premature abstraction.

## Consequences
Malformed or wrong-version files are rejected with reasons rather than
half-loaded; save/reload equivalence is a standing verification target.

## Current status (2026-07-30)
[BUILT] — `src/engines/review/serialization.ts` and
`src/workspace/WorkspaceSaveFile.ts` (Phase 8/10); wrong-document and
wrong-schema rejection covered across suites.

## Sources
v0.2 §6.12, §8; ARB report §4.3; `../../detection/phase-8-findings.md`.
