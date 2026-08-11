/**
 * GnisPlaceEvidence.ts -- USGS GNIS geographic attestation as deterministic
 * PLACE EVIDENCE (AG, 2026-08-10).
 *
 * Implements the contract selected in
 * `20260810-gnis-census-prevalence-refinement.md` (verdict A, Policy B),
 * derived globally over the national GNIS and Census datasets before any
 * DocScrub witness was consulted.
 *
 * ══════════════════════════ THE CONTRACT ══════════════════════════
 *
 *   STRONG affirmative PLACE evidence requires ALL of:
 *       exact normalized match
 *       AND multi-token
 *       AND feature class in {Populated Place, Civil, Census}
 *       AND NOT (the phrase forms a Census FIRST+SURNAME or SURNAME+FIRST
 *                structure in which BOTH required roles are Census Top-1000)
 *
 *   Otherwise, if an eligible match exists: WEAK geographic corroboration.
 *
 * ══════════════════════════ WHAT THIS IS NOT ══════════════════════════
 *
 *   suppression is a DOWNGRADE, never a deletion -- a suppressed name stays
 *     in the pack, stays queryable, and keeps its provenance
 *   weak is NOT negative evidence
 *   absence from GNIS is NOT evidence against a place reading
 *   GNIS + Census person evidence is a CONFLICT, never an automatic winner
 *
 * There is no `isPlace()` here and there must not be, for the same reason
 * CensusNameEvidence has no `isPerson()`.
 *
 * ══════════ WHY MULTI-TOKEN, AND WHY IT IS NOT A TUNING CHOICE ══════════
 *
 * Every one of the 7 single-token GNIS hits on the live document was a real
 * person: there are US towns named Andrew, Sarah, Diana, Joan, Patrick,
 * Margaret and Christopher. At dataset scale, 15,578 of the 15,711
 * single-token GNIS/Census collisions are Populated Place. Single-token names
 * are excluded from the pack at generation, so this module cannot reach them
 * even by accident.
 *
 * ═══════ WHY POLICY B IS EVALUATED HERE AND NOT IN THE ASSET ═══════
 *
 * The suppression test needs Census Top-1000 role bits, which the Census
 * asset already ships. Baking the answer into the GNIS asset would duplicate
 * Census data into a second file and freeze a decision that belongs to the
 * evidence layer, where it can be explained. `censusRoleFor` is the only
 * Census surface consulted, and only its Top-1000 bits are read -- no counts,
 * no ranks, no new thresholds.
 *
 * ═════ SIGNALS DELIBERATELY ABSENT, because they were FALSIFIED ═════
 *
 * State multiplicity and multi-class support both CORRELATE WITH person-name
 * collision rather than against it (1 state 31.2% vs 5+ states 50.9%;
 * 1 class 32.9% vs 2+ classes 55.8%). Neither is shipped and neither may
 * influence strength. Feature-class membership is carried only to say WHICH
 * class matched, never to add authority for matching several.
 *
 * NO NETWORK. This pack is bundled and local. No candidate-derived text
 * leaves the machine. Regional and Full packs may later download public
 * reference data; that is out of scope here.
 *
 * Pure and DOM-free.
 */

import {
  GNIS_CLASS_CENSUS,
  GNIS_CLASS_CIVIL,
  GNIS_CLASS_FLAG_ALPHABET,
  GNIS_CLASS_POPULATED_PLACE,
  GNIS_PLACE_CLASS_FLAGS,
  GNIS_PLACE_ENTRY_COUNT,
  GNIS_PLACE_KEYS,
  GNIS_PLACE_SOURCE,
} from "./gnis-places.data.js";
import { censusRoleFor } from "./CensusNameEvidence.js";

/**
 * THE APPROVED NORMALIZATION CONTRACT. Lookup only -- the candidate's
 * displayed text is never rewritten, and export/audit always carry the
 * original.
 *
 * NFD -> strip combining marks -> punctuation to SPACE -> collapse -> upper.
 *
 * The punctuation rule is where this differs from
 * `normalizeForCensusLookup`, and the difference is forced by the data:
 * Census keys are single tokens so that normalizer strips non-letters
 * entirely, while GNIS names are multi-word. Collapsing to a space is what
 * keeps `Angeles, CA` from fusing into `ANGELESCA` and matching nothing --
 * or worse, something.
 *
 * DELIBERATELY NOT DONE: fuzzy matching, edit distance, phonetic matching,
 * substring or per-token matching, transliteration beyond accent folding.
 * Exact normalized PHRASE matching only.
 */
export function normalizeForGnisLookup(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toUpperCase();
}

export type GnisFeatureClass = "populated-place" | "civil" | "census";

/** no-match / weak / strong -- the whole vocabulary, deliberately. */
export type GnisEvidenceStrength = "none" | "weak" | "strong";

