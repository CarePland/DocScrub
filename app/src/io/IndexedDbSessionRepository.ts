/**
 * IndexedDbSessionRepository — the real, browser-only LocalSessionRepository
 * implementation (Milestone 3 Phase 1). One IndexedDB database, one object
 * store ("sessions"), keyed by documentId (see LocalSessionRepository.ts's
 * top doc comment for why documentId, not sessionId). SessionRecord's
 * `fileBytes` is stored as a plain Uint8Array -- IndexedDB's structured-clone
 * algorithm handles typed arrays natively, no base64/JSON encoding needed
 * (the same "don't hand-roll what the platform already does correctly"
 * judgment this codebase already applies elsewhere, e.g. CompressionStream
 * in ooxml/zip.ts).
 *
 * CANNOT BE UNIT-TESTED IN THIS SANDBOX'S NODE (no npm registry access, so
 * no fake-indexeddb polyfill can be installed -- a standing, repeatedly
 * documented constraint of this project). verify/milestone-3-reviewer-
 * productivity-verification.ts exercises Workspace's autosave/recovery
 * ORCHESTRATION logic against an InMemorySessionRepository test double
 * implementing the exact same interface instead; THIS class -- the real
 * IndexedDB wiring, and specifically an actual page refresh -- can only be
 * proven correct via real-browser validation (Claude in Chrome), which is
 * why that step is called out explicitly in this milestone's own
 * verification plan rather than treated as optional polish.
 */

import type { LocalSessionRepository, SessionRecord, SessionSummary, QuotaStatus, PersistedUiState } from "./LocalSessionRepository.js";
import { summarizeSessionRecord, isValidSessionRecord } from "./LocalSessionRepository.js";
import { isValidDecisionMemoryRecord, type DecisionMemoryRecord } from "../domain/DecisionMemory.js";
import { currentLocalSessionOwnerId } from "../account/localSessionOwner.js";

const DB_NAME = "docscrub-sessions";
// v2 (2026-08-02): adds the "ui-state" store -- document-tied UI snapshots
// (see LocalSessionRepository.ts's PersistedUiState). Existing v1 databases
// upgrade in place; onupgradeneeded's contains() checks make the migration
// idempotent.
// v3 (2026-08-03): adds the "decision-memory" store -- one small
// per-document projection of what was decided, so a later document can
// reuse it without an export/import round trip (see
// domain/DecisionMemory.ts). Separate from "sessions" on purpose: a
// SessionRecord carries the original document bytes, and this store is read
// on EVERY load. Existing v1/v2 databases upgrade in place; the contains()
// checks below keep the migration idempotent.
const DB_VERSION = 3;
const STORE_NAME = "sessions";
const UI_STATE_STORE = "ui-state";
const DECISION_MEMORY_STORE = "decision-memory";

/** Storage-eviction cap, distinct from listRecent()'s display `limit` (see
 *  LocalSessionRepository.ts) -- this bounds how many session records this
 *  app will keep on disk at all, evicting the least-recently-opened once
 *  exceeded, so a reviewer who works through many documents over months
 *  doesn't accumulate unbounded IndexedDB usage. Matches Andrew's Phase 2
 *  "recently opened documents" framing -- old, no-longer-relevant reviews
 *  are meant to age out, not accumulate forever. */
const RECENT_DOCUMENTS_STORAGE_CAP = 10;

function isVisibleToCurrentOwner(record: SessionRecord): boolean {
  const ownerId = currentLocalSessionOwnerId();
  if (!ownerId) return !record.ownerUserId;
  return record.ownerUserId === ownerId;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "documentId" });
      }
      if (!db.objectStoreNames.contains(UI_STATE_STORE)) {
        db.createObjectStore(UI_STATE_STORE, { keyPath: "documentId" });
      }
      if (!db.objectStoreNames.contains(DECISION_MEMORY_STORE)) {
        db.createObjectStore(DECISION_MEMORY_STORE, { keyPath: "documentId" });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      // MULTI-TAB UPGRADE SAFETY (2026-08-02, learned from the v1->v2
      // bump deadlocking behind other open tabs): when a FUTURE version
      // wants to upgrade, every live connection gets versionchange --
      // close ours so the upgrade can proceed; the next repository call
      // reopens at the new version. Without this, one stale tab blocks
      // every other tab's upgrade forever.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onblocked = () => {
      // An older tab still holds a previous-version connection. The open
      // resolves automatically once that tab closes/reloads; surface the
      // wait instead of hanging silently.
      console.warn("DocScrub: waiting for another tab to release the session database (close or reload other DocScrub tabs).");
    };
    request.onerror = () => reject(request.error ?? new Error("failed to open IndexedDB database"));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

