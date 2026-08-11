/**
 * LegalTerminologyEvidence.ts -- legal terminology attestation as a
 * deterministic DOMAIN REFERENCE evidence family (AG, 2026-08-10).
 *
 * Built on the shared substrate in `DomainReferenceEvidence.ts`; read that
 * file's header for the contract every domain-reference pack shares. What is
 * specific to THIS pack is below.
 *
 * ══════════════════════ THE ONE CLAIM ══════════════════════
 *
 *     "This phrase is attested legal terminology."
 *
 * It does NOT mean the phrase is definitely not a person, place,
 * organization, identifier, or any other semantic type. A candidate may
 * legitimately carry Census name evidence, GNIS place evidence AND legal
 * evidence at once, and that combination is INFORMATION, not a contradiction
 * to be resolved here.
 *
 * ══════════════════ WHY MEMBERSHIP CANNOT BE A VERDICT ══════════════════
 *
 * This pack is the most collision-prone of the three domain references, and
 * deliberately so -- 81 of 449 rows are flagged HIGH by the source dataset:
 *
 *   ordinary English      answer · brief · claim · file · record · motion ·
 *                         discovery · settlement · appeal
 *   name-like forms       Doe · Judge · Levy   (all Census-attested)
 *   generic role/org      court · counsel · neutral · trustee
 *   overloaded acronyms   NDA · AO · NOA
 *
 * Every one of those is legitimately attested legal terminology AND
 * legitimately something else. The methodology retains them on purpose: "a
 * legal attestation should be one evidence channel that can compete or
 * combine with CensusNameEvidence, GnisPlaceEvidence, HigherEdEvidence, and
 * future domain packs." Deleting them, or letting HIGH risk suppress the
 * evidence, would destroy the exact signal that makes a conflict visible.
 *
 *   hit => NOT A PERSON     is false. `Doe`, `Judge` and `Levy` are surnames.
 *   ROLE hint => Person     is false. 64 rows are hinted ROLE (`trustee`,
 *                           `counsel`, `debtor`) and a ROLE hint describes
 *                           vocabulary, not an entity in this document.
 *   MISS => NOT LEGAL       is false. This is an explicitly partial v1:
 *                           contracts drafting, M&A, family law, real estate,
 *                           labor relations, immigration, environmental,
 *                           antitrust and most Latin maxims are documented
 *                           gaps.
 *
 * ══════════════ MULTI-HINT ROWS, AND WHY HINTS ARE A LIST ══════════════
 *
 * This is the pack that forced `semanticHints` to be plural on the shared
 * attestation. 25 distinct hint COMBINATIONS ship here -- `Complaint` is
 * DOCUMENT and COURT_PROCEDURE; `Bankruptcy petition` is DOCUMENT and
 * LEGAL_CONCEPT; `Trustee` is ROLE and LEGAL_CONCEPT. The source assigns both
 * because the attested term genuinely spans coarse categories, and collapsing
 * to the first would discard a distinction the source took care to record.
 *
 * ══════════════ MERGED PROVENANCE IS UN-MERGED AT BUILD ══════════════
 *
 * The source CSV merges co-attesting authorities into a single row with
 * `|`-separated source columns (4 rows do this: `Business bankruptcy`,
 * `Default judgment`, `Exemptions, exempt property`, `Bankruptcy estate` --
 * each attested by the federal judiciary AND a second court). The generator
 * expands those back into one attestation per source, which is why 445 CSV
 * rows become 449 runtime attestations over the same 445 keys. That is
 * un-merging what the pack merged, not fabrication: the generator asserts the
 * four piped columns agree on segment count before splitting. The result is
 * that both domain packs present the identical runtime shape and
 * corroboration across independent source families stays visible.
 *
 * ══════════════════ LICENSING, CARRIED FORWARD ══════════════════
 *
 * Federal judiciary and federal executive-agency material (17 U.S.C. § 105)
 * plus California superior-court self-help glossaries. Cornell LII/Wex was
 * researched and REJECTED as a source -- its compilation licence carries
 * noncommercial and share-alike conditions. No commercial legal dictionary
 * (Westlaw, Lexis, Bloomberg Law, Black's) was scraped. STATE-JUDICIARY
 * DEFINITIONS ARE NOT REPRODUCED: only the factual term labels are retained,
 * because state-site reuse policies differ by jurisdiction. Downstream
 * redistribution should keep the attribution/provenance this asset carries.
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
  LEGAL_PACK,
  LEGAL_ROW_COUNT,
  LEGAL_SOURCE,
  LEGAL_TERM_COUNT,
} from "./legal-terminology.data.js";

/** This pack's evidence. A distinct alias rather than a bare use of the
 *  generic, so call sites read as the family they mean. */
