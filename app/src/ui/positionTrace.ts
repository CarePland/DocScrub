/**
 * positionTrace.ts -- TEMPORARY DIAGNOSTIC INSTRUMENTATION (AG, 2026-08-08).
 *
 * ============================ REMOVE ME ============================
 * This module exists to answer ONE question and then be deleted:
 *
 *   "At the moment Ambiguity navigation goes wrong, which subsystem wrote
 *    the review position, what was it before, and what did it become?"
 *
 * It is not a feature, it is not a logging framework, and nothing in the
 * product may come to depend on it. Delete this file and its call sites
 * once the Ambiguity stabilization pass has landed.
 * ===================================================================
 *
 * WHY THIS EXISTS AT ALL, recorded so the next reader does not mistake it
 * for over-engineering. The forensic audit
 * (`20260808-ambiguity-navigation-forensic-audit.md`) established that
 * review position is written from many independent places -- 29 assignment
 * sites on the proposal cursor alone, plus a DOM read, plus a render-tail
 * mutation, plus a 700ms timer. Static reading identified the STRUCTURE
 * correctly but mis-attributed two of four concrete failures
 * (`20260808-ambiguity-stabilization-step1-STOP.md`): a pure-model test
 * could not reproduce them, because the defects live in stateful,
 * asynchronous, DOM-coupled coordination rather than in any pure rule.
 *
 * The lesson, and the reason for this file: a stateful system cannot be
 * diagnosed reliably by reading it. One instrumented manual run produces
 * more truth than another round of inference. This module makes that run
 * cheap.
 *
 * DESIGN CONSTRAINTS, all load-bearing:
 *
 *  1. ZERO BEHAVIOR CHANGE. Every entry point is append-only into a
 *     bounded in-memory ring. Nothing here reads product state, throws,
 *     schedules work, or returns a value a caller could branch on. If
 *     instrumentation can change what it measures, it is worthless for
 *     this purpose.
 *
 *  2. NO DOM, NO STORAGE. Pure and unit-testable
 *     (verify/position-trace-verification.ts), for the same reason
 *     reviewZone.ts insists on it: this repository's verification
 *     environment has no browser, so anything that matters must be
 *     provable without one.
 *
 *  3. BOUNDED. A long review session must not grow memory without limit;
 *     the ring keeps the most recent TRACE_CAPACITY events. A reviewer
 *     hitting a failure reports it within a few actions, so recency is
 *     what matters, not completeness.
 *
 *  4. THE SITE TAG IS THE POINT. Every cursor write records WHICH source
 *     line performed it. "The cursor became null" is not actionable;
 *     "the cursor became null at the render tail while the reviewer was
 *     mid-category" is the whole diagnosis.
 */

/** Most recent events retained. ~40 reviewer actions' worth of detail. */
export const TRACE_CAPACITY = 600;

/**
 * What kind of thing happened. Deliberately a small closed vocabulary --
 * a trace whose event names are free text cannot be summarized, and the
 * summary is what gets read.
 */
export type TraceKind =
  /** A write to the proposal cursor (`structuralCardFocusPending`). */
  | "cursor.write"
  /** The proposal cursor was resolved by READING THE DOM rather than state. */
  | "cursor.domRead"
  /** A domain navigation command was dispatched (selectItem/moveStage/...). */
  | "nav.dispatch"
  /** A review decision was dispatched. */
  | "decision"
  /** The visible-order advance chose a landing target. */
  | "advance.visible"
  /** The section-completion advance ran (including its stage-advance branch). */
  | "advance.completion"
  /** Category arrival (pill click, Opt+arrow, restore). */
  | "category.arrive"
  /** A render pass observed the position. */
  | "render"
  /** Free-form note attached to the timeline. */
  | "note";

