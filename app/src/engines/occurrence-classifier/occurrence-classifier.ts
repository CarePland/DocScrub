/**
 * occurrence-classifier.ts -- the additive enrichment adapter for Phase 7.
 * Builds ReviewOccurrence[] (OccurrenceClassifier.ts) by cross-referencing
 * already-computed DetectionResult/QualityResult/GroupingResult onto each
 * Occurrence, plus computing StructuredContext and the classification.ts
 * groupKind for each one. Nothing here is parity-critical against Python
 * (occurrence_groups.py has no equivalent of ReviewOccurrence at all -- see
 * OccurrenceClassifier.ts's top doc comment); classification.ts is the
 * parity-critical piece this file builds on top of, not around.
 *
 * ORDERING (additive design decision, not a Python deviation): Python's own
 * group_occurrences() never sorts -- bucket-internal order is simply
 * whatever order occurrences arrived in, an accident of iteration, not a
 * tested contract (confirmed by reading the source directly; see
 * classification.ts's groupOccurrences() doc comment). Andrew's Phase 7
 * instruction explicitly asks to make ordering "stable regardless of
 * JavaScript iteration order, Map insertion order, parser traversal
 * differences, future optimization work" and to "document explicitly" any
 * ordering rule that's implicit in Python. Since Python has no real
 * ordering contract to preserve here, this port introduces one: sort by
 * (containing ContentBlock.order, Occurrence.startOffset) -- natural
 * document reading order. This is deterministic by construction (no
 * dependency on Map/object key order), independent of candidate-detection
 * order, and matches how a human reviewer would expect to page through a
 * document top-to-bottom. `order` on each ReviewOccurrence is this final
 * sorted position (0-based).
 */

import type { DetectionResult } from "../DetectionEngine.js";
import type { Candidate, ContentBlock, DocumentModel, Occurrence } from "../../domain/DocumentModel.js";
import type { QualityResult } from "../../domain/Evidence.js";
import type { GroupingResult } from "../EntityResolutionEngine.js";
import type { ReviewOccurrence, StructuredContext } from "../OccurrenceClassifier.js";
import { occurrenceGroupKind } from "./classification.js";

// Matches redactor/detectors.py's context_snippet()'s default window=70 --
// see DetectionEngine.ts's contextSnippet(), the same constant used to
// build Occurrence.context in the first place. Kept identical here so
// StructuredContext's before/after windows are the same width a reviewer
// would see in the existing rendered context string, just structured
// instead of pre-formatted.
const CONTEXT_WINDOW = 70;

function buildStructuredContext(block: ContentBlock, occurrence: Occurrence): StructuredContext {
  const { text } = block;
  const { startOffset, endOffset } = occurrence;
  const left = Math.max(0, startOffset - CONTEXT_WINDOW);
  const right = Math.min(text.length, endOffset + CONTEXT_WINDOW);
  return {
    before: text.slice(left, startOffset),
    match: text.slice(startOffset, endOffset),
    after: text.slice(endOffset, right),
  };
}

/**
 * Builds every occurrence's enriched ReviewOccurrence record, in explicit
 * document order. Pure function: reads document/detection/quality/grouping,
 * invents nothing, mutates nothing -- matches OccurrenceClassifier's "must
 * not detect new entities, alter candidate quality, merge entity groups,
 * create ambiguity proposals" constraint by construction (there is no
 * pathway here that could do any of those things).
 */
export function buildReviewOccurrences(
  document: DocumentModel,
  detection: DetectionResult,
  quality: QualityResult,
  grouping: GroupingResult
): ReviewOccurrence[] {
  const blockById = new Map<string, ContentBlock>(document.blocks.map((b) => [b.id, b]));
  const candidateById = new Map<string, Candidate>(detection.candidates.map((c) => [c.id, c]));

  // entityGroupId lookup: EntityGroupProposal.candidateIds holds candidate
  // KEYS (see EntityResolutionEngine.ts's toProposal -- candidateIds:
  // group.candidateKeys), so this maps candidateId -> the one group (if
  // any) that lists it as a member. A candidate belongs to at most one
  // proposed group by construction of buildEntityGroups() (Phase 6); if
  // that ever changes, this takes the first match, consistent with
  // "expose information rather than invent it" -- it does not adjudicate
  // between groups.
  const entityGroupIdByCandidateId = new Map<string, string>();
  for (const group of grouping.entityGroupProposals) {
    for (const candidateId of group.candidateIds) {
      if (!entityGroupIdByCandidateId.has(candidateId)) {
        entityGroupIdByCandidateId.set(candidateId, group.groupId);
      }
    }
  }

  const enriched: Array<{ occ: ReviewOccurrence; blockOrder: number }> = [];

  for (const occurrence of detection.occurrences) {
    const block = blockById.get(occurrence.blockId);
    if (!block) continue; // Structurally impossible for well-formed DetectionResult input; skip defensively rather than throw.
    const candidate = candidateById.get(occurrence.candidateId);

    const assessment = quality.assessmentByCandidate[occurrence.candidateId];
    const score = quality.scoreByCandidate[occurrence.candidateId];
    const entityGroupId = entityGroupIdByCandidateId.get(occurrence.candidateId);

    const reviewOccurrence: ReviewOccurrence = {
      occurrenceId: occurrence.id,
      candidateId: occurrence.candidateId,
      detectedType: candidate?.detectedType ?? "unknown",
      blockId: block.id,
      blockKind: block.kind,
      sourceRef: block.sourceMapping.sourceRef,
      startOffset: occurrence.startOffset,
      endOffset: occurrence.endOffset,
      groupKind: occurrenceGroupKind(occurrence),
      context: buildStructuredContext(block, occurrence),
      ...(entityGroupId !== undefined ? { entityGroupId } : {}),
      ...(assessment ? { quality: assessment.quality } : {}),
      ...(score !== undefined ? { candidateScore: score } : {}),
      detectorConfidence: candidate?.confidence ?? "low",
      order: 0, // placeholder, assigned after sort below
    };

    enriched.push({ occ: reviewOccurrence, blockOrder: block.order });
  }

  enriched.sort((a, b) => {
    if (a.blockOrder !== b.blockOrder) return a.blockOrder - b.blockOrder;
    return a.occ.startOffset - b.occ.startOffset;
  });

  enriched.forEach((entry, index) => {
    entry.occ.order = index;
  });

  return enriched.map((entry) => entry.occ);
}
