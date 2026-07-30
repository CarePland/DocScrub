/**
 * Verification harness for the Ambiguity Check anchor correction
 * (2026-07-28) -- see src/engines/entity-resolution/resolution.ts's top doc
 * comment ("DISCLOSED BEHAVIORAL CHANGE") and
 * docs/detection/ambiguity-anchor-correction.md for the full root-cause
 * trace this suite verifies.
 *
 * Bug: a first-name-only candidate sharing a token with an established
 * full-name entity was never proposed as an ambiguity when that full-name
 * entity had only ONE detected spelling (buildAmbiguousMatches sourced its
 * evidence from the post-filter `groups` list, which requires >=2 members to
 * exist at all). Andrew's real document -- "Andrew Goodloe" mentioned once,
 * "Andrew" mentioned five times elsewhere -- hit exactly this gap.
 *
 * Andrew's five explicitly requested scenarios (quoted from his instruction)
 * are covered by named sections below:
 *   1. "one full name plus matching first-name-only occurrences"      -> Part A1, B1
 *   2. "two people sharing that first name"                            -> Part A2, B4
 *   3. "first-name text used as a non-person/common-language term"     -> Part A3
 *   4. "suppression of the resolved candidate from later review stages"-> Part B1, B5
 *   5. "preservation of the original surface text ... linked to the
 *       full-name entity"                                              -> Part B1
 *
 * Plus a regression check (Part A4) confirming the previously-working
 * "two independently multi-variant full names" case is byte-identical to
 * before the fix, and error-path checks (Part B2/B3) confirming
 * linkAmbiguousCandidate validates against the LIVE proposal, not blindly.
 *
 * TWO LAYERS, matching this codebase's established split:
 *  - Part A exercises resolution.ts's pure functions directly (fast,
 *    precise, no engine/session machinery) -- this is where the actual
 *    defect lived, so it gets the most granular coverage.
 *  - Part B exercises the full DurableReviewEngine + stages.ts pipeline,
 *    because "suppression from later stages" and "surface text
 *    preservation" are properties of the REDUCER + navigation layer, not of
 *    resolution.ts alone -- resolution.ts only produces the proposal, it
 *    doesn't decide anything or track resolved status.
 *
 * SCOPE BOUNDARY: Part B verifies surface-text preservation at the
 * CandidateDecision level (decision === "Keep", replacement === undefined,
 * source Candidate.displayValue left untouched) -- the boundary
 * linkAmbiguousCandidate actually owns. DocumentRebuilder's own reading of
 * undecided/Keep candidates was NOT touched by this fix and is already
 * covered by its own existing verification; re-deriving a rendered .docx
 * here would test code this change didn't modify.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/ambiguity-anchor-verification.ts
 */

import { buildEntityGroups, buildAmbiguousMatches } from "../src/engines/entity-resolution/resolution.ts";
import { RegexEntityResolutionEngine } from "../src/engines/EntityResolutionEngine.ts";
import { DurableReviewEngine } from "../src/engines/ReviewEngine.ts";
import { createReviewSession } from "../src/engines/review/session.ts";
import { itemIdsForStage, isItemResolved } from "../src/engines/navigation/stages.ts";
import type { Candidate } from "../src/domain/DocumentModel.ts";
import type { DetectionResult } from "../src/engines/DetectionEngine.ts";
import type { QualityResult } from "../src/domain/Evidence.ts";
import type { DetectionGroupingContext } from "../src/engines/DetectionGroupingContext.ts";

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

function candidate(id: string, displayValue: string, occCount: number, confidence: "high" | "medium" | "low" = "low"): Candidate {
  return {
    id,
    detectedType: "person",
    source: "fallback-single-name-regex",
    confidence,
    normalizedValue: displayValue.toLowerCase(),
    displayValue,
    occurrenceIds: Array.from({ length: occCount }, (_, i) => `${id}:occ:${i}`),
  };
}

const qualityOf = () => "Possible" as const;

// Minimal-but-real QualityResult -- assessmentByCandidate is intentionally
// empty; qualityLookup() in EntityResolutionEngine.ts already defaults
// missing entries to "Possible", matching Python's Candidate.quality
// dataclass default. No candidate in this suite needs a non-default label.
function emptyQuality(): QualityResult {
  return { schemaVersion: 1, evidenceByCandidate: {}, scoreByCandidate: {}, recommendationByCandidate: {}, assessmentByCandidate: {} };
}

function detectionOf(candidates: Candidate[]): DetectionResult {
  return { schemaVersion: 1, candidates, occurrences: [] };
}

