/**
 * Verification harness for the Group Check revision (2026-07-29) -- see
 * docs/detection/group-check-revision.md for the full design rationale.
 * Andrew's request came from a screenshot of local_web_app.py's (Python
 * oracle) Group Check UI, but the work landed entirely in DocScrub-Web per
 * his explicit instruction ("Do not fix Python... Incorporate these into
 * the new version").
 *
 * Covers the two genuinely new pure functions this revision added:
 *
 * Part A -- groupDisplayDecision() (src/engines/review/coverage.ts): what a
 * Group Check row should DISPLAY, derived fresh from member
 * candidateDecisions every time, never a stored field. Directly verifies
 * Andrew's confirmed rule -- a Not Quite group where every member ends up
 * decided the SAME way collapses to that single decision on display; any
 * mixed or partial outcome stays flagged ("needsAttention") rather than
 * being guessed at.
 *
 * Part B -- compareGroups()/sortGroups() (src/ui/groupCheckQuery.ts): the
 * sort layer that makes "what order groups are displayed in" a real,
 * inspectable thing -- the missing piece that let the nav-order fix
 * (moveWithinVisibleList in app.ts, not separately unit-tested here, same
 * precedent as goToAdjacentInVisibleList before it -- real browser
 * validation covers the keyboard-interception wiring) redirect arrow-key
 * movement through the currently-displayed order instead of
 * itemIdsForStage()'s fixed structural order.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/group-check-revision-verification.ts
 */

import { groupDisplayDecision } from "../src/engines/review/coverage.ts";
import { compareGroups, sortGroups, buildGroupQueryFacts, type GroupSortOrder } from "../src/ui/groupCheckQuery.ts";
import { createReviewSession } from "../src/engines/review/session.ts";
import type { EntityGroupProposal } from "../src/engines/EntityResolutionEngine.ts";
import type { CandidateDecision, CandidateDecisionKind, ReviewSession } from "../src/domain/ReviewSession.ts";

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

function group(groupId: string, candidateIds: string[], confidence = 80, canonicalName = groupId): EntityGroupProposal {
  return {
    groupId,
    candidateIds,
    originalProposalConfidence: confidence,
    canonicalName,
    detectedType: "person",
    memberConfidences: Object.fromEntries(candidateIds.map((id) => [id, confidence])),
    reasons: ["deterministic_grouping"],
  };
}

function withDecisions(decisions: Record<string, CandidateDecisionKind>): ReviewSession {
  const session = createReviewSession("s1", "d1", "2026-07-29T00:00:00.000Z");
  const candidateDecisions: Record<string, CandidateDecision> = {};
  for (const [candidateId, decision] of Object.entries(decisions)) {
    candidateDecisions[candidateId] = { candidateId, decision, decidedAt: "2026-07-29T00:00:00.000Z", source: "reviewer" };
  }
  return { ...session, candidateDecisions };
}

