/**
 * resolution.ts -- faithful port of redactor/entity_resolution.py's
 * build_entity_groups(), build_ambiguous_matches(), and
 * calculate_entity_confidence(), plus every helper they depend on. See
 * docs/detection/phase-6-findings.md for the full port record and every
 * documented deviation.
 *
 * SHAPE DIFFERENCES from Python, and how this file bridges them:
 *
 * 1. Python's `Candidate` is one flat dataclass carrying `text`,
 *    `detected_type`, `confidence`, `quality`, and `count` (a property,
 *    `len(occurrences)`) all together. The TS domain model splits this
 *    across two objects: `Candidate` (src/domain/DocumentModel.ts, has
 *    `displayValue`/`detectedType`/`confidence`/`occurrenceIds`) and
 *    `QualityResult.assessmentByCandidate[id].quality`
 *    (src/domain/Evidence.ts, from CandidateQualityEngine). Every function
 *    below that needs "quality" takes a `qualityOf(candidateId): QualityLabel`
 *    lookup instead of reading `candidate.quality` directly -- mirrors how
 *    scoring.ts's functions take explicit `occurrences`/`blocksById`
 *    parameters rather than reading nested fields Python has but TS
 *    doesn't. `candidate.count` = `candidate.occurrenceIds.length`.
 *
 * 2. `redactor/entity_resolution.py`'s own `_tokens()` does NOT apply
 *    Python's `unicodedata.normalize("NFKC", text)` first (unlike
 *    `candidate_quality.py`'s `_tokens()`, which does) -- confirmed by
 *    reading both source functions side by side. Ported faithfully as a
 *    genuine, if minor, asymmetry between the two Python modules, not
 *    normalized away.
 *
 * 3. `_clean_token()` uses Python's `str.casefold()` -- same documented
 *    casefold-vs-toLowerCase deviation as Phase 4/5 (ASCII-range verified,
 *    zero observed impact).
 *
 * 4. `difflib.SequenceMatcher(None, a, b).ratio()` has no JS equivalent, so
 *    it's ported directly (see ./sequence-ratio.ts) rather than
 *    approximated with a different similarity metric -- confidence scores
 *    must match Python's exactly, not just "be similarly shaped."
 *
 * 5. Python's two exclusion filters in `build_entity_groups` (the
 *    bucket-building `removed_keys` check, and a second per-key
 *    `included = [... if candidate.key not in exclusions.get(key, [])]`
 *    filter later) are PROVABLY REDUNDANT: `removed_keys` is the union of
 *    every value across the whole `exclusions` dict
 *    (`_excluded_keys`), so any candidate the second filter would ever
 *    remove was already excluded from `members` by the first filter and
 *    could never reach the second check. Confirmed by reading
 *    `_excluded_keys()`'s definition. This port applies the removal once
 *    (at bucket-building time) rather than mechanically reproducing dead
 *    code -- behaviorally identical, not a deviation.
 *
 * DISCLOSED BEHAVIORAL CHANGE (2026-07-28), NOT a parity deviation from an
 * accidental TS bug -- this is a real defect in Python's OWN
 * build_entity_groups()/build_ambiguous_matches(), ported faithfully at
 * first, then deliberately corrected here after Andrew traced it against a
 * real document (a full name mentioned with exactly one spelling, followed
 * by bare first-name references). Two compounding problems existed in both
 * the Python oracle and the original port:
 *
 *   (a) `build_ambiguous_matches()` sourced its "which entities could this
 *   first name plausibly refer to" evidence from the FINAL, already-
 *   filtered `groups` list -- i.e. only person buckets that independently
 *   reached the >=2-member threshold `build_entity_groups()` requires for
 *   real grouping (typically via a spelling-variant pair like "Andrew
 *   Goodloe" + "A. Goodloe"). A person mentioned with only ONE full-name
 *   spelling never reaches that threshold on its own and was therefore
 *   invisible to ambiguity matching entirely -- not merged, not flagged,
 *   just silently absent from both `groups` and `ambiguous`.
 *
 *   (b) Separately, `build_entity_groups()` auto-merged a first-name-only
 *   candidate into a bucket whenever EXACTLY ONE full-name bucket matched
 *   its first name -- silently, before Ambiguity Check ever saw it, with no
 *   reviewer confirmation, no event, no audit trail. Combined with (a):
 *   exactly one match => silent unreviewable auto-merge; two or more
 *   matches => neither full-name bucket reaches the threshold on its own
 *   (each stays at size 1), so NO group forms and NO ambiguity is proposed
 *   either -- the first name falls through as an ordinary, disconnected
 *   candidate that never gets linked to anyone.
 *
 * Fix: `buildAmbiguousMatches` now derives its evidence from
 * `buildFullNameAnchorBuckets()` -- every detected full-name (2+ token)
 * person entity, INCLUDING solitary ones that never independently reach the
 * grouping threshold -- and proposes ambiguity whenever ONE OR MORE anchors
 * match (not only two or more). `buildEntityGroups` no longer auto-merges a
 * first-name-only candidate into any bucket at all; that decision is now
 * always a reviewer action via the new `linkAmbiguousCandidate` command
 * (session.ts), never an automatic one. See
 * docs/detection/ambiguity-anchor-correction.md for the full trace,
 * regression analysis, and verification record.
 */

