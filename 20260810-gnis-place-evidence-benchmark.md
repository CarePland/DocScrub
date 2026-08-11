# GNIS Geographic Reference — Benchmark

**Date:** 2026-08-10
**Status:** benchmark only. **No production integration.** Harness: `app/investigation/gnis_benchmark.py`. Nothing in `src/` reads GNIS.
**Verdict (§16): B — useful, but only a bounded subset: multi-token exact match against cultural feature classes.**

---

## 1. Source, verified

Every figure you gave checks out. Corrections and additions below.

```
fields (21): feature_id | feature_name | feature_class | state_name | state_numeric |
             county_name | county_numeric | map_name | date_created | date_edited |
             bgn_type | bgn_authority | bgn_date | prim_lat_dms | prim_long_dms |
             prim_lat_dec | prim_long_dec | source_lat_dms | source_long_dms |
             source_lat_dec | source_long_dec

rows                        981,698     (exact)
feature classes                  43     (exact)
distinct feature_name       523,345
distinct NORMALIZED names   522,865
'(historical)' suffixed      26,275
non-ASCII feature names       5,577
state/area values                68     (includes territories)
```

Class counts match yours exactly: Stream 232,585 · Populated Place 190,921 · Reservoir 72,985 · Lake 70,348 · Summit 69,706 · Valley 69,257 · Civil 65,193 · Spring 37,490 · Canal 21,574 · Island 17,940 · Census 14,745.

**Four things worth adding:**

1. **Primary names only.** There is no variant-name column and no variant rows — one row per feature, carrying the official/primary name. Anything relying on GNIS variants would need a different product.
2. **`bgn_type` is not a historical flag.** It is populated on only 58,493 rows (`Official` 57,843 · `Vacated` 626 · `Not Official` 24) and records a Board on Geographic Names decision. Historical features are marked by a **`(historical)` suffix inside `feature_name`** — 26,275 of them. They cannot exact-match a candidate in that form, but their presence inflates distinct-name counts and they should be dropped at generation.
3. **Encoding:** UTF-8 with BOM, pipe-delimited, no quoting. Streams cleanly.
4. **Duplicate names are the norm, not the exception.** `Mill Creek` ×1,459, `Spring Creek` ×1,303, `Dry Creek` ×1,195. Multiplicity is a property to carry, not an anomaly to resolve.

## 2. Tiers, verified

```
                                          rows      distinct normalized
STANDARD  Populated Place+Civil+Census   270,859          164,809
CALIFORNIA  all classes                   52,618           39,801
SOCAL  8 counties, all classes            11,164            9,876
FULL  national                           981,698          522,865
```

All three of your independent measurements confirmed.

**Military and Area add nothing here.** Military is 3,188 national rows, Area 2,247; neither adds a single live candidate. `Locale` and `Park` do not exist as classes in this product. **Standard = Populated Place + Civil + Census is the right definition** on this evidence.

## 4. Normalization — measured

NFD → strip combining marks → **punctuation to SPACE** → collapse → uppercase.

```
input             punct->space      punct->stripped     hit(space)  hit(strip)
Angeles, CA       ANGELES CA        ANGELESCA           False       False
O'Brien           O BRIEN           OBRIEN              False       True
St. Helena        ST HELENA         STHELENA            True        True
Coeur d'Alene     COEUR D ALENE     COEURDALENE         True        True
Winston-Salem     WINSTON SALEM     WINSTONSALEM        True        True
Cañada Agua       CANADA AGUA       CANADAAGUA          True        True
```

**Punctuation must collapse to a space, not to nothing.** This differs from the Census normalizer, and the difference is forced by the data: Census keys are single tokens, GNIS names are multi-word. Stripping would fuse tokens and manufacture matches the source never contained. Accent folding is required — `Cañada Agua` is a real GNIS name and must be reachable from either spelling.

`Angeles, CA` correctly misses. GNIS has `Angeles`, not `Angeles CA`; no false match is created.

## 5. Witnesses

```
candidate          hit    n  std    ca   socal  classes                   census
San Diego          YES    3  yes   yes    yes   Populated Place           ambiguous-role
San Marcos         YES    3  yes   yes    yes   Civil, Populated Place    ambiguous-role
Sonoma             YES    5  yes    no     no   Populated Place           none
East Bay           YES   32  yes   yes    yes   Bay,Gut,Lake,PopPlace,…   ambiguous-role
Los Angeles        YES    6  yes   yes    yes   Populated Place           surname-first
Angeles, CA         no    -    -     -      -   -                         surname-first
Yazmine Guzmán      no    -    -     -      -   -                         first-surname
Amy Miller          no    -    -     -      -   -                         ambiguous-role
Jeffrey Lam         no    -    -     -      -   -                         ambiguous-role
Good Morning        no    -    -     -      -   -                         ambiguous-role
Reason Code         no    -    -     -      -   -                         ambiguous-role
Last Day            no    -    -     -      -   -                         surname-first
Financial Aid       no    -    -     -      -   -                         none
Academic Senate     no    -    -     -      -   -                         none
Grade Rosters       no    -    -     -      -   -                         none
Term Withdrawals    no    -    -     -      -   -                         none
```

**5 of 5 geographic witnesses hit. 0 of 11 non-geographic witnesses hit.** Not one administrative phrase, greeting or personal name produces a false exact match. That is a far cleaner separation than Census achieved on the same population.

## 7. The single-token trap — the central finding

Over the live 139-unit residue, GNIS produces **9 exact hits**:

```
single-token hits:  7  ->  7 known PEOPLE, 0 known non-people
    Andrew · Margaret · Patrick · Joan · Diana · Sarah · Christopher
multi-token hits:   2  ->  0 known people, 2 known non-people
    San Diego · San Marcos
```

