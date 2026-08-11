# Semantic Interpretation / Evidence Combination Layer — Phase A Findings

**Date:** 2026-08-10
**Scope:** multi-interpretation representation for DocScrub's semantic layer
**Status: PHASE A ONLY. No semantic rule was introduced. No existing behaviour changed.**

I stopped where the instruction said to stop if the scope got large. It did, and the measurements below argue that stopping was right rather than cautious: the most obvious Phase B rule turns out to be **wrong on 14 of 24 real people**, and that was not knowable before this pass built the thing that could measure it.

---

## 1. Existing semantic architecture — where single-type collapse happens

Collapse is not in one place. It happens **six times**, and only the first is the one everyone talks about.

| # | Site | Collapses to | Why it collapses |
|---|---|---|---|
| 1 | `semanticTypeFor(facts)` | one `SemanticTypeId` of 9 | **First-match-wins chain.** email → phone → cin → relationship-identifier → acronym → organization → dates-terms → document-titles → person → other. Any candidate matching two branches is decided by branch *order*. |
| 2 | `typeCheckSectionFor(facts, nonPersonEvidence)` | one `TypeCheckSectionId` | Already carries `rejectedType` — the system's first acknowledgment that two types can be in play — but still returns one section. |
| 3 | `buildSemanticTypeGroups` | exclusive membership | A candidate appears in exactly one Type Check card. |
| 4 | `personEvidencedCandidateIds` | a `Set<string>` | Protected or not. (`personEvidenceReasons` *does* return reasons — provenance survives here.) |
| 5 | `evaluateCandidate` (residual gate) | `review` \| `resolve` | Five sequential guards, first match wins. |
| 6 | `deriveRecommendation` | one archetype or `null` | Another first-match-wins chain. |

**The precise architectural statement:** `SemanticTypeId` has nine members and no `place`. `semanticTypeFor` returns one of them. So a candidate with affirmative Census name structure *and* affirmative GNIS place evidence has no representable answer — the function must pick, and the pick is made by where the `people` branch happens to sit in the chain. That is accidental semantic policy, and it is the thing this pass makes non-accidental.

**Two things the existing architecture already gets right**, and which this design extends rather than replaces:

- `personEvidenceReasons()` returns *which* protections fired, not a boolean. Provenance-preserving predicate evaluation already exists as an idiom here.
- `CandidateInterpretation.rejectedType` already records a hypothesis that lost. The concept of "more than one type was in play" is not foreign to this codebase.

**One thing that is genuinely well-designed and constrained the whole solution:** `semanticTypeFor` explicitly refuses to consult Census structure for classification, with the measurement recorded in the source — `Good Morning` routes to People if it does, because GOOD is an attested first name and MORNING is attested in both roles. **Protection and classification are different jobs.** That distinction is the seed of the entire signal-class model below.

---

## 2. The new interpretation model

Two new modules, `src/engines/interpretation/`:

### `interpretation-model.ts` — vocabulary and shape. No rules, no derivation.

```ts
InterpretationProfile {
  candidateId
  value                    // verbatim, never rewritten
  outcome                  // "unsupported" | "single" | "contested"
  interpretations: [
    { id, domain?, signals: [ { signalId, class, detail, provenance } ] }
  ]
}
```

`InterpretationId` has 11 members: `person`, `place`, `organization`, `domain-terminology`, `identifier`, `acronym`, `date-or-term`, `document-title`, `email`, `phone`, `ordinary-language`.

**It is deliberately NOT `SemanticTypeId`**, and the separation is load-bearing in both directions:

- `SemanticTypeId` is a **reviewer-facing routing vocabulary** — its members are Type Check cards. Adding a member changes what a reviewer sees, and adding a Place category is reserved to you.
- `InterpretationId` is an **internal analytic vocabulary** — its members are readings the evidence can support. `place` exists here because the evidence genuinely supports it, and its presence creates **no reviewer-facing category and no routing consequence whatsoever**.

Conflating them would mean either inventing UI categories to make the analysis expressible, or crippling the analysis to fit the UI. Both were available; both are wrong.

