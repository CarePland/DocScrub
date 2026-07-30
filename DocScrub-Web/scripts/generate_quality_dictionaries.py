"""Regenerates DocScrub-Web/src/engines/quality/quality-dictionaries.data.ts
from the LIVE Python redactor.candidate_quality module, so the TS port's
lexicon data is byte-for-byte what Python actually computes at runtime
rather than a hand-transcribed (and therefore bug-prone) copy.

Run from work/pii_docx_redactor with that directory on sys.path:

    cd work/pii_docx_redactor
    python3 ../../DocScrub-Web/scripts/generate_quality_dictionaries.py \
        ../../DocScrub-Web/src/engines/quality/quality-dictionaries.data.ts

IMPORTANT: QUALITY_DICTIONARIES_DATA keys are emitted in Python's actual
dict insertion order (list(QUALITY_DICTIONARIES.keys()), NOT sorted).
_dictionary_rules() in scoring.ts iterates this object's keys to build the
`classifications` list, and that list's order flows through into
QualityResult.reasons / evidence_breakdown -- order Andrew's Phase 5
instructions explicitly require verifying ("candidate ordering", "quality
reasons"). An earlier version of this script sorted keys alphabetically
"for determinism" without checking whether Python's real order was already
alphabetical -- it is not (confirmed: pronoun_or_determiner comes first,
not abbreviation) -- which would have silently produced reason-order
mismatches despite identical scores. Every other embedded collection here
(EVIDENCE_WEIGHTS, KNOWN_GIVEN_NAMES, etc.) is a Python set or a dict never
iterated for ordered output in candidate_quality.py, so sorting those for
readability is safe and was left alone.
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, ".")
from redactor.candidate_quality import (  # noqa: E402
    QUALITY_DICTIONARIES,
    COMMON_DICTIONARY_EXCLUSIONS,
    NEGATIVE_FILTER_RULES,
    AMBIGUOUS_NAME_SOFT_NEGATIVES,
    PROTECTIVE_SINGLE_TOKEN_EVIDENCE_RULES,
    KNOWN_GIVEN_NAMES,
    KNOWN_SURNAMES,
    EVIDENCE_WEIGHTS,
    STATUS_THRESHOLDS,
)

out_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(
    "../DocScrub-Web/src/engines/quality/quality-dictionaries.data.ts"
)

# Preserve real Python dict insertion order -- do NOT sort.
dictionaries_data = {
    rule: sorted(terms) for rule, terms in QUALITY_DICTIONARIES.items()
}

header = '''/**
 * GENERATED DATA -- do not hand-edit. Regenerate via
 * scripts/generate_quality_dictionaries.py (see that script's own header
 * for exact invocation and, importantly, why QUALITY_DICTIONARIES_DATA's
 * key order must never be re-sorted).
 *
 * This is the exact merged runtime content of Python's
 * redactor/candidate_quality.py QUALITY_DICTIONARIES and related constants
 * -- extracted by importing the live Python module and dumping its
 * already-computed values, not by re-implementing its file-loading/merge
 * logic in TypeScript. That avoids a whole class of possible port bugs
 * (wrong merge order, wrong directory-scan order, wrong exclusion
 * filtering) by construction: whatever Python's QUALITY_DICTIONARIES
 * dict actually contains at runtime is exactly what's embedded here.
 *
 * Includes config/candidate-quality/*.txt, config/lexical_evidence/*.txt,
 * and the repo-root candidate_quality_terms.json override, merged exactly
 * as Python's load_quality_dictionaries() does. Notably includes a
 * "readme" pseudo-lexicon (45 terms) -- this is a CONFIRMED, PRE-EXISTING
 * PYTHON BUG, not something introduced by this port: config/lexical_
 * evidence/README.txt's stem is "README" (uppercase), but Python's
 * exclusion check `if name in {"readme", "lexicon_manifest"}` is
 * case-sensitive and never matches it, so the README's prose gets loaded
 * as a lexicon. Ported faithfully anyway per "port faithfully, document
 * deviations, do not silently fix" -- it has ZERO scoring impact (not in
 * EVIDENCE_WEIGHTS, not in NEGATIVE_FILTER_RULES, so it can appear as a
 * spurious classification but never changes a score or a filter
 * decision). See docs/detection/phase-5-findings.md for the full
 * writeup and a recommendation to fix it in Python upstream.
 *
 * QUALITY_DICTIONARIES_DATA's key order is Python's real dict insertion
 * order (NOT alphabetically sorted) -- see this file's own note above and
 * scoring.ts's _dictionary_rules() port, which iterates these keys in
 * order to build an ordered classifications list.
 */

'''

def ts_array(values):
    return json.dumps(list(values), ensure_ascii=False)

def ts_dict_of_arrays(d, key_order):
    parts = []
    for k in key_order:
        parts.append(f"{json.dumps(k)}:{ts_array(d[k])}")
    return "{" + ",".join(parts) + "}"

def ts_dict_of_numbers(d):
    parts = [f"{json.dumps(k)}:{v}" for k, v in d.items()]
    return "{" + ",".join(parts) + "}"

lines = [header]
lines.append(
    "export const QUALITY_DICTIONARIES_DATA: Record<string, string[]> = "
    + ts_dict_of_arrays(dictionaries_data, list(QUALITY_DICTIONARIES.keys()))
    + ";\n\n"
)
lines.append(
    "export const COMMON_DICTIONARY_EXCLUSIONS: readonly string[] = "
    + ts_array(sorted(COMMON_DICTIONARY_EXCLUSIONS)) + ";\n\n"
)
lines.append(
    "export const NEGATIVE_FILTER_RULES: readonly string[] = "
    + ts_array(sorted(NEGATIVE_FILTER_RULES)) + ";\n\n"
)
lines.append(
    "export const AMBIGUOUS_NAME_SOFT_NEGATIVES: readonly string[] = "
    + ts_array(sorted(AMBIGUOUS_NAME_SOFT_NEGATIVES)) + ";\n\n"
)
lines.append(
    "export const PROTECTIVE_SINGLE_TOKEN_EVIDENCE_RULES: readonly string[] = "
    + ts_array(sorted(PROTECTIVE_SINGLE_TOKEN_EVIDENCE_RULES)) + ";\n\n"
)
lines.append(
    "export const KNOWN_GIVEN_NAMES: readonly string[] = "
    + ts_array(sorted(KNOWN_GIVEN_NAMES)) + ";\n\n"
)
lines.append(
    "export const KNOWN_SURNAMES: readonly string[] = "
    + ts_array(sorted(KNOWN_SURNAMES)) + ";\n\n"
)
lines.append(
    "export const EVIDENCE_WEIGHTS: Record<string, number> = "
    + ts_dict_of_numbers(dict(sorted(EVIDENCE_WEIGHTS.items()))) + ";\n\n"
)
lines.append(
    "export const STATUS_THRESHOLDS: Record<string, number> = "
    + ts_dict_of_numbers(STATUS_THRESHOLDS) + ";\n"
)

out_path.write_text("".join(lines), encoding="utf-8")
print(f"wrote {out_path} ({out_path.stat().st_size} bytes)")
print("QUALITY_DICTIONARIES_DATA key order:", list(QUALITY_DICTIONARIES.keys()))
