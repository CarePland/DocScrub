/**
 * VerificationReport — the value object produced by OutputVerifier and
 * consumed by AuditExporter. NEW in architecture v0.2 (ADR-016), replacing
 * v0.1's undefined direct dependency between AuditExporter and
 * DocumentRebuilder. See §6.13, §6.14, §10.
 */

export interface FidelityFinding {
  /** e.g. "run-splitting", "tracked-changes", "nested-table" */
  category: string;
  severity: "blocker" | "warning";
  description: string;
  blockId?: string;
}

export interface VerificationReport {
  schemaVersion: 1;
  documentId: string;
  verifiedAt: string; // ISO 8601
  /** Result of re-scanning the rebuilt DOCX for any of the original
   *  candidates' unredacted values (§6.13's "support post-generation
   *  verification or rescan", moved here from DocumentRebuilder). */
  rescanFoundOriginalValues: boolean;
  rescanMatches: Array<{ candidateId: string; blockId: string }>;
  fidelityFindings: FidelityFinding[];
  /** True only if there are no blocker-severity fidelity findings and the
   *  rescan found none of the original sensitive values. */
  passed: boolean;
}
