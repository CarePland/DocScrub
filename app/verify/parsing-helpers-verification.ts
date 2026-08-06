/**
 * Verification for the shared parsing helpers introduced by the 2026-07-29
 * architectural cleanup pass: `parseJsonObject()` (domain/JsonParsing.ts,
 * findings #3) and `requireString()` (io/DecisionImport.ts, local to that
 * file, finding #4). Neither had a dedicated test before this cleanup --
 * the three deserializers that now share parseJsonObject were previously
 * covered only for a handful of malformed cases (review-engine-
 * verification.ts covers deserializeReviewSession's bad-JSON/missing-
 * version/future-version/truncated paths), and no existing suite exercised
 * a primitive, null, or array top-level payload against any of the three.
 * This suite closes that gap directly, plus confirms requireString()
 * preserves DecisionImport's exact pre-existing per-field error wording.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/parsing-helpers-verification.ts
 */

import { parseJsonObject } from "../src/domain/JsonParsing.ts";
import { deserializeReviewSession } from "../src/engines/review/serialization.ts";
import { deserializeWorkspaceSaveFile } from "../src/workspace/WorkspaceSaveFile.ts";
import { deserializeImportedDecisions } from "../src/io/DecisionImport.ts";
import { AUDIT_RECORD_SCHEMA_VERSION } from "../src/domain/AuditRecord.ts";

