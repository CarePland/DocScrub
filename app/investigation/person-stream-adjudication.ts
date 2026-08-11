/**
 * person-stream-adjudication.ts -- INVESTIGATION ONLY. What each kind of
 * Person evidence actually entitles DocScrub to conclude (AG, 2026-08-10).
 *
 *     node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs \
 *          investigation/person-stream-adjudication.ts
 *
 * ═══════════════════ THE QUESTION ═══════════════════
 *
 * The production diagnostic reports Person supported on 273 of 601 candidates,
 * 200 of them competing with another reading, and 97 resting only on token
 * membership. The question is not "which candidates are people" but:
 *
 *     what does each Person signal CLAIM, and about WHAT?
 *
 * ═══════════════════ THE LIMIT OF THIS HARNESS, STATED FIRST ═══════════════════
 *
 * Two production channels CANNOT be reproduced here:
 *
 *     occurrence-context      needs the surrounding prose of real occurrences
 *     document-consistency    needs the real candidate population
 *
 * Both are active in production and both are absent here. Every measurement
 * below is therefore bounded to CANDIDATE-INTRINSIC evidence -- quality
 * categories, reference attestation, variant relationships. Any rule whose
 * effect depends on context or document consistency CANNOT be evaluated by
 * this harness, and that is stated rather than worked around.
 *
 * What this harness CAN answer, and what the production diagnostic cannot:
 * whether a Person signal makes a claim about the CANDIDATE SPAN or about a
 * TOKEN INSIDE IT. That is a property of the evidence, not of the document,
 * and it turns out to be the crux.
 *
 * ═══════════════════ LABELS ARE FOR EVALUATION ONLY ═══════════════════
 *
 * Andrew's readings -- from LIVE_RESIDUE and from the production witness
 * lists -- are used ONLY to score what a proposed rule would do. They are
 * never inputs to any derivation, never production lookup data, and no rule
 * below was tuned against them: every rule is stated before it is measured.
 *
 * Read-only. Writes no file, changes no state, not part of the battery.
 */

import { interpretCandidate, type InterpretationFacts } from "../src/engines/interpretation/candidate-interpretation.js";
import {
  independentWitnessGroups,
  interpretationIdsOf,
  type InterpretationProfile,
  type InterpretationSignal,
} from "../src/engines/interpretation/interpretation-model.js";
import { referenceEvidenceFor } from "../src/engines/knowledge/ReferenceEvidence.js";
import { censusRoleFor, normalizeForCensusLookup } from "../src/engines/knowledge/CensusNameEvidence.js";
import { scoreCandidateQuality } from "../src/engines/quality/scoring.js";
import { qualityCategoriesOf, typeCheckSectionFor } from "../src/domain/semanticTypes.js";
import type { Candidate, ContentBlock, Occurrence } from "../src/domain/DocumentModel.js";
import type { RelationshipKind } from "../src/domain/StructuralRelationship.js";
import { LIVE_RESIDUE } from "./live-residue.data.js";

/* ═══════════════════ EVIDENCE SCOPE ═══════════════════ */

/**
 * WHAT A PERSON SIGNAL IS A CLAIM ABOUT. This is the taxonomy the prompt's
 * question F asks for, and it is derived from what each signal's producing
 * code actually tests -- not from what its name suggests.
 *
 *   candidate-span   the claim is about the WHOLE extracted span
 *   component        the claim is about one or more TOKENS inside the span
 *   neighbourhood    the claim is about text AROUND the span
 *   inherited        the claim comes from a DIFFERENT candidate
 *
 * The distinction matters because a component-level claim survives a wrong
 * span. `If Joan` earns `known_personal_name_token` because `Joan` is a known
 * given name; the claim is true, and it is not a claim about `If Joan`.
 */
type EvidenceScope = "candidate-span" | "component" | "neighbourhood" | "inherited";

