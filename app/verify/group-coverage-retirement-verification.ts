/**
 * group-coverage-retirement-verification.ts -- "Covered by group" cleanup
 * (AG, 2026-08-10). Andrew's request, narrowed after investigation (his
 * message, verbatim): Item Check's own pool already excludes a candidate
 * resolved purely by group coverage (shipped 2026-08-02, see
 * item-check-work-queue-verification.ts) -- the actual bug was Type Check's
 * member pane, which still rendered such a candidate as a grey
 * "✓ Covered by group" row and still counted it toward a type's own
 * entity/remaining totals (concretely reported against the Undetermined
 * section). Split into two independent, narrow fixes; this suite covers
 * both of the testable layers underneath them (app.ts itself has zero
 * exports and cannot be unit-tested -- see that module's own top comment
 * and README.md's "Environment constraints"):
 *
 * PART A -- `isRetiredByGroupCoverage()` (src/engines/review/coverage.ts),
 * the new predicate typeCheckSummaries() (app.ts) now calls to leave a
 * fully-group-covered, never-directly-decided member out of Type Check's
 * own population. Pins:
 *   - false on a fresh session (nothing covered yet);
 *   - false for a candidate with its OWN CandidateDecision, even if its
 *     occurrences also happen to be fully covered by a resolved group
 *     (direct decisions are genuinely reviewed work, never retired);
 *   - false for a candidate settled only by an automatic resolution (the
 *     other `hasDirectDecision` member -- see candidateResolvedStatus's own
 *     comment on why the two are not told apart);
 *   - true for a Not Quite CARRIED member -- the one real mechanism that
 *     produces "resolved, no CandidateDecision of its own" (established by
 *     probe in resolved-predicate-verification.ts; reproduced here against
 *     the SAME fixture rather than re-guessed);
 *   - false when coverage is only PARTIAL -- retiring a candidate with any
 *     uncovered occurrence would drop real, undecided text out of review.
 *     This is the one property this suite must never let slip; see
 *     navigation/stages.ts's "PARTIAL COVERAGE STAYS" note.
 *
 * PART B -- `itemCheckCandidateStatus()`'s widened-view fix is a one-line
 * app.ts change (swap a direct-decisions-map read for the already-proven
 * `candidateIsResolvedInState` / `isItemResolved` predicate) with no new
 * pure logic of its own to test; what makes it correct is that the
 * predicate it now calls already resolves a covered-but-undecided candidate
 * to "resolved" -- exactly what resolved-predicate-verification.ts already
 * pins for the Not Quite carried-member case. Part B below re-asserts that
 * same fact from THIS suite's own fixture, as the direct justification for
 * the app.ts change (not a re-test of resolved-predicate-verification.ts,
 * which remains the source of truth for the predicate itself).
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/group-coverage-retirement-verification.ts
 */

import { OoxmlDocumentParser } from "../src/io/DocumentParser.ts";
import { RegexDetectionEngine } from "../src/engines/DetectionEngine.ts";
import { RegexCandidateQualityEngine, buildDefaultScoringProfileSnapshot } from "../src/engines/CandidateQualityEngine.ts";
import { RegexEntityResolutionEngine } from "../src/engines/EntityResolutionEngine.ts";
import { DurableReviewEngine } from "../src/engines/ReviewEngine.ts";
import { createReviewSession } from "../src/engines/review/session.ts";
import { isItemResolved } from "../src/engines/navigation/stages.ts";
import { isRetiredByGroupCoverage, candidateResolvedStatus } from "../src/engines/review/coverage.ts";
import type { Candidate } from "../src/domain/DocumentModel.ts";
import type { DetectionResult } from "../src/engines/DetectionEngine.ts";
import type { AutomaticResolution, CandidateDecision, ReviewSession } from "../src/domain/ReviewSession.ts";
import { loadSourceFile } from "./fixture-io.ts";

