/**
 * Workspace — architecture v0.2, Phase 10 (NEW, this phase's own
 * composition layer, not previously named in the v0.2 architecture doc).
 * ReviewWorkspace is the ORCHESTRATION root: it owns the sequence of calls
 * that turns a loaded File into pipeline output, a durable review session,
 * and interaction focus, and it derives the small set of display-facing
 * signals (stage completion, unresolved counts, verification/export
 * readiness) a UI needs. It does not reimplement anything any engine
 * already owns:
 *
 *   DocumentParser        -> DocumentModel
 *   DetectionEngine        -> DetectionResult                 (pure, sync)
 *   CandidateQualityEngine -> QualityResult                    (pure, sync)
 *   EntityResolutionEngine -> GroupingResult                   (pure, sync)
 *   OccurrenceClassifier   -> OccurrenceClassificationResult   (pure, sync)
 *   DurableReviewEngine    -> durable ReviewSession (Phase 8)
 *   DeterministicFocusNavigator -> transient FocusState (Phase 9)
 *   DocumentRebuilder      -> rebuilt DOCX Blob                (async I/O)
 *   OutputVerifier         -> VerificationReport                (async I/O)
 *
 * Everything from DetectionEngine through OccurrenceClassifier is
 * synchronous and deterministic (already true of each of those engines
 * individually -- see their own doc comments), so loadDocument() only needs
 * to be async for the two genuine I/O boundaries: reading the File
 * (DocumentParser) and, later, rebuilding/verifying (both inherently
 * async). This keeps "sync logic sync, async only at true I/O boundaries"
 * true at the orchestration layer too, not just within each engine.
 *
 * WHAT WORKSPACE DELIBERATELY DOES NOT DO:
 * - It does not decide review outcomes (ReviewEngine's job), compute focus
 *   targets (FocusNavigator's job), classify occurrences, score candidates,
 *   or detect anything. It calls exactly one method on each engine, once,
 *   in the fixed pipeline order above, and stores whatever comes back.
 * - It does not maintain a second copy of "is this candidate resolved" or
 *   "which stage is complete" -- WorkspaceReadiness below is computed by
 *   reading FocusNavigator.stageStatus()/allStageStatuses(), which itself
 *   already reads ReviewEngine's session through the shared
 *   review/coverage.ts helper (Phase 8/9). Workspace only combines
 *   already-derived signals; see getState() below for the one arithmetic
 *   step this file performs itself (exportEnabled = reviewComplete &&
 *   verification.passed), which is orchestration, not a business rule.
 * - It does not implement undo/redo. No engine in this codebase owns
 *   reversible history yet (see WorkspaceCommandDispatcher.ts's
 *   dispatchHistory doc comment) -- Workspace does not invent one just
 *   because integration would make a fake version convenient.
 *
 * INTEGRATION ASSUMPTION, stated explicitly (per Andrew's Phase 10
 * instruction): a VerificationReport is only trustworthy for the EXACT
 * ReviewSession state it was computed against. If a reviewer changes any
 * decision after generateOutput() has run, the previous report describes a
 * rebuild of a session that no longer exists. Rather than requiring every
 * call site that mutates the session to remember to invalidate a cached
 * verification flag (an easy thing to forget, and exactly the kind of
 * "duplicated business logic" Andrew's instruction warns against),
 * verification validity is a DERIVED comparison against
 * ReviewSession.updatedAt, recomputed on every getState() call -- see
 * `verifiedSessionUpdatedAt` below. This cannot go stale by omission,
 * because there is no boolean to forget to flip.
 *
 * INTEGRATION ASSUMPTION: resuming a saved ReviewSession is gated on
 * `WorkspaceSaveFile.documentId` matching the freshly re-parsed document's
 * own `documentId` (a content hash -- see DocumentModel.ts). Since
 * Detection/Quality/EntityResolution/OccurrenceClassifier are pure
 * deterministic functions of DocumentModel content, re-parsing
 * byte-identical bytes reproduces byte-identical candidate/group/
 * occurrence IDs, so a documentId match is sufficient proof the saved
 * session's IDs are still meaningful -- no per-candidate revalidation is
 * needed on top of it. A mismatch (the reviewer picked a different or
 * edited file) is rejected outright rather than silently adopting a
 * session whose IDs may no longer correspond to anything real; see
 * loadDocument()'s `sessionRestoreRejectedReason` result field.
 *
 * MILESTONE 3 ("Reviewer Productivity"), Phase 1: Workspace now owns
 * autosave. `loadDocument()` caches the original file's bytes (read once,
 * via `file.arrayBuffer()` -- immutable and cheap to re-derive, this app's
 * own established precedent, see DocumentModel.ts's v4 changelog) alongside
 * the parsed pipeline output; `reconcileFocus()` -- already the single
 * choke point every successful review.* command passes through (Phase 9/10)
 * -- now ALSO schedules a fire-and-forget autosave of the current
 * ReviewSession + those cached bytes to `sessionRepository`
 * (LocalSessionRepository.ts), queued so overlapping saves from rapid
 * consecutive decisions serialize instead of racing. This required no new
 * call site anywhere outside this file: every command family that mutates
 * ReviewSession already calls reconcileFocus() exactly once on success
 * (CommandDispatcher.dispatchReview(), Workspace.importDecisions()), so
 * hooking autosave there covers bulkApplyDecision, confirmGroup, Not Quite,
 * decision reuse, and ordinary per-candidate decisions uniformly, for free.
 * `resumeFromRepository()` is the new symmetric entry point for "recovery
 * after refresh"/"resume previous review": it loads a SessionRecord by
 * documentId, reconstructs a File from its stored bytes, and calls
 * loadDocument() exactly as if the reviewer had re-picked that file
 * themselves -- the existing documentId-gated restore logic above is reused
 * completely unchanged, not duplicated for the resume path.
 */

