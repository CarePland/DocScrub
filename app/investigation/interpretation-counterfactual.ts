/**
 * interpretation-counterfactual.ts -- INVESTIGATION ONLY. 2026-08-09/10.
 *
 * NOT a verification suite (deliberately outside verify/, so the
 * `for f in verify/*.ts` runner never picks it up), NOT production, NOT
 * imported by anything. It reads production modules and changes none of
 * them.
 *
 * PURPOSE. Price the proposed DETECTION -> INTERPRETATION -> ROUTING
 * boundary against a population, by running the REAL engines
 * (scoreCandidateQuality, semanticTypeFor, deriveRecommendation,
 * triageSectionFor) and then asking what a post-detection interpreter
 * would have concluded over the same evidence.
 *
 * POPULATION HONESTY. Andrew's live document is not in this repository, so
 * this runs over the DOCUMENTED live population -- every candidate string
 * recorded in the 2026-08-09 investigation reports plus the frozen witness
 * set, with the contextual-evidence rules taken verbatim from the live
 * witness-audit console output. It is a real sample of the live set, not
 * the whole of it. Section 6 of the report says so explicitly and the
 * browser diagnostic is the instrument for exact live counts.
 */

import type { Candidate, ContentBlock, Occurrence } from "../src/domain/DocumentModel.js";
import { scoreCandidateQuality } from "../src/engines/quality/scoring.js";
import type { CandidateContextualEvidence, ContextualEvidenceRuleId } from "../src/engines/contextual-person-evidence/contextual-person-evidence.js";
import { combineContextualWeights } from "../src/engines/contextual-person-evidence/contextual-person-evidence.js";
import { qualityCategoriesOf, semanticTypeFor, type SemanticTypeId } from "../src/domain/semanticTypes.js";
import { deriveRecommendation, type RecommendationFacts } from "../src/ui/recommendations.js";
import { triageSectionFor } from "../src/ui/triageQueue.js";
import { evidenceFaithfulOpener, isShapeOnlyPersonClaim, NO_NAME_EVIDENCE_CLAUSE } from "../src/engines/explanation/explanation-builder.js";

// ===========================================================================
// 1. THE POPULATION
// ===========================================================================

type Truth = "person" | "non-person" | "unknown";

interface Spec {
  value: string;
  /** occurrence count -- drives the frequency reason, nothing else */
  occ: number;
  /** contextual person-evidence rules observed live (witness audit) */
  ctx?: ContextualEvidenceRuleId[];
  /** every occurrence sits in a header block (structural counter-signal) */
  heading?: boolean;
  truth: Truth;
  note?: string;
}

/** Frozen witness set -- Andrew's controls, evidence verbatim from the
 *  live witness-audit console output. */
const CONTROLS: Spec[] = [
  // real people
  { value: "Amy Miller", occ: 4, truth: "person" },
  { value: "Jeffrey Lam", occ: 4, truth: "person" },
  { value: "Bobbie Galaz", occ: 4, truth: "person" },
  { value: "Chelsye Angelina", occ: 4, truth: "person" },
  { value: "Perias, Nelly", occ: 4, truth: "person" },
  { value: "Yamada, Tamara", occ: 4, truth: "person" },
  { value: "Cobb, Christopher", occ: 4, truth: "person" },
  { value: "Chriztopher Johnson", occ: 4, truth: "person" },
  { value: "Diana", occ: 4, truth: "person" },
  { value: "Sarah", occ: 4, truth: "person" },
  // obvious non-people currently in People
  { value: "Academic Senate", occ: 4, ctx: ["contextual_possessive"], truth: "non-person" },
  { value: "Grade Rosters", occ: 4, truth: "non-person" },
  { value: "Financial Aid", occ: 4, truth: "non-person" },
  { value: "Message List", occ: 4, truth: "non-person" },
  { value: "Term Withdrawals", occ: 4, truth: "non-person" },
  { value: "Grade Entry", occ: 4, truth: "non-person" },
  { value: "Academic Service", occ: 4, truth: "non-person" },
  { value: "Student Final Exam", occ: 4, truth: "non-person" },
  { value: "Clearinghouse Webinar", occ: 4, truth: "non-person" },
  { value: "Timekeeper Overview", occ: 4, truth: "non-person" },
  { value: "Computer Science", occ: 4, ctx: ["contextual_coordination"], truth: "non-person" },
  { value: "External Education", occ: 4, ctx: ["contextual_direct_address", "contextual_human_subject"], truth: "non-person" },
  { value: "San Diego", occ: 4, ctx: ["contextual_human_object"], truth: "non-person" },
  { value: "Word Documents", occ: 4, ctx: ["contextual_direct_address"], truth: "non-person" },
  { value: "Residency Specialists", occ: 4, ctx: ["contextual_coordination"], truth: "non-person" },
];

