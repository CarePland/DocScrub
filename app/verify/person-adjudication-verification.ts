/**
 * person-adjudication-verification.ts -- the contract for Person adjudication
 * (AG, 2026-08-10).
 *
 *     node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs \
 *          verify/person-adjudication-verification.ts
 *
 * The properties that matter are not "the rule fires on New Student". They are
 * the ones that stop this module becoming the thing it was built instead of:
 * a combiner, a priority table, or a mechanism that turns absence into
 * negative evidence.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  adjudicatePerson,
  personEvidenceScopeOf,
  PERSON_RULE_MULTI_TOKEN_MEMBERSHIP_ONLY,
} from "../src/engines/interpretation/person-adjudication.js";
import { interpretCandidate, type InterpretationFacts } from "../src/engines/interpretation/candidate-interpretation.js";
import { referenceEvidenceFor } from "../src/engines/knowledge/ReferenceEvidence.js";
import { semanticTypeFor, typeCheckSectionFor } from "../src/domain/semanticTypes.js";
import type { RelationshipKind } from "../src/domain/StructuralRelationship.js";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}\n         expected ${e}\n         actual   ${a}`);
  }
}

const tokensOf = (v: string): number => v.replace(/,/g, " ").split(/\s+/).filter((t) => t.length > 0).length;

function facts(value: string, over: Partial<InterpretationFacts> = {}): InterpretationFacts {
  return {
    candidateId: `c:${value}`,
    displayValue: value,
    detectedType: "person",
    qualityCategories: [],
    positiveReasons: [],
    relationshipKinds: [],
    contextualRules: [],
    hasPersonEvidencedLinkage: false,
    reference: referenceEvidenceFor(value),
    ...over,
  };
}
const adjudicate = (value: string, over: Partial<InterpretationFacts> = {}) =>
  adjudicatePerson(interpretCandidate(facts(value, over)), tokensOf(value));

console.log("=== PERSON ADJUDICATION ===");

/* ═══════════ 1. WEAK EVIDENCE CANNOT BECOME AFFIRMATIVE PERSON EVIDENCE ═══════════ */

console.log("\n--- 1. COMPONENT-LEVEL EVIDENCE ALONE DOES NOT ESTABLISH THE SPAN ---");
{
  for (const value of ["New Student", "Class Level", "Last Date", "Start Date", "Grade Pro", "Staff Course"]) {
    const a = adjudicate(value);
    check(`${value}: Person rejected`, [a.personSupported, a.rejectedBy], [false, PERSON_RULE_MULTI_TOKEN_MEMBERSHIP_ONLY]);
  }
  const one = adjudicate("New Student");
  check("the rejection records that it HAD a Person reading", one.hadPersonReading, true);
  check("and names the scope of the evidence it rejected", [...one.scopes], ["component"]);
  check("the reason explains the claim, not the outcome", /claim about individual tokens/.test(one.reason), true);
}

/* ═══════════ 2. COMPONENT EVIDENCE CANNOT CLASSIFY THE WHOLE CANDIDATE ═══════════ */

console.log("\n--- 2. A TOKEN-LEVEL CLAIM IS NOT A CANDIDATE-LEVEL CLAIM ---");
{
  /* `known_personal_name_token` is set by scoring.ts by iterating tokens and
   * breaking on the first match. It is a claim about a token. */
  const scoped = adjudicate("If Joan", { qualityCategories: ["known_personal_name_token"] });
  check("a name-lexicon token on a multi-token span is component-scoped", [...scoped.scopes], ["component"]);

  /* ...but a lexicon match is NOT token membership, so P-6 does not reach it.
   * The rule is narrow on purpose: widening it to all component evidence
   * would have cost Perias, Nelly / Fox, Liud / Chriztopher Johnson. */
  check("...and P-6 does NOT reject it -- the rule is token-membership only", scoped.rejectedBy, null);

  /* Single-token candidates: the distinction collapses, so the rule cannot
   * fire at all. This is what protects `Chelsey` and `Agnes`. */
  for (const value of ["Chelsey", "Agnes", "Can", "You", "Morning"]) {
    check(`${value}: single token -- P-6 cannot fire`, adjudicate(value).rejectedBy, null);
  }
}

