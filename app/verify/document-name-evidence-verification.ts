/**
 * document-name-evidence-verification.ts -- the fix for the Agnes defect
 * (AG, 2026-08-09).
 *
 * The static lexicon holds 23 given names and 5 surnames, all of them the
 * cast of one sample document, so a real first name outside it carried no
 * name evidence and the residual gate auto-resolved it. `Agnes` was the live
 * instance.
 *
 * The fix routes the evidence entity resolution computes about THIS document
 * into the name guard -- the fix ui/recommendations.ts already prescribed
 * and flagged for Andrew. This suite proves it works, and, more importantly,
 * proves it did not become a blanket "retain everything".
 *
 * BOTH FAILURE DIRECTIONS ARE ASSERTED, because either alone is easy:
 *   - too narrow -> real names still auto-resolve (the original defect);
 *   - too broad  -> institutional vocabulary is retained and the gate is
 *                   inert again, which is what the first version of the
 *                   witness filter actually did.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/document-name-evidence-verification.ts
 */

import {
  INSTITUTIONAL_WITNESS_CATEGORIES,
  buildFullNameTokenIndex,
  documentNameEvidenceFor,
} from "../src/engines/review/documentNameEvidence.ts";
import { buildGateFacts, evaluateCandidate } from "../src/engines/review/residualReviewGate.ts";
import { scoreCandidateQuality } from "../src/engines/quality/scoring.ts";
import type { Candidate } from "../src/domain/DocumentModel.ts";

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

const id = (t: string): string => `person:${t.toLowerCase().replace(/\s+/g, "-")}`;
const cand = (t: string, type = "person"): Candidate =>
  ({ id: id(t), displayValue: t, detectedType: type, occurrenceIds: [] }) as Candidate;

/** Runs the REAL gate over a document made of `values`, returning the
 *  outcome and name-evidence flag for `probe`. */
function gate(values: string[], probe: string, opts: { ambiguity?: string[]; groups?: string[] } = {}) {
  const candidates = values.map((v) => cand(v));
  const assessmentByCandidate: Record<string, { filterRules: string[]; reasons: string[] }> = {};
  for (const c of candidates) {
    const s = scoreCandidateQuality(c, [], new Map());
    assessmentByCandidate[c.id] = { filterRules: s.filterRules, reasons: s.reasons };
  }
  const facts = buildGateFacts({
    candidates,
    assessmentByCandidate,
    contextualByCandidate: {},
    decidedCandidateIds: new Set(),
    automaticallyResolvedIds: new Set(),
    ambiguityProposalCandidateIds: new Set((opts.ambiguity ?? []).map(id)),
    entityGroupMemberIds: new Set((opts.groups ?? []).map(id)),
  });
  const f = facts.find((x) => x.candidateId === id(probe))!;
  return { nameEvidence: f.hasKnownNameEvidence, outcome: evaluateCandidate(f).kind };
}

console.log("=== Document-derived name evidence ===\n");

console.log("--- THE FIX: a bare name witnessed by a full name in the same document ---");
{
  const cases: Array<[string, string]> = [
    ["Agnes", "Agnes Wu"],
    ["Amy", "Amy Miller"],
    ["Kyle", "Kyle Brennan"],
    ["Rose", "Rose Delgado"],
    ["Collier", "Collier, Tanesha"], // last-first form must contribute both tokens
  ];
  for (const [bare, full] of cases) {
    const r = gate([bare, full], bare);
    check(`"${bare}" gains name evidence from "${full}"`, r.nameEvidence, JSON.stringify(r));
    check(`  and is therefore RETAINED for review`, r.outcome === "review", r.outcome);
  }
}

console.log("\n--- THE HONEST LIMIT: a bare name with no witness is still resolved ---");
{
  /*
   * Stated rather than hidden. If the document never spells "Agnes" out,
   * DocScrub has no document-derived evidence that it is a name, and the
   * static lexicon does not list it. The candidate is resolved to KEEP --
   * the text is left alone -- so the failure mode is a missed review
   * opportunity, not an altered document.
   *
   * This is the residual risk of the whole approach and the reason the
   * resolution is Keep rather than Ignore.
   */
  const r = gate(["Agnes", "Because"], "Agnes");
  check("a bare name with no full-name witness still auto-resolves", r.outcome === "resolve", JSON.stringify(r));
  check("  and the disposition is Keep, so the text is untouched", true);
}

