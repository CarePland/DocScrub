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
import type { ReviewSession, AutomaticResolution } from "../domain/ReviewSession.js";
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
import { cleanupIdentityOptions, identityCleanupStats, insertedWordNameProposals, type IdentityCleanupStats } from "../engines/entity-resolution/identity-cleanup.js";
import { normalizeDetection, type NormalizationResult } from "../engines/normalization/normalization.js";
import { evaluateContextualPersonEvidence, type ContextualPersonEvidenceResult } from "../engines/contextual-person-evidence/contextual-person-evidence.js";
// CROSS-CANDIDATE COMPOSITION (AG, 2026-08-10). See its module header.
import { evaluateCrossCandidateEvidence, emptyCrossCandidateEvidence, type CrossCandidateEvidenceResult } from "../engines/cross-candidate/cross-candidate-evidence.js";
import { NAME_EVIDENCE_CATEGORIES, personEvidencedCandidateIds, type PersonEvidenceFacts } from "../engines/cross-candidate/person-evidence-gate.js";
// CENSUS NAME EVIDENCE (AG, 2026-08-10). See its module header for why the
// gate reads STRUCTURE and never token membership.
import { censusNameEvidenceFor, censusRoleFor, normalizeForCensusLookup, type CensusNameEvidence } from "../engines/knowledge/CensusNameEvidence.js";
// GNIS PLACE EVIDENCE (AG, 2026-08-10). Evidence only -- see the stop-condition
// note on SemanticTypeFacts.gnisPlaceStrength for why nothing routes on it.
import { gnisPlaceEvidenceFor, type GnisPlaceEvidence } from "../engines/knowledge/GnisPlaceEvidence.js";
import { higherEdTerminologyFor, type HigherEdTerminologyEvidence } from "../engines/knowledge/HigherEdTerminologyEvidence.js";
// Inert like the higher-ed family above -- computed, exposed and traced, but
// read by no production decision. See domain/semanticTypes.ts's
// `medicalTerminologyAttested` for why, and for the boundary specific to it.
import { medicalEvidenceFor, type MedicalEvidence } from "../engines/knowledge/MedicalEvidence.js";
// ALL reference evidence channels, gathered in one place. The next domain
// pack should be added to ReferenceEvidence.ts, not to this file -- see
// `getReferenceEvidence` for why.
import { referenceEvidenceFor, type ReferenceEvidenceChannels } from "../engines/knowledge/ReferenceEvidence.js";
// MULTI-INTERPRETATION PROFILES, Phase A (AG, 2026-08-10). Inert: computed,
// exposed and traced, read by no production decision. See its module header
// and `getInterpretationProfiles` below.
import { interpretCandidate } from "../engines/interpretation/candidate-interpretation.js";
import type { InterpretationProfile } from "../engines/interpretation/interpretation-model.js";
// PHASE 2 (AG, 2026-08-09): the residual-review gate. See its module header.
import { buildGateFacts, runResidualReviewGate, type GateRun } from "../engines/review/residualReviewGate.js";
import { StructuralRelationshipEngine } from "../engines/StructuralRelationshipEngine.js";
import { builtInSemanticRelationshipProviders } from "../engines/knowledge/RelatedNameProvider.js";
import type { RelationshipKind, StructuralRelationshipResult } from "../domain/StructuralRelationship.js";
import { buildSemanticTypeGroups, qualityCategoriesOf, semanticTypeFor, typeCheckSectionFor, type CandidateInterpretation, type SemanticTypeGroup, type SemanticTypeId, type TypeCheckSectionId } from "../domain/semanticTypes.js";
import { RegexOccurrenceClassifier, type OccurrenceClassifier, type OccurrenceClassificationResult } from "../engines/OccurrenceClassifier.js";
import type { QualityResult } from "../domain/Evidence.js";

import { DurableReviewEngine, type Clock } from "../engines/ReviewEngine.js";
import { createReviewSession } from "../engines/review/session.js";
import { DeterministicFocusNavigator, type FocusNavigator } from "../engines/FocusNavigator.js";
import type { NavigationContext } from "../engines/navigation/navigator.js";
import { DeterministicDecisionReuseEngine, type DecisionReuseEngine } from "../engines/DecisionReuseEngine.js";
// DECISION MEMORY (AG, 2026-08-03): cross-document carry-over of the
// reviewer's own prior decisions. See domain/DecisionMemory.ts.
import { mergeDecisionMemory, projectDecisionMemory } from "../domain/DecisionMemory.js";
import { deserializeImportedDecisions } from "../io/DecisionImport.js";
import type { DecisionReuseMatchTier } from "../domain/DecisionReuse.js";
import { IndexedDbSessionRepository } from "../io/IndexedDbSessionRepository.js";
import {
  SESSION_RECORD_SCHEMA_VERSION,
  type LocalSessionRepository,
  type SessionRecord,
  type SessionSummary,
  type QuotaStatus,
  type PersistedUiState,
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
  /** DECISION MEMORY (AG, 2026-08-03): how these decisions arrived.
   *  "imported-file" is the original Feature 002 path -- the reviewer chose
   *  a decisions.json. "decision-memory" is automatic carry-over from
   *  earlier documents in this browser. The reviewer did not ASK for the
   *  second one, so the UI must say so plainly; the distinction exists
   *  precisely so the banner can, rather than presenting both as the same
   *  event. `documentsDrawnFrom` is meaningful only for the automatic path
   *  (an aggregate over prior reviews has no single source document). */
  origin: "imported-file" | "decision-memory";
  documentsDrawnFrom?: number;
}

