/**
 * Verification for Milestone 2 ("Review at Scale"). Same property/behavior-
 * suite spirit as every prior no-Python-oracle suite in this project
 * (review-engine-verification.ts, focus-navigator-verification.ts,
 * group-bulk-actions-verification.ts, decision-reuse-verification.ts,
 * explanation-engine-verification.ts) -- none of this milestone's work has
 * a Python-exported fixture to diff against, since search/filter/sort/
 * multi-select/CommandBar are new, browser-native reviewer tools with no
 * direct Python UI equivalent at this scale (Python's own search/filter
 * bars were never captured as domain-parity fixtures either).
 *
 * Part 1 -- pure src/ui/itemCheckQuery.ts unit tests, using hand-built
 * CandidateQueryFacts (no engine, no fixture -- these are UI-layer pure
 * functions, exactly the kind of thing that should be testable in
 * isolation). Covers matchesSearch across every named field, matchesPreset
 * for all eight presets (including the high-confidence threshold boundary
 * and the organizations evidence-category interpretation), the AND
 * semantics of combining multiple active presets, compareCandidates for
 * all seven sort orders (including tie-breaks and the undefined-likelihood
 * convention), and queryItemCheck end-to-end.
 *
 * Part 2 -- review.bulkApplyDecision, exercised through the REAL
 * ReviewWorkspace/WorkspaceCommandDispatcher against synthetic-transcript-001
 * (10 real candidates spanning person/email/phone/cin/long_numeric_id,
 * likelihoods from 1 to 99) -- never by reaching into session.ts directly.
 * Covers Keep/Rename/Redact/Ignore bulk application, the required-
 * replacement-for-Rename / optional-replacement-for-Redact rules, empty-
 * selection and all-invalid-id rejection, partial-invalid-id skipping,
 * direct-overwrite-of-an-existing-decision semantics (unlike
 * applyDecisionReuse), the event log (one "candidate-decided" per applied
 * candidate plus one summary "bulk-decided"), and verification staleness
 * invalidation (Workspace.ts's derived verifiedSessionUpdatedAt check).
 *
 * Part 3 -- the `previousDecided` ItemMoveDirection (navigator.ts), against
 * the same real fixture/dispatcher, covering wrap-around and the
 * no-decided-items case.
 *
 * Part 4 -- the "ambiguous" filter preset against entity-resolution-001's
 * REAL ambiguityProposals (oracle-verified elsewhere by
 * entity-resolution-parity.ts), rather than a synthetic assumption about
 * what "ambiguous" means.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/milestone-2-review-at-scale-verification.ts
 */

import { ReviewWorkspace } from "../src/workspace/Workspace.ts";
import { InMemorySessionRepository } from "./support/InMemorySessionRepository.ts";
import { WorkspaceCommandDispatcher } from "../src/workspace/CommandDispatcher.ts";
import { loadSourceFile } from "./fixture-io.ts";
import type { Candidate } from "../src/domain/DocumentModel.ts";
import type { CandidateDecision } from "../src/domain/ReviewSession.ts";
import {
  HIGH_CONFIDENCE_THRESHOLD,
  ORGANIZATION_EVIDENCE_CATEGORIES,
  compareCandidates,
  createDefaultQueryState,
  matchesAllActivePresets,
  matchesPreset,
  matchesSearch,
  queryItemCheck,
  type CandidateQueryFacts,
  type FilterPreset,
} from "../src/ui/itemCheckQuery.ts";

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

function makeFixedClock(): () => string {
  let tick = 0;
  return () => {
    tick += 1;
    return `2026-08-05T00:00:${String(tick).padStart(2, "0")}.000Z`;
  };
}

async function freshLoadedDispatcher(fixtureId: string): Promise<WorkspaceCommandDispatcher> {
  const workspace = new ReviewWorkspace({ clock: makeFixedClock(), sessionRepository: new InMemorySessionRepository() });
  const dispatcher = new WorkspaceCommandDispatcher(workspace);
  const file = loadSourceFile(fixtureId);
  const loadResult = await dispatcher.dispatchApplication({ family: "document", type: "load", file });
  check(`${fixtureId} loads cleanly`, loadResult.ok === true, loadResult.reason);
  return dispatcher;
}

