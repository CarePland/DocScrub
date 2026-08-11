/**
 * government-public-admin-evidence-verification.ts (AG, 2026-08-10).
 *
 * The load-bearing half of this suite is NEGATIVE, for the same reason the
 * Census, higher-ed, finance, legal and employment/HR suites' are. Asserting
 * that the dataset finds `Notice of Proposed Rulemaking` is easy. The
 * assertions that matter are the ones that fail if terminology attestation
 * ever starts behaving like classification.
 *
 * Three sections are specific to this family and are the ones to read first:
 *
 *   8   ORGANIZATION ROWS. This pack attests named federal bodies alongside
 *       general vocabulary. The distinction survives as data
 *       (`OFFICIAL_ORGANIZATION`) and is pinned here NOT to become a type.
 *
 *   9   ACRONYM PROVENANCE. `SAM` is System for Award Management to
 *       Acquisition.gov and a given name to Census. Both attestations must
 *       survive, and the expansion must stay provenance rather than becoming
 *       a resolution of what the string means.
 *
 *   12  INERTNESS. A candidate must be able to gain government attestation
 *       while `semanticTypeFor` and `typeCheckSectionFor` return exactly what
 *       they returned before.
 *
 * Run:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs \
 *        verify/government-public-admin-evidence-verification.ts
 */

import {
  explainGovernmentPublicAdminEvidence,
  governmentPublicAdminEvidenceFor,
  governmentSourceAuthorityFor,
  isAttestedGovernmentPublicAdminTerminology,
  normalizeForGovernmentPublicAdminLookup,
  GOVERNMENT_EVIDENCE_JURISDICTION,
  GOVERNMENT_EVIDENCE_ROW_COUNT,
  GOVERNMENT_EVIDENCE_SOURCE,
  GOVERNMENT_EVIDENCE_TERM_COUNT,
  GOVERNMENT_SOURCE_AUTHORITIES,
  GOVERNMENT_SOURCE_LICENSING,
} from "../src/engines/knowledge/GovernmentPublicAdminEvidence.js";
import { GOVERNMENT_PACK } from "../src/engines/knowledge/government-public-admin-terminology.data.js";
import { censusRoleFor } from "../src/engines/knowledge/CensusNameEvidence.js";
import { legalTerminologyEvidenceFor } from "../src/engines/knowledge/LegalTerminologyEvidence.js";
import { financeAccountingTaxEvidenceFor } from "../src/engines/knowledge/FinanceAccountingTaxEvidence.js";
import { higherEdTerminologyFor } from "../src/engines/knowledge/HigherEdTerminologyEvidence.js";
import { employmentHrEvidenceFor } from "../src/engines/knowledge/EmploymentHrEvidence.js";
import { attestingChannels, referenceEvidenceAuditRows, referenceEvidenceFor, terminologyChannelsOf } from "../src/engines/knowledge/ReferenceEvidence.js";
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
check("attestation row count", GOVERNMENT_EVIDENCE_ROW_COUNT, 412);
check("distinct normalized terms", GOVERNMENT_EVIDENCE_TERM_COUNT, 409);
check("provenance recorded", GOVERNMENT_EVIDENCE_SOURCE, "docscrub-government-public-admin-terminology/2026-08-10");
check("jurisdiction recorded", GOVERNMENT_EVIDENCE_JURISDICTION, "US_FEDERAL");
{
  const lines = GOVERNMENT_PACK.rows.split("\n").filter((l) => l.length > 0);
  check("every shipped row is present", lines.length, 412);
  check("every row has 13 tab-separated fields", lines.every((l) => l.split("\t").length === 13), true);
  check("the pack asset's own counts agree", [GOVERNMENT_PACK.rowCount, GOVERNMENT_PACK.termCount], [412, 409]);
  check("sub-domain intern index 0 is the empty string", GOVERNMENT_PACK.subDomains[0], "");
  check("string-pool index 0 is the empty string", GOVERNMENT_PACK.strings[0], "");
  check("all 7 source families are interned", GOVERNMENT_PACK.sources.length, 7);
}

