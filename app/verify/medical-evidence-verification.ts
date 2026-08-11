/**
 * medical-evidence-verification.ts (AG, 2026-08-10).
 *
 * The load-bearing half of this suite is NEGATIVE, for the same reason the
 * Census and higher-ed suites' halves are. Asserting that the dataset finds
 * `Nuclear Medicine` is easy. The assertions that matter are the ones that
 * fail if terminology attestation ever starts behaving like classification, if
 * HIGH collision risk ever starts acting as proof of non-personhood, if an
 * abbreviation's source expansion ever starts acting as a resolution of what
 * the abbreviation means in a document, or if the runtime normalizer drifts
 * from the shipped keys.
 *
 * Two sections to read first:
 *   §11 pins that dictionary membership does not move a single semantic type
 *       assignment or routing decision.
 *   §13 pins the clinical-safety boundary over the WHOLE dataset: no reviewer-
 *       facing line this module can emit, for any of the 378 terms, says
 *       anything about a person.
 */

import {
  explainMedicalEvidence,
  isAttestedMedicalTerminology,
  medicalEvidenceFor,
  normalizeForMedicalLookup,
  MEDICAL_EVIDENCE_ROW_COUNT,
  MEDICAL_EVIDENCE_SOURCE,
  MEDICAL_EVIDENCE_TERM_COUNT,
} from "../src/engines/knowledge/MedicalEvidence.js";
import { MEDICAL_ROWS } from "../src/engines/knowledge/medical-terminology.data.js";
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

const ROW_LINES = MEDICAL_ROWS.split("\n").filter((l) => l.length > 0);

/*
 * ============================================================================
 * 1. GENERATED ASSET -- TRUNCATION AND DEDUPLICATION ARE VISIBLE OR NOTHING IS
 * ============================================================================
 *
 * The supplied artifact contains 381 attestation rows over 378 distinct
 * normalized terms (methodology: "Source-attested rows: 374, Derived variants:
 * 7, Total rows: 381, Normalized unique terms: 378"). Every one of those four
 * figures is pinned below AGAINST THE SHIPPED ROW BLOCK, not against a
 * generator-written constant, so a silent truncation or an accidental
 * dedup-to-key-set cannot pass.
 */
console.log("\n--- 1. GENERATED ASSET ---");
check("row count constant", MEDICAL_EVIDENCE_ROW_COUNT, 381);
check("distinct normalized terms constant", MEDICAL_EVIDENCE_TERM_COUNT, 378);
check("provenance recorded", MEDICAL_EVIDENCE_SOURCE, "docscrub-medical-terminology/2026-08-10-v1");
check("every shipped row is present in the row block", ROW_LINES.length, 381);
check("every row has 9 tab-separated fields", ROW_LINES.every((l) => l.split("\t").length === 9), true);
{
  const keys = ROW_LINES.map((l) => l.split("\t")[0]!);
  check("distinct keys in the row block matches the constant", new Set(keys).size, 378);
  check("the 3 extra rows are multi-provenance, not duplicates of one key", keys.length - new Set(keys).size, 3);
  const attested = ROW_LINES.filter((l) => l.split("\t")[4] === "1").length;
  const derived = ROW_LINES.filter((l) => l.split("\t")[5] === "1").length;
  check("source-attested rows (methodology says 374)", attested, 374);
  check("derived-variant rows (methodology says 7)", derived, 7);
  check("attested and derived partition the dataset", attested + derived, 381);
  const risks = ROW_LINES.map((l) => Number(l.split("\t")[7]));
  check("collision risk distribution matches the methodology (LOW 327, MEDIUM 16, HIGH 38)",
    [risks.filter((r) => r === 0).length, risks.filter((r) => r === 1).length, risks.filter((r) => r === 2).length],
    [327, 16, 38]);
}
{
  // Every key must be reachable through the public lookup. A key present in
  // the asset but unreachable at runtime is exactly the failure a row count
  // alone would hide.
  const unreachable = ROW_LINES.map((l) => l.split("\t")[0]!).filter((key) => medicalEvidenceFor(key) === null);
  check("every shipped key is reachable through medicalEvidenceFor", unreachable.slice(0, 5), []);
  const totalAttestations = [...new Set(ROW_LINES.map((l) => l.split("\t")[0]!))]
    .reduce((sum, key) => sum + (medicalEvidenceFor(key)?.attestations.length ?? 0), 0);
  check("the lookup surfaces all 381 rows, not 378", totalAttestations, 381);
}

