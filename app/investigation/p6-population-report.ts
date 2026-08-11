/**
 * p6-population-report.ts -- INVESTIGATION ONLY. Runs the inert P-6
 * adjudication against a REAL browser-exported interpretation population and
 * emits exactly two reports (AG, 2026-08-10).
 *
 *     node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs \
 *          investigation/p6-population-report.ts investigation/data/<export>.json
 *
 * ═══════════════════ WHY THIS EXISTS ═══════════════════
 *
 * Every Person measurement so far has run against a 182-candidate offline
 * proxy, because two production evidence channels -- `occurrence-context` and
 * `document-consistency` -- cannot be reproduced without a loaded document.
 * This harness consumes the real thing.
 *
 * IT INVENTS NOTHING. If the export is absent it says so and exits; it does
 * not fall back to the proxy population and quietly report those numbers as
 * if they were the real ones. A report that silently changes its subject is
 * worse than no report.
 *
 * ═══════════════════ INPUT SCHEMA ═══════════════════
 *
 * A JSON array, one entry per candidate. Only `value` and `interpretations`
 * are required; everything else improves the report and is reported as
 * unavailable when missing.
 *
 *     [
 *       {
 *         "candidateId": "person:new student",
 *         "value": "New Student",
 *         "section": "undetermined",          // Type Check section
 *         "occurrenceCount": 4,
 *         "interpretations": [
 *           {
 *             "id": "person",
 *             "domain": null,
 *             "signals": [
 *               { "signalId": "person/census-token-membership",
 *                 "class": "token-membership",
 *                 "provenance": "CensusNameEvidence",
 *                 "lineage": ["us-census-name-corpus"] }
 *             ]
 *           }
 *         ]
 *       }
 *     ]
 *
 * `tokenCount` is derived from `value` using the same rule the interpretation
 * layer uses (commas to spaces, split on whitespace) so the export does not
 * have to carry it and cannot disagree with it.
 *
 * Read-only. Writes no file, changes no state, not part of the battery.
 */

import { readFileSync, existsSync } from "node:fs";
import { adjudicatePerson, personEvidenceScopeOf } from "../src/engines/interpretation/person-adjudication.js";
import type { InterpretationProfile, InterpretationSignal } from "../src/engines/interpretation/interpretation-model.js";

const path = process.argv[2] ?? "investigation/data/interpretation-population.json";

if (!existsSync(path)) {
  console.log("=== P-6 POPULATION REPORT ===");
  console.log(`\n  NO EXPORT FOUND at: ${path}`);
  console.log("\n  This harness deliberately does NOT fall back to the offline proxy population.");
  console.log("  Every previous Person measurement used a 182-candidate proxy in which");
  console.log("  occurrence-context and document-consistency fire on ZERO units. Reporting");
  console.log("  those numbers under the heading of a real 601-candidate run would be");
  console.log("  changing the subject silently.");
  console.log("\n  To produce the export, see the schema in this file's header.");
  process.exit(2);
}

interface ExportedSignal {
  signalId: string;
  class?: string;
  provenance?: string;
  lineage?: string[];
}
interface ExportedInterpretation {
  id: string;
  domain?: string | null;
  signals: ExportedSignal[];
}
interface ExportedCandidate {
  candidateId?: string;
  value: string;
  section?: string;
  occurrenceCount?: number;
  interpretations: ExportedInterpretation[];
}

const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
const rows: ExportedCandidate[] = Array.isArray(raw)
  ? (raw as ExportedCandidate[])
  : ((raw as { candidates?: ExportedCandidate[] }).candidates ?? []);

if (rows.length === 0) {
  console.log(`Export at ${path} contained no candidates.`);
  process.exit(2);
}

/** The interpretation layer's own tokenization, so the export cannot disagree. */
const tokenCountOf = (value: string): number =>
  value.replace(/,/g, " ").split(/\s+/).filter((t) => t.length > 0).length;

/** Rebuild a profile shape from the export. Missing `class`/`lineage` are
 *  tolerated: only `signalId` drives P-6, and the scope taxonomy reads
 *  `signalId` too. Anything absent is reported, never guessed. */
function toProfile(row: ExportedCandidate): InterpretationProfile {
  const interpretations = row.interpretations.map((i) => ({
    id: i.id as InterpretationProfile["interpretations"][number]["id"],
    ...(i.domain ? { domain: i.domain } : {}),
    signals: i.signals.map((s) => ({
      signalId: s.signalId,
      class: (s.class ?? "token-membership") as InterpretationSignal["class"],
      detail: "",
      provenance: s.provenance ?? "",
      lineage: (s.lineage ?? []) as InterpretationSignal["lineage"],
    })),
  }));
  return {
    candidateId: row.candidateId ?? `c:${row.value}`,
    value: row.value,
    outcome: interpretations.length === 0 ? "unsupported" : interpretations.length === 1 ? "single" : "contested",
    interpretations,
  };
}

const CANDIDATES = rows.map((row) => {
  const profile = toProfile(row);
  const tokenCount = tokenCountOf(row.value);
  return { row, profile, tokenCount, adjudication: adjudicatePerson(profile, tokenCount) };
});