/** Everything else recorded from the live run across the 2026-08-09
 *  reports. Truth labels are Andrew's own readings where he gave them. */
const DOCUMENTED_LIVE: Spec[] = [
  // people-residue-routing-rules §3 -- shape-only, score 79, R1 fires
  { value: "Transfer Credit", occ: 4, truth: "non-person" },
  { value: "Last Call", occ: 4, truth: "non-person" },
  { value: "Final Grades", occ: 4, truth: "non-person" },
  { value: "Student Success", occ: 4, truth: "non-person" },
  { value: "Campus Community", occ: 4, truth: "non-person" },
  { value: "Help Desk", occ: 4, truth: "non-person" },
  { value: "Change Request", occ: 4, truth: "non-person" },
  { value: "Business Process", occ: 4, truth: "non-person" },
  { value: "Data Warehouse", occ: 4, truth: "non-person" },
  { value: "Term Activation", occ: 4, truth: "non-person" },
  { value: "Staff Course", occ: 4, truth: "non-person" },
  { value: "Service Indicator Codes", occ: 4, truth: "non-person" },
  { value: "Preview Day", occ: 4, truth: "non-person" },
  // people-architecture-verdict §1
  { value: "Final Exams", occ: 4, truth: "non-person" },
  { value: "Degree Planner", occ: 6, truth: "non-person" },
  { value: "Start Date", occ: 6, truth: "non-person" },
  { value: "Reason Code", occ: 6, truth: "non-person" },
  { value: "Student Final Exa", occ: 4, truth: "non-person", note: "source-literal PeopleSoft label" },
  { value: "Term Withdra", occ: 4, truth: "non-person", note: "source-literal PeopleSoft label" },
  { value: "Virtual Clearinghouse Academ", occ: 4, truth: "non-person", note: "source-literal" },
  { value: "Priority Registrati", occ: 4, truth: "non-person", note: "source-literal" },
  // the honest unknowables
  { value: "Math Option", occ: 4, truth: "unknown" },
  { value: "Workflow Shift", occ: 4, truth: "unknown" },
  { value: "Systemwide Meeting", occ: 4, truth: "unknown" },
  // real people from earlier passes
  { value: "Agnes Wu", occ: 4, truth: "person" },
  { value: "Amy Nakamura", occ: 4, truth: "person" },
  { value: "Kyle Barrera", occ: 4, truth: "person" },
  { value: "Giancarlo Banuelos", occ: 4, truth: "person" },
  { value: "Christopher Cobb", occ: 4, truth: "person" },
  { value: "Nelly Perias", occ: 4, truth: "person" },
  { value: "Tamara Yamada", occ: 4, truth: "person" },
  { value: "Garcia", occ: 4, ctx: ["contextual_attribution"], truth: "person" },
  { value: "Joanne", occ: 4, ctx: ["contextual_human_object"], truth: "person" },
  // membership-contract §B -- family I: evidence present, token gate discards it
  { value: "Good Morning", occ: 4, truth: "non-person" },
  { value: "Course Catalog", occ: 4, truth: "non-person" },
  { value: "Spring Semester", occ: 4, truth: "non-person" },
  { value: "Hello All", occ: 4, truth: "non-person" },
  { value: "Thanks Andrew", occ: 4, truth: "non-person" },
  { value: "Winter Grading", occ: 4, truth: "non-person" },
  { value: "Fully Online", occ: 4, truth: "non-person" },
  { value: "Records Team", occ: 4, truth: "non-person" },
  { value: "Academic Records", occ: 4, truth: "non-person" },
  { value: "Enrollment Services Team", occ: 4, truth: "non-person" },
  { value: "Tuesday, March", occ: 4, truth: "non-person" },
  { value: "Thank You", occ: 4, truth: "non-person" },
  // residual-population-evidence-audit §2 -- contextual false firings, single token
  { value: "Here's", occ: 3, ctx: ["contextual_possessive"], truth: "non-person" },
  { value: "That's", occ: 3, ctx: ["contextual_possessive"], truth: "non-person" },
  { value: "It's", occ: 3, ctx: ["contextual_possessive"], truth: "non-person" },
  { value: "Also", occ: 3, ctx: ["contextual_direct_address"], truth: "non-person" },
  { value: "Having", occ: 3, ctx: ["contextual_attribution"], truth: "non-person" },
  { value: "Scheduling", occ: 3, ctx: ["contextual_coordination"], truth: "non-person" },
  { value: "Housing", occ: 3, ctx: ["contextual_coordination"], truth: "non-person" },
  { value: "Team", occ: 5, ctx: ["contextual_direct_address"], truth: "non-person" },
  { value: "Faculty", occ: 5, ctx: ["contextual_direct_address"], truth: "non-person" },
  { value: "ITS", occ: 4, ctx: ["contextual_human_object"], truth: "non-person" },
  { value: "PERC", occ: 4, ctx: ["contextual_human_subject"], truth: "unknown" },
  { value: "NSC", occ: 4, ctx: ["contextual_human_subject"], truth: "unknown" },
  { value: "Morning", occ: 3, truth: "non-person" },
  { value: "Thank", occ: 3, truth: "non-person" },
  { value: "Last", occ: 3, truth: "non-person" },
  { value: "The", occ: 8, truth: "non-person" },
  { value: "Grades", occ: 5, truth: "non-person" },
  // anchor-evidenced real people (the shape the interpreter must protect)
  { value: "Jordan Lee", occ: 4, ctx: ["anchor_full_name_with_role"], truth: "person" },
  { value: "Collier, Tanesha", occ: 4, truth: "person" },
  { value: "Provost", occ: 3, ctx: ["contextual_attribution"], truth: "unknown" },
];

