from __future__ import annotations

import re
from collections import OrderedDict
from typing import Iterable, List

from .docx_reader import TextBlock
from .models import Candidate, Occurrence

EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.IGNORECASE)
PHONE_RE = re.compile(
    r"(?<!\d)(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}(?!\d)"
)
CIN_RE = re.compile(r"(?<!\d)\d{9}(?!\d)")
LONG_ID_RE = re.compile(r"(?<!\d)(?:\d[\s-]?){10,18}\d?(?!\d)")
FALLBACK_PERSON_RE = re.compile(
    r"\b(?:[A-Z][a-z]{1,30})(?:\s+(?:[A-Z][a-z]{1,30})){1,3}\b"
)
LAST_FIRST_PERSON_RE = re.compile(
    r"\b[A-Z][a-zA-Z'’-]{1,30},\s+[A-Z][a-zA-Z'’-]{1,30}(?:\s+[A-Z][a-zA-Z'’-]{1,30})?\b"
)
SINGLE_PERSON_RE = re.compile(r"\b[A-Z][a-zA-Z'’-]{2,30}\b")

DATE_LIKE_RE = re.compile(
    r"(?<!\d)(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}[/-]\d{1,2}[/-]\d{1,2})(?!\d)"
)

PERSON_STOP_PHRASES = {
    "Microsoft Teams",
    "Teams Meeting",
    "From Sent",
    "Subject Re",
    "Page Number",
    "Table Of",
}
SINGLE_PERSON_STOP_WORDS = {
    "Account",
    "Attachment",
    "Body",
    "Call",
    "Category",
    "CIN",
    "Core",
    "DOCX",
    "Date",
    "Email",
    "Footer",
    "From",
    "Header",
    "ID",
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
    "Meeting",
    "Message",
    "Microsoft",
    "Page",
    "Participant",
    "Phone",
    "Re",
    "Sent",
    "Subject",
    "Table",
    "Teams",
    "Word",
}


def normalize_candidate(text: str, detected_type: str) -> str:
    compact = re.sub(r"\s+", " ", text.strip())
    if detected_type == "person" and "," in compact:
        last, first = [part.strip() for part in compact.split(",", 1)]
        compact = f"{first} {last}"
    if detected_type in {"phone", "cin", "long_numeric_id"}:
        compact = re.sub(r"\D", "", compact)
    return f"{detected_type}:{compact.casefold()}"


def context_snippet(text: str, start: int, end: int, window: int = 70) -> str:
    left = max(0, start - window)
    right = min(len(text), end + window)
    prefix = "..." if left > 0 else ""
    suffix = "..." if right < len(text) else ""
    return prefix + text[left:start] + "[" + text[start:end] + "]" + text[end:right] + suffix


def _is_date_or_page_number(text: str, block_text: str, start: int, end: int) -> bool:
    value = text.strip()
    if DATE_LIKE_RE.fullmatch(value):
        return True
    digits = re.sub(r"\D", "", value)
    nearby = block_text[max(0, start - 15) : min(len(block_text), end + 15)].casefold()
    if len(digits) <= 4 and "page" in nearby:
        return True
    return False


def _add_occurrence(
    found: OrderedDict[str, Candidate],
    block: TextBlock,
    match: re.Match[str],
    detected_type: str,
    source: str,
    confidence: str,
) -> None:
    text = match.group(0).strip()
    if not text:
        return
    key = normalize_candidate(text, detected_type)
    occurrence_index = len(found.get(key, Candidate(key, text, detected_type, source, confidence)).occurrences) + 1
    occurrence = Occurrence(
        id=f"{key}:{block.location}:{match.start()}:{occurrence_index}",
        candidate_key=key,
        text=text,
        detected_type=detected_type,
        source=source,
        location=block.location,
        start=match.start(),
        end=match.end(),
        context=context_snippet(block.text, match.start(), match.end()),
    )
    if key not in found:
        found[key] = Candidate(key, text, detected_type, source, confidence, [])
    found[key].occurrences.append(occurrence)


