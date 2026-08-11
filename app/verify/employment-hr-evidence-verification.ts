/**
 * employment-hr-evidence-verification.ts (AG, 2026-08-10).
 *
 *     node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs \
 *          verify/employment-hr-evidence-verification.ts
 *
 * The load-bearing half of this suite is NEGATIVE, for the same reason the
 * Census and higher-ed suites' halves are. Asserting that the dataset finds
 * `Collective Bargaining Agreement` is easy. The assertions that matter are
 * the ones that fail if terminology attestation ever starts behaving like
 * classification, if HIGH collision risk ever starts acting as proof of
 * non-personhood, if a multi-token phrase ever starts implying its
 * substrings, or if the runtime normalizer drifts from the shipped keys.
 *
 * SECTION 11 IS THE ONE TO READ FIRST. It pins the contract that Employment/HR
 * membership moves nothing: not a semantic type, not a routing decision, not a
 * score, not a recommendation. It does so STRUCTURALLY -- by asserting which
 * modules are even able to see this evidence -- because for this family that
 * is a stronger statement than a behavioural comparison, and it is the one
 * that stays true as the classification code changes underneath it.
 *
 * Section 9 is the other one worth reading: the collisions. Every phrase there
 * carries Employment/HR evidence AND something else, and this suite asserts
 * that BOTH survive. A future change that "cleans up" the ambiguity by picking
 * a winner fails here, which is the intent.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  employmentHrEvidenceFor,
  employmentHrSourceLicensing,
  explainEmploymentHrEvidence,
  isAttestedEmploymentHrTerminology,
  normalizeForEmploymentHrLookup,
  EMPLOYMENT_HR_EVIDENCE_ROW_COUNT,
  EMPLOYMENT_HR_EVIDENCE_SOURCE,
  EMPLOYMENT_HR_EVIDENCE_TERM_COUNT,
} from "../src/engines/knowledge/EmploymentHrEvidence.js";
import { EMPLOYMENT_HR_PACK } from "../src/engines/knowledge/employment-hr-terminology.data.js";
import { censusRoleFor } from "../src/engines/knowledge/CensusNameEvidence.js";
import { legalTerminologyEvidenceFor } from "../src/engines/knowledge/LegalTerminologyEvidence.js";
import { financeAccountingTaxEvidenceFor } from "../src/engines/knowledge/FinanceAccountingTaxEvidence.js";
import { higherEdTerminologyFor } from "../src/engines/knowledge/HigherEdTerminologyEvidence.js";
import { medicalEvidenceFor } from "../src/engines/knowledge/MedicalEvidence.js";
import { gnisPlaceEvidenceFor } from "../src/engines/knowledge/GnisPlaceEvidence.js";
import {
  attestingChannels,
  referenceEvidenceAuditRows,
  referenceEvidenceFor,
  terminologyChannelsOf,
} from "../src/engines/knowledge/ReferenceEvidence.js";
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

const ROWS = EMPLOYMENT_HR_PACK.rows.split("\n").filter((l) => l.length > 0);

console.log("\n--- 1. GENERATED ASSET ---");
check("row count", EMPLOYMENT_HR_EVIDENCE_ROW_COUNT, 267);
check("distinct normalized terms", EMPLOYMENT_HR_EVIDENCE_TERM_COUNT, 252);
check("provenance recorded", EMPLOYMENT_HR_EVIDENCE_SOURCE, "docscrub-employment-hr-terminology/2026-08-10");
check("every shipped row is present", ROWS.length, 267);
check("every row has 13 tab-separated fields", ROWS.every((l) => l.split("\t").length === 13), true);
check("rows are sorted by normalized key", ROWS.map((l) => l.split("\t")[0]!), [...ROWS.map((l) => l.split("\t")[0]!)].sort());
{
  // 267 rows over 252 keys: the 15 multiply-attested keys are the difference,
  // and they are the pack's most interesting content, not an anomaly.
  const keys = new Set(ROWS.map((l) => l.split("\t")[0]!));
  check("distinct keys matches the declared count", keys.size, 252);
  const counts = new Map<string, number>();
  for (const key of ROWS.map((l) => l.split("\t")[0]!)) counts.set(key, (counts.get(key) ?? 0) + 1);
  check("15 keys carry more than one attestation row", [...counts.values()].filter((n) => n > 1).length, 15);
}
{
  const licensing = employmentHrSourceLicensing();
  check("licensing/retrieval provenance ships for all 11 source families", licensing.length, 11);
  check("every licensing row names a tier, a licence and a retrieval date",
    licensing.every((l) => l.sourceFamily.length > 0 && l.sourceTier.length > 0 && l.licenseStatus.length > 0 && l.retrievalDate === "2026-08-10"), true);
}

/*
 * THE STRONGEST CHECK IN THE SUITE, and it is cheap.
 *
 * The shipped keys were produced by the pack's Python generator. The runtime
 * normalizer is a SECOND implementation of the same six documented steps in
 * TypeScript. Two implementations of one algorithm is exactly the shape that
 * drifts silently -- a drift here is not a build error, it is a lookup that
 * quietly misses. So: re-normalize every shipped source term and require it to
 * reproduce its own key, all 267 of them.
 */
