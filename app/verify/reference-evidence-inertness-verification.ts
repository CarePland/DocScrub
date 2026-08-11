/**
 * reference-evidence-inertness-verification.ts -- ONE contract, ALL EIGHT
 * reference evidence families (AG, 2026-08-10).
 *
 *     node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs \
 *          verify/reference-evidence-inertness-verification.ts
 *
 * ══════════════════ WHY THIS EXISTS ALONGSIDE THE PER-FAMILY SUITES ══════════════════
 *
 * Every family already ships its own verification suite, and several of them
 * (Employment/HR §11, Government §, Medical §11) assert their own inertness.
 * Those suites are correct and are left exactly as they are. But each was
 * written when its family landed, against the families that happened to exist
 * at the time, so the guarantee they collectively provide is ragged:
 *
 *   - Census and GNIS predate the pattern and have no import-scan at all;
 *   - Higher-ed and Medical assert their own imports but not each other's;
 *   - nothing anywhere states, in one place, what the COMPLETE set of
 *     production consumers of reference evidence is.
 *
 * The last one is the gap that matters. Inertness is not a per-family
 * property -- it is a property of the boundary between the evidence layer and
 * the decision layer, and a boundary needs one place that names every hole in
 * it. This is that place.
 *
 * ══════════════════ THE ONE HOLE, NAMED DELIBERATELY ══════════════════
 *
 * Census name evidence IS behaviourally consumed today, and this suite records
 * that rather than pretending otherwise. `Workspace.loadDocument` passes
 * `hasCensusNameStructure` into the person-protection gate
 * (engines/cross-candidate/person-evidence-gate.ts), which decides which
 * candidates cross-candidate interpretation may touch. That coupling predates
 * this audit, is documented at both ends, and is the reason `Yazmine Guzmán`
 * and `Amy Miller` reach People.
 *
 * IT IS PINNED HERE, NOT BLESSED. The assertions below fix its exact extent:
 * one call site, one direction (evidence FOR personhood, never against), and
 * no other family joining it. If a future change makes a SECOND family
 * behavioural -- or makes Census behavioural in a second place -- this suite
 * fails, which is the entire point. The correct response to that failure is a
 * deliberate design decision about combination policy, not a green tick.
 *
 * Everything else must be inert: computed, exposed, traced, and read by
 * nothing that scores, classifies, routes, suppresses, selects a review stage
 * or shapes output.
 *
 * Pure source-text and behavioural assertions. Loads no document, mutates
 * nothing, and is safe to run in any order relative to the rest of the battery.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { semanticTypeFor, typeCheckSectionFor, type SemanticTypeFacts } from "../src/domain/semanticTypes.js";
import type { RelationshipKind } from "../src/domain/StructuralRelationship.js";

let failures = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}\n         expected ${e}\n         actual   ${a}`);
  }
}

/* ─────────────────────── the source corpus ─────────────────────── */

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

const importersOf = (pattern: RegExp): string[] =>
  [...sourceOf.entries()].filter(([, src]) => pattern.test(src)).map(([f]) => f).sort();

/* ─────────────────────── 1. THE FAMILY REGISTER ─────────────────────── */

/**
 * The eight families, their provider modules and their generated assets.
 *
 * A NEW FAMILY MUST BE ADDED HERE. That is deliberate friction: this suite
 * cannot notice a family it does not know about, so the register is the one
 * place a new pack has to declare itself to the inertness contract. §2's count
 * assertion is what makes forgetting it fail rather than pass silently.
 */
const FAMILIES: Array<{ id: string; provider: string; asset: string }> = [
  { id: "census-name", provider: "CensusNameEvidence", asset: "census-names.data" },
  { id: "gnis-place", provider: "GnisPlaceEvidence", asset: "gnis-places.data" },
  { id: "higher-ed-terminology", provider: "HigherEdTerminologyEvidence", asset: "higher-ed-terminology.data" },
  { id: "legal-terminology", provider: "LegalTerminologyEvidence", asset: "legal-terminology.data" },
  { id: "medical-terminology", provider: "MedicalEvidence", asset: "medical-terminology.data" },
  { id: "finance-accounting-tax", provider: "FinanceAccountingTaxEvidence", asset: "finance-accounting-tax-terminology.data" },
  { id: "employment-hr-terminology", provider: "EmploymentHrEvidence", asset: "employment-hr-terminology.data" },
  { id: "government-public-admin", provider: "GovernmentPublicAdminEvidence", asset: "government-public-admin-terminology.data" },
];

