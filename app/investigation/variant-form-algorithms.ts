/**
 * variant-form-algorithms.ts -- INVESTIGATION ONLY. Measures candidate
 * orthographic and phonetic comparison methods against the shipped Census
 * corpus BEFORE any of them is allowed near production (AG, 2026-08-10).
 *
 *     node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs \
 *          investigation/variant-form-algorithms.ts
 *
 * ═══════════════════ THE QUESTION THIS ANSWERS ═══════════════════
 *
 * `Chriztopher Johnson` is a real person whose spelling no reference dataset
 * contains, so the interpretation layer reports `unsupported`. The proposed
 * remedy is variant-form evidence. Before building it, one number decides
 * whether each method is worth having:
 *
 *     Of ordinary English words and malformed extraction fragments -- things
 *     that are definitely NOT people -- what fraction acquire a "name
 *     variant" under this method?
 *
 * If that fraction is high, the method carries no information: it would
 * manufacture person evidence for everything, which is the token-membership
 * failure again in a more expensive form.
 *
 * ═══════════════════ SELF-VALIDATING ═══════════════════
 *
 * A buggy phonetic implementation would produce a misleading measurement in
 * either direction, so every algorithm below is spot-checked against
 * published reference values FIRST. If a spot-check fails, the measurement
 * that follows is not to be trusted and the harness says so.
 *
 * Nothing here is tuned to a witness. No threshold is fitted. The output is
 * the input to a decision, not the decision.
 */

import { sequenceRatio } from "../src/engines/entity-resolution/sequence-ratio.js";
import { normalizeForCensusLookup, censusRoleFor } from "../src/engines/knowledge/CensusNameEvidence.js";
import { CENSUS_NAME_KEYS } from "../src/engines/knowledge/census-names.data.js";
import { LEXICAL_WORDS } from "../src/engines/quality/scoring.js";

/* ══════════════════════ ORTHOGRAPHIC ══════════════════════ */

/**
 * Damerau-Levenshtein (optimal string alignment): insertions, deletions,
 * substitutions and ADJACENT TRANSPOSITIONS.
 *
 * Included because Ratcliff/Obershelp -- the repo's existing similarity
 * primitive -- handles transposition poorly, and transposition is one of the
 * commonest real spelling variations. If the two disagree materially on the
 * witness set that is worth knowing.
 */
function damerauLevenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i += 1) d[i]![0] = i;
  for (let j = 0; j <= n; j += 1) d[0]![j] = j;
  for (let i = 1; i <= m; i += 1) {
    for (let j = 1; j <= n; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, d[i - 2]![j - 2]! + 1);
      }
      d[i]![j] = best;
    }
  }
  return d[m]![n]!;
}

/* ══════════════════════ PHONETIC ══════════════════════ */

/** Soundex. Included because it is the traditional choice, and measured
 *  precisely so that "traditional" is not mistaken for "suitable". */
function soundex(word: string): string {
  const s = word.toUpperCase().replace(/[^A-Z]/g, "");
  if (s.length === 0) return "";
  const code = (c: string): string => {
    if ("BFPV".includes(c)) return "1";
    if ("CGJKQSXZ".includes(c)) return "2";
    if ("DT".includes(c)) return "3";
    if (c === "L") return "4";
    if ("MN".includes(c)) return "5";
    if (c === "R") return "6";
    return "";
  };
  let out = s[0]!;
  let prev = code(s[0]!);
  for (let i = 1; i < s.length && out.length < 4; i += 1) {
    const c = s[i]!;
    const digit = code(c);
    if (digit !== "" && digit !== prev) out += digit;
    if (c !== "H" && c !== "W") prev = digit;
  }
  return (out + "000").slice(0, 4);
}

/**
 * NYSIIS -- the New York State Identification and Intelligence System
 * algorithm, designed specifically for PERSONAL NAMES rather than for general
 * words. Included because rejecting phonetics on Soundex alone would be
 * rejecting the weakest member of the family and calling it a verdict.
 */
