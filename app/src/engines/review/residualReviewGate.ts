/**
 * residualReviewGate.ts -- THE ONE PLACE a detected candidate becomes
 * residual human review work (AG, 2026-08-09, Phase 2).
 *
 * ============================ THE INVARIANT ============================
 * Item Check should contain what DocScrub still needs the human to decide,
 * not every candidate the detector produced.
 * =======================================================================
 *
 * WHAT WAS WRONG. `itemIdsForStage("item-check")` returns
 * `detection.candidates` unfiltered; the only narrowing anywhere is
 * "remove what already carries a decision". Upstream stages subtract what
 * they DECIDED and never what they KNOW -- so DocScrub classifies "The" as
 * a common word, routes it to a section on that basis, renders a one-key
 * accept for it, and then asks the reviewer anyway. On the live document
 * roughly a third of the queue was material of that kind.
 *
 * ---------------------------------------------------------------------
 * WHY THIS IS A GATE AND NOT A PRUNER
 * ---------------------------------------------------------------------
 *
 * Nothing here deletes a candidate. The gate emits AutomaticResolution
 * records -- explicit, provenanced, reversible -- and the candidate remains
 * in the detection inventory, in the audit, and inspectable. Andrew's
 * constraint, verbatim: "I want fewer human judgments, not hidden detector
 * output."
 *
 * The product-principle clarification this implements: DocScrub still makes
 * no automatic reviewer DECISIONS; it may produce automatic RESOLUTIONS
 * when it has sufficient evidence that no meaningful human judgment
 * remains. See domain/ReviewSession.ts's AutomaticResolution.
 *
 * ---------------------------------------------------------------------
 * WHY IT CONSUMES EVIDENCE RATHER THAN CLASSIFYING
 * ---------------------------------------------------------------------
 *
 * "Item Check must not accumulate its own parallel classification engine"
 * (AG). So this module owns NO dictionaries, NO word lists and NO
 * detectors. It is a decision procedure over evidence other stages already
 * computed -- quality categories, the recommendation archetype, contextual
 * person evidence, occurrence counts. If it ever needs a new fact about a
 * candidate, that fact belongs in whichever engine already owns that
 * question, not here.
 *
 * That constraint is also what makes the gate auditable: every `evidence`
 * string it emits is a restatement of something an existing engine
 * concluded, so a reviewer disputing a resolution is disputing a specific
 * upstream claim rather than an opaque heuristic.
 *
 * ---------------------------------------------------------------------
 * THE ONE RULE IN THIS PASS, AND ITS GUARDS
 * ---------------------------------------------------------------------
 *
 * `ordinary-language`: a single-token, person-typed candidate whose every
 * occurrence looks like ordinary prose and which carries NO evidence of
 * person use, resolves to Keep -- leave the text alone.
 *
 * Keep, never Ignore: "Ignore" asserts the text is not PII, which is a
 * claim about the world. "Keep" asserts only that the text should be left
 * as it is, which is all the evidence supports and all the reviewer would
 * have done. The narrower claim is the honest one.
 *
 * FIVE GUARDS, each of which alone sends the candidate to review. They are
 * written as disqualifiers rather than as a score, because the failure this
 * gate must not have is a plausible-looking aggregate quietly resolving a
 * real name:
 *
 *   1. NOT SINGLE-TOKEN -> review. Multi-token phrases are where
 *      institutional names, headings and real full names live.
 *   2. ANY known-name evidence -> review. This is the `Amy` / `May` /
 *      `Will` / `Fox` / `Collier` guard: a surface form that overlaps
 *      ordinary vocabulary is NOT eligible if anything recognized it as a
 *      name. Ordinary-word status alone never suppresses.
 *   3. ANY contextual person evidence on ANY occurrence -> review. One
 *      "Dear Rose," or "Rose said" in a hundred uses of the flower is
 *      enough. This is the MIXED-USE guard, and it is deliberately
 *      all-or-nothing at candidate granularity: DocScrub cannot split one
 *      candidate's occurrences into two dispositions, so the only honest
 *      move is to leave the whole thing reviewable.
 *   4. NO positive ordinary-language evidence -> review. Absence of person
 *      evidence is not presence of ordinary-language evidence. A candidate
 *      nothing recognized at all is unknown, not ordinary, and unknown
 *      material is exactly what a reviewer is for.
 *   5. ALREADY decided or resolved -> untouched. The gate never overwrites
 *      anyone, including itself.
 *
 * Pure and DOM-free; every rule is a function of the facts passed in.
 */

import type { AutomaticResolution } from "../../domain/ReviewSession.js";
import {
  INSTITUTIONAL_WITNESS_CATEGORIES,
  buildFullNameTokenIndex,
  documentNameEvidenceFor,
} from "./documentNameEvidence.js";