const POPULATION: Spec[] = [...CONTROLS, ...DOCUMENTED_LIVE];

// ===========================================================================
// 2. RUN THE REAL ENGINES
// ===========================================================================

function block(id: string, kind: ContentBlock["kind"] = "body"): ContentBlock {
  return { id, kind, text: "", order: 0, sourceMapping: { partId: "word/document.xml", sourceRef: "" }, runMappings: [] };
}

function buildAssessment(spec: Spec) {
  const id = `person:${spec.value.toLowerCase()}`;
  const candidate: Candidate = {
    id,
    detectedType: "person",
    source: "regex",
    confidence: "low",
    normalizedValue: spec.value.toLowerCase(),
    displayValue: spec.value,
    occurrenceIds: [],
  };
  const kind: ContentBlock["kind"] = spec.heading ? "header" : "body";
  const blocks = new Map<string, ContentBlock>();
  const occurrences: Occurrence[] = [];
  for (let i = 0; i < spec.occ; i += 1) {
    const blockId = `block-${i}`;
    blocks.set(blockId, block(blockId, kind));
    occurrences.push({
      id: `${id}:${blockId}:0:1`,
      candidateId: id,
      blockId,
      startOffset: 0,
      endOffset: spec.value.length,
      text: spec.value,
      // neutral prose context: contextual evidence is supplied directly
      // below rather than re-derived, so the rules match the live run.
      context: `... ${spec.value} ...`,
      source: "regex",
    });
  }
  const contextual: CandidateContextualEvidence | undefined = spec.ctx?.length
    ? {
        candidateId: id,
        rules: spec.ctx,
        contribution: combineContextualWeights(spec.ctx),
        representative: { occurrenceId: occurrences[0]!.id, rules: spec.ctx, strength: combineContextualWeights(spec.ctx) },
        perOccurrence: [{ occurrenceId: occurrences[0]!.id, rules: spec.ctx, strength: combineContextualWeights(spec.ctx) }],
        occurrencesWithoutEvidence: Math.max(0, spec.occ - 1),
      }
    : undefined;
  const assessment = scoreCandidateQuality(candidate, occurrences, blocks, undefined, undefined, contextual);
  return { candidate, assessment, contextual };
}

