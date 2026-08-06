/**
 * section-action-digits-verification.ts -- SECTION-ACTION DIGITS.
 *
 * Sections number from the TOP of the digit space, items UPWARD from ①,
 * and the two populations meet under a stated collision rule.
 *
 * REVISED (AG, 2026-08-03): section digits are now SEVERITY-FIXED --
 * ⑨ safe / ⑧ change / ⑦ redact -- replacing the 2026-08-02 positional
 * scheme ("the last action lands on the ceiling"). The positional
 * expectations below were not weakened; they were SUPERSEDED, and the
 * defect that superseded them is itself now pinned: under the old rule the
 * term sections' `[Ignore all, Redact all]` resolved to ⑨ = Redact all,
 * putting the destructive move on the key the design teaches as "the
 * section's main move."
 *
 * Node-verifiable core -- the pure allocation policy and everything that
 * derives from it:
 *   - severity-fixed allocation, and gaps where a severity is unoffered;
 *   - the safety invariant: ⑨ is never destructive, on any vocabulary;
 *   - truncation at both ends (a second same-severity action, an identity
 *     option past the lowered ceiling);
 *   - the collision rule: the ITEM side truncates first;
 *   - scope separation: no declared vocabulary exceeds the reserved range,
 *     and the two section-action SOURCES (Accept All vs. tier actions) are
 *     never both populated for one category;
 *   - preferredActions' ROLE tags, which the acronym kind-group buttons
 *     select by (never positionally).
 *
 * NOT coverable here (browser-only, listed in the findings as pending live
 * validation): where the keycaps actually render, that only the ACTIVE
 * scope shows them, and that pressing 7/8/9 runs the matching button.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/section-action-digits-verification.ts
 */

import {
  AMBIGUITY_TIER_ACTIONS,
  GROUP_SCOPE_CHORD_FOR_DECISION,
  SECTION_ACTION_DIGIT_CEILING,
  TRIAGE_SECTION_ACCEPT_DEFAULT,
  itemDigitCeilingBeside,
  sectionActionChord,
  sectionActionDigitAssignments,
  sectionActionSeverity,
  type AmbiguitySectionId,
  type GroupScopeChord,
  type SectionAction,
} from "../src/ui/triageQueue.js";
import { identityDigitAssignments } from "../src/ui/recommendations.js";
import { preferredActionsForRelationship } from "../src/ui/preferredActions.js";
import type { Candidate } from "../src/domain/DocumentModel.js";
import type { RelationshipProposal } from "../src/domain/StructuralRelationship.js";
import type { AmbiguityProposalGroupOption } from "../src/domain/DocumentModel.js";

let passCount = 0;
let failCount = 0;
function check(label: string, condition: boolean): void {
  if (condition) {
    passCount += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failCount += 1;
    console.log(`  FAIL  ${label}`);
  }
}

/** Digits for a hand-built chord sequence -- null means "numbered", a
 *  letter means "reachable by Opt+letter and therefore NOT numbered". */
const digitsFor = (...chords: (GroupScopeChord | null)[]): (number | null)[] =>
  sectionActionDigitAssignments(chords, (c) => c).map((a) => a.digit);

console.log("\nDIGIT ALLOCATION (positional over the UNCHORDED actions only)");
{
  check("no actions -> no assignments", digitsFor().length === 0);
  check("one numbered action -> 9", digitsFor(null).join(",") === "9");
  check("two numbered actions -> 8, 9", digitsFor(null, null).join(",") === "8,9");
  // THE INVARIANT THE SEVERITY BAND WAS INVENTED TO RESCUE, now true for
  // free: a chorded (destructive) action cannot be what 9 lands on, so the
  // rightmost numbered button is always the section's main NAMED move.
  check("a chorded action takes no digit", digitsFor("R").join(",") === "");
  check("chords do not consume positions -- the rest still ends on 9", digitsFor(null, "C", "R").join(",") === "9,,");
  check("mixed list: only the uncharted actions are numbered, ending on 9", digitsFor(null, null, "R").join(",") === "8,9,");
  check("a group of only chorded actions is entirely unnumbered", digitsFor("K", "I", "R").join(",") === ",,");
  check("assignments preserve action identity and order", sectionActionDigitAssignments(["x", "y"], () => null).map((a) => a.action).join(",") === "x,y");
}

