/**
 * gnis-place-evidence-verification.ts (AG, 2026-08-10).
 *
 * Pins the approved GNIS contract (verdict A, Policy B). The load-bearing
 * halves are the NEGATIVE ones: the assertions that fail if single-token
 * names ever gain authority, if a falsified multiplicity heuristic returns,
 * or if Policy B starts eating recognizable geography.
 */

import {
  gnisPlaceEvidenceFor,
  explainGnisPlaceEvidence,
  normalizeForGnisLookup,
  GNIS_EVIDENCE_ENTRY_COUNT,
  GNIS_EVIDENCE_SOURCE,
} from "../src/engines/knowledge/GnisPlaceEvidence.js";
import { GNIS_PLACE_KEYS } from "../src/engines/knowledge/gnis-places.data.js";
import { censusNameEvidenceFor } from "../src/engines/knowledge/CensusNameEvidence.js";
import { SEMANTIC_TYPE_ORDER, semanticTypeFor, typeCheckSectionFor } from "../src/domain/semanticTypes.js";

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

console.log("\n--- 1. GENERATED POPULATION (measured targets, not tuning inputs) ---");
{
  const keys = GNIS_PLACE_KEYS.split("\n");
  check("matchable multi-token Standard keys", keys.length, 109680);
  check("entry count constant agrees", GNIS_EVIDENCE_ENTRY_COUNT, 109680);
  check("provenance recorded", GNIS_EVIDENCE_SOURCE, "usgs-gnis/domestic-names-national");

  let strong = 0;
  let weak = 0;
  let structure = 0;
  for (const key of keys) {
    const e = gnisPlaceEvidenceFor(key);
    if (e.strength === "strong") strong += 1;
    else if (e.strength === "weak") weak += 1;
    if (e.censusPersonStructure) structure += 1;
  }
  check("Policy-B strong", strong, 108735);
  check("Policy-B downgraded", weak, 945);
  check("Census full-name structures among them", structure, 36119);
  check("every key resolves to strong or weak (none unmatched)", strong + weak, keys.length);
  // If any of the four figures moves, the SOURCE changed. Report the
  // difference before touching these numbers -- see §13 of the instruction.

  console.log("    -- exclusions, asserted structurally --");
  check("no '(historical)' key is matchable", keys.some((k) => k.includes("HISTORICAL")), false);
  check("no single-token key exists in the pack", keys.some((k) => !k.includes(" ")), false);
}

console.log("\n--- 2. NORMALIZATION: punctuation -> SPACE, accents folded ---");
for (const [raw, expected] of [
  ["Angeles, CA", "ANGELES CA"], ["O'Brien", "O BRIEN"], ["St. Helena", "ST HELENA"],
  ["Winston-Salem", "WINSTON SALEM"], ["Cañada Agua", "CANADA AGUA"], ["  san   diego  ", "SAN DIEGO"],
] as const) {
  check(`${raw} -> ${expected}`, normalizeForGnisLookup(raw), expected);
}
{
  // The contract that keeps the two normalizers apart: fusing tokens would
  // manufacture matches the source never contained.
  check("punctuation does NOT fuse tokens", normalizeForGnisLookup("Angeles, CA").includes(" "), true);
  check("accented and unaccented forms agree", normalizeForGnisLookup("Cañada"), normalizeForGnisLookup("Canada"));
  const e = gnisPlaceEvidenceFor("san diego");
  check("lookup is case-insensitive", e.strength, "strong");
  check("and reports the normalized key, not a rewritten display value", e.normalized, "SAN DIEGO");
}
console.log("    -- explicitly NOT done --");
check("no substring matching", gnisPlaceEvidenceFor("Greater San Diego Area").strength, "none");
check("no per-token matching", gnisPlaceEvidenceFor("Diego").strength, "none");
check("no edit-distance matching", gnisPlaceEvidenceFor("San Diegoo").strength, "none");

console.log("\n--- 3. STRONG PLACE WITNESSES ---");
for (const place of ["San Diego", "San Marcos", "East Bay", "Los Angeles"]) {
  check(`${place} -> STRONG`, gnisPlaceEvidenceFor(place).strength, "strong");
}

console.log("\n--- 4. NO STRONG GNIS RESULT (and the reason differs) ---");
check("Sonoma: single-token, out of the pack entirely", gnisPlaceEvidenceFor("Sonoma").strength, "none");
check("Angeles, CA: normalizes cleanly but has no Standard match", gnisPlaceEvidenceFor("Angeles, CA").strength, "none");
check("Angeles, CA did normalize (the miss is real, not a normalization bug)", normalizeForGnisLookup("Angeles, CA"), "ANGELES CA");

console.log("\n--- 5. GNIS IS SILENT ON PEOPLE ---");
for (const person of ["Amy Miller", "Jeffrey Lam", "Yazmine Guzmán", "Julie Ford",
  "Cashay Jackson", "Min Shi", "Diana", "Sarah", "Andrew", "Goodloe, Andrew"]) {
  check(`${person}: no GNIS evidence`, gnisPlaceEvidenceFor(person).strength, "none");
}

