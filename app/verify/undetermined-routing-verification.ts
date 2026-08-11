/**
 * undetermined-routing-verification.ts (AG, 2026-08-10).
 *
 * Pins the SEMANTIC CONTRACT of Undetermined, which is narrow and easy to
 * widen by accident. Each check below corresponds to one clause of that
 * contract as Andrew stated it.
 */

import {
  UNDETERMINED_SECTION,
  TYPE_CHECK_SECTION_ORDER,
  TYPE_CHECK_SECTION_LABELS,
  TYPE_CHECK_SECTION_EXPLANATIONS,
  SEMANTIC_TYPE_ORDER,
  semanticTypeFor,
  hasAffirmativeSemanticEvidence,
  typeCheckSectionFor,
  buildSemanticTypeGroups,
  buildSemanticTypeSummaries,
  type SemanticTypeFacts,
  type TypeCheckSectionId,
} from "../src/domain/semanticTypes.js";

let passed = 0;
let failed = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed += 1;
    console.log(`  PASS ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const facts = (categories: string[], detectedType = "person"): SemanticTypeFacts => ({
  detectedType,
  categories,
  relationshipKinds: new Set(),
});

console.log("\n--- 1. UNDETERMINED IS NOT A SEMANTIC TYPE ---");
{
  // The strongest available statement of this in TypeScript: `SemanticTypeId`
  // has no such member, so semanticTypeFor CANNOT return it, by type. This
  // check asserts the runtime vocabulary agrees with the type.
  check("SEMANTIC_TYPE_ORDER does not contain 'undetermined'", (SEMANTIC_TYPE_ORDER as readonly string[]).includes(UNDETERMINED_SECTION), false);
  check("TYPE_CHECK_SECTION_ORDER does", TYPE_CHECK_SECTION_ORDER.includes(UNDETERMINED_SECTION), true);
  check("it sorts LAST, after Other / Miscellaneous", TYPE_CHECK_SECTION_ORDER[TYPE_CHECK_SECTION_ORDER.length - 1], UNDETERMINED_SECTION);
  check("the routing vocabulary is exactly the semantic one plus one member", TYPE_CHECK_SECTION_ORDER.length, SEMANTIC_TYPE_ORDER.length + 1);
  // Exhaustively: no input to semanticTypeFor produces it.
  const everyCategory = ["strong-name-structure", "surname-given-structure", "known-personal-name-token", "institution-term",
    "calendar-term", "document-structure-term", "likely-acronym", "greeting-or-courtesy", "common-english-word", "unknown-capitalized-token"];
  let produced = false;
  for (const c of everyCategory) {
    for (const flag of [true, false]) {
      if ((semanticTypeFor({ ...facts([c]), crossCandidateNonPerson: flag }) as string) === UNDETERMINED_SECTION) produced = true;
    }
  }
  check("semanticTypeFor never produces it, for any input", produced, false);
}

console.log("\n--- 2. UNDETERMINED IS DISTINCT FROM OTHER ---");
{
  check("distinct ids", UNDETERMINED_SECTION === "other", false);
  check("distinct labels", TYPE_CHECK_SECTION_LABELS[UNDETERMINED_SECTION] === TYPE_CHECK_SECTION_LABELS.other, false);
  check("Undetermined label", TYPE_CHECK_SECTION_LABELS[UNDETERMINED_SECTION], "Undetermined");
  check("Other keeps its own label", TYPE_CHECK_SECTION_LABELS.other, "Other / Miscellaneous");
  /*
   * PHASE 4 RESULT (AG, 2026-08-10): Other is NO LONGER REACHABLE by routing,
   * and that is the finding rather than a bug.
   *
   * `semanticTypeFor` reaches `other` from exactly one fallthrough at its end,
   * arrived at when every affirmative branch failed. A search of the whole
   * production evidence vocabulary found NO category that affirmatively means
   * "miscellaneous" -- every category asserts something specific. So `other`
   * has only ever meant "nothing matched", which is Undetermined's meaning,
   * under a label that claims otherwise.
   *
   * The semantic VOCABULARY keeps its `other` member (it is a legitimate type
   * for evidence that does not exist yet); the ROUTING no longer uses it.
   */
  check("no affirmative evidence -> Undetermined, NOT Other", typeCheckSectionFor(facts(["unknown-capitalized-token"]), false).section, UNDETERMINED_SECTION);
  check("a non-person detection with no match -> Undetermined", typeCheckSectionFor(facts([], "unknown-type"), false).section, UNDETERMINED_SECTION);
  check("semanticTypeFor still HAS the other member (vocabulary intact)", semanticTypeFor(facts(["unknown-capitalized-token"])), "other");
  check("hasAffirmativeSemanticEvidence is false exactly there", hasAffirmativeSemanticEvidence(facts(["unknown-capitalized-token"])), false);
  check("and true for a real type", hasAffirmativeSemanticEvidence(facts(["institution-term"])), true);
}

console.log("\n--- 3. THE NARROW MEANING: rejected hypothesis + no replacement ---");
{
  const rejected = typeCheckSectionFor(facts(["strong-name-structure"]), true);
  check("shape + rejection -> undetermined", rejected.section, UNDETERMINED_SECTION);
  check("detector provenance is preserved", rejected.detectedType, "person");
  /*
   * `rejectedType` IS NOW UNREACHABLE, and that is a consequence worth
   * pinning rather than a gap.
   *
   * The field records "a type was proposed and then rejected". The only type
   * cross-candidate evidence could ever reject was `people`-by-SHAPE, and
   * shape no longer proposes a type at all. Affirmative person evidence
   * resists the flag by design. So every Undetermined entrant now arrives by
   * ABSENCE of evidence rather than by rejection.
   *
   * The field is retained because it is the right shape for a future
   * evidence family that CAN reject an affirmatively-supported type.
   */
  check("no rejection is recorded -- shape proposed nothing to reject", rejected.rejectedType, undefined);

  // A candidate with no rejected hypothesis still reaches Undetermined -- but
  // by ABSENCE of evidence, not by rejection. The distinction is preserved in
  // `rejectedType`, which stays undefined: the reviewer-facing state is the
  // same, the provenance is not.
  const noHypothesis = typeCheckSectionFor(facts(["greeting-or-courtesy"]), true);
  check("no affirmative evidence -> undetermined", noHypothesis.section, UNDETERMINED_SECTION);
  check("and NO rejectedType is invented (absence, not rejection)", noHypothesis.rejectedType, undefined);
}

console.log("\n--- 4. A SUPPORTED REPLACEMENT WINS (Andrew's case A) ---");
{
  // Institutional evidence resolves BEFORE people, so the rejection is moot:
  // person-scoped evidence must not move an Organization.
  const org = typeCheckSectionFor(facts(["institution-term"]), true);
  check("organization is unaffected by person-scoped rejection", org.section, "organizations");
  check("and records no rejection", org.rejectedType, undefined);
  for (const [category, expected] of [
    ["calendar-term", "dates-terms"],
    ["document-structure-term", "document-titles"],
    ["likely-acronym", "acronyms"],
  ] as const) {
    check(`${category} still routes to ${expected} with the flag set`, typeCheckSectionFor(facts([category]), true).section, expected);
  }
}

console.log("\n--- 5. PERSON EVIDENCE IS NEVER OVERRIDDEN ---");
{
  for (const evidence of ["known-personal-name-token", "known-first-name", "known-name-structure"]) {
    const r = typeCheckSectionFor(facts([evidence]), true);
    check(`${evidence} keeps the candidate in People even with the flag`, r.section, "people");
    check(`${evidence} records no rejection`, r.rejectedType, undefined);
  }
}

console.log("\n--- 6. CROSS-CANDIDATE EVIDENCE CANNOT INVENT A SEMANTIC TYPE ---");
{
  // The flag can only ever REMOVE `people`. It must never add a positive
  // classification, which is the failure mode "infer the type from the rule
  // that fired" would introduce.
  const withFlag = typeCheckSectionFor(facts(["strong-name-structure"]), true);
  check("it never yields organizations", withFlag.section === "organizations", false);
  check("it never yields dates-terms", withFlag.section === "dates-terms", false);
  check("it never yields document-titles", withFlag.section === "document-titles", false);
  check("its semanticType is the absence of an answer, not 'miscellaneous' as a conclusion", withFlag.semanticType, "other");
  check("but its SECTION distinguishes that from a real Other", withFlag.section, UNDETERMINED_SECTION);
}

console.log("\n--- 7. THE FLAG IS INERT WITHOUT EVIDENCE (no silent behaviour change) ---");
{
  for (const category of ["institution-term", "calendar-term"]) {
    check(`${category}: section === semanticTypeFor when nonPersonEvidence is false`,
      typeCheckSectionFor(facts([category]), false).section, semanticTypeFor(facts([category])));
  }
  // The places the two deliberately diverge: every unsupported case.
  for (const category of ["strong-name-structure", "surname-given-structure"]) {
    check(`${category}: semanticTypeFor says other, routing says undetermined`,
      [semanticTypeFor(facts([category])), typeCheckSectionFor(facts([category]), false).section],
      ["other", UNDETERMINED_SECTION]);
  }
  check("greeting-or-courtesy: semanticTypeFor says other, routing says undetermined",
    [semanticTypeFor(facts(["greeting-or-courtesy"])), typeCheckSectionFor(facts(["greeting-or-courtesy"]), false).section],
    ["other", UNDETERMINED_SECTION]);
}

console.log("\n--- 8. GROUPING AND SUMMARIES CARRY THE NEW SECTION ---");
{
  const assignments = new Map<string, TypeCheckSectionId>([
    ["a", "people"], ["b", UNDETERMINED_SECTION], ["c", "other"], ["d", UNDETERMINED_SECTION],
  ]);
  const groups = buildSemanticTypeGroups(assignments);
  check("a group is produced for undetermined", groups.some((g) => g.typeId === UNDETERMINED_SECTION), true);
  check("undetermined members are grouped together", groups.find((g) => g.typeId === UNDETERMINED_SECTION)?.candidateIds, ["b", "d"]);
  check("display order puts undetermined after other", groups.map((g) => g.typeId), ["people", "other", UNDETERMINED_SECTION]);
  const summaries = buildSemanticTypeSummaries([
    { id: "b", type: UNDETERMINED_SECTION, occurrenceCount: 3, decided: false },
    { id: "d", type: UNDETERMINED_SECTION, occurrenceCount: 2, decided: true },
  ]);
  check("summary label", summaries[0]?.label, "Undetermined");
  check("summary entity count", summaries[0]?.entityCount, 2);
  check("summary occurrence count", summaries[0]?.occurrenceCount, 5);
  check("summary decided count (drives 'remaining')", summaries[0]?.decidedCount, 1);
}

console.log("\n--- 9. REVIEWER COPY CARRIES NO IMPLEMENTATION VOCABULARY ---");
{
  const copy = `${TYPE_CHECK_SECTION_LABELS[UNDETERMINED_SECTION]} ${TYPE_CHECK_SECTION_EXPLANATIONS[UNDETERMINED_SECTION] ?? ""}`;
  check("explanation exists", TYPE_CHECK_SECTION_EXPLANATIONS[UNDETERMINED_SECTION], "Type could not be determined.");
  for (const banned of ["T3", "H2", "cross-candidate", "token", "recurrence", "classifier", "name-shaped", "rejected"]) {
    check(`copy does not contain "${banned}"`, copy.toLowerCase().includes(banned.toLowerCase()), false);
  }
}

console.log(`\n=== ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exitCode = 1;
