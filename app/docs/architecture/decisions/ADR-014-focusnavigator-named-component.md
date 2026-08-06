# ADR-014: FocusNavigator as a named, ported component

Status: accepted, new in v0.2 (register priority: Recommended — NEW)
Date: 2026-07-27 (v0.2 register)

> Retroactive record, extracted 2026-07-30 from the v0.2 target
> architecture's ADR register (§16) and the Architecture Review Board
> report, per the documentation initiative (Phase 2). The decision itself
> was made 2026-07-27 (v0.2) unless noted; this file records it, it did
> not create it.

## Context
Python's `review_queue.py` already held tested, framework-agnostic
keyboard/focus logic; v0.1 left focus behavior to be rebuilt ad hoc inside
React components ("UIStore or focus services"), while naming keyboard
regressions a top risk.

## Decision
FocusNavigator is a first-class ported domain component: active item,
focus movement, reconciliation against visibility, next-undecided
traversal, focus restoration after rerender. It reads decision state from
ReviewEngine and writes only ephemeral focus position — never durable
decisions.

## Alternatives
Ad hoc UI focus handling — rejected: discards tested logic and makes the
named risk untestable.

## Consequences
Keyboard trust is verifiable under Node (96+ checks) without a browser;
the DOM-free boundary (see `../../product/invariants.md#engines-are-dom-free`)
extends to navigation. The one place structural order vs. displayed order
can diverge became a UI-layer concern with a named pattern
(`moveWithinVisibleList`), found and fixed as such.

## Current status (2026-07-30)
[BUILT] — `src/engines/navigation/` (Phase 9).

## Sources
ARB report R5, §4.2; v0.2 §6.9; `../../detection/phase-9-findings.md`;
`../../detection/group-check-revision.md`.
