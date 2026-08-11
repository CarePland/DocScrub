/**
 * review-necessity-verification.ts -- the contract for `Unlikely`
 * (AG, 2026-08-10).
 *
 *     node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs \
 *          verify/review-necessity-verification.ts
 *
 * Two kinds of assertion, and the distinction matters:
 *
 *   §1-§6  BEHAVIOURAL. The determination and the query layer are pure and
 *          importable, so these actually execute the shipped code -- including
 *          against the REAL 601-candidate production export, which pins the
 *          measured 175/426 split.
 *
 *   §7     SOURCE SCAN over app.ts, which has zero exports and cannot be
 *          behaviourally tested. Weak, and labelled as such.
 *
 * THE POINT OF THIS SUITE is not that the number is 175. It is that no
 * candidate can become Unlikely through absence of evidence, through a Person
 * reading, through a protective detection, or through contest -- and that
 * being Unlikely changes nothing except which list a candidate appears in.
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import {
  NON_SENSITIVE_INTERPRETATIONS,
  PROTECTIVE_DETECTED_TYPES,
  REVIEW_NECESSITY_LABELS,
  reviewNecessityFor,
} from "../src/engines/review/reviewNecessity.js";
import {
  UNLIKELY_PRESET,
  createDefaultQueryState,
  queryItemCheck,
  unlikelyCount,
  type CandidateQueryFacts,
} from "../src/ui/itemCheckQuery.js";
import type { InterpretationId, InterpretationProfile } from "../src/engines/interpretation/interpretation-model.js";
import type { Candidate } from "../src/domain/DocumentModel.js";

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

/** A profile with the given readings; signals are shaped but not meaningful
 *  here -- the predicate reads ids and counts, never signal content. */
function profileOf(value: string, ...ids: InterpretationId[]): InterpretationProfile {
  return {
    candidateId: `c:${value}`,
    value,
    outcome: ids.length === 0 ? "unsupported" : ids.length === 1 ? "single" : "contested",
    interpretations: ids.map((id) => ({
      id,
      signals: [{ signalId: `${id}/x`, class: "lexicon-recognition", detail: "", provenance: "CandidateQualityEngine", lineage: ["docscrub-quality-lexicons"] }],
    })),
  };
}

console.log("=== REVIEW NECESSITY (Unlikely) ===");

/* ═══════════ 1. THE PREDICATE IS AFFIRMATIVE-ONLY ═══════════ */

console.log("\n--- 1. NOTHING BECOMES UNLIKELY THROUGH ABSENCE ---");
{
  check("unsupported stays review-required",
    reviewNecessityFor("person", profileOf("Acad Struc")).necessity, "review-required");
  check("...with a reason naming silence",
    /silence is not an explanation/.test(reviewNecessityFor("person", profileOf("x")).reason), true);
  check("a missing profile stays review-required",
    reviewNecessityFor("person", undefined).necessity, "review-required");
  check("contested stays review-required",
    reviewNecessityFor("person", profileOf("Grad Office", "organization", "domain-terminology")).necessity, "review-required");
  check("two non-sensitive readings are still contested, not Unlikely",
    reviewNecessityFor("person", profileOf("For Fall", "date-or-term", "ordinary-language")).necessity, "review-required");
}

/* ═══════════ 2. PERSON AND PROTECTIVE PII ALWAYS PREVENT IT ═══════════ */

console.log("\n--- 2. PERSON AND TYPED PII ARE NEVER TRIAGED AWAY ---");
{
  check("a surviving Person reading prevents Unlikely",
    reviewNecessityFor("person", profileOf("Andrew", "person")).necessity, "review-required");
  check("Person alongside a non-sensitive reading also prevents it",
    reviewNecessityFor("person", profileOf("Andrew", "person", "ordinary-language")).necessity, "review-required");
  for (const detectedType of PROTECTIVE_DETECTED_TYPES) {
    check(`${detectedType}: protective detection prevents Unlikely even with a lone ordinary-language reading`,
      reviewNecessityFor(detectedType, profileOf("x", "ordinary-language")).necessity, "review-required");
  }
  check("organizations remain review-required",
    reviewNecessityFor("person", profileOf("Civitas", "organization")).necessity, "review-required");
  check("place remains review-required (not in the non-sensitive set)",
    reviewNecessityFor("person", profileOf("San Diego", "place")).necessity, "review-required");
}

/* ═══════════ 3. WHAT DOES QUALIFY, AND WHY ═══════════ */

