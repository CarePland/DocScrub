/**
 * triageQueue.ts -- Triage Queue review mode (2026-07-30, Andrew's
 * "Implementation request -- Triage Queue review mode").
 *
 * The PURE sectioning policy for Item Check's third view mode: given each
 * candidate's already-derived recommendation archetype (recommendations.ts
 * -- generation is UNCHANGED by this feature) and detected type, assign it
 * to one reviewer-facing section and produce the section-ordered queue.
 *
 * Design notes:
 * - Sections exist so the EXPLANATION lives once, in the heading, instead
 *   of repeating per row ("avoid repeating identical explanatory text
 *   hundreds of times") -- a row inside "Other Words" needs no sentence.
 * - Section assignment uses the archetype derived AS IF the item were
 *   undecided (app.ts passes that), so a row does not jump to a different
 *   section the moment it is accepted -- completed items stay put, in
 *   place, with a green check ("avoid removing rows immediately").
 * - Input order is preserved within each section, so the flat queue order
 *   (sections concatenated) is stable across decisions -- the same
 *   stability contract every visible-list advance feature relies on.
 */

import type { RecommendationArchetype, ReviewTier } from "./recommendations.js";
// The single source of the reviewer-facing bulk vocabulary -- see
// `bulkScoped` below for why these labels are derived, not authored here.
import { decisionBulkLabel } from "./decisionLabels.js";

export type TriageSectionId =
  | "people"
  | "acronyms"
  | "identifiers"
  | "institutional"
  | "calendar"
  | "common-words"
  | "other";

/**
 * WHICH USER-FACING CATEGORY A RELATIONSHIP PROPOSAL BELONGS TO
 * (AG, 2026-08-06).
 *
 * Andrew, ruling out the separate-category design that preceded this:
 *
 * > Users do not care that one is a candidate review and the others are
 * > relationship proposals. ... Please do not rename or create additional
 * > user-facing categories to reflect internal object types. Candidate
 * > reviews and relationship proposals are implementation details. The
 * > navigation taxonomy should reflect the user's work, not the underlying
 * > data structures.
 *
 * So a proposal lands in the category a reviewer would look for it in. The
 * ITS/PERC/QBU pairs are acronym work and belong beside the singleton
 * acronym candidate; identifier-shaped pairs are Numeric work.
 * `inserted-word-name` goes to "other" rather than an identity section on
 * Andrew's call: a probable name with an inserted word is genuinely
 * ambiguous work that wants individual review, not a bulk conclusion.
 *
 * Keyed by RelationshipKind but typed against the TRIAGE ids, which the
 * Ambiguity ids reuse verbatim for exactly these four -- so one map serves
 * both stages and neither can drift from the other.
 */
export const RELATIONSHIP_KIND_SECTION: Record<string, TriageSectionId> = {
  acronym: "acronyms",
  "numeric-identifier": "identifiers",
  "alphanumeric-identifier": "identifiers",
  "inserted-word-name": "other",
};

/** Display order (Triage refinement, 2026-07-30: reviewer-decision
 *  order per Andrew's prompt -- People first, term sections together,
 *  identifiers before the structural section app.ts appends last). */
export const TRIAGE_SECTION_ORDER: readonly TriageSectionId[] = [
  "people",
  "acronyms",
  "institutional",
  "calendar",
  "common-words",
  "identifiers",
  "other",
];

/** CATEGORY-FIRST REVIEW (AG, 2026-07-30): the category is the decision;
 *  the items are the evidence. Reviewer-facing semantic names. */
export const TRIAGE_SECTION_LABELS: Record<TriageSectionId, string> = {
  people: "Likely People",
  acronyms: "Acronyms",
  identifiers: "Identifier Patterns",
  institutional: "Institutional Terminology",
  calendar: "Temporal / Calendar Terms",
  "common-words": "Common English Words",
  other: "Other / Needs Individual Review",
};

/** The heading communicates the conclusion ONCE -- rows never repeat it. */
export const TRIAGE_SECTION_EXPLANATIONS: Partial<Record<TriageSectionId, string>> = {
  people: "Likely personal names.",
  acronyms: "Likely acronyms or abbreviations.",
  identifiers: "Identifiers -- typically redacted.",
  institutional: "Likely departments, organizations, systems, institutions, or common organizational terminology.",
  calendar: "Likely academic terms or calendar periods.",
  "common-words": "Likely ordinary English words rather than names.",
  other: "Items without a category conclusion -- reviewed individually.",
};

/** Accept All (Triage refinement): sections representing one broad
 *  conclusion offer a section-level accept. The value is the decision
 *  the section's conclusion implies for items WITHOUT their own
 *  recommendation (items with one accept that instead -- agreeing with
 *  DocScrub item-by-item). Identifier sections have no entry: their
 *  accept path runs through the Redact editor and needs the reviewer. */
export const TRIAGE_SECTION_ACCEPT_DEFAULT: Partial<Record<TriageSectionId, "Keep" | "Ignore">> = {
  people: "Keep",
  institutional: "Ignore",
  calendar: "Ignore",
  "common-words": "Ignore",
};

export function triageSectionFor(
  archetype: RecommendationArchetype | null,
  detectedType: string
): TriageSectionId {
  switch (archetype) {
    case "shortened-name":
    case "semantic-alias":
      return "people";
    case "acronym":
      return "acronyms";
    case "identifier":
      return "identifiers";
    case "institutional-term":
      return "institutional";
    case "calendar-term":
      return "calendar";
    case "common-word":
      return "common-words";
    // UNCERTAIN DISPOSITION (AG, 2026-08-02): the disposition chips do
    // not move the item -- section-wise, "uncertain" is a null archetype.
    case "uncertain":
    case null:
      return detectedType === "person" ? "people" : "other";
  }
}