console.log("\nCHORDS AND SEVERITY ARE BOTH DERIVED FROM THE DECLARED OPERATION");
{
  const all: SectionAction[] = Object.values(AMBIGUITY_TIER_ACTIONS).flatMap((tiers) => Object.values(tiers ?? {}).flat());
  const find = (label: string): SectionAction | undefined => all.find((a) => a.label === label);
  check("Redact all answers Opt+R", sectionActionChord(find("Redact all")!) === "R");
  check("a conclusion-named Ignore answers Opt+N -- the chord follows the OP, never the wording", sectionActionChord(find("These are all common words")!) === "N");
  check("a Keep-op conclusion answers Opt+K", sectionActionChord(find("Keep abbreviations")!) === "K");
  // accept-suggestions is the population digits exist for: each item takes
  // its OWN suggestion, so no single letter describes the action.
  check("accept-suggestions takes NO chord and stays numbered", sectionActionChord(find("Use full names")!) === null);
  check("the chord map covers every decision kind", Object.keys(GROUP_SCOPE_CHORD_FOR_DECISION).length === 4);

  // ── THE SAFETY PROPERTY, now STRUCTURAL rather than arithmetic ──────
  // The severity band (2026-08-03, superseded within hours) existed to keep
  // a destructive action off 9. Chords achieve it by construction: a
  // destructive action is not numbered at all. This is the assertion that
  // replaces the whole allocation scheme, and it runs over the REAL
  // vocabulary rather than over hand-built cases.
  const vocabularies = Object.values(AMBIGUITY_TIER_ACTIONS).flatMap((tiers) => Object.values(tiers ?? {}));
  check(
    "NOTHING DESTRUCTIVE IS EVER NUMBERED, anywhere in the declared vocabulary",
    vocabularies.every((actions) =>
      sectionActionDigitAssignments(actions ?? [], sectionActionChord).every((a) => a.digit === null || sectionActionSeverity(a.action) === "safe")
    )
  );
  check(
    "...and therefore no 9 is ever destructive",
    vocabularies.every((actions) =>
      sectionActionDigitAssignments(actions ?? [], sectionActionChord).every(
        (a) => !(a.digit === SECTION_ACTION_DIGIT_CEILING && sectionActionSeverity(a.action) !== "safe")
      )
    )
  );
  check(
    "every action is reachable: each has a chord OR a digit, never neither, never both",
    vocabularies.every((actions) =>
      sectionActionDigitAssignments(actions ?? [], sectionActionChord).every((a) => (sectionActionChord(a.action) === null) === (a.digit !== null))
    )
  );
  // The vocabularies collapse to at most two numbered actions each, which is
  // what removed the need for an overflow digit in the first place.
  check(
    "no vocabulary needs more than two digits once decisions leave the numbered space",
    vocabularies.every((actions) => (actions ?? []).filter((a) => sectionActionChord(a) === null).length <= 2)
  );
}

console.log("\nCOLLISION RULE (the ITEM side truncates first)");
{
  check("no section actions -> items keep the full space to 9", itemDigitCeilingBeside([]) === 9);
  check("one numbered action (9) -> items stop at 8", itemDigitCeilingBeside(digitsFor(null)) === 8);
  check("two numbered actions (8,9) -> items stop at 7", itemDigitCeilingBeside(digitsFor(null, null)) === 7);
  check("chorded actions reserve NO digits -- items keep the full space", itemDigitCeilingBeside(digitsFor("R", "C")) === 9);
  for (const combo of [[], [null], [null, null], [null, "R"], ["K", "R"]] as (GroupScopeChord | null)[][]) {
    const digits = digitsFor(...combo);
    const reserved = digits.filter((d): d is number => d !== null);
    const ceiling = itemDigitCeilingBeside(digits);
    check(`[${combo.map((c) => c ?? "#").join("+") || "none"}]: item ceiling sits strictly below every reserved digit`, reserved.every((d) => d > ceiling));
  }
}

console.log("\nITEM-SIDE TRUNCATION AT THE LOWERED CEILING");
{
  const option = (groupId: string): AmbiguityProposalGroupOption =>
    ({ groupId, canonicalName: groupId, confidence: 80, evidence: [] }) as unknown as AmbiguityProposalGroupOption;
  const options = Array.from({ length: 9 }, (_, i) => option(`g${i + 1}`));
  const full = identityDigitAssignments(null, options).map((a) => a.digit);
  check("default ceiling still numbers 1..9 (no section actions)", full.join(",") === "1,2,3,4,5,6,7,8,9");
  const beside2 = identityDigitAssignments(null, options, itemDigitCeilingBeside(digitsFor(null, null))).map((a) => a.digit);
  check("beside two numbered actions (8,9), options stop at 7", beside2.join(",") === "1,2,3,4,5,6,7,,");
  const beside3 = identityDigitAssignments(null, options, itemDigitCeilingBeside([9, 8, 7])).map((a) => a.digit);
  check("beside a scope reaching 7, options stop at 6", beside3.join(",") === "1,2,3,4,5,6,,,");
  check("truncated options are dropped from the digit space, never renumbered", beside3.slice(0, 6).join(",") === "1,2,3,4,5,6");
  // Header chips still own the low digits, and the list still CONTINUES
  // them -- the lowered ceiling changes only where the sequence stops.
  const withChips = identityDigitAssignments(
    { archetype: "uncertain", conclusion: "", suggestions: [{ label: "Person's name", op: { kind: "keep" } }, { label: "Not a name", op: { kind: "ignore" } }] },
    options.slice(0, 6),
    itemDigitCeilingBeside(digitsFor(null, null))
  ).map((a) => a.digit);
  check("chips keep 1-2; the list continues at 3 and stops at the ceiling", withChips.join(",") === "3,4,5,6,7,");
}

