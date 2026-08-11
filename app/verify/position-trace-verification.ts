/**
 * position-trace-verification.ts -- pins src/ui/positionTrace.ts (AG,
 * 2026-08-08, temporary diagnostic instrumentation).
 *
 * WHY A DIAGNOSTIC GETS ITS OWN SUITE. Instrumentation that is wrong is
 * worse than none: it sends the next investigation down a false path, which
 * is exactly the failure mode this whole stabilization pass exists to stop
 * (see `20260808-ambiguity-stabilization-step1-STOP.md` -- two of four
 * mechanism claims were refuted only because they were finally EXECUTED
 * rather than read). So the analyzers Andrew will act on -- the
 * contradiction detector above all -- are pinned here against fixtures whose
 * answers are known.
 *
 * These are real behavioral assertions over the module's actual output. None
 * of them reads source text.
 *
 * Delete with the module.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/position-trace-verification.ts
 */

import {
  TRACE_CAPACITY,
  asyncSeams,
  clearTrace,
  contradictions,
  cursorWriteSummary,
  disableTrace,
  dumpTrace,
  enableTrace,
  isTraceEnabled,
  trace,
  traceCursorWrite,
  traceSnapshot,
} from "../src/ui/positionTrace.ts";

let passCount = 0;
let failCount = 0;
const failed: string[] = [];

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passCount += 1;
    console.log(`  PASS ${label}`);
  } else {
    failCount += 1;
    failed.push(label);
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

/** Deterministic clock so timing assertions are exact rather than flaky. */
function fakeClock(): { now: () => number; advance: (ms: number) => void } {
  let t = 1_000_000;
  return { now: () => t, advance: (ms: number) => { t += ms; } };
}

console.log("=== positionTrace verification ===\n");

console.log("--- lifecycle ---");
{
  disableTrace();
  clearTrace();
  trace("note", "test", "should be dropped while disabled");
  check("disabled tracing records nothing (production pays one boolean test)", traceSnapshot().length === 0);

  const clock = fakeClock();
  enableTrace(clock.now);
  check("enableTrace turns tracing on", isTraceEnabled());
  trace("note", "test", "first");
  check("an enabled trace records events", traceSnapshot().length === 1);
  check("timestamps are relative to install (first event at +0ms)", traceSnapshot()[0]!.t === 0, `got ${traceSnapshot()[0]!.t}`);

  clock.advance(700);
  trace("note", "test", "second");
  check("elapsed time is recorded against the injected clock", traceSnapshot()[1]!.t === 700, `got ${traceSnapshot()[1]!.t}`);
  check("sequence numbers are monotonic", traceSnapshot()[0]!.seq === 1 && traceSnapshot()[1]!.seq === 2);

  clearTrace();
  check("clearTrace empties the ring", traceSnapshot().length === 0);
}

console.log("\n--- boundedness ---");
{
  const clock = fakeClock();
  enableTrace(clock.now);
  for (let i = 0; i < TRACE_CAPACITY + 250; i += 1) trace("note", "test", `event ${i}`);
  const snapshot = traceSnapshot();
  check(`the ring is bounded at TRACE_CAPACITY (${TRACE_CAPACITY})`, snapshot.length === TRACE_CAPACITY, `got ${snapshot.length}`);
  check("the ring retains the MOST RECENT events, not the oldest", snapshot[snapshot.length - 1]!.detail === `event ${TRACE_CAPACITY + 249}`, snapshot[snapshot.length - 1]!.detail);
}

console.log("\n--- cursor writes ---");
{
  const clock = fakeClock();
  enableTrace(clock.now);
  traceCursorWrite("L3566", null, "p1");
  traceCursorWrite("L3566", "p1", "p1"); // no-op: same value
  traceCursorWrite("L13477", "p1", null);
  traceCursorWrite("L3566", null, "p2");

  const snapshot = traceSnapshot();
  check("a NO-OP cursor write is not recorded (signal, not noise)", snapshot.length === 3, `got ${snapshot.length}`);
  check("a cursor write records the transition in both directions", snapshot[0]!.detail === "proposalCursor (none) -> p1", snapshot[0]!.detail);
  check("clearing the cursor is recorded as a transition to (none)", snapshot[1]!.detail === "proposalCursor p1 -> (none)", snapshot[1]!.detail);

  const summary = cursorWriteSummary();
  check("cursorWriteSummary attributes writes to their source site", summary.length === 2, `got ${summary.length}`);
  check("cursorWriteSummary ranks the busiest write site first", summary[0]!.site === "L3566" && summary[0]!.writes === 2, JSON.stringify(summary));
}

console.log("\n--- async seams ---");
{
  const clock = fakeClock();
  enableTrace(clock.now);
  trace("decision", "decideAndAdvance", "reviewer pressed R");
  clock.advance(5);
  trace("render", "render", "immediate rebuild");
  clock.advance(700); // the acknowledgement timer
  trace("advance.completion", "advanceAfterSectionCompletion", "fired from the timer");

  const seams = asyncSeams(250);
  check("an async seam is detected across the 700ms acknowledgement gap", seams.length === 1, `got ${seams.length}`);
  check("the seam names the event that arrived AFTER the gap", seams[0]!.site === "advanceAfterSectionCompletion", seams[0]!.site);
  check("tight event sequences produce no seam", asyncSeams(2000).length === 0);
}

console.log("\n--- contradiction detector ---");
{
  const clock = fakeClock();
  enableTrace(clock.now);
  check("a clean session reports no contradictions", contradictions().length === 0);

  // 1. DOM decided review position.
  trace("cursor.domRead", "activeStructuralProposalId", "resolved proposal p9 from document.activeElement");
  // 2. Advance crossed a category boundary with work remaining (Failure 4).
  trace("advance.visible", "dispatchReviewWithVisibleAdvance", "candidate:a3 -> candidate:b1", {
    categoryChanged: true,
    remaining: 2,
  });
  // 3. Completion advance moved the stage with work remaining.
  trace("advance.completion", "advanceAfterSectionCompletion", "exhausted", { moveStage: true, remaining: 5 });
  // 4. Arrival landed on an already-resolved unit (Claim 4).
  trace("category.arrive", "selectStageCategoryCursor", "category numeric -> candidate:c1 (ALREADY RESOLVED)", { landedResolved: true });
  // 5. Render destroyed the cursor.
  trace("cursor.write", "renderTail", "proposalCursor p9 -> (none)", { next: null });

  // 5b. The two cursors name different categories (trace seq 63 shape).
  trace("render", "render", "stage=ambiguity-check category=acronyms item=person:civitas card=rel-acronym-QBU", {
    itemCategoryId: "institutional",
    proposalCategoryId: "acronyms",
  });

  const found = contradictions();
  const rules = found.map((c) => c.rule);
  check("detects DOM-as-position-truth", rules.includes("DOM-as-position-truth"), rules.join(","));
  check("detects a category advance while unresolved work remained", rules.filter((r) => r === "category-advanced-with-unresolved-work").length === 2, rules.join(","));
  check("detects arrival onto an already-resolved unit", rules.includes("arrival-on-resolved-unit"), rules.join(","));
  check("detects render destroying the cursor", rules.includes("render-destroyed-cursor"), rules.join(","));
  check("detects the two cursors naming different categories", rules.includes("cursors-name-different-categories"), rules.join(","));
  check("reports every contradiction, not just the first", found.length === 6, `got ${found.length}`);
  check("each contradiction carries its sequence number for timeline lookup", found.every((c) => typeof c.seq === "number" && c.seq > 0));
}

console.log("\n--- negative cases (the detector must not cry wolf) ---");
{
  const clock = fakeClock();
  enableTrace(clock.now);
  // An advance that crosses a category boundary with NO work remaining is
  // the CORRECT behavior and must never be flagged.
  trace("advance.visible", "dispatchReviewWithVisibleAdvance", "candidate:a4 -> proposal:p1", { categoryChanged: true, remaining: 0 });
  // A stage advance from a genuinely exhausted category is likewise correct.
  trace("advance.completion", "advanceAfterSectionCompletion", "exhausted", { moveStage: true, remaining: 0 });
  // Arrival onto an unresolved unit is correct.
  trace("category.arrive", "selectStageCategoryCursor", "category people -> candidate:x1", { landedResolved: false });
  // A cursor write from a non-render site is correct.
  trace("cursor.write", "L3566", "proposalCursor (none) -> p1", { next: "p1" });
  // Both cursors set and AGREEING is the ordinary proposal frame.
  trace("render", "render", "agreeing cursors", { itemCategoryId: "acronyms", proposalCategoryId: "acronyms" });
  // Only one cursor set is the ordinary candidate frame -- disagreement
  // requires BOTH, and flagging half-set frames would bury the real signal.
  trace("render", "render", "candidate-only frame", { itemCategoryId: "acronyms", proposalCategoryId: null });
  trace("render", "render", "proposal-only frame", { itemCategoryId: null, proposalCategoryId: "acronyms" });
  check("correct category advancement (0 remaining) is NOT flagged", contradictions().length === 0, JSON.stringify(contradictions()));
  check("agreeing cursors are NOT flagged", contradictions().every((c) => c.rule !== "cursors-name-different-categories"));
}

console.log("\n--- report shape ---");
{
  const clock = fakeClock();
  enableTrace(clock.now);
  check("an empty trace dumps a clear marker rather than an empty string", dumpTrace() === "(trace empty)");
  trace("render", "render", "stage=ambiguity-check category=numeric");
  check("dumpTrace includes the event detail", dumpTrace().includes("stage=ambiguity-check category=numeric"));
  check("dumpTrace includes the site column", dumpTrace().includes("render"));
}

console.log("\n--- safety: instrumentation must never break its host ---");
{
  const clock = fakeClock();
  enableTrace(clock.now);
  const circular: Record<string, unknown> = {};
  circular["self"] = circular;
  let threw = false;
  try {
    trace("note", "test", "circular payload", circular);
  } catch {
    threw = true;
  }
  check("tracing a circular payload does not throw at record time", !threw);
  let dumpThrew = false;
  try {
    dumpTrace();
  } catch {
    dumpThrew = true;
  }
  check("dumping a circular payload does not throw (a diagnostic must never abort a decision)", !dumpThrew);
  disableTrace();
}

console.log(`\n=== ${passCount} passed, ${failCount} failed ===`);
if (failCount > 0) {
  for (const f of failed) console.log(`  - ${f}`);
  process.exitCode = 1;
}