import type { DocumentModel } from "../domain/DocumentModel.js";
import type { ReviewSession } from "../domain/ReviewSession.js";
import type { VerificationReport } from "../domain/VerificationReport.js";
import type { FocusState, StageStatus } from "../domain/FocusState.js";
import type { FocusResumePosition } from "../domain/FocusResumePosition.js";
import type { CommandResult } from "../domain/Commands.js";
import { createWorkspaceSaveFile } from "./WorkspaceSaveFile.js";

import { OoxmlDocumentParser, type DocumentParser } from "../io/DocumentParser.js";
import { OoxmlDocumentRebuilder, type DocumentRebuilder } from "../io/DocumentRebuilder.js";
import { OoxmlOutputVerifier, type OutputVerifier } from "../io/OutputVerifier.js";
import { DeterministicAuditExporter, type AuditExporter, type AuditArtifacts } from "../io/AuditExporter.js";

import { RegexDetectionEngine, type DetectionEngine, type DetectionResult } from "../engines/DetectionEngine.js";
import {
  RegexCandidateQualityEngine,
  buildDefaultScoringProfileSnapshot,
  type CandidateQualityEngine,
} from "../engines/CandidateQualityEngine.js";
import { RegexEntityResolutionEngine, type EntityResolutionEngine, type GroupingResult } from "../engines/EntityResolutionEngine.js";
import { RegexOccurrenceClassifier, type OccurrenceClassifier, type OccurrenceClassificationResult } from "../engines/OccurrenceClassifier.js";
import type { QualityResult } from "../domain/Evidence.js";

import { DurableReviewEngine, type Clock } from "../engines/ReviewEngine.js";
import { createReviewSession } from "../engines/review/session.js";
import { DeterministicFocusNavigator, type FocusNavigator } from "../engines/FocusNavigator.js";
import type { NavigationContext } from "../engines/navigation/navigator.js";
import { DeterministicDecisionReuseEngine, type DecisionReuseEngine } from "../engines/DecisionReuseEngine.js";
import { deserializeImportedDecisions } from "../io/DecisionImport.js";
import type { DecisionReuseMatchTier } from "../domain/DecisionReuse.js";
import { IndexedDbSessionRepository } from "../io/IndexedDbSessionRepository.js";
import {
  SESSION_RECORD_SCHEMA_VERSION,
  type LocalSessionRepository,
  type SessionRecord,
  type SessionSummary,
  type QuotaStatus,
} from "../io/LocalSessionRepository.js";
import { DeterministicReplacementRuleEngine, type ReplacementRuleEngine } from "../engines/ReplacementRuleEngine.js";
import { defaultReplacementRuleConfig, type ReplacementRuleConfig } from "../domain/ReplacementRule.js";

const defaultClock: Clock = () => new Date().toISOString();

/** Duplicated as a literal, not imported, from DocumentRebuilder.ts's own
 *  private DOCX_MIME_TYPE constant -- used here only as a fallback when
 *  `File.type` is empty (some browsers/OSes do not set a MIME type for
 *  .docx uploads), a small enough literal that importing across an
 *  otherwise-unrelated module boundary was not worth it. */
const DEFAULT_DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export interface WorkspaceDependencies {
  parser?: DocumentParser;
  detectionEngine?: DetectionEngine;
  qualityEngine?: CandidateQualityEngine;
  resolutionEngine?: EntityResolutionEngine;
  occurrenceClassifier?: OccurrenceClassifier;
  rebuilder?: DocumentRebuilder;
  verifier?: OutputVerifier;
  auditExporter?: AuditExporter;
  decisionReuseEngine?: DecisionReuseEngine;
  clock?: Clock;
  sessionRepository?: LocalSessionRepository;
  replacementRuleEngine?: ReplacementRuleEngine;
  /** FOUND DURING BROWSER VALIDATION (Milestone 3, Phase 1): autosave is
   *  fire-and-forget, so nothing was ever telling the UI a background save
   *  had finished -- app.ts only re-renders in response to a user-
   *  triggered dispatch, never on its own. The observable symptom: the
   *  persistence-status line computed the right VALUE the instant a
   *  reviewer looked at it via getState(), but the DOM showing it never
   *  updated from "Saving…" to "All changes saved" until some unrelated
   *  click happened to trigger another render() -- actively misleading for
   *  exactly the "reviewer confidence about not losing work" success
   *  criterion this phase exists to satisfy. This optional callback is the
   *  minimal fix: Workspace notifies whoever constructed it every time
   *  persistence status changes (success or failure), and a UI wires it to
   *  its own render() -- the same "Workspace owns state, callers own
   *  presentation" boundary this file's top doc comment already draws
   *  everywhere else, not a new exception to it. */
  onPersistenceChange?: () => void;
}