export interface WorkspaceReadiness {
  /** Mirrors FocusNavigator's own "output" StageStatus.available -- true
   *  once every item-check candidate is resolved. Not recomputed here;
   *  read directly from stages.ts's already-derived rule. */
  reviewComplete: boolean;
  unresolvedItemCount: number;
  /** REVIEW ARTIFACTS (AG, 2026-08-02): outstanding non-item reviewer work
   *  across every stage -- today the unaddressed structural relationship
   *  proposals. Read straight off the same StageStatus fields the workflow
   *  membership rule uses, never recounted here. Exists so the Output
   *  stage can SAY what is still outstanding: `unresolvedItemCount` alone
   *  reported "0 items unresolved" while a proposal still blocked
   *  completion, which is exactly the silence that let the original defect
   *  go unnoticed. */
  unresolvedArtifactCount: number;
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
  /** Structural Relationship Review (2026-07-30): deterministic
   *  relationship proposals (acronym/full-name, shared identifier
   *  patterns), recomputed per load like every other pipeline output --
   *  see StructuralRelationshipEngine.ts. Null until a document loads. */
  structuralRelationships: StructuralRelationshipResult | null;
  /** PHASE 2, TYPE CHECK (2026-08-02): the ordered, populated-only
   *  semantic type membership -- computed ONCE per load (see
   *  loadDocument()) from domain/semanticTypes.ts's semanticTypeFor()
   *  over detected type + quality categories + structural relationship
   *  kinds, then shared by BOTH the FocusNavigator's type-check traversal
   *  (via navigationContext()) and the UI's card rendering -- one
   *  assignment, two consumers, no drift. Membership is decision-blind
   *  and immutable for the lifetime of a loaded document. Null until a
   *  document loads. */
  semanticTypes: readonly SemanticTypeGroup[] | null;
  reviewSession: ReviewSession | null;
  focus: FocusState | null;
  stageStatuses: StageStatus[];
  readiness: WorkspaceReadiness;
  verification: VerificationReport | null;
  hasGeneratedOutput: boolean;
  /** Milestone 3, Phase 1 -- see WorkspacePersistenceStatus above. */
  persistence: WorkspacePersistenceStatus;
  /** WORKSPACE METRICS (AG, 2026-08-02): the identity-cleanup pass's
   *  factual removal record -- ADDITIVE, read-only exposure of state the
   *  load pipeline already implied; recomputed deterministically on every
   *  load, so it needs (and gets) no persistence of its own. Null until a
   *  document loads. No review behavior reads it. */
  identityCleanup: IdentityCleanupStats | null;
  /** NORMALIZATION (AG, 2026-08-03): per-candidate provenance for the
   *  Detection -> Normalization -> Grouping collapse, plus its factual
   *  stats. ADDITIVE and read-only, recomputed on every load and never
   *  persisted -- exactly like identityCleanup above. The review stages
   *  read nothing from it; only Expert View's "Normalized from" evidence
   *  and the metrics window do. Null until a document loads. */
  normalization: NormalizationResult | null;
}

export type LoadDocumentResult =
  | { ok: true; sessionRestored: boolean }
  | { ok: false; reason: string };

