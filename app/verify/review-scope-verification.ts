/**
 * review-scope-verification.ts -- REVIEW SCOPE, Pass 1 (2026-08-03).
 *
 * Node-verifiable core, two halves:
 *
 *  1. The PURE scope resolver (src/ui/reviewScope.ts): totality, the
 *     precedence order (artifact-focus > selection > item-focus >
 *     stage-remainder, with `widened` skipping item-focus ONLY), unit
 *     axes/order, purity (no caching, no input mutation), and the
 *     descriptor vocabulary.
 *
 *  2. DECISION PROVENANCE through the real reducer (applyReviewCommand):
 *     the optional `scope` stamp lands on candidate-decided /
 *     bulk-decided EVENT payloads, never on CandidateDecision itself,
 *     and a stampless command's session is byte-identical in shape to
 *     the pre-feature behavior (no `scope` key at all).
 *
 * NOT coverable here (browser-only, disclosed in the findings doc): the
 * inspector pane's rendering, the parked-cursor visuals, the Escape/Enter
 * scope ladder, and the wider-scope mis-target refusals -- all DOM/keydown
 * behavior in app.ts.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/review-scope-verification.ts
 */

import { resolveReviewScope, scopeDescriptor, type ScopeResolutionInputs } from "../src/ui/reviewScope.ts";
import { OoxmlDocumentParser } from "../src/io/DocumentParser.ts";
import { RegexDetectionEngine } from "../src/engines/DetectionEngine.ts";
import { RegexCandidateQualityEngine, buildDefaultScoringProfileSnapshot } from "../src/engines/CandidateQualityEngine.ts";
import { RegexEntityResolutionEngine } from "../src/engines/EntityResolutionEngine.ts";
import { applyReviewCommand, createReviewSession } from "../src/engines/review/session.ts";
import type { DetectionResult } from "../src/engines/DetectionEngine.ts";
import type { GroupingResult } from "../src/engines/EntityResolutionEngine.ts";
import { loadSourceFile } from "./fixture-io.ts";

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

function baseInputs(overrides: Partial<ScopeResolutionInputs> = {}): ScopeResolutionInputs {
  return {
    remainderItemIds: ["a", "b", "c"],
    remainderArtifactIds: ["rel-1"],
    selectedItemIds: [],
    focusedItemId: "b",
    artifactCursorId: null,
    widened: false,
    ...overrides,
  };
}