import type { Candidate } from "../../domain/DocumentModel.js";
import type { QualityLabel } from "../../domain/Evidence.js";
import { sequenceRatio } from "./sequence-ratio.js";

// ---- Ported helpers (entity_resolution.py lines 31-90) ------------------

// def _tokens(text: str) -> list[str]:
// NOTE: no NFKC normalization here -- see this file's doc comment, point 2.
const TOKEN_RE = /[A-Za-z][A-Za-z'’.-]*/g;
function tokens(text: string): string[] {
  return text.match(TOKEN_RE) ?? [];
}

// def _clean_token(token: str) -> str:
function cleanToken(token: string): string {
  // Python's str.strip(" .,'’") strips any of these chars from both ends,
  // any number of times, in any order -- not a fixed prefix/suffix.
  return token.replace(/^[ .,'’]+|[ .,'’]+$/g, "").toLowerCase();
}

// def _display_name(text: str) -> str:
function displayName(text: string): string {
  const compact = text.trim().replace(/\s+/g, " ");
  const commaIndex = compact.indexOf(",");
  if (commaIndex >= 0) {
    const left = compact.slice(0, commaIndex).trim();
    const right = compact.slice(commaIndex + 1).trim();
    if (left && right) {
      return `${right} ${left}`;
    }
  }
  return compact;
}

// def _person_group_key(candidate: Candidate) -> str:
function personGroupKey(candidate: Candidate): string {
  const display = displayName(candidate.displayValue);
  const cleanTokens = tokens(display)
    .map(cleanToken)
    .filter((t) => t.length > 0);
  if (cleanTokens.length >= 2) {
    const first = cleanTokens[0]!;
    const last = cleanTokens[cleanTokens.length - 1]!;
    return `person:${last}:${first.slice(0, 1)}`;
  }
  return `person-single:${candidate.id}`;
}

// def _group_key(candidate: Candidate) -> str:
function groupKey(candidate: Candidate): string {
  if (candidate.detectedType === "person") {
    return personGroupKey(candidate);
  }
  return `${candidate.detectedType}:${candidate.id}`;
}

// def _person_tokens(candidate: Candidate) -> list[str]:
function personTokens(candidate: Candidate): string[] {
  return tokens(displayName(candidate.displayValue))
    .map(cleanToken)
    .filter((t) => t.length > 0);
}

// def _is_short_person_reference(candidate: Candidate) -> bool:
function isShortPersonReference(candidate: Candidate): boolean {
  return candidate.detectedType === "person" && personTokens(candidate).length === 1;
}

// def _excluded_keys(exclusions: dict[str, list[str]]) -> set[str]:
function excludedKeys(exclusions: Record<string, string[]>): Set<string> {
  const result = new Set<string>();
  for (const keys of Object.values(exclusions)) {
    for (const key of keys) result.add(key);
  }
  return result;
}

/** Looks up a candidate's quality label -- see this file's doc comment,
 *  point 1. Matches Python's Candidate.quality dataclass default
 *  ("Possible", models.py) when no assessment is present. */
export type QualityLookup = (candidateId: string) => QualityLabel;

/**
 * Python's built-in `round()` uses round-half-to-even ("banker's
 * rounding"), unlike JS's `Math.round()`, which always rounds .5 up
 * (toward +Infinity). `calculate_entity_confidence()` is the one place in
 * this port that calls Python's `round()`, so this helper exists
 * specifically to avoid a silent off-by-one on exact .5 ties -- a
 * documented deviation-avoidance, not a hypothetical concern, since the
 * inputs here (a weighted average of integer member scores) can land
 * exactly on .5.
 */
function pythonRound(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff < 0.5) return floor;
  if (diff > 0.5) return floor + 1;
  // Exactly .5: round to even.
  return floor % 2 === 0 ? floor : floor + 1;
}

