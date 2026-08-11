/**
 * variant-form-population.ts -- INVESTIGATION ONLY. What variant-form evidence
 * actually does to a real document's candidate population (AG, 2026-08-10).
 *
 *     node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs \
 *          investigation/variant-form-population.ts
 *
 * `investigation/variant-form-algorithms.ts` decided WHICH method to ship, by
 * measuring false-candidate rates against ordinary English words. This harness
 * asks the next question: given that method, what changes on a real document?
 *
 * PRECISION OVER COVERAGE. A high "rescued candidate" count is not a good
 * result. The number that matters is how many candidates that are NOT people
 * acquire person-supporting evidence, and `LIVE_RESIDUE`'s `truth` column --
 * Andrew's own readings -- is the only way to see it. That column is used to
 * DESCRIBE outcomes and is never an input to any derivation.
 *
 * Read-only. Writes no file, changes no state, not part of the battery.
 */

import { interpretCandidate, type InterpretationFacts } from "../src/engines/interpretation/candidate-interpretation.js";
import { interpretationIdsOf, type InterpretationProfile } from "../src/engines/interpretation/interpretation-model.js";
import { referenceEvidenceFor } from "../src/engines/knowledge/ReferenceEvidence.js";
import { censusRoleFor, normalizeForCensusLookup } from "../src/engines/knowledge/CensusNameEvidence.js";
import {
  variantFormEvidenceFor,
  DOCUMENT_LOCAL_MIN_TOKEN_LENGTH,
  VARIANT_MIN_TOKEN_LENGTH,
  VARIANT_SIMILARITY_THRESHOLD,
} from "../src/engines/interpretation/variant-form-evidence.js";
import { LIVE_RESIDUE } from "./live-residue.data.js";

/** The document-local attested token set, built exactly as Workspace builds it. */
const documentAttestedTokens = new Set<string>();
for (const unit of LIVE_RESIDUE) {
  for (const token of unit.value.replace(/,/g, " ").split(/\s+/)) {
    const normalized = normalizeForCensusLookup(token);
    if (normalized.length > 0 && censusRoleFor(normalized) !== null) documentAttestedTokens.add(normalized);
  }
}

function facts(value: string, over: Partial<InterpretationFacts> = {}): InterpretationFacts {
  return {
    candidateId: `w:${value}`,
    displayValue: value,
    detectedType: "person",
    qualityCategories: [],
    positiveReasons: [],
    relationshipKinds: [],
    contextualRules: [],
    hasPersonEvidencedLinkage: false,
    reference: referenceEvidenceFor(value),
    documentAttestedTokens,
    ...over,
  };
}

const hasVariantSignal = (p: InterpretationProfile): boolean =>
  p.interpretations.some((i) => i.signals.some((s) => s.class === "variant-form"));

/*
 * COLD-DOCUMENT COST, MEASURED FIRST AND ON PURPOSE.
 *
 * The reference path is memoized per normalized token, so any measurement
 * taken after the rest of this harness has run reports a WARM cache and
 * flatters the module. The number that matters is what a document load
 * actually pays, which is the first pass over a fresh set of tokens -- so it
 * is taken here, before anything else touches the module, and reported
 * alongside the steady-state figure rather than instead of it.
 */
const COLD = (() => {
  const t0 = performance.now();
  for (const unit of LIVE_RESIDUE) variantFormEvidenceFor(unit.value, { documentAttestedTokens });
  const t1 = performance.now();
  return { totalMs: t1 - t0, perCandidateUs: ((t1 - t0) * 1000) / LIVE_RESIDUE.length };
})();

console.log("=== VARIANT-FORM EVIDENCE: POPULATION EFFECT ===");
console.log(`    threshold ${VARIANT_SIMILARITY_THRESHOLD}, reference min length ${VARIANT_MIN_TOKEN_LENGTH}, document-local min length ${DOCUMENT_LOCAL_MIN_TOKEN_LENGTH}`);
console.log(`    document-local attested tokens available: ${documentAttestedTokens.size}`);

/* ─────────────── 1. before / after on the live residue ─────────────── */

