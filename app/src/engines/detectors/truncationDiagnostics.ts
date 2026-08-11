/**
 * truncationDiagnostics.ts -- PHASE 1 OF THE RESIDUAL-WORK PASS
 * (AG, 2026-08-09). Answers one question, with evidence rather than
 * inference:
 *
 *   Are the truncated fragments in a real document
 *     A. present that way in the source,
 *     B. created by DocScrub, or
 *     C. mixed?
 *
 * Andrew's instruction is explicit -- "If DocScrub is creating any of these
 * truncations, treat that as a correctness defect and fix it before
 * proceeding to workload pruning. Do not paper over parser-generated
 * truncations by aliasing them to the full form."
 *
 * So this module DIAGNOSES; it changes nothing. It is a classifier over
 * (block text, occurrence span), pure and DOM-free, and it exists because
 * the distinction cannot be made by reading either the source document or
 * the code alone -- only by looking at what sits immediately either side of
 * a candidate's span in the parsed text.
 *
 * ---------------------------------------------------------------------
 * WHAT IS ALREADY ESTABLISHED, so this module does not re-litigate it
 * ---------------------------------------------------------------------
 *
 * The person regexes were run against the full forms of eleven observed
 * fragments ("Enrollment Appointments Assigned", "Science Teacher
 * Initiative", "Virtual Clearinghouse Academy", "Fox, Liudmila", ...).
 * In every case the detector returned the phrase INTACT. None of the
 * mid-word fragments is reproducible from complete input, so the
 * mid-word class is NOT produced by the person patterns.
 *
 * One truncation IS ours, and is reproducible:
 *
 *   FALLBACK_PERSON_RE = \b(?:[A-Z][a-z]{1,30})(?:\s+(?:[A-Z][a-z]{1,30})){1,3}\b
 *                                                                      ^^^^^
 * `{1,3}` caps a match at FOUR tokens. A longer capitalized phrase is cut
 * at four and the remainder becomes separate candidates:
 *
 *   "Southern California Shredding Coming Soon"
 *        -> "Southern California Shredding Coming"
 *   "Alternate Work Schedule Program Update"
 *        -> "Alternate Work Schedule Program"   + "Update"
 *
 * Both shapes appear in the live document, the second as two independent
 * Item Check units. That is a WORD-BOUNDARY truncation (it never cuts
 * mid-token), which is why it is classified separately below: it produces
 * a well-formed but incomplete phrase, and the tell is the token count,
 * not a severed word.
 *
 * ---------------------------------------------------------------------
 * THE TEST
 * ---------------------------------------------------------------------
 *
 * An occurrence is MID-WORD TRUNCATED when the character immediately
 * outside its span is a letter -- the span ends inside a word that
 * continues in the parsed text. If DocScrub produced the fragment, the
 * rest of the word is still sitting right there in `blockText`.
 *
 * That single observation separates the classes decisively:
 *
 *   `severed`        the word continues in the SAME block -> DocScrub cut
 *                    a complete word. A correctness defect.
 *   `block-boundary` the span reaches the block edge and the word looks
 *                    incomplete -> the parse split a word across blocks
 *                    (a paragraph/cell boundary landing mid-word). Also
 *                    ours, but a different defect with a different fix.
 *   `token-ceiling`  a well-formed 4-token phrase immediately followed by
 *                    another capitalized token -> FALLBACK_PERSON_RE's
 *                    `{1,3}` bound. Ours, reproducible, described above.
 *   `source-literal` the fragment is bounded by non-letters on both sides
 *                    and is not at a suspicious boundary -> it really is
 *                    written that way. PeopleSoft field labels ("Acad
 *                    Struc", "Appt Nbr", "Comm Gen") are the expected
 *                    population here, and they are legitimate content.
 *
 * WHY `source-literal` MATTERS AS MUCH AS THE DEFECTS. Andrew's document
 * is a CMS/PeopleSoft correspondence set, and PeopleSoft abbreviates
 * aggressively in its own UI. "Acad Struc" is very likely a real string a
 * human typed or pasted, not damage. Classifying those as corruption and
 * "repairing" them would invent text that never existed -- the opposite of
 * a redaction tool's job. This classifier therefore defaults to
 * `source-literal` and only claims damage on positive evidence.
 */

/** One occurrence, reduced to what the classification needs. */
export interface TruncationProbe {
  /** The parsed text of the block the occurrence sits in. */
  blockText: string;
  /** Offsets of the occurrence within `blockText`. */
  startOffset: number;
  endOffset: number;
  /** The occurrence's own literal text. */
  text: string;
}

export type TruncationOrigin =
  /** DocScrub cut a word that continues in the same block. Correctness defect. */
  | "severed"
  /** The parse split a word across block boundaries. Correctness defect. */
  | "block-boundary"
  /** FALLBACK_PERSON_RE's 4-token ceiling. Correctness defect (ours). */
  | "token-ceiling"
  /** Written that way in the source. Legitimate content. */
  | "source-literal";

export interface TruncationFinding {
  origin: TruncationOrigin;
  /** The fragment as detected. */
  text: string;
  /** What the parsed text shows continuing after it, when anything does --
   *  the evidence for the call, so a report can quote it rather than
   *  asserting. */
  continuation: string;
  /** True for the three origins DocScrub is responsible for. */
  isDefect: boolean;
}

const LETTER = /\p{L}/u;
const UPPER_START = /^\p{Lu}/u;

function charAt(text: string, index: number): string {
  return index >= 0 && index < text.length ? text.charAt(index) : "";
}

