/**
 * employment-hr-overlap.ts -- INVESTIGATION ONLY. Measures the Employment/HR
 * pack against every reference evidence family actually present in this tree
 * (AG, 2026-08-10).
 *
 *     node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs \
 *          investigation/employment-hr-overlap.ts
 *
 * ══════════════ WHAT THIS IS FOR, AND WHAT IT IS NOT FOR ══════════════
 *
 * `domain-reference-overlap.ts` measures the packs that shipped before this
 * one and is left alone: six integrations were in flight the day this landed,
 * and editing one shared harness from each of them is a merge conflict per
 * pack. This file answers the same question for one family, the same way.
 *
 * INTERSECTION COUNTS ARE NOT DEFECTS. They are measurements of semantic
 * ambiguity, taken BEFORE any combination rule exists, which is the only order
 * in which the measurement is honest. Nothing here tunes anything: no term is
 * dropped because it collides, no threshold is fitted, and the pack was not
 * adjusted toward any number below.
 *
 * EACH COMPARISON RUNS THROUGH THE TARGET PACK'S OWN PUBLIC API, never a raw
 * key comparison, because the normalization policies deliberately differ. A
 * key-set intersection would silently under-count wherever two packs key the
 * same phrase differently, which is exactly where the interesting collisions
 * are.
 *
 * Read-only: imports shipped providers and prints. Changes no state, writes no
 * file, and is not part of the verification battery.
 */

import { censusRoleFor } from "../src/engines/knowledge/CensusNameEvidence.js";
import {
  employmentHrEvidenceFor,
  EMPLOYMENT_HR_EVIDENCE_ROW_COUNT,
  EMPLOYMENT_HR_EVIDENCE_SOURCE,
  EMPLOYMENT_HR_EVIDENCE_TERM_COUNT,
} from "../src/engines/knowledge/EmploymentHrEvidence.js";
import { EMPLOYMENT_HR_PACK } from "../src/engines/knowledge/employment-hr-terminology.data.js";
import { financeAccountingTaxEvidenceFor } from "../src/engines/knowledge/FinanceAccountingTaxEvidence.js";
import { gnisPlaceEvidenceFor } from "../src/engines/knowledge/GnisPlaceEvidence.js";
import { governmentPublicAdminEvidenceFor } from "../src/engines/knowledge/GovernmentPublicAdminEvidence.js";
import { higherEdTerminologyFor } from "../src/engines/knowledge/HigherEdTerminologyEvidence.js";
import { legalTerminologyEvidenceFor } from "../src/engines/knowledge/LegalTerminologyEvidence.js";
import { medicalEvidenceFor } from "../src/engines/knowledge/MedicalEvidence.js";

/** Display terms shipped by the pack, deduplicated. Display forms, not keys. */
const rows = EMPLOYMENT_HR_PACK.rows.split("\n").filter((l) => l.length > 0);
const terms = [...new Set(rows.map((l) => l.split("\t")[1]!))];
const riskOf = new Map<string, string>();
const RISK = ["LOW", "MEDIUM", "HIGH"];
for (const line of rows) {
  const f = line.split("\t");
  const risk = RISK[Number(f[9])]!;
  // Highest risk wins where a term is attested twice -- the conservative read.
  if (RISK.indexOf(risk) > RISK.indexOf(riskOf.get(f[1]!) ?? "LOW")) riskOf.set(f[1]!, risk);
  else if (!riskOf.has(f[1]!)) riskOf.set(f[1]!, risk);
}
const isAcronym = (term: string): boolean => /^[A-Z][A-Z0-9-]{1,6}$/.test(term);
const tokens = (term: string): string[] => term.split(/\s+/).filter((t) => t.length > 0);

console.log("=== EMPLOYMENT / HR PACK ===");
console.log(`   ${EMPLOYMENT_HR_EVIDENCE_SOURCE}`);
console.log(`   ${EMPLOYMENT_HR_EVIDENCE_ROW_COUNT} attestation rows over ${EMPLOYMENT_HR_EVIDENCE_TERM_COUNT} normalized keys, ${terms.length} distinct display terms`);
console.log(`   single-token terms: ${terms.filter((t) => tokens(t).length === 1).length}   acronym-shaped: ${terms.filter(isAcronym).length}`);
console.log(`   source-assigned collision risk: ` + RISK.map((r) => `${r}=${[...riskOf.values()].filter((v) => v === r).length}`).join("  "));

/* ─────────────────────────────────────────────────────────────────────────
 * 1. TERMINOLOGY-FAMILY INTERSECTIONS
 *
 * Every family present in this tree, each queried through its own API. The
 * breakdown by single-token / HIGH-risk / acronym is the part that matters:
 * the GNIS benchmark established that single-token matches are where reference
 * datasets do damage (7 of 7 single-token place hits on the live document were
 * real people), and this pack's HIGH-risk population is mostly acronyms.
 * ───────────────────────────────────────────────────────────────────────── */
