/**
 * normalization.ts -- the Normalization processing step (AG, 2026-08-03).
 *
 * Sits between Detection and Grouping:
 *
 *     Detection -> NORMALIZATION -> Grouping -> Type Check -> Item Check
 *
 * PURPOSE, precisely: not better detection -- a better REVIEW. A single
 * person routinely reaches the reviewer as seven separate review
 * candidates because the detector faithfully captured the conversation
 * around the name. Andrew's real transcript, before this pass:
 *
 *     "Andrew" (46x)   "Thanks Andrew" (10x)   "Thanks, Andrew" (5x)
 *     "Hi Andrew" (4x) "And Thank You Andrew" (2x) "Andrew Are" (1x) ...
 *
 * Each one costs a separate decision, and every decision after the first
 * is the reviewer re-answering a question they already answered.
 *
 * DELIBERATELY CONSERVATIVE. This pass never infers identity, never merges
 * ambiguous people, and never discards evidence. It removes deterministic
 * conversational and formatting noise from around an ALREADY-DETECTED
 * entity, and nothing else. Where a normalization would require semantic
 * judgment, it is not performed -- the candidates stay separate and the
 * reviewer decides, which is the correct outcome, not a failure of this
 * pass.
 *
 * ---------------------------------------------------------------------
 * THE RULE (one rule, three gates)
 * ---------------------------------------------------------------------
 * A person candidate is normalized when ALL of the following hold:
 *
 *   1. AFFIX GATE -- stripping only LEADING and TRAILING tokens that
 *      already-existing curated evidence classifies as ordinary language
 *      leaves a non-empty remainder. Interior tokens are never touched
 *      (that is identity-cleanup.ts's "inserted word" territory, a
 *      different question with a different answer -- see below).
 *
 *   2. CORROBORATION GATE -- the remainder resolves, through the
 *      detector's OWN normalization rule, to a candidate that this same
 *      document independently detected. The pass never invents an entity
 *      that the detector did not find on its own.
 *
 *   3. NAME-EVIDENCE GATE -- that corroborating candidate carries positive
 *      person-name evidence from CandidateQualityEngine.
 *
 * Gate 3 is what makes gate 2 safe, and it is not theoretical: on Andrew's
 * transcript, "May Session" strips to "May" and "May" IS a detected
 * candidate -- gate 2 alone would have merged a calendar term into a
 * person. The quality engine had already classified it calendar_term with
 * no name evidence, so gate 3 refuses. Likewise "For Fall" -> "Fall"
 * (season_or_academic_term), "The Reg" -> "Reg" (expanded common language
 * only), "Correct Begin" -> "Correct". This is the exact class of
 * Frankenstein identity the .09 identity-cleanup pass minted on its first
 * cut ("May Dates", "Fall Term"); the lesson from that session is applied
 * here up front rather than rediscovered.
 *
 * Gates 1 and 3 read EXISTING engine output only -- no new lexicon of
 * names, no new scoring, no inference. The one piece of genuinely new data
 * is DOCUMENT_NOISE_TOKENS below, and it is additive module-owned data in
 * the SENTENCE_CONTEXT_TOKENS precedent, never a parity dictionary.
 *
 * ---------------------------------------------------------------------
 * WHAT IS NEVER NORMALIZED
 * ---------------------------------------------------------------------
 * Every one of these falls out of the three gates rather than needing a
 * special case, which is the point -- they are consequences of the design,
 * not exceptions bolted onto it:
 *
 *   - "Chris" -> "Christopher": expansion, not stripping. Nothing is
 *     stripped, so gate 1 never fires.
 *   - "Garcia" -> "Margaret Garcia": same.
 *   - "Associate Dean" -> "Dean": "Associate" is not ordinary language in
 *     any curated dictionary (gate 1), and "Dean" carries no positive
 *     person-name evidence here (gate 3).
 *   - "Engineering, Computer Science" -> "Computer Science": splitting a
 *     list is a structural claim about the document, not affix removal.
 *   - "Like" / "Will" -> discarded: this pass NEVER discards a candidate.
 *     Every input candidate either survives normalized, survives
 *     untouched, or merges into a candidate that survives. Candidate count
 *     is monotonically non-increasing ONLY through merges, and the total
 *     occurrence count is invariant -- both suite-enforced.
 *     ("Will" additionally can never be stripped as a prefix: the quality
 *     data's own ambiguous_lexical_token judgment classifies it "unknown",
 *     not "ordinary", so "Will Diana" stays intact.)
 *
 * ---------------------------------------------------------------------
 * RELATIONSHIP TO identity-cleanup.ts (NOT a duplicate)
 * ---------------------------------------------------------------------
 * They answer different questions at different points and deliberately
 * share their evidence rather than their logic:
 *
 *   identity-cleanup  runs AFTER grouping, over ambiguity PROPOSALS, and
 *                     asks "is this a plausible identity to OFFER?" It may
 *                     remove interior tokens and may suppress an option.
 *   normalization     runs BEFORE grouping, over detected CANDIDATES, and
 *                     asks "is this the same review candidate as one we
 *                     already have?" It only ever removes affixes, and
 *                     suppresses nothing.
 *
 * classifyIdentityToken() is imported from identity-cleanup rather than
 * reimplemented, so the two passes can never drift apart on what counts as
 * ordinary language. Its curated narrow dictionaries are the right
 * evidence here for the same reason they were right there -- and
 * expanded_common_language_token is avoided here for the same reason too:
 * it contains real surnames (miller, ford, collier).
 *
 * ---------------------------------------------------------------------
 * EVIDENCE PRESERVATION AND REVERSIBILITY
 * ---------------------------------------------------------------------
 * Normalization is derived metadata. It is recomputed from the document
 * bytes on every load, is never persisted, and the raw DetectionResult is
 * kept intact alongside the normalized one (Workspace holds both). Every
 * original detector span survives verbatim on the surviving candidate:
 * Occurrence.startOffset/endOffset/text/context are untouched, occurrence
 * IDs are unchanged, and NormalizationRecord names every variant surface
 * form for Expert View ("Normalized from: Andrew / Hi Andrew / Thanks
 * Andrew / Thanks, Andrew / ...").
 *
 * The ONE derived value that intentionally diverges from the original span
 * is Occurrence.effectiveSpan -- the sub-range an output edit touches, so
 * redacting a merged "Thanks, Andrew" yields "Thanks, [REDACTED PERSON]"
 * rather than deleting the reviewer's prose. See DocumentModel.ts's
 * redactionSpanOf(). Per-occurrence narrowing is verified against each
 * occurrence's OWN text, not the candidate's display form (the same
 * candidate legitimately has occurrences whose literal text differs); when
 * an occurrence cannot be proven to carry the same retained tokens, it
 * keeps its original span -- the fail-safe direction, since redacting too
 * much is a fidelity problem while redacting too little is a privacy one.
 */

