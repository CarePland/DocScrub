/**
 * triage-queue-verification.ts -- Triage Queue review mode (2026-07-30).
 * Node-verifiable core: the pure sectioning policy (triageQueue.ts) --
 * archetype -> section mapping, section display order, within-section
 * input-order preservation, empty-section omission, and the flat queue
 * order the visible-list advance contract depends on. Also the stability
 * property the UI relies on: sectioning is decision-BLIND (app.ts feeds
 * it the decision-blind archetype), so this module never reorders.
 *
 * NOT coverable here (browser-only): row rendering, accept-and-advance
 * feel, Enter/Space keys, expansion of the existing detail panel.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/triage-queue-verification.ts
 */

import { decisionBulkLabel } from "../src/ui/decisionLabels.js";
import {
  AMBIGUITY_SECTION_EXPLANATIONS,
  AMBIGUITY_SECTION_LABELS,
  AMBIGUITY_SECTION_ORDER,
  AMBIGUITY_TIER_ACTIONS,
  REVIEW_TIER_LABELS,
  TRIAGE_SECTION_ACCEPT_DEFAULT,
  TRIAGE_SECTION_EXPLANATIONS,
  TRIAGE_SECTION_LABELS,
  TRIAGE_SECTION_ORDER,
  ambiguityQueueOrder,
  ambiguitySectionFor,
  buildAmbiguitySections,
  buildTriageSections,
  structuralCardDisplayOrder,
  triageQueueOrder,
  triageSectionFor,
  type AmbiguityQueueItem,
  type SectionAction,
  type TriageQueueItem,
} from "../src/ui/triageQueue.js";

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

console.log("--- archetype -> section mapping ---");
check("shortened-name -> People", triageSectionFor("shortened-name", "person") === "people");
check("semantic-alias -> People", triageSectionFor("semantic-alias", "person") === "people");
check("acronym -> Acronyms", triageSectionFor("acronym", "person") === "acronyms");
check("identifier -> Identifier patterns", triageSectionFor("identifier", "long_numeric_id") === "identifiers");
check("institutional-term -> Institutional terms", triageSectionFor("institutional-term", "person") === "institutional");
check("calendar-term -> Calendar terms", triageSectionFor("calendar-term", "person") === "calendar");
check("common-word -> Common words", triageSectionFor("common-word", "person") === "common-words");
check("no archetype + person type -> People (a bare Julie/Margaret row)", triageSectionFor(null, "person") === "people");
check("no archetype + non-person type -> Other", triageSectionFor(null, "email") === "other");

console.log("--- section building ---");
{
  const items: TriageQueueItem[] = [
    { id: "amy", archetype: "shortened-name", detectedType: "person" },
    { id: "may", archetype: "calendar-term", detectedType: "person" },
    { id: "andrew", archetype: "shortened-name", detectedType: "person" },
    { id: "julie", archetype: null, detectedType: "person" },
    { id: "nsc", archetype: "acronym", detectedType: "person" },
    { id: "id1", archetype: "identifier", detectedType: "long_numeric_id" },
  ];
  const sections = buildTriageSections(items);
  check("empty sections are omitted (no Institutional/Common/Other here)", sections.every((s) => s.candidateIds.length > 0) && sections.length === 4);
  check("sections appear in display order (People, Acronyms, Temporal, Identifiers)", sections.map((s) => s.id).join(",") === "people,acronyms,calendar,identifiers");
  check("input order preserved WITHIN a section (amy, andrew, julie)", sections[0]?.candidateIds.join(",") === "amy,andrew,julie");
  check("every section carries its display label", sections.every((s) => s.label === TRIAGE_SECTION_LABELS[s.id]));
  check("flat queue order = sections concatenated (the visible-list advance contract)", triageQueueOrder(items).join(",") === "amy,andrew,julie,nsc,may,id1");
}

