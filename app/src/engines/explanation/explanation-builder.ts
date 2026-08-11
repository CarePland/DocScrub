/**
 * Pure port of redactor/explanations.py's translation logic: normalize_evidence,
 * _entity_phrase, _confidence_opener, _join_phrases, build_standard_explanation,
 * explanation_payload. Every function here is synchronous and side-effect
 * free, matching ExplanationEngine's own "stateless service" contract
 * (architecture v0.2 §6.5) -- ExplanationEngine.ts (the class) is a thin
 * wrapper delegating to buildExplanation() below, exactly the same
 * "interface class + a scoring.ts-style pure logic module" split already
 * established by CandidateQualityEngine.ts/quality/scoring.ts.
 */

import type {
  Evidence,
  EvidencePolarity,
  ExplanationContext,
  ExplanationEvidenceText,
  Explanation,
  ExplanationView,
  Recommendation,
} from "../../domain/Evidence.js";
import type { CandidateQualityAssessment } from "../../domain/Evidence.js";
import { EXPLANATION_DICTIONARY } from "./explanation-dictionary.data.js";

/** Direct port of Python's `_fallback_text()`: a title-cased rendering of
 *  the rule id itself, used only when EXPLANATION_DICTIONARY has no entry --
 *  degrades gracefully to a readable label instead of surfacing a raw
 *  internal category string to a reviewer. */
function titleCase(text: string): string {
  return text
    .split(" ")
    .map((word) => (word.length === 0 ? word : word[0]!.toUpperCase() + word.slice(1)))
    .join(" ");
}

function fallbackText(category: string): { short: string; standard: string; expert: string } {
  const label = titleCase(category.replace(/-/g, " ").trim()) || "Evidence";
  return { short: label, standard: `it has ${label.toLowerCase()} evidence`, expert: label };
}

/** Direct port of Python's `normalize_evidence()`: attaches short/standard/
 *  expert text from EXPLANATION_DICTIONARY (keyed by Evidence.category --
 *  see that dictionary file's own "KEY CONVENTION" doc comment), falling
 *  back to fallbackText() when no entry exists. Never invents a weight or
 *  polarity beyond what the given Evidence already carries. */
export function normalizeEvidenceText(evidence: Evidence): ExplanationEvidenceText {
  const entry = EXPLANATION_DICTIONARY[evidence.category] ?? fallbackText(evidence.category);
  return {
    id: evidence.id,
    polarity: evidence.kind,
    weight: evidence.weight,
    short: entry.short,
    standard: entry.standard,
    expert: entry.expert,
  };
}

/** Direct port of Python's `_entity_phrase()`. */
export function entityPhrase(entityType: string): string {
  const labels: Record<string, string> = {
    person: "a person's name",
    email: "an email address",
    phone: "a phone number",
    cin: "an identifying number",
    long_numeric_id: "an identifying number",
    other_identifier: "an identifier",
  };
  return labels[entityType] ?? `a ${entityType.replace(/_/g, " ")}`;
}

/**
 * Python's `_confidence_opener()`: the same four likelihood bands
 * (>=95/>=80/>=50/else).
 *
 * ═══ DECLARED DEVIATION: PROFESSIONAL TOOL VOICE (AG, 2026-08-04) ══════
 *
 * The PHRASINGS are no longer verbatim. Python's are written as a speaker
 * addressing a reader -- "We believe this is a person's name" -- which
 * attributes a belief to software that holds none. The standing principle
 * (see app/CLAUDE.md): DocScrub is an analysis tool, not an assistant; it
 * presents evidence and assessments and never claims to think, believe,
 * find or decide. The reviewer is the decision-maker.
 *
 * Bands, thresholds, entity phrases and every caller are untouched; only
 * the four strings changed. What they now state is the ASSESSMENT rather
 * than an actor producing it:
 *
 *   Python                              →  DocScrub
 *   "We believe this is a person's name"   "Almost certainly a person's name"
 *   "This is likely a person's name"       "Likely a person's name"
 *   "This may be a person's name"          "Possibly a person's name"
 *   "This is unlikely to be a person's..." "Unlikely to be a person's name"
 *
 * `buildStandardSummary` composes these into "<opener> because <evidence>",
 * which still reads correctly: "Likely a person's name because it matches
 * a known first name." The subject of the sentence is now the item, not a
 * narrator -- which is also why "We believe" had to go first: it was the
 * only opener whose grammar required a speaker.
 *
 * NOTE this changes AUDIT NARRATIVE text as well as panel text, since both
 * come from here. That is intended -- an audit record written in the first
 * person is exactly the artifact this principle exists to prevent -- but it
 * is a change to an exported record's wording and is called out for that
 * reason rather than buried.
 */