def _has_capitalized_neighbor(text: str, start: int, end: int) -> bool:
    before = text[:start].rstrip()
    after = text[end:].lstrip()
    previous_token = re.search(r"([A-Z][a-zA-Z'’-]{1,30})[,]?$", before)
    next_token = re.match(r"[,]?\s*([A-Z][a-zA-Z'’-]{1,30})\b", after)
    return bool(previous_token or next_token)


def detect_regex_candidates(blocks: Iterable[TextBlock]) -> OrderedDict[str, Candidate]:
    found: OrderedDict[str, Candidate] = OrderedDict()
    block_list = list(blocks)
    for block in block_list:
        for match in EMAIL_RE.finditer(block.text):
            _add_occurrence(found, block, match, "email", "regex", "high")
        for match in PHONE_RE.finditer(block.text):
            if not _is_date_or_page_number(match.group(0), block.text, match.start(), match.end()):
                _add_occurrence(found, block, match, "phone", "regex", "medium")
        for match in CIN_RE.finditer(block.text):
            if not _is_date_or_page_number(match.group(0), block.text, match.start(), match.end()):
                _add_occurrence(found, block, match, "cin", "regex", "high")
        for match in LONG_ID_RE.finditer(block.text):
            digits = re.sub(r"\D", "", match.group(0))
            if len(digits) >= 10 and not _is_date_or_page_number(match.group(0), block.text, match.start(), match.end()):
                _add_occurrence(found, block, match, "long_numeric_id", "regex", "medium")
    return found


def detect_people(blocks: Iterable[TextBlock], use_spacy: bool = True) -> OrderedDict[str, Candidate]:
    found: OrderedDict[str, Candidate] = OrderedDict()
    block_list = list(blocks)
    nlp = None
    if use_spacy:
        try:
            import spacy

            try:
                nlp = spacy.load("en_core_web_sm")
            except OSError:
                nlp = spacy.blank("en")
        except Exception:
            nlp = None

    for block in block_list:
        if nlp is not None and "ner" in nlp.pipe_names:
            doc = nlp(block.text)
            for entity in doc.ents:
                if entity.label_ == "PERSON" and len(entity.text.strip()) > 2:
                    fake_match = re.match(re.escape(entity.text), block.text[entity.start_char : entity.end_char])
                    if fake_match:
                        class _Match:
                            def group(self, _: int = 0) -> str:
                                return entity.text

                            def start(self) -> int:
                                return entity.start_char

                            def end(self) -> int:
                                return entity.end_char

                        _add_occurrence(found, block, _Match(), "person", "spaCy", "medium")
            continue

        for pattern in (LAST_FIRST_PERSON_RE, FALLBACK_PERSON_RE):
            for match in pattern.finditer(block.text):
                value = match.group(0)
                if value in PERSON_STOP_PHRASES:
                    continue
                if EMAIL_RE.search(value):
                    continue
                _add_occurrence(found, block, match, "person", "fallback-name-regex", "low")

    single_name_occurrences: list[tuple[TextBlock, re.Match[str]]] = []
    single_name_counts: dict[str, int] = {}
    for block in block_list:
        for match in SINGLE_PERSON_RE.finditer(block.text):
            value = match.group(0)
            if value in SINGLE_PERSON_STOP_WORDS:
                continue
            if _has_capitalized_neighbor(block.text, match.start(), match.end()):
                continue
            key = normalize_candidate(value, "person")
            single_name_counts[key] = single_name_counts.get(key, 0) + 1
            single_name_occurrences.append((block, match))

    for block, match in single_name_occurrences:
        if single_name_counts[normalize_candidate(match.group(0), "person")] >= 2:
            _add_occurrence(found, block, match, "person", "fallback-single-name-regex", "low")
    return found


def detect_all_candidates(blocks: Iterable[TextBlock], use_spacy: bool = True) -> List[Candidate]:
    block_list = list(blocks)
    merged = detect_regex_candidates(block_list)
    for key, candidate in detect_people(block_list, use_spacy=use_spacy).items():
        if key not in merged:
            merged[key] = candidate
        else:
            merged[key].occurrences.extend(candidate.occurrences)
    return list(merged.values())
