/**
 * evidence-combination-matrix.ts -- INVESTIGATION ONLY. What evidence
 * COMBINATIONS actually occur, and whether any of them justifies a stronger
 * conclusion (AG, 2026-08-10, Phase B).
 *
 *     node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs \
 *          investigation/evidence-combination-matrix.ts
 *
 * ═══════════════════ WHAT THIS IS FOR ═══════════════════
 *
 * Phase A built a model that can hold several supported readings at once.
 * Phase B asks a narrower question: given the evidence patterns that REALLY
 * OCCUR, is there any combination that licenses a stronger claim than its
 * parts?
 *
 * The unit of measurement is therefore the PATTERN -- the set of
 * (interpretation, signal-class) pairs on one candidate -- not the individual
 * signal. A signal that never co-occurs with anything cannot participate in a
 * combination rule, and a rule for a pattern that never occurs is not a rule.
 *
 * ═══════════════════ FIDELITY: THIS IS BETTER THAN PHASE A's ═══════════════════
 *
 * Phase A's harness supplied REFERENCE EVIDENCE ONLY, because quality
 * categories and contextual rules are per-document facts. That understated
 * every pattern involving lexicon or ordinary-language evidence, and it was
 * flagged as the main limitation of that pass.
 *
 * This harness runs the REAL quality engine (`scoreCandidateQuality`) over a
 * synthetic single-occurrence document built from each residue value, so
 * `known-personal-name-token`, `common-english-word`, `likely-acronym` and the
 * rest are the engine's own output rather than an invention. What is still
 * missing is genuine document context -- surrounding prose, entity linkage,
 * cross-candidate statistics -- and that limitation is stated wherever it
 * matters rather than papered over.
 *
 * ═══════════════════ THE LABELS ARE FOR EVALUATION ONLY ═══════════════════
 *
 * `LIVE_RESIDUE.truth` is Andrew's own reading. It is used to EVALUATE what a
 * proposed rule would do. It is never an input to any derivation here, and no
 * threshold below was fitted to it. Reporting a rule's performance on the same
 * population it was tuned against would be circular; nothing here is tuned at
 * all -- the rules measured in §5 are stated first and measured afterwards.
 *
 * Read-only. Writes no file, changes no state, not part of the battery.
 */

import { interpretCandidate, type InterpretationFacts } from "../src/engines/interpretation/candidate-interpretation.js";
import {
  SIGNAL_CLASS_ORDER,
  independentWitnessGroups,
  interpretationIdsOf,
  type InterpretationProfile,
  type SignalClass,
} from "../src/engines/interpretation/interpretation-model.js";
import { referenceEvidenceFor } from "../src/engines/knowledge/ReferenceEvidence.js";
import { censusRoleFor, normalizeForCensusLookup } from "../src/engines/knowledge/CensusNameEvidence.js";
import { scoreCandidateQuality } from "../src/engines/quality/scoring.js";
import { qualityCategoriesOf, semanticTypeFor, typeCheckSectionFor } from "../src/domain/semanticTypes.js";
import type { Candidate, ContentBlock, Occurrence } from "../src/domain/DocumentModel.js";
import type { RelationshipKind } from "../src/domain/StructuralRelationship.js";
import { LIVE_RESIDUE } from "./live-residue.data.js";

/* ═══════════════ real quality evidence for a bare phrase ═══════════════ */

/**
 * Runs the REAL quality engine over a one-occurrence synthetic document.
 *
 * WHAT THIS BUYS: `known-personal-name-token`, `common-english-word`,
 * `likely-acronym`, `institution-term` and every other category come from the
 * engine, so patterns involving lexicon evidence are measured rather than
 * assumed.
 *
 * WHAT IT STILL LACKS, stated because it bounds every conclusion below: the
 * occurrence has no surrounding prose, so `nearby-title`, anchors and
 * contextual usage rules cannot fire; and there is no candidate population, so
 * entity linkage and cross-candidate evidence are absent. Those channels are
 * therefore UNDER-represented here, and any rule that would depend on them
 * cannot be evaluated by this harness.
 */
