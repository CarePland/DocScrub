/**
 * WorkspaceSaveFile — Phase 10. The one artifact a reviewer actually saves
 * and reloads: a small, versioned bundle of the durable ReviewSession
 * (Phase 8) plus the optional FocusResumePosition (Phase 9), tagged with
 * the documentId it was captured against (see Workspace.ts's top doc
 * comment for why documentId is the gate for a safe restore).
 *
 * Deliberately does NOT reimplement ReviewSession or FocusResumePosition
 * validation: `deserializeWorkspaceSaveFile` round-trips each nested field
 * back through `deserializeReviewSession`/`deserializeFocusResumePosition`
 * (both already built, already tested) rather than duplicating their shape
 * checks here. This is the same "derive, don't duplicate" principle
 * Workspace.ts applies to review/focus state, applied now to persistence.
 *
 * This is intentionally a plain data format, not a LocalSessionRepository
 * implementation (architecture v0.2 §6.12/§8, still a signature only in
 * this codebase). LocalSessionRepository's job -- WHERE a save file lives
 * (IndexedDB/localStorage, quota handling, autosave cadence) -- is a
 * separate, not-yet-built concern; a WorkspaceSaveFile is just the string
 * such a repository would eventually store. `verify/workspace-
 * integration.ts` exercises save/reload entirely in memory (serialize into
 * a string, deserialize it back) precisely because that boundary doesn't
 * need a real storage backend to be verified correct.
 */

import { REVIEW_SESSION_SCHEMA_VERSION, type ReviewSession } from "../domain/ReviewSession.js";
import { serializeReviewSession, deserializeReviewSession } from "../engines/review/serialization.js";
import { deserializeFocusResumePosition, type FocusResumePosition } from "../domain/FocusResumePosition.js";
import { parseJsonObject } from "../domain/JsonParsing.js";

export const WORKSPACE_SAVE_SCHEMA_VERSION = 1 as const;

export interface WorkspaceSaveFile {
  schemaVersion: typeof WORKSPACE_SAVE_SCHEMA_VERSION;
  documentId: string;
  savedAt: string;
  reviewSession: ReviewSession;
  focusResumePosition?: FocusResumePosition;
}

export type WorkspaceSaveFileResult =
  | { ok: true; saveFile: WorkspaceSaveFile }
  | { ok: false; reason: string };

export function createWorkspaceSaveFile(
  documentId: string,
  savedAt: string,
  reviewSession: ReviewSession,
  focusResumePosition?: FocusResumePosition
): WorkspaceSaveFile {
  return {
    schemaVersion: WORKSPACE_SAVE_SCHEMA_VERSION,
    documentId,
    savedAt,
    reviewSession,
    ...(focusResumePosition !== undefined ? { focusResumePosition } : {}),
  };
}

/** Deterministic (see serializeReviewSession's own determinism note --
 *  plain-object key order in this codebase is always insertion order). */
export function serializeWorkspaceSaveFile(saveFile: WorkspaceSaveFile): string {
  return JSON.stringify(saveFile);
}

export function deserializeWorkspaceSaveFile(raw: string): WorkspaceSaveFileResult {
  const parsed = parseJsonObject(raw);
  if (!parsed.ok) return parsed;
  const record = parsed.value;

  const version = record["schemaVersion"];
  if (version !== WORKSPACE_SAVE_SCHEMA_VERSION) {
    return { ok: false, reason: `unsupported WorkspaceSaveFile schemaVersion: ${JSON.stringify(version)}` };
  }
  if (typeof record["documentId"] !== "string") {
    return { ok: false, reason: "missing or non-string documentId" };
  }
  if (typeof record["savedAt"] !== "string") {
    return { ok: false, reason: "missing or non-string savedAt" };
  }

  // Reuse ReviewSession's own validator rather than re-checking its shape
  // here -- round-trip the nested field back through the same string-based
  // entry point deserializeReviewSession already exposes.
  const sessionResult = deserializeReviewSession(JSON.stringify(record["reviewSession"]));
  if (!sessionResult.ok) {
    return { ok: false, reason: `invalid reviewSession: ${sessionResult.reason}` };
  }

  let focusResumePosition: FocusResumePosition | undefined;
  if ("focusResumePosition" in record && record["focusResumePosition"] !== undefined) {
    const resumeResult = deserializeFocusResumePosition(record["focusResumePosition"]);
    if (!resumeResult.ok) {
      return { ok: false, reason: `invalid focusResumePosition: ${resumeResult.reason}` };
    }
    focusResumePosition = resumeResult.position;
  }

  return {
    ok: true,
    saveFile: createWorkspaceSaveFile(record["documentId"], record["savedAt"], sessionResult.session, focusResumePosition),
  };
}

// Re-exported so nothing above needs two import lines for the same concept
// (schemaVersion constant kept alongside ReviewSession's own for readers
// cross-checking against ReviewSession.ts directly).
export { REVIEW_SESSION_SCHEMA_VERSION, serializeReviewSession };
