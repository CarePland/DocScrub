/**
 * full-name-token-witness-verification.ts -- REPRODUCTION of the structural
 * reason ordinary words acquire document-derived name evidence
 * (AG, 2026-08-09).
 *
 * ============================== THE FINDING ==============================
 * Of the 76 live candidates retained as "recognized as a name despite
 * overlapping ordinary vocabulary", 62 are document-derived rather than
 * lexicon-derived, and the population includes `The`, `Thank`, `Grades`,
 * `Morning`, `Last`.
 *
 * The structural cause is one inherited assumption:
 *
 *     buildFullNameTokenIndex() accepts as a NAME WITNESS any multi-token
 *     candidate whose detectedType is "person".
 *
 * But `detectedType: "person"` is a REGEX ARTIFACT, not evidence.
 * FALLBACK_PERSON_RE matches any run of 2-6 capitalized words, so
 * "Good Morning", "Thank You", "Last Call", "Message List", "Winter Grading"
 * and "Preview Day" are all person-typed candidates. Each then witnesses its
 * own tokens, and `Morning`, `Thank`, `Last`, `Message`, `Winter`, `Preview`
 * acquire name evidence.
 *
 * LAST_FIRST_PERSON_RE has the same property with a comma:
 * "Tuesday, March" is person-typed and witnesses both `Tuesday` and `March`.
 * ========================================================================
 *
 * WHY THE EXISTING WITNESS FILTER DOES NOT CATCH THIS. The institutional
 * filter was added because "Enrollment Services Team" witnessed
 * "Enrollment". It works -- for phrases carrying institutional categories.
 * It cannot see a GREETING ("Good Morning" -> greeting_or_courtesy), a
 * CALENDAR phrase ("Tuesday, March" -> calendar_term), or a phrase carrying
 * no category at all. The filter enumerates one way of not being a name
 * rather than requiring some way of being one.
 *
 * ---------------------------------------------------------------------
 * WHAT THIS SUITE IS AND IS NOT
 * ---------------------------------------------------------------------
 *
 * It is a REPRODUCTION written BEFORE any change, per Andrew's instruction
 * that the next production change be chosen from measured evidence. The
 * `CURRENT` assertions describe today's behaviour and are expected to flip
 * when a fix lands; each says so.
 *
 * The POSITIVE CONTROLS are the load-bearing half. The whole reason
 * documentNameEvidence.ts exists is that `Agnes` and `Kyle` were being
 * auto-resolved, so any narrowing of the witness rule that loses them would
 * be a worse defect than the one it fixes.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/full-name-token-witness-verification.ts
 */

import { scoreCandidateQuality } from "../src/engines/quality/scoring.ts";
import {
  buildFullNameTokenIndex,
  documentNameEvidenceFor,
  INSTITUTIONAL_WITNESS_CATEGORIES,
} from "../src/engines/review/documentNameEvidence.ts";
import { FALLBACK_PERSON_RE, LAST_FIRST_PERSON_RE } from "../src/engines/detectors/patterns.ts";
import { ORDINARY_LANGUAGE_CATEGORIES } from "../src/engines/review/residualReviewGate.ts";
import type { Candidate } from "../src/domain/DocumentModel.ts";

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

function candidate(text: string): Candidate {
  return { id: `person:${text.toLowerCase()}`, displayValue: text, detectedType: "person", occurrenceIds: [] } as Candidate;
}

function categoriesFor(text: string): string[] {
  const s = scoreCandidateQuality(candidate(text), [], new Map());
  return (s.filterRules.length ? s.filterRules : s.reasons).map((c) => c.replace(/_/g, "-"));
}

/** The live document's shape, in miniature: ordinary capitalized phrases
 *  alongside genuine names, exactly as the detector produces them. */
const PHRASES = [
  "Good Morning",
  "Thank You",
  "Last Call",
  "Message List",
  "Winter Grading",
  "Preview Day",
  "Tuesday, March",
  "Records Team",
  "Enrollment Services Team",
  "Agnes Wu",
  "Cobb, Christopher",
];
const SINGLES = ["Morning", "Thank", "Last", "Message", "Winter", "Preview", "Tuesday", "March", "Records", "Enrollment", "Agnes", "Christopher"];

const ALL = [...PHRASES, ...SINGLES].map(candidate);
const catsById = new Map(ALL.map((c) => [c.id, categoriesFor(c.displayValue)]));
/*
 * THE PRE-FIX INDEX, built deliberately (AG, 2026-08-09, updated same day).
 *
 * Change A1 has since landed, so this suite is now a HISTORICAL
 * REPRODUCTION: it configures the index the way it was configured when the
 * defect was found -- institutional filter only -- so the demonstration and
 * the discriminator analysis below remain executable. The final block
 * asserts that the PRODUCTION configuration no longer behaves this way.
 *
 * Kept rather than deleted because the discriminator analysis is not
 * reproduced anywhere else: it is the record of which fix was tried, which
 * was falsified, and what the remaining limit is.
 */
