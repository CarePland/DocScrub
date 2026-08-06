/**
 * recommendations-verification.ts -- Reviewer Recommendation UX
 * (2026-07-30; updated same day for the "Reviewer Recommendation
 * Refinement"). Node-verifiable core: the pure archetype derivation
 * (recommendations.ts) -- the recognized-entity gate ("phrase completion
 * is not identity resolution"), which facts produce which conclusions,
 * which archetypes carry buttons vs. conclusion-only, the plain-language
 * rules, digit compatibility, and the no-recommendation fallbacks.
 *
 * NOT coverable here (browser-only): panel layout, header button
 * placement, Why? disclosure behavior, keyboard feel.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/recommendations-verification.ts
 */

import { deriveRecommendation, deriveReviewTier, identityDigitAssignments, isNonNameAnchorEvidence, type RecommendationFacts } from "../src/ui/recommendations.js";
import type { RelationshipKind } from "../src/domain/StructuralRelationship.js";

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

function facts(overrides: Partial<RecommendationFacts>): RecommendationFacts {
  return {
    displayValue: "Test",
    detectedType: "person",
    personTokenCount: 1,
    categories: [],
    qualityRecommendation: "ToReview",
    identityOptions: [],
    relationshipKinds: new Set<RelationshipKind>(),
    ...overrides,
  };
}

console.log("--- shortened name: recognized token + recognized home (the Andrew case) ---");
{
  const rec = deriveRecommendation(
    facts({
      displayValue: "Andrew",
      categories: ["known_personal_name_token"],
      identityOptions: [{ groupId: "g", canonicalName: "Andrew Goodloe", confidence: 88 }],
    })
  );
  check("archetype + verbatim conclusion", rec?.archetype === "shortened-name" && rec?.conclusion === "Likely a shortened reference to a larger name.");
  check("suggestion label IS the resulting interpretation, op = the existing link", rec?.suggestions[0]?.label === "Andrew Goodloe" && rec?.suggestions[0]?.op.kind === "link");
}

console.log("--- the recognition gate: phrase completion is NOT identity resolution ---");
{
  const did = deriveRecommendation(
    facts({ displayValue: "Did", identityOptions: [{ groupId: "g", canonicalName: "Did Dr", confidence: 95 }] })
  );
  check(
    '"Did" -> "Did Dr": no identity endorsement -- only the uncertain disposition chips (keep/ignore), never a "Did Dr" chip',
    did?.archetype === "uncertain" && did?.suggestions.length === 2 && did?.suggestions[0]?.op.kind === "keep" && did?.suggestions[1]?.op.kind === "ignore"
  );
  const junkAnchor = deriveRecommendation(
    facts({
      displayValue: "Andrew",
      categories: ["known_personal_name_token"],
      identityOptions: [{ groupId: "junk", canonicalName: "Andrew Are Goodloe", confidence: 90 }],
      unrecognizedGroupIds: new Set(["junk"]),
    })
  );
  check(
    "a known name whose only anchor is an unrecognized (all-Unlikely) bucket: uncertain disposition, no identity chip",
    junkAnchor?.archetype === "uncertain" && junkAnchor?.suggestions.every((sug) => sug.op.kind !== "link")
  );
  const weakAnchor = deriveRecommendation(
    facts({
      displayValue: "Andrew",
      categories: ["known_personal_name_token"],
      identityOptions: [{ groupId: "g", canonicalName: "Andrew Smith", confidence: 55 }],
    })
  );
  check(
    "a below-threshold anchor (confidence < 70) is not suggestion-worthy: uncertain disposition, no identity chip",
    weakAnchor?.archetype === "uncertain" && weakAnchor?.suggestions.every((sug) => sug.op.kind !== "link")
  );
  const mixed = deriveRecommendation(
    facts({
      displayValue: "Andrew",
      categories: ["known_personal_name_token"],
      identityOptions: [
        { groupId: "junk", canonicalName: "Andrew Are Goodloe", confidence: 90 },
        { groupId: "good", canonicalName: "Andrew Goodloe", confidence: 85 },
      ],
      unrecognizedGroupIds: new Set(["junk"]),
    })
  );
  check("mixed anchors: only the recognized one is suggested (order among recognized preserved)", mixed?.suggestions.length === 1 && mixed?.suggestions[0]?.label === "Andrew Goodloe");
}

