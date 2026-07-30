/**
 * hash.ts — the one shared byte-hashing primitive used anywhere a stable
 * content identity is needed from raw bytes (Web Crypto's `crypto.subtle`,
 * standard in every browser, no npm dependency).
 *
 * Extracted from DocumentParser.ts (Phase 11), which had a private,
 * unexported `sha256Hex` computing `DocumentModel.documentId` from the
 * input file's bytes. AuditExporter.ts (Phase 11) needs the exact same
 * hash, over the REBUILT output's bytes, to give the audit record a content
 * identity for the output document. Two independent copies of a
 * three-line hash function would risk them silently drifting apart (e.g. a
 * future change to one but not the other) for no benefit -- there is
 * nothing input-specific about the implementation, only about what bytes
 * get passed in. This is a small, targeted extraction of an
 * already-duplicated need, not new generalized infrastructure.
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