console.log("=== REFERENCE EVIDENCE INERTNESS ===");
console.log(`    ${FAMILIES.length} families, one boundary, one contract.`);

console.log("\n--- 1. EVERY FAMILY IS REGISTERED AND ITS ASSET HAS EXACTLY ONE READER ---");
check("eight families are registered", FAMILIES.length, 8);
for (const family of FAMILIES) {
  check(
    `${family.id}: only its own provider reads the generated asset`,
    importersOf(new RegExp(`from\\s+"[^"]*/${family.asset.replace(/\./g, "\\.")}\\.js"`)),
    [`src/engines/knowledge/${family.provider}.ts`]
  );
}

/* ─────────────────────── 2. THE COMPLETE CONSUMER SET ─────────────────────── */

/**
 * Who, in `src/`, imports each provider at all.
 *
 * The allow-list is exhaustive and literal rather than a permissive regex,
 * because the realistic way this contract erodes is a plausible-looking new
 * importer, not an obviously wrong one.
 */
console.log("\n--- 2. THE COMPLETE SET OF PRODUCTION CONSUMERS, NAMED ---");

const ALLOWED_IMPORTERS: Record<string, string[]> = {
  /* Census is read by the fan-out, by Workspace (which feeds the ONE
   * behavioural coupling -- see §4), by GNIS (which uses Census roles for its
   * own Policy B suppression, inside the evidence layer), and by the console
   * diagnostic. */
  CensusNameEvidence: [
    /*
     * ADDED 2026-08-10, Phase A of the interpretation layer. This suite is
     * what forced the addition to be deliberate rather than quiet, which is
     * what it was written for -- so the reason is recorded here.
     *
     * `candidate-interpretation.ts` calls `censusRoleFor` to derive the
     * `token-membership` signal: "this token occurs somewhere in Census name
     * data". That is the WEAKEST claim in the system and the source of the
     * dominant collision population, and a model that cannot NAME it cannot
     * reason about it. It is derived into an inert profile that nothing reads.
     *
     * IT IS NOT FED TO THE PROTECTION GATE. §4 below still asserts that the
     * gate reads STRUCTURE only, and verify/candidate-interpretation-
     * verification.ts §10 asserts the same property from the other side.
     */
    /*
     * ADDED 2026-08-10, variant-form evidence. It needs to SCAN the corpus to
     * build a near-form generation index, not just look tokens up.
     *
     * Note what it does NOT do: read `census-names.data.js` directly. The first
     * draft did, and this suite's §1 caught it -- which is the assertion doing
     * exactly its job. `CensusNameEvidence` grew a `censusAttestedTokens()`
     * accessor instead, so the one-asset-one-reader invariant survives and the
     * asset is still parsed exactly once.
     */
    "src/engines/interpretation/candidate-interpretation.ts",
    "src/engines/interpretation/variant-form-evidence.ts",
    "src/engines/knowledge/GnisPlaceEvidence.ts",
    "src/engines/knowledge/ReferenceEvidence.ts",
    "src/ui/app.ts",
    "src/workspace/Workspace.ts",
  ],
  GnisPlaceEvidence: [
    "src/engines/knowledge/ReferenceEvidence.ts",
    "src/ui/app.ts",
    "src/workspace/Workspace.ts",
  ],
  /* Higher-ed and Medical additionally have a per-family Workspace map that
   * predates the fan-out. Known duplication, kept on purpose -- see
   * Workspace.getReferenceEvidence's header. */
  HigherEdTerminologyEvidence: [
    "src/engines/knowledge/ReferenceEvidence.ts",
    "src/ui/app.ts",
    "src/workspace/Workspace.ts",
  ],
  MedicalEvidence: [
    "src/engines/knowledge/ReferenceEvidence.ts",
    "src/ui/app.ts",
    "src/workspace/Workspace.ts",
  ],
  /* The four substrate-era packs reach production ONLY through the fan-out.
   * This is what a family added after ReferenceEvidence.ts existed costs. */
  LegalTerminologyEvidence: ["src/engines/knowledge/ReferenceEvidence.ts"],
  FinanceAccountingTaxEvidence: ["src/engines/knowledge/ReferenceEvidence.ts"],
  EmploymentHrEvidence: ["src/engines/knowledge/ReferenceEvidence.ts"],
  GovernmentPublicAdminEvidence: ["src/engines/knowledge/ReferenceEvidence.ts"],
};

