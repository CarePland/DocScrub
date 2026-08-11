/**
 * candidate-interpretation.ts -- derives EVERY supported reading of one
 * candidate, and chooses between NONE of them (AG, 2026-08-10).
 *
 * ═══════════════════ WHAT THIS DOES, IN ONE LINE ═══════════════════
 *
 * Takes the conclusions the pipeline has already reached about a candidate
 * and re-expresses them as a set of AFFIRMATIVELY SUPPORTED interpretations,
 * each carrying the observations that support it. It adds no knowledge, owns
 * no dictionary, reaches no engine, and reads nothing the pipeline did not
 * already compute.
 *
 *     evidence  ->  supported interpretations  ->  disposition
 *     (exists)      THIS FILE ENDS HERE           (does not exist yet)
 *
 * ═══════════════════ PHASE A: THIS IS INERT ═══════════════════
 *
 * Nothing in production reads a profile. It is computed per candidate at load,
 * stored, and consumed only by the console diagnostic and the verification
 * suites. Type Check assignment, recommendations, routing, the person-
 * protection gate, the residual-review gate and the audit export are all
 * byte-identical whether or not this module exists -- asserted in
 * verify/candidate-interpretation-verification.ts.
 *
 * That is deliberate sequencing, not timidity. The measurements this layer
 * makes possible are the input to designing combination policy; designing the
 * policy first and measuring afterwards is how the branch-order problem got
 * here in the first place.
 *
 * ═══════════════════ WHAT THIS FILE MUST NEVER GROW INTO ═══════════════════
 *
 * The moment several supported readings sit in one array, the temptation is a
 * function that returns the best one. Every version of that is forbidden here:
 *
 *   NO VOTING.        The number of supporting signals is not a measure of
 *                     anything. Three signals for `person` and one for `place`
 *                     does not mean person -- and cannot, because the sources
 *                     are not independent: GNIS consults Census internally for
 *                     its own Policy B, and several domain packs draw on
 *                     overlapping federal source families. Counting them as
 *                     independent votes double-counts a shared origin.
 *
 *   NO WEIGHTS.       Not per family, not per class. A weight is a policy
 *                     decision wearing a number's clothes, and the number
 *                     hides which decision was made.
 *
 *   NO CONFIDENCE.    No percentages. A synthetic confidence figure destroys
 *                     the provenance it summarises and cannot be checked by a
 *                     reviewer.
 *
 *   NO SUPPRESSION.   Terminology attestation must never remove the `person`
 *                     reading, and neither must strong GNIS evidence. The
 *                     measured reason: 35,174 GNIS place names are strong
 *                     matches that ALSO carry Census personal-name structure.
 *                     A rule of the form "strong place, therefore not a
 *                     person" is categorically wrong for that population, and
 *                     this file's job is to keep both readings alive so that
 *                     population stays visible.
 *
 * ═══════════════════ WHY THE FACTS ARE PASSED IN ═══════════════════
 *
 * Same discipline as `person-evidence-gate.ts` and `residualReviewGate.ts`:
 * every input below is a CONCLUSION some engine already published, and the
 * caller assembles them. A module that could reach back into the pipeline
 * would grow its own classifier by increments -- which is precisely the
 * failure this whole layer exists to avoid repeating.
 *
 * ONE DELIBERATE DEVIATION: `reference` takes the whole
 * `ReferenceEvidenceChannels` value rather than a set of pre-digested
 * booleans. Digesting it in the caller would put per-family knowledge back
 * into `Workspace.loadDocument`, which is exactly what the reference-evidence
 * fan-out was built to remove -- a ninth family would then have to edit
 * Workspace again. The channels value is pure, read-only and reaches no
 * engine, so passing it whole costs none of the isolation the idiom protects.
 *
 * Pure, DOM-free, deterministic. Identical facts produce a byte-identical
 * profile.
 */

