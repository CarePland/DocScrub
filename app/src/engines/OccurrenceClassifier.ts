/**
 * OccurrenceClassifier — architecture v0.2 §6.7. Formerly the display-only
 * half of what v0.1 called GroupingEngine (ADR-013, Required). A pure,
 * deterministic function with no review implications and no durable state:
 * it classifies occurrence structure for the occurrence browser and for
 * FocusNavigator's grouping, and nothing else.
 *
 * Matches redactor/occurrence_groups.py's existing behavior exactly
 * (standalone vs. contextual classification by surrounding text structure).
 * Kept as a separate component from EntityResolutionEngine specifically so a
 * change to display classification can never silently affect what is
 * exposed to Group Check review, or vice versa.
 *
 * PRODUCTION IMPLEMENTATION (Phase 7): RegexOccurrenceClassifier below is a
 * faithful port of occurrence_groups.py's group_occurrences() /
 * occurrence_group_kind() (via src/engines/occurrence-classifier/
 * classification.ts -- the parity-critical core, verified directly against
 * fixtures) PLUS an additive, reviewer-ready enrichment layer
 * (ReviewOccurrence / OccurrenceClassificationResult, built in
 * src/engines/occurrence-classifier/occurrence-classifier.ts) that
 * cross-references already-computed Detection/Quality/EntityResolution
 * output onto each occurrence -- Andrew's Phase 7 instruction explicitly
 * asks for occurrences classified "using: document block, occurrence
 * order, surrounding context, content type, source reference, entity
 * group, confidence, quality assessment," none of which
 * occurrence_groups.py's own (much narrower) output carries. See
 * docs/detection/phase-7-findings.md for the full port record.
 *
 * INTERFACE DEFECT FIX: classify() originally took only `Occurrence[]`.
 * That cannot express any of the enrichment above (no way to reach
 * ContentBlock text/kind for context extraction or navigation metadata, no
 * way to reach Candidate/QualityResult/GroupingResult for
 * confidence/quality/entity-group cross-referencing) -- same category of
 * objective interface defect found in every prior phase (Phase 3 x2,
 * Phase 5, Phase 6). Fixed by taking `document`/`detection`/`quality`/
 * `grouping` directly, following the same parameter-ordering convention
 * already established.
 */

import type { Candidate, ContentBlock, DetectorConfidence, DocumentModel, DocumentPartKind, Occurrence } from "../domain/DocumentModel.js";
import type { QualityLabel, QualityResult } from "../domain/Evidence.js";
import type { DetectionResult } from "./DetectionEngine.js";
import type { GroupingResult } from "./EntityResolutionEngine.js";
import { buildReviewOccurrences } from "./occurrence-classifier/occurrence-classifier.js";
import { GROUP_LABELS, GROUP_ORDER } from "./occurrence-classifier/classification.js";

export type OccurrenceGroupKind =
  | "standalone"
  | "contextual"
  | "quoted"
  | "header"
  | "footer"
  | "table"
  | "ocr"
  | "other";

export interface OccurrenceGroup {
  id: string;
  kind: OccurrenceGroupKind;
  label: string;
  occurrenceCount: number;
  occurrences: ReviewOccurrence[];
}

/** Structured context around a match -- additive (Phase 7). Deliberately
 *  NOT a single rendered/bracketed string: Andrew's instruction explicitly
 *  asks for "structured context rather than rendered strings whenever
 *  practical," so a UI layer can style/truncate/highlight `match` without
 *  parsing it back out of a formatted string. Extracted directly from the
 *  owning ContentBlock's text at the occurrence's own offsets (not by
 *  re-parsing Occurrence.context's bracketed rendering), so offset
 *  fidelity is preserved by construction rather than by string surgery. */
export interface StructuredContext {
  before: string;
  match: string;
  after: string;
}

/**
 * A single occurrence enriched with every cross-referenced field Andrew's
 * Phase 7 instruction asked for, so a future ReviewEngine/UI can present,
 * navigate, and highlight occurrences "without recomputing semantic
 * information." Every field here is EXPOSED from an already-computed
 * source (Detection/Quality/EntityResolution/DocumentModel), never
 * invented by this classifier -- see this file's top doc comment.
 */
