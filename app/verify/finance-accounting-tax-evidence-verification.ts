/**
 * finance-accounting-tax-evidence-verification.ts (AG, 2026-08-10).
 *
 * The load-bearing half of this suite is NEGATIVE, for the same reason the
 * Census and higher-ed suites' are. Asserting that the dataset finds
 * `adjusted gross income` is easy. The assertions that matter are the ones
 * that fail if terminology attestation ever starts behaving like
 * classification, if HIGH collision risk ever starts acting as proof of
 * non-personhood, or if the runtime normalizer ever drifts from the shipped
 * keys.
 *
 * Sections 9 and 10 are the ones to read first: 9 pins that a collision-prone
 * term still returns evidence rather than being filtered, and 10 pins that no
 * production path can consume this evidence at all today.
 *
 * Run:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs \
 *        verify/finance-accounting-tax-evidence-verification.ts
 */

import {
  explainFinanceAccountingTaxEvidence,
  financeAccountingTaxEvidenceFor,
  isAttestedFinanceAccountingTaxTerminology,
  normalizeForFinanceAccountingTaxLookup,
  FINANCE_TAX_EVIDENCE_ROW_COUNT,
  FINANCE_TAX_EVIDENCE_SOURCE,
  FINANCE_TAX_EVIDENCE_TERM_COUNT,
} from "../src/engines/knowledge/FinanceAccountingTaxEvidence.js";
import { FINANCE_TAX_PACK } from "../src/engines/knowledge/finance-accounting-tax-terminology.data.js";
import { censusRoleFor } from "../src/engines/knowledge/CensusNameEvidence.js";
import { legalTerminologyEvidenceFor } from "../src/engines/knowledge/LegalTerminologyEvidence.js";
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
check("row count", FINANCE_TAX_EVIDENCE_ROW_COUNT, 710);
check("distinct normalized terms", FINANCE_TAX_EVIDENCE_TERM_COUNT, 651);
check("provenance recorded", FINANCE_TAX_EVIDENCE_SOURCE, "docscrub-finance-accounting-tax-terminology/2026-08-10");
{
  const lines = FINANCE_TAX_PACK.rows.split("\n").filter((l) => l.length > 0);
  check("every shipped row is present", lines.length, 710);
  check("every row has 13 tab-separated fields", lines.every((l) => l.split("\t").length === 13), true);
  check("intern table slot 0 is the empty string (strings)", FINANCE_TAX_PACK.strings[0], "");
  check("intern table slot 0 is the empty string (subDomains)", FINANCE_TAX_PACK.subDomains[0], "");
}

/*
 * THE STRONGEST CHECK IN THE SUITE, and it is cheap.
 *
 * The shipped keys were produced by the dataset's own Python generator. The
 * runtime normalizer is a SECOND implementation of the same documented steps
 * in TypeScript. Two implementations of one algorithm is exactly the shape
 * that drifts silently -- a drift here is not a build error, it is a lookup
 * that quietly misses. So: re-normalize every shipped source term and require
 * it to reproduce its own key, all 710 of them.
 */
console.log("\n--- 2. NORMALIZATION PARITY over the whole dataset ---");
{
  const mismatches: string[] = [];
  for (const line of FINANCE_TAX_PACK.rows.split("\n")) {
    if (line.length === 0) continue;
    const [normalized, term] = line.split("\t");
    const derived = normalizeForFinanceAccountingTaxLookup(term!);
    if (derived !== normalized) mismatches.push(`${term} -> ${derived} != ${normalized}`);
  }
  check("all 710 source terms re-derive their shipped key", mismatches.slice(0, 5), []);
}

console.log("\n--- 3. POSITIVE LOOKUPS, all three sub-domains ---");
console.log("    -- TAX --");
for (const term of ["adjusted gross income", "Schedule C", "estimated tax", "capital gain", "withholding", "basis"]) {
  check(`${term} is attested`, isAttestedFinanceAccountingTaxTerminology(term), true);
}
console.log("    -- ACCOUNTING --");
for (const term of ["accounts receivable", "accounts payable", "general ledger", "balance sheet", "cash flow statement", "depreciation"]) {
  check(`${term} is attested`, isAttestedFinanceAccountingTaxTerminology(term), true);
}
console.log("    -- FINANCE --");
for (const term of ["broker-dealer", "mortgage", "certificate of deposit", "security", "mutual fund", "prospectus"]) {
  check(`${term} is attested`, isAttestedFinanceAccountingTaxTerminology(term), true);
}