// ===========================================================================
// 3. THE PROPOSED INTERPRETER -- investigation only
// ===========================================================================

/**
 * Reuses SemanticTypeId verbatim and adds exactly ONE member. Everything
 * else in the vocabulary already exists.
 */
type SemanticClass = SemanticTypeId | "unresolved-name-shaped";

type Support = "supported" | "corroborated" | "unsupported";

interface Interpretation {
  klass: SemanticClass;
  support: Support;
  basis: string[];
  contra: string[];
  /** Never consulted for klass; carried through for audit. */
  provenance: string;
}

const norm = (c: string): string => c.replace(/_/g, "-");

/** D. SEMANTIC INTERPRETATION -- person-positive. Each of these is a claim
 *  about MEANING, not about the string's shape. */
const PERSON_SEMANTIC_POSITIVE = new Set([
  "known-personal-name-token",
  "known-first-name",
  "known-surname",
  "known-name-structure",
  "nearby-title",
  "email-address-evidence",
  "signature-or-email-header-context",
]);

/**
 * Non-person semantic positives -- the B side, already computed.
 *
 * TWO TIERS, and the split is load-bearing rather than tidy.
 *
 * STRONG: the category names what the referent IS. "Enrollment Services" is
 * a department; that is a claim about meaning and it genuinely contradicts a
 * person reading.
 *
 * DEFEASIBLE: the category names what the STRING is -- an ordinary word, a
 * greeting, a contraction. That is a lexical fact, not a claim about the
 * referent, and it is exactly the class this codebase has repeatedly and
 * correctly refused to treat as non-person evidence ("ordinary words alone
 * should not mean non-person" -- the reason R1 removed Amy Miller). It is
 * evidence against a person reading only when nothing positive says
 * otherwise, and the pipeline already models the collision as
 * `ambiguous_lexical_token`.
 */
const NON_PERSON_STRONG = {
  organizations: ["department-organization", "organization-suffix", "institution-term", "product-system-name", "administrative-phrase", "legal-administrative-term"],
  "dates-terms": ["calendar-term", "calendar-abbreviation", "season-or-academic-term"],
  "document-titles": ["document-structure-term"],
  acronyms: ["likely-acronym", "institution-acronym"],
} as const;

const NON_PERSON_DEFEASIBLE: readonly string[] = [
  "greeting-or-courtesy",
  "interjection-casual",
  "pronoun-or-determiner",
  "sentence-fragment",
  "sentence-fragment-word",
  "common-english-word",
  "common-verb",
  "all-common-dictionary-words",
  "expanded-common-language-token",
  "contraction",
  "grammatical-phrase-shape",
  "implausible-capitalization",
  "ocr-artifact",
];

/** C. STRUCTURAL / SHAPE -- proves the string looks like a name. */
const SHAPE_ONLY = new Set(["strong-name-structure", "surname-given-structure", "initials-with-surname", "weak-name-structure", "single-name-candidate", "unknown-capitalized-token", "single-token-reviewable-without-negative-evidence"]);

/** Frequency -- no semantic force at all. */
const FREQUENCY_ONLY = new Set(["single-occurrence", "small-frequency-bonus", "moderate-frequency-bonus", "frequency-saturated"]);

interface InterpreterInput {
  displayValue: string;
  detectedType: string;
  /** classification-sourced categories ONLY (never the reasons fallback) */
  classifications: readonly string[];
  positiveReasons: readonly string[];
  contextualRules: readonly ContextualEvidenceRuleId[];
  /** every occurrence is heading-like and none is prose */
  universallyHeadingLike: boolean;
  /** entity-resolution linkage whose partner is itself person-evidenced */
  personEvidencedLinkage: boolean;
}

