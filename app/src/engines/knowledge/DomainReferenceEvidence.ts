/**
 * DomainReferenceEvidence.ts -- the shared substrate for deterministic
 * DOMAIN TERMINOLOGY reference packs (AG, 2026-08-10).
 *
 * ══════════════════ WHY THIS FILE EXISTS NOW AND NOT BEFORE ══════════════════
 *
 * `HigherEdTerminologyEvidence.ts` shipped hours ago with an explicit refusal
 * to build this:
 *
 *     "What is DELIBERATELY NOT built here: a reference-dataset registry, a
 *      shared `DomainReference` interface, or a generic lookup base class.
 *      [...] there is no second implementation to generalize FROM, and
 *      inventing the abstraction against one example would be guessing."
 *
 * That was the right call then and its stated stop-condition has now been
 * met: the Finance/Accounting/Tax pack and the Legal pack arrived together,
 * both provenance-carrying terminology references with the same row model
 * (term, normalized_term, semantic_hint, source provenance, source_attested,
 * derived_variant, parent_term, collision_risk, notes). Three examples --
 * two of them concrete and in hand -- is enough to shape an abstraction
 * without guessing at it. A Medical pack CSV is already staged in
 * `investigation/data/`, which will make four.
 *
 * HIGHER-ED IS DELIBERATELY NOT MIGRATED ONTO THIS (AG's call, 2026-08-10).
 * It works, it is verified, and it shipped the same day this was written --
 * rewriting a file that concurrent work may be holding buys nothing today.
 * `ReferenceEvidence.ts` reads it through its own API, so the aggregator is
 * already whole. Migrating it later is one mechanical file change plus an
 * asset regeneration, and the shape below was designed to accept it: every
 * field higher-ed carries has a home here.
 *
 * ══════════════════ WHAT A PACK BUILT ON THIS MAY CLAIM ══════════════════
 *
 * Exactly one sentence, and the noun is supplied by the pack:
 *
 *     "This phrase is attested <finance/accounting/tax | legal> terminology."
 *
 * There is no `semanticTypeFor()` here, no `isOrganization()`, no
 * `isPerson()`, no suggested Keep, and there must not be. The three failures
 * this substrate exists to make structurally awkward:
 *
 *   hit => NOT A PERSON     is false. The Legal pack contains `Doe`, `Judge`
 *                           and `Levy`; the Finance pack contains `basis`,
 *                           `margin` and `security`. Census attests several of
 *                           those as personal names -- measured: 52 of 445
 *                           legal terms and 61 of 651 finance terms are
 *                           Census-attested in every token. This is the identical
 *                           failure the Census experiment measured and the
 *                           GNIS benchmark measured again (7 of 7 single-token
 *                           place hits were real people).
 *
 *   hit => ORGANIZATION     is false. `semantic_hint` is a coarse lookup hint
 *                           assigned by lexical rule, not a type. Both source
 *                           methodologies say so in as many words: "evidence
 *                           features, not final entity labels" / "hints, not
 *                           final DocScrub types".
 *
 *   MISS => NOT DOMAIN      is false, and this is the one callers get wrong.
 *                           Absence of evidence is never evidence of absence.
 *                           Both packs are explicitly partial v1 vocabularies
 *                           with documented gaps (state tax, insurance,
 *                           contracts drafting, immigration, antitrust...).
 *                           A miss means "not in this dataset" and nothing
 *                           more.
 *
 * HIGH collision risk is a WARNING CARRIED FORWARD, never an exclusion and
 * never a strengthener. Both source methodologies retain collision-prone
 * terms deliberately. Suppressing them here would destroy the very signal
 * the eventual combination layer needs in order to recognise a conflict.
 *
 * ══════════════════ WHY ATTESTATIONS ARE A LIST ══════════════════
 *
 * A normalized phrase may be attested by several authorities, and which ones
 * is the interesting part. `account balance` is attested by Treasury/USSGL as
 * an ACCOUNTING concept and by the FDIC as a FINANCE concept; `Default
 * judgment` is attested by both the federal judiciary and a California
 * superior court. Corroboration across independent source families is exactly
 * what both methodologies recommend weighting, so every attesting row
 * survives lookup and callers get all of them. Collapsing to a boolean --
 * `dictionaryHit: true` -- is the shape the Legal brief names as the thing
 * not to build, and it is unrecoverable once done.
 *
 * ══════════════════ NORMALIZATION IS PER PACK, NOT SHARED ══════════════════
 *
 * The one thing this substrate deliberately does NOT unify. Each pack ships
 * its own normalizer because each source methodology documents a different
 * one, and the differences are forced by the data rather than stylistic:
 *
 *   higher-ed  every non-alphanumeric run -> SPACE
 *   finance    punctuation PRESERVED  (`Form 10-K` must not equal `Form 10K`;
 *              hyphenation alternates are shipped as explicit derived rows)
 *   legal      punctuation preserved, PLUS spaces stripped around `/` and `-`
 *   census     punctuation stripped to NOTHING (single-token keys)
 *   GNIS       punctuation -> SPACE, accent-folded, uppercased
 *
 * Forcing one normalizer on all of them would silently change what an
 * existing family means in order to make the implementations look uniform --
 * which the Legal brief calls out by name. What IS shared is the discipline:
 * deterministic, exact, locale-independent, lookup-only. No fuzzy matching,
 * no edit distance, no stemming, no lemmatisation, no synonym expansion, no
 * transliteration, no model inference. The candidate's display value is never
 * rewritten; the normalized form is a matching artifact and never display
 * text.
 *
 * Each pack's generator re-derives `normalized_term` from `term` in Python
 * and asserts equality on every row, so a pack's TypeScript normalizer cannot
 * drift from its shipped keys without the generator failing loudly.
 *
 * Pure and DOM-free. No network, no runtime fetch: packs are bundled local
 * assets and every lookup is offline.
 */

