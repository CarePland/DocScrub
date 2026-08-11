/**
 * GovernmentPublicAdminEvidence.ts -- government and public-administration
 * terminology attestation as a deterministic DOMAIN REFERENCE evidence family
 * (AG, 2026-08-10).
 *
 * Built on the shared substrate in `DomainReferenceEvidence.ts`; read that
 * file's header for the contract every domain-reference pack shares. What is
 * specific to THIS pack is below.
 *
 * ══════════════════════ THE ONE CLAIM ══════════════════════
 *
 *     "This phrase is attested government/public-administration terminology
 *      according to the cited source."
 *
 * Three things it deliberately does not say, in increasing order of how badly
 * a caller would be wrong to infer them:
 *
 *   NOT "this phrase is government-related IN THIS DOCUMENT". The lookup
 *        cannot see the document. `Notice`, `Record` and `Title` are attested
 *        here and are also three of the most ordinary words in English.
 *
 *   NOT "this phrase denotes a government organization". `semantic_hint` and
 *        `category` are coarse lookup features the source dataset assigned;
 *        they are not types. See the organization section below, which is the
 *        one place this pack invites that mistake.
 *
 *   NOT "therefore this phrase is not a person". This is the failure the
 *        Census experiment measured, the GNIS benchmark measured again, and
 *        every terminology pack since has had to restate. 32 of this pack's
 *        409 keys intersect Census name evidence exactly.
 *
 * ══════════════════ WHY MEMBERSHIP CANNOT BE A VERDICT ══════════════════
 *
 * This is the most collision-prone terminology pack in the repository by
 * proportion: the source dataset flags 66 of 412 rows HIGH and 263 MEDIUM --
 * 80% of the pack carries a collision warning from its own authors. That is
 * not a defect in the dataset. Public-administration vocabulary is drawn from
 * exactly the register that ordinary documents are written in:
 *
 *   ordinary English      Band · Contractor · Grade · Notice · Record · Risk ·
 *                         Role · Rule · Search · Series · State · Title
 *   shared with other     Applicant · Contract · Claim · Disposition ·
 *   attested domains      Budget · Asset · Depreciation · Cost Sharing ·
 *                         Student Financial Aid
 *   overloaded acronyms   SAM · ERA · COR · GRS
 *
 * Every one of those is legitimately attested government terminology AND
 * legitimately something else. Where another pack also attests a term, BOTH
 * attestations are correct and both survive -- neither family wins, because
 * establishing precedence among evidence families is not this layer's job and
 * cannot be done without the surrounding document.
 *
 *   hit => NOT A PERSON     is false, and 32 exact Census intersections say so.
 *   hit => ORGANIZATION     is false; see below.
 *   hit => THIS IS FEDERAL  is false. `contract` and `record` in a private
 *                           lease are still `contract` and `record`.
 *   MISS => NOT GOVERNMENT  is false, and this pack is unusually easy to get
 *                           wrong on. It is deliberately federal-heavy: state
 *                           and local administrative vocabulary, the wider
 *                           agency universe, and most of the government
 *                           ontology are DOCUMENTED GAPS. A miss means "not in
 *                           this dataset" and never "not governmental".
 *
 * ══════════ ORGANIZATION NAMES: ATTESTED, STILL NOT TYPED ══════════
 *
 * This pack contains two kinds of row and the distinction is load-bearing:
 *
 *   general vocabulary    `Notice of Proposed Rulemaking`  -- terminology
 *   named bodies          `National Archives and Records Administration`
 *                         -- an identifiable organization that this dataset
 *                            also happens to attest
 *
 * The 29 named-body rows are marked `OFFICIAL_ORGANIZATION` in `subDomain`,
 * and the 37 rows hinted `ORGANIZATION` in `semanticHints` are a DIFFERENT,
 * overlapping population -- the hint describes the vocabulary, the sub-domain
 * describes what kind of row it is. Both are carried verbatim and neither is
 * mapped onto `SemanticTypeId`. A named-body row licenses exactly one extra
 * sentence over any other row -- "this dataset lists this as an official
 * government organization" -- and specifically does NOT license
 * `semanticTypeFor` returning Organization, because that is a document-level
 * determination and this module has no document. Collapsing "attested
 * government terminology" into "this candidate IS a government organization"
 * is the representational collapse this family is most exposed to, so it is
 * named here rather than left to be rediscovered.
 *
 * ══════════════════ ACRONYMS ARE SOURCE-LOCAL ══════════════════
 *
 * 129 rows carry an explicit acronym/expansion pair, and every one exists only
 * because the authoritative source published the relationship -- no acronym
 * was inferred, and `derivedVariant` is false on all 412 rows because nothing
 * in this pack was mechanically generated.
 *
 * THE EXPANSION IS PROVENANCE, NOT RESOLUTION. `SAM` is attested by
 * Acquisition.gov as the System for Award Management. That is a fact about
 * what one federal authority published; it is emphatically not a claim that
 * the string `SAM` denotes that system here, and Samuel exists. The same
 * applies to `ERA` (NARA's Electronic Records Archives), `COR`, `GRS`, `FAIN`
 * and `NPRM`. The expansion travels with the attestation so an audit trail can
 * say which source wrote it; nothing may read it as disambiguation.
 *
 * ══════════════════ JURISDICTION ══════════════════
 *
 * Every v1 row is `US_FEDERAL`, asserted single-valued at generation and
 * carried as `evidence.jurisdiction` so a caller reading one record can answer
 * the question without knowing about a module constant. It is a pack-level
 * fact rather than a row column because storing one value 412 times would have
 * meant widening the shared row contract -- and regenerating every other
 * pack's asset -- to carry something that does not vary. If a v2 adds state or
 * local rows the generator stops and that conversion becomes a deliberate
 * shared-contract change.
 *
 * ══════════════════ LICENSING, CARRIED FORWARD ══════════════════
 *
 * US federal public material only: Acquisition.gov/FAR Part 2, NARA (CC0),
 * Grants.gov, FOIA.gov/DOJ OIP (public domain unless indicated), the Federal
 * Register, OPM, and a small USA.gov official-organization slice. Term labels
 * and provenance only -- NO SOURCE DEFINITIONS ARE REPRODUCED, and the
 * per-family licence and retrieval date ship in
 * `GOVERNMENT_SOURCE_LICENSING` so downstream redistribution can carry the
 * attribution forward.
 *
 * Pure and DOM-free. No network: the pack is bundled and every lookup is local.
 */