import type { Candidate, EffectiveSpan, Occurrence } from "../../domain/DocumentModel.js";
import type { DetectionResult } from "../DetectionEngine.js";
import { detectionCandidateKey } from "../DetectionEngine.js";
import { classifyIdentityToken, sharedIdentityLexicons } from "../entity-resolution/identity-cleanup.js";
import { GATE_3_CONTEXTUAL_THRESHOLD } from "../contextual-person-evidence/contextual-person-evidence.js";

/**
 * ADDITIVE lexicon, module-owned (the SENTENCE_CONTEXT_TOKENS precedent):
 * document furniture that trails a name in exports, transcripts, and OCR
 * output. These are not "ordinary language" in the sentence sense, so no
 * curated quality dictionary covers them -- "Cashay Jackson Transcripts"
 * is the motivating case from Andrew's specification.
 *
 * TRAILING POSITION ONLY, and always still behind the corroboration and
 * name-evidence gates. Kept deliberately short and unambiguous: every
 * entry is a word that cannot plausibly be a surname. Words that CAN be
 * surnames (Fields, Rivers, Banks, Page, Marks) are excluded on purpose --
 * a longer list is not a better list here.
 */
export const DOCUMENT_NOISE_TOKENS: readonly string[] = [
  "transcript",
  "transcripts",
  "attachment",
  "attachments",
  "agenda",
  "minutes",
  "handout",
  "handouts",
  "appendix",
  "addendum",
  "worksheet",
  "spreadsheet",
  "printout",
  "printouts",
  "screenshot",
  "screenshots",
  "voicemail",
  "signature",
  "unread",
  "forwarded",
  "undeliverable",
];

/**
 * ADDITIVE lexicon, module-owned: conversational openers and routing
 * markers that head an address to a person and that the curated narrow
 * dictionaries do not already carry. LEADING POSITION ONLY.
 *
 * Same restraint as above -- deliberately excludes anything that is also a
 * name ("Dear" is fine, "Grace"/"Hope"/"Will"/"May" would not be, and are
 * not here). "Will" specifically is already protected by the quality
 * data's own ambiguous_lexical_token judgment.
 */