console.log("\n--- 4. NORMALIZATION BEHAVIOUR ---");
check("case-folded", normalizeForFinanceAccountingTaxLookup("Adjusted Gross Income"), "adjusted gross income");
check("whitespace collapsed and trimmed", normalizeForFinanceAccountingTaxLookup("  general   ledger \n"), "general ledger");
check("en dash folded to ASCII hyphen", normalizeForFinanceAccountingTaxLookup("broker–dealer"), "broker-dealer");
check("curly apostrophe folded", normalizeForFinanceAccountingTaxLookup("Taxpayer’s"), "taxpayer's");
check("NFKC applied", normalizeForFinanceAccountingTaxLookup("ﬁling"), "filing");
check("equivalent display forms reach the same record", financeAccountingTaxEvidenceFor("ADJUSTED   Gross Income")?.normalized, "adjusted gross income");
/*
 * PUNCTUATION IS PRESERVED, and this is the assertion that pins the policy
 * difference from higher-ed and Census. The methodology states the
 * consequence directly: `Form 10-K` must NOT become equal to `Form 10K`.
 * Where an alternate is mechanically safe the DATASET ships it as an explicit
 * derived row -- nothing is derived at lookup time.
 */
console.log("    -- punctuation preserved, NOT stripped or spaced --");
check("hyphen retained", normalizeForFinanceAccountingTaxLookup("Form 10-K"), "form 10-k");
check("Form 10-K and Form 10K are DIFFERENT keys",
  normalizeForFinanceAccountingTaxLookup("Form 10-K") === normalizeForFinanceAccountingTaxLookup("Form 10K"), false);
check("parentheses retained", normalizeForFinanceAccountingTaxLookup("Annual Report (10-K)"), "annual report (10-k)");
check("both parenthetical alternates ship as their own rows",
  [financeAccountingTaxEvidenceFor("Annual Report (10-K)") !== null, financeAccountingTaxEvidenceFor("Annual Report (10K)") !== null],
  [true, true]);

console.log("\n--- 5. NEGATIVE CONTROLS ---");
console.log("    -- fabricated phrases that SOUND financial must not match --");
for (const absent of ["quarterly synergy allowance", "deferred goodwill velocity", "aggregate fiscal posture", "reconciliation of retained sentiment"]) {
  check(`${absent} does not match`, financeAccountingTaxEvidenceFor(absent), null);
}
check("a personal name misses", financeAccountingTaxEvidenceFor("Amy Miller"), null);
check("a place name misses", financeAccountingTaxEvidenceFor("San Diego"), null);
check("the empty string misses", financeAccountingTaxEvidenceFor("   "), null);
console.log("    -- ABSENCE IS NOT COUNTER-EVIDENCE: real financial language that MISSES --");
console.log("       (state tax, insurance and corporate-treasury vocabulary are documented gaps)");
for (const absent of ["franchise tax board", "deductible", "premium", "escrow analysis"]) {
  const hit = financeAccountingTaxEvidenceFor(absent);
  console.log(`       ${absent}: ${hit === null ? "MISS (not in this partial v1 dataset)" : "hit"}`);
}

console.log("\n--- 6. PROVENANCE IS PRESERVED, NOT COLLAPSED TO A BOOLEAN ---");
{
  const e = financeAccountingTaxEvidenceFor("adjusted gross income");
  check("evidence family discriminator", e?.family, "finance-accounting-tax");
  check("the phrase as passed in is preserved", e?.value, "adjusted gross income");
  check("normalized key exposed", e?.normalized, "adjusted gross income");
  const a = e?.attestations[0];
  check("matched display term, verbatim from source", a?.term, "adjusted gross income");
  check("sub-domain preserved", a?.subDomain, "TAX");
  check("source family preserved", a?.sourceFamily, "IRS");
  check("source name preserved", a?.source, "IRS Understanding Taxes – Glossary");
  check("source URL preserved", a?.sourceUrl.startsWith("https://apps.irs.gov/"), true);
  check("authority level preserved", a?.sourceAuthorityLevel, "US_FEDERAL_TAX_AUTHORITY");
  check("semantic hint preserved", a?.semanticHints, ["TAX_CONCEPT"]);
  check("source-attested flag preserved", a?.sourceAttested, true);
  check("derived flag preserved", a?.derivedVariant, false);
  check("collision risk preserved", a?.collisionRisk, "MEDIUM");
  console.log("    -- the determination path is fully reconstructible from ONE record --");
  check("source family -> source -> matched term -> normalized -> claim",
    [a?.sourceFamily, a?.term, e?.normalized, e?.family],
    ["IRS", "adjusted gross income", "adjusted gross income", "finance-accounting-tax"]);
}
console.log("    -- acronym provenance is local to its source, never a global meaning --");
{
  const e = financeAccountingTaxEvidenceFor("ABS");
  check("ABS is attested", e !== null, true);
  check("acronym recorded", e?.attestations[0]?.acronym, "ABS");
  check("expansion recorded", e?.attestations[0]?.acronymExpansion, "Asset-Backed Securities");
  check("the explanation says the expansion is source-local",
    explainFinanceAccountingTaxEvidence(e).some((l) => l.includes("not a globally unique meaning")), true);
}