/* ═══════════ 3. REAL PEOPLE ARE NOT REACHED ═══════════ */

console.log("\n--- 3. THE MEASURED PEOPLE POPULATION IS UNTOUCHED ---");
{
  const people: Array<[string, Partial<InterpretationFacts>]> = [
    ["Collier, Tanesha", {}],
    ["Yamada, Tamara", {}],
    ["Goodloe, Andrew", {}],
    ["Perias, Nelly", { qualityCategories: ["known_personal_name_token"] }],
    ["Will Diana", { qualityCategories: ["known_personal_name_token"] }],
    ["Amy Miller", {}],
    ["Chriztopher Johnson", {}],
    ["Fox, Liud", { qualityCategories: ["known_personal_name_token"] }],
  ];
  for (const [value, over] of people) {
    const a = adjudicate(value, over);
    check(`${value}: Person survives`, [a.personSupported, a.rejectedBy], [true, null]);
  }
}

/* ═══════════ 4. GENUINE AMBIGUITY SURVIVES ═══════════ */

console.log("\n--- 4. PERSON/OTHER AMBIGUITY IS NOT RESOLVED BY THIS MODULE ---");
{
  /* San Diego carries Census name STRUCTURE (candidate-span) AND GNIS place
   * attestation. Both readings are independently supported and both survive:
   * there is no "Place beats Person" here. */
  const sd = adjudicate("San Diego");
  check("San Diego: Person survives alongside place", sd.personSupported, true);
  check("...and place is recorded as a surviving alternative", [...sd.survivingAlternatives], ["place"]);
  check("...with no reclassification proposed", sd.disposition, "person-survives");

  /* Ordinary-language overlap must never demote Person -- measured cost of
   * assuming otherwise: 10 real people. */
  const andrew = adjudicate("Andrew", { qualityCategories: ["known_first_name", "expanded_common_language_token"] });
  check("ordinary-language overlap does not demote Person", andrew.personSupported, true);
  check("...and the ordinary-language reading is still recorded",
    andrew.survivingAlternatives.includes("ordinary-language"), true);
}

/* ═══════════ 5. RECLASSIFICATION REQUIRES AFFIRMATIVE ALTERNATIVE EVIDENCE ═══════════ */

console.log("\n--- 5. `NOT PERSON` IMPLIES NOTHING ABOUT WHAT A CANDIDATE IS ---");
{
  const noAlternative = adjudicate("New Student");
  check("rejected with no alternative -> undetermined", noAlternative.disposition, "undetermined");
  check("...and proposes no reclassification target", noAlternative.reclassifyTo, null);

  const oneAlternative = adjudicate("Records Team", { qualityCategories: ["department_organization"] });
  check("rejected with exactly one alternative -> reclassify", oneAlternative.disposition, "reclassify");
  check("...naming the alternative the system already supported", oneAlternative.reclassifyTo, "organization");

  const manyAlternatives = adjudicate("Staff Course", {
    qualityCategories: ["department_organization", "common_english_word"],
  });
  check("rejected with several alternatives -> contested, not a pick",
    manyAlternatives.disposition, "contested-without-person");
  check("...and still proposes no target", manyAlternatives.reclassifyTo, null);

  /* Absence of a Person reading is NOT a rejection and must stay
   * distinguishable from one. */
  const never = adjudicate("Zathras Quorbelfrimp", { detectedType: "unknown" });
  check("no Person reading at all is reported as absence, not rejection",
    [never.hadPersonReading, never.rejectedBy], [false, null]);
  check("...and its reason says so", /absence of evidence, not a rejection/.test(never.reason), true);
}

/* ═══════════ 6. NO SCORES, NO PRIORITY TABLE, NO NEGATIVE-FROM-ABSENCE ═══════════ */

