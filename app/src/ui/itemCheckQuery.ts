/**
 * itemCheckQuery.ts -- Milestone 2 ("Review at Scale"). Pure, DOM-free
 * search/filter/sort logic for Item Check's candidate list, extracted into
 * its own module (rather than living inline in app.ts the way Milestone 1's
 * smaller categoryReviewState/categoryFilter did) because this is
 * meaningfully more complex -- a free-text search across several fields, an
 * eight-way combinable filter-preset set, and five sort orders -- and
 * deserves to be independently unit-testable without a DOM (see
 * verify/milestone-2-review-at-scale-verification.ts).
 *
 * ARCHITECTURAL BOUNDARY: this is UI-layer ephemeral state and pure display
 * logic (architecture v0.2 §7.3), NOT domain logic. It narrows/orders which
 * of Item Check's ALREADY-COMPUTED candidates are rendered; it never reads
 * or writes ReviewSession, never computes resolved/unresolved status beyond
 * a plain "does this candidate have a CandidateDecision" check (the same
 * simple check app.ts's itemCheckCandidateStatus() already uses), and never
 * duplicates CandidateQualityEngine's/EntityResolutionEngine's own logic --
 * it only reads their already-produced output (likelihood, categories,
 * ambiguity membership) through the CandidateQueryFacts a caller builds.
 *
 * SCOPE DECISION: search/filter/sort/multi-select are scoped to Item Check
 * only, not Ambiguity Check. Ambiguity Check's candidate set is inherently
 * small (only candidates with 2+ plausible group homes); the "review
 * documents with several thousand candidates" problem these tools answer is
 * specifically an Item Check (the exhaustive candidate list) problem. See
 * docs/detection/milestone-2-review-at-scale.md.
 */

import type { Candidate } from "../domain/DocumentModel.js";
import type { CandidateDecision } from "../domain/ReviewSession.js";

export type FilterPreset =
  | "unreviewed"
  | "high-confidence"
  | "ambiguous"
  | "people"
  | "organizations"
  | "ignored"
  | "renamed"
  | "redacted";

export const FILTER_PRESETS: readonly { key: FilterPreset; label: string }[] = [
  { key: "unreviewed", label: "Unreviewed only" },
  { key: "high-confidence", label: "High confidence" },
  { key: "ambiguous", label: "Ambiguous" },
  { key: "people", label: "People" },
  { key: "organizations", label: "Organizations" },
  { key: "ignored", label: "Ignored" },
  { key: "renamed", label: "Renamed" },
  { key: "redacted", label: "Redacted" },
];

/**
 * Threshold for "High confidence" -- reuses app.ts's OWN existing
 * confidenceBadgeClass() threshold for its "good" (green) band, rather than
 * inventing a second, potentially-divergent number. A candidate is
 * "high confidence" exactly when its badge would already render green.
 */
export const HIGH_CONFIDENCE_THRESHOLD = 90;

/**
 * "Organizations" design decision: this pipeline's DetectionEngine never
 * assigns a `detectedType` of "organization" -- confirmed directly against
 * DetectionEngine.ts, which only ever produces "person" | "email" | "phone"
 * | "cin" | "long_numeric_id" (a faithful port of Python's own regex+person
 * detectors; there is no NER-based organization detector in either the
 * Python oracle or this port). A literal `detectedType === "organization"`
 * filter would therefore match zero candidates forever -- a silently
 * useless control, not a real filter. Instead, "Organizations" matches
 * candidates carrying ANY of CandidateQualityEngine's organization-signaling
 * evidence categories (the same 35-category vocabulary Category Check
 * already surfaces, see category-rule-labels.data.ts) -- i.e. a candidate
 * that was detected as a possible person but whose evidence suggests it is
 * actually an organization/department/institution name. This is the closest
 * honest match to Andrew's request given what this pipeline actually
 * detects, documented here rather than silently building a dead filter.
 */
export const ORGANIZATION_EVIDENCE_CATEGORIES: readonly string[] = [
  "department-organization",
  "institution-acronym",
  "institution-term",
  "organization-suffix",
];

export type SortOrder =
  | "confidence-desc"
  | "confidence-asc"
  | "occurrence-count-desc"
  | "occurrence-count-asc"
  | "alphabetical"
  | "review-state"
  | "entity-type";

export const SORT_ORDERS: readonly { key: SortOrder; label: string }[] = [
  { key: "confidence-desc", label: "Confidence (high to low)" },
  { key: "confidence-asc", label: "Confidence (low to high)" },
  { key: "occurrence-count-desc", label: "Occurrences (most to fewest)" },
  { key: "occurrence-count-asc", label: "Occurrences (fewest to most)" },
  { key: "alphabetical", label: "Alphabetical (A to Z)" },
  { key: "review-state", label: "Review state (unreviewed first)" },
  { key: "entity-type", label: "Entity type" },
];

export interface ItemCheckQueryState {
  searchText: string;
  activePresets: ReadonlySet<FilterPreset>;
  sortOrder: SortOrder;
}

export function createDefaultQueryState(): ItemCheckQueryState {
  return { searchText: "", activePresets: new Set(), sortOrder: "confidence-desc" };
}

/** Everything queryItemCheck() needs about one candidate, gathered by the
 *  caller from WorkspaceState (app.ts already computes all of these for
 *  rendering -- this is not new data, just a stable shape to query over). */
export interface CandidateQueryFacts {
  candidate: Candidate;
  likelihood: number | undefined;
  decision: CandidateDecision | undefined;
  /** True iff this candidate appears in GroupingResult.ambiguityProposals. */
  isAmbiguous: boolean;
  /** Evidence-category rule ids (already kebab-case-normalized -- see
   *  candidateCategories() in app.ts). */
  categories: string[];
}

