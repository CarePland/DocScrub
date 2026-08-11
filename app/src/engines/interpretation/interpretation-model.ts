/**
 * interpretation-model.ts -- the vocabulary for representing MORE THAN ONE
 * supported reading of a candidate at once (AG, 2026-08-10).
 *
 * ═══════════════════ THE PROBLEM THIS VOCABULARY EXISTS FOR ═══════════════════
 *
 * `domain/semanticTypes.ts`'s `semanticTypeFor` is a first-match-wins chain
 * returning ONE `SemanticTypeId`. For the overwhelming majority of candidates
 * that is correct and this file changes nothing about it. But five evidence
 * families have now independently arrived at the same wall, and each
 * integration report reached it in its own words: the function cannot
 * represent
 *
 *     affirmative PERSON evidence  AND  affirmative PLACE evidence
 *
 * simultaneously. It can only pick, and the pick is made by branch ORDER --
 * which means branch order is semantic policy that nobody decided.
 *
 * The measured scale of the problem, from the 2026-08-10 collision audit:
 * 36,119 GNIS place names also carry Census personal-name structure, and
 * 35,174 of those remain strong GNIS matches. A single-answer function has no
 * way to say what is true about `ABE YARBROUGH` -- that it is attested as
 * both -- so it says one of them, silently.
 *
 * ═══════════════════ WHAT THIS FILE IS, AND IS NOT ═══════════════════
 *
 * It is a VOCABULARY and a SHAPE. It contains no rules, no thresholds, no
 * weights, no scores, no precedence and no derivation. `candidate-
 * interpretation.ts` derives profiles in this shape; nothing in this file
 * decides anything.
 *
 * It is deliberately NOT `SemanticTypeId`, and that separation is load-bearing
 * in both directions:
 *
 *   - `SemanticTypeId` is a REVIEWER-FACING ROUTING vocabulary. Its members
 *     are Type Check cards. Adding a member changes what a reviewer sees, and
 *     adding a Place category is explicitly reserved to Andrew.
 *   - `InterpretationId` below is an INTERNAL ANALYTIC vocabulary. Its members
 *     are readings the evidence can support. `place` exists here because the
 *     evidence genuinely supports it, and its presence here creates no
 *     reviewer-facing category and no routing consequence whatsoever.
 *
 * Conflating the two would mean either inventing UI categories to make the
 * analysis expressible, or crippling the analysis to fit the UI. Both were
 * available and both are wrong.
 *
 * ═══════════════════ WHY THERE IS NO `counterContext` FIELD ═══════════════════
 *
 * The obvious shape for this model carries, per interpretation, a list of
 * things that argue AGAINST it. It was designed that way first and then
 * removed, because every candidate for that list turned out to be one of two
 * things:
 *
 *   1. AN ABSENCE -- "no occurrence shows contextual person use", "not
 *      attested in any terminology pack". DocScrub's standing principle is
 *      that absence of evidence is not counter-evidence, and a field whose
 *      natural contents are absences is a place for that principle to be
 *      quietly violated.
 *
 *   2. AFFIRMATIVE SUPPORT FOR A COMPETING READING -- cross-candidate token
 *      recurrence, ordinary-language categories, terminology attestation.
 *      These are real and they matter, but they are POSITIVE claims about
 *      something else, and this model already has somewhere to put them: the
 *      competing interpretation itself.
 *
 * So: COMPETING INTERPRETATIONS *ARE* THE COUNTER-EVIDENCE REPRESENTATION.
 * A second way to say the same thing would have been weaker, and would have
 * let absences in through the side door. `ordinary-language` is a member below
 * for exactly this reason -- "this phrase is ordinary English" is an
 * affirmative observation, and giving it a home means nothing has to be
 * modelled as a negative.
 *
 * Pure, DOM-free, dependency-free.
 */

/**
 * The readings a candidate's evidence can support.
 *
 * TOTAL BY DESIGN: a profile is computed for every candidate, including the
 * ones nothing competes over. That is what makes "this document is mostly
 * unambiguous" a measurable claim rather than an assumption, and it means the
 * ambiguity population is a filter over a complete set rather than a
 * separately-maintained list that can drift.
 *
 * `email` and `phone` are members even though nothing can ever contest them,
 * so that "exactly one supported interpretation, from a typed detection" is
 * representable and countable alongside everything else.
 */