/*
 * ============================================================================
 * 2. NORMALIZATION PARITY over the whole dataset
 * ============================================================================
 *
 * The strongest check in the suite, and it is cheap. The shipped keys were
 * produced by the dataset's own Python generator (full Unicode casefold). The
 * runtime normalizer is a SECOND implementation of the same five documented
 * steps in TypeScript, with an explicit fold for the characters where
 * JavaScript's toLowerCase and Unicode full casefold disagree. Two
 * implementations of one algorithm is exactly the shape that drifts silently
 * -- and a drift here is not a build error, it is a lookup that quietly
 * misses. So: re-normalize every shipped source term and require it to
 * reproduce its own key, all 381 of them.
 */
console.log("\n--- 2. NORMALIZATION PARITY over the whole dataset ---");
{
  const mismatches: string[] = [];
  for (const line of ROW_LINES) {
    const [normalized, term] = line.split("\t");
    if (normalizeForMedicalLookup(term!) !== normalized) {
      mismatches.push(`${term} -> ${normalizeForMedicalLookup(term!)} != ${normalized}`);
    }
  }
  check("all 381 source terms re-derive their shipped key", mismatches.slice(0, 5), []);
  check("normalization is idempotent over every key",
    ROW_LINES.map((l) => l.split("\t")[0]!).filter((k) => normalizeForMedicalLookup(k) !== k).slice(0, 5), []);
}

/*
 * ============================================================================
 * 3. NORMALIZATION RULES, each exercised by real dataset rows
 * ============================================================================
 *
 * The rule that is ABSENT is the one worth pinning: punctuation is neither
 * stripped nor collapsed to space. That is this dataset's own policy, it is
 * why the 7 derived variants exist as separate rows, and it is where this
 * normalizer differs from BOTH siblings.
 */
console.log("\n--- 3. NORMALIZATION RULES ---");
for (const [raw, expected] of [
  // case + trim + internal whitespace collapse
  ["  NUCLEAR   MEDICINE  ", "nuclear medicine"],
  ["Diabetes\tMellitus", "diabetes mellitus"],
  // dash variants -> ASCII hyphen, and the hyphen SURVIVES
  ["Case–Control Study", "case-control study"],
  ["Case—Control Study", "case-control study"],
  ["Case−Control Study", "case-control study"],
  ["COVID‑19", "covid-19"],
  // commas survive: MeSH inverted headings are real keys
  ["Arthritis, Rheumatoid", "arthritis, rheumatoid"],
  ["Anti-Inflammatory Agents, Non-Steroidal", "anti-inflammatory agents, non-steroidal"],
  // NFKC
  ["Ｍｒｉ", "mri"],
] as const) {
  check(`${JSON.stringify(raw)} -> ${JSON.stringify(expected)}`, normalizeForMedicalLookup(raw), expected);
}
console.log("    -- punctuation is PART of the key, not noise --");
check("the hyphen is not collapsed to a space", normalizeForMedicalLookup("Case-Control Study"), "case-control study");
check("and therefore the spaced form is a DIFFERENT key", normalizeForMedicalLookup("Case Control Study"), "case control study");
check("both keys exist in the dataset, because the source enumerates both",
  [medicalEvidenceFor("Case-Control Study") !== null, medicalEvidenceFor("Case Control Study") !== null], [true, true]);
console.log("    -- the documented consequence, recorded rather than papered over --");
check("a candidate carrying trailing sentence punctuation does NOT match", medicalEvidenceFor("Insulin."), null);
check("nor one in brackets", medicalEvidenceFor("(Insulin)"), null);
console.log("       ^ this is the source dataset's normalization policy, faithfully reproduced.");
console.log("         Changing it means re-normalizing the dataset or trimming candidates upstream --");
console.log("         a decision about candidate preparation, not something to slip into a lookup.");

