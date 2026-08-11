/**
 * semanticTypes.ts -- Type Check, Phase 1 (AG, 2026-08-02, "Type Check
 * presents detected entities grouped by SEMANTIC type, not by detection
 * method"). The pure vocabulary + assignment + card-summary policy the
 * Type Check stage builds on -- the same pattern triageQueue.ts set:
 * data and pure functions here, rendering elsewhere, engines untouched.
 *
 * MOVED src/ui/ -> src/domain/ (Phase 2, 2026-08-02): Type Check is now a
 * first-class WorkflowStage whose FocusNavigator traversal units ARE these
 * semantic types (see navigation/stages.ts's "type-check" cases), so the
 * navigation engine layer genuinely depends on this vocabulary. Engines
 * importing from src/ui/ would invert the repo's dependency direction;
 * domain/ is where pure, engine-consumed vocabulary already lives
 * (NotQuite.ts, StructuralRelationship.ts). Contents are the Phase 1
 * module unchanged -- this file remains the single source of truth for
 * vocabulary, assignment, and summaries, per Andrew's Phase 2
 * authorization -- plus the Phase 2 additions at the bottom
 * (SemanticTypeGroup/buildSemanticTypeGroups/qualityCategoriesOf), which
 * exist so Workspace and the UI provably assign types through ONE
 * computation instead of two parallel assemblies.
 *
 * ASSIGNMENT is reviewer-semantic: what KIND of decision is this --
 * "records@calstatela.edu" is an Email Address (not "Regex");
 * "Perias, Nelly" is a Person (not "spaCy PERSON"); "NSC" is an Acronym
 * however it was detected. Inputs are all pre-computed facts: the
 * detected type, quality categories, and structural-relationship kinds.
 * Deterministic; decision-BLIND (a candidate never changes type when
 * decided -- the stability contract every queue here honors).
 */

import type { RelationshipKind } from "./StructuralRelationship.js";

export type SemanticTypeId =
  | "people"
  | "emails"
  | "phones"
  | "organizations"
  | "acronyms"
  | "identifiers"
  | "dates-terms"
  | "document-titles"
  | "other";

/** Display order: the calm, high-certainty categories lead; Other last. */
export const SEMANTIC_TYPE_ORDER: readonly SemanticTypeId[] = [
  "people",
  "emails",
  "phones",
  "organizations",
  "acronyms",
  "identifiers",
  "dates-terms",
  "document-titles",
  "other",
];

export const SEMANTIC_TYPE_LABELS: Record<SemanticTypeId, string> = {
  people: "People",
  emails: "Email Addresses",
  phones: "Phone Numbers",
  organizations: "Organizations / Departments",
  acronyms: "Acronyms",
  identifiers: "Identifiers",
  "dates-terms": "Dates / Terms",
  "document-titles": "Document Titles",
  other: "Other / Miscellaneous",
};

