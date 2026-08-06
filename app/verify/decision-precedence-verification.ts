/**
 * Verification harness for the UNIFIED DECISION COLOR SYSTEM (AG,
 * 2026-08-03) -- see docs/architecture/design-notes.md's v2026-08-02.29
 * entry and src/domain/DecisionPrecedence.ts's own doc comment.
 *
 * Covers the one genuinely new pure derivation this change added, plus the
 * presentation vocabulary that has to stay in lockstep with it:
 *
 * Part A -- decisionSummary() (src/domain/DecisionPrecedence.ts): what
 * decisions a card contains and which one speaks for its tint. This is the
 * function every card fill and pill row in the app resolves through, so
 * the precedence order (Redact > Change > Keep > Ignore), the
 * dominant/additional split, and the "additional excludes the dominant"
 * rule are all verified directly rather than through the DOM.
 *
 * Part B -- the presentation maps (src/ui/decisionLabels.ts): pill letters
 * and decision classes must be total and mutually distinct, since a
 * duplicate letter or class would silently make two decisions
 * indistinguishable on screen -- exactly the failure this whole system
 * exists to prevent, and one a type checker cannot catch.
 *
 * Part C -- groupDisplayDecision()'s new `summary` field
 * (src/engines/review/coverage.ts): the additive change is verified to
 * agree with `kind` rather than drift from it. Part A of
 * group-check-revision-verification.ts still covers `kind` itself, which
 * this change deliberately left untouched.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/decision-precedence-verification.ts
 */

import { DECISION_PRECEDENCE, decisionRank, decisionSummary, isMixedDecision, UNDECIDED_SUMMARY } from "../src/domain/DecisionPrecedence.ts";
import { ALL_DECISION_CLASSES, DECISION_DISPLAY_LABEL, DECISION_PILL_LETTER, decisionClass, decisionSummaryDescription } from "../src/ui/decisionLabels.ts";
import { groupDisplayDecision } from "../src/engines/review/coverage.ts";
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

function summaryOf(...decisions: (CandidateDecisionKind | null)[]): { dominant: string; additional: string } {
  const s = decisionSummary(decisions);
  return { dominant: String(s.dominant), additional: s.additional.join(",") };
}

console.log("=== Part A: decisionSummary() ===\n");

// The ordering itself, stated once here so a silent reordering in the
// source is caught rather than quietly repainting every card in the app.
check("precedence is exactly Redact > Rename > Keep > Ignore", DECISION_PRECEDENCE.join(",") === "Redact,Rename,Keep,Ignore", DECISION_PRECEDENCE.join(","));
check("decisionRank orders Redact highest", decisionRank("Redact") === 0 && decisionRank("Ignore") === 3);

// Single-decision cards: dominant is that decision, and there are NO
// pills. The "any pill means more than one thing happened" contract.
for (const kind of DECISION_PRECEDENCE) {
  const s = decisionSummary([kind, kind, kind]);
  check(`all-${kind} card -> dominant ${kind}, no pills`, s.dominant === kind && s.additional.length === 0, JSON.stringify(s));
}

// Andrew's own worked examples from the 2026-08-03 direction, verbatim.
check("Keep + Change -> Change card, Keep pill", JSON.stringify(summaryOf("Keep", "Rename")) === JSON.stringify({ dominant: "Rename", additional: "Keep" }));
check("Change + Redact -> Redact card, Change pill", JSON.stringify(summaryOf("Rename", "Redact")) === JSON.stringify({ dominant: "Redact", additional: "Rename" }));
check("Keep + Redact -> Redact card, Keep pill", JSON.stringify(summaryOf("Keep", "Redact")) === JSON.stringify({ dominant: "Redact", additional: "Keep" }));
check(
  "Keep + Change + Redact -> Redact card, Change then Keep pills (precedence-ordered)",
  JSON.stringify(summaryOf("Keep", "Rename", "Redact")) === JSON.stringify({ dominant: "Redact", additional: "Rename,Keep" })
);

// Pill order must be precedence order regardless of the order decisions
// were made -- position is what makes the pills scannable.
check(
  "pill order is precedence order, not insertion order",
  JSON.stringify(summaryOf("Ignore", "Keep", "Rename", "Redact")) === JSON.stringify({ dominant: "Redact", additional: "Rename,Keep,Ignore" })
);

// Duplicates collapse: the tint and pills answer "which decisions are
// present," never "how many."
check(
  "duplicates collapse -- four Keeps and one Redact == one of each",
  JSON.stringify(summaryOf("Keep", "Keep", "Keep", "Keep", "Redact")) === JSON.stringify(summaryOf("Keep", "Redact"))
);