// ---- Part 1: itemCheckQuery.ts pure functions -----------------------------

function fakeCandidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: "person:jane doe",
    detectedType: "person",
    source: "regex",
    confidence: "high",
    normalizedValue: "jane doe",
    displayValue: "Jane Doe",
    occurrenceIds: ["occ-1", "occ-2"],
    ...overrides,
  };
}

function fakeFacts(overrides: Partial<CandidateQueryFacts> = {}): CandidateQueryFacts {
  return {
    candidate: fakeCandidate(),
    likelihood: 87,
    decision: undefined,
    isAmbiguous: false,
    categories: [],
    ...overrides,
  };
}

function testPureQueryFunctions(): void {
  console.log("--- Part 1: itemCheckQuery.ts pure functions ---");

  // matchesSearch across every named field
  check("search matches displayValue", matchesSearch(fakeFacts(), "jane"));
  check("search matches replacement text", matchesSearch(fakeFacts({ decision: { candidateId: "x", decision: "Rename", replacement: "WITNESS-1", decidedAt: "t" } }), "witness-1"));
  check("search matches entity type", matchesSearch(fakeFacts(), "person"));
  check("search matches review-state label (unreviewed)", matchesSearch(fakeFacts(), "unreviewed"));
  check("search matches review-state label (a decision kind)", matchesSearch(fakeFacts({ decision: { candidateId: "x", decision: "Redact", decidedAt: "t" } }), "redact"));
  check("search matches likelihood as a number string", matchesSearch(fakeFacts({ likelihood: 87 }), "87"));
  check("search matches ambiguity keyword only when ambiguous", matchesSearch(fakeFacts({ isAmbiguous: true }), "ambiguous"));
  check("search does NOT match ambiguity keyword when not ambiguous", !matchesSearch(fakeFacts({ isAmbiguous: false }), "ambiguous"));
  check("search matches a category label", matchesSearch(fakeFacts({ categories: ["known-first-name"] }), "known-first-name"));
  check("empty search matches everything", matchesSearch(fakeFacts(), ""));
  check("search is case-insensitive", matchesSearch(fakeFacts(), "JANE"));
  check("search rejects a non-matching query", !matchesSearch(fakeFacts(), "zzz-nomatch"));

  // matchesPreset -- all eight
  check("unreviewed: true with no decision", matchesPreset(fakeFacts({ decision: undefined }), "unreviewed"));
  check("unreviewed: false once decided", !matchesPreset(fakeFacts({ decision: { candidateId: "x", decision: "Keep", decidedAt: "t" } }), "unreviewed"));
  check(
    `high-confidence: true at exactly the threshold (${HIGH_CONFIDENCE_THRESHOLD})`,
    matchesPreset(fakeFacts({ likelihood: HIGH_CONFIDENCE_THRESHOLD }), "high-confidence")
  );
  check(
    "high-confidence: false one point below the threshold",
    !matchesPreset(fakeFacts({ likelihood: HIGH_CONFIDENCE_THRESHOLD - 1 }), "high-confidence")
  );
  check("ambiguous: reads isAmbiguous directly", matchesPreset(fakeFacts({ isAmbiguous: true }), "ambiguous"));
  check("people: true for detectedType person", matchesPreset(fakeFacts({ candidate: fakeCandidate({ detectedType: "person" }) }), "people"));
  check("people: false for detectedType email", !matchesPreset(fakeFacts({ candidate: fakeCandidate({ detectedType: "email" }) }), "people"));
  check(
    "organizations: true when carrying an org-evidence category",
    matchesPreset(fakeFacts({ categories: [ORGANIZATION_EVIDENCE_CATEGORIES[0]!] }), "organizations")
  );
  check("organizations: false with no org-evidence category", !matchesPreset(fakeFacts({ categories: ["known-first-name"] }), "organizations"));
  check("ignored: reads decision.decision === Ignore", matchesPreset(fakeFacts({ decision: { candidateId: "x", decision: "Ignore", decidedAt: "t" } }), "ignored"));
  check("renamed: reads decision.decision === Rename", matchesPreset(fakeFacts({ decision: { candidateId: "x", decision: "Rename", decidedAt: "t" } }), "renamed"));
  check("redacted: reads decision.decision === Redact", matchesPreset(fakeFacts({ decision: { candidateId: "x", decision: "Redact", decidedAt: "t" } }), "redacted"));

  // Combining presets is AND, not OR
  const highConfPerson = fakeFacts({ likelihood: 99, candidate: fakeCandidate({ detectedType: "person" }) });
  const lowConfPerson = fakeFacts({ likelihood: 10, candidate: fakeCandidate({ detectedType: "person" }) });
  const presets = new Set<FilterPreset>(["high-confidence", "people"]);
  check("AND semantics: satisfies both active presets", matchesAllActivePresets(highConfPerson, presets));
  check("AND semantics: fails when only one of two active presets is satisfied", !matchesAllActivePresets(lowConfPerson, presets));
  check("AND semantics: empty preset set matches everything", matchesAllActivePresets(lowConfPerson, new Set()));

  // compareCandidates -- all seven sort orders
  const a = fakeFacts({ candidate: fakeCandidate({ id: "a", displayValue: "Alice", occurrenceIds: ["1"] }), likelihood: 50 });
  const b = fakeFacts({ candidate: fakeCandidate({ id: "b", displayValue: "Bob", occurrenceIds: ["1", "2", "3"] }), likelihood: 90 });
  check("confidence-desc: higher likelihood sorts first", compareCandidates(a, b, "confidence-desc") > 0);
  check("confidence-asc: lower likelihood sorts first", compareCandidates(a, b, "confidence-asc") < 0);
  check("occurrence-count-desc: more occurrences sorts first", compareCandidates(a, b, "occurrence-count-desc") > 0);
  check("occurrence-count-asc: fewer occurrences sorts first", compareCandidates(a, b, "occurrence-count-asc") < 0);
  check("alphabetical: Alice before Bob", compareCandidates(a, b, "alphabetical") < 0);
  check(
    "review-state: unreviewed sorts before decided",
    compareCandidates(fakeFacts({ decision: undefined }), fakeFacts({ decision: { candidateId: "x", decision: "Keep", decidedAt: "t" } }), "review-state") < 0
  );
  check(
    "entity-type: alphabetical by detectedType",
    compareCandidates(fakeFacts({ candidate: fakeCandidate({ detectedType: "email" }) }), fakeFacts({ candidate: fakeCandidate({ detectedType: "person" }) }), "entity-type") < 0
  );
  check(
    "confidence-desc: identical likelihood falls back to a deterministic id tie-break",
    compareCandidates(
      fakeFacts({ candidate: fakeCandidate({ id: "aaa" }), likelihood: 50 }),
      fakeFacts({ candidate: fakeCandidate({ id: "bbb" }), likelihood: 50 }),
      "confidence-desc"
    ) < 0
  );
  check(
    "confidence-desc: an unscored candidate (likelihood undefined) sorts last, same as -1",
    compareCandidates(fakeFacts({ likelihood: undefined }), fakeFacts({ likelihood: 1 }), "confidence-desc") > 0
  );

  // queryItemCheck end-to-end: filter then sort
  const pool: CandidateQueryFacts[] = [
    fakeFacts({ candidate: fakeCandidate({ id: "p1", displayValue: "Zed Person", detectedType: "person" }), likelihood: 95 }),
    fakeFacts({ candidate: fakeCandidate({ id: "p2", displayValue: "Amy Person", detectedType: "person" }), likelihood: 60 }),
    fakeFacts({ candidate: fakeCandidate({ id: "e1", displayValue: "someone@example.com", detectedType: "email" }), likelihood: 99 }),
  ];
  const peopleOnlyByConfidence = queryItemCheck(pool, { searchText: "", activePresets: new Set(["people"]), sortOrder: "confidence-desc" });
  check("queryItemCheck: filters out the non-matching preset entry", peopleOnlyByConfidence.length === 2);
  check(
    "queryItemCheck: sorts the filtered result",
    peopleOnlyByConfidence[0]!.candidate.id === "p1" && peopleOnlyByConfidence[1]!.candidate.id === "p2"
  );
  const searched = queryItemCheck(pool, { ...createDefaultQueryState(), searchText: "amy" });
  check("queryItemCheck: search narrows to the one matching candidate", searched.length === 1 && searched[0]!.candidate.id === "p2");
}