// def _member_score(group_name: str, candidate: Candidate) -> int:
function memberScore(groupName: string, candidate: Candidate, qualityOf: QualityLookup): number {
  const ratio = sequenceRatio(groupName.toLowerCase(), displayName(candidate.displayValue).toLowerCase());
  let score = Math.trunc(70 + ratio * 25);
  if (candidate.confidence === "high") score += 5;
  else if (candidate.confidence === "low") score -= 5;
  const quality = qualityOf(candidate.id);
  if (quality === "Strong") score += 5;
  else if (quality === "Unlikely") score -= 20;
  if (tokens(candidate.displayValue).length === 1) score -= 12;
  return Math.max(35, Math.min(99, score));
}

// ---- Public result shapes (mirror Python's EntityGroup / AmbiguousEntityMatch) ---

export interface EntityGroupResult {
  id: string;
  canonicalName: string;
  detectedType: string;
  candidateKeys: string[];
  confidence: number;
  memberConfidences: Record<string, number>;
  reasons: string[];
}

export interface AmbiguousGroupOption {
  id: string;
  canonicalName: string;
  confidence: number;
}

export interface AmbiguousEntityMatchResult {
  candidateKey: string;
  possibleGroups: AmbiguousGroupOption[];
}

// ---- build_entity_groups (lines 124-186) --------------------------------

/**
 * Faithful port of `build_entity_groups(candidates, exclusions,
 * force_review_keys)`. `candidates` must be in the same order the caller
 * received them from DetectionEngine -- canonical-candidate tie-breaking
 * (see below) depends on first-seen order, exactly as Python's `max()`
 * over a list built by iterating `candidates` in order does.
 */