console.log("\n--- 7. MULTIPLE ATTESTATIONS SURVIVE LOOKUP ---");
{
  const interest = financeAccountingTaxEvidenceFor("interest");
  check("four attesting rows retained, not deduplicated", interest?.attestations.length, 4);
  // Shipped order, i.e. source-CSV order within the key -- NOT sorted. The
  // order is provenance (it is the order the dataset recorded), not ranking.
  check("all four source families retained", interest?.sourceFamilies, ["CFPB", "FDIC", "SEC_INVESTOR_GOV", "IRS"]);
  check("multiplyAttested flag set", interest?.multiplyAttested, true);
  console.log("    -- and cross-sub-domain attestation is NOT collapsed to one reading --");
  const basis = financeAccountingTaxEvidenceFor("basis");
  check("basis is attested in BOTH sub-domains", basis?.subDomains, ["FINANCE", "TAX"]);
  check("with different hints from each, both kept", basis?.semanticHints, ["FINANCIAL_CONCEPT", "TAX_CONCEPT"]);
  check("by different authorities, both kept", basis?.sourceFamilies, ["CFTC", "IRS"]);
  const balance = financeAccountingTaxEvidenceFor("account balance");
  check("account balance is ACCOUNTING and FINANCE", balance?.subDomains, ["ACCOUNTING", "FINANCE"]);
  console.log("    -- highest risk across rows, because a warning on any row is a warning --");
  check("highestCollisionRisk is the max, not the first", interest?.highestCollisionRisk, "HIGH");
}

console.log("\n--- 8. DERIVED VARIANTS REMAIN DISTINGUISHABLE ---");
{
  const derived = financeAccountingTaxEvidenceFor("cost-basis");
  check("the derived form matches", derived !== null, true);
  check("and is marked derived", derived?.attestations[0]?.derivedVariant, true);
  check("and names its parent", derived?.attestations[0]?.parentTerm, "cost basis");
  check("and is NOT counted as a source-attested row", derived?.hasSourceAttestedRow, false);
  const parent = financeAccountingTaxEvidenceFor("cost basis");
  check("the parent form also matches", parent !== null, true);
  check("and IS source-attested", parent?.hasSourceAttestedRow, true);
  check("and is not marked derived", parent?.attestations[0]?.derivedVariant, false);
  console.log("    -- and the reviewer is told the difference --");
  check("the derived form's explanation says so",
    explainFinanceAccountingTaxEvidence(derived).some((l) => l.includes("mechanically derived")), true);
  check("the parent's explanation does not",
    explainFinanceAccountingTaxEvidence(parent).some((l) => l.includes("mechanically derived")), false);
}

/*
 * ============================================================================
 * 9. COLLISION IS PRESERVED, NEVER RESOLVED
 * ============================================================================
 *
 * The section that decides whether this pack is evidence or a classifier. A
 * collision-prone term must still return its evidence in full, and carry its
 * warning, and NOT be filtered, downgraded, or turned into a claim about what
 * the phrase is.
 */
console.log("\n--- 9. HIGH COLLISION RISK, AND NAMES ---");
{
  for (const token of ["stock", "gain", "loss", "salary", "bond", "credit"]) {
    const hit = financeAccountingTaxEvidenceFor(token);
    const role = censusRoleFor(token);
    check(`${token}: attested terminology AND a Census name token`,
      [hit !== null, (role?.firstAttested ?? false) || (role?.surnameAttested ?? false)], [true, true]);
  }
  console.log("    -- the module NEVER filters, downgrades or suppresses these --");
  const basis = financeAccountingTaxEvidenceFor("basis");
  check("a HIGH-risk hit is still returned in full", basis?.attestations.length, 2);
  check("flagged HIGH", basis?.highestCollisionRisk, "HIGH");
  check("single-token hits are not silently dropped (the GNIS trap is carried, not applied)",
    financeAccountingTaxEvidenceFor("margin")?.tokenCount, 1);
  check("the reviewer is TOLD about the collision rather than it being hidden",
    explainFinanceAccountingTaxEvidence(basis).some((l) => l.includes("collision-prone")), true);
  console.log("    -- and two evidence families may attest the SAME string, unresolved --");
  const finAdr = financeAccountingTaxEvidenceFor("ADR");
  const legalAdr = legalTerminologyEvidenceFor("ADR");
  check("ADR is attested by finance (American Depositary Receipt)", finAdr?.attestations[0]?.acronymExpansion, "American Depositary Receipt");
  check("ADR is ALSO attested by legal (Alternative Dispute Resolution)", legalAdr?.attestations[0]?.parentTerm, "Alternative dispute resolution (ADR)");
  check("neither family knows about the other -- no precedence, no resolution",
    [finAdr?.family, legalAdr?.family], ["finance-accounting-tax", "legal-terminology"]);
  console.log("    -- and no exported function answers a classification question --");
  check("no isPerson/isOrganization/suggestedType on the record (shape check)",
    Object.keys(basis ?? {}).filter((k) => /person|organization|semantictype|decision|keep|recommend/i.test(k)), []);
}

