# Group Check Focus Panel Concept

Date: 2026-08-08

Status: concept pass before implementation. This follows
`20260808-check-stage-ui-audit.md`, which recommends defining the Group
Check focus panel and member-depth model before coding because Group Check
has semantics Ambiguity Check does not: the review unit is a proposed
identity group, and member-level work can either refine that proposal or
temporarily suspend it.

## Problem

Ambiguity Check now has a stable review-stage language: rows are compact
scanning objects, the focus panel is the main reading and decision surface,
Enter goes deeper, Escape comes out, and the keys shown on actions match the
keys that fire. Group Check still does most of its reading work by expanding
the focused group inline. That was a faithful evolution of the Python row
model and carries important behavior, but it now makes the working object
less stable than the other check stages.

The goal is not to make Group Check identical to Ambiguity Check. The goal
is to make the shared concepts mean the same thing where they apply:

- the group list/grid is for scanning groups;
- the selected group has one primary reading/decision surface;
- member-level work is a deeper mode inside that surface;
- decision tint, handled state, and visible keycaps stay consistent with
  the rest of the workspace.

## Reviewer Model

Group Check has three depths.

1. **Group row/card level**: arrows move among visible groups in the
   currently displayed sort/layout order. The row shows canonical name,
   member count, dominant decision tint when any member has been decided,
   decision-mix pills, reviewed glyph for uniform completion, and attention
   state where appropriate. The row remains compact.
2. **Group focus panel level**: Enter opens/enters the focused group's
   panel. The panel is the primary surface for reading the group and taking
   group-scope actions. Escape leaves the panel and returns to the group
   row/card level.
3. **Member depth**: Fix this, Separate these, and direct member review
   operate inside the focus panel. Within this depth, arrows move among
   members, K/C/R/I act on the active member where the existing model allows
   it, Enter commits the current member-depth completion where there is an
   explicit completion action, and Escape backs out one level.

This keeps the audit's rule intact: Enter goes deeper or commits the active
deeper operation; Escape comes out; arrows move among review units rather
than entering or exiting.

## Panel Contents

The Group focus panel should contain, in order:

1. **Header**: canonical name, member count, live/original confidence where
   available, reviewed glyph or attention summary, and decision-mix pills.
2. **Primary group actions**: Keep as-is, Change, Redact, Ignore, Fix this.
   These are the same actions currently shown on the row. Bare K/C/R/I/F
   remain the group-level keys because the group is already the focused
   object in Group Check; adding modifier duplicates would create a second
   vocabulary for the same scope.
3. **Selection/scope line**: selected member count and whether the action
   will cover all members or a selected subset. This preserves the existing
   group member selection model but moves the explanation beside the action
   surface that uses it.
4. **Member summary/list**: member names, occurrence counts, per-member
   decision glyph/tint, confidence/attention state, and Source affordance.
   The list is readable in the panel without turning the outer group row
   into a large expanded object.
5. **Evidence/source area**: source snippets for the active member or a
   compact group-level source summary when no member is active. This reuses
   the existing Source behavior rather than inventing a new evidence model.

The panel should use the same focus-panel CSS family as Ambiguity and Type
Check, but with Group-specific content. It should not be a card inside the
group row; it is the stage's primary reading surface.

## Existing Behavior To Preserve

- Group Check's durable decision vocabulary remains unchanged. The UI may
  say Change/Fix this, but session and audit vocabulary continue to use the
  established command and decision names.
- `groupDisplayDecision()` remains derived from member decisions. Do not
  store a new panel-level display decision.
- Member selection remains UI-layer state. A partial group action should
  continue to dispatch candidate-level bulk decisions rather than stamping a
  full group decision.
- Not Quite/Fix this remains granular. Entering it never decides anything
  by itself, and completing it does not require every member to be decided.
- A mixed member outcome remains visible as mixed/attention-bearing. It
  must not collapse to a guessed group-level decision.
- Split Review continues to suspend the group as the decision unit while
  buffered member choices are being explored.
- Visible group traversal remains UI-layer and follows `visibleGroupIds()`;
  `FocusNavigator`, `navigator.ts`, and `keymap.ts` must not learn rendered
  sort/layout state.

## Implementation Shape

The smallest safe implementation is UI-layer only.

1. Extract the non-row member rendering logic now embedded in
   `renderGroupStage()` into panel-oriented helpers. The helpers should
   take the already-derived group, session, selection, display summary, and
   active member state; they should not introduce new domain state.
2. Render the group list as compact group rows/cards. The focused group row
   points to the panel instead of expanding the full member breakdown inline.
3. Add a `group-focus-pane` inside a split layout sibling to the group list,
   following the existing `triage-focus-pane` / `type-focus-pane` pattern.
4. Move Fix this and Split Review surfaces into the panel. Their underlying
   commands and buffered state stay unchanged.
5. Keep the current row action buttons during the transition only if needed
   for parity, but treat the panel actions as the primary surface. Once
   verified, remove duplicate row action clusters to avoid two simultaneous
   places to make the same group decision.

## Judgment Calls

- **Assumption**: Group Check should adopt a focus panel, but not category
  pills. Group Check's natural navigation dimension is proposed groups, not
  a small taxonomy of categories. Adding category pills would manufacture a
  structure the audit did not ask for.
- **Why**: The reviewer benefit comes from a stable reading surface and a
  consistent Enter/Escape depth model, not from copying Ambiguity's category
  chrome.
- **Alternative considered**: Keep the current inline expansion and only
  restyle it. That preserves behavior with less code churn, but it does not
  address the audit's main concern that the working object feels unstable.
- **Reviewer impact**: The panel should reduce scrolling and make the
  active group easier to evaluate, while preserving the existing high-leverage
  group actions and member-level escape hatches.

## Verification Plan

- Add or update UI smoke checks for the presence of `group-focus-pane`, the
  absence of heavy member expansion inside ordinary group rows, and the
  continued presence of Fix this / Split Review affordances.
- Extend group-check verification only for pure behavior that changes.
  Existing `groupDisplayDecision()` and sort-order tests should remain
  unchanged.
- Run `npx tsc --noEmit`, `npm run build`, and the full `verify/*.ts`
  battery before calling the implementation complete.
- Perform live browser validation with a document that has at least two
  proposed groups, one uniform outcome, one mixed/Fix this outcome, and one
  selected-subset action.
