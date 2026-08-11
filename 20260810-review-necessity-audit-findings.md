# Review-Necessity Audit — Findings

**Date:** 2026-08-10
**Population:** the real 601-candidate browser export, 5,843 occurrences
**Headline: 175 candidates (29.1%) are already fully explained by existing deterministic evidence and carry no privacy-relevant reading.** Zero real people among the 45 that carry human labels.

**Investigation only. No production change, no rule proposed, no routing touched.**

---

## 1. Taxonomy

Six buckets, assigned by a **first-match-wins precedence order** so the result is deterministic and the ordering is itself a claim: privacy-relevant readings are tested before any convenience bucket can claim a candidate.

| Bucket | Definition | Review required? |
|---|---|---|
| `typed-pii-detection` | detector typed it email / phone / CIN / long-numeric-id | **yes** — protective detection, never auto-handled |
| `person-possible` | a Person reading survives | **yes** — privacy-relevant by definition |
| `contested-non-person` | no Person, but ≥2 affirmative non-Person readings compete | **yes** — narrowed, not explained |
| `uniquely-explained-organizational` | exactly one reading, and it is `organization` | **yes** — can carry privacy weight |
| `uniquely-explained-non-sensitive` | exactly one reading, in a non-sensitive class | **potentially not** |
| `unsupported` | no affirmative evidence at all | **yes** — silence is not a finding |

Non-sensitive classes: `domain-terminology`, `ordinary-language`, `date-or-term`, `document-title`, `acronym`. **`organization` is deliberately excluded** — in some documents a named organization is privacy-relevant.

**One bucket is unmeasurable here:** `automaticResolutions` is session state and is not exported. Already-resolved candidates cannot be identified from this data, so that bucket is reported as unavailable rather than guessed.

---

## 2. Distribution across all 601

| Bucket | Candidates | Share | Occurrences |
|---|---|---|---|
| person-possible | **273** | 45.4% | 4,578 |
| **uniquely-explained-non-sensitive** | **175** | **29.1%** | 857 |
| contested-non-person | 73 | 12.1% | 255 |
| unsupported | 39 | 6.5% | 72 |
| typed-pii-detection | 32 | 5.3% | 60 |
| uniquely-explained-organizational | 9 | 1.5% | 21 |

**Bucket × current section** — the removable population is almost entirely already sitting in `undetermined`:

| Bucket | undetermined | organizations | acronyms | dates-terms | people | identifiers/emails/phones | doc-titles |
|---|---|---|---|---|---|---|---|
| typed-pii | 0 | 0 | 0 | 0 | 0 | 32 | 0 |
| person-possible | 169 | 30 | 20 | 25 | **28** | 0 | 1 |
| contested-non-person | 27 | 22 | 13 | 8 | 0 | 0 | 3 |
| uniquely-organizational | 0 | 9 | 0 | 0 | 0 | 0 | 0 |
| **uniquely-non-sensitive** | **157** | 0 | 17 | 1 | 0 | 0 | 0 |
| unsupported | 39 | 0 | 0 | 0 | 0 | 0 | 0 |

---

## 3. Review funnel

```
601  extracted candidates
 ├─ 562  carry at least one affirmative interpretation
 │   ├─ 175  uniquely explained as non-sensitive   ← POTENTIALLY REMOVABLE (29.1%)
 │   └─ 387  still require attention
 │        ├─ 273  a Person reading survives
 │        ├─  73  contested among non-Person readings
 │        ├─  32  typed PII detections (never auto-handled)
 │        └─   9  uniquely organizational
 └─  39  no affirmative evidence — must stay visible

POTENTIAL REVIEW REDUCTION:  175 / 601 = 29.1%
REMAINING REVIEW POPULATION: 426
```

**The three operations, kept separate:**

| Operation | Population |
|---|---|
| **A** — reject one interpretation | 17 (P-6) |
| **B** — reclassify a candidate | 9 of those 17 |
| **C** — remove from review entirely | **175** today; **184** if P-6 were consumed |

C is strictly stronger than A and B. Rejecting a reading is not the same as explaining a candidate.

---

## 4. The potential-removal population — 175

**Predicate:** exactly one affirmative reading · that reading is in a non-sensitive class · no Person reading survives · not a typed PII detection.