/** Letters immediately following the span, up to the next non-letter. */
function trailingWordRemainder(blockText: string, endOffset: number): string {
  let out = "";
  for (let i = endOffset; i < blockText.length; i += 1) {
    const ch = blockText.charAt(i);
    if (!LETTER.test(ch)) break;
    out += ch;
  }
  return out;
}

function tokenCount(text: string): number {
  return text.split(/\s+/).filter((t) => t.length > 0).length;
}

/** The next whitespace-delimited token after the span, if any. */
function nextToken(blockText: string, endOffset: number): string {
  const rest = blockText.slice(endOffset).replace(/^\s+/, "");
  const match = /^\S+/.exec(rest);
  return match ? match[0] : "";
}

/**
 * Classifies ONE occurrence. Ordered most-specific first: a severed word is
 * unambiguous evidence and outranks the token-count heuristic, which in
 * turn outranks the default.
 *
 * `FALLBACK_MAX_TOKENS` is 4 by construction (`{1,3}` = one token plus one
 * to three more). Stated as a constant rather than a literal so the tie to
 * the regex is visible if either changes.
 */
export const FALLBACK_MAX_TOKENS = 4;

export function classifyTruncation(probe: TruncationProbe): TruncationFinding {
  const { blockText, startOffset, endOffset, text } = probe;

  const remainder = trailingWordRemainder(blockText, endOffset);
  if (remainder.length > 0) {
    // The word continues immediately. Whether the span ALSO ends at the
    // block edge is irrelevant here -- there is text after it, so this is
    // not a boundary case.
    return { origin: "severed", text, continuation: remainder, isDefect: true };
  }

  // Nothing follows in this block. If the span runs to the very end AND the
  // final token is not a plausible whole word, the parse likely cut it at a
  // paragraph/cell edge. "Plausible whole word" is deliberately weak -- we
  // are looking for a boundary coincidence, not judging vocabulary.
  if (endOffset >= blockText.length) {
    const lastToken = text.split(/\s+/).filter(Boolean).pop() ?? "";
    // A trailing single letter, or a token ending in a doubled consonant
    // pattern typical of a cut, is suspicious. Kept conservative: a
    // one-character trailing token is the only signal strong enough to
    // claim damage without the source in hand.
    if (lastToken.length === 1 && UPPER_START.test(lastToken) === false) {
      return { origin: "block-boundary", text, continuation: "", isDefect: true };
    }
  }

  // A maxed-out token run immediately followed by another capitalized token
  // is FALLBACK_PERSON_RE's ceiling, not a sentence ending.
  if (tokenCount(text) === FALLBACK_MAX_TOKENS) {
    const next = nextToken(blockText, endOffset);
    const boundary = charAt(blockText, endOffset);
    if (next && UPPER_START.test(next) && /\s/.test(boundary)) {
      return { origin: "token-ceiling", text, continuation: next, isDefect: true };
    }
  }

  return { origin: "source-literal", text, continuation: "", isDefect: false };
}

/**
 * Builds a probe from an Occurrence's `context` snippet, which is the only
 * view of surrounding text a loaded session exposes (WorkspaceState carries
 * the pipeline's outputs, not the DocumentModel's blocks).
 *
 * `contextSnippet` (DetectionEngine.ts:123) emits
 *
 *     [...]left[MATCH]right[...]
 *
 * with a 70-character window either side and literal `...` markers only
 * when the block actually continued past the window. That is enough for
 * this classifier: a severed word shows its remainder immediately after the
 * `]`, and 70 characters is far more than any word needs.
 *
 * THE ONE THING IT CANNOT SEE is a true end-of-block, because a match
 * ending exactly at the block edge and one ending 70 characters early both
 * present as "no suffix marker". So a probe built this way reports the
 * window as the block, and `block-boundary` findings from it should be read
 * as "not distinguishable from here" rather than as a positive claim.
 * Severed and token-ceiling are unaffected -- both are decided by what
 * FOLLOWS the span, which the window does show.
 *
 * Returns null when the snippet does not contain a bracketed span (nothing
 * to say rather than a guess).
 */
export function probeFromContext(context: string, text: string): TruncationProbe | null {
  const open = context.indexOf("[");
  const close = context.indexOf("]", open + 1);
  if (open < 0 || close < 0) return null;
  const left = context.slice(0, open).replace(/^\.\.\./, "");
  const matched = context.slice(open + 1, close);
  const right = context.slice(close + 1).replace(/\.\.\.$/, "");
  const blockText = left + matched + right;
  return { blockText, startOffset: left.length, endOffset: left.length + matched.length, text };
}

export interface TruncationReport {
  total: number;
  byOrigin: Record<TruncationOrigin, number>;
  defects: TruncationFinding[];
  sourceLiterals: TruncationFinding[];
}

/**
 * Runs the classification over a document's occurrences and summarizes.
 *
 * The SHAPE of the answer is the point: `A / B / C` is not a judgement call
 * once every fragment carries an origin and the evidence for it. A report
 * with a non-empty `defects` list means DocScrub is damaging text, and
 * Phase 2 waits.
 */
export function reportTruncations(probes: readonly TruncationProbe[]): TruncationReport {
  const findings = probes.map(classifyTruncation);
  const byOrigin: Record<TruncationOrigin, number> = {
    severed: 0,
    "block-boundary": 0,
    "token-ceiling": 0,
    "source-literal": 0,
  };
  for (const f of findings) byOrigin[f.origin] += 1;
  return {
    total: findings.length,
    byOrigin,
    defects: findings.filter((f) => f.isDefect),
    sourceLiterals: findings.filter((f) => !f.isDefect),
  };
}
