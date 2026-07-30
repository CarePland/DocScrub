/**
 * DecisionReuseEngine — Feature 002 ("Review once. Apply everywhere."), the
 * first genuinely NEW engine added after Gate E closed the migration (every
 * prior engine ported an existing Python module; there is no oracle for
 * this one -- it is a product feature, verified against deterministic
 * behavior/property tests, not a Python diff).
 *
 * Same shape and role as every other analysis engine in this codebase
 * (DetectionEngine/CandidateQualityEngine/EntityResolutionEngine/
 * OccurrenceClassifier): stateless, synchronous, pure -- it COMPUTES a
 * proposal from inputs, it does not apply anything to ReviewSession itself
 * (that remains ReviewEngine's job, via session.ts's applyDecisionReuse
 * case). Workspace is the only caller, and only from importDecisions().
 *
 * THREE DETERMINISTIC MATCHING TIERS, evaluated in this order (a candidate
 * stops at the first tier that matches it):
 *
 * TIER 1 -- "exact-key": DetectionEngine's candidate keys
 * (normalizeCandidate()'s output, e.g. "person:andrew jackson") are a PURE
 * FUNCTION of normalized text + detected type -- confirmed by reading
 * DetectionEngine.ts directly (Phase 4). That means the SAME real-world
 * entity, referred to with the SAME normalized text, produces the IDENTICAL
 * candidateId string across two independently parsed documents. This tier
 * costs one map lookup and is the strongest possible evidence short of the
 * two source documents being byte-identical. Confidence: 100.
 *
 * TIER 2 -- "grouped-alias": for a candidate with no Tier 1 match of its
 * own, check whether THIS document's own EntityResolutionEngine output
 * (GroupingResult.entityGroupProposals, already computed by the time
 * Workspace calls this engine -- see Workspace.loadDocument()) places it in
 * the same proposed group as another candidate that DID get a Tier 1 match.
 * If so, reuse that sibling's decision. This deliberately writes NO new
 * alias-detection logic: it is "reuse existing entity-resolution
 * infrastructure" applied literally, consuming EntityResolutionEngine's
 * already-computed grouping rather than re-deriving name-variant logic here.
 * Ambiguity guard: if a candidate's group contains Tier-1-matched siblings
 * that disagree (different decisions/replacements), this tier deliberately
 * finds no match -- "leave unmatched or ambiguous entities unresolved" is
 * explicit in Andrew's instruction, and silently picking one of two
 * conflicting prior decisions would violate it. Confidence: 90.
 *
 * TIER 3 -- "similarity-threshold": for a candidate still unmatched,
 * compare its own normalized text (again, its candidateId's own suffix --
 * no separate normalization is invented here) against every imported
 * candidate of the SAME detected type, using sequenceRatio() -- the exact
 * Ratcliff/Obershelp port entity_resolution.py's own member-scoring already
 * uses (src/engines/entity-resolution/sequence-ratio.ts), not a different
 * or new similarity algorithm. THRESHOLD = 0.90, MARGIN = 0.05 (see
 * constants below for the full rationale) -- deliberately conservative:
 * misapplying a Redact/Keep decision to the wrong real-world entity is a
 * materially worse failure than a typical fuzzy "did you mean" suggestion,
 * so this tier is tuned to fail closed (leave the candidate unresolved for
 * manual review) rather than fail open. Confidence: the matched ratio,
 * scaled to 0-100.
 *
 * WHAT THIS ENGINE DELIBERATELY DOES NOT DO:
 * - It never inspects or replays imported EntityGroupDecision-level state
 *   (Confirmed/Rejected/Refined) -- only individual candidate decisions.
 *   Group-level decision replay is a real, coherent future extension (an
 *   imported "Confirmed" group could pre-seed the CURRENT document's
 *   analogous group the same way confirmGroup does), but Andrew's Feature
 *   002 instruction is candidate/entity-decision-centric ("for each
 *   detected entity... reuse the prior decision"), and DocumentRebuilder
 *   only ever reads candidateDecisions (see Feature 001's own correctness
 *   finding) -- so candidate-level reuse is both the literal scope and the
 *   part that actually affects output. Documented as an intentional
 *   limitation in feature-002-decision-reuse.md, not a silent gap.
 * - It never uses machine learning, embeddings, or any non-deterministic
 *   signal. Every tier is independently a small, named, testable rule.
 */

import type { DetectionResult } from "./DetectionEngine.js";
import type { EntityGroupProposal, GroupingResult } from "./EntityResolutionEngine.js";
import type { ImportedCandidateDecision, ImportedDecisions, DecisionReuseEvidence, DecisionReuseProposal } from "../domain/DecisionReuse.js";
import { sequenceRatio } from "./entity-resolution/sequence-ratio.js";

export interface DecisionReuseEngine {
  proposeReuse(detection: DetectionResult, grouping: GroupingResult, imported: ImportedDecisions): DecisionReuseProposal[];
}

/** See this file's top doc comment, Tier 3, for the full rationale.
 *  0.90 is deliberately well above the ~0.8 a typical "did you mean" fuzzy
 *  UX default uses -- a false positive here silently applies a stranger's
 *  redaction decision to the wrong person's data, which is a materially
 *  worse failure mode than an unhelpful suggestion, so this tier is tuned
 *  to fail closed. */
const SIMILARITY_THRESHOLD = 0.9;
/** The best match must beat the runner-up (among same-type imported
 *  candidates) by at least this much, or the match is treated as
 *  ambiguous and dropped -- "leave... ambiguous entities unresolved" is
 *  explicit in Andrew's instruction; a threshold alone does not guard
 *  against two comparably-good candidates (e.g. "Jon Reyes" matching both
 *  a prior "John Reyes" and a prior "Jonathan Reyes" almost equally well). */
