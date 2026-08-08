/**
 * Verification for Milestone 3 ("Reviewer Productivity"). Same
 * property/behavior-suite spirit as every prior no-Python-oracle suite in
 * this project (review-engine-verification.ts, focus-navigator-
 * verification.ts, group-bulk-actions-verification.ts, decision-reuse-
 * verification.ts, explanation-engine-verification.ts,
 * milestone-2-review-at-scale-verification.ts) -- LocalSessionRepository,
 * ReplacementRuleEngine, and Imported Decision Visibility are all new,
 * browser-native reviewer-productivity tools with no Python oracle to diff
 * against (Python's own reviewer app has no autosave, no configurable
 * replacement rules, and a much thinner "(Imported)"-only distinction).
 *
 * Part 1 -- LocalSessionRepository, exercised against InMemorySessionRepository
 * (support/InMemorySessionRepository.ts) directly, no ReviewWorkspace
 * involved: save/load round-trip, load()'s lastOpenedAt-touch side effect,
 * delete, listRecent ordering (most-recently-opened first) and its `limit`
 * parameter, completionPercent derivation (including the 0-candidates
 * edge case), and isValidSessionRecord's graceful rejection of malformed
 * records (LocalSessionRepository.ts's "graceful handling of interrupted
 * sessions" contract).
 *
 * Part 2 -- Workspace autosave/explicit-save integration, exercised through
 * the REAL ReviewWorkspace/WorkspaceCommandDispatcher against
 * synthetic-transcript-001: autosave fires after an ordinary review.*
 * command (via reconcileFocus()'s new hook), autosave failure is captured
 * into getState().persistence.lastAutosaveError without throwing into the
 * fire-and-forget caller, a subsequent successful autosave clears a prior
 * error, and document.saveReviewSession's CommandResult now reflects the
 * repository write's own success/failure (not just the in-memory
 * getLastSaveFile() cache).
 *
 * Part 3 -- resumeFromRepository ("recovery after refresh"/"resume previous
 * review"), across TWO independently-constructed ReviewWorkspace instances
 * sharing one InMemorySessionRepository (simulating a page refresh, the one
 * thing this sandbox's Node cannot otherwise simulate for a real
 * IndexedDbSessionRepository -- see that file's own doc comment): a second
 * workspace resumes the exact decisions/focus the first one autosaved, and
 * resuming an unknown documentId fails cleanly rather than throwing.
 *
 * Part 4 -- ReplacementRuleEngine (DeterministicReplacementRuleEngine) pure
 * unit tests: determinism across repeated calls, all three strategies
 * (generic/sequential/custom, including custom's {n}-token vs. fixed-label
 * behavior), per-detectedType-independent sequential ordinal counting,
 * reviewer-explicit CandidateDecision.replacement always winning over any
 * configured strategy, and Keep/Ignore/undecided candidates never appearing
 * in the output map.
 *
 * Part 5 -- DocumentRebuilder + ReplacementRuleEngine integration against
 * the REAL synthetic-transcript-001 fixture (4 real person candidates) --
 * proves the engine's computed map actually reaches the rebuilt DOCX's text
 * (sequential [PERSON 001]/[PERSON 002]/... appears), not just that the
 * engine's in-memory Map looks right.
 *
 * Part 6 -- decisionProvenance/decisionProvenanceSuffix
 * (src/ui/decisionProvenance.ts) pure unit tests: the three named states
 * (reviewer / imported / imported-then-overridden) using a hand-built
 * ReviewSession with a synthetic "candidate-decided" event history, so this
 * does not depend on Feature 002's DecisionReuseEngine at all -- it only
 * needs the EVENT SHAPE that engine's applyDecisionReuse case already
 * produces (see session.ts's own applyDecisionReuse case), same technique
 * AuditExporter's own decision-reuse tests already use.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/milestone-3-reviewer-productivity-verification.ts
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { ReviewWorkspace } from "../src/workspace/Workspace.ts";
import { WorkspaceCommandDispatcher } from "../src/workspace/CommandDispatcher.ts";
import { InMemorySessionRepository } from "./support/InMemorySessionRepository.ts";
import { loadSourceFile } from "./fixture-io.ts";
import {
  isValidSessionRecord,
  summarizeSessionRecord,
  deriveCompletionPercent,
  SESSION_RECORD_SCHEMA_VERSION,
  type SessionRecord,
} from "../src/io/LocalSessionRepository.ts";
import { createWorkspaceSaveFile, WORKSPACE_SAVE_SCHEMA_VERSION } from "../src/workspace/WorkspaceSaveFile.ts";
import { REVIEW_SESSION_SCHEMA_VERSION, type ReviewSession, type ReviewEvent } from "../src/domain/ReviewSession.ts";
import { EMPTY_ENTITY_REGISTRY } from "../src/domain/EntityRegistry.ts";
import { OoxmlDocumentParser } from "../src/io/DocumentParser.ts";
import { OoxmlDocumentRebuilder } from "../src/io/DocumentRebuilder.ts";
import { RegexDetectionEngine } from "../src/engines/DetectionEngine.ts";
import { DeterministicReplacementRuleEngine } from "../src/engines/ReplacementRuleEngine.ts";
import { defaultReplacementRuleConfig, type ReplacementRuleConfig } from "../src/domain/ReplacementRule.ts";
import { decisionProvenance, decisionProvenanceSuffix } from "../src/ui/decisionProvenance.ts";

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
    return `2026-08-10T00:00:${String(tick).padStart(2, "0")}.000Z`;
  };
}

// ---- Part 1: LocalSessionRepository (via InMemorySessionRepository) ------

function fakeRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  const saveFile = createWorkspaceSaveFile(
    overrides.documentId ?? "doc-1",
    "2026-08-10T00:00:00.000Z",
    {
      schemaVersion: REVIEW_SESSION_SCHEMA_VERSION,
      sessionId: "session-1",
      documentId: overrides.documentId ?? "doc-1",
      createdAt: "2026-08-10T00:00:00.000Z",
      updatedAt: "2026-08-10T00:00:00.000Z",
      candidateDecisions: {},
      groupDecisions: {},
      ambiguityResolutions: {},
      entityRegistry: EMPTY_ENTITY_REGISTRY,
      activeNotQuite: null,
      processingRevisions: [],
      events: [],
    }
  );
  return {
    schemaVersion: SESSION_RECORD_SCHEMA_VERSION,
    documentId: "doc-1",
    fileName: "transcript.docx",
    fileBytes: new Uint8Array([1, 2, 3]),
    fileMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    saveFile,
    lastOpenedAt: "2026-08-10T00:00:00.000Z",
    reviewedCandidateCount: 0,
    totalCandidateCount: 10,
    ...overrides,
  };
}

async function testSessionRepository(): Promise<void> {
  const repo = new InMemorySessionRepository();

  check("load() on an empty repository returns null", (await repo.load("nope", "2026-08-10T00:00:01.000Z")) === null);

  await repo.save(fakeRecord({ documentId: "doc-1", lastOpenedAt: "2026-08-10T00:00:00.000Z" }));
  const loaded = await repo.load("doc-1", "2026-08-10T00:05:00.000Z");
  check("save()/load() round-trips the record", loaded !== null && loaded.documentId === "doc-1");
  check("load() touches lastOpenedAt to the supplied time", loaded?.lastOpenedAt === "2026-08-10T00:05:00.000Z");

  const reloaded = await repo.load("doc-1", "2026-08-10T00:06:00.000Z");
  check("the touched lastOpenedAt persists across a second load()", reloaded?.lastOpenedAt === "2026-08-10T00:06:00.000Z");

  await repo.save(fakeRecord({ documentId: "doc-2", lastOpenedAt: "2026-08-09T00:00:00.000Z" }));
  await repo.save(fakeRecord({ documentId: "doc-3", lastOpenedAt: "2026-08-11T00:00:00.000Z" }));
  const recent = await repo.listRecent();
  check("listRecent() orders most-recently-opened first", recent.map((s) => s.documentId).join(",") === "doc-3,doc-1,doc-2");
  check("listRecent() respects an explicit limit", (await repo.listRecent(1)).length === 1);

  await repo.delete("doc-2");
  check("delete() removes the record", (await repo.load("doc-2", "2026-08-10T00:00:00.000Z")) === null);
  check("listRecent() reflects the deletion", (await repo.listRecent()).every((s) => s.documentId !== "doc-2"));

  await repo.archive("doc-3", "2026-08-12T00:00:00.000Z");
  check("archive() hides the record from active recents", (await repo.listRecent()).every((s) => s.documentId !== "doc-3"));
  check("listRecent({ archived: true }) shows archived records", (await repo.listRecent(undefined, { archived: true })).some((s) => s.documentId === "doc-3"));
  await repo.restore("doc-3");
  check("restore() returns an archived record to active recents", (await repo.listRecent()).some((s) => s.documentId === "doc-3"));

  // Graceful-failure control surface (Andrew's "graceful handling of
  // interrupted sessions" bullet) -- exercised here directly since
  // Workspace-level coverage is Part 2's job.
  repo.simulateNextSaveFailure("simulated quota exceeded");
  let threw = false;
  try {
    await repo.save(fakeRecord({ documentId: "doc-4" }));
  } catch {
    threw = true;
  }
  check("a simulated save failure rejects (so Workspace can catch and record it)", threw);
  check("the failure was one-shot -- a subsequent save succeeds normally", await repo.save(fakeRecord({ documentId: "doc-4" })).then(() => true, () => false));

  // completionPercent derivation.
  check("deriveCompletionPercent is 0 when there are no candidates at all", deriveCompletionPercent(0, 0) === 0);
  check("deriveCompletionPercent rounds normally", deriveCompletionPercent(1, 3) === 33);
  const summary = summarizeSessionRecord(fakeRecord({ reviewedCandidateCount: 5, totalCandidateCount: 10 }));
  check("summarizeSessionRecord derives completionPercent from the record's own counts", summary.completionPercent === 50);

  // isValidSessionRecord -- graceful rejection of malformed/incompatible
  // records, the mechanism behind "corrupted sessions don't crash Recent
  // Documents or a resume attempt."
  check("a well-formed record is valid", isValidSessionRecord(fakeRecord()));
  check("a record with the wrong schemaVersion is invalid", !isValidSessionRecord({ ...fakeRecord(), schemaVersion: 99 }));
  check("a record missing fileBytes is invalid", !isValidSessionRecord({ ...fakeRecord(), fileBytes: undefined }));
  check("a plain string is invalid", !isValidSessionRecord("not a record"));
  check("null is invalid", !isValidSessionRecord(null));
}

// ---- Part 2: Workspace autosave / explicit save integration --------------

async function freshLoadedWorkspace(
  fixtureId: string,
  repo: InMemorySessionRepository
): Promise<{ workspace: ReviewWorkspace; dispatcher: WorkspaceCommandDispatcher }> {
  const workspace = new ReviewWorkspace({ clock: makeFixedClock(), sessionRepository: repo });
  const dispatcher = new WorkspaceCommandDispatcher(workspace);
  const file = loadSourceFile(fixtureId);
  const loadResult = await dispatcher.dispatchApplication({ family: "document", type: "load", file });
  check(`${fixtureId} loads cleanly`, loadResult.ok === true, loadResult.reason);
  return { workspace, dispatcher };
}

/** Autosave is fire-and-forget (scheduleAutosave() chains onto an internal
 *  queue -- see Workspace.ts). Tests that need to observe its result wait
 *  on this microtask-flush helper rather than asserting immediately after
 *  a dispatch call returns. */