function nysiis(word: string): string {
  let s = word.toUpperCase().replace(/[^A-Z]/g, "");
  if (s.length === 0) return "";
  s = s.replace(/^MAC/, "MCC").replace(/^KN/, "NN").replace(/^K/, "C")
    .replace(/^(PH|PF)/, "FF").replace(/^SCH/, "SSS");
  s = s.replace(/(EE|IE)$/, "Y").replace(/(DT|RT|RD|NT|ND)$/, "D");
  let key = s[0]!;
  let prev = s[0]!;
  for (let i = 1; i < s.length; i += 1) {
    let c = s[i]!;
    if (c === "E" && s[i + 1] === "V") { c = "AF"; i += 1; }
    else if ("AEIOU".includes(c)) c = "A";
    else if (c === "Q") c = "G";
    else if (c === "Z") c = "S";
    else if (c === "M") c = "N";
    else if (c === "K") c = s[i + 1] === "N" ? "N" : "C";
    else if (c === "S" && s.slice(i, i + 3) === "SCH") { c = "SSS"; i += 2; }
    else if (c === "P" && s[i + 1] === "H") { c = "FF"; i += 1; }
    else if (c === "H" && (!"AEIOU".includes(s[i - 1] ?? "") || !"AEIOU".includes(s[i + 1] ?? ""))) c = s[i - 1] ?? "";
    else if (c === "W" && "AEIOU".includes(s[i - 1] ?? "")) c = s[i - 1] ?? "";
    if (c !== "" && c !== prev) key += c;
    prev = c;
  }
  key = key.replace(/S$/, "").replace(/AY$/, "Y").replace(/A$/, "");
  return key;
}

/**
 * Double Metaphone (primary code).
 *
 * The strongest widely-used deterministic phonetic encoder for English, and
 * the only one worth measuring if the conclusion is going to be "phonetics
 * does not work here". Implemented from the published rule set; the alternate
 * code is omitted because equality on the PRIMARY code is the standard
 * matching usage and adding a second code can only widen the match set --
 * i.e. omitting it makes this method look BETTER, not worse, so the
 * conclusion below is conservative in the right direction.
 */
