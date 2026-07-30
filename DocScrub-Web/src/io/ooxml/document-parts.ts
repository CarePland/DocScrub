/**
 * Enumerates the OOXML parts DocumentParser reads, by kind. Extends
 * spike/ooxml/document-parts.ts (which only covered body/header/footer --
 * a real gap, found by evidence: an early prototype was only ever pointed
 * at word/document.xml, so header/footer text was silently never extracted
 * at all) with the two additional part categories Phase 3's architectural
 * decisions put in scope: comments and hyperlink relationship targets. See
 * docs/ooxml-spike/phase-2-findings.md and construct-support-matrix.md.
 */

export type PartKind = "body" | "header" | "footer";

const TEXT_PART_NAME_RE = /^word\/(document|header\d*|footer\d*)\.xml$/;
const COMMENTS_PART_NAME = "word/comments.xml";

/** word/document.xml, word/header*.xml, word/footer*.xml -- the
 *  <w:p>/<w:r>/<w:t>-structured parts that carry ordinary visible text.
 *  Does NOT include word/comments.xml, which has its own loader
 *  (comments.ts) since comment structure and identity (author, id, date)
 *  differ from ordinary paragraphs even though the inner <w:p>/<w:t>
 *  shape is the same. */
export function listTextBearingParts(parts: Map<string, Uint8Array>): string[] {
  return [...parts.keys()].filter((name) => TEXT_PART_NAME_RE.test(name)).sort();
}

export function partKind(name: string): PartKind {
  if (name.startsWith("word/header")) return "header";
  if (name.startsWith("word/footer")) return "footer";
  return "body";
}

export function hasComments(parts: Map<string, Uint8Array>): boolean {
  return parts.has(COMMENTS_PART_NAME);
}

export function commentsPartName(): string {
  return COMMENTS_PART_NAME;
}

/** Every relationship (`.rels`) part associated with a text-bearing part,
 *  e.g. `word/document.xml` -> `word/_rels/document.xml.rels`. Hyperlink
 *  targets live here, not in the text-bearing part itself -- a
 *  `<w:hyperlink r:id="...">` in document.xml only carries a relationship
 *  id; the actual URL is a separate `<Relationship Target="...">` entry in
 *  the matching `.rels` part. Returns only rels parts that actually exist
 *  in this archive (a part with no hyperlinks, comments, or other
 *  relationships may have no `.rels` file at all). */
export function relsPartFor(textPartName: string): string {
  const slash = textPartName.lastIndexOf("/");
  const dir = textPartName.slice(0, slash);
  const fileName = textPartName.slice(slash + 1);
  return `${dir}/_rels/${fileName}.rels`;
}

export function listRelsParts(parts: Map<string, Uint8Array>, textParts: string[]): string[] {
  return textParts.map(relsPartFor).filter((name) => parts.has(name));
}
