/**
 * AuditExporter — architecture v0.2 §6.15, Gate D. Generates the audit
 * artifacts (redaction-log CSV, decisions-only JSON, metrics-only JSON,
 * and the full canonical audit report) from authoritative Workspace/
 * ReviewEngine outputs -- never by reconstructing decisions independently.
 *
 * PRODUCTION IMPLEMENTATION (Phase 11): DeterministicAuditExporter below is
 * real. It builds exactly ONE canonical `AuditRecord` (src/domain/
 * AuditRecord.ts -- read that file's own doc comment first for the full
 * set of explicit design decisions: schema, serialization format, ordering
 * guarantees, versioning, missing-optional-value handling, the relationship
 * to the rebuilt output, and whether generation is gated on verification).
 * Every one of the four returned strings is a DERIVED PROJECTION of that
 * one record -- assembled once, never recomputed four separate times.
 *
 * INTERFACE CORRECTION (same "objective interface defect" category as every
 * prior phase's DocumentRebuilder/OutputVerifier/CandidateQualityEngine/
 * EntityResolutionEngine fixes): the original signature took only
 * `(document, session, verification)` -- no way to know a candidate's
 * detected type, its occurrences, or an entity group's canonical name
 * (all of which live on DetectionResult/GroupingResult, not ReviewSession),
 * and no way to identify the OUTPUT document at all. Widened to
 * `(document, detection, grouping, session, verification, rebuiltOutput)`,
 * following the "document/detection first" parameter-ordering convention
 * already established by DocumentRebuilder.rebuild() and
 * OutputVerifier.verify(). Zero real call sites existed yet (AuditExporter
 * was a signature only before this phase), so this is a zero-impact fix.
 *
 * PYTHON ORACLE RESEARCH (see docs/detection/phase-11-findings.md for the
 * full writeup): Python's three export artifacts (`redactor/audit.py`'s
 * `write_audit_csv`, `redactor/qa_metrics.py`'s `build_qa_metrics`,
 * `redactor/decisions.py`'s `decisions_to_json`) were read directly, not
 * assumed. Two concrete, approved behavioral deviations came out of that
 * research:
 *
 *   1. Python's CSV embeds a raw ±70-character text window around every
 *      match (`Occurrence.context`, built by `context_snippet()`) PLUS the
 *      raw candidate text itself, on every row. This TS version's CSV
 *      projection carries neither -- only stable IDs, a type category, and
 *      decision metadata. Directly requested by Andrew's own instruction
 *      ("do not include source document content unnecessarily... minimize
 *      sensitive data in the audit report") and a genuine, not merely
 *      cosmetic, content-leak reduction versus the oracle's actual
 *      behavior.
 *   2. Python's QA-metrics JSON embeds each candidate's raw literal text
 *      (`candidate_records[].candidate_text`). This version's metrics
 *      projection omits it -- aggregate counts only.
 *
 *   One behavior WAS kept, deliberately: Python's `generate_outputs()`
 *   never blocks export on its post-write rescan's outcome -- audit
 *   generation there is unconditional, and verification is advisory,
 *   returned alongside the export rather than gating it. This exporter
 *   keeps that same non-blocking behavior (see AuditRecord.ts's own
 *   "Audit generation before successful verification" section for the one
 *   concrete improvement made on top of it: the verification outcome is
 *   never silently left off the record the way Python's on-disk files are).
 *
 * WRONG-DOCUMENT / WRONG-SESSION PROTECTION: `export()` rejects outright
 * (does not silently produce a mismatched record) if `session.documentId`
 * or a supplied `verification.documentId` does not match `document.
 * documentId` -- the same "reject a mismatch outright rather than silently
 * adopt it" principle Workspace's own documentId-gated session restore
 * already uses (see docs/detection/phase-10-findings.md, "Integration
 * assumption #2").
 *
 * FEATURE 001 UPDATE (first post-migration feature, group bulk actions):
 * flattenGroup deliberately produces the same EntityGroupDecision.decision
 * value ("Refined") completeNotQuite does, since the resulting session
 * state is equivalent -- but that broke buildEntityGroups()'s previous
 * `wentThroughNotQuite: decision === "Refined"` inference, which was only
 * ever correct because "Refined" had exactly one producer before this
 * feature. Fixed by deriving wentThroughNotQuite from the event log
 * instead (see wentThroughNotQuite() below) -- no AuditRecord schema
 * change was needed, since the distinction was always representable, it
 * was just being computed from the wrong signal.
 *
 * FEATURE 002 UPDATE (Decision Reuse): buildCandidates() now also surfaces
 * `source`/`wasImported`/`importEvidence` per candidate (see
 * AuditRecord.ts's own "FEATURE 002 UPDATE" note for the full three-way
 * distinction this enables). `wasImported` reuses the EXACT SAME "derive
 * from the event log, not the current snapshot" pattern
 * wentThroughNotQuite() already established for Feature 001 -- see
 * wasEverImported() below, which is deliberately structured as a close
 * sibling of wentThroughNotQuite() rather than a new approach, since an
 * override (like a Not-Quite re-decision) replaces the current value and
 * leaves no trace behind except in the append-only event log.
 */

