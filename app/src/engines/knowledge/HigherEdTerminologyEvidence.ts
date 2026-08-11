/**
 * HigherEdTerminologyEvidence.ts -- higher-education terminology attestation
 * as a deterministic DOMAIN REFERENCE evidence family (AG, 2026-08-10).
 *
 * ══════════════════ THE CONTRACT, WHICH IS THE WHOLE POINT ══════════════════
 *
 * This module answers exactly one question per candidate phrase:
 *
 *     is this phrase attested in higher-education terminology sources?
 *
 * It NEVER answers "what is this". There is no semanticTypeFor() here, no
 * isOrganization(), no isPerson(), no suggested Keep, and there must not be.
 * A hit licenses one sentence and no more:
 *
 *     "This phrase is attested higher-education terminology."
 *
 * ══════════════════ WHY MEMBERSHIP CANNOT BE A VERDICT ══════════════════
 *
 * Measured against the shipped Census asset: 34 of this dataset's
 * single-token terms are ALSO Census-attested personal-name tokens, 19 of
 * them at HIGH collision risk.
 *
 *     White    IPEDS + CEDS   Census first name AND surname, both Top-1000
 *     Major    UT Austin      Census first name AND surname
 *     Minor    UT Austin      Census first name AND surname
 *     Race · Session · Course · Degree · Credit · School · Track · Cookie
 *
 * This is the direct analogue of the failure the Census experiment already
 * measured (attestation protects 80 of 106 known non-people) and of the one
 * the GNIS benchmark measured (7 of 7 single-token place hits were real
 * people). The same shape, from a third source. So:
 *
 *   hedHit => NOT A PERSON is false.   `White` and `Major` are surnames.
 *   hedHit => ORGANIZATION is false.   `Cost of Attendance` is a concept,
 *                                      `Grade Point Average` is a metric;
 *                                      only 86 of 1,394 rows are hinted
 *                                      ORGANIZATION at all.
 *   !hedHit => NOT HIGHER-ED is false. `Academic Senate`, `Grade Rosters`,
 *                                      `Term Withdrawals` and `Registrar`
 *                                      are all real higher-education
 *                                      language and all ABSENT. Absence is
 *                                      absence of evidence, never evidence
 *                                      of absence, and no caller may read it
 *                                      as a negative.
 *
 * HIGH collision risk in particular is a WARNING CARRIED FORWARD, never an
 * exclusion and never a strengthener. The source methodology retains
 * collision-prone terms deliberately, because they can still supply useful
 * weak evidence once surrounding context is available -- and "once context is
 * available" is a different layer than this one.
 *
 * ══════════════════ WHY EVERY ATTESTING ROW IS RETURNED ══════════════════
 *
 * 21 normalized terms are attested by more than one row, and the interesting
 * ones cross source families -- `academic year` by IPEDS and by Federal
 * Student Aid, `white` by IPEDS and by CEDS. Corroboration across
 * independent families is exactly what the source methodology recommends
 * weighting, so `attestations` is a list and callers get all of it. Picking
 * one row here would be resolving a question this layer is not entitled to
 * resolve.
 *
 * ══════════════════ THE EVIDENCE-FAMILY SEAM ══════════════════
 *
 * This is ONE evidence family among several deterministic families that will
 * eventually compose: geography (GNIS -- benchmarked, not integrated, see
 * 20260810-gnis-place-evidence-benchmark.md), person/name evidence (Census +
 * the name lexicons), contextual rules, patterns, cross-candidate
 * composition. Every record below carries `family: "higher-ed-terminology"`
 * so a future combination layer can hold a heterogeneous list without
 * needing a discriminator bolted on afterwards.
 *
 * What is DELIBERATELY NOT built here: a reference-dataset registry, a shared
 * `DomainReference` interface, or a generic lookup base class. GNIS is not
 * integrated in this branch -- there is no second implementation to
 * generalize FROM, and inventing the abstraction against one example would
 * be guessing at another worker's unfinished architecture. The naming
 * discipline above is the seam; the abstraction is deferred until a second
 * family exists to shape it.
 *
 * Pure and DOM-free.
 */

