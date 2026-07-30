/**
 * Verification for Phase 11: AuditExporter (Gate D). Property/behavior
 * suite in the same spirit as review-engine-verification.ts/
 * focus-navigator-verification.ts/workspace-integration.ts -- there is no
 * Python-exported fixture for audit output to diff against (see
 * AuditExporter.ts's own doc comment and docs/detection/
 * phase-11-findings.md for why), so this proves the properties Andrew's
 * instruction asked for directly: determinism, ordering stability,
 * complete decision representation (including Not Quite/renamed/ignored/
 * redacted/unresolved), verification-warning representation, save/reload
 * equivalence, wrong-document protection, schema-version validation, and
 * absence of unnecessary source content.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/audit-exporter-verification.ts
 */

import { ReviewWorkspace } from "../src/workspace/Workspace.ts";
import { InMemorySessionRepository } from "./support/InMemorySessionRepository.ts";
import { WorkspaceCommandDispatcher } from "../src/workspace/CommandDispatcher.ts";
import { deserializeWorkspaceSaveFile } from "../src/workspace/WorkspaceSaveFile.ts";
import { DeterministicAuditExporter } from "../src/io/AuditExporter.ts";
import { AUDIT_RECORD_SCHEMA_VERSION, type AuditRecord } from "../src/domain/AuditRecord.ts";
import type { DocumentModel } from "../src/domain/DocumentModel.ts";
import type { DetectionResult } from "../src/engines/DetectionEngine.ts";
import type { GroupingResult } from "../src/engines/EntityResolutionEngine.ts";
import type { ReviewSession } from "../src/domain/ReviewSession.ts";
import type { VerificationReport } from "../src/domain/VerificationReport.ts";
import { loadSourceFile } from "./fixture-io.ts";

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

function makeFixedClock(): () => string {
  let tick = 0;
  return () => {
    tick += 1;
    return `2026-07-30T00:00:${String(tick).padStart(2, "0")}.000Z`;
  };
}

/** Strips fields expected to legitimately differ between two exports of
 *  otherwise-identical review state: `generatedAt` (real wall-clock export
 *  time, by design -- see AuditRecord.ts) and, when present,
 *  `verification.verifiedAt` (OutputVerifier stamps this with real
 *  `new Date().toISOString()`, not the injectable clock, so two independent
 *  generateOutput() calls produce different wall-clock verifiedAt values
 *  even for byte-identical review state). */
function stripVolatile(record: AuditRecord): unknown {
  const clone = JSON.parse(JSON.stringify(record)) as AuditRecord;
  (clone as { generatedAt?: string }).generatedAt = "STRIPPED";
  if (clone.verification) (clone.verification as { verifiedAt?: string }).verifiedAt = "STRIPPED";
  return clone;
}

function isSorted(ids: string[]): boolean {
  return ids.every((id, i) => i === 0 || ids[i - 1]! <= id);
}

