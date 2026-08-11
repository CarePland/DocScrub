/**
 * reference-evidence-perf.mjs -- INVESTIGATION ONLY. The cost of the whole
 * reference-evidence layer, measured rather than guessed (AG, 2026-08-10).
 *
 *     npx tsc
 *     node --expose-gc investigation/reference-evidence-perf.mjs
 *
 * (`--expose-gc` is optional; without it the heap deltas are noisier but the
 *  timings are unaffected.)
 *
 * ══════════════════ WHY THESE FOUR NUMBERS ══════════════════
 *
 * DocScrub is responsive today and the whole point of measuring is to keep it
 * that way without paying for optimization nobody needs. Four costs exist and
 * they behave completely differently:
 *
 *   1. ASSET PARSE   paid at module import, once, per family. This is the
 *                    JS engine reading a multi-megabyte string literal, and
 *                    it is unavoidable for a bundled offline dataset.
 *   2. INDEX BUILD   paid on the family's FIRST lookup, once. Every family
 *                    builds lazily, so a document that never reaches a family
 *                    never pays this.
 *   3. LOOKUP        paid per candidate per family. This is the only cost
 *                    that scales with document size.
 *   4. HEAP          what the built index costs to keep resident.
 *
 * The intended computational shape is `unique candidates x providers`, NOT
 * `occurrences x providers x navigation events`. Workspace computes reference
 * evidence once per candidate during `loadDocument` and stores the result, so
 * navigating between review items recomputes nothing -- that property is what
 * section 4 below exists to keep honest.
 *
 * NOTHING HERE IS OPTIMIZED AGAINST. If a number below is negligible, the
 * correct response is to leave the code simple and record that it is
 * negligible -- not to introduce a bitset, a lazy store or a binary index for
 * a cost that does not exist.
 *
 * Read-only. Imports the built `dist/` modules and prints.
 */

import { readFileSync, statSync } from "node:fs";

const FAMILIES = [
  { id: "census-name", module: "../dist/engines/knowledge/CensusNameEvidence.js", asset: "src/engines/knowledge/census-names.data.ts", call: (m, v) => m.censusNameEvidenceFor(v) },
  { id: "gnis-place", module: "../dist/engines/knowledge/GnisPlaceEvidence.js", asset: "src/engines/knowledge/gnis-places.data.ts", call: (m, v) => m.gnisPlaceEvidenceFor(v) },
  { id: "higher-ed-terminology", module: "../dist/engines/knowledge/HigherEdTerminologyEvidence.js", asset: "src/engines/knowledge/higher-ed-terminology.data.ts", call: (m, v) => m.higherEdTerminologyFor(v) },
  { id: "legal-terminology", module: "../dist/engines/knowledge/LegalTerminologyEvidence.js", asset: "src/engines/knowledge/legal-terminology.data.ts", call: (m, v) => m.legalTerminologyEvidenceFor(v) },
  { id: "medical-terminology", module: "../dist/engines/knowledge/MedicalEvidence.js", asset: "src/engines/knowledge/medical-terminology.data.ts", call: (m, v) => m.medicalEvidenceFor(v) },
  { id: "finance-accounting-tax", module: "../dist/engines/knowledge/FinanceAccountingTaxEvidence.js", asset: "src/engines/knowledge/finance-accounting-tax-terminology.data.ts", call: (m, v) => m.financeAccountingTaxEvidenceFor(v) },
  { id: "employment-hr-terminology", module: "../dist/engines/knowledge/EmploymentHrEvidence.js", asset: "src/engines/knowledge/employment-hr-terminology.data.ts", call: (m, v) => m.employmentHrEvidenceFor(v) },
  { id: "government-public-admin", module: "../dist/engines/knowledge/GovernmentPublicAdminEvidence.js", asset: "src/engines/knowledge/government-public-admin-terminology.data.ts", call: (m, v) => m.governmentPublicAdminEvidenceFor(v) },
];

/* A realistic candidate mix: real names, real terminology, real residue-shaped
 * noise, and misses. Misses matter -- most candidates in a real document miss
 * most families, so a benchmark built only from hits would flatter the layer. */
const SAMPLE = [
  "Yazmine Guzmán", "Amy Miller", "Cobb, Christopher", "Chelsye Angelina",
  "Cost of Attendance", "Satisfactory Academic Progress", "Financial aid", "Credit hour",
  "Default judgment", "Pro se", "Levy", "Doe",
  "Prior authorization", "National Provider Identifier", "Diabetes Mellitus",
  "Form 10-K", "account balance", "Common Stock",
  "Family and Medical Leave Act", "basic pay", "Exempt employee",
  "Contracting Officer", "CAGE Code", "Federal Register",
  "San Jose", "Franklin County",
  "Grade Rosters", "Reason Code", "Term Withdrawals", "Academic Senate",
  "Qwzzx Vbnm", "ZZZ-000-QQ", "unattested phrase here",
];

const CANDIDATES = 569; // the live run's person-typed candidate count
const ITERATIONS = 50_000;

const fmt = (n, d = 2) => n.toFixed(d);
const mib = (bytes) => (bytes / 1048576).toFixed(1);

