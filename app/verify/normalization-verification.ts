/**
 * normalization-verification.ts -- the Normalization processing step
 * (AG, 2026-08-03; engines/normalization/normalization.ts).
 *
 * Structured around the three things that could go wrong, in order of how
 * badly they would go wrong:
 *
 *   1. SAFETY -- normalizing something that should have stayed separate.
 *      Every "never normalize" case from Andrew's specification gets its
 *      own check, plus the empirically-found near-misses from his real
 *      transcript ("May Session", "For Fall", "The Reg", "Thanks Mrs").
 *   2. EVIDENCE -- losing or altering a detector span. The invariants are
 *      asserted as invariants (counts, ids, offsets, text), not sampled.
 *   3. REVERSIBILITY / SPAN NARROWING -- the redaction span is the name
 *      and only the name, and falls back to the whole span rather than
 *      guessing.
 *
 * NOT coverable here (browser-only): the Expert View "Normalized from"
 * layout, and how the collapsed list feels to review.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/normalization-verification.ts
 */

import type { Candidate, Occurrence } from "../src/domain/DocumentModel.js";
import { redactionSpanOf } from "../src/domain/DocumentModel.js";
import type { DetectionResult } from "../src/engines/DetectionEngine.js";
import { detectionCandidateKey } from "../src/engines/DetectionEngine.js";
import { normalizeDetection, emptyNormalization, stripAffixes, tokenize, hasPersonNameEvidence } from "../src/engines/normalization/normalization.js";

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

// ---- fixture builder ------------------------------------------------------
// Candidates are built through the DETECTOR'S OWN key function, so a test
// fixture can never accidentally be more (or less) mergeable than real
// detector output would be.

interface Spec {
  display: string;
  /** Occurrence literal texts; defaults to [display]. */
  texts?: string[];
  type?: string;
  /** Quality categories this candidate carries. */
  categories?: string[];
}

function build(specs: Spec[]): { detection: DetectionResult; categoriesOf: (id: string) => readonly string[] } {
  const candidates: Candidate[] = [];
  const occurrences: Occurrence[] = [];
  const categories = new Map<string, readonly string[]>();
  let blockCounter = 0;

  for (const spec of specs) {
    const type = spec.type ?? "person";
    const id = detectionCandidateKey(spec.display, type);
    const texts = spec.texts ?? [spec.display];
    const occurrenceIds: string[] = [];
    texts.forEach((text, index) => {
      const blockId = `block-${blockCounter++}`;
      const occurrenceId = `${id}:${blockId}:${index}`;
      occurrences.push({
        id: occurrenceId,
        candidateId: id,
        blockId,
        // A non-zero base offset throughout, so any narrowing arithmetic
        // that forgets to add the occurrence's own start is caught.
        startOffset: 100,
        endOffset: 100 + text.length,
        text,
        context: `...[${text}]...`,
        source: "fallback-name-regex",
      });
      occurrenceIds.push(occurrenceId);
    });
    candidates.push({
      id,
      detectedType: type,
      source: "fallback-name-regex",
      confidence: "low",
      normalizedValue: id.slice(id.indexOf(":") + 1),
      displayValue: spec.display,
      occurrenceIds,
    });
    categories.set(id, spec.categories ?? []);
  }

  return {
    detection: { schemaVersion: 1, candidates, occurrences },
    categoriesOf: (id) => categories.get(id) ?? [],
  };
}

const NAMED = ["known_first_name"];

function run(specs: Spec[]) {
  const { detection, categoriesOf } = build(specs);
  return { raw: detection, result: normalizeDetection(detection, { categoriesOf }) };
}

/** Did `display` get folded into a candidate whose display form is `into`? */
function mergedInto(result: ReturnType<typeof normalizeDetection>, display: string, into: string): boolean {
  const target = result.detection.candidates.find((c) => c.displayValue === into);
  if (!target) return false;
  const record = result.recordsByCandidate[target.id];
  return record !== undefined && record.variants.some((v) => v.displayValue === display);
}

function survives(result: ReturnType<typeof normalizeDetection>, display: string): boolean {
  return result.detection.candidates.some((c) => c.displayValue === display);
}

