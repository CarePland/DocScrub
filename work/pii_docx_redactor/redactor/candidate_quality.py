from __future__ import annotations

import re
import json
import unicodedata
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from .models import Candidate


STRONG = "Strong"
POSSIBLE = "Possible"
UNLIKELY = "Unlikely"
FILTERED = "Filtered (Auto Ignore)"
REVIEW = "To Review"
RESOLVED = "Resolved"

TITLE_RE = re.compile(r"\b(?:dr|mr|mrs|ms|prof|professor|judge|dean)\.?\s+\[?", re.IGNORECASE)
EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
LAST_FIRST_RE = re.compile(r"^[A-Z][A-Za-z'’.-]+,\s*[A-Z][A-Za-z'’.-]+(?:\s+[A-Z]{1,4})?$")
INITIAL_SURNAME_RE = re.compile(r"^(?:[A-Z]\.\s*)+[A-Z][A-Za-z'’.-]+$")
SURNAME_INITIALS_RE = re.compile(r"^[A-Z][A-Za-z'’.-]+,\s*[A-Z]{1,4}$")
TWO_NAME_RE = re.compile(r"^[A-Z][A-Za-z'’.-]{1,}(?:\s+[A-Z][A-Za-z'’.-]{1,}){1,3}$")
BAD_CAPS_RE = re.compile(r"^[a-z]|[A-Z]{3,}[a-z]")
OCR_ARTIFACT_RE = re.compile(r"(?:[A-Za-z]\d|\d[A-Za-z]|[_\\/]{2,}|[A-Z]{2,}[a-z]{1,2}[A-Z])")
ACRONYM_RE = re.compile(
    r"^(?:"
    r"[A-Z]{2,10}|"
    r"[A-Z]{1,6}\d{1,4}|"
    r"(?:[A-Z]\.){2,}|"
    r"[A-Z]{2,10}(?:[-/][A-Z0-9]{1,6})+|"
    r"[A-Z]{2,10}-\d{1,6}"
    r")$"
)

DEFAULT_QUALITY_DICTIONARIES = {
    "pronoun_or_determiner": {
        "i",
        "i'm",
        "im",
        "i've",
        "ive",
        "i'll",
        "you",
        "he",
        "she",
        "they",
        "them",
        "there",
        "that",
        "this",
        "these",
        "those",
    },
    "common_verb": {
        "begin",
        "can",
        "does",
        "get",
        "has",
        "have",
        "laugh",
        "should",
        "will",
        "would",
    },
    "greeting_or_courtesy": {
        "good afternoon",
        "good evening",
        "good morning",
        "hello",
        "hi",
        "morning",
        "please",
        "regards",
        "sincerely",
        "thank",
        "thanks",
    },
    "institution_term": {
        "admissions",
        "cal state",
        "canvas",
        "department",
        "enrollment",
        "faculty",
        "its",
        "records",
        "registrar",
    },
    "season_or_academic_term": {
        "fall",
        "fully online",
        "quarter",
        "semester",
        "session",
        "spring",
        "summer",
        "winter",
    },
    "calendar_term": {
        "april",
        "august",
        "december",
        "february",
        "friday",
        "january",
        "july",
        "june",
        "march",
        "may",
        "monday",
        "november",
        "october",
        "saturday",
        "september",
        "sunday",
        "thursday",
        "tuesday",
        "wednesday",
    },
    "abbreviation": {"etc", "fyi", "perc"},
    "common_english_word": set(),
    "ambiguous_lexical_token": set(),
    "institution_acronym": {
        "cfa",
        "csu",
        "csula",
        "ferpa",
        "hr",
        "its",
    },
    "product_system_name": {
        "canvas",
        "microsoft",
        "mycalstatela",
        "outlook",
        "teams",
        "zoom",
    },
    "department_organization": {
        "admissions",
        "department",
        "enrollment",
        "faculty",
        "registrar",
        "records",
    },
    "known_first_name": set(),
    "known_surname": set(),
    "sentence_fragment_word": {
        "a",
        "an",
        "and",
        "are",
        "be",
        "been",
        "being",
        "but",
        "for",
        "furthermore",
        "is",
        "of",
        "or",
        "the",
        "was",
        "we",
        "were",
    },
    "administrative_phrase": {
        "family educational rights",
        "human resources",
        "immediate reversal",
        "legal violations",
        "privacy act",
        "service indicators",
        "the records office",
    },
}

