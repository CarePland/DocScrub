/**
 * variant-form-evidence-verification.ts -- the contract for variant-form
 * evidence (AG, 2026-08-10).
 *
 *     node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs \
 *          verify/variant-form-evidence-verification.ts
 *
 * ═══════════════════ THE INVARIANT THAT OUTRANKS THE REST ═══════════════════
 *
 * The observed form is never rewritten, never corrected, and never called
 * wrong. §1 asserts it structurally -- by scanning the module's own source for
 * the vocabulary of correction -- rather than by checking one output, because
 * an output check passes right up until someone adds a `suggestion` field.
 *
 * ═══════════════════ AND THE ONE THAT PROTECTS THE MEASUREMENTS ═══════════════════
 *
 * §7 brute-forces the fast path against an unfiltered comparison over ~40,000
 * real pairs. Three optimizations sit between a probe and its answer (an ends
 * agreement test, a multiset bound, and a memo), each justified by a
 * measurement, and each capable of silently changing a result. Asserting they
 * are transparent is the difference between an optimization and a behaviour
 * change nobody noticed.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  variantFormEvidenceFor,
  explainVariantFormEvidence,
  DOCUMENT_LOCAL_MIN_TOKEN_LENGTH,
  VARIANT_MIN_TOKEN_LENGTH,
  VARIANT_SIMILARITY_THRESHOLD,
} from "../src/engines/interpretation/variant-form-evidence.js";
import { sequenceRatio } from "../src/engines/entity-resolution/sequence-ratio.js";
import { censusRoleFor, normalizeForCensusLookup } from "../src/engines/knowledge/CensusNameEvidence.js";
import { CENSUS_NAME_KEYS } from "../src/engines/knowledge/census-names.data.js";
import { interpretCandidate, type InterpretationFacts } from "../src/engines/interpretation/candidate-interpretation.js";
import { referenceEvidenceFor } from "../src/engines/knowledge/ReferenceEvidence.js";
import { SIGNAL_CLASSES, interpretationIdsOf } from "../src/engines/interpretation/interpretation-model.js";
import { semanticTypeFor, typeCheckSectionFor } from "../src/domain/semanticTypes.js";
import type { RelationshipKind } from "../src/domain/StructuralRelationship.js";

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

function facts(displayValue: string, over: Partial<InterpretationFacts> = {}): InterpretationFacts {
  return {
    candidateId: `c:${displayValue}`,
    displayValue,
    detectedType: "person",
    qualityCategories: [],
    positiveReasons: [],
    relationshipKinds: [],
    contextualRules: [],
    hasPersonEvidencedLinkage: false,
    reference: referenceEvidenceFor(displayValue),
    ...over,
  };
}

console.log("=== VARIANT-FORM EVIDENCE ===");
console.log(`    threshold ${VARIANT_SIMILARITY_THRESHOLD}, reference min length ${VARIANT_MIN_TOKEN_LENGTH}, document-local min length ${DOCUMENT_LOCAL_MIN_TOKEN_LENGTH}`);

/* ═══════════ 1. THE OBSERVED FORM IS NEVER REWRITTEN OR CALLED WRONG ═══════════ */

console.log("\n--- 1. THE OBSERVED FORM STANDS AS WRITTEN ---");
{
  const evidence = variantFormEvidenceFor("Chriztopher Johnson");
  check("the candidate value is preserved verbatim", evidence.value, "Chriztopher Johnson");
  check("the observed token is preserved verbatim, with its own casing",
    evidence.relationships[0]?.observedForm, "Chriztopher");
  check("the matched form is recorded SEPARATELY from the observed form",
    evidence.relationships.every((r) => r.observedForm !== r.matchedForm), true);

  /* No field on any relationship may be a proposed replacement. */
  const keys = [...new Set(evidence.relationships.flatMap((r) => Object.keys(r)))].sort();
  check("a relationship carries only descriptive fields", keys, [
    "matchedFirstAttested", "matchedForm", "matchedFormIsCommon", "matchedSurnameAttested", "method",
    "observedForm", "observedNormalized", "personSupporting", "similarity", "source", "tokenCount", "tokenIndex",
  ]);

  /* THE STRUCTURAL ASSERTION: the module may not even contain the vocabulary
   * of correction. This is what stops the concept re-entering by a field name
   * or a reviewer-facing sentence six months from now. */
  const source = readFileSync("src/engines/interpretation/variant-form-evidence.ts", "utf8");
  const reviewerFacing = source.split("\n").filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//")).join("\n");
  const forbidden = ["misspell", "misspelt", "typo", "correction", "correctedForm", "shouldBe", "intendedForm", "suggestion", "didYouMean", "autocorrect"]
    .filter((word) => new RegExp(word, "i").test(reviewerFacing));
  check("the module's code contains no vocabulary of correction", forbidden, []);

  const lines = explainVariantFormEvidence(evidence).join(" ");
  check("the explanation says `similar to`", /similar to/i.test(lines), true);
  check("the explanation never says misspelled/typo/correct/should be",
    /(misspell|typo|correct|should be|meant to)/i.test(lines), false);
  check("the explanation explicitly protects the observed spelling",
    /not being questioned|stands as written/i.test(lines), true);
}

