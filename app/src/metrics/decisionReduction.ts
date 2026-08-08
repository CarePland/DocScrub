/**
 * decisionReduction.ts -- DECISION REDUCTION (AG, 2026-08-03), a permanent
 * product metric: how many distinct decisions this document requires,
 * compared with judging every detected occurrence individually.
 *
 *   decision units / covered occurrences = repeated decisions avoided
 *   162 / 2,486 = 2,324 avoided = 93% fewer decisions
 *
 * WHAT A DECISION UNIT IS (the definition everything else follows from):
 * one thing a review surface presents for judgment, together with the
 * document occurrences that judging it disposes of. It is NOT "an action
 * the reviewer has taken," and the difference is the whole design.
 *
 * A RUNNING TALLY OF COMPLETED WORK (AG, 2026-08-03, revising the same
 * day's first build). The global figures are computed over the units the
 * reviewer has RESOLVED so far, so they start at zero and climb, and land
 * exactly on the document's full reduction when review completes. The
 * local equations are computed over what REMAINS on that surface, which is
 * what Andrew's original wording asked for -- "the equation intentionally
 * begins with the actual remaining decisions, because that is the number
 * the reviewer owns."
 *
 * THE ANTI-GAMING PROPERTY, and why "decision unit" still matters. A bulk
 * or group action counts as THE UNITS IT DISPOSED OF, never as one act.
 * Deciding forty items one at a time and accepting all forty in a single
 * keystroke produce the IDENTICAL tally, because both resolved the same
 * forty units covering the same occurrences. The number therefore measures
 * COVERAGE, not technique: there is no way to make it climb faster by
 * reviewing more coarsely. Had it counted actions, bulk-accepting would
 * have moved it harder than careful work, which in a tool where a missed
 * occurrence is a disclosure is an incentive pointed the wrong way. The
 * equivalence is proven directly in
 * verify/decision-reduction-verification.ts ("bulk and individual review
 * produce identical tallies").
 *
 * WHERE THAT PROPERTY IS ENFORCED. Not here -- this module cannot see a
 * decision at all: ReviewSession is not among its inputs and is not
 * imported, and `decisionReduction()` is a pure fold over whatever units
 * it is handed. The running behavior lives entirely in WHICH UNITS EACH
 * CALLER SUPPLIES, which is exactly what the scope contract below is for.
 * That is why turning a static metric into a running one required no
 * change to the calculation: callers changed scope, and the anti-gaming
 * property falls out of counting units rather than acts.
 *
 * STILL NOT A PROGRESS METRIC, despite now moving. Extraction/Review/
 * Overall (ui/documentScores.ts) answer "how much is done." These answer
 * "how much repetitive review has been eliminated by the work done so
 * far" -- a leverage figure over completed work, whose percentage hovers
 * near its final value rather than climbing from 0% to 100%. The two are
 * separated visually wherever they appear together; see the
 * review-status strip's seam in ui/app.ts.
 *
 * SCOPE CONTRACT. Every figure is computed over a supplied scope and only
 * that scope. The input is a list of ReviewUnit -- deliberately NOT a list
 * of candidate ids, so that a surface whose unit is not a candidate (a
 * Group Check row; a future Selection Inspector grouping) is a first-class
 * caller rather than a special case. Callers that DO work in candidates
 * pass them directly: Candidate is structurally a ReviewUnit already.
 *
 * SCOPES MAY OVERLAP AND DO NOT SUM. The same candidate is a unit in Group
 * Check (as part of a merged group unit), in Type Check, and in Item
 * Check, so local figures on different stages describe overlapping slices
 * of the same document. They are each individually true about their own
 * surface and must never be presented added together or as parts of a
 * whole -- there is no UI in this feature that implies they sum.
 *
 * DECISION REUSE IS A SEPARATE CONCEPT, deliberately. A decision imported
 * from a prior review still counts as a decision unit: the document still
 * requires that decision, prior work merely already answered it. Decision
 * Reduction answers "how many distinct decisions does this document
 * require, and how much repetitive review has been eliminated"; Decision
 * Reuse answers "how many of those did earlier work resolve." Nothing in
 * this module reads DecisionReuse state, and reuse is never credited as
 * an extra unit of avoidance.
 *
 * Note the running tally DOES advance when prior decisions are imported,
 * because those units become resolved -- the repetitive review really was
 * eliminated, which is what the tally measures. That is the reuse being
 * reflected as completed work, not as a bonus: the units still sit in the
 * denominator exactly as they would had the reviewer decided them by
 * hand, so an imported document and a hand-reviewed one land on the same
 * final figure.
 *
 * Pure module, no DOM, no imports from app.ts -- unit-tested by
 * verify/decision-reduction-verification.ts, same convention as
 * workspaceMetrics.ts / documentScores.ts / itemCheckQuery.ts.
 */

