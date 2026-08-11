# Census 2020 Name Evidence — Experiment

**Date:** 2026-08-10
**Status:** experiment only. **No production change.** Harnesses in `app/investigation/census-*.ts`; the CSV is copied to `app/investigation/data/` and is imported by nothing in `src/`.
**Verdict (§16): A — strong enough to integrate as a new deterministic person-evidence source.**

Run: `node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs investigation/census-experiment.ts`

---

## 1. Schema, as observed — with two corrections

Header matches your description exactly. Counts match: 195,311 rows, 53,616 first, 156,622 last, 14,927 both. `normalized_name` charset is `A–Z` plus one space. No nulls where attestation is true; no counts where it is false.

**Correction 1 — one row is a data artifact, not a name.** `ALL OTHER NAMES` is the Census residual bucket. It is the only row containing a space. Excluded at load; working totals are 195,310 / 53,615 / 156,621 / 14,926.

**Correction 2 — the two first-name source files differ far more often than "occasionally, slightly".** `first_count_sex_file` and `first_count_race_file` disagree on **49,090 of 53,616 first names (92%)**. Neither is ever present without the other. This does not affect attestation, but it means `first_count` is a reconciled aggregate rather than a corroborated figure. **Consequence for design: use prevalence ordinally (rank, Top-1000) rather than as a magnitude.**

Minor: `first_top1000` is true for 1,001 rows — two names tie at rank 1000.

## 2. Normalization

NFD → strip combining marks → strip non-letters → uppercase. Lookup only; display text never changes. No fuzzy, edit-distance, phonetic or transliteration matching.

```
Guzmán      -> GUZMAN       first(338)   last(170696)
Núñez       -> NUNEZ        first(120)   last(128895)
Martínez    -> MARTINEZ     first(1794)  last(1039848)
O'Brien     -> OBRIEN       first(355)   last(115547)
Smith-Jones -> SMITHJONES   last(315)
```

## 3–4. Witnesses

See the harness output for the full tables. The headline rows:

```
Yazmine Guzmán    YAZMINE[F] GUZMAN[FL]   FIRST+LAST      DocScrub evidence: NONE   currently: other
Amy Miller        AMY[FL] MILLER[FL]      AMBIGUOUS-ROLE  DocScrub evidence: NONE   currently: people
Chelsye Angelina  CHELSYE[F] ANGELINA[FL] FIRST+LAST      DocScrub evidence: NONE   currently: people
Reason Code       REASON[FL] CODE[FL]     AMBIGUOUS-ROLE  DocScrub evidence: NONE   currently: people
Good Morning      GOOD[FL] MORNING[FL]    AMBIGUOUS-ROLE  DocScrub evidence: NONE   currently: other
```

Every real-person witness gets Census evidence. **So do several non-person controls** — which is the point of §7.

## 5–6. Structure over the live 139-unit residue

```
structure         all   known people   known non-people   share that are people
FIRST+LAST          6      3/30              3/106            50%
LAST,FIRST         16      5/30             11/106            31%
AMBIGUOUS-ROLE     11      5/30              6/106            45%
SINGLE-TOKEN       14     14/30              0/106           100%
PARTIAL            59      3/30             55/106             5%
NONE               33      0/30             31/106             0%
```

**Structure alone is not a discriminator.** FIRST+LAST is a coin flip on this population.

## 7. Collisions — the dangerous cases

**20 of 106 known non-people (19%) present as a full Census name structure**, ranked by weakest role count:

```
San Diego 4389 · San Marcos 4389 · Last Day 1446 · Staff Ad 1419 · Angeles, CA 993 ·
Happy Birthday Eve 932 · Level, Early 689 · Service Indi 587 · From Melissa 568 ·
Fire Marshall 448 · Reason Code 214 · Go Live 197 · Welcome Call 146 ·
Student Final Exa 145 · End Time 120 · Pacific Standard Time 120 · Start Time 120 ·
High School 119 · Dear All 104 · Dear Student 104
```

`censusHit ⇒ PERSON` would be a disaster. This is the measurement that decides the shape of any integration.

## 8. Frequency IS discriminative

```
known PEOPLE,     weakest role count:  min 144  p25 2264  median 4393  p75 16906  max 625127
known NON-PEOPLE, weakest role count:  min 104  p25 120   median 448   p75 993    max 4389
```

The non-person distribution **tops out at 4389**; the person median is **4393**. Top-1000 membership: people 24/30 (80%), non-people 9/106 (8%).

```
weakest role count >=   500:  people 12/30   non-people  9/106
                    >=  1000:  people 11/30   non-people  4/106
                    >=  5000:  people  5/30   non-people  0/106
```