/**
 * Verified against the producing code, with the reason recorded:
 *
 *  person/census-name-structure     CANDIDATE-SPAN. `censusNameEvidenceFor`
 *      tests the FIRST and LAST token for agreeing first/surname roles -- a
 *      claim about the shape of the whole span.
 *
 *  person/census-token-membership   COMPONENT. Fires when every alphabetic
 *      token is Census-attested. A conjunction of token facts; it says
 *      nothing about the span's structure. `New Student` qualifies.
 *
 *  person/name-lexicon              COMPONENT (usually). `scoring.ts` sets
 *      `known_personal_name_token` by iterating tokens and BREAKING ON THE
 *      FIRST MATCH -- literally "some token is a known given name". For a
 *      single-token candidate the distinction collapses and it is effectively
 *      candidate-span; that case is separated below.
 *
 *  person/nearby-title              NEIGHBOURHOOD. An honorific ADJACENT to
 *      the span.
 *
 *  person/anchor:*                  CANDIDATE-SPAN. Anchor rules require
 *      FULL_NAME_SHAPE_RE of the candidate ITSELF before they fire -- the one
 *      contextual family that inspects the span.
 *
 *  person/contextual-usage:*        NEIGHBOURHOOD. Reports a grammatical role
 *      for the span; the live witness audit found these firing on
 *      `Academic Senate`, `Computer Science` and `San Diego`.
 *
 *  person/entity-linkage            INHERITED, from a partner candidate.
 *
 *  person/variant-form*             COMPONENT. A resemblance between one
 *      observed TOKEN and an attested form.
 */
function scopeOf(signal: InterpretationSignal, tokenCount: number): EvidenceScope {
  const id = signal.signalId;
  if (id === "person/census-name-structure") return "candidate-span";
  if (id.startsWith("person/anchor:")) return "candidate-span";
  if (id === "person/nearby-title") return "neighbourhood";
  if (id.startsWith("person/contextual-usage:")) return "neighbourhood";
  if (id === "person/entity-linkage") return "inherited";
  /* Single-token candidates: component and span are the same thing. */
  if (tokenCount === 1) return "candidate-span";
  return "component";
}

/* ═══════════════════ population construction ═══════════════════ */

function qualityCategoriesFor(value: string): readonly string[] {
  const block: ContentBlock = {
    id: "b1", kind: "body", text: value, order: 0,
    sourceMapping: { partName: "word/document.xml", nodePath: "/p[1]" }, runMappings: [],
  };
  const occurrence: Occurrence = {
    id: "o1", candidateId: "c1", blockId: "b1", startOffset: 0, endOffset: value.length,
    text: value, context: value, source: "regex",
  };
  const candidate: Candidate = {
    id: "c1", detectedType: "person", source: "regex", confidence: "medium",
    normalizedValue: value.toLowerCase(), displayValue: value, occurrenceIds: ["o1"],
  };
  /* FLAT ScoredQuality -- not `{ assessment }`. The Phase B harness got this
   * wrong and silently measured zero lexicon evidence for a whole population. */
  return qualityCategoriesOf(scoreCandidateQuality(candidate, [occurrence], new Map([["b1", block]])));
}

/** Andrew's reading, used ONLY for evaluation. `boundary` marks a candidate
 *  whose SPAN is wrong -- a different defect from a wrong semantic reading. */
type Label = "person" | "non-person" | "boundary" | "?";

/**
 * The named witnesses from the production run. Grouped as Andrew grouped them,
 * with one deliberate deviation: the extraction-boundary cases are labelled
 * `boundary` rather than `non-person`, because `If Joan` DOES contain a real
 * person and calling it a non-person would score a span defect as a semantic
 * one. Keeping them separate is the whole point of §6.
 */