import { formatPercentFigure } from "./percentDisplay.js";

/**
 * One thing the reviewer judges, plus the document occurrences judging it
 * disposes of.
 *
 * `id` identifies the unit WITHIN ITS SCOPE and is used to collapse
 * duplicates -- a scope assembled from overlapping sources counts a unit
 * once. `Candidate` (domain/DocumentModel.ts) satisfies this structurally,
 * so candidate-based surfaces need no adapter; `mergedUnit()` builds the
 * one-row-covers-many-candidates shape Group Check needs.
 */
export interface ReviewUnit {
  id: string;
  occurrenceIds: readonly string[];
}

export interface DecisionReduction {
  /** Distinct units in scope -- the decisions the reviewer owns here. */
  decisionUnitCount: number;
  /** Distinct occurrences those units cover. Deduplicated across units:
   *  an occurrence covered by two units is one place in the document and
   *  would have been read once, not twice. */
  occurrenceCount: number;
  /** occurrenceCount - decisionUnitCount, floored at 0 (see below). */
  avoidedDecisionCount: number;
  /**
   * avoidedDecisionCount / occurrenceCount as a percentage, 0-100.
   * DELIBERATELY UNROUNDED. 0 for an empty scope.
   *
   * Rounding here and again at the display would round twice, and the
   * spec's own headline example is exactly where that breaks: 2,324 /
   * 2,486 is 93.4835%, which is 93% to the whole percent the strip shows
   * -- but pre-rounding to one decimal gives 93.5%, and rounding THAT
   * gives 94%. Two defensible roundings chained produce a wrong answer.
   *
   * So the model carries the exact value and every surface rounds once,
   * from it, through formatFewerDecisionsPercent(). Callers should not
   * interpolate this number directly.
   */
  fewerDecisionPercent: number;
}

export const EMPTY_DECISION_REDUCTION: DecisionReduction = {
  decisionUnitCount: 0,
  occurrenceCount: 0,
  avoidedDecisionCount: 0,
  fewerDecisionPercent: 0,
};

/**
 * The one calculation. Every Decision Reduction figure in the product --
 * global strip, local focus areas, Consolidation reporting, and future
 * aggregate inspector groupings -- comes from this function; there is no
 * second implementation to drift from it.
 *
 * Tolerates null/undefined and a scope containing malformed units (missing
 * or non-array `occurrenceIds`, empty ids) by treating them as covering
 * nothing rather than throwing: this feeds a status strip that renders on
 * every keystroke-driven re-render, and a metric is never worth taking the
 * workspace down for.
 *
 * FLOOR AT ZERO: `avoidedDecisionCount` is clamped non-negative. With real
 * units it cannot go negative -- every candidate has at least one
 * occurrence, so units <= occurrences always holds -- but this module is
 * generic over any caller-supplied scope, and a negative "decisions
 * avoided" is not a number the product should ever be able to display.
 */
export function decisionReduction(scope: Iterable<ReviewUnit> | null | undefined): DecisionReduction {
  if (!scope) return EMPTY_DECISION_REDUCTION;

  const seenUnitIds = new Set<string>();
  const occurrenceIds = new Set<string>();
  let decisionUnitCount = 0;

  for (const unit of scope) {
    if (!unit) continue;
    // Units with an id collapse by id; an id-less unit still counts once
    // (it cannot be recognized as a duplicate, so it is taken at face
    // value rather than silently dropped).
    if (typeof unit.id === "string" && unit.id.length > 0) {
      if (seenUnitIds.has(unit.id)) continue;
      seenUnitIds.add(unit.id);
    }
    decisionUnitCount += 1;
    if (!Array.isArray(unit.occurrenceIds)) continue;
    for (const occurrenceId of unit.occurrenceIds) {
      if (typeof occurrenceId === "string" && occurrenceId.length > 0) occurrenceIds.add(occurrenceId);
    }
  }

  const occurrenceCount = occurrenceIds.size;
  if (occurrenceCount === 0) {
    return { decisionUnitCount, occurrenceCount: 0, avoidedDecisionCount: 0, fewerDecisionPercent: 0 };
  }
  const avoidedDecisionCount = Math.max(0, occurrenceCount - decisionUnitCount);
  return {
    decisionUnitCount,
    occurrenceCount,
    avoidedDecisionCount,
    fewerDecisionPercent: (100 * avoidedDecisionCount) / occurrenceCount,
  };
}

