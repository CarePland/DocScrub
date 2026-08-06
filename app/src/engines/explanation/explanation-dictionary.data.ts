/**
 * Port of redactor/explanations.py's EXPLANATION_DICTIONARY (~50 entries).
 *
 * ═══ DECLARED DEVIATION FROM THE ORACLE (AG, 2026-08-04) ═══════════════
 *
 * The `short` register is NO LONGER VERBATIM. Every `short` string was
 * rewritten to reviewer vocabulary against a list AG supplied directly.
 * `standard` and `expert` remain verbatim, every KEY is unchanged, and no
 * composition logic moved -- so the audit narrative, the Expert View and
 * every parity suite still read exactly what Python produces.
 *
 * WHY THE DEVIATION IS WORTH TAKING. `short` became reviewer-facing only
 * on 2026-08-04, when the focus panel replaced its run-on "because X, but
 * Y" sentence with a signed chip list built from this register. Python has
 * no equivalent surface -- its `short` strings are internal labels that no
 * reviewer reads -- so there is no oracle behavior to diverge FROM here.
 * Copying labels written for a different presentation into a new one is
 * fidelity to the letter against the intent.
 *
 * THE STANDING PRINCIPLE THIS ESTABLISHES (AG, 2026-08-04):
 *   "Avoid classifier vocabulary. Favor reviewer vocabulary."
 * Concretely: 2-4 words; name what the reviewer should CONCLUDE, not what
 * the algorithm did; recognizable without training; if a reviewer has to
 * stop and think, rename it. The word "token" is gone from every label --
 * it was in seven of them and means nothing outside engineering.
 *
 * TWO LABELS DIVERGE FROM AG'S SUPPLIED LIST, both to avoid minting the
 * exact collision he asked to remove elsewhere:
 *   - `document-structure-term` -> "Section word" (his list: "Section
 *     heading"), because `heading-context` also mapped to "Section
 *     heading" and two different rules must not render identically. This
 *     one is about VOCABULARY ("Appendix", "Table").
 *   - `heading-context` -> "In a heading" (his list: "Section heading"),
 *     because this one is about LOCATION -- where the item sits, not what
 *     it says.
 * Also `weak-name-structure` -> "Loosely name-like" rather than "Possible
 * name": it is NEGATIVE evidence, and a chip reading "✗ Possible name"
 * asks the reviewer to reconcile a negative marker with a positive phrase.
 *
 * The three frequency rules now render distinctly ("Seen before" /
 * "Repeated" / "Highly repeated") per AG: the reviewer does not care that
 * it is +4 vs +14, but does care whether a thing appears twice or fifty
 * times.
 *
 * ═══════════════════════════════════════════════════════════════════════
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
  /**
   * ADDITIVE, TS-ONLY (AG, 2026-08-05). No Python counterpart -- the
   * Contextual Person Evidence family does not exist in the oracle, so there
   * is no `short`/`standard`/`expert` register to diverge from.
   *
   * Written to the standing principle this file declares above ("avoid
   * classifier vocabulary, favor reviewer vocabulary"): the chip says what
   * the reviewer should CONCLUDE -- the document treats this as a person --
   * not which of eleven grammatical rules fired. The specific usages, and
   * the representative example that shows them, belong in the panel prose
   * beside this chip, not in eleven more chips.
   */
  "contextual-person-evidence": {
    short: "Used as a person",
    standard: "the surrounding text uses it the way people are used",
    expert: "Contextual person evidence",
  },
  "deterministic-non-person-type": {
    short: "Email / Phone / ID",
    standard: "it was detected by a specific non-name recognizer",
    expert: "Deterministic non-person type",
  },
  "email-address-evidence": {
    short: "Email address",
    standard: "it is associated with an email address",
    expert: "Email address evidence",
  },
  "nearby-title": {
    short: "Title nearby",
    standard: "it appears near a title or honorific",
    expert: "Nearby honorific or title",
  },
  "signature-or-email-header-context": {
    short: "Email signature",
    standard: "it appears in signature or email-header context",
    expert: "Signature or email header context",
  },
  "surname-given-structure": {
    short: "Surname first",
    standard: "it follows a surname-first name pattern",
    expert: "Strong surname, given-name structure",
  },
  "initials-with-surname": {
    short: "Initials + surname",
    standard: "it combines initials with a surname",
    expert: "Initials with surname",
  },
  "strong-name-structure": {
    short: "Looks like name",
    standard: "it follows a strong personal-name pattern",
    expert: "Strong personal-name structure",
  },
  "known-personal-name-token": {
    short: "Contains name",
    standard: "it contains a known personal-name token",
    expert: "Known personal-name token",
  },
  "known-first-name": {
    short: "Common first name",
    standard: "it matches a known first name",
    expert: "Known first name",
  },
  "known-surname": {
    short: "Common surname",
    standard: "it matches a known surname",
    expert: "Known surname",
  },
  "single-name-candidate": {
    short: "Single name",
    standard: "it may be a standalone name reference",
    expert: "Single-name candidate",
  },
  "single-token-reviewable-without-negative-evidence": {
    short: "Standalone word",
    standard: "it is a single token without strong negative evidence",
    expert: "Single token without strong negative evidence",
  },
  "single-occurrence": {
    short: "Only appears once",
    standard: "it appears only once in the document",
    expert: "Single occurrence",
  },
  "small-frequency-bonus": {
    short: "Seen before",
    standard: "it appears more than once in the document",
    expert: "Small frequency bonus",
  },
  "moderate-frequency-bonus": {
    short: "Repeated",
    standard: "it appears repeatedly in the document",
    expert: "Moderate frequency bonus",
  },
  "frequency-saturated": {
    short: "Highly repeated",
    standard: "it appears repeatedly throughout the document",
    expert: "Frequency saturation",
  },
  "common-english-word": {
    short: "Dictionary word",
    standard: "it is also a common English word",
    expert: "Common English word",
  },
  "greeting-or-courtesy": {
    short: "Greeting",
    standard: "it is often used as a greeting or courtesy phrase",
    expert: "Greeting or courtesy",
  },
  "pronoun-or-determiner": {
    short: "Grammar word",
    standard: "it is commonly used as a pronoun or determiner",
    expert: "Pronoun or determiner",
  },
  "common-verb": {
    short: "Common verb",
    standard: "it is also a common verb",
    expert: "Common verb",
  },
  "institution-term": {
    short: "Institution name",
    standard: "it matches institutional vocabulary",
    expert: "Institution term",
  },
  "department-organization": {
    short: "Department name",
    standard: "it matches department or organization vocabulary",
    expert: "Department / organization",
  },
  "product-system-name": {
    short: "Product name",
    standard: "it matches product or system vocabulary",
    expert: "Product / system name",
  },
  "season-or-academic-term": {
    short: "Academic term",
    standard: "it matches seasonal or academic vocabulary",
    expert: "Season or academic term",
  },
  "calendar-term": {
    short: "Date or time",
    standard: "it matches calendar vocabulary",
    expert: "Calendar term",
  },
  "calendar-abbreviation": {
    short: "Date abbreviation",
    standard: "it matches a calendar abbreviation",
    expert: "Calendar abbreviation",
  },
  "address-suffix": {
    short: "Address suffix",
    standard: "it matches address vocabulary",
    expert: "Address suffix",
  },
  "document-structure-term": {
    short: "Section word",
    standard: "it matches document-structure vocabulary",
    expert: "Document structure term",
  },
  "legal-administrative-term": {
    short: "Legal term",
    standard: "it matches legal or administrative vocabulary",
    expert: "Legal / administrative term",
  },
  "organization-suffix": {
    short: "Organization suffix",
    standard: "it matches an organization suffix",
    expert: "Organization suffix",
  },
  "professional-credential": {
    short: "Professional degree",
    standard: "it matches a professional credential",
    expert: "Professional credential",
  },
  "honorific-title": {
    short: "Professional title",
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
    short: "Admin phrase",
    standard: "it matches an administrative phrase",
    expert: "Administrative phrase",
  },
  "all-common-dictionary-words": {
    short: "Common phrase",
    standard: "all of its words are common dictionary words",
    expert: "All common dictionary words",
  },
  "sentence-fragment-word": {
    short: "Sentence word",
    standard: "it contains sentence-fragment vocabulary",
    expert: "Sentence fragment word",
  },
  "sentence-fragment": {
    short: "Sentence fragment",
    standard: "it looks like a sentence fragment",
    expert: "Sentence fragment",
  },
  "grammatical-phrase-shape": {
    short: "Normal phrase",
    standard: "it has the shape of a grammatical phrase",
    expert: "Grammatical phrase shape",
  },
  "implausible-capitalization": {
    short: "Odd capitals",
    standard: "it has unusual capitalization",
    expert: "Implausible capitalization",
  },
  "ocr-artifact": {
    short: "Scan error",
    standard: "it has signs of OCR or extraction noise",
    expert: "OCR artifact",
  },
  "no-alpha-tokens": {
    short: "No letters",
    standard: "it does not contain alphabetic tokens",
    expert: "No alpha tokens",
  },
  "too-short-single-token": {
    short: "Too short",
    standard: "it is a very short standalone token",
    expert: "Too-short single token",
  },
  "likely-acronym": {
    short: "Looks like acronym",
    standard: "it has the shape of an acronym",
    expert: "Likely acronym",
  },
  "expanded-common-language-token": {
    short: "Common word",
    standard: "it matches expanded common-language vocabulary",
    expert: "Expanded common language token",
  },
  "ambiguous-lexical-token": {
    short: "Name or word",
    standard: "it is a word that can also be name-like",
    expert: "Ambiguous lexical token",
  },
  "no-positive-person-evidence": {
    short: "Probably not name",
    standard: "there is no strong person-name evidence",
    expert: "No positive person evidence",
  },
  "heading-context": {
    short: "In a heading",
    standard: "it appears in heading-like context",
    expert: "Heading context",
  },
  "weak-name-structure": {
    short: "Loosely name-like",
    standard: "it has weak name structure",
    expert: "Weak name structure",
  },
  "unknown-capitalized-token": {
    short: "Unknown capitalized word",
    standard: "it is an unrecognized capitalized token",
    expert: "Unknown capitalized token",
  },
  "unknown-lowercase-token": {
    short: "Lowercase word",
    standard: "it is an unrecognized lowercase token",
    expert: "Unknown lowercase token",
  },
  "unknown-token": {
    short: "Unknown word",
    standard: "it is not recognized by current deterministic evidence",
    expert: "Unknown token",
  },
};
