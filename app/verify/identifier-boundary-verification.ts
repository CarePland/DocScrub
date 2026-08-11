/**
 * identifier-boundary-verification.ts -- the three Phase 1 correctness
 * fixes (AG, 2026-08-09), each proven against the live evidence that
 * produced it.
 *
 * All three are DELIBERATE ORACLE DEVIATIONS (patterns.ts DEVIATION #4 and
 * #5). They are classified as correctness fixes rather than behaviour
 * changes because in each case the Python oracle's output DAMAGES the
 * document -- and a redaction tool that corrupts the artifact it is
 * protecting has not preserved a behaviour worth preserving.
 *
 * THREE SEPARATE DEFECTS, kept separate here at Andrew's explicit
 * instruction ("I do not want them conflated with the person-name
 * truncation problem"):
 *
 *   1. IDENTIFIER-INSIDE-TOKEN   CIN_RE / LONG_ID_RE matched a digit run
 *                                inside a longer alphanumeric token.
 *                                CORRUPTS OUTPUT.
 *   2. TRAILING SEPARATOR        LONG_ID_RE consumed the space after the
 *                                final digit. CORRUPTS OUTPUT.
 *   3. TOKEN CEILING             FALLBACK_PERSON_RE cut phrases at four
 *                                tokens. Splits one phrase into two review
 *                                units and two replacement spans.
 *
 * Every assertion runs the real patterns. The replacement-corruption checks
 * perform the actual splice, because "would corrupt output" is a claim about
 * the resulting string and should be asserted as one.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/identifier-boundary-verification.ts
 */

import { CIN_RE, LONG_ID_RE, FALLBACK_PERSON_RE, PHONE_RE } from "../src/engines/detectors/patterns.ts";