/**
 * The ONE place `fewerDecisionPercent` becomes text. Rounds once, from the
 * exact value -- see that field's own note for the double-rounding bug
 * this exists to prevent. `decimals` is 0 for the review-status strip
 * (whole percent, the number a reviewer builds intuition on) and 1 where a
 * report wants finer grain.
 *
 * 2026-08-06: the rounding itself moved to percentDisplay.ts, which adds
 * the `~` an endpoint needs -- `1 / 223` reduces by 99.55%, and a bare
 * "100%" there says "nothing left to review," which is false. This stays
 * the one place the figure becomes text; it simply no longer owns the
 * rounding rule, which is shared with the review-status scores. Existing
 * behavior away from the endpoints is byte-identical (see
 * verify/decision-reduction-verification.ts's rounding block, which
 * pins 93% / 66.7% / 85.7% / 99.9% / 0% unchanged).
 */
export function formatFewerDecisionsPercent(reduction: { fewerDecisionPercent: number }, decimals = 0): string {
  return formatPercentFigure(reduction.fewerDecisionPercent, decimals);
}

/**
 * Collapse several units into ONE unit covering the union of their
 * occurrences -- for a surface that presents a set of candidates as a
 * single row to judge. Group Check is the case today: the reviewer decides
 * a group, not its members individually, so the group is one decision unit
 * covering every member occurrence.
 *
 * Note this is what makes Group Check's local figure legitimately
 * different from Item Check's over the same candidates -- see the
 * overlap note in this file's header.
 */
export function mergedUnit(id: string, units: Iterable<ReviewUnit>): ReviewUnit {
  const occurrenceIds: string[] = [];
  const seen = new Set<string>();
  for (const unit of units) {
    if (!unit || !Array.isArray(unit.occurrenceIds)) continue;
    for (const occurrenceId of unit.occurrenceIds) {
      if (typeof occurrenceId !== "string" || occurrenceId.length === 0 || seen.has(occurrenceId)) continue;
      seen.add(occurrenceId);
      occurrenceIds.push(occurrenceId);
    }
  }
  return { id, occurrenceIds };
}

/**
 * Whether a local reduction figure is worth rendering at all, per
 * Andrew's three suppression rules: empty scope, decision units equal to
 * occurrences, or zero avoided.
 *
 * All three collapse to "there is nothing this scope avoided," which is
 * why they are one predicate rather than three checks scattered across
 * call sites. The case this exists for is the single-occurrence item:
 * "1 / 1 = 0 decisions avoided" is true, useless, and -- repeated down a
 * list of hundreds of rows -- actively noisy. A figure that appears only
 * where there is real reduction to report is a figure a reviewer learns
 * to trust.
 *
 * Deliberately NOT applied to the global strip metrics, which hold their
 * position in the chrome and read 0 honestly on a document with no
 * reduction to show, rather than having two of five metrics disappear.
 */
export function shouldDisplayReduction(reduction: DecisionReduction): boolean {
  return reduction.occurrenceCount > 0 && reduction.avoidedDecisionCount > 0;
}

/**
 * The local form: `23 / 418 = 395 decisions avoided`.
 *
 * Reviewer workload FIRST, per Andrew's instruction -- "the equation
 * intentionally begins with the actual remaining decisions, because that
 * is the number the reviewer owns." It reads as a sentence: 23 decisions
 * instead of 418 occurrences, and the final value states the reduction.
 *
 * Kept here, beside the calculation, so the wording and the model cannot
 * evolve apart, and so the future Selection Inspector renders its
 * groupings' figures through the same function rather than reproducing
 * the phrasing.
 */
export function formatReductionEquation(reduction: DecisionReduction): string {
  const n = (value: number): string => value.toLocaleString();
  return `${n(reduction.decisionUnitCount)} / ${n(reduction.occurrenceCount)} = ${n(reduction.avoidedDecisionCount)} decision${reduction.avoidedDecisionCount === 1 ? "" : "s"} avoided`;
}

/** The accessible/tooltip gloss shared by every surface that shows a
 *  reduction figure -- one sentence naming the comparison being made, so
 *  the number is never an unexplained ratio. */
export const REDUCTION_DESCRIPTION = "Compared with deciding on every detected occurrence individually.";
