/**
 * Verification harness for DECISION MEMORY (AG, 2026-08-03) -- automatic
 * cross-document reuse of the reviewer's own prior decisions. See
 * src/domain/DecisionMemory.ts and Workspace.applyRememberedDecisions().
 *
 * Part A -- the pure projection/merge (domain/DecisionMemory.ts).
 *
 * Part B -- persistence: deciding something records it; deleting a document
 * forgets what it taught.
 *
 * Part C -- the feature itself, and its ONE load-bearing safety property.
 * A replacement decided in an earlier document must apply automatically to
 * a later one on an EXACT key match, and must NOT apply on a merely
 * similar key. The second half is what makes automatic application
 * defensible without the system having any theory about why an edit was
 * made: the exact-key tier states a fact ("you decided this exact value
 * before"), while the similarity tier states a judgement, and judgements
 * stay behind the explicit file import the reviewer opted into. If that
 * filter ever regresses, this suite is the thing that catches it.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/decision-memory-verification.ts
 */

import { ReviewWorkspace } from "../src/workspace/Workspace.ts";
import { WorkspaceCommandDispatcher } from "../src/workspace/CommandDispatcher.ts";
import { InMemorySessionRepository } from "./support/InMemorySessionRepository.ts";
import { loadSourceFile } from "./fixture-io.ts";
import {
  DECISION_MEMORY_SCHEMA_VERSION,
  isValidDecisionMemoryRecord,
  mergeDecisionMemory,
  projectDecisionMemory,
  type DecisionMemoryRecord,
} from "../src/domain/DecisionMemory.ts";
import { createReviewSession } from "../src/engines/review/session.ts";
import type { CandidateDecision, ReviewSession } from "../src/domain/ReviewSession.ts";

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

const FIXTURE = "synthetic-transcript-001";
let tick = 0;
function makeSteppingClock(): () => string {
  return () => new Date(Date.UTC(2026, 7, 3, 0, 0, tick++)).toISOString();
}

function sessionWith(decisions: Record<string, { decision: CandidateDecision["decision"]; replacement?: string; decidedAt: string }>): ReviewSession {
  const base = createReviewSession("s1", "d1", "2026-08-03T00:00:00.000Z");
  const candidateDecisions: Record<string, CandidateDecision> = {};
  for (const [candidateId, d] of Object.entries(decisions)) {
    candidateDecisions[candidateId] = {
      candidateId,
      decision: d.decision,
      ...(d.replacement !== undefined ? { replacement: d.replacement } : {}),
      decidedAt: d.decidedAt,
      source: "reviewer",
    };
  }
  return { ...base, candidateDecisions };
}

function memoryRecord(documentId: string, updatedAt: string, entries: DecisionMemoryRecord["entries"]): DecisionMemoryRecord {
  return { schemaVersion: DECISION_MEMORY_SCHEMA_VERSION, documentId, sessionId: `session-${documentId}`, updatedAt, entries };
}

console.log("=== Part A: projection and merge ===\n");

{
  const session = sessionWith({
    "person:tanesha can collier": { decision: "Rename", replacement: "Tanesha Collier", decidedAt: "2026-08-01T00:00:00.000Z" },
    "person:andrew goodloe": { decision: "Keep", decidedAt: "2026-08-01T00:00:01.000Z" },
  });
  const projected = projectDecisionMemory(session, "docA", "2026-08-01T00:00:02.000Z");
  check("projects one entry per decided candidate", projected.entries.length === 2, String(projected.entries.length));
  const tanesha = projected.entries.find((e) => e.candidateId === "person:tanesha can collier");
  check("carries the reviewer's replacement text", tanesha?.replacement === "Tanesha Collier", tanesha?.replacement);
  check("carries the decision kind", tanesha?.decision === "Rename", tanesha?.decision);
  check("a Keep needs no replacement", projected.entries.find((e) => e.candidateId === "person:andrew goodloe")?.replacement === undefined);
  check("undecided candidates are not remembered", projectDecisionMemory(createReviewSession("s", "d", "2026-08-01T00:00:00.000Z"), "docA", "x").entries.length === 0);
  check("projection validates as a record", isValidDecisionMemoryRecord(projected));
  check("a foreign shape does not", !isValidDecisionMemoryRecord({ schemaVersion: 99, documentId: "d", sessionId: "s", updatedAt: "t", entries: [] }));
}