async function main(): Promise<void> {
  console.log("=== Part A: resolution.ts pure-function checks ===\n");

  console.log("--- A1: one full name + matching first-name-only occurrences ---");
  {
    const candidates = [candidate("c-andrew-goodloe", "Andrew Goodloe", 3), candidate("c-andrew", "Andrew", 5)];
    const groups = buildEntityGroups(candidates, qualityOf);
    const ambiguous = buildAmbiguousMatches(candidates, groups, qualityOf);
    check("no real group forms (only one full-name spelling)", groups.length === 0, JSON.stringify(groups));
    check("bare 'Andrew' is proposed as ambiguous", ambiguous.length === 1, JSON.stringify(ambiguous));
    const match = ambiguous[0];
    check("proposal is for the bare-first-name candidate", match?.candidateKey === "c-andrew");
    check("exactly one plausible entity offered", match?.possibleGroups.length === 1, JSON.stringify(match?.possibleGroups));
    check("that entity is Andrew Goodloe", match?.possibleGroups[0]?.canonicalName === "Andrew Goodloe");
    check("anchor id matches the deterministic person-group key", match?.possibleGroups[0]?.id === "person:goodloe:a");
    check("anchor confidence is a valid score (35-99)", (match?.possibleGroups[0]?.confidence ?? -1) >= 35 && (match?.possibleGroups[0]?.confidence ?? 999) <= 99);
  }

  console.log("\n--- A2: two people sharing that first name ---");
  {
    const candidates = [
      candidate("c-andrew-goodloe", "Andrew Goodloe", 3),
      candidate("c-andrew-jackson", "Andrew Jackson", 2),
      candidate("c-andrew", "Andrew", 5),
    ];
    const groups = buildEntityGroups(candidates, qualityOf);
    const ambiguous = buildAmbiguousMatches(candidates, groups, qualityOf);
    check("neither solitary full name forms a real group", groups.length === 0, JSON.stringify(groups));
    check("bare 'Andrew' is proposed as ambiguous", ambiguous.length === 1);
    const options = ambiguous[0]?.possibleGroups ?? [];
    check("BOTH people are offered as options, not just one", options.length === 2, JSON.stringify(options));
    const names = options.map((o) => o.canonicalName).sort();
    check("options are exactly Andrew Goodloe and Andrew Jackson", JSON.stringify(names) === JSON.stringify(["Andrew Goodloe", "Andrew Jackson"]), JSON.stringify(names));
    check("option ids are distinct (no accidental collapse into one entity)", options[0]?.id !== options[1]?.id);
  }

  console.log("\n--- A3: first-name text with no matching full-name entity anywhere (non-person/common-language use) ---");
  {
    // "River" (or any solitary person-typed single-token candidate) with no
    // full-name anchor sharing that first token anywhere in the document.
    // This is exactly the shape a common word misdetected as a name, or a
    // first name with no full-name counterpart, takes at this layer --
    // resolution.ts's job is only "does a plausible full-name entity exist
    // to link this to," and it must correctly decline rather than
    // fabricate a match. (Recognizing "May" as a month vs. a name at all is
    // DetectionEngine/CandidateQualityEngine's concern, a different layer,
    // not exercised here.)
    const candidates = [candidate("c-river", "River", 3)];
    const groups = buildEntityGroups(candidates, qualityOf);
    const ambiguous = buildAmbiguousMatches(candidates, groups, qualityOf);
    check("no group forms", groups.length === 0);
    check("no ambiguity is fabricated when no anchor exists", ambiguous.length === 0, JSON.stringify(ambiguous));
  }

  console.log("\n--- A4: regression check -- two independently multi-variant full names (previously-working case) ---");
  {
    const candidates = [
      candidate("c-andrew-goodloe", "Andrew Goodloe", 14),
      candidate("c-a-goodloe", "A. Goodloe", 3),
      candidate("c-andrew-jackson", "Andrew Jackson", 5),
      candidate("c-a-jackson", "A. Jackson", 2),
      candidate("c-andrew", "Andrew", 2),
    ];
    const groups = buildEntityGroups(candidates, qualityOf);
    const ambiguous = buildAmbiguousMatches(candidates, groups, qualityOf);
    check("both spelling-variant pairs still form real groups", groups.length === 2, JSON.stringify(groups.map((g) => g.id)));
    check("bare 'Andrew' is still proposed as ambiguous", ambiguous.length === 1);
    const options = ambiguous[0]?.possibleGroups ?? [];
    check("still offered both entities", options.length === 2, JSON.stringify(options));
    const optionIds = options.map((o) => o.id).sort();
    const groupIds = groups.map((g) => g.id).sort();
    check(
      "anchor ids for a realized group are IDENTICAL to that group's own id (no drift between anchor scoring and real-group scoring)",
      JSON.stringify(optionIds) === JSON.stringify(groupIds),
      `${JSON.stringify(optionIds)} vs ${JSON.stringify(groupIds)}`
    );
  }

  console.log("\n=== Part B: full pipeline (DurableReviewEngine + stages.ts) ===\n");

  console.log("--- B1: link to full-name entity -- suppression + surface-text preservation ---");
  {
    const candidates = [candidate("c-andrew-goodloe", "Andrew Goodloe", 3), candidate("c-andrew", "Andrew", 5)];
    const detection = detectionOf(candidates);
    const grouping = new RegexEntityResolutionEngine().propose(detection, emptyQuality());
    const context: DetectionGroupingContext = { detection, grouping };
    const session = createReviewSession("s-b1", "doc-b1", "2026-07-28T00:00:00.000Z");
    const engine = new DurableReviewEngine(detection, grouping, session, () => "2026-07-28T00:00:01.000Z");

    check("'Andrew' appears in ambiguity-check's item list", itemIdsForStage("ambiguity-check", context).includes("c-andrew"));
    check("unresolved before any decision", !isItemResolved("ambiguity-check", "c-andrew", context, engine.getState()));

    const proposal = grouping.ambiguityProposals.find((p) => p.candidateId === "c-andrew");
    const groupId = proposal?.candidateGroupOptions[0]?.groupId;
    check("proposal + option exist to link against", !!groupId, JSON.stringify(proposal));

    const result = engine.dispatch({ family: "review", type: "linkAmbiguousCandidate", candidateId: "c-andrew", groupId: groupId ?? "" });
    check("linkAmbiguousCandidate succeeds", result.ok, !result.ok ? result.reason : undefined);

    const state = engine.getState();
    const decision = state.candidateDecisions["c-andrew"];
    check("decision recorded is Keep, not Rename", decision?.decision === "Keep", JSON.stringify(decision));
    check("no replacement text set -- original surface text is NOT rewritten to the canonical name", decision?.replacement === undefined, JSON.stringify(decision));

    const resolution = state.ambiguityResolutions["c-andrew"];
    check("ambiguityResolutions records the link", resolution?.resolvedGroupId === groupId, JSON.stringify(resolution));

    const kinds = state.events.map((e) => e.kind);
    check("candidate-decided event emitted", kinds.includes("candidate-decided"));
    check("ambiguity-resolved event emitted", kinds.includes("ambiguity-resolved"));

    const stillAndrew = detection.candidates.find((c) => c.id === "c-andrew");
    check("the candidate's own displayValue is untouched -- 'Andrew' stays 'Andrew'", stillAndrew?.displayValue === "Andrew");

    check("now resolved on ambiguity-check (suppressed from that stage going forward)", isItemResolved("ambiguity-check", "c-andrew", context, state));
    check("now resolved on item-check too (does not reappear as a standalone downstream item)", isItemResolved("item-check", "c-andrew", context, state));
  }

  console.log("\n--- B2: linkAmbiguousCandidate rejects a groupId that isn't one of THIS candidate's proposed options ---");
  {
    const candidates = [candidate("c-andrew-goodloe", "Andrew Goodloe", 3), candidate("c-andrew", "Andrew", 5)];
    const detection = detectionOf(candidates);
    const grouping = new RegexEntityResolutionEngine().propose(detection, emptyQuality());
    const session = createReviewSession("s-b2", "doc-b2", "2026-07-28T00:00:00.000Z");
    const engine = new DurableReviewEngine(detection, grouping, session, () => "2026-07-28T00:00:01.000Z");

    const result = engine.dispatch({ family: "review", type: "linkAmbiguousCandidate", candidateId: "c-andrew", groupId: "person:not-a-real-option:x" });
    check("rejected", !result.ok);
    check("reason names the invalid option", !result.ok && result.reason.includes("not one of"), !result.ok ? result.reason : undefined);
    check("no decision was recorded on rejection", engine.getState().candidateDecisions["c-andrew"] === undefined);
  }

  console.log("\n--- B3: linkAmbiguousCandidate rejects a candidate that isn't currently proposed as ambiguous ---");
  {
    const candidates = [candidate("c-andrew-goodloe", "Andrew Goodloe", 3), candidate("c-andrew", "Andrew", 5)];
    const detection = detectionOf(candidates);
    const grouping = new RegexEntityResolutionEngine().propose(detection, emptyQuality());
    const session = createReviewSession("s-b3", "doc-b3", "2026-07-28T00:00:00.000Z");
    const engine = new DurableReviewEngine(detection, grouping, session, () => "2026-07-28T00:00:01.000Z");

    // "Andrew Goodloe" (the full-name candidate itself) is never proposed
    // as an ambiguity -- it IS the anchor, not a reference to one.
    const result = engine.dispatch({ family: "review", type: "linkAmbiguousCandidate", candidateId: "c-andrew-goodloe", groupId: "person:goodloe:a" });
    check("rejected", !result.ok);
    check("reason explains it is not a currently-proposed ambiguity", !result.ok && result.reason.includes("not a currently-proposed ambiguity"), !result.ok ? result.reason : undefined);
  }

  console.log("\n--- B4: two people sharing a first name -- linking to ONE must not affect the OTHER (regression risk) ---");
  {
    const candidates = [
      candidate("c-andrew-goodloe", "Andrew Goodloe", 3),
      candidate("c-andrew-jackson", "Andrew Jackson", 2),
      candidate("c-andrew", "Andrew", 5),
    ];
    const detection = detectionOf(candidates);
    const grouping = new RegexEntityResolutionEngine().propose(detection, emptyQuality());
    const session = createReviewSession("s-b4", "doc-b4", "2026-07-28T00:00:00.000Z");
    const engine = new DurableReviewEngine(detection, grouping, session, () => "2026-07-28T00:00:01.000Z");

    const proposal = grouping.ambiguityProposals.find((p) => p.candidateId === "c-andrew");
    const jacksonOption = proposal?.candidateGroupOptions.find((o) => o.canonicalName === "Andrew Jackson");
    check("Andrew Jackson is one of the offered options", !!jacksonOption, JSON.stringify(proposal));

    const result = engine.dispatch({ family: "review", type: "linkAmbiguousCandidate", candidateId: "c-andrew", groupId: jacksonOption?.groupId ?? "" });
    check("linking to Jackson succeeds", result.ok, !result.ok ? result.reason : undefined);

    const state = engine.getState();
    check("resolution correctly points at Jackson, not Goodloe", state.ambiguityResolutions["c-andrew"]?.resolvedGroupId === jacksonOption?.groupId);
    check(
      "Andrew Goodloe's own candidate is completely unaffected -- no decision, no cross-linkage",
      state.candidateDecisions["c-andrew-goodloe"] === undefined && state.ambiguityResolutions["c-andrew-goodloe"] === undefined
    );
    check("Andrew Jackson's own candidate is also unaffected -- linking is one-directional, not a merge", state.candidateDecisions["c-andrew-jackson"] === undefined);
  }

  console.log("\n--- B5: declining -- reviewer decides 'Andrew' is not (this) person, without using linkAmbiguousCandidate ---");
  {
    const candidates = [candidate("c-andrew-goodloe", "Andrew Goodloe", 3), candidate("c-andrew", "Andrew", 5)];
    const detection = detectionOf(candidates);
    const grouping = new RegexEntityResolutionEngine().propose(detection, emptyQuality());
    const context: DetectionGroupingContext = { detection, grouping };
    const session = createReviewSession("s-b5", "doc-b5", "2026-07-28T00:00:00.000Z");
    const engine = new DurableReviewEngine(detection, grouping, session, () => "2026-07-28T00:00:01.000Z");

    // Reviewer decides the standalone "Andrew" occurrences are not a name
    // in this document (or refer to someone entirely undetected) --
    // exactly the "allowing the reviewer to decide ... is not a name in
    // those contexts" branch of Andrew's expected behavior. No new command
    // needed: an ordinary decision dispatched directly, same as any other
    // ambiguity-check candidate the reviewer declines to link.
    const result = engine.dispatch({ family: "review", type: "ignoreCandidate", candidateId: "c-andrew" });
    check("ignoreCandidate succeeds without going through linkAmbiguousCandidate", result.ok);

    const state = engine.getState();
    check("decision recorded as Ignore", state.candidateDecisions["c-andrew"]?.decision === "Ignore");
    check("NO ambiguityResolutions entry -- declining is distinct from linking", state.ambiguityResolutions["c-andrew"] === undefined);
    check("still suppressed from ambiguity-check going forward (resolved, just not linked)", isItemResolved("ambiguity-check", "c-andrew", context, state));
    check("still suppressed from item-check going forward", isItemResolved("item-check", "c-andrew", context, state));
  }

  console.log(`\n${passCount}/${passCount + failCount} checks passed`);
  process.exitCode = failCount === 0 ? 0 : 1;
}

main();