export interface TraceEvent {
  /** Monotonic sequence number -- ordering that survives equal timestamps. */
  seq: number;
  /** Milliseconds since the trace was installed. Relative, not wall clock:
   *  what matters is the GAP between events (a 700ms gap is the
   *  acknowledgement timer, and spotting that is half the diagnosis). */
  t: number;
  kind: TraceKind;
  /** Which code site produced this. For cursor writes, the pre-instrumentation
   *  source line -- see this module's doc comment on why. */
  site: string;
  /** Human-readable summary of the transition. */
  detail: string;
  /** Structured position snapshot, when the site knows it. */
  data?: Record<string, unknown> | undefined;
}

let events: TraceEvent[] = [];
let seqCounter = 0;
let installedAt = 0;
let enabled = false;

/** Clock injected so tests are deterministic; defaults to Date.now. */
let clock: () => number = () => Date.now();

/**
 * Turns tracing on. Off by default so a production page pays nothing --
 * `enabled === false` makes every `trace()` call a single boolean test.
 */
export function enableTrace(now: () => number = () => Date.now()): void {
  clock = now;
  installedAt = clock();
  enabled = true;
  events = [];
  seqCounter = 0;
}

export function disableTrace(): void {
  enabled = false;
}

export function isTraceEnabled(): boolean {
  return enabled;
}

export function clearTrace(): void {
  events = [];
  seqCounter = 0;
  installedAt = clock();
}

/**
 * THE ONE ENTRY POINT. Append-only, bounded, never throws.
 *
 * The try/catch is not defensive padding: this is called from inside
 * render and from inside decision dispatch, and a diagnostic that can
 * abort a reviewer's decision would be strictly worse than no diagnostic.
 * `data` is caller-supplied and may contain anything; serializing it is
 * deferred to dump time for exactly that reason.
 */
export function trace(kind: TraceKind, site: string, detail: string, data?: Record<string, unknown>): void {
  if (!enabled) return;
  try {
    seqCounter += 1;
    events.push({ seq: seqCounter, t: clock() - installedAt, kind, site, detail, ...(data ? { data } : {}) });
    if (events.length > TRACE_CAPACITY) events = events.slice(events.length - TRACE_CAPACITY);
  } catch {
    /* a diagnostic must never break the thing it observes */
  }
}

/**
 * Records a cursor transition, skipping NO-OP WRITES.
 *
 * The skip matters more than it looks. Several of the 29 cursor-write
 * sites fire on every render with the value they already hold; keeping
 * them would bury the handful of writes that actually CHANGE the cursor
 * -- which are the only ones that can explain a navigation failure -- under
 * hundreds of identical lines. A trace nobody can read is not evidence.
 *
 * Returns void: callers must not branch on instrumentation.
 */
export function traceCursorWrite(site: string, previous: string | null, next: string | null, context?: Record<string, unknown>): void {
  if (!enabled) return;
  if (previous === next) return;
  trace("cursor.write", site, `proposalCursor ${fmt(previous)} -> ${fmt(next)}`, context);
}

function fmt(value: string | null): string {
  return value === null ? "(none)" : value;
}

export function traceSnapshot(): TraceEvent[] {
  return events.map((e) => ({ ...e }));
}

/**
 * The reviewer-facing dump: a compact, paste-able timeline.
 *
 * Optimized for being pasted into a chat window, not for machine parsing --
 * the consumer is a human reading "what happened just before it broke".
 * A JSON blob of 600 objects is technically complete and practically
 * unreadable; `dumpTraceJson` exists for when the structure is wanted.
 */
export function dumpTrace(): string {
  if (events.length === 0) return "(trace empty)";
  const lines = events.map((e) => {
    const data = e.data ? `  ${safeStringify(e.data)}` : "";
    return `${String(e.seq).padStart(4, " ")}  +${String(e.t).padStart(6, " ")}ms  ${e.kind.padEnd(18, " ")} ${e.site.padEnd(22, " ")} ${e.detail}${data}`;
  });
  return [`=== DocScrub position trace (${events.length} events) ===`, ...lines].join("\n");
}

export function dumpTraceJson(): string {
  return safeStringify(events, 2);
}

