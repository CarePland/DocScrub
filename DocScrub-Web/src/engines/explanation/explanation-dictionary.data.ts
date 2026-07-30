/**
 * Direct port of redactor/explanations.py's EXPLANATION_DICTIONARY (~50
 * entries). Every key, and every short/standard/expert string, is copied
 * verbatim from the Python source -- this file makes no wording decisions
 * of its own.
 *
 * KEY CONVENTION (documented adaptation, not a behavioral deviation):
 * Python keys this dictionary by the evidence rule's own snake_case id
 * (e.g. "known_first_name") and looks it up via
 * `raw.get("id") or raw.get("rule")`. In this codebase, CandidateQualityEngine
 * already re-keys every rule id to kebab-case as `Evidence.category` (see
 * CandidateQualityEngine.ts: `category: item.rule.replace(/_/g, "-")`) --
 * Evidence.category's own doc comment calls this exact vocabulary "what
 * ExplanationEngine translates into reviewer-facing prose." Re-keying this
 * dictionary to kebab-case (a straightforward, mechanical `_` -> `-`
 * substitution on every Python key, content otherwise untouched) keeps the
 * lookup a direct one-to-one match against Evidence.category instead of
 * requiring a lossy round-trip conversion at lookup time.
 */

export interface ExplanationDictionaryEntry {
  short: string;
  standard: string;
  expert: string;
}