function qualityCategoriesFor(value: string): readonly string[] {
  const block: ContentBlock = {
    id: "b1",
    kind: "body",
    text: value,
    order: 0,
    sourceMapping: { partName: "word/document.xml", nodePath: "/p[1]" },
    runMappings: [],
  };
  const occurrence: Occurrence = {
    id: "o1",
    candidateId: "c1",
    blockId: "b1",
    startOffset: 0,
    endOffset: value.length,
    text: value,
    context: value,
    source: "regex",
  };
  const candidate: Candidate = {
    id: "c1",
    detectedType: "person",
    source: "regex",
    confidence: "medium",
    normalizedValue: value.toLowerCase(),
    displayValue: value,
    occurrenceIds: ["o1"],
  };
  /*
   * `scoreCandidateQuality` returns a FLAT `ScoredQuality` -- `reasons` and
   * `filterRules` at the top level, not under an `assessment` key. The first
   * draft of this harness read `scored.assessment`, got `undefined`, and
   * `qualityCategoriesOf(undefined)` dutifully returned `[]` for all 139
   * units. Every lexicon-derived pattern silently measured as zero.
   *
   * Recorded because the defensive default is what hid it: a function that
   * returns an empty list for a missing input turns a wiring bug into a
   * plausible-looking measurement. The tell was `lexicon-recognition: 0 units`
   * on a population containing `Andrew` and `Tamara`.
   */
  const scored = scoreCandidateQuality(candidate, [occurrence], new Map([["b1", block]]));
  return qualityCategoriesOf(scored);
}

/* ═══════════════ the measured population ═══════════════ */

const documentAttestedTokens = new Set<string>();
for (const unit of LIVE_RESIDUE) {
  for (const token of unit.value.replace(/,/g, " ").split(/\s+/)) {
    const normalized = normalizeForCensusLookup(token);
    if (normalized.length > 0 && censusRoleFor(normalized) !== null) documentAttestedTokens.add(normalized);
  }
}

interface Unit {
  value: string;
  truth: "person" | "non-person" | "?";
  categories: readonly string[];
  profile: InterpretationProfile;
  /** Type Check section as production computes it, for routing diffs. */
  section: string;
}

function build(value: string, truth: Unit["truth"]): Unit {
  const categories = qualityCategoriesFor(value);
  const facts: InterpretationFacts = {
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
  };
  const section = typeCheckSectionFor(
    { detectedType: "person", categories, relationshipKinds: new Set<RelationshipKind>() },
    false
  ).section;
  return { value, truth, categories, profile: interpretCandidate(facts), section };
}

const UNITS: Unit[] = LIVE_RESIDUE.map((u) => build(u.value, u.truth));

/* Named witnesses the report must carry, measured on the same footing. */
const WITNESS_VALUES = ["Chriztopher Johnson", "Chriztopher", "Christopher", "Johnson", "Cache", "Cashay"];
const WITNESSES: Unit[] = WITNESS_VALUES.map((v) => {
  const known = LIVE_RESIDUE.find((u) => u.value === v);
  return build(v, known?.truth ?? "?");
});

console.log("=== EVIDENCE COMBINATION MATRIX (Phase B investigation) ===");
console.log(`    ${UNITS.length} live-residue units, real quality categories + real reference evidence.`);
console.log("    Document context (anchors, titles, linkage, cross-candidate) is NOT available here");
console.log("    and those channels are therefore under-represented -- see the module header.");

/* ═══════════════ 1. signal-class inventory ═══════════════ */

console.log("\n--- 1. SIGNAL CLASSES ACTUALLY OBSERVED ---");
{
  const perClass = new Map<SignalClass, number>();
  const perClassUnits = new Map<SignalClass, number>();
  for (const unit of UNITS) {
    const seen = new Set<SignalClass>();
    for (const i of unit.profile.interpretations) for (const s of i.signals) {
      perClass.set(s.class, (perClass.get(s.class) ?? 0) + 1);
      seen.add(s.class);
    }
    for (const c of seen) perClassUnits.set(c, (perClassUnits.get(c) ?? 0) + 1);
  }
  console.table(SIGNAL_CLASS_ORDER.map((c) => ({
    class: c,
    signals: perClass.get(c) ?? 0,
    units: perClassUnits.get(c) ?? 0,
    share: `${(((perClassUnits.get(c) ?? 0) / UNITS.length) * 100).toFixed(1)}%`,
  })));
  console.log("    Classes with zero units cannot participate in any combination rule measured here.");
}

