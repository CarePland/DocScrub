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
 */

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
export const FALLBACK_PERSON_RE = /\b(?:[A-Z][a-z]{1,30})(?:\s+(?:[A-Z][a-z]{1,30})){1,3}\b/g;

// LAST_FIRST_PERSON_RE = re.compile(
//     r"\b[A-Z][a-zA-Z'’-]{1,30},\s+[A-Z][a-zA-Z'’-]{1,30}(?:\s+[A-Z][a-zA-Z'’-]{1,30})?\b"
// )
export const LAST_FIRST_PERSON_RE = /\b[A-Z][a-zA-Z'’-]{1,30},\s+[A-Z][a-zA-Z'’-]{1,30}(?:\s+[A-Z][a-zA-Z'’-]{1,30})?\b/g;

// SINGLE_PERSON_RE = re.compile(r"\b[A-Z][a-zA-Z'’-]{2,30}\b")
export const SINGLE_PERSON_RE = /\b[A-Z][a-zA-Z'’-]{2,30}\b/g;

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
