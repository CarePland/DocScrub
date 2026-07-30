/**
 * keymap.ts -- context-aware keyboard-to-command resolution. This is the
 * "thin adapter" Andrew's Phase 9 instruction allows ("Do not implement
 * browser key listeners in this phase unless needed only as a thin
 * adapter"): a pure function from (current FocusState, raw key + modifier
 * flags) to a structured AnyCommand, with no DOM access of its own. A
 * future Workspace UI's `addEventListener("keydown", ...)` calls this and
 * dispatches whatever it returns; it never has to know which context
 * means what a key does.
 *
 * ORACLE GROUNDING: redactor/review_queue.py's shortcut_to_action() (k/n/
 * r/i -> Keep/Rename/Redact/Ignore, no modifiers, case-insensitive) and
 * should_ignore_keyboard_event() (input/textarea/select/button tags, or
 * an explicit editable flag) are ported directly. The Not Quite per-member
 * key mapping (k/n/r/i, plus "q" for context toggle -- not ported, see
 * below) and the group-level bulk-action mapping (k/n/r/i/q ->
 * "Keep as-is"/"Flatten"/"Redact"/"Ignore"/"Not Quite") come from
 * local_web_app.py's client JS keydown handler, which resolves context via
 * a long, ordered if-chain over DOM `.closest()` checks
 * (inAmbiguityCheck/inGroupCheck/notQuiteGroup/resultsKeyboardActive/...).
 * Reproduced here as an explicit switch over FocusState.target instead --
 * same behavior, no DOM dependency, directly unit-testable.
 *
 * Feature 001 (first post-migration feature): Group Check gained bulk
 * review.* commands (confirmGroup/rejectGroup/flattenGroup -- see
 * Commands.ts's v5 note and docs/detection/feature-001-group-bulk-actions.md).
 * Keyboard mapping deliberately reused Python's real group-level letters
 * where a direct analog exists -- "k" (Keep as-is) for Confirm, matching
 * confirmGroup's own bulk-Keep semantics exactly, and "n" (Flatten) for
 * Flatten -- and introduced exactly one new, non-conflicting letter, "x",
 * for Reject, which had no Python group-level analog. "r"/"i" were
 * deliberately left unbound at the group level rather than reused for
 * Redact/Ignore, reserved for a future feature that would need them.
 *
 * v9 terminology revision (Commands.ts): that future feature is this one.
 * Group Check's vocabulary now matches Item Check's exactly -- Rename/
 * Keep-as-is/Redact/Ignore/Not Quite -- so "r"/"i" now resolve to the new
 * redactGroup/ignoreGroup commands, and "x" (Reject) is removed along with
 * rejectGroup: it never had a place in the corrected, standardized term set
 * and this is the first point its keybinding could be freed without
 * colliding with anything reserved. "k"/"n"/"q" are unchanged.
 *
 * NOT PORTED: the "c" key (toggle inline context preview within a Not
 * Quite member row) and the ambiguity-panel's "d"/"." context-toggle key --
 * both are pure visual/presentation toggles (show/hide a context snippet
 * already available in ReviewOccurrence.context) with no effect on
 * ReviewEngine or FocusNavigator state, so they belong entirely to a
 * future Workspace UI's own component state, not this domain layer. (The
 * "c" key freed up by NOT porting that toggle is why reassigning it to
 * Rename/"Change" below doesn't collide with anything.)
 *
 * KEYBOARD RELABELING (2026-07-29, interaction model revision): Andrew,
 * after using the shipped app, asked that "Rename" become "Change" (key
 * "c", not "n" -- "allows the first letter of the word to be the command
 * ... fits the function a bit better") and "Not Quite" become "Fix this"
 * (key "f", not "q") everywhere those actions appear -- Item Check,
 * Ambiguity Check, Not Quite's own per-member actions, and Group Check's
 * row-level bulk actions alike. This is a DISPLAY + KEYBINDING change only:
 * the underlying decision vocabulary this file resolves to (the literal
 * string "Rename" in CandidateDecisionKind, the renameCandidate/
 * flattenGroup/enterNotQuite command TYPE names) is deliberately left
 * unchanged -- those are durable, audit-trail-relevant, and in
 * CandidateDecisionKind's case potentially embedded in a reviewer's already
 * -saved session file on disk (LocalSessionRepository). Renaming that
 * vocabulary too would be a real schema/parity change with migration and
 * audit-continuity implications CLAUDE.md's "preserve auditability" guards
 * against, and nothing about Andrew's request asked for that -- only the
 * word and key a reviewer sees/presses. See app.ts for where "Change"/"Fix
 * this" actually get displayed.
 *
 * Same revision also closes a real, pre-existing inconsistency: Group
 * Check's "n" (now "c") and "r" used to dispatch flattenGroup/redactGroup
 * DIRECTLY, bypassing the inline editor entirely (no way to narrow the
 * selection or pick a spelling from the keyboard) -- unlike Item Check/
 * Ambiguity Check, where "n"/"r" always fell through to a UI-layer editor
 * (see handleInlineEditorOpenKey in app.ts). Both group-level letters now
 * resolve to null here too, so the keyboard path always opens the same
 * editor the Change/Redact buttons do, for both stages consistently. "k"
 * (Keep) and the renamed "f" (Fix this) are unaffected -- neither ever
 * needed reviewer-typed text.
 */