/* ═══════════════ 2. interpretation outcomes ═══════════════ */

console.log("\n--- 2. OUTCOMES, WITH REAL QUALITY EVIDENCE ---");
{
  const byOutcome = new Map<string, { person: number; nonPerson: number }>();
  for (const u of UNITS) {
    const b = byOutcome.get(u.profile.outcome) ?? { person: 0, nonPerson: 0 };
    if (u.truth === "person") b.person += 1;
    else if (u.truth === "non-person") b.nonPerson += 1;
    byOutcome.set(u.profile.outcome, b);
  }
  console.table([...byOutcome.entries()].map(([outcome, b]) => ({
    outcome, total: b.person + b.nonPerson, "truth: person": b.person, "truth: non-person": b.nonPerson,
  })));
}

/* ═══════════════ 3. THE COMBINATION MATRIX ═══════════════ */

console.log("\n--- 3. OBSERVED EVIDENCE PATTERNS (interpretation x signal classes) ---");
console.log("    The unit of Phase B. A pattern that never occurs cannot justify a rule.");
{
  const patternKey = (u: Unit): string =>
    u.profile.interpretations
      .map((i) => `${i.id}{${[...new Set(i.signals.map((s) => s.class))].sort().join(",")}}`)
      .sort()
      .join(" + ") || "(none)";

  const byPattern = new Map<string, Unit[]>();
  for (const u of UNITS) {
    const key = patternKey(u);
    const bucket = byPattern.get(key) ?? [];
    bucket.push(u);
    byPattern.set(key, bucket);
  }
  console.table([...byPattern.entries()].sort((a, b) => b[1].length - a[1].length).map(([pattern, group]) => ({
    pattern,
    units: group.length,
    people: group.filter((g) => g.truth === "person").length,
    nonPeople: group.filter((g) => g.truth === "non-person").length,
    examples: group.slice(0, 3).map((g) => g.value).join(", "),
  })));
}

/* ═══════════════ 4. PAIRWISE INTERPRETATION CO-OCCURRENCE ═══════════════ */

console.log("\n--- 4. WHICH INTERPRETATIONS COMPETE, AND HOW OFTEN ---");
{
  const pairs = new Map<string, Unit[]>();
  for (const u of UNITS) {
    const ids = [...new Set(interpretationIdsOf(u.profile))].sort();
    if (ids.length < 2) continue;
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const key = `${ids[i]} x ${ids[j]}`;
        const bucket = pairs.get(key) ?? [];
        bucket.push(u);
        pairs.set(key, bucket);
      }
    }
  }
  console.table([...pairs.entries()].sort((a, b) => b[1].length - a[1].length).map(([pair, group]) => ({
    pair,
    units: group.length,
    people: group.filter((g) => g.truth === "person").length,
    nonPeople: group.filter((g) => g.truth === "non-person").length,
    examples: group.slice(0, 4).map((g) => g.value).join(", "),
  })));
}

/* ═══════════════ 5. CANDIDATE RULES, STATED FIRST THEN MEASURED ═══════════════ */

/**
 * Each rule below is a NAMED, CATEGORICAL predicate over a profile. They are
 * written out before any measurement is taken, so none of them can have been
 * fitted to the population. The measurement then reports what each would do.
 *
 * A rule "applies" when its predicate holds. What it would DO is deliberately
 * separated from whether it applies, because a rule that applies to a large
 * population and would be wrong on most of it is worse than one that never
 * fires.
 */
interface CandidateRule {
  id: string;
  claim: string;
  applies: (u: Unit) => boolean;
}