console.log("\n--- 1. BEFORE / AFTER ON THE LIVE RESIDUE (139 units) ---");
{
  const rows = LIVE_RESIDUE.map((unit) => {
    const before = interpretCandidate(facts(unit.value, { documentAttestedTokens: new Set<string>() } as Partial<InterpretationFacts>));
    /* `before` still runs the reference-variant path; to get a true baseline
     * the variant module has to be absent, which is what the ablation in §4
     * does by construction. Here `before` = document-local disabled only. */
    const after = interpretCandidate(facts(unit.value));
    return { unit, before, after };
  });

  const gained = rows.filter(({ after }) => hasVariantSignal(after));
  console.log(`    units with any variant-form signal: ${gained.length} of ${rows.length}`);
  console.log(`      of which Andrew read as people:     ${gained.filter((g) => g.unit.truth === "person").length}`);
  console.log(`      of which Andrew read as non-people: ${gained.filter((g) => g.unit.truth === "non-person").length}`);

  const rescued = rows.filter(({ before, after }) => before.outcome === "unsupported" && after.outcome !== "unsupported");
  const rescuedByVariant = rows.filter(({ after }) => hasVariantSignal(after) && after.interpretations.length > 0
    && after.interpretations.every((i) => i.signals.every((s) => s.class === "variant-form")));
  console.log(`\n    units whose ONLY evidence is variant-form: ${rescuedByVariant.length}`);
  console.log(`    units moved out of \`unsupported\` by document-local variants alone: ${rescued.length}`);

  if (gained.length > 0) {
    console.table(gained.map(({ unit, after }) => {
      const variant = variantFormEvidenceFor(unit.value, { documentAttestedTokens });
      return {
        value: unit.value,
        truth: unit.truth,
        outcome: after.outcome,
        readings: interpretationIdsOf(after).join(" + "),
        relationships: variant.relationships.length,
        matched: [...new Set(variant.relationships.map((r) => r.matchedForm))].join(", "),
        methods: [...new Set(variant.relationships.map((r) => r.method))].join(", "),
        compositional: variant.compositionalCorroboration,
      };
    }));
  } else {
    console.log("    (none -- see §2 for why, and note that this is a SAFETY result, not a failure)");
  }
}

/* ─────────────── 2. why the residue is mostly untouched ─────────────── */

console.log("\n--- 2. WHY SO FEW: TOKEN-LENGTH ELIGIBILITY ON THE RESIDUE ---");
{
  const lengths = new Map<number, { tokens: number; exact: number }>();
  let eligibleReference = 0;
  let eligibleLocal = 0;
  let totalTokens = 0;
  for (const unit of LIVE_RESIDUE) {
    for (const raw of unit.value.replace(/,/g, " ").split(/\s+/)) {
      const t = normalizeForCensusLookup(raw);
      if (t.length === 0) continue;
      totalTokens += 1;
      const exact = censusRoleFor(t) !== null;
      const bucket = lengths.get(t.length) ?? { tokens: 0, exact: 0 };
      bucket.tokens += 1;
      if (exact) bucket.exact += 1;
      lengths.set(t.length, bucket);
      if (!exact && t.length >= VARIANT_MIN_TOKEN_LENGTH) eligibleReference += 1;
      if (!exact && t.length >= DOCUMENT_LOCAL_MIN_TOKEN_LENGTH) eligibleLocal += 1;
    }
  }
  console.log(`    ${totalTokens} tokens total; ${eligibleReference} eligible for a reference variant lookup,`);
  console.log(`    ${eligibleLocal} eligible for a document-local lookup. Everything else is either already`);
  console.log(`    exactly attested (no lookup needed) or too short to be admitted.`);
  console.table([...lengths.entries()].sort((a, b) => a[0] - b[0]).map(([length, b]) => ({
    tokenLength: length,
    tokens: b.tokens,
    "exactly attested": b.exact,
    "not attested": b.tokens - b.exact,
    "reference-eligible": length >= VARIANT_MIN_TOKEN_LENGTH ? b.tokens - b.exact : 0,
  })));
}

/* ─────────────── 3. the motivating case, injected ─────────────── */

console.log("\n--- 3. THE MOTIVATING CASE AND ITS NEIGHBOURS ---");
console.log("    `Chriztopher Johnson` IS in the live residue. These are its full determination paths.");
{
  const probes = [
    "Chriztopher Johnson", "Chriztopher", "Christopher", "Johnson",
    "Cache", "Cashay", "Yazmine Guzmán", "Amy Miller",
    "Transfer Credit", "Associate Dean", "Academic Senate", "Systemwide Registrars",
    "FYI, Berhanu", "When Ruth", "Did Dr", "If Joan", "Everyone, Same",
  ];
  console.table(probes.map((value) => {
    const profile = interpretCandidate(facts(value));
    const variant = variantFormEvidenceFor(value, { documentAttestedTokens });
    return {
      value,
      outcome: profile.outcome,
      readings: interpretationIdsOf(profile).join(" + ") || "(none)",
      variantRels: variant.relationships.length,
      matched: [...new Set(variant.relationships.map((r) => r.matchedForm))].join(", "),
      compositional: variant.compositionalCorroboration,
    };
  }));

  console.log("\n    Full signal list for the motivating case:");
  const profile = interpretCandidate(facts("Chriztopher Johnson"));
  console.table(profile.interpretations.flatMap((i) =>
    i.signals.map((s) => ({ reading: i.id, signalId: s.signalId, class: s.class, provenance: s.provenance }))
  ));
}

/* ─────────────── 4. ablation ─────────────── */

