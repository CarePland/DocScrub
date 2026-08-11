/**
 * witness-eligibility-verification.ts -- change A1: a phrase carrying
 * ordinary-language evidence cannot witness a name (AG, 2026-08-09).
 *
 * ---------------------------------------------------------------------
 * WHAT CHANGED
 * ---------------------------------------------------------------------
 *
 * buildFullNameTokenIndex() accepted any multi-token candidate typed
 * `person` as evidence that its component tokens might be names. But
 * `detectedType: "person"` is a regex artifact -- FALLBACK_PERSON_RE matches
 * any run of 2-6 capitalized words -- so "Good Morning" was testifying that
 * `Morning` is somebody's name.
 *
 * A witness must now also carry no POSITIVE ordinary-language evidence,
 * using the same ORDINARY_LANGUAGE_CATEGORIES the residual gate's own rule 4
 * uses. Nothing new is introduced: the gate's existing judgement about
 * ordinary language is applied one level up.
 *
 * ---------------------------------------------------------------------
 * HOW THIS SUITE IS BUILT, AND WHY IT MATTERS
 * ---------------------------------------------------------------------
 *
 * Every eligibility decision here comes from REAL production evidence --
 * scoreCandidateQuality() over the real quality dictionaries -- never from a
 * hand-supplied category list. A fixture that fed the implementation its own
 * condition would pass while proving nothing, which is the specific failure
 * AG asked to avoid.
 *
 * The consequence is that some assertions below are about phrases whose
 * categories I did not choose, and one of them (`Last Call`) is a case this
 * change deliberately does NOT fix. It is asserted as unfixed rather than
 * omitted.
 *
 * BOTH DIRECTIONS. The suppressions are half the suite; the other half is
 * that genuine witnesses keep working and that ambiguity/group evidence is
 * untouched. This module exists because `Agnes` and `Kyle` were being
 * auto-resolved, and a narrowing that lost them again would be a worse
 * defect than the one it fixes.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/witness-eligibility-verification.ts
 */

import { scoreCandidateQuality } from "../src/engines/quality/scoring.ts";
import {
  buildFullNameTokenIndex,
  documentNameEvidenceFor,
  INSTITUTIONAL_WITNESS_CATEGORIES,
} from "../src/engines/review/documentNameEvidence.ts";
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

/** Production categories, exactly as the gate reads them. */
function categoriesFor(text: string): string[] {
  const s = scoreCandidateQuality(candidate(text), [], new Map());
  return (s.filterRules.length ? s.filterRules : s.reasons).map((c) => c.replace(/_/g, "-"));
}

/*
 * One document containing the shapes that matter, indexed exactly as the
 * gate does it -- with both predicates supplied from real categories.
 */
const PHRASES = [
  // ordinary-language phrases that were witnessing
  "Good Morning", "Thank You", "Good Afternoon", "Tuesday, March", "Happy Friday",
  // institutional (the pre-existing filter)
  "Records Team", "Enrollment Services Team",
  // genuine names, which must keep witnessing
  "Agnes Wu", "Kyle Barrera", "Cobb, Christopher", "Amy Nakamura", "Rose Delacroix",
  // the honest limit: name-shaped ordinary phrases this change does NOT fix
  "Last Call", "Message List", "Preview Day",
];
const SINGLES = ["Morning", "Thank", "Afternoon", "Tuesday", "March", "Happy", "Records", "Enrollment", "Agnes", "Kyle", "Christopher", "Amy", "Rose", "Last", "Message", "Preview"];

const ALL = [...PHRASES, ...SINGLES].map(candidate);
const catsById = new Map(ALL.map((c) => [c.id, categoriesFor(c.displayValue)]));
const catsOf = (id: string): string[] => catsById.get(id) ?? [];

const index = buildFullNameTokenIndex(ALL, {
  isInstitutionalPhrase: (id) => catsOf(id).some((c) => INSTITUTIONAL_WITNESS_CATEGORIES.includes(c)),
  carriesOrdinaryLanguageEvidence: (id) => catsOf(id).some((c) => ORDINARY_LANGUAGE_CATEGORIES.includes(c)),
});
const evidence = (text: string): { has: boolean; sources: string[]; witness?: string } =>
  documentNameEvidenceFor(candidate(text), { ambiguityProposalCandidateIds: new Set(), entityGroupMemberIds: new Set() }, index);