export interface SemanticTypeFacts {
  detectedType: string;
  /** Quality categories (kebab or snake -- normalized here). */
  categories: readonly string[];
  relationshipKinds: ReadonlySet<RelationshipKind>;
  /**
   * CROSS-CANDIDATE NON-PERSON EVIDENCE (AG, 2026-08-10). True when
   * engines/cross-candidate produced evidence for this candidate AND the
   * person-protection gate did not exclude it.
   *
   * WHAT IT DOES, PRECISELY: it removes the `people` branch's ability to
   * fire on SHAPE alone. It does not assign a type, it does not suppress
   * detection, and it never overrides a name-evidence category -- a
   * candidate carrying `known-personal-name-token` still returns `people`
   * below, and in practice can never arrive here with this flag set,
   * because the gate excludes it upstream. Two independent guarantees, on
   * purpose.
   *
   * OPTIONAL, and absent means false: every existing caller and every
   * verification suite is unchanged by construction, and the Type Check
   * assignment is byte-identical unless a caller opts in.
   */
  crossCandidateNonPerson?: boolean;
  /**
   * CENSUS NAME STRUCTURE (AG, 2026-08-10) -- two tokens agreeing on
   * first-name / surname roles in U.S. Census name data. Affirmative evidence
   * about the referent, and the reason `Yazmine Guzmán`, `Amy Miller` and
   * `Chelsye Angelina` can reach People without shape.
   *
   * STRUCTURE, never token membership: `censusRoleFor` is not consulted here
   * and must not be. Optional; absent means false.
   */
  censusNameStructure?: boolean;
  /**
   * HIGHER-EDUCATION TERMINOLOGY ATTESTATION (AG, 2026-08-10) -- true when
   * the candidate's phrase is attested in
   * engines/knowledge/HigherEdTerminologyEvidence's reference dataset.
   *
   * CARRIED FOR DIAGNOSTICS, AUDIT AND BENCHMARKING. NOTHING IN
   * `semanticTypeFor` BELOW MAY BRANCH ON IT, and the reason is the same
   * measurement that kept `censusNameStructure` out of the branches above,
   * arriving from a third source: 34 single-token terms in that dataset are
   * also Census-attested personal-name tokens -- `White`, `Major`, `Minor`,
   * `Race`, `Session`, `Course` -- 19 of them flagged HIGH collision risk by
   * the dataset itself. Attestation is a claim about the PHRASE, not about
   * the referent, and this function may only read claims about the referent.
   *
   * Nor may it route to `organizations`: only 86 of 1,394 rows carry an
   * ORGANIZATION hint at all, and the dataset's own methodology calls the
   * hints "evidence features, not final entity labels". `Cost of Attendance`
   * is attested terminology and is not an organization.
   *
   * The honest destination for this evidence is a deterministic
   * evidence-COMBINATION layer that can weigh it against geographic, person,
   * contextual and pattern evidence and can represent a CONFLICT rather than
   * a winner. That layer does not exist yet (the GNIS benchmark reached the
   * same conclusion independently -- see
   * 20260810-gnis-place-evidence-benchmark.md §13). This field is where the
   * evidence arrives at the interpretation boundary so that layer, when it is
   * designed, has a call site rather than a plumbing problem.
   *
   * Optional; absent means false. Type Check assignment is byte-identical
   * whether or not a caller sets it -- asserted in
   * verify/higher-ed-terminology-evidence-verification.ts.
   */
  higherEdTerminologyAttested?: boolean;
  /**
   * GNIS GEOGRAPHIC ATTESTATION (AG, 2026-08-10) -- the strength returned by
   * engines/knowledge/GnisPlaceEvidence: "strong", "weak" or "none".
   *
   * CARRIED FOR DIAGNOSTICS, AUDIT AND BENCHMARKING. NOTHING BELOW BRANCHES
   * ON IT, and the reason is a STOP CONDITION rather than caution:
   *
   *   1. `SemanticTypeId` has no Place/Geography member. Routing strong PLACE
   *      evidence anywhere would require inventing a reviewer-facing category,
   *      which §19.4 of the integration instruction reserves to Andrew.
   *   2. `semanticTypeFor` is a first-match-wins chain returning ONE id. A
   *      `places` branch would sit either before or after the `people` branch,
   *      and that ordering IS the arbitrary precedence §7 forbids. The
   *      function cannot represent "affirmative PERSON evidence AND
   *      affirmative PLACE evidence" at all -- it can only pick.
   *
   * This is the third evidence family to arrive at the same boundary
   * (`censusNameStructure`, `higherEdTerminologyAttested`, and now this), and
   * the convergence is the finding: what is missing is a deterministic
   * evidence-COMBINATION layer that can hold a CONFLICT rather than a winner.
   *
   * Optional; absent means "none". Type Check assignment is byte-identical
   * whether or not a caller sets it -- asserted in
   * verify/gnis-place-evidence-verification.ts.
   */
  gnisPlaceStrength?: "strong" | "weak" | "none";
  /**
   * MEDICAL/HEALTHCARE TERMINOLOGY ATTESTATION (AG, 2026-08-10) -- true when
   * the candidate's phrase is attested in engines/knowledge/MedicalEvidence's
   * reference dataset.
   *
   * CARRIED FOR DIAGNOSTICS, AUDIT AND BENCHMARKING. NOTHING IN
   * `semanticTypeFor` BELOW MAY BRANCH ON IT. The fourth family to arrive at
   * this boundary, and it brings two reasons of its own on top of the three
   * already recorded above:
   *
   *   1. THE COLLISION POPULATION IS THE SAME SHAPE, AGAIN. The dataset flags
   *      38 rows HIGH collision risk and 16 MEDIUM, and the MEDIUM list is
   *      ordinary English wearing a CMS/CDC badge -- `Case`, `Claim`,
   *      `Provider`, `Agent`, `Carrier`, `Premium`, `Bias`, `Association`.
   *      The HIGH list is chiefly two- and three-letter abbreviations (`RT`,
   *      `IV`, `TB`, `LP`, `GAS`, `Ear`, `Eye`), which is exactly the shape
   *      personal initials and OCR fragments take. Attestation is a claim
   *      about the PHRASE, never about the referent, and this function may
   *      only read claims about the referent.
   *   2. THE HINTS ARE NOT TYPES, AND THIS FAMILY'S ARE THE MOST TEMPTING
   *      ONES YET. `Cardiology` is hinted ORGANIZATION_DEPARTMENT and
   *      `Anesthesiologists` is hinted ROLE. Routing on either would assert
   *      that a candidate IS a department or IS a role on the strength of a
   *      dictionary hit -- which is precisely the "dictionary membership
   *      determines semantic type" failure the source methodology's own
   *      closing line warns against.
   *
   * AND ONE CONSTRAINT UNIQUE TO THIS FAMILY, which is not a matter of
   * accuracy but of harm: medical terminology attestation must never become an
   * assertion about an individual. No branch here, and no future combination
   * rule, may read `Diabetes Mellitus` or `HIV` near a name as evidence that
   * the person has a condition. See the module header in
   * engines/knowledge/MedicalEvidence.ts.
   *
   * Optional; absent means false. Type Check assignment is byte-identical
   * whether or not a caller sets it -- asserted in
   * verify/medical-evidence-verification.ts.
   */
  medicalTerminologyAttested?: boolean;
}

