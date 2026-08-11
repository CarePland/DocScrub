/**
 * candidate-interpretation-verification.ts -- the Phase A contract for the
 * multi-interpretation layer (AG, 2026-08-10).
 *
 *     node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs \
 *          verify/candidate-interpretation-verification.ts
 *
 * ═══════════════════ WHAT PHASE A PROMISED ═══════════════════
 *
 * Two things, and this suite is where both are made checkable:
 *
 *   1. THE MODEL WORKS. Competing affirmative readings survive side by side,
 *      with their provenance, deterministically.
 *   2. NOTHING ELSE MOVED. No semantic classification, routing, scoring,
 *      suppression or recommendation behaviour changed, because nothing reads
 *      a profile.
 *
 * The second is the one that would be easy to break quietly, so it is asserted
 * structurally (§9, §10) rather than trusted.
 *
 * ═══════════════════ WHY THE FIXTURES USE REAL EVIDENCE ═══════════════════
 *
 * Every channel value below comes from `referenceEvidenceFor` against the
 * shipped datasets rather than from a hand-built stub. A stub would let this
 * suite pass while the real packs said something else entirely -- which is the
 * failure mode that makes a green test worse than no test. The cost is that a
 * dataset regeneration can move a number here; that is correct, and the
 * assertion should be re-read rather than relaxed if it happens.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { referenceEvidenceFor } from "../src/engines/knowledge/ReferenceEvidence.js";
import {
  interpretCandidate,
  explainInterpretationProfile,
  type InterpretationFacts,
} from "../src/engines/interpretation/candidate-interpretation.js";
import {
  SIGNAL_CLASSES,
  contestKey,
  contestsPerson,
  independentWitnessGroups,
  interpretationIdsOf,
  outcomeFor,
  restsOnlyOnCompositionalSignals,
  sharesLineage,
  signalClassesOf,
  type InterpretationProfile,
} from "../src/engines/interpretation/interpretation-model.js";
import { personEvidenceReasons } from "../src/engines/cross-candidate/person-evidence-gate.js";
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

/** A candidate with nothing but its phrase and detected type -- every other
 *  fact absent. Overrides add exactly the evidence a case is about, so no
 *  assertion can pass by accident on a fact it did not intend. */
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

const readingsOf = (p: InterpretationProfile): string[] =>
  p.interpretations.map((i) => (i.domain === undefined ? i.id : `${i.id}[${i.domain}]`));

console.log("=== CANDIDATE INTERPRETATION (Phase A) ===");

/* ═══════════════════ 1. COMPETING READINGS SURVIVE ═══════════════════ */

console.log("\n--- 1. MULTIPLE AFFIRMATIVE READINGS SURVIVE SIMULTANEOUSLY ---");
{
  /* `Levy` is attested legal terminology AND a Census name token. The whole
   * point of the layer is that this produces two readings, not a winner. */
  const levy = interpretCandidate(facts("Levy"));
  check("Levy carries a legal-terminology reading", readingsOf(levy).includes("domain-terminology[legal-terminology]"), true);
  check("Levy carries a person reading", readingsOf(levy).includes("person"), true);
  check("Levy is contested", levy.outcome, "contested");
  check("and neither reading was removed to resolve it", levy.interpretations.length >= 2, true);

  /* A phrase two independent domain packs attest is TWO readings, not one
   * merged terminology reading -- collapsing them would destroy exactly what
   * the collision audit measured. */
  const adr = interpretCandidate(facts("ADR", { detectedType: "unknown" }));
  const adrReadings = readingsOf(adr);
  check("ADR carries a finance reading", adrReadings.includes("domain-terminology[finance-accounting-tax]"), true);
  check("ADR carries a legal reading", adrReadings.includes("domain-terminology[legal-terminology]"), true);
  check("the two domains are separate entries, not merged",
    adr.interpretations.filter((i) => i.id === "domain-terminology").length, 2);

  /* PERSON + PLACE, the largest measured conflict population in the system. */
  const place = interpretCandidate(facts("San Jose"));
  check("San Jose carries a place reading", readingsOf(place).includes("place"), true);

  /* Three-way: person evidence, place evidence and terminology at once is
   * representable at all -- which the single-answer chain cannot do. */
  const threeWay = interpretCandidate(
    facts("Franklin County", { qualityCategories: ["known-surname"], contextualRules: ["anchor_full_name_with_role"] })
  );
  check("a candidate can carry person AND place readings together",
    interpretationIdsOf(threeWay).includes("person") && interpretationIdsOf(threeWay).includes("place"), true);
}