/*
 * ============================================================================
 * 10. NO PRODUCTION PATH CAN CONSUME THIS EVIDENCE
 * ============================================================================
 *
 * Higher-ed and Medical each thread an inert boolean
 * (`higherEdTerminologyAttested`, `medicalTerminologyAttested`) into
 * `SemanticTypeFacts` and assert that flipping it changes nothing. This pack
 * deliberately does NOT add a third such field -- see
 * docs/detection/domain-reference-evidence.md for why -- so inertness is
 * pinned differently, and more strongly: the facts type has NO channel
 * through which finance attestation could reach the type functions at all.
 *
 * A field cannot be flipped if it does not exist. If someone later adds one,
 * this section fails, and that is the intent: consuming this evidence should
 * be a deliberate, reviewed change to a documented contract rather than a
 * quiet one-line addition.
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
    ["person detection, name evidence", base({ categories: ["known-personal-name-token"] })],
    ["person detection, shape only", base({ categories: ["strong-name-structure"] })],
    ["person detection, no evidence", base({})],
    ["organization detection", base({ detectedType: "organization" })],
    ["institutional categories", base({ detectedType: "unknown", categories: ["department-organization"] })],
    ["acronym", base({ detectedType: "unknown", categories: ["likely-acronym"] })],
  ];
  console.log("    -- the facts type carries no finance channel --");
  for (const [label, facts] of cases) {
    check(`SemanticTypeFacts has no finance/tax key -- ${label}`,
      Object.keys(facts).filter((k) => /finance|accounting|tax/i.test(k)), []);
  }
  console.log("    -- and the type functions are stable for these facts regardless --");
  for (const [label, facts] of cases) {
    const first = semanticTypeFor(facts);
    const second = semanticTypeFor({ ...facts });
    check(`semanticTypeFor is a pure function of the facts it declares -- ${label} (${first})`, second, first);
    for (const rejected of [false, true]) {
      const a = typeCheckSectionFor(facts, rejected);
      const b = typeCheckSectionFor({ ...facts }, rejected);
      check(`typeCheckSectionFor stable -- ${label}, rejected=${rejected} (${a})`, b, a);
    }
  }
}

console.log("\n--- 11. THE EXPLANATION STATES AN OBSERVATION, NEVER A VERDICT ---");
{
  const lines = explainFinanceAccountingTaxEvidence(financeAccountingTaxEvidenceFor("adjusted gross income"));
  check("the licensed sentence is produced", lines[0], '"adjusted gross income" is attested finance/accounting/tax terminology [TAX] (IRS).');
  const forbidden = /not a person|is not a|therefore|must be|should be redacted|keep this|organization$/i;
  const offenders: string[] = [];
  for (const term of ["adjusted gross income", "basis", "stock", "cost-basis", "ABS", "interest", "Schedule C"]) {
    for (const line of explainFinanceAccountingTaxEvidence(financeAccountingTaxEvidenceFor(term))) {
      if (forbidden.test(line)) offenders.push(line);
    }
  }
  check("no explanation line draws a conclusion about what the phrase IS", offenders, []);
  console.log("    -- and it never claims the document contains anyone's finances --");
  const financialClaim = /this (document|person|candidate) (has|contains|owns)|income of|owes|financial information about/i;
  const claims: string[] = [];
  for (const term of ["adjusted gross income", "capital gain", "withholding", "Schedule C"]) {
    for (const line of explainFinanceAccountingTaxEvidence(financeAccountingTaxEvidenceFor(term))) {
      if (financialClaim.test(line)) claims.push(line);
    }
  }
  check("no explanation line infers a financial fact about anyone", claims, []);
}

console.log(`\n=== finance/accounting/tax evidence: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exitCode = 1;