export function buildEntityGroups(
  candidates: Candidate[],
  qualityOf: QualityLookup,
  exclusions: Record<string, string[]> = {},
  forceReviewKeys: Set<string> = new Set()
): EntityGroupResult[] {
  const removedKeys = new Set<string>([...excludedKeys(exclusions), ...forceReviewKeys]);
  const buckets = new Map<string, Candidate[]>();

  // A first-name-only candidate is NEVER auto-merged into any bucket here --
  // see this file's top doc comment, "DISCLOSED BEHAVIORAL CHANGE." Whether
  // it plausibly belongs to a full-name entity is exactly what Ambiguity
  // Check (buildAmbiguousMatches, below) exists to ask the reviewer, not
  // something this function decides unilaterally. isShortPersonReference()
  // candidates are simply skipped here; they can never form a group on
  // their own (personGroupKey() gives each a unique person-single:{id} key
  // when reached), so explicitly skipping is equivalent to letting them
  // through and filtered out by the size check below, but is clearer about
  // intent for future readers.
  for (const candidate of candidates) {
    if (removedKeys.has(candidate.id)) continue;
    if (isShortPersonReference(candidate)) continue;
    const key = groupKey(candidate);
    const list = buckets.get(key);
    if (list) list.push(candidate);
    else buckets.set(key, [candidate]);
  }

  const groups: EntityGroupResult[] = [];
  for (const [key, members] of buckets) {
    // Python applies a second exclusion filter here; provably redundant
    // given removedKeys already excludes every such candidate before it
    // could reach `members` -- see this file's doc comment, point 5.
    const included = members;
    if (included.length < 2) continue;

    let canonical = included[0]!;
    for (const item of included.slice(1)) {
      const a: [number, number, number] = [tokens(item.displayValue).length, item.occurrenceIds.length, item.displayValue.length];
      const b: [number, number, number] = [tokens(canonical.displayValue).length, canonical.occurrenceIds.length, canonical.displayValue.length];
      // Python's max() keeps the FIRST element on ties (strictly-greater
      // replacement only) -- replicate with a strict lexicographic `>`.
      if (a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2])))) {
        canonical = item;
      }
    }
    const canonicalName = displayName(canonical.displayValue);
    const memberConfidences: Record<string, number> = {};
    for (const candidate of included) {
      memberConfidences[candidate.id] = memberScore(canonicalName, candidate, qualityOf);
    }
    const scores = Object.values(memberConfidences);
    let confidence = scores.length > 1 ? Math.min(...scores) : scores[0]!;

    const reasons = ["deterministic_grouping", "shared_name_signature"];
    // members vs included are identical given point 5 above, so this
    // condition (Python's `exclusions.get(key, [])` check against members)
    // can never be true here -- kept structurally for faithfulness/
    // documentation, not because it can fire.
    const hasReviewerRemovedMember = members.some((c) => (exclusions[key] ?? []).includes(c.id));
    if (hasReviewerRemovedMember) {
      reasons.push("reviewer_removed_member");
      confidence = Math.max(35, confidence - 8);
    }

    groups.push({
      id: key,
      canonicalName,
      detectedType: canonical.detectedType,
      candidateKeys: included.map((c) => c.id),
      confidence,
      memberConfidences,
      reasons,
    });
  }

  return groups.sort((a, b) => {
    if (b.candidateKeys.length !== a.candidateKeys.length) return b.candidateKeys.length - a.candidateKeys.length;
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    // Plain codepoint comparison, matching Python's `<` on strings --
    // NOT localeCompare(), which applies locale-aware collation Python's
    // sorted() does not use. See buildAmbiguousMatches' sort below for the
    // same consideration.
    const an = a.canonicalName.toLowerCase();
    const bn = b.canonicalName.toLowerCase();
    return an < bn ? -1 : an > bn ? 1 : 0;
  });
}

// ---- Anchor buckets: the "does a plausible entity exist" evidence source
// for ambiguity matching. See this file's top doc comment, "DISCLOSED
// BEHAVIORAL CHANGE." -------------------------------------------------

/**
 * Every detected full-name (2+ token) person candidate, grouped by the same
 * `last-name:first-initial` key `buildEntityGroups` uses -- but WITHOUT that
 * function's >=2-member threshold. A person mentioned with only one
 * spelling variant is just as real an entity as one mentioned with several;
 * they simply differ in how many independent candidates support them. This
 * is the anchor set a bare first-name reference is matched against for
 * Ambiguity Check purposes -- deliberately a superset of `buildEntityGroups`'
 * own realized `groups`, not a replacement for it (a bucket that reaches
 * size >=2 becomes both a real group AND an anchor with the same id, so a
 * reviewer's eventual `linkAmbiguousCandidate` groupId always resolves to
 * whichever of the two is real).
 */
