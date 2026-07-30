from __future__ import annotations

import re
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

from docx.document import Document as DocxDocument
from docx.text.paragraph import Paragraph

from .decisions import save_decisions
from .docx_reader import iter_docx_text_blocks, load_docx
from .models import Candidate, CandidateDecision, Decision, OccurrenceDecision
from .replacements import ReplacementRule, sort_longest_first


def selected_replacement_rules(
    candidates: Iterable[Candidate], decisions: Dict[str, CandidateDecision]
) -> List[ReplacementRule]:
    rules = []
    for candidate in candidates:
        decision = decisions.get(candidate.key)
        if not decision or decision.decision not in {Decision.REDACT, Decision.RENAME}:
            continue
        replacement = decision.replacement or "[REDACTED]"
        rules.append(ReplacementRule(candidate.text, replacement, candidate.key))
    return sort_longest_first(rules)


def _run_spans(paragraph: Paragraph) -> List[Tuple[int, int, object]]:
    spans = []
    cursor = 0
    for run in paragraph.runs:
        text = run.text
        spans.append((cursor, cursor + len(text), run))
        cursor += len(text)
    return spans


def _replace_span(paragraph: Paragraph, start: int, end: int, replacement: str) -> None:
    spans = _run_spans(paragraph)
    touched = [(s, e, run) for s, e, run in spans if s < end and e > start]
    if not touched:
        return
    for index, (span_start, span_end, run) in enumerate(touched):
        local_start = max(start - span_start, 0)
        local_end = min(end - span_start, span_end - span_start)
        text = run.text
        if index == 0:
            run.text = text[:local_start] + replacement + text[local_end:]
        else:
            run.text = text[:local_start] + text[local_end:]


def _find_matches(text: str, original: str) -> List[Tuple[int, int]]:
    pattern = re.compile(rf"(?<!\w){re.escape(original)}(?!\w)", re.IGNORECASE)
    return [(match.start(), match.end()) for match in pattern.finditer(text)]


def apply_global_replacements_to_paragraph(paragraph: Paragraph, rules: Iterable[ReplacementRule]) -> int:
    count = 0
    for rule in sort_longest_first(rules):
        text = paragraph.text
        matches = _find_matches(text, rule.original)
        for start, end in reversed(matches):
            _replace_span(paragraph, start, end, rule.replacement)
            count += 1
    return count


def apply_occurrence_replacements_to_paragraph(
    paragraph: Paragraph,
    location: str,
    candidates: Iterable[Candidate],
    decisions: Dict[str, CandidateDecision],
) -> int:
    count = 0
    spans: List[Tuple[int, int, str]] = []
    for candidate in candidates:
        decision = decisions.get(candidate.key)
        if not decision or decision.decision != Decision.REVIEW:
            continue
        replacement = decision.replacement or "[REDACTED]"
        for occurrence in candidate.occurrences:
            if occurrence.location != location:
                continue
            if decision.occurrence_decisions.get(occurrence.id) == OccurrenceDecision.REDACT:
                spans.append((occurrence.start, occurrence.end, replacement))
    for start, end, replacement in sorted(spans, key=lambda item: item[1], reverse=True):
        _replace_span(paragraph, start, end, replacement)
        count += 1
    return count


def write_redacted_docx(
    input_path: Path,
    output_path: Path,
    decisions_path: Path,
    candidates: List[Candidate],
    decisions: Dict[str, CandidateDecision],
) -> int:
    document = load_docx(input_path)
    blocks = iter_docx_text_blocks(document)
    global_rules = selected_replacement_rules(candidates, decisions)
    replacement_count = 0
    for block in blocks:
        if block.paragraph is None:
            continue
        replacement_count += apply_occurrence_replacements_to_paragraph(
            block.paragraph, block.location, candidates, decisions
        )
        replacement_count += apply_global_replacements_to_paragraph(block.paragraph, global_rules)
    document.save(str(output_path))
    save_decisions(decisions_path, decisions)
    return replacement_count


def rescan_for_originals(document: DocxDocument, candidates: Iterable[Candidate]) -> Dict[str, int]:
    text = "\n".join(block.text for block in iter_docx_text_blocks(document))
    remaining = {}
    for candidate in candidates:
        count = len(_find_matches(text, candidate.text))
        if count:
            remaining[candidate.text] = count
    return remaining