const norm = (c: string): string => c.replace(/_/g, "-");
const has = (facts: SemanticTypeFacts, ...names: string[]): boolean => facts.categories.some((c) => names.includes(norm(c)));

/**
 * INSTITUTIONAL CATEGORY VOCABULARY -- one definition, two consumers
 * (2026-08-05, AG, from 20260803-detection-classification-handoff.md §2).
 *
 * `semanticTypeFor` (below) and `deriveRecommendation` (ui/recommendations.ts)
 * both classify institutional language, and both used to carry their own
 * hand-maintained copy of the category list. The two copies had already
 * drifted by exactly one member -- `document-structure-term` -- so an item
 * carrying only that category was a Document Title to one classifier and an
 * Institutional term to the other.
 *
 * The split below is what makes the drift structurally impossible without
 * collapsing the two buckets. `document-structure-term` is NOT an
 * Organizations member and must not become one: Document Titles is a
 * semantically distinct Type Check bucket, and folding the category into
 * ORGANIZATION_CATEGORIES would make that bucket unreachable, since the
 * organizations branch is tested first. The archetype list that
 * recommendations.ts needs is DERIVED from the two, so adding a future
 * institutional category to ORGANIZATION_CATEGORIES updates both consumers
 * by construction rather than by remembering to.
 *
 * Deliberately NOT unified with ORGANIZATION_EVIDENCE_CATEGORIES in
 * ui/itemCheckQuery.ts. That list is a reviewer-facing FILTER predicate,
 * not a type assignment: it includes `institution-acronym` (correct for
 * "show me organization-ish evidence", wrong here, where acronyms are
 * their own bucket resolved earlier) and its own docstring records the
 * scoping as intentional. Different concept, not a third drifted copy.
 */
export const ORGANIZATION_CATEGORIES: readonly string[] = [
  "department-organization",
  "organization-suffix",
  "institution-term",
  "product-system-name",
  "administrative-phrase",
  "legal-administrative-term",
];

/** Routes to the Document Titles bucket when it is the only institutional
 *  signal present. See the note above for why it is held separate. */
export const DOCUMENT_STRUCTURE_CATEGORY = "document-structure-term";

/** Every institutional signal, for archetype purposes -- derived, never
 *  hand-maintained. This is what ui/recommendations.ts consumes. */
export const INSTITUTIONAL_CATEGORIES: readonly string[] = [
  ...ORGANIZATION_CATEGORIES,
  DOCUMENT_STRUCTURE_CATEGORY,
];

/**
 * AFFIRMATIVE person evidence -- evidence about the REFERENT, never about the
 * string's shape. Shape categories are deliberately excluded; see the people
 * branch below.
 */
export const PERSON_EVIDENCE_CATEGORIES: readonly string[] = [
  "known-personal-name-token",
  "known-first-name",
  "known-name-structure",
  "known-surname",
  "nearby-title",
];

