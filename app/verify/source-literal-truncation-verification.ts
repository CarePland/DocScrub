/**
 * source-literal-truncation-verification.ts -- proof that `Term Withdra`
 * and its siblings are SOURCE TEXT, not DocScrub damage (AG, 2026-08-09).
 *
 * ============================== WHY THIS EXISTS ==============================
 * The live People residue contains fragments that look like corruption:
 *
 *     Student Final Exa
 *     Term Withdra
 *     Virtual Clearinghouse Academ
 *     Priority Registrati
 *
 * The worry is legitimate and the stakes are real: if DocScrub cut those, a
 * reviewer redacting `Term Withdra` writes `[REDACTED]wals` into the
 * document -- the same output-corruption class as oracle deviation #4.
 *
 * IT DID NOT CUT THEM, and this suite is the proof rather than the claim.
 * `FALLBACK_PERSON_RE`'s token is `\p{Lu}\p{Ll}{1,30}` followed by
 * UNICODE_WORD_END: the lowercase run is GREEDY and the match must end on a
 * word boundary. Given complete source text it consumes the whole word. It
 * is structurally incapable of stopping mid-word.
 *
 * The only way to obtain `Term Withdra` is for the document to contain
 * `Term Withdra` -- which is entirely expected here. This is a
 * PeopleSoft/CMS correspondence set, and PeopleSoft abbreviates field labels
 * aggressively in its own UI.
 * ==========================================================================
 *
 * THIS SUITE IS THEREFORE A GUARD AGAINST A FIX, not a fix. Andrew:
 * "Do not 'repair' legitimate source text such as PeopleSoft abbreviations
 * merely because it looks truncated." A future reader pattern-matching on
 * appearance would be inventing text that never existed, which is the
 * opposite of a redaction tool's job.
 *
 * It complements truncation-diagnostics-verification.ts: that suite proves
 * the CLASSIFIER can still recognize real severing, this one proves the
 * DETECTOR cannot produce these particular fragments in the first place.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/source-literal-truncation-verification.ts
 */

import { FALLBACK_PERSON_RE } from "../src/engines/detectors/patterns.ts";
import { classifyTruncation } from "../src/engines/detectors/truncationDiagnostics.ts";

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

const matches = (text: string): string[] => [...text.matchAll(new RegExp(FALLBACK_PERSON_RE.source, "gu"))].map((m) => m[0]);

console.log("=== Source-literal truncation (a guard against 'repairing' real text) ===\n");

console.log("--- THE DETECTOR CANNOT SEVER A COMPLETE WORD ---");
{
  /*
   * Each of Andrew's worrying fragments, fed as COMPLETE source text. If
   * DocScrub were responsible, one of these would produce the fragment.
   */
  const cases: Array<[string, string]> = [
    ["Term Withdrawals are due Friday", "Term Withdrawals"],
    ["Student Final Exams begin Monday", "Student Final Exams"],
    ["Virtual Clearinghouse Academic records", "Virtual Clearinghouse Academic"],
    ["Priority Registration opens next week", "Priority Registration"],
  ];
  for (const [source, expected] of cases) {
    const found = matches(source);
    check(
      `"${source.slice(0, 38)}" -> "${expected}" (whole words)`,
      found.includes(expected),
      JSON.stringify(found)
    );
    check(
      `  and NO mid-word fragment is produced`,
      !found.some((f) => f !== expected && expected.startsWith(f)),
      JSON.stringify(found)
    );
  }
}

console.log("\n--- WHEN THE SOURCE IS ALREADY ABBREVIATED, IT IS REPRODUCED FAITHFULLY ---");
{
  /*
   * The actual explanation. These are PeopleSoft field labels: the document
   * says this, so DocScrub reports this. Reproducing source text exactly is
   * correct behaviour, and redacting one of these damages nothing, because
   * there is no remainder to leave behind.
   */
  const cases: Array<[string, string]> = [
    ["Term Withdra is a field label", "Term Withdra"],
    ["Student Final Exa column header", "Student Final Exa"],
    ["Virtual Clearinghouse Academ header", "Virtual Clearinghouse Academ"],
    ["Priority Registrati field", "Priority Registrati"],
    ["Acad Struc reference", "Acad Struc"],
    ["Appt Nbr column", "Appt Nbr"],
  ];
  for (const [source, expected] of cases) {
    check(`"${source.slice(0, 36)}" -> "${expected}" reproduced exactly`, matches(source).includes(expected), JSON.stringify(matches(source)));
  }
}

console.log("\n--- THE CLASSIFIER AGREES: bounded by non-letters => source-literal ---");
{
  /*
   * The same conclusion from the other direction, using the production
   * classifier rather than the regex. Its test is whether the word CONTINUES
   * in the parsed block -- if DocScrub had cut it, the remainder would still
   * be sitting there.
   */
  const literal = classifyTruncation({
    blockText: "Term Withdra is a field label on the enrollment page",
    text: "Term Withdra",
    startOffset: 0,
    endOffset: 12,
  });
  check(`"Term Withdra" with no continuation -> source-literal`, literal.origin === "source-literal" && !literal.isDefect, JSON.stringify(literal));

  /*
   * AND THE CONTROL THAT MAKES THE ABOVE MEAN SOMETHING: if the word really
   * did continue, the classifier must still call it damage. A suite that
   * only proved "nothing is a defect" would be worthless.
   */
  const severed = classifyTruncation({
    blockText: "Term Withdrawals are due Friday",
    text: "Term Withdra",
    startOffset: 0,
    endOffset: 12,
  });
  check(`"Term Withdra" WITH "wals" continuing -> severed, isDefect`, severed.origin === "severed" && severed.isDefect, JSON.stringify(severed));
  check(`  and it reports the remainder that would be orphaned`, severed.continuation.startsWith("wals"), JSON.stringify(severed));
}

console.log("\n--- THE CONSEQUENCE, ASSERTED AS OUTPUT ---");
{
  /*
   * The corruption Andrew was worried about, spelled out as a resulting
   * string in both directions -- claimed as text rather than argued.
   */
  const source = "Term Withdra is a field label";
  const redactedLiteral = source.replace("Term Withdra", "[REDACTED]");
  check(
    `redacting the source-literal fragment leaves clean text: "${redactedLiteral.slice(0, 34)}"`,
    redactedLiteral === "[REDACTED] is a field label"
  );

  const hypothetical = "Term Withdrawals are due Friday";
  const wouldCorrupt = hypothetical.replace("Term Withdra", "[REDACTED]");
  check(
    `had it been severed, redaction WOULD have corrupted: "${wouldCorrupt.slice(0, 34)}"`,
    wouldCorrupt === "[REDACTED]wals are due Friday"
  );
}

console.log(`\n=== ${passCount} passed, ${failCount} failed ===`);
if (failCount > 0) {
  for (const f of failed) console.log(`  - ${f}`);
  process.exitCode = 1;
}
