#!/usr/bin/env python3
"""
generate_medical_terminology.py -- generates the production MedicalEvidence
terminology reference asset (AG, 2026-08-10).

SOURCE
    `docscrub_medical_terms.csv`, a provenance-carrying medical/healthcare
    terminology reference assembled from NLM MeSH 2026 (a deliberately limited
    set of high-confidence canonical headings), CMS administrative/coverage/
    coding vocabulary, and CDC healthcare-personnel, infection-control and
    epidemiology terminology including source-attested abbreviations. See the
    accompanying `docscrub_medical_terms_methodology.md`.

    The supplied artifact also ships a JSON form. It was verified
    field-for-field identical to the CSV (381 rows, 12 columns, zero
    differences), so only the CSV is carried into the repository -- a second
    copy of the same bytes is a second thing to keep in sync, not a second
    source.

OUTPUT
    src/engines/knowledge/medical-terminology.data.ts

USAGE
    python3 scripts/generate_medical_terminology.py <path-to-csv>

WHAT THIS ASSET IS, AND THE ONE CLAIM IT LICENSES
    A match licenses exactly one sentence:

        "this phrase is attested medical/healthcare terminology."

    It is NOT a semantic type, NOT a Keep/Redact decision, NOT evidence of
    non-personhood, and -- the boundary specific to THIS family -- NOT a
    statement about any individual. `Diabetes Mellitus`, `HIV`, `Chemotherapy`
    and `Psychiatry` occurring in a document means those PHRASES are attested
    terminology. It never means a person has a condition, received a
    treatment, or was seen by a service. There is no patient-state inference
    anywhere in this asset or its runtime module, and there must not be.

    The collision population is real and is carried, not filtered: `Case`,
    `Claim`, `Provider`, `Agent`, `Carrier`, `Premium`, `Bias`, `Surveillance`
    and `Association` are all genuine CMS/CDC terminology AND ordinary
    English, and 38 rows (chiefly short abbreviations -- `RT`, `IV`, `TB`,
    `GAS`, `LP`, `ADA`, `CPT`) are flagged HIGH collision risk by the dataset
    itself. That flag is a warning to carry forward, never an exclusion.

WHY EVERY ROW IS CARRIED, NOT DEDUPLICATED TO A KEY SET
    3 normalized terms are attested by more than one source family --
    `hemodialysis` and `hemofiltration` by both CDC and MeSH, `morbidity` by
    both CDC and MeSH. Corroboration across independent federal source
    families is exactly the provenance a future evidence-combination layer
    will want to weigh, so the asset keys to a LIST of attestations. Same
    decision, same reason, as the higher-ed asset.

NORMALIZATION -- REPRODUCED, NOT REINVENTED
    `normalized_term` in the CSV was produced by the dataset's own generator.
    This script re-derives it from `term` with the five rules documented in the
    methodology (Section "Normalization") and ASSERTS equality on every row.
    A divergence here is not a build error -- it is a lookup that silently
    misses at runtime.

      1. NFKC
      2. trim
      3. Unicode dash variants -> ASCII hyphen
      4. collapse repeated whitespace
      5. Unicode casefold

    NOTE THE RULE THAT IS ABSENT, because it is the difference from the
    higher-ed normalizer: punctuation is NOT collapsed to space and NOT
    stripped. `case-control study`, `hospitals, veterans` and `sensitivity and
    specificity` keep their hyphens and commas in the key. That is this
    dataset's own policy and it is load-bearing -- it is precisely why the 7
    derived variants exist as separate rows (`case control study` is a
    genuinely different key from `case-control study`, so the source enumerates
    both rather than deriving one from the other at runtime).

    THE CASEFOLD GAP, and why this script checks it three ways. Python's
    `str.casefold()` is FULL case folding; JavaScript's `toLowerCase()` is the
    simple lowercase mapping, and the two disagree on a small set of
    characters that NFKC does not already resolve (ss-ligature, long s, final
    sigma). The runtime module implements the restricted fold below. To make
    a divergence impossible to ship silently, every row is required to satisfy

        csv normalized_term == python casefold(...) == restricted fold(...)

    which holds today because every shipped term is ASCII, and which will fail
    loudly the day a non-ASCII term is added to the source.

REPRESENTATION
    Small dataset (381 rows), so the Census asset's bit-packing is
    unnecessary. Three intern tables plus one tab-separated row block, exactly
    as the higher-ed asset does -- the shapes are deliberately parallel so the
    later "bring the evidence families together" pass has two instances of one
    pattern to generalize from rather than two dialects to reconcile.

      MEDICAL_SOURCES   (source_name, source_family, authority, url) 4-tuples.
                        URL is interned WITH the source rather than in its own
                        table: in this dataset the URL is functionally
                        determined by the source (6 sources, 6 URLs), unlike
                        higher-ed where CEDS supplies a per-term URL. Tuple
                        interning stays correct either way.
      MEDICAL_PARENTS   parent_term values, index 0 reserved for "".
      MEDICAL_NOTES     44 distinct note strings.
      MEDICAL_ROWS      one line per row, TAB-separated:
                        normalized, term, hintIdx, sourceIdx, attested(0|1),
                        derived(0|1), parentIdx, riskIdx, notesIdx

    Rows are sorted by normalized key, then by original CSV order within a
    key, so multi-provenance rows sit together and the file diffs cleanly.

WHAT IS DELIBERATELY NOT DERIVED HERE
    The abbreviation marker and the source expansion carried in `notes`
    ("abbreviation; ...", "expansion: Reverse Transcription") are NOT split
    into their own columns. The notes ship verbatim and the runtime module
    parses them once at index build, so this asset stays a faithful mirror of
    the source CSV and there is exactly one place where prose becomes
    structure. The counts that parse must produce are asserted below (43
    abbreviation rows, 38 of them carrying an expansion, matching the
    methodology's own stated figures) so a future CSV whose note prose changed
    fails here rather than quietly producing zero expansions at runtime.

DO NOT HAND-EDIT THE GENERATED FILE.
"""