/**
 * Does ANY affirmative semantic evidence exist for this candidate?
 *
 * THE INVARIANT THIS ENFORCES: DocScrub must never assign a semantic type
 * merely because every other type failed. `semanticTypeFor` returns `other`
 * from a single fallthrough at its end, and that fallthrough is reached by
 * absence rather than by evidence -- so `other` cannot be distinguished from
 * "unresolved" by its value alone. This predicate makes the distinction
 * explicit, and `typeCheckSectionFor` routes the unsupported case to
 * Undetermined instead.
 *
 * NOTE, and it is the honest finding rather than an oversight: there is no
 * affirmative evidence in the production vocabulary that MEANS "miscellaneous".
 * Every category asserts something specific. So this returns false for every
 * candidate that reaches the fallthrough, and `other` is currently
 * unreachable. That is reported rather than papered over -- see
 * 20260810-evidence-faithful-type-check.md §4.
 */
export function hasAffirmativeSemanticEvidence(facts: SemanticTypeFacts): boolean {
  return semanticTypeFor(facts) !== "other";
}

export function semanticTypeFor(facts: SemanticTypeFacts): SemanticTypeId {
  // Typed detections first -- unambiguous semantics.
  if (facts.detectedType === "email") return "emails";
  if (facts.detectedType === "phone") return "phones";
  if (facts.detectedType === "cin" || facts.detectedType === "long_numeric_id") return "identifiers";
  if (facts.relationshipKinds.has("numeric-identifier") || facts.relationshipKinds.has("alphanumeric-identifier")) return "identifiers";
  // Acronyms regardless of detection route.
  if (facts.relationshipKinds.has("acronym") || has(facts, "likely-acronym", "institution-acronym")) return "acronyms";
  // ORGANIZATION_CATEGORIES only -- NOT INSTITUTIONAL_CATEGORIES. Using the
  // derived list here would swallow document-structure-term and make the
  // Document Titles branch below unreachable. See the vocabulary note above.
  if (facts.detectedType === "organization" || has(facts, ...ORGANIZATION_CATEGORIES)) {
    return "organizations";
  }
  if (has(facts, "calendar-term", "calendar-abbreviation", "season-or-academic-term")) return "dates-terms";
  if (has(facts, DOCUMENT_STRUCTURE_CATEGORY)) return "document-titles";
  // AFFIRMATIVE PERSON EVIDENCE ONLY (AG, 2026-08-10).
  //
  // `strong-name-structure` and `surname-given-structure` are SHAPE -- two
  // capitalized tokens. They are deliberately absent from this test: shape is
  // what made `Grade Rosters` and `Amy Miller` indistinguishable, and a
  // category that can be earned by shape alone cannot mean "DocScrub has
  // evidence this is a person".
  //
  // What remains is evidence about the referent: a lexicon-recognised name
  // token, an attached honorific, or Census-attested name STRUCTURE (two
  // tokens agreeing on first/surname roles -- never single-token membership,
  // which is attested for Will, Hope, Rose, Grade and Reason alike).
  if (facts.detectedType === "person") {
    // AFFIRMATIVE evidence about the referent. NEVER defeated by
    // cross-candidate evidence -- a recognised name outranks a structural
    // observation about other candidates, and the verification suite caught
    // the first draft letting the flag gate this branch too.
    if (has(facts, ...PERSON_EVIDENCE_CATEGORIES)) return "people";
    /*
     * CENSUS IS DELIBERATELY NOT CONSULTED HERE, and the first draft of this
     * change proved why.
     *
     * Census name STRUCTURE was validated as PROTECTION -- a reason not to let
     * cross-candidate evidence reinterpret a candidate -- and it is used for
     * exactly that in engines/cross-candidate/person-evidence-gate.ts. Adding
     * it as affirmative CLASSIFICATION evidence here routed `Good Morning`
     * into People: GOOD is an attested first name, MORNING is attested in both
     * roles, so the pair reads as an ambiguous-role personal-name structure.
     *
     * That is the measured 20/106 collision rate arriving exactly where it was
     * predicted to. Protection and classification are different jobs, and this
     * source is only sound for the first. `facts.censusNameStructure` is
     * carried on SemanticTypeFacts for diagnostics and audit; nothing in this
     * function may branch on it.
     */
    /*
     * SHAPE IS NOT AFFIRMATIVE PERSON EVIDENCE, and no branch below reads it
     * (AG's ruling, 2026-08-10).
     *
     * `strong_name_structure` and `surname_given_structure` remain detector
     * and provenance evidence -- they are still scored, still explained, still
     * carried in `reasons` and still visible in Expert View. What they no
     * longer do is ASSIGN a semantic type. Two capitalized tokens is a fact
     * about the string; People must mean DocScrub has evidence about the
     * referent.
     *
     * THE COST, PINNED RATHER THAN COMPENSATED FOR. `Chriztopher Johnson`
     * (unusual spelling, no lexicon, no Census) and `Fox, Liud` (a truncation,
     * so the surname role does not resolve) are real people who now route to
     * Undetermined. That is EXPECTED BEHAVIOUR, asserted as such in
     * verify/evidence-faithful-type-check-verification.ts. No exception, no
     * candidate-specific rule, and no widening of the person lexicon exists to
     * keep them in People -- the honest state is that DocScrub has no evidence
     * about them, and Undetermined says exactly that.
     *
     * The remedy is more positive-evidence capability, not a softer contract.
     */
  }
  return "other";
}

