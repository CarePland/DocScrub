#!/usr/bin/env python3
"""
generate_gnis_place_evidence.py -- generates the bundled Standard geography
asset (AG, 2026-08-10).

SOURCE
    USGS Geographic Names Information System, DomesticNames_National text
    product (`Text/DomesticNames_National.txt` inside the distributed ZIP).
    Public domain U.S. Government data. 981,698 feature records, 43 feature
    classes, pipe-delimited, UTF-8 with BOM.

OUTPUT
    src/engines/knowledge/gnis-places.data.ts

USAGE
    python3 scripts/generate_gnis_place_evidence.py <DomesticNames_National_Text.zip>

WHAT QUALIFIES FOR THE STANDARD PACK, and why each clause exists
    feature class in {Populated Place, Civil, Census}
        Measured: these three carry every live hit; Military (3,188 rows) and
        Area (2,247) added none. Natural-feature classes belong to Regional
        and Full packs, not to the bundled one.
    NOT '(historical)'-suffixed
        26,275 national rows carry the literal suffix. They cannot exact-match
        ordinary candidate text, and including them inflated the earlier
        124,607 figure to no purpose.
    MULTI-TOKEN after normalization
        THE LOAD-BEARING CLAUSE. Every one of the 7 single-token GNIS hits on
        the live document was a real person -- there are US towns named
        Andrew, Sarah, Diana, Joan, Patrick, Margaret and Christopher. At
        dataset scale, 15,578 of the 15,711 single-token GNIS/Census
        collisions are Populated Place. Single-token names are therefore
        absent from this pack entirely rather than shipped as weak evidence:
        they have no consumer here, and their presence would be an invitation.

WHAT IS CARRIED
    normalized key, and a 3-bit feature-class mask
        (1 Populated Place, 2 Civil, 4 Census)

WHAT IS DELIBERATELY DROPPED
    coordinates, map_name, feature_id, dates, bgn_* authority fields,
    county_name, state_name, per-name feature counts.

    STATE AND CLASS MULTIPLICITY ARE DROPPED ON PURPOSE, and this is the one
    that will look like an omission. The refinement measured both as
    CORRELATING WITH person-name collision, not against it:

        1 state   31.2% collision     2-4 states  43.1%     5+ states  50.9%
        1 class   32.9% collision     2+ classes  55.8%

    Person-named features recur everywhere, so breadth predicts
    person-derivation. Shipping those figures would ship two heuristics the
    investigation specifically falsified.

POLICY B IS NOT BAKED IN HERE
    The Census Top-1000 suppression is evaluated at RUNTIME against the
    already-shipped Census asset (see engines/knowledge/GnisPlaceEvidence.ts).
    Baking it in would duplicate Census data into a second asset and freeze a
    decision that belongs to the evidence layer.

DO NOT HAND-EDIT THE GENERATED FILE.
"""

import collections
import csv
import io
import re
import sys
import unicodedata
import zipfile
from pathlib import Path

STANDARD_CLASSES = {"Populated Place": 1, "Civil": 2, "Census": 4}
FLAG_ALPHABET = "0123456789abcdef"
CHUNK = 60000
KEYS_PER_PIECE = 2000
OUT = Path(__file__).resolve().parent.parent / "src" / "engines" / "knowledge" / "gnis-places.data.ts"
VERSION = "usgs-gnis/domestic-names-national"
MEMBER = "Text/DomesticNames_National.txt"


def normalize(value: str) -> str:
    """THE APPROVED CONTRACT: NFD -> strip marks -> punctuation to SPACE ->
    collapse whitespace -> uppercase.

    Punctuation becomes a SPACE rather than nothing, which is where this
    differs from the Census normalizer and why. GNIS names are multi-word, so
    stripping would fuse tokens and manufacture matches the source never
    contained -- `Angeles, CA` would become `ANGELESCA`. Measured, not assumed.
    """
    value = unicodedata.normalize("NFD", value)
    value = "".join(ch for ch in value if not unicodedata.combining(ch))
    value = re.sub(r"[^\w\s]", " ", value)
    return re.sub(r"\s+", " ", value).strip().upper()


