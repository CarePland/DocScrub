#!/usr/bin/env python3
"""
gnis_benchmark.py -- INVESTIGATION ONLY (AG, 2026-08-10).

Benchmarks USGS GNIS DomesticNames_National as a PLACE-evidence source for
DocScrub. No production integration; nothing here is imported by src/.

Python rather than TypeScript because the source is a 147 MB pipe-delimited
text file and the Census CSV is 10 MB -- both stream cleanly here, and the
question is measurement rather than production shape.
"""

import collections
import csv
import io
import re
import sys
import unicodedata
import zipfile
from pathlib import Path

GNIS_ZIP = sys.argv[1] if len(sys.argv) > 1 else "/sessions/quirky-clever-davinci/mnt/uploads/DomesticNames_National_Text.zip"
CENSUS_CSV = sys.argv[2] if len(sys.argv) > 2 else "/sessions/quirky-clever-davinci/mnt/DocScrub/app/investigation/data/Census2020_DocScrub_NameEvidence.csv"

STANDARD_CLASSES = {"Populated Place", "Civil", "Census"}
SOCAL_COUNTIES = {"Los Angeles", "Orange", "San Diego", "Riverside",
                  "San Bernardino", "Ventura", "Santa Barbara", "Imperial"}

# ---------------------------------------------------------------- normalization
#
# THE CONTRACT UNDER TEST, deliberately the same shape as the Census one:
# NFD -> strip combining marks -> punctuation to space -> collapse -> upper.
#
# It differs from the Census normalizer in ONE way, and the difference is
# forced by the data: Census keys are single tokens with no internal spaces, so
# that normalizer strips non-letters entirely. GNIS names are multi-word
# ("Santa Fe", "O'Brien Lake"), so collapsing punctuation to a SPACE rather
# than to nothing is what keeps "Angeles, CA" from becoming "ANGELESCA".
# Measured in §4 rather than assumed.