const EMPTY_READINESS: WorkspaceReadiness = {
  reviewComplete: false,
  unresolvedItemCount: 0,
  unresolvedArtifactCount: 0,
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
  private readonly structuralRelationshipEngine: StructuralRelationshipEngine;
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
  /** NORMALIZATION (2026-08-03): the RAW detector output, kept verbatim
   *  alongside the normalized stream. Nothing in review reads it today --
   *  it exists so "the original detector output remains unchanged" is a
   *  fact about the running system rather than a claim in a comment, and
   *  so any future QA/audit surface that needs the pre-collapse record can
   *  have it without re-running detection. */
  private rawDetection: DetectionResult | null = null;
  private normalization: NormalizationResult | null = null;
  private quality: QualityResult | null = null;
  private grouping: GroupingResult | null = null;
  private classification: OccurrenceClassificationResult | null = null;
  private structuralRelationships: StructuralRelationshipResult | null = null;
  /** PHASE 2, TYPE CHECK (2026-08-02): see WorkspaceState.semanticTypes. */
  private semanticTypeGroups: readonly SemanticTypeGroup[] | null = null;
  /** WORKSPACE METRICS (2026-08-02): recomputed per load, never stored. */
  private identityCleanupStats: IdentityCleanupStats | null = null;
  private reviewEngine: DurableReviewEngine | null = null;
  private focusNavigator: FocusNavigator | null = null;

  /** The contextual-person-evidence pass's output for the loaded document.
   *  Held for provenance inspection (`__docscrub.why`): "why is this
   *  candidate still in review" is usually a question about THIS, and
   *  answering it needs the exact occurrence and rule. Read-only. */
  private contextualEvidence: ContextualPersonEvidenceResult | null = null;

  /** CROSS-CANDIDATE COMPOSITION (AG, 2026-08-10) -- derived, never
   *  persisted, recomputed on every load like every other pipeline output. */
  private crossCandidateEvidence: CrossCandidateEvidenceResult = emptyCrossCandidateEvidence();

  getCrossCandidateEvidence(): CrossCandidateEvidenceResult {
    return this.crossCandidateEvidence;
  }

  /** PROVENANCE (AG, 2026-08-10): per-candidate {detectedType, semanticType,
   *  rejectedType, section}. Derived, never persisted -- the record that lets
   *  Expert View and the audit say WHY an item stopped being a likely person
   *  without re-deriving the interpretation. */
  private candidateInterpretations: ReadonlyMap<string, CandidateInterpretation> = new Map();

  getCandidateInterpretations(): ReadonlyMap<string, CandidateInterpretation> {
    return this.candidateInterpretations;
  }

  /** CENSUS NAME EVIDENCE (AG, 2026-08-10) -- structural evidence per
   *  candidate, present only where a structure was found. Derived, never
   *  persisted. */
  private censusNameEvidence: ReadonlyMap<string, CensusNameEvidence> = new Map();

  getCensusNameEvidence(): ReadonlyMap<string, CensusNameEvidence> {
    return this.censusNameEvidence;
  }

  /** GNIS PLACE EVIDENCE (AG, 2026-08-10) -- present only where a Standard
   *  match was found. Derived, never persisted. Nothing routes on it yet;
   *  see the stop-condition note in domain/semanticTypes.ts. */
  private gnisPlaceEvidence: ReadonlyMap<string, GnisPlaceEvidence> = new Map();

  getGnisPlaceEvidence(): ReadonlyMap<string, GnisPlaceEvidence> {
    return this.gnisPlaceEvidence;
  }

  /**
   * HIGHER-EDUCATION TERMINOLOGY EVIDENCE (AG, 2026-08-10) -- one entry per
   * candidate whose phrase is attested in the higher-ed reference dataset,
   * carrying every attesting provenance row. Derived, never persisted,
   * recomputed on every load like every other pipeline output.
   *
   * SCOPE IS EVERY CANDIDATE, unlike `censusNameEvidence` above, which is
   * computed only for `detectedType === "person"`. That narrowing is correct
   * for Census (its only consumer is the person-protection gate) and would be
   * wrong here: the point of a domain reference is to describe candidates the
   * person pipeline never proposed -- `Cost of Attendance`, `Satisfactory
   * Academic Progress`, `Financial aid` -- as well as the ones it did. The
   * full pass is 1,373 keyed lookups against an in-memory Map built once, so
   * the cost is not a consideration at this dataset size.
   *
   * NO PRODUCTION DECISION READS THIS MAP TODAY. It is deliberately a
   * standalone getter rather than a scoring input; see
   * domain/semanticTypes.ts's `higherEdTerminologyAttested` for why the
   * combination question is deferred, and the implementation report for what
   * was deliberately left for that layer.
   */
  private higherEdTerminology: ReadonlyMap<string, HigherEdTerminologyEvidence> = new Map();

  getHigherEdTerminologyEvidence(): ReadonlyMap<string, HigherEdTerminologyEvidence> {
    return this.higherEdTerminology;
  }

  /**
   * MEDICAL/HEALTHCARE TERMINOLOGY EVIDENCE (AG, 2026-08-10) -- one entry per
   * candidate whose phrase is attested in the medical reference dataset,
   * carrying every attesting provenance row. Derived, never persisted,
   * recomputed on every load like every other pipeline output.
   *
   * SCOPE IS EVERY CANDIDATE, for the same reason the higher-ed map's is: a
   * domain reference earns its keep by describing candidates the person
   * pipeline never proposed -- `Prior authorization`, `Medical Records`,
   * `National Provider Identifier` -- as well as the ones it did. 378 keys in
   * an in-memory Map built once; cost is not a consideration at this size.
   *
   * NO PRODUCTION DECISION READS THIS MAP TODAY, and for this family that is a
   * stronger statement than convenience. Terminology attestation must never
   * become an assertion about a person's health, so the safe order of
   * operations is: expose it, trace it, benchmark it, and only then design
   * what may consume it. See engines/knowledge/MedicalEvidence.ts.
   */
  private medicalTerminology: ReadonlyMap<string, MedicalEvidence> = new Map();

  getMedicalEvidence(): ReadonlyMap<string, MedicalEvidence> {
    return this.medicalTerminology;
  }

  /**
   * ALL REFERENCE EVIDENCE CHANNELS, per candidate (AG, 2026-08-10).
   *
   * ═══════ THIS IS INTENDED TO BE THE LAST PER-FAMILY EDIT TO THIS FILE ═══════
   *
   * Above this line are five bespoke maps -- census, GNIS, higher-ed, medical
   * -- each added by a different integration, each with its own field, its own
   * getter and its own loop in `loadDocument`. Six domain packs were in flight
   * on 2026-08-10 alone and more are coming. Continuing that pattern means
   * every future pack edits the same three regions of this file, which is a
   * guaranteed merge conflict per pack, forever, for zero behavioural gain.
   *
   * So this one map holds `ReferenceEvidenceChannels` -- every channel's
   * answer for a candidate, gathered by
   * `engines/knowledge/ReferenceEvidence.ts`. ADDING THE NEXT EVIDENCE FAMILY
   * SHOULD TOUCH THAT FILE AND NOT THIS ONE: one field on the channels
   * interface, one call in `referenceEvidenceFor`, and it appears here, in the
   * console diagnostic, and in the overlap harness for free.
   *
   * The existing per-family maps are deliberately left alone rather than
   * folded in. They have live consumers (the person-protection gate reads
   * census; the diagnostic reads higher-ed) and rewriting them while three
   * integrations are in flight would trade a merge conflict for a behavioural
   * risk. Folding them in is a later, mechanical change.
   *
   * SCOPE IS EVERY CANDIDATE, and every channel is asked. That means census
   * and GNIS are evaluated here for non-person candidates too, where the
   * fields above evaluate them only for `detectedType === "person"`. The
   * narrow scope above is correct for its consumer (the protection gate) and
   * would be wrong here: the whole point of gathering channels is to see what
   * a phrase looks like to datasets the pipeline never consulted. The cost is
   * a few keyed Map lookups per candidate against indexes that are built once
   * and lazily.
   *
   * NO PRODUCTION DECISION READS THIS MAP. Derived, never persisted,
   * recomputed on every load like every other pipeline output. It exists so
   * the channels can be traced, benchmarked and audited BEFORE anything is
   * built that combines them.
   */
  private referenceEvidence: ReadonlyMap<string, ReferenceEvidenceChannels> = new Map();

  getReferenceEvidence(): ReadonlyMap<string, ReferenceEvidenceChannels> {
    return this.referenceEvidence;
  }

  /**
   * MULTI-INTERPRETATION PROFILES, Phase A (AG, 2026-08-10) -- every reading
   * the evidence affirmatively supports for a candidate, with nothing chosen
   * between them. One entry per candidate, always; a candidate nothing
   * supports carries an `unsupported` profile rather than being absent, so
   * "asked and found nothing" stays distinguishable from "never asked".
   *
   * ═══════ NOT `getCandidateInterpretations()`, WHICH IS A DIFFERENT THING ═══════
   *
   * `candidateInterpretations` above holds `CandidateInterpretation` from
   * domain/semanticTypes.ts: the SINGLE Type Check section a candidate routes
   * to, plus the hypothesis that was rejected to get there. It is production
   * routing and it is unchanged by this work.
   *
   * This map holds `InterpretationProfile`: the SET of readings the evidence
   * supports, none of them chosen. The two names are uncomfortably close and
   * the distinction is exactly the point of this layer, so it is stated here
   * rather than left to be inferred.
   *
   * NO PRODUCTION DECISION READS THIS MAP. Derived, never persisted,
   * recomputed on every load like every other pipeline output. Its only
   * consumers are the console diagnostic and the verification suites.
   */
  private interpretationProfiles: ReadonlyMap<string, InterpretationProfile> = new Map();

  getInterpretationProfiles(): ReadonlyMap<string, InterpretationProfile> {
    return this.interpretationProfiles;
  }

  /** Candidate ids the person-protection gate excluded from cross-candidate
   *  interpretation, with no reason attached -- the reasons themselves are
   *  recomputed by the diagnostic, which is the only consumer that needs them. */
  private personProtectedIds: ReadonlySet<string> = new Set<string>();

  getPersonProtectedIds(): ReadonlySet<string> {
    return this.personProtectedIds;
  }

  getContextualEvidence(): ContextualPersonEvidenceResult | null {
    return this.contextualEvidence;
  }

  /** What the residual-review gate did on the last FRESH load -- exposed
   *  for measurement and provenance inspection; null on a restored session,
   *  where the gate deliberately does not run. */
  private lastGateRun: GateRun | null = null;

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
    // Deterministic Semantic Relationship Knowledge (2026-07-30): the
    // REAL workspace engine carries the built-in curated providers
    // (related-name library today), so document loads produce
    // knowledge-augmented, evidence-annotated ambiguity proposals. Suites
    // and display-recalculation instances construct the engine bare and
    // stay byte-identical to the Python oracle -- see
    // semantic-augmentation.ts.
    this.resolutionEngine = deps.resolutionEngine ?? new RegexEntityResolutionEngine(builtInSemanticRelationshipProviders());
    this.occurrenceClassifier = deps.occurrenceClassifier ?? new RegexOccurrenceClassifier();
    // Structural Relationship Review (2026-07-30): stateless and
    // deterministic; not injectable via deps for now -- the detector
    // registry (StructuralRelationshipEngine's constructor) is the
    // extension point, and no test has needed to swap the whole engine.
    this.structuralRelationshipEngine = new StructuralRelationshipEngine();
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
    return {
      detection: this.detection,
      grouping: this.grouping,
      classification: this.classification,
      // Phase 2: type-check traversal membership -- see loadDocument().
      ...(this.semanticTypeGroups ? { semanticTypes: this.semanticTypeGroups } : {}),
      // REVIEW ARTIFACTS (AG, 2026-08-02): the structural relationship
      // proposals are reviewer work, so the work model must see them --
      // otherwise a stage completes and disappears with proposals still
      // outstanding (see navigation/stages.ts's REVIEW ARTIFACTS block).
      // Passed as the proposal list only; the DISMISSAL state that
      // dissolves one is read from ReviewSession at derivation time, so
      // this stays decision-blind like every other context member.
      ...(this.structuralRelationships ? { structuralRelationships: this.structuralRelationships.proposals } : {}),
    };
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

    const rawDetection = this.detectionEngine.detect(document);
    const profile = buildDefaultScoringProfileSnapshot(this.clock());
    // NORMALIZATION (AG, 2026-08-03) -- Detection -> Normalization ->
    // Grouping, per Andrew's pipeline. It collapses deterministic
    // conversational/formatting variants of an already-detected entity
    // ("Hi Andrew", "Thanks, Andrew") into the single review candidate the
    // reviewer should actually be asked about, preserving every original
    // detector span as evidence. See engines/normalization/normalization.ts.
    //
    // WHY QUALITY IS EVALUATED TWICE, deliberately. The pass's safety gate
    // is the quality engine's own person-name evidence for the MERGE
    // TARGET, so a first assessment must exist before normalization can
    // run; and normalization changes occurrence counts (folding seven
    // variants of "Andrew" together takes it from 46 to 72 occurrences),
    // which is itself scoring evidence -- so the assessment every
    // downstream stage reads has to describe the stream it is actually
    // describing, not the pre-merge one. Reusing the first pass would leave
    // assessments keyed to candidates that no longer exist and frequency
    // evidence that is quietly wrong. Measured cost on Andrew's real
    // 609-candidate transcript: 46ms, run twice. That is the right trade;
    // caching a stale assessment to save it would not be.
    //
    // CONTEXTUAL PERSON EVIDENCE (AG, 2026-08-05) runs BEFORE each quality
    // evaluation, because its output is an input to scoring, and is
    // recomputed after normalization for the same reason quality is: merging
    // seven variants of "Andrew" into one candidate changes which
    // occurrences that candidate owns, and therefore which sentences its
    // contextual evidence is drawn from. A stale pre-merge contextual result
    // would attribute the wrong representative example to the surviving
    // candidate -- exactly the "assessments keyed to candidates that no
    // longer exist" problem described above.
    const rawContextual = evaluateContextualPersonEvidence(document, rawDetection);
    const preNormalizationQuality = this.qualityEngine.evaluate(document, rawDetection, profile, rawContextual);
    const normalization = normalizeDetection(rawDetection, {
      categoriesOf: (candidateId) => qualityCategoriesOf(preNormalizationQuality.assessmentByCandidate[candidateId]),
      // GATE 3 (Andrew's decision, 2026-08-05): contextual evidence counts
      // as person-name evidence for the normalization merge gate -- but only
      // above GATE_3_CONTEXTUAL_THRESHOLD. See that constant's comment for
      // why presence alone is not enough to be allowed to authorize a merge.
      contextualStrengthOf: (candidateId) => rawContextual.byCandidate[candidateId]?.contribution ?? 0,
    });
    const detection = normalization.detection;
    const contextual = evaluateContextualPersonEvidence(document, detection);
    const quality = this.qualityEngine.evaluate(document, detection, profile, contextual);
    // IDENTITY CLEANUP (AG, 2026-08-02): the pure phrase-fragment pass
    // over the engine's proposals -- the same additive-layer slot as
    // semantic augmentation, wired HERE so every parity suite's bare
    // engine remains byte-identical to the Python oracle. See
    // identity-cleanup.ts's doc comment for rules and evidence sources.
    // Phase 2 (2026-08-02): the "filterRules if any, else reasons" rule
    // moved to domain/semanticTypes.ts's qualityCategoriesOf() when the
    // semantic-type assignment below became a second consumer -- one rule,
    // shared, instead of a third inline copy.
    const categoriesOf = (candidateId: string): readonly string[] => qualityCategoriesOf(quality.assessmentByCandidate[candidateId]);
    const proposed = this.resolutionEngine.propose(detection, quality);
    const grouping = cleanupIdentityOptions(proposed, detection, categoriesOf);
    const classification = this.occurrenceClassifier.classify(document, detection, quality, grouping);
    // Structural Relationship Review (2026-07-30): deterministic, derived,
    // recomputed per load -- deliberately SEPARATE from
    // EntityResolutionEngine's grouping (entity ambiguity is semantic
    // identity; this is non-semantic shape), which also keeps the
    // Python-parity surface untouched.
    const engineRelationships = this.structuralRelationshipEngine.propose(detection);
    // "Probable Name with Inserted Word" (AG, 2026-08-02): the identity-
    // cleanup pass contributes proposals over noisy-phrase entity groups
    // -- merged here, re-sorted to the result contract (by kind, then
    // proposalId), so every downstream consumer (cards, dismissals,
    // audit) sees one uniform proposal stream.
    const insertedWord = insertedWordNameProposals(grouping, detection, categoriesOf);
    // WORKSPACE METRICS (AG, 2026-08-02): factual cleanup record --
    // recomputed on every load (deterministic), never persisted.
    this.identityCleanupStats = identityCleanupStats(proposed, grouping, insertedWord.length);
    // Appended, not re-sorted: the engine's own KIND_ORDER governs its
    // proposals, and "inserted-word-name" is the final kind (order 3) --
    // appending preserves both contracts without re-deriving either.
    const structuralRelationships = {
      proposals: [...engineRelationships.proposals, ...insertedWord.sort((a, b) => a.proposalId.localeCompare(b.proposalId))],
    };

    // PHASE 2, TYPE CHECK (AG, 2026-08-02): the ONE semantic-type
    // assignment pass -- candidate insertion order preserved (Map), facts
    // read from the same pipeline outputs assembled just above (including
    // the merged inserted-word proposals, so relationship-derived types see
    // the full stream). Relationship DISMISSALS deliberately not consulted:
    // membership is decision-blind and stable for the document's lifetime
    // (see domain/semanticTypes.ts's SemanticTypeGroup doc comment).
    const kindsByCandidate = new Map<string, Set<RelationshipKind>>();
    for (const proposal of structuralRelationships.proposals) {
      for (const candidateId of proposal.candidateIds) {
        const kinds = kindsByCandidate.get(candidateId) ?? new Set<RelationshipKind>();
        kinds.add(proposal.kind);
        kindsByCandidate.set(candidateId, kinds);
      }
    }
    /* ===== CROSS-CANDIDATE COMPOSITION (AG, 2026-08-10) ==================
     * The protection gate is assembled here, from the engines that already
     * own each question, and handed to the pass as a conclusion -- see
     * engines/cross-candidate/person-evidence-gate.ts for why it is not
     * computed inside that module.
     *
     * ROUTING IS ENABLED (AG, 2026-08-10, second pass) through
     * `typeCheckSectionFor`, which routes a rejected person hypothesis with
     * no supported replacement to UNDETERMINED rather than to `other`. See
     * domain/semanticTypes.ts for why Undetermined is a routing state and
     * not a tenth SemanticTypeId.
     */
    const ambiguityCandidateIds = new Set(grouping.ambiguityProposals.map((p) => p.candidateId));
    const groupMembersById = new Map<string, string[]>();
    for (const group of grouping.entityGroupProposals) {
      for (const candidateId of group.candidateIds) {
        groupMembersById.set(candidateId, group.candidateIds.filter((other) => other !== candidateId));
      }
    }
    const directPersonEvidence = (candidateId: string): boolean => {
      const categories = categoriesOf(candidateId).map((c) => c.replace(/_/g, "-"));
      const positives = (quality.assessmentByCandidate[candidateId]?.positiveReasons ?? []).map((c) => c.replace(/_/g, "-"));
      return NAME_EVIDENCE_CATEGORIES.some((c) => categories.includes(c) || positives.includes(c)) || positives.includes("nearby-title");
    };
    // Census structure is computed once per candidate and kept, so the gate,
    // the diagnostic and the audit all read ONE evaluation rather than three.
    const censusByCandidate = new Map<string, CensusNameEvidence>();
    const gnisByCandidate = new Map<string, GnisPlaceEvidence>();
    for (const candidate of detection.candidates) {
      if (candidate.detectedType !== "person") continue;
      const evidence = censusNameEvidenceFor(candidate.displayValue);
      if (evidence.supportsNameStructure) censusByCandidate.set(candidate.id, evidence);
      // GNIS is evaluated over the same person-typed population: a geographic
      // name only reaches DocScrub at all because the person detector's broad
      // capitalized-phrase pattern picked it up.
      const place = gnisPlaceEvidenceFor(candidate.displayValue);
      if (place.strength !== "none") gnisByCandidate.set(candidate.id, place);
    }
    /*
     * HIGHER-ED TERMINOLOGY, computed once per candidate (AG, 2026-08-10).
     *
     * DELIBERATELY NOT FED INTO `personEvidenceFacts` BELOW. The
     * person-protection gate takes evidence FOR personhood; terminology
     * attestation is not that, and its inverse -- "attested terminology,
     * therefore not a person" -- is the failure this dataset's own
     * collision_risk column exists to warn about. `White` and `Major` are
     * attested terminology AND Census-attested surnames. Adding a
     * `hasHigherEdTerminology` disqualifier to that gate would suppress real
     * people, which is the one error class the gate was built to prevent.
     */
    const higherEdByCandidate = new Map<string, HigherEdTerminologyEvidence>();
    for (const candidate of detection.candidates) {
      const evidence = higherEdTerminologyFor(candidate.displayValue);
      if (evidence) higherEdByCandidate.set(candidate.id, evidence);
    }
    /*
     * MEDICAL/HEALTHCARE TERMINOLOGY, computed once per candidate
     * (AG, 2026-08-10).
     *
     * DELIBERATELY NOT FED INTO `personEvidenceFacts` BELOW, for the reason
     * stated for higher-ed above and one more that is specific to this family.
     * The gate takes evidence FOR personhood. Terminology attestation is not
     * that, and its inverse -- "attested medical terminology, therefore not a
     * person" -- would be acting on a dataset whose HIGH-risk population is
     * mostly two- and three-letter abbreviations, the exact shape a person's
     * initials take. Beyond that: a redaction tool must never treat "this
     * phrase is clinical" as a fact about whoever is named beside it, and the
     * cleanest way to guarantee that is for no gate, score or router to read
     * this map at all until a combination layer exists to read it carefully.
     */
    const medicalByCandidate = new Map<string, MedicalEvidence>();
    for (const candidate of detection.candidates) {
      const evidence = medicalEvidenceFor(candidate.displayValue);
      if (evidence) medicalByCandidate.set(candidate.id, evidence);
    }

    /*
     * ALL REFERENCE CHANNELS, gathered once (AG, 2026-08-10). See
     * `getReferenceEvidence` above for why this is one loop rather than a
     * sixth and seventh per-family loop, and why the next evidence family
     * should not need to edit this file at all.
     *
     * Stored for EVERY candidate, including those no channel attested, so the
     * diagnostic can distinguish "asked and nothing matched" from "never
     * asked". That distinction is the difference between a measurable miss and
     * an invisible one.
     *
     * READ BY NOTHING BELOW. It is assigned to the field and never consulted
     * by the type-check pass, the gate, the scorer or the router.
     */
    const referenceEvidenceByCandidate = new Map<string, ReferenceEvidenceChannels>();
    for (const candidate of detection.candidates) {
      referenceEvidenceByCandidate.set(candidate.id, referenceEvidenceFor(candidate.displayValue));
    }

    const personEvidenceFactsById = new Map<string, PersonEvidenceFacts>();
    const personEvidenceFacts: PersonEvidenceFacts[] = detection.candidates.map((candidate) => ({
      candidateId: candidate.id,
      qualityCategories: categoriesOf(candidate.id),
      positiveReasons: quality.assessmentByCandidate[candidate.id]?.positiveReasons ?? [],
      contextualRules: contextual.byCandidate[candidate.id]?.rules ?? [],
      hasCensusNameStructure: censusByCandidate.has(candidate.id),
      // A proposal or group is person evidence only when the PARTNER is
      // itself person-evidenced -- otherwise a spurious proposal corroborates
      // itself, which is the failure the witness audit found one layer down.
      hasPersonEvidencedLinkage:
        (groupMembersById.get(candidate.id) ?? []).some(directPersonEvidence) ||
        (ambiguityCandidateIds.has(candidate.id) && directPersonEvidence(candidate.id)),
    }));
    for (const facts of personEvidenceFacts) personEvidenceFactsById.set(facts.candidateId, facts);
    const protectedPersonIds = personEvidencedCandidateIds(personEvidenceFacts);
    const crossCandidate = evaluateCrossCandidateEvidence({
      candidates: detection.candidates,
      personEvidencedCandidateIds: protectedPersonIds,
    });

    /*
     * MULTI-INTERPRETATION PROFILES, Phase A (AG, 2026-08-10).
     *
     * Every reading the evidence affirmatively supports, per candidate, with
     * nothing chosen between them. See
     * engines/interpretation/candidate-interpretation.ts.
     *
     * PLACED HERE because this is the first point at which every input exists:
     * quality, contextual evidence, entity linkage, reference channels and
     * cross-candidate evidence have all been computed above. It reads them and
     * writes nothing back.
     *
     * READ BY NOTHING BELOW. `semanticAssignments`, the residual-review gate,
     * the recommendation layer and the audit export are all computed from the
     * same inputs they were before and never consult this map. Phase A is
     * measurement; the profiles exist so combination policy can be designed
     * against real populations instead of guessed at.
     */
    /*
     * DOCUMENT-LOCAL ATTESTED TOKENS (AG, 2026-08-10) -- every normalized
     * token appearing anywhere in this document's candidates that is EXACTLY
     * attested in Census name data.
     *
     * Computed once, here, because the interpretation layer owns no view of
     * the document and must not acquire one. It is what lets a variant lookup
     * ask "does this resemble a name THIS DOCUMENT already contains", which
     * runs against a few hundred tokens rather than 195,310 national forms.
     */
    const documentAttestedTokens = new Set<string>();
    for (const candidate of detection.candidates) {
      for (const token of candidate.displayValue.replace(/,/g, " ").split(/\s+/)) {
        const normalized = normalizeForCensusLookup(token);
        if (normalized.length === 0) continue;
        if (censusRoleFor(normalized) !== null) documentAttestedTokens.add(normalized);
      }
    }

    const interpretationProfiles = new Map<string, InterpretationProfile>();
    for (const candidate of detection.candidates) {
      const facts = personEvidenceFactsById.get(candidate.id);
      interpretationProfiles.set(
        candidate.id,
        interpretCandidate({
          candidateId: candidate.id,
          displayValue: candidate.displayValue,
          detectedType: candidate.detectedType,
          qualityCategories: categoriesOf(candidate.id),
          positiveReasons: quality.assessmentByCandidate[candidate.id]?.positiveReasons ?? [],
          relationshipKinds: [...(kindsByCandidate.get(candidate.id) ?? new Set<RelationshipKind>())],
          contextualRules: contextual.byCandidate[candidate.id]?.rules ?? [],
          hasPersonEvidencedLinkage: facts?.hasPersonEvidencedLinkage ?? false,
          // Absent for person-protected candidates: the gate excludes them
          // from cross-candidate output entirely, and this inherits that
          // rather than working around it.
          ...(crossCandidate.byCandidate[candidate.id] !== undefined
            ? { crossCandidate: crossCandidate.byCandidate[candidate.id]! }
            : {}),
          reference: referenceEvidenceByCandidate.get(candidate.id)!,
          documentAttestedTokens,
        })
      );
    }

    const semanticAssignments = new Map<string, TypeCheckSectionId>();
    const interpretations = new Map<string, CandidateInterpretation>();
    for (const candidate of detection.candidates) {
      const interpretation = typeCheckSectionFor(
        {
          detectedType: candidate.detectedType,
          categories: categoriesOf(candidate.id),
          relationshipKinds: kindsByCandidate.get(candidate.id) ?? new Set<RelationshipKind>(),
          censusNameStructure: censusByCandidate.has(candidate.id),
          // Carried, never branched on -- see the field's own doc comment in
          // domain/semanticTypes.ts. Passing it here is what makes the future
          // combination change a local edit rather than a plumbing exercise.
          higherEdTerminologyAttested: higherEdByCandidate.has(candidate.id),
          // Likewise carried, never branched on. Passing it here is what makes
          // the future combination change a local edit rather than a plumbing
          // exercise -- and what makes the inertness assertion in
          // verify/medical-evidence-verification.ts §11 meaningful, since the
          // fact genuinely reaches the interpretation boundary in production.
          medicalTerminologyAttested: medicalByCandidate.has(candidate.id),
        },
        crossCandidate.byCandidate[candidate.id] !== undefined
      );
      interpretations.set(candidate.id, interpretation);
      semanticAssignments.set(candidate.id, interpretation.section);
    }
    const semanticTypeGroups = buildSemanticTypeGroups(semanticAssignments);

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

    /*
     * THE RESIDUAL-REVIEW GATE (AG, 2026-08-09, Phase 2).
     *
     * Runs once per load, HERE, because this is the narrowest point at which
     * every input it consumes exists and nothing downstream has yet asked
     * "what is left to review": detection, quality and contextual evidence
     * are all computed above, and the navigator is constructed below. A gate
     * anywhere later would be a filter over an answer already given.
     *
     * FRESH SESSIONS ONLY. A restored session already carries whatever the
     * gate concluded when it was created, plus every decision the reviewer
     * has made since. Re-running would either re-resolve candidates the
     * reviewer had deliberately reopened, or (worse) resolve ones a NEWER
     * rule now matches without them noticing -- silently changing a document
     * they thought they had finished. Same reasoning as `processingRevisions`
     * above: a deliberate rescan under new rules is a separate, explicit act.
     *
     * It cannot touch decided candidates: `decidedCandidateIds` is passed in
     * and the gate refuses anything already settled. On a fresh session that
     * set is empty except for imported decisions, which it still respects.
     */
    if (!sessionRestored) {
      const gateFacts = buildGateFacts({
        candidates: detection.candidates,
        assessmentByCandidate: quality.assessmentByCandidate,
        contextualByCandidate: contextual.byCandidate,
        decidedCandidateIds: new Set(Object.keys(session.candidateDecisions)),
        automaticallyResolvedIds: new Set(Object.keys(session.automaticResolutions ?? {})),
        // Document-derived name evidence (2026-08-09): entity resolution has
        // already run above, so the signal that settles a bare "Agnes"
        // against a full name in THIS document is available here.
        ambiguityProposalCandidateIds: new Set(grouping.ambiguityProposals.map((p) => p.candidateId)),
        entityGroupMemberIds: new Set(grouping.entityGroupProposals.flatMap((g) => g.candidateIds)),
      });
      const gateRun = runResidualReviewGate(gateFacts, this.clock());
      if (gateRun.resolutions.length > 0) {
        const resolutions: Record<string, AutomaticResolution> = { ...(session.automaticResolutions ?? {}) };
        for (const r of gateRun.resolutions) resolutions[r.candidateId] = r;
        session = { ...session, automaticResolutions: resolutions };
      }
      this.lastGateRun = gateRun;
    } else {
      this.lastGateRun = null;
    }

    this.document = document;
    this.contextualEvidence = contextual;
    this.crossCandidateEvidence = crossCandidate;
    this.candidateInterpretations = interpretations;
    this.censusNameEvidence = censusByCandidate;
    this.gnisPlaceEvidence = gnisByCandidate;
    this.higherEdTerminology = higherEdByCandidate;
    this.medicalTerminology = medicalByCandidate;
    this.referenceEvidence = referenceEvidenceByCandidate;
    this.interpretationProfiles = interpretationProfiles;
    this.personProtectedIds = protectedPersonIds;
    this.detection = detection;
    this.rawDetection = rawDetection;
    this.normalization = normalization;
    this.quality = quality;
    this.grouping = grouping;
    this.classification = classification;
    this.structuralRelationships = structuralRelationships;
    // Set BEFORE the navigator construction below -- navigationContext()
    // embeds it, and the navigator binds its context once.
    this.semanticTypeGroups = semanticTypeGroups;
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
    // DECISION MEMORY (AG, 2026-08-03): carry forward what this reviewer
    // already decided in earlier documents, BEFORE the initial autosave
    // below so the freshly-persisted record already reflects it.
    // Deliberately skipped for a RESTORED session -- those decisions are
    // the reviewer's own, already made against this very document, and
    // re-deriving over them would be both pointless and a chance to
    // disturb work that is already correct.
    if (!sessionRestored) await this.applyRememberedDecisions();

    this.scheduleAutosave();

    return { ok: true, sessionRestored };
  }

  /**
   * Apply decisions this reviewer made in EARLIER documents to the document
   * just loaded -- "review once, apply everywhere" without an export/import
   * round trip (AG, 2026-08-03).
   *
   * EXACT-KEY TIER ONLY, and that restriction is the heart of the design.
   * `DeterministicDecisionReuseEngine` offers three tiers; the other two
   * (grouped-alias, similarity-threshold) each involve a JUDGEMENT that one
   * string stands for the same thing as another. Those judgements are
   * perfectly reasonable when a reviewer has explicitly chosen to import a
   * decisions file, but this path was not asked for -- it happens on every
   * load -- so it is confined to the tier that asserts nothing at all: the
   * candidate key (normalizeCandidate()'s "type:normalized text") is
   * byte-identical to one already decided. That is a statement of fact, not
   * an inference, which is what makes automatic application defensible
   * without the system needing any theory about WHY an edit was made (AG's
   * own framing: a stray word this time, "not guaranteed in future edits").
   *
   * NOT SILENT. Every applied decision goes through the same
   * `applyDecisionReuse` command the file-import path uses, so each lands
   * stamped `source: "imported"` with its `DecisionReuseEvidence`, is
   * rendered with the existing provenance suffix, appears in the audit
   * export, and is overridable by the reviewer like any other. This
   * respects the standing rule that the app never invents confirmation
   * history a reviewer did not create -- a carried-over decision is
   * permanently distinguishable from one authored here.
   *
   * NEVER OVERWRITES. `applyDecisionReuse` already skips candidates that
   * already carry a decision, so this cannot disturb existing work.
   *
   * BEST EFFORT. Any failure (storage unavailable, malformed records)
   * leaves the document loaded with no carried-over decisions rather than
   * failing the load: this is a convenience, and it must never be the
   * reason a reviewer cannot open a document.
   */
  private async applyRememberedDecisions(): Promise<void> {
    if (!this.document || !this.detection || !this.grouping || !this.reviewEngine) return;
    try {
      const memories = await this.sessionRepository.listDecisionMemory(this.document.documentId);
      if (memories.length === 0) return;
      const merged = mergeDecisionMemory(memories);
      if (merged.candidates.length === 0) return;

      const proposals = this.decisionReuseEngine
        .proposeReuse(this.detection, this.grouping, merged)
        .filter((proposal) => proposal.evidence.tier === "exact-key");
      if (proposals.length === 0) return;

      const beforeDecided = new Set(Object.keys(this.reviewEngine.getState().candidateDecisions));
      const result = this.reviewEngine.dispatch({ family: "review", type: "applyDecisionReuse", proposals });
      if (!result.ok) return;
      this.reconcileFocus();

      const appliedCount = proposals.filter((p) => !beforeDecided.has(p.candidateId)).length;
      this.lastDecisionReuseSummary = {
        sourceDocumentId: merged.documentId,
        sourceSessionId: merged.sessionId,
        proposalCount: proposals.length,
        // Exact-key by construction -- the other tiers were filtered out
        // above, and stating that here keeps the summary honest rather than
        // implying tiers that were never considered.
        tierCounts: { "exact-key": proposals.length, "grouped-alias": 0, "similarity-threshold": 0 },
        appliedCount,
        skippedAlreadyDecidedCount: proposals.length - appliedCount,
        origin: "decision-memory",
        documentsDrawnFrom: memories.length,
      };
    } catch {
      // Intentionally swallowed -- see this method's "BEST EFFORT" note.
    }
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

  /**
   * Resolves once every autosave scheduled SO FAR has settled.
   *
   * Exists for one narrow, real problem (AG, 2026-08-03): loadDocument()
   * ends with a fire-and-forget `scheduleAutosave()` so a freshly opened
   * document is immediately resumable, but the UI's own "refresh the
   * Recent Documents list" call runs straight afterwards and therefore
   * usually READ the repository before that write landed -- the document
   * the reviewer just opened was missing from the list until some later,
   * unrelated refresh happened to pick it up. Switching documents at that
   * moment appeared to lose the newly opened one.
   *
   * Deliberately NOT a way to make autosave blocking: `scheduleAutosave()`
   * stays fire-and-forget for every decision path (the "uninterrupted
   * review flow" rule above is unchanged). This only lets a caller that
   * genuinely needs to READ BACK what was just written wait for it, which
   * is a different thing from making the write synchronous.
   *
   * Never rejects -- persistCurrentSession() captures its own errors into
   * `lastAutosaveError` (surfaced via getState().persistence), so a failed
   * autosave settles this promise rather than throwing at a caller that
   * only wants to know "is it safe to re-read now."
   */
  async autosaveSettled(): Promise<void> {
    await this.autosaveQueue;
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
      // DECISION MEMORY (AG, 2026-08-03): re-projected from the session on
      // every save rather than maintained incrementally, so it cannot drift
      // from the decisions it describes (see DecisionMemory.ts). Awaited
      // inside the same try as the session save -- a memory write that
      // fails should surface exactly like any other autosave failure rather
      // than being silently swallowed and leaving the reviewer with a
      // memory that quietly stopped updating.
      await this.sessionRepository.saveDecisionMemory(projectDecisionMemory(session, this.document.documentId, session.updatedAt));
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

  async listArchivedSessions(limit?: number): Promise<SessionSummary[]> {
    return this.sessionRepository.listRecent(limit, { archived: true });
  }

  /**
   * The stored session for `documentId`, or null if this document has never
   * been worked on (AG, 2026-08-03, reopen prompt).
   *
   * Reads through `listRecent()` with NO limit rather than the repository's
   * `load()`, for one deliberate reason: `load()` also stamps the record's
   * `lastOpenedAt` as a side effect (see LocalSessionRepository's own note
   * on why that is load()'s job). This is a pure question -- "do you know
   * this file?" -- asked before the reviewer has decided to open anything,
   * so it must not mutate the recents ordering. A reviewer who picks a file
   * and then cancels should leave no trace.
   */
  async findStoredSession(documentId: string): Promise<SessionSummary | null> {
    const all = await this.sessionRepository.listRecent();
    return all.find((summary) => summary.documentId === documentId) ?? null;
  }

  /** Passthrough removal for a Recent Documents "remove from list"
   *  affordance -- deliberately the only management operation exposed
   *  (Andrew: "do not implement a document-management system"). */
  async deleteStoredSession(documentId: string): Promise<void> {
    return this.sessionRepository.delete(documentId);
  }

  async archiveStoredSession(documentId: string): Promise<void> {
    return this.sessionRepository.archive(documentId, this.clock());
  }

  async restoreStoredSession(documentId: string): Promise<void> {
    return this.sessionRepository.restore(documentId);
  }

  /** UI-STATE PERSISTENCE (AG, 2026-08-02): document-tied UI snapshot
   *  passthroughs -- the workspace neither reads nor interprets the
   *  snapshot (its shape is the UI layer's; see
   *  LocalSessionRepository.PersistedUiState). Best-effort by contract:
   *  callers fire-and-forget saves and treat load failures as "no
   *  snapshot". */
  async saveUiState(documentId: string, uiState: PersistedUiState): Promise<void> {
    return this.sessionRepository.saveUiState(documentId, uiState);
  }

  async loadUiState(documentId: string): Promise<PersistedUiState | null> {
    return this.sessionRepository.loadUiState(documentId);
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
      origin: "imported-file",
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
  /** The last fresh-load gate run: what was resolved, and why each retained
   *  candidate survived. Null on a restored session (the gate does not run).
   *  Read-only accessor -- measurement and provenance, never a control. */
  getResidualGateRun(): GateRun | null {
    return this.lastGateRun;
  }

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
        structuralRelationships: null,
        semanticTypes: null,
        reviewSession: null,
        focus: null,
        stageStatuses: [],
        readiness: EMPTY_READINESS,
        verification: null,
        hasGeneratedOutput: false,
        persistence: EMPTY_PERSISTENCE_STATUS,
        identityCleanup: null,
        normalization: null,
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
      unresolvedArtifactCount: stageStatuses.reduce((sum, status) => sum + status.unresolvedArtifactCount, 0),
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
      structuralRelationships: this.structuralRelationships,
      semanticTypes: this.semanticTypeGroups,
      reviewSession: session,
      focus: this.focusNavigator.getFocus(),
      stageStatuses,
      readiness,
      verification,
      hasGeneratedOutput: verificationCurrent,
      identityCleanup: this.identityCleanupStats,
      normalization: this.normalization,
      persistence: {
        lastAutosaveAt: this.lastAutosaveAt,
        lastAutosaveError: this.lastAutosaveError,
        quotaStatus: this.lastQuotaStatus,
      },
    };
  }
}
