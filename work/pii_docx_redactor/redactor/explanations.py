from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .models import Candidate


@dataclass(frozen=True)
class EvidenceText:
    short: str
    standard: str
    expert: str


@dataclass(frozen=True)
class ExplanationEvidence:
    id: str
    polarity: str
    weight: int
    short: str
    standard: str
    expert: str


@dataclass(frozen=True)
class ExplanationContext:
    entity_type: str
    likelihood: int
    recommendation: str
    disposition: str
    occurrences: int
    positive_evidence: list[ExplanationEvidence] = field(default_factory=list)
    negative_evidence: list[ExplanationEvidence] = field(default_factory=list)
    neutral_evidence: list[ExplanationEvidence] = field(default_factory=list)
    diagnostic_categories: list[str] = field(default_factory=list)
    raw_scoring_explanation: str = ""


EXPLANATION_DICTIONARY: dict[str, EvidenceText] = {
    "deterministic_non_person_type": EvidenceText(
        "Structured non-name value",
        "it was detected by a specific non-name recognizer",
        "Deterministic non-person type",
    ),
    "email_address_evidence": EvidenceText(
        "Email evidence",
        "it is associated with an email address",
        "Email address evidence",
    ),
    "nearby_title": EvidenceText(
        "Nearby title",
        "it appears near a title or honorific",
        "Nearby honorific or title",
    ),
    "signature_or_email_header_context": EvidenceText(
        "Signature or email header",
        "it appears in signature or email-header context",
        "Signature or email header context",
    ),
    "surname_given_structure": EvidenceText(
        "Surname-first name structure",
        "it follows a surname-first name pattern",
        "Strong surname, given-name structure",
    ),
    "initials_with_surname": EvidenceText(
        "Initials with surname",
        "it combines initials with a surname",
        "Initials with surname",
    ),
    "strong_name_structure": EvidenceText(
        "Strong name structure",
        "it follows a strong personal-name pattern",
        "Strong personal-name structure",
    ),
    "known_personal_name_token": EvidenceText(
        "Known name token",
        "it contains a known personal-name token",
        "Known personal-name token",
    ),
    "known_first_name": EvidenceText(
        "Known first name",
        "it matches a known first name",
        "Known first name",
    ),
    "known_surname": EvidenceText(
        "Known surname",
        "it matches a known surname",
        "Known surname",
    ),
    "single_name_candidate": EvidenceText(
        "Single-name candidate",
        "it may be a standalone name reference",
        "Single-name candidate",
    ),
    "single_token_reviewable_without_negative_evidence": EvidenceText(
        "Single reviewable token",
        "it is a single token without strong negative evidence",
        "Single token without strong negative evidence",
    ),
    "single_occurrence": EvidenceText(
        "Single occurrence",
        "it appears only once in the document",
        "Single occurrence",
    ),
    "small_frequency_bonus": EvidenceText(
        "Repeated occurrence",
        "it appears more than once in the document",
        "Small frequency bonus",
    ),
    "moderate_frequency_bonus": EvidenceText(
        "Repeated occurrence",
        "it appears repeatedly in the document",
        "Moderate frequency bonus",
    ),
    "frequency_saturated": EvidenceText(
        "Repeated occurrence",
        "it appears repeatedly throughout the document",
        "Frequency saturation",
    ),
    "common_english_word": EvidenceText(
        "Common English word",
        "it is also a common English word",
        "Common English word",
    ),
    "greeting_or_courtesy": EvidenceText(
        "Greeting or courtesy",
        "it is often used as a greeting or courtesy phrase",
        "Greeting or courtesy",
    ),
    "pronoun_or_determiner": EvidenceText(
        "Pronoun or determiner",
        "it is commonly used as a pronoun or determiner",
        "Pronoun or determiner",
    ),
    "common_verb": EvidenceText(
        "Common verb",
        "it is also a common verb",
        "Common verb",
    ),
    "institution_term": EvidenceText(
        "Institution term",
        "it matches institutional vocabulary",
        "Institution term",
    ),
    "department_organization": EvidenceText(
        "Department or organization",
        "it matches department or organization vocabulary",
        "Department / organization",
    ),
    "product_system_name": EvidenceText(
        "Product or system",
        "it matches product or system vocabulary",
        "Product / system name",
    ),
    "season_or_academic_term": EvidenceText(
        "Academic term",
        "it matches seasonal or academic vocabulary",
        "Season or academic term",
    ),
    "calendar_term": EvidenceText(
        "Calendar term",
        "it matches calendar vocabulary",
        "Calendar term",
    ),
    "calendar_abbreviation": EvidenceText(
        "Calendar abbreviation",
        "it matches a calendar abbreviation",
        "Calendar abbreviation",
    ),
    "address_suffix": EvidenceText(
        "Address suffix",
        "it matches address vocabulary",
        "Address suffix",
    ),
    "document_structure_term": EvidenceText(
        "Document structure term",
        "it matches document-structure vocabulary",
        "Document structure term",
    ),
    "legal_administrative_term": EvidenceText(
        "Legal or administrative term",
        "it matches legal or administrative vocabulary",
        "Legal / administrative term",
    ),
    "organization_suffix": EvidenceText(
        "Organization suffix",
        "it matches an organization suffix",
        "Organization suffix",
    ),
    "professional_credential": EvidenceText(
        "Professional credential",
        "it matches a professional credential",
        "Professional credential",
    ),
    "honorific_title": EvidenceText(
        "Honorific or title",
        "it matches title or honorific vocabulary",
        "Honorific / title",
    ),
    "institution_acronym": EvidenceText(
        "Institution acronym",
        "it matches institutional acronym vocabulary",
        "Institution acronym",
    ),
    "abbreviation": EvidenceText(
        "Abbreviation",
        "it is commonly used as an abbreviation",
        "Abbreviation",
    ),
    "common_abbreviation": EvidenceText(
        "Common abbreviation",
        "it matches common abbreviation vocabulary",
        "Common abbreviation",
    ),
    "contraction": EvidenceText(
        "Contraction",
        "it matches contraction vocabulary",
        "Contraction",
    ),
    "interjection_casual": EvidenceText(
        "Casual expression",
        "it matches casual-expression vocabulary",
        "Interjection / casual expression",
    ),
    "administrative_phrase": EvidenceText(
        "Administrative phrase",
        "it matches an administrative phrase",
        "Administrative phrase",
    ),
    "all_common_dictionary_words": EvidenceText(
        "Common-word phrase",
        "all of its words are common dictionary words",
        "All common dictionary words",
    ),
    "sentence_fragment_word": EvidenceText(
        "Sentence fragment word",
        "it contains sentence-fragment vocabulary",
        "Sentence fragment word",
    ),
    "sentence_fragment": EvidenceText(
        "Sentence fragment",
        "it looks like a sentence fragment",
        "Sentence fragment",
    ),
    "grammatical_phrase_shape": EvidenceText(
        "Grammatical phrase",
        "it has the shape of a grammatical phrase",
        "Grammatical phrase shape",
    ),
    "implausible_capitalization": EvidenceText(
        "Unusual capitalization",
        "it has unusual capitalization",
        "Implausible capitalization",
    ),
    "ocr_artifact": EvidenceText(
        "OCR artifact",
        "it has signs of OCR or extraction noise",
        "OCR artifact",
    ),
    "no_alpha_tokens": EvidenceText(
        "No alphabetic tokens",
        "it does not contain alphabetic tokens",
        "No alpha tokens",
    ),
    "too_short_single_token": EvidenceText(
        "Very short token",
        "it is a very short standalone token",
        "Too-short single token",
    ),
    "likely_acronym": EvidenceText(
        "Likely acronym",
        "it has the shape of an acronym",
        "Likely acronym",
    ),
    "expanded_common_language_token": EvidenceText(
        "Common language token",
        "it matches expanded common-language vocabulary",
        "Expanded common language token",
    ),
    "ambiguous_lexical_token": EvidenceText(
        "Ambiguous lexical token",
        "it is a word that can also be name-like",
        "Ambiguous lexical token",
    ),
    "no_positive_person_evidence": EvidenceText(
        "No positive person evidence",
        "there is no strong person-name evidence",
        "No positive person evidence",
    ),
    "heading_context": EvidenceText(
        "Heading context",
        "it appears in heading-like context",
        "Heading context",
    ),
    "weak_name_structure": EvidenceText(
        "Weak name structure",
        "it has weak name structure",
        "Weak name structure",
    ),
    "unknown_capitalized_token": EvidenceText(
        "Unknown capitalized token",
        "it is an unrecognized capitalized token",
        "Unknown capitalized token",
    ),
    "unknown_lowercase_token": EvidenceText(
        "Unknown lowercase token",
        "it is an unrecognized lowercase token",
        "Unknown lowercase token",
    ),
    "unknown_token": EvidenceText(
        "Unknown token",
        "it is not recognized by current deterministic evidence",
        "Unknown token",
    ),
}


