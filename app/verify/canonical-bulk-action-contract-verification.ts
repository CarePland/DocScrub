/**
 * canonical-bulk-action-contract-verification.ts -- Ambiguity/Item
 * K/C/R/I focused-vs-Zone contract.
 *
 * This suite pins the reference implementation for the two sectioned
 * candidate stages only. Browser-only helpers in app.ts are verified by
 * source-shape assertions because app.ts is intentionally a non-exporting
 * browser entry module; pure/domain pieces are exercised functionally.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/canonical-bulk-action-contract-verification.ts
 */

import { readFileSync } from "node:fs";
import { resolveKeyboardCommand } from "../src/engines/navigation/keymap.js";
import type { FocusState, WorkflowStage } from "../src/domain/FocusState.js";
import type { Candidate } from "../src/domain/DocumentModel.js";
import type { DetectionResult } from "../src/engines/DetectionEngine.js";
import type { GroupingResult } from "../src/engines/EntityResolutionEngine.js";
import { DurableReviewEngine } from "../src/engines/ReviewEngine.js";
import { createReviewSession } from "../src/engines/review/session.js";
import { GROUP_SCOPE_CHORD_FOR_DECISION, sectionActionChord, AMBIGUITY_TIER_ACTIONS } from "../src/ui/triageQueue.js";
import { ZONE_CAPACITY, zonePartition } from "../src/ui/reviewZone.js";

let passCount = 0;
let failCount = 0;