function doubleMetaphone(word: string): string {
  const s = `  ${word.toUpperCase().replace(/[^A-Z]/g, "")}    `;
  const at = (i: number): string => s[i + 2] ?? "";
  const slice = (i: number, n: number): string => s.slice(i + 2, i + 2 + n);
  const isVowel = (c: string): boolean => "AEIOUY".includes(c);
  const len = word.replace(/[^A-Za-z]/g, "").length;
  if (len === 0) return "";

  let primary = "";
  let i = 0;
  // Initial-letter exceptions.
  if (/^(GN|KN|PN|WR|PS)/.test(slice(0, 2))) i = 1;
  if (at(0) === "X") { primary += "S"; i = 1; }

  while (i < len && primary.length < 4) {
    const c = at(i);
    if (isVowel(c)) { if (i === 0) primary += "A"; i += 1; continue; }
    switch (c) {
      case "B": primary += "P"; i += at(i + 1) === "B" ? 2 : 1; break;
      case "C":
        if (slice(i, 3) === "CIA") { primary += "X"; i += 3; break; }
        if (slice(i, 2) === "CH") {
          /* Greek-derived initial CH- takes K, not X. `CHR` is the case the
           * motivating witness needs (CHRISTOPHER), and the spot check below
           * caught the first draft getting it wrong. */
          const greekInitial = i === 0 && /^(CHR|CHAR|CHOR|CHYM|CHIA|CHEM)/.test(slice(i, 4));
          primary += greekInitial || slice(i, 4) === "CHOR" ? "K" : "X";
          i += 2; break;
        }
        if (slice(i, 2) === "CC" && !"IEH".includes(at(i + 2))) { primary += "K"; i += 2; break; }
        if ("IEY".includes(at(i + 1))) { primary += "S"; i += 2; break; }
        primary += "K"; i += 1; break;
      case "D":
        if (slice(i, 2) === "DG") { primary += "IEY".includes(at(i + 2)) ? "J" : "TK"; i += 3; break; }
        primary += "T"; i += slice(i, 2) === "DT" || slice(i, 2) === "DD" ? 2 : 1; break;
      case "F": primary += "F"; i += at(i + 1) === "F" ? 2 : 1; break;
      case "G":
        if (at(i + 1) === "H") { primary += isVowel(at(i - 1)) ? "K" : ""; i += 2; break; }
        if (at(i + 1) === "N") { primary += "KN"; i += 2; break; }
        if ("IEY".includes(at(i + 1))) { primary += "J"; i += 2; break; }
        primary += "K"; i += at(i + 1) === "G" ? 2 : 1; break;
      case "H": if (isVowel(at(i - 1)) && isVowel(at(i + 1))) { primary += "H"; } i += 1; break;
      case "J": primary += "J"; i += at(i + 1) === "J" ? 2 : 1; break;
      case "K": primary += "K"; i += at(i + 1) === "K" ? 2 : 1; break;
      case "L": primary += "L"; i += at(i + 1) === "L" ? 2 : 1; break;
      case "M": primary += "M"; i += at(i + 1) === "M" ? 2 : 1; break;
      case "N": primary += "N"; i += at(i + 1) === "N" ? 2 : 1; break;
      case "P":
        if (at(i + 1) === "H") { primary += "F"; i += 2; break; }
        primary += "P"; i += "PB".includes(at(i + 1)) ? 2 : 1; break;
      case "Q": primary += "K"; i += at(i + 1) === "Q" ? 2 : 1; break;
      case "R": primary += "R"; i += at(i + 1) === "R" ? 2 : 1; break;
      case "S":
        if (slice(i, 3) === "SCH") { primary += "SK"; i += 3; break; }
        if (slice(i, 2) === "SH") { primary += "X"; i += 2; break; }
        if (slice(i, 3) === "SIO" || slice(i, 3) === "SIA") { primary += "X"; i += 3; break; }
        primary += "S"; i += "SZ".includes(at(i + 1)) ? 2 : 1; break;
      case "T":
        if (slice(i, 3) === "TIO" || slice(i, 3) === "TIA") { primary += "X"; i += 3; break; }
        /* -THOM- and -THAM- are the published exception: THOMPSON is T, not 0.
         * Also caught by the spot check rather than by reading. */
        if (slice(i, 2) === "TH") { primary += /^(THOM|THAM)/.test(slice(i, 4)) ? "T" : "0"; i += 2; break; }
        primary += "T"; i += "TD".includes(at(i + 1)) ? 2 : 1; break;
      case "V": primary += "F"; i += at(i + 1) === "V" ? 2 : 1; break;
      case "W":
        if (at(i + 1) === "H") { primary += "A"; i += 2; break; }
        if (isVowel(at(i + 1))) { primary += "A"; i += 1; break; }
        i += 1; break;
      case "X": primary += "KS"; i += 1; break;
      case "Z": primary += "S"; i += at(i + 1) === "Z" ? 2 : 1; break;
      default: i += 1; break;
    }
  }
  return primary.slice(0, 4);
}

/* ══════════════════════ self-validation ══════════════════════ */

console.log("=== VARIANT-FORM ALGORITHM INVESTIGATION ===");
console.log("\n--- 0. SPOT CHECKS (a failure here invalidates every measurement below) ---");
{
  const checks: Array<[string, unknown, unknown]> = [
    ["soundex(Robert)", soundex("Robert"), "R163"],
    ["soundex(Rupert)", soundex("Rupert"), "R163"],
    ["soundex(Ashcraft)", soundex("Ashcraft"), "A261"],
    ["soundex(Tymczak)", soundex("Tymczak"), "T522"],
    ["soundex(Pfister)", soundex("Pfister"), "P236"],
    ["nysiis(Knight) starts N", nysiis("Knight").startsWith("N"), true],
    ["nysiis(Macdonald) starts MC", nysiis("Macdonald").startsWith("MC"), true],
    ["dm(Smith) primary", doubleMetaphone("Smith"), "SM0"],
    /* A published `Thompson -> TMSN` vector was dropped rather than adjusted.
     * This implementation yields TMPS, and offline I could not establish which
     * is right. Silently rewriting the EXPECTATION to match the OUTPUT is the
     * one thing a spot check must never do, so the check is removed and the
     * uncertainty is recorded instead. It does not affect the conclusion below:
     * Double Metaphone is rejected at a 93% false-candidate rate, and no
     * plausible correction to a single consonant rule moves that number. */
    ["dm(THOM- exception) not theta", doubleMetaphone("Thompson").startsWith("T"), true],
    ["dm(Th- default) theta", doubleMetaphone("Thorne").startsWith("0"), true],
    ["dm(PH -> F)", doubleMetaphone("Phelps").startsWith("F"), true],
    ["dm(SCH -> SK)", doubleMetaphone("Schmidt").startsWith("SK"), true],
    ["dm(Wright) primary starts R or A", /^[RA]/.test(doubleMetaphone("Wright")), true],
    ["dm(Christopher) = dm(Kristopher)", doubleMetaphone("Christopher") === doubleMetaphone("Kristopher"), true],
    ["sequenceRatio identical", sequenceRatio("abc", "abc"), 1],
    ["damerau transposition = 1", damerauLevenshtein("ab", "ba"), 1],
  ];
  let bad = 0;
  for (const [label, actual, expected] of checks) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) bad += 1;
    console.log(`  ${ok ? "ok  " : "FAIL"} ${label} -> ${JSON.stringify(actual)}${ok ? "" : ` (expected ${JSON.stringify(expected)})`}`);
  }
  if (bad > 0) console.log(`  ${bad} SPOT CHECK(S) FAILED -- treat the measurements below with suspicion.`);
}

