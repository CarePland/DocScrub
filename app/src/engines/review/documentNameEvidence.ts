/**
 * documentNameEvidence.ts -- name evidence derived from THIS DOCUMENT rather
 * than from a static lexicon (AG, 2026-08-09).
 *
 * ============================== WHY THIS EXISTS ==============================
 * `hasKnownNameEvidence` is backed by KNOWN_GIVEN_NAMES (23 entries) and
 * KNOWN_SURNAMES (5). Both are document-derived seeds -- the cast of one
 * Cal State correspondence set -- so every name outside them is invisible:
 * Amy, Kyle, Rose, Will, May, Mark, Fox, Collier, Agnes.
 *
 * That gap was already known. ui/recommendations.ts's own comment names Amy
 * and Kyle, and says the fix is NOT to widen the dictionaries:
 *
 *   "widening the dictionaries makes the failure rarer without changing its
 *    shape, and the next unlisted surname repeats it ... The evidence that
 *    actually settles Kyle and Amy (a high-confidence identity match against
 *    a full name found in this document) is computed in the
 *    entity-resolution layer and never reaches this function. Any real fix
 *    routes that signal in HERE."
 *
 * This module is that signal, made available as a pure function. It fixes
 * the CLASS -- "is this token used as a name anywhere in the document I am
 * actually redacting" -- rather than the list.
 * ==========================================================================
 *
 * ---------------------------------------------------------------------
 * THE THREE SOURCES, WEAKEST LAST
 * ---------------------------------------------------------------------
 *
 * 1. AMBIGUITY PROPOSAL. Entity resolution already asked "could this bare
 *    first name belong to a full-name entity in this document?" and found at
 *    least one candidate anchor. That is the exact signal the comment above
 *    describes, and it is the strongest: another stage has independently
 *    concluded the token might name a person here.
 *
 * 2. ENTITY GROUP MEMBERSHIP. The candidate is a member of a proposed entity
 *    group -- resolution grouped it with other spellings of one person.
 *
 * 3. FULL-NAME TOKEN MATCH. The token appears as a first or last token of a
 *    MULTI-TOKEN person candidate somewhere in the document. If the document
 *    contains "Agnes Wu", then a bare "Agnes" is a name in this document
 *    whatever any lexicon says.
 *
 *    This is the broadest and the one that does the real work, because it
 *    needs no prior resolution -- just the observation that the same token
 *    is used as part of a name elsewhere. It is also why the fix is not
 *    circular: multi-token person candidates come from
 *    FALLBACK_PERSON_RE/LAST_FIRST_PERSON_RE, which do not consult the name
 *    lexicon at all.
 *
 * ---------------------------------------------------------------------
 * WHAT IT DELIBERATELY DOES NOT DO
 * ---------------------------------------------------------------------
 *
 * It does not claim the candidate IS that person. It claims only that the
 * token is used as a name somewhere in this document, which is exactly the
 * bar the gate needs: enough doubt that a human should look. Deciding
 * whether bare "Agnes" is Agnes Wu remains Ambiguity Check's question, and
 * routing this signal must not pre-empt it.
 *
 * ---------------------------------------------------------------------
 * THE WITNESS FILTER, AND THE CLAIM IT REPLACES
 * ---------------------------------------------------------------------
 *
 * A first version of this module asserted that restricting witnesses to
 * PERSON-typed multi-token candidates was enough to keep institutional
 * phrases out. A control in its own test disproved that immediately:
 * "Enrollment Services Team" IS person-typed -- FALLBACK_PERSON_RE matches
 * any run of capitalized tokens -- so it witnessed "Enrollment", which was
 * then retained as a name.
 *
 * Left unfixed, that would have re-inflated the queue with exactly the
 * domain vocabulary the gate exists to settle, while looking like a safety
 * improvement.
 *
 * So a witness must ALSO carry no institutional evidence. That test is not
 * invented here either -- it reads the same quality categories the UI uses
 * to route these phrases to "Institutional Terminology", supplied by the
 * caller as a predicate so this module keeps owning no dictionaries.
 *
 * Pure and DOM-free.
 */

/** The minimum this needs from a candidate. */
export interface NameEvidenceCandidate {
  id: string;
  displayValue: string;
  detectedType: string;
}

export interface DocumentNameEvidenceInputs {
  candidates: readonly NameEvidenceCandidate[];
  /** Candidate ids carrying at least one ambiguity proposal option. */
  ambiguityProposalCandidateIds: ReadonlySet<string>;
  /** Candidate ids that are members of some proposed entity group. */
  entityGroupMemberIds: ReadonlySet<string>;
}

export type DocumentNameEvidenceSource =
  | "ambiguity-proposal"
  | "entity-group-member"
  | "full-name-token";

export interface DocumentNameEvidence {
  /** True when any source fired. */
  has: boolean;
  sources: DocumentNameEvidenceSource[];
  /** For `full-name-token`, the multi-token candidate that supplied it --
   *  the thing a reviewer would want quoted back at them. */
  witness?: string;
}

/** Tokens of a display value, lower-cased, punctuation-stripped. Commas are
 *  dropped so "Goodloe, Andrew" contributes both names. */