// ---- Part 2: review.bulkApplyDecision -------------------------------------

async function testBulkApplyDecision(): Promise<void> {
  console.log("--- Part 2: review.bulkApplyDecision ---");

  {
    const dispatcher = await freshLoadedDispatcher("synthetic-transcript-001");
    const ids = (dispatcher.getState().detection?.candidates ?? []).map((c) => c.id);
    const [id1, id2, id3] = ids;
    const before = dispatcher.getState().reviewSession!.updatedAt;

    const result = dispatcher.dispatchReview({ family: "review", type: "bulkApplyDecision", candidateIds: [id1!, id2!], decision: "Keep" });
    check("bulk Keep of two candidates succeeds", result.ok === true, result.reason);
    const state = dispatcher.getState();
    check("both candidates now have a Keep decision", state.reviewSession?.candidateDecisions[id1!]?.decision === "Keep" && state.reviewSession?.candidateDecisions[id2!]?.decision === "Keep");
    check("the third candidate is untouched", state.reviewSession?.candidateDecisions[id3!] === undefined);
    check("session.updatedAt advanced (verification-staleness dependency)", state.reviewSession!.updatedAt !== before);

    const bulkEvent = state.reviewSession?.events.find((e) => e.kind === "bulk-decided");
    check("a summary bulk-decided event was recorded", bulkEvent !== undefined);
    check("the summary event reports the correct applied count", bulkEvent?.payload.appliedCount === 2);
    check("the summary event reports the correct requested count", bulkEvent?.payload.requestedCount === 2);
    const perCandidateEvents = state.reviewSession?.events.filter((e) => e.kind === "candidate-decided" && e.payload.viaBulkApply === true) ?? [];
    check("one candidate-decided event per applied candidate, tagged viaBulkApply", perCandidateEvents.length === 2);
  }

  {
    // Rename requires a shared replacement string, applied identically to every selected candidate.
    const dispatcher = await freshLoadedDispatcher("synthetic-transcript-001");
    const ids = (dispatcher.getState().detection?.candidates ?? []).map((c) => c.id);
    const missingReplacement = dispatcher.dispatchReview({ family: "review", type: "bulkApplyDecision", candidateIds: [ids[0]!], decision: "Rename" });
    check("bulk Rename with no replacement text is rejected", missingReplacement.ok === false);

    const result = dispatcher.dispatchReview({ family: "review", type: "bulkApplyDecision", candidateIds: [ids[0]!, ids[1]!], decision: "Rename", replacement: "WITNESS" });
    check("bulk Rename with a shared replacement succeeds", result.ok === true, result.reason);
    const state = dispatcher.getState();
    check(
      "every renamed candidate got the SAME shared replacement text",
      state.reviewSession?.candidateDecisions[ids[0]!]?.replacement === "WITNESS" && state.reviewSession?.candidateDecisions[ids[1]!]?.replacement === "WITNESS"
    );
  }

  {
    // Redact: replacement is optional, exactly like the direct redactCandidate command.
    const dispatcher = await freshLoadedDispatcher("synthetic-transcript-001");
    const ids = (dispatcher.getState().detection?.candidates ?? []).map((c) => c.id);
    const result = dispatcher.dispatchReview({ family: "review", type: "bulkApplyDecision", candidateIds: [ids[0]!], decision: "Redact" });
    check("bulk Redact with no replacement succeeds (default placeholder applies at output time)", result.ok === true, result.reason);
    check("no replacement was stored", dispatcher.getState().reviewSession?.candidateDecisions[ids[0]!]?.replacement === undefined);
  }

  {
    // Rejection paths.
    const dispatcher = await freshLoadedDispatcher("synthetic-transcript-001");
    const empty = dispatcher.dispatchReview({ family: "review", type: "bulkApplyDecision", candidateIds: [], decision: "Keep" });
    check("empty selection is rejected", empty.ok === false);

    const allInvalid = dispatcher.dispatchReview({ family: "review", type: "bulkApplyDecision", candidateIds: ["no-such-candidate-1", "no-such-candidate-2"], decision: "Keep" });
    check("a selection with every id invalid is rejected (not a silent no-op success)", allInvalid.ok === false);

    const ids = (dispatcher.getState().detection?.candidates ?? []).map((c) => c.id);
    const partiallyInvalid = dispatcher.dispatchReview({ family: "review", type: "bulkApplyDecision", candidateIds: [ids[0]!, "no-such-candidate"], decision: "Keep" });
    check("a selection with ONE invalid id among valid ones still succeeds for the valid ones", partiallyInvalid.ok === true);
    check("the valid candidate was actually decided", dispatcher.getState().reviewSession?.candidateDecisions[ids[0]!]?.decision === "Keep");
  }

  {
    // Direct overwrite semantics: unlike applyDecisionReuse, bulkApplyDecision IS a direct reviewer action.
    const dispatcher = await freshLoadedDispatcher("synthetic-transcript-001");
    const ids = (dispatcher.getState().detection?.candidates ?? []).map((c) => c.id);
    dispatcher.dispatchReview({ family: "review", type: "keepCandidate", candidateId: ids[0]! });
    check("candidate starts with a direct Keep decision", dispatcher.getState().reviewSession?.candidateDecisions[ids[0]!]?.decision === "Keep");
    const result = dispatcher.dispatchReview({ family: "review", type: "bulkApplyDecision", candidateIds: [ids[0]!], decision: "Ignore" });
    check("bulk action succeeds against an already-decided candidate", result.ok === true, result.reason);
    check("bulk action OVERWRITES the existing decision (unlike applyDecisionReuse)", dispatcher.getState().reviewSession?.candidateDecisions[ids[0]!]?.decision === "Ignore");
  }

  {
    // Verification-staleness interaction: generateOutput, then a bulk change, must invalidate it.
    const dispatcher = await freshLoadedDispatcher("synthetic-transcript-001");
    const ids = (dispatcher.getState().detection?.candidates ?? []).map((c) => c.id);
    for (const id of ids) dispatcher.dispatchReview({ family: "review", type: "keepCandidate", candidateId: id });
    const outputResult = await dispatcher.dispatchApplication({ family: "document", type: "generateOutput" });
    check("generateOutput succeeds once every candidate is decided", outputResult.ok === true, (outputResult as { reason?: string }).reason);
    check("verification is current immediately after generating", dispatcher.getState().readiness.verificationCurrent === true);
    dispatcher.dispatchReview({ family: "review", type: "bulkApplyDecision", candidateIds: [ids[0]!], decision: "Redact" });
    check("a bulk decision after generateOutput invalidates verification currency", dispatcher.getState().readiness.verificationCurrent === false);
  }
}