LOCAL_DICTIONARY_PATH = Path.cwd() / "candidate_quality_terms.json"
LEXICON_DIR = Path.cwd() / "config" / "candidate-quality"
LEXICAL_EVIDENCE_DIR = Path.cwd() / "config" / "lexical_evidence"

LEXICON_EVIDENCE_REGISTRY = {
    "common_non_name_words": {
        "rule": "common_english_word",
        "label": "Common English word",
        "polarity": "negative",
    },
    "ambiguous_name_words": {
        "rule": "ambiguous_lexical_token",
        "label": "Ambiguous lexical token",
        "polarity": "neutral",
    },
    "expanded_common_language_words": {
        "rule": "expanded_common_language_token",
        "label": "Expanded common language token",
        "polarity": "neutral",
    },
    "address_suffixes": {
        "rule": "address_suffix",
        "label": "Address suffix",
        "polarity": "neutral",
    },
    "calendar_abbreviations": {
        "rule": "calendar_abbreviation",
        "label": "Calendar abbreviation",
        "polarity": "neutral",
    },
    "common_abbreviations": {
        "rule": "common_abbreviation",
        "label": "Common abbreviation",
        "polarity": "neutral",
    },
    "contractions": {
        "rule": "contraction",
        "label": "Contraction",
        "polarity": "neutral",
    },
    "honorific_titles": {
        "rule": "honorific_title",
        "label": "Honorific / title",
        "polarity": "neutral",
    },
    "honorifics_and_titles": {
        "rule": "honorific_title",
        "label": "Honorific / title",
        "polarity": "neutral",
    },
    "interjections_and_casual": {
        "rule": "interjection_casual",
        "label": "Interjection / casual expression",
        "polarity": "neutral",
    },
    "professional_credentials": {
        "rule": "professional_credential",
        "label": "Professional credential",
        "polarity": "neutral",
    },
    "organization_suffixes": {
        "rule": "organization_suffix",
        "label": "Organization suffix",
        "polarity": "neutral",
    },
    "document_structure_terms": {
        "rule": "document_structure_term",
        "label": "Document structure term",
        "polarity": "neutral",
    },
    "legal_administrative_terms": {
        "rule": "legal_administrative_term",
        "label": "Legal / administrative term",
        "polarity": "neutral",
    },
    "product_and_system_names_seed": {
        "rule": "product_system_name",
        "label": "Product / system name",
        "polarity": "neutral",
    },
}


def _rule_name_from_lexicon_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", normalize_lexicon_entry(name)).strip("_")


def _lexicon_config(name: str, registry: dict[str, dict[str, str]]) -> dict[str, str]:
    if name in registry:
        return registry[name]
    rule = _rule_name_from_lexicon_name(name)
    return {
        "rule": rule,
        "label": rule.replace("_", " ").title(),
        "polarity": "neutral",
    }


def normalize_lexicon_entry(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value)
    normalized = normalized.replace("’", "'").replace("‘", "'").replace("`", "'")
    return normalized.casefold().strip()


def load_lexicon_terms(path: Path) -> set[str]:
    terms: set[str] = set()
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return terms
    for line in lines:
        normalized = normalize_lexicon_entry(line)
        if not normalized or normalized.startswith("#"):
            continue
        terms.add(normalized)
    return terms


def load_configured_lexicons(
    directory: Path = LEXICON_DIR,
    registry: dict[str, dict[str, str]] = LEXICON_EVIDENCE_REGISTRY,
) -> dict[str, set[str]]:
    lexicons: dict[str, set[str]] = {}
    directories = [directory]
    if directory == LEXICON_DIR:
        directories.insert(0, LEXICAL_EVIDENCE_DIR)
    for lexicon_dir in directories:
        if not lexicon_dir.exists():
            continue
        for path in sorted(lexicon_dir.glob("*.txt")):
            name = path.stem
            if name in {"readme", "lexicon_manifest"}:
                continue
            config = _lexicon_config(name, registry)
            rule = config["rule"]
            lexicons.setdefault(rule, set()).update(load_lexicon_terms(path))
    return lexicons


