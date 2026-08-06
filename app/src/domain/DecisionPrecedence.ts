/**
 * DecisionPrecedence.ts -- UNIFIED DECISION COLOR SYSTEM (AG, 2026-08-03).
 * The single precedence order over `CandidateDecisionKind`, plus the one
 * derivation that answers "what decisions does this card contain, and
 * which one speaks for it."
 *
 * WHY THIS LIVES IN `domain/` RATHER THAN `ui/`. The rule it encodes is a
 * statement about decisions, not about pixels: given a set of decisions,
 * which one has the greatest consequence for the output document. Both
 * layers need that answer -- `engines/review/coverage.ts`'s
 * `groupDisplayDecision()` (what a group "came out as") and the UI's card
 * tint/pills. Putting it here lets the engine call it without an engine
 * -> ui import, which the layering forbids. `ui/decisionLabels.ts` owns
 * the presentation half (display label, pill letter, CSS class); this file
 * owns none of it and imports no DOM.
 *
 * THE ORDER, AND WHY. Redact > Rename > Keep > Ignore, ordered by how much
 * the decision changes the document that leaves the building:
 *   - Redact removes text outright -- the most consequential, least
 *     recoverable outcome, and the one a reviewer most needs to see from
 *     across a scrolling page.
 *   - Rename ("Change" to the reviewer -- see decisionLabels.ts on why the
 *     durable kind keeps the old word) substitutes text: the document
 *     changes, but nothing is lost.
 *   - Keep leaves the text alone while still affirming the entity is real.
 *   - Ignore leaves the text alone AND revokes the entity -- see
 *     ReviewSession.ts's `isPositiveAcknowledgement()`, where Keep/Rename/
 *     Redact confirm an entity and Ignore alone denies one. It is the only
 *     decision that asserts "there was never anything here," so it ranks
 *     last among decisions that were actually made.
 *
 * `Undecided` is deliberately NOT a member of this order. It is the
 * absence of a decision, not a fourth peer: precedence applies over the
 * decisions PRESENT on a card, and a card with none present is undecided.
 * Stating it that way removes an otherwise real ambiguity -- one untouched
 * member does NOT drag a partly-decided card back to neutral.
 *
 * Exhaustive by construction: DECISION_PRECEDENCE is typed such that
 * omitting a `CandidateDecisionKind` is a compile error, so a fifth
 * decision cannot be added without someone deciding where it ranks.
 */

import type { CandidateDecisionKind } from "./ReviewSession.js";

/**
 * Every decision kind, most consequential first. The ONE ordering; every
 * dominant-decision and pill-ordering question in the application resolves
 * through this array rather than re-stating the sequence locally.
 *
 * The tuple type (rather than a bare array) is what makes this exhaustive:
 * TypeScript rejects the initializer if any `CandidateDecisionKind` is
 * missing or duplicated, so `CandidateDecisionKind` gaining a fifth member
 * breaks the build here first -- exactly where the ranking decision has to
 * be made.
 */
export const DECISION_PRECEDENCE = ["Redact", "Rename", "Keep", "Ignore"] as const satisfies readonly CandidateDecisionKind[];

/** Compile-time proof that DECISION_PRECEDENCE covers the whole union --
 *  `satisfies` above checks that every ENTRY is a valid kind, this checks
 *  the other direction (that every KIND appears). Together they make the
 *  array a total, duplicate-free ordering. Type-only; erased at runtime. */
type PrecedenceCoversEveryKind = Exclude<CandidateDecisionKind, (typeof DECISION_PRECEDENCE)[number]> extends never ? true : never;
const _precedenceIsExhaustive: PrecedenceCoversEveryKind = true;
void _precedenceIsExhaustive;

/** Rank of a decision, 0 = highest precedence. Lower wins. */
export function decisionRank(kind: CandidateDecisionKind): number {
  return DECISION_PRECEDENCE.indexOf(kind);
}

/**
 * What a card contains. `dominant` is the highest-precedence decision
 * present -- the one the card's background tint speaks -- and is null only
 * when nothing on the card has been decided at all. `additional` is every
 * OTHER distinct decision present, already in precedence order, which is
 * exactly what the pills render.
 *
 * `additional` deliberately excludes `dominant` rather than repeating it:
 * a single-decision card then produces zero pills, so the presence of ANY
 * pill means "more than one thing happened here." That signal economy is
 * the whole point -- a badge that appears on every card communicates
 * nothing.
 */
export interface DecisionSummary {
  readonly dominant: CandidateDecisionKind | null;
  readonly additional: readonly CandidateDecisionKind[];
}

/** The summary of a card with nothing decided on it. Shared frozen
 *  instance -- this is by far the most common result (most cards start
 *  here) and callers only ever read it. */
export const UNDECIDED_SUMMARY: DecisionSummary = Object.freeze({ dominant: null, additional: Object.freeze([]) as readonly CandidateDecisionKind[] });

/**
 * Derive a card's decision summary from its members' decisions, fresh.
 *
 * Accepts nulls/undefined for undecided members so callers can map
 * straight off `session.candidateDecisions[id]?.decision` without
 * pre-filtering. Duplicates collapse: a card with four Keeps and one
 * Redact summarizes identically to one with one of each, because the tint
 * and pills answer "which decisions are present," not "how many."
 *
 * Derived, never stored -- per this repo's standing "derive, don't
 * duplicate" rule, and for the same reason `groupDisplayDecision()` reads
 * member decisions fresh on every call: a cached summary is one more thing
 * that can silently disagree with the decisions it claims to describe.
 */
export function decisionSummary(decisions: Iterable<CandidateDecisionKind | null | undefined>): DecisionSummary {
  const present = new Set<CandidateDecisionKind>();
  for (const decision of decisions) {
    if (decision) present.add(decision);
  }
  if (present.size === 0) return UNDECIDED_SUMMARY;
  const ordered = DECISION_PRECEDENCE.filter((kind) => present.has(kind));
  const [dominant, ...additional] = ordered;
  return { dominant: dominant ?? null, additional };
}

/** True when a card carries more than one distinct decision -- i.e. it
 *  will render pills. Named so call sites read as intent rather than as an
 *  incidental length check. */
export function isMixedDecision(summary: DecisionSummary): boolean {
  return summary.additional.length > 0;
}
