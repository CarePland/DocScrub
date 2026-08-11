/**
 * higher-ed-terminology-evidence-verification.ts (AG, 2026-08-10).
 *
 * The load-bearing half of this suite is NEGATIVE, for the same reason the
 * Census suite's is. Asserting that the dataset finds `Cost of Attendance` is
 * easy. The assertions that matter are the ones that fail if terminology
 * attestation ever starts behaving like classification, if HIGH collision
 * risk ever starts acting as proof of non-personhood, or if the runtime
 * normalizer ever drifts from the shipped keys.
 *
 * Section 8 is the one to read first: it pins the contract that dictionary
 * membership does not move a single semantic type assignment.
 */

import {
  explainHigherEdTerminologyEvidence,
  higherEdTerminologyFor,
  isAttestedHigherEdTerminology,
  normalizeForHigherEdLookup,
  HIGHER_ED_EVIDENCE_ROW_COUNT,
  HIGHER_ED_EVIDENCE_SOURCE,
  HIGHER_ED_EVIDENCE_TERM_COUNT,
} from "../src/engines/knowledge/HigherEdTerminologyEvidence.js";
import { HIGHER_ED_ROWS } from "../src/engines/knowledge/higher-ed-terminology.data.js";
import { censusRoleFor } from "../src/engines/knowledge/CensusNameEvidence.js";
import { semanticTypeFor, typeCheckSectionFor, type SemanticTypeFacts } from "../src/domain/semanticTypes.js";
import type { RelationshipKind } from "../src/domain/StructuralRelationship.js";

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

console.log("\n--- 1. GENERATED ASSET ---");
check("row count", HIGHER_ED_EVIDENCE_ROW_COUNT, 1394);
check("distinct normalized terms", HIGHER_ED_EVIDENCE_TERM_COUNT, 1373);
check("provenance recorded", HIGHER_ED_EVIDENCE_SOURCE, "docscrub-higher-ed-terminology/2026-08-10");
{
  const lines = HIGHER_ED_ROWS.split("\n");
  check("every shipped row is present", lines.length, 1394);
  check("every row has 8 tab-separated fields", lines.every((l) => l.split("\t").length === 8), true);
}

/*
 * THE STRONGEST CHECK IN THE SUITE, and it is cheap.
 *
 * The shipped keys were produced by the dataset's own Python generator. The
 * runtime normalizer is a SECOND implementation of the same six documented
 * steps in TypeScript. Two implementations of one algorithm is exactly the
 * shape that drifts silently -- a drift here is not a build error, it is a
 * lookup that quietly misses. So: re-normalize every shipped source term and
 * require it to reproduce its own key, all 1,394 of them.
 */
console.log("\n--- 2. NORMALIZATION PARITY over the whole dataset ---");
{
  const mismatches: string[] = [];
  for (const line of HIGHER_ED_ROWS.split("\n")) {
    const [normalized, term] = line.split("\t");
    if (normalizeForHigherEdLookup(term!) !== normalized) mismatches.push(`${term} -> ${normalizeForHigherEdLookup(term!)} != ${normalized}`);
  }
  check("all 1394 source terms re-derive their shipped key", mismatches.slice(0, 5), []);
}

console.log("\n--- 3. NORMALIZATION RULES, each exercised by real dataset rows ---");
for (const [raw, expected] of [
  // punctuation collapses to SPACE, never to nothing -- the rule that differs
  // from normalizeForCensusLookup and the reason multi-word keys survive.
  ["12-month Enrollment", "12 month enrollment"],
  ["11/12 month salary contract/teaching period", "11 12 month salary contract teaching period"],
  ["4-1-4  (calendar system)", "4 1 4 calendar system"],
  // `&` -> ` and `
  ["GASB model using GASB 34 & 35", "gasb model using gasb 34 and 35"],
  ["Operation and maintenance of plant (O&M)", "operation and maintenance of plant o and m"],
  // smart apostrophe
  ["Financial Aid Veteran’s Benefit Status", "financial aid veteran s benefit status"],
  // case, whitespace, trim
  ["  COST   OF   ATTENDANCE  ", "cost of attendance"],
] as const) {
  check(`${JSON.stringify(raw)} -> ${JSON.stringify(expected)}`, normalizeForHigherEdLookup(raw), expected);
}
console.log("    -- explicitly NOT done --");
check("no stemming/plural folding: 'academic librari' is not a key", higherEdTerminologyFor("academic librari"), null);
check("no acronym expansion: 'Satisfactory Academic Progress' and 'SAP' are separate shipped rows, not derived at runtime",
  [higherEdTerminologyFor("Satisfactory Academic Progress")?.attestations.length, higherEdTerminologyFor("SAP")?.attestations.length], [1, 1]);