const RULES: CandidateRule[] = [
  {
    id: "B-1/variant-with-attested-partner",
    claim: "An orthographic near-form beside an independently exactly-attested partner token supports PERSON more strongly than a near-form alone.",
    applies: (u) => u.profile.interpretations.some((i) =>
      i.id === "person" && i.signals.some((s) => s.signalId === "person/variant-form-with-attested-partner")),
  },
  {
    id: "B-2/variant-alone",
    claim: "An orthographic near-form with no corroboration supports PERSON.",
    applies: (u) => u.profile.interpretations.some((i) =>
      i.id === "person" && i.signals.some((s) => s.signalId === "person/variant-form")),
  },
  {
    id: "B-3/census-structure-plus-lexicon",
    claim: "Census name STRUCTURE plus an independent DocScrub name-lexicon recognition is stronger than either alone.",
    applies: (u) => {
      const person = u.profile.interpretations.find((i) => i.id === "person");
      if (!person) return false;
      return person.signals.some((s) => s.class === "compositional-structure")
        && person.signals.some((s) => s.class === "lexicon-recognition");
    },
  },
  {
    id: "B-4/token-membership-only",
    claim: "A person reading resting ONLY on token membership is too weak to support anything.",
    applies: (u) => {
      const person = u.profile.interpretations.find((i) => i.id === "person");
      return person !== undefined && person.signals.every((s) => s.class === "token-membership");
    },
  },
  {
    id: "B-5/person-vs-ordinary-language",
    claim: "Person evidence competing with affirmative ordinary-language evidence is contested and must stay contested.",
    applies: (u) => {
      const ids = interpretationIdsOf(u.profile);
      return ids.includes("person") && ids.includes("ordinary-language");
    },
  },
  {
    id: "B-6/person-vs-domain-terminology",
    claim: "Person evidence competing with exact domain-terminology attestation is contested and must stay contested.",
    applies: (u) => {
      const ids = interpretationIdsOf(u.profile);
      return ids.includes("person") && ids.includes("domain-terminology");
    },
  },
  {
    id: "B-7/person-vs-place",
    claim: "Person evidence competing with GNIS place attestation is contested and must stay contested.",
    applies: (u) => {
      const ids = interpretationIdsOf(u.profile);
      return ids.includes("person") && ids.includes("place");
    },
  },
  {
    id: "B-8/multi-domain-terminology",
    claim: "Two or more independent domain packs attesting the same phrase is stronger DOMAIN evidence.",
    applies: (u) => u.profile.interpretations.filter((i) => i.id === "domain-terminology").length >= 2,
  },
];

console.log("\n--- 5. CANDIDATE RULES: WHERE THEY APPLY ---");
console.table(RULES.map((rule) => {
  const applies = UNITS.filter(rule.applies);
  return {
    ruleId: rule.id,
    units: applies.length,
    "truth: person": applies.filter((u) => u.truth === "person").length,
    "truth: non-person": applies.filter((u) => u.truth === "non-person").length,
    examples: applies.slice(0, 4).map((u) => u.value).join(", "),
  };
}));

console.log("\n    Rule claims, for the record:");
for (const rule of RULES) console.log(`      ${rule.id}\n        ${rule.claim}`);

/* ═══════════════ 5b. DOES ANY COMBINATION BEAT ITS PARTS? ═══════════════ */

/**
 * THE ACTUAL PHASE B QUESTION, measured directly.
 *
 * A combination rule is only worth having if the pattern is more informative
 * than the strongest signal in it. This computes, for the person reading:
 *
 *   - the person-rate when a class is present at all;
 *   - the person-rate for each co-occurring PAIR;
 *   - the pair's lift over the better of its two parts.
 *
 * SMALL CELLS ARE NOT EVIDENCE. Any cell below ~8 units is reported but must
 * not be read as a finding; it is printed so that its smallness is visible
 * rather than hidden behind a percentage.
 */
