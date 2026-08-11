/**
 * FinanceAccountingTaxEvidence.ts -- finance, accounting and tax terminology
 * attestation as a deterministic DOMAIN REFERENCE evidence family
 * (AG, 2026-08-10).
 *
 * Built on the shared substrate in `DomainReferenceEvidence.ts`; read that
 * file's header for the contract every domain-reference pack shares. What is
 * specific to THIS pack is below.
 *
 * ══════════════════════ THE ONE CLAIM ══════════════════════
 *
 *     "This phrase is attested finance/accounting/tax terminology."
 *
 * That is the whole claim. In particular it does NOT mean:
 *
 *   - that the phrase is not a person, place, organization or identifier;
 *   - that the document contains financial information ABOUT anyone.
 *
 * The second one deserves saying out loud because this pack, unlike the
 * others, names a sensitive subject. `adjusted gross income`, `accounts
 * receivable`, `Schedule C`, `capital gain` and `general ledger` are
 * VOCABULARY. Their presence is evidence that a document uses financial
 * language, and nothing whatever about whose finances, or whether any
 * finances are described at all. DocScrub must never report, imply, or route
 * on "this document contains someone's financial information" because a
 * terminology lookup matched. Nothing here infers a fact about a person.
 *
 * ══════════════════ WHY MEMBERSHIP CANNOT BE A VERDICT ══════════════════
 *
 * 138 of the 710 rows are flagged HIGH collision risk by the source dataset
 * itself, and the flagged terms are exactly the ordinary words a document is
 * full of: `basis`, `interest`, `security`, `margin`, `position`, `appeal`,
 * `credit`, `filing`, `balance`, `bond`. Measured against the shipped assets:
 * 61 of 651 finance terms are Census-attested in every token (27 of them
 * single-token -- `stock`, `gain`, `loss`, `salary`, `tips`, `wages`), and 23
 * are also attested Legal terminology. `ADR` is the sharpest case in the
 * repository: attested by the SEC as an American Depositary Receipt and, in
 * the Legal pack, as Alternative Dispute Resolution. Same string, two
 * authorities, unrelated meanings, both correct.
 *
 *   hit => NOT A PERSON     is false.
 *   hit => ORGANIZATION     is false. Only 35 source-attested rows are hinted
 *                           ORGANIZATION at all; `general ledger` is a
 *                           concept and `Schedule C` is a document.
 *   MISS => NOT FINANCIAL   is false. The pack is a documented partial v1:
 *                           state/local tax, insurance, corporate treasury,
 *                           private-sector close/consolidation and the full
 *                           IRS forms universe are all explicitly out of
 *                           scope, and the FASB GAAP taxonomy was reviewed
 *                           and NOT ingested for copyright reasons.
 *
 * ══════════════════ SUB-DOMAIN IS PRESERVED, DELIBERATELY ══════════════════
 *
 * Every attestation carries `subDomain` -- FINANCE (467 rows), TAX (151) or
 * ACCOUNTING (92) -- alongside its source family. This is what lets a future
 * evidence trace say "IRS tax terminology evidence" or "Treasury/USSGL
 * accounting terminology evidence" rather than flattening everything into
 * "business terminology". 16 normalized terms are attested in more than one
 * sub-domain (`basis` as FINANCE by the CFTC and as TAX by the IRS; `capital
 * gain`, `depreciation`, `interest`, `net income`...), and BOTH readings
 * survive lookup. Picking one would be resolving a question this layer is not
 * entitled to resolve.
 *
 * ══════════════════ LICENSING, CARRIED FORWARD ══════════════════
 *
 * Sources are federal public glossaries only: IRS, SEC/Investor.gov, CFPB,
 * CFTC, Federal Reserve, FDIC, Treasury USSGL. FASB's GAAP taxonomy, GASB
 * pronouncements and AICPA/CIMA standards were researched and deliberately
 * NOT ingested -- they carry copyright and authorized-use conditions that are
 * a poor fit for a redistributable reference pack. No commercial dictionary
 * was scraped and no vocabulary was expanded from model knowledge. The asset
 * stores short term strings and provenance URLs; it reproduces no source
 * definitions.
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
  FINANCE_TAX_PACK,
  FINANCE_TAX_ROW_COUNT,
  FINANCE_TAX_SOURCE,
  FINANCE_TAX_TERM_COUNT,
} from "./finance-accounting-tax-terminology.data.js";

/** This pack's evidence. A distinct alias rather than a bare use of the
 *  generic, so call sites read as the family they mean. */
export type FinanceAccountingTaxEvidence = DomainReferenceEvidence<"finance-accounting-tax">;

