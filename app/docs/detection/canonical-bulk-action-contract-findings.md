# Canonical Bulk Action Contract Findings

Date: 2026-08-11

## Scope

This pass standardizes Ambiguity Check and Item Check only. Type Check, Group Check, and the existing digit assignment model are intentionally left outside the rollout except where the shared handler must continue recognizing their existing explicit chords.

## Finding

Ambiguity Check and Item Check had one vocabulary split: focused actions used bare `K/C/R/I`, while wider conclusion actions used `Opt+K/C/R/N` because `Ignore` inherited the older conclusion-named `N` chord. That made the keyboard grammar depend on scope instead of action intent.

The canonical contract is now:

- Bare `K/C/R/I` targets only the focused candidate.
- `Opt+K/C/R/I` targets the current Zone or selected heading scope for Ambiguity Check and Item Check.
- Change and Redact still open the same candidate-scoped editor for focused bare `C/R`.
- Wider Change and Redact still open their existing scoped editor path.
- Reset Zone and Reset Category keep their existing reset flow and refusal messages.
- Digit shortcuts remain positional action shortcuts, not the primary destructive bulk-action path.

## Implementation Notes

`GROUP_SCOPE_CHORD_FOR_DECISION` is now the single semantic source for Ambiguity/Item bulk decision letters, with `Ignore` mapped to `I`. `headingSectionActions`, `headingActionScope`, `activeScopeSectionActions`, and `runSectionAction` remain the shared path, so the toolbar button and `Opt+letter` keyboard action execute the same `QueueSectionAction.run` descriptor.

The wider scope stays bounded by the materialized active Zone IDs. When a rolling Zone has more candidates available than `ZONE_CAPACITY`, applying a bulk action to the active Zone does not consume the immediately following candidate. That candidate can roll into the next active Zone after the action, but it is not retroactively included in the completed bulk operation.

## Non-Rollout Boundary

Type Check still declares its explicit `N` chord for `None are personal`. The shared low-level chord handler continues to recognize `N` so existing non-canonical callers keep working, while Ambiguity Check and Item Check advertise and derive `K/C/R/I`.

## Verification

Added `verify/canonical-bulk-action-contract-verification.ts` to pin:

- focused bare-key isolation,
- canonical `Opt+K/C/R/I` semantic mapping,
- command-bar copy,
- shared toolbar/keyboard invocation path,
- Zone boundary behavior,
- reset-source continuity, and
- the Type Check non-rollout boundary.

This is a deterministic source/domain verification. Live browser validation remains the appropriate follow-up if visual interaction regressions are suspected.
