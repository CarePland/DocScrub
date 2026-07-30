from redactor.candidate_quality import (
    REVIEW,
    STRONG,
    UNLIKELY,
    candidate_quality_metrics,
    load_configured_lexicons,
    load_lexicon_terms,
    score_candidate_quality,
)
from redactor.models import Candidate, Occurrence


def person(text: str, count: int = 1) -> Candidate:
    return person_with_context(text, f"The candidate is [{text}].", count=count)


def person_with_context(text: str, context: str, count: int = 1) -> Candidate:
    key = f"person:{text.casefold()}"
    return Candidate(
        key=key,
        text=text,
        detected_type="person",
        source="test",
        confidence="low",
        occurrences=[
            Occurrence(
                id=f"{key}:{index}",
                candidate_key=key,
                text=text,
                detected_type="person",
                source="test",
                location="body paragraph 1",
                start=0,
                end=len(text),
                context=context,
            )
            for index in range(count)
        ],
    )


def test_strong_person_candidates_remain_reviewable():
    for text in [
        "Osmara Reyes",
        "Lopez, Vincent",
        "Parra, Adriana",
        "Andrew Goodloe",
        "MARTINEZ-NAVARRO, PH",
    ]:
        result = score_candidate_quality(person(text))
        assert result.quality == STRONG, text


def test_obvious_non_person_phrases_are_unlikely_people():
    for text in [
        "Tuesday, July",
        "Hi All",
        "The Records Office",
        "Human Resources",
        "Family Educational Rights",
        "Privacy Act",
        "Legal Violations",
        "Furthermore, FERPA",
        "We Are",
        "Immediate Reversal",
    ]:
        result = score_candidate_quality(person(text))
        assert result.quality == UNLIKELY, text
        assert result.status == UNLIKELY, text
        assert result.filter_rules, text
        assert result.score < 25, text


def test_frequency_does_not_dominate_quality():
    assert score_candidate_quality(person("Osmara Reyes", count=1)).quality == STRONG
    assert score_candidate_quality(person("Legal Violations", count=8)).quality == UNLIKELY


def test_deterministic_quality_filters_common_noise():
    examples = {
        "She": "pronoun_or_determiner",
        "Have": "common_verb",
        "Thank": "greeting_or_courtesy",
        "Registrar": "institution_term",
        "Fall": "season_or_academic_term",
        "FYI": "abbreviation",
        "We Are": "sentence_fragment",
    }
    for text, rule in examples.items():
        result = score_candidate_quality(person(text))
        assert result.status == UNLIKELY, text
        assert rule in result.filter_rules, text


def test_single_token_names_remain_reviewable_with_specific_classification():
    examples = {
        "Margaret": "known_first_name",
        "Goodloe": "known_surname",
        "Tamara": "known_first_name",
        "Tanesha": "known_first_name",
        "Patrick": "known_first_name",
        "Joan": "known_first_name",
        "Gustavo": "known_first_name",
        "Vince": "known_first_name",
    }
    for text, classification in examples.items():
        result = score_candidate_quality(person(text))
        assert result.status == REVIEW, text
        assert classification in result.filter_rules, text
        assert "weak_single_token" not in result.filter_rules, text


def test_unknown_single_token_is_unlikely_but_not_removed_by_shape_alone():
    result = score_candidate_quality(person("Zephyr"))
    assert result.status == UNLIKELY
    assert "expanded_common_language_token" in result.filter_rules
    assert "unknown_capitalized_token" not in result.filter_rules


def test_likely_acronyms_get_specific_neutral_evidence():
    for text in ["NSC", "OCR", "PDF", "PII", "FERPA", "HIPAA", "API", "CPU", "GPU", "N95", "PDF/A", "SHA-256", "U.S."]:
        result = score_candidate_quality(person(text))
        assert "likely_acronym" in result.filter_rules, text
        assert "unknown_capitalized_token" not in result.filter_rules, text
        assert "ocr_artifact" not in result.filter_rules, text


def test_title_case_words_are_not_acronyms():
    result = score_candidate_quality(person("Canvas"))
    assert "likely_acronym" not in result.filter_rules


def test_common_single_token_filters_with_specific_negative_evidence():
    result = score_candidate_quality(person("Academy"))
    assert result.status == UNLIKELY
    assert "common_english_word" in result.filter_rules
    assert "weak_single_token" not in result.filter_rules


def test_lexical_lookup_is_case_insensitive_for_candidate_tokens():
    examples = {
        "Like": "expanded_common_language_token",
        "LIKE": "expanded_common_language_token",
        "like": "expanded_common_language_token",
        "Thanks": "greeting_or_courtesy",
        "THANKS": "greeting_or_courtesy",
        "thanks": "greeting_or_courtesy",
        "Good": "expanded_common_language_token",
        "GOOD": "expanded_common_language_token",
        "good": "expanded_common_language_token",
        "Sorry": "expanded_common_language_token",
        "SORRY": "expanded_common_language_token",
        "sorry": "expanded_common_language_token",
    }
    for text, expected_rule in examples.items():
        result = score_candidate_quality(person(text))
        assert expected_rule in result.filter_rules, text
        assert "unknown_capitalized_token" not in result.filter_rules, text


def test_lexicon_loader_normalizes_comments_and_blank_lines(tmp_path):
    path = tmp_path / "common_non_name_words.txt"
    path.write_text("# comment\n\n  Café  \nGOOD\n", encoding="utf-8")
    assert load_lexicon_terms(path) == {"café", "good"}


