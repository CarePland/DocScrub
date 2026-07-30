from redactor.detectors import detect_all_candidates, normalize_candidate
from redactor.docx_reader import TextBlock


def test_duplicate_candidate_grouping_first_last_and_last_first():
    blocks = [
        TextBlock("body paragraph 1", "Jane Smith sent mail."),
        TextBlock("body paragraph 2", "Smith, Jane replied later."),
    ]
    candidates = detect_all_candidates(blocks, use_spacy=False)
    jane = [c for c in candidates if c.key == normalize_candidate("Jane Smith", "person")]
    assert len(jane) == 1
    assert jane[0].count == 2


def test_repeated_single_first_name_detection():
    blocks = [
        TextBlock("body paragraph 1", "Andrew joined the meeting."),
        TextBlock("body paragraph 2", "Andrew said the file was ready."),
    ]
    candidates = detect_all_candidates(blocks, use_spacy=False)
    andrew = [c for c in candidates if c.key == normalize_candidate("Andrew", "person")]
    assert len(andrew) == 1
    assert andrew[0].count == 2


def test_cin_email_and_phone_detection():
    blocks = [TextBlock("body paragraph 1", "Email a.b@example.com, call (555) 123-4567, CIN 123456789.")]
    candidates = detect_all_candidates(blocks, use_spacy=False)
    types = {candidate.detected_type for candidate in candidates}
    assert "email" in types
    assert "phone" in types
    assert "cin" in types


def test_avoids_dates_and_page_numbers_as_ids():
    blocks = [TextBlock("footer paragraph 1", "Page 12 of 169. Meeting date 01/12/2026.")]
    candidates = detect_all_candidates(blocks, use_spacy=False)
    numeric = [c for c in candidates if c.detected_type in {"cin", "long_numeric_id", "phone"}]
    assert numeric == []