/**
 * Everything the gate is allowed to know about one candidate, assembled by
 * the caller from engines that already computed it.
 *
 * Deliberately a flat record of CONCLUSIONS rather than the candidate plus
 * its engines: a gate that could reach back into the pipeline would grow
 * its own classification logic by increments, which is the outcome this
 * design exists to prevent.
 */
export interface GateFacts {
  candidateId: string;
  /** Detector's type: only "person" is in scope for this pass. */
  detectedType: string;
  /** Whitespace-delimited token count of the display value. */
  tokenCount: number;
  /** Quality categories already assigned upstream (scoring.ts). */
  qualityCategories: readonly string[];
  /**
   * True when ANY occurrence carries contextual evidence of person use --
   * a title, a salutation, a possessive, a verb of speech. Computed by
   * contextual-person-evidence; the gate only asks whether it fired.
   */
  hasContextualPersonEvidence: boolean;
  /**
   * True when a name lexicon, alias table or related-name provider
   * recognized this surface form. The Amy/May/Will guard.
   */
  hasKnownNameEvidence: boolean;
  /** True when the reviewer or an import already settled it. */
  hasExistingDecision: boolean;
  /** True when an automatic resolution already exists. */
  hasExistingAutomaticResolution: boolean;
}

export type GateOutcome =
  /** Belongs in Item Check: a human judgment genuinely remains. */
  | { kind: "review"; because: string }
  /** DocScrub can settle it, with provenance. */
  | { kind: "resolve"; resolution: Omit<AutomaticResolution, "resolvedAt"> };

/**
 * Categories that constitute POSITIVE evidence of ordinary language.
 *
 * This MUST equal ui/recommendations.ts's COMMON_WORD_CATEGORIES -- the same
 * vocabulary that already routes these candidates to a "Common English
 * Words" section, so the gate and the screen cannot disagree about what
 * "ordinary word" means. It is duplicated rather than imported only because
 * engines/ must not depend on ui/; the equality is asserted by
 * verify/residual-review-gate-verification.ts against the real list, so the
 * copy cannot silently drift the way the name-category list did.
 */
export const ORDINARY_LANGUAGE_CATEGORIES: readonly string[] = [
  "expanded-common-language-token",
  "common-english-word",
  "common-verb",
  "frequency-saturated",
  "all-common-dictionary-words",
  "greeting-or-courtesy",
  "pronoun-or-determiner",
  "interjection-casual",
  "sentence-fragment",
  "sentence-fragment-word",
];

/*
 * THERE IS NO KNOWN_NAME_CATEGORIES CONSTANT HERE, DELIBERATELY.
 *
 * A first draft of this module declared one -- and got it wrong: it guessed
 * ["known-first-name", "known-surname", "known-full-name", ...] while the
 * real list (ui/recommendations.ts) is ["known-personal-name-token",
 * "known-first-name", "known-name-structure"]. Only one of six invented
 * names existed, so the Amy/May/Will guard would have been almost entirely
 * inert while looking correct in review.
 *
 * That is precisely the "parallel classification engine" failure this
 * module's header forbids, reached in the module that forbids it. The
 * lesson is structural rather than a reminder to be careful: the gate takes
 * `hasKnownNameEvidence` as an injected BOOLEAN, computed by the caller
 * from `recommendations.hasKnownNameEvidence()` -- the same predicate the
 * archetype derivation and the sectioning already use. One definition, one
 * answer, no opportunity to drift.
 */

export const ORDINARY_LANGUAGE_RULE_ID = "residual-gate/ordinary-language";

function hasAny(categories: readonly string[], wanted: readonly string[]): boolean {
  return categories.some((c) => wanted.includes(c));
}

/**
 * The gate. One candidate in, one outcome out.
 *
 * Every `review` outcome carries `because`, so a future "why is this still
 * here?" has an answer without re-deriving it -- the same reasoning that
 * made `evidence` mandatory on the resolution side.
 */