/** Discriminator for the heterogeneous evidence list a future combination
 *  layer will hold. Higher-ed's own literal (`"higher-ed-terminology"`) and
 *  medical's (`"medical-terminology"`) are deliberately NOT included here --
 *  each is produced by its own module and joins this union if and when that
 *  module migrates onto this substrate.
 *
 *  Employment/HR (AG, 2026-08-10) was built on this substrate from the start,
 *  so it joins by adding one member here. That is the whole cost of a new
 *  family, which is what this file was for.
 *
 *  Government/Public Administration (AG, 2026-08-10) joined the same way and
 *  is worth recording because it is the first pack that carries a fact the
 *  shared row model has no column for -- a jurisdiction. It resolved that
 *  WITHOUT widening the row contract: the value is constant across the pack,
 *  so its generator asserts that and emits one constant, and the provider
 *  carries it on its own evidence alias. The rule that produced the right
 *  answer there generalises: a pack-specific field that does not vary is not
 *  a reason to widen a shape every other pack's shipped asset depends on. */
export type DomainReferenceFamilyId =
  | "employment-hr-terminology"
  | "finance-accounting-tax"
  | "government-public-admin"
  | "legal-terminology";

/** Both source datasets' conservative lexical warning. NOT an exclusion
 *  criterion, NOT a confidence score, NOT a weight. */
export type DomainReferenceCollisionRisk = "LOW" | "MEDIUM" | "HIGH";

/** One attesting row: a single authority's claim that this phrase is
 *  terminology in its domain. */