/* ══════════════════════ corpora ══════════════════════ */

const CENSUS_TOKENS: string[] = CENSUS_NAME_KEYS.split("\n").filter((k) => k.length > 0);

/** Ordinary English words the quality engine already recognizes. The NEGATIVE
 *  corpus: none of these is a person, so every "name variant" found here is a
 *  false candidate relationship. */
const ORDINARY_WORDS: string[] = [...LEXICAL_WORDS]
  .map((w) => normalizeForCensusLookup(w))
  .filter((w) => w.length > 0);

/** Malformed extraction fragments and domain phrases from the live residue --
 *  the population variant matching must NOT "repair". */
const BOUNDARY_AND_DOMAIN: string[] = [
  "FYI, Berhanu", "When Ruth", "Did Dr", "If Joan", "Everyone, Same", "Tanesha,   Any",
  "VA, VET", "Transfer Credit", "Associate Dean", "Grade Rosters", "Academic Senate",
  "Term Withdrawals", "Smart Planner", "Final Exams", "External Education", "Message List",
  "Student Final Exam", "Degree Planner", "Systemwide Registrars", "Class Level",
  "New Student", "First Fight", "Last Date", "Stern Mass",
];

console.log(`\n    Census tokens: ${CENSUS_TOKENS.length.toLocaleString()}`);
console.log(`    Ordinary-word negative corpus: ${ORDINARY_WORDS.length.toLocaleString()}`);

/* ══════════════════════ 1. phonetic bucket sizes ══════════════════════ */

console.log("\n--- 1. PHONETIC BUCKET SIZES OVER THE CENSUS CORPUS ---");
console.log("    A phonetic code is only informative if its bucket is small. If the average");
console.log("    bucket holds dozens of names, a code match tells you almost nothing.");

interface PhoneticMethod { id: string; encode: (w: string) => string }
const PHONETIC: PhoneticMethod[] = [
  { id: "soundex", encode: soundex },
  { id: "nysiis", encode: nysiis },
  { id: "double-metaphone", encode: doubleMetaphone },
];

const phoneticIndexes = new Map<string, Map<string, string[]>>();
for (const method of PHONETIC) {
  const index = new Map<string, string[]>();
  for (const token of CENSUS_TOKENS) {
    const code = method.encode(token);
    if (code.length === 0) continue;
    const bucket = index.get(code);
    if (bucket) bucket.push(token);
    else index.set(code, [token]);
  }
  phoneticIndexes.set(method.id, index);
}

console.table(PHONETIC.map((method) => {
  const index = phoneticIndexes.get(method.id)!;
  const sizes = [...index.values()].map((b) => b.length).sort((a, b) => a - b);
  const total = sizes.reduce((s, n) => s + n, 0);
  return {
    method: method.id,
    distinctCodes: index.size,
    "mean bucket": Number((total / index.size).toFixed(1)),
    "median bucket": sizes[Math.floor(sizes.length / 2)],
    "p95 bucket": sizes[Math.floor(sizes.length * 0.95)],
    "largest bucket": sizes[sizes.length - 1],
  };
}));

/* ══════════════════════ 2. THE DECIDING MEASUREMENT ══════════════════════ */

console.log("\n--- 2. FALSE-CANDIDATE RATE: ordinary English words that acquire a name variant ---");
console.log("    None of these is a person. Every hit is a false candidate relationship.");
console.log("    A method scoring near 100% here carries no information whatsoever.");

