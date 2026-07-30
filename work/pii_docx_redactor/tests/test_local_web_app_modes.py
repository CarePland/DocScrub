import pytest

from redactor.decisions import decisions_from_json, decisions_to_json
from redactor.models import Candidate, CandidateDecision, Decision, Occurrence

import local_web_app


def candidate():
    return Candidate(
        key="email:jane@example.com",
        text="jane@example.com",
        detected_type="email",
        source="regex",
        confidence="high",
        occurrences=[],
    )


def setup_state(monkeypatch, tmp_path):
    monkeypatch.setattr(local_web_app, "STATE_DIR", tmp_path)
    monkeypatch.setattr(local_web_app, "STATE_PATH", tmp_path / "review_state.json")
    monkeypatch.setattr(local_web_app, "OUTPUT_DIR", tmp_path / "outputs")
    item = candidate()
    decision = CandidateDecision(item.key, Decision.UNDECIDED, "[REDACTED EMAIL]")
    local_web_app.state.update(
        {
            "candidates": [item],
            "decisions": {item.key: decision},
            "default_replacements": {item.key: "[REDACTED EMAIL]"},
            "rename_replacements": {},
            "filename": "sample.docx",
            "file_hash": "abc",
            "metadata": {},
            "outputs": {},
        }
    )
    return item, decision


def test_replacement_display_is_mode_specific(monkeypatch, tmp_path):
    item, decision = setup_state(monkeypatch, tmp_path)
    assert local_web_app.candidate_to_json(item, decision)["replacement"] == ""

    local_web_app.update_decision({"key": item.key, "action": "Rename"})
    local_web_app.update_decision({"key": item.key, "replacement": "student@example.edu"})
    assert local_web_app.candidate_to_json(item, decision)["replacement"] == "student@example.edu"

    local_web_app.update_decision({"key": item.key, "action": "Redact"})
    assert local_web_app.candidate_to_json(item, decision)["replacement"] == "[REDACTED EMAIL]"

    local_web_app.update_decision({"key": item.key, "action": "Ignore"})
    assert local_web_app.candidate_to_json(item, decision)["replacement"] == ""

    local_web_app.update_decision({"key": item.key, "action": "Keep"})
    assert local_web_app.candidate_to_json(item, decision)["replacement"] == ""

    local_web_app.update_decision({"key": item.key, "action": "Rename"})
    assert local_web_app.candidate_to_json(item, decision)["replacement"] == "student@example.edu"


def test_candidate_json_includes_standard_and_expert_explanation(monkeypatch, tmp_path):
    item, decision = setup_state(monkeypatch, tmp_path)
    item.detected_type = "person"
    item.text = "Yamada, Tamara"
    item.candidate_score = 99
    item.quality_status = "To Review"
    item.quality_evidence_breakdown = [
        {"rule": "surname_given_structure", "label": "Surname Given Structure", "weight": 50},
        {"rule": "nearby_title", "label": "Nearby Title", "weight": 40},
    ]

    serialized = local_web_app.candidate_to_json(item, decision)

    assert serialized["explanation"]["standard"]["likelihood"] == 99
    assert "surname-first name pattern" in serialized["explanation"]["standard"]["summary"]
    assert serialized["explanation"]["expert"]["positive_evidence"][0]["id"] == "surname_given_structure"
    assert serialized["explanation"]["expert"]["positive_evidence"][0]["weight"] == 50


def test_candidate_json_includes_occurrence_groups_without_removing_occurrences(monkeypatch, tmp_path):
    item, decision = setup_state(monkeypatch, tmp_path)
    item.occurrences = [
        Occurrence("occ-1", item.key, item.text, item.detected_type, item.source, "body paragraph 10", 0, 1, "[value]"),
        Occurrence("occ-2", item.key, item.text, item.detected_type, item.source, "body paragraph 11", 0, 1, "Second [value]"),
        Occurrence("occ-3", item.key, item.text, item.detected_type, item.source, "body paragraph 40", 0, 1, "[value] L"),
    ]

    serialized = local_web_app.candidate_to_json(item, decision)

    assert [occurrence["id"] for occurrence in serialized["occurrences"]] == ["occ-1", "occ-2", "occ-3"]
    assert [group["occurrence_count"] for group in serialized["occurrence_groups"]] == [2, 1]
    assert [group["label"] for group in serialized["occurrence_groups"]] == [
        "Standalone occurrences",
        "Occurrences in message text",
    ]
    assert [
        occurrence["id"]
        for group in serialized["occurrence_groups"]
        for occurrence in group["occurrences"]
    ] == ["occ-1", "occ-3", "occ-2"]


