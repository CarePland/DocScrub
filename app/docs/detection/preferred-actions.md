# Proposal-Specific Preferred Actions — Findings

**Date:** 2026-07-30 · **Version:** v2026-07-30.06 · **Spec:** Andrew's "Proposal-Specific Preferred Actions (Keyboard-First Workflow)" prompt, implemented under `docs/architecture/implementation-philosophy.md`.
**Status:** Implemented. All automated verification green (31 suites; new suite 14/14). Browser validation pending (checklist below).

## Architecture review

**Where the examples live.** Three of the prompt's four examples (acronym values, organization alias values, the identifier blank) live on the **Structural Relationship cards**, whose action row is exactly the prompt's UI example (`Keep All · Change All · Redact All · Unrelated`). The fourth — related-name "① Andrew ② Andy" — lives on **ambiguity proposals**, where digits 1–9 are *already bound* to "link identity option N" for the focused candidate (the interaction-language work, shipped). Binding value-substituting actions to the same digits there would violate the prompt's own constraint ("must not interfere with existing shortcuts"), so this pass implements the mechanism for the structural cards and leaves ambiguity's digits meaning what they already mean. **Flagged for your call** rather than silently double-bound: if you want rename-flavored preferred actions on ambiguity proposals too, they need either different keys or a decision that linking *is* the preferred action there (arguably the current 1–9 already is this feature for that surface).

**Locality without collision.** Digit keys are bound on the **card element itself** (keydown listener, `preventDefault` + `stopPropagation`), so they act only while DOM focus is inside that proposal — the literal reading of "local to the focused proposal." The document-level handler never sees them; conversely, the candidate-focus digit shortcuts fire only from Review-mode focus contexts the card can't occupy. The card gets `tabindex="0"` (click or Tab to arm it; focus ring shows). Digits typed into the card's own inline editor input remain ordinary typing (tag guard). Unused numbers do nothing.

**Renderer ignorance.** `src/ui/preferredActions.ts` is a **pure policy module**: proposal → `{ label, op }[]` descriptors, where `op` is a *tag naming an existing operation* (`bulk-change` with a replacement; `open-redact-editor`) — never a closure, never semantics in the renderer. app.ts maps tags to the same handlers the generic buttons call. Purity makes the policy Node-testable; the tag design makes "identical workflow" checkable rather than promised.

## Design decisions

- **One shared apply path, made literal:** `applyRelationshipBulk()` gained the optional `replacement` and the inline editor's relationship confirm now routes through it — so the generic buttons, the editor's Apply, and the preferred actions dispatch **the same function building the same command**. Divergence is structurally impossible (suite-checked at source level).
- **Acronym cards: ① first full name ② the acronym** (detection order; degenerate proposals expose only the side they have; capped at two even with many members — no menus).
- **Identifier cards: ① "________"** → `openInlineEditor(relationship, Redact)` — the *existing* editor whose render-tail focus already puts the cursor in the blank; typing + Enter is exactly Redact All → replacement → Apply. Zero new behavior.
- **Labels are resulting states, enforced by test** (no "Change to…", no verbs).
- Preferred buttons render accent-weighted on the same row, left of the generic actions, no heading, no explanatory text. Disabled exactly when the generic actions are (empty member selection). Selection-scoped: they act on the checked subset, like everything else on the card.

## Constraint compliance (the prompt's hard list)

Same underlying operations ✓ (single path, source-checked). Identical audit events and decisions.json ✓ (identical `bulkApplyDecision` commands; no new command vocabulary — suite greps `Commands.ts`). Identical undo posture ✓ (same decisions, same re-decidability). No bypassed confirmations ✓ (the blank *opens* the editor rather than redacting immediately — Enter remains the confirmation, exactly as the generic path). No new persistence ✓ (suite greps `ReviewSession.ts`). Proposals without preferred actions render exactly as before ✓ (empty descriptor list short-circuits all new rendering and binding).

## Files changed

`src/ui/preferredActions.ts` (new — pure policy), `src/ui/app.ts` (shared-path routing; card rendering + local digits), `index.html` (chip styling + card focus ring), `verify/preferred-actions-verification.ts` (new — 14 checks), version/design-notes → v2026-07-30.06.

## Automated verification

31/31 suites (counted), tsc + full build clean. New suite: acronym two-action policy with verbatim value labels, identifier single-blank policy, degenerate/many-member caps, no-verb label rule, and the structural guarantees (single shared path, no new commands, no new persistence, card-local — not document-level — digit handling). Existing suites confirm audit/serialization surfaces untouched.

## Browser validation checklist

(Use `fixtures/browser-validation/semantic-relationships-phase2.docx` — its acronym and identifier content exercises both card kinds.)

1. Ambiguity Check: an acronym card shows `① National Student Clearinghouse ② NSC` left of Keep All; an identifier card shows `① ________`. Cards without preferred actions (none currently exist, but confirm structural cards with a missing side degrade to one button) render otherwise unchanged.
2. Mouse: click ① on the acronym card → all selected members Changed to the full name in one step; pulse + status line; Item Check shows ordinary Change decisions; audit/decisions.json entries indistinguishable from the manual Change All path.
3. Keyboard: Tab (or click) onto the card → press `2` → members Changed to "NSC". Press `3` → nothing (unused number).
4. Identifier card: press `1` → the Redact editor opens with the cursor in the blank; type a replacement, Enter → identical to Redact All → text → Apply. While the cursor is in the blank, typing digits types digits.
5. Non-interference: with a *candidate* focused (not a card), 1–9 still link identities; K/C/R/I, Shift+1–5, S, arrows all unchanged. With a card focused, digits act on the card only.
6. Uncheck a member: preferred actions apply to the remaining selection only; with none selected they disable alongside the generic buttons.
7. Save/resume and export/import: decisions made via shortcuts reuse exactly like manual ones.

## Intentionally deferred

Preferred actions on ambiguity proposals (digit-collision decision is yours — see Architecture review); preferred actions on Group Check rows; any per-detector action beyond the two card kinds.