export function interpretCandidate(input: InterpreterInput): Interpretation {
  const uniq = (xs: readonly string[]): string[] => [...new Set(xs)];
  const cats = uniq(input.classifications.map(norm));
  const pos = uniq(input.positiveReasons.map(norm));
  const provenance = `detector:${input.detectedType}`;

  // ---- P1. Non-person semantic evidence, ONLY from classification-sourced
  // categories. The `reasons` fallback is shape and must never arrive here.
  const strongContra = uniq(cats.filter((c) => Object.values(NON_PERSON_STRONG).some((m) => (m as readonly string[]).includes(c))));
  const defeasibleContra = uniq(cats.filter((c) => NON_PERSON_DEFEASIBLE.includes(c)));

  // ---- P2. Person semantic positives.
  const personPositives = uniq([...pos, ...cats].filter((c) => PERSON_SEMANTIC_POSITIVE.has(c)));
  const anchors = input.contextualRules.filter((r) => r.startsWith("anchor_"));
  const usages = input.contextualRules.filter((r) => r.startsWith("contextual_"));
  const positiveBasis = uniq([...personPositives, ...anchors]);

  // ---- P5. Conflict between two STRONG semantic claims -> UNRESOLVED.
  // Never resolved by score magnitude.
  if (positiveBasis.length > 0 && strongContra.length > 0) {
    return { klass: "unresolved-name-shaped", support: "unsupported", basis: positiveBasis, contra: strongContra, provenance };
  }

  // ---- Supported person. A defeasible contra (the name/word collision)
  // is recorded but does not defeat positive semantic evidence.
  if (positiveBasis.length > 0) {
    return { klass: "people", support: "supported", basis: positiveBasis, contra: defeasibleContra, provenance };
  }

  // ---- P4. Contextual USAGE alone never establishes person, and never
  // suppresses a counter-signal. It qualifies only with an independent
  // corroborator.
  if (usages.length > 0) {
    if (strongContra.length > 0) {
      return { klass: nonPersonClassOf(strongContra), support: "supported", basis: strongContra, contra: [...usages], provenance };
    }
    const corroborators: string[] = [];
    if (input.personEvidencedLinkage) corroborators.push("person-evidenced-linkage");
    if (cats.includes("surname-given-structure") || pos.includes("surname-given-structure")) corroborators.push("surname-given-structure");
    if (corroborators.length > 0 && defeasibleContra.length === 0) {
      return { klass: "people", support: "corroborated", basis: [...usages, ...corroborators], contra: [], provenance };
    }
    if (defeasibleContra.length > 0) {
      return { klass: "other", support: "supported", basis: defeasibleContra, contra: [...usages], provenance };
    }
    return { klass: "unresolved-name-shaped", support: "unsupported", basis: [...usages], contra: [], provenance };
  }

  // ---- Non-person, uncontested.
  if (strongContra.length > 0) {
    return { klass: nonPersonClassOf(strongContra), support: "supported", basis: strongContra, contra: [], provenance };
  }
  if (defeasibleContra.length > 0) {
    return { klass: "other", support: "supported", basis: defeasibleContra, contra: [], provenance };
  }

  // ---- Structural counter-signal, when it is universal rather than
  // incidental. This is the ONLY B-side signal available to the residue,
  // and today the positiveReasons gate can suppress it (see §D below).
  if (input.universallyHeadingLike) {
    return { klass: "document-titles", support: "corroborated", basis: ["universally-heading-like"], contra: [], provenance };
  }

  // ---- P3/P6. Shape and frequency only -> UNRESOLVED. Never person.
  const shape = uniq([...cats, ...pos].filter((c) => SHAPE_ONLY.has(c)));
  if (shape.length > 0) {
    return { klass: "unresolved-name-shaped", support: "unsupported", basis: shape, contra: [], provenance };
  }
  const freq = uniq([...cats, ...pos].filter((c) => FREQUENCY_ONLY.has(c)));
  return { klass: freq.length ? "unresolved-name-shaped" : "other", support: "unsupported", basis: freq, contra: [], provenance };
}

function nonPersonClassOf(contra: readonly string[]): SemanticClass {
  for (const klass of ["acronyms", "organizations", "dates-terms", "document-titles"] as const) {
    const members = NON_PERSON_STRONG[klass] as readonly string[];
    if (contra.some((c) => members.includes(c))) return klass;
  }
  return "other";
}

