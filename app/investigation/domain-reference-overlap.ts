/**
 * domain-reference-overlap.ts -- INVESTIGATION ONLY. Measures the two new
 * domain terminology packs against every reference asset already shipped, and
 * against the frozen live-residue witnesses (AG, 2026-08-10).
 *
 *     node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs \
 *          investigation/domain-reference-overlap.ts
 *
 * ══════════════════ WHAT THIS IS FOR, AND WHAT IT IS NOT FOR ══════════════════
 *
 * It measures collisions BEFORE any interpretation rule exists, which is the
 * only order in which the measurement is honest. Counting hits would flatter
 * a dataset; counting the places where it DISAGREES with another dataset is
 * what tests it.
 *
 * NOTHING HERE TUNES ANYTHING. No term is dropped because it collides, no
 * threshold is fitted, and the packs are not adjusted to improve any number
 * below. Both source methodologies say the same thing in their own words:
 * record the baseline first, and do not reshape the vocabulary against the
 * witness set. A term that collides is a term doing its job -- it is telling
 * us the phrase is genuinely ambiguous.
 *
 * Read-only: imports the shipped providers and prints. Changes no state,
 * writes no file, and is not part of the verification battery.
 */

import { censusRoleFor } from "../src/engines/knowledge/CensusNameEvidence.js";
import { gnisPlaceEvidenceFor } from "../src/engines/knowledge/GnisPlaceEvidence.js";
import { higherEdTerminologyFor } from "../src/engines/knowledge/HigherEdTerminologyEvidence.js";
import { financeAccountingTaxEvidenceFor, FINANCE_TAX_EVIDENCE_ROW_COUNT, FINANCE_TAX_EVIDENCE_TERM_COUNT } from "../src/engines/knowledge/FinanceAccountingTaxEvidence.js";
import { legalTerminologyEvidenceFor, LEGAL_EVIDENCE_ROW_COUNT, LEGAL_EVIDENCE_TERM_COUNT } from "../src/engines/knowledge/LegalTerminologyEvidence.js";
import { governmentPublicAdminEvidenceFor, GOVERNMENT_EVIDENCE_ROW_COUNT, GOVERNMENT_EVIDENCE_TERM_COUNT } from "../src/engines/knowledge/GovernmentPublicAdminEvidence.js";
/* Medical and Employment/HR are imported as LOOKUP TARGETS ONLY. They landed
 * from concurrent work and are not enumerated as packs below, because their
 * own integrations own that. They are here because Government/Public
 * Administration had to be measured against every family present, and a
 * measurement that skipped two of them would understate the overlap. */
import { medicalEvidenceFor } from "../src/engines/knowledge/MedicalEvidence.js";
import { employmentHrEvidenceFor } from "../src/engines/knowledge/EmploymentHrEvidence.js";
import { attestingChannels, referenceEvidenceAuditRows, referenceEvidenceFor } from "../src/engines/knowledge/ReferenceEvidence.js";
import { FINANCE_TAX_PACK } from "../src/engines/knowledge/finance-accounting-tax-terminology.data.js";
import { LEGAL_PACK } from "../src/engines/knowledge/legal-terminology.data.js";
import { GOVERNMENT_PACK } from "../src/engines/knowledge/government-public-admin-terminology.data.js";
import { HIGHER_ED_ROWS } from "../src/engines/knowledge/higher-ed-terminology.data.js";
import { LIVE_RESIDUE } from "./live-residue.data.js";

/** Display terms shipped by a pack, deduplicated. Display forms, not keys --
 *  a cross-pack comparison must run each phrase through the OTHER pack's own
 *  normalizer, never compare raw keys, because the policies differ. */
function displayTerms(rows: string): string[] {
  const seen = new Set<string>();
  for (const line of rows.split("\n")) {
    if (line.length === 0) continue;
    const term = line.split("\t")[1]!;
    seen.add(term);
  }
  return [...seen];
}

const finance = displayTerms(FINANCE_TAX_PACK.rows);
const legal = displayTerms(LEGAL_PACK.rows);
const higherEd = displayTerms(HIGHER_ED_ROWS);
const government = displayTerms(GOVERNMENT_PACK.rows);

