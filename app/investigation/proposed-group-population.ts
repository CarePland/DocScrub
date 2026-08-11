/**
 * proposed-group-population.ts -- INVESTIGATION ONLY. What cohorts does
 * Quick Approval actually form on the real document? (AG, 2026-08-10)
 *
 *     node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs \
 *          investigation/proposed-group-population.ts \
 *          investigation/data/interpretation-population.json
 *
 * Runs the REAL production grouping engine (`buildProposedGroups`) over the
 * real 601-candidate browser export, and reports what the feature request
 * asked to see before any threshold was fixed: groups found, sizes, evidence
 * basis, overlap, the ungrouped remainder, and the counterexamples.
 *
 * It also scores the two REJECTED cohorts -- "person is the only reading" and
 * "ordinary-language + person" -- against Andrew's truth labels, because the
 * decision not to offer a People group is the most consequential finding here
 * and needs to stay checkable rather than becoming a paragraph someone later
 * disagrees with from memory.
 *
 * TRUTH LABELS ARE EVALUATION ONLY. `LIVE_RESIDUE` labels are joined by value
 * AFTER every group is formed. No predicate reads them, and the separation is
 * structural rather than a convention -- same discipline as
 * review-necessity-audit.ts.
 *
 * WHAT THIS HARNESS CANNOT SEE: occurrence context, so the structural-defect
 * flag (`structurallyDefective`) is passed as false throughout. That flag
 * never affects membership by design (see proposedGroups.ts), so group sizes
 * here are exact; only the per-row flag count is unmeasurable offline.
 *
 * Read-only. Changes nothing, proposes no rule.
 */

import { readFileSync, existsSync } from "node:fs";
import type { InterpretationProfile } from "../src/engines/interpretation/interpretation-model.js";
import { buildProposedGroups, proposedGroupFor, type ProposedGroupFacts } from "../src/engines/review/proposedGroups.js";
import { reviewNecessityFor } from "../src/engines/review/reviewNecessity.js";
import { LIVE_RESIDUE } from "./live-residue.data.js";

const path = process.argv[2] ?? "investigation/data/interpretation-population.json";
if (!existsSync(path)) {
  console.log(`No export at ${path}.`);
  process.exit(2);
}

interface ExpSignal { signalId: string; class: string; provenance: string; lineage: string[] }
interface ExpInterp { id: string; domain: string | null; signals: ExpSignal[] }
interface ExpRow { candidateId: string; value: string; section: string | null; occurrenceCount: number; interpretations: ExpInterp[] }
const ROWS: ExpRow[] = JSON.parse(readFileSync(path, "utf8"));

const TRUTH = new Map(LIVE_RESIDUE.map((u) => [u.value, u.truth]));

function profileOf(row: ExpRow): InterpretationProfile {
  return {
    candidateId: row.candidateId,
    value: row.value,
    outcome: row.interpretations.length === 0 ? "unsupported" : row.interpretations.length === 1 ? "single" : "contested",
    interpretations: row.interpretations.map((i) => ({
      id: i.id as never,
      ...(i.domain ? { domain: i.domain } : {}),
      signals: i.signals.map((s) => ({
        signalId: s.signalId,
        class: s.class as never,
        detail: "",
        provenance: s.provenance,
        lineage: s.lineage as never,
      })),
    })),
  };
}

/** The candidateId prefix IS the detected type -- review-necessity-audit.ts's
 *  own adapter, reused rather than re-derived. */
const detectedTypeOf = (row: ExpRow): string => row.candidateId.split(":")[0] ?? "unknown";

const FACTS: ProposedGroupFacts[] = ROWS.map((row) => ({
  candidateId: row.candidateId,
  value: row.value,
  detectedType: detectedTypeOf(row),
  occurrenceCount: row.occurrenceCount,
  profile: profileOf(row),
  structurallyDefective: false,
}));

/* ── the ACTIVE population: what Quick Approval is actually offered over ── */

const ACTIVE = FACTS.filter((f) => reviewNecessityFor(f.detectedType, f.profile).necessity === "review-required");

console.log("=== POPULATION ===");
console.log(`  extracted candidates        ${FACTS.length}`);
console.log(`  held out by Unlikely        ${FACTS.length - ACTIVE.length}`);
console.log(`  ACTIVE review population    ${ACTIVE.length}`);

/* ── the groups ── */

const groups = buildProposedGroups(ACTIVE);

console.log("\n=== PROPOSED GROUPS ===");
let grouped = 0;
for (const group of groups) {
  grouped += group.members.length;
  const occ = group.members.reduce((n, m) => n + m.occurrenceCount, 0);
  const labels = group.members.map((m) => TRUTH.get(m.value)).filter((t): t is "person" | "non-person" | "?" => t !== undefined);
  const people = labels.filter((t) => t === "person").length;
  console.log(`\n  ${group.descriptor.label}  [${group.id}]`);
  console.log(`    members ${group.members.length}   occurrences ${occ}`);
  console.log(`    labelled ${labels.length}  -- real people among them: ${people}`);
  console.log(`    Change all supported: ${group.descriptor.supportsChangeAll}`);

  const readingSets = new Map<string, number>();
  for (const m of group.members) {
    const key = [...new Set(m.supportedReadings)].sort().join("+");
    readingSets.set(key, (readingSets.get(key) ?? 0) + 1);
  }
  console.log("    evidence basis (supported-reading signature -> members):");
  for (const [key, n] of [...readingSets].sort((a, b) => b[1] - a[1])) console.log(`      ${String(n).padStart(3)}  ${key}`);

  console.log("    members:");
  for (const m of group.members) {
    const t = TRUTH.get(m.value) ?? "-";
    console.log(`      ${t.padEnd(11)} n=${String(m.occurrenceCount).padStart(3)}  ${m.value}`);
  }
}

