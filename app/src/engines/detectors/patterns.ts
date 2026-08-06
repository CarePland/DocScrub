/**
 * Faithful, line-for-line port of redactor/detectors.py's regex constants
 * and stop lists (the Python behavioral oracle for Phase 4 -- see
 * docs/detection/phase-4-findings.md). Deliberately not "improved" or
 * simplified: every pattern below should be traceable to an exact line in
 * detectors.py, so a divergence in behavior can only come from an
 * intentional, documented deviation, not an accidental rewrite.
 *
 * JavaScript's RegExp supports everything these patterns need 1:1 with
 * Python's `re` module here: negative lookbehind (`(?<!\d)`), word
 * boundaries (`\b`), and case-insensitive matching (`i` flag) all behave
 * the same way for the ASCII-range patterns used below. No pattern needed
 * to be restructured to work in JS.
 *
 * DOCUMENTED DEVIATION #1 -- the three person patterns are deliberately
 * NO LONGER byte-equal to detectors.py (2026-08-05, AG). Every other
 * constant in this file remains a faithful port; see PERSON_TOKEN /
 * UNICODE_WORD_* below for the full reasoning and the exact respects in
 * which the ported behavior was wrong for real documents rather than
 * merely different.
 */

/**
 * Unicode-aware word boundaries, replacing `\b`.
 *
 * `\b` is defined in terms of `\w`, which in JavaScript is ASCII-only
 * (`[A-Za-z0-9_]`) and STAYS ASCII-only under the `u` flag -- unlike
 * Python's `re`, where `\b` is Unicode-aware for `str` patterns. That
 * single difference is the root cause of the truncated-detection defect
 * in 20260803-detection-classification-handoff.md §1: in "Guzmán", `á`
 * is not an ASCII word character, so it both terminates the token AND
 * supplies a legal `\b`, making the truncated match "Guzm" well-formed
 * by the pattern's own rules. Redacting the truncated span leaves "án"
 * in the released document -- a SILENT PARTIAL REDACTION, which is why
 * this is a correctness fix and not a recall improvement.
 *
 * Note that restoring literal parity with Python would NOT be correct
 * either: Python's Unicode-aware `\b` finds no boundary between "m" and
 * "á", so FALLBACK_PERSON_RE backtracks and matches "Yazmine Guzmán"
 * NOT AT ALL. Python silently drops the name; the JS port silently
 * truncates it. Both are wrong; neither is the behavior to preserve.
 *
 * `\p{M}` (combining marks) is included alongside letters and digits so
 * that DECOMPOSED input behaves like precomposed input -- "é" may arrive
 * as U+00E9 or as "e" + U+0301, and Word documents authored on macOS
 * routinely carry the latter. Nothing upstream normalizes block text
 * before detection, so the patterns must tolerate both forms.
 */
const UNICODE_WORD_CHAR = String.raw`[\p{L}\p{N}\p{M}_]`;
/** Start-of-word `\b`. The patterns below all begin with `\p{Lu}` (always
 *  a word character), so asserting "no word character behind" is exactly
 *  equivalent to `\b` at that position. */
const UNICODE_WORD_START = String.raw`(?<!${UNICODE_WORD_CHAR})`;
/** End-of-word `\b`. BOTH halves are required: a bare negative lookahead
 *  would let SINGLE_PERSON_RE / LAST_FIRST_PERSON_RE match a trailing
 *  `'` or `-` ("Smith-" instead of "Smith"), because those characters are
 *  inside the token class but are not word characters. `\b` backtracks
 *  off them; the lookbehind is what reproduces that. */
const UNICODE_WORD_END = String.raw`(?<=${UNICODE_WORD_CHAR})(?!${UNICODE_WORD_CHAR})`;

/** `[A-Z]` -> any uppercase letter. */
export const UPPER = String.raw`\p{Lu}`;
/** `[a-z]` -> any lowercase letter or combining mark. */
const LOWER_RUN = String.raw`[\p{Ll}\p{M}]`;
/** `[a-zA-Z'’-]` -> any letter or combining mark, plus the same two
 *  apostrophe forms and hyphen the ported class carried. */
export const NAME_RUN = String.raw`[\p{L}\p{M}'’-]`;
/** Exported so DetectionEngine's capitalized-neighbor patterns -- which
 *  gate whether a single-name match is suppressed as part of an already
 *  detected multi-word name -- can be built from the SAME definition the
 *  person patterns use. They were separately ASCII-only, which meant an
 *  accented name defeated the neighbor check as well as the match: both
 *  fragments of "José Martínez" were emitted as independent candidates.
 *  One definition, so the two cannot disagree about what a name token is. */
export { UNICODE_WORD_END };

// EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
export const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

