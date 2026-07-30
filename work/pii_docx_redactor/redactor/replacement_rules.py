from __future__ import annotations

from copy import deepcopy
from typing import Any

from .models import Candidate


BLANKET = "blanket"
SEQUENTIAL = "sequential"
AUTO = "auto"
MANUAL = "manual"


DEFAULT_RULES: dict[str, dict[str, str]] = {
    "person": {"mode": SEQUENTIAL, "blanket": "[REDACTED NAME]", "pattern": "PERSON_{n}"},
    "email": {"mode": BLANKET, "blanket": "[REDACTED EMAIL]", "pattern": "EMAIL_{n}"},
    "phone": {"mode": BLANKET, "blanket": "[REDACTED PHONE]", "pattern": "PHONE_{n}"},
    "cin": {"mode": BLANKET, "blanket": "[REDACTED ID]", "pattern": "ID_{n}"},
    "long_numeric_id": {"mode": BLANKET, "blanket": "[REDACTED ID]", "pattern": "ID_{n}"},
    "organization": {
        "mode": BLANKET,
        "blanket": "[REDACTED ORGANIZATION]",
        "pattern": "ORG_{n}",
    },
    "other_identifier": {"mode": BLANKET, "blanket": "[REDACTED]", "pattern": "IDENTIFIER_{n}"},
}


def normalize_type(entity_type: str | None) -> str:
    return str(entity_type or "other_identifier").strip().lower() or "other_identifier"


def default_rule_for(entity_type: str) -> dict[str, str]:
    normalized = normalize_type(entity_type)
    if normalized in DEFAULT_RULES:
        return deepcopy(DEFAULT_RULES[normalized])
    label = normalized.replace("_", " ").upper()
    token = normalized.replace("-", "_").upper()
    return {"mode": BLANKET, "blanket": f"[REDACTED {label}]", "pattern": f"{token}_{{n}}"}


def initial_rules(candidates: list[Candidate] | None = None) -> dict[str, dict[str, str]]:
    rules = deepcopy(DEFAULT_RULES)
    for candidate in candidates or []:
        entity_type = normalize_type(candidate.detected_type)
        rules.setdefault(entity_type, default_rule_for(entity_type))
    return rules


def normalize_rules(
    raw_rules: dict[str, dict[str, Any]] | None, candidates: list[Candidate] | None = None
) -> dict[str, dict[str, str]]:
    rules = initial_rules(candidates)
    for entity_type, raw_rule in (raw_rules or {}).items():
        normalized_type = normalize_type(entity_type)
        base = rules.setdefault(normalized_type, default_rule_for(normalized_type))
        mode = str(raw_rule.get("mode") or base["mode"]).lower()
        base["mode"] = mode if mode in {BLANKET, SEQUENTIAL} else BLANKET
        base["blanket"] = str(raw_rule.get("blanket") or base["blanket"])
        pattern = str(raw_rule.get("pattern") or base["pattern"])
        base["pattern"] = pattern if "{n}" in pattern else f"{pattern}_{{n}}"
    return rules


def preview_for_rule(rule: dict[str, str], count: int = 3) -> list[str]:
    if rule.get("mode") == BLANKET:
        return [rule.get("blanket", "[REDACTED]")]
    pattern = rule.get("pattern", "{n}")
    return [pattern.replace("{n}", str(index)) for index in range(1, count + 1)]


class ReplacementRuleEngine:
    def __init__(
        self,
        rules: dict[str, dict[str, str]] | None = None,
        assignments: dict[str, dict[str, int]] | None = None,
    ) -> None:
        self.rules = normalize_rules(rules)
        self.assignments = {
            normalize_type(entity_type): {str(key): int(value) for key, value in values.items()}
            for entity_type, values in (assignments or {}).items()
        }

    def ensure_rule(self, entity_type: str) -> dict[str, str]:
        normalized_type = normalize_type(entity_type)
        self.rules.setdefault(normalized_type, default_rule_for(normalized_type))
        return self.rules[normalized_type]

    def replacement_for(self, candidate: Candidate) -> str:
        entity_type = normalize_type(candidate.detected_type)
        rule = self.ensure_rule(entity_type)
        if rule.get("mode") == BLANKET:
            return rule.get("blanket", "[REDACTED]")
        assignments_for_type = self.assignments.setdefault(entity_type, {})
        if candidate.key not in assignments_for_type:
            assignments_for_type[candidate.key] = len(assignments_for_type) + 1
        number = assignments_for_type[candidate.key]
        return rule.get("pattern", "{n}").replace("{n}", str(number))

    def update_rule(self, entity_type: str, rule: dict[str, Any]) -> dict[str, str]:
        normalized_type = normalize_type(entity_type)
        current = self.ensure_rule(normalized_type)
        merged = {
            "mode": str(rule.get("mode") or current["mode"]).lower(),
            "blanket": str(rule.get("blanket") or current["blanket"]),
            "pattern": str(rule.get("pattern") or current["pattern"]),
        }
        self.rules[normalized_type] = normalize_rules({normalized_type: merged})[normalized_type]
        return self.rules[normalized_type]