import {
  buildDomainReferenceIndex,
  explainDomainReferenceEvidence,
  lookupDomainReference,
  type DomainReferenceAttestation,
  type DomainReferenceEvidence,
} from "./DomainReferenceEvidence.js";
import {
  GOVERNMENT_JURISDICTION,
  GOVERNMENT_PACK,
  GOVERNMENT_ROW_COUNT,
  GOVERNMENT_SOURCE,
  GOVERNMENT_SOURCE_AUTHORITIES,
  GOVERNMENT_SOURCE_LICENSING,
  GOVERNMENT_TERM_COUNT,
} from "./government-public-admin-terminology.data.js";

/**
 * This pack's evidence.
 *
 * The substrate record plus ONE pack-specific field. `jurisdiction` is not on
 * the shared shape because no other pack has one; it is on this alias because
 * a caller holding a government attestation should not have to import a
 * module constant to learn that the claim is a federal one.
 */
export type GovernmentPublicAdminEvidence = DomainReferenceEvidence<"government-public-admin"> & {
  /** The jurisdiction every row in this pack was drawn from. `US_FEDERAL` in
   *  v1, asserted single-valued at generation. */
  jurisdiction: string;
};

/** The source dataset's controlled hint vocabulary, carried verbatim.
 *
 *  THESE ARE HINTS, NOT TYPES. Not `SemanticTypeId` values, and they must
 *  never be mapped onto them here -- not ORGANIZATION -> Organization, not
 *  ROLE -> Person, not IDENTIFIER_TYPE -> Identifier. That interpretation
 *  belongs to a later combination layer that can see the other evidence
 *  channels and the document; making it here would hard-wire a verdict out of
 *  a lexical hint. */
