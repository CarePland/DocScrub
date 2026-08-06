# ADR-001: Browser-first delivery

Status: accepted (register priority: Recommended)
Date: 2026-07-27 (v0.2 register)

> Retroactive record, extracted 2026-07-30 from the v0.2 target
> architecture's ADR register (§16) and the Architecture Review Board
> report, per the documentation initiative (Phase 2). The decision itself
> was made 2026-07-27 (v0.2) unless noted; this file records it, it did
> not create it.

## Context
DocScrub needed a delivery model for a subscription-enabled product whose
reviewers are professionals, not developers running local Python servers.

## Decision
DocScrub-Web is a browser-first application: file selection, review, and
output generation all happen in a browser tab.

## Alternatives
Desktop application — heavier install/update burden without privacy gain,
since browser-local processing (ADR-002) already keeps content local.
Continuing the local Python server — rejected as long-term host; it remains
the behavioral oracle only (v0.2 §1, §3).

## Consequences
Web platform APIs bound what is feasible (ZIP via CompressionStream, storage
via IndexedDB); real-browser validation is part of acceptance for reviewer-
facing work.

## Current status (2026-07-30)
[BUILT] — no-framework, no-bundler browser app (`src/ui/app.ts`,
`index.html`), click-tested in real Chrome since Phase 10.1.

## Sources
v0.2 §1–§2; `../review-workspace-specification.md`; Phase 10/10.1 findings.