console.log("--- digit compatibility among recognized options: order preserved, capped at two ---");
{
  const options = [
    { groupId: "g1", canonicalName: "Andrew Goodloe", confidence: 90 },
    { groupId: "g2", canonicalName: "Andrew Miller", confidence: 80 },
    { groupId: "g3", canonicalName: "Andrew Chen", confidence: 75 },
  ];
  const rec = deriveRecommendation(facts({ displayValue: "Andrew", categories: ["known_personal_name_token"], identityOptions: options }));
  check("suggestion 1/2 = recognized options 1/2 in existing order", (rec?.suggestions[0]?.op as { groupId: string }).groupId === "g1" && (rec?.suggestions[1]?.op as { groupId: string }).groupId === "g2");
  check("primary surface caps at two; the rest stay disclosed under Why?", rec?.suggestions.length === 2);
}

console.log("--- semantic alias vs acronym flavors (knowledge-backed passes the gate outright) ---");
{
  const alias = deriveRecommendation(
    facts({
      displayValue: "Andy",
      categories: ["known_personal_name_token"],
      identityOptions: [{ groupId: "g", canonicalName: "Andrew Goodloe", confidence: 91, evidence: ['Related name: "andy" ↔ "andrew" (Strength 5 — Established)'] }],
    })
  );
  check('alias conclusion names the identity: "Likely another name for Andrew Goodloe."', alias?.archetype === "semantic-alias" && alias?.conclusion === "Likely another name for Andrew Goodloe.");
  const acr = deriveRecommendation(
    facts({
      displayValue: "NSC",
      identityOptions: [{ groupId: "g", canonicalName: "National Student Clearinghouse", confidence: 90, evidence: ['Acronym: "NSC" ↔ "National Student Clearinghouse" (Strength 5 — Established)'] }],
    })
  );
  check("acronym-evidence flavor: acronym archetype, suggestion = the expansion", acr?.archetype === "acronym" && acr?.suggestions[0]?.label === "National Student Clearinghouse");
  const acrPlusJunk = deriveRecommendation(
    facts({
      displayValue: "NSC",
      identityOptions: [
        { groupId: "k", canonicalName: "National Student Clearinghouse", confidence: 90, evidence: ['Acronym: "NSC" ↔ "National Student Clearinghouse" (Strength 5 — Established)'] },
        { groupId: "junk", canonicalName: "NSC Update", confidence: 88 },
      ],
      unrecognizedGroupIds: new Set(["junk"]),
    })
  );
  check("knowledge option + junk co-option: only the recognized expansion is suggested", acrPlusJunk?.suggestions.length === 1 && acrPlusJunk?.suggestions[0]?.label === "National Student Clearinghouse");
}

