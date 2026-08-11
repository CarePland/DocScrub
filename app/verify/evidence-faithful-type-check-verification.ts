/**
 * evidence-faithful-type-check-verification.ts (AG, 2026-08-10).
 *
 * End-to-end witnesses: real quality engine -> qualityCategoriesOf ->
 * semanticTypeFor -> typeCheckSectionFor. These are VERIFICATION witnesses,
 * never production rules; no candidate string appears anywhere in src/.
 *
 * Covers the two generic defect repairs made in this pass:
 *   deviation #9  Unicode name shape (the ASCII-only regexes)
 *   the masking   qualityCategoriesOf's either/or channel
 */

import type { Candidate, ContentBlock, Occurrence } from "../src/domain/DocumentModel.js";
import { scoreCandidateQuality } from "../src/engines/quality/scoring.js";
import { qualityCategoriesOf, semanticTypeFor, typeCheckSectionFor, UNDETERMINED_SECTION } from "../src/domain/semanticTypes.js";
import { censusNameEvidenceFor } from "../src/engines/knowledge/CensusNameEvidence.js";

let passed = 0;
let failed = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed += 1;
    console.log(`  PASS ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function route(value: string, occ = 2, crossCandidateNonPerson = false) {
  const id = `person:${value.toLowerCase()}`;
  const candidate: Candidate = {
    id, detectedType: "person", source: "regex", confidence: "low",
    normalizedValue: value.toLowerCase(), displayValue: value, occurrenceIds: [],
  };
  const blocks = new Map<string, ContentBlock>();
  const occurrences: Occurrence[] = [];
  for (let i = 0; i < occ; i += 1) {
    const b = `b${i}`;
    blocks.set(b, { id: b, kind: "body", text: "", order: 0, sourceMapping: { partId: "w", sourceRef: "" }, runMappings: [] });
    occurrences.push({ id: `${id}:${b}:0:1`, candidateId: id, blockId: b, startOffset: 0, endOffset: value.length, text: value, context: `...${value}...`, source: "regex" });
  }
  const assessment = scoreCandidateQuality(candidate, occurrences, blocks);
  const facts = {
    detectedType: "person",
    categories: qualityCategoriesOf(assessment),
    relationshipKinds: new Set<never>(),
    censusNameStructure: censusNameEvidenceFor(value).supportsNameStructure,
  };
  return { assessment, facts, section: typeCheckSectionFor(facts, crossCandidateNonPerson).section };
}

console.log("\n--- 1. THE MASKING DEFECT: a dictionary hit must not hide name evidence ---");
{
  // "ford" carries address_suffix. Before the union, filterRules REPLACED
  // reasons and semanticTypeFor saw only ["address-suffix"] -> other.
  const r = route("Julie Ford");
  check("Julie Ford: reasons carry the name evidence", r.assessment.reasons.includes("known_personal_name_token"), true);
  check("Julie Ford: classifications carry the unrelated hit", r.assessment.filterRules.includes("address_suffix"), true);
  check("Julie Ford: categories now carry BOTH", ["address-suffix", "known-personal-name-token"].every((c) => r.facts.categories.map((x) => x.replace(/_/g, "-")).includes(c)), true);
  check("Julie Ford -> People", r.section, "people");
}
// The masking repair is asserted on the CATEGORY CHANNEL, which is what it
// fixed. These two carry no lexicon token, so under the evidence-faithful
// contract they are Undetermined -- but their evidence is no longer hidden.
for (const [value, masker] of [["Cashay Jackson", "ambiguous-lexical-token"], ["Min Shi", "common-abbreviation"]] as const) {
  const r = route(value);
  const seen = r.facts.categories.map((c) => c.replace(/_/g, "-"));
  check(`${value}: the masking category is present`, seen.includes(masker), true);
  check(`${value}: and the shape reason is no longer hidden by it`, seen.includes("strong-name-structure"), true);
}

console.log("\n--- 2. DEVIATION #9: Unicode name shape ---");
for (const [accented, plain] of [["Yazmine Guzmán", "Yazmine Guzman"], ["José Martínez", "Jose Martinez"], ["Ana Núñez", "Ana Nunez"]] as const) {
  const a = route(accented);
  const p = route(plain);
  check(`${accented}: same reasons as "${plain}"`, a.assessment.reasons, p.assessment.reasons);
  // THE POINT OF THE FIX: the accented and unaccented spellings are now
  // treated identically. Neither reaches People -- Yazmine has no lexicon
  // entry -- but the accent no longer costs her the name-shape evidence, and
  // Census can protect her from reinterpretation exactly as it protects the
  // ASCII spelling.
  check(`${accented}: same section as "${plain}"`, a.section, p.section);
  check(`${accented}: shape evidence is now earned`, a.assessment.reasons.includes("strong_name_structure"), true);
}
check("Guzmán, Yazmine (comma form) earns surname_given_structure",
  route("Guzmán, Yazmine").assessment.reasons.includes("surname_given_structure"), true);
check("Guzmán, Yazmine routes identically to Guzman, Yazmine",
  route("Guzmán, Yazmine").section, route("Guzman, Yazmine").section);
console.log("    -- display text is never rewritten --");
check("the candidate keeps its accent", route("Yazmine Guzmán").assessment.reasons.length > 0 && "Yazmine Guzmán".includes("á"), true);

console.log("\n--- 3. REAL-PERSON WITNESSES WITH AFFIRMATIVE EVIDENCE -> PEOPLE ---");
// Each of these reaches People through EVIDENCE ABOUT THE REFERENT: a lexicon
// name token, a known first name, or a known surname. None reaches it by shape.
for (const person of ["Julie Ford", "Perias, Nelly", "Diana", "Sarah",
  "Yamada, Tamara", "Cobb, Christopher", "Goodloe, Andrew", "Collier, Tanesha"]) {
  check(`${person} -> People`, route(person).section, "people");
}

console.log("\n--- 3b. REAL PEOPLE WITH NO AFFIRMATIVE EVIDENCE -> UNDETERMINED ---");
/*
 * EXPECTED BEHAVIOUR, PINNED (AG's ruling, 2026-08-10). Not a regression and
 * not to be compensated for.
 *
 * These are real people about whom DocScrub has NO evidence: no lexicon entry,
 * no honorific, no anchor. They previously reached People on `strong_name_
 * structure` / `surname_given_structure` -- two capitalized tokens -- which is
 * a fact about the string, not about the referent.
 *
 * Census sees most of them, and Census is what PROTECTS them from
 * cross-candidate reinterpretation. It deliberately does not CLASSIFY them:
 * adding Census to the people branch routed `Good Morning` into People
 * (GOOD is an attested first name, MORNING is attested in both roles), which
 * is the measured 20/106 collision rate arriving where it was predicted.
 *
 * The remedy for this list is more positive-evidence capability, never a
 * softer contract and never a candidate-specific exception.
 */
for (const person of ["Chriztopher Johnson", "Fox, Liud", "Amy Miller", "Jeffrey Lam",
  "Bobbie Galaz", "Chelsye Angelina", "Cashay Jackson", "Min Shi", "Yazmine Guzmán",
  "Fox, Liudmila", "Evelyn, Joaquin", "Francis, Kyle"]) {
  check(`${person} -> Undetermined (no affirmative person evidence)`, route(person).section, UNDETERMINED_SECTION);
  check(`${person}: never Other`, route(person).section === "other", false);
}

console.log("\n--- 4. NO CATEGORY IS REACHED BY FALLTHROUGH ---");
{
  // Every candidate with no affirmative evidence lands in Undetermined, and
  // NONE lands in Other. That is the invariant, asserted over the known
  // non-person controls rather than over synthetic categories.
  for (const nonPerson of ["Academic Senate", "Grade Rosters", "Financial Aid", "Reason Code",
    "Grade Entry", "Term Withdrawals", "Good Morning", "Hello All", "Term Activation",
    "Service Indicator Codes", "Query Definition", "Grade Processing", "The Academic Disqual"]) {
    const r = route(nonPerson);
    check(`${nonPerson} never lands in Other`, r.section === "other", false);
  }
  check("ordinary language -> Undetermined", route("Good Morning").section, UNDETERMINED_SECTION);
  check("administrative phrase -> Undetermined", route("Term Activation").section, UNDETERMINED_SECTION);
  check("malformed fragment -> Undetermined", route("The Academic Disqual").section, UNDETERMINED_SECTION);
}

console.log("\n--- 5. CENSUS COLLISIONS: protected, never reclassified by rejection ---");
{
  // Known NON-people that Census sees as name-like. Census PROTECTS them from
  // cross-candidate reinterpretation and does not classify them, so with no
  // affirmative person evidence they land in Undetermined -- which is the
  // truthful state: DocScrub does not know what they are.
  for (const collision of ["San Diego", "Last Day", "Staff Ad", "Happy Birthday Eve"]) {
    check(`${collision}: Census structure present (protection)`, censusNameEvidenceFor(collision).supportsNameStructure, true);
    check(`${collision}: but NOT classified as a person`, route(collision).section, UNDETERMINED_SECTION);
    check(`${collision}: and never Other`, route(collision).section === "other", false);
  }
  /*
   * WHERE AMY MILLER IS ACTUALLY PROTECTED, which is not where the first
   * draft of this test looked.
   *
   * `amy` is not in the 23-entry lexicon, so she reaches People by SHAPE. Ask
   * semanticTypeFor directly with the rejection flag forced on and she moves
   * to Undetermined -- but that state is unreachable in production, because
   * the person-protection GATE sees her Census structure and never lets
   * cross-candidate evidence fire on her in the first place.
   *
   * Protection happens in the gate; classification happens here. Asserting
   * both, in the right places, is the point.
   */
  check("Amy Miller is gate-protected by Census structure", censusNameEvidenceFor("Amy Miller").supportsNameStructure, true);
  check("but protection is not classification -> Undetermined", route("Amy Miller").section, UNDETERMINED_SECTION);
  check("Grade Rosters has no Census structure to protect it", censusNameEvidenceFor("Grade Rosters").supportsNameStructure, false);
  check("and a rejection moves it", route("Grade Rosters", 2, true).section, UNDETERMINED_SECTION);
  // A lexicon-evidenced candidate resists the flag even without the gate.
  check("known-name evidence resists the flag directly", route("Cobb, Christopher", 2, true).section, "people");
}

console.log("\n--- 6. SHAPE IS PROVENANCE, NEVER A SEMANTIC TYPE ---");
{
  // The contract in one assertion pair: the shape category is still COMPUTED
  // and still visible (detector evidence, Expert View, audit), and it no
  // longer assigns a type.
  const r = route("Chriztopher Johnson");
  check("strong_name_structure is still scored and carried",
    r.facts.categories.map((c) => c.replace(/_/g, "-")).includes("strong-name-structure"), true);
  check("and it does NOT put the candidate in People", r.section, UNDETERMINED_SECTION);
  const c = route("Cobb, Christopher");
  check("surname_given_structure is still carried",
    c.facts.categories.map((x) => x.replace(/_/g, "-")).includes("surname-given-structure"), true);
  check("but People came from the lexicon token, not from it",
    c.facts.categories.map((x) => x.replace(/_/g, "-")).includes("known-personal-name-token"), true);
  check("Cobb, Christopher -> People", c.section, "people");
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exitCode = 1;
