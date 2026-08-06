/**
 * structural-relationship-verification.ts -- Structural Relationship
 * Review (2026-07-30, Andrew's feature proposal). Node-verifiable core:
 * the two deterministic detectors (acronym/full-name, identifier
 * patterns), the engine's determinism and ordering, the
 * dismissRelationship reducer semantics (dissolves the proposal and
 * NOTHING else -- candidates keep flowing through review), and
 * serialization compatibility (additive optional field; pre-feature
 * sessions still load).
 *
 * NOT coverable here (browser-only, disclosed): the Ambiguity-stage
 * section's rendering, the bulk buttons' live dispatch/advance behavior,
 * pending previews, and the acknowledgement pulse.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/structural-relationship-verification.ts
 */

import {
  StructuralRelationshipEngine,
  acronymOfValue,
  isAcronymToken,
  isIdentifierPatternEligible,
  shapeSignatureOf,
} from "../src/engines/StructuralRelationshipEngine.js";
import type { DetectionResult } from "../src/engines/DetectionEngine.js";
import type { Candidate } from "../src/domain/DocumentModel.js";
import { applyReviewCommand, createReviewSession } from "../src/engines/review/session.js";
import { deserializeReviewSession, serializeReviewSession } from "../src/engines/review/serialization.js";
import type { GroupingResult } from "../src/engines/EntityResolutionEngine.js";

