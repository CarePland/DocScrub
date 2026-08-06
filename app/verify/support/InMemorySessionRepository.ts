/**
 * InMemorySessionRepository — LocalSessionRepository test double (Milestone
 * 3, Phase 1). IndexedDbSessionRepository.ts is the real implementation,
 * but it cannot be exercised in this sandbox's Node (no npm registry
 * access, so no fake-indexeddb polyfill can be installed -- a standing,
 * repeatedly documented constraint of this project; see
 * IndexedDbSessionRepository.ts's own doc comment). Every verify/*.ts suite
 * that constructs a real ReviewWorkspace now needs SOME sessionRepository
 * (Workspace.ts defaults to a real IndexedDbSessionRepository, which throws
 * immediately in Node -- `indexedDB is not defined`), so this double is
 * shared across every suite that touches document.saveReviewSession or any
 * review.* command (which now triggers autosave via reconcileFocus() --
 * see Workspace.ts's top doc comment), rather than each suite reimplementing
 * its own.
 *
 * Implements the exact same async, Promise-returning contract as the real
 * implementation (including load()'s lastOpenedAt-touch side effect and
 * listRecent()'s most-recently-opened-first ordering) so behavior exercised
 * against this double generalizes to the real one -- the same
 * "orchestration is proven here, the real browser wiring is proven by
 * Claude in Chrome" split this codebase already uses for OoxmlDocumentParser/
 * Rebuilder-adjacent browser-only concerns.
 */

import type { LocalSessionRepository, SessionRecord, SessionSummary, QuotaStatus, PersistedUiState } from "../../src/io/LocalSessionRepository.js";
import { summarizeSessionRecord } from "../../src/io/LocalSessionRepository.js";
import type { DecisionMemoryRecord } from "../../src/domain/DecisionMemory.js";

export class InMemorySessionRepository implements LocalSessionRepository {
  private readonly records = new Map<string, SessionRecord>();
  private readonly uiStates = new Map<string, PersistedUiState>();
  private readonly decisionMemory = new Map<string, DecisionMemoryRecord>();
  private quotaStatus: QuotaStatus = "ok";
  private failNextSave: string | null = null;

  async save(record: SessionRecord): Promise<void> {
    if (this.failNextSave) {
      const reason = this.failNextSave;
      this.failNextSave = null;
      throw new Error(reason);
    }
    this.records.set(record.documentId, record);
  }

  async load(documentId: string, openedAt: string): Promise<SessionRecord | null> {
    const record = this.records.get(documentId);
    if (!record) return null;
    const touched: SessionRecord = { ...record, lastOpenedAt: openedAt };
    this.records.set(documentId, touched);
    return touched;
  }

  async delete(documentId: string): Promise<void> {
    this.records.delete(documentId);
    this.uiStates.delete(documentId); // mirrors the real store: UI state dies with its session
    this.decisionMemory.delete(documentId); // ...and so does what it taught
  }

  async saveUiState(documentId: string, uiState: PersistedUiState): Promise<void> {
    this.uiStates.set(documentId, uiState);
  }

  async loadUiState(documentId: string): Promise<PersistedUiState | null> {
    return this.uiStates.get(documentId) ?? null;
  }

  async saveDecisionMemory(record: DecisionMemoryRecord): Promise<void> {
    this.decisionMemory.set(record.documentId, record);
  }

  async listDecisionMemory(excludeDocumentId?: string): Promise<DecisionMemoryRecord[]> {
    return [...this.decisionMemory.values()].filter((record) => record.documentId !== excludeDocumentId);
  }

  async listRecent(limit?: number): Promise<SessionSummary[]> {
    const summaries = [...this.records.values()]
      .map(summarizeSessionRecord)
      .sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
    return limit === undefined ? summaries : summaries.slice(0, limit);
  }

  async getQuotaStatus(): Promise<QuotaStatus> {
    return this.quotaStatus;
  }

  // ---- test-only control surface, not part of LocalSessionRepository ----

  /** Forces the NEXT save() call to reject with `reason` -- used to
   *  exercise "graceful handling of interrupted sessions" (a failed
   *  autosave/explicit save must not throw into a fire-and-forget caller
   *  or crash the reviewer's in-memory work). */
  simulateNextSaveFailure(reason: string): void {
    this.failNextSave = reason;
  }

  setQuotaStatus(status: QuotaStatus): void {
    this.quotaStatus = status;
  }

  /** Direct, synchronous inspection for assertions -- avoids every test
   *  needing to await load()/listRecent() (which also has the touching
   *  side effect) just to check what got persisted. */
  peek(documentId: string): SessionRecord | null {
    return this.records.get(documentId) ?? null;
  }

  size(): number {
    return this.records.size;
  }
}