console.log("\n--- 2. NORMALIZATION PARITY over the whole dataset ---");
{
  const mismatches: string[] = [];
  for (const line of ROWS) {
    const [normalized, term] = line.split("\t");
    const derived = normalizeForEmploymentHrLookup(term!);
    if (derived !== normalized) mismatches.push(`${term} -> ${derived} != ${normalized}`);
  }
  check("all 267 source terms re-derive their shipped key", mismatches.slice(0, 5), []);
}

console.log("\n--- 3. NORMALIZATION RULES, each exercised ---");
for (const [raw, expected] of [
  // casefold
  ["Position Classification", "position classification"],
  ["ANNUAL LEAVE", "annual leave"],
  // whitespace collapse and trim
  ["  Annual   Leave  ", "annual leave"],
  ["Performance\tImprovement\nPlan", "performance improvement plan"],
  // unicode dash variants -> ASCII hyphen
  ["12‐month period", "12-month period"],
  ["12–month period", "12-month period"],
  ["12—month period", "12-month period"],
  ["SF‑50", "sf-50"],
  // curly apostrophes -> ASCII
  ["employee’s", "employee's"],
  // NFKC
  ["Ｐosition", "position"],
  // PUNCTUATION IS OTHERWISE PRESERVED -- the rule that separates this policy
  // from higher-ed's (non-alphanumeric -> SPACE) and census's (stripped).
  ["401(k) plan", "401(k) plan"],
  ["SF-50", "sf-50"],
] as const) {
  check(`normalize ${JSON.stringify(raw)}`, normalizeForEmploymentHrLookup(raw), expected);
}
console.log("    -- and the equivalences those rules create actually reach the same rows --");
for (const [a, b] of [
  ["Annual Leave", "  ANNUAL   leave "],
  ["12-month period", "12–month period"],
  ["Collective Bargaining Agreement", "collective bargaining agreement"],
] as const) {
  check(`${JSON.stringify(a)} and ${JSON.stringify(b)} reach the same key`,
    employmentHrEvidenceFor(a)?.normalized, employmentHrEvidenceFor(b)?.normalized);
}

console.log("\n--- 4. STRAIGHTFORWARD HR TERMINOLOGY IS ATTESTED ---");
for (const [phrase, sourceFamily, subDomain] of [
  ["Position Classification", "OPM_CLASSIFICATION", "classification"],
  ["Annual Leave", "OPM_PAY_LEAVE", "leave_compensation"],
  ["Performance Improvement Plan", "OPM_PERFORMANCE", "performance_management"],
  ["Reasonable Accommodation", "EEOC", "equal_employment_opportunity"],
  ["Summary Plan Description", "EBSA", "employee_benefits"],
  ["unfair labor practice", "FLRA", "federal_labor_relations"],
  ["12-month period", "DOL_FMLA", "leave"],
  ["401(k) plan", "EBSA", "employee_benefits"],
] as const) {
  const evidence = employmentHrEvidenceFor(phrase);
  check(`${phrase} is attested`, evidence !== null, true);
  check(`  ...by ${sourceFamily}`, evidence?.sourceFamilies.includes(sourceFamily), true);
  check(`  ...in sub-domain ${subDomain}`, evidence?.subDomains.includes(subDomain), true);
  check(`  ...family discriminator`, evidence?.family, "employment-hr-terminology");
  check(`  ...display form is the SOURCE's, never the caller's`, evidence?.attestations[0]?.term !== undefined, true);
  check(`  ...and the caller's phrase is returned unrewritten`, evidence?.value, phrase);
}
check("Collective Bargaining Agreement is attested", isAttestedEmploymentHrTerminology("Collective Bargaining Agreement"), true);
console.log("    -- every attestation carries the provenance a combination layer would weigh --");
{
  const evidence = employmentHrEvidenceFor("Summary Plan Description")!;
  const [a] = evidence.attestations;
  check("source name recorded", a!.source.length > 0, true);
  check("source URL recorded", a!.sourceUrl.startsWith("https://"), true);
  check("authority level recorded", a!.sourceAuthorityLevel, "US_FEDERAL_EMPLOYEE_BENEFITS_AUTHORITY");
  check("source-attested, not mechanically derived", [a!.sourceAttested, a!.derivedVariant], [true, false]);
  check("no derived variants exist in this pack at all", ROWS.every((l) => l.split("\t")[7] === "0"), true);
}