function nameTokens(displayValue: string): string[] {
  return displayValue
    .split(/[\s,]+/)
    .map((t) => t.replace(/[^\p{L}\p{M}'’-]/gu, "").toLowerCase())
    .filter((t) => t.length > 1);
}

/**
 * Reasons a multi-token candidate may not stand as a name witness. Both are
 * injected as predicates rather than read from dictionaries here, so this
 * module keeps owning no lexicons; both are supplied by the caller from
 * quality categories it already holds.
 *
 * They are separate predicates rather than one `isIneligible` because the
 * two reasons are genuinely different claims about the phrase, and a
 * diagnostic that can only report "ineligible" is worth less than one that
 * can say which.
 */
export interface WitnessEligibility {
  /** The candidate reads as an institutional/organizational phrase rather
   *  than a person's name ("Enrollment Services Team"). */
  isInstitutionalPhrase?: (candidateId: string) => boolean;
  /** The candidate carries POSITIVE ordinary-language evidence -- the same
   *  vocabulary the residual gate's own rule 4 uses ("Good Morning",
   *  "Thank You", "Tuesday, March"). See the note below. */
  carriesOrdinaryLanguageEvidence?: (candidateId: string) => boolean;
}

/**
 * Builds the lookup once per document: every token that appears as part of a
 * multi-token PERSON candidate, mapped to the candidate that witnessed it.
 *
 * Built once and shared rather than recomputed per candidate -- this is
 * O(candidates) and the gate runs over every candidate, so the naive version
 * is quadratic on a document with thousands.
 *
 * ---------------------------------------------------------------------
 * WHY `detectedType === "person"` IS NOT ENOUGH (AG, 2026-08-09)
 * ---------------------------------------------------------------------
 *
 * It is a REGEX ARTIFACT. FALLBACK_PERSON_RE matches any run of 2-6
 * capitalized words and LAST_FIRST_PERSON_RE matches `Capitalized,
 * Capitalized`; neither consults a name lexicon, which is precisely why this
 * module could use them without circularity. The cost of that is that an
 * email thread is full of person-typed phrases that name nobody, and each
 * was witnessing its own tokens:
 *
 *     "Good Morning"     ->  Morning
 *     "Thank You"        ->  Thank
 *     "Last Call"        ->  Last
 *     "Tuesday, March"   ->  Tuesday, March
 *
 * On the live document that was the dominant reason ordinary lexical
 * material was retained as "recognized as a name".
 *
 * THE FIX THAT DOES NOT WORK, recorded so it is not retried: "require the
 * witness to carry a positive name-structure category". `Last Call` and
 * `Agnes Wu` are CATEGORY-IDENTICAL -- both
 * ["moderate_frequency_bonus", "strong_name_structure"] -- because at the
 * lexical level there is no difference between them. Falsified by a control
 * in verify/full-name-token-witness-verification.ts.
 *
 * WHAT DOES WORK, and why it is not a new rule: the residual gate already
 * decides that a candidate carrying positive ordinary-language evidence is
 * ordinary language. This applies the SAME judgement one level up. A phrase
 * the pipeline has already called ordinary language cannot simultaneously be
 * the evidence that one of its tokens is somebody's name.
 *
 * It is deliberately PARTIAL. `Last Call`, `Message List` and `Preview Day`
 * carry no ordinary-language category and still witness. Narrowing further
 * would need evidence the lexical layer does not have, and guessing there
 * would cost real names -- which is the failure this module exists to
 * prevent.
 *
 * WHAT THIS DOES NOT DO: it does not retype, suppress, or resolve the phrase
 * itself. "Good Morning" remains a candidate and remains reviewable in its
 * own right. The only thing withdrawn is its authority to speak about OTHER
 * candidates.
 */
export function buildFullNameTokenIndex(
  candidates: readonly NameEvidenceCandidate[],
  eligibility: WitnessEligibility = {}
): ReadonlyMap<string, string> {
  const institutional = eligibility.isInstitutionalPhrase ?? ((): boolean => false);
  const ordinary = eligibility.carriesOrdinaryLanguageEvidence ?? ((): boolean => false);
  const index = new Map<string, string>();
  for (const candidate of candidates) {
    if (candidate.detectedType !== "person") continue;
    if (institutional(candidate.id)) continue;
    if (ordinary(candidate.id)) continue;
    const tokens = nameTokens(candidate.displayValue);
    if (tokens.length < 2) continue; // single tokens prove nothing about themselves
    for (const token of tokens) {
      if (!index.has(token)) index.set(token, candidate.displayValue);
    }
  }
  return index;
}

/** Quality categories that mark a phrase as institutional rather than
 *  personal. Same vocabulary the UI's INSTITUTIONAL_CATEGORIES uses;
 *  duplicated for the engines/-must-not-import-ui/ reason, and pinned
 *  against it by verify/document-name-evidence-verification.ts. */
export const INSTITUTIONAL_WITNESS_CATEGORIES: readonly string[] = [
  "institution-term",
  "department-organization",
  "organization-suffix",
  "product-system-name",
  "document-structure-term",
];

/**
 * Evidence for ONE candidate. `fullNameTokens` comes from
 * buildFullNameTokenIndex over the same document.
 */
export function documentNameEvidenceFor(
  candidate: NameEvidenceCandidate,
  inputs: Pick<DocumentNameEvidenceInputs, "ambiguityProposalCandidateIds" | "entityGroupMemberIds">,
  fullNameTokens: ReadonlyMap<string, string>
): DocumentNameEvidence {
  const sources: DocumentNameEvidenceSource[] = [];
  if (inputs.ambiguityProposalCandidateIds.has(candidate.id)) sources.push("ambiguity-proposal");
  if (inputs.entityGroupMemberIds.has(candidate.id)) sources.push("entity-group-member");

  let witness: string | undefined;
  if (candidate.detectedType === "person") {
    const tokens = nameTokens(candidate.displayValue);
    // Only a SINGLE-token candidate can be settled this way. A multi-token
    // candidate matching its own tokens would be trivially self-witnessing.
    if (tokens.length === 1) {
      const found = fullNameTokens.get(tokens[0]!);
      if (found !== undefined && found !== candidate.displayValue) {
        sources.push("full-name-token");
        witness = found;
      }
    }
  }

  return { has: sources.length > 0, sources, ...(witness !== undefined ? { witness } : {}) };
}