export interface TriageQueueItem {
  id: string;
  archetype: RecommendationArchetype | null;
  detectedType: string;
}

export interface TriageSection {
  id: TriageSectionId;
  label: string;
  candidateIds: string[];
}

/** Sections in display order, empty sections omitted; input order
 *  preserved within each section. */
export function buildTriageSections(items: readonly TriageQueueItem[]): TriageSection[] {
  const byId = new Map<TriageSectionId, string[]>();
  for (const item of items) {
    const section = triageSectionFor(item.archetype, item.detectedType);
    const list = byId.get(section);
    if (list) list.push(item.id);
    else byId.set(section, [item.id]);
  }
  return TRIAGE_SECTION_ORDER.filter((id) => byId.has(id)).map((id) => ({
    id,
    label: TRIAGE_SECTION_LABELS[id],
    candidateIds: byId.get(id)!,
  }));
}

/** The flat queue order -- what visibleItemCheckIds returns in triage
 *  mode, so arrow keys and post-decision auto-advance walk the queue in
 *  exactly the order it is displayed. */
export function triageQueueOrder(items: readonly TriageQueueItem[]): string[] {
  return buildTriageSections(items).flatMap((section) => section.candidateIds);
}

/*
 * ============================================================================
 * AMBIGUITY CHECK CATEGORY-FIRST (AG, 2026-08-02, "Ambiguity Check should
 * evolve using the same design philosophy as the new Item Check ... The
 * ambiguity class is the review unit. The individual candidates are the
 * evidence."). PRESENTATION-ONLY: a second section vocabulary over the
 * SAME already-derived recommendation archetypes -- detection, matching,
 * persistence, and audit are untouched by construction (this module maps
 * pre-computed facts to headings; it dispatches nothing).
 *
 * Deliberate divergences from the Item Check triage mapping, both
 * ambiguity-specific:
 *
 * 1. The person-identity archetypes SPLIT instead of pooling into one
 *    "Likely People" section: shortened-name -> "Shortened Person Names";
 *    semantic-alias -> "Nicknames / Alternate Names" or "Organizational
 *    Aliases" by the knowledge flavor behind the suggestion (the caller
 *    derives `aliasFlavor` from the option evidence lines the providers
 *    already emit -- "Related name..." vs "Alias: ..."). In Ambiguity the
 *    identity RELATIONSHIP is the thing under review, so its kind is the
 *    natural section; in Item Check the item is, so "people" suffices.
 *
 * 2. A null archetype maps to "other" EVEN for detectedType "person" --
 *    unlike triageSectionFor's null->people case. Andrew's own observation
 *    (2026-08-02): "many of the 'person' classified items are clearly not
 *    people." In this stage a person-typed candidate with NO derivable
 *    conclusion is exactly the phrase-completion junk ("Did", "Correct",
 *    "And") that must NOT be presented as a person-name section the
 *    reviewer is invited to bulk-accept; it belongs under "Needs
 *    Individual Review". The common-word/calendar/institutional archetypes
 *    still rescue most of that junk into bulk-Ignorable term sections.
 * ============================================================================
 */

/** Knowledge flavor behind a semantic-alias suggestion, derived by the
 *  caller from the suggested option's evidence lines (RelatedNameProvider
 *  emits "Related name...", FullValueAliasProvider "Alias: ..."). Null =
 *  no flavor known; treated as a nickname (the person-flavored default,
 *  since semantic-alias conclusions read "another name for X"). */
export type AliasFlavor = "nickname" | "org-alias" | null;

export interface AmbiguityQueueItem {
  id: string;
  archetype: RecommendationArchetype | null;
  detectedType: string;
  aliasFlavor: AliasFlavor;
  /** REVIEW CONFIDENCE TIERS (AG, 2026-08-02): the reviewer-effort tier
   *  (recommendations.ts's deriveReviewTier) -- decision-blind, like the
   *  archetype, so neither the section nor the tier of a row ever moves
   *  once decided. Null = no category home (the "other" bucket). */
  tier: ReviewTier | null;
  /** POSITIVE name evidence (recommendations.ts's hasKnownNameEvidence) --
   *  what tells a name the app understands from a word it merely does not
   *  recognize. See the uncertain branch of ambiguitySectionFor. */
  nameEvidence: boolean;
}

export type AmbiguitySectionId =
  | "shortened-names"
  | "nicknames"
  | "org-aliases"
  | TriageSectionId; // acronyms / identifiers / institutional / calendar / common-words / other reused verbatim ("people" never assigned here)

/** Identity sections first (the stage's namesake work), term sections
 *  together, identifiers last before the structural kind groups app.ts
 *  appends after the queue -- mirroring the triage ordering rationale. */
/** IDENTIFIERS MOVED ABOVE COMMON-WORDS (AG, 2026-08-06), with the rest of
 *  the shortened-label pass: his own ordering put Numeric before Common
 *  Words. Term sections still sit together; this only reorders within
 *  them. */
export const AMBIGUITY_SECTION_ORDER: readonly AmbiguitySectionId[] = [
  "shortened-names",
  "nicknames",
  "org-aliases",
  "acronyms",
  "institutional",
  "calendar",
  "identifiers",
  "common-words",
  "other",
];