check("no fuzzy match (Cost of Attendence)", higherEdTerminologyFor("Cost of Attendence"), null);
check("empty and punctuation-only input miss cleanly", [higherEdTerminologyFor(""), higherEdTerminologyFor("--- ,")], [null, null]);

console.log("\n--- 4. AN UNAMBIGUOUS HIGHER-ED PHRASE ---");
{
  const e = higherEdTerminologyFor("Academic Calendar");
  check("attested", e !== null, true);
  check("matched term is the SOURCE form, not the normalized key", e?.attestations[0]?.term, "Academic Calendar");
  check("semantic hint carried", e?.semanticHints, ["ACADEMIC_CONCEPT"]);
  check("source family carried", e?.sourceFamilies, ["Public institutional catalog/registrar glossary"]);
  check("source url carried", e?.attestations[0]?.sourceUrl, "https://registrar.utexas.edu/catalogs/glossary");
  check("not a derived variant", e?.attestations[0]?.derivedVariant, false);
  check("collision risk carried", e?.highestCollisionRisk, "LOW");
  check("family discriminator present for the future combination layer", e?.family, "higher-ed-terminology");
  check("the ORIGINAL input is preserved, never rewritten", e?.value, "Academic Calendar");
}

console.log("\n--- 5. MULTI-TOKEN PHRASES ---");
{
  const e = higherEdTerminologyFor("Cost of Attendance");
  check("multi-token phrase matches as a whole phrase", e?.normalized, "cost of attendance");
  check("token count exposed", e?.tokenCount, 3);
  const long = higherEdTerminologyFor("Degree or Certificate Seeking Student");
  check("5-token phrase matches", long?.tokenCount, 5);
  check("and carries both attesting families", long?.sourceFamilies.length, 2);
}
console.log("    -- a phrase must match as a phrase, not by its parts --");
check("'Attendance' alone is not attested even though 'Cost of Attendance' is", higherEdTerminologyFor("Attendance"), null);
check("no substring matching: 'Cost of Attendance Estimate' misses", higherEdTerminologyFor("Cost of Attendance Estimate"), null);

console.log("\n--- 6. CASE, SPACING AND PUNCTUATION DIFFERENCES ---");
{
  const forms = ["Cost of Attendance", "cost of attendance", "COST OF ATTENDANCE", "Cost Of Attendance", "  cost   of  attendance  ", "cost-of-attendance", "Cost, of Attendance."];
  const results = forms.map((f) => higherEdTerminologyFor(f)?.normalized ?? null);
  check("all seven surface forms reach the same key", results, forms.map(() => "cost of attendance"));
  check("but the record still echoes the exact input it was given", higherEdTerminologyFor("COST OF ATTENDANCE")?.value, "COST OF ATTENDANCE");
}

console.log("\n--- 7. DERIVED VARIANTS ---");
{
  const derived = higherEdTerminologyFor("SAP");
  check("SAP is attested", derived !== null, true);
  check("SAP is flagged as a derived variant", derived?.attestations[0]?.derivedVariant, true);
  check("and therefore has NO source-attested row", derived?.hasSourceAttestedRow, false);
  check("its notes name the parent form", (derived?.attestations[0]?.notes ?? "").includes("Satisfactory Academic Progress"), true);
  const parent = higherEdTerminologyFor("Satisfactory Academic Progress");
  check("the stripped parent form is ALSO a derived row", parent?.attestations[0]?.derivedVariant, true);
  const full = higherEdTerminologyFor("Satisfactory Academic Progress (SAP)");
  check("the full parenthetical form is the source-attested one", full?.hasSourceAttestedRow, true);
  console.log("    -- derived-ness is REPORTED, never used to filter --");
  check("a derived-only row still produces evidence rather than being suppressed", isAttestedHigherEdTerminology("SAP"), true);
}

