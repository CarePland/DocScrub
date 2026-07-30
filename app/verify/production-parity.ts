/**
 * Production verification harness -- exercises the REAL, full pipeline
 * (OoxmlDocumentParser -> RegexDetectionEngine -> OoxmlDocumentRebuilder ->
 * OoxmlOutputVerifier), not the retired spike/, against every domain-
 * parity fixture. As of Phase 4, DetectionEngine is real (see
 * src/engines/DetectionEngine.ts and verify/detection-parity.ts, which
 * proves its output matches Python's expected/*.json). This harness now
 * runs REAL detection rather than constructing a synthetic DetectionResult
 * from fixture data -- detection-parity.ts already proves detection
 * correctness in isolation; this harness proves the full chain composes:
 * whatever real detection finds, real rebuild+verify can act on correctly.
 *
 * Every detected candidate is marked for redaction EXCEPT those whose
 * occurrences live only in tracked-deletion blocks -- mirroring realistic
 * product behavior (a reviewer cannot ask to redact content the product
 * has already told them can't be safely rebuilt). That specific failure
 * path (what happens if redaction of tracked-deletion content IS
 * attempted) is exercised deliberately by the dedicated
 * tracked-deletion-safety-net test below instead, so its assertion stays
 * sharp rather than diluted into the main fixture loop's success case.
 *
 * Three things are checked per fixture:
 *   1. Every occurrence text real detection found (that was eligible for
 *      redaction) is successfully redacted (OutputVerifier.passed === true).
 *   2. Independent cross-check: python-docx re-opens the rebuilt file and
 *      confirms no forbidden text remains in paragraphs/tables/headers/
 *      footers (same independent-library discipline the spike used).
 *   3. Independent cross-check: raw ZIP inspection confirms comments.xml
 *      (where applicable) no longer contains the redacted text.
 *
 * Two additional, fixture-independent checks prove the two Phase 3
 * decisions the main fixture loop deliberately doesn't exercise (hyperlink
 * targets, because real detection finds them via the SAME candidate as the
 * body-text mention in most fixtures, already covered by the main loop's
 * hyperlink-001 case; and the tracked-deletion failure path, excluded from
 * the main loop above on purpose):
 *   4. Hyperlink target redaction: hyperlink-001's target IS spliced when
 *      its hyperlink block is explicitly marked for redaction.
 *   5. Tracked-deletion safety net: DocumentRebuilder correctly leaves a
 *      tracked-deletion candidate's text untouched even if asked to redact
 *      it, AND OutputVerifier correctly fails verification with a blocker
 *      finding rather than silently reporting success.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/production-parity.ts
 */

import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { OoxmlDocumentParser } from "../src/io/DocumentParser.ts";
import { OoxmlDocumentRebuilder } from "../src/io/DocumentRebuilder.ts";
import { OoxmlOutputVerifier } from "../src/io/OutputVerifier.ts";
import type { Candidate, ContentBlock, Occurrence } from "../src/domain/DocumentModel.ts";
import { RegexDetectionEngine, type DetectionResult } from "../src/engines/DetectionEngine.ts";
import type { ReviewSession, CandidateDecision } from "../src/domain/ReviewSession.ts";
import { EMPTY_ENTITY_REGISTRY } from "../src/domain/EntityRegistry.ts";
import { loadSourceFile } from "./fixture-io.ts";

const SCRATCH_DIR = "verify/_scratch_output";

function placeholderFor(detectedType: string): string {
  return `[${detectedType.toUpperCase()}-REDACTED]`;
}

/** Marks every REAL detected candidate for redaction, except those whose
 *  occurrences live only in tracked-deletion blocks -- see this file's doc
 *  comment for why that exclusion mirrors realistic product behavior
 *  rather than weakening the test. */
function buildRedactAllSession(detection: DetectionResult, blocks: ContentBlock[]): ReviewSession {
  const blockById = new Map(blocks.map((b) => [b.id, b]));
  const occById = new Map(detection.occurrences.map((o) => [o.id, o]));

  const candidateDecisions: Record<string, CandidateDecision> = {};
  for (const candidate of detection.candidates) {
    const onlyInTrackedDeletions = candidate.occurrenceIds.every((occId) => {
      const occ = occById.get(occId);
      const block = occ && blockById.get(occ.blockId);
      return block?.kind === "tracked-deletion";
    });
    if (onlyInTrackedDeletions) continue;
    candidateDecisions[candidate.id] = {
      candidateId: candidate.id,
      decision: "Redact",
      replacement: placeholderFor(candidate.detectedType),
      decidedAt: new Date().toISOString(),
    };
  }

  return {
    schemaVersion: 2,
    sessionId: "verify-session",
    documentId: "verify-document",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    candidateDecisions,
    groupDecisions: {},
    ambiguityResolutions: {},
    entityRegistry: EMPTY_ENTITY_REGISTRY,
    activeNotQuite: null,
    processingRevisions: [],
    events: [],
  };
}