import {
  HIGHER_ED_COLLISION_RISKS,
  HIGHER_ED_NOTES,
  HIGHER_ED_ROWS,
  HIGHER_ED_SEMANTIC_HINTS,
  HIGHER_ED_SOURCES,
  HIGHER_ED_TERMINOLOGY_ROW_COUNT,
  HIGHER_ED_TERMINOLOGY_SOURCE,
  HIGHER_ED_TERMINOLOGY_TERM_COUNT,
  HIGHER_ED_URLS,
} from "./higher-ed-terminology.data.js";

/** The source dataset's coarse hint vocabulary, carried verbatim.
 *
 *  IT IS A HINT, NOT A TYPE, and the naming is deliberate -- these are not
 *  `SemanticTypeId` values and must never be mapped onto them by this module.
 *  The source methodology calls them "evidence features, not final entity
 *  labels" and assigns them by deterministic lexical rules over the term
 *  string, which is why `Address Type for Staff` is hinted ROLE and
 *  `Activity Identifier` is hinted DOCUMENT_SYSTEM. */
export type HigherEdSemanticHint =
  | "ACADEMIC_CONCEPT"
  | "DOCUMENT_SYSTEM"
  | "ORGANIZATION"
  | "OTHER_DOMAIN_TERM"
  | "PROCESS_EVENT"
  | "ROLE"
  | "AMBIGUOUS";

/** The source dataset's deterministic warning. NOT an exclusion criterion and
 *  NOT a confidence score -- see the module header. */
export type HigherEdCollisionRisk = "LOW" | "MEDIUM" | "HIGH";

/** One attesting row: a single source's claim that this phrase is terminology. */
export interface HigherEdAttestation {
  /** The term exactly as the source wrote it -- casing, punctuation and
   *  parentheses intact. This is what a reviewer should be shown; the
   *  normalized key is a matching artifact and is never display text. */
  term: string;
  semanticHint: HigherEdSemanticHint;
  source: string;
  sourceUrl: string;
  sourceFamily: string;
  /** True when the row is a mechanical transformation of a source-attested
   *  parenthetical form (`Satisfactory Academic Progress (SAP)` yields both
   *  `Satisfactory Academic Progress` and `SAP`) rather than a label the
   *  source published on its own. 176 of 1,394 rows. Weaker provenance, and
   *  callers are told so rather than having it silently folded in. */
  derivedVariant: boolean;
  collisionRisk: HigherEdCollisionRisk;
  /** Provenance prose from the dataset; for derived variants it names the
   *  parent form and the derivation rule. */
  notes: string;
}

export interface HigherEdTerminologyEvidence {
  /** Discriminator for the future heterogeneous evidence list. See the
   *  EVIDENCE-FAMILY SEAM note in the module header. */
  family: "higher-ed-terminology";
  /** The phrase as it was passed in. Never rewritten. */
  value: string;
  /** The lookup key this phrase produced. Matching artifact only. */
  normalized: string;
  /** Every row attesting `normalized`, in shipped order (sorted by key, then
   *  by source-dataset order). Never empty -- a miss returns null. */
  attestations: readonly HigherEdAttestation[];
  /** True when more than one row attests, i.e. corroboration exists. */
  multiplyAttested: boolean;
  /** True when at least one attesting row is a direct source label rather
   *  than a mechanically derived variant. */
  hasSourceAttestedRow: boolean;
  /** Distinct source families attesting this phrase, in shipped order. The
   *  unit the source methodology recommends weighting on. */
  sourceFamilies: readonly string[];
  /** The HIGHEST collision risk across attesting rows -- the conservative
   *  reading, because a warning on any row is a warning. */
  highestCollisionRisk: HigherEdCollisionRisk;
  /** Distinct semantic hints across attesting rows, in shipped order. A list
   *  because rows may disagree, and disagreement is information this layer
   *  must not resolve. */
  semanticHints: readonly HigherEdSemanticHint[];
  /** Token count of the normalized key. Exposed because the GNIS benchmark
   *  established single-token matches as the dangerous case for a REFERENCE
   *  dataset generally, and a future combination layer will very likely want
   *  to price single-token higher-ed hits differently too. This module does
   *  NOT act on it -- single-token terms are matched and returned exactly
   *  like any other, with their collision risk attached. */
  tokenCount: number;
}

