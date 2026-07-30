/**
 * Verification for Feature 002 (Decision Reuse -- "Review once. Apply
 * everywhere."). Same property/behavior-suite spirit as review-engine-
 * verification.ts/group-bulk-actions-verification.ts: there is no Python
 * oracle for this (it is a new product feature, not a migration parity
 * concern), so this proves the properties Andrew's feature instruction
 * asked for directly.
 *
 * Two halves, matching precedent from review-engine-verification.ts (which
 * constructs DurableReviewEngine directly against a real fixture's
 * detection/grouping, rather than always going through Workspace) and
 * sequence-ratio-smoke.ts (which calls a pure engine function directly):
 *
 *   PART 1 -- engine-level: DeterministicDecisionReuseEngine.proposeReuse()
 *   called directly against REAL detection/grouping (loaded via the real
 *   DocumentParser -> DetectionEngine -> CandidateQualityEngine ->
 *   EntityResolutionEngine pipeline, exactly like review-engine-
 *   verification.ts's loadFixture()), with hand-constructed ImportedDecisions
 *   payloads. This is what lets the three matching tiers be tested at exact
 *   boundaries (the 0.90 similarity threshold, the 0.05 ambiguity margin,
 *   a deliberately conflicting grouped-alias case) that would be
 *   impractical to hit by chance in any real fixture's actual text.
 *
 *   PART 2 -- integration: the full ReviewWorkspace + WorkspaceCommandDispatcher
 *   stack, via document.importDecisions with real File objects, covering
 *   identical-document reuse, the never-overwrite-existing-decision rule,
 *   reviewer overrides, malformed/absent-document rejection, save/reload,
 *   audit's three-way provenance distinction, and output generation from
 *   imported decisions (Feature 001's own "DocumentRebuilder only reads
 *   candidateDecisions" correctness finding, now exercised for imported
 *   ones).
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/decision-reuse-verification.ts
 */

import { OoxmlDocumentParser } from "../src/io/DocumentParser.ts";
import { RegexDetectionEngine } from "../src/engines/DetectionEngine.ts";
import { RegexCandidateQualityEngine, buildDefaultScoringProfileSnapshot } from "../src/engines/CandidateQualityEngine.ts";
import { RegexEntityResolutionEngine } from "../src/engines/EntityResolutionEngine.ts";
import type { DetectionResult } from "../src/engines/DetectionEngine.ts";
import type { EntityGroupProposal, GroupingResult } from "../src/engines/EntityResolutionEngine.ts";
import { DeterministicDecisionReuseEngine } from "../src/engines/DecisionReuseEngine.ts";
import { sequenceRatio } from "../src/engines/entity-resolution/sequence-ratio.ts";
import type { ImportedDecisions } from "../src/domain/DecisionReuse.ts";

import { ReviewWorkspace } from "../src/workspace/Workspace.ts";
import { InMemorySessionRepository } from "./support/InMemorySessionRepository.ts";
import { WorkspaceCommandDispatcher } from "../src/workspace/CommandDispatcher.ts";
import { deserializeWorkspaceSaveFile } from "../src/workspace/WorkspaceSaveFile.ts";
import type { AuditRecord } from "../src/domain/AuditRecord.ts";
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
    return `2026-08-01T00:00:${String(tick).padStart(2, "0")}.000Z`;
  };
}

const FIXED_SCORING_TIMESTAMP = "2026-08-01T00:00:00.000Z";

interface Fixture {
  detection: DetectionResult;
  grouping: GroupingResult;
}

async function loadFixture(caseId: string): Promise<Fixture> {
  const file = loadSourceFile(caseId);
  const model = await new OoxmlDocumentParser().parse(file);
  const detection = new RegexDetectionEngine().detect(model);
  const profile = buildDefaultScoringProfileSnapshot(FIXED_SCORING_TIMESTAMP);
  const quality = new RegexCandidateQualityEngine().evaluate(model, detection, profile);
  const grouping = new RegexEntityResolutionEngine().propose(detection, quality);
  return { detection, grouping };
}

function emptyImported(overrides: Partial<ImportedDecisions> = {}): ImportedDecisions {
  return {
    schemaVersion: 1,
    documentId: "prior-document",
    sessionId: "prior-session",
    candidates: [],
    entityGroups: [],
    ambiguityResolutions: [],
    ...overrides,
  };
}

