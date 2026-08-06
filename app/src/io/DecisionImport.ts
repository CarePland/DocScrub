/**
 * DecisionImport — Feature 002. The deliberate inverse of
 * AuditExporter.ts's toDecisionsJson(): that function serializes review
 * state OUT to a decisions.json string; deserializeImportedDecisions()
 * below reads one back IN. Same "never throw, return a typed ok/reason
 * result" convention as every other parser in this codebase
 * (deserializeReviewSession, deserializeWorkspaceSaveFile,
 * deserializeFocusResumePosition) -- a malformed or foreign file should
 * produce a clear reviewer-facing message, not an uncaught exception.
 *
 * Deliberately lightweight structural validation, matching
 * deserializeWorkspaceSaveFile's own precedent: enough to catch a
 * truncated or hand-edited file before it reaches DecisionReuseEngine, not
 * a full schema validator (no dependency introduced for this).
 *
 * NOT documentId-gated. Unlike WorkspaceSaveFile's restore path (which
 * REJECTS a documentId mismatch outright, because there resuming a session
 * against the wrong document would silently corrupt candidateId
 * correspondence), an imported decisions file is EXPECTED to carry a
 * different documentId than the document currently being reviewed --
 * that's the entire premise of "review once, apply everywhere" across
 * document revisions. documentId is retained on the parsed result purely
 * for traceability (surfaced in the resulting DecisionReuseSummary), never
 * used as a validation gate here.
 */

import type { ImportedAmbiguityResolution, ImportedCandidateDecision, ImportedDecisionKind, ImportedDecisions, ImportedEntityGroup } from "../domain/DecisionReuse.js";
import { AUDIT_RECORD_SCHEMA_VERSION } from "../domain/AuditRecord.js";
import { parseJsonObject } from "../domain/JsonParsing.js";

export type ImportedDecisionsResult = { ok: true; decisions: ImportedDecisions } | { ok: false; reason: string };

const VALID_DECISION_KINDS: ReadonlySet<ImportedDecisionKind> = new Set(["Keep", "Rename", "Redact", "Ignore", "Undecided"]);
const VALID_GROUP_DECISIONS = new Set(["Confirmed", "Rejected", "Refined"]);

/** Local to this file, on purpose (Andrew's own scope note): the ~8 required
 *  string-field checks below all reduce to `${context}.${field} missing or
 *  non-string` -- confirmed identical by direct inspection, not the two
 *  differently-worded top-level `documentId`/`sessionId` checks in
 *  deserializeImportedDecisions() (those read `missing or non-string
 *  ${field}`, field first vs. last, and there are only two of them), which
 *  are deliberately left as-is rather than forced through this helper.
 *  `context` is the indexed path this record came from, e.g. `candidates[0]`. */
function requireString(record: Record<string, unknown>, field: string, context: string): { ok: true; value: string } | { ok: false; reason: string } {
  const value = record[field];
  if (typeof value !== "string") {
    return { ok: false, reason: `${context}.${field} missing or non-string` };
  }
  return { ok: true, value };
}

function parseCandidate(raw: unknown, index: number): { ok: true; value: ImportedCandidateDecision } | { ok: false; reason: string } {
  if (typeof raw !== "object" || raw === null) return { ok: false, reason: `candidates[${index}] is not an object` };
  const record = raw as Record<string, unknown>;
  const context = `candidates[${index}]`;
  const candidateId = requireString(record, "candidateId", context);
  if (!candidateId.ok) return candidateId;
  const decision = record["decision"];
  if (typeof decision !== "string" || !VALID_DECISION_KINDS.has(decision as ImportedDecisionKind)) {
    return { ok: false, reason: `${context}.decision missing or unrecognized: ${JSON.stringify(decision)}` };
  }
  const value: ImportedCandidateDecision = { candidateId: candidateId.value, decision: decision as ImportedDecisionKind };
  if (typeof record["replacement"] === "string") value.replacement = record["replacement"];
  if (typeof record["decidedAt"] === "string") value.decidedAt = record["decidedAt"];
  return { ok: true, value };
}