export type GovernmentPublicAdminHint =
  | "ADMINISTRATIVE_PROCEEDING"
  | "DATA_SYSTEM"
  | "DOCUMENT"
  | "DOCUMENT_SYSTEM"
  | "EMPLOYMENT_ADMIN"
  | "ENFORCEMENT_COMPLIANCE"
  | "FISCAL_ADMIN"
  | "GOVERNMENT_STRUCTURE"
  | "IDENTIFIER_TYPE"
  | "LEGAL_ADMIN"
  | "ORGANIZATION"
  | "OTHER_DOMAIN_TERM"
  | "PROCESS_EVENT"
  | "PROCUREMENT"
  | "PROGRAM_ADMIN"
  | "PROPERTY_ADMIN"
  | "PUBLIC_SERVICE"
  | "RECORDS_INFORMATION"
  | "ROLE"
  | "RULEMAKING";

/**
 * The pack's sub-domain axis, carried on every attestation as `subDomain`.
 *
 * `OFFICIAL_ORGANIZATION` is the one that matters: it marks the 29 rows that
 * name an identifiable federal body rather than describing vocabulary. It is
 * a fact about the ROW, not a type assigned to a candidate -- see the module
 * header. */
export type GovernmentPublicAdminCategory =
  | "ADMINISTRATIVE_PROCEEDING"
  | "GOVERNMENT_EMPLOYMENT"
  | "GOVERNMENT_STRUCTURE"
  | "GRANTS"
  | "OFFICIAL_ORGANIZATION"
  | "PROCUREMENT"
  | "PUBLIC_ADMIN"
  | "PUBLIC_MEETINGS"
  | "PUBLIC_RECORDS"
  | "RECORDS_MANAGEMENT"
  | "RULEMAKING";

/**
 * THE LOOKUP NORMALIZATION CONTRACT.
 *
 * Six steps, reproducing the source methodology's §Deterministic
 * normalization exactly. `scripts/generate_domain_terminology_pack.py
 * government_public_admin` implements the same six steps in Python and
 * ASSERTS that they re-derive `normalized_term` on all 412 rows, so this
 * function and the shipped keys cannot drift without the generator failing
 * loudly. Verified 412/412.
 *
 *   1. NFKC
 *   2. curly quotes -> ASCII
 *   3. Unicode dashes/minus -> ASCII hyphen
 *   4. casefold
 *   5. collapse whitespace, trim
 *   6. remove spaces immediately around `/` and `-`
 *
 * PUNCTUATION IS OTHERWISE PRESERVED -- digits, parentheses, apostrophes,
 * slashes and word order all survive, because `Section 508`, `OMB Circular
 * A-123`, `FOIA Exemption 6` and `pre-award` depend on them.
 *
 * STEP 6 IS INERT ON THE v1 DATA. No shipped row contains a space adjacent to
 * `/` or `-`, so the finance policy would reproduce all 412 keys too. It is
 * implemented because the documented contract is what gets implemented, not
 * the accident of what one snapshot exercises -- a v2 row written `pre - award`
 * must key as `pre-award`. The verification suite pins it with a synthetic
 * input so it cannot rot undetected.
 *
 * THE POLICY FAVOURS PRECISION OVER RECALL, by design. `Notice of Proposed
 * Rulemaking` matches exactly that phrase; it does not match `Proposed`, and a
 * reordered or approximate phrase does not match at all.
 *
 * THIS IS FOR MATCHING ONLY. The candidate's displayValue is never rewritten,
 * the document is never rewritten, and export/audit always carry the original.
 *
 * DELIBERATELY NOT DONE: substring or prefix matching, fuzzy matching, edit
 * distance, stemming, lemmatization, singular/plural folding, token
 * reordering, acronym expansion at lookup time, synonym expansion, or any
 * model inference.
 */
