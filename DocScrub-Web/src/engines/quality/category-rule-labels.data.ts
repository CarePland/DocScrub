/**
 * Direct port of local_web_app.py's `QUALITY_RULE_LABELS` (the Category
 * Check aggregation view's display labels -- a distinct dictionary from
 * scoring.ts's EXPLICIT_EVIDENCE_LABELS, which labels per-evidence-item
 * score contributions, not Category Check's aggregation categories; the two
 * overlap on some entries because both ultimately describe the same rule
 * vocabulary, but they serve different UI purposes and Python itself keeps
 * them as two separate dictionaries). Keyed in kebab-case to match
 * Evidence.category/CandidateQualityAssessment.reasons's existing
 * convention -- same rationale as explanation-dictionary.data.ts's own
 * "KEY CONVENTION" note.
 */
export const CATEGORY_RULE_LABELS: Readonly<Record<string, string>> = {
  "all-common-dictionary-words": "All common dictionary words",
  "address-suffix": "Address suffix",
  "administrative-phrase": "Administrative phrase",
  abbreviation: "Abbreviation",
  "ambiguous-lexical-token": "Ambiguous lexical token",
  "calendar-abbreviation": "Calendar abbreviation",
  "calendar-term": "Calendar term",
  "common-abbreviation": "Common abbreviation",
  "common-english-word": "Common English word",
  "common-verb": "Common verb",
  contraction: "Contraction",
  "department-organization": "Department / organization",
  "document-structure-term": "Document structure term",
  "expanded-common-language-token": "Expanded common language token",
  "greeting-or-courtesy": "Greeting or courtesy",
  "honorific-title": "Honorific / title",
  "interjection-casual": "Interjection / casual expression",
  "implausible-capitalization": "Implausible capitalization",
  "institution-acronym": "Institution acronym",
  "institution-term": "Institution term",
  "known-first-name": "Known first name",
  "known-surname": "Known surname",
  "legal-administrative-term": "Legal / administrative term",
  "likely-acronym": "Likely acronym",
  "ocr-artifact": "OCR artifact",
  "organization-suffix": "Organization suffix",
  "professional-credential": "Professional credential",
  "product-system-name": "Product / system name",
  "pronoun-or-determiner": "Pronoun or determiner",
  "season-or-academic-term": "Season or academic term",
  "sentence-fragment": "Sentence fragment",
  "sentence-fragment-word": "Sentence fragment word",
  "too-short-single-token": "Too-short single token",
  "unknown-capitalized-token": "Unknown capitalized token",
  "unknown-lowercase-token": "Unknown lowercase token",
  "unknown-token": "Unknown token",
};

/**
 * Same title-casing fallback convention as explanation-builder.ts's
 * fallbackText() -- an unrecognized category degrades to a readable label
 * instead of a raw identifier.
 *
 * NORMALIZES snake_case -> kebab-case before lookup. This dictionary (like
 * explanation-dictionary.data.ts) is keyed in kebab-case to match
 * Evidence.category's convention, but `CandidateQualityAssessment.reasons`/
 * `filterRules` (scoring.ts's ScoredQuality.reasons/filterRules) are a
 * SEPARATE representation of the same rule vocabulary that was never run
 * through CandidateQualityEngine's kebab-casing step (only individual
 * Evidence[] items are re-keyed there) -- they remain in Python's original
 * snake_case. Found during Milestone 1 Phase 1 browser validation: Expert
 * View's "Diagnostic Categories" (sourced from `assessment.filterRules`)
 * rendered "Product_system_name" instead of "Product / system name" before
 * this normalization was added. Rather than fix every call site that reads
 * reasons/filterRules separately, normalizing once here (and reusing this
 * same function for Category Check's category labels, Phase 2) is the
 * single point of truth for "however this rule id is spelled, show the
 * reviewer the same label" -- both callers already exist in app.ts.
 */
export function categoryRuleLabel(category: string): string {
  const normalized = category.replace(/_/g, "-");
  const known = CATEGORY_RULE_LABELS[normalized];
  if (known) return known;
  return normalized
    .split("-")
    .map((word) => (word.length === 0 ? word : word[0]!.toUpperCase() + word.slice(1)))
    .join(" ");
}
