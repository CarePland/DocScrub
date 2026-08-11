/**
 * recommendations.ts -- Reviewer Recommendation UX (2026-07-30, Andrew's
 * prompt; REFINED same day per "Reviewer Recommendation Refinement").
 * The PURE derivation from engine outputs the UI already holds to a
 * reviewer-facing RECOMMENDATION:
 *
 *   1. What DocScrub thinks this probably is  (archetype -> conclusion)
 *   2. What DocScrub recommends doing         (suggestions -- OPTIONAL)
 *   3. Why it thinks that                     (the existing evidence,
 *                                              behind "Why?")
 *
 * GUIDING PRINCIPLE (the refinement, verbatim): "Recommendations should
 * be rare, high-confidence, and immediately useful. If DocScrub does not
 * have a genuinely useful recommendation, it should not invent one simply
 * because a review item exists."
 *
 * Two consequences run through everything below:
 *
 * - DETECTION and RECOMMENDATION are different questions. Detection asks
 *   "should this token be reviewed?"; recommendation asks "do we know
 *   what this most likely refers to?". A review item may exist with no
 *   recommendation at all, or with a conclusion sentence and NO buttons
 *   -- the explanation itself is often sufficient ("Faculty / This looks
 *   more like an institutional term..." + the generic Keep/Ignore).
 *
 * - Suggestion buttons appear ONLY for recognized entities: identity
 *   options backed by curated knowledge (Related name / Acronym / Alias
 *   evidence), or exact-name anchors that clear the recognition gate
 *   below. Phrase completion is not identity resolution -- "Did" -> "Did
 *   Dr" and "Correct" -> "Correct Begin" must derive NOTHING, while
 *   "Andrew" -> "Andrew Goodloe" and "NSC" -> "National Student
 *   Clearinghouse" remain one keystroke away.
 *
 * ARCHETYPES (reviewer-oriented, conclusions verbatim from the prompt):
 *   shortened-name      known first-name reference with a recognized home
 *                       -- the ONLY name archetype that shows buttons
 *   semantic-alias      curated-knowledge alias evidence (buttons)
 *   acronym             acronym/abbreviation (buttons only when a
 *                       knowledge-backed expansion exists)
 *   institutional-term  departments, org names, administrative phrases --
 *                       conclusion only, no buttons
 *   calendar-term       seasons/months/academic periods -- conclusion only
 *   common-word         ordinary English words -- conclusion only
 *   identifier          typed/pattern identifiers -- "________" button
 *                       (high-confidence and genuinely one keystroke)
 *
 * Anything matching none derives null and renders as today. UI/
 * interaction ONLY: nothing here detects, scores, decides, or persists;
 * every input is an already-computed engine fact and every suggestion op
 * names an EXISTING operation.
 *
 * DIGIT COMPATIBILITY: suggestions preserve the identity-option order of
 * whatever subset they surface, and digits 1-9 always target the visible
 * suggestion list first (handleIdentityLinkKey), so a shown button and
 * its digit can never disagree.
 */

import type { AmbiguityProposalGroupOption } from "../engines/EntityResolutionEngine.js";
import type { RelationshipKind } from "../domain/StructuralRelationship.js";
import { INSTITUTIONAL_CATEGORIES } from "../domain/semanticTypes.js";

export type RecommendationArchetype =
  | "shortened-name"
  | "semantic-alias"
  | "acronym"
  | "institutional-term"
  | "calendar-term"
  | "common-word"
  | "identifier"
  // UNCERTAIN DISPOSITION (AG, 2026-08-02): the system is SPECULATING on
  // type -- see the end of deriveRecommendation.
  | "uncertain";

export type SuggestionOp =
  | { kind: "link"; groupId: string }
  | { kind: "keep" }
  | { kind: "ignore" }
  | { kind: "change-to"; replacement: string }
  | { kind: "open-redact-editor" };

export interface RecommendationSuggestion {
  /** The resulting interpretation, verbatim -- never a verb. */
  label: string;
  op: SuggestionOp;
}

export interface ReviewRecommendation {
  archetype: RecommendationArchetype;
  /** The plain-language conclusion sentence. */
  conclusion: string;
  /** Strongest first; digits 1..9 index this list. Often EMPTY -- a
   *  conclusion without buttons is the normal case for term archetypes.
   *  Capped at two on the primary surface. */
  suggestions: RecommendationSuggestion[];
}