export function normalizeForGovernmentPublicAdminLookup(phrase: string): string {
  return phrase
    .normalize("NFKC")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐‑‒–—―−]/g, "-")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*([/-])\s*/g, "$1");
}

/** Built once, lazily, on first lookup -- a document that never reaches this
 *  evidence family never pays for it. Same policy as every other pack. */
let index: Map<string, DomainReferenceAttestation[]> | null = null;

function ensureIndex(): Map<string, DomainReferenceAttestation[]> {
  if (!index) index = buildDomainReferenceIndex(GOVERNMENT_PACK);
  return index;
}

/**
 * The single lookup. Returns null on a miss.
 *
 * NULL MEANS "NOT ATTESTED IN THIS DATASET" AND NOTHING ELSE. It is not "not
 * government language" -- this is an explicitly partial, deliberately
 * federal-heavy v1 vocabulary -- and it is certainly not "therefore a person".
 * Callers must treat a miss as the absence of one evidence family, never as
 * counter-evidence.
 */
export function governmentPublicAdminEvidenceFor(phrase: string): GovernmentPublicAdminEvidence | null {
  const evidence = lookupDomainReference(
    "government-public-admin",
    ensureIndex(),
    phrase,
    normalizeForGovernmentPublicAdminLookup(phrase)
  );
  return evidence === null ? null : { ...evidence, jurisdiction: GOVERNMENT_JURISDICTION };
}

/** Convenience predicate for diagnostics and benchmark harnesses. Production
 *  callers should hold the evidence record instead -- a bare boolean is
 *  precisely the shape that invites treating membership as a verdict. */
export function isAttestedGovernmentPublicAdminTerminology(phrase: string): boolean {
  return governmentPublicAdminEvidenceFor(phrase) !== null;
}

/**
 * Reviewer-facing evidence lines. States what was observed, never a verdict.
 *
 * The shared substrate produces the attestation, corroboration, derivation,
 * acronym and collision lines. This adds ONE government-specific line, and
 * only for the rows that earn it: where the dataset lists a named federal
 * body, a reviewer should be told that the row is an organization LISTING
 * rather than general vocabulary, because those two are read very
 * differently. It is still a statement about the dataset -- "this dataset
 * lists this as an official government organization" -- and not a claim that
 * the candidate is one in this document.
 */
export function explainGovernmentPublicAdminEvidence(evidence: GovernmentPublicAdminEvidence | null): string[] {
  const lines = explainDomainReferenceEvidence(evidence, "government/public-administration terminology");
  if (evidence && evidence.subDomains.includes("OFFICIAL_ORGANIZATION")) {
    lines.push(
      "This source lists it as an official government organization name -- which is what the dataset records, not a determination about what this phrase refers to here."
    );
  }
  return lines;
}

/**
 * The authority behind a source-family key, for audit and diagnostic paths.
 * Returns null for an unknown key rather than inventing a label.
 */
export function governmentSourceAuthorityFor(sourceFamily: string): string | null {
  for (const [family, authority] of GOVERNMENT_SOURCE_AUTHORITIES) {
    if (family === sourceFamily) return authority;
  }
  return null;
}

/** Provenance for the audit record. */
export const GOVERNMENT_EVIDENCE_SOURCE = GOVERNMENT_SOURCE;
export const GOVERNMENT_EVIDENCE_ROW_COUNT = GOVERNMENT_ROW_COUNT;
export const GOVERNMENT_EVIDENCE_TERM_COUNT = GOVERNMENT_TERM_COUNT;
export const GOVERNMENT_EVIDENCE_JURISDICTION = GOVERNMENT_JURISDICTION;
export { GOVERNMENT_SOURCE_AUTHORITIES, GOVERNMENT_SOURCE_LICENSING };