import type { AnyCommand } from "../../domain/Commands.js";
import type { FocusState } from "../../domain/FocusState.js";
import type { MemberAction } from "../../domain/NotQuite.js";

export interface KeyEvent {
  key: string;
  meta?: boolean;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
}

/** Port of redactor/review_queue.py's should_ignore_keyboard_event(). */
export function shouldIgnoreKeyboardEvent(targetTag: string, editable = false): boolean {
  if (editable) return true;
  return ["input", "textarea", "select", "button"].includes(targetTag.toLowerCase());
}

/** Port of redactor/review_queue.py's shortcut_to_action(): case-
 *  insensitive, no modifiers, k/c/r/i (formerly k/n/r/i -- see this file's
 *  top doc comment on the "Rename" -> "Change" relabeling). Used for Item
 *  Check/Ambiguity Check (both resolve via the same plain
 *  candidate-decision vocabulary -- see FocusState.ts's "CONFIRMED
 *  FINDING"). */
function decisionShortcut(key: string, mods: KeyEvent): "Keep" | "Rename" | "Redact" | "Ignore" | null {
  if (mods.meta || mods.ctrl || mods.alt || mods.shift) return null;
  const mapping: Record<string, "Keep" | "Rename" | "Redact" | "Ignore"> = { k: "Keep", c: "Rename", r: "Redact", i: "Ignore" };
  return mapping[key.toLowerCase()] ?? null;
}

/** Group Check's bulk-action vocabulary -- local_web_app.py's
 *  `groupKeyActions` mapping, originally k/n/r/i/q -> Keep as-is/Flatten/
 *  Redact/Ignore/Not Quite. RELABELED (2026-07-29): "n" -> "c" (Change) and
 *  "q" -> "f" (Fix this), matching Item Check's own letters and this file's
 *  top doc comment. "c" (Change) now deliberately resolves to null here,
 *  not a direct dispatch -- it falls through to the same inline-editor-
 *  opening UI fallback Item Check's "c" already uses
 *  (handleInlineEditorOpenKey in app.ts), closing a pre-existing
 *  inconsistency where the group-level keyboard path bypassed the editor
 *  entirely while the Change button did not. "r" (Redact) gets the SAME
 *  fix for the same reason -- it also now falls through to that editor
 *  rather than dispatching redactGroup directly with no text. "k" (Keep)
 *  and "i" (Ignore) still resolve directly here -- neither ever needed
 *  reviewer-typed text, unchanged since Feature 001/v9. "x" (Reject)
 *  remains removed -- see this file's top doc comment. */
function groupCheckShortcut(key: string, mods: KeyEvent): "f" | "k" | "i" | null {
  if (mods.meta || mods.ctrl || mods.alt || mods.shift) return null;
  const lower = key.toLowerCase();
  return lower === "f" || lower === "k" || lower === "i" ? lower : null;
}

function notQuiteMemberShortcut(key: string, mods: KeyEvent): MemberAction | null {
  if (mods.meta || mods.ctrl || mods.alt || mods.shift) return null;
  const mapping: Record<string, MemberAction> = { k: "Keep", c: "Rename", r: "Redact", i: "Ignore" };
  return mapping[key.toLowerCase()] ?? null;
}

/** NEW (2026-07-29, interaction model revision): "when opened, Tab/
 *  Shift+Tab select the next/previous item" -- Andrew's explicit addition
 *  to the existing arrow-key moveItem bindings below, not a replacement for
 *  them. Arrow keys still resolve to moveItem here too (unchanged) as a
 *  graceful fallback for whenever nothing inside the current item has real
 *  DOM focus yet (e.g. right after switching stage tabs); once a control
 *  inside the focused row DOES have DOM focus, app.ts's own roving-focus
 *  handler intercepts arrow keys locally for within-row movement (Group
 *  Check only this revision -- see that function's own scope-trim note)
 *  and this binding is what's left to move between items -- see app.ts's
 *  attachRovingGridNav for the other half of this split. Meta/Ctrl/Alt+Tab
 *  are left alone (real OS/browser shortcuts); Shift+Tab is the one
 *  modifier this file treats as meaningful, for "previous". */
function tabDirection(event: KeyEvent): "next" | "previous" | null {
  if (event.key !== "Tab" || event.meta || event.ctrl || event.alt) return null;
  return event.shift ? "previous" : "next";
}