console.log("=== REFERENCE EVIDENCE PERFORMANCE ===");
console.log(`    ${FAMILIES.length} families, ${SAMPLE.length}-phrase realistic mix, ${ITERATIONS.toLocaleString()} iterations per family.`);
console.log(`    Node ${process.version}. gc ${typeof global.gc === "function" ? "exposed" : "NOT exposed (heap deltas noisy)"}.`);

const rows = [];
const loaded = new Map();

for (const family of FAMILIES) {
  /* 1. ASSET PARSE -- module import. Paid once, per family, at load. */
  const t0 = performance.now();
  const mod = await import(family.module);
  const t1 = performance.now();
  loaded.set(family.id, mod);

  /* 2. INDEX BUILD -- the first lookup, which is what triggers it. */
  global.gc?.();
  const heapBefore = process.memoryUsage().heapUsed;
  const i0 = performance.now();
  family.call(mod, "Miller Smith");
  const i1 = performance.now();
  global.gc?.();
  const heapAfter = process.memoryUsage().heapUsed;

  /* 3. LOOKUP -- warm, over the realistic mix. */
  for (let i = 0; i < 1000; i += 1) family.call(mod, SAMPLE[i % SAMPLE.length]);
  const l0 = performance.now();
  for (let i = 0; i < ITERATIONS; i += 1) family.call(mod, SAMPLE[i % SAMPLE.length]);
  const l1 = performance.now();
  const perLookupUs = ((l1 - l0) * 1000) / ITERATIONS;

  const assetBytes = statSync(family.asset).size;
  rows.push({
    family: family.id,
    "asset KiB": Math.round(assetBytes / 1024),
    "parse ms": Number(fmt(t1 - t0, 1)),
    "index ms": Number(fmt(i1 - i0, 1)),
    "heap MiB": Number(mib(heapAfter - heapBefore)),
    "lookup µs": Number(fmt(perLookupUs)),
    [`${CANDIDATES}-cand ms`]: Number(fmt((perLookupUs * CANDIDATES) / 1000)),
  });
}

console.log("\n--- 1-3. PER FAMILY ---");
console.table(rows);

/* 4. THE AGGREGATE -- what Workspace actually calls, once per candidate. */
const ref = await import("../dist/engines/knowledge/ReferenceEvidence.js");
for (let i = 0; i < 1000; i += 1) ref.referenceEvidenceFor(SAMPLE[i % SAMPLE.length]);
const a0 = performance.now();
for (let i = 0; i < ITERATIONS; i += 1) ref.referenceEvidenceFor(SAMPLE[i % SAMPLE.length]);
const a1 = performance.now();
const aggUs = ((a1 - a0) * 1000) / ITERATIONS;

console.log("\n--- 4. AGGREGATE: referenceEvidenceFor() -- all 8 channels, one call ---");
console.table([{
  "per candidate µs": Number(fmt(aggUs)),
  "sum of parts µs": Number(fmt(rows.reduce((s, r) => s + r["lookup µs"], 0))),
  [`${CANDIDATES}-candidate pass ms`]: Number(fmt((aggUs * CANDIDATES) / 1000)),
  "2,000-candidate pass ms": Number(fmt((aggUs * 2000) / 1000)),
}]);
console.log("    This is the whole per-document cost of the layer: ONE call per candidate during");
console.log("    loadDocument, stored in a Map. Navigating between review items recomputes nothing.");

/* 5. TOTALS -- what a cold document load pays if every family is touched. */
const totalParse = rows.reduce((s, r) => s + r["parse ms"], 0);
const totalIndex = rows.reduce((s, r) => s + r["index ms"], 0);
const totalHeap = rows.reduce((s, r) => s + r["heap MiB"], 0);
const totalAsset = rows.reduce((s, r) => s + r["asset KiB"], 0);

console.log("\n--- 5. COLD-LOAD TOTALS (every family touched) ---");
console.table([{
  "assets KiB (source)": totalAsset,
  "parse ms": Number(fmt(totalParse, 1)),
  "index build ms": Number(fmt(totalIndex, 1)),
  "resident heap MiB": Number(fmt(totalHeap, 1)),
  [`${CANDIDATES}-candidate evidence pass ms`]: Number(fmt((aggUs * CANDIDATES) / 1000)),
}]);

/* 6. SHIPPED BYTES. There is no bundler: index.html loads the ES modules
 *    directly, so "bundle impact" is the byte size of the emitted dist
 *    modules the browser must fetch and parse. */
console.log("\n--- 6. SHIPPED BYTES (dist, what the browser fetches) ---");
console.table(FAMILIES.map((f) => {
  const dist = f.asset.replace(/^src\//, "dist/").replace(/\.ts$/, ".js");
  let bytes = 0;
  try { bytes = statSync(dist).size; } catch { bytes = 0; }
  return { family: f.id, "dist asset KiB": Math.round(bytes / 1024) };
}).concat([{
  family: "— TOTAL —",
  "dist asset KiB": Math.round(FAMILIES.reduce((s, f) => {
    const dist = f.asset.replace(/^src\//, "dist/").replace(/\.ts$/, ".js");
    try { return s + statSync(dist).size; } catch { return s; }
  }, 0) / 1024),
}]));

console.log("\n=== END. No optimization was applied on the basis of these numbers. ===");
void readFileSync;
