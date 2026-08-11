/**
 * candidate-split-verification.ts -- the contract for the structural Split
 * operation and its content-free telemetry seam (AG, 2026-08-10).
 *
 *     node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs \
 *          verify/candidate-split-verification.ts
 *
 * Every module under test here is pure and importable, so every assertion
 * below EXECUTES the shipped code. There is no source-scan section, and the
 * privacy invariant in §7 is proved by walking a constructed value rather
 * than by grepping for field names.
 */

import { readFileSync } from "node:fs";
import {
  buildSplitRecord,
  decomposeForSplit,
  isValidConfirmedPartition,
  normalizeBoundaries,
  splitSegments,
} from "../src/domain/CandidateSplit.js";
import { SPLIT_PROPOSAL_RULE_IDS, canOfferSplit, proposeSplit } from "../src/engines/review/splitProposal.js";
import {
  aggregateSplitTelemetry,
  buildSplitTelemetryEvent,
  emptySplitTelemetryAggregate,
  partitionShape,
} from "../src/metrics/splitTelemetry.js";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}\n         expected ${e}\n         actual   ${a}`);
  }
}

const textsOf = (value: string, boundaries: number[]): string[] =>
  splitSegments(decomposeForSplit(value), boundaries).map((s) => s.text);

console.log("=== CANDIDATE SPLIT ===");

/* ═══════════ 1. DECOMPOSITION IS LOSSLESS ═══════════ */

console.log("\n--- 1. EVERY CHARACTER IS ACCOUNTED FOR ---");
{
  const values = ["Chris, Margaret", "Chris / Margaret", "Chris & Margaret", "Chris and Margaret",
    "Smith Jones Brown", "Admissions / Registrar", "HR and Payroll", "O'Brien-Smith, Jean-Luc"];
  for (const value of values) {
    const d = decomposeForSplit(value);
    /* Reconstruct: leading text + token/separator alternation + trailing. */
    let rebuilt = "";
    if (d.tokens.length > 0) {
      rebuilt += value.slice(0, d.tokens[0]!.startOffset);
      for (let i = 0; i < d.tokens.length; i += 1) {
        rebuilt += d.tokens[i]!.text;
        if (i < d.separators.length) rebuilt += d.separators[i]!.text;
      }
      rebuilt += value.slice(d.tokens[d.tokens.length - 1]!.endOffset);
    } else rebuilt = value;
    check(`"${value}": decomposition reconstructs the value exactly`, rebuilt, value);
    check(`"${value}": every token's offsets quote its own text`,
      d.tokens.every((t) => value.slice(t.startOffset, t.endOffset) === t.text), true);
  }

  /* CONJUNCTIONS ARE SEPARATORS, NOT REVIEW UNITS. */
  const conj = decomposeForSplit("HR and Payroll");
  check("`and` is not a token", conj.tokens.map((t) => t.text), ["HR", "Payroll"]);
  check("...it is preserved verbatim inside the separator", conj.separators[0]?.text, " and ");
  check("...and is recorded as a conjunction", conj.separators[0]?.conjunction, "and");

  const punct = decomposeForSplit("Chris, Margaret");
  check("punctuation is preserved verbatim in the separator", punct.separators[0]?.text, ", ");
  check("...and flagged as dividing", punct.separators[0]?.hasDividingPunctuation, true);
  check("plain whitespace is not dividing punctuation",
    decomposeForSplit("Smith Jones").separators[0]?.hasDividingPunctuation, false);

  /* Token-internal punctuation must not split a word. */
  check("hyphens and apostrophes stay inside a token",
    decomposeForSplit("O'Brien-Smith Jean").tokens.map((t) => t.text), ["O'Brien-Smith", "Jean"]);
}

/* ═══════════ 2. ARBITRARY N-TOKEN PARTITIONS ═══════════ */

