/**
 * EntityResolutionEngine — architecture v0.2 §6.6. Formerly the
 * reviewer-relevant half of what v0.1 called GroupingEngine (ADR-013,
 * Required). Owns identity-resolution proposals only: which occurrences
 * plausibly represent the same entity. Durable-state-adjacent, audit-relevant,
 * reviewer-decided -- as opposed to OccurrenceClassifier (see
 * OccurrenceClassifier.ts), which is pure display classification with no
 * review implications.
 *
 * Matches redactor/entity_resolution.py's existing responsibilities
 * (AmbiguousEntityMatch, EntityGroup, calculate_entity_confidence).
 *
 * PRODUCTION IMPLEMENTATION (Phase 6): RegexEntityResolutionEngine below is
 * a faithful port of entity_resolution.py's build_entity_groups() and
 * build_ambiguous_matches() (via src/engines/entity-resolution/
 * resolution.ts -- see that file's doc comment for the line-by-line port
 * record and every documented deviation, and
 * docs/detection/phase-6-findings.md for the full writeup).
 *
 * INTERFACE DEFECT FIX: propose() originally took only a QualityResult.
 * QualityResult (src/domain/Evidence.ts) carries scores/evidence/
 * assessments keyed by candidateId, but NOT the underlying Candidate data
 * itself (displayValue, detectedType, confidence, occurrenceIds) that
 * grouping fundamentally operates on (Python's build_entity_groups takes
 * `candidates: list[Candidate]` directly). Without that, this engine could
 * not be implemented at all -- not a redesign, an interface that omitted
 * something structurally required. Fixed by adding a `detection:
 * DetectionResult` parameter (which carries Candidate[]), following the
 * same "document/detection first" parameter-ordering convention already
 * established by DocumentRebuilder/OutputVerifier (Phase 3) and
 * CandidateQualityEngine (Phase 5).
 *
 * ADDITIVE SCHEMA CHANGES: EntityGroupProposal gained canonicalName,
 * detectedType, memberConfidences, and reasons; AmbiguityProposal gained
 * candidateGroupOptions (canonicalName + confidence per option, not just
 * bare group IDs) -- Python's EntityGroup/AmbiguousEntityMatch carry all of
 * this, and Andrew's Phase 6 instruction explicitly requires verifying
 * "canonical/display labels," "ordered evidence/reasons," and "confidence
 * values," which the original three-field shapes could not represent.
 * Existing fields (candidateIds, candidateGroupIds,
 * originalProposalConfidence) are unchanged.
 *
 * CORRECTION (2026-07-28): propose() now threads `qualityOf` into
 * buildAmbiguousMatches() (previously only buildEntityGroups() received
 * it), because ambiguity matching now scores solitary full-name entities
 * the same way buildEntityGroups scores realized ones -- see
 * resolution.ts's top doc comment, "DISCLOSED BEHAVIORAL CHANGE," for the
 * full defect trace. A first-name-only candidate can now be proposed as
 * ambiguous against a full-name entity that has only ONE detected spelling
 * variant, not only against entities that already independently formed a
 * real EntityGroupProposal.
 */

import type { Candidate } from "../domain/DocumentModel.js";
import type { QualityLabel, QualityResult } from "../domain/Evidence.js";
import type { DetectionResult } from "./DetectionEngine.js";
import {
  buildAmbiguousMatches,
  buildEntityGroups,
  calculateEntityConfidence,
  type EntityGroupResult,
} from "./entity-resolution/resolution.js";
export { analysisMemberScore } from "./entity-resolution/resolution.js";

export interface AmbiguityProposalGroupOption {
  groupId: string;
  canonicalName: string;
  confidence: number;
}

export interface AmbiguityProposal {
  candidateId: string;
  /** Candidate groups this candidate could plausibly belong to -- the
   *  reviewer picks one via review.enterAmbiguity-style flows (not yet
   *  namespaced separately; ambiguity resolution currently rides on the
   *  same candidate-decision path as Group Check, see ReviewSession.ts).
   *  Derived from candidateGroupOptions below; kept for callers that only
   *  need bare IDs. */
  candidateGroupIds: string[];
  /** Additive (Phase 6): the canonical name + confidence for each option,
   *  matching Python's AmbiguousEntityMatch.possible_groups -- a reviewer
   *  cannot meaningfully choose between bare group IDs alone. */
  candidateGroupOptions: AmbiguityProposalGroupOption[];
}