console.log("=== DOMAIN REFERENCE PACKS: SIZE ===");
console.log("   `keys` counts distinct NORMALIZED lookup keys; `displayTerms` counts distinct");
console.log("   source display forms. They differ because casing/punctuation variants can share a key.");
console.table([
  { pack: "higher-ed-terminology", rows: HIGHER_ED_ROWS.split("\n").filter((l) => l.length > 0).length, keys: 1373, displayTerms: higherEd.length },
  { pack: "finance-accounting-tax", rows: FINANCE_TAX_EVIDENCE_ROW_COUNT, keys: FINANCE_TAX_EVIDENCE_TERM_COUNT, displayTerms: finance.length },
  { pack: "legal-terminology", rows: LEGAL_EVIDENCE_ROW_COUNT, keys: LEGAL_EVIDENCE_TERM_COUNT, displayTerms: legal.length },
  { pack: "government-public-admin", rows: GOVERNMENT_EVIDENCE_ROW_COUNT, keys: GOVERNMENT_EVIDENCE_TERM_COUNT, displayTerms: government.length },
]);

/* ─────────────────────────────────────────────────────────────────────────
 * 1. CROSS-PACK OVERLAP
 *
 * Each pack's display terms are looked up in every OTHER pack through that
 * pack's own public API, so every comparison respects the target's own
 * normalization policy. This is the only correct way to compare packs whose
 * normalizers deliberately differ.
 * ───────────────────────────────────────────────────────────────────────── */
console.log("\n=== 1. CROSS-PACK OVERLAP (each pack's terms, looked up in the others) ===");
const packs: Array<{ id: string; terms: string[] }> = [
  { id: "higher-ed", terms: higherEd },
  { id: "finance", terms: finance },
  { id: "legal", terms: legal },
  { id: "government", terms: government },
];
const lookups: Array<{ id: string; hit: (t: string) => boolean }> = [
  { id: "higher-ed", hit: (t) => higherEdTerminologyFor(t) !== null },
  { id: "finance", hit: (t) => financeAccountingTaxEvidenceFor(t) !== null },
  { id: "legal", hit: (t) => legalTerminologyEvidenceFor(t) !== null },
  { id: "government", hit: (t) => governmentPublicAdminEvidenceFor(t) !== null },
  { id: "medical", hit: (t) => medicalEvidenceFor(t) !== null },
  { id: "employment-hr", hit: (t) => employmentHrEvidenceFor(t) !== null },
];
console.table(packs.map((p) => {
  const row: Record<string, unknown> = { pack: p.id, terms: p.terms.length };
  for (const l of lookups) {
    if (l.id === p.id) { row[`in ${l.id}`] = "--"; continue; }
    row[`in ${l.id}`] = p.terms.filter(l.hit).length;
  }
  return row;
}));

for (const [a, b] of [
  ["finance", "legal"], ["finance", "higher-ed"], ["legal", "higher-ed"],
  /* Government against every family present. All five pairs are printed even
   * where the count is small, because the shape of the overlap is the finding
   * and a pair omitted for being uninteresting cannot be seen to be small. */
  ["government", "higher-ed"], ["government", "finance"], ["government", "legal"],
  ["government", "medical"], ["government", "employment-hr"],
] as const) {
  const source = packs.find((p) => p.id === a)!;
  const target = lookups.find((l) => l.id === b)!;
  const shared = source.terms.filter(target.hit);
  console.log(`\n   ${a} terms also attested in ${b}: ${shared.length}`);
  console.log(`      ${shared.slice(0, 24).join(" · ")}${shared.length > 24 ? " ..." : ""}`);
}

/* ─────────────────────────────────────────────────────────────────────────
 * 2. PERSON-NAME COLLISION -- the measurement that decides whether these
 *    packs may ever be read as counter-evidence to personhood.
 *
 * Single-token terms are separated out because both the GNIS benchmark and
 * the higher-ed integration found that is where the danger lives: every one
 * of the 7 single-token GNIS hits on the live document was a real person.
 * ───────────────────────────────────────────────────────────────────────── */