/*
 * ============================================================================
 * 4. NEGATIVE MATCHING -- exact lookup, and nothing but
 * ============================================================================
 */
console.log("\n--- 4. NO FUZZY, INFERRED OR PARTIAL MATCHING ---");
check("misspelling: 'Diabetes Melitus'", medicalEvidenceFor("Diabetes Melitus"), null);
check("misspelling: 'Hemodyalisis'", medicalEvidenceFor("Hemodyalisis"), null);
check("edit distance 1: 'Insulan'", medicalEvidenceFor("Insulan"), null);
check("partial term: 'Magnetic Resonance'", medicalEvidenceFor("Magnetic Resonance"), null);
check("partial term: 'Mellitus' alone", medicalEvidenceFor("Mellitus"), null);
check("superstring: 'Nuclear Medicine Department'", medicalEvidenceFor("Nuclear Medicine Department"), null);
check("reordered tokens: 'Mellitus Diabetes'", medicalEvidenceFor("Mellitus Diabetes"), null);
check("reordered tokens: 'Rheumatoid Arthritis' (the source ships the inverted form)", medicalEvidenceFor("Rheumatoid Arthritis"), null);
check("invented synonym: 'Sugar Diabetes'", medicalEvidenceFor("Sugar Diabetes"), null);
check("invented synonym: 'MRI Scan'", medicalEvidenceFor("MRI Scan"), null);
check("no plural folding: 'Insulins'", medicalEvidenceFor("Insulins"), null);
check("no singular folding: 'Adrenal Gland' (source ships 'Adrenal Glands')", medicalEvidenceFor("Adrenal Gland"), null);
check("no stemming: 'cardiolog'", medicalEvidenceFor("cardiolog"), null);
check("no acronym expansion at runtime: 'Reverse Transcription' is not a shipped key", medicalEvidenceFor("Reverse Transcription"), null);
check("   ...even though 'RT' is, and names that expansion in its provenance",
  medicalEvidenceFor("RT")?.sourceExpansions, ["Reverse Transcription"]);
check("empty and punctuation-only input miss cleanly",
  [medicalEvidenceFor(""), medicalEvidenceFor("   "), medicalEvidenceFor("--- ,")], [null, null, null]);

/*
 * ============================================================================
 * 5. POSITIVE MATCHES ACROSS THE CATEGORY SPREAD
 * ============================================================================
 */
console.log("\n--- 5. POSITIVE EXACT MATCHES ACROSS CATEGORIES ---");
for (const [phrase, hint, family] of [
  ["Nuclear Medicine", "ORGANIZATION_DEPARTMENT", "NLM_MESH"],
  ["Diabetes Mellitus", "CONDITION", "NLM_MESH"],
  ["Hemodialysis", "PROCEDURE", "CDC"],
  ["Magnetic Resonance Imaging", "TEST", "NLM_MESH"],
  ["Prior authorization", "PROCESS_EVENT", "CMS"],
  ["Electronic Prior Authorization", "PROCESS_EVENT", "CMS"],
  ["National Provider Identifier", "IDENTIFIER_TYPE", "CMS"],
  ["Medical Records", "DOCUMENT", "NLM_MESH"],
  ["Cardiology", "ORGANIZATION_DEPARTMENT", "NLM_MESH"],
  ["Insulin", "MEDICATION", "NLM_MESH"],
  ["Aorta", "ANATOMY", "NLM_MESH"],
  ["Anesthesiologists", "ROLE", "NLM_MESH"],
  ["Current Procedural Terminology", "BILLING_CODING", "CMS"],
] as const) {
  const e = medicalEvidenceFor(phrase);
  check(`${phrase} -> ${hint} (${family})`,
    [e !== null, e?.semanticHints[0], e?.sourceFamilies[0]], [true, hint, family]);
}
{
  const e = medicalEvidenceFor("Nuclear Medicine");
  check("matched term is the SOURCE form, not the normalized key", e?.attestations[0]?.term, "Nuclear Medicine");
  check("source url carried", e?.attestations[0]?.sourceUrl, "https://www.nlm.nih.gov/databases/download/mesh.html");
  check("authority level carried", e?.attestations[0]?.authorityLevel, "US_FEDERAL_CONTROLLED_VOCABULARY");
  check("source-attested, not derived", [e?.attestations[0]?.sourceAttested, e?.attestations[0]?.derivedVariant], [true, false]);
  check("no parent term on a source-attested row", e?.attestations[0]?.parentTerm, null);
  check("collision risk carried", e?.highestCollisionRisk, "LOW");
  check("family discriminator present for the future combination layer", e?.family, "medical-terminology");
  check("the ORIGINAL input is preserved, never rewritten", e?.value, "Nuclear Medicine");
  check("token count exposed", e?.tokenCount, 2);
}
console.log("    -- case, spacing and dash variation all reach the same key --");
{
  const forms = ["Diabetes Mellitus", "diabetes mellitus", "DIABETES MELLITUS", "  Diabetes   Mellitus  ", "Diabetes Mellitus"];
  check("all five surface forms reach one key", forms.map((f) => medicalEvidenceFor(f)?.normalized ?? null), forms.map(() => "diabetes mellitus"));
  check("but the record still echoes the exact input it was given", medicalEvidenceFor("DIABETES MELLITUS")?.value, "DIABETES MELLITUS");
}

