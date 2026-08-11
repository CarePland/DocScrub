/**
 * person-evidence-gate.ts -- THE PROTECTION GATE for cross-candidate
 * interpretation (AG, 2026-08-10).
 *
 * ============================ THE INVARIANT ============================
 * Cross-candidate evidence may never overrule independent person evidence.
 * A candidate that anything in the pipeline recognised as a person is
 * excluded from cross-candidate interpretation ENTIRELY -- before any rule
 * is consulted, not weighed against one.
 * =======================================================================
 *
 * WHY A GATE AND NOT A WEIGHT. The failure this design must not have is a
 * plausible-looking aggregate quietly reclassifying a real name. Written as
 * disqualifiers, a single recognised name token is decisive and cannot be
 * outvoted by three structural observations. Written as weights, it could.
 * Same reasoning residualReviewGate.ts's five guards already record.
 *
 * WHY THE FACTS ARE PASSED IN. This module owns no dictionaries and reaches
 * no engine. Each fact below is a CONCLUSION some engine already published;
 * the caller assembles them. A gate that could reach back into the pipeline
 * would grow its own person classifier by increments.
 *
 * ------------------------------------------------------------------
 * THE TAXONOMY CORRECTION, ENFORCED HERE
 * ------------------------------------------------------------------
 * `email_address_evidence` and `signature_or_email_header_context` are
 * DELIBERATELY ABSENT from the qualifying set below, and their absence is
 * the point rather than an oversight.
 *
 * Both were classified as semantic person evidence in the first draft of the
 * interpretation contract and both were falsified by the live document:
 *
 *     Degree Planner       99   email_address_evidence, strong_name_structure
 *     Automate Approvals   88   signature_or_email_header_context, strong_name_structure
 *
 * Neither is a claim about the candidate; both are claims about its
 * NEIGHBOURHOOD, and in an email corpus proximity to an address or a
 * signature block is close to ambient. They are corroboration, not
 * qualification. See 20260810-cross-candidate-composition.md §1.1.
 *
 * If a future change adds either to this list, the verification suite fails
 * on purpose.
 */

/** Quality categories that constitute recognised NAME evidence. Same list
 *  ui/recommendations.ts's KNOWN_NAME_CATEGORIES uses, plus the last-first
 *  structure the quality engine emits, normalized on both sides. */
export const NAME_EVIDENCE_CATEGORIES: readonly string[] = [
  "known-personal-name-token",
  "known-first-name",
  "known-name-structure",
  "known-surname",
  "surname-given-structure",
  "initials-with-surname",
  /** The name/word collision class the pipeline already protects -- "Rose",
   *  "May", "Will", "Grace". Protective by construction. */
  "ambiguous-lexical-token",
];

/** Everything the gate is allowed to know about one candidate. A flat record
 *  of conclusions, deliberately -- see the module header. */
export interface PersonEvidenceFacts {
  candidateId: string;
  /** Quality categories already assigned upstream (kebab or snake). */
  qualityCategories: readonly string[];
  /** Quality positiveReasons -- carries `nearby_title`, which is NOT a
   *  category and which no category-based test can see. */
  positiveReasons: readonly string[];
  /** Contextual person-evidence rule ids that fired on ANY occurrence. */
  contextualRules: readonly string[];
  /**
   * True when this candidate is related by entity resolution to a partner
   * that is ITSELF person-evidenced. Computed by the caller, because a
   * proposal that corroborates only itself is not evidence -- the failure
   * the witness audit already found one layer down.
   */
  hasPersonEvidencedLinkage: boolean;
  /**
   * CENSUS NAME STRUCTURE (AG, 2026-08-10) -- true when
   * `censusNameEvidenceFor` reported anything other than `none`.
   *
   * STRUCTURE, NOT TOKEN MEMBERSHIP, and the difference is the measurement:
   *
   *     ANY attested token       protects 30/30 people AND 80/106 non-people
   *     Census NAME STRUCTURE    protects 28/30 people and  22/106 non-people
   *
   * The first variant would have cut the validated cross-candidate cleanup
   * from 65 removals to 11 -- it protects nearly everything, which is the
   * same as protecting nothing. The caller must pass the structural
   * predicate; passing token membership here would be a silent regression
   * that no type can catch, which is why the field is named for the claim
   * rather than for the source.
   *
   * ADDITIVE, never substitutive. Census does not replace the existing name
   * lexicon, surname/given structure, titles, anchors or linkage, even
   * though it was a strict superset on one witness population. One document
   * is not grounds for deleting a working evidence source.
   */
  hasCensusNameStructure: boolean;
}

const norm = (category: string): string => category.replace(/_/g, "-");

/**
 * Does this candidate carry INDEPENDENT person evidence?
 *
 * Returns the qualifying reasons rather than a boolean, so a diagnostic (and
 * an audit record) can say which protection fired rather than only that one
 * did. Empty means eligible for cross-candidate interpretation.
 */
export function personEvidenceReasons(facts: PersonEvidenceFacts): string[] {
  const reasons: string[] = [];
  const categories = facts.qualityCategories.map(norm);
  const positives = facts.positiveReasons.map(norm);

  for (const category of NAME_EVIDENCE_CATEGORIES) {
    if (categories.includes(category) || positives.includes(category)) {
      reasons.push(category);
    }
  }
  // `nearby_title` travels as a positiveReason and never as a category, so a
  // category-only test misses every titled name. Deviation #6 narrowed it to
  // the honorific that actually attaches, so it is trustworthy here.
  if (positives.includes("nearby-title")) reasons.push("nearby-title");

  // ANCHOR rules are identity claims -- "Jordan Lee, Director of Finance",
  // a signature block, a name beside its own address. USAGE rules are not:
  // they report a grammatical role, and the live witness audit showed them
  // firing on Academic Senate, Computer Science, San Diego and Word
  // Documents. Both protect here anyway: this gate's job is to be
  // conservative about people, and a false protection costs one unreviewed
  // reclassification while a false exclusion costs a person.
  for (const rule of facts.contextualRules) {
    if (rule.startsWith("anchor_")) reasons.push(`anchor:${rule.slice("anchor_".length)}`);
    else if (rule.startsWith("contextual_")) reasons.push(`contextual-usage:${rule.slice("contextual_".length)}`);
  }

  if (facts.hasPersonEvidencedLinkage) reasons.push("person-evidenced-linkage");
  if (facts.hasCensusNameStructure) reasons.push("census-name-structure");

  return [...new Set(reasons)];
}

/** Convenience: the id set `evaluateCrossCandidateEvidence` takes. */
export function personEvidencedCandidateIds(facts: readonly PersonEvidenceFacts[]): Set<string> {
  const protectedIds = new Set<string>();
  for (const f of facts) {
    if (personEvidenceReasons(f).length > 0) protectedIds.add(f.candidateId);
  }
  return protectedIds;
}