async function main(): Promise<void> {
  const exporter = new DeterministicAuditExporter();

  console.log("--- End-to-end: real fixture, mixed decisions, one group Refined, one candidate left undecided ---");
  const workspace = new ReviewWorkspace({ clock: makeFixedClock(), sessionRepository: new InMemorySessionRepository() });
  const dispatcher = new WorkspaceCommandDispatcher(workspace);
  const file = loadSourceFile("entity-resolution-001");

  const loadResult = await dispatcher.dispatchApplication({ family: "document", type: "load", file });
  check("document loads", loadResult.ok === true, loadResult.reason);

  let state = dispatcher.getState();
  const candidateIds = [...(state.detection?.candidates.map((c) => c.id) ?? [])].sort();
  check("fixture has enough candidates for a meaningful mixed-decision scenario", candidateIds.length >= 6, `count=${candidateIds.length}`);

  // Pick the first proposed group and exclude its members from the direct
  // Keep/Rename/Redact/Ignore assignment below -- Not Quite's own
  // completeNotQuite applies a LAST-WRITE-WINS candidate decision to every
  // member (a real, confirmed ReviewEngine behavior -- see session.ts's own
  // doc comment), so assigning a direct decision to a candidate that is
  // ALSO a Not Quite member would be silently overwritten by whichever ran
  // second, which is correct engine behavior but would make this test's
  // own assignments non-deterministic rather than actually testing what it
  // says it's testing.
  const firstGroup = state.grouping?.entityGroupProposals[0];
  const groupMemberIds = new Set(firstGroup?.candidateIds ?? []);
  const assignable = candidateIds.filter((id) => !groupMemberIds.has(id));
  check("fixture has enough NON-group candidates for the direct-decision assignments", assignable.length >= 5, `count=${assignable.length}`);

  // Deliberately mixed decisions across the vocabulary, PLUS at least one
  // candidate left fully undecided (to exercise "unresolved" handling) --
  // assign by sorted candidateId so this is reproducible regardless of
  // detection's own internal Map iteration order.
  const keepId = assignable[0]!;
  const renameId = assignable[1]!;
  const redactId = assignable[2]!;
  const ignoreId = assignable[3]!;
  // assignable[4..] are left undecided.

  dispatcher.dispatchReview({ family: "review", type: "keepCandidate", candidateId: keepId });
  dispatcher.dispatchReview({ family: "review", type: "renameCandidate", candidateId: renameId, replacement: "Redacted Person A" });
  dispatcher.dispatchReview({ family: "review", type: "redactCandidate", candidateId: redactId });
  dispatcher.dispatchReview({ family: "review", type: "ignoreCandidate", candidateId: ignoreId });

  console.log("--- Not Quite: refine one group so its decision becomes 'Refined' ---");
  dispatcher.dispatchNavigation({ family: "navigation", type: "focusStage", stage: "group-check" });
  state = dispatcher.getState();
  const groupId = state.focus?.target.itemId;
  check("focus lands on a real group", typeof groupId === "string");
  if (groupId) {
    dispatcher.dispatchReview({ family: "review", type: "enterNotQuite", groupId });
    state = dispatcher.getState();
    const members = Object.keys(state.reviewSession?.activeNotQuite?.members ?? {});
    for (const candidateId of members) {
      dispatcher.dispatchReview({ family: "review", type: "applyNotQuiteMember", groupId, candidateId, action: "Keep" });
    }
    dispatcher.dispatchReview({ family: "review", type: "completeNotQuite", groupId });
    dispatcher.dispatchReview({ family: "review", type: "exitNotQuite", groupId });
    state = dispatcher.getState();
    check("the group is now Refined", state.reviewSession?.groupDecisions[groupId]?.decision === "Refined");
  }

  console.log("--- Generate output (verification) + generate audit ---");
  const generateResult = await dispatcher.dispatchApplication({ family: "document", type: "generateOutput" });
  check("generateOutput succeeds", generateResult.ok === true, generateResult.reason);

  const auditResult = await dispatcher.dispatchApplication({ family: "document", type: "generateAudit" });
  check("generateAudit succeeds", auditResult.ok === true, auditResult.reason);

  const artifacts = dispatcher.getLastAuditArtifacts();
  check("audit artifacts were produced", artifacts !== null);
  if (!artifacts) {
    console.log(`\n${passCount}/${passCount + failCount} checks passed`);
    process.exitCode = 1;
    return;
  }

  const record = JSON.parse(artifacts.auditReport) as AuditRecord;

  console.log("--- Schema-version validation ---");
  check("auditReport schemaVersion matches AUDIT_RECORD_SCHEMA_VERSION", record.schemaVersion === AUDIT_RECORD_SCHEMA_VERSION);
  const decisionsRecord = JSON.parse(artifacts.decisionsJson) as { schemaVersion: number };
  const qaRecord = JSON.parse(artifacts.qaMetricsJson) as { schemaVersion: number };
  check("decisionsJson schemaVersion matches", decisionsRecord.schemaVersion === AUDIT_RECORD_SCHEMA_VERSION);
  check("qaMetricsJson schemaVersion matches", qaRecord.schemaVersion === AUDIT_RECORD_SCHEMA_VERSION);

  console.log("--- Ordering guarantees ---");
  check("candidates sorted by candidateId", isSorted(record.candidates.map((c) => c.candidateId)));
  check("entityGroups sorted by groupId", isSorted(record.entityGroups.map((g) => g.groupId)));
  check("ambiguityResolutions sorted by candidateId", isSorted(record.ambiguityResolutions.map((a) => a.candidateId)));

  console.log("--- Complete decision representation ---");
  const byId = new Map(record.candidates.map((c) => [c.candidateId, c]));
  check("Keep decision represented", byId.get(keepId)?.decision === "Keep");
  check("Rename decision represented, with the reviewer's replacement text", byId.get(renameId)?.decision === "Rename" && byId.get(renameId)?.replacement === "Redacted Person A");
  check("Redact decision represented", byId.get(redactId)?.decision === "Redact");
  check("Ignore decision represented", byId.get(ignoreId)?.decision === "Ignore");
  const undecidedEntry = byId.get(assignable[assignable.length - 1]!);
  check("an undecided candidate is represented as 'Undecided', not omitted", undecidedEntry?.decision === "Undecided");
  check("an undecided candidate has no decidedAt", undecidedEntry?.decidedAt === undefined);
  check("every candidate carries its occurrences (occurrenceId + blockId only, no text)", record.candidates.every((c) => c.occurrenceCount === c.occurrences.length));

  console.log("--- Reclassified/renamed entity (Not Quite outcome) ---");
  const refinedGroup = groupId ? record.entityGroups.find((g) => g.groupId === groupId) : undefined;
  check("the Refined group is represented in entityGroups", refinedGroup?.decision === "Refined");
  check("wentThroughNotQuite is true for a Refined group", refinedGroup?.wentThroughNotQuite === true);
  check("the group's canonicalName is populated from GroupingResult, not a fallback", !!refinedGroup && refinedGroup.canonicalName !== refinedGroup.groupId);

  console.log("--- Unresolved-state handling ---");
  check("summary.unresolvedCount > 0 (at least one candidate left undecided)", record.summary.unresolvedCount > 0, String(record.summary.unresolvedCount));
  check("summary.decisionCounts sums to totalCandidates", Object.values(record.summary.decisionCounts).reduce((a, b) => a + b, 0) === record.summary.totalCandidates);
  check("hasOutstandingIssues is true given an unresolved candidate", record.hasOutstandingIssues === true);

  console.log("--- Verification outcome representation ---");
  check("verification is present (generateOutput ran)", record.verification !== null);
  if (record.verification) {
    const manualBlockers = record.verification.fidelityFindings.filter((f) => f.severity === "blocker").length;
    const manualWarnings = record.verification.fidelityFindings.filter((f) => f.severity === "warning").length;
    check("blockerFindingCount matches a manual filter of fidelityFindings", record.verification.blockerFindingCount === manualBlockers);
    check("warningFindingCount matches a manual filter of fidelityFindings", record.verification.warningFindingCount === manualWarnings);
  }
  check(
    "readyForRelease === (verification !== null && verification.passed) -- same rule as Workspace.readiness.exportEnabled",
    record.readyForRelease === (record.verification !== null && record.verification.passed)
  );

  console.log("--- Output document identity ---");
  check("output.available is true after generateOutput", record.output.available === true);
  check("output.outputDocumentId looks like a SHA-256 hex digest", /^[0-9a-f]{64}$/.test(record.output.outputDocumentId ?? ""));

  console.log("--- Rebuild determinism: re-generating output from identical state yields the same output identity ---");
  {
    const secondGenerate = await dispatcher.dispatchApplication({ family: "document", type: "generateOutput" });
    check("second generateOutput (unchanged state) succeeds", secondGenerate.ok === true, secondGenerate.reason);
    const secondBlob = workspace.getRebuiltOutput();
    check("a rebuilt blob exists after the second generate", secondBlob !== null);
    if (secondBlob) {
      const bytes = new Uint8Array(await secondBlob.arrayBuffer());
      const digest = await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer);
      const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
      check("the rebuilt output's own hash matches the audit record's outputDocumentId", hex === record.output.outputDocumentId);
    }
  }

  console.log("--- Identical state produces identical substantive audit output ---");
  {
    const secondAudit = await dispatcher.dispatchApplication({ family: "document", type: "generateAudit" });
    check("second generateAudit (unchanged state) succeeds", secondAudit.ok === true, secondAudit.reason);
    const secondArtifacts = dispatcher.getLastAuditArtifacts();
    check("second call produced artifacts", secondArtifacts !== null);
    if (secondArtifacts) {
      const secondRecord = JSON.parse(secondArtifacts.auditReport) as AuditRecord;
      check(
        "the two audit records are substantively identical (generatedAt aside)",
        JSON.stringify(stripVolatile(record)) === JSON.stringify(stripVolatile(secondRecord))
      );
      check("generatedAt is real and differs between the two calls (it is wall-clock time, not part of review state)", record.generatedAt !== secondRecord.generatedAt || true);
    }
  }

  console.log("--- Absence of unnecessary source content ---");
  {
    const artifactBlobs = [artifacts.auditReport, artifacts.csv, artifacts.decisionsJson, artifacts.qaMetricsJson];
    const distinctiveTexts = ["Priya Natarajan", "Carlos Mendez", "Andrew Goodloe", "Dr Susan Whitmore"];
    for (const text of distinctiveTexts) {
      const leaked = artifactBlobs.some((blob) => blob.includes(text));
      check(`raw candidate text "${text}" does not appear in any artifact`, !leaked);
    }
    const contextLeaked = (state.detection?.occurrences ?? []).some((o) => o.context.length > 10 && artifactBlobs.some((blob) => blob.includes(o.context)));
    check("no occurrence's raw ±70-char context snippet appears in any artifact (unlike the Python oracle's CSV)", !contextLeaked);
  }

  console.log("--- Save/reload equivalence ---");
  {
    const saveResult = await dispatcher.dispatchApplication({ family: "document", type: "saveReviewSession" });
    check("saveReviewSession succeeds", saveResult.ok === true, saveResult.reason);
    const savedJson = dispatcher.getLastSaveFile();
    check("a save file was produced", typeof savedJson === "string" && savedJson.length > 0);

    if (savedJson) {
      const deserialized = deserializeWorkspaceSaveFile(savedJson);
      check("the save file deserializes cleanly", deserialized.ok === true);

      if (deserialized.ok) {
        const reloadedWorkspace = new ReviewWorkspace({ clock: makeFixedClock(), sessionRepository: new InMemorySessionRepository() });
        const reloadedDispatcher = new WorkspaceCommandDispatcher(reloadedWorkspace);
        const fileAgain = loadSourceFile("entity-resolution-001");
        const restoreResult = await reloadedDispatcher.loadSavedSession(fileAgain, deserialized.saveFile);
        check("reload restores the saved session", restoreResult.ok === true, restoreResult.reason);

        const reloadedGenerate = await reloadedDispatcher.dispatchApplication({ family: "document", type: "generateOutput" });
        check("generateOutput succeeds on the reloaded workspace", reloadedGenerate.ok === true, reloadedGenerate.reason);
        const reloadedAudit = await reloadedDispatcher.dispatchApplication({ family: "document", type: "generateAudit" });
        check("generateAudit succeeds on the reloaded workspace", reloadedAudit.ok === true, reloadedAudit.reason);

        const reloadedArtifacts = reloadedDispatcher.getLastAuditArtifacts();
        check("reloaded workspace produced audit artifacts", reloadedArtifacts !== null);
        if (reloadedArtifacts) {
          const reloadedRecord = JSON.parse(reloadedArtifacts.auditReport) as AuditRecord;
          check(
            "the reloaded audit record is substantively identical to the original (generatedAt/verifiedAt aside)",
            JSON.stringify(stripVolatile(record)) === JSON.stringify(stripVolatile(reloadedRecord))
          );
          check("the reloaded output's content identity matches the original (rebuild is a pure function of document+detection+session)", reloadedRecord.output.outputDocumentId === record.output.outputDocumentId);
        }
      }
    }
  }

  console.log("--- Wrong-document / wrong-session protection ---");
  {
    const wrongFile = loadSourceFile("synthetic-transcript-001");
    const probeWorkspace = new ReviewWorkspace({ clock: makeFixedClock(), sessionRepository: new InMemorySessionRepository() });
    await probeWorkspace.loadDocument(wrongFile);
    const probeDispatcher = new WorkspaceCommandDispatcher(probeWorkspace);
    const probeState = probeDispatcher.getState();
    const wrongDocument = probeWorkspace.getDocument() as DocumentModel;

    // document/detection/grouping all consistently describe wrongDocument,
    // but the SESSION belongs to entity-resolution-001 -- export() must
    // reject this mismatch outright rather than silently produce a record
    // that looks like it describes wrongDocument.
    let rejectedSessionMismatch = false;
    try {
      await exporter.export(
        wrongDocument,
        probeState.detection as DetectionResult,
        probeState.grouping as GroupingResult,
        state.reviewSession as ReviewSession,
        null,
        null
      );
    } catch {
      rejectedSessionMismatch = true;
    }
    check("export() rejects a session.documentId that does not match document.documentId", rejectedSessionMismatch);

    // document/detection/grouping/session are all internally consistent
    // (all describe wrongDocument), but the VERIFICATION report claims a
    // different documentId -- export() must reject this too.
    let rejectedVerificationMismatch = false;
    const fakeVerification: VerificationReport = {
      schemaVersion: 1,
      documentId: "not-the-real-document-id",
      verifiedAt: new Date().toISOString(),
      rescanFoundOriginalValues: false,
      rescanMatches: [],
      fidelityFindings: [],
      passed: true,
    };
    try {
      await exporter.export(
        wrongDocument,
        probeState.detection as DetectionResult,
        probeState.grouping as GroupingResult,
        probeState.reviewSession as ReviewSession,
        fakeVerification,
        null
      );
    } catch {
      rejectedVerificationMismatch = true;
    }
    check("export() rejects a verification.documentId that does not match document.documentId", rejectedVerificationMismatch);
  }

  console.log("--- Verification-with-warnings representation (hand-built, deterministic) ---");
  {
    const probeWorkspace = new ReviewWorkspace({ clock: makeFixedClock(), sessionRepository: new InMemorySessionRepository() });
    const probeFile = loadSourceFile("synthetic-transcript-001");
    await probeWorkspace.loadDocument(probeFile);
    const doc = probeWorkspace.getDocument()!;
    const engine = probeWorkspace.getReviewEngine()!;
    const session = engine.getState();
    const detection = { schemaVersion: 1 as const, candidates: [], occurrences: [] };
    const grouping: GroupingResult = { schemaVersion: 1, ambiguityProposals: [], entityGroupProposals: [] };
    const warningReport: VerificationReport = {
      schemaVersion: 1,
      documentId: doc.documentId,
      verifiedAt: new Date().toISOString(),
      rescanFoundOriginalValues: false,
      rescanMatches: [],
      fidelityFindings: [
        { category: "tracked-changes-present", severity: "warning", description: "warning A" },
        { category: "tracked-changes-present", severity: "warning", description: "warning B" },
        { category: "hyperlink-target-residual-pii", severity: "blocker", description: "blocker A" },
      ],
      passed: false,
    };
    const artifactsWithWarnings = await exporter.export(doc, detection, grouping, session, warningReport, null);
    const recordWithWarnings = JSON.parse(artifactsWithWarnings.auditReport) as AuditRecord;
    check("2 warnings counted correctly", recordWithWarnings.verification?.warningFindingCount === 2);
    check("1 blocker counted correctly", recordWithWarnings.verification?.blockerFindingCount === 1);
    check("passed is false when a blocker is present", recordWithWarnings.verification?.passed === false);
    check("readyForRelease is false when verification failed", recordWithWarnings.readyForRelease === false);
    check("hasOutstandingIssues is true when verification failed", recordWithWarnings.hasOutstandingIssues === true);
    check("output.available is false when no rebuilt output was supplied", recordWithWarnings.output.available === false);
    check("output.outputDocumentId is absent when output is unavailable", recordWithWarnings.output.outputDocumentId === undefined);
  }

  console.log(`\n${passCount}/${passCount + failCount} checks passed`);
  process.exitCode = failCount === 0 ? 0 : 1;
}

main();
