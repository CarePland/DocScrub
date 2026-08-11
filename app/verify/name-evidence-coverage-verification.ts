/**
 * name-evidence-coverage-verification.ts -- the upstream evidence audit the
 * residual gate triggered (AG, 2026-08-09).
 *
 * ============================== THE FINDING ==============================
 * The gate's central safety guard -- "any known-name evidence retains the
 * candidate" -- is backed by a lexicon of 23 given names and 5 surnames,
 * and that lexicon is DOCUMENT-DERIVED rather than general:
 *
 *   KNOWN_GIVEN_NAMES = adriana, andrew, christopher, diana, giancarlo,
 *     gustavo, jane, joan, john, julie, lopez, margaret, mary, nelly,
 *     osmara, parra, patrick, sarah, tamara, tanesha, taneshia, vince,
 *     vincent
 *   KNOWN_SURNAMES = goodloe, lopez, martinez-navarro, parra, reyes
 *
 * Those are the people in Andrew's own Cal State correspondence. Every
 * canonical collision he named -- Amy, Kyle, Rose, Will, May, Mark, Fox,
 * Collier -- is absent, so `hasKnownNameEvidence` is FALSE for all of them.
 * ========================================================================
 *
 * WHY THIS MATTERS MORE NOW THAN IT DID BEFORE. The gap is pre-existing and
 * was already documented: ui/recommendations.ts's `hasKnownNameEvidence`
 * carries a comment naming Amy and Kyle, explaining that "widening the
 * dictionaries makes the failure rarer without changing its shape", that the
 * evidence which would actually settle them is computed in the
 * entity-resolution layer and never reaches the predicate, and that a real
 * fix must route that signal in -- "Flagged for AG rather than changed
 * unilaterally."
 *
 * Until now the consequence was cosmetic: an unlisted name got a weaker
 * recommendation. The residual gate makes it CONSEQUENTIAL -- an unlisted
 * name that also appears in the expanded-common-language dictionary is
 * automatically resolved and leaves the reviewer's queue. `Agnes` is the
 * live instance: filterRules `["expanded_common_language_token"]`, no name
 * evidence, auto-resolved.
 *
 * ---------------------------------------------------------------------
 * WHAT THIS SUITE IS FOR
 * ---------------------------------------------------------------------
 *
 * It is a REPRODUCTION, written before any evidence rule is changed, per
 * Andrew's instruction. It documents the current behaviour precisely so
 * that:
 *
 *   - the defect is executable rather than argued;
 *   - a later fix has a target that fails today;
 *   - and, critically, the POSITIVE CONTROLS below pin the names that must
 *     keep working, so tightening person evidence cannot suppress real
 *     people as a side effect.
 *
 * The current-state assertions are written as `CURRENT` and describe what
 * the code does today, not what it should do. When the entity-resolution
 * signal is routed in, they are expected to flip, and each says so.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/name-evidence-coverage-verification.ts
 */

import { KNOWN_GIVEN_NAMES, KNOWN_SURNAMES } from "../src/engines/quality/quality-dictionaries.data.ts";
import { scoreCandidateQuality } from "../src/engines/quality/scoring.ts";
import { evaluateCandidate, buildGateFacts } from "../src/engines/review/residualReviewGate.ts";
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

function candidate(text: string): Candidate {
  return { id: `person:${text.toLowerCase()}`, displayValue: text, detectedType: "person", occurrenceIds: [] } as Candidate;
}

/** Quality categories exactly as the gate reads them (ui/app.ts's
 *  candidateCategories: filterRules if any, else reasons). */
function categoriesFor(text: string): string[] {
  const scored = scoreCandidateQuality(candidate(text), [], new Map());
  return (scored.filterRules.length ? scored.filterRules : scored.reasons).map((c) => c.replace(/_/g, "-"));
}

/** Runs the real gate over one word with no contextual evidence -- the
 *  worst case, and the one that produced `Agnes`. */
function gateOutcomeFor(text: string): "resolve" | "review" {
  const facts = buildGateFacts({
    candidates: [candidate(text)],
    assessmentByCandidate: {
      [`person:${text.toLowerCase()}`]: (() => {
        const s = scoreCandidateQuality(candidate(text), [], new Map());
        return { filterRules: s.filterRules, reasons: s.reasons };
      })(),
    },
    contextualByCandidate: {},
    decidedCandidateIds: new Set(),
    automaticallyResolvedIds: new Set(),
  });
  return evaluateCandidate(facts[0]!).kind;
}

console.log("=== Name-evidence coverage ===\n");

