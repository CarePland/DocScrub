/**
 * Verification harness for the Group Check Python-parity revision's live-
 * confidence machinery (2026-07-29) -- see
 * docs/detection/group-check-python-parity-revision.md for the full design
 * rationale. Andrew's request came from two Group Check screenshots of
 * local_web_app.py (Python oracle): member checkboxes with subset bulk
 * actions, a radio quick-pick for choosing rename text without typing, and
 * per-item confidence badges that jump to 100% once a member is decided.
 *
 * Covers the two genuinely new pieces of pure logic this revision added:
 *
 * Part A -- calculateEntityConfidence()'s new `memberScoreOverride` param
 * (src/engines/entity-resolution/resolution.ts): confirms it is purely
 * additive (omitting it reproduces the exact pre-existing behavior) and that
 * supplying it substitutes the override score into the min/mean blend
 * exactly like Python's scoreMemberAgainstCanonical() wrapper does.
 *
 * Part B -- groupLiveConfidence()/memberLiveConfidence()/
 * candidateLiveConfidence() (src/engines/review/coverage.ts): what a
 * confidence badge should DISPLAY given ReviewSession decision state --
 * decided members read as 100, the "was X%" prior note appears only when it
 * differs from current, the group-level +10 reviewer-confirmed bonus never
 * leaks into an individual member's own score, and Item/Ambiguity Check's
 * flat candidates use the simpler no-blend rule.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/live-confidence-verification.ts
 */

import { calculateEntityConfidence, analysisMemberScore, type EntityGroupResult } from "../src/engines/entity-resolution/resolution.ts";
import { groupLiveConfidence, memberLiveConfidence, candidateLiveConfidence } from "../src/engines/review/coverage.ts";
import { RegexEntityResolutionEngine, type EntityGroupProposal } from "../src/engines/EntityResolutionEngine.ts";
import { createReviewSession } from "../src/engines/review/session.ts";
import type { Candidate } from "../src/domain/DocumentModel.ts";
import type { QualityResult } from "../src/domain/Evidence.ts";
import type { CandidateDecision, CandidateDecisionKind, EntityGroupDecision, ReviewSession } from "../src/domain/ReviewSession.ts";
import type { DetectionResult } from "../src/engines/DetectionEngine.ts";

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

// ---- Fixture builders (mirrors group-check-revision-verification.ts's style) --

function candidate(id: string, displayValue: string, confidence: Candidate["confidence"] = "medium"): Candidate {
  return {
    id,
    detectedType: "person",
    source: "regex",
    confidence,
    normalizedValue: displayValue.toLowerCase(),
    displayValue,
    occurrenceIds: [`${id}-occ1`],
  };
}

function groupResult(id: string, candidateKeys: string[], canonicalName = "Andrew Goodloe", confidence = 80): EntityGroupResult {
  return {
    id,
    canonicalName,
    detectedType: "person",
    candidateKeys,
    confidence,
    memberConfidences: Object.fromEntries(candidateKeys.map((k) => [k, confidence])),
    reasons: ["deterministic_grouping", "shared_name_signature"],
  };
}

function proposal(id: string, candidateIds: string[], canonicalName = "Andrew Goodloe", confidence = 80): EntityGroupProposal {
  return {
    groupId: id,
    candidateIds,
    originalProposalConfidence: confidence,
    canonicalName,
    detectedType: "person",
    memberConfidences: Object.fromEntries(candidateIds.map((k) => [k, confidence])),
    reasons: ["deterministic_grouping", "shared_name_signature"],
  };
}

function quality(scores: Record<string, number> = {}): QualityResult {
  return {
    schemaVersion: 1,
    evidenceByCandidate: {},
    scoreByCandidate: scores,
    recommendationByCandidate: {},
    assessmentByCandidate: {},
  };
}

function detectionOf(candidates: Candidate[]): DetectionResult {
  return { schemaVersion: 1, candidates, occurrences: [] };
}

function withDecisions(decisions: Record<string, CandidateDecisionKind>, groupDecisions: Record<string, EntityGroupDecision> = {}): ReviewSession {
  const session = createReviewSession("s1", "d1", "2026-07-29T00:00:00.000Z");
  const candidateDecisions: Record<string, CandidateDecision> = {};
  for (const [candidateId, decision] of Object.entries(decisions)) {
    candidateDecisions[candidateId] = { candidateId, decision, decidedAt: "2026-07-29T00:00:00.000Z", source: "reviewer" };
  }
  return { ...session, candidateDecisions, groupDecisions };
}