console.log("=== P-6 POPULATION REPORT ===");
console.log(`    source: ${path}`);
console.log(`    ${CANDIDATES.length} candidates`);
console.log(`    ${CANDIDATES.filter((c) => c.adjudication.hadPersonReading).length} carry a Person reading`);
console.log("    P-6 = person-adjudication/multi-token-membership-only. Inert: nothing routes on it.");

/* ═══════════════ REPORT 1: EVERY P-6 FIRING ═══════════════ */

const fired = CANDIDATES.filter((c) => c.adjudication.rejectedBy !== null);

console.log(`\n--- REPORT 1: P-6 FIRES ON ${fired.length} CANDIDATES ---`);
if (fired.length === 0) {
  console.log("    (none)");
} else {
  console.table(fired.map(({ row, adjudication }) => ({
    candidate: row.value,
    "Type Check section": row.section ?? "(not exported)",
    occurrences: row.occurrenceCount ?? "-",
    "surviving non-PERSON interpretations": adjudication.survivingAlternatives.join(", ") || "(none)",
    "reclassification uniquely supported": adjudication.disposition === "reclassify" ? `YES -> ${adjudication.reclassifyTo}` : "no",
    disposition: adjudication.disposition,
  })));

  console.log("\n    Disposition summary:");
  const byDisposition = new Map<string, number>();
  for (const c of fired) byDisposition.set(c.adjudication.disposition, (byDisposition.get(c.adjudication.disposition) ?? 0) + 1);
  console.table([...byDisposition.entries()].map(([disposition, count]) => ({
    disposition,
    candidates: count,
    meaning:
      disposition === "reclassify" ? "exactly one alternative is affirmatively supported"
        : disposition === "contested-without-person" ? "several alternatives supported -- no unique target"
          : "no alternative supported -- Undetermined",
  })));

  console.log("\n    Reclassification targets (unique only):");
  const targets = new Map<string, string[]>();
  for (const c of fired) {
    if (c.adjudication.disposition !== "reclassify" || !c.adjudication.reclassifyTo) continue;
    const bucket = targets.get(c.adjudication.reclassifyTo) ?? [];
    bucket.push(c.row.value);
    targets.set(c.adjudication.reclassifyTo, bucket);
  }
  if (targets.size === 0) console.log("      (none -- no P-6 firing has a uniquely supported alternative)");
  else console.table([...targets.entries()].map(([target, values]) => ({ target, candidates: values.length, examples: values.slice(0, 10).join(", ") })));

  console.log("\n    Current section of P-6 firings (routing is UNCHANGED -- this is where they sit today):");
  const bySection = new Map<string, number>();
  for (const c of fired) bySection.set(c.row.section ?? "(not exported)", (bySection.get(c.row.section ?? "(not exported)") ?? 0) + 1);
  console.table([...bySection.entries()].map(([section, count]) => ({ "current section": section, candidates: count })));
}

/* ═══════════════ REPORT 2: VARIANT-FORM IN THE PERSON READING ═══════════════ */

console.log("\n--- REPORT 2: CANDIDATES WHOSE PERSON READING CONTAINS variant-form ---");
{
  const withVariant = CANDIDATES.filter(({ profile }) => {
    const person = profile.interpretations.find((i) => i.id === "person");
    return person?.signals.some((s) => s.signalId.startsWith("person/variant-form")) ?? false;
  });

  const only: typeof withVariant = [];
  const accompanied: typeof withVariant = [];
  for (const c of withVariant) {
    const person = c.profile.interpretations.find((i) => i.id === "person")!;
    (person.signals.every((s) => s.signalId.startsWith("person/variant-form")) ? only : accompanied).push(c);
  }

  console.log(`    ${withVariant.length} candidates carry variant-form Person evidence.`);
  console.log(`      variant-form is the ONLY Person signal: ${only.length}`);
  console.log(`      variant-form accompanies other Person evidence: ${accompanied.length}`);

  const describe = (label: string, group: typeof withVariant): void => {
    console.log(`\n    ${label}: ${group.length}`);
    if (group.length === 0) { console.log("      (none)"); return; }
    console.table(group.map(({ row, profile, tokenCount, adjudication }) => {
      const person = profile.interpretations.find((i) => i.id === "person")!;
      return {
        candidate: row.value,
        "Type Check section": row.section ?? "(not exported)",
        "variant signal": person.signals.filter((s) => s.signalId.startsWith("person/variant-form")).map((s) => s.signalId.replace("person/", "")).join(", "),
        "other PERSON signals": person.signals.filter((s) => !s.signalId.startsWith("person/variant-form")).map((s) => s.signalId.replace("person/", "")).join(", ") || "(none)",
        "evidence scope": [...new Set(person.signals.map((s) => personEvidenceScopeOf(s, tokenCount)))].join("+"),
        "other interpretations": adjudication.survivingAlternatives.join(", ") || "(none)",
        "P-6 fires": adjudication.rejectedBy !== null,
      };
    }));
  };
  describe("variant-form ONLY", only);
  describe("variant-form WITH other Person evidence", accompanied);

  console.log("\n    Note: P-6 requires EVERY Person signal to be census-token-membership, so it");
  console.log("    can never fire on a candidate carrying variant-form evidence. The two reports");
  console.log("    are disjoint by construction, not by coincidence.");
}

console.log("\n=== END. Measurement only: no rule applied to routing, no tuning, no new rules. ===");