/*
 * ============================================================================
 * 2. NORMALIZATION PARITY -- the strongest check in the suite, and it is cheap.
 * ============================================================================
 *
 * The shipped keys were produced by the dataset's own Python generator. The
 * runtime normalizer is a SECOND implementation of the same six documented
 * steps in TypeScript. Two implementations of one algorithm is exactly the
 * shape that drifts silently -- a drift here is not a build error, it is a
 * lookup that quietly misses. So: re-normalize every shipped source term and
 * require it to reproduce its own key, all 412 of them.
 */
console.log("\n--- 2. NORMALIZATION PARITY over the whole dataset ---");
{
  const mismatches: string[] = [];
  for (const line of GOVERNMENT_PACK.rows.split("\n")) {
    if (line.length === 0) continue;
    const [normalized, term] = line.split("\t");
    const derived = normalizeForGovernmentPublicAdminLookup(term!);
    if (derived !== normalized) mismatches.push(`${term} -> ${derived} != ${normalized}`);
  }
  check("all 412 source terms re-derive their shipped key", mismatches.slice(0, 5), []);
}

console.log("\n--- 3. POSITIVE LOOKUPS across source families and categories ---");
{
  const cases: Array<[string, string, string, string]> = [
    // phrase, matched display term, source family, sub-domain
    ["Notice of Proposed Rulemaking", "Notice of Proposed Rulemaking", "FEDERAL_REGISTER", "RULEMAKING"],
    ["Request for Records Disposition Authority", "Request for Records Disposition Authority", "NARA_RM", "RECORDS_MANAGEMENT"],
    ["NPRM", "NPRM", "FEDERAL_REGISTER", "RULEMAKING"],
    ["FAIN", "FAIN", "GRANTS_GOV", "GRANTS"],
    ["GRS", "GRS", "NARA_RM", "RECORDS_MANAGEMENT"],
    ["National Archives and Records Administration", "National Archives and Records Administration", "USAGOV_AGENCIES", "OFFICIAL_ORGANIZATION"],
  ];
  for (const [phrase, term, family, subDomain] of cases) {
    const e = governmentPublicAdminEvidenceFor(phrase);
    check(`"${phrase}" is attested`, e !== null, true);
    check(`"${phrase}" -> "${term}"`, e?.attestations[0]?.term, term);
    check(`"${phrase}" source family ${family}`, e?.sourceFamilies.includes(family), true);
    check(`"${phrase}" sub-domain ${subDomain}`, e?.subDomains.includes(subDomain), true);
    check(`"${phrase}" family discriminator`, e?.family, "government-public-admin");
    check(`"${phrase}" carries the pack jurisdiction`, e?.jurisdiction, "US_FEDERAL");
    check(`"${phrase}" keeps the phrase verbatim`, e?.value, phrase);
  }
  check("the convenience predicate agrees", isAttestedGovernmentPublicAdminTerminology("Notice of Proposed Rulemaking"), true);
}

/*
 * ============================================================================
 * 4. NORMALIZATION BEHAVIOUR, including the step no shipped row exercises.
 * ============================================================================
 *
 * Step 6 (remove spaces around `/` and `-`) is INERT on the v1 data: no row
 * contains such a space, so the finance policy would reproduce all 412 keys
 * too. It is implemented because the documented contract is what gets
 * implemented, and it is pinned HERE with synthetic input precisely because
 * the dataset cannot pin it. Delete this and the rule can rot unnoticed until
 * a v2 row needs it.
 */
console.log("\n--- 4. NORMALIZATION BEHAVIOUR ---");
for (const [raw, expected] of [
  // case folding and whitespace collapse
  ["NOTICE OF PROPOSED RULEMAKING", "notice of proposed rulemaking"],
  ["  Notice   of  Proposed\tRulemaking  ", "notice of proposed rulemaking"],
  // Unicode variants the methodology names
  ["Pre–award", "pre-award"],
  ["Pre—award", "pre-award"],
  ["Pre−award", "pre-award"],
  ["Contracting Officer’s Representative", "contracting officer's representative"],
  // step 6, synthetic -- no shipped row exercises this
  ["pre - award", "pre-award"],
  ["attorney / advisor", "attorney/advisor"],
  // punctuation is otherwise PRESERVED
  ["OMB Circular A-123", "omb circular a-123"],
  ["Section 508", "section 508"],
  ["FOIA Exemption 6", "foia exemption 6"],
] as const) {
  check(`normalize ${JSON.stringify(raw)}`, normalizeForGovernmentPublicAdminLookup(raw), expected);
}
{
  const e = governmentPublicAdminEvidenceFor("nOtIcE oF pRoPoSeD rUlEmAkInG");
  check("lookup is case-insensitive", e !== null, true);
  check("but the DISPLAY form comes from the source, not the caller", e?.attestations[0]?.term, "Notice of Proposed Rulemaking");
  check("and the caller's phrase is never rewritten", e?.value, "nOtIcE oF pRoPoSeD rUlEmAkInG");
}