def load_quality_dictionaries(path: Path = LOCAL_DICTIONARY_PATH) -> dict[str, set[str]]:
    dictionaries = {
        rule_name: {normalize_lexicon_entry(entry) for entry in entries}
        for rule_name, entries in DEFAULT_QUALITY_DICTIONARIES.items()
    }
    for rule_name, entries in load_configured_lexicons().items():
        dictionaries.setdefault(rule_name, set()).update(entries)
    if not path.exists():
        return dictionaries
    try:
        raw_terms = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return dictionaries
    if not isinstance(raw_terms, dict):
        return dictionaries
    for rule_name, entries in raw_terms.items():
        if not isinstance(rule_name, str) or not isinstance(entries, list):
            continue
        dictionaries.setdefault(rule_name, set())
        dictionaries[rule_name].update(
            normalize_lexicon_entry(str(entry))
            for entry in entries
            if str(entry).strip()
        )
    return dictionaries


QUALITY_DICTIONARIES = load_quality_dictionaries()


def _dictionary_index(
    dictionaries: dict[str, set[str]],
) -> tuple[dict[str, set[str]], dict[str, set[str]]]:
    single_terms: dict[str, set[str]] = {}
    phrase_terms: dict[str, set[str]] = {}
    for rule_name, entries in dictionaries.items():
        single_terms[rule_name] = {entry for entry in entries if " " not in entry}
        phrase_terms[rule_name] = {entry for entry in entries if " " in entry}
    return single_terms, phrase_terms


QUALITY_SINGLE_TERMS, QUALITY_PHRASE_TERMS = _dictionary_index(QUALITY_DICTIONARIES)

COMMON_DICTIONARY_EXCLUSIONS = {
    "address_suffix",
    "ambiguous_lexical_token",
    "calendar_abbreviation",
    "common_abbreviation",
    "contraction",
    "document_structure_term",
    "expanded_common_language_token",
    "honorific_title",
    "interjection_casual",
    "known_first_name",
    "known_surname",
    "legal_administrative_term",
    "organization_suffix",
    "professional_credential",
    "product_system_name",
}
ALL_COMMON_DICTIONARY_WORDS = set().union(
    *(
        entries
        for rule, entries in QUALITY_SINGLE_TERMS.items()
        if rule not in COMMON_DICTIONARY_EXCLUSIONS
    )
)

KNOWN_GIVEN_NAMES = {
    "adriana",
    "andrew",
    "gustavo",
    "christopher",
    "diana",
    "giancarlo",
    "jane",
    "joan",
    "john",
    "julie",
    "lopez",
    "margaret",
    "mary",
    "nelly",
    "osmara",
    "parra",
    "patrick",
    "sarah",
    "tamara",
    "tanesha",
    "taneshia",
    "vincent",
    "vince",
}

KNOWN_SURNAMES = {
    "goodloe",
    "lopez",
    "martinez-navarro",
    "parra",
    "reyes",
}

NEGATIVE_FILTER_RULES = {
    "abbreviation",
    "administrative_phrase",
    "all_common_dictionary_words",
    "calendar_term",
    "common_english_word",
    "common_verb",
    "department_organization",
    "grammatical_phrase_shape",
    "greeting_or_courtesy",
    "implausible_capitalization",
    "institution_acronym",
    "institution_term",
    "no_alpha_tokens",
    "ocr_artifact",
    "pronoun_or_determiner",
    "season_or_academic_term",
    "sentence_fragment",
    "sentence_fragment_word",
    "too_short_single_token",
}

AMBIGUOUS_NAME_SOFT_NEGATIVES = {
    "all_common_dictionary_words",
    "calendar_term",
    "common_english_word",
    "common_verb",
    "season_or_academic_term",
    "too_short_single_token",
}

NEUTRAL_LEXICAL_EVIDENCE_RULES = {
    config["rule"]
    for config in LEXICON_EVIDENCE_REGISTRY.values()
    if config.get("polarity") == "neutral"
}
PROTECTIVE_SINGLE_TOKEN_EVIDENCE_RULES = {
    "ambiguous_lexical_token",
    "calendar_abbreviation",
    "common_abbreviation",
    "contraction",
    "honorific_title",
    "interjection_casual",
    "professional_credential",
}

