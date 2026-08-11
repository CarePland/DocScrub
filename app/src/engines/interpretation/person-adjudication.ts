/**
 * person-adjudication.ts -- does the Person evidence on this candidate say
 * anything about the CANDIDATE, or only about a token inside it?
 * (AG, 2026-08-10)
 *
 * ═══════════════════ THE PROBLEM THIS ADDRESSES ═══════════════════
 *
 * The production diagnostic reports Person supported on 273 of 601 candidates.
 * Person claims too many. But the fix is NOT a combination engine -- that was
 * investigated and rejected, because no measured combination beat its parts
 * and correlated signals masqueraded as corroboration.
 *
 * The question here is narrower and different:
 *
 *     what does each Person signal CLAIM, and about WHAT?
 *
 * ═══════════════════ THE DISTINCTION THAT DOES THE WORK ═══════════════════
 *
 * Person signals are not all claims about the same THING:
 *
 *   candidate-span   about the WHOLE extracted span. `censusNameEvidenceFor`
 *                    tests the first and last token for agreeing first/surname
 *                    roles; anchor rules require FULL_NAME_SHAPE_RE of the
 *                    candidate itself before firing.
 *
 *   component        about one or more TOKENS INSIDE the span. `scoring.ts`
 *                    sets `known_personal_name_token` by iterating tokens and
 *                    BREAKING ON THE FIRST MATCH -- literally "some token is a
 *                    known given name". Census token membership fires when
 *                    every token appears somewhere in name data.
 *
 *   neighbourhood    about text AROUND the span (a nearby honorific, a
 *                    grammatical role).
 *
 *   inherited        from a DIFFERENT candidate (entity linkage).
 *
 * A component-level claim SURVIVES A WRONG SPAN. `If Joan` earns
 * `known_personal_name_token` because `Joan` is a known given name. That claim
 * is true, and it is not a claim about `If Joan`.
 *
 * ═══════════════════ WHAT IS AND IS NOT IMPLEMENTED ═══════════════════
 *
 * ONE rule ships. Five others were measured over 182 candidates (43 named
 * production witnesses + the 139-unit residue) and REJECTED, each with the
 * real people it would have cost:
 *
 *   P-1 span-evidence-required      27 removed, 4 REAL PEOPLE LOST
 *                                   (Perias, Nelly; Chriztopher Johnson;
 *                                    Fox, Liud)
 *   P-2 token-membership-alone      30 removed, 2 REAL PEOPLE LOST
 *                                   (Chelsey, Agnes -- both DocScrub lexicon
 *                                    coverage gaps, not semantic errors)
 *   P-3 ordinary-language-demotes   23 removed, 10 REAL PEOPLE LOST
 *                                   (Andrew, Margaret, Patrick, Joan, Julie,
 *                                    Diana, Sarah, Christopher, Will Diana,
 *                                    Agnes). Ordinary-language overlap is not
 *                                   anti-Person evidence, and this is what
 *                                   assuming otherwise costs.
 *   P-4 place-demotes                4 removed, 0 lost -- REJECTED ANYWAY.
 *                                   It is "Place beats Person", a semantic
 *                                   priority table. 35,174 GNIS keys carry
 *                                   Census personal-name structure, so it is
 *                                   categorically wrong at scale even though
 *                                   it looks clean on four witnesses.
 *   P-5 single-witness-component    26 removed, 4 REAL PEOPLE LOST
 *
 * ═══════════════════ WHY P-6 SURVIVED ═══════════════════
 *
 * Measured: 17 Person readings removed, **0 real people lost**, 17 non-people
 * removed -- `New Student`, `Last Date`, `Start Date`, `End Date`, `Class
 * Level`, `Staff Course`, `Grade Pro`, `Grad App`, `First Fight`, `Stern
 * Mass`, `Records Team`, `Staff Run Query`...
 *
 * It is not curve-fitting. The semantic argument stands on its own: Census
 * token membership is a claim about tokens, and for a multi-token candidate it
 * says nothing whatever about whether the SPAN is a name. Every real person in
 * the measured population that is multi-token also carries either
 * candidate-span structure or a name-lexicon match, so the rule never reaches
 * them.
 *
 * AND IT IS MONOTONE-SAFE AGAINST THE EVIDENCE THIS INVESTIGATION COULD NOT
 * SEE. `occurrence-context` and `document-consistency` are active in
 * production and absent from every harness available offline. The rule
 * requires that EVERY Person signal be token membership, so any additional
 * signal -- of any kind, from any channel -- makes it stop firing. Missing
 * evidence can only cause it to over-fire in measurement, never in production.
 *
 * ═══════════════════ THIS IS INERT ═══════════════════
 *
 * Nothing calls this. It is not wired to routing, recommendations, the
 * protection gate, entity grouping, automatic resolution or the console
 * diagnostic -- the last because `src/ui/app.ts` is under concurrent edit by
 * another workstream and this pass will not touch it.
 *
 * So this changes NO behaviour, and in particular it does NOT reduce Person
 * review burden. Doing that requires consuming the interpretation profile in
 * routing, which is a separate product decision.
 *
 * ═══════════════════ WHAT THIS MUST NEVER BECOME ═══════════════════
 *
 *   NO SEMANTIC PRIORITY TABLE. This never says one interpretation beats
 *   another. P-4 was rejected precisely for being that.
 *
 *   NO CONFIDENCE, NO WEIGHTS, NO SCORES. Rejected in the previous pass and
 *   not reintroduced here under a Person-shaped name.
 *
 *   NO NEGATIVE EVIDENCE FROM ABSENCE. Not in Census is not "not a person";
 *   no contextual support is not "not a person". The one rule here fires on
 *   the PRESENCE of a specific weak claim standing alone, never on absence.
 *
 *   NOT A GLOBAL MECHANISM. Person is specialised because personal names are
 *   unusually collision-prone. No other interpretation is asked to adopt this.
 *
 * Pure, DOM-free, deterministic; reads only already-derived evidence.
 */

