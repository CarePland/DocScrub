/**
 * CensusNameEvidence.ts -- U.S. Census 2020 name attestation as deterministic
 * PERSON EVIDENCE (AG, 2026-08-10).
 *
 * ══════════════════ THE CONTRACT, WHICH IS THE WHOLE POINT ══════════════════
 *
 * This module answers exactly one question per token:
 *
 *     is this token independently attested in U.S. Census name data as a
 *     first name and/or a surname?
 *
 * It NEVER answers "is this a person". There is no isPerson() here and there
 * must not be, because the measurement says both directions are wrong:
 *
 *   censusHit => PERSON is false. 80 of 106 known NON-people in the live
 *     residue have an attested token. `Reason Code`, `Good Morning`,
 *     `San Diego`, `Dear Student` and `Last Day` all present as complete
 *     Census name structures. Adopting attestation as classification would
 *     turn ordinary administrative English into a person population.
 *
 *   !censusHit => NOT PERSON is also false. `Chriztopher Johnson` and
 *     `Perias, Nelly` are real people this data cannot see. Census absence
 *     is absence of evidence, never evidence of absence, and no caller may
 *     read it as a negative.
 *
 * ══════════════════ WHY STRUCTURE AND NOT MEMBERSHIP ══════════════════
 *
 * Measured directly (see 20260810-census-name-evidence-experiment.md §9):
 *
 *     protection rule                  people protected   non-people protected
 *     ANY attested token                    30/30               80/106
 *     Census NAME STRUCTURE                 28/30               22/106
 *
 * Token membership protects nearly everything and would have cut the
 * validated cross-candidate cleanup from 65 removals to 11. STRUCTURE -- a
 * first-name-attested token in first position and a surname-attested token
 * in final position -- is the usable signal. Two tokens agreeing on a
 * personal-name shape is a far stronger claim than either token alone, and
 * that is why `censusRoleFor` is exported for diagnostics but nothing in
 * production is permitted to protect on it.
 *
 * ══════════════════ PREVALENCE IS RETAINED, NOT USED ══════════════════
 *
 * The experiment found strong separation on prevalence (Top-1000 membership:
 * people 80%, non-people 8.5%). Every one of those figures came from a single
 * document, so no threshold is applied here. Top-1000 membership is carried
 * through `censusRoleFor` for diagnostics and a future second-corpus study;
 * no function in this module branches on it.
 *
 * ══════════════════ DEMOGRAPHICS ══════════════════
 *
 * The generated asset carries attestation and Top-1000 bits only. Race,
 * Hispanic origin and sex are absent from the aggregate and absent from the
 * asset, and nothing here infers or reconstructs them.
 *
 * Pure and DOM-free.
 */

import { CENSUS_FLAG_ALPHABET, CENSUS_NAME_ENTRY_COUNT, CENSUS_NAME_FLAGS, CENSUS_NAME_KEYS, CENSUS_NAME_SOURCE } from "./census-names.data.js";

const FIRST_BIT = 1;
const LAST_BIT = 2;
const FIRST_TOP1000_BIT = 4;
const LAST_TOP1000_BIT = 8;

/**
 * Built once, lazily, on first lookup -- a document that never reaches the
 * person pipeline never pays for it.
 *
 * Map<string, number> over the key list plus a Uint8Array of flags: measured
 * at ~4.4 MiB against ~67.9 MiB for an object per entry. The index-into-typed-
 * array shape is the reason; it keeps 195,310 short strings and one byte each
 * rather than 195,310 heap objects.
 */
let index: Map<string, number> | null = null;
let flagBytes: Uint8Array | null = null;

function ensureIndex(): { index: Map<string, number>; flags: Uint8Array } {
  if (index && flagBytes) return { index, flags: flagBytes };
  const keys = CENSUS_NAME_KEYS.split("\n");
  const built = new Map<string, number>();
  const bytes = new Uint8Array(keys.length);
  for (let i = 0; i < keys.length; i += 1) {
    built.set(keys[i]!, i);
    bytes[i] = CENSUS_FLAG_ALPHABET.indexOf(CENSUS_NAME_FLAGS[i]!);
  }
  index = built;
  flagBytes = bytes;
  return { index: built, flags: bytes };
}

/**
 * THE LOOKUP NORMALIZATION CONTRACT.
 *
 * NFD decomposes "á" into "a" + U+0301; the combining-mark strip removes the
 * accent; the letter filter drops apostrophes and hyphens; uppercasing
 * matches the Census key space, which is A-Z only.
 *
 *     Guzmán -> GUZMAN     Núñez -> NUNEZ     O'Brien -> OBRIEN
 *
 * THIS IS FOR MATCHING ONLY. The candidate's displayValue is never rewritten,
 * the document is never rewritten, and export/audit always carry the original
 * text. The motivating regression is `Yazmine Guzmán`, who must keep her
 * accent on screen and in the output while still matching GUZMAN here.
 *
 * DELIBERATELY NOT DONE: fuzzy matching, edit distance, phonetic matching,
 * transliteration beyond deterministic accent folding. Accent folding is the
 * boundary the experiment established and nothing here widens it.
 */
export function normalizeForCensusLookup(token: string): string {
  return token
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}]/gu, "")
    .toUpperCase();
}

/** Per-token attestation. Diagnostics and evidence assembly -- NOT protection. */
export interface CensusRole {
  normalized: string;
  firstAttested: boolean;
  surnameAttested: boolean;
  /** Retained ordinal metadata. No production decision reads these. */
  firstTop1000: boolean;
  surnameTop1000: boolean;
}

