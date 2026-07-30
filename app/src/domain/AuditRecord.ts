/**
 * AuditRecord — the versioned, canonical audit artifact produced by
 * AuditExporter (architecture v0.2 §6.15, Gate D). This is the single
 * source of truth for everything the review process decided; every other
 * export format AuditExporter produces (redaction-log CSV, a decisions-only
 * JSON, a metrics-only JSON) is a DERIVED PROJECTION of this one record --
 * assembled once, here, never recomputed four separate times. See
 * AuditExporter.ts's own doc comment for how each projection is derived.
 *
 * Design decisions made explicit, per Andrew's Phase 11 instruction (see
 * docs/detection/phase-11-findings.md for the full writeup and the Python-
 * oracle research this was based on):
 *
 * - Serialization format: JSON. Matches every other durable artifact in
 *   this codebase (ReviewSession, WorkspaceSaveFile, VerificationReport) --
 *   there is no reason for the audit artifact to be the one exception.
 * - Ordering guarantees: `candidates` is sorted by `candidateId`,
 *   `entityGroups` by `groupId`, `ambiguityResolutions` by `candidateId` --
 *   not by whatever order the underlying Records/Maps happened to iterate
 *   in -- so two exports of byte-identical review state produce
 *   byte-identical JSON (other than `generatedAt`, see below). Each
 *   candidate's own `occurrences` array preserves DetectionResult's
 *   existing deterministic `occurrenceIds` order rather than being
 *   re-sorted -- that order is already a real, tested guarantee (Phase
 *   4-7's parity suites), no need to impose a second one.
 * - Versioning: `schemaVersion` is a literal, bumped only on an
 *   incompatible shape change -- the same convention as every other
 *   `schemaVersion` in this codebase.
 * - Missing optional values: represented by omitting the key entirely
 *   (matches `exactOptionalPropertyTypes` conventions already used
 *   throughout this codebase, e.g. FocusResumePosition/WorkspaceSaveFile),
 *   EXCEPT where the field's presence/absence is itself the fact being
 *   recorded -- `verification: null` and `output.outputDocumentId` absent
 *   are meaningful states, not just "value not supplied," so those are
 *   documented per-field below rather than silently treated the same as
 *   an ordinary optional field.
 * - Relationship to the rebuilt output document: `output.outputDocumentId`
 *   is a SHA-256 of the rebuilt Blob's own bytes (the same hash function
 *   `DocumentModel.documentId` uses for the INPUT file -- see
 *   `src/io/hash.ts`), so a consumer can independently confirm this audit
 *   record describes exactly one specific output file, byte for byte,
 *   without trusting any claim inside the record itself. `output.available`
 *   is false (and `outputDocumentId` omitted) whenever no rebuilt output
 *   currently exists for the CURRENT session state -- AuditExporter is
 *   handed Workspace's own already-staleness-checked `getRebuiltOutput()`
 *   result rather than re-deriving staleness itself (§ "derive, don't
 *   duplicate", same principle Phase 10's `verificationCurrent` used).
 * - Audit generation before successful verification: ALLOWED, deliberately.
 *   The Python oracle's own `generate_outputs()` never blocks export on its
 *   post-write rescan's outcome -- audit generation there is unconditional,
 *   and the rescan is advisory-only, returned alongside the export rather
 *   than gating it (confirmed by reading `local_web_app.py` directly; see
 *   phase-11-findings.md). This record keeps that same non-blocking
 *   behavior, but improves on Python's actual practice in one concrete way:
 *   Python's CSV/QA-metrics/decisions files, once written, carry NO record
 *   that verification ever ran or what it found -- a rescan failure after
 *   the fact leaves already-written files looking exactly like a clean
 *   pass. This record ALWAYS embeds the verification outcome (or its
 *   explicit absence via `verification: null`) inline, so nothing about
 *   verification state is ever silently missing from the trail.
 *   `readyForRelease` is computed once, here, from exactly the rule
 *   `Workspace.readiness.exportEnabled` already uses (verification present
 *   AND passed) -- reused via the same null-collapsing input, not
 *   re-derived from scratch.
 * - Minimizing sensitive content: unlike Python's redaction-log CSV (which
 *   embeds a raw ±70-character text window around every match) and QA
 *   metrics JSON (which embeds every candidate's raw literal text), this
 *   record never carries source document text, at all -- not the matched
 *   PII value, not surrounding context. It carries only: stable IDs,
 *   detected TYPE (e.g. "person", "email" -- a category, not a value),
 *   decision metadata, and the reviewer's own typed replacement text (which
 *   is operator-authored content, not source document content). This is a
 *   deliberate, approved behavioral deviation from the Python oracle's
 *   actual (not merely historical) practice -- see phase-11-findings.md.
 *
 * FEATURE 002 UPDATE (Decision Reuse): AuditedCandidate gained `source`,
 * `wasImported`, and `importEvidence`, so an audit reader can distinguish
 * three categories Andrew's instruction explicitly asks for -- reviewer
 * decisions, imported decisions, and reviewer overrides of imported
 * decisions -- without duplicating information. `source`/`importEvidence`
 * describe the CURRENT decision only (mirrors CandidateDecision itself);
 * `wasImported` is the one field that requires looking PAST the current
 * decision (derived from the durable event log, not the decision snapshot
 * -- see AuditExporter.ts's wasEverImported()), because an override
 * replaces the whole CandidateDecision object and leaves no trace of a
 * prior import in the snapshot alone. The three-way distinction reads as:
 * source="reviewer" && !wasImported -> ordinary reviewer decision;
 * source="imported" (implies wasImported) -> untouched import;
 * source="reviewer" && wasImported -> reviewer overrode an import.
 * DecisionReuseEvidence itself carries no source document content (tier,
 * confidence, a matched candidateId, and a description built only from
 * already-content-free values -- see DecisionReuseEngine.ts), so this
 * addition does not weaken the minimization guarantee above.
 */

