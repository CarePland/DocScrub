/**
 * clustering.ts — turns pairwise relationships into
 * `WorkspaceClusterProposal`s using CLIQUE-based grouping, not connected
 * components.
 *
 * WHY CLIQUES, NOT CONNECTED COMPONENTS: connected components would let a
 * single "bridge" document -- one that happens to relate to two otherwise
 * unrelated documents (e.g. a generic cover letter mentioning both
 * matters) -- transitively merge unrelated documents into one proposed
 * workspace. A clique requires every member to independently satisfy the
 * relationship threshold with every OTHER member, so a bridge document
 * can belong to two separate clusters, but cannot drag its two neighbors
 * into the same cluster as each other. This directly serves the spec's
 * explicit principle: "a false cross-document relationship is worse than
 * a missed opportunity to group documents."
 *
 * PARTITIONING, NOT OVERLAP: clusters are assigned so each document ends
 * up in at most one proposed cluster (see `assignCliquesGreedily` below).
 * The UI's per-cluster actions (accept, split, merge) are simplest to
 * reason about, and to explain to a caregiver-facing reviewer, when a
 * document has exactly one current grouping to act on -- not several
 * overlapping proposals to reconcile. A document that participates in
 * multiple candidate cliques is assigned to the first one considered in
 * the deterministic priority order established below (larger cliques
 * first, then stronger, then lexicographic tie-break), and any remaining
 * unclaimed members of a passed-over clique -- still a valid clique,
 * since every subset of a clique is itself a clique -- can still form
 * their own (smaller) cluster later in the same pass.
 */

import type {
  DocumentFingerprint,
  DocumentPairRelationship,
  RelationshipEvidenceItem,
  WorkspaceClusterProposal,
} from "../domain/WorkspaceAnalysisModel.js";

function pairKey(idA: string, idB: string): string {
  return idA < idB ? `${idA}|${idB}` : `${idB}|${idA}`;
}

export function buildRelationshipLookup(
  relationships: DocumentPairRelationship[]
): Map<string, DocumentPairRelationship> {
  const lookup = new Map<string, DocumentPairRelationship>();
  for (const relationship of relationships) {
    lookup.set(pairKey(relationship.documentIdA, relationship.documentIdB), relationship);
  }
  return lookup;
}

function buildAdjacency(documentIds: string[], lookup: Map<string, DocumentPairRelationship>): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  for (const id of documentIds) adjacency.set(id, new Set());
  for (let i = 0; i < documentIds.length; i++) {
    for (let j = i + 1; j < documentIds.length; j++) {
      const idA = documentIds[i];
      const idB = documentIds[j];
      if (!idA || !idB) continue;
      const relationship = lookup.get(pairKey(idA, idB));
      if (relationship?.meetsThreshold) {
        adjacency.get(idA)?.add(idB);
        adjacency.get(idB)?.add(idA);
      }
    }
  }
  return adjacency;
}

/** Bron-Kerbosch without pivoting, over sorted candidate sets at every
 *  recursive step, so the enumeration order (and therefore, combined with
 *  the deterministic sort in `assignCliquesGreedily`, the final cluster
 *  assignment) never depends on Map/Set iteration order or input order --
 *  only on document IDs and the relationship graph itself. Import
 *  batches are small (a handful to a few dozen documents), so the
 *  worst-case exponential blow-up of clique enumeration is not a
 *  practical concern here. */
function findMaximalCliques(documentIds: string[], adjacency: Map<string, Set<string>>): string[][] {
  const cliques: string[][] = [];
  const sortedIds = [...documentIds].sort();

  function bronKerbosch(current: string[], candidates: string[], excluded: string[]): void {
    if (candidates.length === 0 && excluded.length === 0) {
      if (current.length >= 2) cliques.push([...current].sort());
      return;
    }
    let remainingCandidates = [...candidates];
    let remainingExcluded = [...excluded];
    for (const vertex of [...candidates]) {
      const neighbors = adjacency.get(vertex) ?? new Set();
      const nextCandidates = remainingCandidates.filter((v) => v !== vertex && neighbors.has(v));
      const nextExcluded = remainingExcluded.filter((v) => neighbors.has(v));
      bronKerbosch([...current, vertex], nextCandidates, nextExcluded);
      remainingCandidates = remainingCandidates.filter((v) => v !== vertex);
      remainingExcluded = [...remainingExcluded, vertex];
    }
  }

  bronKerbosch([], sortedIds, []);
  return cliques;
}