def norm_space(s: str) -> str:
    s = unicodedata.normalize("NFD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = re.sub(r"[^\w\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip().upper()


def norm_strip(s: str) -> str:
    """The Census-style variant, for the punctuation comparison in §4."""
    s = unicodedata.normalize("NFD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return re.sub(r"[^\w]", "", s).upper()


# ---------------------------------------------------------------- load GNIS
print("=== 1. GNIS SOURCE ===\n")
feat_classes = collections.Counter()
by_name = collections.defaultdict(lambda: {"classes": set(), "states": set(), "counties": set(), "n": 0})
std_names, ca_names, socal_names = set(), set(), set()
historical = 0
nonascii = 0
rows = 0

with zipfile.ZipFile(GNIS_ZIP) as z:
    with z.open("Text/DomesticNames_National.txt") as fh:
        reader = csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig", newline=""), delimiter="|")
        fields = reader.fieldnames
        for row in reader:
            rows += 1
            name = row["feature_name"] or ""
            cls = row["feature_class"] or ""
            state = row["state_name"] or ""
            county = row["county_name"] or ""
            if "(historical)" in name.lower():
                historical += 1
            if any(ord(c) > 127 for c in name):
                nonascii += 1
            feat_classes[cls] += 1
            key = norm_space(name)
            e = by_name[key]
            e["classes"].add(cls)
            e["states"].add(state)
            e["counties"].add(county)
            e["n"] += 1
            if cls in STANDARD_CLASSES:
                std_names.add(key)
            if state == "California":
                ca_names.add(key)
                if county in SOCAL_COUNTIES:
                    socal_names.add(key)

print(f"  fields ({len(fields)}): {', '.join(fields)}")
print(f"  rows                         {rows:,}")
print(f"  feature classes              {len(feat_classes)}")
print(f"  distinct normalized names    {len(by_name):,}")
print(f"  '(historical)' suffixed      {historical:,}")
print(f"  non-ASCII feature names      {nonascii:,}")
print(f"\n  STANDARD (PopPlace+Civil+Census)  distinct {len(std_names):,}")
print(f"  CALIFORNIA (all classes)          distinct {len(ca_names):,}")
print(f"  SOCAL 8 counties (all classes)    distinct {len(socal_names):,}")

# ---------------------------------------------------------------- load Census
census = {}
with open(CENSUS_CSV, newline="", encoding="utf-8") as fh:
    for row in csv.DictReader(fh):
        k = row["normalized_name"]
        if k == "ALL OTHER NAMES":
            continue
        census[k] = (row["first_attested"] == "True", row["last_attested"] == "True")


def census_tokens(value: str):
    toks = [norm_strip(t) for t in re.split(r"[\s,]+", value) if t.strip()]
    return [(t, census.get(t)) for t in toks if t]


def census_structure(value: str) -> str:
    toks = census_tokens(value)
    if len(toks) < 2:
        return "none"
    a, b = toks[0][1], toks[-1][1]
    fl = bool(a and a[0]) and bool(b and b[1])
    lf = bool(a and a[1]) and bool(b and b[0])
    if fl and lf:
        return "ambiguous-role"
    if fl:
        return "first-surname"
    if lf:
        return "surname-first"
    return "none"


def gnis(value: str):
    key = norm_space(value)
    e = by_name.get(key)
    if not e:
        return None
    return {
        "key": key, "n": e["n"],
        "classes": sorted(e["classes"]),
        "states": sorted(s for s in e["states"] if s),
        "counties": sorted(c for c in e["counties"] if c),
        "std": key in std_names, "ca": key in ca_names, "socal": key in socal_names,
    }


# ---------------------------------------------------------------- §4 punctuation
print("\n\n=== 4. NORMALIZATION: punctuation measured, not guessed ===\n")
print(f"  {'input':22s} {'punct->space':26s} {'punct->stripped':26s} hit(space) hit(strip)")
strip_index = {norm_strip(k): k for k in by_name}
for probe in ["Angeles, CA", "O'Brien", "St. Helena", "Coeur d'Alene", "Winston-Salem",
              "San Diego", "Cañada Agua", "Grade Rosters"]:
    a, b = norm_space(probe), norm_strip(probe)
    print(f"  {probe:22s} {a:26s} {b:26s} {str(a in by_name):10s} {str(b in strip_index)}")
print("\n  FINDING: punctuation must collapse to a SPACE, not to nothing. GNIS names are")
print("  multi-word, so stripping would fuse tokens and create matches the source never")
print("  contained. Accent folding is required (Cañada -> CANADA is a real GNIS name).")

# ---------------------------------------------------------------- §5 witnesses
WITNESSES = [
    "San Diego", "San Marcos", "Sonoma", "East Bay", "Los Angeles", "Angeles, CA",
    "Yazmine Guzmán", "Amy Miller", "Jeffrey Lam", "Good Morning", "Reason Code",
    "Last Day", "Financial Aid", "Academic Senate", "Grade Rosters", "Term Withdrawals",
]
print("\n\n=== 5. WITNESS TRACE ===\n")
hdr = f"  {'candidate':20s} {'normalized':20s} {'hit':4s} {'n':>5s} {'std':4s} {'ca':4s} {'so':4s} {'classes':34s} {'census':16s} states"
print(hdr)
print("  " + "-" * 150)
for w in WITNESSES:
    g = gnis(w)
    cs = census_structure(w)
    if g:
        print(f"  {w:20s} {g['key']:20s} {'YES':4s} {g['n']:5d} {str(g['std']):4s} {str(g['ca']):4s} "
              f"{str(g['socal']):4s} {','.join(g['classes'])[:33]:34s} {cs:16s} {','.join(g['states'])[:40]}")
    else:
        print(f"  {w:20s} {norm_space(w):20s} {'no':4s} {'-':>5s} {'-':4s} {'-':4s} {'-':4s} {'-':34s} {cs:16s} -")

# ---------------------------------------------------------------- §7 collisions
print("\n\n=== 7. GNIS x CENSUS COLLISION, over the whole GNIS name space ===\n")
single = multi = 0
single_person = multi_person = 0
cls_collide = collections.Counter()
for key, e in by_name.items():
    toks = key.split(" ")
    if len(toks) == 1:
        single += 1
        c = census.get(norm_strip(key))
        if c and (c[0] or c[1]):
            single_person += 1
            for cl in e["classes"]:
                cls_collide[cl] += 1
    else:
        multi += 1
        a = census.get(norm_strip(toks[0]))
        b = census.get(norm_strip(toks[-1]))
        if a and b and ((a[0] and b[1]) or (a[1] and b[0])):
            multi_person += 1
print(f"  single-token GNIS names        {single:,}   of which Census-attested: {single_person:,} ({100*single_person/single:.0f}%)")
print(f"  multi-token GNIS names         {multi:,}   of which a full Census name STRUCTURE: {multi_person:,} ({100*multi_person/multi:.0f}%)")
print("\n  single-token collisions by feature class (top 15):")
for c, n in cls_collide.most_common(15):
    print(f"    {c:22s} {n:6,}")


# ---------------------------------------------------------------- live population
RESIDUE = []
src = Path(__file__).parent / "live-residue.data.ts"
for m in re.finditer(r'\{ value: "((?:[^"\\]|\\.)*)", standalone: (\d+), contextual: (\d+), truth: "([^"]+)"', src.read_text(encoding="utf-8")):
    RESIDUE.append((m.group(1).replace('\\"', '"'), m.group(4)))
print(f"\n\n=== 5b. FULL LIVE C1 RESIDUE ({len(RESIDUE)} units) ===\n")

hits = [(v, t, gnis(v)) for v, t in RESIDUE]
got = [(v, t, g) for v, t, g in hits if g]
print(f"  GNIS exact hits: {len(got)} / {len(RESIDUE)}")
print(f"  {'candidate':26s} {'truth':11s} {'n':>4s} {'std':5s} {'ca':5s} {'so':5s} {'classes':30s} census")
print("  " + "-" * 120)
for v, t, g in sorted(got, key=lambda x: -x[2]["n"]):
    print(f"  {v:26s} {t:11s} {g['n']:4d} {str(g['std']):5s} {str(g['ca']):5s} {str(g['socal']):5s} "
          f"{','.join(g['classes'])[:29]:30s} {census_structure(v)}")
print(f"\n  by truth:  person {sum(1 for v,t,g in got if t=='person')}/{sum(1 for v,t in RESIDUE if t=='person')}"
      f"   non-person {sum(1 for v,t,g in got if t=='non-person')}/{sum(1 for v,t in RESIDUE if t=='non-person')}"
      f"   unlabelled {sum(1 for v,t,g in got if t=='?')}")

# ---------------------------------------------------------------- §8 class utility
print("\n\n=== 8. FEATURE-CLASS UTILITY on the live population ===\n")
STD_ONLY = [(v, t, g) for v, t, g in got if g["std"]]
NAT_ONLY = [(v, t, g) for v, t, g in got if not g["std"]]
print(f"  hits including a STANDARD class (PopPlace/Civil/Census): {len(STD_ONLY)}")
print(f"      {', '.join(v for v, t, g in STD_ONLY)}")
print(f"  hits from natural-feature classes ONLY:                  {len(NAT_ONLY)}")
print(f"      {', '.join(v for v, t, g in NAT_ONLY) or '(none)'}")
print("\n  Would adding Military / Area to STANDARD change the live result?")
for extra in ["Military", "Area", "Locale", "Park"]:
    n = sum(1 for v, t, g in got if extra in g["classes"] and not g["std"])
    total = feat_classes.get(extra, 0)
    print(f"    {extra:10s} national rows {total:7,}   live candidates it would ADD: {n}")

# ---------------------------------------------------------------- §9 region
print("\n\n=== 9. REGIONAL CORROBORATION ===\n")
print(f"  {'candidate':22s} {'natl feats':>10s} {'states':>7s} {'CA':>5s} {'SoCal':>6s}  reading")
for v, t, g in sorted(got, key=lambda x: -x[2]["n"]):
    reading = ("locally corroborated" if g["socal"] else "state-corroborated" if g["ca"] else "national only")
    print(f"  {v:22s} {g['n']:10d} {len(g['states']):7d} {str(g['ca']):>5s} {str(g['socal']):>6s}  {reading}")

# ---------------------------------------------------------------- §10-12 packs
print("\n\n=== 10-12. PACK SIZING ===\n")
def pack(names, label, classes_for=None):
    keys = sorted(names)
    blob = "\n".join(keys)
    import gzip
    gz = len(gzip.compress(blob.encode("utf-8")))
    print(f"  {label:34s} names {len(keys):7,}   keys {len(blob)/1048576:6.2f} MiB   gzip {gz/1048576:5.2f} MiB")
    return keys

pack(std_names, "STANDARD (PopPlace+Civil+Census)")
pack(ca_names, "REGIONAL California (all classes)")
pack(socal_names, "REGIONAL SoCal 8 counties")
pack(set(by_name), "FULL national (all classes)")
print("\n  + 1 flags byte per name for the feature-class bitset (43 classes -> 6 bytes, or")
print("    1 byte for a 'is it a STANDARD class' + coarse-group encoding).")
print(f"  For comparison, the shipped Census asset: 195,310 names, 1.83 MiB source, 0.53 MiB gzip.")

# ---------------------------------------------------------------- §13 interaction
print("\n\n=== 13. INTERACTION WITH THE CURRENT INTERPRETER ===\n")
gain_place = [(v, t, g) for v, t, g in got if g["std"]]
conflict = [(v, t, g) for v, t, g in gain_place if census_structure(v) != "none"]
clean = [(v, t, g) for v, t, g in gain_place if census_structure(v) == "none"]
print(f"  live residue units                                  {len(RESIDUE)}")
print(f"  gain ANY GNIS evidence                              {len(got)}")
print(f"  gain STANDARD-class (defensible PLACE) evidence     {len(gain_place)}")
print(f"    of those, ALSO a Census person structure          {len(conflict)}  <- person/place CONFLICT")
print(f"    of those, no Census person structure              {len(clean)}  <- unambiguous PLACE")
print(f"\n  unambiguous PLACE: {', '.join(v for v,t,g in clean) or '(none)'}")
print(f"  CONFLICT:          {', '.join(v for v,t,g in conflict) or '(none)'}")
print(f"\n  known real people gaining GNIS evidence: {[v for v,t,g in got if t=='person'] or 'NONE'}")


# ---------------------------------------------------------------- §7b the real finding
print("\n\n=== 7b. THE SINGLE-TOKEN TRAP ===\n")
single_hits = [(v, t, g) for v, t, g in got if " " not in norm_space(v)]
multi_hits = [(v, t, g) for v, t, g in got if " " in norm_space(v)]
def prec(rows):
    p = sum(1 for v, t, g in rows if t == "person")
    n = sum(1 for v, t, g in rows if t == "non-person")
    return f"{len(rows):2d} hits -> {p} known PEOPLE, {n} known non-people"
print(f"  single-token GNIS hits on the live population:  {prec(single_hits)}")
print(f"      {', '.join(v for v,t,g in single_hits)}")
print(f"  multi-token  GNIS hits on the live population:  {prec(multi_hits)}")
print(f"      {', '.join(v for v,t,g in multi_hits)}")
print("\n  Every single-token hit is a bare first name that is ALSO a US town.")
print("  15,578 of the 15,711 single-token GNIS/Census collisions are Populated Place.")

print("\n  Andrew's named ambiguous strings:")
print(f"    {'name':12s} {'GNIS feats':>10s} {'classes':22s} {'census first':>13s} {'census surname':>15s}")
for w in ["Virginia", "Georgia", "Austin", "Madison", "Jordan", "Hope", "Sonoma", "Dakota", "Carolina"]:
    g = gnis(w); c = census.get(norm_strip(w))
    print(f"    {w:12s} {(g['n'] if g else 0):10d} {(','.join(g['classes'])[:21] if g else '-'):22s} "
          f"{str(bool(c and c[0])):>13s} {str(bool(c and c[1])):>15s}")

print("\n\n=== 8b. MULTI-TOKEN RESTRICTION, measured at dataset scale ===\n")
std_single = sum(1 for k in std_names if " " not in k)
std_multi = len(std_names) - std_single
std_single_person = sum(1 for k in std_names if " " not in k and (lambda c: c and (c[0] or c[1]))(census.get(norm_strip(k))))
std_multi_person = 0
for k in std_names:
    if " " not in k:
        continue
    tk = k.split(" ")
    a, b = census.get(norm_strip(tk[0])), census.get(norm_strip(tk[-1]))
    if a and b and ((a[0] and b[1]) or (a[1] and b[0])):
        std_multi_person += 1
print(f"  STANDARD pack, single-token names {std_single:7,}   Census-attested {std_single_person:7,} ({100*std_single_person/max(1,std_single):.0f}%)")
print(f"  STANDARD pack, multi-token names  {std_multi:7,}   full Census name structure {std_multi_person:7,} ({100*std_multi_person/max(1,std_multi):.0f}%)")
print(f"\n  Dropping single-token entries from the STANDARD pack costs {std_single:,} names ({100*std_single/len(std_names):.0f}%)")
print(f"  and removes {std_single_person:,} person-name collisions.")
import gzip
mt = sorted(k for k in std_names if " " in k)
blob = "\n".join(mt)
print(f"  multi-token STANDARD pack: {len(mt):,} names, {len(blob)/1048576:.2f} MiB keys, {len(gzip.compress(blob.encode()))/1048576:.2f} MiB gzip")

print("\n\n=== 13b. PROJECTED EFFECT ON UNDETERMINED ===\n")
place_ev = [(v, t, g) for v, t, g in multi_hits if g["std"]]
print(f"  current residue                                  {len(RESIDUE)}")
print(f"  units gaining defensible PLACE evidence          {len(place_ev)}  ({', '.join(v for v,t,g in place_ev)})")
print(f"  of those, known non-people (true positives)      {sum(1 for v,t,g in place_ev if t=='non-person')}")
print(f"  of those, known people (false positives)         {sum(1 for v,t,g in place_ev if t=='person')}")
print(f"  person/place CONFLICTS needing an unresolved state {sum(1 for v,t,g in place_ev if census_structure(v)!='none')}")
