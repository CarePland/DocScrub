/**
 * EmploymentHrEvidence.ts -- employment / human-resources terminology
 * attestation as a deterministic DOMAIN REFERENCE evidence family
 * (AG, 2026-08-10).
 *
 * Built on the shared substrate in `DomainReferenceEvidence.ts`; read that
 * file's header for the contract every domain-reference pack shares. What is
 * specific to THIS pack is below.
 *
 * ══════════════════════ THE ONE CLAIM ══════════════════════
 *
 *     "This phrase is attested employment/HR terminology according to
 *      source X."
 *
 * It does NOT mean the phrase is not a person, and it does not mean the
 * phrase is not legal, government, higher-education, finance or medical
 * terminology either. A candidate may legitimately carry Census name
 * evidence AND legal evidence AND employment/HR evidence at once, and that
 * combination is INFORMATION. Nothing here resolves it.
 *
 * ══════════ WHY MEMBERSHIP CANNOT BE A VERDICT, IN THIS PACK ══════════
 *
 * 50 of 267 rows are flagged HIGH collision risk by the source dataset, and
 * the shape of that population is by now familiar -- it is the fifth
 * independent dataset to arrive at DocScrub with the same problem:
 *
 *   ordinary English      detail · grade · series · transfer · appeal ·
 *                         removal · reduction · promotion · demotion
 *   generic role nouns    participant · beneficiary · arbitrator ·
 *                         appellant · steward
 *   overloaded acronyms   ADA · EEO · FMLA · PIP · PPP · SPD · MSP · PEP
 *
 * `Grade` is simultaneously OPM classification terminology and a
 * Census-attested surname. `PIP`, `PPP` and `MSP` are three-letter strings,
 * which is the exact shape personal initials and OCR fragments take. Every
 * one of those rows is retained on purpose:
 *
 *   hit => NOT A PERSON     is false, and is the specific failure this pack
 *                           would cause most easily, because HR documents are
 *                           full of real people.
 *   ROLE-ish hint => a role is false. `EMPLOYEE_RELATIONS_CONCEPT` and
 *                           `LABOR_RELATIONS_CONCEPT` describe VOCABULARY,
 *                           not an entity in this document. `beneficiary` is
 *                           attested terminology; the beneficiary named two
 *                           lines below it is a person.
 *   MISS => NOT HR          is false. This is an explicitly partial v1:
 *                           state-level employment law, private-sector HRIS
 *                           vocabulary, compensation-survey terminology and
 *                           the whole O*NET/SOC occupational-title universe
 *                           are documented, deliberate gaps.
 *
 * ══════════ THE O*NET DECISION, CARRIED FORWARD ══════════
 *
 * O*NET 30.3 is usable under CC BY 4.0 and was researched, then deliberately
 * NOT bulk-ingested in v1. Importing ~1,000 occupational titles would have
 * turned an HR-ADMINISTRATION vocabulary into a role/title dictionary, and
 * job titles collide with personal names far more aggressively than
 * administrative terminology does. That is recorded here rather than only in
 * the methodology because the tempting future change -- "the pack is small,
 * add the titles" -- is one whose cost lands on person detection, not on
 * this module.
 *
 * ══════════ MULTIPLE ATTESTATION IS THE INTERESTING PART ══════════
 *
 * 15 of the 252 keys are attested by two independent authorities, and which
 * two matters: `grievance` by both the NLRB (private-sector labor relations)
 * and the FLRA (federal-sector); `adverse action` by both the EEOC (as a
 * discrimination concept) and the MSPB (as a merit-system employee-relations
 * concept); `FMLA` by both DOL/WHD and OPM. Those are genuinely different
 * administrative regimes agreeing on a term, which is exactly the
 * corroboration a combination layer will want, so every row survives lookup.
 *
 * ══════════ NORMALIZATION: SAME SIX STEPS AS FINANCE, SEPARATELY OWNED ══════════
 *
 * This pack's methodology documents the identical six steps the Finance pack
 * documents, arrived at independently. They are implemented separately here
 * anyway -- see `normalizeForEmploymentHrLookup`.
 *
 * ══════════ LICENSING, CARRIED FORWARD ══════════
 *
 * US federal government sources only (OPM, DOL/WHD, EEOC, NLRB, FLRA, MSPB,
 * OSHA, EBSA). No commercial HR dictionary was scraped and no vendor HRIS
 * vocabulary was ingested. The asset stores short term labels and provenance;
 * federal definitions are not reproduced. Per-source tier, licence status and
 * retrieval date ship alongside the rows -- see `employmentHrSourceLicensing`.
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
  EMPLOYMENT_HR_PACK,
  EMPLOYMENT_HR_ROW_COUNT,
  EMPLOYMENT_HR_SOURCE,
  EMPLOYMENT_HR_SOURCE_LICENSING,
  EMPLOYMENT_HR_TERM_COUNT,
} from "./employment-hr-terminology.data.js";

/** This pack's evidence. A distinct alias rather than a bare use of the
 *  generic, so call sites read as the family they mean. */
export type EmploymentHrEvidence = DomainReferenceEvidence<"employment-hr-terminology">;

/** The source dataset's controlled hint vocabulary, carried verbatim.
 *
 *  THESE ARE HINTS, NOT TYPES. They must never be mapped onto
 *  `SemanticTypeId` here -- not `EMPLOYEE_RELATIONS_CONCEPT` -> non-Person,
 *  not `PROCESS_EVENT` -> Event, not anything -> Organization. That
 *  interpretation belongs to a later evidence-combination layer that can see
 *  the other channels and the surrounding document; making it here would
 *  hard-wire a verdict out of a lexical hint. */