// PHONE_RE = re.compile(
//     r"(?<!\d)(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}(?!\d)"
// )
export const PHONE_RE = /(?<!\d)(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}(?!\d)/g;

// CIN_RE = re.compile(r"(?<!\d)\d{9}(?!\d)")
export const CIN_RE = /(?<!\d)\d{9}(?!\d)/g;

// LONG_ID_RE = re.compile(r"(?<!\d)(?:\d[\s-]?){10,18}\d?(?!\d)")
export const LONG_ID_RE = /(?<!\d)(?:\d[\s-]?){10,18}\d?(?!\d)/g;

// FALLBACK_PERSON_RE = re.compile(
//     r"\b(?:[A-Z][a-z]{1,30})(?:\s+(?:[A-Z][a-z]{1,30})){1,3}\b"
// )
// DEVIATION #1: `\b` -> UNICODE_WORD_*, `[A-Z]` -> \p{Lu}, `[a-z]` -> \p{Ll}|\p{M}.
export const FALLBACK_PERSON_RE = new RegExp(
  `${UNICODE_WORD_START}(?:${UPPER}${LOWER_RUN}{1,30})(?:\\s+(?:${UPPER}${LOWER_RUN}{1,30})){1,3}${UNICODE_WORD_END}`,
  "gu"
);

// LAST_FIRST_PERSON_RE = re.compile(
//     r"\b[A-Z][a-zA-Z'’-]{1,30},\s+[A-Z][a-zA-Z'’-]{1,30}(?:\s+[A-Z][a-zA-Z'’-]{1,30})?\b"
// )
// DEVIATION #1: `\b` -> UNICODE_WORD_*, `[A-Z]` -> \p{Lu}, `[a-zA-Z'’-]` -> NAME_RUN.
export const LAST_FIRST_PERSON_RE = new RegExp(
  `${UNICODE_WORD_START}${UPPER}${NAME_RUN}{1,30},\\s+${UPPER}${NAME_RUN}{1,30}` +
    `(?:\\s+${UPPER}${NAME_RUN}{1,30})?${UNICODE_WORD_END}`,
  "gu"
);

// SINGLE_PERSON_RE = re.compile(r"\b[A-Z][a-zA-Z'’-]{2,30}\b")
// DEVIATION #1: `\b` -> UNICODE_WORD_*, `[A-Z]` -> \p{Lu}, `[a-zA-Z'’-]` -> NAME_RUN.
export const SINGLE_PERSON_RE = new RegExp(
  `${UNICODE_WORD_START}${UPPER}${NAME_RUN}{2,30}${UNICODE_WORD_END}`,
  "gu"
);

// DATE_LIKE_RE = re.compile(
//     r"(?<!\d)(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2})(?!\d)"
// )
export const DATE_LIKE_RE = /(?<!\d)(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2})(?!\d)/;
// Python's `DATE_LIKE_RE.fullmatch(value)` requires the WHOLE string to
// match, not just a substring. JS has no `fullmatch`; anchoring the same
// source with ^...$ is the direct equivalent.
const DATE_LIKE_FULLMATCH_RE = new RegExp(`^(?:${DATE_LIKE_RE.source})$`);
export function isDateLikeFullMatch(value: string): boolean {
  return DATE_LIKE_FULLMATCH_RE.test(value);
}

// Non-global variant of EMAIL_RE for `EMAIL_RE.search(value)`-style
// existence checks (used by detect_people to skip a person-regex match
// that's actually part of an email address). A separate constant rather
// than reusing the global EMAIL_RE above: calling `.test()` on a `g`-flag
// RegExp mutates its `lastIndex`, which would corrupt any concurrent
// `matchAll` iteration using the same object. Keeping a same-source,
// non-global sibling avoids that shared-mutable-state hazard entirely
// rather than relying on callers to remember to reset `lastIndex`.
const EMAIL_SEARCH_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
export function containsEmail(value: string): boolean {
  return EMAIL_SEARCH_RE.test(value);
}

// PERSON_STOP_PHRASES = { ... }
export const PERSON_STOP_PHRASES = new Set<string>([
  "Microsoft Teams",
  "Teams Meeting",
  "From Sent",
  "Subject Re",
  "Page Number",
  "Table Of",
]);

// SINGLE_PERSON_STOP_WORDS = { ... }
export const SINGLE_PERSON_STOP_WORDS = new Set<string>([
  "Account",
  "Attachment",
  "Body",
  "Call",
  "Category",
  "CIN",
  "Core",
  "DOCX",
  "Date",
  "Email",
  "Footer",
  "From",
  "Header",
  "ID",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
  "Meeting",
  "Message",
  "Microsoft",
  "Page",
  "Participant",
  "Phone",
  "Re",
  "Sent",
  "Subject",
  "Table",
  "Teams",
  "Word",
]);
