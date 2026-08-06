/**
 * workspace-metrics-verification.ts -- Workspace Metrics (2026-08-02,
 * Andrew's standalone-subsystem task). Node-verifiable core: the pure
 * derivation over WorkspaceState -- workspace scale counts, event-log
 * activity tallies (individual vs bulk vs group actions), cleanup
 * exposure, factual consolidation numbers, live movement after
 * decisions, and the persistence property that matters most: every
 * metric recomputes identically from a RELOADED workspace's state (the
 * existing preservation model, no metrics storage of its own).
 *
 * NOT coverable here (browser-only): the detached window itself.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/workspace-metrics-verification.ts
 */

import { readFileSync } from "node:fs";
import { ReviewWorkspace } from "../src/workspace/Workspace.ts";
import { WorkspaceCommandDispatcher } from "../src/workspace/CommandDispatcher.ts";
import { InMemorySessionRepository } from "./support/InMemorySessionRepository.ts";
import { deriveWorkspaceMetrics, type MetricSection } from "../src/metrics/workspaceMetrics.ts";

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

const metric = (sections: MetricSection[], sectionId: string, metricId: string) =>
  sections.find((s) => s.id === sectionId)?.metrics.find((x) => x.id === metricId);

async function main(): Promise<void> {
  console.log("--- no document: a single factual placeholder, never a throw ---");
  {
    const workspace = new ReviewWorkspace({ clock: () => new Date().toISOString(), sessionRepository: new InMemorySessionRepository() });
    const sections = deriveWorkspaceMetrics(new WorkspaceCommandDispatcher(workspace).getState());
    check("one workspace section with a 'none loaded' document metric", sections.length === 1 && metric(sections, "workspace", "no-document")?.value === "none loaded");
  }

  const bytes = readFileSync("fixtures/domain-parity/entity-resolution-001/source/synthetic_entity_resolution.docx");
  const repository = new InMemorySessionRepository();
  const workspace = new ReviewWorkspace({ clock: () => new Date().toISOString(), sessionRepository: repository });
  const dispatcher = new WorkspaceCommandDispatcher(workspace);
  await dispatcher.dispatchApplication({ family: "document", type: "load", file: new File([bytes], "synthetic_entity_resolution.docx") });
  const state0 = dispatcher.getState();
  const sections0 = deriveWorkspaceMetrics(state0);

  console.log("--- workspace scale (factual counts straight from pipeline state) ---");
  {
    const candidates = state0.detection!.candidates.length;
    const occurrences = state0.detection!.candidates.reduce((n, c) => n + c.occurrenceIds.length, 0);
    check("unique candidates matches detection", metric(sections0, "workspace", "candidates")?.value === candidates);
    check("detected occurrences = sum of candidate occurrences", metric(sections0, "workspace", "occurrences")?.value === occurrences);
    check("document metric carries the file name", metric(sections0, "workspace", "document")?.value === "synthetic_entity_resolution.docx");
  }

  console.log("--- cleanup exposure (recomputed per load, no storage) ---");
  {
    const cleanup = state0.identityCleanup;
    check("WorkspaceState.identityCleanup present after load", cleanup !== null);
    check("cleanup section mirrors it", metric(sections0, "cleanup", "proposals-removed")?.value === cleanup!.proposalsRemoved && metric(sections0, "cleanup", "options-removed")?.value === cleanup!.optionsRemoved);
    check("ambiguity 'initially proposed' note uses the pre-cleanup count", String(metric(sections0, "review", "ambiguity")?.note ?? "").includes(String(cleanup!.proposalsBefore)));
  }

  console.log("--- activity + consolidation move with review, factually ---");
  {
    check("zero actions before any decision", metric(sections0, "decisions", "actions")?.value === 0);
    // One individual decision.
    const firstId = state0.detection!.candidates[0]!.id;
    dispatcher.dispatchReview({ family: "review", type: "keepCandidate", candidateId: firstId });
    // One bulk action over two more.
    const bulkIds = state0.detection!.candidates.slice(1, 3).map((c) => c.id);
    dispatcher.dispatchReview({ family: "review", type: "bulkApplyDecision", candidateIds: bulkIds, decision: "Ignore" });
    const s1 = dispatcher.getState();
    const m1 = deriveWorkspaceMetrics(s1);
    check("individual decisions = 1", metric(m1, "decisions", "individual")?.value === 1);
    check("category/bulk actions = 1 covering 2 items", metric(m1, "decisions", "category")?.value === 1 && String(metric(m1, "decisions", "category")?.note).includes("2 items"));
    check("total decision actions = 2 (one act each, whatever the reach)", metric(m1, "consolidation", "actions-so-far")?.value === 2);
    const decidedOccurrences = [firstId, ...bulkIds].reduce((n, id) => n + (s1.detection!.candidates.find((c) => c.id === id)?.occurrenceIds.length ?? 0), 0);
    check("items covered = 3; occurrences covered = their occurrence sum", metric(m1, "consolidation", "items-covered")?.value === 3 && metric(m1, "consolidation", "occurrences-covered")?.value === decidedOccurrences);
    check("notes stay factual (counts, no time/productivity claims)", !JSON.stringify(m1).match(/time saved|faster|productivity|efficien/i));
  }

  console.log("--- persistence: metrics recompute identically from a reloaded workspace ---");
  {
    // Save through the existing repository path, then RESUME the same
    // document in a FRESH workspace against the same repository -- the
    // exact resume flow the app uses (a plain `load` deliberately starts
    // a fresh session; resumeSession restores the stored one). No
    // metrics were stored anywhere; they must derive equal from restored
    // state alone.
    await dispatcher.dispatchApplication({ family: "document", type: "saveReviewSession" });
    const documentId = dispatcher.getState().documentId!;
    const reloaded = new ReviewWorkspace({ clock: () => new Date().toISOString(), sessionRepository: repository });
    const dispatcher2 = new WorkspaceCommandDispatcher(reloaded);
    await dispatcher2.dispatchApplication({ family: "document", type: "resumeSession", documentId });
    const before = deriveWorkspaceMetrics(dispatcher.getState());
    const after = deriveWorkspaceMetrics(dispatcher2.getState());
    const strip = (sections: MetricSection[]) => JSON.stringify(sections);
    check("restored workspace derives byte-identical metrics", strip(before) === strip(after), "resume path must restore the session for this to hold");
  }

  console.log(`\n${passCount}/${passCount + failCount} checks passed`);
  process.exitCode = failCount === 0 ? 0 : 1;
}

await main();
