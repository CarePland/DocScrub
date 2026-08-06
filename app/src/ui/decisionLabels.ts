/**
 * decisionLabels.ts -- RX-22 (Reviewer Experience Wave 2, 2026-07-29). The
 * single display-label vocabulary for reviewer decisions.
 *
 * Since the "Rename" -> "Change" relabel (Group Check keyboard/navigation
 * revision, 2026-07-29), the DURABLE decision vocabulary
 * (`CandidateDecisionKind`'s literal "Rename", the `renameCandidate`
 * command, every saved session / audit CSV / decisions.json) has
 * deliberately kept "Rename" -- audit-trail and session-file continuity --
 * while the buttons say "Change." That split is correct and permanent; the
 * defect RX-22 fixes is that several DISPLAY sites kept interpolating the
 * durable kind directly (the statistics bar, the decided-row suffix, the
 * "Renamed" filter preset), so the reviewer saw both words for the same
 * action depending on where they looked.
 *
 * Rule from here on: anything the REVIEWER reads goes through this map;
 * anything a FILE or command carries stays the raw
 * `CandidateDecisionKind`. New reviewer-facing strings (status region,
 * toasts, screen-reader announcements) must consume this map from day one
 * rather than becoming new leak sites to grep for later.
 *
 * Exhaustive by construction: `Record<CandidateDecisionKind, string>`
 * fails to compile if a decision kind is ever added without a display
 * label.
 *
 * UNIFIED DECISION COLOR SYSTEM (AG, 2026-08-03): this file's remit widened
 * from "the word the reviewer reads" to "everything that presents a
 * decision kind to the reviewer" -- the word, the pill letter, and the CSS
 * class carrying its hue. Same reason as RX-22: these were previously
 * spread across three parallel `Record<CandidateDecisionKind, string>` maps
 * in app.ts (GROUP_ROW_DECISION_CLASS, GROUP_ACTION_DECISION_CLASS,
 * GROUP_CELL_SCHEME_CLASS) plus ~30 hand-enumerated CSS rules, so adding a
 * fifth decision meant finding six places. Now it means adding one line
 * here, one in DecisionPrecedence.ts, and one CSS rule.
 *
 * The PRECEDENCE half deliberately lives elsewhere
 * (`domain/DecisionPrecedence.ts`) -- `engines/review/coverage.ts` needs it
 * too, and an engine may not import from `ui/`. This file imports the
 * ordering from there rather than restating it.
 */

import type { CandidateDecisionKind } from "../domain/ReviewSession.js";
import { DECISION_PRECEDENCE, type DecisionSummary } from "../domain/DecisionPrecedence.js";

export const DECISION_DISPLAY_LABEL: Record<CandidateDecisionKind, string> = {
  Keep: "Keep",
  Rename: "Change",
  Redact: "Redact",
  Ignore: "Ignore",
};

export function decisionDisplayLabel(kind: CandidateDecisionKind): string {
  return DECISION_DISPLAY_LABEL[kind];
}

/**
 * ACTION vs STATE VOCABULARY (AG, 2026-08-03). Two maps, one rule for
 * choosing between them:
 *
 *   - `DECISION_ACTION_LABEL` is what a CLICKABLE CONTROL says. It answers
 *     the reviewer's question at the moment of deciding -- "what will
 *     happen to my document if I click this?" -- so Keep becomes the
 *     explicit "Keep as-is": the button leaves the document unchanged, and
 *     saying so out loud is the whole point.
 *   - `DECISION_DISPLAY_LABEL` (above) stays the STATE NOUN, for anything
 *     REPORTING a decision rather than offering one: the statistics bar,
 *     "Reviewed -- Keep", toasts, filter presets, pill tooltips.
 *
 * WHY NOT ONE MAP, given RX-22 exists precisely to prevent two words for
 * one action. Because the two maps describe different parts of speech, not
 * different vocabularies: "Keep as-is" is the verb phrase and "Keep" is
 * the noun, and every sentence that consumes the state label reads wrong
 * with the verb phrase substituted in ("Keep as-is 12" in the statistics
 * bar, "Keep as-is applied to 5 candidate(s)" in a toast, "Also contains
 * Keep as-is" in a pill tooltip). RX-22's actual defect was "Rename" and
 * "Change" -- two DIFFERENT words for one action, where the reviewer could
 * not tell they meant the same thing. "Keep"/"Keep as-is" share their
 * head word, so no such ambiguity exists.
 *
 * The line is mechanical and greppable: if the string ends up inside a
 * `<button>`, it comes from an ACTION map; otherwise from the state map.
 * Only Keep actually diverges -- the other three are identical in both --
 * which is why the maps are kept separate rather than collapsed into a
 * single "sometimes suffix as-is" helper that would hide the rule.
 */
