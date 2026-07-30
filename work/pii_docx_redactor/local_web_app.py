from __future__ import annotations

import json
import mimetypes
import os
import threading
import webbrowser
from collections import Counter
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

from redactor.audit import write_audit_csv
from redactor.candidate_quality import apply_candidate_quality, candidate_quality_metrics, is_filtered_candidate
from redactor.decisions import build_default_decisions, decisions_from_json, decisions_to_json
from redactor.detectors import detect_all_candidates
from redactor.docx_reader import extract_docx_metadata, iter_docx_text_blocks, load_docx, sha256_file
from redactor.docx_writer import rescan_for_originals, write_redacted_docx
from redactor.entity_resolution import AmbiguousEntityMatch, EntityGroup, build_ambiguous_matches, build_entity_groups, calculate_entity_confidence
from redactor.explanations import explain_candidate
from redactor.models import Candidate, CandidateDecision, Decision
from redactor.occurrence_groups import group_occurrences, occurrence_group_to_json
from redactor.qa_metrics import build_qa_metrics, confidence_bucket, utc_now_iso, write_qa_metrics
from redactor.replacement_rules import (
    AUTO,
    MANUAL,
    ReplacementRuleEngine,
    initial_rules,
    normalize_rules,
    normalize_type,
    preview_for_rule,
)


APP_BUILD = "web build 2026.07.26.93"
RESTART_EXIT_CODE = 75
STATE_DIR = Path(".local_web_state")
UPLOAD_PATH = STATE_DIR / "upload.docx"
STATE_PATH = STATE_DIR / "review_state.json"
OUTPUT_DIR = STATE_DIR / "outputs"
ASSET_DIR = Path("assets")
SYSTEM_DOWNLOADS_DIR = Path.home() / "Downloads"

ACTION_TO_DECISION = {
    "Keep": Decision.KEEP,
    "Rename": Decision.RENAME,
    "Redact": Decision.REDACT,
    "Ignore": Decision.NOT_SENSITIVE,
    # Legacy aliases accepted for saved sessions and older fallback paths.
    "Wrong Match": Decision.NOT_SENSITIVE,
    "Review": Decision.REVIEW,
}
DECISION_TO_ACTION = {
    Decision.KEEP: "Keep",
    Decision.RENAME: "Rename",
    Decision.REDACT: "Redact",
    Decision.REVIEW: "Ignore",
    Decision.NOT_SENSITIVE: "Ignore",
    Decision.UNDECIDED: "Undecided",
}

state: dict[str, Any] = {
    "filename": None,
    "file_hash": None,
    "candidates": [],
    "decisions": {},
    "metadata": {},
    "outputs": {},
    "default_replacements": {},
    "rename_replacements": {},
    "replacement_rules": initial_rules(),
    "replacement_assignments": {},
    "replacement_sources": {},
    "entity_group_exclusions": {},
    "entity_group_reviews": [],
    "entity_resolution_done_keys": [],
    "resolved_candidate_keys": [],
    "ambiguous_review_keys": [],
    "quality_restored_keys": [],
    "review_started_at": None,
    "review_finished_at": None,
}

QUALITY_RULE_LABELS = {
    "all_common_dictionary_words": "All common dictionary words",
    "address_suffix": "Address suffix",
    "administrative_phrase": "Administrative phrase",
    "abbreviation": "Abbreviation",
    "ambiguous_lexical_token": "Ambiguous lexical token",
    "calendar_abbreviation": "Calendar abbreviation",
    "calendar_term": "Calendar term",
    "common_abbreviation": "Common abbreviation",
    "common_english_word": "Common English word",
    "common_verb": "Common verb",
    "contraction": "Contraction",
    "department_organization": "Department / organization",
    "document_structure_term": "Document structure term",
    "expanded_common_language_token": "Expanded common language token",
    "greeting_or_courtesy": "Greeting or courtesy",
    "honorific_title": "Honorific / title",
    "interjection_casual": "Interjection / casual expression",
    "implausible_capitalization": "Implausible capitalization",
    "institution_acronym": "Institution acronym",
    "institution_term": "Institution term",
    "known_first_name": "Known first name",
    "known_surname": "Known surname",
    "legal_administrative_term": "Legal / administrative term",
    "likely_acronym": "Likely acronym",
    "ocr_artifact": "OCR artifact",
    "organization_suffix": "Organization suffix",
    "professional_credential": "Professional credential",
    "product_system_name": "Product / system name",
    "pronoun_or_determiner": "Pronoun or determiner",
    "season_or_academic_term": "Season or academic term",
    "sentence_fragment": "Sentence fragment",
    "sentence_fragment_word": "Sentence fragment word",
    "too_short_single_token": "Too-short single token",
    "unknown_capitalized_token": "Unknown capitalized token",
    "unknown_lowercase_token": "Unknown lowercase token",
    "unknown_token": "Unknown token",
}

QUALITY_PRIMARY_PRIORITY = {
    "pronoun_or_determiner": 10,
    "greeting_or_courtesy": 20,
    "common_verb": 30,
    "calendar_term": 40,
    "season_or_academic_term": 50,
    "administrative_phrase": 60,
    "institution_term": 70,
    "department_organization": 80,
    "institution_acronym": 90,
    "product_system_name": 100,
    "common_english_word": 110,
    "ocr_artifact": 120,
    "sentence_fragment": 130,
    "all_common_dictionary_words": 140,
    "implausible_capitalization": 150,
    "abbreviation": 160,
    "too_short_single_token": 170,
}


def ensure_dirs() -> None:
    STATE_DIR.mkdir(exist_ok=True)
    OUTPUT_DIR.mkdir(exist_ok=True)


def output_dir() -> Path:
    if SYSTEM_DOWNLOADS_DIR.exists() and SYSTEM_DOWNLOADS_DIR.is_dir():
        return SYSTEM_DOWNLOADS_DIR
    ensure_dirs()
    return OUTPUT_DIR


def candidate_to_json(candidate: Candidate, decision: CandidateDecision) -> dict[str, Any]:
    default_replacement = state.get("default_replacements", {}).get(
        candidate.key, decision.replacement or ""
    )
    rename_replacement = state.get("rename_replacements", {}).get(
        candidate.key, decision.replacement or default_replacement
    )
    if decision.decision == Decision.RENAME:
        replacement = rename_replacement
    elif decision.decision in {Decision.REDACT, Decision.REVIEW}:
        replacement = default_replacement
    else:
        replacement = ""
    current_disposition = decision.reviewer_decision or DECISION_TO_ACTION[decision.decision]
    covered_ids = covered_occurrence_ids(candidate)
    if has_partial_group_resolution(candidate):
        visible_occurrences = [
            occurrence for occurrence in candidate.occurrences
            if occurrence.id not in covered_ids
        ]
    else:
        visible_occurrences = list(candidate.occurrences)
    contexts = []
    for occurrence in visible_occurrences:
        if occurrence.context not in contexts:
            contexts.append(occurrence.context)
        if len(contexts) >= 5:
            break
    return {
        "key": candidate.key,
        "text": candidate.text,
        "type": candidate.detected_type,
        "source": candidate.source,
        "confidence": candidate.confidence,
        "count": len(visible_occurrences),
        "total_count": candidate.count,
        "covered_occurrence_count": len(covered_ids),
        "uncovered_occurrence_count": len(visible_occurrences),
        "partial_group_resolution": has_partial_group_resolution(candidate),
        "canonical_group_id": decision.canonical_group_id,
        "review_stage": decision.review_stage,
        "review_status": decision.review_status,
        "reviewer_decision": decision.reviewer_decision,
        "decision_timestamp": decision.decision_timestamp,
        "inherited_decision_source": decision.inherited_decision_source,
        "contexts": contexts,
        "occurrences": [
            {"id": occurrence.id, "location": occurrence.location, "context": occurrence.context}
            for occurrence in visible_occurrences
        ],
        "occurrence_groups": [
            occurrence_group_to_json(group)
            for group in group_occurrences(visible_occurrences)
        ],
        "locations": sorted({occurrence.location for occurrence in visible_occurrences})[:5],
        "decision": DECISION_TO_ACTION[decision.decision],
        "replacement": replacement,
        "default_replacement": default_replacement,
        "rename_replacement": rename_replacement,
        "replacement_source": state.get("replacement_sources", {}).get(candidate.key, AUTO),
        "quality": candidate.quality,
        "quality_reasons": candidate.quality_reasons,
        "quality_explanation": candidate.quality_explanation,
        "suggested_type": candidate.suggested_type,
        "quality_status": candidate.quality_status,
        "candidate_score": candidate.candidate_score,
        "likelihood": candidate.candidate_score,
        "quality_evidence_breakdown": candidate.quality_evidence_breakdown,
        "quality_positive_reasons": candidate.quality_positive_reasons,
        "quality_filter_rules": candidate.quality_filter_rules,
        "explanation": explain_candidate(candidate, current_disposition),
    }