/**
 * SHORTENED FOR THE PILL BAR (AG, 2026-08-06), his list verbatim:
 * "Shortened Names / Other Names / Acronyms / Institutional / Time
 * Calendar / Numeric / Other Words / Other".
 *
 * AMBIGUITY-ONLY OVERRIDES, DELIBERATELY. Five of these labels
 * (institutional, calendar, common-words, identifiers, other) are inherited
 * from TRIAGE_SECTION_LABELS by the spread below, so shortening them AT THE
 * SOURCE would have renamed Item Check's categories too -- a surface he did
 * not ask about and whose headings have room for the long form. The cost is
 * that the same section id now reads differently on two stages; that is
 * acceptable because the label is presentation and the id is the identity,
 * but a third stage wanting a third name should make this a per-stage
 * lookup rather than a second spread.
 *
 * "Numeric" over "Identifier Patterns": he named the category after what a
 * reviewer SEES in it, not after the detector that found it.
 */
export const AMBIGUITY_SECTION_LABELS: Record<AmbiguitySectionId, string> = {
  ...TRIAGE_SECTION_LABELS,
  "shortened-names": "Shortened Names",
  nicknames: "Other Names",
  "org-aliases": "Org Names",
  acronyms: "Acronyms",
  institutional: "Institutional",
  calendar: "Time / Calendar",
  identifiers: "Numeric",
  "common-words": "Other Words",
  other: "Other",
};

export const AMBIGUITY_SECTION_EXPLANATIONS: Partial<Record<AmbiguitySectionId, string>> = {
  ...TRIAGE_SECTION_EXPLANATIONS,
  "shortened-names": "These appear to be shortened references to longer person names.",
  nicknames: "These appear to be alternate or familiar names for the same person.",
  "org-aliases": "These appear to be alternate names for the same organization.",
  acronyms: "These appear to be acronym relationships.",
  /* OTHER WORDS OVERRIDES THE INHERITED EXPLANATION (AG, 2026-08-07).
   * The spread above brings "Likely ordinary English words rather than
   * names" from TRIAGE_SECTION_EXPLANATIONS, which is the DICTIONARY
   * MEMBERSHIP claim the Other Words reframing exists to stop making --
   * it survived the 2026-08-06 rename because the rename touched the
   * LABEL map and not this one. Kept correct on Item Check, where
   * `triageSectionFor` really does route only `archetype ===
   * "common-word"` here and the dictionary claim is the actual model;
   * overridden on Ambiguity, where the population is "no name evidence"
   * and asserting an English-lexicon entry would be false of every item
   * that arrived by falling through. */
  "common-words": "Words rather than names -- no name evidence was found for these.",
  other: "Ambiguous items without a category conclusion -- reviewed individually.",
};

/** Accept All policy config -- still the Item Check Triage view's
 *  mechanism (suggestion-first with a fallback decision). The Ambiguity
 *  categories moved to the richer tier-action vocabulary below
 *  (AMBIGUITY_TIER_ACTIONS) on 2026-08-02; triage deliberately keeps
 *  this hybrid semantic until Andrew asks it to adopt tiers too. */
export interface AcceptAllConfig {
  fallback?: "Keep" | "Ignore";
  recommendationsOnly?: boolean;
}

/*
 * ============================================================================
 * REVIEW CONFIDENCE TIERS + CATEGORY ACTION VOCABULARIES (AG, 2026-08-02,
 * "introduce a reusable concept of review confidence tiers within a
 * category ... Categories should describe their available reviewer
 * actions. The UI should render them.").
 *
 * DATA, NOT CODE: each category optionally partitions into tiers
 * ("Strong Recommendations" / "Needs Review") and declares, PER TIER,
 * the bulk actions a reviewer may take -- each action a human-language
 * label over a tag naming an EXISTING operation (accept each item's own
 * suggestion, or one bulk Keep/Ignore/Redact decision). The renderer
 * contains no category-specific logic; future ambiguity categories gain
 * tiers by adding entries here, never by touching the renderer.
 *
 * LANGUAGE RULE (from the prompt): labels are reviewer decisions ("Use
 * full names", "Keep abbreviations"), never implementation concepts
 * ("Expand", "Apply relationship").
 *
 * DISCLOSED SCOPE TRIM: the prompt's example actions of the form "Not
 * acronym relationships" / "Not institutional terminology" -- rejecting
 * the CATEGORIZATION itself without deciding the items -- have no
 * existing command semantics for candidate rows (relationship DISMISSAL
 * exists only for structural proposals). Where the reviewer's intent
 * maps to an existing decision it is offered ("Not people -- leave
 * as-is" = the Ignore decision, exactly today's not-PII semantics);
 * a pure "un-categorize, decide nothing" action would need a new durable
 * state and is flagged for Andrew rather than invented here.
 * ============================================================================
 */

export type ReviewTierId = ReviewTier; // "strong" | "needs-review"

export const REVIEW_TIER_LABELS: Record<ReviewTierId, string> = {
  strong: "Strong Recommendations",
  "needs-review": "Needs Review",
};

/** Tooltip-level framing, straight from the design philosophy -- the UI
 *  may surface these as title attributes, never as body copy. */
export const REVIEW_TIER_HINTS: Record<ReviewTierId, string> = {
  strong: "These recommendations are probably ready to accept.",
  "needs-review": "These deserve a closer look.",
};

/** What a section action DOES -- a tag naming an existing operation,
 *  resolved by the UI host (app.ts) to the same dispatch paths every
 *  button already uses. "Redact" applies the default placeholder (the
 *  same as confirming the Redact editor blank). */
export type SectionActionOp = { kind: "accept-suggestions" } | { kind: "bulk-decision"; decision: "Keep" | "Ignore" | "Redact" };

