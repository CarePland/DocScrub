/**
 * CandidateQualityEngine — architecture v0.2 §6.4. Synchronous and pure given
 * a DetectionResult and a ScoringProfileSnapshot: never makes final PII
 * decisions, only assigns a deterministic Candidate Score (Likelihood) and a
 * To Review / Unlikely recommendation.
 *
 * NEW in v0.2: evaluate() takes an explicit ScoringProfileSnapshot rather
 * than reading live settings, so the resulting QualityResult is reproducible
 * later even if org-level weights/thresholds change (see
 * domain/ScoringProfileSnapshot.ts, ADR-015).
 *
 * PRODUCTION IMPLEMENTATION (Phase 5): RegexCandidateQualityEngine below is
 * a faithful port of redactor/candidate_quality.py's score_candidate_quality
 * (via src/engines/quality/scoring.ts -- see that file for the line-by-line
 * port record and every documented deviation). This file is the thin
 * adapter layer: it groups DetectionResult.occurrences by candidate, builds
 * a blockId->ContentBlock lookup scoring.ts needs (see scoring.ts's doc
 * comment, shape difference #2), calls scoreCandidateQuality() once per
 * candidate, and translates each ScoredQuality into this domain's
 * QualityResult shape (Evidence[] / score / recommendation / assessment).
 *
 * INTERFACE DEFECT FIX: evaluate() originally took only (input, profile) --
 * the same category of gap Phase 3 found and fixed twice already
 * (DocumentRebuilder/OutputVerifier both originally lacked a DetectionResult
 * parameter they structurally needed). Here, the missing piece is
 * DocumentModel: scoring.ts's ported `_is_heading_like` check needs to know
 * whether an occurrence's owning block is a header (see scoring.ts's shape
 * difference #2), and DetectionResult alone carries only blockId strings,
 * not block kinds. Without DocumentModel, this engine could not actually
 * implement Python's heading-context behavior at all -- not a redesign,
 * the interface as originally specified could not be built. Fixed by adding
 * a `document: DocumentModel` parameter, following the exact same pattern
 * (and parameter-ordering convention -- document first) already established
 * by DocumentRebuilder.rebuild(document, detection, session) and
 * OutputVerifier.verify(original, detection, session, rebuilt).
 *
 * PROFILE-DRIVEN SCORING (ADR-015): this engine never hardcodes Python's
 * EVIDENCE_WEIGHTS/STATUS_THRESHOLDS constants inline. It reads
 * profile.weights / profile.thresholds at scoring time, so a
 * ScoringProfileSnapshot genuinely pins what a session was scored with (as
 * ADR-015 requires) rather than being a passthrough that's ignored in
 * practice. buildDefaultScoringProfileSnapshot() below builds the *default*
 * profile FROM the ported Python constants (scoring.ts's
 * DEFAULT_EVIDENCE_WEIGHTS / DEFAULT_REVIEW_THRESHOLD) -- so parity with
 * Python is achieved via this default profile's content, and the profile
 * mechanism itself is genuinely exercised, not bypassed.
 */

import type { DetectionResult } from "./DetectionEngine.js";
import type { CandidateQualityAssessment, Evidence, EvidencePolarity, QualityResult } from "../domain/Evidence.js";
import type { ContentBlock, DocumentModel, Occurrence } from "../domain/DocumentModel.js";
import {
  SCORING_PROFILE_SNAPSHOT_SCHEMA_VERSION,
  type ScoringProfileSnapshot,
} from "../domain/ScoringProfileSnapshot.js";
import type { ContextualPersonEvidenceResult } from "./contextual-person-evidence/contextual-person-evidence.js";
import {
  DEFAULT_EVIDENCE_WEIGHTS,
  DEFAULT_REVIEW_THRESHOLD,
  REVIEW_STATUS_KEY,
  scoreCandidateQuality,
} from "./quality/scoring.js";

export interface CandidateQualityEngine {
  /**
   * @param contextual OPTIONAL, ADDITIVE (AG, 2026-08-05). Output of the
   *   Contextual Person Evidence pass. Deliberately a PARAMETER rather than
   *   something this engine computes for itself: verify/quality-parity.ts
   *   calls evaluate() with three arguments and therefore exercises the
   *   untouched Python port, while Workspace passes the fourth and gets the
   *   contextual behaviour. One engine, two honest modes, no fixture
   *   deviations. See engines/quality/scoring.ts's `contextual` parameter.
   */
  evaluate(
    document: DocumentModel,
    input: DetectionResult,
    profile: ScoringProfileSnapshot,
    contextual?: ContextualPersonEvidenceResult | undefined
  ): QualityResult;
}

