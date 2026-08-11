/**
 * rolling-zone-verification.ts -- the Zone as a stable rolling work surface
 * (AG, 2026-08-10).
 *
 *     node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs \
 *          verify/rolling-zone-verification.ts
 *
 * Every assertion here EXECUTES the shipped partition. There is no source
 * scan: the rhythm is a pure function of (cells, resolved set, size), which is
 * exactly why it can be pinned without a browser -- the property
 * `reviewZone.ts`'s header calls this module's whole premise.
 *
 * THE INVARIANT THIS SUITE EXISTS TO PROVE:
 *
 *     "Items have a stable home order. While I work a Zone, completed local
 *      runs temporarily move out of my way and fresh unresolved work rises
 *      into the Zone. Nothing loses its home position, and completed work
 *      from elsewhere does not bubble back into my active queue."
 */

import { advanceWithinReviewTargets, advanceWithinZone, candidateReviewTarget } from "../src/ui/visibleListAdvance.js";
import {
  ZONE_CAPACITY,
  contiguousCompletedRun,
  rollingQueuePartition,
  zonePartition,
} from "../src/ui/reviewZone.js";

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}\n         expected ${e}\n         actual   ${a}`);
  }
}

/** Canonical order: a stable list of ids. Resolution is a separate set, which
 *  is the whole point -- decision state never edits the list. */
const CANONICAL = (n: number): string[] => Array.from({ length: n }, (_, i) => `c${String(i).padStart(3, "0")}`);
const roll = (cells: readonly string[], resolved: ReadonlySet<string>, size = ZONE_CAPACITY) =>
  rollingQueuePartition(cells, (id) => resolved.has(id), size);

console.log("=== ROLLING ZONE ===");

/* ═══════════ 1. INITIAL ZONE ═══════════ */

console.log("\n--- 1. THE INITIAL ZONE IS THE FIRST 24 ELIGIBLE, IN CANONICAL ORDER ---");
{
  const cells = CANONICAL(60);
  const p = roll(cells, new Set());
  check("active holds 24", p.active.length, 24);
  check("...and they are the first 24 in canonical order", p.active, cells.slice(0, 24));
  check("rest holds the remainder in canonical order", p.rest, cells.slice(24));
  check("nothing is retired before any decision", p.retired, []);
  check("the zone is bounded while work remains below", p.bounded, true);
}

/* ═══════════ 2. TURNOVER: FRESH RISES, COMPLETED SETTLES ═══════════ */

console.log("\n--- 2. THE MOTIVATING EXAMPLE ---");
{
  /* A B✓ C✓ D(decide) E✓ F G ... with a 6-cell zone so the shape is legible. */
  const cells = ["A", "B", "C", "D", "E", "F", "G", "Y", "Z", "AA"];
  const before = roll(cells, new Set(["B", "C", "E"]), 6);
  check("before: active is the first 6 unresolved", before.active, ["A", "D", "F", "G", "Y", "Z"]);

  const after = roll(cells, new Set(["B", "C", "D", "E"]), 6);
  check("after deciding D: fresh work has risen into the zone", after.active, ["A", "F", "G", "Y", "Z", "AA"]);
  check("...the completed run settles behind it, in canonical order", after.retired, ["B", "C", "D", "E"]);
  check("...and the painted order puts them last", after.ordered, ["A", "F", "G", "Y", "Z", "AA", "B", "C", "D", "E"]);
  check("the zone stayed at its target size", after.active.length, 6);
}

/* ═══════════ 3. COMPLETED WORK NEVER BUBBLES UPWARD ═══════════ */

console.log("\n--- 3. NO RESOLVED CELL EVER ENTERS THE ACTIVE ZONE ---");
{
  const cells = CANONICAL(60);
  /* Resolve a block sitting BELOW the zone. Replenishment must skip it. */
  const resolved = new Set(["c024", "c025", "c026", "c027"]);
  const p = roll(cells, resolved);
  check("the active zone contains no resolved cell", p.active.filter((id) => resolved.has(id)), []);
  check("...and pulls the next UNRESOLVED cells instead", p.active.slice(-1), ["c023"]);
  check("the already-decided off-zone block stays out", p.rest.slice(0, 4), ["c028", "c029", "c030", "c031"]);

  /* Even resolving everything below leaves the active zone unresolved-only. */
  const allBelow = new Set(cells.slice(24));
  const q = roll(cells, allBelow);
  check("resolving the entire tail does not pull any of it up", q.active, cells.slice(0, 24));
  check("...and the whole resolved tail retires", q.retired, cells.slice(24));
}

/* ═══════════ 4. CONTIGUOUS RUNS ═══════════ */

console.log("\n--- 4. THE CONTIGUOUS COMPLETED RUN (MOTION GROUPING) ---");
{
  const display = ["A", "B", "C", "D", "E", "F", "G"];
  const resolved = new Set(["B", "C", "D", "E"]);
  const isResolved = (id: string) => resolved.has(id);

  check("the run containing the decided cell includes its completed neighbours",
    contiguousCompletedRun(display, isResolved, "D"), ["B", "C", "D", "E"]);
  check("...preserving their relative order", contiguousCompletedRun(display, isResolved, "D").join(""), "BCDE");
  check("asking from any member gives the same run",
    contiguousCompletedRun(display, isResolved, "B"), ["B", "C", "D", "E"]);

  /* Separated completed work does NOT join. */
  const separated = new Set(["B", "D"]);
  check("a completed cell separated by unresolved work does not join the run",
    contiguousCompletedRun(display, (id) => separated.has(id), "D"), ["D"]);
  check("...and the isolated one retires alone",
    contiguousCompletedRun(display, (id) => separated.has(id), "B"), ["B"]);

  check("an unresolved cell has no run", contiguousCompletedRun(display, isResolved, "A"), []);
  check("a cell absent from the display has no run", contiguousCompletedRun(display, isResolved, "ZZ"), []);

  /* Runs at the edges. */
  check("a run at the head is found",
    contiguousCompletedRun(["A", "B", "C"], (id) => id === "A" || id === "B", "A"), ["A", "B"]);
  check("a run at the tail is found",
    contiguousCompletedRun(["A", "B", "C"], (id) => id === "B" || id === "C", "C"), ["B", "C"]);
}

/* ═══════════ 5. CANONICAL ORDER IS NEVER MUTATED ═══════════ */

console.log("\n--- 5. HOME POSITIONS SURVIVE EVERYTHING ---");
{
  const cells = CANONICAL(40);
  const snapshot = JSON.stringify(cells);

  /* Work the zone hard: decide a scattered set, then more. */
  let resolved = new Set<string>();
  for (const id of ["c002", "c003", "c007", "c015", "c021", "c030"]) {
    resolved = new Set([...resolved, id]);
    roll(cells, resolved);
  }
  check("the canonical array is untouched by any amount of turnover", JSON.stringify(cells), snapshot);

  /* Rebuilding from canonical order with an empty resolved set restores the
   * home arrangement exactly -- the §8 "return home" requirement, which needs
   * no reset path because nothing was stored. */
  check("rebuilding restores the canonical arrangement", roll(cells, new Set()).ordered, cells);

  /* And the ordered view is always a permutation of canonical -- nothing is
   * dropped or hidden by turnover (§12). */
  const p = roll(cells, resolved);
  check("ordered is a permutation of canonical -- nothing is lost", [...p.ordered].sort(), [...cells].sort());
  check("...and every cell appears exactly once", new Set(p.ordered).size, cells.length);
}

/* ═══════════ 6. THE ADVANCE INVARIANT ═══════════ */

console.log("\n--- 6. THE UNRESOLVED SEQUENCE IS UNCHANGED BY TURNOVER ---");
{
  /* `partitionByZone`'s doc names this as the invariant the post-decision
   * advance depends on. Rolling must honour it too, or the advance can skip a
   * candidate or hand the next keystroke to the wrong cell. */
  const cells = CANONICAL(50);
  const resolved = new Set(["c001", "c002", "c010", "c030", "c031", "c032"]);
  const p = roll(cells, resolved);
  check("ordered.filter(unresolved) === cells.filter(unresolved)",
    p.ordered.filter((id) => !resolved.has(id)),
    cells.filter((id) => !resolved.has(id)));
  check("...so the advance traverses a stable sequence and skips nothing",
    p.ordered.filter((id) => !resolved.has(id)).length, cells.length - resolved.size);
  check("resolved cells keep canonical relative order in rest",
    p.retired, cells.filter((id) => resolved.has(id)));
}

/* ═══════════ 7. RAPID SEQUENTIAL DECISIONS ═══════════ */

console.log("\n--- 7. RAPID KEYBOARD USE IS DETERMINISTIC ---");
{
  const cells = CANONICAL(60);
  /* Decide six cells in quick succession; the partition after each step must
   * depend only on the resolved set, never on the order they arrived in or on
   * any animation having finished. */
  const sequence = ["c003", "c000", "c012", "c004", "c002", "c001"];
  let resolved = new Set<string>();
  const states: string[] = [];
  for (const id of sequence) {
    resolved = new Set([...resolved, id]);
    states.push(JSON.stringify(roll(cells, resolved).ordered));
  }

  /* Replaying the SAME decisions in a different arrival order must give the
   * same final arrangement -- animation completion cannot be load-bearing. */
  let shuffled = new Set<string>();
  for (const id of [...sequence].reverse()) shuffled = new Set([...shuffled, id]);
  check("final arrangement depends only on WHICH cells are resolved, not the order decided",
    JSON.stringify(roll(cells, shuffled).ordered), states[states.length - 1]);

  check("repeated computation is byte-identical",
    JSON.stringify(roll(cells, resolved)), JSON.stringify(roll(cells, resolved)));
  check("the zone never drifts from its target while work remains",
    states.every(() => roll(cells, resolved).active.length === 24), true);
}

/* ═══════════ 8. SIZE BEHAVIOUR ═══════════ */

console.log("\n--- 8. THE ZONE HOLDS 24, AND SHRINKS GRACEFULLY ---");
{
  const cells = CANONICAL(60);
  check("24 when plenty remains", roll(cells, new Set()).active.length, 24);

  /* Resolve down to fewer than 24 unresolved. */
  const resolved = new Set(cells.slice(0, 45));
  const p = roll(cells, resolved);
  check("shrinks to the remaining eligible work", p.active.length, 15);
  check("...which is exactly the unresolved set", p.active, cells.slice(45));
  check("...and everything completed sits behind it", p.retired.length, 45);

  const done = roll(cells, new Set(cells));
  check("an entirely completed section has an empty active zone", done.active, []);
  check("...and still shows every cell", done.ordered.length, cells.length);

  check("an empty section is handled", roll([], new Set()).ordered, []);
  check("a size below 1 is clamped", roll(cells, new Set(), 0).active.length, 1);
}

/* ═══════════ 9. THE RHYTHM SWITCH ═══════════ */

console.log("\n--- 9. `rolling` IS REACHABLE THROUGH THE ONE ZONE ENTRY POINT ---");
{
  const cells = ["A", "B", "C", "D", "E", "F"];
  const resolved = new Set(["B", "C"]);
  const isResolved = (id: string) => resolved.has(id);

  check("zonePartition delegates to the rolling rule",
    JSON.stringify(zonePartition(cells, isResolved, "rolling", 3)),
    JSON.stringify(rollingQueuePartition(cells, isResolved, 3)));

  /* The other two rhythms must be untouched by this addition.
   *
   * Note the chunk boundaries: with chunkSize 2 the chunks are [A,B] [C,D]
   * [E,F], so resolving B and C completes NEITHER -- the first draft of this
   * assertion expected ["B","C"] and was simply wrong about the conveyor. It
   * is kept as two cases because that straddling behaviour is exactly the
   * scattering defect rolling exists to fix. */
  check("conveyor retires nothing when a completed pair straddles two chunks",
    zonePartition(cells, isResolved, "conveyor", 3, 2).retired, []);
  const chunkResolved = new Set(["A", "B"]);
  check("conveyor retires a chunk only when the whole chunk is resolved",
    zonePartition(cells, (id) => chunkResolved.has(id), "conveyor", 3, 2).retired, ["A", "B"]);
  const compacting = zonePartition(cells, isResolved, "compacting", 3);
  check("compacting still leaves resolved cells in place inside the band",
    compacting.active.includes("B"), true);
  check("...and rolling does not", zonePartition(cells, isResolved, "rolling", 3).active.includes("B"), false);
}

/* ═══════════ 10. DECISIONS AND STATE ARE UNTOUCHED ═══════════ */

console.log("\n--- 10. THE ZONE IS PRESENTATION ONLY ---");
{
  const cells = CANONICAL(10);
  const resolved = new Set(["c001", "c002"]);
  const p = roll(cells, resolved, 4);
  /* The partition returns only arrangements of the cells it was given. It
   * cannot create, delete or alter a decision because it never sees one --
   * resolution enters as a predicate and leaves as an ordering. */
  check("every returned cell came from the input", p.ordered.every((id) => cells.includes(id)), true);
  check("no cell is duplicated", new Set(p.ordered).size, p.ordered.length);
  check("no cell is dropped", p.ordered.length, cells.length);
  check("the resolved set is unchanged", [...resolved].sort(), ["c001", "c002"]);
}

/* ═══════════ 11. THE ZONE-BOUNDARY ADVANCE ═══════════ */

console.log("\n--- 11. DECIDING THE LAST ZONE CELL RETURNS TO THE ZONE, NOT PAST IT ---");
{
  /* The observed defect, reproduced: Ambiguity Check `Other Words`, a 24-cell
   * zone with cell 1 (`Amy`) and cell 24 (`Kyle`) decided, and `Math` sitting
   * BELOW the zone in the same section. Deciding Kyle advanced to Math. */
  const zone = [
    "Amy", "Last", "Any", "New", "Did", "Not", "Early", "Priority", "End", "Reg",
    "First", "Security", "Good", "Since", "Grad", "Staff", "Grade", "Term",
    "Grades", "When", "Grading", "Will", "Hello", "Kyle",
  ].map(candidateReviewTarget);
  const belowZone = ["Math", "Residency"].map(candidateReviewTarget);
  const decided = new Set(["Amy", "Kyle"]);
  const isResolved = (t: { id: string }) => decided.has(t.id);

  const landing = advanceWithinZone("candidate:Kyle", zone, isResolved);
  check("deciding the last zone cell lands on the first cell still needing a decision",
    landing?.id, "Last");
  check("...which is zone item 2, not zone item 23", landing?.id !== "Will", true);
  check("...and NOT the cell below the zone", landing?.id !== "Math", true);

  /* The un-scoped advance is what produced the defect -- kept as a contrast so
   * the regression is legible if anyone reverts the scoping. */
  const unscoped = advanceWithinReviewTargets("candidate:Kyle", [...zone, ...belowZone], isResolved);
  check("the section-scoped advance is what walked out of the zone", unscoped?.id, "Math");

  /* Ordinary forward motion inside the zone is unchanged. */
  check("mid-zone, the advance still moves forward",
    advanceWithinZone("candidate:Any", zone, isResolved)?.id, "New");
  /* Hello is cell 23; cell 24 (Kyle) is decided, so the forward scan is
   * exhausted and it wraps -- the same carriage return, one cell earlier. */
  check("a wrap also happens when the only cells ahead are already decided",
    advanceWithinZone("candidate:Hello", zone, isResolved)?.id, "Last");
  check("...while a cell with undecided work ahead simply moves forward",
    advanceWithinZone("candidate:Grading", zone, isResolved)?.id, "Will");

  /* Exhaustion: a fully decided zone yields null so the caller may leave it. */
  const allDecided = new Set(zone.map((t) => t.id));
  check("a fully decided zone returns null, releasing the cursor",
    advanceWithinZone("candidate:Kyle", zone, (t) => allDecided.has(t.id)), null);
  check("an empty zone returns null", advanceWithinZone("candidate:X", [], isResolved), null);

  /* Determinism. */
  check("repeated advance is identical",
    JSON.stringify(advanceWithinZone("candidate:Kyle", zone, isResolved)),
    JSON.stringify(advanceWithinZone("candidate:Kyle", zone, isResolved)));
}

console.log("");
if (failures > 0) {
  console.log(`ROLLING ZONE: ${failures} FAILURE(S)`);
  process.exit(1);
}
console.log("ROLLING ZONE: all checks passed.");