{
  // Same key decided differently in two documents -- the reviewer's LATEST
  // expressed intent wins, matching CandidateDecision's own last-write-wins
  // rule. Records are passed oldest-first AND newest-first to prove the
  // result does not depend on iteration order.
  const older = memoryRecord("docA", "2026-08-01T00:00:00.000Z", [
    { candidateId: "person:tanesha can collier", decision: "Keep", decidedAt: "2026-08-01T00:00:00.000Z" },
  ]);
  const newer = memoryRecord("docB", "2026-08-02T00:00:00.000Z", [
    { candidateId: "person:tanesha can collier", decision: "Rename", replacement: "Tanesha Collier", decidedAt: "2026-08-02T00:00:00.000Z" },
  ]);
  for (const [label, records] of [
    ["oldest first", [older, newer]],
    ["newest first", [newer, older]],
  ] as const) {
    const merged = mergeDecisionMemory(records);
    const entry = merged.candidates.find((c) => c.candidateId === "person:tanesha can collier");
    check(`most recent decision wins (${label})`, entry?.decision === "Rename" && entry?.replacement === "Tanesha Collier", JSON.stringify(entry));
  }
  check("merge deduplicates to one entry per key", mergeDecisionMemory([older, newer]).candidates.length === 1);
  check("merge of nothing is empty, not malformed", mergeDecisionMemory([]).candidates.length === 0);
  check("merge carries no entity groups or ambiguity resolutions", mergeDecisionMemory([newer]).entityGroups.length === 0 && mergeDecisionMemory([newer]).ambiguityResolutions.length === 0);
}

console.log("\n=== Part B: persistence ===\n");

let realCandidateId = "";
{
  const repo = new InMemorySessionRepository();
  const workspace = new ReviewWorkspace({ clock: makeSteppingClock(), sessionRepository: repo });
  const dispatcher = new WorkspaceCommandDispatcher(workspace);
  const load = await dispatcher.dispatchApplication({ family: "document", type: "load", file: loadSourceFile(FIXTURE) });
  check("fixture loads", load.ok === true, load.ok ? undefined : load.reason);
  await workspace.autosaveSettled();

  const candidateId = dispatcher.getState().detection?.candidates[0]?.id ?? "";
  realCandidateId = candidateId;
  check("fixture yields a candidate", candidateId.length > 0);

  dispatcher.dispatchReview({ family: "review", type: "renameCandidate", candidateId, replacement: "Carried Over Value" });
  await workspace.autosaveSettled();

  const stored = await repo.listDecisionMemory();
  const entry = stored.flatMap((r) => r.entries).find((e) => e.candidateId === candidateId);
  check("deciding a Rename records it in decision memory", entry?.decision === "Rename", JSON.stringify(entry));
  check("the replacement text is recorded", entry?.replacement === "Carried Over Value", entry?.replacement);

  const documentId = dispatcher.getState().documentId!;
  check("listDecisionMemory can exclude the current document", (await repo.listDecisionMemory(documentId)).length === 0);

  await repo.delete(documentId);
  check("deleting a document forgets what it taught", (await repo.listDecisionMemory()).length === 0);
}

console.log("\n=== Part C: automatic carry-over on load ===\n");

