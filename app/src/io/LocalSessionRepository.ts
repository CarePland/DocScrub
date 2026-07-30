/**
 * LocalSessionRepository — architecture v0.2 §6.12/§8. Owns local
 * persistence: autosave, explicit save, crash/refresh recovery, schema
 * versioning, and (Milestone 3) the small amount of listing metadata Recent
 * Documents needs. Quota handling is a stated UX contract in v0.2, not just
 * an engineering risk: callers must be able to distinguish "about to hit
 * quota" from "failed to persist" so the UI can warn before reviewer
 * progress is at risk (§6.12, §8).
 *
 * MILESTONE 3 ("Reviewer Productivity"), Phase 1: this file was a signature
 * only (interface + QuotaStatus, no implementation) since the v0.2 doc pass.
 * Implementing it for real surfaced an OBJECTIVE INTERFACE DEFECT in the
 * original shape -- `save(session: ReviewSession)` / `load(sessionId)`
 * could not actually satisfy "recovery after refresh", the first bullet
 * Andrew's Phase 1 instruction names:
 *
 *   - A page refresh destroys every in-memory `File`/`DocumentModel`. Only
 *     ReviewSession was ever going to be persisted, but ReviewWorkspace.
 *     loadDocument() requires re-parsing an actual file to reconstruct
 *     DocumentModel/DetectionResult/GroupingResult/OccurrenceClassification
 *     Result (all pure, deterministic re-derivations of document bytes --
 *     see Workspace.ts's own top doc comment). With no bytes stored,
 *     "recover after refresh" would have meant "ask the reviewer to
 *     re-select the exact same file from disk before anything can resume,"
 *     which is not recovery, it's a re-import step with a good chance of
 *     the reviewer picking the wrong file or not having it handy.
 *   - `load(sessionId)` has no way to support Recent Documents (Phase 2):
 *     nothing enumerates what's stored, and a bare ReviewSession carries no
 *     fileName, no completion percentage, and no "when was this last
 *     opened" signal -- all explicitly named in Andrew's Phase 2 bullets.
 *
 * Fixed by keying storage on `documentId` (not `sessionId` -- matching
 * WorkspaceSaveFile's/Workspace.loadDocument()'s own restore gate, see
 * Workspace.ts) and widening the persisted unit from a bare ReviewSession to
 * a `SessionRecord`: the original file's bytes (re-parsing immutable bytes
 * is cheap and deterministic -- this app's own established precedent, see
 * DocumentModel.ts's v4 changelog) plus a `WorkspaceSaveFile` (reused
 * as-is, not duplicated -- see WorkspaceSaveFile.ts's own "derive, don't
 * duplicate" note) plus the small set of denormalized fields Recent
 * Documents needs to render a list WITHOUT re-parsing every stored document
 * on every landing-page paint (`fileName`, `lastOpenedAt`,
 * `reviewedCandidateCount`, `totalCandidateCount` -- computed once by
 * Workspace, the one place that already knows both numbers, at the moment
 * of save; see Workspace.ts's `computeSessionStats()`). `save`/`delete`/
 * `getQuotaStatus` keep their original names and single-purpose shape;
 * `load` now returns a `SessionRecord | null` instead of a bare
 * `ReviewSession | null`, and a new `listRecent()` was added -- additive to
 * this file's role, not a redesign of it.
 *
 * `load()` deliberately treats "opening a stored record" as also updating
 * `lastOpenedAt` (one write, as a natural part of what "opening" means)
 * rather than adding a separate `touch()`/`recordOpened()` method -- per
 * Andrew's own "avoid introducing unnecessary persistence complexity"
 * instruction, a second method whose only job is bumping one timestamp
 * would be exactly that.
 */

import type { ReviewSession } from "../domain/ReviewSession.js";
import type { WorkspaceSaveFile } from "../workspace/WorkspaceSaveFile.js";

export const SESSION_RECORD_SCHEMA_VERSION = 1 as const;

export type QuotaStatus = "ok" | "approaching-limit" | "exceeded";

/** The full stored unit for one document's review session -- everything
 *  needed to resume review after a page refresh with no other input from
 *  the reviewer. `fileBytes` is the ORIGINAL uploaded file, unmodified;
 *  ReviewWorkspace.loadDocument() re-parses it exactly as it would a
 *  freshly selected File (via a Blob->File wrapper -- see
 *  IndexedDbSessionRepository's own note on this), so re-parsing produces
 *  byte-identical candidate/group/occurrence IDs and the stored
 *  ReviewSession's decisions line up with them exactly as they did before
 *  the refresh (same determinism argument Workspace.ts's own top doc
 *  comment already makes for documentId-gated restore). */