export interface SectionAction {
  label: string;
  op: SectionActionOp;
  /** Tooltip explaining the outcome in full sentences. */
  hint: string;
  /**
   * The label to use when the button acts on a CHECKED SUBSET rather than
   * every remaining item (AG, 2026-08-03, row selection).
   *
   * EVERY bulk-decision action has one, derived from the canonical map.
   * The earlier rule -- only "scope-naming" labels get a selected form,
   * conclusion-naming ones are scope-neutral and keep their wording --
   * was wrong twice over. It keyed on the literal word "all", which
   * "These are all words, not names" contains while quantifying over
   * "these" rather than claiming the section. And it left a checked subset with a
   * button reading like a claim about everything: AG, "if they happen to
   * process several, the option should exist for the remainder, i.e.
   * 'Selected' as elsewhere built."
   *
   * So the two voices split by SCOPE, not by label style:
   *   - nothing checked -> the authored label, stating the category
   *     conclusion over all remaining work ("These are all words, not names");
   *   - a subset checked -> the canonical action voice ("Ignore selected"),
   *     because a conclusion asserted over a hand-picked subset is no
   *     longer telling the reviewer anything they did not just decide,
   *     while what HAPPENS to those items still is.
   *
   * `accept-suggestions` has none: each item takes its OWN suggestion, so
   * there is no single decision to name in either voice.
   */
  selectedLabel?: string;
}

const act = (label: string, op: SectionActionOp, hint: string): SectionAction => ({ label, op, hint });
const acceptSuggestions = (label: string, hint: string): SectionAction => act(label, { kind: "accept-suggestions" }, hint);
/** Every bulk action carries both voices: the authored label for "all
 *  remaining", the canonical one for a checked subset. */
const bulk = (label: string, decision: "Keep" | "Ignore" | "Redact", hint: string): SectionAction => ({
  label,
  op: { kind: "bulk-decision", decision },
  hint,
  selectedLabel: decisionBulkLabel(decision, "selected"),
});

/**
 * A bulk action whose label is the DECISION'S OWN canonical bulk wording,
 * both scope forms derived from `decisionLabels.ts` (AG, 2026-08-03).
 *
 * This replaced the hand-written `bulk("Leave all as-is", "Ignore", ...)`
 * on the institutional / calendar / common-words sections. That label was
 * a genuine defect, not a style preference: it dispatched **Ignore** while
 * wearing the words of **Keep as-is** -- and every one of those sections
 * renders `[Keep as-is] [Change] [Redact] [Ignore]` as four distinct
 * decisions on the very cards underneath it. Same words, different
 * decision, one screen. It also contradicted the unified decision color
 * system: pressing "Leave all as-is" turned the section Ignore-purple.
 *
 * `DECISION_BULK_ALL_LABEL` / `DECISION_BULK_SELECTED_LABEL` already
 * existed for exactly this and this call site simply wasn't consulting
 * them -- so the fix is "derive, don't duplicate" rather than a new
 * vocabulary. A future decision kind gets both scope forms here for free.
 *
 * Now just `bulk` with the canonical label: the selected voice moved onto
 * `bulk` itself once every bulk action gained one. Kept as its own name
 * because "this action has no conclusion to state, only a decision" is a
 * real property of a vocabulary entry -- Redact all is the case.
 */
const bulkScoped = (decision: "Keep" | "Ignore" | "Redact", hint: string): SectionAction =>
  bulk(decisionBulkLabel(decision, "all"), decision, hint);

/** Per category, per tier: the reviewer's bulk vocabulary. A category
 *  absent here (or a tier absent within it) offers no bulk actions --
 *  its items are individual work ("other"). */
export const AMBIGUITY_TIER_ACTIONS: Partial<Record<AmbiguitySectionId, Partial<Record<ReviewTierId, SectionAction[]>>>> = {
  "shortened-names": {
    strong: [
      acceptSuggestions("Use full names", "Each remaining item takes its own suggested full name."),
      bulk("Keep shortened names", "Keep", "Keep every remaining item exactly as written."),
      bulkScoped("Redact", "Redact every remaining item with the default placeholder."),
    ],
    "needs-review": [
      bulk("These are people's names", "Keep", "Treat every remaining item as a person's name, kept as written."),
      bulk("Not people — leave as-is", "Ignore", "Treat every remaining item as not a person reference; the text is left alone."),
      bulkScoped("Redact", "Redact every remaining item with the default placeholder."),
    ],
  },
  nicknames: {
    strong: [
      acceptSuggestions("Use primary names", "Each remaining item takes the name it appears to be an alternate for."),
      bulk("Keep as written", "Keep", "Keep every remaining item exactly as written."),
    ],
  },
  "org-aliases": {
    strong: [
      acceptSuggestions("Use full organization names", "Each remaining item takes its full organization name."),
      bulk("Keep as written", "Keep", "Keep every remaining item exactly as written."),
    ],
  },
  acronyms: {
    strong: [
      acceptSuggestions("Use written-out forms", "Each remaining item takes its own written-out form."),
      bulk("Keep abbreviations", "Keep", "Keep every remaining item exactly as written."),
      bulkScoped("Redact", "Redact every remaining item with the default placeholder."),
    ],
    "needs-review": [
      bulk("Keep abbreviations", "Keep", "Keep every remaining item exactly as written."),
      bulk("Not acronyms — leave as-is", "Ignore", "Treat every remaining item as ordinary text; nothing is changed."),
    ],
  },
  institutional: {
    strong: [
      bulk(
        "These are all institutional terms",
        "Ignore",
        "Treat every remaining item as institutional terminology, not personal information."
      ),
      bulkScoped("Redact", "Redact every remaining item with the default placeholder."),
    ],
  },
  calendar: {
    strong: [bulk("These are all calendar terms", "Ignore", "Treat every remaining item as calendar terminology, not personal information.")],
  },
  /* THE LABEL FOLLOWS THE CATEGORY, NOT THE OLD ONE (AG, 2026-08-07).
   * "These are all common words" asserted DICTIONARY MEMBERSHIP over a
   * population that is now defined by the ABSENCE of name evidence -- the
   * exact claim the Other Words rename retired one map away, left behind
   * here because the rename changed AMBIGUITY_SECTION_LABELS and nothing
   * else. The conclusion shape ("These are all ...") is preserved because
   * the term sections share it; only the claim narrows to what the
   * sectioning predicate actually decided. */
  "common-words": {
    strong: [bulk("These are all words, not names", "Ignore", "Treat every remaining item as a word rather than a person's name; the text is left alone.")],
  },
  identifiers: {
    strong: [bulkScoped("Redact", "Redact every remaining item with the default placeholder.")],
  },
};