/**
 * Builds a ScoringProfileSnapshot whose weights/thresholds are populated
 * directly from the ported Python constants -- the mechanism that achieves
 * domain parity with candidate_quality.py while still routing every score
 * through the profile-driven architecture ADR-015 calls for (see this
 * file's doc comment). Callers that need a real org-configured profile
 * instead should build their own ScoringProfileSnapshot and pass it to
 * evaluate() -- this function exists only to give callers a
 * parity-verified starting point, not to be the only profile ever used.
 */
export function buildDefaultScoringProfileSnapshot(scoringTimestamp: string = new Date().toISOString()): ScoringProfileSnapshot {
  return {
    schemaVersion: SCORING_PROFILE_SNAPSHOT_SCHEMA_VERSION,
    profileId: "default",
    profileVersion: "phase-5-python-port",
    weights: { ...DEFAULT_EVIDENCE_WEIGHTS },
    thresholds: { [REVIEW_STATUS_KEY]: DEFAULT_REVIEW_THRESHOLD },
    // Identifies the Python source this profile's constants were ported
    // from, not a semver -- there is no independent TS ruleset yet.
    detectorRulesetVersion: "redactor/candidate_quality.py (Phase 5 port)",
    // Per-lexicon-file version/hash tracking is not implemented yet -- the
    // whole merged lexicon is embedded as one generated data file (see
    // quality-dictionaries.data.ts's header) rather than tracked file by
    // file. Not a blocker for Phase 5 parity (scoring behavior is verified
    // directly against fixtures), but flagged here as a real gap if
    // per-lexicon audit provenance is ever required.
    lexiconVersions: {},
    applicationVersion: "docscrub-web@phase-5",
    scoringTimestamp,
  };
}

/**
 * DECLARED EVIDENCE POLARITY -- a PORT DEFECT REPAIR (AG, 2026-08-04).
 *
 * Python assigns an evidence item's polarity as, verbatim
 * (explanations.py:338):
 *
 *     polarity = str(raw.get("polarity") or _polarity(weight))
 *
 * An explicitly DECLARED polarity wins; the weight's sign is only the
 * fallback for rules that declare none. `candidate_quality.py` declares one
 * for fourteen rules (the QUALITY_DICTIONARIES entries carrying a
 * `"polarity"` key), and this table is those fourteen, copied across.
 *
 * The port kept the fallback and dropped the table, so every polarity came
 * from the weight sign alone. Thirteen of the fourteen disagree with their
 * own weight, which meant thirteen rules were rendered under a sign Python
 * says they do not have -- e.g. `honorific_title` (weight +6, declared
 * NEUTRAL) presented as positive evidence that an item is a person, and
 * `expanded_common_language_token` (weight -40, declared NEUTRAL)
 * presented as the strongest negative in the system.
 *
 * WHY THESE RULES ARE NEUTRAL DESPITE CARRYING WEIGHT. They are lexicon
 * MEMBERSHIP facts, not arguments: "this word is also a professional
 * credential" is context a reviewer should have, but it is not a reason to
 * conclude anything on its own -- the weight nudges the score while the
 * claim stays undecided. Conflating "contributes to the score" with
 * "argues for a conclusion" is precisely the error the declaration exists
 * to prevent, and it is what made a panel read "unlikely" above three
 * positive chips and one negative one.
 *
 * The weights are UNTOUCHED. Scores are identical before and after; only
 * which column an item is presented in changes. Any parity suite comparing
 * scores is unaffected by construction.
 *
 * Keyed by the SNAKE_CASE rule id, because that is what `scoreCandidateQuality`
 * emits in `evidenceBreakdown[].rule` -- the kebab-case re-keying happens
 * one line later when `Evidence.category` is built.
 */
const DECLARED_EVIDENCE_POLARITY: Readonly<Record<string, EvidencePolarity>> = {
  address_suffix: "neutral",
  ambiguous_lexical_token: "neutral",
  calendar_abbreviation: "neutral",
  common_abbreviation: "neutral",
  common_english_word: "negative", // declared, and agrees with its weight -- carried anyway so the table is the whole declaration, not the diffs
  contraction: "neutral",
  document_structure_term: "neutral",
  expanded_common_language_token: "neutral",
  honorific_title: "neutral",
  interjection_casual: "neutral",
  legal_administrative_term: "neutral",
  organization_suffix: "neutral",
  product_system_name: "neutral",
  professional_credential: "neutral",
};

