from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable

from .models import Candidate, CandidateDecision, Decision


CONFIDENCE_BUCKETS = ("high", "medium", "low")


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def confidence_bucket(value: str | None) -> str:
    normalized = (value or "").strip().lower()
    if normalized in CONFIDENCE_BUCKETS:
        return normalized
    return "low"


def parse_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def build_qa_metrics(
    *,
    candidates: Iterable[Candidate],
    decisions: Dict[str, CandidateDecision],
    input_sha256: str | None,
    filename: str | None,
    review_started_at: str | None,
    review_finished_at: str | None,
) -> dict:
    candidate_list = list(candidates)
    total = len(candidate_list)
    confidence_counts = {bucket: 0 for bucket in CONFIDENCE_BUCKETS}
    detector_counts: dict[str, dict[str, int]] = {}
    decision_counts = {
        "redacted": 0,
        "renamed": 0,
        "kept": 0,
        "wrong_match": 0,
        "review": 0,
        "undecided": 0,
    }
    candidate_records = []

    for candidate in candidate_list:
        bucket = confidence_bucket(candidate.confidence)
        confidence_counts[bucket] += 1
        detector = candidate.source or "unknown"
        detector_counts.setdefault(detector, {bucket: 0 for bucket in CONFIDENCE_BUCKETS})
        detector_counts[detector][bucket] += 1

        decision = decisions.get(candidate.key)
        if not decision or decision.decision == Decision.UNDECIDED:
            decision_counts["undecided"] += 1
        elif decision.decision == Decision.REDACT:
            decision_counts["redacted"] += 1
        elif decision.decision == Decision.RENAME:
            decision_counts["renamed"] += 1
        elif decision.decision == Decision.KEEP:
            decision_counts["kept"] += 1
        elif decision.decision == Decision.NOT_SENSITIVE:
            decision_counts["wrong_match"] += 1
        elif decision.decision == Decision.REVIEW:
            decision_counts["review"] += 1
        candidate_records.append(
            {
                "candidate_key": candidate.key,
                "candidate_text": candidate.text,
                "type": candidate.detected_type,
                "source_detector": detector,
                "confidence": bucket,
                "occurrence_count": candidate.count,
                "decision": decision.decision.value if decision else Decision.UNDECIDED.value,
                "replacement": decision.replacement if decision else None,
            }
        )

    start = parse_timestamp(review_started_at)
    finish = parse_timestamp(review_finished_at)
    elapsed_seconds = (finish - start).total_seconds() if start and finish else None
    completed_decisions = total - decision_counts["undecided"]
    elapsed_minutes = elapsed_seconds / 60 if elapsed_seconds and elapsed_seconds > 0 else None

    def pct(count: int) -> float:
        return round((count / total) * 100, 2) if total else 0.0

    return {
        "filename": filename,
        "input_file_sha256": input_sha256,
        "review_started_at": review_started_at,
        "review_finished_at": review_finished_at,
        "elapsed_review_seconds": elapsed_seconds,
        "decisions_per_minute": round(completed_decisions / elapsed_minutes, 2)
        if elapsed_minutes
        else None,
        "total_candidates": total,
        "confidence_counts": confidence_counts,
        "detector_counts": detector_counts,
        "candidate_records": candidate_records,
        "decision_counts": decision_counts,
        "percent_wrong_match": pct(decision_counts["wrong_match"]),
        "percent_redacted": pct(decision_counts["redacted"]),
        "percent_renamed": pct(decision_counts["renamed"]),
        "percent_kept": pct(decision_counts["kept"]),
    }


def write_qa_metrics(path: Path, metrics: dict) -> None:
    path.write_text(json.dumps(metrics, indent=2), encoding="utf-8")
