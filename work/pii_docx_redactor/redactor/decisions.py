from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, Iterable

from .models import Candidate, CandidateDecision, Decision, OccurrenceDecision


def default_replacement(candidate: Candidate, person_index: int | None = None) -> str:
    if candidate.detected_type == "person":
        index = person_index if person_index is not None else 1
        return f"[PERSON {index:03d}]"
    labels = {
        "email": "[REDACTED EMAIL]",
        "phone": "[REDACTED PHONE]",
        "cin": "[REDACTED ID]",
        "long_numeric_id": "[REDACTED ID]",
    }
    return labels.get(candidate.detected_type, "[REDACTED]")


def build_default_decisions(candidates: Iterable[Candidate]) -> Dict[str, CandidateDecision]:
    decisions: Dict[str, CandidateDecision] = {}
    person_index = 1
    for candidate in candidates:
        if candidate.detected_type == "person":
            replacement = default_replacement(candidate, person_index)
            person_index += 1
        else:
            replacement = default_replacement(candidate)
        decisions[candidate.key] = CandidateDecision(candidate.key, Decision.UNDECIDED, replacement, {})
    return decisions


def decisions_to_json(decisions: Dict[str, CandidateDecision]) -> dict:
    return {
        key: {
            "decision": value.decision.value,
            "replacement": value.replacement,
            "occurrence_decisions": {k: v.value for k, v in value.occurrence_decisions.items()},
            "canonical_group_id": value.canonical_group_id,
            "covered_occurrence_ids": value.covered_occurrence_ids,
            "uncovered_occurrence_count": value.uncovered_occurrence_count,
            "review_stage": value.review_stage,
            "review_status": value.review_status,
            "reviewer_decision": value.reviewer_decision,
            "decision_timestamp": value.decision_timestamp,
            "inherited_decision_source": value.inherited_decision_source,
        }
        for key, value in decisions.items()
    }


def decisions_from_json(data: dict) -> Dict[str, CandidateDecision]:
    result: Dict[str, CandidateDecision] = {}
    for key, value in data.items():
        raw_decision = value.get("decision", Decision.UNDECIDED.value)
        if raw_decision == "Undecided":
            raw_decision = Decision.UNDECIDED.value
        if raw_decision == "Not PII":
            raw_decision = Decision.NOT_SENSITIVE.value
        if raw_decision == "Review each occurrence":
            raw_decision = Decision.REVIEW.value
        result[key] = CandidateDecision(
            candidate_key=key,
            decision=Decision(raw_decision),
            replacement=value.get("replacement"),
            occurrence_decisions={
                occurrence_id: OccurrenceDecision(decision)
                for occurrence_id, decision in value.get("occurrence_decisions", {}).items()
            },
            canonical_group_id=value.get("canonical_group_id"),
            covered_occurrence_ids=list(value.get("covered_occurrence_ids", [])),
            uncovered_occurrence_count=int(value.get("uncovered_occurrence_count", 0)),
            review_stage=value.get("review_stage"),
            review_status=value.get("review_status"),
            reviewer_decision=value.get("reviewer_decision"),
            decision_timestamp=value.get("decision_timestamp"),
            inherited_decision_source=value.get("inherited_decision_source"),
        )
    return result


def save_decisions(path: Path, decisions: Dict[str, CandidateDecision]) -> None:
    path.write_text(json.dumps(decisions_to_json(decisions), indent=2), encoding="utf-8")


def load_decisions(path: Path) -> Dict[str, CandidateDecision]:
    return decisions_from_json(json.loads(path.read_text(encoding="utf-8")))
