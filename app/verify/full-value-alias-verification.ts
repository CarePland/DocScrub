/**
 * full-value-alias-verification.ts -- Deterministic Semantic Relationship
 * Knowledge, Phase 2 (2026-07-30): the full-value alias provider
 * (acronyms/organization aliases) and augmentation Pass C. Covers the
 * prompt's twelve required verification cases; the browser-only remainder
 * (evidence rendering, link click-through, save/resume) is in the
 * findings doc's checklist with the reusable test document.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/full-value-alias-verification.ts
 */

import { loadFullValueAliasProvider, normalizeFullValue } from "../src/engines/knowledge/FullValueAliasProvider.js";
import { loadRelatedNameProvider } from "../src/engines/knowledge/RelatedNameProvider.js";
import { fullValueStrengthPenalty } from "../src/engines/entity-resolution/semantic-augmentation.js";
import { RegexEntityResolutionEngine } from "../src/engines/EntityResolutionEngine.js";
import type { DetectionResult } from "../src/engines/DetectionEngine.js";
import type { Candidate } from "../src/domain/DocumentModel.js";
import type { QualityResult } from "../src/domain/Evidence.js";
import type { RelationStrength } from "../src/engines/knowledge/SemanticRelationshipProvider.js";
import { applyReviewCommand, createReviewSession } from "../src/engines/review/session.js";

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