export interface GnisPlaceEvidence {
  strength: GnisEvidenceStrength;
  /** The normalized string that was looked up. Never displayed as the value. */
  normalized: string;
  /** Which Standard classes attest this name. Provenance, never strength. */
  featureClasses: GnisFeatureClass[];
  /**
   * True when the phrase also forms a Census FIRST+SURNAME or SURNAME+FIRST
   * structure. Recorded whether or not it caused suppression -- an
   * unsuppressed collision is exactly the conflict the interpreter must be
   * able to see.
   */
  censusPersonStructure: boolean;
  /** Present only when Policy B downgraded this match. */
  suppressionReason?: "census-top-1000-both-roles";
  source: string;
}

const NO_MATCH: GnisPlaceEvidence = {
  strength: "none", normalized: "", featureClasses: [], censusPersonStructure: false, source: GNIS_PLACE_SOURCE,
};

let index: Map<string, number> | null = null;
let classBytes: Uint8Array | null = null;

function ensureIndex(): { index: Map<string, number>; flags: Uint8Array } {
  if (index && classBytes) return { index, flags: classBytes };
  const keys = GNIS_PLACE_KEYS.split("\n");
  const built = new Map<string, number>();
  const bytes = new Uint8Array(keys.length);
  for (let i = 0; i < keys.length; i += 1) {
    built.set(keys[i]!, i);
    bytes[i] = GNIS_CLASS_FLAG_ALPHABET.indexOf(GNIS_PLACE_CLASS_FLAGS[i]!);
  }
  index = built;
  classBytes = bytes;
  return { index: built, flags: bytes };
}

function classesOf(bits: number): GnisFeatureClass[] {
  const out: GnisFeatureClass[] = [];
  if (bits & GNIS_CLASS_POPULATED_PLACE) out.push("populated-place");
  if (bits & GNIS_CLASS_CIVIL) out.push("civil");
  if (bits & GNIS_CLASS_CENSUS) out.push("census");
  return out;
}

/**
 * POLICY B, role-aware.
 *
 * A phrase is suppressed only when it forms a genuine name STRUCTURE --
 * FIRST+SURNAME or SURNAME+FIRST -- in which BOTH required roles are Census
 * Top-1000. Mere token membership is not a structure, which is the same rule
 * CensusNameEvidence already enforces.
 *
 * Where both readings exist, EITHER qualifying is enough: a suppression
 * decision must follow the most person-like available reading rather than an
 * average.
 *
 * Returns `{structure, suppress}` so a caller can tell an unsuppressed
 * collision (a conflict worth surfacing) from no collision at all.
 */
function censusCollision(normalized: string): { structure: boolean; suppress: boolean } {
  const tokens = normalized.split(" ");
  if (tokens.length < 2) return { structure: false, suppress: false };
  const lead = censusRoleFor(tokens[0]!);
  const trail = censusRoleFor(tokens[tokens.length - 1]!);
  if (!lead || !trail) return { structure: false, suppress: false };

  const firstSurname = lead.firstAttested && trail.surnameAttested;
  const surnameFirst = lead.surnameAttested && trail.firstAttested;
  if (!firstSurname && !surnameFirst) return { structure: false, suppress: false };

  const firstSurnameTop = firstSurname && lead.firstTop1000 && trail.surnameTop1000;
  const surnameFirstTop = surnameFirst && lead.surnameTop1000 && trail.firstTop1000;
  return { structure: true, suppress: Boolean(firstSurnameTop || surnameFirstTop) };
}

export function gnisPlaceEvidenceFor(displayValue: string): GnisPlaceEvidence {
  const normalized = normalizeForGnisLookup(displayValue);
  // Single-token values cannot be in the pack (excluded at generation), but
  // the check is stated here too so the contract is readable at the call site.
  if (!normalized || !normalized.includes(" ")) return { ...NO_MATCH, normalized };
  const { index: idx, flags } = ensureIndex();
  const at = idx.get(normalized);
  if (at === undefined) return { ...NO_MATCH, normalized };

  const featureClasses = classesOf(flags[at]!);
  const { structure, suppress } = censusCollision(normalized);
  return {
    strength: suppress ? "weak" : "strong",
    normalized,
    featureClasses,
    censusPersonStructure: structure,
    ...(suppress ? { suppressionReason: "census-top-1000-both-roles" as const } : {}),
    source: GNIS_PLACE_SOURCE,
  };
}

/**
 * Reviewer-facing explanation. States what was matched and what it does NOT
 * establish; never asserts that the candidate IS a place.
 */
export function explainGnisPlaceEvidence(evidence: GnisPlaceEvidence): string[] {
  if (evidence.strength === "none") return [];
  const label =
    evidence.featureClasses.includes("populated-place") ? "populated-place name"
      : evidence.featureClasses.includes("civil") ? "civil-division name"
        : "census-area name";
  if (evidence.strength === "strong") {
    return [`Exact match to a U.S. ${label} in the USGS geographic names database.`];
  }
  return [
    `Matches a U.S. ${label} in the USGS geographic names database.`,
    "It also forms a common personal-name pattern, so the geographic reading is not established on its own.",
  ];
}

export const GNIS_EVIDENCE_SOURCE = GNIS_PLACE_SOURCE;
export const GNIS_EVIDENCE_ENTRY_COUNT = GNIS_PLACE_ENTRY_COUNT;
