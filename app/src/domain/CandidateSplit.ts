/**
 * CandidateSplit.ts -- one extracted candidate contains SEVERAL review units
 * (AG, 2026-08-10).
 *
 * ═══════════════════ WHAT A SPLIT CLAIMS, AND WHAT IT DOES NOT ═══════════════════
 *
 *     "This extracted span contains more than one independently reviewable
 *      unit."
 *
 * That is the entire claim. It is STRUCTURAL. It says nothing about what the
 * pieces are:
 *
 *   NOT "the pieces are people"        -- `Admissions / Registrar` splits the
 *                                         same way `Chris, Margaret` does.
 *   NOT "the pieces are one entity"    -- splitting performs no entity
 *                                         linkage and never merges anything.
 *   NOT "the pieces share a decision"  -- each piece gets its own K/C/R/I.
 *   NOT "extraction was semantically wrong" -- the span was wrong, which is a
 *                                         different defect.
 *   NOT a resolution                   -- no piece is automatically decided.
 *
 * ═══════════════════ WHY IT IS NOT `Not Quite` ═══════════════════
 *
 * `domain/NotQuite.ts` refines an entity GROUP: its members are candidates
 * that already exist, and the reviewer assigns each one an action. It never
 * changes a span.
 *
 * Split changes what the review UNIT IS. The pieces do not exist until the
 * reviewer confirms the partition. Overloading Not Quite would make the audit
 * ambiguous -- a reader could no longer tell "the reviewer refined a group"
 * from "the reviewer said extraction merged two things" -- so the two stay
 * separate concepts with separate records.
 *
 * ═══════════════════ THE TOKEN / SEPARATOR MODEL ═══════════════════
 *
 * A candidate value is decomposed into alternating TOKENS (the reviewable
 * words) and SEPARATORS (the punctuation, whitespace and conjunctions between
 * them). Both carry exact offsets into the original value, and every
 * character of the value belongs to exactly one of them.
 *
 *     "Chris, Margaret"   tokens ["Chris"]["Margaret"]   separator [", "]
 *     "HR and Payroll"    tokens ["HR"]["Payroll"]       separator [" and "]
 *     "Admissions / Registrar"                           separator [" / "]
 *
 * CONJUNCTIONS ARE SEPARATORS, NOT TOKENS, and that is load-bearing. If `and`
 * were a token, `HR and Payroll` would offer a three-way split whose middle
 * piece is the word `and` -- a review unit nobody wants and a redaction span
 * that would damage the sentence. Treating it as a separator means the
 * conjunction simply stays in the document, which is what should happen.
 *
 * NOTHING IS NORMALIZED AWAY. Separator text is preserved verbatim, because
 * output reconstruction and the audit both need the original characters. A
 * split is a claim about boundaries, never an edit to the text.
 *
 * ═══════════════════ PARTITIONS AS BOUNDARY SETS ═══════════════════
 *
 * An N-token candidate has N-1 boundaries, indexed 0..N-2, where boundary `i`
 * sits between token `i` and token `i+1`. A partition is the SET OF CUT
 * BOUNDARIES -- not an enumeration of possible partitions.
 *
 *     "A B C"   boundaries {0,1}
 *       {}      -> "A B C"          (no split; not a valid confirmed split)
 *       {0}     -> "A" | "B C"
 *       {1}     -> "A B" | "C"
 *       {0,1}   -> "A" | "B" | "C"
 *
 * This is why the interaction is "select boundaries" rather than "choose from
 * a menu": the representation is O(N), the menu would be O(2^(N-1)), and the
 * reviewer's mental model is where the cuts go.
 *
 * Pure, DOM-free, deterministic. No I/O, no dictionaries, no engine.
 */

/** One reviewable word within a candidate value. */
export interface SplitToken {
  /** Verbatim text, exactly as it appears in the candidate value. */
  text: string;
  /** Offsets into the CANDIDATE VALUE (not the document). */
  startOffset: number;
  endOffset: number;
}

/**
 * The run of characters between two tokens -- punctuation, whitespace, a
 * conjunction, or any combination.
 *
 * `conjunction` records that this separator contains a coordinating word, so a
 * proposal rule can treat `Chris and Margaret` differently from `Chris
 * Margaret` without re-tokenizing. It is a lexical observation, never a
 * semantic claim.
 */
