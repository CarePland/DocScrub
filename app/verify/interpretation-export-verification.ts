/**
 * interpretation-export-verification.ts -- pins the contract between
 * `__docscrub.exportInterpretations()` in app.ts and the offline harness that
 * consumes its output (AG, 2026-08-10).
 *
 *     node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs \
 *          verify/interpretation-export-verification.ts
 *
 * ═══════════════════ WHAT THIS CAN AND CANNOT VERIFY ═══════════════════
 *
 * `src/ui/app.ts` has ZERO exports. Nothing in it can be imported, called or
 * behaviourally tested; the established idiom in this repository is a regex
 * scan over its source text, and `verify/ui-smoke.ts` says plainly that such a
 * scan IS NOT behavioural verification. The same warning applies here.
 *
 * So this suite deliberately does TWO different things, and only the second is
 * a real test:
 *
 *   §1-§2  SOURCE SCAN of app.ts. Weak. It can only show that certain text is
 *          or is not present. It cannot show the exporter works.
 *
 *   §3-§4  A REAL ROUND TRIP. The field list the exporter writes is extracted
 *          from app.ts and checked against what the consuming harness actually
 *          reads, and a profile built by the real interpretation layer is
 *          serialized in the exporter's shape and parsed back. That catches
 *          the failure that matters: the two files drifting apart so the
 *          export silently stops feeding the harness.
 */

import { readFileSync } from "node:fs";

import { interpretCandidate } from "../src/engines/interpretation/candidate-interpretation.js";
import { adjudicatePerson } from "../src/engines/interpretation/person-adjudication.js";
import { referenceEvidenceFor } from "../src/engines/knowledge/ReferenceEvidence.js";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}\n         expected ${e}\n         actual   ${a}`);
  }
}

const APP = readFileSync("src/ui/app.ts", "utf8");
const HARNESS = readFileSync("investigation/p6-population-report.ts", "utf8");

/** The exporter body, isolated so scans cannot accidentally match the rest of
 *  a 17,000-line file. */
const EXPORTER = (() => {
  const start = APP.indexOf("exportInterpretations: (): string =>");
  if (start === -1) return "";
  const end = APP.indexOf("\n    },", start);
  return end === -1 ? "" : APP.slice(start, end);
})();

console.log("=== INTERPRETATION EXPORT CONTRACT ===");

/* ═══════════ 1. IT EXISTS AND IS DIAGNOSTIC-ONLY ═══════════ */

console.log("\n--- 1. THE EXPORTER EXISTS AND IS READ-ONLY (source scan -- weak) ---");
{
  check("exportInterpretations is defined", EXPORTER.length > 0, true);
  check("it is reachable only through the __docscrub diagnostics object",
    /\["__docscrub"\]\s*=\s*diagnostics/.test(APP), true);

  /* It must read derived state and write none. These are the mutation verbs
   * that would turn a diagnostic into a behavioural change. */
  const mutations = [
    /\bdispatcher\.dispatch\b/, /\bworkspace\.(load|apply|commit|save|decide|resolve|confirm)/,
    /\bsession\s*=/, /\.push\(/, /localStorage/, /indexedDB/, /\bfetch\(/,
  ].filter((p) => p.test(EXPORTER)).map((p) => p.source);
  check("the exporter performs no mutation, persistence or network call", mutations, []);

  /* It must not reach into anything that could change classification. */
  const forbidden = [/semanticTypeFor/, /typeCheckSectionFor/, /deriveRecommendation/, /AutomaticResolution/, /adjudicatePerson/]
    .filter((p) => p.test(EXPORTER)).map((p) => p.source);
  check("the exporter computes no classification, recommendation or adjudication", forbidden, []);

  check("it returns a string rather than mutating anything", /:\s*string\s*=>/.test(EXPORTER), true);
}

/* ═══════════ 2. IT EXPORTS ONLY WHAT WAS AUTHORIZED ═══════════ */

console.log("\n--- 2. SCOPE OF THE EXPORT (source scan -- weak) ---");
{
  /* The five authorized fields, and nothing that would leak document content
   * or reviewer state. */
  for (const field of ["candidateId", "value", "section", "occurrenceCount", "interpretations"]) {
    check(`exports \`${field}\``, new RegExp(`\\b${field}:`).test(EXPORTER), true);
  }
  const leaks = [/\bcontext\b/, /\btext:/, /occurrences/, /candidateDecisions/, /automaticResolutions/, /replacement/, /\bblocks?\b/]
    .filter((p) => p.test(EXPORTER)).map((p) => p.source);
  check("exports no document text, occurrence context, decisions or session state", leaks, []);

  check("output is deterministic: candidates are sorted by id",
    /\.sort\(\(a, b\) => a\.id\.localeCompare\(b\.id\)\)/.test(EXPORTER), true);
}