let passCount = 0;
let failCount = 0;

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passCount += 1;
    console.log(`  PASS ${label}`);
  } else {
    failCount += 1;
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

function candidate(id: string, displayValue: string, detectedType = "person"): Candidate {
  return {
    id,
    detectedType,
    source: "regex",
    confidence: "medium" as Candidate["confidence"],
    normalizedValue: displayValue.toLowerCase(),
    displayValue,
    occurrenceIds: [`${id}-occ-1`],
  };
}

function detection(candidates: Candidate[]): DetectionResult {
  return { schemaVersion: 1, candidates, occurrences: [] };
}

const emptyGrouping: GroupingResult = { schemaVersion: 1, ambiguityProposals: [], entityGroupProposals: [] };

console.log("--- acronym primitives ---");
check('initials of "California State University, Los Angeles" spell CSULA (comma stripped)', acronymOfValue("California State University, Los Angeles") === "CSULA");
check('initials of "National Student Clearinghouse" spell NSC', acronymOfValue("National Student Clearinghouse") === "NSC");
check('initials of "Degree Verify" spell DV', acronymOfValue("Degree Verify") === "DV");
check("a single-word value sources no acronym", acronymOfValue("Andrew") === null);
check('lowercase connector words are skipped by capitalization, not a stopword list ("University of the Pacific" -> UP)', acronymOfValue("University of the Pacific") === "UP");
check("CSULA is an acronym token; CSULAX2 (digit) is not; C is not (too short)", isAcronymToken("CSULA") && !isAcronymToken("CSULA2") && !isAcronymToken("C"));

console.log("--- acronym detector ---");
const engine = new StructuralRelationshipEngine();
const acronymResult = engine.propose(
  detection([
    candidate("c1", "California State University, Los Angeles"),
    candidate("c2", "CSULA"),
    candidate("c3", "National Student Clearinghouse"),
    candidate("c4", "NSC"),
    candidate("c5", "Degree Verify"),
    candidate("c6", "DV"),
    candidate("c7", "Andrew Goodloe"), // initials AG -- no AG token exists; must NOT propose
  ])
);
const acronymProposals = acronymResult.proposals.filter((p) => p.kind === "acronym");
check("three acronym proposals found (CSULA, NSC, DV) and no false pair for AG", acronymProposals.length === 3, `got ${acronymProposals.length}`);
const csula = acronymProposals.find((p) => p.proposalId === "rel-acronym-CSULA");
check("CSULA proposal pairs the full name with the acronym candidate, full first (detection order)", JSON.stringify(csula?.candidateIds) === JSON.stringify(["c1", "c2"]));
check("observation is the spec's non-semantic vocabulary", csula?.observation === "Possible acronym relationship.");
check("evidence names the matched initials transparently", Boolean(csula?.evidence.includes('"California State University, Los Angeles"') && csula?.evidence.includes('"CSULA"')));

console.log("--- identifier-pattern primitives ---");
check('"123456789" -> #########', shapeSignatureOf("123456789") === "#########");
check('"A1234567" -> A#######', shapeSignatureOf("A1234567") === "A#######");
check('"ABC-12345" -> AAA-#####', shapeSignatureOf("ABC-12345") === "AAA-#####");
check("phone/email candidates are excluded (their semantics are already typed)", !isIdentifierPatternEligible(candidate("p", "555-1234", "phone")) && !isIdentifierPatternEligible(candidate("e", "a1@b.com", "email")));
check("pure-letter tokens are excluded (the acronym detector's territory)", !isIdentifierPatternEligible(candidate("x", "ABCD")));
check("multi-word values are excluded", !isIdentifierPatternEligible(candidate("y", "Case 12345")));

console.log("--- identifier-pattern detector ---");
const idResult = engine.propose(
  detection([
    candidate("n1", "123456789", "long_numeric_id"),
    candidate("n2", "998211443", "long_numeric_id"),
    candidate("n3", "455123991", "long_numeric_id"),
    candidate("a1", "A1234567", "cin"),
    candidate("a2", "B9182721", "cin"),
    candidate("a3", "C0004812", "cin"),
    candidate("h1", "ABC-12345", "cin"),
    candidate("h2", "XYZ-99182", "cin"),
    candidate("lone", "9987", "cin"), // unique shape (####) with one member -- no proposal
    candidate("ph1", "555-123-4567", "phone"), // excluded by type
    candidate("ph2", "555-999-8888", "phone"),
  ])
);
const numeric = idResult.proposals.filter((p) => p.kind === "numeric-identifier");
const alnum = idResult.proposals.filter((p) => p.kind === "alphanumeric-identifier");
check("one numeric proposal (the three 9-digit values)", numeric.length === 1 && JSON.stringify(numeric[0]!.candidateIds) === JSON.stringify(["n1", "n2", "n3"]));
check("two alphanumeric proposals (A####### x3 and AAA-##### x2)", alnum.length === 2, `got ${alnum.length}`);
check(
  "numeric observation is verbatim non-semantic (never 'Student ID'/'SSN'/...)",
  numeric[0]!.observation === "These values appear to share the same structural pattern and may represent some numeric identifier."
);
check("evidence shows the exact shape signature", numeric[0]!.evidence.includes("#########"));
check("phone candidates formed no proposal despite sharing a shape", idResult.proposals.every((p) => !p.candidateIds.includes("ph1")));
check("a single-member shape forms no proposal", idResult.proposals.every((p) => !p.candidateIds.includes("lone")));

console.log("--- determinism & ordering ---");
const again = engine.propose(
  detection([
    candidate("n1", "123456789", "long_numeric_id"),
    candidate("n2", "998211443", "long_numeric_id"),
    candidate("n3", "455123991", "long_numeric_id"),
    candidate("a1", "A1234567", "cin"),
    candidate("a2", "B9182721", "cin"),
    candidate("a3", "C0004812", "cin"),
    candidate("h1", "ABC-12345", "cin"),
    candidate("h2", "XYZ-99182", "cin"),
    candidate("lone", "9987", "cin"),
    candidate("ph1", "555-123-4567", "phone"),
    candidate("ph2", "555-999-8888", "phone"),
  ])
);
check("identical input -> identical proposals (ids, order, members)", JSON.stringify(again) === JSON.stringify(idResult));
check(
  "proposal ids are content-derived, never positional",
  numeric[0]!.proposalId === "rel-pattern-#########" && alnum.some((p) => p.proposalId === "rel-pattern-AAA-#####")
);

console.log("--- dismissRelationship reducer semantics ---");
const det = detection([candidate("n1", "123456789", "long_numeric_id"), candidate("n2", "998211443", "long_numeric_id")]);
const context = { detection: det, grouping: emptyGrouping };
let session = createReviewSession("s1", "doc1", "2026-07-30T00:00:00.000Z");
const outcome = applyReviewCommand(
  session,
  { family: "review", type: "dismissRelationship", proposalId: "rel-pattern-#########", relationshipKind: "numeric-identifier", candidateIds: ["n1", "n2"] },
  context,
  "2026-07-30T00:00:01.000Z"
);
check("dismissal is accepted", outcome.result.ok === true);
session = outcome.session;
check("the dismissal is stored, keyed by proposalId", session.relationshipDismissals?.["rel-pattern-#########"]?.kind === "numeric-identifier");
check(
  "UNRELATED DECIDES NOTHING: no candidateDecisions, no groupDecisions, no entity confirmations were written",
  Object.keys(session.candidateDecisions).length === 0 && Object.keys(session.groupDecisions).length === 0
);
check(
  "a relationship-dismissed event was appended with the proposal's own facts",
  session.events.some((e) => e.kind === "relationship-dismissed" && e.payload.proposalId === "rel-pattern-#########" && e.payload.memberCount === 2)
);
const emptyDismiss = applyReviewCommand(
  session,
  { family: "review", type: "dismissRelationship", proposalId: "rel-x", relationshipKind: "acronym", candidateIds: [] },
  context,
  "2026-07-30T00:00:02.000Z"
);
check("an empty member list is rejected, not silently recorded", emptyDismiss.result.ok === false);

console.log("--- members remain fully reviewable after dismissal ---");
const keepAfter = applyReviewCommand(session, { family: "review", type: "keepCandidate", candidateId: "n1" }, context, "2026-07-30T00:00:03.000Z");
check("a dismissed proposal's member still takes an ordinary Keep in Item Review", keepAfter.result.ok === true && keepAfter.session.candidateDecisions["n1"]?.decision === "Keep");

console.log("--- serialization: additive & backward compatible ---");
const serialized = serializeReviewSession(session);
const roundTrip = deserializeReviewSession(serialized);
check("a session WITH dismissals round-trips", roundTrip.ok === true && roundTrip.ok && roundTrip.session.relationshipDismissals?.["rel-pattern-#########"] !== undefined);
const preFeature = JSON.parse(serializeReviewSession(createReviewSession("s2", "doc2", "2026-07-30T00:00:00.000Z"))) as Record<string, unknown>;
delete preFeature["relationshipDismissals"];
const legacy = deserializeReviewSession(JSON.stringify(preFeature));
check("a pre-feature session (no relationshipDismissals field) still deserializes -- additive, no schema bump", legacy.ok === true);

console.log(`\n${passCount}/${passCount + failCount} checks passed`);
process.exitCode = failCount === 0 ? 0 : 1;
