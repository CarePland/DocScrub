/**
 * WorkspaceAnalysisEngine.ts — the public interface for this subsystem's
 * pure analysis step: `WorkspaceAnalysisInputDocument[]` in,
 * `WorkspaceAnalysisResult` out. No I/O, no review-pipeline imports.
 *
 * Mirrors the existing `interface X` + `class ConcreteX implements X`
 * convention used elsewhere in this codebase (e.g.
 * `EntityResolutionEngine`/`RegexEntityResolutionEngine`) for stylistic
 * consistency -- this is a style match only; nothing here imports from
 * `src/engines/`.
 */

import type { WorkspaceAnalysisInputDocument, WorkspaceAnalysisResult } from "../domain/WorkspaceAnalysisModel.js";
import { buildFingerprint } from "./fingerprint.js";
import { scoreAllPairs } from "./scoring.js";
import { clusterDocuments } from "./clustering.js";

export interface WorkspaceAnalysisEngine {
  analyzeWorkspace(documents: WorkspaceAnalysisInputDocument[]): WorkspaceAnalysisResult;
}

/** Deterministic, synchronous, dependency-free implementation. Given the
 *  same input documents (same `documentId`, `fileName`, `text`), always
 *  produces byte-identical output -- asserted directly in
 *  `verify/workspace-analysis-verification.ts` (property 3: "stable
 *  deterministic results"). */
export class DeterministicWorkspaceAnalysisEngine implements WorkspaceAnalysisEngine {
  analyzeWorkspace(documents: WorkspaceAnalysisInputDocument[]): WorkspaceAnalysisResult {
    // Sort by documentId up front so downstream ordering (fingerprints,
    // pair enumeration) never depends on the caller's array order --
    // only on document identity.
    const sortedDocuments = [...documents].sort((a, b) => a.documentId.localeCompare(b.documentId));
    const fingerprints = sortedDocuments.map(buildFingerprint);

    if (fingerprints.length === 0) {
      return { fingerprints: [], pairRelationships: [], clusters: [], unrelatedDocumentIds: [] };
    }

    if (fingerprints.length === 1) {
      // A single document has no pair to relate to -- it is trivially
      // "unrelated," not an error. Degrades gracefully per the spec
      // (property 7: can return no clusters without breaking anything).
      return {
        fingerprints,
        pairRelationships: [],
        clusters: [],
        unrelatedDocumentIds: [fingerprints[0]!.documentId],
      };
    }

    const pairRelationships = scoreAllPairs(fingerprints);
    const { clusters, unrelatedDocumentIds } = clusterDocuments(fingerprints, pairRelationships);

    return { fingerprints, pairRelationships, clusters, unrelatedDocumentIds };
  }
}
