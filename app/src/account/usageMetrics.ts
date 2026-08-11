/**
 * usageMetrics.ts -- best-effort, privacy-preserving usage telemetry
 * helpers. The review workflow must never depend on these calls succeeding;
 * callers intentionally fire-and-forget them.
 */

import type { WorkspaceState } from "../workspace/Workspace.js";

export type UsageExportType = "docx" | "csv_audit" | "json_decisions";

export interface UsageExportCounts {
  csvAudit: number;
  docx: number;
  jsonDecisions: number;
}

export interface DocumentUsagePayload {
  appVersion: string;
  documentLoaded: boolean;
  exportCounts: UsageExportCounts;
  fileName: string | null;
  itemCount: number;
  opaqueSessionId: string;
  organizationId: string | null;
  reviewedCount: number;
  stage: string | null;
}

const PENDING_USAGE_KEY = "docscrub.pendingUsageMetrics";

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function opaqueUsageSessionId(documentId: string): string {
  return `local-${fnv1a(documentId)}`;
}

export function deriveDocumentUsagePayload(
  state: WorkspaceState,
  inputs: { appVersion: string; exportCounts: UsageExportCounts; opaqueSessionId: string; organizationId: string | null }
): DocumentUsagePayload | null {
  if (!state.documentLoaded) return null;
  const statuses = state.stageStatuses ?? [];
  const reviewedCount = statuses.reduce((sum, status) => sum + Math.max(0, status.itemCount - status.unresolvedCount), 0);
  const itemCount = statuses.reduce((sum, status) => sum + status.itemCount, 0);
  return {
    appVersion: inputs.appVersion,
    documentLoaded: true,
    exportCounts: inputs.exportCounts,
    fileName: state.fileName ?? null,
    itemCount,
    opaqueSessionId: inputs.opaqueSessionId,
    organizationId: inputs.organizationId,
    reviewedCount,
    stage: state.focus?.target.stage ?? null,
  };
}

function readPending(): DocumentUsagePayload[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(PENDING_USAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((item): item is DocumentUsagePayload => Boolean(item && typeof item === "object")) : [];
  } catch {
    return [];
  }
}

function writePending(payloads: readonly DocumentUsagePayload[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(PENDING_USAGE_KEY, JSON.stringify(payloads.slice(-20)));
  } catch {
    /* usage metrics are best-effort only */
  }
}

export async function submitDocumentUsageMetricBestEffort(payload: DocumentUsagePayload): Promise<void> {
  // No remote endpoint is configured in this browser-local build. Queue the
  // latest snapshot locally so adding an endpoint later does not require
  // changing app.ts's fire-and-forget contract.
  writePending([...readPending(), payload]);
}

export async function retryPendingDocumentUsageMetrics(): Promise<void> {
  // Keeping this as a real async function preserves the retry hook's shape
  // without introducing network behavior into the local-only app.
  return Promise.resolve();
}
