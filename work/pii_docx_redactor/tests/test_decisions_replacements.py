from redactor.decisions import build_default_decisions
from redactor.models import Candidate, CandidateDecision, Decision, Occurrence, OccurrenceDecision
from redactor.replacements import ReplacementRule, replace_text_longest_first


def make_candidate(key="person:jane smith", text="Jane Smith", detected_type="person"):
    return Candidate(
        key=key,
        text=text,
        detected_type=detected_type,
        source="test",
        confidence="high",
        occurrences=[
            Occurrence(
                id="occ-1",
                candidate_key=key,
                text=text,
                detected_type=detected_type,
                source="test",
                location="body paragraph 1",
                start=0,
                end=len(text),
                context=f"[{text}]",
            )
        ],
    )


def test_consistent_person_pseudonym_assignment():
    candidates = [make_candidate(text="Jane Smith"), make_candidate("person:robert lee", "Robert Lee")]
    decisions = build_default_decisions(candidates)
    assert decisions[candidates[0].key].replacement == "[PERSON 001]"
    assert decisions[candidates[1].key].replacement == "[PERSON 002]"


def test_longest_match_first_replacement():
    rules = [
        ReplacementRule("Jane Smith", "[PERSON 001]", "person:jane smith"),
        ReplacementRule("Jane", "[PERSON 002]", "person:jane"),
    ]
    text = replace_text_longest_first("Jane Smith met Jane.", rules)
    assert text == "[PERSON 001] met [PERSON 002]."


def test_occurrence_specific_override_model():
    candidate = make_candidate()
    decision = CandidateDecision(
        candidate_key=candidate.key,
        decision=Decision.REVIEW,
        replacement="[PERSON 001]",
        occurrence_decisions={"occ-1": OccurrenceDecision.REDACT},
    )
    assert decision.occurrence_decisions["occ-1"] == OccurrenceDecision.REDACT