export class IndexedDbSessionRepository implements LocalSessionRepository {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) this.dbPromise = openDatabase();
    return this.dbPromise;
  }

  async save(record: SessionRecord): Promise<void> {
    const db = await this.db();
    const ownerUserId = currentLocalSessionOwnerId();
    const ownedRecord: SessionRecord = { ...record, ownerUserId, archivedAt: null };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(ownedRecord);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("failed to save session record"));
      tx.onabort = () => reject(tx.error ?? new Error("save transaction aborted (likely quota exceeded)"));
    });
    await this.evictOldestBeyondCap(db);
  }

  async load(documentId: string, openedAt: string): Promise<SessionRecord | null> {
    const db = await this.db();
    const record = await requestToPromise(
      db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(documentId) as IDBRequest<unknown>
    );
    if (!isValidSessionRecord(record)) return null;
    if (!isVisibleToCurrentOwner(record) || record.archivedAt) return null;
    const touched: SessionRecord = { ...record, lastOpenedAt: openedAt };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(touched);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("failed to update lastOpenedAt"));
    });
    return touched;
  }

  async delete(documentId: string): Promise<void> {
    const db = await this.db();
    await new Promise<void>((resolve, reject) => {
      // One transaction, all three stores: the UI snapshot and the decision
      // memory both have no meaning without their session (see
      // LocalSessionRepository.saveUiState/saveDecisionMemory).
      const tx = db.transaction([STORE_NAME, UI_STATE_STORE, DECISION_MEMORY_STORE], "readwrite");
      tx.objectStore(STORE_NAME).delete(documentId);
      tx.objectStore(UI_STATE_STORE).delete(documentId);
      // Removing a document forgets what it taught, too -- otherwise
      // "remove from list" would leave decisions silently influencing
      // future documents with no visible source to point at.
      tx.objectStore(DECISION_MEMORY_STORE).delete(documentId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("failed to delete session record"));
    });
  }

  async archive(documentId: string, archivedAt: string): Promise<void> {
    const db = await this.db();
    const record = await requestToPromise(
      db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(documentId) as IDBRequest<unknown>
    );
    if (!isValidSessionRecord(record) || !isVisibleToCurrentOwner(record)) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put({ ...record, archivedAt });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("failed to archive session record"));
    });
  }

  async restore(documentId: string): Promise<void> {
    const db = await this.db();
    const record = await requestToPromise(
      db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(documentId) as IDBRequest<unknown>
    );
    if (!isValidSessionRecord(record) || !isVisibleToCurrentOwner(record)) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put({ ...record, archivedAt: null });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("failed to restore session record"));
    });
  }

  async saveUiState(documentId: string, uiState: PersistedUiState): Promise<void> {
    const db = await this.db();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(UI_STATE_STORE, "readwrite");
      tx.objectStore(UI_STATE_STORE).put({ documentId, uiState });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("failed to save ui state"));
    });
  }

  async loadUiState(documentId: string): Promise<PersistedUiState | null> {
    const db = await this.db();
    const row = await requestToPromise(
      db.transaction(UI_STATE_STORE, "readonly").objectStore(UI_STATE_STORE).get(documentId) as IDBRequest<unknown>
    );
    if (!row || typeof row !== "object") return null;
    const uiState = (row as { uiState?: unknown }).uiState;
    return uiState && typeof uiState === "object" ? (uiState as PersistedUiState) : null;
  }

  async saveDecisionMemory(record: DecisionMemoryRecord): Promise<void> {
    const db = await this.db();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(DECISION_MEMORY_STORE, "readwrite");
      tx.objectStore(DECISION_MEMORY_STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("failed to save decision memory"));
    });
  }

  async listDecisionMemory(excludeDocumentId?: string): Promise<DecisionMemoryRecord[]> {
    const db = await this.db();
    const rows = await requestToPromise(
      db.transaction(DECISION_MEMORY_STORE, "readonly").objectStore(DECISION_MEMORY_STORE).getAll() as IDBRequest<unknown[]>
    );
    // Structurally validated on the way out, same defensive posture
    // isValidSessionRecord gives the sessions store: a record written by an
    // older/newer shape degrades this feature to "no memory" rather than
    // throwing on a load path the reviewer cannot route around.
    return (rows ?? []).filter(isValidDecisionMemoryRecord).filter((record) => record.documentId !== excludeDocumentId);
  }

  async listRecent(limit = RECENT_DOCUMENTS_STORAGE_CAP, options: { archived?: boolean } = {}): Promise<SessionSummary[]> {
    const db = await this.db();
    const raw = await requestToPromise(
      db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll() as IDBRequest<unknown[]>
    );
    const archived = options.archived === true;
    return raw
      .filter(isValidSessionRecord)
      .filter((record) => isVisibleToCurrentOwner(record) && Boolean(record.archivedAt) === archived)
      .map(summarizeSessionRecord)
      .sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt))
      .slice(0, limit);
  }

  /** Best-effort: `navigator.storage.estimate()` is not available in every
   *  browser context (e.g. some private-browsing modes) -- absence is
   *  treated as "ok" rather than surfaced as an error, since the actual
   *  failure mode this status exists to warn about (an imminent
   *  QuotaExceededError on save()) is separately caught and reported by
   *  save() itself regardless of whether this estimate was available. */
  async getQuotaStatus(): Promise<QuotaStatus> {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) return "ok";
    try {
      const { usage, quota } = await navigator.storage.estimate();
      if (usage === undefined || quota === undefined || quota === 0) return "ok";
      const ratio = usage / quota;
      if (ratio >= 0.98) return "exceeded";
      if (ratio >= 0.85) return "approaching-limit";
      return "ok";
    } catch {
      return "ok";
    }
  }

  private async evictOldestBeyondCap(db: IDBDatabase): Promise<void> {
    const all = await requestToPromise(
      db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll() as IDBRequest<SessionRecord[]>
    );
    if (all.length <= RECENT_DOCUMENTS_STORAGE_CAP) return;
    const sorted = [...all].sort((a, b) => a.lastOpenedAt.localeCompare(b.lastOpenedAt)); // oldest first
    const toEvict = sorted.slice(0, all.length - RECENT_DOCUMENTS_STORAGE_CAP);
    if (toEvict.length === 0) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      for (const record of toEvict) store.delete(record.documentId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("failed to evict oldest session records"));
    });
  }
}