SINGLE_TOKEN_CLASSIFICATIONS = {
    "known_first_name",
    "known_surname",
    "address_suffix",
    "calendar_abbreviation",
    "common_english_word",
    "common_abbreviation",
    "contraction",
    "document_structure_term",
    "expanded_common_language_token",
    "honorific_title",
    "interjection_casual",
    "institution_acronym",
    "legal_administrative_term",
    "organization_suffix",
    "professional_credential",
    "product_system_name",
    "department_organization",
    "ambiguous_lexical_token",
    "likely_acronym",
    "unknown_capitalized_token",
    "unknown_lowercase_token",
    "ocr_artifact",
    "unknown_token",
}


@dataclass(frozen=True)
class QualityResult:
    quality: str
    reasons: list[str]
    explanation: str
    suggested_type: str | None = None
    status: str = REVIEW
    score: int = 50
    evidence_breakdown: list[dict[str, int | str]] = field(default_factory=list)
    positive_reasons: list[str] = field(default_factory=list)
    filter_rules: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class QualityEvidence:
    classifications: list[str]
    positive: list[str]
    negative: list[str]


STATUS_THRESHOLDS = {
    REVIEW: 25,
}

EVIDENCE_WEIGHTS: dict[str, int] = {
    "deterministic_non_person_type": 70,
    "email_address_evidence": 32,
    "nearby_title": 40,
    "signature_or_email_header_context": 22,
    "surname_given_structure": 50,
    "initials_with_surname": 42,
    "strong_name_structure": 35,
    "known_personal_name_token": 20,
    "known_first_name": 28,
    "known_surname": 26,
    "single_name_candidate": 8,
    "single_token_reviewable_without_negative_evidence": 12,
    "single_occurrence": -4,
    "small_frequency_bonus": 4,
    "moderate_frequency_bonus": 9,
    "frequency_saturated": 14,
    "common_english_word": -28,
    "greeting_or_courtesy": -32,
    "pronoun_or_determiner": -35,
    "common_verb": -24,
    "institution_term": -24,
    "department_organization": -22,
    "product_system_name": -22,
    "season_or_academic_term": -22,
    "calendar_term": -22,
    "calendar_abbreviation": -12,
    "address_suffix": -18,
    "document_structure_term": -18,
    "legal_administrative_term": -14,
    "organization_suffix": -10,
    "professional_credential": -4,
    "honorific_title": 6,
    "institution_acronym": -18,
    "abbreviation": -16,
    "common_abbreviation": -10,
    "contraction": -10,
    "interjection_casual": -18,
    "administrative_phrase": -30,
    "all_common_dictionary_words": -18,
    "sentence_fragment_word": -16,
    "sentence_fragment": -24,
    "grammatical_phrase_shape": -18,
    "implausible_capitalization": -28,
    "ocr_artifact": -35,
    "no_alpha_tokens": -35,
    "too_short_single_token": -28,
    "likely_acronym": -8,
    "expanded_common_language_token": -40,
    "ambiguous_lexical_token": 28,
    "no_positive_person_evidence": -5,
    "heading_context": -12,
    "weak_name_structure": -5,
    "unknown_capitalized_token": 0,
    "unknown_lowercase_token": -12,
    "unknown_token": -10,
}


def _evidence_label(rule: str) -> str:
    explicit = {
        "deterministic_non_person_type": "Deterministic non-person type",
        "email_address_evidence": "Email address evidence",
        "nearby_title": "Nearby honorific or title",
        "signature_or_email_header_context": "Signature or email header context",
        "surname_given_structure": "Surname, given-name structure",
        "initials_with_surname": "Initials with surname",
        "strong_name_structure": "Strong name structure",
        "known_personal_name_token": "Known personal-name token",
        "known_first_name": "Known first name",
        "known_surname": "Known surname",
        "single_name_candidate": "Single-name candidate",
        "single_token_reviewable_without_negative_evidence": "Single token without strong negative evidence",
        "small_frequency_bonus": "Small frequency bonus",
        "moderate_frequency_bonus": "Moderate frequency bonus",
        "frequency_saturated": "Frequency saturation",
    }
    return explicit.get(rule, rule.replace("_", " ").title())


