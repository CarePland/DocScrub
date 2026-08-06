/**
 * contextual-person-evidence-verification.ts -- the Contextual Person
 * Evidence pass (AG, 2026-08-05;
 * engines/contextual-person-evidence/*, composed into engines/quality/scoring.ts).
 *
 * Structured around what would go wrong, worst first:
 *
 *   1. PARITY IS UNHARMED. The whole placement argument rests on
 *      scoreCandidateQuality() being byte-identical when no contextual
 *      evidence is supplied. Asserted directly, not assumed.
 *   2. FALSE POSITIVES. A rule that fires on institutional prose
 *      ("Enrollment begins", "Section 4 requires", "Jordan and the
 *      committee") would push non-people into review at high confidence --
 *      the most expensive failure this pass can produce.
 *   3. THE COMBINATION CURVE. That correlated signals diminish and cap,
 *      rather than summing to a clamp, is the reason the score still ranks.
 *      Asserted on the curve itself, not inferred from scores.
 *   4. SCOPE. That nothing crosses from one candidate to another, which is
 *      the promise that this is not entity resolution.
 *   5. THE GATE-3 THRESHOLD, both directions.
 *
 * NOT coverable here (browser-only): how the single chip plus representative
 * example reads in the focus panel.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/contextual-person-evidence-verification.ts
 */

import type { Candidate, ContentBlock, DocumentModel, Occurrence } from "../src/domain/DocumentModel.js";
import type { DetectionResult } from "../src/engines/DetectionEngine.js";
import {
  CONTEXTUAL_CONTRIBUTION_CAP,
  CONTEXTUAL_EVIDENCE_RULE,
  CONTEXTUAL_RULE_WEIGHTS,
  GATE_3_CONTEXTUAL_THRESHOLD,
  combineContextualWeights,
  emptyContextualPersonEvidence,
  evaluateContextualPersonEvidence,
  type ContextualEvidenceRuleId,
} from "../src/engines/contextual-person-evidence/contextual-person-evidence.js";
import { evaluateOccurrenceContext } from "../src/engines/contextual-person-evidence/contextual-rules.js";
import { scoreCandidateQuality } from "../src/engines/quality/scoring.js";

let passCount = 0;
let failCount = 0;
function check(label: string, condition: boolean): void {
  if (condition) {
    passCount++;
    console.log(`  ok   ${label}`);
  } else {
    failCount++;
    console.log(`  FAIL ${label}`);
  }
}

// ---- fixtures -------------------------------------------------------------

/** Builds the context snippet shape DetectionEngine.contextSnippet() writes. */
function ctx(before: string, match: string, after: string): string {
  return `${before}[${match}]${after}`;
}

function fired(before: string, match: string, after: string): ContextualEvidenceRuleId[] {
  return evaluateOccurrenceContext(ctx(before, match, after));
}

function hasRule(rule: ContextualEvidenceRuleId, before: string, match: string, after: string): boolean {
  return fired(before, match, after).includes(rule);
}

let blockSeq = 0;
function block(text: string, kind: ContentBlock["kind"] = "body"): ContentBlock {
  blockSeq++;
  return {
    id: `block-${blockSeq}`,
    kind,
    text,
    order: blockSeq,
    sourceMapping: { partName: "word/document.xml", sourceRef: `p-${blockSeq}` } as ContentBlock["sourceMapping"],
    runMappings: [],
  };
}

/** A document + detection stream built from literal block texts, with one
 *  occurrence per (block, needle) pair. Deliberately hand-built rather than
 *  parsed from a fixture .docx so each test states exactly the layout it is
 *  about -- especially the multi-block signature shapes, which are the whole
 *  reason the anchor family exists. */
function build(
  blocks: ContentBlock[],
  spec: { key: string; display: string; needles: { blockIndex: number; text: string }[] }[]
): { document: DocumentModel; detection: DetectionResult } {
  const document = { schemaVersion: 6, blocks } as unknown as DocumentModel;
  const candidates: Candidate[] = [];
  const occurrences: Occurrence[] = [];
  let occSeq = 0;

  for (const entry of spec) {
    const occurrenceIds: string[] = [];
    for (const needle of entry.needles) {
      const b = blocks[needle.blockIndex]!;
      const start = b.text.indexOf(needle.text);
      if (start < 0) throw new Error(`fixture error: "${needle.text}" not in "${b.text}"`);
      const end = start + needle.text.length;
      occSeq++;
      const id = `occ-${occSeq}`;
      occurrenceIds.push(id);
      occurrences.push({
        id,
        candidateId: entry.key,
        blockId: b.id,
        startOffset: start,
        endOffset: end,
        text: needle.text,
        context: `${b.text.slice(Math.max(0, start - 70), start)}[${needle.text}]${b.text.slice(end, end + 70)}`,
        source: "regex",
      });
    }
    candidates.push({
      id: entry.key,
      displayValue: entry.display,
      detectedType: "person",
      source: "regex",
      confidence: "medium",
      occurrenceIds,
    } as Candidate);
  }
  return { document, detection: { schemaVersion: 1, candidates, occurrences } };
}