/*
 * ============================================================================
 * UNDETERMINED -- A ROUTING STATE, NOT A SEMANTIC TYPE (AG, 2026-08-10)
 * ============================================================================
 *
 * `SemanticTypeId` above is a SEMANTIC ONTOLOGY: every member is a claim about
 * what a thing IS. Andrew's constraint, verbatim: "Do not create a fake
 * semantic ontology merely to make the UI work."
 *
 * Undetermined is not such a claim. It is the state of an INTERPRETATION:
 *
 *     the detector proposed a type, deterministic interpretation has
 *     sufficient evidence to REJECT that proposal, and there is insufficient
 *     evidence to assign a supported replacement.
 *
 * So it lives one level up, in the vocabulary Type Check ROUTES on, and
 * `SemanticTypeId` is left exactly as it was -- nine members, all semantic.
 * A consequence worth stating: `semanticTypeFor()` can never return
 * "undetermined", by type. Only `typeCheckSectionFor()` can, and only when it
 * has a rejected hypothesis in hand.
 *
 * WHAT IT IS NOT, enforced by that shape rather than by documentation:
 *   - not "low confidence"      -- no score reaches this function
 *   - not "miscellaneous"       -- `other` is still a real semantic
 *                                  destination and still reachable
 *   - not "detection failed"    -- the detector's hypothesis is preserved
 *   - not "probably non-person" -- it records that ONE hypothesis was
 *                                  rejected, and nothing more
 *   - not a catch-all for whatever semanticTypeFor cannot classify -- a
 *     candidate with no rejected hypothesis can never arrive here
 */
export const UNDETERMINED_SECTION = "undetermined" as const;

/** What Type Check routes on: the semantic ontology, plus the one state that
 *  is not a member of it. */
export type TypeCheckSectionId = SemanticTypeId | typeof UNDETERMINED_SECTION;

/** Undetermined sits LAST -- after Other / Miscellaneous. It is neither a
 *  high-certainty category (which lead) nor a semantic bucket (which follow);
 *  it is the residue of a rejected hypothesis, and the calm reading is that
 *  the reviewer meets it after everything the system can actually name. */
export const TYPE_CHECK_SECTION_ORDER: readonly TypeCheckSectionId[] = [...SEMANTIC_TYPE_ORDER, UNDETERMINED_SECTION];

export const TYPE_CHECK_SECTION_LABELS: Record<TypeCheckSectionId, string> = {
  ...SEMANTIC_TYPE_LABELS,
  [UNDETERMINED_SECTION]: "Undetermined",
};

/** Reviewer-facing meaning. Deliberately free of implementation vocabulary --
 *  no rule ids, no "cross-candidate", no "name-shaped". Those belong to
 *  Expert View and the audit record, which read the provenance instead. */
export const TYPE_CHECK_SECTION_EXPLANATIONS: Partial<Record<TypeCheckSectionId, string>> = {
  [UNDETERMINED_SECTION]: "Type could not be determined.",
};

/**
 * The full interpretation of one candidate: what the detector proposed, what
 * the semantic layer concluded, and where Type Check therefore routes it.
 *
 * `rejectedType` is the load-bearing field. It is what makes Undetermined a
 * narrow state rather than a catch-all: a candidate can only be Undetermined
 * if something was rejected, and the thing rejected is recorded.
 */
