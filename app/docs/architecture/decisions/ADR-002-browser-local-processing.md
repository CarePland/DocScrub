# ADR-002: Browser-local document processing

Status: accepted (register priority: Recommended)
Date: 2026-07-27 (v0.2 register)

> Retroactive record, extracted 2026-07-30 from the v0.2 target
> architecture's ADR register (§16) and the Architecture Review Board
> report, per the documentation initiative (Phase 2). The decision itself
> was made 2026-07-27 (v0.2) unless noted; this file records it, it did
> not create it.

## Context
Documents under review are PII-laden and FERPA-sensitive (v0.2 §15.4).
Server-side processing would put the most sensitive content on the wire.

## Decision
All document processing — parse, detection, scoring, resolution, review
state, rebuild, verification — runs locally in the browser. Ordinary
operation uploads nothing (v0.2 §4.1).

## Alternatives
Server-side processing — simpler engineering, unacceptable trust story.
Hybrid (local review, cloud detection) — still ships document text across
the boundary; rejected by §4.1's plain wording.

## Consequences
In-browser OOXML round-trip fidelity became the single largest technical
unknown (driving the early spike, v0.2 §14); large-document performance is
a client concern; persistence is browser storage (ADR-010).

## Current status (2026-07-30)
[BUILT] — the entire pipeline is browser/Node-local; there is no server
component at all today.

## Sources
v0.2 §2, §4.1, §15; ARB report §4.8.