/** Display-facing summary of Workspace's own autosave/quota state
 *  (Milestone 3, Phase 1) -- exposed via WorkspaceState.persistence so a UI
 *  can show "All changes saved" / "Could not save" confidence signals
 *  without polling the repository directly. `lastAutosaveAt` mirrors
 *  ReviewSession.updatedAt at the moment of the most recent SUCCESSFUL
 *  save -- a UI can compare it against the current session's own
 *  `updatedAt` the same way `verifiedSessionUpdatedAt` already lets
 *  getState() detect staleness elsewhere in this file, without a second
 *  boolean to keep in sync. */
export interface WorkspacePersistenceStatus {
  lastAutosaveAt: string | null;
  lastAutosaveError: string | null;
  quotaStatus: QuotaStatus;
}

const EMPTY_PERSISTENCE_STATUS: WorkspacePersistenceStatus = {
  lastAutosaveAt: null,
  lastAutosaveError: null,
  quotaStatus: "ok",
};

/** Display-facing summary of the most recent document.importDecisions call
 *  (Feature 002) -- exposed via getLastDecisionReuseSummary() the same way
 *  saveReviewSession/generateAudit expose their results via a separate
 *  getter (ApplicationCommand's dispatch surface returns only ok/reason).
 *  appliedCount/skippedAlreadyDecidedCount are derived by Workspace
 *  comparing session state immediately before and after dispatching
 *  applyDecisionReuse -- NOT duplicated business logic: this is the exact
 *  same "already decided" test session.ts's own reducer case applies,
 *  recomputed here only because ReviewTransactionResult has no payload
 *  channel to report it back through directly (matches this file's own
 *  "combines already-derived signals" role for WorkspaceReadiness). */
export interface DecisionReuseSummary {
  sourceDocumentId: string;
  sourceSessionId: string;
  proposalCount: number;
  tierCounts: Record<DecisionReuseMatchTier, number>;
  appliedCount: number;
  skippedAlreadyDecidedCount: number;
}

export interface WorkspaceReadiness {
  /** Mirrors FocusNavigator's own "output" StageStatus.available -- true
   *  once every item-check candidate is resolved. Not recomputed here;
   *  read directly from stages.ts's already-derived rule. */
  reviewComplete: boolean;
  unresolvedItemCount: number;
  /** True once a VerificationReport exists AND it was computed against the
   *  CURRENT ReviewSession state (see this file's top doc comment on
   *  verification staleness). False after any decision changes until
   *  generateOutput() is run again. */
  verificationCurrent: boolean;
  verificationPassed: boolean | null;
  verificationWarningCount: number;
  verificationBlockerCount: number;
  /** verificationCurrent && verificationPassed === true. The only place
   *  Workspace combines two already-derived facts into a third -- pure
   *  orchestration, not a duplicated pass/fail rule (OutputVerifier's own
   *  `passed` field is never recomputed here). */
  exportEnabled: boolean;
}

export interface WorkspaceState {
  documentId: string | null;
  fileName: string | null;
  documentLoaded: boolean;
  processingWarnings: string[];
  /** Read-only references to the pipeline's own output, exposed as-is so a
   *  UI can render item lists (candidate display values, group canonical
   *  names, occurrence context) without Workspace building any parallel
   *  "display list" structure of its own -- these ARE DetectionEngine's/
   *  EntityResolutionEngine's/OccurrenceClassifier's actual return values,
   *  not a derived copy. All four are immutable for the lifetime of one
   *  loaded document (Workspace never re-derives them until the next
   *  loadDocument() call). Null only when no document is loaded. */
  detection: DetectionResult | null;
  quality: QualityResult | null;
  grouping: GroupingResult | null;
  classification: OccurrenceClassificationResult | null;
  reviewSession: ReviewSession | null;
  focus: FocusState | null;
  stageStatuses: StageStatus[];
  readiness: WorkspaceReadiness;
  verification: VerificationReport | null;
  hasGeneratedOutput: boolean;
  /** Milestone 3, Phase 1 -- see WorkspacePersistenceStatus above. */
  persistence: WorkspacePersistenceStatus;
}

export type LoadDocumentResult =
  | { ok: true; sessionRestored: boolean }
  | { ok: false; reason: string };

const EMPTY_READINESS: WorkspaceReadiness = {
  reviewComplete: false,
  unresolvedItemCount: 0,
  verificationCurrent: false,
  verificationPassed: null,
  verificationWarningCount: 0,
  verificationBlockerCount: 0,
  exportEnabled: false,
};

export class ReviewWorkspace {
  private readonly parser: DocumentParser;
  private readonly detectionEngine: DetectionEngine;
  private readonly qualityEngine: CandidateQualityEngine;
  private readonly resolutionEngine: EntityResolutionEngine;
  private readonly occurrenceClassifier: OccurrenceClassifier;
  private readonly rebuilder: DocumentRebuilder;
  private readonly verifier: OutputVerifier;
  private readonly auditExporter: AuditExporter;
  private readonly decisionReuseEngine: DecisionReuseEngine;
  private readonly clock: Clock;
  private readonly sessionRepository: LocalSessionRepository;
  private readonly replacementRuleEngine: ReplacementRuleEngine;
  private readonly onPersistenceChange: (() => void) | null;

  private document: DocumentModel | null = null;
  private detection: DetectionResult | null = null;
  private quality: QualityResult | null = null;
  private grouping: GroupingResult | null = null;
  private classification: OccurrenceClassificationResult | null = null;
  private reviewEngine: DurableReviewEngine | null = null;
  private focusNavigator: FocusNavigator | null = null;

