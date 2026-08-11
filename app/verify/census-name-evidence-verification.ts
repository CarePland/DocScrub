/**
 * census-name-evidence-verification.ts (AG, 2026-08-10).
 *
 * The load-bearing half of this suite is NEGATIVE. Asserting that Census
 * finds `Amy Miller` is easy; the assertions that matter are the ones that
 * fail if Census attestation ever starts behaving like classification, or if
 * token membership ever replaces name structure in the protection gate.
 */

import {
  censusNameEvidenceFor,
  censusRoleFor,
  explainCensusNameEvidence,
  normalizeForCensusLookup,
  CENSUS_EVIDENCE_ENTRY_COUNT,
  CENSUS_EVIDENCE_SOURCE,
} from "../src/engines/knowledge/CensusNameEvidence.js";
import { personEvidenceReasons } from "../src/engines/cross-candidate/person-evidence-gate.js";
import { evaluateCrossCandidateEvidence } from "../src/engines/cross-candidate/cross-candidate-evidence.js";

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
check("entry count", CENSUS_EVIDENCE_ENTRY_COUNT, 195310);
check("provenance recorded", CENSUS_EVIDENCE_SOURCE, "us-census-2020/docscrub-aggregate");
console.log("    -- the Census residual bucket must never be indexed --");
check("'ALL OTHER NAMES' is not a key", censusRoleFor("ALL OTHER NAMES"), null);
check("its space-stripped form is not a key either", censusRoleFor("ALLOTHERNAMES"), null);
// normalizeForCensusLookup strips ALL non-letters, so a whole phrase would
// concatenate into a single lookup ("SAN DIEGO" -> "SANDIEGO", which IS an
// attested surname). That is safe only because every production caller
// tokenizes FIRST -- pinned here so a future caller passing a phrase is
// caught rather than silently matching.
check("a phrase concatenates on lookup (why callers must tokenize first)", normalizeForCensusLookup("SAN DIEGO"), "SANDIEGO");
check("censusNameEvidenceFor tokenizes, so the phrase is read as two tokens",
  censusNameEvidenceFor("San Diego").roles.map((r) => r.role?.normalized ?? null), ["SAN", "DIEGO"]);

console.log("\n--- 2. NORMALIZATION: accent folding, display untouched ---");
for (const [raw, expected] of [["Guzmán", "GUZMAN"], ["Núñez", "NUNEZ"], ["Martínez", "MARTINEZ"],
  ["O'Brien", "OBRIEN"], ["Smith-Jones", "SMITHJONES"], ["miller", "MILLER"], ["MILLER", "MILLER"]] as const) {
  check(`${raw} -> ${expected}`, normalizeForCensusLookup(raw), expected);
}
check("Guzmán is found via folding", censusRoleFor("Guzmán")?.surnameAttested, true);
check("accented and unaccented agree", JSON.stringify(censusRoleFor("Guzmán")), JSON.stringify(censusRoleFor("Guzman")));
{
  // The contract that matters most: nothing rewrites the candidate.
  const value = "Yazmine Guzmán";
  const ev = censusNameEvidenceFor(value);
  check("evidence carries the ORIGINAL token text, not the folded form", ev.roles.map((r) => r.token), ["Yazmine", "Guzmán"]);
  check("the normalized form appears only inside the role record", ev.roles[1]?.role?.normalized, "GUZMAN");
}
console.log("    -- explicitly NOT done --");
check("no edit-distance match (Guzmam)", censusRoleFor("Guzmam"), null);
check("no phonetic match (Gooseman)", censusRoleFor("Gooseman"), null);

console.log("\n--- 3. STRUCTURE ---");
check("Yazmine Guzmán -> first-surname", censusNameEvidenceFor("Yazmine Guzmán").structure, "first-surname");
check("Cashay Jackson -> first-surname", censusNameEvidenceFor("Cashay Jackson").structure, "first-surname");
check("Yamada, Tamara -> surname-first", censusNameEvidenceFor("Yamada, Tamara").structure, "surname-first");
check("Cobb, Christopher -> surname-first", censusNameEvidenceFor("Cobb, Christopher").structure, "surname-first");
check("Amy Miller -> ambiguous-role", censusNameEvidenceFor("Amy Miller").structure, "ambiguous-role");
check("Min Shi -> ambiguous-role", censusNameEvidenceFor("Min Shi").structure, "ambiguous-role");

console.log("\n--- 4. SINGLE TOKENS ARE OUT OF SCOPE (the 80/106 failure mode) ---");
for (const word of ["Will", "Hope", "Rose", "Dean", "Grade", "Reason", "Morning"]) {
  check(`"${word}" is attested as SOME role (so membership alone is useless)`,
    Boolean(censusRoleFor(word)?.firstAttested || censusRoleFor(word)?.surnameAttested), true);
  check(`"${word}" alone yields NO structure`, censusNameEvidenceFor(word).supportsNameStructure, false);
}

console.log("\n--- 5. CENSUS IS EVIDENCE, NOT CLASSIFICATION ---");
{
  // No exported symbol may answer "is this a person". This is asserted
  // structurally: the module's evidence type has no such field.
  const ev = censusNameEvidenceFor("Amy Miller");
  check("evidence exposes structure, not a verdict", Object.keys(ev).sort(), ["roles", "structure", "supportsNameStructure"]);
  check("absence is NOT negative evidence -- Chriztopher is simply unknown", censusRoleFor("Chriztopher"), null);
  check("and the candidate reports no structure rather than a non-person claim",
    censusNameEvidenceFor("Chriztopher Johnson").structure, "none");
}

