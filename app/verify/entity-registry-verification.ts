/**
 * Verification harness for the Entity/Decision Separation change (schema
 * v2): EntityRegistry.ts's applyEntityAcknowledgement(), ReviewSession.ts's
 * isPositiveAcknowledgement() predicate, and session.ts's decideCandidate()
 * wiring that maintains entityRegistry as a side effect of every existing
 * review command -- no new command was added.
 *
 * Same property/behavior-suite spirit as review-engine-verification.ts
 * (which this suite deliberately mirrors -- DurableReviewEngine driven
 * directly against a real fixture's detection/grouping, not through the
 * full Workspace/Dispatcher stack, since this is reducer-level behavior
 * with no UI/navigation surface of its own). There is no Python oracle for
 * this: EntityRegistry is new domain state with no prior export.
 *
 * Covers exactly what the architectural change claims:
 *   - Keep/Redact/Rename each produce exactly one confirmed entity for a
 *     standalone candidate; Ignore never does.
 *   - The SAME EntityId survives a Keep -> Redact -> Rename sequence (the
 *     entity's identity does not change merely because its disposition
 *     did) -- and a subsequent Ignore tears that entity down entirely.
 *   - Group-level bulk commands (confirmGroup/redactGroup/flattenGroup)
 *     and per-member Not Quite decisions all share ONE entity across every
 *     member, anchored by groupId -- this is what makes flattenGroup a
 *     real "Merge" in entity terms, not four independent confirmations.
 *   - ignoreGroup creates no confirmed entity for any member.
 *   - Reassignment: a candidate individually confirmed as its own
 *     singleton entity, later swept into a group action, is detached from
 *     the stale singleton (which is deleted, not left orphaned) and
 *     re-anchored to the group's shared entity.
 *   - bulkApplyDecision (an arbitrary, not-necessarily-one-entity
 *     selection) deliberately does NOT share an entity across the
 *     selection -- each candidate remains its own singleton, proving no
 *     new matching/grouping logic was introduced here.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/entity-registry-verification.ts
 */

import { OoxmlDocumentParser } from "../src/io/DocumentParser.ts";
import { RegexDetectionEngine } from "../src/engines/DetectionEngine.ts";
import { RegexCandidateQualityEngine, buildDefaultScoringProfileSnapshot } from "../src/engines/CandidateQualityEngine.ts";
import { RegexEntityResolutionEngine } from "../src/engines/EntityResolutionEngine.ts";
import { DurableReviewEngine } from "../src/engines/ReviewEngine.ts";
import { createReviewSession } from "../src/engines/review/session.ts";
import type { DetectionResult } from "../src/engines/DetectionEngine.ts";
import type { GroupingResult } from "../src/engines/EntityResolutionEngine.ts";
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

function sortedIds(ids: string[]): string {
  return JSON.stringify([...ids].sort());
}

