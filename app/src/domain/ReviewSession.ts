/**
 * ReviewSession — durable review state (architecture v0.2 §7.2). Contains
 * reviewer decisions, lifecycle, events, replacement assignments, the
 * current ScoringProfileSnapshot/ProcessingRevision, and any open Not Quite
 * sub-state. Explicitly does NOT contain a stored "resolved" flag -- resolved
 * status is derived, see resolvedStatusOf() at the bottom of this file.
 *
 * FEATURE 002 UPDATE (Decision Reuse): CandidateDecision gained `source` and
 * `importEvidence`, both additive/optional -- a save file from before this
 * feature existed deserializes exactly as before, with every decision
 * implicitly a reviewer decision (see session.ts's decideCandidate(), which
 * now always writes `source` explicitly on every NEW decision going
 * forward; the field is optional here only for backward compatibility with
 * already-serialized sessions, not because new code ever omits it). A
 * decision's `source`/`importEvidence` describe how the CURRENT value came
 * to be -- overriding an imported decision with an ordinary review command
 * REPLACES the whole CandidateDecision object (the existing "plain
 * overwrite, no precedence table" mechanism this file's own doc comments
 * already describe elsewhere), so an override automatically becomes
 * `source: "reviewer"` with no `importEvidence`, with zero special-case code
 * needed for that transition. See docs/detection/feature-002-decision-reuse.md.
 *
 * DECISION RATIONALE (2026-08-06): CandidateDecision gained `rationale`,
 * additive/optional on the SAME terms and for the same reason as Feature
 * 002's fields above -- no schema bump, no migration entry, older saves
 * unaffected. See the field's own comment for what it records and why
 * absence is meaningful.
 *
 * SCHEMA v2 (Entity/Decision Separation, 2026-07-29): ReviewSession gained
 * `entityRegistry` (EntityRegistry.ts) -- a session-scoped, in-memory record
 * of human-confirmed semantic entities, separate from the content-derived
 * `candidateId` a CandidateDecision is keyed by. Per Andrew's explicit
 * instruction, this is a BREAKING schema bump, not an additive one: a v1
 * save file has no `entityRegistry` and there is no migration value in
 * pretending one can be reconstructed after the fact (a v1 session's
 * candidateDecisions could be replayed through decideCandidate() to
 * backfill entities, but that would be silently INVENTING confirmation
 * history no reviewer actually re-affirmed -- exactly the kind of
 * unearned, non-auditable inference this project's "no automatic
 * decisions" principle exists to prevent). REVIEW_SESSION_SCHEMA_VERSION
 * is bumped to 2 and serialization.ts's migration ladder deliberately has
 * NO case for version 1 -- see that file's own note. A v1 save is rejected
 * outright with a clear reason, not silently upgraded.
 *
 * `isPositiveAcknowledgement()` (bottom of this file, alongside
 * resolvedStatusOf()) is the one pure predicate deciding whether a
 * CandidateDecisionKind confirms an entity (Keep/Rename/Redact) or revokes
 * one (Ignore) -- derived, not stored, so it cannot drift from the decision
 * itself. See EntityRegistry.ts for the full design rationale.
 */

import type { ProcessingRevision } from "./ScoringProfileSnapshot.js";
import type { NotQuiteState } from "./NotQuite.js";
import type { DecisionReuseEvidence } from "./DecisionReuse.js";
import type { EntityRegistry } from "./EntityRegistry.js";
import type { RelationshipDismissal } from "./StructuralRelationship.js";

export const REVIEW_SESSION_SCHEMA_VERSION = 2 as const;

export type CandidateDecisionKind = "Keep" | "Rename" | "Redact" | "Ignore";

/** Who/what produced a candidate's CURRENT decision. Absent on decisions
 *  written before Feature 002 (treat as "reviewer" -- see this file's top
 *  doc comment). */
export type CandidateDecisionSource = "reviewer" | "imported";

