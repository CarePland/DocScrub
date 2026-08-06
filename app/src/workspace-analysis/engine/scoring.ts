/**
 * scoring.ts — turns a pair of `DocumentFingerprint`s into a
 * `DocumentPairRelationship`: per-category evidence, an additive
 * clamped [0,1] score, and a threshold gate.
 *
 * DESIGN: ADDITIVE + PER-CATEGORY CAPPED, NOT AVERAGED. Each evidence
 * category contributes independently, but every category has a ceiling on
 * how much it alone can add to the total. This is what makes the
 * "generic/formatting-driven false similarity" boundary hold structurally
 * rather than by hope: vocabulary-overlap and structure-similarity --
 * the two signals easiest to trigger by coincidence (any two business
 * letters share common words and rough shape) -- have low per-category
 * caps that, even combined, cannot reach `MINIMUM_RELATIONSHIP_THRESHOLD`.
 * Crossing the threshold requires at least one specific, low-coincidence
 * signal: a shared identifier, organization, email domain, acronym, or
 * enough distinctive terms. See the worked combinations below each
 * constant block for the reasoning made concrete.
 */

import type {
  DocumentFingerprint,
  DocumentPairRelationship,
  RelationshipEvidenceItem,
  RelationshipEvidenceKind,
} from "../domain/WorkspaceAnalysisModel.js";

/** Per-item weight and per-category cap for each evidence kind. The cap
 *  exists independently of the per-item weight so that, e.g., five
 *  incidental shared acronyms can't quietly out-weigh one shared matter
 *  number -- no category can contribute more than its cap no matter how
 *  many items it finds. Ordered here from strongest to weakest signal;
 *  the ordering matches the doc comments on `DocumentFingerprint` itself. */
const CATEGORY_WEIGHTS: Record<RelationshipEvidenceKind, { perItem: number; cap: number }> = {
  // A shared matter/case/docket number is close to direct evidence two
  // documents belong to the same file -- one match alone is most of the
  // way to the threshold by design.
  "shared-identifier": { perItem: 0.35, cap: 0.5 },
  // A shared named organization (with a real suffix like Inc/LLC/Corp) is
  // strong but not as conclusive as a literal identifier -- two documents
  // can legitimately mention the same well-known company without being
  // related to each other.
  "shared-organization": { perItem: 0.2, cap: 0.35 },
  // A shared private email domain is strong evidence of a shared party,
  // but capped below identifiers/organizations since a domain can be
  // shared across many unrelated matters handled by the same firm/company.
  "shared-email-domain": { perItem: 0.2, cap: 0.3 },
  // Distinctive multi-word capitalized phrases (candidate names) --
  // meaningful but noisier than the above, so more items are needed to
  // reach the same contribution.
  "shared-distinctive-term": { perItem: 0.08, cap: 0.3 },
  // Repeated, non-generic acronyms -- a real but weaker signal than named
  // entities since acronyms are shorter and collide more easily.
  "shared-acronym": { perItem: 0.12, cap: 0.25 },
  // Filename similarity is useful corroboration (e.g. a shared matter
  // number embedded in both filenames) but filenames are also often
  // generic or auto-generated, so it is capped low and scored as a single
  // aggregate item, not per shared token.
  "filename-similarity": { perItem: 0.15, cap: 0.15 },
  // Vocabulary overlap is the easiest signal to trigger by coincidence --
  // any two documents in the same domain (e.g. two unrelated legal
  // letters) share common words. Capped low enough that it can never be a
  // primary driver of a match.
  "vocabulary-overlap": { perItem: 0.15, cap: 0.15 },
  // Structure similarity (paragraph-count/length buckets) is the weakest
  // possible signal -- shared document shape reflects a shared template
  // or format, not a shared subject. Kept as a small tie-breaking
  // corroborator only.
  "structure-similarity": { perItem: 0.05, cap: 0.05 },
};

/** The single gate every clustering/merge decision in this subsystem
 *  reads. Set so that the two weakest categories combined
 *  (vocabulary-overlap 0.15 + structure-similarity 0.05 = 0.20) fall far
 *  short, and even adding filename-similarity's cap (+0.15 = 0.35) still
 *  falls short -- crossing 0.45 requires at least one specific signal
 *  (an identifier, organization, email domain, or a meaningful cluster of
 *  distinctive terms/acronyms), matching the "false relationships are
 *  worse than missed opportunities" principle from the spec. */
export const MINIMUM_RELATIONSHIP_THRESHOLD = 0.45;

function jaccard(a: readonly string[], b: readonly string[]): { shared: string[]; similarity: number } {
  const setA = new Set(a);
  const setB = new Set(b);
  const shared = [...setA].filter((item) => setB.has(item)).sort();
  const unionSize = new Set([...setA, ...setB]).size;
  const similarity = unionSize === 0 ? 0 : shared.length / unionSize;
  return { shared, similarity };
}