console.log("--- THE LEXICON: size and provenance ---");
{
  check(
    `KNOWN_GIVEN_NAMES holds ${KNOWN_GIVEN_NAMES.length} entries -- a document-derived seed, not a name lexicon`,
    KNOWN_GIVEN_NAMES.length < 50,
    String(KNOWN_GIVEN_NAMES.length)
  );
  check(`KNOWN_SURNAMES holds ${KNOWN_SURNAMES.length} entries`, KNOWN_SURNAMES.length < 20, String(KNOWN_SURNAMES.length));

  // The tell: the list is the cast of one document.
  const fromAndrewsDocument = ["andrew", "christopher", "diana", "giancarlo", "gustavo", "julie", "margaret", "nelly", "patrick", "sarah", "tamara", "tanesha", "vince"];
  const present = fromAndrewsDocument.filter((n) => KNOWN_GIVEN_NAMES.includes(n));
  check(
    "the entries are the people in the sample document it was derived from",
    present.length >= 12,
    `${present.length}/${fromAndrewsDocument.length}`
  );
}

console.log("\n--- THE GAP: every collision Andrew named is absent ---");
{
  const named = ["amy", "kyle", "rose", "will", "may", "mark", "fox", "collier", "agnes"];
  for (const n of named) {
    check(
      `CURRENT: "${n}" carries NO known-name evidence (absent from both lexicons)`,
      !KNOWN_GIVEN_NAMES.includes(n) && !KNOWN_SURNAMES.includes(n),
      "present -- the gap has been closed; this assertion should be inverted"
    );
  }
}

console.log("\n--- THE CONSEQUENCE: the live Agnes case, end to end ---");
{
  const cats = categoriesFor("Agnes");
  check(
    "Agnes has ordinary-language evidence (expanded-common-language-token)",
    cats.includes("expanded-common-language-token"),
    JSON.stringify(cats)
  );
  check("Agnes has no name category", !cats.some((c) => c.startsWith("known-")), JSON.stringify(cats));
  /*
   * 2026-08-09, SAME DAY: the fix landed (documentNameEvidence.ts). This
   * assertion is kept and RESTATED rather than deleted, because it is the
   * honest residual limit: with NO witness in the document -- which is the
   * case here, `gateOutcomeFor` scores one word in isolation -- Agnes still
   * auto-resolves. The fix is document-derived, so a document that never
   * spells the name out gives it nothing to work with.
   *
   * The disposition is Keep, so the failure mode is a missed review
   * opportunity, not an altered document. When a witness IS present the
   * outcome flips -- proven in verify/document-name-evidence-verification.ts.
   */
  check(
    "RESIDUAL LIMIT: with no full-name witness in the document, a bare name still auto-resolves",
    gateOutcomeFor("Agnes") === "resolve",
    "Agnes is now retained even in isolation -- a static-lexicon change landed; re-check this suite's premise"
  );
}

console.log("\n--- POSITIVE CONTROLS: names that must NEVER be auto-resolved ---");
{
  /*
   * These are the guard rails for whatever fix lands. A tightening of person
   * evidence that suppressed any of these would be a worse defect than the
   * one being fixed, so they are asserted independently of the mechanism.
   */
  const mustBeReviewed = ["Andrew", "Christopher", "Margaret", "Tamara", "Patrick", "Sarah", "Nelly"];
  for (const name of mustBeReviewed) {
    check(`"${name}" is retained for review`, gateOutcomeFor(name) === "review");
  }
}

console.log("\n--- NEGATIVE CONTROLS: material that SHOULD resolve, and must keep resolving ---");
{
  /*
   * The other half of the guard. A fix that retained everything would
   * satisfy the safety property and destroy the feature.
   */
  const shouldResolve = ["Because", "There", "However", "Unfortunately", "Appreciate"];
  for (const word of shouldResolve) {
    check(`"${word}" still resolves automatically`, gateOutcomeFor(word) === "resolve");
  }
}

console.log("\n--- THE SEMANTIC BREADTH QUESTION (Andrew's second ask) ---");
{
  /*
   * Are domain terms resolving for the SAME reason as lexical residue, or a
   * different one? Printed rather than asserted: this is a product judgement
   * about whether "ordinary language" is doing more than one job, and the
   * evidence is what he asked to see.
   */
  for (const word of ["Because", "There", "Have", "Canvas", "Records", "Security", "Spring", "Enrollment", "Morning"]) {
    console.log(`  ${word.padEnd(12)} ${JSON.stringify(categoriesFor(word))}`);
  }
  // The one structural claim worth pinning: domain terms reach the gate via
  // DIFFERENT categories than function words do, so a future rule could
  // separate them without touching the lexical case.
  const functionWord = categoriesFor("Because");
  const domainTerm = categoriesFor("Enrollment");
  check(
    "domain terms and function words qualify via DIFFERENT category sets",
    JSON.stringify(functionWord) !== JSON.stringify(domainTerm),
    `${JSON.stringify(functionWord)} vs ${JSON.stringify(domainTerm)}`
  );
  check(
    "domain terms carry institution/department evidence that function words do not",
    domainTerm.some((c) => c.includes("institution") || c.includes("department")),
    JSON.stringify(domainTerm)
  );
}

console.log(`\n=== ${passCount} passed, ${failCount} failed ===`);
if (failCount > 0) {
  for (const f of failed) console.log(`  - ${f}`);
  process.exitCode = 1;
}