export interface CandidateDecision {
  candidateId: string;
  decision: CandidateDecisionKind;
  replacement?: string;
  decidedAt: string; // ISO 8601
  source?: CandidateDecisionSource;
  /** Present iff source === "imported": explains why this decision was
   *  reused rather than newly made. Never present for a reviewer-authored
   *  decision, including one that overrides a formerly-imported value (the
   *  override is a fresh CandidateDecision object with no evidence of its
   *  own -- the fact that a candidate WAS imported at some point is instead
   *  recoverable from the durable event log, see AuditExporter.ts's
   *  wasEverImported()). */
  importEvidence?: DecisionReuseEvidence;
  /**
   * DECISION RATIONALE (2026-08-06): the reviewer-facing CLAIM the reviewer
   * accepted -- "Common word", "Person's name", "Amy Miller" -- when the
   * decision came from a named suggestion chip or identity option. Absent
   * when it came from a bare decision button (Keep as-is / Change / Redact /
   * Ignore), a group or type bulk action, or an import.
   *
   * ABSENCE IS MEANINGFUL, and is the whole reason this field exists rather
   * than the cheaper alternative of matching a decision back to a suggestion
   * by its op at render time. Two suggestions can share an op kind -- a
   * term archetype offers "Common word" (Ignore) beside identity options
   * that are also dispositions -- so an op match is a guess, and a reviewer
   * who pressed the bare `Keep as-is` button gave NO reason at all. Writing
   * a reason they never gave is precisely the unearned, non-auditable
   * inference this project's "no automatic decisions" principle exists to
   * prevent. A decision with no rationale renders as its decision label.
   *
   * The defect this closes: app.ts's decided triage rows rendered
   * `recommendation.suggestions[0].label` unconditionally, so an item whose
   * reviewer pressed ② "Person's name" still displayed "→ Common word" --
   * the FIRST suggestion, never the chosen one. That text was correct while
   * these archetypes had exactly one suggestion and became wrong, silently,
   * when the name escape hatch added a second (2026-08-03, the "Amy" case).
   *
   * ADDITIVE AND OPTIONAL, deliberately -- the same shape (and the same
   * reasoning) as `source`/`importEvidence` above: a save file written
   * before this field existed deserializes exactly as before, so there is
   * NO schema bump and no migration ladder entry. Unlike `source`, new code
   * genuinely does omit this field much of the time; it is optional because
   * most decisions have no named rationale, not only for compatibility.
   *
   * NOT propagated through decision reuse: an imported decision's rationale
   * is the PRIOR reviewer's claim, and presenting it as the current
   * reviewer's would misattribute a judgment. See DecisionMemory.ts.
   */
  rationale?: string;
}

export interface EntityGroupDecision {
  groupId: string;
  /** Members actually confirmed as part of this group, which may be a
   *  subset of the originally proposed members -- see EntityResolutionEngine.
   *  Live confidence is derived from this list, not separately stored. */
  confirmedMemberCandidateIds: string[];
  // "Refined" == went through Not Quite (or flattenGroup -- see session.ts).
  // "Rejected" is retained only for backward compatibility with sessions
  // saved before the v9 group-terminology revision (Commands.ts); no
  // command produces it going forward -- rejectGroup was removed, and no
  // replacement command stamps "Rejected".
  decision: "Confirmed" | "Rejected" | "Refined";
  decidedAt: string;
}

export interface AmbiguityResolution {
  candidateId: string;
  /** Which of the proposed homes the reviewer picked. */
  resolvedGroupId: string;
  decidedAt: string;
}