// ===========================================================================
console.log("--- SAFE NORMALIZATIONS (Andrew's specification, verbatim) ---");
{
  const { result } = run([
    { display: "Andrew", categories: NAMED },
    { display: "Hi Andrew" },
    { display: "Good morning Andrew" },
    { display: "Thanks Andrew" },
    { display: "Thanks, Andrew" },
    { display: "Andrew," },
    { display: "Nelly", categories: NAMED },
    { display: "Dear Nelly" },
    { display: "Berhanu", categories: NAMED },
    { display: "FYI Berhanu" },
  ]);
  check('"Hi Andrew" -> "Andrew"', mergedInto(result, "Hi Andrew", "Andrew"));
  check('"Good morning Andrew" -> "Andrew"', mergedInto(result, "Good morning Andrew", "Andrew"));
  check('"Thanks Andrew" -> "Andrew"', mergedInto(result, "Thanks Andrew", "Andrew"));
  check('"Thanks, Andrew" -> "Andrew"', mergedInto(result, "Thanks, Andrew", "Andrew"));
  check('"Dear Nelly" -> "Nelly"', mergedInto(result, "Dear Nelly", "Nelly"));
  check('"FYI Berhanu" -> "Berhanu" (additive prefix lexicon)', mergedInto(result, "FYI Berhanu", "Berhanu"));
  // "Andrew," -> "Andrew" is NOT free. Documented here because it is
  // counter-intuitive and worth pinning: the detector's key rule sees the
  // trailing comma, takes the person comma-reversal branch, and files
  // "Andrew," under " andrew" (leading space) -- a candidate genuinely
  // distinct from "andrew". Edge-punctuation trimming in retainedRange()
  // is what repairs it.
  check('the detector really does file "Andrew," separately (the reason this case exists)', detectionCandidateKey("Andrew,", "person") !== detectionCandidateKey("Andrew", "person"));
  check('"Andrew," -> "Andrew" (trailing punctuation)', mergedInto(result, "Andrew,", "Andrew"));
  check("the reviewer sees ONE Andrew candidate", result.detection.candidates.filter((c) => c.displayValue.toLowerCase().includes("andrew")).length === 1);
}

console.log("\n--- OCR / formatting tails ---");
{
  const { result } = run([
    { display: "Goodloe, Andrew", categories: ["surname_given_structure"] },
    { display: "Goodloe,   Andrew  Are", texts: ["Goodloe,   Andrew  Are"] },
    { display: "Cashay Jackson", categories: NAMED },
    { display: "Cashay Jackson Transcripts" },
  ]);
  check('"Goodloe,   Andrew  Are" -> "Goodloe, Andrew" (verb tail + repeated spaces)', mergedInto(result, "Goodloe,   Andrew  Are", "Goodloe, Andrew"));
  check('"Cashay Jackson Transcripts" -> "Cashay Jackson" (document-noise tail)', mergedInto(result, "Cashay Jackson Transcripts", "Cashay Jackson"));
  check("surname_given_structure counts as person-name evidence", hasPersonNameEvidence(["surname_given_structure"]));
  check("strong_name_structure alone does NOT (it matches 'Grades Due')", !hasPersonNameEvidence(["strong_name_structure"]));
}

// ===========================================================================
console.log("\n--- NEVER NORMALIZE: no semantic interpretation ---");
{
  // Expansion is not stripping -- neither direction may fire.
  const expansion = run([
    { display: "Chris", categories: NAMED },
    { display: "Christopher", categories: NAMED },
    { display: "Garcia", categories: ["known_surname"] },
    { display: "Margaret Garcia", categories: NAMED },
  ]);
  check("Chris and Christopher stay separate", survives(expansion.result, "Chris") && survives(expansion.result, "Christopher"));
  check("Garcia and Margaret Garcia stay separate", survives(expansion.result, "Garcia") && survives(expansion.result, "Margaret Garcia"));
  check("no merges at all in the expansion fixture", expansion.result.stats.candidatesCollapsed === 0);

  // Title narrowing and list splitting.
  const titles = run([
    { display: "Dean", categories: [] },
    { display: "Associate Dean" },
    { display: "Computer Science" },
    { display: "Engineering, Computer Science" },
  ]);
  check('"Associate Dean" does NOT become "Dean"', survives(titles.result, "Associate Dean") && titles.result.stats.candidatesCollapsed === 0);
  check('"Engineering, Computer Science" does NOT become "Computer Science"', survives(titles.result, "Engineering, Computer Science"));

  // Never discard.
  const discard = run([{ display: "Like" }, { display: "Will" }, { display: "Good Morning" }, { display: "Yes Thank" }, { display: "Hello Everyone" }]);
  check('"Like" and "Will" survive as candidates', survives(discard.result, "Like") && survives(discard.result, "Will"));
  check('an all-noise candidate ("Good Morning") is left exactly as detected', survives(discard.result, "Good Morning"));
  check('"Yes Thank" / "Hello Everyone" survive whole', survives(discard.result, "Yes Thank") && survives(discard.result, "Hello Everyone"));
  check("nothing was discarded", discard.result.detection.candidates.length === 5);
}

