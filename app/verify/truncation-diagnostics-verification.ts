/**
 * truncation-diagnostics-verification.ts -- behavioral proof for Phase 1's
 * truncation classifier (AG, 2026-08-09).
 *
 * Every assertion runs the real classifier over real (blockText, span)
 * inputs and checks the ORIGIN it returns. No source-text assertions.
 *
 * The classifier's job is to be trusted about a correctness question -- is
 * DocScrub damaging text -- so its false-positive behavior matters as much
 * as its detection. A classifier that called PeopleSoft's own abbreviations
 * "corruption" would send the next pass off inventing text that never
 * existed, which for a redaction tool is worse than the noise it set out to
 * remove. Half the checks below are therefore negative cases.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/truncation-diagnostics-verification.ts
 */

import {
  FALLBACK_MAX_TOKENS,
  classifyTruncation,
  probeFromContext,
  reportTruncations,
  type TruncationProbe,
} from "../src/engines/detectors/truncationDiagnostics.ts";
import { FALLBACK_PERSON_RE } from "../src/engines/detectors/patterns.ts";

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

/** Builds a probe by locating `fragment` inside `blockText`. */
function probe(blockText: string, fragment: string): TruncationProbe {
  const startOffset = blockText.indexOf(fragment);
  if (startOffset < 0) throw new Error(`fragment not in block: ${fragment}`);
  return { blockText, startOffset, endOffset: startOffset + fragment.length, text: fragment };
}

console.log("=== Truncation origin classifier ===\n");

console.log("--- SEVERED: the word continues in the same block (DocScrub cut it) ---");
{
  const cases: Array<[string, string, string]> = [
    ["Enrollment Appointments Assigned to students", "Enrollment Appointments Assigne", "d"],
    ["the Science Teacher Initiative runs in fall", "Science Teacher Initiativ", "e"],
    ["Virtual Clearinghouse Academy is next week", "Virtual Clearinghouse Academ", "y"],
    ["Student Final Exam schedule attached", "Student Final Exa", "m"],
    ["Fox, Liudmila will follow up", "Fox, Liud", "mila"],
    ["Priority Registration opens Monday", "Priority Registrati", "on"],
  ];
  for (const [block, fragment, expectedRemainder] of cases) {
    const f = classifyTruncation(probe(block, fragment));
    check(
      `"${fragment}" -> severed (continuation "${expectedRemainder}")`,
      f.origin === "severed" && f.continuation === expectedRemainder && f.isDefect,
      `got ${f.origin} / "${f.continuation}"`
    );
  }
}

console.log("\n--- TOKEN-CEILING: FALLBACK_PERSON_RE's 4-token bound (also ours) ---");
{
  /*
   * 2026-08-09, SAME DAY: the five-token case that motivated this classifier
   * is now FIXED (patterns.ts DEVIATION #5 raised `{1,3}` -> `{1,5}`), so the
   * regex no longer truncates it. Asserted in that direction -- the fix must
   * stay fixed.
   */
  const wasBroken = "Alternate Work Schedule Program Update";
  const nowWhole = [...wasBroken.matchAll(new RegExp(FALLBACK_PERSON_RE.source, FALLBACK_PERSON_RE.flags))].map((m) => m[0]);
  check(
    "the five-token phrase that motivated this classifier is no longer truncated",
    nowWhole.includes(wasBroken),
    JSON.stringify(nowWhole)
  );

  /*
   * The CLASSIFIER must still recognize the shape, because the bound moved
   * rather than disappearing -- a seven-token phrase is still cut, and a
   * document processed before the fix still contains four-token fragments.
   * A diagnostic that stopped detecting the class the moment one instance
   * was fixed would be useless for the next one.
   */
  const stillBounded = "The Office Of The Registrar And Enrollment Services Team";
  const produced = [...stillBounded.matchAll(new RegExp(FALLBACK_PERSON_RE.source, FALLBACK_PERSON_RE.flags))].map((m) => m[0]);
  check(
    "the regex still bounds a very long capitalized run (the ceiling moved, it did not vanish)",
    produced.length > 0 && !produced.includes(stillBounded),
    JSON.stringify(produced)
  );

  const f = classifyTruncation(probe(wasBroken, "Alternate Work Schedule Program"));
  check(
    "a maxed-out 4-token run followed by another capitalized token is token-ceiling",
    f.origin === "token-ceiling" && f.continuation === "Update" && f.isDefect,
    `${f.origin} / "${f.continuation}"`
  );

  const f2 = classifyTruncation(probe("Southern California Shredding Coming Soon", "Southern California Shredding Coming"));
  check("the second live example classifies the same way", f2.origin === "token-ceiling", f2.origin);

  // The classifier's token-count trigger is intentionally NOT retied to the
  // regex bound: it exists to recognize four-token fragments in documents
  // processed BEFORE the fix, which is exactly when a diagnostic is needed.
  check(`FALLBACK_MAX_TOKENS remains 4 -- the shape this classifier detects (${FALLBACK_MAX_TOKENS})`, FALLBACK_MAX_TOKENS === 4);
}