console.log("\n--- 6. COLLISION CONTROLS: Census may PROTECT, never CLASSIFY ---");
// Each of these is a known NON-person that Census sees as name-like. The
// assertion is that the structure fires (so the gate protects them from
// automatic reinterpretation) and that NOTHING here calls them people.
for (const collision of ["San Diego", "San Marcos", "Last Day", "Staff Ad", "Angeles, CA",
  "Happy Birthday Eve", "Level, Early", "From Melissa", "Fire Marshall", "Reason Code",
  "Go Live", "Dear All", "Dear Student", "Good Morning"]) {
  const ev = censusNameEvidenceFor(collision);
  check(`${collision}: Census sees a name structure (a protection, not a verdict)`, ev.supportsNameStructure, true);
  check(`${collision}: the evidence still contains no person claim`, "isPerson" in ev, false);
}

console.log("\n--- 7. THE PROTECTION GATE ---");
{
  const facts = (over: Partial<Parameters<typeof personEvidenceReasons>[0]> = {}) => ({
    candidateId: "x", qualityCategories: [], positiveReasons: [], contextualRules: [],
    hasPersonEvidencedLinkage: false, hasCensusNameStructure: false, ...over,
  });
  check("census structure protects", personEvidenceReasons(facts({ hasCensusNameStructure: true })), ["census-name-structure"]);
  check("no census structure does not", personEvidenceReasons(facts()), []);
  check("census is ADDITIVE -- existing evidence still protects on its own",
    personEvidenceReasons(facts({ qualityCategories: ["surname-given-structure"] })), ["surname-given-structure"]);
  check("both are reported when both fire",
    personEvidenceReasons(facts({ qualityCategories: ["known-first-name"], hasCensusNameStructure: true })).sort(),
    ["census-name-structure", "known-first-name"]);
  // The taxonomy correction stays enforced alongside the new source.
  check("email proximity still does NOT protect", personEvidenceReasons(facts({ positiveReasons: ["email_address_evidence"] })), []);
}

console.log("\n--- 8. FROZEN WITNESSES: who Census protects, and who it does NOT ---");
{
  const structural = (v: string): boolean => censusNameEvidenceFor(v).supportsNameStructure;
  console.log("    -- Census-supported --");
  for (const w of ["Yazmine Guzmán", "Julie Ford", "Cashay Jackson", "Min Shi", "Amy Miller",
    "Jeffrey Lam", "Bobbie Galaz", "Chelsye Angelina", "Yamada, Tamara", "Cobb, Christopher",
    "Goodloe, Andrew", "Collier, Tanesha", "Fox, Liudmila", "Evelyn, Joaquin", "Francis, Kyle"]) {
    check(`${w} is Census-protected`, structural(w), true);
  }
  console.log("    -- NOT Census-supported: these depend on EXISTING evidence and must keep it --");
  // Recorded as explicit expectations so a future change that quietly starts
  // relying on Census for them fails here rather than in the field.
  check("Chriztopher Johnson: Census cannot see him", structural("Chriztopher Johnson"), false);
  check("Perias, Nelly: PERIAS is not attested", structural("Perias, Nelly"), false);
  check("Fox, Liud: truncation defeats the surname role", structural("Fox, Liud"), false);
  check("Diana (single token) is out of Census scope by design", structural("Diana"), false);
  check("Sarah (single token) likewise", structural("Sarah"), false);
}

console.log("\n--- 9. CROSS-CANDIDATE SEMANTICS ARE UNCHANGED (no threshold drift) ---");
{
  const cand = (v: string) => ({ id: `person:${v.toLowerCase()}`, displayValue: v, detectedType: "person" });
  const universe = [cand("Grade Rosters"), cand("Grade Entry"), cand("Grade Posting Process"),
    cand("Start Date"), cand("End Date"), cand("Term Withdrawals"), cand("Term Withdra"), cand("Amy Miller")];
  const r = evaluateCrossCandidateEvidence({ candidates: universe, personEvidencedCandidateIds: new Set() });
  check("T3 still fires at 3 (not 2)", r.byCandidate["person:grade rosters"]?.rules.includes("token_recurrence"), true);
  check("H2 still fires at 2", r.byCandidate["person:start date"]?.rules.includes("head_noun_paradigm"), true);
  check("prefix still fires", r.byCandidate["person:term withdra"]?.rules.includes("truncated_variant"), true);
  check("a two-candidate token share does NOT fire T3", r.byCandidate["person:amy miller"], undefined);
  // R1 / T2 must remain absent from the rule vocabulary entirely.
  const ruleIds = new Set(Object.values(r.byCandidate).flatMap((e) => e.rules));
  check("no ordinary-word rule (R1) exists", [...ruleIds].some((x) => /lexical|ordinary|common/.test(x)), false);
  check("rule vocabulary is exactly the three validated rules",
    [...ruleIds].sort(), ["head_noun_paradigm", "token_recurrence", "truncated_variant"]);
}

console.log("\n--- 10. EXPLANATION: no verdict, no demographics ---");
{
  const lines = explainCensusNameEvidence(censusNameEvidenceFor("Yazmine Guzmán"));
  check("names the tokens and their roles", lines.some((l) => l.includes("Yazmine") && l.includes("first name")), true);
  check("keeps the accent in the displayed token", lines.some((l) => l.includes("Guzmán")), true);
  for (const banned of ["race", "hispanic", "sex", "gender", "ethnic", "is a person", "census says"]) {
    check(`copy avoids "${banned}"`, lines.join(" ").toLowerCase().includes(banned), false);
  }
  check("no explanation when no structure", explainCensusNameEvidence(censusNameEvidenceFor("Grade Rosters")), []);
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exitCode = 1;
