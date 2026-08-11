/**
 * census-name-evidence.ts -- EXPERIMENT ONLY (AG, 2026-08-10).
 *
 * Measures whether Census 2020 name attestation is the missing
 * person-protection capability. Nothing here is production, nothing is
 * imported by production, and no routing changes.
 *
 * SEMANTIC RULE, enforced by shape: this module answers exactly one
 * question per token -- "is this token independently attested as a human
 * first name and/or surname, and how prevalent is it?" It never returns a
 * classification. There is no `isPerson()` here and there must not be.
 *
 * DEMOGRAPHICS: the aggregate omits race/Hispanic-origin and sex, and
 * nothing below reconstructs them. `first_count_sex_file` and
 * `first_count_race_file` are read ONLY to report provenance divergence
 * (§1); neither is used as evidence.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// ===========================================================================
// 1. RESOURCE + NORMALIZATION
// ===========================================================================

export interface CensusEntry {
  display: string;
  firstAttested: boolean;
  lastAttested: boolean;
  firstCount: number | null;
  lastCount: number | null;
  firstRank: number | null;
  lastRank: number | null;
  firstTop1000: boolean;
  lastTop1000: boolean;
}

/**
 * THE NORMALIZATION CONTRACT. Lookup only -- the candidate's displayed text
 * is never touched.
 *
 * NFD decomposes "á" into "a" + U+0301, the combining-mark strip removes the
 * accent, and uppercasing matches the Census key space (which is A-Z only,
 * verified). This is the whole transformation: no fuzzy matching, no edit
 * distance, no phonetics, no transliteration. Accent folding is the boundary.
 *
 * Guzmán -> GUZMAN. Núñez -> NUNEZ. Both are then found; neither display
 * value changes.
 */
export function censusNormalize(token: string): string {
  return token
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}]/gu, "")
    .toUpperCase();
}

/** The Census residual bucket -- a data artifact, not a name. Excluded at
 *  load so it can never be matched. */
const CENSUS_ARTIFACT_ROWS = new Set(["ALL OTHER NAMES", "ALLOTHERNAMES"]);

export interface CensusIndex {
  byName: Map<string, CensusEntry>;
  stats: { rows: number; first: number; last: number; both: number; excluded: number };
  loadMs: number;
  bytes: number;
}

export function loadCensus(csvPath: string): CensusIndex {
  const t0 = performance.now();
  const raw = readFileSync(csvPath, "utf8");
  const bytes = Buffer.byteLength(raw, "utf8");
  const lines = raw.split("\n");
  const byName = new Map<string, CensusEntry>();
  let first = 0;
  let last = 0;
  let both = 0;
  let excluded = 0;
  const num = (v: string): number | null => (v === "" ? null : Number(v));
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const f = line.split(",");
    if (f.length < 11) continue;
    const key = f[0]!;
    if (CENSUS_ARTIFACT_ROWS.has(key)) { excluded += 1; continue; }
    const fa = f[2] === "True";
    const la = f[3] === "True";
    if (fa) first += 1;
    if (la) last += 1;
    if (fa && la) both += 1;
    byName.set(key, {
      display: f[1]!, firstAttested: fa, lastAttested: la,
      firstCount: num(f[4]!), lastCount: num(f[5]!),
      firstRank: num(f[6]!), lastRank: num(f[7]!),
      firstTop1000: f[8] === "True", lastTop1000: f[9] === "True",
    });
  }
  return { byName, stats: { rows: byName.size, first, last, both, excluded }, loadMs: performance.now() - t0, bytes };
}

const HERE = dirname(fileURLToPath(import.meta.url));
const census = loadCensus(join(HERE, "data", "Census2020_DocScrub_NameEvidence.csv"));

// ===========================================================================
// 2. TOKEN + CANDIDATE EVIDENCE (evidence, never classification)
// ===========================================================================

export interface TokenEvidence {
  raw: string;
  normalized: string;
  entry: CensusEntry | undefined;
  isFirst: boolean;
  isLast: boolean;
}

export type NameStructure = "FIRST+LAST" | "LAST,FIRST" | "AMBIGUOUS-ROLE" | "SINGLE-TOKEN" | "PARTIAL" | "NONE";

export interface CandidateCensusEvidence {
  value: string;
  tokens: TokenEvidence[];
  hadComma: boolean;
  structure: NameStructure;
  /** Weakest link -- the smaller of the two role-appropriate counts. */
  minRoleCount: number | null;
  anyTop1000: boolean;
}

function tokenize(value: string): { tokens: string[]; hadComma: boolean } {
  const hadComma = /,/.test(value);
  return {
    tokens: value.replace(/,/g, " ").split(/\s+/).map((t) => t.trim()).filter(Boolean),
    hadComma,
  };
}

export function censusEvidenceFor(value: string): CandidateCensusEvidence {
  const { tokens: raw, hadComma } = tokenize(value);
  const tokens: TokenEvidence[] = raw.map((t) => {
    const normalized = censusNormalize(t);
    const entry = census.byName.get(normalized);
    return { raw: t, normalized, entry, isFirst: entry?.firstAttested ?? false, isLast: entry?.lastAttested ?? false };
  });

  let structure: NameStructure = "NONE";
  let minRoleCount: number | null = null;
  if (tokens.length === 1) {
    structure = tokens[0]!.isFirst || tokens[0]!.isLast ? "SINGLE-TOKEN" : "NONE";
    minRoleCount = Math.max(tokens[0]!.entry?.firstCount ?? 0, tokens[0]!.entry?.lastCount ?? 0) || null;
  } else if (tokens.length >= 2) {
    const a = tokens[0]!;
    const b = tokens[tokens.length - 1]!;
    const firstLast = a.isFirst && b.isLast;
    const lastFirst = a.isLast && b.isFirst;
    // AMBIGUOUS ROLE: both readings available, so the structure cannot say
    // which way round it is. Recorded, never silently resolved.
    if (firstLast && lastFirst) structure = "AMBIGUOUS-ROLE";
    else if (hadComma && lastFirst) structure = "LAST,FIRST";
    else if (firstLast) structure = "FIRST+LAST";
    else if (lastFirst) structure = "LAST,FIRST";
    else if (a.entry || b.entry) structure = "PARTIAL";
    if (structure === "FIRST+LAST" || structure === "AMBIGUOUS-ROLE") {
      minRoleCount = Math.min(a.entry?.firstCount ?? 0, b.entry?.lastCount ?? 0) || null;
    } else if (structure === "LAST,FIRST") {
      minRoleCount = Math.min(a.entry?.lastCount ?? 0, b.entry?.firstCount ?? 0) || null;
    }
  }
  const anyTop1000 = tokens.some((t) => t.entry?.firstTop1000 || t.entry?.lastTop1000);
  return { value, tokens, hadComma, structure, minRoleCount, anyTop1000 };
}

export { census };
