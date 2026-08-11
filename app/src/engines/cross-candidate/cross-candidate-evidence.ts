/**
 * cross-candidate-evidence.ts -- the Cross-Candidate Composition pass
 * (AG, 2026-08-10; measured in `20260810-cross-candidate-composition.md`).
 *
 *     Detection -> Quality -> Contextual -> Entity Resolution
 *                                        -> CROSS-CANDIDATE -> Interpretation
 *
 * ═══ WHAT THIS OBSERVES, AND WHY IT IS NOT A DETECTOR ═══
 *
 * Every other evidence family in DocScrub asks a question about ONE candidate
 * and its own text or its own occurrences. This asks a question no engine has
 * ever asked: what does this candidate look like RELATIVE TO THE OTHER
 * CANDIDATES THE SAME DOCUMENT PRODUCED?
 *
 * A reviewer recognises `Grade Rosters` as a system term partly because the
 * same document also contains Grade Entry, Grade Posting Process, Grade
 * Rosters Closed/Created/Posted, Incomplete Grade and Grade Pro. Domain
 * vocabulary RECURS across unrelated phrases. Personal-name tokens do not --
 * when a name token recurs, it recurs across spellings of ONE person, and
 * that is a relationship EntityResolutionEngine already owns and the
 * protection gate below already reads.
 *
 * It detects nothing and suppresses nothing. It produces an evidence record
 * that an interpretation layer may consult, exactly as
 * contextual-person-evidence.ts does. The candidate keeps its detector
 * provenance; only what it is INTERPRETED AS can change.
 *
 * ═══ NO LEXICON, NO LIST, NO DOCUMENT-SPECIFIC ANYTHING ═══
 *
 * The index is built from whatever candidates the document produced. There is
 * no vocabulary here, nothing to maintain, and nothing tuned to any corpus.
 * The two integer thresholds are structural rather than fitted, and both were
 * measured before being chosen -- see the verification suite, which pins them
 * against the frozen witness set in both directions.
 *
 * ═══ WHAT WAS MEASURED, AND WHAT WAS REJECTED ═══
 *
 * Over the live 139-unit residue, with the protection gate applied first:
 *
 *   token recurrence >= 3     removes 54    54 known non-people   0 people lost
 *   head noun >= 2            removes 27    26 known non-people   0 people lost
 *   truncated variant         removes 12    12 known non-people   0 people lost
 *   ALL THREE                 removes 65    64 known non-people   0 people lost
 *
 * REJECTED and deliberately absent:
 *   - "every token is an ordinary English word" (R1). Removes more, and loses
 *     `Amy Miller`. A rule that removes the one name the witness set exists to
 *     protect is not a candidate for production at any removal count.
 *   - token recurrence >= 2. Measured safe on the residue and NOT adopted: the
 *     margin over a common given name is one candidate, and the residue is not
 *     the population it would run against.
 *
 * ═══ INDEX SCOPE IS LOAD-BEARING ═══
 *
 * The index MUST be built over every person-typed candidate in the document,
 * not over some already-narrowed subset. Narrowing the denominator to (say)
 * the Item Check residue would raise every share count, because the residue is
 * mostly non-people -- the rule would silently get more aggressive while
 * looking unchanged. Pinned by the verification suite.
 *
 * Pure and DOM-free.
 */

/** Minimum distinct multi-token candidates a token must appear in, INCLUSIVE
 *  of the candidate under test. 3 means "this token is used in at least two
 *  OTHER phrases in this document." */
export const TOKEN_RECURRENCE_MIN = 3;

/** Minimum distinct multi-token candidates sharing a final token. 2 means
 *  "at least one other phrase in this document ends in the same head noun." */
export const HEAD_NOUN_PARADIGM_MIN = 2;

