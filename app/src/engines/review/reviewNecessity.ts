/**
 * reviewNecessity.ts -- does a human decision still remain on this candidate?
 * (AG, 2026-08-10)
 *
 * ═══════════════════ WHAT `Unlikely` MEANS, AND WHAT IT DOES NOT ═══════════════════
 *
 *     DocScrub currently has an affirmative non-sensitive explanation for
 *     this candidate, and no affirmative privacy-relevant reading.
 *
 * That is the whole claim. It is deliberately WEAKER than every neighbouring
 * concept in this codebase, and the vocabulary matters:
 *
 *   NOT a semantic type      -- `SemanticTypeId` is untouched; Type Check
 *                               routing is untouched.
 *   NOT an Ignore decision   -- no `CandidateDecision` is created.
 *   NOT AutomaticResolution  -- no rule fires, nothing is resolved, the audit
 *                               record is unchanged.
 *   NOT deletion             -- the candidate stays fully present in
 *                               application state, in the audit, in entity
 *                               resolution and in the exported document.
 *   NOT "safe"               -- and the word does not appear in this module or
 *                               its UI copy, deliberately. Nor does
 *                               "definitely", "resolved", "ignored" or
 *                               "irrelevant". A verification suite fails if
 *                               they do.
 *
 * It is REVIEW TRIAGE: the reviewer should not have to walk past these in the
 * normal conveyor, and can look at them whenever they choose to.
 *
 * ═══════════════════ AFFIRMATIVE ONLY ═══════════════════
 *
 * The predicate is a conjunction of things DocScrub POSITIVELY knows. Nothing
 * qualifies through absence:
 *
 *   - `unsupported` candidates are NEVER Unlikely. No evidence is not an
 *     explanation; it is silence, and silence is exactly what a reviewer
 *     needs to see.
 *   - `contested` candidates are NEVER Unlikely. Two readings means the
 *     system narrowed the question, not that it answered it.
 *   - any surviving Person reading prevents Unlikely, whatever else is true.
 *   - typed PII detections (email / phone / CIN / long numeric id) are
 *     protective and are never triaged away by policy.
 *   - `organization` is NOT in the non-sensitive set: a named organization
 *     can be privacy-relevant depending on the document.
 *
 * ═══════════════════ MEASURED, NOT GUESSED ═══════════════════
 *
 * The predicate below is exactly the one measured over the real 601-candidate
 * production export (see `20260810-review-necessity-audit-findings.md`):
 *
 *     175 candidates qualify (29.1%)   426 remain active review
 *     45 of the 175 carry human labels; ZERO are real people
 *
 * MONOTONE, which is the property that makes it safe to look at: acquiring
 * ANY further evidence adds an interpretation, which makes a candidate
 * contested, which removes it from Unlikely. More evidence can never make
 * this predicate more aggressive.
 *
 * ═══════════════════ ONE DETERMINATION, ONE PLACE ═══════════════════
 *
 * The UI must not re-derive any of this. It reads the already-computed
 * interpretation profile and asks this module. No semantic logic lives in the
 * rendering layer.
 *
 * Pure, DOM-free, deterministic.
 */

import type { InterpretationId, InterpretationProfile } from "../interpretation/interpretation-model.js";

/**
 * Interpretations that EXPLAIN a candidate without implying anything about a
 * person or an identifiable entity.
 *
 * `organization` is deliberately absent -- see the module header. `place` is
 * absent too: a place name can be identifying in context, and no measurement
 * has been done on it.
 */
export const NON_SENSITIVE_INTERPRETATIONS: readonly InterpretationId[] = [
  "ordinary-language",
  "domain-terminology",
  "acronym",
  "date-or-term",
  "document-title",
];

/** Detector types whose disposition is the reviewer's by policy. DocScrub
 *  never triages away a protective PII detection. */
export const PROTECTIVE_DETECTED_TYPES: readonly string[] = ["email", "phone", "cin", "long_numeric_id"];

export type ReviewNecessity = "review-required" | "unlikely";

/** Reviewer-facing label. Intentionally weak; see the module header. */
export const REVIEW_NECESSITY_LABELS: Record<ReviewNecessity, string> = {
  "review-required": "Needs review",
  unlikely: "Unlikely",
};

/**
 * Why a candidate is Unlikely, assembled from evidence that already exists.
 *
 * NO CONFIDENCE VALUE, and no percentage. The explanation is the name of the
 * surviving reading plus the evidence classes that support it -- both already
 * computed, neither invented here.
 */
export interface ReviewNecessityResult {
  necessity: ReviewNecessity;
  /** The single surviving reading, when Unlikely. Null otherwise. */
  explanation: InterpretationId | null;
  /** Domain discriminator where the reading carries one. */
  explanationDomain: string | null;
  /** Distinct signal classes supporting that reading, in derivation order. */
  affirmativeEvidence: readonly string[];
  /** Why review IS still required, for the active population. Internal
   *  traceability; not reviewer copy. */
  reason: string;
}

const REVIEW_REQUIRED = (reason: string): ReviewNecessityResult => ({
  necessity: "review-required",
  explanation: null,
  explanationDomain: null,
  affirmativeEvidence: [],
  reason,
});

/**
 * The one determination.
 *
 * `detectedType` is passed in rather than read off a candidate so this module
 * owns no view of the document model -- the same discipline the gates follow.
 * `profile` may be undefined for a candidate the interpretation layer has not
 * seen, which is treated as review-required: absence is never a reason to
 * triage something away.
 */
export function reviewNecessityFor(
  detectedType: string,
  profile: InterpretationProfile | undefined
): ReviewNecessityResult {
  if (PROTECTIVE_DETECTED_TYPES.includes(detectedType)) {
    return REVIEW_REQUIRED("protective typed detection -- disposition is the reviewer's by policy");
  }
  if (!profile) return REVIEW_REQUIRED("no interpretation profile available");
  if (profile.interpretations.length === 0) {
    return REVIEW_REQUIRED("no affirmative evidence -- silence is not an explanation");
  }
  if (profile.interpretations.length > 1) {
    return REVIEW_REQUIRED("several readings are affirmatively supported");
  }

  const only = profile.interpretations[0]!;
  /* Belt and braces: `length === 1` already excludes a person reading, but the
   * person guard is stated explicitly so it survives any future change to the
   * shape above. */
  if (only.id === "person") return REVIEW_REQUIRED("a Person reading is affirmatively supported");
  if (!NON_SENSITIVE_INTERPRETATIONS.includes(only.id)) {
    return REVIEW_REQUIRED(`the only reading (${only.id}) may carry privacy weight`);
  }

  return {
    necessity: "unlikely",
    explanation: only.id,
    explanationDomain: only.domain ?? null,
    affirmativeEvidence: [...new Set(only.signals.map((s) => s.class))],
    reason: `exactly one affirmative reading (${only.id}), in a non-sensitive class, with no Person reading`,
  };
}

/** Convenience for counting. */
export function isUnlikely(result: ReviewNecessityResult): boolean {
  return result.necessity === "unlikely";
}
