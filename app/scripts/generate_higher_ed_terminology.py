#!/usr/bin/env python3
"""
generate_higher_ed_terminology.py -- generates the production higher-education
terminology reference asset (AG, 2026-08-10).

SOURCE
    `docscrub_higher_ed_terminology.csv`, a provenance-carrying terminology
    reference assembled from NCES/IPEDS, NCES/CEDS (Postsecondary domain),
    the Federal Student Aid Handbook glossary, and four public
    registrar/catalog/enrollment glossaries. See the accompanying
    `docscrub_higher_ed_terminology_methodology.md` for construction.

OUTPUT
    src/engines/knowledge/higher-ed-terminology.data.ts

USAGE
    python3 scripts/generate_higher_ed_terminology.py <path-to-csv>

WHAT THIS ASSET IS, AND THE ONE CLAIM IT LICENSES
    A match licenses exactly one sentence:

        "this phrase is attested higher-education terminology."

    It is NOT a semantic type, NOT a Keep decision, and NOT evidence of
    non-personhood. The dataset contains `White`, `Major`, `Minor`, `Race`,
    `Session` and `Course` -- all of which are also U.S. Census-attested
    personal-name tokens (34 single-token terms overlap the shipped Census
    asset, 19 of them at HIGH collision risk). Any consumer that reads
    membership as a person-suppressor reintroduces the exact failure the
    Census experiment already measured and rejected.

WHY EVERY ROW IS CARRIED, NOT DEDUPLICATED TO A KEY SET
    21 normalized terms are attested by more than one source family --
    `academic year` by both IPEDS and Federal Student Aid, `white` by both
    IPEDS and CEDS. Corroboration across independent source families is
    exactly the kind of provenance a future evidence-combination layer will
    want to weigh (the methodology explicitly recommends source-family
    weighting). Collapsing to one row per key would destroy it before that
    layer exists, so the asset keys to a LIST of attestations.

NORMALIZATION -- REPRODUCED, NOT REINVENTED
    `normalized_term` in the CSV was produced by the dataset's own generator.
    This script re-derives it from `term` with the rules documented in the
    methodology (§Normalization) and ASSERTS equality on every row. If the
    assertion fires, the runtime normalizer in
    src/engines/knowledge/HigherEdTerminologyEvidence.ts -- which implements
    the same six steps -- would silently disagree with the shipped keys, and
    lookups would miss. Verified: 1394/1394 rows reproduce exactly.

    The rules, and the live data that exercises each one:
      1. NFKC
      2. smart apostrophes/dashes -> ASCII   ("Veteran's Benefit Status", x2)
      3. lowercase
      4. `&` -> ` and `                      ("GASB 34 & 35", "(O&M)", x4)
      5. `[\\W_]+` -> space                   (punctuation to SPACE, never to
                                              nothing -- these are multi-word
                                              phrases and stripping would fuse
                                              tokens into keys the sources
                                              never contained. Same conclusion
                                              the GNIS benchmark reached for
                                              the same reason, and the
                                              opposite of the Census
                                              normalizer, whose keys are
                                              single tokens.)
      6. collapse whitespace, trim

REPRESENTATION
    Small dataset (1,394 rows), so the Census asset's bit-packing is
    unnecessary and would cost readability for nothing. Instead: three
    intern tables for the repetitive columns, and one tab-separated row
    block. Measured output is ~0.2 MiB against ~1.9 MiB for the Census asset.

      HIGHER_ED_SOURCES   6 (source, sourceFamily) pairs
      HIGHER_ED_URLS      470 distinct source URLs (CEDS supplies one per term)
      HIGHER_ED_NOTES     295 distinct note strings
      HIGHER_ED_ROWS      one line per row, TAB-separated:
                          normalized, term, hintIdx, sourceIdx, urlIdx,
                          derived(0|1), riskIdx, notesIdx

    Rows are sorted by normalized key, then by original CSV order within a
    key -- so multi-provenance rows sit together and the file diffs cleanly
    on regeneration. No field contains a tab or newline (asserted below).

DO NOT HAND-EDIT THE GENERATED FILE.
"""

import csv
import re
import sys
import unicodedata
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "src" / "engines" / "knowledge" / "higher-ed-terminology.data.ts"
VERSION = "docscrub-higher-ed-terminology/2026-08-10"

# Semantic hints and collision risks are CLOSED vocabularies from the source
# dataset. Pinned here (rather than discovered) so an unexpected value in a
# future CSV is a loud failure instead of a silently widened enum that the
# TypeScript union would then reject at compile time.
HINTS = ["ACADEMIC_CONCEPT", "DOCUMENT_SYSTEM", "ORGANIZATION", "OTHER_DOMAIN_TERM", "PROCESS_EVENT", "ROLE", "AMBIGUOUS"]
RISKS = ["LOW", "MEDIUM", "HIGH"]