console.log("\n--- NEVER NORMALIZE: the gates, on real near-misses ---");
{
  // Gate 3 (name evidence) is the one doing the work in each of these:
  // the remainder IS a detected candidate every time.
  const { result } = run([
    { display: "May", categories: ["calendar_term", "ambiguous_lexical_token"] },
    { display: "May Session" },
    { display: "Fall", categories: ["season_or_academic_term", "expanded_common_language_token"] },
    { display: "For Fall" },
    { display: "Reg", categories: ["expanded_common_language_token"] },
    { display: "The Reg" },
    { display: "Correct", categories: ["expanded_common_language_token"] },
    { display: "Correct Begin" },
  ]);
  check('"May Session" does NOT merge into the calendar term "May"', survives(result, "May Session") && !mergedInto(result, "May Session", "May"));
  check('"For Fall" does NOT merge into "Fall"', survives(result, "For Fall"));
  check('"The Reg" does NOT merge into "Reg"', survives(result, "The Reg"));
  check('"Correct Begin" does NOT merge into "Correct"', survives(result, "Correct Begin"));
  check("gate 3 refused all four", result.stats.candidatesCollapsed === 0);

  // Gate 2 (corroboration): a plausible name that this document never
  // detected on its own is NOT invented.
  const uncorroborated = run([{ display: "Hi Berhanu" }]);
  check('"Hi Berhanu" stays whole when "Berhanu" was never detected alone', survives(uncorroborated.result, "Hi Berhanu"));

  // "Will" is ambiguous_lexical_token in the quality data -- classified
  // "unknown", never "ordinary" -- so it is never stripped as a prefix.
  const will = run([{ display: "Diana", categories: NAMED }, { display: "Will Diana" }]);
  check('"Will Diana" is NOT stripped to "Diana" (Will is name-ambiguous)', survives(will.result, "Will Diana"));

  // Interior tokens are identity-cleanup's territory, not this pass's.
  const interior = run([{ display: "Tanesha Collier", categories: NAMED }, { display: "Tanesha Can Collier" }]);
  check('"Tanesha Can Collier" is NOT normalized (interior token)', survives(interior.result, "Tanesha Can Collier"));

  // Non-person types are out of scope by construction.
  const nonPerson = run([
    { display: "a@b.com", type: "email" },
    { display: "Thanks a@b.com", type: "email" },
  ]);
  check("non-person types are never normalized", nonPerson.result.stats.candidatesCollapsed === 0);
}

console.log("\n--- NO TRANSITIVE COLLAPSE ---");
{
  // Chaining is structurally impossible, not merely filtered, and that is
  // worth pinning as a property rather than trusting: affix stripping is
  // GREEDY from both ends, so a retained remainder never itself has a
  // strippable edge -- meaning a merge target can never also be a merge
  // source. "Thanks Hi Andrew" therefore resolves DIRECTLY to "Andrew"
  // in one hop; it never routes through "Hi Andrew".
  //
  // normalizeDetection() keeps an explicit no-chaining filter anyway, as
  // defense-in-depth against a future non-greedy rule. If this block ever
  // fails, that filter has started earning its keep and the reasoning
  // above needs revisiting.
  const { result } = run([{ display: "Andrew", categories: NAMED }, { display: "Hi Andrew" }, { display: "Thanks Hi Andrew" }]);
  check('"Hi Andrew" merges into "Andrew"', mergedInto(result, "Hi Andrew", "Andrew"));
  check('"Thanks Hi Andrew" resolves DIRECTLY to "Andrew", not via "Hi Andrew"', mergedInto(result, "Thanks Hi Andrew", "Andrew"));
  check("both collapse, and only one Andrew candidate remains", result.stats.candidatesCollapsed === 2 && result.detection.candidates.length === 1);
  check(
    "no retained remainder is itself a merge source (the structural property)",
    Object.values(result.recordsByCandidate).every((record) => record.variants.every((v) => result.recordsByCandidate[v.candidateId] === undefined))
  );
}