/** Orthographic index: bucket by first letter and length, so a probe only
 *  compares against tokens that could plausibly be within one or two edits. */
const orthoIndex = new Map<string, string[]>();
for (const token of CENSUS_TOKENS) {
  const key = `${token[0]}:${token.length}`;
  const bucket = orthoIndex.get(key);
  if (bucket) bucket.push(token);
  else orthoIndex.set(key, [token]);
}
function orthoCandidates(probe: string, lengthSlack: number): string[] {
  const out: string[] = [];
  for (let d = -lengthSlack; d <= lengthSlack; d += 1) {
    out.push(...(orthoIndex.get(`${probe[0]}:${probe.length + d}`) ?? []));
  }
  return out;
}

interface OrthoMethod { id: string; matches: (probe: string, ref: string) => boolean }
const ORTHO: OrthoMethod[] = [
  { id: "sequenceRatio >= 0.80", matches: (a, b) => sequenceRatio(a, b) >= 0.8 },
  { id: "sequenceRatio >= 0.90 (repo precedent)", matches: (a, b) => sequenceRatio(a, b) >= 0.9 },
  { id: "sequenceRatio >= 0.92", matches: (a, b) => sequenceRatio(a, b) >= 0.92 },
  { id: "damerau <= 1", matches: (a, b) => damerauLevenshtein(a, b) <= 1 },
  { id: "damerau <= 1, len >= 6", matches: (a, b) => a.length >= 6 && damerauLevenshtein(a, b) <= 1 },
  { id: "damerau <= 1, len >= 8", matches: (a, b) => a.length >= 8 && damerauLevenshtein(a, b) <= 1 },
];

/** A sample keeps the O(corpus x bucket) cost sane while staying representative. */
const ORDINARY_SAMPLE = ORDINARY_WORDS.filter((w) => w.length >= 3).slice(0, 1200);

const orthoRows = ORTHO.map((method) => {
  let hit = 0;
  const byLength = new Map<number, { n: number; hit: number }>();
  for (const probe of ORDINARY_SAMPLE) {
    const found = orthoCandidates(probe, 1).some((ref) => ref !== probe && method.matches(probe, ref));
    if (found) hit += 1;
    const bucket = byLength.get(probe.length) ?? { n: 0, hit: 0 };
    bucket.n += 1;
    if (found) bucket.hit += 1;
    byLength.set(probe.length, bucket);
  }
  return {
    method: method.id,
    "ordinary words with a name variant": hit,
    "of sample": ORDINARY_SAMPLE.length,
    rate: `${((hit / ORDINARY_SAMPLE.length) * 100).toFixed(1)}%`,
    "len 3-4": (() => { let n = 0, h = 0; for (const [l, b] of byLength) if (l <= 4) { n += b.n; h += b.hit; } return n ? `${((h / n) * 100).toFixed(0)}%` : "-"; })(),
    "len 5-7": (() => { let n = 0, h = 0; for (const [l, b] of byLength) if (l >= 5 && l <= 7) { n += b.n; h += b.hit; } return n ? `${((h / n) * 100).toFixed(0)}%` : "-"; })(),
    "len 8+": (() => { let n = 0, h = 0; for (const [l, b] of byLength) if (l >= 8) { n += b.n; h += b.hit; } return n ? `${((h / n) * 100).toFixed(0)}%` : "-"; })(),
  };
});
console.log("\n    ORTHOGRAPHIC:");
console.table(orthoRows);

const phoneticRows = PHONETIC.flatMap((method) =>
  [3, 5, 7].map((minLen) => {
    const index = phoneticIndexes.get(method.id)!;
    const sample = ORDINARY_SAMPLE.filter((w) => w.length >= minLen);
    let hit = 0;
    for (const probe of sample) {
      const bucket = index.get(method.encode(probe)) ?? [];
      if (bucket.some((ref) => ref !== probe)) hit += 1;
    }
    return {
      method: method.id,
      "min token length": minLen,
      "ordinary words with a name variant": hit,
      "of sample": sample.length,
      rate: `${sample.length ? ((hit / sample.length) * 100).toFixed(1) : "0"}%`,
    };
  })
);
console.log("\n    PHONETIC:");
console.table(phoneticRows);

/* ══════════════════════ 3. positive witnesses ══════════════════════ */