def person(key: str, text: str) -> Candidate:
    return Candidate(
        key=key,
        text=text,
        detected_type="person",
        source="test",
        confidence="high",
        occurrences=[],
        quality="Strong",
    )


def filtered_person(key: str, text: str, rules: list[str], count: int) -> Candidate:
    item = person(key, text)
    item.quality = "Unlikely"
    item.quality_status = "Unlikely"
    item.quality_filter_rules = rules
    item.candidate_score = 10
    item.occurrences = [
        Occurrence(
            f"{item.key}:{index}",
            item.key,
            item.text,
            item.detected_type,
            item.source,
            "body",
            index,
            index + len(item.text),
            f"[{item.text}]",
        )
        for index in range(count)
    ]
    return item


def add_occurrences(candidate: Candidate, count: int) -> Candidate:
    candidate.occurrences = [
        Occurrence(
            f"{candidate.key}:{index}",
            candidate.key,
            candidate.text,
            candidate.detected_type,
            candidate.source,
            "body",
            index,
            index + len(candidate.text),
            f"[{candidate.text}] context {index}",
        )
        for index in range(count)
    ]
    return candidate


def test_unlikely_candidates_remain_available_for_item_check(monkeypatch, tmp_path):
    setup_state(monkeypatch, tmp_path)
    unlikely = person("person:thank", "Thank")
    unlikely.quality = "Unlikely"
    unlikely.quality_status = "Unlikely"
    unlikely.candidate_score = 5
    strong_a = person("person:andrew goodloe", "Andrew Goodloe")
    strong_b = person("person:a goodloe", "A. Goodloe")
    local_web_app.state["candidates"] = [unlikely, strong_a, strong_b]
    local_web_app.state["decisions"] = {
        candidate.key: CandidateDecision(candidate.key, Decision.UNDECIDED)
        for candidate in local_web_app.state["candidates"]
    }
    local_web_app.state["entity_resolution_done_keys"] = []

    groups, ambiguous, review = local_web_app.resolution_routes()
    routed_keys = {key for group in groups for key in group.candidate_keys}
    routed_keys.update(match.candidate_key for match in ambiguous)
    routed_keys.update(candidate.key for candidate in review)

    assert unlikely.key in routed_keys


def test_candidate_quality_detail_aggregates_unlikely_values(monkeypatch, tmp_path):
    setup_state(monkeypatch, tmp_path)
    candidates = [
        filtered_person("person:thank", "Thank", ["greeting_or_courtesy"], 3),
        filtered_person("person:thank lower", "thank", ["greeting_or_courtesy", "common_english_word"], 2),
        filtered_person("person:records", "Records", ["institution_term"], 4),
    ]
    local_web_app.state["candidates"] = candidates
    local_web_app.state["decisions"] = {
        candidate.key: CandidateDecision(candidate.key, Decision.UNDECIDED)
        for candidate in candidates
    }

    detail = local_web_app.candidate_quality_detail("unlikely")
    assert detail["unique_count"] == 2
    assert detail["rows"][0]["candidate"] == "Thank"
    assert detail["rows"][0]["occurrences"] == 5
    assert detail["rows"][0]["likelihood"] == 10
    assert detail["rows"][0]["status"] == "Unlikely"
    assert "Greeting or courtesy" in detail["rows"][0]["reasons"]

    greeting = local_web_app.candidate_quality_detail("greeting_or_courtesy")
    assert greeting["unique_count"] == 1
    assert greeting["rows"][0]["forms"] == ["Thank", "thank"]