  private verification: VerificationReport | null = null;
  private verifiedSessionUpdatedAt: string | null = null;
  private rebuiltOutput: Blob | null = null;
  private lastAuditArtifacts: AuditArtifacts | null = null;
  private lastDecisionReuseSummary: DecisionReuseSummary | null = null;

  // Milestone 3, Phase 1 -- see this file's top doc comment.
  private originalFileBytes: Uint8Array | null = null;
  private originalFileMimeType: string = DEFAULT_DOCX_MIME_TYPE;
  private lastOpenedAt: string | null = null;
  private lastAutosaveAt: string | null = null;
  private lastAutosaveError: string | null = null;
  private lastQuotaStatus: QuotaStatus = "ok";
  /** Serializes autosave writes so two rapid consecutive decisions cannot
   *  race and persist out of order -- each call chains onto the previous
   *  one's completion rather than firing a parallel write. */
  private autosaveQueue: Promise<void> = Promise.resolve();

  /** Milestone 3, Phase 3. In-memory only, reset to
   *  defaultReplacementRuleConfig() by every loadDocument() call --
   *  deliberately NOT persisted to SessionRecord/SettingsService this
   *  milestone (SettingsService.ts remains a signature-only stub; giving
   *  it one real setting prematurely would be scope creep beyond what
   *  Andrew's Phase 3 instruction asks for). A reviewer who wants a
   *  different default for every future document is natural Milestone 4
   *  polish, not a Phase 3 requirement ("configure output behavior" is
   *  satisfied per-document, which is what the instruction's own framing
   *  -- "configurable replacement rules" alongside a single document's
   *  review -- describes). */
  private replacementRuleConfig: ReplacementRuleConfig = defaultReplacementRuleConfig();

  constructor(deps: WorkspaceDependencies = {}) {
    this.parser = deps.parser ?? new OoxmlDocumentParser();
    this.detectionEngine = deps.detectionEngine ?? new RegexDetectionEngine();
    this.qualityEngine = deps.qualityEngine ?? new RegexCandidateQualityEngine();
    this.resolutionEngine = deps.resolutionEngine ?? new RegexEntityResolutionEngine();
    this.occurrenceClassifier = deps.occurrenceClassifier ?? new RegexOccurrenceClassifier();
    this.rebuilder = deps.rebuilder ?? new OoxmlDocumentRebuilder();
    this.verifier = deps.verifier ?? new OoxmlOutputVerifier();
    this.auditExporter = deps.auditExporter ?? new DeterministicAuditExporter();
    this.decisionReuseEngine = deps.decisionReuseEngine ?? new DeterministicDecisionReuseEngine();
    this.clock = deps.clock ?? defaultClock;
    this.sessionRepository = deps.sessionRepository ?? new IndexedDbSessionRepository();
    this.replacementRuleEngine = deps.replacementRuleEngine ?? new DeterministicReplacementRuleEngine();
    this.onPersistenceChange = deps.onPersistenceChange ?? null;
  }

  /** The VerificationReport, ONLY if it is current for the CURRENT
   *  ReviewSession state -- null if never run, or stale (see this file's
   *  top doc comment on verification staleness). Factored out so getState()
   *  and generateAudit() derive staleness identically, from one place. */
  private currentVerification(): VerificationReport | null {
    if (!this.reviewEngine) return null;
    return this.verification !== null && this.verifiedSessionUpdatedAt === this.reviewEngine.getState().updatedAt
      ? this.verification
      : null;
  }

  private navigationContext(): NavigationContext {
    if (!this.detection || !this.grouping || !this.classification) {
      throw new Error("ReviewWorkspace.navigationContext() called before a document was loaded");
    }
    return { detection: this.detection, grouping: this.grouping, classification: this.classification };
  }