import type { FidelityFinding } from "./VerificationReport.js";
import type { ScoringProfileSnapshot } from "./ScoringProfileSnapshot.js";
import type { CandidateDecisionSource, ResolvedStatus } from "./ReviewSession.js";
import type { DecisionReuseEvidence } from "./DecisionReuse.js";

export const AUDIT_RECORD_SCHEMA_VERSION = 1 as const;

/** Mirrors ReviewSession's CandidateDecisionKind plus a synthetic
 *  "Undecided" value for candidates with no `CandidateDecision` entry at
 *  all -- ReviewSession itself has no stored "undecided" state (absence of
 *  an entry IS undecided), but the audit record needs to represent that
 *  absence as a value like any other decision, not omit the candidate. */
export type AuditedDecisionKind = "Keep" | "Rename" | "Redact" | "Ignore" | "Undecided";

export interface AuditedOccurrence {
  occurrenceId: string;
  blockId: string;
}

export interface AuditedCandidate {
  candidateId: string;
  /** e.g. "person", "email" -- a category, never the matched value itself. */
  detectedType: string;
  decision: AuditedDecisionKind;
  /** The reviewer's own typed replacement text (Rename/Redact only). This
   *  is operator-authored content, not source document content -- present
   *  only when the reviewer actually set one. */
  replacement?: string;
  /** Absent when decision is "Undecided" -- there is no decision event to
   *  date for this candidate. */
  decidedAt?: string;
  /** Feature 002: who/what produced the CURRENT decision. Absent when
   *  decision is "Undecided" (mirrors decidedAt's own absence rule --
   *  there is no decision to attribute a source to). */
  source?: CandidateDecisionSource;
  /** Feature 002: true if ANY decision-reuse import ever applied to this
   *  candidate, even if a later reviewer action has since overridden it.
   *  Derived from the durable event log, not from the current decision
   *  snapshot -- see AuditExporter.ts's wasEverImported(). Combined with
   *  `source`, this is what distinguishes an untouched import
   *  (source="imported") from a reviewer override of one
   *  (source="reviewer" && wasImported=true). */
  wasImported: boolean;
  /** Feature 002: present iff source === "imported" -- explains why this
   *  decision was reused rather than newly made. Never present once a
   *  reviewer has overridden the decision (see CandidateDecision's own doc
   *  comment for why the evidence is not retained past an override). */
  importEvidence?: DecisionReuseEvidence;
  occurrenceCount: number;
  occurrences: AuditedOccurrence[];
  resolvedStatus: ResolvedStatus;
}