def _score_from_evidence(reasons: list[str]) -> tuple[int, list[dict[str, int | str]]]:
    unique_reasons = list(dict.fromkeys(reasons))
    contributions = [
        {
            "rule": reason,
            "label": _evidence_label(reason),
            "weight": EVIDENCE_WEIGHTS.get(reason, 0),
        }
        for reason in unique_reasons
    ]
    score = 35 + sum(int(item["weight"]) for item in contributions)
    score = max(1, min(99, score))
    return score, contributions


def _status_from_score(score: int) -> str:
    return REVIEW if score >= STATUS_THRESHOLDS[REVIEW] else UNLIKELY


def _quality_from_score(score: int) -> str:
    if score >= 80:
        return STRONG
    if score >= STATUS_THRESHOLDS[REVIEW]:
        return POSSIBLE
    return UNLIKELY


def _scored_result(
    *,
    reasons: list[str],
    explanation: str,
    suggested_type: str | None = None,
    positive_reasons: list[str] | None = None,
    filter_rules: list[str] | None = None,
) -> QualityResult:
    unique_reasons = list(dict.fromkeys(reasons))
    score, breakdown = _score_from_evidence(unique_reasons)
    return QualityResult(
        _quality_from_score(score),
        unique_reasons,
        explanation,
        suggested_type=suggested_type,
        status=_status_from_score(score),
        score=score,
        evidence_breakdown=breakdown,
        positive_reasons=list(dict.fromkeys(positive_reasons or [])),
        filter_rules=list(dict.fromkeys(filter_rules or [])),
    )


def _tokens(text: str) -> list[str]:
    return re.findall(r"[A-Za-z][A-Za-z'’.-]*", unicodedata.normalize("NFKC", text))


def _normalized_text(text: str) -> str:
    return re.sub(r"\s+", " ", normalize_lexicon_entry(text))


def _normalized_token_set(text: str) -> set[str]:
    return {normalize_lexicon_entry(token).strip(".") for token in _tokens(text)}


def _context_text(candidate: Candidate) -> str:
    return normalize_lexicon_entry(" ".join(occurrence.context for occurrence in candidate.occurrences))


def _is_heading_like(candidate: Candidate) -> bool:
    for occurrence in candidate.occurrences:
        location = normalize_lexicon_entry(occurrence.location)
        context = occurrence.context
        if "header" in location or "subject" in normalize_lexicon_entry(context):
            return True
        bare = context.replace("[", "").replace("]", "").strip()
        if bare and bare.upper() == bare and len(bare) > 8:
            return True
    return False


def _appears_in_email(candidate: Candidate) -> bool:
    candidate_tokens = _normalized_token_set(candidate.text)
    if not candidate_tokens:
        return False
    for occurrence in candidate.occurrences:
        for email in EMAIL_RE.findall(occurrence.context):
            email_tokens = {normalize_lexicon_entry(token) for token in re.findall(r"[a-z]+", email, re.IGNORECASE)}
            if candidate_tokens & email_tokens:
                return True
    return False


def _near_title(candidate: Candidate) -> bool:
    for occurrence in candidate.occurrences:
        before_match = re.search(r"(?:^|[\s:;,.])(?:dr|mr|mrs|ms|prof|professor|judge|dean)\.?\s+\[?$", occurrence.context[: occurrence.context.find("[") if "[" in occurrence.context else len(occurrence.context)], re.IGNORECASE)
        if before_match or TITLE_RE.search(occurrence.context):
            return True
    return False


def _signature_evidence(candidate: Candidate) -> bool:
    text = normalize_lexicon_entry(candidate.text)
    for occurrence in candidate.occurrences:
        context = normalize_lexicon_entry(occurrence.context)
        if any(marker in context for marker in ("signature", "regards,", "sincerely,", "from:", "sent:")) and text in context:
            return True
    return False