// ---- Part 3: previousDecided navigation ------------------------------------

async function testPreviousDecidedNavigation(): Promise<void> {
  console.log("--- Part 3: previousDecided navigation ---");

  const dispatcher = await freshLoadedDispatcher("synthetic-transcript-001");
  const ids = (dispatcher.getState().detection?.candidates ?? []).map((c) => c.id);
  // Decide the candidates at index 0 and 2 (leave 1, 3.. undecided) so
  // previousDecided has real, non-adjacent targets to skip to.
  dispatcher.dispatchReview({ family: "review", type: "keepCandidate", candidateId: ids[0]! });
  dispatcher.dispatchReview({ family: "review", type: "keepCandidate", candidateId: ids[2]! });

  dispatcher.dispatchNavigation({ family: "navigation", type: "focusStage", stage: "item-check" });
  dispatcher.dispatchNavigation({ family: "navigation", type: "selectItem", itemId: ids[3]! });
  dispatcher.dispatchNavigation({ family: "navigation", type: "moveItem", direction: "previousDecided" });
  check("previousDecided from index 3 lands on the nearest earlier decided item (index 2)", dispatcher.getState().focus?.target.itemId === ids[2]);

  dispatcher.dispatchNavigation({ family: "navigation", type: "selectItem", itemId: ids[1]! });
  dispatcher.dispatchNavigation({ family: "navigation", type: "moveItem", direction: "previousDecided" });
  check("previousDecided from index 1 lands on the immediately preceding decided item (index 0)", dispatcher.getState().focus?.target.itemId === ids[0]);

  // Wrap-around case: only a LATER item is decided, so a backward scan must
  // exhaust the earlier indices, find nothing, and wrap to the end.
  const wrapDispatcher = await freshLoadedDispatcher("synthetic-transcript-001");
  const wrapIds = (wrapDispatcher.getState().detection?.candidates ?? []).map((c) => c.id);
  wrapDispatcher.dispatchReview({ family: "review", type: "keepCandidate", candidateId: wrapIds[2]! });
  wrapDispatcher.dispatchNavigation({ family: "navigation", type: "focusStage", stage: "item-check" });
  wrapDispatcher.dispatchNavigation({ family: "navigation", type: "selectItem", itemId: wrapIds[1]! });
  wrapDispatcher.dispatchNavigation({ family: "navigation", type: "moveItem", direction: "previousDecided" });
  check(
    "previousDecided wraps past undecided earlier items to the only decided item, which is LATER in the list",
    wrapDispatcher.getState().focus?.target.itemId === wrapIds[2]
  );

  // No decided items at all: previousDecided must not throw and must return
  // a graceful result (falls back to the current item, per findByPredicate's
  // documented "never leaves a non-empty list with no target" contract).
  const freshDispatcher = await freshLoadedDispatcher("synthetic-transcript-001");
  freshDispatcher.dispatchNavigation({ family: "navigation", type: "focusStage", stage: "item-check" });
  const beforeId = freshDispatcher.getState().focus?.target.itemId;
  const navResult = freshDispatcher.dispatchNavigation({ family: "navigation", type: "moveItem", direction: "previousDecided" });
  check("previousDecided with zero decided items does not error", navResult.ok === true);
  check("previousDecided with zero decided items falls back to the current item", freshDispatcher.getState().focus?.target.itemId === beforeId);
}

