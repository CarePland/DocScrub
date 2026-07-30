/**
 * Phase 2 OOXML spike -- cross-run surgical replacement.
 *
 * This is the actual hard case named in architecture v0.2 §15.2 ("Text
 * split across Word runs can make replacements difficult") and confirmed
 * as real and common in the OOXML structural spike (457 of 6,134
 * paragraphs with >3 runs in a real document). Detection already works
 * fine across run boundaries (see document-text.ts, ParagraphText.flatText)
 * because it only needs to *read* joined text. Replacement is harder
 * because it has to *write*, and a match found in flat text may begin in
 * one <w:t> run and end in a different one, possibly spanning several.
 *
 * Approach, deliberately NOT a DOM parse-and-reserialize: locate exactly
 * which run(s) a match spans using ParagraphText's byte offsets, put the
 * full replacement text in the first overlapping run, empty any fully
 * contained runs, and keep the unmatched suffix in the last overlapping
 * run. Everything else in the original document.xml string -- every
 * attribute, every run this match doesn't touch, all formatting XML -- is
 * left completely untouched, because the edit is a byte splice on the
 * original string, not a rebuild from a parsed structure. This mirrors the
 * "edit word/document.xml in place, do not reformat or pretty-print"
 * guidance for hand-editing existing .docx files -- the same caution
 * applies to a programmatic rebuild, for the same reason: Word's own
 * writer produces exact XML shapes (attribute order, whitespace,
 * `xml:space="preserve"`) that a naive reserialization is not guaranteed
 * to reproduce.
 */

import type { ParagraphText } from "./document-text.ts";
import { encodeXmlEntities } from "./document-text.ts";

export interface SpliceOp {
  textStart: number;
  textEnd: number;
  newRawText: string; // already XML-entity-encoded, ready to splice in directly
}

export interface Match {
  paragraph: ParagraphText;
  /** Offsets into paragraph.flatText, NOT into the raw XML string. */
  flatStart: number;
  flatEnd: number;
  replacement: string;
}

/**
 * Computes the splice operations needed to replace one match, which may
 * span multiple <w:t> runs within a single paragraph. Cross-paragraph
 * matches are out of scope for this spike (candidates in the current
 * Python pipeline are always within one text block / paragraph).
 */
export function computeSplicesForMatch(match: Match): SpliceOp[] {
  const { paragraph, flatStart, flatEnd, replacement } = match;

  // Compute each run's [start, end) in flat-text coordinates.
  const runRanges: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const run of paragraph.runs) {
    runRanges.push({ start: cursor, end: cursor + run.text.length });
    cursor += run.text.length;
  }

  const overlapping: number[] = [];
  for (let i = 0; i < runRanges.length; i++) {
    const r = runRanges[i]!;
    if (r.end > flatStart && r.start < flatEnd) overlapping.push(i);
  }

  if (overlapping.length === 0) {
    throw new Error(`Match [${flatStart}, ${flatEnd}) does not overlap any run in this paragraph`);
  }

  const splices: SpliceOp[] = [];
  const firstIdx = overlapping[0]!;
  const lastIdx = overlapping[overlapping.length - 1]!;

  for (const i of overlapping) {
    const run = paragraph.runs[i]!;
    const range = runRanges[i]!;
    const localMatchStart = Math.max(flatStart, range.start) - range.start;
    const localMatchEnd = Math.min(flatEnd, range.end) - range.start;
    const prefix = run.text.slice(0, localMatchStart);
    const suffix = run.text.slice(localMatchEnd);

    let newText: string;
    if (i === firstIdx && i === lastIdx) {
      newText = prefix + replacement + suffix; // fits in one run, the easy case
    } else if (i === firstIdx) {
      newText = prefix + replacement; // replacement text goes here, once
    } else if (i === lastIdx) {
      newText = suffix; // no replacement text here, just whatever wasn't matched
    } else {
      newText = ""; // fully contained in the match, emptied
    }

    splices.push({
      textStart: run.textStart,
      textEnd: run.textEnd,
      newRawText: encodeXmlEntities(newText),
    });
  }

  return splices;
}

/**
 * Applies a set of splices to a document.xml string. Splices are applied
 * in descending offset order so earlier offsets remain valid as later
 * (higher-offset) edits are made -- no offset recomputation needed.
 */
