/**
 * usageMetrics.ts -- privacy-safe account usage aggregates (2026-08-06).
 *
 * DocScrub's document review remains local-first. This module never sends a
 * filename, file path, snippet, detected value, replacement, or per-item
 * decision payload to Supabase. It derives only aggregate counts from the
 * existing in-browser WorkspaceState and submits them best-effort through
 * database RPCs protected by RLS / internal-admin checks.
 */

import type { CandidateDecisionKind } from "../domain/ReviewSession.js";
import { partitionCandidatesByResolution } from "../engines/review/coverage.js";
import type { WorkspaceState } from "../workspace/Workspace.js";
import { decisionTrackerFigures } from "../metrics/decisionTracker.js";

export type UsageCompletionStatus = "started" | "incomplete" | "completed" | "abandoned";
export type UsageExportType = "docx" | "csv_audit" | "json_decisions";

export interface UsageExportCounts {
  csvAudit: number;
  docx: number;
  jsonDecisions: number;
}

export interface DocumentUsageMetricPayload {
  appVersion: string;
  changeCount: number;
  completedAt: string | null;
  completionStatus: UsageCompletionStatus;
  decisionsAvoided: number;
  decisionsMade: number;
  documentFormat: string;
  exportCounts: UsageExportCounts;
  ignoreCount: number;
  keepCount: number;
  lastUpdatedAt: string;
  occurrenceCount: number;
  opaqueSessionId: string;
  organizationId: string | null;
  pageCount: number | null;
  redactCount: number;
  reviewItemCount: number;
  startedAt: string;
}

export interface UsageMetricSummary {
  averageDecisionsPerDocument: number | null;
  averageReductionPercentage: number | null;
  changeDecisions: number;
  completedDocuments: number;
  completionRate: number;
  csvAuditExports: number;
  decisionsAvoided: number;
  decisionsMade: number;
  docxExports: number;
  documents: number;
  exportCount: number;
  ignoreDecisions: number;
  jsonDecisionExports: number;
  keepDecisions: number;
  pages: number;
  redactDecisions: number;
  reviewItems: number;
}

const PENDING_METRICS_KEY = "docscrub-pending-usage-metrics";
const SESSION_ID_PREFIX = "docscrub-usage-session-id:";

function nonnegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

function roundPercent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function decisionCounts(decisions: Record<string, { decision: CandidateDecisionKind }> | undefined): {
  changeCount: number;
  ignoreCount: number;
  keepCount: number;
  redactCount: number;
} {
  const counts = { changeCount: 0, ignoreCount: 0, keepCount: 0, redactCount: 0 };
  for (const decision of Object.values(decisions ?? {})) {
    switch (decision.decision) {
      case "Keep":
        counts.keepCount += 1;
        break;
      case "Rename":
        counts.changeCount += 1;
        break;
      case "Redact":
        counts.redactCount += 1;
        break;
      case "Ignore":
        counts.ignoreCount += 1;
        break;
    }
  }
  return counts;
}

export function decisionsAvoidedPercentage(decisionsAvoided: number, decisionsMade: number): number {
  return roundPercent(nonnegative(decisionsAvoided), nonnegative(decisionsAvoided) + nonnegative(decisionsMade));
}

export function summarizeUsageMetrics(rows: Array<{
  change_count: number | null;
  completion_status: string | null;
  decisions_avoided: number | null;
  decisions_made: number | null;
  export_csv_audit_count: number | null;
  export_docx_count: number | null;
  export_json_decisions_count: number | null;
  ignore_count: number | null;
  keep_count: number | null;
  page_count: number | null;
  redact_count: number | null;
  review_item_count: number | null;
}>): UsageMetricSummary {
  const totals = rows.reduce(
    (sum, row) => {
      sum.changeDecisions += nonnegative(row.change_count ?? 0);
      sum.completedDocuments += row.completion_status === "completed" ? 1 : 0;
      sum.csvAuditExports += nonnegative(row.export_csv_audit_count ?? 0);
      sum.decisionsAvoided += nonnegative(row.decisions_avoided ?? 0);
      sum.decisionsMade += nonnegative(row.decisions_made ?? 0);
      sum.docxExports += nonnegative(row.export_docx_count ?? 0);
      sum.ignoreDecisions += nonnegative(row.ignore_count ?? 0);
      sum.jsonDecisionExports += nonnegative(row.export_json_decisions_count ?? 0);
      sum.keepDecisions += nonnegative(row.keep_count ?? 0);
      sum.pages += nonnegative(row.page_count ?? 0);
      sum.redactDecisions += nonnegative(row.redact_count ?? 0);
      sum.reviewItems += nonnegative(row.review_item_count ?? 0);
      return sum;
    },
    {
      changeDecisions: 0,
      completedDocuments: 0,
      csvAuditExports: 0,
      decisionsAvoided: 0,
      decisionsMade: 0,
      docxExports: 0,
      ignoreDecisions: 0,
      jsonDecisionExports: 0,
      keepDecisions: 0,
      pages: 0,
      redactDecisions: 0,
      reviewItems: 0,
    }
  );
  const exportCount = totals.docxExports + totals.csvAuditExports + totals.jsonDecisionExports;
  return {
    ...totals,
    averageDecisionsPerDocument: rows.length > 0 ? Math.round((totals.decisionsMade / rows.length) * 10) / 10 : null,
    averageReductionPercentage: totals.decisionsMade + totals.decisionsAvoided > 0
      ? decisionsAvoidedPercentage(totals.decisionsAvoided, totals.decisionsMade)
      : null,
    completionRate: rows.length > 0 ? roundPercent(totals.completedDocuments, rows.length) : 0,
    documents: rows.length,
    exportCount,
  };
}

