# Quick Approval / Exception Scanning — Findings

**Date:** 2026-08-10
**Population:** the real 601-candidate browser export, 5,843 occurrences
**Status:** shipped behind an Item Check offer row. Typecheck, build, 84 verification suites and ui-smoke (199/199) all pass.

**Headline: two high-purity cohorts form on the real document — 51 + 31 = 82 of the 426 active candidates (19.2%). No People group is supportable, and that is the most important finding here.**

---

## 1. Current evidence / grouping substrate found

| Layer | File | What it gave this pass |
|---|---|---|
| Multi-interpretation model | `engines/interpretation/interpretation-model.ts` | `InterpretationId`, `SignalClass` + measured failure modes, `EvidenceLineage`, `outcome` |
| Profile derivation | `engines/interpretation/candidate-interpretation.ts` | one `InterpretationProfile` per candidate, computed once in `Workspace.ts` |
| Review triage | `engines/review/reviewNecessity.ts` | `Unlikely`, `NON_SENSITIVE_INTERPRETATIONS`, `PROTECTIVE_DETECTED_TYPES` |
| Bulk decisions | `domain/Commands.ts` → `bulkApplyDecision` | one decision over an explicit id list, per-candidate events + one summary, `scope?` stamp |
| Zone | `ui/reviewZone.ts` | bulk scoping **by position** (24), `zonePartition` prepared but not switched on |
| Scope | `ui/reviewScope.ts` | the single-consumer scope resolver and `scopeDescriptor` grammar |
| Structural defects | `engines/detectors/truncationDiagnostics.ts` | `severed` / `block-boundary` / `token-ceiling` / `source-literal`, console-only until now |

Two things the audit turned up that shaped everything after:

- **`domain-terminology` is almost entirely `document-local`.** The eight bundled reference packs account for ~9 of the 51 terminology-bearing candidates; higher-ed contributes 2 signals out of 192 in the Unlikely population. There is no evidence basis for an "Educational Terms" group.
- **`Unlikely` already encodes the exact shape a cohort needs** — affirmative explanation *plus* no surviving Person reading. Quick Approval's groups are the same shape with the uniqueness requirement relaxed, which is why they need a human and Unlikely's population does not.

## 2. Proposed-group model

`src/engines/review/proposedGroups.ts` — pure, DOM-free, no persistence.

```
ProposedGroup
  id            explained-vocabulary | named-organizations
  descriptor    label, claim, supportsChangeAll
  members[]     candidateId, value, occurrenceCount,
                structurallyDefective, supportedReadings[]
  structurallyDefectiveCount
```

Recomputed on every consult from the interpretation profiles, exactly like `reviewZone`. Nothing is serialized. Membership creates no decision, no `AutomaticResolution`, no `SemanticTypeId`, no audit claim.

`proposedGroupFor()` is total and deterministic. It returns `null` for 344 of 426 active candidates — that is the design working, not a shortfall.

## 3. Groups produced on the real population

| Group | Members | Occurrences | Labelled | Real people among them |
|---|---|---|---|---|
| Explained vocabulary | **51** | 206 | 1 | **0** |
| Named organizations and systems | **31** | 70 | 0 | **0** |
| **Total grouped** | **82 / 426 (19.2%)** | 276 | | **0** |

Sample of *Explained vocabulary*: `FYI`, `CSU`, `IHE`, `PRD`, `Grade Rosters`, `Grade Processing`, `Term Activation`, `Spring Semester`, `Fully Online`, `Service Indicator Codes`, `Schedule Planner`, `Hello Everyone`.

Sample of *Named organizations and systems*: `Canvas`, `ServiceNow`, `SharePoint`, `Instructure`, `Google Drive`, `UAchieve`, `RegCal`, `MyCalStateLA`, `University Registrar`, `Enrollment Management`, `Records Outbox`.

## 4. Evidence basis for each

**Explained vocabulary** — every supported reading is non-sensitive, and there are ≥2 of them:

| Reading signature | Members |
|---|---|
| domain-terminology + ordinary-language | 27 |
| acronym + ordinary-language | 10 |
| date-or-term + domain-terminology | 4 |
| document-title + domain-terminology | 3 |
| date-or-term + ordinary-language | 3 |
| acronym + domain-terminology | 2 |
| three-reading combinations | 2 |

Signal classes doing the work: `lexicon-recognition`, `document-consistency`, `exact-phrase-attestation`. These are the whole-phrase and document-level classes — **no member of either group rests on `compositional-structure` or `token-membership` alone**, which is precisely the distinction that kills the People cohort below.

**Named organizations and systems** — an `organization` reading, no Person, no Place:

