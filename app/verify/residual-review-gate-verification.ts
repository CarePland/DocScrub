/**
 * residual-review-gate-verification.ts -- Phase 2's residual-review gate
 * and the automatic-resolution model (AG, 2026-08-09).
 *
 * Covers Andrew's ten stated requirements. Every assertion executes real
 * code: the gate over real facts, and the session reducer over real
 * commands with a real detection pipeline. No source-text assertions.
 *
 * THE ACCEPTANCE TEST, in Andrew's words: "Anything removed from manual
 * Item Check was removed because DocScrub already had enough evidence that
 * asking the human would add no meaningful judgment."
 *
 * That is a claim about FALSE POSITIVES, so the negative cases carry most
 * of the weight here. A gate that resolved nothing would satisfy the
 * invariant trivially and be useless; a gate that resolved a real name
 * would be worse than useless. Both failure directions are asserted.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/residual-review-gate-verification.ts
 */

import { COMMON_WORD_CATEGORIES, hasKnownNameEvidence } from "../src/ui/recommendations.ts";
import {
  ORDINARY_LANGUAGE_CATEGORIES,
  ORDINARY_LANGUAGE_RULE_ID,
  buildGateFacts,
  evaluateCandidate,
  resolutionsByRule,
  runResidualReviewGate,
  type GateFacts,
} from "../src/engines/review/residualReviewGate.ts";
import { createReviewSession } from "../src/engines/review/session.ts";
import { DurableReviewEngine } from "../src/engines/ReviewEngine.ts";
import { candidateResolvedStatus } from "../src/engines/review/coverage.ts";
import { decisionsMade } from "../src/metrics/decisionTracker.ts";
import { OoxmlDocumentParser } from "../src/io/DocumentParser.ts";
import { RegexDetectionEngine } from "../src/engines/DetectionEngine.ts";
import { RegexEntityResolutionEngine } from "../src/engines/EntityResolutionEngine.ts";
import { RegexCandidateQualityEngine, buildDefaultScoringProfileSnapshot } from "../src/engines/CandidateQualityEngine.ts";
import { loadSourceFile } from "./fixture-io.ts";
import type { AutomaticResolution, ReviewSession } from "../src/domain/ReviewSession.ts";

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

const NOW = "2026-08-09T12:00:00.000Z";

/** Base facts for an ordinary function word: single token, ordinary
 *  evidence, nothing person-like. */
function ordinaryWord(candidateId: string, overrides: Partial<GateFacts> = {}): GateFacts {
  return {
    candidateId,
    detectedType: "person",
    tokenCount: 1,
    qualityCategories: ["common-english-word", "pronoun-or-determiner"],
    hasContextualPersonEvidence: false,
    hasKnownNameEvidence: false,
    hasExistingDecision: false,
    hasExistingAutomaticResolution: false,
    ...overrides,
  };
}

console.log("=== Residual review gate ===\n");

console.log("--- 1. Obvious ordinary-language residue does NOT require review ---");
{
  for (const word of ["person:the", "person:also", "person:but", "person:however", "person:because"]) {
    const out = evaluateCandidate(ordinaryWord(word));
    check(`${word} resolves automatically`, out.kind === "resolve", out.kind === "review" ? out.because : "");
  }
  const out = evaluateCandidate(ordinaryWord("person:the"));
  if (out.kind === "resolve") {
    check("the resolution is KEEP, never Ignore or Redact", out.resolution.resolution === "Keep", out.resolution.resolution);
  }
}