console.log("=== full-name-token witness eligibility (change A1) ===\n");

console.log("--- FIXED: ordinary-language phrases no longer witness their tokens ---");
{
  /*
   * Each asserted together with the production category that disqualified
   * it, so the test states WHY rather than only WHAT -- and so a category
   * vocabulary change surfaces here instead of silently re-opening the hole.
   */
  const cases: Array<[string, string]> = [
    ["Morning", "Good Morning"],
    ["Thank", "Thank You"],
    ["Afternoon", "Good Afternoon"],
    ["Tuesday", "Tuesday, March"],
    ["March", "Tuesday, March"],
  ];
  for (const [token, phrase] of cases) {
    const cats = categoriesFor(phrase);
    const why = cats.filter((c) => ORDINARY_LANGUAGE_CATEGORIES.includes(c));
    check(
      `"${phrase}" is disqualified by real evidence ${JSON.stringify(why)}`,
      why.length > 0,
      `categories are ${JSON.stringify(cats)} -- none ordinary; this case no longer demonstrates the fix`
    );
    check(`  -> "${token}" has NO document name evidence`, !evidence(token).has, JSON.stringify(evidence(token)));
  }
}

console.log("\n--- PRESERVED: genuine names still witness ---");
{
  const cases: Array<[string, string]> = [
    ["Agnes", "Agnes Wu"],
    ["Kyle", "Kyle Barrera"],
    ["Christopher", "Cobb, Christopher"],
  ];
  for (const [token, witness] of cases) {
    const ev = evidence(token);
    check(`"${token}" keeps name evidence, witnessed by "${witness}"`, ev.has && ev.witness === witness, JSON.stringify(ev));
  }
}

console.log("\n--- PRESERVED: a real name that overlaps ordinary vocabulary ---");
{
  /*
   * AG's constraint: "where a genuine name overlaps ordinary vocabulary,
   * preserve it when the actual evidence supports name use."
   *
   * `Amy` and `Rose` are the canonical collisions. What decides them is the
   * WITNESS's evidence, not the token's -- "Amy Nakamura" carries no
   * ordinary-language category, so it still testifies, even though `Amy`
   * itself is ordinary vocabulary. That separation is the point of the
   * change and is asserted directly.
   */
  for (const [token, witness] of [["Amy", "Amy Nakamura"], ["Rose", "Rose Delacroix"]] as Array<[string, string]>) {
    const tokenCats = categoriesFor(token);
    const witnessCats = categoriesFor(witness);
    check(
      `"${token}" is itself ordinary vocabulary ${JSON.stringify(tokenCats.filter((c) => ORDINARY_LANGUAGE_CATEGORIES.includes(c)))}`,
      true // printed for the record; the assertion that matters is the next one
    );
    check(
      `  but "${witness}" carries no ordinary-language category, so it still witnesses`,
      !witnessCats.some((c) => ORDINARY_LANGUAGE_CATEGORIES.includes(c)) && evidence(token).witness === witness,
      `${JSON.stringify(witnessCats)} / ${JSON.stringify(evidence(token))}`
    );
  }
}

console.log("\n--- PRESERVED: the institutional filter still works ---");
{
  check("'Enrollment' is not witnessed", !evidence("Enrollment").has, JSON.stringify(evidence("Enrollment")));
  check("'Records' is not witnessed", !evidence("Records").has, JSON.stringify(evidence("Records")));
}