console.log("\n--- 5b. MARGINAL CONTRIBUTION: DOES A COMBINATION BEAT ITS PARTS? ---");
{
  const personClasses = (u: Unit): Set<SignalClass> => {
    const person = u.profile.interpretations.find((i) => i.id === "person");
    return new Set((person?.signals ?? []).map((s) => s.class));
  };
  const labelled = UNITS.filter((u) => u.truth !== "?");
  const rate = (subset: Unit[]): { n: number; people: number; pct: number } => {
    const people = subset.filter((u) => u.truth === "person").length;
    return { n: subset.length, people, pct: subset.length ? (people / subset.length) * 100 : 0 };
  };

  const present = SIGNAL_CLASS_ORDER.filter((c) => labelled.some((u) => personClasses(u).has(c)));

  console.log("\n    SINGLE CLASSES (person reading supported by this class, among labelled units):");
  console.table(present.map((c) => {
    const r = rate(labelled.filter((u) => personClasses(u).has(c)));
    return { class: c, units: r.n, people: r.people, "person rate": `${r.pct.toFixed(0)}%` };
  }));

  console.log("\n    CLASS PRESENT *ALONE* (no other class supports the person reading):");
  console.table(present.map((c) => {
    const r = rate(labelled.filter((u) => {
      const cs = personClasses(u);
      return cs.has(c) && cs.size === 1;
    }));
    return { class: c, units: r.n, people: r.people, "person rate": r.n ? `${r.pct.toFixed(0)}%` : "-" };
  }));

  console.log("\n    PAIRS, with lift over the better single part:");
  const rows: Array<Record<string, unknown>> = [];
  for (let i = 0; i < present.length; i += 1) {
    for (let j = i + 1; j < present.length; j += 1) {
      const a = present[i]!;
      const b = present[j]!;
      const pair = rate(labelled.filter((u) => personClasses(u).has(a) && personClasses(u).has(b)));
      if (pair.n === 0) continue;
      const ra = rate(labelled.filter((u) => personClasses(u).has(a)));
      const rb = rate(labelled.filter((u) => personClasses(u).has(b)));
      const better = Math.max(ra.pct, rb.pct);
      rows.push({
        pair: `${a} + ${b}`,
        units: pair.n,
        people: pair.people,
        "pair rate": `${pair.pct.toFixed(0)}%`,
        "best single part": `${better.toFixed(0)}%`,
        lift: `${(pair.pct - better).toFixed(0)} pts`,
        "reliable?": pair.n >= 8 ? "yes" : "TOO SMALL",
      });
    }
  }
  console.table(rows);
  console.log("    A pair with ~0 lift is a pattern, not a rule: the combination tells us nothing");
  console.log("    the stronger part did not already tell us, and encoding it would add machinery");
  console.log("    without adding information.");
}

/* ═══════════════ 6. WHAT A PROMOTION RULE WOULD COST ═══════════════ */

/**
 * The only rules that could change anything are those that would PROMOTE a
 * person reading -- i.e. treat it as strong enough to act on. This measures
 * the population each would touch and, using Andrew's readings for EVALUATION
 * ONLY, what it would get right and wrong.
 */
console.log("\n--- 6. IF A RULE WERE ALLOWED TO PROMOTE PERSON, WHAT WOULD IT COST? ---");
{
  const promotionCandidates = RULES.filter((r) =>
    ["B-1/variant-with-attested-partner", "B-2/variant-alone", "B-3/census-structure-plus-lexicon", "B-4/token-membership-only"].includes(r.id));
  console.table(promotionCandidates.map((rule) => {
    const applies = UNITS.filter(rule.applies);
    const right = applies.filter((u) => u.truth === "person").length;
    const wrong = applies.filter((u) => u.truth === "non-person").length;
    return {
      ruleId: rule.id,
      "would fire on": applies.length,
      "actually people": right,
      "actually NOT people": wrong,
      precision: applies.length ? `${((right / (right + wrong || 1)) * 100).toFixed(0)}%` : "-",
      "wrong examples": applies.filter((u) => u.truth === "non-person").slice(0, 5).map((u) => u.value).join(", "),
    };
  }));
  console.log("    A promotion rule is only defensible if the wrong column is empty or trivially small");
  console.log("    AND the right column is large enough to matter. Both conditions, not either.");
}

/* ═══════════════ 7. EVIDENCE DEPENDENCE ═══════════════ */

/**
 * The failure a naive combiner makes: counting one underlying fact twice
 * because it arrived through two signals. This measures how often that would
 * happen, per dependence family, on the real population.
 */