const PRODUCTION_WITNESSES: Array<[string, Label]> = [
  ["Collier, Tanesha", "person"], ["Yamada, Tamara", "person"], ["Goodloe, Andrew", "person"],
  ["Perias, Nelly", "person"], ["Will Diana", "person"], ["Chelsey", "person"], ["Agnes", "person"],

  ["Records Team", "non-person"], ["Staff Course", "non-person"], ["Staff Run Query", "non-person"],
  ["Cal State", "non-person"], ["Academic Records", "non-person"], ["Graduation Office", "non-person"],
  ["Good Morning", "non-person"], ["Happy Monday", "non-person"], ["Academic Senate", "non-person"],
  ["New Student", "non-person"], ["Class Level", "non-person"], ["Last Date", "non-person"],
  ["Grade Pro", "non-person"], ["Grad App", "non-person"], ["PDF", "non-person"], ["CHRS", "non-person"],
  ["WFH", "non-person"], ["POLS", "non-person"], ["San Diego", "non-person"], ["East Bay", "non-person"],

  ["Has", "non-person"], ["Chat", "non-person"], ["Last", "non-person"], ["Draft", "non-person"],
  ["You", "non-person"], ["Can", "non-person"], ["Like", "non-person"], ["Morning", "non-person"],
  ["The", "non-person"], ["For", "non-person"],

  ["If Joan", "boundary"], ["When Ruth", "boundary"], ["Did Dr", "boundary"],
  ["Regarding Summer", "boundary"], ["Records, Thanks Andrew", "boundary"], ["Thanks Andrew", "boundary"],
];

const documentAttestedTokens = new Set<string>();
for (const [value] of [...PRODUCTION_WITNESSES, ...LIVE_RESIDUE.map((u) => [u.value] as [string])]) {
  for (const token of value.replace(/,/g, " ").split(/\s+/)) {
    const normalized = normalizeForCensusLookup(token);
    if (normalized.length > 0 && censusRoleFor(normalized) !== null) documentAttestedTokens.add(normalized);
  }
}

interface Unit {
  value: string;
  label: Label;
  origin: "production-witness" | "live-residue";
  tokenCount: number;
  categories: readonly string[];
  profile: InterpretationProfile;
  personSignals: readonly InterpretationSignal[];
  scopes: EvidenceScope[];
  section: string;
  alternatives: string[];
}

function build(value: string, label: Label, origin: Unit["origin"]): Unit {
  const categories = qualityCategoriesFor(value);
  const tokenCount = value.replace(/,/g, " ").split(/\s+/).filter((t) => t.length > 0).length;
  const profile = interpretCandidate({
    candidateId: `u:${value}`,
    displayValue: value,
    detectedType: "person",
    qualityCategories: categories,
    positiveReasons: [],
    relationshipKinds: [],
    contextualRules: [],
    hasPersonEvidencedLinkage: false,
    reference: referenceEvidenceFor(value),
    documentAttestedTokens,
  } satisfies InterpretationFacts);
  const person = profile.interpretations.find((i) => i.id === "person");
  const personSignals = person?.signals ?? [];
  const section = typeCheckSectionFor(
    { detectedType: "person", categories, relationshipKinds: new Set<RelationshipKind>() }, false
  ).section;
  return {
    value, label, origin, tokenCount, categories, profile, personSignals,
    scopes: [...new Set(personSignals.map((s) => scopeOf(s, tokenCount)))],
    section,
    alternatives: interpretationIdsOf(profile).filter((id) => id !== "person"),
  };
}

const UNITS: Unit[] = [
  ...PRODUCTION_WITNESSES.map(([v, l]) => build(v, l, "production-witness")),
  ...LIVE_RESIDUE.map((u) => build(u.value, u.truth as Label, "live-residue")),
];
const PERSON_UNITS = UNITS.filter((u) => u.personSignals.length > 0);

console.log("=== PERSON-STREAM ADJUDICATION (investigation) ===");
console.log(`    ${UNITS.length} candidates (${PRODUCTION_WITNESSES.length} named production witnesses + ${LIVE_RESIDUE.length} residue units)`);
console.log(`    ${PERSON_UNITS.length} carry a Person reading.`);
console.log("    occurrence-context and document-consistency are ACTIVE IN PRODUCTION and ABSENT here.");

/* ═══════════════════ 1. evidence scope ═══════════════════ */