import {
  independentWitnessGroups,
  type InterpretationId,
  type InterpretationProfile,
  type InterpretationSignal,
} from "./interpretation-model.js";

/** What a Person signal is a claim ABOUT. See the module header. */
export type PersonEvidenceScope = "candidate-span" | "component" | "neighbourhood" | "inherited";

/**
 * The scope of one Person signal.
 *
 * Derived from what each signal's PRODUCING CODE actually tests, not from what
 * its name suggests. For a single-token candidate the component/span
 * distinction collapses -- there is only one token and it is the span -- so
 * every signal on a single-token candidate is candidate-span.
 */
export function personEvidenceScopeOf(signal: InterpretationSignal, tokenCount: number): PersonEvidenceScope {
  const id = signal.signalId;
  if (id === "person/census-name-structure") return "candidate-span";
  if (id.startsWith("person/anchor:")) return "candidate-span";
  if (id === "person/nearby-title") return "neighbourhood";
  if (id.startsWith("person/contextual-usage:")) return "neighbourhood";
  if (id === "person/entity-linkage") return "inherited";
  if (tokenCount === 1) return "candidate-span";
  return "component";
}

/** The single shipped rule. Stable id; the thing to grep for. */
export const PERSON_RULE_MULTI_TOKEN_MEMBERSHIP_ONLY = "person-adjudication/multi-token-membership-only";

/** What the adjudication concluded, and why. Structured for verification and
 *  audit; NOT customer-facing copy. */