/*
 * ============================================================================
 * 6. DERIVED VARIANTS -- reported, never filtered, never re-derived
 * ============================================================================
 */
console.log("\n--- 6. DERIVED VARIANTS ---");
{
  const derived = medicalEvidenceFor("case control study");
  check("the spaced form is attested", derived !== null, true);
  check("flagged as a derived variant", derived?.attestations[0]?.derivedVariant, true);
  check("and NOT source-attested", derived?.attestations[0]?.sourceAttested, false);
  check("so the record has no source-attested row", derived?.hasSourceAttestedRow, false);
  check("the parent form is preserved on the row", derived?.attestations[0]?.parentTerm, "Case-Control Study");
  check("its notes say so in the source's own words",
    derived?.attestations[0]?.notes, "Conservative deterministic orthographic variant; not independently source-attested.");
  const parent = medicalEvidenceFor("Case-Control Study");
  check("the parent is itself a shipped, source-attested row",
    [parent?.hasSourceAttestedRow, parent?.attestations[0]?.derivedVariant], [true, false]);
  check("and carries no parent of its own", parent?.attestations[0]?.parentTerm, null);
  console.log("    -- all 7 derived rows, each distinguishable from its parent --");
  for (const [variant, parentTerm] of [
    ["age adjusted mortality rate", "Age-Adjusted Mortality Rate"],
    ["age specific mortality rate", "Age-Specific Mortality Rate"],
    ["case control study", "Case-Control Study"],
    ["case fatality rate", "Case-Fatality Rate"],
    ["fee for service", "Private Fee-for-Service Plans"],
    ["health care associated", "Health-care associated"],
    ["high level disinfection", "High-level disinfection"],
  ] as const) {
    const e = medicalEvidenceFor(variant);
    check(`${variant} -> derived from "${parentTerm}"`,
      [e?.attestations[0]?.derivedVariant, e?.attestations[0]?.parentTerm], [true, parentTerm]);
  }
  console.log("    -- derived-ness is REPORTED, never used to filter --");
  check("a derived-only row still produces evidence rather than being suppressed", isAttestedMedicalTerminology("case control study"), true);
  console.log("    -- and NO further variants are generated at runtime --");
  check("'case-fatality-rate' (all-hyphen) is not a key", medicalEvidenceFor("case-fatality-rate"), null);
  check("'fee-for-service' is not a key -- only the spaced derived form and the full parent are",
    [medicalEvidenceFor("fee-for-service"), medicalEvidenceFor("fee for service") !== null], [null, true]);
}

/*
 * ============================================================================
 * 7. MULTIPLE PROVENANCE ROWS FOR ONE NORMALIZED TERM
 * ============================================================================
 */
