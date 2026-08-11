/**
 * proposedGroups.ts -- PROVISIONAL REVIEW COHORTS for Quick Approval
 * (AG, 2026-08-10).
 *
 * ═══════════════════ WHAT A PROPOSED GROUP CLAIMS ═══════════════════
 *
 *     DocScrub has affirmative evidence suggesting these candidates are
 *     similar enough that a reviewer may be able to process them together.
 *
 * That is the entire claim, and it is deliberately smaller than every
 * neighbouring concept:
 *
 *   NOT a semantic type       -- `SemanticTypeId` is untouched; Type Check
 *                                routing is untouched.
 *   NOT a decision            -- no `CandidateDecision` is created by
 *                                membership, by exclusion, or by completing
 *                                a scan. Only the reviewer's final bulk
 *                                action creates decisions.
 *   NOT AutomaticResolution   -- no rule fires and nothing is resolved.
 *   NOT `Unlikely`            -- every member still REQUIRES a human
 *                                decision. See the Unlikely section below;
 *                                that predicate is untouched by this file.
 *   NOT persisted truth       -- groups are recomputed from the
 *                                interpretation profiles on every consult,
 *                                exactly like `reviewZone`. Nothing about a
 *                                group is serialized.
 *
 * ═══════════════════ WHY THESE TWO GROUPS, AND NOT THE OBVIOUS ONES ═══════════════════
 *
 * The feature request named "likely Educational Terms", "likely People" and
 * "likely Organizations" as illustrative cohorts, with the instruction to
 * derive the real ones from the measured population rather than hard-code
 * the examples. That measurement was run over the real 601-candidate export
 * (`investigation/data/interpretation-population.json`, 426 candidates still
 * requiring review) and it killed two of the three:
 *
 * ── "LIKELY PEOPLE" IS NOT SUPPORTABLE, AND THIS IS THE IMPORTANT FINDING ──
 *
 * The natural rule -- "person is the only supported reading" -- yields 73
 * candidates. Against Andrew's own labels on that subset:
 *
 *     14 people   32 non-people   (30% purity)
 *
 * and the non-people are `Dear Student`, `End Time`, `High School`,
 * `Last Day`, `Go Live`, `Pacific Standard Time`, `Reason Code`. The reason
 * is structural rather than fixable: a person-only profile is usually a
 * profile carrying nothing BUT Census `compositional-structure` and
 * `token-membership` -- the two weakest classes in the model, whose known
 * failure modes (interpretation-model.ts) are exactly this. The second
 * candidate rule, `ordinary-language + person` (107 candidates), mixes
 * `Goodloe, Andrew` and `Perias, Nelly` in with `Like`, `The`, `Thank` and
 * `Yes`. Neither is a cohort a human can scan quickly, because the exceptions
 * are not exceptions -- they are half the list.
 *
 * A group is therefore NOT offered for people. That is the feature working:
 * the instruction was that a 38-item clean group beats a 75-item padded one,
 * and the corollary is that a 73-item group at 30% purity is worth nothing at
 * all. Note also what is NOT concluded from this: nothing here says those 73
 * are not people. They are simply not a scannable cohort, and they go to
 * ordinary individual review untouched.
 *
 * ── "EDUCATIONAL TERMS" WOULD BE A CLAIM THE EVIDENCE DOES NOT MAKE ──
 *
 * On the real document, `domain-terminology` is almost entirely
 * `document-local`: of 51 candidates carrying a terminology reading, the
 * eight bundled reference packs account for roughly nine, and the higher-ed
 * pack contributes 2 signals out of 192 in the whole Unlikely population.
 * The evidence says "this document uses this phrase as vocabulary", not
 * "this is educational vocabulary". Naming a group `Educational Terms` would
 * therefore assert a domain the evidence never established, on a screen whose
 * entire purpose is a reviewer trusting a label enough to bulk-decide under
 * it. Group names below say only what is supported.
 *
 * ═══════════════════ THE TWO GROUPS ═══════════════════
 *
 * Both share one shape, which is deliberately the SAME shape `Unlikely`
 * uses -- an affirmative explanation, plus no surviving Person reading --
 * and differ from it in exactly one way: the explanation is not unique
 * enough (or not non-sensitive enough) to hold the candidate out of review,
 * so a human confirms the cohort instead of the predicate doing it silently.
 *
 *   `explained-vocabulary`   Every supported reading is non-sensitive, and
 *                            there are at least two of them. 51 candidates.
 *                            These are the ones one modelling artifact away
 *                            from Unlikely -- `FYI`, `CSU`, `Grade Rosters`,
 *                            `Spring Semester`, `Term Activation` -- held out
 *                            of Unlikely only because two non-sensitive
 *                            readings compete rather than one surviving.
 *
 *   `named-organizations`    An `organization` reading is supported and no
 *                            Person or Place reading is. 31 candidates:
 *                            `Canvas`, `ServiceNow`, `SharePoint`,
 *                            `Instructure`, `University Registrar`,
 *                            `Enrollment Management`. Organization is
 *                            deliberately NOT in Unlikely's non-sensitive set
 *                            (a named organization can be privacy-relevant),
 *                            which is precisely why these need a human and
 *                            are a good cohort for one.
 *
 * ═══════════════════ OVERLAP: STRUCTURALLY IMPOSSIBLE, NOT ARBITRATED ═══════════════════
 *
 * The instruction asked for a documented, conservative overlap policy and
 * warned against building a group-ranking engine. The policy is that there is
 * nothing to rank: the two predicates are MUTUALLY EXCLUSIVE by construction
 * -- `named-organizations` requires an `organization` reading and
 * `explained-vocabulary` forbids one -- so no candidate can support both, and
 * `proposedGroupFor` returns at most one group without consulting any
 * precedence. If a third group is ever added, it must either be provably
 * disjoint from these two or arrive with an explicit, measured policy; a
 * silent priority order would be the failure mode this note exists to
 * prevent.
 *
 * ═══════════════════ AFFIRMATIVE ONLY, AND WHAT THAT DOES NOT MEAN ═══════════════════
 *
 * Group membership requires POSITIVE support: `unsupported` candidates (39 in
 * the real population) are never grouped, because silence is not a cohort.
 * "No Person reading survives" appears as a NECESSARY condition, never as a
 * sufficient one -- it never puts a candidate into a group, it only prevents
 * one. That is the same asymmetry `reviewNecessityFor` already relies on, and
 * it is why this file does not violate the standing rule that absence of
 * Person evidence is not proof of non-Person status.
 *
 * ═══════════════════ MONOTONICITY ═══════════════════
 *
 * Acquiring further evidence can only ever REMOVE a candidate from
 * `explained-vocabulary` (a new privacy-relevant reading disqualifies it) and
 * can only ever remove one from `named-organizations` (a new Person or Place
 * reading disqualifies it). More evidence never makes this file more
 * aggressive. Pinned by verify/quick-approval-verification.ts.
 *
 * Pure, DOM-free, deterministic, dependency-free beyond the two vocabulary
 * modules it reads its constants from.
 */

