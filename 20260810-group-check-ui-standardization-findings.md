# Group Check UI Standardization Pass Findings

Date: 2026-08-10

## Scope

This pass standardizes Group Check only at the focused-group panel and
remaining-group cell level. It does not add Group Check stats chrome,
Decision Tracker treatment, a command bar redesign, Zone/global action
semantics, category wrapping, new metrics, new filters, or new bulk actions.

## Implemented

- The existing Group Check renderer now tags every group wrapper as a
  `group-review-cell`.
- The currently focused group additionally receives `group-focus-panel`.
- `group-focus-panel` composes the shared focus-panel surface token
  (`--focus-panel-surface`) and spans the two-column group grid.
- Remaining groups keep the existing two-column layout and receive compact
  review-cell hover/selection treatment through the new adapter class.
- Existing Group Check row markup, action button callbacks, subset
  selection, Fix this/Not Quite handling, Separate these, Use, Source, and
  member cursor behavior were intentionally left in place.

## Reused UI Primitives

- Shared `.item-row` row surface.
- Shared `.item-row-focused` focus ring.
- Shared `.decision-tinted` and decision hue classes from
  `decisionClass()`.
- Shared `.reviewed-check`, `.row-count`, confidence badge, decision pill,
  and group action active-button styles.
- Shared focus-panel surface token `--focus-panel-surface`.

## Group-Specific Adapter

Group Check remains a group-shaped renderer rather than a candidate-shaped
one. The adapter is therefore class composition on the existing
`groupCell`, not a data rewrite or forced reuse of Item/Ambiguity queue
components. That preserves the product fact that bare `K/C/R/I/F` operate
on the focused group.

## Behavior

No intended behavior changed. Specifically preserved:

- exactly one focused group;
- existing focus movement through the Group Check visible order;
- existing group action semantics for Keep as-is, Change, Redact, Ignore,
  and Fix this;
- bare `K/C/R/I/F` as focused-group actions;
- no `Opt K/C/R/I` or Zone/global action semantics for Group Check;
- member expansion under the focused group;
- Separate these;
- Use and Source member controls;
- existing resolved/mixed/undecided display state;
- sorting via the existing Group Check sort mode.

## Verification

Suite-verified:

- `npm run typecheck`
- `npm run build`
- `node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/group-check-revision-verification.ts` — 17/17
- `node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/ui-smoke.ts` — 203/203
- Full `verify/*.ts` sweep — all suites exited 0

Pending live validation:

- Real-browser visual review of the focused Group Check panel and the
  remaining two-column group cells at desktop and narrow widths.

## Judgment Calls

- Assumption: the correct reuse point is CSS composition, not extracting a
  new shared TypeScript component. Reason: Group Check's renderer already
  owns product-specific subset, Not Quite, and split-member behavior.
  Alternative considered: refactor Group Check into the sectioned queue
  renderer. Rejected because it would risk semantic flattening and collide
  with concurrent global action work.
- Assumption: focused group should span both columns by CSS order and grid
  span while keeping the same visible-order navigation source. Reason:
  focus-panel treatment is a presentation concern; the UI-layer navigation
  already uses `visibleGroupIds()`. Reviewer impact: the focused group reads
  as the primary panel without changing which group the keyboard acts on.

## Deferred Intentionally

- Group Check command-bar standardization.
- Left-side stats / Decision Tracker treatment.
- Zone/global action bar.
- Any `Opt K/C/R/I` bulk semantics.
- Stage-wide progress redesign.
- New filters, metrics, or category wrapping.