> ⚠️ **Naming hazard.** `CandidateInterpretation` already exists in `domain/semanticTypes.ts` and means the *single* section a candidate routes to. The new type is `InterpretationProfile`. The names are uncomfortably close and the difference is the entire point of the layer, so it is stated at both definitions and on the Workspace getter.

### Why there is no `counterContext` field

The prompt's sketch includes one. It was built that way first and then removed, because every candidate for that list turned out to be one of two things:

1. **An absence** — "no occurrence shows contextual person use", "not attested in any pack". A field whose natural contents are absences is a place for the absence-is-not-counter-evidence principle to be quietly violated.
2. **Affirmative support for a competing reading** — cross-candidate recurrence, ordinary-language categories, terminology attestation. Real and important, but *positive claims about something else*, and the model already has somewhere to put them.

**So: competing interpretations ARE the counter-evidence representation.** A second way to say the same thing would have been weaker and would have let absences in through the side door.

This is why `ordinary-language` is a member. "This phrase is common English vocabulary" is an affirmative observation the quality engine already makes and the residual gate already *requires* rather than infers. Giving it a home means **nothing in the system has to be modelled as a negative** — asserted structurally in §2 of the verification suite, which pins the exact field set of every profile, interpretation and signal.

---

## 3. Evidence flow — raw evidence becomes supported interpretations

`candidate-interpretation.ts` takes a flat `InterpretationFacts` record of conclusions the pipeline already published — the same idiom `person-evidence-gate.ts` and `residualReviewGate.ts` established, for the same reason: *a module that could reach back into the pipeline would grow its own classifier by increments.*

**One deliberate deviation:** `reference` takes the whole `ReferenceEvidenceChannels` value rather than pre-digested booleans. Digesting it in Workspace would put per-family knowledge back into `loadDocument` — exactly what the reference-evidence fan-out was built to remove, and a ninth family would have to edit Workspace again. The channels value is pure and reaches no engine, so passing it whole costs none of the isolation the idiom protects.

### The signal classes (Step 5) — qualitative, no numbers

A class describes **what shape of claim** the evidence makes, which is a different and more durable question than how much to trust it. Each records its **measured** failure mode as data, so the next pass inherits the finding instead of re-measuring it at the same cost.

| Class | Claim | Compositional? | Known failure mode (measured) |
|---|---|---|---|
| `detector-assertion` | The detector typed it structurally | no | Only as good as the pattern; says nothing about the referent |
| `exact-phrase-attestation` | A named authority published **this exact phrase** | no | Packs are partial, so a miss means nothing. Claims about the PHRASE, never the referent — `Doe`, `Levy`, `Judge` are legal terms *and* surnames |
| `lexicon-recognition` | A DocScrub-curated lexicon recognizes the surface | no | Coverage gaps are ours. `Chriztopher Johnson` is a real person no lexicon contains |
| `compositional-structure` | The **parts** compose into an attested pattern | **yes** | Can fire on phrases no dataset contains. `Good Morning` reads as a name structure. **20/106 on one live document** |
| `token-membership` | Tokens occur **somewhere** in a dataset of this kind | **yes** | **The weakest claim in the system.** Protects 30/30 people AND **80/106 non-people** — protecting nearly everything is the same as protecting nothing |
| `occurrence-context` | The neighbourhood of an occurrence indicates it | no | Goes ambient where neighbourhoods are uniform — `email_address_evidence` and `signature_or_email_header_context` were both falsified this way |
| `document-consistency` | The candidate behaves this way across the document | no | Needs population statistics; reports how a phrase is USED, not what it is. Fired on `Academic Senate`, `San Diego` |

**Why this beats per-family rules:** a future policy layer writes ONE rule about `token-membership` instead of seven rules about seven families — and that rule stays correct when a ninth family lands.

---

## 4. Context flow — which deterministic signals are used

No new NLP, no network, no model. Every signal is an existing engine's published conclusion:

| Source | Signals contributed | Class |
|---|---|---|
| `CandidateQualityEngine` | name lexicon, nearby-title, institutional, acronym, calendar, document-structure, ordinary-language categories | `lexicon-recognition` / `occurrence-context` |
| `contextual-person-evidence` (anchors) | `anchor_full_name_with_role`, `anchor_signature_block`, `anchor_name_with_email`, `anchor_full_name_with_organization` | `occurrence-context` |
| `contextual-person-evidence` (usage) | direct address, attribution, coordination, person-list, possessive, human subject/object | `occurrence-context` |
| `EntityResolutionEngine` | person-evidenced linkage | `document-consistency` |
| `StructuralRelationshipEngine` | acronym, numeric/alphanumeric identifier grouping | `document-consistency` |
| `cross-candidate-evidence` | token recurrence, head-noun paradigm | `document-consistency` |
| `CensusNameEvidence` | full-candidate name structure; per-token membership | `compositional-structure` / `token-membership` |
| `GnisPlaceEvidence` | place attestation + Policy B downgrade reason | `exact-phrase-attestation` |
| six terminology packs | exact-phrase attestation, per family | `exact-phrase-attestation` |
| `DetectionEngine` | email, phone, CIN, organization | `detector-assertion` |

**One modelling decision worth flagging:** cross-candidate evidence (token recurrence, head-noun paradigm) is modelled as **positive support for `domain-terminology` with `domain: "document-local"`** rather than as counter-evidence against `person`. It is an affirmative claim of the same *kind* the packs make, differing only in who attests it — the document rather than an external authority. This is what lets `Grade Rosters` and `Cost of Attendance` both carry a terminology reading. `truncated_variant` is deliberately unmapped: it reports that a phrase is a prefix of a longer one, which is a fact about extraction and supports no semantic reading.

---

## 5. Ambiguity model — two kinds of not-knowing

```
unsupported   no affirmative evidence at all              → thin evidence
single        exactly one reading supported
contested     two or more readings AFFIRMATIVELY supported → genuine ambiguity
```

These look identical in a single-type model and call for completely different handling. `outcomeFor()` is the only place outcome is computed — one line — so "ambiguity is deterministic" is a property of one function rather than of a convention.

Helpers are **functions, not stored fields** (`contestsPerson`, `contestKey`, `signalClassesOf`, `restsOnlyOnCompositionalSignals`). A stored `contestsPerson` boolean sitting on the profile is one refactor away from being read as a decision; a helper is obviously a question the caller asked.

---

## 6. Rules introduced

**None.**

Phase A introduced no `ruleId`, no threshold, no weight, no precedence, no suppression and no automatic resolution. This is asserted, not described — §9 of the verification suite fails if the derivation module ever contains `ruleId`, `AutomaticResolution`, or any of `preferred` / `primary` / `winner` / `bestReading` / `mostLikely`.

---

## 7. Behavioural deltas

**Zero.** Nothing reads a profile.

| Measure | Delta |
|---|---|
| Candidates whose Type Check interpretation changes | **0** |
| Candidates newly marked ambiguous (in the product) | **0** — ambiguity is recorded in the inert profile only |
| Candidates added to / removed from review | **0** |
| PERSON candidates affected | **0** |
| Automatic-resolution changes | **0** |
| Review-count changes | **0** |

Evidence: the full battery passes 81/81, including every parity suite — `production-parity`, `detection-parity`, `quality-parity`, `entity-resolution-parity`, `occurrence-classification-parity`, `identifier-shape-parity`, `workspace-integration`. Those pin byte-level agreement with the Python oracle, so any change to classification, scoring, grouping or routing would surface there.

### What the model *says* about real populations