export function ambiguitySectionFor(item: AmbiguityQueueItem): AmbiguitySectionId {
  switch (item.archetype) {
    case "shortened-name":
      return "shortened-names";
    case "semantic-alias":
      return item.aliasFlavor === "org-alias" ? "org-aliases" : "nicknames";
    case "acronym":
      return "acronyms";
    case "identifier":
      return "identifiers";
    case "institutional-term":
      return "institutional";
    case "calendar-term":
      return "calendar";
    case "common-word":
      return "common-words";
    // UNCERTAIN DISPOSITION (AG, 2026-08-02): the disposition chips do
    // not move the item -- section-wise, "uncertain" is a null archetype.
    case "uncertain":
    case null:
      // TIERS (2026-08-02): a recognized-name person with identity options
      // that merely failed the recognition gate is the person-name
      // category's Needs Review work ("a shortened name should not force
      // the reviewer to either accept an expansion or reject the person
      // entirely"), not "Other" junk. Everything else stays "other"
      // (divergence 2 above: never a bulk-acceptable people section).
      /* OTHER WORDS (AG, 2026-08-06). "Other" had become the sink for two
       * unrelated populations, and Andrew spotted it from the outside:
       * "Can you take a look at the Other category? These seem.. curious
       * choices" -- Kyle beside Math and Residency.
       *
       * They arrive by the same route (person-typed, no archetype matched)
       * but they are not the same thing. Kyle carries POSITIVE name
       * evidence and a 95% identity match; it is a name the app already
       * understands and belongs with the names. Math and Residency carry
       * none -- they are ordinary words that the quality dictionary simply
       * does not list, which is a LEXICON GAP, not a judgement call, and
       * parking them under "needs individual review" asked the reviewer to
       * adjudicate our missing data.
       *
       * So the split is on evidence, not on tier: name evidence goes to the
       * names family, everything else person-typed goes to Other Words.
       *
       * WHY THAT CATEGORY WORKS -- Andrew's own reframing: "Common English
       * Words" asserts DICTIONARY MEMBERSHIP, so it can only ever hold what
       * the lexicon knows and every gap falls through. "Other Words"
       * asserts only "this is a word, not a name," which Math and Residency
       * satisfy with no dictionary entry at all. The category stops being
       * coupled to lexicon coverage, so the next unlisted word lands right
       * instead of repeating this.
       *
       * `tier === "needs-review"` is no longer consulted here: it was a
       * proxy for "has something worth reviewing" that name evidence
       * answers directly, and it sent Kyle -- tier "Likely" -- to Other.
       *
       * THE SPLIT IS ONLY AS GOOD AS THE PREDICATE, AND THE PREDICATE IS
       * CURRENTLY TOO NARROW (verified live 2026-08-07 against the Teams
       * transcript, NOT reasoned from source). Kyle -- the worked example
       * two paragraphs up -- does NOT reach "shortened-names". It is in
       * Other Words, because `hasKnownNameEvidence` gates on the quality
       * name dictionaries and KNOWN_GIVEN_NAMES holds 23 entries and
       * KNOWN_SURNAMES 5. "kyle" is in neither, so the predicate answers
       * false however strong the other evidence is: Kyle carries a 95%
       * exact first-name match to "Kyle Francis" and still files as a
       * word. Amy is the sharper case -- source text "im so surprised
       * [Amy] doesn't know how to answer her own Staff questions", a 90%
       * match to "Amy Miller" -- and it lands in the STRONG tier here,
       * inside the blast radius of the section's bulk Ignore.
       *
       * So the REASONING above is intact and the ROUTING is not: this
       * reads "no name evidence" where the truth is "no name evidence THE
       * LEXICON KNOWS ABOUT", which is the coupling to lexicon coverage
       * the reframing was supposed to end -- moved one layer down rather
       * than removed. The document-level identity evidence that makes
       * Kyle and Amy obviously names is computed elsewhere and never
       * consulted here. See the handoff's OPEN list before widening: the
       * fix is a predicate question, not a sectioning one, and touching
       * this return without touching hasKnownNameEvidence would just move
       * the same defect again. */
      if (item.detectedType !== "person") return "other";
      return item.nameEvidence ? "shortened-names" : "common-words";
  }
}

export interface AmbiguityTierGroup {
  id: ReviewTierId;
  label: string;
  hint: string;
  candidateIds: string[];
}

export interface AmbiguitySection {
  id: AmbiguitySectionId;
  label: string;
  /** All items, in displayed order (tier groups concatenated). */
  candidateIds: string[];
  /** Populated tiers in display order (strong first), empties omitted.
   *  A section whose items carry no tier (the "other" bucket) has one
   *  untiered group under a null id via `untiered` below instead. */
  tiers: AmbiguityTierGroup[];
}

/** Sections in display order, empty sections omitted; within a section,
 *  Strong Recommendations precede Needs Review; input order preserved
 *  within each tier (the same stability contract as buildTriageSections
 *  -- rows never move when decided, because both the section and the
 *  tier are decision-blind). */