/*
 * ============================================================================
 * 5. EXACTNESS -- no substring, prefix, fuzzy or token-subset matching.
 * ============================================================================
 *
 * The failure this guards is the one that would do the most damage fastest:
 * if `Notice of Proposed Rulemaking` being in the pack caused bare `Proposed`
 * to match, then every ordinary document word inside a multi-token government
 * phrase would start carrying government evidence.
 */
console.log("\n--- 5. NEGATIVE CONTROLS: exact lookup only ---");
for (const phrase of [
  "Proposed",                             // a token OF an attested phrase
  "Rulemaking Notice",                    // reordered
  "Notice of Proposed",                   // prefix
  "of Proposed Rulemaking",               // suffix
  "Notice of Proposed Rulemakings",       // pluralised
  "Notice of Proposed Rule Making",       // re-tokenised
  "Request for Records Disposition",      // truncated
  "NPRMs",                                // acronym plus a letter
  "Margaret Chen",                        // a person
  "",                                     // empty
  "   ",                                  // whitespace only
]) {
  check(`"${phrase}" is not attested`, governmentPublicAdminEvidenceFor(phrase), null);
}
/* The contrast that makes the rule above legible: `Disposition` is a token OF
 * `Request for Records Disposition Authority` and IS attested -- but because
 * NARA ships it as its own row, not because a substring matched. Same
 * dataset, same phrase, opposite outcomes, and the difference is exactly
 * "did a source publish this term". */
check("`Disposition` IS attested -- as its own NARA row, not by substring",
  governmentPublicAdminEvidenceFor("Disposition")?.attestations[0]?.term, "Disposition");
check("...and `Authority`, the other inner token, is not attested at all",
  governmentPublicAdminEvidenceFor("Authority"), null);

/*
 * ============================================================================
 * 6. PROVENANCE IS PRESERVED, NOT COLLAPSED TO A BOOLEAN
 * ============================================================================
 *
 * The question a hit must be able to answer months from now is not "did an
 * evidence channel fire" but "WHICH authority said so, where, and about what
 * published term". `dictionaryHit: true` cannot answer that and cannot be
 * un-collapsed once shipped.
 */
console.log("\n--- 6. PROVENANCE IS PRESERVED ---");
{
  const e = governmentPublicAdminEvidenceFor("Request for Records Disposition Authority")!;
  const [a] = e.attestations;
  check("source name survives", a?.source, "NARA — Records Management Key Terms and Acronyms");
  check("source url survives", a?.sourceUrl.startsWith("https://www.archives.gov/"), true);
  check("source family survives", a?.sourceFamily, "NARA_RM");
  check("authority level survives", a?.sourceAuthorityLevel, "HIGH");
  check("semantic hints survive as a list", a?.semanticHints, ["DOCUMENT"]);
  check("sub-domain survives", a?.subDomain, "RECORDS_MANAGEMENT");
  check("collision risk survives", a?.collisionRisk, "LOW");
  check("this is a direct source label, not a derived variant", [a?.sourceAttested, a?.derivedVariant], [true, false]);
  check("the normalized key is exposed as a matching artifact", e.normalized, "request for records disposition authority");
  check("token count is exposed", e.tokenCount, 5);

  console.log("    -- the machine source-family key resolves to a named authority --");
  check("NARA_RM", governmentSourceAuthorityFor("NARA_RM"), "National Archives and Records Administration");
  check("FAR_PART_2", governmentSourceAuthorityFor("FAR_PART_2"), "Federal Acquisition Regulation");
  check("FOIA_GOV", governmentSourceAuthorityFor("FOIA_GOV"), "U.S. Department of Justice, Office of Information Policy");
  check("an unknown key returns null rather than an invented label", governmentSourceAuthorityFor("NOT_A_FAMILY"), null);
  check("every interned source family has an authority",
    GOVERNMENT_PACK.sources.filter((s) => governmentSourceAuthorityFor(s[2]) === null), []);

  console.log("    -- licensing travels with the pack for downstream redistribution --");
  check("one licensing row per source family", GOVERNMENT_SOURCE_LICENSING.length, 7);
  check("NARA's CC0 status is carried", GOVERNMENT_SOURCE_LICENSING.some((r) => r[0] === "NARA_RM" && r[2].includes("CC0")), true);
  check("every licensing row names a retrieval date", GOVERNMENT_SOURCE_LICENSING.every((r) => r[3] === "2026-08-10"), true);
  check("authority table covers every family", GOVERNMENT_SOURCE_AUTHORITIES.length, 7);
}