export const CONVERSATIONAL_PREFIX_TOKENS: readonly string[] = ["dear", "fyi", "cc", "bcc", "re", "fwd", "regards", "sincerely", "cheers", "greetings", "attn"];

/**
 * "Good morning Andrew". Handled as a BIGRAM rather than by adding "good"
 * to the prefix list, because "good" on its own is not a greeting -- it is
 * an ordinary adjective, and it heads real surnames (Good, Goodman,
 * Goodwin). The greeting is the pair. Stripping the pair is deterministic;
 * stripping the word would be a guess.
 *
 * The tails are all already ordinary language on their own, so only the
 * head needs naming here.
 */
const GREETING_BIGRAM_HEAD = "good";
const GREETING_BIGRAM_TAILS = new Set(["morning", "afternoon", "evening", "day"]);

const NOISE = new Set(DOCUMENT_NOISE_TOKENS);
const PREFIX = new Set(CONVERSATIONAL_PREFIX_TOKENS);

/** Positive person-name evidence from CandidateQualityEngine -- the gate-3
 *  vocabulary. Both underscore and kebab spellings occur across
 *  assessment.reasons/filterRules (the same quirk categoryRuleLabel()
 *  normalizes in the UI), so membership is tested on a normalized form.
 *
 *  surname_given_structure (weight 50, the "Last, First" comma form) is
 *  included because it is what carries Andrew's own headline example:
 *  "Goodloe, Andrew Are" -> "Goodloe, Andrew", where the target
 *  "Andrew Goodloe" is evidenced by structure rather than by a dictionary
 *  hit. strong_name_structure (weight 35) is deliberately EXCLUDED: it is
 *  a weaker shape test that matches ordinary capitalized bigrams --
 *  "Grades Due" carries it on Andrew's transcript, and including it would
 *  have merged "Spring Grades Due" into it. */
const NAME_EVIDENCE_CATEGORIES = new Set([
  "known-first-name",
  "known-surname",
  "known-personal-name-token",
  "surname-given-structure",
  "initials-with-surname",
  "nearby-title",
]);

export function hasPersonNameEvidence(categories: readonly string[]): boolean {
  return categories.some((c) => NAME_EVIDENCE_CATEGORIES.has(c.replace(/_/g, "-")));
}

// ---- token model ----------------------------------------------------------

interface Token {
  text: string;
  /** [start, end) within the string this token was read from. */
  start: number;
  end: number;
}

/** Whitespace-delimited tokens with offsets. Offsets are what make
 *  per-occurrence span narrowing exact rather than a second search. */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  const re = /\S+/g;
  for (const match of text.matchAll(re)) {
    const start = match.index ?? 0;
    tokens.push({ text: match[0], start, end: start + match[0].length });
  }
  return tokens;
}

/** Comparable form of a retained token sequence -- the same cleanToken
 *  punctuation rule classifyIdentityToken uses, so "Andrew," and "Andrew"
 *  compare equal. Used only to prove two token sequences are the same
 *  entity text, never to build a candidate key. */
function retainedSignature(tokens: readonly Token[]): string {
  return tokens
    .map((t) => t.text.replace(/^[ .,'’]+|[ .,'’]+$/g, "").toLowerCase())
    .filter(Boolean)
    .join(" ");
}

type AffixRole = "leading" | "trailing";

/** Is this token removable noise in this position? Ordinary language is
 *  removable in either position; the two additive lexicons are strictly
 *  positional. */
function isStrippable(token: string, role: AffixRole): boolean {
  const bare = token.replace(/^[ .,'’]+|[ .,'’]+$/g, "").toLowerCase();
  if (!bare) return true; // pure punctuation ("--", ",") is always noise
  if (classifyIdentityToken(bare, sharedIdentityLexicons()) === "ordinary") return true;
  if (role === "leading" && PREFIX.has(bare)) return true;
  if (role === "trailing" && NOISE.has(bare)) return true;
  return false;
}

const bareToken = (token: string): string => token.replace(/^[ .,'\u2019]+|[ .,'\u2019]+$/g, "").toLowerCase();

/** The affix gate: how many tokens come off each end. Never strips
 *  everything (a candidate that is ENTIRELY noise -- "Good Morning",
 *  "Yes Thank" -- is left exactly as detected, per "never discard"). */