console.log("\n--- 7. MULTIPLE PROVENANCE ---");
for (const term of ["Hemodialysis", "Hemofiltration", "Morbidity"]) {
  const e = medicalEvidenceFor(term);
  check(`${term}: two attesting rows retained, not deduplicated`, e?.attestations.length, 2);
  check(`${term}: both federal source families retained`, e?.sourceFamilies, ["CDC", "NLM_MESH"]);
  check(`${term}: multiplyAttested flag set`, e?.multiplyAttested, true);
  check(`${term}: both authority levels retained`,
    e?.attestations.map((a) => a.authorityLevel), ["US_FEDERAL_AGENCY", "US_FEDERAL_CONTROLLED_VOCABULARY"]);
}
{
  const e = medicalEvidenceFor("Hemodialysis");
  check("the two rows carry distinct source URLs", new Set(e?.attestations.map((a) => a.sourceUrl)).size, 2);
  console.log("    -- highest risk across rows, because a warning on any row is a warning --");
  check("highestCollisionRisk is the max across rows, not the first", e?.highestCollisionRisk, "LOW");
}

/*
 * ============================================================================
 * 8. ABBREVIATIONS -- membership visible, ambiguity preserved, nothing resolved
 * ============================================================================
 */
console.log("\n--- 8. ABBREVIATIONS ---");
{
  const abbreviations = ROW_LINES.filter((l) => {
    const notes = l.split("\t")[8];
    return notes !== undefined;
  });
  check("the corpus is intact for the scan below", abbreviations.length, 381);
  const marked = [...new Set(ROW_LINES.map((l) => l.split("\t")[0]!))]
    .map((k) => medicalEvidenceFor(k)!)
    .filter((e) => e.hasAbbreviationRow);
  check("43 abbreviation rows are visible as evidence (the methodology's own figure)",
    marked.reduce((n, e) => n + e.attestations.filter((a) => a.abbreviation).length, 0), 43);
  check("38 of them carry the source's expansion",
    marked.reduce((n, e) => n + e.attestations.filter((a) => a.sourceExpansion !== null).length, 0), 38);
}
for (const [abbr, expansion, risk] of [
  ["RT", "Reverse Transcription", "HIGH"],
  ["IV", "Intravenous", "HIGH"],
  ["TB", "Tuberculosis", "HIGH"],
  ["CDC", "Centers for Disease Control and Prevention", "HIGH"],
  ["CMS", "Centers for Medicare & Medicaid Services", "HIGH"],
  ["PCR", "Polymerase Chain Reaction", "HIGH"],
  ["OHS", "Occupational Health Services", "HIGH"],
  ["Tdap", "Tetanus, Diphtheria, Pertussis", "HIGH"],
] as const) {
  const e = medicalEvidenceFor(abbr);
  check(`${abbr}: attested, marked an abbreviation, expansion and risk preserved`,
    [e !== null, e?.hasAbbreviationRow, e?.sourceExpansions, e?.highestCollisionRisk],
    [true, true, [expansion], risk]);
}
console.log("    -- an abbreviation WITHOUT a source expansion keeps its ambiguity as ambiguity --");
for (const abbr of ["CPT", "HCPCS", "DMEPOS", "HVAC", "NTM"]) {
  const e = medicalEvidenceFor(abbr);
  check(`${abbr}: marked an abbreviation but no expansion invented`,
    [e?.hasAbbreviationRow, e?.sourceExpansions], [true, []]);
}
console.log("    -- and the note's own warning survives verbatim --");
check("the source's 'may have non-medical expansions' caveat is carried",
  medicalEvidenceFor("RT")?.attestations[0]?.notes.includes("abbreviation may have non-medical expansions"), true);
console.log("    -- membership does NOT classify: the record answers no question about the referent --");
check("no isPerson/isOrganization/suggestedType/isMedical is exported (shape check)",
  Object.keys(medicalEvidenceFor("RT") ?? {}).filter((k) => /person|organization|decision|keep|redact|patient|diagnos/i.test(k)), []);
check("nor on an attestation row",
  Object.keys(medicalEvidenceFor("RT")?.attestations[0] ?? {}).filter((k) => /person|organization|decision|keep|redact|patient|diagnos/i.test(k)), []);