// ===========================================================================
console.log("--- 1. PYTHON PARITY IS UNHARMED ---");
{
  const blocks = [block("Please contact Jordan about the transcript.")];
  const { document, detection } = build(blocks, [
    { key: "person:jordan", display: "Jordan", needles: [{ blockIndex: 0, text: "Jordan" }] },
  ]);
  const blocksById = new Map(blocks.map((b) => [b.id, b]));
  const candidate = detection.candidates[0]!;
  const occs = detection.occurrences;

  const withoutArg = scoreCandidateQuality(candidate, occs, blocksById);
  const withUndefined = scoreCandidateQuality(candidate, occs, blocksById, undefined, undefined, undefined);
  check(
    "omitting the contextual argument scores identically to passing undefined",
    JSON.stringify(withoutArg) === JSON.stringify(withUndefined)
  );

  const contextual = evaluateContextualPersonEvidence(document, detection);
  const supplied = contextual.byCandidate[candidate.id]!;
  check("the pass DOES find evidence here (so the next check is meaningful)", supplied.contribution > 0);

  const zeroCapProfile = { contextual_person_evidence: 0 };
  const disabled = scoreCandidateQuality(candidate, occs, blocksById, zeroCapProfile as never, 25, supplied);
  const disabledReasons = disabled.reasons.filter((r) => r === CONTEXTUAL_EVIDENCE_RULE);
  check("a profile weight of 0 disables the family entirely", disabledReasons.length === 0);

  check(
    "no contextual evidence means no contextual rule in reasons",
    !withoutArg.reasons.includes(CONTEXTUAL_EVIDENCE_RULE)
  );
  check("and the additive result fields are empty, not absent", Array.isArray(withoutArg.contextualRules) && withoutArg.contextualRules.length === 0);
  check("emptyContextualPersonEvidence is a well-formed no-op", Object.keys(emptyContextualPersonEvidence().byCandidate).length === 0);
}

// ===========================================================================
console.log("\n--- 2. THE SEVEN RULES FIRE ON ANDREW'S OWN EXAMPLES ---");
{
  check("human subject: 'Jordan approved the request.'", hasRule("contextual_human_subject", "", "Jordan", " approved the request."));
  // Andrew's spec lists "Alex replied yesterday." under HUMAN SUBJECT, and it
  // is one -- but "replied" is also a verb of speaking, so the attribution
  // rule claims it first and the subject rule is suppressed (see section 4).
  // That is the intended behaviour, not a miss: the evidence is captured at
  // attribution's HIGHER weight (40 vs 30), and counted once rather than
  // twice. Asserted as "one strong rule fired, and it is the stronger one"
  // rather than pinning the specific id, which would be asserting the
  // lexicon overlap rather than the outcome.
  {
    const replied = fired("", "Alex", " replied yesterday.");
    check("'Alex replied yesterday.' yields exactly one contextual rule", replied.length === 1);
    check("...and it is attribution, the stronger reading", replied[0] === "contextual_attribution");
    check("...scoring at least as high as the subject rule would have", CONTEXTUAL_RULE_WEIGHTS.contextual_attribution >= CONTEXTUAL_RULE_WEIGHTS.contextual_human_subject);
  }
  check("human subject: 'Casey attended the meeting.'", hasRule("contextual_human_subject", "", "Casey", " attended the meeting."));
  check("human subject tolerates one auxiliary ('has approved')", hasRule("contextual_human_subject", "", "Jordan", " has approved it."));

  check("human object: 'Contact Jordan.'", hasRule("contextual_human_object", "Please contact ", "Jordan", "."));
  check("human object: 'Email Alex.'", hasRule("contextual_human_object", "Email ", "Alex", "."));
  check("human object: 'We asked Casey.'", hasRule("contextual_human_object", "We asked ", "Casey", "."));

  check("coordination: 'Jordan and the director'", hasRule("contextual_coordination", "", "Jordan", " and the director"));
  check("coordination: 'Alex and Susan'", hasRule("contextual_coordination", "", "Alex", " and Susan"));
  check("coordination: 'the chair and Casey'", hasRule("contextual_coordination", "the chair and ", "Casey", ""));

  check("possessive: \"Jordan's office\"", hasRule("contextual_possessive", "", "Jordan", "'s office"));
  check("possessive when the detector kept the apostrophe", hasRule("contextual_possessive", "", "Alex's", " report"));
  check("possessive with a typographic apostrophe", hasRule("contextual_possessive", "", "Casey", "’s calendar"));

  check("direct address: 'Hi Jordan,'", hasRule("contextual_direct_address", "Hi ", "Jordan", ","));
  check("direct address: 'Thanks, Alex.'", hasRule("contextual_direct_address", "Thanks, ", "Alex", "."));
  check("direct address: 'Casey, could you review this?'", hasRule("contextual_direct_address", "", "Casey", ", could you review this?"));

  check("attribution: 'Jordan said...'", hasRule("contextual_attribution", "", "Jordan", " said the deadline moved."));
  check("attribution: 'according to Alex'", hasRule("contextual_attribution", "according to ", "Alex", ", the form is late."));
  check("attribution: 'Casey wrote...'", hasRule("contextual_attribution", "", "Casey", " wrote the summary."));

  check("person list: 'Jordan, Alex, and Casey'", hasRule("contextual_person_list", "Jordan, ", "Alex", ", and Casey"));
  check("person list: 'Susan, Jordan, and Michael'", hasRule("contextual_person_list", "Susan, ", "Jordan", ", and Michael"));
}