Measured by `investigation/interpretation-witnesses.ts` over the 139-unit `LIVE_RESIDUE` (a real document's residue with your own person / non-person readings).

> **Scope caveat, stated because it changes how to read every number below.** The harness supplies **reference evidence only** — no quality categories, no contextual rules, no entity linkage, because those are per-document facts that do not exist outside a loaded document, and inventing plausible ones would measure the invention. The production numbers come from `__docscrub.interpret()` in the browser, which I could not run here. These figures are therefore the *reference-data-alone* view.

| Outcome | Units | truth: person | truth: non-person |
|---|---|---|---|
| `single` | 56 | 27 | 29 |
| `unsupported` | 81 | **3** | 75 |
| `contested` | 2 | 0 | 2 |

The two contested units are `San Diego` and `San Marcos` — both `person + place`, both non-people. Exactly the PERSON×PLACE collision the GNIS audit predicted, arriving in a real document.

---

## 8. Safety analysis

### ⚠️ The finding that should decide Phase B

The most obvious Phase B rule is *"a person reading resting only on token-membership may be demoted."* It is the rule the whole class system seems to invite. **The measurement says it is wrong.**

| Person readings resting **only** on `token-membership` | 24 |
|---|---|
| …that you read as **real people** | **14** |
| …that you read as non-people | 10 |

The 14: `Andrew`, `Tamara`, `Margaret`, `Tanesha`, `Nelly`, `Patrick`, `Joan`, `Gustavo`, `Julie`, `Diana`, `Sarah`, `Christopher`, `Giancarlo`, `Vince`.
The 10: `New Student`, `First Fight`, `Last Date`, `Stern Mass`, `Class Level`, `Tanesha,   Any`, …

**Token membership does not separate people from non-people at all — 14 vs 10 is a coin flip.** A demotion rule keyed on that class alone would cost fourteen real people to remove ten pieces of noise. In a privacy product that is not a close call.

(In production those bare first names would also carry `known-first-name` lexicon categories, so the *population* shrinks — but the class's discriminating power is what was measured, and it is near zero either way.)

### The existing Census coupling is unchanged and still directional

`hasCensusNameStructure` still feeds the person-protection gate, still reads **structure and never token membership**, still only ever *adds* protection. §10 of the verification suite asserts both directions: that token membership confers no gate protection, and that the new `token-membership` signal did **not** leak into the gate — `Major` carries the signal in its profile while the gate grants it nothing.

### Nothing can suppress a person reading, structurally

There is no mechanism in Phase A that could remove a reading. §2 of the witness harness demonstrates it empirically across three overlays: **every added signal ADDS a reading; none removes one.**

Asserted for the two populations that matter most:

- **Terminology never removes person** — `Levy`, `Major`, `Claim`, `Appeal`, `White` all keep both readings.
- **Strong GNIS never removes person** — `ABE YARBROUGH`, `ABRAMS WAY`, `ABRAHAM ACRES`, `AARONS CREEK` all come back `contested`, never resolved. This protects the 35,174-key population the audit measured.

### The population a review product must not quietly drop

81 units are `unsupported` under reference evidence alone — and **3 of them are real people**, including `Perias, Nelly` (724 occurrences) and `Chriztopher Johnson`. Reference data cannot see them at all. This is the concrete argument for why `unsupported` must never be treated as "probably not important": it is thin evidence, not a finding.

---

## 9. Ablation — what each family actually contributes

Channels selectively silenced by replacing each with its own "found nothing" shape (never by editing a dataset), re-derived over the same 139 units:

| Config | unsupported | single | contested | person readings | person via **token-membership only** |
|---|---|---|---|---|---|
| no reference evidence | 84 | 55 | 0 | 55 | **55** |
| Census only | 82 | 57 | 0 | 57 | **24** |
| GNIS only | 84 | 53 | **2** | 55 | 55 |
| terminology only | 83 | 56 | 0 | 55 | 55 |
| all eight (shipped) | 81 | 56 | **2** | 57 | **24** |

Three results worth reading carefully:

1. **Census's real contribution is a change of CLASS, not of count.** It adds 2 person readings — but moves 31 from `token-membership` to `compositional-structure`. A vote-counting model would have scored Census as worth ~2 and missed the actual value entirely. This is the single best justification for the class model.
2. **GNIS is the only source of contest on this document** — 2 units, both correct (`San Diego`, `San Marcos`).
3. **Terminology contributes almost nothing here — one unit.** On a higher-education registrar document. That is surprising and I am reporting it rather than explaining it away: the residue's institutional vocabulary (`Grade Rosters`, `Academic Senate`, `Term Withdrawals`, `Smart Planner`) is **document-local phrasing that no pack attests as an exact phrase**. For this class of document, cross-candidate document-local evidence looks more valuable than the packs. That is a Phase B input, not a criticism of the packs.

---

## 10. Performance

| Measure | Value |
|---|---|
| Derivation only | **4.22 µs / candidate** |
| Derivation + channel fan-out | 21.8 µs / candidate |
| 569-candidate derivation | **2.4 ms** |
| 2,000-candidate derivation | 8.4 ms |

Computed once per candidate in `loadDocument` and stored in a Map. **Navigating between review items recomputes nothing** — asserted structurally in §9 of the verification suite: `interpretCandidate` has exactly one call site in `src/`, and the accessor has exactly one caller.

The computational shape is `unique candidates × bounded interpretation work`, as required.

> One honest note: the audit measured `referenceEvidenceFor` at 4.79 µs on a mixed 33-phrase sample; here the same call costs ~17 µs on the residue population, which is multi-token-heavy and exercises the terminology normalizers harder. Still negligible — 569 candidates end-to-end is ~12 ms — but the earlier figure was optimistic for this shape of input and should not be quoted as universal.

---

## 11. Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **PASS**, zero errors |
| `npx tsc` (production build) | **PASS**, zero errors |
| Full battery (83 files; 81 runnable suites) | **81 / 81 PASS, 0 FAIL** |
| Parity suites specifically | all 7 **PASS** |
| New: `verify/candidate-interpretation-verification.ts` | **PASS** — 11 sections |
| Collision investigation | ran clean |
| Witness harness + ablation | ran clean |

The new suite covers all twelve required properties: multiple interpretations survive (§1); absence never becomes counter-evidence (§2, asserted *structurally* by pinning the exact field set); terminology never suppresses person (§3); strong GNIS never suppresses person (§4); channel count determines nothing (§5, plus a scan proving no score/weight/confidence/rank/winner field exists); provenance survives (§6); ambiguity is deterministic (§7); identical inputs produce byte-identical profiles (§8); no recomputation on navigation and no production consumer (§9); person-protection pinned (§10); existing semantic behaviour unchanged (§10); no Phase B rules exist (§9).

### Two existing suites required updates — and that is the contract working

Adding a consumer of the reference-evidence fan-out broke the allow-list assertions in `employment-hr-evidence-verification.ts` and `reference-evidence-inertness-verification.ts`. **Neither was weakened.** Both were updated to name the new consumer explicitly, with the reason recorded inline. That friction is exactly what those literal allow-lists were written for last pass — an unintended consumer would have failed the same way.

I also had one test expectation of my own that was wrong: I predicted `Levy`'s person reading would carry three signal classes; it carries four, because `Levy` is a single Census-attested token so `token-membership` fires alongside. **The code was right and my expectation was wrong** — I corrected the expectation and noted why in the suite.

---

## 12. Representative determination paths

**PERSON + terminology** — `Major`
```
raw evidence     Census: MAJOR attested as a name token
                 higher-ed pack: "Major" attested, HIGH collision risk
supported        person                    ← token-membership
                 domain-terminology[higher-ed]  ← exact-phrase-attestation
outcome          contested
Phase A action   none
```

**PERSON + GNIS** — `ABE YARBROUGH`
```
raw evidence     GNIS: attested populated-place, strength strong
                 Census: ABE first-attested, YARBROUGH surname-attested
supported        person   ← compositional-structure, token-membership
                 place    ← exact-phrase-attestation
outcome          contested
note             one of 35,174 keys in this population. Both readings survive.
```

**Cross-domain terminology** — `Appeal`
```
supported        domain-terminology[employment-hr]   ← exact-phrase-attestation
                 domain-terminology[finance-tax]     ← exact-phrase-attestation
                 domain-terminology[legal]           ← exact-phrase-attestation
outcome          contested — three readings, no person reading
note             three separate entries, not one merged terminology entry
```

**Unambiguous PERSON** — `Yazmine Guzmán`
```
supported        person ← compositional-structure (first-surname)
outcome          single
```

**Unambiguous domain terminology** — `Cost of Attendance`
```
supported        domain-terminology[higher-ed] ← exact-phrase-attestation
outcome          single
```

**Genuine unresolved ambiguity, from a real document** — `San Diego`
```
raw evidence     GNIS: attested place, strong
                 Census: SAN + DIEGO compose into a name structure
supported        person ← compositional-structure, token-membership
                 place  ← exact-phrase-attestation
outcome          contested
your reading     non-person
note             nothing in Phase A knows that, and nothing pretends to
```

**Thin evidence, not ambiguity** — `Chriztopher Johnson`
```
raw evidence     none — no lexicon, no Census (unusual spelling), no pack
supported        (nothing)
outcome          unsupported
your reading     person
note             the distinction that matters: this is silence, not a finding.
                 A product that treats unsupported as "probably fine" loses this person.
```

---

## 13. Remaining questions — what Phase B must decide rather than guess

These are yours to decide; I have deliberately not guessed at any of them.

1. **Is any demotion permitted at all?** The measurement in §8 says the obvious candidate rule (`token-membership` only ⇒ demote) is wrong at a ~58% cost in real people. The safe-asymmetry principle you raised in Step 7 — *evidence can increase reviewability more easily than eliminate it* — survives this pass **unfalsified and unconfirmed**. It is consistent with everything measured, but nothing measured requires it. It deserves an explicit decision rather than inheritance by plausibility.

2. **What does `contested` mean to a reviewer?** The model can now say "two readings are affirmatively supported." Type Check routes to exactly one card. Options: a contested badge on the existing card; a dedicated section; Expert View only; nothing at all. This is a UX question about cognitive load, and it is yours — it is also the one place where adding a reviewer-facing concept is unavoidable if contested is to mean anything.

3. **Does `place` ever become a Type Check category?** Reserved to you (§19.4). The interpretation layer needs no such category to function, and Phase A deliberately created none.

4. **Which contests are worth surfacing?** `person+place` is 2 units on this document. `domain+domain` (three legal/finance/HR terms) involves no person and is arguably not worth a reviewer's attention at all. A policy that surfaces every contest equally would add noise; one that surfaces only person-contests is a defensible first cut — but that is a decision, not a derivation.

5. **Does document-local evidence outrank the packs for institutional vocabulary?** §9 says terminology contributed **one unit** on a higher-ed document while the residue was full of document-local institutional phrasing. If that generalises, cross-candidate evidence is the more valuable channel for this document class, and the packs' value is concentrated elsewhere. Worth confirming on a second document before acting.

6. **Should reference evidence reach the exported audit?** It still does not (pinned). Once anything influences a decision, the determination path should probably appear in the audit — but wiring it before that point changes output for no reader's benefit.

7. **The production numbers are not in yet.** Every figure in §7–§9 is the reference-data-alone view. `__docscrub.interpret()` gives the real distribution with lexicon, context and linkage in play, and needs a browser run on a real document. **That is the single highest-value next action, and it costs one document load.** It is also the same browser-validation blocker that is open elsewhere.

---

## 14. Files

| File | Purpose |
|---|---|
| `app/src/engines/interpretation/interpretation-model.ts` | **new** — vocabulary, signal classes, profile shape, read-only helpers |
| `app/src/engines/interpretation/candidate-interpretation.ts` | **new** — the derivation. Pure, facts-in, no rules |
| `app/verify/candidate-interpretation-verification.ts` | **new** — the Phase A contract, 11 sections, in the battery |
| `app/investigation/interpretation-witnesses.ts` | **new** — witness sets, live residue, ablation, performance |
| `app/src/workspace/Workspace.ts` | +`interpretationProfiles` map, getter, one derivation loop. Reads nothing back |
| `app/src/ui/app.ts` | +`__docscrub.interpret()` diagnostic |
| `app/verify/reference-evidence-inertness-verification.ts` | allow-list updated for two new importers, with reasons |
| `app/verify/employment-hr-evidence-verification.ts` | same allow-list assertion updated, with reason |

---

## Success criterion

DocScrub has moved from being able to ask only

> *"What single semantic type wins?"*

to being able to ask

> *"What interpretations are supported, by what evidence, of what claim-shape, and how confident should anyone be about acting on that?"*

It does **not** yet act on the answer. Given that the first rule anyone would have written turns out to be wrong on fourteen real people, not acting yet is the finding rather than the limitation.
