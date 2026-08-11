/**
 * percentDisplay.ts -- the two display rules that keep a metric figure from
 * asserting more than it knows (AG, 2026-08-06).
 *
 * Both rules exist for the same reason and are deliberately kept together:
 * a figure in the status strip is read at a glance, out of the corner of
 * the eye, and the reviewer builds trust in the exact numbers beside it
 * from whether these ones ever turn out to have been lying.
 *
 * ------------------------------------------------------------------
 * RULE 1 -- ROUNDING MUST NOT REACH A BOUNDARY IT HAS NOT REACHED
 * ------------------------------------------------------------------
 *
 * Andrew, 2026-08-06, from live use: "I had 1/223, which rounds up to
 * 100%, but of course is not actually 100%."
 *
 * 0% and 100% are not ordinary values on this scale -- they are CLAIMS.
 * "100%" says *there is nothing left*, and a reviewer who reads it on a
 * completion figure will stop looking. 222 of 223 is 99.55%, and rounding
 * it to a bare "100%" converts a true measurement into a false statement
 * about the reviewer's remaining work. The same holds at the bottom: a
 * bare "0%" says *nothing has happened*, which is a different fact from
 * "something has, but not yet a whole percent of it."
 *
 * So the two endpoints are reserved for the exact values, and anything
 * that merely ROUNDS to them is marked with a tilde: `~100%`, `~0%`.
 * Every other value is unaffected -- 93% still reads "93%", because 93 is
 * a quantity, not a claim, and tildes everywhere would be noise that
 * stopped being read within a session.
 *
 * The rule is defined against the ROUNDED TEXT, not against a hardcoded
 * threshold, so it holds at any precision: at one decimal 99.9% is a
 * legitimate exact-looking figure and takes no tilde, while 99.96% renders
 * "~100.0%". A caller that changes its precision does not have to think
 * about this.
 *
 * ------------------------------------------------------------------
 * RULE 2 -- A FIGURE WITH NOTHING BEHIND IT SHOULD NOT LOOK LIKE A RESULT
 * ------------------------------------------------------------------
 *
 * Andrew, same instruction: "Any item that is at 0 because there is no
 * data gets a muted grey color."
 *
 * A fresh document renders every tracker figure as a confident black
 * zero -- typographically identical to a hard-won zero, and louder than
 * the muted percentages sitting beside it. Muting the resting state costs
 * nothing, removes the loudest thing in the strip at the moment the
 * reviewer has done the least, and gives the strip a visible "waking up"
 * as real numbers arrive.
 *
 * NOTE THE INTERACTION WITH RULE 1, WHICH IS WHY THESE SHARE A FILE: once
 * grey means "no data," a displayed "0%" MUST mean exactly zero, or grey
 * becomes ambiguous and stops being readable at a glance. Rule 1's `~0%`
 * is what preserves that -- it is not an independent nicety.
 *
 * Pure module, no DOM, no imports. Consumed by decisionReduction.ts's
 * formatFewerDecisionsPercent (the single place that figure becomes text)
 * and by the review-status strip and Decision Tracker in ui/app.ts.
 */

/**
 * A percentage as display text, with `~` where rounding would otherwise
 * assert an endpoint the value has not reached.
 *
 * `value` is a percentage in 0-100 (NOT a 0-1 fraction), matching what
 * every existing caller already holds. Non-finite input renders as an
 * exact "0%" rather than "NaN%": this feeds a strip that re-renders on
 * every keystroke, and a metric is never worth a visible failure.
 */
export function formatPercentFigure(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return "0%";
  const bounded = Math.min(100, Math.max(0, value));
  const text = bounded.toFixed(decimals);
  const rounded = Number(text);
  // Compared against the rounded TEXT so this holds at any precision --
  // see RULE 1. `bounded`, not `value`, so a caller passing 100.0000001
  // through floating-point arithmetic still reads a clean "100%".
  const overstates = rounded === 100 && bounded < 100;
  const understates = rounded === 0 && bounded > 0;
  return `${overstates || understates ? "~" : ""}${text}%`;
}

/**
 * Whether a figure is at its resting value -- zero, with nothing yet
 * behind it -- and should therefore be muted rather than drawn as a
 * result. See RULE 2.
 *
 * Deliberately a plain `=== 0` test rather than a "was there input?"
 * question. Every figure this governs (decisions made, occurrences
 * avoided, percent fewer, time avoided) is a running tally from zero, so
 * for these, zero IS the no-data state -- and Rule 1 guarantees that a
 * displayed zero is never a rounded-down non-zero. A future figure whose
 * zero is a real, earned result must not use this helper.
 */
export function isRestingFigure(value: number): boolean {
  return !Number.isFinite(value) || value === 0;
}
