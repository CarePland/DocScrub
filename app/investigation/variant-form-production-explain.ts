/**
 * variant-form-production-explain.ts -- INVESTIGATION ONLY. Why did each of
 * the 15 production variant-form firings match? (AG, 2026-08-10)
 *
 *     node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs \
 *          investigation/variant-form-production-explain.ts \
 *          investigation/data/interpretation-population.json
 *
 * ═══════════════════ WHY A DEDICATED EXPLAINER ═══════════════════
 *
 * The offline harness produced ONE variant-form firing. The real document
 * produces 15, mostly on organisational and service vocabulary. Before any
 * threshold moves, the question is what the matcher actually did -- which
 * token, against which reference form, by which method, at what distance.
 *
 * ═══════════════════ RECONSTRUCTING PRODUCTION FAITHFULLY ═══════════════════
 *
 * Document-local variant matching depends on `documentAttestedTokens`, which
 * Workspace builds from EVERY candidate in the document. The offline harness
 * built it from a 139-unit residue, so document-local matching was effectively
 * disabled there -- a likely reason the offline measurement understated the
 * firing count.
 *
 * Here it is rebuilt from all 601 exported candidate values using the same
 * rule Workspace uses, so the matcher sees what it saw in the browser. If the
 * reconstruction is right, this harness reproduces exactly the 15 candidates
 * the export reports; that agreement is checked and printed, and a mismatch
 * invalidates everything below.
 *
 * Read-only. Changes nothing, implements nothing.
 */

import { readFileSync, existsSync } from "node:fs";
import { variantFormEvidenceFor, VARIANT_SIMILARITY_THRESHOLD } from "../src/engines/interpretation/variant-form-evidence.js";
import { censusRoleFor, normalizeForCensusLookup } from "../src/engines/knowledge/CensusNameEvidence.js";
import { sequenceRatio } from "../src/engines/entity-resolution/sequence-ratio.js";

const path = process.argv[2] ?? "investigation/data/interpretation-population.json";
if (!existsSync(path)) {
  console.log(`No export at ${path}. This harness does not substitute a proxy population.`);
  process.exit(2);
}

interface ExportedSignal { signalId: string; class?: string }
interface ExportedInterpretation { id: string; domain?: string | null; signals: ExportedSignal[] }
interface ExportedCandidate {
  candidateId?: string; value: string; section?: string; occurrenceCount?: number;
  interpretations: ExportedInterpretation[];
}
const ROWS: ExportedCandidate[] = JSON.parse(readFileSync(path, "utf8"));

/** Exactly Workspace's construction: every Census-attested token of every
 *  candidate in the document. */
const documentAttestedTokens = new Set<string>();
for (const row of ROWS) {
  for (const token of row.value.replace(/,/g, " ").split(/\s+/)) {
    const normalized = normalizeForCensusLookup(token);
    if (normalized.length > 0 && censusRoleFor(normalized) !== null) documentAttestedTokens.add(normalized);
  }
}

/* ─────────────── fidelity check ─────────────── */

const exportedVariant = ROWS.filter((r) =>
  (r.interpretations.find((i) => i.id === "person")?.signals ?? []).some((s) => s.signalId.startsWith("person/variant-form"))
).map((r) => r.value);

const recomputedVariant = ROWS.filter((r) =>
  variantFormEvidenceFor(r.value, { documentAttestedTokens }).relationships.length > 0
).map((r) => r.value);

console.log("=== VARIANT-FORM PRODUCTION EXPLAINER ===");
console.log(`    ${ROWS.length} candidates, ${documentAttestedTokens.size} document-attested tokens reconstructed.`);
console.log(`    exported variant-form candidates:   ${exportedVariant.length}`);
console.log(`    recomputed variant-form candidates: ${recomputedVariant.length}`);
const missing = exportedVariant.filter((v) => !recomputedVariant.includes(v));
const extra = recomputedVariant.filter((v) => !exportedVariant.includes(v));
if (missing.length === 0 && extra.length === 0) {
  console.log("    RECONSTRUCTION AGREES WITH THE BROWSER EXPORT -- the analysis below is faithful.");
} else {
  console.log(`    ⚠ MISMATCH. missing=[${missing.join(", ")}] extra=[${extra.join(", ")}]`);
  console.log("    Everything below is suspect until this agrees.");
}

/* ─────────────── morphology probe (descriptive only) ─────────────── */

/**
 * Does the observed token look like an inflected form of the matched form?
 *
 * DESCRIPTIVE, NOT A RULE. This is here to characterise the population, not
 * to gate anything -- no stemmer is being introduced. It tests only the
 * commonest English inflections and reports what it sees.
 */