import { censusRoleFor } from "../knowledge/CensusNameEvidence.js";
// VARIANT-FORM EVIDENCE (AG, 2026-08-10). Evidence that the observed form
// RESEMBLES an attested form -- never that it is wrong. See its module header
// for the measurement that rejected every phonetic method.
import { variantFormEvidenceFor } from "./variant-form-evidence.js";
import { terminologyChannelsOf, type ReferenceEvidenceChannels } from "../knowledge/ReferenceEvidence.js";
import { NAME_EVIDENCE_CATEGORIES } from "../cross-candidate/person-evidence-gate.js";
import { ORDINARY_LANGUAGE_CATEGORIES } from "../review/residualReviewGate.js";
import { ORGANIZATION_CATEGORIES, DOCUMENT_STRUCTURE_CATEGORY } from "../../domain/semanticTypes.js";
import type { CrossCandidateEvidence } from "../cross-candidate/cross-candidate-evidence.js";
import {
  INTERPRETATION_ORDER,
  outcomeFor,
  type InterpretationId,
  type InterpretationProfile,
  type InterpretationSignal,
  type SupportedInterpretation,
} from "./interpretation-model.js";

/** Everything this module is allowed to know about one candidate. */
export interface InterpretationFacts {
  candidateId: string;
  /** Display value, verbatim. Used for tokenization only; never rewritten. */
  displayValue: string;
  detectedType: string;
  /** Quality categories assigned upstream (kebab or snake; normalized here). */
  qualityCategories: readonly string[];
  /** Quality positiveReasons -- carries `nearby_title`, which is not a
   *  category and which no category-based test can see. */
  positiveReasons: readonly string[];
  /** Structural-relationship kinds, as strings. */
  relationshipKinds: readonly string[];
  /** Contextual person-evidence rule ids that fired on ANY occurrence. */
  contextualRules: readonly string[];
  /** Related by entity resolution to a partner that is itself
   *  person-evidenced. A conclusion the caller computes; see the gate. */
  hasPersonEvidencedLinkage: boolean;
  /** Cross-candidate evidence, if any was recorded for this candidate.
   *  Absent for person-protected candidates -- the gate excludes them from
   *  that engine's output entirely, which this module inherits. */
  crossCandidate?: CrossCandidateEvidence;
  /** Every reference channel's answer. See the module header. */
  reference: ReferenceEvidenceChannels;
  /**
   * VARIANT-FORM LOOKUP (AG, 2026-08-10). Normalized tokens appearing in
   * OTHER candidates of this document that are exactly Census-attested,
   * enabling document-local variant matching. Omit to disable it.
   *
   * Supplied by the caller because this module owns no view of the document.
   */
  documentAttestedTokens?: ReadonlySet<string>;
}

const norm = (category: string): string => category.replace(/_/g, "-");

/** Alphabetic tokens, for the token-membership question only. */
function alphaTokens(value: string): string[] {
  return value.split(/[^A-Za-z]+/).filter((t) => t.length > 0);
}

/**
 * A tiny accumulator so each reading is assembled in one place and an
 * interpretation with no support is simply never created. There is no
 * "empty interpretation" object, for the same reason the terminology packs
 * return null on a miss: an empty object invites being read as a finding.
 */
class Support {
  private readonly byKey = new Map<string, { id: InterpretationId; domain?: string; signals: InterpretationSignal[] }>();

  add(id: InterpretationId, signal: InterpretationSignal, domain?: string): void {
    const key = domain === undefined ? id : `${id} ${domain}`;
    const existing = this.byKey.get(key);
    if (existing) existing.signals.push(signal);
    else this.byKey.set(key, domain === undefined ? { id, signals: [signal] } : { id, domain, signals: [signal] });
  }

  /** In INTERPRETATION_ORDER, then by domain, so output is stable and
   *  diffable. Ordering carries no precedence meaning. */
  build(): SupportedInterpretation[] {
    const entries = [...this.byKey.values()];
    entries.sort((a, b) => {
      const byId = INTERPRETATION_ORDER.indexOf(a.id) - INTERPRETATION_ORDER.indexOf(b.id);
      if (byId !== 0) return byId;
      return (a.domain ?? "").localeCompare(b.domain ?? "");
    });
    return entries.map((e) =>
      e.domain === undefined
        ? { id: e.id, signals: e.signals }
        : { id: e.id, domain: e.domain, signals: e.signals }
    );
  }
}