export type InterpretationId =
  /** A human being. */
  | "person"
  /** A geographic place. Has NO `SemanticTypeId` counterpart, on purpose. */
  | "place"
  /** An organization, department, institution or administrative body. */
  | "organization"
  /** Attested vocabulary of a professional domain. Carries `domain`. */
  | "domain-terminology"
  /** An identifier: CIN, long numeric id, structured alphanumeric. */
  | "identifier"
  | "acronym"
  | "date-or-term"
  | "document-title"
  | "email"
  | "phone"
  /**
   * ORDINARY LANGUAGE -- a positive claim, not a fallback.
   *
   * This member is why the model needs no negative-evidence channel. "This
   * phrase is common English vocabulary" is an affirmative observation that
   * DocScrub's quality engine already makes and that the residual-review gate
   * already REQUIRES rather than infers (see its guard 4). Modelling it as a
   * supported reading keeps every signal in the system positive.
   */
  | "ordinary-language";

/** Fixed order for stable, diffable output. Carries NO precedence meaning and
 *  must never be read as one -- nothing in this system ranks readings. */
export const INTERPRETATION_ORDER: readonly InterpretationId[] = [
  "person",
  "place",
  "organization",
  "domain-terminology",
  "identifier",
  "acronym",
  "date-or-term",
  "document-title",
  "email",
  "phone",
  "ordinary-language",
];

export const INTERPRETATION_LABELS: Record<InterpretationId, string> = {
  person: "Person",
  place: "Place",
  organization: "Organization",
  "domain-terminology": "Domain terminology",
  identifier: "Identifier",
  acronym: "Acronym",
  "date-or-term": "Date or term",
  "document-title": "Document title",
  email: "Email address",
  phone: "Phone number",
  "ordinary-language": "Ordinary language",
};

/**
 * ═══════════════════ EVIDENCE SPECIFICITY CLASSES ═══════════════════
 *
 * NOT A STRENGTH ORDERING. NOT A WEIGHT. A class describes WHAT SHAPE OF
 * CLAIM the evidence makes, which is a different and more durable question
 * than how much to trust it.
 *
 * The distinction is the whole reason this pass exists as architecture rather
 * than as tuning. Consider three facts that a naive design would treat alike:
 *
 *     "the exact phrase `motion for summary judgment`
 *      is attested legal terminology"          -> exact-phrase-attestation
 *
 *     "the tokens `ABE` and `YARBROUGH` compose
 *      into a first-name/surname pattern"      -> compositional-structure
 *
 *     "the token `Major` occurs somewhere in
 *      Census name data"                       -> token-membership
 *
 * These fail in systematically different ways, and the failure mode is a
 * property of the CLASS, not of the dataset. That means a future policy layer
 * can write ONE rule about `token-membership` instead of seven rules about
 * seven families, and that rule stays correct when a ninth family lands.
 *
 * Each class below records its known failure mode as data, because those
 * failure modes were measured at real cost and re-deriving them later would
 * mean re-measuring them.
 */
export type SignalClass =
  /** The detector assigned a type structurally (email, phone, CIN shape). */
  | "detector-assertion"
  /** An external curated dataset attests THIS EXACT PHRASE. */
  | "exact-phrase-attestation"
  /** A DocScrub-curated lexicon recognizes this surface form. */
  | "lexicon-recognition"
  /** The phrase's PARTS compose into a pattern a dataset attests. */
  | "compositional-structure"
  /** Some or every TOKEN could occur as this kind of thing somewhere. */
  | "token-membership"
  /** The observed form RESEMBLES a form attested elsewhere. */
  | "variant-form"
  /** This occurrence's neighbourhood in the document indicates the reading. */
  | "occurrence-context"
  /** This candidate behaves like the reading across the whole document. */
  | "document-consistency";

export interface SignalClassDescriptor {
  id: SignalClass;
  /** What a signal of this class actually claims. */
  claim: string;
  /**
   * The way this class is known to be wrong, measured rather than imagined.
   * Recorded so a policy layer inherits the finding instead of rediscovering
   * it at the same cost.
   */
  knownFailureMode: string;
  /**
   * True when the claim is assembled from parts of the candidate rather than
   * matched against the candidate whole. Compositional claims can fire on
   * phrases no dataset contains -- `Good Morning` parses as a Census name
   * structure -- which a whole-phrase match structurally cannot do.
   */
  compositional: boolean;
}