SMART = {
    "‘": "'", "’": "'", "‚": "'", "‛": "'",
    "“": '"', "”": '"', "„": '"', "‟": '"',
    "‐": "-", "‑": "-", "‒": "-", "–": "-",
    "—": "-", "―": "-", "−": "-",
}


def normalize(term: str) -> str:
    """The six documented steps. Must stay byte-identical to
    `normalizeForHigherEdLookup` in HigherEdTerminologyEvidence.ts."""
    text = unicodedata.normalize("NFKC", term)
    text = "".join(SMART.get(ch, ch) for ch in text)
    text = text.lower()
    text = text.replace("&", " and ")
    text = re.sub(r"[\W_]+", " ", text, flags=re.UNICODE)
    return re.sub(r"\s+", " ", text).strip()


def ts_string(value: str) -> str:
    """A double-quoted TypeScript string literal.

    Tabs and newlines MUST be escaped, not embedded. A raw U+0009 inside a
    literal is legal but invisible in every diff; a raw line terminator is an
    outright syntax error. The row block is tab-separated and newline-
    delimited, so both appear on the hot path and the first draft of this
    generator emitted an unparseable file.
    """
    return (
        '"'
        + value.replace("\\", "\\\\").replace('"', '\\"').replace("\t", "\\t").replace("\r", "\\r").replace("\n", "\\n")
        + '"'
    )


def chunked_literal(parts: list[str], name: str) -> str:
    """`export const <name> = "..." + "...";` -- one multi-hundred-kilobyte
    line is legal TypeScript but hostile to every editor and diff tool that
    will open this file. The compiler folds the concatenation, so there is no
    runtime cost. Callers split on line boundaries so no piece can end inside
    an escape sequence."""
    body = "\n  + ".join(ts_string(p) for p in parts)
    return f"export const {name} = {body};\n"