export interface EntityGroupProposal {
  groupId: string;
  candidateIds: string[];
  /** Immutable once generated -- part of document state, not durable review
   *  state (architecture v0.2 §7.1). ReviewEngine derives a separate "live"
   *  confidence from whichever members the reviewer actually confirms (see
   *  recalculateConfidence() on EntityResolutionEngine below). */
  originalProposalConfidence: number;
  /** Additive (Phase 6): matches Python's EntityGroup.canonical_name --
   *  the display label the group was built around. */
  canonicalName: string;
  /** Additive (Phase 6): matches Python's EntityGroup.detected_type. */
  detectedType: string;
  /** Additive (Phase 6): per-member confidence, matches Python's
   *  EntityGroup.member_confidences. */
  memberConfidences: Record<string, number>;
  /** Additive (Phase 6): ordered evidence/reason codes, matches Python's
   *  EntityGroup.reasons -- e.g. "deterministic_grouping",
   *  "shared_name_signature", "reviewer_removed_member". */
  reasons: string[];
}

export interface GroupingResult {
  schemaVersion: 1;
  ambiguityProposals: AmbiguityProposal[];
  entityGroupProposals: EntityGroupProposal[];
}

export interface EntityResolutionEngine {
  propose(detection: DetectionResult, quality: QualityResult): GroupingResult;
  /**
   * Recomputes a group's "live" confidence for a possibly-reviewer-adjusted
   * subset of its original members -- matches Python's
   * calculate_entity_confidence(). This does not mutate any review
   * decision; it is a pure function callers (a future ReviewEngine) invoke
   * with whatever subset the reviewer has actually confirmed, exactly the
   * "immutable proposal vs. derived live confidence" split
   * EntityGroupProposal.originalProposalConfidence's own doc comment
   * already anticipated before this phase implemented it.
   */
  recalculateConfidence(
    group: EntityGroupProposal,
    detection: DetectionResult,
    quality: QualityResult,
    selectedCandidateIds: readonly string[],
    canonicalName?: string,
    reviewerConfirmed?: boolean,
    memberScoreOverride?: (candidateId: string) => number | undefined
  ): number;
}

function qualityLookup(quality: QualityResult): (candidateId: string) => QualityLabel {
  return (candidateId: string) => quality.assessmentByCandidate[candidateId]?.quality ?? "Possible";
}

function toProposal(group: EntityGroupResult): EntityGroupProposal {
  return {
    groupId: group.id,
    candidateIds: group.candidateKeys,
    originalProposalConfidence: group.confidence,
    canonicalName: group.canonicalName,
    detectedType: group.detectedType,
    memberConfidences: group.memberConfidences,
    reasons: group.reasons,
  };
}

export class RegexEntityResolutionEngine implements EntityResolutionEngine {
  propose(detection: DetectionResult, quality: QualityResult): GroupingResult {
    const qualityOf = qualityLookup(quality);
    const groups = buildEntityGroups(detection.candidates, qualityOf);
    const ambiguous = buildAmbiguousMatches(detection.candidates, groups, qualityOf);

    return {
      schemaVersion: 1,
      entityGroupProposals: groups.map(toProposal),
      ambiguityProposals: ambiguous.map((match) => ({
        candidateId: match.candidateKey,
        candidateGroupIds: match.possibleGroups.map((g) => g.id),
        candidateGroupOptions: match.possibleGroups.map((g) => ({
          groupId: g.id,
          canonicalName: g.canonicalName,
          confidence: g.confidence,
        })),
      })),
    };
  }

  recalculateConfidence(
    group: EntityGroupProposal,
    detection: DetectionResult,
    quality: QualityResult,
    selectedCandidateIds: readonly string[],
    canonicalName?: string,
    reviewerConfirmed = false,
    memberScoreOverride?: (candidateId: string) => number | undefined
  ): number {
    const qualityOf = qualityLookup(quality);
    const candidatesById = new Map<string, Candidate>(detection.candidates.map((c) => [c.id, c]));
    const groupResult: EntityGroupResult = {
      id: group.groupId,
      canonicalName: group.canonicalName,
      detectedType: group.detectedType,
      candidateKeys: group.candidateIds,
      confidence: group.originalProposalConfidence,
      memberConfidences: group.memberConfidences,
      reasons: group.reasons,
    };
    return calculateEntityConfidence(groupResult, candidatesById, qualityOf, selectedCandidateIds, canonicalName, reviewerConfirmed, memberScoreOverride);
  }
}