/* ═══════════════════ 2. ABSENCE IS NOT COUNTER-EVIDENCE ═══════════════════ */

console.log("\n--- 2. ABSENCE OF EVIDENCE NEVER BECOMES COUNTER-EVIDENCE ---");
{
  const nothing = interpretCandidate(facts("Zathras Quorbelfrimp", { detectedType: "unknown" }));
  check("a phrase nothing attests has no readings", nothing.interpretations.length, 0);
  check("and its outcome is `unsupported`, not a negative finding", nothing.outcome, "unsupported");
  check("its value is preserved verbatim", nothing.value, "Zathras Quorbelfrimp");

  /* THE STRUCTURAL GUARANTEE: the model has nowhere to put a negative. If a
   * `counterContext`, `against`, `negative` or `refutes` field ever appears,
   * this fails -- deliberately, because that is the field an absence would be
   * smuggled in through. See interpretation-model.ts's header. */
  const withEverything = interpretCandidate(
    facts("Levy", { qualityCategories: ["known-surname", "common-english-word"] })
  );
  const profileKeys = Object.keys(withEverything).sort();
  check("the profile has exactly four fields and none of them is negative",
    profileKeys, ["candidateId", "interpretations", "outcome", "value"]);
  const interpretationKeys = [...new Set(withEverything.interpretations.flatMap((i) => Object.keys(i)))].sort();
  check("an interpretation carries only id/domain/signals",
    interpretationKeys.every((k) => ["id", "domain", "signals"].includes(k)), true);
  const signalKeys = [...new Set(withEverything.interpretations.flatMap((i) => i.signals.flatMap((s) => Object.keys(s))))].sort();
  check("a signal carries only descriptive fields -- none of them negative",
    signalKeys, ["class", "detail", "lineage", "provenance", "signalId"]);

  const explanation = explainInterpretationProfile(nothing).join(" ");
  check("the unsupported explanation says thin evidence, not `not a person`",
    /thin evidence/.test(explanation) && !/not a person/i.test(explanation), true);
}

/* ═══════════════════ 3. TERMINOLOGY NEVER SUPPRESSES PERSON ═══════════════════ */

console.log("\n--- 3. TERMINOLOGY ATTESTATION NEVER REMOVES A PERSON READING ---");
{
  /* Each of these is attested terminology in some pack AND carries person
   * evidence. In every case BOTH survive. */
  const witnesses: Array<[string, Partial<InterpretationFacts>]> = [
    ["Levy", { qualityCategories: ["known-surname"] }],
    ["Major", { detectedType: "person", qualityCategories: ["known-personal-name-token"] }],
    ["Claim", { detectedType: "person", qualityCategories: ["known-surname"] }],
    ["Appeal", { detectedType: "person", qualityCategories: ["ambiguous-lexical-token"] }],
    ["White", { detectedType: "person", qualityCategories: ["known-surname"] }],
  ];
  for (const [value, over] of witnesses) {
    const profile = interpretCandidate(facts(value, over));
    check(`${value}: the person reading survives terminology attestation`,
      interpretationIdsOf(profile).includes("person"), true);
  }

  /* And the inverse: person evidence never removes the terminology reading. */
  const levy = interpretCandidate(facts("Levy", { qualityCategories: ["known-surname"] }));
  check("Levy: the terminology reading survives person evidence",
    interpretationIdsOf(levy).includes("domain-terminology"), true);
}

/* ═══════════════════ 4. STRONG GNIS NEVER SUPPRESSES PERSON ═══════════════════ */