import csv
import re
import sys
import unicodedata
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "src" / "engines" / "knowledge" / "medical-terminology.data.ts"
VERSION = "docscrub-medical-terminology/2026-08-10-v1"

# Closed vocabularies from the source dataset. Pinned here (rather than
# discovered) so an unexpected value in a future CSV is a loud failure instead
# of a silently widened enum the TypeScript union would then reject.
HINTS = [
    "MEDICAL_CONCEPT", "CONDITION", "PROCEDURE", "MEDICATION", "TEST", "ANATOMY",
    "DOCUMENT", "PROCESS_EVENT", "ROLE", "ORGANIZATION_DEPARTMENT", "BILLING_CODING",
    "IDENTIFIER_TYPE", "OTHER_DOMAIN_TERM", "AMBIGUOUS",
]
RISKS = ["LOW", "MEDIUM", "HIGH"]
AUTHORITIES = ["US_FEDERAL_AGENCY", "US_FEDERAL_CONTROLLED_VOCABULARY"]

# Step 3 of the documented normalization. Enumerated rather than expressed as a
# Unicode category test, because `Pd` also contains characters that are not
# hyphens in any useful sense. The runtime module ships the identical set.
DASHES = {
    "\u2010": "-", "\u2011": "-", "\u2012": "-", "\u2013": "-", "\u2014": "-",
    "\u2015": "-", "\u2043": "-", "\u2212": "-", "\ufe58": "-", "\ufe63": "-",
    "\uff0d": "-",
}

# The characters on which full case folding and simple lowercasing disagree and
# NFKC has not already resolved the difference. Applied BEFORE lowercasing so
# the result matches Python's casefold on realistic Latin/Greek input. This is
# the whole of the divergence the module claims to handle; anything outside it
# is caught by the three-way parity assertion in main().
FOLD_EXCEPTIONS = {
    "\u00df": "ss",   # LATIN SMALL LETTER SHARP S
    "\u1e9e": "ss",   # LATIN CAPITAL LETTER SHARP S
    "\u017f": "s",    # LATIN SMALL LETTER LONG S
    "\u03c2": "\u03c3",  # GREEK SMALL LETTER FINAL SIGMA
}

ABBREVIATION_MARKER = re.compile(r"(?:^|; )abbreviation(?:;|$)")
EXPANSION = re.compile(r"(?:^|; )expansion: (.*?)(?:; |$)")


def _shared_steps(term: str) -> str:
    """Steps 1-4: NFKC, trim, dashes, collapse whitespace."""
    text = unicodedata.normalize("NFKC", term).strip()
    text = "".join(DASHES.get(ch, ch) for ch in text)
    return re.sub(r"\s+", " ", text)