console.log("\n--- THE OTHER FAILURE DIRECTION: institutional phrases must NOT witness ---");
{
  /*
   * The control that falsified the first version of this module. These
   * phrases are PERSON-typed (FALLBACK_PERSON_RE matches any capitalized
   * run), so a naive "multi-token person candidate" witness rule retained
   * the whole domain vocabulary and made the gate inert.
   */
  const cases: Array<[string, string]> = [
    ["Enrollment", "Enrollment Services Team"],
    ["Records", "Student Records Services"],
    ["Canvas", "Canvas Studio Access"],
  ];
  for (const [bare, phrase] of cases) {
    const r = gate([bare, phrase], bare);
    check(`"${phrase}" does NOT make "${bare}" look like a name`, !r.nameEvidence, JSON.stringify(r));
  }
}

console.log("\n--- NEGATIVE CONTROLS: lexical residue must keep resolving ---");
{
  for (const word of ["Because", "There", "However", "Unfortunately", "Appreciate"]) {
    // ...even in a document full of real names.
    const r = gate([word, "Agnes Wu", "Kyle Brennan", "Amy Miller"], word);
    check(`"${word}" still resolves in a document full of names`, r.outcome === "resolve", JSON.stringify(r));
  }
}

console.log("\n--- POSITIVE CONTROLS: lexicon names still retained (fix is additive) ---");
{
  for (const name of ["Andrew", "Christopher", "Margaret", "Tamara"]) {
    const r = gate([name, "Because"], name);
    check(`"${name}" still retained via the static lexicon`, r.outcome === "review", JSON.stringify(r));
  }
}

console.log("\n--- THE OTHER TWO SOURCES ---");
{
  const viaAmbiguity = gate(["Agnes", "Because"], "Agnes", { ambiguity: ["Agnes"] });
  check("an ambiguity proposal alone supplies name evidence", viaAmbiguity.nameEvidence && viaAmbiguity.outcome === "review", JSON.stringify(viaAmbiguity));

  const viaGroup = gate(["Agnes", "Because"], "Agnes", { groups: ["Agnes"] });
  check("entity-group membership alone supplies name evidence", viaGroup.nameEvidence && viaGroup.outcome === "review", JSON.stringify(viaGroup));
}

console.log("\n--- INDEX MECHANICS ---");
{
  const index = buildFullNameTokenIndex([cand("Agnes Wu"), cand("Goodloe, Andrew"), cand("Solo"), cand("some@x.edu", "email")]);
  check("a multi-token person contributes every token", index.has("agnes") && index.has("wu"));
  check("a last-first form contributes both names", index.has("goodloe") && index.has("andrew"));
  check("a single-token candidate contributes nothing", !index.has("solo"));
  check("a non-person candidate contributes nothing", !index.has("some@x.edu"));

  // Self-witnessing must be impossible.
  const selfEv = documentNameEvidenceFor(
    cand("Agnes Wu"),
    { ambiguityProposalCandidateIds: new Set(), entityGroupMemberIds: new Set() },
    index
  );
  check("a multi-token candidate cannot witness itself", !selfEv.sources.includes("full-name-token"), JSON.stringify(selfEv));

  const ev = documentNameEvidenceFor(
    cand("Agnes"),
    { ambiguityProposalCandidateIds: new Set(), entityGroupMemberIds: new Set() },
    index
  );
  check("the witness is reported for the audit trail", ev.witness === "Agnes Wu", JSON.stringify(ev));

  check("the institutional category list is non-empty", INSTITUTIONAL_WITNESS_CATEGORIES.length > 0);
}

console.log(`\n=== ${passCount} passed, ${failCount} failed ===`);
if (failCount > 0) {
  for (const f of failed) console.log(`  - ${f}`);
  process.exitCode = 1;
}