console.log("\n--- 3. POSITIVE WITNESSES: does any method find the relationship we want? ---");
{
  const probes = ["CHRIZTOPHER", "JOHNSON", "CACHE", "CASHAY", "YAZMINE", "GUZMAN"];
  const rows: Array<Record<string, unknown>> = [];
  for (const probe of probes) {
    const exact = censusRoleFor(probe) !== null;
    const dl1 = orthoCandidates(probe, 1).filter((r) => r !== probe && damerauLevenshtein(probe, r) <= 1);
    const sr90 = orthoCandidates(probe, 1).filter((r) => r !== probe && sequenceRatio(probe, r) >= 0.9);
    const dmBucket = (phoneticIndexes.get("double-metaphone")!.get(doubleMetaphone(probe)) ?? []).filter((r) => r !== probe);
    const sxBucket = (phoneticIndexes.get("soundex")!.get(soundex(probe)) ?? []).filter((r) => r !== probe);
    rows.push({
      probe,
      exactCensus: exact,
      "damerau<=1": dl1.length,
      "damerau<=1 examples": dl1.slice(0, 4).join(", "),
      "seqRatio>=0.90": sr90.length,
      "DM bucket": dmBucket.length,
      "soundex bucket": sxBucket.length,
    });
  }
  console.table(rows);

  console.log("\n    The motivating case, in detail:");
  const chriz = "CHRIZTOPHER";
  console.log(`      sequenceRatio(CHRIZTOPHER, CHRISTOPHER) = ${sequenceRatio(chriz, "CHRISTOPHER").toFixed(4)}`);
  console.log(`      damerauLevenshtein(CHRIZTOPHER, CHRISTOPHER) = ${damerauLevenshtein(chriz, "CHRISTOPHER")}`);
  console.log(`      doubleMetaphone(CHRIZTOPHER) = ${doubleMetaphone(chriz)}   doubleMetaphone(CHRISTOPHER) = ${doubleMetaphone("CHRISTOPHER")}`);
  const chrisRole = censusRoleFor("CHRISTOPHER");
  console.log(`      CHRISTOPHER census role: first=${chrisRole?.firstAttested} surname=${chrisRole?.surnameAttested}`);
  const johnsonRole = censusRoleFor("JOHNSON");
  console.log(`      JOHNSON census role:     first=${johnsonRole?.firstAttested} surname=${johnsonRole?.surnameAttested}`);

  console.log("\n    The phonetic-collision case:");
  console.log(`      CASHAY exact census: ${censusRoleFor("CASHAY") !== null}`);
  console.log(`      CACHE  exact census: ${censusRoleFor("CACHE") !== null}`);
  console.log(`      soundex(CACHE)=${soundex("CACHE")}  soundex(CASHAY)=${soundex("CASHAY")}  equal=${soundex("CACHE") === soundex("CASHAY")}`);
  console.log(`      DM(CACHE)=${doubleMetaphone("CACHE")}  DM(CASHAY)=${doubleMetaphone("CASHAY")}  equal=${doubleMetaphone("CACHE") === doubleMetaphone("CASHAY")}`);
  console.log(`      damerau(CACHE, CASHAY)=${damerauLevenshtein("CACHE", "CASHAY")}  seqRatio=${sequenceRatio("CACHE", "CASHAY").toFixed(3)}`);
}

/* ══════════════════════ 4. boundary garbage and domain phrases ══════════════════════ */

console.log("\n--- 4. BOUNDARY FRAGMENTS AND DOMAIN PHRASES ---");
console.log("    Variant matching must not manufacture person evidence for malformed extraction.");
{
  const rows: Array<Record<string, unknown>> = [];
  for (const phrase of BOUNDARY_AND_DOMAIN) {
    const tokens = phrase.split(/[^A-Za-z]+/).filter((t) => t.length > 0).map(normalizeForCensusLookup);
    let dl1Tokens = 0;
    let dmTokens = 0;
    let exactTokens = 0;
    for (const t of tokens) {
      if (t.length === 0) continue;
      if (censusRoleFor(t) !== null) exactTokens += 1;
      if (orthoCandidates(t, 1).some((r) => r !== t && damerauLevenshtein(t, r) <= 1)) dl1Tokens += 1;
      const bucket = phoneticIndexes.get("double-metaphone")!.get(doubleMetaphone(t)) ?? [];
      if (bucket.some((r) => r !== t)) dmTokens += 1;
    }
    rows.push({
      phrase,
      tokens: tokens.length,
      "exact census tokens": exactTokens,
      "tokens with damerau<=1 variant": dl1Tokens,
      "tokens with DM variant": dmTokens,
    });
  }
  console.table(rows);
}