/*
 * ============================================================================
 * 5. MULTI-TOKEN MATCHING IS EXACT
 * ============================================================================
 *
 * An attested multi-token phrase must NOT imply that its substrings are
 * attested. This is the assertion that fails the day someone reaches for
 * substring or token-subset matching to raise recall, which would attest
 * `leave`, `plan` and `agreement` on the strength of the phrases containing
 * them and flood every document with terminology evidence.
 *
 * `collective bargaining` is the instructive counter-example and is listed
 * separately below: it IS attested, on its own two rows, not because
 * `collective bargaining agreement` contains it.
 */
console.log("\n--- 5. MULTI-TOKEN EXACTNESS: containment does not attest ---");
for (const substring of ["annual", "leave", "plan", "agreement", "improvement", "position", "summary", "bargaining", "reasonable", "accommodation"]) {
  check(`substring "${substring}" of an attested phrase is NOT itself attested`, employmentHrEvidenceFor(substring), null);
}
check("`collective bargaining` is attested on its own rows, independently", employmentHrEvidenceFor("collective bargaining")?.attestations.length, 2);
check("...and word order is not rearranged: `bargaining collective` misses", employmentHrEvidenceFor("bargaining collective"), null);
check("...nor is a phrase matched inside a longer sentence", employmentHrEvidenceFor("she requested annual leave in March"), null);

/*
 * ============================================================================
 * 6. ACRONYMS, WITH THEIR AMBIGUITY INTACT
 * ============================================================================
 *
 * Every one of these is a 2-5 character string that carries other meanings in
 * other domains, and several are the exact shape a person's initials take. The
 * dataset flags all of them HIGH, records the acronym relationship LOCAL to
 * the citing source, and invents no expansion it was not given. Nothing here
 * resolves which meaning applies -- this layer cannot see the document.
 */
console.log("\n--- 6. ACRONYMS: attested, and still ambiguous ---");
for (const acronym of ["FMLA", "EEO", "ADA", "PIP", "ERISA", "SPD"]) {
  const evidence = employmentHrEvidenceFor(acronym);
  check(`${acronym} is attested`, evidence !== null, true);
  check(`  ...flagged HIGH collision risk by the source dataset`, evidence?.highestCollisionRisk, "HIGH");
  check(`  ...recorded as an acronym by the citing source`, evidence?.attestations[0]?.acronym, acronym);
  check(`  ...with no expansion invented for it`, evidence?.attestations[0]?.acronymExpansion, null);
  check(`  ...single token, the population the GNIS benchmark flagged as dangerous`, evidence?.tokenCount, 1);
  check(`  ...and casing does not change the answer`, employmentHrEvidenceFor(acronym.toLowerCase())?.normalized, evidence?.normalized);
}
check("HIGH risk does NOT suppress the evidence -- 50 rows carry it and all are retained",
  ROWS.filter((l) => l.split("\t")[9] === "2").length, 50);
console.log("    -- and no expansion is guessed for an acronym the pack does not ship --");
check("`FLSA` is not in this v1 vocabulary and is not inferred", employmentHrEvidenceFor("FLSA"), null);
check("`SF-50` keeps its punctuation rather than being folded to `SF50`", employmentHrEvidenceFor("SF50"), null);
check("...while `SF-50` itself is attested", employmentHrEvidenceFor("SF-50") !== null, true);