check("`AMBIGUOUS` is carried as a hint, not resolved into something specific",
  medicalEvidenceFor("RT")?.semanticHints, ["AMBIGUOUS"]);

/*
 * ============================================================================
 * 9. COLLISION RISK IS A WARNING, NEVER A FILTER
 * ============================================================================
 *
 * The dataset flags 38 rows HIGH and 16 MEDIUM. This module returns every one
 * of them in full. The section below also demonstrates the specific danger:
 * medical attestation and Census personal-name attestation coexist on the same
 * strings, and neither cancels the other.
 */
console.log("\n--- 9. COLLISION RISK ---");
for (const [term, risk] of [
  ["Case", "MEDIUM"], ["Claim", "MEDIUM"], ["Provider", "MEDIUM"], ["Agent", "MEDIUM"],
  ["Carrier", "MEDIUM"], ["Premium", "MEDIUM"], ["Bias", "MEDIUM"], ["Association", "MEDIUM"],
  ["Ear", "HIGH"], ["Eye", "HIGH"], ["GAS", "HIGH"], ["LP", "HIGH"], ["ADA", "HIGH"],
] as const) {
  const e = medicalEvidenceFor(term);
  check(`${term} is attested terminology, flagged ${risk}, and returned in full`,
    [e !== null, e?.highestCollisionRisk, e?.attestations.length], [true, risk, 1]);
}
console.log("    -- and some of them are simultaneously Census-attested personal-name tokens --");
{
  const overlaps: string[] = [];
  for (const key of new Set(ROW_LINES.map((l) => l.split("\t")[0]!))) {
    if (key.includes(" ")) continue;
    const role = censusRoleFor(key);
    if (role && (role.firstAttested || role.surnameAttested)) overlaps.push(key);
  }
  check("single-token medical terms that are ALSO Census name tokens exist", overlaps.length > 0, true);
  console.log(`       ${overlaps.length} single-token terms overlap the Census asset: ${overlaps.slice(0, 24).join(", ")}`);
  check("every one of them is still returned in full, unfiltered",
    overlaps.filter((t) => medicalEvidenceFor(t) === null), []);
}
console.log("    -- the module NEVER filters, downgrades or suppresses on risk or token count --");
check("a HIGH-risk single-token hit is still returned in full", medicalEvidenceFor("GAS")?.attestations.length, 1);
check("single-token hits are not silently dropped (the GNIS trap is carried, not applied)", medicalEvidenceFor("GAS")?.tokenCount, 1);
check("the reviewer is TOLD about the collision rather than it being hidden",
  explainMedicalEvidence(medicalEvidenceFor("GAS")).some((l) => l.includes("collision-prone")), true);
check("a MEDIUM-risk ordinary-English term is told to the reviewer too",
  explainMedicalEvidence(medicalEvidenceFor("Provider")).some((l) => l.includes("collision-prone")), true);

/*
 * ============================================================================
 * 10. PHRASES NOT IN THE DATASET -- ABSENCE IS NOT COUNTER-EVIDENCE
 * ============================================================================
 *
 * Every phrase below is real healthcare language and every one MISSES. This
 * pack is deliberately partial: SNOMED CT, UMLS, LOINC, RxNorm and CPT
 * descriptors are all excluded on licensing grounds (see the methodology).
 * A miss is the absence of THIS evidence family and nothing more.
 */
console.log("\n--- 10. PHRASES NOT IN THE DATASET ---");
for (const absent of ["Chemotherapy", "Ibuprofen", "Metformin", "Emergency Department", "Intensive Care Unit", "Nurse Practitioner", "Blood Pressure", "Discharge Summary", "Physical Therapy", "Vital Signs", "Advance Directive"]) {
  check(`${absent} is absent from this pack`, medicalEvidenceFor(absent), null);
}
check("a personal name misses", medicalEvidenceFor("Amy Miller"), null);
check("a place name misses", medicalEvidenceFor("San Diego"), null);
check("a greeting misses", medicalEvidenceFor("Good Morning"), null);
check("a higher-ed term misses (the families are independent, not nested)", medicalEvidenceFor("Cost of Attendance"), null);

