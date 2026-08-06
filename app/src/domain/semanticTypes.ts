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
  if (facts.detectedType === "person" && has(facts, "known-personal-name-token", "known-first-name", "known-name-structure", "strong-name-structure", "surname-given-structure")) {
    return "people";
  }
  return "other";
}

export interface SemanticTypeItem {
  id: string;
  type: SemanticTypeId;
  occurrenceCount: number;
  decided: boolean;
}

export interface SemanticTypeSummary {
  id: SemanticTypeId;
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
  const byType = new Map<SemanticTypeId, SemanticTypeSummary>();
  for (const item of items) {
    const existing = byType.get(item.type) ?? {
      id: item.type,
      label: SEMANTIC_TYPE_LABELS[item.type],
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
  return SEMANTIC_TYPE_ORDER.filter((id) => byType.has(id)).map((id) => byType.get(id)!);
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
  typeId: SemanticTypeId;
  candidateIds: readonly string[];
}

/** Folds a per-candidate assignment (insertion-ordered, as produced by
 *  iterating DetectionResult.candidates) into the ordered, populated-only
 *  group list. */
export function buildSemanticTypeGroups(assignments: ReadonlyMap<string, SemanticTypeId>): SemanticTypeGroup[] {
  const byType = new Map<SemanticTypeId, string[]>();
  for (const [candidateId, typeId] of assignments) {
    const existing = byType.get(typeId);
    if (existing) existing.push(candidateId);
    else byType.set(typeId, [candidateId]);
  }
  return SEMANTIC_TYPE_ORDER.filter((id) => byType.has(id)).map((typeId) => ({ typeId, candidateIds: byType.get(typeId)! }));
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
  return assessment.filterRules.length ? assessment.filterRules : assessment.reasons;
}
