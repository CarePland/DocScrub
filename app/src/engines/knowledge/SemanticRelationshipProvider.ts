/**
 * SemanticRelationshipProvider -- Deterministic Semantic Relationship
 * Knowledge (2026-07-30, Andrew's feature prompt). The GENERALIZED
 * provider interface the prompt asks for in place of a one-off
 * NicknameDictionary: each provider is a deterministic, local-only,
 * bidirectional source of SEMANTIC IDENTITY relationships between
 * normalized terms, contributing explainable evidence to entity
 * resolution's existing Ambiguity workflow.
 *
 * Explicitly DISTINCT from StructuralRelationshipEngine (2026-07-30,
 * earlier the same day): that engine observes non-semantic SHAPE
 * ("these share a pattern") and proposes relationship cards; providers
 * here carry curated knowledge that two terms may denote the SAME
 * IDENTITY ("Andy" ~ "Andrew"), feeding ordinary identity ambiguity
 * proposals. No new reviewer concepts, no automatic merges -- the
 * reviewer remains authoritative through the existing
 * linkAmbiguousCandidate flow, and confirmed links persist through the
 * existing ReviewSession/entityRegistry/decision-reuse machinery (no new
 * persistence).
 *
 * FUTURE PROVIDERS the interface is shaped for (same contract, different
 * dataset + term domain): AcronymProvider (full-value terms --
 * "national student clearinghouse" ~ "nsc"), OrganizationAliasProvider,
 * user-confirmed aliases, spelling variants, accented variants,
 * transliterations. The AUGMENTATION pass (semantic-augmentation.ts)
 * owns the policy of WHICH strings to ask about (first-name tokens
 * today; whole normalized values for acronym-style providers later via
 * `termDomain`); providers own only the knowledge itself.
 */

/** Ordinal evidence weight, per the curated dataset's own vocabulary --
 *  NOT a probability. */
export type RelationStrength = 1 | 2 | 3 | 4 | 5;

export const RELATION_STRENGTH_LABELS: Record<RelationStrength, string> = {
  5: "Established",
  4: "Strong",
  3: "Credible",
  2: "Weak",
  1: "Speculative",
};

export interface SemanticRelation {
  /** The related term, normalized (lowercase, trimmed). */
  term: string;
  strength: RelationStrength;
  /** Phase 2 (additive): a per-relation evidence label overriding the
   *  provider-level `evidenceLabel` -- lets one full-value provider carry
   *  both "Acronym relationship" and "Alias relationship" entries, with
   *  the KIND curated in the dataset rather than guessed from shape. */
  label?: string;
}

export interface SemanticRelationshipProvider {
  /** Stable identifier, e.g. "related-name". Appears in evidence lines'
   *  provenance and findings docs. */
  id: string;
  /** What kind of string this provider's terms are -- the augmentation
   *  pass uses this to decide what to look up: "name-token" providers are
   *  consulted with individual cleaned name tokens ("andy"); "full-value"
   *  providers (future acronym/organization-alias) with whole normalized
   *  candidate values. */
  termDomain: "name-token" | "full-value";
  /** The reviewer-facing name of this KIND of relationship, used to open
   *  evidence lines -- e.g. "Related-name relationship", "Acronym
   *  relationship". */
  evidenceLabel: string;
  /** Human-readable dataset provenance + version, for transparency
   *  ("easily replaceable, versionable"). */
  describe(): string;
  /** Deterministic, BIDIRECTIONAL lookup: every relation of `term`
   *  (normalized lowercase). Empty array when none. */
  relationsOf(term: string): readonly SemanticRelation[];
  /** Convenience: the strength relating `a` and `b`, or null. Symmetric
   *  by construction. */
  strengthBetween(a: string, b: string): RelationStrength | null;
}
