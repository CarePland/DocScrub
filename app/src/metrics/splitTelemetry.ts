/**
 * splitTelemetry.ts -- a content-free record of the STRUCTURAL PROCESS, so we
 * could one day learn whether deterministic split rules work without ever
 * collecting the documents they work on (AG, 2026-08-10).
 *
 * ═══════════════════ NOTHING IS TRANSMITTED. AT ALL. ═══════════════════
 *
 * There is no network call, no endpoint, no queue, no serializer aimed
 * anywhere. This module builds a local value and counts it. That is the whole
 * of it, and it is the whole of what this pass is allowed to do.
 *
 * ═══════════════════ THE PRIVACY INVARIANT, ENFORCED BY THE TYPE ═══════════════════
 *
 * The schema is INCAPABLE OF CARRYING DOCUMENT CONTENT, and it is incapable by
 * construction rather than by discipline. Every field is a number, a boolean,
 * or a value from a closed union of rule ids defined in code:
 *
 *     no string fields          -> no candidate text, no token text, no
 *                                  surrounding text, no filenames, no titles,
 *                                  no replacement text, no excerpts
 *     no hashes, no ids         -> HASHING A NAME IS NOT ANONYMISATION for
 *                                  this purpose. A hash of `Margaret` is a
 *                                  stable identifier for Margaret; it is
 *                                  joinable, and a small candidate space is
 *                                  trivially reversible by enumeration. So
 *                                  there is no digest field of any kind, and
 *                                  no document identifier derived from
 *                                  content.
 *     no property bag           -> no `metadata`, `extra`, `tags` or
 *                                  `Record<string, unknown>` in which a
 *                                  future caller could smuggle a value.
 *     rule ids are a UNION      -> `SplitProposalRuleId`, not `string`. A
 *                                  caller physically cannot put a name there;
 *                                  it would not compile.
 *
 * The verification suite proves this BEHAVIOURALLY -- it walks a constructed
 * event and asserts that no reachable value is a string outside the rule-id
 * allowlist -- rather than trusting a regex over this file.
 *
 * ═══════════════════ WHY PARTITION SHAPE IS SAFE ═══════════════════
 *
 * `confirmedPartition: [1, 1, 1]` records SEGMENT SIZES IN TOKENS, not the
 * tokens. It says "three pieces of one token each". Every three-token
 * candidate in every document produces the same value, so it identifies
 * nothing. Boundary INDICES are likewise positions, not content.
 *
 * A deliberate omission: there is no field for the candidate's semantic type
 * or interpretation. It is tempting -- "were splits mostly on people?" -- and
 * it starts narrowing which document a record could have come from. If that
 * question ever matters it should be added deliberately, with its own
 * argument, not inherited from a convenience field added today.
 *
 * ═══════════════════ AGGREGATE LOCALLY, NOT PER CANDIDATE ═══════════════════
 *
 * `SplitTelemetryAggregate` is the shape a future report would use: totals
 * over a session, never a stream of one event per candidate. Even content-free
 * per-candidate events are a sequence, and sequences carry structure. The
 * aggregate is what the seam exists to make possible.
 *
 * Pure, DOM-free, deterministic, offline.
 */

import type { SplitProposalRuleId } from "../engines/review/splitProposal.js";

/** What the reviewer did with what the engine suggested. A closed set. */
export type SplitProposalOutcome =
  /** The engine proposed boundaries and the reviewer confirmed exactly them. */
  | "accepted-exactly"
  /** The engine proposed boundaries and the reviewer changed them. */
  | "accepted-modified"
  /** The engine proposed boundaries and the reviewer cancelled. */
  | "rejected"
  /** The engine proposed nothing and the reviewer placed boundaries by hand. */
  | "unproposed-manual"
  /** The engine proposed nothing and the reviewer cancelled. */
  | "unproposed-cancelled";

/**
 * ONE structural event. Numbers, booleans and allowlisted rule ids only.
 *
 * Note what is absent and must stay absent: candidateId, documentId, value,
 * segment text, replacement text, timestamps precise enough to correlate, and
 * any free-form field.
 */
export interface SplitTelemetryEvent {
  readonly operation: "split";
  /** Tokens in the original candidate. A count. */
  readonly originalTokenCount: number;
  /** Segment SIZES the engine proposed, in tokens. `[]` when none. */
  readonly proposedPartition: readonly number[];
  /** Segment sizes the reviewer confirmed, in tokens. `[]` when cancelled. */
  readonly confirmedPartition: readonly number[];
  /** Which rules fired. Union-typed, so content cannot be placed here. */
  readonly proposalRuleIds: readonly SplitProposalRuleId[];
  readonly exactProposalAccepted: boolean;
  readonly resultingUnitCount: number;
  readonly outcome: SplitProposalOutcome;
}