def test_candidate_quality_detail_aggregates_remaining_review_values(monkeypatch, tmp_path):
    setup_state(monkeypatch, tmp_path)
    unlikely = filtered_person("person:thank", "Thank", ["greeting_or_courtesy"], 3)
    reviewable = filtered_person("person:andrew", "Andrew", ["known_first_name"], 2)
    reviewable.quality = "Possible"
    reviewable.quality_status = "To Review"
    reviewable.candidate_score = 72
    local_web_app.state["candidates"] = [unlikely, reviewable]
    local_web_app.state["decisions"] = {
        candidate.key: CandidateDecision(candidate.key, Decision.UNDECIDED)
        for candidate in local_web_app.state["candidates"]
    }

    detail = local_web_app.candidate_quality_detail("remaining_review")
    assert detail["label"] == "To Review"
    assert detail["unique_count"] == 1
    assert detail["rows"][0]["candidate"] == "Andrew"
    assert detail["rows"][0]["occurrences"] == 2
    assert detail["rows"][0]["filtered"] is False
    assert detail["rows"][0]["likelihood"] == 72
    assert "Known first name" in detail["rows"][0]["reasons"]


def test_group_resolved_aliases_leave_candidate_quality_remaining_review(monkeypatch, tmp_path):
    candidates, decisions, group_id = setup_group_state(monkeypatch, tmp_path)
    add_occurrences(candidates[0], 2)
    add_occurrences(candidates[1], 1)

    local_web_app.update_entity_group(
        {
            "group_id": group_id,
            "action": "Flatten",
            "candidate_keys": ["person:andrew goodloe", "person:a goodloe"],
            "replacement": "Andrew Goodloe",
        }
    )

    assert {candidate.key for candidate in local_web_app.state["candidates"]} == {
        "person:andrew goodloe",
        "person:a goodloe",
    }
    assert decisions["person:andrew goodloe"].canonical_group_id == f"entity:{group_id}"
    assert decisions["person:a goodloe"].review_stage == "group_check"
    assert decisions["person:a goodloe"].review_status == "resolved"
    assert len(decisions["person:andrew goodloe"].covered_occurrence_ids) == 2
    assert len(decisions["person:a goodloe"].covered_occurrence_ids) == 1
    assert decisions["person:a goodloe"].uncovered_occurrence_count == 0
    assert decisions["person:a goodloe"].decision_timestamp
    assert decisions["person:a goodloe"].inherited_decision_source == "group_check"
    assert local_web_app.state["entity_group_reviews"][-1]["candidate_occurrence_membership"] == {
        "person:andrew goodloe": [occurrence.id for occurrence in candidates[0].occurrences],
        "person:a goodloe": [occurrence.id for occurrence in candidates[1].occurrences],
    }

    remaining = local_web_app.candidate_quality_detail("remaining_review")
    assert remaining["unique_count"] == 0

    resolved = local_web_app.candidate_quality_detail("resolved_earlier")
    assert resolved["unique_count"] == 2
    assert {row["candidate"] for row in resolved["rows"]} == {"Andrew Goodloe", "A. Goodloe"}


def test_payload_keeps_quality_navigator_candidates_separate_from_item_check(monkeypatch, tmp_path):
    setup_state(monkeypatch, tmp_path)
    unresolved = add_occurrences(person("person:andrew", "Andrew"), 1)
    resolved = add_occurrences(person("person:goodloe", "Goodloe"), 2)
    local_web_app.state["candidates"] = [unresolved, resolved]
    local_web_app.state["decisions"] = {
        candidate.key: CandidateDecision(candidate.key, Decision.UNDECIDED)
        for candidate in local_web_app.state["candidates"]
    }
    local_web_app.mark_candidate_lifecycle(
        resolved.key,
        canonical_group_id="entity:test-group",
        review_stage="group_check",
        review_status="resolved",
        reviewer_decision="Rename",
        inherited_decision_source="group_check",
        timestamp="2026-07-26T00:00:00Z",
    )

    data = local_web_app.payload()

    assert {candidate["key"] for candidate in data["quality_candidates"]} == {
        unresolved.key,
        resolved.key,
    }
    assert resolved.key not in {candidate["key"] for candidate in data["candidates"]}
    assert data["counts"]["resolved_earlier"] == 1