/**
 * Resolves a raw key event, in the context of the CURRENT FocusState, to
 * a structured command -- review.*, navigation.*, or null if the key has
 * no meaning in this context (the caller should let it fall through to
 * normal browser/text-editing behavior).
 */
export function resolveKeyboardCommand(focus: FocusState, event: KeyEvent): AnyCommand | null {
  if (focus.textInputActive) return null; // caret ownership -- see FocusState.ts

  const { target } = focus;

  // Not Quite panel open: arrows move the member cursor; k/i resolve
  // straight to applyNotQuiteMember (Keep/Ignore never need reviewer-
  // entered text); n/r (Rename/Redact) require draft replacement text a
  // key event alone can't supply, so those fall through to a future
  // Workspace UI's own draft editor, exactly like renameCandidate's own
  // text entry above; Escape exits.
  if (target.panel.kind === "not-quite") {
    if (event.key === "Escape") return { family: "review", type: "exitNotQuite", groupId: target.panel.groupId };
    if (event.key === "ArrowDown") return { family: "navigation", type: "moveNotQuiteMember", direction: "next" };
    if (event.key === "ArrowUp") return { family: "navigation", type: "moveNotQuiteMember", direction: "previous" };
    if (target.panel.activeMemberId) {
      const action = notQuiteMemberShortcut(event.key, event);
      if (action === "Keep") return { family: "review", type: "applyNotQuiteMember", groupId: target.panel.groupId, candidateId: target.panel.activeMemberId, action: "Keep" };
      if (action === "Ignore") return { family: "review", type: "applyNotQuiteMember", groupId: target.panel.groupId, candidateId: target.panel.activeMemberId, action: "Ignore" };
    }
    return null;
  }

  // Ambiguity Check / Item Check: plain per-candidate decision shortcuts
  // (same vocabulary, same underlying command -- see FocusState.ts).
  if ((target.stage === "ambiguity-check" || target.stage === "item-check") && target.itemId) {
    const action = decisionShortcut(event.key, event);
    if (action === "Keep") return { family: "review", type: "keepCandidate", candidateId: target.itemId };
    if (action === "Ignore") return { family: "review", type: "ignoreCandidate", candidateId: target.itemId };
    // Rename/Redact need reviewer-entered text; a UI layer opens its own
    // editor and dispatches renameCandidate/redactCandidate once
    // confirmed -- the keymap only signals which editor to open by
    // returning null here and letting the UI's own affordance take over,
    // consistent with how local_web_app.py's own client code opens an
    // inline rename/redact editor rather than resolving straight to an
    // API call for those two actions.
    if (event.key === "ArrowDown" || event.key === "ArrowRight") return { family: "navigation", type: "moveItem", direction: "next" };
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") return { family: "navigation", type: "moveItem", direction: "previous" };
    const tab = tabDirection(event);
    if (tab) return { family: "navigation", type: "moveItem", direction: tab };
    if (event.key === "Home") return { family: "navigation", type: "moveItem", direction: "first" };
    if (event.key === "End") return { family: "navigation", type: "moveItem", direction: "last" };
    if (event.key === "Enter") return { family: "navigation", type: "enterItem" };
    if (event.key === "Escape") return { family: "navigation", type: "closeItem" };
    return null;
  }

  // Group Check, no panel open: arrows/Tab move between groups; "f" (Fix
  // this) opens Not Quite for the focused group; "k" (Keep) and "i"
  // (Ignore) resolve straight to confirmGroup/ignoreGroup -- neither ever
  // needed reviewer-typed text. "c" (Change) and "r" (Redact) deliberately
  // resolve to null here now (see this file's top doc comment): the UI
  // layer's inline-editor fallback opens the SAME editor the Change/Redact
  // buttons do, instead of the old direct flattenGroup/redactGroup dispatch
  // that bypassed it.
  if (target.stage === "group-check" && target.itemId) {
    if (event.key === "ArrowDown" || event.key === "ArrowRight") return { family: "navigation", type: "moveItem", direction: "next" };
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") return { family: "navigation", type: "moveItem", direction: "previous" };
    const tab = tabDirection(event);
    if (tab) return { family: "navigation", type: "moveItem", direction: tab };
    if (event.key === "Home") return { family: "navigation", type: "moveItem", direction: "first" };
    if (event.key === "End") return { family: "navigation", type: "moveItem", direction: "last" };
    const groupShortcut = groupCheckShortcut(event.key, event);
    if (groupShortcut === "f") return { family: "review", type: "enterNotQuite", groupId: target.itemId };
    if (groupShortcut === "k") return { family: "review", type: "confirmGroup", groupId: target.itemId };
    if (groupShortcut === "i") return { family: "review", type: "ignoreGroup", groupId: target.itemId };
    return null;
  }

  return null;
}