def _fallback_text(evidence_id: str) -> EvidenceText:
    label = evidence_id.replace("_", " ").strip().title() or "Evidence"
    return EvidenceText(label, f"it has {label.lower()} evidence", label)


def _polarity(weight: int) -> str:
    if weight > 0:
        return "positive"
    if weight < 0:
        return "negative"
    return "neutral"


def normalize_evidence(raw: dict[str, Any]) -> ExplanationEvidence:
    evidence_id = str(raw.get("id") or raw.get("rule") or "").strip()
    weight = int(raw.get("weight") or 0)
    text = EXPLANATION_DICTIONARY.get(evidence_id, _fallback_text(evidence_id))
    return ExplanationEvidence(
        id=evidence_id,
        polarity=str(raw.get("polarity") or _polarity(weight)),
        weight=weight,
        short=text.short,
        standard=text.standard,
        expert=text.expert,
    )


def explanation_context_for_candidate(candidate: Candidate, disposition: str = "") -> ExplanationContext:
    evidence = [normalize_evidence(item) for item in candidate.quality_evidence_breakdown]
    diagnostic_categories = list(dict.fromkeys(candidate.quality_filter_rules or candidate.quality_reasons))
    return ExplanationContext(
        entity_type=candidate.detected_type,
        likelihood=candidate.candidate_score,
        recommendation=candidate.quality_status,
        disposition=disposition or candidate.quality_status,
        occurrences=candidate.count,
        positive_evidence=[item for item in evidence if item.polarity == "positive"],
        negative_evidence=[item for item in evidence if item.polarity == "negative"],
        neutral_evidence=[item for item in evidence if item.polarity == "neutral"],
        diagnostic_categories=diagnostic_categories,
        raw_scoring_explanation=candidate.quality_explanation,
    )


