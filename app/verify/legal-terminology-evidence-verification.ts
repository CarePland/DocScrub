/**
 * legal-terminology-evidence-verification.ts (AG, 2026-08-10).
 *
 * The load-bearing half of this suite is NEGATIVE, for the same reason the
 * Census, higher-ed and finance suites' are. Asserting that the dataset finds
 * `motion for summary judgment` is easy. The assertions that matter are the
 * ones that fail if terminology attestation ever starts behaving like
 * classification.
 *
 * This is the most collision-prone of the domain packs -- `Doe`, `Judge`,
 * `Levy`, `answer`, `brief`, `record`, `court`, `counsel` are all legitimately
 * attested legal terminology AND legitimately something else. Section 9 is
 * where that is pinned: a HIGH-risk term must still return evidence in full,
 * with its warning attached, and must never be filtered or turned into a
 * claim about what the phrase is.
 *
 * Run:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs \
 *        verify/legal-terminology-evidence-verification.ts
 */

import {
  explainLegalTerminologyEvidence,
  isAttestedLegalTerminology,
  legalTerminologyEvidenceFor,
  normalizeForLegalLookup,
  LEGAL_EVIDENCE_ROW_COUNT,
  LEGAL_EVIDENCE_SOURCE,
  LEGAL_EVIDENCE_TERM_COUNT,
} from "../src/engines/knowledge/LegalTerminologyEvidence.js";
import { LEGAL_PACK } from "../src/engines/knowledge/legal-terminology.data.js";
import { censusRoleFor } from "../src/engines/knowledge/CensusNameEvidence.js";
import { financeAccountingTaxEvidenceFor } from "../src/engines/knowledge/FinanceAccountingTaxEvidence.js";
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
check("attestation row count", LEGAL_EVIDENCE_ROW_COUNT, 449);
check("distinct normalized terms", LEGAL_EVIDENCE_TERM_COUNT, 445);
check("provenance recorded", LEGAL_EVIDENCE_SOURCE, "docscrub-legal-terminology/2026-08-10");
{
  const lines = LEGAL_PACK.rows.split("\n").filter((l) => l.length > 0);
  check("every shipped row is present", lines.length, 449);
  check("every row has 13 tab-separated fields", lines.every((l) => l.split("\t").length === 13), true);
  /*
   * 445 CSV rows become 449 attestations because the source merges
   * co-attesting authorities into one row with `|`-separated provenance, and
   * the generator un-merges them. The 4 extra rows ARE the corroboration this
   * pack would otherwise hide.
   */
  check("4 co-attested rows were expanded, not flattened", LEGAL_EVIDENCE_ROW_COUNT - LEGAL_EVIDENCE_TERM_COUNT, 4);
}

console.log("\n--- 2. NORMALIZATION PARITY over the whole dataset ---");
{
  const mismatches: string[] = [];
  for (const line of LEGAL_PACK.rows.split("\n")) {
    if (line.length === 0) continue;
    const [normalized, term] = line.split("\t");
    const derived = normalizeForLegalLookup(term!);
    if (derived !== normalized) mismatches.push(`${term} -> ${derived} != ${normalized}`);
  }
  check("all 449 source terms re-derive their shipped key", mismatches.slice(0, 5), []);
}

console.log("\n--- 3. POSITIVE LOOKUPS across source families and categories ---");
console.log("    -- court procedure --");
for (const term of ["motion for summary judgment", "adversary proceeding", "bench trial", "arraignment", "discovery"]) {
  check(`${term} is attested`, isAttestedLegalTerminology(term), true);
}
console.log("    -- document --");
for (const term of ["complaint", "subpoena", "affidavit", "brief", "docket"]) {
  check(`${term} is attested`, isAttestedLegalTerminology(term), true);
}
console.log("    -- role --");
for (const term of ["trustee", "counsel", "debtor", "creditor", "magistrate judge"]) {
  check(`${term} is attested`, isAttestedLegalTerminology(term), true);
}
console.log("    -- bankruptcy --");
for (const term of ["341 meeting", "automatic stay", "bankruptcy estate", "no-asset case"]) {
  check(`${term} is attested`, isAttestedLegalTerminology(term), true);
}
console.log("    -- securities --");
for (const term of ["3(c)(1)", "3(c)(7)", "Blue Sky Laws", "Capitalization Table"]) {
  check(`${term} is attested`, isAttestedLegalTerminology(term), true);
}
console.log("    -- intellectual property --");
for (const term of ["abandoned application (trademarks)", "abstract of the disclosure", "cancellation proceeding"]) {
  check(`${term} is attested`, isAttestedLegalTerminology(term), true);
}
console.log("    -- employment --");
for (const term of ["reasonable accommodation", "retaliation"]) {
  check(`${term} is attested`, isAttestedLegalTerminology(term), true);
}
console.log("    -- privacy / compliance --");
for (const term of ["multi-factor authentication", "customer information"]) {
  check(`${term} is attested`, isAttestedLegalTerminology(term), true);
}

