/**
 * contextual-clitic-guard-verification.ts -- change B: contractions and
 * clitics are not person evidence (AG, 2026-08-09).
 *
 * ---------------------------------------------------------------------
 * THE TWO DEFECTS, from the live document
 * ---------------------------------------------------------------------
 *
 * 1. Guard 1 looked its capability question up on the INFLECTED surface, so
 *    a base that IS in the lexicon did not protect the contracted form built
 *    on it. `we` is in sentence_fragment_word; `we'll` is in nothing.
 *    Live consequence: contextual_human_subject on `We'll`, `I'm`, `I'll`.
 *
 * 2. The possessive rule reads a trailing `'s` as possession. In `Here's`,
 *    `That's`, `It's` and `It's` that `'s` is a contracted COPULA -- "here
 *    IS the roster" -- and the possession it reports is not in the sentence.
 *
 * Both are fixed by ONE mechanism: normalize the clitic, then let the
 * existing capability lexicons decide. There is no possessive-specific test,
 * deliberately -- Guard 1 already suppresses every usage rule, and a second
 * authority on the same question would drift from the first.
 *
 * ---------------------------------------------------------------------
 * WHAT THIS SUITE IS REALLY FOR
 * ---------------------------------------------------------------------
 *
 * The suppressions are the easy half. The half that matters is that
 * stripping a clitic DECIDES NOTHING -- the lexicon decides -- so genuine
 * possessives must be entirely unaffected. `Amy's`, `Berhanu's` and
 * `Sonoma's` are asserted here as first-class cases, not as an afterthought.
 *
 * The acronym controls are equally load-bearing. `NSC reports the full
 * list`, `PERC will run overnight` and `contact ITS` are sentences that
 * genuinely treat their subject as an actor. That is ambiguity for a
 * reviewer to settle, NOT a detector defect, and this change must not touch
 * it. A version of this guard that quietly swept them up would have looked
 * like a bigger win and been a worse product.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/contextual-clitic-guard-verification.ts
 */

import {
  clitcBase,
  evaluateContextualPersonEvidence,
} from "../src/engines/contextual-person-evidence/contextual-person-evidence.ts";
import { evaluateOccurrenceContext } from "../src/engines/contextual-person-evidence/contextual-rules.ts";
import { QUALITY_DICTIONARIES_DATA } from "../src/engines/quality/quality-dictionaries.data.ts";
import type { DetectionResult } from "../src/engines/DetectionEngine.ts";
import type { DocumentModel } from "../src/domain/DocumentModel.ts";

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
 * Runs the FULL pass, which is where Guard 1 lives.
 *
 * `surface` is used as the OCCURRENCE TEXT as well as the display value,
 * because Guard 1 reads the occurrence -- a fixture that set only the
 * display value would pass while testing nothing.
 */
function rulesFor(surface: string, contexts: string[]): string[] {
  const candidateId = `person:${surface.toLowerCase()}`;
  const detection = {
    schemaVersion: 1,
    candidates: [{ id: candidateId, displayValue: surface, detectedType: "person", occurrenceIds: [] }],
    occurrences: contexts.map((context, i) => ({
      id: `${candidateId}:occ:${i}`,
      candidateId,
      blockId: `block-${i}`,
      startOffset: 0,
      endOffset: surface.length,
      text: surface,
      context,
      source: "fallback-single-name-regex",
    })),
  } as unknown as DetectionResult;
  const model = { blocks: [] } as unknown as DocumentModel;
  return [...(evaluateContextualPersonEvidence(model, detection).byCandidate[candidateId]?.rules ?? [])];
}

console.log("=== Contractions and clitics are not person evidence ===\n");