/**
 * `data` is caller-supplied and reaches this module unvalidated -- a call
 * site that hands over a DOM node, a state object, or anything else holding
 * a cycle would make a plain JSON.stringify throw, and it would throw at
 * DUMP time: the exact moment Andrew is trying to read the evidence after a
 * failure, when losing the trace is worst. Caught by
 * verify/position-trace-verification.ts, which is why the suite exists.
 *
 * Cyclic references degrade to "[unserializable]" rather than aborting the
 * dump: one unreadable payload must not cost the other 599 events.
 */
function safeStringify(value: unknown, indent?: number): string {
  try {
    const seen = new WeakSet<object>();
    return JSON.stringify(
      value,
      (_key, v: unknown) => {
        if (typeof v === "object" && v !== null) {
          if (seen.has(v as object)) return "[circular]";
          seen.add(v as object);
        }
        return v;
      },
      indent
    );
  } catch {
    return "[unserializable]";
  }
}

/**
 * WHAT WROTE THE CURSOR, AND HOW OFTEN -- the summary that answers the
 * audit's central question directly.
 *
 * The audit's claim is that many independent sites write one cursor. This
 * turns that from an assertion about the source into a measurement of a
 * real session: if three sites account for every write, the consolidation
 * is small; if fifteen do, it is not. Either answer changes the plan,
 * which is what makes this worth computing rather than eyeballing.
 */