console.log("\n--- 4. NORMALIZATION BEHAVIOUR ---");
check("case-folded", normalizeForLegalLookup("Motion for Summary Judgment"), "motion for summary judgment");
check("whitespace collapsed and trimmed", normalizeForLegalLookup("  voir   dire \n"), "voir dire");
check("em dash folded to ASCII hyphen", normalizeForLegalLookup("cross—complaint"), "cross-complaint");
check("curly apostrophe folded", normalizeForLegalLookup("Debtor’s"), "debtor's");
console.log("    -- step 6: spaces around / and - are removed, and this is the ONE");
console.log("       difference from the finance policy --");
check("spaces around a hyphen removed", normalizeForLegalLookup("Cross - Complaint"), "cross-complaint");
check("spaces around a slash removed", normalizeForLegalLookup("CM / ECF"), "cm/ecf");
check("both spellings reach the same record",
  [legalTerminologyEvidenceFor("CM/ECF")?.normalized, legalTerminologyEvidenceFor("CM / ECF")?.normalized],
  ["cm/ecf", "cm/ecf"]);
console.log("    -- all other punctuation preserved --");
check("parentheses and digits retained", normalizeForLegalLookup("3(c)(1)"), "3(c)(1)");
check("apostrophes retained", normalizeForLegalLookup("Debtor's Estate"), "debtor's estate");
console.log("    -- precision over recall: no reordering, no approximation --");
check("a reordered phrase does NOT match", legalTerminologyEvidenceFor("summary judgment motion"), null);
check("a truncated phrase does NOT match", legalTerminologyEvidenceFor("motion for summary"), null);

console.log("\n--- 5. NEGATIVE CONTROLS ---");
console.log("    -- fabricated phrases that SOUND legal must not match --");
for (const absent of ["motion for expedited clarity", "writ of general inconvenience", "petition for retroactive alignment", "notice of tangential appeal"]) {
  check(`${absent} does not match`, legalTerminologyEvidenceFor(absent), null);
}
check("a personal name misses", legalTerminologyEvidenceFor("Amy Miller"), null);
check("a place name misses", legalTerminologyEvidenceFor("San Diego"), null);
check("the empty string misses", legalTerminologyEvidenceFor("   "), null);
console.log("    -- ABSENCE IS NOT COUNTER-EVIDENCE: real legal language that MISSES --");
console.log("       (contracts drafting, M&A, family law and immigration are documented gaps)");
for (const absent of ["condition precedent", "indemnification", "force majeure", "adjustment of status"]) {
  const hit = legalTerminologyEvidenceFor(absent);
  console.log(`       ${absent}: ${hit === null ? "MISS (not in this partial v1 dataset)" : "hit"}`);
}

console.log("\n--- 6. PROVENANCE IS PRESERVED, NOT COLLAPSED TO A BOOLEAN ---");
{
  const e = legalTerminologyEvidenceFor("motion for summary judgment");
  check("evidence family discriminator", e?.family, "legal-terminology");
  check("the phrase as passed in is preserved", e?.value, "motion for summary judgment");
  check("normalized key exposed", e?.normalized, "motion for summary judgment");
  const a = e?.attestations[0];
  check("matched display term, verbatim from source (casing intact)", a?.term, "Motion for Summary Judgment");
  check("source family preserved", a?.sourceFamily, "STATE_JUDICIARY_GLOSSARY");
  check("source name preserved", a?.source.length! > 0, true);
  check("source URL preserved", a?.sourceUrl.startsWith("https://"), true);
  check("authority level preserved", a?.sourceAuthorityLevel, "HIGH");
  check("BOTH semantic hints preserved", a?.semanticHints, ["DOCUMENT", "COURT_PROCEDURE"]);
  check("source-attested flag preserved", a?.sourceAttested, true);
  check("derived flag preserved", a?.derivedVariant, false);
  check("parent term is null for a source-attested row", a?.parentTerm, null);
  check("collision risk preserved", a?.collisionRisk, "LOW");
  check("legal rows carry no sub-domain", a?.subDomain, null);
  console.log("    -- the determination path from the brief, reconstructed from ONE record --");
  check("source -> matched term -> normalized -> family -> hints -> risk",
    [a?.sourceFamily, a?.term, e?.normalized, e?.family, a?.semanticHints.join("|"), a?.collisionRisk],
    ["STATE_JUDICIARY_GLOSSARY", "Motion for Summary Judgment", "motion for summary judgment",
     "legal-terminology", "DOCUMENT|COURT_PROCEDURE", "LOW"]);
}

