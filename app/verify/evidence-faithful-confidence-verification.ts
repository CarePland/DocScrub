/**
 * evidence-faithful-confidence-verification.ts -- oracle deviation #7:
 * shape confidence is not semantic confidence (AG, 2026-08-09).
 *
 * ============================== THE DEFECT ==============================
 * `confidenceOpener(likelihood, entityType)` takes its NOUN from the
 * detector and only its ADVERB from the score. The score measures
 * name-LIKENESS -- capitalization structure plus frequency -- so on a
 * shape-only candidate the sentence attached a confident adverb to a claim
 * nothing had assessed:
 *
 *     Amy Miller     79  ["strong_name_structure"]  -> "Likely a person's name."
 *     Grade Rosters  79  ["strong_name_structure"]  -> "Likely a person's name."
 *     Degree Planner 99  ["strong_name_structure"]  -> "Almost certainly a person's name."
 *
 * A real person and an interface label received the IDENTICAL sentence,
 * because the evidence behind them is identical.
 * ========================================================================
 *
 * WHAT THIS SUITE PROTECTS, in both directions:
 *
 *   - a shape-only person claim no longer asserts personhood;
 *   - a candidate with REAL name evidence keeps the ported wording exactly;
 *   - non-person entity types are untouched;
 *   - the SCORE and the BANDS are untouched -- this changes text, never a
 *     number, never a route, never a decision.
 *
 * The second bullet is the load-bearing one. The risk of a truthfulness fix
 * is under-claiming on genuine evidence, which would make the panel useless
 * in the opposite direction.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/evidence-faithful-confidence-verification.ts
 */

import {
  confidenceOpener,
  evidenceFaithfulOpener,
  isShapeOnlyPersonClaim,
  buildStandardSummary,
  SHAPE_OR_FREQUENCY_REASONS,
  NO_NAME_EVIDENCE_CLAUSE,
} from "../src/engines/explanation/explanation-builder.ts";
import { scoreCandidateQuality } from "../src/engines/quality/scoring.ts";
import type { Candidate } from "../src/domain/DocumentModel.ts";
import type { Evidence, ExplanationContext } from "../src/domain/Evidence.ts";

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

/** REAL positive reasons, from the real scoring engine -- not hand-written.
 *  A fixture that supplied its own reasons would be restating the
 *  implementation's condition back to it. */
function positiveReasonsFor(text: string): string[] {
  const candidate = { id: `person:${text}`, displayValue: text, detectedType: "person", occurrenceIds: [] } as unknown as Candidate;
  return [...scoreCandidateQuality(candidate, [], new Map()).positiveReasons];
}
function scoreFor(text: string): number {
  const candidate = { id: `person:${text}`, displayValue: text, detectedType: "person", occurrenceIds: [] } as unknown as Candidate;
  return scoreCandidateQuality(candidate, [], new Map()).score;
}

console.log("=== Evidence-faithful confidence language (oracle deviation #7) ===\n");

console.log("--- THE LIVE CASES: shape-only candidates no longer assert personhood ---");
{
  for (const text of ["Grade Rosters", "Degree Planner", "Reason Code", "Academic Senate", "Term Withdra", "Amy Miller"]) {
    const reasons = positiveReasonsFor(text);
    const score = scoreFor(text);
    const before = confidenceOpener(score, "person");
    const after = evidenceFaithfulOpener(score, "person", reasons);
    check(
      `"${text}" (${score}, ${JSON.stringify(reasons)}) no longer claims a person`,
      !after.includes("person's name") && after !== before,
      `${before} -> ${after}`
    );
  }
}

console.log("\n--- THE POINT OF THE FIX, stated as one assertion ---");
{
  /*
   * Amy Miller is a real person; Grade Rosters is a table column. The old
   * copy could not tell them apart -- and neither can the new copy. The
   * difference is that the new copy no longer PRETENDS to.
   */
  const amy = evidenceFaithfulOpener(scoreFor("Amy Miller"), "person", positiveReasonsFor("Amy Miller"));
  const rosters = evidenceFaithfulOpener(scoreFor("Grade Rosters"), "person", positiveReasonsFor("Grade Rosters"));
  check("Amy Miller and Grade Rosters still read identically -- the evidence IS identical", amy === rosters, `${amy} / ${rosters}`);
  check("  but neither asserts personhood any more", !amy.includes("person"), amy);
}

console.log("\n--- REAL NAME EVIDENCE KEEPS THE PORTED WORDING EXACTLY ---");
{
  /*
   * The load-bearing half. Any candidate carrying evidence that genuinely
   * speaks to personhood must be worded exactly as Python words it.
   */
  for (const text of ["Giancarlo Banuelos", "Tamara Yamada", "Nelly Perias", "Andrew Fox", "Diana", "Sarah"]) {
    const reasons = positiveReasonsFor(text);
    const score = scoreFor(text);
    check(
      `"${text}" ${JSON.stringify(reasons)} keeps "${confidenceOpener(score, "person")}"`,
      evidenceFaithfulOpener(score, "person", reasons) === confidenceOpener(score, "person"),
      `${evidenceFaithfulOpener(score, "person", reasons)}`
    );
  }
}

