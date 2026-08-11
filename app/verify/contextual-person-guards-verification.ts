/**
 * contextual-person-guards-verification.ts -- Guards 1 and 2 for the
 * contextual-person-evidence family, plus the Guard 3 fixtures Andrew asked
 * to see BEFORE any homograph change (AG, 2026-08-09).
 *
 * ---------------------------------------------------------------------
 * WHAT WENT WRONG, from the live document
 * ---------------------------------------------------------------------
 *
 * `__docscrub.why("The")` showed "The" carrying contextual person evidence
 * on four occurrences:
 *
 *   [The] initial batch of PERC drop emails went out   human_subject
 *   [The] schedule will be visible on 03/30/2026       human_subject
 *   [The] revised communication was sent out           human_subject
 *   ...first initial email.  [The] first sentence      human_object
 *
 * Two independent defects, and one unifying cause: every rule in this
 * family reads the NEIGHBOURHOOD and never the CANDIDATE. "The" is a
 * determiner -- the subject is the noun phrase it introduces, not the
 * article in front of it.
 *
 * ---------------------------------------------------------------------
 * THE THREE GUARD FAMILIES
 * ---------------------------------------------------------------------
 *
 * GUARD 1 (landed)  candidate-capability. A determiner/pronoun/function
 *                   word cannot receive USAGE evidence. Built from the
 *                   pipeline's own `pronoun_or_determiner` +
 *                   `sentence_fragment_word` lexicons, NOT a blacklist.
 * GUARD 2 (landed)  sentence boundary. `human_object` cannot bridge a
 *                   full stop.
 * GUARD 3 (NOT landed) noun/verb homographs and participles. Fixtures only;
 *                   the proposal is in the report, per Andrew's instruction
 *                   that this must not change production behaviour yet.
 *
 * Every assertion runs the real rules. Positive controls carry as much
 * weight as the suppressions: a guard that silenced real people would be a
 * worse defect than the one it fixes.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/contextual-person-guards-verification.ts
 */

import { evaluateOccurrenceContext } from "../src/engines/contextual-person-evidence/contextual-rules.ts";
import { evaluateContextualPersonEvidence } from "../src/engines/contextual-person-evidence/contextual-person-evidence.ts";
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

const rules = (context: string): string[] => evaluateOccurrenceContext(context);
const fires = (context: string): boolean => rules(context).length > 0;

