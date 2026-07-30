/**
 * Shared evidence contract between CandidateQualityEngine, ExplanationEngine,
 * and AuditExporter. Architecture doc v0.2 §6.4/§6.5/§12 — this type did not
 * exist as a named contract in v0.1, which left ExplanationEngine coupled to
 * CandidateQualityEngine's internal shape with no interface to catch drift.
 *
 * v2 (2026-07-27, Phase 5): added QualityLabel, CandidateQualityAssessment,
 * and QualityResult.assessmentByCandidate. Found while porting Python's real
 * scoring engine (redactor/candidate_quality.py): its per-candidate result
 * carries several fields with no home in the original three parallel
 * Records (evidenceByCandidate/scoreByCandidate/recommendationByCandidate)
 * -- a three-way `quality` label (Strong/Possible/Unlikely, DISTINCT from
 * the two-way ToReview/Unlikely `Recommendation` -- these are different
 * axes in Python: `quality` is the finer-grained label, `status` is the
 * binary review gate), a human-readable `explanation`, an optional
 * `suggestedType` ("organization", when text matches a small set of
 * known-institutional phrases), and the full ordered `reasons`/
 * `positiveReasons`/`filterRules` lists Python's explanation/audit layer
 * consumes. Rather than force all of this into Evidence[] (which is
 * per-evidence-item, not per-candidate-summary), added ONE new field
 * carrying a richer per-candidate object -- additive only, the original
 * three Records are unchanged so nothing that already depends on them
 * breaks. See src/engines/quality/scoring.ts and
 * docs/detection/phase-5-findings.md.
 */

export type EvidencePolarity = "positive" | "neutral" | "negative";

/** Matches Python's STRONG/POSSIBLE/UNLIKELY vocabulary exactly
 *  (redactor/candidate_quality.py) -- a finer-grained label than
 *  Recommendation below, not a synonym for it. */
export type QualityLabel = "Strong" | "Possible" | "Unlikely";

/** Per-candidate scoring detail beyond what Evidence[]/score/recommendation
 *  alone can carry -- see this file's v2 changelog note. */
export interface CandidateQualityAssessment {
  quality: QualityLabel;
  /** Human-readable prose, matches Python's QualityResult.explanation
   *  (e.g. "Strong personal-name structure"). Not evidence-item-specific --
   *  ExplanationEngine may still choose to build its own prose from
   *  Evidence[] instead; this is what Python's oracle actually returns. */
  explanation: string;
  /** e.g. "organization" -- set only when the candidate's text matches a
   *  small set of known-institutional phrases (redactor/
   *  candidate_quality.py's suggested_type logic). Absent otherwise. */
  suggestedType?: string;
  /** Full ordered reason list (rule names), duplicates removed preserving
   *  first occurrence -- matches Python's QualityResult.reasons. Superset
   *  of positiveReasons/filterRules below (those are informative subsets,
   *  each reason may appear in more than one list). */
  reasons: string[];
  positiveReasons: string[];
  filterRules: string[];
}

export interface Evidence {
  id: string;
  kind: EvidencePolarity;
  /** e.g. "known-name-structure", "nearby-title", "common-english-word".
   *  Category strings are the vocabulary ExplanationEngine translates into
   *  reviewer-facing prose -- see redactor/explanations.py for the existing
   *  Python category vocabulary this should stay compatible with. */
  category: string;
  /** Contribution to the deterministic score. Serializable so scoring is
   *  reproducible from a ScoringProfileSnapshot (see ScoringProfileSnapshot.ts). */
  weight: number;
  /** Detector or lexicon that produced this evidence, for Expert View and audit. */
  source: string;
}

export type Recommendation = "ToReview" | "Unlikely";

export interface QualityResult {
  schemaVersion: 1;
  evidenceByCandidate: Record<string /* candidateId */, Evidence[]>;
  scoreByCandidate: Record<string /* candidateId */, number>;
  recommendationByCandidate: Record<string /* candidateId */, Recommendation>;
  /** v2 addition -- see this file's v2 changelog note above. Additive: does
   *  not replace the three Records above, which remain the primary
   *  contract for any consumer that only needs score/recommendation/raw
   *  evidence. */
  assessmentByCandidate: Record<string /* candidateId */, CandidateQualityAssessment>;
}