/** Everything the derivation needs -- all previously-computed facts. */
export interface RecommendationFacts {
  displayValue: string;
  detectedType: string;
  /** Cleaned name-token count (resolution.ts's personTokens length). */
  personTokenCount: number;
  /** Quality categories (assessment.filterRules/reasons, kebab or snake). */
  categories: readonly string[];
  qualityRecommendation: "ToReview" | "Unlikely";
  /** The candidate's ambiguity options, existing order preserved. */
  identityOptions: readonly AmbiguityProposalGroupOption[];
  /** Structural-relationship kinds this candidate belongs to. */
  relationshipKinds: ReadonlySet<RelationshipKind>;
  /** Refinement (2026-07-30): groupIds whose anchor entity is itself
   *  quality-"Unlikely" -- a phrase-completion bucket ("Did Dr", "Correct
   *  Begin"), not a recognized entity. Options pointing at these are
   *  never suggestion-worthy. Optional: absent means "no vetting data",
   *  which fails OPEN only for knowledge-backed options (see
   *  recognizedOption) and CLOSED for everything else. */
  unrecognizedGroupIds?: ReadonlySet<string>;
}

const norm = (category: string): string => category.replace(/_/g, "-");
const hasCategory = (facts: RecommendationFacts, ...names: string[]): boolean =>
  facts.categories.some((c) => names.includes(norm(c)));

/** The candidate token itself is a recognized name (quality's curated
 *  name dictionaries) -- "Andrew"/"Amy"/"Chris" carry one of these;
 *  "Did"/"Early"/"Correct"/"Good"/"Thanks" do not. The load-bearing gate
 *  separating shortened names from phrase completion. */
const KNOWN_NAME_CATEGORIES = ["known-personal-name-token", "known-first-name", "known-name-structure"];

/**
 * Does this candidate carry POSITIVE name evidence -- a known personal-name
 * token, a known first name, or a recognized name structure?
 *
 * Exported (AG, 2026-08-06) because it is the one signal that separates the
 * two populations "Other" had been pooling: "Kyle" carries it and is a name
 * the app already understands, while "Math" and "Residency" carry none and
 * are words the lexicon simply does not list. Sectioning needs the same
 * answer the archetype derivation uses, so it reads the same predicate
 * rather than re-deriving one that could drift.
 *
 * MEASURED SCOPE (2026-08-07): the premise in that paragraph -- that
 * "Kyle" carries this -- IS FALSE against the live document. The gate is
 * KNOWN_NAME_CATEGORIES, which quality assigns from the curated name
 * dictionaries, and those hold **23 given names and 5 surnames**
 * (`quality-dictionaries.data.ts`: KNOWN_GIVEN_NAMES, KNOWN_SURNAMES).
 * "andrew" and "tamara" are in; "amy", "kyle" and "chris" are not. So this
 * predicate does not currently mean "has name evidence" -- it means "is one
 * of about thirty names we happened to list", and every caller inherits that
 * narrowing silently, because a false answer is indistinguishable from a
 * genuine absence of evidence.
 *
 * The consequence is visible on screen rather than theoretical:
 * `ambiguitySectionFor` sends both Kyle (95% exact first-name match to
 * "Kyle Francis") and Amy (90% to "Amy Miller") into Other Words, where the
 * section's bulk control applies Ignore. See the comment at that return.
 *
 * WHY THE FIX IS NOT "ADD MORE NAMES": widening the dictionaries makes the
 * failure rarer without changing its shape, and the next unlisted surname
 * repeats it -- the same trap the Other Words reframing named one layer up.
 * The evidence that actually settles Kyle and Amy (a high-confidence identity
 * match against a full name found in this document) is computed in the
 * entity-resolution layer and never reaches this function. Any real fix
 * routes that signal in HERE, so the one predicate keeps answering for every
 * caller. Flagged for AG rather than changed unilaterally: widening what
 * counts as name evidence moves items between categories on a shipped
 * surface, which is a product decision.
 */
export function hasKnownNameEvidence(facts: RecommendationFacts): boolean {
  return hasCategory(facts, ...KNOWN_NAME_CATEGORIES);
}

// INSTITUTIONAL_CATEGORIES was a hand-maintained copy of semanticTypeFor's
// list and had drifted from it by one member. It now comes from the single
// domain-layer definition -- see the vocabulary note in domain/semanticTypes.ts
// for why the organization set and document-structure-term are held apart
// there and recombined here. Membership is unchanged; this is a de-duplication,
// not a behavior change.