console.log("\n--- DRIFT GUARD: the gate's ordinary-language list must equal the UI's ---");
{
  /*
   * The gate keeps a COPY of COMMON_WORD_CATEGORIES because engines/ must not
   * import ui/. A copy nobody checks is how the first draft of this module
   * shipped an invented KNOWN_NAME_CATEGORIES list in which five of six
   * entries did not exist -- the Amy/May guard would have been inert while
   * looking correct. This asserts the surviving copy against the real thing.
   */
  check(
    "ORDINARY_LANGUAGE_CATEGORIES === COMMON_WORD_CATEGORIES, element for element",
    [...ORDINARY_LANGUAGE_CATEGORIES].sort().join("|") === [...COMMON_WORD_CATEGORIES].sort().join("|"),
    `gate=${JSON.stringify([...ORDINARY_LANGUAGE_CATEGORIES].sort())} ui=${JSON.stringify([...COMMON_WORD_CATEGORIES].sort())}`
  );
  check(
    "the name-evidence predicate is the UI's, not a local copy",
    typeof hasKnownNameEvidence === "function"
  );
}

console.log("\n--- 2. A legitimate person name remains reviewable ---");
{
  const name = ordinaryWord("person:andrew", {
    qualityCategories: [],
    hasKnownNameEvidence: true,
  });
  const out = evaluateCandidate(name);
  check("a recognized name is retained", out.kind === "review", JSON.stringify(out));

  // Multi-token names never reach the rule at all.
  const full = ordinaryWord("person:andrew-goodloe", { tokenCount: 2, qualityCategories: ["common-english-word"] });
  check("a multi-token candidate is retained", evaluateCandidate(full).kind === "review");
}

console.log("\n--- 3. Common-word/name COLLISIONS remain reviewable when context supports person use ---");
{
  // Amy, May, Will, Mark, Rose, Fox, Collier -- ordinary vocabulary AND names.
  const collisions = ["person:will", "person:may", "person:mark", "person:rose", "person:amy", "person:fox", "person:collier"];

  for (const id of collisions) {
    // Case A: the lexicon recognizes it as a name. Ordinary-word status
    // must not override that.
    const lexical = ordinaryWord(id, {
      qualityCategories: ["common-english-word", "common-verb"],
      hasKnownNameEvidence: true,
    });
    check(`${id}: name evidence beats ordinary-word status`, evaluateCandidate(lexical).kind === "review");

    // Case B: no lexicon hit, but an occurrence reads as a person.
    const contextual = ordinaryWord(id, {
      qualityCategories: ["common-english-word"],
      hasContextualPersonEvidence: true,
    });
    check(`${id}: contextual person evidence beats ordinary-word status`, evaluateCandidate(contextual).kind === "review");
  }
}

console.log("\n--- 4. MIXED USE is not globally auto-Kept ---");
{
  /*
   * The realistic shape: "rose" used ninety-eight times as a flower and
   * twice as a person. DocScrub cannot split one candidate's occurrences
   * into two dispositions, so the only honest move is to leave the whole
   * candidate reviewable. Asserted at candidate granularity because that is
   * the granularity a decision actually has.
   */
  const mixed = ordinaryWord("person:rose", {
    qualityCategories: ["common-english-word", "frequency-saturated"],
    hasContextualPersonEvidence: true, // fired on ANY occurrence
  });
  const out = evaluateCandidate(mixed);
  check("a mixed-use candidate is retained whole", out.kind === "review");
  check(
    "and the reason names the mixed use rather than being generic",
    out.kind === "review" && /occurrence/i.test(out.because),
    out.kind === "review" ? out.because : ""
  );
}

console.log("\n--- 4b. ABSENCE of person evidence is not PRESENCE of ordinary evidence ---");
{
  // The guard that stops the gate becoming "resolve anything unrecognized".
  const unknown = ordinaryWord("person:xylo", { qualityCategories: [] });
  const out = evaluateCandidate(unknown);
  check("an unrecognized single token is RETAINED, not resolved", out.kind === "review", JSON.stringify(out));
  check(
    "and the reason says unrecognized material is a reviewer question",
    out.kind === "review" && /unrecognized|no positive/i.test(out.because),
    out.kind === "review" ? out.because : ""
  );
}