console.log("\n=== 2. CENSUS PERSON-NAME COLLISION ===");
function censusCollisions(terms: string[]): { all: string[]; single: string[]; top1000: string[] } {
  const all: string[] = [];
  const single: string[] = [];
  const top1000: string[] = [];
  for (const term of terms) {
    const tokens = term.split(/\s+/).filter((t) => t.length > 0);
    const roles = tokens.map((t) => censusRoleFor(t));
    if (roles.every((r) => r !== null) && roles.length > 0) {
      all.push(term);
      if (tokens.length === 1) single.push(term);
      if (roles.every((r) => r!.firstTop1000 || r!.surnameTop1000)) top1000.push(term);
    }
  }
  return { all, single, top1000 };
}
for (const p of packs) {
  const c = censusCollisions(p.terms);
  console.log(`\n   ${p.id}: ${c.all.length} of ${p.terms.length} terms are Census-attested in every token`);
  console.log(`      single-token : ${c.single.length}  -> ${c.single.slice(0, 30).join(" · ")}`);
  console.log(`      all Top-1000 : ${c.top1000.length}  -> ${c.top1000.slice(0, 20).join(" · ")}`);
}

/* ─────────────────────────────────────────────────────────────────────────
 * 3. GNIS PLACE COLLISION
 * ───────────────────────────────────────────────────────────────────────── */
console.log("\n=== 3. GNIS PLACE COLLISION ===");
for (const p of packs) {
  const hits = p.terms.filter((t) => gnisPlaceEvidenceFor(t).strength !== "none");
  const strong = hits.filter((t) => gnisPlaceEvidenceFor(t).strength === "strong");
  console.log(`   ${p.id}: ${hits.length} terms also attested as US places (${strong.length} strong)`);
  if (hits.length > 0) console.log(`      ${hits.slice(0, 20).join(" · ")}`);
}

/* ─────────────────────────────────────────────────────────────────────────
 * 4. COLLISION RISK, AS THE DATASETS THEMSELVES FLAG IT
 * ───────────────────────────────────────────────────────────────────────── */
console.log("\n=== 4. COLLISION RISK DISTRIBUTION (source-assigned) ===");
function riskCounts(rows: string, riskColumn: number): Record<string, number> {
  const counts: Record<string, number> = { LOW: 0, MEDIUM: 0, HIGH: 0 };
  const order = ["LOW", "MEDIUM", "HIGH"];
  for (const line of rows.split("\n")) {
    if (line.length === 0) continue;
    counts[order[Number(line.split("\t")[riskColumn]!)]!] += 1;
  }
  return counts;
}
console.table([
  { pack: "finance-accounting-tax", ...riskCounts(FINANCE_TAX_PACK.rows, 9) },
  { pack: "legal-terminology", ...riskCounts(LEGAL_PACK.rows, 9) },
  { pack: "government-public-admin", ...riskCounts(GOVERNMENT_PACK.rows, 9) },
]);
console.log("   Government is the most warned-about pack in the repository by proportion: its own");
console.log("   authors flag 329 of 412 rows MEDIUM or HIGH. That is a property of the register");
console.log("   public administration is written in, not a defect, and nothing is filtered on it.");

/* ─────────────────────────────────────────────────────────────────────────
 * 4b. ACRONYM COLLISION -- the sharpest single-token risk.
 *
 * Government ships 129 source-attested acronym rows and NONE of them were
 * inferred. The measurement that matters is how many of those short strings
 * are also attested personal names, because that is the population where a
 * naive "it is an acronym, therefore not a person" rule would do damage.
 * ───────────────────────────────────────────────────────────────────────── */
