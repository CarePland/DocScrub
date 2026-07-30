from redactor.entity_resolution import EntityGroup, build_ambiguous_matches, build_entity_groups, calculate_entity_confidence
from redactor.models import Candidate


def person(key: str, text: str, count: int = 1, confidence: str = "medium") -> Candidate:
    candidate = Candidate(
        key=key,
        text=text,
        detected_type="person",
        source="test",
        confidence=confidence,
        occurrences=[],
        quality="Strong",
    )
    candidate.occurrences = [object() for _ in range(count)]
    return candidate


def test_groups_person_name_variants_conservatively():
    candidates = [
        person("person:andrew goodloe", "Andrew Goodloe", 14, "high"),
        person("person:a goodloe", "A. Goodloe", 3, "medium"),
        person("person:andrew", "Andrew", 2, "low"),
    ]

    groups = build_entity_groups(candidates)

    grouped = next(group for group in groups if group.canonical_name == "Andrew Goodloe")
    assert "person:andrew goodloe" in grouped.candidate_keys
    assert "person:a goodloe" in grouped.candidate_keys
    assert "person:andrew" in grouped.candidate_keys
    assert grouped.member_confidences["person:andrew"] < 80


def test_singleton_candidates_never_become_groups():
    groups = build_entity_groups([person("person:liudmila fox", "Liudmila Fox")])

    assert groups == []


def test_every_proposed_group_has_at_least_two_members():
    candidates = [
        person("person:andrew goodloe", "Andrew Goodloe"),
        person("person:a goodloe", "A. Goodloe"),
        person("person:liudmila fox", "Liudmila Fox"),
    ]

    groups = build_entity_groups(candidates)

    assert groups
    assert all(len(group.candidate_keys) >= 2 for group in groups)


def test_excluded_member_returns_to_remaining_review():
    candidates = [
        person("person:andrew goodloe", "Andrew Goodloe"),
        person("person:a goodloe", "A. Goodloe"),
    ]
    group_id = build_entity_groups(candidates)[0].id

    groups = build_entity_groups(candidates, {group_id: ["person:a goodloe"]})

    assert groups == []


def test_dissolved_group_members_route_to_review():
    candidates = [
        person("person:andrew goodloe", "Andrew Goodloe"),
        person("person:a goodloe", "A. Goodloe"),
    ]
    group_id = build_entity_groups(candidates)[0].id

    groups = build_entity_groups(candidates, {group_id: ["person:a goodloe"]})
    grouped_keys = {key for group in groups for key in group.candidate_keys}
    review_candidates = [candidate for candidate in candidates if candidate.key not in grouped_keys]

    assert {candidate.key for candidate in review_candidates} == {
        "person:andrew goodloe",
        "person:a goodloe",
    }


def test_ambiguous_short_name_routes_to_ambiguous_matching():
    candidates = [
        person("person:andrew goodloe", "Andrew Goodloe"),
        person("person:a goodloe", "A. Goodloe"),
        person("person:andrew jackson", "Andrew Jackson"),
        person("person:a jackson", "A. Jackson"),
        person("person:andrew", "Andrew"),
    ]

    groups = build_entity_groups(candidates)
    ambiguous = build_ambiguous_matches(candidates, groups)

    assert "person:andrew" not in {key for group in groups for key in group.candidate_keys}
    assert len(ambiguous) == 1
    assert ambiguous[0].candidate_key == "person:andrew"
    assert {match["canonical_name"] for match in ambiguous[0].possible_groups} == {
        "Andrew Goodloe",
        "Andrew Jackson",
    }


def test_entity_resolution_count_excludes_standalones():
    candidates = [
        person("person:andrew goodloe", "Andrew Goodloe"),
        person("person:a goodloe", "A. Goodloe"),
        person("person:liudmila fox", "Liudmila Fox"),
        person("person:happy rainy monday", "Happy Rainy Monday"),
    ]

    groups = build_entity_groups(candidates)
    grouped_keys = {key for group in groups for key in group.candidate_keys}

    assert len(groups) == 1
    assert len(grouped_keys) == 2


def dynamic_confidence_fixture():
    candidates = [
        person("person:andrew goodloe", "Andrew Goodloe", 14, "high"),
        person("person:a goodloe", "A. Goodloe", 3, "medium"),
        person("person:andrew", "Andrew", 2, "low"),
    ]
    group = build_entity_groups(candidates)[0]
    return group, {candidate.key: candidate for candidate in candidates}


def test_deselecting_weak_member_increases_entity_confidence():
    group, by_key = dynamic_confidence_fixture()

    all_selected = calculate_entity_confidence(group, by_key, group.candidate_keys)
    weak_removed = calculate_entity_confidence(
        group,
        by_key,
        ["person:andrew goodloe", "person:a goodloe"],
    )

    assert weak_removed > all_selected


def test_deselecting_strong_member_decreases_entity_confidence():
    group, by_key = dynamic_confidence_fixture()

    all_selected = calculate_entity_confidence(group, by_key, group.candidate_keys)
    strong_removed = calculate_entity_confidence(
        group,
        by_key,
        ["person:a goodloe", "person:andrew"],
    )

    assert strong_removed < all_selected


def test_selected_members_alone_determine_entity_confidence():
    group, by_key = dynamic_confidence_fixture()

    selected_without_weak = calculate_entity_confidence(
        group,
        by_key,
        ["person:andrew goodloe", "person:a goodloe"],
    )
    group_with_unselected_weak = EntityGroup(
        id=group.id,
        canonical_name=group.canonical_name,
        detected_type=group.detected_type,
        candidate_keys=[*group.candidate_keys, "person:outside"],
        confidence=35,
        member_confidences={**group.member_confidences, "person:outside": 35},
        reasons=group.reasons,
    )

    assert calculate_entity_confidence(
        group_with_unselected_weak,
        by_key,
        ["person:andrew goodloe", "person:a goodloe"],
    ) == selected_without_weak


def test_reviewer_confirmation_increases_entity_confidence():
    group, by_key = dynamic_confidence_fixture()
    selected = ["person:andrew goodloe", "person:a goodloe"]

    before = calculate_entity_confidence(group, by_key, selected)
    after = calculate_entity_confidence(group, by_key, selected, reviewer_confirmed=True)

    assert after > before


def test_entity_confidence_is_stable_when_selection_is_unchanged():
    group, by_key = dynamic_confidence_fixture()
    selected = ["person:andrew goodloe", "person:a goodloe"]

    assert calculate_entity_confidence(group, by_key, selected) == calculate_entity_confidence(group, by_key, selected)
