from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable, List


@dataclass(frozen=True)
class ReplacementRule:
    original: str
    replacement: str
    candidate_key: str


def sort_longest_first(rules: Iterable[ReplacementRule]) -> List[ReplacementRule]:
    return sorted(rules, key=lambda rule: len(rule.original), reverse=True)


def replace_text_longest_first(text: str, rules: Iterable[ReplacementRule]) -> str:
    result = text
    for rule in sort_longest_first(rules):
        pattern = re.compile(rf"(?<!\w){re.escape(rule.original)}(?!\w)", re.IGNORECASE)
        result = pattern.sub(rule.replacement, result)
    return result

