/**
 * Encodes/decodes ContentBlock.sourceMapping.sourceRef (DocumentModel.ts).
 * A single shared codec so DocumentParser (which writes these) and
 * DocumentRebuilder (which reads them) can never disagree about the
 * format -- the two are always built and changed together against this
 * one module rather than each hand-rolling string concatenation.
 *
 * Deliberately NOT raw byte offsets into the original XML. Those would
 * duplicate information that document-text.ts's parse functions already
 * derive deterministically and cheaply (spike-measured: ~40ms for a
 * 6,134-paragraph real document) from the immutable original bytes
 * DocumentModel.sourceArchive already carries. A pointer of the form
 * "which part, which Nth thing in it" is enough for DocumentRebuilder to
 * re-run the exact same parse function DocumentParser used and land on the
 * identical RunText/paragraph data -- no duplicated offsets to keep in
 * sync, no risk of drift between what ContentBlock.runMappings says and
 * what the real bytes contain.
 */

export type DecodedSourceRef =
  | { kind: "paragraph"; partName: string; index: number }
  | { kind: "hyperlink"; relsPartName: string; relationshipId: string }
  | { kind: "tracked-deletion"; partName: string; index: number };

const SEP = " ";

export function encodeParagraphRef(partName: string, index: number): string {
  return ["paragraph", partName, String(index)].join(SEP);
}

export function encodeHyperlinkRef(relsPartName: string, relationshipId: string): string {
  return ["hyperlink", relsPartName, relationshipId].join(SEP);
}

export function encodeTrackedDeletionRef(partName: string, index: number): string {
  return ["tracked-deletion", partName, String(index)].join(SEP);
}

export function decodeSourceRef(ref: string): DecodedSourceRef {
  const parts = ref.split(SEP);
  const kind = parts[0];
  if (kind === "paragraph") {
    return { kind, partName: parts[1]!, index: Number(parts[2]) };
  }
  if (kind === "hyperlink") {
    return { kind, relsPartName: parts[1]!, relationshipId: parts[2]! };
  }
  if (kind === "tracked-deletion") {
    return { kind, partName: parts[1]!, index: Number(parts[2]) };
  }
  throw new Error(`decodeSourceRef: unrecognized sourceRef "${ref}"`);
}
