/**
 * nearby-title-scope-verification.ts -- oracle deviation #6, the
 * `nearby_title` scope correction (AG, 2026-08-09).
 *
 * Python's rule fired when a title appeared ANYWHERE in the 140-character
 * context window. That made it a claim about the window rather than about
 * the candidate, and on the live document it was the sole remaining reason
 * "The" was held as "recognized as a name" -- with `Last`, `Thank`,
 * `Grades` and `Morning` in the same population.
 *
 * The clearest single statement of the defect, and the case this suite
 * exists to keep fixed:
 *
 *     "[Andrew] met with Dr. Garcia"
 *
 * fired `nearby_title` for ANDREW, on GARCIA's honorific.
 *
 * Every assertion runs the real quality engine over real occurrences and
 * inspects `positiveReasons`. No source-text assertions.
 *
 * BOTH DIRECTIONS MATTER. Narrowing an evidence rule risks losing genuine
 * signal, and `nearby_title` is one of the stronger person signals the
 * pipeline has -- so the honorific-before-name cases and the attached case
 * carry as much weight here as the suppressions.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/nearby-title-scope-verification.ts
 */

import { scoreCandidateQuality } from "../src/engines/quality/scoring.ts";
import type { Candidate, ContentBlock, Occurrence } from "../src/domain/DocumentModel.ts";

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

/**
 * Does this candidate carry `nearby_title`, given one occurrence whose
 * context is `context`?
 *
 * `context` uses the pipeline's own bracket convention: the candidate's span
 * is wrapped in [ ], exactly as `contextSnippet` emits it.
 */
function hasNearbyTitle(displayValue: string, context: string): boolean {
  const candidate = {
    id: `person:${displayValue.toLowerCase()}`,
    displayValue,
    detectedType: "person",
    occurrenceIds: ["occ-1"],
  } as Candidate;
  const occurrence = {
    id: "occ-1",
    candidateId: candidate.id,
    blockId: "block-1",
    startOffset: 0,
    endOffset: displayValue.length,
    text: displayValue,
    context,
    source: "fallback-single-name-regex",
  } as Occurrence;
  const scored = scoreCandidateQuality(candidate, [occurrence], new Map<string, ContentBlock>());
  return scored.positiveReasons.includes("nearby_title");
}

console.log("=== nearby_title scope (oracle deviation #6) ===\n");

console.log("--- MUST STILL FIRE: honorific immediately before the name ---");
{
  const cases: Array<[string, string]> = [
    ["Garcia", "Dr. [Garcia] will review it"],
    ["Reyes", "Please ask Prof. [Reyes] about the roster"],
    ["Chen", "Ms. [Chen] needs the enrollment list"],
    ["Martinez", "cc: Dean [Martinez] on the reply"],
    ["Okafor", "Mrs. [Okafor] approved the change"],
    ["Lam", "spoke with Judge [Lam] yesterday"],
  ];
  for (const [name, context] of cases) {
    check(`"${context}" -> nearby_title`, hasNearbyTitle(name, context), "lost a legitimate title signal");
  }
}

console.log("\n--- MUST STILL FIRE: the honorific is ATTACHED to the candidate ---");
{
  /*
   * Previously carried by the whole-context branch. Deleting that branch
   * without this replacement would have narrowed a bad rule by also losing
   * a good signal -- which is the failure mode of every over-eager
   * precision fix.
   */
  for (const value of ["Dr. Garcia", "Prof. Reyes", "Ms. Chen"]) {
    check(`candidate "${value}" carries its own title`, hasNearbyTitle(value, `contact [${value}] today`), "attached-title case lost");
  }
}

console.log("\n--- MUST NOT FIRE: another person's title later in the window ---");
{
  const cases: Array<[string, string]> = [
    ["Andrew", "[Andrew] met with Dr. Garcia"],
    ["Tamara", "[Tamara] forwarded the roster to Prof. Reyes"],
    ["Nelly", "[Nelly] will cover while Dean Martinez is away"],
  ];
  for (const [name, context] of cases) {
    check(`"${context}" -> NO nearby_title (title belongs to someone else)`, !hasNearbyTitle(name, context), "still inheriting another person's honorific");
  }
}

console.log("\n--- MUST NOT FIRE: title AFTER the candidate ---");
{
  for (const [name, context] of [
    ["Grades", "[Grades] are due Friday, per Dean Martinez"],
    ["Morning", "[Morning] everyone -- Dr. Lopez is out today"],
  ] as Array<[string, string]>) {
    check(`"${context}" -> NO nearby_title`, !hasNearbyTitle(name, context));
  }
}

console.log("\n--- MUST NOT FIRE: title across a sentence boundary ---");
{
  for (const [name, context] of [
    ["The", "[The] Reg audit report came in.  Dr. Garcia will be sending that out soon"],
    ["Thank", "[Thank] you. Prof. Reyes confirmed the dates"],
    ["Last", "[Last] call: Ms. Chen needs the roster"],
  ] as Array<[string, string]>) {
    check(`"${context.slice(0, 46)}…" -> NO nearby_title`, !hasNearbyTitle(name, context));
  }
}

console.log("\n--- MUST NOT FIRE: ordinary lexical candidates near titled people ---");
{
  /*
   * The population Andrew flagged: ordinary words held as "recognized as a
   * name" purely because the surrounding correspondence mentions somebody
   * with a title. In email threads that is almost every window.
   */
  for (const [word, context] of [
    ["Thanks", "[Thanks] -- Dr. Garcia has the file"],
    ["Please", "[Please] send it to Prof. Reyes"],
    ["Records", "[Records] were updated by Dean Martinez"],
    ["Enrollment", "[Enrollment] closes Friday; Ms. Chen has details"],
  ] as Array<[string, string]>) {
    check(`"${word}" near a titled person -> NO nearby_title`, !hasNearbyTitle(word, context));
  }
}

console.log("\n--- BOUNDARY: the honorific must actually precede, not merely appear before ---");
{
  // A title earlier in the SAME text but not adjacent must not fire either:
  // NEAR_TITLE_BEFORE_RE is anchored to the end of `before`.
  check(
    "'Dr. Garcia asked [Tamara] to review' -> NO nearby_title for Tamara",
    !hasNearbyTitle("Tamara", "Dr. Garcia asked [Tamara] to review")
  );
  check(
    "but 'Dr. [Tamara]' still fires",
    hasNearbyTitle("Tamara", "Dr. [Tamara] will review")
  );
}

console.log(`\n=== ${passCount} passed, ${failCount} failed ===`);
if (failCount > 0) {
  for (const f of failed) console.log(`  - ${f}`);
  process.exitCode = 1;
}
