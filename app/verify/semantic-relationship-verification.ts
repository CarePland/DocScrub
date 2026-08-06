/**
 * semantic-relationship-verification.ts -- Deterministic Semantic
 * Relationship Knowledge (2026-07-30). Covers: the related-name loader
 * (validation, normalization, bidirectionality, graceful failure), the
 * built-in dataset's integrity, the augmentation pass (short-reference
 * related-name options, cross-bucket same-surname proposals, evidence
 * lines, proportional strength penalties, one-sided proposing), and the
 * PARITY GUARANTEE: a bare engine's output is byte-identical with the
 * feature present (the knowledge layer sits strictly above the oracle
 * surface -- see semantic-augmentation.ts).
 *
 * NOT coverable here (browser-only, disclosed): the Possible-identities
 * evidence rendering and the linkAmbiguousCandidate click-through.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/semantic-relationship-verification.ts
 */

import { loadRelatedNameProvider } from "../src/engines/knowledge/RelatedNameProvider.js";
import type { RelationStrength, SemanticRelationshipProvider } from "../src/engines/knowledge/SemanticRelationshipProvider.js";
import { strengthPenalty } from "../src/engines/entity-resolution/semantic-augmentation.js";
import { RegexEntityResolutionEngine } from "../src/engines/EntityResolutionEngine.js";
import type { DetectionResult } from "../src/engines/DetectionEngine.js";
import type { Candidate } from "../src/domain/DocumentModel.js";
import type { QualityResult } from "../src/domain/Evidence.js";

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

console.log("--- built-in dataset load ---");
const builtIn = loadRelatedNameProvider();
check("built-in dataset loads with zero warnings", builtIn.warnings.length === 0, builtIn.warnings.slice(0, 3).join("; "));
check("all 2708 curated rows accepted", builtIn.acceptedRowCount === 2708, `got ${builtIn.acceptedRowCount}`);
check("bidirectional: andrew -> andy (5) and andy -> andrew (5)", builtIn.provider.strengthBetween("andrew", "andy") === 5 && builtIn.provider.strengthBetween("andy", "andrew") === 5);
check("spec examples: andrew~drew = 5, andrew~randy = 1", builtIn.provider.strengthBetween("andrew", "drew") === 5 && builtIn.provider.strengthBetween("randy", "andrew") === 1);
check("unknown term relates to nothing", builtIn.provider.relationsOf("zzyzx").length === 0);
check("relationsOf ordering is deterministic (strength desc, then term)", (() => {
  const rels = builtIn.provider.relationsOf("andy");
  const sorted = [...rels].sort((a, b) => b.strength - a.strength || (a.term < b.term ? -1 : 1));
  return JSON.stringify(rels) === JSON.stringify(sorted) && rels.length > 0;
})());

console.log("--- loader validation / graceful failure ---");
const messy = loadRelatedNameProvider(
  "full_name,related_name,score\nAndrew, Andy ,5\nbroken,row\nempty,,3\nbad,score,9\nself,self,4\nrobert,bob,4\n",
  "test"
);
check("case/whitespace normalized (Andrew~andy accepted)", messy.provider.strengthBetween("andrew", "andy") === 5);
check("malformed rows skipped with one warning each (field count, empty name, bad score, self-relation)", messy.warnings.length === 4, messy.warnings.join(" | "));
check("valid rows around the malformed ones still load", messy.provider.strengthBetween("bob", "robert") === 4 && messy.acceptedRowCount === 2);
const badHeader = loadRelatedNameProvider("nope,nope,nope\na,b,5\n", "test");
check("wrong header disables the library gracefully (empty provider + warning)", badHeader.acceptedRowCount === 0 && badHeader.warnings.length > 0 && badHeader.provider.relationsOf("a").length === 0);
const dupes = loadRelatedNameProvider("full_name,related_name,score\nann,annie,2\nannie,ann,4\n", "test");
check("duplicate pairs keep the strongest strength (deterministic merge)", dupes.provider.strengthBetween("ann", "annie") === 4);