console.log("\n--- 7. MULTI-HINT AND MULTI-SOURCE ROWS ---");
{
  console.log("    -- a term may span coarse categories, and both hints survive --");
  const complaint = legalTerminologyEvidenceFor("complaint");
  check("complaint carries more than one hint", (complaint?.semanticHints.length ?? 0) > 1, true);
  console.log("    -- co-attesting authorities are un-merged into separate attestations --");
  const dj = legalTerminologyEvidenceFor("Default judgment");
  check("two attesting rows retained", dj?.attestations.length, 2);
  check("both source families retained", dj?.sourceFamilies, ["FEDERAL_JUDICIARY_GLOSSARY", "STATE_JUDICIARY_GLOSSARY"]);
  check("multiplyAttested flag set", dj?.multiplyAttested, true);
  check("each attestation keeps its own URL", new Set(dj?.attestations.map((a) => a.sourceUrl)).size, 2);
}

console.log("\n--- 8. DERIVED VARIANTS REMAIN DISTINGUISHABLE ---");
{
  const derived = legalTerminologyEvidenceFor("ADR");
  check("the derived acronym matches", derived !== null, true);
  check("and is marked derived", derived?.attestations[0]?.derivedVariant, true);
  check("and names its parent", derived?.attestations[0]?.parentTerm, "Alternative dispute resolution (ADR)");
  check("and is NOT counted as a source-attested row", derived?.hasSourceAttestedRow, false);
  const parent = legalTerminologyEvidenceFor("Alternative dispute resolution (ADR)");
  check("the parent form also matches", parent !== null, true);
  check("and IS source-attested", parent?.hasSourceAttestedRow, true);
  console.log("    -- and the reviewer is told the difference, with the parent named --");
  check("the derived form's explanation names the parent",
    explainLegalTerminologyEvidence(derived).some((l) => l.includes('derived form of "Alternative dispute resolution (ADR)"')), true);
  check("the parent's explanation does not claim derivation",
    explainLegalTerminologyEvidence(parent).some((l) => l.includes("mechanically derived")), false);
  console.log("    -- a punctuation-variant derivation --");
  const proSe = legalTerminologyEvidenceFor("pro-se");
  check("pro-se matches and is derived", [proSe !== null, proSe?.attestations[0]?.derivedVariant], [true, true]);
}

/*
 * ============================================================================
 * 9. COLLISION IS PRESERVED, NEVER RESOLVED
 * ============================================================================
 *
 * The section the Legal brief is most explicit about: do not remove these
 * terms, do not downgrade person evidence because a legal hit exists, do not
 * treat HIGH risk as a reason to suppress. Two facts must remain separately
 * available -- "legal evidence exists" AND "collision risk is high".
 */
console.log("\n--- 9. HIGH COLLISION RISK, AND NAMES ---");
{
  for (const token of ["Doe", "Judge", "Levy", "Chambers", "Brief", "Counsel", "Court", "Record"]) {
    const hit = legalTerminologyEvidenceFor(token);
    const role = censusRoleFor(token);
    check(`${token}: attested terminology AND a Census name token`,
      [hit !== null, (role?.firstAttested ?? false) || (role?.surnameAttested ?? false)], [true, true]);
  }
  console.log("    -- Doe, Levy and Chambers are Census Top-1000 in every token, and are STILL returned --");
  for (const token of ["Doe", "Levy", "Chambers"]) {
    const role = censusRoleFor(token);
    check(`${token} is Top-1000`, (role?.firstTop1000 ?? false) || (role?.surnameTop1000 ?? false), true);
    check(`${token} evidence is returned in full anyway`, (legalTerminologyEvidenceFor(token)?.attestations.length ?? 0) > 0, true);
  }
  console.log("    -- the two facts stay SEPARATE: evidence exists, AND risk is high --");
  const doe = legalTerminologyEvidenceFor("Doe");
  check("evidence exists", doe !== null, true);
  check("risk is reported alongside it, not instead of it", doe?.highestCollisionRisk, "HIGH");
  check("single-token hits are not silently dropped (the GNIS trap is carried, not applied)", doe?.tokenCount, 1);
  check("the reviewer is TOLD about the collision rather than it being hidden",
    explainLegalTerminologyEvidence(doe).some((l) => l.includes("collision-prone")), true);
  console.log("    -- ROLE hints are NOT mapped to Person, ORGANIZATION not to Organization --");
  const trustee = legalTerminologyEvidenceFor("trustee");
  check("trustee is hinted ROLE", trustee?.semanticHints.includes("ROLE"), true);
  check("and the record exposes no type, decision or recommendation field",
    Object.keys(trustee ?? {}).filter((k) => /person|organization|semantictype|decision|keep|recommend/i.test(k)), []);
  console.log("    -- and two evidence families may attest the SAME string, unresolved --");
  const legalStock = legalTerminologyEvidenceFor("Stock");
  const finStock = financeAccountingTaxEvidenceFor("stock");
  check("Stock is attested legal terminology", legalStock !== null, true);
  check("stock is ALSO attested finance terminology", finStock !== null, true);
  check("neither family knows about the other -- no precedence, no resolution",
    [legalStock?.family, finStock?.family], ["legal-terminology", "finance-accounting-tax"]);
  const legalSettlement = legalTerminologyEvidenceFor("settlement");
  const finSettlement = financeAccountingTaxEvidenceFor("settlement");
  check("settlement is attested by BOTH families, with different authorities",
    [legalSettlement?.sourceFamilies.length! > 0, finSettlement?.sourceFamilies.length], [true, 3]);
}

