/**
 * MedicalEvidence.ts -- medical and healthcare terminology attestation as a
 * deterministic DOMAIN REFERENCE evidence family (AG, 2026-08-10).
 *
 * ══════════════════ THE CONTRACT, WHICH IS THE WHOLE POINT ══════════════════
 *
 * This module answers exactly one question per candidate phrase:
 *
 *     is this phrase attested in medical/healthcare terminology sources?
 *
 * It NEVER answers "what is this". There is no semanticTypeFor() here, no
 * isPerson(), no isOrganization(), no suggested Keep or Redact, and there must
 * not be. A hit licenses one sentence and no more:
 *
 *     "This phrase is attested medical/healthcare terminology."
 *
 * ═════════════ THE BOUNDARY SPECIFIC TO THIS FAMILY: NO PATIENT ═════════════
 *
 * The other reference families can be wrong. This one can be HARMFUL if it is
 * read as anything other than a claim about a string, so the boundary is
 * stated separately and enforced by the absence of any code that could cross
 * it.
 *
 * A document containing `Diabetes Mellitus`, `HIV`, `Chemotherapy, Adjuvant`
 * or `Psychiatry` yields, from this module, exactly this: those PHRASES are
 * attested terminology. It does not yield, and nothing here may be used to
 * yield:
 *
 *     the patient has diabetes
 *     this person is HIV-positive
 *     this person received chemotherapy
 *     this person was seen in psychiatry
 *     this candidate is PHI
 *
 * There is no proximity logic, no subject attachment, no co-occurrence rule
 * and no confidence attached to a health state. The module cannot see the
 * surrounding document and must never be extended so that it can infer a
 * person's condition from one.
 *
 * ══════════════════ WHY MEMBERSHIP CANNOT BE A VERDICT ══════════════════
 *
 * The dataset itself flags 38 rows HIGH collision risk and 16 MEDIUM, and the
 * MEDIUM list is the instructive one -- `Case`, `Claim`, `Provider`, `Agent`,
 * `Carrier`, `Premium`, `Bias`, `Surveillance`, `Association`. Every one is
 * genuine CMS/CDC terminology and every one is ordinary English. The HIGH list
 * is chiefly short abbreviations: `RT`, `IV`, `TB`, `LP`, `GAS`, `ADA`, `CPT`,
 * `PEP`, `Ear`, `Eye`.
 *
 *   medicalHit => NOT A PERSON is false.   `GAS` and `Ear` are two-and-three
 *                                          letter strings; personal initials,
 *                                          surnames and OCR fragments land on
 *                                          them. This is the same failure the
 *                                          Census experiment measured and the
 *                                          GNIS benchmark measured again
 *                                          (7 of 7 single-token place hits on
 *                                          the live document were real people).
 *   medicalHit => MEDICAL HERE is false.   `RT` is Reverse Transcription to
 *                                          CDC, Respiratory Therapy to a
 *                                          hospital, and a routing code
 *                                          somewhere else. The source supplies
 *                                          ONE expansion; that is provenance,
 *                                          not disambiguation.
 *   !medicalHit => NOT MEDICAL is false.   This pack is deliberately partial
 *                                          (378 terms; SNOMED, UMLS, LOINC,
 *                                          RxNorm and CPT descriptors are all
 *                                          excluded on licensing grounds).
 *                                          Absence is absence of evidence,
 *                                          never evidence of absence, and no
 *                                          caller may read a miss as a
 *                                          negative.
 *
 * HIGH collision risk is a WARNING CARRIED FORWARD, never an exclusion and
 * never a strengthener. Nothing here filters, downgrades or suppresses on it.
 *
 * ══════════════════ WHY EVERY ATTESTING ROW IS RETURNED ══════════════════
 *
 * `hemodialysis`, `hemofiltration` and `morbidity` are each attested by two
 * independent federal families (CDC and NLM MeSH). Corroboration across
 * independent families is what the source methodology recommends weighting, so
 * `attestations` is a list and callers get all of it. Picking one row here
 * would be resolving a question this layer is not entitled to resolve.
 *
 * ══════════════════ THE EVIDENCE-FAMILY SEAM ══════════════════
 *
 * This is one deterministic evidence family among several that will eventually
 * compose: higher-education terminology (shipped, inert), geography (GNIS,
 * shipped, inert), person/name evidence (Census + the name lexicons),
 * contextual rules, patterns, cross-candidate composition, and the legal and
 * finance packs under construction. Every record carries
 * `family: "medical-terminology"` so a future combination layer can hold a
 * heterogeneous list without a discriminator bolted on afterwards.
 *
 * WHAT IS DELIBERATELY NOT BUILT HERE: a shared `DomainReference` interface, a
 * reference-dataset registry, or a generic lookup base class. There are now
 * two structurally similar families (higher-ed and this one) and a third that
 * is deliberately different (GNIS returns a graded strength, not a row list),
 * which is enough to SEE the pattern and not enough to know its final shape --
 * the legal and finance packs are still landing, and an abstraction fixed now
 * would be fixed against two thirds of its eventual instances. The shapes are
 * kept deliberately parallel so that unification is a mechanical later step;
 * see the implementation report for the specific duplication to collapse.
 *
 * Pure and DOM-free. No network. The pack is bundled and local; no
 * candidate-derived text leaves the machine.
 */

