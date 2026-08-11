#!/usr/bin/env python3
"""
gnis_census_prevalence.py -- INVESTIGATION ONLY (AG, 2026-08-10).

Refinement of the completed GNIS benchmark. ONE question:

    Of the ~124,607 qualifying multi-token Standard GNIS names, can Census
    human-name PREVALENCE provide a general hard cutoff that strips strong
    affirmative PLACE authority from the person-like ones?

Derived GLOBALLY over the national datasets. The DocScrub witnesses are
applied only at the end, after the policy is chosen, and are never used to
tune it.

RANKS COME FROM THE SOURCE AGGREGATE, not the production asset. The shipped
asset deliberately carries only Top-1000 bits (counts were dropped for the 92%
source divergence; ranks for having no consumer). §3 of the instruction
anticipates this: use the authoritative artifact rather than fabricate bands.
Ranks are ORDINAL and are unaffected by the count divergence.
"""

import collections
import csv
import io
import re
import sys
import unicodedata
import zipfile
from pathlib import Path

GNIS_ZIP = "/sessions/quirky-clever-davinci/mnt/uploads/DomesticNames_National_Text.zip"
CENSUS_CSV = "/sessions/quirky-clever-davinci/mnt/DocScrub/app/investigation/data/Census2020_DocScrub_NameEvidence.csv"
STANDARD_CLASSES = {"Populated Place", "Civil", "Census"}