/*
 * ============================================================================
 * 11. DICTIONARY MEMBERSHIP DOES NOT DETERMINE THE SEMANTIC TYPE
 * ============================================================================
 *
 * The whole point of the integration, asserted directly. For a spread of
 * candidates -- attested and unattested, HIGH risk and LOW, person-detected and
 * organization-detected -- the semantic type and the Type Check routing must be
 * IDENTICAL with the flag off and with the flag on, alone and in combination
 * with the other inert families.
 *
 * If someone later adds a `medicalTerminologyAttested` branch to
 * `semanticTypeFor`, this section fails, and that is the intent. It is not a
 * ban on ever using the evidence -- it is a requirement that doing so be a
 * deliberate, reviewed change to a documented contract rather than a quiet
 * one-line addition.
 */
console.log("\n--- 11. MEMBERSHIP DOES NOT DETERMINE THE SEMANTIC TYPE ---");
{
  const base = (over: Partial<SemanticTypeFacts>): SemanticTypeFacts => ({
    detectedType: "person",
    categories: [],
    relationshipKinds: new Set<RelationshipKind>(),
    ...over,
  });
  const cases: Array<[string, SemanticTypeFacts]> = [
    ["person detection, name evidence (a real person named Case)", base({ categories: ["known-personal-name-token"] })],
    ["person detection, shape only", base({ categories: ["strong-name-structure"] })],
    ["person detection, no evidence", base({})],
    ["organization detection", base({ detectedType: "organization" })],
    ["institutional categories", base({ detectedType: "unknown", categories: ["department-organization"] })],
    ["acronym", base({ detectedType: "unknown", categories: ["likely-acronym"] })],
    ["calendar term", base({ detectedType: "unknown", categories: ["calendar-term"] })],
    ["email", base({ detectedType: "email" })],
  ];
  for (const [label, facts] of cases) {
    const off = semanticTypeFor({ ...facts, medicalTerminologyAttested: false });
    const on = semanticTypeFor({ ...facts, medicalTerminologyAttested: true });
    check(`semanticTypeFor unchanged by attestation -- ${label} (${off})`, on, off);
  }
  console.log("    -- and the same through the routing layer, with and without a rejection --");
  for (const [label, facts] of cases) {
    for (const rejected of [false, true]) {
      const off = typeCheckSectionFor({ ...facts, medicalTerminologyAttested: false }, rejected);
      const on = typeCheckSectionFor({ ...facts, medicalTerminologyAttested: true }, rejected);
      check(`typeCheckSectionFor unchanged -- ${label}, nonPersonEvidence=${rejected} (${off.section})`, on, off);
    }
  }
  console.log("    -- absent means false: the field is genuinely optional --");
  check("omitting the field equals passing false",
    semanticTypeFor(base({ categories: ["known-personal-name-token"] })),
    semanticTypeFor({ ...base({ categories: ["known-personal-name-token"] }), medicalTerminologyAttested: false }));
  console.log("    -- and inert in COMBINATION with the other inert families, not just alone --");
  for (const [label, facts] of cases) {
    const off = typeCheckSectionFor({ ...facts }, false);
    const on = typeCheckSectionFor({
      ...facts,
      medicalTerminologyAttested: true,
      higherEdTerminologyAttested: true,
      gnisPlaceStrength: "strong",
    }, false);
    check(`all three reference families on together changes nothing -- ${label} (${off.section})`, on.section, off.section);
  }
  console.log("    -- the specific failures this guards --");
  check("a person-evidenced candidate whose value is HIGH-risk medical terminology still routes to People",
    typeCheckSectionFor({ ...base({ categories: ["known-personal-name-token"] }), medicalTerminologyAttested: true }, false).section,
    "people");
  check("an ORGANIZATION_DEPARTMENT hint in the dataset does not route anything to Organizations",
    semanticTypeFor({ ...base({ detectedType: "unknown" }), medicalTerminologyAttested: true }),
    "other");
  check("a ROLE hint does not route anything either",
    typeCheckSectionFor({ ...base({ detectedType: "unknown" }), medicalTerminologyAttested: true }, false).section,
    typeCheckSectionFor(base({ detectedType: "unknown" }), false).section);
}