const CALENDAR_CATEGORIES = ["calendar-term", "calendar-abbreviation", "season-or-academic-term"];

/** Exported (2026-08-09) so residualReviewGate.ts's copy can be asserted
 *  equal to it -- see that module's ORDINARY_LANGUAGE_CATEGORIES for why the
 *  copy exists and why an unchecked one is dangerous. */
export const COMMON_WORD_CATEGORIES = [
  "expanded-common-language-token",
  "common-english-word",
  "common-verb",
  "frequency-saturated",
  "all-common-dictionary-words",
  "greeting-or-courtesy",
  "pronoun-or-determiner",
  "interjection-casual",
  "sentence-fragment",
  "sentence-fragment-word",
];

const knowledgeBacked = (option: AmbiguityProposalGroupOption): boolean =>
  option.evidence?.some((line) => /^(Related name|Acronym|Alias):/.test(line)) ?? false;

/**
 * ANCHOR VETTING, second signal (AG's research question, 2026-08-02:
 * "Andrew Thanks" / "Diana Yes" chips): is this quality-category set
 * NON-NAME evidence? An anchor member carrying interjection/greeting/
 * common-word/verb categories is a name-SHAPED phrase ("Yes, Diana" from
 * "Diana: Yes, ..."), not a person record -- even when its overall
 * quality recommendation is ToReview. Pure and exported for the
 * verification suite.
 *
 * DELIBERATELY NOT COMMON_WORD_CATEGORIES: that list includes
 * "frequency-saturated", which is a FREQUENCY signal, not word-nature
 * evidence -- real speakers ("Perias, Nelly", "Yamada, Tamara") carry it
 * simply by being mentioned often, and vetoing on it killed their
 * legitimate suggestions in the first cut (caught empirically against
 * Andrew's own transcript before shipping). This list names only
 * categories that say "this token is ordinary language".
 */
const NON_NAME_ANCHOR_CATEGORIES = [
  "interjection-casual",
  "greeting-or-courtesy",
  "common-verb",
  "common-english-word",
  "expanded-common-language-token",
  "all-common-dictionary-words",
  "sentence-fragment",
  "sentence-fragment-word",
  "pronoun-or-determiner",
];

export function isNonNameAnchorEvidence(categories: readonly string[]): boolean {
  return categories.some((c) => NON_NAME_ANCHOR_CATEGORIES.includes(norm(c)));
}

/** Minimum option confidence for a non-knowledge anchor to be offered as
 *  a suggestion. Deliberately conservative: a marginal suggestion costs
 *  reviewer trust ("when DocScrub recommends something, it's usually
 *  worth accepting"); a missing one costs a single click into Why?. */
const RECOGNIZED_ANCHOR_MIN_CONFIDENCE = 70;

/**
 * The recognition gate: is this identity option a RECOGNIZED entity, or
 * merely a co-occurring phrase? Knowledge-backed options pass outright
 * (that is what the curated datasets are for). Everything else must be a
 * multi-token anchor, confident enough, and NOT flagged as an
 * unrecognized (quality-Unlikely) entity bucket.
 */
function recognizedOption(facts: RecommendationFacts, option: AmbiguityProposalGroupOption): boolean {
  if (knowledgeBacked(option)) return true;
  if (facts.unrecognizedGroupIds?.has(option.groupId)) return false;
  if (option.confidence < RECOGNIZED_ANCHOR_MIN_CONFIDENCE) return false;
  return option.canonicalName.trim().split(/\s+/).length >= 2;
}

function identitySuggestions(options: readonly AmbiguityProposalGroupOption[]): RecommendationSuggestion[] {
  // Existing order preserved (digit compatibility); primary surface shows
  // at most two -- the rest stay disclosed under "Why?".
  return options.slice(0, 2).map((option) => ({ label: option.canonicalName, op: { kind: "link", groupId: option.groupId } }));
}

/**
 * Derives the recommendation, or null when no archetype fits -- a null
 * renders exactly as today (no conclusion, no suggestions, generic
 * workflow untouched). Precedence is most-specific-first and documented
 * inline; deterministic throughout.
 */