console.log("--- term archetypes: the claim IS the ① chip (conclusion-as-button, AG 2026-08-02) ---");
// SUPERSESSION: the earlier refinement's "no manufactured Ignore chips"
// for term archetypes was reversed by Andrew's direct instruction
// ("offering a numeric button option in lieu of a static 'I think this
// is a [blank] type' is more useful ... simultaneously offers the
// solution immediately"). The categorical claim is now suggestion ①
// (op: ignore -- the same decision the section's Accept All default
// applies); a recognized identity option follows as ②; the conclusion
// sentence is empty (the chip replaces it).
{
  const dept = deriveRecommendation(facts({ displayValue: "Enrollment Services", personTokenCount: 2, categories: ["department_organization"] }));
  check(
    "institutional-term: claim chip first, op ignore, empty conclusion",
    dept?.archetype === "institutional-term" && dept?.conclusion === "" && dept?.suggestions[0]?.label === "Institutional term" && dept?.suggestions[0]?.op.kind === "ignore"
  );
  const faculty = deriveRecommendation(facts({ displayValue: "Faculty", categories: ["institution-term"] }));
  check("single institutional word reaches the same archetype with the claim chip", faculty?.archetype === "institutional-term" && faculty?.suggestions[0]?.op.kind === "ignore");
  const may = deriveRecommendation(facts({ displayValue: "MAY", categories: ["calendar_term"] }));
  check(
    "calendar-term: claim chip, op ignore, empty conclusion",
    may?.archetype === "calendar-term" && may?.conclusion === "" && may?.suggestions[0]?.label === "Calendar / academic term" && may?.suggestions[0]?.op.kind === "ignore"
  );
  const mayChen = deriveRecommendation(facts({ displayValue: "May Chen", personTokenCount: 2, categories: ["calendar_term"] }));
  // The property this always protected -- a multi-token person is never
  // given a TERM archetype -- is unchanged. It now derives `uncertain`
  // rather than null, because retiring the Ignore button means every
  // person-typed item needs a disposition route (see deriveRecommendation).
  check('a multi-token person ("May Chen") is never waved toward a term archetype', mayChen?.archetype === "uncertain");
  const correct = deriveRecommendation(facts({ displayValue: "Correct", categories: ["common_english_word"], qualityRecommendation: "Unlikely" }));
  check(
    // THE ESCAPE HATCH (AG, 2026-08-03, the "Amy" case): a term conclusion
    // OVERRIDES the detector, so a single-token person-typed item now also
    // carries ② Person's name -- the same disposition pair the uncertain
    // branch offers, which these items never reached only because the term
    // checks return first. The claim stays ①, so every section-level accept
    // still applies the term.
    "common-word on a person-typed token: ① claim (ignore) THEN ② Person's name (keep)",
    correct?.archetype === "common-word" &&
      correct?.conclusion === "" &&
      correct?.suggestions.length === 2 &&
      correct?.suggestions[0]?.label === "Common word" &&
      correct?.suggestions[0]?.op.kind === "ignore" &&
      correct?.suggestions[1]?.label === "Person's name" &&
      correct?.suggestions[1]?.op.kind === "keep"
  );
  // The "Any" case from Andrew's own screenshot: a common word WITH a
  // recognized identity anchor -- the claim stays ①, the identity is ②.
  const anyWord = deriveRecommendation(
    facts({
      displayValue: "Any",
      categories: ["common_english_word"],
      qualityRecommendation: "Unlikely",
      identityOptions: [{ groupId: "g-tanesha", canonicalName: "Any Tanesha", confidence: 95 }],
    })
  );
  // ONE DIGIT SPACE (AG, 2026-08-02, second refinement): the identity is
  // deliberately NOT a ② header chip -- it takes ② inside the Possible
  // identities list instead ("I actually would prefer they have to read
  // the whole thing if they want to select 2").
  check(
    "common word with a recognized anchor: the header carries the claim and the name disposition, and nothing else",
    anyWord?.suggestions.length === 2 && anyWord?.suggestions[0]?.op.kind === "ignore" && anyWord?.suggestions[1]?.op.kind === "keep"
  );
  const anyAssignments = identityDigitAssignments(anyWord ?? null, [{ groupId: "g-tanesha", canonicalName: "Any Tanesha", confidence: 95 }]);
  // ONE DIGIT SPACE, unchanged in principle: the identity list CONTINUES
  // the header sequence. It now starts at ③ because the header carries two
  // chips -- which is the contract working, not a regression.
  check("...and the identity option continues the sequence after both chips, as ③", anyAssignments.length === 1 && anyAssignments[0]?.digit === 3);
  const chris = deriveRecommendation(facts({ displayValue: "Chris", categories: ["known_personal_name_token", "common_english_word"] }));
  check(
    "a recognized NAME token never gets the common-word claim -- it takes the uncertain disposition instead",
    chris?.archetype === "uncertain" && chris?.suggestions[0]?.label === "Person's name"
  );
}

console.log("--- one digit space: header chips and identity list can never disagree ---");
{
  // Identity-backed archetype: the header chips ARE the first options, so
  // the list reuses their digits (option0=1, option1=2) and continues (3).
  const opts = [
    { groupId: "g1", canonicalName: "Andrew Goodloe", confidence: 92 },
    { groupId: "g2", canonicalName: "Andrew Thanks", confidence: 90 },
    { groupId: "g3", canonicalName: "Andy Parra", confidence: 88 },
  ];
  const shortened = deriveRecommendation(
    facts({ displayValue: "Andrew", categories: ["known_first_name"], identityOptions: opts })
  );
  const a = identityDigitAssignments(shortened, opts);
  check(
    "identity-backed: list digits mirror the header chips, then continue",
    a[0]?.digit === 1 && a[1]?.digit === 2 && a[2]?.digit === 3
  );
  // No recommendation at all: plain 1..N (pre-recommendation behavior).
  const bare = identityDigitAssignments(null, opts);
  check("no recommendation: options number 1..N", bare[0]?.digit === 1 && bare[1]?.digit === 2 && bare[2]?.digit === 3);
}

console.log("--- acronym-shaped without a knowledge expansion: named, not recommended ---");
{
  const acr = deriveRecommendation(facts({ displayValue: "PERC", relationshipKinds: new Set<RelationshipKind>(["acronym"]) }));
  check("acronym conclusion with NO buttons (the relationship card owns the actions)", acr?.archetype === "acronym" && acr?.suggestions.length === 0);
}