/*
 * ============================================================================
 * 12. EXPLANATION WORDING: observation, never verdict
 * ============================================================================
 */
console.log("\n--- 12. EXPLANATION WORDING ---");
{
  check("a plain hit reports attestation and nothing else",
    explainMedicalEvidence(medicalEvidenceFor("Prior authorization")),
    ['"Prior authorization" is attested medical/healthcare terminology (CMS).']);
  check("corroboration is reported when it exists",
    explainMedicalEvidence(medicalEvidenceFor("Hemodialysis")), [
      '"Hemodialysis" is attested medical/healthcare terminology (CDC and NLM_MESH).',
      "Attested independently by 2 sources.",
    ]);
  check("a miss explains nothing at all", explainMedicalEvidence(null), []);
  check("the derived-variant caveat names the parent",
    explainMedicalEvidence(medicalEvidenceFor("case control study")).some((l) => l.includes('orthographic variant of "Case-Control Study"')), true);
  check("the abbreviation line frames the expansion as what the SOURCE said",
    explainMedicalEvidence(medicalEvidenceFor("RT")).some((l) => l.includes("not what it means here")), true);
}

/*
 * ============================================================================
 * 13. THE CLINICAL-SAFETY BOUNDARY, over the WHOLE dataset
 * ============================================================================
 *
 * The constraint unique to this family. Terminology attestation must never be
 * phrased as, or become, a statement about an individual. The scan below runs
 * every one of the 378 keys through the reviewer-facing explainer, strips the
 * quoted source term (so a term like `Patient Discharge` cannot trip its own
 * check), and requires that no remaining prose asserts anything about a
 * person, a diagnosis, a treatment or a decision.
 */
console.log("\n--- 13. CLINICAL-SAFETY AND VERDICT BOUNDARY over all 378 terms ---");
{
  const forbidden = /\b(the patient|this person|the person|has a diagnosis|is diagnosed|was treated|suffers|is not a person|therefore|so it is|keep this|should be redacted|phi\b)/i;
  const offenders: string[] = [];
  let lines = 0;
  for (const key of new Set(ROW_LINES.map((l) => l.split("\t")[0]!))) {
    const evidence = medicalEvidenceFor(key)!;
    for (const line of explainMedicalEvidence(evidence)) {
      lines += 1;
      // Remove the quoted source term(s) so the term's own words are not
      // mistaken for the module's assertions.
      const prose = line.replace(/"[^"]*"/g, "");
      if (forbidden.test(prose)) offenders.push(`${key}: ${line}`);
    }
  }
  check(`no reviewer-facing line asserts anything about a person (${lines} lines over 378 terms)`, offenders.slice(0, 5), []);
  console.log("    -- and the terms most likely to invite that reading are still just attestations --");
  for (const clinical of ["Diabetes Mellitus", "HIV", "Chemotherapy, Adjuvant", "Psychiatry", "Anxiety Disorders", "Substance-Related Disorders"]) {
    const e = medicalEvidenceFor(clinical);
    if (e === null) { check(`${clinical} (absent from the pack)`, e, null); continue; }
    const prose = explainMedicalEvidence(e).map((l) => l.replace(/"[^"]*"/g, "")).join(" ");
    check(`${clinical}: says only that the phrase is attested`, forbidden.test(prose), false);
  }
  console.log("    -- the record carries no field that could hold a patient state --");
  const shape = Object.keys(medicalEvidenceFor("Diabetes Mellitus") ?? {}).sort();
  check("the evidence record's shape is fixed and contains no clinical assertion", shape, [
    "attestations", "family", "hasAbbreviationRow", "hasSourceAttestedRow", "highestCollisionRisk",
    "multiplyAttested", "normalized", "semanticHints", "sourceExpansions", "sourceFamilies",
    "tokenCount", "value",
  ]);
}

console.log(`\n=== medical evidence: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
