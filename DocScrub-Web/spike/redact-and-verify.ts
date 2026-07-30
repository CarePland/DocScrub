/**
 * Phase 2 OOXML spike -- generic, occurrence-driven redaction round-trip
 * for any domain-parity fixture case. Redacts every expected OCCURRENCE
 * (not candidate) across every text-bearing part (body + all headers +
 * all footers), rezips, and verifies via an independent library
 * (python-docx) that none of the original occurrence text remains and the
 * output is well-formed OOXML.
 *
 * This replaced an earlier, simpler version that redacted by each
 * candidate's single canonical `text` field and only touched
 * word/document.xml. Two real gaps that version had, found by running it
 * against synthetic-transcript-001 rather than assumed:
 *
 *   1. A candidate can have occurrences whose literal text differs from
 *      its canonical text (e.g. candidate "Jane Smith" has one occurrence
 *      literally reading "Smith, Jane"). Redacting by candidate.text alone
 *      misses those. DocumentRebuilder must operate per-occurrence, using
 *      each occurrence's own text and location, not per-candidate.
 *   2. Header/footer parts were never searched at all. Silent, no error --
 *      exactly the "never silently ignore content" failure this migration
 *      is trying to avoid. See document-parts.ts.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { readZip, writeZip } from "./ooxml/zip.ts";
import { parseDocumentXml } from "./ooxml/document-text.ts";
import { redactDocument, type CandidateReplacement } from "./ooxml/rebuild.ts";
import { loadSourcePath, loadExpectedOccurrences, partKindForLocation } from "./ooxml/fixture-io.ts";
import { listTextBearingParts, partKind } from "./ooxml/document-parts.ts";

const SCRATCH_DIR = "spike/_scratch_output";

export interface RedactionVerification {
  caseId: string;
  partsModified: string[];
  totalSplices: number;
  occurrencesNotFoundAnywhere: string[];
  pythonVerifiedNoResidualText: boolean;
  pythonResidualFound: string[];
  outputPath: string;
  ok: boolean;
}

function placeholderFor(detectedType: string): string {
  return `[${detectedType.toUpperCase()}-REDACTED]`;
}

function verifyWithPythonDocx(docxPath: string, mustNotContain: string[]): { opens: boolean; residual: string[]; error?: string } {
  const script = `
import docx, sys, json
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
    print(json.dumps({"opens": True, "residual": residual}))
except Exception as e:
    print(json.dumps({"opens": False, "residual": [], "error": str(e)}))
`;
  const out = execFileSync("python3", ["-c", script, docxPath, JSON.stringify(mustNotContain)], {
    encoding: "utf8",
  });
  return JSON.parse(out);
}

export function redactionRoundTrip(caseId: string): RedactionVerification {
  const sourcePath = loadSourcePath(caseId);
  const buf = readFileSync(sourcePath);
  const parts = readZip(buf);
  const textParts = listTextBearingParts(parts);

  const occurrences = loadExpectedOccurrences(caseId);

  // Group occurrences by which part *kind* they belong to (body/header/footer).
  // Within a kind there may be multiple physical parts (header1.xml,
  // header2.xml, ...); an occurrence's text is searched for across all of
  // them, and only the part(s) where it's actually found get modified.
  const replacementsByKind = new Map<string, CandidateReplacement[]>();
  for (const occ of occurrences) {
    const kind = partKindForLocation(occ.location);
    const list = replacementsByKind.get(kind) ?? [];
    list.push({ search: occ.text, replace: placeholderFor(occ.detectedType) });
    replacementsByKind.set(kind, list);
  }

  const newParts = new Map(parts);
  const partsModified: string[] = [];
  let totalSplices = 0;
  const foundAnywhere = new Set<string>();

  for (const partName of textParts) {
    const kind = partKind(partName);
    const replacements = replacementsByKind.get(kind);
    if (!replacements || replacements.length === 0) continue;

    const xml = parts.get(partName)!.toString("utf8");
    const paragraphs = parseDocumentXml(xml);
    const { xml: redactedXml, matchesApplied, matchesNotFound } = redactDocument(xml, paragraphs, replacements);

    for (const r of replacements) {
      if (!matchesNotFound.includes(r.search)) foundAnywhere.add(r.search);
    }

    if (matchesApplied > 0) {
      newParts.set(partName, Buffer.from(redactedXml, "utf8"));
      partsModified.push(partName);
      totalSplices += matchesApplied;
    }
  }

  const allSearchTexts = [...new Set(occurrences.map((o) => o.text))];
  const occurrencesNotFoundAnywhere = allSearchTexts.filter((t) => !foundAnywhere.has(t));

  const entries = [...newParts.entries()].map(([name, data]) => ({ name, data }));
  const outBuf = writeZip(entries);

  mkdirSync(SCRATCH_DIR, { recursive: true });
  const outputPath = `${SCRATCH_DIR}/${caseId}_redacted.docx`;
  writeFileSync(outputPath, outBuf);

  const pyResult = verifyWithPythonDocx(outputPath, allSearchTexts);

  const result: RedactionVerification = {
    caseId,
    partsModified,
    totalSplices,
    occurrencesNotFoundAnywhere,
    pythonVerifiedNoResidualText: pyResult.opens && pyResult.residual.length === 0,
    pythonResidualFound: pyResult.residual ?? [],
    outputPath,
    ok: pyResult.opens && pyResult.residual.length === 0 && occurrencesNotFoundAnywhere.length === 0,
  };
  return result;
}

function main(): void {
  const caseId = process.argv[2];
  if (!caseId) {
    console.error("usage: node --experimental-strip-types spike/redact-and-verify.ts <fixture-case-id>");
    process.exit(1);
  }
  const result = redactionRoundTrip(caseId);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] && process.argv[1].endsWith("redact-and-verify.ts")) {
  main();
}