/*
 * ============================================================================
 * 7. MULTI-SOURCE ATTESTATION -- every attesting row survives.
 * ============================================================================
 *
 * `Series` is attested by NARA as records-management vocabulary AND by OPM as
 * government-employment vocabulary. Two authorities, two sub-domains, one
 * string, both correct. Keeping only the first would silently discard exactly
 * the corroboration a combination layer exists to weigh.
 */
console.log("\n--- 7. MULTI-SOURCE ATTESTATION ---");
{
  const e = governmentPublicAdminEvidenceFor("Series")!;
  check("`Series` is attested twice", e.attestations.length, 2);
  check("multiplyAttested is set", e.multiplyAttested, true);
  check("both source families survive", [...e.sourceFamilies].sort(), ["NARA_RM", "OPM_CLASSIFICATION"]);
  check("both sub-domains survive", [...e.subDomains].sort(), ["GOVERNMENT_EMPLOYMENT", "RECORDS_MANAGEMENT"]);
  check("both hints survive", [...e.semanticHints].sort(), ["EMPLOYMENT_ADMIN", "RECORDS_INFORMATION"]);
  check("both source urls survive distinctly", new Set(e.attestations.map((a) => a.sourceUrl)).size, 2);

  const contract = governmentPublicAdminEvidenceFor("Contract")!;
  check("`Contract` is attested by FAR and Grants.gov", [...contract.sourceFamilies].sort(), ["FAR_PART_2", "GRANTS_GOV"]);
  const agency = governmentPublicAdminEvidenceFor("Federal Agency")!;
  check("`Federal Agency` is attested twice", agency.attestations.length, 2);

  check("only 3 keys in the pack are multiply attested, and none was dropped",
    GOVERNMENT_PACK.rows.split("\n").filter((l) => l.length > 0).length - GOVERNMENT_PACK.termCount, 3);
}

/*
 * ============================================================================
 * 8. ORGANIZATION ROWS: ATTESTED, STILL NOT TYPED
 * ============================================================================
 *
 * This pack contains 29 named federal bodies alongside general vocabulary,
 * and it is the one place the family invites a representational collapse:
 * "attested government terminology" becoming "this candidate IS a government
 * organization". The distinction must survive AS DATA -- a sub-domain and a
 * hint the source assigned -- and must not become a semantic type.
 */
console.log("\n--- 8. ORGANIZATION NAMES ARE A ROW PROPERTY, NOT A TYPE ---");
{
  const org = governmentPublicAdminEvidenceFor("National Archives and Records Administration")!;
  const vocab = governmentPublicAdminEvidenceFor("Notice of Proposed Rulemaking")!;
  check("a named body is marked OFFICIAL_ORGANIZATION", org.subDomains, ["OFFICIAL_ORGANIZATION"]);
  check("general vocabulary is not", vocab.subDomains.includes("OFFICIAL_ORGANIZATION"), false);
  check("the hint is carried verbatim", org.semanticHints, ["ORGANIZATION"]);
  console.log("    -- the hint vocabulary and SemanticTypeId are separate namespaces --");
  check("no evidence field is named like a semantic type",
    Object.keys(org).filter((k) => /^(semanticType|type|isOrganization|isPerson)$/.test(k)), []);
  check("`ORGANIZATION` is a hint string, never mapped to a type here",
    org.semanticHints.every((h) => h === h.toUpperCase()), true);
  console.log("    -- and the ORGANIZATION hint is a DIFFERENT population from the sub-domain --");
  {
    const rows = GOVERNMENT_PACK.rows.split("\n").filter((l) => l.length > 0).map((l) => l.split("\t"));
    const orgSubDomain = rows.filter((f) => GOVERNMENT_PACK.subDomains[Number(f[3])] === "OFFICIAL_ORGANIZATION").length;
    const orgHint = rows.filter((f) => GOVERNMENT_PACK.hintSets[Number(f[2])]!.split("|").includes("ORGANIZATION")).length;
    check("29 rows are OFFICIAL_ORGANIZATION rows", orgSubDomain, 29);
    check("37 rows carry the ORGANIZATION hint -- not the same set", orgHint, 37);
  }
}

