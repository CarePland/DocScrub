from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, List, Optional


class Decision(str, Enum):
    UNDECIDED = "Undecided (Keep)"
    NOT_SENSITIVE = "Not Sensitive Data"
    KEEP = "Keep everywhere"
    RENAME = "Rename everywhere"
    REDACT = "Redact everywhere"
    REVIEW = "Review Individually"


class OccurrenceDecision(str, Enum):
    UNDECIDED = "Undecided"
    KEEP = "Keep"
    REDACT = "Redact"


@dataclass
class Occurrence:
    id: str
    candidate_key: str
    text: str
    detected_type: str
    source: str
    location: str
    start: int
    end: int
    context: str


@dataclass
class Candidate:
    key: str
    text: str
    detected_type: str
    source: str
    confidence: str
    occurrences: List[Occurrence] = field(default_factory=list)
    quality: str = "Possible"
    quality_reasons: List[str] = field(default_factory=list)
    quality_explanation: str = ""
    suggested_type: Optional[str] = None
    quality_status: str = "To Review"
    candidate_score: int = 50
    quality_evidence_breakdown: List[Dict[str, int | str]] = field(default_factory=list)
    quality_positive_reasons: List[str] = field(default_factory=list)
    quality_filter_rules: List[str] = field(default_factory=list)

    @property
    def count(self) -> int:
        return len(self.occurrences)

    @property
    def contexts(self) -> List[str]:
        seen = []
        for occurrence in self.occurrences:
            if occurrence.context not in seen:
                seen.append(occurrence.context)
            if len(seen) >= 5:
                break
        return seen


@dataclass
class CandidateDecision:
    candidate_key: str
    decision: Decision = Decision.UNDECIDED
    replacement: Optional[str] = None
    occurrence_decisions: Dict[str, OccurrenceDecision] = field(default_factory=dict)
    canonical_group_id: Optional[str] = None
    covered_occurrence_ids: List[str] = field(default_factory=list)
    uncovered_occurrence_count: int = 0
    review_stage: Optional[str] = "item_check"
    review_status: Optional[str] = "unresolved"
    reviewer_decision: Optional[str] = None
    decision_timestamp: Optional[str] = None
    inherited_decision_source: Optional[str] = None