Nothing qualifies for looking like junk, and **nothing qualifies on absence of evidence.**

| Surviving reading | Candidates |
|---|---|
| ordinary-language | 106 |
| domain-terminology | 51 |
| acronym | 17 |
| date-or-term | 1 |

| Evidence class doing the work | Signals |
|---|---|
| `lexicon-recognition` | 124 |
| `document-consistency` | 66 |
| `exact-phrase-attestation` | 2 |

**⚠️ Note what is carrying this: DocScrub's own quality lexicons and document-local cross-candidate evidence — not the eight reference packs.** The terminology packs contribute 2 signals out of 192. That is consistent with the Phase B finding that the packs contributed almost nothing on a higher-ed document, and it is worth knowing before more packs are commissioned.

By occurrence count: 38 appear once, 65 twice, 72 three or more. Examples: `Ahh`, `Anything`, `Apologies`, `Based`, `Because`, `Before`, `Column`, `Correct`, `Calendars`, `Attendance` (ordinary-language); `Academic Service`, `Action Reason`, `Appt Block`, `Appt Nbr`, `Associated Deans`, `Clearinghouse Webinar` (document-local domain terminology); `AACRAO`, `ASAP`, `COVID` (acronyms).

### Truth-label evaluation — evaluation only, never an input

| | |
|---|---|
| Labelled subset | 45 of 175 |
| **Would have removed a real person** | **0** |
| Correctly non-person | 45 |

Labels were attached **after** every bucket was fixed; the separation is structural, not a convention.

### ⚠️ One caveat on this population

**15 of the 175 also show an extraction-boundary shape** — `Ahh`, `Hello`, `Thanks`, `Sorry`, `Yeah`, `Yay`, `Great`, `Wonderful`, `When`, `Did`, `Thanks Mrs`, `Geez Exploding`. Removing these from review would hide a genuine extraction defect behind a correct semantic explanation. They are safe to *hide* and wrong to *ignore* — the underlying span problem stays.

---

## 5. P-6 downstream — a smaller payoff than it looks

P-6 fires on 17. Its effect is **operation A**, not C.

| Outcome | Count | Candidates |
|---|---|---|
| Would become removable | **9** | Class Level, End Date, Grade Pro, Last Date, New Student, Staff Course, Start Date, Stern Mass, Yep Smile |
| Review purpose remains — several readings compete | 6 | For Fall, Grad Office, Records Team, Staff Run Query, Student Group, Student Records |
| Review purpose remains — nothing is known | 2 | First Fight, Grad App |

**Consuming P-6 in routing would move the removable population from 175 to 184 — a gain of 9 candidates, +1.5%.**

That is a materially smaller product payoff than the Person-adjudication pass implied, and it is worth stating plainly: **P-6's value is semantic correctness, not review-burden reduction.** The 8 that keep a purpose keep it for good reasons — six are genuinely contested, two are candidates about which the system knows nothing.

---

## 6. The People section — all 28

| Assessment | Count |
|---|---|
| clearly review-worthy person | 25 |
| contested but review-worthy | 1 |
| likely extraction defect | 2 |

**25 are unambiguous** — multi-class Person evidence with candidate-span scope: `Goodloe, Andrew` (742 occ), `Collier, Tanesha` (400), `Yamada, Tamara` (547), `Margaret` (40), `Tanesha` (39), `Goodloe` (35), `Nelly` (21), `Garcia` (17). Several carry all four evidence classes including `occurrence-context` and `document-consistency`.

**Two extraction defects:**

| Candidate | Occ | Person evidence | Shape |
|---|---|---|---|
| `If Joan` | 2 | `lexicon-recognition`, **component** scope only | leading function word |
| `Tanesha,   Any` | 1 | `lexicon-recognition`, `token-membership`, `occurrence-context` | multiple-space comma join |

**One case worth its own note — and it vindicates an earlier rejection:**

```
Perias, Nelly    724 occurrences    People
  person + [lexicon-recognition]     component scope ONLY
  ordinary-language
```

A real person, one of the most frequent candidates in the document, whose **entire Person evidence is component-scoped.** This is exactly the population rule **P-1 (span-evidence-required) would have removed** — and it was rejected for costing 4 real people. This candidate is the concrete reason that rejection was right.

**No demotion rule is proposed.** This is measurement.

---

## 7. Extraction defects — kept separate