let passCount = 0;
let failCount = 0;
const failed: string[] = [];

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passCount += 1;
    console.log(`  PASS ${label}`);
  } else {
    failCount += 1;
    failed.push(label);
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

interface Hit {
  text: string;
  start: number;
  end: number;
}
function hits(re: RegExp, text: string): Hit[] {
  return [...text.matchAll(new RegExp(re.source, re.flags))].map((m) => ({
    text: m[0],
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
  }));
}
/** What DocumentRebuilder would produce for the first hit. */
function redactFirst(re: RegExp, text: string): string {
  const h = hits(re, text)[0];
  return h ? text.slice(0, h.start) + "[REDACTED]" + text.slice(h.end) : text;
}

console.log("=== DEFECT 1: identifier matched INSIDE a longer token ===\n");
console.log("--- the live cases must no longer match ---");
{
  const cases: Array<[RegExp, string, string]> = [
    [CIN_RE, "https://teams.microsoft.com/l/meetup/781237504d3f8a9b", "781237504 inside a URL/GUID"],
    [LONG_ID_RE, "id=18900663687e4c1a99", "18900663687 inside a hex blob"],
    [LONG_ID_RE, "ref 01200067742E5B", "01200067742 followed by hex letters"],
  ];
  for (const [re, text, label] of cases) {
    check(`${label}: no match`, hits(re, text).length === 0, JSON.stringify(hits(re, text).map((h) => h.text)));
  }

  // The corruption this prevents, asserted as the actual output string.
  const url = "https://teams.microsoft.com/l/meetup/781237504d3f8a9b";
  check("redaction leaves the URL intact (nothing to redact)", redactFirst(CIN_RE, url) === url, redactFirst(CIN_RE, url));
}

console.log("\n--- genuine identifiers must STILL match (the fix is a boundary, not a ban) ---");
{
  const positives: Array<[RegExp, string, string]> = [
    [CIN_RE, "CIN 781237504 for the student", "781237504"],
    [CIN_RE, "Student ID: 123456789.", "123456789"],
    [CIN_RE, "(987654321)", "987654321"],
    [CIN_RE, "id=456789012&x=1", "456789012"],
    [CIN_RE, "781237504", "781237504"],
    [LONG_ID_RE, "Meeting ID: 826 0122 9711 Passcode", "826 0122 9711"],
    [LONG_ID_RE, "account 1234567890123", "1234567890123"],
    [LONG_ID_RE, "ref 123-456-789-012", "123-456-789-012"],
  ];
  for (const [re, text, expected] of positives) {
    const found = hits(re, text).map((h) => h.text);
    check(`still detects ${JSON.stringify(expected)} in ${JSON.stringify(text)}`, found.includes(expected), JSON.stringify(found));
  }
}

console.log("\n--- the digit guard the oracle already had must survive ---");
{
  check("a 9-digit run inside a longer digit run is still not a CIN", hits(CIN_RE, "1234567890123").length === 0);
  check("10+ digits are still LONG_ID, not CIN", hits(CIN_RE, "12345678901").length === 0);
}

console.log("\n=== DEFECT 2: LONG_ID_RE consumed the trailing separator ===\n");
{
  const text = "Meeting ID: 826 0122 9711 Passcode: aB3xy";
  const h = hits(LONG_ID_RE, text)[0];
  check("the meeting id is detected", h !== undefined && h.text === "826 0122 9711", h?.text);
  check(
    "the match does NOT include the trailing space",
    h !== undefined && !/\s$/.test(h.text),
    JSON.stringify(h?.text)
  );
  check(
    "the character after the match is the separator, not the next word",
    h !== undefined && text.charAt(h.end) === " ",
    JSON.stringify(text.charAt(h?.end ?? 0))
  );
  // The corruption this prevents.
  check(
    "redaction preserves the space before 'Passcode'",
    redactFirst(LONG_ID_RE, text) === "Meeting ID: [REDACTED] Passcode: aB3xy",
    redactFirst(LONG_ID_RE, text)
  );

  // Internal separators are still part of the identifier.
  const dashed = hits(LONG_ID_RE, "ref 123-456-789-012 end")[0];
  check("internal separators are still consumed", dashed?.text === "123-456-789-012", dashed?.text);
  check("but a trailing dash is not", dashed !== undefined && !/[\s-]$/.test(dashed.text), dashed?.text);

  // Digit-count range is unchanged by the restructure (10..19).
  check("10 digits still match", hits(LONG_ID_RE, "x 1234567890 y").length === 1);
  check("9 digits do not (that is CIN's range)", hits(LONG_ID_RE, "x 123456789 y").length === 0);
  check("19 digits still match", hits(LONG_ID_RE, "x 1234567890123456789 y").length === 1);
}

console.log("\n=== DEFECT 3: FALLBACK_PERSON_RE's four-token ceiling ===\n");
console.log("--- the two live cases are now one candidate each ---");
{
  const cases: Array<[string, string]> = [
    ["Post Enrollment Requisite Checking Background Process runs nightly", "Post Enrollment Requisite Checking Background Process"],
    ["Term Session Appt Block Appt Nbr field", "Term Session Appt Block Appt Nbr"],
  ];
  for (const [text, expected] of cases) {
    const found = hits(FALLBACK_PERSON_RE, text).map((h) => h.text);
    check(`${JSON.stringify(expected)} is ONE candidate`, found.includes(expected), JSON.stringify(found));
    check(`  and is not split into two`, found.length === 1, JSON.stringify(found));
  }
}

console.log("\n--- person names are unaffected ---");
{
  const names: Array<[string, string]> = [
    ["contact Mary Jane Watson Parker today", "Mary Jane Watson Parker"],
    ["ask Andrew Goodloe about it", "Andrew Goodloe"],
  ];
  for (const [text, expected] of names) {
    const found = hits(FALLBACK_PERSON_RE, text).map((h) => h.text);
    check(`${JSON.stringify(expected)} still detected whole`, found.includes(expected), JSON.stringify(found));
  }

  /*
   * A MIDDLE INITIAL BREAKS THE RUN -- PRE-EXISTING, NOT CAUSED BY THIS FIX.
   *
   * `[A-Z][a-z]{1,30}` requires at least one LOWERCASE character, so a bare
   * initial ("L") matches no token position. "Tamara L Yamada" therefore
   * yields nothing from this pattern, at `{1,3}` and at `{1,5}` alike --
   * verified by reconstructing the original bound and running it.
   *
   * Recorded rather than quietly dropped from the suite: Andrew's document
   * contains "Yamada, Tamara L", which LAST_FIRST_PERSON_RE picks up as
   * "Yamada, Tamara" (its optional third token has the same lowercase
   * requirement). So the name IS detected, by a different pattern and
   * without the initial. That is a real limitation of the detector and a
   * candidate for a later pass; it is not part of DEVIATION #5 and must not
   * be conflated with it.
   */
  const initialCase = hits(FALLBACK_PERSON_RE, "Tamara L Yamada sent it").map((h) => h.text);
  check(
    "KNOWN LIMITATION (pre-existing): a bare middle initial breaks the token run",
    initialCase.length === 0,
    JSON.stringify(initialCase)
  );
}

console.log("\n--- the ceiling still exists; it moved, it did not vanish ---");
{
  // Seven capitalized tokens: still cut, because any bound has a boundary.
  // Asserted so a future reader knows this is a placed limit, not an oversight.
  const long = "The Office Of The Registrar And Enrollment Services Team";
  const found = hits(FALLBACK_PERSON_RE, long).map((h) => h.text);
  check("a very long capitalized run is still bounded", found.every((f) => f.split(/\s+/).length <= 6), JSON.stringify(found));
  check("six tokens is the new maximum", found.some((f) => f.split(/\s+/).length === 6), JSON.stringify(found));
}

console.log("\n=== DEFECT 1c: PHONE_RE had the SAME defect (found later, by the fixture) ===\n");
{
  /*
   * THIS SECTION REPLACES A WRONG ASSERTION.
   *
   * The first version of this suite said PHONE_RE "was not implicated and
   * must keep behaving exactly as before". The identifier-shapes-001 parity
   * fixture disproved that on its first run: the oracle emitted
   * `18900663687` as a PHONE from inside `id=18900663687e4c1a99`, and so did
   * DocScrub -- an output-corruption bug surviving a fix meant to cover it.
   *
   * Recorded as a correction rather than quietly rewritten, because the
   * earlier claim was the kind that stops people looking.
   */
  const blob = "The upload id=18900663687e4c1a99 failed to process.";
  check("an 11-digit run inside a hex blob is no longer a phone number", hits(PHONE_RE, blob).length === 0, JSON.stringify(hits(PHONE_RE, blob).map((h) => h.text)));
  check("redaction leaves the blob paragraph intact", redactFirst(PHONE_RE, blob) === blob, redactFirst(PHONE_RE, blob));

  // Genuine phone numbers, every shape the pattern supports.
  check("parenthesised phone still matches", hits(PHONE_RE, "call (323) 555-0142 today").length === 1);
  check("dashed phone still matches", hits(PHONE_RE, "323-555-0142.").length === 1);
  check("+1 form still matches", hits(PHONE_RE, "+1 323 555 0142 now").length === 1);
  check("a phone number inside a longer digit run still does not", hits(PHONE_RE, "12345555014299").length === 0);
}

console.log(`\n=== ${passCount} passed, ${failCount} failed ===`);
if (failCount > 0) {
  for (const f of failed) console.log(`  - ${f}`);
  process.exitCode = 1;
}