console.log("\n--- 1. WHAT IS EACH PERSON SIGNAL A CLAIM ABOUT? ---");
{
  const bySignal = new Map<string, { units: number; scope: EvidenceScope; people: number; nonPeople: number; boundary: number }>();
  for (const u of PERSON_UNITS) {
    for (const s of u.personSignals) {
      const key = s.signalId.replace(/:.*$/, ":*");
      const row = bySignal.get(key) ?? { units: 0, scope: scopeOf(s, u.tokenCount), people: 0, nonPeople: 0, boundary: 0 };
      row.units += 1;
      if (u.label === "person") row.people += 1;
      if (u.label === "non-person") row.nonPeople += 1;
      if (u.label === "boundary") row.boundary += 1;
      bySignal.set(key, row);
    }
  }
  console.table([...bySignal.entries()].sort((a, b) => b[1].units - a[1].units).map(([signalId, r]) => ({
    signalId, scope: r.scope, units: r.units, people: r.people, nonPeople: r.nonPeople, boundary: r.boundary,
    "person rate": r.people + r.nonPeople ? `${((r.people / (r.people + r.nonPeople)) * 100).toFixed(0)}%` : "-",
  })));
}

/* ═══════════════════ 2. scope shape of the Person reading ═══════════════════ */

console.log("\n--- 2. PERSON READINGS BY EVIDENCE SCOPE ---");
console.log("    The load-bearing table. A Person reading resting ONLY on component-level");
console.log("    evidence has never been told anything about the candidate SPAN.");
{
  const byScope = new Map<string, Unit[]>();
  for (const u of PERSON_UNITS) {
    const key = [...u.scopes].sort().join(" + ");
    const bucket = byScope.get(key) ?? [];
    bucket.push(u);
    byScope.set(key, bucket);
  }
  console.table([...byScope.entries()].sort((a, b) => b[1].length - a[1].length).map(([scope, group]) => ({
    "evidence scope": scope,
    units: group.length,
    people: group.filter((g) => g.label === "person").length,
    nonPeople: group.filter((g) => g.label === "non-person").length,
    boundary: group.filter((g) => g.label === "boundary").length,
    examples: group.slice(0, 5).map((g) => g.value).join(", "),
  })));
}

/* ═══════════════════ 3. multi-token vs single-token ═══════════════════ */

console.log("\n--- 3. THE SPAN QUESTION ONLY EXISTS FOR MULTI-TOKEN CANDIDATES ---");
{
  const multi = PERSON_UNITS.filter((u) => u.tokenCount > 1);
  const single = PERSON_UNITS.filter((u) => u.tokenCount === 1);
  const componentOnly = (u: Unit): boolean => u.scopes.length > 0 && u.scopes.every((s) => s === "component");
  console.table([
    {
      population: "multi-token, component-level evidence ONLY",
      units: multi.filter(componentOnly).length,
      people: multi.filter((u) => componentOnly(u) && u.label === "person").length,
      nonPeople: multi.filter((u) => componentOnly(u) && u.label === "non-person").length,
      boundary: multi.filter((u) => componentOnly(u) && u.label === "boundary").length,
    },
    {
      population: "multi-token, has candidate-span evidence",
      units: multi.filter((u) => u.scopes.includes("candidate-span")).length,
      people: multi.filter((u) => u.scopes.includes("candidate-span") && u.label === "person").length,
      nonPeople: multi.filter((u) => u.scopes.includes("candidate-span") && u.label === "non-person").length,
      boundary: multi.filter((u) => u.scopes.includes("candidate-span") && u.label === "boundary").length,
    },
    {
      population: "single-token (scope distinction collapses)",
      units: single.length,
      people: single.filter((u) => u.label === "person").length,
      nonPeople: single.filter((u) => u.label === "non-person").length,
      boundary: single.filter((u) => u.label === "boundary").length,
    },
  ]);

  console.log("\n    Multi-token, component-level evidence only:");
  for (const u of multi.filter(componentOnly)) {
    console.log(`      "${u.value}" (${u.label}) signals=[${u.personSignals.map((s) => s.signalId).join(", ")}] alt=[${u.alternatives.join(", ") || "none"}]`);
  }
}

/* ═══════════════════ 4. proposed rules, stated before measurement ═══════════════════ */

interface PersonRule {
  id: string;
  claim: string;
  /** True when the rule REJECTS the Person reading for this candidate. */
  rejectsPerson: (u: Unit) => boolean;
}