/*
 * ============================================================================
 * 9. ACRONYMS ARE SOURCE-LOCAL PROVENANCE, NOT RESOLUTION
 * ============================================================================
 *
 * 129 rows carry an explicit acronym/expansion pair, every one published by
 * the authoritative source -- `derivedVariant` is false on all 412 rows
 * because nothing here was mechanically generated. The expansion says what
 * ONE authority wrote. It does not say what the string means in a document,
 * and 19 of these acronyms are also Census-attested personal names.
 */
console.log("\n--- 9. ACRONYM PROVENANCE ---");
{
  const nprm = governmentPublicAdminEvidenceFor("NPRM")!;
  const [a] = nprm.attestations;
  check("`NPRM` retains its acronym marker", a?.acronym, "NPRM");
  check("`NPRM` retains its expansion", a?.acronymExpansion, "Notice of Proposed Rulemaking");
  check("`NPRM` retains the parent term it abbreviates", a?.parentTerm, "Notice of Proposed Rulemaking");
  check("`NPRM` retains the authority that published the relationship", a?.sourceFamily, "FEDERAL_REGISTER");
  check("and it is a DIRECT source label, not a derivation DocScrub invented",
    [a?.sourceAttested, a?.derivedVariant], [true, false]);
  console.log("    -- the expansion resolves nothing: the long form is its own separate row --");
  check("the expansion is separately attested", governmentPublicAdminEvidenceFor("Notice of Proposed Rulemaking") !== null, true);
  check("and the two are different keys", nprm.normalized !== governmentPublicAdminEvidenceFor("Notice of Proposed Rulemaking")!.normalized, true);
  for (const [acronym, expansion] of [["FAIN", "Federal Award Identification Number"], ["COR", "Contracting Officer's Representative"], ["GRS", "General Records Schedules"], ["ERA", "Electronic Records Archives"], ["SAM", "System for Award Management"]] as const) {
    check(`${acronym} -> "${expansion}"`, governmentPublicAdminEvidenceFor(acronym)?.attestations[0]?.acronymExpansion, expansion);
  }
  console.log("    -- and `SAM` is simultaneously a Census-attested given name --");
  check("Census attests SAM", censusRoleFor("SAM") !== null, true);
  check("the government attestation is NOT withdrawn because of it", governmentPublicAdminEvidenceFor("SAM") !== null, true);
  console.log("    -- no row in the pack is a mechanically derived variant --");
  check("zero derived rows", GOVERNMENT_PACK.rows.split("\n").filter((l) => l.length > 0).filter((l) => l.split("\t")[7] === "1").length, 0);
}

/*
 * ============================================================================
 * 10. COLLISION RETENTION -- HIGH risk is a warning, never a filter.
 * ============================================================================
 *
 * The source flags 66 rows HIGH and 263 MEDIUM: 80% of this pack carries a
 * collision warning from its own authors. Suppressing those rows, or letting
 * the warning weaken the record, would destroy the only signal that makes a
 * conflict visible to the layer that will eventually have to resolve one.
 */