/** Mutates a normalized candidate key's text half by dropping/duplicating a
 *  character at `at`, keeping the type prefix intact -- used to engineer
 *  Tier 3 ratios at controlled distances from 1.0 rather than hoping a real
 *  fixture happens to contain a near-miss variant. */
function perturb(candidateId: string, at: number): string {
  const idx = candidateId.indexOf(":");
  const type = candidateId.slice(0, idx);
  const text = candidateId.slice(idx + 1);
  const mutated = text.slice(0, at) + text.slice(at + 1); // drop one character
  return `${type}:${mutated}`;
}

async function main(): Promise<void> {
  const engine = new DeterministicDecisionReuseEngine();

  console.log("--- Setup: load entity-resolution-001's real detection/grouping ---");
  const { detection, grouping } = await loadFixture("entity-resolution-001");
  check("fixture has real candidates", detection.candidates.length > 0);
  const realGroup = grouping.entityGroupProposals.find((g) => g.candidateIds.length >= 2);
  check("fixture has at least one real multi-member entity group", realGroup !== undefined);
  const personCandidate = detection.candidates.find((c) => c.detectedType === "person" && c.id.length > "person:".length + 6);
  check("fixture has a person candidate with a reasonably long normalized name (for perturbation tests)", personCandidate !== undefined);

  console.log("\n=== PART 1: DecisionReuseEngine.proposeReuse() -- engine-level tier tests ===\n");

  console.log("--- Tier 1: exact candidate-key match ---");
  {
    const target = detection.candidates[0]!;
    const imported = emptyImported({ candidates: [{ candidateId: target.id, decision: "Keep" }] });
    const proposals = engine.proposeReuse(detection, grouping, imported);
    const proposal = proposals.find((p) => p.candidateId === target.id);
    check("an exact candidateId match produces exactly one proposal for it", proposal !== undefined);
    check("Tier 1 is tagged exact-key", proposal?.evidence.tier === "exact-key");
    check("Tier 1 confidence is 100", proposal?.evidence.confidence === 100);
    check("Tier 1 carries the source decision (Keep)", proposal?.decision === "Keep");
    check("Tier 1 evidence names the matched imported candidateId", proposal?.evidence.matchedImportedCandidateId === target.id);
  }

  console.log("--- Tier 2: grouped-alias reuse from a Tier-1-matched sibling ---");
  if (realGroup) {
    const [first, ...rest] = realGroup.candidateIds;
    const imported = emptyImported({ candidates: [{ candidateId: first!, decision: "Redact", replacement: "[REDACTED PERSON]" }] });
    const proposals = engine.proposeReuse(detection, grouping, imported);
    check("the Tier-1-matched member itself gets an exact-key proposal", proposals.some((p) => p.candidateId === first && p.evidence.tier === "exact-key"));
    for (const siblingId of rest) {
      const proposal = proposals.find((p) => p.candidateId === siblingId);
      check(`ungrouped sibling ${siblingId} reuses the matched member's decision via grouped-alias`, proposal?.evidence.tier === "grouped-alias");
      check(`${siblingId}'s reused decision matches the sibling's (Redact/[REDACTED PERSON])`, proposal?.decision === "Redact" && proposal?.replacement === "[REDACTED PERSON]");
      check(`${siblingId}'s evidence names the real group`, proposal?.evidence.viaGroupId === realGroup.groupId);
      check(`${siblingId}'s grouped-alias confidence is 90`, proposal?.evidence.confidence === 90);
    }
  }

  console.log("--- Tier 2: conflicting sibling decisions are left unresolved (ambiguity guard) ---");
  {
    // Hand-built 3-member group using real candidateIds from different
    // fixture candidates -- proposeReuse() only reads GroupingResult's own
    // shape, so this does not need to be a group EntityResolutionEngine
    // actually produced; it only needs to look like one.
    const [a, b, c] = detection.candidates;
    check("fixture has at least 3 distinct candidates for the conflict scenario", !!a && !!b && !!c);
    if (a && b && c) {
      const conflictGroup: EntityGroupProposal = {
        groupId: "synthetic-conflict-group",
        candidateIds: [a.id, b.id, c.id],
        originalProposalConfidence: 80,
        canonicalName: "Synthetic Conflict Group",
        detectedType: a.detectedType,
        memberConfidences: {},
        reasons: [],
      };
      const syntheticGrouping: GroupingResult = { schemaVersion: 1, ambiguityProposals: [], entityGroupProposals: [conflictGroup] };
      const imported = emptyImported({
        candidates: [
          { candidateId: a.id, decision: "Keep" },
          { candidateId: b.id, decision: "Redact", replacement: "[REDACTED]" }, // disagrees with a
        ],
      });
      const proposals = engine.proposeReuse(detection, syntheticGrouping, imported);
      const cProposal = proposals.find((p) => p.candidateId === c.id);
      check("the unmatched third member gets NO proposal when its Tier-1-matched siblings disagree", cProposal === undefined);
      check("the two directly-matched members still get their own exact-key proposals", proposals.filter((p) => p.evidence.tier === "exact-key").length === 2);
    }
  }

  console.log("--- Tier 3: deterministic similarity threshold ---");
  if (personCandidate) {
    const idx = personCandidate.id.indexOf(":");
    const text = personCandidate.id.slice(idx + 1);

    // A single dropped character near the end produces a high ratio for
    // any reasonably long name -- computed via the SAME sequenceRatio()
    // this engine uses internally, so the test's own expectation is
    // grounded in the real algorithm, not a guess.
    const nearMiss = perturb(personCandidate.id, text.length - 1);
    const nearMissRatio = sequenceRatio(text, nearMiss.slice(nearMiss.indexOf(":") + 1));
    const imported = emptyImported({ candidates: [{ candidateId: nearMiss, decision: "Ignore" }] });
    const proposals = engine.proposeReuse(detection, grouping, imported);
    const proposal = proposals.find((p) => p.candidateId === personCandidate.id);
    if (nearMissRatio >= 0.9) {
      check(`a single-character-dropped variant (ratio ${nearMissRatio.toFixed(3)}) clears the threshold and matches via similarity-threshold`, proposal?.evidence.tier === "similarity-threshold");
      check("similarity-threshold confidence is the ratio scaled to 0-100", proposal?.evidence.confidence === Math.round(nearMissRatio * 100));
      check("similarity-threshold evidence carries the raw ratio", proposal?.evidence.similarityRatio === nearMissRatio);
    } else {
      check("(fixture's name too short for a clean above-threshold single-character test -- skipped, not a failure)", true);
    }

    console.log("--- Tier 3: a clearly different value never matches ---");
    const unrelated = emptyImported({ candidates: [{ candidateId: `${personCandidate.detectedType}:zzz totally unrelated qqq`, decision: "Keep" }] });
    const unrelatedProposals = engine.proposeReuse(detection, grouping, unrelated);
    check("an unrelated same-type candidate produces no proposal", unrelatedProposals.find((p) => p.candidateId === personCandidate.id) === undefined);

    console.log("--- Tier 3: cross-type text is never compared, even if normalized text would match ---");
    const wrongType = emptyImported({ candidates: [{ candidateId: `email:${text}`, decision: "Keep" }] });
    const wrongTypeProposals = engine.proposeReuse(detection, grouping, wrongType);
    check("identical normalized text under a DIFFERENT detected type never matches", wrongTypeProposals.find((p) => p.candidateId === personCandidate.id) === undefined);

    console.log("--- Tier 3: an ambiguous tie between two comparably-good candidates is left unresolved ---");
    const midA = perturb(personCandidate.id, Math.floor(text.length / 3));
    const midB = perturb(personCandidate.id, Math.floor((2 * text.length) / 3));
    const ratioA = sequenceRatio(text, midA.slice(midA.indexOf(":") + 1));
    const ratioB = sequenceRatio(text, midB.slice(midB.indexOf(":") + 1));
    const tieImported = emptyImported({
      candidates: [
        { candidateId: midA, decision: "Keep" },
        { candidateId: midB, decision: "Redact" },
      ],
    });
    const tieProposals = engine.proposeReuse(detection, grouping, tieImported);
    const tieProposal = tieProposals.find((p) => p.candidateId === personCandidate.id);
    if (ratioA >= 0.9 && ratioB >= 0.9 && Math.abs(ratioA - ratioB) < 0.05) {
      check(`two comparably-good matches (ratios ${ratioA.toFixed(3)}/${ratioB.toFixed(3)}) are left unresolved, not arbitrarily chosen`, tieProposal === undefined);
    } else {
      check("(fixture's name shape did not naturally produce a within-margin tie for this test -- skipped, not a failure)", true);
    }
  }

  console.log("--- Undecided imported entries and empty imports never produce proposals ---");
  {
    const undecidedOnly = emptyImported({ candidates: detection.candidates.map((c) => ({ candidateId: c.id, decision: "Undecided" as const })) });
    check("an ImportedDecisions full of Undecided entries produces zero proposals", engine.proposeReuse(detection, grouping, undecidedOnly).length === 0);
    check("a completely empty ImportedDecisions produces zero proposals", engine.proposeReuse(detection, grouping, emptyImported()).length === 0);
  }

  console.log("\n=== PART 2: Workspace.importDecisions() -- integration through the real stack ===\n");

  console.log("--- Building 'V1': a fully-reviewed prior session of the same fixture ---");
  const v1Workspace = new ReviewWorkspace({ clock: makeFixedClock(), sessionRepository: new InMemorySessionRepository() });
  const v1Dispatcher = new WorkspaceCommandDispatcher(v1Workspace);
  {
    const loadResult = await v1Dispatcher.dispatchApplication({ family: "document", type: "load", file: loadSourceFile("entity-resolution-001") });
    check("V1 loads the fixture", loadResult.ok === true, loadResult.reason);

    for (const stage of ["ambiguity-check", "item-check"] as const) {
      v1Dispatcher.dispatchNavigation({ family: "navigation", type: "focusStage", stage });
      let guard = 0;
      let state = v1Dispatcher.getState();
      let index = 0;
      while (state.stageStatuses.find((s) => s.stage === stage)!.unresolvedCount > 0 && guard < 100) {
        const itemId = state.focus?.target.itemId;
        if (!itemId) break;
        // Alternate decision kinds for real variety in the exported decisions.json.
        if (index % 3 === 0) v1Dispatcher.dispatchReview({ family: "review", type: "keepCandidate", candidateId: itemId });
        else if (index % 3 === 1) v1Dispatcher.dispatchReview({ family: "review", type: "renameCandidate", candidateId: itemId, replacement: `Redacted Alias ${index}` });
        else v1Dispatcher.dispatchReview({ family: "review", type: "redactCandidate", candidateId: itemId });
        state = v1Dispatcher.getState();
        index += 1;
        guard += 1;
      }
    }
    check("V1's review is fully complete", v1Dispatcher.getState().readiness.reviewComplete === true, `unresolved=${v1Dispatcher.getState().readiness.unresolvedItemCount}`);

    const auditResult = await v1Dispatcher.dispatchApplication({ family: "document", type: "generateAudit" });
    check("V1 generates its audit/decisions artifacts", auditResult.ok === true, auditResult.reason);
  }
  const v1DecisionsJson = v1Dispatcher.getLastAuditArtifacts()!.decisionsJson;
  check("V1 produced a non-empty decisions.json", typeof v1DecisionsJson === "string" && v1DecisionsJson.length > 0);
  const v1DecidedCandidateIds = Object.keys(v1Dispatcher.getState().reviewSession!.candidateDecisions);

  console.log("--- Identical document reuse: importing V1's decisions into a fresh session of the SAME fixture ---");
  const v2Workspace = new ReviewWorkspace({ clock: makeFixedClock(), sessionRepository: new InMemorySessionRepository() });
  const v2Dispatcher = new WorkspaceCommandDispatcher(v2Workspace);
  {
    const loadResult = await v2Dispatcher.dispatchApplication({ family: "document", type: "load", file: loadSourceFile("entity-resolution-001") });
    check("V2 loads a fresh session of the same fixture", loadResult.ok === true, loadResult.reason);
    check("V2 starts with zero decisions", Object.keys(v2Dispatcher.getState().reviewSession!.candidateDecisions).length === 0);

    const importFile = new File([v1DecisionsJson], "prior-decisions.json", { type: "application/json" });
    const importResult = await v2Dispatcher.dispatchApplication({ family: "document", type: "importDecisions", file: importFile });
    check("importing V1's decisions.json into V2 succeeds", importResult.ok === true, importResult.reason);

    const summary = v2Workspace.getLastDecisionReuseSummary();
    check("a DecisionReuseSummary is produced", summary !== null);
    check(
      "every one of V1's decided candidates was matched (identical document -> all exact-key)",
      summary?.proposalCount === v1DecidedCandidateIds.length,
      `proposalCount=${summary?.proposalCount} v1Decided=${v1DecidedCandidateIds.length}`
    );
    check("all matches on an identical document are Tier 1 (exact-key)", summary?.tierCounts["exact-key"] === v1DecidedCandidateIds.length);
    check("every matched proposal was actually applied (V2 started empty)", summary?.appliedCount === v1DecidedCandidateIds.length);
    check("nothing was skipped as already-decided", summary?.skippedAlreadyDecidedCount === 0);

    const v2State = v2Dispatcher.getState();
    for (const candidateId of v1DecidedCandidateIds) {
      const v1Decision = v1Dispatcher.getState().reviewSession!.candidateDecisions[candidateId]!;
      const v2Decision = v2State.reviewSession!.candidateDecisions[candidateId];
      check(
        `V2's reused decision for ${candidateId} matches V1's exactly (decision + replacement)`,
        v2Decision?.decision === v1Decision.decision && v2Decision?.replacement === v1Decision.replacement
      );
      check(`V2's reused decision for ${candidateId} is tagged source: "imported"`, v2Decision?.source === "imported");
      check(`V2's reused decision for ${candidateId} carries import evidence`, v2Decision?.importEvidence !== undefined);
    }
    check(
      "V2's review is complete immediately after import, with zero further manual action -- 'review once, apply everywhere'",
      v2State.readiness.reviewComplete === true,
      `unresolved=${v2State.readiness.unresolvedItemCount}`
    );
    check("Feature 002 intentional limitation: no group-level decisions were imported", Object.keys(v2State.reviewSession!.groupDecisions).length === 0);
  }

  console.log("--- Reviewer override of an imported decision ---");
  const overriddenCandidateId = v1DecidedCandidateIds[0]!;
  {
    const before = v2Dispatcher.getState().reviewSession!.candidateDecisions[overriddenCandidateId]!;
    check("the candidate is imported before the override", before.source === "imported");

    const overrideResult = v2Dispatcher.dispatchReview({ family: "review", type: "redactCandidate", candidateId: overriddenCandidateId, replacement: "Reviewer's Own Choice" });
    check("the reviewer's override command succeeds against a previously-imported candidate", overrideResult.ok === true, overrideResult.reason);

    const after = v2Dispatcher.getState().reviewSession!.candidateDecisions[overriddenCandidateId]!;
    check("after the override the decision reflects the reviewer's own choice", after.decision === "Redact" && after.replacement === "Reviewer's Own Choice");
    check("after the override source flips back to 'reviewer' -- plain overwrite, no special-case code", after.source === "reviewer");
    check("after the override importEvidence is gone -- a fresh CandidateDecision object carries none", after.importEvidence === undefined);

    const otherStillImported = v1DecidedCandidateIds.slice(1).every((id) => v2Dispatcher.getState().reviewSession!.candidateDecisions[id]?.source === "imported");
    check("every OTHER imported candidate is untouched by this one override", otherStillImported);
  }

  console.log("--- Never overwrites an existing decision (reviewer- or import-sourced) ---");
  {
    const v3Workspace = new ReviewWorkspace({ clock: makeFixedClock(), sessionRepository: new InMemorySessionRepository() });
    const v3Dispatcher = new WorkspaceCommandDispatcher(v3Workspace);
    const loadResult = await v3Dispatcher.dispatchApplication({ family: "document", type: "load", file: loadSourceFile("entity-resolution-001") });
    check("V3 loads a fresh session", loadResult.ok === true, loadResult.reason);

    const preDecidedId = v1DecidedCandidateIds[1]!;
    const manualResult = v3Dispatcher.dispatchReview({ family: "review", type: "redactCandidate", candidateId: preDecidedId, replacement: "Pre-Existing Manual Decision" });
    check("a manual decision is made before importing", manualResult.ok === true, manualResult.reason);

    const importFile = new File([v1DecisionsJson], "prior-decisions.json", { type: "application/json" });
    const importResult = await v3Dispatcher.dispatchApplication({ family: "document", type: "importDecisions", file: importFile });
    check("import succeeds even though V1's file has a conflicting decision for this candidate", importResult.ok === true, importResult.reason);

    const v3Decision = v3Dispatcher.getState().reviewSession!.candidateDecisions[preDecidedId]!;
    check("the pre-existing manual decision is UNTOUCHED by the import", v3Decision.decision === "Redact" && v3Decision.replacement === "Pre-Existing Manual Decision");
    check("its source remains 'reviewer', never overwritten to 'imported'", v3Decision.source === "reviewer");

    const summary = v3Workspace.getLastDecisionReuseSummary();
    check("the summary reports the pre-decided candidate as skipped, not applied", (summary?.skippedAlreadyDecidedCount ?? 0) >= 1);
    check(
      "every OTHER candidate (not pre-decided) was still imported normally",
      v1DecidedCandidateIds.filter((id) => id !== preDecidedId).every((id) => v3Dispatcher.getState().reviewSession!.candidateDecisions[id]?.source === "imported")
    );
  }

  console.log("--- Malformed / incompatible import files are rejected cleanly, never thrown ---");
  {
    const v4Workspace = new ReviewWorkspace({ clock: makeFixedClock(), sessionRepository: new InMemorySessionRepository() });
    const v4Dispatcher = new WorkspaceCommandDispatcher(v4Workspace);
    await v4Dispatcher.dispatchApplication({ family: "document", type: "load", file: loadSourceFile("entity-resolution-001") });

    const notJson = new File(["this is not json { { {"], "bad.json");
    const notJsonResult = await v4Dispatcher.dispatchApplication({ family: "document", type: "importDecisions", file: notJson });
    check("non-JSON file is rejected with a reason, not thrown", notJsonResult.ok === false && !!notJsonResult.reason);

    const wrongShape = new File([JSON.stringify({ foo: "bar" })], "wrong-shape.json");
    const wrongShapeResult = await v4Dispatcher.dispatchApplication({ family: "document", type: "importDecisions", file: wrongShape });
    check("a JSON file with the wrong shape is rejected with a reason", wrongShapeResult.ok === false && !!wrongShapeResult.reason);

    const wrongVersion = new File([JSON.stringify({ schemaVersion: 999, documentId: "d", sessionId: "s", candidates: [], entityGroups: [], ambiguityResolutions: [] })], "wrong-version.json");
    const wrongVersionResult = await v4Dispatcher.dispatchApplication({ family: "document", type: "importDecisions", file: wrongVersion });
    check("an unsupported schemaVersion is rejected with a reason", wrongVersionResult.ok === false && !!wrongVersionResult.reason);
  }

  console.log("--- Importing with no document loaded is rejected cleanly ---");
  {
    const bareWorkspace = new ReviewWorkspace({ clock: makeFixedClock(), sessionRepository: new InMemorySessionRepository() });
    const result = await bareWorkspace.importDecisions(new File([v1DecisionsJson], "x.json"));
    check("importDecisions before any document is loaded fails cleanly", result.ok === false && result.reason === "no document loaded");
  }

  console.log("--- An import with zero real matches succeeds harmlessly ---");
  {
    const v5Workspace = new ReviewWorkspace({ clock: makeFixedClock(), sessionRepository: new InMemorySessionRepository() });
    const v5Dispatcher = new WorkspaceCommandDispatcher(v5Workspace);
    await v5Dispatcher.dispatchApplication({ family: "document", type: "load", file: loadSourceFile("entity-resolution-001") });

    const alienDecisions: ImportedDecisions = emptyImported({
      documentId: "totally-unrelated-document",
      candidates: [{ candidateId: "person:nobody who ever appears here", decision: "Keep" }],
    });
    const alienFile = new File([JSON.stringify(alienDecisions)], "alien.json");
    const result = await v5Dispatcher.dispatchApplication({ family: "document", type: "importDecisions", file: alienFile });
    check("an import with no matching candidates still succeeds", result.ok === true, result.reason);
    const summary = v5Workspace.getLastDecisionReuseSummary();
    check("its summary reports zero proposals and zero applied", summary?.proposalCount === 0 && summary?.appliedCount === 0);
    check("no candidate decisions were created", Object.keys(v5Dispatcher.getState().reviewSession!.candidateDecisions).length === 0);
  }

  console.log("--- Save/reload equivalence for import-produced (and overridden) decisions ---");
  {
    const saveResult = await v2Dispatcher.dispatchApplication({ family: "document", type: "saveReviewSession" });
    check("saveReviewSession succeeds after import + override", saveResult.ok === true, saveResult.reason);
    const savedJson = v2Dispatcher.getLastSaveFile();
    check("a save file is produced", typeof savedJson === "string" && savedJson.length > 0);

    if (savedJson) {
      const deserialized = deserializeWorkspaceSaveFile(savedJson);
      check("the save file deserializes cleanly", deserialized.ok === true);
      if (deserialized.ok) {
        const reloadedWorkspace = new ReviewWorkspace({ clock: makeFixedClock(), sessionRepository: new InMemorySessionRepository() });
        const reloadedDispatcher = new WorkspaceCommandDispatcher(reloadedWorkspace);
        const restoreResult = await reloadedDispatcher.loadSavedSession(loadSourceFile("entity-resolution-001"), deserialized.saveFile);
        check("reloading restores the import-produced session", restoreResult.ok === true, restoreResult.reason);

        const reloadedDecisions = reloadedDispatcher.getState().reviewSession?.candidateDecisions;
        check(
          "reloaded candidateDecisions (including source/importEvidence) exactly match the saved session's",
          JSON.stringify(reloadedDecisions) === JSON.stringify(deserialized.saveFile.reviewSession.candidateDecisions)
        );
        const reloadedOverride = reloadedDecisions?.[overriddenCandidateId];
        check("the reloaded override still reads source: 'reviewer' with no importEvidence", reloadedOverride?.source === "reviewer" && reloadedOverride?.importEvidence === undefined);
        const reloadedStillImported = v1DecidedCandidateIds.slice(1).every((id) => reloadedDecisions?.[id]?.source === "imported");
        check("every other reloaded decision still reads source: 'imported'", reloadedStillImported);
      }
    }
  }

  console.log("--- Audit's three-way provenance distinction: reviewer / imported / reviewer-override-of-imported ---");
  {
    const auditResult = await v2Dispatcher.dispatchApplication({ family: "document", type: "generateAudit" });
    check("generateAudit succeeds on V2 (import + one override)", auditResult.ok === true, auditResult.reason);
    const artifacts = v2Dispatcher.getLastAuditArtifacts();
    check("audit artifacts are produced", artifacts !== null);

    if (artifacts) {
      const record = JSON.parse(artifacts.auditReport) as AuditRecord;

      const untouchedImported = record.candidates.find((c) => c.candidateId === v1DecidedCandidateIds[2]);
      check("an untouched imported candidate reads source: 'imported'", untouchedImported?.source === "imported");
      check("...and wasImported: true", untouchedImported?.wasImported === true);
      check("...and carries importEvidence", untouchedImported?.importEvidence !== undefined);

      const overridden = record.candidates.find((c) => c.candidateId === overriddenCandidateId);
      check("the reviewer-overridden candidate reads source: 'reviewer' (its CURRENT decision)", overridden?.source === "reviewer");
      check("...but wasImported: true (the historical fact survives the override)", overridden?.wasImported === true);
      check("...and importEvidence is absent (no evidence for a decision the reviewer actually made)", overridden?.importEvidence === undefined);

      const neverImported = record.candidates.find((c) => !v1DecidedCandidateIds.includes(c.candidateId) && c.decision !== "Undecided");
      if (neverImported) {
        check("a candidate never touched by import shows wasImported: false", neverImported.wasImported === false);
      }

      check("no raw candidate text leaks into the audit report via the new fields either", !artifacts.auditReport.includes("Andrew Jackson"));
      check("decisions.json re-export stays minimal -- does not carry source/wasImported/importEvidence forward", !artifacts.decisionsJson.includes('"source"') && !artifacts.decisionsJson.includes('"wasImported"'));
    }
  }

  console.log("--- Output generation from imported decisions (Feature 001's DocumentRebuilder correctness finding, now for imports) ---");
  {
    const t0 = Date.now();
    const generateResult = await v2Dispatcher.dispatchApplication({ family: "document", type: "generateOutput" });
    const elapsedMs = Date.now() - t0;
    check("generateOutput succeeds against a session built entirely from import + one override", generateResult.ok === true, generateResult.reason);
    check("generateOutput does not hang", elapsedMs < 5000, `elapsedMs=${elapsedMs}`);

    const state = v2Dispatcher.getState();
    check("verification is current immediately after generating", state.readiness.verificationCurrent === true);
    if (state.verification && state.verification.passed === false) {
      check("if verification fails, it is never silent -- at least one FidelityFinding explains why", state.verification.fidelityFindings.length > 0);
    }
  }

  console.log(`\n${passCount}/${passCount + failCount} checks passed`);
  process.exitCode = failCount === 0 ? 0 : 1;
}

main();