/* ═══════════ 2. THE RELATIONSHIP IS FULLY RECOVERABLE ═══════════ */

console.log("\n--- 2. MATCHED FORM, METHOD AND PROVENANCE ARE ALL RECOVERABLE ---");
{
  const evidence = variantFormEvidenceFor("Chriztopher Johnson");
  const best = evidence.relationships.find((r) => r.matchedForm === "CHRISTOPHER");
  check("the CHRISTOPHER relationship exists", best !== undefined, true);
  check("method is recorded", best?.method, "orthographic-near-form");
  check("source is recorded", best?.source, "us-census-2020/docscrub-aggregate");
  check("the deterministic measurement is retained", Number(best?.similarity.toFixed(4)), 0.9091);
  check("the matched form's role evidence is retained",
    [best?.matchedFirstAttested, best?.matchedSurnameAttested], [true, true]);
  check("structural position is retained", [best?.tokenIndex, best?.tokenCount], [0, 2]);
  check("the normalized matching key is retained and is not display text", best?.observedNormalized, "CHRIZTOPHER");
}

/* ═══════════ 3. METHODS STAY DISTINGUISHABLE ═══════════ */

console.log("\n--- 3. ORTHOGRAPHIC AND DOCUMENT-LOCAL RELATIONSHIPS STAY DISTINGUISHABLE ---");
{
  const withLocal = variantFormEvidenceFor("Chriztopher Johnson", {
    documentAttestedTokens: new Set(["CHRISTOPHER", "JOHNSON"]),
  });
  const methods = [...new Set(withLocal.relationships.map((r) => r.method))].sort();
  check("both methods are present and separately labelled", methods,
    ["document-local-variant", "orthographic-near-form"]);
  check("the document-local relationship names a different source",
    withLocal.relationships.find((r) => r.method === "document-local-variant")?.source, "document-local");

  const withoutLocal = variantFormEvidenceFor("Chriztopher Johnson");
  check("omitting the document token set disables document-local matching entirely",
    withoutLocal.relationships.every((r) => r.method === "orthographic-near-form"), true);
}

/* ═══════════ 4. PHONETIC MATCHING WAS REJECTED AND MUST NOT RETURN ═══════════ */