import type { InterpretationId, InterpretationProfile } from "../interpretation/interpretation-model.js";
import { NON_SENSITIVE_INTERPRETATIONS, PROTECTIVE_DETECTED_TYPES } from "./reviewNecessity.js";

export type ProposedGroupId = "explained-vocabulary" | "named-organizations";

/** Declaration order -- the order groups are OFFERED in, which is a UX
 *  ordering (largest measured cohort first) and carries no precedence
 *  meaning, because the predicates cannot both fire. */
export const PROPOSED_GROUP_ORDER: readonly ProposedGroupId[] = ["explained-vocabulary", "named-organizations"];

export interface ProposedGroupDescriptor {
  id: ProposedGroupId;
  /** Reviewer-facing name. Says only what the evidence supports -- see the
   *  "Educational Terms" note in the module header. */
  label: string;
  /** The one-sentence claim the reviewer is being asked to scan against.
   *  Shown above the list; it is the thing the bulk decision is made under. */
  claim: string;
  /**
   * Whether "Change all" is coherent for this group.
   *
   * FALSE for every group, and the reason is a rule rather than a case-by-
   * case judgement: `bulkApplyDecision` requires ONE shared `replacement`
   * string when the decision is Rename, and `flattenGroup` can supply one
   * only because an entity group is ONE REFERENT with a canonical name. A
   * ProposedGroup is never one referent -- it is a set of distinct surface
   * forms that happen to share an evidence shape. Replacing `Canvas`,
   * `ServiceNow` and `SharePoint` with a single string is not a coarse
   * action, it is a wrong one. Kept as a per-group flag rather than a global
   * constant so a future group that IS one referent can say so.
   */
  supportsChangeAll: boolean;
}

