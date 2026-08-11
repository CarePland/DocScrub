# Zone Processing, Turnover and Stable Ordering

**Date:** 2026-08-10
**Result: a third Zone rhythm, `rolling`, implemented and switched on. 87/87 suites green, typecheck and build clean.**

The fix turned out to be smaller than expected because the architecture had already prepared for it — `zonePartition(cells, isResolved, rhythm, …)` existed as a one-line switch point, deliberately left unwired pending your approval.

---

## 1. Current ordering behaviour discovered

### The sort keys, and where they are applied

| Layer | Order | Where |
|---|---|---|
| Section order | `TYPE_CHECK_SECTION_ORDER` — high-certainty categories lead, Other then Undetermined last | `semanticTypes.ts` |
| Candidate pool | `reviewableItemIdsForStage("item-check", …)`, widening to the full inventory when the reviewer asks for decided work | `itemCheckPoolIds` |
| **Within section** | `queryItemCheck` → `compareCandidates`, default `confidence-desc`, **always tie-broken on `candidate.id`** | `itemCheckQuery.ts` |
| Unlikely hold-out | excluded unless the preset is active — one exclusion point | `queryItemCheck` |
| Zone construction | `zonePartition(…, SECTIONED_QUEUE_RHYTHM, …)` | `zonePartitionForGrid` |
| Navigation order | `visibleItemCheckIds` → the same `queryItemCheck` result | `app.ts` |
| Post-decision advance | traverses the unresolved subsequence, deliberately zone-unaware | `partitionByZone` doc |

**There is already a deterministic canonical order with a stable final tiebreaker** (`candidate.id`). It is not accidental, and I did not replace it — see §2.

### ⚠️ The actual defect

**Both existing rhythms leave decided rows where they are.**

- **`conveyor`** (what Item Check was using) retires a 12-cell chunk only when *every* cell in it is resolved. A half-finished chunk keeps its decided rows scattered through the working area — and a completed pair straddling two chunks retires **nothing at all**.
- **`compacting`** has the same symptom for a different reason: `partitionByZone` returns `cells.slice(0, endIndex + 1)`, so resolved cells stay interleaved inside the band.

That is precisely *"newly decided rows scattered throughout the working area."*

---

## 2. Canonical sort policy chosen

**Unchanged.** The existing policy — section order, then `confidence-desc` within section, then `candidate.id` as final stable tiebreaker — is already deterministic and reproducible, and the prompt says not to replace a useful ordering merely because sort policy is under discussion.

The problem was never the canonical sort. It was that the Zone rhythm mixed completed and active work inside the window. So this pass changes the **working window**, not the home order.

---

## 3. Zone state model — and why there is none

The prompt asks for `canonicalOrder` + `transientZoneOrder`. **I implemented the separation without the transient state**, and I think that is strictly better:

```
active = the first `size` UNRESOLVED cells, in canonical order
rest   = the remaining unresolved cells, then every resolved cell
```

A pure function of *(canonical cells, resolved set, size)*, recomputed on every consult.

**Canonical order cannot be rewritten by Zone interaction, because Zone arrangement is never stored.** "Items keep their home position" stops being a rule anyone has to obey and becomes a property of the shape. This also matches the existing `reviewZone` design's "derive, don't duplicate" property, which is how the Zone already survives save/resume without a persisted cursor.

---

## 4. Turnover algorithm

Deciding a cell changes only the resolved set. The next consult therefore yields:

```
before   A  B✓ C✓ D  E✓ F  G  Y  Z  AA        (zone size 6)
active   A  D  F  G  Y  Z
                ↓ decide D
after    A  F  G  Y  Z  AA   |   B✓ C✓ D✓ E✓
         └── fresh work rose ──┘   └ settled, canonical order ┘
```

Zone stays at target size; four completed cells settled; four fresh unresolved rose.

---

## 5. Eligible incoming item

An incoming cell must be **unresolved**, and must already be in the grid the current section/filter/preset produced. Replenishment reads that grid and cannot reach past it, so it can never bypass the current query to reach 24.

---

## 6. Contiguous-run behaviour — and a finding worth flagging

`contiguousCompletedRun(displayOrder, isResolved, decided)` returns the maximal contiguous completed run containing the acted-on cell, preserving relative order. A completed cell separated by unresolved work does **not** join it.