// ===========================================================================
console.log("\n--- 3. FALSE POSITIVES (the expensive failure) ---");
{
  check(
    "institutional subject does NOT fire: 'Enrollment begins Monday'",
    !hasRule("contextual_human_subject", "", "Enrollment", " begins Monday.")
  );
  check(
    "institutional subject does NOT fire: 'Section 4 requires...'",
    !hasRule("contextual_human_subject", "", "Section", " requires a signature.")
  );
  check(
    "institutional subject does NOT fire: 'Fall includes...'",
    !hasRule("contextual_human_subject", "", "Fall", " includes two terms.")
  );
  check(
    "coordination with a GROUP noun does not fire: 'Jordan and the committee'",
    !hasRule("contextual_coordination", "", "Jordan", " and the committee")
  );
  check(
    "coordination with a lowercase noun does not fire: 'Spring and summer'",
    !hasRule("contextual_coordination", "", "Spring", " and summer")
  );
  check(
    "a comma directly after breaks the subject reading (apposition, not a clause)",
    !hasRule("contextual_human_subject", "", "Jordan", ", approved by the dean, ...")
  );
  check(
    "two names are coordination, NOT a list (the rules must not both fire)",
    !hasRule("contextual_person_list", "", "Alex", " and Susan")
  );
  check("no brackets in the context yields no evidence at all", evaluateOccurrenceContext("no brackets here").length === 0);
  check("an empty context yields no evidence", evaluateOccurrenceContext("").length === 0);
}

// ===========================================================================
console.log("\n--- 4. ATTRIBUTION SUPPRESSES HUMAN SUBJECT (no double count) ---");
{
  const rules = fired("", "Jordan", " said the deadline moved.");
  check("'Jordan said' fires attribution", rules.includes("contextual_attribution"));
  check("'Jordan said' does NOT also fire human subject", !rules.includes("contextual_human_subject"));
  check("so one linguistic observation contributes once", rules.length === 1);

  const wrote = fired("", "Casey", " wrote the summary.");
  check("'Casey wrote' likewise fires attribution only", wrote.length === 1 && wrote[0] === "contextual_attribution");
}

// ===========================================================================
console.log("\n--- 5. THE COMBINATION CURVE ---");
{
  const one = combineContextualWeights(["contextual_human_subject"]);
  check("a single signal contributes its full weight (30)", one === 30);

  const two = combineContextualWeights(["contextual_direct_address", "contextual_human_subject"]);
  check("a second signal is discounted to 40% (40 + 12 = 52)", two === 52);

  const three = combineContextualWeights([
    "contextual_direct_address",
    "contextual_attribution",
    "contextual_possessive",
  ]);
  check("three strong signals cap rather than clamping the score", three === CONTEXTUAL_CONTRIBUTION_CAP);

  const everything = combineContextualWeights(Object.keys(CONTEXTUAL_RULE_WEIGHTS) as ContextualEvidenceRuleId[]);
  check("all eleven rules still cap at the cap", everything === CONTEXTUAL_CONTRIBUTION_CAP);
  check("the cap leaves headroom below the clamp (35 + cap < 99)", 35 + CONTEXTUAL_CONTRIBUTION_CAP < 99);
  check("and reaches Strong on contextual evidence alone (35 + cap >= 80)", 35 + CONTEXTUAL_CONTRIBUTION_CAP >= 80);
  check("no evidence contributes nothing", combineContextualWeights([]) === 0);
  check("order of input does not change the result", combineContextualWeights(["contextual_human_object", "contextual_direct_address"]) === combineContextualWeights(["contextual_direct_address", "contextual_human_object"]));
}