export interface PersonAdjudication {
  candidateId: string;
  /** Verbatim. Never rewritten. */
  value: string;
  /** False only when a named rule rejected it. Absence of a Person reading
   *  altogether is reported as `hadPersonReading: false`, which is a different
   *  thing and must not be confused with rejection. */
  personSupported: boolean;
  hadPersonReading: boolean;
  /** Distinct scopes of the Person evidence, in fixed order. */
  scopes: readonly PersonEvidenceScope[];
  /** Independent witnesses, NOT signal count. See interpretation-model. */
  independentWitnessCount: number;
  /** Stable rule id, or null when Person survived. */
  rejectedBy: string | null;
  /** Why, in engineering terms. Internal traceability, not reviewer copy. */
  reason: string;
  /** Readings that remain affirmatively supported after adjudication. */
  survivingAlternatives: readonly InterpretationId[];
  /**
   * What the system already affirmatively knows.
   *
   * `reclassify` is only proposed when EXACTLY ONE alternative is supported --
   * "not Person" implies nothing about what a candidate is, so anything else
   * is `undetermined` or stays contested. This is a PROPOSAL: nothing routes
   * on it.
   */
  disposition: "person-survives" | "reclassify" | "contested-without-person" | "undetermined";
  reclassifyTo: InterpretationId | null;
}

const SCOPE_ORDER: readonly PersonEvidenceScope[] = ["candidate-span", "component", "neighbourhood", "inherited"];

/**
 * Adjudicate the Person reading of one already-derived profile.
 *
 * `tokenCount` is passed in rather than re-derived so this module owns no
 * tokenization policy -- the same discipline the gates follow.
 */
export function adjudicatePerson(profile: InterpretationProfile, tokenCount: number): PersonAdjudication {
  const person = profile.interpretations.find((i) => i.id === "person");
  const alternatives = profile.interpretations.filter((i) => i.id !== "person").map((i) => i.id);

  const dispositionFor = (): { disposition: PersonAdjudication["disposition"]; reclassifyTo: InterpretationId | null } => {
    if (alternatives.length === 1) return { disposition: "reclassify", reclassifyTo: alternatives[0]! };
    if (alternatives.length > 1) return { disposition: "contested-without-person", reclassifyTo: null };
    return { disposition: "undetermined", reclassifyTo: null };
  };

  if (!person || person.signals.length === 0) {
    const { disposition, reclassifyTo } = dispositionFor();
    return {
      candidateId: profile.candidateId,
      value: profile.value,
      personSupported: false,
      hadPersonReading: false,
      scopes: [],
      independentWitnessCount: 0,
      rejectedBy: null,
      reason: "No Person reading was derived. This is the absence of evidence, not a rejection.",
      survivingAlternatives: alternatives,
      disposition,
      reclassifyTo,
    };
  }

  const present = new Set(person.signals.map((s) => personEvidenceScopeOf(s, tokenCount)));
  const scopes = SCOPE_ORDER.filter((s) => present.has(s));
  const independentWitnessCount = independentWitnessGroups(person.signals).length;

  /*
   * P-6, and the only rule. Every Person signal is Census token membership AND
   * the candidate has more than one token -- so nothing has made any claim
   * about the span.
   *
   * `every` is load-bearing: one additional signal of any kind, from any
   * channel, and this does not fire. That is what makes it safe against the
   * context and document-consistency evidence no offline harness can supply.
   */
  const membershipOnly =
    tokenCount > 1 && person.signals.every((s) => s.signalId === "person/census-token-membership");

  if (membershipOnly) {
    const { disposition, reclassifyTo } = dispositionFor();
    return {
      candidateId: profile.candidateId,
      value: profile.value,
      personSupported: false,
      hadPersonReading: true,
      scopes,
      independentWitnessCount,
      rejectedBy: PERSON_RULE_MULTI_TOKEN_MEMBERSHIP_ONLY,
      reason:
        `Every Person signal is Census token membership, a claim about individual tokens. ` +
        `On a ${tokenCount}-token candidate nothing has claimed that the span itself is a name.`,
      survivingAlternatives: alternatives,
      disposition,
      reclassifyTo,
    };
  }

  return {
    candidateId: profile.candidateId,
    value: profile.value,
    personSupported: true,
    hadPersonReading: true,
    scopes,
    independentWitnessCount,
    rejectedBy: null,
    reason:
      scopes.includes("candidate-span")
        ? "Person evidence includes a claim about the candidate span."
        : "Person evidence is not token membership alone; no rule rejects it.",
    survivingAlternatives: alternatives,
    disposition: "person-survives",
    reclassifyTo: null,
  };
}