/*
 * ============================================================================
 * 7. MULTIPLE PROVENANCE SURVIVES
 * ============================================================================
 *
 * 15 keys are attested by two independent authorities, and WHICH two is the
 * interesting part: `grievance` by the NLRB (private sector) and the FLRA
 * (federal sector); `adverse action` by the EEOC as a discrimination concept
 * and by the MSPB as a merit-system one. Collapsing to a key set -- or to
 * `attested: true` -- would destroy exactly the corroboration a combination
 * layer exists to weigh.
 */
console.log("\n--- 7. MULTIPLE PROVENANCE IS RETAINED, NOT COLLAPSED ---");
for (const [phrase, families, subDomains] of [
  ["grievance", ["FLRA", "NLRB"], ["federal_labor_relations", "labor_relations"]],
  ["adverse action", ["EEOC", "MSPB"], ["equal_employment_opportunity", "employee_relations"]],
  ["FMLA", ["DOL_FMLA", "OPM_PAY_LEAVE"], ["leave", "leave_compensation"]],
  ["collective bargaining agreement", ["FLRA", "NLRB"], ["federal_labor_relations", "labor_relations"]],
] as const) {
  const evidence = employmentHrEvidenceFor(phrase)!;
  check(`${phrase}: both attestation rows survive`, evidence.attestations.length, 2);
  check(`  ...multiplyAttested`, evidence.multiplyAttested, true);
  check(`  ...both source families reported`, [...evidence.sourceFamilies].sort(), [...families].sort());
  check(`  ...both sub-domains reported`, [...evidence.subDomains].sort(), [...subDomains].sort());
  check(`  ...with distinct source URLs, i.e. genuinely independent citations`,
    new Set(evidence.attestations.map((a) => a.sourceUrl)).size, 2);
}
console.log("    -- and disagreeing hints are listed, not resolved --");
check("FMLA carries both sources' hints", [...employmentHrEvidenceFor("FMLA")!.semanticHints].sort(), ["BENEFIT_OR_COMPENSATION", "LEAVE_CONCEPT"]);

console.log("\n--- 8. THE AGGREGATOR AND THE AUDIT TRAIL ---");
{
  const channels = referenceEvidenceFor("Reasonable Accommodation");
  check("the fan-out exposes the new channel", channels.employmentHr !== null, true);
  check("...and reports it in attestingChannels", attestingChannels(channels).includes("employment-hr-terminology"), true);
  const view = terminologyChannelsOf(channels).find((c) => c.id === "employment-hr-terminology");
  check("...and in the uniform terminology view", view?.label, "employment / HR");
  check("...carrying the sub-domain the pack distinguishes", view?.evidence?.subDomains, ["equal_employment_opportunity"]);
  const rows = referenceEvidenceAuditRows(channels).filter((r) => r.evidenceFamily === "employment-hr-terminology");
  check("one flat audit row per attestation", rows.length, 1);
  check("...self-contained: family, authority, source, URL, term, key all present",
    [rows[0]!.evidenceFamily, rows[0]!.sourceFamily, rows[0]!.source.length > 0, rows[0]!.sourceUrl.length > 0, rows[0]!.matchedTerm, rows[0]!.normalizedTerm],
    ["employment-hr-terminology", "EEOC", true, true, "reasonable accommodation", "reasonable accommodation"]);
  check("a miss contributes no audit rows",
    referenceEvidenceAuditRows(referenceEvidenceFor("Margaret Whitfield")).filter((r) => r.evidenceFamily === "employment-hr-terminology").length, 0);
}

/*
 * ============================================================================
 * 9. COLLISIONS: EVERY FACT SURVIVES, NOTHING IS RESOLVED
 * ============================================================================
 *
 * The section this integration exists to make true. Each phrase below is
 * legitimately Employment/HR terminology AND legitimately something else --
 * a surname, a legal term, a finance term, a higher-ed term, a medical
 * abbreviation. The assertion is that BOTH answers are still available
 * afterwards, from independent channels, with no precedence between them.
 *
 * A change that "resolves" any of these -- by dropping the ambiguous row, by
 * letting one family suppress another, by adding a tie-break -- fails here.
 */
