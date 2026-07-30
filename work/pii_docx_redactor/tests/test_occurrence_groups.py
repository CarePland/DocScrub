from __future__ import annotations

from redactor.models import Occurrence
from redactor.occurrence_groups import group_occurrences, occurrence_group_kind, occurrence_group_to_json


def occurrence(index: int, paragraph: int, context: str | None = None) -> Occurrence:
    text = "Yamada, Tamara"
    return Occurrence(
        id=f"occ-{index}",
        candidate_key="person:yamada tamara",
        text=text,
        detected_type="person",
        source="test",
        location=f"body paragraph {paragraph}",
        start=0,
        end=len(text),
        context=context or f"[{text}]",
    )


def test_occurrences_are_classified_by_structure_not_paragraph_proximity():
    groups = group_occurrences(
        [
            occurrence(1, 56, "Can someone let me know by [Yamada, Tamara]"),
            occurrence(2, 57, "[Yamada, Tamara]"),
            occurrence(3, 66, "Thank you by [Yamada, Tamara]"),
            occurrence(4, 67, "[Yamada, Tamara]"),
            occurrence(5, 98, "[Yamada, Tamara] L"),
        ]
    )

    assert [(group.kind, group.occurrence_count) for group in groups] == [
        ("standalone", 3),
        ("contextual", 2),
    ]
    assert [group.label for group in groups] == [
        "Standalone occurrences",
        "Occurrences in message text",
    ]


def test_standalone_allows_punctuation_and_short_export_artifacts():
    for context in [
        "[Yamada, Tamara]",
        "([Yamada, Tamara])",
        "[Yamada, Tamara] L",
        " ... [Yamada, Tamara] ... ",
    ]:
        assert occurrence_group_kind(occurrence(1, 1, context)) == "standalone"


def test_contextual_requires_substantive_surrounding_text():
    for context in [
        "Thank you by [Yamada, Tamara]",
        "Morning! Andrew, are the PERC warnings done by [Yamada, Tamara]",
        "Preview Day will be April 18 by [Yamada, Tamara]",
    ]:
        assert occurrence_group_kind(occurrence(1, 1, context)) == "contextual"


def test_grouping_never_removes_raw_occurrences():
    occurrences = [
        occurrence(1, 1, "[Yamada, Tamara]"),
        occurrence(2, 2, "Message by [Yamada, Tamara]"),
        occurrence(3, 30, "[Yamada, Tamara] L"),
    ]
    groups = group_occurrences(occurrences)
    serialized = [occurrence_group_to_json(group) for group in groups]

    grouped_ids = [
        item["id"]
        for group in serialized
        for item in group["occurrences"]
    ]
    assert grouped_ids == ["occ-1", "occ-3", "occ-2"]