import {
  MEDICAL_COLLISION_RISKS,
  MEDICAL_NOTES,
  MEDICAL_PARENTS,
  MEDICAL_ROWS,
  MEDICAL_SEMANTIC_HINTS,
  MEDICAL_SOURCES,
  MEDICAL_TERMINOLOGY_ROW_COUNT,
  MEDICAL_TERMINOLOGY_SOURCE,
  MEDICAL_TERMINOLOGY_TERM_COUNT,
} from "./medical-terminology.data.js";

/** The source dataset's coarse hint vocabulary, carried verbatim.
 *
 *  IT IS A HINT, NOT A TYPE, and the naming is deliberate -- these are not
 *  `SemanticTypeId` values and must never be mapped onto them by this module.
 *  The source methodology calls them "evidence labels rather than clinical
 *  ontology assertions" and assigns them by deterministic rules over the term
 *  string, which is why `Cardiology` is hinted ORGANIZATION_DEPARTMENT (a
 *  hospital service) and `Anesthesiologists` is hinted ROLE. Neither is a
 *  claim that the candidate IS a department or a role. */
export type MedicalSemanticHint =
  | "MEDICAL_CONCEPT"
  | "CONDITION"
  | "PROCEDURE"
  | "MEDICATION"
  | "TEST"
  | "ANATOMY"
  | "DOCUMENT"
  | "PROCESS_EVENT"
  | "ROLE"
  | "ORGANIZATION_DEPARTMENT"
  | "BILLING_CODING"
  | "IDENTIFIER_TYPE"
  | "OTHER_DOMAIN_TERM"
  | "AMBIGUOUS";

/** The source dataset's deterministic warning. NOT an exclusion criterion and
 *  NOT a confidence score -- see the module header. */
export type MedicalCollisionRisk = "LOW" | "MEDIUM" | "HIGH";

/** Redistribution/authority tier recorded by the source inventory. Carried for
 *  the audit trail; nothing branches on it. */
export type MedicalAuthorityLevel = "US_FEDERAL_AGENCY" | "US_FEDERAL_CONTROLLED_VOCABULARY";