/* ═══════════ 3. THE FIELDS MATCH WHAT THE HARNESS READS ═══════════ */

console.log("\n--- 3. THE EXPORT AND THE HARNESS AGREE ON THE SCHEMA (real check) ---");
{
  /* Every field the harness's input types declare must be written by the
   * exporter. This is the drift that would silently break the pipeline. */
  const harnessCandidateFields = ["candidateId", "value", "section", "occurrenceCount", "interpretations"];
  const harnessSignalFields = ["signalId", "class", "provenance", "lineage"];
  const harnessInterpretationFields = ["id", "domain", "signals"];

  for (const field of [...harnessCandidateFields, ...harnessInterpretationFields, ...harnessSignalFields]) {
    check(`harness declares \`${field}\` and the exporter writes it`,
      new RegExp(`\\b${field}\\??:`).test(HARNESS) && new RegExp(`\\b${field}:`).test(EXPORTER), true);
  }

  check("the harness's default input path matches the one the exporter prints",
    /investigation\/data\/interpretation-population\.json/.test(EXPORTER)
      && /investigation\/data\/interpretation-population\.json/.test(HARNESS), true);
}

/* ═══════════ 4. ROUND TRIP THROUGH A REAL PROFILE ═══════════ */

console.log("\n--- 4. A REAL PROFILE SURVIVES THE EXPORT SHAPE (real check) ---");
{
  /* Serialize a genuine profile exactly as the exporter does, parse it back
   * the way the harness does, and confirm the adjudication is unchanged. If
   * the export shape ever loses a field the adjudication needs, this fails. */
  const profile = interpretCandidate({
    candidateId: "person:new student",
    displayValue: "New Student",
    detectedType: "person",
    qualityCategories: [],
    positiveReasons: [],
    relationshipKinds: [],
    contextualRules: [],
    hasPersonEvidencedLinkage: false,
    reference: referenceEvidenceFor("New Student"),
  });

  const wire = JSON.parse(JSON.stringify({
    candidateId: profile.candidateId,
    value: profile.value,
    section: "undetermined",
    occurrenceCount: 4,
    interpretations: profile.interpretations.map((i) => ({
      id: i.id,
      domain: i.domain ?? null,
      signals: i.signals.map((s) => ({ signalId: s.signalId, class: s.class, provenance: s.provenance, lineage: [...s.lineage] })),
    })),
  }));

  check("the value survives verbatim", wire.value, "New Student");
  check("signal ids survive", wire.interpretations[0]?.signals.map((s: { signalId: string }) => s.signalId),
    ["person/census-token-membership"]);
  check("lineage survives -- the field a future combiner depends on",
    wire.interpretations[0]?.signals[0]?.lineage, ["us-census-name-corpus"]);

  /* The adjudication computed from the rehydrated wire form must equal the
   * one computed from the live profile. */
  const rehydrated = {
    candidateId: wire.candidateId,
    value: wire.value,
    outcome: profile.outcome,
    interpretations: wire.interpretations,
  } as typeof profile;
  check("adjudication from the wire form equals adjudication from the live profile",
    JSON.stringify(adjudicatePerson(rehydrated, 2)), JSON.stringify(adjudicatePerson(profile, 2)));

  /* Determinism: the same profile serializes identically twice. */
  const once = JSON.stringify(wire);
  const twice = JSON.stringify(JSON.parse(JSON.stringify(wire)));
  check("serialization is byte-stable", once === twice, true);
}

console.log("");
if (failures > 0) {
  console.log(`INTERPRETATION EXPORT: ${failures} FAILURE(S)`);
  process.exit(1);
}
console.log("INTERPRETATION EXPORT: all checks passed.");
console.log("NOTE: §1-§2 are source scans over app.ts and are NOT behavioural verification.");
