/**
 * census-experiment.ts -- EXPERIMENT ONLY (AG, 2026-08-10, §4-§13).
 * No production change. Nothing here is imported by src/.
 */

import { census, censusEvidenceFor, censusNormalize, loadCensus } from "./census-name-evidence.js";
import { LIVE_RESIDUE } from "./live-residue.data.js";
import { KNOWN_GIVEN_NAMES, KNOWN_SURNAMES } from "../src/engines/quality/quality-dictionaries.data.js";
import { scoreCandidateQuality, LEXICAL_WORDS } from "../src/engines/quality/scoring.js";
import { qualityCategoriesOf, semanticTypeFor } from "../src/domain/semanticTypes.js";
import type { Candidate, ContentBlock, Occurrence } from "../src/domain/DocumentModel.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pad = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
const N = (v: number | null | undefined): string => (v === null || v === undefined ? "-" : String(v));

// ---- existing DocScrub evidence, for comparison -------------------------
const GIVEN = new Set(KNOWN_GIVEN_NAMES);
const SURNAMES = new Set(KNOWN_SURNAMES);
function block(id: string): ContentBlock {
  return { id, kind: "body", text: "", order: 0, sourceMapping: { partId: "word/document.xml", sourceRef: "" }, runMappings: [] };
}
function docscrub(value: string, occ = 2) {
  const id = `person:${value.toLowerCase()}`;
  const c: Candidate = { id, detectedType: "person", source: "regex", confidence: "low", normalizedValue: value.toLowerCase(), displayValue: value, occurrenceIds: [] };
  const blocks = new Map<string, ContentBlock>();
  const occurrences: Occurrence[] = [];
  for (let i = 0; i < occ; i += 1) {
    const b = `b${i}`;
    blocks.set(b, block(b));
    occurrences.push({ id: `${id}:${b}:0:1`, candidateId: id, blockId: b, startOffset: 0, endOffset: value.length, text: value, context: `...${value}...`, source: "regex" });
  }
  const a = scoreCandidateQuality(c, occurrences, blocks);
  const categories = qualityCategoriesOf(a);
  return { a, categories, type: semanticTypeFor({ detectedType: "person", categories, relationshipKinds: new Set() }) };
}
const existingLexiconHit = (value: string): string[] =>
  value.replace(/,/g, " ").split(/\s+/).filter(Boolean)
    .map((t) => t.toLowerCase().replace(/[^\p{L}'’-]/gu, ""))
    .filter((t) => GIVEN.has(t) || SURNAMES.has(t));

// ===========================================================================
console.log("=== 1. RESOURCE ===\n");
console.log(`  rows indexed        ${census.stats.rows.toLocaleString()}   (excluded as data artifacts: ${census.stats.excluded})`);
console.log(`  first-name attested ${census.stats.first.toLocaleString()}`);
console.log(`  surname attested    ${census.stats.last.toLocaleString()}`);
console.log(`  attested as both    ${census.stats.both.toLocaleString()}`);
console.log(`  file size           ${(census.bytes / 1048576).toFixed(2)} MiB`);
console.log(`  parse + index       ${census.loadMs.toFixed(0)} ms`);

// ===========================================================================
console.log("\n\n=== 2. NORMALIZATION ===\n");
for (const t of ["Guzmán", "Núñez", "Martínez", "O'Brien", "Smith-Jones", "MILLER", "miller"]) {
  const n = censusNormalize(t);
  const e = census.byName.get(n);
  console.log(`  ${pad(t, 14)} -> ${pad(n, 14)} ${e ? `first=${e.firstAttested}(${N(e.firstCount)}) last=${e.lastAttested}(${N(e.lastCount)})` : "NOT ATTESTED"}`);
}

// ===========================================================================
const PEOPLE_WITNESSES = ["Yazmine Guzmán", "Julie Ford", "Cashay Jackson", "Min Shi", "Amy Miller", "Jeffrey Lam",
  "Bobbie Galaz", "Chelsye Angelina", "Perias, Nelly", "Yamada, Tamara", "Cobb, Christopher",
  "Chriztopher Johnson", "Diana", "Sarah", "Goodloe, Andrew", "Collier, Tanesha"];
const NONPERSON_WITNESSES = ["Academic Senate", "Grade Rosters", "Reason Code", "Financial Aid", "Message List",
  "Term Withdrawals", "Grade Entry", "Academic Service", "Student Final Exam", "Happy Birthday Eve",
  "Clearinghouse Webinar", "Timekeeper Overview", "Grade Processing", "Term Activation",
  "Service Indicator Codes", "Query Definition", "Course Catalog", "Good Morning", "Hello All"];

function witnessTable(title: string, values: string[]): void {
  console.log(`\n\n=== ${title} ===\n`);
  console.log(pad("candidate", 24) + pad("tokens", 26) + pad("tok1 first", 16) + pad("tok1 last", 16) + pad("tok2 first", 16) + pad("tok2 last", 16) + pad("structure", 16) + pad("docscrub ev", 22) + "type");
  console.log("-".repeat(180));
  for (const v of values) {
    const ce = censusEvidenceFor(v);
    const d = docscrub(v);
    const t1 = ce.tokens[0];
    const t2 = ce.tokens[ce.tokens.length - 1];
    const cell = (t: typeof t1, role: "first" | "last"): string => {
      if (!t?.entry) return "-";
      const att = role === "first" ? t.entry.firstAttested : t.entry.lastAttested;
      if (!att) return "no";
      const count = role === "first" ? t.entry.firstCount : t.entry.lastCount;
      const rank = role === "first" ? t.entry.firstRank : t.entry.lastRank;
      const top = role === "first" ? t.entry.firstTop1000 : t.entry.lastTop1000;
      return `${N(count)}/r${N(rank)}${top ? "*" : ""}`;
    };
    const dsEv = [...existingLexiconHit(v), ...d.a.positiveReasons.filter((r) => /known|title|surname_given/.test(r))];
    console.log(
      pad(v, 24) + pad(ce.tokens.map((t) => t.normalized).join(" "), 26) +
      pad(cell(t1, "first"), 16) + pad(cell(t1, "last"), 16) +
      pad(ce.tokens.length > 1 ? cell(t2, "first") : "", 16) + pad(ce.tokens.length > 1 ? cell(t2, "last") : "", 16) +
      pad(ce.structure, 16) + pad(dsEv.join(",") || "NONE", 22) + d.type
    );
  }
  console.log("   (* = Census Top-1000 for that role; rank is within the role's own list)");
}
witnessTable("3. KNOWN-PERSON WITNESSES", PEOPLE_WITNESSES);
witnessTable("4. KNOWN-NON-PERSON CONTROLS", NONPERSON_WITNESSES);

// ===========================================================================
console.log("\n\n=== 5-7. FULL LIVE C1 RESIDUE (139 real units) ===\n");
type Row = { value: string; truth: string; ce: ReturnType<typeof censusEvidenceFor>; occ: number; existing: string[]; allLexical: boolean };
const rows: Row[] = LIVE_RESIDUE.map((u) => {
  const toks = u.value.replace(/,/g, " ").split(/\s+/).filter(Boolean).map((t) => t.toLowerCase().replace(/[^\p{L}'’-]/gu, ""));
  return {
    value: u.value, truth: u.truth, ce: censusEvidenceFor(u.value),
    occ: u.standalone + u.contextual, existing: existingLexiconHit(u.value),
    allLexical: toks.length > 1 && toks.every((t) => LEXICAL_WORDS.has(t)),
  };
});
const P = rows.filter((r) => r.truth === "person");
const NP = rows.filter((r) => r.truth === "non-person");

const structures = ["FIRST+LAST", "LAST,FIRST", "AMBIGUOUS-ROLE", "SINGLE-TOKEN", "PARTIAL", "NONE"] as const;
console.log(pad("structure", 18) + pad("all", 8) + pad("known people", 16) + pad("known non-people", 20) + "precision on non-people");
console.log("-".repeat(96));
for (const s of structures) {
  const hit = rows.filter((r) => r.ce.structure === s);
  const hp = hit.filter((r) => r.truth === "person").length;
  const hn = hit.filter((r) => r.truth === "non-person").length;
  console.log(pad(s, 18) + pad(String(hit.length), 8) + pad(`${hp}/${P.length}`, 16) + pad(`${hn}/${NP.length}`, 20) + (hit.length ? `${Math.round((100 * hp) / hit.length)}% are people` : "-"));
}

console.log("\n--- 7. COLLISIONS: NON-PEOPLE WITH FULL NAME STRUCTURE (the dangerous cases) ---\n");
const collisions = NP.filter((r) => r.ce.structure === "FIRST+LAST" || r.ce.structure === "LAST,FIRST" || r.ce.structure === "AMBIGUOUS-ROLE")
  .sort((a, b) => (b.ce.minRoleCount ?? 0) - (a.ce.minRoleCount ?? 0));
console.log(pad("candidate", 30) + pad("structure", 16) + pad("weakest role count", 20) + "tokens");
console.log("-".repeat(110));
for (const r of collisions) console.log(pad(r.value, 30) + pad(r.ce.structure, 16) + pad(N(r.ce.minRoleCount), 20) + r.ce.tokens.map((t) => t.normalized).join(" "));
console.log(`\n  ${collisions.length} of ${NP.length} known non-people (${Math.round((100 * collisions.length) / NP.length)}%) present as a full Census name structure.`);

console.log("\n--- KNOWN PEOPLE, for the same measure ---\n");
console.log(pad("candidate", 30) + pad("structure", 16) + pad("weakest role count", 20) + pad("existing lexicon", 20) + "tokens");
console.log("-".repeat(130));
for (const r of P.sort((a, b) => (b.ce.minRoleCount ?? 0) - (a.ce.minRoleCount ?? 0))) {
  console.log(pad(r.value, 30) + pad(r.ce.structure, 16) + pad(N(r.ce.minRoleCount), 20) + pad(r.existing.join(",") || "MISS", 20) + r.ce.tokens.map((t) => t.normalized).join(" "));
}

// ===========================================================================
console.log("\n\n=== 8. FREQUENCY: IS PREVALENCE DISCRIMINATIVE? ===\n");
const quantiles = (xs: number[]): string => {
  if (!xs.length) return "n/a";
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number): number => s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
  return `min ${s[0]}  p25 ${q(0.25)}  median ${q(0.5)}  p75 ${q(0.75)}  max ${s[s.length - 1]}`;
};
const structured = (r: Row): boolean => ["FIRST+LAST", "LAST,FIRST", "AMBIGUOUS-ROLE"].includes(r.ce.structure);
console.log(`  known PEOPLE, weakest role count:     ${quantiles(P.filter(structured).map((r) => r.ce.minRoleCount ?? 0))}`);
console.log(`  known NON-PEOPLE, weakest role count: ${quantiles(NP.filter(structured).map((r) => r.ce.minRoleCount ?? 0))}`);
console.log(`\n  Top-1000 membership:  people ${P.filter((r) => r.ce.anyTop1000).length}/${P.length}   non-people ${NP.filter((r) => r.ce.anyTop1000).length}/${NP.length}`);
for (const cut of [100, 500, 1000, 5000, 20000]) {
  const pp = P.filter((r) => structured(r) && (r.ce.minRoleCount ?? 0) >= cut).length;
  const nn = NP.filter((r) => structured(r) && (r.ce.minRoleCount ?? 0) >= cut).length;
  console.log(`  weakest role count >= ${String(cut).padStart(6)}:  people ${String(pp).padStart(2)}/${P.length}   non-people ${String(nn).padStart(2)}/${NP.length}`);
}

// ===========================================================================
console.log("\n\n=== 9-10. CENSUS vs THE EXISTING DocScrub LEXICON ===\n");
const censusTokenHit = (r: Row): boolean => r.ce.tokens.some((t) => t.isFirst || t.isLast);
console.log(pad("population", 22) + pad("existing lexicon", 20) + pad("census", 12) + pad("census-only", 14) + "existing-only");
console.log("-".repeat(86));
for (const [label, set] of [["known people", P], ["known non-people", NP], ["all residue", rows]] as const) {
  const ex = set.filter((r) => r.existing.length > 0).length;
  const ce = set.filter(censusTokenHit).length;
  const cOnly = set.filter((r) => censusTokenHit(r) && r.existing.length === 0).length;
  const eOnly = set.filter((r) => !censusTokenHit(r) && r.existing.length > 0).length;
  console.log(pad(label, 22) + pad(`${ex}/${set.length}`, 20) + pad(`${ce}/${set.length}`, 12) + pad(String(cOnly), 14) + String(eOnly));
}
console.log("\n  CENSUS-ONLY PERSON RESCUES (existing lexicon misses, Census attests):");
for (const r of P.filter((r) => censusTokenHit(r) && r.existing.length === 0)) {
  console.log(`     ${pad(r.value, 26)} ${r.ce.structure.padEnd(16)} ${r.ce.tokens.map((t) => `${t.normalized}[${t.isFirst ? "F" : ""}${t.isLast ? "L" : ""}]`).join(" ")}`);
}
console.log("\n  EXISTING-LEXICON-ONLY (Census does not attest):");
const eOnlyAll = rows.filter((r) => !censusTokenHit(r) && r.existing.length > 0);
console.log(`     ${eOnlyAll.map((r) => r.value).join(" | ") || "(none)"}`);

console.log("\n  THE MOTIVATING DEFECT, traced:");
for (const v of ["Yazmine Guzmán", "Yazmine Guzman", "Guzmán, Yazmine"]) {
  const ce = censusEvidenceFor(v);
  const d = docscrub(v);
  console.log(`     ${pad(v, 20)} census=${ce.structure.padEnd(14)} tokens=${ce.tokens.map((t) => `${t.raw}->${t.normalized}[${t.isFirst ? "F" : ""}${t.isLast ? "L" : ""}]`).join(" ")}`);
  console.log(`     ${" ".repeat(20)} docscrub reasons=${d.a.reasons.join(",")} -> ${d.type}`);
}

// ===========================================================================
console.log("\n\n=== 12. PERFORMANCE / FOOTPRINT ===\n");
{
  const HERE = dirname(fileURLToPath(import.meta.url));
  const before = process.memoryUsage().heapUsed;
  const reload = loadCensus(join(HERE, "data", "Census2020_DocScrub_NameEvidence.csv"));
  const after = process.memoryUsage().heapUsed;
  console.log(`  CSV on disk           ${(reload.bytes / 1048576).toFixed(2)} MiB`);
  console.log(`  parse + index         ${reload.loadMs.toFixed(0)} ms`);
  console.log(`  heap delta            ${((after - before) / 1048576).toFixed(1)} MiB (Map of ${reload.stats.rows.toLocaleString()} entries)`);
  const probes = rows.map((r) => r.value);
  const t0 = performance.now();
  for (let i = 0; i < 1000; i += 1) for (const v of probes) censusEvidenceFor(v);
  const t1 = performance.now();
  console.log(`  lookup                ${(((t1 - t0) * 1000) / (1000 * probes.length)).toFixed(2)} µs per candidate`);
  console.log(`  full 569-candidate pass (projected)  ${(((t1 - t0) / (1000 * probes.length)) * 569).toFixed(1)} ms`);
}

// ===========================================================================
console.log("\n\n=== 13. INTERACTION WITH CROSS-CANDIDATE EVIDENCE ===\n");
{
  // The validated SAFE composition, recomputed over this population exactly
  // as the production engine does (index over all multi-token candidates).
  const tokIdx = new Map<string, Set<string>>();
  const headIdx = new Map<string, Set<string>>();
  const toks = (v: string): string[] => v.replace(/,/g, " ").split(/\s+/).filter(Boolean).map((t) => t.toLowerCase().replace(/[^\p{L}'’-]/gu, "")).filter(Boolean);
  for (const r of rows) {
    const t = toks(r.value);
    if (t.length < 2) continue;
    for (const x of new Set(t)) { const s = tokIdx.get(x) ?? new Set(); s.add(r.value); tokIdx.set(x, s); }
    const h = t[t.length - 1]!; const s = headIdx.get(h) ?? new Set(); s.add(r.value); headIdx.set(h, s);
  }
  const crossFires = (r: Row): boolean => {
    const t = toks(r.value);
    if (t.length < 2) return false;
    const share = Math.max(...[...new Set(t)].map((x) => tokIdx.get(x)?.size ?? 0));
    const head = headIdx.get(t[t.length - 1]!)?.size ?? 0;
    const self = r.value.toLowerCase();
    const prefix = rows.some((o) => o !== r && o.value.toLowerCase().startsWith(self) && o.value.length > r.value.length);
    return share >= 3 || head >= 2 || prefix;
  };
  const existingGate = (r: Row): boolean => r.existing.length > 0;
  const structured = (r: Row): boolean => ["FIRST+LAST", "LAST,FIRST", "AMBIGUOUS-ROLE", "SINGLE-TOKEN"].includes(r.ce.structure);

  const GATES: Array<{ id: string; protect: (r: Row) => boolean }> = [
    { id: "existing lexicon only (today)", protect: existingGate },
    { id: "+ ANY Census token attested", protect: (r) => existingGate(r) || r.ce.tokens.some((t) => t.isFirst || t.isLast) },
    { id: "+ Census NAME STRUCTURE", protect: (r) => existingGate(r) || structured(r) },
    { id: "+ structure AND weakest role count >= 500", protect: (r) => existingGate(r) || (structured(r) && (r.ce.minRoleCount ?? 0) >= 500) },
    { id: "+ structure AND >= 1000", protect: (r) => existingGate(r) || (structured(r) && (r.ce.minRoleCount ?? 0) >= 1000) },
    { id: "+ structure AND >= 5000", protect: (r) => existingGate(r) || (structured(r) && (r.ce.minRoleCount ?? 0) >= 5000) },
    { id: "+ structure AND Top-1000 role", protect: (r) => existingGate(r) || (structured(r) && r.ce.anyTop1000) },
  ];
  console.log(pad("protection gate", 44) + pad("people protected", 20) + pad("non-people protected", 22) + pad("cross-cand removals", 22) + "people lost");
  console.log("-".repeat(126));
  for (const g of GATES) {
    const removed = rows.filter((r) => !g.protect(r) && crossFires(r));
    console.log(
      pad(g.id, 44) +
      pad(`${P.filter(g.protect).length}/${P.length}`, 20) +
      pad(`${NP.filter(g.protect).length}/${NP.length}`, 22) +
      pad(`${removed.filter((r) => r.truth === "non-person").length} non-people`, 22) +
      (removed.filter((r) => r.truth === "person").map((r) => r.value).join(", ") || "0")
    );
  }

  console.log("\n--- 14. PROJECTED EFFECT IF CENSUS IS USED ONLY AS PERSON EVIDENCE ---\n");
  console.log("  (Census never routes anything TO People on its own; it only decides what");
  console.log("   cross-candidate is forbidden to touch. People membership itself is unchanged.)\n");
  for (const g of GATES.slice(0, 5)) {
    const removed = rows.filter((r) => !g.protect(r) && crossFires(r));
    console.log(`  ${pad(g.id, 44)} residue ${rows.length} -> ${rows.length - removed.length} remaining, ${removed.length} to Undetermined`);
  }

  console.log("\n--- 15. UNSAFE CASES: non-people that Census protects at every strength ---\n");
  const alwaysProtected = NP.filter((r) => structured(r) && (r.ce.minRoleCount ?? 0) >= 1000);
  console.log(`  ${alwaysProtected.map((r) => `${r.value} (${r.ce.structure}, ${N(r.ce.minRoleCount)})`).join(" | ") || "(none)"}`);
  console.log("\n  known people Census CANNOT protect at any strength (no structure at all):");
  console.log(`  ${P.filter((r) => !structured(r)).map((r) => `${r.value} (${r.ce.structure})`).join(" | ") || "(none)"}`);
}