/** One attesting row: a single source's claim that this phrase is terminology. */
export interface MedicalAttestation {
  /** The term exactly as the source wrote it -- casing, hyphens, commas and
   *  inversion (`Arthritis, Rheumatoid`) intact. This is what a reviewer
   *  should be shown; the normalized key is a matching artifact and is never
   *  display text. */
  term: string;
  semanticHint: MedicalSemanticHint;
  source: string;
  sourceUrl: string;
  sourceFamily: string;
  authorityLevel: MedicalAuthorityLevel;
  /** True when the source published this exact label. 374 of 381 rows. */
  sourceAttested: boolean;
  /** True when the row is a conservative orthographic transformation of a
   *  source-attested form (`Case-Control Study` yields `case control study`)
   *  rather than a label the source published on its own. 7 of 381 rows, and
   *  they exist BECAUSE this dataset's normalization keeps hyphens: the two
   *  spellings are genuinely different keys, so the source enumerates both
   *  instead of deriving one at runtime. Weaker provenance, and callers are
   *  told so rather than having it silently folded in. */
  derivedVariant: boolean;
  /** The source-attested form this row was derived from; null on source-
   *  attested rows. Every value here is itself a shipped term (asserted at
   *  generation). */
  parentTerm: string | null;
  collisionRisk: MedicalCollisionRisk;
  /** True when the source marked this row as an abbreviation. 43 of 381. */
  abbreviation: boolean;
  /**
   * THE SOURCE'S expansion for this abbreviation, verbatim, or null.
   *
   * 38 of the 43 abbreviation rows carry one. It is PROVENANCE, NOT
   * DISAMBIGUATION: the row's own note says "abbreviation may have non-medical
   * expansions", and `RT` -> "Reverse Transcription" records what CDC meant on
   * one page, not what `RT` means in the reviewer's document. No caller may
   * treat the presence of an expansion as having resolved the abbreviation,
   * and nothing in DocScrub may pick an expansion from document context --
   * that is a different layer, with different evidence.
   */
  sourceExpansion: string | null;
  /** Provenance prose from the dataset, verbatim and unparsed. `abbreviation`
   *  and `sourceExpansion` above are projections of this string; it is kept so
   *  the audit trail carries the source's own words. */
  notes: string;
}

export interface MedicalEvidence {
  /** Discriminator for the future heterogeneous evidence list. See the
   *  EVIDENCE-FAMILY SEAM note in the module header. */
  family: "medical-terminology";
  /** The phrase as it was passed in. Never rewritten. */
  value: string;
  /** The lookup key this phrase produced. Matching artifact only. */
  normalized: string;
  /** Every row attesting `normalized`, in shipped order (sorted by key, then
   *  by source-dataset order). Never empty -- a miss returns null. */
  attestations: readonly MedicalAttestation[];
  /** True when more than one row attests, i.e. corroboration exists. */
  multiplyAttested: boolean;
  /** True when at least one attesting row is a direct source label rather than
   *  a conservative orthographic variant. */
  hasSourceAttestedRow: boolean;
  /** Distinct source families attesting this phrase, in shipped order. The
   *  unit the source methodology recommends weighting on. */
  sourceFamilies: readonly string[];
  /** The HIGHEST collision risk across attesting rows -- the conservative
   *  reading, because a warning on any row is a warning. */
  highestCollisionRisk: MedicalCollisionRisk;
  /** Distinct semantic hints across attesting rows, in shipped order. A list
   *  because rows may disagree, and disagreement is information this layer
   *  must not resolve. */
  semanticHints: readonly MedicalSemanticHint[];
  /** True when any attesting row is marked an abbreviation. Exposed so a
   *  combination layer can price short-form evidence separately without
   *  re-deriving "does this look like an acronym" from the string. */
  hasAbbreviationRow: boolean;
  /** Every distinct expansion the SOURCES supply, in shipped order. Usually
   *  0 or 1 entries today; a list because the dataset may later attest the
   *  same short form from two sources with two expansions, and that ambiguity
   *  must survive rather than being collapsed to whichever came first. */
  sourceExpansions: readonly string[];
  /**
   * Whitespace-delimited token count of the normalized key. Hyphenated
   * compounds count as ONE (`case-control study` is 2), which is a direct
   * consequence of this dataset's punctuation-preserving normalization.
   *
   * Exposed because the GNIS benchmark established single-token matches as the
   * dangerous case for reference datasets generally, and a combination layer
   * will very likely want to price single-token medical hits differently. This
   * module does NOT act on it -- single-token terms are matched and returned
   * exactly like any other, with their collision risk attached.
   */
  tokenCount: number;
}

