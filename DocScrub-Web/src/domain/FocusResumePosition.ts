/**
 * FocusResumePosition — an OPTIONAL, small, independently versioned "where
 * was the reviewer looking" marker, deliberately kept OUTSIDE
 * ReviewSession's own schema (see ReviewSession.ts's schemaVersion ladder
 * and engines/review/serialization.ts). ReviewSession is the durable
 * record of REVIEWER INTENT -- decisions, Not Quite transactions, group/
 * ambiguity resolutions -- all of which matter for correctness,
 * auditability, and output generation. Which stage/item was merely being
 * LOOKED AT when the browser was last closed matters for none of those
 * things: a session reloaded with no resume position at all is exactly as
 * reviewable, and exactly as CORRECT, as one reloaded with a perfectly
 * preserved one. This is the concrete enforcement of Andrew's Phase 9
 * instruction that "review correctness must not depend on saved focus":
 * this type is never consulted by ReviewEngine, by stages.ts's resolved/
 * completion computation, or by any correctness-relevant navigation logic
 * -- only by FocusNavigator's own initial-focus bootstrap (see
 * navigation/navigator.ts's restoreFocusState()), which immediately runs
 * the result through the exact same reconcile() every other stale-focus
 * scenario already goes through. A resume position naming a stage/item
 * that no longer exists, or that's now fully resolved, degrades
 * gracefully to ordinary "first unresolved item" behavior rather than
 * ever producing an invalid or misleading focus target.
 *
 * NOT modeled here: Not Quite's own resume position. That already exists,
 * durably, as NotQuiteState.activeMemberId in ReviewSession (see
 * NotQuite.ts) -- it is reviewer-visible state about an IN-PROGRESS
 * transaction, not a UI convenience, so it correctly lives in the durable
 * schema instead of here. FocusResumePosition only ever remembers
 * stage + top-level itemId; occurrenceId and panel are deliberately NOT
 * captured -- "which occurrence was expanded" and "was a Not Quite panel
 * open" are even more clearly transient presentation state, not worth the
 * complexity of validating across a reload (an expanded occurrence is one
 * keypress away; a genuinely still-open Not Quite panel is already
 * reconstructed from session.activeNotQuite by reconcile() regardless of
 * anything recorded here).
 *
 * LIFECYCLE: captured once, at the same moment a caller issues
 * document.saveReviewSession (see Commands.ts's ApplicationCommand) --
 * not on every focus change, to avoid write-amplification for a value
 * with no correctness weight. Persisted as a sibling artifact alongside
 * the serialized ReviewSession (NOT inside it), and passed into
 * navigation/navigator.ts's restoreFocusState() when a FocusNavigator is
 * constructed for a reloaded session. If no resume position is available
 * (first-ever load, older saved session predating this feature, or a
 * shape/version mismatch), restoreFocusState() falls back to
 * createInitialFocusState() -- the ordinary "first unresolved item in
 * Ambiguity Check" bootstrap -- exactly as if this type never existed.
 */

import type { WorkflowStage } from "./FocusState.js";

export const FOCUS_RESUME_SCHEMA_VERSION = 1;

export interface FocusResumePosition {
  schemaVersion: 1;
  stage: WorkflowStage;
  itemId: string | null;
  savedAt: string; // ISO 8601
}

export function captureFocusResumePosition(stage: WorkflowStage, itemId: string | null, savedAt: string): FocusResumePosition {
  return { schemaVersion: FOCUS_RESUME_SCHEMA_VERSION, stage, itemId, savedAt };
}

export function serializeFocusResumePosition(position: FocusResumePosition): string {
  return JSON.stringify(position);
}

export type FocusResumeRestoreResult = { ok: true; position: FocusResumePosition } | { ok: false; reason: string };

const KNOWN_STAGES: readonly WorkflowStage[] = ["ambiguity-check", "group-check", "item-check", "qa", "output"];

/**
 * Validates a deserialized blob's SHAPE only -- is this even a well-formed
 * FocusResumePosition -- never whether its stage/itemId still exist in the
 * current DetectionResult/GroupingResult (that is restoreFocusState's/
 * reconcile()'s job, deliberately kept separate so a schema-valid but
 * stale position is handled by the SAME staleness-recovery path as every
 * other reconciliation scenario, not a second bespoke one here). Never
 * throws -- an unrecognized or corrupt blob simply fails to restore.
 */
export function deserializeFocusResumePosition(raw: unknown): FocusResumeRestoreResult {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, reason: "not an object" };
  }
  const value = raw as Record<string, unknown>;
  if (value["schemaVersion"] !== FOCUS_RESUME_SCHEMA_VERSION) {
    return { ok: false, reason: `unsupported schemaVersion: ${JSON.stringify(value["schemaVersion"])}` };
  }
  if (typeof value["stage"] !== "string" || !KNOWN_STAGES.includes(value["stage"] as WorkflowStage)) {
    return { ok: false, reason: `invalid stage: ${JSON.stringify(value["stage"])}` };
  }
  if (value["itemId"] !== null && typeof value["itemId"] !== "string") {
    return { ok: false, reason: `invalid itemId: ${JSON.stringify(value["itemId"])}` };
  }
  if (typeof value["savedAt"] !== "string") {
    return { ok: false, reason: `invalid savedAt: ${JSON.stringify(value["savedAt"])}` };
  }
  return {
    ok: true,
    position: {
      schemaVersion: FOCUS_RESUME_SCHEMA_VERSION,
      stage: value["stage"] as WorkflowStage,
      itemId: value["itemId"] as string | null,
      savedAt: value["savedAt"],
    },
  };
}
