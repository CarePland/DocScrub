from __future__ import annotations

import csv
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable

from .models import Candidate, CandidateDecision


CSV_COLUMNS = [
    "original_candidate",
    "replacement",
    "type",
    "source_detector",
    "decision",
    "occurrence_count",
    "document_location",
    "context",
    "timestamp",
    "input_file_sha256",
]


def write_audit_csv(
    path: Path,
    candidates: Iterable[Candidate],
    decisions: Dict[str, CandidateDecision],
    input_sha256: str,
) -> None:
    timestamp = datetime.now(timezone.utc).isoformat()
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=CSV_COLUMNS)
        writer.writeheader()
        for candidate in candidates:
            decision = decisions.get(candidate.key)
            if not decision:
                continue
            for occurrence in candidate.occurrences:
                occurrence_decision = decision.occurrence_decisions.get(occurrence.id)
                label = decision.decision.value
                if occurrence_decision:
                    label = f"{label}: {occurrence_decision.value}"
                writer.writerow(
                    {
                        "original_candidate": candidate.text,
                        "replacement": decision.replacement or "",
                        "type": candidate.detected_type,
                        "source_detector": candidate.source,
                        "decision": label,
                        "occurrence_count": candidate.count,
                        "document_location": occurrence.location,
                        "context": occurrence.context,
                        "timestamp": timestamp,
                        "input_file_sha256": input_sha256,
                    }
                )

