/**
 * ReferenceEvidence.ts -- gathers every deterministic reference evidence
 * channel for one phrase, and resolves NONE of them (AG, 2026-08-10).
 *
 * ══════════════════ WHAT THIS IS, IN ONE LINE ══════════════════
 *
 * A fan-out, not a decision. `referenceEvidenceFor(phrase)` asks EVERY
 * shipped reference dataset the same question -- "do you attest this?" --
 * and returns every answer side by side. Callers should not have to know
 * which pack to query; that is the whole ergonomic point.
 *
 *     candidate
 *       -> independent evidence channels   <- THIS FILE ENDS HERE
 *       -> evidence interpretation             (does not exist yet)
 *       -> recommendation / routing            (unchanged)
 *
 * ══════════════ WHAT THIS FILE MUST NEVER GROW INTO ══════════════
 *
 * The temptation, the moment several channels are in one struct, is to add a
 * sixth field summarising them. Do not. There is no precedence order here, no
 * weighting, no score, no `mostLikelyType`, no "legal beats census", no
 * tie-break, and no boolean that collapses several channels into one. Every
 * such rule is a semantic policy decision, every one of them needs the
 * surrounding document to be made correctly, and this layer cannot see the
 * document.
 *
 * CONTRADICTION IS THE PRODUCT. A phrase carrying Census name evidence AND
 * GNIS place evidence AND legal terminology evidence is not a bug to be
 * resolved -- it is the single most informative thing these datasets can
 * jointly report, and the reason each pack was built as evidence rather than
 * as a classifier. Flattening it here would destroy the input the eventual
 * combination layer exists to consume.
 *
 * ══════════════ WHY THE CHANNELS ARE SHAPED DIFFERENTLY ══════════════
 *
 * They are not normalised into a uniform record, deliberately. The three
 * terminology packs answer "is this attested vocabulary"; Census answers
 * "does this phrase have personal-name STRUCTURE"; GNIS answers "does this
 * name a place, and how strongly". Those are different questions with
 * different evidence shapes, and forcing one struct on them would either
 * discard Census's per-token roles and GNIS's strength/suppression, or invent
 * empty fields for the packs that have no analogue. Each channel keeps its
 * own type; the discriminators (`family`, or the field name itself) are what
 * a heterogeneous consumer switches on.
 *
 * Note the two conventions that differ, because callers must not conflate
 * them: the terminology packs return `null` on a miss, while Census and GNIS
 * always return a record whose own field (`supportsNameStructure`,
 * `strength === "none"`) says whether anything was found. Both are preserved
 * as their own modules define them rather than papered over.
 *
 * ══════════════ ABSENCE IS NOT COUNTER-EVIDENCE ══════════════
 *
 * Every channel being null/none means only that a set of partial datasets did
 * not attest this phrase. Every one of them is a documented partial
 * vocabulary. Nothing about a phrase's semantic type follows from silence here.
 *
 * Pure, DOM-free, offline. Each pack's index builds lazily on its own first
 * lookup, so this fan-out costs only the channels it actually touches.
 */

import { censusNameEvidenceFor, type CensusNameEvidence } from "./CensusNameEvidence.js";
import { employmentHrEvidenceFor, type EmploymentHrEvidence } from "./EmploymentHrEvidence.js";
import { financeAccountingTaxEvidenceFor, type FinanceAccountingTaxEvidence } from "./FinanceAccountingTaxEvidence.js";
import { gnisPlaceEvidenceFor, type GnisPlaceEvidence } from "./GnisPlaceEvidence.js";
import { governmentPublicAdminEvidenceFor, type GovernmentPublicAdminEvidence } from "./GovernmentPublicAdminEvidence.js";
import { higherEdTerminologyFor, type HigherEdTerminologyEvidence } from "./HigherEdTerminologyEvidence.js";
import { legalTerminologyEvidenceFor, type LegalTerminologyEvidence } from "./LegalTerminologyEvidence.js";
import { medicalEvidenceFor, type MedicalEvidence } from "./MedicalEvidence.js";