console.log("\n--- 4. ABLATION: what each mechanism contributes ---");
{
  const CONFIGS: Array<{ label: string; build: (value: string) => InterpretationFacts }> = [
    { label: "exact evidence only (no variant module)", build: (v) => facts(v, { displayValue: ` ${v}` }) },
    { label: "+ reference orthographic variants", build: (v) => facts(v, { documentAttestedTokens: new Set<string>() } as Partial<InterpretationFacts>) },
    { label: "+ document-local variants (shipped)", build: (v) => facts(v) },
  ];
  /* The ` ` prefix in the first row makes every token unmatchable without
   * deleting the module -- an honest ablation of the mechanism rather than of
   * the data. It also disables EXACT matching, so that row is reported for the
   * variant columns only. */
  console.table(CONFIGS.slice(1).map(({ label, build }) => {
    let variantUnits = 0;
    let variantRels = 0;
    let people = 0;
    let nonPeople = 0;
    for (const unit of LIVE_RESIDUE) {
      const profile = interpretCandidate(build(unit.value));
      if (!hasVariantSignal(profile)) continue;
      variantUnits += 1;
      variantRels += profile.interpretations.flatMap((i) => i.signals).filter((s) => s.class === "variant-form").length;
      if (unit.truth === "person") people += 1;
      if (unit.truth === "non-person") nonPeople += 1;
    }
    return { configuration: label, "units with variant evidence": variantUnits, "variant signals": variantRels, "truth: person": people, "truth: non-person": nonPeople };
  }));
  console.log("    A mechanism contributing zero rows on a real document has not earned its place");
  console.log("    by being clever. It has to be justified by the population it would serve, or dropped.");
}

/* ─────────────── 5. false-candidate check on the domain population ─────────────── */

console.log("\n--- 5. SAFETY: DOMAIN AND BOUNDARY CANDIDATES ---");
{
  const NEGATIVES = LIVE_RESIDUE.filter((u) => u.truth === "non-person");
  const withVariant = NEGATIVES.filter((u) => variantFormEvidenceFor(u.value, { documentAttestedTokens }).relationships.length > 0);
  console.log(`    non-person residue units: ${NEGATIVES.length}`);
  console.log(`    ...acquiring ANY variant relationship: ${withVariant.length}`);
  if (withVariant.length > 0) {
    console.table(withVariant.map((u) => {
      const v = variantFormEvidenceFor(u.value, { documentAttestedTokens });
      return {
        value: u.value,
        matched: v.relationships.map((r) => `${r.observedForm}~${r.matchedForm}`).join(", "),
        methods: [...new Set(v.relationships.map((r) => r.method))].join(", "),
        compositional: v.compositionalCorroboration,
      };
    }));
  }
}

/* ─────────────── 6. performance ─────────────── */

console.log("\n--- 6. PERFORMANCE ---");
{
  /* Index build is lazy and happens on the first lookup. */
  const cold0 = performance.now();
  variantFormEvidenceFor("Chriztopher Johnson");
  const cold1 = performance.now();

  const sample = LIVE_RESIDUE.map((u) => u.value);
  for (let i = 0; i < 2000; i += 1) variantFormEvidenceFor(sample[i % sample.length]!, { documentAttestedTokens });
  const iterations = 50_000;
  const t0 = performance.now();
  for (let i = 0; i < iterations; i += 1) variantFormEvidenceFor(sample[i % sample.length]!, { documentAttestedTokens });
  const t1 = performance.now();
  const perCandidateUs = ((t1 - t0) * 1000) / iterations;

  /* The worst realistic case: a long, unattested, reference-eligible token. */
  for (let i = 0; i < 2000; i += 1) variantFormEvidenceFor("Chriztopher Johnson");
  const w0 = performance.now();
  for (let i = 0; i < 10_000; i += 1) variantFormEvidenceFor("Chriztopher Johnson");
  const w1 = performance.now();
  const worstUs = ((w1 - w0) * 1000) / 10_000;

  console.table([
    {
      measurement: "COLD document load (139 distinct units, empty memo)",
      "µs/candidate": Number(COLD.perCandidateUs.toFixed(2)),
      "569-candidate pass ms": Number(((COLD.perCandidateUs * 569) / 1000).toFixed(2)),
      "2,000-candidate pass ms": Number(((COLD.perCandidateUs * 2000) / 1000).toFixed(2)),
    },
    {
      measurement: "steady state (memo warm -- repeated tokens)",
      "µs/candidate": Number(perCandidateUs.toFixed(2)),
      "569-candidate pass ms": Number(((perCandidateUs * 569) / 1000).toFixed(2)),
      "2,000-candidate pass ms": Number(((perCandidateUs * 2000) / 1000).toFixed(2)),
    },
    {
      measurement: "worst case (one long unattested token, warm)",
      "µs/candidate": Number(worstUs.toFixed(2)),
      "569-candidate pass ms": Number(((worstUs * 569) / 1000).toFixed(2)),
      "2,000-candidate pass ms": Number(((worstUs * 2000) / 1000).toFixed(2)),
    },
  ]);
  console.log(`    lazy index build: ${(cold1 - cold0).toFixed(1)} ms (already warm here; see the cold row above)`);
  console.log("    A real document sits between the cold and steady-state rows: names recur across");
  console.log("    candidates, so the memo hits often, but every distinct token is paid for once.");
}

console.log("\n=== END. No threshold was adjusted on the basis of anything above. ===");
