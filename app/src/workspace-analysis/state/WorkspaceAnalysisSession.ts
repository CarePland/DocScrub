/**
 * WorkspaceAnalysisSession.ts — this subsystem's own, entirely separate
 * state container. Holds loaded documents, the raw analysis result, and
 * the reviewer's current grouping decisions (accept/split/merge) as
 * in-memory session state.
 *
 * PERSISTENCE, DELIBERATELY DEFERRED: the spec allows persisting the
 * analysis result and confirmed grouping structure "if needed." Nothing
 * downstream reads this state yet -- there is no hand-off to the review
 * pipeline in this phase -- so nothing currently needs it to survive a
 * reload, and adding a storage layer for a structure with no consumer
 * would be exactly the unnecessary complexity CarePland's own engineering
 * principles warn against. This is a scope decision, not an oversight:
 * flagged explicitly in
 * `docs/detection/workspace-analysis-phase-1-findings.md` as a deliberate
 * phase-1 boundary, revisited if/when a future phase wires grouping
 * decisions into the review pipeline (at which point persistence would
 * piggyback on whatever that hand-off actually needs, rather than being
 * guessed at now).
 *
 * INDEPENDENCE: constructed with zero dependency on `ReviewWorkspace`,
 * `ReviewEngine`, or any review-session state -- it can be created,
 * loaded, and analyzed with the review pipeline never having run at all
 * (verified directly in `verify/workspace-analysis-verification.ts`,
 * properties 1 and 2).
 */

import type {
  DocumentPairRelationship,
  RelationshipEvidenceItem,
  WorkspaceAnalysisInputDocument,
  WorkspaceAnalysisResult,
} from "../domain/WorkspaceAnalysisModel.js";
import type { WorkspaceAnalysisEngine } from "../engine/WorkspaceAnalysisEngine.js";
import { DeterministicWorkspaceAnalysisEngine } from "../engine/WorkspaceAnalysisEngine.js";
import { buildRelationshipLookup, canMerge } from "../engine/clustering.js";
import { extractWorkspaceAnalysisDocuments } from "../io/extractText.js";
import type {
  WorkspaceAnalysisCommand,
  WorkspaceAnalysisCommandResult,
} from "./WorkspaceAnalysisCommands.js";

export type WorkspaceAnalysisStatus = "idle" | "analyzing" | "complete" | "error";

/** One current grouping as the reviewer sees it -- every imported
 *  document appears in exactly one grouping, size 1 (unrelated) or more.
 *  Starts as a direct reflection of `WorkspaceAnalysisResult` (one
 *  grouping per proposed cluster, one singleton grouping per unrelated
 *  document) and is only ever modified by accept/split/merge commands. */
export interface WorkspaceGrouping {
  groupingId: string;
  documentIds: string[];
  status: "proposed" | "accepted" | "split" | "merged";
  /** Minimum pairwise relationship score among members, or null for a
   *  singleton grouping (no pair exists to score). */
  strength: number | null;
  reasons: RelationshipEvidenceItem[];
}

export interface WorkspaceAnalysisState {
  status: WorkspaceAnalysisStatus;
  documents: WorkspaceAnalysisInputDocument[];
  result: WorkspaceAnalysisResult | null;
  groupings: WorkspaceGrouping[];
  error: string | null;
}

function initialState(): WorkspaceAnalysisState {
  return { status: "idle", documents: [], result: null, groupings: [], error: null };
}

function groupingsFromResult(result: WorkspaceAnalysisResult): WorkspaceGrouping[] {
  const groupings: WorkspaceGrouping[] = result.clusters.map((cluster) => ({
    groupingId: cluster.clusterId,
    documentIds: cluster.documentIds,
    status: "proposed",
    strength: cluster.strength,
    reasons: cluster.reasons,
  }));
  for (const documentId of result.unrelatedDocumentIds) {
    groupings.push({
      groupingId: `unrelated-${documentId}`,
      documentIds: [documentId],
      status: "proposed",
      strength: null,
      reasons: [],
    });
  }
  return groupings;
}

function minPairwiseScore(documentIds: string[], lookup: Map<string, DocumentPairRelationship>): number | null {
  if (documentIds.length < 2) return null;
  let min = 1;
  for (let i = 0; i < documentIds.length; i++) {
    for (let j = i + 1; j < documentIds.length; j++) {
      const a = documentIds[i];
      const b = documentIds[j];
      if (!a || !b) continue;
      const key = a < b ? `${a}|${b}` : `${b}|${a}`;
      const relationship = lookup.get(key);
      min = Math.min(min, relationship?.score ?? 0);
    }
  }
  return min;
}

function unionReasons(groupings: WorkspaceGrouping[]): RelationshipEvidenceItem[] {
  const byDescription = new Map<string, RelationshipEvidenceItem>();
  for (const grouping of groupings) {
    for (const item of grouping.reasons) {
      const existing = byDescription.get(item.description);
      if (!existing || item.weight > existing.weight) byDescription.set(item.description, item);
    }
  }
  return [...byDescription.values()].sort((a, b) => b.weight - a.weight || a.description.localeCompare(b.description));
}

let groupingCounter = 0;
function nextGroupingId(prefix: string): string {
  groupingCounter += 1;
  return `${prefix}-${groupingCounter}`;
}