export interface SessionRecord {
  schemaVersion: typeof SESSION_RECORD_SCHEMA_VERSION;
  documentId: string;
  fileName: string;
  fileBytes: Uint8Array;
  fileMimeType: string;
  /** Reuses WorkspaceSaveFile as-is (schemaVersion/documentId/savedAt/
   *  reviewSession/focusResumePosition) -- the exact bundle
   *  saveReviewSession already knows how to build and validate; not
   *  duplicated here. */
  saveFile: WorkspaceSaveFile;
  lastOpenedAt: string; // ISO 8601
  reviewedCandidateCount: number;
  totalCandidateCount: number;
}

/** The lightweight projection of a SessionRecord that Recent Documents
 *  (Phase 2) actually renders -- deliberately excludes `fileBytes` and the
 *  full `saveFile.reviewSession` so listing every stored document stays
 *  cheap even with several large reviews stored at once. `completionPercent`
 *  is derived here (not re-derived per render by the UI) so there is one
 *  formula for it, matching this codebase's "derive once, read everywhere"
 *  convention (e.g. ReviewSession.ts's own resolvedStatusOf()). */
export interface SessionSummary {
  documentId: string;
  fileName: string;
  savedAt: string;
  lastOpenedAt: string;
  reviewedCandidateCount: number;
  totalCandidateCount: number;
  /** 0-100, rounded; 0 when totalCandidateCount is 0 (nothing to divide
   *  by -- treated as "not started" rather than NaN/Infinity). */
  completionPercent: number;
}

export function deriveCompletionPercent(reviewedCandidateCount: number, totalCandidateCount: number): number {
  if (totalCandidateCount <= 0) return 0;
  return Math.round((reviewedCandidateCount / totalCandidateCount) * 100);
}

export function summarizeSessionRecord(record: SessionRecord): SessionSummary {
  return {
    documentId: record.documentId,
    fileName: record.fileName,
    savedAt: record.saveFile.savedAt,
    lastOpenedAt: record.lastOpenedAt,
    reviewedCandidateCount: record.reviewedCandidateCount,
    totalCandidateCount: record.totalCandidateCount,
    completionPercent: deriveCompletionPercent(record.reviewedCandidateCount, record.totalCandidateCount),
  };
}

/** Runtime shape guard, used by every concrete implementation before
 *  trusting a stored value -- a record from a future/incompatible schema
 *  version (or, in principle, a corrupted IndexedDB entry) is treated as
 *  "not present" rather than thrown, satisfying Andrew's "graceful handling
 *  of interrupted sessions" bullet without building a migration framework
 *  this project does not yet need (only one schema version has ever
 *  existed). Deliberately shallow -- it does not revalidate the nested
 *  ReviewSession/WorkspaceSaveFile shapes field-by-field (those already
 *  have their own schemaVersion guards, checked here), matching
 *  WorkspaceSaveFile.ts's own "each layer validates its own shape" pattern
 *  rather than one function trying to validate everything at once. */
export function isValidSessionRecord(value: unknown): value is SessionRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record["schemaVersion"] !== SESSION_RECORD_SCHEMA_VERSION) return false;
  if (typeof record["documentId"] !== "string" || !record["documentId"]) return false;
  if (typeof record["fileName"] !== "string") return false;
  if (!(record["fileBytes"] instanceof Uint8Array)) return false;
  if (typeof record["fileMimeType"] !== "string") return false;
  if (typeof record["lastOpenedAt"] !== "string") return false;
  if (typeof record["reviewedCandidateCount"] !== "number") return false;
  if (typeof record["totalCandidateCount"] !== "number") return false;
  const saveFile = record["saveFile"];
  if (typeof saveFile !== "object" || saveFile === null) return false;
  const saveFileRecord = saveFile as Record<string, unknown>;
  if (typeof saveFileRecord["documentId"] !== "string" || typeof saveFileRecord["reviewSession"] !== "object") return false;
  return true;
}

export interface LocalSessionRepository {
  save(record: SessionRecord): Promise<void>;
  /** Also updates the stored record's `lastOpenedAt` to `openedAt` -- see
   *  this file's top doc comment for why that's load()'s job rather than a
   *  separate method. Returns null if no record exists for `documentId`. */
  load(documentId: string, openedAt: string): Promise<SessionRecord | null>;
  delete(documentId: string): Promise<void>;
  /** Ordered most-recently-opened first. `limit` bounds how many summaries
   *  are returned (Recent Documents caps its landing-page list; see
   *  RECENT_DOCUMENTS_DISPLAY_LIMIT in app.ts) -- it does NOT evict storage;
   *  eviction is a separate, explicit policy (see
   *  IndexedDbSessionRepository's own RECENT_DOCUMENTS_STORAGE_CAP). */
  listRecent(limit?: number): Promise<SessionSummary[]>;
  getQuotaStatus(): Promise<QuotaStatus>;
}

/** ReviewSession re-exported for callers that only need the type this file
 *  used to expose directly, before SessionRecord wrapped it. */
export type { ReviewSession };
