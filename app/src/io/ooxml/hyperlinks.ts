/**
 * Hyperlink relationship targets -- in scope for redaction per Andrew's
 * Phase 3 architectural decision (docs/ooxml-spike/phase-2-findings.md,
 * "Phase 2 continued" section): "A document is not considered successfully
 * redacted until both visible hyperlink text AND underlying hyperlink
 * target/relationship have been processed appropriately. Silent leakage is
 * unacceptable."
 *
 * A `<w:hyperlink r:id="rId9">` in word/document.xml (or a header/footer)
 * only carries a relationship id -- the actual URL lives in a separate
 * `<Relationship Id="rId9" Type=".../hyperlink" Target="mailto:...
 * " TargetMode="External"/>` entry in that part's matching `.rels` file
 * (see document-parts.ts, relsPartFor). Confirmed by direct inspection of
 * fixtures/domain-parity/hyperlink-001's word/_rels/document.xml.rels.
 *
 * This is a distinct, much simpler surgical-edit problem than
 * document-text.ts/rebuild.ts: a `.rels` file has no nested structure to
 * worry about (flat list of self-closing <Relationship/> elements), and
 * there is exactly one Target attribute value to replace per relationship
 * -- no run-splitting, no cross-run splicing. Attribute order is not
 * assumed (Word does not guarantee it); each relationship is matched by
 * `Id`, not by position.
 */

export interface HyperlinkRelationship {
  /** The r:id a <w:hyperlink> element refers to, e.g. "rId9". */
  id: string;
  /** The relationship Type URI; only entries ending in "/hyperlink" are
   *  returned by parseHyperlinkRelationships -- other relationship kinds
   *  (styles, settings, images, ...) are not hyperlinks and are ignored. */
  type: string;
  /** The URL itself, decoded (entity-unescaped) -- e.g.
   *  "mailto:elena.vasquez@example.edu". This is the sensitive content. */
  target: string;
  /** Byte offsets, in the ORIGINAL .rels xml string, of the Target
   *  attribute's value (between the quotes) -- what to splice when
   *  redacting. */
  targetStart: number;
  targetEnd: number;
  external: boolean;
}

const RELATIONSHIP_RE = /<Relationship\b[^>]*\/>/g;

function attrValue(tag: string, name: string): { value: string; start: number; end: number } | undefined {
  const re = new RegExp(`${name}="([^"]*)"`);
  const m = re.exec(tag);
  if (!m) return undefined;
  const start = m.index + m[0].indexOf('"') + 1;
  return { value: m[1]!, start, end: start + m[1]!.length };
}

function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function encodeXmlEntities(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Parses a `.rels` xml string and returns every hyperlink relationship it
 *  contains (Type ending in "/hyperlink"). Non-hyperlink relationships
 *  (styles, settings, images, numbering, ...) are silently skipped -- that
 *  is intentional filtering, not the "never silently ignore content" rule
 *  being violated, since only hyperlink targets are sensitive-content
 *  candidates. */
export function parseHyperlinkRelationships(relsXml: string): HyperlinkRelationship[] {
  const results: HyperlinkRelationship[] = [];
  RELATIONSHIP_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RELATIONSHIP_RE.exec(relsXml))) {
    const tag = m[0];
    const tagOffset = m.index;
    const type = attrValue(tag, "Type");
    if (!type || !type.value.endsWith("/hyperlink")) continue;
    const id = attrValue(tag, "Id");
    const target = attrValue(tag, "Target");
    const targetMode = attrValue(tag, "TargetMode");
    if (!id || !target) continue;
    results.push({
      id: id.value,
      type: type.value,
      target: decodeXmlEntities(target.value),
      targetStart: tagOffset + target.start,
      targetEnd: tagOffset + target.end,
      external: targetMode?.value === "External",
    });
  }
  return results;
}

/** Surgically replaces one relationship's Target attribute value, by id.
 *  Leaves every other byte of the .rels file -- including every other
 *  relationship -- untouched, same splice-not-reserialize principle as
 *  rebuild.ts. Throws if no hyperlink relationship with that id exists,
 *  since a caller asking to redact a target that isn't there indicates a
 *  DocumentModel/OOXML mismatch worth surfacing loudly rather than
 *  silently no-op-ing. */
export function spliceRelationshipTarget(relsXml: string, id: string, newTarget: string): string {
  const relationships = parseHyperlinkRelationships(relsXml);
  const match = relationships.find((r) => r.id === id);
  if (!match) {
    throw new Error(`spliceRelationshipTarget: no hyperlink relationship with Id="${id}" found`);
  }
  return relsXml.slice(0, match.targetStart) + encodeXmlEntities(newTarget) + relsXml.slice(match.targetEnd);
}