async function main(): Promise<void> {
  console.log("=== Part A: calculateEntityConfidence() memberScoreOverride ===\n");

  {
    const candidates = [candidate("c1", "Andrew Goodloe", "high"), candidate("c2", "A. Goodloe", "medium")];
    const candidatesById = new Map(candidates.map((c) => [c.id, c]));
    const g = groupResult("g1", ["c1", "c2"]);
    const qualityOf = () => "Possible" as const;

    const withoutOverride = calculateEntityConfidence(g, candidatesById, qualityOf, ["c1", "c2"]);
    const withUndefinedOverride = calculateEntityConfidence(g, candidatesById, qualityOf, ["c1", "c2"], undefined, false, () => undefined);
    check(
      "omitting memberScoreOverride vs. an override that always returns undefined produce identical scores",
      withoutOverride === withUndefinedOverride,
      `${withoutOverride} vs ${withUndefinedOverride}`
    );
  }

  {
    // A member with an override of 100 should pull the blend up compared to
    // its plain analysis score, exactly like a reviewer-decided member
    // "cashing out" its uncertainty.
    const candidates = [candidate("c1", "Andrew Goodloe", "low"), candidate("c2", "Andy G", "low")];
    const candidatesById = new Map(candidates.map((c) => [c.id, c]));
    const g = groupResult("g2", ["c1", "c2"]);
    const qualityOf = () => "Possible" as const;

    const plain = calculateEntityConfidence(g, candidatesById, qualityOf, ["c1", "c2"]);
    const withC1Decided = calculateEntityConfidence(g, candidatesById, qualityOf, ["c1", "c2"], undefined, false, (id) => (id === "c1" ? 100 : undefined));
    check("overriding one member's score to 100 raises the blended group confidence", withC1Decided > plain, `${plain} -> ${withC1Decided}`);
  }

  {
    // Every member overridden to 100 with reviewerConfirmed should saturate
    // at the 100 cap (min=100, mean=100, +10 bonus clamped by Math.min(100,...)).
    const candidates = [candidate("c1", "Andrew Goodloe"), candidate("c2", "A. Goodloe")];
    const candidatesById = new Map(candidates.map((c) => [c.id, c]));
    const g = groupResult("g3", ["c1", "c2"]);
    const qualityOf = () => "Possible" as const;
    const score = calculateEntityConfidence(g, candidatesById, qualityOf, ["c1", "c2"], undefined, true, () => 100);
    check("all members decided + reviewerConfirmed saturates at 100, never exceeds it", score === 100, String(score));
  }

  {
    // analysisMemberScore should equal the plain per-member score
    // calculateEntityConfidence would use in the absence of any override --
    // i.e. it is genuinely the same ingredient, not a parallel formula.
    const c = candidate("c1", "Andrew Goodloe", "high");
    const qualityOf = () => "Strong" as const;
    const g = groupResult("g4", ["c1"]);
    const candidatesById = new Map([["c1", c]]);
    const viaBlend = calculateEntityConfidence(g, candidatesById, qualityOf, ["c1"]);
    const viaDirect = analysisMemberScore(g.canonicalName, c, qualityOf);
    check("analysisMemberScore matches the single-member blend result (no anchor penalty, no bonus, single score = min = mean)", viaBlend === viaDirect, `${viaBlend} vs ${viaDirect}`);
  }

  console.log("\n=== Part B: groupLiveConfidence() / memberLiveConfidence() / candidateLiveConfidence() ===\n");

  const engine = new RegexEntityResolutionEngine();

  {
    const candidates = [candidate("c1", "Andrew Goodloe", "high"), candidate("c2", "A. Goodloe", "medium")];
    const detection = detectionOf(candidates);
    const q = quality();
    const g = proposal("g1", ["c1", "c2"]);
    const session = withDecisions({});

    const live = groupLiveConfidence(g, detection, q, session, ["c1", "c2"], engine);
    check("no member decided -> no prior note (current === what a fresh recompute gives)", live.prior === undefined, JSON.stringify(live));
  }

  {
    const candidates = [candidate("c1", "Andrew Goodloe", "low"), candidate("c2", "A. Goodloe", "low")];
    const detection = detectionOf(candidates);
    const q = quality();
    const g = proposal("g2", ["c1", "c2"]);
    const session = withDecisions({ c1: "Keep" });

    const live = groupLiveConfidence(g, detection, q, session, ["c1", "c2"], engine);
    check("one member decided -> current differs from prior, prior note present", live.prior !== undefined && live.current !== live.prior, JSON.stringify(live));
    check("current reflects the decided member's score bump (higher than prior)", live.current > (live.prior ?? 0), JSON.stringify(live));
  }

  {
    // The +10 reviewer-confirmed bonus is keyed off session.groupDecisions,
    // not candidateDecisions -- confirms groupLiveConfidence reads the right
    // signal for "has this group ever been stamped by a bulk group action."
    const candidates = [candidate("c1", "Andrew Goodloe"), candidate("c2", "A. Goodloe")];
    const detection = detectionOf(candidates);
    const q = quality();
    const g = proposal("g3", ["c1", "c2"]);
    const groupDecision: EntityGroupDecision = { groupId: "g3", confirmedMemberCandidateIds: ["c1", "c2"], decision: "Confirmed", decidedAt: "2026-07-29T00:00:00.000Z" };

    const withoutBonus = groupLiveConfidence(g, detection, q, withDecisions({}), ["c1", "c2"], engine);
    const withBonus = groupLiveConfidence(g, detection, q, withDecisions({}, { g3: groupDecision }), ["c1", "c2"], engine);
    check("groupDecisions entry for this group raises live confidence via the +10 bonus", withBonus.current > withoutBonus.current, `${withoutBonus.current} vs ${withBonus.current}`);
  }

  {
    // The group-level reviewer-confirmed bonus must NOT leak into a single
    // member's own memberLiveConfidence score.
    const candidates = [candidate("c1", "Andrew Goodloe"), candidate("c2", "A. Goodloe")];
    const detection = detectionOf(candidates);
    const q = quality();
    const g = proposal("g4", ["c1", "c2"]);
    const groupDecision: EntityGroupDecision = { groupId: "g4", confirmedMemberCandidateIds: ["c1", "c2"], decision: "Confirmed", decidedAt: "2026-07-29T00:00:00.000Z" };
    const sessionWithGroupDecision = withDecisions({}, { g4: groupDecision });

    const memberLive = memberLiveConfidence(g, "c1", detection, q, sessionWithGroupDecision, engine);
    // Recompute the group-level bonus directly for the same inputs to prove
    // it is strictly larger than what a (wrongly) bonus-leaking member score
    // would be -- i.e. memberLiveConfidence's un-bonused figure must be
    // lower than groupLiveConfidence's bonused one for the same solo subset.
    const groupLiveForSoloSubset = groupLiveConfidence(g, detection, q, sessionWithGroupDecision, ["c1"], engine);
    check(
      "memberLiveConfidence never applies the group's +10 reviewer-confirmed bonus, unlike groupLiveConfidence on the same solo subset",
      memberLive.current < groupLiveForSoloSubset.current,
      `member=${memberLive.current} group-solo=${groupLiveForSoloSubset.current}`
    );
  }

  {
    // groupLiveConfidence narrowed to a checked subset should match
    // memberLiveConfidence for a lone member (same min/mean/anchor inputs,
    // just no group-level bonus in either case here).
    const candidates = [candidate("c1", "Andrew Goodloe"), candidate("c2", "A. Goodloe")];
    const detection = detectionOf(candidates);
    const q = quality();
    const g = proposal("g5", ["c1", "c2"]);
    const session = withDecisions({});

    const subsetLive = groupLiveConfidence(g, detection, q, session, ["c1"], engine);
    const memberLive = memberLiveConfidence(g, "c1", detection, q, session, engine);
    check("groupLiveConfidence narrowed to one candidate matches memberLiveConfidence for that same candidate (no bonus in play)", subsetLive.current === memberLive.current, `${subsetLive.current} vs ${memberLive.current}`);
  }

  {
    const undecided = candidateLiveConfidence(72, false);
    check("candidateLiveConfidence: undecided candidate shows its raw analysis score, no prior note", undecided.current === 72 && undecided.prior === undefined, JSON.stringify(undecided));
  }

  {
    const decidedBelow100 = candidateLiveConfidence(72, true);
    check("candidateLiveConfidence: decided candidate jumps to 100 with a 'was 72' prior note", decidedBelow100.current === 100 && decidedBelow100.prior === 72, JSON.stringify(decidedBelow100));
  }

  {
    const decidedAlready100 = candidateLiveConfidence(100, true);
    check("candidateLiveConfidence: decided candidate already at 100 shows no redundant prior note", decidedAlready100.current === 100 && decidedAlready100.prior === undefined, JSON.stringify(decidedAlready100));
  }

  console.log(`\n${passCount}/${passCount + failCount} checks passed`);
  process.exitCode = failCount === 0 ? 0 : 1;
}

main();
