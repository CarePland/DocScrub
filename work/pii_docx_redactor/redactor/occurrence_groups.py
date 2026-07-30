from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

from .models import Occurrence


OccurrenceGroupKind = Literal[
    "standalone",
    "contextual",
    "quoted",
    "header",
    "footer",
    "table",
    "ocr",
    "other",
]

GROUP_ORDER: tuple[OccurrenceGroupKind, ...] = (
    "standalone",
    "contextual",
)

GROUP_LABELS: dict[OccurrenceGroupKind, str] = {
    "standalone": "Standalone occurrences",
    "contextual": "Occurrences in message text",
    "quoted": "Quoted occurrences",
    "header": "Header occurrences",
    "footer": "Footer occurrences",
    "table": "Table occurrences",
    "ocr": "OCR occurrences",
    "other": "Other occurrences",
}

SUBSTANTIVE_RE = re.compile(r"[A-Za-z0-9]")
BRACKETED_RE = re.compile(r"\[[^\]]+\]")
ARTIFACT_TOKEN_RE = re.compile(
    r"^(?:l|r|lr|br|cr|lf|nbsp|\\n|\\r|\\t|[\W_]+)$",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class OccurrenceGroup:
    id: str
    kind: OccurrenceGroupKind
    label: str
    occurrence_count: int
    occurrences: list[Occurrence]


def _normalize_text(value: str) -> str:
    value = value.replace("...", " ")
    value = value.replace("\u00a0", " ")
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def _strip_match_from_context(occurrence: Occurrence) -> str:
    context = _normalize_text(occurrence.context or "")
    text = _normalize_text(occurrence.text or "")
    without_bracketed = BRACKETED_RE.sub(" ", context, count=1)
    if without_bracketed != context:
        return _normalize_text(without_bracketed)
    if text:
        return _normalize_text(re.sub(re.escape(text), " ", context, count=1, flags=re.IGNORECASE))
    return context


def _has_substantive_surrounding_text(remaining_context: str) -> bool:
    tokens = [token for token in re.split(r"\s+", remaining_context.strip()) if token]
    substantive_tokens = [
        token
        for token in tokens
        if SUBSTANTIVE_RE.search(token) and not ARTIFACT_TOKEN_RE.match(token.strip(".,;:()[]{}<>"))
    ]
    return bool(substantive_tokens)


def occurrence_group_kind(occurrence: Occurrence) -> OccurrenceGroupKind:
    remaining_context = _strip_match_from_context(occurrence)
    if _has_substantive_surrounding_text(remaining_context):
        return "contextual"
    return "standalone"


def group_occurrences(occurrences: list[Occurrence]) -> list[OccurrenceGroup]:
    buckets: dict[OccurrenceGroupKind, list[Occurrence]] = {kind: [] for kind in GROUP_ORDER}
    for occurrence in occurrences:
        buckets.setdefault(occurrence_group_kind(occurrence), []).append(occurrence)
    return [
        OccurrenceGroup(
            id=f"occurrence-group-{kind}",
            kind=kind,
            label=GROUP_LABELS[kind],
            occurrence_count=len(bucket_occurrences),
            occurrences=bucket_occurrences,
        )
        for kind in GROUP_ORDER
        if (bucket_occurrences := buckets.get(kind, []))
    ]


def occurrence_group_to_json(group: OccurrenceGroup) -> dict[str, object]:
    return {
        "id": group.id,
        "kind": group.kind,
        "label": group.label,
        "occurrence_count": group.occurrence_count,
        "occurrences": [
            {
                "id": occurrence.id,
                "location": occurrence.location,
                "context": occurrence.context,
            }
            for occurrence in group.occurrences
        ],
    }