export const EXPLANATION_DICTIONARY: Readonly<Record<string, ExplanationDictionaryEntry>> = {
  "deterministic-non-person-type": {
    short: "Structured non-name value",
    standard: "it was detected by a specific non-name recognizer",
    expert: "Deterministic non-person type",
  },
  "email-address-evidence": {
    short: "Email evidence",
    standard: "it is associated with an email address",
    expert: "Email address evidence",
  },
  "nearby-title": {
    short: "Nearby title",
    standard: "it appears near a title or honorific",
    expert: "Nearby honorific or title",
  },
  "signature-or-email-header-context": {
    short: "Signature or email header",
    standard: "it appears in signature or email-header context",
    expert: "Signature or email header context",
  },
  "surname-given-structure": {
    short: "Surname-first name structure",
    standard: "it follows a surname-first name pattern",
    expert: "Strong surname, given-name structure",
  },
  "initials-with-surname": {
    short: "Initials with surname",
    standard: "it combines initials with a surname",
    expert: "Initials with surname",
  },
  "strong-name-structure": {
    short: "Strong name structure",
    standard: "it follows a strong personal-name pattern",
    expert: "Strong personal-name structure",
  },
  "known-personal-name-token": {
    short: "Known name token",
    standard: "it contains a known personal-name token",
    expert: "Known personal-name token",
  },
  "known-first-name": {
    short: "Known first name",
    standard: "it matches a known first name",
    expert: "Known first name",
  },
  "known-surname": {
    short: "Known surname",
    standard: "it matches a known surname",
    expert: "Known surname",
  },
  "single-name-candidate": {
    short: "Single-name candidate",
    standard: "it may be a standalone name reference",
    expert: "Single-name candidate",
  },
  "single-token-reviewable-without-negative-evidence": {
    short: "Single reviewable token",
    standard: "it is a single token without strong negative evidence",
    expert: "Single token without strong negative evidence",
  },
  "single-occurrence": {
    short: "Single occurrence",
    standard: "it appears only once in the document",
    expert: "Single occurrence",
  },
  "small-frequency-bonus": {
    short: "Repeated occurrence",
    standard: "it appears more than once in the document",
    expert: "Small frequency bonus",
  },
  "moderate-frequency-bonus": {
    short: "Repeated occurrence",
    standard: "it appears repeatedly in the document",
    expert: "Moderate frequency bonus",
  },
  "frequency-saturated": {
    short: "Repeated occurrence",
    standard: "it appears repeatedly throughout the document",
    expert: "Frequency saturation",
  },
  "common-english-word": {
    short: "Common English word",
    standard: "it is also a common English word",
    expert: "Common English word",
  },
  "greeting-or-courtesy": {
    short: "Greeting or courtesy",
    standard: "it is often used as a greeting or courtesy phrase",
    expert: "Greeting or courtesy",
  },
  "pronoun-or-determiner": {
    short: "Pronoun or determiner",
    standard: "it is commonly used as a pronoun or determiner",
    expert: "Pronoun or determiner",
  },
  "common-verb": {
    short: "Common verb",
    standard: "it is also a common verb",
    expert: "Common verb",
  },
  "institution-term": {
    short: "Institution term",
    standard: "it matches institutional vocabulary",
    expert: "Institution term",
  },
  "department-organization": {
    short: "Department or organization",
    standard: "it matches department or organization vocabulary",
    expert: "Department / organization",
  },
  "product-system-name": {
    short: "Product or system",
    standard: "it matches product or system vocabulary",
    expert: "Product / system name",
  },
  "season-or-academic-term": {
    short: "Academic term",
    standard: "it matches seasonal or academic vocabulary",
    expert: "Season or academic term",
  },
  "calendar-term": {
    short: "Calendar term",
    standard: "it matches calendar vocabulary",
    expert: "Calendar term",
  },
  "calendar-abbreviation": {
    short: "Calendar abbreviation",
    standard: "it matches a calendar abbreviation",
    expert: "Calendar abbreviation",
  },
  "address-suffix": {
    short: "Address suffix",
    standard: "it matches address vocabulary",
    expert: "Address suffix",
  },
  "document-structure-term": {
    short: "Document structure term",
    standard: "it matches document-structure vocabulary",
    expert: "Document structure term",
  },
  "legal-administrative-term": {
    short: "Legal or administrative term",
    standard: "it matches legal or administrative vocabulary",
    expert: "Legal / administrative term",
  },
  "organization-suffix": {
    short: "Organization suffix",
    standard: "it matches an organization suffix",
    expert: "Organization suffix",
  },
  "professional-credential": {
    short: "Professional credential",
    standard: "it matches a professional credential",
    expert: "Professional credential",
  },
  "honorific-title": {
    short: "Honorific or title",
    standard: "it matches title or honorific vocabulary",
    expert: "Honorific / title",
  },
  "institution-acronym": {
    short: "Institution acronym",
    standard: "it matches institutional acronym vocabulary",
    expert: "Institution acronym",
  },
  abbreviation: {
    short: "Abbreviation",
    standard: "it is commonly used as an abbreviation",
    expert: "Abbreviation",
  },
  "common-abbreviation": {
    short: "Common abbreviation",
    standard: "it matches common abbreviation vocabulary",
    expert: "Common abbreviation",
  },
  contraction: {
    short: "Contraction",
    standard: "it matches contraction vocabulary",
    expert: "Contraction",
  },
  "interjection-casual": {
    short: "Casual expression",
    standard: "it matches casual-expression vocabulary",
    expert: "Interjection / casual expression",
  },
  "administrative-phrase": {
    short: "Administrative phrase",
    standard: "it matches an administrative phrase",
    expert: "Administrative phrase",
  },
  "all-common-dictionary-words": {
    short: "Common-word phrase",
    standard: "all of its words are common dictionary words",
    expert: "All common dictionary words",
  },
  "sentence-fragment-word": {
    short: "Sentence fragment word",
    standard: "it contains sentence-fragment vocabulary",
    expert: "Sentence fragment word",
  },
  "sentence-fragment": {
    short: "Sentence fragment",
    standard: "it looks like a sentence fragment",
    expert: "Sentence fragment",
  },
  "grammatical-phrase-shape": {
    short: "Grammatical phrase",
    standard: "it has the shape of a grammatical phrase",
    expert: "Grammatical phrase shape",
  },
  "implausible-capitalization": {
    short: "Unusual capitalization",
    standard: "it has unusual capitalization",
    expert: "Implausible capitalization",
  },
  "ocr-artifact": {
    short: "OCR artifact",
    standard: "it has signs of OCR or extraction noise",
    expert: "OCR artifact",
  },
  "no-alpha-tokens": {
    short: "No alphabetic tokens",
    standard: "it does not contain alphabetic tokens",
    expert: "No alpha tokens",
  },
  "too-short-single-token": {
    short: "Very short token",
    standard: "it is a very short standalone token",
    expert: "Too-short single token",
  },
  "likely-acronym": {
    short: "Likely acronym",
    standard: "it has the shape of an acronym",
    expert: "Likely acronym",
  },
  "expanded-common-language-token": {
    short: "Common language token",
    standard: "it matches expanded common-language vocabulary",
    expert: "Expanded common language token",
  },
  "ambiguous-lexical-token": {
    short: "Ambiguous lexical token",
    standard: "it is a word that can also be name-like",
    expert: "Ambiguous lexical token",
  },
  "no-positive-person-evidence": {
    short: "No positive person evidence",
    standard: "there is no strong person-name evidence",
    expert: "No positive person evidence",
  },
  "heading-context": {
    short: "Heading context",
    standard: "it appears in heading-like context",
    expert: "Heading context",
  },
  "weak-name-structure": {
    short: "Weak name structure",
    standard: "it has weak name structure",
    expert: "Weak name structure",
  },
  "unknown-capitalized-token": {
    short: "Unknown capitalized token",
    standard: "it is an unrecognized capitalized token",
    expert: "Unknown capitalized token",
  },
  "unknown-lowercase-token": {
    short: "Unknown lowercase token",
    standard: "it is an unrecognized lowercase token",
    expert: "Unknown lowercase token",
  },
  "unknown-token": {
    short: "Unknown token",
    standard: "it is not recognized by current deterministic evidence",
    expert: "Unknown token",
  },
};