async function flushAutosave(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function testAutosaveIntegration(): Promise<void> {
  const repo = new InMemorySessionRepository();
  const { dispatcher } = await freshLoadedWorkspace("synthetic-transcript-001", repo);
  const state0 = dispatcher.getState();
  const candidateId = state0.detection?.candidates[0]?.id;
  check("fixture has at least one candidate to decide", !!candidateId);
  if (!candidateId || !state0.documentId) return;

  // FOUND DURING BROWSER VALIDATION (Milestone 3): loadDocument() itself now
  // schedules an initial autosave (see Workspace.ts's own comment on this
  // fix) -- a freshly loaded, zero-decisions document is still saved, so it
  // can appear in Recent Documents and so the persistence-status UI doesn't
  // show "Saving…" forever. Confirm that here rather than asserting the old
  // (worse) behavior.
  await flushAutosave();
  const stateAfterLoad = dispatcher.getState();
  check(
    "loadDocument() itself schedules an initial autosave, even with zero decisions made",
    stateAfterLoad.persistence.lastAutosaveAt === stateAfterLoad.reviewSession?.updatedAt
  );
  check("the initial autosave landed in the repository with zero decisions recorded", Object.keys(repo.peek(state0.documentId!)?.saveFile.reviewSession.candidateDecisions ?? {}).length === 0);

  const result = dispatcher.dispatchReview({ family: "review", type: "keepCandidate", candidateId });
  check("keepCandidate is accepted", result.ok === true);
  await flushAutosave();

  const stateAfter = dispatcher.getState();
  check(
    "autosave fired after the review command and lastAutosaveAt matches the session's own updatedAt",
    stateAfter.persistence.lastAutosaveAt === stateAfter.reviewSession?.updatedAt
  );
  check("no autosave error is recorded on a successful save", stateAfter.persistence.lastAutosaveError === null);

  const stored = repo.peek(state0.documentId);
  check("the autosaved record landed in the repository under the document's own id", stored !== null);
  check("the autosaved record carries the reviewer's decision", stored?.saveFile.reviewSession.candidateDecisions[candidateId]?.decision === "Keep");
  check("the autosaved record carries the original file bytes", (stored?.fileBytes.length ?? 0) > 0);

  // Graceful failure: a failed autosave must not throw into the
  // fire-and-forget caller, and must surface via getState().persistence.
  repo.simulateNextSaveFailure("simulated storage failure");
  const result2 = dispatcher.dispatchReview({ family: "review", type: "ignoreCandidate", candidateId: state0.detection!.candidates[1]!.id });
  check("a second review command is still accepted even though the NEXT autosave will fail", result2.ok === true);
  await flushAutosave();
  const stateAfterFailure = dispatcher.getState();
  check("the autosave failure is captured, not thrown", stateAfterFailure.persistence.lastAutosaveError === "simulated storage failure");

  // Recovery: the next successful autosave clears the prior error.
  const result3 = dispatcher.dispatchReview({ family: "review", type: "ignoreCandidate", candidateId: state0.detection!.candidates[2]!.id });
  check("a third review command is accepted", result3.ok === true);
  await flushAutosave();
  const stateRecovered = dispatcher.getState();
  check("a subsequent successful autosave clears the prior error", stateRecovered.persistence.lastAutosaveError === null);
  check("a subsequent successful autosave updates lastAutosaveAt again", stateRecovered.persistence.lastAutosaveAt === stateRecovered.reviewSession?.updatedAt);
}

async function testExplicitSaveReflectsRepositoryOutcome(): Promise<void> {
  const repo = new InMemorySessionRepository();
  const { dispatcher } = await freshLoadedWorkspace("synthetic-transcript-001", repo);

  const okResult = await dispatcher.dispatchApplication({ family: "document", type: "saveReviewSession" });
  check("an explicit save succeeds when the repository is healthy", okResult.ok === true);
  check("an explicit save also populates the downloadable save-file cache", dispatcher.getLastSaveFile() !== null);

  repo.simulateNextSaveFailure("simulated explicit-save failure");
  const failResult = await dispatcher.dispatchApplication({ family: "document", type: "saveReviewSession" });
  check("an explicit save reports failure when the repository write fails", failResult.ok === false);
  check("the failure reason is the repository's own error, not a generic message", failResult.reason === "simulated explicit-save failure");
}

// ---- Part 3: resumeFromRepository (recovery after refresh) ---------------

async function testResumeFromRepository(): Promise<void> {
  const repo = new InMemorySessionRepository();
  const { workspace: firstWorkspace, dispatcher: firstDispatcher } = await freshLoadedWorkspace("synthetic-transcript-001", repo);
  const documentId = firstDispatcher.getState().documentId!;
  const candidateId = firstDispatcher.getState().detection!.candidates[0]!.id;

  firstDispatcher.dispatchReview({ family: "review", type: "redactCandidate", candidateId });
  await flushAutosave();
  void firstWorkspace; // autosave already proved the write landed -- Part 2's job, not repeated here

  // Simulate a page refresh: a SECOND, independently-constructed workspace,
  // sharing only the repository (an IndexedDB database survives a refresh
  // the same way; a fresh ReviewWorkspace instance does not).
  const secondWorkspace = new ReviewWorkspace({ clock: makeFixedClock(), sessionRepository: repo });
  const secondDispatcher = new WorkspaceCommandDispatcher(secondWorkspace);
  const resumeResult = await secondDispatcher.dispatchApplication({ family: "document", type: "resumeSession", documentId });
  check("resumeSession succeeds against a documentId the repository actually has", resumeResult.ok === true, (resumeResult as { reason?: string }).reason);

  const resumedState = secondDispatcher.getState();
  check("the resumed workspace has the same document loaded", resumedState.documentId === documentId);
  check("the resumed workspace has the reviewer's prior decision intact", resumedState.reviewSession?.candidateDecisions[candidateId]?.decision === "Redact");

  const unknownResult = await secondDispatcher.dispatchApplication({ family: "document", type: "resumeSession", documentId: "no-such-document" });
  check("resuming an unknown documentId fails cleanly rather than throwing", unknownResult.ok === false);
}

// ---- Part 4: ReplacementRuleEngine pure unit tests ------------------------

function fakeCandidate(id: string, detectedType: string): import("../src/domain/DocumentModel.ts").Candidate {
  return { id, detectedType, source: "regex", confidence: "high", displayText: id, occurrenceIds: [] } as unknown as import("../src/domain/DocumentModel.ts").Candidate;
}

function fakeDecision(candidateId: string, decision: "Keep" | "Rename" | "Redact" | "Ignore", replacement?: string): import("../src/domain/ReviewSession.ts").CandidateDecision {
  return { candidateId, decision, decidedAt: "2026-08-10T00:00:00.000Z", ...(replacement !== undefined ? { replacement } : {}) };
}

function testReplacementRuleEngine(): void {
  const engine = new DeterministicReplacementRuleEngine();

  const candidates = [fakeCandidate("p1", "person"), fakeCandidate("p2", "person"), fakeCandidate("e1", "email"), fakeCandidate("p3", "person")];
  const decisions: Record<string, import("../src/domain/ReviewSession.ts").CandidateDecision> = {
    p1: fakeDecision("p1", "Redact"),
    p2: fakeDecision("p2", "Redact"),
    e1: fakeDecision("e1", "Redact"),
    p3: fakeDecision("p3", "Redact"),
  };

  // Generic (default config) -- byte-identical to the pre-Milestone-3
  // fallback text.
  const generic = engine.computeReplacements(candidates, decisions, defaultReplacementRuleConfig());
  check("generic strategy produces the historical [PERSON REDACTED] text", generic.get("p1") === "[PERSON REDACTED]");
  check("generic strategy produces the historical [REDACTED EMAIL] text", generic.get("e1") === "[REDACTED EMAIL]");

  // Sequential -- per-type independent ordinal counting, in candidate
  // array order.
  const sequentialConfig: ReplacementRuleConfig = { person: { strategy: "sequential" }, email: { strategy: "generic" } };
  const sequential = engine.computeReplacements(candidates, decisions, sequentialConfig);
  check("sequential numbers the first person candidate 001", sequential.get("p1") === "[PERSON 001]");
  check("sequential numbers the second person candidate 002 (p2, in array order)", sequential.get("p2") === "[PERSON 002]");
  check("sequential numbers the third person candidate 003 (p3, in array order, skipping the email in between)", sequential.get("p3") === "[PERSON 003]");
  check("sequential leaves a type configured as generic untouched by numbering", sequential.get("e1") === "[REDACTED EMAIL]");

  // Custom with {n} -- category-specific AND sequential in one strategy
  // (this file's own "strategy consolidation" design note).
  const customTemplateConfig: ReplacementRuleConfig = { person: { strategy: "custom", customTemplate: "[WITNESS {n}]" } };
  const customTemplated = engine.computeReplacements(candidates, decisions, customTemplateConfig);
  check("custom {n} template numbers sequentially with the custom label", customTemplated.get("p1") === "[WITNESS 001]");
  check("custom {n} template's second candidate is 002", customTemplated.get("p2") === "[WITNESS 002]");

  // Custom without {n} -- a fixed category-specific label, same value for
  // every candidate of that type.
  const customFixedConfig: ReplacementRuleConfig = { person: { strategy: "custom", customTemplate: "[REDACTED NAME]" } };
  const customFixed = engine.computeReplacements(candidates, decisions, customFixedConfig);
  check("custom fixed template applies the SAME label to every candidate of the type", customFixed.get("p1") === "[REDACTED NAME]" && customFixed.get("p2") === "[REDACTED NAME]");

  // Reviewer-explicit replacement always wins, regardless of configured
  // strategy.
  const withExplicit = { ...decisions, p1: fakeDecision("p1", "Redact", "[MY OWN TEXT]") };
  const explicitWins = engine.computeReplacements(candidates, withExplicit, sequentialConfig);
  check("a reviewer-explicit replacement is never present in the engine's output map (nothing to resolve)", !explicitWins.has("p1"));
  check("the OTHER candidates are still resolved normally when one has an explicit replacement", explicitWins.get("p2") === "[PERSON 001]");

  // Keep/Ignore/undecided candidates are never included.
  const mixedDecisions: Record<string, import("../src/domain/ReviewSession.ts").CandidateDecision> = {
    p1: fakeDecision("p1", "Keep"),
    p2: fakeDecision("p2", "Ignore"),
  };
  const mixed = engine.computeReplacements(candidates, mixedDecisions, defaultReplacementRuleConfig());
  check("Keep decisions produce no replacement entry", !mixed.has("p1"));
  check("Ignore decisions produce no replacement entry", !mixed.has("p2"));
  check("an undecided candidate (e1, p3) produces no replacement entry", !mixed.has("e1") && !mixed.has("p3"));

  // Determinism.
  const run1 = engine.computeReplacements(candidates, decisions, sequentialConfig);
  const run2 = engine.computeReplacements(candidates, decisions, sequentialConfig);
  const identical = [...run1.entries()].every(([id, text]) => run2.get(id) === text) && run1.size === run2.size;
  check("computeReplacements is deterministic across repeated calls with identical input", identical);
}

// ---- Part 5: DocumentRebuilder + ReplacementRuleEngine, real fixture -----

function extractDocxParagraphText(docxPath: string): string {
  const script = `
import docx, sys, json
d = docx.Document(sys.argv[1])
text = "\\n".join(p.text for p in d.paragraphs)
print(json.dumps(text))
`;
  const out = execFileSync("python3", ["-c", script, docxPath], { encoding: "utf8" });
  return JSON.parse(out);
}

async function testSequentialReplacementReachesRebuiltOutput(): Promise<void> {
  const file = loadSourceFile("synthetic-transcript-001");
  const parser = new OoxmlDocumentParser();
  const model = await parser.parse(file);
  const detection = new RegexDetectionEngine().detect(model);

  const personCandidates = detection.candidates.filter((c) => c.detectedType === "person");
  check("synthetic-transcript-001 has multiple real person candidates to number sequentially", personCandidates.length >= 2);
  if (personCandidates.length < 2) return;

  const now = "2026-08-10T00:00:00.000Z";
  const candidateDecisions: ReviewSession["candidateDecisions"] = {};
  for (const candidate of personCandidates) {
    candidateDecisions[candidate.id] = { candidateId: candidate.id, decision: "Redact", decidedAt: now };
  }
  const session: ReviewSession = {
    schemaVersion: REVIEW_SESSION_SCHEMA_VERSION,
    sessionId: "verify-m3-session",
    documentId: model.documentId,
    createdAt: now,
    updatedAt: now,
    candidateDecisions,
    groupDecisions: {},
    ambiguityResolutions: {},
    activeNotQuite: null,
    processingRevisions: [],
    events: [],
  };

  const engine = new DeterministicReplacementRuleEngine();
  const config: ReplacementRuleConfig = { person: { strategy: "sequential" } };
  const replacements = engine.computeReplacements(detection.candidates, session.candidateDecisions, config);

  const rebuilder = new OoxmlDocumentRebuilder();
  const rebuiltBlob = await rebuilder.rebuild(model, detection, session, replacements);

  mkdirSync("verify/_scratch_output", { recursive: true });
  const outputPath = "verify/_scratch_output/milestone-3_sequential-replacement.docx";
  writeFileSync(outputPath, new Uint8Array(await rebuiltBlob.arrayBuffer()));
  const text = extractDocxParagraphText(outputPath);

  check("the rebuilt document contains the sequential [PERSON 001] placeholder", text.includes("[PERSON 001]"));
  check("the rebuilt document contains the sequential [PERSON 002] placeholder", text.includes("[PERSON 002]"));
  check("the rebuilt document does NOT contain the old generic [PERSON REDACTED] placeholder", !text.includes("[PERSON REDACTED]"));
}

// ---- Part 6: decisionProvenance pure unit tests ---------------------------

function fakeSessionWithEvents(events: ReviewEvent[]): ReviewSession {
  return {
    schemaVersion: REVIEW_SESSION_SCHEMA_VERSION,
    sessionId: "session-1",
    documentId: "doc-1",
    createdAt: "2026-08-10T00:00:00.000Z",
    updatedAt: "2026-08-10T00:00:00.000Z",
    candidateDecisions: {},
    groupDecisions: {},
    ambiguityResolutions: {},
    entityRegistry: EMPTY_ENTITY_REGISTRY,
    activeNotQuite: null,
    processingRevisions: [],
    events,
  };
}

function testDecisionProvenance(): void {
  const noSession = decisionProvenance(null, "c1", undefined);
  check("no decision at all is provenance 'reviewer' (the total-function default)", noSession === "reviewer");

  const reviewerDecision = fakeDecision("c1", "Keep");
  check(
    "a decision with no import history is provenance 'reviewer'",
    decisionProvenance(fakeSessionWithEvents([]), "c1", reviewerDecision) === "reviewer"
  );

  const importedDecision = { ...fakeDecision("c1", "Redact"), source: "imported" as const };
  check("a decision whose CURRENT source is 'imported' is provenance 'imported'", decisionProvenance(fakeSessionWithEvents([]), "c1", importedDecision) === "imported");

  const overriddenDecision = { ...fakeDecision("c1", "Keep"), source: "reviewer" as const };
  const historyShowingImport: ReviewEvent[] = [
    { id: "e1", kind: "candidate-decided", at: "2026-08-10T00:00:00.000Z", payload: { candidateId: "c1", decision: "Redact", source: "imported" } },
    { id: "e2", kind: "candidate-decided", at: "2026-08-10T00:01:00.000Z", payload: { candidateId: "c1", decision: "Keep" } },
  ];
  check(
    "a reviewer-sourced decision whose history shows a prior import is 'imported-then-overridden'",
    decisionProvenance(fakeSessionWithEvents(historyShowingImport), "c1", overriddenDecision) === "imported-then-overridden"
  );

  const neverImportedHistory: ReviewEvent[] = [{ id: "e1", kind: "candidate-decided", at: "2026-08-10T00:00:00.000Z", payload: { candidateId: "c2", decision: "Redact", source: "imported" } }];
  check(
    "a different candidate's import history does not leak into this candidate's provenance",
    decisionProvenance(fakeSessionWithEvents(neverImportedHistory), "c1", overriddenDecision) === "reviewer"
  );

  check("decisionProvenanceSuffix for 'reviewer' is empty", decisionProvenanceSuffix("reviewer") === "");
  check("decisionProvenanceSuffix for 'imported' matches Feature 002's existing tag", decisionProvenanceSuffix("imported") === " (Imported)");
  check("decisionProvenanceSuffix for 'imported-then-overridden' is the new Milestone 3 tag", decisionProvenanceSuffix("imported-then-overridden") === " (Modified from import)");
}

async function main(): Promise<void> {
  await testSessionRepository();
  await testAutosaveIntegration();
  await testExplicitSaveReflectsRepositoryOutcome();
  await testResumeFromRepository();
  testReplacementRuleEngine();
  await testSequentialReplacementReachesRebuiltOutput();
  testDecisionProvenance();

  console.log(`\n${passCount}/${passCount + failCount} checks passed`);
  if (failCount > 0) process.exit(1);
}

main();
