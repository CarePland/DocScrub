#!/usr/bin/env python3
"""
Read-only golden-fixture exporter.

Imports the existing Python redactor package (work/pii_docx_redactor/redactor)
by path -- it does NOT modify anything under work/pii_docx_redactor. It runs a
synthetic source document through the current deterministic pipeline (parse ->
detect -> score -> entity-resolve -> classify occurrences) and writes the
result as versioned JSON fixtures under fixtures/domain-parity/<case-id>/.

This is Phase 1 foundation work (architecture v0.2 §14, Phase 1: "Capture
Python behavior with schemas and golden fixtures"). It intentionally covers
one small, synthetic case end-to-end rather than a full fixture corpus --
the goal here is a working, versioned fixture *format* that later cases can
be added to, not full migration parity yet.

Usage:
    python3 scripts/export_fixtures.py
"""
from __future__ import annotations

import dataclasses
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]  # .../DocScrub
DOCSCRUB_WEB = Path(__file__).resolve().parents[1]  # .../DocScrub-Web
PII_APP_ROOT = REPO_ROOT / "work" / "pii_docx_redactor"

if not PII_APP_ROOT.exists():
    raise SystemExit(f"Expected to find the Python app at {PII_APP_ROOT}, but it does not exist.")

# Read-only: we add the existing app's directory to sys.path so we can import
# its `redactor` package as a library. We never write into PII_APP_ROOT.
sys.path.insert(0, str(PII_APP_ROOT))

# CONFIRMED BUG FIX (Phase 5, found while porting candidate_quality.py to
# TypeScript): redactor/candidate_quality.py resolves its lexicon
# directories via `Path.cwd()` (LEXICON_DIR / LEXICAL_EVIDENCE_DIR /
# LOCAL_DICTIONARY_PATH), NOT relative to the package's own file location
# or to PII_APP_ROOT. This script (and build_structural_fixtures.py) are
# documented and normally invoked as `cd DocScrub-Web && python3
# scripts/export_fixtures.py` -- meaning Path.cwd() was DocScrub-Web/, which
# has no config/ directory at all. Every fixture this repo has ever
# generated therefore captured candidate_quality scoring under a SILENTLY
# DEGRADED oracle state: QUALITY_DICTIONARIES fell back to just the ~16
# small built-in DEFAULT_QUALITY_DICTIONARIES entries (common_english_word
# ends up completely empty, for example), never loading any of
# config/candidate-quality/*.txt or config/lexical_evidence/*.txt (tens of
# thousands of real lexicon terms). This was discovered by cross-checking
# the TS port (src/engines/quality/scoring.ts) against a fixture and
# finding a real disagreement, then confirming the *live* Python module
# (run with the correct cwd) actually agrees with the TS port, not with the
# existing fixture -- see docs/detection/phase-5-findings.md for the full
# writeup. Chdir'ing into PII_APP_ROOT before importing candidate_quality
# (which computes its lexicon paths at MODULE IMPORT time) is the minimal
# fix: every other path in this script is already absolute
# (REPO_ROOT/DOCSCRUB_WEB/PII_APP_ROOT-derived), so this is safe. This does
# not modify anything under PII_APP_ROOT -- it only changes which directory
# this process's relative-path lookups resolve against, restoring the
# working directory the Python app's own lexicon-loading code was written
# to assume (consistent with pytest.ini's `pythonpath = .` and how
# local_web_app.py/app.py are actually run in production, both from within
# PII_APP_ROOT).
os.chdir(PII_APP_ROOT)

from redactor.docx_reader import iter_docx_text_blocks, load_docx, sha256_file  # noqa: E402
from redactor.detectors import detect_all_candidates  # noqa: E402
from redactor.candidate_quality import apply_candidate_quality  # noqa: E402
from redactor.entity_resolution import build_entity_groups, build_ambiguous_matches  # noqa: E402
from redactor.occurrence_groups import group_occurrences  # noqa: E402
from redactor.models import Occurrence  # noqa: E402

# APP_BUILD is read as text rather than imported, because local_web_app.py
# starts an HTTP server / has module-level side effects we do not want to
# trigger just to read one string constant.
def _read_app_build() -> str:
    host_file = PII_APP_ROOT / "local_web_app.py"
    for line in host_file.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith("APP_BUILD"):
            return line.split("=", 1)[1].strip().strip('"')
    return "unknown"


FIXTURE_MANIFEST_SCHEMA_VERSION = 1


def _occurrence_to_json(occ: Occurrence) -> dict:
    return {
        "id": occ.id,
        "candidateKey": occ.candidate_key,
        "text": occ.text,
        "detectedType": occ.detected_type,
        "source": occ.source,
        "location": occ.location,
        "start": occ.start,
        "end": occ.end,
        "context": occ.context,
    }