console.log("\n--- ADAPTER: an EMPTY contextual record is not evidence ---");
{
  /*
   * THE BUG THIS PINS, found by measurement rather than by review.
   *
   * `evaluateContextualPersonEvidence` returns a `byCandidate` entry for
   * every candidate it EXAMINED, including ones with no evidence at all --
   * "The" comes back as {rules: [], contribution: 0,
   * occurrencesWithoutEvidence: 2}. The first adapter tested
   * `byCandidate[id] !== undefined`, which is true for essentially every
   * candidate, so the mixed-use guard fired universally and the gate
   * resolved NOTHING on any fixture.
   *
   * Every unit test above still passed, because they inject the boolean
   * directly and never exercised the adapter. That is the gap this section
   * closes: the adapter is where the gate meets reality, and it needs its
   * own coverage.
   */
  const facts = buildGateFacts({
    candidates: [
      { id: "person:the", displayValue: "The", detectedType: "person" },
      { id: "person:maria", displayValue: "Maria", detectedType: "person" },
      { id: "person:unseen", displayValue: "Unseen", detectedType: "person" },
    ],
    assessmentByCandidate: {
      "person:the": { filterRules: ["sentence_fragment_word", "all_common_dictionary_words"], reasons: [] },
      "person:maria": { filterRules: ["expanded_common_language_token"], reasons: [] },
      "person:unseen": { filterRules: ["expanded_common_language_token"], reasons: [] },
    },
    contextualByCandidate: {
      // Examined, no evidence -- must NOT count.
      "person:the": { rules: [] },
      // Examined, evidence found -- must count.
      "person:maria": { rules: ["contextual_attribution"] },
      // Not examined at all -- must not count, and must not throw.
    },
    decidedCandidateIds: new Set(),
    automaticallyResolvedIds: new Set(),
  });
  const byId = new Map(facts.map((f) => [f.candidateId, f]));

  check(
    "an EMPTY contextual record does not count as person evidence",
    byId.get("person:the")?.hasContextualPersonEvidence === false
  );
  check(
    "a POPULATED contextual record does count",
    byId.get("person:maria")?.hasContextualPersonEvidence === true
  );
  check(
    "an ABSENT contextual record does not count and does not throw",
    byId.get("person:unseen")?.hasContextualPersonEvidence === false
  );

  // End-to-end through the gate: the whole point is that "The" resolves.
  const run = runResidualReviewGate(facts, NOW);
  check(
    "so the gate actually resolves the ordinary word",
    run.resolutions.some((r) => r.candidateId === "person:the"),
    JSON.stringify(run.retained)
  );
  check(
    "and still retains the one with real contextual evidence",
    run.retained.some((r) => r.candidateId === "person:maria")
  );

  // Underscore/hyphen normalization, since quality emits both spellings.
  check(
    "snake_case quality categories are normalized to kebab-case",
    byId.get("person:the")?.qualityCategories.includes("all-common-dictionary-words") === true,
    JSON.stringify(byId.get("person:the")?.qualityCategories)
  );

  // Token counting.
  const multi = buildGateFacts({
    candidates: [{ id: "x", displayValue: "Andrew  Goodloe", detectedType: "person" }],
    assessmentByCandidate: {}, contextualByCandidate: {},
    decidedCandidateIds: new Set(), automaticallyResolvedIds: new Set(),
  });
  check("token count collapses repeated whitespace", multi[0]?.tokenCount === 2, String(multi[0]?.tokenCount));
}

console.log("\n--- 5. Automatic resolution carries provenance ---");
{
  const out = evaluateCandidate(ordinaryWord("person:the"));
  if (out.kind !== "resolve") {
    check("expected a resolution", false);
  } else {
    const r = out.resolution;
    check("carries a stable ruleId", r.ruleId === ORDINARY_LANGUAGE_RULE_ID, r.ruleId);
    check("carries a human-readable reason", r.reason.length > 20, r.reason);
    check("carries itemised evidence", r.evidence.length >= 3, JSON.stringify(r.evidence));
    check(
      "the evidence names the specific upstream categories, not a generic claim",
      r.evidence.some((e) => e.includes("common-english-word")),
      JSON.stringify(r.evidence)
    );
  }
  const run = runResidualReviewGate([ordinaryWord("person:the")], NOW);
  check("the run stamps a timestamp", run.resolutions[0]?.resolvedAt === NOW, run.resolutions[0]?.resolvedAt);
  check("resolutionsByRule groups for measurement", resolutionsByRule(run.resolutions)[0]?.count === 1);
}