  /**
   * Parses `file`, runs the full synchronous pipeline once, and constructs
   * fresh ReviewEngine/FocusNavigator instances bound to that pipeline
   * output. If `restoreSession` is supplied, it is adopted only when its
   * `documentId` matches the freshly parsed document's own `documentId`
   * (see this file's top doc comment) -- a mismatch loads the document
   * with a FRESH session instead of silently adopting a foreign one, and
   * is reported back via `sessionRestored: false` plus a console-visible
   * reason (there is no dedicated warnings channel on this result type
   * beyond the boolean, matching the precedent already set by
   * DocumentRebuilder's own fallback-placeholder warning).
   */
  async loadDocument(file: File, restoreSession?: ReviewSession, restoreFocusPosition?: FocusResumePosition): Promise<LoadDocumentResult> {
    let document: DocumentModel;
    try {
      document = await this.parser.parse(file);
    } catch (error) {
      return { ok: false, reason: `failed to parse document: ${error instanceof Error ? error.message : String(error)}` };
    }

    // Milestone 3, Phase 1: cache the original bytes for autosave/recovery
    // (see this file's top doc comment) -- read once, here, rather than at
    // every autosave, since File/Blob bytes never change for a loaded
    // document. A read failure at this point is treated the same as a
    // parse failure: the document did not load successfully.
    let fileBytes: Uint8Array;
    try {
      fileBytes = new Uint8Array(await file.arrayBuffer());
    } catch (error) {
      return { ok: false, reason: `failed to read file bytes: ${error instanceof Error ? error.message : String(error)}` };
    }

    const detection = this.detectionEngine.detect(document);
    const profile = buildDefaultScoringProfileSnapshot(this.clock());
    const quality = this.qualityEngine.evaluate(document, detection, profile);
    const grouping = this.resolutionEngine.propose(detection, quality);
    const classification = this.occurrenceClassifier.classify(document, detection, quality, grouping);

    let sessionRestored = false;
    let session: ReviewSession;
    if (restoreSession) {
      if (restoreSession.documentId === document.documentId) {
        session = restoreSession;
        sessionRestored = true;
      } else {
        console.warn(
          `ReviewWorkspace.loadDocument: restoreSession.documentId (${restoreSession.documentId}) does not match the freshly parsed document (${document.documentId}) -- starting a fresh session instead of adopting a mismatched one.`
        );
        session = createReviewSession(`session-${document.documentId}`, document.documentId, this.clock());
      }
    } else {
      session = createReviewSession(`session-${document.documentId}`, document.documentId, this.clock());
    }

    // OBJECTIVE INTERFACE DEFECT, found while implementing AuditExporter for
    // real (Phase 11): `profile` was computed above and handed to
    // qualityEngine.evaluate(), but nothing ever recorded it into the
    // session's own `processingRevisions` -- the ONE field ReviewSession's
    // schema designates for exactly this ("pins the weights/thresholds/
    // versions in effect at the moment a session was scored", ADR-015).
    // Every session created by createReviewSession() starts with
    // `processingRevisions: []`, and nothing anywhere in Phases 8-10 ever
    // appended to it, so AuditExporter -- the first real consumer that needs
    // to know which profile actually scored a session -- had nothing to
    // read. Fixed here, not in AuditExporter, since Workspace is the one
    // place that already computes `profile`; only on a FRESH session (never
    // on a restored one, matching "a deliberate rescan under new rules
    // appends, it never overwrites" -- reopening a saved session is not a
    // new scoring pass).
    if (!sessionRestored) {
      session = {
        ...session,
        processingRevisions: [{ revisionId: "revision-1", createdAt: profile.scoringTimestamp, scoringProfile: profile }],
      };
    }

    this.document = document;
    this.detection = detection;
    this.quality = quality;
    this.grouping = grouping;
    this.classification = classification;
    this.reviewEngine = new DurableReviewEngine(detection, grouping, session, this.clock);
    this.focusNavigator = sessionRestored
      ? DeterministicFocusNavigator.fromResumePosition(this.navigationContext(), session, restoreFocusPosition)
      : new DeterministicFocusNavigator(this.navigationContext(), session);
    this.verification = null;
    this.verifiedSessionUpdatedAt = null;
    this.rebuiltOutput = null;
    this.lastAuditArtifacts = null;
    this.lastDecisionReuseSummary = null;

    // Milestone 3, Phase 1. `lastOpenedAt` defaults to "now" (an ordinary
    // fresh or File-provided load); resumeFromRepository() overwrites it
    // immediately afterward with the repository's own touched timestamp --
    // see that method below. Autosave status resets for the newly loaded
    // document; a stale error/timestamp from a PREVIOUS document must never
    // bleed into this one's persistence status.
    this.originalFileBytes = fileBytes;
    this.originalFileMimeType = file.type || DEFAULT_DOCX_MIME_TYPE;
    this.lastOpenedAt = this.clock();
    this.lastAutosaveAt = null;
    this.lastAutosaveError = null;
    this.replacementRuleConfig = defaultReplacementRuleConfig();

    // FOUND DURING BROWSER VALIDATION, not design: a freshly loaded
    // document with zero decisions made never triggered ANY autosave
    // (reconcileFocus() -- the only other scheduleAutosave() call site --
    // only runs after a successful review.* command). Two real
    // consequences: (1) a reviewer who loads a document and leaves before
    // deciding anything would have nothing to resume, contradicting "leave
    // at any point... resume exactly where they left off" -- there was
    // nowhere to resume TO; (2) the persistence-status UI would show
    // "Saving…" indefinitely (lastAutosaveAt stays null forever) instead of
    // ever resolving to "All changes saved", which is actively misleading.
    // Scheduling one here closes both gaps with the exact same
    // fire-and-forget mechanism every other autosave already uses.
    this.scheduleAutosave();

    return { ok: true, sessionRestored };
  }

  getReviewEngine(): DurableReviewEngine | null {
    return this.reviewEngine;
  }

  getFocusNavigator(): FocusNavigator | null {
    return this.focusNavigator;
  }

  getDocument(): DocumentModel | null {
    return this.document;
  }

  /** Reconciles focus against the CURRENT ReviewSession state -- callers
   *  (WorkspaceCommandDispatcher) invoke this after every successful
   *  review.* command, matching FocusNavigator's own "call reconcile()
   *  after every successful ReviewEngine.dispatch()" contract (Phase 9). */
  reconcileFocus(): void {
    if (!this.reviewEngine || !this.focusNavigator) return;
    this.focusNavigator.reconcile(this.reviewEngine.getState());
    this.scheduleAutosave();
  }

  /** Fire-and-forget: autosave must never block command dispatch (a
   *  reviewer pressing a decision key should never feel a save-induced
   *  delay -- see Andrew's "uninterrupted review flow" UX expectation).
   *  Chained onto `autosaveQueue` rather than invoked directly so two
   *  autosaves triggered in quick succession serialize instead of racing
   *  (whichever finished last would otherwise "win" nondeterministically).
   *  Errors are captured into `lastAutosaveError` by persistCurrentSession()
   *  itself and surfaced via getState().persistence -- never thrown here,
   *  since this runs detached from any caller that could catch it. */
  private scheduleAutosave(): void {
    this.autosaveQueue = this.autosaveQueue.then(() => this.persistCurrentSession().then(() => undefined));
  }