export function deriveRecommendation(facts: RecommendationFacts): ReviewRecommendation | null {
  // Identifier: typed by detection, or grouped by a structural identifier
  // pattern. Redaction is the overwhelmingly likely action -- one blank.
  // Kept as a button archetype: high-confidence by construction and the
  // suggestion genuinely replaces typing.
  if (
    facts.detectedType === "cin" ||
    facts.detectedType === "long_numeric_id" ||
    facts.relationshipKinds.has("numeric-identifier") ||
    facts.relationshipKinds.has("alphanumeric-identifier")
  ) {
    return {
      archetype: "identifier",
      conclusion: "Likely an identifier.",
      suggestions: [{ label: "________", op: { kind: "open-redact-editor" } }],
    };
  }

  // Semantic alias / acronym: curated knowledge backs at least one
  // identity option -- the flagship recognized-entity case. Suggestions
  // surface ONLY the recognized options, order preserved.
  const recognized = facts.identityOptions.filter((o) => recognizedOption(facts, o));
  const aliasBacked = facts.identityOptions.some(knowledgeBacked);
  if (aliasBacked && recognized.length > 0 && facts.personTokenCount >= 1) {
    const primary = recognized[0]!;
    // "Acronym" prefix matches FullValueAliasProvider's KIND_LABELS
    // (trimmed 2026-07-30; keep in sync).
    const acronymFlavored = facts.identityOptions.some((o) => o.evidence?.some((line) => line.startsWith("Acronym"))) || facts.relationshipKinds.has("acronym");
    return {
      archetype: acronymFlavored ? "acronym" : "semantic-alias",
      conclusion: acronymFlavored
        ? "This looks like a likely acronym or abbreviation."
        : `Likely another name for ${primary.canonicalName}.`,
      suggestions: identitySuggestions(recognized),
    };
  }

  // Shortened name: the candidate token is a RECOGNIZED NAME (quality's
  // curated dictionaries) and at least one recognized full-name home
  // exists. Both halves are required -- "Did" (not a known name) derives
  // nothing here even with a "Did Dr" bucket on offer, and "Andrew" with
  // only junk anchors falls through rather than suggesting one. Phrase
  // completion is not identity resolution.
  if (facts.personTokenCount === 1 && hasCategory(facts, ...KNOWN_NAME_CATEGORIES) && recognized.length > 0) {
    return {
      archetype: "shortened-name",
      conclusion: "Likely a shortened reference to a larger name.",
      suggestions: identitySuggestions(recognized),
    };
  }

  // Structural acronym membership / acronym-shaped token WITHOUT a
  // knowledge-backed expansion: name what it is, but recommend nothing --
  // the relationship card (if any) already carries the bulk actions.
  //
  // LEXICALLY AMBIGUOUS ACRONYMS (AG, 2026-08-05, handoff §4): acronym
  // detection is pure shape, so NOTE / NEWS / OPEN / CALENDAR arrive here
  // on capitalization alone. Where quality flagged the token as also being
  // an ordinary word, the CONCLUSION is qualified -- the claim gets weaker,
  // never withdrawn. The archetype stays "acronym" so Type Check bucketing,
  // section grouping and every bulk action are untouched; only the sentence
  // the reviewer reads changes.
  //
  // Conclusion, not chips, deliberately: this branch's `suggestions: []` is
  // a standing decision (the relationship card owns the actions), and the
  // second-disposition chip pair belongs to the single-token term/uncertain
  // branches below. Offering chips here would override that decision rather
  // than extend it -- worth raising with Andrew as its own question if the
  // qualified sentence proves too quiet in real use.
  if (facts.relationshipKinds.has("acronym") || hasCategory(facts, "likely-acronym", "institution-acronym")) {
    return {
      archetype: "acronym",
      conclusion: hasCategory(facts, "acronym-lexically-ambiguous")
        ? "Could be an acronym, or just an ordinary word."
        : "Likely an acronym or abbreviation.",
      suggestions: [],
    };
  }

  // The three TERM archetypes below: the categorical claim is now an
  // ACTIONABLE ① chip rather than a static conclusion sentence (AG,
  // 2026-08-02: "offering a numeric button option in lieu of a static
  // 'I think this is a [blank] type' is more useful, still describes the
  // problem, but simultaneously offers the solution immediately" -- this
  // SUPERSEDES the earlier refinement's "no manufactured Ignore chips"
  // for exactly these archetypes, per Andrew's direct instruction).
  // Accepting the chip applies Ignore -- the same decision the section's
  // own Accept All default takes, so digit 1 / Enter / Accept All all
  // agree. Any RECOGNIZED identity option follows as ② ("Amy Tanesha ...
  // would thus be 2"), keeping the person reading one keystroke away
  // without endorsing it. The conclusion sentence is deliberately EMPTY:
  // the chip label replaces it ("That should be in place of the 'This is
  // probably an ordinary English word...'"). Guards unchanged:
  // single-token, never for dictionary-recognized name tokens.
  // ONE DIGIT SPACE (AG, 2026-08-02, second refinement same day): the
  // term chip is the ONLY header suggestion -- the identity option is
  // deliberately NOT duplicated as a ② chip. It takes digit ② inside the
  // Possible identities list instead (identityDigitAssignments below):
  // "I actually would prefer they have to read the whole thing if they
  // want to select 2."
  const singleTokenNonName = facts.personTokenCount <= 1 && !hasCategory(facts, ...KNOWN_NAME_CATEGORIES);
  /**
   * THE ESCAPE HATCH ON A TERM CONCLUSION (AG, 2026-08-03, from the "Amy"
   * case: "this example should have a 'This is a name' option").
   *
   * A term recommendation OVERRIDES the detector: it says "the detector
   * called this a person, but it is really a common word / calendar term /
   * institutional term." When that override is wrong -- Amy, Grace, Frank,
   * Summer, May -- the reviewer needs to restore the detector's own read in
   * one keystroke, and until now the only route was the generic `Keep
   * as-is` button, which says what happens to the text without saying WHY.
   *
   * This is the same disposition pair the UNCERTAIN branch below already
   * offers (`Person's name` / `Not a name`), and it never reached these
   * items purely because of ORDER: the term checks run first and return,
   * so a single-token person-typed candidate that matched a term category
   * never fell through to the branch that would have offered it. Same
   * vocabulary, same ops, same digit machinery -- only the reachability
   * changed.
   *
   * Gated exactly as that branch is (`personTokenCount <= 1`): one token is
   * the case where a name and an ordinary word are genuinely confusable.
   * Multi-token institutional phrases are not "speculating on type" and
   * still derive nothing extra.
   *
   * The term claim stays FIRST, so it keeps digit ① and remains what every
   * section-level accept applies -- the detector's override is still the
   * recommendation; this only makes disagreeing with it a named action.
   */
  const couldBeAName = facts.detectedType === "person" && facts.personTokenCount <= 1;
  const termRecommendation = (archetype: RecommendationArchetype, claim: string): ReviewRecommendation => ({
    archetype,
    conclusion: "",
    suggestions: couldBeAName
      ? [
          { label: claim, op: { kind: "ignore" } },
          { label: "Person's name", op: { kind: "keep" } },
        ]
      : [{ label: claim, op: { kind: "ignore" } }],
  });

  if (hasCategory(facts, ...INSTITUTIONAL_CATEGORIES) && facts.personTokenCount <= 2) {
    return termRecommendation("institutional-term", "Institutional term");
  }

  if (singleTokenNonName && hasCategory(facts, ...CALENDAR_CATEGORIES)) {
    return termRecommendation("calendar-term", "Calendar / academic term");
  }

  if (singleTokenNonName && hasCategory(facts, ...COMMON_WORD_CATEGORIES)) {
    return termRecommendation("common-word", "Common word");
  }

  // UNCERTAIN DISPOSITION (AG, 2026-08-02, from the "Math" case: "There
  // are certain items that are uncertain and are speculating on type...
  // we really need 1) Person's Name 2) Not a name and.. lower below
  // as-is.. 3) Math option" -- abstracted, per his own ask, to the whole
  // class rather than any specific token): a SINGLE-TOKEN person-typed
  // item that matched no archetype above is exactly the "speculating on
  // type" case -- the detector said "person", nothing recognized it as a
  // term, a name with a home, or an identifier. The two fundamental
  // dispositions become chips ① Person's name (Keep -- the People
  // section's own accept default) and ② Not a name (Ignore); any
  // identity options continue the digit sequence below (③...) via
  // identityDigitAssignments, unduplicated. Multi-token proper names
  // deliberately still derive NOTHING -- they are not type speculation,
  // and "never invent a recommendation because an item exists" still
  // governs them. Tier/bucketing is unchanged: deriveReviewTier treats
  // "uncertain" exactly like a null recommendation, so these items stay
  // in Other / Needs Individual Review rather than being promoted to a
  // Strong Recommendations tier by their own disposition chips.
  //
  // EXTENDED TO EVERY PERSON-TYPED ITEM (AG, 2026-08-03). The token gate
  // above was written when `Ignore` was a button on every row: a
  // multi-token name needed no disposition chip because the reviewer could
  // always just press Ignore. Retiring Ignore as a user option removes that
  // fallback, and "Thanks Andrew", "Good Morning", "Hello All" -- all
  // person-typed, all multi-token, all junk -- would have been left with no
  // way to say "this is not a real thing" at all.
  //
  // So the disposition pair now covers person-typed items regardless of
  // token count. The earlier reasoning ("multi-token proper names are not
  // type speculation") was sound about CONFIDENCE and is preserved where it
  // matters: these items still derive `uncertain`, which deriveReviewTier
  // treats exactly like a null recommendation, so nothing is promoted into
  // a Strong Recommendations tier by having gained a chip.
  //
  // ORDER IS LOAD-BEARING: `Person's name` (Keep) stays FIRST, so
  // `suggestions[0]` -- what applyOwnSuggestions applies on a section-level
  // Accept All -- is unchanged. Without that, adding an Ignore chip here
  // would have turned "Likely People / Accept All Remaining" into a bulk
  // IGNORE of every unrecommended person. The escape hatch is ②, never ①.
  if (facts.detectedType === "person") {
    return {
      archetype: "uncertain",
      conclusion: "",
      suggestions: [
        { label: "Person's name", op: { kind: "keep" } },
        { label: "Not a name", op: { kind: "ignore" } },
      ],
    };
  }

  // THE EXCEPTION ROUTE (AG, 2026-08-03: "Only clear it if the user says
  // it's *not* worth handling. So the one option is 'Not Personal'. That
  // applies to email and phone, and probably anything else").
  //
  // A typed detection that matched no archetype needs exactly ONE thing the
  // buttons cannot express. Its default disposition is already obvious --
  // an email or phone DocScrub found is presumed worth handling, and Redact
  // is a click away -- so the only judgement the app cannot make for the
  // reviewer is "this particular one is not personal at all":
  // scheduling@calstatela.edu, a main switchboard line, a department name.
  //
  // A FIRST DRAFT OFFERED A PAIR (① Personal address / ② Shared or role
  // address) on the theory that a lone chip reads as the app's
  // recommendation. AG overruled it, correctly: ① was functionally
  // identical to the Redact button beside it, so the pair spent a digit and
  // a row of space duplicating an existing control. A single chip is not a
  // recommendation here because it is not offering a disposition -- it is
  // offering an EXIT from the presumed one.
  //
  // Deliberately the LAST branch and deliberately type-agnostic: every
  // detected type that reaches here needs the same escape, and enumerating
  // them would mean a new type silently shipping without one.
  //
  // `suggestions[0]` being an Ignore is safe by placement, not by luck --
  // these items land in Other / Needs Individual Review, which declares no
  // section-level accept on either queue, and Type Check's bulk bar is
  // explicit buttons rather than an accept-the-suggestion path. No bulk
  // route can apply it on the reviewer's behalf.
  //
  // The PERSON branch above deliberately keeps its two-chip shape: there ①
  // "Person's name" is load-bearing, because it is `suggestions[0]` and
  // therefore what a section-level Accept All applies. Collapsing it would
  // turn "Likely People -> Accept All Remaining" into a bulk Ignore of
  // every unrecommended person.
  return {
    archetype: "uncertain",
    conclusion: "",
    suggestions: [{ label: "Not personal", op: { kind: "ignore" } }],
  };
}