console.log("--- identifier archetype (kept: high-confidence and genuinely one keystroke) ---");
{
  const typedId = deriveRecommendation(facts({ displayValue: "998211443", detectedType: "long_numeric_id", personTokenCount: 0 }));
  check('typed identifier: "Likely an identifier." + [________]->redact editor', typedId?.conclusion === "Likely an identifier." && typedId?.suggestions[0]?.op.kind === "open-redact-editor");
  const patternId = deriveRecommendation(facts({ displayValue: "A1234567", relationshipKinds: new Set<RelationshipKind>(["alphanumeric-identifier"]) }));
  check("pattern-grouped identifier reaches the same archetype", patternId?.archetype === "identifier");
}

console.log("--- language rules (test-enforced) ---");
{
  const all = [
    deriveRecommendation(facts({ displayValue: "Andrew", categories: ["known_personal_name_token"], identityOptions: [{ groupId: "g", canonicalName: "Andrew Goodloe", confidence: 88 }] })),
    deriveRecommendation(facts({ displayValue: "Faculty", categories: ["institution-term"] })),
    deriveRecommendation(facts({ displayValue: "998211443", detectedType: "cin", personTokenCount: 0 })),
    deriveRecommendation(facts({ displayValue: "Spring", categories: ["season_or_academic_term"] })),
  ];
  const banned = /vocabulary|detector|heuristic|candidate score|matched|confidence/i;
  check("no conclusion uses detector/implementation terminology", all.every((r) => r !== null && !banned.test(r.conclusion)));
  const verbBanned = /^(apply|select|resolve|choose|use |change )/i;
  check("no suggestion label is an operation verb", all.every((r) => r!.suggestions.every((s) => !verbBanned.test(s.label))));
}

console.log("--- no archetype -> no recommendation -> renders as today ---");
{
  // DISPOSITION, NOT A RECOMMENDATION (AG, 2026-08-03): an ordinary full
  // name now carries the two dispositions rather than nothing, so that
  // "Thanks Andrew" / "Good Morning" have a route once Ignore stops being a
  // button. Three properties are asserted together because the change is
  // only safe if all three hold: the archetype stays `uncertain` (so
  // deriveReviewTier still treats it as unrecommended and nothing is
  // promoted to a Strong tier), and Keep is FIRST so a section-level Accept
  // All still keeps people rather than ignoring them.
  {
    const plainName = deriveRecommendation(facts({ displayValue: "Tamara Yamada", personTokenCount: 2 }));
    check(
      "an ordinary full person name carries the two dispositions, Keep first, still untiered",
      plainName?.archetype === "uncertain" &&
        plainName?.suggestions.length === 2 &&
        plainName?.suggestions[0]?.op.kind === "keep" &&
        plainName?.suggestions[1]?.op.kind === "ignore"
    );
  }
  // SUPERSEDED TWICE (AG, 2026-08-03). "Their handling is already typed"
  // held only while Ignore was a button on every row. A first replacement
  // offered a two-chip disposition; AG collapsed it to ONE -- "only clear
  // it if the user says it's *not* worth handling" -- because the other
  // chip duplicated the Redact button sitting beside it.
  {
    const email = deriveRecommendation(facts({ displayValue: "a@b.c", detectedType: "email", personTokenCount: 0 }));
    const phone = deriveRecommendation(facts({ displayValue: "555-0100", detectedType: "phone", personTokenCount: 0 }));
    const org = deriveRecommendation(facts({ displayValue: "Office of the University Registrar", detectedType: "organization", personTokenCount: 4 }));
    const every = [email, phone, org];
    check(
      "an unclassified typed detection offers exactly ONE exception route",
      every.every((r) => r?.suggestions.length === 1 && r.suggestions[0]?.label === "Not personal" && r.suggestions[0]?.op.kind === "ignore")
    );
    // TYPE-AGNOSTIC BY CONSTRUCTION: the branch is the function's last, so a
    // detected type nobody has thought about yet cannot ship without an
    // escape. Enumerating types is exactly how the email/phone gap happened.
    check(
      "the route is not enumerated per type -- an unknown type gets it too",
      deriveRecommendation(facts({ displayValue: "??", detectedType: "some-future-type", personTokenCount: 0 }))?.suggestions[0]?.label === "Not personal"
    );
    check(
      "none is promoted out of unrecommended -- archetype stays `uncertain`, which deriveReviewTier treats as null",
      every.every((r) => r?.archetype === "uncertain")
    );
  }
  {
    const zzyzx = deriveRecommendation(facts({ displayValue: "Zzyzx" }));
    check(
      "a bare single token with NO name category and NO term category takes the uncertain disposition (person-typed = type speculation)",
      zzyzx?.archetype === "uncertain" && zzyzx?.suggestions.length === 2
    );
  }
}