import type { Candidate, DocumentModel } from "../domain/DocumentModel.js";
import type { DetectionResult } from "../engines/DetectionEngine.js";
import type { GroupingResult } from "../engines/EntityResolutionEngine.js";
import type { ReviewSession } from "../domain/ReviewSession.js";
import type { VerificationReport } from "../domain/VerificationReport.js";
import { candidateResolvedStatus } from "../engines/review/coverage.js";
import {
  AUDIT_RECORD_SCHEMA_VERSION,
  type AuditRecord,
  type AuditedAmbiguityResolution,
  type AuditedCandidate,
  type AuditedDecisionKind,
  type AuditedEntityGroup,
  type AuditOutputReference,
  type AuditVerificationSummary,
} from "../domain/AuditRecord.js";
import { sha256Hex } from "./hash.js";

export interface AuditArtifacts {
  csv: string;
  decisionsJson: string;
  qaMetricsJson: string;
  auditReport: string;
}

export interface AuditExporter {
  export(
    document: DocumentModel,
    detection: DetectionResult,
    grouping: GroupingResult,
    session: ReviewSession,
    verification: VerificationReport | null,
    rebuiltOutput: Blob | null
  ): Promise<AuditArtifacts>;
}

const APPLICATION_VERSION = "docscrub-web@phase-11";

/**
 * Was ANY decision-reuse import ever applied to this candidate, regardless
 * of whether the reviewer has since overridden it? Deliberately structured
 * as a close sibling of wentThroughNotQuite() below (same "walk the
 * append-only event log looking for a specific payload shape" technique),
 * not a new approach -- see this file's top "FEATURE 002 UPDATE" note.
 * Unlike wentThroughNotQuite() this does not stop at the first relevant
 * event: an override does not erase the historical fact that an import
 * happened at some point, so every "candidate-decided" event for this
 * candidateId must be checked, not just the most recent one.
 *
 * Exported (Milestone 3, Phase 4, "Imported Decision Visibility") so
 * app.ts's live candidate-row rendering can reuse this exact event-log walk
 * to distinguish "imported, unmodified" from "imported, then overridden
 * during this review" -- not a second implementation of it.
 */
export function wasEverImported(session: ReviewSession, candidateId: string): boolean {
  for (const event of session.events) {
    if (event.kind === "candidate-decided" && event.payload.candidateId === candidateId && event.payload.source === "imported") {
      return true;
    }
  }
  return false;
}

function buildCandidates(detection: DetectionResult, session: ReviewSession): AuditedCandidate[] {
  const occurrencesByCandidate = new Map<string, Array<{ occurrenceId: string; blockId: string }>>();
  for (const occ of detection.occurrences) {
    const list = occurrencesByCandidate.get(occ.candidateId) ?? [];
    list.push({ occurrenceId: occ.id, blockId: occ.blockId });
    occurrencesByCandidate.set(occ.candidateId, list);
  }

  const audited: AuditedCandidate[] = detection.candidates.map((candidate: Candidate) => {
    const decision = session.candidateDecisions[candidate.id];
    const status = candidateResolvedStatus(session, detection, candidate.id);
    const entry: AuditedCandidate = {
      candidateId: candidate.id,
      detectedType: candidate.detectedType,
      decision: (decision?.decision ?? "Undecided") as AuditedDecisionKind,
      wasImported: wasEverImported(session, candidate.id),
      occurrenceCount: candidate.occurrenceIds.length,
      occurrences: occurrencesByCandidate.get(candidate.id) ?? [],
      resolvedStatus: status.status,
    };
    if (decision?.replacement !== undefined) entry.replacement = decision.replacement;
    if (decision?.decidedAt !== undefined) entry.decidedAt = decision.decidedAt;
    if (decision !== undefined) entry.source = decision.source ?? "reviewer";
    if (decision?.importEvidence !== undefined) entry.importEvidence = decision.importEvidence;
    return entry;
  });

  audited.sort((a, b) => (a.candidateId < b.candidateId ? -1 : a.candidateId > b.candidateId ? 1 : 0));
  return audited;
}