function buildFullNameAnchorBuckets(candidates: Candidate[]): Map<string, Candidate[]> {
  const buckets = new Map<string, Candidate[]>();
  for (const candidate of candidates) {
    if (candidate.detectedType !== "person") continue;
    if (personTokens(candidate).length < 2) continue;
    const key = personGroupKey(candidate);
    const list = buckets.get(key);
    if (list) list.push(candidate);
    else buckets.set(key, [candidate]);
  }
  return buckets;
}

interface AnchorOption {
  key: string;
  canonicalName: string;
  confidence: number;
}

/** Scores an anchor bucket exactly the way buildEntityGroups scores a real
 *  group (same canonical-selection tie-break, same memberScore formula, same
 *  min-of-scores confidence rule) so a solitary anchor and a multi-variant
 *  one are never scored by two different rules. */
function scoreAnchorBucket(key: string, members: Candidate[], qualityOf: QualityLookup): AnchorOption | null {
  if (members.length === 0) return null;
  let canonical = members[0]!;
  for (const item of members.slice(1)) {
    const a: [number, number, number] = [tokens(item.displayValue).length, item.occurrenceIds.length, item.displayValue.length];
    const b: [number, number, number] = [tokens(canonical.displayValue).length, canonical.occurrenceIds.length, canonical.displayValue.length];
    if (a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] > b[2])))) canonical = item;
  }
  const canonicalName = displayName(canonical.displayValue);
  const scores = members.map((m) => memberScore(canonicalName, m, qualityOf));
  const confidence = scores.length > 1 ? Math.min(...scores) : scores[0]!;
  return { key, canonicalName, confidence };
}

// ---- build_ambiguous_matches (lines 189-228, corrected -- see top doc comment) --

export function buildAmbiguousMatches(
  candidates: Candidate[],
  groups: EntityGroupResult[],
  qualityOf: QualityLookup,
  exclusions: Record<string, string[]> = {},
  forceReviewKeys: Set<string> = new Set()
): AmbiguousEntityMatchResult[] {
  const unavailableKeys = new Set<string>([...excludedKeys(exclusions), ...forceReviewKeys]);
  const groupedKeys = new Set<string>();
  for (const group of groups) for (const key of group.candidateKeys) groupedKeys.add(key);

  const anchorBuckets = buildFullNameAnchorBuckets(candidates);
  const firstNameToAnchors = new Map<string, AnchorOption[]>();
  for (const [key, members] of anchorBuckets) {
    const eligibleMembers = members.filter((m) => !unavailableKeys.has(m.id));
    if (eligibleMembers.length === 0) continue;
    const option = scoreAnchorBucket(key, eligibleMembers, qualityOf);
    if (!option) continue;
    const nameTokens = tokens(option.canonicalName);
    const first = nameTokens.length > 0 ? cleanToken(nameTokens[0]!) : "";
    if (!first) continue;
    const list = firstNameToAnchors.get(first);
    if (list) list.push(option);
    else firstNameToAnchors.set(first, [option]);
  }

  const matches: AmbiguousEntityMatchResult[] = [];
  for (const candidate of candidates) {
    if (groupedKeys.has(candidate.id) || unavailableKeys.has(candidate.id)) continue;
    if (!isShortPersonReference(candidate)) continue;
    const token = personTokens(candidate)[0]!;
    // CHANGED (see top doc comment): >=1 plausible anchor is enough to
    // route to Ambiguity Check now, not only >=2. A single candidate entity
    // still gets presented as a possibility the reviewer confirms or
    // declines -- it is never auto-linked.
    const possible = firstNameToAnchors.get(token) ?? [];
    if (possible.length === 0) continue;
    matches.push({
      candidateKey: candidate.id,
      possibleGroups: possible.map((anchor) => ({
        id: anchor.key,
        canonicalName: anchor.canonicalName,
        confidence: anchor.confidence,
      })),
    });
  }

  return matches.sort((a, b) => {
    const ak = a.candidateKey.toLowerCase();
    const bk = b.candidateKey.toLowerCase();
    return ak < bk ? -1 : ak > bk ? 1 : 0;
  });
}

// ---- calculate_entity_confidence (lines 93-121) -------------------------