async function main(): Promise<void> {
  const transcript = await loadFixture("synthetic-transcript-001");
  const entityRes = await loadFixture("entity-resolution-001");

  const candidateIds = transcript.detection.candidates.map((c) => c.id);
  const [candA, candB, candC, candD] = candidateIds;
  if (!candA || !candB || !candC || !candD) throw new Error("fixture does not have enough candidates for this suite");

  const multiMemberGroup = entityRes.grouping.entityGroupProposals.find((g) => g.candidateIds.length >= 2);
  if (!multiMemberGroup) throw new Error("entity-resolution-001 has no multi-member group for this suite");

  console.log("--- Keep/Redact/Rename each confirm exactly one standalone entity ---");
  {
    const engine = freshEngine(transcript, "s-keep");
    engine.dispatch({ family: "review", type: "keepCandidate", candidateId: candA });
    const registry = engine.getState().entityRegistry;
    check("exactly one entity exists after Keep", Object.keys(registry.entities).length === 1);
    const entityId = registry.entityIdByCandidateId[candA];
    check("candidate is indexed to an entity", !!entityId);
    check("the entity's sole member is this candidate", entityId !== undefined && registry.entities[entityId]?.memberCandidateIds.join(",") === candA);
    check("the entity's anchor is the candidateId itself (no groupId context)", entityId !== undefined && registry.entities[entityId]?.anchor === candA);
  }
  {
    const engine = freshEngine(transcript, "s-redact");
    engine.dispatch({ family: "review", type: "redactCandidate", candidateId: candB });
    const registry = engine.getState().entityRegistry;
    check("Redact confirms an entity too", registry.entityIdByCandidateId[candB] !== undefined);
    check("exactly one entity exists", Object.keys(registry.entities).length === 1);
  }
  {
    const engine = freshEngine(transcript, "s-rename");
    engine.dispatch({ family: "review", type: "renameCandidate", candidateId: candC, replacement: "Some Name" });
    const registry = engine.getState().entityRegistry;
    check("Rename confirms an entity too", registry.entityIdByCandidateId[candC] !== undefined);
    check("exactly one entity exists", Object.keys(registry.entities).length === 1);
  }

  console.log("--- Ignore never creates a confirmed entity ---");
  {
    const engine = freshEngine(transcript, "s-ignore-fresh");
    engine.dispatch({ family: "review", type: "ignoreCandidate", candidateId: candA });
    const registry = engine.getState().entityRegistry;
    check("no entity exists after Ignore on a never-decided candidate", Object.keys(registry.entities).length === 0);
    check("candidate is not indexed to any entity", registry.entityIdByCandidateId[candA] === undefined);
  }

  console.log("--- EntityId stability across Keep -> Redact -> Rename, then Ignore revokes it ---");
  {
    const engine = freshEngine(transcript, "s-stability");
    engine.dispatch({ family: "review", type: "keepCandidate", candidateId: candA });
    const idAfterKeep = engine.getState().entityRegistry.entityIdByCandidateId[candA];
    check("Keep mints an entity", !!idAfterKeep);

    engine.dispatch({ family: "review", type: "redactCandidate", candidateId: candA });
    const idAfterRedact = engine.getState().entityRegistry.entityIdByCandidateId[candA];
    check("Redact reuses the SAME entityId -- same entity, new disposition", idAfterRedact === idAfterKeep);

    engine.dispatch({ family: "review", type: "renameCandidate", candidateId: candA, replacement: "Andrew Jackson" });
    const idAfterRename = engine.getState().entityRegistry.entityIdByCandidateId[candA];
    check("Rename reuses the SAME entityId again", idAfterRename === idAfterKeep);
    check("exactly one entity ever existed across all three decisions -- no duplicate minted", Object.keys(engine.getState().entityRegistry.entities).length === 1);

    engine.dispatch({ family: "review", type: "ignoreCandidate", candidateId: candA });
    const registryAfterIgnore = engine.getState().entityRegistry;
    check("Ignore tears the entity down entirely, not just marks it unconfirmed", Object.keys(registryAfterIgnore.entities).length === 0);
    check("candidate is no longer indexed to any entity after Ignore", registryAfterIgnore.entityIdByCandidateId[candA] === undefined);
    check(
      "the underlying CandidateDecision itself is still Ignore (entity revocation does not touch the decision record)",
      engine.getState().candidateDecisions[candA]?.decision === "Ignore"
    );
  }

  console.log("--- Group Confirm (Keep as-is): one shared entity across every member ---");
  {
    const engine = freshEngine(entityRes, "s-confirm-group");
    const result = engine.dispatch({ family: "review", type: "confirmGroup", groupId: multiMemberGroup.groupId });
    check("confirmGroup succeeds", result.ok, result.reason);

    const registry = engine.getState().entityRegistry;
    const entityIds = multiMemberGroup.candidateIds.map((id) => registry.entityIdByCandidateId[id]);
    check("every member is indexed to SOME entity", entityIds.every((id) => !!id));
    check("every member is indexed to the SAME entity -- confirming a group merges its members into one entity", new Set(entityIds).size === 1);

    const sharedEntityId = entityIds[0]!;
    check(
      "the shared entity's membership is exactly the group's candidateIds, no more, no fewer",
      sortedIds(registry.entities[sharedEntityId]!.memberCandidateIds) === sortedIds(multiMemberGroup.candidateIds)
    );
    check("the shared entity's anchor is the groupId, not any one member's candidateId", registry.entities[sharedEntityId]!.anchor === multiMemberGroup.groupId);
    check("exactly one entity exists in total", Object.keys(registry.entities).length === 1);
  }

  console.log("--- Flatten Group (Rename/\"Merge\"): also one shared entity across every member ---");
  {
    const engine = freshEngine(entityRes, "s-flatten-group");
    const result = engine.dispatch({ family: "review", type: "flattenGroup", groupId: multiMemberGroup.groupId });
    check("flattenGroup succeeds", result.ok, result.reason);

    const registry = engine.getState().entityRegistry;
    const entityIds = multiMemberGroup.candidateIds.map((id) => registry.entityIdByCandidateId[id]);
    check("every member shares the same entity after Flatten/Merge", new Set(entityIds).size === 1 && entityIds.every((id) => !!id));
    check(
      "every member's underlying decision is Rename to the canonical name (unaffected by entity bookkeeping)",
      multiMemberGroup.candidateIds.every((id) => engine.getState().candidateDecisions[id]?.decision === "Rename")
    );
  }

  console.log("--- Redact Group: also one shared entity, Redact disposition ---");
  {
    const engine = freshEngine(entityRes, "s-redact-group");
    const result = engine.dispatch({ family: "review", type: "redactGroup", groupId: multiMemberGroup.groupId });
    check("redactGroup succeeds", result.ok, result.reason);
    const registry = engine.getState().entityRegistry;
    const entityIds = multiMemberGroup.candidateIds.map((id) => registry.entityIdByCandidateId[id]);
    check("every member shares the same entity after Redact Group", new Set(entityIds).size === 1 && entityIds.every((id) => !!id));
  }

  console.log("--- Ignore Group: no confirmed entity for any member ---");
  {
    const engine = freshEngine(entityRes, "s-ignore-group");
    const result = engine.dispatch({ family: "review", type: "ignoreGroup", groupId: multiMemberGroup.groupId });
    check("ignoreGroup succeeds", result.ok, result.reason);
    const registry = engine.getState().entityRegistry;
    check(
      "no member is indexed to any entity after Ignore Group",
      multiMemberGroup.candidateIds.every((id) => registry.entityIdByCandidateId[id] === undefined)
    );
    check("no entity exists for the group's anchor", registry.entityIdByAnchor[multiMemberGroup.groupId] === undefined);
    check("the registry has zero entities in total", Object.keys(registry.entities).length === 0);
  }

  console.log("--- Not Quite: per-member decisions inside an open group panel share the group's entity ---");
  {
    const engine = freshEngine(entityRes, "s-not-quite");
    engine.dispatch({ family: "review", type: "enterNotQuite", groupId: multiMemberGroup.groupId });
    for (const candidateId of multiMemberGroup.candidateIds) {
      const r = engine.dispatch({ family: "review", type: "applyNotQuiteMember", groupId: multiMemberGroup.groupId, candidateId, action: "Keep" });
      check(`applyNotQuiteMember(Keep) succeeds for ${candidateId}`, r.ok, r.reason);
    }
    const registry = engine.getState().entityRegistry;
    const entityIds = multiMemberGroup.candidateIds.map((id) => registry.entityIdByCandidateId[id]);
    check("per-member Not Quite decisions merge into the SAME entity as a bulk confirm would", new Set(entityIds).size === 1 && entityIds.every((id) => !!id));
  }

  console.log("--- Reassignment: an individually-confirmed singleton is detached and merged when later swept into a group action ---");
  {
    const engine = freshEngine(entityRes, "s-reassign");
    const firstMember = multiMemberGroup.candidateIds[0]!;

    const preResult = engine.dispatch({ family: "review", type: "keepCandidate", candidateId: firstMember });
    check("an individual Keep decision succeeds before any group action", preResult.ok, preResult.reason);
    const singletonEntityId = engine.getState().entityRegistry.entityIdByCandidateId[firstMember];
    check("the individual decision minted its own singleton entity, anchored by candidateId", singletonEntityId !== undefined && engine.getState().entityRegistry.entities[singletonEntityId!]?.anchor === firstMember);
    check("exactly one entity exists so far", Object.keys(engine.getState().entityRegistry.entities).length === 1);

    const confirmResult = engine.dispatch({ family: "review", type: "confirmGroup", groupId: multiMemberGroup.groupId });
    check("confirmGroup succeeds even though one member already had an individual decision", confirmResult.ok, confirmResult.reason);

    const registry = engine.getState().entityRegistry;
    check("the stale singleton entity no longer exists -- it was torn down, not left orphaned", singletonEntityId !== undefined && registry.entities[singletonEntityId!] === undefined);
    const entityIds = multiMemberGroup.candidateIds.map((id) => registry.entityIdByCandidateId[id]);
    check("every member (including the previously-singleton one) now shares ONE group-anchored entity", new Set(entityIds).size === 1 && entityIds.every((id) => !!id));
    check("exactly one entity exists in total after reassignment -- no orphaned leftover", Object.keys(registry.entities).length === 1);
  }

  console.log("--- bulkApplyDecision does NOT share an entity across an arbitrary selection (no new matching logic) ---");
  {
    const engine = freshEngine(transcript, "s-bulk-arbitrary");
    const result = engine.dispatch({ family: "review", type: "bulkApplyDecision", candidateIds: [candA, candB, candC], decision: "Keep" });
    check("bulkApplyDecision succeeds", result.ok, result.reason);
    const registry = engine.getState().entityRegistry;
    const entityIds = [candA, candB, candC].map((id) => registry.entityIdByCandidateId[id]);
    check("each bulk-selected candidate gets its OWN singleton entity", new Set(entityIds).size === 3 && entityIds.every((id) => !!id));
    check("three independent entities exist -- bulk selection asserts no shared identity between arbitrary candidates", Object.keys(registry.entities).length === 3);
  }

  console.log(`\n${passCount}/${passCount + failCount} checks passed`);
  process.exitCode = failCount === 0 ? 0 : 1;
}

main();