export type CrossCandidateRuleId =
  /** A token of this phrase recurs across unrelated phrases -- domain vocabulary. */
  | "token_recurrence"
  /** Its head noun heads other phrases too -- a paradigm member (Date/Time/Code). */
  | "head_noun_paradigm"
  /** It is a proper prefix of a longer candidate -- a truncated or abbreviated variant. */
  | "truncated_variant";

export interface CrossCandidateEvidence {
  candidateId: string;
  /** Strongest first, in the fixed order above. Empty is never recorded. */
  rules: CrossCandidateRuleId[];
  /** Distinct multi-token candidates containing `sharedToken`, inclusive. */
  tokenShare: number;
  sharedToken?: string;
  /** The other candidates that produced `tokenShare` -- reviewer-facing. */
  sharedTokenWitnesses: string[];
  /** Distinct multi-token candidates ending in `headNoun`, inclusive. */
  headShare: number;
  headNoun?: string;
  headWitnesses: string[];
  /** The longer candidate this one is a proper prefix of. */
  truncationOf?: string;
}

export interface CrossCandidateEvidenceResult {
  schemaVersion: 1;
  byCandidate: Record<string, CrossCandidateEvidence>;
  /** Diagnostics: the index itself, for explainability and verification. */
  indexedCandidateCount: number;
}

/** The minimum this pass needs from a candidate. */
export interface CrossCandidateInput {
  id: string;
  displayValue: string;
  detectedType: string;
}

export interface CrossCandidateInputs {
  candidates: readonly CrossCandidateInput[];
  /**
   * THE PROTECTION GATE, applied by the CALLER and passed in as a conclusion.
   *
   * Deliberately not computed here: this module owns no view of the name
   * lexicon, contextual evidence, anchors, titles or entity relationships, and
   * a module that could reach them would grow its own person classifier by
   * increments -- the failure residualReviewGate.ts's header names. The caller
   * assembles the set from the engines that already own each question.
   *
   * A protected candidate is EXCLUDED FROM THE OUTPUT ENTIRELY, not merely
   * flagged, so no downstream consumer can accidentally read cross-candidate
   * evidence for a person-evidenced candidate.
   */
  personEvidencedCandidateIds: ReadonlySet<string>;
}

/** Whitespace/comma tokenization, lower-cased, punctuation stripped. Commas
 *  drop so "Goodloe, Andrew" contributes both tokens -- the same rule
 *  documentNameEvidence.ts's nameTokens() already uses. */
