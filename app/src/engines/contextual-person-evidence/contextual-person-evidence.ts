/**
 * contextual-person-evidence.ts -- the Contextual Person Evidence pass
 * (AG, 2026-08-05).
 *
 *     Detection -> CONTEXTUAL PERSON EVIDENCE -> Quality -> Normalization -> ...
 *
 * PURPOSE. The lexical layer decides whether a candidate is SPELLED like a
 * person. This pass decides whether the document TREATS it like one. A
 * human reviewer uses both, and weights the second heavily -- "Casey, could
 * you review this?" settles the question regardless of what Casey is
 * otherwise a word for. Until now the detector had no way to say that.
 *
 * ═══ WHY THIS IS A SEPARATE PASS AND NOT AN EDIT TO scoring.ts ═══
 *
 * engines/quality/scoring.ts declares itself a faithful port of
 * redactor/candidate_quality.py, and verify/quality-parity.ts diffs its exact
 * score, exact status, exact quality label and exact `reasons` ARRAY against
 * Python's own export across every domain-parity fixture. A new rule family
 * living inside that file would break those diffs on any fixture whose text
 * happens to contain a greeting or an approval -- and, worse, would make the
 * port's stated philosophy ("nothing here improves on Python's scoring
 * logic -- that would be a redesign, not a migration") false.
 *
 * So this pass follows the normalization.ts precedent exactly: TS-only,
 * additive, module-owned lexicons, its own verification suite, and composed
 * INTO the ported scorer through an optional parameter that defaults to
 * "no contextual evidence". With that default, scoreCandidateQuality() is
 * byte-identical to what it was, and quality-parity.ts keeps testing the
 * untouched port. Not one fixture needed a disclosed deviation.
 *
 * ═══ THE COMBINATION MODEL, AND WHY IT IS NOT A SUM ═══
 *
 * (Andrew's decision, 2026-08-05: capped family with diminishing returns.)
 *
 * The score is `35 + Σweights`, clamped 1..99, To Review at 25, Strong at 80.
 * The strongest lexical signals in the whole system are surname_given_
 * structure (+50), initials_with_surname (+42) and nearby_title (+40). Adding
 * seven contextual rules worth +24..+40 each as free addends would put three
 * hits on a bare first name at 35+100 = clamped 99 -- tied with "Jordan Lee,
 * Director of Finance", and tied with each other. The score would stop
 * ranking anything at the top of the queue, which is precisely where a
 * reviewer needs it to rank.
 *
 * The deeper reason is that these signals are NOT independent. "Jordan
 * said...", "Jordan approved it" and "Jordan's office" are three observations
 * of ONE fact: this token is being used as a person. Summing correlated
 * evidence double-counts it. So the family combines the way correlated
 * evidence should:
 *
 *     strongest + 0.4·second + 0.2·third + 0.1·each remaining,
 *     then capped at CONTEXTUAL_CONTRIBUTION_CAP.
 *
 * ONE cap across BOTH families, not one per family. With base 35, the cap of
 * +55 means a candidate carrying maximal contextual and anchor evidence but
 * ZERO lexical name evidence reaches 90 -- "Strong". That is the correct
 * answer: a signature block with a role line really is strong evidence, even
 * for a name no lexicon has ever seen, which is the entire point of building
 * this. It also means contextual evidence can never clamp the scale by
 * itself, so lexical evidence still discriminates above it.
 *
 * ═══ WHAT THIS PASS DELIBERATELY DOES NOT DO ═══
 *
 * No document-wide entity resolution. Evidence unions across the occurrences
 * of ONE candidate -- which, because a Candidate's id IS its normalized key
 * (DetectionEngine.normalizeCandidate: "type:normalized text"), is exactly
 * Andrew's "union only for identical normalized candidates". A standalone
 * "Jordan" never inherits anything from a "Jordan Lee" elsewhere in the
 * document, and cannot: nothing here can reach another candidate's
 * occurrences. Same exact-key-only discipline EntityResolutionEngine holds.
 *
 * Contradictory uses stay visible. The result records evidence PER
 * OCCURRENCE and reports how many occurrences carried none, so a word used
 * as a person twice and as a month forty times reads as exactly that in
 * Expert View rather than being flattened into one confident number.
 */

import type { DetectionResult } from "../DetectionEngine.js";
import type { DocumentModel, Occurrence } from "../../domain/DocumentModel.js";
import { buildAnchorContext, evaluateOccurrenceAnchors, type AnchorRuleId } from "./anchor-rules.js";
import { evaluateOccurrenceContext, type ContextualRuleId } from "./contextual-rules.js";

export type ContextualEvidenceRuleId = ContextualRuleId | AnchorRuleId;

/**
 * Per-rule base weights, before combination. These are NOT what reaches the
 * score -- combineContextualWeights() below does, and its output is a single
 * figure. They are the relative strengths that decide which signal leads.
 *
 * Anchor rules outrank every usage rule because they are a different kind of
 * claim: the document identifying the person, rather than the document using
 * the word as one.
 */