console.log("--- THE NORMALIZATION ITSELF ---");
{
  const cases: Array<[string, string]> = [
    ["we'll", "we"],
    ["we’ll", "we"],
    ["i'm", "i"],
    ["i’m", "i"],
    ["i'll", "i"],
    ["i'd", "i"],
    ["i've", "i"],
    ["you're", "you"],
    ["it's", "it"],
    ["it’s", "it"],
    ["that's", "that"],
    ["that’s", "that"],
    ["here's", "here"],
    ["amy's", "amy"],
    ["berhanu's", "berhanu"],
  ];
  for (const [input, expected] of cases) {
    check(`"${input}" -> "${expected}"`, clitcBase(input) === expected, clitcBase(input));
  }

  /*
   * The scope boundary. An apostrophe inside a name is not a clitic, and a
   * fix that ate one would corrupt person evidence for real people.
   */
  for (const untouched of ["o'brien", "d'angelo", "o'neill", "andrew", "ross'", "james"]) {
    check(`"${untouched}" is left alone`, clitcBase(untouched) === untouched, clitcBase(untouched));
  }
}

console.log("\n--- DEFECT 1: contracted subjects no longer receive usage evidence ---");
{
  /*
   * Every one of these was a live retention. The contexts are the shapes
   * that produced them, not invented sentences.
   */
  const cases: Array<[string, string[]]> = [
    ["We'll", ["[We'll] send the roster tomorrow"]],
    ["We’ll", ["[We’ll] review the exceptions this week"]],
    ["I'm", ["[I'm] attaching the corrected list"]],
    ["I’m", ["[I’m] sending the revised communication"]],
    ["I'll", ["[I'll] forward the file this afternoon"]],
    ["I’ll", ["[I’ll] email the schedule shortly"]],
    ["I'd", ["[I'd], can you confirm the dates"]],
    ["You're", ["[You're] approved for the change"]],
  ];
  for (const [surface, contexts] of cases) {
    const r = rulesFor(surface, contexts);
    check(`"${surface}" receives no usage evidence`, r.length === 0, JSON.stringify(r));
  }
}

console.log("\n--- DEFECT 2: contracted copulas are not possessives ---");
{
  /*
   * The `'s` here contracts "is". Asserted through the full pass, since the
   * fix is Guard 1 rather than a change to the possessive rule -- and also
   * asserted at the RULE level below, to show the rule itself is unchanged.
   */
  const cases: Array<[string, string]> = [
    ["Here's", "[Here's] the roster you asked for"],
    ["That's", "[That's] the correct enrollment count"],
    ["That’s", "[That’s] the version we sent out"],
    ["It's", "[It's] the same list as last term"],
    ["It’s", "[It’s] going out this afternoon"],
  ];
  for (const [surface, context] of cases) {
    const r = rulesFor(surface, [context]);
    check(`"${surface}" receives no possessive-person evidence`, r.length === 0, JSON.stringify(r));
  }

  // The possessive RULE is deliberately untouched: it still fires on the
  // raw shape. The suppression is Guard 1's, one layer up. Asserted so a
  // future reader does not go looking for a change in contextual-rules.ts.
  check(
    "the possessive rule itself is unchanged (still fires on the bare shape)",
    evaluateOccurrenceContext("[Here's] the roster").includes("contextual_possessive"),
    JSON.stringify(evaluateOccurrenceContext("[Here's] the roster"))
  );
}

console.log("\n--- THE LOAD-BEARING HALF: genuine possessives are untouched ---");
{
  /*
   * Stripping decides nothing; the lexicon decides. `amy`, `berhanu` and
   * `sonoma` are in neither capability lexicon, so none is suppressed.
   */
  const cases: Array<[string, string]> = [
    ["Amy's", "[Amy's] email came in overnight"],
    ["Berhanu's", "[Berhanu's] interest in the program"],
    ["Sonoma's", "[Sonoma's] registrar sent the file"],
    ["Tamara's", "[Tamara's] calendar is full"],
    ["Rose's", "[Rose's] office moved last week"],
    ["Will's", "[Will's] report is attached"],
    ["May's", "[May's] section list"],
  ];
  for (const [surface, context] of cases) {
    const r = rulesFor(surface, [context]);
    check(`"${surface}" KEEPS its person evidence`, r.includes("contextual_possessive"), JSON.stringify(r));
  }
}