console.log("--- category-first review (2026-08-01): reviewer-facing semantic categories, conclusions once, Accept All policy ---");
check('institutional label reads "Institutional Terminology"', TRIAGE_SECTION_LABELS.institutional === "Institutional Terminology");
check('calendar label reads "Temporal / Calendar Terms"', TRIAGE_SECTION_LABELS.calendar === "Temporal / Calendar Terms");
check('people label reads "Likely People"; other reads "Other / Needs Individual Review"', TRIAGE_SECTION_LABELS.people === "Likely People" && TRIAGE_SECTION_LABELS.other === "Other / Needs Individual Review");
check("EVERY section carries a one-line explanation (the category is the decision)", ["people", "acronyms", "identifiers", "institutional", "calendar", "common-words", "other"].every((id) => Boolean(TRIAGE_SECTION_EXPLANATIONS[id as keyof typeof TRIAGE_SECTION_EXPLANATIONS])));
check("Accept All defaults: People -> Keep; term sections -> Ignore", TRIAGE_SECTION_ACCEPT_DEFAULT.people === "Keep" && TRIAGE_SECTION_ACCEPT_DEFAULT.institutional === "Ignore" && TRIAGE_SECTION_ACCEPT_DEFAULT.calendar === "Ignore" && TRIAGE_SECTION_ACCEPT_DEFAULT["common-words"] === "Ignore");
check("identifier and acronym sections offer NO Accept All (their accept paths need the reviewer)", TRIAGE_SECTION_ACCEPT_DEFAULT.identifiers === undefined && TRIAGE_SECTION_ACCEPT_DEFAULT.acronyms === undefined && TRIAGE_SECTION_ACCEPT_DEFAULT.other === undefined);

console.log("--- stability: sectioning is a pure function of archetype+type, never of decision state ---");
{
  const before: TriageQueueItem[] = [
    { id: "a", archetype: "shortened-name", detectedType: "person" },
    { id: "b", archetype: "common-word", detectedType: "person" },
  ];
  // Deciding an item changes NOTHING the section function reads (the UI
  // passes the decision-blind archetype) -- identical inputs, identical
  // queue, so rows never move while the reviewer works.
  check("same inputs -> same queue order", triageQueueOrder(before).join(",") === triageQueueOrder(before.map((i) => ({ ...i }))).join(","));
}

console.log("--- section order sanity ---");
check("People leads; the term sections sit together (refinement order)", TRIAGE_SECTION_ORDER.join(",") === "people,acronyms,institutional,calendar,common-words,identifiers,other");
check("Other is last", TRIAGE_SECTION_ORDER[TRIAGE_SECTION_ORDER.length - 1] === "other");

