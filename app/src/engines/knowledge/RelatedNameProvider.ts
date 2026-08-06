/**
 * RelatedNameProvider -- Deterministic Semantic Relationship Knowledge,
 * Phase 1 (2026-07-30). Loads the curated related-name library
 * (related-names.data.ts, the embedded canonical CSV) into a
 * SemanticRelationshipProvider: deterministic, local-only, loaded at
 * startup, bidirectional, versionable, and free of hard-coded nickname
 * logic -- every relationship comes from the dataset, none from code.
 *
 * VALIDATION ("fail gracefully if malformed"): the loader checks the
 * header and every row (three fields; non-empty names; integer strength
 * 1-5). Malformed rows are SKIPPED with a warning naming the line -- one
 * bad row never poisons the library -- and a wholly-unusable file (wrong
 * header, zero valid rows) degrades to an EMPTY provider plus warnings:
 * the application keeps working exactly as it did before this feature
 * existed, which is the correct failure posture for optional evidence.
 *
 * NORMALIZATION: names are lowercased and trimmed at load; lookups expect
 * the same (the augmentation pass feeds it resolution.ts's own
 * cleanToken() output, so both sides normalize identically).
 * BIDIRECTIONAL: each row (full, related, s) indexes both directions; if
 * duplicate pairs disagree on strength, the STRONGEST wins
 * (deterministic, and the generous reading of curated data).
 */

import { RELATED_NAMES_CSV, RELATED_NAMES_DATASET_VERSION } from "./related-names.data.js";
import { loadFullValueAliasProvider, type FullValueAliasLoadResult } from "./FullValueAliasProvider.js";
import type { RelationStrength, SemanticRelation, SemanticRelationshipProvider } from "./SemanticRelationshipProvider.js";

export interface RelatedNameLoadResult {
  provider: SemanticRelationshipProvider;
  /** One line per problem found; empty for a clean load. */
  warnings: string[];
  /** Distinct directed entries indexed (2x the accepted row count, minus
   *  strength-merged duplicates). */
  relationCount: number;
  acceptedRowCount: number;
}

const EXPECTED_HEADER = "full_name,related_name,score";

/** The application's built-in provider set, loaded once at startup
 *  (memoized). Loader warnings surface via console.warn -- a malformed
 *  dataset degrades to an empty provider and the application behaves as
 *  it did before this feature existed (graceful failure, per the spec).
 *  Future built-in providers (acronyms, organization aliases) join this
 *  list; user-confirmed alias providers would be constructed per-session
 *  and appended by the Workspace. */
let builtInLoad: RelatedNameLoadResult | null = null;

let builtInFullValueLoad: FullValueAliasLoadResult | null = null;

export function builtInSemanticRelationshipProviders(): readonly SemanticRelationshipProvider[] {
  if (builtInLoad === null) {
    builtInLoad = loadRelatedNameProvider();
    for (const warning of builtInLoad.warnings) console.warn(warning);
  }
  // Phase 2 (2026-07-30): the full-value alias library joins the built-in
  // set -- same graceful-degradation posture.
  if (builtInFullValueLoad === null) {
    builtInFullValueLoad = loadFullValueAliasProvider();
    for (const warning of builtInFullValueLoad.warnings) console.warn(warning);
  }
  return [builtInLoad.provider, builtInFullValueLoad.provider];
}

export function loadRelatedNameProvider(csvText: string = RELATED_NAMES_CSV, datasetVersion: string = RELATED_NAMES_DATASET_VERSION): RelatedNameLoadResult {
  const warnings: string[] = [];
  const relations = new Map<string, Map<string, RelationStrength>>();
  let acceptedRowCount = 0;

  const addDirected = (from: string, to: string, strength: RelationStrength): void => {
    const bucket = relations.get(from) ?? new Map<string, RelationStrength>();
    const existing = bucket.get(to);
    if (existing === undefined || strength > existing) bucket.set(to, strength);
    relations.set(from, bucket);
  };

  const lines = csvText.split(/\r?\n/);
  const headerLine = lines[0]?.trim().toLowerCase() ?? "";
  if (headerLine !== EXPECTED_HEADER) {
    warnings.push(`related-name library: unexpected header "${headerLine || "(empty)"}" -- expected "${EXPECTED_HEADER}"; library disabled`);
  } else {
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]!.trim();
      if (line.length === 0) continue;
      const fields = line.split(",");
      if (fields.length !== 3) {
        warnings.push(`related-name library: line ${i + 1} has ${fields.length} fields (expected 3) -- skipped`);
        continue;
      }
      const full = fields[0]!.trim().toLowerCase();
      const related = fields[1]!.trim().toLowerCase();
      const scoreRaw = fields[2]!.trim();
      const score = Number(scoreRaw);
      if (!full || !related) {
        warnings.push(`related-name library: line ${i + 1} has an empty name -- skipped`);
        continue;
      }
      if (!Number.isInteger(score) || score < 1 || score > 5) {
        warnings.push(`related-name library: line ${i + 1} strength "${scoreRaw}" is not an integer 1-5 -- skipped`);
        continue;
      }
      if (full === related) {
        warnings.push(`related-name library: line ${i + 1} relates "${full}" to itself -- skipped`);
        continue;
      }
      const strength = score as RelationStrength;
      addDirected(full, related, strength);
      addDirected(related, full, strength);
      acceptedRowCount += 1;
    }
    if (acceptedRowCount === 0) warnings.push("related-name library: no valid rows -- library disabled");
  }

  let relationCount = 0;
  for (const bucket of relations.values()) relationCount += bucket.size;

  const provider: SemanticRelationshipProvider = {
    id: "related-name",
    termDomain: "name-token",
    // Trimmed from "Related-name relationship" (2026-07-30, Andrew's
    // narrative-language pass): the ↔ line already SHOWS a relationship.
    evidenceLabel: "Related name",
    describe: () => `Related-name library, ${datasetVersion} -- ${acceptedRowCount} curated relationships`,
    relationsOf(term: string): readonly SemanticRelation[] {
      const bucket = relations.get(term);
      if (!bucket) return [];
      // Deterministic order: strength desc, then term -- stable evidence
      // and option ordering downstream.
      return [...bucket.entries()]
        .map(([relatedTerm, strength]) => ({ term: relatedTerm, strength }))
        .sort((a, b) => b.strength - a.strength || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0));
    },
    strengthBetween(a: string, b: string): RelationStrength | null {
      return relations.get(a)?.get(b) ?? null;
    },
  };

  return { provider, warnings, relationCount, acceptedRowCount };
}
