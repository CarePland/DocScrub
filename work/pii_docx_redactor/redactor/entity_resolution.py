from __future__ import annotations

import re
from dataclasses import dataclass
from difflib import SequenceMatcher

from .models import Candidate


@dataclass
class EntityGroup:
    id: str
    canonical_name: str
    detected_type: str
    candidate_keys: list[str]
    confidence: int
    member_confidences: dict[str, int]
    reasons: list[str]

    @property
    def variant_count(self) -> int:
        return len(self.candidate_keys)


@dataclass
class AmbiguousEntityMatch:
    candidate_key: str
    possible_groups: list[dict[str, str | int]]


def _tokens(text: str) -> list[str]:
    return re.findall(r"[A-Za-z][A-Za-z'’.-]*", text)


def _clean_token(token: str) -> str:
    return token.strip(" .,'’").casefold()


def _display_name(text: str) -> str:
    compact = re.sub(r"\s+", " ", text.strip())
    if "," in compact:
        left, right = [part.strip() for part in compact.split(",", 1)]
        if left and right:
            compact = f"{right} {left}"
    return compact


def _person_group_key(candidate: Candidate) -> str:
    display = _display_name(candidate.text)
    tokens = [_clean_token(token) for token in _tokens(display)]
    tokens = [token for token in tokens if token]
    if len(tokens) >= 2:
        first = tokens[0]
        last = tokens[-1]
        return f"person:{last}:{first[:1]}"
    return f"person-single:{candidate.key}"


def _group_key(candidate: Candidate) -> str:
    if candidate.detected_type == "person":
        return _person_group_key(candidate)
    return f"{candidate.detected_type}:{candidate.key}"


def _person_tokens(candidate: Candidate) -> list[str]:
    return [_clean_token(token) for token in _tokens(_display_name(candidate.text)) if _clean_token(token)]


def _is_short_person_reference(candidate: Candidate) -> bool:
    return candidate.detected_type == "person" and len(_person_tokens(candidate)) == 1


def _excluded_keys(exclusions: dict[str, list[str]]) -> set[str]:
    return {key for keys in exclusions.values() for key in keys}


def _member_score(group_name: str, candidate: Candidate) -> int:
    ratio = SequenceMatcher(None, group_name.casefold(), _display_name(candidate.text).casefold()).ratio()
    score = int(70 + ratio * 25)
    if candidate.confidence == "high":
        score += 5
    elif candidate.confidence == "low":
        score -= 5
    if candidate.quality == "Strong":
        score += 5
    elif candidate.quality == "Unlikely":
        score -= 20
    if len(_tokens(candidate.text)) == 1:
        score -= 12
    return max(35, min(99, score))


def calculate_entity_confidence(
    group: EntityGroup,
    candidates_by_key: dict[str, Candidate],
    selected_keys: list[str] | set[str],
    canonical_name: str | None = None,
    reviewer_confirmed: bool = False,
) -> int:
    selected_key_set = set(selected_keys)
    selected = [key for key in group.candidate_keys if key in selected_key_set]
    if not selected:
        return 0

    canonical = canonical_name or group.canonical_name
    scores = [
        _member_score(canonical, candidates_by_key[key])
        for key in selected
        if key in candidates_by_key
    ]
    if not scores:
        return 0

    score = round(min(scores) * 0.65 + (sum(scores) / len(scores)) * 0.35)
    selected_candidates = [candidates_by_key[key] for key in selected if key in candidates_by_key]
    has_anchor = any(len(_person_tokens(candidate)) >= 2 for candidate in selected_candidates)
    if len(selected_candidates) > 1 and not has_anchor:
        score -= 15
    if reviewer_confirmed:
        score += 10
    return max(35, min(100, score))