export function stripAffixes(tokens: readonly Token[]): { start: number; end: number } {
  let start = 0;
  let end = tokens.length;
  for (;;) {
    const head = tokens[start];
    if (start >= end || head === undefined) break;
    if (isStrippable(head.text, "leading")) {
      start++;
      continue;
    }
    const next = tokens[start + 1];
    if (bareToken(head.text) === GREETING_BIGRAM_HEAD && next !== undefined && start + 1 < end && GREETING_BIGRAM_TAILS.has(bareToken(next.text))) {
      start += 2;
      continue;
    }
    break;
  }
  for (let tail = tokens[end - 1]; end > start && tail !== undefined && isStrippable(tail.text, "trailing"); tail = tokens[end - 1]) end--;
  if (start >= end) return { start: 0, end: tokens.length };
  return { start, end };
}

/**
 * The affix gate expressed as a CHARACTER range within `text`, which is
 * what both the candidate-level plan and the per-occurrence span narrowing
 * actually need. One function so the two can never disagree about where
 * the entity starts.
 *
 * Two things happen here: whole noise TOKENS come off each end, and then
 * ordinary edge PUNCTUATION comes off what remains. The second step is not
 * cosmetic -- it is the whole of Andrew's "Andrew," -> "Andrew" case. The
 * detector's own key rule sees the trailing comma, takes the person
 * comma-reversal branch, and files "Andrew," under the key " andrew" (with
 * a leading space), a candidate distinct from "andrew" for no reason a
 * reviewer would recognize. Trimming the edge punctuation puts it back
 * where it belongs.
 *
 * Interior punctuation is deliberately untouched: the comma in
 * "Goodloe, Andrew" is load-bearing -- it is what makes the key resolve to
 * "andrew goodloe".
 *
 * Returns null when nothing changes.
 */