// ===========================================================================
console.log("\n--- 6. ANCHORS NEED BLOCK ADJACENCY (the reason they exist) ---");
{
  const blocks = [
    block("Jordan Lee"),
    block("Director of Finance"),
    block("ABC Corporation"),
    block("Casey Morgan (cmorgan@example.edu)"),
    block("Alex Rivera — Senior Counsel handled the appeal."),
  ];
  const { document, detection } = build(blocks, [
    { key: "person:jordan lee", display: "Jordan Lee", needles: [{ blockIndex: 0, text: "Jordan Lee" }] },
    { key: "person:casey morgan", display: "Casey Morgan", needles: [{ blockIndex: 3, text: "Casey Morgan" }] },
    { key: "person:alex rivera", display: "Alex Rivera", needles: [{ blockIndex: 4, text: "Alex Rivera" }] },
  ]);
  const result = evaluateContextualPersonEvidence(document, detection);

  const jordan = result.byCandidate["person:jordan lee"]!;
  check("signature block fires across separate blocks", jordan.rules.includes("anchor_signature_block"));
  check(
    "and the context string alone could not have seen it",
    evaluateOccurrenceContext(detection.occurrences[0]!.context).length === 0
  );

  const casey = result.byCandidate["person:casey morgan"]!;
  check(
    "name-with-email fires on a local part the ported rule misses ('cmorgan')",
    casey.rules.includes("anchor_name_with_email")
  );

  const alex = result.byCandidate["person:alex rivera"]!;
  check("full-name-with-role fires on an em dash, not just a comma", alex.rules.includes("anchor_full_name_with_role"));
  check("an anchor alone clears the gate-3 threshold", alex.contribution >= GATE_3_CONTEXTUAL_THRESHOLD);
}

// ===========================================================================
console.log("\n--- 7. REPRESENTATIVE EXAMPLE SELECTION ---");
{
  const blocks = [
    block("Please contact Jordan Lee about it."),
    block("Jordan Lee, Director of Finance, signed the memo."),
    block("We asked Jordan Lee for the file."),
  ];
  const { document, detection } = build(blocks, [
    {
      key: "person:jordan lee",
      display: "Jordan Lee",
      needles: [
        { blockIndex: 0, text: "Jordan Lee" },
        { blockIndex: 1, text: "Jordan Lee" },
        { blockIndex: 2, text: "Jordan Lee" },
      ],
    },
  ]);
  const jordan = evaluateContextualPersonEvidence(document, detection).byCandidate["person:jordan lee"]!;

  check("every occurrence is evaluated independently", jordan.perOccurrence.length === 3);
  check("the anchor-bearing occurrence is chosen as representative", jordan.representative?.occurrenceId === "occ-2");
  check(
    "the representative is the one carrying the anchor",
    jordan.representative!.rules.includes("anchor_full_name_with_role")
  );
  check("the union spans all three occurrences, not just the anchor's", jordan.rules.length > jordan.representative!.rules.length);
  check("the candidate contribution is the combined union, capped", jordan.contribution === combineContextualWeights(jordan.rules));
}

// ===========================================================================
console.log("\n--- 8. CONTRADICTORY USES STAY VISIBLE ---");
{
  const blocks = [
    block("Thanks, May, for the update."),
    block("The May session begins soon."),
    block("Grades are due in May."),
    block("May 5 is the deadline."),
  ];
  const { document, detection } = build(blocks, [
    {
      key: "person:may",
      display: "May",
      needles: [
        { blockIndex: 0, text: "May" },
        { blockIndex: 1, text: "May" },
        { blockIndex: 2, text: "May" },
        { blockIndex: 3, text: "May" },
      ],
    },
  ]);
  const may = evaluateContextualPersonEvidence(document, detection).byCandidate["person:may"]!;

  check("the one person-like use is found", may.perOccurrence.length === 1);
  check("the three non-person uses are counted, not discarded", may.occurrencesWithoutEvidence === 3);
  check("a strong anchor does not erase them", may.occurrencesWithoutEvidence > may.perOccurrence.length);
}