async function main(): Promise<void> {
  console.log("=== Part A: groupDisplayDecision() ===\n");

  {
    const g = group("g1", ["c1", "c2", "c3"]);
    const session = withDecisions({});
    const display = groupDisplayDecision(g, session);
    check("no member decided -> undecided", display.kind === "undecided", JSON.stringify(display));
  }

  for (const decision of ["Keep", "Rename", "Redact", "Ignore"] as const) {
    const g = group("g1", ["c1", "c2", "c3"]);
    const session = withDecisions({ c1: decision, c2: decision, c3: decision });
    const display = groupDisplayDecision(g, session);
    check(`every member ${decision} -> uniform/${decision}`, display.kind === "uniform" && display.decision === decision, JSON.stringify(display));
  }

  {
    // Andrew's exact scenario: a Not Quite group where the reviewer
    // manually chose Keep for every member -- "you manually chose that
    // path line by line, so let's reflect the outcome."
    const g = group("g-not-quite", ["m1", "m2", "m3", "m4"]);
    const session = withDecisions({ m1: "Keep", m2: "Keep", m3: "Keep", m4: "Keep" });
    const display = groupDisplayDecision(g, session);
    check("Not-Quite-derived all-Keep group displays as uniform Keep", display.kind === "uniform" && display.decision === "Keep");
  }

  {
    // Andrew's confirmed rule for the OTHER case: mixed outcomes stay
    // flagged, never collapsed to a guessed single decision.
    const g = group("g2", ["c1", "c2", "c3"]);
    const session = withDecisions({ c1: "Keep", c2: "Redact", c3: "Keep" });
    const display = groupDisplayDecision(g, session);
    check("mixed member decisions -> needsAttention, not collapsed to a guess", display.kind === "needsAttention", JSON.stringify(display));
  }

  {
    const g = group("g3", ["c1", "c2", "c3"]);
    const session = withDecisions({ c1: "Keep" }); // c2, c3 still undecided
    const display = groupDisplayDecision(g, session);
    check("partially decided (some undecided) -> needsAttention, not undecided", display.kind === "needsAttention", JSON.stringify(display));
  }

  {
    // A group can reach "uniform" without EVER going through Group Check or
    // Not Quite at all -- e.g. every member individually decided from Item
    // Check. groupDisplayDecision must not care how the state was reached.
    const g = group("g4", ["c1", "c2"]);
    const session = withDecisions({ c1: "Redact", c2: "Redact" });
    const display = groupDisplayDecision(g, session);
    check("uniform outcome reached via Item Check alone (no Group Check command) still shows uniform", display.kind === "uniform" && display.decision === "Redact");
  }

  {
    const g = group("g-empty", []);
    const session = withDecisions({});
    const display = groupDisplayDecision(g, session);
    check("defensive: empty member list -> undecided, not a crash", display.kind === "undecided");
  }

  console.log("\n=== Part B: compareGroups()/sortGroups() ===\n");

  const groups = [group("g-b", ["x", "y"], 60, "Bravo"), group("g-a", ["x", "y", "z"], 90, "Alpha"), group("g-c", ["x"], 60, "Charlie")];
  const session = createReviewSession("s2", "d2", "2026-07-29T00:00:00.000Z");
  const facts = buildGroupQueryFacts(groups, session);

  function orderFor(order: GroupSortOrder): string[] {
    return sortGroups(facts, order).map((f) => f.group.groupId);
  }

  check("confidence-desc: highest confidence first", JSON.stringify(orderFor("confidence-desc")) === JSON.stringify(["g-a", "g-b", "g-c"]), orderFor("confidence-desc").join(","));
  check("confidence-asc: lowest confidence first, tie broken by groupId", JSON.stringify(orderFor("confidence-asc")) === JSON.stringify(["g-b", "g-c", "g-a"]), orderFor("confidence-asc").join(","));
  check("member-count-desc: most members first", JSON.stringify(orderFor("member-count-desc")) === JSON.stringify(["g-a", "g-b", "g-c"]), orderFor("member-count-desc").join(","));
  check("member-count-asc: fewest members first", JSON.stringify(orderFor("member-count-asc")) === JSON.stringify(["g-c", "g-b", "g-a"]), orderFor("member-count-asc").join(","));
  check("alphabetical: canonicalName order", JSON.stringify(orderFor("alphabetical")) === JSON.stringify(["g-a", "g-b", "g-c"]), orderFor("alphabetical").join(","));

  {
    // sortGroups must not mutate its input -- the same discipline
    // queryItemCheck's own tests already hold it to.
    const before = facts.map((f) => f.group.groupId);
    sortGroups(facts, "alphabetical");
    check("sortGroups does not mutate the input array", JSON.stringify(facts.map((f) => f.group.groupId)) === JSON.stringify(before));
  }

  {
    // Determinism: two groups with identical confidence sort by groupId,
    // never by incidental input order -- same tie-break discipline
    // compareCandidates() already established for Item Check.
    const tied = [group("g-z", ["x"], 50, "Same"), group("g-a", ["x"], 50, "Same")];
    const tiedFacts = buildGroupQueryFacts(tied, session);
    const order = sortGroups(tiedFacts, "confidence-desc").map((f) => f.group.groupId);
    check("tied confidence breaks the tie on groupId, deterministically", JSON.stringify(order) === JSON.stringify(["g-a", "g-z"]), order.join(","));
  }

  console.log(`\n${passCount}/${passCount + failCount} checks passed`);
  process.exitCode = failCount === 0 ? 0 : 1;
}

main();
