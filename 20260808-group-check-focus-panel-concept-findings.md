# Group Check Focus Panel Concept Findings

Date: 2026-08-08

## Scope

Acted on the Check Stage UI Audit's first suggested step: define the Group
Check focus panel and member-depth model before coding. No runtime behavior
was changed in this pass.

## Output

- Added `app/docs/detection/group-check-focus-panel-concept.md`.
- The concept preserves Group Check's unique semantics: proposed group as
  the review unit, member-level Fix this as a deeper mode, split review as a
  suspension of group-level decision-making, and derived display state from
  member decisions.
- The planned implementation shape is UI-layer only and keeps
  `FocusNavigator` / `navigator.ts` / `keymap.ts` free of rendered sort or
  layout state.

## Judgment Calls

- Assumption: Group Check should adopt a focus panel but not Ambiguity-style
  category pills.
- Reason: the audit's transferable pattern is the stable reading/decision
  surface and Enter/Escape depth model; Group Check does not have a natural
  category taxonomy comparable to Ambiguity's ambiguity classes.
- Alternative considered: restyle the current inline expansion only.
- Reviewer impact: a panel should make the active group easier to evaluate
  without weakening group-level actions, selected-subset scope, Fix this, or
  split review.

## Verification

Documentation-only pass. I did not run TypeScript or browser verification
because no code or styles were changed.