  /** Writes the CURRENT document/session/focus state to `sessionRepository`
   *  as one SessionRecord (Milestone 3, Phase 1). Used both by the
   *  autosave path (via scheduleAutosave(), fire-and-forget) and by an
   *  explicit `document.saveReviewSession` dispatch (awaited -- see
   *  CommandDispatcher.ts), which is why this returns a CommandResult
   *  rather than void: an explicit save's caller DOES want to know whether
   *  it actually succeeded. */
  private async persistCurrentSession(): Promise<CommandResult> {
    if (!this.document || !this.reviewEngine || !this.focusNavigator || !this.originalFileBytes) {
      return { ok: false, reason: "no document loaded" };
    }
    const session = this.reviewEngine.getState();
    const resumePosition = this.focusNavigator.captureResumePosition(session.updatedAt);
    const saveFile = createWorkspaceSaveFile(this.document.documentId, session.updatedAt, session, resumePosition);

    // Reuses the exact StageStatus.unresolvedCount readiness.ts/getState()
    // already compute for Item Check -- not a second, slightly different
    // "how much is done" formula (see this file's top doc comment on
    // `reviewComplete`/`unresolvedItemCount` deriving from the same
    // stages.ts rule).
    const stageStatuses = this.focusNavigator.allStageStatuses(session);
    const itemCheckStatus = stageStatuses.find((s) => s.stage === "item-check");
    const totalCandidateCount = this.detection?.candidates.length ?? 0;
    const unresolvedCount = itemCheckStatus?.unresolvedCount ?? 0;
    const reviewedCandidateCount = Math.max(0, totalCandidateCount - unresolvedCount);

    const record: SessionRecord = {
      schemaVersion: SESSION_RECORD_SCHEMA_VERSION,
      documentId: this.document.documentId,
      fileName: this.document.fileName,
      fileBytes: this.originalFileBytes,
      fileMimeType: this.originalFileMimeType,
      saveFile,
      lastOpenedAt: this.lastOpenedAt ?? session.updatedAt,
      reviewedCandidateCount,
      totalCandidateCount,
    };

    try {
      await this.sessionRepository.save(record);
      this.lastAutosaveAt = session.updatedAt;
      this.lastAutosaveError = null;
      // Best-effort refresh; a failure here must not mask a successful
      // save (see IndexedDbSessionRepository.getQuotaStatus()'s own
      // "absence is not an error" note).
      this.lastQuotaStatus = await this.sessionRepository.getQuotaStatus().catch(() => this.lastQuotaStatus);
      this.onPersistenceChange?.();
      return { ok: true };
    } catch (error) {
      // Andrew's "graceful handling of interrupted sessions": a failed
      // autosave (e.g. quota exceeded, IndexedDB unavailable in a private
      // browsing context) must not throw into a fire-and-forget caller or
      // interrupt the reviewer's in-memory work -- it is recorded here and
      // surfaced non-destructively via getState().persistence instead.
      this.lastAutosaveError = error instanceof Error ? error.message : String(error);
      this.onPersistenceChange?.();
      return { ok: false, reason: this.lastAutosaveError };
    }
  }

  /** The explicit-save counterpart to autosave -- see
   *  CommandDispatcher.ts's `document.saveReviewSession` routing. Awaited
   *  by its caller (unlike autosave), so a reviewer who explicitly saves
   *  gets an honest answer about whether their work is actually persisted
   *  locally, not just cached in memory as a downloadable string. */
  async saveReviewSessionExplicit(): Promise<CommandResult> {
    return this.persistCurrentSession();
  }

  /**
   * Milestone 3, Phase 1 -- "recovery after refresh"/"resume previous
   * review". Loads the SessionRecord stored for `documentId`, reconstructs
   * a File from its cached bytes (File extends Blob; a reviewer never sees
   * or interacts with this reconstruction -- it exists purely so
   * loadDocument() can stay the single, unduplicated pipeline entry point),
   * and calls loadDocument() exactly as if that file had just been picked.
   * documentId-gated restore (this file's top doc comment) then applies
   * unchanged -- a byte-identical re-parse of a document this repository
   * itself produced can only ever match, so `sessionRestored` here is
   * expected to always be true; the check still runs for defense rather
   * than being special-cased away.
   */
  async resumeFromRepository(documentId: string): Promise<LoadDocumentResult> {
    const record = await this.sessionRepository.load(documentId, this.clock());
    if (!record) return { ok: false, reason: "no saved session found for this document" };
    const file = new File([record.fileBytes as BlobPart], record.fileName, { type: record.fileMimeType });
    const result = await this.loadDocument(file, record.saveFile.reviewSession, record.saveFile.focusResumePosition);
    if (result.ok) {
      // loadDocument() already set lastOpenedAt to "now" (an ordinary
      // fresh-load default) -- overwrite with the repository's own touched
      // value so it reflects the actual load() call above, not a second,
      // independently-timed clock() call made here.
      this.lastOpenedAt = record.lastOpenedAt;
    }
    return result;
  }

  /** Passthrough for Recent Documents (Phase 2) -- see
   *  LocalSessionRepository.ts's SessionSummary for what each entry
   *  contains. Does not require a document to currently be loaded. */
  async listRecentSessions(limit?: number): Promise<SessionSummary[]> {
    return this.sessionRepository.listRecent(limit);
  }