console.log("--- strength penalty is linear and monotonic ---");
check("penalties: 5->4, 4->8, 3->12, 2->16, 1->20", ([5, 4, 3, 2, 1] as RelationStrength[]).map(strengthPenalty).join(",") === "4,8,12,16,20");

// ---- augmentation fixtures ------------------------------------------------
let nextId = 0;
function person(displayValue: string, occurrences = 1): Candidate {
  nextId += 1;
  return {
    id: `cand-${String(nextId).padStart(2, "0")}-${displayValue.toLowerCase().replace(/[^a-z]+/g, "-")}`,
    detectedType: "person",
    source: "regex",
    confidence: "medium" as Candidate["confidence"],
    normalizedValue: displayValue.toLowerCase(),
    displayValue,
    occurrenceIds: Array.from({ length: occurrences }, (_, i) => `occ-${nextId}-${i}`),
  };
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

const testProvider: SemanticRelationshipProvider = loadRelatedNameProvider(
  "full_name,related_name,score\nandrew,andy,5\nandrew,drew,5\nandrew,randy,1\n",
  "test-dataset"
).provider;

console.log("--- PASS A: short reference gains related-name anchor options ---");
{
  nextId = 0;
  const candidates = [person("Andrew Goodloe", 3), person("Andy")];
  const bare = new RegexEntityResolutionEngine().propose(detectionOf(candidates), emptyQuality);
  const augmented = new RegexEntityResolutionEngine([testProvider]).propose(detectionOf(candidates), emptyQuality);
  check("bare engine: 'Andy' has no anchor (exact token mismatch)", bare.ambiguityProposals.length === 0);
  const proposal = augmented.ambiguityProposals.find((p) => p.candidateId.includes("andy"));
  check("with knowledge: 'Andy' gains an identity proposal for Andrew Goodloe", proposal?.candidateGroupOptions[0]?.canonicalName === "Andrew Goodloe");
  const option = proposal?.candidateGroupOptions[0];
  check(
    "option evidence names the relationship, strength, and label",
    Boolean(option?.evidence?.some((line) => line.includes('"andy" ↔ "andrew"') && line.includes("Strength 5") && line.includes("Established")))
  );
  // anchor confidence for the solitary full name: memberScore(identical) =
  // 70 + 25 = 95 (medium confidence, Possible quality) -> minus 4 (S5).
  check("confidence = anchor 95 - 4 (Strength 5 penalty) = 91", option?.confidence === 91, `got ${option?.confidence}`);
}

console.log("--- PASS A: exact-match options gain explanatory evidence; strengths rank proportionally ---");
{
  nextId = 0;
  const candidates = [person("Andrew Goodloe", 3), person("Randy")];
  const augmented = new RegexEntityResolutionEngine([testProvider]).propose(detectionOf(candidates), emptyQuality);
  const randy = augmented.ambiguityProposals.find((p) => p.candidateId.includes("randy"));
  check("'Randy' (Strength 1) still proposes -- speculative but visible, reviewer decides", randy !== undefined);
  check("Strength 1 penalty: confidence = 95 - 20 = 75 (proportionally below Strength 5's 91)", randy?.candidateGroupOptions[0]?.confidence === 75, `got ${randy?.candidateGroupOptions[0]?.confidence}`);

  nextId = 0;
  const exact = [person("Andrew Goodloe", 3), person("Andrew")];
  const augmentedExact = new RegexEntityResolutionEngine([testProvider]).propose(detectionOf(exact), emptyQuality);
  const bareExact = new RegexEntityResolutionEngine().propose(detectionOf(exact), emptyQuality);
  const exactOption = augmentedExact.ambiguityProposals[0]?.candidateGroupOptions[0];
  check("a port-produced exact match keeps its port confidence, unpenalized", exactOption?.confidence === bareExact.ambiguityProposals[0]?.candidateGroupOptions[0]?.confidence);
  check('...and gains the "Exact first-name match" evidence line', Boolean(exactOption?.evidence?.some((line) => line.includes("Exact first-name match"))));
}

console.log("--- PASS B: cross-bucket full names (Drew Goodloe ↔ Andrew Goodloe) ---");
{
  nextId = 0;
  const candidates = [person("Andrew Goodloe", 5), person("Drew Goodloe", 1)];
  const bare = new RegexEntityResolutionEngine().propose(detectionOf(candidates), emptyQuality);
  const augmented = new RegexEntityResolutionEngine([testProvider]).propose(detectionOf(candidates), emptyQuality);
  check("bare engine cannot relate them (different buckets, no proposals)", bare.ambiguityProposals.length === 0);
  check("with knowledge: exactly ONE proposal (the less-attested side asks; no mirrored duplicate)", augmented.ambiguityProposals.length === 1, `got ${augmented.ambiguityProposals.length}`);
  const proposal = augmented.ambiguityProposals[0];
  check("the proposal belongs to 'Drew Goodloe' (fewer supporting occurrences... same members, lower confidence side)", proposal?.candidateId.includes("drew") === true, proposal?.candidateId);
  const option = proposal?.candidateGroupOptions[0];
  check("its option offers the Andrew Goodloe anchor", option?.canonicalName === "Andrew Goodloe");
  check(
    "evidence: same surname + the related-name relationship, each line independently checkable",
    Boolean(option?.evidence?.[0]?.includes('Same surname ("goodloe")') && option?.evidence?.[1]?.includes('"drew" ↔ "andrew"'))
  );
  check("no automatic merge: the two names remain separate candidates/groups; only a proposal exists", augmented.entityGroupProposals.every((g) => !(g.candidateIds.length > 1 && g.canonicalName === "Andrew Goodloe")));
}

console.log("--- same-bucket names need no knowledge (already deterministic) ---");
{
  nextId = 0;
  const candidates = [person("Andrew Goodloe", 3), person("Andy Goodloe", 2)];
  const augmented = new RegexEntityResolutionEngine([testProvider]).propose(detectionOf(candidates), emptyQuality);
  check("'Andy Goodloe' + 'Andrew Goodloe' share a bucket and simply group -- no ambiguity proposal added", augmented.entityGroupProposals.length === 1 && augmented.ambiguityProposals.length === 0);
}

console.log("--- PARITY GUARANTEE: bare engine is byte-identical with the feature present ---");
{
  nextId = 0;
  const candidates = [person("Andrew Goodloe", 3), person("Andy"), person("Drew Goodloe", 1), person("Maria Alvarez", 2), person("Maria")];
  const bareA = new RegexEntityResolutionEngine().propose(detectionOf(candidates), emptyQuality);
  nextId = 0;
  const candidatesAgain = [person("Andrew Goodloe", 3), person("Andy"), person("Drew Goodloe", 1), person("Maria Alvarez", 2), person("Maria")];
  const bareB = new RegexEntityResolutionEngine().propose(detectionOf(candidatesAgain), emptyQuality);
  check("bare output is stable and carries NO evidence fields anywhere", JSON.stringify(bareA) === JSON.stringify(bareB) && !JSON.stringify(bareA).includes('"evidence"'));
  const augmented = new RegexEntityResolutionEngine([testProvider]).propose(detectionOf(candidates), emptyQuality);
  check("augmentation never touches entity groups (identity proposals only)", JSON.stringify(augmented.entityGroupProposals) === JSON.stringify(bareA.entityGroupProposals));
  check("augmentation preserves the port's own options ahead of knowledge-derived ones", (() => {
    const maria = augmented.ambiguityProposals.find((p) => p.candidateId.includes("maria") && !p.candidateId.includes("alvarez"));
    const bareMaria = bareA.ambiguityProposals.find((p) => p.candidateId.includes("maria") && !p.candidateId.includes("alvarez"));
    return maria !== undefined && bareMaria !== undefined && maria.candidateGroupOptions[0]?.groupId === bareMaria.candidateGroupOptions[0]?.groupId;
  })());
}

console.log(`\n${passCount}/${passCount + failCount} checks passed`);
process.exitCode = failCount === 0 ? 0 : 1;