function inflectionOf(observed: string, matched: string): string {
  const o = observed.toUpperCase();
  const m = matched.toUpperCase();
  if (o === `${m}S`) return "plural -s";
  if (o === `${m}ES`) return "plural -es";
  if (o === `${m}S`.replace(/YS$/, "IES")) return "plural -ies";
  if (m === `${o}S`) return "matched is plural of observed";
  if (o.endsWith("S") && m.endsWith("S") && o.slice(0, -1) === m.slice(0, -1)) return "both plural";
  if (o.endsWith("S") && !m.endsWith("S")) return "observed plural, matched singular (non-identical stem)";
  if (!o.endsWith("S") && m.endsWith("S")) return "matched plural, observed singular";
  return "";
}

/* ─────────────── the table ─────────────── */

console.log("\n--- 1. EVERY PRODUCTION VARIANT-FORM FIRING, EXPLAINED ---");
const rows: Array<Record<string, unknown>> = [];
for (const row of ROWS) {
  const evidence = variantFormEvidenceFor(row.value, { documentAttestedTokens });
  if (evidence.relationships.length === 0) continue;
  const person = row.interpretations.find((i) => i.id === "person");
  const otherPersonSignals = (person?.signals ?? [])
    .filter((s) => !s.signalId.startsWith("person/variant-form"))
    .map((s) => s.signalId.replace("person/", ""));
  const competitors = row.interpretations.filter((i) => i.id !== "person").map((i) => i.id);
  const tokenCount = row.value.replace(/,/g, " ").split(/\s+/).filter(Boolean).length;

  for (const r of evidence.relationships) {
    const role = censusRoleFor(r.matchedForm);
    rows.push({
      candidate: row.value,
      tokens: tokenCount,
      "observed token": r.observedForm,
      pos: `${r.tokenIndex + 1}/${r.tokenCount}`,
      "matched form": r.matchedForm,
      role: role ? [role.firstAttested ? "given" : "", role.surnameAttested ? "surname" : ""].filter(Boolean).join("+") : "?",
      method: r.method === "orthographic-near-form" ? "orthographic" : "document-local",
      similarity: Number(r.similarity.toFixed(4)),
      "len obs/ref": `${r.observedNormalized.length}/${r.matchedForm.length}`,
      inflection: inflectionOf(r.observedNormalized, r.matchedForm) || "-",
      "compositional partner": evidence.compositionalCorroboration ? evidence.exactAttestedPartnerTokens.join(",") : "-",
      "other PERSON signals": otherPersonSignals.join(", ") || "(none)",
      competitors: competitors.join(", ") || "(none)",
      section: row.section ?? "?",
    });
  }
}
console.table(rows);

/* ─────────────── mechanism breakdown ─────────────── */

console.log("\n--- 2. WHAT MECHANISM PRODUCED EACH MATCH? ---");
{
  const byMethod = new Map<string, number>();
  const byInflection = new Map<string, number>();
  for (const r of rows) {
    byMethod.set(String(r.method), (byMethod.get(String(r.method)) ?? 0) + 1);
    byInflection.set(String(r.inflection), (byInflection.get(String(r.inflection)) ?? 0) + 1);
  }
  console.log("\n    By method:");
  console.table([...byMethod.entries()].map(([method, count]) => ({ method, relationships: count })));
  console.log("\n    By apparent morphological relationship (descriptive only, no stemmer exists):");
  console.table([...byInflection.entries()].sort((a, b) => b[1] - a[1]).map(([inflection, count]) => ({ inflection, relationships: count })));

  console.log("\n    NOTE: no phonetic matcher ships. Double Metaphone, Soundex and NYSIIS were");
  console.log("    measured and rejected at 93-99% false-candidate rates. The orthographic /");
  console.log("    document-local split above IS the complete ablation of shipped mechanisms.");
}

/* ─────────────── the affix guard: why did it not stop these? ─────────────── */

console.log("\n--- 3. WHY THE EXISTING AFFIX GUARD DID NOT CATCH THESE ---");
console.log("    The guard refuses a relationship when one form is a prefix OR suffix of the");
console.log("    other -- pure containment. These matches are NOT containment: they differ");
console.log("    internally as well, so the difference is not a clean affix.");
{
  const detail = rows.map((r) => {
    const o = String(r["observed token"]).toUpperCase().replace(/[^A-Z]/g, "");
    const m = String(r["matched form"]);
    return {
      observed: o,
      matched: m,
      "prefix containment": o.startsWith(m) || m.startsWith(o),
      "suffix containment": o.endsWith(m) || m.endsWith(o),
      "differs internally": !(o.startsWith(m) || m.startsWith(o) || o.endsWith(m) || m.endsWith(o)),
      similarity: r.similarity,
    };
  });
  console.table(detail);
}

/* ─────────────── corroboration hypotheses ─────────────── */