export const SIGNAL_CLASSES: Record<SignalClass, SignalClassDescriptor> = {
  "detector-assertion": {
    id: "detector-assertion",
    claim: "The detector assigned this type from the string's own structure.",
    knownFailureMode:
      "Structural detection is only as good as the pattern; it says nothing about the referent. Reliable for email/phone/CIN, which is the only place it is used.",
    compositional: false,
  },
  "exact-phrase-attestation": {
    id: "exact-phrase-attestation",
    claim: "A named external authority published this exact phrase as belonging to its vocabulary.",
    knownFailureMode:
      "Every pack is an explicitly partial vocabulary, so a MISS means nothing at all. And attestation is a claim about the PHRASE, never the referent: `Doe`, `Levy` and `Judge` are attested legal terminology and are also surnames.",
    compositional: false,
  },
  "lexicon-recognition": {
    id: "lexicon-recognition",
    claim: "A DocScrub-curated lexicon recognizes this surface form.",
    knownFailureMode:
      "Curated by DocScrub rather than by an external authority, so coverage gaps are ours. `Chriztopher Johnson` is a real person no lexicon contains.",
    compositional: false,
  },
  "compositional-structure": {
    id: "compositional-structure",
    claim: "The candidate's parts compose into a pattern the dataset attests, in the order observed.",
    knownFailureMode:
      "Composition can succeed on phrases no dataset contains. `Good Morning` reads as an ambiguous-role personal-name structure because GOOD is an attested first name and MORNING is attested in both roles. Measured at 20/106 on one live document -- which is why Census structure is sound for PROTECTION and unsound for CLASSIFICATION.",
    compositional: true,
  },
  "token-membership": {
    id: "token-membership",
    claim: "One or more tokens of the candidate occur somewhere in a dataset of this kind.",
    knownFailureMode:
      "THE WEAKEST CLAIM IN THE SYSTEM, and the source of the dominant collision population. Measured: any-attested-token protects 30/30 people AND 80/106 non-people -- protecting nearly everything, which is the same as protecting nothing. 187 of 779 single-token phrases in the terminology universe collide this way (`Major`, `White`, `Course`, `Session`, `Race`).",
    compositional: true,
  },
  /*
   * VARIANT FORM (AG, 2026-08-10). Its own class rather than a flavour of
   * `token-membership`, because the claim shape is genuinely different: token
   * membership says "this exact string appears in a list"; a variant says
   * "this string does NOT appear in the list but resembles something that
   * does". Folding the second into the first would erase the distinction
   * Phase A exists to preserve, and would make the two indistinguishable to
   * any future policy -- which is the one thing that must not happen, since
   * inherited evidence and direct evidence deserve different treatment.
   */
  "variant-form": {
    id: "variant-form",
    claim:
      "The observed form is orthographically close to a form attested elsewhere. It is a claim about two strings -- never that the observed form is wrong, corrected, or intended to be the other.",
    knownFailureMode:
      "The reference corpus is dense enough that closeness stops being informative as tokens get shorter: measured against 195,310 Census tokens, a one-edit budget matches 19.0 neighbours on average at length 4 versus 2.0 at length 8, and 100% of ordinary English words at length 3-4. Phonetic variants were rejected outright for the same reason at a larger scale -- Double Metaphone finds CHRIZTOPHER~CHRISTOPHER, and 460 others with it.",
    compositional: true,
  },
  "occurrence-context": {
    id: "occurrence-context",
    claim: "The text around at least one occurrence indicates this reading.",
    knownFailureMode:
      "Neighbourhood claims go ambient in corpora where the neighbourhood is uniform: in an email corpus, proximity to an address or a signature block is near-universal. `email_address_evidence` and `signature_or_email_header_context` were both falsified this way and are excluded from the person-protection gate for it.",
    compositional: false,
  },
  "document-consistency": {
    id: "document-consistency",
    claim: "This candidate behaves like this reading across the document as a whole.",
    knownFailureMode:
      "Needs a document large enough to have population statistics, and reports how a phrase is USED rather than what it is. Cross-candidate usage rules were observed firing on `Academic Senate`, `Computer Science` and `San Diego`.",
    compositional: false,
  },
};