export type EmploymentHrHint =
  | "BENEFIT_CONCEPT"
  | "BENEFIT_OR_COMPENSATION"
  | "EEO_CONCEPT"
  | "EMPLOYEE_RELATIONS_CONCEPT"
  | "HR_ADMIN_CONCEPT"
  | "LABOR_RELATIONS_CONCEPT"
  | "LEAVE_CONCEPT"
  | "PERFORMANCE_CONCEPT"
  | "PROCESS_EVENT"
  | "SAFETY_CONCEPT";

/** The pack's sub-domain axis, carried verbatim. Kept so an evidence trace
 *  can name the administrative regime that attested a term rather than the
 *  uselessly broad "HR". Not a type, and not a routing key. */
export type EmploymentHrCategory =
  | "classification"
  | "employee_benefits"
  | "employee_relations"
  | "equal_employment_opportunity"
  | "federal_labor_relations"
  | "labor_relations"
  | "leave"
  | "leave_compensation"
  | "performance_management"
  | "personnel_action"
  | "workplace_safety";

/**
 * THE LOOKUP NORMALIZATION CONTRACT.
 *
 * Six steps, reproducing the source methodology's §Normalization exactly.
 * `scripts/generate_domain_terminology_pack.py employment_hr` implements the
 * same six steps in Python and ASSERTS that they re-derive `normalized_term`
 * on all 267 rows. Verified 267/267.
 *
 *   1. NFKC
 *   2. curly quotes/apostrophes -> ASCII
 *   3. Unicode dashes/minus -> ASCII hyphen
 *   4. casefold
 *   5. collapse whitespace, trim
 *   6. exact normalized lookup -- PUNCTUATION OTHERWISE PRESERVED
 *
 * Step 6 is why `401(k) plan`, `SF-50` and `12-month period` survive as
 * written: digits, parentheses and hyphens are load-bearing in this
 * vocabulary, exactly as they are in the Finance pack's form numbers.
 *
 * THIS IS BYTE-FOR-BYTE THE FINANCE POLICY, AND IS STILL WRITTEN OUT HERE.
 * Not an oversight and not duplication to be tidied away: two source
 * methodologies independently specifying the same steps is a measured fact
 * about today's data, not a shared dependency. Collapsing them into one
 * exported normalizer would mean that a future revision of either
 * methodology -- a new dash rule, a decision about `&` -- silently changes
 * what the OTHER family means. The generator's parity assertion is what
 * keeps this implementation honest, not proximity to its twin.
 *
 * THIS IS FOR MATCHING ONLY. The candidate's displayValue is never rewritten,
 * the document is never rewritten, and export/audit always carry the original.
 *
 * DELIBERATELY NOT DONE: fuzzy matching, edit distance, stemming,
 * lemmatization, substring matching, token reordering, singular/plural
 * generation, guessed abbreviation expansion, synonym invention, or any model
 * inference.
 */
export function normalizeForEmploymentHrLookup(phrase: string): string {
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
  if (!index) index = buildDomainReferenceIndex(EMPLOYMENT_HR_PACK);
  return index;
}

/**
 * The single lookup. Returns null on a miss.
 *
 * NULL MEANS "NOT ATTESTED IN THIS DATASET" AND NOTHING ELSE. It is not "not
 * employment/HR language" -- this is an explicitly partial v1 vocabulary with
 * documented gaps, including the entire occupational-title universe -- and it
 * is certainly not "therefore a person". Callers must treat a miss as the
 * absence of one evidence family, never as counter-evidence.
 */
export function employmentHrEvidenceFor(phrase: string): EmploymentHrEvidence | null {
  return lookupDomainReference("employment-hr-terminology", ensureIndex(), phrase, normalizeForEmploymentHrLookup(phrase));
}

/** Convenience predicate for diagnostics and benchmark harnesses. Production
 *  callers should hold the evidence record instead -- a bare boolean is
 *  precisely the shape that invites treating membership as a verdict. */
export function isAttestedEmploymentHrTerminology(phrase: string): boolean {
  return employmentHrEvidenceFor(phrase) !== null;
}

/** Per-source-family licensing and retrieval provenance, decoded.
 *
 *  Dataset-level provenance, deliberately NOT part of the per-phrase evidence
 *  record: it says nothing about a candidate and would only add noise to a
 *  reviewer's evidence trace. It is here so redistribution and audit can carry
 *  the attribution the sources require. */
export function employmentHrSourceLicensing(): Array<{
  sourceFamily: string;
  sourceTier: string;
  licenseStatus: string;
  retrievalDate: string;
}> {
  return EMPLOYMENT_HR_SOURCE_LICENSING.map(([sourceFamily, sourceTier, licenseStatus, retrievalDate]) => ({
    sourceFamily,
    sourceTier,
    licenseStatus,
    retrievalDate,
  }));
}

/** Reviewer-facing evidence lines. States what was observed, never a verdict. */
export function explainEmploymentHrEvidence(evidence: EmploymentHrEvidence | null): string[] {
  return explainDomainReferenceEvidence(evidence, "employment/HR terminology");
}

/** Provenance for the audit record. */
export const EMPLOYMENT_HR_EVIDENCE_SOURCE = EMPLOYMENT_HR_SOURCE;
export const EMPLOYMENT_HR_EVIDENCE_ROW_COUNT = EMPLOYMENT_HR_ROW_COUNT;
export const EMPLOYMENT_HR_EVIDENCE_TERM_COUNT = EMPLOYMENT_HR_TERM_COUNT;
