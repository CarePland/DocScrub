/**
 * resolved-predicate-verification.ts -- ONE ANSWER TO "IS THIS CANDIDATE
 * FINISHED" (AG, 2026-08-09, Phase 0 / migration prerequisite D1).
 *
 * ---------------------------------------------------------------------
 * WHAT THIS PINS, AND WHY IT IS A PREREQUISITE TO MIGRATION
 * ---------------------------------------------------------------------
 *
 * DocScrub has two tests for "is this candidate done":
 *
 *   1. THE DOMAIN PREDICATE -- `isItemResolved` -> `candidateResolvedStatus`
 *      -> `resolvedStatusOf`. Resolved when the candidate has a DIRECT
 *      decision OR when every one of its occurrences is covered by a
 *      resolved entity group (coverage.ts). This is what FocusNavigator
 *      advances by, and what the stabilized Ambiguity advance/boundary
 *      guards read.
 *
 *   2. THE RAW MAP -- `!session.candidateDecisions[id]`. Direct decisions
 *      only. Used by roughly a dozen COUNTING and SCOPING sites in
 *      app.ts: the category pill count, section and tier headings, the
 *      remainder scope, and -- the one that decides what a bulk button
 *      actually touches -- `headingActionScope`.
 *
 * When those two disagree, the pill says a category still holds work that
 * navigation considers finished (or the reverse), and a bulk action's
 * scope includes candidates already settled. That is the same
 * paint-versus-keystroke disagreement class the Ambiguity stabilization
 * spent four passes removing.
 *
 * ---------------------------------------------------------------------
 * THE MECHANISM, established by probe rather than by reading
 * ---------------------------------------------------------------------
 *
 * A first draft of the migration audit asserted this divergence would come
 * from confirming an entity group. IT DOES NOT: `confirmGroup`,
 * `redactGroup`, `ignoreGroup` and `flattenGroup` all bulk-write a real
 * CandidateDecision for every member (session.ts's confirmGroup carries a
 * long comment explaining exactly why), so the two predicates agree
 * afterwards. That assumption was wrong and is asserted below so it stays
 * wrong on purpose rather than being re-guessed.
 *
 * The divergence comes from NOT QUITE. `completeNotQuite` stamps the group
 * decision with EVERY member in `confirmedMemberCandidateIds` -- that is
 * what "the group is settled" means -- while only the members the reviewer
 * explicitly decided receive a CandidateDecision. A member carried by the
 * group resolution therefore reads:
 *
 *      isItemResolved(...)              -> TRUE
 *      Boolean(candidateDecisions[id])  -> FALSE
 *
 * WHY THIS IS AN ITEM CHECK PROBLEM SPECIFICALLY, and why it is invisible
 * on the stage where all the recent work happened:
 * WORKFLOW_STAGE_ORDER is ["ambiguity-check", "group-check", "type-check",
 * "item-check", ...]. Ambiguity runs FIRST -- no group decisions exist yet,
 * coverage is empty, and the two predicates agree by construction. Item
 * Check runs LAST, after Group Check, where Not Quite lives. So the defect
 * cannot be observed on Ambiguity and is waiting in the stage that is next
 * to be migrated.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/resolved-predicate-verification.ts
 */

import { OoxmlDocumentParser } from "../src/io/DocumentParser.ts";
import { RegexDetectionEngine } from "../src/engines/DetectionEngine.ts";
import { RegexCandidateQualityEngine, buildDefaultScoringProfileSnapshot } from "../src/engines/CandidateQualityEngine.ts";
import { RegexEntityResolutionEngine } from "../src/engines/EntityResolutionEngine.ts";
import { RegexOccurrenceClassifier } from "../src/engines/OccurrenceClassifier.ts";
import { DurableReviewEngine } from "../src/engines/ReviewEngine.ts";
import { createReviewSession } from "../src/engines/review/session.ts";
import { itemIdsForStage, isItemResolved } from "../src/engines/navigation/stages.ts";
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

function fixedClock(): () => string {
  let tick = 0;
  return () => {
    tick += 1;
    return `2026-08-09T00:00:${String(tick % 60).padStart(2, "0")}.${String(Math.floor(tick / 60)).padStart(3, "0")}Z`;
  };
}

