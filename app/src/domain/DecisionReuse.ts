/**
 * DecisionReuse — domain types for Feature 002 ("Review once. Apply
 * everywhere."). Pure types only, no logic -- same convention as
 * AuditRecord.ts (which this file is the deliberate mirror image of: that
 * file describes what review state was EXPORTED; this one describes what a
 * later review can IMPORT back in and why it trusted a given match).
 *
 * DESIGN CONTEXT: the "previously generated decisions JSON file" Andrew's
 * instruction asks this feature to import is not a new file format --
 * it is exactly AuditExporter.ts's existing `decisionsJson` export
 * (schemaVersion/documentId/sessionId/candidates/entityGroups/
 * ambiguityResolutions, built by toDecisionsJson() from an AuditRecord).
 * ImportedDecisions below is that same shape, read back in. Reusing an
 * artifact this codebase already produces (rather than inventing a second,
 * parallel "decision export" format) is itself the deterministic,
 * explainable choice: there is exactly one way review decisions leave this
 * application in writing, and exactly one way they come back in.
 *
 * MATCHING EVIDENCE: DecisionReuseEvidence is the concrete answer to "why
 * was this reused?" (explicitly required by Andrew's instruction, ahead of
 * a full ExplanationEngine UI, which remains a signature only elsewhere in
 * this codebase). Three tiers, all deterministic, all documented in
 * DecisionReuseEngine.ts (which computes them) rather than here:
 *
 *   "exact-key"            -- the current document's own candidate key
 *                              (DetectionEngine's normalizeCandidate()
 *                              output, e.g. "person:andrew jackson") is
 *                              byte-identical to a previously decided
 *                              candidate's key. Candidate keys are already a
 *                              pure function of normalized text + detected
 *                              type (Phase 4), so this tier costs nothing
 *                              beyond a map lookup and is the strongest
 *                              possible evidence short of the two documents
 *                              being byte-identical.
 *   "grouped-alias"         -- the current candidate has no exact-key match
 *                              of its own, but THIS document's own
 *                              EntityResolutionEngine output groups it with
 *                              another current candidate that DID get an
 *                              exact-key match. Reuses that sibling's
 *                              decision. This is "reuse existing
 *                              entity-resolution infrastructure" applied
 *                              literally: no separate alias-detection logic
 *                              is written here at all, this tier only
 *                              consumes EntityResolutionEngine's own
 *                              already-computed grouping.
 *   "similarity-threshold"  -- deterministic Ratcliff/Obershelp ratio
 *                              (sequenceRatio(), the same algorithm
 *                              entity_resolution.py's own member-scoring
 *                              uses) between the current candidate's
 *                              normalized text and a previously decided
 *                              candidate's, restricted to the same detected
 *                              type, gated by a documented fixed threshold.
 *                              See DecisionReuseEngine.ts's own doc comment
 *                              for the exact threshold and why.
 *
 * No tier involves machine learning or an undocumented heuristic -- each is
 * a small, named, independently testable rule over data this application
 * already computes.
 */

import type { CandidateDecisionKind } from "./ReviewSession.js";

/** Deliberately NOT imported from AuditRecord.ts's AuditedDecisionKind --
 *  identical in shape (mirrors an exported decisions.json's candidate
 *  entries, which ARE AuditedCandidate.decision values), but declared
 *  locally so domain/DecisionReuse.ts and domain/AuditRecord.ts do not
 *  depend on each other in both directions (AuditRecord.ts's own
 *  AuditedCandidate needs DecisionReuseEvidence, the other direction).
 *  Both are simple closed unions over the same four decision kinds plus
 *  "Undecided"; if AuditedDecisionKind ever changes shape, this should
 *  change with it -- see AuditRecord.ts's own doc comment. */
export type ImportedDecisionKind = "Keep" | "Rename" | "Redact" | "Ignore" | "Undecided";

export type DecisionReuseMatchTier = "exact-key" | "grouped-alias" | "similarity-threshold";

export interface DecisionReuseEvidence {
  tier: DecisionReuseMatchTier;
  /** The imported candidateId this proposal's decision was actually taken
   *  from -- may differ from the CURRENT document's candidateId this
   *  evidence is attached to (e.g. a "grouped-alias" match's evidence
   *  points at the sibling candidate that supplied the decision, not at
   *  itself). */
  matchedImportedCandidateId: string;
  /** 0-100, matching this codebase's existing confidence-scale convention
   *  (Candidate.confidence, EntityGroupProposal.originalProposalConfidence,
   *  QualityResult scores are all 0-100). Fixed per tier (exact-key=100,
   *  grouped-alias=90) except "similarity-threshold", whose confidence IS
   *  the matched ratio scaled to 0-100. */
  confidence: number;
  /** Human-readable explanation, already assembled -- sufficient for a
   *  future ExplanationEngine to surface directly, without this feature
   *  needing to build that UI now (per Andrew's explicit scope note). */
  description: string;
  /** "grouped-alias" only: which of the CURRENT document's own entity-group
   *  proposals tied the two candidates together. */
  viaGroupId?: string;
  /** "similarity-threshold" only: the raw sequenceRatio() value that
   *  cleared the threshold (0.0-1.0, Python/JS difflib scale -- kept at its
   *  native precision here rather than only the derived 0-100 confidence,
   *  since a future ExplanationEngine may want to show the exact number a
   *  reviewer could independently sanity-check). */
  similarityRatio?: number;
}

export interface DecisionReuseProposal {
  /** The CURRENT document's candidate this proposal applies to. */
  candidateId: string;
  decision: CandidateDecisionKind;
  replacement?: string;
  evidence: DecisionReuseEvidence;
}

// ---- The imported artifact itself -----------------------------------------
// Mirrors AuditExporter.ts's toDecisionsJson() output exactly (see this
// file's top doc comment) -- ImportedCandidateDecision.decision reuses
// AuditedDecisionKind (includes "Undecided") rather than
// CandidateDecisionKind, because an exported decisions.json legitimately
// lists every candidate from the source document, decided or not.

export interface ImportedCandidateDecision {
  candidateId: string;
  decision: ImportedDecisionKind;
  replacement?: string;
  decidedAt?: string;
}

export interface ImportedEntityGroup {
  groupId: string;
  canonicalName: string;
  detectedType: string;
  decision: "Confirmed" | "Rejected" | "Refined";
  decidedAt: string;
  confirmedMemberCandidateIds: string[];
  wentThroughNotQuite: boolean;
}

export interface ImportedAmbiguityResolution {
  candidateId: string;
  resolvedGroupId: string;
  decidedAt: string;
}

export interface ImportedDecisions {
  schemaVersion: number;
  /** The document identity the PRIOR review was performed against --
   *  expected to differ from the current document's own documentId (that
   *  is the entire point of this feature: reusing decisions ACROSS document
   *  versions). Never used as a validation gate -- see DecisionImport.ts.
   *  Retained here purely for traceability/audit context. */
  documentId: string;
  sessionId: string;
  candidates: ImportedCandidateDecision[];
  entityGroups: ImportedEntityGroup[];
  ambiguityResolutions: ImportedAmbiguityResolution[];
}