def build_entity_groups(
    candidates: list[Candidate],
    exclusions: dict[str, list[str]] | None = None,
    force_review_keys: set[str] | None = None,
) -> list[EntityGroup]:
    exclusions = exclusions or {}
    force_review_keys = force_review_keys or set()
    removed_keys = _excluded_keys(exclusions) | force_review_keys
    buckets: dict[str, list[Candidate]] = {}
    short_person_refs: list[Candidate] = []
    for candidate in candidates:
        if candidate.key in removed_keys:
            continue
        if _is_short_person_reference(candidate):
            short_person_refs.append(candidate)
            continue
        buckets.setdefault(_group_key(candidate), []).append(candidate)

    first_name_to_bucket: dict[str, list[str]] = {}
    for key, members in buckets.items():
        full_name_members = [member for member in members if len(_person_tokens(member)) >= 2]
        if not full_name_members:
            continue
        first_names = {_person_tokens(member)[0] for member in full_name_members if _person_tokens(member)}
        for first_name in first_names:
            first_name_to_bucket.setdefault(first_name, []).append(key)

    for candidate in short_person_refs:
        token = _person_tokens(candidate)[0]
        matching_bucket_keys = first_name_to_bucket.get(token, [])
        if len(matching_bucket_keys) == 1:
            buckets.setdefault(matching_bucket_keys[0], []).append(candidate)

    groups: list[EntityGroup] = []
    for key, members in buckets.items():
        included = [candidate for candidate in members if candidate.key not in set(exclusions.get(key, []))]
        if len(included) < 2:
            continue
        canonical = max(included, key=lambda item: (len(_tokens(item.text)), item.count, len(item.text)))
        canonical_name = _display_name(canonical.text)
        member_confidences = {
            candidate.key: _member_score(canonical_name, candidate)
            for candidate in included
        }
        scores = list(member_confidences.values())
        confidence = min(scores) if len(scores) > 1 else scores[0]
        reasons = ["deterministic_grouping"]
        reasons.append("shared_name_signature")
        if any(candidate.key in exclusions.get(key, []) for candidate in members):
            reasons.append("reviewer_removed_member")
            confidence = max(35, confidence - 8)
        groups.append(
            EntityGroup(
                id=key,
                canonical_name=canonical_name,
                detected_type=canonical.detected_type,
                candidate_keys=[candidate.key for candidate in included],
                confidence=confidence,
                member_confidences=member_confidences,
                reasons=reasons,
            )
        )
    return sorted(groups, key=lambda group: (-len(group.candidate_keys), -group.confidence, group.canonical_name.casefold()))


def build_ambiguous_matches(
    candidates: list[Candidate],
    groups: list[EntityGroup],
    exclusions: dict[str, list[str]] | None = None,
    force_review_keys: set[str] | None = None,
) -> list[AmbiguousEntityMatch]:
    exclusions = exclusions or {}
    force_review_keys = force_review_keys or set()
    unavailable_keys = _excluded_keys(exclusions) | force_review_keys
    grouped_keys = {key for group in groups for key in group.candidate_keys}
    group_first_names: dict[str, list[EntityGroup]] = {}
    for group in groups:
        first = _clean_token(_tokens(group.canonical_name)[0]) if _tokens(group.canonical_name) else ""
        if first:
            group_first_names.setdefault(first, []).append(group)

    matches: list[AmbiguousEntityMatch] = []
    for candidate in candidates:
        if candidate.key in grouped_keys or candidate.key in unavailable_keys:
            continue
        if not _is_short_person_reference(candidate):
            continue
        token = _person_tokens(candidate)[0]
        possible = group_first_names.get(token, [])
        if len(possible) < 2:
            continue
        matches.append(
            AmbiguousEntityMatch(
                candidate_key=candidate.key,
                possible_groups=[
                    {
                        "id": group.id,
                        "canonical_name": group.canonical_name,
                        "confidence": group.confidence,
                    }
                    for group in possible
                ],
            )
        )
    return sorted(matches, key=lambda match: match.candidate_key.casefold())