console.log("\n--- NON-PERSON ENTITY TYPES ARE UNTOUCHED ---");
{
  for (const [type, score] of [["email", 99], ["phone", 60], ["cin", 30]] as Array<[string, number]>) {
    check(
      `${type} @${score} unchanged`,
      evidenceFaithfulOpener(score, type, ["strong_name_structure"]) === confidenceOpener(score, type),
      evidenceFaithfulOpener(score, type, ["strong_name_structure"])
    );
  }
}

console.log("\n--- THE PREDICATE'S BOUNDARIES ---");
{
  check("no positive evidence at all is NOT 'shape only' (a different case, left alone)", !isShapeOnlyPersonClaim("person", []));
  check("shape + a real name token is NOT shape-only", !isShapeOnlyPersonClaim("person", ["strong_name_structure", "known_personal_name_token"]));
  check("shape + a title is NOT shape-only", !isShapeOnlyPersonClaim("person", ["strong_name_structure", "nearby_title"]));
  check("shape + email evidence is NOT shape-only", !isShapeOnlyPersonClaim("person", ["strong_name_structure", "email_address_evidence"]));
  check("shape + frequency IS shape-only", isShapeOnlyPersonClaim("person", ["strong_name_structure", "moderate_frequency_bonus"]));
  check("frequency_saturated + shape IS shape-only (AG's quoted case)", isShapeOnlyPersonClaim("person", ["frequency_saturated", "strong_name_structure"]));
  check("surname_given_structure ALONE is shape-only", isShapeOnlyPersonClaim("person", ["surname_given_structure"]));
  check("kebab-cased categories are recognized too", isShapeOnlyPersonClaim("person", ["strong-name-structure"]));

  /* Every entry must be genuinely shape/frequency. A name-evidence rule
   * slipping into this list would silently mute a real person claim. */
  const leaked = SHAPE_OR_FREQUENCY_REASONS.filter((r) => r.includes("known") || r.includes("title") || r.includes("email") || r.includes("contextual") || r.includes("signature"));
  check(`the shape list (${SHAPE_OR_FREQUENCY_REASONS.length} entries) contains no personhood evidence`, leaked.length === 0, JSON.stringify(leaked));
}

console.log("\n--- THE FULL SENTENCE, through buildStandardSummary ---");
{
  const context = (evidence: Evidence[], likelihood: number): ExplanationContext => ({
    candidateId: "c1",
    entityType: "person",
    likelihood,
    recommendation: "ToReview",
    disposition: "To Review",
    occurrenceCount: 4,
    evidence,
    diagnosticCategories: [],
    rawScoringExplanation: "",
  });
  const shapeEvidence: Evidence[] = [
    { id: "e1", kind: "positive", category: "strong-name-structure", weight: 30, source: "quality", description: "Strong name structure" } as unknown as Evidence,
  ];
  const nameEvidence: Evidence[] = [
    { id: "e1", kind: "positive", category: "strong-name-structure", weight: 30, source: "quality", description: "Strong name structure" } as unknown as Evidence,
    { id: "e2", kind: "positive", category: "known-personal-name-token", weight: 20, source: "quality", description: "Known personal-name token" } as unknown as Evidence,
  ];
  const shapeSummary = buildStandardSummary(context(shapeEvidence, 79));
  const nameSummary = buildStandardSummary(context(nameEvidence, 99));
  console.log(`      shape-only: ${shapeSummary}`);
  console.log(`      real name : ${nameSummary}`);
  check("the shape-only summary does not assert a person", !shapeSummary.includes("person's name"), shapeSummary);
  check("the shape-only summary states the absence explicitly", shapeSummary.includes(NO_NAME_EVIDENCE_CLAUSE), shapeSummary);
  check("the real-name summary still asserts a person", nameSummary.includes("a person's name"), nameSummary);
  check("the real-name summary does NOT carry the absence clause", !nameSummary.includes(NO_NAME_EVIDENCE_CLAUSE), nameSummary);
  check("the `<opener> because <evidence>` grammar is preserved", shapeSummary.includes(" because "), shapeSummary);
}

console.log("\n--- NOTHING NUMERIC MOVED ---");
{
  /*
   * The scope guarantee. This change touches displayed text only: the
   * ported `confidenceOpener` still exists, still behaves identically, and
   * the parity suite that pins it is untouched.
   */
  check("the ported confidenceOpener still returns Python's string", confidenceOpener(95, "person") === "Almost certainly a person's name");
  check("scores are unchanged: Grade Rosters is still 79", scoreFor("Grade Rosters") === 79, String(scoreFor("Grade Rosters")));
  check("scores are unchanged: Giancarlo Banuelos is still 99", scoreFor("Giancarlo Banuelos") === 99, String(scoreFor("Giancarlo Banuelos")));
}

console.log(`\n=== ${passCount} passed, ${failCount} failed ===`);
if (failCount > 0) {
  for (const f of failed) console.log(`  - ${f}`);
  process.exitCode = 1;
}