console.log("\n--- 4. CORROBORATION HYPOTHESES, MEASURED ON ALL 601 ---");
console.log("    Each is stated as a predicate over the PRODUCTION evidence and scored by");
console.log("    which of the 15 it would remove and whether Chriztopher Johnson survives.");
{
  interface Hypothesis { id: string; claim: string; keeps: (row: ExportedCandidate) => boolean }

  const personSignalsOf = (row: ExportedCandidate): string[] =>
    (row.interpretations.find((i) => i.id === "person")?.signals ?? []).map((s) => s.signalId);

  const HYPOTHESES: Hypothesis[] = [
    {
      id: "H-1/exact-attested-partner",
      claim: "Keep only when another token of the candidate is itself exactly Census-attested (compositional corroboration).",
      keeps: (row) => variantFormEvidenceFor(row.value, { documentAttestedTokens }).compositionalCorroboration,
    },
    {
      id: "H-2/multi-token-only",
      claim: "Keep only on multi-token candidates -- a single token has no structure to corroborate.",
      keeps: (row) => row.value.replace(/,/g, " ").split(/\s+/).filter(Boolean).length > 1,
    },
    {
      id: "H-3/other-person-evidence",
      claim: "Keep only when some OTHER Person signal is present (context, structure, lexicon, linkage).",
      keeps: (row) => personSignalsOf(row).some((s) => !s.startsWith("person/variant-form")),
    },
    {
      id: "H-4/no-competing-institutional-reading",
      claim: "Keep only when no organization or domain-terminology reading competes. (Tests whether absence can substitute for corroboration -- it should not.)",
      keeps: (row) => !row.interpretations.some((i) => i.id === "organization" || i.id === "domain-terminology"),
    },
    {
      id: "H-5/matched-form-is-given-name",
      claim: "Keep only when the matched reference form is attested as a GIVEN name (not surname-only).",
      keeps: (row) => variantFormEvidenceFor(row.value, { documentAttestedTokens }).relationships
        .some((r) => censusRoleFor(r.matchedForm)?.firstAttested === true),
    },
    {
      /*
       * THE PREVALENCE HYPOTHESIS. Every false target below is a RARE tail
       * surname one deletion away from a common English word -- SERVIES,
       * SCHEDLER, MANGERS, REINDERS, SESSION. The Census corpus's 195,310
       * entries form a near-cover of English orthography at edit distance 1,
       * so almost any long English word has SOME rare-name neighbour. The
       * rarity of the TARGET is what makes the match uninformative.
       *
       * The asset already carries the flag: `firstTop1000` / `surnameTop1000`.
       */
      id: "H-7/matched-form-is-common",
      claim: "Keep only when the matched reference form is Top-1000 in at least one role -- a variant relationship to a rare tail form is not evidence.",
      keeps: (row) => variantFormEvidenceFor(row.value, { documentAttestedTokens }).relationships
        .some((r) => {
          const role = censusRoleFor(r.matchedForm);
          return role !== null && (role.firstTop1000 || role.surnameTop1000);
        }),
    },
    {
      id: "H-8/common-plus-partner",
      claim: "H-7 and H-1 together: the matched form is Top-1000 AND another token of the candidate is exactly attested.",
      keeps: (row) => {
        const e = variantFormEvidenceFor(row.value, { documentAttestedTokens });
        return e.compositionalCorroboration && e.relationships.some((r) => {
          const role = censusRoleFor(r.matchedForm);
          return role !== null && (role.firstTop1000 || role.surnameTop1000);
        });
      },
    },
    {
      id: "H-6/partner-plus-given-name",
      claim: "H-1 and H-5 together: an exactly-attested partner token AND the variant resembles a given name.",
      keeps: (row) => {
        const e = variantFormEvidenceFor(row.value, { documentAttestedTokens });
        return e.compositionalCorroboration && e.relationships.some((r) => censusRoleFor(r.matchedForm)?.firstAttested === true);
      },
    },
  ];

  const variantRows = ROWS.filter((r) => variantFormEvidenceFor(r.value, { documentAttestedTokens }).relationships.length > 0);
  console.table(HYPOTHESES.map((h) => {
    const kept = variantRows.filter(h.keeps);
    const removed = variantRows.filter((r) => !h.keeps(r));
    return {
      hypothesis: h.id,
      "kept of 15": kept.length,
      "removed": removed.length,
      "Chriztopher survives": kept.some((r) => r.value === "Chriztopher Johnson"),
      "kept examples": kept.map((r) => r.value).slice(0, 6).join(", "),
    };
  }));
  console.log("\n    Hypothesis claims:");
  for (const h of HYPOTHESES) console.log(`      ${h.id}\n        ${h.claim}`);
}

console.log("\n=== END. Nothing implemented; no threshold changed. ===");