// ---- Part 4: the "ambiguous" preset against a real ambiguity fixture ------

async function testAmbiguousPresetAgainstRealFixture(): Promise<void> {
  console.log('--- Part 4: "ambiguous" preset against entity-resolution-001 ---');

  const dispatcher = await freshLoadedDispatcher("entity-resolution-001");
  const state = dispatcher.getState();
  const ambiguousIds = new Set(state.grouping?.ambiguityProposals.map((p) => p.candidateId) ?? []);
  check("entity-resolution-001 has at least one real ambiguity proposal to test against", ambiguousIds.size > 0);

  for (const candidate of state.detection?.candidates ?? []) {
    const facts = fakeFacts({ candidate, isAmbiguous: ambiguousIds.has(candidate.id) });
    const expected = ambiguousIds.has(candidate.id);
    check(`"ambiguous" preset for ${candidate.id} matches its real ambiguity-proposal membership`, matchesPreset(facts, "ambiguous") === expected);
  }
}

async function main(): Promise<void> {
  testPureQueryFunctions();
  await testBulkApplyDecision();
  await testPreviousDecidedNavigation();
  await testAmbiguousPresetAgainstRealFixture();

  console.log(`\n${passCount}/${passCount + failCount} checks passed`);
  if (failCount > 0) process.exit(1);
}

main();