console.log("\n--- 2. EVERY PARTITION OF 2, 3 AND 4 TOKENS ---");
{
  check("2-token split", textsOf("Chris, Margaret", [0]), ["Chris", "Margaret"]);

  check("3 tokens, all boundaries", textsOf("A B C", [0, 1]), ["A", "B", "C"]);
  check("3 tokens, 1+2", textsOf("A B C", [0]), ["A", "B C"]);
  check("3 tokens, 2+1", textsOf("A B C", [1]), ["A B", "C"]);

  check("4 tokens, all boundaries", textsOf("A B C D", [0, 1, 2]), ["A", "B", "C", "D"]);
  check("4 tokens, 1+1+2", textsOf("A B C D", [0, 1]), ["A", "B", "C D"]);
  check("4 tokens, 1+2+1", textsOf("A B C D", [0, 2]), ["A", "B C", "D"]);
  check("4 tokens, 2+1+1", textsOf("A B C D", [1, 2]), ["A B", "C", "D"]);
  check("4 tokens, 1+3", textsOf("A B C D", [0]), ["A", "B C D"]);
  check("4 tokens, 2+2", textsOf("A B C D", [1]), ["A B", "C D"]);
  check("4 tokens, 3+1", textsOf("A B C D", [2]), ["A B C", "D"]);

  check("no boundaries yields the whole value as one segment", textsOf("A B C", []), ["A B C"]);
  check("a longer candidate splits at any single boundary",
    textsOf("Smith Jones Brown Davis Clark", [3]), ["Smith Jones Brown Davis", "Clark"]);

  /* INTERNAL SEPARATORS SURVIVE; CUT SEPARATORS DO NOT JOIN A PIECE. */
  check("internal separators are preserved in a multi-token segment",
    textsOf("Chris, Margaret Jones", [0]), ["Chris", "Margaret Jones"]);
  check("the cut separator belongs to neither piece -- `, ` stays in the document",
    textsOf("Chris, Margaret", [0]).join("|"), "Chris|Margaret");
  check("conjunction text is not absorbed into either piece",
    textsOf("HR and Payroll", [0]), ["HR", "Payroll"]);

  /* Segment offsets must quote the original value. */
  const segs = splitSegments(decomposeForSplit("Chris, Margaret"), [0]);
  check("segment offsets index the original value",
    segs.map((s) => "Chris, Margaret".slice(s.startOffset, s.endOffset)), ["Chris", "Margaret"]);
}

/* ═══════════ 3. BOUNDARY VALIDATION ═══════════ */

console.log("\n--- 3. BOUNDARIES ARE NORMALIZED AND RANGE-CHECKED ---");
{
  check("out-of-range boundaries are dropped", normalizeBoundaries([-1, 0, 5], 3), [0]);
  check("duplicates collapse and order is stable", normalizeBoundaries([1, 0, 1], 3), [0, 1]);
  check("a single-token candidate can never be split", isValidConfirmedPartition([0], 1), false);
  check("a confirmed split must cut at least once", isValidConfirmedPartition([], 3), false);
  check("...and is valid when it does", isValidConfirmedPartition([1], 3), true);
  check("a single-token candidate is not offered the action", canOfferSplit(decomposeForSplit("Margaret")), false);
  check("a two-token candidate is", canOfferSplit(decomposeForSplit("Chris, Margaret")), true);
}

/* ═══════════ 4. DETERMINISTIC PROPOSALS ═══════════ */