export function buildAmbiguitySections(items: readonly AmbiguityQueueItem[]): AmbiguitySection[] {
  const TIER_ORDER: readonly ReviewTierId[] = ["strong", "needs-review"];
  const byId = new Map<AmbiguitySectionId, Map<ReviewTierId | "untiered", string[]>>();
  for (const item of items) {
    const section = ambiguitySectionFor(item);
    const tierKey: ReviewTierId | "untiered" = item.tier ?? "untiered";
    const tiers = byId.get(section) ?? new Map<ReviewTierId | "untiered", string[]>();
    const list = tiers.get(tierKey) ?? [];
    list.push(item.id);
    tiers.set(tierKey, list);
    byId.set(section, tiers);
  }
  return AMBIGUITY_SECTION_ORDER.filter((id) => byId.has(id)).map((id) => {
    const tiersById = byId.get(id)!;
    const tiers: AmbiguityTierGroup[] = TIER_ORDER.filter((t) => tiersById.has(t)).map((t) => ({
      id: t,
      label: REVIEW_TIER_LABELS[t],
      hint: REVIEW_TIER_HINTS[t],
      candidateIds: tiersById.get(t)!,
    }));
    const untiered = tiersById.get("untiered") ?? [];
    return {
      id,
      label: AMBIGUITY_SECTION_LABELS[id],
      candidateIds: [...tiers.flatMap((t) => t.candidateIds), ...untiered],
      tiers,
    };
  });
}

/** The displayed flat order -- what the Ambiguity stage's arrow keys and
 *  post-decision advance walk, exactly as rendered. */
export function ambiguityQueueOrder(items: readonly AmbiguityQueueItem[]): string[] {
  return buildAmbiguitySections(items).flatMap((section) => section.candidateIds);
}

/*
 * ============================================================================
 * ROWS-THEN-CARDS SEAM (AG, 2026-08-02, live bug report: "Residency was the
 * last unresolved row; clicking its ② chip applied Ignore but focus stayed
 * put with the panel open, while three 'Possible acronym' cards below still
 * needed review").
 *
 * BOTH sectioned-queue stages render the structural relationship cards as
 * the collection's FINAL sections (app.ts: renderTriageQueue /
 * renderAmbiguityQueue, then renderStructuralRelationships) -- ONE displayed
 * collection, rows first then cards. The arrow-key grammar already treats it
 * that way (forward past the last row enters the first card; backing out of
 * the first card returns to the last row). The POST-DECISION advance did
 * not: it walked only the row list and, finding nothing unresolved, stayed
 * on the just-decided row -- a dead end with visible work still below.
 *
 * The card half of that displayed order is derived HERE, pure and
 * DOM-free, so the advance can ask "what is the first unaddressed card"
 * from STATE rather than reading `relationship-card-addressed` classes off
 * the rendered tree. Same reasoning as triageQueueOrder/ambiguityQueueOrder:
 * the module that decides what order the reviewer SEES is the module the
 * keyboard consults, so the two can never disagree.
 * ============================================================================
 */

/*
 * ============================================================================
 * SECTION-ACTION DIGITS (AG, 2026-08-02, agreed design): the green
 * section-level buttons are numbered from the TOP of the digit space
 * DOWNWARD -- one action is ⑨, two are ⑧ ⑨, three are ⑦ ⑧ ⑨ -- while an
 * ITEM's own numbered surfaces (suggestion chips, then Possible identities)
 * keep growing UPWARD from ①. Two populations share one keyboard row and
 * grow toward each other from opposite ends, so neither has to know the
 * other's size to stay stable: adding a fourth chip to an item never
 * renumbers a section button, and a category gaining a third action never
 * renumbers a chip.
 *
 * The invariant that makes it learnable: the RIGHTMOST green button of the
 * active scope is always ⑨. A reviewer who learns "9 is the section's main
 * move" is never wrong, on any category, at any count.
 *
 * This is the ONE assignment: both the heading renderer (which paints the
 * keycaps) and the digit key handler (which acts on them) derive from this
 * function -- the same ONE-DIGIT-SPACE discipline identityDigitAssignments
 * enforces for the item side. Generic over the descriptor type on purpose:
 * the row sections hand it `SectionAction`s (declared data, below), the
 * structural kind groups hand it their own relationship-op descriptors, and
 * neither surface gets to invent its own numbering.
 * ============================================================================
 */

/** The top of the digit space -- the safest move always sits here. */
export const SECTION_ACTION_DIGIT_CEILING = 9;