let nextId = 0;
function person(displayValue: string, occurrences = 1): Candidate {
  nextId += 1;
  return {
    id: `cand-${String(nextId).padStart(2, "0")}-${displayValue.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    detectedType: "person",
    source: "regex",
    confidence: "medium" as Candidate["confidence"],
    normalizedValue: displayValue.toLowerCase(),
    displayValue,
    occurrenceIds: Array.from({ length: occurrences }, (_, i) => `occ-${nextId}-${i}`),
  };
}
function typed(displayValue: string, detectedType: string): Candidate {
  const c = person(displayValue);
  return { ...c, detectedType };
}
function detectionOf(candidates: Candidate[]): DetectionResult {
  return { schemaVersion: 1, candidates, occurrences: [] };
}
const emptyQuality: QualityResult = {
  schemaVersion: 1,
  evidenceByCandidate: {},
  scoreByCandidate: {},
  recommendationByCandidate: {},
  assessmentByCandidate: {},
} as unknown as QualityResult;

console.log("--- normalization policy ---");
check('"N.S.C." -> "nsc" (periods removed as characters)', normalizeFullValue("N.S.C.") === "nsc");
check('"California State University, Los Angeles" -> comma becomes space, case folds', normalizeFullValue("California State University, Los Angeles") === "california state university los angeles");
check('"Cal-State  LA" -> hyphen to space, whitespace collapsed', normalizeFullValue("Cal-State  LA") === "cal state la");
check("distinctions preserved: '&' is not 'and'; stopwords survive", normalizeFullValue("A & B") !== normalizeFullValue("A and B") && normalizeFullValue("University of X") !== normalizeFullValue("University X"));
check("Unicode NFKC folds compatibility forms", normalizeFullValue("ＮＳＣ") === "nsc");

console.log("--- built-in dataset + bidirectional lookup (case 4) ---");
const builtIn = loadFullValueAliasProvider();
check("built-in dataset loads with zero warnings, 7 rows", builtIn.warnings.length === 0 && builtIn.acceptedRowCount === 7, builtIn.warnings.join("; "));
check("bidirectional: nsc -> clearinghouse (5) and clearinghouse -> nsc (5)", builtIn.provider.strengthBetween("nsc", "national student clearinghouse") === 5 && builtIn.provider.strengthBetween("national student clearinghouse", "nsc") === 5);
check("one acronym, multiple expansions in the data: nsc relates to BOTH clearinghouse (5) and safety council (3)", builtIn.provider.relationsOf("nsc").length === 2 && builtIn.provider.strengthBetween("nsc", "national safety council") === 3);
check("curated kind drives the label (acronym vs alias rows)", builtIn.provider.relationsOf("cal state la").some((r) => r.label === "Alias") && builtIn.provider.relationsOf("nsc").every((r) => r.label === "Acronym"));

console.log("--- confidence policy (documented, exact) ---");
check("full-value penalties: 5->5, 4->10, 3->15, 2->20, 1->25 (steeper than name-token 24-4s)", ([5, 4, 3, 2, 1] as RelationStrength[]).map(fullValueStrengthPenalty).join(",") === "5,10,15,20,25");

console.log("--- case 1-3: NSC + National Student Clearinghouse ---");
{
  nextId = 0;
  const candidates = [person("National Student Clearinghouse", 3), person("NSC", 5)];
  const bare = new RegexEntityResolutionEngine().propose(detectionOf(candidates), emptyQuality);
  const augmented = new RegexEntityResolutionEngine([builtIn.provider]).propose(detectionOf(candidates), emptyQuality);
  check("case 5: bare engine output is pre-feature (no proposals, no evidence anywhere)", bare.ambiguityProposals.length === 0 && !JSON.stringify(bare).includes('"evidence"'));
  check("case 1: exactly ONE ambiguity proposal is generated", augmented.ambiguityProposals.length === 1, `got ${augmented.ambiguityProposals.length}`);
  const proposal = augmented.ambiguityProposals[0];
  check("direction: the acronym (shorter value) asks -- proposal belongs to NSC", proposal?.candidateId.includes("nsc") === true, proposal?.candidateId);
  const option = proposal?.candidateGroupOptions[0];
  check("the option offers the full name's anchor", option?.canonicalName === "National Student Clearinghouse");
  check("case 2: no automatic merge -- entity groups unchanged from bare", JSON.stringify(augmented.entityGroupProposals) === JSON.stringify(bare.entityGroupProposals));
  check(
    'case 3: evidence line reads Acronym: "NSC" ↔ "National Student Clearinghouse" (Strength 5 — Established)',
    option?.evidence?.[0] === 'Acronym: "NSC" ↔ "National Student Clearinghouse" (Strength 5 — Established)',
    option?.evidence?.[0]
  );
  check("confidence: anchor 95 - 5 (Strength 5 full-value penalty) = 90", option?.confidence === 90, `got ${option?.confidence}`);
}

console.log("--- case 7: multiple expansions produce alternatives, never a choice ---");
{
  nextId = 0;
  const candidates = [person("National Student Clearinghouse", 3), person("National Safety Council", 2), person("NSC", 5)];
  const augmented = new RegexEntityResolutionEngine([builtIn.provider]).propose(detectionOf(candidates), emptyQuality);
  const proposal = augmented.ambiguityProposals.find((p) => p.candidateId.includes("nsc"));
  check("NSC's ONE proposal carries BOTH expansions as options", proposal?.candidateGroupOptions.length === 2, `got ${proposal?.candidateGroupOptions.length}`);
  const names = proposal?.candidateGroupOptions.map((o) => o.canonicalName) ?? [];
  check("both expansions present; ordered by confidence (S5's 90 before S3's 80), not by occurrence order", names[0] === "National Student Clearinghouse" && names[1] === "National Safety Council");
  check("strengths differ per expansion (90 vs 95-15=80) -- reviewer sees ranked alternatives, nothing auto-selected", proposal?.candidateGroupOptions[0]?.confidence === 90 && proposal?.candidateGroupOptions[1]?.confidence === 80);
}

console.log("--- case 8: transitivity policy (direct edges only) ---");
{
  nextId = 0;
  const candidates = [person("California State University, Los Angeles", 2), person("Cal State LA", 2), person("CSULA", 3)];
  const augmented = new RegexEntityResolutionEngine([builtIn.provider]).propose(detectionOf(candidates), emptyQuality);
  const csula = augmented.ambiguityProposals.find((p) => p.candidateId.includes("csula"));
  const calStateLa = augmented.ambiguityProposals.find((p) => p.candidateId.includes("cal-state-la"));
  // NOTE (disclosed pipeline behavior): the port's displayName() applies
  // its person-name comma reversal to the org name, so the ANCHOR'S
  // canonical label is "Los Angeles California State University" -- the
  // EVIDENCE line, by design, quotes the document's own written form.
  const proposesFullName = (p: typeof csula) =>
    p?.candidateGroupOptions.some((o) => o.evidence?.some((line) => line.includes('"California State University, Los Angeles"'))) === true;
  check("CSULA proposes the full university name (direct edge; evidence quotes the document form)", proposesFullName(csula));
  check("CSULA ALSO proposes Cal State LA -- because a DIRECT dataset edge exists, not via closure", csula?.candidateGroupOptions.some((o) => o.canonicalName === "Cal State LA") === true);
  check("Cal State LA proposes the full name (direct edge; it is the shorter side)", proposesFullName(calStateLa));

  // The closure counter-example: a provider with the SAME two full-name
  // edges but NO direct CSULA~Cal State LA edge must NOT relate them.
  const noDirect = loadFullValueAliasProvider(
    "value_a|value_b|kind|score\nCSULA|California State University, Los Angeles|acronym|5\nCal State LA|California State University, Los Angeles|alias|5\n",
    "test"
  ).provider;
  nextId = 0;
  const augmented2 = new RegexEntityResolutionEngine([noDirect]).propose(
    detectionOf([person("California State University, Los Angeles", 2), person("Cal State LA", 2), person("CSULA", 3)]),
    emptyQuality
  );
  const csula2 = augmented2.ambiguityProposals.find((p) => p.candidateId.includes("csula"));
  check("without the direct edge, CSULA does NOT propose Cal State LA -- no transitive closure through the shared target", csula2 !== undefined && csula2.candidateGroupOptions.every((o) => o.canonicalName !== "Cal State LA"));
  check("...while both still propose the shared full name (chains converge only through direct targets)", proposesFullName(csula2));
}

console.log("--- case 9: punctuation variants per normalization policy ---");
{
  nextId = 0;
  const candidates = [person("National Student Clearinghouse", 3), person("N.S.C.", 2)];
  const augmented = new RegexEntityResolutionEngine([builtIn.provider]).propose(detectionOf(candidates), emptyQuality);
  const proposal = augmented.ambiguityProposals.find((p) => p.candidateId.includes("n-s-c"));
  check('"N.S.C." normalizes to "nsc" and proposes the full name exactly like "NSC"', proposal?.candidateGroupOptions[0]?.canonicalName === "National Student Clearinghouse");
  check("evidence shows the document's own spelling, not the normalized form", Boolean(proposal?.candidateGroupOptions[0]?.evidence?.[0]?.includes('"N.S.C."')));
}

console.log("--- eligibility: typed identifiers are never compared ---");
{
  nextId = 0;
  // A phone number whose normalized value collides with a dataset value
  // could only mis-propose if typed candidates were eligible -- they are
  // not.
  const candidates = [person("National Student Clearinghouse", 2), typed("NSC", "cin"), typed("nsc@example.edu", "email")];
  const augmented = new RegexEntityResolutionEngine([builtIn.provider]).propose(detectionOf(candidates), emptyQuality);
  check("cin/email candidates produce no full-value proposals (person-type only)", augmented.ambiguityProposals.length === 0, `got ${augmented.ambiguityProposals.length}`);
}

console.log("--- interaction with existing groups: already-same-entity is skipped ---");
{
  nextId = 0;
  // Two spellings of the full name form a realized group; a hypothetical
  // dataset row relating them must not re-propose what grouping already
  // settled.
  const sameEntity = loadFullValueAliasProvider(
    "value_a|value_b|kind|score\nNational Student Clearinghouse|Natl Student Clearinghouse|alias|5\n",
    "test"
  ).provider;
  const candidates = [person("National Student Clearinghouse", 3), person("Natl Student Clearinghouse", 1)];
  const augmented = new RegexEntityResolutionEngine([sameEntity]).propose(detectionOf(candidates), emptyQuality);
  const grouped = augmented.entityGroupProposals.some((g) => g.candidateIds.length === 2);
  check("the two spellings share a deterministic bucket and simply group", grouped);
  check("no alias proposal duplicates the realized group", augmented.ambiguityProposals.length === 0, `got ${augmented.ambiguityProposals.length}`);
}

console.log("--- cases 10-11: reviewer flow, persistence, no unresolved duplicates ---");
{
  nextId = 0;
  const candidates = [person("National Student Clearinghouse", 3), person("NSC", 5)];
  const detection = detectionOf(candidates);
  const augmented = new RegexEntityResolutionEngine([builtIn.provider]).propose(detection, emptyQuality);
  const proposal = augmented.ambiguityProposals[0]!;
  const nscId = proposal.candidateId;
  const groupId = proposal.candidateGroupOptions[0]!.groupId;
  const context = { detection, grouping: augmented };
  let session = createReviewSession("s1", "doc1", "2026-07-30T00:00:00.000Z");
  const outcome = applyReviewCommand(session, { family: "review", type: "linkAmbiguousCandidate", candidateId: nscId, groupId }, context, "2026-07-30T00:00:01.000Z");
  check("case 10: linkAmbiguousCandidate accepts the full-value proposal through the EXISTING flow", outcome.result.ok === true);
  session = outcome.session;
  check("...recording the ordinary Keep decision + ambiguityResolutions entry (existing persistence, decision-reuse-exportable)", session.candidateDecisions[nscId]?.decision === "Keep" && session.ambiguityResolutions[nscId]?.resolvedGroupId === groupId);
  check("case 11: the resolved proposal's item now reads RESOLVED -- it cannot reappear as an unresolved duplicate", Object.keys(session.candidateDecisions).includes(nscId));
}

console.log("--- case 12 + 6: Phase 1 name-token behavior unchanged; parity suite runs in the battery ---");
{
  const nameProvider = loadRelatedNameProvider("full_name,related_name,score\nandrew,andy,5\n", "test").provider;
  nextId = 0;
  const fix = () => [person("Andrew Goodloe", 3), person("Andy")];
  nextId = 0;
  const nameOnly = new RegexEntityResolutionEngine([nameProvider]).propose(detectionOf(fix()), emptyQuality);
  nextId = 0;
  const both = new RegexEntityResolutionEngine([nameProvider, builtIn.provider]).propose(detectionOf(fix()), emptyQuality);
  check("adding the full-value provider changes nothing about Phase 1's name-token results", JSON.stringify(nameOnly) === JSON.stringify(both));
}

console.log(`\n${passCount}/${passCount + failCount} checks passed`);
process.exitCode = failCount === 0 ? 0 : 1;
