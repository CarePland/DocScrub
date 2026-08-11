/**
 * higher-ed-benchmark.ts -- INVESTIGATION ONLY. Nothing in src/ reads this.
 *
 *     node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs \
 *          investigation/higher-ed-benchmark.ts
 *
 * Measures the higher-education terminology reference against the SAME 139-unit
 * live C1 residue the GNIS geographic benchmark used, so the two reference
 * families can be compared on one population rather than on two anecdotes.
 *
 * WHAT THIS CANNOT SEE, stated up front so the numbers are not over-read: the
 * residue snapshot carries values, occurrence counts and Andrew's truth
 * labels, but no contextual rules, no entity linkage and no occurrence
 * context. So this measures the DATASET's separation, not the pipeline's
 * behaviour. `__docscrub.referenceEvidence()` in the running app is the
 * instrument for the latter, and its figures supersede these.
 *
 * The residue is also, by construction, the population where person detection
 * already fired. A domain reference is expected to be sparse here and rich in
 * the Organizations/Other buckets that this snapshot does not contain -- so
 * the hit count below is a floor, not a total.
 */

import { higherEdTerminologyFor } from "../src/engines/knowledge/HigherEdTerminologyEvidence.js";
import { censusNameEvidenceFor, censusRoleFor } from "../src/engines/knowledge/CensusNameEvidence.js";
import { LIVE_RESIDUE } from "./live-residue.data.js";

const hits = LIVE_RESIDUE.map((unit) => ({ unit, evidence: higherEdTerminologyFor(unit.value) })).filter((r) => r.evidence !== null);

console.log(`=== HIGHER-ED TERMINOLOGY vs the 139-unit live C1 residue ===\n`);
console.log(`units: ${LIVE_RESIDUE.length}   hits: ${hits.length}\n`);

console.table(hits.map(({ unit, evidence }) => ({
  value: unit.value,
  truth: unit.truth,
  matched: evidence!.attestations[0]!.term,
  tokens: evidence!.tokenCount,
  hint: evidence!.semanticHints.join("/"),
  risk: evidence!.highestCollisionRisk,
  derivedOnly: !evidence!.hasSourceAttestedRow,
  families: evidence!.sourceFamilies.length,
})));

const byTruth = { person: 0, "non-person": 0, "?": 0 } as Record<string, number>;
for (const { unit } of hits) byTruth[unit.truth] += 1;
console.log(`\nby Andrew's truth label -- person ${byTruth.person} | non-person ${byTruth["non-person"]} | unknown ${byTruth["?"]}`);
console.log("A hit on a `person` unit is NOT a dataset defect. It is the collision the");
console.log("collision_risk column exists to warn about, and the reason membership may");
console.log("not be read as evidence of non-personhood.\n");

// The single-token question the GNIS benchmark made central, asked of this
// dataset on the same population.
const single = hits.filter((h) => h.evidence!.tokenCount === 1);
const multi = hits.filter((h) => h.evidence!.tokenCount > 1);
console.log(`single-token hits: ${single.length}  -> ${single.map((h) => `${h.unit.value}[${h.unit.truth}]`).join(", ") || "(none)"}`);
console.log(`multi-token hits : ${multi.length}  -> ${multi.map((h) => `${h.unit.value}[${h.unit.truth}]`).join(", ") || "(none)"}`);

// Overlap with the person evidence family, which is the architectural question.
const conflicts = hits.filter((h) => censusNameEvidenceFor(h.unit.value).supportsNameStructure || (censusRoleFor(h.unit.value)?.surnameAttested ?? false));
console.log(`\nunits carrying BOTH higher-ed evidence and Census person evidence: ${conflicts.length}`);
for (const c of conflicts) {
  console.log(`   ${c.unit.value} [${c.unit.truth}] -- hed=${c.evidence!.highestCollisionRisk}, census=${censusNameEvidenceFor(c.unit.value).structure}/${censusRoleFor(c.unit.value)?.surnameAttested ? "surname" : "-"}`);
}
console.log("\nThese are the units a combination layer must be able to represent as a");
console.log("CONFLICT rather than resolve. Same architectural gap the GNIS benchmark");
console.log("identified from the geographic side (§13).");
