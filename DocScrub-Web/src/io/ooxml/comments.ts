/**
 * word/comments.xml -- in scope for the same review pipeline as ordinary
 * document text, per Andrew's Phase 3 architectural decision
 * (docs/ooxml-spike/phase-2-findings.md, "Phase 2 continued" section):
 * "Comments containing reviewable text should eventually participate in
 * the same review pipeline as ordinary document text."
 *
 * This closes what was flagged as a coverage limitation (§construct-
 * support-matrix.md, "comments: Unsupported") for real, not just a flag,
 * because the underlying mechanism transfers directly: a <w:comment>
 * element's content is the exact same <w:p>/<w:r>/<w:t> structure as
 * body/header/footer text (confirmed by direct inspection of
 * fixtures/domain-parity/comments-001's word/comments.xml). Comments do
 * not nest inside each other, so document-text.ts's paragraph-span finder
 * -- built to handle nesting for text boxes -- works here unmodified: it
 * is called once over the whole comments.xml string, exactly like any
 * other <w:p>-structured part. This module's only job is to attach
 * per-comment identity (id/author/date) to the paragraphs
 * parseDocumentXml() already finds, so DocumentParser can produce one
 * ContentBlock per comment (matching the "block per header/footer part"
 * granularity already established) instead of one block for the entire
 * comments.xml file.
 *
 * Redaction reuses rebuild.ts's redactDocument() directly against the
 * whole comments.xml string and the paragraphs this module returns --
 * there is no comments-specific redaction logic, because none is needed.
 */

import { parseDocumentXml, type ParagraphText } from "./document-text.js";

export interface CommentMeta {
  id: string;
  author: string;
  date: string;
  start: number;
  end: number;
}

export interface CommentBlock extends CommentMeta {
  paragraphs: ParagraphText[];
  flatText: string;
}

const COMMENT_RE = /<w:comment\b([^>]*)>([\s\S]*?)<\/w:comment>/g;

function attrValue(tag: string, name: string): string {
  const re = new RegExp(`${name}="([^"]*)"`);
  const m = re.exec(tag);
  return m ? m[1]! : "";
}

function findCommentSpans(xml: string): CommentMeta[] {
  const spans: CommentMeta[] = [];
  COMMENT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = COMMENT_RE.exec(xml))) {
    const openTagAttrs = m[1]!;
    spans.push({
      id: attrValue(openTagAttrs, "w:id"),
      author: attrValue(openTagAttrs, "w:author"),
      date: attrValue(openTagAttrs, "w:date"),
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return spans;
}

/** Parses word/comments.xml into one CommentBlock per <w:comment>, each
 *  carrying its own paragraphs (with the same textStart/textEnd byte
 *  offsets into the ORIGINAL comments.xml string that redactDocument()
 *  expects) and identity metadata for DocumentModel's SourceMapping/
 *  context fields. */
export function parseComments(xml: string): CommentBlock[] {
  const spans = findCommentSpans(xml);
  const allParagraphs = parseDocumentXml(xml);
  return spans.map((span) => {
    const paragraphs = allParagraphs.filter((p) => p.pStart >= span.start && p.pEnd <= span.end);
    return {
      ...span,
      paragraphs,
      flatText: paragraphs.map((p) => p.flatText).join("\n"),
    };
  });
}

/** All paragraphs across every comment in the file, in document order --
 *  what DocumentRebuilder passes to rebuild.ts's redactDocument() against
 *  the raw comments.xml string, exactly as it would for word/document.xml. */
export function allCommentParagraphs(xml: string): ParagraphText[] {
  return parseDocumentXml(xml);
}
