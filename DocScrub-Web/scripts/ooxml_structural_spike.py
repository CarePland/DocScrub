#!/usr/bin/env python3
"""
Early OOXML structural spike (architecture v0.2 §14, Phase 1/2).

Read-only structural analysis of real .docx files already present in the
existing Python app's working state, used to characterize the OOXML fidelity
risks DocumentParser/DocumentRebuilder will actually have to handle in the
browser -- run-splitting severity, headers/footers/tables/hyperlinks
presence, tracked changes, comments, fields, content controls, and nested
table depth.

This is a structural spike, not the Phase 2 browser POC itself: it uses
Python's zipfile/lxml (already available) rather than a browser-side OOXML
library (not installable in the environment this was written in -- see
../README.md, "Environment constraints"). Its purpose is to produce concrete,
evidence-based inputs for that later spike, not to substitute for it.

Deliberately does not print or persist any extracted document *text* --
only structural counts -- since the source documents analyzed are the
maintainer's real working documents, not synthetic fixtures.
"""
from __future__ import annotations

import json
import sys
import zipfile
from collections import Counter
from pathlib import Path

from lxml import etree

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NSMAP = {"w": W}

REPO_ROOT = Path(__file__).resolve().parents[2]
PII_APP_ROOT = REPO_ROOT / "work" / "pii_docx_redactor"


def _local(tag: str) -> str:
    return tag.split("}", 1)[1] if "}" in tag else tag


def analyze_document_xml(xml_bytes: bytes) -> dict:
    root = etree.fromstring(xml_bytes)

    paragraphs = root.findall(".//w:p", NSMAP)
    runs_per_paragraph = []
    for p in paragraphs:
        runs = p.findall("./w:r", NSMAP)
        if runs:
            runs_per_paragraph.append(len(runs))

    tag_counts = Counter(_local(el.tag) for el in root.iter() if isinstance(el.tag, str))

    # Nested table depth: for every w:tbl, how many ancestor w:tbl elements does it have?
    max_table_depth = 0
    for tbl in root.findall(".//w:tbl", NSMAP):
        depth = 1
        parent = tbl.getparent()
        while parent is not None:
            if _local(parent.tag) == "tbl":
                depth += 1
            parent = parent.getparent()
        max_table_depth = max(max_table_depth, depth)

    return {
        "paragraphCount": len(paragraphs),
        "paragraphsWithRuns": len(runs_per_paragraph),
        "runsPerParagraph": {
            "min": min(runs_per_paragraph) if runs_per_paragraph else 0,
            "max": max(runs_per_paragraph) if runs_per_paragraph else 0,
            "mean": round(sum(runs_per_paragraph) / len(runs_per_paragraph), 2) if runs_per_paragraph else 0,
            "paragraphsWithMoreThan3Runs": sum(1 for n in runs_per_paragraph if n > 3),
        },
        "hyperlinkCount": tag_counts.get("hyperlink", 0),
        "tableCount": tag_counts.get("tbl", 0),
        "maxNestedTableDepth": max_table_depth,
        "trackedChangeInsertions": tag_counts.get("ins", 0),
        "trackedChangeDeletions": tag_counts.get("del", 0),
        "comments_referenced": tag_counts.get("commentReference", 0),
        "simpleFieldCodes": tag_counts.get("fldSimple", 0),
        "complexFieldRuns": tag_counts.get("fldChar", 0),
        "structuredDocumentTags": tag_counts.get("sdt", 0),
        "drawingObjects": tag_counts.get("drawing", 0),
        "legacyPictures": tag_counts.get("pict", 0),
        "footnoteReferences": tag_counts.get("footnoteReference", 0),
        "endnoteReferences": tag_counts.get("endnoteReference", 0),
    }