const RULES: PersonRule[] = [
  {
    id: "P-1/span-evidence-required",
    claim: "For a MULTI-TOKEN candidate, a Person reading supported only by component-level evidence is not affirmative Person evidence about the candidate. Person does not survive.",
    rejectsPerson: (u) => u.tokenCount > 1 && u.scopes.length > 0 && u.scopes.every((s) => s === "component"),
  },
  {
    id: "P-2/token-membership-alone",
    claim: "A Person reading whose ONLY signal is Census token membership is not affirmative Person evidence, at any token count.",
    rejectsPerson: (u) => u.personSignals.length > 0 && u.personSignals.every((s) => s.signalId === "person/census-token-membership"),
  },
  {
    id: "P-3/ordinary-language-demotes",
    claim: "A Person reading competing with affirmative ordinary-language evidence does not survive.",
    rejectsPerson: (u) => u.personSignals.length > 0 && u.alternatives.includes("ordinary-language"),
  },
  {
    id: "P-4/place-demotes",
    claim: "A Person reading competing with GNIS place attestation does not survive.",
    rejectsPerson: (u) => u.personSignals.length > 0 && u.alternatives.includes("place"),
  },
  {
    /* The narrowest form of P-1/P-2: the intersection. Stated separately
     * because P-1 and P-2 each lose real people and the question is whether
     * their overlap is the part that does not. */
    id: "P-6/multi-token-membership-only",
    claim: "For a MULTI-TOKEN candidate, a Person reading whose only signal is Census token membership -- a claim about tokens, not about the span -- is not affirmative Person evidence about the candidate.",
    rejectsPerson: (u) =>
      u.tokenCount > 1
      && u.personSignals.length > 0
      && u.personSignals.every((s) => s.signalId === "person/census-token-membership"),
  },
  {
    id: "P-5/single-witness-component",
    claim: "A Person reading resting on ONE independent witness, all of whose signals are component-level, does not survive.",
    rejectsPerson: (u) =>
      u.personSignals.length > 0
      && independentWitnessGroups(u.personSignals).length === 1
      && u.scopes.every((s) => s === "component"),
  },
];

console.log("\n--- 4. PROPOSED RULES: THE ASYMMETRIC TRADEOFF ---");
console.log("    Reported as counts, never as an accuracy score: losing a real person and");
console.log("    removing a junk candidate are not commensurable outcomes.");
console.table(RULES.map((rule) => {
  const rejected = PERSON_UNITS.filter(rule.rejectsPerson);
  const peopleLost = rejected.filter((u) => u.label === "person");
  return {
    ruleId: rule.id,
    "Person readings removed": rejected.length,
    "REAL PEOPLE LOST": peopleLost.length,
    "non-people removed": rejected.filter((u) => u.label === "non-person").length,
    "boundary cases removed": rejected.filter((u) => u.label === "boundary").length,
    "unlabelled removed": rejected.filter((u) => u.label === "?").length,
    "people lost": peopleLost.map((u) => u.value).join(", ") || "(none)",
  };
}));

console.log("\n    Rule claims, for the record:");
for (const rule of RULES) console.log(`      ${rule.id}\n        ${rule.claim}`);

/* ═══════════════════ 5. reclassification: what does the system already know? ═══════════════════ */

console.log("\n--- 5. IF PERSON IS REJECTED, WHAT ELSE IS AFFIRMATIVELY SUPPORTED? ---");
for (const rule of RULES) {
  const rejected = PERSON_UNITS.filter(rule.rejectsPerson);
  if (rejected.length === 0) continue;
  const none = rejected.filter((u) => u.alternatives.length === 0);
  const one = rejected.filter((u) => u.alternatives.length === 1);
  const many = rejected.filter((u) => u.alternatives.length > 1);
  console.log(`\n    ${rule.id}: ${rejected.length} rejected`);
  console.log(`      exactly one alternative -> reclassify:  ${one.length}  ${one.slice(0, 6).map((u) => `${u.value}->${u.alternatives[0]}`).join(", ")}`);
  console.log(`      multiple alternatives -> stays contested: ${many.length}  ${many.slice(0, 4).map((u) => u.value).join(", ")}`);
  console.log(`      NO alternative -> Undetermined:          ${none.length}  ${none.slice(0, 8).map((u) => u.value).join(", ")}`);
}