/** Case-insensitive substring match across every field Andrew's "Item Check
 *  Search" instruction names: text, replacement text, category, review
 *  state, likelihood, ambiguity, entity type. A single free-text box
 *  matching across a joined haystack (rather than per-field query syntax)
 *  -- consistent with Python's own single search-bar model per the
 *  reconstruction doc (§1.1: "its own search/type-filter/sort/direction/
 *  page-size bar"), which this milestone re-implements, not redesigns. */
export function matchesSearch(facts: CandidateQueryFacts, searchText: string): boolean {
  const query = searchText.trim().toLowerCase();
  if (!query) return true;
  const reviewStateLabel = facts.decision ? facts.decision.decision : "unreviewed";
  const haystack = [
    facts.candidate.displayValue,
    facts.decision?.replacement ?? "",
    facts.candidate.detectedType,
    reviewStateLabel,
    facts.likelihood !== undefined ? `${facts.likelihood}%` : "",
    facts.isAmbiguous ? "ambiguous ambiguity" : "",
    ...facts.categories,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

/** Whether `facts` satisfies ONE named preset. */
export function matchesPreset(facts: CandidateQueryFacts, preset: FilterPreset): boolean {
  switch (preset) {
    case "unreviewed":
      return facts.decision === undefined;
    case "high-confidence":
      return (facts.likelihood ?? 0) >= HIGH_CONFIDENCE_THRESHOLD;
    case "ambiguous":
      return facts.isAmbiguous;
    case "people":
      return facts.candidate.detectedType === "person";
    case "organizations":
      return facts.categories.some((c) => ORGANIZATION_EVIDENCE_CATEGORIES.includes(c));
    case "ignored":
      return facts.decision?.decision === "Ignore";
    case "renamed":
      return facts.decision?.decision === "Rename";
    case "redacted":
      return facts.decision?.decision === "Redact";
    default: {
      const exhaustive: never = preset;
      return exhaustive;
    }
  }
}

/** Multiple active presets combine with AND (a candidate must satisfy every
 *  active preset), matching how Andrew's "Support combinations such as..."
 *  phrasing reads as a reviewer stacking narrowing constraints ("show me
 *  unreviewed AND high-confidence AND people"), not an OR of independent
 *  buckets -- and matching checkbox-group UI conventions generally (each
 *  checked box narrows further). Documented here since it is a real,
 *  non-obvious semantic choice, not an accident of implementation. */
export function matchesAllActivePresets(facts: CandidateQueryFacts, activePresets: ReadonlySet<FilterPreset>): boolean {
  for (const preset of activePresets) {
    if (!matchesPreset(facts, preset)) return false;
  }
  return true;
}

const REVIEW_STATE_SORT_RANK: Record<string, number> = { unreviewed: 0, Rename: 1, Redact: 1, Ignore: 1, Keep: 1 };

function reviewStateRank(facts: CandidateQueryFacts): number {
  return REVIEW_STATE_SORT_RANK[facts.decision?.decision ?? "unreviewed"] ?? 1;
}

/** Deterministic comparator for one SortOrder. Every branch ends with a
 *  final tie-break on candidate.id so results stay stable and directly
 *  testable (never relies on the input array's own incidental order once
 *  two candidates compare equal on the primary key). Candidates with no
 *  QualityResult yet (likelihood undefined) sort as if likelihood were -1,
 *  so an unscored candidate lands at the "least confident" end regardless
 *  of direction -- a defined, documented tie-break rather than undefined
 *  behavior (Array.prototype.sort with a comparator that sometimes returns
 *  NaN would be a real bug here, not a style nit). */
export function compareCandidates(a: CandidateQueryFacts, b: CandidateQueryFacts, order: SortOrder): number {
  const idTiebreak = () => a.candidate.id.localeCompare(b.candidate.id);
  switch (order) {
    case "confidence-desc":
      return (b.likelihood ?? -1) - (a.likelihood ?? -1) || idTiebreak();
    case "confidence-asc":
      return (a.likelihood ?? -1) - (b.likelihood ?? -1) || idTiebreak();
    case "occurrence-count-desc":
      return b.candidate.occurrenceIds.length - a.candidate.occurrenceIds.length || idTiebreak();
    case "occurrence-count-asc":
      return a.candidate.occurrenceIds.length - b.candidate.occurrenceIds.length || idTiebreak();
    case "alphabetical":
      return a.candidate.displayValue.localeCompare(b.candidate.displayValue) || idTiebreak();
    case "review-state":
      return reviewStateRank(a) - reviewStateRank(b) || a.candidate.displayValue.localeCompare(b.candidate.displayValue) || idTiebreak();
    case "entity-type":
      return a.candidate.detectedType.localeCompare(b.candidate.detectedType) || a.candidate.displayValue.localeCompare(b.candidate.displayValue) || idTiebreak();
    default: {
      const exhaustive: never = order;
      return exhaustive;
    }
  }
}

/** Filters by search text AND every active preset, then sorts -- the one
 *  entry point app.ts calls. Pure function of its inputs; no hidden state. */
export function queryItemCheck(facts: CandidateQueryFacts[], query: ItemCheckQueryState): CandidateQueryFacts[] {
  const filtered = facts.filter((f) => matchesSearch(f, query.searchText) && matchesAllActivePresets(f, query.activePresets));
  return [...filtered].sort((a, b) => compareCandidates(a, b, query.sortOrder));
}