const SIMILARITY_MARGIN = 0.05;

function splitCandidateKey(candidateId: string): { type: string; normalizedText: string } {
  const idx = candidateId.indexOf(":");
  if (idx === -1) return { type: candidateId, normalizedText: "" };
  return { type: candidateId.slice(0, idx), normalizedText: candidateId.slice(idx + 1) };
}

function decisionsAgree(a: ImportedCandidateDecision, b: ImportedCandidateDecision): boolean {
  return a.decision === b.decision && (a.replacement ?? "") === (b.replacement ?? "");
}

function proposalFrom(candidateId: string, source: ImportedCandidateDecision, evidence: DecisionReuseEvidence): DecisionReuseProposal | null {
  if (source.decision === "Undecided") return null; // nothing to reuse
  return {
    candidateId,
    decision: source.decision,
    ...(source.replacement !== undefined ? { replacement: source.replacement } : {}),
    evidence,
  };
}

export class DeterministicDecisionReuseEngine implements DecisionReuseEngine {
  proposeReuse(detection: DetectionResult, grouping: GroupingResult, imported: ImportedDecisions): DecisionReuseProposal[] {
    const importedDecided = imported.candidates.filter((c) => c.decision !== "Undecided");
    const importedByCandidateId = new Map(importedDecided.map((c) => [c.candidateId, c]));

    const groupByCandidateId = new Map<string, EntityGroupProposal>();
    for (const group of grouping.entityGroupProposals) {
      for (const candidateId of group.candidateIds) groupByCandidateId.set(candidateId, group);
    }

    const proposals: DecisionReuseProposal[] = [];
    const matchedCandidateIds = new Set<string>();

    // --- Tier 1: exact candidate-key match ---------------------------------
    const tier1MatchedIds = new Set<string>();
    for (const candidate of detection.candidates) {
      const source = importedByCandidateId.get(candidate.id);
      if (!source) continue;
      const proposal = proposalFrom(candidate.id, source, {
        tier: "exact-key",
        matchedImportedCandidateId: source.candidateId,
        confidence: 100,
        description: `Exact match: this candidate's normalized key ("${candidate.id}") is identical to a previously decided candidate's key.`,
      });
      if (proposal) {
        proposals.push(proposal);
        matchedCandidateIds.add(candidate.id);
        tier1MatchedIds.add(candidate.id);
      }
    }

    // --- Tier 2: grouped with a Tier-1-matched sibling ----------------------
    for (const candidate of detection.candidates) {
      if (matchedCandidateIds.has(candidate.id)) continue;
      const group = groupByCandidateId.get(candidate.id);
      if (!group) continue;
      const matchedSiblingIds = group.candidateIds.filter((id) => id !== candidate.id && tier1MatchedIds.has(id));
      if (matchedSiblingIds.length === 0) continue;
      const siblingSources = matchedSiblingIds.map((id) => importedByCandidateId.get(id)!);
      const first = siblingSources[0]!;
      const allAgree = siblingSources.every((s) => decisionsAgree(s, first));
      if (!allAgree) continue; // conflicting prior decisions within the same group -- ambiguous, leave unresolved
      const proposal = proposalFrom(candidate.id, first, {
        tier: "grouped-alias",
        matchedImportedCandidateId: first.candidateId,
        confidence: 90,
        description: `Grouped by this document's own entity resolution with "${matchedSiblingIds[0]}" (proposed entity "${group.canonicalName}"), which exactly matched a previously decided candidate.`,
        viaGroupId: group.groupId,
      });
      if (proposal) {
        proposals.push(proposal);
        matchedCandidateIds.add(candidate.id);
      }
    }

    // --- Tier 3: deterministic similarity threshold -------------------------
    const importedByType = new Map<string, ImportedCandidateDecision[]>();
    for (const source of importedDecided) {
      const { type } = splitCandidateKey(source.candidateId);
      const list = importedByType.get(type) ?? [];
      list.push(source);
      importedByType.set(type, list);
    }

    for (const candidate of detection.candidates) {
      if (matchedCandidateIds.has(candidate.id)) continue;
      const { type, normalizedText } = splitCandidateKey(candidate.id);
      const sameTypeSources = importedByType.get(type);
      if (!sameTypeSources || sameTypeSources.length === 0) continue;

      let best: { source: ImportedCandidateDecision; ratio: number } | null = null;
      let secondBestRatio = 0;
      for (const source of sameTypeSources) {
        const { normalizedText: sourceText } = splitCandidateKey(source.candidateId);
        const ratio = sequenceRatio(normalizedText, sourceText);
        if (!best || ratio > best.ratio) {
          secondBestRatio = best?.ratio ?? 0;
          best = { source, ratio };
        } else if (ratio > secondBestRatio) {
          secondBestRatio = ratio;
        }
      }
      if (!best) continue;
      if (best.ratio < SIMILARITY_THRESHOLD) continue;
      if (best.ratio - secondBestRatio < SIMILARITY_MARGIN && sameTypeSources.length > 1) continue; // ambiguous tie

      const proposal = proposalFrom(candidate.id, best.source, {
        tier: "similarity-threshold",
        matchedImportedCandidateId: best.source.candidateId,
        confidence: Math.round(best.ratio * 100),
        description: `Deterministic text similarity (ratio ${best.ratio.toFixed(3)}, threshold ${SIMILARITY_THRESHOLD}) against previously decided candidate "${best.source.candidateId}".`,
        similarityRatio: best.ratio,
      });
      if (proposal) {
        proposals.push(proposal);
        matchedCandidateIds.add(candidate.id);
      }
    }

    return proposals;
  }
}