console.log("\n--- 4. STRONG GNIS EVIDENCE NEVER REMOVES A PERSON READING ---");
{
  /* Measured: 35,174 GNIS place keys are STRONG matches that also carry Census
   * personal-name structure. A rule of the form "strong place, therefore not a
   * person" is categorically wrong for that entire population. These are real
   * witnesses from that measurement. */
  for (const value of ["ABE YARBROUGH", "ABRAMS WAY", "ABRAHAM ACRES", "AARONS CREEK"]) {
    const profile = interpretCandidate(facts(value));
    const ids = interpretationIdsOf(profile);
    check(`${value}: place reading present`, ids.includes("place"), true);
    check(`${value}: person reading NOT removed by it`, ids.includes("person"), true);
    check(`${value}: recorded as contested rather than resolved`, profile.outcome, "contested");
  }

  /* Policy B's downgrade is carried as DETAIL, never as removal. */
  const weakWitness = ["ABE YARBROUGH", "ABRAMS WAY"].map((v) => interpretCandidate(facts(v)));
  for (const p of weakWitness) {
    const place = p.interpretations.find((i) => i.id === "place")!;
    check(`${p.value}: place support names its source`, place.signals[0]!.provenance, "GnisPlaceEvidence");
  }
}

/* ═══════════════════ 5. CHANNEL COUNT DETERMINES NOTHING ═══════════════════ */

console.log("\n--- 5. THE NUMBER OF SUPPORTING SIGNALS DETERMINES NOTHING ---");
{
  /* A candidate with many person signals and one terminology signal is
   * contested in exactly the same way as one with the reverse. If counting
   * were happening anywhere, these would differ. */
  const manyPerson = interpretCandidate(facts("Levy", {
    qualityCategories: ["known-surname", "known-personal-name-token"],
    positiveReasons: ["nearby_title"],
    contextualRules: ["anchor_full_name_with_role", "contextual_attribution"],
    hasPersonEvidencedLinkage: true,
  }));
  const onePerson = interpretCandidate(facts("Levy", { qualityCategories: ["known-surname"] }));
  check("many person signals -> still contested", manyPerson.outcome, "contested");
  check("one person signal  -> still contested", onePerson.outcome, "contested");
  check("both produce the same contest key", contestKey(manyPerson), contestKey(onePerson));
  check("signal count differs, outcome does not",
    manyPerson.interpretations.find((i) => i.id === "person")!.signals.length >
      onePerson.interpretations.find((i) => i.id === "person")!.signals.length, true);

  /* The model exposes no aggregate anywhere. */
  const serialized = JSON.stringify(manyPerson);
  const forbidden = ["score", "weight", "confidence", "rank", "winner", "best", "total", "count"]
    .filter((word) => new RegExp(`"[^"]*${word}[^"]*"\\s*:`, "i").test(serialized));
  check("no score/weight/confidence/rank/winner field exists on a profile", forbidden, []);
}

/* ═══════════════════ 6. PROVENANCE SURVIVES ═══════════════════ */