const index = buildFullNameTokenIndex(ALL, {
  isInstitutionalPhrase: (id) => (catsById.get(id) ?? []).some((c) => INSTITUTIONAL_WITNESS_CATEGORIES.includes(c)),
});
const evidenceFor = (text: string): { has: boolean; sources: string[]; witness?: string } =>
  documentNameEvidenceFor(candidate(text), { ambiguityProposalCandidateIds: new Set(), entityGroupMemberIds: new Set() }, index);

console.log("=== full-name-token witness scope ===\n");

console.log("--- THE PREMISE: the detector types ordinary phrases as `person` ---");
{
  /*
   * Asserted against the real patterns rather than claimed, because the
   * whole argument rests on it: if these phrases were NOT person-typed the
   * witness index would never see them.
   */
  for (const phrase of ["Good Morning", "Thank You", "Last Call", "Winter Grading", "Preview Day"]) {
    const re = new RegExp(FALLBACK_PERSON_RE.source, "u");
    check(`FALLBACK_PERSON_RE matches "${phrase}" -- typed person by shape alone`, re.test(phrase));
  }
  const lastFirst = new RegExp(LAST_FIRST_PERSON_RE.source, "u");
  check(`LAST_FIRST_PERSON_RE matches "Tuesday, March"`, lastFirst.test("Tuesday, March"));
  check(`LAST_FIRST_PERSON_RE matches "Cobb, Christopher" (the true positive it exists for)`, lastFirst.test("Cobb, Christopher"));
}

console.log("\n--- THE DEFECT: ordinary phrases become name witnesses ---");
{
  const cases: Array<[string, string]> = [
    ["Morning", "Good Morning"],
    ["Thank", "Thank You"],
    ["Last", "Last Call"],
    ["Message", "Message List"],
    ["Winter", "Winter Grading"],
    ["Preview", "Preview Day"],
    ["Tuesday", "Tuesday, March"],
    ["March", "Tuesday, March"],
  ];
  for (const [token, expectedWitness] of cases) {
    const ev = evidenceFor(token);
    check(
      `CURRENT: "${token}" carries name evidence, witnessed by "${expectedWitness}"`,
      ev.has && ev.sources.includes("full-name-token") && ev.witness === expectedWitness,
      `${JSON.stringify(ev)} -- if this now fails, a witness narrowing has landed and this assertion should be inverted`
    );
  }
}

console.log("\n--- WHY THE INSTITUTIONAL FILTER MISSES THEM ---");
{
  /*
   * The filter is not broken; it is answering a narrower question than the
   * one that matters. Shown as data, then pinned as one structural claim.
   */
  console.log("      phrase                     institutional?  categories");
  for (const phrase of ["Records Team", "Enrollment Services Team", "Good Morning", "Tuesday, March", "Message List", "Agnes Wu"]) {
    const c = categoriesFor(phrase);
    const inst = c.some((x) => INSTITUTIONAL_WITNESS_CATEGORIES.includes(x));
    console.log(`      ${phrase.padEnd(26)} ${String(inst).padEnd(15)} ${JSON.stringify(c)}`);
  }
  check(
    "the institutional filter DOES exclude 'Records Team'",
    !index.has("records"),
    "records is in the witness index -- the institutional filter regressed"
  );
  check(
    "but it does NOT exclude 'Good Morning' (a greeting carries no institutional category)",
    index.get("morning") === "Good Morning",
    "morning is no longer witnessed -- a narrowing has landed"
  );
  check(
    "nor 'Tuesday, March' (a calendar phrase carries no institutional category)",
    index.get("tuesday") === "Tuesday, March",
    "tuesday is no longer witnessed -- a narrowing has landed"
  );
}

console.log("\n--- POSITIVE CONTROLS: the cases the module exists for ---");
{
  /*
   * These are the reason document-derived evidence was added at all. Any
   * witness narrowing MUST keep them. They are asserted independently of
   * the mechanism so the eventual fix cannot quietly trade them away.
   */
  const agnes = evidenceFor("Agnes");
  check("'Agnes' still carries name evidence, witnessed by 'Agnes Wu'", agnes.has && agnes.witness === "Agnes Wu", JSON.stringify(agnes));
  const chris = evidenceFor("Christopher");
  check("'Christopher' still carries name evidence via 'Cobb, Christopher'", chris.has, JSON.stringify(chris));
  check("'Enrollment' is NOT witnessed (the institutional control that produced the filter)", !evidenceFor("Enrollment").has, JSON.stringify(evidenceFor("Enrollment")));
}