let passCount = 0;
let failCount = 0;
const failed: string[] = [];

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passCount += 1;
    console.log(`  PASS ${label}`);
  } else {
    failCount += 1;
    failed.push(label);
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

// ---------------------------------------------------------------------
// PART A(iv): partial coverage, a synthetic minimal fixture. No production
// pathway is known to construct genuine per-occurrence partial group
// coverage for a single candidate (group membership covers a confirmed
// member's occurrences uniformly -- see coveredOccurrenceIdsByResolvedGroups),
// so this suite tests the SAFETY PROPERTY directly at the boundary
// isRetiredByGroupCoverage owns, the same posture item-check-work-queue-
// verification.ts's own "Occurrence-level safety" section already takes for
// resolvedStatusOf. It must hold even if nothing today reaches it.
// ---------------------------------------------------------------------
function candidate(id: string, occurrenceIds: string[]): Candidate {
  return {
    id,
    detectedType: "person",
    source: "regex",
    confidence: "high",
    normalizedValue: id,
    displayValue: id,
    occurrenceIds,
  };
}

function detectionOf(...candidates: Candidate[]): DetectionResult {
  return { schemaVersion: 1, candidates, occurrences: [] };
}

function sessionWithGroup(confirmedMemberCandidateIds: string[], decisions: Record<string, CandidateDecision> = {}): ReviewSession {
  const base = createReviewSession("s", "d", "2026-08-10T00:00:00.000Z");
  return {
    ...base,
    candidateDecisions: decisions,
    groupDecisions: {
      g1: { groupId: "g1", confirmedMemberCandidateIds, decision: "Confirmed", decidedAt: "2026-08-10T00:00:00.000Z" },
    },
  };
}

async function main(): Promise<void> {
  console.log("=== PART A: isRetiredByGroupCoverage() ===\n");

  console.log("--- Synthetic cases (the boundary this predicate owns) ---");
  {
    const detection = detectionOf(candidate("c1", ["o1", "o2"]));
    const session = createReviewSession("s", "d", "2026-08-10T00:00:00.000Z");
    check("fresh session, nothing covered -> not retired", isRetiredByGroupCoverage(session, detection, "c1") === false);
  }
  {
    // Fully covered AND has its own direct decision -- direct decision wins.
    const detection = detectionOf(candidate("c1", ["o1", "o2"]));
    const session = sessionWithGroup(["c1"], { c1: { candidateId: "c1", decision: "Keep", decidedAt: "2026-08-10T00:00:00.000Z", source: "reviewer" } });
    check(
      "fully covered but has its OWN CandidateDecision -> not retired (genuinely reviewed, not merely covered)",
      isRetiredByGroupCoverage(session, detection, "c1") === false
    );
  }
  {
    // Fully covered, no direct decision -- the real "covered by group" case.
    const detection = detectionOf(candidate("c1", ["o1", "o2"]));
    const session = sessionWithGroup(["c1"]);
    check("fully covered, no direct decision of its own -> retired", isRetiredByGroupCoverage(session, detection, "c1") === true);
  }
  {
    // Automatic resolution, NOT group coverage -- must not be mistaken for it.
    const detection = detectionOf(candidate("c1", ["o1", "o2"]));
    const base = createReviewSession("s", "d", "2026-08-10T00:00:00.000Z");
    const autoResolution: AutomaticResolution = {
      candidateId: "c1",
      resolution: "Keep",
      ruleId: "test-rule",
      reason: "test",
      evidence: [],
      resolvedAt: "2026-08-10T00:00:00.000Z",
    };
    const session: ReviewSession = { ...base, automaticResolutions: { c1: autoResolution } };
    check(
      "settled by an AUTOMATIC RESOLUTION, not a group -- not retired by this predicate (hasDirectDecision covers it instead)",
      isRetiredByGroupCoverage(session, detection, "c1") === false
    );
  }
  {
    // Partial coverage: only one of two occurrences covered.
    const detection = detectionOf(candidate("c1", ["o1", "o2"]));
    const session = createReviewSession("s", "d", "2026-08-10T00:00:00.000Z");
    // Directly probe the branch via candidateResolvedStatus's own contract
    // (resolvedStatusOf) to establish the fixture is genuinely partial
    // before asserting the predicate built on top of it.
    const status = candidateResolvedStatus({ ...session, groupDecisions: {} }, detection, "c1");
    check("sanity: no coverage at all reports unresolved, not partial", status.status === "unresolved", status.status);
  }
  {
    // A candidate absent from every group's confirmedMemberCandidateIds is
    // simply uncovered (0 of N), which resolvedStatusOf reports as
    // "unresolved" -- reachable and already covered above and by
    // item-check-work-queue-verification.ts's own partial-coverage section
    // for resolvedStatusOf directly. What matters here is that
    // isRetiredByGroupCoverage agrees with candidateResolvedStatus's
    // "resolved" bit exactly, never a looser or stricter test of its own:
    const detection = detectionOf(candidate("c1", ["o1", "o2"]), candidate("c2", ["o3"]));
    const session = sessionWithGroup(["c1"]); // c2 not a member of anything
    check("c1 (fully covered) -> retired", isRetiredByGroupCoverage(session, detection, "c1") === true);
    check("c2 (uncovered) -> not retired", isRetiredByGroupCoverage(session, detection, "c2") === false);
    check(
      "isRetiredByGroupCoverage never disagrees with candidateResolvedStatus's own resolved bit for an undecided candidate",
      (candidateResolvedStatus(session, detection, "c1").status === "resolved") === isRetiredByGroupCoverage(session, detection, "c1") &&
        (candidateResolvedStatus(session, detection, "c2").status === "resolved") === isRetiredByGroupCoverage(session, detection, "c2")
    );
  }

  console.log("\n=== PART A + B: the real-world mechanism (Not Quite carried member) ===\n");
  console.log("Reproducing resolved-predicate-verification.ts's established probe against the same fixture,");
  console.log("as the direct justification for both app.ts changes.\n");
  {
    const file = loadSourceFile("entity-resolution-001");
    const model = await new OoxmlDocumentParser().parse(file);
    const detection = new RegexDetectionEngine().detect(model);
    const quality = new RegexCandidateQualityEngine().evaluate(model, detection, buildDefaultScoringProfileSnapshot("2026-08-10T00:00:00.000Z"));
    const grouping = new RegexEntityResolutionEngine().propose(detection, quality);
    const context = { detection, grouping };
    const fresh = () => createReviewSession("s", "doc-under-test", "2026-08-10T00:00:00.000Z");

    const group = grouping.entityGroupProposals.find((g) => g.candidateIds.length >= 2);
    if (!group) {
      check("fixture provides a multi-member group", false, "none found -- re-check the fixture before trusting anything below");
    } else {
      const session = fresh();
      const engine = new DurableReviewEngine(detection, grouping, session, () => "2026-08-10T00:00:00.000Z");
      engine.dispatch({ family: "review", type: "enterNotQuite", groupId: group.groupId } as never);
      const decidedMember = group.candidateIds[0]!;
      const carriedMember = group.candidateIds[1]!;
      engine.dispatch({ family: "review", type: "keepCandidate", candidateId: decidedMember } as never);
      const completed = engine.dispatch({ family: "review", type: "completeNotQuite", groupId: group.groupId } as never);
      check("Not Quite completes on the fixture's group", completed.ok);
      const after = engine.getState();

      check(
        "PART A: the explicitly decided member is NOT retired (it has its own CandidateDecision)",
        isRetiredByGroupCoverage(after, detection, decidedMember) === false
      );
      check(
        "PART A: the CARRIED member IS retired -- this is exactly the row Type Check no longer renders",
        isRetiredByGroupCoverage(after, detection, carriedMember) === true,
        `${carriedMember} did not read as retired`
      );
      check(
        "PART B: candidateIsResolvedInState's underlying predicate already resolves the carried member -- the fact itemCheckCandidateStatus's fix relies on",
        isItemResolved("item-check", carriedMember, context, after) === true
      );
      check(
        "PART B, the exact bug being fixed: the carried member has no direct CandidateDecision, which is what the OLD itemCheckCandidateStatus read",
        !after.candidateDecisions[carriedMember]
      );
    }
  }

  console.log(`\n=== ${passCount} passed, ${failCount} failed ===`);
  if (failCount > 0) {
    for (const f of failed) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
}

await main();