| Reading signature | Members |
|---|---|
| domain-terminology + organization | 12 |
| organization | 9 |
| domain-terminology + ordinary-language + organization | 6 |
| ordinary-language + organization | 4 |

`organization` is deliberately *not* in Unlikely's non-sensitive set — a named organization can be privacy-relevant — which is exactly why these are good cohort material for a human rather than candidates for silent triage.

### The two rejected cohorts, and why

| Candidate rule | Members | Labelled | People | Non-people | Verdict |
|---|---|---|---|---|---|
| `person` is the only reading | 73 | 46 | 14 | 32 | **30% purity — rejected** |
| `ordinary-language + person` | 107 | 17 | 16 | 1 | **rejected despite 94%** |

The first fails on its own labels: `Dear Student`, `End Time`, `High School`, `Last Day`, `Go Live`, `Pacific Standard Time`, `Reason Code` sit among the people. The cause is structural rather than fixable — a person-only profile is usually a profile carrying *nothing but* Census `compositional-structure` and `token-membership`, the two weakest classes in the model, failing in exactly the ways `interpretation-model.ts` already documents.

The second scores 94% on labels **and is worse**, which is why the harness prints the unlabelled remainder rather than the headline: only 17 of 107 carry a label, the labels come from a person-focused residue pass, and the unlabelled 90 are `Like` (282 occ), `Thank` (217), `The` (60), `Begin`, `Good`, `Yes`, `That`, `Please`. A purity figure over a biased subset is an upper bound, not a measurement.

**Note what is *not* concluded:** nothing here says those 180 candidates are not people. They are simply not a cohort a human can scan, and they go to ordinary individual review untouched. Absence of Person evidence never puts anything into a group — it only ever keeps something out.

## 5. Overlap / contested policy

**There is nothing to arbitrate.** The two predicates are mutually exclusive by construction — `named-organizations` requires an `organization` reading and `explained-vocabulary` forbids one — so no candidate can support both and `proposedGroupFor` returns at most one group without consulting any precedence. Verified exhaustively over all 511 non-empty reading combinations, and measured as 0 overlaps on the real population.

No group-ranking engine was built, and a third group must either be provably disjoint from these two or arrive with its own measured policy. A silent priority order is the failure mode that note exists to prevent.

## 6. Candidates left ungrouped — 344 of 426

| Reason | Count |
|---|---|
| a Person reading survives | 273 |
| unsupported — no affirmative evidence at all | 39 |
| protective typed detection (email / phone / CIN / long numeric id) | 32 |

Plus, by construction: candidates with exactly one non-sensitive reading (175) are already held out by `Unlikely` and never reach this surface.

## 7. The list UI

Dense list, two columns above 60rem, filled column-major. Each row carries **only**:

```
•  Grade Rosters                        ⚠   11
↑  value                          defect   occurrences
```

No Sources, no All Occurrences, no Expert View, no per-row K/C/R/I, no evidence paragraphs. The supported readings for the *focused* row appear as one line under the list — available without competing with the values for attention.

**No decision hue anywhere on the surface.** The decision colour system reserves red/blue/green/purple for Redact/Change/Keep/Ignore, and an exclusion is not a decision — tinting an excluded row red would say Redact and green would say Keep, and a reviewer might act on either. An exclusion is therefore drawn struck-through and dimmed: "not part of this set", with no hue claim. Focus is a ring, never a fill. The one non-neutral mark is the `--warn` defect glyph, which reports a defect rather than a verdict.

## 8. Keyboard behaviour

| Key | Effect |
|---|---|
| ↑ / ↓ | move focus only; membership untouched; **clamped, never wrapped** |
| Home / End | first / last row |
| **Space** | toggle the focused row, then advance one. Toggles an excluded row back in. |
| **Option+Enter** | finish the exception-scanning phase |
| bare Enter | **refused with a narration** — "Press Option+Enter to finish the scan." Never falls through. |
| Escape | `deciding` → `scanning` (exclusions preserved); `scanning` → leave, applying nothing |
| K / R / I (deciding phase only) | apply that action to the included members |
| C (deciding phase) | refused *with its reason*, not silently ignored |
| Tab | falls through, so the Done/apply buttons are reachable |
| everything else | swallowed — no key reaches the queue behind the scan |

Clamping rather than wrapping is deliberate: reaching the bottom is how the reviewer knows they are finished, and a list that wrapped would let someone scan silently past the end and start again. Option+Enter costs discoverability and buys the one thing that matters — completing a 65-item scan cannot happen by reflex. The Done button carries the chord in its tooltip.

Mouse parity: clicking a row toggles it and parks the cursor there (no advance — a click already said where the reviewer is looking).