export type LegalTerminologyEvidence = DomainReferenceEvidence<"legal-terminology">;

/** The source dataset's controlled hint vocabulary, carried verbatim.
 *
 *  THESE ARE HINTS, NOT TYPES, and a row may carry more than one. They must
 *  never be mapped onto `SemanticTypeId` here -- not ROLE -> Person, not
 *  ORGANIZATION -> Organization, not DOCUMENT -> non-Person. That
 *  interpretation belongs to a later evidence-combination layer that can see
 *  the other channels; making it here would hard-wire a verdict out of a
 *  lexical hint. */
export type LegalHint =
  | "AMBIGUOUS"
  | "COURT_PROCEDURE"
  | "DOCUMENT"
  | "IDENTIFIER_TYPE"
  | "LEGAL_CONCEPT"
  | "ORGANIZATION"
  | "OTHER_DOMAIN_TERM"
  | "PROCESS_EVENT"
  | "ROLE";

/**
 * THE LOOKUP NORMALIZATION CONTRACT.
 *
 * Six steps, reproducing the source methodology's §Deterministic
 * normalization exactly. `scripts/generate_domain_terminology_pack.py legal`
 * implements the same six steps in Python and ASSERTS that they re-derive
 * `normalized_term` on all 445 rows. Verified 445/445.
 *
 *   1. NFKC
 *   2. curly quotes -> ASCII
 *   3. Unicode dashes/minus -> ASCII hyphen
 *   4. casefold
 *   5. collapse whitespace, trim
 *   6. remove spaces immediately around `/` and `-`
 *
 * PUNCTUATION IS OTHERWISE PRESERVED -- digits, parentheses, apostrophes and
 * word order all survive, because `3(c)(1)`, `Rule 26(f)`, `pro se` and
 * `motion in limine` depend on them. Step 6 is this pack's one addition over
 * the finance policy, and it exists because the sources write the same term
 * both ways (`attorney / lawyer`, `pre - trial`); folding the spacing is a
 * mechanical equivalence the methodology authorises explicitly.
 *
 * THE POLICY FAVOURS PRECISION OVER RECALL, by design: `motion for summary
 * judgment` deliberately does NOT match a reordered or approximate phrase.
 *
 * THIS IS FOR MATCHING ONLY. The candidate's displayValue is never rewritten,
 * the document is never rewritten, and export/audit always carry the original.
 *
 * DELIBERATELY NOT DONE: fuzzy matching, edit distance, stemming,
 * lemmatization, token reordering, synonym invention, or any model inference.
 */
export function normalizeForLegalLookup(phrase: string): string {
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
  if (!index) index = buildDomainReferenceIndex(LEGAL_PACK);
  return index;
}

/**
 * The single lookup. Returns null on a miss.
 *
 * NULL MEANS "NOT ATTESTED IN THIS DATASET" AND NOTHING ELSE. It is not "not
 * legal language" -- this is an explicitly partial v1 vocabulary with
 * documented gaps -- and it is certainly not "therefore a person". Callers
 * must treat a miss as the absence of one evidence family, never as
 * counter-evidence.
 */
export function legalTerminologyEvidenceFor(phrase: string): LegalTerminologyEvidence | null {
  return lookupDomainReference("legal-terminology", ensureIndex(), phrase, normalizeForLegalLookup(phrase));
}

/** Convenience predicate for diagnostics and benchmark harnesses. Production
 *  callers should hold the evidence record instead -- a bare boolean is
 *  precisely the shape that invites treating membership as a verdict. */
export function isAttestedLegalTerminology(phrase: string): boolean {
  return legalTerminologyEvidenceFor(phrase) !== null;
}

/** Reviewer-facing evidence lines. States what was observed, never a verdict. */
export function explainLegalTerminologyEvidence(evidence: LegalTerminologyEvidence | null): string[] {
  return explainDomainReferenceEvidence(evidence, "legal terminology");
}

/** Provenance for the audit record. */
export const LEGAL_EVIDENCE_SOURCE = LEGAL_SOURCE;
export const LEGAL_EVIDENCE_ROW_COUNT = LEGAL_ROW_COUNT;
export const LEGAL_EVIDENCE_TERM_COUNT = LEGAL_TERM_COUNT;