/*
 * ============================================================================
 * ONE DIGIT SPACE PER ITEM (AG, 2026-08-02: "if there is an Any Tanesha
 * button.. and a Possible Identity.. with differing numbers, that is an
 * issue"). Digits 1..S are the header suggestion chips; the Possible
 * identities list CONTINUES the sequence rather than restarting at 1.
 * An option that IS one of the header chips (a link suggestion with the
 * same groupId) reuses that chip's digit -- header and list can never
 * disagree about what a number means. An option not in the header takes
 * the next digit after the chips; past ⑨ it stays click-selectable,
 * unnumbered. Both consumers (renderPossibleIdentities and
 * handleIdentityLinkKey) derive from THIS one function -- the digit a
 * reviewer sees and the digit the keyboard acts on cannot drift.
 * ============================================================================
 */

export interface IdentityDigitAssignment {
  option: AmbiguityProposalGroupOption;
  /** The digit shown/typed for this option, or null (past ⑨). */
  digit: number | null;
}

export function identityDigitAssignments(
  recommendation: ReviewRecommendation | null,
  options: readonly AmbiguityProposalGroupOption[],
  // COLLISION RULE (AG, 2026-08-02, section-action digits): the section
  // buttons of the item's own scope reserve digits DOWNWARD from ⑨, and
  // when the two populations meet the ITEM side truncates first -- so the
  // caller lowers this ceiling by the reserved count (triageQueue.ts's
  // itemDigitCeilingBeside). Default 9 preserves every pre-existing call
  // and every surface with no section actions beside it. An option past
  // the ceiling stays click/Enter-selectable, just unnumbered -- exactly
  // what already happened past ⑨.
  ceiling = 9
): IdentityDigitAssignment[] {
  const suggestions = recommendation?.suggestions ?? [];
  const linkDigits = new Map<string, number>();
  suggestions.forEach((s, i) => {
    if (s.op.kind === "link") linkDigits.set(s.op.groupId, i + 1);
  });
  let next = suggestions.length + 1;
  return options.map((option) => {
    const matched = linkDigits.get(option.groupId);
    if (matched !== undefined) return { option, digit: matched };
    const digit = next <= ceiling ? next : null;
    next += 1;
    return { option, digit };
  });
}