export interface CandidateInterpretation {
  /** Detector provenance. Carried, never consulted for routing. */
  detectedType: string;
  /** What the semantic layer supports, on its own vocabulary. */
  semanticType: SemanticTypeId;
  /** The detector-proposed semantic type that evidence rejected, if any. */
  rejectedType?: SemanticTypeId;
  /** Where Type Check puts it. */
  section: TypeCheckSectionId;
}

/**
 * Interprets one candidate for Type Check routing.
 *
 * `nonPersonEvidence` is the caller's conclusion that independent,
 * person-scoped evidence rejects a PERSON reading (today: engines/
 * cross-candidate, after its own protection gate). It is deliberately a
 * boolean rather than the evidence itself -- this function must not be able
 * to grow rules of its own, and the evidence travels separately to the
 * provenance record.
 *
 * THE ORDER MATTERS AND IS THE WHOLE CONTRACT:
 *
 *  1. Ask for the supported semantic type, ignoring the rejection entirely.
 *     If it is anything other than `people`, the rejection is irrelevant --
 *     person-scoped evidence has no business moving an Organization.
 *  2. Only when the supported answer WAS `people` and the rejection stands,
 *     ask a second time WITH the rejection, to see whether some other type is
 *     independently supported. That is Andrew's case A.
 *  3. If the second answer is `other`, no replacement type is supported. That
 *     is NOT a semantic conclusion of "miscellaneous" -- it is the absence of
 *     one, and it routes to Undetermined. Case B.
 *
 * Step 3 is why `other` cannot become the dumping ground for rejected
 * hypotheses: reaching `other` through a rejection is treated as a MISSING
 * answer, while reaching it directly is still a real one.
 */
export function typeCheckSectionFor(facts: SemanticTypeFacts, nonPersonEvidence: boolean): CandidateInterpretation {
  const proposed = semanticTypeFor({ ...facts, crossCandidateNonPerson: false });
  if (!nonPersonEvidence || proposed !== "people") {
    // NO AFFIRMATIVE EVIDENCE -> UNDETERMINED, never `other`. Reaching the
    // fallthrough is the absence of an answer; treating it as the answer
    // "miscellaneous" is exactly the default-bucket behaviour this contract
    // exists to remove.
    if (proposed === "other") {
      return { detectedType: facts.detectedType, semanticType: proposed, section: UNDETERMINED_SECTION };
    }
    return { detectedType: facts.detectedType, semanticType: proposed, section: proposed };
  }
  const replacement = semanticTypeFor({ ...facts, crossCandidateNonPerson: true });
  // THE REJECTION DID NOT STAND. `semanticTypeFor` still answers `people`,
  // which means name EVIDENCE (not shape) is present and the flag has no
  // purchase on it. Recording a `rejectedType` here would be incoherent --
  // nothing was rejected -- and would let a person-evidenced candidate carry
  // a rejection into the audit. In production the protection gate already
  // excludes these upstream; this is the second, independent guarantee, and
  // it was added because the verification suite caught the first draft
  // emitting `{ section: "people", rejectedType: "people" }`.
  if (replacement === proposed) {
    return { detectedType: facts.detectedType, semanticType: proposed, section: proposed };
  }
  if (replacement !== "other") {
    // Case A: some other semantic type is independently supported.
    return { detectedType: facts.detectedType, semanticType: replacement, rejectedType: proposed, section: replacement };
  }
  // Case B: the hypothesis is rejected and nothing replaces it.
  return { detectedType: facts.detectedType, semanticType: replacement, rejectedType: proposed, section: UNDETERMINED_SECTION };
}

export interface SemanticTypeItem {
  id: string;
  type: TypeCheckSectionId;
  occurrenceCount: number;
  decided: boolean;
}

export interface SemanticTypeSummary {
  id: TypeCheckSectionId;
  label: string;
  entityCount: number;
  occurrenceCount: number;
  decidedCount: number;
  candidateIds: string[];
}

/** Card summaries in display order; empty types omitted ("only display
 *  categories that actually contain entities"); input order preserved
 *  within a type. */
export function buildSemanticTypeSummaries(items: readonly SemanticTypeItem[]): SemanticTypeSummary[] {
  const byType = new Map<TypeCheckSectionId, SemanticTypeSummary>();
  for (const item of items) {
    const existing = byType.get(item.type) ?? {
      id: item.type,
      label: TYPE_CHECK_SECTION_LABELS[item.type],
      entityCount: 0,
      occurrenceCount: 0,
      decidedCount: 0,
      candidateIds: [],
    };
    existing.entityCount += 1;
    existing.occurrenceCount += item.occurrenceCount;
    if (item.decided) existing.decidedCount += 1;
    existing.candidateIds.push(item.id);
    byType.set(item.type, existing);
  }
  return TYPE_CHECK_SECTION_ORDER.filter((id) => byType.has(id)).map((id) => byType.get(id)!);
}

