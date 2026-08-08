/**
 * CommandDispatcher — architecture v0.2 §6.10/§9/§12. A single command path
 * for keyboard, pointer, toolbar, menu, and future accessibility inputs, but
 * split into per-family dispatch methods (rather than one flat
 * dispatch(command) signature) so it routes commands instead of owning
 * domain behavior itself (§6.10's own warning against becoming "a dumping
 * ground").
 *
 * v2 (Phase 9): dispatchNavigation's return type corrected from FocusState
 * to CommandResult (see FocusNavigator.ts's own v2 note for why).
 *
 * v3 (Phase 10): WorkspaceCommandDispatcher below is the real
 * implementation, composing exactly one ReviewWorkspace. Every method here
 * ORCHESTRATES -- it looks up which engine a command belongs to (by its
 * `family` discriminant, already established by Commands.ts), calls that
 * engine's own dispatch/reconcile method, and returns what that engine
 * returned. It contains no review or navigation logic of its own:
 *
 *   review.*      -> ReviewWorkspace.getReviewEngine().dispatch(command),
 *                     then ReviewWorkspace.reconcileFocus() on success --
 *                     this one line IS "trigger focus reconciliation" from
 *                     Andrew's Phase 10 instruction; it is the dispatcher's
 *                     job specifically because ReviewEngine must not know
 *                     FocusNavigator exists (and vice versa) -- something
 *                     has to sit above both to wire the two together, and
 *                     that is this class's entire reason for existing.
 *   navigation.*  -> ReviewWorkspace.getFocusNavigator().dispatch(command,
 *                     session) -- FocusNavigator already refuses to
 *                     auto-reconcile on its own (Phase 9), by design, so
 *                     nothing extra happens here.
 *   document.*    -> ReviewWorkspace's own async operations
 *                     (loadDocument/generateOutput/saveReviewSession/
 *                     generateAudit -- Phase 11 added the last one; audit
 *                     assembly logic lives entirely on Workspace, this
 *                     dispatcher only routes to it, per Andrew's explicit
 *                     "do not move audit logic into CommandDispatcher"
 *                     instruction).
 *   history.*     -> honestly rejected. See dispatchHistory's own doc
 *                     comment: no engine in this codebase owns reversible
 *                     history, so there is nothing to route to. Andrew's
 *                     instruction to "avoid embedding business logic inside
 *                     the dispatcher" cuts both ways -- it would be just as
 *                     wrong to fake an undo stack here as it would be to
 *                     duplicate ReviewEngine's decision logic here.
 *
 * "The dispatcher should be able to explain why a command resolved to a
 * particular action" (Andrew's Phase 10 instruction) is implemented as
 * `explainCommandRouting()` below -- a small, pure, deterministic function
 * from a command to a one-line description of which engine method it
 * routes to and why. This is a ROUTING explanation (which engine, and the
 * architectural reason), distinct from ExplanationEngine's job (translating
 * Evidence[] into reviewer-facing prose about WHY a candidate was flagged)
 * -- the two are not conflated; ExplanationEngine remains a signature only
 * and is not needed for this.
 */

import type {
  ReviewCommand,
  NavigationCommand,
  ApplicationCommand,
  HistoryCommand,
  ReviewTransactionResult,
  CommandResult,
  AnyCommand,
} from "../domain/Commands.js";
import type { KeyEvent } from "../engines/navigation/keymap.js";
import type { WorkspaceState } from "./Workspace.js";
import { ReviewWorkspace } from "./Workspace.js";
import { createWorkspaceSaveFile, serializeWorkspaceSaveFile, type WorkspaceSaveFile } from "./WorkspaceSaveFile.js";
import type { AuditArtifacts } from "../io/AuditExporter.js";
import type { SessionSummary, PersistedUiState } from "../io/LocalSessionRepository.js";
import type { ReplacementRuleConfig } from "../domain/ReplacementRule.js";

export interface CommandDispatcher {
  dispatchReview(command: ReviewCommand): ReviewTransactionResult;
  /** Result only -- read the resulting focus via WorkspaceState.focus. */
  dispatchNavigation(command: NavigationCommand): CommandResult;
  /** May involve I/O (loading a file, generating output, saving a session) --
   *  this is the one family where async is appropriate at the dispatcher
   *  boundary itself. */
  dispatchApplication(command: ApplicationCommand): Promise<CommandResult>;
  dispatchHistory(command: HistoryCommand): ReviewTransactionResult;
}

/**
 * Pure, deterministic routing explanation -- no engine access, no state.
 * Exists so a UI (or a test) can ask "why did this command go where it
 * went" without needing to inspect dispatcher internals.
 */