/*
 * ============================================================================
 * REVIEW CONFIDENCE TIERS (AG, 2026-08-02, "categories currently assume a
 * single level of reviewer confidence"). A REUSABLE, category-agnostic
 * second axis beside the archetype: how much reviewer EFFORT an item
 * deserves -- "these recommendations are probably correct" vs "these
 * deserve a closer look". Deliberately about reviewer effort, not
 * detector confidence: no score thresholds appear here, and none of the
 * internal category names leak to the UI (labels live in triageQueue.ts).
 *
 * The derivation is a pure companion to deriveRecommendation over the
 * SAME facts, so tier assignment is decision-blind (rows never change
 * tier when decided -- the sectioned queue's standing stability
 * contract).
 * ============================================================================
 */

export type ReviewTier = "strong" | "needs-review";

/**
 * Which tier an item belongs to, or null when it has no category home at
 * all (the "Other / Needs Individual Review" bucket).
 *
 * - A recommendation WITH suggestion buttons cleared the recognition
 *   gate above -- ready for rapid review: "strong".
 * - The term archetypes and identifiers carry their whole recommendation
 *   in the conclusion (no buttons BY DESIGN, not for lack of
 *   confidence): "strong".
 * - A recommendation whose suggestions came back empty (e.g. an
 *   acronym-shaped token with no knowledge-backed expansion) named what
 *   the item IS but not what to do: "needs-review".
 * - NO archetype, but the token is a RECOGNIZED NAME with identity
 *   options that merely failed the recognition gate ("Julie" with only
 *   junk anchors): the person question is real even though no expansion
 *   is recommendable -- "needs-review", surfaced by the caller under the
 *   person-name category rather than dumped in "Other". This is the
 *   "a shortened name should not force the reviewer to either accept an
 *   expansion or reject the person entirely" case.
 * - Everything else: null (individual review).
 */
export function deriveReviewTier(facts: RecommendationFacts, recommendation: ReviewRecommendation | null): ReviewTier | null {
  // UNCERTAIN DISPOSITION (AG, 2026-08-02): the disposition chips exist
  // BECAUSE the system is speculating -- they must not promote the item
  // into a Strong tier. Tier-wise, "uncertain" is a null recommendation.
  if (recommendation && recommendation.archetype !== "uncertain") {
    if (recommendation.suggestions.length > 0) return "strong";
    const conclusionIsTheRecommendation =
      recommendation.archetype === "institutional-term" ||
      recommendation.archetype === "calendar-term" ||
      recommendation.archetype === "common-word" ||
      recommendation.archetype === "identifier";
    return conclusionIsTheRecommendation ? "strong" : "needs-review";
  }
  const possiblePerson =
    facts.detectedType === "person" && facts.personTokenCount >= 1 && hasCategory(facts, ...KNOWN_NAME_CATEGORIES) && facts.identityOptions.length > 0;
  return possiblePerson ? "needs-review" : null;
}