def norm_space(s: str) -> str:
    s = unicodedata.normalize("NFD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = re.sub(r"[^\w\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip().upper()


def norm_tok(s: str) -> str:
    s = unicodedata.normalize("NFD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    return re.sub(r"[^\w]", "", s).upper()


# ------------------------------------------------------------------ Census
# first_rank / last_rank are ordinal within their own role list. None = not
# attested in that role.
census = {}
with open(CENSUS_CSV, newline="", encoding="utf-8") as fh:
    for row in csv.DictReader(fh):
        k = row["normalized_name"]
        if k == "ALL OTHER NAMES":
            continue
        fr = int(row["first_rank"]) if row["first_rank"] else None
        lr = int(row["last_rank"]) if row["last_rank"] else None
        census[k] = (fr, lr)

# ------------------------------------------------------------------ GNIS
std = collections.defaultdict(lambda: {"classes": set(), "states": set(), "n": 0})
with zipfile.ZipFile(GNIS_ZIP) as z:
    with z.open("Text/DomesticNames_National.txt") as fh:
        for row in csv.DictReader(io.TextIOWrapper(fh, encoding="utf-8-sig", newline=""), delimiter="|"):
            cls = row["feature_class"] or ""
            if cls not in STANDARD_CLASSES:
                continue
            name = row["feature_name"] or ""
            if "(historical)" in name.lower():
                continue
            key = norm_space(name)
            if " " not in key:
                continue
            e = std[key]
            e["classes"].add(cls)
            e["states"].add(row["state_name"] or "")
            e["n"] += 1

print("=== 1-2. POPULATION ===\n")
print(f"  multi-token Standard GNIS names (historical excluded): {len(std):,}")


def person_reading(key: str):
    """Role-aware. Returns (best_rank_pair, reading) or None.

    A phrase qualifies only as FIRST+SURNAME or SURNAME+FIRST -- mere token
    membership is not a structure, per the Census contract. Where both
    readings exist, the STRONGER one is taken: a suppression policy must be
    driven by the most person-like available reading, not an average.

    "Strength" of a reading is its WEAKER role -- the max of the two ranks,
    since a low rank means high prevalence. A phrase is only as person-like
    as its least-common required role.
    """
    toks = key.split(" ")
    a, b = census.get(norm_tok(toks[0])), census.get(norm_tok(toks[-1]))
    if not a or not b:
        return None
    readings = []
    if a[0] is not None and b[1] is not None:
        readings.append((max(a[0], b[1]), (a[0], b[1]), "first+surname"))
    if a[1] is not None and b[0] is not None:
        readings.append((max(a[1], b[0]), (a[1], b[0]), "surname+first"))
    if not readings:
        return None
    readings.sort()
    weakest, pair, label = readings[0]
    return {"weakest_rank": weakest, "ranks": pair, "reading": label,
            "both_top1000": pair[0] <= 1000 and pair[1] <= 1000,
            "either_top1000": pair[0] <= 1000 or pair[1] <= 1000}


structured = {}
for key in std:
    pr = person_reading(key)
    if pr:
        structured[key] = pr

print(f"  of those, forming a Census full-name STRUCTURE:        {len(structured):,} "
      f"({100*len(structured)/len(std):.1f}%)")

# ------------------------------------------------------------------ §3 bands
print("\n\n=== 3. PREVALENCE DISTRIBUTION (global, rank-based) ===\n")
A = len(std) - len(structured)
B = sum(1 for v in structured.values() if not v["either_top1000"])
C = sum(1 for v in structured.values() if v["either_top1000"] and not v["both_top1000"])
D = sum(1 for v in structured.values() if v["both_top1000"])
print(f"  A  no Census full-name structure                    {A:7,}  ({100*A/len(std):5.1f}%)")
print(f"  B  structure, neither required role Top-1000        {B:7,}  ({100*B/len(std):5.1f}%)")
print(f"  C  structure, exactly one required role Top-1000    {C:7,}  ({100*C/len(std):5.1f}%)")
print(f"  D  structure, BOTH required roles Top-1000          {D:7,}  ({100*D/len(std):5.1f}%)")
print(f"     (A+B+C+D = {A+B+C+D:,})")

print("\n  Sensitivity -- both required roles within rank band (REPORTED, not adopted):")
for band in (100, 500, 1000, 5000, 10000):
    both = sum(1 for v in structured.values() if v["ranks"][0] <= band and v["ranks"][1] <= band)
    either = sum(1 for v in structured.values() if v["ranks"][0] <= band or v["ranks"][1] <= band)
    print(f"    top {band:6,}   both {both:6,} ({100*both/len(std):4.1f}% of Standard)"
          f"   either {either:6,} ({100*either/len(std):4.1f}%)")


# ------------------------------------------------------------------ §4 policies
print("\n\n=== 4. POLICY COMPARISON ===\n")
POLICIES = {
    "A  no Census cutoff": lambda v: False,
    "B  suppress when BOTH roles Top-1000": lambda v: v["both_top1000"],
    "C  suppress when EITHER role Top-1000": lambda v: v["either_top1000"],
}
for label, suppress in POLICIES.items():
    sup = [k for k, v in structured.items() if suppress(v)]
    print(f"  {label:40s} strong {len(std)-len(sup):7,}   suppressed {len(sup):6,} "
          f"({100*len(sup)/len(std):4.1f}%)   collisions remaining {len(structured)-len(sup):6,}")

# ------------------------------------------------------------------ §7 samples
print("\n\n=== 7. WHAT EACH POLICY SUPPRESSES ===\n")
def sample(pred, n=30):
    hits = sorted(k for k, v in structured.items() if pred(v))
    # spread the sample across the alphabet rather than taking the first N
    step = max(1, len(hits)//n)
    return hits[::step][:n], len(hits)

for label, pred in [("POLICY B (both Top-1000)", lambda v: v["both_top1000"]),
                    ("POLICY C only (exactly one Top-1000)", lambda v: v["either_top1000"] and not v["both_top1000"])]:
    s, total = sample(pred)
    print(f"  {label} -- {total:,} names, sample of {len(s)}:")
    print(f"    {' | '.join(s)}\n")

# ------------------------------------------------------------------ §7b harm
print("=== 7b. RECOGNIZABLE PLACES HARMED ===\n")
PROBES = ["SAN DIEGO", "SAN MARCOS", "LOS ANGELES", "SAN FRANCISCO", "SAN JOSE", "SANTA BARBARA",
          "SANTA MONICA", "NEW YORK", "SAN ANTONIO", "LAS VEGAS", "FORT WORTH", "SALT LAKE CITY",
          "KANSAS CITY", "SAINT LOUIS", "BATON ROUGE", "GRAND RAPIDS", "SAN JUAN", "PALO ALTO",
          "SANTA FE", "LONG BEACH", "DALY CITY", "CHULA VISTA", "MOUNT VERNON", "GLEN ELLYN",
          "LAKE CHARLES", "GRAND FORKS", "SIOUX FALLS", "BATTLE CREEK", "CEDAR RAPIDS"]
print(f"  {'name':18s} {'in Standard':12s} {'structure':14s} {'ranks':16s} {'B?':4s} {'C?':4s}")
for p in PROBES:
    v = structured.get(p)
    inn = p in std
    if v:
        print(f"  {p:18s} {str(inn):12s} {v['reading']:14s} {str(v['ranks']):16s} "
              f"{'SUP' if v['both_top1000'] else '-':4s} {'SUP' if v['either_top1000'] else '-':4s}")
    else:
        print(f"  {p:18s} {str(inn):12s} {'no structure':14s} {'-':16s} {'-':4s} {'-':4s}")

# ------------------------------------------------------------------ §8 class
print("\n\n=== 8. FEATURE-CLASS INTERACTION ===\n")
groups = collections.Counter()
coll = collections.Counter()
for k, e in std.items():
    g = "+".join(sorted(e["classes"]))
    groups[g] += 1
    if k in structured:
        coll[g] += 1
print(f"  {'class combination':40s} {'names':>8s} {'collisions':>11s} {'rate':>7s}")
for g, n in groups.most_common(10):
    print(f"  {g:40s} {n:8,} {coll[g]:11,} {100*coll[g]/n:6.1f}%")

# ------------------------------------------------------------------ §9 multiplicity
print("\n\n=== 9. MULTIPLICITY AS CORROBORATION ===\n")
for label, pred in [("1 state", lambda e: len(e["states"]) == 1),
                    ("2-4 states", lambda e: 2 <= len(e["states"]) <= 4),
                    ("5+ states", lambda e: len(e["states"]) >= 5)]:
    sub = [k for k, e in std.items() if pred(e)]
    c = sum(1 for k in sub if k in structured)
    print(f"  {label:12s} names {len(sub):7,}   Census-structure {c:6,} ({100*c/max(1,len(sub)):4.1f}%)")
multi_class = [k for k, e in std.items() if len(e["classes"]) >= 2]
c = sum(1 for k in multi_class if k in structured)
print(f"\n  supported by 2+ Standard classes: {len(multi_class):,}   Census-structure {c:,} ({100*c/max(1,len(multi_class)):.1f}%)")
single_class = [k for k, e in std.items() if len(e["classes"]) == 1]
c1 = sum(1 for k in single_class if k in structured)
print(f"  supported by 1 class:             {len(single_class):,}   Census-structure {c1:,} ({100*c1/max(1,len(single_class)):.1f}%)")


# ------------------------------------------------------------------ §11 witnesses
# APPLIED ONLY NOW. Policy B was selected in §4/§7 from the national data
# alone; nothing below fed that choice.
print("\n\n=== 11. FROZEN DOCSCRUB WITNESSES, under the SELECTED policy (B) ===\n")
WITNESSES = ["San Diego", "San Marcos", "Sonoma", "East Bay", "Angeles, CA", "Los Angeles",
             "Amy Miller", "Jeffrey Lam", "Yazmine Guzmán", "Julie Ford", "Cashay Jackson",
             "Min Shi", "Diana", "Sarah", "Andrew", "Goodloe, Andrew",
             "Grade Rosters", "Academic Senate", "Financial Aid", "Reason Code",
             "Term Withdrawals", "Good Morning"]
print(f"  {'witness':20s} {'multi':6s} {'in Std':7s} {'structure':14s} {'ranks':16s} {'PLACE evidence under B'}")
print("  " + "-" * 108)
for w in WITNESSES:
    k = norm_space(w)
    multi = " " in k
    inn = k in std
    v = structured.get(k)
    if not multi:
        verdict = "none (single-token, out of scope)"
    elif not inn:
        verdict = "none (no Standard GNIS match)"
    elif v and v["both_top1000"]:
        verdict = "SUPPRESSED -> weak corroboration only"
    else:
        verdict = "STRONG PLACE evidence"
    print(f"  {w:20s} {str(multi):6s} {str(inn):7s} {(v['reading'] if v else '-'):14s} "
          f"{(str(v['ranks']) if v else '-'):16s} {verdict}")

# ------------------------------------------------------------------ §14 asset
print("\n\n=== 14. ASSET IMPACT ===\n")
import gzip
strong = sorted(k for k in std if not (k in structured and structured[k]["both_top1000"]))
allmt = sorted(std)
for label, keys in [("Standard multi-token, Policy A", allmt), ("Standard multi-token, Policy B", strong)]:
    blob = "\n".join(keys)
    print(f"  {label:34s} {len(keys):7,} names   {len(blob)/1048576:5.2f} MiB keys   "
          f"{len(gzip.compress(blob.encode()))/1048576:5.2f} MiB gzip")
print(f"\n  Policy B does not shrink the asset: suppressed names are RETAINED as weak")
print(f"  corroboration and carry one extra bit. Cost of the policy = 1 bit x {len(std):,} names.")
print(f"  The bit is computable from data ALREADY in the shipped Census asset")
print(f"  (first_top1000 / last_top1000) -- no rank data needs to ship.")
