/**
 * Tracked-change deletion text (<w:del>/<w:delText>) -- detection-only,
 * deliberately READ-ONLY. Per Andrew's Phase 3 architectural decision
 * (docs/ooxml-spike/phase-2-findings.md, "Phase 2 continued" section):
 * "Tracked changes are considered document content. Do not silently export
 * documents containing tracked changes that could reveal redacted
 * information. If tracked changes cannot yet be rebuilt safely, the system
 * should surface this explicitly rather than implying the document is
 * fully redacted."
 *
 * `<w:del>` wraps `<w:r><w:delText>...</w:delText></w:r>` instead of the
 * ordinary `<w:r><w:t>...</w:t></w:r>` that `<w:ins>` uses (confirmed by
 * direct inspection of fixtures/domain-parity/tracked-changes-001's
 * word/document.xml). document-text.ts's WT_RE only matches `<w:t>`, so
 * deleted text is already correctly invisible to ordinary paragraph
 * extraction -- matching the document's *current* visible text, the same
 * as python-docx's `.//w:t` xpath.
 *
 * That correctness for *extraction* is exactly what makes deletions a
 * silent-leakage risk for *redaction*: the deleted run is still physically
 * embedded in the file and Word/LibreOffice render it with strikethrough
 * (visually confirmed via a soffice-rendered PDF, see
 * phase-2-findings.md). Splicing inside a <w:delText> the same way
 * rebuild.ts splices a <w:t> has not been validated as safe -- deleted
 * runs interact with revision-tracking metadata (author, date, paragraph-
 * mark deletion, moveFrom/moveTo) in ways body text does not, and getting
 * that wrong risks corrupting the document's revision history rather than
 * just its visible text. Until that is specifically proven safe (a
 * distinct, future spike), this module provides extraction ONLY -- so
 * DetectionEngine can see this content and OutputVerifier can flag it --
 * and deliberately does NOT export any splice/redact function, unlike
 * hyperlinks.ts and rebuild.ts. There is no "redact a tracked deletion"
 * capability for DocumentRebuilder to accidentally reach for.
 */

export interface TrackedDeletionRun {
  /** Byte offsets, in the ORIGINAL xml string, of the text content between
   *  <w:delText...> and </w:delText> -- provided for identification/
   *  OutputVerifier reporting only, NOT for splicing. */
  textStart: number;
  textEnd: number;
  text: string;
  /** w:id of the enclosing <w:del>, when present -- lets a
   *  FidelityFinding point a reviewer at a specific tracked change. */
  delId: string;
  author: string;
  date: string;
}

const DELTEXT_RE = /<w:delText(?:\s[^>]*)?>([\s\S]*?)<\/w:delText>|<w:delText(?:\s[^>]*)?\/>/g;
const DEL_OPEN_RE = /<w:del\b([^>]*)>/g;

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function attrValue(tag: string, name: string): string {
  const re = new RegExp(`${name}="([^"]*)"`);
  const m = re.exec(tag);
  return m ? m[1]! : "";
}

/** Finds every <w:delText> run in the given xml, with enough context
 *  (enclosing <w:del>'s id/author/date) to report meaningfully. Does not
 *  attempt depth-aware nesting the way document-text.ts does for <w:p> --
 *  <w:del> does not nest, and a <w:delText> always belongs to the nearest
 *  preceding, still-open <w:del>. */
export function findTrackedDeletions(xml: string): TrackedDeletionRun[] {
  const dels: Array<{ id: string; author: string; date: string; start: number }> = [];
  DEL_OPEN_RE.lastIndex = 0;
  let dm: RegExpExecArray | null;
  while ((dm = DEL_OPEN_RE.exec(xml))) {
    const attrs = dm[1]!;
    dels.push({
      id: attrValue(attrs, "w:id"),
      author: attrValue(attrs, "w:author"),
      date: attrValue(attrs, "w:date"),
      start: dm.index,
    });
  }

  const runs: TrackedDeletionRun[] = [];
  DELTEXT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DELTEXT_RE.exec(xml))) {
    if (m[1] === undefined) continue; // self-closing, empty
    const groupStart = m.index + m[0].indexOf(">") + 1;
    const groupEnd = groupStart + m[1].length;

    // Nearest enclosing <w:del> is the last one whose start offset precedes
    // this <w:delText>.
    let enclosing = dels[0];
    for (const d of dels) {
      if (d.start <= m.index) enclosing = d;
      else break;
    }

    runs.push({
      textStart: groupStart,
      textEnd: groupEnd,
      text: decodeXmlEntities(m[1]),
      delId: enclosing?.id ?? "",
      author: enclosing?.author ?? "",
      date: enclosing?.date ?? "",
    });
  }
  return runs;
}