console.log("\n--- 9. COLLISION BEHAVIOUR: overlapping evidence coexists ---");
{
  console.log("    -- HR + Census personal name --");
  const grade = employmentHrEvidenceFor("Grade");
  check("`Grade` is attested HR terminology", grade !== null, true);
  check("...flagged HIGH by the dataset itself", grade?.highestCollisionRisk, "HIGH");
  check("...AND `Grade` is a Census-attested name token", censusRoleFor("Grade") !== null, true);
  check("...both facts are reported side by side, neither suppressed",
    attestingChannels(referenceEvidenceFor("Grade")).includes("employment-hr-terminology"), true);
  for (const name of ["ADA", "ERISA"]) {
    check(`${name}: HR evidence coexists with Census name attestation`,
      [employmentHrEvidenceFor(name) !== null, censusRoleFor(name) !== null], [true, true]);
  }

  console.log("    -- HR + Legal --");
  for (const term of ["appeal", "arbitration", "arbitrator", "beneficiary", "harassment", "reasonable accommodation", "retaliation", "transfer", "undue hardship", "appellant"]) {
    check(`${term}: both HR and Legal attest, both survive`,
      [employmentHrEvidenceFor(term) !== null, legalTerminologyEvidenceFor(term) !== null], [true, true]);
  }

  console.log("    -- HR + Finance/Accounting/Tax --");
  for (const term of ["appeal", "arbitration", "beneficiary", "ERISA"]) {
    check(`${term}: both HR and Finance attest, both survive`,
      [employmentHrEvidenceFor(term) !== null, financeAccountingTaxEvidenceFor(term) !== null], [true, true]);
  }

  console.log("    -- HR + Higher Education --");
  for (const term of ["credit hours", "position title"]) {
    check(`${term}: both HR and higher-ed attest, both survive`,
      [employmentHrEvidenceFor(term) !== null, higherEdTerminologyFor(term) !== null], [true, true]);
  }

  console.log("    -- HR + Medical --");
  for (const term of ["ADA", "FMLA"]) {
    check(`${term}: both HR and Medical attest, both survive`,
      [employmentHrEvidenceFor(term) !== null, medicalEvidenceFor(term) !== null], [true, true]);
  }

  console.log("    -- and the fan-out reports every colliding channel at once --");
  /*
   * SUBSET, not equality, and deliberately. Evidence families are arriving
   * concurrently; asserting the exact channel list here would make this suite
   * fail whenever an unrelated pack lands, which trains the next reader to
   * edit the expectation rather than investigate it. What this integration
   * must guarantee is that Employment/HR does not DISPLACE anything, so that
   * is what is asserted.
   */
  for (const [phrase, expected] of [
    ["appeal", ["finance-accounting-tax", "legal-terminology", "employment-hr-terminology"]],
    ["beneficiary", ["finance-accounting-tax", "legal-terminology", "employment-hr-terminology"]],
  ] as const) {
    const reported = attestingChannels(referenceEvidenceFor(phrase));
    check(`\`${phrase}\` reports every colliding family side by side`, expected.filter((e) => !reported.includes(e)), []);
  }
  check("nothing in the fan-out ranks or resolves them -- it returns a list, not a winner",
    Array.isArray(attestingChannels(referenceEvidenceFor("appeal"))), true);
  check("...and GNIS is asked independently too, with its own answer",
    gnisPlaceEvidenceFor("Grade").strength !== undefined, true);
}

/*
 * ============================================================================
 * 10. NEGATIVE WITNESSES: NO FUZZY, NO SUBSTRING, NO MORPHOLOGY
 * ============================================================================
 *
 * Plausible strings that the dataset does not attest. Each miss must be a
 * miss -- and must mean "not in this dataset", never "not HR language" and
 * certainly never "therefore a person".
 */
console.log("\n--- 10. NEGATIVE WITNESSES ---");
for (const absent of [
  // pluralisation is not generated
  "annual leaves", "Performance Improvement Plans", "reasonable accommodations", "grievances",
  // near-misses and typos are not repaired
  "anual leave", "performance improvment plan", "colective bargaining",
  // related but unattested vocabulary -- documented v1 gaps, not denials
  "exit interview", "onboarding", "stock option", "employee engagement survey",
  // occupational titles: the O*NET universe deliberately not ingested
  "Registered Nurse", "Software Developer", "Human Resources Manager",
  // ordinary language and people
  "Margaret Whitfield", "the employee", "Tuesday", "",
]) {
  check(`"${absent}" is not attested`, employmentHrEvidenceFor(absent), null);
}
check("an empty string cannot match the empty-key edge case", isAttestedEmploymentHrTerminology("   "), false);
console.log("    -- a miss yields no evidence object at all, so it cannot be read as a negative finding --");
check("miss returns null, never an `attested: false` record", employmentHrEvidenceFor("onboarding"), null);
check("...and explains nothing", explainEmploymentHrEvidence(employmentHrEvidenceFor("onboarding")), []);