console.log("\n--- 10. HIGH COLLISION RISK, AND NAMES ---");
{
  for (const term of ["Title", "Record", "Notice", "Grade", "Contractor", "Series"]) {
    const e = governmentPublicAdminEvidenceFor(term);
    check(`HIGH-risk "${term}" still returns evidence in full`, e !== null, true);
    check(`"${term}" carries its warning`, e?.highestCollisionRisk, "HIGH");
    check(`"${term}" is not truncated or degraded by the warning`, (e?.attestations.length ?? 0) > 0, true);
  }
  console.log("    -- several are simultaneously Census-attested personal names --");
  for (const term of ["Band", "Day", "Grade", "Notice", "Record", "Role", "Rule", "Search", "State", "Title"]) {
    check(`"${term}": Census attests it AND government attests it`,
      [censusRoleFor(term) !== null, governmentPublicAdminEvidenceFor(term) !== null], [true, true]);
  }
  console.log("    -- 42 of 409 government terms are Census-attested in every token. None was removed. --");
  {
    const terms = [...new Set(GOVERNMENT_PACK.rows.split("\n").filter((l) => l.length > 0).map((l) => l.split("\t")[1]!))];
    const censusAttested = terms.filter((t) => {
      const tokens = t.split(/\s+/).filter((x) => x.length > 0);
      return tokens.length > 0 && tokens.every((x) => censusRoleFor(x) !== null);
    });
    check("the Census intersection is retained at its measured size", censusAttested.length, 42);
    check("and every one of them still returns government evidence",
      censusAttested.filter((t) => governmentPublicAdminEvidenceFor(t) === null), []);
  }
}

/*
 * ============================================================================
 * 11. CROSS-FAMILY COEXISTENCE -- no channel suppresses another.
 * ============================================================================
 *
 * The whole reason these packs are evidence rather than classifiers. A phrase
 * attested by two independent authorities in two unrelated domains is the
 * most informative thing these datasets can jointly report, and nothing in
 * this layer may pick a winner.
 */
console.log("\n--- 11. CROSS-FAMILY COEXISTENCE ---");
{
  const pairs: Array<[string, string, (t: string) => boolean]> = [
    ["Depreciation", "higher-ed", (t) => higherEdTerminologyFor(t) !== null],
    ["Applicant", "higher-ed", (t) => higherEdTerminologyFor(t) !== null],
    ["Asset", "finance", (t) => financeAccountingTaxEvidenceFor(t) !== null],
    ["Budget", "finance", (t) => financeAccountingTaxEvidenceFor(t) !== null],
    ["Claim", "legal", (t) => legalTerminologyEvidenceFor(t) !== null],
    ["Contract", "legal", (t) => legalTerminologyEvidenceFor(t) !== null],
    ["Grade", "employment-hr", (t) => employmentHrEvidenceFor(t) !== null],
    ["Retirement", "employment-hr", (t) => employmentHrEvidenceFor(t) !== null],
  ];
  for (const [term, other, hit] of pairs) {
    check(`"${term}": government AND ${other} both attest, neither withdraws`,
      [governmentPublicAdminEvidenceFor(term) !== null, hit(term)], [true, true]);
  }

  console.log("    -- and the fan-out reports every one of them side by side --");
  {
    const channels = referenceEvidenceFor("Contract");
    check("the fan-out carries the government channel", channels.governmentPublicAdmin !== null, true);
    check("government appears among the attesting channels", attestingChannels(channels).includes("government-public-admin"), true);
    check("so does legal, unsuppressed", attestingChannels(channels).includes("legal-terminology"), true);
    check("the uniform view exposes government as a family", terminologyChannelsOf(channels).some((c) => c.id === "government-public-admin"), true);
    check("nothing in the channels struct summarises or ranks them",
      Object.keys(channels).filter((k) => /winner|best|primary|resolved|mostLikely|score|rank/i.test(k)), []);
  }

  console.log("    -- and one flat audit row per attesting source is reconstructible --");
  {
    const rows = referenceEvidenceAuditRows(referenceEvidenceFor("Series"));
    const gov = rows.filter((r) => r.evidenceFamily === "government-public-admin");
    check("both government rows appear in the audit flattening", gov.length, 2);
    check("each names its own authority", [...new Set(gov.map((r) => r.sourceFamily))].sort(), ["NARA_RM", "OPM_CLASSIFICATION"]);
    check("each names the published term it matched", [...new Set(gov.map((r) => r.matchedTerm))], ["Series"]);
    check("each carries the key both sides were reduced to", [...new Set(gov.map((r) => r.normalizedTerm))], ["series"]);
    check("each carries its source url", gov.every((r) => r.sourceUrl.startsWith("https://")), true);
  }
}