export function cursorWriteSummary(): Array<{ site: string; writes: number }> {
  const counts = new Map<string, number>();
  for (const e of events) {
    if (e.kind !== "cursor.write") continue;
    counts.set(e.site, (counts.get(e.site) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([site, writes]) => ({ site, writes }))
    .sort((a, b) => b.writes - a.writes || a.site.localeCompare(b.site));
}

/**
 * Events whose gap from the previous event exceeds `thresholdMs` -- the
 * asynchronous seam.
 *
 * Anything arriving ~700ms after the action that caused it came from the
 * acknowledgement timer rather than from the reviewer, and the audit
 * identified that timer as the only path able to dispatch a stage advance.
 * A navigation event on the far side of one of these gaps is therefore the
 * single most incriminating pattern this trace can show, so it gets a
 * first-class query rather than being left for the reader to spot by
 * subtracting timestamps.
 */
export function asyncSeams(thresholdMs = 250): TraceEvent[] {
  const out: TraceEvent[] = [];
  for (let i = 1; i < events.length; i += 1) {
    const previous = events[i - 1]!;
    const current = events[i]!;
    if (current.t - previous.t >= thresholdMs) out.push({ ...current });
  }
  return out;
}

/**
 * CONTRADICTION DETECTOR -- the assertions the audit says nothing currently
 * enforces, evaluated over a REAL session instead of a fixture.
 *
 * These are the invariants a pure test cannot check because they are about
 * coordination between subsystems over time. Each returns a description of
 * a state that should be impossible; an empty list is the claim that the
 * session never entered one.
 */
export interface TraceContradiction {
  seq: number;
  t: number;
  rule: string;
  detail: string;
}

export function contradictions(): TraceContradiction[] {
  const out: TraceContradiction[] = [];
  for (let i = 0; i < events.length; i += 1) {
    const e = events[i]!;
    const data = e.data ?? {};

    // The cursor was resolved from the DOM rather than from state. Every
    // occurrence is a place where browser focus -- clicks, innerHTML
    // teardown, scroll -- decided review position.
    if (e.kind === "cursor.domRead") {
      out.push({ seq: e.seq, t: e.t, rule: "DOM-as-position-truth", detail: e.detail });
    }

    // A stage/category advance while the current category still reports
    // unresolved work. This is the invariant Failure 4 violates.
    //
    // ALL THREE ADVANCE MECHANISMS ARE CHECKED, not just the timer one.
    // An earlier draft omitted `advance.visible` and the suite caught it --
    // which matters, because the audit's whole point is that THREE
    // independent mechanisms can move the reviewer, and a detector blind to
    // one of them would have quietly exonerated it.
    if (e.kind === "advance.completion" || e.kind === "advance.visible" || e.kind === "nav.dispatch") {
      const remaining = typeof data["remaining"] === "number" ? (data["remaining"] as number) : null;
      const moved = data["moveStage"] === true || data["categoryChanged"] === true;
      if (moved && remaining !== null && remaining > 0) {
        out.push({
          seq: e.seq,
          t: e.t,
          rule: "category-advanced-with-unresolved-work",
          detail: `${e.site}: advanced while ${remaining} unresolved remained -- ${e.detail}`,
        });
      }
    }

    // Arrival landed on a unit that was already resolved. This is the
    // confirmed Claim 4 defect; seeing it in a real session pins it to a
    // real category.
    if (e.kind === "category.arrive" && data["landedResolved"] === true) {
      out.push({
        seq: e.seq,
        t: e.t,
        rule: "arrival-on-resolved-unit",
        detail: `${e.site}: ${e.detail}`,
      });
    }

    // Render destroyed the cursor. Rendering is supposed to be a function
    // of state, not a writer of it.
    if (e.kind === "cursor.write" && e.site.startsWith("renderTail") && data["next"] === null) {
      out.push({ seq: e.seq, t: e.t, rule: "render-destroyed-cursor", detail: e.detail });
    }

    /*
     * THE TWO CURSORS NAME DIFFERENT CATEGORIES (AG, 2026-08-09,
     * migration prerequisite -- instrumenting a KNOWN but unquantified
     * risk before it becomes an Item Check bug report).
     *
     * Observed live during the acknowledgement pulse (trace seq 63):
     *
     *   render  category=acronyms  item=person:civitas  card=rel-acronym-QBU
     *
     * `itemId` named a unit in Institutional while `proposalCursor` named
     * one in Acronyms, and the category derivation picked the card. It
     * self-corrected ~700ms later when the completion advance ran, and no
     * user-visible defect was reported -- which is exactly why it needs
     * measuring rather than arguing about. A frame in which the two
     * cursors disagree is a frame in which "which unit owns interaction"
     * has two answers, and that is the condition every navigation failure
     * in this stage has ultimately reduced to.
     *
     * WHY IT MATTERS FOR THE MIGRATION: Item Check Triage sets the same
     * proposal cursor (app.ts's itemCheckViewMode === "triage" artifact
     * cursor), so it inherits this frame. Counting occurrences here tells
     * us whether collapsing the two cursors is urgent or merely correct
     * -- a judgement currently being made from a single observation.
     *
     * DELIBERATELY NOT FLAGGED: a null proposal cursor (the ordinary
     * candidate case) and a null item cursor. Disagreement requires BOTH
     * to be set and to resolve to different categories; anything else is
     * a normal frame and flagging it would bury the real signal.
     */
    if (e.kind === "render") {
      const itemCategory = data["itemCategoryId"];
      const cursorCategory = data["proposalCategoryId"];
      if (
        typeof itemCategory === "string" &&
        typeof cursorCategory === "string" &&
        itemCategory !== cursorCategory
      ) {
        out.push({
          seq: e.seq,
          t: e.t,
          rule: "cursors-name-different-categories",
          detail: `item cursor in "${itemCategory}", proposal cursor in "${cursorCategory}" -- ${e.detail}`,
        });
      }
    }
  }
  return out;
}

/** Everything a bug report needs, in one string. */
export function traceReport(): string {
  const summary = cursorWriteSummary();
  const seams = asyncSeams();
  const bad = contradictions();
  return [
    dumpTrace(),
    "",
    "=== cursor writes by site ===",
    ...(summary.length === 0 ? ["(none)"] : summary.map((s) => `  ${String(s.writes).padStart(4, " ")}  ${s.site}`)),
    "",
    `=== async seams (>=250ms after previous event): ${seams.length} ===`,
    ...seams.map((e) => `  seq ${e.seq} +${e.t}ms ${e.kind} ${e.site} ${e.detail}`),
    "",
    `=== CONTRADICTIONS: ${bad.length} ===`,
    ...(bad.length === 0 ? ["(none observed)"] : bad.map((c) => `  seq ${c.seq} +${c.t}ms [${c.rule}] ${c.detail}`)),
  ].join("\n");
}