/** Declaration order, for stable output. NOT a ranking. */
export const SIGNAL_CLASS_ORDER: readonly SignalClass[] = [
  "detector-assertion",
  "exact-phrase-attestation",
  "lexicon-recognition",
  "compositional-structure",
  "token-membership",
  "variant-form",
  "occurrence-context",
  "document-consistency",
];

/**
 * ═══════════════════ EVIDENCE LINEAGE ═══════════════════
 *
 * The UNDERLYING BODIES OF FACT a signal is derived from. Two signals whose
 * lineages intersect are NOT independent corroboration, however different
 * they look.
 *
 * ═══════════ WHY THIS EXISTS: A MEASURED FAILURE, NOT A TIDINESS URGE ═══════════
 *
 * Phase B (2026-08-10) measured, over 139 real candidates with human readings,
 * what each evidence class and each co-occurring PAIR says about a person
 * reading. The result that forced this field:
 *
 *     compositional-structure alone        39% are people
 *     token-membership alone               49% are people
 *     compositional-structure + BOTH       42% are people   <- LIFT: -7 points
 *
 * Two signals, one corpus. Census name STRUCTURE is computed FROM the same
 * per-token roles that token membership reports, so their co-occurrence is
 * not two independent witnesses agreeing -- it is one witness speaking twice,
 * and the pair is measurably WORSE than the better single part. Any combiner
 * that counted them as corroboration would manufacture confidence from
 * nothing. 31 of 139 units carry exactly that pair.
 *
 * The same applies to variant-form evidence, whose matched target is itself a
 * Census form, and to GNIS place evidence, which consults Census internally
 * for its Policy B suppression.
 *
 * ═══════════ WHAT THIS IS NOT ═══════════
 *
 * Not a weight, not a discount factor, not an input to any score. It is a
 * declaration of WHERE a fact came from, so that a future combination layer
 * can ask "are these independent?" and get a correct answer instead of
 * assuming one. Nothing in the current tree reads it.
 */
export type EvidenceLineage =
  /** The bundled U.S. Census name corpus. */
  | "us-census-name-corpus"
  /** The USGS GNIS domestic names corpus. */
  | "usgs-gnis-corpus"
  /** DocScrub's own curated quality lexicons and dictionaries. */
  | "docscrub-quality-lexicons"
  /** A bundled external domain terminology pack (one per family). */
  | "domain-terminology-pack"
  /** The detector's structural assertion about the string. */
  | "detector-assertion"
  /** The surrounding text of one or more occurrences in this document. */
  | "document-occurrence-context"
  /** The population of candidates in this document. */
  | "document-candidate-population";

/**
 * One observation supporting one reading.
 *
 * `signalId` is stable and greppable -- it is the thing to search for when a
 * class of interpretations turns out to be wrong, the same discipline
 * `AutomaticResolution.ruleId` established.
 */
export interface InterpretationSignal {
  /** Stable id, `<interpretation>/<observation>`. */
  signalId: string;
  class: SignalClass;
  /** What was observed, in reviewer-readable words. Never a verdict. */
  detail: string;
  /**
   * Where the observation came from: the evidence family, engine or rule.
   * Kept so the determination path survives into the profile rather than
   * having to be re-derived from the candidate.
   */
  provenance: string;
  /**
   * REQUIRED, deliberately. Every signal must declare what body of fact it
   * rests on, because the signal that silently omits it is precisely the one a
   * future combiner would miscount. Usually one entry; more than one means the
   * signal itself already depends on several sources (GNIS place evidence
   * depends on both the GNIS corpus and Census).
   */
  lineage: readonly EvidenceLineage[];
}

/**
 * Do these two signals rest on any common body of fact?
 *
 * TRUE means they are NOT independent corroboration. The intended use is a
 * guard in whatever combination layer is eventually built:
 *
 *     if (sharesLineage(a, b)) -> these are one witness, not two
 *
 * Nothing calls it today. It exists so the measured finding above is available
 * as a predicate rather than as a paragraph in a findings document.
 */
export function sharesLineage(a: InterpretationSignal, b: InterpretationSignal): boolean {
  return a.lineage.some((l) => b.lineage.includes(l));
}

/**
 * Partitions signals into groups that are mutually independent -- i.e. the
 * maximum number of genuinely separate witnesses among them.
 *
 * Returns groups of signals sharing lineage; the GROUP COUNT is the honest
 * answer to "how many independent things do we know here", which is almost
 * always smaller than the signal count. Read-only, and used by the
 * investigation harness rather than by any decision.
 */
