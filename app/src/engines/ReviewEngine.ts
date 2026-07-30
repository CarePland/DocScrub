/**
 * ReviewEngine — architecture v0.2 §6.8. Owns durable review behavior:
 * candidate decisions, Not Quite sub-state, group/ambiguity lifecycle,
 * completion rules, review events, transaction boundaries, undoable domain
 * actions, and the invariant that items never disappear merely because an
 * action was selected. Does not own DOM focus or visual presentation (that
 * is FocusNavigator, see FocusNavigator.ts).
 *
 * dispatch() is synchronous at its core (a reducer-style transition over
 * ReviewSession); persisting the result is a separate, async concern owned
 * by LocalSessionRepository, not by ReviewEngine itself (§12).
 *
 * PRODUCTION IMPLEMENTATION (Phase 8): DurableReviewEngine below is the
 * real implementation, backed by src/engines/review/session.ts (the pure
 * reducer -- applyReviewCommand()/createReviewSession()) and
 * src/engines/review/serialization.ts (versioned save/load). See
 * session.ts's top doc comment for the full oracle-grounding record: what
 * was ported from redactor/models.py + redactor/decisions.py +
 * local_web_app.py's update_decision()/update_entity_group(), what was
 * deliberately left out (per-occurrence Decision.REVIEW/OccurrenceDecision
 * -- confirmed dead in the actual product UI; group-level bulk actions --
 * deferred to Gate C's FocusNavigator/Workspace phases), and the one
 * approved deviation (rejecting re-entry into a different Not Quite group
 * rather than Python's silent client-side discard).
 *
 * ARCHITECTURAL BOUNDARY, enforced by construction: DurableReviewEngine's
 * constructor takes a DetectionResult and GroupingResult ONCE (read-only,
 * never mutated, never re-derived) purely so dispatch() can validate a
 * candidateId/groupId exists and look up an entity group's member list --
 * it never calls DetectionEngine/CandidateQualityEngine/
 * EntityResolutionEngine/OccurrenceClassifier itself, never regroups
 * entities, never classifies occurrences, never rebuilds documents. A
 * deliberate rescan (new ProcessingRevision) means constructing a NEW
 * DurableReviewEngine bound to the new DetectionResult/GroupingResult, not
 * this class re-deriving them internally.
 */

import type { ReviewSession } from "../domain/ReviewSession.js";
import type { ReviewCommand, ReviewTransactionResult } from "../domain/Commands.js";
import type { OccurrenceCoverage } from "../domain/ReviewSession.js";
import type { DetectionResult } from "./DetectionEngine.js";
import type { GroupingResult } from "./EntityResolutionEngine.js";
import { applyReviewCommand, createReviewSession } from "./review/session.js";
import { candidateResolvedStatus } from "./review/coverage.js";
import type { DetectionGroupingContext } from "./DetectionGroupingContext.js";

export interface ReviewEngine {
  getState(): ReviewSession;
  dispatch(command: ReviewCommand): ReviewTransactionResult;
}

/** Injectable so verification can pass fixed timestamps for deterministic,
 *  reproducible assertions instead of `new Date()`. Defaults to the real
 *  clock for production use. */
export type Clock = () => string;

const realClock: Clock = () => new Date().toISOString();

export class DurableReviewEngine implements ReviewEngine {
  private session: ReviewSession;
  private readonly context: DetectionGroupingContext;
  private readonly clock: Clock;

  constructor(detection: DetectionResult, grouping: GroupingResult, initialSession?: ReviewSession, clock: Clock = realClock) {
    this.context = { detection, grouping };
    this.clock = clock;
    this.session = initialSession ?? createReviewSession(`session-${detection.schemaVersion}-${Date.now()}`, "unknown-document", clock());
  }

  getState(): ReviewSession {
    return this.session;
  }

  dispatch(command: ReviewCommand): ReviewTransactionResult {
    const { session, result } = applyReviewCommand(this.session, command, this.context, this.clock());
    if (result.ok) {
      this.session = session;
    }
    return result;
  }

  /**
   * Convenience read helper -- NOT part of the ReviewEngine interface,
   * since computing "what's still unresolved" belongs conceptually to a
   * future FocusNavigator/query layer (Phase 9), not to ReviewEngine's own
   * "record reviewer intent" charter. Exposed here only because
   * ReviewSession.ts's already-existing resolvedStatusOf() pure function
   * needs exactly the inputs this class already holds, and verification
   * needs a way to check it without duplicating the wiring.
   */
  candidateStatus(candidateId: string): OccurrenceCoverage {
    return candidateResolvedStatus(this.session, this.context.detection, candidateId);
  }
}
