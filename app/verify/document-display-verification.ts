/**
 * document-display-verification.ts — Application Frame Refinement
 * (AG, 2026-08-01). Pure-function suite for
 * src/ui/documentDisplay.ts's documentDisplaySummary(): the header's
 * document-identity truncation policy (up to `limit` names inline, the
 * rest behind a "+N ▼" expansion — the spec's own "Document A • Document
 * B • Document C • +4 ▼" example is exercised literally below).
 *
 * What this suite cannot cover (browser-only, disclosed per standing
 * practice): the header renderer in app.ts (bolding the active name,
 * click-to-resume, the inline expansion panel) — that path runs through
 * the live DOM.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/document-display-verification.ts
 */

import { documentDisplaySummary } from "../src/ui/documentDisplay.js";

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

console.log("document-display-verification");

{
  const s = documentDisplaySummary([]);
  check("empty list shows nothing", s.shown.length === 0 && s.overflow === 0);
}

{
  const s = documentDisplaySummary(["A.docx"]);
  check("single name shows inline", s.shown.join("|") === "A.docx" && s.overflow === 0);
}

{
  const s = documentDisplaySummary(["A", "B"]);
  check("two names show inline", s.shown.join("|") === "A|B" && s.overflow === 0);
}

{
  const s = documentDisplaySummary(["A", "B", "C"]);
  check("exactly three names show inline with no overflow", s.shown.join("|") === "A|B|C" && s.overflow === 0);
}

{
  // The spec's own example: seven open documents -> three inline, "+4".
  const s = documentDisplaySummary(["A", "B", "C", "D", "E", "F", "G"]);
  check("spec example: 7 docs -> first three + overflow 4", s.shown.join("|") === "A|B|C" && s.overflow === 4);
}

{
  const s = documentDisplaySummary(["A", "B", "C", "D"]);
  check("four docs -> three inline + overflow 1", s.shown.join("|") === "A|B|C" && s.overflow === 1);
}

{
  const s = documentDisplaySummary(["A", "B", "C", "D"], 2);
  check("custom limit honored", s.shown.join("|") === "A|B" && s.overflow === 2);
}

{
  const s = documentDisplaySummary(["A", "B"], 0);
  check("degenerate limit shows nothing, everything overflows", s.shown.length === 0 && s.overflow === 2);
}

{
  const input = ["A", "B"];
  const s = documentDisplaySummary(input);
  s.shown.push("mutated");
  check("returned array is a copy (input not aliased)", input.length === 2);
}

{
  const s = documentDisplaySummary(["Z", "A", "M", "Q"]);
  check("input order preserved (active-first ordering is the caller's contract)", s.shown.join("|") === "Z|A|M");
}

console.log(`document-display-verification: ${passCount}/${passCount + failCount} checks passed`);
if (failCount > 0) process.exit(1);
