#!/usr/bin/env python3
"""
generate_census_name_evidence.py -- generates the production Census name
evidence asset (AG, 2026-08-10).

SOURCE
    U.S. Census 2020 name data, via the derived aggregate
    `Census2020_DocScrub_NameEvidence.csv` (one row per normalized
    Census-attested name token, aggregated from the nine Census 2020 name
    files). The aggregate deliberately omits race/Hispanic-origin and sex
    breakdowns; this generator never reads them.

OUTPUT
    src/engines/knowledge/census-names.data.ts

USAGE
    python3 scripts/generate_census_name_evidence.py <path-to-csv>

WHAT IS CARRIED, AND WHAT IS DELIBERATELY DROPPED
    carried   normalized key, first-name attestation, surname attestation,
              first/surname Top-1000 membership (4 bits per entry)
    dropped   first_count, last_count, first_rank, last_rank,
              first_count_sex_file, first_count_race_file

    COUNTS ARE DROPPED ON PURPOSE, and the reason is measured rather than
    stylistic. The two first-name source files disagree on 49,090 of 53,616
    first names (92%), so `first_count` is a reconciled aggregate rather than
    a corroborated figure. Nothing in production is permitted to depend on a
    prevalence threshold (see 20260810-census-name-evidence-experiment.md
    §11), so shipping magnitudes would ship a temptation with no consumer.

    RANKS ARE ALSO DROPPED, with a narrower reason: they are ordinal and
    therefore sound, but they cost ~1.5 MiB of runtime typed arrays for a
    consumer that does not yet exist. Top-1000 membership is the same ordinal
    information at 2 bits, and it is retained so a second-corpus prevalence
    study can be run without regenerating. Full ranks are one regeneration
    away if that study needs them.

    DEMOGRAPHICS ARE NEVER READ. The two source-count columns are not opened
    even to compare them; that comparison lives in the experiment harness.

EXCLUSIONS
    `ALL OTHER NAMES` is the Census residual bucket -- a data artifact, not a
    name, and the only row in the aggregate containing a space. Excluded here
    and pinned by verify/census-name-evidence-verification.ts.

REPRESENTATION
    Two strings, chunked for editor sanity:
      CENSUS_NAME_KEYS   newline-delimited normalized keys, in source order
      CENSUS_NAME_FLAGS  one character per key, from a 16-character alphabet
                         encoding 4 bits: 1 first, 2 surname,
                         4 first-Top1000, 8 surname-Top1000

    Chosen over a JSON object or a Map literal because it is the
    representation measured at ~4.4 MiB of heap in the experiment, against
    ~67.9 MiB for the naive object-per-entry Map. See the experiment's §12.

DO NOT HAND-EDIT THE GENERATED FILE.
"""

import csv
import sys
from pathlib import Path

FLAG_ALPHABET = "0123456789abcdef"
ARTIFACT_ROWS = {"ALL OTHER NAMES"}
CHUNK = 60000
OUT = Path(__file__).resolve().parent.parent / "src" / "engines" / "knowledge" / "census-names.data.ts"
VERSION = "us-census-2020/docscrub-aggregate"


def chunked_literal(parts: list[str], name: str) -> str:
    """Emits `export const <name> = "..." + "..." ;` from pre-split pieces.

    One multi-megabyte line is legal TypeScript but hostile to every editor
    and diff tool that will ever open this file. The concatenation is folded
    by the compiler, so there is no runtime cost.

    CALLERS SPLIT, NOT THIS FUNCTION. A naive character-count split lands
    inside a `\n` escape sequence and emits an unterminated string literal --
    which is exactly what the first version of this generator did. Keys are
    therefore chunked by KEY, and flags (which contain no escapes) by
    character.
    """
    body = " +\n  ".join(f'"{p}"' for p in (parts or [""]))
    return f"export const {name} =\n  {body};\n"