export const PROPOSED_GROUPS: Record<ProposedGroupId, ProposedGroupDescriptor> = {
  "explained-vocabulary": {
    id: "explained-vocabulary",
    label: "Explained vocabulary",
    claim:
      "Every reading DocScrub supports for these is ordinary language, document terminology, an acronym, a date or term, or a document title. No Person, Place or Organization reading is supported for any of them.",
    supportsChangeAll: false,
  },
  "named-organizations": {
    id: "named-organizations",
    label: "Named organizations and systems",
    claim:
      "An Organization reading is affirmatively supported for each of these, and no Person or Place reading is supported for any of them.",
    supportsChangeAll: false,
  },
};

/**
 * MINIMUM GROUP SIZE -- a UX threshold, not a semantic one.
 *
 * A group smaller than this is not offered, because Quick Approval costs a
 * fixed overhead the ordinary queue does not: leaving the queue, scanning a
 * separate surface, and coming back. Below roughly eight rows that overhead
 * exceeds simply deciding the items where they already are, and the reviewer
 * has been sent somewhere for nothing.
 *
 * This is NOT the 50-75 figure from the feature request. That figure was an
 * observation about how many short values a person can scan in one pass, and
 * the instruction was explicit that it must not become a semantic
 * requirement. Nothing here pads a group up to it or splits a group down to
 * it; the engine forms whatever cohort the evidence supports and this
 * constant only declines to open a mode for a trivial one.
 */
export const MIN_PROPOSED_GROUP_SIZE = 8;

/**
 * The per-candidate facts grouping needs.
 *
 * `detectedType` and `structurallyDefective` are PASSED IN rather than read
 * off a candidate, so this module owns no view of the document model and no
 * view of occurrence context -- the same discipline `reviewNecessityFor`
 * follows, and the reason both stay verifiable without a browser.
 */
export interface ProposedGroupFacts {
  candidateId: string;
  /** The candidate's display value, verbatim. Never rewritten. */
  value: string;
  detectedType: string;
  occurrenceCount: number;
  /** May be undefined for a candidate the interpretation layer has not seen,
   *  which is never grouped -- absence is not a reason to cohort something. */
  profile: InterpretationProfile | undefined;
  /**
   * True when an existing diagnostic (truncationDiagnostics) says at least
   * one occurrence of this candidate is a DocScrub-produced span defect.
   *
   * DOES NOT AFFECT MEMBERSHIP, deliberately. The instruction was that a
   * structural defect must not be hidden merely because semantic evidence
   * places a candidate in a group, and that whether to exclude such
   * candidates should be MEASURED rather than guessed. It could not be
   * measured from the interpretation export (which carries no occurrence
   * context), so the conservative reading is taken: the candidate stays in
   * the group and the row is FLAGGED, which makes the defect more visible
   * than ordinary individual review makes it today and costs the reviewer one
   * Space press to act on. Revisit with a measurement, not with an opinion.
   */
  structurallyDefective: boolean;
}

/** One member row, in scan order. Carries only what the dense list needs --
 *  see the list-mode note in quickApproval.ts for why this is so thin. */
export interface ProposedGroupMember {
  candidateId: string;
  value: string;
  occurrenceCount: number;
  structurallyDefective: boolean;
  /** The reading ids supporting this member, in INTERPRETATION_ORDER. The
   *  per-row evidence affordance renders these; the scan list does not. */
  supportedReadings: readonly InterpretationId[];
}

export interface ProposedGroup {
  id: ProposedGroupId;
  descriptor: ProposedGroupDescriptor;
  /** Members in scan order (see `compareMembers`). Materialized, exactly as
   *  the Zone materializes its membership: a cohort a control cannot NAME is
   *  a cohort it must not act on. */
  members: readonly ProposedGroupMember[];
  /** How many members carry a structural-defect flag. Surfaced in the header
   *  so the reviewer knows to expect them before scanning. */
  structurallyDefectiveCount: number;
}

const isNonSensitive = (id: InterpretationId): boolean => NON_SENSITIVE_INTERPRETATIONS.includes(id);

