from redactor.models import Candidate, CandidateDecision, Decision
from redactor.replacement_rules import AUTO, MANUAL, ReplacementRuleEngine, initial_rules

import local_web_app


def candidate(key: str, text: str, detected_type: str = "email") -> Candidate:
    return Candidate(
        key=key,
        text=text,
        detected_type=detected_type,
        source="test",
        confidence="high",
        occurrences=[],
    )


def test_sequential_replacement_assignments_are_stable():
    jane = candidate("email:jane@example.com", "jane@example.com")
    mary = candidate("email:mary@example.com", "mary@example.com")
    engine = ReplacementRuleEngine(
        {"email": {"mode": "sequential", "blanket": "[REDACTED EMAIL]", "pattern": "EMAIL_{n}"}}
    )

    assert engine.replacement_for(jane) == "EMAIL_1"
    assert engine.replacement_for(mary) == "EMAIL_2"
    assert engine.replacement_for(jane) == "EMAIL_1"

    resumed = ReplacementRuleEngine(engine.rules, engine.assignments)
    assert resumed.replacement_for(jane) == "EMAIL_1"
    assert resumed.replacement_for(mary) == "EMAIL_2"


def test_rule_update_preserves_manual_replacements(monkeypatch, tmp_path):
    monkeypatch.setattr(local_web_app, "STATE_DIR", tmp_path)
    monkeypatch.setattr(local_web_app, "STATE_PATH", tmp_path / "review_state.json")
    jane = candidate("email:jane@example.com", "jane@example.com")
    mary = candidate("email:mary@example.com", "mary@example.com")
    rules = initial_rules([jane, mary])
    local_web_app.state.update(
        {
            "filename": "sample.docx",
            "file_hash": "abc",
            "candidates": [jane, mary],
            "decisions": {
                jane.key: CandidateDecision(jane.key, Decision.REDACT, "[REDACTED EMAIL]"),
                mary.key: CandidateDecision(mary.key, Decision.RENAME, "student@example.edu"),
            },
            "default_replacements": {
                jane.key: "[REDACTED EMAIL]",
                mary.key: "[REDACTED EMAIL]",
            },
            "rename_replacements": {mary.key: "student@example.edu"},
            "replacement_rules": rules,
            "replacement_assignments": {},
            "replacement_sources": {jane.key: AUTO, mary.key: MANUAL},
            "metadata": {},
            "outputs": {},
            "review_started_at": None,
            "review_finished_at": None,
        }
    )

    result = local_web_app.update_replacement_rule(
        {
            "entity_type": "email",
            "rule": {"mode": "blanket", "blanket": "[EMAIL]", "pattern": "EMAIL_{n}"},
            "apply_existing": True,
            "overwrite_manual": False,
        }
    )

    assert result["updated"] == 1
    assert local_web_app.state["decisions"][jane.key].replacement == "[EMAIL]"
    assert local_web_app.state["decisions"][mary.key].replacement == "student@example.edu"

