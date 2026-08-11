import { readFileSync } from "node:fs";
import { resolve } from "node:path";

let failures = 0;

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    console.log(`PASS ${name}`);
    return;
  }
  failures += 1;
  console.error(`FAIL ${name}`, detail ?? "");
}

(globalThis as unknown as { window: unknown }).window = {
  __DOCSCRUB_ENV__: {
    SUPABASE_PUBLISHABLE_KEY: "anon-test-key",
    SUPABASE_URL: "https://example.supabase.co",
  },
  localStorage: {
    getItem: () => null,
    setItem: () => undefined,
  },
};

const { decisionsAvoidedPercentage, summarizeUsageMetrics } = await import("../src/account/usageMetrics.ts");

check("decisions-avoided percentage is based on avoided plus made", decisionsAvoidedPercentage(75, 25) === 75);
check("decisions-avoided percentage handles empty totals", decisionsAvoidedPercentage(0, 0) === 0);

const summary = summarizeUsageMetrics([
  {
    change_count: 2,
    completion_status: "completed",
    decisions_avoided: 90,
    decisions_made: 10,
    export_csv_audit_count: 1,
    export_docx_count: 1,
    export_json_decisions_count: 0,
    ignore_count: 1,
    keep_count: 5,
    page_count: 4,
    redact_count: 2,
    review_item_count: 10,
  },
  {
    change_count: 0,
    completion_status: "incomplete",
    decisions_avoided: 0,
    decisions_made: 0,
    export_csv_audit_count: 0,
    export_docx_count: 0,
    export_json_decisions_count: 1,
    ignore_count: 0,
    keep_count: 0,
    page_count: null,
    redact_count: 0,
    review_item_count: 4,
  },
]);

check("aggregate calculations count started documents", summary.documents === 2);
check("aggregate calculations separate completed sessions", summary.completedDocuments === 1);
check("aggregate calculations total export types", summary.exportCount === 3);
check("aggregate calculations preserve pages when available", summary.pages === 4);
check("aggregate calculations compute completion rate", summary.completionRate === 50);
check("aggregate calculations compute average decisions per document", summary.averageDecisionsPerDocument === 5);
check("aggregate calculations compute average reduction percentage", summary.averageReductionPercentage === 90);

const migration = readFileSync(
  resolve("supabase/migrations/202608060003_usage_metrics_admin.sql"),
  "utf8"
);
const migrationWithoutComments = migration
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

check("usage migration creates internal admin flag", /is_internal_admin boolean not null default false/i.test(migration));
check("usage migration creates document usage table", /create table if not exists public\.document_usage_metrics/i.test(migration));
check("usage migration uses opaque session UUID", /opaque_session_id uuid not null/i.test(migration));
check("usage migration prevents duplicate session totals", /unique \(user_id, opaque_session_id\)/i.test(migration));
check("usage migration validates non-negative counts", /document_usage_metrics_counts_nonnegative/i.test(migration));
check("usage migration validates plausible decision totals", /decisions_made \+ decisions_avoided <= occurrence_count/i.test(migration));
check("usage migration stores incomplete versus completed status", /document_usage_completion_status.*'started'.*'incomplete'.*'completed'.*'abandoned'/is.test(migration));
check("usage migration enables RLS on usage metrics", /alter table public\.document_usage_metrics enable row level security/i.test(migration));
check("usage migration limits ordinary metric visibility to owning user", /using \(user_id = auth\.uid\(\)\)/i.test(migration));
check("usage migration requires internal admin for aggregate access", /require_internal_admin\(\)/i.test(migration));
check("usage migration grants aggregate RPC, not table-wide mutation", /grant execute on function public\.admin_usage_metrics/i.test(migration) && !/grant\s+(insert|update|delete)[^;]+document_usage_metrics/i.test(migration));
check("usage migration supports idempotent metric upsert", /on conflict \(user_id, opaque_session_id\) do update/i.test(migration));
check("usage migration rejects unauthorized organization attribution", /not public\.is_organization_member\(resolved_organization_id\)/i.test(migration));
check("usage migration exposes system-wide metrics", /totalRegisteredUsers/i.test(migration) && /documentsThisMonth/i.test(migration));
check("usage migration exposes completed-session average time", /averageCompletionSeconds/i.test(migration) && /completed_at - started_at/i.test(migration));
check("usage migration exposes user metrics", /'users', coalesce/i.test(migration) && /documents_incomplete/i.test(migration));
check("usage migration exposes organization metrics", /'organizations', coalesce/i.test(migration) && /active_member_count/i.test(migration));
check(
  "usage migration does not store document content or filenames",
  !/source_document|document_text|extracted_text|detected_entities|replacement_text|snippet|filename|file_path|local_path|per_item/i.test(migrationWithoutComments)
);

const usageSource = readFileSync(resolve("src/account/usageMetrics.ts"), "utf8");
check("metrics submission is best-effort and queues failures", /submitDocumentUsageMetricBestEffort/i.test(usageSource) && /queuePendingMetric\(payload\)/i.test(usageSource));
check(
  "metrics payload never includes filename fields",
  !/\bfileName\b/.test(usageSource) && !/\bfilename\s*:|\bfile_path\s*:|\blocal_path\s*:/i.test(usageSource)
);

if (failures > 0) {
  throw new Error(`${failures} usage metrics check(s) failed`);
}
