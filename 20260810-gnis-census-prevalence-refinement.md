# GNIS × Census Prevalence — Refinement

**Date:** 2026-08-10
**Status:** measurement and design only. **No production integration.** Harness: `app/investigation/gnis_census_prevalence.py`.
**Verdict (§15): A — adopt a hard Census-prevalence cutoff. Policy B, specified exactly in §11.**

Derived globally over the national datasets. The DocScrub witnesses were applied only after the policy was chosen and never fed the choice.

---

## 1. Population — one correction

```
multi-token Standard GNIS names, '(historical)' EXCLUDED      109,680
of those, forming a Census full-name STRUCTURE                 36,119   (32.9%)
```

**The prior figure of 124,607 included `(historical)`-suffixed names.** Excluding them costs 14,927 names and is clearly correct — `Amanda Gulch (historical)` normalizes to `AMANDA GULCH HISTORICAL` and can never match a document candidate.

The structure count is **unchanged at 36,119**, which at first looks like a transcription error and is not. Historical names essentially never form a person structure: the `(historical)` suffix makes `HISTORICAL` the final token, and `HISTORICAL` is not Census-attested in either role, so the structure test fails by construction. The two figures agreeing is a consistency check, not a coincidence.

**Ranks come from the source aggregate, not the shipped asset.** The production asset deliberately carries only Top-1000 bits (counts dropped for the 92% source divergence, ranks for having no consumer). §3 anticipated this. Ranks are ordinal and unaffected by the count divergence.

## 3. Global prevalence distribution

Role-aware throughout: a phrase qualifies only as FIRST+SURNAME or SURNAME+FIRST. Where both readings exist the **stronger** is taken, and a reading's strength is its **weaker role** — a phrase is only as person-like as its least common required role.

```
A  no Census full-name structure                  73,561   (67.1%)
B  structure, neither required role Top-1000      27,772   (25.3%)
C  structure, exactly one required role Top-1000   7,402   ( 6.7%)
D  structure, BOTH required roles Top-1000           945   ( 0.9%)
```

Sensitivity, reported not adopted:

```
band        both roles          either role
top    100      22 (0.0%)        1,626 ( 1.5%)
top    500     507 (0.5%)        5,775 ( 5.3%)
top  1,000     945 (0.9%)        8,347 ( 7.6%)
top  5,000   5,788 (5.3%)       21,743 (19.8%)
top 10,000  10,499 (9.6%)       26,853 (24.5%)
```

## 4. Policy comparison

```
                                        strong    suppressed        collisions left
A  no cutoff                           109,680      0    (0.0%)         36,119
B  suppress when BOTH roles Top-1000   108,735    945    (0.9%)         35,174
C  suppress when EITHER role Top-1000  101,333  8,347    (7.6%)         27,772
```

## 6–7. What each policy actually removes

**Policy B — 945 names.** Sample:

```
ACOSTA GRANT · ANTHONY HILL · BRADY PARK · CASEY FORD · CLAYTON MEADOWS ·
DEAN FORD · GEORGE ATKINSON GRANT · GLEN ROGERS · HOLLY HOUSE · JACK WADE ·
JOHN F KENNEDY · KENDALL MILLS · MARIAN MEADOWS · PERRY MILLS · ROBIN HILL ·
SAMANTHA PARK · SHARON PARK · TARA WOODS · TROY HILL · WEST MARION
```

These are **features named after people** — land grants, parks, hills, mills. That is exactly the population that should lose strong PLACE authority, and the fact that the class emerges from a purely statistical rule rather than a hand-written list is the result that makes the policy defensible.

**Policy C — 8,347 names, and it damages real geography:**

```
name             structure       ranks           B     C
SANTA BARBARA    surname+first   (12466, 29)     -    SUPPRESSED
SANTA MONICA     surname+first   (12466, 203)    -    SUPPRESSED
MOUNT VERNON     surname+first   (4161, 828)     -    SUPPRESSED
LAKE CHARLES     surname+first   (1108, 17)      -    SUPPRESSED
```

**Santa Barbara is one of the eight counties in the SoCal regional pack.** A policy that strips PLACE authority from Santa Barbara, Santa Monica, Mount Vernon and Lake Charles is disqualified on its own evidence. Policy C is rejected.

**Nothing recognizable is harmed by Policy B.** San Diego, San Marcos, Los Angeles, San Francisco, San Jose, San Antonio, New York, Las Vegas, Fort Worth, Saint Louis, San Juan, Palo Alto, Santa Fe, Long Beach, Sioux Falls, Battle Creek and Glen Ellyn all survive, as do Santa Barbara, Santa Monica, Mount Vernon and Lake Charles.

## 8. Feature-class interaction

```
class                       names    collisions    rate
Populated Place            58,510      25,212     43.1%
Civil                      39,369       6,503     16.5%
Census                     11,638       4,313     37.1%
Civil + Populated Place       111          65     58.6%
Census + Populated Place       45          26     57.8%
```

**Civil is materially cleaner than Populated Place — 16.5% against 43.1%.** Civil names are administrative divisions (townships, boroughs) and are far less often person-derived. This is real and worth carrying as evidence strength, though it is not needed for the cutoff.