def main(csv_path: str) -> None:
    with open(csv_path, encoding="utf-8", newline="") as handle:
        rows = list(csv.DictReader(handle))
    if not rows:
        raise SystemExit(f"{csv_path}: no rows")

    sources: list[tuple[str, str]] = []
    urls: list[str] = []
    notes: list[str] = []

    def intern(table: list, value):
        try:
            return table.index(value)
        except ValueError:
            table.append(value)
            return len(table) - 1

    encoded: list[tuple[str, int, str]] = []  # (normalized, csv order, line)
    mismatches: list[tuple[str, str, str]] = []

    for order, row in enumerate(rows):
        term = row["term"]
        derived_raw = row["derived_variant"].strip().lower()
        if derived_raw not in ("true", "false"):
            raise SystemExit(f"row {order}: derived_variant must be true/false, got {derived_raw!r}")
        if row["semantic_hint"] not in HINTS:
            raise SystemExit(f"row {order}: unknown semantic_hint {row['semantic_hint']!r} -- widen HINTS *and* the TS union deliberately")
        if row["collision_risk"] not in RISKS:
            raise SystemExit(f"row {order}: unknown collision_risk {row['collision_risk']!r}")

        # NORMALIZATION PARITY. See the module docstring -- if this ever
        # fires, the runtime normalizer and the shipped keys have diverged
        # and every lookup for the affected term will miss.
        derived_key = normalize(term)
        if derived_key != row["normalized_term"]:
            mismatches.append((term, row["normalized_term"], derived_key))

        fields = [
            row["normalized_term"], term,
            str(HINTS.index(row["semantic_hint"])),
            str(intern(sources, (row["source"], row["source_family"]))),
            str(intern(urls, row["source_url"])),
            "1" if derived_raw == "true" else "0",
            str(RISKS.index(row["collision_risk"])),
            str(intern(notes, row["notes"])),
        ]
        for field in fields:
            if "\t" in field or "\n" in field or "\r" in field:
                raise SystemExit(f"row {order}: field contains a tab/newline, which the TSV encoding cannot carry: {field!r}")
        encoded.append((row["normalized_term"], order, "\t".join(fields)))

    if mismatches:
        for term, stored, derived_key in mismatches[:20]:
            print(f"  NORMALIZATION MISMATCH  term={term!r} stored={stored!r} derived={derived_key!r}", file=sys.stderr)
        raise SystemExit(
            f"{len(mismatches)} of {len(rows)} rows do not reproduce their normalized_term. "
            "Reconcile normalize() here with the dataset's own generator BEFORE shipping -- "
            "a divergence here is a silent lookup miss at runtime, not a build error."
        )

    encoded.sort(key=lambda item: (item[0], item[1]))
    lines = [line for _, _, line in encoded]

    distinct_keys = len({key for key, _, _ in encoded})
    multi = sum(1 for key in {k for k, _, _ in encoded} if sum(1 for k2, _, _ in encoded if k2 == key) > 1)
    derived_count = sum(1 for row in rows if row["derived_variant"].strip().lower() == "true")
    risk_counts = {risk: sum(1 for row in rows if row["collision_risk"] == risk) for risk in RISKS}

    nl = chr(10)
    hints_literal = ", ".join(ts_string(h) for h in HINTS)
    risks_literal = ", ".join(ts_string(r) for r in RISKS)
    sources_literal = nl.join(f"  [{ts_string(s)}, {ts_string(f)}]," for s, f in sources)
    urls_literal = nl.join(f"  {ts_string(u)}," for u in urls)
    notes_literal = nl.join(f"  {ts_string(n)}," for n in notes)

    header = f'''/**
 * higher-ed-terminology.data.ts -- GENERATED. DO NOT HAND-EDIT.
 *
 * Regenerate with:
 *     python3 scripts/generate_higher_ed_terminology.py <docscrub_higher_ed_terminology.csv>
 *
 * SOURCE: `docscrub_higher_ed_terminology.csv` -- a provenance-carrying
 * higher-education terminology reference built from NCES/IPEDS, NCES/CEDS
 * (Postsecondary domain), the Federal Student Aid Handbook glossary, and four
 * public registrar/catalog/enrollment glossaries. Term labels and provenance
 * only; no source definitions or glossary prose are reproduced.
 *
 * CONTENT: {len(rows)} attestation rows over {distinct_keys} distinct
 * normalized terms. {multi} terms are attested by more than one row and every
 * such row is retained -- corroboration across independent source families is
 * evidence a future combination layer will want, and collapsing to a key set
 * would destroy it. {derived_count} rows are mechanically derived variants
 * (terminal-parenthetical strip/extract) rather than direct source labels.
 * Collision risk: LOW {risk_counts["LOW"]}, MEDIUM {risk_counts["MEDIUM"]},
 * HIGH {risk_counts["HIGH"]}.
 *
 * THE ONE CLAIM A MATCH LICENSES: "this phrase is attested higher-education
 * terminology." Not a semantic type, not a Keep, and NOT evidence of
 * non-personhood -- 34 single-token terms in here are also Census-attested
 * personal-name tokens ({{White, Major, Minor, Race, Session, Course, ...}}).
 *
 * REPRESENTATION: three intern tables plus a tab-separated row block, sorted
 * by normalized key then source order. The Census asset's bit-packing is
 * deliberately not used -- at {len(rows)} rows it would cost readability and
 * buy nothing.
 */

export const HIGHER_ED_TERMINOLOGY_SOURCE = "{VERSION}";
export const HIGHER_ED_TERMINOLOGY_ROW_COUNT = {len(rows)};
export const HIGHER_ED_TERMINOLOGY_TERM_COUNT = {distinct_keys};

/** Closed vocabulary from the source dataset, index-addressed by column 2 of
 *  each row. Order is load-bearing -- regenerating with a different order
 *  invalidates every shipped row. */
export const HIGHER_ED_SEMANTIC_HINTS = [{hints_literal}] as const;

/** Index-addressed by column 6. Order is load-bearing. */
export const HIGHER_ED_COLLISION_RISKS = [{risks_literal}] as const;

/** Index-addressed by column 3: [source, sourceFamily]. */
export const HIGHER_ED_SOURCES: readonly (readonly [string, string])[] = [
{sources_literal}
];

/** Index-addressed by column 4. CEDS supplies a term-specific URL per row,
 *  which is why this table is large relative to the source table. */
export const HIGHER_ED_URLS: readonly string[] = [
{urls_literal}
];

/** Index-addressed by column 7. Provenance prose from the source dataset --
 *  for derived variants it records the parent form and the derivation rule. */
export const HIGHER_ED_NOTES: readonly string[] = [
{notes_literal}
];

'''

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as out:
        out.write(header)
        # Group whole LINES per literal piece, so no piece ends mid-escape.
        per_piece = 200
        groups = [lines[i:i + per_piece] for i in range(0, len(lines), per_piece)]
        parts = ["\n".join(g) + ("\n" if n < len(groups) - 1 else "") for n, g in enumerate(groups)]
        out.write("/** One line per attestation row, TAB-separated:\n"
                  " *  normalized, term, hintIdx, sourceIdx, urlIdx, derived(0|1), riskIdx, notesIdx */\n")
        out.write(chunked_literal(parts, "HIGHER_ED_ROWS"))

    size = OUT.stat().st_size
    print(f"wrote {OUT} ({size / 1048576:.2f} MiB)")
    print(f"  rows={len(rows)} terms={distinct_keys} multi-provenance={multi} derived={derived_count}")
    print(f"  interned: sources={len(sources)} urls={len(urls)} notes={len(notes)}")
    print(f"  normalization parity: {len(rows)}/{len(rows)} rows reproduce normalized_term")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