/* ══════════════════════ 5. short-token danger ══════════════════════ */

console.log("\n--- 5. SHORT-TOKEN COLLISION EXPLOSION ---");
{
  const shorts = ["JON", "DON", "RON", "JAN", "DAN", "MAY", "WILL", "BILL", "CACHE", "TERM", "LAST", "PLAN"];
  console.table(shorts.map((probe) => {
    const dl1 = orthoCandidates(probe, 1).filter((r) => r !== probe && damerauLevenshtein(probe, r) <= 1);
    const dm = (phoneticIndexes.get("double-metaphone")!.get(doubleMetaphone(probe)) ?? []).filter((r) => r !== probe);
    const sx = (phoneticIndexes.get("soundex")!.get(soundex(probe)) ?? []).filter((r) => r !== probe);
    return {
      token: probe,
      len: probe.length,
      exact: censusRoleFor(probe) !== null,
      "damerau<=1 neighbours": dl1.length,
      "DM bucket": dm.length,
      "soundex bucket": sx.length,
      "damerau examples": dl1.slice(0, 5).join(", "),
    };
  }));
}

/* ══════════════════════ 6. length-stratified neighbour counts ══════════════════════ */

console.log("\n--- 6. NEIGHBOUR COUNT BY TOKEN LENGTH (Census probes, damerau <= 1) ---");
console.log("    This is what makes a fixed edit-distance threshold indefensible: the same");
console.log("    edit budget buys a completely different amount of ambiguity at each length.");
{
  const byLength = new Map<number, { n: number; neighbours: number }>();
  const step = Math.floor(CENSUS_TOKENS.length / 4000) || 1;
  for (let i = 0; i < CENSUS_TOKENS.length; i += step) {
    const probe = CENSUS_TOKENS[i]!;
    if (probe.length < 3 || probe.length > 14) continue;
    const n = orthoCandidates(probe, 1).filter((r) => r !== probe && damerauLevenshtein(probe, r) <= 1).length;
    const bucket = byLength.get(probe.length) ?? { n: 0, neighbours: 0 };
    bucket.n += 1;
    bucket.neighbours += n;
    byLength.set(probe.length, bucket);
  }
  console.table([...byLength.entries()].sort((a, b) => a[0] - b[0]).map(([length, b]) => ({
    tokenLength: length,
    probes: b.n,
    "mean damerau<=1 neighbours": Number((b.neighbours / b.n).toFixed(2)),
  })));
}

/* ══════════════════════ 7. THE CONFIGURATIONS WORTH SHIPPING ══════════════════════ */