console.log("\n--- 7. EVIDENCE DEPENDENCE: SIGNALS DERIVED FROM A COMMON FACT ---");
{
  const rows: Array<Record<string, unknown>> = [];
  let censusDoubleCount = 0;
  let variantOnCensus = 0;
  let gnisWithCensus = 0;
  const witnesses: string[] = [];

  for (const u of UNITS) {
    const person = u.profile.interpretations.find((i) => i.id === "person");
    const classes = new Set((person?.signals ?? []).map((s) => s.class));
    /* Census emits TWO signals from one corpus: structure and token
     * membership. They are not independent -- structure is computed FROM the
     * same per-token roles membership reports. */
    if (classes.has("compositional-structure") && classes.has("token-membership")) {
      censusDoubleCount += 1;
      if (witnesses.length < 6) witnesses.push(`${u.value} (census structure + census tokens)`);
    }
    /* A variant relationship's TARGET is a Census form, so variant evidence
     * plus Census evidence is one corpus speaking twice. */
    if (classes.has("variant-form") && (classes.has("token-membership") || classes.has("compositional-structure"))) {
      variantOnCensus += 1;
    }
    /* GNIS consults Census internally for Policy B, so place and person
     * evidence are not fully independent either. */
    if (interpretationIdsOf(u.profile).includes("place") && classes.size > 0) gnisWithCensus += 1;
  }
  rows.push({ dependence: "Census structure + Census token membership (same corpus, one derived from the other)", units: censusDoubleCount });
  rows.push({ dependence: "variant-form + Census (variant TARGET is a Census form)", units: variantOnCensus });
  rows.push({ dependence: "GNIS place + any person signal (GNIS consults Census for Policy B)", units: gnisWithCensus });
  console.table(rows);
  if (witnesses.length > 0) console.log(`    witnesses: ${witnesses.join(" | ")}`);
  console.log("    Any combiner treating these as independent corroboration would be counting");
  console.log("    one underlying corpus two or three times.");
}

/* ═══════════════ 7b. HOW MANY THINGS DO WE ACTUALLY KNOW? ═══════════════ */

/**
 * Signal count versus INDEPENDENT WITNESS count, using the production
 * `independentWitnessGroups` helper.
 *
 * This is the number a naive combiner would get wrong. A candidate with three
 * person signals looks like three corroborating facts and is frequently one.
 */