export function independentWitnessGroups(signals: readonly InterpretationSignal[]): InterpretationSignal[][] {
  const groups: InterpretationSignal[][] = [];
  for (const signal of signals) {
    const existing = groups.find((group) => group.some((member) => sharesLineage(member, signal)));
    if (existing) existing.push(signal);
    else groups.push([signal]);
  }
  return groups;
}

/**
 * One supported reading, with everything that supports it.
 *
 * `domain` is populated only for `domain-terminology`, and there is ONE ENTRY
 * PER ATTESTING FAMILY rather than one merged terminology entry. Legal and
 * Finance both attesting `ADR` is two readings, not one reading with two
 * sources -- collapsing them would destroy precisely what the collision audit
 * measured.
 */
export interface SupportedInterpretation {
  id: InterpretationId;
  /** Evidence-family id for `domain-terminology`; absent otherwise. */
  domain?: string;
  /** Every supporting observation, in derivation order. Never empty -- an
   *  interpretation with no support is simply not present. */
  signals: readonly InterpretationSignal[];
}

/**
 * ═══════════════════ TWO KINDS OF NOT-KNOWING ═══════════════════
 *
 * A review product must be able to tell these apart, because they call for
 * completely different handling and look identical in a single-type model:
 *
 *   unsupported  "we have no affirmative evidence about this at all"
 *   contested    "we have affirmative evidence for two different readings"
 *
 * The first is thin evidence. The second is genuine ambiguity, and it is a
 * legitimate CONCLUSION rather than a failure to conclude.
 */
export type InterpretationOutcome = "unsupported" | "single" | "contested";

/** Everything this layer concluded about one candidate. Data only. */
export interface InterpretationProfile {
  candidateId: string;
  /** The candidate's display value, verbatim. Never rewritten. */
  value: string;
  /** Derived purely from `interpretations.length`. No rule produces it. */
  outcome: InterpretationOutcome;
  /** In INTERPRETATION_ORDER. Empty exactly when outcome is "unsupported". */
  interpretations: readonly SupportedInterpretation[];
}

/* ─────────────────────────── read-only helpers ───────────────────────────
 *
 * Deliberately functions rather than stored fields. A stored `contestsPerson`
 * boolean sitting on the profile is one refactor away from being read as a
 * decision; a helper is obviously a question the caller asked.
 */

export function interpretationIdsOf(profile: InterpretationProfile): InterpretationId[] {
  return profile.interpretations.map((i) => i.id);
}

/** Distinct signal classes supporting one reading, in SIGNAL_CLASS_ORDER. */
export function signalClassesOf(interpretation: SupportedInterpretation): SignalClass[] {
  const present = new Set(interpretation.signals.map((s) => s.class));
  return SIGNAL_CLASS_ORDER.filter((c) => present.has(c));
}

/** Every class supporting a reading is compositional or token-level -- i.e.
 *  nothing whole-phrase, nothing contextual, nothing document-level backs it.
 *  A DESCRIPTION, not a threshold: no rule here acts on it. */
export function restsOnlyOnCompositionalSignals(interpretation: SupportedInterpretation): boolean {
  if (interpretation.signals.length === 0) return false;
  return interpretation.signals.every((s) => SIGNAL_CLASSES[s.class].compositional);
}

/** Does the contest involve the `person` reading? The privacy-consequential
 *  subset, isolated so it can be counted -- it decides nothing here. */
export function contestsPerson(profile: InterpretationProfile): boolean {
  return profile.outcome === "contested" && profile.interpretations.some((i) => i.id === "person");
}

/** A stable, sortable description of the contest -- `person+place`,
 *  `person+domain-terminology`. Used for grouping in diagnostics and for
 *  naming witness populations. Never parsed to make a decision. */
export function contestKey(profile: InterpretationProfile): string {
  return [...new Set(interpretationIdsOf(profile))].join("+");
}

/** Derives the outcome. The ONLY place outcome is computed, so "ambiguity is
 *  deterministic" is a property of one line rather than of a convention. */
export function outcomeFor(interpretations: readonly SupportedInterpretation[]): InterpretationOutcome {
  if (interpretations.length === 0) return "unsupported";
  return interpretations.length === 1 ? "single" : "contested";
}
