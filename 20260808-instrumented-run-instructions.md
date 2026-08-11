# Instrumented Ambiguity Run — What To Do

**Date:** 2026-08-08
**Goal:** one clean-document run that *captures* what actually moves review position, so Failures 1, 2 and 4 stop being hypotheses.

---

## Before you start

Nothing to switch on. Tracing is enabled at load, deliberately — by the time a workflow bug is visible, the events that explain it have already happened, so it cannot be something you have to remember to arm.

Just rebuild and reload:

```
npm run build
```

Hard-reload the page (⌘⇧R) so the browser picks up the new `dist/`.

---

## During the run

Work the document exactly as you normally would. Don't adapt your behavior to the instrumentation — the point is to catch the failure in its natural habitat.

**The moment something goes wrong** — wrong item, wrong category, unexpected advance — stop and run this in the browser console:

```js
__docscrub.copy()
```

That puts the full report on your clipboard: the event timeline, which sites wrote the cursor, the async seams, and any contradictory states detected. Paste it to me.

If the clipboard is blocked, `__docscrub.report()` prints the same thing.

**Do not reload before copying.** The trace is in memory and a reload loses it. That's the one habit this run needs from you.

### The four commands

| Command | What it gives you |
|---|---|
| `__docscrub.copy()` | Full report → clipboard. **This is the one to use.** |
| `__docscrub.bad()` | Only the impossible states, as a table. Quick look. |
| `__docscrub.writes()` | Which sites wrote the proposal cursor, ranked. |
| `__docscrub.clear()` | Reset before a fresh attempt. |

If you get through a whole category cleanly, `__docscrub.bad()` is worth a glance anyway — it may show a contradiction that hasn't surfaced as a visible symptom yet.

---

## What the trace will tell us

Four specific things, each of which currently has no answer:

**1. Who moved the cursor.** Every write is tagged with its pre-instrumentation source line, so `L13477` in the output is literally the render-tail site from the audit. If three sites account for every write, the consolidation is small. If fifteen do, my plan needs revising. Either answer changes what I build.

**2. Whether the DOM decided position.** `activeStructuralProposalId` resolves the cursor from `document.activeElement` when state is empty. Every such occurrence is flagged `DOM-as-position-truth`. If this never fires in a real session, that whole branch of the audit is less urgent than I claimed.

**3. Whether an advance crossed a category with work remaining.** All three advance mechanisms are checked — an early draft of the detector only watched two, and the test suite caught it. Flagged `category-advanced-with-unresolved-work`, with the live remaining count.

**4. Whether the 700 ms timer is implicated.** Events arriving ≥250 ms after the previous one are listed as async seams. A navigation event on the far side of one of those came from the acknowledgement timer, not from you — which is the single most incriminating pattern available.

Plus the one defect already confirmed in isolation: arrival landing on an **already-resolved** unit (`arrival-on-resolved-unit`). If that shows up, it pins Failure 3 to a real category on your document.

---

## What I changed

Four files. No product behavior was touched.

| File | Change |
|---|---|
| `src/ui/positionTrace.ts` | **New.** Bounded ring buffer + analyzers. Pure, DOM-free, no timers. |
| `src/ui/app.ts` | 27 cursor assignments → `setCardCursor(value, "L<line>")`; 5 instrumented sites; diagnostics block at the end. |
| `verify/position-trace-verification.ts` | **New.** 30 behavioral checks on the trace module. |
| `verify/ui-smoke.ts` | 3 source-text patterns updated for the rename. Same claims, not weakened. |

The setter assigns first, then records, and returns `void` — no caller can branch on it. Tracing is append-only into a bounded ring, wrapped in try/catch. A diagnostic that could abort one of your decisions would be worse than none.

**Verification:** `tsc --noEmit` clean, `npm run build` clean, **51/51 suites pass** (52 → 53 files, 51 runnable), `ui-smoke` 193/193. Confirmed present in the built `dist/` and confirmed emitting at runtime, not just compiling.

---

## Removing it

`positionTrace.ts` and `position-trace-verification.ts` delete outright. In `app.ts`, remove the import, the diagnostics block at the end, the five `trace(...)` call sites, and inline the 27 `setCardCursor(x, "L…")` calls back to plain assignments. Every piece is commented `TEMPORARY` and says so.

Not before the consolidation lands, though — the trace is how we'll know the consolidation worked.

---

## Honest note on cost

This run costs you one document and gets you no further through the workflow than last time. That's the trade: I was wrong about two of four mechanisms today because I was reasoning about a stateful system by reading it. One instrumented run replaces that guessing with data.

If you'd rather I also fix the two **confirmed** defects first — arrival landing on a resolved unit (likely Failure 3), and the pill counts ignoring dismissals — say so. They're independent of the extraction, each has a real behavioral test, and they'd give this run a chance of getting further than the last one. I held off because you asked for instrumentation first and I didn't want to change behavior underneath the measurement.