async function main(): Promise<void> {
  console.log("--- 1. Totality and default precedence ---");
  {
    const focus = resolveReviewScope(baseInputs());
    check("a focused item with no selection/cursor/widening resolves to item-focus", focus.source.kind === "item-focus");
    check("item-focus holds exactly the one unit", focus.units.length === 1 && focus.units[0]?.id === "b" && focus.units[0]?.axis === "item");

    const empty = resolveReviewScope(baseInputs({ focusedItemId: null, remainderItemIds: [], remainderArtifactIds: [] }));
    check("with nothing at all, the resolver STILL returns a scope (stage-remainder, empty)", empty.source.kind === "stage-remainder" && empty.units.length === 0);
  }

  console.log("--- 2. Precedence order: artifact > selection > item-focus > remainder ---");
  {
    const everything = baseInputs({ selectedItemIds: ["a", "c"], artifactCursorId: "rel-1", widened: true });
    const top = resolveReviewScope(everything);
    check("the card cursor outranks selection, focus, and widening (card-targeted-letters agreement)", top.source.kind === "artifact-focus");
    check("artifact-focus's unit is the artifact, on the artifact axis", top.units.length === 1 && top.units[0]?.axis === "artifact" && top.units[0]?.id === "rel-1");

    const sel = resolveReviewScope(baseInputs({ selectedItemIds: ["c", "a"] }));
    check("a non-empty selection outranks item-focus", sel.source.kind === "selection");
    check("selection units preserve the given (display) order", sel.units.map((u) => u.id).join(",") === "c,a");

    const selWhileWidened = resolveReviewScope(baseInputs({ selectedItemIds: ["a"], widened: true }));
    check("widening does NOT suppress a selection (it skips item-focus only)", selWhileWidened.source.kind === "selection");

    const widened = resolveReviewScope(baseInputs({ widened: true }));
    check("widening with a focused item lands on stage-remainder (the zero state)", widened.source.kind === "stage-remainder");
  }

  console.log("--- 3. The remainder scope carries BOTH work axes ---");
  {
    const rem = resolveReviewScope(baseInputs({ focusedItemId: null }));
    check("items first, in order, then artifacts", rem.units.map((u) => `${u.axis}:${u.id}`).join(",") === "item:a,item:b,item:c,artifact:rel-1");
  }

  console.log("--- 4. Purity: same inputs, same answer; inputs never mutated ---");
  {
    const inputs = baseInputs({ selectedItemIds: ["a", "c"] });
    const snapshot = JSON.stringify(inputs);
    const first = JSON.stringify(resolveReviewScope(inputs));
    const second = JSON.stringify(resolveReviewScope(inputs));
    check("two calls with identical inputs produce identical scopes (nothing cached, nothing accumulated)", first === second);
    check("the resolver never mutates its inputs", JSON.stringify(inputs) === snapshot);
  }

  console.log("--- 5. Descriptor vocabulary (the provenance stamp format) ---");
  {
    check("item-focus", scopeDescriptor(resolveReviewScope(baseInputs())) === "item-check/item:b");
    check("selection carries the count", scopeDescriptor(resolveReviewScope(baseInputs({ selectedItemIds: ["a", "c"] }))) === "item-check/selection:2");
    check("artifact-focus carries the proposal id", scopeDescriptor(resolveReviewScope(baseInputs({ artifactCursorId: "rel-9" }))) === "item-check/artifact:rel-9");
    check("remainder carries the unit count (items + artifacts)", scopeDescriptor(resolveReviewScope(baseInputs({ widened: true }))) === "item-check/remainder:4");
  }

  console.log("--- 6. Decision provenance through the real reducer ---");
  {
    const file = loadSourceFile("entity-resolution-001");
    const model = await new OoxmlDocumentParser().parse(file);
    const detection: DetectionResult = new RegexDetectionEngine().detect(model);
    const profile = buildDefaultScoringProfileSnapshot("2026-08-03T00:00:00.000Z");
    const quality = new RegexCandidateQualityEngine().evaluate(model, detection, profile);
    const grouping: GroupingResult = new RegexEntityResolutionEngine().propose(detection, quality);
    const context = { detection, grouping };
    const now = "2026-08-03T00:00:01.000Z";
    const candidateId = detection.candidates[0]!.id;
    const otherId = detection.candidates[1]!.id ?? candidateId;

    const stamped = applyReviewCommand(createReviewSession("s1", "d1", now), { family: "review", type: "keepCandidate", candidateId, scope: "item-check/item:x" }, context, now);
    check("stamped keepCandidate succeeds", stamped.result.ok === true, stamped.result.ok ? undefined : stamped.result.reason);
    {
      const event = stamped.session.events.find((e) => e.kind === "candidate-decided");
      check("the candidate-decided event payload carries the scope", event?.payload.scope === "item-check/item:x");
      const decision = stamped.session.candidateDecisions[candidateId];
      check("CandidateDecision itself carries NO scope (provenance is history, not state)", decision !== undefined && !("scope" in (decision as unknown as Record<string, unknown>)));
    }

    const unstamped = applyReviewCommand(createReviewSession("s2", "d1", now), { family: "review", type: "keepCandidate", candidateId }, context, now);
    check("unstamped keepCandidate succeeds", unstamped.result.ok === true, unstamped.result.ok ? undefined : unstamped.result.reason);
    {
      const event = unstamped.session.events.find((e) => e.kind === "candidate-decided");
      check("an unstamped command's event payload has no scope key at all (byte-identical to pre-feature)", event !== undefined && !("scope" in event.payload));
    }

    const bulk = applyReviewCommand(
      createReviewSession("s3", "d1", now),
      { family: "review", type: "bulkApplyDecision", candidateIds: [candidateId, otherId], decision: "Ignore", scope: "item-check/selection:2" },
      context,
      now
    );
    check("stamped bulkApplyDecision succeeds", bulk.result.ok === true, bulk.result.ok ? undefined : bulk.result.reason);
    {
      const perCandidate = bulk.session.events.filter((e) => e.kind === "candidate-decided");
      check("every per-candidate event carries the scope", perCandidate.length > 0 && perCandidate.every((e) => e.payload.scope === "item-check/selection:2"));
      const summary = bulk.session.events.find((e) => e.kind === "bulk-decided");
      check("the bulk-decided summary event carries it too", summary?.payload.scope === "item-check/selection:2");
    }
  }

  console.log(`\n${passCount}/${passCount + failCount} checks passed`);
  process.exitCode = failCount === 0 ? 0 : 1;
}

await main();
