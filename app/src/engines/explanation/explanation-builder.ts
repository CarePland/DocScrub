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

/** Direct port of Python's `_confidence_opener()`: the same four likelihood
 *  bands (>=95/>=80/>=50/else), same four opener phrasings. */
export function confidenceOpener(likelihood: number, entityType: string): string {
  const entity = entityPhrase(entityType);
  if (likelihood >= 95) return `We believe this is ${entity}`;
  if (likelihood >= 80) return `This is likely ${entity}`;
  if (likelihood >= 50) return `This may be ${entity}`;
  return `This is unlikely to be ${entity}`;
}

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
  const opener = confidenceOpener(context.likelihood, context.entityType);
  if (positives && negatives) return `${opener} because ${positives}, but ${negatives}.`;
  if (positives) return `${opener} because ${positives}.`;
  if (negatives) return `${opener} because ${negatives}.`;
  if (neutral.length > 0) {
    const neutralPhrase = joinPhrases(neutral.slice(0, 3).map((item) => item.standard));
    return `${opener} based on deterministic evidence: ${neutralPhrase}.`;
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