// ===========================================================================
console.log("\n--- EVIDENCE PRESERVATION (invariants, not samples) ---");
{
  const { raw, result } = run([
    { display: "Andrew", texts: ["Andrew", "Andrew", "Andrew"], categories: NAMED },
    { display: "Thanks Andrew", texts: ["Thanks Andrew", "Thanks Andrew"] },
    { display: "Hi Andrew", texts: ["Hi Andrew"] },
    { display: "Good Morning" },
  ]);
  check("occurrence COUNT is invariant", raw.occurrences.length === result.detection.occurrences.length);
  const rawIds = new Set(raw.occurrences.map((o) => o.id));
  check("every occurrence id survives unchanged", result.detection.occurrences.every((o) => rawIds.has(o.id)) && result.detection.occurrences.length === rawIds.size);
  const rawById = new Map(raw.occurrences.map((o) => [o.id, o]));
  check(
    "original startOffset/endOffset/text/context are untouched",
    result.detection.occurrences.every((o) => {
      const before = rawById.get(o.id);
      return before !== undefined && before.startOffset === o.startOffset && before.endOffset === o.endOffset && before.text === o.text && before.context === o.context;
    })
  );
  const survivorIds = new Set(result.detection.candidates.map((c) => c.id));
  check("no occurrence is orphaned", result.detection.occurrences.every((o) => survivorIds.has(o.candidateId)));
  check(
    "candidate.occurrenceIds accounts for every occurrence exactly once",
    result.detection.candidates.reduce((n, c) => n + c.occurrenceIds.length, 0) === result.detection.occurrences.length
  );
  check("the input DetectionResult was not mutated", raw.candidates.length === 4 && raw.occurrences.every((o) => o.effectiveSpan === undefined));

  const target = result.detection.candidates.find((c) => c.displayValue === "Andrew")!;
  check("surviving candidate absorbed the variants' occurrences (3 + 2 + 1)", target.occurrenceIds.length === 6);
  const record = result.recordsByCandidate[target.id]!;
  check("every variant is named in the provenance record", record.variants.length === 2);
  check(
    "provenance records the original surface form verbatim",
    record.variants.some((v) => v.displayValue === "Thanks Andrew" && v.occurrenceCount === 2) && record.variants.some((v) => v.displayValue === "Hi Andrew" && v.occurrenceCount === 1)
  );
  check(
    "provenance names the removed tokens",
    record.variants.every((v) => v.removedLeading.length + v.removedTrailing.length > 0)
  );
  check("an untouched candidate gets NO provenance record", result.recordsByCandidate[detectionCandidateKey("Good Morning", "person")] === undefined);
  check("stats agree with the result", result.stats.candidatesBefore === 4 && result.stats.candidatesAfter === 2 && result.stats.candidatesCollapsed === 2 && result.stats.occurrencesRehomed === 3);
}