**Multi-class support is NOT corroboration — it points the wrong way.** Only 163 names carry two Standard classes, and their collision rate is *higher* (55.8% vs 32.9%). The intuition that "supported as both Populated Place and Civil" means more solidly geographic is falsified.

## 9. Multiplicity — a negative finding

```
1 state     95,294 names   Census-structure 31.2%
2-4 states  12,156         43.1%
5+ states    2,230         50.9%
```

**State multiplicity correlates positively with person-name collision, not negatively.** A name appearing in many states is *more* likely to be person-derived, because person-named features recur everywhere. Neither multiplicity signal should become a threshold; both would push in the wrong direction. Retain as metadata for diagnostics, nothing more.

## 11. Frozen witnesses, under the selected policy

Applied after selection.

```
witness            multi  in Std  structure       ranks           result under B
San Diego          yes    yes     first+surname   (4316, 5380)    STRONG PLACE
San Marcos         yes    yes     first+surname   (4316, 6234)    STRONG PLACE
East Bay           yes    yes     surname+first   (2922, 7175)    STRONG PLACE
Los Angeles        yes    yes     surname+first   (26922, 3309)   STRONG PLACE
Sonoma             no      -      -               -               none (single-token)
Angeles, CA        yes    no      -               -               none (no match)
Amy Miller         yes    no      -               -               none (no match)
Jeffrey Lam        yes    no      -               -               none (no match)
Yazmine Guzmán     yes    no      -               -               none (no match)
Julie Ford         yes    no      -               -               none (no match)
Cashay Jackson     yes    no      -               -               none (no match)
Min Shi            yes    no      -               -               none (no match)
Diana / Sarah / Andrew    no      -               -               none (single-token)
Goodloe, Andrew    yes    no      -               -               none (no match)
Grade Rosters · Academic Senate · Financial Aid · Reason Code ·
Term Withdrawals · Good Morning     all: none (no Standard GNIS match)
```

**Four true places gain strong PLACE evidence. Zero of the twelve person or administrative witnesses gain any. Zero real places are harmed.** The six Higher Education terms produce no GNIS match at all, which is the correct behaviour — they belong to the concurrent terminology channel and GNIS should stay silent on them.

## 12–13. Treatment of suppressed names, and the pack tiers

Suppression is an **evidence-strength downgrade, never a deletion**. A suppressed name remains in the pack, remains queryable, and remains available as weak geographic corroboration — it simply loses the authority to route a candidate to PLACE on its own.

- **Standard / bundled** — Policy B applies. Aggressively conservative; a false PLACE claim is expensive and a missed obscure place is not.
- **Regional Enhanced** — the user has deliberately installed geographically relevant knowledge, so suppressed names may act as corroboration there, and rarer classes are affordable. Policy B's *strong*-evidence bar should still hold.
- **Full Enhanced** — membership alone never implies strong PLACE evidence, exactly as established. Policy B is the same bar; the pack is simply larger.

**Core Geography stays a separate layer.** `Virginia` must not depend on an obscure GNIS populated-place record. Nothing here builds it, and nothing here should be read as covering it.

## 14. Asset impact

```
Standard multi-token, Policy A   109,680 names   2.00 MiB keys   0.45 MiB gzip
Standard multi-token, Policy B   108,735 names   1.99 MiB keys   0.45 MiB gzip
```

**Policy B costs one bit per name and nothing else.** Suppressed names are retained, so the asset does not shrink. Critically, **the bit is computable from data already in the shipped Census asset** — `first_top1000` / `last_top1000`, which were retained for exactly this kind of future study. No rank data needs to ship, and the 92% count divergence never enters a production decision.

## 15. Verdict — **A**

**Adopt a hard Census-prevalence cutoff for strong Standard PLACE evidence. Policy B.**

Exactly:

```
A Standard GNIS match provides STRONG affirmative PLACE evidence when:
    exact normalized match (NFD, marks stripped, punctuation -> space, upper)
    AND multi-token
    AND feature class in { Populated Place, Civil, Census }
    AND NOT (the phrase forms a Census FIRST+SURNAME or SURNAME+FIRST
             structure in which BOTH required roles are Census Top-1000)

Otherwise, if the GNIS match exists, it provides WEAK geographic corroboration.
A suppressed match is never deleted and never becomes negative evidence.
Absence from GNIS is never evidence against a place reading.
GNIS place evidence + Census person evidence -> CONFLICT for the interpreter,
never an automatic winner.
```

**Why A and not B.** The cutoff is cheap (one bit, already-shipped data), costs 0.9% of the population, harms no recognizable geography, and removes a coherent and generalizable class — features named after people. It is not a tuned threshold: Top-1000 is the band the production asset already carries, and the sensitivity table shows the alternatives are either too narrow to matter (Top-100, 22 names) or begin eating real places (Top-5000).

**Why not C.** "Either role Top-1000" suppresses Santa Barbara, Santa Monica, Mount Vernon and Lake Charles. That is more useful geography lost than person-collision saved.

**What this does not do, and should not be expected to.** Policy B leaves 35,174 Census-structure collisions standing. That is deliberate: those are names where the person reading is real but not prevalent, and forcing a winner is exactly what the interpreter must not do. The remaining conflicts are for the interpreter to represent as conflicts — which is the architecture this work exists to support, alongside the Higher Education channel and whatever domain packs follow.