def test_candidate_quality_disposition_persists_without_redaction_decision(monkeypatch, tmp_path):
    setup_state(monkeypatch, tmp_path)
    item = add_occurrences(person("person:andrew", "Andrew"), 1)
    local_web_app.state["candidates"] = [item]
    local_web_app.state["decisions"] = {item.key: CandidateDecision(item.key, Decision.UNDECIDED)}

    result = local_web_app.update_candidate_quality_disposition(
        {"key": item.key, "status": "resolved"}
    )
    decision = local_web_app.state["decisions"][item.key]

    assert result["review_status"] == "resolved"
    assert decision.decision == Decision.UNDECIDED
    assert decision.review_stage == "candidate_quality"
    assert decision.review_status == "resolved"
    assert decision.reviewer_decision == "Candidate Quality Resolved"
    data = local_web_app.payload()
    assert data["counts"]["resolved_earlier"] == 1
    assert data["counts"]["to_review"] == 0


def test_partially_covered_candidate_quality_detail_shows_only_uncovered_occurrences(monkeypatch, tmp_path):
    setup_state(monkeypatch, tmp_path)
    item = add_occurrences(person("person:andrew", "Andrew"), 3)
    item.quality = "Possible"
    item.quality_status = "To Review"
    item.quality_filter_rules = ["known_first_name"]
    local_web_app.state["candidates"] = [item]
    local_web_app.state["decisions"] = {
        item.key: CandidateDecision(item.key, Decision.UNDECIDED)
    }
    local_web_app.mark_candidate_lifecycle(
        item.key,
        canonical_group_id="entity:test-group",
        review_stage="group_check",
        review_status="partial",
        reviewer_decision="Rename selected",
        inherited_decision_source="group_check",
        covered_occurrence_ids_value=[item.occurrences[0].id, item.occurrences[1].id],
        timestamp="2026-07-26T00:00:00Z",
    )

    detail = local_web_app.candidate_quality_detail("remaining_review")
    assert detail["unique_count"] == 1
    assert detail["rows"][0]["occurrences"] == 1
    assert detail["rows"][0]["partial_relationship"] is True
    assert detail["rows"][0]["covered_occurrences"] == 2
    assert detail["rows"][0]["uncovered_occurrences"] == 1

    serialized = local_web_app.candidate_to_json(item, local_web_app.state["decisions"][item.key])
    assert serialized["count"] == 1
    assert serialized["total_count"] == 3
    assert serialized["partial_group_resolution"] is True


def setup_group_state(monkeypatch, tmp_path):
    monkeypatch.setattr(local_web_app, "STATE_DIR", tmp_path)
    monkeypatch.setattr(local_web_app, "STATE_PATH", tmp_path / "review_state.json")
    monkeypatch.setattr(local_web_app, "OUTPUT_DIR", tmp_path / "outputs")
    candidates = [
        person("person:andrew goodloe", "Andrew Goodloe"),
        person("person:a goodloe", "A. Goodloe"),
    ]
    decisions = {
        candidate.key: CandidateDecision(candidate.key, Decision.UNDECIDED, "[PERSON_1]")
        for candidate in candidates
    }
    local_web_app.state.update(
        {
            "candidates": candidates,
            "decisions": decisions,
            "default_replacements": {candidate.key: "[PERSON_1]" for candidate in candidates},
            "rename_replacements": {},
            "replacement_rules": {},
            "replacement_assignments": {},
            "replacement_sources": {},
            "entity_group_exclusions": {},
            "entity_group_reviews": [],
            "entity_resolution_done_keys": [],
            "resolved_candidate_keys": [],
            "ambiguous_review_keys": [],
            "filename": "sample.docx",
            "file_hash": "abc",
            "metadata": {},
            "outputs": {},
        }
    )
    return candidates, decisions, local_web_app.resolution_routes()[0][0].id