/* ═══════════════════ 6. boundary defects, kept separate ═══════════════════ */

console.log("\n--- 6. BOUNDARY / SPAN DEFECTS -- A DIFFERENT PROBLEM ---");
console.log("    These candidates have a wrong SPAN, not wrong semantics. The evidence about");
console.log("    the name token inside them is correct; the extraction is not.");
{
  const boundary = UNITS.filter((u) => u.label === "boundary");
  console.table(boundary.map((u) => ({
    value: u.value,
    section: u.section,
    "person signals": u.personSignals.map((s) => s.signalId).join(", ") || "(none)",
    scope: u.scopes.join("+") || "-",
    "categories": u.categories.slice(0, 4).join(", "),
  })));
  console.log("    A Person adjudication rule that removes these is masking an extraction defect,");
  console.log("    not fixing a semantic one. Reported separately for exactly that reason.");
}

/* ═══════════════════ 7. named witnesses ═══════════════════ */

console.log("\n--- 7. NAMED WITNESS ADJUDICATION PATHS ---");
for (const u of UNITS.filter((x) => x.origin === "production-witness")) {
  const fired = RULES.filter((r) => r.rejectsPerson(u)).map((r) => r.id);
  console.log(`\n  "${u.value}"  label=${u.label}  tokens=${u.tokenCount}  section=${u.section}`);
  console.log(`    categories: ${u.categories.join(", ") || "(none)"}`);
  if (u.personSignals.length === 0) console.log("    person: (no Person reading)");
  else {
    for (const s of u.personSignals) console.log(`    person + [${scopeOf(s, u.tokenCount)}] ${s.signalId}`);
    console.log(`    independent witnesses: ${independentWitnessGroups(u.personSignals).length}`);
  }
  console.log(`    alternatives: ${u.alternatives.join(", ") || "(none)"}`);
  console.log(`    rules rejecting Person: ${fired.join(", ") || "(none)"}`);
}

/* ═══════════════════ 8. ablation ═══════════════════ */

console.log("\n--- 8. ABLATION: INDEPENDENT CONTRIBUTION OF EACH RULE ---");
{
  const applied = new Set<string>();
  const rows: Array<Record<string, unknown>> = [];
  rows.push({
    configuration: "current behaviour (no adjudication)",
    "Person readings": PERSON_UNITS.length,
    "real people with Person": PERSON_UNITS.filter((u) => u.label === "person").length,
    "non-people with Person": PERSON_UNITS.filter((u) => u.label === "non-person").length,
  });
  for (const rule of RULES) {
    for (const u of PERSON_UNITS) if (rule.rejectsPerson(u)) applied.add(u.value);
    const surviving = PERSON_UNITS.filter((u) => !applied.has(u.value));
    rows.push({
      configuration: `+ ${rule.id}`,
      "Person readings": surviving.length,
      "real people with Person": surviving.filter((u) => u.label === "person").length,
      "non-people with Person": surviving.filter((u) => u.label === "non-person").length,
    });
  }
  console.table(rows);
  console.log("    Cumulative, in declaration order. A rule adding no row movement has not");
  console.log("    earned production complexity.");
}

/* ═══════════════════ 9. performance ═══════════════════ */

console.log("\n--- 9. COST OF ADJUDICATION (reads derived evidence only) ---");
{
  const profiles = PERSON_UNITS;
  for (let i = 0; i < 2000; i += 1) {
    const u = profiles[i % profiles.length]!;
    RULES.forEach((r) => r.rejectsPerson(u));
  }
  const iterations = 200_000;
  const t0 = performance.now();
  for (let i = 0; i < iterations; i += 1) {
    const u = profiles[i % profiles.length]!;
    RULES.forEach((r) => r.rejectsPerson(u));
  }
  const t1 = performance.now();
  const us = ((t1 - t0) * 1000) / iterations;
  console.table([{
    "µs per candidate": Number(us.toFixed(3)),
    "601-candidate document ms": Number(((us * 601) / 1000).toFixed(3)),
  }]);
}

console.log("\n=== END. No rule was tuned to any label, and none is implemented. ===");