function verifyWithPythonDocx(
  docxPath: string,
  mustNotContain: string[]
): { opens: boolean; residual: string[]; commentsResidual: string[]; error?: string } {
  const script = `
import docx, sys, json, zipfile
try:
    d = docx.Document(sys.argv[1])
    text = "\\n".join(p.text for p in d.paragraphs)
    for t in d.tables:
        for row in t.rows:
            for cell in row.cells:
                text += "\\n" + cell.text
    for section in d.sections:
        text += "\\n" + "\\n".join(p.text for p in section.header.paragraphs)
        text += "\\n" + "\\n".join(p.text for p in section.footer.paragraphs)
    forbidden = json.loads(sys.argv[2])
    residual = [s for s in forbidden if s in text]
    comments_residual = []
    with zipfile.ZipFile(sys.argv[1]) as z:
        if "word/comments.xml" in z.namelist():
            comments_text = z.read("word/comments.xml").decode("utf-8")
            comments_residual = [s for s in forbidden if s in comments_text]
    print(json.dumps({"opens": True, "residual": residual, "commentsResidual": comments_residual}))
except Exception as e:
    print(json.dumps({"opens": False, "residual": [], "commentsResidual": [], "error": str(e)}))
`;
  const out = execFileSync("python3", ["-c", script, docxPath, JSON.stringify(mustNotContain)], { encoding: "utf8" });
  return JSON.parse(out);
}

async function runFixture(caseId: string): Promise<boolean> {
  const file = loadSourceFile(caseId);
  const parser = new OoxmlDocumentParser();
  const model = await parser.parse(file);

  const detection = new RegexDetectionEngine().detect(model);
  const session = buildRedactAllSession(detection, model.blocks);
  const redactedCount = Object.keys(session.candidateDecisions).length;

  const rebuilder = new OoxmlDocumentRebuilder();
  const rebuiltBlob = await rebuilder.rebuild(model, detection, session);

  const verifier = new OoxmlOutputVerifier();
  const report = await verifier.verify(model, detection, session, rebuiltBlob);

  mkdirSync(SCRATCH_DIR, { recursive: true });
  const outputPath = `${SCRATCH_DIR}/${caseId}_redacted.docx`;
  const rebuiltBuffer = new Uint8Array(await rebuiltBlob.arrayBuffer());
  writeFileSync(outputPath, rebuiltBuffer);

  const forbiddenTexts = [...new Set(detection.occurrences.map((o) => o.text))];
  const pyResult = verifyWithPythonDocx(outputPath, forbiddenTexts);

  const ok =
    report.passed &&
    pyResult.opens &&
    pyResult.residual.length === 0 &&
    pyResult.commentsResidual.length === 0;

  console.log(
    `${ok ? "PASS" : "FAIL"}  ${caseId}  (candidates detected: ${detection.candidates.length}, marked for redaction: ${redactedCount}, ` +
      `verifier.passed=${report.passed}, python opens=${pyResult.opens}, python residual=${JSON.stringify(pyResult.residual)}, ` +
      `comments residual=${JSON.stringify(pyResult.commentsResidual)}, findings=${report.fidelityFindings.length})`
  );
  if (!ok || report.fidelityFindings.length > 0) {
    for (const f of report.fidelityFindings) console.log(`    finding: [${f.severity}] ${f.category}: ${f.description}`);
  }
  return ok;
}