/**
 * THE LOOKUP NORMALIZATION CONTRACT.
 *
 * Six steps, reproducing the source dataset's own generator exactly (see the
 * methodology's §Normalization). `scripts/generate_higher_ed_terminology.py`
 * implements the same six steps in Python and ASSERTS that they re-derive
 * `normalized_term` on all 1,394 rows, so this function and the shipped keys
 * cannot drift without the generator failing loudly.
 *
 *   1. NFKC
 *   2. smart apostrophes/dashes -> ASCII    (`Veteran’s` -> `Veteran's`)
 *   3. lowercase
 *   4. `&` -> ` and `                       (`GASB 34 & 35`, `(O&M)`)
 *   5. every non-alphanumeric run -> SPACE
 *   6. collapse whitespace, trim
 *
 * STEP 5 IS THE LOAD-BEARING ONE, and it differs from
 * `normalizeForCensusLookup`, which strips punctuation to NOTHING. The
 * difference is forced by the data and is not a style choice: Census keys are
 * single tokens, these are multi-word phrases. Stripping would fuse tokens and
 * manufacture keys the sources never contained. The GNIS benchmark reached the
 * identical conclusion for the identical reason (§4).
 *
 * THIS IS FOR MATCHING ONLY. The candidate's displayValue is never rewritten,
 * the document is never rewritten, and export/audit always carry the original
 * text.
 *
 * DELIBERATELY NOT DONE: fuzzy matching, edit distance, stemming,
 * lemmatization, singular/plural folding, acronym expansion, synonym
 * expansion, or any LLM inference. Note in particular that `Accrediting
 * agencies` and `Accrediting bodies` are BOTH shipped as separate rows
 * precisely because the dataset enumerates variants rather than deriving
 * them, and nothing here derives them either.
 */
export function normalizeForHigherEdLookup(phrase: string): string {
  return phrase
    .normalize("NFKC")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐‑‒–—―−]/g, "-")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Built once, lazily, on first lookup -- a document that never reaches this
 * evidence family never pays for it. Same policy as CensusNameEvidence, for
 * the same reason, at 1/140th the size.
 */
let index: Map<string, HigherEdAttestation[]> | null = null;

function ensureIndex(): Map<string, HigherEdAttestation[]> {
  if (index) return index;
  const built = new Map<string, HigherEdAttestation[]>();
  for (const line of HIGHER_ED_ROWS.split("\n")) {
    if (line.length === 0) continue;
    const [normalized, term, hintIdx, sourceIdx, urlIdx, derived, riskIdx, notesIdx] = line.split("\t");
    const sourcePair = HIGHER_ED_SOURCES[Number(sourceIdx)]!;
    const attestation: HigherEdAttestation = {
      term: term!,
      semanticHint: HIGHER_ED_SEMANTIC_HINTS[Number(hintIdx)]! as HigherEdSemanticHint,
      source: sourcePair[0],
      sourceUrl: HIGHER_ED_URLS[Number(urlIdx)]!,
      sourceFamily: sourcePair[1],
      derivedVariant: derived === "1",
      collisionRisk: HIGHER_ED_COLLISION_RISKS[Number(riskIdx)]! as HigherEdCollisionRisk,
      notes: HIGHER_ED_NOTES[Number(notesIdx)]!,
    };
    const existing = built.get(normalized!);
    if (existing) existing.push(attestation);
    else built.set(normalized!, [attestation]);
  }
  index = built;
  return built;
}

const RISK_ORDER: Record<HigherEdCollisionRisk, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

