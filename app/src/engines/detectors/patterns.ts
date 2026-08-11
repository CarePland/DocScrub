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

/** Not a digit and not a letter -- see DEVIATION #4. Declared here because
 *  PHONE_RE, CIN_RE and LONG_ID_RE all consume it. */
const ID_BOUNDARY_BEFORE = String.raw`(?<![\p{L}\d])`;
const ID_BOUNDARY_AFTER = String.raw`(?![\p{L}\d])`;

// EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
export const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

// PHONE_RE = re.compile(
//     r"(?<!\d)(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}(?!\d)"
// )
// DEVIATION #4c (AG, 2026-08-09): the SAME digit-only guard defect as CIN_RE
// and LONG_ID_RE, found by the identifier-shapes-001 parity fixture AFTER
// #4a/#4b landed. The first pass judged PHONE_RE "not implicated" and
// asserted it unchanged; the fixture disproved that in its first run:
//
//     "The upload id=18900663687e4c1a99 failed to process."
//        PHONE_RE matches -> 18900663687
//        redacted -> "The upload id=[REDACTED]e4c1a99 failed to process."
//
// An eleven-digit run inside a hex blob is not a phone number, and redacting
// it corrupts the document exactly as the CIN case did. Same guards, same
// rationale, same classification (correctness fix, not behaviour change).
// This is why the fixture was built.
export const PHONE_RE = new RegExp(
  `${ID_BOUNDARY_BEFORE}(?:\\+?1[\\s.-]?)?(?:\\(?\\d{3}\\)?[\\s.-]?)\\d{3}[\\s.-]?\\d{4}${ID_BOUNDARY_AFTER}`,
  "gu"
);

/*
 * ============================================================================
 * DELIBERATE ORACLE DEVIATION #4 -- IDENTIFIER BOUNDARIES (AG, 2026-08-09)
 *
 * Python guards these two patterns against DIGITS only: `(?<!\d)` / `(?!\d)`.
 * A nine- or eleven-digit run sitting inside a longer ALPHANUMERIC token
 * therefore matches, because the neighbouring character is a letter and the
 * digit guard does not see it.
 *
 * That is not a queue-noise problem, it is an OUTPUT CORRECTNESS problem,
 * and it was demonstrated on Andrew's live document rather than reasoned
 * about (7 severed occurrences, `__docscrub.truncations()` 2026-08-09):
 *
 *     https://teams.microsoft.com/l/meetup/781237504d3f8a9b
 *              CIN_RE matches -----------> 781237504
 *     redacted -> https://teams.microsoft.com/l/meetup/[REDACTED]d3f8a9b
 *
 * A URL is destroyed and the document is silently wrong. The same shape
 * appeared as `18900663687e...` and `01200067742E...` -- hex blobs and
 * meeting identifiers, none of them a Campus ID.
 *
 * THE DEVIATION: both guards widen from "not a digit" to "not a digit and
 * not a letter". A real CIN is delimited by whitespace or punctuation, so
 * genuine detections are unaffected (asserted in
 * verify/identifier-boundary-verification.ts); what stops matching is
 * exactly the case where the digits are part of a larger token.
 *
 * WHY NOT NARROWER. Restricting only to hex letters [a-fA-F] would fix the
 * observed cases and miss `781237504zz`. The claim being made is "these
 * digits are part of a bigger word", and a letter -- any letter -- is what
 * makes that true.
 *
 * SECOND DEVIATION, SAME LINE -- LONG_ID_RE's TRAILING SEPARATOR.
 * `(?:\d[\s-]?){10,18}` lets the FINAL repetition consume a trailing space,
 * so "826 0122 9711 Passcode" matched "826 0122 9711 " INCLUDING the space
 * (live case 1 of the same 7). Redacting it eats the separator and yields
 * "[REDACTED]Passcode". Restructured to `\d(?:[\s-]?\d){9,18}` -- digit,
 * then separator-then-digit -- which cannot end on a separator and spans the
 * same 10..19 digits the original did.
 *
 * Both are classified as CORRECTNESS FIXES rather than behaviour changes:
 * the Python oracle produces output that corrupts the document, and
 * `AGENTS.md`'s "preserve the stated reviewer behavior" does not extend to
 * preserving a defect that damages the artifact being protected.
 * ============================================================================
 */

// CIN_RE = re.compile(r"(?<!\d)\d{9}(?!\d)")
// DEVIATION #4: digit-only guards -> digit-or-letter guards.
export const CIN_RE = new RegExp(`${ID_BOUNDARY_BEFORE}\\d{9}${ID_BOUNDARY_AFTER}`, "gu");

// LONG_ID_RE = re.compile(r"(?<!\d)(?:\d[\s-]?){10,18}\d?(?!\d)")
// DEVIATION #4: digit-or-letter guards, and the trailing separator can no
// longer be consumed (10..19 digits either way).
export const LONG_ID_RE = new RegExp(`${ID_BOUNDARY_BEFORE}\\d(?:[\\s-]?\\d){9,18}${ID_BOUNDARY_AFTER}`, "gu");

// FALLBACK_PERSON_RE = re.compile(
//     r"\b(?:[A-Z][a-z]{1,30})(?:\s+(?:[A-Z][a-z]{1,30})){1,3}\b"
// )
// DEVIATION #1: `\b` -> UNICODE_WORD_*, `[A-Z]` -> \p{Lu}, `[a-z]` -> \p{Ll}|\p{M}.
/*
 * DELIBERATE ORACLE DEVIATION #5 -- TOKEN CEILING (AG, 2026-08-09).
 *
 * Python's `{1,3}` caps a match at FOUR tokens. A longer capitalized phrase
 * is not skipped, it is CUT, and the remainder becomes its own candidate --
 * two review units and, worse, two replacement spans covering one phrase.
 * Confirmed on the live document (`__docscrub.truncations()`, 2 cases):
 *
 *     "Post Enrollment Requisite Checking Background Process"
 *          -> "Post Enrollment Requisite Checking" + "Background Process"
 *     "Term Session Appt Block Appt Nbr"
 *          -> "Term Session Appt Block" + "Appt Nbr"
 *
 * Redacting the first half leaves "[REDACTED] Background Process" -- a
 * dangling fragment of a phrase the reviewer thought they had handled.
 *
 * THE DEVIATION: `{1,3}` -> `{1,5}` (max six tokens). Chosen by measurement,
 * not preference: `{1,5}` merges both live cases, and `{1,7}` merges nothing
 * further on this document while over-joining long institutional headings
 * ("The Office Of The Registrar And Enrollment Services"). Four-token person
 * names ("Mary Jane Watson Parker") are unaffected at every bound tested.
 *
 * Any bound has a boundary; this one is placed where the evidence put it.
 */
export const FALLBACK_PERSON_RE = new RegExp(
  `${UNICODE_WORD_START}(?:${UPPER}${LOWER_RUN}{1,30})(?:\\s+(?:${UPPER}${LOWER_RUN}{1,30})){1,5}${UNICODE_WORD_END}`,
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