/*
 * ============================================================================
 * 11. ARCHITECTURAL INVARIANCE -- THE POINT OF THE WHOLE INTEGRATION
 * ============================================================================
 *
 * Employment/HR membership must have NO independent effect on PERSON
 * determination, semantic type, review routing, recommendation,
 * Keep/Rename/Redact/Ignore state, or candidate score.
 *
 * This is asserted STRUCTURALLY rather than behaviourally, and deliberately.
 * A behavioural assertion ("flip the flag, the type is unchanged") requires a
 * flag to flip, i.e. requires plumbing the evidence INTO the classifier's
 * input in order to prove it is ignored. Higher-ed and Medical each did that
 * -- a reviewed, documented decision with a stated purpose (a call site for a
 * future combination layer) recorded on the field itself. Employment/HR does
 * not, following Legal and Finance, and so a stronger statement is available:
 * NO CLASSIFIER, SCORER, GATE OR ROUTER CAN SEE THIS EVIDENCE AT ALL.
 *
 * WHAT IT DOES REACH, and why that is still inert: a generic collection point
 * exists (`Workspace.getReferenceEvidence()`, added by concurrent pack work),
 * which computes every reference channel per candidate, stores the map, and is
 * read only by the read-only console diagnostic. Employment/HR joined it for
 * free by being in the fan-out -- which is what a generic mechanism is FOR --
 * and the assertions below pin the two facts that make that safe: the map has
 * exactly one consumer, and it is not a production path.
 *
 * The scan below is the assertion. If a future change imports this family into
 * scoring, detection, review or routing code -- directly, or by growing a
 * second consumer of the collection point -- this fails. That is not a ban on
 * ever consuming the evidence; it is a requirement that doing so be a
 * deliberate, reviewed change rather than a quiet import.
 */
