# Item Check Shows Remaining Work — Findings

**Instruction:** AG, 2026-08-02. "Item Check should show the reviewer what remains
to be done — not everything that has already been handled elsewhere."

---

## 1. The finding that changed the design

The instruction assumed "an upstream stage has already completely answered the
question" is a state the model can identify. **It is not.**

- `confirmGroup` / `redactGroup` / `ignoreGroup` / `flattenGroup` all route through
  `applyDecisionBatch()`, which calls `decideCandidate()` for **every member**.
  A Group Check bulk action therefore writes a full `CandidateDecision` onto each
  member candidate.
- `CandidateDecision` records **no stage of origin**. `decideCandidate()` does
  receive a `groupId`, but uses it only as the `EntityRegistry` anchor and then
  discards it — and that anchor is unreliable as provenance anyway, because
  `Ignore` revokes rather than creates a registry entry.
- Consequently "decided in Group Check", "decided in Ambiguity Check" and
  "decided in Item Check" are **literally the same fact** in `ReviewSession`.

Measured, not assumed. A scratch probe on `entity-resolution-001`:

```
confirmGroup person:jackson:a
  person:andrew jackson: directDecision=true  status=resolved
  person:andy jackson:   directDecision=true  status=resolved
TOTAL candidates resolved by group coverage WITHOUT their own decision: 0 of 13
```

So the first design — retire only candidates resolved by group *coverage* with no
decision of their own — was correct but **inert**: it would have retired nothing,
and the screenshot would have looked unchanged. The 77 checkmarked rows in the
reported screenshot are ordinary decided candidates.

**AG decision:** retire **any resolved candidate**. The queue holds undecided work.

## 2. What was built

One rule, one place. No new stored state, no new schema field, no UI-only tracking.

| File | Change |
| --- | --- |
| `engines/navigation/stages.ts` | New `reviewableItemIdsForStage(stage, context, session)` — `itemIdsForStage` minus resolved, **item-check only**. Mirrors the existing `reviewArtifactIdsForStage` shape. |
| `ui/itemCheckQuery.ts` | New pure `queryRequestsDecidedItems(query)` — the escape hatch predicate. |
| `ui/app.ts` | New `itemCheckPoolIds(state)`; both pool sites (`renderCandidateStage`, `visibleItemCheckIds`) now read it. |
| `verify/item-check-work-queue-verification.ts` | New suite, 40 checks. |

### Three deliberate boundaries

**The navigator keeps the full list.** `itemIdsForStage` is unchanged.
`findByPredicate` already skips resolved items, so narrowing it would change no
navigation behaviour while quietly making decided candidates unreachable —
including after an undo, when they must come back.

**The counts keep the full denominator.** `computeStageStatus` still counts
`itemIdsForStage`. Counting the queue instead would make every stage read `(N/N)`
forever and destroy the exact progress signal the shrinking queue is meant to
reinforce. The tab now reads `(remaining / everything detected)` — 11/13 after a
group confirm.

**Only Item Check narrows.** Group Check rows are groupings the reviewer reads as
a set, and a decided group row still carries the outcome label
`groupDisplayDecision()` computes for it. Retiring it would delete the *result*,
not the work.

### The escape hatch

The pool widens back to the full inventory when the reviewer explicitly asks for
decided work — search text present, or an "Ignored"/"Changed"/"Redacted" preset
active. This keeps AG's "searchability should remain intact" literally true, and
prevents three filter presets from becoming permanently-empty dead controls
(`itemCheckQuery.ts` already refused to ship one of those once).

### Reappearance needs no machinery

Nothing is stored. Undo a decision, revoke a group decision, or load a save file
without one, and `isItemResolved()` stops returning true on the next read. A
stored "retired" flag would have needed an invalidation path for each of those and
could still have gone stale — stranding work where no reviewer would look again.

### Occurrence-level safety, retained

The rule keys on `status === "resolved"`, never `"partially-resolved"`. A candidate
whose occurrences a group covered only partly stays in the queue in full.
Retiring it would drop the uncovered occurrences out of review entirely — a false
negative reaching a released document.

## 3. Verification

- **New suite: 40/40.** Retirement, per-group retirement, purity/reappearance,
  denominator preservation, stage scoping, escape hatch, partial-coverage safety.
- **Full battery: 40 suites, all exit 0, zero regressions.**
- `tsc --noEmit` clean; `npm run build` clean.
- **Live browser validation** (Chrome against AG's own server, build
  `v2026-08-02.28`), fixture `entity-resolution-001`:

| Action | Result |
| --- | --- |
| Load | Item Check 13 rows, tab `(13/13)` |
| Confirm `person:jackson:a` in Group Check | Item Check **11 rows**, tab `(11/13)`; both members gone |
| Search "jackson" | Both decided members **found**; clearing returns to the 11-row queue |
| Keep one item in Item Check | 10 rows, tab `(10/13)` |
| Decide the last item | Focus relocates to QA; completed work stages drop out of the tab bar |

The last row is the answer to the one edge I was watching: when the queue empties,
`reconcile()` carries the reviewer to QA rather than parking focus on a row that is
no longer rendered.

## 4. Observations not acted on

- **`itemCheckCandidateStatus()` still reads `candidateDecisions` alone**, not
  `candidateResolvedStatus()`. A candidate resolved by group coverage without its
  own decision would render "To review" in the widened (search) pool. Practically
  unreachable today — §1 shows that state does not occur — but it is a second,
  narrower answer to "is this resolved" living beside the domain's. Worth
  unifying in a future pass; not touched here to keep the change proportionate.
- **Batch-confirmed vs individually-confirmed decisions are indistinguishable.**
  "Select all visible (78)" and 78 separate confirmations record identically. Not
  a defect, but the system is more confident about a bulk-confirmed candidate than
  the reviewer necessarily is.
- **`verify/_scratch_output/upstream-provenance-probe.ts`** is the throwaway probe
  behind §1. Kept because the measurement is the load-bearing evidence for the
  design; delete freely.