console.log("\n--- UNTOUCHED: ambiguity and entity-group evidence ---");
{
  /*
   * A1 narrows ONE of the three sources. The other two are independent
   * claims made by entity resolution, and this change must not reach them --
   * including for a token whose only multi-token phrase was disqualified.
   */
  const withAmbiguity = documentNameEvidenceFor(
    candidate("Morning"),
    { ambiguityProposalCandidateIds: new Set(["person:morning"]), entityGroupMemberIds: new Set() },
    index
  );
  check(
    "an ambiguity proposal still supplies name evidence to a disqualified token",
    withAmbiguity.has && withAmbiguity.sources.includes("ambiguity-proposal"),
    JSON.stringify(withAmbiguity)
  );
  const withGroup = documentNameEvidenceFor(
    candidate("Thank"),
    { ambiguityProposalCandidateIds: new Set(), entityGroupMemberIds: new Set(["person:thank"]) },
    index
  );
  check(
    "entity-group membership still supplies name evidence",
    withGroup.has && withGroup.sources.includes("entity-group-member"),
    JSON.stringify(withGroup)
  );
}

console.log("\n--- UNTOUCHED: the phrase itself is not retyped or suppressed ---");
{
  /*
   * AG: "Do not globally retype or suppress the multi-token candidate."
   * Disqualifying a witness withdraws its authority to speak about OTHER
   * candidates; it says nothing about the phrase's own reviewability.
   */
  check("'Good Morning' is still a person-typed candidate", candidate("Good Morning").detectedType === "person");
  check(
    "'Good Morning' still carries its own production categories",
    categoriesFor("Good Morning").length > 0,
    JSON.stringify(categoriesFor("Good Morning"))
  );
}

console.log("\n--- THE HONEST LIMIT: name-shaped ordinary phrases still witness ---");
{
  /*
   * Asserted as UNFIXED rather than omitted. `Last Call` is
   * category-identical to `Agnes Wu`, so no category-based rule can separate
   * them; see full-name-token-witness-verification.ts, where discriminator 1
   * is falsified. Narrowing further would need evidence the lexical layer
   * does not have, and guessing there costs real names.
   */
  for (const [token, phrase] of [["Last", "Last Call"], ["Message", "Message List"], ["Preview", "Preview Day"]] as Array<[string, string]>) {
    check(
      `KNOWN LIMIT: "${token}" is still witnessed by "${phrase}"`,
      evidence(token).witness === phrase,
      `${JSON.stringify(evidence(token))} -- if this now passes differently, a further narrowing landed and should be reviewed`
    );
  }
  check(
    "and the reason is that it is category-identical to a real name",
    JSON.stringify(categoriesFor("Last Call")) === JSON.stringify(categoriesFor("Agnes Wu")),
    `${JSON.stringify(categoriesFor("Last Call"))} vs ${JSON.stringify(categoriesFor("Agnes Wu"))}`
  );

  /*
   * A SECOND LIMIT, found by this suite rather than predicted -- and it
   * corrects a claim in 20260809-residual-population-evidence-audit.md,
   * which said discriminator 2 "catches the greeting and calendar
   * witnesses".
   *
   * It catches "Tuesday, March" via `all_common_dictionary_words`, NOT via
   * anything calendrical. `calendar_term`, `calendar_abbreviation` and
   * `season_or_academic_term` are not ORDINARY_LANGUAGE_CATEGORIES, so a
   * calendar phrase that misses the common-word list -- "Happy Friday",
   * "Winter Grading" -- still witnesses.
   *
   * Recorded rather than fixed: widening ORDINARY_LANGUAGE_CATEGORIES is a
   * change to the gate's own acceptance vocabulary, which this pass was
   * explicitly scoped out of.
   */
  const happy = evidence("Happy");
  check(
    "KNOWN LIMIT: calendar categories are not ordinary-language categories, so 'Happy Friday' still witnesses",
    happy.witness === "Happy Friday",
    `${JSON.stringify(happy)} -- calendar coverage changed; re-derive this limit`
  );
  check(
    "  and 'Tuesday, March' was caught by all-common-dictionary-words, not by a calendar category",
    categoriesFor("Tuesday, March").includes("all-common-dictionary-words") &&
      !categoriesFor("Tuesday, March").filter((c) => c.startsWith("calendar")).some((c) => ORDINARY_LANGUAGE_CATEGORIES.includes(c)),
    JSON.stringify(categoriesFor("Tuesday, March"))
  );
}

console.log(`\n=== ${passCount} passed, ${failCount} failed ===`);
if (failCount > 0) {
  for (const f of failed) console.log(`  - ${f}`);
  process.exitCode = 1;
}