Prevalence is genuinely discriminative — and it is the *weakest link* that carries the signal, not the maximum.

## 9. Interaction with cross-candidate evidence

The load-bearing table. "Removals" is the validated SAFE composition (T3/H2/prefix) after the gate.

```
protection gate                          people protected  non-people protected  removals
existing lexicon only (today)               21/30                2/106              65
+ ANY Census token attested                 30/30               80/106              11   <- destroys the cleanup
+ Census NAME STRUCTURE                     28/30               22/106              54
+ structure AND weakest role >= 500         27/30               11/106              60
+ structure AND weakest role >= 1000        27/30                6/106              63
+ structure AND Top-1000 role               28/30                7/106              64
```

**"Any Census hit" as protection would cut the cleanup from 65 to 11.** Structure plus prevalence protects six more real people than today while costing two removals.

## 10. Versus the existing lexicon

```
population          existing lexicon   census    census-only   existing-only
known people             21/30          30/30         9              0
known non-people          2/106         80/106       78              0
all residue              23/139        111/139       88              0
```

**Census is a strict superset — nothing is existing-only.** Census-only person rescues: `Amy Miller`, `Jeffrey Lam`, `Francis, Kyle`, `Evelyn, Joaquin`, `Fox, Liudmila`, `Bobbie Galaz`, `Chelsye Angelina`, `Chriztopher Johnson`, `Fox, Liud`.

The motivating defect:

```
Yazmine Guzmán   census FIRST+LAST   YAZMINE[F] GUZMAN[FL]   docscrub: weak_name_structure -> other
Yazmine Guzman   census FIRST+LAST   YAZMINE[F] GUZMAN[FL]   docscrub: strong_name_structure -> people
```

Census sees both spellings identically. DocScrub's ASCII-only regexes do not.

## 11. Demographics

Not used. `first_count_sex_file` / `first_count_race_file` are read only to report the 92% divergence in §1. No demographic attribute is derived, stored or inferred.

## 12. Footprint

```
CSV on disk        10.51 MiB
parse + index         179 ms
heap (naive Map)     67.9 MiB
lookup               4.31 µs per candidate
569-candidate pass    2.5 ms
```

A compact representation — key set plus one flags byte and two `Uint32Array` ranks — measured at **4.4 MiB heap, 135 ms build**. Keys-only JSON is 1.83 MiB, ~0.5 MiB gzipped. **Footprint is not a blocker.**

## 13–15. Unsafe cases

**Non-people Census protects even at structure + ≥1000:** `San Diego`, `San Marcos`, `Last Day`, `Staff Ad`. Protection is the *safe* direction — these stay reviewable rather than being reclassified — but they are the cost.

**Real people Census cannot protect (no structure):** `Perias, Nelly` (PERIAS not attested), `Chriztopher Johnson` (CHRIZTOPHER not attested), `Fox, Liud` (truncation). The first and third are protected in production by `surname_given_structure`; **`Chriztopher Johnson` is protected by neither Census nor the lexicon** and survives today only because no cross-candidate rule fires on it. That is safety by absence, and it should be recorded rather than relied on.

Note: the harness's "people lost: Fox, Liud" row is an artifact of the offline gate, which models only the lexicon. Production's gate also reads `surname_given_structure`, which protects it.

## 16. Verdict — **A**

**Strong enough to integrate as a new deterministic person-evidence source. Design the integration next.**

- Person coverage 21/30 → 30/30, a strict superset, rescuing exactly the witnesses that were unreachable.
- Fixes the diacritic defect at the evidence layer.
- Composes correctly with cross-candidate: +6 people protected for −2 removals.
- Deterministic, local, static, no model, no network. 4.4 MiB.

**Integration can begin without choosing a frequency threshold.** "Census name structure" alone protects 28/30 and costs 65→54; prevalence is a refinement to measure on a second document, not a precondition. That matters because every threshold in the §9 table was derived from *this* document's 106 non-people, and adopting one now would be fitting to one corpus.

**What this buys architecturally, which is the actual question:** it makes the PERSON side broad and defensible, which is what lets the NOT-PERSON side stay aggressive. The interpreter gets simpler, not more complicated — `Census structure ∨ existing evidence` becomes the protection gate, cross-candidate composition stays exactly as validated, and neither side winning is Undetermined.

**Two things to settle in the integration design, neither a blocker:**
1. Where the resource lives and in what representation (the 4.4 MiB packed form, generated as a TS asset like `quality-dictionaries.data.ts`).
2. Whether `first_count` is used at all, given the 92% source divergence. Recommend rank/Top-1000 only.