**Every single-token hit is a bare first name that is also a US town.** There are populated places named Andrew, Sarah, Diana, Joan, Patrick, Margaret and Christopher. At dataset scale: **15,578 of the 15,711 single-token GNIS/Census collisions are Populated Place.**

Your named ambiguous strings confirm it — all nine are Populated Place *and* Census-attested in both roles:

```
Virginia 10 · Georgia 6 · Austin 27 · Madison 30 · Jordan 27
Hope 31 · Sonoma 5 · Dakota 5 · Carolina 11
```

**`GNIS single-token hit → PLACE` would convert seven real people into places on this document alone.** It is the direct analogue of the Census "any attested token" failure, and it fails the same way for the same reason.

Dataset-level overlap, for the record: 37% of single-token GNIS names are Census-attested; 42% of multi-token GNIS names form a full Census name structure. The datasets overlap massively — the discipline has to come from the *candidate* contract, not from the sources.

## 8. Feature-class utility

All 9 live hits carry a Standard class; **zero come from natural-feature classes only.** On this corpus, Stream/Lake/Summit/Valley/Spring contribute nothing — which is expected for a university email set and should not be read as a general result. They belong in Regional/Full packs, not in Standard.

**The multi-token restriction, priced:**

```
STANDARD pack, single-token  40,202 names   Census-attested 15,616 (39%)
STANDARD pack, multi-token  124,607 names   full Census structure 36,119 (29%)

dropping single-token costs 24% of the pack and removes 15,616 person collisions
multi-token STANDARD pack: 124,607 names, 2.34 MiB keys, 0.52 MiB gzip
```

The recall cost is real and should be stated: **`Sonoma` is a single-token genuine place and would be missed.** That is the right trade — one missed place against seven misclassified people.

## 9. Regional corroboration

```
candidate      natl feats  states   CA   SoCal   reading
San Diego               3       3  yes    yes    locally corroborated
San Marcos              3       2  yes    yes    locally corroborated
Sarah/Andrew/…        4-7     4-6   no     no    national only
```

Region separates the two real places from all seven person-collisions cleanly on this document. **But that is a property of this corpus, not a general one**, and treating regional presence as required would be a claim about document content you explicitly ruled out. Region is a corroborator and an availability tier — never a gate.

## 10–12. Pack sizing

```
                                    names      keys      gzip
STANDARD (PopPlace+Civil+Census)  164,809   2.67 MiB   0.63 MiB
  multi-token only                124,607   2.34 MiB   0.52 MiB
REGIONAL California                39,801   0.60 MiB   0.16 MiB
REGIONAL SoCal 8 counties           9,876   0.15 MiB   0.04 MiB
FULL national                     522,865   8.25 MiB   2.00 MiB

shipped Census asset, for scale    195,310   1.83 MiB   0.53 MiB
```

Add one flags byte per name for a coarse class group plus a "has a Standard-class feature" bit. Coordinates, `map_name`, dates and county detail are **not** needed for semantic lookup and should be dropped — the benchmark shows classes, state multiplicity and feature count carry all the evidence.

Pack generation by state and by county group is mechanically clean: `state_name` and `county_name` are populated and consistent, so California / SoCal / Montana / Virginia packs are a filter over the same generator. The Full pack collapses 981,698 rows into 522,865 keyed entries without losing anything DocScrub reads.

## 13. Interaction with the interpreter

```
live residue                                       139
gain ANY GNIS evidence                               9
gain defensible PLACE evidence (multi-token+Std)     2   San Diego, San Marcos
  true positives                                     2
  false positives                                    0
person/place CONFLICTS                               2
reduction in Undetermined                            2
```

Both units that gain PLACE evidence **also** carry a Census person structure. So the immediate architectural requirement is not a PLACE type — it is the ability to represent **person evidence + place evidence → conflict**, which is what you asked for and what the current interpreter cannot express.

## 16. Verdict — **B**

**Useful, but only a bounded subset should be integrated: exact multi-token match against Populated Place / Civil / Census.**

Not A: the live payoff is **2 units of 139**. GNIS gives DocScrub genuine PLACE evidence it currently lacks, and the evidence is clean — 5/5 places, 0/11 non-places, 0 false positives under the multi-token restriction — but on this corpus it moves almost nothing. It is a correctness capability, not a workload capability.

Not C: it is not collision-prone *once the multi-token restriction is applied*. Without that restriction it is worse than useless, and that is the whole content of the verdict.

**Recommended architecture**

- **Standard, bundled:** multi-token names from Populated Place + Civil + Census. 124,607 names, ~0.5 MiB gzip — the same order as the shipped Census asset. Drop `(historical)` rows at generation.
- **Regional, downloaded:** all classes for a chosen state or county group. California 0.16 MiB, SoCal 0.04 MiB. Natural features are affordable at this scope and may be worth including; the benchmark cannot say, because this corpus has no natural-feature candidates.
- **Full, downloaded:** 522,865 keys, 2.0 MiB gzip. Cached, never bundled.
- **Privacy:** download reference data, look up locally. No candidate string leaves the machine. Turning enhanced packs off costs recall, never function.

**The contract, if you approve integration**

```
PLACE evidence requires: exact normalized match, MULTI-TOKEN, Standard feature class.
Single-token GNIS matches are NEVER place evidence.   (7/7 were real people)
Region is corroboration and availability, never a requirement.
GNIS hit + Census name structure -> CONFLICT, not a winner.
Absence from GNIS is never evidence against a place reading.
```

**Limitation, stated plainly.** This ran against the 139-unit C1 residue, the only live population I hold offline. The 281-entity Other bucket was not tested and could contain more place names — the live diagnostic is the instrument for that, and the volume figure above should be treated as a floor rather than a total.