/**
 * Derive every supported reading of one candidate.
 *
 * READS EVERY SOURCE, RESOLVES NONE. A candidate attested as legal
 * terminology, carrying Census name structure and appearing after "Dr." gets
 * all three readings, and this function has no opinion about which is right.
 */
export function interpretCandidate(facts: InterpretationFacts): InterpretationProfile {
  const support = new Support();
  const categories = facts.qualityCategories.map(norm);
  const positives = facts.positiveReasons.map(norm);
  const kinds = new Set(facts.relationshipKinds.map(norm));
  const hasCategory = (...names: string[]): string[] =>
    names.filter((n) => categories.includes(n) || positives.includes(n));

  /* ─────────────── typed detections: never contested, still modelled ─────────────── */

  if (facts.detectedType === "email") {
    support.add("email", {
      signalId: "email/detector",
      class: "detector-assertion",
      detail: "The detector matched an email-address structure.",
      provenance: "DetectionEngine",
        lineage: ["detector-assertion"],
    });
  }
  if (facts.detectedType === "phone") {
    support.add("phone", {
      signalId: "phone/detector",
      class: "detector-assertion",
      detail: "The detector matched a phone-number structure.",
      provenance: "DetectionEngine",
        lineage: ["detector-assertion"],
    });
  }
  if (facts.detectedType === "cin" || facts.detectedType === "long_numeric_id") {
    support.add("identifier", {
      signalId: "identifier/detector",
      class: "detector-assertion",
      detail: `The detector typed this as ${facts.detectedType}.`,
      provenance: "DetectionEngine",
        lineage: ["detector-assertion"],
    });
  }
  if (kinds.has("numeric-identifier") || kinds.has("alphanumeric-identifier")) {
    support.add("identifier", {
      signalId: "identifier/structural-relationship",
      class: "document-consistency",
      detail: "Grouped with other candidates sharing an identifier pattern in this document.",
      provenance: "StructuralRelationshipEngine",
        lineage: ["document-candidate-population"],
    });
  }

  /* ─────────────── person ─────────────── */

  const nameCategories = hasCategory(...NAME_EVIDENCE_CATEGORIES);
  if (nameCategories.length > 0) {
    support.add("person", {
      signalId: "person/name-lexicon",
      class: "lexicon-recognition",
      detail: `Recognized as name evidence: ${nameCategories.join(", ")}.`,
      provenance: "CandidateQualityEngine",
        lineage: ["docscrub-quality-lexicons"],
    });
  }
  if (positives.includes("nearby-title")) {
    support.add("person", {
      signalId: "person/nearby-title",
      class: "occurrence-context",
      detail: "An honorific or title attaches to at least one occurrence.",
      provenance: "CandidateQualityEngine",
        lineage: ["docscrub-quality-lexicons"],
    });
  }
  if (facts.reference.censusName.supportsNameStructure) {
    support.add("person", {
      signalId: "person/census-name-structure",
      class: "compositional-structure",
      detail: `Tokens compose into a Census personal-name structure (${facts.reference.censusName.structure}).`,
      provenance: "CensusNameEvidence",
        lineage: ["us-census-name-corpus"],
    });
  }
  /*
   * TOKEN MEMBERSHIP, modelled explicitly because it is the dominant collision
   * class in the system and a model that cannot NAME it cannot reason about it.
   *
   * This is the weakest claim DocScrub can make -- "each token occurs
   * somewhere in Census name data" is true of `Major`, `White`, `Course`,
   * `Session` and `Race`. It is recorded as support because it genuinely is
   * affirmative, and classed as `token-membership` so a future policy layer
   * can write ONE rule about the class rather than one rule per family.
   *
   * It is NOT fed to the person-protection gate. The gate deliberately reads
   * STRUCTURE and never token membership: measured, membership protects
   * 80/106 non-people, which is the same as protecting nothing.
   */
  const tokens = alphaTokens(facts.displayValue);
  if (tokens.length > 0 && tokens.every((t) => censusRoleFor(t) !== null)) {
    support.add("person", {
      signalId: "person/census-token-membership",
      class: "token-membership",
      detail:
        tokens.length === 1
          ? `The token "${tokens[0]}" occurs in Census name data.`
          : `All ${tokens.length} tokens occur in Census name data, in no particular role.`,
      provenance: "CensusNameEvidence",
        lineage: ["us-census-name-corpus"],
    });
  }
  /*
   * VARIANT-FORM EVIDENCE (AG, 2026-08-10). See variant-form-evidence.ts.
   *
   * ONE SIGNAL PER OBSERVED TOKEN, not one per matched form: a token with
   * three near-forms is one observation about that token, and emitting three
   * signals would make a denser reference corpus look like stronger evidence
   * -- which is counting by the back door. Every matched form is still named
   * in the detail and every relationship survives on the evidence record.
   *
   * The compositional case is a DIFFERENT signal id from the standalone case,
   * because the measurement says they are different: requiring an
   * exactly-attested partner token admitted 0 of 23 boundary-fragment and
   * domain-phrase negatives, where the bare relationship admits some. Phase B
   * can distinguish them without this module deciding that it should.
   */
  const variant = variantFormEvidenceFor(facts.displayValue, {
    ...(facts.documentAttestedTokens ? { documentAttestedTokens: facts.documentAttestedTokens } : {}),
  });
  /*
   * ONLY PERSON-SUPPORTING RELATIONSHIPS CREATE A SIGNAL (AG, 2026-08-10).
   *
   * A relationship to a RARE reference form is discovered, recorded and
   * inspectable, but says nothing about the candidate -- the Census surname
   * tail is dense enough that almost any long English word sits one deletion
   * from some rare name. `Services ~ SERVIES` is a true relationship and a
   * worthless inference. See variant-form-evidence.ts's PRODUCTION HARDENING
   * section for the measurement (15 production firings -> 1).
   */
  const supportingRelationships = variant.relationships.filter((r) => r.personSupporting);
  if (supportingRelationships.length > 0) {
    const byToken = new Map<string, typeof variant.relationships[number][]>();
    for (const r of supportingRelationships) {
      const bucket = byToken.get(r.observedForm) ?? [];
      bucket.push(r);
      byToken.set(r.observedForm, bucket);
    }
    for (const [observed, group] of byToken) {
      const best = group[0]!;
      const roles = [
        group.some((r) => r.matchedFirstAttested) ? "first name" : "",
        group.some((r) => r.matchedSurnameAttested) ? "surname" : "",
      ].filter((r) => r.length > 0).join(" / ");
      support.add("person", {
        signalId: variant.compositionalCorroboration
          ? "person/variant-form-with-attested-partner"
          : "person/variant-form",
        class: "variant-form",
        detail:
          `The observed form "${observed}" is closely similar to ${group.map((r) => `"${r.matchedForm}"`).join(", ")}` +
          `, attested as ${roles || "name data"}` +
          (best.method === "document-local-variant" ? " elsewhere in this document" : " in U.S. Census name data") +
          `. The observed spelling stands as written.` +
          (variant.compositionalCorroboration
            ? ` Another token (${variant.exactAttestedPartnerTokens.join(", ")}) is itself exactly attested.`
            : ""),
        provenance: `${best.method} (${best.source}, similarity ${best.similarity.toFixed(3)})`,
        /* THE VARIANT TARGET IS ITSELF A CENSUS FORM. So variant evidence and
         * Census evidence on the same candidate are ONE corpus speaking twice,
         * not two witnesses agreeing -- which is exactly what this field
         * exists to make checkable. */
        lineage: ["us-census-name-corpus"],
      });
    }
  }

  for (const rule of facts.contextualRules) {
    const normalized = norm(rule);
    if (normalized.startsWith("anchor-")) {
      support.add("person", {
        signalId: `person/anchor:${normalized.slice("anchor-".length)}`,
        class: "occurrence-context",
        detail: `An identity anchor fired on an occurrence: ${normalized}.`,
        provenance: "contextual-person-evidence/anchor-rules",
        lineage: ["document-occurrence-context"],
      });
    } else if (normalized.startsWith("contextual-")) {
      support.add("person", {
        signalId: `person/contextual-usage:${normalized.slice("contextual-".length)}`,
        class: "occurrence-context",
        detail: `An occurrence uses this candidate in a person-like grammatical role: ${normalized}.`,
        provenance: "contextual-person-evidence/contextual-rules",
        lineage: ["document-occurrence-context"],
      });
    }
  }
  if (facts.hasPersonEvidencedLinkage) {
    support.add("person", {
      signalId: "person/entity-linkage",
      class: "document-consistency",
      detail: "Linked by entity resolution to a candidate that is itself person-evidenced.",
      provenance: "EntityResolutionEngine",
        lineage: ["document-candidate-population"],
    });
  }

  /* ─────────────── place ─────────────── */

  if (facts.reference.gnisPlace.strength !== "none") {
    const gnis = facts.reference.gnisPlace;
    support.add("place", {
      signalId: "place/gnis-attestation",
      class: "exact-phrase-attestation",
      detail:
        `Attested in USGS GNIS as a domestic place name (${gnis.featureClasses.join(", ")})` +
        (gnis.strength === "weak"
          ? ` -- downgraded to weak because it also reads as a common personal name (${gnis.suppressionReason ?? "policy-b"}).`
          : "."),
      provenance: "GnisPlaceEvidence",
        lineage: ["usgs-gnis-corpus", "us-census-name-corpus"],
    });
  }

  /* ─────────────── domain terminology: one reading per attesting family ─────────────── */

  for (const channel of terminologyChannelsOf(facts.reference)) {
    if (!channel.evidence) continue;
    const e = channel.evidence;
    support.add(
      "domain-terminology",
      {
        signalId: `domain-terminology/${channel.id}`,
        class: "exact-phrase-attestation",
        detail:
          `"${e.matchedTerm}" is attested ${channel.label} terminology` +
          (e.subDomains.length > 0 ? ` [${e.subDomains.join(", ")}]` : "") +
          ` (${e.sourceFamilies.join(", ")})` +
          (e.highestCollisionRisk === "HIGH"
            ? " -- flagged by the dataset itself as collision-prone."
            : e.hasSourceAttestedRow
              ? "."
              : " -- attested only as a mechanically derived variant."),
        provenance: `${channel.id} (${e.attestationRows} attesting row${e.attestationRows === 1 ? "" : "s"})`,
        /* One entry, not one per family: the packs draw on overlapping federal
         * source families, so two packs attesting the same phrase is NOT
         * guaranteed to be two independent authorities. Naming the shared
         * lineage is the conservative reading and the one the collision audit
         * supports. */
        lineage: ["domain-terminology-pack"],
      },
      channel.id
    );
  }

  /*
   * DOCUMENT-LOCAL TERMINOLOGY. Cross-candidate evidence reports that a phrase
   * behaves like domain vocabulary IN THIS DOCUMENT -- its tokens recur across
   * unrelated phrases, or its head noun heads a paradigm. That is an
   * affirmative claim of the same KIND the packs make, differing only in who
   * attests it: the document rather than an external authority. Modelling it
   * here, discriminated as `document-local`, is what lets `Grade Rosters` and
   * `Cost of Attendance` both carry a terminology reading.
   *
   * `truncated_variant` is deliberately not mapped: it reports that a phrase
   * is a prefix of a longer one, which is a structural observation about
   * extraction and supports no semantic reading in this vocabulary.
   */
  const cross = facts.crossCandidate;
  if (cross) {
    if (cross.rules.includes("token_recurrence") && cross.sharedToken) {
      support.add(
        "domain-terminology",
        {
          signalId: "domain-terminology/token-recurrence",
          class: "document-consistency",
          detail: `The token "${cross.sharedToken}" recurs across ${cross.tokenShare} distinct phrases in this document.`,
          provenance: "cross-candidate-evidence",
        lineage: ["document-candidate-population"],
        },
        "document-local"
      );
    }
    if (cross.rules.includes("head_noun_paradigm") && cross.headNoun) {
      support.add(
        "domain-terminology",
        {
          signalId: "domain-terminology/head-noun-paradigm",
          class: "document-consistency",
          detail: `${cross.headShare} phrases in this document end in the same head noun "${cross.headNoun}".`,
          provenance: "cross-candidate-evidence",
        lineage: ["document-candidate-population"],
        },
        "document-local"
      );
    }
  }

  /* ─────────────── organization / acronym / dates / titles ─────────────── */

  if (facts.detectedType === "organization") {
    support.add("organization", {
      signalId: "organization/detector",
      class: "detector-assertion",
      detail: "The detector typed this as an organization.",
      provenance: "DetectionEngine",
        lineage: ["detector-assertion"],
    });
  }
  const orgCategories = hasCategory(...ORGANIZATION_CATEGORIES);
  if (orgCategories.length > 0) {
    support.add("organization", {
      signalId: "organization/quality-category",
      class: "lexicon-recognition",
      detail: `Recognized institutional vocabulary: ${orgCategories.join(", ")}.`,
      provenance: "CandidateQualityEngine",
        lineage: ["docscrub-quality-lexicons"],
    });
  }

  if (kinds.has("acronym")) {
    support.add("acronym", {
      signalId: "acronym/structural-relationship",
      class: "document-consistency",
      detail: "Grouped with an expansion or acronym paradigm elsewhere in this document.",
      provenance: "StructuralRelationshipEngine",
        lineage: ["document-candidate-population"],
    });
  }
  const acronymCategories = hasCategory("likely-acronym", "institution-acronym");
  if (acronymCategories.length > 0) {
    support.add("acronym", {
      signalId: "acronym/quality-category",
      class: "lexicon-recognition",
      detail: `Acronym-shaped: ${acronymCategories.join(", ")}.`,
      provenance: "CandidateQualityEngine",
        lineage: ["docscrub-quality-lexicons"],
    });
  }

  const dateCategories = hasCategory("calendar-term", "calendar-abbreviation", "season-or-academic-term");
  if (dateCategories.length > 0) {
    support.add("date-or-term", {
      signalId: "date-or-term/quality-category",
      class: "lexicon-recognition",
      detail: `Recognized calendar or term vocabulary: ${dateCategories.join(", ")}.`,
      provenance: "CandidateQualityEngine",
        lineage: ["docscrub-quality-lexicons"],
    });
  }

  const titleCategories = hasCategory(DOCUMENT_STRUCTURE_CATEGORY);
  if (titleCategories.length > 0) {
    support.add("document-title", {
      signalId: "document-title/quality-category",
      class: "lexicon-recognition",
      detail: "Recognized as document-structure vocabulary.",
      provenance: "CandidateQualityEngine",
        lineage: ["docscrub-quality-lexicons"],
    });
  }

  /* ─────────────── ordinary language: affirmative, never a fallback ─────────────── */

  const ordinary = hasCategory(...ORDINARY_LANGUAGE_CATEGORIES);
  if (ordinary.length > 0) {
    support.add("ordinary-language", {
      signalId: "ordinary-language/quality-category",
      class: "lexicon-recognition",
      detail: `Positive evidence of ordinary vocabulary: ${ordinary.join(", ")}.`,
      provenance: "CandidateQualityEngine",
        lineage: ["docscrub-quality-lexicons"],
    });
  }

  const interpretations = support.build();
  return {
    candidateId: facts.candidateId,
    value: facts.displayValue,
    outcome: outcomeFor(interpretations),
    interpretations,
  };
}

/**
 * Reviewer-facing lines: what is supported, by what, and nothing more.
 *
 * There is no concluding sentence, on purpose. "Interpretation: likely
 * academic terminology" is a POLICY output and this layer has no policy --
 * writing it here would be the single-answer collapse re-entering through the
 * explanation. The lines below state observations; whoever builds the
 * disposition layer adds the conclusion, and will be able to justify it.
 */
export function explainInterpretationProfile(profile: InterpretationProfile): string[] {
  if (profile.outcome === "unsupported") {
    return [
      `No affirmative evidence supports any reading of "${profile.value}".`,
      "That is thin evidence, not a finding that it is unimportant.",
    ];
  }
  const lines: string[] = [];
  for (const interpretation of profile.interpretations) {
    const label = interpretation.domain === undefined ? interpretation.id : `${interpretation.id} [${interpretation.domain}]`;
    lines.push(`${label}:`);
    for (const signal of interpretation.signals) lines.push(`  + ${signal.detail}`);
  }
  if (profile.outcome === "contested") {
    lines.push("Two or more readings are affirmatively supported. Nothing here chooses between them.");
  }
  return lines;
}