/**
 * Was the group's CURRENT decision produced by a manual Not Quite
 * completion, as opposed to one of the group-level bulk commands (Feature
 * 001, terminology revised in v9: confirmGroup/redactGroup/ignoreGroup/
 * flattenGroup)? Before Feature 001, decision === "Refined" could only ever
 * mean "went through Not Quite" -- Refined
 * had exactly one producer (completeNotQuite). flattenGroup now ALSO
 * produces "Refined" (see session.ts's flattenGroup case: it deliberately
 * reuses that value because the resulting session state is the one a
 * manual Not-Quite-then-rename-every-member pass would produce), which
 * invalidates that inference. Rather than leave a now-inaccurate audit
 * claim in place, this walks the event log backward for the most recent
 * event that actually decided this group -- completeNotQuite emits
 * "not-quite-completed"; all three bulk commands emit "group-decided" --
 * and answers from that, not from the decision label alone.
 */
function wentThroughNotQuite(session: ReviewSession, groupId: string): boolean {
  for (let i = session.events.length - 1; i >= 0; i--) {
    const event = session.events[i]!;
    if (event.payload.groupId !== groupId) continue;
    if (event.kind === "not-quite-completed") return true;
    if (event.kind === "group-decided") return false;
  }
  return false;
}

function buildEntityGroups(grouping: GroupingResult, session: ReviewSession): AuditedEntityGroup[] {
  const proposalByGroupId = new Map(grouping.entityGroupProposals.map((p) => [p.groupId, p]));
  const groups: AuditedEntityGroup[] = Object.values(session.groupDecisions).map((decision) => {
    const proposal = proposalByGroupId.get(decision.groupId);
    return {
      groupId: decision.groupId,
      canonicalName: proposal?.canonicalName ?? decision.groupId,
      detectedType: proposal?.detectedType ?? "unknown",
      decision: decision.decision,
      decidedAt: decision.decidedAt,
      confirmedMemberCandidateIds: [...decision.confirmedMemberCandidateIds],
      wentThroughNotQuite: wentThroughNotQuite(session, decision.groupId),
    };
  });
  groups.sort((a, b) => (a.groupId < b.groupId ? -1 : a.groupId > b.groupId ? 1 : 0));
  return groups;
}

function buildAmbiguityResolutions(session: ReviewSession): AuditedAmbiguityResolution[] {
  const resolutions = Object.values(session.ambiguityResolutions).map((r) => ({
    candidateId: r.candidateId,
    resolvedGroupId: r.resolvedGroupId,
    decidedAt: r.decidedAt,
  }));
  resolutions.sort((a, b) => (a.candidateId < b.candidateId ? -1 : a.candidateId > b.candidateId ? 1 : 0));
  return resolutions;
}

function buildVerificationSummary(verification: VerificationReport | null): AuditVerificationSummary | null {
  if (verification === null) return null;
  return {
    schemaVersion: 1,
    verifiedAt: verification.verifiedAt,
    passed: verification.passed,
    rescanFoundOriginalValues: verification.rescanFoundOriginalValues,
    blockerFindingCount: verification.fidelityFindings.filter((f) => f.severity === "blocker").length,
    warningFindingCount: verification.fidelityFindings.filter((f) => f.severity === "warning").length,
    fidelityFindings: verification.fidelityFindings,
  };
}

async function buildOutputReference(rebuiltOutput: Blob | null): Promise<AuditOutputReference> {
  if (rebuiltOutput === null) return { available: false };
  const bytes = new Uint8Array(await rebuiltOutput.arrayBuffer());
  return { available: true, outputDocumentId: await sha256Hex(bytes) };
}