/* ── overlap: must be structurally impossible ── */

console.log("\n=== OVERLAP ===");
const membership = new Map<string, string[]>();
for (const f of ACTIVE) {
  const id = proposedGroupFor(f);
  if (id) membership.set(f.candidateId, [...(membership.get(f.candidateId) ?? []), id]);
}
const contested = [...membership.entries()].filter(([, ids]) => ids.length > 1);
console.log(`  candidates supporting more than one group: ${contested.length}`);
console.log("  (the two predicates are mutually exclusive by construction -- organization");
console.log("   is required by one and forbidden by the other -- so this must be 0.)");

/* ── what is left ── */

console.log("\n=== UNGROUPED REMAINDER ===");
const ungrouped = ACTIVE.filter((f) => proposedGroupFor(f) === null);
console.log(`  ${ungrouped.length} of ${ACTIVE.length} active candidates remain for ordinary review`);
const why = new Map<string, number>();
for (const f of ungrouped) {
  const readings = f.profile?.interpretations.map((i) => i.id) ?? [];
  let reason: string;
  if (["email", "phone", "cin", "long_numeric_id"].includes(f.detectedType)) reason = "protective typed detection";
  else if (readings.length === 0) reason = "unsupported -- no affirmative evidence";
  else if (readings.includes("person")) reason = "a Person reading survives";
  else if (readings.includes("place")) reason = "a Place reading survives";
  else if (readings.length < 2) reason = "single non-sensitive reading (Unlikely's own shape)";
  else reason = "other";
  why.set(reason, (why.get(reason) ?? 0) + 1);
}
for (const [reason, n] of [...why].sort((a, b) => b[1] - a[1])) console.log(`    ${String(n).padStart(4)}  ${reason}`);
console.log(`\n  grouped ${grouped} / ${ACTIVE.length} active (${((grouped / ACTIVE.length) * 100).toFixed(1)}%)`);

/* ── the rejected cohorts, kept checkable ── */

console.log("\n=== REJECTED COHORTS (why there is no People group) ===");
function scoreCohort(name: string, predicate: (readings: string[]) => boolean): void {
  const members = ACTIVE.filter((f) => {
    const readings = f.profile?.interpretations.map((i) => i.id) ?? [];
    return readings.length > 0 && predicate([...new Set(readings)].sort());
  });
  const labelled = members.map((m) => TRUTH.get(m.value)).filter((t): t is "person" | "non-person" | "?" => t !== undefined);
  const people = labelled.filter((t) => t === "person").length;
  const notPeople = labelled.filter((t) => t === "non-person").length;
  const purity = labelled.length > 0 ? ((people / (people + notPeople || 1)) * 100).toFixed(0) : "n/a";
  console.log(`\n  ${name}`);
  console.log(`    members ${members.length}   labelled ${labelled.length}   people ${people}   non-people ${notPeople}   purity ${purity}%`);
  const counterexamples = members.filter((m) => TRUTH.get(m.value) === "non-person").slice(0, 12);
  if (counterexamples.length > 0) console.log(`    counterexamples: ${counterexamples.map((m) => m.value).join(", ")}`);
  /* THE LABELS ARE A BIASED SAMPLE and the unlabelled majority has to be
   * shown, not summarised. `LIVE_RESIDUE` is the C1 person-residue list, so a
   * cohort's labelled subset is skewed toward the values a person-focused
   * pass already found interesting. A purity figure computed over it is an
   * upper bound, never the cohort's purity. */
  const unlabelled = members.filter((m) => !TRUTH.has(m.value));
  if (unlabelled.length > 0) {
    const sample = [...unlabelled].sort((a, b) => b.occurrenceCount - a.occurrenceCount).slice(0, 14);
    console.log(`    UNLABELLED ${unlabelled.length} of ${members.length} -- top by occurrence: ${sample.map((m) => m.value).join(", ")}`);
  }
}
scoreCohort("person is the only supported reading", (r) => r.length === 1 && r[0] === "person");
scoreCohort("ordinary-language + person", (r) => r.length === 2 && r[0] === "ordinary-language" && r[1] === "person");
console.log("\n  NEITHER IS A COHORT A HUMAN CAN SCAN, for two different reasons.");
console.log("  The first fails on its own labels: 30% purity, with `Dear Student`, `End Time`");
console.log("  and `High School` sitting among the people.");
console.log("  The second scores 94% on labels and is nonetheless worse, which is exactly why");
console.log("  the unlabelled sample above has to be read: only 17 of 107 carry a label, the");
console.log("  labels come from a person-focused residue pass, and the unlabelled remainder is");
console.log("  visibly ordinary English. A purity figure over a biased subset is an upper bound.");
console.log("  No People group is offered. Note what is NOT concluded: nothing here says these");
console.log("  candidates are not people -- only that they are not a scannable cohort.");