/**
 * Milestone 1, Phase 1 (2026-07-28): ExplanationEngine goes from a
 * signature-only stub to a real implementation, porting
 * redactor/explanations.py directly (EXPLANATION_DICTIONARY,
 * build_standard_explanation, explanation_payload). This required extending
 * ExplanationView to a third view Python always produces alongside
 * standard/expert -- "audit" (plain-text evidence phrases for
 * AuditExporter's narrative, no numeric weights, no structured breakdown) --
 * and replacing the single minimal `Explanation` shape with the three
 * distinct per-view payloads Python's own explanation_payload() returns.
 * This is additive: `Explanation` was not consumed by any other file before
 * this change (confirmed by search), so nothing breaks.
 */
export type ExplanationView = "standard" | "expert" | "audit";

/** One evidence item translated into reviewer-facing prose at all three
 *  text tiers -- direct port of Python's EvidenceText/ExplanationEvidence
 *  (redactor/explanations.py). `short`/`standard`/`expert` are looked up
 *  from EXPLANATION_DICTIONARY by `Evidence.category` (this codebase's
 *  kebab-case rule-id convention -- see Evidence.category's own doc
 *  comment), falling back to a title-cased rendering of the category id
 *  itself when no dictionary entry exists (matches Python's
 *  `_fallback_text()` exactly, so an unrecognized rule id degrades
 *  gracefully instead of surfacing raw internal identifiers to a reviewer). */
export interface ExplanationEvidenceText {
  id: string;
  polarity: EvidencePolarity;
  weight: number;
  short: string;
  standard: string;
  expert: string;
}

/**
 * Everything ExplanationEngine needs to translate a candidate's evidence
 * into prose, assembled from CandidateQualityEngine's/DetectionEngine's
 * already-computed output (see explanation/explanation-builder.ts's
 * buildExplanationContext()) -- NOT itself invented or scored by
 * ExplanationEngine (§6.5: "must not invent evidence").
 *
 * OBJECTIVE INTERFACE DEFECT FIX (same category as CandidateQualityEngine's
 * DocumentModel parameter and OccurrenceClassifier's document/detection/
 * quality/grouping parameters -- see those files' own doc comments): the
 * architecture doc's §12 interface stub, `explain(evidence: Evidence[],
 * view): Explanation`, cannot actually produce Python's output --
 * `build_standard_explanation`'s confidence opener ("We believe this is a
 * person's name") needs entityType and likelihood, neither of which lives
 * on an Evidence item. This is not a redesign of ExplanationEngine's role;
 * the interface as originally stubbed could not be built at all. Fixed by
 * having explain() take this richer ExplanationContext instead of a bare
 * Evidence[] -- ExplanationEngine remains stateless and synchronous, and
 * still must not invent evidence beyond what `evidence` here carries.
 */
export interface ExplanationContext {
  candidateId: string;
  /** e.g. "person", "email" -- matches Candidate.detectedType. */
  entityType: string;
  likelihood: number;
  recommendation: Recommendation;
  /** Python's "disposition" -- current review disposition in prose, e.g.
   *  "Resolved: Keep" once a decision exists, else the recommendation label.
   *  See buildExplanationContext()'s own doc comment for exactly how this is
   *  derived in this codebase (a documented simplification of Python's
   *  richer disposition sourcing -- see that function's comment). */
  disposition: string;
  occurrenceCount: number;
  /** Raw, unsplit -- explain() itself splits by `.kind` into positive/
   *  negative/neutral, matching Python's own normalize-then-split order. */
  evidence: Evidence[];
  diagnosticCategories: string[];
  rawScoringExplanation: string;
}

export interface StandardExplanation {
  view: "standard";
  candidateId: string;
  likelihood: number;
  recommendation: Recommendation;
  occurrenceCount: number;
  /** The one-sentence, plain-English summary -- direct port of Python's
   *  build_standard_explanation() (confidence-bucketed opener + up to three
   *  evidence phrases per polarity, Oxford-comma joined). */
  summary: string;
}

export interface ExpertExplanation {
  view: "expert";
  candidateId: string;
  likelihood: number;
  recommendation: Recommendation;
  currentDisposition: string;
  positiveEvidence: ExplanationEvidenceText[];
  negativeEvidence: ExplanationEvidenceText[];
  neutralEvidence: ExplanationEvidenceText[];
  diagnosticCategories: string[];
  rawScoringExplanation: string;
}

/** Plain-text tier for AuditExporter's narrative -- expert-tier evidence
 *  phrases with no numeric weights or structured breakdown, matching
 *  Python's own audit view exactly (explanation_payload()'s "audit" key). */
export interface AuditExplanation {
  view: "audit";
  candidateId: string;
  summary: string;
  positiveEvidence: string[];
  negativeEvidence: string[];
  neutralEvidence: string[];
}

export type Explanation = StandardExplanation | ExpertExplanation | AuditExplanation;