/**
 * Faithful port. Critically: iterates `selectedKeys` intersected with
 * `group.candidateKeys`, and separately intersected again with
 * `candidatesById` -- a candidate key present in the group and in
 * `selectedKeys` but ABSENT from `candidatesById` is silently dropped from
 * scoring, never defaulted or errored (confirmed against
 * tests/test_entity_resolution.py's
 * test_selected_members_alone_determine_entity_confidence, which relies on
 * exactly this behavior).
 *
 * `memberScoreOverride` (2026-07-29, Group Check Python-parity revision):
 * additive, optional 7th parameter, unused by any existing call site --
 * zero behavior change when omitted. Matches Python's own layering exactly:
 * `local_web_app.py`'s `scoreMemberAgainstCanonical()` wraps this file's
 * analysis-only equivalent (`analysisScoreMemberAgainstCanonical`, i.e. the
 * plain `memberScore()` below) with review-session awareness -- "if this
 * member already has a reviewer decision, its score is 100, not whatever
 * text-similarity analysis says" -- entirely OUTSIDE the analysis function
 * itself, which stays decision-agnostic. This engine has no ReviewSession
 * dependency today (by design -- entity resolution runs at detection time,
 * before any review exists) and this change doesn't add one: the override
 * is a plain `(candidateId) => number | undefined` callback the CALLER
 * supplies (see `groupLiveConfidence()`/`memberLiveConfidence()` in
 * `src/engines/review/coverage.ts`, the review layer that actually knows
 * about decisions), so the min/mean/anchor-penalty/reviewer-bonus blend
 * stays centralized here in one place rather than being duplicated by every
 * caller that wants "decided members count as 100."
 */
export function calculateEntityConfidence(
  group: EntityGroupResult,
  candidatesById: ReadonlyMap<string, Candidate>,
  qualityOf: QualityLookup,
  selectedKeys: ReadonlyArray<string> | ReadonlySet<string>,
  canonicalName?: string,
  reviewerConfirmed = false,
  memberScoreOverride?: (candidateId: string) => number | undefined
): number {
  const selectedKeySet = selectedKeys instanceof Set ? selectedKeys : new Set(selectedKeys);
  const selected = group.candidateKeys.filter((key) => selectedKeySet.has(key));
  if (selected.length === 0) return 0;

  const canonical = canonicalName ?? group.canonicalName;
  const selectedCandidates = selected
    .map((key) => candidatesById.get(key))
    .filter((c): c is Candidate => c !== undefined);
  if (selectedCandidates.length === 0) return 0;

  const scores = selectedCandidates.map(
    (candidate) => memberScoreOverride?.(candidate.id) ?? memberScore(canonical, candidate, qualityOf)
  );
  const mean = scores.reduce((sum, s) => sum + s, 0) / scores.length;
  let score = pythonRound(Math.min(...scores) * 0.65 + mean * 0.35);

  const hasAnchor = selectedCandidates.some((candidate) => personTokens(candidate).length >= 2);
  if (selectedCandidates.length > 1 && !hasAnchor) score -= 15;
  if (reviewerConfirmed) score += 10;
  return Math.max(35, Math.min(100, score));
}

/**
 * The plain, analysis-only per-member score `calculateEntityConfidence`
 * blends -- exported (2026-07-29, Group Check Python-parity revision)
 * purely so the review layer can show an INDIVIDUAL member's own analysis
 * score (Python's `analysisScoreMemberAgainstCanonical`), not just the
 * whole group's blended figure. `calculateEntityConfidence` itself remains
 * the single source of truth for the min/mean/anchor-penalty/reviewer-bonus
 * GROUP blend -- this export does not duplicate that, it only exposes the
 * one ingredient of it that has an independent, meaningful use on its own.
 */
export function analysisMemberScore(canonicalName: string, candidate: Candidate, qualityOf: QualityLookup): number {
  return memberScore(canonicalName, candidate, qualityOf);
}
