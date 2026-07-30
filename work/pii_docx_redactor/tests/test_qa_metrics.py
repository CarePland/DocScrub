from redactor.models import Candidate, CandidateDecision, Decision
from redactor.qa_metrics import build_qa_metrics, confidence_bucket


def candidate(key, confidence, source="regex"):
    return Candidate(
        key=key,
        text=key,
        detected_type="person",
        source=source,
        confidence=confidence,
        occurrences=[],
    )


def test_confidence_bucket_defaults_unknown_to_low():
    assert confidence_bucket("high") == "high"
    assert confidence_bucket("MEDIUM") == "medium"
    assert confidence_bucket("surprising") == "low"


def test_qa_metrics_capture_counts_timing_and_detector_attribution():
    candidates = [
        candidate("a", "high", "regex"),
        candidate("b", "medium", "fallback-name-regex"),
        candidate("c", "low", "fallback-single-name-regex"),
    ]
    decisions = {
        "a": CandidateDecision("a", Decision.REDACT, "[PERSON 001]"),
        "b": CandidateDecision("b", Decision.KEEP, None),
        "c": CandidateDecision("c", Decision.NOT_SENSITIVE, None),
    }
    metrics = build_qa_metrics(
        candidates=candidates,
        decisions=decisions,
        input_sha256="abc",
        filename="sample.docx",
        review_started_at="2026-07-25T00:00:00+00:00",
        review_finished_at="2026-07-25T00:03:00+00:00",
    )

    assert metrics["total_candidates"] == 3
    assert metrics["confidence_counts"] == {"high": 1, "medium": 1, "low": 1}
    assert metrics["decision_counts"]["redacted"] == 1
    assert metrics["decision_counts"]["kept"] == 1
    assert metrics["decision_counts"]["wrong_match"] == 1
    assert metrics["decisions_per_minute"] == 1.0
    assert metrics["detector_counts"]["fallback-name-regex"]["medium"] == 1
    assert metrics["candidate_records"][0]["source_detector"] == "regex"
