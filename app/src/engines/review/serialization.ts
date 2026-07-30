/**
 * serialization.ts -- versioned save/load for ReviewSession (architecture
 * v0.2 §7.2). Andrew's Phase 8 instruction asks to "treat saved review
 * sessions as versioned artifacts" and "not assume a single editing
 * session."
 *
 * ORACLE GAP, addressed additively: Python's own persistence
 * (local_web_app.py's save_state()/load_saved_state(), writing a single
 * flat JSON blob to STATE_PATH) has NO version field at all -- confirmed
 * by reading save_state() directly, its dict has no "schemaVersion" or
 * equivalent key. This is a genuine, confirmed gap in the oracle, not
 * something to reproduce faithfully: an unversioned save format cannot
 * safely evolve (there would be no way to tell an old save apart from a
 * new one if the shape ever changes), which directly conflicts with
 * Andrew's explicit ask here. Since there is no real Python contract to
 * preserve (nothing to deviate FROM), introducing an explicit
 * schemaVersion is an additive design improvement, not a deviation --
 * the same category of judgment call as Phase 7's explicit document-order
 * sort where Python's own ordering was confirmed incidental rather than a
 * tested guarantee.
 *
 * ReviewSession.schemaVersion already existed from an earlier ARB-reviewed
 * pass (REVIEW_SESSION_SCHEMA_VERSION = 1, see ReviewSession.ts) -- this
 * file is what actually enforces it at the load boundary.
 *
 * SCHEMA v2 (Entity/Decision Separation, 2026-07-29): bumped for
 * `entityRegistry` (see ReviewSession.ts's own "SCHEMA v2" note). Per
 * Andrew's explicit instruction, this is NOT an additive bump: the
 * migration ladder below has deliberately been left with no `case 1:` arm,
 * so a v1 save file is rejected outright ("unrecognized schemaVersion 1 --
 * no migration path implemented") rather than silently upgraded. Andrew's
 * instruction is explicit that this product is early enough that existing
 * saved sessions have no migration value, and that inventing one here
 * would mean fabricating entity-confirmation history no reviewer actually
 * re-affirmed -- worse than simply asking the reviewer to re-open the
 * source document.
 */

import { REVIEW_SESSION_SCHEMA_VERSION, type ReviewSession } from "../../domain/ReviewSession.js";
import { parseJsonObject } from "../../domain/JsonParsing.js";

export interface ReviewSessionMigrationError {
  ok: false;
  reason: string;
}

export interface ReviewSessionMigrationSuccess {
  ok: true;
  session: ReviewSession;
  /** True if this parse required upgrading an older schema version.
   *  Always false today (schema version 1 is the only version that has
   *  ever existed) -- present now so a future migration doesn't have to
   *  change this function's call sites, only its body. */
  migrated: boolean;
}

export type ReviewSessionMigrationResult = ReviewSessionMigrationSuccess | ReviewSessionMigrationError;

/**
 * Serializes a ReviewSession to a JSON string. Deterministic: plain-object
 * key order in this codebase is always insertion order (every session/
 * decision/event object here is built via explicit field lists or spreads
 * that preserve prior key order -- never `for...in` over an
 * externally-ordered source), and JSON.stringify's own serialization of a
 * given object shape is itself deterministic. No pretty-printing (indent)
 * by default, so byte-for-byte comparison in tests is meaningful; pass
 * `pretty: true` for a human-readable dump.
 */
export function serializeReviewSession(session: ReviewSession, options?: { pretty?: boolean }): string {
  return JSON.stringify(session, null, options?.pretty ? 2 : undefined);
}

