/**
 * Verification harness for Phase 8: DurableReviewEngine (src/engines/
 * ReviewEngine.ts) and its reducer (src/engines/review/session.ts) /
 * serialization (src/engines/review/serialization.ts).
 *
 * Unlike verify/detection-parity.ts, verify/quality-parity.ts,
 * verify/entity-resolution-parity.ts, and
 * verify/occurrence-classification-parity.ts, this is NOT a fixture-diff-
 * against-Python harness -- there is no Python-produced "expected review
 * session" fixture to diff against, because ReviewSession is new durable
 * state with no direct Python export (local_web_app.py's save_state()
 * output is unversioned server-runtime state, not a domain-parity
 * fixture). Instead this is a property/behavior verification suite,
 * checking exactly the properties Andrew's Phase 8 instruction lists:
 * decision persistence, reload fidelity, deterministic serialization,
 * decision precedence, rename propagation, Ignore behavior, Not Quite
 * behavior, and repeated save/load cycles -- run against REAL candidate/
 * group IDs from real domain-parity fixtures (via the full Detection ->
 * Quality -> EntityResolution pipeline), not synthetic placeholder IDs.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/review-engine-verification.ts
 */

import { OoxmlDocumentParser } from "../src/io/DocumentParser.ts";
import { RegexDetectionEngine } from "../src/engines/DetectionEngine.ts";
import { RegexCandidateQualityEngine, buildDefaultScoringProfileSnapshot } from "../src/engines/CandidateQualityEngine.ts";
import { RegexEntityResolutionEngine } from "../src/engines/EntityResolutionEngine.ts";
import { DurableReviewEngine } from "../src/engines/ReviewEngine.ts";
import { createReviewSession } from "../src/engines/review/session.ts";
import { serializeReviewSession, deserializeReviewSession } from "../src/engines/review/serialization.ts";
import type { DetectionResult } from "../src/engines/DetectionEngine.ts";
import type { GroupingResult } from "../src/engines/EntityResolutionEngine.ts";
import { loadSourceFile } from "./fixture-io.ts";

const FIXED_SCORING_TIMESTAMP = "2026-07-27T00:00:00.000Z";

/** Each engine gets its OWN independent tick counter -- a single shared
 *  module-level counter would interleave differently depending on dispatch
 *  order between two engines under test, which is a test-harness artifact,
 *  not a real product property. */