export function censusRoleFor(token: string): CensusRole | null {
  const normalized = normalizeForCensusLookup(token);
  if (normalized.length === 0) return null;
  const { index: idx, flags } = ensureIndex();
  const at = idx.get(normalized);
  if (at === undefined) return null;
  const bits = flags[at]!;
  return {
    normalized,
    firstAttested: (bits & FIRST_BIT) !== 0,
    surnameAttested: (bits & LAST_BIT) !== 0,
    firstTop1000: (bits & FIRST_TOP1000_BIT) !== 0,
    surnameTop1000: (bits & LAST_TOP1000_BIT) !== 0,
  };
}

/**
 * Candidate-level STRUCTURE. This is the only thing production protects on.
 *
 * `none` covers three genuinely different situations -- no token attested,
 * only one token attested, and single-token candidates -- and collapses them
 * deliberately. A single attested token is exactly the signal measured as
 * unusable (80/106 non-people), so giving it its own protective name would
 * invite a future caller to protect on it.
 */
export type CensusNameStructure =
  /** first token attested as a first name, final token attested as a surname */
  | "first-surname"
  /** comma form: leading token attested as a surname, following token as a first name */
  | "surname-first"
  /** both orderings available -- a supported personal-name structure whose
   *  direction the data cannot settle */
  | "ambiguous-role"
  | "none";

export interface CensusNameEvidence {
  structure: CensusNameStructure;
  /** Per-token roles in candidate order, for Expert View and audit. */
  roles: Array<{ token: string; role: CensusRole | null }>;
  /** True for every structure except `none`. The single predicate the
   *  protection gate reads. */
  supportsNameStructure: boolean;
}

const EMPTY: CensusNameEvidence = { structure: "none", roles: [], supportsNameStructure: false };

/**
 * SCOPE: multi-token candidates only.
 *
 * Single-token candidates are excluded by design, not by oversight. "Will",
 * "Hope", "Rose", "Dean", "Grade" and "Reason" are all Census-attested, so a
 * single-token rule would protect ordinary vocabulary wholesale -- the
 * measured 80/106 failure. Single bare names are already protected by the
 * existing name lexicon, by ambiguity linkage, and by contextual evidence;
 * this source adds nothing safe there.
 */
export function censusNameEvidenceFor(displayValue: string): CensusNameEvidence {
  const tokens = displayValue.replace(/,/g, " ").split(/\s+/).map((t) => t.trim()).filter(Boolean);
  if (tokens.length < 2) return EMPTY;

  const roles = tokens.map((token) => ({ token, role: censusRoleFor(token) }));
  const leading = roles[0]!.role;
  const trailing = roles[roles.length - 1]!.role;
  const hadComma = /,/.test(displayValue);

  const firstSurname = (leading?.firstAttested ?? false) && (trailing?.surnameAttested ?? false);
  const surnameFirst = (leading?.surnameAttested ?? false) && (trailing?.firstAttested ?? false);

  let structure: CensusNameStructure = "none";
  if (firstSurname && surnameFirst) structure = "ambiguous-role";
  else if (firstSurname) structure = "first-surname";
  else if (surnameFirst) structure = hadComma ? "surname-first" : "surname-first";

  return { structure, roles, supportsNameStructure: structure !== "none" };
}

/**
 * Reviewer-facing evidence lines. States what was observed, never a verdict.
 * "Census says this is a person" is precisely the sentence this wording
 * exists to avoid, and no demographic attribute is available to leak.
 */
export function explainCensusNameEvidence(evidence: CensusNameEvidence): string[] {
  if (!evidence.supportsNameStructure) return [];
  const lines: string[] = [];
  for (const { token, role } of evidence.roles) {
    if (!role) continue;
    const parts: string[] = [];
    if (role.firstAttested) parts.push("first name");
    if (role.surnameAttested) parts.push("surname");
    if (parts.length) lines.push(`"${token}" is attested in U.S. Census name data as a ${parts.join(" and a ")}.`);
  }
  const shape =
    evidence.structure === "first-surname" ? "a first name followed by a surname"
      : evidence.structure === "surname-first" ? "a surname followed by a first name"
        : "a personal-name pattern, though the data does not settle which token is which";
  lines.push(`Together they form ${shape}.`);
  return lines;
}

/**
 * Every attested token, for consumers that need to SCAN the corpus rather
 * than look one token up (AG, 2026-08-10).
 *
 * ADDED FOR VARIANT-FORM EVIDENCE, which builds its own bucketed index for
 * near-form generation. It exists so that this module remains the ONLY reader
 * of `census-names.data.js` -- the one-asset-one-reader invariant asserted in
 * verify/reference-evidence-inertness-verification.ts §1, which is what keeps
 * each family independently regenerable.
 *
 * Derived from the index rather than by re-splitting the asset, so it costs an
 * array of pointers to strings that are already resident instead of a second
 * 1.9 MiB parse and 195,310 fresh allocations. Built lazily on first call; a
 * document that never reaches variant matching never pays for it.
 *
 * READ-ONLY, and a lookup remains the right tool for asking about one token.
 */
let tokenList: readonly string[] | null = null;

export function censusAttestedTokens(): readonly string[] {
  if (tokenList) return tokenList;
  tokenList = [...ensureIndex().index.keys()];
  return tokenList;
}

/** Provenance for the audit record. */
export const CENSUS_EVIDENCE_SOURCE = CENSUS_NAME_SOURCE;
export const CENSUS_EVIDENCE_ENTRY_COUNT = CENSUS_NAME_ENTRY_COUNT;
