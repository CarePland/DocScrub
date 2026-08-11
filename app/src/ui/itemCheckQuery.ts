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
import { decisionDisplayLabel } from "./decisionLabels.js";
import type { ReviewNecessity } from "../engines/review/reviewNecessity.js";

export type FilterPreset =
  | "unreviewed"
  | "high-confidence"
  | "ambiguous"
  | "people"
  | "organizations"
  | "ignored"
  | "renamed"
  | "redacted"
  /* REVIEW NECESSITY (AG, 2026-08-10). Unlike every other preset, this one
   * REVEALS rather than narrows -- see UNLIKELY_PRESET's note below. */
  | "unlikely";

export const FILTER_PRESETS: readonly { key: FilterPreset; label: string }[] = [
  { key: "unreviewed", label: "Unreviewed only" },
  { key: "high-confidence", label: "High confidence" },
  { key: "ambiguous", label: "Ambiguous" },
  { key: "people", label: "People" },
  { key: "organizations", label: "Organizations" },
  { key: "ignored", label: "Ignored" },
  // RX-22 (2026-07-29): "Changed", matching the display vocabulary
  // everywhere else (the buttons have said "Change" since the Group Check
  // keyboard revision). The KEY stays "renamed" -- it is never shown, and
  // preset keys are ephemeral UI state, not worth churning.
  { key: "renamed", label: "Changed" },
  { key: "redacted", label: "Redacted" },
  { key: "unlikely", label: "Unlikely" },
];

/**
 * THE ONE PRESET THAT REVEALS INSTEAD OF NARROWING (AG, 2026-08-10).
 *
 * Every other preset filters DOWN from a population the reviewer can already
 * see. Unlikely candidates are excluded from the active-review conveyor by
 * default -- they are the population this preset exists to bring BACK.
 *
 * That asymmetry is handled in exactly one place (`queryItemCheck`), so no
 * consumer can accidentally get a list that disagrees with navigation: the
 * candidate list, the navigable id list and every count all flow through it.
 */
export const UNLIKELY_PRESET: FilterPreset = "unlikely";

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
  /**
   * REVIEW NECESSITY (AG, 2026-08-10), computed by
   * `engines/review/reviewNecessity.ts` from the already-derived
   * interpretation profile. NOT recomputed here and NOT derivable from the
   * other fields on this record -- the UI layer owns no semantic logic.
   *
   * Optional so every existing caller and test that builds these facts keeps
   * compiling and keeps behaving exactly as before: absent means
   * "review-required", which is the safe default.
   */
  reviewNecessity?: ReviewNecessity;
  /** The single surviving reading when Unlikely, for display and search.
   *  Absent otherwise. */
  unlikelyExplanation?: string;
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
  // RX-22 (2026-07-29): the haystack carries BOTH the durable kind
  // ("Rename" -- still matches for anyone typing the audit vocabulary) and
  // the display label ("Change" -- what the reviewer actually sees on every
  // button and row). Additive: nothing that matched before stops matching.
  const reviewStateLabel = facts.decision ? `${facts.decision.decision} ${decisionDisplayLabel(facts.decision.decision)}` : "unreviewed";
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
    case "unlikely":
      return facts.reviewNecessity === "unlikely";
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

/**
 * DECISION-STATE PRESETS -- the presets that only ever match an ALREADY
 * DECIDED candidate. Named once here because two things need the same
 * list and must not drift: matchesPreset above, and the escape hatch
 * below.
 */
const DECIDED_ONLY_PRESETS: readonly FilterPreset[] = ["ignored", "renamed", "redacted"];

/**
 * THE ESCAPE HATCH (AG, 2026-08-02, "Item Check shows remaining work").
 * Item Check's pool is now the WORK QUEUE -- unresolved candidates only
 * (see stages.ts's reviewableItemIdsForStage) -- so a decided candidate is
 * off the list the moment it is decided. This predicate says when the
 * reviewer has explicitly asked to see decided work anyway, and app.ts
 * widens the pool back to the full candidate inventory for exactly those
 * cases.
 *
 * Two triggers, both an unambiguous request rather than a guess:
 *   - SEARCH TEXT. Andrew's instruction is explicit that "the entity, its
 *     review history, audit information, and searchability should all
 *     remain intact." Typing a name and being told it does not exist --
 *     because it was decided ten minutes ago -- would break that promise
 *     and, worse, would read as data loss rather than as a filtered view.
 *     Search therefore always searches everything.
 *   - A DECISION-STATE PRESET. "Ignored" / "Changed" / "Redacted" can only
 *     ever match decided candidates. Left against the work queue alone
 *     they would match nothing, forever -- three controls that look
 *     functional and silently are not. This file already refused to ship
 *     one of those once (see ORGANIZATION_EVIDENCE_CATEGORIES' note on
 *     dead filters); it should not ship three more by accident.
 *
 * "Unreviewed only" deliberately stays in the preset list even though it
 * is now the default state of the pool: it is the way back to remaining
 * work WITHOUT clearing an active search, which is precisely the moment a
 * reviewer wants it.
 */
export function queryRequestsDecidedItems(query: ItemCheckQueryState): boolean {
  if (query.searchText.trim().length > 0) return true;
  return DECIDED_ONLY_PRESETS.some((preset) => query.activePresets.has(preset));
}

/** Filters by search text AND every active preset, then sorts -- the one
 *  entry point app.ts calls. Pure function of its inputs; no hidden state. */
export function queryItemCheck(facts: CandidateQueryFacts[], query: ItemCheckQueryState): CandidateQueryFacts[] {
  /*
   * THE ONE PLACE UNLIKELY IS EXCLUDED (AG, 2026-08-10).
   *
   * Unlikely candidates are held out of the active-review conveyor unless the
   * reviewer asks for them. Doing it here -- rather than at each call site --
   * is what keeps the rendered list, the navigable id list and every count
   * derived from them in agreement. A second exclusion elsewhere would be a
   * bug, not a defence.
   *
   * THE CANDIDATE IS NOT REMOVED FROM ANYTHING ELSE. It stays in
   * WorkspaceState, in the audit, in entity resolution and in the exported
   * document; only this list narrows.
   */
  const revealUnlikely = query.activePresets.has(UNLIKELY_PRESET);
  const visible = revealUnlikely ? facts : facts.filter((f) => f.reviewNecessity !== "unlikely");
  const filtered = visible.filter((f) => matchesSearch(f, query.searchText) && matchesAllActivePresets(f, query.activePresets));
  return [...filtered].sort((a, b) => compareCandidates(a, b, query.sortOrder));
}

/** How many of these facts are held out of active review. Counted from the
 *  SAME field the exclusion reads, so a count can never disagree with the
 *  list it describes. */
export function unlikelyCount(facts: readonly CandidateQueryFacts[]): number {
  return facts.filter((f) => f.reviewNecessity === "unlikely").length;
}