export function evaluateCandidate(facts: GateFacts): GateOutcome {
  // 5. Never touch anything already settled, by anyone including this gate.
  if (facts.hasExistingDecision) return { kind: "review", because: "already carries a decision" };
  if (facts.hasExistingAutomaticResolution) return { kind: "review", because: "already automatically resolved" };

  // Scope: this pass handles person-typed material only. Identifiers,
  // emails and phones are protective detections whose disposition is
  // genuinely the reviewer's.
  if (facts.detectedType !== "person") return { kind: "review", because: `detected type ${facts.detectedType} is out of scope for this gate` };

  // 1. Multi-token phrases are out of scope.
  if (facts.tokenCount !== 1) return { kind: "review", because: "multi-token phrase" };

  // 2. THE NAME-COLLISION GUARD. Amy, May, Will, Mark, Rose, Fox, Collier.
  if (facts.hasKnownNameEvidence) return { kind: "review", because: "recognized as a name despite overlapping ordinary vocabulary" };

  // 3. THE MIXED-USE GUARD. One person-like occurrence keeps the whole
  //    candidate reviewable.
  if (facts.hasContextualPersonEvidence) return { kind: "review", because: "at least one occurrence shows contextual evidence of person use" };

  // 4. Positive ordinary-language evidence is REQUIRED, not inferred from
  //    the absence of person evidence.
  const ordinary = facts.qualityCategories.filter((c) => ORDINARY_LANGUAGE_CATEGORIES.includes(c));
  if (ordinary.length === 0) return { kind: "review", because: "no positive ordinary-language evidence; unrecognized material is a reviewer question" };

  return {
    kind: "resolve",
    resolution: {
      candidateId: facts.candidateId,
      resolution: "Keep",
      ruleId: ORDINARY_LANGUAGE_RULE_ID,
      reason: "Ordinary language: no occurrence shows evidence of use as a person or entity.",
      evidence: [
        "single token",
        `ordinary-language evidence: ${ordinary.join(", ")}`,
        "no name-lexicon match",
        "no contextual person evidence on any occurrence",
      ],
    },
  };
}

export interface GateRun {
  resolutions: AutomaticResolution[];
  /** Candidates that remain human work, with the reason each survived. */
  retained: Array<{ candidateId: string; because: string }>;
}

/** Runs the gate over a document's candidates. `now` is injected so the
 *  result is deterministic under test. */
export function runResidualReviewGate(facts: readonly GateFacts[], now: string): GateRun {
  const resolutions: AutomaticResolution[] = [];
  const retained: Array<{ candidateId: string; because: string }> = [];
  for (const f of facts) {
    const outcome = evaluateCandidate(f);
    if (outcome.kind === "resolve") resolutions.push({ ...outcome.resolution, resolvedAt: now });
    else retained.push({ candidateId: f.candidateId, because: outcome.because });
  }
  return { resolutions, retained };
}

/**
 * Assembles GateFacts from the pipeline's own outputs.
 *
 * THE ONLY PLACE THAT KNOWS HOW TO READ THE PIPELINE, so the gate itself
 * stays a decision procedure over conclusions. Each derivation below is a
 * restatement of an existing one, cited so a reader can check it rather
 * than trust it:
 *
 *   categories   assessment.filterRules, else assessment.reasons -- exactly
 *                ui/app.ts's candidateCategories(). Underscores normalized
 *                to hyphens, matching recommendations.ts's `norm`, because
 *                the quality engine emits both spellings.
 *   name evidence  the three categories recommendations.ts's
 *                KNOWN_NAME_CATEGORIES actually contains. Passed as a
 *                boolean so the gate cannot grow its own copy -- see the
 *                note in this file where that constant deliberately is not.
 *   contextual   whether the contextual-person-evidence pass actually FIRED
 *                a rule for this candidate -- `rules.length > 0`.
 *
 *                NOT the presence of the record. The pass emits an entry for
 *                every candidate it examined, including ones with zero
 *                evidence ("The" comes back as
 *                {rules: [], contribution: 0, occurrencesWithoutEvidence: 2}).
 *                A first version of this adapter tested
 *                `byCandidate[id] !== undefined` and was therefore true for
 *                every candidate in the document, which made the whole gate
 *                inert: it resolved nothing, on any fixture, while every
 *                unit test passed -- because the tests inject the boolean
 *                directly and never exercised the adapter.
 *
 *                Recorded here rather than quietly fixed: "any evidence at
 *                all" is still the intended bar (the gate should refuse on
 *                the faintest person signal), and `rules.length > 0` is what
 *                that actually means. `contribution > 0` would be equivalent
 *                today; the rule list is used because it is the thing the
 *                pass is documented to populate.
 */
export interface GateInputs {
  candidates: ReadonlyArray<{ id: string; displayValue: string; detectedType: string }>;
  assessmentByCandidate: Readonly<Record<string, { filterRules: string[]; reasons: string[] } | undefined>>;
  /** The contextual pass's `byCandidate` map. Entries exist for candidates
   *  with NO evidence too, so callers must read `rules`, not presence. */
  contextualByCandidate: Readonly<Record<string, { rules?: readonly string[] } | undefined>>;
  decidedCandidateIds: ReadonlySet<string>;
  automaticallyResolvedIds: ReadonlySet<string>;
  /**
   * DOCUMENT-DERIVED NAME EVIDENCE (AG, 2026-08-09). Candidate ids carrying
   * an ambiguity proposal, and ids that are members of a proposed entity
   * group. Optional so existing callers and tests keep compiling; absent
   * means "entity resolution has not run", which is honest rather than
   * silently weakening the guard -- the static lexicon still applies.
   */
  ambiguityProposalCandidateIds?: ReadonlySet<string>;
  entityGroupMemberIds?: ReadonlySet<string>;
}