async function runHyperlinkTargetTest(): Promise<boolean> {
  const file = loadSourceFile("hyperlink-001");
  const model = await new OoxmlDocumentParser().parse(file);
  const hyperlinkBlock = model.blocks.find((b) => b.kind === "hyperlink");
  if (!hyperlinkBlock) {
    console.log("FAIL  hyperlink-target-redaction  (no hyperlink block found)");
    return false;
  }

  const candidate: Candidate = {
    id: "hyperlink-target-candidate",
    detectedType: "email",
    source: "manual-test",
    confidence: "high",
    normalizedValue: hyperlinkBlock.text,
    displayValue: hyperlinkBlock.text,
    occurrenceIds: ["hyperlink-target-occ"],
  };
  const occurrence: Occurrence = {
    id: "hyperlink-target-occ",
    candidateId: candidate.id,
    blockId: hyperlinkBlock.id,
    startOffset: 0,
    endOffset: hyperlinkBlock.text.length,
    text: hyperlinkBlock.text,
    context: hyperlinkBlock.text,
    source: "manual-test",
  };
  const detection: DetectionResult = { schemaVersion: 1, candidates: [candidate], occurrences: [occurrence] };
  const session: ReviewSession = {
    schemaVersion: 1,
    sessionId: "verify-hyperlink",
    documentId: "verify-hyperlink",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    candidateDecisions: {
      [candidate.id]: {
        candidateId: candidate.id,
        decision: "Redact",
        replacement: "mailto:redacted@example.invalid",
        decidedAt: new Date().toISOString(),
      },
    },
    groupDecisions: {},
    ambiguityResolutions: {},
    activeNotQuite: null,
    processingRevisions: [],
    events: [],
  };

  const rebuiltBlob = await new OoxmlDocumentRebuilder().rebuild(model, detection, session);
  const report = await new OoxmlOutputVerifier().verify(model, detection, session, rebuiltBlob);

  const buffer = new Uint8Array(await rebuiltBlob.arrayBuffer());
  mkdirSync(SCRATCH_DIR, { recursive: true });
  writeFileSync(`${SCRATCH_DIR}/hyperlink-001_target_redacted.docx`, buffer);
  const script = `
import zipfile, sys, json
with zipfile.ZipFile(sys.argv[1]) as z:
    rels = [n for n in z.namelist() if n.endswith(".rels")]
    text = "".join(z.read(n).decode("utf-8") for n in rels)
print(json.dumps({"stillContainsOriginal": sys.argv[2] in text, "containsNewTarget": sys.argv[3] in text}))
`;
  const out = execFileSync(
    "python3",
    ["-c", script, `${SCRATCH_DIR}/hyperlink-001_target_redacted.docx`, hyperlinkBlock.text, "redacted@example.invalid"],
    { encoding: "utf8" }
  );
  const pyResult = JSON.parse(out);

  const ok = report.passed && !pyResult.stillContainsOriginal && pyResult.containsNewTarget;
  console.log(
    `${ok ? "PASS" : "FAIL"}  hyperlink-target-redaction  (verifier.passed=${report.passed}, ` +
      `stillContainsOriginal=${pyResult.stillContainsOriginal}, containsNewTarget=${pyResult.containsNewTarget})`
  );
  return ok;
}

async function runTrackedDeletionSafetyNetTest(): Promise<boolean> {
  const file = loadSourceFile("tracked-changes-001");
  const model = await new OoxmlDocumentParser().parse(file);
  const deletionBlock = model.blocks.find((b) => b.kind === "tracked-deletion");
  if (!deletionBlock) {
    console.log("FAIL  tracked-deletion-safety-net  (no tracked-deletion block found)");
    return false;
  }

  // Simulates a hypothetical future DetectionEngine that DOES scan
  // tracked-deletion blocks (consistent with "tracked changes are
  // considered document content") and a reviewer who decided to redact
  // what it found there.
  const candidate: Candidate = {
    id: "tracked-deletion-candidate",
    detectedType: "person",
    source: "manual-test",
    confidence: "low",
    normalizedValue: deletionBlock.text,
    displayValue: deletionBlock.text,
    occurrenceIds: ["tracked-deletion-occ"],
  };
  const occurrence: Occurrence = {
    id: "tracked-deletion-occ",
    candidateId: candidate.id,
    blockId: deletionBlock.id,
    startOffset: 0,
    endOffset: deletionBlock.text.length,
    text: deletionBlock.text,
    context: deletionBlock.text,
    source: "manual-test",
  };
  const detection: DetectionResult = { schemaVersion: 1, candidates: [candidate], occurrences: [occurrence] };
  const session: ReviewSession = {
    schemaVersion: 1,
    sessionId: "verify-tracked-deletion",
    documentId: "verify-tracked-deletion",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    candidateDecisions: {
      [candidate.id]: { candidateId: candidate.id, decision: "Redact", decidedAt: new Date().toISOString() },
    },
    groupDecisions: {},
    ambiguityResolutions: {},
    activeNotQuite: null,
    processingRevisions: [],
    events: [],
  };

  const rebuiltBlob = await new OoxmlDocumentRebuilder().rebuild(model, detection, session);
  const report = await new OoxmlOutputVerifier().verify(model, detection, session, rebuiltBlob);

  const hasBlockerFinding = report.fidelityFindings.some(
    (f) => f.category === "tracked-changes-residual-pii" && f.severity === "blocker"
  );
  // Expected outcome: DocumentRebuilder does NOT redact it (no code path
  // can), and OutputVerifier DOES catch that and fails verification --
  // proving the safety net, not proving redaction succeeded.
  const ok = !report.passed && hasBlockerFinding;
  console.log(
    `${ok ? "PASS" : "FAIL"}  tracked-deletion-safety-net  (verifier.passed=${report.passed} [expected false], ` +
      `blockerFindingPresent=${hasBlockerFinding} [expected true])`
  );
  if (hasBlockerFinding) {
    const f = report.fidelityFindings.find((x) => x.category === "tracked-changes-residual-pii")!;
    console.log(`    finding: [${f.severity}] ${f.category}: ${f.description}`);
  }
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
  results.push(await runHyperlinkTargetTest());
  results.push(await runTrackedDeletionSafetyNetTest());

  const passCount = results.filter(Boolean).length;
  console.log(`\n${passCount}/${results.length} checks passed`);
  process.exitCode = passCount === results.length ? 0 : 1;
}

main();
