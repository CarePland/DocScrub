/**
 * FullValueAliasProvider -- Deterministic Semantic Relationship Knowledge,
 * Phase 2 (2026-07-30). The `"full-value"` provider the Phase 1
 * architecture reserved a seam for: curated acronym and organization-alias
 * relationships between WHOLE candidate values ("NSC" ~ "National Student
 * Clearinghouse", "Cal State LA" ~ "California State University, Los
 * Angeles"). Same SemanticRelationshipProvider interface, same ordinal
 * strengths, same loader posture (validate, warn per bad row, degrade to
 * an empty provider on an unusable file) -- no parallel architecture.
 *
 * NORMALIZATION POLICY (normalizeFullValue, exported -- the augmenter uses
 * the SAME function on candidate values so both sides of every comparison
 * normalize identically). Applied, in order:
 *   1. Unicode NFKC (compatibility fold -- full-width forms, ligatures);
 *   2. case fold (toLowerCase);
 *   3. periods and apostrophes REMOVED as characters ("N.S.C." -> "nsc",
 *      "St. John's" -> "st johns" -- tokens are never dropped, only the
 *      punctuation marks themselves);
 *   4. commas and hyphens become SPACES ("University, Los Angeles" /
 *      "Cal-State" -> word-separated);
 *   5. whitespace runs collapse to one space; trim.
 * PRESERVED, deliberately (the "must not erase distinctions" boundary):
 * every word (no stopword removal -- "University of X" and "University
 * for X" stay distinct), digits, "&" (an "&" name and an "and" name are
 * different names unless the dataset says otherwise), and word ORDER.
 * The dataset can always add explicit rows for variants the
 * normalization deliberately refuses to collapse.
 */

import { FULL_VALUE_ALIASES_DATA, FULL_VALUE_ALIASES_DATASET_VERSION } from "./full-value-aliases.data.js";
import type { RelationStrength, SemanticRelation, SemanticRelationshipProvider } from "./SemanticRelationshipProvider.js";

export function normalizeFullValue(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/[,\-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface FullValueAliasLoadResult {
  provider: SemanticRelationshipProvider;
  warnings: string[];
  acceptedRowCount: number;
}

const EXPECTED_HEADER = "value_a|value_b|kind|score";
// Trimmed from "Acronym relationship"/"Alias relationship" (2026-07-30,
// Andrew's narrative-language pass) -- the ↔ line already shows the
// relationship; the label only needs to name its KIND. NOTE: the
// recommendation module's acronym-flavor detection keys on the "Acronym"
// prefix of these lines (src/ui/recommendations.ts) -- keep in sync.
const KIND_LABELS: Record<string, string> = { acronym: "Acronym", alias: "Alias" };

export function loadFullValueAliasProvider(dataText: string = FULL_VALUE_ALIASES_DATA, datasetVersion: string = FULL_VALUE_ALIASES_DATASET_VERSION): FullValueAliasLoadResult {
  const warnings: string[] = [];
  const relations = new Map<string, Map<string, { strength: RelationStrength; label: string }>>();
  let acceptedRowCount = 0;

  const addDirected = (from: string, to: string, strength: RelationStrength, label: string): void => {
    const bucket = relations.get(from) ?? new Map<string, { strength: RelationStrength; label: string }>();
    const existing = bucket.get(to);
    if (existing === undefined || strength > existing.strength) bucket.set(to, { strength, label });
    relations.set(from, bucket);
  };

  const lines = dataText.split(/\r?\n/);
  const headerLine = lines[0]?.trim().toLowerCase() ?? "";
  if (headerLine !== EXPECTED_HEADER) {
    warnings.push(`full-value alias library: unexpected header "${headerLine || "(empty)"}" -- expected "${EXPECTED_HEADER}"; library disabled`);
  } else {
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]!.trim();
      if (line.length === 0) continue;
      const fields = line.split("|");
      if (fields.length !== 4) {
        warnings.push(`full-value alias library: line ${i + 1} has ${fields.length} fields (expected 4) -- skipped`);
        continue;
      }
      const a = normalizeFullValue(fields[0]!);
      const b = normalizeFullValue(fields[1]!);
      const kind = fields[2]!.trim().toLowerCase();
      const scoreRaw = fields[3]!.trim();
      const score = Number(scoreRaw);
      if (!a || !b) {
        warnings.push(`full-value alias library: line ${i + 1} has an empty value -- skipped`);
        continue;
      }
      if (!(kind in KIND_LABELS)) {
        warnings.push(`full-value alias library: line ${i + 1} kind "${kind}" is not acronym|alias -- skipped`);
        continue;
      }
      if (!Number.isInteger(score) || score < 1 || score > 5) {
        warnings.push(`full-value alias library: line ${i + 1} strength "${scoreRaw}" is not an integer 1-5 -- skipped`);
        continue;
      }
      if (a === b) {
        warnings.push(`full-value alias library: line ${i + 1} relates "${a}" to itself after normalization -- skipped`);
        continue;
      }
      const strength = score as RelationStrength;
      const label = KIND_LABELS[kind]!;
      addDirected(a, b, strength, label);
      addDirected(b, a, strength, label);
      acceptedRowCount += 1;
    }
    if (acceptedRowCount === 0) warnings.push("full-value alias library: no valid rows -- library disabled");
  }

  const provider: SemanticRelationshipProvider = {
    id: "full-value-alias",
    termDomain: "full-value",
    evidenceLabel: "Alias",
    describe: () => `Full-value alias library, ${datasetVersion} -- ${acceptedRowCount} curated relationships`,
    relationsOf(term: string): readonly SemanticRelation[] {
      const bucket = relations.get(term);
      if (!bucket) return [];
      return [...bucket.entries()]
        .map(([relatedTerm, entry]) => ({ term: relatedTerm, strength: entry.strength, label: entry.label }))
        .sort((a, b) => b.strength - a.strength || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0));
    },
    strengthBetween(a: string, b: string): RelationStrength | null {
      return relations.get(a)?.get(b)?.strength ?? null;
    },
  };

  return { provider, warnings, acceptedRowCount };
}