def analyze_docx(path: Path) -> dict:
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        has_headers = any(n.startswith("word/header") for n in names)
        has_footers = any(n.startswith("word/footer") for n in names)
        has_comments = "word/comments.xml" in names
        has_footnotes = "word/footnotes.xml" in names
        has_endnotes = "word/endnotes.xml" in names
        settings_xml = z.read("word/settings.xml") if "word/settings.xml" in names else b""

        document_stats = analyze_document_xml(z.read("word/document.xml"))

    protected = b"documentProtection" in settings_xml
    track_changes_setting = b"<w:trackChanges" in settings_xml

    return {
        "file": path.name,
        "sizeBytes": path.stat().st_size,
        "partCount": len(names),
        "hasHeaders": has_headers,
        "hasFooters": has_footers,
        "hasComments": has_comments,
        "hasFootnotes": has_footnotes,
        "hasEndnotes": has_endnotes,
        "documentProtectionEnabled": protected,
        "trackChangesSettingEnabled": track_changes_setting,
        **document_stats,
    }


def fidelity_flags(stats: dict) -> list[str]:
    flags = []
    if stats["runsPerParagraph"]["paragraphsWithMoreThan3Runs"] > 0:
        flags.append(
            f"{stats['runsPerParagraph']['paragraphsWithMoreThan3Runs']} paragraph(s) split across more than "
            "3 runs -- candidate text may span multiple <w:r> elements, matching the risk already named in "
            "architecture v0.2 §15.2 ('Text split across Word runs can make replacements difficult')."
        )
    if stats["maxNestedTableDepth"] > 1:
        flags.append(f"Nested tables present (max depth {stats['maxNestedTableDepth']}) -- distinct source "
                      "mapping required per §6.2/§15.2.")
    if stats["trackedChangeInsertions"] or stats["trackedChangeDeletions"]:
        flags.append("Tracked changes (w:ins/w:del) present -- needs explicit unsupported-feature handling "
                      "per §15.2, or DocumentRebuilder risks silently accepting/rejecting edits it doesn't "
                      "understand.")
    if stats["comments_referenced"]:
        flags.append("Comment references present -- comments are named as a possible hard-blocker feature in "
                      "§15.4's open product-policy question.")
    if stats["simpleFieldCodes"] or stats["complexFieldRuns"]:
        flags.append("Field codes present (simple and/or complex) -- field text may not be plain w:t content, "
                      "risking silent detection misses if DocumentParser only reads w:t nodes.")
    if stats["structuredDocumentTags"]:
        flags.append("Structured document tags (content controls) present -- may hold candidate text outside "
                      "ordinary run structure.")
    if stats["legacyPictures"] or stats["drawingObjects"]:
        flags.append("Drawing/legacy picture objects present -- may contain text boxes with independent text "
                      "runs not reachable via ordinary paragraph traversal (README already notes text boxes "
                      "'may not be redacted perfectly in this MVP').")
    if stats["documentProtectionEnabled"]:
        flags.append("Document protection flag present in settings.xml -- rebuilding may need to preserve or "
                      "explicitly strip this, a product-policy question, not just an engineering detail.")
    if not flags:
        flags.append("No elevated fidelity risk indicators found in this document.")
    return flags


def main() -> None:
    candidates = [
        PII_APP_ROOT / ".local_web_state" / "upload.docx",
        PII_APP_ROOT / ".local_web_state" / "outputs" / "Teams-full-transcript-combined-20251208-20250724_redacted.docx",
        PII_APP_ROOT / "synthetic_transcript.docx",
    ]
    results = []
    for path in candidates:
        if not path.exists():
            continue
        try:
            stats = analyze_docx(path)
        except Exception as exc:  # noqa: BLE001 -- spike script, report and continue
            results.append({"file": path.name, "error": str(exc)})
            continue
        stats["fidelityFlags"] = fidelity_flags(stats)
        results.append(stats)

    out_path = Path(__file__).resolve().parents[1] / "docs" / "ooxml-spike" / "structural-findings.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"Wrote {out_path}")
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