console.log("--- AMBIGUITY CATEGORY-FIRST (2026-08-02): the ambiguity section vocabulary ---");
const amb = (
  id: string,
  archetype: AmbiguityQueueItem["archetype"],
  detectedType = "person",
  aliasFlavor: AmbiguityQueueItem["aliasFlavor"] = null,
  tier: AmbiguityQueueItem["tier"] = archetype ? "strong" : null,
  nameEvidence = false
): AmbiguityQueueItem => ({ id, archetype, detectedType, aliasFlavor, tier, nameEvidence });
check("shortened-name -> Shortened Person Names", ambiguitySectionFor(amb("a", "shortened-name")) === "shortened-names");
check("semantic-alias + nickname flavor -> Nicknames", ambiguitySectionFor(amb("a", "semantic-alias", "person", "nickname")) === "nicknames");
check("semantic-alias + org-alias flavor -> Organizational Aliases", ambiguitySectionFor(amb("a", "semantic-alias", "person", "org-alias")) === "org-aliases");
check("semantic-alias + unknown flavor -> Nicknames (the person-flavored default)", ambiguitySectionFor(amb("a", "semantic-alias")) === "nicknames");
check("acronym -> Acronyms; identifier -> Identifier Patterns", ambiguitySectionFor(amb("a", "acronym")) === "acronyms" && ambiguitySectionFor(amb("a", "identifier", "long_numeric_id")) === "identifiers");
check("term archetypes -> their term sections", ambiguitySectionFor(amb("a", "institutional-term")) === "institutional" && ambiguitySectionFor(amb("a", "calendar-term")) === "calendar" && ambiguitySectionFor(amb("a", "common-word")) === "common-words");
// THE divergence Andrew's 2026-08-02 observation motivated ("many of the
// 'person' classified items are clearly not people"): a person-typed
// candidate with NO conclusion is phrase-completion junk here, never a
// bulk-acceptable person section.
// OTHER WORDS (2026-08-06): the split moved from TIER to NAME EVIDENCE.
// A person-typed token with no name evidence is an ordinary word the
// lexicon does not list -- "and", "Math", "Residency" -- and belongs in
// Other Words, not in a bucket that asks the reviewer to adjudicate our
// missing dictionary data. It is still never a bulk-acceptable PEOPLE
// section, which is what the original divergence was protecting.
check("person type, NO name evidence -> Other Words, never a people section", ambiguitySectionFor(amb("and", null, "person")) === "common-words");
check("name evidence rescues a person-typed token into the names family", ambiguitySectionFor(amb("kyle", null, "person", null, "strong", true)) === "shortened-names");
check("non-person with no archetype is still Other", ambiguitySectionFor(amb("x", null, "long_numeric_id")) === "other");
check("identity sections lead the order; other is last", AMBIGUITY_SECTION_ORDER[0] === "shortened-names" && AMBIGUITY_SECTION_ORDER[1] === "nicknames" && AMBIGUITY_SECTION_ORDER[2] === "org-aliases" && AMBIGUITY_SECTION_ORDER[AMBIGUITY_SECTION_ORDER.length - 1] === "other");
// SHORTENED 2026-08-06, his list verbatim. The point of pinning these is
// unchanged -- the labels are a taxonomy he dictated, not incidental
// strings -- so the assertion moves with the taxonomy rather than being
// loosened. It now covers the five inherited ids too, because those are
// exactly the ones a careless edit to TRIAGE_SECTION_LABELS would silently
// change on this stage.
check(
  'labels match Andrew\'s taxonomy ("Shortened Names" etc.)',
  AMBIGUITY_SECTION_LABELS["shortened-names"] === "Shortened Names" &&
    AMBIGUITY_SECTION_LABELS.nicknames === "Other Names" &&
    AMBIGUITY_SECTION_LABELS["org-aliases"] === "Org Names" &&
    AMBIGUITY_SECTION_LABELS.institutional === "Institutional" &&
    AMBIGUITY_SECTION_LABELS.calendar === "Time / Calendar" &&
    AMBIGUITY_SECTION_LABELS.identifiers === "Numeric" &&
    AMBIGUITY_SECTION_LABELS["common-words"] === "Other Words" &&
    AMBIGUITY_SECTION_LABELS.other === "Other"
);
// The Ambiguity labels are OVERRIDES, not a rename at the source: Item
// Check keeps the long forms. Asserted so the next person shortening a
// label does it in the right map.
check(
  "Item Check labels are untouched by the Ambiguity shortening",
  TRIAGE_SECTION_LABELS.institutional === "Institutional Terminology" &&
    TRIAGE_SECTION_LABELS.calendar === "Temporal / Calendar Terms" &&
    TRIAGE_SECTION_LABELS.identifiers === "Identifier Patterns" &&
    TRIAGE_SECTION_LABELS["common-words"] === "Common English Words"
);
check("every orderable section has a label; every non-other section has an explanation", AMBIGUITY_SECTION_ORDER.every((id) => Boolean(AMBIGUITY_SECTION_LABELS[id])) && AMBIGUITY_SECTION_ORDER.every((id) => Boolean(AMBIGUITY_SECTION_EXPLANATIONS[id]) || id === "other" || Boolean(AMBIGUITY_SECTION_EXPLANATIONS[id])));
{
  const items: AmbiguityQueueItem[] = [
    amb("did", null, "person"),
    amb("andrew", "shortened-name"),
    amb("its", "semantic-alias", "person", "org-alias"),
    amb("andy", "semantic-alias", "person", "nickname"),
    amb("tamara", "shortened-name"),
    amb("may", "calendar-term"),
  ];
  const sections = buildAmbiguitySections(items);
  // "did" carries no name evidence, so it is an ordinary word now (Other
  // Words) rather than junk needing individual review -- and `identifiers`
  // sits before `common-words` since the 2026-08-06 reorder.
  check("sections in display order, empties omitted", sections.map((s) => s.id).join(",") === "shortened-names,nicknames,org-aliases,calendar,common-words");
  check("within-section input order preserved", sections[0]!.candidateIds.join(",") === "andrew,tamara");
  check("flat queue order = sections concatenated", ambiguityQueueOrder(items).join(",") === "andrew,tamara,andy,its,may,did");
  check("decision-blind stability: identical inputs, identical order", ambiguityQueueOrder(items).join(",") === ambiguityQueueOrder(items.map((i) => ({ ...i }))).join(","));
}

