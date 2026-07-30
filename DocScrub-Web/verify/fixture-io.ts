/**
 * Fixture loading helpers for the production verification harness. Mirrors
 * spike/ooxml/fixture-io.ts (kept separate rather than shared, since the
 * spike is being superseded/retired -- see docs/ooxml-spike/phase-2-
 * findings.md -- and this harness should not depend on code that is going
 * away).
 */

import { readFileSync } from "node:fs";

const FIXTURES_ROOT = "fixtures/domain-parity";

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

export interface ExpectedOccurrence {
  id: string;
  candidateKey: string;
  text: string;
  detectedType: string;
  location: string;
}

export function loadExpectedOccurrences(caseId: string): ExpectedOccurrence[] {
  const data = JSON.parse(readFileSync(`${FIXTURES_ROOT}/${caseId}/expected/occurrences.json`, "utf8"));
  return data.occurrences;
}

export function loadSourceFile(caseId: string): File {
  const path = loadSourcePath(caseId);
  const bytes = readFileSync(path);
  const manifest = loadManifest(caseId);
  return new File([new Uint8Array(bytes)], manifest.sourceDocument.fileName);
}