export type ReviewEventKind =
  | "candidate-decided"
  | "candidate-reset"
  | "group-decided"
  | "ambiguity-resolved"
  | "not-quite-entered"
  | "not-quite-member-applied"
  | "not-quite-completed"
  | "not-quite-exited"
  | "undo"
  | "redo"
  /** Structural Relationship Review (2026-07-30): the reviewer marked a
   *  proposed structural relationship "Unrelated" -- see
   *  StructuralRelationship.ts. Records the proposal's own facts in the
   *  payload so the audit trail stands alone. */
  | "relationship-dismissed"
  /** Feature 002: fired once per applyDecisionReuse batch (in addition to
   *  one ordinary "candidate-decided" event per candidate actually decided
   *  by the batch) -- a single anchor point in the log recording that an
   *  import happened at all, including candidates it deliberately left
   *  untouched. See session.ts's applyDecisionReuse case. */
  | "decisions-imported"
  /** Milestone 2 ("Review at Scale"): fired once per bulkApplyDecision
   *  batch, in addition to one ordinary "candidate-decided" event per
   *  candidate actually decided -- the exact same "one summary event plus
   *  N per-candidate events" shape Feature 001's "group-decided" already
   *  established for confirmGroup/rejectGroup/flattenGroup, generalized
   *  from a group's fixed membership to an arbitrary selected candidateId
   *  list. See session.ts's bulkApplyDecision case. */
  | "bulk-decided"
  /** Reset (2026-08-08): fired once after a reset command clears one or
   *  more current candidate decisions, mirroring applyDecisionBatch's
   *  "N per-candidate events plus one gesture anchor" shape without
   *  classifying the gesture as a decision-making batch. Decision Tracker
   *  deliberately does NOT list this in BATCH_ANCHOR_EVENTS: Reset removes
   *  work from the currently resolved set rather than producing new
   *  resolved work. */
  | "decisions-reset"
  /** Decision Tracker miscount fix (2026-08-06, live report: one click on
   *  an Ambiguity Check "Accept section" over 8 items read as "8 MADE").
   *  Fired once per applyOwnSuggestions run (app.ts's runSectionAction
   *  "accept-suggestions" op and acceptAllInSection's recommendation
   *  branch) -- the same "one summary event plus N per-candidate events"
   *  shape as bulk-decided/group-decided/decisions-imported, but the
   *  per-candidate events are ordinary individually-dispatched
   *  keepCandidate/renameCandidate/ignoreCandidate/linkAmbiguousCandidate
   *  commands (each candidate takes its OWN suggestion, not one shared
   *  decision, so applyDecisionBatch's single-decision shape does not fit)
   *  stamped viaSuggestionAccept: true. See session.ts's suggestionsAccepted
   *  case and decisionTracker.ts's BATCH_FLAGS/BATCH_ANCHOR_EVENTS -- before
   *  this existed, those per-candidate events carried no batch tag at all,
   *  so the tracker credited one gesture per candidate instead of one per
   *  click. */
  | "suggestions-accepted";

export interface ReviewEvent {
  id: string;
  kind: ReviewEventKind;
  at: string; // ISO 8601
  /** Free-form but schema-checked payload specific to `kind`; deliberately
   *  not `unknown` project-wide -- see architecture v0.2 §11 on closed
   *  telemetry schemas, which this event log is adjacent to but distinct
   *  from (this is durable review history, not telemetry; it must never be
   *  transmitted off-device by default, same as everything else in
   *  ReviewSession). */
  payload: Record<string, string | number | boolean>;
}

export interface ReviewSession {
  schemaVersion: typeof REVIEW_SESSION_SCHEMA_VERSION;
  sessionId: string;
  documentId: string;
  createdAt: string;
  updatedAt: string;

  candidateDecisions: Record<string /* candidateId */, CandidateDecision>;
  groupDecisions: Record<string /* groupId */, EntityGroupDecision>;
  ambiguityResolutions: Record<string /* candidateId */, AmbiguityResolution>;

  /** Human-confirmed semantic entities, keyed by their own opaque EntityId
   *  -- separate from candidateId/groupId. See EntityRegistry.ts and this
   *  file's "SCHEMA v2" top doc comment. Maintained exclusively by
   *  session.ts's decideCandidate(), the same single choke point every
   *  command in this reducer already funnels through. */
  entityRegistry: EntityRegistry;

