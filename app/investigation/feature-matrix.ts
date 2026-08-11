/**
 * feature-matrix.ts -- INVESTIGATION ONLY (AG, 2026-08-10, §4-§7).
 *
 * Builds a feature matrix over the REAL live C1 residue from existing
 * production evidence ONLY, then looks for structure. No new detection, no
 * new lexicon, no phrase list. Every feature is either a production output
 * or a composition of production outputs.
 *
 * The question this answers: is the information needed to separate
 * `Grade Rosters` from `Amy Miller` already present but scattered?
 */

import type { Candidate, ContentBlock, Occurrence } from "../src/domain/DocumentModel.js";
import { scoreCandidateQuality, LEXICAL_WORDS, QUALITY_DICTIONARIES } from "../src/engines/quality/scoring.js";
import { KNOWN_GIVEN_NAMES, KNOWN_SURNAMES } from "../src/engines/quality/quality-dictionaries.data.js";
import { qualityCategoriesOf, semanticTypeFor, type SemanticTypeId } from "../src/domain/semanticTypes.js";
import { deriveRecommendation, type RecommendationFacts } from "../src/ui/recommendations.js";
import { triageSectionFor } from "../src/ui/triageQueue.js";
import { LIVE_RESIDUE, type LiveResidueUnit } from "./live-residue.data.js";

// ---------------------------------------------------------------- engines

function block(id: string): ContentBlock {
  return { id, kind: "body", text: "", order: 0, sourceMapping: { partId: "word/document.xml", sourceRef: "" }, runMappings: [] };
}

function assess(value: string, occCount: number) {
  const id = `person:${value.toLowerCase()}`;
  const candidate: Candidate = {
    id, detectedType: "person", source: "regex", confidence: "low",
    normalizedValue: value.toLowerCase(), displayValue: value, occurrenceIds: [],
  };
  const blocks = new Map<string, ContentBlock>();
  const occurrences: Occurrence[] = [];
  for (let i = 0; i < Math.max(1, occCount); i += 1) {
    const b = `b${i}`;
    blocks.set(b, block(b));
    occurrences.push({ id: `${id}:${b}:0:1`, candidateId: id, blockId: b, startOffset: 0, endOffset: value.length, text: value, context: `...${value}...`, source: "regex" });
  }
  return { candidate, assessment: scoreCandidateQuality(candidate, occurrences, blocks) };
}

// ------------------------------------------------------------- lexicons
// All read from production. Nothing declared here.

const GIVEN = new Set(KNOWN_GIVEN_NAMES);
const SURNAMES = new Set(KNOWN_SURNAMES);
/** The CLOSED-CLASS function words the pipeline already maintains -- the same
 *  union contextual-person-evidence's Guard 1 builds its capability set from. */
const FUNCTION_WORDS = new Set<string>([
  ...(QUALITY_DICTIONARIES.get("pronoun_or_determiner") ?? []),
  ...(QUALITY_DICTIONARIES.get("sentence_fragment_word") ?? []),
  ...(QUALITY_DICTIONARIES.get("greeting_or_courtesy") ?? []),
  ...(QUALITY_DICTIONARIES.get("interjection_casual") ?? []),
]);