def _entity_phrase(entity_type: str) -> str:
    labels = {
        "person": "a person's name",
        "email": "an email address",
        "phone": "a phone number",
        "cin": "an identifying number",
        "long_numeric_id": "an identifying number",
        "other_identifier": "an identifier",
    }
    return labels.get(entity_type, f"a {entity_type.replace('_', ' ')}")


def _confidence_opener(likelihood: int, entity_type: str) -> str:
    entity = _entity_phrase(entity_type)
    if likelihood >= 95:
        return f"We believe this is {entity}"
    if likelihood >= 80:
        return f"This is likely {entity}"
    if likelihood >= 50:
        return f"This may be {entity}"
    return f"This is unlikely to be {entity}"


def _join_phrases(phrases: list[str]) -> str:
    clean = [phrase for phrase in phrases if phrase]
    if not clean:
        return ""
    if len(clean) == 1:
        return clean[0]
    if len(clean) == 2:
        return f"{clean[0]} and {clean[1]}"
    return f"{', '.join(clean[:-1])}, and {clean[-1]}"


def build_standard_explanation(context: ExplanationContext) -> str:
    positives = _join_phrases([item.standard for item in context.positive_evidence[:3]])
    negatives = _join_phrases([item.standard for item in context.negative_evidence[:3]])
    opener = _confidence_opener(context.likelihood, context.entity_type)
    if positives and negatives:
        return f"{opener} because {positives}, but {negatives}."
    if positives:
        return f"{opener} because {positives}."
    if negatives:
        return f"{opener} because {negatives}."
    if context.neutral_evidence:
        neutral = _join_phrases([item.standard for item in context.neutral_evidence[:3]])
        return f"{opener} based on deterministic evidence: {neutral}."
    return f"{opener}. No explanatory evidence was recorded."


def explanation_payload(context: ExplanationContext) -> dict[str, Any]:
    def evidence_payload(items: list[ExplanationEvidence]) -> list[dict[str, Any]]:
        return [
            {
                "id": item.id,
                "polarity": item.polarity,
                "weight": item.weight,
                "short": item.short,
                "standard": item.standard,
                "expert": item.expert,
            }
            for item in items
        ]

    standard = build_standard_explanation(context)
    return {
        "standard": {
            "likelihood": context.likelihood,
            "recommendation": context.recommendation,
            "occurrences": context.occurrences,
            "summary": standard,
        },
        "expert": {
            "likelihood": context.likelihood,
            "recommendation": context.recommendation,
            "current_disposition": context.disposition,
            "positive_evidence": evidence_payload(context.positive_evidence),
            "negative_evidence": evidence_payload(context.negative_evidence),
            "neutral_evidence": evidence_payload(context.neutral_evidence),
            "diagnostic_categories": context.diagnostic_categories,
            "raw_scoring_explanation": context.raw_scoring_explanation,
        },
        "audit": {
            "summary": standard,
            "positive_evidence": [item.expert for item in context.positive_evidence],
            "negative_evidence": [item.expert for item in context.negative_evidence],
            "neutral_evidence": [item.expert for item in context.neutral_evidence],
        },
    }


def explain_candidate(candidate: Candidate, disposition: str = "") -> dict[str, Any]:
    return explanation_payload(explanation_context_for_candidate(candidate, disposition))