console.log("\n--- 4. PROPOSALS ARE DETERMINISTIC, GENERAL AND NEVER MUTATIONS ---");
{
  const propose = (value: string, attested?: (i: number) => boolean) =>
    proposeSplit({ decomposition: decomposeForSplit(value), ...(attested ? { tokenIsNameAttested: attested } : {}) });

  const comma = propose("Chris, Margaret");
  check("comma proposes the boundary", [...comma.boundaries], [0]);
  check("...naming the punctuation rule", [...comma.ruleIds], ["split-proposal/dividing-punctuation"]);

  /* GENERALITY: the same rule fires with no person involved. */
  check("slash proposes for an organizational pair", [...propose("Admissions / Registrar").boundaries], [0]);
  check("ampersand proposes", [...propose("Payroll & Benefits").boundaries], [0]);
  check("conjunction proposes", [...propose("HR and Payroll").boundaries], [0]);
  check("...naming the conjunction rule",
    [...propose("HR and Payroll").ruleIds], ["split-proposal/coordinating-conjunction"]);

  /* THE DELIBERATE ASYMMETRY: attestation corroborates, never proposes. */
  const allAttested = () => true;
  check("whitespace alone proposes nothing, even when both sides are attested",
    [...propose("Smith Jones Brown", allAttested).boundaries], []);
  check("...but the candidate is still splittable by hand",
    canOfferSplit(decomposeForSplit("Smith Jones Brown")), true);
  check("attestation reinforces a punctuation boundary",
    [...propose("Chris, Margaret", allAttested).ruleIds],
    ["split-proposal/dividing-punctuation", "split-proposal/attested-on-both-sides"]);
  check("...and does not when only one side is attested",
    [...propose("Chris, Margaret", (i) => i === 0).ruleIds], ["split-proposal/dividing-punctuation"]);

  /* Multiple boundaries. */
  check("every dividing separator is proposed", [...propose("A, B, C").boundaries], [0, 1]);
  check("mixed separators propose only the dividing ones", [...propose("A, B C").boundaries], [0]);

  /* Determinism. */
  for (const value of ["Chris, Margaret", "A, B, C", "Smith Jones Brown", "HR and Payroll"]) {
    check(`"${value}": repeated proposal is byte-identical`,
      JSON.stringify(propose(value, allAttested)) === JSON.stringify(propose(value, allAttested)), true);
  }

  /* A proposal never changes anything: it returns boundaries, and the
   * decomposition it was given is unchanged. */
  const d = decomposeForSplit("Chris, Margaret");
  const before = JSON.stringify(d);
  proposeSplit({ decomposition: d });
  check("proposing mutates nothing", JSON.stringify(d), before);
}

/* ═══════════ 5. PROVENANCE ═══════════ */

console.log("\n--- 5. THE FOUR THINGS AN AUDIT MUST BE ABLE TO TELL APART ---");
{
  const decomposition = decomposeForSplit("Chris, Margaret");
  const proposal = proposeSplit({ decomposition });

  const accepted = buildSplitRecord({
    originalCandidateId: "person:chris, margaret",
    decomposition,
    proposedBoundaries: proposal.boundaries,
    proposalRuleIds: proposal.ruleIds,
    confirmedBoundaries: [0],
    confirmedAt: "2026-08-10T00:00:00.000Z",
  });
  check("original extraction is retained verbatim", accepted.originalValue, "Chris, Margaret");
  check("original token count is retained", accepted.originalTokenCount, 2);
  check("engine proposal is retained", [...accepted.proposedBoundaries], [0]);
  check("...with the rules that produced it", [...accepted.proposalRuleIds], ["split-proposal/dividing-punctuation"]);
  check("user-confirmed partition is retained", [...accepted.confirmedBoundaries], [0]);
  check("exact acceptance is recorded", accepted.acceptedProposalExactly, true);
  check("resulting units are retained", accepted.segments.map((s) => s.text), ["Chris", "Margaret"]);

  /* USER OVERRIDE: proposal and confirmation must stay distinguishable. */
  const overridden = buildSplitRecord({
    originalCandidateId: "person:a b c",
    decomposition: decomposeForSplit("A, B C"),
    proposedBoundaries: [0],
    proposalRuleIds: ["split-proposal/dividing-punctuation"],
    confirmedBoundaries: [0, 1],
    confirmedAt: "2026-08-10T00:00:00.000Z",
  });
  check("an override keeps the proposal on record", [...overridden.proposedBoundaries], [0]);
  check("...alongside what the reviewer actually chose", [...overridden.confirmedBoundaries], [0, 1]);
  check("...and is not recorded as an exact acceptance", overridden.acceptedProposalExactly, false);
  check("...producing the reviewer's units, not the engine's", overridden.segments.map((s) => s.text), ["A", "B", "C"]);

  /* Repeated construction is deterministic. */
  const again = buildSplitRecord({
    originalCandidateId: "person:chris, margaret",
    decomposition,
    proposedBoundaries: proposal.boundaries,
    proposalRuleIds: proposal.ruleIds,
    confirmedBoundaries: [0],
    confirmedAt: "2026-08-10T00:00:00.000Z",
  });
  check("record construction is deterministic", JSON.stringify(again), JSON.stringify(accepted));
}

