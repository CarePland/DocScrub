/**
 * DocumentParser — architecture v0.2 §6.1. Accepts a user-selected local
 * File, unpacks and parses OOXML locally, and produces a stable
 * DocumentModel. This is one of the few genuinely async components in the
 * system (reading a browser File is inherently asynchronous, and so are
 * CompressionStream/DecompressionStream) -- see §12.
 *
 * PRODUCTION IMPLEMENTATION (Phase 3): OoxmlDocumentParser below is a real,
 * working implementation, not a signature. It is built entirely on
 * standard Web APIs (File.arrayBuffer(), CompressionStream/
 * DecompressionStream, crypto.subtle) plus the pure-string ooxml/* modules
 * -- no npm dependency, and verified directly against Node 22's own
 * implementation of those same standardized APIs (see verify/, and
 * docs/ooxml-spike/phase-2-findings.md for why that's a meaningfully
 * stronger fidelity signal than the earlier node:zlib-based spike).
 *
 * Produces one ContentBlock per PARAGRAPH (not one per OOXML part) for
 * body/header/footer/comment content, one block per hyperlink relationship
 * target, and one block per tracked-change deletion run. This matches how
 * rebuild.ts's redactDocument() already operates (per-paragraph) and how
 * the Python oracle locates occurrences ("body paragraph 2"); it also
 * keeps each block's local offsets small and unambiguous instead of one
 * giant per-part text blob where a naive join could let a match span two
 * unrelated paragraphs.
 *
 * Every block's ContentBlock.runMappings is populated from the same parse
 * (informational -- see DocumentModel.ts v4 changelog for why it is not
 * load-bearing for rebuild correctness). Every block's
 * sourceMapping.sourceRef is produced by ooxml/source-ref.ts, the same
 * codec DocumentRebuilder decodes.
 *
 * Never silently ignores content: every text-bearing part (body, every
 * header, every footer), comments.xml if present, every hyperlink
 * relationship, and every tracked-change deletion are all parsed. What
 * DocumentParser does NOT yet parse (nested-table cell-boundary structure
 * beyond flat text, drawing-object alt-text, field-code instruction text
 * as distinct from result text) is recorded in
 * DocumentFeatureFlags.unsupported, never silently dropped.
 */

import type { DocumentModel, ContentBlock, DocumentPartKind, RunMapping } from "../domain/DocumentModel.js";
import { readZip } from "./ooxml/zip.js";
import { parseDocumentXml, type ParagraphText } from "./ooxml/document-text.js";
import { listTextBearingParts, partKind, hasComments, commentsPartName, relsPartFor } from "./ooxml/document-parts.js";
import { parseHyperlinkRelationships } from "./ooxml/hyperlinks.js";
import { parseComments } from "./ooxml/comments.js";
import { findTrackedDeletions } from "./ooxml/tracked-changes.js";
import { encodeParagraphRef, encodeHyperlinkRef, encodeTrackedDeletionRef } from "./ooxml/source-ref.js";
import { sha256Hex } from "./hash.js";

export interface DocumentParser {
  parse(file: File): Promise<DocumentModel>;
}

const PART_KIND_TO_BLOCK_KIND: Record<ReturnType<typeof partKind>, DocumentPartKind> = {
  body: "body",
  header: "header",
  footer: "footer",
};

function runMappingsFor(paragraph: ParagraphText, blockTextStart: number): RunMapping[] {
  let cursor = blockTextStart;
  return paragraph.runs.map((run) => {
    const start = cursor;
    const end = cursor + run.text.length;
    cursor = end;
    return { start: start - blockTextStart, end: end - blockTextStart, sourceRef: "" };
  });
}