/** Segment sizes in tokens for a boundary set. Sizes, never content. */
export function partitionShape(tokenCount: number, boundaries: readonly number[]): number[] {
  if (tokenCount <= 0) return [];
  const cuts = [...new Set(boundaries)].filter((b) => b >= 0 && b <= tokenCount - 2).sort((a, b) => a - b);
  const sizes: number[] = [];
  let start = 0;
  for (const cut of cuts) {
    sizes.push(cut - start + 1);
    start = cut + 1;
  }
  sizes.push(tokenCount - start);
  return sizes;
}

/**
 * Build one event.
 *
 * Takes COUNTS AND BOUNDARIES, never a candidate and never a decomposition --
 * so the function has no access to text to leak even by accident. That
 * signature is the enforcement mechanism, not a convention.
 */
export function buildSplitTelemetryEvent(input: {
  originalTokenCount: number;
  proposedBoundaries: readonly number[];
  confirmedBoundaries: readonly number[] | null;
  proposalRuleIds: readonly SplitProposalRuleId[];
}): SplitTelemetryEvent {
  const cancelled = input.confirmedBoundaries === null;
  const proposedShape = input.proposedBoundaries.length > 0
    ? partitionShape(input.originalTokenCount, input.proposedBoundaries)
    : [];
  const confirmedShape = cancelled ? [] : partitionShape(input.originalTokenCount, input.confirmedBoundaries!);

  const proposedSorted = [...new Set(input.proposedBoundaries)].sort((a, b) => a - b);
  const confirmedSorted = cancelled ? [] : [...new Set(input.confirmedBoundaries!)].sort((a, b) => a - b);
  const exact = !cancelled
    && proposedSorted.length > 0
    && proposedSorted.length === confirmedSorted.length
    && proposedSorted.every((b, i) => b === confirmedSorted[i]);

  const hadProposal = proposedSorted.length > 0;
  const outcome: SplitProposalOutcome = cancelled
    ? (hadProposal ? "rejected" : "unproposed-cancelled")
    : hadProposal
      ? (exact ? "accepted-exactly" : "accepted-modified")
      : "unproposed-manual";

  return {
    operation: "split",
    originalTokenCount: input.originalTokenCount,
    proposedPartition: proposedShape,
    confirmedPartition: confirmedShape,
    proposalRuleIds: [...input.proposalRuleIds],
    exactProposalAccepted: exact,
    resultingUnitCount: cancelled ? 0 : confirmedShape.length,
    outcome,
  };
}

/**
 * The shape a future local report would emit: totals, not a sequence.
 *
 * `partitionShapes` is keyed by a joined size string (`"1-1"`, `"2-1"`) --
 * derived only from token counts, so it identifies no document. It is here
 * because "which partition shapes do reviewers actually confirm" is the
 * question that would tell us whether the proposal rules are any good.
 */
export interface SplitTelemetryAggregate {
  splitProposals: number;
  exactAccepts: number;
  modifiedAccepts: number;
  rejected: number;
  unproposedManual: number;
  unproposedCancelled: number;
  /** Count of confirmed splits per partition shape. */
  partitionShapes: Record<string, number>;
  /** Count of events in which each rule fired. */
  ruleFireCounts: Record<SplitProposalRuleId, number>;
}

export function emptySplitTelemetryAggregate(): SplitTelemetryAggregate {
  return {
    splitProposals: 0,
    exactAccepts: 0,
    modifiedAccepts: 0,
    rejected: 0,
    unproposedManual: 0,
    unproposedCancelled: 0,
    partitionShapes: {},
    ruleFireCounts: {
      "split-proposal/dividing-punctuation": 0,
      "split-proposal/coordinating-conjunction": 0,
      "split-proposal/attested-on-both-sides": 0,
    },
  };
}

/** Fold one event into a local aggregate. Pure; returns a new value. */
export function aggregateSplitTelemetry(
  aggregate: SplitTelemetryAggregate,
  event: SplitTelemetryEvent
): SplitTelemetryAggregate {
  const next: SplitTelemetryAggregate = {
    ...aggregate,
    partitionShapes: { ...aggregate.partitionShapes },
    ruleFireCounts: { ...aggregate.ruleFireCounts },
  };
  if (event.proposedPartition.length > 0) next.splitProposals += 1;
  if (event.outcome === "accepted-exactly") next.exactAccepts += 1;
  if (event.outcome === "accepted-modified") next.modifiedAccepts += 1;
  if (event.outcome === "rejected") next.rejected += 1;
  if (event.outcome === "unproposed-manual") next.unproposedManual += 1;
  if (event.outcome === "unproposed-cancelled") next.unproposedCancelled += 1;
  if (event.confirmedPartition.length > 0) {
    const key = event.confirmedPartition.join("-");
    next.partitionShapes[key] = (next.partitionShapes[key] ?? 0) + 1;
  }
  for (const ruleId of event.proposalRuleIds) next.ruleFireCounts[ruleId] += 1;
  return next;
}