{
  // Seed memory under a DIFFERENT documentId, containing a real candidate
  // key from the fixture -- i.e. exactly the state after reviewing some
  // earlier document that happened to mention the same value.
  const repo = new InMemorySessionRepository();
  await repo.saveDecisionMemory(
    memoryRecord("some-earlier-document", "2026-08-01T00:00:00.000Z", [
      { candidateId: realCandidateId, decision: "Rename", replacement: "Tanesha Collier", decidedAt: "2026-08-01T00:00:00.000Z" },
    ])
  );

  const workspace = new ReviewWorkspace({ clock: makeSteppingClock(), sessionRepository: repo });
  const dispatcher = new WorkspaceCommandDispatcher(workspace);
  const load = await dispatcher.dispatchApplication({ family: "document", type: "load", file: loadSourceFile(FIXTURE) });
  check("fixture loads with memory present", load.ok === true, load.ok ? undefined : load.reason);

  const decision = dispatcher.getState().reviewSession?.candidateDecisions[realCandidateId];
  check("a decision from an earlier document is applied automatically", decision?.decision === "Rename", JSON.stringify(decision));
  check("the reviewer's replacement text carries over", decision?.replacement === "Tanesha Collier", decision?.replacement);
  // The standing rule that the app never invents confirmation history:
  // a carried-over decision must stay distinguishable from an authored one.
  check("carried-over decisions are stamped as imported, not authored here", decision?.source === "imported", decision?.source);
  check("and carry evidence explaining the match", decision?.importEvidence?.tier === "exact-key", JSON.stringify(decision?.importEvidence));

  const summary = workspace.getLastDecisionReuseSummary();
  check("the reviewer is told it happened", summary?.origin === "decision-memory", JSON.stringify(summary?.origin));
  check("summary reports the documents drawn from", summary?.documentsDrawnFrom === 1, String(summary?.documentsDrawnFrom));
  check("summary reports only exact-key matches", summary?.tierCounts["similarity-threshold"] === 0 && summary?.tierCounts["grouped-alias"] === 0);
}

{
  // THE SAFETY PROPERTY. A key that is merely SIMILAR must not carry over.
  // Without the exact-key filter this would match at the similarity tier
  // (Ratcliff/Obershelp >= 0.90) and silently rewrite a value the reviewer
  // never decided.
  const nearMiss = `${realCandidateId} jr`;
  const repo = new InMemorySessionRepository();
  await repo.saveDecisionMemory(
    memoryRecord("some-earlier-document", "2026-08-01T00:00:00.000Z", [
      { candidateId: nearMiss, decision: "Redact", replacement: "[REDACTED]", decidedAt: "2026-08-01T00:00:00.000Z" },
    ])
  );

  const workspace = new ReviewWorkspace({ clock: makeSteppingClock(), sessionRepository: repo });
  const dispatcher = new WorkspaceCommandDispatcher(workspace);
  await dispatcher.dispatchApplication({ family: "document", type: "load", file: loadSourceFile(FIXTURE) });
  const decision = dispatcher.getState().reviewSession?.candidateDecisions[realCandidateId];
  check(
    "a merely SIMILAR key does NOT carry over (exact-key tier only)",
    decision === undefined,
    `unexpectedly applied: ${JSON.stringify(decision)}`
  );
}

{
  // Existing work is never disturbed: a candidate already decided in this
  // document keeps the reviewer's own decision.
  const repo = new InMemorySessionRepository();
  const workspace = new ReviewWorkspace({ clock: makeSteppingClock(), sessionRepository: repo });
  const dispatcher = new WorkspaceCommandDispatcher(workspace);
  await dispatcher.dispatchApplication({ family: "document", type: "load", file: loadSourceFile(FIXTURE) });
  dispatcher.dispatchReview({ family: "review", type: "keepCandidate", candidateId: realCandidateId });
  await workspace.autosaveSettled();
  const documentId = dispatcher.getState().documentId!;

  // A second workspace resumes THIS document, with memory that disagrees.
  await repo.saveDecisionMemory(
    memoryRecord("some-earlier-document", "2026-08-02T00:00:00.000Z", [
      { candidateId: realCandidateId, decision: "Redact", replacement: "[REDACTED]", decidedAt: "2026-08-02T00:00:00.000Z" },
    ])
  );
  const workspace2 = new ReviewWorkspace({ clock: makeSteppingClock(), sessionRepository: repo });
  const dispatcher2 = new WorkspaceCommandDispatcher(workspace2);
  const resumed = await dispatcher2.dispatchApplication({ family: "document", type: "resumeSession", documentId });
  check("resume succeeds", resumed.ok === true, resumed.ok ? undefined : resumed.reason);
  const decision = dispatcher2.getState().reviewSession?.candidateDecisions[realCandidateId];
  check(
    "a RESTORED session is left alone -- the reviewer's own decision survives",
    decision?.decision === "Keep" && decision?.source === "reviewer",
    JSON.stringify(decision)
  );
  check("and no carry-over summary is reported for a restored session", workspace2.getLastDecisionReuseSummary() === null);
}

console.log(`\n${failCount === 0 ? "ALL PASS" : "FAILURES"}: ${passCount} passed, ${failCount} failed`);
if (failCount > 0) process.exit(1);