console.log("\n--- SOURCE-LITERAL: real abbreviations must NOT be called corruption ---");
{
  // PeopleSoft abbreviates in its own UI. These are legitimate content and
  // the classifier must leave them alone.
  const cases: Array<[string, string]> = [
    ["Navigate to Acad Struc and select the term", "Acad Struc"],
    ["The Appt Nbr field is blank", "Appt Nbr"],
    ["Run Comm Gen for the population", "Comm Gen"],
    ["Check the Div column", "Div"],
    ["Attach the Doc to the case", "Doc"],
    ["Term Withdrawl was misspelled in the report", "Term Withdrawl"],
  ];
  for (const [block, fragment] of cases) {
    const f = classifyTruncation(probe(block, fragment));
    check(`"${fragment}" -> source-literal (not a defect)`, f.origin === "source-literal" && !f.isDefect, f.origin);
  }
}

console.log("\n--- NEGATIVE CASES: the classifier must not cry wolf ---");
{
  // A complete phrase at the end of a block.
  const f1 = classifyTruncation(probe("Please review the Student Final Exam", "Student Final Exam"));
  check("a complete phrase at end-of-block is source-literal", f1.origin === "source-literal", f1.origin);

  // A complete phrase followed by punctuation.
  const f2 = classifyTruncation(probe("Term Withdrawal, effective Monday", "Term Withdrawal"));
  check("a phrase followed by punctuation is not severed", f2.origin === "source-literal", f2.origin);

  // Four tokens followed by a LOWERCASE word is an ordinary sentence, not
  // the regex ceiling.
  const f3 = classifyTruncation(probe("Alternate Work Schedule Program was approved", "Alternate Work Schedule Program"));
  check("four tokens followed by a lowercase word is NOT token-ceiling", f3.origin === "source-literal", f3.origin);

  // Fewer than four tokens followed by a capitalized word: ordinary prose.
  const f4 = classifyTruncation(probe("Grade Rosters Monday morning", "Grade Rosters"));
  check("a short phrase followed by a capitalized word is not token-ceiling", f4.origin === "source-literal", f4.origin);

  // A hyphenated word must not read as severed.
  const f5 = classifyTruncation(probe("Service-Now ticket opened", "Service-Now"));
  check("a hyphenated name is not severed", f5.origin === "source-literal", f5.origin);
}

console.log("\n--- REPORT SHAPE: the A/B/C answer must be derivable, not asserted ---");
{
  const probes: TruncationProbe[] = [
    probe("Enrollment Appointments Assigned to students", "Enrollment Appointments Assigne"),
    probe("Virtual Clearinghouse Academy is next week", "Virtual Clearinghouse Academ"),
    probe("Alternate Work Schedule Program Update", "Alternate Work Schedule Program"),
    probe("Navigate to Acad Struc and select the term", "Acad Struc"),
    probe("The Appt Nbr field is blank", "Appt Nbr"),
  ];
  const report = reportTruncations(probes);
  check("every probe is classified", report.total === 5);
  check("severed count is right", report.byOrigin.severed === 2, String(report.byOrigin.severed));
  check("token-ceiling count is right", report.byOrigin["token-ceiling"] === 1, String(report.byOrigin["token-ceiling"]));
  check("source-literal count is right", report.byOrigin["source-literal"] === 2, String(report.byOrigin["source-literal"]));
  check("defects and source-literals partition the findings", report.defects.length + report.sourceLiterals.length === report.total);
  check("a defect carries the evidence for its call", report.defects.every((d) => d.origin === "token-ceiling" || d.continuation.length > 0));

  // The whole point: this mixed set answers "C", and it answers it from the
  // data rather than from anyone's reading.
  const answer = report.defects.length === 0 ? "A" : report.sourceLiterals.length === 0 ? "B" : "C";
  check("a mixed document yields answer C", answer === "C", answer);

  const clean = reportTruncations([probe("Navigate to Acad Struc and select the term", "Acad Struc")]);
  check("an all-literal document yields answer A", clean.defects.length === 0);

  const damaged = reportTruncations([probe("Virtual Clearinghouse Academy is next week", "Virtual Clearinghouse Academ")]);
  check("an all-damaged document yields answer B", damaged.sourceLiterals.length === 0);
}


console.log("\n--- probeFromContext: the live-session adapter ---");
{
  // Exactly the shape DetectionEngine's contextSnippet emits.
  const ctx = "...ointments [Enrollment Appointments Assigne]d to students for fall...";
  const p = probeFromContext(ctx, "Enrollment Appointments Assigne");
  check("a bracketed snippet yields a probe", p !== null);
  if (p) {
    const f = classifyTruncation(p);
    check("the adapter preserves the severed signal through the snippet", f.origin === "severed" && f.continuation === "d", `${f.origin}/${f.continuation}`);
  }

  const ctx2 = "Run [Comm Gen] for the population";
  const p2 = probeFromContext(ctx2, "Comm Gen");
  check("a legitimate abbreviation survives the adapter as source-literal", p2 !== null && classifyTruncation(p2).origin === "source-literal");

  const ctx3 = "[Alternate Work Schedule Program] Update begins Monday";
  const p3 = probeFromContext(ctx3, "Alternate Work Schedule Program");
  check("token-ceiling survives the adapter", p3 !== null && classifyTruncation(p3).origin === "token-ceiling");

  check("a snippet with no bracketed span yields null rather than a guess", probeFromContext("no brackets here", "x") === null);

  // The leading/trailing "..." markers must not be mistaken for content.
  const p4 = probeFromContext("...abc [Grade Rosters] def...", "Grade Rosters");
  check("the ... window markers are stripped", p4 !== null && p4.blockText === "abc Grade Rosters def", p4?.blockText);
}

console.log(`\n=== ${passCount} passed, ${failCount} failed ===`);
if (failCount > 0) {
  for (const f of failed) console.log(`  - ${f}`);
  process.exitCode = 1;
}