export interface AuditedEntityGroup {
  groupId: string;
  canonicalName: string;
  detectedType: string;
  decision: "Confirmed" | "Rejected" | "Refined";
  decidedAt: string;
  confirmedMemberCandidateIds: string[];
  /** True when this group's decision is "Refined" -- i.e. it went through
   *  Not Quite (per-member edits) before being confirmed. Surfaced as its
   *  own named boolean, not left implicit in `decision`, since this is
   *  specifically the "reclassified entities" signal Andrew's instruction
   *  asked the audit to establish. */
  wentThroughNotQuite: boolean;
}

export interface AuditedAmbiguityResolution {
  candidateId: string;
  resolvedGroupId: string;
  decidedAt: string;
}

export interface AuditSummary {
  totalCandidates: number;
  decisionCounts: Record<AuditedDecisionKind, number>;
  /** Count of candidates whose resolvedStatus is NOT "resolved" (i.e.
   *  "partially-resolved" or "unresolved" both count) -- a stricter bar
   *  than "has any decision," since a candidate can have decided members
   *  in one group but still have uncovered occurrences elsewhere. */
  unresolvedCount: number;
}

export interface AuditVerificationSummary {
  schemaVersion: 1;
  verifiedAt: string;
  passed: boolean;
  rescanFoundOriginalValues: boolean;
  blockerFindingCount: number;
  warningFindingCount: number;
  /** Already content-free by construction (category/severity/description/
   *  blockId -- see VerificationReport.ts); included in full, not summarized
   *  further, since none of it is source document content. */
  fidelityFindings: FidelityFinding[];
}

export interface AuditOutputReference {
  available: boolean;
  /** SHA-256 of the rebuilt output's own bytes. Present iff `available`. */
  outputDocumentId?: string;
}

export interface AuditRecord {
  schemaVersion: typeof AUDIT_RECORD_SCHEMA_VERSION;
  /** Real wall-clock export time -- the ONE field expected to differ
   *  between two exports of otherwise byte-identical review state, exactly
   *  as Python's own CSV `timestamp` column always has (see
   *  phase-11-findings.md). */
  generatedAt: string;
  applicationVersion: string;

  documentId: string;
  fileName: string;

  sessionId: string;
  sessionCreatedAt: string;
  sessionUpdatedAt: string;

  pipelineConfiguration: {
    /** The scoring profile in effect for the LATEST ProcessingRevision --
     *  reused directly from ReviewSession, never recomputed, per ADR-015's
     *  own purpose (pin the weights/thresholds/versions that were actually
     *  in effect). */
    scoringProfile: ScoringProfileSnapshot;
    processingRevisionCount: number;
  };

  candidates: AuditedCandidate[];
  entityGroups: AuditedEntityGroup[];
  ambiguityResolutions: AuditedAmbiguityResolution[];

  summary: AuditSummary;

  /** null when no CURRENT (non-stale) VerificationReport exists for this
   *  session state -- either verification was never run, or a review
   *  decision changed after the last run (same staleness rule Workspace's
   *  own `readiness.verificationCurrent` already derives; this record
   *  receives that already-resolved null-or-report value rather than
   *  re-deriving staleness itself). */
  verification: AuditVerificationSummary | null;
  output: AuditOutputReference;

  /** = verification !== null && verification.passed. Computed once, here,
   *  from exactly the rule `Workspace.readiness.exportEnabled` already
   *  uses, so a consumer never has to cross-reference Workspace state or
   *  re-derive this themselves. */
  readyForRelease: boolean;

  /** True when unresolvedCount > 0 OR !readyForRelease. This record can
   *  still be generated in exactly this state (see "Audit generation
   *  before successful verification" above) -- this field exists so a
   *  reader of the artifact never has to assume a clean review just
   *  because a file exists. */
  hasOutstandingIssues: boolean;
}