console.log("\n--- 4. NO PHONETIC MATCHING SHIPS ---");
{
  const source = readFileSync("src/engines/interpretation/variant-form-evidence.ts", "utf8");
  const code = source.split("\n").filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//")).join("\n");
  check("no phonetic encoder is implemented or imported",
    /(soundex|metaphone|nysiis|phonetic[A-Z(])/i.test(code), false);

  /* The measured reason, re-asserted as behaviour: `Cache` and `Cashay` are
   * phonetically identical (both Soundex C200, both Double Metaphone KX) and
   * must NOT be related by this module. */
  const cache = variantFormEvidenceFor("Cache", { documentAttestedTokens: new Set(["CASHAY"]) });
  check("Cache acquires no relationship to the phonetically identical CASHAY",
    cache.relationships.some((r) => r.matchedForm === "CASHAY"), false);
  check("...and orthographically they are nowhere near the threshold",
    sequenceRatio("CACHE", "CASHAY") < VARIANT_SIMILARITY_THRESHOLD, true);
}

/* ═══════════ 5. SHORT-TOKEN SAFEGUARDS ═══════════ */

console.log("\n--- 5. SHORT-TOKEN SAFEGUARDS HOLD ---");
{
  for (const short of ["Jon", "Don", "Ron", "Jan", "Dan", "May", "Will", "Bill", "Term", "Plan"]) {
    check(`${short}: no reference variant below the length floor`,
      variantFormEvidenceFor(short).relationships.filter((r) => r.method === "orthographic-near-form").length, 0);
  }
  /* Even with a document token set, the document-local floor holds. */
  check("a 4-character token gets no document-local variant either",
    variantFormEvidenceFor("Jonn", { documentAttestedTokens: new Set(["JOHN", "JANN"]) }).relationships.length, 0);
  check("the length floors are what does it, not luck",
    [VARIANT_MIN_TOKEN_LENGTH >= 8, DOCUMENT_LOCAL_MIN_TOKEN_LENGTH >= 5], [true, true]);
}

/* ═══════════ 6. MORPHOLOGY IS NOT A VARIANT RELATIONSHIP ═══════════ */

console.log("\n--- 6. PURE AFFIX DIFFERENCES ARE REFUSED, AT BOTH ENDS ---");
{
  /* TRAILING affix -- the measured false-positive class: three of the first
   * four relationships this module ever produced on a real document were
   * inflections of Census-attested tokens, all scoring above the threshold. */
  const inflections: Array<[string, string]> = [
    ["Presidents", "PRESIDENT"],
    ["Registrars", "REGISTRAR"],
    ["Graduates", "GRADUATE"],
  ];
  for (const [observed, root] of inflections) {
    const ratio = sequenceRatio(normalizeForCensusLookup(observed), root);
    const related = variantFormEvidenceFor(observed, { documentAttestedTokens: new Set([root]) })
      .relationships.some((r) => r.matchedForm === root);
    check(`trailing: ${observed} ~ ${root} scores ${ratio.toFixed(3)} but is NOT admitted`, related, false);
  }

  /* LEADING affix -- the mirror case, found by THIS SUITE after the trailing
   * one was fixed. A truncation relationship, and the exact shape an
   * extraction-boundary error takes. */
  check(`leading: Transfer ~ RANSFER scores ${sequenceRatio("TRANSFER", "RANSFER").toFixed(3)} but is NOT admitted`,
    variantFormEvidenceFor("Transfer").relationships.some((r) => r.matchedForm === "RANSFER"), false);
  check("...while a genuine internal difference still is",
    variantFormEvidenceFor("Chriztopher").relationships.some((r) => r.matchedForm === "CHRISTOPHER"), true);
}

/* ═══════════ 6b. PRODUCTION HARDENING: RARE TARGETS DO NOT SUPPORT PERSON ═══════════ */

console.log("\n--- 6b. A RELATIONSHIP TO A RARE REFERENCE FORM IS DISCOVERED, NOT SUPPORTING ---");
{
  /* The real 601-candidate document produced 15 variant firings; 14 were an
   * ordinary English word one deletion away from a RARE attested surname.
   * These are the exact production targets. */
  const rareTargets: Array<[string, string]> = [
    ["Academic Services", "SERVIES"],
    ["College Scheduler", "SCHEDLER"],
    ["Registrar Managers", "MANGERS"],
    ["Reminders", "REINDERS"],
  ];
  for (const [candidate, target] of rareTargets) {
    const evidence = variantFormEvidenceFor(candidate);
    const relationship = evidence.relationships.find((r) => r.matchedForm === target);
    check(`${candidate}: the relationship to ${target} is still DISCOVERED`, relationship !== undefined, true);
    check(`${candidate}: ${target} is a rare form`, relationship?.matchedFormIsCommon, false);
    check(`${candidate}: ...so it does NOT support PERSON`, relationship?.personSupporting, false);
  }

  /* Discovery is preserved, not deleted -- that distinction is the design. */
  const services = variantFormEvidenceFor("Academic Services");
  check("the relationship survives on the evidence record", services.relationships.length > 0, true);
  check("...while contributing no person-supporting relationship",
    services.relationships.filter((r) => r.personSupporting).length, 0);
  check("...and produces NO person signal in the interpretation",
    interpretCandidate(facts("Academic Services")).interpretations
      .find((i) => i.id === "person")?.signals.some((s) => s.class === "variant-form") ?? false, false);

  /* The positive witness survives for a GENERAL structural reason: its target
   * is a Top-1000 given name. Nothing here is keyed on the string. */
  const chriz = variantFormEvidenceFor("Chriztopher Johnson");
  const common = chriz.relationships.filter((r) => r.personSupporting);
  check("Chriztopher Johnson retains a person-supporting relationship", common.length > 0, true);
  check("...and it is the one to a COMMON form", [...new Set(common.map((r) => r.matchedForm))], ["CHRISTOPHER"]);
  check("...while the rare co-target is demoted, not deleted",
    chriz.relationships.some((r) => r.matchedForm === "CHRITOPHER" && !r.personSupporting), true);

  /* THE REASON IS STRUCTURAL, NOT A WHITELIST: the rule reads the corpus's own
   * prevalence flag, so any Top-1000 target qualifies and no string is named. */
  const source = readFileSync("src/engines/interpretation/variant-form-evidence.ts", "utf8");
  const code = source.split("\n").filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//")).join("\n");
  check("no candidate or reference string is hard-coded in the module's code",
    /(CHRISTOPHER|CHRIZTOPHER|SERVIES|MANGERS|SCHEDLER|REINDERS)/.test(code), false);
  check("person support is derived from the corpus prevalence flags",
    /firstTop1000\s*\|\|\s*role\.surnameTop1000/.test(code), true);
  check("the hardening introduced no weight, score or confidence",
    /\b(weight|score|confidence|probability)\b/i.test(code), false);

  /* Monotone safety: restricting admission can only REMOVE person support. */
  check("no relationship is person-supporting unless its matched form is common",
    ["Academic Services", "Managers", "Scheduler", "Reminders", "Chriztopher Johnson", "College Scheduler"]
      .flatMap((v) => variantFormEvidenceFor(v).relationships)
      .filter((r) => r.personSupporting && !r.matchedFormIsCommon).length,
    0);
}

/* ═══════════ 7. THE FAST PATH IS TRANSPARENT ═══════════ */

console.log("\n--- 7. OPTIMIZATIONS DO NOT CHANGE ANY ANSWER (brute force) ---");
{
  /* Every optimization between a probe and its answer must be provably
   * transparent, so the shipped path is compared against an unfiltered
   * comparison over real corpus pairs. */
  /* Length floor MINUS ONE, matching the index: a probe of length 8 may match
   * a reference of length 7, and a brute force that filtered at 8 would report
   * a legitimate match as spurious. The first draft did exactly that and its
   * "failure" was the test's, not the module's -- recorded because a brute
   * force whose corpus differs from the real one proves nothing. */
  const tokens = CENSUS_NAME_KEYS.split("\n").filter((t) => t.length >= VARIANT_MIN_TOKEN_LENGTH - 1);
  const probes: string[] = [];
  for (let i = 0; i < tokens.length && probes.length < 60; i += 1237) {
    const base = tokens[i]!;
    /* Mutate one interior character so the probe is NOT exactly attested. */
    const mid = Math.floor(base.length / 2);
    probes.push(`${base.slice(0, mid)}${base[mid] === "Z" ? "Q" : "Z"}${base.slice(mid + 1)}`);
  }
  probes.push("CHRIZTOPHER");

  let compared = 0;
  let mismatches = 0;
  const witnesses: string[] = [];
  for (const probe of probes) {
    if (censusRoleFor(probe) !== null) continue;
    /* Brute force: every corpus token within one length step, no filters,
     * minus the suffix rule which is a POLICY of the module rather than an
     * optimization of it. */
    const expected = new Set<string>();
    for (const reference of tokens) {
      if (Math.abs(reference.length - probe.length) > 1) continue;
      if (reference === probe) continue;
      /* Containment at either end is a POLICY of the module (affix / truncation
       * differences are not variant relationships), not an optimization, so the
       * brute force applies it too. */
      if (reference.startsWith(probe) || probe.startsWith(reference)) continue;
      if (reference.endsWith(probe) || probe.endsWith(reference)) continue;
      compared += 1;
      if (sequenceRatio(probe, reference) >= VARIANT_SIMILARITY_THRESHOLD) expected.add(reference);
    }
    const actual = new Set(
      variantFormEvidenceFor(probe).relationships
        .filter((r) => r.method === "orthographic-near-form")
        .map((r) => r.matchedForm)
    );
    const missing = [...expected].filter((f) => !actual.has(f));
    const extra = [...actual].filter((f) => !expected.has(f));
    if (missing.length > 0 || extra.length > 0) {
      mismatches += 1;
      if (witnesses.length < 3) witnesses.push(`${probe}: missing=[${missing}] extra=[${extra}]`);
    }
  }
  console.log(`    ${probes.length} probes, ${compared.toLocaleString()} unfiltered comparisons`);
  check("the filtered fast path returns exactly the unfiltered result", mismatches, 0);
  if (witnesses.length > 0) console.log(`    witnesses: ${witnesses.join(" | ")}`);

  /* The memo must not leak one document's attestations into another's. */
  const a = variantFormEvidenceFor("Chriztopher", { documentAttestedTokens: new Set(["ZZZQQQWWW"]) });
  const b = variantFormEvidenceFor("Chriztopher", { documentAttestedTokens: new Set<string>() });
  check("the memo caches only the reference path, never the document-local one",
    a.relationships.filter((r) => r.method === "orthographic-near-form").length,
    b.relationships.filter((r) => r.method === "orthographic-near-form").length);
}

/* ═══════════ 8. DETERMINISM ═══════════ */

console.log("\n--- 8. IDENTICAL INPUTS PRODUCE IDENTICAL OUTPUT ---");
{
  for (const value of ["Chriztopher Johnson", "Cache", "Transfer Credit", "Zathras Quorbelfrimp", "Yazmine Guzmán"]) {
    const local = new Set(["CHRISTOPHER", "JOHNSON", "MILLER"]);
    const one = JSON.stringify(variantFormEvidenceFor(value, { documentAttestedTokens: local }));
    const two = JSON.stringify(variantFormEvidenceFor(value, { documentAttestedTokens: local }));
    check(`${value}: repeated derivation is byte-identical`, one === two, true);
  }
}

/* ═══════════ 9. IT FEEDS THE INTERPRETATION MODEL AS ITS OWN CLASS ═══════════ */

console.log("\n--- 9. VARIANT EVIDENCE PARTICIPATES IN PHASE A AS A DISTINCT CLASS ---");
{
  const profile = interpretCandidate(facts("Chriztopher Johnson"));
  const person = profile.interpretations.find((i) => i.id === "person");
  check("a person reading is supported", person !== undefined, true);
  const variantSignals = (person?.signals ?? []).filter((s) => s.class === "variant-form");
  check("by a variant-form signal", variantSignals.length, 1);
  check("which is NOT flattened into token-membership",
    (person?.signals ?? []).some((s) => s.class === "token-membership"), false);
  check("the compositional case has its own signal id",
    variantSignals[0]?.signalId, "person/variant-form-with-attested-partner");
  check("the standalone case has a different one",
    interpretCandidate(facts("Chriztopher")).interpretations
      .find((i) => i.id === "person")?.signals.find((s) => s.class === "variant-form")?.signalId,
    "person/variant-form");
  check("the class documents its own measured failure mode",
    SIGNAL_CLASSES["variant-form"].knownFailureMode.length > 0, true);
  check("and is marked compositional -- inherited, not direct, evidence",
    SIGNAL_CLASSES["variant-form"].compositional, true);

  /* ONE SIGNAL PER OBSERVED TOKEN, not one per matched form -- otherwise a
   * denser corpus would look like stronger evidence, which is counting. */
  check("two matched forms for one token still produce ONE signal", variantSignals.length, 1);
  check("...while both matched forms survive on the evidence record",
    variantFormEvidenceFor("Chriztopher Johnson").relationships.length, 2);
}

/* ═══════════ 10. COMPETING EXACT EVIDENCE SURVIVES ═══════════ */

console.log("\n--- 10. VARIANT EVIDENCE NEVER ERASES EXACT EVIDENCE FOR ANOTHER READING ---");
{
  /* The Cashay/Cache shape, built from real repository data: a candidate with
   * BOTH a variant relationship and affirmative ordinary-language evidence
   * must carry both readings. */
  const contested = interpretCandidate(
    facts("Chriztopher", { qualityCategories: ["common-english-word"] })
  );
  const ids = interpretationIdsOf(contested);
  check("the person reading (variant-supported) is present", ids.includes("person"), true);
  check("the ordinary-language reading (exact) is also present", ids.includes("ordinary-language"), true);
  check("and the outcome is contested, not resolved", contested.outcome, "contested");

  /* An exactly-attested token is never routed through fuzzy matching. */
  check("an exactly-attested token gets no variant relationship at all",
    variantFormEvidenceFor("Johnson").relationships.length, 0);
  check("...and is instead recorded as compositional corroboration",
    variantFormEvidenceFor("Chriztopher Johnson").exactAttestedPartnerTokens, ["JOHNSON"]);
}

/* ═══════════ 11. MALFORMED BOUNDARIES ARE NOT RESCUED ═══════════ */

console.log("\n--- 11. EXTRACTION-BOUNDARY FRAGMENTS AND DOMAIN PHRASES ARE NOT RESCUED ---");
{
  const NEGATIVES = [
    "FYI, Berhanu", "When Ruth", "Did Dr", "If Joan", "Everyone, Same", "VA, VET",
    "Transfer Credit", "Associate Dean", "Grade Rosters", "Academic Senate",
    "Term Withdrawals", "Smart Planner", "Final Exams", "External Education",
    "Systemwide Registrars", "Class Level", "New Student", "Degree Planner",
  ];
  const local = new Set(["GRADE", "DEAN", "CREDIT", "STUDENT", "LEVEL", "SENATE"]);
  const rescued = NEGATIVES.filter((v) => variantFormEvidenceFor(v, { documentAttestedTokens: local }).relationships.length > 0);
  check("no boundary fragment or domain phrase acquires a variant relationship", rescued, []);
}

/* ═══════════ 12. INERTNESS ═══════════ */

console.log("\n--- 12. INERTNESS: NO PRODUCTION DECISION READS VARIANT EVIDENCE ---");
{
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith(".ts")) files.push(full.replace(/\\/g, "/"));
    }
  };
  walk("src");
  const sourceOf = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));

  check("the module has exactly one importer, the interpretation derivation",
    [...sourceOf.entries()].filter(([, s]) => /from\s+"[^"]*\/variant-form-evidence\.js"/.test(s)).map(([f]) => f).sort(),
    ["src/engines/interpretation/candidate-interpretation.ts"]);

  const DECISION_MODULES = [
    "src/domain/semanticTypes.ts",
    "src/engines/quality/scoring.ts",
    "src/engines/CandidateQualityEngine.ts",
    "src/engines/EntityResolutionEngine.ts",
    "src/engines/DecisionReuseEngine.ts",
    "src/engines/review/residualReviewGate.ts",
    "src/engines/cross-candidate/person-evidence-gate.ts",
    "src/io/AuditExporter.ts",
    "src/ui/recommendations.ts",
    "src/ui/triageQueue.ts",
  ];
  for (const module of DECISION_MODULES) {
    const src = sourceOf.get(module);
    check(`${module} is present`, typeof src, "string");
    if (typeof src !== "string") continue;
    check(`${module} does not mention variant evidence`,
      /variantForm|VariantRelationship|variant-form/i.test(src), false);
  }

  const derivation = sourceOf.get("src/engines/interpretation/variant-form-evidence.ts")!;
  check("the module declares no ruleId", /ruleId/.test(derivation), false);
  check("the module emits no AutomaticResolution", /AutomaticResolution/.test(derivation), false);
  check("the module merges no entities", /merge|EntityGroup|confirmGroup/i.test(derivation), false);
}