/**
 * Every reference channel's answer for one phrase.
 *
 * ADDING A CHANNEL is a field here plus a call in `referenceEvidenceFor`,
 * plus one case in `terminologyChannelsOf` if the family carries attestation
 * provenance -- and nothing else, anywhere. That is the seam this file exists
 * to hold open, and Medical and Employment/HR each arrived through it without
 * touching a scoring, routing or classification module.
 */
export interface ReferenceEvidenceChannels {
  /** The phrase as passed in. Never rewritten by any channel. */
  value: string;

  /* ---- domain terminology: "is this attested vocabulary in domain X" ---- */

  /** Null on a miss. Higher-ed still uses its own pre-substrate record shape;
   *  it is read here through its own API and is unmodified by this work. */
  higherEdTerminology: HigherEdTerminologyEvidence | null;
  /** Null on a miss. Medical likewise predates the shared substrate and keeps
   *  its own record shape -- it landed from concurrent work while this file
   *  was being written, and is read here through its own API, unmodified. */
  medicalTerminology: MedicalEvidence | null;
  /** Null on a miss. */
  financeAccountingTax: FinanceAccountingTaxEvidence | null;
  /** Null on a miss. */
  legalTerminology: LegalTerminologyEvidence | null;
  /** Null on a miss. Built on the shared substrate from the start, so it
   *  needed one member on `DomainReferenceFamilyId`, one field here and one
   *  case in `terminologyChannelsOf` -- and nothing else anywhere. */
  employmentHr: EmploymentHrEvidence | null;
  /** Null on a miss. Substrate-backed, plus one pack-specific field
   *  (`jurisdiction`) that the shared row model has no column for and did not
   *  need one for -- see DomainReferenceEvidence.ts's family-id note. */
  governmentPublicAdmin: GovernmentPublicAdminEvidence | null;

  /* ---- entity reference: different question, different shape ---- */

  /** Always present; `supportsNameStructure` is the "found anything" bit.
   *  Personal-name STRUCTURE, not "is a person". */
  censusName: CensusNameEvidence;
  /** Always present; `strength === "none"` is the "found nothing" case. */
  gnisPlace: GnisPlaceEvidence;
}

/**
 * Ask every reference dataset about one phrase.
 *
 * Each channel applies its OWN normalization policy, because each source
 * methodology documents a different one and unifying them would silently
 * change what an existing family means (see DomainReferenceEvidence.ts's
 * header for the policies and why they differ). The same phrase is therefore
 * keyed several different ways, which is correct.
 */
export function referenceEvidenceFor(phrase: string): ReferenceEvidenceChannels {
  return {
    value: phrase,
    higherEdTerminology: higherEdTerminologyFor(phrase),
    medicalTerminology: medicalEvidenceFor(phrase),
    financeAccountingTax: financeAccountingTaxEvidenceFor(phrase),
    legalTerminology: legalTerminologyEvidenceFor(phrase),
    employmentHr: employmentHrEvidenceFor(phrase),
    governmentPublicAdmin: governmentPublicAdminEvidenceFor(phrase),
    censusName: censusNameEvidenceFor(phrase),
    gnisPlace: gnisPlaceEvidenceFor(phrase),
  };
}

/** Names of the channels that attested this phrase, for diagnostics and
 *  benchmark harnesses. Ordering is fixed and declaration-ordered -- it is
 *  NOT a precedence order and must never be read as one. */
export function attestingChannels(channels: ReferenceEvidenceChannels): string[] {
  const found: string[] = [];
  for (const channel of terminologyChannelsOf(channels)) if (channel.evidence) found.push(channel.id);
  if (channels.censusName.supportsNameStructure) found.push("census-name");
  if (channels.gnisPlace.strength !== "none") found.push("gnis-place");
  return found;
}