def test_configured_lexicons_register_evidence_types(tmp_path):
    (tmp_path / "common_non_name_words.txt").write_text("Good\n", encoding="utf-8")
    (tmp_path / "ambiguous_name_words.txt").write_text("Grace\n", encoding="utf-8")
    (tmp_path / "expanded_common_language_words.txt").write_text("Exactly\n", encoding="utf-8")
    (tmp_path / "address_suffixes.txt").write_text("St\n", encoding="utf-8")
    (tmp_path / "calendar_abbreviations.txt").write_text("Mon\n", encoding="utf-8")
    (tmp_path / "common_abbreviations.txt").write_text("FYI\n", encoding="utf-8")
    (tmp_path / "contractions.txt").write_text("can't\n", encoding="utf-8")
    (tmp_path / "honorific_titles.txt").write_text("Dr.\n", encoding="utf-8")
    (tmp_path / "honorifics_and_titles.txt").write_text("Judge\n", encoding="utf-8")
    (tmp_path / "interjections_and_casual.txt").write_text("Oops\n", encoding="utf-8")
    (tmp_path / "professional_credentials.txt").write_text("PhD\n", encoding="utf-8")
    (tmp_path / "organization_suffixes.txt").write_text("LLC\n", encoding="utf-8")
    (tmp_path / "product_and_system_names_seed.txt").write_text("Teams\n", encoding="utf-8")
    (tmp_path / "document_structure_terms.txt").write_text("Exhibit\n", encoding="utf-8")
    (tmp_path / "legal_administrative_terms.txt").write_text("Plaintiff\n", encoding="utf-8")
    (tmp_path / "latin_phrases.txt").write_text("prima facie\n", encoding="utf-8")
    lexicons = load_configured_lexicons(tmp_path)
    assert lexicons["common_english_word"] == {"good"}
    assert lexicons["ambiguous_lexical_token"] == {"grace"}
    assert lexicons["expanded_common_language_token"] == {"exactly"}
    assert lexicons["address_suffix"] == {"st"}
    assert lexicons["calendar_abbreviation"] == {"mon"}
    assert lexicons["common_abbreviation"] == {"fyi"}
    assert lexicons["contraction"] == {"can't"}
    assert lexicons["honorific_title"] == {"dr.", "judge"}
    assert lexicons["interjection_casual"] == {"oops"}
    assert lexicons["professional_credential"] == {"phd"}
    assert lexicons["organization_suffix"] == {"llc"}
    assert lexicons["product_system_name"] == {"teams"}
    assert lexicons["document_structure_term"] == {"exhibit"}
    assert lexicons["legal_administrative_term"] == {"plaintiff"}
    assert lexicons["latin_phrases"] == {"prima facie"}


def test_ambiguous_lexical_token_is_neutral_evidence():
    result = score_candidate_quality(person("Grace"))
    assert result.status == REVIEW
    assert "ambiguous_lexical_token" in result.filter_rules
    assert "common_english_word" not in result.filter_rules


def test_expanded_language_lexicons_keep_ambiguous_names_reviewable():
    for text in ["Adrian", "Amber", "Will"]:
        result = score_candidate_quality(person(text))
        assert result.status == REVIEW, text
        assert "ambiguous_lexical_token" in result.filter_rules, text


def test_expanded_common_language_lexicon_adds_specific_neutral_evidence():
    for text in ["Because", "Communication", "Exactly"]:
        result = score_candidate_quality(person(text))
        assert "expanded_common_language_token" in result.filter_rules, text
        assert "unknown_capitalized_token" not in result.filter_rules, text


def test_professional_and_institutional_lexicons_add_evidence():
    examples = {
        "Dr.": "honorific_title",
        "PhD": "professional_credential",
        "LLC": "organization_suffix",
        "Exhibit": "document_structure_term",
        "Plaintiff": "legal_administrative_term",
    }
    for text, expected_rule in examples.items():
        result = score_candidate_quality(person(text))
        assert expected_rule in result.filter_rules, text


def test_lexical_pack_recognizers_add_neutral_evidence():
    examples = {
        "St": "address_suffix",
        "Mon": "calendar_abbreviation",
        "Can't": "contraction",
        "Oops": "interjection_casual",
        "Teams": "product_system_name",
    }
    for text, expected_rule in examples.items():
        result = score_candidate_quality(person(text))
        assert expected_rule in result.filter_rules, text


def test_positive_evidence_overrides_dictionary_filtering():
    result = score_candidate_quality(
        person_with_context("Will", "Please contact Dr. [Will] Jones for the update.")
    )
    assert result.status == REVIEW
    assert "nearby_title" in result.positive_reasons


def test_candidate_quality_metrics_count_filtered_rules():
    candidates = [person("Thank"), person("She"), person("Margaret")]
    for candidate in candidates:
        result = score_candidate_quality(candidate)
        candidate.quality = result.quality
        candidate.quality_status = result.status
        candidate.quality_filter_rules = result.filter_rules
    metrics = candidate_quality_metrics(candidates)
    assert metrics["raw_candidates"] == 3
    assert metrics["filtered"] == 0
    assert metrics["unlikely"] == 2
    assert metrics["to_review"] == 1
    assert metrics["remaining_review"] == 1
    assert metrics["reduction_percent"] == 0
    assert metrics["rule_counts"]["greeting_or_courtesy"] == 1
    assert metrics["classification_counts"]["known_first_name"] == 1


def test_candidate_quality_score_is_explainable_and_weighted():
    result = score_candidate_quality(person("Andrew Goodloe", count=5))
    weights = {item["rule"]: item["weight"] for item in result.evidence_breakdown}
    assert result.score >= 85
    assert result.status == REVIEW
    assert weights["strong_name_structure"] > 0
    assert weights["moderate_frequency_bonus"] > 0