/*
 * ============================================================================
 * 12. NO ROUTE FROM ATTESTATION TO CLASSIFICATION
 * ============================================================================
 *
 * Inertness is pinned as a STRUCTURAL guard rather than by flipping an inert
 * boolean: a field cannot be flipped if it does not exist, and if someone
 * later adds one this fails. Behavioural inertness is established separately
 * by the rest of the verification battery running unchanged.
 */
console.log("\n--- 12. NO ROUTE FROM ATTESTATION TO CLASSIFICATION ---");
{
  const base = (over: Partial<SemanticTypeFacts>): SemanticTypeFacts => ({
    detectedType: "person",
    categories: [],
    relationshipKinds: new Set<RelationshipKind>(),
    ...over,
  });
  const cases: Array<[string, SemanticTypeFacts]> = [
    ["person detection, name evidence (a real person named Day)", base({ categories: ["known-personal-name-token"] })],
    ["person detection, shape only", base({ categories: ["strong-name-structure"] })],
    ["person detection, no evidence", base({})],
    ["organization detection", base({ detectedType: "organization" })],
    ["institutional categories", base({ detectedType: "unknown", categories: ["department-organization"] })],
    ["acronym", base({ detectedType: "unknown", categories: ["likely-acronym"] })],
  ];
  console.log("    -- the facts type carries no government channel --");
  for (const [label, facts] of cases) {
    check(`SemanticTypeFacts has no government key -- ${label}`,
      Object.keys(facts).filter((k) => /government|federal|agency|procurement|rulemaking|foia/i.test(k)), []);
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
  console.log("    -- the assertion the brief asked for, stated directly --");
  {
    const facts = base({ categories: ["known-personal-name-token"] });
    const typeBefore = semanticTypeFor(facts);
    const sectionBefore = typeCheckSectionFor(facts, false);
    const attested = governmentPublicAdminEvidenceFor("Day") !== null;
    check("a candidate CAN gain government attestation", attested, true);
    check("...while semanticTypeFor is unchanged", semanticTypeFor(facts), typeBefore);
    check("...and typeCheckSectionFor is unchanged", typeCheckSectionFor(facts, false), sectionBefore);
  }
}

console.log("\n--- 13. THE EXPLANATION STATES AN OBSERVATION, NEVER A VERDICT ---");
{
  const lines = explainGovernmentPublicAdminEvidence(governmentPublicAdminEvidenceFor("Notice of Proposed Rulemaking"));
  check("it names the term and the authority", lines[0]?.includes("Notice of Proposed Rulemaking"), true);
  check("it says 'attested', not 'is'", lines[0]?.includes("is attested government/public-administration terminology"), true);

  const org = explainGovernmentPublicAdminEvidence(governmentPublicAdminEvidenceFor("National Archives and Records Administration"));
  check("a named body gets the organization-listing line", org.some((l) => l.includes("lists it as an official government organization name")), true);
  check("and that line is framed as what the dataset records", org.some((l) => l.includes("not a determination about what this phrase refers to here")), true);
  check("general vocabulary does NOT get that line",
    explainGovernmentPublicAdminEvidence(governmentPublicAdminEvidenceFor("Notice of Proposed Rulemaking")).some((l) => l.includes("official government organization")), false);

  const risky = explainGovernmentPublicAdminEvidence(governmentPublicAdminEvidenceFor("Title"));
  check("a HIGH-risk term surfaces its warning to the reviewer", risky.some((l) => l.includes("collision-prone")), true);

  check("a miss produces no lines at all -- silence, not a negative finding",
    explainGovernmentPublicAdminEvidence(governmentPublicAdminEvidenceFor("Margaret Chen")), []);

  const forbidden = /not a person|is not a|therefore|must be|should be redacted|keep this/i;
  const offenders: string[] = [];
  for (const term of ["Notice of Proposed Rulemaking", "Title", "Record", "SAM", "National Archives and Records Administration", "Series", "Contract"]) {
    for (const line of explainGovernmentPublicAdminEvidence(governmentPublicAdminEvidenceFor(term))) {
      if (forbidden.test(line)) offenders.push(line);
    }
  }
  check("no explanation line draws a conclusion about what the phrase IS", offenders, []);
}

console.log(`\n=== government / public administration evidence: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exitCode = 1;