/**
 * A UNIFORM READ-ONLY VIEW over the terminology channels, for consumers that
 * want to treat them alike -- the console diagnostic, the overlap harness,
 * anything that renders a table with one row per family.
 *
 * ══════════ THIS IS A VIEW, NOT A STORAGE COLLAPSE ══════════
 *
 * The full provenance stays in the underlying records, which callers reach
 * through `ReferenceEvidenceChannels` exactly as before -- every attesting
 * row, every source URL, every note. This flattens only the handful of
 * summary fields a family-agnostic table needs. If you find yourself wanting
 * `attestations` here, take the record instead; that is what it is for.
 *
 * ══════════ WHY IT EXISTS: MERGE SURFACE (AG, 2026-08-10) ══════════
 *
 * Several domain packs are being integrated concurrently and more are coming.
 * Without this, every new family means editing the same block of the console
 * diagnostic and the same block of any harness -- which is precisely the
 * shape that produces a conflict in a shared file for every pack, forever.
 * With it, adding a family is ONE case in `terminologyChannelsOf` plus one
 * field on `ReferenceEvidenceChannels`, both in THIS file, and every generic
 * consumer picks it up for free.
 *
 * Ordering is declaration order and carries NO precedence meaning.
 */
export interface TerminologyChannelView {
  /** The family discriminator, matching each pack's own `family` literal. */
  id: string;
  /** Short human label for diagnostic tables. */
  label: string;
  /** Null on a miss -- meaning "not attested in that dataset", nothing more. */
  evidence: {
    /** The display form of the first attesting row, verbatim from source. */
    matchedTerm: string;
    normalized: string;
    attestationRows: number;
    sourceFamilies: readonly string[];
    /** Empty for packs that do not distinguish sub-domains. */
    subDomains: readonly string[];
    semanticHints: readonly string[];
    highestCollisionRisk: string;
    hasSourceAttestedRow: boolean;
    tokenCount: number;
  } | null;
}

/**
 * ONE FULLY SELF-CONTAINED AUDIT ROW: the whole determination path for a
 * single attestation, flat, with no pointers into any other structure.
 *
 * ══════════ WHY FLAT, AND WHY SELF-CONTAINED (AG, 2026-08-10) ══════════
 *
 * These packs will get things wrong, and the question that matters months
 * from now is not "did an evidence channel fire" but "WHICH path produced
 * this, and where do I go to fix it". A row below answers that without
 * needing the object graph it came from:
 *
 *     source family -> source (+ URL) -> attested term -> normalized key
 *                   -> evidence family -> claim
 *
 * So a bad hit is attributable to a specific dataset, a specific authority, a
 * specific published term, and whether that term was directly attested or
 * mechanically derived. Fixing it means editing one CSV row and regenerating
 * one asset -- no other channel is involved and no other channel changes.
 * That is what makes the families independently improvable rather than
 * jointly entangled.
 *
 * READ-ONLY, AND DELIBERATELY NOT WIRED INTO THE EXPORTED AuditRecord. This
 * is a development/benchmark instrument. Reference evidence decides nothing
 * today, so putting it in the document's audit export would change output for
 * no reader's benefit; that wiring is a decision for whoever builds the
 * combination layer, once the evidence actually influences something.
 */
export interface ReferenceEvidenceAuditRow {
  /** The candidate phrase exactly as it appeared. */
  value: string;
  /** Which pack attested. */
  evidenceFamily: string;
  /** Which authority within that pack. */
  sourceFamily: string;
  source: string;
  sourceUrl: string;
  sourceAuthorityLevel: string;
  sourceId: string | null;
  /** Sub-domain within the pack, where it distinguishes one. */
  subDomain: string | null;
  /** The published term this row matched, verbatim. */
  matchedTerm: string;
  /** The key both sides were reduced to for comparison. */
  normalizedTerm: string;
  semanticHints: string;
  sourceAttested: boolean;
  derivedVariant: boolean;
  parentTerm: string | null;
  collisionRisk: string;
  acronym: string | null;
  acronymExpansion: string | null;
  notes: string;
}

/**
 * Every attesting row across every terminology channel, flattened.
 *
 * One row per (channel, attestation). Empty when nothing attested -- which
 * means "a set of partial datasets did not attest this phrase", never a negative
 * finding about the phrase.
 *
 * Census and GNIS are deliberately absent: they answer a different question
 * (name STRUCTURE, place strength) and have no attestation rows to flatten.
 * Forcing them into this shape would mean inventing empty provenance columns,
 * and their own records already carry what they know.
 */