export function explainCommandRouting(command: AnyCommand): string {
  switch (command.family) {
    case "review":
      return `review.${command.type} -> ReviewEngine.dispatch() (durable reviewer intent), then FocusNavigator.reconcile() if accepted`;
    case "navigation":
      return `navigation.${command.type} -> FocusNavigator.dispatch() (transient interaction focus only -- never touches ReviewEngine)`;
    case "document":
      return `document.${command.type} -> Workspace orchestration (pipeline load / rebuild+verify / session snapshot)`;
    case "history":
      return `history.${command.type} -> rejected: no engine in this codebase currently owns reversible history`;
    default: {
      const exhaustive: never = command;
      return `unroutable command: ${JSON.stringify(exhaustive)}`;
    }
  }
}

export class WorkspaceCommandDispatcher implements CommandDispatcher {
  private readonly workspace: ReviewWorkspace;
  private lastSaveFile: string | null = null;

  constructor(workspace: ReviewWorkspace) {
    this.workspace = workspace;
  }

  dispatchReview(command: ReviewCommand): ReviewTransactionResult {
    const engine = this.workspace.getReviewEngine();
    if (!engine) return { ok: false, reason: "no document loaded" };
    const result = engine.dispatch(command);
    if (result.ok) this.workspace.reconcileFocus();
    return result;
  }

  dispatchNavigation(command: NavigationCommand): CommandResult {
    const navigator = this.workspace.getFocusNavigator();
    const engine = this.workspace.getReviewEngine();
    if (!navigator || !engine) return { ok: false, reason: "no document loaded" };
    return navigator.dispatch(command, engine.getState());
  }

  async dispatchApplication(command: ApplicationCommand): Promise<CommandResult> {
    switch (command.type) {
      case "load": {
        const result = await this.workspace.loadDocument(command.file);
        return result.ok ? { ok: true } : { ok: false, reason: result.reason };
      }
      case "generateOutput":
        return this.workspace.generateOutput();
      case "saveReviewSession":
        return this.saveReviewSession();
      case "generateAudit":
        return this.workspace.generateAudit();
      case "importDecisions":
        return this.workspace.importDecisions(command.file);
      case "resumeSession": {
        const result = await this.workspace.resumeFromRepository(command.documentId);
        return result.ok ? { ok: true } : { ok: false, reason: result.reason };
      }
      case "setReplacementRuleConfig":
        return this.workspace.setReplacementRuleConfig(command.config);
      default: {
        const exhaustive: never = command;
        return { ok: false, reason: `unknown application command: ${JSON.stringify(exhaustive)}` };
      }
    }
  }

  /**
   * history.undo/history.redo are accepted into the namespace (they type-
   * check, they route here) but always honestly rejected: ReviewSession's
   * own reducer (session.ts) only ever applies a command forward and
   * appends an event -- there is no reverse transition, no command log
   * replay, and no snapshot stack anywhere in this codebase yet. Building
   * one now, inside the dispatcher, purely because Phase 10 wires commands
   * together would be exactly the "business logic inside the dispatcher"
   * Andrew's instruction warns against, and would put reversible-history
   * logic in the one place architecturally worst suited to own it. If a
   * future phase adds this, it belongs on ReviewEngine (the durable-state
   * owner), with this method changed to route to it -- not implemented as
   * a parallel mechanism here.
   */
  dispatchHistory(command: HistoryCommand): ReviewTransactionResult {
    void command;
    return {
      ok: false,
      reason: "undo/redo is not yet implemented -- no engine currently owns reversible history (see WorkspaceCommandDispatcher.ts's dispatchHistory doc comment)",
    };
  }

  /** Pure convenience passthrough -- resolves a raw key event against the
   *  CURRENT focus via FocusNavigator.resolveKey(), or null if no document
   *  is loaded or the key has no meaning in the current context. Does not
   *  itself add a browser key listener (FocusNavigator's own "thin
   *  adapter" constraint, Phase 9) -- a UI calls this from its own
   *  keydown handler and dispatches whatever comes back through the
   *  appropriate dispatch*() method above, by `command.family`. */
  resolveKeyboardCommand(event: KeyEvent): AnyCommand | null {
    return this.workspace.getFocusNavigator()?.resolveKey(event) ?? null;
  }

  /** Passthrough -- the dispatcher's own "expose resulting application
   *  state" responsibility (Andrew's Phase 10 instruction). A caller only
   *  needs to hold this dispatcher, not the Workspace directly. */
  getState(): WorkspaceState {
    return this.workspace.getState();
  }

  explain(command: AnyCommand): string {
    return explainCommandRouting(command);
  }

  /**
   * Computes a fresh WorkspaceSaveFile from CURRENT review/focus state and
   * caches its serialized form -- since ApplicationCommand's dispatch
   * surface returns only ok/reason (no payload channel), the resulting
   * snapshot is exposed via getLastSaveFile() afterward, exactly the same
   * "expose resulting state via a separate read" pattern used for
   * load/generateOutput (verification/document state read via getState()).
   */
  private async saveReviewSession(): Promise<CommandResult> {
    const engine = this.workspace.getReviewEngine();
    const navigator = this.workspace.getFocusNavigator();
    const document = this.workspace.getDocument();
    if (!engine || !navigator || !document) return { ok: false, reason: "no document loaded" };
    const session = engine.getState();
    const resumePosition = navigator.captureResumePosition(session.updatedAt);
    const saveFile = createWorkspaceSaveFile(document.documentId, session.updatedAt, session, resumePosition);
    this.lastSaveFile = serializeWorkspaceSaveFile(saveFile);
    // Milestone 3, Phase 1: an explicit save now ALSO persists to
    // sessionRepository (awaited, unlike autosave -- see
    // ReviewWorkspace.saveReviewSessionExplicit()'s own doc comment), so the
    // CommandResult a reviewer sees reflects whether their work is actually
    // durable, not just cached as a downloadable string in getLastSaveFile().
    return this.workspace.saveReviewSessionExplicit();
  }