let passCount = 0;
let failCount = 0;

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passCount += 1;
    console.log(`  PASS ${label}`);
  } else {
    failCount += 1;
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

async function main(): Promise<void> {
  console.log("--- parseJsonObject: malformed JSON ---");
  {
    const result = parseJsonObject("{not json");
    check("malformed JSON is rejected", result.ok === false);
    check(
      "error wording matches the convention every deserializer already used",
      !result.ok && result.reason.startsWith("not valid JSON:")
    );
  }

  console.log("--- parseJsonObject: primitive top-level JSON ---");
  {
    const stringResult = parseJsonObject('"just a string"');
    check("a bare JSON string is rejected", stringResult.ok === false, JSON.stringify(stringResult));
    check("rejection reason is the shared 'expected a JSON object' wording", !stringResult.ok && stringResult.reason === "expected a JSON object");

    const numberResult = parseJsonObject("42");
    check("a bare JSON number is rejected", numberResult.ok === false);

    const boolResult = parseJsonObject("true");
    check("a bare JSON boolean is rejected", boolResult.ok === false);
  }

  console.log("--- parseJsonObject: null ---");
  {
    const result = parseJsonObject("null");
    check("JSON null is rejected", result.ok === false);
    check("rejection reason is the shared 'expected a JSON object' wording", !result.ok && result.reason === "expected a JSON object");
  }

  console.log("--- parseJsonObject: arrays are NOT rejected at this layer (preserved pre-existing behavior) ---");
  {
    // `typeof [] === "object"` and `[] !== null`, so an array always passed
    // every deserializer's own "is this an object" check before this
    // cleanup existed too -- only to be rejected moments later by each
    // caller's own schemaVersion check, each with its own wording. This
    // test documents that this cleanup pass did not change that.
    const result = parseJsonObject("[]");
    check("a bare JSON array passes parseJsonObject itself", result.ok === true, JSON.stringify(result));
    check("an array is returned as a plain value, structurally usable as a Record", result.ok === true && typeof result.value === "object");
  }

  console.log("--- parseJsonObject: valid object JSON ---");
  {
    const result = parseJsonObject('{"a": 1, "b": "two"}');
    check("a well-formed JSON object parses successfully", result.ok === true);
    check("parsed value round-trips correctly", result.ok === true && result.value["a"] === 1 && result.value["b"] === "two");
  }

  console.log("--- deserializeReviewSession: primitive/null/array top-level payloads, via the shared helper ---");
  {
    check("primitive top-level (\"hello\") is rejected", deserializeReviewSession('"hello"').ok === false);
    check("null top-level is rejected", deserializeReviewSession("null").ok === false);
    const arrayResult = deserializeReviewSession("[]");
    check(
      "array top-level is still rejected overall (via the schemaVersion check downstream of parseJsonObject, same as before this cleanup)",
      arrayResult.ok === false,
      JSON.stringify(arrayResult)
    );
    check(
      "array top-level's rejection reason is unchanged: missing schemaVersion, not a generic 'not an object' message",
      !arrayResult.ok && arrayResult.reason.includes("schemaVersion")
    );
  }

  console.log("--- deserializeWorkspaceSaveFile: primitive/null/array top-level payloads ---");
  {
    check("primitive top-level is rejected", deserializeWorkspaceSaveFile("42").ok === false);
    check("null top-level is rejected", deserializeWorkspaceSaveFile("null").ok === false);
    const arrayResult = deserializeWorkspaceSaveFile("[]");
    check("array top-level is still rejected overall", arrayResult.ok === false);
    check(
      "array top-level's rejection reason is unchanged: WorkspaceSaveFile's own schemaVersion wording",
      !arrayResult.ok && arrayResult.reason.startsWith("unsupported WorkspaceSaveFile schemaVersion:")
    );
  }

  console.log("--- deserializeImportedDecisions: primitive/null/array top-level payloads ---");
  {
    check("primitive top-level is rejected", deserializeImportedDecisions("true").ok === false);
    check("null top-level is rejected", deserializeImportedDecisions("null").ok === false);
    const arrayResult = deserializeImportedDecisions("[]");
    check("array top-level is still rejected overall", arrayResult.ok === false);
    check(
      "array top-level's rejection reason is unchanged: DecisionImport's own schemaVersion wording",
      !arrayResult.ok && arrayResult.reason.startsWith("unsupported decisions file schemaVersion:")
    );
    check("malformed JSON is rejected with the shared 'not valid JSON' wording", (() => {
      const r = deserializeImportedDecisions("{broken");
      return !r.ok && r.reason.startsWith("not valid JSON:");
    })());
  }

  console.log("--- DecisionImport requireString(): exact pre-existing per-field error wording preserved ---");
  {
    const base = {
      schemaVersion: AUDIT_RECORD_SCHEMA_VERSION,
      documentId: "doc-1",
      sessionId: "session-1",
      entityGroups: [] as unknown[],
      ambiguityResolutions: [] as unknown[],
    };

    const missingCandidateId = deserializeImportedDecisions(JSON.stringify({ ...base, candidates: [{ decision: "Keep" }] }));
    check(
      "candidate missing candidateId -- exact original wording preserved",
      !missingCandidateId.ok && missingCandidateId.reason === "candidates[0].candidateId missing or non-string"
    );

    const missingGroupId = deserializeImportedDecisions(
      JSON.stringify({
        ...base,
        candidates: [],
        entityGroups: [{ detectedType: "person", decision: "Confirmed", decidedAt: "t", confirmedMemberCandidateIds: [], wentThroughNotQuite: false }],
      })
    );
    check(
      "entityGroup missing groupId -- exact original wording preserved",
      !missingGroupId.ok && missingGroupId.reason === "entityGroups[0].groupId missing or non-string"
    );

    const withoutCanonicalName = deserializeImportedDecisions(
      JSON.stringify({
        ...base,
        candidates: [],
        entityGroups: [{ groupId: "g1", detectedType: "person", decision: "Confirmed", decidedAt: "t", confirmedMemberCandidateIds: [], wentThroughNotQuite: false }],
      })
    );
    check(
      "entityGroup canonicalName is no longer required in decisions schema v2",
      withoutCanonicalName.ok === true,
      JSON.stringify(withoutCanonicalName)
    );

    const missingDetectedType = deserializeImportedDecisions(
      JSON.stringify({
        ...base,
        candidates: [],
        entityGroups: [{ groupId: "g1", decision: "Confirmed", decidedAt: "t", confirmedMemberCandidateIds: [], wentThroughNotQuite: false }],
      })
    );
    check(
      "entityGroup missing detectedType -- exact original wording preserved",
      !missingDetectedType.ok && missingDetectedType.reason === "entityGroups[0].detectedType missing or non-string"
    );

    const missingGroupDecidedAt = deserializeImportedDecisions(
      JSON.stringify({
        ...base,
        candidates: [],
        entityGroups: [{ groupId: "g1", detectedType: "person", decision: "Confirmed", confirmedMemberCandidateIds: [], wentThroughNotQuite: false }],
      })
    );
    check(
      "entityGroup missing decidedAt -- exact original wording preserved",
      !missingGroupDecidedAt.ok && missingGroupDecidedAt.reason === "entityGroups[0].decidedAt missing or non-string"
    );

    const missingResolvedGroupId = deserializeImportedDecisions(
      JSON.stringify({ ...base, candidates: [], entityGroups: [], ambiguityResolutions: [{ candidateId: "c1", decidedAt: "t" }] })
    );
    check(
      "ambiguityResolution missing resolvedGroupId -- exact original wording preserved",
      !missingResolvedGroupId.ok && missingResolvedGroupId.reason === "ambiguityResolutions[0].resolvedGroupId missing or non-string"
    );

    const missingAmbiguityDecidedAt = deserializeImportedDecisions(
      JSON.stringify({ ...base, candidates: [], entityGroups: [], ambiguityResolutions: [{ candidateId: "c1", resolvedGroupId: "g1" }] })
    );
    check(
      "ambiguityResolution missing decidedAt -- exact original wording preserved",
      !missingAmbiguityDecidedAt.ok && missingAmbiguityDecidedAt.reason === "ambiguityResolutions[0].decidedAt missing or non-string"
    );

    // The two top-level checks (documentId/sessionId) were deliberately NOT
    // routed through requireString() -- different wording shape ("missing
    // or non-string documentId", field last not first) and only two
    // instances, not the ~8-times-repeated shape requireString targets.
    // Confirm they still read exactly as before.
    const missingDocumentId = deserializeImportedDecisions(
      JSON.stringify({ schemaVersion: AUDIT_RECORD_SCHEMA_VERSION, sessionId: "s", candidates: [], entityGroups: [], ambiguityResolutions: [] })
    );
    check(
      "top-level documentId check is untouched by this cleanup -- still its own distinct wording",
      !missingDocumentId.ok && missingDocumentId.reason === "missing or non-string documentId"
    );

    // Enum-valued fields (decision kinds) were deliberately NOT routed
    // through requireString() either -- they are not string-presence
    // checks, they are string-AND-membership checks with their own
    // "unrecognized" wording.
    const badDecision = deserializeImportedDecisions(
      JSON.stringify({ ...base, candidates: [{ candidateId: "c1", decision: "NotARealDecision" }] })
    );
    check(
      "an unrecognized decision kind still reports 'missing or unrecognized', not requireString's wording",
      !badDecision.ok && badDecision.reason.includes("missing or unrecognized")
    );
  }

  console.log("--- DecisionImport: valid payload still parses correctly through the refactored helpers ---");
  {
    const valid = JSON.stringify({
      schemaVersion: AUDIT_RECORD_SCHEMA_VERSION,
      documentId: "doc-1",
      sessionId: "session-1",
      candidates: [{ candidateId: "c1", decision: "Keep" }, { candidateId: "c2", decision: "Redact", replacement: "[REDACTED]", decidedAt: "2026-01-01T00:00:00.000Z" }],
      entityGroups: [{ groupId: "g1", detectedType: "person", decision: "Confirmed", decidedAt: "2026-01-01T00:00:00.000Z", confirmedMemberCandidateIds: ["c1"], wentThroughNotQuite: false }],
      ambiguityResolutions: [{ candidateId: "c3", resolvedGroupId: "g1", decidedAt: "2026-01-01T00:00:00.000Z" }],
    });
    const result = deserializeImportedDecisions(valid);
    check("a fully well-formed decisions.json still parses successfully", result.ok === true, JSON.stringify(result));
    if (result.ok) {
      check("candidates parsed correctly", result.decisions.candidates.length === 2 && result.decisions.candidates[0]?.candidateId === "c1");
      check("entityGroups parsed correctly", result.decisions.entityGroups.length === 1 && result.decisions.entityGroups[0]?.groupId === "g1");
      check("ambiguityResolutions parsed correctly", result.decisions.ambiguityResolutions.length === 1 && result.decisions.ambiguityResolutions[0]?.resolvedGroupId === "g1");
    }
  }

  console.log(`\n${passCount}/${passCount + failCount} checks passed`);
  process.exitCode = failCount === 0 ? 0 : 1;
}

main();