export function applySplices(xml: string, splices: SpliceOp[]): string {
  const sorted = [...splices].sort((a, b) => b.textStart - a.textStart);
  let result = xml;
  for (const splice of sorted) {
    result = result.slice(0, splice.textStart) + splice.newRawText + result.slice(splice.textEnd);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Multi-candidate redaction. computeSplicesForMatch/applySplices above
// handle exactly one match at a time and are kept as-is (validated in
// phase-2-findings.md against the single fragmented-paragraph case) -- but
// applying them independently for *multiple* matches that land in the same
// run is unsafe: two independently-computed splices for the same run both
// carry that run's original [textStart, textEnd) range, so the later one
// silently overwrites the earlier one's edit instead of composing with it.
// This is a real case, not a hypothetical: synthetic-transcript-001's
// "Jane Smith emailed robert.lee@example.edu about CIN 123456789." is a
// single run containing three separate candidates.
//
// redactParagraph works around this by mutating an in-memory copy of each
// run's text (not the raw XML) across all matches for a paragraph first,
// re-locating each subsequent search against the already-edited flat text,
// and only emitting one splice per run at the end, diffed against that
// run's original text. This composes correctly regardless of how many
// candidates share a run.
// ---------------------------------------------------------------------------

export interface CandidateReplacement {
  search: string;
  replace: string;
}

export function redactParagraph(paragraph: ParagraphText, replacements: CandidateReplacement[]): SpliceOp[] {
  const runTexts = paragraph.runs.map((r) => r.text);

  const runRangesFor = (texts: string[]): Array<{ start: number; end: number }> => {
    const ranges: Array<{ start: number; end: number }> = [];
    let cursor = 0;
    for (const t of texts) {
      ranges.push({ start: cursor, end: cursor + t.length });
      cursor += t.length;
    }
    return ranges;
  };

  for (const { search, replace } of replacements) {
    if (search.length === 0) continue;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const flatText = runTexts.join("");
      const idx = flatText.indexOf(search);
      if (idx === -1) break;
      const matchStart = idx;
      const matchEnd = idx + search.length;

      const ranges = runRangesFor(runTexts);
      const overlapping: number[] = [];
      for (let i = 0; i < ranges.length; i++) {
        const r = ranges[i]!;
        if (r.end > matchStart && r.start < matchEnd) overlapping.push(i);
      }
      const firstIdx = overlapping[0]!;
      const lastIdx = overlapping[overlapping.length - 1]!;

      for (const i of overlapping) {
        const range = ranges[i]!;
        const localStart = Math.max(matchStart, range.start) - range.start;
        const localEnd = Math.min(matchEnd, range.end) - range.start;
        const prefix = runTexts[i]!.slice(0, localStart);
        const suffix = runTexts[i]!.slice(localEnd);
        if (i === firstIdx && i === lastIdx) {
          runTexts[i] = prefix + replace + suffix;
        } else if (i === firstIdx) {
          runTexts[i] = prefix + replace;
        } else if (i === lastIdx) {
          runTexts[i] = suffix;
        } else {
          runTexts[i] = "";
        }
      }
    }
  }

  const splices: SpliceOp[] = [];
  for (let i = 0; i < paragraph.runs.length; i++) {
    const run = paragraph.runs[i]!;
    if (runTexts[i] !== run.text) {
      splices.push({ textStart: run.textStart, textEnd: run.textEnd, newRawText: encodeXmlEntities(runTexts[i]!) });
    }
  }
  return splices;
}

export interface RedactionResult {
  xml: string;
  matchesApplied: number;
  matchesNotFound: string[];
}

/** Redacts every occurrence of every replacement's search text, across
 *  every paragraph in the document, composing correctly when multiple
 *  candidates share a run. This is the function fixture testing should use
 *  going forward, rather than computeSplicesForMatch directly. */
export function redactDocument(
  xml: string,
  paragraphs: ParagraphText[],
  replacements: CandidateReplacement[]
): RedactionResult {
  const allSplices: SpliceOp[] = [];
  const foundSearches = new Set<string>();

  for (const paragraph of paragraphs) {
    const relevant = replacements.filter((r) => paragraph.flatText.includes(r.search));
    if (relevant.length === 0) continue;
    for (const r of relevant) foundSearches.add(r.search);
    allSplices.push(...redactParagraph(paragraph, relevant));
  }

  const matchesApplied = allSplices.length;
  const matchesNotFound = replacements.map((r) => r.search).filter((s) => !foundSearches.has(s));
  return { xml: applySplices(xml, allSplices), matchesApplied, matchesNotFound };
}