def _positive_evidence(candidate: Candidate) -> list[str]:
    reasons: list[str] = []
    if candidate.detected_type != "person":
        reasons.append("deterministic_non_person_type")
    if _appears_in_email(candidate):
        reasons.append("email_address_evidence")
    if _near_title(candidate):
        reasons.append("nearby_title")
    if _signature_evidence(candidate):
        reasons.append("signature_or_email_header_context")
    return reasons


def _dictionary_rules(text: str, tokens: set[str]) -> list[str]:
    folded = _normalized_text(text)
    rules: list[str] = []
    for rule_name in QUALITY_DICTIONARIES:
        if folded in QUALITY_PHRASE_TERMS.get(rule_name, set()):
            rules.append(rule_name)
            continue
        if tokens & QUALITY_SINGLE_TERMS.get(rule_name, set()):
            rules.append(rule_name)
    return rules


def _is_likely_acronym(text: str) -> bool:
    compact = re.sub(r"\s+", "", unicodedata.normalize("NFKC", text).strip())
    if not compact or re.match(r"^[A-Z][a-z]+$", compact):
        return False
    return bool(ACRONYM_RE.match(compact))


def _acronym_classifications(text: str) -> list[str]:
    return ["likely_acronym"] if _is_likely_acronym(text) else []


def _shape_rules(text: str, tokens: list[str], token_set: set[str]) -> list[str]:
    rules: list[str] = []
    if not tokens:
        rules.append("no_alpha_tokens")
        return rules
    if _is_likely_acronym(text):
        return rules
    if BAD_CAPS_RE.search(text):
        rules.append("implausible_capitalization")
    if len(tokens) >= 2 and len(token_set & QUALITY_DICTIONARIES["sentence_fragment_word"]) >= 1:
        rules.append("sentence_fragment")
    if token_set and token_set.issubset(ALL_COMMON_DICTIONARY_WORDS):
        rules.append("all_common_dictionary_words")
    if len(tokens) > 4:
        rules.append("grammatical_phrase_shape")
    if len(tokens) == 1 and len(tokens[0]) <= 2:
        rules.append("too_short_single_token")
    if OCR_ARTIFACT_RE.search(text) and not _is_likely_acronym(text):
        rules.append("ocr_artifact")
    return rules


def _single_token_classifications(text: str, tokens: list[str], token_set: set[str]) -> list[str]:
    if len(tokens) != 1:
        return []
    token = next(iter(token_set), "")
    classifications: list[str] = []
    if token in KNOWN_GIVEN_NAMES or token in QUALITY_DICTIONARIES["known_first_name"]:
        classifications.append("known_first_name")
    if token in KNOWN_SURNAMES or token in QUALITY_DICTIONARIES["known_surname"]:
        classifications.append("known_surname")
    if token in QUALITY_DICTIONARIES["common_english_word"]:
        classifications.append("common_english_word")
    if token in QUALITY_DICTIONARIES.get("address_suffix", set()):
        classifications.append("address_suffix")
    if token in QUALITY_DICTIONARIES.get("calendar_abbreviation", set()):
        classifications.append("calendar_abbreviation")
    if token in QUALITY_DICTIONARIES.get("common_abbreviation", set()):
        classifications.append("common_abbreviation")
    if token in QUALITY_DICTIONARIES.get("contraction", set()):
        classifications.append("contraction")
    if token in QUALITY_DICTIONARIES.get("expanded_common_language_token", set()):
        classifications.append("expanded_common_language_token")
    if token in QUALITY_DICTIONARIES.get("interjection_casual", set()):
        classifications.append("interjection_casual")
    if token in QUALITY_DICTIONARIES["institution_acronym"]:
        classifications.append("institution_acronym")
    if token in QUALITY_DICTIONARIES["product_system_name"]:
        classifications.append("product_system_name")
    if token in QUALITY_DICTIONARIES["department_organization"]:
        classifications.append("department_organization")
    if token in QUALITY_DICTIONARIES["honorific_title"]:
        classifications.append("honorific_title")
    if token in QUALITY_DICTIONARIES["professional_credential"]:
        classifications.append("professional_credential")
    if token in QUALITY_DICTIONARIES["organization_suffix"]:
        classifications.append("organization_suffix")
    if token in QUALITY_DICTIONARIES["document_structure_term"]:
        classifications.append("document_structure_term")
    if token in QUALITY_DICTIONARIES["legal_administrative_term"]:
        classifications.append("legal_administrative_term")
    if OCR_ARTIFACT_RE.search(text) and not _is_likely_acronym(text):
        classifications.append("ocr_artifact")
    if _is_likely_acronym(text):
        classifications.append("likely_acronym")
    if not classifications:
        if text[:1].isupper():
            classifications.append("unknown_capitalized_token")
        elif text[:1].islower():
            classifications.append("unknown_lowercase_token")
        else:
            classifications.append("unknown_token")
    return classifications