const tok = (v: string): string[] =>
  v.replace(/,/g, " ").split(/\s+/).filter(Boolean)
    .map((t) => t.toLowerCase().replace(/[^\p{L}\p{M}'’-]/gu, ""))
    .filter((t) => t.length > 0);

// ------------------------------------------------------------- features

interface Row {
  u: LiveResidueUnit;
  tokens: string[];
  score: number;
  positiveReasons: string[];
  classifications: string[];
  categories: readonly string[];
  semantic: SemanticTypeId;
  archetype: string;
  section: string;
  occ: number;
  // --- token-level, from production lexicons
  hasKnownGiven: boolean;
  hasKnownSurname: boolean;
  allLexical: boolean;
  leadFunctionWord: boolean;
  // --- CROSS-CANDIDATE, the composition nobody has tried
  maxTokenShare: number;
  sharedToken: string;
  isPrefixOfAnother: string | null;
  headShare: number;
}

const rows: Row[] = LIVE_RESIDUE.map((u) => {
  const occ = u.standalone + u.contextual;
  const { candidate, assessment } = assess(u.value, occ);
  const categories = qualityCategoriesOf(assessment);
  const tokens = tok(u.value);
  const facts: RecommendationFacts = {
    displayValue: u.value, detectedType: "person",
    personTokenCount: tokens.length, categories,
    qualityRecommendation: assessment.status, identityOptions: [], relationshipKinds: new Set(),
  };
  const rec = deriveRecommendation(facts);
  return {
    u, tokens, occ,
    score: assessment.score,
    positiveReasons: assessment.positiveReasons,
    classifications: assessment.filterRules,
    categories,
    semantic: semanticTypeFor({ detectedType: candidate.detectedType, categories, relationshipKinds: new Set() }),
    archetype: rec?.archetype ?? "null",
    section: triageSectionFor(rec?.archetype ?? null, "person"),
    hasKnownGiven: tokens.some((t) => GIVEN.has(t)),
    hasKnownSurname: tokens.some((t) => SURNAMES.has(t)),
    allLexical: tokens.length > 1 && tokens.every((t) => LEXICAL_WORDS.has(t)),
    leadFunctionWord: tokens.length > 1 && FUNCTION_WORDS.has(tokens[0]!),
    maxTokenShare: 0, sharedToken: "", isPrefixOfAnother: null, headShare: 0,
  };
});

// ---- CROSS-CANDIDATE COMPOSITION -----------------------------------------
// Feature 1: TOKEN SHARE. How many DISTINCT multi-token candidates in this
// population use the same token? Domain vocabulary recurs across unrelated
// phrases ("grade" in Grade Rosters / Grade Entry / Grading Security / ...).
// A personal name token recurs only across spellings of ONE person, which is
// a relationship entity resolution already owns.
const tokenToCandidates = new Map<string, Set<string>>();
for (const r of rows) {
  if (r.tokens.length < 2) continue;
  for (const t of new Set(r.tokens)) {
    const s = tokenToCandidates.get(t) ?? new Set<string>();
    s.add(r.u.value);
    tokenToCandidates.set(t, s);
  }
}
// Feature 2: HEAD SHARE. Same, restricted to the FINAL token -- the head noun
// of an English noun phrase. "Date"/"Time"/"Code"/"Report"/"List".
const headToCandidates = new Map<string, Set<string>>();
for (const r of rows) {
  if (r.tokens.length < 2) continue;
  const head = r.tokens[r.tokens.length - 1]!;
  const s = headToCandidates.get(head) ?? new Set<string>();
  s.add(r.u.value);
  headToCandidates.set(head, s);
}
// Feature 3: PREFIX FAMILY. `Term Withdra` is a truncation of `Term
// Withdrawals`; both are in the population. Pure string containment over the
// candidate set, no lexicon.
for (const r of rows) {
  let best = 0;
  let bestTok = "";
  for (const t of new Set(r.tokens)) {
    const n = tokenToCandidates.get(t)?.size ?? 0;
    if (n > best) { best = n; bestTok = t; }
  }
  r.maxTokenShare = best;
  r.sharedToken = bestTok;
  if (r.tokens.length >= 2) r.headShare = headToCandidates.get(r.tokens[r.tokens.length - 1]!)?.size ?? 0;
  const self = r.u.value.toLowerCase();
  for (const other of rows) {
    if (other === r) continue;
    const o = other.u.value.toLowerCase();
    if (o.length > self.length && o.startsWith(self)) { r.isPrefixOfAnother = other.u.value; break; }
  }
}

// ------------------------------------------------------------- reporting

const pad = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
const P = (r: Row): boolean => r.u.truth === "person";
const NP = (r: Row): boolean => r.u.truth === "non-person";
const people = rows.filter(P);
const nonPeople = rows.filter(NP);

console.log(`\n=== LIVE C1 RESIDUE: ${rows.length} units (${people.length} known people, ${nonPeople.length} known non-people, ${rows.length - people.length - nonPeople.length} unlabelled) ===`);

console.log("\n=== A. FEATURE MATRIX (production evidence only) ===\n");
console.log(pad("candidate", 34) + pad("truth", 11) + pad("scr", 5) + pad("occ", 5) + pad("positiveReasons", 46) + pad("tokShare", 9) + pad("headShare", 10) + "prefixOf");
console.log("-".repeat(160));
for (const r of [...rows].sort((a, b) => b.maxTokenShare - a.maxTokenShare || b.occ - a.occ)) {
  console.log(
    pad(r.u.value, 34) + pad(r.u.truth, 11) + pad(String(r.score), 5) + pad(String(r.occ), 5) +
    pad(r.positiveReasons.join(",") || "-", 46) +
    pad(`${r.maxTokenShare}${r.sharedToken ? ` (${r.sharedToken})` : ""}`, 9) +
    pad(String(r.headShare), 10) + (r.isPrefixOfAnother ?? "-")
  );
}

function separation(label: string, pred: (r: Row) => boolean): void {
  const hp = people.filter(pred).length;
  const hn = nonPeople.filter(pred).length;
  const pct = (h: number, of: number): string => `${h}/${of} = ${of ? Math.round((100 * h) / of) : 0}%`;
  console.log(
    pad(label, 52) + pad(`people ${pct(hp, people.length)}`, 22) + pad(`non-people ${pct(hn, nonPeople.length)}`, 26) +
    `lift ${Math.round((100 * hn) / Math.max(1, nonPeople.length)) - Math.round((100 * hp) / Math.max(1, people.length))}pts`
  );
}

console.log("\n=== B. SINGLE-FEATURE SEPARATION (each measured alone) ===\n");
separation("known given-name token (post deviation #8)", (r) => r.hasKnownGiven);
separation("known surname token", (r) => r.hasKnownSurname);
separation("surname_given_structure", (r) => r.positiveReasons.includes("surname_given_structure"));
separation("R1: every token an ordinary English word", (r) => r.allLexical);
separation("leading closed-class function word", (r) => r.leadFunctionWord);
separation("shares a token with >=3 other candidates", (r) => r.maxTokenShare >= 3);
separation("shares a token with >=4 other candidates", (r) => r.maxTokenShare >= 4);
separation("shares a HEAD noun with >=2 other candidates", (r) => r.headShare >= 2);
separation("is a proper prefix of another candidate", (r) => r.isPrefixOfAnother !== null);
separation("all occurrences standalone (capability X)", (r) => r.u.contextual === 0);

console.log("\n=== C. TOKEN-SHARE CLUSTERS (>=3 candidates sharing one token) ===\n");
for (const [t, set] of [...tokenToCandidates].filter(([, s]) => s.size >= 3).sort((a, b) => b[1].size - a[1].size)) {
  const members = [...set];
  const pp = members.filter((m) => rows.find((r) => r.u.value === m)?.u.truth === "person").length;
  console.log(`  "${t}" x${set.size}  (known people among them: ${pp})`);
  console.log(`      ${members.join(" | ")}`);
}

console.log("\n=== D. WHERE THE KNOWN PEOPLE SIT ON EACH FEATURE ===\n");
console.log(pad("person", 26) + pad("givenTok", 10) + pad("srnGiven", 10) + pad("allLex", 8) + pad("leadFn", 8) + pad("tokShare", 10) + pad("headShare", 10) + "prefixOf");
console.log("-".repeat(110));
for (const r of people) {
  console.log(
    pad(r.u.value, 26) + pad(String(r.hasKnownGiven), 10) + pad(String(r.positiveReasons.includes("surname_given_structure")), 10) +
    pad(String(r.allLexical), 8) + pad(String(r.leadFunctionWord), 8) + pad(String(r.maxTokenShare), 10) +
    pad(String(r.headShare), 10) + (r.isPrefixOfAnother ?? "-")
  );
}

export { rows, tokenToCandidates, headToCandidates };
export type { Row };

// ===========================================================================
// E. COMPOSITION -- and the safety gate that must come first
// ===========================================================================

/** The double gate every rule is scoped by, taken verbatim from the routing
 *  rules pass: a unit is ELIGIBLE only if it carries no name-lexicon
 *  evidence, no surname/given structure, no ambiguous-lexical-token
 *  protection. (Contextual/linkage evidence is a live-only input; the
 *  browser diagnostic applies it too.) */
const eligible = (r: Row): boolean =>
  !r.hasKnownGiven && !r.hasKnownSurname &&
  !r.positiveReasons.includes("surname_given_structure") &&
  !r.categories.some((c) => c.replace(/_/g, "-") === "ambiguous-lexical-token");

console.log("\n=== E. THE SAFETY GATE, MEASURED BEFORE ANY RULE RUNS ===\n");
const elig = rows.filter(eligible);
const eligPeople = elig.filter(P);
const eligNon = elig.filter(NP);
console.log(`  eligible units:            ${elig.length} of ${rows.length}`);
console.log(`  known people still eligible: ${eligPeople.length} of ${people.length}  -> ${eligPeople.map((r) => r.u.value).join(", ") || "(none)"}`);
console.log(`  known non-people eligible:   ${eligNon.length} of ${nonPeople.length}`);
console.log(`  people PROTECTED by the gate alone: ${people.length - eligPeople.length}`);

function composed(label: string, pred: (r: Row) => boolean): { hitN: number; hitP: string[] } {
  const hit = elig.filter(pred);
  const hitP = hit.filter(P).map((r) => r.u.value);
  const hitN = hit.filter(NP).length;
  const unl = hit.length - hitN - hitP.length;
  console.log(
    pad(label, 54) + pad(`removes ${hit.length}`, 14) + pad(`non-people ${hitN}/${eligNon.length}`, 22) +
    pad(`unlabelled ${unl}`, 16) + (hitP.length ? `PEOPLE LOST: ${hitP.join(", ")}` : "people lost: 0")
  );
  return { hitN, hitP };
}

console.log("\n=== F. COMPOSED RULES over eligible units ===\n");
composed("T3  token shared with >=3 other candidates", (r) => r.maxTokenShare >= 3);
composed("R1  every token an ordinary English word", (r) => r.allLexical);
composed("H2  head noun shared with >=2 others", (r) => r.headShare >= 2);
composed("PFX is a proper prefix of another candidate", (r) => r.isPrefixOfAnother !== null);
composed("T3 or R1", (r) => r.maxTokenShare >= 3 || r.allLexical);
composed("T3 or R1 or H2", (r) => r.maxTokenShare >= 3 || r.allLexical || r.headShare >= 2);
composed("T3 or R1 or H2 or PFX", (r) => r.maxTokenShare >= 3 || r.allLexical || r.headShare >= 2 || r.isPrefixOfAnother !== null);

console.log("\n=== G. WHAT SURVIVES 'T3 or R1 or H2 or PFX' ===\n");
const survives = elig.filter((r) => !(r.maxTokenShare >= 3 || r.allLexical || r.headShare >= 2 || r.isPrefixOfAnother !== null));
console.log(`  ${survives.length} eligible units survive:`);
console.log(`     ${survives.map((r) => `${r.u.value} [${r.u.truth}]`).join(" | ")}`);

console.log("\n=== H. FINAL POPULATIONS ===\n");
const removed = elig.filter((r) => r.maxTokenShare >= 3 || r.allLexical || r.headShare >= 2 || r.isPrefixOfAnother !== null);
const remaining = rows.filter((r) => !removed.includes(r));
console.log(`  residue today                    ${rows.length}`);
console.log(`  reclassified as non-person       ${removed.length}   (${removed.filter(NP).length} known non-people, ${removed.filter(P).length} known people)`);
console.log(`  remaining for human review       ${remaining.length}   (${remaining.filter(P).length} known people, ${remaining.filter(NP).length} known non-people)`);
console.log(`\n  UTILITY: ${Math.round((100 * removed.filter(NP).length) / nonPeople.length)}% of known non-person pollution removed`);
console.log(`  SAFETY : ${removed.filter(P).length} known real people confidently classified non-person`);

console.log("\n=== I. R1 IS THE ONLY RULE THAT LOSES A PERSON -- price the safe set ===\n");
composed("T2  token shared with >=2 other candidates", (r) => r.maxTokenShare >= 2);
composed("T2 or H2 or PFX  (no R1)", (r) => r.maxTokenShare >= 2 || r.headShare >= 2 || r.isPrefixOfAnother !== null);
composed("T3 or H2 or PFX  (no R1)  <-- THE SAFE SET", (r) => r.maxTokenShare >= 3 || r.headShare >= 2 || r.isPrefixOfAnother !== null);

const SAFE = (r: Row): boolean => r.maxTokenShare >= 3 || r.headShare >= 2 || r.isPrefixOfAnother !== null;
const safeRemoved = elig.filter(SAFE);
const safeRemaining = rows.filter((r) => !safeRemoved.includes(r));
console.log("\n=== J. SAFE SET: FINAL POPULATIONS ===\n");
console.log(`  residue today                    ${rows.length}`);
console.log(`  reclassified as non-person       ${safeRemoved.length}   (${safeRemoved.filter(NP).length} known non-people, ${safeRemoved.filter(P).length} known people)`);
console.log(`  remaining for human review       ${safeRemaining.length}   (${safeRemaining.filter(P).length} known people, ${safeRemaining.filter(NP).length} known non-people)`);
console.log(`  UTILITY: ${Math.round((100 * safeRemoved.filter(NP).length) / nonPeople.length)}% of known non-person pollution removed`);
console.log(`  SAFETY : ${safeRemoved.filter(P).length} known real people confidently classified non-person`);
console.log(`\n  known non-people that SURVIVE (the honest remainder, ${safeRemaining.filter(NP).length}):`);
console.log(`     ${safeRemaining.filter(NP).map((r) => r.u.value).join(" | ")}`);

console.log("\n=== K. FAILURE FAMILIES, derived from which rule fires ===\n");
const families: Array<{ id: string; label: string; pick: (r: Row) => boolean }> = [
  { id: "F1", label: "DOMAIN VOCABULARY -- token recurs across >=3 unrelated candidates", pick: (r) => r.maxTokenShare >= 3 },
  { id: "F2", label: "HEAD-NOUN PARADIGM -- shares a head noun with >=2 others (Date/Time/Code)", pick: (r) => r.headShare >= 2 && r.maxTokenShare < 3 },
  { id: "F3", label: "TRUNCATION/ABBREVIATION -- proper prefix of another candidate", pick: (r) => r.isPrefixOfAnother !== null && r.headShare < 2 && r.maxTokenShare < 3 },
  { id: "F4", label: "ORDINARY-LANGUAGE PHRASE -- R1 only (UNSAFE: loses Amy Miller)", pick: (r) => r.allLexical && !SAFE(r) },
  { id: "F5", label: "UNREACHED -- no existing composition fires", pick: (r) => !SAFE(r) && !r.allLexical },
];
for (const f of families) {
  const hit = elig.filter(f.pick);
  console.log(`  ${f.id}  ${String(hit.length).padStart(3)} units  (${hit.filter(NP).length} known non-people, ${hit.filter(P).length} known people)  ${f.label}`);
  console.log(`        ${hit.slice(0, 14).map((r) => r.u.value).join(" | ")}${hit.length > 14 ? ` … +${hit.length - 14}` : ""}`);
}