function parseEntityGroup(raw: unknown, index: number): { ok: true; value: ImportedEntityGroup } | { ok: false; reason: string } {
  if (typeof raw !== "object" || raw === null) return { ok: false, reason: `entityGroups[${index}] is not an object` };
  const record = raw as Record<string, unknown>;
  const context = `entityGroups[${index}]`;
  const groupId = requireString(record, "groupId", context);
  if (!groupId.ok) return groupId;
  // v2 (2026-08-04): `canonicalName` is no longer written (it carried a raw
  // personal name out of the app -- see AuditRecord's version note), so it
  // is no longer required on read. Not merely optional-ified: a v1 file is
  // rejected wholesale by the schemaVersion check above, so nothing reaching
  // here can legitimately carry the field.
  const detectedType = requireString(record, "detectedType", context);
  if (!detectedType.ok) return detectedType;
  const decision = record["decision"];
  if (typeof decision !== "string" || !VALID_GROUP_DECISIONS.has(decision)) {
    return { ok: false, reason: `${context}.decision missing or unrecognized: ${JSON.stringify(decision)}` };
  }
  const decidedAt = requireString(record, "decidedAt", context);
  if (!decidedAt.ok) return decidedAt;
  if (!Array.isArray(record["confirmedMemberCandidateIds"])) {
    return { ok: false, reason: `${context}.confirmedMemberCandidateIds missing or not an array` };
  }
  if (typeof record["wentThroughNotQuite"] !== "boolean") {
    return { ok: false, reason: `${context}.wentThroughNotQuite missing or non-boolean` };
  }
  return {
    ok: true,
    value: {
      groupId: groupId.value,
      detectedType: detectedType.value,
      decision: decision as ImportedEntityGroup["decision"],
      decidedAt: decidedAt.value,
      confirmedMemberCandidateIds: record["confirmedMemberCandidateIds"] as string[],
      wentThroughNotQuite: record["wentThroughNotQuite"],
    },
  };
}

function parseAmbiguityResolution(raw: unknown, index: number): { ok: true; value: ImportedAmbiguityResolution } | { ok: false; reason: string } {
  if (typeof raw !== "object" || raw === null) return { ok: false, reason: `ambiguityResolutions[${index}] is not an object` };
  const record = raw as Record<string, unknown>;
  const context = `ambiguityResolutions[${index}]`;
  const candidateId = requireString(record, "candidateId", context);
  if (!candidateId.ok) return candidateId;
  const resolvedGroupId = requireString(record, "resolvedGroupId", context);
  if (!resolvedGroupId.ok) return resolvedGroupId;
  const decidedAt = requireString(record, "decidedAt", context);
  if (!decidedAt.ok) return decidedAt;
  return { ok: true, value: { candidateId: candidateId.value, resolvedGroupId: resolvedGroupId.value, decidedAt: decidedAt.value } };
}

export function deserializeImportedDecisions(raw: string): ImportedDecisionsResult {
  const parsed = parseJsonObject(raw);
  if (!parsed.ok) return parsed;
  const record = parsed.value;

  const version = record["schemaVersion"];
  if (version !== AUDIT_RECORD_SCHEMA_VERSION) {
    return { ok: false, reason: `unsupported decisions file schemaVersion: ${JSON.stringify(version)} (expected ${AUDIT_RECORD_SCHEMA_VERSION})` };
  }
  if (typeof record["documentId"] !== "string") return { ok: false, reason: "missing or non-string documentId" };
  if (typeof record["sessionId"] !== "string") return { ok: false, reason: "missing or non-string sessionId" };
  if (!Array.isArray(record["candidates"])) return { ok: false, reason: "missing or non-array candidates" };
  if (!Array.isArray(record["entityGroups"])) return { ok: false, reason: "missing or non-array entityGroups" };
  if (!Array.isArray(record["ambiguityResolutions"])) return { ok: false, reason: "missing or non-array ambiguityResolutions" };

  const candidates: ImportedCandidateDecision[] = [];
  for (let i = 0; i < record["candidates"].length; i++) {
    const result = parseCandidate(record["candidates"][i], i);
    if (!result.ok) return result;
    candidates.push(result.value);
  }

  const entityGroups: ImportedEntityGroup[] = [];
  for (let i = 0; i < record["entityGroups"].length; i++) {
    const result = parseEntityGroup(record["entityGroups"][i], i);
    if (!result.ok) return result;
    entityGroups.push(result.value);
  }

  const ambiguityResolutions: ImportedAmbiguityResolution[] = [];
  for (let i = 0; i < record["ambiguityResolutions"].length; i++) {
    const result = parseAmbiguityResolution(record["ambiguityResolutions"][i], i);
    if (!result.ok) return result;
    ambiguityResolutions.push(result.value);
  }

  return {
    ok: true,
    decisions: {
      schemaVersion: version,
      documentId: record["documentId"],
      sessionId: record["sessionId"],
      candidates,
      entityGroups,
      ambiguityResolutions,
    },
  };
}