def _quality_evidence(
    candidate: Candidate,
    text: str,
    tokens: list[str],
    token_set: set[str],
) -> QualityEvidence:
    positive = _positive_evidence(candidate)
    acronym_rules = _acronym_classifications(text)
    dictionary_rules = _dictionary_rules(text, token_set)
    if acronym_rules:
        dictionary_rules = [
            rule for rule in dictionary_rules
            if rule not in {"sentence_fragment_word"}
        ]
    shape_rules = _shape_rules(text, tokens, token_set)
    single_token_rules = _single_token_classifications(text, tokens, token_set)
    classifications = list(dict.fromkeys(dictionary_rules + shape_rules + acronym_rules + single_token_rules))
    if len(tokens) > 1 or "ambiguous_lexical_token" in classifications:
        classifications = [
            rule for rule in classifications
            if rule != "expanded_common_language_token"
        ]
    if any(rule not in {"unknown_capitalized_token", "unknown_lowercase_token", "unknown_token"} for rule in classifications):
        classifications = [
            rule for rule in classifications
            if rule not in {"unknown_capitalized_token", "unknown_lowercase_token", "unknown_token"}
        ]
    positive.extend(
        rule for rule in classifications
        if rule in {"known_first_name", "known_surname"}
    )
    negative = [rule for rule in classifications if rule in NEGATIVE_FILTER_RULES]
    return QualityEvidence(
        classifications=classifications,
        positive=list(dict.fromkeys(positive)),
        negative=list(dict.fromkeys(negative)),
    )


def _filter_result(
    candidate: Candidate,
    base_reasons: list[str],
    filter_rules: list[str],
    evidence_rules: list[str] | None = None,
) -> QualityResult:
    evidence = evidence_rules or filter_rules
    return _scored_result(
        reasons=base_reasons + evidence + ["no_positive_person_evidence"],
        explanation="Deterministic evidence gives this candidate low review priority",
        filter_rules=evidence,
    )