/**
 * Parses and validates a previously-serialized ReviewSession, migrating
 * forward if the stored schemaVersion is older than
 * REVIEW_SESSION_SCHEMA_VERSION. Never throws -- parse/shape/version
 * problems are all returned as a typed failure so a caller (a future
 * LocalSessionRepository, per ReviewEngine.ts's own doc comment) can
 * surface a clear reviewer-facing message instead of an uncaught
 * exception from a corrupted or foreign-format save file.
 *
 * MIGRATION STRATEGY (documented now, even though there is only one
 * version today): each future schema bump should add one `case N:` arm
 * below that transforms a version-N shape into version-(N+1), then falls
 * through to the next case -- an explicit migration ladder, never an
 * in-place field reinterpretation, so a version-1 save opened five schema
 * versions later still upgrades deterministically one step at a time.
 */
export function deserializeReviewSession(raw: string): ReviewSessionMigrationResult {
  const parsed = parseJsonObject(raw);
  if (!parsed.ok) return parsed;
  return migrateReviewSession(parsed.value);
}

/**
 * Takes an already-shape-checked object (parseJsonObject's job, not this
 * function's) so callers that already have a parsed record -- rather than a
 * raw string -- can reuse the schemaVersion/migration/field-validation
 * logic below without re-serializing back to a string first.
 */
export function migrateReviewSession(record: Record<string, unknown>): ReviewSessionMigrationResult {
  const version = record["schemaVersion"];
  if (typeof version !== "number") {
    return { ok: false, reason: "missing or non-numeric schemaVersion -- not a recognized ReviewSession save file" };
  }
  if (version > REVIEW_SESSION_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: `schemaVersion ${version} is newer than this build supports (${REVIEW_SESSION_SCHEMA_VERSION}) -- refusing to guess at an unknown future format`,
    };
  }

  let migrated = false;
  // MIGRATION LADDER -- deliberately has no `case 1:` arm. Schema v2 added
  // `entityRegistry`, a real, non-additive change (see this file's top doc
  // comment's "SCHEMA v2" note): a v1 session has no confirmed-entity
  // history to carry forward, and backfilling one by replaying
  // candidateDecisions would fabricate confirmations no reviewer actually
  // made. A v1 save is rejected below, not upgraded. A FUTURE schema bump
  // that genuinely is additive should add its own `case N:` arm here,
  // upgrading forward and setting `migrated = true`, per this ladder's
  // original design intent -- this is a one-time, deliberate exception for
  // v1 -> v2, not a change to the general migration strategy.
  switch (version) {
    case REVIEW_SESSION_SCHEMA_VERSION:
      break;
    default:
      return { ok: false, reason: `unrecognized schemaVersion ${version} -- no migration path implemented` };
  }

  const validation = validateShape(record);
  if (!validation.ok) return validation;

  return { ok: true, session: record as unknown as ReviewSession, migrated };
}

/**
 * Minimal structural validation -- not a full schema validator (no
 * dependency was introduced for this), but enough to catch a truncated or
 * hand-edited file before it silently produces a ReviewSession missing
 * required top-level fields, matching Andrew's "correctness over
 * optimization" note: a cheap, direct check here is worth more than an
 * elaborate one that risks its own bugs.
 */
function validateShape(record: Record<string, unknown>): { ok: true } | ReviewSessionMigrationError {
  const requiredStringFields = ["sessionId", "documentId", "createdAt", "updatedAt"];
  for (const field of requiredStringFields) {
    if (typeof record[field] !== "string") {
      return { ok: false, reason: `missing or non-string required field: ${field}` };
    }
  }
  const requiredObjectFields = ["candidateDecisions", "groupDecisions", "ambiguityResolutions", "entityRegistry"];
  for (const field of requiredObjectFields) {
    if (typeof record[field] !== "object" || record[field] === null || Array.isArray(record[field])) {
      return { ok: false, reason: `missing or malformed required field: ${field}` };
    }
  }
  const requiredArrayFields = ["processingRevisions", "events"];
  for (const field of requiredArrayFields) {
    if (!Array.isArray(record[field])) {
      return { ok: false, reason: `missing or malformed required field: ${field}` };
    }
  }
  if (!("activeNotQuite" in record)) {
    return { ok: false, reason: "missing required field: activeNotQuite" };
  }
  return { ok: true };
}