**⚠️ But the run turned out not to be needed for *ordering*.** A retirement rule expressed over the current arrangement and the derived rule reach the **same resting arrangement**: previously-retired cells are already at the tail, so a newly completed run simply joins them, and canonical order within the retired region is deterministic either way.

Where the run genuinely matters is **motion** — which cells pulse and travel together as one group, so `B C D E` move as a unit instead of `D` teleporting and stranding its neighbours. Keeping it out of the ordering rule is what lets the ordering be verified without a browser.

---

## 7. Returning to canonical home

**No reset path is required, because nothing is stored.** Every case in §8 of your prompt — leaving and re-entering a section, changing section, changing filters/presets, changing sort, document reload, stage navigation — rebuilds the grid and recomputes the partition from canonical order. Verified: `roll(cells, ∅).ordered === cells`.

**No "Reset Zone" control was added.** It would exist only to compensate for state that does not exist.

---

## 8. Pulse and focus

**Reused, not rebuilt.** `acknowledge()` / `isAcknowledged()` is already the single choke point every decision path goes through, `.row-acknowledged-pulse` is a 0.7s animation, and `@media (prefers-reduced-motion: reduce)` already disables it. No second animation system was introduced.

Focus is unaffected: `FocusNavigator.reconcile()` already advances synchronously on dispatch, and the advance traverses the **unresolved subsequence**, which §6 of the verification proves is identical before and after turnover.

---

## 9. Rapid-keyboard safety

The partition depends only on *which* cells are resolved — never on arrival order, and never on an animation having finished. Verified: deciding the same six cells in **reverse order** yields a byte-identical final arrangement.

Because the advance sequence is unchanged by turnover, the next keystroke cannot land on the wrong cell, navigation cannot skip a candidate, and the zone cannot drift from its target size.

---

## 10. Filters and Unlikely

Untouched. Unlikely remains excluded by default and revealed by its preset, and turnover operates on whatever grid the current section/filter/preset produced. Changing a filter rebuilds the grid, which rebuilds the Zone from canonical order.

---

## 11. Sorting UI

**None added, deliberately.** A sort selector already exists in List view; the canonical default is already deterministic. Your stated primary requirement was to establish and preserve a canonical home order beneath transient processing — that is done, and adding sort controls would be scope creep.

---

## 12. Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` / production build | **PASS** |
| Full battery (89 files; 87 runnable suites) | **87 / 87 PASS** |
| `rolling-zone-verification.ts` (new, 10 sections) | **PASS** |
| Existing `review-zone-verification.ts` | **PASS** — conveyor and compacting unchanged |

All behavioural, no source scans. Covers: initial zone is the first 24 in canonical order · fresh work rises and completed settles · **no resolved cell ever enters the active zone**, including when the entire tail below is resolved · contiguous runs incl. edges, isolation and absent cells · canonical array untouched by any amount of turnover · ordered is a permutation with nothing dropped · **the unresolved subsequence is unchanged by turnover** · order-independent determinism under rapid decisions · 24 when work remains, graceful shrink, fully-completed and empty sections, size clamping · `zonePartition` delegation and both older rhythms preserved · no decision created or altered.

**One test expectation of mine was wrong and I corrected the test, not the code:** I expected the conveyor to retire `B,C`, but with chunk size 2 the chunks are `[A,B] [C,D] [E,F]`, so a completed pair straddling two chunks retires nothing. That is now pinned as two cases, because it is exactly the scattering defect rolling exists to fix.

---

## 13. Files changed

| File | Change |
|---|---|
| `app/src/ui/reviewZone.ts` | + `"rolling"` rhythm, `rollingQueuePartition`, `contiguousCompletedRun`; existing rhythms untouched |
| `app/src/ui/app.ts` | **one line** — `SECTIONED_QUEUE_RHYTHM: "conveyor"` → `"rolling"`, plus its rationale comment |
| `app/verify/rolling-zone-verification.ts` | **new** — 10 sections |

Nothing else. No schema change, no persistence, no new UI, no state plumbing — and minimal exposure to the concurrent auth/preview workstream.

The Review Zone design doc §11 reserves changes to the bulk bound to you; this is that change, made on your instruction. **`ZONE_CAPACITY` is unchanged** — only which cells occupy it.

---

## The invariant, now pinned

> *"Items have a stable home order. While I work a Zone, completed local runs temporarily move out of my way and fresh unresolved work rises into the Zone. Nothing loses its home position, and completed work from elsewhere does not bubble back into my active queue."*

Every clause is a verification case in §3, §5 and §6 of the new suite.
