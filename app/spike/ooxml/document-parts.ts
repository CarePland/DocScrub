/**
 * Enumerates the OOXML parts that can carry reviewable text: the main
 * document body plus every header/footer part. Word numbers these
 * word/header1.xml, word/header2.xml, word/header3.xml (first/even/default
 * page variants) and the same for footers -- there is no fixed count.
 *
 * This exists because a real gap was found by evidence, not anticipated by
 * design: the spike's first version of document-text.ts was only ever
 * pointed at word/document.xml, so header/footer text was silently never
 * extracted at all. synthetic-transcript-001's header ("Header contact:
 * Jane Smith") and footer ("Page 1") went unparsed without any error --
 * exactly the "never silently ignore content" failure mode this migration
 * is designed to avoid. See ../docs/ooxml-spike/phase-2-findings.md.
 */

export type PartKind = "body" | "header" | "footer";

const PART_NAME_RE = /^word\/(document|header\d*|footer\d*)\.xml$/;

export function listTextBearingParts(parts: Map<string, Buffer>): string[] {
  return [...parts.keys()].filter((name) => PART_NAME_RE.test(name)).sort();
}

export function partKind(name: string): PartKind {
  if (name.startsWith("word/header")) return "header";
  if (name.startsWith("word/footer")) return "footer";
  return "body";
}