  /** Passthrough removal for a Recent Documents "remove from list"
   *  affordance -- deliberately the only management operation exposed
   *  (Andrew: "do not implement a document-management system"). */
  async deleteStoredSession(documentId: string): Promise<void> {
    return this.sessionRepository.delete(documentId);
  }

  /** Milestone 3, Phase 3. The config `generateOutput()` will use the next
   *  time it runs -- does not itself regenerate output (see Commands.ts's
   *  `setReplacementRuleConfig` doc comment). Replaces the whole config
   *  object (matches this codebase's established "plain overwrite, no
   *  merge semantics" convention -- e.g. session.ts's decideCandidate()) --
   *  a caller building an incremental UI change composes the full object
   *  itself from the current one (see getReplacementRuleConfig() below)
   *  before calling this, rather than this method trying to guess how to
   *  merge a partial update. */
  setReplacementRuleConfig(config: ReplacementRuleConfig): CommandResult {
    this.replacementRuleConfig = config;
    return { ok: true };
  }

  getReplacementRuleConfig(): ReplacementRuleConfig {
    return this.replacementRuleConfig;
  }

  /** Live preview for the Redaction Rules panel: what WOULD each
   *  Redact/Rename candidate's placeholder text resolve to under
   *  `config`, without applying it (setReplacementRuleConfig() is
   *  untouched) and without rebuilding the document. Pure and synchronous
   *  -- a UI can call this on every keystroke as a reviewer edits a custom
   *  template, the same "cheap enough to run on every input event"
   *  property itemCheckQuery.ts's search/filter functions already have. */
  previewReplacements(config: ReplacementRuleConfig): Map<string, string> | null {
    if (!this.detection || !this.reviewEngine) return null;
    return this.replacementRuleEngine.computeReplacements(this.detection.candidates, this.reviewEngine.getState().candidateDecisions, config);
  }