console.log("--- REVIEW CONFIDENCE TIERS (2026-08-02): reviewer effort, not detector confidence ---");
{
  const tierOf = (f: RecommendationFacts) => deriveReviewTier(f, deriveRecommendation(f));
  // Suggestion-bearing recommendations cleared the recognition gate: strong.
  const shortened = facts({
    displayValue: "Andrew",
    categories: ["known-first-name"],
    identityOptions: [{ groupId: "g1", canonicalName: "Andrew Goodloe", confidence: 85 }],
  });
  check("recognized shortened name -> strong", tierOf(shortened) === "strong");
  // Term archetypes carry the whole recommendation in the conclusion: strong.
  check("institutional term -> strong (conclusion IS the recommendation)", tierOf(facts({ displayValue: "Registrar", categories: ["institution-term"] })) === "strong");
  check("identifier -> strong", tierOf(facts({ displayValue: "404039594", detectedType: "long_numeric_id", personTokenCount: 0 })) === "strong");
  // A named-but-unresolved conclusion: needs review.
  check("acronym-shaped token without expansion -> needs-review", tierOf(facts({ displayValue: "NSC", categories: ["likely-acronym"] })) === "needs-review");
  // The rescued person question: recognized name, only unrecognized homes.
  const julie = facts({
    displayValue: "Julie",
    categories: ["known-first-name"],
    identityOptions: [{ groupId: "g2", canonicalName: "Julie Dr", confidence: 45 }],
    unrecognizedGroupIds: new Set(["g2"]),
  });
  check(
    "known name with only unrecognized homes -> uncertain disposition, and STILL needs-review (chips never promote the tier)",
    deriveRecommendation(julie)?.archetype === "uncertain" && tierOf(julie) === "needs-review"
  );
  // True junk stays untiered.
  check("non-name token with no categories -> no tier (individual review)", tierOf(facts({ displayValue: "Zzyzx" })) === null);
  check("non-person types without archetype -> no tier", tierOf(facts({ displayValue: "a@b.c", detectedType: "email", personTokenCount: 0 })) === null);
  // Decision-blindness is structural: facts carry no decision state at all.
}

console.log("--- ANCHOR VETTING second signal (2026-08-02): non-name evidence categories ---");
{
  // The junk class from Andrew's transcript: name-SHAPED phrases whose
  // second token is ordinary language ("Yes, Diana"; "Thanks, Tamara").
  check('interjection ("Yes, Diana") is non-name evidence', isNonNameAnchorEvidence(["interjection_casual"]));
  check('greeting ("Thanks, Tamara") is non-name evidence', isNonNameAnchorEvidence(["greeting_or_courtesy", "interjection_casual"]));
  check('common verb ("Tanesha Can") is non-name evidence', isNonNameAnchorEvidence(["common_verb"]));
  check("kebab and snake case both match", isNonNameAnchorEvidence(["common-english-word"]) && isNonNameAnchorEvidence(["common_english_word"]));
  // THE REGRESSION CHECK (caught empirically against Andrew's own
  // transcript before shipping): frequency and structure signals are NOT
  // word-nature evidence -- real speakers carry them ("Perias, Nelly" =
  // frequency_saturated + surname_given_structure; "Yamada, Tamara" adds
  // nearby_title). Vetoing on these killed legitimate suggestions.
  check("frequency-saturated alone is NOT non-name evidence (Nelly Perias)", !isNonNameAnchorEvidence(["frequency_saturated", "surname_given_structure"]));
  check("structure/title/frequency-bonus signals are NOT non-name evidence (Tamara Yamada, Kyle Francis)", !isNonNameAnchorEvidence(["frequency_saturated", "nearby_title", "surname_given_structure"]) && !isNonNameAnchorEvidence(["small_frequency_bonus", "surname_given_structure"]) && !isNonNameAnchorEvidence(["moderate_frequency_bonus", "strong_name_structure"]));
  check("empty categories are not evidence either way", !isNonNameAnchorEvidence([]));
}

console.log(`\n${passCount}/${passCount + failCount} checks passed`);
process.exitCode = failCount === 0 ? 0 : 1;