export interface DomainReferenceAttestation {
  /** The term exactly as the source wrote it -- casing, punctuation and
   *  parentheses intact. This is what a reviewer should be shown; the
   *  normalized key is a matching artifact and is never display text. */
  term: string;
  /** Coarse hints from the source dataset, carried verbatim. PLURAL because
   *  the Legal pack genuinely assigns more than one to a single term
   *  (`Complaint` is DOCUMENT and COURT_PROCEDURE). These are not
   *  `SemanticTypeId` values and must never be mapped onto them. */
  semanticHints: readonly string[];
  /** The sub-domain within the pack, where the pack distinguishes one:
   *  FINANCE / ACCOUNTING / TAX for the finance pack, null for legal. Kept so
   *  an evidence trace can say "IRS tax terminology evidence" rather than
   *  "business terminology evidence". */
  subDomain: string | null;
  source: string;
  sourceUrl: string;
  sourceFamily: string;
  /** The authority tier the source dataset assigned (`US_FEDERAL_TAX_AUTHORITY`,
   *  `HIGH`, ...). Vocabulary differs per pack; carried, never compared. */
  sourceAuthorityLevel: string;
  /** Source-local identifier where the dataset supplies one. */
  sourceId: string | null;
  /** True when the cited source attested this exact display form. */
  sourceAttested: boolean;
  /** True when the row is a mechanical transformation of a source-attested
   *  form (acronym extraction, punctuation variant, explicit alias) rather
   *  than a label the source published on its own. Weaker provenance, and
   *  callers are told so rather than having it silently folded in. */
  derivedVariant: boolean;
  /** The attested form this row was derived from. Non-null iff derivedVariant. */
  parentTerm: string | null;
  collisionRisk: DomainReferenceCollisionRisk;
  /** Acronym/expansion pair where the source family attests the relationship.
   *  An acronym row NEVER implies a globally unique meaning -- `ABS`, `APR`
   *  and `NDA` are evidence local to the cited source and domain. */
  acronym: string | null;
  acronymExpansion: string | null;
  /** Provenance prose from the dataset; for derived variants it names the
   *  parent form and the derivation rule, and for collision-prone terms it
   *  often names the colliding domain. */
  notes: string;
}

/** The result of one lookup. Null is returned for a miss -- there is no
 *  "empty evidence" object, because an empty object invites being read as a
 *  negative finding. */
export interface DomainReferenceEvidence<F extends DomainReferenceFamilyId = DomainReferenceFamilyId> {
  family: F;
  /** The phrase as it was passed in. Never rewritten. */
  value: string;
  /** The lookup key this phrase produced. Matching artifact only. */
  normalized: string;
  /** Every row attesting `normalized`, in shipped order. Never empty. */
  attestations: readonly DomainReferenceAttestation[];
  /** True when more than one row attests, i.e. corroboration exists. */
  multiplyAttested: boolean;
  /** True when at least one attesting row is a direct source label rather
   *  than a mechanically derived variant. */
  hasSourceAttestedRow: boolean;
  /** Distinct source families attesting this phrase, in shipped order. The
   *  unit both methodologies recommend weighting on. */
  sourceFamilies: readonly string[];
  /** Distinct sub-domains attesting this phrase, in shipped order. Empty for
   *  packs that do not distinguish sub-domains. */
  subDomains: readonly string[];
  /** Distinct hints across attesting rows, in shipped order. A list because
   *  rows may disagree, and disagreement is information this layer must not
   *  resolve. */
  semanticHints: readonly string[];
  /** The HIGHEST collision risk across attesting rows -- the conservative
   *  reading, because a warning on any row is a warning. */
  highestCollisionRisk: DomainReferenceCollisionRisk;
  /** Whitespace-separated token count of the normalized key. Exposed because
   *  the GNIS benchmark established single-token matches as the dangerous
   *  case for reference datasets generally. This layer does NOT act on it --
   *  single-token terms match and return exactly like any other, with their
   *  collision risk attached. */
  tokenCount: number;
}