function makeFixedClock(): () => string {
  let tick = 0;
  return () => {
    tick += 1;
    return `2026-07-28T00:00:${String(tick).padStart(2, "0")}.000Z`;
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

async function main(): Promise<void> {
  const transcript = await loadFixture("synthetic-transcript-001");
  const entityRes = await loadFixture("entity-resolution-001");

  const candidateIds = transcript.detection.candidates.map((c) => c.id);
  const [candA, candB, candC, candD] = candidateIds;
  if (!candA || !candB || !candC || !candD) throw new Error("fixture does not have enough candidates for this suite");

  console.log("--- Decision persistence + precedence ---");
  {
    const engine = freshEngine(transcript, "s-precedence");
    const r1 = engine.dispatch({ family: "review", type: "keepCandidate", candidateId: candA });
    check("keepCandidate succeeds", r1.ok);
    check("decision recorded as Keep", engine.getState().candidateDecisions[candA]?.decision === "Keep");

    const r2 = engine.dispatch({ family: "review", type: "renameCandidate", candidateId: candA, replacement: "Redacted Person" });
    check("renameCandidate succeeds", r2.ok);
    check("Rename supersedes Keep (single current value, not accumulated)", engine.getState().candidateDecisions[candA]?.decision === "Rename");
    check("exactly one CandidateDecision object for this candidate", Object.keys(engine.getState().candidateDecisions).length === 1);
    check("rename propagates replacement text", engine.getState().candidateDecisions[candA]?.replacement === "Redacted Person");

    const r3 = engine.dispatch({ family: "review", type: "redactCandidate", candidateId: candA });
    check("redactCandidate supersedes Rename", engine.getState().candidateDecisions[candA]?.decision === "Redact");
    check("redactCandidate with no replacement clears prior rename text", engine.getState().candidateDecisions[candA]?.replacement === undefined);
    void r3;

    const r4 = engine.dispatch({ family: "review", type: "ignoreCandidate", candidateId: candA });
    check("ignoreCandidate succeeds", r4.ok);
    check("Ignore is the final current decision", engine.getState().candidateDecisions[candA]?.decision === "Ignore");
    check(
      "Ignore does not destroy evidence -- underlying DetectionResult candidate is untouched",
      transcript.detection.candidates.find((c) => c.id === candA)?.displayValue !== undefined
    );
  }

  console.log("--- Rename validation ---");
  {
    const engine = freshEngine(transcript, "s-rename-validation");
    const blank = engine.dispatch({ family: "review", type: "renameCandidate", candidateId: candA, replacement: "   " });
    check("blank rename text is rejected", blank.ok === false && !!blank.reason);
    check("rejected command does not mutate state", !(candA in engine.getState().candidateDecisions));

    const missing = engine.dispatch({ family: "review", type: "renameCandidate", candidateId: "no-such-candidate", replacement: "X" });
    check("unknown candidateId is rejected", missing.ok === false);
  }

  console.log("--- Reset decisions is durable reversal, not undo ---");
  {
    const engine = freshEngine(transcript, "s-reset");
    engine.dispatch({ family: "review", type: "keepCandidate", candidateId: candA });
    engine.dispatch({ family: "review", type: "redactCandidate", candidateId: candB });
    const sequenceBeforeReset = engine.getState().entityRegistry.nextSequence;
    const eventCountBeforeReset = engine.getState().events.length;
    const reset = engine.dispatch({ family: "review", type: "resetDecisions", candidateIds: [candA], scope: "zone" });
    check("resetDecisions succeeds for a decided candidate", reset.ok);
    check("the reset candidate returns to unresolved/currently undecided", engine.getState().candidateDecisions[candA] === undefined);
    check("other decided candidates are untouched", engine.getState().candidateDecisions[candB]?.decision === "Redact");
    check("entity acknowledgement is detached for the reset candidate", engine.getState().entityRegistry.entityIdByCandidateId[candA] === undefined);
    check("entity registry sequencing remains monotonic", engine.getState().entityRegistry.nextSequence === sequenceBeforeReset);
    check("prior decision events are left intact", engine.getState().events.slice(0, eventCountBeforeReset).every((event) => event.kind === "candidate-decided"));
    check(
      "reset appends one per-candidate event plus one reset anchor",
      engine.getState().events.slice(eventCountBeforeReset).map((event) => event.kind).join(",") === "candidate-reset,decisions-reset"
    );
    const noOp = engine.dispatch({ family: "review", type: "resetDecisions", candidateIds: [candA], scope: "zone" });
    check("resetting an already-unresolved candidate is rejected as a no-op", noOp.ok === false);
  }

  console.log("--- Deterministic serialization + reload fidelity ---");
  {
    const engine = freshEngine(transcript, "s-serialize");
    engine.dispatch({ family: "review", type: "keepCandidate", candidateId: candA });
    engine.dispatch({ family: "review", type: "redactCandidate", candidateId: candB, replacement: "[CUSTOM REDACTED]" });
    engine.dispatch({ family: "review", type: "ignoreCandidate", candidateId: candC });

    const serialized1 = serializeReviewSession(engine.getState());
    const serialized2 = serializeReviewSession(engine.getState());
    check("serializing the same state twice is byte-identical", serialized1 === serialized2);

    const parsed = deserializeReviewSession(serialized1);
    check("deserialization succeeds", parsed.ok);
    if (parsed.ok) {
      check("reload fidelity: round-tripped session matches original", JSON.stringify(parsed.session) === serialized1);
      check("reload fidelity: candidateDecisions survive round-trip", JSON.stringify(parsed.session.candidateDecisions) === JSON.stringify(engine.getState().candidateDecisions));
      const reserialized = serializeReviewSession(parsed.session);
      check("re-serializing the round-tripped session is still byte-identical", reserialized === serialized1);
    }
  }

  console.log("--- Repeated save/load cycles ---");
  {
    const engine = freshEngine(transcript, "s-repeated-cycles");
    engine.dispatch({ family: "review", type: "keepCandidate", candidateId: candA });
    let serialized = serializeReviewSession(engine.getState());
    let stable = true;
    for (let i = 0; i < 5; i++) {
      const parsed = deserializeReviewSession(serialized);
      if (!parsed.ok) {
        stable = false;
        break;
      }
      const reserialized = serializeReviewSession(parsed.session);
      if (reserialized !== serialized) {
        stable = false;
        break;
      }
      serialized = reserialized;
    }
    check("5 repeated save/load cycles are all stable (no drift)", stable);
  }

  console.log("--- Malformed / foreign save-file rejection ---");
  {
    const badJson = deserializeReviewSession("{not json");
    check("invalid JSON is rejected, not thrown", badJson.ok === false);

    const noVersion = deserializeReviewSession(JSON.stringify({ sessionId: "x" }));
    check("missing schemaVersion is rejected", noVersion.ok === false);

    const futureVersion = deserializeReviewSession(JSON.stringify({ schemaVersion: 999, sessionId: "x" }));
    check("future/unknown schemaVersion is rejected rather than guessed at", futureVersion.ok === false);

    const truncated = deserializeReviewSession(JSON.stringify({ schemaVersion: 1, sessionId: "x" }));
    check("structurally incomplete v1 payload is rejected", truncated.ok === false);
  }

  console.log("--- Not Quite behavior (real entity group from entity-resolution-001) ---");
  {
    const group = entityRes.grouping.entityGroupProposals[0];
    if (!group) throw new Error("entity-resolution-001 fixture has no entity group proposals");
    const engine = freshEngine(entityRes, "s-not-quite");

    const enter = engine.dispatch({ family: "review", type: "enterNotQuite", groupId: group.groupId });
    check("enterNotQuite succeeds for a real proposed group", enter.ok);
    const afterEnter = engine.getState();
    check("Not Quite does not decide any member (preserves unresolved work)", group.candidateIds.every((id) => !(id in afterEnter.candidateDecisions)));
    check("Not Quite members mirror the group's proposed candidateIds", JSON.stringify(Object.keys(afterEnter.activeNotQuite?.members ?? {}).sort()) === JSON.stringify([...group.candidateIds].sort()));

    const reenter = engine.dispatch({ family: "review", type: "enterNotQuite", groupId: group.groupId });
    check("re-entering the same open Not Quite group is rejected", reenter.ok === false);

    const otherGroup = entityRes.grouping.entityGroupProposals[1];
    if (otherGroup) {
      const enterOther = engine.dispatch({ family: "review", type: "enterNotQuite", groupId: otherGroup.groupId });
      check("entering a DIFFERENT group while one is open is rejected (approved deviation from Python's silent swap)", enterOther.ok === false);
    }

    const firstMember = group.candidateIds[0]!;
    const applyResult = engine.dispatch({ family: "review", type: "applyNotQuiteMember", groupId: group.groupId, candidateId: firstMember, action: "Keep" });
    check("applyNotQuiteMember succeeds", applyResult.ok);
    check("applyNotQuiteMember immediately applies the underlying candidate decision", engine.getState().candidateDecisions[firstMember]?.decision === "Keep");
    check("applied member is marked applied in Not Quite sub-state", engine.getState().activeNotQuite?.members[firstMember]?.applied === true);

    if (group.candidateIds.length > 1) {
      check("allMembersHandled is false while members remain unapplied", engine.getState().activeNotQuite?.allMembersHandled === false);
    }

    // Oracle-confirmed behavior: completeNotQuite does NOT require every
    // member to be individually decided first (test_not_quite_complete_
    // requires_explicit_stage_completion in the Python test suite fires
    // "Not Quite Complete" against candidates with mixed/undecided
    // states and asserts it succeeds without forcing any decision).
    const complete = engine.dispatch({ family: "review", type: "completeNotQuite", groupId: group.groupId });
    check("completeNotQuite succeeds even with unresolved members (matches Python oracle)", complete.ok);
    check("completeNotQuite does not force-decide unresolved members", group.candidateIds.slice(1).every((id) => !(id in engine.getState().candidateDecisions)) || group.candidateIds.length === 1);
    const groupDecision = engine.getState().groupDecisions[group.groupId];
    check("completeNotQuite records an EntityGroupDecision with kind Refined", groupDecision?.decision === "Refined");
    check(
      "EntityGroupDecision.confirmedMemberCandidateIds covers all proposed members regardless of decision status",
      JSON.stringify([...(groupDecision?.confirmedMemberCandidateIds ?? [])].sort()) === JSON.stringify([...group.candidateIds].sort())
    );

    const exit = engine.dispatch({ family: "review", type: "exitNotQuite", groupId: group.groupId });
    check("exitNotQuite succeeds", exit.ok);
    check("exitNotQuite clears activeNotQuite", engine.getState().activeNotQuite === null);

    const doubleExit = engine.dispatch({ family: "review", type: "exitNotQuite", groupId: group.groupId });
    check("exiting an already-closed Not Quite group is rejected", doubleExit.ok === false);
  }

  console.log("--- Not Quite: applying a member not in the group is rejected ---");
  {
    const group = entityRes.grouping.entityGroupProposals[0]!;
    const engine = freshEngine(entityRes, "s-not-quite-invalid-member");
    engine.dispatch({ family: "review", type: "enterNotQuite", groupId: group.groupId });
    const outsider = transcript.detection.candidates.find((c) => !group.candidateIds.includes(c.id));
    if (outsider) {
      const result = engine.dispatch({ family: "review", type: "applyNotQuiteMember", groupId: group.groupId, candidateId: outsider.id, action: "Keep" });
      check("applying a decision for a non-member candidate is rejected", result.ok === false);
    }
    const blankRename = engine.dispatch({
      family: "review",
      type: "applyNotQuiteMember",
      groupId: group.groupId,
      candidateId: group.candidateIds[0]!,
      action: "Rename",
      draftReplacement: "   ",
    });
    check("Not Quite member Rename with blank text is rejected", blankRename.ok === false);
  }

  console.log("--- Determinism across two independently-constructed engines ---");
  {
    const engineA = freshEngine(transcript, "s-determinism");
    const engineB = freshEngine(transcript, "s-determinism");
    const commands = [
      { family: "review" as const, type: "keepCandidate" as const, candidateId: candA },
      { family: "review" as const, type: "renameCandidate" as const, candidateId: candB, replacement: "Person X" },
      { family: "review" as const, type: "ignoreCandidate" as const, candidateId: candC },
      { family: "review" as const, type: "redactCandidate" as const, candidateId: candD },
    ];
    for (const command of commands) {
      engineA.dispatch(command);
      engineB.dispatch(command);
    }
    check("two engines given identical commands + clock produce byte-identical state", serializeReviewSession(engineA.getState()) === serializeReviewSession(engineB.getState()));
  }

  console.log(`\n${passCount}/${passCount + failCount} checks passed`);
  process.exitCode = failCount === 0 ? 0 : 1;
}

main();