// --------------------------------------------------------------------------
// Phase 2 additions (Type Check as a first-class stage, 2026-08-02).
// --------------------------------------------------------------------------

/**
 * The MEMBERSHIP shape the navigation layer traverses: one entry per
 * POPULATED semantic type, in SEMANTIC_TYPE_ORDER, computed ONCE per
 * document load by Workspace (see Workspace.load's semanticTypeGroups)
 * from the same semanticTypeFor() assignment everything else uses.
 * Deliberately membership-only -- occurrence counts and decided state are
 * per-render display facts (buildSemanticTypeSummaries), not traversal
 * facts, and decided state changing must never change membership (the
 * decision-BLIND stability contract in this file's top doc comment).
 *
 * Relationship DISMISSALS are deliberately NOT consulted when assigning
 * types (unlike recommendationFactsForCandidate's kinds set in app.ts,
 * which is a per-render suggestion concern): a dismissal is session
 * state, and letting it move a candidate between Type Check cards
 * mid-session would violate the same stability contract.
 */
export interface SemanticTypeGroup {
  typeId: TypeCheckSectionId;
  candidateIds: readonly string[];
}

/** Folds a per-candidate assignment (insertion-ordered, as produced by
 *  iterating DetectionResult.candidates) into the ordered, populated-only
 *  group list. */
export function buildSemanticTypeGroups(assignments: ReadonlyMap<string, TypeCheckSectionId>): SemanticTypeGroup[] {
  const byType = new Map<TypeCheckSectionId, string[]>();
  for (const [candidateId, typeId] of assignments) {
    const existing = byType.get(typeId);
    if (existing) existing.push(candidateId);
    else byType.set(typeId, [candidateId]);
  }
  return TYPE_CHECK_SECTION_ORDER.filter((id) => byType.has(id)).map((typeId) => ({ typeId, candidateIds: byType.get(typeId)! }));
}

/**
 * The one shared "which category strings describe this candidate" rule --
 * filterRules when any exist, else reasons -- previously stated only
 * inside app.ts's candidateCategories(). Extracted here (and app.ts
 * refactored to call it) so Workspace's load-time semantic-type
 * assignment provably reads the SAME categories the UI's own
 * per-candidate derivations do -- one rule, two call sites, no drift.
 */
export function qualityCategoriesOf(assessment: { filterRules: readonly string[]; reasons: readonly string[] } | undefined): readonly string[] {
  if (!assessment) return [];
  /*
   * THE MASKING DEFECT, FIXED (AG, 2026-08-10).
   *
   * This used to return `filterRules.length ? filterRules : reasons` -- an
   * EITHER/OR. Because `scoredResult` sets `filterRules` to the dictionary
   * classifications on every name-structure branch, one incidental dictionary
   * hit replaced the whole category channel and hid the positive evidence
   * sitting in `reasons`:
   *
   *   Julie Ford   reasons     [small_frequency_bonus, address_suffix,
   *                             strong_name_structure, known_personal_name_token]
   *                filterRules [address_suffix]
   *                categories  [address_suffix]              -> other
   *
   *   Amy Miller   filterRules []
   *                categories  [.., strong_name_structure]   -> people
   *
   * `known_personal_name_token` is the strongest name evidence in the system,
   * and `address_suffix` -- a fact about the token "Ford" -- erased it. The
   * two are not in contradiction; they answer DIFFERENT questions. Evidence
   * about one hypothesis was being used to suppress evidence about another.
   *
   * normalization.ts already documented this as a "quirk" and routed around
   * it by passing contextual strength as a separate parameter rather than
   * through this function. That workaround is the tell: the channel was known
   * to be lossy and was worked around instead of repaired.
   *
   * The union is the honest representation -- every category the assessment
   * actually produced, with nothing hidden. It is safe ONLY because
   * `semanticTypeFor` below now requires affirmative EVIDENCE rather than
   * name SHAPE; a union without that change would have routed "Good Morning"
   * (greeting_or_courtesy + strong_name_structure) to People.
   */
  return [...new Set([...assessment.filterRules, ...assessment.reasons])];
}