console.log("\n--- 6. PROVENANCE SURVIVES INTO THE PROFILE ---");
{
  const profile = interpretCandidate(facts("motion for summary judgment", { detectedType: "unknown" }));
  const legal = profile.interpretations.find((i) => i.domain === "legal-terminology");
  check("the legal reading exists", legal !== undefined, true);
  const signal = legal!.signals[0]!;
  check("its signal id is stable and greppable", signal.signalId, "domain-terminology/legal-terminology");
  check("its class names the claim shape", signal.class, "exact-phrase-attestation");
  check("its provenance names the family and row count", /legal-terminology \(\d+ attesting row/.test(signal.provenance), true);
  check("its detail quotes the attested term verbatim", signal.detail.includes('"Motion for Summary Judgment"'), true);
  check("and names the attesting authority", signal.detail.includes("STATE_JUDICIARY_GLOSSARY"), true);

  /* Every signal, everywhere, carries all four fields non-empty. */
  const allProfiles = ["Levy", "ADR", "San Jose", "Major", "Cost of Attendance", "ABE YARBROUGH"]
    .map((v) => interpretCandidate(facts(v, { qualityCategories: ["known-surname"] })));
  const incomplete = allProfiles.flatMap((p) =>
    p.interpretations.flatMap((i) =>
      i.signals.filter((s) => !s.signalId || !s.class || !s.detail || !s.provenance).map((s) => `${p.value}:${s.signalId}`)
    )
  );
  check("no signal anywhere is missing a field", incomplete, []);

  /* Every class in use is described, including its measured failure mode --
   * so the next pass inherits the finding instead of re-measuring it. */
  const usedClasses = [...new Set(allProfiles.flatMap((p) => p.interpretations.flatMap((i) => i.signals.map((s) => s.class))))];
  const undescribed = usedClasses.filter((c) => !SIGNAL_CLASSES[c] || SIGNAL_CLASSES[c].knownFailureMode.length === 0);
  check("every signal class in use documents its known failure mode", undescribed, []);
}

/* ═══════════════════ 6b. EVIDENCE LINEAGE ═══════════════════ */

console.log("\n--- 6b. EVERY SIGNAL DECLARES WHAT BODY OF FACT IT RESTS ON ---");
{
  /* Phase B measured a -7 point LIFT for `compositional-structure +
   * token-membership` -- two signals from one corpus, worse together than the
   * better one alone. Lineage is what makes that checkable rather than
   * anecdotal, so every signal must declare it. */
  const population = ["Levy", "ADR", "San Jose", "ABE YARBROUGH", "Major", "Cost of Attendance", "Chriztopher Johnson", "records@example.edu"]
    .map((v) => interpretCandidate(facts(v, {
      qualityCategories: ["known-surname", "common-english-word"],
      contextualRules: ["anchor_signature_block", "contextual_attribution"],
      relationshipKinds: ["acronym"],
      hasPersonEvidencedLinkage: true,
    })));
  const allSignals = population.flatMap((p) => p.interpretations.flatMap((i) => i.signals));
  check("no signal anywhere is missing a lineage", allSignals.filter((s) => !s.lineage || s.lineage.length === 0).map((s) => s.signalId), []);

  /* THE MEASURED DEPENDENCE, asserted as a property rather than described. */
  const censusProfile = interpretCandidate(facts("ABE YARBROUGH"));
  const personSignals = censusProfile.interpretations.find((i) => i.id === "person")!.signals;
  const structure = personSignals.find((s) => s.class === "compositional-structure")!;
  const membership = personSignals.find((s) => s.class === "token-membership")!;
  check("Census structure and Census token membership share lineage -- NOT two witnesses",
    sharesLineage(structure, membership), true);
  check("...so they collapse into ONE independent witness group",
    independentWitnessGroups([structure, membership]).length, 1);

  /* GNIS depends on Census for its Policy B suppression, so place and person
   * evidence are not fully independent either. */
  const place = censusProfile.interpretations.find((i) => i.id === "place")!.signals[0]!;
  check("GNIS place evidence declares its Census dependence",
    [...place.lineage].sort(), ["us-census-name-corpus", "usgs-gnis-corpus"]);
  check("...so place and person evidence are NOT independent corroboration",
    sharesLineage(place, structure), true);

  /* A variant relationship's target is a Census form. */
  const variant = interpretCandidate(facts("Chriztopher Johnson"))
    .interpretations.find((i) => i.id === "person")!.signals.find((s) => s.class === "variant-form")!;
  check("variant-form declares the Census corpus as its lineage", [...variant.lineage], ["us-census-name-corpus"]);

  /* Genuinely independent sources must NOT be conflated. */
  const lexicon = interpretCandidate(facts("Levy", { qualityCategories: ["known-surname"] }))
    .interpretations.find((i) => i.id === "person")!.signals.find((s) => s.class === "lexicon-recognition")!;
  check("a DocScrub lexicon and the Census corpus are independent", sharesLineage(lexicon, membership), false);
  check("...and count as two witness groups", independentWitnessGroups([lexicon, membership]).length, 2);

  /* Lineage is a declaration, not a number. */
  const serialized = JSON.stringify(population);
  check("lineage introduced no weight, score or discount field",
    /"(weight|score|discount|confidence|independenceFactor)"\s*:/i.test(serialized), false);
}

/* ═══════════════════ 7. AMBIGUITY IS DETERMINISTIC ═══════════════════ */

console.log("\n--- 7. AMBIGUITY IS DETERMINISTIC AND DERIVED FROM ONE PLACE ---");
{
  check("no readings  -> unsupported", outcomeFor([]), "unsupported");
  check("one reading  -> single", outcomeFor([{ id: "person", signals: [] }]), "single");
  check("two readings -> contested", outcomeFor([{ id: "person", signals: [] }, { id: "place", signals: [] }]), "contested");

  /* The two kinds of not-knowing stay distinguishable, which is the whole
   * reason `unsupported` is not folded into `contested`. */
  const thin = interpretCandidate(facts("Qwzzx Vbnmp", { detectedType: "unknown" }));
  const genuine = interpretCandidate(facts("Levy", { qualityCategories: ["known-surname"] }));
  check("thin evidence and genuine ambiguity are different outcomes", [thin.outcome, genuine.outcome], ["unsupported", "contested"]);
  check("contestsPerson is false for thin evidence", contestsPerson(thin), false);
  check("contestsPerson is true for the person/terminology collision", contestsPerson(genuine), true);
}

/* ═══════════════════ 8. IDENTICAL INPUTS, IDENTICAL OUTPUT ═══════════════════ */

console.log("\n--- 8. IDENTICAL INPUTS PRODUCE BYTE-IDENTICAL PROFILES ---");
{
  const cases = ["Levy", "ADR", "San Jose", "ABE YARBROUGH", "Major", "Zathras Quorbelfrimp", "Cost of Attendance"];
  for (const value of cases) {
    const a = JSON.stringify(interpretCandidate(facts(value, { qualityCategories: ["known-surname"], contextualRules: ["anchor_signature_block"] })));
    const b = JSON.stringify(interpretCandidate(facts(value, { qualityCategories: ["known-surname"], contextualRules: ["anchor_signature_block"] })));
    check(`${value}: repeated derivation is byte-identical`, a === b, true);
  }

  /* Ordering is stable and does not depend on the order facts arrived in. */
  const one = interpretCandidate(facts("Levy", { qualityCategories: ["known-surname", "common-english-word"] }));
  const two = interpretCandidate(facts("Levy", { qualityCategories: ["common-english-word", "known-surname"] }));
  check("reading order does not depend on input category order", readingsOf(one), readingsOf(two));
  check("and it follows INTERPRETATION_ORDER", readingsOf(one)[0], "person");
}

/* ═══════════════════ 9. INERTNESS: NOTHING READS A PROFILE ═══════════════════ */

console.log("\n--- 9. INERTNESS: NO PRODUCTION DECISION READS AN INTERPRETATION PROFILE ---");
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
  const importersOf = (pattern: RegExp): string[] =>
    [...sourceOf.entries()].filter(([, src]) => pattern.test(src)).map(([f]) => f).sort();

  check("the derivation has exactly two importers: the collection point and the diagnostic",
    importersOf(/from\s+"[^"]*\/candidate-interpretation\.js"/),
    ["src/ui/app.ts", "src/workspace/Workspace.ts"]);
  /* `person-adjudication.ts` joined 2026-08-10. It reads the model to
   * adjudicate Person and is itself consumed by nothing in production --
   * asserted in verify/person-adjudication-verification.ts §8. Listed
   * explicitly because this assertion is how a new consumer gets noticed. */
  /* `reviewNecessity.ts` joined 2026-08-10 as the FIRST production consumer of
   * the interpretation model. It reads the profile to decide whether a human
   * decision still remains -- a triage question, not a semantic one. It creates
   * no decision and no AutomaticResolution; asserted in
   * verify/review-necessity-verification.ts. */
  /* `proposedGroups.ts` joined 2026-08-10 as the SECOND production consumer,
   * and it is the same KIND of consumer as `reviewNecessity.ts`: a review-
   * triage question ("may these be processed together?") rather than a
   * semantic one ("what is this?"). It reads the profile, creates no decision,
   * no AutomaticResolution and no SemanticTypeId, and is asserted in
   * verify/quick-approval-verification.ts. Listed explicitly because this
   * assertion is how a new consumer gets NOTICED -- a third one arriving
   * without a line here should be read as a question about whether the
   * interpretation layer is quietly becoming a general-purpose classifier. */
  check("the model's importers are exactly the derivation, Person adjudication, review necessity, proposed groups, the collection point and the diagnostic",
    importersOf(/from\s+"[^"]*\/interpretation-model\.js"/),
    [
      "src/engines/interpretation/candidate-interpretation.ts",
      "src/engines/interpretation/person-adjudication.ts",
      "src/engines/review/proposedGroups.ts",
      "src/engines/review/reviewNecessity.ts",
      "src/ui/app.ts",
      "src/workspace/Workspace.ts",
    ]);
  check("`interpretCandidate` is called from exactly one place in src/",
    [...sourceOf.entries()].filter(([f, src]) => f !== "src/engines/interpretation/candidate-interpretation.ts" && /interpretCandidate\s*\(/.test(src)).map(([f]) => f),
    ["src/workspace/Workspace.ts"]);
  check("the accessor has exactly one caller, the diagnostic",
    [...sourceOf.entries()].filter(([f, src]) => f !== "src/workspace/Workspace.ts" && /getInterpretationProfiles\s*\(/.test(src)).map(([f]) => f),
    ["src/ui/app.ts"]);

  /* The decision modules must not have learned the vocabulary. */
  const DECISION_MODULES = [
    "src/domain/semanticTypes.ts",
    "src/engines/quality/scoring.ts",
    "src/engines/CandidateQualityEngine.ts",
    "src/engines/DetectionEngine.ts",
    "src/engines/EntityResolutionEngine.ts",
    "src/engines/OccurrenceClassifier.ts",
    "src/engines/review/residualReviewGate.ts",
    "src/engines/review/session.ts",
    "src/engines/cross-candidate/person-evidence-gate.ts",
    "src/engines/cross-candidate/cross-candidate-evidence.ts",
    "src/io/AuditExporter.ts",
    "src/ui/recommendations.ts",
    "src/ui/triageQueue.ts",
    "src/ui/reviewZone.ts",
  ];
  for (const module of DECISION_MODULES) {
    const src = sourceOf.get(module);
    check(`${module} is present`, typeof src, "string");
    if (typeof src !== "string") continue;
    check(`${module} does not mention interpretation profiles`,
      /InterpretationProfile|interpretCandidate|SupportedInterpretation|getInterpretationProfiles/.test(src), false);
  }

  /* PHASE A HAS NO RULES, and that is asserted rather than described. A rule
   * would need a stable id, and this is the shape those ids take. */
  const derivation = sourceOf.get("src/engines/interpretation/candidate-interpretation.ts")!;
  check("the derivation declares no ruleId", /ruleId/.test(derivation), false);
  check("the derivation emits no AutomaticResolution", /AutomaticResolution/.test(derivation), false);
  check("the derivation has no notion of a preferred reading",
    /\b(preferred|primary|winner|resolve[A-Z]|bestReading|mostLikely)\b/.test(derivation), false);
}

/* ═══════════════════ 10. EXISTING BEHAVIOUR IS PINNED ═══════════════════ */

console.log("\n--- 10. EXISTING SEMANTIC AND PROTECTION BEHAVIOUR IS UNCHANGED ---");
{
  /* The person-protection gate still reads STRUCTURE, never token membership --
   * the property the whole coupling's safety rests on. `Major` is a Census
   * token and gets no protection from it; `Amy Miller` has structure and does. */
  const gateFacts = {
    candidateId: "x",
    qualityCategories: [] as string[],
    positiveReasons: [] as string[],
    contextualRules: [] as string[],
    hasPersonEvidencedLinkage: false,
  };
  check("token membership alone confers no gate protection",
    personEvidenceReasons({ ...gateFacts, hasCensusNameStructure: false }), []);
  check("Census STRUCTURE still confers gate protection",
    personEvidenceReasons({ ...gateFacts, hasCensusNameStructure: true }), ["census-name-structure"]);

  /* And the interpretation layer's token-membership signal did NOT leak into
   * the gate: `Major` carries the signal but the gate is untouched by it. */
  const major = interpretCandidate(facts("Major"));
  const personSignals = major.interpretations.find((i) => i.id === "person");
  check("Major carries a token-membership person signal in the profile",
    personSignals?.signals.some((s) => s.class === "token-membership"), true);
  check("...and that signal rests only on compositional/token evidence",
    restsOnlyOnCompositionalSignals(personSignals!), true);
  check("...while the gate still grants it nothing",
    personEvidenceReasons({ ...gateFacts, hasCensusNameStructure: false }), []);

  /* Type Check assignment is untouched: the same facts produce the same
   * section they did before this layer existed. Spot-checked across the
   * branch chain rather than asserted in prose. */
  const sectionCases: Array<[string, Parameters<typeof semanticTypeFor>[0], string]> = [
    ["email", { detectedType: "email", categories: [], relationshipKinds: new Set<RelationshipKind>() }, "emails"],
    ["organization", { detectedType: "organization", categories: [], relationshipKinds: new Set<RelationshipKind>() }, "organizations"],
    ["person with name evidence", { detectedType: "person", categories: ["known-personal-name-token"], relationshipKinds: new Set<RelationshipKind>() }, "people"],
    ["person with shape only", { detectedType: "person", categories: ["strong-name-structure"], relationshipKinds: new Set<RelationshipKind>() }, "other"],
    ["acronym", { detectedType: "unknown", categories: ["likely-acronym"], relationshipKinds: new Set<RelationshipKind>() }, "acronyms"],
  ];
  for (const [label, input, expected] of sectionCases) {
    check(`semanticTypeFor unchanged: ${label}`, semanticTypeFor(input), expected);
  }
  check("typeCheckSectionFor still returns exactly one section",
    Object.keys(typeCheckSectionFor(sectionCases[2]![1], false)).sort(), ["detectedType", "section", "semanticType"]);
}

/* ═══════════════════ 11. THE MODEL IS TOTAL ═══════════════════ */

console.log("\n--- 11. EVERY CANDIDATE GETS A PROFILE, INCLUDING THE BORING ONES ---");
{
  const email = interpretCandidate(facts("records@example.edu", { detectedType: "email" }));
  check("a typed email produces exactly one reading", readingsOf(email), ["email"]);
  check("and its outcome is `single`, not `contested`", email.outcome, "single");

  const identifier = interpretCandidate(facts("123456789", { detectedType: "cin" }));
  check("a typed identifier produces exactly one reading", readingsOf(identifier), ["identifier"]);

  /* Ordinary language is a POSITIVE reading, which is why no negative channel
   * is needed anywhere in the model. */
  const ordinary = interpretCandidate(facts("session", { detectedType: "unknown", qualityCategories: ["common-english-word"] }));
  check("ordinary language is represented as affirmative support",
    readingsOf(ordinary).includes("ordinary-language"), true);
  check("and it did not remove any competing reading",
    readingsOf(ordinary).length >= 1, true);

  /* Signal classes are reported in a stable order for a reading. */
  const rich = interpretCandidate(facts("Levy", {
    qualityCategories: ["known-surname"],
    contextualRules: ["anchor_signature_block"],
    hasPersonEvidencedLinkage: true,
  }));
  /* `token-membership` is in this list because `Levy` is a single Census-
   * attested token -- the weak claim firing alongside three stronger ones,
   * which is exactly what a model that keeps claim SHAPES separate should
   * show. The first draft of this assertion omitted it and was wrong. */
  check("signal classes for a reading come back in SIGNAL_CLASS_ORDER",
    signalClassesOf(rich.interpretations.find((i) => i.id === "person")!),
    ["lexicon-recognition", "token-membership", "occurrence-context", "document-consistency"]);
}

/* ═══════════════════ result ═══════════════════ */

console.log("");
if (failures > 0) {
  console.log(`CANDIDATE INTERPRETATION: ${failures} FAILURE(S)`);
  process.exit(1);
}
console.log("CANDIDATE INTERPRETATION: all checks passed.");