async function main(): Promise<void> {
  const file = loadSourceFile("entity-resolution-001");
  const model = await new OoxmlDocumentParser().parse(file);
  const detection = new RegexDetectionEngine().detect(model);
  const quality = new RegexCandidateQualityEngine().evaluate(model, detection, buildDefaultScoringProfileSnapshot("2026-08-09T00:00:00.000Z"));
  const grouping = new RegexEntityResolutionEngine().propose(detection, quality);
  const classification = new RegexOccurrenceClassifier().classify(model, detection, quality, grouping);
  const context = { detection, grouping, classification };
  const fresh = () => createReviewSession("s", "doc-under-test", "2026-08-09T00:00:00.000Z");

  /** Every candidate on which the two predicates disagree. */
  function divergentIds(session: ReturnType<typeof fresh>): string[] {
    return itemIdsForStage("item-check", context).filter(
      (id) => isItemResolved("item-check", id, context, session) !== Boolean(session.candidateDecisions[id])
    );
  }

  console.log("=== The resolved predicate: one answer for counts, scopes and navigation ===\n");

  console.log("--- Baseline: the predicates agree where nothing has resolved a group ---");
  {
    const session = fresh();
    check("a fresh session has no divergence", divergentIds(session).length === 0, divergentIds(session).join(", "));
  }

  console.log("\n--- Group bulk operations do NOT diverge (they write real decisions) ---");
  for (const op of ["confirmGroup", "redactGroup", "ignoreGroup", "flattenGroup"] as const) {
    const session = fresh();
    const engine = new DurableReviewEngine(detection, grouping, session, fixedClock());
    const group = grouping.entityGroupProposals[0];
    if (!group) {
      check("fixture provides at least one entity group", false, "no groups in entity-resolution-001");
      break;
    }
    const result = engine.dispatch({ family: "review", type: op, groupId: group.groupId } as never);
    if (!result.ok) {
      check(`${op} dispatches`, false, (result as { reason?: string }).reason ?? "rejected");
      continue;
    }
    const divergent = divergentIds(engine.getState());
    check(
      `${op} leaves the two predicates in agreement (it bulk-writes member decisions)`,
      divergent.length === 0,
      divergent.join(", ")
    );
  }

  console.log("\n--- NOT QUITE is where they diverge, and it is reachable from Group Check ---");
  {
    const session = fresh();
    const engine = new DurableReviewEngine(detection, grouping, session, fixedClock());
    const group = grouping.entityGroupProposals.find((g) => g.candidateIds.length >= 2);
    if (!group) {
      check("fixture provides a multi-member group", false, "none found");
    } else {
      const entered = engine.dispatch({ family: "review", type: "enterNotQuite", groupId: group.groupId } as never);
      check("Not Quite opens on a multi-member group", entered.ok);

      const decidedMember = group.candidateIds[0]!;
      const carriedMember = group.candidateIds[1]!;
      const kept = engine.dispatch({ family: "review", type: "keepCandidate", candidateId: decidedMember } as never);
      check("one member is decided explicitly", kept.ok);

      const completed = engine.dispatch({ family: "review", type: "completeNotQuite", groupId: group.groupId } as never);
      check("Not Quite completes", completed.ok);

      const after = engine.getState();

      check(
        "the explicitly decided member carries a real CandidateDecision",
        Boolean(after.candidateDecisions[decidedMember]),
        decidedMember
      );
      check(
        "the CARRIED member carries NO CandidateDecision",
        !after.candidateDecisions[carriedMember],
        `${carriedMember} unexpectedly has one`
      );
      check(
        "but the domain predicate reports the carried member RESOLVED (group coverage)",
        isItemResolved("item-check", carriedMember, context, after),
        `${carriedMember} reads unresolved`
      );

      const divergent = divergentIds(after);
      check(
        "THE DIVERGENCE IS REAL: at least one candidate on which the two predicates disagree",
        divergent.length > 0,
        "no divergence found -- the mechanism has changed; re-establish it before trusting any fix built on it"
      );
      check("the divergent candidate is the carried Not Quite member", divergent.includes(carriedMember), divergent.join(", "));

      /* THE CONSEQUENCE, stated as the two numbers that must agree.
       * `rawRemaining` is what the pill, the section heading, the tier
       * heading and headingActionScope all compute today. `domainRemaining`
       * is what navigation advances by and what the category-boundary guard
       * enforces. A category whose two numbers differ can paint "1
       * remaining" that no keystroke can ever clear. */
      const ids = itemIdsForStage("item-check", context);
      const rawRemaining = ids.filter((id) => !after.candidateDecisions[id]).length;
      const domainRemaining = ids.filter((id) => !isItemResolved("item-check", id, context, after)).length;
      console.log(`      raw count: ${rawRemaining}   domain count: ${domainRemaining}`);
      check(
        "REGRESSION GUARD: the raw count over-reports remaining work relative to the domain",
        rawRemaining > domainRemaining,
        "the counts agree -- the divergence this suite exists to describe is gone; re-check before removing the fix"
      );
    }
  }

  console.log("\n--- The unified predicate is the domain one, and it is stable ---");
  {
    const session = fresh();
    const engine = new DurableReviewEngine(detection, grouping, session, fixedClock());
    const group = grouping.entityGroupProposals.find((g) => g.candidateIds.length >= 2)!;
    engine.dispatch({ family: "review", type: "enterNotQuite", groupId: group.groupId } as never);
    engine.dispatch({ family: "review", type: "keepCandidate", candidateId: group.candidateIds[0]! } as never);
    engine.dispatch({ family: "review", type: "completeNotQuite", groupId: group.groupId } as never);
    const after = engine.getState();

    // Idempotence: asking twice gives the same answer (no hidden state).
    const first = itemIdsForStage("item-check", context).map((id) => isItemResolved("item-check", id, context, after));
    const second = itemIdsForStage("item-check", context).map((id) => isItemResolved("item-check", id, context, after));
    check("the domain predicate is a pure function of (context, session)", first.join(",") === second.join(","));

    // Stage-independence for CANDIDATES: item-check and ambiguity-check
    // must give the same answer, which is what lets ONE counting helper
    // serve both sectioned stages.
    const sameAcrossStages = itemIdsForStage("item-check", context).every(
      (id) => isItemResolved("item-check", id, context, after) === isItemResolved("ambiguity-check", id, context, after)
    );
    check("a candidate resolves identically on item-check and ambiguity-check", sameAcrossStages);
  }

  console.log(`\n=== ${passCount} passed, ${failCount} failed ===`);
  if (failCount > 0) {
    for (const f of failed) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
}

void main();