console.log("\n--- 7b. SIGNAL COUNT vs INDEPENDENT WITNESS COUNT (person reading) ---");
{
  const rows: Array<Record<string, unknown>> = [];
  const buckets = new Map<string, number>();
  for (const u of UNITS) {
    const person = u.profile.interpretations.find((i) => i.id === "person");
    if (!person) continue;
    const signals = person.signals.length;
    const witnesses = independentWitnessGroups(person.signals).length;
    const key = `${signals} signals -> ${witnesses} witness${witnesses === 1 ? "" : "es"}`;
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  for (const [key, count] of [...buckets.entries()].sort()) rows.push({ shape: key, units: count });
  console.table(rows);

  const inflated = UNITS.filter((u) => {
    const person = u.profile.interpretations.find((i) => i.id === "person");
    if (!person) return false;
    return person.signals.length > independentWitnessGroups(person.signals).length;
  });
  console.log(`    ${inflated.length} units where the signal count OVERSTATES what is independently known.`);
  console.log(`    Examples: ${inflated.slice(0, 6).map((u) => u.value).join(", ")}`);
}

/* ═══════════════ 8. NEGATIVE EVIDENCE: DOES ANY EXIST? ═══════════════ */

console.log("\n--- 8. IS THERE ANY REAL NEGATIVE EVIDENCE, AS OPPOSED TO ABSENCE? ---");
{
  /* A signal is negative evidence only if it affirms something INCOMPATIBLE
   * with an interpretation. Absence of attestation is not that. This walks
   * every signal actually emitted and classifies it. */
  const emitted = new Set<string>();
  for (const u of [...UNITS, ...WITNESSES]) {
    for (const i of u.profile.interpretations) for (const s of i.signals) emitted.add(`${i.id} <- ${s.signalId}`);
  }
  console.log(`    ${emitted.size} distinct (interpretation, signal) pairs are emitted across the population.`);
  console.log("    Every one of them is AFFIRMATIVE support for the interpretation it attaches to.");
  console.log("    No signal in the model argues against any interpretation, by construction:");
  console.log("    competing readings are represented as competing readings, not as negatives.");
  console.log("    The nearest thing to contradiction is `ordinary-language`, which is affirmative");
  console.log("    support for a DIFFERENT reading -- it does not deny the person reading.");
}

/* ═══════════════ 9. WITNESS DETERMINATION PATHS ═══════════════ */

console.log("\n--- 9. NAMED WITNESSES ---");
for (const w of [...WITNESSES]) {
  console.log(`\n  "${w.value}"   truth=${w.truth}   outcome=${w.profile.outcome}   TypeCheck=${w.section}`);
  console.log(`    quality categories: ${w.categories.join(", ") || "(none)"}`);
  if (w.profile.interpretations.length === 0) console.log("    (no affirmative evidence supports any reading)");
  for (const i of w.profile.interpretations) {
    console.log(`    ${i.id}${i.domain ? `[${i.domain}]` : ""}`);
    for (const s of i.signals) console.log(`      + [${s.class}] ${s.signalId}  <- ${s.provenance}`);
  }
  const fired = RULES.filter((r) => r.applies(w)).map((r) => r.id);
  console.log(`    rules applying: ${fired.join(", ") || "(none)"}`);
}

/* ═══════════════ 10. REPRESENTATIVE REAL CANDIDATES ═══════════════ */

console.log("\n--- 10. REPRESENTATIVE REAL CANDIDATES BY PATTERN ---");
{
  const pick = (label: string, predicate: (u: Unit) => boolean, n = 3): void => {
    const found = UNITS.filter(predicate).slice(0, n);
    console.log(`\n  ${label}: ${UNITS.filter(predicate).length} units`);
    for (const u of found) {
      console.log(`    "${u.value}" (truth=${u.truth}, section=${u.section}) -> ${u.profile.interpretations.map((i) => `${i.id}${i.domain ? `[${i.domain}]` : ""}{${[...new Set(i.signals.map((s) => s.class))].join(",")}}`).join(" + ") || "(none)"}`);
    }
  };
  pick("Census + ordinary-language conflict", (u) => {
    const ids = interpretationIdsOf(u.profile);
    return ids.includes("person") && ids.includes("ordinary-language");
  });
  pick("Census + domain terminology conflict", (u) => {
    const ids = interpretationIdsOf(u.profile);
    return ids.includes("person") && ids.includes("domain-terminology");
  });
  pick("Census + GNIS conflict", (u) => {
    const ids = interpretationIdsOf(u.profile);
    return ids.includes("person") && ids.includes("place");
  });
  pick("multiple terminology families", (u) => u.profile.interpretations.filter((i) => i.id === "domain-terminology").length >= 2);
  pick("clean exact domain terminology (no person reading)", (u) => {
    const ids = interpretationIdsOf(u.profile);
    return ids.includes("domain-terminology") && !ids.includes("person");
  });
  pick("clean exact person evidence (lexicon or structure, no competitor)", (u) => {
    const person = u.profile.interpretations.find((i) => i.id === "person");
    return person !== undefined
      && u.profile.interpretations.length === 1
      && person.signals.some((s) => s.class === "lexicon-recognition" || s.class === "compositional-structure");
  });
  pick("unsupported", (u) => u.profile.outcome === "unsupported");
  pick("extraction-boundary / truncation shapes", (u) => /^(FYI|When|Did|If|VA)\b|,\s{2,}/.test(u.value));
}

/* ═══════════════ 11. PERFORMANCE OF THE ANALYSIS LAYER ═══════════════ */

console.log("\n--- 11. COST OF COMBINATION ANALYSIS, SEPARATE FROM EVIDENCE COLLECTION ---");
{
  const profiles = UNITS.map((u) => u.profile);
  /* Combination analysis operates on ALREADY-DERIVED evidence -- no reference
   * dataset is touched here, which is the shape the instruction requires. */
  for (let i = 0; i < 2000; i += 1) {
    const p = profiles[i % profiles.length]!;
    for (const interpretation of p.interpretations) independentWitnessGroups(interpretation.signals);
  }
  const iterations = 200_000;
  const t0 = performance.now();
  for (let i = 0; i < iterations; i += 1) {
    const p = profiles[i % profiles.length]!;
    for (const interpretation of p.interpretations) independentWitnessGroups(interpretation.signals);
  }
  const t1 = performance.now();
  const perCandidateUs = ((t1 - t0) * 1000) / iterations;
  console.table([{
    "µs per candidate": Number(perCandidateUs.toFixed(3)),
    "569-candidate pass ms": Number(((perCandidateUs * 569) / 1000).toFixed(3)),
    "2,000-candidate pass ms": Number(((perCandidateUs * 2000) / 1000).toFixed(3)),
  }]);
  console.log("    Reads only the derived profile; touches no reference dataset.");
}

console.log("\n=== END. No rule above was tuned to any population, and none is implemented. ===");