console.log("\n=== 4b. GOVERNMENT ACRONYM ROWS, AND WHAT ELSE ATTESTS THEM ===");
{
  const acronymTerms = GOVERNMENT_PACK.rows
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => l.split("\t"))
    .filter((f) => GOVERNMENT_PACK.strings[Number(f[10])]!.length > 0)
    .map((f) => f[1]!);
  console.log(`   acronym rows: ${acronymTerms.length}`);
  const censusAcronyms = acronymTerms.filter((t) => censusRoleFor(t) !== null);
  console.log(`   also Census-attested as a personal name: ${censusAcronyms.length}`);
  console.log(`      ${censusAcronyms.join(" · ")}`);
  console.log("   RETAINED, every one. `SAM` is attested by Acquisition.gov as System for Award");
  console.log("   Management and by Census as a given name. Both are true; the expansion is");
  console.log("   provenance about what one source published, never a resolution of the string.");
  for (const l of lookups) {
    if (l.id === "government") continue;
    const shared = acronymTerms.filter(l.hit);
    if (shared.length > 0) console.log(`   also attested ${l.id}: ${shared.length} -> ${shared.join(" · ")}`);
  }
}

/* ─────────────────────────────────────────────────────────────────────────
 * 5. FROZEN WITNESSES -- the live residue, with Andrew's own truth labels.
 *
 * THE BASELINE, RECORDED BEFORE ANY COMBINATION RULE EXISTS. `person` rows
 * carrying terminology evidence are exactly the cases that would be damaged
 * if membership were ever read as counter-evidence to personhood; `non-person`
 * rows carrying it are the cases a combination layer might one day help with.
 * Neither number is a target and neither pack was tuned toward either.
 * ───────────────────────────────────────────────────────────────────────── */
console.log("\n=== 5. FROZEN WITNESSES (investigation/live-residue.data.ts, 2026-08-10 live run) ===");
const witnessRows = LIVE_RESIDUE.map((w) => {
  const channels = referenceEvidenceFor(w.value);
  return { value: w.value, truth: w.truth, channels: attestingChannels(channels) };
});
const byTruth = new Map<string, { total: number; anyTerminology: number; values: string[] }>();
for (const row of witnessRows) {
  const bucket = byTruth.get(row.truth) ?? { total: 0, anyTerminology: 0, values: [] };
  bucket.total += 1;
  const terminology = row.channels.filter((c) => c.endsWith("terminology") || c === "finance-accounting-tax");
  if (terminology.length > 0) { bucket.anyTerminology += 1; bucket.values.push(`${row.value} [${terminology.join(",")}]`); }
  byTruth.set(row.truth, bucket);
}
console.table([...byTruth.entries()].map(([truth, b]) => ({ truth, witnesses: b.total, withTerminologyEvidence: b.anyTerminology })));
for (const [truth, b] of byTruth) {
  if (b.values.length === 0) continue;
  console.log(`\n   ${truth}:`);
  for (const v of b.values) console.log(`      ${v}`);
}

/* ─────────────────────────────────────────────────────────────────────────
 * 6. THE AUDIT ROW -- one worked example of the determination path.
 * ───────────────────────────────────────────────────────────────────────── */
console.log("\n=== 6. AUDIT TRAIL, one worked example ===");
/* `ADR` is the case worth staring at: attested by the SEC as an American
 * Depositary Receipt AND by the federal judiciary as Alternative Dispute
 * Resolution. Two families, two authorities, unrelated meanings, both rows
 * correct, and NOTHING in this layer picks between them. */
/* `Series` is the government-side equivalent: NARA attests it as records
 * vocabulary and OPM attests it as classification vocabulary. Two federal
 * authorities, two sub-domains, one string, and this layer picks neither.
 * `SAM` is the sharper one -- Acquisition.gov's System for Award Management,
 * and also a given name. */
for (const phrase of ["adjusted gross income", "motion for summary judgment", "ADR", "Levy", "Series", "SAM", "Notice of Proposed Rulemaking"]) {
  console.log(`\n   ${phrase}`);
  const rows = referenceEvidenceAuditRows(referenceEvidenceFor(phrase));
  if (rows.length === 0) { console.log("      (no terminology attestation)"); continue; }
  console.table(rows.map((r) => ({
    family: r.evidenceFamily,
    subDomain: r.subDomain ?? "",
    sourceFamily: r.sourceFamily,
    matched: r.matchedTerm,
    normalized: r.normalizedTerm,
    hints: r.semanticHints,
    attested: r.sourceAttested,
    derived: r.derivedVariant,
    risk: r.collisionRisk,
  })));
}