export class WorkspaceAnalysisSession {
  private state: WorkspaceAnalysisState = initialState();
  private readonly engine: WorkspaceAnalysisEngine;

  constructor(engine: WorkspaceAnalysisEngine = new DeterministicWorkspaceAnalysisEngine()) {
    this.engine = engine;
  }

  getState(): WorkspaceAnalysisState {
    return this.state;
  }

  /** Async orchestration: extract text from every imported file, then run
   *  the pure engine over the result. Kept off the synchronous `dispatch`
   *  path -- see this file's top doc comment. Degrades gracefully: a
   *  thrown extraction/analysis error moves state to `"error"` rather
   *  than leaving stale or partial state, and never throws back to the
   *  caller (property 7 -- must be able to fail without breaking
   *  anything else in the application). */
  async loadFiles(files: File[]): Promise<WorkspaceAnalysisCommandResult> {
    this.state = { ...initialState(), status: "analyzing" };
    try {
      const documents = await extractWorkspaceAnalysisDocuments(files);
      const result = this.engine.analyzeWorkspace(documents);
      this.state = {
        status: "complete",
        documents,
        result,
        groupings: groupingsFromResult(result),
        error: null,
      };
      return { ok: true };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.state = { ...initialState(), status: "error", error: reason };
      return { ok: false, reason };
    }
  }

  dispatch(command: WorkspaceAnalysisCommand): WorkspaceAnalysisCommandResult {
    switch (command.type) {
      case "accept-grouping":
        return this.acceptGrouping(command.groupingId);
      case "split-grouping":
        return this.splitGrouping(command.groupingId, command.newGroups);
      case "merge-groupings":
        return this.mergeGroupings(command.groupingIdA, command.groupingIdB);
      case "reset":
        this.state = initialState();
        return { ok: true };
      default: {
        const exhaustive: never = command;
        return { ok: false, reason: `unknown workspace analysis command: ${JSON.stringify(exhaustive)}` };
      }
    }
  }

  private acceptGrouping(groupingId: string): WorkspaceAnalysisCommandResult {
    const grouping = this.state.groupings.find((g) => g.groupingId === groupingId);
    if (!grouping) return { ok: false, reason: `no such grouping: ${groupingId}` };
    grouping.status = "accepted";
    return { ok: true };
  }

  private splitGrouping(groupingId: string, newGroups: string[][]): WorkspaceAnalysisCommandResult {
    const index = this.state.groupings.findIndex((g) => g.groupingId === groupingId);
    if (index === -1) return { ok: false, reason: `no such grouping: ${groupingId}` };
    const target = this.state.groupings[index]!;

    const providedIds = newGroups.flat();
    const originalSet = new Set(target.documentIds);
    const providedSet = new Set(providedIds);
    const isValidPartition =
      providedIds.length === target.documentIds.length &&
      providedIds.length === providedSet.size &&
      target.documentIds.every((id) => providedSet.has(id)) &&
      providedIds.every((id) => originalSet.has(id));
    if (!isValidPartition) {
      return {
        ok: false,
        reason: "split groups must exactly partition the original grouping's documents -- no member added or dropped",
      };
    }

    const lookup = this.state.result ? buildRelationshipLookup(this.state.result.pairRelationships) : new Map();
    const replacements: WorkspaceGrouping[] = newGroups.map((documentIds) => ({
      groupingId: nextGroupingId("split"),
      documentIds,
      status: "split",
      strength: minPairwiseScore(documentIds, lookup),
      reasons: target.reasons.filter(() => documentIds.length >= 2),
    }));

    this.state = {
      ...this.state,
      groupings: [...this.state.groupings.slice(0, index), ...replacements, ...this.state.groupings.slice(index + 1)],
    };
    return { ok: true };
  }

  private mergeGroupings(groupingIdA: string, groupingIdB: string): WorkspaceAnalysisCommandResult {
    if (!this.state.result) return { ok: false, reason: "no analysis result to merge against" };
    const a = this.state.groupings.find((g) => g.groupingId === groupingIdA);
    const b = this.state.groupings.find((g) => g.groupingId === groupingIdB);
    if (!a || !b) return { ok: false, reason: "one or both groupings not found" };
    if (a === b) return { ok: false, reason: "cannot merge a grouping with itself" };

    // No ordinary override: a merge is only permitted when the analysis
    // itself independently confirms the combined membership still meets
    // the relationship threshold, i.e. still forms a valid clique.
    if (!canMerge(a.documentIds, b.documentIds, this.state.result.pairRelationships)) {
      return {
        ok: false,
        reason: "these groupings do not meet the relationship threshold as a combined group -- merge refused",
      };
    }

    const lookup = buildRelationshipLookup(this.state.result.pairRelationships);
    const combinedDocumentIds = [...a.documentIds, ...b.documentIds].sort();
    const merged: WorkspaceGrouping = {
      groupingId: nextGroupingId("merged"),
      documentIds: combinedDocumentIds,
      status: "merged",
      strength: minPairwiseScore(combinedDocumentIds, lookup),
      reasons: unionReasons([a, b]),
    };

    this.state = {
      ...this.state,
      groupings: [...this.state.groupings.filter((g) => g !== a && g !== b), merged],
    };
    return { ok: true };
  }
}
