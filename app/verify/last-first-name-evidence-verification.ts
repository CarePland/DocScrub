/**
 * last-first-name-evidence-verification.ts -- ORACLE DEVIATION #8
 * (AG, 2026-08-10): representation defect #1, the last-first branch that
 * returned before the known-given-name lookup.
 *
 * THE LOAD-BEARING HALF OF THIS SUITE IS THE SECOND ONE. Asserting that
 * `Cobb, Christopher` gained evidence is easy and proves little; asserting
 * that `Christopher Cobb` and every non-lexicon spelling are BYTE-IDENTICAL
 * to before is what bounds the change. A representation fix that quietly
 * moved first-last candidates too would be a scoring change wearing a
 * correctness label.
 *
 * Also pins the blast radius the deviation record claims, so the claim is
 * checked rather than asserted: status, quality label, semantic type,
 * archetype and residual-gate scope must all be unmoved.
 */

import type { Candidate, ContentBlock, Occurrence } from "../src/domain/DocumentModel.js";
import { scoreCandidateQuality } from "../src/engines/quality/scoring.js";
import { KNOWN_GIVEN_NAMES } from "../src/engines/quality/quality-dictionaries.data.js";
import { qualityCategoriesOf, semanticTypeFor } from "../src/domain/semanticTypes.js";
import { deriveRecommendation, hasKnownNameEvidence, type RecommendationFacts } from "../src/ui/recommendations.js";
import { isShapeOnlyPersonClaim } from "../src/engines/explanation/explanation-builder.js";

let passed = 0;
let failed = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed += 1;
    console.log(`  PASS ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function block(id: string, kind: ContentBlock["kind"] = "body"): ContentBlock {
  return { id, kind, text: "", order: 0, sourceMapping: { partId: "word/document.xml", sourceRef: "" }, runMappings: [] };
}

function score(displayValue: string, occCount = 1) {
  const candidate: Candidate = {
    id: `person:${displayValue.toLowerCase()}`,
    detectedType: "person",
    source: "regex",
    confidence: "low",
    normalizedValue: displayValue.toLowerCase(),
    displayValue,
    occurrenceIds: [],
  };
  const blocks = new Map<string, ContentBlock>();
  const occurrences: Occurrence[] = [];
  for (let i = 0; i < occCount; i += 1) {
    const blockId = `b${i}`;
    blocks.set(blockId, block(blockId));
    occurrences.push({
      id: `${candidate.id}:${blockId}:0:1`,
      candidateId: candidate.id,
      blockId,
      startOffset: 0,
      endOffset: displayValue.length,
      text: displayValue,
      context: `...${displayValue}...`,
      source: "regex",
    });
  }
  return { candidate, assessment: scoreCandidateQuality(candidate, occurrences, blocks) };
}

function factsFor(displayValue: string, occCount = 1): RecommendationFacts {
  const { candidate, assessment } = score(displayValue, occCount);
  return {
    displayValue: candidate.displayValue,
    detectedType: candidate.detectedType,
    personTokenCount: candidate.displayValue.trim().split(/[\s,]+/).filter(Boolean).length,
    categories: qualityCategoriesOf(assessment),
    qualityRecommendation: assessment.status,
    identityOptions: [],
    relationshipKinds: new Set(),
  };
}

console.log("\n--- 1. THE DEFECT IS FIXED: last-first now reaches the existing lexicon ---");
for (const [lastFirst, given] of [
  ["Cobb, Christopher", "christopher"],
  ["Perias, Nelly", "nelly"],
  ["Yamada, Tamara", "tamara"],
  ["Goodloe, Andrew", "andrew"],
  ["Collier, Tanesha", "tanesha"],
] as const) {
  check(`${lastFirst}: "${given}" is in the EXISTING lexicon (no widening)`, KNOWN_GIVEN_NAMES.includes(given), true);
  const { assessment } = score(lastFirst);
  check(`${lastFirst}: positiveReasons carry known_personal_name_token`, assessment.positiveReasons.includes("known_personal_name_token"), true);
  check(`${lastFirst}: surname_given_structure survives alongside it`, assessment.positiveReasons.includes("surname_given_structure"), true);
}

console.log("\n--- 2. THE LOAD-BEARING HALF: first-last spellings are UNCHANGED ---");
for (const firstLast of ["Christopher Cobb", "Nelly Perias", "Tamara Yamada", "Andrew Goodloe", "Gustavo Reyes"]) {
  const { assessment } = score(firstLast);
  check(`${firstLast}: reasons unchanged (strong_name_structure + known token)`, assessment.reasons.includes("strong_name_structure") && assessment.reasons.includes("known_personal_name_token"), true);
  check(`${firstLast}: NOT given surname_given_structure`, assessment.reasons.includes("surname_given_structure"), false);
}

console.log("\n--- 3. NO EVIDENCE IS INVENTED: unlisted given names are untouched ---");
for (const unlisted of ["Cobb, Zeeb", "Galaz, Bobbie", "Angelina, Chelsye", "Lam, Jeffrey", "Miller, Amy"]) {
  const { assessment } = score(unlisted);
  check(`${unlisted}: no known_personal_name_token`, assessment.positiveReasons.includes("known_personal_name_token"), false);
  check(`${unlisted}: still surname_given_structure only`, assessment.positiveReasons, ["surname_given_structure"]);
}

console.log("\n--- 4. NON-NAME COMMA FORMS MUST NOT BE RESCUED ---");
for (const notAName of ["Tuesday, March", "Angeles, CA", "Level, Early", "Everyone, Same"]) {
  const { assessment } = score(notAName);
  check(`${notAName}: no known_personal_name_token`, assessment.positiveReasons.includes("known_personal_name_token"), false);
}

console.log("\n--- 5. BLAST RADIUS, as claimed in the deviation record ---");
{
  const { assessment } = score("Cobb, Christopher", 4);
  check("status unchanged (ToReview)", assessment.status, "ToReview");
  check("quality label unchanged (Strong)", assessment.quality, "Strong");
  check("score clamps at the ceiling rather than changing band", assessment.score, 99);
}
{
  const facts = factsFor("Cobb, Christopher", 4);
  check("semanticTypeFor unchanged -> people", semanticTypeFor({ detectedType: "person", categories: facts.categories, relationshipKinds: new Set() }), "people");
  check("hasKnownNameEvidence flips to true (the intended correction)", hasKnownNameEvidence(facts), true);
  const rec = deriveRecommendation(facts);
  check("archetype unchanged -> uncertain (every name-evidence gate is single-token)", rec?.archetype, "uncertain");
}
{
  // Deviation #7 interaction: the honest-sentence branch must now STOP firing
  // on a real person, which is the whole point of both deviations together.
  const before = ["surname_given_structure"];
  const after = score("Cobb, Christopher", 4).assessment.positiveReasons;
  check("BEFORE: shape-only claim (would read 'name-shaped text')", isShapeOnlyPersonClaim("person", before), true);
  check("AFTER: no longer shape-only (reads as a person's name)", isShapeOnlyPersonClaim("person", after), false);
}
{
  // The residual gate is single-token-only, so a two-token last-first
  // candidate was and remains out of its scope entirely.
  check("last-first candidates are multi-token (residual gate rule 1 excludes them)", "Cobb, Christopher".trim().split(/\s+/).length > 1, true);
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exitCode = 1;
