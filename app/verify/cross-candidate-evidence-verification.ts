/**
 * cross-candidate-evidence-verification.ts (AG, 2026-08-10).
 *
 * Pins the three things a future refactor could silently break:
 *
 *   1. INDEX SCOPE. The token/head index must be built over EVERY
 *      person-typed candidate, not over a pre-narrowed subset. Narrowing the
 *      denominator raises every share count, so the rules would get more
 *      aggressive while looking unchanged. Asserted by running the same
 *      candidate against two different universes and requiring the answer to
 *      differ in the documented direction.
 *   2. THRESHOLDS. T3 = 3 and H2 = 2, and the rejected variants stay
 *      rejected.
 *   3. THE PROTECTION GATE, including the taxonomy correction: proximity
 *      evidence must NOT qualify a candidate as person-evidenced.
 *
 * Plus the frozen witness set, in both directions.
 */

import {
  evaluateCrossCandidateEvidence,
  explainCrossCandidateEvidence,
  TOKEN_RECURRENCE_MIN,
  HEAD_NOUN_PARADIGM_MIN,
  type CrossCandidateInput,
} from "../src/engines/cross-candidate/cross-candidate-evidence.js";
import { personEvidenceReasons, personEvidencedCandidateIds, NAME_EVIDENCE_CATEGORIES } from "../src/engines/cross-candidate/person-evidence-gate.js";
import { semanticTypeFor } from "../src/domain/semanticTypes.js";

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

const cand = (displayValue: string, detectedType = "person"): CrossCandidateInput => ({
  id: `${detectedType}:${displayValue.toLowerCase()}`,
  displayValue,
  detectedType,
});

/** A miniature of the live document: an administrative vocabulary cluster,
 *  a head-noun paradigm, a truncation pair, and real people among them. */
const UNIVERSE: CrossCandidateInput[] = [
  cand("Grade Rosters"), cand("Grade Entry"), cand("Grade Posting Process"),
  cand("Grade Rosters Closed"), cand("Incomplete Grade"),
  cand("Start Date"), cand("End Date"), cand("Last Date"),
  cand("Term Withdrawals"), cand("Term Withdra"),
  cand("Amy Miller"), cand("Jeffrey Lam"), cand("Bobbie Galaz"), cand("Chelsye Angelina"),
  cand("Chriztopher Johnson"), cand("Cobb, Christopher"), cand("Perias, Nelly"),
  cand("Yamada, Tamara"), cand("Goodloe, Andrew"), cand("Collier, Tanesha"),
  cand("records@example.edu", "email"),
];
const NONE = new Set<string>();
const run = (candidates: readonly CrossCandidateInput[] = UNIVERSE, protectedIds: ReadonlySet<string> = NONE) =>
  evaluateCrossCandidateEvidence({ candidates, personEvidencedCandidateIds: protectedIds });

console.log("\n--- 1. THRESHOLDS ARE WHAT WAS MEASURED ---");
check("TOKEN_RECURRENCE_MIN is 3 (T2 was measured and REJECTED)", TOKEN_RECURRENCE_MIN, 3);
check("HEAD_NOUN_PARADIGM_MIN is 2", HEAD_NOUN_PARADIGM_MIN, 2);

console.log("\n--- 2. THE RULES FIRE ON THE FAMILIES THEY WERE MEASURED ON ---");
{
  const r = run();
  const of = (v: string) => r.byCandidate[`person:${v.toLowerCase()}`];
  check("Grade Rosters -> token_recurrence", of("Grade Rosters")?.rules.includes("token_recurrence"), true);
  check("Grade Rosters shared token is 'grade'", of("Grade Rosters")?.sharedToken, "grade");
  check("Grade Rosters tokenShare counts all 5 'grade' phrases", of("Grade Rosters")?.tokenShare, 5);
  check("Start Date -> head_noun_paradigm", of("Start Date")?.rules.includes("head_noun_paradigm"), true);
  check("Start Date head noun is 'date'", of("Start Date")?.headNoun, "date");
  check("Term Withdra -> truncated_variant", of("Term Withdra")?.rules.includes("truncated_variant"), true);
  check("Term Withdra names the longer form", of("Term Withdra")?.truncationOf, "Term Withdrawals");
}