def main(csv_path: str) -> None:
    keys: list[str] = []
    flags: list[str] = []
    excluded = 0
    first = last = both = 0

    with open(csv_path, newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        required = {"normalized_name", "first_attested", "last_attested", "first_top1000", "last_top1000"}
        missing = required - set(reader.fieldnames or [])
        if missing:
            raise SystemExit(f"source CSV is missing required columns: {sorted(missing)}")
        for row in reader:
            key = row["normalized_name"]
            if key in ARTIFACT_ROWS:
                excluded += 1
                continue
            if not key or " " in key:
                # Defensive: the artifact row is the only space-bearing key in
                # the 2026-08-10 aggregate. A future one would be a new
                # artifact, not a name, and silently indexing it would be
                # worse than failing the generation.
                raise SystemExit(f"unexpected key containing a space: {key!r}")
            fa = row["first_attested"] == "True"
            la = row["last_attested"] == "True"
            bits = (1 if fa else 0) | (2 if la else 0)
            bits |= 4 if row["first_top1000"] == "True" else 0
            bits |= 8 if row["last_top1000"] == "True" else 0
            keys.append(key)
            flags.append(FLAG_ALPHABET[bits])
            first += fa
            last += la
            both += fa and la

    header = f'''/**
 * census-names.data.ts -- GENERATED. DO NOT HAND-EDIT.
 *
 * Regenerate with:
 *     python3 scripts/generate_census_name_evidence.py <Census2020_DocScrub_NameEvidence.csv>
 *
 * SOURCE: U.S. Census 2020 name data, via the derived aggregate
 * `Census2020_DocScrub_NameEvidence.csv`. That aggregate carries one row per
 * normalized Census-attested name token and deliberately omits
 * race/Hispanic-origin and sex breakdowns. The generator reads only
 * attestation and Top-1000 membership; no demographic column is opened.
 *
 * CONTENT: {len(keys)} entries -- {first} attested as first names,
 * {last} as surnames, {both} as both. The Census residual bucket
 * "ALL OTHER NAMES" is excluded as a data artifact ({excluded} row).
 *
 * NOT CARRIED: counts and ranks. The two first-name source files disagree on
 * 92% of rows, so counts are not corroborated evidence; ranks are sound but
 * have no consumer, since no production decision may depend on a prevalence
 * threshold. Top-1000 membership is retained as the cheap ordinal signal a
 * future second-corpus study would need.
 *
 * REPRESENTATION: keys newline-delimited, flags one character per key from
 * "{FLAG_ALPHABET}" encoding 1=first, 2=surname, 4=first-Top1000,
 * 8=surname-Top1000. Measured at ~4.4 MiB of runtime heap against ~67.9 MiB
 * for an object-per-entry Map.
 */

export const CENSUS_NAME_SOURCE = "{VERSION}";
export const CENSUS_NAME_ENTRY_COUNT = {len(keys)};
export const CENSUS_FLAG_ALPHABET = "{FLAG_ALPHABET}";

'''
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as out:
        out.write(header)
        # Keys: group by KEY so no piece ever ends mid-escape. Every piece
        # except the last carries its own trailing separator, so plain
        # concatenation reproduces the newline-delimited string exactly.
        per_piece = 2000
        groups = [keys[i:i + per_piece] for i in range(0, len(keys), per_piece)]
        key_parts = ["\\n".join(g) + ("\\n" if n < len(groups) - 1 else "") for n, g in enumerate(groups)]
        out.write(chunked_literal(key_parts, "CENSUS_NAME_KEYS"))
        out.write("\n")
        flag_str = "".join(flags)
        out.write(chunked_literal([flag_str[i:i + CHUNK] for i in range(0, len(flag_str), CHUNK)], "CENSUS_NAME_FLAGS"))

    size = OUT.stat().st_size
    print(f"wrote {OUT} ({size / 1048576:.2f} MiB)")
    print(f"  entries={len(keys)} first={first} last={last} both={both} excluded={excluded}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
