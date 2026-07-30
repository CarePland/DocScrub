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

import type { LocalSessionRepository, SessionRecord, SessionSummary, QuotaStatus } from "./LocalSessionRepository.js";
import { summarizeSessionRecord, isValidSessionRecord } from "./LocalSessionRepository.js";

const DB_NAME = "docscrub-sessions";
const DB_VERSION = 1;
const STORE_NAME = "sessions";

/** Storage-eviction cap, distinct from listRecent()'s display `limit` (see
 *  LocalSessionRepository.ts) -- this bounds how many session records this
 *  app will keep on disk at all, evicting the least-recently-opened once
 *  exceeded, so a reviewer who works through many documents over months
 *  doesn't accumulate unbounded IndexedDB usage. Matches Andrew's Phase 2
 *  "recently opened documents" framing -- old, no-longer-relevant reviews
 *  are meant to age out, not accumulate forever. */
const RECENT_DOCUMENTS_STORAGE_CAP = 10;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "documentId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
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
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(record);
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
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(documentId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("failed to delete session record"));
    });
  }

  async listRecent(limit = RECENT_DOCUMENTS_STORAGE_CAP): Promise<SessionSummary[]> {
    const db = await this.db();
    const raw = await requestToPromise(
      db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).getAll() as IDBRequest<unknown[]>
    );
    return raw
      .filter(isValidSessionRecord)
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
