/**
 * preferredActions.ts -- Proposal-Specific Preferred Actions (2026-07-30,
 * Andrew's keyboard-first workflow prompt). OPTIONAL ACCELERATORS: a
 * proposal type may expose one or two highly probable reviewer outcomes
 * as numbered shortcuts. They are not new concepts, not new operations,
 * and never required -- every action remains achievable through the
 * generic workflow, and a proposal exposing none renders exactly as
 * before.
 *
 * ARCHITECTURE SPLIT, deliberate: this module is PURE -- it maps a
 * proposal to descriptor objects { label, op } where `op` is a tagged
 * DESCRIPTION of an existing operation, never a closure. app.ts's
 * renderer turns descriptors into buttons and binds the card-local digit
 * keys; the op tags route to the SAME functions the generic buttons
 * already call (the shared applyRelationshipDecision path / the existing
 * inline editor), so audit events, decisions.json, undo, and
 * confirmation behavior are identical by construction -- there is no
 * second code path to diverge. Purity also makes the action policy
 * Node-verifiable without a DOM.
 *
 * LABEL RULE (from the prompt): a label is the RESULTING STATE ("Query
 * Based Update", "QBU", "________"), never a verb phrase -- the
 * surrounding proposal already provides the context.
 *
 * SCOPE (architecture review, disclosed): implemented for the Structural
 * Relationship cards, where three of the prompt's four examples live
 * (acronym values -> bulk Change; identifier blank -> the Redact editor
 * with the cursor in the blank). The related-name example ("1 Andrew /
 * 2 Andy") lives on AMBIGUITY proposals, where digits 1-9 are ALREADY
 * bound to "link identity option N" for the focused candidate (the
 * interaction-language work) -- binding value-substituting actions to the
 * same digits there would collide with a shipped shortcut, so that
 * surface keeps its existing digit meaning and is flagged in the
 * findings doc for Andrew's call rather than silently double-bound.
 */

import type { Candidate } from "../domain/DocumentModel.js";
import type { RelationshipProposal } from "../domain/StructuralRelationship.js";
import { isAcronymToken } from "../engines/StructuralRelationshipEngine.js";
import { genericPlaceholder } from "../engines/ReplacementRuleEngine.js";

/** What a preferred action DOES -- a tag naming an existing operation,
 *  resolved to the real handler by the renderer's host (app.ts). */
export type PreferredActionOp =
  | { kind: "bulk-change"; replacement: string }
  | { kind: "open-redact-editor" };

/** ACRONYM KIND-GROUP SECTION ACTIONS (AG, 2026-08-02): which SIDE of an
 *  acronym relationship an action standardizes on. Exists because the
 *  kind-group buttons ("Accept as acronyms" / "Accept written out") must
 *  pick the same descriptor a reviewer would pick per card -- and picking
 *  it POSITIONALLY would be wrong: a card missing its written-out member
 *  returns `[acronym]`, where index 0 is the acronym, not the full name.
 *  Naming the role keeps ONE derivation for both surfaces (the card's
 *  digits and the group's buttons), rather than a second rule in app.ts
 *  that could drift from this one. Undefined for every non-acronym kind:
 *  their single action has no "side" to choose between. */
export type PreferredActionRole = "written-out" | "acronym";

export interface PreferredActionDescriptor {
  /** The resulting state, verbatim -- shown on the button after the
   *  circled index. */
  label: string;
  op: PreferredActionOp;
  role?: PreferredActionRole;
}

// NOTE (2026-07-30): the original CIRCLED_DIGITS ("①"…) prefix constant
// lived here; retired after Andrew found the glyphs illegible at button
// size. The digit hint is now RENDERED by the UI as a <kbd class="keycap">
// element (see app.ts's keycapButton) -- labels stay pure resulting
// states with no baked-in prefix, which the verification suite enforces.

/**
 * The structural-relationship cards' preferred actions:
 *
 * - ACRONYM proposals: the two overwhelmingly likely outcomes are
 *   "standardize every member on the full name" and "standardize on the
 *   acronym" -- one button per resulting value (full name first, in
 *   detection order; the bare acronym second), each executing the
 *   existing bulk Change with that replacement. Capped at two by
 *   construction.
 * - IDENTIFIER-PATTERN proposals: the most likely action is redaction --
 *   one "________" action that opens the EXISTING Redact editor with the
 *   cursor in the blank (typing + Enter is then exactly Redact All ->
 *   replacement -> Apply).
 *
 * Other proposal kinds: none -- the UI renders exactly as today.
 */
export function preferredActionsForRelationship(proposal: RelationshipProposal, members: readonly Candidate[]): PreferredActionDescriptor[] {
  if (proposal.kind === "acronym") {
    const fullName = members.find((m) => !isAcronymToken(m.displayValue.trim()))?.displayValue.trim();
    const acronym = members.find((m) => isAcronymToken(m.displayValue.trim()))?.displayValue.trim();
    const actions: PreferredActionDescriptor[] = [];
    if (fullName) actions.push({ label: fullName, op: { kind: "bulk-change", replacement: fullName }, role: "written-out" });
    if (acronym) actions.push({ label: acronym, op: { kind: "bulk-change", replacement: acronym }, role: "acronym" });
    return actions;
  }
  if (proposal.kind === "numeric-identifier" || proposal.kind === "alphanumeric-identifier") {
    // LABEL REVISED (AG, 2026-08-02, live feedback: "Clicking 1 ____ led
    // to Redact All. I had no idea that was going to happen."): the bare
    // blank said nothing about the outcome. The label is now the engine's
    // own default placeholder for this member type ("[REDACTED ID]") --
    // still a pure resulting state, no verb, but one that SAYS these
    // values become a redaction placeholder. The op is unchanged: the
    // existing Redact editor opens with the cursor in the blank, so a
    // custom replacement stays one keystroke away.
    // Member detectedType feeds the placeholder only when it IS an
    // identifier-family type -- pattern members can carry the pipeline's
    // person-typed quirk (orgs/acronyms are person candidates), and
    // "[PERSON REDACTED]" on a numeric card would mislabel the outcome.
    // The fallback matches the Redact editor's own "(blank = [REDACTED
    // ID])" hint for these cards.
    const memberType = members[0]?.detectedType;
    const idType = memberType === "cin" || memberType === "long_numeric_id" || memberType === "email" || memberType === "phone" ? memberType : "long_numeric_id";
    return [{ label: genericPlaceholder(idType), op: { kind: "open-redact-editor" } }];
  }
  // "Probable Name with Inserted Word" (AG, 2026-08-02): the one
  // overwhelmingly likely fix is standardizing every member on the
  // CLEANED identity -- one button whose label IS that resulting state
  // ("Tanesha Collier"), executing the existing bulk Change. The cleaned
  // name rides on the proposal itself (suggestedReplacement, computed
  // once by identity-cleanup.ts from the group canonical in display
  // order -- never re-derived here from raw member strings, which are
  // often "Surname, Given" forms). Keep All / Redact All remain the
  // card's standard generic actions.
  if (proposal.kind === "inserted-word-name") {
    const cleaned = proposal.suggestedReplacement;
    return cleaned ? [{ label: cleaned, op: { kind: "bulk-change", replacement: cleaned } }] : [];
  }
  return [];
}