console.log("\n--- 6. GNIS IS SILENT ON HIGHER-ED / DOMAIN TERRITORY ---");
// Not a GNIS failure. These belong to the concurrent terminology channel, and
// silence here is the correct behaviour rather than a gap to close.
for (const term of ["Grade Rosters", "Academic Senate", "Financial Aid", "Reason Code",
  "Term Withdrawals", "Good Morning", "Course Catalog", "Service Indicator"]) {
  check(`${term}: no GNIS evidence`, gnisPlaceEvidenceFor(term).strength, "none");
}

console.log("\n--- 7. POLICY B: downgrade, never deletion ---");
for (const suppressed of ["Anthony Hill", "Casey Ford", "Dean Ford", "Robin Hill",
  "Samantha Park", "Sharon Park"]) {
  const e = gnisPlaceEvidenceFor(suppressed);
  check(`${suppressed}: WEAK, not none -- the geography is still known`, e.strength, "weak");
  check(`${suppressed}: reason recorded`, e.suppressionReason, "census-top-1000-both-roles");
  check(`${suppressed}: feature class still reported`, e.featureClasses.length > 0, true);
  check(`${suppressed}: collision recorded`, e.censusPersonStructure, true);
}

console.log("\n--- 8. RECOGNIZABLE GEOGRAPHY MUST SURVIVE POLICY B ---");
// The disqualifying test for the rejected Policy C: each of these was
// suppressed by "either role Top-1000" and must stay strong under B.
for (const place of ["Santa Barbara", "Santa Monica", "Mount Vernon", "Lake Charles",
  "San Francisco", "San Jose", "San Antonio", "New York", "Las Vegas",
  "Saint Louis", "San Juan", "Santa Fe", "Long Beach"]) {
  check(`${place} stays STRONG`, gnisPlaceEvidenceFor(place).strength, "strong");
}

console.log("\n--- 9. ROLE-AWARENESS: membership is not a structure ---");
{
  // Both tokens Census-attested somewhere, but not in the required roles ->
  // no structure -> no suppression.
  const e = gnisPlaceEvidenceFor("San Diego");
  check("San Diego does form a Census structure", e.censusPersonStructure, true);
  check("but not with both roles Top-1000, so it stays strong", e.strength, "strong");
  check("and records no suppression reason", e.suppressionReason, undefined);
  check("Census module agrees a structure exists", censusNameEvidenceFor("San Diego").supportsNameStructure, true);
}

console.log("\n--- 10. FALSIFIED HEURISTICS MUST NOT RETURN ---");
{
  // State multiplicity and multi-class support both correlate WITH person
  // collision. Neither is shipped, so neither can influence strength. These
  // assertions fail if the asset ever regains those fields.
  const e = gnisPlaceEvidenceFor("San Diego");
  check("no state list is exposed", "states" in e, false);
  check("no feature count is exposed", "featureCount" in e, false);
  check("no multiplicity field of any kind", Object.keys(e).sort(),
    ["censusPersonStructure", "featureClasses", "normalized", "source", "strength"]);
  check("no numeric confidence score", Object.values(e).some((v) => typeof v === "number"), false);
}

console.log("\n--- 11. EXPLANATIONS: checkable, never overclaiming ---");
{
  const strong = explainGnisPlaceEvidence(gnisPlaceEvidenceFor("San Diego"));
  check("strong explanation names the match", strong[0]?.includes("Exact match to a U.S. populated-place name"), true);
  const weak = explainGnisPlaceEvidence(gnisPlaceEvidenceFor("Sharon Park"));
  check("weak explanation states the limit", weak.some((l) => l.includes("not established on its own")), true);
  check("no explanation without a match", explainGnisPlaceEvidence(gnisPlaceEvidenceFor("Grade Rosters")), []);
  for (const banned of ["is a place", "definitely", "certainly", "confidence"]) {
    check(`copy avoids "${banned}"`, [...strong, ...weak].join(" ").toLowerCase().includes(banned), false);
  }
}

console.log("\n--- 12. THE STOP CONDITION: evidence is carried, nothing routes on it ---");
{
  /*
   * Two boundaries were hit and reported rather than patched:
   *   §19.4  SemanticTypeId has no Place/Geography member.
   *   §19.3  semanticTypeFor is first-match-wins and cannot hold two
   *          simultaneous affirmative claims -- only pick one.
   *
   * So `gnisPlaceStrength` is carried to the interpretation boundary and read
   * by nobody. These assertions FAIL if a future change wires it in without
   * first resolving those boundaries.
   */
  check("SemanticTypeId still has no place/geography member",
    (SEMANTIC_TYPE_ORDER as readonly string[]).some((t) => /place|geo/.test(t)), false);
  const base = { detectedType: "person", categories: ["known-first-name"], relationshipKinds: new Set<never>() };
  for (const strength of ["strong", "weak", "none"] as const) {
    check(`gnisPlaceStrength="${strength}" does not change the assignment`,
      semanticTypeFor({ ...base, gnisPlaceStrength: strength }), semanticTypeFor(base));
  }
  const shapeOnly = { detectedType: "person", categories: ["strong-name-structure"], relationshipKinds: new Set<never>() };
  check("and cannot create a type where there was none",
    semanticTypeFor({ ...shapeOnly, gnisPlaceStrength: "strong" }), semanticTypeFor(shapeOnly));
  check("routing is byte-identical for a strong place match",
    typeCheckSectionFor({ ...shapeOnly, gnisPlaceStrength: "strong" }, false).section,
    typeCheckSectionFor(shapeOnly, false).section);
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exitCode = 1;