63 candidates (10.5%), 649 occurrences. **Understated**, because the shape detection recomputes quality categories without document context.

| Shape | Candidates | Occ | Still carry Person |
|---|---|---|---|
| greeting/interjection fused into span | 34 | 439 | 15 |
| stranded honorific | 11 | 53 | 4 |
| sentence fragment | 9 | 134 | 8 |
| leading function/greeting word | 8 | 23 | 5 |
| multiple-space comma join | 1 | 1 | 1 |

**33 of 63 still carry a Person reading.**

### Burden attribution

| Source | Candidates |
|---|---|
| extraction / boundary shape | **63** |
| semantic uncertainty (unsupported or contested, clean span) | **99** |
| neither — explained, or a protective detection | 439 |

So of the roughly 162 candidates that are neither explained nor protective detections, **39% are an extraction problem wearing a semantic costume.**

---

## 8. Populations worth investigating next

| Population | Size | Labelled people in it | Monotone? | What it still needs |
|---|---|---|---|---|
| **R-1** uniquely-explained non-sensitive | **175** | **0** | yes | confirm the non-sensitive class list with product |
| **R-2** R-1 + P-6 consumed | 184 | 0 | yes (P-6 is monotone) | a routing decision to consume P-6 at all |
| **R-3** R-1 restricted to ≥3 occurrences | 72 | 0 | yes | whether occurrence count should modulate removal |
| R-4 single-occurrence unsupported | 15 | 0 | **no** | **nothing — forbidden.** Sized only to show the temptation |

R-1's monotonicity is the useful property: **adding any evidence can only add a reading, which removes a candidate from the population.** More evidence never makes R-1 more aggressive. R-4 is included precisely because it looks tempting and relies on absence of evidence, which is forbidden.

---

## 9. Blockers on the remaining 426

| Blocker | Candidates | Share | Occurrences |
|---|---|---|---|
| possible PERSON / privacy relevance | **165** | 38.7% | 3,077 |
| competing affirmative interpretations | 64 | 15.0% | 236 |
| extraction boundary problem | 47 | 11.0% | 549 |
| **person evidence is neighbourhood-scoped only** | 46 | 10.8% | 213 |
| insufficient semantic evidence | 35 | 8.2% | 66 |
| protective typed detection (policy) | 32 | 7.5% | 60 |
| **person evidence is component-scoped only** | 29 | 6.8% | 766 |
| organizational reading may carry privacy weight | 8 | 1.9% | 19 |

**Person accounts for 240 of the 426 remaining candidates (56%)** once the two scope-limited sub-populations are added to the 165.

The two scope-limited groups — **75 candidates** whose Person reading rests *only* on component or neighbourhood evidence — are where Person work has the most headroom. But `Perias, Nelly` sits in the component-only group with 724 occurrences and is a real person, so that headroom is not free.

---

## 10. Recommendation — single highest-value next step

**Decide what the product should do with the 175 uniquely-explained non-sensitive candidates.**

The reasoning:

- **It is the largest measurable payoff by a wide margin** — 29.1% of the review population, versus 1.5% from consuming P-6 and ~10% from extraction repair.
- **It requires no new engine work.** All 175 are already fully explained by evidence the system holds today. The engineering is routing consumption plus a product decision about the non-sensitive class list; the semantics are done.
- **It has the safety properties you want**: monotone, affirmative-only, zero labelled people, and no reliance on absence or on semantic priority.
- **The remaining question is genuinely yours, not mine** — whether `acronym` and `date-or-term` are non-sensitive in every document type DocScrub will see. I excluded `organization` on that basis; the other four are a product call.

**Second priority: extraction quality.** 63 candidates and 649 occurrences, 33 still carrying a Person reading, and 39% of the unexplained population. It is also the only category where the fix removes the *cause* rather than classifying around it.

**Explicitly not recommended next:** consuming P-6 for review-burden reasons (9 candidates), or further Person adjudication (the 75 scope-limited candidates include a 724-occurrence real person).

---

## Files

| File | Purpose |
|---|---|
| `app/investigation/review-necessity-audit.ts` | **new** — the audit: taxonomy, distribution, funnel, removal population, People audit, P-6 downstream, extraction defects, populations, blockers |

No production file was modified. No rule was proposed or implemented. No routing was touched.