/**
 * The single lookup. Returns null on a miss.
 *
 * NULL MEANS "NOT ATTESTED IN THIS DATASET" AND NOTHING ELSE. It is not
 * "not higher-education language" and it is certainly not "therefore a
 * person" -- `Academic Senate`, `Grade Rosters`, `Term Withdrawals`,
 * `Registrar`, `Dean` and `Spring` are all absent from this dataset, and the
 * first three are known live non-person witnesses. Callers must treat a miss
 * as the absence of this one evidence family, never as counter-evidence.
 */
export function higherEdTerminologyFor(phrase: string): HigherEdTerminologyEvidence | null {
  const normalized = normalizeForHigherEdLookup(phrase);
  if (normalized.length === 0) return null;
  const attestations = ensureIndex().get(normalized);
  if (!attestations || attestations.length === 0) return null;

  const sourceFamilies: string[] = [];
  const semanticHints: HigherEdSemanticHint[] = [];
  let highest: HigherEdCollisionRisk = "LOW";
  let hasSourceAttestedRow = false;
  for (const attestation of attestations) {
    if (!sourceFamilies.includes(attestation.sourceFamily)) sourceFamilies.push(attestation.sourceFamily);
    if (!semanticHints.includes(attestation.semanticHint)) semanticHints.push(attestation.semanticHint);
    if (RISK_ORDER[attestation.collisionRisk] > RISK_ORDER[highest]) highest = attestation.collisionRisk;
    if (!attestation.derivedVariant) hasSourceAttestedRow = true;
  }

  return {
    family: "higher-ed-terminology",
    value: phrase,
    normalized,
    attestations,
    multiplyAttested: attestations.length > 1,
    hasSourceAttestedRow,
    sourceFamilies,
    highestCollisionRisk: highest,
    semanticHints,
    tokenCount: normalized.split(" ").length,
  };
}

/** Convenience predicate for diagnostics and benchmark harnesses. Production
 *  callers should hold the evidence record instead -- a bare boolean is
 *  precisely the shape that invites treating membership as a verdict. */
export function isAttestedHigherEdTerminology(phrase: string): boolean {
  return higherEdTerminologyFor(phrase) !== null;
}

/**
 * Reviewer-facing evidence lines. States what was observed, never a verdict.
 *
 * "This is a higher-education term, so it is not a person" is precisely the
 * sentence this wording exists to avoid. Note that the collision warning is
 * surfaced to the reviewer rather than hidden: when the dataset itself flags a
 * term as collision-prone, the reviewer is the right place for that doubt to
 * land, because the reviewer can see the surrounding document and this module
 * cannot.
 */
export function explainHigherEdTerminologyEvidence(evidence: HigherEdTerminologyEvidence | null): string[] {
  if (!evidence) return [];
  const lines: string[] = [];
  const [first] = evidence.attestations;
  if (!first) return [];

  const families = evidence.sourceFamilies.length === 1
    ? evidence.sourceFamilies[0]!
    : `${evidence.sourceFamilies.slice(0, -1).join(", ")} and ${evidence.sourceFamilies[evidence.sourceFamilies.length - 1]!}`;
  lines.push(`"${first.term}" is attested higher-education terminology (${families}).`);

  if (evidence.multiplyAttested) {
    lines.push(`Attested independently by ${evidence.attestations.length} sources.`);
  }
  if (!evidence.hasSourceAttestedRow) {
    lines.push("Attested only as a mechanically derived variant of a longer source term, not as a published label on its own.");
  }
  if (evidence.highestCollisionRisk === "HIGH") {
    lines.push("This term is flagged as collision-prone -- it is also ordinary English or a common personal name, so terminology attestation alone says little here.");
  } else if (evidence.highestCollisionRisk === "MEDIUM") {
    lines.push("This term is flagged as somewhat collision-prone outside higher education.");
  }
  return lines;
}

/** Provenance for the audit record. */
export const HIGHER_ED_EVIDENCE_SOURCE = HIGHER_ED_TERMINOLOGY_SOURCE;
export const HIGHER_ED_EVIDENCE_ROW_COUNT = HIGHER_ED_TERMINOLOGY_ROW_COUNT;
export const HIGHER_ED_EVIDENCE_TERM_COUNT = HIGHER_ED_TERMINOLOGY_TERM_COUNT;