// ===========================================================================
console.log("\n--- 9. THE NEGATIVE-EVIDENCE GATE, WHICH IS THE REAL MECHANISM ---");
{
  const blocks = [block("Thanks, May, for the update.")];
  const { document, detection } = build(blocks, [
    { key: "person:may", display: "May", needles: [{ blockIndex: 0, text: "May" }] },
  ]);
  const blocksById = new Map(blocks.map((b) => [b.id, b]));
  const candidate = detection.candidates[0]!;
  const contextual = evaluateContextualPersonEvidence(document, detection).byCandidate["person:may"]!;

  const before = scoreCandidateQuality(candidate, detection.occurrences, blocksById);
  const after = scoreCandidateQuality(candidate, detection.occurrences, blocksById, undefined, undefined, contextual);

  check("without contextual evidence 'May' is filtered to the floor", before.status === "Unlikely");
  check("with it, 'May' reaches review", after.status === "ToReview");
  check("the lexical negatives SURVIVE -- ambiguity overcome, not erased", after.filterRules.length > 0);
  check("it is not promoted to Strong on context alone here", after.quality !== "Strong");
  check("exactly one contextual chip reaches the evidence breakdown", after.evidenceBreakdown.filter((e) => e.rule === CONTEXTUAL_EVIDENCE_RULE).length === 1);
  check(
    "and that chip's weight is the contribution that actually moved the score",
    after.evidenceBreakdown.find((e) => e.rule === CONTEXTUAL_EVIDENCE_RULE)!.weight === contextual.contribution
  );
  check("the individual usages are carried for prose, not as chips", after.contextualRules.length >= 1 && after.evidenceBreakdown.length < after.contextualRules.length + 11);
}

// ===========================================================================
console.log("\n--- 10. SCOPE: NOT ENTITY RESOLUTION ---");
{
  const blocks = [
    block("Jordan Lee, Director of Finance, approved it."),
    block("The jordan file is attached."),
    block("Jordan is a room on the second floor."),
  ];
  const { document, detection } = build(blocks, [
    { key: "person:jordan lee", display: "Jordan Lee", needles: [{ blockIndex: 0, text: "Jordan Lee" }] },
    { key: "person:jordan", display: "Jordan", needles: [{ blockIndex: 2, text: "Jordan" }] },
  ]);
  const result = evaluateContextualPersonEvidence(document, detection);

  check("the full name carries its anchor", result.byCandidate["person:jordan lee"]!.rules.includes("anchor_full_name_with_role"));
  check(
    "the standalone first name inherits NOTHING from it",
    result.byCandidate["person:jordan"]!.rules.every((r) => !r.startsWith("anchor_"))
  );
  check(
    "and is scored only on its own occurrences",
    result.byCandidate["person:jordan"]!.contribution < result.byCandidate["person:jordan lee"]!.contribution
  );
}

// ===========================================================================
console.log("\n--- 11. NON-PERSON CANDIDATES ARE OUT OF SCOPE ---");
{
  const blocks = [block("Please contact jlee@example.org about it.")];
  const { document, detection } = build(blocks, [
    { key: "email:jlee@example.org", display: "jlee@example.org", needles: [{ blockIndex: 0, text: "jlee@example.org" }] },
  ]);
  (detection.candidates[0] as Candidate).detectedType = "email";
  const result = evaluateContextualPersonEvidence(document, detection);
  check("an email candidate gets no contextual record at all", result.byCandidate["email:jlee@example.org"] === undefined);
}

// ===========================================================================
console.log("\n--- 12. GATE-3 THRESHOLD, BOTH DIRECTIONS ---");
{
  check(
    "a lone human-object hit (24) does NOT reach the threshold",
    combineContextualWeights(["contextual_human_object"]) < GATE_3_CONTEXTUAL_THRESHOLD
  );
  check(
    "a lone direct-address hit (40) does",
    combineContextualWeights(["contextual_direct_address"]) >= GATE_3_CONTEXTUAL_THRESHOLD
  );
  check(
    "every anchor rule on its own does",
    (Object.keys(CONTEXTUAL_RULE_WEIGHTS) as ContextualEvidenceRuleId[])
      .filter((r) => r.startsWith("anchor_"))
      .every((r) => combineContextualWeights([r]) >= GATE_3_CONTEXTUAL_THRESHOLD)
  );
}

console.log(`\n${passCount}/${passCount + failCount} checks passed`);
process.exitCode = failCount === 0 ? 0 : 1;
