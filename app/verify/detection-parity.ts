/**
 * Domain-parity harness for Phase 4: runs the real
 * src/engines/DetectionEngine.ts (RegexDetectionEngine) against every
 * domain-parity fixture and diffs the result against Python's own
 * expected/candidates.json + expected/occurrences.json --
 * export_fixtures.py generates those with `use_spacy=False`
 * (confirmed by reading scripts/export_fixtures.py directly), meaning the
 * Python oracle that produced every fixture already IS the deterministic
 * regex-fallback path this engine ports. Full candidate/occurrence parity
 * is the expected outcome for body/header/footer content, not an
 * aspiration.
 *
 * Candidates whose occurrences live ONLY in "hyperlink"/"comment"/
 * "tracked-deletion" blocks are expected to be EXTRA relative to Python --
 * those block kinds don't exist in Python's text-extraction pipeline at
 * all (Phase 3 architectural decisions). These are reported separately as
 * approved-by-design extras, not failures.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/detection-parity.ts
 */

import { readFileSync } from "node:fs";
import { OoxmlDocumentParser } from "../src/io/DocumentParser.ts";
import { RegexDetectionEngine } from "../src/engines/DetectionEngine.ts";
import type { ContentBlock } from "../src/domain/DocumentModel.ts";
import { loadSourceFile, loadManifest } from "./fixture-io.ts";

interface ExpectedCandidate {
  key: string;
  text: string;
  detectedType: string;
  source: string;
  confidence: string;
  occurrenceIds: string[];
}

interface ExpectedOccurrence {
  id: string;
  candidateKey: string;
  text: string;
  detectedType: string;
  source: string;
  location: string;
  start: number;
  end: number;
  context: string;
}

function loadExpectedCandidates(caseId: string): ExpectedCandidate[] {
  const data = JSON.parse(readFileSync(`fixtures/domain-parity/${caseId}/expected/candidates.json`, "utf8"));
  return data.candidates;
}

function loadExpectedOccurrences(caseId: string): ExpectedOccurrence[] {
  const data = JSON.parse(readFileSync(`fixtures/domain-parity/${caseId}/expected/occurrences.json`, "utf8"));
  return data.occurrences;
}

const NEW_BLOCK_KINDS = new Set(["hyperlink", "comment", "tracked-deletion"]);