function cliqueStrength(clique: string[], lookup: Map<string, DocumentPairRelationship>): number {
  let minScore = 1;
  for (let i = 0; i < clique.length; i++) {
    for (let j = i + 1; j < clique.length; j++) {
      const a = clique[i];
      const b = clique[j];
      if (!a || !b) continue;
      const relationship = lookup.get(pairKey(a, b));
      minScore = Math.min(minScore, relationship?.score ?? 0);
    }
  }
  return minScore;
}

function collectReasons(clique: string[], lookup: Map<string, DocumentPairRelationship>): RelationshipEvidenceItem[] {
  const byDescription = new Map<string, RelationshipEvidenceItem>();
  for (let i = 0; i < clique.length; i++) {
    for (let j = i + 1; j < clique.length; j++) {
      const a = clique[i];
      const b = clique[j];
      if (!a || !b) continue;
      const relationship = lookup.get(pairKey(a, b));
      for (const item of relationship?.evidence ?? []) {
        const existing = byDescription.get(item.description);
        if (!existing || item.weight > existing.weight) {
          byDescription.set(item.description, item);
        }
      }
    }
  }
  return [...byDescription.values()].sort((x, y) => y.weight - x.weight || x.description.localeCompare(y.description));
}

/** Deterministic priority order: larger cliques first (a bigger confirmed
 *  workspace is more useful to surface than a fragment of it), then
 *  stronger cliques, then a lexicographic tie-break over the member IDs
 *  so equal-size-equal-strength cliques always resolve the same way. */
function sortCliquesByPriority(cliques: string[][], lookup: Map<string, DocumentPairRelationship>): string[][] {
  return [...cliques].sort((a, b) => {
    if (b.length !== a.length) return b.length - a.length;
    const strengthDiff = cliqueStrength(b, lookup) - cliqueStrength(a, lookup);
    if (strengthDiff !== 0) return strengthDiff;
    return a.join(",").localeCompare(b.join(","));
  });
}

function assignCliquesGreedily(
  cliques: string[][],
  lookup: Map<string, DocumentPairRelationship>
): WorkspaceClusterProposal[] {
  const claimed = new Set<string>();
  const proposals: WorkspaceClusterProposal[] = [];
  let clusterIndex = 0;

  for (const clique of sortCliquesByPriority(cliques, lookup)) {
    const unclaimedMembers = clique.filter((id) => !claimed.has(id));
    // Every subset of a clique is itself a clique, so this remains a
    // valid, threshold-satisfying grouping even after removing members
    // already claimed by a higher-priority cluster.
    if (unclaimedMembers.length < 2) continue;
    for (const id of unclaimedMembers) claimed.add(id);
    clusterIndex += 1;
    proposals.push({
      clusterId: `workspace-${clusterIndex}`,
      documentIds: unclaimedMembers,
      strength: cliqueStrength(unclaimedMembers, lookup),
      reasons: collectReasons(unclaimedMembers, lookup),
    });
  }

  return proposals;
}

export function clusterDocuments(
  fingerprints: DocumentFingerprint[],
  relationships: DocumentPairRelationship[]
): { clusters: WorkspaceClusterProposal[]; unrelatedDocumentIds: string[] } {
  const documentIds = fingerprints.map((f) => f.documentId);
  const lookup = buildRelationshipLookup(relationships);
  const adjacency = buildAdjacency(documentIds, lookup);
  const cliques = findMaximalCliques(documentIds, adjacency);
  const clusters = assignCliquesGreedily(cliques, lookup);

  const claimed = new Set(clusters.flatMap((c) => c.documentIds));
  const unrelatedDocumentIds = documentIds.filter((id) => !claimed.has(id)).sort();

  return { clusters, unrelatedDocumentIds };
}

/** Validates a proposed manual merge of two existing clusters. Per the
 *  spec, there is deliberately no ordinary override to combine unrelated
 *  groups -- a merge is only permitted when the COMBINED membership is
 *  itself a valid clique, i.e. every document in A relates to every
 *  document in B (and A and B are each already internally valid, which
 *  they are, being existing cluster proposals). This is the same
 *  threshold gate as initial clustering, just applied across two
 *  existing groups instead of individual documents. */
export function canMerge(
  clusterA: readonly string[],
  clusterB: readonly string[],
  relationships: DocumentPairRelationship[]
): boolean {
  const lookup = buildRelationshipLookup(relationships);
  for (const a of clusterA) {
    for (const b of clusterB) {
      const relationship = lookup.get(pairKey(a, b));
      if (!relationship?.meetsThreshold) return false;
    }
  }
  return true;
}
