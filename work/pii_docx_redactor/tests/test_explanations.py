from __future__ import annotations

from redactor.explanations import explain_candidate
from redactor.models import Candidate, Occurrence


def make_candidate(
    *,
    text: str = "Yamada, Tamara",
    score: int = 99,
    evidence: list[dict[str, object]] | None = None,
) -> Candidate:
    candidate = Candidate(
        key=f"person:{text.lower()}",
        text=text,
        detected_type="person",
        source="fallback-name-regex",
        confidence="high",
        occurrences=[
            Occurrence(
                id="occ-1",
                candidate_key=f"person:{text.lower()}",
                text=text,
                detected_type="person",
                source="fallback-name-regex",
                location="body paragraph 1",
                start=0,
                end=len(text),
                context=f"Dr. {text} sent the message.",
            )
        ],
    )
    candidate.candidate_score = score
    candidate.quality_status = "To Review"
    candidate.quality_explanation = "Raw scoring text"
    candidate.quality_filter_rules = ["surname_given_structure", "nearby_title"]
    candidate.quality_evidence_breakdown = evidence or [
        {"rule": "surname_given_structure", "label": "Surname Given Structure", "weight": 50},
        {"rule": "nearby_title", "label": "Nearby Title", "weight": 40},
        {"rule": "frequency_saturated", "label": "Frequency Saturated", "weight": 14},
    ]
    return candidate


def test_standard_explanation_is_concise_and_hides_rule_details():
    payload = explain_candidate(make_candidate())

    summary = payload["standard"]["summary"]
    assert summary.startswith("We believe this is a person's name because")
    assert "surname-first name pattern" in summary
    assert "title or honorific" in summary
    assert "surname_given_structure" not in summary
    assert "+50" not in summary


def test_expert_view_retains_rule_ids_and_weights():
    payload = explain_candidate(make_candidate(), disposition="Keep")

    assert payload["expert"]["current_disposition"] == "Keep"
    assert payload["expert"]["positive_evidence"][0]["id"] == "surname_given_structure"
    assert payload["expert"]["positive_evidence"][0]["weight"] == 50
    assert payload["expert"]["raw_scoring_explanation"] == "Raw scoring text"
    assert payload["audit"]["positive_evidence"] == [
        "Strong surname, given-name structure",
        "Nearby honorific or title",
        "Frequency saturation",
    ]


def test_negative_evidence_qualifies_standard_explanation():
    candidate = make_candidate(
        score=60,
        evidence=[
            {"rule": "known_first_name", "label": "Known First Name", "weight": 28},
            {"rule": "common_english_word", "label": "Common English Word", "weight": -35},
            {"rule": "single_occurrence", "label": "Single Occurrence", "weight": -6},
        ],
    )

    summary = explain_candidate(candidate)["standard"]["summary"]
    assert summary.startswith("This may be a person's name because")
    assert "but" in summary
    assert "common English word" in summary
    assert "appears only once" in summary


def test_low_likelihood_wording_and_unknown_evidence_fallback_are_deterministic():
    candidate = make_candidate(
        text="Like",
        score=25,
        evidence=[{"rule": "new_future_signal", "weight": 0}],
    )

    payload = explain_candidate(candidate)
    assert payload["standard"]["summary"].startswith("This is unlikely to be a person's name")
    assert "new future signal evidence" in payload["standard"]["summary"]
    assert payload["expert"]["neutral_evidence"][0]["expert"] == "New Future Signal"