/**
 * SEVERITY-FIXED DIGITS (AG, 2026-08-03) -- what a section action DOES,
 * for the purpose of which key runs it.
 *
 * REPLACES POSITIONAL ASSIGNMENT, and the reason is a live safety defect
 * rather than a preference. The old rule was "the last numbered action
 * lands exactly on the ceiling," which made ⑨ mean the RIGHTMOST button
 * rather than a particular kind of move. On the term sections
 * (institutional / calendar / common-words, declared `[Ignore all, Redact
 * all]`) that resolved to ⑧ = Ignore all and **⑨ = Redact all** -- so the
 * one key the codebase teaches as "the section's main move" was the
 * destructive one, on the sections a reviewer clears fastest. AG twice
 * referred to ⑨ as the leave-as-is key in the conversation that produced
 * this change; the scheme had already mistaught its own author.
 *
 * The replacement rule, in one line: **the higher the digit, the safer the
 * action.**
 *
 *   ⑨  safe        Keep / Ignore / accept-the-recommendation
 *   ⑧  change      Rename -- opens the replacement editor
 *   ⑦  redact      Redact -- opens the replacement editor
 *
 * A digit therefore means the same thing on every section, at every count,
 * and the key nearest the reviewer's muscle memory is the one that cannot
 * destroy anything. GAPS ARE MEANINGFUL AND EXPECTED: a section offering
 * Ignore-all and Redact-all numbers ⑨ and ⑦ with no ⑧, which says "Change
 * is not available here" instead of silently promoting Redact into ⑧.
 * (AG, unprompted: "It's fine to have 7 and 9 without 8 if so.")
 *
 * SECOND SAFE ACTIONS OVERFLOW DOWNWARD FROM ⑥, and this is not a corner
 * case -- SIX declared vocabularies need it. The safe class is genuinely
 * multi-valued in a way the destructive classes are not: "Use full names"
 * beside "Keep shortened names", or "These are people's names" beside "Not
 * people -- leave as-is", are two different agree-moves a reviewer picks
 * between, not a primary and a leftover. Numbering only the first would
 * have silently stripped a keycap from six live buttons, which the first
 * draft of this scheme did until the verification suite caught it.
 *
 * So the safe class takes ⑨ and then ⑥, ⑤, … stepping down BELOW the
 * reserved destructive pair rather than through it. Digits therefore do
 * not always read in order across a row (⑨ ⑥ ⑦ is a real arrangement),
 * which is the accepted cost -- and the thing preserved in exchange is the
 * one that matters: every digit means one thing everywhere, the safest
 * move is always ⑨, and nothing destructive is ever reachable by a
 * mis-remembered "main move" key.
 *
 * A FUTURE REFINEMENT, deliberately not taken now: the honest ladder has
 * four classes rather than three -- leave-alone / accept-DocScrub's-value /
 * use-my-typed-value / redact -- which would map onto ⑨⑧⑦⑥ with no
 * overflow at all. That reassigns Redact away from ⑦, which is the digit
 * AG specifically chose, so it is a conversation rather than a refactor.
 */
export type SectionActionSeverity = "safe" | "change" | "redact";

/**
 * THE GROUP-SCOPE CHORD (AG, 2026-08-03, superseding the severity band
 * above within hours of writing it -- the note is kept because the DEFECT
 * it records is real and the reasoning is why this replacement is safe).
 *
 * ⌥K / ⌥C / ⌥R / ⌥I / ⌥U apply a decision at GROUP scope. A section action
 * that corresponds to a decision kind therefore leaves the digit space
 * entirely and wears its chord instead.
 *
 * WHY THIS BEATS NUMBERING THEM. AG: *"R and C ... may be true within an
 * item, but not across all items. There does need to be a 'specialness'
 * about the key command -- it needs to be acknowledged that this is a
 * higher scope level."* The app had already reached the same conclusion in
 * code: handleScopeModeKey's mis-target guard REFUSES plain K/C/R/I
 * whenever a wider scope is active, on the recorded grounds that "any
 * candidate-targeted key must first ask what the working object is." A
 * modifier is how the ask gets answered in one gesture -- the chord names
 * the scope, so the letter can keep meaning exactly what it always meant.
 *
 * WHY ⌥ AND NOT ⌃. ⌃K and ⌃U are macOS system text-field bindings
 * (kill-to-end-of-line, delete-to-start) and the Change/Redact flows OPEN a
 * text field, so they would collide inside the very workflow that uses
 * them; ⌃R is reload and ⌃U view-source on Windows/Linux Chrome, and a
 * missed preventDefault on a redaction key reloads the app mid-review. ⌥'s
 * freedom on this app's target platforms was already investigated and
 * recorded when the filter column took ⌥+Arrows -- this reuses that
 * finding rather than re-litigating it. The cost is that ⌥+letter emits
 * composed characters on macOS (⌥R is "®"), so the handler matches
 * `event.code`, exactly as the digit handler already does for layout
 * independence.
 *
 * WHAT THIS DOES TO THE DIGITS. Everything destructive leaves the numbered
 * space, so the severity band, the ⑥ overflow, and the ⑨⑥⑦ arrangement all
 * become unnecessary: digits return to plain positional assignment and
 * carry only NAMED CONCLUSIONS that have no letter ("Use full names",
 * "Accept as acronyms", "Accept All Remaining"). The safety property the
 * severity band existed to guarantee is not lost -- it is now structural
 * rather than arithmetic, because a destructive action is not numbered at
 * all, and the verification suite asserts exactly that over the real
 * vocabulary.
 */
export type GroupScopeChord = "K" | "C" | "R" | "I" | "N" | "U";

/**
 * `Ignore` answers **I** for Ambiguity Check and Item Check (AG, 2026-08-11).
 *
 * This map is the canonical semantic action contract for the two sectioned
 * candidate stages: bare K/C/R/I acts on the focused item; Opt+K/C/R/I acts
 * on the applicable heading Zone/selection scope through the exact same
 * QueueSectionAction descriptor the visible button uses. Earlier builds used
 * Opt+N for conclusion-named Ignore actions ("Not people", "None are names")
 * to avoid an Opt+I/1 visual collision, but that made the modifier vocabulary
 * differ from the focused-item vocabulary and from the settled product rule.
 *
 * Type Check is deliberately not standardized in this pass. Its explicit
 * "None are personal" action still declares chord "N" in app.ts, so changing
 * this decision map updates Ambiguity/Item section actions without rolling the
 * contract into Type Check.
 */
export const GROUP_SCOPE_CHORD_FOR_DECISION: Record<"Keep" | "Ignore" | "Redact" | "Rename", GroupScopeChord> = {
  Keep: "K",
  Rename: "C",
  Redact: "R",
  Ignore: "I",
};