## 9. Exception semantics

Excluding `Jeffrey Lam` from *Explained vocabulary* means **exactly one thing**: he was rejected from this proposed group. Not that he is a Person. Not that he belongs anywhere else. No `CandidateDecision`, no `AutomaticResolution`, no reclassification.

The reviewer is never asked why. Asking would convert a one-keystroke exception into a dialog, fifty times over, for information DocScrub has no use for. Excluded candidates return to the remaining review population exactly as they were.

## 10. Scan → group decision

`Option+Enter` / Done moves the phase from `scanning` to `deciding` **and does nothing else**. No Keep, no Change, no Redact, no Ignore, no acceptance. The decision is a separate explicit act, and Escape backs out of it with every exclusion intact.

```
Explained vocabulary
51 proposed · 48 included · 3 excluded
Apply to 48:   [Keep as-is]  [Redact]  [Ignore]
```

There is no "confirm these are vocabulary" step. The bulk action *is* the confirmation — the reviewer came to make privacy decisions, not to do QA for DocScrub.

## 11. Bulk actions available / suppressed

| Action | Explained vocabulary | Named organizations | Reason |
|---|---|---|---|
| Keep as-is | ✅ | ✅ | coherent over a cohort |
| Redact | ✅ | ✅ | no replacement supplied → each candidate gets its own type-appropriate placeholder, a *per-candidate* default |
| Ignore | ✅ | ✅ | coherent over a cohort |
| **Change** | ❌ **suppressed** | ❌ **suppressed** | see below |

**Change is suppressed by a rule, not a judgement call.** `bulkApplyDecision` requires one shared `replacement` string for Rename, and `flattenGroup` can supply one only because an entity group is **one referent** with a canonical name. A ProposedGroup is never one referent — it is distinct surface forms sharing an evidence shape. Replacing `Canvas`, `ServiceNow` and `SharePoint` with a single string is not a coarse action, it is a wrong one. Carried as a per-group `supportsChangeAll` flag so a future group that *is* one referent can say so.

Change is **absent rather than disabled** — a disabled control invites the reviewer to wonder what would enable it, and nothing would. Pressing `c` narrates the reason.

Redact deliberately opens no inline editor, unlike Redact everywhere else. It does not need one: the per-candidate placeholder default is exactly the property Change lacks, and `redactGroup` already relies on it.

## 12. Interaction with `Unlikely`

**Unchanged. Not widened, not narrowed, not re-derived.** `reviewNecessityFor` is untouched; `review-necessity-verification.ts` passes unweakened.

```
Unlikely              → held out of ordinary review        175
Quick Approval        → still needs a human decision,       82
                        but can share it with a cohort
Individual review     → genuinely needs per-item attention 344
```

`proposedGroups.ts` imports `NON_SENSITIVE_INTERPRETATIONS` and `PROTECTIVE_DETECTED_TYPES` from `reviewNecessity.ts` rather than restating them — "non-sensitive" and "never triaged away" must mean one thing in this application. A candidate with exactly one non-sensitive reading is explicitly *not* offered here, because Unlikely already gives it a stronger home.

## 13. Interaction with the Zone

**No coupling. Zero.** Quick Approval reads no Zone state, calls no Zone function (`headingActionScope`, `zonePartition`, `reviewZone`, `ZONE_CAPACITY` — all absent, asserted with comments stripped so the assertion is about code and not documentation), and shares no cursor with the sectioned queue. It takes the unresolved Item Check pool, freezes a cohort, and hands `bulkApplyDecision` an explicit id list.

The two bound bulk actions differently on purpose: the Zone bounds **by position** (the next 24) to keep bulk review honest; Quick Approval bounds **by evidence** (a cohort the engine can name). Those are different safety arguments, and a scan whose membership changed as Zone chunks retired underneath it would be neither — which is why the scan freezes membership on entry.

**The one integration point, reported rather than built:** when the Zone work lands, someone should decide whether a proposed group should *also* be reachable as a section in the sectioned queue. That is a product decision about where the mode is entered from, not an architectural dependency, and it is deliberately not taken while the queue is moving.

`Split` is likewise untouched — no import, no reference, Stage 2 integration not attempted.

## 14. Audit / state representation

Five states, all distinguishable:

| Fact | Where it lives |
|---|---|
| engine proposed candidate as a member | `session.members` (frozen at entry) |
| reviewer left candidate included | `members` ∖ `excludedIds` |
| reviewer explicitly excluded candidate | `excludedIds` |
| reviewer completed scanning | `phase === "deciding"` |
| final bulk action applied | one `bulkApplyDecision` over the included ids |