def test_group_keep_marks_only_selected_members_without_hiding_group(monkeypatch, tmp_path):
    _candidates, decisions, group_id = setup_group_state(monkeypatch, tmp_path)

    local_web_app.update_entity_group(
        {
            "group_id": group_id,
            "action": "Keep as-is",
            "candidate_keys": ["person:andrew goodloe"],
        }
    )

    assert decisions["person:andrew goodloe"].decision == Decision.KEEP
    assert decisions["person:a goodloe"].decision == Decision.UNDECIDED
    assert local_web_app.state["resolved_candidate_keys"] == []
    assert local_web_app.resolution_routes()[0]


def test_group_flatten_uses_chosen_canonical_value(monkeypatch, tmp_path):
    _candidates, decisions, group_id = setup_group_state(monkeypatch, tmp_path)

    local_web_app.update_entity_group(
        {
            "group_id": group_id,
            "action": "Flatten",
            "candidate_keys": ["person:andrew goodloe", "person:a goodloe"],
            "replacement": "Andrew Goodloe",
        }
    )

    assert decisions["person:andrew goodloe"].decision == Decision.RENAME
    assert decisions["person:a goodloe"].decision == Decision.RENAME
    assert decisions["person:a goodloe"].replacement == "Andrew Goodloe"


def test_group_redact_uses_one_edited_replacement(monkeypatch, tmp_path):
    _candidates, decisions, group_id = setup_group_state(monkeypatch, tmp_path)

    local_web_app.update_entity_group(
        {
            "group_id": group_id,
            "action": "Redact",
            "candidate_keys": ["person:andrew goodloe", "person:a goodloe"],
            "replacement": "[STUDENT_1]",
        }
    )

    assert decisions["person:andrew goodloe"].decision == Decision.REDACT
    assert decisions["person:a goodloe"].decision == Decision.REDACT
    assert decisions["person:andrew goodloe"].replacement == "[STUDENT_1]"
    assert decisions["person:a goodloe"].replacement == "[STUDENT_1]"


def test_not_quite_marks_proposal_without_hiding_members(monkeypatch, tmp_path):
    _candidates, decisions, group_id = setup_group_state(monkeypatch, tmp_path)

    local_web_app.update_entity_group(
        {
            "group_id": group_id,
            "action": "Not Quite",
            "candidate_keys": ["person:andrew goodloe", "person:a goodloe"],
        }
    )

    assert decisions["person:andrew goodloe"].decision == Decision.UNDECIDED
    assert decisions["person:a goodloe"].decision == Decision.UNDECIDED
    assert local_web_app.state["entity_group_exclusions"] == {}
    assert local_web_app.state["entity_group_reviews"][-1]["action"] == "Not Quite"
    assert local_web_app.resolution_routes()[0]


def test_not_quite_complete_requires_explicit_stage_completion(monkeypatch, tmp_path):
    _candidates, decisions, group_id = setup_group_state(monkeypatch, tmp_path)
    local_web_app.update_decision({"key": "person:andrew goodloe", "action": "Keep"})
    local_web_app.update_decision(
        {
            "key": "person:a goodloe",
            "action": "Rename",
            "replacement": "Andrew Goodloe",
        }
    )

    local_web_app.update_entity_group(
        {
            "group_id": group_id,
            "action": "Not Quite Complete",
            "candidate_keys": ["person:andrew goodloe", "person:a goodloe"],
        }
    )

    assert decisions["person:andrew goodloe"].decision == Decision.KEEP
    assert decisions["person:a goodloe"].decision == Decision.RENAME
    assert set(local_web_app.state["entity_resolution_done_keys"]) == {
        "person:andrew goodloe",
        "person:a goodloe",
    }
    assert local_web_app.state["entity_group_reviews"][-1]["action"] == "Not Quite Complete"
    assert local_web_app.resolution_routes()[0] == []