// How a chord is SPELLED lives in app.ts (groupScopeChordLabel), not here:
// the modifier's name differs by platform -- "Opt" on a Mac, "Alt" on a PC
// -- and reading `navigator` would break this module's standing contract to
// be pure policy over already-derived facts. The letter is policy; the
// glyph is presentation.

export interface SectionActionDigitAssignment<T> {
  action: T;
  /** The digit shown/typed for this action, or null (its severity's digit
   *  is already claimed in this scope -- click/Tab only). */
  digit: number | null;
}

/**
 * THE one assignment: both the renderer that paints the keycaps and the
 * handler that acts on them derive from this, so the number a reviewer
 * reads is always the number that runs.
 *
 * Generic over the descriptor type, with severity supplied by an accessor:
 * row sections hand it `SectionAction`s, structural kind groups hand it
 * their own descriptors, and neither gets to invent its own numbering.
 * Actions carrying a GROUP-SCOPE CHORD are skipped entirely -- they are
 * reachable by ⌥letter and must not also own a number, because one control
 * with two accelerators is one accelerator too many to keep in sync. What
 * remains is numbered POSITIONALLY, downward from ⑨ so the rightmost is
 * always ⑨ ("9 is the section's main move" -- restored, and now true
 * without qualification, since a chorded action can never be the thing ⑨
 * lands on).
 *
 * A vocabulary declaring more numbered actions than the ceiling allows
 * renders the surplus unnumbered rather than pushing the range down into
 * item territory -- unchanged, and now unreachable in practice: no
 * vocabulary has more than two numbered actions once decisions leave.
 */
export function sectionActionDigitAssignments<T>(
  actions: readonly T[],
  chordOf: (action: T) => GroupScopeChord | null
): SectionActionDigitAssignment<T>[] {
  const numberedCount = actions.filter((action) => chordOf(action) === null).length;
  let seen = 0;
  return actions.map((action) => {
    if (chordOf(action) !== null) return { action, digit: null };
    const index = seen;
    seen += 1;
    const digit = SECTION_ACTION_DIGIT_CEILING - (numberedCount - 1 - index);
    return { action, digit: digit >= 1 ? digit : null };
  });
}

/**
 * The first digit an ITEM may still use beside a scope holding these
 * section digits. The COLLISION RULE (agreed 2026-08-02) is unchanged --
 * the item side truncates first where the two populations meet -- but the
 * reserved range is now the digits ACTUALLY claimed rather than a count,
 * because with gaps a count no longer describes the range. A scope using
 * only ⑨ leaves items ①–⑧; one using ⑦ and ⑨ leaves ①–⑥ (⑧ stays clear so
 * an item can never claim a digit the section's Change-all would want if
 * the vocabulary later grew one).
 */
export function itemDigitCeilingBeside(reservedDigits: readonly (number | null)[]): number {
  const used = reservedDigits.filter((digit): digit is number => digit !== null);
  return used.length === 0 ? SECTION_ACTION_DIGIT_CEILING : Math.min(...used) - 1;
}

/**
 * A declared row-section action's severity, DERIVED from the operation it
 * already carries rather than declared a second time beside it -- the same
 * "derive, don't duplicate" rule the labels follow. A vocabulary author
 * cannot get the digit wrong because they never state it.
 *
 * `accept-suggestions` counts as SAFE even though applying a suggestion may
 * perform a Rename underneath. Severity here ranks REVIEWER INTENT, not the
 * durable decision kind: "Use full names" is the agree-with-DocScrub move,
 * the one a reviewer reaches for to clear a section they concur with, and
 * it belongs on the same key as every other agree move. Redact's ⑦ is not
 * about which command runs either -- it is about which key should require
 * deliberate reach.
 */
export function sectionActionSeverity(action: SectionAction): SectionActionSeverity {
  if (action.op.kind === "accept-suggestions") return "safe";
  switch (action.op.decision) {
    case "Redact":
      return "redact";
    case "Keep":
    case "Ignore":
      return "safe";
  }
}

/**
 * The chord a declared row-section action answers to, or null if it must be
 * numbered instead. DERIVED from the operation, like severity above -- a
 * vocabulary author never states an accelerator.
 *
 * `accept-suggestions` gets NO chord and stays numbered. It is the one
 * action whose meaning is not a decision kind: "Use full names" applies
 * each item's OWN suggestion, so different items receive different
 * replacements. There is no single letter that describes it, which is
 * precisely the population digits exist for -- and it is why the digit
 * space does not simply disappear.
 */
export function sectionActionChord(action: SectionAction): GroupScopeChord | null {
  if (action.op.kind === "accept-suggestions") return null;
  return GROUP_SCOPE_CHORD_FOR_DECISION[action.op.decision];
}

/** The minimum a proposal must expose to be placed in displayed order --
 *  deliberately structural, not a domain import: this module stays pure
 *  policy over already-derived facts (see the file header). */
export interface StructuralCardOrderItem {
  proposalId: string;
  kind: string;
}

/** Cards in DISPLAYED order: grouped by kind, kind groups in order of first
 *  appearance, input order preserved within each group -- exactly what
 *  app.ts's renderStructuralRelationships builds (kindOrder by first
 *  appearance, then every active proposal appended to its group host), so
 *  "cards never reorder" holds for the keyboard as well as the eye. */
export function structuralCardDisplayOrder<T extends StructuralCardOrderItem>(active: readonly T[]): T[] {
  const kindOrder: string[] = [];
  for (const proposal of active) if (!kindOrder.includes(proposal.kind)) kindOrder.push(proposal.kind);
  return kindOrder.flatMap((kind) => active.filter((proposal) => proposal.kind === kind));
}