console.log("\n--- THE DISCRIMINATOR A FIX WOULD NEED ---");
{
  /*
   * Printed rather than asserted: this is the evidence for choosing the
   * narrowing condition, and the choice is Andrew's, not this suite's.
   *
   * The question is whether a witness can be required to look like a NAME
   * rather than merely not look institutional.
   */
  console.log("      phrase                     categories");
  for (const phrase of PHRASES) {
    console.log(`      ${phrase.padEnd(26)} ${JSON.stringify(categoriesFor(phrase))}`);
  }
  const genuine = ["Agnes Wu", "Cobb, Christopher"];
  const ordinary = ["Good Morning", "Thank You", "Last Call", "Message List", "Preview Day", "Winter Grading", "Tuesday, March"];

  /*
   * CANDIDATE DISCRIMINATOR 1: "require the witness to carry a positive
   * name-structure category."
   *
   * FALSIFIED HERE, by this suite's own control. Written down because the
   * failure is the useful result: it is the obvious fix and it does not
   * work.
   */
  const nameStructure = (p: string): boolean => {
    const c = categoriesFor(p);
    return ["strong-name-structure", "surname-given-structure", "known-first-name", "known-personal-name-token", "known-name-structure", "moderate-frequency-bonus"].some((x) => c.includes(x));
  };
  check(
    "every genuine name phrase carries a positive name-structure category",
    genuine.every(nameStructure),
    JSON.stringify(genuine.map((p) => [p, categoriesFor(p)]))
  );
  const survivors = ordinary.filter(nameStructure);
  check(
    `DISCRIMINATOR 1 IS INSUFFICIENT: ${survivors.length} ordinary phrases carry the SAME categories as "Agnes Wu"`,
    survivors.length > 0,
    "discriminator 1 now separates them -- the category vocabulary changed; re-derive this analysis"
  );
  check(
    "specifically, 'Last Call' and 'Agnes Wu' are category-identical",
    JSON.stringify(categoriesFor("Last Call")) === JSON.stringify(categoriesFor("Agnes Wu")),
    `${JSON.stringify(categoriesFor("Last Call"))} vs ${JSON.stringify(categoriesFor("Agnes Wu"))}`
  );

  /*
   * CANDIDATE DISCRIMINATOR 2: "exclude a witness carrying positive
   * ORDINARY-LANGUAGE evidence" -- the exact mirror of the gate's own rule 4,
   * reusing ORDINARY_LANGUAGE_CATEGORIES rather than inventing a list.
   *
   * Partial, and the partiality is measured rather than glossed.
   */
  const ordinaryWitness = (p: string): boolean => categoriesFor(p).some((c) => ORDINARY_LANGUAGE_CATEGORIES.includes(c));
  const caught = ordinary.filter(ordinaryWitness);
  const missed = ordinary.filter((p) => !ordinaryWitness(p));
  console.log(`      discriminator 2 catches: ${caught.join(", ")}`);
  console.log(`      discriminator 2 misses:  ${missed.join(", ")}`);
  check(
    "DISCRIMINATOR 2 catches the greeting and calendar witnesses",
    ["Good Morning", "Thank You", "Tuesday, March"].every(ordinaryWitness),
    JSON.stringify(["Good Morning", "Thank You", "Tuesday, March"].map((p) => [p, categoriesFor(p)]))
  );
  check(
    "DISCRIMINATOR 2 preserves both genuine names",
    genuine.every((p) => !ordinaryWitness(p)),
    JSON.stringify(genuine.map((p) => [p, categoriesFor(p)]))
  );
  check(
    "DISCRIMINATOR 2 is PARTIAL: name-shaped ordinary phrases still witness",
    missed.length > 0,
    "nothing missed -- the category vocabulary changed; re-derive this analysis"
  );
}

console.log("\n--- AND NOW: the PRODUCTION configuration, with A1 applied ---");
{
  /*
   * The same document, indexed the way residualReviewGate.ts indexes it.
   * This is what closes the loop: everything above describes a defect, and
   * this block asserts the shipped configuration no longer has it.
   */
  const productionIndex = buildFullNameTokenIndex(ALL, {
    isInstitutionalPhrase: (id) => (catsById.get(id) ?? []).some((c) => INSTITUTIONAL_WITNESS_CATEGORIES.includes(c)),
    carriesOrdinaryLanguageEvidence: (id) => (catsById.get(id) ?? []).some((c) => ORDINARY_LANGUAGE_CATEGORIES.includes(c)),
  });
  const nowFor = (text: string): { has: boolean; witness?: string } =>
    documentNameEvidenceFor(candidate(text), { ambiguityProposalCandidateIds: new Set(), entityGroupMemberIds: new Set() }, productionIndex);

  for (const token of ["Morning", "Thank", "Tuesday", "March"]) {
    check(`FIXED: "${token}" no longer carries document name evidence`, !nowFor(token).has, JSON.stringify(nowFor(token)));
  }
  check("PRESERVED: 'Agnes' still does", nowFor("Agnes").witness === "Agnes Wu", JSON.stringify(nowFor("Agnes")));
  check("PRESERVED: 'Enrollment' still does not", !nowFor("Enrollment").has, JSON.stringify(nowFor("Enrollment")));
  check(
    "STILL OPEN: 'Last' remains witnessed by 'Last Call' (the category-identical limit above)",
    nowFor("Last").witness === "Last Call",
    JSON.stringify(nowFor("Last"))
  );
}

console.log(`\n=== ${passCount} passed, ${failCount} failed ===`);
if (failCount > 0) {
  for (const f of failed) console.log(`  - ${f}`);
  process.exitCode = 1;
}