def test_group_ignore_marks_selected_members_without_hiding_group(monkeypatch, tmp_path):
    _candidates, decisions, group_id = setup_group_state(monkeypatch, tmp_path)

    local_web_app.update_entity_group(
        {
            "group_id": group_id,
            "action": "Ignore",
            "candidate_keys": ["person:andrew goodloe", "person:a goodloe"],
        }
    )

    assert decisions["person:andrew goodloe"].decision == Decision.NOT_SENSITIVE
    assert decisions["person:a goodloe"].decision == Decision.NOT_SENSITIVE
    assert local_web_app.state["entity_group_reviews"][-1]["action"] == "Ignore"
    assert local_web_app.resolution_routes()[0]


def test_done_editing_is_explicit_stage_clear(monkeypatch, tmp_path):
    _candidates, _decisions, group_id = setup_group_state(monkeypatch, tmp_path)

    result = local_web_app.finish_entity_resolution()

    assert result["finished"] == 2
    assert set(local_web_app.state["entity_resolution_done_keys"]) == {
        "person:andrew goodloe",
        "person:a goodloe",
    }
    assert local_web_app.state["entity_group_reviews"][-1]["action"] == "Done Editing"
    assert local_web_app.resolution_routes()[0] == []


def test_legacy_resolved_keys_do_not_hide_review_items(monkeypatch, tmp_path):
    _candidates, _decisions, _group_id = setup_group_state(monkeypatch, tmp_path)
    local_web_app.state["resolved_candidate_keys"] = ["person:andrew goodloe"]

    assert {candidate.key for candidate in local_web_app.unresolved_candidates()} == {
        "person:andrew goodloe",
        "person:a goodloe",
    }


def test_group_lifecycle_survives_decision_round_trip(monkeypatch, tmp_path):
    candidates, decisions, group_id = setup_group_state(monkeypatch, tmp_path)
    add_occurrences(candidates[0], 2)
    add_occurrences(candidates[1], 1)

    local_web_app.update_entity_group(
        {
            "group_id": group_id,
            "action": "Flatten",
            "candidate_keys": ["person:andrew goodloe", "person:a goodloe"],
            "replacement": "Andrew Goodloe",
        }
    )

    loaded = decisions_from_json(decisions_to_json(decisions))

    assert loaded["person:andrew goodloe"].canonical_group_id == f"entity:{group_id}"
    assert loaded["person:andrew goodloe"].covered_occurrence_ids == [
        occurrence.id for occurrence in candidates[0].occurrences
    ]
    assert loaded["person:andrew goodloe"].uncovered_occurrence_count == 0
    assert loaded["person:andrew goodloe"].review_stage == "group_check"
    assert loaded["person:andrew goodloe"].review_status == "resolved"
    assert loaded["person:andrew goodloe"].decision_timestamp
    assert loaded["person:andrew goodloe"].inherited_decision_source == "group_check"


def test_missing_lifecycle_fields_remain_explicitly_missing():
    loaded = decisions_from_json(
        {
            "person:legacy": {
                "decision": "Keep everywhere",
                "replacement": "Legacy",
                "occurrence_decisions": {},
            }
        }
    )

    assert loaded["person:legacy"].decision == Decision.KEEP
    assert loaded["person:legacy"].review_stage is None
    assert loaded["person:legacy"].review_status is None
    assert loaded["person:legacy"].canonical_group_id is None
    assert loaded["person:legacy"].covered_occurrence_ids == []


def test_done_editing_rolls_back_when_durable_save_fails(monkeypatch, tmp_path):
    _candidates, decisions, _group_id = setup_group_state(monkeypatch, tmp_path)

    def fail_save():
        raise OSError("disk full")

    monkeypatch.setattr(local_web_app, "save_state", fail_save)

    with pytest.raises(OSError):
        local_web_app.finish_entity_resolution()

    assert local_web_app.state["entity_resolution_done_keys"] == []
    assert local_web_app.state["entity_group_reviews"] == []
    assert decisions["person:andrew goodloe"].review_stage == "item_check"
    assert decisions["person:andrew goodloe"].review_status == "unresolved"
    assert decisions["person:andrew goodloe"].canonical_group_id is None
    assert decisions["person:andrew goodloe"].covered_occurrence_ids == []