console.log("\n--- 3. FROZEN REAL-PERSON WITNESSES: no rule fires, even UNPROTECTED ---");
{
  // The gate is deliberately NOT applied here. This asserts the rules
  // themselves are silent on real names, so protection is a second line of
  // defence rather than the only one.
  const r = run(UNIVERSE, NONE);
  for (const person of [
    "Amy Miller", "Jeffrey Lam", "Bobbie Galaz", "Chelsye Angelina", "Chriztopher Johnson",
    "Cobb, Christopher", "Perias, Nelly", "Yamada, Tamara", "Goodloe, Andrew", "Collier, Tanesha",
  ]) {
    check(`${person}: no cross-candidate evidence`, r.byCandidate[`person:${person.toLowerCase()}`], undefined);
  }
}

console.log("\n--- 4. INDEX SCOPE IS THE FULL PERSON-TYPED UNIVERSE ---");
{
  // Same candidate, two universes. Narrowing the denominator must CHANGE the
  // answer -- that is what makes the scope load-bearing rather than incidental.
  const wide = run(UNIVERSE);
  const narrow = run([cand("Grade Rosters"), cand("Grade Entry")]);
  check("wide universe: Grade Rosters fires", wide.byCandidate["person:grade rosters"]?.rules.includes("token_recurrence"), true);
  check("narrowed universe: it does NOT (share drops to 2)", narrow.byCandidate["person:grade rosters"]?.rules.includes("token_recurrence"), undefined);
  check("indexedCandidateCount reports the person-typed universe", wide.indexedCandidateCount, UNIVERSE.length - 1);
  check("non-person detections are excluded from the index", wide.byCandidate["email:records@example.edu"], undefined);
}

console.log("\n--- 5. SINGLE-TOKEN CANDIDATES ARE OUT OF SCOPE ---");
{
  const r = run([...UNIVERSE, cand("Grade"), cand("Andrew")]);
  check("bare 'Grade' gets no cross-candidate evidence", r.byCandidate["person:grade"], undefined);
  check("bare 'Andrew' gets no cross-candidate evidence", r.byCandidate["person:andrew"], undefined);
}

console.log("\n--- 6. THE PROTECTION GATE ---");
{
  const facts = (over: Partial<Parameters<typeof personEvidenceReasons>[0]> = {}) => ({
    candidateId: "x", qualityCategories: [], positiveReasons: [], contextualRules: [], hasPersonEvidencedLinkage: false, ...over,
  });
  for (const category of NAME_EVIDENCE_CATEGORIES) {
    check(`${category} protects`, personEvidenceReasons(facts({ qualityCategories: [category] })).length > 0, true);
  }
  check("snake_case is normalized too", personEvidenceReasons(facts({ qualityCategories: ["known_personal_name_token"] })).length > 0, true);
  check("nearby_title protects (a positiveReason, invisible to category tests)", personEvidenceReasons(facts({ positiveReasons: ["nearby_title"] })).length > 0, true);
  check("an anchor rule protects", personEvidenceReasons(facts({ contextualRules: ["anchor_signature_block"] })).length > 0, true);
  check("a contextual usage rule protects", personEvidenceReasons(facts({ contextualRules: ["contextual_attribution"] })).length > 0, true);
  check("person-evidenced linkage protects", personEvidenceReasons(facts({ hasPersonEvidencedLinkage: true })).length > 0, true);
  check("shape alone does NOT protect", personEvidenceReasons(facts({ qualityCategories: ["strong-name-structure"] })), []);
  check("frequency alone does NOT protect", personEvidenceReasons(facts({ qualityCategories: ["moderate-frequency-bonus"] })), []);

  console.log("    -- the taxonomy correction, enforced --");
  check("email_address_evidence does NOT protect (proximity, not identity)", personEvidenceReasons(facts({ positiveReasons: ["email_address_evidence"] })), []);
  check("signature_or_email_header_context does NOT protect", personEvidenceReasons(facts({ positiveReasons: ["signature_or_email_header_context"] })), []);
  check("NAME_EVIDENCE_CATEGORIES excludes email_address_evidence", NAME_EVIDENCE_CATEGORIES.includes("email-address-evidence"), false);
  check("NAME_EVIDENCE_CATEGORIES excludes signature_or_email_header_context", NAME_EVIDENCE_CATEGORIES.includes("signature-or-email-header-context"), false);
}