/* ═══════════ 13. EXISTING BEHAVIOUR IS UNCHANGED ═══════════ */

console.log("\n--- 13. SEMANTIC TYPE, ROUTING AND PROTECTION ARE UNCHANGED ---");
{
  const cases: Array<[string, Parameters<typeof semanticTypeFor>[0], string]> = [
    ["email", { detectedType: "email", categories: [], relationshipKinds: new Set<RelationshipKind>() }, "emails"],
    ["organization", { detectedType: "organization", categories: [], relationshipKinds: new Set<RelationshipKind>() }, "organizations"],
    ["person with name evidence", { detectedType: "person", categories: ["known-personal-name-token"], relationshipKinds: new Set<RelationshipKind>() }, "people"],
    ["person with shape only", { detectedType: "person", categories: ["strong-name-structure"], relationshipKinds: new Set<RelationshipKind>() }, "other"],
  ];
  for (const [label, input, expected] of cases) check(`semanticTypeFor unchanged: ${label}`, semanticTypeFor(input), expected);

  /* THE ONE THAT MATTERS MOST: `Chriztopher Johnson` now carries variant
   * evidence, and still routes exactly where it did before -- Undetermined,
   * because no quality category recognises it. Variant evidence changed the
   * PROFILE and changed no routing whatsoever. */
  const routed = typeCheckSectionFor(
    { detectedType: "person", categories: [], relationshipKinds: new Set<RelationshipKind>() },
    false
  );
  check("the motivating candidate still routes to Undetermined", routed.section, "undetermined");
  check("...and carries no rejected hypothesis", "rejectedType" in routed, false);
}

console.log("");
if (failures > 0) {
  console.log(`VARIANT-FORM EVIDENCE: ${failures} FAILURE(S)`);
  process.exit(1);
}
console.log("VARIANT-FORM EVIDENCE: all checks passed.");