export interface SplitSeparator {
  text: string;
  startOffset: number;
  endOffset: number;
  /** True when the separator contains punctuation that commonly divides
   *  listed items: comma, semicolon, slash, ampersand, plus, pipe. */
  hasDividingPunctuation: boolean;
  /** The coordinating word this separator contains, lower-cased, or null. */
  conjunction: string | null;
}

export interface SplitDecomposition {
  /** The candidate value, verbatim. Never rewritten. */
  value: string;
  tokens: readonly SplitToken[];
  /** Exactly `tokens.length - 1` entries; `separators[i]` sits between
   *  `tokens[i]` and `tokens[i+1]`. Empty when there is one token or none. */
  separators: readonly SplitSeparator[];
}

/**
 * Coordinating words treated as separators rather than review units.
 *
 * DELIBERATELY TINY, and deliberately not a stopword list. Every entry is a
 * word that joins two independently reviewable things; a longer list would
 * start swallowing tokens that a reviewer might legitimately want to split
 * out. `&` and `+` are handled as punctuation, not here.
 */
const COORDINATING_WORDS: readonly string[] = ["and", "or", "und", "y", "et"];

const DIVIDING_PUNCTUATION = /[,;/&+|]/;

/** Characters that can appear INSIDE a reviewable token. Apostrophes and
 *  hyphens are token-internal (`O'Brien`, `Smith-Jones`); everything else
 *  that is not a letter or digit separates. */