// ===========================================================================
// 4. REPORT
// ===========================================================================

interface Row {
  value: string;
  truth: Truth;
  score: number;
  detector: string;
  classifications: string;
  positiveReasons: string;
  ctx: string;
  currentSemantic: SemanticTypeId;
  currentArchetype: string;
  currentSection: string;
  interpreted: SemanticClass;
  support: Support;
  basis: string;
}

const rows: Row[] = POPULATION.map((spec) => {
  const { candidate, assessment, contextual } = buildAssessment(spec);
  const categories = qualityCategoriesOf(assessment);
  const facts: RecommendationFacts = {
    displayValue: candidate.displayValue,
    detectedType: candidate.detectedType,
    personTokenCount: candidate.displayValue.trim().split(/[\s,]+/).filter(Boolean).length,
    categories,
    qualityRecommendation: assessment.status,
    identityOptions: [],
    relationshipKinds: new Set(),
  };
  const currentSemantic = semanticTypeFor({ detectedType: candidate.detectedType, categories, relationshipKinds: new Set() });
  const rec = deriveRecommendation(facts);
  const currentSection = triageSectionFor(rec?.archetype ?? null, candidate.detectedType);
  const interp = interpretCandidate({
    displayValue: candidate.displayValue,
    detectedType: candidate.detectedType,
    // THE KEY DIFFERENCE: classification-sourced categories only. When no
    // dictionary fired, this is EMPTY -- it does not silently become the
    // reasons blob the way qualityCategoriesOf does.
    classifications: assessment.filterRules,
    positiveReasons: assessment.positiveReasons,
    contextualRules: contextual?.rules ?? [],
    universallyHeadingLike: spec.heading ?? false,
    personEvidencedLinkage: false,
  });
  return {
    value: spec.value,
    truth: spec.truth,
    score: assessment.score,
    detector: candidate.detectedType,
    classifications: assessment.filterRules.join(",") || "-",
    positiveReasons: assessment.positiveReasons.join(",") || "-",
    ctx: (contextual?.rules ?? []).join(",") || "-",
    currentSemantic,
    currentArchetype: rec?.archetype ?? "null",
    currentSection,
    interpreted: interp.klass,
    support: interp.support,
    basis: interp.basis.join("+") || "-",
  };
});

const pad = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));

console.log("\n=== A. CURRENT ROUTING vs PROPOSED INTERPRETATION ===\n");
console.log(pad("candidate", 30) + pad("truth", 12) + pad("score", 6) + pad("cur.section", 14) + pad("interpreted", 26) + pad("support", 14) + "basis");
console.log("-".repeat(140));
for (const r of rows) {
  console.log(pad(r.value, 30) + pad(r.truth, 12) + pad(String(r.score), 6) + pad(r.currentSection, 14) + pad(r.interpreted, 26) + pad(r.support, 14) + r.basis);
}

function tally(key: (r: Row) => string): Map<string, Row[]> {
  const m = new Map<string, Row[]>();
  for (const r of rows) {
    const k = key(r);
    const l = m.get(k) ?? [];
    l.push(r);
    m.set(k, l);
  }
  return m;
}

console.log("\n=== B. SECTION COUNTS ===\n");
const cur = tally((r) => r.currentSection);
const nxt = tally((r) => r.interpreted);
console.log("CURRENT (Item Check triage):");
for (const [k, v] of [...cur].sort((a, b) => b[1].length - a[1].length)) console.log(`   ${pad(k, 26)} ${v.length}`);
console.log("\nPROPOSED (routing consumes interpretation):");
for (const [k, v] of [...nxt].sort((a, b) => b[1].length - a[1].length)) console.log(`   ${pad(k, 26)} ${v.length}`);

console.log("\n=== C. MEMBERS BY PROPOSED CLASS ===\n");
for (const [k, v] of [...nxt].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`${k} (${v.length}):`);
  console.log("   " + v.map((r) => r.value).join(" | "));
}