function check(label: string, condition: boolean, detail = ""): void {
  if (condition) {
    passCount += 1;
    console.log(`  PASS ${label}`);
  } else {
    failCount += 1;
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

const focus = (stage: WorkflowStage, itemId: string): FocusState => ({
  target: { stage, itemId, panel: { kind: "none" } },
  textInputActive: false,
});

const candidate = (id: string): Candidate =>
  ({
    id,
    detectedType: "person",
    source: "synthetic",
    confidence: "medium",
    normalizedValue: id.replace(/^person:/, ""),
    displayValue: id.replace(/^person:/, ""),
    occurrenceIds: [],
  }) as Candidate;

const detectionFor = (ids: readonly string[]): DetectionResult => ({ schemaVersion: 1, candidates: ids.map(candidate), occurrences: [] });
const emptyGrouping: GroupingResult = { schemaVersion: 1, ambiguityProposals: [], entityGroupProposals: [] };

function decidedIds(engine: DurableReviewEngine): string[] {
  return Object.keys(engine.getState().candidateDecisions).sort();
}

const appSource = readFileSync(new URL("../src/ui/app.ts", import.meta.url), "utf8");
const keymapSource = readFileSync(new URL("../src/engines/navigation/keymap.ts", import.meta.url), "utf8");
const triageSource = readFileSync(new URL("../src/ui/triageQueue.ts", import.meta.url), "utf8");

console.log("\n--- Focused Action Isolation ---");
for (const stage of ["ambiguity-check", "item-check"] as const) {
  const itemId = `person:${stage}`;
  const keep = resolveKeyboardCommand(focus(stage, itemId), { key: "k" });
  const ignore = resolveKeyboardCommand(focus(stage, itemId), { key: "i" });
  const change = resolveKeyboardCommand(focus(stage, itemId), { key: "c" });
  const redact = resolveKeyboardCommand(focus(stage, itemId), { key: "r" });
  check(`${stage}: bare K resolves to keepCandidate for the focused item`, keep?.family === "review" && keep.type === "keepCandidate" && keep.candidateId === itemId);
  check(`${stage}: bare I resolves to ignoreCandidate for the focused item`, ignore?.family === "review" && ignore.type === "ignoreCandidate" && ignore.candidateId === itemId);
  check(`${stage}: bare C opens the UI candidate editor, not a bulk command`, change === null);
  check(`${stage}: bare R opens the UI candidate editor, not a bulk command`, redact === null);
}
check(
  "C/R editor fallback is candidate-scoped on Ambiguity and Item",
  appSource.includes('if ((target.stage === "ambiguity-check" || target.stage === "item-check") && target.itemId)') &&
    appSource.includes('openInlineEditor({ scope: "candidate", stage: target.stage, candidateId: target.itemId, action });')
);
check(
  "decisionShortcut refuses every modified K/C/R/I, so Opt cannot become a focused-item action",
  appSource.includes("alt: event.altKey") && keymapSource.includes("if (mods.meta || mods.ctrl || mods.alt || mods.shift) return null;")
);

console.log("\n--- Canonical Opt+Letter Chords ---");
check("canonical decision map uses Opt+K/C/R/I", JSON.stringify(GROUP_SCOPE_CHORD_FOR_DECISION) === JSON.stringify({ Keep: "K", Rename: "C", Redact: "R", Ignore: "I" }));
const allAmbiguityActions = Object.values(AMBIGUITY_TIER_ACTIONS).flatMap((tiers) => Object.values(tiers ?? {}).flat());
check(
  "every Ambiguity/Item bulk-decision action derives K/C/R/I from the semantic decision kind",
  allAmbiguityActions
    .filter((action) => action.op.kind === "bulk-decision")
    .every((action) => sectionActionChord(action) === GROUP_SCOPE_CHORD_FOR_DECISION[action.op.decision])
);
check(
  "keyboard recognizes Opt+I and still leaves legacy Opt+N available only for explicit non-canonical callers",
  appSource.includes('const match = /^Key([KCRINU])$/.exec(event.code ?? "");') && appSource.includes('chord: "N"')
);
check(
  "Ambiguity/Item command bar advertises Opt K/C/R/I, not Opt K/C/R/N",
  appSource.includes('sseg(`${OPTION_KEY_LABEL} K/C/R/I`, "Decide the group")') &&
    !appSource.includes('sseg(`${OPTION_KEY_LABEL} K/C/R/N`, "Decide the group")')
);

console.log("\n--- Zone Bound And Rolling Snapshot ---");
{
  const ids = Array.from({ length: ZONE_CAPACITY + 1 }, (_, i) => `person:c${String(i).padStart(2, "0")}`);
  const engine = new DurableReviewEngine(detectionFor(ids), emptyGrouping, createReviewSession("canonical-zone", "doc", "2026-08-11T00:00:00.000Z"), () => "2026-08-11T00:00:01.000Z");
  const targets = ids.map((id) => ({ kind: "candidate" as const, id }));
  const partition = zonePartition(targets, (target) => Boolean(engine.getState().candidateDecisions[target.id]), "rolling", ZONE_CAPACITY);
  const scopeIds = partition.active.map((target) => target.id);
  const result = engine.dispatch({ family: "review", type: "bulkApplyDecision", candidateIds: scopeIds, decision: "Keep" });
  check("bulk application succeeds over the materialized active Zone IDs", result.ok);
  check("the active Zone has exactly ZONE_CAPACITY members", scopeIds.length === ZONE_CAPACITY);
  check("the boundary candidate immediately beyond the Zone is not decided", !engine.getState().candidateDecisions[ids[ZONE_CAPACITY]!]);
  check("no outside-Zone IDs are decided", decidedIds(engine).every((id) => scopeIds.includes(id)), decidedIds(engine).join(","));

  const nextPartition = zonePartition(targets, (target) => Boolean(engine.getState().candidateDecisions[target.id]), "rolling", ZONE_CAPACITY);
  check("rolling brings the boundary candidate into the next active Zone", nextPartition.active.some((target) => target.id === ids[ZONE_CAPACITY]));
  check("the completed action did not retroactively consume that newly-entering candidate", !engine.getState().candidateDecisions[ids[ZONE_CAPACITY]!]);
}

console.log("\n--- Invocation Equivalence And Reset Path ---");
check(
  "keyboard and visible buttons share QueueSectionAction.run from activeScopeSectionActions/headingSectionActions",
  appSource.includes("const actions = groupScopeActions(state);") &&
    appSource.includes("const hit = actions.find((action) => action.chord === chord);") &&
    appSource.includes("hit.run();") &&
    appSource.includes("const btn = cap !== null ? keycapButton(cap, action.label, action.run) : button(action.label, action.run)")
);
check(
  "all declared section bulk decisions dispatch through one runSectionAction -> bulkApplyDecision path",
  appSource.includes("runSectionAction(declared, section.label, scope.ids, policy.stage);") &&
    appSource.includes('dispatcher.dispatchReview({ family: "review", type: "bulkApplyDecision", candidateIds: [...undecided], decision: action.op.decision });')
);
check(
  "Reset Zone and Reset Category resolve through currentResetScopes and refuse when unavailable",
  appSource.includes("const { zone, category, collapsed } = currentResetScopes(state);") &&
    appSource.includes('refuse(match[1] === "A" ? "No decisions in this category can be reset." : "No decisions in this Review Zone can be reset.");') &&
    appSource.includes("openResetConfirmation(scope);")
);
check(
  "reset candidate IDs come from the same painted targets model used by sectioned Zone actions",
  appSource.includes("const band = activeReviewTargetsForGrid(stage, grid, state);") &&
    appSource.includes('return resetScopeFromTargets("zone"') &&
    appSource.includes('return resetScopeFromTargets("category"')
);

console.log("\n--- Non-Rollout Boundary ---");
check("Type Check still declares its existing explicit N chord", appSource.includes('label: `None are personal (${scope.ids.length})`') && appSource.includes('chord: "N"'));
check("the Type Check bulk-action documentation still marks Type Check as not standardized by this pass", triageSource.includes("Type Check is deliberately not standardized in this pass."));

console.log(`\n${passCount}/${passCount + failCount} checks passed`);
process.exitCode = failCount === 0 ? 0 : 1;