/** Cosine similarity over term-frequency vectors, restricted to the
 *  shared vocabulary (sparse dot product) -- standard, deterministic,
 *  no randomness or external corpus. */
function cosineSimilarity(a: Record<string, number>, b: Record<string, number>): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const value of Object.values(a)) normA += value * value;
  for (const value of Object.values(b)) normB += value * value;
  for (const [term, countA] of Object.entries(a)) {
    const countB = b[term];
    if (countB) dot += countA * countB;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function evidenceForSharedItems(
  kind: RelationshipEvidenceKind,
  shared: string[],
  describe: (value: string) => string
): RelationshipEvidenceItem[] {
  if (shared.length === 0) return [];
  const { perItem, cap } = CATEGORY_WEIGHTS[kind];
  // Distribute the cap across items so total contribution never exceeds
  // the category cap, while a single strong item still carries most of
  // its full per-item weight (only reduced once more than one item pushes
  // the raw sum past the cap).
  const rawTotal = perItem * shared.length;
  const scale = rawTotal > cap ? cap / rawTotal : 1;
  return shared.map((value) => ({
    kind,
    value,
    description: describe(value),
    weight: perItem * scale,
  }));
}

function evidenceForAggregateSignal(
  kind: RelationshipEvidenceKind,
  similarity: number,
  description: string
): RelationshipEvidenceItem[] {
  if (similarity <= 0) return [];
  const { cap } = CATEGORY_WEIGHTS[kind];
  return [{ kind, description, weight: cap * similarity }];
}

export function scorePair(a: DocumentFingerprint, b: DocumentFingerprint): DocumentPairRelationship {
  const evidence: RelationshipEvidenceItem[] = [];

  const identifiers = jaccard(a.identifiers, b.identifiers);
  evidence.push(
    ...evidenceForSharedItems("shared-identifier", identifiers.shared, (v) => `Both reference identifier "${v}".`)
  );

  const organizations = jaccard(a.organizations, b.organizations);
  evidence.push(
    ...evidenceForSharedItems("shared-organization", organizations.shared, (v) => `Both mention "${v}".`)
  );

  const emailDomains = jaccard(a.emailDomains, b.emailDomains);
  evidence.push(
    ...evidenceForSharedItems("shared-email-domain", emailDomains.shared, (v) => `Both reference email domain "${v}".`)
  );

  const distinctiveTerms = jaccard(a.distinctiveTerms, b.distinctiveTerms);
  evidence.push(
    ...evidenceForSharedItems("shared-distinctive-term", distinctiveTerms.shared, (v) => `Both mention "${v}".`)
  );

  const acronyms = jaccard(a.acronyms, b.acronyms);
  evidence.push(
    ...evidenceForSharedItems("shared-acronym", acronyms.shared, (v) => `Both use the acronym "${v}".`)
  );

  const filenames = jaccard(a.filenameTokens, b.filenameTokens);
  if (filenames.shared.length > 0) {
    evidence.push(
      ...evidenceForAggregateSignal(
        "filename-similarity",
        filenames.similarity,
        `Filenames share ${filenames.shared.length === 1 ? "the term" : "terms"} ${filenames.shared.map((t) => `"${t}"`).join(", ")}.`
      )
    );
  }

  const vocabularySimilarity = cosineSimilarity(a.termFrequency, b.termFrequency);
  evidence.push(
    ...evidenceForAggregateSignal(
      "vocabulary-overlap",
      vocabularySimilarity,
      "Documents share a notable amount of common vocabulary."
    )
  );

  if (a.structureSignature === b.structureSignature) {
    evidence.push(
      ...evidenceForAggregateSignal("structure-similarity", 1, "Documents have a similar overall shape and length.")
    );
  }

  const rawScore = evidence.reduce((sum, item) => sum + item.weight, 0);
  const score = Math.max(0, Math.min(1, rawScore));

  return {
    documentIdA: a.documentId,
    documentIdB: b.documentId,
    score,
    evidence: evidence.sort((x, y) => y.weight - x.weight),
    meetsThreshold: score >= MINIMUM_RELATIONSHIP_THRESHOLD,
  };
}

export function scoreAllPairs(fingerprints: DocumentFingerprint[]): DocumentPairRelationship[] {
  const relationships: DocumentPairRelationship[] = [];
  for (let i = 0; i < fingerprints.length; i++) {
    for (let j = i + 1; j < fingerprints.length; j++) {
      const a = fingerprints[i];
      const b = fingerprints[j];
      if (!a || !b) continue;
      relationships.push(scorePair(a, b));
    }
  }
  return relationships;
}