  /** Structural Relationship Review (2026-07-30): proposals the reviewer
   *  marked "Unrelated", keyed by the content-derived proposalId. ADDITIVE
   *  and OPTIONAL, deliberately no schema bump (unlike entityRegistry's v2
   *  break): a session saved before this feature existed simply has no
   *  dismissals, which is exactly true -- treating absence as {} fabricates
   *  nothing. Accepted relationships are NOT stored here or anywhere:
   *  acceptance is expressed as ordinary per-candidate decisions
   *  (bulkApplyDecision), and "addressed" is derived from those --
   *  derive, don't duplicate. */
  relationshipDismissals?: Record<string /* proposalId */, RelationshipDismissal>;

  /** At most one open Not Quite sub-state at a time (§6.8). */
  activeNotQuite: NotQuiteState | null;

  /** Every scoring pass this session has gone through; the last entry is
   *  current. A deliberate rescan under new rules appends, it never
   *  overwrites (§6.4). */
  processingRevisions: ProcessingRevision[];

  events: ReviewEvent[];
}

// ---- Derived state -------------------------------------------------------
// "Resolved" is intentionally NOT a stored field (architecture v0.2 §7.2).
// These selectors compute it from the durable facts above so it cannot drift
// out of sync with the decisions that actually produced it.

/**
 * Whether a CandidateDecisionKind counts as explicit positive acknowledgement
 * of a real-world entity, per Andrew's lifecycle: "Keep, Redact, Rename, and
 * approved Merge/Flatten outcomes count as positive acknowledgement. Ignore
 * does not." Merge/Flatten has no distinct CandidateDecisionKind of its own
 * -- flattenGroup bulk-applies an ordinary "Rename" to every member (see
 * session.ts's flattenGroup case) -- so this four-way switch already covers
 * it; there is nothing else to special-case.
 *
 * Deliberately a pure function, not a stored flag: EntityRegistry.ts's
 * applyEntityAcknowledgement() calls this on every decision so entity
 * confirmation can never drift out of sync with the decision that produced
 * it, the same "derive, don't duplicate" principle resolvedStatusOf() below
 * already established for resolved/unresolved status.
 */
export function isPositiveAcknowledgement(decision: CandidateDecisionKind): boolean {
  switch (decision) {
    case "Keep":
    case "Rename":
    case "Redact":
      return true;
    case "Ignore":
      return false;
  }
}

export type ResolvedStatus = "resolved" | "partially-resolved" | "unresolved";

export interface OccurrenceCoverage {
  status: ResolvedStatus;
  coveredOccurrenceCount: number;
  unresolvedOccurrenceCount: number;
}

/**
 * Computes resolved/partially-resolved/unresolved for one candidate from its
 * occurrences, the group decisions that might cover them, and any direct
 * candidate decision. This is a pure function over ReviewSession +
 * DocumentModel data (occurrence-to-candidate mapping); it takes plain
 * arrays here rather than the full DocumentModel so it stays testable in
 * isolation.
 */
export function resolvedStatusOf(
  candidateOccurrenceIds: string[],
  occurrenceIdsCoveredByResolvedGroups: Set<string>,
  hasDirectCandidateDecision: boolean
): OccurrenceCoverage {
  if (hasDirectCandidateDecision) {
    return {
      status: "resolved",
      coveredOccurrenceCount: candidateOccurrenceIds.length,
      unresolvedOccurrenceCount: 0,
    };
  }
  const covered = candidateOccurrenceIds.filter((id) => occurrenceIdsCoveredByResolvedGroups.has(id));
  if (covered.length === 0) {
    return { status: "unresolved", coveredOccurrenceCount: 0, unresolvedOccurrenceCount: candidateOccurrenceIds.length };
  }
  if (covered.length === candidateOccurrenceIds.length) {
    return { status: "resolved", coveredOccurrenceCount: covered.length, unresolvedOccurrenceCount: 0 };
  }
  return {
    status: "partially-resolved",
    coveredOccurrenceCount: covered.length,
    unresolvedOccurrenceCount: candidateOccurrenceIds.length - covered.length,
  };
}