const TOKEN_CHAR = /[\p{L}\p{N}'’.\-]/u;

/**
 * Decompose a candidate value into tokens and separators.
 *
 * EVERY CHARACTER IS ACCOUNTED FOR. The concatenation of leading text, tokens
 * and separators reconstructs the value exactly -- asserted by the
 * verification suite, because a lossy decomposition would silently corrupt
 * output reconstruction.
 *
 * Leading and trailing non-token characters are attached to the adjacent
 * separator position, or dropped from the token list entirely when the value
 * begins or ends with punctuation. They remain recoverable from `value`.
 */
export function decomposeForSplit(value: string): SplitDecomposition {
  const rawTokens: SplitToken[] = [];
  let index = 0;
  while (index < value.length) {
    if (!TOKEN_CHAR.test(value[index]!)) { index += 1; continue; }
    const start = index;
    while (index < value.length && TOKEN_CHAR.test(value[index]!)) index += 1;
    /* A run of only punctuation-ish token characters (a bare "." or "-") is
     * not a reviewable word. */
    const text = value.slice(start, index);
    if (/[\p{L}\p{N}]/u.test(text)) rawTokens.push({ text, startOffset: start, endOffset: index });
  }

  /* Fold coordinating words into the separator that follows the previous
   * token, so they never become review units of their own. */
  const tokens: SplitToken[] = [];
  for (const token of rawTokens) {
    if (COORDINATING_WORDS.includes(token.text.toLowerCase()) && tokens.length > 0) continue;
    tokens.push(token);
  }

  const separators: SplitSeparator[] = [];
  for (let i = 0; i + 1 < tokens.length; i += 1) {
    const start = tokens[i]!.endOffset;
    const end = tokens[i + 1]!.startOffset;
    const text = value.slice(start, end);
    const words = text.toLowerCase().match(/[\p{L}]+/gu) ?? [];
    const conjunction = words.find((w) => COORDINATING_WORDS.includes(w)) ?? null;
    separators.push({
      text,
      startOffset: start,
      endOffset: end,
      hasDividingPunctuation: DIVIDING_PUNCTUATION.test(text),
      conjunction,
    });
  }

  return { value, tokens, separators };
}

/**
 * A confirmed or proposed partition: the SET of cut boundaries.
 *
 * Sorted, deduplicated, and every entry in `0..tokenCount-2`. An empty set is
 * a valid *proposal* (meaning "no split suggested") but never a valid
 * *confirmed* split -- see `isValidConfirmedPartition`.
 */
export type SplitBoundaries = readonly number[];

/** One resulting review unit: a contiguous run of tokens plus the separators
 *  strictly inside it, with its exact offsets in the original value. */
export interface SplitSegment {
  /** Verbatim source text of this segment, including internal separators. */
  text: string;
  startOffset: number;
  endOffset: number;
  /** Inclusive token index range within the decomposition. */
  firstTokenIndex: number;
  lastTokenIndex: number;
}

export function normalizeBoundaries(boundaries: SplitBoundaries, tokenCount: number): number[] {
  return [...new Set(boundaries)]
    .filter((b) => Number.isInteger(b) && b >= 0 && b <= tokenCount - 2)
    .sort((a, b) => a - b);
}

/** A confirmed split must cut at least once and must be within range. */
export function isValidConfirmedPartition(boundaries: SplitBoundaries, tokenCount: number): boolean {
  if (tokenCount < 2) return false;
  return normalizeBoundaries(boundaries, tokenCount).length > 0;
}

/**
 * The resulting review units for a partition.
 *
 * Segment text is taken from the ORIGINAL VALUE by offset, so internal
 * separators survive verbatim (`Jones Brown` keeps its space) and cut
 * separators stay in the document rather than being absorbed into a piece --
 * the property that makes redacting `Chris` and `Margaret` separately leave
 * `, ` intact.
 */
export function splitSegments(decomposition: SplitDecomposition, boundaries: SplitBoundaries): SplitSegment[] {
  const { tokens, value } = decomposition;
  if (tokens.length === 0) return [];
  const cuts = normalizeBoundaries(boundaries, tokens.length);
  const segments: SplitSegment[] = [];
  let firstTokenIndex = 0;
  for (const cut of [...cuts, tokens.length - 1]) {
    const lastTokenIndex = cut;
    const startOffset = tokens[firstTokenIndex]!.startOffset;
    const endOffset = tokens[lastTokenIndex]!.endOffset;
    segments.push({
      text: value.slice(startOffset, endOffset),
      startOffset,
      endOffset,
      firstTokenIndex,
      lastTokenIndex,
    });
    firstTokenIndex = lastTokenIndex + 1;
    if (firstTokenIndex > tokens.length - 1) break;
  }
  return segments;
}

/**
 * ═══════════════════ PROVENANCE ═══════════════════
 *
 * The durable record of a structural repair. It must let a later audit
 * distinguish four different things:
 *
 *     original extraction        `originalValue`, `originalTokenCount`
 *     engine-proposed partition  `proposedBoundaries`, `proposalRuleIds`
 *     user-confirmed partition   `confirmedBoundaries`, `confirmedAt`
 *     resulting units            `segments`
 *
 * THE ORIGINAL IS NEVER DELETED. This record retains the original value and
 * its decomposition, so "what did extraction actually produce" stays
 * answerable after the pieces have been reviewed and the document rebuilt.
 *
 * This is LOCAL SESSION/AUDIT DATA and it deliberately DOES contain document
 * text -- that is its job. It is emphatically NOT the telemetry shape; see
 * `metrics/splitTelemetry.ts`, which is a different type precisely so the two
 * can never be confused.
 */
export interface CandidateSplitRecord {
  schemaVersion: 1;
  /** The candidate whose span was found to contain several review units. */
  originalCandidateId: string;
  /** Verbatim. Never rewritten. */
  originalValue: string;
  originalTokenCount: number;
  /** What the engine suggested, and why. Empty when it suggested nothing. */
  proposedBoundaries: SplitBoundaries;
  proposalRuleIds: readonly string[];
  /** What the reviewer confirmed. This is the operative partition. */
  confirmedBoundaries: SplitBoundaries;
  /** True when the reviewer confirmed exactly what was proposed. */
  acceptedProposalExactly: boolean;
  /** The resulting units, in document order. */
  segments: readonly SplitSegment[];
  confirmedAt: string; // ISO 8601
}

/** Assemble the provenance record. Pure; the caller supplies the clock. */
export function buildSplitRecord(input: {
  originalCandidateId: string;
  decomposition: SplitDecomposition;
  proposedBoundaries: SplitBoundaries;
  proposalRuleIds: readonly string[];
  confirmedBoundaries: SplitBoundaries;
  confirmedAt: string;
}): CandidateSplitRecord {
  const tokenCount = input.decomposition.tokens.length;
  const proposed = normalizeBoundaries(input.proposedBoundaries, tokenCount);
  const confirmed = normalizeBoundaries(input.confirmedBoundaries, tokenCount);
  return {
    schemaVersion: 1,
    originalCandidateId: input.originalCandidateId,
    originalValue: input.decomposition.value,
    originalTokenCount: tokenCount,
    proposedBoundaries: proposed,
    proposalRuleIds: [...input.proposalRuleIds],
    confirmedBoundaries: confirmed,
    acceptedProposalExactly: proposed.length === confirmed.length && proposed.every((b, i) => b === confirmed[i]),
    segments: splitSegments(input.decomposition, confirmed),
    confirmedAt: input.confirmedAt,
  };
}