/*
 * ============================================================================
 * 10. NO PRODUCTION PATH CAN CONSUME THIS EVIDENCE
 * ============================================================================
 *
 * See the same section in the finance suite for why inertness is pinned as a
 * structural guard rather than by flipping an inert boolean. A field cannot
 * be flipped if it does not exist; if someone later adds one, this fails.
 *
 * THIS IS A STATIC/STRUCTURAL GUARD, NOT A BEHAVIOURAL PROOF. Behavioural
 * inertness is established by running the existing verification battery
 * unchanged -- see the integration report.
 */
console.log("\n--- 10. NO ROUTE FROM ATTESTATION TO CLASSIFICATION ---");
{
  const base = (over: Partial<SemanticTypeFacts>): SemanticTypeFacts => ({
    detectedType: "person",
    categories: [],
    relationshipKinds: new Set<RelationshipKind>(),
    ...over,
  });
  const cases: Array<[string, SemanticTypeFacts]> = [
    ["person detection, name evidence (a real person named Levy)", base({ categories: ["known-personal-name-token"] })],
    ["person detection, shape only", base({ categories: ["strong-name-structure"] })],
    ["person detection, no evidence", base({})],
    ["organization detection", base({ detectedType: "organization" })],
    ["institutional categories", base({ detectedType: "unknown", categories: ["department-organization"] })],
    ["acronym", base({ detectedType: "unknown", categories: ["likely-acronym"] })],
  ];
  console.log("    -- the facts type carries no legal channel --");
  for (const [label, facts] of cases) {
    check(`SemanticTypeFacts has no legal key -- ${label}`,
      Object.keys(facts).filter((k) => /legal|court|judicial/i.test(k)), []);
  }
  console.log("    -- and the type functions are stable for these facts regardless --");
  for (const [label, facts] of cases) {
    const first = semanticTypeFor(facts);
    check(`semanticTypeFor is a pure function of the facts it declares -- ${label} (${first})`, semanticTypeFor({ ...facts }), first);
    for (const rejected of [false, true]) {
      const a = typeCheckSectionFor(facts, rejected);
      check(`typeCheckSectionFor stable -- ${label}, rejected=${rejected} (${a})`, typeCheckSectionFor({ ...facts }, rejected), a);
    }
  }
}

console.log("\n--- 11. THE EXPLANATION STATES AN OBSERVATION, NEVER A VERDICT ---");
{
  const lines = explainLegalTerminologyEvidence(legalTerminologyEvidenceFor("motion for summary judgment"));
  check("the licensed sentence is produced", lines[0], '"Motion for Summary Judgment" is attested legal terminology (STATE_JUDICIARY_GLOSSARY).');
  const forbidden = /not a person|is not a|therefore|must be|should be redacted|keep this/i;
  const offenders: string[] = [];
  for (const term of ["motion for summary judgment", "Doe", "Judge", "trustee", "ADR", "Default judgment", "complaint"]) {
    for (const line of explainLegalTerminologyEvidence(legalTerminologyEvidenceFor(term))) {
      if (forbidden.test(line)) offenders.push(line);
    }
  }
  check("no explanation line draws a conclusion about what the phrase IS", offenders, []);
}

console.log(`\n=== legal terminology evidence: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exitCode = 1;