// Undecided is the ABSENCE of a decision, not a fourth peer: one untouched
// member must not drag a partly-decided card back to neutral. This is the
// rule Andrew chose explicitly ("pills only, as specced") over a separate
// completeness channel, so it is pinned here.
check("no decisions -> dominant null, no pills", decisionSummary([]).dominant === null && decisionSummary([null, null]).dominant === null);
check("empty card returns the shared UNDECIDED_SUMMARY", decisionSummary([]) === UNDECIDED_SUMMARY);
check(
  "PARTIAL card takes its dominant decision, NOT neutral (one Redact among four undecided)",
  JSON.stringify(summaryOf("Redact", null, null, null, null)) === JSON.stringify({ dominant: "Redact", additional: "" })
);
check("nulls and undefined are both treated as undecided", decisionSummary([undefined, null, "Keep"]).dominant === "Keep");
check("isMixedDecision is false for a single-decision card", !isMixedDecision(decisionSummary(["Redact", "Redact"])));
check("isMixedDecision is true once a second decision appears", isMixedDecision(decisionSummary(["Redact", "Keep"])));

console.log("\n=== Part B: presentation vocabulary ===\n");

const letters = DECISION_PRECEDENCE.map((k) => DECISION_PILL_LETTER[k]);
const classes = DECISION_PRECEDENCE.map((k) => decisionClass(k));
check("every decision has a pill letter", letters.every((l) => typeof l === "string" && l.length > 0), letters.join(","));
check("pill letters are mutually distinct", new Set(letters).size === letters.length, letters.join(","));
check("decision classes are mutually distinct", new Set(classes).size === classes.length, classes.join(","));
check("ALL_DECISION_CLASSES matches decisionClass() in precedence order", ALL_DECISION_CLASSES.join(",") === classes.join(","));
// The pill letter follows the DISPLAY vocabulary, not the durable kind --
// Rename reads as "Change" everywhere the reviewer looks, so its letter is
// C. A regression here would put an "R" on both Rename and Redact.
check("Rename's pill letter follows its display label 'Change', not 'Rename'", DECISION_PILL_LETTER.Rename === "C" && DECISION_DISPLAY_LABEL.Rename === "Change");
check("Redact keeps R and they do not collide", DECISION_PILL_LETTER.Redact === "R" && DECISION_PILL_LETTER.Rename !== "R");
check("undecided description", decisionSummaryDescription(decisionSummary([])) === "No decisions yet", decisionSummaryDescription(decisionSummary([])));
check("single-decision description is just the label", decisionSummaryDescription(decisionSummary(["Rename"])) === "Change");
check(
  "mixed description names every decision present",
  decisionSummaryDescription(decisionSummary(["Keep", "Rename", "Redact"])) === "Contains Redact, Change and Keep decisions",
  decisionSummaryDescription(decisionSummary(["Keep", "Rename", "Redact"]))
);

console.log("\n=== Part C: groupDisplayDecision() summary agrees with kind ===\n");

function group(groupId: string, candidateIds: string[]): EntityGroupProposal {
  return {
    groupId,
    candidateIds,
    originalProposalConfidence: 80,
    canonicalName: groupId,
    detectedType: "person",
    memberConfidences: Object.fromEntries(candidateIds.map((id) => [id, 80])),
    reasons: ["deterministic_grouping"],
  };
}

function withDecisions(decisions: Record<string, CandidateDecisionKind>): ReviewSession {
  const session = createReviewSession("s1", "d1", "2026-08-03T00:00:00.000Z");
  const candidateDecisions: Record<string, CandidateDecision> = {};
  for (const [candidateId, decision] of Object.entries(decisions)) {
    candidateDecisions[candidateId] = { candidateId, decision, decidedAt: "2026-08-03T00:00:00.000Z", source: "reviewer" };
  }
  return { ...session, candidateDecisions };
}

{
  const g = group("g1", ["c1", "c2"]);
  const d = groupDisplayDecision(g, withDecisions({}));
  check("untouched group -> kind undecided AND summary empty", d.kind === "undecided" && d.summary.dominant === null, JSON.stringify(d));
}
{
  const g = group("g1", ["c1", "c2"]);
  const d = groupDisplayDecision(g, withDecisions({ c1: "Keep", c2: "Keep" }));
  check("uniform group -> summary.dominant equals the uniform decision", d.kind === "uniform" && d.summary.dominant === "Keep" && d.summary.additional.length === 0, JSON.stringify(d));
}
{
  const g = group("g1", ["c1", "c2", "c3"]);
  const d = groupDisplayDecision(g, withDecisions({ c1: "Keep", c2: "Redact", c3: "Rename" }));
  check(
    "mixed group -> kind still needsAttention (unchanged) AND summary is Redact + [Rename, Keep]",
    d.kind === "needsAttention" && d.summary.dominant === "Redact" && d.summary.additional.join(",") === "Rename,Keep",
    JSON.stringify(d)
  );
}
{
  // The case the amber "needs attention" fill used to cover and the tint +
  // pills model now expresses: partially decided stays needsAttention for
  // the Fix this button, while the card still shows its dominant decision.
  const g = group("g1", ["c1", "c2", "c3"]);
  const d = groupDisplayDecision(g, withDecisions({ c1: "Redact" }));
  check(
    "partially decided -> kind needsAttention (for Fix this) AND card tints Redact",
    d.kind === "needsAttention" && d.summary.dominant === "Redact" && d.summary.additional.length === 0,
    JSON.stringify(d)
  );
}

console.log(`\n${failCount === 0 ? "ALL PASS" : "FAILURES"}: ${passCount} passed, ${failCount} failed`);
if (failCount > 0) process.exit(1);