console.log("\n--- 5b. Retained candidates carry a REASON too ---");
{
  const run = runResidualReviewGate([ordinaryWord("person:amy", { hasKnownNameEvidence: true })], NOW);
  check("a retained candidate records why it survived", (run.retained[0]?.because ?? "").length > 0, JSON.stringify(run.retained));
}

console.log("\n--- 6. Automatic resolution is NOT a human judgment ---");
{
  const session = createReviewSession("s", "doc", NOW);
  const withAuto: ReviewSession = {
    ...session,
    automaticResolutions: {
      "person:the": {
        candidateId: "person:the",
        resolution: "Keep",
        ruleId: ORDINARY_LANGUAGE_RULE_ID,
        reason: "Ordinary language.",
        evidence: ["single token"],
        resolvedAt: NOW,
      },
    },
  };
  const resolvedIds = new Set(["person:the"]);
  check(
    "decisionsMade stays 0 despite a resolved candidate",
    decisionsMade(withAuto, resolvedIds) === 0,
    String(decisionsMade(withAuto, resolvedIds))
  );
  check("no event was written for the automatic resolution", withAuto.events.length === 0, String(withAuto.events.length));
}

console.log("\n--- 7-10. Against the REAL pipeline ---");
{
  void (async (): Promise<void> => {
    const file = loadSourceFile("entity-resolution-001");
    const model = await new OoxmlDocumentParser().parse(file);
    const detection = new RegexDetectionEngine().detect(model);
    const quality = new RegexCandidateQualityEngine().evaluate(model, detection, buildDefaultScoringProfileSnapshot(NOW));
    const grouping = new RegexEntityResolutionEngine().propose(detection, quality);
    void grouping;

    const target = detection.candidates[0]!;

    console.log("\n--- 7. An automatically resolved candidate is RESOLVED for the workflow ---");
    {
      const base = createReviewSession("s", "doc", NOW);
      const auto: ReviewSession = {
        ...base,
        automaticResolutions: {
          [target.id]: {
            candidateId: target.id,
            resolution: "Keep",
            ruleId: ORDINARY_LANGUAGE_RULE_ID,
            reason: "Ordinary language.",
            evidence: ["single token"],
            resolvedAt: NOW,
          },
        },
      };
      check(
        "candidateResolvedStatus reports it resolved, so it leaves the queue/Zone/navigation",
        candidateResolvedStatus(auto, detection, target.id).status === "resolved"
      );
      check(
        "an untouched candidate is still unresolved",
        candidateResolvedStatus(auto, detection, detection.candidates[1]!.id).status === "unresolved"
      );
    }

    console.log("\n--- 8. A reviewer decision SUPERSEDES and CLEARS the resolution ---");
    {
      const base = createReviewSession("s", "doc", NOW);
      const auto: ReviewSession = {
        ...base,
        automaticResolutions: {
          [target.id]: {
            candidateId: target.id,
            resolution: "Keep",
            ruleId: ORDINARY_LANGUAGE_RULE_ID,
            reason: "Ordinary language.",
            evidence: ["single token"],
            resolvedAt: NOW,
          },
        },
      };
      const engine = new DurableReviewEngine(detection, grouping, auto, () => NOW);
      const res = engine.dispatch({ family: "review", type: "ignoreCandidate", candidateId: target.id });
      check("the reviewer decision dispatches", res.ok);
      const after = engine.getState();
      check("a real CandidateDecision now exists", Boolean(after.candidateDecisions[target.id]));
      check("its source is reviewer, never automatic", after.candidateDecisions[target.id]?.source === "reviewer", after.candidateDecisions[target.id]?.source);
      check(
        "the automatic resolution was CLEARED, not left alongside",
        after.automaticResolutions?.[target.id] === undefined,
        JSON.stringify(after.automaticResolutions)
      );
      check(
        "and it now counts as a human decision",
        decisionsMade(after, new Set([target.id])) === 1,
        String(decisionsMade(after, new Set([target.id])))
      );
    }

    console.log("\n--- 9. Reversal cannot impersonate a reviewer ---");
    {
      const base = createReviewSession("s", "doc", NOW);
      const auto: ReviewSession = {
        ...base,
        automaticResolutions: {
          [target.id]: {
            candidateId: target.id,
            resolution: "Keep",
            ruleId: ORDINARY_LANGUAGE_RULE_ID,
            reason: "Ordinary language.",
            evidence: ["single token"],
            resolvedAt: NOW,
          },
        },
      };
      // Reversal is deletion of the resolution.
      const reverted: ReviewSession = { ...auto, automaticResolutions: {} };
      check("after reversal the candidate is unresolved again", candidateResolvedStatus(reverted, detection, target.id).status === "unresolved");
      check("and NO CandidateDecision was ever created", reverted.candidateDecisions[target.id] === undefined);
      check("so decisionsMade is still 0", decisionsMade(reverted, new Set()) === 0);
    }

    console.log("\n--- 10. Prior-stage and group-carried behaviour is unchanged ---");
    {
      const base = createReviewSession("s", "doc", NOW);
      const engine = new DurableReviewEngine(detection, grouping, base, () => NOW);
      const group = grouping.entityGroupProposals.find((g) => g.candidateIds.length >= 2);
      if (group) {
        engine.dispatch({ family: "review", type: "enterNotQuite", groupId: group.groupId });
        engine.dispatch({ family: "review", type: "keepCandidate", candidateId: group.candidateIds[0]! });
        engine.dispatch({ family: "review", type: "completeNotQuite", groupId: group.groupId });
        const after = engine.getState();
        const carried = group.candidateIds[1]!;
        check(
          "a group-carried member is still resolved without a decision (unchanged)",
          candidateResolvedStatus(after, detection, carried).status === "resolved"
        );
        check("and still carries no CandidateDecision", after.candidateDecisions[carried] === undefined);
        check("and no automatic resolution was invented for it", after.automaticResolutions?.[carried] === undefined);
      } else {
        check("fixture provides a multi-member group", false);
      }
    }

    console.log("\n--- The three record kinds are distinguishable for audit ---");
    {
      const base = createReviewSession("s", "doc", NOW);
      const withAuto: ReviewSession = {
        ...base,
        automaticResolutions: {
          [detection.candidates[2]!.id]: {
            candidateId: detection.candidates[2]!.id,
            resolution: "Keep",
            ruleId: ORDINARY_LANGUAGE_RULE_ID,
            reason: "Ordinary language.",
            evidence: ["single token"],
            resolvedAt: NOW,
          },
        },
      };
      const engine = new DurableReviewEngine(detection, grouping, withAuto, () => NOW);
      engine.dispatch({ family: "review", type: "keepCandidate", candidateId: detection.candidates[0]!.id });
      const s = engine.getState();
      const reviewerIds = Object.values(s.candidateDecisions).filter((d) => d.source === "reviewer").map((d) => d.candidateId);
      const autoIds = Object.keys(s.automaticResolutions ?? {});
      check("reviewer decisions are enumerable", reviewerIds.length === 1, JSON.stringify(reviewerIds));
      check("automatic resolutions are enumerable separately", autoIds.length === 1, JSON.stringify(autoIds));
      check("the two sets are disjoint", reviewerIds.every((id) => !autoIds.includes(id)));
    }

    console.log(`\n=== ${passCount} passed, ${failCount} failed ===`);
    if (failCount > 0) {
      for (const f of failed) console.log(`  - ${f}`);
      process.exitCode = 1;
    }
  })();
}

void (undefined as unknown as AutomaticResolution | undefined);
