# Group Check UI Standardization Pass

Status: implemented 2026-08-10

## Scope

This pass standardizes only Group Check's focused group surface and its
remaining group cells. It deliberately does not add the broader review-stage
chrome: no left-side stats panel, Decision Tracker, command bar redesign,
Zone/global actions, filters, new metrics, or stage-wide progress redesign.

## What Changed

- The focused Group Check group now spans the group grid and uses a
  focus-panel presentation class (`group-focus-panel`).
- Non-focused groups now carry a compact review-cell presentation class
  (`group-review-cell`) while continuing to use the existing group-row
  renderer.
- The whole non-focused cell is selectable unless the click lands on an
  existing button, input, select, textarea, or link.
- Expanded member rows sit directly beneath the focused panel without the
  previous left indent.

## Behavior Preserved

- The focused unit is still exactly one group.
- Bare `K / C / R / I / F` still act on the focused group through the
  existing keymap and command handlers.
- Group-row mouse actions still use the existing group/subset handlers.
- Checked-subset behavior is unchanged.
- Fix this / Not Quite remains the existing Group Check member workflow.
- "Separate these", `Use`, and `Source` remain in the same render branches
  and invoke the same handlers as before.
- Sorting and queue membership remain governed by `visibleGroupIds()` and
  `groupCheckQuery.ts`; this pass does not alter either.

## Judgment Calls

- **Assumption:** the focus panel can be a presentation class on the existing
  group row rather than a new domain-shaped component.
  **Reason:** Group Check's row is already the group decision surface, so
  reusing the row preserves the documented semantics with less behavioral
  risk.
  **Alternative:** extract a new shared focus-panel component.
  **Reviewer impact:** no new interaction model; the focused group simply
  reads as the primary work surface.

- **Assumption:** compact cells may keep their existing mouse actions.
  **Reason:** the request preserves current action semantics, and Group Check
  already allowed row-level actions outside keyboard focus.
  **Alternative:** remove non-focused row buttons until a group is focused.
  **Reviewer impact:** no loss of mouse-first workflow.

## Verification

- `verify/ui-smoke.ts` now pins the focus-panel/cell classes, focused grid
  spanning, click-to-focus guard, no Option/global actions, and preservation
  of the expanded-member workflow strings.
- Existing Group Check behavioral suites remain responsible for command,
  navigation, sort, split, and audit behavior.
- `npx tsc --noEmit` and `npm run build` pass after restoring the missing
  support modules already imported by the app (`percentDisplay`,
  `localSessionOwner`, `usageMetrics`).
- Full verification status: 48/49 suites pass with the bundled Python first
  in `PATH`; the only remaining failing suite is `verify/ui-smoke.ts`, whose
  new Group Check checks pass while unrelated pre-existing structural checks
  still fail.

## Deferred Intentionally

- Broader Group Check command-bar standardization.
- Left-side stats and Decision Tracker.
- Zone/global action treatment.
- Search/filter/pager work.
- Any redesign of the expanded member / separation workflow.
