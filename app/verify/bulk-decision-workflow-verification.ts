/**
 * Verification for `applyDecisionBatch()` (src/engines/review/session.ts,
 * architectural cleanup finding #1) -- the shared lifecycle now underlying
 * confirmGroup/redactGroup/ignoreGroup/flattenGroup/bulkApplyDecision/
 * applyDecisionReuse. Existing suites (group-bulk-actions-verification.ts,
 * milestone-2-review-at-scale-verification.ts, decision-reuse-
 * verification.ts) already prove every one of these six commands' ordinary
 * behavior end-to-end through the real Workspace/Dispatcher stack, and all
 * three continue to pass unchanged after this refactor -- that IS the
 * primary proof of behavioral equivalence for the common path.
 *
 * This suite targets the one thing that changed in KIND, not just location:
 * a bug in the shared missing-candidate/overwrite-policy logic would now
 * silently affect all six operations at once, where before a bug in one
 * operation's own hand-rolled loop could only ever affect that one. None of
 * the existing suites exercises the missing-candidate skip path with a real
 * invalid id (group membership always comes from a real GroupingResult in
 * those suites, which never contains one) -- this suite constructs that
 * scenario directly against the real reducer (applyReviewCommand), the same
 * direct-engine-level pattern review-engine-verification.ts and decision-
 * reuse-verification.ts's own Part 1 already establish for exactly this kind
 * of edge case.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/bulk-decision-workflow-verification.ts
 */

import { OoxmlDocumentParser } from "../src/io/DocumentParser.ts";
import { RegexDetectionEngine } from "../src/engines/DetectionEngine.ts";
import { RegexCandidateQualityEngine, buildDefaultScoringProfileSnapshot } from "../src/engines/CandidateQualityEngine.ts";
import { RegexEntityResolutionEngine } from "../src/engines/EntityResolutionEngine.ts";
import { DurableReviewEngine } from "../src/engines/ReviewEngine.ts";
import { createReviewSession } from "../src/engines/review/session.ts";
import type { DetectionResult } from "../src/engines/DetectionEngine.ts";
import type { EntityGroupProposal, GroupingResult } from "../src/engines/EntityResolutionEngine.ts";
import type { DecisionReuseProposal } from "../src/domain/DecisionReuse.ts";
import { loadSourceFile } from "./fixture-io.ts";

const FIXED_SCORING_TIMESTAMP = "2026-07-29T00:00:00.000Z";

function makeFixedClock(): () => string {
  let tick = 0;
  return () => {
    tick += 1;
    return `2026-07-29T00:00:${String(tick).padStart(2, "0")}.000Z`;
  };
}

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

function freshEngine(fixture: Fixture, sessionId: string): DurableReviewEngine {
  const clock = makeFixedClock();
  const session = createReviewSession(sessionId, "doc-under-test", clock());
  return new DurableReviewEngine(fixture.detection, fixture.grouping, session, clock);
}

/** Returns a fixture whose grouping is a clone with ONE extra, nonexistent
 *  candidateId spliced into `groupId`'s membership -- the only way to
 *  exercise the shared "skip a candidateId not in the current
 *  DetectionResult" branch for a GROUP-level command, since confirmGroup/
 *  redactGroup/ignoreGroup/flattenGroup all iterate `group.candidateIds`
 *  from context, never from the command itself. A real GroupingResult never
 *  produces this on its own (EntityResolutionEngine only ever proposes real
 *  candidateIds) -- this is a deliberately engineered edge case, the same
 *  category of construction decision-reuse-verification.ts's own Part 1
 *  uses for its Tier 2 conflict scenario. */
function withBogusMemberInjected(fixture: Fixture, groupId: string, bogusCandidateId: string): Fixture {
  const entityGroupProposals: EntityGroupProposal[] = fixture.grouping.entityGroupProposals.map((g) =>
    g.groupId === groupId ? { ...g, candidateIds: [...g.candidateIds, bogusCandidateId] } : g
  );
  return { detection: fixture.detection, grouping: { ...fixture.grouping, entityGroupProposals } };
}