/**
 * THE LOOKUP NORMALIZATION CONTRACT.
 *
 * Five steps, reproducing the source dataset's own generator exactly (see the
 * methodology's Normalization section). `scripts/generate_medical_terminology.py`
 * implements the same five steps in Python and ASSERTS that they re-derive
 * `normalized_term` on all 381 rows -- under BOTH Python's full casefold and a
 * Python mirror of the restricted fold below -- so this function and the
 * shipped keys cannot drift without the generator failing loudly.
 *
 *   1. NFKC
 *   2. trim
 *   3. Unicode dash variants -> ASCII hyphen
 *   4. collapse repeated whitespace
 *   5. casefold
 *
 * THE RULE THAT IS ABSENT IS THE LOAD-BEARING ONE. Punctuation is NOT stripped
 * and NOT collapsed to space, which is where this differs from BOTH sibling
 * normalizers: `normalizeForCensusLookup` strips punctuation to nothing (its
 * keys are single tokens) and `normalizeForHigherEdLookup` maps it to space
 * (its keys are multi-word phrases with incidental punctuation). Here the
 * punctuation is part of the term -- `Anti-Inflammatory Agents, Non-Steroidal`,
 * `Arthritis, Rheumatoid`, `COVID-19` -- and this dataset's own generator kept
 * it, so this one does too. Reproducing the source policy is not a style
 * choice; deviating from it would mean the shipped keys are unreachable.
 *
 * A KNOWN CONSEQUENCE, recorded rather than fixed: a candidate carrying
 * trailing sentence punctuation (`Insulin.`) or enclosing brackets does NOT
 * match. Document text routinely carries both. Fixing it means either
 * re-normalizing the dataset (changing shipped keys) or adding a candidate-side
 * trimming step, and the second is a decision about candidate preparation that
 * belongs to whoever owns that boundary -- not something to slip into a
 * reference-lookup module during an inert integration.
 *
 * THIS IS FOR MATCHING ONLY. The candidate's displayValue is never rewritten,
 * the document is never rewritten, and export/audit always carry the original
 * text.
 *
 * DELIBERATELY NOT DONE: fuzzy matching, edit distance, phonetic matching,
 * stemming, lemmatization, singular/plural folding, token reordering, acronym
 * expansion, synonym inference, substring or per-token matching, or any LLM
 * inference. Note in particular that `case control study` and `case-control
 * study` are BOTH shipped rows precisely because nothing derives one from the
 * other at runtime.
 *
 * THE CASEFOLD DETAIL. JavaScript's `toLowerCase()` is the simple lowercase
 * mapping; Unicode full case folding differs on a small set of characters that
 * NFKC does not already resolve. Those are folded explicitly below so this
 * function matches the documented policy on realistic Latin/Greek input rather
 * than only on the ASCII the dataset happens to contain today.
 */
const DASH_VARIANTS = /[‐‑‒–—―⁃−﹘﹣－]/g;
const FOLD_EXCEPTIONS = /[ßẞſς]/g;
const FOLD_EXCEPTION_MAP: Readonly<Record<string, string>> = {
  "ß": "ss",       // LATIN SMALL LETTER SHARP S
  "ẞ": "ss",       // LATIN CAPITAL LETTER SHARP S
  "ſ": "s",        // LATIN SMALL LETTER LONG S
  "ς": "σ",   // GREEK SMALL LETTER FINAL SIGMA
};

export function normalizeForMedicalLookup(phrase: string): string {
  return phrase
    .normalize("NFKC")
    .trim()
    .replace(DASH_VARIANTS, "-")
    .replace(/\s+/gu, " ")
    .replace(FOLD_EXCEPTIONS, (ch) => FOLD_EXCEPTION_MAP[ch]!)
    .toLowerCase();
}