console.log("\n--- 8. MULTIPLE PROVENANCE ROWS FOR ONE NORMALIZED TERM ---");
{
  const e = higherEdTerminologyFor("Academic Year");
  check("two attesting rows retained, not deduplicated", e?.attestations.length, 2);
  check("both source families retained", e?.sourceFamilies, ["Federal Student Aid glossary", "NCES/IPEDS"]);
  check("multiplyAttested flag set", e?.multiplyAttested, true);
  check("the source forms differ in case and BOTH are kept", e?.attestations.map((a) => a.term), ["Academic Year", "Academic year"]);
  const white = higherEdTerminologyFor("White");
  check("'white' is attested by IPEDS and CEDS", white?.sourceFamilies, ["NCES/CEDS", "NCES/IPEDS"]);
  console.log("    -- highest risk across rows, because a warning on any row is a warning --");
  check("highestCollisionRisk is the max, not the first", white?.highestCollisionRisk, "HIGH");
}

console.log("\n--- 9. HIGH COLLISION RISK, AND NAMES ---");
{
  const white = higherEdTerminologyFor("White");
  check("White is attested terminology", white !== null, true);
  check("flagged HIGH", white?.highestCollisionRisk, "HIGH");
  console.log("    -- and is simultaneously a Census-attested personal name --");
  check("White is a Census first name", censusRoleFor("White")?.firstAttested, true);
  check("White is a Census surname", censusRoleFor("White")?.surnameAttested, true);
  for (const token of ["Major", "Minor", "Race", "Session", "Course"]) {
    const hit = higherEdTerminologyFor(token);
    const role = censusRoleFor(token);
    check(`${token}: attested terminology AND a Census name token`,
      [hit !== null, (role?.firstAttested ?? false) || (role?.surnameAttested ?? false)], [true, true]);
  }
  console.log("    -- the module NEVER filters, downgrades or suppresses these --");
  check("a HIGH-risk single-token hit is still returned in full", higherEdTerminologyFor("Major")?.attestations.length, 1);
  check("single-token hits are not silently dropped (the GNIS trap is carried, not applied)", higherEdTerminologyFor("Major")?.tokenCount, 1);
  check("the reviewer is TOLD about the collision rather than it being hidden",
    explainHigherEdTerminologyEvidence(higherEdTerminologyFor("Major")).some((l) => l.includes("collision-prone")), true);
  console.log("    -- and no exported function answers a classification question --");
  check("no isPerson/isOrganization/suggestedType is exported (shape check)",
    Object.keys(higherEdTerminologyFor("Major") ?? {}).filter((k) => /person|organization|type|decision|keep/i.test(k)), []);
}

console.log("\n--- 10. PHRASES NOT IN THE DATASET ---");
console.log("    -- ABSENCE IS NOT COUNTER-EVIDENCE. Every phrase below is real");
console.log("       higher-education language and every one of them MISSES. --");
for (const absent of ["Academic Senate", "Grade Rosters", "Term Withdrawals", "Registrar", "Dean", "Spring", "Grant"]) {
  check(`${absent} is absent from the dataset`, higherEdTerminologyFor(absent), null);
}
check("a personal name misses", higherEdTerminologyFor("Amy Miller"), null);
check("a place name misses", higherEdTerminologyFor("San Diego"), null);
check("a greeting misses", higherEdTerminologyFor("Good Morning"), null);

/*
 * ============================================================================
 * 11. MEMBERSHIP DOES NOT FORCE A CLASSIFICATION
 * ============================================================================
 *
 * The whole point of the integration, asserted directly. For a spread of
 * candidates -- attested and unattested, HIGH risk and LOW, person-detected
 * and organization-detected -- the semantic type and the Type Check routing
 * must be IDENTICAL with the flag off and with the flag on.
 *
 * If someone later adds a `higherEdTerminologyAttested` branch to
 * `semanticTypeFor`, this section fails, and that is the intent. It is not a
 * ban on ever using the evidence -- it is a requirement that doing so be a
 * deliberate, reviewed change to a documented contract rather than a quiet
 * one-line addition.
 */