console.log("\n--- 6. THE THINGS THIS MODULE MUST NOT HAVE ---");
{
  const source = readFileSync("src/engines/interpretation/person-adjudication.ts", "utf8");
  const code = source.split("\n").filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//")).join("\n");
  check("no confidence, weight or score", /\b(confidence|weight|score|probability)\b/i.test(code), false);
  check("no semantic priority ordering", /\b(priority|precedence|beats|outrank|rank)\b/i.test(code), false);
  check("no rule keyed on the ABSENCE of evidence",
    /!\s*\w*(census|lexicon|context|attest)/i.test(code), false);

  const serialized = JSON.stringify(adjudicate("Goodloe, Andrew"));
  check("an adjudication exposes no numeric judgment",
    /"(confidence|weight|score)"\s*:/i.test(serialized), false);

  /* Exactly one rule ships. */
  const ruleIds = [...code.matchAll(/person-adjudication\/[a-z-]+/g)].map((m) => m[0]);
  check("exactly one rule id exists", [...new Set(ruleIds)], [PERSON_RULE_MULTI_TOKEN_MEMBERSHIP_ONLY]);
}

/* ═══════════ 7. DETERMINISM AND SCOPE CLASSIFICATION ═══════════ */

console.log("\n--- 7. DETERMINISM ---");
{
  for (const value of ["New Student", "Goodloe, Andrew", "San Diego", "Chelsey", "Records Team"]) {
    const a = JSON.stringify(adjudicate(value));
    const b = JSON.stringify(adjudicate(value));
    check(`${value}: repeated adjudication is byte-identical`, a === b, true);
  }
  const census = interpretCandidate(facts("Goodloe, Andrew")).interpretations.find((i) => i.id === "person")!;
  const structure = census.signals.find((s) => s.signalId === "person/census-name-structure")!;
  const membership = census.signals.find((s) => s.signalId === "person/census-token-membership")!;
  check("census structure is candidate-span", personEvidenceScopeOf(structure, 2), "candidate-span");
  check("census token membership is component", personEvidenceScopeOf(membership, 2), "component");
  check("...but on a single token the distinction collapses", personEvidenceScopeOf(membership, 1), "candidate-span");
}

/* ═══════════ 8. INERTNESS AND UNCHANGED BEHAVIOUR ═══════════ */

console.log("\n--- 8. NOTHING CONSUMES THIS, AND NOTHING MOVED ---");
{
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith(".ts")) files.push(full.replace(/\\/g, "/"));
    }
  };
  walk("src");
  const sourceOf = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));
  check("no production module imports Person adjudication",
    [...sourceOf.entries()].filter(([, s]) => /from\s+"[^"]*\/person-adjudication\.js"/.test(s)).map(([f]) => f),
    []);

  for (const module of [
    "src/domain/semanticTypes.ts",
    "src/engines/quality/scoring.ts",
    "src/engines/cross-candidate/person-evidence-gate.ts",
    "src/engines/review/residualReviewGate.ts",
    "src/ui/recommendations.ts",
    "src/io/AuditExporter.ts",
    "src/workspace/Workspace.ts",
  ]) {
    const src = sourceOf.get(module);
    check(`${module} is present`, typeof src, "string");
    if (typeof src !== "string") continue;
    check(`${module} does not mention Person adjudication`,
      /adjudicatePerson|PersonAdjudication|person-adjudication/.test(src), false);
  }

  /* Routing is unchanged, spot-checked across the branch chain. */
  const cases: Array<[string, Parameters<typeof semanticTypeFor>[0], string]> = [
    ["person with name evidence", { detectedType: "person", categories: ["known-personal-name-token"], relationshipKinds: new Set<RelationshipKind>() }, "people"],
    ["person with shape only", { detectedType: "person", categories: ["strong-name-structure"], relationshipKinds: new Set<RelationshipKind>() }, "other"],
    ["organization", { detectedType: "organization", categories: [], relationshipKinds: new Set<RelationshipKind>() }, "organizations"],
  ];
  for (const [label, input, expected] of cases) check(`semanticTypeFor unchanged: ${label}`, semanticTypeFor(input), expected);
  check("New Student still routes exactly where it did",
    typeCheckSectionFor({ detectedType: "person", categories: [], relationshipKinds: new Set<RelationshipKind>() }, false).section,
    "undetermined");
}

console.log("");
if (failures > 0) {
  console.log(`PERSON ADJUDICATION: ${failures} FAILURE(S)`);
  process.exit(1);
}
console.log("PERSON ADJUDICATION: all checks passed.");
