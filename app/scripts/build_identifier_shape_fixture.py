#!/usr/bin/env python3
"""
Builds the `identifier-shapes-001` domain-parity fixture.

WHY THIS EXISTS (AG, 2026-08-09). Oracle deviations #4 and #5 (identifier
boundary guards; FALLBACK_PERSON_RE token ceiling) were landed on evidence
from a live document. Checking the parity corpus afterwards showed it could
not have caught either regression:

    parity fixture candidates: 52
      9-digit CIN shapes:        0
      10+ digit LONG_ID shapes:  0
      5+ token phrases:          0

Every parity suite passed because none of the fixtures contained the shapes
those deviations touch. This document supplies them, so the next
oracle-adjacent change is measured rather than assumed.

WHAT IT IS NOT. This is not an attempt to make TypeScript reproduce the
Python defects. The fixture captures what the ORACLE produces -- including
its wrong answers -- and the manifest's `deviations` array records, per
shape, where DocScrub intentionally differs and why. The TypeScript suite
(verify/identifier-shape-parity.ts) asserts agreement everywhere except at
those recorded points, and asserts the intended divergence AT them. An
undocumented difference is a failure; a documented one is a checked
contract.

Read-only with respect to work/pii_docx_redactor, like every other exporter
here.

Usage (from DocScrub-Web/):
    python3 scripts/build_identifier_shape_fixture.py
"""
from __future__ import annotations

import sys
from pathlib import Path

DOCSCRUB_WEB = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DOCSCRUB_WEB / "scripts"))

from docx import Document  # noqa: E402


# ---------------------------------------------------------------------------
# THE SHAPES
#
# Each paragraph isolates one shape so a fixture diff names the case that
# moved. Comments state the INTENT, because a bare string in a corpus is
# unreadable six months later.
# ---------------------------------------------------------------------------
PARAGRAPHS = [
    # --- genuine identifiers: must be detected by BOTH implementations ---
    "Student CIN 781237504 was updated in the system.",          # bare 9-digit CIN
    "Please verify ID: 123456789.",                               # CIN followed by punctuation
    "The record (987654321) is now closed.",                      # CIN inside parentheses
    "Account 1234567890123 has a hold.",                          # 13-digit LONG_ID
    "Reference 123-456-789-012 for the transfer.",                # LONG_ID with internal separators
    "Meeting ID: 826 0122 9711 Passcode: aB3xy9",                 # LONG_ID with spaces, then a word

    # --- digits inside larger alphanumeric tokens: must NOT be identifiers ---
    # DEVIATION #4a. Python matches the digit run because its guards see
    # digits only; DocScrub does not, because redacting these corrupts a URL.
    "Join at https://teams.microsoft.com/l/meetup/781237504d3f8a9b today.",
    "The upload id=18900663687e4c1a99 failed to process.",
    "Batch ref 01200067742E5B was rejected.",

    # --- capitalized phrase lengths around the token ceiling ---
    # DEVIATION #5. Python cuts at four tokens and emits the remainder as a
    # second candidate; DocScrub keeps six.
    "Contact Mary Jane Watson Parker about the transfer.",         # 4 tokens: agrees
    "Post Enrollment Requisite Checking Background Process runs nightly.",  # 6 tokens: diverges
    "Open the Term Session Appt Block Appt Nbr field.",            # 6 tokens: diverges
    "The Office Of The Registrar And Enrollment Services Team met.",  # 8 tokens: still bounded, both

    # --- controls: ordinary person names, so the fixture is not all edge case ---
    "Andrew Goodloe sent the report to Tamara Yamada.",
]


def build_document(path: Path) -> None:
    document = Document()
    for text in PARAGRAPHS:
        document.add_paragraph(text)
    path.parent.mkdir(parents=True, exist_ok=True)
    document.save(str(path))


def main() -> None:
    case_id = "identifier-shapes-001"
    case_dir = DOCSCRUB_WEB / "fixtures" / "domain-parity" / case_id
    source = case_dir / "source" / "identifier_shapes.docx"
    build_document(source)
    print(f"Built source document at {source}")

    # export_fixtures does the oracle run. Imported AFTER the document exists
    # because build_case() reads it immediately; it also chdir()s into the
    # Python app root, so this import must come last.
    from export_fixtures import build_case  # noqa: E402

    build_case(case_id, source, case_dir)


if __name__ == "__main__":
    main()