def save_state() -> None:
    ensure_dirs()
    STATE_PATH.write_text(
        json.dumps(
            {
                "filename": state["filename"],
                "file_hash": state["file_hash"],
                "decisions": decisions_to_json(state["decisions"]),
                "rename_replacements": state.get("rename_replacements", {}),
                "replacement_rules": state.get("replacement_rules", {}),
                "replacement_assignments": state.get("replacement_assignments", {}),
                "replacement_sources": state.get("replacement_sources", {}),
                "entity_group_exclusions": state.get("entity_group_exclusions", {}),
                "entity_group_reviews": state.get("entity_group_reviews", []),
                "entity_resolution_done_keys": state.get("entity_resolution_done_keys", []),
                "resolved_candidate_keys": state.get("resolved_candidate_keys", []),
                "ambiguous_review_keys": state.get("ambiguous_review_keys", []),
                "review_started_at": state.get("review_started_at"),
                "review_finished_at": state.get("review_finished_at"),
                "type_overrides": {
                    candidate.key: candidate.detected_type for candidate in state["candidates"]
                },
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def load_saved_state() -> dict[str, Any] | None:
    if not UPLOAD_PATH.exists() or not STATE_PATH.exists():
        return None
    data = json.loads(STATE_PATH.read_text(encoding="utf-8"))
    return data


def apply_saved_state(candidates: list[Candidate], saved: dict[str, Any]) -> dict[str, CandidateDecision]:
    decisions = build_default_decisions(candidates)
    decisions.update(decisions_from_json(saved.get("decisions", {})))
    for candidate in candidates:
        override = saved.get("type_overrides", {}).get(candidate.key)
        if override:
            candidate.detected_type = override
            for occurrence in candidate.occurrences:
                occurrence.detected_type = override
    return decisions


def default_replacements_for(candidates: list[Candidate]) -> dict[str, str]:
    engine = ReplacementRuleEngine(
        state.get("replacement_rules") or initial_rules(candidates),
        state.get("replacement_assignments") or {},
    )
    replacements = {candidate.key: engine.replacement_for(candidate) for candidate in candidates}
    state["replacement_assignments"] = engine.assignments
    return replacements


def replacement_sources_for(
    decisions: dict[str, CandidateDecision], saved: dict[str, Any] | None = None
) -> dict[str, str]:
    saved_sources = dict((saved or {}).get("replacement_sources", {}))
    for key, decision in decisions.items():
        saved_sources.setdefault(key, MANUAL if decision.decision == Decision.RENAME else AUTO)
    return saved_sources


def set_auto_replacement(candidate: Candidate, decision: CandidateDecision) -> None:
    engine = ReplacementRuleEngine(state.get("replacement_rules"), state.get("replacement_assignments"))
    replacement = engine.replacement_for(candidate)
    state["replacement_assignments"] = engine.assignments
    state.setdefault("default_replacements", {})[candidate.key] = replacement
    state.setdefault("replacement_sources", {})[candidate.key] = AUTO
    decision.replacement = replacement


def candidate_by_key(key: str) -> Candidate | None:
    return next((candidate for candidate in state["candidates"] if candidate.key == key), None)


def candidate_occurrence_ids(candidate: Candidate) -> list[str]:
    return [occurrence.id for occurrence in candidate.occurrences]


def covered_occurrence_ids(candidate: Candidate) -> set[str]:
    decision = state.get("decisions", {}).get(candidate.key)
    if not decision:
        return set()
    valid_ids = set(candidate_occurrence_ids(candidate))
    return {occurrence_id for occurrence_id in decision.covered_occurrence_ids if occurrence_id in valid_ids}


def uncovered_occurrence_count(candidate: Candidate) -> int:
    return max(candidate.count - len(covered_occurrence_ids(candidate)), 0)


def is_resolved_in_earlier_review(candidate: Candidate) -> bool:
    decision = state.get("decisions", {}).get(candidate.key)
    if not decision:
        return False
    return (
        decision.review_stage == "group_check"
        and decision.review_status == "resolved"
        and uncovered_occurrence_count(candidate) == 0
    )


def candidate_quality_status_key(candidate: Candidate) -> str:
    decision = state.get("decisions", {}).get(candidate.key)
    if decision and decision.review_status == "resolved":
        return "resolved"
    if candidate.quality_status == "Resolved":
        return "resolved"
    if candidate.quality_status == "Unlikely" or candidate.quality == "Unlikely":
        return "unlikely"
    return "to_review"


def has_partial_group_resolution(candidate: Candidate) -> bool:
    decision = state.get("decisions", {}).get(candidate.key)
    return bool(
        decision
        and decision.review_stage == "group_check"
        and decision.review_status == "partial"
        and covered_occurrence_ids(candidate)
        and uncovered_occurrence_count(candidate) > 0
    )


def candidate_quality_review_candidates() -> list[Candidate]:
    return [
        candidate for candidate in state["candidates"]
        if not is_resolved_in_earlier_review(candidate)
    ]


def mark_candidate_lifecycle(
    key: str,
    *,
    canonical_group_id: str,
    review_stage: str,
    review_status: str,
    reviewer_decision: str,
    inherited_decision_source: str,
    covered_occurrence_ids_value: list[str] | None = None,
    timestamp: str | None = None,
) -> None:
    candidate = candidate_by_key(key)
    decision = state["decisions"].get(key)
    if not candidate or not decision:
        return
    covered_ids = covered_occurrence_ids_value if covered_occurrence_ids_value is not None else candidate_occurrence_ids(candidate)
    valid_ids = set(candidate_occurrence_ids(candidate))
    normalized_covered_ids = sorted({occurrence_id for occurrence_id in covered_ids if occurrence_id in valid_ids})
    decision.canonical_group_id = canonical_group_id
    decision.covered_occurrence_ids = normalized_covered_ids
    decision.uncovered_occurrence_count = max(len(valid_ids) - len(normalized_covered_ids), 0)
    decision.review_stage = review_stage
    decision.review_status = review_status
    decision.reviewer_decision = reviewer_decision
    decision.decision_timestamp = timestamp or utc_now_iso()
    decision.inherited_decision_source = inherited_decision_source


def group_occurrence_membership(candidate_keys: list[str]) -> dict[str, list[str]]:
    membership: dict[str, list[str]] = {}
    for key in candidate_keys:
        candidate = candidate_by_key(key)
        if candidate:
            membership[key] = candidate_occurrence_ids(candidate)
    return membership


def mark_group_candidates_resolved(
    candidate_keys: list[str],
    *,
    group_id: str,
    reviewer_decision: str,
    inherited_decision_source: str,
    timestamp: str,
) -> None:
    for key in candidate_keys:
        mark_candidate_lifecycle(
            key,
            canonical_group_id=f"entity:{group_id}",
            review_stage="group_check",
            review_status="resolved",
            reviewer_decision=reviewer_decision,
            inherited_decision_source=inherited_decision_source,
            timestamp=timestamp,
        )


def unresolved_candidates() -> list[Candidate]:
    return list(state["candidates"])


def reviewable_candidates() -> list[Candidate]:
    restored = set(state.get("quality_restored_keys", []))
    return [
        candidate for candidate in unresolved_candidates()
        if candidate.key in restored or not is_filtered_candidate(candidate)
    ]


def resolution_routes() -> tuple[list[EntityGroup], list[AmbiguousEntityMatch], list[Candidate]]:
    done_keys = set(state.get("entity_resolution_done_keys", []))
    unresolved = [
        candidate for candidate in reviewable_candidates()
        if candidate.key not in done_keys
    ]
    exclusions = {}
    forced_review = set()
    groups = build_entity_groups(unresolved, exclusions, forced_review)
    ambiguous = build_ambiguous_matches(unresolved, groups, exclusions, forced_review)
    grouped_keys = {key for group in groups for key in group.candidate_keys}
    ambiguous_keys = {match.candidate_key for match in ambiguous}
    review_candidates = [
        candidate for candidate in unresolved
        if candidate.key not in grouped_keys and candidate.key not in ambiguous_keys
    ]
    return groups, ambiguous, review_candidates


def normalize_candidate_value(text: str) -> str:
    return " ".join(text.split()).casefold()


def quality_rule_label(rule: str) -> str:
    return QUALITY_RULE_LABELS.get(rule, rule.replace("_", " ").title())


def primary_quality_rule(rules: list[str]) -> str:
    if not rules:
        return "filtered"
    return sorted(
        rules,
        key=lambda rule: (QUALITY_PRIMARY_PRIORITY.get(rule, 999), rule),
    )[0]


def candidate_quality_detail(metric: str) -> dict[str, Any]:
    if metric == "resolved_earlier":
        candidates = [
            candidate for candidate in state["candidates"]
            if is_resolved_in_earlier_review(candidate)
        ]
    elif metric in {"remaining_review", "to_review"}:
        candidates = [
            candidate for candidate in candidate_quality_review_candidates()
            if candidate.quality_status not in {"Unlikely", "Resolved"} and candidate.quality != "Unlikely"
        ]
    elif metric in {"unlikely", "filtered"}:
        candidates = [
            candidate for candidate in candidate_quality_review_candidates()
            if candidate.quality_status == "Unlikely" or candidate.quality == "Unlikely"
        ]
    else:
        candidates = [
            candidate for candidate in candidate_quality_review_candidates()
            if is_filtered_candidate(candidate)
        ]
    if metric not in {"filtered", "unlikely", "remaining_review", "to_review", "resolved_earlier"}:
        candidates = [
            candidate for candidate in candidate_quality_review_candidates()
            if metric in (candidate.quality_filter_rules or candidate.quality_reasons)
        ]
    aggregate: dict[str, dict[str, Any]] = {}
    for candidate in candidates:
        normalized = normalize_candidate_value(candidate.text)
        if not normalized:
            continue
        rules = list(dict.fromkeys(candidate.quality_filter_rules or candidate.quality_reasons))
        primary_rule = primary_quality_rule(rules)
        row = aggregate.setdefault(
            normalized,
            {
                "candidate": candidate.text,
                "occurrences": 0,
                "forms": set(),
                "keys": set(),
                "primary_rule": primary_rule,
                "rules": set(),
                "filtered": is_filtered_candidate(candidate),
                "likelihood": candidate.candidate_score,
                "status": candidate.quality_status,
            },
        )
        if metric == "remaining_review" and has_partial_group_resolution(candidate):
            occurrence_count = uncovered_occurrence_count(candidate)
        else:
            occurrence_count = candidate.count
        row["occurrences"] += occurrence_count
        row["forms"].add(candidate.text)
        row["keys"].add(candidate.key)
        row["rules"].update(rules)
        row["filtered"] = row["filtered"] or is_filtered_candidate(candidate)
        row["likelihood"] = max(row.get("likelihood", 0), candidate.candidate_score)
        if candidate.quality_status in {"To Review", "Review"}:
            row["status"] = "To Review"
        row.setdefault("canonical_group_ids", set())
        row.setdefault("covered_occurrences", 0)
        row.setdefault("uncovered_occurrences", 0)
        decision = state["decisions"].get(candidate.key)
        if decision and decision.canonical_group_id:
            row["canonical_group_ids"].add(decision.canonical_group_id)
        row["covered_occurrences"] += len(covered_occurrence_ids(candidate))
        row["uncovered_occurrences"] += uncovered_occurrence_count(candidate)
        if candidate.count > row.get("display_count", -1):
            row["candidate"] = candidate.text
            row["display_count"] = candidate.count
    rows = []
    for row in aggregate.values():
        rules = sorted(row["rules"])
        primary_rule = row["primary_rule"]
        rows.append(
            {
                "candidate": row["candidate"],
                "occurrences": row["occurrences"],
                "forms": sorted(row["forms"]),
                "keys": sorted(row["keys"]),
                "primary_rule": primary_rule,
                "primary_reason": quality_rule_label(primary_rule),
                "rules": rules,
                "reasons": [quality_rule_label(rule) for rule in rules],
                "filtered": row["filtered"],
                "likelihood": row.get("likelihood", 0),
                "status": row.get("status", "Unlikely"),
                "canonical_group_ids": sorted(row.get("canonical_group_ids", set())),
                "covered_occurrences": row.get("covered_occurrences", 0),
                "uncovered_occurrences": row.get("uncovered_occurrences", 0),
                "partial_relationship": bool(
                    row.get("covered_occurrences", 0)
                    and row.get("uncovered_occurrences", 0)
                    and metric == "remaining_review"
                ),
            }
        )
    rows.sort(key=lambda row: (-row.get("likelihood", 0), -row["occurrences"], row["candidate"].casefold()))
    if metric == "resolved_earlier":
        label = "Resolved"
        note = "These candidates are fully covered by resolved Group Check decisions and are not remaining review work."
    elif metric in {"remaining_review", "to_review"}:
        label = "To Review"
        note = "Candidates are sorted by Likelihood, then occurrence count. Partial rows show only uncovered occurrences."
    elif metric in {"filtered", "unlikely"}:
        label = "Unlikely"
        note = (
            "Unlikely candidates remain inspectable. A candidate may appear under more than one evidence bucket."
        )
    else:
        label = quality_rule_label(metric)
        note = "A candidate may appear under more than one rule."
    return {
        "metric": metric,
        "label": label,
        "unique_count": len(rows),
        "rows": rows,
        "note": note,
    }


def restore_quality_candidate(data: dict[str, Any]) -> dict[str, Any]:
    keys = [key for key in data.get("keys", []) if candidate_by_key(key)]
    restored = set(state.get("quality_restored_keys", []))
    restored.update(keys)
    state["quality_restored_keys"] = sorted(restored)
    for key in keys:
        candidate = candidate_by_key(key)
        if not candidate:
            continue
        if candidate.quality == "Filtered (Auto Ignore)":
            candidate.quality = "Possible"
            candidate.quality_status = "To Review"
        if "session_restore_to_review" not in candidate.quality_reasons:
            candidate.quality_reasons.append("session_restore_to_review")
    return {"ok": True, "restored": len(keys)}


def update_candidate_quality_disposition(data: dict[str, Any]) -> dict[str, Any]:
    key = data["key"]
    candidate = candidate_by_key(key)
    decision = state["decisions"].get(key)
    if not candidate or not decision:
        raise ValueError("Unknown candidate.")
    if decision.review_stage == "group_check" and decision.review_status == "resolved":
        return {"ok": True, "unchanged": True, "reason": "resolved_in_group_check"}
    status_value = str(data.get("status") or "").strip().lower()
    if status_value not in {"resolved", "unresolved"}:
        raise ValueError("Candidate Quality status must be resolved or unresolved.")
    decision.review_stage = "candidate_quality"
    decision.review_status = status_value
    decision.reviewer_decision = (
        "Candidate Quality Resolved" if status_value == "resolved" else "Candidate Quality Unresolved"
    )
    decision.decision_timestamp = utc_now_iso()
    decision.inherited_decision_source = "candidate_quality"
    save_state()
    return {"ok": True, "key": key, "review_status": decision.review_status}


def entity_groups_to_json(groups: list[EntityGroup]) -> list[dict[str, Any]]:
    by_key = {candidate.key: candidate for candidate in state["candidates"]}
    decisions = state["decisions"]
    serialized = []
    for group in groups:
        members = [
            {
                **candidate_to_json(by_key[key], decisions[key]),
                "grouping_confidence": group.member_confidences.get(key, group.confidence),
                "needs_group_review": group.member_confidences.get(key, group.confidence) < 80,
            }
            for key in group.candidate_keys
            if key in by_key and key in decisions
        ]
        if not members:
            continue
        needs_review_count = sum(1 for member in members if member["needs_group_review"])
        serialized.append(
            {
                "id": group.id,
                "canonical_name": group.canonical_name,
                "type": group.detected_type,
                "candidate_keys": group.candidate_keys,
                "variant_count": group.variant_count,
                "occurrence_count": sum(member["count"] for member in members),
                "confidence": calculate_entity_confidence(group, by_key, group.candidate_keys),
                "original_confidence": group.confidence,
                "needs_review_count": needs_review_count,
                "reasons": group.reasons,
                "detector_confidences": sorted({member["confidence"] for member in members}),
                "members": members,
            }
        )
    return serialized


def ambiguous_matches_to_json(matches: list[AmbiguousEntityMatch]) -> list[dict[str, Any]]:
    by_key = {candidate.key: candidate for candidate in state["candidates"]}
    decisions = state["decisions"]
    serialized = []
    for match in matches:
        candidate = by_key.get(match.candidate_key)
        if not candidate or candidate.key not in decisions:
            continue
        serialized.append(
            {
                "candidate": candidate_to_json(candidate, decisions[candidate.key]),
                "possible_groups": match.possible_groups,
            }
        )
    return serialized


def rename_replacements_for(
    decisions: dict[str, CandidateDecision], saved: dict[str, Any] | None = None
) -> dict[str, str]:
    saved_renames = dict((saved or {}).get("rename_replacements", {}))
    for key, decision in decisions.items():
        if decision.decision == Decision.RENAME and decision.replacement and key not in saved_renames:
            saved_renames[key] = decision.replacement
    return saved_renames


def scan_uploaded_docx(filename: str, file_bytes: bytes, use_spacy: bool = True) -> None:
    ensure_dirs()
    UPLOAD_PATH.write_bytes(file_bytes)
    file_hash = sha256_file(UPLOAD_PATH)
    document = load_docx(UPLOAD_PATH)
    candidates = apply_candidate_quality(
        detect_all_candidates(iter_docx_text_blocks(document), use_spacy=use_spacy)
    )
    saved = load_saved_state()
    if saved and saved.get("file_hash") == file_hash:
        decisions = apply_saved_state(candidates, saved)
        rules = normalize_rules(saved.get("replacement_rules"), candidates)
        assignments = saved.get("replacement_assignments", {})
    else:
        decisions = build_default_decisions(candidates)
        saved = None
        rules = initial_rules(candidates)
        assignments = {}
    state["replacement_rules"] = rules
    state["replacement_assignments"] = assignments
    state.update(
        {
            "filename": filename,
            "file_hash": file_hash,
            "candidates": candidates,
            "decisions": decisions,
            "metadata": extract_docx_metadata(UPLOAD_PATH),
            "outputs": {},
            "default_replacements": default_replacements_for(candidates),
            "rename_replacements": rename_replacements_for(decisions, saved),
            "replacement_rules": rules,
            "replacement_assignments": state.get("replacement_assignments", {}),
            "replacement_sources": replacement_sources_for(decisions, saved),
            "entity_group_exclusions": (saved or {}).get("entity_group_exclusions", {}),
            "entity_group_reviews": (saved or {}).get("entity_group_reviews", []),
            "entity_resolution_done_keys": (saved or {}).get("entity_resolution_done_keys", []),
            "resolved_candidate_keys": (saved or {}).get("resolved_candidate_keys", []),
            "ambiguous_review_keys": (saved or {}).get("ambiguous_review_keys", []),
            "quality_restored_keys": [],
            "review_started_at": utc_now_iso(),
            "review_finished_at": None,
        }
    )
    save_state()


def payload() -> dict[str, Any]:
    candidates = state["candidates"]
    quality_review_candidates = candidate_quality_review_candidates()
    resolved_earlier_candidates = [
        candidate for candidate in candidates
        if is_resolved_in_earlier_review(candidate)
    ]
    quality_metrics = candidate_quality_metrics(quality_review_candidates)
    quality_status_counts = Counter(candidate_quality_status_key(candidate) for candidate in candidates)
    quality_metrics["raw_candidates"] = len(candidates)
    quality_metrics["resolved"] = quality_status_counts["resolved"]
    quality_metrics["resolved_earlier"] = quality_status_counts["resolved"]
    quality_metrics["unlikely"] = quality_status_counts["unlikely"]
    quality_metrics["to_review"] = quality_status_counts["to_review"]
    quality_metrics["remaining_review"] = quality_status_counts["to_review"]
    quality_metrics["unresolved"] = len(quality_review_candidates)
    remaining_candidates = unresolved_candidates()
    reviewable_remaining = [
        candidate for candidate in reviewable_candidates()
        if candidate.key not in set(state.get("entity_resolution_done_keys", []))
    ]
    groups, ambiguous_matches, review_candidates = resolution_routes()
    decisions = state["decisions"]
    serialized = [
        candidate_to_json(candidate, decisions[candidate.key])
        for candidate in review_candidates
        if not is_resolved_in_earlier_review(candidate)
    ]
    quality_serialized = [candidate_to_json(candidate, decisions[candidate.key]) for candidate in candidates]
    undecided = sum(1 for decision in decisions.values() if decision.decision == Decision.UNDECIDED)
    rename = sum(1 for decision in decisions.values() if decision.decision == Decision.RENAME)
    redact = sum(1 for decision in decisions.values() if decision.decision == Decision.REDACT)
    wrong = sum(1 for decision in decisions.values() if decision.decision == Decision.NOT_SENSITIVE)
    review = sum(1 for decision in decisions.values() if decision.decision == Decision.REVIEW)
    confidence_counts = {"high": 0, "medium": 0, "low": 0}
    quality_counts = {
        "to_review": quality_status_counts["to_review"],
        "unlikely": quality_status_counts["unlikely"],
        "resolved": quality_status_counts["resolved"],
        "strong": 0,
        "possible": 0,
        "filtered": 0,
    }
    for candidate in quality_review_candidates:
        if is_filtered_candidate(candidate):
            quality_counts["filtered"] += 1
            continue
        quality_counts[candidate.quality.lower()] = quality_counts.get(candidate.quality.lower(), 0) + 1
    for candidate in review_candidates:
        if candidate.quality != "Unlikely":
            confidence_counts[confidence_bucket(candidate.confidence)] += 1
    normal_review_count = len([candidate for candidate in review_candidates if candidate.quality != "Unlikely"])
    grouped_candidate_count = sum(len(group.candidate_keys) for group in groups)
    group_json = entity_groups_to_json(groups)
    ambiguous_json = ambiguous_matches_to_json(ambiguous_matches)
    return {
        "build": APP_BUILD,
        "filename": state["filename"],
        "file_hash": state["file_hash"],
        "metadata": state["metadata"],
        "candidates": serialized,
        "quality_candidates": quality_serialized,
        "entity_groups": group_json,
        "ambiguous_matches": ambiguous_json,
        "counts": {
            "total": len(candidates),
            "remaining": len(remaining_candidates),
            "reviewable_remaining": len(reviewable_remaining),
            "filtered": quality_metrics["filtered"],
            "to_review": quality_metrics["to_review"],
            "unlikely": quality_metrics["unlikely"],
            "resolved_earlier": quality_metrics["resolved_earlier"],
            "quality_reduction_percent": quality_metrics["reduction_percent"],
            "resolved": len(state.get("entity_resolution_done_keys", [])),
            "groups": len(group_json),
            "candidates_in_groups": grouped_candidate_count,
            "standalone_review": len(review_candidates),
            "ambiguous": len(ambiguous_json),
            "undecided": undecided,
            "rename": rename,
            "redact": redact,
            "wrong_match": wrong,
            "review": review,
        },
        "outputs": state["outputs"],
        "confidence_counts": confidence_counts,
        "quality_counts": quality_counts,
        "candidate_quality_metrics": quality_metrics,
        "normal_review_count": normal_review_count,
        "replacement_rules": {
            entity_type: {
                **rule,
                "preview": preview_for_rule(rule),
            }
            for entity_type, rule in sorted(
                normalize_rules(state.get("replacement_rules"), candidates).items()
            )
        },
        "entity_group_reviews": state.get("entity_group_reviews", []),
        "review_started_at": state.get("review_started_at"),
        "review_finished_at": state.get("review_finished_at"),
    }


def update_decision(data: dict[str, Any]) -> None:
    key = data["key"]
    decision = state["decisions"][key]
    candidate = candidate_by_key(key)
    default_replacement = state.get("default_replacements", {}).get(key, decision.replacement or "")
    if "action" in data:
        action = data["action"]
        decision.decision = ACTION_TO_DECISION.get(action, decision.decision)
        decision.review_stage = data.get("review_stage", decision.review_stage or "item_check")
        decision.review_status = "unresolved" if decision.decision == Decision.UNDECIDED else "resolved"
        decision.reviewer_decision = action
        decision.decision_timestamp = utc_now_iso()
        decision.inherited_decision_source = data.get("inherited_decision_source") or decision.inherited_decision_source
        if decision.decision == Decision.RENAME:
            decision.replacement = state.get("rename_replacements", {}).get(
                key, decision.replacement or default_replacement
            )
            state.setdefault("rename_replacements", {})[key] = decision.replacement or ""
            state.setdefault("replacement_sources", {})[key] = MANUAL
        else:
            if candidate:
                set_auto_replacement(candidate, decision)
            else:
                decision.replacement = default_replacement
    if "replacement" in data:
        replacement = str(data["replacement"] or "").strip()
        if decision.decision == Decision.RENAME:
            state.setdefault("rename_replacements", {})[key] = replacement
            decision.replacement = replacement
            state.setdefault("replacement_sources", {})[key] = MANUAL
        elif decision.decision in {Decision.REDACT, Decision.REVIEW}:
            state.setdefault("default_replacements", {})[key] = replacement
            decision.replacement = replacement
            state.setdefault("replacement_sources", {})[key] = MANUAL
    if "type" in data:
        for candidate in state["candidates"]:
            if candidate.key == key:
                candidate.detected_type = str(data["type"])
                for occurrence in candidate.occurrences:
                    occurrence.detected_type = candidate.detected_type
                if state.get("replacement_sources", {}).get(key, AUTO) != MANUAL:
                    set_auto_replacement(candidate, decision)
                break
    save_state()


def update_entity_group(data: dict[str, Any]) -> dict[str, Any]:
    group_id = str(data["group_id"])
    action = data.get("action")
    candidate_keys = [str(key) for key in data.get("candidate_keys", [])]
    group = next((item for item in build_entity_groups(unresolved_candidates(), {}) if item.id == group_id), None)
    all_group_keys = list(group.candidate_keys) if group else candidate_keys
    if data.get("exclude_key"):
        excluded = state.setdefault("entity_group_exclusions", {}).setdefault(group_id, [])
        key = str(data["exclude_key"])
        if key not in excluded:
            excluded.append(key)
        save_state()
        return {"ok": True}

    if action:
        replacement = str(data.get("replacement") or "").strip()
        timestamp = utc_now_iso()
        prior_states = {
            key: DECISION_TO_ACTION[state["decisions"][key].decision]
            for key in candidate_keys
            if key in state["decisions"]
        }
        if action == "Skip":
            state.setdefault("entity_group_reviews", []).append(
                {
                    "timestamp": utc_now_iso(),
                    "reviewer": "local_user",
                    "group_id": group_id,
                    "selected_candidate_ids": candidate_keys,
                    "deselected_candidate_ids": [key for key in all_group_keys if key not in candidate_keys],
                    "action": "Skip",
                    "prior_states": prior_states,
                    "resulting_states": prior_states,
                }
            )
            save_state()
            return {"ok": True}
        if action == "Not Quite":
            state.setdefault("entity_group_reviews", []).append(
                {
                    "timestamp": utc_now_iso(),
                    "reviewer": "local_user",
                    "group_id": group_id,
                    "selected_candidate_ids": candidate_keys,
                    "deselected_candidate_ids": [key for key in all_group_keys if key not in candidate_keys],
                    "action": "Not Quite",
                    "prior_states": prior_states,
                    "resulting_states": prior_states,
                }
            )
            save_state()
            return {"ok": True}
        if action == "Not Quite Complete":
            done_keys = set(state.get("entity_resolution_done_keys", []))
            for key in all_group_keys:
                done_keys.add(key)
            state["entity_resolution_done_keys"] = sorted(done_keys)
            mark_group_candidates_resolved(
                all_group_keys,
                group_id=group_id,
                reviewer_decision="Not Quite Complete",
                inherited_decision_source="group_check_not_quite",
                timestamp=timestamp,
            )
            state.setdefault("entity_group_reviews", []).append(
                {
                    "timestamp": timestamp,
                    "reviewer": "local_user",
                    "group_id": group_id,
                    "selected_candidate_ids": candidate_keys,
                    "deselected_candidate_ids": [],
                    "candidate_occurrence_membership": group_occurrence_membership(all_group_keys),
                    "action": "Not Quite Complete",
                    "prior_states": prior_states,
                    "resulting_states": prior_states,
                }
            )
            save_state()
            return {"ok": True}

        decision_action = {
            "Flatten": "Rename",
            "Keep as-is": "Keep",
            "Redact": "Redact",
            "Ignore": "Ignore",
        }.get(action, action)
        for key in candidate_keys:
            if key not in state["decisions"]:
                continue
            update_decision({"key": key, "action": decision_action})
            if replacement and decision_action in {"Rename", "Redact"}:
                update_decision({"key": key, "replacement": replacement})
        resulting_states = {
            key: DECISION_TO_ACTION[state["decisions"][key].decision]
            for key in candidate_keys
            if key in state["decisions"]
        }
        mark_group_candidates_resolved(
            candidate_keys,
            group_id=group_id,
            reviewer_decision=action,
            inherited_decision_source="group_check",
            timestamp=timestamp,
        )
        state.setdefault("entity_group_reviews", []).append(
            {
                "timestamp": timestamp,
                "reviewer": "local_user",
                "group_id": group_id,
                "selected_candidate_ids": candidate_keys,
                "deselected_candidate_ids": [key for key in all_group_keys if key not in candidate_keys],
                "candidate_occurrence_membership": group_occurrence_membership(candidate_keys),
                "action": action,
                "canonical_entity_id": f"entity:{group_id}",
                "canonical_value": replacement if action == "Flatten" else (group.canonical_name if group else None),
                "replacement_value": replacement if action in {"Flatten", "Redact"} else None,
                "prior_states": prior_states,
                "resulting_states": resulting_states,
            }
        )
        save_state()
    return {"ok": True}


def finish_entity_resolution() -> dict[str, Any]:
    groups, _ambiguous, _review = resolution_routes()
    previous_done_keys = list(state.get("entity_resolution_done_keys", []))
    previous_reviews = list(state.get("entity_group_reviews", []))
    previous_decision_lifecycle = {
        key: {
            "canonical_group_id": decision.canonical_group_id,
            "covered_occurrence_ids": list(decision.covered_occurrence_ids),
            "uncovered_occurrence_count": decision.uncovered_occurrence_count,
            "review_stage": decision.review_stage,
            "review_status": decision.review_status,
            "reviewer_decision": decision.reviewer_decision,
            "decision_timestamp": decision.decision_timestamp,
            "inherited_decision_source": decision.inherited_decision_source,
        }
        for key, decision in state.get("decisions", {}).items()
    }
    done_keys = set(previous_done_keys)
    finished = 0
    timestamp = utc_now_iso()
    finished_keys: list[str] = []
    for group in groups:
        for key in group.candidate_keys:
            done_keys.add(key)
            finished_keys.append(key)
            finished += 1
        mark_group_candidates_resolved(
            list(group.candidate_keys),
            group_id=group.id,
            reviewer_decision="Done Editing",
            inherited_decision_source="group_check_done_editing",
            timestamp=timestamp,
        )
    state["entity_resolution_done_keys"] = sorted(done_keys)
    state.setdefault("entity_group_reviews", []).append(
        {
            "timestamp": timestamp,
            "reviewer": "local_user",
            "action": "Done Editing",
            "group_count": len(groups),
            "finished_candidate_count": finished,
            "selected_candidate_ids": finished_keys,
            "candidate_occurrence_membership": group_occurrence_membership(finished_keys),
        }
    )
    try:
        save_state()
    except Exception:
        state["entity_resolution_done_keys"] = previous_done_keys
        state["entity_group_reviews"] = previous_reviews
        for key, values in previous_decision_lifecycle.items():
            decision = state.get("decisions", {}).get(key)
            if not decision:
                continue
            decision.canonical_group_id = values["canonical_group_id"]
            decision.covered_occurrence_ids = values["covered_occurrence_ids"]
            decision.uncovered_occurrence_count = values["uncovered_occurrence_count"]
            decision.review_stage = values["review_stage"]
            decision.review_status = values["review_status"]
            decision.reviewer_decision = values["reviewer_decision"]
            decision.decision_timestamp = values["decision_timestamp"]
            decision.inherited_decision_source = values["inherited_decision_source"]
        raise
    return {"ok": True, "finished": finished}


def update_ambiguous_match(data: dict[str, Any]) -> dict[str, Any]:
    key = str(data["key"])
    if data.get("review_separately"):
        if key in state["decisions"]:
            update_decision({"key": key, "action": "Ignore"})
        save_state()
        return {"ok": True}

    action = data.get("action")
    if action and key in state["decisions"]:
        update_decision({"key": key, "action": action})
        if ACTION_TO_DECISION.get(action) == Decision.RENAME and data.get("replacement"):
            update_decision({"key": key, "replacement": data.get("replacement")})
        save_state()
    return {"ok": True}


def update_replacement_rule(data: dict[str, Any]) -> dict[str, Any]:
    entity_type = normalize_type(data.get("entity_type"))
    engine = ReplacementRuleEngine(state.get("replacement_rules"), state.get("replacement_assignments"))
    rule = engine.update_rule(entity_type, data.get("rule") or {})
    state["replacement_rules"] = engine.rules
    state["replacement_assignments"] = engine.assignments

    updated = 0
    skipped_manual = 0
    if data.get("apply_existing"):
        overwrite_manual = bool(data.get("overwrite_manual"))
        for candidate in state["candidates"]:
            if normalize_type(candidate.detected_type) != entity_type:
                continue
            decision = state["decisions"][candidate.key]
            if decision.decision not in {Decision.REDACT, Decision.REVIEW}:
                continue
            is_manual = state.get("replacement_sources", {}).get(candidate.key, AUTO) == MANUAL
            if is_manual and not overwrite_manual:
                skipped_manual += 1
                continue
            replacement = engine.replacement_for(candidate)
            decision.replacement = replacement
            state.setdefault("default_replacements", {})[candidate.key] = replacement
            state.setdefault("replacement_sources", {})[candidate.key] = AUTO
            updated += 1
        state["replacement_assignments"] = engine.assignments

    save_state()
    return {"ok": True, "rule": {**rule, "preview": preview_for_rule(rule)}, "updated": updated, "skipped_manual": skipped_manual}


def generate_outputs() -> dict[str, Any]:
    if not state["filename"] or not UPLOAD_PATH.exists():
        raise ValueError("No DOCX has been scanned yet.")
    review_count = sum(
        1 for decision in state["decisions"].values() if decision.decision == Decision.REVIEW
    )
    if review_count:
        raise ValueError("Older occurrence-level decisions are still present. Choose Keep, Rename, Redact, or Ignore for those rows before generating.")

    stem = Path(state["filename"]).stem
    target_dir = output_dir()
    redacted_path = target_dir / f"{stem}_redacted.docx"
    csv_path = target_dir / f"{stem}_redaction_log.csv"
    json_path = target_dir / f"{stem}_decisions.json"
    metrics_path = target_dir / f"{stem}_qa_metrics.json"
    state["review_finished_at"] = utc_now_iso()
    write_redacted_docx(UPLOAD_PATH, redacted_path, json_path, state["candidates"], state["decisions"])
    write_audit_csv(csv_path, state["candidates"], state["decisions"], state["file_hash"])
    write_qa_metrics(
        metrics_path,
        build_qa_metrics(
            candidates=state["candidates"],
            decisions=state["decisions"],
            input_sha256=state["file_hash"],
            filename=state["filename"],
            review_started_at=state.get("review_started_at"),
            review_finished_at=state.get("review_finished_at"),
        ),
    )
    save_state()

    redacted_doc = load_docx(redacted_path)
    redacted_candidates = [
        candidate
        for candidate in state["candidates"]
        if state["decisions"][candidate.key].decision in {Decision.REDACT, Decision.RENAME}
    ]
    remaining = rescan_for_originals(redacted_doc, redacted_candidates)

    state["outputs"] = {
        "redacted_docx": f"/download/{redacted_path.name}",
        "audit_csv": f"/download/{csv_path.name}",
        "decisions_json": f"/download/{json_path.name}",
        "qa_metrics_json": f"/download/{metrics_path.name}",
        "output_folder": str(target_dir),
        "remaining_originals": remaining,
    }
    return state["outputs"]


HTML = r"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DocScrub</title>
  <style>
    :root { color-scheme: light; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    html, body { width: 100%; max-width: 100%; }
    body { margin: 0; color: #202633; background: #f7f8fb; overflow-x: hidden; }
    header { position: sticky; top: 0; z-index: 4; width: 100%; max-width: 100%; overflow-x: hidden; background: rgba(255,255,255,.96); border-bottom: 1px solid #d9e0ea; padding: 12px 18px; }
    h1 { display: flex; align-items: center; font-size: 22px; margin: 0 10px 0 0; line-height: 1; }
    .app-logo { display: block; height: 28px; width: auto; }
    .build { color: #667085; font-size: 12px; }
    .queuebar { display: grid; grid-template-columns: 1fr; gap: 8px; align-items: end; margin-bottom: 8px; min-width: 0; max-width: 100%; }
    .queue-tools { display: grid; grid-template-columns: minmax(150px, 1.4fr) minmax(86px, 120px) minmax(88px, 110px) minmax(72px, 86px) minmax(66px, 78px); gap: 8px; align-items: end; justify-self: end; width: min(820px, 100%); min-width: 0; }
    label { display: block; color: #465365; font-size: 12px; font-weight: 650; margin-bottom: 4px; }
    input, select, button { font: inherit; }
    input[type="checkbox"] { accent-color: #94a3b8; }
    .group-card.active.expanded input[type="checkbox"] { accent-color: #2563eb; }
    input[type="search"], input[type="text"], select { width: 100%; box-sizing: border-box; border: 1px solid #d5dce6; border-radius: 6px; padding: 5px 7px; background: white; }
    button { border: 1px solid #cfd7e3; border-radius: 6px; padding: 6px 9px; background: white; color: #222b3a; cursor: pointer; font-weight: 650; }
    button.primary, button.selected { background: #ef4444; color: white; border-color: #ef4444; }
    button:disabled { opacity: .45; cursor: default; }
    .filebar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 10px; max-width: 100%; }
    .summary { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 10px; color: #465365; font-size: 14px; }
    main { width: 100%; max-width: 100%; padding: 10px 14px 48px; overflow-x: hidden; }
    .hint { color: #5d697a; font-size: 13px; margin-bottom: 8px; }
    .legend { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; color: #5d697a; font-size: 13px; margin-bottom: 8px; }
    .legend-item { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
    .keycap { display: inline-flex; align-items: center; justify-content: center; min-width: 20px; height: 20px; padding: 0 5px; border: 1px solid #cbd5e1; border-radius: 5px; background: white; color: #1f2937; font-weight: 750; font-size: 12px; line-height: 1; }
    .legend-note { color: #6b7280; white-space: nowrap; }
    .tabs { display: flex; gap: 6px; margin: 8px 0 8px; }
    .tab { border-color: #d7deea; color: #334155; background: #fff; }
    .tab.active { background: #1f2937; color: white; border-color: #1f2937; }
    .pager { display: flex; align-items: center; gap: 8px; color: #465365; font-size: 13px; margin: 8px 0; }
    .pager button { padding: 5px 9px; }
    .bulkbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 6px 0 8px; padding: 6px 8px; border: 1px solid #d8e0ea; background: #fff; color: #334155; font-size: 12px; }
    .bulkbar label { display: inline-flex; align-items: center; gap: 4px; margin: 0; font-size: 12px; color: #334155; }
    .bulkbar select { width: auto; min-width: 120px; }
    .bulkbar input[type="text"] { width: 220px; }
    .review-section { margin-top: 8px; border: 1px solid #d8e0ea; background: #fff; padding: 8px; max-width: 100%; overflow-x: hidden; }
    .section-title { font-weight: 800; color: #334155; margin: 0 0 6px; }
    .rules-panel { margin: 0 0 8px; border: 1px solid #d8e0ea; background: #fff; }
    .rules-panel summary { cursor: pointer; padding: 7px 9px; font-weight: 750; color: #334155; user-select: none; }
    .rules-summary { display: inline-flex; align-items: center; gap: 12px; }
    .quality-panel { margin: 0 0 8px; border: 1px solid #d8e0ea; background: #fff; }
    .quality-panel summary { cursor: pointer; padding: 7px 9px; font-weight: 750; color: #334155; user-select: none; }
    .quality-grid { display: grid; grid-template-columns: minmax(470px, .92fr) minmax(520px, 1.08fr); gap: 10px; padding: 0 8px 8px; color: #334155; font-size: 12px; align-items: start; }
    .quality-column { border-top: 1px solid #eef2f6; padding-top: 6px; min-width: 0; }
    .quality-column.category { grid-column: 1 / -1; }
    .quality-column-title { color: #64748b; font-size: 11px; font-weight: 800; letter-spacing: .02em; text-transform: uppercase; margin-bottom: 5px; }
    .quality-column-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 5px; }
    .quality-column-title-group { display: inline-flex; align-items: baseline; gap: 8px; min-width: 0; }
    .quality-column-head .quality-column-title { margin-bottom: 0; }
    .quality-show-all { border: 0; background: transparent; padding: 0; color: #475569; font-size: 12px; font-weight: 750; text-decoration: underline; text-underline-offset: 2px; }
    .quality-show-all.active { color: #1f2937; text-decoration-thickness: 2px; }
    .quality-show-all:focus-visible { outline: 2px solid #2563eb; outline-offset: 3px; border-radius: 3px; }
    .quality-head-controls { display: inline-flex; align-items: center; gap: 10px; }
    .quality-empty-toggle { display: inline-flex; align-items: center; gap: 4px; color: #64748b; font-size: 10px; font-weight: 650; white-space: nowrap; }
    .quality-empty-toggle input { width: 10px; height: 10px; margin: 0; }
    .quality-sort { width: auto; min-width: 132px; height: 26px; padding: 2px 22px 2px 7px; font-size: 12px; }
    .quality-nav-list { display: grid; gap: 4px; }
    .quality-nav-list.category-list { grid-template-columns: repeat(4, minmax(0, 1fr)); grid-auto-rows: 27px; align-items: stretch; }
    .quality-nav-list.horizontal { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .quality-nav-row { display: grid; grid-template-columns: minmax(0, 1fr) 54px; align-items: center; gap: 8px; width: 100%; border: 1px solid #d8e0ea; border-radius: 999px; background: #f8fafc; padding: 4px 8px; text-align: left; color: #334155; }
    .quality-nav-row:hover, .quality-nav-row.active { background: #eaf2ff; border-color: #9dbcf8; color: #1d4ed8; }
    .quality-nav-row:focus-visible { outline: 2px solid #2563eb; outline-offset: 2px; }
    .quality-nav-list.horizontal .quality-nav-row { display: inline-flex; width: auto; min-width: 0; grid-template-columns: none; justify-content: flex-start; gap: 10px; padding: 4px 9px; }
    .quality-nav-list.horizontal .quality-nav-label { white-space: nowrap; }
    .quality-nav-list.horizontal .quality-nav-count { justify-self: auto; min-width: 22px; text-align: right; }
    .quality-column.filter .quality-nav-list.horizontal { flex-wrap: nowrap; }
    .quality-column.filter .quality-nav-row { gap: 8px; padding-left: 8px; padding-right: 8px; }
    .quality-column.state .quality-nav-row { border-color: #c7dff3; background: #f3f9ff; }
    .quality-column.state .quality-nav-row:hover, .quality-column.state .quality-nav-row.active { background: #e0f2fe; border-color: #60a5fa; color: #075985; }
    .quality-column.filter .quality-nav-row { border-color: #e6d8f5; background: #fbf7ff; }
    .quality-column.filter .quality-nav-row:hover, .quality-column.filter .quality-nav-row.active { background: #f3e8ff; border-color: #c084fc; color: #6b21a8; }
    .quality-column.category .quality-nav-row:hover, .quality-column.category .quality-nav-row.active { background: #f1f5f9; border-color: #94a3b8; color: #1f2937; }
    .quality-column.category .quality-nav-row { align-items: center; min-height: 0; height: 27px; border-radius: 14px; padding-top: 4px; padding-bottom: 4px; }
    .quality-column.category .quality-nav-row.tall { grid-row: span 2; height: 58px; align-items: center; align-content: center; padding-top: 7px; padding-bottom: 7px; }
    .quality-column.category .quality-nav-label { white-space: normal; overflow: visible; text-overflow: clip; line-height: 1.15; }
    .quality-column.category .quality-nav-row.tall .quality-nav-label { line-height: 1.5; }
    .quality-column.category .quality-nav-count { align-self: start; line-height: 1.15; }
    .quality-column.category .quality-nav-row.tall .quality-nav-count { align-self: start; padding-top: 1px; }
    .quality-column.category .quality-nav-row.count-high { font-weight: 850; }
    .quality-column.category .quality-nav-row.count-mid { font-weight: 650; }
    .quality-column.category .quality-nav-row.count-low { color: #64748b; }
    .quality-column.category .quality-nav-row.count-empty { opacity: .45; }
    .quality-column.category .quality-nav-row.count-empty:hover,
    .quality-column.category .quality-nav-row.count-empty.active { opacity: .72; }
    .quality-nav-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .quality-nav-count { justify-self: end; color: #1f2937; font-weight: 850; }
    .quality-nav-row.to-review .quality-nav-count { color: #2563eb; }
    .quality-context-empty { border: 1px dashed #d8e0ea; border-radius: 8px; color: #64748b; padding: 8px; background: #fbfdff; }
    .results-summary { display: flex; align-items: baseline; gap: 10px; color: #64748b; font-size: 13px; margin: 0 0 8px; }
    .results-summary strong { color: #1f2937; font-size: 15px; }
    .results-title-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 4px; }
    .results-title-controls { display: inline-flex; align-items: center; justify-content: flex-start; gap: 8px; min-width: 315px; }
    .accept-results { padding: 4px 9px; font-size: 12px; }
    .accept-results.has-changes { border-color: #2563eb; color: #1d4ed8; background: #eff6ff; font-weight: 750; }
    .accept-results:disabled { opacity: .45; }
    .accept-results-confirm { display: inline-flex; align-items: center; gap: 5px; color: #64748b; font-size: 12px; font-weight: 700; }
    .accept-results-confirm[hidden] { display: none; }
    .accept-results-confirm button { padding: 3px 7px; font-size: 12px; }
    .quality-detail { grid-column: 1 / -1; border: 1px solid #d8e0ea; background: #fbfdff; padding: 8px; }
    .quality-detail[hidden] { display: none; }
    .quality-detail-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; color: #475569; margin-bottom: 6px; }
    .quality-detail-title { color: #1f2937; font-weight: 800; }
    .quality-detail-note { color: #64748b; font-size: 11px; }
    .quality-detail-table-wrap { max-height: 240px; overflow: auto; border-top: 1px solid #eef2f6; }
    .quality-detail table { width: 100%; border-collapse: collapse; font-size: 12px; }
    .quality-detail th, .quality-detail td { padding: 5px 6px; border-bottom: 1px solid #eef2f6; text-align: left; vertical-align: top; }
    .quality-detail th { position: sticky; top: 0; background: #fbfdff; color: #64748b; font-size: 11px; text-transform: uppercase; }
    .quality-detail td:nth-child(2) { width: 82px; text-align: right; font-weight: 800; }
    .quality-forms { color: #64748b; font-size: 11px; margin-top: 2px; }
    .quality-restore { padding: 3px 6px; font-size: 11px; white-space: nowrap; }
    .advanced-toggle { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; font-weight: 650; color: #64748b; }
    .rules-grid { display: grid; gap: 0; padding: 0 8px 8px; max-width: 100%; overflow-x: auto; }
    .rule-row { display: grid; grid-template-columns: 105px 188px minmax(160px, 1fr) minmax(130px, .85fr) minmax(120px, .9fr) 235px 142px 88px; align-items: end; gap: 8px; min-height: 42px; padding: 6px 0; border-top: 1px solid #eef2f6; }
    .rule-title { font-weight: 800; color: #1f2937; text-transform: capitalize; padding-bottom: 7px; }
    .rule-modes, .rule-scope { display: flex; gap: 8px; align-items: center; padding-bottom: 7px; color: #334155; font-size: 12px; }
    .rule-modes label, .rule-scope label, .overwrite-label { display: inline-flex; align-items: center; gap: 4px; margin: 0; font-size: 12px; white-space: nowrap; }
    .rule-field label { margin-bottom: 2px; }
    .rule-preview { color: #64748b; font-size: 12px; padding-bottom: 7px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .rule-row button { padding: 5px 8px; font-size: 12px; margin-bottom: 1px; }
    .autosave-note { color: #64748b; font-size: 11px; font-style: italic; padding-bottom: 7px; white-space: nowrap; }
    .rules-panel:not(.advanced) .advanced-only { display: none; }
    .command-bar { display: flex; align-items: center; gap: 12px; min-height: 0; max-height: 0; margin: 0; padding: 0 10px; border: 1px solid transparent; background: rgba(248, 250, 252, .96); color: #475569; font-size: 12px; opacity: 0; visibility: hidden; overflow: hidden; transform: translateY(-3px); transition: opacity 140ms ease, transform 140ms ease, max-height 140ms ease, margin 140ms ease, padding 140ms ease, border-color 140ms ease; }
    .command-bar.visible { max-height: 38px; margin: -2px 0 8px; padding: 5px 10px; border-color: #d8e0ea; opacity: 1; visibility: visible; transform: translateY(0); }
    .command-icon { color: #64748b; font-size: 13px; line-height: 1; }
    .command-items { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; min-width: 0; }
    .command-item { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
    .command-bar .keycap { height: 18px; min-width: 18px; padding: 0 4px; font-size: 11px; background: white; }
    .entity-resolution { margin: 0 0 8px; border: 1px solid #d8e0ea; background: #fff; max-width: 100%; overflow-x: hidden; }
    .entity-resolution summary { cursor: pointer; display: flex; align-items: center; gap: 6px; padding: 7px 9px; font-weight: 750; color: #334155; user-select: none; list-style: none; min-width: 0; overflow: visible; }
    .entity-resolution summary::-webkit-details-marker { display: none; }
    .entity-resolution summary::before { content: "▸"; flex: 0 0 auto; }
    .entity-resolution[open] > summary::before { content: "▾"; }
    .stage-summary { display: inline-flex; align-items: center; justify-content: flex-start; gap: 0; flex: 0 1 auto; min-width: 0; white-space: nowrap; }
    .stage-title { display: inline-flex; align-items: center; gap: 4px; flex: 0 1 auto; min-width: 0; }
    .stage-title-controls { display: inline-flex; align-items: center; gap: 8px; margin-left: 14px; flex: 0 0 auto; }
    .done-editing { padding: 4px 8px; font-size: 12px; }
    .finish-confirm { display: inline-flex; align-items: center; gap: 6px; color: #64748b; font-weight: 750; }
    .finish-confirm[hidden] { display: none; }
    .stagebar { display: grid; grid-template-columns: minmax(150px, 1fr) minmax(86px, 120px) minmax(92px, 126px) minmax(72px, 86px) minmax(66px, 78px) minmax(150px, auto); gap: 8px; align-items: end; padding: 0 8px 8px; min-width: 0; max-width: 100%; }
    .stage-pager { display: flex; gap: 6px; align-items: center; color: #64748b; font-size: 12px; white-space: nowrap; padding-bottom: 1px; }
    .stage-pager button { padding: 5px 8px; font-size: 12px; }
    .group-list { display: grid; gap: 4px; padding: 0 8px 8px; }
    #entityGroups.group-list { grid-template-columns: 1fr; align-items: start; }
    @media (min-width: 1500px) {
      #entityGroups.group-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    #ambiguousMatches.group-list { grid-template-columns: 1fr; }
    .group-card { border-top: 1px solid #eef2f6; min-width: 0; }
    .group-card.decision-keep { background: #f1fbf3; border-color: #cfe9d4; }
    .group-card.decision-rename { background: #eff7ff; border-color: #c9e0f7; }
    .group-card.decision-redact { background: #fff1f3; border-color: #f2cbd2; }
    .group-card.decision-ignore { background: #f3f1fb; border-color: #d9d4ee; }
    .group-card.decision-review, .group-card.decision-wrong-match { background: #f3f1fb; border-color: #d9d4ee; }
    .group-card.decision-skip { background: #f1f5f9; border-color: #cbd5e1; }
    .group-card.decision-not-quite { background: #f8fafc; border-color: #cbd5e1; }
    .group-card.decision-mixed { background: #f8fafc; border-color: #d8e0ea; }
    .group-card.active { outline: 2px solid #2563eb; outline-offset: -2px; }
    .group-row { display: grid; grid-template-columns: 24px minmax(0, 1fr) 50px minmax(340px, auto); gap: 6px; align-items: center; min-height: 34px; cursor: pointer; min-width: 0; }
    .group-row.active { outline: 1px solid #2563eb; outline-offset: -1px; background: rgba(37, 99, 235, .06); }
    .group-row[tabindex="0"]:focus { outline: 1px solid #2563eb; outline-offset: -1px; }
    .group-row button, .group-row input { cursor: pointer; }
    .group-name { font-weight: 800; color: #1f2937; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .group-meta, .member-meta { color: #64748b; font-size: 12px; }
    .group-confidence { font-weight: 800; font-size: 12px; }
    .group-confidence.good { color: #15803d; }
    .group-confidence.warn { color: #b45309; }
    .group-confidence.caution { color: #b91c1c; }
    .group-confidence.complete { color: #15803d; text-align: center; }
    .completion-check { display: inline-flex; width: 22px; height: 22px; align-items: center; justify-content: center; border-radius: 999px; background: linear-gradient(180deg, #ecfdf5, #bbf7d0); border: 1px solid #86efac; box-shadow: 0 1px 2px rgba(21, 128, 61, .18), inset 0 1px 0 rgba(255,255,255,.9); color: #15803d; font-size: 15px; font-weight: 900; line-height: 1; animation: complete-pop 180ms ease-out; }
    @keyframes complete-pop { from { transform: scale(.72); opacity: .35; } 70% { transform: scale(1.08); opacity: 1; } to { transform: scale(1); opacity: 1; } }
    .prior-score { display: block; color: #64748b; font-size: 10px; font-style: italic; font-weight: 650; line-height: 1; }
    .group-review-note { color: #b45309; font-size: 12px; font-style: italic; font-weight: 600; margin-left: 8px; }
    .group-status { color: #64748b; font-size: 11px; font-style: italic; font-weight: 650; margin-left: 8px; }
    .group-actions { display: flex; gap: 4px; justify-content: flex-end; flex-wrap: wrap; min-width: 0; }
    .group-actions button, .member-context button { padding: 4px 6px; font-size: 12px; }
    .group-actions button { white-space: nowrap; }
    .group-actions button.selected { color: white; }
    .group-actions button.action-keep.selected { background: #16a34a; border-color: #15803d; }
    .group-actions button.action-rename.selected { background: #2563eb; border-color: #1d4ed8; }
    .group-actions button.action-redact.selected { background: #dc2626; border-color: #b91c1c; }
    .group-actions button.action-ignore.selected { background: #7c3aed; border-color: #6d28d9; }
    .group-actions button.action-review.selected, .group-actions button.action-wrong-match.selected { background: #7c3aed; border-color: #6d28d9; }
    .group-actions button.action-skip.selected { background: #64748b; border-color: #475569; }
    .group-actions button.action-not-quite.selected { background: #475569; border-color: #334155; }
    .group-actions button.completed-choice { font-weight: 800; }
    .group-actions button.action-keep.completed-choice { background: #dff4e3; border-color: #a8d8b2; color: #166534; }
    .group-actions button.action-rename.completed-choice { background: #dbeafe; border-color: #abc8f5; color: #1d4ed8; }
    .group-actions button.action-redact.completed-choice { background: #ffe1e7; border-color: #efb4c0; color: #b91c1c; }
    .group-actions button.action-ignore.completed-choice { background: #e8e3fb; border-color: #c7bdf0; color: #5b21b6; }
    .group-actions button.action-not-quite.completed-choice { background: #e2e8f0; border-color: #cbd5e1; color: #334155; }
    .group-actions button.action-back { background: #fff; color: #475569; }
    .group-members { display: none; padding: 2px 0 8px 34px; }
    .group-card.expanded .group-members { display: block; }
    .member-row { display: grid; grid-template-columns: 24px minmax(0, 1fr) 50px minmax(120px, 340px); gap: 6px; align-items: center; min-height: 30px; border-top: 1px solid #f1f5f9; min-width: 0; }
    .member-row.active { outline: 1px solid #2563eb; outline-offset: -1px; background: rgba(37, 99, 235, .06); }
    .member-row[tabindex="0"]:focus { outline: 1px solid #2563eb; outline-offset: -1px; }
    .member-name { font-weight: 700; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .inline-count { color: #64748b; font-size: 12px; font-weight: 650; white-space: nowrap; }
    .member-confidence { color: #475569; font-size: 12px; font-weight: 800; }
    .member-context { display: flex; justify-content: flex-end; min-width: 0; }
    .group-editor { background: #f7fbff; padding: 8px 10px 10px 30px; }
    .group-editor.action-rename { background: #eff7ff; }
    .group-editor.action-redact { background: #fff1f3; }
    .group-editor-title { font-weight: 750; color: #334155; margin-bottom: 6px; }
    .group-editor-options { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; color: #334155; font-size: 12px; }
    .group-editor-custom { display: grid; grid-template-columns: minmax(220px, 1fr) auto auto; gap: 8px; align-items: center; }
    .not-quite-panel { padding: 6px 0 8px 30px; background: inherit; }
    .not-quite-title { font-weight: 800; color: #334155; margin-bottom: 2px; }
    .not-quite-subtitle { color: #64748b; font-size: 12px; margin-bottom: 6px; }
    .not-quite-row { display: grid; grid-template-columns: minmax(0, 1fr) 54px 52px 66px 62px 62px 72px; gap: 6px; align-items: center; min-height: 30px; border-top: 1px solid rgba(148, 163, 184, .18); }
    .not-quite-row.decision-keep { background: #f1fbf3; }
    .not-quite-row.decision-rename { background: #eff7ff; }
    .not-quite-row.decision-redact { background: #fff1f3; }
    .not-quite-row.decision-ignore { background: #f3f1fb; }
    .not-quite-name { font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .not-quite-score { font-size: 12px; font-weight: 800; text-align: right; }
    .not-quite-prior-score { display: block; color: #64748b; font-size: 10px; font-style: italic; font-weight: 650; line-height: 1; }
    .not-quite-status { color: #64748b; font-size: 11px; font-style: italic; font-weight: 650; margin-left: 8px; }
    .not-quite-row button { padding: 4px 6px; font-size: 12px; }
    .not-quite-row button.selected { color: white; }
    .not-quite-row button[data-not-quite-action="Keep"].selected { background: #16a34a; border-color: #15803d; }
    .not-quite-row button[data-not-quite-action="Rename"].selected { background: #2563eb; border-color: #1d4ed8; }
    .not-quite-row button[data-not-quite-action="Redact"].selected { background: #dc2626; border-color: #b91c1c; }
    .not-quite-row button[data-not-quite-action="Ignore"].selected { background: #7c3aed; border-color: #6d28d9; }
    .not-quite-row.active { outline: 1px solid #2563eb; outline-offset: -1px; }
    .not-quite-editor { display: grid; grid-template-columns: 72px minmax(220px, 1fr) auto auto; gap: 8px; align-items: center; padding: 6px 0 8px; }
    .not-quite-editor label { margin: 0; color: #475569; font-size: 12px; }
    .selection-note { color: #64748b; font-size: 12px; font-style: italic; margin-left: 8px; }
    .finish-confirm { display: inline-flex; align-items: center; gap: 6px; color: #64748b; font-size: 12px; font-weight: 650; }
    .finish-confirm button { padding: 3px 7px; font-size: 12px; }
    .member-confidence.good { color: #15803d; }
    .member-confidence.warn { color: #b45309; }
    .member-confidence.caution { color: #b91c1c; }
    .needs-review { display: inline-flex; align-items: center; width: fit-content; border: 1px solid #f3c46b; border-radius: 999px; background: #fff7df; color: #9a4f00; font-size: 10px; font-style: normal; font-weight: 800; line-height: 1; padding: 2px 6px; margin-left: 6px; white-space: nowrap; }
    .ambiguous-card { border-top: 1px solid #eef2f6; padding: 7px 0; min-width: 0; }
    .ambiguous-card.decision-keep { background: #f1fbf3; border-color: #cfe9d4; }
    .ambiguous-card.decision-rename { background: #eff7ff; border-color: #c9e0f7; }
    .ambiguous-card.decision-redact { background: #fff1f3; border-color: #f2cbd2; }
    .ambiguous-card.decision-ignore { background: #f3f1fb; border-color: #d9d4ee; }
    .ambiguous-card.decision-review, .ambiguous-card.decision-wrong-match { background: #f3f1fb; border-color: #d9d4ee; }
    .ambiguous-card.active { outline: 2px solid #2563eb; outline-offset: -2px; }
    .ambiguous-row { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr) minmax(260px, 345px); gap: 10px; align-items: center; min-height: 34px; min-width: 0; }
    .ambiguous-name { font-weight: 800; color: #1f2937; overflow-wrap: anywhere; }
    .ambiguous-options { color: #475569; font-size: 12px; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .ambiguous-actions { display: flex; gap: 4px; justify-content: flex-end; flex-wrap: wrap; min-width: 0; }
    .ambiguous-actions button { padding: 4px 6px; font-size: 12px; }
    .ambiguous-actions button.selected { color: white; }
    .ambiguous-actions button.action-keep.selected { background: #16a34a; border-color: #15803d; }
    .ambiguous-actions button.action-rename.selected { background: #2563eb; border-color: #1d4ed8; }
    .ambiguous-actions button.action-redact.selected { background: #dc2626; border-color: #b91c1c; }
    .ambiguous-actions button.action-ignore.selected { background: #7c3aed; border-color: #6d28d9; }
    .ambiguous-actions button.action-review.selected, .ambiguous-actions button.action-wrong-match.selected { background: #7c3aed; border-color: #6d28d9; }
    .context-window { margin: 4px 0 6px 32px; padding: 6px 8px; background: #f8fafc; border: 1px solid #e2e8f0; color: #334155; font-size: 12px; }
    .context-window mark { background: #fde68a; padding: 0 2px; }
    .review-table { background: transparent; max-width: 100%; overflow-x: hidden; }
    .review-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 7px; max-width: 100%; }
    .candidate-cell { min-height: 42px; border: 1px solid #d8e0ea; border-radius: 7px; background: white; color: #1f2937; padding: 7px 9px; text-align: left; display: flex; align-items: center; justify-content: space-between; gap: 7px; line-height: 1.15; }
    .candidate-cell:hover { border-color: #aebbd0; background: #fbfdff; }
    .candidate-cell:focus-visible, .candidate-cell.active { outline: 2px solid #2563eb; outline-offset: 1px; }
    .candidate-cell .candidate-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 750; }
    .candidate-cell .candidate-count { flex: 0 0 auto; color: #64748b; font-weight: 800; }
    .candidate-cell.status-unlikely { background: #f8f5ff; border-color: #ded8f2; color: #334155; }
    .candidate-cell.status-unlikely .candidate-name { font-weight: 650; }
    .candidate-cell.status-resolved { background: #edf8f1; border-color: #c9e9d2; color: #22543d; }
    .candidate-cell.status-resolved .candidate-name::before { content: "✓ "; font-weight: 900; color: #16a34a; }
    .candidate-cell.status-to-review { background: #fff; }
    .candidate-cell.pending-change { box-shadow: inset 0 0 0 2px rgba(37, 99, 235, .2); }
    .candidate-cell.pending-change .candidate-count::after { content: " changed"; margin-left: 4px; color: #2563eb; font-size: 10px; font-weight: 750; }
    .candidate-cell[aria-pressed="true"] { box-shadow: inset 0 0 0 1px rgba(22, 163, 74, .18); }
    .candidate-cell.pending-change[aria-pressed="true"] { box-shadow: inset 0 0 0 2px rgba(37, 99, 235, .2), inset 0 0 0 1px rgba(22, 163, 74, .18); }
    .candidate-cell-expanded { grid-column: 1 / -1; display: block; text-align: left; align-items: initial; justify-content: initial; min-height: 0; }
    .candidate-detail-panel { border: 1px solid #d8e0ea; border-radius: 7px; background: #fbfdff; padding: 10px; color: #334155; }
    .candidate-cell-expanded.candidate-detail-panel:hover { background: #fbfdff; }
    .candidate-detail-panel[hidden] { display: none; }
    .candidate-detail-head { display: flex; justify-content: space-between; gap: 10px; align-items: center; margin-bottom: 8px; }
    .candidate-detail-head strong { color: #1f2937; font-size: 16px; }
    .candidate-detail-titleline { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
    .candidate-detail-badges { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
    .detail-badge { display: inline-flex; align-items: center; gap: 4px; min-height: 22px; border: 1px solid #d8e0ea; border-radius: 999px; padding: 2px 8px; background: white; color: #334155; font-size: 12px; font-weight: 750; white-space: nowrap; }
    .detail-badge.likelihood.good { border-color: #bbf7d0; background: #ecfdf5; color: #15803d; }
    .detail-badge.likelihood.warn { border-color: #fed7aa; background: #fff7ed; color: #b45309; }
    .detail-badge.likelihood.caution { border-color: #fecaca; background: #fef2f2; color: #b91c1c; }
    .likelihood-dot { width: 7px; height: 7px; border-radius: 999px; background: currentColor; opacity: .8; }
    .candidate-standard-summary { margin: 8px 0 10px; max-width: 920px; color: #334155; font-size: 14px; line-height: 1.4; }
    .candidate-standard-section { margin-top: 8px; }
    .candidate-top-occurrences { margin-top: 8px; }
    .candidate-top-occurrences summary, .candidate-expert-view summary { cursor: pointer; color: #475569; font-weight: 800; }
    .occurrence-block-list { margin-top: 6px; display: grid; gap: 5px; }
    .occurrence-block { border: 1px solid #e2e8f0; border-radius: 7px; background: #fff; }
    .occurrence-block summary { padding: 6px 8px; color: #334155; font-weight: 750; }
    .occurrence-block-title { color: #1f2937; }
    .occurrence-block-meta { color: #64748b; font-size: 12px; font-weight: 650; margin-left: 6px; }
    .occurrence-block-items { padding: 0 8px 6px 18px; }
    .candidate-expert-view { margin-top: 10px; border-top: 1px solid #e5edf6; padding-top: 8px; }
    .candidate-detail-grid { display: grid; grid-template-columns: minmax(180px, .7fr) minmax(220px, 1fr) minmax(220px, 1fr); gap: 12px; }
    .candidate-detail-panel ul { margin: 4px 0 0 18px; padding: 0; }
    .candidate-detail-panel li { margin: 2px 0; }
    .grid-header { display: grid; grid-template-columns: 22px minmax(0, 1fr) 52px 58px 72px 34px 150px; grid-column: 1 / -1; color: #64748b; font-size: 10px; font-weight: 750; line-height: 1; text-transform: uppercase; }
    .grid-header-half { display: contents; }
    .grid-header span { padding: 0 6px 2px; }
    .record { border: 1px solid #d8e0ea; background: white; }
    .record:nth-child(4n+3), .record:nth-child(4n+4) { background: #f8fafc; }
    .record.decision-keep { background: #f1fbf3; border-color: #cfe9d4; }
    .record.decision-keep:nth-child(4n+3), .record.decision-keep:nth-child(4n+4) { background: #eaf7ee; }
    .record.decision-rename { background: #eff7ff; border-color: #c9e0f7; }
    .record.decision-rename:nth-child(4n+3), .record.decision-rename:nth-child(4n+4) { background: #e8f2fd; }
    .record.decision-redact { background: #fff1f3; border-color: #f2cbd2; }
    .record.decision-redact:nth-child(4n+3), .record.decision-redact:nth-child(4n+4) { background: #fdebee; }
    .record.decision-review { background: #fff8e8; border-color: #ecd9a8; }
    .record.decision-review:nth-child(4n+3), .record.decision-review:nth-child(4n+4) { background: #fcf1d8; }
    .record.decision-wrong-match { background: #f3f1fb; border-color: #d9d4ee; }
    .record.decision-wrong-match:nth-child(4n+3), .record.decision-wrong-match:nth-child(4n+4) { background: #edeaf7; }
    .record.selected-record:not(.active) { box-shadow: inset 0 0 0 1px #cbd5e1; }
    .record.active { outline: 2px solid #2563eb; outline-offset: -2px; box-shadow: inset 3px 0 0 #2563eb; }
    .row { display: grid; grid-template-columns: 22px minmax(0, 1.9fr) 52px 58px 72px 34px 150px; align-items: center; min-height: 30px; max-width: 100%; }
    .cell { padding: 3px 6px; min-width: 0; }
    .entity { font-weight: 750; line-height: 1.2; overflow-wrap: anywhere; }
    .select-cell { display: flex; justify-content: center; }
    .select-cell input { width: 13px; height: 13px; }
    .action-status { color: #64748b; font-size: 11px; font-style: italic; line-height: 1; opacity: .72; overflow: hidden; text-overflow: ellipsis; text-align: right; white-space: nowrap; }
    .type-select { flex: 0 0 68px; width: 68px; min-width: 0; height: 24px; padding: 0 14px 0 2px; border-color: transparent; background-color: transparent; color: #334155; font-size: 13px; font-weight: 650; appearance: none; background-image: linear-gradient(45deg, transparent 50%, #64748b 50%), linear-gradient(135deg, #64748b 50%, transparent 50%); background-position: calc(100% - 8px) 10px, calc(100% - 4px) 10px; background-size: 4px 4px, 4px 4px; background-repeat: no-repeat; }
    .type-select:hover, .type-select:focus { border-color: #cbd5e1; background-color: rgba(255,255,255,.65); }
    .actions { display: flex; align-items: center; gap: 6px; flex-wrap: nowrap; padding-top: 2px; padding-bottom: 2px; }
    .choice { display: inline-flex; align-items: center; gap: 3px; white-space: nowrap; font-size: 12px; color: #2b3442; }
    .choice button { width: 22px; height: 22px; padding: 0; text-align: center; font-size: 12px; border-radius: 5px; }
    .choice.selected button { color: white; }
    .choice.action-keep.selected button { background: #16a34a; border-color: #15803d; }
    .choice.action-rename.selected button { background: #2563eb; border-color: #1d4ed8; }
    .choice.action-redact.selected button { background: #dc2626; border-color: #b91c1c; }
    .choice.action-review.selected button { background: #d97706; border-color: #b45309; }
    .choice.action-wrong-match.selected button { background: #7c3aed; border-color: #6d28d9; }
    .choice.selected span { font-weight: 750; }
    .count { color: #475569; font-size: 13px; font-weight: 700; }
    .likelihood { color: #475569; font-size: 12px; font-weight: 800; text-align: right; white-space: nowrap; }
    .likelihood.review, .likelihood.to-review { color: #15803d; }
    .likelihood.unlikely { color: #64748b; }
    .inline-editor { border-top: 1px solid #dbe3ee; background: #f7fbff; padding: 8px 10px 10px 28px; }
    .editor-grid { display: grid; grid-template-columns: 88px minmax(220px, 1fr) auto auto; align-items: center; gap: 8px; }
    .editor-grid label { margin: 0; font-size: 12px; color: #475569; }
    .editor-grid input { min-width: 0; }
    .detail { display: none; grid-column: 1 / -1; border-top: 1px solid #e3e8ef; background: #f7fbff; padding: 8px 10px 8px 18px; color: #394456; font-size: 13px; }
    .detail.expanded { display: block; }
    .detail-grid { display: grid; grid-template-columns: minmax(260px, 1fr) minmax(280px, 1fr) minmax(220px, .7fr); gap: 12px; }
    .detail-title { color: #64748b; font-size: 11px; font-weight: 750; text-transform: uppercase; margin-bottom: 3px; }
    .context { margin: 0 0 5px; }
    .downloads { display: inline-flex; align-items: center; gap: 10px; }
    .downloads a { margin-right: 0; }
    .action-toast {
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 1000;
      pointer-events: none;
      opacity: 0;
      transform: translateY(4px);
      transition: opacity 140ms ease, transform 140ms ease;
      padding: 7px 10px;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      background: rgba(15, 23, 42, 0.88);
      color: #f8fafc;
      font-size: 13px;
      font-weight: 650;
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.16);
    }
    .action-toast.visible { opacity: 1; transform: translateY(0); }
    .action-toast.warning { background: rgba(120, 53, 15, 0.9); border-color: #f59e0b; }
    .action-toast.error { background: rgba(127, 29, 29, 0.92); border-color: #fca5a5; }
    .action-toast.info { background: rgba(30, 41, 59, 0.9); border-color: #94a3b8; }
    .titlebar { display: flex; align-items: center; justify-content: space-between; gap: 12px; max-width: 100%; min-width: 0; }
    .title-left { display: flex; align-items: baseline; gap: 10px; min-width: 0; }
    .dev-controls { display: flex; align-items: center; gap: 8px; color: #64748b; font-size: 12px; }
    .dev-controls button { padding: 4px 8px; font-size: 12px; }
    @media (min-width: 1250px) {
      .queuebar { grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr); gap: 16px; }
    }
    @media (min-width: 1350px) {
      .grid-header { grid-template-columns: repeat(2, 22px minmax(0, 1.9fr) 52px 58px 72px 34px 150px); }
    }
    @media (max-width: 1550px) {
      .review-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
    }
    @media (max-width: 1000px) {
      .review-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .queue-tools { justify-self: stretch; grid-template-columns: 1fr 1fr; }
      .quality-grid { grid-template-columns: 1fr; }
      .quality-column.category { grid-column: auto; }
      .quality-nav-list.category-list { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .stagebar { grid-template-columns: 1fr 1fr; }
      .ambiguous-row { grid-template-columns: 1fr; }
      .group-row, .member-row { grid-template-columns: 24px minmax(0, 1fr); }
      .group-actions, .member-context { grid-column: 2; justify-content: flex-start; }
    }
    @media (max-width: 680px) {
      .quality-nav-list.category-list { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <header>
    <div class="titlebar">
      <div class="title-left"><h1><img class="app-logo" src="/assets/docscrub.png" alt="DocScrub" /></h1><span id="build" class="build"></span></div>
      <div class="dev-controls">
        <button id="restartApp" type="button">Restart local app</button>
        <span id="restartStatus" aria-live="polite"></span>
      </div>
    </div>
    <div class="filebar">
      <input id="file" type="file" accept=".docx" />
      <button id="scan">Scan DOCX</button>
      <button id="generate">Generate Output</button>
      <span id="status" class="hint"></span>
      <div class="downloads" id="downloads"></div>
    </div>
    <div class="summary" id="summary"></div>
  </header>
  <main>
    <div class="legend" aria-label="Keyboard shortcuts">
      <span class="legend-item"><span class="keycap">K</span> Keep</span>
      <span class="legend-item"><span class="keycap">N</span> Rename</span>
      <span class="legend-item"><span class="keycap">R</span> Redact</span>
      <span class="legend-item"><span class="keycap">I</span> Ignore</span>
      <span class="legend-item"><span class="keycap">Q</span> Not Quite</span>
      <span class="legend-note">Arrow keys move. Enter expands context.</span>
    </div>
    <details class="rules-panel" id="rulesPanel">
      <summary><span class="rules-summary">Redaction Rules <label class="advanced-toggle"><input id="advancedRules" type="checkbox" /> Advanced</label></span></summary>
      <div id="rulesGrid" class="rules-grid"></div>
    </details>
    <div id="groupCommandBar" class="command-bar" aria-live="polite" aria-hidden="true">
      <span class="command-icon">⌨</span>
      <span id="groupCommandItems" class="command-items"></span>
    </div>
    <details class="entity-resolution" id="ambiguousResolution" open>
      <summary>Ambiguity Check <span id="ambiguousResolutionSummary" class="hint"></span></summary>
      <div class="stagebar">
        <div><label for="amSearch">Search</label><input id="amSearch" type="search" placeholder="Filter ambiguous matches" /></div>
        <div><label for="amTypeFilter">Type</label><select id="amTypeFilter"></select></div>
        <div><label for="amSort">Sort</label><select id="amSort"><option value="count">Count</option><option value="text">Item</option><option value="matches">Possible Matches</option></select></div>
        <div><label for="amDirection">Order</label><select id="amDirection"><option value="desc">Desc</option><option value="asc">Asc</option></select></div>
        <div><label for="amPageSize">Rows</label><select id="amPageSize"><option value="10">10</option><option value="25" selected>25</option><option value="50">50</option><option value="100">100</option></select></div>
        <div class="stage-pager" id="amPager"></div>
      </div>
      <div id="ambiguousMatches" class="group-list"></div>
    </details>
    <details class="entity-resolution" id="entityResolution" open>
      <summary><span class="stage-summary"><span class="stage-title">Group Check <span id="entityResolutionSummary" class="hint"></span></span><span class="stage-title-controls"><button id="finishEntityResolution" class="done-editing" type="button">Done Editing</button><span id="finishEntityResolutionConfirm" class="finish-confirm" hidden>Are you sure? <button id="finishEntityResolutionYes" type="button">Y</button><button id="finishEntityResolutionNo" type="button">N</button></span></span></span></summary>
      <div class="stagebar">
        <div><label for="erSearch">Search</label><input id="erSearch" type="search" placeholder="Filter groups" /></div>
        <div><label for="erTypeFilter">Type</label><select id="erTypeFilter"></select></div>
        <div><label for="erSort">Sort</label><select id="erSort"><option value="count">Count</option><option value="name">Item</option><option value="variants">Variants</option><option value="confidence">Confidence</option><option value="needs_review">Needs Attention</option></select></div>
        <div><label for="erDirection">Order</label><select id="erDirection"><option value="desc">Desc</option><option value="asc">Asc</option></select></div>
        <div><label for="erPageSize">Rows</label><select id="erPageSize"><option value="10">10</option><option value="25" selected>25</option><option value="50">50</option><option value="100">100</option></select></div>
        <div class="stage-pager" id="erPager"></div>
      </div>
      <div id="entityGroups" class="group-list"></div>
    </details>
    <details class="quality-panel" id="qualityPanel">
      <summary>Category Check <span id="qualitySummary" class="hint"></span></summary>
      <div id="qualityGrid" class="quality-grid"></div>
    </details>
    <section class="review-section">
      <div class="results-title-row">
        <div class="section-title">Results</div>
        <div class="results-title-controls">
          <button id="acceptResultChanges" class="accept-results" type="button" disabled>Accept changes</button>
          <span id="acceptResultChangesConfirm" class="accept-results-confirm" hidden>Confirm? <button id="acceptResultChangesYes" type="button">Y</button><button id="acceptResultChangesNo" type="button">N</button></span>
        </div>
      </div>
      <div id="candidateResultsSummary" class="results-summary"></div>
      <div class="queuebar">
        <div>
          <div class="tabs" id="confidenceTabs"></div>
          <div class="pager" id="pager"></div>
        </div>
        <div class="queue-tools">
          <div><label for="search">Search</label><input id="search" type="search" placeholder="Filter candidates" /></div>
          <div><label for="typeFilter">Type</label><select id="typeFilter"></select></div>
          <div><label for="sort">Sort</label><select id="sort"><option value="likelihood" selected>Likelihood</option><option value="count">Count</option><option value="text">Entity</option><option value="type">Type</option><option value="decision">Action</option></select></div>
          <div><label for="direction">Order</label><select id="direction"><option value="desc">Desc</option><option value="asc">Asc</option></select></div>
          <div><label for="pageSize">Rows</label><select id="pageSize"><option value="25">25</option><option value="50" selected>50</option><option value="100">100</option><option value="250">250</option></select></div>
        </div>
      </div>
      <div class="bulkbar">
        <label><input id="selectVisible" type="checkbox" /> Select visible</label>
        <span id="selectedCount">0 selected</span>
        <span>Bulk Action:</span>
        <select id="bulkAction">
          <option value="Keep">Keep</option>
          <option value="Rename">Rename</option>
          <option value="Redact">Redact</option>
          <option value="Ignore">Ignore</option>
        </select>
        <input id="bulkReplacement" type="text" placeholder="Replacement for selected" disabled />
        <button id="applyBulk" type="button">Apply to Selected</button>
        <button id="clearSelection" type="button">Clear Selection</button>
      </div>
      <div class="review-table">
        <div id="rows" class="review-grid">
          <div class="grid-header">
            <div class="grid-header-half"><span></span><span>Entity</span><span>Type</span><span>#</span><span>Action</span></div>
            <div class="grid-header-half"><span></span><span>Entity</span><span>Type</span><span>#</span><span>Action</span></div>
          </div>
        </div>
      </div>
    </section>
  </main>
  <div id="actionToast" class="action-toast" role="status" aria-live="polite" aria-atomic="true" hidden></div>
<script>
const actions = ["Keep", "Rename", "Redact", "Ignore"];
const labels = {
  Keep: { key: "K", word: "Keep" },
  Rename: { key: "N", word: "Rename" },
  Redact: { key: "R", word: "Redact" },
  Ignore: { key: "I", word: "Ignore" },
  Review: { key: "I", word: "Ignore" },
  "Wrong Match": { key: "I", word: "Ignore" },
  Skip: { key: "I", word: "Ignore" },
  "Not Quite": { key: "Q", word: "Not Quite" },
  Mixed: { key: "", word: "Mixed" }
};
const keyToAction = { k: "Keep", n: "Rename", r: "Redact", i: "Ignore" };
const GROUP_ROW_KEY = "__group__";
let app = { candidates: [], counts: {}, build: "", replacement_rules: {} };
let activeKey = null;
let expanded = new Set();
let page = 0;
let erPage = 0;
let amPage = 0;
let confidenceTab = "to_review";
let selectedKeys = new Set();
let editor = null;
let ruleSaveTimers = {};
let expandedGroups = new Set();
let groupContext = {};
let groupUnchecked = {};
let groupEditor = null;
let groupEditorDrafts = {};
let activeGroupId = null;
let groupActiveMember = {};
let groupMemberControlIndex = {};
let notQuiteGroups = new Set();
let notQuiteRemaining = {};
let notQuiteEditor = null;
let notQuiteEditorDrafts = {};
let notQuiteActiveMember = {};
let notQuiteControlIndex = {};
let ambiguousContext = {};
let activeAmbiguousKey = null;
let ambiguousEditor = null;
let ambiguousEditorDrafts = {};
let finishEntityResolutionConfirmOpen = false;
let commandBarHideTimer = null;
let groupCheckKeyboardArmed = false;
let activeQualityMetric = null;
let activeQualityButton = null;
let qualityDetailCache = {};
let qualityNavigator = { reviewState: "to_review", category: "__all__", context: "__all__", categorySort: "frequency_desc", showEmptyCategories: false };
let qualityResultSetSignature = null;
let qualityResultSetKeys = [];
let qualityPendingChangeKeys = new Set();
let acceptResultChangesConfirmOpen = false;
let actionToastTimer = null;
let actionToastHideTimer = null;

const qualityRuleLabels = {
  all_common_dictionary_words: "All common dictionary words",
  address_suffix: "Address suffix",
  administrative_phrase: "Administrative phrase",
  abbreviation: "Abbreviation",
  ambiguous_lexical_token: "Ambiguous lexical token",
  calendar_abbreviation: "Calendar abbreviation",
  calendar_term: "Calendar term",
  common_abbreviation: "Common abbreviation",
  common_english_word: "Common English word",
  common_verb: "Common verb",
  contraction: "Contraction",
  department_organization: "Department / organization",
  document_structure_term: "Document structure term",
  expanded_common_language_token: "Expanded common language token",
  greeting_or_courtesy: "Greeting or courtesy",
  honorific_title: "Honorific / title",
  interjection_casual: "Interjection / casual expression",
  implausible_capitalization: "Implausible capitalization",
  institution_acronym: "Institution acronym",
  institution_term: "Institution term",
  known_first_name: "Known first name",
  known_surname: "Known surname",
  legal_administrative_term: "Legal / administrative term",
  likely_acronym: "Likely acronym",
  ocr_artifact: "OCR artifact",
  organization_suffix: "Organization suffix",
  professional_credential: "Professional credential",
  product_system_name: "Product / system name",
  pronoun_or_determiner: "Pronoun or determiner",
  season_or_academic_term: "Season or academic term",
  sentence_fragment: "Sentence fragment",
  sentence_fragment_word: "Sentence fragment word",
  too_short_single_token: "Too-short single token",
  unknown_capitalized_token: "Unknown capitalized token",
  unknown_lowercase_token: "Unknown lowercase token",
  unknown_token: "Unknown token"
};
const qualityRuleOrder = Object.keys(qualityRuleLabels);

function qualityRuleLabel(rule) {
  return qualityRuleLabels[rule] || String(rule || "").replaceAll("_", " ").replace(/\b\w/g, char => char.toUpperCase());
}

const reviewStateLabels = {
  total: "Total",
  resolved: "Resolved",
  unlikely: "Unlikely",
  to_review: "To Review"
};

function qualityCandidatePool() {
  return app.quality_candidates || app.candidates || [];
}

function candidateQualityStatus(candidate) {
  if (candidate.review_stage === "group_check" && candidate.review_status === "resolved") return "resolved";
  if (candidate.review_status === "resolved") return "resolved";
  if (candidate.quality_status === "Resolved") return "resolved";
  if (candidate.quality_status === "Unlikely" || candidate.quality === "Unlikely") return "unlikely";
  return "to_review";
}

function qualityRulesForCandidate(candidate) {
  return [...new Set([...(candidate.quality_filter_rules || []), ...(candidate.quality_reasons || [])])].filter(Boolean);
}

function candidateMatchesReviewState(candidate, reviewState = qualityNavigator.reviewState) {
  return reviewState === "total" || candidateQualityStatus(candidate) === reviewState;
}

function candidateMatchesCategory(candidate, category = qualityNavigator.category) {
  return category === "__all__" || qualityRulesForCandidate(candidate).includes(category);
}

function acronymShape(candidate) {
  const text = String(candidate.text || "").trim();
  if (/^(?:[A-Z]\.){2,}$/.test(text)) return "contains_periods";
  if (/^[A-Z]{2,10}$/.test(text)) return "all_caps";
  if (/[A-Z]{2,}[-/][A-Z0-9]+/.test(text)) return "contains_punctuation";
  return "";
}

function sentencePosition(candidate) {
  const text = String(candidate.text || "").trim();
  const context = String((candidate.contexts || [])[0] || "");
  const index = context.indexOf(text);
  if (index <= 0) return "sentence_initial";
  const before = context.slice(Math.max(0, index - 3), index);
  return /[.!?]\s*$/.test(before) ? "sentence_initial" : "mid_sentence";
}

function contextOptionsForCategory(category) {
  if (category === "__all__") return [{ key: "__all__", label: "Show All", test: () => true }];
  const generic = [
    { key: "__all__", label: "Show All", test: () => true },
    { key: "single_occurrence", label: "Single Occurrence", test: c => (c.count || 0) <= 1 },
    { key: "multiple_occurrences", label: "Multiple Occurrences", test: c => (c.count || 0) > 1 },
    { key: "high_likelihood", label: "High Likelihood", test: c => (c.likelihood || c.candidate_score || 0) >= 75 }
  ];
  if (category === "likely_acronym") {
    return [
      { key: "__all__", label: "Show All", test: () => true },
      { key: "all_caps", label: "All Caps", test: c => acronymShape(c) === "all_caps" },
      { key: "contains_periods", label: "Contains Periods", test: c => acronymShape(c) === "contains_periods" },
      { key: "institution_context", label: "Institution Context", test: c => qualityRulesForCandidate(c).some(rule => rule.includes("institution")) },
      { key: "repeated", label: "Repeated", test: c => (c.count || 0) > 1 }
    ];
  }
  if (category === "unknown_capitalized_token") {
    return [
      { key: "__all__", label: "Show All", test: () => true },
      { key: "single_occurrence", label: "Single Occurrence", test: c => (c.count || 0) <= 1 },
      { key: "multiple_occurrences", label: "Multiple Occurrences", test: c => (c.count || 0) > 1 },
      { key: "sentence_initial", label: "Sentence Initial", test: c => sentencePosition(c) === "sentence_initial" },
      { key: "mid_sentence", label: "Mid-Sentence", test: c => sentencePosition(c) === "mid_sentence" },
      { key: "high_likelihood", label: "High Likelihood", test: c => (c.likelihood || c.candidate_score || 0) >= 75 }
    ];
  }
  return generic;
}

function candidateMatchesContext(candidate, context = qualityNavigator.context, category = qualityNavigator.category) {
  if (context === "__all__" || category === "__all__") return true;
  const option = contextOptionsForCategory(category).find(item => item.key === context);
  return option ? option.test(candidate) : true;
}

function qualityResultSignature() {
  return JSON.stringify({
    reviewState: qualityNavigator.reviewState,
    category: qualityNavigator.category,
    context: qualityNavigator.context
  });
}

function resetQualityResultSet() {
  qualityResultSetSignature = null;
  qualityResultSetKeys = [];
}

function clearQualityPendingChanges() {
  qualityPendingChangeKeys.clear();
  acceptResultChangesConfirmOpen = false;
}

function updateAcceptResultChangesControls() {
  const button = $("acceptResultChanges");
  const confirm = $("acceptResultChangesConfirm");
  if (!button || !confirm) return;
  const count = qualityPendingChangeKeys.size;
  button.disabled = count === 0;
  button.classList.toggle("has-changes", count > 0);
  button.textContent = count ? `Accept changes (${count})` : "Accept changes";
  confirm.hidden = !acceptResultChangesConfirmOpen || count === 0;
}

function acceptQualityResultChanges() {
  resetQualityResultSet();
  clearQualityPendingChanges();
  page = 0;
  activeKey = null;
  selectedKeys.clear();
  renderCandidateQualityPanel();
  renderRows();
  status("Changes accepted. Results recategorized.");
  acknowledgeAction("Accept changes");
}

function qualityResultSetCandidates() {
  const signature = qualityResultSignature();
  const pool = qualityCandidatePool();
  const strictRows = pool.filter(candidate =>
    candidateMatchesReviewState(candidate) &&
    candidateMatchesCategory(candidate) &&
    candidateMatchesContext(candidate)
  );
  if (qualityResultSetSignature !== signature) {
    qualityResultSetSignature = signature;
    qualityResultSetKeys = strictRows.map(candidate => candidate.key);
  }
  const stickyKeys = new Set(qualityResultSetKeys);
  return pool.filter(candidate =>
    stickyKeys.has(candidate.key) &&
    candidateMatchesCategory(candidate) &&
    candidateMatchesContext(candidate)
  );
}

function qualityNavigatorRows() {
  const pool = qualityCandidatePool();
  const stateRows = ["total", "resolved", "unlikely", "to_review"].map(key => ({
    key,
    label: reviewStateLabels[key],
    count: pool.filter(candidate => candidateMatchesReviewState(candidate, key)).length
  }));
  const statePool = pool.filter(candidate => candidateMatchesReviewState(candidate));
  const dynamicRuleOrder = [
    ...qualityRuleOrder,
    ...[...new Set(statePool.flatMap(qualityRulesForCandidate))]
      .filter(rule => !qualityRuleOrder.includes(rule))
      .sort()
  ];
  let categoryRows = [
    { key: "__all__", label: "Show All", count: statePool.length },
    ...dynamicRuleOrder.map(rule => ({
      key: rule,
      label: qualityRuleLabel(rule),
      count: statePool.filter(candidate => qualityRulesForCandidate(candidate).includes(rule)).length
    }))
  ];
  const showAllCategory = categoryRows[0];
  const sortedCategoryRows = categoryRows.slice(1).sort((a, b) => {
    if (qualityNavigator.categorySort === "az") return a.label.localeCompare(b.label);
    if (qualityNavigator.categorySort === "frequency_asc") return (a.count - b.count) || a.label.localeCompare(b.label);
    return (b.count - a.count) || a.label.localeCompare(b.label);
  });
  categoryRows = [showAllCategory, ...sortedCategoryRows];
  const categoryPool = statePool.filter(candidate => candidateMatchesCategory(candidate));
  const contextRows = contextOptionsForCategory(qualityNavigator.category).map(option => ({
    key: option.key,
    label: option.label,
    count: categoryPool.filter(option.test).length
  }));
  return { stateRows, categoryRows, contextRows };
}

function filteredQualityCandidates() {
  return qualityResultSetCandidates();
}

function qualityPathLabel() {
  const parts = [reviewStateLabels[qualityNavigator.reviewState] || "Total"];
  parts.push(qualityNavigator.category === "__all__" ? "Show All" : qualityRuleLabel(qualityNavigator.category));
  if (qualityNavigator.category !== "__all__") {
    const context = contextOptionsForCategory(qualityNavigator.category).find(item => item.key === qualityNavigator.context);
    parts.push(context?.label || "Show All");
  }
  return parts.join(" / ");
}

const $ = (id) => document.getElementById(id);

function status(text) { $("status").textContent = text || ""; }

function showActionToast(action, options = {}) {
  const toast = $("actionToast");
  if (!toast || !action) return;
  const type = options.type || "success";
  const prefix = options.prefix || "Applied";
  window.clearTimeout(actionToastTimer);
  window.clearTimeout(actionToastHideTimer);
  toast.textContent = `${prefix} — ${action}`;
  toast.className = `action-toast${type === "success" ? "" : ` ${type}`}`;
  toast.hidden = false;
  window.requestAnimationFrame(() => toast.classList.add("visible"));
  actionToastTimer = window.setTimeout(() => {
    toast.classList.remove("visible");
    actionToastHideTimer = window.setTimeout(() => {
      toast.hidden = true;
    }, 180);
  }, 1300);
}

function acknowledgeAction(action) {
  showActionToast(action, { type: "success" });
}

function commandKey(label) {
  return `<span class="keycap">${escapeHtml(label)}</span>`;
}

function commandItem(keys, text) {
  return `<span class="command-item">${commandKey(keys)} ${escapeHtml(text)}</span>`;
}

function commandBarContextForElement(element) {
  if (!element || !element.closest) return null;
  const entityGroups = $("entityGroups");
  if (!entityGroups || !entityGroups.contains(element)) return null;
  const card = element.closest(".group-card");
  if (card?.querySelector("[data-group-editor], .not-quite-editor")) return "inline-editor";
  if (element.closest("[data-group-editor], .not-quite-editor")) return "inline-editor";
  if (element.closest(".group-actions")) return "actions";
  if (element.closest(".member-row, .not-quite-row")) return "members";
  if (element.closest(".group-row")) {
    return card?.classList.contains("expanded") ? "group-row-open" : "collapsed";
  }
  if (element.closest(".group-card")) return "collapsed";
  return null;
}

function commandItemsForContext(context) {
  if (context === "actions") {
    return [
      commandItem("←→", "Choose Action"),
      commandItem("Enter", "Accept"),
      commandItem("Esc", "Return to Group")
    ];
  }
  if (context === "inline-editor") {
    return [
      commandItem("←→", "Move Field"),
      commandItem("↑↓", "Move Field"),
      commandItem("A", "Accept"),
      commandItem("Enter", "Accept"),
      commandItem("Esc", "Cancel")
    ];
  }
  if (context === "group-row-open") {
    return [
      commandItem("↑↓", "Navigate Rows"),
      commandItem("←→", "Row Controls"),
      commandItem("Space", "Close Group"),
      commandItem("Enter", "Close Group"),
      commandItem("Tab", "Next Item"),
      commandItem("Shift+Tab", "Previous Item"),
      commandItem("Esc", "Close Group")
    ];
  }
  if (context === "members") {
    return [
      commandItem("↑↓", "Navigate Rows"),
      commandItem("←→", "Row Controls"),
      commandItem("Space", "Select / Deselect"),
      commandItem("Tab", "Next Item"),
      commandItem("Shift+Tab", "Previous Item"),
      commandItem("Enter", "Activate"),
      commandItem("Esc", "Close Group")
    ];
  }
  if (context === "collapsed") {
    return [
      commandItem("↑↓", "Navigate Groups"),
      commandItem("←→", "Row Controls"),
      commandItem("Space", "Open / Close"),
      commandItem("Enter", "Open / Close"),
      commandItem("Tab", "Next Item"),
      commandItem("Shift+Tab", "Previous Item")
    ];
  }
  return [];
}

function updateGroupCommandBar(element = document.activeElement) {
  const bar = $("groupCommandBar");
  const items = $("groupCommandItems");
  if (!bar || !items) return;
  window.clearTimeout(commandBarHideTimer);
  const context = commandBarContextForElement(element);
  const commands = commandItemsForContext(context);
  if (!commands.length) {
    bar.classList.remove("visible");
    bar.setAttribute("aria-hidden", "true");
    return;
  }
  items.innerHTML = commands.join("");
  bar.classList.add("visible");
  bar.setAttribute("aria-hidden", "false");
}

async function api(path, options = {}) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

function visibleCandidates() {
  const q = $("search").value.trim().toLowerCase();
  const type = $("typeFilter").value;
  const sort = $("sort").value;
  const dir = $("direction").value === "desc" ? -1 : 1;
  let rows = filteredQualityCandidates().filter(c =>
    (!q || c.text.toLowerCase().includes(q)) &&
    (!type || c.type === type)
  );
  rows.sort((a, b) => {
    if (sort === "likelihood") return dir * ((a.likelihood || 0) - (b.likelihood || 0)) || ((b.count || 0) - (a.count || 0)) || a.text.localeCompare(b.text);
    if (sort === "count") return dir * (a.count - b.count);
    if (sort === "type") return dir * a.type.localeCompare(b.type);
    if (sort === "decision") return dir * a.decision.localeCompare(b.decision);
    if (sort === "source") return dir * a.source.localeCompare(b.source);
    if (sort === "confidence") return dir * a.confidence.localeCompare(b.confidence);
    return dir * a.text.localeCompare(b.text);
  });
  return rows;
}

function nextUndecidedAfter(rows, key) {
  const idx = Math.max(0, rows.findIndex(r => r.key === key));
  for (let i = idx + 1; i < rows.length; i++) if (rows[i].decision === "Undecided") return rows[i].key;
  for (let i = idx - 1; i >= 0; i--) if (rows[i].decision === "Undecided") return rows[i].key;
  return rows[idx]?.key || null;
}

function pageSize() {
  return Number($("pageSize").value || 50);
}

function clampPage(rows) {
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize()));
  page = Math.max(0, Math.min(page, totalPages - 1));
}

function pageForKey(rows, key) {
  const index = rows.findIndex(r => r.key === key);
  return index < 0 ? page : Math.floor(index / pageSize());
}

function setActive(key, scroll = false) {
  if (editor && editor.key !== key && !closeEditorWithConfirm()) return;
  const rows = visibleCandidates();
  if (!rows.length) { activeKey = null; return; }
  const keepDetailOpen = expanded.size > 0;
  activeKey = rows.some(r => r.key === key) ? key : (rows.find(r => r.decision === "Undecided") || rows[0]).key;
  if (keepDetailOpen) {
    expanded.clear();
    expanded.add(activeKey);
  }
  page = pageForKey(rows, activeKey);
  renderRows();
  if (scroll) window.setTimeout(() => {
    const cell = document.querySelector(`.candidate-cell[data-key="${CSS.escape(activeKey)}"]`);
    cell?.scrollIntoView({ block: "nearest" });
    cell?.focus();
  }, 0);
}

function markActiveCandidateCell(cell) {
  if (!cell) return;
  activeKey = cell.dataset.key;
  document.querySelectorAll(".candidate-cell").forEach(item => item.classList.toggle("active", item.dataset.key === activeKey));
}

function preserveDetailForActiveCandidate() {
  if (!activeKey || !expanded.size) return;
  expanded.clear();
  expanded.add(activeKey);
}

function activeCandidate() {
  return visibleCandidates().find(candidate => candidate.key === activeKey) || null;
}

function toggleCandidateDetail(key) {
  const rows = visibleCandidates();
  if (!rows.some(candidate => candidate.key === key)) return false;
  activeGroupId = null;
  groupCheckKeyboardArmed = false;
  activeKey = key;
  if (expanded.has(activeKey)) {
    expanded.delete(activeKey);
  } else {
    expanded.clear();
    expanded.add(activeKey);
  }
  const willOpen = expanded.has(activeKey);
  renderRows();
  window.setTimeout(() => {
    const cell = document.querySelector(`.candidate-cell[data-key="${CSS.escape(activeKey)}"]`);
    cell?.focus();
    if (willOpen) {
      document.querySelector(`.candidate-detail-panel[data-candidate-detail-for="${CSS.escape(activeKey)}"]`)?.scrollIntoView({ block: "nearest" });
      status("Detail opened.");
    } else {
      status("Detail closed.");
    }
  }, 0);
  return true;
}

function candidateGridColumnCount() {
  if (expanded.size) return 1;
  const cells = [...document.querySelectorAll(".candidate-cell")];
  if (cells.length <= 1) return 1;
  const firstTop = cells[0].offsetTop;
  return Math.max(1, cells.filter(cell => cell.offsetTop === firstTop).length);
}

function resultGridHasKeyboardFocus(event) {
  if (isEditableTextTarget(event.target)) return false;
  if (event.target.closest?.("#entityGroups, #ambiguousMatches, #qualityGrid")) return false;
  return Boolean(event.target.closest?.("#rows") || document.activeElement?.closest?.("#rows"));
}

function focusActiveResultCell() {
  window.setTimeout(() => {
    document.querySelector(`.candidate-cell[data-key="${CSS.escape(activeKey || "")}"]`)?.focus();
  }, 0);
}

function moveActiveResult(delta, scroll = true) {
  const rows = visibleCandidates();
  if (!rows.length) return false;
  const idx = Math.max(0, rows.findIndex(row => row.key === activeKey));
  const next = rows[Math.max(0, Math.min(rows.length - 1, idx + delta))];
  if (!next) return false;
  setActive(next.key, scroll);
  return true;
}

function tabMoveActiveResult(delta) {
  if (editor) editor = null;
  return moveActiveResult(delta, true);
}

function reviewActionForEvent(event) {
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null;
  const key = event.key.toLowerCase();
  return { k: "Keep", n: "Rename", r: "Redact", i: "Ignore" }[key] || null;
}

function categoryNavButtons() {
  return [...document.querySelectorAll('[data-quality-nav="category"]')];
}

function qualityCategoryColumnCount() {
  const buttons = categoryNavButtons();
  if (buttons.length <= 1) return 1;
  const firstTop = buttons[0].offsetTop;
  return Math.max(1, buttons.filter(button => button.offsetTop === firstTop).length);
}

function navigateQualityCategory(key) {
  const buttons = categoryNavButtons();
  if (!buttons.length) return false;
  const current = buttons.findIndex(button => button.dataset.qualityKey === qualityNavigator.category);
  const idx = current >= 0 ? current : 0;
  const columns = qualityCategoryColumnCount();
  const delta = {
    ArrowRight: 1,
    ArrowLeft: -1,
    ArrowDown: columns,
    ArrowUp: -columns
  }[key];
  if (!delta) return false;
  const next = buttons[Math.max(0, Math.min(buttons.length - 1, idx + delta))];
  if (!next) return false;
  next.click();
  window.setTimeout(() => next.focus(), 0);
  return true;
}

function setCandidateDetailSections(open) {
  if (!activeKey) return false;
  if (!activeKey || !expanded.has(activeKey)) {
    if (!open) return false;
    expanded.clear();
    expanded.add(activeKey);
    renderRows();
  }
  const panel = document.querySelector(`.candidate-detail-panel[data-key="${CSS.escape(activeKey || "")}"]`);
  if (!panel) return false;
  panel.querySelectorAll("details").forEach(detail => { detail.open = open; });
  panel.focus();
  return true;
}

function focusReplacement(key) {
  window.setTimeout(() => {
    const input = document.querySelector(`.candidate-cell[data-key="${CSS.escape(key)}"] [data-kind="rename-editor"]`);
    if (!input || input.disabled) return;
    input.focus();
    input.select();
  }, 0);
}

function renderTypeFilter() {
  const current = $("typeFilter").value;
  const types = [...new Set(qualityCandidatePool().map(c => c.type))].sort();
  $("typeFilter").innerHTML = `<option value="">All</option>` + types.map(t => `<option value="${t}">${t}</option>`).join("");
  $("typeFilter").value = types.includes(current) ? current : "";
}

function renderSimpleTypeFilter(selectId, values) {
  const select = $(selectId);
  const current = select.value;
  const types = [...new Set(values.filter(Boolean))].sort();
  select.innerHTML = `<option value="">All</option>` + types.map(t => `<option value="${escapeAttr(t)}">${escapeHtml(t)}</option>`).join("");
  select.value = types.includes(current) ? current : "";
}

function stagePageSize(selectId) {
  return Number($(selectId).value || 25);
}

function renderStagePager(containerId, rows, currentPage, pageSizeSelectId) {
  const size = stagePageSize(pageSizeSelectId);
  const totalPages = Math.max(1, Math.ceil(rows.length / size));
  const pageIndex = Math.max(0, Math.min(currentPage, totalPages - 1));
  const start = rows.length ? pageIndex * size + 1 : 0;
  const end = Math.min(rows.length, (pageIndex + 1) * size);
  $(containerId).innerHTML = `
    <button type="button" data-stage-page="prev" ${pageIndex === 0 ? "disabled" : ""}>Prev</button>
    <button type="button" data-stage-page="next" ${pageIndex >= totalPages - 1 ? "disabled" : ""}>Next</button>
    <span>${start}-${end} of ${rows.length}</span>
  `;
  return pageIndex;
}

function visibleEntityGroups() {
  const q = $("erSearch").value.trim().toLowerCase();
  const type = $("erTypeFilter").value;
  const sort = $("erSort").value;
  const dir = $("erDirection").value === "desc" ? -1 : 1;
  const rows = (app.entity_groups || []).filter(group => {
    const memberText = (group.members || []).map(member => member.text).join(" ");
    return (!q || `${group.canonical_name} ${memberText}`.toLowerCase().includes(q)) &&
      (!type || group.type === type);
  });
  rows.sort((a, b) => {
    if (sort === "count") return dir * (a.occurrence_count - b.occurrence_count);
    if (sort === "variants") return dir * (a.variant_count - b.variant_count);
    if (sort === "confidence") return dir * (dynamicGroupConfidence(a) - dynamicGroupConfidence(b));
    if (sort === "needs_review") return dir * ((a.needs_review_count || 0) - (b.needs_review_count || 0));
    return dir * a.canonical_name.localeCompare(b.canonical_name);
  });
  return rows;
}

function visibleAmbiguousMatches() {
  const q = $("amSearch").value.trim().toLowerCase();
  const type = $("amTypeFilter").value;
  const sort = $("amSort").value;
  const dir = $("amDirection").value === "desc" ? -1 : 1;
  const rows = (app.ambiguous_matches || []).filter(match => {
    const candidate = match.candidate || {};
    const possible = (match.possible_groups || []).map(group => group.canonical_name).join(" ");
    return (!q || `${candidate.text || ""} ${possible}`.toLowerCase().includes(q)) &&
      (!type || candidate.type === type);
  });
  rows.sort((a, b) => {
    const candidateA = a.candidate || {};
    const candidateB = b.candidate || {};
    if (sort === "count") return dir * ((candidateA.count || 0) - (candidateB.count || 0));
    if (sort === "matches") return dir * ((a.possible_groups || []).length - (b.possible_groups || []).length);
    return dir * String(candidateA.text || "").localeCompare(String(candidateB.text || ""));
  });
  return rows;
}

function setActiveAmbiguous(key, scroll = false) {
  const rows = visibleAmbiguousMatches();
  if (!rows.length) {
    activeAmbiguousKey = null;
    return false;
  }
  const contextWasOpen = activeAmbiguousKey && ambiguousContext[activeAmbiguousKey];
  activeAmbiguousKey = rows.some(match => match.candidate?.key === key) ? key : rows[0].candidate?.key;
  if (contextWasOpen) {
    ambiguousContext = {};
    ambiguousContext[activeAmbiguousKey] = true;
  }
  renderAmbiguousMatches();
  if (scroll) {
    window.setTimeout(() => {
      const card = document.querySelector(`[data-ambiguous-key="${CSS.escape(activeAmbiguousKey || "")}"]`);
      card?.scrollIntoView({ block: "nearest", inline: "nearest" });
      card?.focus({ preventScroll: true });
    }, 0);
  }
  return true;
}

function moveActiveAmbiguous(delta) {
  const rows = visibleAmbiguousMatches();
  if (!rows.length) return false;
  const idx = Math.max(0, rows.findIndex(match => match.candidate?.key === activeAmbiguousKey));
  const next = rows[Math.max(0, Math.min(rows.length - 1, idx + delta))];
  return setActiveAmbiguous(next?.candidate?.key, true);
}

function tabMoveActiveAmbiguous(delta) {
  return moveActiveAmbiguous(delta);
}

function nextVisibleAmbiguousKeyAfter(key) {
  const rows = visibleAmbiguousMatches();
  if (!rows.length) return null;
  const idx = Math.max(0, rows.findIndex(match => match.candidate?.key === key));
  return rows[Math.min(rows.length - 1, idx + 1)]?.candidate?.key || rows[idx]?.candidate?.key || null;
}

async function completeAmbiguousAction(key, action) {
  const match = (app.ambiguous_matches || []).find(item => item.candidate?.key === key);
  if (!match) return;
  let replacement = "";
  if (action === "Rename") {
    replacement = window.prompt("Replacement for this candidate:", match.candidate?.rename_replacement || match.candidate?.text || "") || "";
    if (!replacement.trim()) return;
    match.candidate.replacement = replacement;
    match.candidate.rename_replacement = replacement;
  }
  match.candidate.decision = action;
  ambiguousContext[key] = false;
  const nextKey = nextVisibleAmbiguousKeyAfter(key);
  renderAmbiguousMatches();
  if (nextKey) setActiveAmbiguous(nextKey, true);
  await api("/api/ambiguous-match", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, action, replacement })
  });
  acknowledgeAction(action);
  renderRows();
}

function renderSummary() {
  $("build").textContent = app.build || "";
  $("summary").innerHTML = [
    `File: ${app.filename || "none"}`,
    `Total: ${app.counts.total || 0}`,
    `To Review: ${app.counts.to_review || 0}`,
    `Unlikely: ${app.quality_counts?.unlikely || 0}`,
    `Resolved: ${app.counts.resolved_earlier || 0}`,
    `Items in Groups: ${app.counts.candidates_in_groups || 0}`,
    `Proposed Groups: ${app.counts.groups || 0}`,
    `Ambiguous: ${app.counts.ambiguous || 0}`,
    `Standalone Items: ${app.counts.standalone_review || 0}`,
    `Category Check: ${app.normal_review_count || 0}`,
    `Evidence Buckets: ${Object.keys(app.candidate_quality_metrics?.classification_counts || {}).length}`,
    `Rename: ${app.counts.rename || 0}`,
    `Redact: ${app.counts.redact || 0}`,
    `Ignore: ${app.counts.wrong_match || 0}`,
    `Undecided: ${app.counts.undecided || 0}`
  ].map(x => `<span>${x}</span>`).join("");
}

function renderConfidenceTabs() {
  $("confidenceTabs").innerHTML = "";
}

function renderPager(rows) {
  clampPage(rows);
  const size = pageSize();
  const totalPages = Math.max(1, Math.ceil(rows.length / size));
  const start = rows.length ? page * size + 1 : 0;
  const end = Math.min(rows.length, (page + 1) * size);
  $("pager").innerHTML = `
    <button type="button" data-page="prev" ${page === 0 ? "disabled" : ""}>Prev</button>
    <button type="button" data-page="next" ${page >= totalPages - 1 ? "disabled" : ""}>Next</button>
    <span>Showing ${start}-${end} of ${rows.length}</span>
    <span>Page ${page + 1} of ${totalPages}</span>
  `;
}

function renderRulesPanel() {
  const rules = app.replacement_rules || {};
  const advanced = $("advancedRules")?.checked || $("rulesPanel")?.classList.contains("advanced");
  if ($("rulesPanel")) $("rulesPanel").classList.toggle("advanced", Boolean(advanced));
  $("rulesGrid").innerHTML = Object.entries(rules).map(([entityType, rule]) => `
    <div class="rule-row" data-rule-type="${escapeAttr(entityType)}">
      <div class="rule-title">${escapeHtml(entityType.replaceAll("_", " "))}</div>
      <div class="rule-modes">
        <label><input type="radio" name="mode-${escapeAttr(entityType)}" data-rule-field="mode" value="blanket" ${rule.mode === "blanket" ? "checked" : ""} /> Apply to all</label>
        <label><input type="radio" name="mode-${escapeAttr(entityType)}" data-rule-field="mode" value="sequential" ${rule.mode === "sequential" ? "checked" : ""} /> Sequential</label>
      </div>
      <div class="rule-field">
        <label>Replacement Text</label>
        <input type="text" data-rule-field="blanket" value="${escapeAttr(rule.blanket || "")}" />
      </div>
      <div class="rule-field advanced-only">
        <label>Pattern</label>
        <input type="text" data-rule-field="pattern" value="${escapeAttr(rule.pattern || "")}" />
      </div>
      <div class="rule-preview">Preview: ${(rule.preview || []).map(escapeHtml).join(" / ")}</div>
      <div class="rule-scope advanced-only">
        <label><input type="radio" name="scope-${escapeAttr(entityType)}" data-rule-field="scope" value="future" checked /> Future review</label>
        <label><input type="radio" name="scope-${escapeAttr(entityType)}" data-rule-field="scope" value="existing" /> Update existing</label>
      </div>
      <label class="overwrite-label advanced-only"><input type="checkbox" data-rule-field="overwriteManual" /> overwrite manual edits</label>
      <button class="advanced-only" type="button" data-rule-action="save">Apply Update</button>
      <div class="autosave-note">autosaves</div>
    </div>
  `).join("");
}

function renderCandidateQualityPanel() {
  const { stateRows, categoryRows, contextRows } = qualityNavigatorRows();
  const isTotalState = qualityNavigator.reviewState === "total";
  const categoryShowAllRow = categoryRows.find(row => row.key === "__all__");
  const visibleCategoryRows = categoryRows.filter(row =>
    row.key !== "__all__" && (qualityNavigator.showEmptyCategories || row.count > 0 || row.key === qualityNavigator.category)
  );
  const visibleContextRows = isTotalState ? contextRows.filter(row => row.key !== "__all__") : contextRows;
  $("qualitySummary").textContent = qualityCandidatePool().length ? "" : " no document scanned";
  const navButton = (kind, row) => {
    const tallClass = kind === "category" && String(row.label || "").length > 34 ? " tall" : "";
    const categoryCountClass = kind !== "category" ? "" :
      row.count >= 100 ? " count-high" :
      row.count >= 10 ? " count-mid" :
      row.count >= 1 ? " count-low" :
      " count-empty";
    return `
    <button type="button"
      class="quality-nav-row${tallClass}${categoryCountClass} ${kind === "state" && row.key === "to_review" ? "to-review" : ""} ${qualityNavigator[kind === "state" ? "reviewState" : kind] === row.key ? "active" : ""}"
      data-quality-nav="${kind}" data-quality-key="${escapeAttr(row.key)}">
      <span class="quality-nav-label">${escapeHtml(row.label)}</span>
      <span class="quality-nav-count">${row.count}</span>
    </button>
  `;
  };
  $("qualityGrid").innerHTML = `
    <div class="quality-column state">
      <div class="quality-column-title">Review State</div>
      <div class="quality-nav-list horizontal">${stateRows.map(row => navButton("state", row)).join("")}</div>
    </div>
    ${visibleContextRows.length ? `
      <div class="quality-column filter">
        ${isTotalState ? "" : `<div class="quality-column-title">Filter</div>`}
        <div class="quality-nav-list horizontal">${visibleContextRows.map(row => navButton("context", row)).join("")}</div>
      </div>
    ` : ""}
    <div class="quality-column category">
      <div class="quality-column-head">
        <div class="quality-column-title-group">
          <div class="quality-column-title">Category</div>
          ${!isTotalState && categoryShowAllRow ? `
            <button type="button"
              class="quality-show-all ${qualityNavigator.category === "__all__" ? "active" : ""}"
              data-quality-nav="category" data-quality-key="__all__">
              Show All ${categoryShowAllRow.count}
            </button>
          ` : ""}
        </div>
        <div class="quality-head-controls">
          <label class="quality-empty-toggle">
            <input id="qualityShowEmptyCategories" type="checkbox" ${qualityNavigator.showEmptyCategories ? "checked" : ""} />
            show empty categories
          </label>
          <select id="qualityCategorySort" class="quality-sort" aria-label="Sort categories">
            <option value="frequency_desc" ${qualityNavigator.categorySort === "frequency_desc" ? "selected" : ""}>Frequency desc</option>
            <option value="frequency_asc" ${qualityNavigator.categorySort === "frequency_asc" ? "selected" : ""}>Frequency asc</option>
            <option value="az" ${qualityNavigator.categorySort === "az" ? "selected" : ""}>A-Z</option>
          </select>
        </div>
      </div>
      <div class="quality-nav-list category-list">${visibleCategoryRows.map(row => navButton("category", row)).join("")}</div>
    </div>
  `;
}

async function loadQualityDetail(metric) {
  if (qualityDetailCache[metric]) return qualityDetailCache[metric];
  const detail = await api(`/api/candidate-quality?metric=${encodeURIComponent(metric)}`);
  qualityDetailCache[metric] = detail;
  return detail;
}

function renderQualityDetailLoading(metric) {
  const detail = $("qualityDetail");
  if (!detail) return;
  detail.hidden = false;
  const title = metric === "filtered" || metric === "unlikely"
    ? "Unlikely"
    : metric === "remaining_review" || metric === "to_review"
      ? "To Review"
      : metric === "resolved_earlier"
        ? "Resolved"
        : qualityRuleLabel(metric);
  detail.innerHTML = `
    <div class="quality-detail-head">
      <span class="quality-detail-title">${escapeHtml(title)}</span>
      <span class="quality-detail-note">Loading...</span>
    </div>
  `;
}

function renderQualityDetailRows(detailData) {
  const rows = detailData.rows || [];
  const tableRows = rows.map(row => {
    const forms = (row.forms || []).filter(form => form !== row.candidate);
    const formsText = forms.length ? `<div class="quality-forms">Forms: ${forms.map(escapeHtml).join(" / ")}</div>` : "";
    const reasons = (row.reasons || []).join(", ");
    const showReasonCell = ["filtered", "unlikely", "remaining_review", "to_review", "resolved_earlier"].includes(detailData.metric);
    const reasonCell = showReasonCell
      ? `<td title="${escapeAttr(reasons)}">${escapeHtml(row.primary_reason || "")}<div class="quality-forms">${escapeHtml(reasons)}</div></td><td>${row.likelihood || 0}%</td><td>${escapeHtml(row.status || "")}</td>`
      : "";
    const partialText = row.partial_relationship
      ? `<div class="quality-forms">Partial: ${row.uncovered_occurrences || 0} uncovered, ${row.covered_occurrences || 0} already covered${(row.canonical_group_ids || []).length ? ` · group ${escapeHtml(row.canonical_group_ids.join(", "))}` : ""}</div>`
      : "";
    const diagnostic = detailData.metric === "resolved_earlier"
        ? `<span class="quality-forms">Resolved in Group Check${(row.canonical_group_ids || []).length ? ` · ${escapeHtml(row.canonical_group_ids.join(", "))}` : ""}</span>`
        : `<span class="quality-forms">${escapeHtml(row.status || "To Review")}</span>${partialText}`;
    return `
      <tr>
        <td>${escapeHtml(row.candidate)}${formsText}</td>
        <td>${row.occurrences || 0}</td>
        ${reasonCell}
        <td>${diagnostic}</td>
      </tr>
    `;
  }).join("");
  const reasonHeader = detailData.metric === "filtered" || detailData.metric === "unlikely"
    ? "<th>Primary Evidence</th><th>Likelihood</th><th>Status</th>"
    : detailData.metric === "remaining_review" || detailData.metric === "to_review"
      ? "<th>Primary Evidence</th><th>Likelihood</th><th>Status</th>"
      : detailData.metric === "resolved_earlier"
        ? "<th>Primary Evidence</th><th>Likelihood</th><th>Status</th>"
        : "";
  const emptyColspan = ["filtered", "unlikely", "remaining_review", "to_review", "resolved_earlier"].includes(detailData.metric) ? 6 : 3;
  return `
    <div class="quality-detail-head">
      <span class="quality-detail-title">${escapeHtml(detailData.label || "Category Check")} · ${detailData.unique_count || 0} unique value${detailData.unique_count === 1 ? "" : "s"}</span>
      <span class="quality-detail-note">${escapeHtml(detailData.note || "")}</span>
    </div>
    <div class="quality-detail-table-wrap">
      <table>
        <thead><tr><th>Candidate</th><th>Occurrences</th>${reasonHeader}<th>Diagnostic</th></tr></thead>
        <tbody>${tableRows || `<tr><td colspan="${emptyColspan}">No candidates matched this metric.</td></tr>`}</tbody>
      </table>
    </div>
  `;
}

async function renderQualityDetail(metric) {
  const detail = $("qualityDetail");
  if (!detail) return;
  if (!qualityDetailCache[metric]) renderQualityDetailLoading(metric);
  const detailData = await loadQualityDetail(metric);
  if (activeQualityMetric !== metric) return;
  detail.hidden = false;
  detail.innerHTML = renderQualityDetailRows(detailData);
}

function closeQualityDetail({ returnFocus = true } = {}) {
  const priorMetric = activeQualityMetric;
  activeQualityMetric = null;
  activeQualityButton = null;
  renderCandidateQualityPanel();
  if (returnFocus && priorMetric) {
    window.setTimeout(() => document.querySelector(`[data-quality-metric="${CSS.escape(priorMetric)}"]`)?.focus(), 0);
  }
}

async function toggleQualityMetric(button) {
  const metric = button.dataset.qualityMetric;
  if (!metric) return;
  if (activeQualityMetric === metric) {
    closeQualityDetail({ returnFocus: true });
    return;
  }
  activeQualityMetric = metric;
  activeQualityButton = button;
  renderCandidateQualityPanel();
  await renderQualityDetail(metric);
}

function confidenceClass(value) {
  if (value >= 90) return "good";
  if (value >= 80) return "warn";
  return "caution";
}

function nameTokens(value) {
  return String(value || "").toLowerCase().match(/[a-z][a-z'.-]*/g) || [];
}

function textSimilarity(a, b) {
  const aTokens = nameTokens(a);
  const bTokens = nameTokens(b);
  if (!aTokens.length || !bTokens.length) return 0;
  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  const overlap = [...aSet].filter(token => bSet.has(token)).length;
  let score = overlap / Math.max(aSet.size, bSet.size);
  if (aTokens[0]?.[0] && bTokens[0]?.[0] && aTokens[0][0] === bTokens[0][0]) score += 0.15;
  if (aTokens.at(-1) && aTokens.at(-1) === bTokens.at(-1)) score += 0.25;
  if (String(a).trim().toLowerCase() === String(b).trim().toLowerCase()) score = 1;
  return Math.min(1, score);
}

function analysisScoreMemberAgainstCanonical(member, canonicalName, group) {
  if (!canonicalName || canonicalName === group.canonical_name) {
    return member.grouping_confidence || group.confidence || 0;
  }
  let score = Math.round(70 + textSimilarity(canonicalName, member.text) * 25);
  if (member.confidence === "high") score += 5;
  if (member.confidence === "low") score -= 5;
  if (member.quality === "Strong") score += 5;
  if (member.quality === "Unlikely") score -= 20;
  if (nameTokens(member.text).length === 1) score -= 12;
  return Math.max(35, Math.min(99, score));
}

function scoreMemberAgainstCanonical(member, canonicalName, group) {
  if (["Keep", "Rename", "Redact", "Ignore"].includes(member.decision)) return 100;
  return analysisScoreMemberAgainstCanonical(member, canonicalName, group);
}

function dynamicGroupCanonicalName(group) {
  const latestReview = latestGroupReview(group.id);
  if (groupEditor?.groupId === group.id && groupEditor.action === "Flatten") return groupEditor.value || group.canonical_name;
  if (latestReview?.action === "Flatten" && latestReview.canonical_value) return latestReview.canonical_value;
  return group.canonical_name;
}

function groupHasReviewerConfirmation(group) {
  const latestReview = latestGroupReview(group.id);
  return ["Flatten", "Keep as-is", "Redact", "Ignore"].includes(latestReview?.action || "");
}

function groupIsComplete(group) {
  const latestReview = latestGroupReview(group.id);
  if (latestReview?.action === "Not Quite Complete") return true;
  const memberDecisions = (group.members || []).map(member => member.decision || "Undecided");
  const allMembersHandled = memberDecisions.length > 0 && memberDecisions.every(decision => ["Keep", "Rename", "Redact", "Ignore"].includes(decision));
  if (latestReview?.action === "Not Quite") return allMembersHandled;
  const decision = groupDisplayDecision(group);
  return ["Keep", "Rename", "Redact", "Ignore"].includes(decision);
}

function dynamicGroupConfidence(group) {
  const selectedKeys = new Set(groupSelectedKeys(group));
  const selectedMembers = (group.members || []).filter(member => selectedKeys.has(member.key));
  if (!selectedMembers.length) return 0;
  const canonicalName = dynamicGroupCanonicalName(group);
  const scores = selectedMembers.map(member => scoreMemberAgainstCanonical(member, canonicalName, group));
  let score = Math.round(Math.min(...scores) * 0.65 + (scores.reduce((sum, value) => sum + value, 0) / scores.length) * 0.35);
  const hasAnchor = selectedMembers.some(member => nameTokens(member.text).length >= 2);
  if (selectedMembers.length > 1 && !hasAnchor) score -= 15;
  if (groupHasReviewerConfirmation(group)) score += 10;
  return Math.max(35, Math.min(100, score));
}

function analysisGroupConfidence(group) {
  const selectedKeys = new Set(groupSelectedKeys(group));
  const selectedMembers = (group.members || []).filter(member => selectedKeys.has(member.key));
  if (!selectedMembers.length) return 0;
  const canonicalName = dynamicGroupCanonicalName(group);
  const scores = selectedMembers.map(member => analysisScoreMemberAgainstCanonical(member, canonicalName, group));
  let score = Math.round(Math.min(...scores) * 0.65 + (scores.reduce((sum, value) => sum + value, 0) / scores.length) * 0.35);
  const hasAnchor = selectedMembers.some(member => nameTokens(member.text).length >= 2);
  if (selectedMembers.length > 1 && !hasAnchor) score -= 15;
  return Math.max(35, Math.min(100, score));
}

function updateVisibleGroupConfidence(groupId) {
  const group = (app.entity_groups || []).find(item => item.id === groupId);
  const node = document.querySelector(`[data-group-id="${CSS.escape(groupId)}"] [data-group-confidence]`);
  if (!group || !node) return;
  const expanded = document.querySelector(`[data-group-id="${CSS.escape(groupId)}"]`)?.classList.contains("expanded");
  if (groupIsComplete(group) && !expanded) {
    node.innerHTML = `<span class="completion-check" title="Complete" aria-label="Complete">✓</span>`;
    node.className = "group-confidence complete";
    return;
  }
  const confidence = dynamicGroupConfidence(group);
  const analysisConfidence = analysisGroupConfidence(group);
  node.innerHTML = `${confidence}%${confidence !== analysisConfidence ? `<span class="prior-score">was ${analysisConfidence}%</span>` : ""}`;
  node.className = `group-confidence ${confidenceClass(confidence)}`;
}

function highlightedContext(member) {
  const context = (member.contexts || [])[0] || "No context available.";
  return escapeHtml(context).replaceAll("[", "<mark>").replaceAll("]", "</mark>");
}

function latestGroupReview(groupId) {
  const reviews = app.entity_group_reviews || [];
  for (let index = reviews.length - 1; index >= 0; index -= 1) {
    if (reviews[index].group_id === groupId) return reviews[index];
  }
  return null;
}

function groupActionDecision(action) {
  return {
    Flatten: "Rename",
    "Keep as-is": "Keep",
    Redact: "Redact",
    Ignore: "Ignore",
    Skip: "Ignore",
    "Wrong grouping": "Ignore",
    "Not Quite": "Not Quite"
  }[action] || action;
}

function groupDraftValue(groupId, action, fallback) {
  return groupEditorDrafts[groupId]?.[action] ?? fallback ?? "";
}

function saveGroupDraft(groupId, action, value) {
  if (!groupId || !action) return;
  groupEditorDrafts[groupId] ||= {};
  groupEditorDrafts[groupId][action] = value;
}

function enterNotQuite(group) {
  notQuiteGroups.clear();
  notQuiteGroups.add(group.id);
  if (!notQuiteRemaining[group.id]?.length) notQuiteRemaining[group.id] = groupSelectedKeys(group);
  if (!notQuiteRemaining[group.id].length) notQuiteRemaining[group.id] = [...group.candidate_keys];
  if (!notQuiteActiveMember[group.id] || !notQuiteRemaining[group.id].includes(notQuiteActiveMember[group.id])) {
    notQuiteActiveMember[group.id] = notQuiteRemaining[group.id][0] || null;
  }
  notQuiteEditor = null;
  groupEditor = null;
  expandedGroups.add(group.id);
}

function exitNotQuite(groupId) {
  if (notQuiteEditor?.groupId === groupId) {
    saveNotQuiteDraft(groupId, notQuiteEditor.key, notQuiteEditor.action, notQuiteEditor.value || "");
  }
  notQuiteGroups.delete(groupId);
  notQuiteEditor = null;
}

function notQuiteMembers(group) {
  const remaining = notQuiteRemaining[group.id] || [];
  return remaining
    .map(key => (group.members || []).find(member => member.key === key))
    .filter(Boolean);
}

function focusNotQuiteEditor(groupId, key) {
  window.setTimeout(() => {
    document.querySelector(`[data-group-id="${CSS.escape(groupId)}"] [data-not-quite-editor-value][data-member-key="${CSS.escape(key)}"]`)?.focus();
  }, 0);
}

function notQuiteEditorHtml(groupId, member) {
  if (!notQuiteEditor || notQuiteEditor.groupId !== groupId || notQuiteEditor.key !== member.key) return "";
  const title = notQuiteEditor.action === "Rename" ? "Rename as:" : "Redact as:";
  return `<div class="not-quite-editor">
    <label>${title}</label>
    <input type="text" data-not-quite-editor-value data-member-key="${escapeAttr(member.key)}" value="${escapeAttr(notQuiteEditor.value || "")}" />
    <button type="button" data-not-quite-editor-apply>Accept</button>
    <button type="button" data-not-quite-editor-cancel>Cancel</button>
  </div>`;
}

function notQuiteDraftValue(groupId, key, action, fallback) {
  return notQuiteEditorDrafts[groupId]?.[key]?.[action] ?? fallback ?? "";
}

function saveNotQuiteDraft(groupId, key, action, value) {
  if (!groupId || !key || !action) return;
  notQuiteEditorDrafts[groupId] ||= {};
  notQuiteEditorDrafts[groupId][key] ||= {};
  notQuiteEditorDrafts[groupId][key][action] = value;
}

function notQuitePanelHtml(group) {
  const members = notQuiteMembers(group);
  if (activeGroupId === group.id) notQuiteActiveKey(group);
  const rows = members.map(member => {
    const contextOpen = groupContext[group.id] === member.key;
    const active = notQuiteActiveMember[group.id] === member.key;
    const decisionClass = member.decision === "Undecided" ? "" : `decision-${cssToken(member.decision)}`;
    const status = member.decision === "Undecided" ? "" : (labels[member.decision]?.word || member.decision).toLowerCase();
    const canonicalName = dynamicGroupCanonicalName(group);
    const memberScore = scoreMemberAgainstCanonical(member, canonicalName, group);
    const priorScore = analysisScoreMemberAgainstCanonical(member, canonicalName, group);
    const priorScoreNote = memberScore === 100 && priorScore !== 100 ? `<span class="not-quite-prior-score">was ${priorScore}%</span>` : "";
    const reviewedConfidence = ["Keep", "Rename", "Redact", "Ignore"].includes(member.decision) ? `<span class="not-quite-status">user ${["Keep", "Ignore"].includes(member.decision) ? "confirmed" : "edited"}</span>` : "";
    return `<div class="not-quite-row ${decisionClass} ${active ? "active" : ""}" data-not-quite-member="${escapeAttr(member.key)}" tabindex="0">
      <div class="not-quite-name">${escapeHtml(member.text)} <span class="inline-count">(${member.count})</span>${status ? `<span class="not-quite-status">${escapeHtml(status)}</span>` : ""}${reviewedConfidence}</div>
      <div class="not-quite-score ${confidenceClass(memberScore)}">${memberScore}%${priorScoreNote}</div>
      <button class="${member.decision === "Keep" ? "selected" : ""}" type="button" data-not-quite-action="Keep">Keep</button>
      <button class="${member.decision === "Rename" ? "selected" : ""}" type="button" data-not-quite-action="Rename">Rename</button>
      <button class="${member.decision === "Redact" ? "selected" : ""}" type="button" data-not-quite-action="Redact">Redact</button>
      <button class="${member.decision === "Ignore" ? "selected" : ""}" type="button" data-not-quite-action="Ignore">Ignore</button>
      <button type="button" data-not-quite-context>Context</button>
    </div>
    ${notQuiteEditorHtml(group.id, member)}
    ${contextOpen ? `<div class="context-window">${highlightedContext(member)}</div>` : ""}`;
  }).join("");
  return `<div class="not-quite-panel" data-not-quite-panel>
    <div class="not-quite-title">Not Quite</div>
    <div class="not-quite-subtitle">Check these items individually.</div>
    ${rows || `<div class="not-quite-subtitle">All items handled.</div>`}
  </div>`;
}

function groupDecision(group) {
  const latestReview = latestGroupReview(group.id);
  if (latestReview) return groupActionDecision(latestReview.action);
  const decisions = [...new Set((group.members || []).map(member => member.decision).filter(Boolean))];
  if (!decisions.length || (decisions.length === 1 && decisions[0] === "Undecided")) return "Undecided";
  const realDecisions = decisions.filter(decision => decision !== "Undecided");
  if (realDecisions.length === 1 && decisions.length === 1) return realDecisions[0];
  if (realDecisions.length === 1 && decisions.length === 2 && decisions.includes("Undecided")) return "Mixed";
  return realDecisions.length === 1 ? realDecisions[0] : "Mixed";
}

function groupDisplayDecision(group) {
  if (groupEditor?.groupId === group.id) return groupActionDecision(groupEditor.action);
  return groupDecision(group);
}

function groupSelectedKeys(group) {
  if (notQuiteGroups.has(group.id)) return notQuiteRemaining[group.id] || [];
  const unchecked = groupUnchecked[group.id] || new Set();
  return group.candidate_keys.filter(key => !unchecked.has(key));
}

function groupSelectionSummary(group, selectedKeys) {
  if (selectedKeys.length === group.candidate_keys.length) return "";
  if (!selectedKeys.length) return "";
  return `${selectedKeys.length} of ${group.candidate_keys.length} selected`;
}

function groupActionLabels(allSelected) {
  const scope = allSelected ? "" : " selected";
  return {
    rename: `Rename${scope}`,
    keep: `Keep${scope} as-is`,
    redact: `Redact${scope}`,
    ignore: `Ignore${scope}`,
    notQuite: "Not Quite"
  };
}

function groupEditorHtml(group, selectedKeys) {
  if (!groupEditor || groupEditor.groupId !== group.id) return "";
  const selectedMembers = group.members.filter(member => selectedKeys.includes(member.key));
  const values = [...new Set(selectedMembers.map(member => member.text))];
  const action = groupEditor.action;
  const editorClass = `action-${cssToken(groupActionDecision(action))}`;
  if (action === "Flatten") {
    return `<div class="group-editor ${editorClass}" data-group-editor>
      <div class="group-editor-title">Rename selected as:</div>
      <div class="group-editor-options">
        ${values.map(value => `<label><input type="radio" name="flatten-${escapeAttr(group.id)}" data-flatten-choice value="${escapeAttr(value)}" ${groupEditor.value === value ? "checked" : ""} /> ${escapeHtml(value)}</label>`).join("")}
      </div>
      <div class="group-editor-custom">
        <input type="text" data-group-editor-value placeholder="Or enter another value" value="${escapeAttr(groupEditor.value || "")}" />
        <button type="button" data-group-editor-apply>Accept</button>
        <button type="button" data-group-editor-cancel>Cancel</button>
      </div>
    </div>`;
  }
  return `<div class="group-editor ${editorClass}" data-group-editor>
    <div class="group-editor-title">Redact selected as:</div>
    <div class="group-editor-custom">
      <input type="text" data-group-editor-value value="${escapeAttr(groupEditor.value || "")}" />
      <button type="button" data-group-editor-apply>Accept</button>
      <button type="button" data-group-editor-cancel>Cancel</button>
    </div>
  </div>`;
}

function renderFinishEntityResolutionConfirm() {
  const confirm = $("finishEntityResolutionConfirm");
  const button = $("finishEntityResolution");
  if (!confirm || !button) return;
  confirm.hidden = !finishEntityResolutionConfirmOpen;
  button.hidden = false;
}

function updateGroupParentCheckboxes() {
  document.querySelectorAll("[data-group-parent]").forEach(input => {
    const group = (app.entity_groups || []).find(item => item.id === input.closest(".group-card")?.dataset.groupId);
    if (!group) return;
    const selectedKeys = groupSelectedKeys(group);
    input.checked = selectedKeys.length === group.candidate_keys.length;
    input.indeterminate = selectedKeys.length > 0 && selectedKeys.length < group.candidate_keys.length;
  });
}

function setActiveGroup(groupId, scroll = false) {
  if (!groupId) return;
  activeGroupId = groupId;
  activeKey = null;
  document.querySelectorAll("#entityGroups .group-card").forEach(card => {
    card.classList.toggle("active", card.dataset.groupId === groupId);
  });
  document.querySelectorAll("#entityGroups .group-row.active, #entityGroups .member-row.active, #entityGroups .not-quite-row.active").forEach(row => {
    const card = row.closest(".group-card");
    if (!card || card.dataset.groupId !== groupId || !card.classList.contains("expanded")) {
      row.classList.remove("active");
    }
  });
  if (scroll) {
    window.setTimeout(() => {
      const card = document.querySelector(`[data-group-id="${CSS.escape(groupId)}"]`);
      card?.scrollIntoView({ block: "nearest", inline: "nearest" });
      card?.focus({ preventScroll: true });
    }, 0);
  }
}

function focusGroupWithOpenTransfer(groupId, scroll = false) {
  if (!groupId) return false;
  const priorGroupId = activeGroupId;
  const transferOpen = priorGroupId && priorGroupId !== groupId && expandedGroups.has(priorGroupId);
  if (transferOpen) {
    expandedGroups.clear();
    expandedGroups.add(groupId);
    groupEditor = null;
    notQuiteEditor = null;
    renderEntityGroups();
  }
  setActiveGroup(groupId, scroll);
  return true;
}

function isSpaceKey(event) {
  return event.key === " " || event.key === "Spacebar" || event.code === "Space";
}

function focusGroupCardById(groupId) {
  const card = document.querySelector(`[data-group-id="${CSS.escape(groupId)}"]`);
  if (!card) return false;
  card.focus({ preventScroll: true });
  updateGroupCommandBar(card);
  return true;
}

function isEditableTextTarget(target) {
  const tag = target?.tagName?.toLowerCase?.() || "";
  if (target?.isContentEditable) return true;
  if (tag === "textarea") return true;
  if (tag === "select") return true;
  if (tag !== "input") return false;
  return !["checkbox", "radio", "button", "submit", "reset", "hidden"].includes(target.type);
}

function groupCheckCardFromTarget(target) {
  return target?.closest?.("#entityGroups .group-card") || null;
}

function armGroupCheckKeyboard(target) {
  const card = groupCheckCardFromTarget(target);
  if (!card) return false;
  groupCheckKeyboardArmed = true;
  focusGroupWithOpenTransfer(card.dataset.groupId);
  if (!target.closest?.("input, textarea, select, button")) {
    card.focus({ preventScroll: true });
  }
  return true;
}

function disarmGroupCheckKeyboardIfOutside(target) {
  if (target?.closest?.("#entityGroups")) return;
  groupCheckKeyboardArmed = false;
}

function handleArmedGroupCheckSpace(event) {
  if (!isSpaceKey(event) || !groupCheckKeyboardArmed || !activeGroupId) return false;
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
  if (isEditableTextTarget(event.target)) return false;
  const activeCard = activeGroupCard();
  if (!activeCard) return false;
  if (event.target.closest?.("#entityGroups button, #entityGroups input[type='checkbox']")) return false;
  event.preventDefault();
  const activeGroup = activeGroupObject();
  const activeRow = activeGroup ? activeExpandedMemberKey(activeGroup) : GROUP_ROW_KEY;
  if (activeGroupIsExpanded() && activeRow !== GROUP_ROW_KEY && notQuiteGroups.has(activeGroup?.id)) return true;
  if (!toggleActiveGroupMemberSelection()) toggleActiveGroupExpanded();
  return true;
}

function closeGroupInlineEditor(editorElement) {
  const card = editorElement.closest(".group-card");
  const groupId = card?.dataset.groupId || notQuiteEditor?.groupId || groupEditor?.groupId;
  cancelGroupInlineEditor(editorElement);
  if (!groupId) return true;
  expandedGroups.delete(groupId);
  renderEntityGroups();
  setActiveGroup(groupId);
  window.setTimeout(() => focusGroupCardById(groupId), 0);
  return true;
}

function groupCardMetrics(card) {
  const rect = card.getBoundingClientRect();
  return {
    card,
    rect,
    centerX: rect.left + rect.width / 2,
    centerY: rect.top + rect.height / 2
  };
}

function horizontalOverlap(a, b) {
  return a.rect.left < b.rect.right && a.rect.right > b.rect.left;
}

function navigateActiveGroup(direction) {
  const cards = [...document.querySelectorAll("#entityGroups .group-card")];
  if (!cards.length) return false;
  const currentCard = cards.find(card => card.dataset.groupId === activeGroupId) || cards[0];
  const current = groupCardMetrics(currentCard);
  const metrics = cards.map(groupCardMetrics).filter(item => item.card !== currentCard);
  let candidates = [];
  let scorer = () => 0;
  if (direction === "ArrowDown") {
    candidates = metrics.filter(item => item.rect.top > current.rect.top + 4 && horizontalOverlap(item, current));
    if (!candidates.length) candidates = metrics.filter(item => item.rect.top > current.rect.top + 4);
    scorer = item => (item.rect.top - current.rect.top) * 1000 + Math.abs(item.centerX - current.centerX);
  } else if (direction === "ArrowUp") {
    candidates = metrics.filter(item => item.rect.top < current.rect.top - 4 && horizontalOverlap(item, current));
    if (!candidates.length) candidates = metrics.filter(item => item.rect.top < current.rect.top - 4);
    scorer = item => (current.rect.top - item.rect.top) * 1000 + Math.abs(item.centerX - current.centerX);
  } else if (direction === "ArrowRight") {
    candidates = metrics.filter(item => item.rect.left > current.rect.left + 4);
    scorer = item => Math.abs(item.rect.top - current.rect.top) * 10000 + (item.rect.left - current.rect.left);
  } else if (direction === "ArrowLeft") {
    candidates = metrics.filter(item => item.rect.left < current.rect.left - 4);
    scorer = item => Math.abs(item.rect.top - current.rect.top) * 10000 + (current.rect.left - item.rect.left);
  }
  if (!candidates.length) return false;
  candidates.sort((a, b) => scorer(a) - scorer(b));
  const keepExpanded = expandedGroups.has(activeGroupId);
  const nextGroupId = candidates[0].card.dataset.groupId;
  if (keepExpanded) {
    expandedGroups.clear();
    expandedGroups.add(nextGroupId);
    renderEntityGroups();
  }
  focusGroupWithOpenTransfer(nextGroupId, true);
  return true;
}

function navigateActiveGroupAcrossColumn() {
  const cards = [...document.querySelectorAll("#entityGroups .group-card")];
  if (!cards.length) return false;
  const currentCard = cards.find(card => card.dataset.groupId === activeGroupId);
  if (!currentCard) return false;
  const current = groupCardMetrics(currentCard);
  const candidates = cards
    .filter(card => card !== currentCard)
    .map(groupCardMetrics)
    .filter(item => Math.abs(item.centerY - current.centerY) < Math.max(current.rect.height, item.rect.height) / 2)
    .sort((a, b) => Math.abs(a.centerX - current.centerX) - Math.abs(b.centerX - current.centerX));
  if (!candidates.length) return false;
  focusGroupWithOpenTransfer(candidates[0].card.dataset.groupId, true);
  window.setTimeout(() => {
    const target = document.querySelector(`[data-group-id="${CSS.escape(candidates[0].card.dataset.groupId)}"]`);
    target?.focus({ preventScroll: true });
    updateGroupCommandBar(target);
  }, 0);
  return true;
}

function navigateActiveGroupSequence(delta) {
  const cards = [...document.querySelectorAll("#entityGroups .group-card")];
  if (!cards.length) return false;
  const currentIndex = Math.max(0, cards.findIndex(card => card.dataset.groupId === activeGroupId));
  const next = cards[Math.max(0, Math.min(cards.length - 1, currentIndex + delta))];
  if (!next) return false;
  focusGroupWithOpenTransfer(next.dataset.groupId, true);
  window.setTimeout(() => {
    const target = document.querySelector(`[data-group-id="${CSS.escape(next.dataset.groupId)}"]`);
    target?.focus({ preventScroll: true });
    updateGroupCommandBar(target);
  }, 0);
  return true;
}

function toggleActiveGroupExpanded() {
  if (!activeGroupId) return false;
  const card = document.querySelector(`[data-group-id="${CSS.escape(activeGroupId)}"]`);
  if (!card) return false;
  if (expandedGroups.has(activeGroupId)) {
    expandedGroups.delete(activeGroupId);
  } else {
    expandedGroups.clear();
    expandedGroups.add(activeGroupId);
  }
  renderEntityGroups();
  setActiveGroup(activeGroupId, true);
  return true;
}

function nextVisibleGroupIdAfter(groupId) {
  const groups = visibleEntityGroups();
  if (!groups.length) return null;
  const idx = Math.max(0, groups.findIndex(group => group.id === groupId));
  return groups[Math.min(groups.length - 1, idx + 1)]?.id || groups[idx]?.id || null;
}

function advanceGroupCheckAfterCompletion(groupId) {
  const nextGroupId = nextVisibleGroupIdAfter(groupId);
  expandedGroups.delete(groupId);
  groupEditor = null;
  renderEntityGroups();
  renderAmbiguousMatches();
  renderRows();
  if (nextGroupId && nextGroupId !== groupId) {
    setActiveGroup(nextGroupId, true);
    groupCheckKeyboardArmed = true;
  }
}

function renderEntityGroups() {
  renderFinishEntityResolutionConfirm();
  const allGroups = app.entity_groups || [];
  renderSimpleTypeFilter("erTypeFilter", allGroups.map(group => group.type));
  const groups = visibleEntityGroups();
  erPage = renderStagePager("erPager", groups, erPage, "erPageSize");
  const size = stagePageSize("erPageSize");
  const shownGroups = groups.slice(erPage * size, erPage * size + size);
  const filteredNote = groups.length === allGroups.length ? "" : ` · ${groups.length} shown`;
  $("entityResolutionSummary").textContent = allGroups.length ? ` ${allGroups.length} proposed groups${filteredNote}` : " no proposed groups";
  $("entityGroups").innerHTML = shownGroups.map(group => {
    const expanded = expandedGroups.has(group.id);
    const notQuiteOpen = notQuiteGroups.has(group.id);
    const decision = groupDisplayDecision(group);
    const currentConfidence = dynamicGroupConfidence(group);
    const priorConfidence = analysisGroupConfidence(group);
    const complete = groupIsComplete(group);
    const showCompleteCheck = complete && !expanded;
    const confidenceHtml = showCompleteCheck ? `<span class="completion-check" title="Complete" aria-label="Complete">✓</span>` : `${currentConfidence}%${currentConfidence !== priorConfidence ? `<span class="prior-score">was ${priorConfidence}%</span>` : ""}`;
    const confidenceClassName = showCompleteCheck ? "complete" : confidenceClass(currentConfidence);
    const decisionClass = decision === "Undecided" ? "" : `decision-${cssToken(decision)}`;
    const selectedKeys = groupSelectedKeys(group);
    const allSelected = selectedKeys.length === group.candidate_keys.length;
    const selectedNeedsReview = group.members.some(member => selectedKeys.includes(member.key) && member.needs_group_review);
    const selectionNote = groupSelectionSummary(group, selectedKeys);
    const attentionPill = !complete && selectedNeedsReview ? `<span class="needs-review">needs attention</span>` : "";
    const selectedLabel = allSelected ? "all" : "selected";
    const actionableDisabled = selectedKeys.length ? "" : "disabled";
    const memberRows = group.members.map(member => {
      const contextOpen = groupContext[group.id] === member.key;
      const groupConfidence = member.grouping_confidence || group.confidence;
      const checked = !(groupUnchecked[group.id] || new Set()).has(member.key);
      if (expanded && !notQuiteOpen && activeGroupId === group.id && !groupActiveMember[group.id]) {
        groupActiveMember[group.id] = GROUP_ROW_KEY;
      }
      const activeMember = activeGroupId === group.id && groupActiveMember[group.id] === member.key;
      return `<div class="member-row ${activeMember ? "active" : ""}" data-member-key="${escapeAttr(member.key)}" tabindex="0">
        <input type="checkbox" data-group-member ${checked ? "checked" : ""} />
        <div class="member-name">${escapeHtml(member.text)} <span class="inline-count">(${member.count})</span></div>
        <div class="member-confidence ${confidenceClass(groupConfidence)}">${groupConfidence}%${member.needs_group_review ? `<span class="needs-review">needs attention</span>` : ""}</div>
        <div class="member-context"><button type="button" data-group-context="${escapeAttr(member.key)}">Context</button></div>
      </div>
      ${contextOpen ? `<div class="context-window">${highlightedContext(member)}</div>` : ""}`;
    }).join("");
    const actionLabels = groupActionLabels(allSelected);
    const showSelectedAction = expanded || !complete;
    const actionStateClass = (targetDecision) => {
      if (decision !== targetDecision) return "";
      return showSelectedAction ? "selected" : "completed-choice";
    };
    const actionsHtml = notQuiteOpen
      ? `<button class="action-not-quite selected" type="button" data-group-action="Not Quite">Not Quite</button>
          <button class="action-back" type="button" data-not-quite-exit>Back</button>`
      : `<button class="action-rename ${actionStateClass("Rename")}" type="button" data-group-action="Flatten" ${actionableDisabled}>${escapeHtml(actionLabels.rename)}</button>
          <button class="action-keep ${actionStateClass("Keep")}" type="button" data-group-action="Keep as-is" ${actionableDisabled}>${escapeHtml(actionLabels.keep)}</button>
          <button class="action-redact ${actionStateClass("Redact")}" type="button" data-group-action="Redact" ${actionableDisabled}>${escapeHtml(actionLabels.redact)}</button>
          <button class="action-ignore ${actionStateClass("Ignore")}" type="button" data-group-action="Ignore" ${actionableDisabled}>${escapeHtml(actionLabels.ignore)}</button>
          <button class="action-not-quite ${actionStateClass("Not Quite")}" type="button" data-group-action="Not Quite">${escapeHtml(actionLabels.notQuite)}</button>`;
    const activeGroupRow = expanded && activeGroupId === group.id && activeExpandedMemberKey(group) === GROUP_ROW_KEY;
    return `<div class="group-card ${decisionClass} ${expanded ? "expanded" : ""} ${activeGroupId === group.id ? "active" : ""}" data-group-id="${escapeAttr(group.id)}" tabindex="0">
      <div class="group-row ${activeGroupRow ? "active" : ""}" tabindex="0">
        <input type="checkbox" data-group-parent ${notQuiteOpen ? "disabled" : ""} />
        <div class="group-name"><button type="button" data-group-toggle>${expanded ? "▾" : "▸"}</button> ${escapeHtml(group.canonical_name)} <span class="inline-count">(${group.occurrence_count})</span>${selectionNote ? `<span class="selection-note">${escapeHtml(selectionNote)}</span>` : ""}${attentionPill}</div>
        <div class="group-confidence ${confidenceClassName}" data-group-confidence>${confidenceHtml}</div>
        <div class="group-actions">
          ${actionsHtml}
        </div>
      </div>
      <div class="group-members">${notQuiteOpen ? notQuitePanelHtml(group) : memberRows}</div>
      ${notQuiteOpen ? "" : groupEditorHtml(group, selectedKeys)}
    </div>`;
  }).join("");
  updateGroupParentCheckboxes();
  updateGroupCommandBar();
}

function renderAmbiguousMatches() {
  const allMatches = app.ambiguous_matches || [];
  renderSimpleTypeFilter("amTypeFilter", allMatches.map(match => match.candidate?.type));
  const matches = visibleAmbiguousMatches();
  amPage = renderStagePager("amPager", matches, amPage, "amPageSize");
  const size = stagePageSize("amPageSize");
  const shownMatches = matches.slice(amPage * size, amPage * size + size);
  const filteredNote = matches.length === allMatches.length ? "" : ` · ${matches.length} shown`;
  $("ambiguousResolutionSummary").textContent = allMatches.length ? ` ${allMatches.length} ambiguous match${allMatches.length === 1 ? "" : "es"}${filteredNote}` : " none";
  if (shownMatches.length && !shownMatches.some(match => match.candidate?.key === activeAmbiguousKey)) {
    activeAmbiguousKey = shownMatches[0].candidate?.key || null;
  }
  $("ambiguousMatches").innerHTML = shownMatches.map(match => {
    const candidate = match.candidate;
    const contextOpen = ambiguousContext[candidate.key];
    const decisionClass = candidate.decision === "Undecided" ? "" : `decision-${cssToken(candidate.decision)}`;
    const statusText = candidate.decision === "Undecided" ? "" : (labels[candidate.decision]?.word || candidate.decision).toLowerCase();
    const options = (match.possible_groups || [])
      .map(group => `${escapeHtml(group.canonical_name)} (${group.confidence}%)`)
      .join(" · ");
    return `<div class="ambiguous-card ${decisionClass} ${candidate.key === activeAmbiguousKey ? "active" : ""}" data-ambiguous-key="${escapeAttr(candidate.key)}" tabindex="0">
      <div class="ambiguous-row">
        <div class="ambiguous-name">${escapeHtml(candidate.text)} <span class="inline-count">(${candidate.count})</span>${statusText ? `<span class="group-status">${escapeHtml(statusText)}</span>` : ""}</div>
        <div class="ambiguous-options">${options || "No possible matches."}</div>
        <div class="ambiguous-actions">
          <button type="button" data-ambiguous-context>Context</button>
          ${["Keep", "Rename", "Redact", "Ignore"].map(action => `<button class="action-${cssToken(action)} ${candidate.decision === action ? "selected" : ""}" type="button" data-ambiguous-action="${escapeAttr(action)}">${labels[action].key}</button>`).join("")}
        </div>
      </div>
      ${contextOpen ? `<div class="context-window">${highlightedContext(candidate)}</div>` : ""}
    </div>`;
  }).join("");
}

function gridHeader() {
  const header = `<div class="grid-header-half"><span></span><span>Item</span><span>Likelihood</span><span>Status</span><span>Type</span><span>#</span><span>Action</span></div>`;
  return `<div class="grid-header">${header}${header}</div>`;
}

function cssToken(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

function editorHtml(c) {
  if (!editor || editor.key !== c.key) return "";
  return `<div class="inline-editor" data-editor-for="${escapeAttr(c.key)}">
    <div class="editor-grid">
      <label for="rename-editor">Replace with:</label>
      <input id="rename-editor" data-kind="rename-editor" type="text" value="${escapeAttr(editor.value)}" />
      <button type="button" data-editor-action="apply">Accept</button>
      <button type="button" data-editor-action="cancel">Cancel</button>
    </div>
  </div>`;
}

function candidateCellHtml(c) {
  const statusName = candidateQualityStatus(c);
  const label = reviewStateLabels[statusName] || "To Review";
  return `<button type="button"
    class="candidate-cell status-${escapeAttr(statusName)} ${qualityPendingChangeKeys.has(c.key) ? "pending-change" : ""} ${c.key === activeKey ? "active" : ""}"
    data-key="${escapeAttr(c.key)}"
    aria-pressed="${statusName === "resolved" ? "true" : "false"}"
    title="${escapeAttr(`${c.text} (${c.count}) · ${label}`)}">
    <span class="candidate-name">${escapeHtml(c.text)}</span>
    <span class="candidate-count">(${c.count})</span>
  </button>`;
}

function renderRows() {
  renderTypeFilter();
  renderSummary();
  renderConfidenceTabs();
  updateAcceptResultChangesControls();
  const rows = visibleCandidates();
  const resultsSummary = $("candidateResultsSummary");
  if (resultsSummary) {
    resultsSummary.innerHTML = `<strong>${rows.length} Result${rows.length === 1 ? "" : "s"}</strong><span>${escapeHtml(qualityPathLabel())}</span><span>↑↓←→ move · K/N/R/I decide · D detail · Space expand · Shift+Arrows categories · Esc close · / search</span>`;
  }
  if (!rows.length) {
    activeKey = null;
    expanded.clear();
  }
  if (rows.length && (!activeKey || !rows.some(r => r.key === activeKey))) {
    activeKey = (rows.find(r => r.decision === "Undecided") || rows[0]).key;
  }
  preserveDetailForActiveCandidate();
  page = pageForKey(rows, activeKey);
  clampPage(rows);
  renderPager(rows);
  updateBulkControls(rows);
  const start = page * pageSize();
  const shownRows = rows.slice(start, start + pageSize());
  $("rows").innerHTML = shownRows.map(c => expanded.has(c.key) ? renderCandidateDetailPanel(c) : candidateCellHtml(c)).join("");
}

function renderCandidateDetailPanel(candidate) {
  if (!candidate || !expanded.has(candidate.key)) return "";
  const explanation = candidate.explanation || {};
  const standard = explanation.standard || {};
  const expert = explanation.expert || {};
  const positiveEvidence = expert.positive_evidence || (candidate.quality_evidence_breakdown || []).filter(item => Number(item.weight || 0) > 0);
  const negativeEvidence = expert.negative_evidence || (candidate.quality_evidence_breakdown || []).filter(item => Number(item.weight || 0) < 0);
  const neutralEvidence = expert.neutral_evidence || (candidate.quality_evidence_breakdown || []).filter(item => Number(item.weight || 0) === 0);
  const evidenceList = (items) => items.length
    ? `<ul>${items.map(item => `<li>${Number(item.weight || 0) > 0 ? "+" : ""}${Number(item.weight || 0)} ${escapeHtml(item.expert || item.label || item.rule || item.id || "")}</li>`).join("")}</ul>`
    : `<div class="hint">None recorded.</div>`;
  const snippets = (candidate.contexts || []).slice(0, 5).map(context => `<div class="context">${escapeHtml(context)}</div>`).join("");
  const occurrences = renderOccurrenceBlocks(candidate);
  const categories = (expert.diagnostic_categories || qualityRulesForCandidate(candidate)).map(qualityRuleLabel).join(", ") || "None recorded";
  const likelihood = Number(standard.likelihood ?? candidate.likelihood ?? 0);
  const recommendation = standard.recommendation || candidate.quality_status || "To Review";
  const typeLabel = displayType(candidate.type);
  const summary = standard.summary || candidate.quality_explanation || "No explanation recorded.";
  const statusName = candidateQualityStatus(candidate);
  return `
    <div class="candidate-cell candidate-cell-expanded candidate-detail-panel status-${escapeAttr(statusName)} ${qualityPendingChangeKeys.has(candidate.key) ? "pending-change" : ""} ${candidate.key === activeKey ? "active" : ""}"
      data-key="${escapeAttr(candidate.key)}"
      data-candidate-detail-for="${escapeAttr(candidate.key)}"
      tabindex="0"
      aria-pressed="${statusName === "resolved" ? "true" : "false"}"
      title="${escapeAttr(`${candidate.text} (${candidate.count}) · ${recommendation}`)}">
      <div class="candidate-detail-head">
        <div class="candidate-detail-titleline">
          <strong>${escapeHtml(candidate.text)} <span class="inline-count">(${candidate.count})</span></strong>
          <span class="candidate-detail-badges" aria-label="Candidate summary">
            <span class="detail-badge likelihood ${confidenceClass(likelihood)}"><span class="likelihood-dot"></span>${likelihood}%</span>
            <span class="detail-badge">${escapeHtml(typeLabel)}</span>
            <span class="detail-badge">${escapeHtml(recommendation)}</span>
          </span>
        </div>
        <button type="button" data-candidate-detail-close>Close</button>
      </div>
      <div class="candidate-standard-summary">${escapeHtml(summary)}</div>
      ${editorHtml(candidate)}
      <div class="candidate-standard-section">
        <div class="detail-title">Representative Snippets</div>
        ${snippets || `<div class="hint">No snippets recorded.</div>`}
      </div>
      <details class="candidate-top-occurrences">
        <summary>All occurrences (${candidate.count || 0})</summary>
        ${occurrences || `<div class="hint">No occurrences recorded.</div>`}
      </details>
      <details class="candidate-expert-view">
        <summary>Expert View</summary>
        <div class="candidate-detail-grid">
          <div>
            <div class="detail-title">Likelihood</div><div>${likelihood}%</div>
            <div class="detail-title">Recommendation</div><div>${escapeHtml(recommendation)}</div>
            <div class="detail-title">Current Disposition</div><div>${escapeHtml(expert.current_disposition || reviewStateLabels[candidateQualityStatus(candidate)] || "To Review")}</div>
            <div class="detail-title">Type</div><div>${escapeHtml(candidate.type)}</div>
            <div class="detail-title">Detector</div><div>${escapeHtml(displayDetector(candidate.source))} (${escapeHtml(candidate.source)})</div>
          </div>
          <div>
            <div class="detail-title">Positive Evidence</div>${evidenceList(positiveEvidence)}
            <div class="detail-title">Negative Evidence</div>${evidenceList(negativeEvidence)}
            <div class="detail-title">Neutral Evidence</div>${evidenceList(neutralEvidence)}
          </div>
          <div>
            <div class="detail-title">Diagnostic Categories</div><div>${escapeHtml(categories)}</div>
            <div class="detail-title">Raw Scoring Explanation</div><div>${escapeHtml(expert.raw_scoring_explanation || candidate.quality_explanation || "No explanation recorded.")}</div>
          </div>
        </div>
      </details>
    </div>
  `;
}

function renderOccurrenceBlocks(candidate) {
  const groups = candidate.occurrence_groups || [];
  if (!groups.length) {
    return (candidate.occurrences || []).map((occ, index) =>
      `<div class="context">${index + 1}. ${escapeHtml(occ.location)}: ${escapeHtml(occ.context)}</div>`
    ).join("");
  }
  let globalIndex = 0;
  const blockHtml = groups.map((group, blockIndex) => {
    const items = (group.occurrences || []).map(occ => {
      globalIndex += 1;
      return `<div class="context">${globalIndex}. ${escapeHtml(occ.location)}: ${escapeHtml(occ.context)}</div>`;
    }).join("");
    const count = Number(group.occurrence_count || (group.occurrences || []).length || 0);
    const label = group.label || "Other occurrences";
    return `<details class="occurrence-block">
      <summary><span class="occurrence-block-title">${escapeHtml(label)}</span> <span class="inline-count">(${count})</span></summary>
      <div class="occurrence-block-items">${items || `<div class="hint">No occurrences recorded.</div>`}</div>
    </details>`;
  }).join("");
  return `<div class="occurrence-block-list">${blockHtml}</div>`;
}

function typeOptions(selected) {
  const types = [...new Set([...app.candidates.map(c => c.type), "person", "email", "phone", "cin", "long_numeric_id", "other_identifier"])].sort();
  return types.map(t => `<option value="${escapeAttr(t)}" ${t === selected ? "selected" : ""}>${escapeHtml(t)}</option>`).join("");
}

function displayDetector(source) {
  const value = String(source || "");
  const labels = {
    regex: "Regex",
    spacy: "spaCy",
    "fallback-name-regex": "Fallback Regex",
    "fallback-single-name-regex": "Fallback Regex",
    dictionary: "Dictionary",
    hybrid: "Hybrid"
  };
  return labels[value] || value;
}

function displayType(value) {
  return String(value || "unknown")
    .split("_")
    .map(part => part ? part.charAt(0).toUpperCase() + part.slice(1) : "")
    .join(" ");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[ch]));
}
function escapeAttr(value) { return escapeHtml(value); }

function replacementForAction(item, action) {
  if (action === "Rename") return item.rename_replacement || item.replacement || item.default_replacement || "";
  if (action === "Redact") return item.default_replacement || "";
  return "";
}

function savedRenameValue(item) {
  return item?.rename_replacement || (item?.decision === "Rename" ? item.replacement : "") || item?.default_replacement || "";
}

function editorHasUnsavedChanges() {
  if (!editor) return false;
  const item = app.candidates.find(c => c.key === editor.key);
  return Boolean(item) && editor.value !== savedRenameValue(item);
}

function closeEditorWithConfirm() {
  if (!editor) return true;
  if (editorHasUnsavedChanges() && !window.confirm("Discard the replacement you are editing?")) return false;
  editor = null;
  return true;
}

function openRenameEditor(key) {
  const item = qualityCandidatePool().find(c => c.key === key) || app.candidates.find(c => c.key === key);
  if (!item) return;
  if (editor && editor.key !== key && !closeEditorWithConfirm()) return;
  activeKey = key;
  editor = { key, value: savedRenameValue(item) };
  expanded.clear();
  expanded.add(key);
  page = pageForKey(visibleCandidates(), key);
  renderRows();
  focusReplacement(key);
}

async function applyEditor(shouldAdvance = true) {
  if (!editor) return;
  const key = editor.key;
  const value = editor.value;
  const item = qualityCandidatePool().find(c => c.key === key) || app.candidates.find(c => c.key === key);
  if (!item) return;
  item.decision = "Rename";
  item.replacement = value;
  item.rename_replacement = value;
  item.review_stage = "candidate_quality";
  item.review_status = "resolved";
  item.reviewer_decision = "Rename";
  qualityPendingChangeKeys.add(key);
  acceptResultChangesConfirmOpen = false;
  editor = null;
  if (shouldAdvance) activeKey = nextUndecidedAfter(visibleCandidates(), key);
  preserveDetailForActiveCandidate();
  renderCandidateQualityPanel();
  renderRows();
  await api("/api/decision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, action: "Rename", replacement: value, review_stage: "candidate_quality", inherited_decision_source: "candidate_quality" })
  });
  acknowledgeAction("Rename");
  app = await api("/api/state");
  renderRulesPanel();
  renderCandidateQualityPanel();
  renderEntityGroups();
  renderAmbiguousMatches();
  renderRows();
}

function cancelEditor() {
  if (!editor) return;
  const key = editor.key;
  editor = null;
  activeKey = key;
  renderRows();
}

function updateBulkControls(rows) {
  const visibleKeys = rows.map(row => row.key);
  const visibleSelected = visibleKeys.filter(key => selectedKeys.has(key)).length;
  const selectVisible = $("selectVisible");
  selectVisible.checked = Boolean(visibleKeys.length && visibleSelected === visibleKeys.length);
  selectVisible.indeterminate = Boolean(visibleSelected && visibleSelected < visibleKeys.length);
  $("selectedCount").textContent = `${selectedKeys.size} selected`;
  $("bulkReplacement").disabled = $("bulkAction").value !== "Rename";
}

function ruleFromCard(card) {
  return {
    mode: card.querySelector('[data-rule-field="mode"]:checked')?.value || "blanket",
    blanket: card.querySelector('[data-rule-field="blanket"]')?.value || "",
    pattern: card.querySelector('[data-rule-field="pattern"]')?.value || "{n}"
  };
}

function previewRule(rule) {
  if (rule.mode === "blanket") return [rule.blanket || "[REDACTED]"];
  const pattern = rule.pattern.includes("{n}") ? rule.pattern : `${rule.pattern}_{n}`;
  return [1, 2, 3].map(number => pattern.replace("{n}", String(number)));
}

function updateRulePreview(card) {
  const preview = previewRule(ruleFromCard(card));
  card.querySelector(".rule-preview").textContent = `Preview: ${preview.join(" / ")}`;
}

async function saveRule(card, applyExisting = false) {
  const entityType = card.dataset.ruleType;
  const overwriteManual = card.querySelector('[data-rule-field="overwriteManual"]')?.checked || false;
  const updateCount = reviewedAutoCount(entityType);
  if (applyExisting) {
    const message = `Confirm Bulk Update\n\nYou are about to update the replacement values for ${updateCount} previously reviewed ${entityType} entities.\n\nThis will overwrite automatically generated replacement values. Manually edited replacements will remain unchanged${overwriteManual ? " unless you chose to overwrite them." : "."}\n\nThis action cannot be undone with a single click.\n\nUpdate ${updateCount} entities?`;
    if (!window.confirm(message)) return;
  }
  status(applyExisting ? "Updating rule and existing replacements..." : "Rule autosaved.");
  await api("/api/rules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      entity_type: entityType,
      rule: ruleFromCard(card),
      apply_existing: applyExisting,
      overwrite_manual: overwriteManual
    })
  });
  app = await api("/api/state");
  renderRulesPanel();
  renderCandidateQualityPanel();
  renderRows();
  status(applyExisting ? "Rule saved and existing automatic replacements updated." : "Rule autosaved for future review.");
  acknowledgeAction("Save");
}

function scheduleRuleAutosave(card) {
  const entityType = card.dataset.ruleType;
  window.clearTimeout(ruleSaveTimers[entityType]);
  ruleSaveTimers[entityType] = window.setTimeout(() => {
    saveRule(card, false).catch(error => status(error.message));
  }, 500);
}

function reviewedAutoCount(entityType) {
  return app.candidates.filter(candidate =>
    candidate.type === entityType &&
    candidate.decision === "Redact" &&
    candidate.replacement_source !== "manual"
  ).length;
}

function activeNotQuiteGroup() {
  const groupId = [...notQuiteGroups][0];
  if (!groupId) return null;
  return (app.entity_groups || []).find(group => group.id === groupId) || null;
}

function notQuiteActiveKey(group) {
  const members = notQuiteMembers(group);
  if (!members.length) return null;
  if (notQuiteActiveMember[group.id] === GROUP_ROW_KEY) return GROUP_ROW_KEY;
  if (!notQuiteActiveMember[group.id] || !members.some(member => member.key === notQuiteActiveMember[group.id])) {
    notQuiteActiveMember[group.id] = members[0].key;
  }
  return notQuiteActiveMember[group.id];
}

function activeGroupCard() {
  if (!activeGroupId) return null;
  return document.querySelector(`[data-group-id="${CSS.escape(activeGroupId)}"]`);
}

function activeGroupObject() {
  if (!activeGroupId) return null;
  return (app.entity_groups || []).find(group => group.id === activeGroupId) || null;
}

function activeGroupIsExpanded() {
  return Boolean(activeGroupCard()?.classList.contains("expanded"));
}

function expandedGroupMemberKeys(group) {
  if (!group) return [];
  if (notQuiteGroups.has(group.id)) return [GROUP_ROW_KEY, ...notQuiteMembers(group).map(member => member.key)];
  return [GROUP_ROW_KEY, ...(group.members || []).map(member => member.key)];
}

function activeExpandedMemberKey(group) {
  const keys = expandedGroupMemberKeys(group);
  if (!keys.length) return null;
  if (notQuiteGroups.has(group.id)) {
    if (!notQuiteActiveMember[group.id] || !keys.includes(notQuiteActiveMember[group.id])) {
      notQuiteActiveMember[group.id] = GROUP_ROW_KEY;
    }
    return notQuiteActiveMember[group.id];
  }
  if (!groupActiveMember[group.id] || !keys.includes(groupActiveMember[group.id])) {
    groupActiveMember[group.id] = GROUP_ROW_KEY;
  }
  return groupActiveMember[group.id];
}

function setActiveExpandedMember(group, key, scroll = false) {
  if (!group || !key) return;
  if (notQuiteGroups.has(group.id)) {
    notQuiteActiveMember[group.id] = key;
    notQuiteControlIndex[group.id] = 0;
  } else {
    groupActiveMember[group.id] = key;
    groupMemberControlIndex[group.id] = 0;
  }
  renderEntityGroups();
  if (scroll) {
    window.setTimeout(() => {
      const selector = notQuiteGroups.has(group.id)
        ? `[data-group-id="${CSS.escape(group.id)}"] [data-not-quite-member="${CSS.escape(key)}"]`
        : `[data-group-id="${CSS.escape(group.id)}"] [data-member-key="${CSS.escape(key)}"]`;
      document.querySelector(selector)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }, 0);
  }
}

function expandedMemberControls(group, key) {
  const card = document.querySelector(`[data-group-id="${CSS.escape(group.id)}"]`);
  if (!card) return [];
  if (key === GROUP_ROW_KEY) {
    return [...card.querySelectorAll(".group-row [data-group-parent], .group-row [data-group-toggle], .group-row [data-group-action], .group-row [data-not-quite-exit]")]
      .filter(control => !control.disabled);
  }
  if (notQuiteGroups.has(group.id)) {
    const row = card.querySelector(`[data-not-quite-member="${CSS.escape(key)}"]`);
    return row ? [...row.querySelectorAll("[data-not-quite-action], [data-not-quite-context]")] : [];
  }
  const row = card.querySelector(`[data-member-key="${CSS.escape(key)}"]`);
  return row ? [...row.querySelectorAll("[data-group-member], [data-group-context]")] : [];
}

function focusExpandedMemberControl(group, delta) {
  const key = activeExpandedMemberKey(group);
  if (!key) return false;
  const store = notQuiteGroups.has(group.id) ? notQuiteControlIndex : groupMemberControlIndex;
  const controls = expandedMemberControls(group, key);
  if (!controls.length) return false;
  const current = Math.max(0, Math.min(store[group.id] || 0, controls.length - 1));
  const next = (current + delta + controls.length) % controls.length;
  store[group.id] = next;
  controls[next].focus();
  return true;
}

function focusGroupActionButton(delta) {
  const button = document.activeElement?.closest?.(".group-actions button");
  if (!button) return false;
  const actions = [...button.closest(".group-actions").querySelectorAll("button:not(:disabled)")];
  if (!actions.length) return false;
  const current = Math.max(0, actions.indexOf(button));
  const next = Math.max(0, Math.min(current + delta, actions.length - 1));
  actions[next].focus();
  updateGroupCommandBar(actions[next]);
  return true;
}

function inlineEditorControls(editorElement) {
  return [...editorElement.querySelectorAll("input, button")]
    .filter(control => !control.disabled && control.type !== "hidden");
}

function focusInlineEditorControl(editorElement, delta) {
  const controls = inlineEditorControls(editorElement);
  if (!controls.length) return false;
  const current = Math.max(0, controls.indexOf(document.activeElement));
  const next = (current + delta + controls.length) % controls.length;
  controls[next].focus();
  updateGroupCommandBar(controls[next]);
  return true;
}

function groupEditorRadioControls(editorElement) {
  return [...editorElement.querySelectorAll("[data-flatten-choice]")].filter(control => !control.disabled);
}

function focusFirstGroupEditorControl(groupId) {
  const card = document.querySelector(`[data-group-id="${CSS.escape(groupId)}"]`);
  const editorElement = card?.querySelector("[data-group-editor], .not-quite-editor");
  if (!editorElement) return false;
  const first = editorElement.querySelector("[data-flatten-choice], [data-group-editor-value], [data-not-quite-editor-value], button:not(:disabled)");
  if (!first) return false;
  first.focus();
  updateGroupCommandBar(first);
  return true;
}

function focusLastExpandedMemberBeforeEditor(group) {
  const keys = expandedGroupMemberKeys(group).filter(key => key !== GROUP_ROW_KEY);
  const key = keys[keys.length - 1] || GROUP_ROW_KEY;
  setActiveExpandedMember(group, key, true);
  window.setTimeout(() => focusExpandedMemberRow(group, key), 0);
  return true;
}

function handleGroupInlineEditorNavigation(event, editorElement) {
  const target = event.target;
  const group = activeGroupObject();
  const textInput = target.matches?.("[data-group-editor-value], [data-not-quite-editor-value]");
  if (textInput) return false;
  const radios = groupEditorRadioControls(editorElement);
  if (target.matches?.("[data-flatten-choice]")) {
    const index = Math.max(0, radios.indexOf(target));
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const next = Math.max(0, Math.min(radios.length - 1, index + (event.key === "ArrowRight" ? 1 : -1)));
      radios[next]?.focus();
      return true;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const input = editorElement.querySelector("[data-group-editor-value], [data-not-quite-editor-value]");
      input?.focus();
      input?.select?.();
      return true;
    }
    if (event.key === "ArrowUp" && group) {
      event.preventDefault();
      return focusLastExpandedMemberBeforeEditor(group);
    }
  }
  if (["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) {
    event.preventDefault();
    focusInlineEditorControl(editorElement, ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1);
    return true;
  }
  return false;
}

async function applyGroupInlineEditor(editorElement) {
  if (editorElement.closest(".not-quite-editor")) {
    await applyNotQuiteEditor();
    return true;
  }
  const card = editorElement.closest(".group-card");
  const applyButton = card?.querySelector("[data-group-editor-apply]");
  if (!applyButton) return false;
  applyButton.click();
  return true;
}

async function applyOpenInlineEditorForActiveGroup() {
  const editorElement = activeGroupCard()?.querySelector("[data-group-editor], .not-quite-editor");
  if (!editorElement) return false;
  await applyGroupInlineEditor(editorElement);
  return true;
}

function cancelGroupInlineEditor(editorElement) {
  if (editorElement.closest(".not-quite-editor")) {
    cancelNotQuiteEditor();
    return true;
  }
  const card = editorElement.closest(".group-card");
  const cancelButton = card?.querySelector("[data-group-editor-cancel]");
  if (!cancelButton) return false;
  cancelButton.click();
  return true;
}

function returnFocusToActiveGroup() {
  const card = activeGroupCard();
  if (!card) return false;
  card.focus({ preventScroll: true });
  updateGroupCommandBar(card);
  return true;
}

function focusFirstGroupAction(card = activeGroupCard()) {
  const button = card?.querySelector(".group-actions button:not(:disabled)");
  if (!button) return false;
  button.focus();
  updateGroupCommandBar(button);
  return true;
}

function focusExpandedMemberRow(group, key) {
  const selector = key === GROUP_ROW_KEY
    ? `[data-group-id="${CSS.escape(group.id)}"] .group-row`
    : (notQuiteGroups.has(group.id)
      ? `[data-group-id="${CSS.escape(group.id)}"] [data-not-quite-member="${CSS.escape(key)}"]`
      : `[data-group-id="${CSS.escape(group.id)}"] [data-member-key="${CSS.escape(key)}"]`);
  document.querySelector(selector)?.focus?.();
}

function toggleActiveGroupMemberSelection() {
  const group = activeGroupObject();
  const card = activeGroupCard();
  if (!group || !card || !card.classList.contains("expanded") || notQuiteGroups.has(group.id)) return false;
  const key = activeExpandedMemberKey(group);
  if (!key) return false;
  if (key === GROUP_ROW_KEY) return false;
  groupUnchecked[group.id] ||= new Set();
  groupUnchecked[group.id].has(key) ? groupUnchecked[group.id].delete(key) : groupUnchecked[group.id].add(key);
  groupEditor = null;
  renderEntityGroups();
  window.setTimeout(() => focusExpandedMemberRow(group, key), 0);
  return true;
}

function handleExpandedGroupNavigation(key) {
  const group = activeGroupObject();
  const card = activeGroupCard();
  if (!group || !card || !card.classList.contains("expanded")) return false;
  const keys = expandedGroupMemberKeys(group);
  if (!keys.length) return false;
  const currentKey = activeExpandedMemberKey(group);
  const index = Math.max(0, keys.indexOf(currentKey));
  if (key === "ArrowDown") {
    if (index >= keys.length - 1 && groupEditor?.groupId === group.id) return focusFirstGroupEditorControl(group.id);
    setActiveExpandedMember(group, keys[Math.min(keys.length - 1, index + 1)], true);
    window.setTimeout(() => focusExpandedMemberRow(group, activeExpandedMemberKey(group)), 0);
    return true;
  }
  if (key === "ArrowUp") {
    setActiveExpandedMember(group, keys[Math.max(0, index - 1)], true);
    window.setTimeout(() => focusExpandedMemberRow(group, activeExpandedMemberKey(group)), 0);
    return true;
  }
  if (key === "ArrowRight") return focusExpandedMemberControl(group, 1);
  if (key === "ArrowLeft") return focusExpandedMemberControl(group, -1);
  return false;
}

function handleGroupRowControlNavigation(key) {
  const group = activeGroupObject();
  if (!group) return false;
  if (activeGroupIsExpanded()) return handleExpandedGroupNavigation(key);
  if (key === "ArrowRight") return focusExpandedMemberControl(group, 1);
  if (key === "ArrowLeft") return focusExpandedMemberControl(group, -1);
  return false;
}

async function completeNotQuiteGroup(group) {
  await api("/api/entity-group", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ group_id: group.id, action: "Not Quite Complete", candidate_keys: group.candidate_keys })
  });
  notQuiteGroups.delete(group.id);
  delete notQuiteRemaining[group.id];
  delete notQuiteActiveMember[group.id];
  notQuiteEditor = null;
  app = await api("/api/state");
  renderEntityGroups();
  renderAmbiguousMatches();
  renderRows();
  status("Not Quite complete. Moving to the next Group Check item.");
  acknowledgeAction("Not Quite");
}

async function completeNotQuiteMember(group, key, action, replacement = "", closeWholeRow = false) {
  const member = (group.members || []).find(item => item.key === key);
  if (member) {
    member.decision = action;
    if (replacement) member.replacement = replacement;
  }
  updateVisibleGroupConfidence(group.id);
  renderEntityGroups();
  const body = { key, action };
  if (replacement) body.replacement = replacement;
  await api("/api/decision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  notQuiteEditor = null;
  app = await api("/api/state");
  if (!notQuiteRemaining[group.id]?.length) notQuiteRemaining[group.id] = [...group.candidate_keys];
  notQuiteActiveMember[group.id] = key;
  if (closeWholeRow) {
    advanceGroupCheckAfterCompletion(group.id);
  } else {
    renderEntityGroups();
    renderAmbiguousMatches();
    renderRows();
  }
  acknowledgeAction(action);
}

function openNotQuiteEditor(group, key, action) {
  const member = (group.members || []).find(item => item.key === key);
  if (!member) return;
  const fallback = action === "Rename"
    ? (member.rename_replacement || member.text)
    : (member.default_replacement || member.replacement || "");
  notQuiteActiveMember[group.id] = key;
  notQuiteEditor = { groupId: group.id, key, action, value: notQuiteDraftValue(group.id, key, action, fallback) };
  expandedGroups.add(group.id);
  renderEntityGroups();
  focusNotQuiteEditor(group.id, key);
}

async function applyNotQuiteEditor() {
  if (!notQuiteEditor) return;
  const group = (app.entity_groups || []).find(item => item.id === notQuiteEditor.groupId);
  if (!group) return;
  const value = String(notQuiteEditor.value || "").trim();
  if (!value) {
    status("Enter a value first.");
    return;
  }
  await completeNotQuiteMember(group, notQuiteEditor.key, notQuiteEditor.action, value, true);
}

function cancelNotQuiteEditor() {
  if (!notQuiteEditor) return;
  const groupId = notQuiteEditor.groupId;
  notQuiteActiveMember[groupId] = notQuiteEditor.key;
  notQuiteEditor = null;
  renderEntityGroups();
}

async function performGroupAction(group, action, card = null) {
  if (!group) return;
  const groupId = group.id;
  const unchecked = groupUnchecked[groupId] || new Set();
  const candidateKeys = group.candidate_keys.filter(key => !unchecked.has(key));
  if (!candidateKeys.length && action !== "Not Quite") {
    status("No checked items in this group.");
    return;
  }
  activeGroupId = groupId;
  if (action === "Not Quite") {
    enterNotQuite(group);
    renderEntityGroups();
    await api("/api/entity-group", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ group_id: groupId, action, candidate_keys: notQuiteRemaining[groupId] || candidateKeys })
    });
    acknowledgeAction("Not Quite");
    app = await api("/api/state");
    renderEntityGroups();
    return;
  }
  if (action === "Flatten") {
    const fallback = group.canonical_name;
    groupEditor = { groupId, action, candidateKeys, value: groupDraftValue(groupId, action, fallback) };
    expandedGroups.add(groupId);
    renderEntityGroups();
    return;
  }
  if (action === "Redact") {
    const first = group.members.find(member => candidateKeys.includes(member.key));
    const fallback = first?.default_replacement || "";
    groupEditor = { groupId, action, candidateKeys, value: groupDraftValue(groupId, action, fallback) };
    expandedGroups.add(groupId);
    renderEntityGroups();
    return;
  }
  if (groupEditor?.groupId === groupId) {
    const value = card?.querySelector("[data-group-editor-value]")?.value || "";
    saveGroupDraft(groupId, groupEditor.action, value);
  }
  groupEditor = null;
  await api("/api/entity-group", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ group_id: groupId, action, candidate_keys: candidateKeys })
  });
  app = await api("/api/state");
  delete groupUnchecked[groupId];
  advanceGroupCheckAfterCompletion(groupId);
  acknowledgeAction(groupActionDecision(action));
}

async function refresh() {
  app = await api("/api/state");
  renderRulesPanel();
  renderCandidateQualityPanel();
  renderEntityGroups();
  renderAmbiguousMatches();
  renderRows();
}

async function decide(key, action, shouldAdvance = true) {
  const item = qualityCandidatePool().find(c => c.key === key) || app.candidates.find(c => c.key === key);
  if (!item) return;
  if (action === "Rename") {
    openRenameEditor(key);
    return;
  }
  if (editor && !closeEditorWithConfirm()) return;
  if (item.review_stage === "group_check" && item.review_status === "resolved") {
    status("This candidate was resolved in Group Check. Open detail to inspect it.");
    return;
  }
  item.decision = action;
  item.replacement = replacementForAction(item, action);
  item.review_stage = "candidate_quality";
  item.review_status = "resolved";
  item.reviewer_decision = action;
  qualityPendingChangeKeys.add(key);
  acceptResultChangesConfirmOpen = false;
  if (shouldAdvance) activeKey = nextUndecidedAfter(visibleCandidates(), key);
  preserveDetailForActiveCandidate();
  renderCandidateQualityPanel();
  renderRows();
  await api("/api/decision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, action, review_stage: "candidate_quality", inherited_decision_source: "candidate_quality" })
  });
  acknowledgeAction(action);
  app = await api("/api/state");
  renderRulesPanel();
  renderCandidateQualityPanel();
  renderEntityGroups();
  renderAmbiguousMatches();
  renderRows();
}

async function toggleCandidateQualityDisposition(key, shouldAdvance = true) {
  const rows = visibleCandidates();
  const item = rows.find(candidate => candidate.key === key);
  if (!item) return;
  if (item.review_stage === "group_check" && item.review_status === "resolved") {
    status("This candidate was resolved in Group Check. Open detail to inspect it.");
    return;
  }
  const current = candidateQualityStatus(item);
  const nextStatus = current === "resolved" ? "unresolved" : "resolved";
  item.review_stage = "candidate_quality";
  item.review_status = nextStatus;
  item.reviewer_decision = nextStatus === "resolved" ? "Candidate Quality Resolved" : "Candidate Quality Unresolved";
  qualityPendingChangeKeys.add(key);
  acceptResultChangesConfirmOpen = false;
  if (shouldAdvance && nextStatus === "resolved") {
    const idx = Math.max(0, rows.findIndex(candidate => candidate.key === key));
    activeKey = rows[Math.min(rows.length - 1, idx + 1)]?.key || key;
  }
  preserveDetailForActiveCandidate();
  renderCandidateQualityPanel();
  renderRows();
  await api("/api/candidate-quality/disposition", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ key, status: nextStatus })
  });
  acknowledgeAction(nextStatus === "resolved" ? "Resolve" : "Undo");
  app = await api("/api/state");
  renderCandidateQualityPanel();
  renderRows();
}

$("rows").addEventListener("click", async (event) => {
  if (event.target.closest("[data-candidate-detail-close]")) return;
  const editorButton = event.target.closest("[data-editor-action]");
  if (editorButton) {
    event.preventDefault();
    event.stopPropagation();
    if (editorButton.dataset.editorAction === "apply") await applyEditor(true);
    if (editorButton.dataset.editorAction === "cancel") cancelEditor();
    return;
  }
  if (isEditableTextTarget(event.target) || event.target.closest("details, summary")) return;
  const cell = event.target.closest(".candidate-cell");
  if (!cell) return;
  acceptResultChangesConfirmOpen = false;
  updateAcceptResultChangesControls();
  activeGroupId = null;
  groupCheckKeyboardArmed = false;
  markActiveCandidateCell(cell);
  if (!cell.classList.contains("candidate-cell-expanded")) {
    expanded.clear();
    expanded.add(activeKey);
    preserveDetailForActiveCandidate();
    renderRows();
    window.setTimeout(() => document.querySelector(`.candidate-cell[data-key="${CSS.escape(activeKey)}"]`)?.focus(), 0);
    return;
  }
  cell.focus();
});

$("rows").addEventListener("keydown", (event) => {
  if (isEditableTextTarget(event.target)) return;
  if (!["d", "."].includes(event.key.toLowerCase())) return;
  const cell = event.target.closest(".candidate-cell") || document.querySelector(`.candidate-cell[data-key="${CSS.escape(activeKey || "")}"]`);
  if (!cell?.dataset.key) return;
  event.preventDefault();
  event.stopPropagation();
  toggleCandidateDetail(cell.dataset.key);
});

$("rows").addEventListener("click", (event) => {
  if (!event.target.closest("[data-candidate-detail-close]")) return;
  event.preventDefault();
  event.stopPropagation();
  const panel = event.target.closest("[data-candidate-detail-for]");
  if (panel?.dataset.candidateDetailFor) activeKey = panel.dataset.candidateDetailFor;
  expanded.delete(activeKey);
  renderRows();
  window.setTimeout(() => document.querySelector(`.candidate-cell[data-key="${CSS.escape(activeKey)}"]`)?.focus(), 0);
});

$("entityGroups").addEventListener("pointerdown", (event) => {
  armGroupCheckKeyboard(event.target);
});

$("entityGroups").addEventListener("click", async (event) => {
  const card = event.target.closest(".group-card");
  if (!card) return;
  const groupId = card.dataset.groupId;
  const group = (app.entity_groups || []).find(item => item.id === groupId);
  if (!group) return;
  armGroupCheckKeyboard(event.target);
  updateGroupCommandBar(event.target);
  if (event.target.closest("[data-not-quite-exit]")) {
    exitNotQuite(groupId);
    renderEntityGroups();
    return;
  }
  const notQuiteMemberRow = event.target.closest("[data-not-quite-member]");
  if (notQuiteMemberRow) {
    const key = notQuiteMemberRow.dataset.notQuiteMember;
    notQuiteActiveMember[groupId] = key;
    if (event.target.closest("[data-not-quite-context]")) {
      groupContext[groupId] = groupContext[groupId] === key ? null : key;
      renderEntityGroups();
      return;
    }
    const actionButton = event.target.closest("[data-not-quite-action]");
    if (actionButton) {
      const action = actionButton.dataset.notQuiteAction;
      if (["Keep", "Ignore"].includes(action)) {
        await completeNotQuiteMember(group, key, action);
        return;
      }
      openNotQuiteEditor(group, key, action);
      return;
    }
  }
  if (event.target.closest("[data-not-quite-editor-cancel]")) {
    cancelNotQuiteEditor();
    return;
  }
  if (event.target.closest("[data-not-quite-editor-apply]")) {
    await applyNotQuiteEditor();
    return;
  }
  if (event.target.matches("[data-not-quite-editor-value]")) return;
  if (event.target.closest("[data-group-editor-cancel]")) {
    const value = card.querySelector("[data-group-editor-value]")?.value || "";
    saveGroupDraft(groupId, groupEditor?.action, value);
    groupEditor = null;
    renderEntityGroups();
    return;
  }
  if (event.target.closest("[data-flatten-choice]")) {
    groupEditor.value = event.target.value;
    saveGroupDraft(groupId, groupEditor.action, groupEditor.value);
    renderEntityGroups();
    return;
  }
  if (event.target.matches("[data-group-editor-value]")) return;
  if (event.target.closest("[data-group-editor-apply]")) {
    const value = card.querySelector("[data-group-editor-value]")?.value.trim() || "";
    if (!value) {
      status("Choose or enter a value first.");
      return;
    }
    const acceptedAction = groupEditor.action;
    saveGroupDraft(groupId, groupEditor.action, value);
    await api("/api/entity-group", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ group_id: groupId, action: groupEditor.action, candidate_keys: groupEditor.candidateKeys, replacement: value })
    });
    groupEditor = null;
    app = await api("/api/state");
    advanceGroupCheckAfterCompletion(groupId);
    acknowledgeAction(groupActionDecision(acceptedAction));
    return;
  }
  const parentCheckbox = event.target.closest("[data-group-parent]");
  if (parentCheckbox) {
    const selectedKeys = groupSelectedKeys(group);
    if (selectedKeys.length === group.candidate_keys.length) {
      groupUnchecked[groupId] = new Set(group.candidate_keys);
    } else {
      groupUnchecked[groupId] = new Set();
    }
    if (groupEditor?.groupId === groupId) {
      const value = card.querySelector("[data-group-editor-value]")?.value || "";
      saveGroupDraft(groupId, groupEditor.action, value);
    }
    groupEditor = null;
    renderEntityGroups();
    return;
  }
  if (event.target.closest("[data-group-toggle]") || (event.target.closest(".group-row") && !event.target.closest("[data-group-action]") && !event.target.closest("input, button"))) {
    expandedGroups.has(groupId) ? expandedGroups.delete(groupId) : expandedGroups.add(groupId);
    renderEntityGroups();
    setActiveGroup(groupId);
    window.setTimeout(() => focusGroupCardById(groupId), 0);
    return;
  }
  const contextButton = event.target.closest("[data-group-context]");
  if (contextButton) {
    const key = contextButton.dataset.groupContext;
    groupActiveMember[groupId] = key;
    groupContext[groupId] = groupContext[groupId] === key ? null : key;
    renderEntityGroups();
    return;
  }
  const memberCheckbox = event.target.closest("[data-group-member]");
  if (memberCheckbox) {
    const key = event.target.closest("[data-member-key]").dataset.memberKey;
    groupActiveMember[groupId] = key;
    groupUnchecked[groupId] ||= new Set();
    memberCheckbox.checked ? groupUnchecked[groupId].delete(key) : groupUnchecked[groupId].add(key);
    if (groupEditor?.groupId === groupId) {
      const value = card.querySelector("[data-group-editor-value]")?.value || "";
      saveGroupDraft(groupId, groupEditor.action, value);
    }
    groupEditor = null;
    renderEntityGroups();
    return;
  }
  const memberRow = event.target.closest("[data-member-key]");
  if (memberRow) {
    groupActiveMember[groupId] = memberRow.dataset.memberKey;
    renderEntityGroups();
    return;
  }
  const actionButton = event.target.closest("[data-group-action]");
  if (actionButton) {
    const action = actionButton.dataset.groupAction;
    await performGroupAction(group, action, card);
  }
});

$("entityGroups").addEventListener("input", (event) => {
  if (event.target.matches("[data-not-quite-editor-value]")) {
    if (!notQuiteEditor) return;
    notQuiteEditor.value = event.target.value;
    saveNotQuiteDraft(notQuiteEditor.groupId, notQuiteEditor.key, notQuiteEditor.action, notQuiteEditor.value);
    updateVisibleGroupConfidence(notQuiteEditor.groupId);
    return;
  }
  if (!event.target.matches("[data-group-editor-value]")) return;
  const card = event.target.closest(".group-card");
  if (!card || !groupEditor || groupEditor.groupId !== card.dataset.groupId) return;
  groupEditor.value = event.target.value;
  saveGroupDraft(groupEditor.groupId, groupEditor.action, groupEditor.value);
  updateVisibleGroupConfidence(groupEditor.groupId);
});

$("finishEntityResolution").addEventListener("click", async (event) => {
  event.preventDefault();
  event.stopPropagation();
  finishEntityResolutionConfirmOpen = true;
  renderFinishEntityResolutionConfirm();
  status("Confirm Done Editing to process and clear completed Group Check items.");
});

$("finishEntityResolutionNo").addEventListener("click", (event) => {
  event.preventDefault();
  event.stopPropagation();
  finishEntityResolutionConfirmOpen = false;
  renderFinishEntityResolutionConfirm();
  status("");
});

$("finishEntityResolutionYes").addEventListener("click", async (event) => {
  event.preventDefault();
  event.stopPropagation();
  finishEntityResolutionConfirmOpen = false;
  status("Processing Group Check items...");
  const result = await api("/api/entity-resolution/done", { method: "POST" });
  app = await api("/api/state");
  renderEntityGroups();
  renderAmbiguousMatches();
  renderRows();
  status(`Processed ${result.finished || 0} Group Check item${result.finished === 1 ? "" : "s"}.`);
  acknowledgeAction("Save");
});

$("ambiguousMatches").addEventListener("click", async (event) => {
  const card = event.target.closest(".ambiguous-card");
  if (!card) return;
  const key = card.dataset.ambiguousKey;
  const priorKey = activeAmbiguousKey;
  const transferContext = priorKey && priorKey !== key && ambiguousContext[priorKey];
  const clickedContext = event.target.closest("[data-ambiguous-context]");
  activeAmbiguousKey = key;
  if (transferContext && !clickedContext) {
    ambiguousContext = {};
    ambiguousContext[key] = true;
  }
  if (clickedContext) {
    if (transferContext) {
      ambiguousContext = {};
      ambiguousContext[key] = true;
    } else {
      ambiguousContext[key] = !ambiguousContext[key];
    }
    renderAmbiguousMatches();
    window.setTimeout(() => document.querySelector(`[data-ambiguous-key="${CSS.escape(key)}"]`)?.focus(), 0);
    return;
  }
  const actionButton = event.target.closest("[data-ambiguous-action]");
  if (!actionButton) {
    renderAmbiguousMatches();
    window.setTimeout(() => document.querySelector(`[data-ambiguous-key="${CSS.escape(key)}"]`)?.focus(), 0);
    return;
  }
  const action = actionButton.dataset.ambiguousAction;
  await completeAmbiguousAction(key, action);
});

["erSearch", "erTypeFilter", "erSort", "erDirection", "erPageSize"].forEach(id => $(id).addEventListener("input", () => {
  erPage = 0;
  renderEntityGroups();
}));

$("erPager").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-stage-page]");
  if (!button) return;
  if (button.dataset.stagePage === "prev") erPage -= 1;
  if (button.dataset.stagePage === "next") erPage += 1;
  renderEntityGroups();
});

["amSearch", "amTypeFilter", "amSort", "amDirection", "amPageSize"].forEach(id => $(id).addEventListener("input", () => {
  amPage = 0;
  renderAmbiguousMatches();
}));

$("amPager").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-stage-page]");
  if (!button) return;
  if (button.dataset.stagePage === "prev") amPage -= 1;
  if (button.dataset.stagePage === "next") amPage += 1;
  renderAmbiguousMatches();
});

$("pager").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-page]");
  if (!button) return;
  const rows = visibleCandidates();
  if (button.dataset.page === "prev") page -= 1;
  if (button.dataset.page === "next") page += 1;
  clampPage(rows);
  const start = page * pageSize();
  activeKey = rows[start]?.key || null;
  renderRows();
});

$("acceptResultChanges").addEventListener("click", () => {
  if (!qualityPendingChangeKeys.size) return;
  acceptResultChangesConfirmOpen = true;
  updateAcceptResultChangesControls();
});

$("acceptResultChangesYes").addEventListener("click", () => acceptQualityResultChanges());

$("acceptResultChangesNo").addEventListener("click", () => {
  acceptResultChangesConfirmOpen = false;
  updateAcceptResultChangesControls();
  status("Changes left in the current Results view.");
});

$("confidenceTabs").addEventListener("click", (event) => {
  const tab = event.target.closest("button[data-confidence]");
  if (!tab) return;
  if (editor && !closeEditorWithConfirm()) return;
  confidenceTab = tab.dataset.confidence;
  page = 0;
  activeKey = null;
  renderRows();
});

$("rows").addEventListener("change", async (event) => {
  const record = event.target.closest(".record");
  if (!record) return;
  const item = app.candidates.find(c => c.key === record.dataset.key);
  if (!item) return;
  if (event.target.dataset.kind === "type") item.type = event.target.value;
  await api("/api/decision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: record.dataset.key, type: item.type }) });
  acknowledgeAction("Save");
  renderRows();
});

$("rows").addEventListener("input", (event) => {
  if (!editor || event.target.dataset.kind !== "rename-editor") return;
  editor.value = event.target.value;
});

document.addEventListener("focusin", (event) => {
  if (event.target.closest?.("#entityGroups")) armGroupCheckKeyboard(event.target);
  else disarmGroupCheckKeyboardIfOutside(event.target);
  updateGroupCommandBar(event.target);
});

document.addEventListener("focusout", () => {
  window.clearTimeout(commandBarHideTimer);
  commandBarHideTimer = window.setTimeout(() => updateGroupCommandBar(document.activeElement), 80);
});

document.addEventListener("pointerdown", (event) => {
  disarmGroupCheckKeyboardIfOutside(event.target);
}, true);

document.addEventListener("keydown", (event) => {
  handleArmedGroupCheckSpace(event);
}, true);

document.addEventListener("keydown", (event) => {
  if (event.defaultPrevented || !["d", "."].includes(event.key.toLowerCase()) || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
  if (isEditableTextTarget(event.target)) return;
  const focusedCell = event.target.closest?.(".candidate-cell") || document.activeElement?.closest?.(".candidate-cell");
  const resultsHaveFocus = Boolean(event.target.closest?.("#rows") || document.activeElement?.closest?.("#rows"));
  if (!resultsHaveFocus) return;
  const key = focusedCell?.dataset.key || activeKey;
  if (!key) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  toggleCandidateDetail(key);
}, true);

document.addEventListener("keydown", async (event) => {
  if (event.defaultPrevented) return;
  if (acceptResultChangesConfirmOpen && qualityPendingChangeKeys.size) {
    const tag = event.target.tagName.toLowerCase();
    const isTyping = ["input", "textarea", "select"].includes(tag);
    if (!isTyping && event.key.toLowerCase() === "y") {
      event.preventDefault();
      acceptQualityResultChanges();
      return;
    }
    if (!isTyping && event.key.toLowerCase() === "n") {
      event.preventDefault();
      acceptResultChangesConfirmOpen = false;
      updateAcceptResultChangesControls();
      status("Changes left in the current Results view.");
      return;
    }
  }
  const inlineGroupEditor = event.target.closest?.("[data-group-editor], .not-quite-editor");
  if (inlineGroupEditor) {
    const isTextInput = ["input", "textarea"].includes(event.target.tagName.toLowerCase()) && !["radio", "checkbox", "button", "submit"].includes(event.target.type);
    if (event.key === "Tab") {
      event.preventDefault();
      groupEditor = null;
      notQuiteEditor = null;
      navigateActiveGroupSequence(event.shiftKey ? -1 : 1);
      return;
    }
    if (handleGroupInlineEditorNavigation(event, inlineGroupEditor)) return;
    if (event.key === "Enter") {
      if (event.target.closest("button")) return;
      event.preventDefault();
      await applyGroupInlineEditor(inlineGroupEditor);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeGroupInlineEditor(inlineGroupEditor);
      return;
    }
    if (!isTextInput && event.key.toLowerCase() === "a") {
      event.preventDefault();
      await applyGroupInlineEditor(inlineGroupEditor);
      return;
    }
  }
  if (event.target.matches?.("[data-not-quite-editor-value]")) {
    if (event.key === "Enter") {
      event.preventDefault();
      await applyNotQuiteEditor();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      const inlineEditor = event.target.closest(".not-quite-editor");
      if (inlineEditor) closeGroupInlineEditor(inlineEditor);
      else cancelNotQuiteEditor();
      return;
    }
  }
  if (event.target.dataset?.kind === "rename-editor") {
    if (event.key === "Tab") {
      event.preventDefault();
      editor = null;
      tabMoveActiveResult(event.shiftKey ? -1 : 1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      await applyEditor(true);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      cancelEditor();
      return;
    }
  }
  const tag = event.target.tagName.toLowerCase();
  const groupArrowKeys = new Set(["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"]);
  const inGroupCheck = Boolean(event.target.closest?.("#entityGroups"));
  const inAmbiguityCheck = Boolean(event.target.closest?.("#ambiguousMatches"));
  const groupCheckActiveForKey = inGroupCheck || (groupCheckKeyboardArmed && activeGroupId && activeGroupCard());
  const editingGroupField = inGroupCheck && ["input", "textarea", "select"].includes(tag) && event.target.type !== "checkbox";
  const typingOutsideGroupCheck = ["input", "textarea", "select"].includes(tag) && !inGroupCheck;
  const resultsKeyboardActive = resultGridHasKeyboardFocus(event);
  if (inAmbiguityCheck && !isEditableTextTarget(event.target)) {
    const card = event.target.closest?.(".ambiguous-card") || document.activeElement?.closest?.(".ambiguous-card");
    if (card?.dataset.ambiguousKey) activeAmbiguousKey = card.dataset.ambiguousKey;
    if (groupArrowKeys.has(event.key)) {
      event.preventDefault();
      moveActiveAmbiguous(["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1);
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      tabMoveActiveAmbiguous(event.shiftKey ? -1 : 1);
      return;
    }
    if ((isSpaceKey(event) || ["d", "."].includes(event.key.toLowerCase())) && activeAmbiguousKey) {
      event.preventDefault();
      ambiguousContext[activeAmbiguousKey] = !ambiguousContext[activeAmbiguousKey];
      renderAmbiguousMatches();
      window.setTimeout(() => document.querySelector(`[data-ambiguous-key="${CSS.escape(activeAmbiguousKey)}"]`)?.focus(), 0);
      return;
    }
    if (event.key === "Home") {
      const first = visibleAmbiguousMatches()[0]?.candidate?.key;
      if (first) {
        event.preventDefault();
        setActiveAmbiguous(first, true);
      }
      return;
    }
    if (event.key === "End") {
      const rows = visibleAmbiguousMatches();
      const last = rows[rows.length - 1]?.candidate?.key;
      if (last) {
        event.preventDefault();
        setActiveAmbiguous(last, true);
      }
      return;
    }
    const ambiguousAction = reviewActionForEvent(event);
    if (ambiguousAction && activeAmbiguousKey) {
      event.preventDefault();
      await completeAmbiguousAction(activeAmbiguousKey, ambiguousAction);
      return;
    }
  }
  if (groupCheckActiveForKey && event.key.toLowerCase() === "a" && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && !isEditableTextTarget(event.target)) {
    if (await applyOpenInlineEditorForActiveGroup()) {
      event.preventDefault();
      return;
    }
  }
  if (editingGroupField) return;
  if (inGroupCheck && (isSpaceKey(event) || event.key === "Enter") && event.target.matches?.("input[type='checkbox']")) {
    if (event.key === "Enter") {
      event.preventDefault();
      event.target.click();
    }
    return;
  }
  if (inGroupCheck && isSpaceKey(event) && event.target.closest?.("button")) return;
  if (inGroupCheck && event.key === "Tab" && event.target.closest?.(".group-card")) {
    event.preventDefault();
    groupEditor = null;
    notQuiteEditor = null;
    navigateActiveGroupSequence(event.shiftKey ? -1 : 1);
    return;
  }
  if (inGroupCheck && event.target.closest?.(".group-actions")) {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      focusGroupActionButton(event.key === "ArrowRight" ? 1 : -1);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      returnFocusToActiveGroup();
      return;
    }
    if (isSpaceKey(event)) return;
  }
  if (!resultsKeyboardActive && !typingOutsideGroupCheck && activeGroupId && groupArrowKeys.has(event.key) && document.querySelector(`[data-group-id="${CSS.escape(activeGroupId)}"]`)) {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      handleGroupRowControlNavigation(event.key);
      return;
    }
    if (activeGroupIsExpanded()) {
      event.preventDefault();
      handleExpandedGroupNavigation(event.key);
      return;
    }
    event.preventDefault();
    navigateActiveGroup(event.key);
    return;
  }
  if (!resultsKeyboardActive && !typingOutsideGroupCheck && activeGroupId && (isSpaceKey(event) || event.key === "Enter") && document.querySelector(`[data-group-id="${CSS.escape(activeGroupId)}"]`)) {
    if (event.key === "Enter" && event.target.closest?.("button")) return;
    event.preventDefault();
    const activeGroup = activeGroupObject();
    const activeRow = activeGroup ? activeExpandedMemberKey(activeGroup) : GROUP_ROW_KEY;
    if (activeGroupIsExpanded() && activeRow !== GROUP_ROW_KEY && notQuiteGroups.has(activeGroup?.id)) return;
    if (!toggleActiveGroupMemberSelection()) toggleActiveGroupExpanded();
    return;
  }
  if (!resultsKeyboardActive && !typingOutsideGroupCheck && activeGroupId && event.key === "Escape" && activeGroupCard()?.classList.contains("expanded")) {
    event.preventDefault();
    expandedGroups.delete(activeGroupId);
    renderEntityGroups();
    setActiveGroup(activeGroupId, true);
    return;
  }
  if (event.key === "Enter" && event.target.closest?.("button") && !event.target.closest?.(".candidate-cell")) return;
  if (resultsKeyboardActive && event.shiftKey && ["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(event.key)) {
    event.preventDefault();
    navigateQualityCategory(event.key);
    return;
  }
  if (resultsKeyboardActive && event.key === "Tab") {
    event.preventDefault();
    tabMoveActiveResult(event.shiftKey ? -1 : 1);
    return;
  }
  if (resultsKeyboardActive && event.shiftKey && (event.key === "+" || event.key === "=")) {
    event.preventDefault();
    setCandidateDetailSections(true);
    return;
  }
  if (resultsKeyboardActive && event.shiftKey && (event.key === "-" || event.key === "_")) {
    event.preventDefault();
    expanded.clear();
    renderRows();
    focusActiveResultCell();
    return;
  }
  if (["input", "textarea", "select"].includes(tag) || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
  const notQuiteGroup = activeNotQuiteGroup();
  if (!resultsKeyboardActive && notQuiteGroup) {
    if (event.key === "Escape") {
      event.preventDefault();
      exitNotQuite(notQuiteGroup.id);
      renderEntityGroups();
      return;
    }
    const members = notQuiteMembers(notQuiteGroup);
    if (members.length) {
      const currentKey = notQuiteActiveKey(notQuiteGroup);
      const idx = Math.max(0, members.findIndex(member => member.key === currentKey));
      if (event.key === "ArrowDown") {
        event.preventDefault();
        notQuiteActiveMember[notQuiteGroup.id] = members[Math.min(members.length - 1, idx + 1)].key;
        renderEntityGroups();
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        notQuiteActiveMember[notQuiteGroup.id] = members[Math.max(0, idx - 1)].key;
        renderEntityGroups();
        return;
      }
      const key = notQuiteActiveMember[notQuiteGroup.id];
      const lower = event.key.toLowerCase();
      if (lower === "k") {
        event.preventDefault();
        await completeNotQuiteMember(notQuiteGroup, key, "Keep");
        return;
      }
      if (lower === "n") {
        event.preventDefault();
        openNotQuiteEditor(notQuiteGroup, key, "Rename");
        return;
      }
      if (lower === "r") {
        event.preventDefault();
        openNotQuiteEditor(notQuiteGroup, key, "Redact");
        return;
      }
      if (lower === "i") {
        event.preventDefault();
        await completeNotQuiteMember(notQuiteGroup, key, "Ignore");
        return;
      }
      if (lower === "c") {
        event.preventDefault();
        groupContext[notQuiteGroup.id] = groupContext[notQuiteGroup.id] === key ? null : key;
        renderEntityGroups();
        return;
      }
    }
  }
  const activeGroup = activeGroupId ? (app.entity_groups || []).find(group => group.id === activeGroupId) : null;
  if (!resultsKeyboardActive && activeGroup && document.querySelector(`[data-group-id="${CSS.escape(activeGroup.id)}"]`)) {
    const lower = event.key.toLowerCase();
    const groupKeyActions = { k: "Keep as-is", n: "Flatten", r: "Redact", i: "Ignore", q: "Not Quite" };
    const groupAction = groupKeyActions[lower];
    if (groupAction) {
      event.preventDefault();
      await performGroupAction(activeGroup, groupAction, document.querySelector(`[data-group-id="${CSS.escape(activeGroup.id)}"]`));
      return;
    }
  }
  if (resultsKeyboardActive) {
    const rows = visibleCandidates();
    if (!rows.length) return;
    const columns = candidateGridColumnCount();
    if (event.key === "ArrowRight") { event.preventDefault(); moveActiveResult(1); return; }
    if (event.key === "ArrowLeft") { event.preventDefault(); moveActiveResult(-1); return; }
    if (event.key === "ArrowDown") { event.preventDefault(); moveActiveResult(columns); return; }
    if (event.key === "ArrowUp") { event.preventDefault(); moveActiveResult(-columns); return; }
    if (event.key === "Home") { event.preventDefault(); setActive(rows[0].key, true); return; }
    if (event.key === "End") { event.preventDefault(); setActive(rows[rows.length - 1].key, true); return; }
    if (isSpaceKey(event) && activeKey) {
      event.preventDefault();
      toggleCandidateDetail(activeKey);
      return;
    }
    if (event.key === "Escape" && expanded.size) {
      event.preventDefault();
      expanded.clear();
      renderRows();
      focusActiveResultCell();
      return;
    }
    if (event.key === "/") {
      event.preventDefault();
      $("search").focus();
      $("search").select();
      return;
    }
    const resultAction = reviewActionForEvent(event);
    if (activeKey && resultAction) {
      event.preventDefault();
      await decide(activeKey, resultAction);
      return;
    }
  }
});

["search", "typeFilter", "sort", "direction", "pageSize"].forEach(id => $(id).addEventListener("input", () => {
  if (editor && !closeEditorWithConfirm()) return;
  acceptResultChangesConfirmOpen = false;
  page = 0;
  activeKey = null;
  if (id === "search" || id === "typeFilter") {
    resetQualityResultSet();
    clearQualityPendingChanges();
  }
  renderRows();
}));

$("selectVisible").addEventListener("change", () => {
  visibleCandidates().forEach(row => {
    $("selectVisible").checked ? selectedKeys.add(row.key) : selectedKeys.delete(row.key);
  });
  renderRows();
});

$("bulkAction").addEventListener("change", () => updateBulkControls(visibleCandidates()));
$("clearSelection").addEventListener("click", () => {
  selectedKeys.clear();
  renderRows();
});

$("rulesGrid").addEventListener("input", (event) => {
  const card = event.target.closest(".rule-row");
  if (card) {
    updateRulePreview(card);
    if (event.target.dataset.ruleField !== "overwriteManual") scheduleRuleAutosave(card);
  }
});

$("rulesGrid").addEventListener("change", (event) => {
  const card = event.target.closest(".rule-row");
  if (card) {
    updateRulePreview(card);
    if (event.target.dataset.ruleField === "mode") scheduleRuleAutosave(card);
  }
});

$("rulesGrid").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-rule-action='save']");
  if (!button) return;
  const card = button.closest(".rule-row");
  await saveRule(card, true);
});

$("qualityGrid").addEventListener("click", async (event) => {
  const navButton = event.target.closest("[data-quality-nav]");
  if (navButton) {
    if (editor && !closeEditorWithConfirm()) return;
    const kind = navButton.dataset.qualityNav;
    const key = navButton.dataset.qualityKey;
    if (kind === "state") {
      qualityNavigator.reviewState = key;
      qualityNavigator.category = "__all__";
      qualityNavigator.context = "__all__";
    }
    if (kind === "category") {
      qualityNavigator.category = key;
      qualityNavigator.context = "__all__";
    }
    if (kind === "context") {
      qualityNavigator.context = key;
    }
    page = 0;
    activeKey = null;
    resetQualityResultSet();
    clearQualityPendingChanges();
    selectedKeys.clear();
    renderCandidateQualityPanel();
    renderRows();
    return;
  }
  const restoreButton = event.target.closest("[data-quality-restore]");
  if (restoreButton) {
    const keys = restoreButton.dataset.qualityRestore.split("|").filter(Boolean);
    await api("/api/candidate-quality/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys })
    });
    qualityDetailCache = {};
    app = await api("/api/state");
    renderCandidateQualityPanel();
    renderEntityGroups();
    renderAmbiguousMatches();
    renderRows();
    status("Restored filtered candidate to this review session.");
    acknowledgeAction("Restore");
    return;
  }
  const metricButton = event.target.closest("[data-quality-metric]");
  if (!metricButton) return;
  await toggleQualityMetric(metricButton);
});

$("qualityGrid").addEventListener("change", (event) => {
  if (event.target.id === "qualityCategorySort") {
    qualityNavigator.categorySort = event.target.value;
    renderCandidateQualityPanel();
    return;
  }
  if (event.target.id === "qualityShowEmptyCategories") {
    qualityNavigator.showEmptyCategories = event.target.checked;
    renderCandidateQualityPanel();
  }
});

$("advancedRules").addEventListener("click", (event) => event.stopPropagation());
$("advancedRules").addEventListener("change", (event) => {
  $("rulesPanel").classList.toggle("advanced", event.target.checked);
});

$("applyBulk").addEventListener("click", async () => {
  const keys = [...selectedKeys];
  if (!keys.length) return;
  if (editor && !closeEditorWithConfirm()) return;
  const action = $("bulkAction").value;
  const replacement = $("bulkReplacement").value;
  if (action === "Rename" && !replacement.trim()) {
    status("Enter a replacement before applying Rename to selected rows.");
    return;
  }
  status("Applying bulk decision...");
  for (const key of keys) {
    const item = app.candidates.find(c => c.key === key);
    if (!item) continue;
    item.decision = action;
    item.replacement = action === "Rename" ? replacement : replacementForAction(item, action);
    if (action === "Rename") item.rename_replacement = replacement;
    await api("/api/decision", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action === "Rename" ? { key, action, replacement } : { key, action })
    });
  }
  app = await api("/api/state");
  renderRulesPanel();
  renderCandidateQualityPanel();
  renderEntityGroups();
  renderAmbiguousMatches();
  selectedKeys.clear();
  status("Bulk decision applied.");
  acknowledgeAction("Bulk Apply");
  renderRows();
});

$("scan").addEventListener("click", async () => {
  const file = $("file").files[0];
  if (!file) { status("Choose a DOCX first."); return; }
  status("Scanning locally...");
  const form = new FormData();
  form.append("docx", file);
  app = await api("/api/scan", { method: "POST", body: form });
  activeQualityMetric = null;
  activeQualityButton = null;
  qualityNavigator = { reviewState: "to_review", category: "__all__", context: "__all__", categorySort: "frequency_desc", showEmptyCategories: false };
  resetQualityResultSet();
  clearQualityPendingChanges();
  qualityDetailCache = {};
  activeKey = null;
  editor = null;
  expanded.clear();
  selectedKeys.clear();
  page = 0;
  erPage = 0;
  amPage = 0;
  status("Scan complete.");
  acknowledgeAction("Scan");
  renderRulesPanel();
  renderCandidateQualityPanel();
  renderEntityGroups();
  renderAmbiguousMatches();
  renderRows();
});

$("generate").addEventListener("click", async () => {
  try {
    status("Generating output...");
    const outputs = await api("/api/generate", { method: "POST" });
    $("downloads").innerHTML = `<a href="${outputs.redacted_docx}">DOCX</a><a href="${outputs.audit_csv}">CSV log</a><a href="${outputs.decisions_json}">Decisions</a><a href="${outputs.qa_metrics_json}">QA metrics</a>`;
    const folder = outputs.output_folder ? ` Saved to ${outputs.output_folder}.` : "";
    status((Object.keys(outputs.remaining_originals || {}).length ? "Generated. Some originals remain; inspect report." : "Generated. Rescan found no selected originals.") + folder);
    acknowledgeAction("Save");
  } catch (error) {
    status(error.message);
  }
});

$("restartApp").addEventListener("click", async () => {
  const button = $("restartApp");
  const restartStatus = $("restartStatus");
  button.disabled = true;
  restartStatus.textContent = "Restarting...";
  try {
    await fetch("/api/dev/restart", { method: "POST" });
  } catch {}

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 500));
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      if (response.ok) {
        window.location.reload();
        return;
      }
    } catch {}
  }
  restartStatus.textContent = "The application did not restart within 15 seconds.";
  button.disabled = false;
});

refresh().catch(() => {});
</script>
</body>
</html>
"""


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, data: Any, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_error(self, error: Exception, status: HTTPStatus = HTTPStatus.BAD_REQUEST) -> None:
        self._send_json({"error": str(error)}, status)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/":
            body = HTML.encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if parsed.path == "/api/state":
            self._send_json(payload())
            return
        if parsed.path == "/api/health":
            self._send_json({"ok": True, "build": APP_BUILD})
            return
        if parsed.path == "/api/candidate-quality":
            metric = parse_qs(parsed.query).get("metric", ["filtered"])[0]
            self._send_json(candidate_quality_detail(metric))
            return
        if parsed.path.startswith("/assets/"):
            path = ASSET_DIR / Path(parsed.path).name
            if not path.exists() or not path.is_file():
                self._send_error(FileNotFoundError("Asset not found."), HTTPStatus.NOT_FOUND)
                return
            body = path.read_bytes()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", mimetypes.guess_type(path.name)[0] or "application/octet-stream")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if parsed.path == "/api/counts":
            self._send_json(payload()["counts"])
            return
        if parsed.path.startswith("/download/"):
            path = output_dir() / Path(parsed.path).name
            if not path.exists():
                self._send_error(FileNotFoundError("Output file not found."), HTTPStatus.NOT_FOUND)
                return
            body = path.read_bytes()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", mimetypes.guess_type(path.name)[0] or "application/octet-stream")
            self.send_header("Content-Disposition", f'attachment; filename="{path.name}"')
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self._send_error(FileNotFoundError("Not found."), HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        try:
            if parsed.path == "/api/scan":
                length = int(self.headers.get("Content-Length", "0"))
                content_type = self.headers.get("Content-Type", "")
                boundary = content_type.split("boundary=", 1)[1].encode("utf-8")
                body = self.rfile.read(length)
                marker = b"--" + boundary
                file_bytes = b""
                filename = "uploaded.docx"
                for part in body.split(marker):
                    if b'name="docx"' not in part:
                        continue
                    header, _, content = part.partition(b"\r\n\r\n")
                    content = content.rsplit(b"\r\n", 1)[0]
                    file_bytes = content
                    header_text = header.decode("utf-8", errors="ignore")
                    if "filename=" in header_text:
                        filename = header_text.split("filename=", 1)[1].split("\r\n", 1)[0].strip('"')
                    break
                if not file_bytes:
                    raise ValueError("No DOCX file was uploaded.")
                scan_uploaded_docx(filename, file_bytes)
                self._send_json(payload())
                return
            if parsed.path == "/api/decision":
                length = int(self.headers.get("Content-Length", "0"))
                data = json.loads(self.rfile.read(length).decode("utf-8"))
                update_decision(data)
                self._send_json({"ok": True})
                return
            if parsed.path == "/api/rules":
                length = int(self.headers.get("Content-Length", "0"))
                data = json.loads(self.rfile.read(length).decode("utf-8"))
                self._send_json(update_replacement_rule(data))
                return
            if parsed.path == "/api/candidate-quality/restore":
                length = int(self.headers.get("Content-Length", "0"))
                data = json.loads(self.rfile.read(length).decode("utf-8"))
                self._send_json(restore_quality_candidate(data))
                return
            if parsed.path == "/api/candidate-quality/disposition":
                length = int(self.headers.get("Content-Length", "0"))
                data = json.loads(self.rfile.read(length).decode("utf-8"))
                self._send_json(update_candidate_quality_disposition(data))
                return
            if parsed.path == "/api/entity-group":
                length = int(self.headers.get("Content-Length", "0"))
                data = json.loads(self.rfile.read(length).decode("utf-8"))
                self._send_json(update_entity_group(data))
                return
            if parsed.path == "/api/entity-resolution/done":
                self._send_json(finish_entity_resolution())
                return
            if parsed.path == "/api/ambiguous-match":
                length = int(self.headers.get("Content-Length", "0"))
                data = json.loads(self.rfile.read(length).decode("utf-8"))
                self._send_json(update_ambiguous_match(data))
                return
            if parsed.path == "/api/generate":
                self._send_json(generate_outputs())
                return
            if parsed.path == "/api/dev/restart":
                self._send_json({"ok": True, "message": "Restarting local application"})
                threading.Timer(0.25, lambda: os._exit(RESTART_EXIT_CODE)).start()
                return
            self._send_error(FileNotFoundError("Not found."), HTTPStatus.NOT_FOUND)
        except Exception as error:
            self._send_error(error)

    def log_message(self, format: str, *args: Any) -> None:
        return


class ReusableThreadingHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True


def restore_last_upload() -> None:
    saved = load_saved_state()
    if not saved or not UPLOAD_PATH.exists():
        return
    document = load_docx(UPLOAD_PATH)
    candidates = apply_candidate_quality(
        detect_all_candidates(iter_docx_text_blocks(document), use_spacy=True)
    )
    decisions = apply_saved_state(candidates, saved)
    rules = normalize_rules(saved.get("replacement_rules"), candidates)
    state["replacement_rules"] = rules
    state["replacement_assignments"] = saved.get("replacement_assignments", {})
    state.update(
        {
            "filename": saved.get("filename", "last_upload.docx"),
            "file_hash": saved.get("file_hash"),
            "candidates": candidates,
            "decisions": decisions,
            "metadata": extract_docx_metadata(UPLOAD_PATH),
            "outputs": {},
            "default_replacements": default_replacements_for(candidates),
            "rename_replacements": rename_replacements_for(decisions, saved),
            "replacement_rules": rules,
            "replacement_assignments": state.get("replacement_assignments", {}),
            "replacement_sources": replacement_sources_for(decisions, saved),
            "entity_group_exclusions": saved.get("entity_group_exclusions", {}),
            "entity_group_reviews": saved.get("entity_group_reviews", []),
            "entity_resolution_done_keys": saved.get("entity_resolution_done_keys", []),
            "resolved_candidate_keys": saved.get("resolved_candidate_keys", []),
            "ambiguous_review_keys": saved.get("ambiguous_review_keys", []),
            "review_started_at": saved.get("review_started_at") or utc_now_iso(),
            "review_finished_at": saved.get("review_finished_at"),
        }
    )


def main() -> None:
    ensure_dirs()
    restore_last_upload()
    host = "127.0.0.1"
    port = 8765
    server = ReusableThreadingHTTPServer((host, port), Handler)
    url = f"http://{host}:{port}/"
    print(f"Local DOCX PII Redactor running at {url}")
    if os.environ.get("DOCSCRUB_OPEN_BROWSER", "1") != "0":
        webbrowser.open(url)
    server.serve_forever()


if __name__ == "__main__":
    main()