console.log("\n=== D. RISK TO REAL PEOPLE ===\n");
const people = rows.filter((r) => r.truth === "person");
const confidentlyNonPerson = people.filter((r) => r.interpreted !== "people" && r.interpreted !== "unresolved-name-shaped");
const unresolvedPeople = people.filter((r) => r.interpreted === "unresolved-name-shaped");
const keptPeople = people.filter((r) => r.interpreted === "people");
console.log(`real people in sample:                 ${people.length}`);
console.log(`  interpreted PEOPLE:                  ${keptPeople.length}  ${keptPeople.map((r) => r.value).join(", ")}`);
console.log(`  interpreted UNRESOLVED (acceptable): ${unresolvedPeople.length}  ${unresolvedPeople.map((r) => r.value).join(", ")}`);
console.log(`  interpreted NON-PERSON (SERIOUS):    ${confidentlyNonPerson.length}  ${confidentlyNonPerson.map((r) => r.value + " -> " + r.interpreted).join(", ")}`);

console.log("\n=== E. POLLUTION REMOVED FROM PEOPLE ===\n");
const nonPeople = rows.filter((r) => r.truth === "non-person");
const inPeopleNow = nonPeople.filter((r) => r.currentSection === "people");
const stillPeople = nonPeople.filter((r) => r.interpreted === "people");
console.log(`known non-people in sample:            ${nonPeople.length}`);
console.log(`  currently routed to People:          ${inPeopleNow.length}`);
console.log(`  still People after interpretation:   ${stillPeople.length}  ${stillPeople.map((r) => r.value).join(", ")}`);

// ===========================================================================
// 5. WHAT THE INTERPRETER COULD SEE IF THE TWO KNOWN REPRESENTATION DEFECTS
//    WERE REPAIRED. Neither is a new capability; both are already-measured.
// ===========================================================================

/** Representation defect #1: scoring.ts's LAST_FIRST_RE branch returns
 *  BEFORE the known-given-name lookup, so a last-first spelling of a name
 *  the 23-entry lexicon already holds reads as pure shape. */
const KNOWN_GIVEN = new Set(["adriana", "andrew", "christopher", "diana", "giancarlo", "gustavo", "jane", "joan", "john", "julie", "lopez", "margaret", "mary", "nelly", "osmara", "parra", "patrick", "sarah", "tamara", "tanesha", "taneshia", "vince", "vincent"]);

/** X1 (EN-scoped Faker set, 1,805 names) -- membership CARRIED FORWARD from
 *  the 2026-08-09 measurement rather than re-derived, since the dataset is
 *  not in this repository. Only the controls that measurement covered. */
const X1_EN_HITS = new Set(["amy", "jeffrey", "tamara", "christopher", "diana", "sarah", "jordan", "agnes"]);