  /**
   * Rebuilds the document from the CURRENT ReviewSession state and
   * independently verifies the result (ADR-016: OutputVerifier never
   * trusts DocumentRebuilder's own account of what it did). Both steps are
   * genuine I/O (ZIP read/write); this is the only place Workspace itself
   * performs async work beyond loadDocument().
   */
  async generateOutput(): Promise<CommandResult> {
    if (!this.document || !this.detection || !this.reviewEngine) {
      return { ok: false, reason: "no document loaded" };
    }
    try {
      const session = this.reviewEngine.getState();
      // Milestone 3, Phase 3: resolve placeholder text via
      // ReplacementRuleEngine before rebuilding -- see DocumentRebuilder.ts's
      // updated "SCOPE BOUNDARY" doc comment for the precedence order this
      // participates in (reviewer-explicit text still always wins).
      const replacements = this.replacementRuleEngine.computeReplacements(
        this.detection.candidates,
        session.candidateDecisions,
        this.replacementRuleConfig
      );
      const rebuilt = await this.rebuilder.rebuild(this.document, this.detection, session, replacements);
      const report = await this.verifier.verify(this.document, this.detection, session, rebuilt);
      this.rebuiltOutput = rebuilt;
      this.verification = report;
      this.verifiedSessionUpdatedAt = session.updatedAt;
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: `failed to generate output: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  /** The rebuilt DOCX, if generateOutput() has been run against the
   *  CURRENT session state -- null if never run, or if the session has
   *  changed since (matches `readiness.verificationCurrent`; a caller
   *  should re-run generateOutput() rather than export a stale blob). */
  getRebuiltOutput(): Blob | null {
    if (!this.reviewEngine) return null;
    const current = this.verifiedSessionUpdatedAt === this.reviewEngine.getState().updatedAt;
    return current ? this.rebuiltOutput : null;
  }

  /**
   * Builds the audit artifacts from authoritative pipeline/review output
   * (AuditExporter.ts's own doc comment has the full design rationale).
   * Deliberately NOT gated on `readiness.exportEnabled`/a passing
   * verification -- matches the Python oracle's own unconditional export
   * behavior (see phase-11-findings.md), while still passing along whatever
   * CURRENT verification state exists (possibly null) so the artifact
   * itself never overstates what was actually confirmed. This is the one
   * place Workspace calls AuditExporter -- CommandDispatcher only routes
   * `document.generateAudit` here; see WorkspaceCommandDispatcher.ts.
   */
  async generateAudit(): Promise<CommandResult> {
    if (!this.document || !this.detection || !this.grouping || !this.reviewEngine) {
      return { ok: false, reason: "no document loaded" };
    }
    try {
      const session = this.reviewEngine.getState();
      const verification = this.currentVerification();
      const rebuiltOutput = this.getRebuiltOutput();
      this.lastAuditArtifacts = await this.auditExporter.export(
        this.document,
        this.detection,
        this.grouping,
        session,
        verification,
        rebuiltOutput
      );
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: `failed to generate audit record: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  /** The artifacts from the most recent generateAudit() call, or null if
   *  it has never been run (or a new document has since been loaded --
   *  loadDocument() clears this the same way it clears verification/
   *  rebuiltOutput). Not staleness-checked against the session the way
   *  getRebuiltOutput() is: an audit record is a point-in-time statement
   *  ("this is what the review looked like when generated"), not a claim
   *  about the CURRENT state, so an older one remaining available after a
   *  further decision change is correct, not stale data leaking through. */
  getLastAuditArtifacts(): AuditArtifacts | null {
    return this.lastAuditArtifacts;
  }

  /**
   * Feature 002 (Decision Reuse). Reads `file` (the one genuine I/O step
   * here, matching loadDocument()'s own precedent for why this method is
   * async), parses it as a previously exported decisions.json, runs
   * DecisionReuseEngine against the CURRENT document's already-computed
   * detection/grouping, and dispatches the resulting proposals to this
   * Workspace's OWN ReviewEngine via review.applyDecisionReuse -- the exact
   * same "dispatch, then reconcileFocus() on success" sequence
   * WorkspaceCommandDispatcher.dispatchReview() already uses for every
   * other review.* command, performed here instead of there only because
   * computing the proposals first requires this method's own async file
   * read. Workspace does not decide which candidates to reuse (that's
   * DecisionReuseEngine, a pure engine, same as EntityResolutionEngine) and
   * does not decide how a reuse proposal gets applied to session state
   * (that's ReviewEngine, via session.ts's applyDecisionReuse case) -- this
   * method only sequences the two, the same orchestration role Workspace
   * plays everywhere else.
   */
  async importDecisions(file: File): Promise<CommandResult> {
    if (!this.document || !this.detection || !this.grouping || !this.reviewEngine) {
      return { ok: false, reason: "no document loaded" };
    }
    let raw: string;
    try {
      raw = await file.text();
    } catch (error) {
      return { ok: false, reason: `failed to read decisions file: ${error instanceof Error ? error.message : String(error)}` };
    }
    const parsed = deserializeImportedDecisions(raw);
    if (!parsed.ok) {
      return { ok: false, reason: `invalid decisions file: ${parsed.reason}` };
    }

    const proposals = this.decisionReuseEngine.proposeReuse(this.detection, this.grouping, parsed.decisions);
    const beforeDecided = new Set(Object.keys(this.reviewEngine.getState().candidateDecisions));

    const result = this.reviewEngine.dispatch({ family: "review", type: "applyDecisionReuse", proposals });
    if (result.ok) this.reconcileFocus();

    const tierCounts: Record<DecisionReuseMatchTier, number> = { "exact-key": 0, "grouped-alias": 0, "similarity-threshold": 0 };
    for (const proposal of proposals) tierCounts[proposal.evidence.tier] += 1;
    const appliedCount = proposals.filter((p) => !beforeDecided.has(p.candidateId)).length;

    this.lastDecisionReuseSummary = {
      sourceDocumentId: parsed.decisions.documentId,
      sourceSessionId: parsed.decisions.sessionId,
      proposalCount: proposals.length,
      tierCounts,
      appliedCount,
      skippedAlreadyDecidedCount: proposals.length - appliedCount,
    };

    return result.ok ? { ok: true } : { ok: false, reason: result.reason ?? "applyDecisionReuse rejected" };
  }

  /** The summary from the most recent successful (or attempted) importDecisions()
   *  call, or null if it has never been run for the current document (cleared
   *  by loadDocument() the same way lastAuditArtifacts is). */
  getLastDecisionReuseSummary(): DecisionReuseSummary | null {
    return this.lastDecisionReuseSummary;
  }

  /**
   * The one place Workspace reads live engine state to build a plain,
   * display-ready snapshot. Recomputed fresh every call -- nothing here is
   * cached between calls, so it can never drift from the engines it reads.
   */
  getState(): WorkspaceState {
    if (!this.document || !this.reviewEngine || !this.focusNavigator) {
      return {
        documentId: null,
        fileName: null,
        documentLoaded: false,
        processingWarnings: [],
        detection: null,
        quality: null,
        grouping: null,
        classification: null,
        reviewSession: null,
        focus: null,
        stageStatuses: [],
        readiness: EMPTY_READINESS,
        verification: null,
        hasGeneratedOutput: false,
        persistence: EMPTY_PERSISTENCE_STATUS,
      };
    }

    const session = this.reviewEngine.getState();
    const stageStatuses = this.focusNavigator.allStageStatuses(session);
    const outputStatus = stageStatuses.find((s) => s.stage === "output");
    const itemCheckStatus = stageStatuses.find((s) => s.stage === "item-check");

    const verification = this.currentVerification();
    const verificationCurrent = verification !== null;
    const verificationPassed = verification ? verification.passed : null;
    const verificationWarningCount = verification ? verification.fidelityFindings.filter((f) => f.severity === "warning").length : 0;
    const verificationBlockerCount = verification ? verification.fidelityFindings.filter((f) => f.severity === "blocker").length : 0;

    const readiness: WorkspaceReadiness = {
      reviewComplete: outputStatus?.available ?? false,
      unresolvedItemCount: itemCheckStatus?.unresolvedCount ?? 0,
      verificationCurrent,
      verificationPassed,
      verificationWarningCount,
      verificationBlockerCount,
      exportEnabled: verificationCurrent && verificationPassed === true,
    };

    return {
      documentId: this.document.documentId,
      fileName: this.document.fileName,
      documentLoaded: true,
      processingWarnings: this.document.processingWarnings,
      detection: this.detection,
      quality: this.quality,
      grouping: this.grouping,
      classification: this.classification,
      reviewSession: session,
      focus: this.focusNavigator.getFocus(),
      stageStatuses,
      readiness,
      verification,
      hasGeneratedOutput: verificationCurrent,
      persistence: {
        lastAutosaveAt: this.lastAutosaveAt,
        lastAutosaveError: this.lastAutosaveError,
        quotaStatus: this.lastQuotaStatus,
      },
    };
  }
}