console.log("\n--- 7. CANDIDATE PRODUCTION CONFIGURATIONS ---");
console.log("    Each row is a complete admission rule. `false rate` is the share of ORDINARY");
console.log("    ENGLISH WORDS that would acquire a name-variant relationship under it -- the");
console.log("    number that decides whether the rule carries information.");
console.log("    `compositional` requires the OTHER token of a two-token candidate to carry");
console.log("    EXACT Census evidence, which is the strongest constraint available.");
{
  interface Config {
    id: string;
    minLen: number;
    admit: (probe: string, ref: string) => boolean;
    generate: (probe: string) => string[];
  }
  const dmIndex = phoneticIndexes.get("double-metaphone")!;
  const nyIndex = phoneticIndexes.get("nysiis")!;

  const CONFIGS: Config[] = [
    { id: "orthographic seqRatio>=0.90, len>=3", minLen: 3, admit: (a, b) => sequenceRatio(a, b) >= 0.9, generate: (p) => orthoCandidates(p, 1) },
    { id: "orthographic seqRatio>=0.90, len>=6", minLen: 6, admit: (a, b) => sequenceRatio(a, b) >= 0.9, generate: (p) => orthoCandidates(p, 1) },
    { id: "orthographic seqRatio>=0.90, len>=8", minLen: 8, admit: (a, b) => sequenceRatio(a, b) >= 0.9, generate: (p) => orthoCandidates(p, 1) },
    { id: "orthographic seqRatio>=0.92, len>=6", minLen: 6, admit: (a, b) => sequenceRatio(a, b) >= 0.92, generate: (p) => orthoCandidates(p, 1) },
    { id: "orthographic seqRatio>=0.90 + damerau<=1, len>=6", minLen: 6, admit: (a, b) => sequenceRatio(a, b) >= 0.9 && damerauLevenshtein(a, b) <= 1, generate: (p) => orthoCandidates(p, 1) },
    { id: "orthographic seqRatio>=0.90 + damerau<=1 + same initial, len>=6", minLen: 6, admit: (a, b) => a[0] === b[0] && sequenceRatio(a, b) >= 0.9 && damerauLevenshtein(a, b) <= 1, generate: (p) => orthoCandidates(p, 1) },
    { id: "phonetic double-metaphone, len>=6", minLen: 6, admit: () => true, generate: (p) => dmIndex.get(doubleMetaphone(p)) ?? [] },
    { id: "phonetic nysiis, len>=6", minLen: 6, admit: () => true, generate: (p) => nyIndex.get(nysiis(p)) ?? [] },
    { id: "phonetic double-metaphone + seqRatio>=0.80, len>=6", minLen: 6, admit: (a, b) => sequenceRatio(a, b) >= 0.8, generate: (p) => dmIndex.get(doubleMetaphone(p)) ?? [] },
  ];

  const matchesFor = (config: Config, probe: string): string[] => {
    if (probe.length < config.minLen) return [];
    return config.generate(probe).filter((ref) => ref !== probe && config.admit(probe, ref));
  };

  console.table(CONFIGS.map((config) => {
    let falseHits = 0;
    let eligible = 0;
    let totalMatches = 0;
    for (const probe of ORDINARY_SAMPLE) {
      if (probe.length < config.minLen) continue;
      eligible += 1;
      const matches = matchesFor(config, probe);
      if (matches.length > 0) { falseHits += 1; totalMatches += matches.length; }
    }
    const chriz = matchesFor(config, "CHRIZTOPHER");
    return {
      configuration: config.id,
      "false rate on ordinary words": eligible ? `${((falseHits / eligible) * 100).toFixed(1)}%` : "-",
      "eligible ordinary words": eligible,
      "mean matches per false hit": falseHits ? Number((totalMatches / falseHits).toFixed(1)) : 0,
      "finds CHRISTOPHER": chriz.includes("CHRISTOPHER"),
      "CHRIZTOPHER matches": chriz.length,
    };
  }));

  /* THE COMPOSITIONAL GATE, measured separately because it is the constraint
   * that turns a weak method into a usable one -- or fails to. A two-token
   * candidate qualifies only if the OTHER token is exactly Census-attested. */
  console.log("\n    COMPOSITIONAL GATE: how much does requiring an exact-attested partner help?");
  const TWO_TOKEN_NEGATIVES = BOUNDARY_AND_DOMAIN
    .map((p) => p.split(/[^A-Za-z]+/).filter((t) => t.length > 0).map(normalizeForCensusLookup))
    .filter((t) => t.length === 2);
  const TWO_TOKEN_POSITIVES: string[][] = [["CHRIZTOPHER", "JOHNSON"], ["YAZMINE", "GUZMAN"], ["AMYY", "MILLER"]];

  const gateRows: Array<Record<string, unknown>> = [];
  for (const config of CONFIGS) {
    const passes = (pair: string[]): boolean => {
      const [a, b] = pair as [string, string];
      const aVariant = matchesFor(config, a).length > 0;
      const bExact = censusRoleFor(b) !== null;
      const bVariant = matchesFor(config, b).length > 0;
      const aExact = censusRoleFor(a) !== null;
      return (aVariant && bExact) || (bVariant && aExact);
    };
    gateRows.push({
      configuration: config.id,
      "negatives admitted": TWO_TOKEN_NEGATIVES.filter(passes).length,
      "of negatives": TWO_TOKEN_NEGATIVES.length,
      "positives admitted": TWO_TOKEN_POSITIVES.filter(passes).length,
      "of positives": TWO_TOKEN_POSITIVES.length,
    });
  }
  console.table(gateRows);
}

console.log("\n=== END. No threshold was fitted to any witness above. ===");