// ===========================================================================
console.log("\n--- REDACTION SPAN NARROWING ---");
{
  const { result } = run([
    { display: "Andrew", categories: NAMED },
    { display: "Thanks, Andrew", texts: ["Thanks, Andrew"] },
    { display: "Goodloe, Andrew", categories: ["surname_given_structure"] },
    { display: "Goodloe,   Andrew  Are", texts: ["Goodloe,   Andrew  Are"] },
  ]);
  const thanks = result.detection.occurrences.find((o) => o.text === "Thanks, Andrew")!;
  check("a merged occurrence carries an effectiveSpan", thanks.effectiveSpan !== undefined);
  check('redaction span text is "Andrew", not "Thanks, Andrew"', redactionSpanOf(thanks).text === "Andrew");
  check(
    "narrowed offsets are absolute within the block and correct",
    // "Thanks, Andrew" starts at 100; "Andrew" begins 8 chars in.
    redactionSpanOf(thanks).startOffset === 108 && redactionSpanOf(thanks).endOffset === 114
  );
  check(
    "the narrowed range actually indexes the name in the original text",
    thanks.text.slice(redactionSpanOf(thanks).startOffset - thanks.startOffset, redactionSpanOf(thanks).endOffset - thanks.startOffset) === "Andrew"
  );
  check("removed tokens are recorded on the span", thanks.effectiveSpan!.removed.join(" ") === "Thanks,");

  const ocr = result.detection.occurrences.find((o) => o.text === "Goodloe,   Andrew  Are")!;
  check('trailing-tail narrowing keeps the whole name ("Goodloe,   Andrew")', redactionSpanOf(ocr).text === "Goodloe,   Andrew");

  const plain = result.detection.occurrences.find((o) => o.text === "Andrew")!;
  check("an unmerged occurrence has NO effectiveSpan", plain.effectiveSpan === undefined);
  check("redactionSpanOf falls back to the original span", redactionSpanOf(plain).text === "Andrew" && redactionSpanOf(plain).startOffset === 100);
  check("every merged occurrence is either narrowed or deliberately left whole", result.stats.spansNarrowed + result.stats.spansLeftWhole === result.stats.occurrencesRehomed);
}

console.log("\n--- SPAN NARROWING FAILS SAFE ---");
{
  // A candidate whose occurrences do NOT all read like the display form.
  // The second occurrence's own stripped remainder is "Andrew Goodloe",
  // which is not the retained text the merge was justified by, so it
  // keeps its whole original span rather than being narrowed on a guess.
  const { result } = run([
    { display: "Andrew", categories: NAMED },
    { display: "Thanks Andrew", texts: ["Thanks Andrew", "Thanks Andrew Goodloe"] },
  ]);
  const occs = result.detection.occurrences.filter((o) => o.text.startsWith("Thanks"));
  check("the matching occurrence is narrowed", occs.find((o) => o.text === "Thanks Andrew")!.effectiveSpan !== undefined);
  const mismatched = occs.find((o) => o.text === "Thanks Andrew Goodloe")!;
  check("the mismatched occurrence is NOT narrowed", mismatched.effectiveSpan === undefined);
  check("and redacts its whole original span (over-redact beats under-redact)", redactionSpanOf(mismatched).text === "Thanks Andrew Goodloe");
  check("stats count it as left-whole", result.stats.spansLeftWhole === 1 && result.stats.spansNarrowed === 1);
}

// ===========================================================================
console.log("\n--- PRIMITIVES ---");
{
  check("tokenize records offsets", JSON.stringify(tokenize("Hi  Andrew")) === JSON.stringify([{ text: "Hi", start: 0, end: 2 }, { text: "Andrew", start: 4, end: 10 }]));
  const all = tokenize("Good Morning");
  check("stripAffixes never strips everything", JSON.stringify(stripAffixes(all)) === JSON.stringify({ start: 0, end: 2 }));
  const one = tokenize("Thanks, Andrew");
  check("stripAffixes strips a leading greeting with punctuation", JSON.stringify(stripAffixes(one)) === JSON.stringify({ start: 1, end: 2 }));
  check("hasPersonNameEvidence accepts snake and kebab spellings", hasPersonNameEvidence(["known-first-name"]) && hasPersonNameEvidence(["known_first_name"]));
  check("hasPersonNameEvidence rejects empty categories", !hasPersonNameEvidence([]));

  const { detection } = build([{ display: "Andrew" }]);
  const empty = emptyNormalization(detection);
  check("emptyNormalization is a well-formed no-op", empty.detection === detection && empty.stats.candidatesCollapsed === 0 && Object.keys(empty.recordsByCandidate).length === 0);
}

console.log(`\n${passCount}/${passCount + failCount} checks passed`);
process.exitCode = failCount === 0 ? 0 : 1;