def chunked_literal(parts, name):
    body = " +\n  ".join(f'"{p}"' for p in (parts or [""]))
    return f"export const {name} =\n  {body};\n"


def main(zip_path: str) -> None:
    by_key = collections.defaultdict(int)
    rows = considered = historical = single = 0

    with zipfile.ZipFile(zip_path) as z:
        if MEMBER not in z.namelist():
            raise SystemExit(f"{zip_path} does not contain {MEMBER}")
        with z.open(MEMBER) as fh:
            reader = csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig", newline=""), delimiter="|")
            required = {"feature_name", "feature_class"}
            missing = required - set(reader.fieldnames or [])
            if missing:
                raise SystemExit(f"source is missing required columns: {sorted(missing)}")
            for row in reader:
                rows += 1
                cls = row["feature_class"] or ""
                bit = STANDARD_CLASSES.get(cls)
                if bit is None:
                    continue
                considered += 1
                name = row["feature_name"] or ""
                if "(historical)" in name.lower():
                    historical += 1
                    continue
                key = normalize(name)
                if not key:
                    continue
                if " " not in key:
                    single += 1
                    continue
                by_key[key] |= bit

    keys = sorted(by_key)
    flags = "".join(FLAG_ALPHABET[by_key[k]] for k in keys)

    header = f'''/**
 * gnis-places.data.ts -- GENERATED. DO NOT HAND-EDIT.
 *
 * Regenerate with:
 *     python3 scripts/generate_gnis_place_evidence.py <DomesticNames_National_Text.zip>
 *
 * SOURCE: USGS Geographic Names Information System, DomesticNames_National
 * text product. Public domain U.S. Government data. {rows:,} national feature
 * records; {considered:,} in the Standard feature classes.
 *
 * STANDARD PACK: exact normalized, MULTI-TOKEN names in
 * {{Populated Place, Civil, Census}}, excluding '(historical)'.
 *   {historical:,} historical rows excluded
 *   {single:,} single-token rows excluded -- every single-token GNIS hit on the
 *   live document was a real person, and 15,578 of the 15,711 single-token
 *   GNIS/Census collisions are Populated Place
 *   -> {len(keys):,} distinct keys
 *
 * FLAGS: one character per key from "{FLAG_ALPHABET}" -- 1 Populated Place,
 * 2 Civil, 4 Census. State and class MULTIPLICITY are deliberately absent:
 * both were measured as correlating WITH person-name collision, not against
 * it, so shipping them would ship two falsified heuristics.
 *
 * Policy B (Census Top-1000 suppression) is NOT baked in -- it is evaluated at
 * runtime against the shipped Census asset. See GnisPlaceEvidence.ts.
 */

export const GNIS_PLACE_SOURCE = "{VERSION}";
export const GNIS_PLACE_ENTRY_COUNT = {len(keys)};
export const GNIS_CLASS_FLAG_ALPHABET = "{FLAG_ALPHABET}";
export const GNIS_CLASS_POPULATED_PLACE = 1;
export const GNIS_CLASS_CIVIL = 2;
export const GNIS_CLASS_CENSUS = 4;

'''
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as out:
        out.write(header)
        groups = [keys[i:i + KEYS_PER_PIECE] for i in range(0, len(keys), KEYS_PER_PIECE)]
        # Chunk by KEY, never by character: a character split lands inside a
        # \n escape and emits an unterminated literal.
        key_parts = ["\\n".join(g) + ("\\n" if n < len(groups) - 1 else "") for n, g in enumerate(groups)]
        out.write(chunked_literal(key_parts, "GNIS_PLACE_KEYS"))
        out.write("\n")
        out.write(chunked_literal([flags[i:i + CHUNK] for i in range(0, len(flags), CHUNK)], "GNIS_PLACE_CLASS_FLAGS"))

    print(f"wrote {OUT} ({OUT.stat().st_size / 1048576:.2f} MiB)")
    print(f"  national rows {rows:,}  standard-class rows {considered:,}")
    print(f"  excluded: historical {historical:,}  single-token {single:,}")
    print(f"  distinct multi-token Standard keys: {len(keys):,}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    main(sys.argv[1])