export interface ReviewOccurrence {
  occurrenceId: string;
  candidateId: string;
  /** e.g. "person", "email" -- matches Candidate.detectedType. */
  detectedType: string;
  blockId: string;
  /** "content type" -- the owning ContentBlock's kind (body/header/footer/
   *  table/hyperlink/comment/tracked-deletion/...). */
  blockKind: DocumentPartKind;
  /** "source reference" -- the owning ContentBlock's opaque sourceRef
   *  pointer (see DocumentModel.ts's SourceMapping), for jump-to-source
   *  navigation without re-deriving it. */
  sourceRef: string;
  startOffset: number;
  endOffset: number;
  /** Which occurrence_groups.py bucket this occurrence falls into --
   *  computed by the exact same ported rule used for `groups` below. */
  groupKind: OccurrenceGroupKind;
  context: StructuredContext;
  /** "entity group" -- set only if this occurrence's candidate is a member
   *  of an EntityResolutionEngine group proposal. */
  entityGroupId?: string;
  /** "quality assessment" -- from QualityResult.assessmentByCandidate. */
  quality?: QualityLabel;
  /** "confidence" (numeric) -- from QualityResult.scoreByCandidate. */
  candidateScore?: number;
  /** "confidence" (categorical) -- Candidate.confidence. Reflects the
   *  CANDIDATE's confidence, not a distinct per-occurrence value -- no
   *  per-occurrence categorical confidence exists in the domain model
   *  (see this field's use in occurrence-classifier.ts for the exact
   *  "first occurrence only" quirk this inherits from Candidate.confidence,
   *  already documented in phase-4-findings.md). */
  detectorConfidence: DetectorConfidence;
  /** Explicit, deterministic position in the canonical review order (see
   *  occurrence-classifier.ts's buildReviewOccurrences() doc comment for
   *  the exact sort rule) -- 0-based, stable regardless of JS Map/Set
   *  iteration order, candidate-insertion order, or parser traversal
   *  differences. */
  order: number;
}

export interface OccurrenceClassificationResult {
  schemaVersion: 1;
  /** Python-parity buckets: matches occurrence_groups.py's
   *  group_occurrences() exactly for GROUP MEMBERSHIP and KIND
   *  classification (verified against fixtures). Bucket-internal order
   *  here follows reviewOccurrences' explicit document order (see below),
   *  NOT Python's incidental input-list order -- Python's own bucket order
   *  is never a deliberately tested contract (see phase-7-findings.md), so
   *  this is a documented, deliberate improvement, not a deviation from a
   *  real requirement. */
  groups: OccurrenceGroup[];
  /** Every occurrence, enriched, in explicit document order -- see
   *  buildReviewOccurrences()'s doc comment for the exact sort rule. */
  reviewOccurrences: ReviewOccurrence[];
}

export interface OccurrenceClassifier {
  classify(document: DocumentModel, detection: DetectionResult, quality: QualityResult, grouping: GroupingResult): OccurrenceClassificationResult;
}

export class RegexOccurrenceClassifier implements OccurrenceClassifier {
  classify(document: DocumentModel, detection: DetectionResult, quality: QualityResult, grouping: GroupingResult): OccurrenceClassificationResult {
    const reviewOccurrences = buildReviewOccurrences(document, detection, quality, grouping);

    const buckets = new Map<OccurrenceGroupKind, ReviewOccurrence[]>(GROUP_ORDER.map((kind) => [kind, []]));
    for (const occurrence of reviewOccurrences) {
      const bucket = buckets.get(occurrence.groupKind);
      if (bucket) bucket.push(occurrence);
      else buckets.set(occurrence.groupKind, [occurrence]);
    }
    const groups: OccurrenceGroup[] = [];
    for (const kind of GROUP_ORDER) {
      const bucketOccurrences = buckets.get(kind) ?? [];
      if (bucketOccurrences.length === 0) continue;
      groups.push({
        id: `occurrence-group-${kind}`,
        kind,
        label: GROUP_LABELS[kind],
        occurrenceCount: bucketOccurrences.length,
        occurrences: bucketOccurrences,
      });
    }

    return { schemaVersion: 1, groups, reviewOccurrences };
  }
}

/**
 * MILESTONE 1, PHASE 1 (2026-07-28): a pure, presentation-facing helper for
 * CandidateDetailPanel's occurrence browser -- Python's per-candidate
 * occurrence_groups() view (grouped, collapsible occurrence blocks, e.g.
 * "In a table," "Near a signature block"), reconstructed as its own function
 * rather than duplicated inline in app.ts. Deliberately does NOT recompute
 * `groupKind` (ReviewOccurrence already carries it, from this same
 * classifier); it only filters to one candidate's occurrences and re-uses
 * the SAME GROUP_ORDER/GROUP_LABELS this file's own `classify()` uses, so
 * bucket order/labels can never silently drift between the whole-document
 * view and this per-candidate view.
 */
export function groupReviewOccurrencesForCandidate(candidateId: string, reviewOccurrences: readonly ReviewOccurrence[]): OccurrenceGroup[] {
  const candidateOccurrences = reviewOccurrences.filter((occurrence) => occurrence.candidateId === candidateId);
  const buckets = new Map<OccurrenceGroupKind, ReviewOccurrence[]>(GROUP_ORDER.map((kind) => [kind, []]));
  for (const occurrence of candidateOccurrences) {
    const bucket = buckets.get(occurrence.groupKind);
    if (bucket) bucket.push(occurrence);
    else buckets.set(occurrence.groupKind, [occurrence]);
  }
  const groups: OccurrenceGroup[] = [];
  for (const kind of GROUP_ORDER) {
    const bucketOccurrences = buckets.get(kind) ?? [];
    if (bucketOccurrences.length === 0) continue;
    groups.push({
      id: `occurrence-group-${candidateId}-${kind}`,
      kind,
      label: GROUP_LABELS[kind],
      occurrenceCount: bucketOccurrences.length,
      occurrences: bucketOccurrences,
    });
  }
  return groups;
}

// Re-exported for consumers that only need the raw domain types.
export type { Candidate, ContentBlock, Occurrence };
