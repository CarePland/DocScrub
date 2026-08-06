/**
 * visible-list-advance-verification.ts -- RX-02b (Reviewer Experience
 * Wave 1, 2026-07-29). Pure-function suite for
 * src/ui/visibleListAdvance.ts's advanceWithinVisibleList(): the
 * post-decision advance computed over the DISPLAYED order (forward, then
 * backward, then stay; never wrapping), with the backward fallback that is
 * RX-12's acceptance criterion.
 *
 * Everything here is DOM-free by construction -- an id array, a current id,
 * and a resolved-predicate in; an id (or null = remain in place) out.
 * "Sorted" and "narrowed" visible lists are represented exactly the way the
 * caller passes them: as id arrays whose order/membership differ from
 * structural order, since the helper deliberately knows nothing about WHY
 * the list is ordered or narrowed the way it is. What this suite cannot
 * cover (browser-only, disclosed per standing practice): that app.ts's
 * dispatchReviewWithVisibleAdvance snapshots/dispatches/re-selects
 * correctly around this helper -- that path runs through the live
 * dispatcher and DOM render.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/visible-list-advance-verification.ts
 */

import { advanceWithinVisibleList } from "../src/ui/visibleListAdvance.js";

let passCount = 0;
let failCount = 0;

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passCount += 1;
    console.log(`  PASS ${label}`);
  } else {
    failCount += 1;
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

function checkAdvance(label: string, actual: string | null, expected: string | null): void {
  check(label, actual === expected, `expected ${expected === null ? "null (remain)" : expected}, got ${actual === null ? "null (remain)" : actual}`);
}

const resolvedIn = (resolved: string[]) => (id: string) => resolved.includes(id);

console.log("--- visible-order advancement (forward) ---");
checkAdvance(
  "advances to the NEXT visible item when it is unresolved",
  advanceWithinVisibleList("b", ["a", "b", "c", "d"], resolvedIn(["b"])),
  "c"
);
checkAdvance(
  "skips resolved items moving forward to the nearest unresolved one",
  advanceWithinVisibleList("a", ["a", "b", "c", "d"], resolvedIn(["a", "b", "c"])),
  "d"
);
checkAdvance(
  "starts strictly AFTER the current item (never re-lands on it)",
  advanceWithinVisibleList("b", ["a", "b", "c"], resolvedIn(["a", "b"])),
  "c"
);

console.log("--- backward fallback (RX-12's acceptance criterion) ---");
checkAdvance(
  "falls back to the nearest EARLIER unresolved item when nothing is unresolved ahead",
  advanceWithinVisibleList("d", ["a", "b", "c", "d"], resolvedIn(["c", "d"])),
  "b"
);
checkAdvance(
  "backward fallback picks the NEAREST earlier item, not the first in the list",
  advanceWithinVisibleList("d", ["a", "b", "c", "d"], resolvedIn(["d"])),
  "c"
);
checkAdvance(
  "last-item decision with several unresolved above lands on the closest one above",
  advanceWithinVisibleList("e", ["a", "b", "c", "d", "e"], resolvedIn(["b", "d", "e"])),
  "c"
);

console.log("--- all visible items resolved: remain in place ---");
checkAdvance(
  "returns null (remain on the current item) when every visible item is resolved",
  advanceWithinVisibleList("b", ["a", "b", "c"], resolvedIn(["a", "b", "c"])),
  null
);
checkAdvance("single-item list, that item resolved: remain", advanceWithinVisibleList("a", ["a"], resolvedIn(["a"])), null);

console.log("--- no wrapping (unlike ']'/'[', which wrap by design) ---");
checkAdvance(
  "deciding the last item does NOT wrap to an unresolved first item when items between are resolved -- backward finds the nearest above instead",
  advanceWithinVisibleList("d", ["a", "b", "c", "d"], resolvedIn(["b", "c", "d"])),
  "a"
);
checkAdvance(
  "from the FIRST item, never wraps to the end: forward only",
  advanceWithinVisibleList("a", ["a", "b", "c"], resolvedIn(["a", "b"])),
  "c"
);
checkAdvance(
  "from the last item with nothing unresolved anywhere, no wrap-and-spin: remain",
  advanceWithinVisibleList("c", ["a", "b", "c"], resolvedIn(["a", "b", "c"])),
  null
);

console.log("--- sorted visible lists (order-following, not structural) ---");
// Structural order is a,b,c,d; the reviewer's alphabetical sort displays
// them as d,c,b,a. Advancement must follow the DISPLAYED order.
checkAdvance(
  "follows the displayed (sorted) order, not the structural one",
  advanceWithinVisibleList("d", ["d", "c", "b", "a"], resolvedIn(["d"])),
  "c"
);
checkAdvance(
  "sorted list, forward exhausted: backward fallback also follows displayed order",
  advanceWithinVisibleList("b", ["d", "c", "b", "a"], resolvedIn(["b", "a"])),
  "c"
);

console.log("--- narrowed visible lists (filter active) ---");
// Structural pool a..f; the active filter shows only [b, e, f]. The
// just-decided item was snapshotted pre-decision, so it is still present.
checkAdvance(
  "advances only within the narrowed membership -- hidden items can never be landed on",
  advanceWithinVisibleList("b", ["b", "e", "f"], resolvedIn(["b"])),
  "e"
);
checkAdvance(
  "narrowed list fully resolved: remain, even if hidden structural items are unresolved (the predicate only ever sees visible ids)",
  advanceWithinVisibleList("f", ["b", "e", "f"], resolvedIn(["b", "e", "f"])),
  null
);

console.log("--- defensive edges ---");
checkAdvance("empty visible list: null", advanceWithinVisibleList("a", [], resolvedIn([])), null);
checkAdvance(
  "null currentId scans the whole list forward from the start",
  advanceWithinVisibleList(null, ["a", "b", "c"], resolvedIn(["a"])),
  "b"
);
checkAdvance(
  "currentId absent from the list scans forward from the start (no backward leg exists)",
  advanceWithinVisibleList("zz", ["a", "b", "c"], resolvedIn(["a"])),
  "b"
);

console.log("--- parity with navigator.ts findByPredicate(dir: 'forward') semantics ---");
// Same scan discipline as the domain's own advance (forward from idx+1,
// then backward from idx-1), minus its final remain-in-place fallback,
// which the caller expresses as `?? currentId`.
checkAdvance(
  "forward-then-backward ordering: a nearer BACKWARD candidate never beats an available forward one",
  advanceWithinVisibleList("c", ["a", "b", "c", "d", "e"], resolvedIn(["c", "d"])),
  "e"
);

console.log("--- SEPARATION: the anchor itself LEAVES the list (AG, 2026-08-03 regression) ---");
// "Separate these" is the one action that removes a row from view as a
// side effect of deciding it. The choke point's own last resort -- remain
// on the item just decided -- therefore parked focus on a group that no
// longer rendered, which reads to the reviewer as "there is no focused
// item at all". completeSplitReview re-anchors on the removed group's
// PREDECESSOR against the post-hide list; these pin that composition.
{
  const before = ["g1", "g2", "g3"]; // g2 is the one being separated
  const afterHide = ["g1", "g3"];
  checkAdvance(
    "unresolved work remains: focus continues FORWARD from the separated group's position, never onto the hidden group",
    advanceWithinVisibleList("g1", afterHide, resolvedIn(["g1", "g2"])),
    "g3"
  );
  checkAdvance(
    "everything resolved: returns null, so the caller falls back to a VISIBLE anchor rather than the hidden one",
    advanceWithinVisibleList("g1", afterHide, resolvedIn(["g1", "g2", "g3"])),
    null
  );
  checkAdvance(
    "the separated group is the FIRST row: a null anchor scans from the start of what is left",
    advanceWithinVisibleList(null, ["g2", "g3"], resolvedIn(["g1"])),
    "g2"
  );
  checkAdvance(
    "an anchor that was itself hidden earlier resolves to -1 and still scans the whole remaining list",
    advanceWithinVisibleList("gone", afterHide, resolvedIn(["g1"])),
    "g3"
  );
  check(
    "the hidden group can never be the landing, in any of these",
    [
      advanceWithinVisibleList("g1", afterHide, resolvedIn(["g1", "g2"])),
      advanceWithinVisibleList("g1", afterHide, resolvedIn(["g1", "g2", "g3"])),
      advanceWithinVisibleList("gone", afterHide, resolvedIn(["g1"])),
    ].every((landing) => landing !== "g2"),
    ""
  );
  check("the pre-hide order still knows where the separated group was", before.indexOf("g2") === 1 && before[before.indexOf("g2") - 1] === "g1", "");
}

console.log(`\n${passCount}/${passCount + failCount} checks passed`);
process.exitCode = failCount === 0 ? 0 : 1;