/**
 * Built once, lazily, on first lookup -- a document that never reaches this
 * evidence family never pays for it. Same policy as CensusNameEvidence and
 * HigherEdTerminologyEvidence, for the same reason, at a fraction of the size.
 */
let index: Map<string, MedicalAttestation[]> | null = null;

/**
 * The ONE place where the source's note prose becomes structure.
 *
 * The asset ships `notes` verbatim; these two rules read it. Both are anchored
 * to a field boundary (start of string or "; ") so a term whose own text
 * contains the word "abbreviation" cannot be misread as marked. The generator
 * asserts that these rules find exactly 43 marked rows and 38 expansions --
 * the counts the source methodology itself states -- so a future CSV whose
 * prose changed fails at generation rather than silently producing nothing
 * here.
 */
const ABBREVIATION_MARKER = /(?:^|; )abbreviation(?:;|$)/;
const EXPANSION = /(?:^|; )expansion: (.*?)(?:; |$)/;

function ensureIndex(): Map<string, MedicalAttestation[]> {
  if (index) return index;
  const built = new Map<string, MedicalAttestation[]>();
  for (const line of MEDICAL_ROWS.split("\n")) {
    if (line.length === 0) continue;
    const [normalized, term, hintIdx, sourceIdx, attested, derived, parentIdx, riskIdx, notesIdx] = line.split("\t");
    const source = MEDICAL_SOURCES[Number(sourceIdx)]!;
    const notes = MEDICAL_NOTES[Number(notesIdx)]!;
    const parent = MEDICAL_PARENTS[Number(parentIdx)]!;
    const expansion = EXPANSION.exec(notes);
    const attestation: MedicalAttestation = {
      term: term!,
      semanticHint: MEDICAL_SEMANTIC_HINTS[Number(hintIdx)]! as MedicalSemanticHint,
      source: source[0],
      sourceUrl: source[3],
      sourceFamily: source[1],
      authorityLevel: source[2] as MedicalAuthorityLevel,
      sourceAttested: attested === "1",
      derivedVariant: derived === "1",
      parentTerm: parent.length > 0 ? parent : null,
      collisionRisk: MEDICAL_COLLISION_RISKS[Number(riskIdx)]! as MedicalCollisionRisk,
      abbreviation: ABBREVIATION_MARKER.test(notes),
      sourceExpansion: expansion ? expansion[1]! : null,
      notes,
    };
    const existing = built.get(normalized!);
    if (existing) existing.push(attestation);
    else built.set(normalized!, [attestation]);
  }
  index = built;
  return built;
}

const RISK_ORDER: Record<MedicalCollisionRisk, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

/**
 * The single lookup. Returns null on a miss.
 *
 * NULL MEANS "NOT ATTESTED IN THIS PACK" AND NOTHING ELSE. It is not "not
 * medical language" -- this pack is deliberately partial, and `Chemotherapy`
 * (bare), `Radiology`, `Oncology` and `Emergency Department` are all real
 * healthcare language that misses here. It is certainly not "therefore a
 * person". Callers must treat a miss as the absence of this one evidence
 * family, never as counter-evidence.
 */