export const DECISION_ACTION_LABEL: Record<CandidateDecisionKind, string> = {
  Keep: "Keep as-is",
  Rename: "Change",
  Redact: "Redact",
  Ignore: "Ignore",
};

export function decisionActionLabel(kind: CandidateDecisionKind): string {
  return DECISION_ACTION_LABEL[kind];
}

/**
 * The bulk forms, as their own maps rather than `${action} all`.
 *
 * "Keep all as-is" is an INFIX -- the scope word lands between the verb
 * and its particle, so it cannot be composed by appending to
 * DECISION_ACTION_LABEL ("Keep as-is all" is not English). Encoding each
 * form explicitly is what keeps that from being rediscovered as a bug the
 * next time a bulk surface is added.
 */
export const DECISION_BULK_ALL_LABEL: Record<CandidateDecisionKind, string> = {
  Keep: "Keep all as-is",
  Rename: "Change all",
  Redact: "Redact all",
  Ignore: "Ignore all",
};

export const DECISION_BULK_SELECTED_LABEL: Record<CandidateDecisionKind, string> = {
  Keep: "Keep selected as-is",
  Rename: "Change selected",
  Redact: "Redact selected",
  Ignore: "Ignore selected",
};

/** Bulk label for a given scope -- `"all"` when the control acts on every
 *  remaining item, `"selected"` when it acts on a checked subset. */
export function decisionBulkLabel(kind: CandidateDecisionKind, scope: "all" | "selected"): string {
  return scope === "all" ? DECISION_BULK_ALL_LABEL[kind] : DECISION_BULK_SELECTED_LABEL[kind];
}

/**
 * The letter a decision pill carries.
 *
 * WHY A LETTER AND NOT A BARE CAPSULE. The color system's stated goal is
 * that a reviewer understands a page by scrolling it -- but red/green/blue
 * tints at this saturation are close to indistinguishable for the ~8% of
 * men with a red-green deficiency, so a wordless colored dot would make the
 * "more than one thing happened here" signal unreadable for them
 * specifically. One glyph restores it at effectively no visual cost, and it
 * also disambiguates the two blues (focus vs. Change) for everyone during
 * the period reviewers are still learning the palette.
 *
 * Derived from the DISPLAY vocabulary, not the durable kind: Rename's
 * letter is "C" because the reviewer reads that decision as "Change"
 * everywhere else (see this file's top comment). "K"/"C"/"R"/"I" are
 * mutually distinct, so no tie-breaking is needed.
 */
export const DECISION_PILL_LETTER: Record<CandidateDecisionKind, string> = {
  Keep: "K",
  Rename: "C",
  Redact: "R",
  Ignore: "I",
};

/**
 * The CSS class carrying a decision's hue. Sets `--decision-hue`,
 * `--decision-tint`, `--decision-tint-contrast` and `--decision-border`
 * (index.html); every surface that wants to wear a decision reads those
 * custom properties rather than naming the decision again in its own
 * selector.
 *
 * This one class replaced the row/action/cell map triplet: those three
 * differed only in which SURFACE they painted, which is now expressed by
 * combining this class with a surface class (`.decision-tinted` for a
 * filled row, `.item-schemed` for a container that cascades to its
 * children, `.group-action-active` for the solid button emphasis) instead
 * of by a third axis of per-decision class names.
 */
export function decisionClass(kind: CandidateDecisionKind): string {
  return DECISION_CLASS[kind];
}

const DECISION_CLASS: Record<CandidateDecisionKind, string> = {
  Keep: "decision-keep",
  Rename: "decision-rename",
  Redact: "decision-redact",
  Ignore: "decision-ignore",
};

/** Every decision class, precedence-ordered -- the exact set a surface may
 *  be wearing, for callers that need to strip whichever one is currently
 *  applied before applying another (the pending-editor preview does this).
 *  Derived from DECISION_PRECEDENCE so it cannot drift from the ordering. */
export const ALL_DECISION_CLASSES: readonly string[] = DECISION_PRECEDENCE.map((kind) => DECISION_CLASS[kind]);

/**
 * The full reviewer-facing sentence a card's decision state makes, for the
 * card's `title`/`aria-label`. The tint and pills are a visual shorthand
 * for exactly this, so screen-reader and hover users get the same content
 * rather than a degraded version of it.
 */
export function decisionSummaryDescription(summary: DecisionSummary): string {
  if (!summary.dominant) return "No decisions yet";
  const all = [summary.dominant, ...summary.additional].map(decisionDisplayLabel);
  if (all.length === 1) return `${all[0]}`;
  const last = all[all.length - 1]!;
  return `Contains ${all.slice(0, -1).join(", ")} and ${last} decisions`;
}