def score_candidate_quality(candidate: Candidate) -> QualityResult:
    if candidate.detected_type != "person":
        return _scored_result(
            reasons=["deterministic_non_person_type"],
            explanation="Deterministic non-person detector",
            positive_reasons=["deterministic_non_person_type"],
        )

    text = re.sub(r"\s+", " ", candidate.text.strip())
    folded = _normalized_text(text)
    tokens = _tokens(text)
    token_set = _normalized_token_set(text)
    reasons: list[str] = []
    suggested_type = None

    if candidate.count == 1:
        reasons.append("single_occurrence")
    elif candidate.count == 2:
        reasons.append("small_frequency_bonus")
    elif candidate.count <= 5:
        reasons.append("moderate_frequency_bonus")
    else:
        reasons.append("frequency_saturated")

    evidence = _quality_evidence(candidate, text, tokens, token_set)
    positive_reasons = evidence.positive
    classifications = evidence.classifications
    filter_rules = evidence.negative

    if folded in {"the records office", "human resources", "department", "faculty", "registrar", "records"}:
        suggested_type = "organization"

    has_ambiguous_name_evidence = "ambiguous_lexical_token" in classifications
    has_protective_single_token_evidence = (
        len(tokens) == 1
        and bool(set(classifications) & PROTECTIVE_SINGLE_TOKEN_EVIDENCE_RULES)
    )
    only_soft_ambiguous_negatives = set(filter_rules).issubset(AMBIGUOUS_NAME_SOFT_NEGATIVES)
    if filter_rules and not positive_reasons and not (
        (has_ambiguous_name_evidence or has_protective_single_token_evidence)
        and only_soft_ambiguous_negatives
    ):
        return _filter_result(candidate, reasons, filter_rules, classifications)

    if LAST_FIRST_RE.match(text):
        return _scored_result(
            reasons=reasons + positive_reasons + classifications + ["surname_given_structure"],
            explanation="Strong surname, given-name structure",
            positive_reasons=positive_reasons + ["surname_given_structure"],
            filter_rules=classifications,
        )
    if SURNAME_INITIALS_RE.match(text) or INITIAL_SURNAME_RE.match(text):
        return _scored_result(
            reasons=reasons + positive_reasons + classifications + ["initials_with_surname"],
            explanation="Strong surname and initials structure",
            positive_reasons=positive_reasons + ["initials_with_surname"],
            filter_rules=classifications,
        )
    if TWO_NAME_RE.match(text):
        structure_reasons = ["strong_name_structure"]
        if token_set & KNOWN_GIVEN_NAMES:
            structure_reasons.append("known_personal_name_token")
        if _is_heading_like(candidate) and not positive_reasons:
            return _scored_result(
                reasons=reasons + positive_reasons + structure_reasons + ["heading_context"],
                explanation="Name-like phrase, but heading context makes it less certain",
                positive_reasons=positive_reasons + structure_reasons,
                filter_rules=classifications,
            )
        return _scored_result(
            reasons=reasons + positive_reasons + classifications + structure_reasons,
            explanation="Strong personal-name structure",
            positive_reasons=positive_reasons + structure_reasons,
            filter_rules=classifications,
        )

    if len(tokens) == 1:
        if positive_reasons:
            return _scored_result(
                reasons=reasons + positive_reasons + classifications + ["single_name_candidate"],
                explanation="Single-name candidate",
                positive_reasons=positive_reasons,
                filter_rules=classifications,
            )
        return _scored_result(
            reasons=reasons + classifications + ["single_token_reviewable_without_negative_evidence"],
            explanation="Single-token candidate without strong negative evidence",
            filter_rules=classifications,
        )

    return _scored_result(
        reasons=reasons + positive_reasons + classifications + ["weak_name_structure"],
        explanation="Possible person candidate",
        suggested_type=suggested_type,
        positive_reasons=positive_reasons,
        filter_rules=classifications,
    )


def is_filtered_candidate(candidate: Candidate) -> bool:
    return False


def candidate_quality_metrics(candidates: list[Candidate]) -> dict[str, object]:
    total = len(candidates)
    filtered: list[Candidate] = []
    resolved = [candidate for candidate in candidates if candidate.quality_status == RESOLVED]
    resolved_keys = {candidate.key for candidate in resolved}
    unlikely = [
        candidate for candidate in candidates
        if candidate.key not in resolved_keys
        and (candidate.quality_status == UNLIKELY or candidate.quality == UNLIKELY)
    ]
    to_review = total - len(unlikely) - len(resolved)
    rule_counts: Counter[str] = Counter()
    for candidate in unlikely:
        rule_counts.update(candidate.quality_filter_rules or candidate.quality_reasons)
    classification_counts: Counter[str] = Counter()
    for candidate in candidates:
        classification_counts.update(candidate.quality_filter_rules)
    return {
        "raw_candidates": total,
        "filtered": len(filtered),
        "unlikely": len(unlikely),
        "to_review": to_review,
        "resolved": len(resolved),
        "remaining_review": to_review,
        "reduction_percent": 0,
        "rule_counts": dict(sorted(rule_counts.items())),
        "classification_counts": dict(sorted(classification_counts.items())),
    }


def apply_candidate_quality(candidates: list[Candidate]) -> list[Candidate]:
    for candidate in candidates:
        result = score_candidate_quality(candidate)
        candidate.quality = result.quality
        candidate.quality_reasons = result.reasons
        candidate.quality_explanation = result.explanation
        candidate.suggested_type = result.suggested_type
        candidate.quality_status = result.status
        candidate.candidate_score = result.score
        candidate.quality_evidence_breakdown = result.evidence_breakdown
        candidate.quality_positive_reasons = result.positive_reasons
        candidate.quality_filter_rules = result.filter_rules
    return candidates