export function retainedRange(text: string): { start: number; end: number; removedLeading: string[]; removedTrailing: string[] } | null {
  const tokens = tokenize(text);
  if (tokens.length === 0) return null;
  const { start: firstToken, end: lastToken } = stripAffixes(tokens);
  const head = tokens[firstToken];
  const tail = tokens[lastToken - 1];
  if (!head || !tail) return null;

  let start = head.start;
  let end = tail.end;
  while (start < end && /[ .,'\u2019]/.test(text.charAt(start))) start++;
  while (end > start && /[ .,'\u2019]/.test(text.charAt(end - 1))) end--;
  if (start >= end) return null;
  if (start === 0 && end === text.length) return null;

  return {
    start,
    end,
    removedLeading: tokens.slice(0, firstToken).map((t) => t.text),
    removedTrailing: tokens.slice(lastToken).map((t) => t.text),
  };
}

// ---- result shape ---------------------------------------------------------

/** One original detector candidate that was folded into a surviving one --
 *  the reviewer-visible evidence behind a collapse. */
export interface NormalizationVariant {
  /** The ORIGINAL candidate id, exactly as the detector produced it. */
  candidateId: string;
  /** Its original surface form, verbatim ("Thanks, Andrew"). */
  displayValue: string;
  normalizedValue: string;
  /** How many detector occurrences this variant contributed. */
  occurrenceCount: number;
  removedLeading: readonly string[];
  removedTrailing: readonly string[];
}

/** Provenance for one SURVIVING candidate. Absent for candidates nothing
 *  was folded into -- the overwhelming majority. */
export interface NormalizationRecord {
  candidateId: string;
  /** In detector order, so Expert View reads stably across loads. */
  variants: NormalizationVariant[];
}

export interface NormalizationStats {
  candidatesBefore: number;
  candidatesAfter: number;
  /** How many separate review candidates the reviewer no longer sees. */
  candidatesCollapsed: number;
  /** How many occurrences moved onto a surviving candidate. */
  occurrencesRehomed: number;
  /** How many occurrences carry a narrowed effective redaction span. */
  spansNarrowed: number;
  /** Occurrences that merged but could NOT be proven narrowable and so
   *  keep their original span (the fail-safe path). Non-zero is not a
   *  defect -- it is this pass declining to guess. */
  spansLeftWhole: number;
}

export interface NormalizationResult {
  schemaVersion: 1;
  /** The normalized stream every downstream stage consumes. */
  detection: DetectionResult;
  /** Keyed by SURVIVING candidate id. */
  recordsByCandidate: Record<string, NormalizationRecord>;
  stats: NormalizationStats;
}

/** An empty, well-formed result -- used where a pipeline is constructed
 *  without normalization (parity harnesses) so consumers never branch on
 *  null. */
export function emptyNormalization(detection: DetectionResult): NormalizationResult {
  return {
    schemaVersion: 1,
    detection,
    recordsByCandidate: {},
    stats: {
      candidatesBefore: detection.candidates.length,
      candidatesAfter: detection.candidates.length,
      candidatesCollapsed: 0,
      occurrencesRehomed: 0,
      spansNarrowed: 0,
      spansLeftWhole: 0,
    },
  };
}

// ---- the pass -------------------------------------------------------------

export interface NormalizationInputs {
  /** Quality categories for a candidate -- Workspace supplies
   *  qualityCategoriesOf(assessment), the same shared rule the semantic
   *  type assignment and identity cleanup read. */
  categoriesOf: (candidateId: string) => readonly string[];
  /**
   * OPTIONAL, ADDITIVE (Andrew's decision, 2026-08-05). The candidate's
   * combined Contextual Person Evidence contribution, which gate 3 now
   * accepts as person-name evidence in its own right above
   * GATE_3_CONTEXTUAL_THRESHOLD.
   *
   * WHY NOT ROUTED THROUGH categoriesOf. qualityCategoriesOf() returns
   * "filterRules if any, else reasons" -- so for exactly the ambiguous
   * candidates this is meant to help ("May", which carries calendar_term),
   * the positive reasons are invisible and a contextual rule id placed
   * there would never be seen. Passing the STRENGTH directly is both
   * honest about what is being asked (a threshold question, not a
   * vocabulary-membership question) and immune to that quirk.
   *
   * Omitted by every existing caller and by the verification suites, which
   * keeps the pass's behaviour unchanged wherever it is not supplied.
   */
  contextualStrengthOf?: (candidateId: string) => number;
}

interface PlannedMerge {
  from: Candidate;
  into: Candidate;
  removedLeading: string[];
  removedTrailing: string[];
  /** Retained signature the target agrees with -- reused per occurrence. */
  retained: string;
}

/**
 * The pass. Pure: returns a new DetectionResult plus provenance; the input
 * `detection` is not mutated and stays valid as the raw detector record.
 */
export function normalizeDetection(detection: DetectionResult, inputs: NormalizationInputs): NormalizationResult {
  const byKey = new Map<string, Candidate>();
  for (const candidate of detection.candidates) byKey.set(candidate.id, candidate);

  // --- plan every merge against the ORIGINAL candidate set ---------------
  const planned: PlannedMerge[] = [];
  const mergedAway = new Set<string>();

  for (const candidate of detection.candidates) {
    // SCOPE: person candidates only. Emails, phones, CINs and long numeric
    // ids have no conversational wrapper to remove -- the detector already
    // strips them to digits/address form -- so running this pass over them
    // could only ever produce a false positive. A deliberate, disclosed
    // narrowing, not an oversight.
    if (candidate.detectedType !== "person") continue;

    const range = retainedRange(candidate.displayValue);
    if (!range) continue; // nothing to strip
    const retainedText = candidate.displayValue.slice(range.start, range.end);

    // Gate 2: does the detector's own normalization rule land this on a
    // candidate this document actually produced? Reusing the engine's
    // exported key function rather than restating it is what guarantees
    // the merge target is reachable at all -- a hand-rolled key that
    // disagreed with the detector by one rule (the person comma-reversal,
    // say) would silently never match anything.
    const targetKey = detectionCandidateKey(retainedText, candidate.detectedType);
    if (targetKey === candidate.id) continue;
    const target = byKey.get(targetKey);
    if (!target) continue;

    // Gate 3: the corroborating candidate must look like a person by the
    // quality engine's own evidence -- lexically, OR through strong enough
    // contextual usage (AG, 2026-08-05). The threshold is what keeps the
    // gate's teeth: a single weak reading such as "Contact May" cannot
    // authorize the "May Session" -> "May" merge this gate exists to refuse,
    // while any anchor or any strong usage can. See
    // GATE_3_CONTEXTUAL_THRESHOLD's comment for the full reasoning.
    const lexicalNameEvidence = hasPersonNameEvidence(inputs.categoriesOf(target.id));
    const contextualStrength = inputs.contextualStrengthOf?.(target.id) ?? 0;
    if (!lexicalNameEvidence && contextualStrength < GATE_3_CONTEXTUAL_THRESHOLD) continue;

    planned.push({
      from: candidate,
      into: target,
      removedLeading: range.removedLeading,
      removedTrailing: range.removedTrailing,
      retained: retainedSignature(tokenize(retainedText)),
    });
    mergedAway.add(candidate.id);
  }

  // NO TRANSITIVE COLLAPSE. A merge whose target is itself being merged
  // away is dropped rather than followed through to the far end. Chaining
  // is exactly the "inferring identity" this pass promises not to do: each
  // link is individually deterministic, but a chain asserts that the two
  // ends are the same person, which no single piece of evidence here
  // establishes. Same policy, same reasoning, as the full-value alias
  // provider's direct-dataset-edges-only rule.
  const merges = planned.filter((m) => !mergedAway.has(m.into.id));
  const effectiveMergedAway = new Set(merges.map((m) => m.from.id));
  const mergeBySource = new Map(merges.map((m) => [m.from.id, m]));

  // --- rebuild the detection stream --------------------------------------
  const recordsByCandidate: Record<string, NormalizationRecord> = {};
  let spansNarrowed = 0;
  let spansLeftWhole = 0;
  let occurrencesRehomed = 0;

  const occurrences: Occurrence[] = detection.occurrences.map((occurrence) => {
    const merge = mergeBySource.get(occurrence.candidateId);
    if (!merge) return occurrence;
    occurrencesRehomed++;
    const span = narrowSpan(occurrence, merge.retained);
    if (span) spansNarrowed++;
    else spansLeftWhole++;
    // The original span, text, context and id all survive verbatim; only
    // the owning candidate changes, plus the additive effectiveSpan.
    return span ? { ...occurrence, candidateId: merge.into.id, effectiveSpan: span } : { ...occurrence, candidateId: merge.into.id };
  });

  // Occurrence ids gathered per surviving candidate, preserving detector
  // order: a merged variant's occurrences append after the target's own,
  // so "the first occurrence" keeps meaning the target's own first one
  // (Candidate.source/confidence are first-occurrence-derived).
  const occurrenceIdsByCandidate = new Map<string, string[]>();
  for (const occurrence of occurrences) {
    const list = occurrenceIdsByCandidate.get(occurrence.candidateId) ?? [];
    list.push(occurrence.id);
    occurrenceIdsByCandidate.set(occurrence.candidateId, list);
  }
  // Stable ordering: target's own occurrences first, then each variant's,
  // in the order the variants appear in detector output.
  for (const merge of merges) {
    const record = recordsByCandidate[merge.into.id] ?? { candidateId: merge.into.id, variants: [] };
    record.variants.push({
      candidateId: merge.from.id,
      displayValue: merge.from.displayValue,
      normalizedValue: merge.from.normalizedValue,
      occurrenceCount: merge.from.occurrenceIds.length,
      removedLeading: merge.removedLeading,
      removedTrailing: merge.removedTrailing,
    });
    recordsByCandidate[merge.into.id] = record;
  }

  const candidates: Candidate[] = [];
  for (const candidate of detection.candidates) {
    if (effectiveMergedAway.has(candidate.id)) continue;
    const ids = occurrenceIdsByCandidate.get(candidate.id);
    candidates.push(ids && ids.length !== candidate.occurrenceIds.length ? { ...candidate, occurrenceIds: ids } : candidate);
  }

  return {
    schemaVersion: 1,
    detection: { schemaVersion: detection.schemaVersion, candidates, occurrences },
    recordsByCandidate,
    stats: {
      candidatesBefore: detection.candidates.length,
      candidatesAfter: candidates.length,
      candidatesCollapsed: merges.length,
      occurrencesRehomed,
      spansNarrowed,
      spansLeftWhole,
    },
  };
}

/**
 * Per-occurrence span narrowing. Recomputed from THIS occurrence's own
 * text rather than inherited from the candidate's display form, because
 * the same candidate legitimately has occurrences whose literal text
 * differs ("Goodloe,   Andrew  Are" and "Goodloe, Andrew Are" normalize to
 * one key), and the offsets have to be exact.
 *
 * Returns null -- meaning "keep the whole original span" -- whenever the
 * occurrence's own stripped remainder does not match the retained text the
 * merge was justified by. Declining here costs document fidelity on that
 * one occurrence; guessing would cost redaction correctness.
 */
export function narrowSpan(occurrence: Occurrence, retained: string): EffectiveSpan | null {
  const range = retainedRange(occurrence.text);
  if (!range) return null;
  const text = occurrence.text.slice(range.start, range.end);
  if (retainedSignature(tokenize(text)) !== retained) return null;
  return {
    startOffset: occurrence.startOffset + range.start,
    endOffset: occurrence.startOffset + range.end,
    text,
    removed: [...range.removedLeading, ...range.removedTrailing],
  };
}
