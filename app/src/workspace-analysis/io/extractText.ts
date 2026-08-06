/**
 * extractText.ts — the ONLY place this subsystem crosses into shared
 * code, and only into genuinely generic, zero-semantic-dependency
 * primitives: `sha256Hex` (`src/io/hash.ts`) and the raw OOXML
 * ZIP/paragraph-text parsers (`src/io/ooxml/zip.ts`,
 * `src/io/ooxml/document-parts.ts`, `src/io/ooxml/document-text.ts`).
 * None of these three files know anything about detection, candidates,
 * entities, or review state -- they are pure file-format plumbing (see
 * each file's own doc comment), which is exactly the bar the
 * independence requirement sets for permitted reuse.
 *
 * Deliberately NOT using `src/io/DocumentParser.ts`/`DocumentModel` --
 * that module's own doc comments frame it as "the format-neutral
 * internal representation consumed by the detection/quality/review
 * pipeline," i.e. exactly the semantic coupling this subsystem must
 * avoid. This file re-derives the small amount of OOXML plumbing it
 * actually needs (list text parts, parse paragraphs, flatten to text)
 * directly from the primitives above rather than going through
 * DocumentParser's richer, pipeline-shaped output.
 */

import { sha256Hex } from "../../io/hash.js";
import { readZip } from "../../io/ooxml/zip.js";
import { listTextBearingParts } from "../../io/ooxml/document-parts.js";
import { parseDocumentXml } from "../../io/ooxml/document-text.js";
import type { WorkspaceAnalysisInputDocument } from "../domain/WorkspaceAnalysisModel.js";

async function extractDocxText(buffer: ArrayBuffer): Promise<string> {
  const parts = await readZip(buffer);
  const textParts = listTextBearingParts(parts);
  const decoder = new TextDecoder("utf-8");
  const sections: string[] = [];
  for (const partName of textParts) {
    const bytes = parts.get(partName);
    if (!bytes) continue;
    const xml = decoder.decode(bytes);
    const paragraphs = parseDocumentXml(xml);
    for (const paragraph of paragraphs) {
      if (paragraph.flatText.trim().length > 0) sections.push(paragraph.flatText);
    }
  }
  return sections.join("\n");
}

/** Best-effort fallback for anything that isn't a readable OOXML ZIP
 *  (a plain .txt import, or a file this subsystem simply can't parse).
 *  Decoding arbitrary bytes as UTF-8 on a genuinely binary file will
 *  usually produce mostly-unusable text, which is fine here: the
 *  fingerprint heuristics only extract sparse structured signals
 *  (capitalized phrases, emails, identifiers) and will simply find few
 *  or none in noisy decoded output. This is graceful degradation, not
 *  silent corruption -- the document still gets a fingerprint, a
 *  filename, and appears in the analysis (likely landing in
 *  `unrelatedDocumentIds` for lack of evidence) rather than being
 *  dropped or throwing. */
function decodeAsPlainText(buffer: ArrayBuffer): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(buffer);
}

/** Reads one imported file end-to-end into a `WorkspaceAnalysisInputDocument`.
 *  `documentId` is a SHA-256 of the raw file bytes -- see the doc comment
 *  on `WorkspaceAnalysisInputDocument` for why this intentionally mirrors,
 *  without depending on, `DocumentModel.documentId`'s same hash-of-bytes
 *  approach. */
export async function extractWorkspaceAnalysisDocument(file: File): Promise<WorkspaceAnalysisInputDocument> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const documentId = await sha256Hex(bytes);

  let text: string;
  try {
    text = await extractDocxText(buffer);
  } catch {
    // Not a valid OOXML ZIP (or a shape this parser doesn't expect) --
    // fall back rather than failing the whole analysis. Property 7
    // ("workspace analysis can fail or return no clusters without
    // breaking document review") applies at the per-document level too:
    // one unreadable file must not abort analyzing the rest of the batch.
    text = decodeAsPlainText(buffer);
  }

  return {
    documentId,
    fileName: file.name,
    byteLength: bytes.length,
    text,
  };
}

export async function extractWorkspaceAnalysisDocuments(
  files: File[]
): Promise<WorkspaceAnalysisInputDocument[]> {
  return Promise.all(files.map(extractWorkspaceAnalysisDocument));
}
