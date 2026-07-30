/**
 * Production cross-run surgical replacement -- the actual hard case named
 * in architecture v0.2 §15.2 ("Text split across Word runs can make
 * replacements difficult") and confirmed as real and common in the OOXML
 * structural spike (457 of 6,134 paragraphs with >3 runs in a real
 * document).
 *
 * Ported near-verbatim from spike/ooxml/rebuild.ts -- pure string/offset
 * logic, nothing Node-specific, validated against 11 domain-parity
 * fixtures including the 21-run fragmented-name case, independently
 * cross-checked by python-docx re-opening the output. See
 * docs/ooxml-spike/phase-2-findings.md.
 *
 * Approach, deliberately NOT a DOM parse-and-reserialize: locate exactly
 * which run(s) a match spans using ParagraphText's byte offsets, put the
 * full replacement text in the first overlapping run, empty any fully
 * contained runs, and keep the unmatched suffix in the last overlapping
 * run. Everything else in the original xml string -- every attribute,
 * every run this match doesn't touch, all formatting XML -- is left
 * completely untouched, because the edit is a byte splice on the original
 * string, not a rebuild from a parsed structure.
 *
 * Used for word/document.xml, word/header*.xml, word/footer*.xml, and
 * word/comments.xml alike (see document-text.ts) -- redaction of comment
 * text uses the exact same redactParagraph/redactDocument functions as
 * body text, because comments share the same <w:p>/<w:r>/<w:t> structure.
 * It is NEVER used against tracked-deletion (<w:delText>) content -- see
 * tracked-changes.ts for why that's a distinct, read-only path.
 */

import type { ParagraphText } from "./document-text.js";
import { encodeXmlEntities } from "./document-text.js";

export interface SpliceOp {
  textStart: number;
  textEnd: number;
  newRawText: string; // already XML-entity-encoded, ready to splice in directly
}

/**
 * Applies a set of splices to an xml string. Splices are applied in
 * descending offset order so earlier offsets remain valid as later
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
// Multi-candidate redaction within one paragraph. A single search/replace
// applied independently for multiple matches that land in the same run is
// unsafe: two independently-computed splices for the same run would both
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
    // searchFrom tracks how far we've already scanned, in the CURRENT
    // flatText's own coordinates (flatText is rebuilt fresh from runTexts
    // every iteration, so this cursor is recomputed against it each time,
    // not held stale). BUG FOUND while implementing Feature 001's Flatten
    // Group (docs/detection/feature-001-group-bulk-actions.md): before this
    // fix, every iteration re-scanned from index 0, which is only safe when
    // `replace` can never itself contain `search` -- true for almost every
    // hand-typed Rename before Feature 001, but Flatten Group deliberately
    // renames every member of a group to that group's own canonical name,
    // which is frequently IDENTICAL to one member's own original text (the
    // canonical member is, definitionally, one of its own group's members).
    // When replace === search, the just-inserted replacement text is itself
    // a fresh match, and scanning from 0 finds it forever -- an infinite
    // loop, confirmed by direct reproduction (generateOutput() never
    // returning) before this fix. Advancing the cursor to just past the
    // replacement we ourselves inserted is the standard fix for this class
    // of bug and is behaviorally IDENTICAL to the old code for every
    // existing fixture (replace never equalled or contained search in any
    // of them) -- it only changes the previously-nonterminating case.
    let searchFrom = 0;
    for (;;) {
      const flatText = runTexts.join("");
      const idx = flatText.indexOf(search, searchFrom);
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

      searchFrom = matchStart + replace.length;
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
 *  every paragraph passed in, composing correctly when multiple candidates
 *  share a run. This is the function DocumentRebuilder uses for every
 *  <w:p>-structured part (body, header, footer, comments). */
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