export class OoxmlDocumentParser implements DocumentParser {
  async parse(file: File): Promise<DocumentModel> {
    const buffer = await file.arrayBuffer();
    const parts = await readZip(buffer);
    const documentId = await sha256Hex(new Uint8Array(buffer));
    const decoder = new TextDecoder("utf-8");

    const blocks: ContentBlock[] = [];
    const supported: string[] = [];
    const unsupported: string[] = [];
    const processingWarnings: string[] = [];
    let order = 0;
    let blockSeq = 0;
    const nextId = () => `block-${blockSeq++}`;

    // --- body / header / footer ------------------------------------------
    const textParts = listTextBearingParts(parts);
    for (const partName of textParts) {
      const xml = decoder.decode(parts.get(partName)!);
      const paragraphs = parseDocumentXml(xml);
      const kind = PART_KIND_TO_BLOCK_KIND[partKind(partName)];
      paragraphs.forEach((paragraph, index) => {
        blocks.push({
          id: nextId(),
          kind,
          text: paragraph.flatText,
          order: order++,
          sourceMapping: { partId: partName, sourceRef: encodeParagraphRef(partName, index) },
          runMappings: runMappingsFor(paragraph, 0),
        });
      });
    }
    if (textParts.length > 0) supported.push("run-splitting", "field-codes", "drawing-objects-adjacent-text");

    // --- comments ----------------------------------------------------------
    if (hasComments(parts)) {
      const commentsXml = decoder.decode(parts.get(commentsPartName())!);
      const commentBlocks = parseComments(commentsXml);
      let commentParagraphIndex = 0;
      for (const comment of commentBlocks) {
        for (const paragraph of comment.paragraphs) {
          blocks.push({
            id: nextId(),
            kind: "comment",
            text: paragraph.flatText,
            order: order++,
            sourceMapping: {
              partId: commentsPartName(),
              sourceRef: encodeParagraphRef(commentsPartName(), commentParagraphIndex),
            },
            runMappings: runMappingsFor(paragraph, 0),
          });
          commentParagraphIndex++;
        }
      }
      supported.push("comments");
    }

    // --- hyperlink relationship targets -------------------------------------
    for (const partName of textParts) {
      const relsPart = relsPartFor(partName);
      const relsBytes = parts.get(relsPart);
      if (!relsBytes) continue;
      const relsXml = decoder.decode(relsBytes);
      const hyperlinks = parseHyperlinkRelationships(relsXml);
      for (const link of hyperlinks) {
        if (!link.external) continue; // internal (same-document) links carry no external sensitive content
        blocks.push({
          id: nextId(),
          kind: "hyperlink",
          text: link.target,
          order: order++,
          sourceMapping: { partId: relsPart, sourceRef: encodeHyperlinkRef(relsPart, link.id) },
          runMappings: [{ start: 0, end: link.target.length, sourceRef: "" }],
        });
      }
      if (hyperlinks.length > 0) supported.push("hyperlink-targets");
    }

    // --- tracked-change deletions (read-only; see tracked-changes.ts) -----
    let anyTrackedDeletions = false;
    for (const partName of textParts) {
      const xml = decoder.decode(parts.get(partName)!);
      const deletions = findTrackedDeletions(xml);
      deletions.forEach((deletion, index) => {
        anyTrackedDeletions = true;
        blocks.push({
          id: nextId(),
          kind: "tracked-deletion",
          text: deletion.text,
          order: order++,
          sourceMapping: { partId: partName, sourceRef: encodeTrackedDeletionRef(partName, index) },
          runMappings: [{ start: 0, end: deletion.text.length, sourceRef: "" }],
        });
      });
    }
    if (anyTrackedDeletions) {
      // Detectable, but not yet safely redactable -- see
      // DocumentRebuilder.ts and OutputVerifier.ts. This is exactly the
      // "explicit coverage limitation" Andrew's Phase 3 decision calls for,
      // surfaced through the same DocumentFeatureFlags.unsupported
      // mechanism used for every other known gap, not a special case.
      unsupported.push("tracked-change-deletion-rebuild");
      processingWarnings.push(
        "This document contains tracked-change deletions. Deleted text cannot yet be safely redacted by DocumentRebuilder -- see OutputVerifier's fidelity findings before treating this document as fully redacted."
      );
    }

    return {
      schemaVersion: 6,
      documentId,
      fileName: file.name,
      metadata: {},
      blocks,
      features: { supported, unsupported },
      processingWarnings,
      sourceArchive: { parts },
    };
  }
}