export const CONTEXTUAL_RULE_WEIGHTS: Readonly<Record<ContextualEvidenceRuleId, number>> = {
  anchor_full_name_with_role: 50,
  anchor_signature_block: 48,
  anchor_name_with_email: 42,
  anchor_full_name_with_organization: 40,
  contextual_direct_address: 40,
  contextual_attribution: 40,
  contextual_coordination: 34,
  contextual_person_list: 32,
  contextual_possessive: 30,
  contextual_human_subject: 30,
  contextual_human_object: 24,
};

/** Fixed display/combination order: strongest first, anchors before usages.
 *  Derived from the weights table rather than restated, so the two can never
 *  disagree. */
const RULE_ORDER: ContextualEvidenceRuleId[] = (
  Object.keys(CONTEXTUAL_RULE_WEIGHTS) as ContextualEvidenceRuleId[]
).sort((a, b) => CONTEXTUAL_RULE_WEIGHTS[b] - CONTEXTUAL_RULE_WEIGHTS[a]);

/** See the combination-model note in this file's header for the reasoning.
 *  +55 on a base of 35 puts maximal contextual evidence at "Strong" without
 *  clamping the scale. */
export const CONTEXTUAL_CONTRIBUTION_CAP = 55;

/** Diminishing multipliers applied to the 2nd, 3rd, and every subsequent
 *  signal. Correlated evidence, not independent evidence. */
const DIMINISHING_FACTORS = [1, 0.4, 0.2];
const TAIL_FACTOR = 0.1;

/**
 * The single rule id that reaches the score and the evidence panel.
 *
 * ONE CHIP, NOT ELEVEN. The evidence panel's contract is that the displayed
 * weights sum to the score (see docs/../20260804-evidence-chip-reference.md:
 * "the weight is the number of points the rule contributes"). A capped,
 * diminishing family cannot honour that contract if each member is rendered
 * with its own base weight -- the column would sum to +140 beside a score
 * that moved by 55. Rendering the members at their DISCOUNTED values instead
 * would be honest arithmetic and unreadable evidence ("Possessive form, +6").
 *
 * So the family contributes one weighted chip carrying the combined figure,
 * and the individual usages travel to the reviewer as prose in the
 * explanation, next to the representative example that shows them. That is
 * also the better reviewer experience: eleven new chips on a 55-chip panel
 * costs attention, while "Used as a person (+38) — Jordan Lee, Director of
 * Finance" answers the question being asked.
 */
export const CONTEXTUAL_EVIDENCE_RULE = "contextual_person_evidence";

/**
 * Minimum combined contribution at which contextual evidence is allowed to
 * satisfy Normalization's name-evidence gate (Andrew's decision, 2026-08-05:
 * contextual evidence counts for gate 3).
 *
 * WHY A THRESHOLD RATHER THAN MERE PRESENCE. Gate 3 is the check that stops
 * "May Session" collapsing into "May" -- the Frankenstein-identity class
 * documented at length in normalization.ts. Letting ANY contextual hit
 * satisfy it would mean one weak reading ("Contact May") re-opens that merge
 * for the whole document. At 30, a single human_object hit (24) is not
 * enough on its own, while any single strong usage or any anchor is. The
 * gate keeps its teeth and still gains the evidence Andrew asked it to see.
 */
export const GATE_3_CONTEXTUAL_THRESHOLD = 30;

/**
 * The correlated-evidence combination described in this file's header.
 * Exported for the verification suite, which asserts the curve directly
 * rather than inferring it from scores.
 */
export function combineContextualWeights(rules: readonly ContextualEvidenceRuleId[]): number {
  if (rules.length === 0) return 0;
  const weights = rules.map((r) => CONTEXTUAL_RULE_WEIGHTS[r]).sort((a, b) => b - a);
  let total = 0;
  weights.forEach((weight, index) => {
    total += weight * (DIMINISHING_FACTORS[index] ?? TAIL_FACTOR);
  });
  return Math.min(CONTEXTUAL_CONTRIBUTION_CAP, Math.round(total));
}

export interface OccurrenceContextualEvidence {
  occurrenceId: string;
  rules: ContextualEvidenceRuleId[];
  /** This occurrence's own combined strength -- what the representative
   *  selection compares. Not additive with any other occurrence's. */
  strength: number;
}

export interface CandidateContextualEvidence {
  candidateId: string;
  /** Union across this candidate's occurrences, strongest first. */
  rules: ContextualEvidenceRuleId[];
  /** The capped, combined figure that reaches the score. */
  contribution: number;
  /**
   * The occurrence that most clearly establishes this candidate as a person
   * -- the one a reviewer should be shown. Null when no occurrence carried
   * any contextual evidence.
   */
  representative: OccurrenceContextualEvidence | null;
  /** Every occurrence that carried evidence, document order. */
  perOccurrence: OccurrenceContextualEvidence[];
  /**
   * Occurrences that carried NO contextual evidence at all. Kept because a
   * strong anchor must not erase the fact that the same word is used
   * differently elsewhere (Andrew's design principle) -- Expert View reads
   * this to say "2 of 46 occurrences read as a person".
   */
  occurrencesWithoutEvidence: number;
}