/** The source dataset's coarse hint vocabulary, carried verbatim.
 *
 *  THESE ARE HINTS, NOT TYPES. They are not `SemanticTypeId` values and must
 *  never be mapped onto them here. The methodology calls them "lookup hints,
 *  not ontology claims", which is why `account owner` is hinted ROLE and
 *  `account statement` is hinted DOCUMENT without either being a claim about
 *  what the phrase denotes in a particular document. */
export type FinanceAccountingTaxHint =
  | "ACCOUNTING_CONCEPT"
  | "ACCOUNT_TYPE"
  | "DOCUMENT"
  | "FINANCIAL_CONCEPT"
  | "FINANCIAL_INSTRUMENT"
  | "ORGANIZATION"
  | "OTHER_DOMAIN_TERM"
  | "PROCESS_EVENT"
  | "REGULATORY_TERM"
  | "ROLE"
  | "TAX_CONCEPT";

/** The three sub-domains this pack distinguishes. */
export type FinanceAccountingTaxDomain = "FINANCE" | "ACCOUNTING" | "TAX";

/**
 * THE LOOKUP NORMALIZATION CONTRACT.
 *
 * Five steps, reproducing the source methodology's §Normalization exactly.
 * `scripts/generate_domain_terminology_pack.py finance` implements the same
 * five steps in Python and ASSERTS that they re-derive `normalized_term` on
 * all 710 rows, so this function and the shipped keys cannot drift without
 * the generator failing loudly. Verified 710/710.
 *
 *   1. NFKC
 *   2. curly quotes -> ASCII
 *   3. Unicode dashes/minus -> ASCII hyphen
 *   4. lowercase (casefold)
 *   5. collapse whitespace, trim
 *
 * PUNCTUATION IS PRESERVED, and that is the load-bearing difference from
 * `normalizeForHigherEdLookup` (which sends every non-alphanumeric run to a
 * space) and from `normalizeForCensusLookup` (which strips punctuation to
 * nothing). It is forced by the data and by the methodology, which states the
 * consequence plainly: `Form 10-K` must NOT become equal to `Form 10K`, and
 * `12b-1 fee`, `3(c)(1)`, `401(k)` and `S corporation` all depend on their
 * punctuation to mean what they mean. Where a punctuation alternate is
 * mechanically safe the dataset ships it as an explicit derived row instead
 * of deriving it here.
 *
 * THIS IS FOR MATCHING ONLY. The candidate's displayValue is never rewritten,
 * the document is never rewritten, and export/audit always carry the original.
 *
 * DELIBERATELY NOT DONE: fuzzy matching, edit distance, stemming,
 * lemmatization, singular/plural folding, acronym expansion at lookup time,
 * synonym expansion, or any model inference.
 */
export function normalizeForFinanceAccountingTaxLookup(phrase: string): string {
  return phrase
    .normalize("NFKC")
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐‑‒–—―−]/g, "-")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Built once, lazily, on first lookup -- a document that never reaches this
 *  evidence family never pays for it. Same policy as every other pack. */
let index: Map<string, DomainReferenceAttestation[]> | null = null;

function ensureIndex(): Map<string, DomainReferenceAttestation[]> {
  if (!index) index = buildDomainReferenceIndex(FINANCE_TAX_PACK);
  return index;
}

/**
 * The single lookup. Returns null on a miss.
 *
 * NULL MEANS "NOT ATTESTED IN THIS DATASET" AND NOTHING ELSE. It is not "not
 * financial language" -- this is an explicitly partial v1 vocabulary -- and
 * it is certainly not "therefore a person". Callers must treat a miss as the
 * absence of one evidence family, never as counter-evidence.
 */
export function financeAccountingTaxEvidenceFor(phrase: string): FinanceAccountingTaxEvidence | null {
  return lookupDomainReference(
    "finance-accounting-tax",
    ensureIndex(),
    phrase,
    normalizeForFinanceAccountingTaxLookup(phrase)
  );
}

/** Convenience predicate for diagnostics and benchmark harnesses. Production
 *  callers should hold the evidence record instead -- a bare boolean is
 *  precisely the shape that invites treating membership as a verdict. */
export function isAttestedFinanceAccountingTaxTerminology(phrase: string): boolean {
  return financeAccountingTaxEvidenceFor(phrase) !== null;
}

/** Reviewer-facing evidence lines. States what was observed, never a verdict,
 *  and never a claim about anyone's finances. */
export function explainFinanceAccountingTaxEvidence(evidence: FinanceAccountingTaxEvidence | null): string[] {
  return explainDomainReferenceEvidence(evidence, "finance/accounting/tax terminology");
}

/** Provenance for the audit record. */
export const FINANCE_TAX_EVIDENCE_SOURCE = FINANCE_TAX_SOURCE;
export const FINANCE_TAX_EVIDENCE_ROW_COUNT = FINANCE_TAX_ROW_COUNT;
export const FINANCE_TAX_EVIDENCE_TERM_COUNT = FINANCE_TAX_TERM_COUNT;