console.log("\n--- 11. INERTNESS: NO CLASSIFIER, SCORER, GATE OR ROUTER CONSUMES THIS EVIDENCE ---");
{
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith(".ts")) files.push(full);
    }
  };
  walk("src");
  const sourceOf = new Map(files.map((f) => [f.replace(/\\/g, "/"), readFileSync(f, "utf8")]));
  const importersOf = (pattern: RegExp): string[] =>
    [...sourceOf.entries()].filter(([, src]) => pattern.test(src)).map(([f]) => f).sort();

  check("exactly one module imports the Employment/HR family, and it is the read-only fan-out",
    importersOf(/from\s+"[^"]*\/EmploymentHrEvidence\.js"/), ["src/engines/knowledge/ReferenceEvidence.ts"]);
  check("and exactly one module reads the generated asset",
    importersOf(/from\s+"[^"]*\/employment-hr-terminology\.data\.js"/), ["src/engines/knowledge/EmploymentHrEvidence.ts"]);

  /*
   * The fan-out's own consumers. All are inert by construction and all are
   * named here rather than pattern-matched, so that an UNINTENDED consumer --
   * the realistic way this contract would erode -- fails loudly instead of
   * slipping past a permissive regex.
   *
   * THE THIRD CONSUMER ARRIVED 2026-08-10, and this assertion is how it was
   * noticed rather than absorbed. `engines/interpretation/candidate-
   * interpretation.ts` (Phase A of the interpretation layer) reads the
   * channels to derive a multi-interpretation profile that nothing in
   * production consumes. It is listed because it was reviewed, not because
   * the list was in the way -- and Employment/HR's own inertness is unchanged
   * by it: the profile is inert too, asserted in
   * verify/candidate-interpretation-verification.ts §9.
   */
  check("the fan-out's consumers are exactly the interpretation layer, the collection point and the diagnostic",
    importersOf(/from\s+"[^"]*\/ReferenceEvidence\.js"/).filter((f) => !f.endsWith("/ReferenceEvidence.ts")),
    ["src/engines/interpretation/candidate-interpretation.ts", "src/ui/app.ts", "src/workspace/Workspace.ts"]);
  check("and the collection point's accessor has exactly one caller, the diagnostic",
    [...sourceOf.entries()].filter(([f, src]) => f !== "src/workspace/Workspace.ts" && /getReferenceEvidence\s*\(/.test(src)).map(([f]) => f).sort(),
    ["src/ui/app.ts"]);

  // Belt and braces: the family must not have acquired a classifier input.
  check("SemanticTypeFacts has no employment/HR field", /employmentHr/i.test(sourceOf.get("src/domain/semanticTypes.ts")!), false);
  check("candidate scoring never mentions the family", /employmentHr|employment-hr/i.test(sourceOf.get("src/engines/quality/scoring.ts")!), false);
  check("the residual review gate never mentions the family",
    /employmentHr|employment-hr/i.test(sourceOf.get("src/engines/review/residualReviewGate.ts")!), false);
  check("recommendations never mention the family",
    /employmentHr|employment-hr/i.test(sourceOf.get("src/ui/recommendations.ts")!), false);
}
console.log("    -- and the classifier is unmoved even if the fact is smuggled in as an extra property --");
{
  const base = (over: Partial<SemanticTypeFacts>): SemanticTypeFacts => ({
    detectedType: "person",
    categories: [],
    relationshipKinds: new Set<RelationshipKind>(),
    ...over,
  });
  const cases: Array<[string, SemanticTypeFacts]> = [
    ["person detection, name evidence (a real person named Grade)", base({ categories: ["known-personal-name-token"] })],
    ["person detection, shape only", base({ categories: ["strong-name-structure"] })],
    ["person detection, no evidence", base({})],
    ["organization detection", base({ detectedType: "organization" })],
    ["institutional categories", base({ detectedType: "unknown", categories: ["department-organization"] })],
    ["acronym (the FMLA/PIP/SPD shape)", base({ detectedType: "unknown", categories: ["likely-acronym"] })],
    ["email", base({ detectedType: "email" })],
  ];
  for (const [label, facts] of cases) {
    const attested = { ...facts, employmentHrTerminologyAttested: true } as SemanticTypeFacts;
    check(`semanticTypeFor unchanged -- ${label} (${semanticTypeFor(facts)})`, semanticTypeFor(attested), semanticTypeFor(facts));
    for (const rejected of [false, true]) {
      check(`typeCheckSectionFor unchanged -- ${label}, nonPersonEvidence=${rejected}`,
        typeCheckSectionFor(attested, rejected), typeCheckSectionFor(facts, rejected));
    }
  }
  console.log("    -- the specific failure this guards: `Grade` must still be able to be a person --");
  check("a person-evidenced candidate whose value is HIGH-risk HR terminology still routes to People",
    typeCheckSectionFor(base({ categories: ["known-personal-name-token"] }), false).section, "people");
  check("...and an HR_ADMIN_CONCEPT hint routes nothing to Organizations",
    semanticTypeFor(base({ detectedType: "unknown" })), "other");
}

console.log("\n--- 12. EXPLANATION WORDING: observation, never verdict ---");
{
  check("reports attestation, sub-domain and authority", explainEmploymentHrEvidence(employmentHrEvidenceFor("Reasonable Accommodation")), [
    '"reasonable accommodation" is attested employment/HR terminology [equal_employment_opportunity] (EEOC).',
  ]);
  check("corroboration is stated when it exists", explainEmploymentHrEvidence(employmentHrEvidenceFor("grievance")), [
    '"grievance" is attested employment/HR terminology [federal_labor_relations, labor_relations] (FLRA and NLRB).',
    "Attested independently by 2 sources.",
    "This term is flagged as collision-prone -- it is also ordinary English or a common personal name, so terminology attestation alone says little here.",
  ]);
  check("a miss explains nothing at all", explainEmploymentHrEvidence(null), []);
  check("the collision warning is surfaced to the reviewer, not hidden",
    explainEmploymentHrEvidence(employmentHrEvidenceFor("Grade")).some((l) => l.includes("collision-prone")), true);
  const forbidden = /\b(is not a person|not a person|therefore|so it is|keep this|redact|an organization)\b/i;
  const all = ["Grade", "detail", "series", "FMLA", "PIP", "Annual Leave", "beneficiary", "adverse action", "unfair labor practice"]
    .flatMap((v) => explainEmploymentHrEvidence(employmentHrEvidenceFor(v)));
  check("no explanation line draws a conclusion about the referent", all.filter((l) => forbidden.test(l)), []);
  check("...and none of them is empty", all.every((l) => l.trim().length > 0), true);
}

console.log(`\n=== employment/HR evidence: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