export function confidenceOpener(likelihood: number, entityType: string): string {
  const entity = entityPhrase(entityType);
  if (likelihood >= 95) return `Almost certainly ${entity}`;
  if (likelihood >= 80) return `Likely ${entity}`;
  if (likelihood >= 50) return `Possibly ${entity}`;
  return `Unlikely to be ${entity}`;
}

/**
 * ============================ ORACLE DEVIATION #7 ============================
 * SHAPE CONFIDENCE IS NOT SEMANTIC CONFIDENCE (AG, 2026-08-09).
 *
 * `confidenceOpener` takes its NOUN from the detector's `entityType` and only
 * its ADVERB from the score. The score measures name-LIKENESS -- a weighted
 * sum over capitalization structure and frequency -- so on a candidate whose
 * only positive evidence is shape, the sentence attaches a confident adverb
 * to a claim nothing ever assessed:
 *
 *     Degree Planner   99  positiveReasons ["strong_name_structure"]
 *                          -> "Almost certainly a person's name."
 *     Grade Rosters    79  positiveReasons ["strong_name_structure"]
 *                          -> "Likely a person's name."
 *     Amy Miller       79  positiveReasons ["strong_name_structure"]
 *                          -> "Likely a person's name."
 *
 * The third line is the tell: a real person and an interface label receive
 * the identical sentence, because the evidence behind them is identical. The
 * copy is not merely optimistic -- it is reporting a distinction the pipeline
 * has not made.
 *
 * ---------------------------------------------------------------------
 * WHAT CHANGES, AND WHAT DELIBERATELY DOES NOT
 * ---------------------------------------------------------------------
 *
 * Only the NOUN moves, and only when the positive evidence is entirely shape
 * or frequency. The score is untouched, the bands are untouched, the
 * `<opener> because <evidence>` grammar is untouched, and every candidate
 * carrying real name evidence keeps the original wording. A high score on a
 * shape-only candidate is not WRONG -- the engine really is confident the
 * string is name-shaped -- so the fix is to let the sentence say that, not to
 * suppress the number.
 *
 * This does NOT decide anything. Routing, sectioning and membership are
 * untouched; a shape-only candidate is exactly as reviewable as before. It is
 * a truthfulness fix to displayed text, deliberately kept separate from the
 * classification work it was discovered by.
 *
 * NOTE, as the module header already warns of the four ported strings: this
 * reaches AUDIT NARRATIVE as well as panel text, since both come from
 * `buildStandardSummary`. That is intended -- an audit record asserting
 * personhood on capitalization evidence is precisely the artifact worth not
 * writing -- and is called out rather than buried.
 *
 * Python has no equivalent branch, so this is a deviation and is recorded as
 * one. Classification: **truthfulness fix**. The oracle's sentence is a claim
 * about the document that the oracle's own evidence does not support.
 * ============================================================================
 */

/**
 * Positive scoring reasons that describe the STRING rather than its meaning.
 *
 * Two families, and both are here for the same reason: neither can
 * distinguish `Amy Miller` from `Grade Rosters`, because neither looks at
 * anything but the characters and how often they appear.
 *
 *   SHAPE      capitalization structure -- `TWO_NAME_RE`, `LAST_FIRST_RE`,
 *              initials, single-token shape
 *   FREQUENCY  how often the string occurs, which says nothing at all about
 *              what it denotes
 *
 * `heading_context` is included as a third kind: it is a statement about
 * where the string sits, and the scoring layer already treats it as reducing
 * certainty rather than establishing identity.
 *
 * Everything ABSENT from this list is evidence that legitimately speaks to
 * personhood -- known name tokens, honorifics, email and signature evidence,
 * the contextual person rules -- and any candidate carrying one keeps the
 * original semantic wording.
 */
export const SHAPE_OR_FREQUENCY_REASONS: readonly string[] = [
  "strong_name_structure",
  "surname_given_structure",
  "initials_with_surname",
  "single_name_candidate",
  "single_token_reviewable_without_negative_evidence",
  "small_frequency_bonus",
  "moderate_frequency_bonus",
  "frequency_saturated",
  "heading_context",
];