/**
 * The wire format every generated pack asset exports.
 *
 * One TSV row block plus intern tables, which is the representation the
 * higher-ed asset established and which suits these sizes (710 and 449 rows).
 * The Census asset's bit-packing is deliberately not used: at three orders of
 * magnitude smaller it would cost readability and buy nothing.
 *
 * `rows` columns, TAB-separated, in this order:
 *
 *   0  normalized      the lookup key
 *   1  term            display form, verbatim from source
 *   2  hintSetIdx      -> hintSets
 *   3  subDomainIdx    -> subDomains  (index 0 is "" meaning none)
 *   4  sourceIdx       -> sources
 *   5  sourceIdIdx     -> strings     (index 0 is "")
 *   6  sourceAttested  0 | 1
 *   7  derivedVariant  0 | 1
 *   8  parentIdx       -> strings
 *   9  riskIdx         -> COLLISION_RISK_ORDER
 *  10  acronymIdx      -> strings
 *  11  acronymExpIdx   -> strings
 *  12  notesIdx        -> strings
 *
 * Intern-table ORDER IS LOAD-BEARING: regenerating with a different order
 * invalidates every shipped row.
 */
export interface DomainReferencePackAsset {
  /** Dataset version identifier, e.g. `docscrub-legal-terminology/2026-08-10`. */
  source: string;
  rowCount: number;
  termCount: number;
  rows: string;
  /** Pipe-separated hint combinations exactly as the source wrote them. */
  hintSets: readonly string[];
  /** Index 0 MUST be "" -- packs without sub-domains use it for every row. */
  subDomains: readonly string[];
  /** [source name, source url, source family, source authority level]. */
  sources: readonly (readonly [string, string, string, string])[];
  /** Shared pool for the sparse columns. Index 0 MUST be "". */
  strings: readonly string[];
}

/** Index-addressed by row column 9. Order is load-bearing. */
export const COLLISION_RISK_ORDER: readonly DomainReferenceCollisionRisk[] = ["LOW", "MEDIUM", "HIGH"];

const RISK_RANK: Record<DomainReferenceCollisionRisk, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

/**
 * Decodes a pack asset into a lookup index.
 *
 * Callers build this LAZILY, on first lookup, so a document that never
 * reaches a given evidence family never pays for it -- the same policy
 * CensusNameEvidence and HigherEdTerminologyEvidence use, for the same
 * reason, at a fraction of the size.
 */
export function buildDomainReferenceIndex(asset: DomainReferencePackAsset): Map<string, DomainReferenceAttestation[]> {
  const index = new Map<string, DomainReferenceAttestation[]>();
  for (const line of asset.rows.split("\n")) {
    if (line.length === 0) continue;
    const f = line.split("\t");
    const source = asset.sources[Number(f[4])]!;
    const subDomain = asset.subDomains[Number(f[3])]!;
    const sourceId = asset.strings[Number(f[5])]!;
    const parentTerm = asset.strings[Number(f[8])]!;
    const acronym = asset.strings[Number(f[10])]!;
    const acronymExpansion = asset.strings[Number(f[11])]!;
    const attestation: DomainReferenceAttestation = {
      term: f[1]!,
      semanticHints: asset.hintSets[Number(f[2])]!.split("|"),
      subDomain: subDomain.length === 0 ? null : subDomain,
      source: source[0],
      sourceUrl: source[1],
      sourceFamily: source[2],
      sourceAuthorityLevel: source[3],
      sourceId: sourceId.length === 0 ? null : sourceId,
      sourceAttested: f[6] === "1",
      derivedVariant: f[7] === "1",
      parentTerm: parentTerm.length === 0 ? null : parentTerm,
      collisionRisk: COLLISION_RISK_ORDER[Number(f[9])]!,
      acronym: acronym.length === 0 ? null : acronym,
      acronymExpansion: acronymExpansion.length === 0 ? null : acronymExpansion,
      notes: asset.strings[Number(f[12])]!,
    };
    const existing = index.get(f[0]!);
    if (existing) existing.push(attestation);
    else index.set(f[0]!, [attestation]);
  }
  return index;
}

/**
 * The one lookup, shared by every pack. Returns null on a miss.
 *
 * NULL MEANS "NOT ATTESTED IN THIS DATASET" AND NOTHING ELSE. It is not "not
 * legal language", not "not financial language", and certainly not "therefore
 * a person". Both packs are documented partial v1 vocabularies. Callers must
 * treat a miss as the absence of one evidence family, never as counter-
 * evidence.
 *
 * The caller supplies its own already-normalized key, because normalization
 * is per pack -- see the module header for why that is not unified.
 */