console.log("--- REVIEW CONFIDENCE TIERS (2026-08-02): tier partition + category action vocabularies ---");
check('tier labels are the spec\'s reviewer language', REVIEW_TIER_LABELS.strong === "Strong Recommendations" && REVIEW_TIER_LABELS["needs-review"] === "Needs Review");
// The person question rescued from "Other": a recognized-name person
// with unrecognized options carries tier needs-review and joins the
// person-name category rather than the junk bucket.
check("name evidence, not tier, is what routes to the names family", ambiguitySectionFor(amb("julie", null, "person", null, "needs-review", true)) === "shortened-names");
check("no name evidence lands in Other Words regardless of tier", ambiguitySectionFor(amb("and", null, "person", null, null)) === "common-words");
{
  const items: AmbiguityQueueItem[] = [
    amb("julie", null, "person", null, "needs-review", true), // name evidence puts her in the names family; input first...
    amb("andrew", "shortened-name"), // ...but strong tier renders first
    amb("nsc", "acronym", "person", null, "needs-review"),
    amb("its", "acronym", "person", null, "strong"),
    amb("and", null, "person", null, null),
  ];
  const sections = buildAmbiguitySections(items);
  const shortened = sections.find((s) => s.id === "shortened-names")!;
  check("two tiers, strong first, needs-review second", shortened.tiers.map((t) => t.id).join(",") === "strong,needs-review");
  check("tier membership follows the item tier", shortened.tiers[0]!.candidateIds.join(",") === "andrew" && shortened.tiers[1]!.candidateIds.join(",") === "julie");
  check("section candidateIds = tier groups concatenated (queue order)", shortened.candidateIds.join(",") === "andrew,julie");
  const acronyms = sections.find((s) => s.id === "acronyms")!;
  check("acronyms partition too (strong: its, needs-review: nsc)", acronyms.tiers[0]!.candidateIds.join(",") === "its" && acronyms.tiers[1]!.candidateIds.join(",") === "nsc");
  // "and" is an untiered, evidence-free word -- Other Words now, not Other.
  const otherWords = sections.find((s) => s.id === "common-words")!;
  check("Other Words carries untiered items with NO tier groups", otherWords.tiers.length === 0 && otherWords.candidateIds.join(",") === "and");
  check("flat queue order walks tiers in display order", ambiguityQueueOrder(items).join(",") === "andrew,julie,its,nsc,and");
}
{
  const allActions: SectionAction[] = Object.values(AMBIGUITY_TIER_ACTIONS).flatMap((tiers) => Object.values(tiers ?? {}).flat());
  check("every declared action has a human label and a hint", allActions.every((a) => a.label.length > 0 && a.hint.length > 0));
  const bannedImplementationWords = /expand|normalize|canonicalize|apply relationship|bulk|dispatch/i;
  check("no implementation terminology in action labels", allActions.every((a) => !bannedImplementationWords.test(a.label)));
  check("shortened-names strong: Use full names / Keep shortened names / Redact all", (AMBIGUITY_TIER_ACTIONS["shortened-names"]?.strong ?? []).map((a) => a.label).join("|") === "Use full names|Keep shortened names|Redact all");
  check("shortened-names needs-review asks the PERSON question (Keep/Ignore ops)", (AMBIGUITY_TIER_ACTIONS["shortened-names"]?.["needs-review"] ?? []).some((a) => a.op.kind === "bulk-decision" && a.op.decision === "Keep") && (AMBIGUITY_TIER_ACTIONS["shortened-names"]?.["needs-review"] ?? []).some((a) => a.op.kind === "bulk-decision" && a.op.decision === "Ignore"));
  check("acronyms strong leads with accept-suggestions (Use written-out forms)", AMBIGUITY_TIER_ACTIONS.acronyms?.strong?.[0]?.op.kind === "accept-suggestions");
  check("term sections lead with the Ignore decision", AMBIGUITY_TIER_ACTIONS.institutional?.strong?.[0]?.op.kind === "bulk-decision" && AMBIGUITY_TIER_ACTIONS.calendar?.strong?.[0]?.op.kind === "bulk-decision");
  // LABEL/DECISION AGREEMENT (AG, 2026-08-03). The defect these pin: the
  // three term sections used to lead with a button LABELLED "Leave all
  // as-is" that dispatched **Ignore**, while the cards beneath it rendered
  // "Keep as-is" and "Ignore" as two different decisions. A label that
  // names one decision and performs another is the same failure class the
  // unified decision color system was built to eliminate, in words rather
  // than hue -- so it is pinned as a rule over the whole vocabulary, not
  // as three string comparisons that a fourth term section could evade.
  const KEEP_WORDING = /\bas-is\b/i;
  check(
    'no Ignore action wears Keep\'s "all as-is" wording (the "Leave all as-is" -> Ignore defect)',
    allActions.every((a) => !(a.op.kind === "bulk-decision" && a.op.decision === "Ignore" && /^(leave|keep) all as-is$/i.test(a.label)))
  );
  check(
    // CONCLUSION-NAMED TERM SECTIONS (AG, 2026-08-03, second correction:
    // "Institutional Terminology needs a 'These are all institutional
    // terms' global green button"). These went "Leave all as-is" (wrong --
    // said Keep, did Ignore) -> "Ignore all" (right decision, names the
    // MECHANISM) -> the conclusion, which is both. The button states what
    // the reviewer is asserting; the Opt+I chord states what happens.
    "term sections state their CATEGORY CONCLUSION, not the decision mechanism",
    AMBIGUITY_TIER_ACTIONS.institutional?.strong?.[0]?.label === "These are all institutional terms" &&
      AMBIGUITY_TIER_ACTIONS.calendar?.strong?.[0]?.label === "These are all calendar terms" &&
      AMBIGUITY_TIER_ACTIONS["common-words"]?.strong?.[0]?.label === "These are all words, not names" &&
      (["institutional", "calendar", "common-words"] as const).every((id) => {
        const op = AMBIGUITY_TIER_ACTIONS[id]?.strong?.[0]?.op;
        return op?.kind === "bulk-decision" && op.decision === "Ignore";
      })
  );
  check(
    'the two surviving "leave as-is" Ignore labels are the conclusion-naming pair, kept deliberately (AG: leave them)',
    allActions.filter((a) => a.op.kind === "bulk-decision" && a.op.decision === "Ignore" && KEEP_WORDING.test(a.label)).map((a) => a.label).sort().join("|") ===
      "Not acronyms — leave as-is|Not people — leave as-is"
  );
  // A scope-naming label MUST carry a selected form, or a checked-subset
  // action would render a button reading "all" while changing three items.
  // A conclusion-naming label must NOT -- see SectionAction.selectedLabel.
  check(
    // EXACT, not a word-proxy: the old rule keyed on the literal word
    // "all", which "These are all words, not names" contains while quantifying
    // over "these" rather than claiming the section. And AG's follow-up
    // ("if they happen to process several, the option should exist for the
    // remainder, i.e. 'Selected' as elsewhere built") settled it: EVERY
    // bulk decision carries both voices. accept-suggestions carries
    // neither, because each item takes its own suggestion.
    "every bulk decision declares a selected form; accept-suggestions declares none",
    allActions.every((a) =>
      a.op.kind === "bulk-decision" ? a.selectedLabel === decisionBulkLabel(a.op.decision, "selected") : a.selectedLabel === undefined
    )
  );
  check(
    "selected forms come from the canonical map, never hand-written",
    allActions.every((a) => a.selectedLabel === undefined || (a.op.kind === "bulk-decision" && a.selectedLabel === decisionBulkLabel(a.op.decision, "selected")))
  );
  check("identifiers offer Redact all; Other declares nothing", AMBIGUITY_TIER_ACTIONS.identifiers?.strong?.[0]?.label === "Redact all" && AMBIGUITY_TIER_ACTIONS.other === undefined);
}