async function main(): Promise<void> {
  const entityRes = await loadFixture("entity-resolution-001");
  const realGroup = entityRes.grouping.entityGroupProposals.find((g) => g.candidateIds.length >= 2);
  if (!realGroup) throw new Error("entity-resolution-001 has no multi-member group for this suite");
  const BOGUS_ID = "candidate-does-not-exist";

  console.log("--- Missing-candidate skip: confirmGroup tolerates a bogus member id ---");
  {
    const engineered = withBogusMemberInjected(entityRes, realGroup.groupId, BOGUS_ID);
    const engine = freshEngine(engineered, "s-confirm-bogus");
    const result = engine.dispatch({ family: "review", type: "confirmGroup", groupId: realGroup.groupId });
    check("confirmGroup still succeeds despite the bogus member", result.ok, result.reason);
    const state = engine.getState();
    for (const candidateId of realGroup.candidateIds) {
      check(`real member ${candidateId} was decided Keep`, state.candidateDecisions[candidateId]?.decision === "Keep");
    }
    check("the bogus id received no decision", !(BOGUS_ID in state.candidateDecisions));
    check("group-decided summary event still reports the FULL requested member count, unchanged from before this refactor", (() => {
      const summary = state.events.find((e) => e.kind === "group-decided");
      return summary?.payload["memberCount"] === realGroup.candidateIds.length + 1;
    })());
    check("the group's own EntityGroupDecision.confirmedMemberCandidateIds still lists every REQUESTED member, including the bogus one -- matches pre-refactor semantics (this field reflects the proposal, not what was actually applied)", (() => {
      const decision = state.groupDecisions[realGroup.groupId];
      return decision !== undefined && decision.confirmedMemberCandidateIds.includes(BOGUS_ID);
    })());
  }

  console.log("--- Missing-candidate skip: flattenGroup (Merge) tolerates a bogus member id ---");
  {
    const engineered = withBogusMemberInjected(entityRes, realGroup.groupId, BOGUS_ID);
    const engine = freshEngine(engineered, "s-flatten-bogus");
    const result = engine.dispatch({ family: "review", type: "flattenGroup", groupId: realGroup.groupId });
    check("flattenGroup still succeeds despite the bogus member", result.ok, result.reason);
    const state = engine.getState();
    for (const candidateId of realGroup.candidateIds) {
      check(`real member ${candidateId} was renamed to the canonical name`, state.candidateDecisions[candidateId]?.decision === "Rename" && state.candidateDecisions[candidateId]?.replacement === realGroup.canonicalName);
    }
    check("the bogus id received no decision", !(BOGUS_ID in state.candidateDecisions));
    check("no phantom entity was created for the bogus id", state.entityRegistry.entityIdByCandidateId[BOGUS_ID] === undefined);
  }

  console.log("--- Event ordering: one candidate-decided per real member, in candidateIds order, THEN the summary event ---");
  {
    const engine = freshEngine(entityRes, "s-order");
    const before = engine.getState().events.length;
    engine.dispatch({ family: "review", type: "confirmGroup", groupId: realGroup.groupId });
    const events = engine.getState().events.slice(before);
    check("exactly N+1 events were appended (one per member, plus one summary)", events.length === realGroup.candidateIds.length + 1);
    check(
      "every event except the last is candidate-decided, in the group's own candidateIds order",
      events.slice(0, -1).every((e, i) => e.kind === "candidate-decided" && e.payload["candidateId"] === realGroup.candidateIds[i])
    );
    check("the LAST event is the closing group-decided summary", events[events.length - 1]?.kind === "group-decided");
  }

  console.log("--- bulkApplyDecision: missing-candidate skip, applied/skipped counts, and overwrite behavior ---");
  {
    const candidateIds = entityRes.detection.candidates.map((c) => c.id);
    const [realA, realB] = candidateIds;
    if (!realA || !realB) throw new Error("fixture needs at least 2 candidates");

    const engine = freshEngine(entityRes, "s-bulk-mixed");
    // Pre-decide realA manually to prove bulkApplyDecision OVERWRITES it
    // (unlike applyDecisionReuse) -- same "overwrite" policy switch this
    // refactor made an explicit, named option rather than an implicit
    // per-case difference.
    engine.dispatch({ family: "review", type: "keepCandidate", candidateId: realA });
    check("pre-decision is visible before the bulk action", engine.getState().candidateDecisions[realA]?.decision === "Keep");

    const result = engine.dispatch({
      family: "review",
      type: "bulkApplyDecision",
      candidateIds: [realA, realB, BOGUS_ID],
      decision: "Redact",
    });
    check("bulkApplyDecision succeeds when at least one real candidate is present", result.ok, result.reason);

    const summary = engine.getState().events.filter((e) => e.kind === "bulk-decided").at(-1);
    check("bulk-decided summary reports requestedCount = 3 (all ids passed, including the bogus one)", summary?.payload["requestedCount"] === 3);
    check("bulk-decided summary reports appliedCount = 2 (the two real candidates)", summary?.payload["appliedCount"] === 2);
    check("bulk-decided summary reports skippedCount = 1 (the bogus id)", summary?.payload["skippedCount"] === 1);
    check("realA's earlier Keep was OVERWRITTEN by the bulk Redact -- bulk actions overwrite, unlike Decision Reuse", engine.getState().candidateDecisions[realA]?.decision === "Redact");
    check("realB received the bulk decision too", engine.getState().candidateDecisions[realB]?.decision === "Redact");
    check("the bogus id received no decision", !(BOGUS_ID in engine.getState().candidateDecisions));
  }

  console.log("--- bulkApplyDecision: every requested id invalid fails the WHOLE command (no partial no-op success) ---");
  {
    const engine = freshEngine(entityRes, "s-bulk-all-invalid");
    const result = engine.dispatch({ family: "review", type: "bulkApplyDecision", candidateIds: [BOGUS_ID, "also-fake"], decision: "Keep" });
    check("bulkApplyDecision fails outright when every id is invalid", result.ok === false, JSON.stringify(result));
    check("no bulk-decided event was appended for the failed attempt", !engine.getState().events.some((e) => e.kind === "bulk-decided"));
  }

  console.log("--- applyDecisionReuse: missing-candidate skip AND already-decided skip, together, with correct counts ---");
  {
    const candidateIds = entityRes.detection.candidates.map((c) => c.id);
    const [realA, realB] = candidateIds;
    if (!realA || !realB) throw new Error("fixture needs at least 2 candidates");

    const engine = freshEngine(entityRes, "s-reuse-mixed");
    engine.dispatch({ family: "review", type: "keepCandidate", candidateId: realA }); // already decided -- reuse must skip, not overwrite

    const proposals: DecisionReuseProposal[] = [
      { candidateId: realA, decision: "Redact", evidence: { tier: "exact-key", matchedImportedCandidateId: realA, confidence: 100, description: "test" } },
      { candidateId: realB, decision: "Redact", evidence: { tier: "exact-key", matchedImportedCandidateId: realB, confidence: 100, description: "test" } },
      { candidateId: BOGUS_ID, decision: "Redact", evidence: { tier: "exact-key", matchedImportedCandidateId: BOGUS_ID, confidence: 100, description: "test" } },
    ];
    const result = engine.dispatch({ family: "review", type: "applyDecisionReuse", proposals });
    check("applyDecisionReuse succeeds", result.ok, result.reason);

    check("realA's pre-existing Keep is UNCHANGED -- import never overwrites, unlike bulkApplyDecision", engine.getState().candidateDecisions[realA]?.decision === "Keep");
    check("realB (undecided) received the imported Redact decision", engine.getState().candidateDecisions[realB]?.decision === "Redact" && engine.getState().candidateDecisions[realB]?.source === "imported");
    check("the bogus id received no decision", !(BOGUS_ID in engine.getState().candidateDecisions));

    const summary = engine.getState().events.filter((e) => e.kind === "decisions-imported").at(-1);
    check("decisions-imported summary reports proposalCount = 3", summary?.payload["proposalCount"] === 3);
    check("decisions-imported summary reports appliedCount = 1 (only realB was actually new)", summary?.payload["appliedCount"] === 1);
    check("decisions-imported summary reports skippedCount = 2 (realA already-decided + the bogus id)", summary?.payload["skippedCount"] === 2);

    check("realA anchors its OWN singleton entity (individually decided, no groupId context)", engine.getState().entityRegistry.entityIdByCandidateId[realA] !== undefined);
    check("realB anchors its OWN singleton entity too -- applyDecisionReuse never shares an entity across proposals", engine.getState().entityRegistry.entityIdByCandidateId[realB] !== undefined && engine.getState().entityRegistry.entityIdByCandidateId[realB] !== engine.getState().entityRegistry.entityIdByCandidateId[realA]);
  }

  console.log("--- Group-level decision stamping: Confirmed vs. Refined, unchanged by the refactor ---");
  {
    const confirmEngine = freshEngine(entityRes, "s-stamp-confirm");
    confirmEngine.dispatch({ family: "review", type: "confirmGroup", groupId: realGroup.groupId });
    check("confirmGroup stamps 'Confirmed'", confirmEngine.getState().groupDecisions[realGroup.groupId]?.decision === "Confirmed");

    const redactEngine = freshEngine(entityRes, "s-stamp-redact");
    redactEngine.dispatch({ family: "review", type: "redactGroup", groupId: realGroup.groupId });
    check("redactGroup stamps 'Confirmed'", redactEngine.getState().groupDecisions[realGroup.groupId]?.decision === "Confirmed");

    const ignoreEngine = freshEngine(entityRes, "s-stamp-ignore");
    ignoreEngine.dispatch({ family: "review", type: "ignoreGroup", groupId: realGroup.groupId });
    check("ignoreGroup stamps 'Confirmed'", ignoreEngine.getState().groupDecisions[realGroup.groupId]?.decision === "Confirmed");

    const flattenEngine = freshEngine(entityRes, "s-stamp-flatten");
    flattenEngine.dispatch({ family: "review", type: "flattenGroup", groupId: realGroup.groupId });
    check("flattenGroup stamps 'Refined'", flattenEngine.getState().groupDecisions[realGroup.groupId]?.decision === "Refined");

    check("bulkApplyDecision stamps NO group decision (arbitrary selection, not one group)", (() => {
      const bulkEngine = freshEngine(entityRes, "s-stamp-bulk");
      bulkEngine.dispatch({ family: "review", type: "bulkApplyDecision", candidateIds: realGroup.candidateIds, decision: "Keep" });
      return Object.keys(bulkEngine.getState().groupDecisions).length === 0;
    })());
  }

  console.log(`\n${passCount}/${passCount + failCount} checks passed`);
  process.exitCode = failCount === 0 ? 0 : 1;
}

main();