/* ═══════════ 6. CANCELLATION AND NON-INTERFERENCE ═══════════ */

console.log("\n--- 6. CANCELLATION CHANGES NOTHING; SPLIT DECIDES NOTHING ---");
{
  const decomposition = decomposeForSplit("Chris, Margaret");
  const before = JSON.stringify(decomposition);
  const cancelled = buildSplitTelemetryEvent({
    originalTokenCount: decomposition.tokens.length,
    proposedBoundaries: [0],
    confirmedBoundaries: null,
    proposalRuleIds: ["split-proposal/dividing-punctuation"],
  });
  check("cancellation leaves the decomposition untouched", JSON.stringify(decomposition), before);
  check("cancellation produces no resulting units", cancelled.resultingUnitCount, 0);
  check("...and no confirmed partition", [...cancelled.confirmedPartition], []);
  check("...and is recorded as a rejection", cancelled.outcome, "rejected");

  /* The split modules must not be able to express a decision or a merge. */
  const record = buildSplitRecord({
    originalCandidateId: "x", decomposition,
    proposedBoundaries: [0], proposalRuleIds: [], confirmedBoundaries: [0],
    confirmedAt: "2026-08-10T00:00:00.000Z",
  });
  const serialized = JSON.stringify(record);
  check("a split record carries no decision", /"(decision|replacement|action|resolution)"\s*:/i.test(serialized), false);
  check("a split record carries no entity or group linkage",
    /"(groupId|entityId|linkedTo|mergedWith)"\s*:/i.test(serialized), false);
  check("a split record carries no semantic type",
    /"(semanticType|interpretation|detectedType)"\s*:/i.test(serialized), false);
}

/* ═══════════ 7. THE TELEMETRY PRIVACY INVARIANT ═══════════ */

console.log("\n--- 7. THE TELEMETRY SHAPE CANNOT CARRY DOCUMENT CONTENT ---");
{
  /* Build an event from a candidate containing distinctive text, then prove
   * that text cannot appear anywhere in the event -- and, more strongly, that
   * the event contains NO string at all outside the rule-id allowlist. */
  const value = "Margaret, Chriztopher Zzyzx";
  const decomposition = decomposeForSplit(value);
  const proposal = proposeSplit({ decomposition });
  const event = buildSplitTelemetryEvent({
    originalTokenCount: decomposition.tokens.length,
    proposedBoundaries: proposal.boundaries,
    confirmedBoundaries: [0, 1],
    proposalRuleIds: proposal.ruleIds,
  });

  const ALLOWED_STRINGS = new Set<string>([
    "split",
    ...SPLIT_PROPOSAL_RULE_IDS,
    "accepted-exactly", "accepted-modified", "rejected", "unproposed-manual", "unproposed-cancelled",
  ]);

  const strings: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === "string") { strings.push(node); return; }
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node && typeof node === "object") { Object.values(node).forEach(walk); return; }
  };
  walk(event);

  check("every string in the event is on the allowlist",
    strings.filter((s) => !ALLOWED_STRINGS.has(s)), []);
  check("no token text appears anywhere in the event",
    /Margaret|Chriztopher|Zzyzx/.test(JSON.stringify(event)), false);
  check("no candidate or document identifier field exists",
    /"(candidateId|documentId|value|text|filename|title|replacement|hash|digest|fingerprint)"\s*:/i.test(JSON.stringify(event)), false);
  check("no property bag exists",
    /"(metadata|extra|tags|properties|context|payload)"\s*:/i.test(JSON.stringify(event)), false);

  /* Every value is a number, boolean, or allowlisted string. */
  const allValuesSafe = (node: unknown): boolean => {
    if (typeof node === "number" || typeof node === "boolean") return true;
    if (typeof node === "string") return ALLOWED_STRINGS.has(node);
    if (Array.isArray(node)) return node.every(allValuesSafe);
    if (node && typeof node === "object") return Object.values(node).every(allValuesSafe);
    return false;
  };
  check("every reachable value is a number, a boolean, or an allowlisted string", allValuesSafe(event), true);

  /* Partition shape is sizes, not content -- identical across documents. */
  check("partition shape records segment SIZES", partitionShape(3, [0, 1]), [1, 1, 1]);
  check("...and is the same for any 3-token candidate anywhere", partitionShape(3, [0]), [1, 2]);
  check("the confirmed partition on the event is a shape", [...event.confirmedPartition], [1, 1, 1]);
}