// ROWS-THEN-CARDS SEAM (AG, 2026-08-02): the card half of the displayed
// collection. app.ts's post-decision advance continues into
// structuralCardDisplayOrder(...)[first unaddressed] when the row half runs
// out, so this order must equal what renderStructuralRelationships paints:
// kind groups in first-appearance order, input order preserved within each.
{
  const cards = [
    { proposalId: "p1", kind: "acronym" },
    { proposalId: "p2", kind: "numeric-identifier" },
    { proposalId: "p3", kind: "acronym" },
    { proposalId: "p4", kind: "inserted-word-name" },
    { proposalId: "p5", kind: "numeric-identifier" },
  ];
  const order = structuralCardDisplayOrder(cards).map((c) => c.proposalId).join(",");
  check("cards group by kind, kind order = first appearance", order === "p1,p3,p2,p5,p4");
  check("input order preserved within a kind group", structuralCardDisplayOrder([cards[2]!, cards[0]!]).map((c) => c.proposalId).join(",") === "p3,p1");
  check("single kind is a passthrough", structuralCardDisplayOrder(cards.filter((c) => c.kind === "acronym")).map((c) => c.proposalId).join(",") === "p1,p3");
  check("empty input yields empty order", structuralCardDisplayOrder([]).length === 0);
  // Stability: the order is decision-BLIND (it reads only proposalId/kind),
  // the same contract buildTriageSections/buildAmbiguitySections carry --
  // so cards never reorder under the reviewer as decisions land.
  check("order is a permutation of the input, no drops or duplicates", structuralCardDisplayOrder(cards).length === cards.length && new Set(structuralCardDisplayOrder(cards).map((c) => c.proposalId)).size === cards.length);
}

console.log(`\n${passCount}/${passCount + failCount} checks passed`);
process.exitCode = failCount === 0 ? 0 : 1;