export function medicalEvidenceFor(phrase: string): MedicalEvidence | null {
  const normalized = normalizeForMedicalLookup(phrase);
  if (normalized.length === 0) return null;
  const attestations = ensureIndex().get(normalized);
  if (!attestations || attestations.length === 0) return null;

  const sourceFamilies: string[] = [];
  const semanticHints: MedicalSemanticHint[] = [];
  const sourceExpansions: string[] = [];
  let highest: MedicalCollisionRisk = "LOW";
  let hasSourceAttestedRow = false;
  let hasAbbreviationRow = false;
  for (const attestation of attestations) {
    if (!sourceFamilies.includes(attestation.sourceFamily)) sourceFamilies.push(attestation.sourceFamily);
    if (!semanticHints.includes(attestation.semanticHint)) semanticHints.push(attestation.semanticHint);
    if (attestation.sourceExpansion !== null && !sourceExpansions.includes(attestation.sourceExpansion)) {
      sourceExpansions.push(attestation.sourceExpansion);
    }
    if (RISK_ORDER[attestation.collisionRisk] > RISK_ORDER[highest]) highest = attestation.collisionRisk;
    if (attestation.sourceAttested) hasSourceAttestedRow = true;
    if (attestation.abbreviation) hasAbbreviationRow = true;
  }

  return {
    family: "medical-terminology",
    value: phrase,
    normalized,
    attestations,
    multiplyAttested: attestations.length > 1,
    hasSourceAttestedRow,
    sourceFamilies,
    highestCollisionRisk: highest,
    semanticHints,
    hasAbbreviationRow,
    sourceExpansions,
    tokenCount: normalized.split(" ").length,
  };
}

/** Convenience predicate for diagnostics and benchmark harnesses. Production
 *  callers should hold the evidence record instead -- a bare boolean is
 *  precisely the shape that invites treating membership as a verdict. */
export function isAttestedMedicalTerminology(phrase: string): boolean {
  return medicalEvidenceFor(phrase) !== null;
}

/**
 * Reviewer-facing evidence lines. States what was observed, never a verdict,
 * and never anything about a person.
 *
 * "This is a medical term, so it is not a person" and "this document mentions
 * a diagnosis" are precisely the two sentences this wording exists to avoid.
 * The collision warning is surfaced to the reviewer rather than hidden: when
 * the dataset itself flags a term as collision-prone, the reviewer is the right
 * place for that doubt to land, because the reviewer can see the surrounding
 * document and this module cannot.
 */
export function explainMedicalEvidence(evidence: MedicalEvidence | null): string[] {
  if (!evidence) return [];
  const lines: string[] = [];
  const [first] = evidence.attestations;
  if (!first) return [];

  const families = evidence.sourceFamilies.length === 1
    ? evidence.sourceFamilies[0]!
    : `${evidence.sourceFamilies.slice(0, -1).join(", ")} and ${evidence.sourceFamilies[evidence.sourceFamilies.length - 1]!}`;
  lines.push(`"${first.term}" is attested medical/healthcare terminology (${families}).`);

  if (evidence.multiplyAttested) {
    lines.push(`Attested independently by ${evidence.attestations.length} sources.`);
  }
  if (!evidence.hasSourceAttestedRow) {
    const parent = first.parentTerm;
    lines.push(
      parent
        ? `Attested only as an orthographic variant of "${parent}", not as a published label on its own.`
        : "Attested only as an orthographic variant, not as a published label on its own."
    );
  }
  if (evidence.hasAbbreviationRow) {
    lines.push(
      evidence.sourceExpansions.length > 0
        ? `Recorded as an abbreviation; the source writes it out as ${evidence.sourceExpansions.map((e) => `"${e}"`).join(" or ")}. Short forms carry other meanings elsewhere, so this records what the source said, not what it means here.`
        : "Recorded as an abbreviation. Short forms carry other meanings elsewhere, so attestation alone says little here."
    );
  }
  if (evidence.highestCollisionRisk === "HIGH") {
    lines.push("This term is flagged as collision-prone -- it is also ordinary English, a common short form or a personal name, so terminology attestation alone says little here.");
  } else if (evidence.highestCollisionRisk === "MEDIUM") {
    lines.push("This term is flagged as somewhat collision-prone outside healthcare.");
  }
  return lines;
}

/** Provenance for the audit record. */
export const MEDICAL_EVIDENCE_SOURCE = MEDICAL_TERMINOLOGY_SOURCE;
export const MEDICAL_EVIDENCE_ROW_COUNT = MEDICAL_TERMINOLOGY_ROW_COUNT;
export const MEDICAL_EVIDENCE_TERM_COUNT = MEDICAL_TERMINOLOGY_TERM_COUNT;