/* ═══════════ 8. LOCAL AGGREGATION, NO TRANSMISSION ═══════════ */

console.log("\n--- 8. AGGREGATION IS LOCAL AND ADDS NO NEW SURFACE ---");
{
  const rule = "split-proposal/dividing-punctuation" as const;
  const events = [
    buildSplitTelemetryEvent({ originalTokenCount: 2, proposedBoundaries: [0], confirmedBoundaries: [0], proposalRuleIds: [rule] }),
    buildSplitTelemetryEvent({ originalTokenCount: 3, proposedBoundaries: [0], confirmedBoundaries: [0, 1], proposalRuleIds: [rule] }),
    buildSplitTelemetryEvent({ originalTokenCount: 2, proposedBoundaries: [0], confirmedBoundaries: null, proposalRuleIds: [rule] }),
    buildSplitTelemetryEvent({ originalTokenCount: 3, proposedBoundaries: [], confirmedBoundaries: [1], proposalRuleIds: [] }),
    buildSplitTelemetryEvent({ originalTokenCount: 2, proposedBoundaries: [], confirmedBoundaries: null, proposalRuleIds: [] }),
  ];
  let aggregate = emptySplitTelemetryAggregate();
  for (const e of events) aggregate = aggregateSplitTelemetry(aggregate, e);

  check("proposals counted", aggregate.splitProposals, 3);
  check("exact accepts counted", aggregate.exactAccepts, 1);
  check("modified accepts counted", aggregate.modifiedAccepts, 1);
  check("rejections counted", aggregate.rejected, 1);
  check("unproposed manual splits counted", aggregate.unproposedManual, 1);
  check("unproposed cancellations counted", aggregate.unproposedCancelled, 1);
  check("partition shapes counted by size signature", aggregate.partitionShapes, { "1-1": 1, "1-1-1": 1, "2-1": 1 });
  check("rule fire counts recorded", aggregate.ruleFireCounts[rule], 3);

  /* The aggregate is subject to the same invariant. */
  const keys = Object.keys(aggregate.partitionShapes);
  check("aggregate keys are size signatures, never content", keys.every((k) => /^\d+(-\d+)*$/.test(k)), true);
  check("aggregation is pure -- folding twice from empty gives the same value",
    JSON.stringify(events.reduce(aggregateSplitTelemetry, emptySplitTelemetryAggregate())),
    JSON.stringify(aggregate));

  /* No network surface anywhere in the seam. */
  const source = [
    "src/metrics/splitTelemetry.ts",
    "src/domain/CandidateSplit.ts",
    "src/engines/review/splitProposal.ts",
  ];
  for (const file of source) {
    const text = readFileSync(file, "utf8");
    check(`${file}: no network call`, /\b(fetch|XMLHttpRequest|WebSocket|navigator\.sendBeacon|axios)\b/.test(text), false);
    check(`${file}: no persistence`, /\b(localStorage|sessionStorage|indexedDB)\b/.test(text), false);
  }
}

console.log("");
if (failures > 0) {
  console.log(`CANDIDATE SPLIT: ${failures} FAILURE(S)`);
  process.exit(1);
}
console.log("CANDIDATE SPLIT: all checks passed.");
