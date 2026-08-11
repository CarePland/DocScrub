# Group Check UI Standardization Findings

Implemented 2026-08-10 in `app/`.

## Summary

Group Check now uses the emerging review UI language for the two surfaces
requested in the pass:

- the currently focused group renders as a full-width focus panel;
- non-focused groups render as compact review cells.

The stage's workflow and command semantics are otherwise unchanged.

## Reused Primitives

- `item-row`, `item-row-focused`, `decision-tinted`, `decision-*`, and
  `item-schemed` remain the shared row, focus-ring, decision-tint, and
  containment primitives.
- `reviewed-check`, `confidence-plain`, `decision-pills`, and
  `group-row-actions` remain the shared status/action primitives.
- The cell treatment follows the existing `result-cell` / `type-member-row`
  visual grammar: compact bordered surface, large primary text, muted count,
  focused ring separated from decision fill.

## Group-Specific Adapter

- `group-focus-panel` and `group-review-cell` are presentation-only adapter
  classes on the existing Group Check row renderer.
- `group-cell-focused` spans the focused group across the two-column grid
  and moves it to the top visually.
- The compact cell click handler focuses the group but ignores clicks inside
  existing controls, preserving button/input/editor handlers.

## Support Restored

- `src/metrics/percentDisplay.ts` was restored because both the app and the
  decision-reduction suite already imported it. It implements the existing
  endpoint-honesty behavior pinned by verification (`~100%` / `~0%` when a
  rounded endpoint is not exact).
- `src/account/localSessionOwner.ts` and `src/account/usageMetrics.ts` were
  restored as browser-local, best-effort support modules so TypeScript and
  the persistence/usage import paths compile. They do not change review
  decisions or Group Check behavior.

## Preserved Behavior

- One group remains focused.
- Bare `K / C / R / I / F` still operate on the focused group.
- Row action buttons still call the same Group Check commands and subset
  handlers.
- Deciding one group continues through the existing advance/update path.
- Expanded members, "Separate these", `Use`, and `Source` remain in their
  existing render branches and call the same handlers.
- Sorting remains handled by `visibleGroupIds()` / `groupCheckQuery.ts`.

## Behavior Changed

No product behavior was intentionally changed. The only interaction addition
is that clicking the empty/text area of a compact group cell focuses that
group; clicks on controls are explicitly excluded and keep their prior
behavior.

## Deferred Intentionally

- Group Check command-bar standardization.
- Stats, Decision Tracker, and left-side stage chrome.
- Zone/global actions and Option bulk actions.
- Stage-wide progress redesign.
- Search/filter/pager work.
- Redesign of member separation or split review.

## Verification

`verify/ui-smoke.ts` was updated to assert:

- focused Group Check gets `group-cell-focused` + `group-focus-panel`;
- non-focused groups get `group-review-cell`;
- control clicks are guarded from the cell focus handler;
- no Option/global action labels were introduced;
- "Separate these", `Use`, and `Source` stay in the existing render path.

Final run:

- `npx tsc --noEmit`: pass.
- `npm run build`: pass.
- `verify/*.ts`: 48/49 suites pass when run with the bundled Python first in
  `PATH`.
- Remaining failure: `verify/ui-smoke.ts` reports pre-existing structural
  failures outside this pass (`zone grid`, `section snap`, focus-panel
  verdict placement, mixed-category proposal rows, proposal tint specificity).
  The new Group Check focus-panel/cell checks inside that suite pass.