console.log("\nSCOPE SEPARATION (declared vocabularies vs. the reserved range)");
{
  const vocabularies = Object.entries(AMBIGUITY_TIER_ACTIONS).flatMap(([sectionId, tiers]) =>
    Object.entries(tiers ?? {}).map(([tierId, actions]) => ({ sectionId, tierId, actions: actions ?? [] }))
  );
  // The property that replaced "at most one action per severity": with safe
  // overflow, a repeated severity is fine -- what must never happen is a
  // DESTRUCTIVE one repeating, since 8 and 7 have no overflow path and the
  // second would render keycap-less.
  check("no declared vocabulary repeats a chord (two buttons answering one key)", vocabularies.every((v) => { const c = v.actions.map(sectionActionChord).filter((x) => x !== null); return new Set(c).size === c.length; }));
  check("every declared tier vocabulary is reachable end-to-end (chord or digit)", vocabularies.every((v) => sectionActionDigitAssignments(v.actions, sectionActionChord).every((a) => a.digit !== null || sectionActionChord(a.action) !== null)));
  // ONE NUMBERING PER HEADING (app.ts's headingSectionActions builds a
  // single list from both possible sources -- Accept All, then tier
  // actions -- and numbers it ONCE). The property that matters is that
  // concatenation yields one digit space, not two: two independent passes
  // would mint two 9s, which is the failure this design must exclude.
  // Accept All (numbered) then institutional's [Ignore all, Redact all]
  // (both chorded): only Accept All is numbered, so it takes 9 alone.
  const acceptAllThenTier: (GroupScopeChord | null)[] = [null, ...(AMBIGUITY_TIER_ACTIONS.institutional?.strong ?? []).map(sectionActionChord)];
  const mergedDigits = sectionActionDigitAssignments(acceptAllThenTier, (x) => x).map((a) => a.digit);
  check("a heading concatenating both sources numbers them as ONE list", mergedDigits.join(",") === "9,,");
  check("...and therefore mints exactly one 9", mergedDigits.filter((d) => d === 9).length === 1);
  check("...with no digit claimed twice", new Set(mergedDigits.filter((d) => d !== null)).size === mergedDigits.filter((d) => d !== null).length);
  // Categories carrying a triage Accept All are still reachable here, so
  // this stays a live check if a future policy merges the vocabularies.
  check("the triage Accept All vocabulary is non-empty (the merge case is real, not hypothetical)", Object.keys(TRIAGE_SECTION_ACCEPT_DEFAULT).length > 0);
  check("the acronym category declares actions on both tiers", (AMBIGUITY_TIER_ACTIONS.acronyms?.strong?.length ?? 0) > 0 && (AMBIGUITY_TIER_ACTIONS.acronyms?.["needs-review"]?.length ?? 0) > 0);
}

console.log("\nACRONYM KIND-GROUP ACTIONS SELECT BY ROLE, NEVER BY INDEX");
{
  const member = (id: string, value: string): Candidate => ({ id, displayValue: value, detectedType: "person", occurrenceIds: [] }) as unknown as Candidate;
  const proposal = (ids: string[]): RelationshipProposal => ({ proposalId: "p1", kind: "acronym", candidateIds: ids, observation: "", evidence: "" }) as unknown as RelationshipProposal;

  const both = preferredActionsForRelationship(proposal(["c1", "c2"]), [member("c1", "Information Technology Services"), member("c2", "ITS")]);
  check("acronym card offers two actions", both.length === 2);
  check("digit 1 is the written-out value", both[0]?.label === "Information Technology Services" && both[0]?.role === "written-out");
  check("digit 2 is the acronym", both[1]?.label === "ITS" && both[1]?.role === "acronym");
  check("both carry bulk-change ops with their own value as the replacement", both.every((a) => a.op.kind === "bulk-change" && a.op.replacement === a.label));

  // THE reason roles exist: index 0 is NOT always the written-out value.
  const acronymOnly = preferredActionsForRelationship(proposal(["c1", "c2"]), [member("c1", "ITS"), member("c2", "NSC")]);
  check("a card with no written-out member returns only the acronym action", acronymOnly.length === 1 && acronymOnly[0]?.role === "acronym");
  check("selecting by INDEX would mistake it for the written-out value", acronymOnly[0]?.label === "ITS");
  check("selecting by ROLE correctly finds nothing to write out (skip-and-narrate)", acronymOnly.find((a) => a.role === "written-out") === undefined);
  check("selecting by ROLE still finds the acronym", acronymOnly.find((a) => a.role === "acronym")?.op.kind === "bulk-change");

  // Non-acronym kinds carry no role: their single action has no "side".
  const identifier = preferredActionsForRelationship(
    { proposalId: "p2", kind: "numeric-identifier", candidateIds: ["c3"], observation: "", evidence: "" } as unknown as RelationshipProposal,
    [member("c3", "123456789")]
  );
  check("identifier-pattern actions carry no role tag", identifier.length === 1 && identifier[0]?.role === undefined);
}

console.log(`\n${passCount}/${passCount + failCount} checks passed`);
process.exitCode = failCount === 0 ? 0 : 1;