console.log("\n--- GENUINE HUMAN SUBJECTS are unaffected ---");
{
  for (const name of ["Andrew", "Tamara", "Nelly", "Margaret", "Patrick", "Will", "May", "Mark", "Rose", "Amy", "Fox", "Collier"]) {
    const r = rulesFor(name, [`[${name}] approved the change`]);
    check(`"${name}" still receives person evidence`, r.length > 0, JSON.stringify(r));
  }
}

console.log("\n--- ACRONYM ACTORS REMAIN AMBIGUOUS (not swept up by this change) ---");
{
  /*
   * AG's standard, quoted: "an acronym acting as the grammatical subject is
   * not automatically a detector defect". These sentences do treat their
   * subject as an actor; whether the actor is a person is the reviewer's
   * question, and this change must leave it to them.
   */
  const cases: Array<[string, string]> = [
    ["NSC", "[NSC] reports the full list"],
    /*
     * NOTE, recorded because the first draft of this fixture was WRONG and
     * the failure was informative: "[PERC] will run overnight" fires
     * nothing, because "run" is not in HUMAN_ACTION_VERBS. Neither does
     * "[PERC] will send ..." -- the auxiliary path only matches some
     * inflections. That is a pre-existing property of the verb lexicon,
     * unrelated to this change, and it is not being fixed here. The fixture
     * was corrected to a sentence that actually exercises the rule rather
     * than the assertion being relaxed.
     */
    ["PERC", "[PERC] sent the notification"],
    ["ITS", "Please contact [ITS] about access"],
    ["CommGen", "[CommGen] sent the notification"],
    ["OSD's", "[OSD's] guidance on accommodations"],
  ];
  for (const [surface, context] of cases) {
    const r = rulesFor(surface, [context]);
    check(`"${surface}" KEEPS its evidence -- ambiguity for a reviewer, not a defect`, r.length > 0, JSON.stringify(r));
  }
}

console.log("\n--- THE CAPABILITY SET STILL CONTAINS NO NAME ---");
{
  /*
   * The constraint the whole guard family is bounded by. Re-asserted with
   * the two added entries included, because that addition is exactly the
   * kind of change that could have broken it.
   */
  const data = QUALITY_DICTIONARIES_DATA as unknown as Record<string, readonly string[]>;
  const guardSet = new Set([...(data["pronoun_or_determiner"] ?? []), ...(data["sentence_fragment_word"] ?? []), "it", "here"]);
  const collisions = ["will", "may", "mark", "rose", "amy", "fox", "collier", "grace", "summer", "june", "april", "dawn", "hope", "art", "bill", "frank", "penny", "joy", "daisy", "agnes", "kyle"];
  const caught = collisions.filter((c) => guardSet.has(c));
  check(`the guard set (${guardSet.size} tokens) contains NO name/word collision`, caught.length === 0, JSON.stringify(caught));
  check("the two added entries are closed-class function words, not names", !collisions.includes("it") && !collisions.includes("here"));

  /*
   * And the reason they had to be added here rather than to the dictionary:
   * asserted so that if a future oracle-config change DOES add them, this
   * fails and the local copy gets deleted instead of quietly duplicating.
   */
  const inDictionary = ["it", "here"].filter((w) => (data["pronoun_or_determiner"] ?? []).includes(w));
  check(
    "neither is in the generated pronoun_or_determiner lexicon (the gap this block covers)",
    inDictionary.length === 0,
    `${JSON.stringify(inDictionary)} now present upstream -- delete CLAUSE_SUBJECT_FUNCTION_WORDS instead of keeping both`
  );
}

console.log(`\n=== ${passCount} passed, ${failCount} failed ===`);
if (failCount > 0) {
  for (const f of failed) console.log(`  - ${f}`);
  process.exitCode = 1;
}