export function referenceEvidenceAuditRows(channels: ReferenceEvidenceChannels): ReferenceEvidenceAuditRow[] {
  const rows: ReferenceEvidenceAuditRow[] = [];

  const push = (
    evidenceFamily: string,
    normalizedTerm: string,
    attestation: {
      term: string;
      semanticHints?: readonly string[];
      semanticHint?: string;
      subDomain?: string | null;
      source: string;
      sourceUrl: string;
      sourceFamily: string;
      sourceAuthorityLevel?: string;
      sourceId?: string | null;
      sourceAttested?: boolean;
      derivedVariant: boolean;
      parentTerm?: string | null;
      collisionRisk: string;
      acronym?: string | null;
      acronymExpansion?: string | null;
      notes: string;
    }
  ): void => {
    rows.push({
      value: channels.value,
      evidenceFamily,
      sourceFamily: attestation.sourceFamily,
      source: attestation.source,
      sourceUrl: attestation.sourceUrl,
      sourceAuthorityLevel: attestation.sourceAuthorityLevel ?? "",
      sourceId: attestation.sourceId ?? null,
      subDomain: attestation.subDomain ?? null,
      matchedTerm: attestation.term,
      normalizedTerm,
      semanticHints: (attestation.semanticHints ?? [attestation.semanticHint ?? ""]).join("|"),
      // Higher-ed's pre-substrate record has no `sourceAttested` column: a row
      // there is source-attested exactly when it is not a derived variant.
      sourceAttested: attestation.sourceAttested ?? !attestation.derivedVariant,
      derivedVariant: attestation.derivedVariant,
      parentTerm: attestation.parentTerm ?? null,
      collisionRisk: attestation.collisionRisk,
      acronym: attestation.acronym ?? null,
      acronymExpansion: attestation.acronymExpansion ?? null,
      notes: attestation.notes,
    });
  };

  if (channels.higherEdTerminology) {
    for (const a of channels.higherEdTerminology.attestations) {
      push("higher-ed-terminology", channels.higherEdTerminology.normalized, a);
    }
  }
  if (channels.medicalTerminology) {
    for (const a of channels.medicalTerminology.attestations) {
      push("medical-terminology", channels.medicalTerminology.normalized, { ...a, sourceAuthorityLevel: a.authorityLevel });
    }
  }
  if (channels.financeAccountingTax) {
    for (const a of channels.financeAccountingTax.attestations) {
      push("finance-accounting-tax", channels.financeAccountingTax.normalized, a);
    }
  }
  if (channels.legalTerminology) {
    for (const a of channels.legalTerminology.attestations) {
      push("legal-terminology", channels.legalTerminology.normalized, a);
    }
  }
  if (channels.governmentPublicAdmin) {
    for (const a of channels.governmentPublicAdmin.attestations) {
      push("government-public-admin", channels.governmentPublicAdmin.normalized, a);
    }
  }
  if (channels.employmentHr) {
    for (const a of channels.employmentHr.attestations) {
      push("employment-hr-terminology", channels.employmentHr.normalized, a);
    }
  }
  return rows;
}