/** The three categories recommendations.ts's KNOWN_NAME_CATEGORIES holds.
 *  Duplicated for the same layering reason as ORDINARY_LANGUAGE_CATEGORIES,
 *  and pinned against the real list by the verification suite. */
export const NAME_EVIDENCE_CATEGORIES: readonly string[] = [
  "known-personal-name-token",
  "known-first-name",
  "known-name-structure",
];

const normalizeCategory = (category: string): string => category.replace(/_/g, "-");

export function buildGateFacts(inputs: GateInputs): GateFacts[] {
  /*
   * DOCUMENT-DERIVED NAME EVIDENCE, built once (AG, 2026-08-09).
   *
   * The static lexicon holds 23 given names and 5 surnames, all of them the
   * cast of one sample document, so `Agnes` -- a real first name that also
   * sits in the expanded-common-language dictionary -- carried no name
   * evidence and was automatically resolved on the live run.
   *
   * The fix is the one ui/recommendations.ts already prescribed: use the
   * evidence entity resolution computes about THIS document. See
   * documentNameEvidence.ts for the three sources and why the token index
   * only accepts multi-token PERSON candidates as witnesses.
   *
   * OR'd with the lexicon rather than replacing it: the lexicon is small but
   * not wrong, and a document that names nobody twice should still keep its
   * listed names.
   */
  const categoriesOf = (candidateId: string): string[] => {
    const a = inputs.assessmentByCandidate[candidateId];
    if (!a) return [];
    return (a.filterRules.length ? a.filterRules : a.reasons).map(normalizeCategory);
  };
  /*
   * WITNESS ELIGIBILITY (AG, 2026-08-09). Both predicates read the SAME
   * category vocabulary this file already uses to make its own decisions --
   * the institutional list documentNameEvidence.ts owns, and rule 4's
   * ORDINARY_LANGUAGE_CATEGORIES. Nothing new is introduced here; the second
   * predicate simply applies the gate's existing judgement about ordinary
   * language one level up, to the phrase acting as a witness rather than to
   * the candidate being judged. See buildFullNameTokenIndex's note.
   */
  const fullNameTokens = buildFullNameTokenIndex(inputs.candidates, {
    isInstitutionalPhrase: (candidateId) =>
      categoriesOf(candidateId).some((c) => INSTITUTIONAL_WITNESS_CATEGORIES.includes(c)),
    carriesOrdinaryLanguageEvidence: (candidateId) =>
      categoriesOf(candidateId).some((c) => ORDINARY_LANGUAGE_CATEGORIES.includes(c)),
  });
  const nameEvidenceInputs = {
    ambiguityProposalCandidateIds: inputs.ambiguityProposalCandidateIds ?? new Set<string>(),
    entityGroupMemberIds: inputs.entityGroupMemberIds ?? new Set<string>(),
  };
  return inputs.candidates.map((candidate) => {
    const assessment = inputs.assessmentByCandidate[candidate.id];
    const raw = assessment ? (assessment.filterRules.length ? assessment.filterRules : assessment.reasons) : [];
    const categories = raw.map(normalizeCategory);
    return {
      candidateId: candidate.id,
      detectedType: candidate.detectedType,
      tokenCount: candidate.displayValue.trim().split(/\s+/).filter(Boolean).length,
      qualityCategories: categories,
      hasContextualPersonEvidence: (inputs.contextualByCandidate[candidate.id]?.rules?.length ?? 0) > 0,
      hasKnownNameEvidence:
        categories.some((c) => NAME_EVIDENCE_CATEGORIES.includes(c)) ||
        documentNameEvidenceFor(candidate, nameEvidenceInputs, fullNameTokens).has,
      hasExistingDecision: inputs.decidedCandidateIds.has(candidate.id),
      hasExistingAutomaticResolution: inputs.automaticallyResolvedIds.has(candidate.id),
    };
  });
}

/** Grouped counts by rule, for the measurement Andrew asked for. */
export function resolutionsByRule(resolutions: readonly AutomaticResolution[]): Array<{ ruleId: string; count: number }> {
  const counts = new Map<string, number>();
  for (const r of resolutions) counts.set(r.ruleId, (counts.get(r.ruleId) ?? 0) + 1);
  return [...counts.entries()].map(([ruleId, count]) => ({ ruleId, count })).sort((a, b) => b.count - a.count);
}