function toCsv(record: AuditRecord): string {
  const header = ["candidateId", "detectedType", "decision", "replacement", "occurrenceId", "blockId"];
  const rows: string[] = [header.join(",")];
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
  for (const candidate of record.candidates) {
    const base = [candidate.candidateId, candidate.detectedType, candidate.decision, candidate.replacement ?? ""];
    if (candidate.occurrences.length === 0) {
      rows.push([...base, "", ""].map(quote).join(","));
    } else {
      for (const occ of candidate.occurrences) {
        rows.push([...base, occ.occurrenceId, occ.blockId].map(quote).join(","));
      }
    }
  }
  return rows.join("\n");
}

function toDecisionsJson(record: AuditRecord): string {
  return JSON.stringify(
    {
      schemaVersion: record.schemaVersion,
      documentId: record.documentId,
      sessionId: record.sessionId,
      candidates: record.candidates.map((c) => ({
        candidateId: c.candidateId,
        decision: c.decision,
        ...(c.replacement !== undefined ? { replacement: c.replacement } : {}),
        ...(c.decidedAt !== undefined ? { decidedAt: c.decidedAt } : {}),
      })),
      entityGroups: record.entityGroups,
      ambiguityResolutions: record.ambiguityResolutions,
    },
    null,
    2
  );
}

function toQaMetricsJson(record: AuditRecord): string {
  return JSON.stringify(
    {
      schemaVersion: record.schemaVersion,
      documentId: record.documentId,
      fileName: record.fileName,
      generatedAt: record.generatedAt,
      summary: record.summary,
      verification: record.verification,
      readyForRelease: record.readyForRelease,
      hasOutstandingIssues: record.hasOutstandingIssues,
    },
    null,
    2
  );
}

export class DeterministicAuditExporter implements AuditExporter {
  async export(
    document: DocumentModel,
    detection: DetectionResult,
    grouping: GroupingResult,
    session: ReviewSession,
    verification: VerificationReport | null,
    rebuiltOutput: Blob | null
  ): Promise<AuditArtifacts> {
    if (session.documentId !== document.documentId) {
      throw new Error(
        `AuditExporter: session.documentId (${session.documentId}) does not match document.documentId (${document.documentId}) -- refusing to export a mismatched audit record.`
      );
    }
    if (verification !== null && verification.documentId !== document.documentId) {
      throw new Error(
        `AuditExporter: verification.documentId (${verification.documentId}) does not match document.documentId (${document.documentId}) -- refusing to export a mismatched audit record.`
      );
    }

    const candidates = buildCandidates(detection, session);
    const entityGroups = buildEntityGroups(grouping, session);
    const ambiguityResolutions = buildAmbiguityResolutions(session);
    const verificationSummary = buildVerificationSummary(verification);
    const output = await buildOutputReference(rebuiltOutput);

    const latestRevision = session.processingRevisions[session.processingRevisions.length - 1];
    if (!latestRevision) {
      throw new Error("AuditExporter: session has no ProcessingRevision -- cannot record pipeline configuration.");
    }

    const decisionCounts: Record<AuditedDecisionKind, number> = {
      Keep: 0,
      Rename: 0,
      Redact: 0,
      Ignore: 0,
      Undecided: 0,
    };
    let unresolvedCount = 0;
    for (const candidate of candidates) {
      decisionCounts[candidate.decision] += 1;
      if (candidate.resolvedStatus !== "resolved") unresolvedCount += 1;
    }

    const readyForRelease = verificationSummary !== null && verificationSummary.passed;

    const record: AuditRecord = {
      schemaVersion: AUDIT_RECORD_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      applicationVersion: APPLICATION_VERSION,
      documentId: document.documentId,
      fileName: document.fileName,
      sessionId: session.sessionId,
      sessionCreatedAt: session.createdAt,
      sessionUpdatedAt: session.updatedAt,
      pipelineConfiguration: {
        scoringProfile: latestRevision.scoringProfile,
        processingRevisionCount: session.processingRevisions.length,
      },
      candidates,
      entityGroups,
      ambiguityResolutions,
      summary: {
        totalCandidates: detection.candidates.length,
        decisionCounts,
        unresolvedCount,
      },
      verification: verificationSummary,
      output,
      readyForRelease,
      hasOutstandingIssues: unresolvedCount > 0 || !readyForRelease,
    };

    return {
      csv: toCsv(record),
      decisionsJson: toDecisionsJson(record),
      qaMetricsJson: toQaMetricsJson(record),
      auditReport: JSON.stringify(record, null, 2),
    };
  }
}