/** Runs the FULL pass (Guard 1 lives there, not in the rules module). */
function passFor(surface: string, contexts: string[]): string[] {
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

console.log("=== Contextual person evidence: Guards 1 and 2 ===\n");

console.log("--- GUARD 1: the candidate must be capable of being a person ---");
{
  // The four live occurrences, through the FULL pass.
  const live = passFor("The", [
    "[The] initial batch of PERC drop emails went out last week",
    "[The] schedule will be visible on 03/30/2026 as well",
    "[The] revised communication was sent out after the first initial email.",
    "...after the first initial email.  [The] first sentence in the letter",
  ]);
  check("the live 'The' case now carries NO contextual person evidence", live.length === 0, JSON.stringify(live));

  for (const word of ["This", "That", "These", "Those", "They", "There", "We", "You"]) {
    const r = passFor(word, [`[${word}] approved the change`, `Please contact [${word}] today`]);
    check(`"${word}" receives no usage evidence`, r.length === 0, JSON.stringify(r));
  }
}

console.log("\n--- GUARD 1 POSITIVE CONTROLS: real people are untouched ---");
{
  for (const name of ["Andrew", "Tamara", "Nelly", "Margaret", "Patrick"]) {
    const r = passFor(name, [`[${name}] approved the change`]);
    check(`"${name}" still receives person evidence`, r.length > 0, JSON.stringify(r));
  }
}

console.log("\n--- GUARD 1 COLLISION CONTROLS: Will/May/Mark/Rose must survive ---");
{
  /*
   * The load-bearing constraint. `common_verb` contains "will", so using it
   * as a disqualifier would have silenced Will -- exactly the collision
   * Andrew required be preserved. The guard uses only
   * pronoun_or_determiner + sentence_fragment_word.
   */
  for (const name of ["Will", "May", "Mark", "Rose", "Amy", "Fox", "Collier", "Grace", "Summer"]) {
    const r = passFor(name, [`[${name}] approved the change`, `Please contact [${name}] today`]);
    check(`"${name}" still receives person evidence (name/word collision preserved)`, r.length > 0, JSON.stringify(r));
  }

  // And the structural claim, asserted against the lexicons themselves so a
  // future dictionary edit that admits a name fails here rather than in the
  // field.
  const data = QUALITY_DICTIONARIES_DATA as unknown as Record<string, readonly string[]>;
  const guardSet = new Set([...(data["pronoun_or_determiner"] ?? []), ...(data["sentence_fragment_word"] ?? [])]);
  const collisions = ["will", "may", "mark", "rose", "amy", "fox", "collier", "grace", "summer", "june", "april", "dawn", "hope", "art", "bill", "frank", "penny", "joy", "daisy"];
  const caught = collisions.filter((c) => guardSet.has(c));
  check(`the guard set (${guardSet.size} tokens) contains NO name/word collision`, caught.length === 0, JSON.stringify(caught));
  check("and 'will' is deliberately NOT in it (common_verb was excluded for this reason)", !guardSet.has("will"));
}

console.log("\n--- GUARD 2: human_object must not bridge a sentence boundary ---");
{
  const suppressed: Array<[string, string]> = [
    ["...first initial email.  [X] first sentence in the letter", "full stop"],
    ["Send the report. [X] arrived later", "full stop"],
    ["We had a call! [X] morning", "exclamation"],
    ["Did you email? [X] later that day", "question mark"],
  ];
  for (const [context, why] of suppressed) {
    check(`object relation broken by ${why}`, !rules(context).includes("contextual_human_object"), JSON.stringify(rules(context)));
  }
}

console.log("\n--- GUARD 2 POSITIVE CONTROLS: same-sentence objects still fire ---");
{
  const mustFire = [
    "Please email [Tamara] about it",
    "We asked [Casey] to review",
    "Did you contact [Nelly]?",
    "I will call [Margaret] tomorrow",
    "Please contact [Patrick] directly",
  ];
  for (const context of mustFire) {
    check(`still fires: ${context}`, rules(context).includes("contextual_human_object"), JSON.stringify(rules(context)));
  }
}

console.log("\n--- GUARD 2: an abbreviation's period is not a sentence end ---");
{
  /*
   * The first version of this guard treated "Dr." as a sentence end.
   * Corrected using the pipeline's honorific/abbreviation lexicons.
   *
   * NOTE, recorded honestly: these contexts do not fire human_object either
   * way, because the token immediately before the candidate is the
   * honorific rather than the verb. That is PRE-EXISTING and unrelated to
   * this guard -- asserted here so a future reader does not mistake it for
   * a regression Guard 2 caused.
   */
  check("'Ask Dr. [Garcia] about it' does not fire (pre-existing: honorific sits between verb and name)", !fires("Ask Dr. [Garcia] about it"));
  // But the guard itself must not be what stops it: with the honorific
  // removed the same sentence fires normally.
  check("'Ask [Garcia] about it' fires", rules("Ask [Garcia] about it").includes("contextual_human_object"), JSON.stringify(rules("Ask [Garcia] about it")));
}

console.log("\n--- GUARD 3 FIXTURES (no production change; evidence for the proposal) ---");
{
  /*
   * Andrew's list, run as-is. These are RECORDED, not asserted as correct:
   * the point is to show which of them the current rules get right and which
   * they get wrong, so the narrowest possible condition can be proposed.
   */
  const fixtures: Array<[string, string]> = [
    ["[Andrew] reports that the roster is ready", "PERSON: finite verb, must keep firing"],
    ["[Nelly] notes that grades are due", "PERSON: finite verb, must keep firing"],
    ["[Tamara] emailed Andrew about it", "PERSON: finite verb, must keep firing"],
    ["the [Registrar] report is attached", "LEXICAL: noun after determiner"],
    ["the [Registrar] schedule will be visible", "LEXICAL: noun after determiner"],
    ["the [Registrar] email went out", "LEXICAL: noun after determiner"],
    ["the revised [Communication] was sent", "LEXICAL: participle before candidate"],
    ["[The] report is attached", "LEXICAL: determiner candidate (Guard 1 handles)"],
    ["[NSC] reports the full list", "AMBIGUOUS: org + homograph"],
  ];
  console.log("      rules                              context");
  for (const [context, note] of fixtures) {
    console.log(`      ${JSON.stringify(rules(context)).padEnd(34)} ${context}   [${note}]`);
  }

  // The three PERSON cases must keep firing whatever Guard 3 becomes. Pinned
  // now so the eventual change has a target it cannot quietly break.
  check("GUARD 3 INVARIANT: '[Andrew] reports that...' fires", fires("[Andrew] reports that the roster is ready"));
  check("GUARD 3 INVARIANT: '[Nelly] notes that...' fires", fires("[Nelly] notes that grades are due"));
  check("GUARD 3 INVARIANT: '[Tamara] emailed Andrew...' fires", fires("[Tamara] emailed Andrew about it"));
}

console.log(`\n=== ${passCount} passed, ${failCount} failed ===`);
if (failCount > 0) {
  for (const f of failed) console.log(`  - ${f}`);
  process.exitCode = 1;
}