const families: Array<{ id: string; hit: (t: string) => boolean }> = [
  { id: "higher-ed", hit: (t) => higherEdTerminologyFor(t) !== null },
  { id: "finance/acct/tax", hit: (t) => financeAccountingTaxEvidenceFor(t) !== null },
  { id: "legal", hit: (t) => legalTerminologyEvidenceFor(t) !== null },
  { id: "medical", hit: (t) => medicalEvidenceFor(t) !== null },
  // Landed from concurrent work while this pack was being integrated. It is
  // the family expected to overlap Employment/HR most heavily -- both cover
  // federal administrative vocabulary -- which makes it the most useful
  // measurement here and the one most likely to be misread as duplication.
  // It is not: OPM/MSPB/FLRA terminology attested by a government-wide
  // administrative source is TWO independent attestations of one phrase.
  { id: "government/public admin", hit: (t) => governmentPublicAdminEvidenceFor(t) !== null },
];

console.log("\n=== 1. INTERSECTIONS WITH EVERY TERMINOLOGY FAMILY PRESENT ===");
console.table(families.map((f) => {
  const shared = terms.filter(f.hit);
  return {
    family: f.id,
    intersections: shared.length,
    singleToken: shared.filter((t) => tokens(t).length === 1).length,
    highRisk: shared.filter((t) => riskOf.get(t) === "HIGH").length,
    acronyms: shared.filter(isAcronym).length,
  };
}));
for (const f of families) {
  const shared = terms.filter(f.hit);
  if (shared.length === 0) { console.log(`\n   ${f.id}: none`); continue; }
  console.log(`\n   ${f.id} (${shared.length}): ${shared.slice(0, 30).join(" · ")}${shared.length > 30 ? " ..." : ""}`);
}

/* ─────────────────────────────────────────────────────────────────────────
 * 2. CENSUS PERSON-NAME COLLISION
 *
 * The measurement that decides whether this pack may ever be read as
 * counter-evidence to personhood. It may not.
 * ───────────────────────────────────────────────────────────────────────── */
console.log("\n=== 2. CENSUS PERSON-NAME COLLISION ===");
{
  const all: string[] = [];
  const single: string[] = [];
  const top1000: string[] = [];
  for (const term of terms) {
    const roles = tokens(term).map((t) => censusRoleFor(t));
    if (roles.length > 0 && roles.every((r) => r !== null)) {
      all.push(term);
      if (tokens(term).length === 1) single.push(term);
      if (roles.every((r) => r!.firstTop1000 || r!.surnameTop1000)) top1000.push(term);
    }
  }
  console.log(`   ${all.length} of ${terms.length} terms are Census-attested in EVERY token`);
  console.log(`      single-token : ${single.length}  -> ${single.join(" · ")}`);
  console.log(`      all Top-1000 : ${top1000.length}  -> ${top1000.slice(0, 20).join(" · ")}`);
  console.log(`      HIGH-risk    : ${all.filter((t) => riskOf.get(t) === "HIGH").length}`);
  console.log("   Every one is RETAINED. A term colliding with a personal name is a term doing its job:");
  console.log("   it is reporting that the phrase is genuinely ambiguous, which is the input a combination");
  console.log("   layer needs and the thing a suppression rule would destroy.");
}

/* ─────────────────────────────────────────────────────────────────────────
 * 3. GNIS PLACE COLLISION
 * ───────────────────────────────────────────────────────────────────────── */
console.log("\n=== 3. GNIS PLACE COLLISION ===");
{
  const hits = terms.filter((t) => gnisPlaceEvidenceFor(t).strength !== "none");
  const strong = hits.filter((t) => gnisPlaceEvidenceFor(t).strength === "strong");
  console.log(`   ${hits.length} terms also attested as US places (${strong.length} strong)`);
  if (hits.length > 0) console.log(`      ${hits.slice(0, 30).join(" · ")}`);
}

/* ─────────────────────────────────────────────────────────────────────────
 * 4. THE TERMS CARRYING THE MOST EVIDENCE AT ONCE
 *
 * The rows a combination layer will have to reason about first. None of them
 * is resolved here, and the fact that the list is short is not reassurance:
 * `Grade` alone is enough to sink a person-suppression rule.
 * ───────────────────────────────────────────────────────────────────────── */
console.log("\n=== 4. TERMS ATTESTED BY THE MOST FAMILIES AT ONCE ===");
{
  const scored = terms.map((term) => {
    const also = families.filter((f) => f.hit(term)).map((f) => f.id);
    if (tokens(term).every((t) => censusRoleFor(t) !== null)) also.push("census-name");
    if (gnisPlaceEvidenceFor(term).strength !== "none") also.push("gnis-place");
    return { term, risk: riskOf.get(term)!, others: also.length, alsoAttestedBy: also.join(", ") };
  }).filter((r) => r.others > 0).sort((a, b) => b.others - a.others || a.term.localeCompare(b.term));
  console.table(scored.slice(0, 40));
  console.log(`   ${scored.length} of ${terms.length} Employment/HR terms carry at least one other family's evidence.`);
}

console.log("\n=== SEMANTIC BOUNDARY ===");
console.log("   Employment/HR evidence establishes only that a phrase is attested employment/HR");
console.log("   terminology according to identified sources. It does not establish that the phrase");
console.log("   is or is not a person, organization, place, legal term, government term, or any");
console.log("   other final semantic type. Every count above is a measurement of ambiguity, not a");
console.log("   defect list, and nothing in this file or the pack resolves any of it.");