function tokensOf(displayValue: string): string[] {
  return displayValue
    .replace(/,/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase().replace(/[^\p{L}\p{M}'’-]/gu, ""))
    .filter((t) => t.length > 0);
}

export function emptyCrossCandidateEvidence(): CrossCandidateEvidenceResult {
  return { schemaVersion: 1, byCandidate: {}, indexedCandidateCount: 0 };
}

/**
 * Runs the pass. Pure: reads the candidate list, mutates nothing, and is
 * recomputed on every load like every other derived signal in this pipeline.
 *
 * SCOPE: person-typed candidates only. A cross-candidate question about email
 * addresses or phone numbers has no meaning -- the detector already knows
 * exactly what those are. Same deliberate narrowing contextual-person-evidence
 * and normalization both make.
 */
export function evaluateCrossCandidateEvidence(inputs: CrossCandidateInputs): CrossCandidateEvidenceResult {
  const personTyped = inputs.candidates.filter((c) => c.detectedType === "person");

  // ---- Build the index over EVERY person-typed candidate. Multi-token only:
  // a bare "Andrew" is a different observation, and relating it to "Goodloe,
  // Andrew" is entity resolution's job, not this pass's.
  const tokenIndex = new Map<string, Set<string>>();
  const headIndex = new Map<string, Set<string>>();
  const tokensById = new Map<string, string[]>();
  for (const candidate of personTyped) {
    const tokens = tokensOf(candidate.displayValue);
    tokensById.set(candidate.id, tokens);
    if (tokens.length < 2) continue;
    for (const token of new Set(tokens)) {
      const set = tokenIndex.get(token) ?? new Set<string>();
      set.add(candidate.displayValue);
      tokenIndex.set(token, set);
    }
    const head = tokens[tokens.length - 1]!;
    const headSet = headIndex.get(head) ?? new Set<string>();
    headSet.add(candidate.displayValue);
    headIndex.set(head, headSet);
  }

  // Longest-first, so `Term Withdra` reports the longest phrase it prefixes.
  const byLengthDesc = [...personTyped].sort((a, b) => b.displayValue.length - a.displayValue.length);

  const byCandidate: Record<string, CrossCandidateEvidence> = {};
  for (const candidate of personTyped) {
    if (inputs.personEvidencedCandidateIds.has(candidate.id)) continue;

    const tokens = tokensById.get(candidate.id) ?? [];
    if (tokens.length < 2) continue;

    let tokenShare = 0;
    let sharedToken: string | undefined;
    for (const token of new Set(tokens)) {
      const size = tokenIndex.get(token)?.size ?? 0;
      if (size > tokenShare) {
        tokenShare = size;
        sharedToken = token;
      }
    }
    const head = tokens[tokens.length - 1]!;
    const headShare = headIndex.get(head)?.size ?? 0;

    const self = candidate.displayValue.toLowerCase();
    const truncationOf = byLengthDesc.find(
      (other) => other.id !== candidate.id && other.displayValue.toLowerCase().startsWith(self) && other.displayValue.length > candidate.displayValue.length
    )?.displayValue;

    const rules: CrossCandidateRuleId[] = [];
    if (tokenShare >= TOKEN_RECURRENCE_MIN) rules.push("token_recurrence");
    if (headShare >= HEAD_NOUN_PARADIGM_MIN) rules.push("head_noun_paradigm");
    if (truncationOf !== undefined) rules.push("truncated_variant");
    if (rules.length === 0) continue;

    const sharedTokenWitnesses = sharedToken
      ? [...(tokenIndex.get(sharedToken) ?? [])].filter((v) => v !== candidate.displayValue)
      : [];
    const headWitnesses = [...(headIndex.get(head) ?? [])].filter((v) => v !== candidate.displayValue);

    byCandidate[candidate.id] = {
      candidateId: candidate.id,
      rules,
      tokenShare,
      ...(sharedToken !== undefined ? { sharedToken } : {}),
      sharedTokenWitnesses,
      headShare,
      headNoun: head,
      headWitnesses,
      ...(truncationOf !== undefined ? { truncationOf } : {}),
    };
  }

  return { schemaVersion: 1, byCandidate, indexedCandidateCount: personTyped.length };
}

/**
 * The reviewer-facing explanation. One sentence per rule, each an
 * independently checkable fact about this document -- the same explainability
 * contract semantic-augmentation.ts's evidence lines hold. No score appears
 * here, deliberately: an opaque number is exactly what this evidence exists to
 * replace.
 */
export function explainCrossCandidateEvidence(evidence: CrossCandidateEvidence): string[] {
  const lines: string[] = [];
  const sample = (values: string[]): string => values.slice(0, 4).map((v) => `"${v}"`).join(", ") + (values.length > 4 ? `, +${values.length - 4} more` : "");
  for (const rule of evidence.rules) {
    if (rule === "token_recurrence" && evidence.sharedToken) {
      lines.push(`The word "${evidence.sharedToken}" appears in ${evidence.tokenShare} different detected phrases in this document (${sample(evidence.sharedTokenWitnesses)}).`);
    }
    if (rule === "head_noun_paradigm" && evidence.headNoun) {
      lines.push(`${evidence.headShare} detected phrases in this document end in "${evidence.headNoun}" (${sample(evidence.headWitnesses)}).`);
    }
    if (rule === "truncated_variant" && evidence.truncationOf) {
      lines.push(`This is a shortened form of "${evidence.truncationOf}", which also appears in this document.`);
    }
  }
  return lines;
}