def build_case(case_id: str, source_docx: Path, out_dir: Path) -> None:
    document = load_docx(source_docx)
    blocks = iter_docx_text_blocks(document)

    candidates = detect_all_candidates(blocks, use_spacy=False)
    candidates = apply_candidate_quality(candidates)

    groups = build_entity_groups(candidates)
    ambiguous = build_ambiguous_matches(candidates, groups)

    candidates_json = []
    all_occurrences_json = []
    for c in sorted(candidates, key=lambda c: c.key):
        candidates_json.append(
            {
                "key": c.key,
                "text": c.text,
                "detectedType": c.detected_type,
                "source": c.source,
                "confidence": c.confidence,
                "quality": c.quality,
                "qualityStatus": c.quality_status,
                "candidateScore": c.candidate_score,
                "qualityReasons": c.quality_reasons,
                "occurrenceIds": [o.id for o in c.occurrences],
            }
        )
        for o in c.occurrences:
            all_occurrences_json.append(_occurrence_to_json(o))

    occurrence_groups_json = [
        {
            "id": g.id,
            "kind": g.kind,
            "label": g.label,
            "occurrenceCount": g.occurrence_count,
            "occurrenceIds": [o.id for o in g.occurrences],
        }
        for g in group_occurrences([o for c in candidates for o in c.occurrences])
    ]

    entity_groups_json = [
        {
            "id": g.id,
            "canonicalName": g.canonical_name,
            "detectedType": g.detected_type,
            "memberKeys": list(g.candidate_keys),
            "confidence": g.confidence,
            "memberConfidences": g.member_confidences,
            "reasons": g.reasons,
        }
        for g in groups
    ]

    ambiguous_json = [
        {
            "candidateKey": m.candidate_key,
            "possibleGroups": [
                {
                    "id": pg["id"],
                    "canonicalName": pg["canonical_name"],
                    "confidence": pg["confidence"],
                }
                for pg in m.possible_groups
            ],
        }
        for m in ambiguous
    ]

    out_dir.mkdir(parents=True, exist_ok=True)
    expected_dir = out_dir / "expected"
    expected_dir.mkdir(exist_ok=True)

    # CONFIRMED BUG FIX (Phase 7, found while re-running all prior
    # verification suites before declaring OccurrenceClassifier done):
    # this function unconditionally OVERWRITES manifest.json wholesale on
    # every run, and the manifest dict this function builds below has never
    # included a "deviations" key -- so any hand-curated, approved deviation
    # entry (fixtures/schema/fixture-manifest.schema.json's documented
    # `deviations[]` field, architecture v0.2 §13's "intentional deviations
    # must be approved and recorded, not silently accepted") is silently
    # destroyed the next time this script regenerates that fixture's
    # manifest.json. This is exactly how content-control-001's
    # Desmond-Okonkwo deviation record -- described as already-recorded in
    # docs/detection/phase-4-findings.md -- ended up missing from that
    # fixture's actual manifest.json, causing verify/detection-parity.ts to
    # report a false FAIL. Fixed by reading and preserving any existing
    # "deviations" array from the manifest.json this run is about to
    # replace, rather than dropping it. Read-only with respect to
    # PII_APP_ROOT as always; this only changes how this script treats its
    # own previously-written output.
    existing_manifest_path = out_dir / "manifest.json"
    preserved_deviations = None
    if existing_manifest_path.exists():
        try:
            existing_manifest = json.loads(existing_manifest_path.read_text(encoding="utf-8"))
            preserved_deviations = existing_manifest.get("deviations")
        except (json.JSONDecodeError, OSError):
            preserved_deviations = None

    (expected_dir / "candidates.json").write_text(
        json.dumps({"schemaVersion": 1, "candidates": candidates_json}, indent=2), encoding="utf-8"
    )
    (expected_dir / "occurrences.json").write_text(
        json.dumps({"schemaVersion": 1, "occurrences": all_occurrences_json}, indent=2), encoding="utf-8"
    )
    (expected_dir / "occurrence-groups.json").write_text(
        json.dumps({"schemaVersion": 1, "occurrenceGroups": occurrence_groups_json}, indent=2), encoding="utf-8"
    )
    (expected_dir / "entity-groups.json").write_text(
        json.dumps({"schemaVersion": 1, "entityGroups": entity_groups_json}, indent=2), encoding="utf-8"
    )
    (expected_dir / "ambiguity-proposals.json").write_text(
        json.dumps({"schemaVersion": 1, "ambiguityProposals": ambiguous_json}, indent=2, default=str),
        encoding="utf-8",
    )

    manifest = {
        "schemaVersion": FIXTURE_MANIFEST_SCHEMA_VERSION,
        "fixtureId": case_id,
        "family": "domain-parity",
        "sourceDocument": {
            "fileName": source_docx.name,
            "sha256": sha256_file(source_docx),
        },
        "pythonAppBuild": _read_app_build(),
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "expectedFiles": [
            "expected/candidates.json",
            "expected/occurrences.json",
            "expected/occurrence-groups.json",
            "expected/entity-groups.json",
            "expected/ambiguity-proposals.json",
        ],
        "notes": (
            "Generated by scripts/export_fixtures.py against a synthetic document. "
            "Covers candidate/occurrence/quality/entity-group/ambiguity output only "
            "(architecture v0.2 §13.1, Domain Parity Fixtures). Interaction and "
            "performance fixtures are tracked separately -- see fixtures/interaction/ "
            "and fixtures/performance/, both currently empty pending Phase 4/5 work."
        ),
    }
    if preserved_deviations is not None:
        manifest["deviations"] = preserved_deviations
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(f"Wrote fixture case '{case_id}' to {out_dir}")


def main() -> None:
    # Build the synthetic source document fresh, inside fixtures/, rather than
    # depending on a possibly-stale copy elsewhere in the repo.
    sys.path.insert(0, str(PII_APP_ROOT))
    from sample_docx_generator import build_sample  # noqa: E402

    fixtures_root = DOCSCRUB_WEB / "fixtures" / "domain-parity"
    case_dir = fixtures_root / "synthetic-transcript-001"
    source_dir = case_dir / "source"
    source_dir.mkdir(parents=True, exist_ok=True)
    source_docx = source_dir / "synthetic_transcript.docx"
    build_sample(source_docx)

    build_case("synthetic-transcript-001", source_docx, case_dir)


if __name__ == "__main__":
    main()
