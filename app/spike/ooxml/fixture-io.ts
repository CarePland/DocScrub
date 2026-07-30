/**
 * Shared helpers for loading domain-parity fixture data, used across the
 * Phase 2 spike's various construct-specific tests so each new fixture
 * (hyperlinks, nested tables, headers/footers, ...) doesn't re-implement
 * manifest/expected-candidate loading.
 */

import { readFileSync } from "node:fs";

const FIXTURES_ROOT = "fixtures/domain-parity";

export interface ExpectedCandidate {
  key: string;
  text: string;
  detectedType: string;
  occurrenceIds: string[];
}

export interface Manifest {
  fixtureId: string;
  sourceDocument: { fileName: string; sha256: string };
  [key: string]: unknown;
}

export function loadManifest(caseId: string): Manifest {
  return JSON.parse(readFileSync(`${FIXTURES_ROOT}/${caseId}/manifest.json`, "utf8"));
}

export function loadSourcePath(caseId: string): string {
  const manifest = loadManifest(caseId);
  return `${FIXTURES_ROOT}/${caseId}/source/${manifest.sourceDocument.fileName}`;
}

export function loadExpectedCandidates(caseId: string): ExpectedCandidate[] {
  const data = JSON.parse(readFileSync(`${FIXTURES_ROOT}/${caseId}/expected/candidates.json`, "utf8"));
  return data.candidates;
}

export interface ExpectedOccurrence {
  id: string;
  candidateKey: string;
  text: string;
  detectedType: string;
  location: string; // e.g. "body paragraph 2", "section 1 header paragraph 1"
}

export function loadExpectedOccurrences(caseId: string): ExpectedOccurrence[] {
  const data = JSON.parse(readFileSync(`${FIXTURES_ROOT}/${caseId}/expected/occurrences.json`, "utf8"));
  return data.occurrences;
}

/** Coarse mapping from Python's location string to which OOXML part kind
 *  the occurrence should be searched for in -- see document-parts.ts. Not
 *  index-precise (does not try to match "paragraph 2" to a specific
 *  physical paragraph index), just enough to route the search to the right
 *  part(s), since occurrence text is searched for directly within them. */
export function partKindForLocation(location: string): "body" | "header" | "footer" {
  if (location.includes("header")) return "header";
  if (location.includes("footer")) return "footer";
  return "body";
}