Durably, the action carries:

```
scope: item-check/quick-approval:explained-vocabulary:proposed=51,included=48,excluded=3
```

`candidateIds` names the included set exactly. Excluded candidates receive **no command, no decision and no mention** — which is the correct representation of a scan artifact, and is why exclusion can never be confused with Ignore.

**One honest gap, for your call.** The durable record carries the excluded *count* but not the excluded *ids*. Recovering them would mean recomputing the proposal, which depends on the resolved set at scan time and so is not reliably reconstructible later. The clean fix is a new event-only command following `suggestionsAccepted`'s exact precedent (counts, no `candidateDecisions` touched) — I did not add one, because it means touching `Commands.ts` and the shared reducer while the Zone work is in flight, and the in-session model already distinguishes all five states. Say the word and it is a small, well-precedented addition.

## 15. Verification results

```
verify/quick-approval-verification.ts     76 passed, 0 failed
all verification suites                   84 / 84 passed
verify/ui-smoke.ts                        199 / 199 passed
npx tsc --noEmit                          clean
npx tsc (build)                           clean
```

Every invariant from the brief is pinned:

- proposed groups require affirmative support · unsupported candidates are never forced in · protective detections excluded · a Person reading disqualifies every group · monotone (more evidence only ever removes)
- overlap impossible across all 511 reading combinations · at most one group id ever returned
- the real population: 601 → 175 Unlikely → 426 active → 51 + 31 = 82 grouped, 0 with a Person reading, 73 person-only candidates *not* offered
- all rows begin included · ↑/↓ change focus only · Space toggles and advances by exactly one · Space toggles an excluded row back in · nine rapid Spaces toggle nine distinct rows, none twice, none skipped · the clamped cursor still toggles
- mouse toggle matches keyboard · toggling a non-member is a no-op
- Option+Enter completes · bare Enter does not · Done matches Option+Enter · Escape applies no decision · Escape from `deciding` preserves exclusions
- the session has nowhere for a decision to live · completing a scan is idempotent
- the final action reaches only the included · excluded ids are absent from the command · included + excluded reconstruct the proposal losslessly
- the existing `bulkApplyDecision` is reused — no second K/C/R/I implementation · no `AutomaticResolution` · no Zone function consulted · no Split machinery touched · no Unlikely predicate redefined

Two pre-existing architectural allowlists failed on first run and were updated **with reasoning rather than silently**: `candidate-interpretation-verification.ts` (importers of the interpretation model) and `review-necessity-verification.ts` (consumers of review necessity). Both now name `proposedGroups.ts` and say why it is the same *kind* of consumer as `reviewNecessity.ts` — a triage question, not a semantic one — so a *third* arrival still gets noticed.

**Structural defects (§13 of the brief).** The existing `truncationDiagnostics` classifier is now wired into the row: a candidate with any DocScrub-produced span defect renders a `⚠`. It does **not** affect membership. Whether such candidates should be excluded could not be measured — the interpretation export carries no occurrence context — so the conservative reading was taken: the defect stays visible (more visible than individual review makes it today) and costs one Space to act on. Revisit with a measurement, not an opinion.

## 16. Files changed

**New**

- `app/src/engines/review/proposedGroups.ts` — the grouping engine
- `app/src/ui/quickApproval.ts` — the scan state machine
- `app/verify/quick-approval-verification.ts` — 76 checks
- `app/investigation/proposed-group-population.ts` — the measurement harness

**Modified**

- `app/src/ui/app.ts` — offers row, list-mode surface, key gate, group-decision dispatch, memoized structural-defect lookup
- `app/index.html` — Quick Approval styles (no decision hue)
- `app/verify/candidate-interpretation-verification.ts` — importer allowlist + rationale
- `app/verify/review-necessity-verification.ts` — consumer allowlist + rationale

---

## Open questions for Andrew

1. **Is 19.2% worth a second mode?** 82 candidates → 2 scans + 2 decisions, against 82 individual reviews. I think yes, but it is a smaller prize than the brief anticipated, and the reason is that the packs contribute almost nothing — worth knowing before more are commissioned.
2. **`MIN_PROPOSED_GROUP_SIZE = 8`** is a UX threshold I chose, not a measured one. Below it, mode-entry overhead exceeds deciding in place.
3. **No chunking was built.** Both groups fit one scan. A different document could produce a 200-item vocabulary group; I declined to build untested paging for it.
4. **The excluded-ids audit gap** in §14 — new event-only command, or leave it at counts?
5. **Entry point placement** — currently an offer row above the Item Check toolbar. Whether a group should also be a section in the sectioned queue is the deferred Zone question.