/**
 * True when a person-typed candidate's positive evidence is ENTIRELY shape
 * or frequency -- i.e. nothing in it speaks to personhood.
 *
 * Requires at least one positive reason on purpose. "No positive evidence at
 * all" is a different situation with its own existing wording, and quietly
 * folding it in here would change a second thing under cover of the first.
 */
export function isShapeOnlyPersonClaim(entityType: string, positiveReasons: readonly string[]): boolean {
  if (entityType !== "person") return false;
  if (positiveReasons.length === 0) return false;
  // Both vocabularies reach this function: scoring emits snake_case reasons,
  // Evidence.category is kebab. Normalized on both sides so a caller cannot
  // silently miss by picking the wrong one.
  const shape = new Set(SHAPE_OR_FREQUENCY_REASONS.map((r) => r.replace(/_/g, "-")));
  return positiveReasons.every((reason) => shape.has(reason.replace(/_/g, "-")));
}

/**
 * The opener, faithful to what the evidence establishes.
 *
 * Identical to `confidenceOpener` in every case except the shape-only person
 * one, where the noun becomes the thing actually assessed. `confidenceOpener`
 * is deliberately left intact and still exported: it is a direct port, the
 * parity suite pins it, and a deviation is clearer as an added branch than as
 * an edit to the ported function.
 */
export function evidenceFaithfulOpener(
  likelihood: number,
  entityType: string,
  positiveReasons: readonly string[]
): string {
  if (!isShapeOnlyPersonClaim(entityType, positiveReasons)) return confidenceOpener(likelihood, entityType);
  if (likelihood >= 95) return "Almost certainly name-shaped text";
  if (likelihood >= 80) return "Likely name-shaped text";
  if (likelihood >= 50) return "Possibly name-shaped text";
  return "Unlikely to be name-shaped text";
}

/** The clause that states the absence explicitly, rather than leaving the
 *  reviewer to infer it from an evidence list that simply omits it. */
export const NO_NAME_EVIDENCE_CLAUSE = "No name evidence was found.";

/** Direct port of Python's `_join_phrases()` -- correct Oxford-comma joining
 *  for 0/1/2/3+ items. */
export function joinPhrases(phrases: readonly string[]): string {
  const clean = phrases.filter((phrase) => phrase.length > 0);
  if (clean.length === 0) return "";
  if (clean.length === 1) return clean[0]!;
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  return `${clean.slice(0, -1).join(", ")}, and ${clean.at(-1)}`;
}

interface SplitEvidence {
  positive: ExplanationEvidenceText[];
  negative: ExplanationEvidenceText[];
  neutral: ExplanationEvidenceText[];
}

function splitEvidence(evidence: readonly Evidence[]): SplitEvidence {
  const normalized = evidence.map(normalizeEvidenceText);
  const byPolarity = (polarity: EvidencePolarity) => normalized.filter((item) => item.polarity === polarity);
  return { positive: byPolarity("positive"), negative: byPolarity("negative"), neutral: byPolarity("neutral") };
}

/** Direct port of Python's `build_standard_explanation()`: opener + up to
 *  three positive-evidence phrases, else up to three negative-evidence
 *  phrases, else (both present) opener + positives "but" negatives, else
 *  neutral evidence, else "No explanatory evidence was recorded." Matches
 *  Python's exact branch order -- this is not a simplification, every
 *  branch and the "first 3" truncation are preserved. */
export function buildStandardSummary(context: ExplanationContext): string {
  const { positive, negative, neutral } = splitEvidence(context.evidence);
  const positives = joinPhrases(positive.slice(0, 3).map((item) => item.standard));
  const negatives = joinPhrases(negative.slice(0, 3).map((item) => item.standard));
  /*
   * DEVIATION #7 (see evidenceFaithfulOpener). The positive evidence RULES
   * are read from `diagnosticCategories`/`evidence` the context already
   * carries -- no new input, no new computation, and the branch collapses to
   * the ported behaviour whenever any real name evidence is present.
   */
  const positiveReasons = context.evidence.filter((item) => item.kind === "positive").map((item) => item.category);
  const shapeOnly = isShapeOnlyPersonClaim(context.entityType, positiveReasons);
  const opener = evidenceFaithfulOpener(context.likelihood, context.entityType, positiveReasons);
  // Stated rather than left to inference: the reviewer should not have to
  // notice which evidence is MISSING from a list.
  const tail = shapeOnly ? ` ${NO_NAME_EVIDENCE_CLAUSE}` : "";
  if (positives && negatives) return `${opener} because ${positives}, but ${negatives}.${tail}`;
  if (positives) return `${opener} because ${positives}.${tail}`;
  if (negatives) return `${opener} because ${negatives}.${tail}`;
  if (neutral.length > 0) {
    const neutralPhrase = joinPhrases(neutral.slice(0, 3).map((item) => item.standard));
    return `${opener} based on deterministic evidence: ${neutralPhrase}.${tail}`;
  }
  return `${opener}. No explanatory evidence was recorded.`;
}

