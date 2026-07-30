/**
 * Production targeted (not general-purpose) text extraction over an OOXML
 * XML part's string content, with byte-offset tracking back to individual
 * <w:t> nodes. This is the structure DocumentRebuilder needs to know which
 * run(s) a candidate's text actually spans -- the hard case named in
 * architecture v0.2 §15.2 ("Text split across Word runs can make
 * replacements difficult") and confirmed as real in the OOXML structural
 * spike (findings.md: 457 paragraphs with >3 runs in a real document).
 *
 * Ported near-verbatim from spike/ooxml/document-text.ts: this module's
 * logic was always pure string/offset manipulation with nothing
 * Node-specific about it, so the port is the promotion of already-proven
 * code, not a rewrite. See docs/ooxml-spike/phase-2-findings.md for what
 * was validated and how.
 *
 * Deliberately not a general XML parser: it finds exactly <w:p>...</w:p>
 * and <w:t>...</w:t> spans by scanning for their tags, the same targeted
 * approach the existing Python docx_reader.py takes with lxml's `.//w:t`
 * xpath. A full DOM parse-and-reserialize is specifically *not* what
 * DocumentRebuilder should do (see rebuild.ts) -- reserializing an OOXML
 * DOM from scratch risks silently dropping or reordering attributes Word
 * depends on. Surgical byte-range replacement on the original string,
 * which is what this module's offsets exist to support, preserves
 * everything untouched outside the exact text being replaced.
 *
 * Used identically for word/document.xml, word/header*.xml,
 * word/footer*.xml, and word/comments.xml -- all four share the same
 * <w:p>/<w:r>/<w:t> paragraph structure. Callers (DocumentParser.ts,
 * comments.ts) are responsible for knowing which OOXML part a given string
 * came from; this module only knows about paragraphs and runs.
 */

export interface RunText {
  /** Byte offsets, in the ORIGINAL xml string, of the text content between
   *  the <w:t...> and </w:t> tags (i.e. what to splice when replacing) --
   *  not the tag boundaries themselves. */
  textStart: number;
  textEnd: number;
  /** Decoded (entity-unescaped) text content of this run's <w:t> node. */
  text: string;
}

export interface ParagraphText {
  pStart: number;
  pEnd: number;
  runs: RunText[];
  /** All runs' text concatenated, in document order -- what a detector
   *  should scan, matching docx_reader.paragraph_text()'s behavior of
   *  joining every w:t node in the paragraph regardless of run boundaries. */
  flatText: string;
}

const WT_RE = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:t(?:\s[^>]*)?\/>/g;

// Matches a <w:p> open tag, a self-closing <w:p/>, or a </w:p> close tag,
// as one alternation so tokens can be walked in document order.
const P_TOKEN_RE = /<w:p(?:\s[^>]*)?\/>|<w:p(?:\s[^>]*)?>|<\/w:p>/g;

export function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function encodeXmlEntities(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Finds every <w:p>...</w:p> span in the document, INCLUDING spans nested
 * inside another <w:p> -- a real case, not a hypothetical: a text box's
 * txbxContent embeds its own <w:p> inside a run that lives within an
 * outer, "story-level" paragraph. Found by evidence during the Phase 2
 * spike: an earlier version assumed <w:p> never nests (true for ordinary
 * body/table/header/footer/comment content, false for a text box)
 * and produced a corrupted, overlapping span for the outer paragraph
 * whenever a text box was present -- corrupted badly enough that
 * python-docx could no longer open the resulting file. See
 * docs/ooxml-spike/phase-2-findings.md.
 *
 * Depth-aware: walks <w:p>/<w:p/>/</w:p> tokens in document order with an
 * explicit stack, so every paragraph's span -- nested or not -- is matched
 * to its own true closing tag.
 */
interface ParagraphSpan {
  start: number;
  end: number;
  nested: boolean;
}

function findAllParagraphSpans(xml: string): ParagraphSpan[] {
  const spans: ParagraphSpan[] = [];
  const stack: number[] = []; // start offsets of currently-open <w:p> tags

  P_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = P_TOKEN_RE.exec(xml))) {
    const token = m[0];
    if (token === "</w:p>") {
      const start = stack.pop();
      if (start === undefined) {
        throw new Error(`Unmatched </w:p> at offset ${m.index}`);
      }
      spans.push({ start, end: m.index + token.length, nested: stack.length > 0 });
    } else if (token.endsWith("/>")) {
      // self-closing <w:p/>
      spans.push({ start: m.index, end: m.index + token.length, nested: stack.length > 0 });
    } else {
      stack.push(m.index);
    }
  }
  if (stack.length > 0) {
    throw new Error(`${stack.length} unclosed <w:p> tag(s)`);
  }

  spans.sort((a, b) => a.start - b.start);
  return spans;
}

/**
 * Top-level paragraph spans only -- i.e. what python-docx's
 * `document.paragraphs` (direct-child w:p traversal) would see, matching
 * the Python reference implementation's behavior. A nested paragraph
 * (inside a text box) is NOT returned as its own separate ParagraphText --
 * but its <w:t> content is still included in its containing top-level
 * paragraph's flatText, because the run-scan below operates over the whole
 * (superset) span, matching paragraph_text()'s `.//w:t` xpath, which is
 * recursive regardless of nesting.
 *
 * A body-level content control (<w:sdt>/<w:sdtContent>) wrapping its own
 * <w:p> is a DIFFERENT case from text-box nesting: <w:sdt> is not a <w:p>
 * token, so the paragraph inside it is never pushed onto the nesting
 * stack and is returned here as its own top-level span. This is an
 * approved, intentional deviation from python-docx's document.paragraphs,
 * which does not enumerate it at all -- see
 * fixtures/domain-parity/content-control-001/manifest.json `deviations`
 * and docs/ooxml-spike/construct-support-matrix.md.
 */
function findParagraphSpans(xml: string): Array<{ start: number; end: number }> {
  return findAllParagraphSpans(xml).filter((s) => !s.nested);
}

export function parseDocumentXml(xml: string): ParagraphText[] {
  const paragraphs: ParagraphText[] = [];

  for (const { start, end } of findParagraphSpans(xml)) {
    const runs: RunText[] = [];
    WT_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WT_RE.exec(xml.slice(start, end)))) {
      if (m[1] === undefined) continue; // self-closing <w:t/>, empty text, contributes nothing
      const groupStart = start + m.index + m[0].indexOf(">") + 1;
      const groupEnd = groupStart + m[1].length;
      runs.push({ textStart: groupStart, textEnd: groupEnd, text: decodeXmlEntities(m[1]) });
    }
    paragraphs.push({
      pStart: start,
      pEnd: end,
      runs,
      flatText: runs.map((r) => r.text).join(""),
    });
  }

  return paragraphs;
}