  /** The JSON produced by the most recent successful document.saveReviewSession
   *  dispatch, or null if none has run yet this session. */
  getLastSaveFile(): string | null {
    return this.lastSaveFile;
  }

  /** Passthrough to ReviewWorkspace.getLastAuditArtifacts() -- audit
   *  assembly itself lives entirely on Workspace (see AuditExporter.ts/
   *  Workspace.generateAudit()); this dispatcher only routes
   *  `document.generateAudit` to it and exposes the result the same way
   *  getLastSaveFile() exposes saveReviewSession's. */
  getLastAuditArtifacts(): AuditArtifacts | null {
    return this.workspace.getLastAuditArtifacts();
  }

  /** Passthrough for Recent Documents (Milestone 3, Phase 2) -- a pure
   *  read, so it is exposed directly rather than routed through
   *  dispatchApplication() the same way getState() is (matches the
   *  precedent that reads don't need a command). */
  listRecentSessions(limit?: number): Promise<SessionSummary[]> {
    return this.workspace.listRecentSessions(limit);
  }

  listArchivedSessions(limit?: number): Promise<SessionSummary[]> {
    return this.workspace.listArchivedSessions(limit);
  }

  /** Passthrough for a Recent Documents "remove" affordance. */
  deleteStoredSession(documentId: string): Promise<void> {
    return this.workspace.deleteStoredSession(documentId);
  }

  archiveStoredSession(documentId: string): Promise<void> {
    return this.workspace.archiveStoredSession(documentId);
  }

  restoreStoredSession(documentId: string): Promise<void> {
    return this.workspace.restoreStoredSession(documentId);
  }

  /** Passthrough for the reopen prompt's "do you already know this file?"
   *  check. Non-mutating by design -- see Workspace.findStoredSession(). */
  findStoredSession(documentId: string): Promise<SessionSummary | null> {
    return this.workspace.findStoredSession(documentId);
  }

  /** Passthrough so a caller that must READ BACK a just-written session
   *  (notably: refreshing Recent Documents right after a load) can wait for
   *  the load's own fire-and-forget autosave to land first. See
   *  Workspace.autosaveSettled() for why this is not a way to make autosave
   *  blocking. Same "reads don't need a command" precedent as
   *  listRecentSessions(). */
  autosaveSettled(): Promise<void> {
    return this.workspace.autosaveSettled();
  }

  /** UI-STATE PERSISTENCE (AG, 2026-08-02) passthroughs -- document-tied
   *  UI snapshots (see LocalSessionRepository.PersistedUiState); pure
   *  storage access, same "don't route through a command" precedent as
   *  listRecentSessions(). */
  saveUiState(documentId: string, uiState: PersistedUiState): Promise<void> {
    return this.workspace.saveUiState(documentId, uiState);
  }

  loadUiState(documentId: string): Promise<PersistedUiState | null> {
    return this.workspace.loadUiState(documentId);
  }

  /** Passthrough reads for the Redaction Rules panel (Milestone 3, Phase
   *  3) -- pure reads, same "don't route through a command" precedent as
   *  listRecentSessions()/getState(). */
  getReplacementRuleConfig(): ReplacementRuleConfig {
    return this.workspace.getReplacementRuleConfig();
  }

  previewReplacements(config: ReplacementRuleConfig): Map<string, string> | null {
    return this.workspace.previewReplacements(config);
  }

  /**
   * Loads `file` and attempts to restore `saveFile`'s ReviewSession/
   * FocusResumePosition on top of it. Workspace.loadDocument() performs the
   * documentId gate (see Workspace.ts's top doc comment) -- this method
   * only translates its result into the dispatcher's own CommandResult
   * vocabulary, distinguishing "loaded with the restored session" from
   * "loaded, but the save file didn't match this document" so a caller
   * never mistakes the latter for a successful resume.
   */
  async loadSavedSession(file: File, saveFile: WorkspaceSaveFile): Promise<CommandResult> {
    const result = await this.workspace.loadDocument(file, saveFile.reviewSession, saveFile.focusResumePosition);
    if (!result.ok) return { ok: false, reason: result.reason };
    if (!result.sessionRestored) {
      return { ok: false, reason: "document loaded, but the saved session's documentId did not match this file -- started a fresh session instead" };
    }
    return { ok: true };
  }
}