console.log("\n--- 3. THE QUALIFYING SHAPE ---");
{
  for (const id of NON_SENSITIVE_INTERPRETATIONS) {
    const r = reviewNecessityFor("person", profileOf("x", id));
    check(`a lone ${id} reading qualifies`, r.necessity, "unlikely");
    check(`...and records ${id} as the explanation`, r.explanation, id);
  }
  const r = reviewNecessityFor("person", profileOf("Academic Service", "domain-terminology"));
  check("affirmative evidence classes are carried through", [...r.affirmativeEvidence], ["lexicon-recognition"]);
  check("the reason states the predicate, not a verdict",
    /exactly one affirmative reading/.test(r.reason), true);
  check("no confidence value is produced anywhere",
    /"(confidence|score|weight|probability|percent)"\s*:/i.test(JSON.stringify(r)), false);
}

/* ═══════════ 4. VOCABULARY ═══════════ */

console.log("\n--- 4. THE CLAIM IS DELIBERATELY WEAK ---");
{
  check("the reviewer-facing label is `Unlikely`", REVIEW_NECESSITY_LABELS.unlikely, "Unlikely");
  const source = readFileSync("src/engines/review/reviewNecessity.ts", "utf8");
  const code = source.split("\n").filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//")).join("\n");
  const overclaims = ["safe", "definitely", "resolved", "ignored", "irrelevant", "harmless", "non-sensitive candidate"]
    .filter((w) => new RegExp(`\\b${w}\\b`, "i").test(code));
  check("the module's code never claims safe/resolved/ignored/irrelevant", overclaims, []);
  check("it creates no decision", /CandidateDecision|decision\s*[:=]/.test(code), false);
  check("it creates no automatic resolution", /AutomaticResolution/.test(code), false);
}

/* ═══════════ 5. THE QUERY LAYER: EXCLUDED BY DEFAULT, REVEALED ON REQUEST ═══════════ */

console.log("\n--- 5. NAVIGATION EXCLUDES UNLIKELY; THE FILTER BRINGS IT BACK ---");
{
  const candidate = (id: string): Candidate => ({
    id, detectedType: "person", source: "regex", confidence: "medium",
    normalizedValue: id, displayValue: id, occurrenceIds: [`o:${id}`],
  });
  const facts: CandidateQueryFacts[] = [
    { candidate: candidate("active-1"), likelihood: 50, decision: undefined, isAmbiguous: false, categories: [], reviewNecessity: "review-required" },
    { candidate: candidate("active-2"), likelihood: 60, decision: undefined, isAmbiguous: false, categories: [], reviewNecessity: "review-required" },
    { candidate: candidate("unlikely-1"), likelihood: 10, decision: undefined, isAmbiguous: false, categories: [], reviewNecessity: "unlikely", unlikelyExplanation: "ordinary-language" },
    { candidate: candidate("unlikely-2"), likelihood: 20, decision: undefined, isAmbiguous: false, categories: [], reviewNecessity: "unlikely", unlikelyExplanation: "acronym" },
    /* A fact built WITHOUT the field at all -- every pre-existing caller. */
    { candidate: candidate("legacy"), likelihood: 30, decision: undefined, isAmbiguous: false, categories: [] },
  ];

  const normal = queryItemCheck(facts, createDefaultQueryState()).map((f) => f.candidate.id);
  check("the default list excludes Unlikely", normal, ["active-2", "active-1", "legacy"]);
  check("a fact with no reviewNecessity field is treated as review-required", normal.includes("legacy"), true);

  const revealed = queryItemCheck(facts, { ...createDefaultQueryState(), activePresets: new Set([UNLIKELY_PRESET]) })
    .map((f) => f.candidate.id);
  check("selecting the Unlikely preset shows exactly the Unlikely population", revealed, ["unlikely-2", "unlikely-1"]);
  check("...so they are navigable again", revealed.length, 2);

  check("the count is derived from the same field the exclusion reads", unlikelyCount(facts), 2);
  check("total facts remain untouched -- nothing was deleted", facts.length, 5);

  /* Counts must stay internally consistent: active + unlikely = total. */
  check("active + unlikely = total", normal.length + unlikelyCount(facts), facts.length);
}

/* ═══════════ 6. THE REAL 601-CANDIDATE PRODUCTION EXPORT ═══════════ */