async function runFixture(caseId: string): Promise<boolean> {
  const file = loadSourceFile(caseId);
  const model = await new OoxmlDocumentParser().parse(file);
  const detection = new RegexDetectionEngine().detect(model);

  const blockById = new Map<string, ContentBlock>(model.blocks.map((b) => [b.id, b]));
  const expectedCandidates = loadExpectedCandidates(caseId);
  const expectedOccurrences = loadExpectedOccurrences(caseId);
  const expectedByKey = new Map(expectedCandidates.map((c) => [c.key, c]));
  const expectedOccByCandidateKey = new Map<string, ExpectedOccurrence[]>();
  for (const occ of expectedOccurrences) {
    const list = expectedOccByCandidateKey.get(occ.candidateKey) ?? [];
    list.push(occ);
    expectedOccByCandidateKey.set(occ.candidateKey, list);
  }

  const tsByKey = new Map(detection.candidates.map((c) => [c.id, c]));

  const missing: string[] = []; // expected but not produced -- real gaps
  const fieldMismatches: string[] = [];
  const approvedExtras: string[] = []; // new-block-kind-only, expected by design
  const unexplainedExtras: string[] = []; // body/header/footer but not in Python's output -- real mismatches

  for (const [key, expected] of expectedByKey) {
    const actual = tsByKey.get(key);
    if (!actual) {
      missing.push(key);
      continue;
    }
    if (actual.displayValue !== expected.text) {
      fieldMismatches.push(`${key}: displayValue "${actual.displayValue}" != expected "${expected.text}"`);
    }
    if (actual.detectedType !== expected.detectedType) {
      fieldMismatches.push(`${key}: detectedType "${actual.detectedType}" != expected "${expected.detectedType}"`);
    }
    if (actual.source !== expected.source) {
      fieldMismatches.push(`${key}: source "${actual.source}" != expected "${expected.source}"`);
    }
    if (actual.confidence !== expected.confidence) {
      fieldMismatches.push(`${key}: confidence "${actual.confidence}" != expected "${expected.confidence}"`);
    }

    // Occurrence-level: compare text+start+end sets (start/end are both
    // paragraph-local offsets in Python and block-local offsets here --
    // the same convention, since both represent one paragraph's text --
    // so direct numeric comparison is valid, not just text comparison.
    const expectedOccs = expectedOccByCandidateKey.get(key) ?? [];
    const actualOccs = actual.occurrenceIds
      .map((id) => detection.occurrences.find((o) => o.id === id)!)
      .filter((o) => {
        const block = blockById.get(o.blockId);
        return block && !NEW_BLOCK_KINDS.has(block.kind);
      });
    const expectedSet = new Set(expectedOccs.map((o) => `${o.text}@${o.start}-${o.end}`));
    const actualSet = new Set(actualOccs.map((o) => `${o.text}@${o.startOffset}-${o.endOffset}`));
    const missingOccs = [...expectedSet].filter((s) => !actualSet.has(s));
    const extraOccs = [...actualSet].filter((s) => !expectedSet.has(s));
    if (missingOccs.length > 0) fieldMismatches.push(`${key}: missing occurrences ${JSON.stringify(missingOccs)}`);
    if (extraOccs.length > 0) fieldMismatches.push(`${key}: extra occurrences ${JSON.stringify(extraOccs)}`);
  }

  const manifest = loadManifest(caseId);
  const deviations = (manifest.deviations as Array<{ field: string }> | undefined) ?? [];
  const hasApprovedCandidateDeviation = deviations.some((d) => d.field === "candidates");

  for (const [key, actual] of tsByKey) {
    if (expectedByKey.has(key)) continue;
    const occs = actual.occurrenceIds.map((id) => detection.occurrences.find((o) => o.id === id)!);
    const allInNewBlockKinds = occs.every((o) => {
      const block = blockById.get(o.blockId);
      return block && NEW_BLOCK_KINDS.has(block.kind);
    });
    if (allInNewBlockKinds) {
      approvedExtras.push(`${key} (${actual.displayValue}) -- found only in ${[...new Set(occs.map((o) => blockById.get(o.blockId)?.kind))].join("/")} block(s)`);
    } else if (hasApprovedCandidateDeviation) {
      // e.g. content-control-001: manifest.json's deviations[] already
      // records this exact divergence as approved (Andrew, Phase 3) --
      // see fixtures/domain-parity/content-control-001/manifest.json.
      approvedExtras.push(`${key} (${actual.displayValue}) -- covered by manifest.json deviations[] entry`);
    } else {
      unexplainedExtras.push(`${key} (${actual.displayValue})`);
    }
  }

  const ok = missing.length === 0 && fieldMismatches.length === 0 && unexplainedExtras.length === 0;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${caseId}  (expected candidates: ${expectedCandidates.length}, ts candidates: ${detection.candidates.length}, ` +
      `missing: ${missing.length}, field mismatches: ${fieldMismatches.length}, unexplained extras: ${unexplainedExtras.length}, approved extras: ${approvedExtras.length})`
  );
  for (const m of missing) console.log(`    MISSING: ${m}`);
  for (const m of fieldMismatches) console.log(`    MISMATCH: ${m}`);
  for (const m of unexplainedExtras) console.log(`    UNEXPLAINED EXTRA: ${m}`);
  for (const m of approvedExtras) console.log(`    (approved extra, Phase 3 block-coverage improvement) ${m}`);

  return ok;
}

async function main(): Promise<void> {
  const fixtureCases = [
    "synthetic-transcript-001",
    "run-split-name-001",
    "field-codes-001",
    "drawing-objects-001",
    "hyperlink-001",
    "nested-table-001",
    "footer-001",
    "diacritics-001",
    "comments-001",
    "tracked-changes-001",
    "text-box-001",
    "content-control-001",
  ];

  const results: boolean[] = [];
  for (const caseId of fixtureCases) {
    results.push(await runFixture(caseId));
  }
  const passCount = results.filter(Boolean).length;
  console.log(`\n${passCount}/${results.length} fixtures fully match Python (body/header/footer content)`);
  process.exitCode = passCount === results.length ? 0 : 1;
}

main();
