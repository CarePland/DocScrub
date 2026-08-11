/**
 * StructuralRelationship.ts -- Structural Relationship Review (2026-07-30,
 * Andrew's feature proposal). A second class of ambiguity, distinct from
 * entity ambiguity: relationships where multiple candidates appear related
 * on DETERMINISTIC structural grounds (acronym/full-name shape, shared
 * identifier formatting), with the application deliberately refusing to
 * infer what the relationship MEANS. "The reviewer provides the semantic
 * understanding."
 *
 * DESIGN PRINCIPLES (from the proposal, load-bearing here):
 * - These are RELATIONSHIP PROPOSALS, not review decisions. Nothing here
 *   decides, merges, or reuses anything automatically.
 * - Observations are explainable and non-semantic: "Possible acronym
 *   relationship." -- never "this is a Student ID / SSN / Case Number."
 * - "Unrelated" marks the proposed relationship unrelated and NOTHING
 *   ELSE: it does not classify candidates as non-sensitive, does not remove
 *   them from later review, and every member continues through the normal
 *   per-candidate pipeline (Item Check's Keep/Change/Redact/Ignore). The
 *   proposal remains visible as a reversible, resolved relationship state
 *   because hiding it would make an accidental Unrelated choice impossible
 *   to inspect or undo.
 *
 * ARCHITECTURE: proposals are DERIVED state -- recomputed deterministically
 * from DetectionResult by StructuralRelationshipEngine on every document
 * load, never serialized (same rule as GroupingResult/QualityResult). The
 * only DURABLE state is the reviewer's dismissals (RelationshipDismissal,
 * stored on ReviewSession keyed by the content-derived proposalId, so a
 * dismissal survives save/resume and re-detection until the reviewer
 * chooses Recombine). Accepting a proposal needs no storage at all:
 * "accepted" is expressed as ordinary per-candidate decisions via the
 * existing bulkApplyDecision command, and a proposal reads as ADDRESSED
 * when every member carries a decision -- derive, don't duplicate.
 */

/** "inserted-word-name" added 2026-08-02 (AG: "Probable name with
 *  inserted word") -- proposals of this kind are produced by the
 *  identity-cleanup pass (entity-resolution/identity-cleanup.ts), not by
 *  StructuralRelationshipEngine: the pattern is semantic (it consults the
 *  quality dictionaries), so it lives with the other semantic-layer
 *  additions and merges into the same proposal stream at the Workspace.
 *  Everything downstream (cards, dismissal, bulk decisions, audit) is
 *  kind-agnostic and needed no changes -- the model's own design goal. */
export type RelationshipKind = "acronym" | "numeric-identifier" | "alphanumeric-identifier" | "inserted-word-name";

export interface RelationshipProposal {
  /** Stable and CONTENT-DERIVED (kind + the deterministic key that formed
   *  the group), never positional -- the same proposal gets the same id on
   *  every load of the same document, which is what lets a stored
   *  dismissal mark it unrelated durably. */
  proposalId: string;
  kind: RelationshipKind;
  /** In detection (document) order -- deterministic, like every other
   *  candidate list in this pipeline. */
  candidateIds: string[];
  /** The reviewer-facing observation, verbatim from the proposal's own
   *  vocabulary -- an explainable observation, never a speculative
   *  conclusion. */
  observation: string;
  /** WHY these were grouped, in deterministic, inspectable terms (the
   *  matched initials; the shared shape signature). Transparency is a
   *  design principle, not decoration. */
  evidence: string;
  /** ADDITIVE (2026-08-02, inserted-word-name proposals): the resulting
   *  state the proposal's primary preferred action should produce
   *  ("Tanesha Collier") -- computed once by the proposal's own producer
   *  (identity-cleanup.ts, from the group canonical in display order),
   *  so the UI never re-derives it from raw member strings. Absent for
   *  engine-produced kinds, whose actions derive from members as before. */
  suggestedReplacement?: string;
}

export interface StructuralRelationshipResult {
  /** Deterministically ordered: by kind, then proposalId. */
  proposals: RelationshipProposal[];
}

/** The durable record of a reviewer choosing "Unrelated" -- the proposal
 *  remains visible as marked unrelated; its members continue through review
 *  individually. Carries the proposal's own facts (kind, members) so the
 *  session's audit trail stands alone without re-running detection. */
export interface RelationshipDismissal {
  proposalId: string;
  kind: RelationshipKind;
  candidateIds: string[];
  dismissedAt: string; // ISO 8601
}