export interface ContextualPersonEvidenceResult {
  schemaVersion: 1;
  byCandidate: Record<string, CandidateContextualEvidence>;
}

export function emptyContextualPersonEvidence(): ContextualPersonEvidenceResult {
  return { schemaVersion: 1, byCandidate: {} };
}

/**
 * Runs the pass. Pure: reads the document and the detection stream, mutates
 * neither, and is recomputed on every load like every other derived signal
 * in this pipeline (nothing here is persisted).
 *
 * SCOPE: person candidates only. An email address or a phone number has no
 * grammatical role worth reading -- the detector already knows exactly what
 * it is -- so running these rules over them could only ever manufacture
 * noise. Same deliberate, disclosed narrowing normalization.ts makes, for
 * the same reason.
 */
export function evaluateContextualPersonEvidence(
  document: DocumentModel,
  detection: DetectionResult
): ContextualPersonEvidenceResult {
  const anchorContext = buildAnchorContext(document);

  const personCandidateIds = new Set(
    detection.candidates.filter((c) => c.detectedType === "person").map((c) => c.id)
  );

  const occurrencesByCandidate = new Map<string, Occurrence[]>();
  for (const occurrence of detection.occurrences) {
    if (!personCandidateIds.has(occurrence.candidateId)) continue;
    const existing = occurrencesByCandidate.get(occurrence.candidateId);
    if (existing) existing.push(occurrence);
    else occurrencesByCandidate.set(occurrence.candidateId, [occurrence]);
  }

  const byCandidate: Record<string, CandidateContextualEvidence> = {};

  for (const [candidateId, occurrences] of occurrencesByCandidate) {
    const perOccurrence: OccurrenceContextualEvidence[] = [];
    const union = new Set<ContextualEvidenceRuleId>();
    let withoutEvidence = 0;

    for (const occurrence of occurrences) {
      const rules: ContextualEvidenceRuleId[] = [
        ...evaluateOccurrenceAnchors(occurrence, anchorContext),
        ...evaluateOccurrenceContext(occurrence.context),
      ];
      if (rules.length === 0) {
        withoutEvidence++;
        continue;
      }
      const ordered = orderRules(rules);
      for (const rule of ordered) union.add(rule);
      perOccurrence.push({
        occurrenceId: occurrence.id,
        rules: ordered,
        strength: combineContextualWeights(ordered),
      });
    }

    if (perOccurrence.length === 0) {
      // Recorded anyway, with a zero contribution: "we looked and found
      // nothing" is a different, more useful statement to a reviewer than
      // the absence of a record, and it costs one object per candidate.
      byCandidate[candidateId] = {
        candidateId,
        rules: [],
        contribution: 0,
        representative: null,
        perOccurrence: [],
        occurrencesWithoutEvidence: withoutEvidence,
      };
      continue;
    }

    const unionRules = orderRules([...union]);
    byCandidate[candidateId] = {
      candidateId,
      rules: unionRules,
      contribution: combineContextualWeights(unionRules),
      representative: selectRepresentative(perOccurrence),
      perOccurrence,
      occurrencesWithoutEvidence: withoutEvidence,
    };
  }

  return { schemaVersion: 1, byCandidate };
}

function orderRules(rules: readonly ContextualEvidenceRuleId[]): ContextualEvidenceRuleId[] {
  const present = new Set(rules);
  return RULE_ORDER.filter((rule) => present.has(rule));
}

/**
 * Representative example selection -- the second pass Andrew specified.
 *
 * The occurrence that most clearly establishes personhood, by:
 *   1. carrying anchor evidence at all (an identification beats any number
 *      of usages -- it is what a reviewer would quote),
 *   2. then combined strength,
 *   3. then document order, so the choice is deterministic and the reviewer
 *      is shown the FIRST clearest example rather than an arbitrary one.
 *
 * NOTE ON WHAT THIS DOES AND DOES NOT MOVE. Every occurrence-scanning helper
 * in the ported scorer already uses "any occurrence matches" semantics, which
 * is a max across occurrences -- so selecting a strongest occurrence changes
 * almost no scoring outcome by itself. Its real value is choosing what the
 * reviewer SEES: the evidence quote, the explanation, and the confidence
 * rationale. That is the honest description of this layer, and it is worth
 * building for that alone.
 */
function selectRepresentative(
  perOccurrence: readonly OccurrenceContextualEvidence[]
): OccurrenceContextualEvidence | null {
  let best: OccurrenceContextualEvidence | null = null;
  let bestKey: [number, number] = [-1, -1];
  for (const entry of perOccurrence) {
    const key: [number, number] = [entry.rules.some(isAnchorRule) ? 1 : 0, entry.strength];
    if (key[0] > bestKey[0] || (key[0] === bestKey[0] && key[1] > bestKey[1])) {
      best = entry;
      bestKey = key;
    }
  }
  return best;
}

export function isAnchorRule(rule: ContextualEvidenceRuleId): rule is AnchorRuleId {
  return rule.startsWith("anchor_");
}