def normalize_casefold(term: str) -> str:
    """The documented five steps, using Python's full casefold."""
    return _shared_steps(term).casefold()


def normalize_restricted(term: str) -> str:
    """The same five steps using the fold the TypeScript runtime implements.
    Must stay behaviourally identical to `normalizeForMedicalLookup` in
    src/engines/knowledge/MedicalEvidence.ts."""
    text = _shared_steps(term)
    text = "".join(FOLD_EXCEPTIONS.get(ch, ch) for ch in text)
    return text.lower()


def ts_string(value: str) -> str:
    """A double-quoted TypeScript string literal. Tabs and newlines MUST be
    escaped, not embedded: the row block is tab-separated and newline-
    delimited, so both appear on the hot path."""
    return (
        '"'
        + value.replace("\\", "\\\\").replace('"', '\\"').replace("\t", "\\t").replace("\r", "\\r").replace("\n", "\\n")
        + '"'
    )


def chunked_literal(parts: list[str], name: str) -> str:
    """One multi-hundred-kilobyte line is legal TypeScript but hostile to every
    editor and diff tool. The compiler folds the concatenation."""
    body = "\n  + ".join(ts_string(p) for p in parts)
    return f"export const {name} = {body};\n"


def main(csv_path: str) -> None:
    with open(csv_path, encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    if not rows:
        raise SystemExit(f"{csv_path}: no rows")

    sources: list[tuple[str, str, str, str]] = []
    parents: list[str] = [""]
    notes: list[str] = []

    def intern(table: list, value):
        try:
            return table.index(value)
        except ValueError:
            table.append(value)
            return len(table) - 1

    encoded: list[tuple[str, int, str]] = []  # (normalized, csv order, line)
    mismatches: list[str] = []
    abbreviation_rows = 0
    expansion_rows = 0

    for order, row in enumerate(rows):
        term = row["term"]
        attested_raw = row["source_attested"].strip().lower()
        derived_raw = row["derived_variant"].strip().lower()
        if attested_raw not in ("true", "false"):
            raise SystemExit(f"row {order}: source_attested must be true/false, got {attested_raw!r}")
        if derived_raw not in ("true", "false"):
            raise SystemExit(f"row {order}: derived_variant must be true/false, got {derived_raw!r}")
        if row["semantic_hint"] not in HINTS:
            raise SystemExit(f"row {order}: unknown semantic_hint {row['semantic_hint']!r} -- widen HINTS *and* the TS union deliberately")
        if row["collision_risk"] not in RISKS:
            raise SystemExit(f"row {order}: unknown collision_risk {row['collision_risk']!r}")
        if row["source_authority_level"] not in AUTHORITIES:
            raise SystemExit(f"row {order}: unknown source_authority_level {row['source_authority_level']!r}")

        # PROVENANCE COHERENCE. A derived variant must name a parent and must
        # not claim source attestation; a source-attested row must not carry a
        # parent. Both hold on all 381 rows today. If a future CSV breaks this,
        # `hasSourceAttestedRow` and the derived-variant caveat shown to the
        # reviewer would both start lying, so it fails here.
        if (derived_raw == "true") == (attested_raw == "true"):
            raise SystemExit(f"row {order} ({term!r}): source_attested and derived_variant must be opposites")
        if derived_raw == "true" and not row["parent_term"]:
            raise SystemExit(f"row {order} ({term!r}): derived variant with no parent_term")
        if derived_raw == "false" and row["parent_term"]:
            raise SystemExit(f"row {order} ({term!r}): source-attested row carries a parent_term")

        # NORMALIZATION PARITY, three ways. See the module docstring.
        stored = row["normalized_term"]
        by_casefold = normalize_casefold(term)
        by_restricted = normalize_restricted(term)
        if by_casefold != stored:
            mismatches.append(f"casefold  term={term!r} stored={stored!r} derived={by_casefold!r}")
        if by_restricted != stored:
            mismatches.append(f"restricted term={term!r} stored={stored!r} derived={by_restricted!r}")

        if ABBREVIATION_MARKER.search(row["notes"]):
            abbreviation_rows += 1
        if EXPANSION.search(row["notes"]):
            expansion_rows += 1

        fields = [
            stored, term,
            str(HINTS.index(row["semantic_hint"])),
            str(intern(sources, (row["source_name"], row["source_family"], row["source_authority_level"], row["source_url"]))),
            "1" if attested_raw == "true" else "0",
            "1" if derived_raw == "true" else "0",
            str(intern(parents, row["parent_term"])),
            str(RISKS.index(row["collision_risk"])),
            str(intern(notes, row["notes"])),
        ]
        for field in fields:
            if "\t" in field or "\n" in field or "\r" in field:
                raise SystemExit(f"row {order}: field contains a tab/newline, which the TSV encoding cannot carry: {field!r}")
        encoded.append((stored, order, "\t".join(fields)))

    if mismatches:
        for line in mismatches[:20]:
            print(f"  NORMALIZATION MISMATCH  {line}", file=sys.stderr)
        raise SystemExit(
            f"{len(mismatches)} normalization mismatches over {len(rows)} rows. "
            "Reconcile normalize_*() here with the dataset's own generator BEFORE shipping -- "
            "a divergence is a silent lookup miss at runtime, not a build error."
        )

    # The counts the methodology itself states. An independent cross-check that
    # the note-parsing rule the runtime relies on still finds what it expects.
    if abbreviation_rows != 43 or expansion_rows != 38:
        raise SystemExit(
            f"note parsing found {abbreviation_rows} abbreviation rows and {expansion_rows} expansions; "
            "the source methodology states 43 and 38. The note prose or the parsing rule has changed -- "
            "reconcile MedicalEvidence.ts's parser before shipping."
        )

    # Every parent_term must itself be a shipped term, or the reviewer-facing
    # 'derived from X' caveat points at nothing.
    all_terms = {row["term"] for row in rows}
    orphans = sorted({row["parent_term"] for row in rows if row["parent_term"] and row["parent_term"] not in all_terms})
    if orphans:
        raise SystemExit(f"parent_term values with no corresponding row: {orphans}")

    encoded.sort(key=lambda item: (item[0], item[1]))
    lines = [line for _, _, line in encoded]

    keys = [key for key, _, _ in encoded]
    distinct_keys = len(set(keys))
    multi = sum(1 for key in set(keys) if keys.count(key) > 1)
    derived_count = sum(1 for row in rows if row["derived_variant"].strip().lower() == "true")
    risk_counts = {risk: sum(1 for row in rows if row["collision_risk"] == risk) for risk in RISKS}
    family_counts: dict[str, int] = {}
    for row in rows:
        family_counts[row["source_family"]] = family_counts.get(row["source_family"], 0) + 1

    nl = chr(10)
    hints_literal = ", ".join(ts_string(h) for h in HINTS)
    risks_literal = ", ".join(ts_string(r) for r in RISKS)
    sources_literal = nl.join(
        f"  [{ts_string(n)}, {ts_string(f)}, {ts_string(a)}, {ts_string(u)}]," for n, f, a, u in sources
    )
    parents_literal = nl.join(f"  {ts_string(p)}," for p in parents)
    notes_literal = nl.join(f"  {ts_string(n)}," for n in notes)
    families_literal = ", ".join(f"{k} {v}" for k, v in sorted(family_counts.items()))

    header = f'''/**
 * medical-terminology.data.ts -- GENERATED. DO NOT HAND-EDIT.
 *
 * Regenerate with:
 *     python3 scripts/generate_medical_terminology.py <docscrub_medical_terms.csv>
 *
 * SOURCE: `docscrub_medical_terms.csv` -- a provenance-carrying medical and
 * healthcare terminology reference built from NLM MeSH 2026 (a deliberately
 * limited set of high-confidence canonical headings), CMS administrative,
 * coverage and coding vocabulary, and CDC healthcare-personnel,
 * infection-control and epidemiology terminology. Term labels and provenance
 * only; no source definitions or glossary prose are reproduced.
 *
 * LICENSING, and what is therefore ABSENT: SNOMED CT, the UMLS Metathesaurus,
 * AMA CPT descriptors, LOINC and RxNorm are all deliberately NOT in this pack.
 * The first three carry redistribution restrictions; the last two are
 * attribution-conditioned and are candidates for a separately licensed,
 * separately benchmarked expansion. `Current Procedural Terminology` and `CPT`
 * appear here as CMS-attested coding vocabulary -- no CPT code descriptors do.
 * Do not "improve" this asset by adding restricted sources to it.
 *
 * CONTENT: {len(rows)} attestation rows over {distinct_keys} distinct
 * normalized terms. {multi} terms are attested by more than one row and every
 * such row is retained -- corroboration across independent federal source
 * families is evidence a future combination layer will want, and collapsing to
 * a key set would destroy it. {derived_count} rows are conservative orthographic
 * variants (hyphen/space forms) rather than direct source labels, each naming
 * its source-attested parent.
 * Source families: {families_literal}.
 * Collision risk: LOW {risk_counts["LOW"]}, MEDIUM {risk_counts["MEDIUM"]},
 * HIGH {risk_counts["HIGH"]}.
 *
 * THE ONE CLAIM A MATCH LICENSES: "this phrase is attested medical/healthcare
 * terminology." Not a semantic type, not a Keep, not evidence of
 * non-personhood -- and, the boundary specific to this family, never a
 * statement about an individual. A document containing `Diabetes Mellitus` or
 * `HIV` yields terminology evidence about the PHRASE and nothing whatever
 * about any person named nearby.
 *
 * REPRESENTATION: three intern tables plus a tab-separated row block, sorted by
 * normalized key then source order. Deliberately the same shape as
 * higher-ed-terminology.data.ts so the later unification pass has two
 * instances of one pattern rather than two dialects.
 */

export const MEDICAL_TERMINOLOGY_SOURCE = "{VERSION}";
export const MEDICAL_TERMINOLOGY_ROW_COUNT = {len(rows)};
export const MEDICAL_TERMINOLOGY_TERM_COUNT = {distinct_keys};

/** Closed vocabulary from the source dataset, index-addressed by column 2 of
 *  each row. Order is load-bearing -- regenerating with a different order
 *  invalidates every shipped row. */
export const MEDICAL_SEMANTIC_HINTS = [{hints_literal}] as const;

/** Index-addressed by column 7. Order is load-bearing. */
export const MEDICAL_COLLISION_RISKS = [{risks_literal}] as const;

/** Index-addressed by column 3: [sourceName, sourceFamily, authorityLevel, url].
 *  The URL is interned with the source because in this dataset it is
 *  functionally determined by it; tuple interning stays correct if a future
 *  source supplies per-term URLs. */
export const MEDICAL_SOURCES: readonly (readonly [string, string, string, string])[] = [
{sources_literal}
];

/** Index-addressed by column 6. Index 0 is the empty string: source-attested
 *  rows have no parent, and reserving the slot keeps the column dense. */
export const MEDICAL_PARENTS: readonly string[] = [
{parents_literal}
];

/** Index-addressed by column 8. Provenance prose from the source dataset --
 *  it carries the abbreviation marker and, for 38 rows, the source's own
 *  expansion. Shipped verbatim; MedicalEvidence.ts parses it once at index
 *  build rather than this asset pre-splitting it. */
export const MEDICAL_NOTES: readonly string[] = [
{notes_literal}
];

'''

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as out:
        out.write(header)
        # Group whole LINES per literal piece, so no piece ends mid-escape.
        per_piece = 100
        groups = [lines[i:i + per_piece] for i in range(0, len(lines), per_piece)]
        parts = ["\n".join(g) + ("\n" if n < len(groups) - 1 else "") for n, g in enumerate(groups)]
        out.write("/** One line per attestation row, TAB-separated:\n"
                  " *  normalized, term, hintIdx, sourceIdx, attested(0|1), derived(0|1),\n"
                  " *  parentIdx, riskIdx, notesIdx */\n")
        out.write(chunked_literal(parts, "MEDICAL_ROWS"))

    size = OUT.stat().st_size
    print(f"wrote {OUT} ({size / 1024:.1f} KiB)")
    print(f"  rows={len(rows)} terms={distinct_keys} multi-provenance={multi} derived={derived_count}")
    print(f"  interned: sources={len(sources)} parents={len(parents) - 1} notes={len(notes)}")
    print(f"  notes: abbreviation rows={abbreviation_rows} with expansion={expansion_rows}")
    print(f"  normalization parity: {len(rows)}/{len(rows)} rows reproduce normalized_term under BOTH folds")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