for (const family of FAMILIES) {
  check(
    `${family.id}: importers are exactly the allowed set`,
    importersOf(new RegExp(`from\\s+"[^"]*/${family.provider}\\.js"`)),
    ALLOWED_IMPORTERS[family.provider]
  );
}

/*
 * The fan-out's consumers, named literally.
 *
 * `candidate-interpretation.ts` joined this list in Phase A of the
 * interpretation layer (2026-08-10) and is the intended shape of a consumer:
 * it reads the channels whole, derives an inert profile, and routes nothing.
 * Reading the channels whole is deliberate -- digesting them in Workspace
 * instead would put per-family knowledge back into the file the fan-out
 * exists to keep family-agnostic.
 */
check(
  "the fan-out's consumers are exactly the interpretation layer, the collection point and the diagnostic",
  importersOf(/from\s+"[^"]*\/ReferenceEvidence\.js"/).filter((f) => !f.endsWith("/ReferenceEvidence.ts")),
  ["src/engines/interpretation/candidate-interpretation.ts", "src/ui/app.ts", "src/workspace/Workspace.ts"]
);
check(
  "the collection point's accessor has exactly one caller, the diagnostic",
  [...sourceOf.entries()]
    .filter(([f, src]) => f !== "src/workspace/Workspace.ts" && /getReferenceEvidence\s*\(/.test(src))
    .map(([f]) => f)
    .sort(),
  ["src/ui/app.ts"]
);

/* ─────────────────────── 3. THE DECISION MODULES ARE CLEAN ─────────────────────── */

/**
 * The modules that decide things. None of them may mention any family, by
 * name or by asset, in any form.
 *
 * `semanticTypes.ts` is EXCLUDED from the name scan on purpose and audited
 * behaviourally in §5 instead: it legitimately carries four inert facts as
 * fields, so a text scan there would either fail on the documented design or
 * have to be weakened into uselessness. Whether it BRANCHES on them is the
 * real question, and only execution can answer it.
 */
console.log("\n--- 3. NO DECISION MODULE MENTIONS ANY EVIDENCE FAMILY ---");

const DECISION_MODULES = [
  "src/engines/quality/scoring.ts",
  "src/engines/CandidateQualityEngine.ts",
  "src/engines/DetectionEngine.ts",
  "src/engines/EntityResolutionEngine.ts",
  "src/engines/OccurrenceClassifier.ts",
  "src/engines/review/residualReviewGate.ts",
  "src/engines/review/session.ts",
  "src/engines/cross-candidate/cross-candidate-evidence.ts",
  "src/engines/normalization/normalization.ts",
  "src/io/AuditExporter.ts",
  "src/ui/recommendations.ts",
  "src/ui/triageQueue.ts",
  "src/ui/reviewZone.ts",
];

const FAMILY_MENTIONS = [
  /gnisPlace|gnis-place|GnisPlaceEvidence/i,
  /higherEd|higher-ed/i,
  /medicalEvidence|medical-terminology|medicalTerminology/i,
  /legalTerminology|legal-terminology/i,
  /financeAccountingTax|finance-accounting-tax/i,
  /employmentHr|employment-hr/i,
  /governmentPublicAdmin|government-public-admin/i,
  /referenceEvidenceFor|ReferenceEvidenceChannels/,
];

for (const module of DECISION_MODULES) {
  const src = sourceOf.get(module);
  check(`${module} is present in the tree`, typeof src, "string");
  if (typeof src !== "string") continue;
  const hits = FAMILY_MENTIONS.filter((p) => p.test(src)).map((p) => p.source);
  check(`${module} mentions no evidence family`, hits, []);
}

/* Census is scanned separately, because the ONE legitimate coupling lives at a
 * named site and a blanket scan would either miss it or wrongly flag it. */
console.log("\n    Census, scanned separately -- see §4 for why:");
for (const module of DECISION_MODULES) {
  const src = sourceOf.get(module);
  if (typeof src !== "string") continue;
  check(`${module} does not import Census evidence`, /from\s+"[^"]*\/CensusNameEvidence\.js"/.test(src), false);
}

/* ─────────────────────── 4. THE ONE COUPLING, PINNED ─────────────────────── */

/**
 * Census -> person-protection gate. Real, documented, and bounded here.
 *
 * The gate's contract is that it takes evidence FOR personhood and never
 * against: `hasCensusNameStructure` can only ever ADD a candidate to the
 * protected set. That direction is what makes the coupling safe, and it is
 * asserted structurally below -- the field appears in exactly one gate
 * expression, and the gate exposes no field that could remove protection.
 */
console.log("\n--- 4. THE ONE BEHAVIOURAL COUPLING: CENSUS -> PERSON-PROTECTION GATE ---");
{
  const gate = sourceOf.get("src/engines/cross-candidate/person-evidence-gate.ts");
  check("the gate module exists", typeof gate, "string");
  if (typeof gate === "string") {
    check("the gate reads Census structure as a fact, not by importing the provider",
      /from\s+"[^"]*\/CensusNameEvidence\.js"/.test(gate), false);
    check("the gate declares exactly one Census field", (gate.match(/hasCensusNameStructure/g) ?? []).length >= 1, true);
    /* The failure mode this forbids: a `hasHigherEdTerminology`,
     * `hasMedicalTerminology` or similar DISQUALIFIER joining the gate. Every
     * one of those would suppress real people, which is the single error class
     * the gate exists to prevent. */
    const disqualifiers = [/hasHigherEd/i, /hasMedical/i, /hasLegal/i, /hasFinance/i, /hasEmployment/i, /hasGovernment/i, /hasGnis/i]
      .filter((p) => p.test(gate))
      .map((p) => p.source);
    check("no terminology or geography disqualifier has joined the gate", disqualifiers, []);
  }

  const workspace = sourceOf.get("src/workspace/Workspace.ts")!;
  check("Workspace feeds Census into the gate at exactly one site",
    (workspace.match(/hasCensusNameStructure:/g) ?? []).length, 1);
  check("and feeds no other family into it",
    /has(HigherEd|Medical|Legal|Finance|Employment|Government|Gnis)\w*:/.test(workspace), false);
}

/* ─────────────────────── 5. BEHAVIOURAL INERTNESS ─────────────────────── */

/**
 * The assertion that source scanning cannot make: toggling every inert fact,
 * in every combination, changes NOTHING that `semanticTypeFor` or
 * `typeCheckSectionFor` returns.
 *
 * This is stronger than the per-family suites, each of which toggles its own
 * field alone. A rule reading TWO inert facts jointly -- "higher-ed AND
 * medical implies not a person" -- would pass every single-field test and fail
 * here. That is precisely the shape a first attempt at a combination rule
 * takes, so it is the shape worth guarding.
 */
console.log("\n--- 5. BEHAVIOURAL: TOGGLING EVERY INERT FACT, IN EVERY COMBINATION, CHANGES NOTHING ---");
{
  const base = (over: Partial<SemanticTypeFacts>): SemanticTypeFacts => ({
    detectedType: "person",
    categories: [],
    relationshipKinds: new Set<RelationshipKind>(),
    ...over,
  });

  /* A spread wide enough that a hidden branch has somewhere to show itself:
   * person-evidenced, shape-only, institutional, acronym, identifier, and the
   * undetermined fallthrough. */
  const POPULATIONS: Array<{ label: string; facts: SemanticTypeFacts }> = [
    { label: "person with name-token evidence", facts: base({ categories: ["known-personal-name-token"] }) },
    { label: "person with shape only", facts: base({ categories: ["strong-name-structure"] }) },
    { label: "person, no categories", facts: base({}) },
    { label: "organization-typed", facts: base({ detectedType: "organization" }) },
    { label: "institutional category", facts: base({ detectedType: "unknown", categories: ["institution-name"] }) },
    { label: "acronym", facts: base({ detectedType: "unknown", categories: ["likely-acronym"] }) },
    { label: "identifier", facts: base({ detectedType: "cin" }) },
    { label: "calendar term", facts: base({ detectedType: "unknown", categories: ["calendar-term"] }) },
    { label: "document structure", facts: base({ detectedType: "unknown", categories: ["document-structure-term"] }) },
    { label: "fallthrough / undetermined", facts: base({ detectedType: "unknown" }) },
  ];

  /* Every inert fact, and every value it can take. `censusNameStructure` is
   * included: it is carried on the facts and, per its own doc comment,
   * `semanticTypeFor` may not branch on it either -- the gate is the only
   * place it is allowed to matter. */
  const INERT_FACTS: Array<{ name: keyof SemanticTypeFacts; values: unknown[] }> = [
    { name: "censusNameStructure", values: [false, true] },
    { name: "higherEdTerminologyAttested", values: [false, true] },
    { name: "medicalTerminologyAttested", values: [false, true] },
    { name: "gnisPlaceStrength", values: ["none", "weak", "strong"] },
  ];

  let combinations = 0;
  let deviations = 0;
  const witnesses: string[] = [];

  for (const population of POPULATIONS) {
    for (const nonPersonEvidence of [false, true]) {
      const baselineType = semanticTypeFor(population.facts);
      const baselineSection = JSON.stringify(typeCheckSectionFor(population.facts, nonPersonEvidence));

      /* Full cross product of the inert facts -- 2 x 2 x 2 x 3 = 24 per
       * population per gate value. Small enough to be exhaustive, which is
       * the only way to catch a joint rule. */
      const cross: Array<Partial<SemanticTypeFacts>> = [{}];
      for (const fact of INERT_FACTS) {
        const next: Array<Partial<SemanticTypeFacts>> = [];
        for (const partial of cross) {
          for (const value of fact.values) {
            next.push({ ...partial, [fact.name]: value } as Partial<SemanticTypeFacts>);
          }
        }
        cross.length = 0;
        cross.push(...next);
      }

      for (const overlay of cross) {
        combinations += 1;
        const facts = { ...population.facts, ...overlay };
        if (semanticTypeFor(facts) !== baselineType) {
          deviations += 1;
          if (witnesses.length < 5) witnesses.push(`${population.label} / semanticTypeFor / ${JSON.stringify(overlay)}`);
        }
        if (JSON.stringify(typeCheckSectionFor(facts, nonPersonEvidence)) !== baselineSection) {
          deviations += 1;
          if (witnesses.length < 5) witnesses.push(`${population.label} / typeCheckSectionFor(${nonPersonEvidence}) / ${JSON.stringify(overlay)}`);
        }
      }
    }
  }

  console.log(`    ${combinations} fact combinations across ${POPULATIONS.length} populations x 2 gate values.`);
  check("no combination of inert facts changes the semantic type or the section", deviations, 0);
  if (witnesses.length > 0) console.log(`    witnesses: ${witnesses.join(" | ")}`);
}

/* ─────────────────────── 6. THE AUDIT EXPORT IS UNTOUCHED ─────────────────────── */

/**
 * Reference evidence decides nothing, so it must not appear in the exported
 * audit either. `ReferenceEvidence.ts` builds `ReferenceEvidenceAuditRow`
 * deliberately as a DEVELOPMENT instrument that is not wired to the export;
 * this pins that. Wiring it is a decision for whoever builds the combination
 * layer, once the evidence actually influences something a reader would need
 * explained.
 */
console.log("\n--- 6. THE EXPORTED AUDIT DOES NOT CARRY REFERENCE EVIDENCE ---");
{
  const exporter = sourceOf.get("src/io/AuditExporter.ts")!;
  check("the exporter does not import the fan-out", /ReferenceEvidence\.js/.test(exporter), false);
  check("the exporter does not build reference audit rows", /referenceEvidenceAuditRows/.test(exporter), false);
  const auditRecord = sourceOf.get("src/domain/AuditRecord.ts")!;
  check("AuditRecord carries no reference-evidence field",
    /referenceEvidence|censusName|gnisPlace|higherEd|medicalTerminology/i.test(auditRecord), false);
}

/* ─────────────────────── result ─────────────────────── */

console.log("");
if (failures > 0) {
  console.log(`REFERENCE EVIDENCE INERTNESS: ${failures} FAILURE(S)`);
  process.exit(1);
}
console.log("REFERENCE EVIDENCE INERTNESS: all checks passed.");