console.log("\n--- 11. DICTIONARY MEMBERSHIP DOES NOT DETERMINE THE SEMANTIC TYPE ---");
{
  const base = (over: Partial<SemanticTypeFacts>): SemanticTypeFacts => ({
    detectedType: "person",
    categories: [],
    relationshipKinds: new Set<RelationshipKind>(),
    ...over,
  });
  const cases: Array<[string, SemanticTypeFacts]> = [
    ["person detection, name evidence (a real person named White)", base({ categories: ["known-personal-name-token"] })],
    ["person detection, shape only", base({ categories: ["strong-name-structure"] })],
    ["person detection, no evidence", base({})],
    ["organization detection", base({ detectedType: "organization" })],
    ["institutional categories", base({ detectedType: "unknown", categories: ["department-organization"] })],
    ["acronym", base({ detectedType: "unknown", categories: ["likely-acronym"] })],
    ["calendar term", base({ detectedType: "unknown", categories: ["calendar-term"] })],
    ["email", base({ detectedType: "email" })],
  ];
  for (const [label, facts] of cases) {
    const off = semanticTypeFor({ ...facts, higherEdTerminologyAttested: false });
    const on = semanticTypeFor({ ...facts, higherEdTerminologyAttested: true });
    check(`semanticTypeFor unchanged by attestation -- ${label} (${off})`, on, off);
  }
  console.log("    -- and the same through the routing layer, with and without a rejection --");
  for (const [label, facts] of cases) {
    for (const rejected of [false, true]) {
      const off = typeCheckSectionFor({ ...facts, higherEdTerminologyAttested: false }, rejected);
      const on = typeCheckSectionFor({ ...facts, higherEdTerminologyAttested: true }, rejected);
      check(`typeCheckSectionFor unchanged -- ${label}, nonPersonEvidence=${rejected} (${off.section})`, on, off);
    }
  }
  console.log("    -- absent means false: the field is genuinely optional --");
  check("omitting the field equals passing false",
    semanticTypeFor(base({ categories: ["known-personal-name-token"] })),
    semanticTypeFor({ ...base({ categories: ["known-personal-name-token"] }), higherEdTerminologyAttested: false }));
  console.log("    -- the specific failure this guards: 'White' must still be able to be a person --");
  check("a person-evidenced candidate whose value is HIGH-risk terminology still routes to People",
    typeCheckSectionFor({ ...base({ categories: ["known-personal-name-token"] }), higherEdTerminologyAttested: true }, false).section,
    "people");
  check("and an ORGANIZATION hint in the dataset does not route anything to Organizations",
    semanticTypeFor({ ...base({ detectedType: "unknown" }), higherEdTerminologyAttested: true }),
    "other");
}

console.log("\n--- 12. EXPLANATION WORDING: observation, never verdict ---");
{
  const lines = explainHigherEdTerminologyEvidence(higherEdTerminologyFor("Academic Year"));
  check("reports attestation and corroboration", lines, [
    '"Academic Year" is attested higher-education terminology (Federal Student Aid glossary and NCES/IPEDS).',
    "Attested independently by 2 sources.",
  ]);
  check("a miss explains nothing at all", explainHigherEdTerminologyEvidence(null), []);
  const forbidden = /\b(is not a person|not a person|therefore|so it is|keep this|redact|organization\b)/i;
  const all = ["Academic Year", "White", "Major", "SAP", "Cost of Attendance", "Financial aid"]
    .flatMap((v) => explainHigherEdTerminologyEvidence(higherEdTerminologyFor(v)));
  check("no explanation line draws a conclusion about the referent", all.filter((l) => forbidden.test(l)), []);
  check("the derived-variant caveat is surfaced to the reviewer",
    explainHigherEdTerminologyEvidence(higherEdTerminologyFor("SAP")).some((l) => l.includes("mechanically derived variant")), true);
}

console.log(`\n=== higher-ed terminology evidence: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