console.log("\n--- 7. A PROTECTED CANDIDATE IS EXCLUDED ENTIRELY, NOT WEIGHED ---");
{
  const protectedIds = personEvidencedCandidateIds([
    { candidateId: "person:grade rosters", qualityCategories: ["known-personal-name-token"], positiveReasons: [], contextualRules: [], hasPersonEvidencedLinkage: false },
  ]);
  const r = run(UNIVERSE, protectedIds);
  check("a protected candidate produces NO record at all", r.byCandidate["person:grade rosters"], undefined);
  check("its unprotected neighbours still fire", r.byCandidate["person:grade entry"]?.rules.includes("token_recurrence"), true);
}

console.log("\n--- 8. semanticTypeFor: shape yields to it, EVIDENCE never does ---");
{
  const base = { detectedType: "person", relationshipKinds: new Set<never>() };
  // SHAPE NO LONGER YIELDS PEOPLE AT ALL (AG's ruling, 2026-08-10), so the
  // flag has nothing left to defeat. Asserted in both states so a future
  // change that reinstates shape-qualifies fails here.
  check("shape only -> other, with or without the flag", semanticTypeFor({ ...base, categories: ["strong-name-structure"] }), "other");
  check("shape only, WITH cross-candidate evidence -> other", semanticTypeFor({ ...base, categories: ["strong-name-structure"], crossCandidateNonPerson: true }), "other");
  check("surname-given is shape too", semanticTypeFor({ ...base, categories: ["surname-given-structure"], crossCandidateNonPerson: true }), "other");
  check("NAME EVIDENCE never yields -- lexicon token", semanticTypeFor({ ...base, categories: ["known-personal-name-token"], crossCandidateNonPerson: true }), "people");
  check("NAME EVIDENCE never yields -- known first name", semanticTypeFor({ ...base, categories: ["known-first-name"], crossCandidateNonPerson: true }), "people");
  check("the flag is now INERT for routing -- shape is other either way",
    semanticTypeFor({ ...base, categories: ["strong-name-structure"] }),
    semanticTypeFor({ ...base, categories: ["strong-name-structure"], crossCandidateNonPerson: true }));
  check("an organization is unaffected by the flag", semanticTypeFor({ ...base, categories: ["institution-term"], crossCandidateNonPerson: true }), "organizations");
}

console.log("\n--- 9. EXPLANATIONS ARE DETERMINISTIC AND CARRY NO SCORE ---");
{
  const r = run();
  const lines = explainCrossCandidateEvidence(r.byCandidate["person:grade rosters"]!);
  check("token_recurrence produces a sentence", lines.some((l) => l.includes('"grade"') && l.includes("5 different detected phrases")), true);
  check("no numeric confidence appears anywhere", lines.some((l) => /score|confiden|%/i.test(l)), false);
  const trunc = explainCrossCandidateEvidence(r.byCandidate["person:term withdra"]!);
  check("truncation names its longer form", trunc.some((l) => l.includes("Term Withdrawals")), true);
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exitCode = 1;