/** Python's `raw.get("polarity") or _polarity(weight)`, in that order. */
function evidencePolarityFor(rule: string, weight: number): EvidencePolarity {
  return DECLARED_EVIDENCE_POLARITY[rule] ?? evidencePolarityForWeight(weight);
}

/** Python's `_polarity(weight)` -- the FALLBACK only. */
function evidencePolarityForWeight(weight: number): EvidencePolarity {
  if (weight > 0) return "positive";
  if (weight < 0) return "negative";
  return "neutral";
}

export class RegexCandidateQualityEngine implements CandidateQualityEngine {
  evaluate(
    document: DocumentModel,
    input: DetectionResult,
    profile: ScoringProfileSnapshot,
    contextual?: ContextualPersonEvidenceResult | undefined
  ): QualityResult {
    const blocksById = new Map<string, ContentBlock>(document.blocks.map((block) => [block.id, block]));

    const occurrencesByCandidate = new Map<string, Occurrence[]>();
    for (const occurrence of input.occurrences) {
      const existing = occurrencesByCandidate.get(occurrence.candidateId);
      if (existing) {
        existing.push(occurrence);
      } else {
        occurrencesByCandidate.set(occurrence.candidateId, [occurrence]);
      }
    }

    const reviewThreshold = profile.thresholds[REVIEW_STATUS_KEY] ?? DEFAULT_REVIEW_THRESHOLD;

    const evidenceByCandidate: QualityResult["evidenceByCandidate"] = {};
    const scoreByCandidate: QualityResult["scoreByCandidate"] = {};
    const recommendationByCandidate: QualityResult["recommendationByCandidate"] = {};
    const assessmentByCandidate: QualityResult["assessmentByCandidate"] = {};

    for (const candidate of input.candidates) {
      const occurrences = occurrencesByCandidate.get(candidate.id) ?? [];
      const scored = scoreCandidateQuality(
        candidate,
        occurrences,
        blocksById,
        profile.weights,
        reviewThreshold,
        contextual?.byCandidate[candidate.id]
      );

      const evidence: Evidence[] = scored.evidenceBreakdown.map((item) => ({
        id: `${candidate.id}:${item.rule}`,
        kind: evidencePolarityFor(item.rule, item.weight),
        // Rule names use Python's snake_case vocabulary; converted to
        // kebab-case to match this file's existing category examples
        // ("known-name-structure", "nearby-title", "common-english-word").
        category: item.rule.replace(/_/g, "-"),
        weight: item.weight,
        // Every rule here comes from the same ported scoring engine, not a
        // per-rule-distinguishable detector/lexicon at this layer (scoring.ts's
        // EvidenceContribution doesn't carry which specific lexicon file
        // contributed a dictionary rule -- see buildDefaultScoringProfileSnapshot's
        // lexiconVersions note above for the same underlying gap). Flagged,
        // not silently glossed over: finer per-rule provenance is a
        // possible future enhancement, not a Phase 5 blocker.
        source: "candidate-quality-engine",
      }));

      const assessment: CandidateQualityAssessment = {
        quality: scored.quality,
        explanation: scored.explanation,
        reasons: scored.reasons,
        positiveReasons: scored.positiveReasons,
        filterRules: scored.filterRules,
      };
      // Additive: only present when the contextual pass actually found
      // something, so an assessment produced without it is unchanged.
      if (scored.contextualRules.length > 0) {
        assessment.contextualRules = scored.contextualRules;
        if (scored.contextualRepresentativeOccurrenceId !== undefined) {
          assessment.contextualRepresentativeOccurrenceId = scored.contextualRepresentativeOccurrenceId;
        }
      }
      if (scored.suggestedType !== undefined) {
        assessment.suggestedType = scored.suggestedType;
      }

      evidenceByCandidate[candidate.id] = evidence;
      scoreByCandidate[candidate.id] = scored.score;
      recommendationByCandidate[candidate.id] = scored.status;
      assessmentByCandidate[candidate.id] = assessment;
    }

    return {
      schemaVersion: 1,
      evidenceByCandidate,
      scoreByCandidate,
      recommendationByCandidate,
      assessmentByCandidate,
    };
  }
}
