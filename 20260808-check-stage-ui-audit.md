# Check Stage UI Audit — Ambiguity Pattern Carryover

Date: 2026-08-08

## Reference Pattern: Ambiguity Check

Ambiguity Check now has a coherent review-stage language:

- horizontal category pills define the visible work area;
- only the active category is shown in the work surface;
- rows/cards are compact scanning objects;
- the focus panel is the primary reading/decision surface;
- Enter enters the panel, Escape leaves it, arrows move among review units;
- action colors/tints communicate handled state consistently;
- section/group actions advertise the same keys that actually fire.

The question for the other stages is not “make them identical,” but “make
the same concepts mean the same thing where the stage has comparable work.”

## Item Check

Current fit:

- Item Check Triage already shares the sectioned-queue renderer with
  Ambiguity, and the scope inspector is visually part of the same family.
- Item Check List and By Category still feel older: focused rows expand
  inline, while Ambiguity has made the focus panel the real work surface.
- By Category has its own filter grid and result cells, so it has more
  navigation chrome than Ambiguity and less of a single “I am working this
  item here” pane.

What would be needed:

- Decide whether Item Check should keep multiple visual modes, or whether
  Triage becomes the preferred default and List/By Category become search
  and filtering tools around the same focus-panel experience.
- Bring List and By Category to the same hard depth model: row/cell focus
  outside, Enter into panel, Escape out, arrows always movement.
- Reuse the same focus-panel top-line/action layout as Ambiguity for any
  focused candidate.
- Preserve Item Check’s selection model, but make the selection/scope
  inspector feel like a sibling of the Ambiguity panel rather than a
  separate exception.

Recommended priority: medium-high. Item Check is a core stage and already
has most of the machinery, but the risk is UX churn because it has three
views with different histories.

## Group Check

Current fit:

- Group Check is the least visually aligned with Ambiguity. It uses group
  rows/cards with inline member expansion, a sort toolbar, and special Fix
  this / split-review modes.
- Its review unit is a group, not a candidate. That is a real difference,
  and the UI should preserve it.
- The current inline expansion can make the “working object” feel less
  stable than Ambiguity’s persistent focus panel.

What would be needed:

- Add a Group focus panel for the selected group: canonical name, confidence
  / attention state, primary actions, member list summary, and source/evidence.
- Keep the group grid/list as the scanning surface, with the focused group
  opening in the panel rather than expanding heavily inline.
- Treat member-level work as a panel depth or sub-mode: Enter into group,
  arrow among members, Escape back to group, Escape again back to list.
- Re-house Fix this so it feels like a focused group editing mode, not a
  separate layout species.
- Keep Group Check’s bare K/C/R/I/F behavior, because the group is already
  the focused object there; do not add modifier duplicates just for symmetry.

Recommended priority: high for visual consistency, but it needs careful
interaction design. This stage has the most unique semantics.

## Type Check

Current fit:

- Type Check is already close. It has type cards, a focused type surface,
  a type member grid, and a `type-focus-pane` that shares the focus-panel
  CSS family.
- It already uses group-scope Opt/Alt actions and decision tinting.
- The biggest gap is polish/consistency rather than architecture.

What would be needed:

- Align the focus-panel header/action layout with Ambiguity’s latest version.
- Make the Enter/Escape depth model visually explicit in the same way:
  card level -> member level -> panel level, with only Escape moving out.
- Review whether type cards should behave like category pills plus a work
  surface, or remain cards. Cards may still be right here because types are
  few and high-level.
- Ensure handled member rows and type cards use the same filled decision
  tint behavior as Ambiguity proposal rows.

Recommended priority: medium. Good candidate for a polish pass after Group
Check because the underlying model is already aligned.

## QA

Current fit:

- QA currently has no interactive per-item model in this build.
- Copying Ambiguity’s focus-panel structure would be artificial unless QA
  gains reviewable findings.

What would be needed:

- If QA remains a status/reporting stage, make it a concise dashboard:
  pass/fail state, blockers, warnings, and links back to the stage/item
  that can resolve each issue.
- If QA gains interactive findings, use the same split: finding list on one
  side, focused finding/evidence/action panel on the other.
- Avoid introducing fake keyboard review mechanics until there are real QA
  decisions to make.

Recommended priority: low unless QA findings become actionable.

## Output

Current fit:

- Output is not a check stage in the same sense. It is a final action and
  artifact stage.
- Its main jobs are gating, generation, verification status, and downloads.

What would be needed:

- Do not force an Ambiguity-style focus panel.
- Use a clearer finalization layout: readiness status, blocking items with
  jump targets, generate/download actions, audit artifacts.
- Borrow the visual language only where it helps: green completion, warning
  / blocker severity, action grouping, and persistent status.

Recommended priority: low-medium. Worth improving, but not through the
same review-unit pattern.

## Cross-Stage Rules To Standardize

- A focused review unit should have one primary reading/decision surface.
- Rows/cards are for scanning; the panel is for deciding.
- Enter goes deeper; Escape comes out; arrows move, not enter or exit.
- A keycap shown on a button must fire that exact visible action.
- Decision color should mean the same decision everywhere, including fill,
  not just border.
- Category/type/group navigation should preserve refresh state when it is
  part of the visible work context.
- Selection and wider-scope actions should be explicit about scope and count.

## Suggested Order

1. Group Check concept pass: define the group focus panel and member-depth
   model before coding.
2. Type Check polish pass: align panel/header/action details with Ambiguity.
3. Item Check consolidation decision: decide whether List/By Category should
   become variants around the same focus panel, or remain separate tools.
4. QA/Output cleanup: dashboard/finalization clarity, not review-panel mimicry.