export function opaqueUsageSessionId(documentId: string): string {
  const key = `${SESSION_ID_PREFIX}${documentId}`;
  try {
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const generated = crypto.randomUUID();
    window.localStorage.setItem(key, generated);
    return generated;
  } catch {
    return crypto.randomUUID();
  }
}

export function deriveDocumentUsagePayload(
  state: WorkspaceState,
  {
    appVersion,
    exportCounts = { csvAudit: 0, docx: 0, jsonDecisions: 0 },
    opaqueSessionId,
    organizationId,
  }: {
    appVersion: string;
    exportCounts?: UsageExportCounts;
    opaqueSessionId: string;
    organizationId: string | null;
  }
): DocumentUsageMetricPayload | null {
  if (!state.documentLoaded || !state.documentId || !state.reviewSession || !state.detection) {
    return null;
  }

  const candidates = state.detection.candidates ?? [];
  const resolvedCandidates = partitionCandidatesByResolution(state.reviewSession, state.detection).resolved;
  const tracker = decisionTrackerFigures(state.reviewSession, resolvedCandidates);
  const counts = decisionCounts(state.reviewSession.candidateDecisions);
  const now = new Date().toISOString();
  const completionStatus: UsageCompletionStatus = state.readiness.reviewComplete ? "completed" : "incomplete";

  return {
    appVersion,
    ...counts,
    completedAt: completionStatus === "completed" ? state.reviewSession.updatedAt : null,
    completionStatus,
    decisionsAvoided: nonnegative(tracker.avoidedDecisionCount),
    decisionsMade: nonnegative(tracker.decisionsMade),
    documentFormat: "docx",
    exportCounts: {
      csvAudit: nonnegative(exportCounts.csvAudit),
      docx: nonnegative(exportCounts.docx),
      jsonDecisions: nonnegative(exportCounts.jsonDecisions),
    },
    lastUpdatedAt: now,
    occurrenceCount: candidates.reduce((sum, candidate) => sum + candidate.occurrenceIds.length, 0),
    opaqueSessionId,
    organizationId,
    pageCount: null,
    reviewItemCount: candidates.length,
    startedAt: state.reviewSession.createdAt,
  };
}

export async function submitDocumentUsageMetric(payload: DocumentUsageMetricPayload): Promise<void> {
  const env = typeof window !== "undefined" ? window.__DOCSCRUB_ENV__ : undefined;
  if (!env?.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("Supabase configuration missing for usage metrics.");
  }
  const { supabase } = await import("../lib/supabase.js");
  const { error } = await supabase.rpc("upsert_document_usage_metric", {
    p_app_version: payload.appVersion,
    p_change_count: payload.changeCount,
    p_completed_at: payload.completedAt,
    p_completion_status: payload.completionStatus,
    p_decisions_avoided: payload.decisionsAvoided,
    p_decisions_made: payload.decisionsMade,
    p_document_format: payload.documentFormat,
    p_export_csv_audit_count: payload.exportCounts.csvAudit,
    p_export_docx_count: payload.exportCounts.docx,
    p_export_json_decisions_count: payload.exportCounts.jsonDecisions,
    p_ignore_count: payload.ignoreCount,
    p_keep_count: payload.keepCount,
    p_last_updated_at: payload.lastUpdatedAt,
    p_occurrence_count: payload.occurrenceCount,
    p_opaque_session_id: payload.opaqueSessionId,
    p_organization_id: payload.organizationId,
    p_page_count: payload.pageCount,
    p_redact_count: payload.redactCount,
    p_review_item_count: payload.reviewItemCount,
    p_started_at: payload.startedAt,
  });
  if (error) throw error;
}

export async function submitDocumentUsageMetricBestEffort(payload: DocumentUsageMetricPayload): Promise<void> {
  try {
    await submitDocumentUsageMetric(payload);
    clearPendingMetric(payload.opaqueSessionId);
  } catch (error) {
    queuePendingMetric(payload);
    console.warn("DocScrub usage metric submission failed; queued for retry.", error);
  }
}

export async function retryPendingDocumentUsageMetrics(): Promise<void> {
  const pending = readPendingMetrics();
  for (const payload of pending) {
    await submitDocumentUsageMetricBestEffort(payload);
  }
}

function readPendingMetrics(): DocumentUsageMetricPayload[] {
  try {
    const raw = window.localStorage.getItem(PENDING_METRICS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isDocumentUsageMetricPayload) : [];
  } catch {
    return [];
  }
}

function queuePendingMetric(payload: DocumentUsageMetricPayload): void {
  try {
    const next = [
      ...readPendingMetrics().filter((item) => item.opaqueSessionId !== payload.opaqueSessionId),
      payload,
    ].slice(-25);
    window.localStorage.setItem(PENDING_METRICS_KEY, JSON.stringify(next));
  } catch {
    /* best-effort diagnostics only */
  }
}

function clearPendingMetric(opaqueSessionId: string): void {
  try {
    const next = readPendingMetrics().filter((item) => item.opaqueSessionId !== opaqueSessionId);
    window.localStorage.setItem(PENDING_METRICS_KEY, JSON.stringify(next));
  } catch {
    /* best-effort diagnostics only */
  }
}

function isDocumentUsageMetricPayload(value: unknown): value is DocumentUsageMetricPayload {
  return Boolean(
    value &&
      typeof value === "object" &&
      typeof (value as DocumentUsageMetricPayload).opaqueSessionId === "string" &&
      typeof (value as DocumentUsageMetricPayload).startedAt === "string"
  );
}