export function lookupDomainReference<F extends DomainReferenceFamilyId>(
  family: F,
  index: ReadonlyMap<string, DomainReferenceAttestation[]>,
  phrase: string,
  normalized: string
): DomainReferenceEvidence<F> | null {
  if (normalized.length === 0) return null;
  const attestations = index.get(normalized);
  if (!attestations || attestations.length === 0) return null;

  const sourceFamilies: string[] = [];
  const subDomains: string[] = [];
  const semanticHints: string[] = [];
  let highestCollisionRisk: DomainReferenceCollisionRisk = "LOW";
  let hasSourceAttestedRow = false;
  for (const attestation of attestations) {
    if (!sourceFamilies.includes(attestation.sourceFamily)) sourceFamilies.push(attestation.sourceFamily);
    if (attestation.subDomain !== null && !subDomains.includes(attestation.subDomain)) subDomains.push(attestation.subDomain);
    for (const hint of attestation.semanticHints) if (!semanticHints.includes(hint)) semanticHints.push(hint);
    if (RISK_RANK[attestation.collisionRisk] > RISK_RANK[highestCollisionRisk]) highestCollisionRisk = attestation.collisionRisk;
    if (attestation.sourceAttested && !attestation.derivedVariant) hasSourceAttestedRow = true;
  }

  return {
    family,
    value: phrase,
    normalized,
    attestations,
    multiplyAttested: attestations.length > 1,
    hasSourceAttestedRow,
    sourceFamilies,
    subDomains,
    semanticHints,
    highestCollisionRisk,
    tokenCount: normalized.split(" ").filter((t) => t.length > 0).length,
  };
}

/**
 * Reviewer-facing evidence lines. States what was observed, never a verdict.
 *
 * "This is a legal term, so it is not a person" is precisely the sentence
 * this wording exists to avoid. The collision warning is SURFACED rather than
 * hidden: when the dataset itself flags a term as collision-prone, the
 * reviewer is the right place for that doubt to land, because the reviewer
 * can see the surrounding document and this module cannot.
 *
 * `noun` is supplied by the pack ("legal terminology", "finance/accounting/tax
 * terminology") so the one licensed sentence reads naturally without this
 * module knowing anything about either domain.
 */
export function explainDomainReferenceEvidence(evidence: DomainReferenceEvidence | null, noun: string): string[] {
  if (!evidence) return [];
  const [first] = evidence.attestations;
  if (!first) return [];

  const lines: string[] = [];
  const families = evidence.sourceFamilies.length === 1
    ? evidence.sourceFamilies[0]!
    : `${evidence.sourceFamilies.slice(0, -1).join(", ")} and ${evidence.sourceFamilies[evidence.sourceFamilies.length - 1]!}`;
  const domain = evidence.subDomains.length > 0 ? ` [${evidence.subDomains.join(", ")}]` : "";
  lines.push(`"${first.term}" is attested ${noun}${domain} (${families}).`);

  if (evidence.multiplyAttested) {
    lines.push(`Attested independently by ${evidence.attestations.length} sources.`);
  }
  if (!evidence.hasSourceAttestedRow) {
    const parent = first.parentTerm;
    lines.push(
      parent
        ? `Attested only as a mechanically derived form of "${parent}", not as a published label on its own.`
        : "Attested only as a mechanically derived variant, not as a published label on its own."
    );
  }
  if (first.acronym && first.acronymExpansion) {
    lines.push(`Recorded by this source as an abbreviation of "${first.acronymExpansion}" -- local to this source and domain, not a globally unique meaning.`);
  }
  if (evidence.highestCollisionRisk === "HIGH") {
    lines.push("This term is flagged as collision-prone -- it is also ordinary English or a common personal name, so terminology attestation alone says little here.");
  } else if (evidence.highestCollisionRisk === "MEDIUM") {
    lines.push("This term is flagged as somewhat collision-prone outside its domain.");
  }
  return lines;
}