/**
 * The one determination: which group, if any, does this candidate support?
 *
 * Total and deterministic. Returns null far more often than not, which is the
 * intended behaviour -- on the real population 344 of 426 active candidates
 * are ungrouped and go to ordinary individual review.
 */
export function proposedGroupFor(facts: ProposedGroupFacts): ProposedGroupId | null {
  // A protective typed detection's disposition is the reviewer's by policy,
  // and never shared with a cohort. Same list, same reason, as reviewNecessity.
  if (PROTECTIVE_DETECTED_TYPES.includes(facts.detectedType)) return null;

  const profile = facts.profile;
  if (!profile) return null;
  const readings = profile.interpretations.map((i) => i.id);
  if (readings.length === 0) return null; // silence is not a cohort

  // NECESSARY, never sufficient: a surviving Person reading disqualifies a
  // candidate from every group, and its ABSENCE puts nothing into one.
  if (readings.includes("person")) return null;

  if (readings.includes("organization")) {
    // `place` is excluded here for the same reason reviewNecessity excludes it
    // from the non-sensitive set: a place name can be identifying in context,
    // and no measurement has been done on it.
    if (readings.includes("place")) return null;
    return "named-organizations";
  }

  // Every remaining reading must be non-sensitive. `identifier` and `place`
  // fall out here rather than needing their own guard.
  if (!readings.every(isNonSensitive)) return null;

  // EXACTLY ONE non-sensitive reading is already `Unlikely`'s population, and
  // Unlikely holds it out of ordinary review entirely. Offering those here
  // would be a second, weaker home for candidates that already have a
  // stronger one, and would put a decision surface in front of work the
  // reviewer has already been told they do not have to walk past. Two or more
  // competing non-sensitive readings is the case Unlikely refuses on purpose
  // ("narrowed, not explained") and is exactly the case a human can settle in
  // one pass.
  if (readings.length < 2) return null;

  return "explained-vocabulary";
}

/**
 * SCAN ORDER -- alphabetical by value, case-insensitive.
 *
 * Not by occurrence count, and not by evidence strength. The reviewer's task
 * on this surface is to spot values that do not belong among their
 * neighbours, and alphabetical order puts related surface forms adjacent
 * (`Term`, `Term Activation`, `Term Processing`) so a stray one stands out
 * against its own neighbourhood. An order keyed to a machine-computed
 * quantity would scatter them, and would also imply a ranking the group does
 * not have. Ties break on candidateId for total determinism.
 */
function compareMembers(a: ProposedGroupMember, b: ProposedGroupMember): number {
  const byValue = a.value.toLocaleLowerCase().localeCompare(b.value.toLocaleLowerCase());
  if (byValue !== 0) return byValue;
  return a.candidateId.localeCompare(b.candidateId);
}

/**
 * Builds every group with enough members to be worth offering.
 *
 * CALLERS PASS ALREADY-FILTERED FACTS -- specifically, the UNRESOLVED review
 * pool in the caller's own display order. Same contract, and the same
 * reasoning, as `reviewZone`: this module has no view of the session and must
 * not acquire one, and the counts a surface shows beside a group have to be
 * the counts that surface computed.
 *
 * Returns groups in PROPOSED_GROUP_ORDER, omitting any that came up short.
 */
export function buildProposedGroups(facts: readonly ProposedGroupFacts[]): ProposedGroup[] {
  const buckets = new Map<ProposedGroupId, ProposedGroupMember[]>();
  for (const fact of facts) {
    const groupId = proposedGroupFor(fact);
    if (groupId === null) continue;
    const bucket = buckets.get(groupId) ?? [];
    bucket.push({
      candidateId: fact.candidateId,
      value: fact.value,
      occurrenceCount: fact.occurrenceCount,
      structurallyDefective: fact.structurallyDefective,
      supportedReadings: fact.profile ? fact.profile.interpretations.map((i) => i.id) : [],
    });
    buckets.set(groupId, bucket);
  }

  const groups: ProposedGroup[] = [];
  for (const id of PROPOSED_GROUP_ORDER) {
    const members = buckets.get(id);
    if (!members || members.length < MIN_PROPOSED_GROUP_SIZE) continue;
    members.sort(compareMembers);
    groups.push({
      id,
      descriptor: PROPOSED_GROUPS[id],
      members,
      structurallyDefectiveCount: members.filter((m) => m.structurallyDefective).length,
    });
  }
  return groups;
}
