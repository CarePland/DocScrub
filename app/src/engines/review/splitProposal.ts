/**
 * splitProposal.ts -- where DocScrub thinks a merged review unit divides
 * (AG, 2026-08-10).
 *
 * ═══════════════════ A PROPOSAL, NEVER A MUTATION ═══════════════════
 *
 * Nothing here changes a candidate. It returns boundaries the reviewer may
 * accept, edit or ignore, plus the ids of the rules that suggested each one so
 * the audit can say WHY a boundary was preselected.
 *
 * The product principle this serves: the reviewer should not be doing QA for
 * DocScrub's extractor. A good proposal means one keystroke to confirm; a bad
 * proposal costs one click to correct. Neither is allowed to cost a wrong
 * split, because nothing is applied without confirmation.
 *
 * ═══════════════════ DETERMINISTIC, LOCAL, NO INFERENCE ═══════════════════
 *
 * Every rule reads either the separator text (punctuation and conjunctions,
 * which are facts about the string) or evidence some engine already computed
 * and passed in. There is no model, no probability, no network, and no
 * dictionary owned by this module.
 *
 * ═══════════════════ WHY EVIDENCE IS INJECTED ═══════════════════
 *
 * `tokenIsNameAttested` is supplied by the caller rather than looked up here.
 * Same discipline as the protection gate and the residual-review gate: a
 * module that could reach the Census index would grow its own classifier by
 * increments, and this one must stay a structural helper. It is also what
 * keeps the module honest about generality -- it never asks "is this a
 * person", only "did something upstream attest this token", and a caller that
 * passes nothing still gets punctuation-based proposals.
 *
 * ═══════════════════ NOT A PERSON SPLITTER ═══════════════════
 *
 * `Admissions / Registrar` and `HR and Payroll` are proposed by exactly the
 * same rules as `Chris, Margaret`. Names are the motivating witness, not the
 * scope: the strongest rule here is punctuation, which knows nothing about
 * people.
 *
 * Pure, DOM-free, deterministic.
 */

import type { SplitBoundaries, SplitDecomposition } from "../../domain/CandidateSplit.js";

/** Stable rule ids. These are the ONLY strings the telemetry seam is allowed
 *  to carry, which is why they are an explicit union rather than free text. */
export type SplitProposalRuleId =
  /** The separator contains list punctuation: comma, semicolon, slash,
   *  ampersand, plus, pipe. */
  | "split-proposal/dividing-punctuation"
  /** The separator contains a coordinating word (`and`, `or`, ...). */
  | "split-proposal/coordinating-conjunction"
  /** Both sides of the boundary carry independent name attestation supplied
   *  by the caller. Structural corroboration, not a person claim. */
  | "split-proposal/attested-on-both-sides";

export const SPLIT_PROPOSAL_RULE_IDS: readonly SplitProposalRuleId[] = [
  "split-proposal/dividing-punctuation",
  "split-proposal/coordinating-conjunction",
  "split-proposal/attested-on-both-sides",
];

export interface SplitProposalInputs {
  decomposition: SplitDecomposition;
  /**
   * Did some upstream engine attest this token as a name form? Optional; when
   * absent, the attestation rule simply never fires and punctuation rules
   * still work. Index is into `decomposition.tokens`.
   */
  tokenIsNameAttested?: (tokenIndex: number) => boolean;
}

export interface SplitProposal {
  /** Boundaries to preselect, sorted. Empty means "no suggestion" -- which is
   *  a legitimate answer and must not be read as "do not split". */
  boundaries: SplitBoundaries;
  /** Which rules fired, deduplicated, in declaration order. */
  ruleIds: readonly SplitProposalRuleId[];
  /** Per-boundary detail, so the UI can explain a preselection. */
  reasons: ReadonlyArray<{ boundaryIndex: number; ruleIds: readonly SplitProposalRuleId[] }>;
}

const EMPTY: SplitProposal = { boundaries: [], ruleIds: [], reasons: [] };

/**
 * Propose boundaries for one candidate.
 *
 * ═══════ THE ONE DELIBERATE ASYMMETRY ═══════
 *
 * Punctuation and conjunctions propose on their own. Name attestation does
 * NOT: `attested-on-both-sides` only reinforces a boundary that already has a
 * separator reason, and never creates one by itself.
 *
 * The reason is `Smith Jones Brown`. Every token there is plausibly
 * name-attested, so an attestation-only rule would preselect BOTH boundaries
 * and confidently propose three people -- when the value may equally be one
 * person with two surnames, or two people. Whitespace alone is not evidence
 * of division, and proposing as though it were would put the reviewer back to
 * correcting DocScrub rather than deciding.
 *
 * So `Smith Jones Brown` opens with NO boundary preselected and every boundary
 * available. That is the honest state: the mechanism supports the split, the
 * engine does not claim to know where it goes.
 */
export function proposeSplit(inputs: SplitProposalInputs): SplitProposal {
  const { decomposition } = inputs;
  const tokenCount = decomposition.tokens.length;
  if (tokenCount < 2) return EMPTY;

  const reasons: Array<{ boundaryIndex: number; ruleIds: SplitProposalRuleId[] }> = [];

  for (let boundaryIndex = 0; boundaryIndex < tokenCount - 1; boundaryIndex += 1) {
    const separator = decomposition.separators[boundaryIndex];
    if (!separator) continue;
    const ruleIds: SplitProposalRuleId[] = [];

    if (separator.hasDividingPunctuation) ruleIds.push("split-proposal/dividing-punctuation");
    if (separator.conjunction !== null) ruleIds.push("split-proposal/coordinating-conjunction");

    /* Corroboration only -- see the asymmetry note above. */
    if (ruleIds.length > 0 && inputs.tokenIsNameAttested) {
      const leftAttested = inputs.tokenIsNameAttested(boundaryIndex);
      const rightAttested = inputs.tokenIsNameAttested(boundaryIndex + 1);
      if (leftAttested && rightAttested) ruleIds.push("split-proposal/attested-on-both-sides");
    }

    if (ruleIds.length > 0) reasons.push({ boundaryIndex, ruleIds });
  }

  if (reasons.length === 0) return EMPTY;

  const firedIds = new Set<SplitProposalRuleId>();
  for (const reason of reasons) for (const id of reason.ruleIds) firedIds.add(id);

  return {
    boundaries: reasons.map((r) => r.boundaryIndex),
    ruleIds: SPLIT_PROPOSAL_RULE_IDS.filter((id) => firedIds.has(id)),
    reasons,
  };
}

/**
 * Is this candidate worth offering the Separate action for at all?
 *
 * Purely structural: more than one token. A one-token candidate has no
 * boundary and the action would be dead. Note this deliberately does NOT
 * require a proposal -- `Smith Jones Brown` gets no proposal and must still
 * be splittable by hand, which is the whole point of user-placed boundaries.
 */
export function canOfferSplit(decomposition: SplitDecomposition): boolean {
  return decomposition.tokens.length >= 2;
}