console.log("\n--- 6. THE MEASURED PRODUCTION SPLIT ---");
{
  const path = "investigation/data/interpretation-population.json";
  if (!existsSync(path)) {
    console.log(`  SKIP  export not present at ${path} -- the 175/426 pin cannot be checked here.`);
  } else {
    interface ExpRow { candidateId: string; value: string; interpretations: Array<{ id: string; domain: string | null; signals: Array<{ signalId: string; class: string; provenance: string; lineage: string[] }> }> }
    const rows: ExpRow[] = JSON.parse(readFileSync(path, "utf8"));
    check("the export is the 601-candidate production population", rows.length, 601);

    let unlikely = 0;
    let active = 0;
    const violations: string[] = [];
    for (const row of rows) {
      const detectedType = row.candidateId.split(":")[0] ?? "person";
      const profile: InterpretationProfile = {
        candidateId: row.candidateId,
        value: row.value,
        outcome: row.interpretations.length === 0 ? "unsupported" : row.interpretations.length === 1 ? "single" : "contested",
        interpretations: row.interpretations.map((i) => ({
          id: i.id as InterpretationId,
          ...(i.domain ? { domain: i.domain } : {}),
          signals: i.signals.map((s) => ({ signalId: s.signalId, class: s.class as never, detail: "", provenance: s.provenance, lineage: s.lineage as never })),
        })),
      };
      const result = reviewNecessityFor(detectedType, profile);
      if (result.necessity === "unlikely") {
        unlikely += 1;
        /* Safety invariants, re-checked on every real candidate rather than
         * trusted from the unit cases above. */
        if (row.interpretations.some((i) => i.id === "person")) violations.push(`${row.value}: person reading`);
        if (row.interpretations.length !== 1) violations.push(`${row.value}: ${row.interpretations.length} readings`);
        if (PROTECTIVE_DETECTED_TYPES.includes(detectedType)) violations.push(`${row.value}: protective ${detectedType}`);
        if (row.interpretations[0] && !NON_SENSITIVE_INTERPRETATIONS.includes(row.interpretations[0].id as InterpretationId)) {
          violations.push(`${row.value}: sensitive reading ${row.interpretations[0].id}`);
        }
      } else active += 1;
    }

    check("175 candidates are Unlikely", unlikely, 175);
    check("426 remain active review", active, 426);
    check("the two populations partition the document exactly", unlikely + active, rows.length);
    check("no safety invariant is violated on any real candidate", violations, []);
  }
}

/* ═══════════ 7. NOTHING ELSE CHANGED ═══════════ */

console.log("\n--- 7. SCOPE (source scan over app.ts -- NOT behavioural verification) ---");
{
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith(".ts")) files.push(full.replace(/\\/g, "/"));
    }
  };
  walk("src");
  const sourceOf = new Map(files.map((f) => [f, readFileSync(f, "utf8")]));

  /* `proposedGroups.ts` joined 2026-08-10. It imports the two CONSTANTS --
   * NON_SENSITIVE_INTERPRETATIONS and PROTECTIVE_DETECTED_TYPES -- rather than
   * restating them, which is the point: "non-sensitive" and "never triaged
   * away" must mean one thing in this application, and a second copy in a
   * sibling triage module is exactly how they would drift apart. It does NOT
   * call `reviewNecessityFor` and does not widen, narrow or re-derive the
   * Unlikely predicate; §1-§6 above are unchanged by its existence, and
   * verify/quick-approval-verification.ts asserts that the Quick Approval
   * block in app.ts redefines nothing here. */
  check("review necessity is consumed only by the query layer, proposed groups and the UI",
    [...sourceOf.entries()].filter(([, s]) => /from\s+"[^"]*\/reviewNecessity\.js"/.test(s)).map(([f]) => f).sort(),
    ["src/engines/review/proposedGroups.ts", "src/ui/app.ts", "src/ui/itemCheckQuery.ts"]);

  /* The modules that decide, persist or export must not have learned it. */
  for (const module of [
    "src/domain/semanticTypes.ts",
    "src/engines/quality/scoring.ts",
    "src/engines/review/residualReviewGate.ts",
    "src/engines/review/session.ts",
    "src/engines/EntityResolutionEngine.ts",
    "src/io/AuditExporter.ts",
    "src/workspace/Workspace.ts",
  ]) {
    const src = sourceOf.get(module);
    check(`${module} is present`, typeof src, "string");
    if (typeof src !== "string") continue;
    check(`${module} does not mention review necessity`,
      /reviewNecessityFor|ReviewNecessity|"unlikely"/.test(src), false);
  }

  const app = sourceOf.get("src/ui/app.ts")!;
  check("the UI creates no decision from Unlikely",
    /unlikely[^\n]{0,80}(applyDecision|CandidateDecision|dispatch)/i.test(app), false);
  check("the UI creates no automatic resolution from Unlikely",
    /unlikely[^\n]{0,80}AutomaticResolution/i.test(app), false);
}

console.log("");
if (failures > 0) {
  console.log(`REVIEW NECESSITY: ${failures} FAILURE(S)`);
  process.exit(1);
}
console.log("REVIEW NECESSITY: all checks passed.");
console.log("NOTE: §7 is a source scan over app.ts and is NOT behavioural verification.");
