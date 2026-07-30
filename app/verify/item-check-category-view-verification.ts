/**
 * item-check-category-view-verification.ts -- RX-02a (Reviewer Experience
 * Wave 1, 2026-07-29). Pure-function suite for
 * src/ui/itemCheckCategoryView.ts's narrowByCategoryView(): Category
 * Check's review-state + category narrowing, extracted from
 * renderCategoryCheckPanel's DOM pass so the renderer and keyboard
 * navigation (visibleItemCheckIds) share one membership/order source.
 *
 * Everything here is DOM-free by construction -- facts in, ids out. What
 * this suite deliberately does NOT cover (browser-only, disclosed per the
 * project's standing practice): that app.ts actually renders the same list
 * this helper returns, which requires a live DOM.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/item-check-category-view-verification.ts
 */

import { narrowByCategoryView, type CategoryViewFacts } from "../src/ui/itemCheckCategoryView.js";

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

function checkIds(label: string, actual: string[], expected: string[]): void {
  const same = actual.length === expected.length && actual.every((id, i) => id === expected[i]);
  check(label, same, `expected [${expected.join(", ")}], got [${actual.join(", ")}]`);
}

function facts(candidateId: string, status: CategoryViewFacts["status"], categories: string[] = []): CategoryViewFacts {
  return { candidateId, status, categories };
}

// A small pool mirroring the real shapes: statuses mixed, some candidates
// carrying multiple categories, some none.
const pool: CategoryViewFacts[] = [
  facts("a", "toReview", ["single-occurrence", "unknown-capitalized"]),
  facts("b", "resolved", ["single-occurrence"]),
  facts("c", "unlikely", ["institution-term"]),
  facts("d", "toReview", []),
  facts("e", "toReview", ["institution-term", "single-occurrence"]),
  facts("f", "resolved", []),
];

console.log('--- review-state axis ("total" chip = no state narrowing) ---');
checkIds(
  '"total" + Show All returns every candidate in input order',
  narrowByCategoryView(pool, { reviewState: "total", categoryFilter: null }),
  ["a", "b", "c", "d", "e", "f"]
);
checkIds(
  '"toReview" keeps only toReview candidates, input order preserved',
  narrowByCategoryView(pool, { reviewState: "toReview", categoryFilter: null }),
  ["a", "d", "e"]
);
checkIds(
  '"resolved" keeps only resolved candidates',
  narrowByCategoryView(pool, { reviewState: "resolved", categoryFilter: null }),
  ["b", "f"]
);
checkIds(
  '"unlikely" keeps only unlikely candidates',
  narrowByCategoryView(pool, { reviewState: "unlikely", categoryFilter: null }),
  ["c"]
);

console.log("--- category axis ---");
checkIds(
  "category filter keeps only candidates carrying that category",
  narrowByCategoryView(pool, { reviewState: "total", categoryFilter: "single-occurrence" }),
  ["a", "b", "e"]
);
checkIds(
  "a candidate with several categories matches on any of them",
  narrowByCategoryView(pool, { reviewState: "total", categoryFilter: "unknown-capitalized" }),
  ["a"]
);
checkIds(
  "a category no candidate carries narrows to nothing",
  narrowByCategoryView(pool, { reviewState: "total", categoryFilter: "no-such-category" }),
  []
);

console.log("--- both axes combined (state first, then category -- same as the renderer) ---");
checkIds(
  'toReview + "single-occurrence" applies both narrowings',
  narrowByCategoryView(pool, { reviewState: "toReview", categoryFilter: "single-occurrence" }),
  ["a", "e"]
);
checkIds(
  'resolved + "institution-term" can narrow to nothing even though each axis alone matches',
  narrowByCategoryView(pool, { reviewState: "resolved", categoryFilter: "institution-term" }),
  []
);

console.log("--- order preservation (the incoming order is Item Check's own sort output) ---");
const reversed = [...pool].reverse();
checkIds(
  "input order is preserved, never re-imposed (reversed input stays reversed)",
  narrowByCategoryView(reversed, { reviewState: "toReview", categoryFilter: null }),
  ["e", "d", "a"]
);

console.log("--- edges ---");
checkIds("empty facts narrow to an empty list", narrowByCategoryView([], { reviewState: "total", categoryFilter: null }), []);
check(
  "the input array is not mutated",
  pool.length === 6 && pool[0]!.candidateId === "a" && reversed[0]!.candidateId === "f"
);

console.log(`\n${passCount}/${passCount + failCount} checks passed`);
process.exitCode = failCount === 0 ? 0 : 1;