function lexiconRescue(value: string, lex: ReadonlySet<string>): boolean {
  const toks = value.toLowerCase().split(/[\s,]+/).map((t) => t.replace(/[^\p{L}'’-]/gu, "")).filter((t) => t.length > 1);
  return toks.some((t) => lex.has(t));
}

interface Variant {
  label: string;
  rescue: (value: string) => boolean;
}
const VARIANTS: Variant[] = [
  { label: "interpretation only", rescue: () => false },
  { label: "+ repr. defect #1 (last-first reads the EXISTING 23-name lexicon)", rescue: (v) => /,/.test(v) && lexiconRescue(v, KNOWN_GIVEN) },
  { label: "+ repr. #1 + X1 (1,805-name EN list)", rescue: (v) => lexiconRescue(v, KNOWN_GIVEN) || lexiconRescue(v, X1_EN_HITS) },
];

console.log("\n=== G. SEPARABILITY UNDER EACH VARIANT ===\n");
for (const variant of VARIANTS) {
  let people = 0;
  let unresolved = 0;
  const realPeopleResolved: string[] = [];
  const realPeopleUnresolved: string[] = [];
  const nonPeopleInPeople: string[] = [];
  for (const r of rows) {
    const rescued = variant.rescue(r.value);
    const klass = rescued && r.interpreted === "unresolved-name-shaped" ? "people" : r.interpreted;
    if (klass === "people") people += 1;
    if (klass === "unresolved-name-shaped") unresolved += 1;
    if (r.truth === "person") (klass === "people" ? realPeopleResolved : realPeopleUnresolved).push(r.value);
    if (r.truth === "non-person" && klass === "people") nonPeopleInPeople.push(r.value);
  }
  console.log(`${variant.label}`);
  console.log(`   People ${String(people).padStart(3)}   Unresolved ${String(unresolved).padStart(3)}   real people IN People ${realPeopleResolved.length}/21   non-people IN People ${nonPeopleInPeople.length}`);
  console.log(`   still unresolved: ${realPeopleUnresolved.join(", ")}`);
  if (nonPeopleInPeople.length) console.log(`   FALSE INCLUSIONS: ${nonPeopleInPeople.join(", ")}`);
  console.log("");
}

console.log("\n=== D2. THE POSITIVE-REASONS GATE: weak contextual evidence ERASES a structural counter-signal ===\n");
console.log("scoring.ts:961  if (isHeadingLike(...) && positiveReasons.length === 0)\n");
for (const ctx of [undefined, ["contextual_possessive"] as ContextualEvidenceRuleId[]]) {
  const spec: Spec = { value: "Academic Senate", occ: 4, heading: true, ctx, truth: "non-person" };
  const { assessment } = buildAssessment(spec);
  console.log(
    `   contextual=${ctx ? ctx.join(",") : "none"}`.padEnd(44) +
      `score=${String(assessment.score).padEnd(4)} reasons=${assessment.reasons.join(",")}`
  );
}
console.log("\n   Every occurrence is in a header block in BOTH runs. One weak, demonstrably");
console.log("   false possessive firing removes `heading_context` from the record entirely.");

console.log("\n=== F. THE FROZEN WITNESS SET, ITEM BY ITEM ===\n");
console.log(pad("candidate", 26) + pad("provenance", 12) + pad("evidence", 44) + pad("interpretation", 26) + "destination");
console.log("-".repeat(140));
for (const spec of CONTROLS) {
  const r = rows.find((x) => x.value === spec.value)!;
  const ev = [r.positiveReasons !== "-" ? r.positiveReasons : "", r.ctx !== "-" ? "ctx:" + r.ctx : ""].filter(Boolean).join(" ");
  const dest = r.interpreted === "people" ? "People" : r.interpreted === "unresolved-name-shaped" ? "Possible names — unconfirmed" : r.interpreted;
  console.log(pad(spec.value, 26) + pad("person-re", 12) + pad(ev || "-", 44) + pad(r.interpreted + "/" + r.support, 26) + dest);
}

console.log("\n=== H. CALIBRATION AGAINST THE LIVE RUN ===\n");
const inPeople = rows.filter((r) => r.currentSection === "people");
const c1 = inPeople.filter((r) => r.currentSemantic === "people");
console.log(`sample: current People ${inPeople.length}  ->  C1 (semanticTypeFor) ${c1.length}  ->  interpreted People ${inPeople.filter((r) => r.interpreted === "people").length}`);
console.log(`live  : current People (reported) ~269  ->  C1 139  ->  C3 2`);
console.log(`sample C1 retention ${(100 * c1.length / inPeople.length).toFixed(0)}%   live C1 retention ${(100 * 139 / 269).toFixed(0)}%`);
console.log(`\nthe sample is ENRICHED for the C1 residue (it was assembled from residue reports),`);
console.log(`so treat the ratios above as an upper bound on Unresolved and read section 6 of the report.`);

console.log("\n=== I. WHAT THE UI SAYS TODAY (post-deviation-#7) ===\n");
console.log(pad("candidate", 26) + pad("score", 6) + "sentence the reviewer reads");
console.log("-".repeat(120));
for (const spec of CONTROLS) {
  const { assessment } = buildAssessment(spec);
  const opener = evidenceFaithfulOpener(assessment.score, "person", assessment.positiveReasons);
  const tail = isShapeOnlyPersonClaim("person", assessment.positiveReasons) ? " " + NO_NAME_EVIDENCE_CLAUSE : "";
  console.log(pad(spec.value, 26) + pad(String(assessment.score), 6) + opener + "." + tail);
}