/**
 * Assembles an ExplanationContext from already-computed pipeline output --
 * Candidate (DetectionEngine), Evidence[]/score/recommendation
 * (CandidateQualityEngine's QualityResult), and an occurrence count
 * (OccurrenceClassifier/DetectionResult). Lives alongside the rest of this
 * module rather than in the UI layer for the same reason Python keeps the
 * equivalent `explanation_context_for_candidate()` in explanations.py itself
 * rather than in local_web_app.py's rendering code: it is translation logic
 * over already-computed evidence, not a new UI concern, and keeping it here
 * means the UI never re-derives or duplicates it.
 *
 * DISPOSITION (documented simplification): Python's `disposition` parameter
 * is supplied by the caller from richer state (e.g. "Resolved via Group
 * Check"). This codebase does not yet have an equivalent multi-source
 * disposition string, so `disposition` here is derived from the one signal
 * actually available -- an existing CandidateDecision, if any -- as
 * `"Resolved: {decision}"`, falling back to the recommendation label
 * ("To Review"/"Unlikely") exactly as Python's own `disposition or
 * candidate.quality_status` fallback does when no richer disposition is
 * supplied. Flagged here, not silently narrowed: a future Group-Check-aware
 * disposition (matching Python's fuller sourcing) is a reasonable follow-up,
 * not required for Milestone 1.
 */
export function buildExplanationContext(input: {
  candidateId: string;
  entityType: string;
  likelihood: number;
  recommendation: Recommendation;
  occurrenceCount: number;
  evidence: Evidence[];
  assessment: CandidateQualityAssessment | undefined;
  existingDecision?: string;
}): ExplanationContext {
  const diagnosticCategories = [
    ...new Set(
      input.assessment?.filterRules.length ? input.assessment.filterRules : (input.assessment?.reasons ?? [])
    ),
  ];
  const recommendationLabel = input.recommendation === "ToReview" ? "To Review" : "Unlikely";
  return {
    candidateId: input.candidateId,
    entityType: input.entityType,
    likelihood: input.likelihood,
    recommendation: input.recommendation,
    disposition: input.existingDecision ? `Resolved: ${input.existingDecision}` : recommendationLabel,
    occurrenceCount: input.occurrenceCount,
    evidence: input.evidence,
    diagnosticCategories,
    rawScoringExplanation: input.assessment?.explanation ?? "",
  };
}

/** Direct port of Python's `explanation_payload()`, one view at a time
 *  (see ExplanationEngine.ts's doc comment for why explain() takes a single
 *  `view` rather than returning all three at once -- matching the
 *  architecture doc's own per-view calling convention as closely as the
 *  interface-defect fix allows). Never invents evidence beyond
 *  `context.evidence`. */
export function buildExplanation(context: ExplanationContext, view: ExplanationView): Explanation {
  if (view === "standard") {
    return {
      view: "standard",
      candidateId: context.candidateId,
      likelihood: context.likelihood,
      recommendation: context.recommendation,
      occurrenceCount: context.occurrenceCount,
      summary: buildStandardSummary(context),
    };
  }
  const { positive, negative, neutral } = splitEvidence(context.evidence);
  if (view === "expert") {
    return {
      view: "expert",
      candidateId: context.candidateId,
      likelihood: context.likelihood,
      recommendation: context.recommendation,
      currentDisposition: context.disposition,
      positiveEvidence: positive,
      negativeEvidence: negative,
      neutralEvidence: neutral,
      diagnosticCategories: context.diagnosticCategories,
      rawScoringExplanation: context.rawScoringExplanation,
    };
  }
  return {
    view: "audit",
    candidateId: context.candidateId,
    summary: buildStandardSummary(context),
    positiveEvidence: positive.map((item) => item.expert),
    negativeEvidence: negative.map((item) => item.expert),
    neutralEvidence: neutral.map((item) => item.expert),
  };
}