export function terminologyChannelsOf(channels: ReferenceEvidenceChannels): TerminologyChannelView[] {
  return [
    {
      id: "higher-ed-terminology",
      label: "higher education",
      evidence: channels.higherEdTerminology === null ? null : {
        matchedTerm: channels.higherEdTerminology.attestations[0]?.term ?? "",
        normalized: channels.higherEdTerminology.normalized,
        attestationRows: channels.higherEdTerminology.attestations.length,
        sourceFamilies: channels.higherEdTerminology.sourceFamilies,
        subDomains: [],
        semanticHints: channels.higherEdTerminology.semanticHints,
        highestCollisionRisk: channels.higherEdTerminology.highestCollisionRisk,
        hasSourceAttestedRow: channels.higherEdTerminology.hasSourceAttestedRow,
        tokenCount: channels.higherEdTerminology.tokenCount,
      },
    },
    {
      id: "medical-terminology",
      label: "medical",
      evidence: channels.medicalTerminology === null ? null : {
        matchedTerm: channels.medicalTerminology.attestations[0]?.term ?? "",
        normalized: channels.medicalTerminology.normalized,
        attestationRows: channels.medicalTerminology.attestations.length,
        sourceFamilies: channels.medicalTerminology.sourceFamilies,
        subDomains: [],
        semanticHints: channels.medicalTerminology.semanticHints,
        highestCollisionRisk: channels.medicalTerminology.highestCollisionRisk,
        hasSourceAttestedRow: channels.medicalTerminology.hasSourceAttestedRow,
        tokenCount: channels.medicalTerminology.tokenCount,
      },
    },
    {
      id: "finance-accounting-tax",
      label: "finance / accounting / tax",
      evidence: channels.financeAccountingTax === null ? null : {
        matchedTerm: channels.financeAccountingTax.attestations[0]?.term ?? "",
        normalized: channels.financeAccountingTax.normalized,
        attestationRows: channels.financeAccountingTax.attestations.length,
        sourceFamilies: channels.financeAccountingTax.sourceFamilies,
        subDomains: channels.financeAccountingTax.subDomains,
        semanticHints: channels.financeAccountingTax.semanticHints,
        highestCollisionRisk: channels.financeAccountingTax.highestCollisionRisk,
        hasSourceAttestedRow: channels.financeAccountingTax.hasSourceAttestedRow,
        tokenCount: channels.financeAccountingTax.tokenCount,
      },
    },
    {
      id: "legal-terminology",
      label: "legal",
      evidence: channels.legalTerminology === null ? null : {
        matchedTerm: channels.legalTerminology.attestations[0]?.term ?? "",
        normalized: channels.legalTerminology.normalized,
        attestationRows: channels.legalTerminology.attestations.length,
        sourceFamilies: channels.legalTerminology.sourceFamilies,
        subDomains: channels.legalTerminology.subDomains,
        semanticHints: channels.legalTerminology.semanticHints,
        highestCollisionRisk: channels.legalTerminology.highestCollisionRisk,
        hasSourceAttestedRow: channels.legalTerminology.hasSourceAttestedRow,
        tokenCount: channels.legalTerminology.tokenCount,
      },
    },
    {
      id: "employment-hr-terminology",
      label: "employment / HR",
      evidence: channels.employmentHr === null ? null : {
        matchedTerm: channels.employmentHr.attestations[0]?.term ?? "",
        normalized: channels.employmentHr.normalized,
        attestationRows: channels.employmentHr.attestations.length,
        sourceFamilies: channels.employmentHr.sourceFamilies,
        subDomains: channels.employmentHr.subDomains,
        semanticHints: channels.employmentHr.semanticHints,
        highestCollisionRisk: channels.employmentHr.highestCollisionRisk,
        hasSourceAttestedRow: channels.employmentHr.hasSourceAttestedRow,
        tokenCount: channels.employmentHr.tokenCount,
      },
    },
    {
      id: "government-public-admin",
      label: "government / public administration",
      evidence: channels.governmentPublicAdmin === null ? null : {
        matchedTerm: channels.governmentPublicAdmin.attestations[0]?.term ?? "",
        normalized: channels.governmentPublicAdmin.normalized,
        attestationRows: channels.governmentPublicAdmin.attestations.length,
        sourceFamilies: channels.governmentPublicAdmin.sourceFamilies,
        subDomains: channels.governmentPublicAdmin.subDomains,
        semanticHints: channels.governmentPublicAdmin.semanticHints,
        highestCollisionRisk: channels.governmentPublicAdmin.highestCollisionRisk,
        hasSourceAttestedRow: channels.governmentPublicAdmin.hasSourceAttestedRow,
        tokenCount: channels.governmentPublicAdmin.tokenCount,
      },
    },
  ];
}
