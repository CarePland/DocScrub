-- DocScrub privacy-safe usage metrics and internal Admin foundation.
-- Cloud boundary: this migration stores only numeric aggregates, timestamps,
-- status values, opaque session IDs, app version, organization links, and
-- non-sensitive document format labels. Do not add source documents,
-- filenames, file paths, extracted document text, detected entities,
-- replacement values, snippets, or per-item decision content here.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'document_usage_completion_status') then
    create type public.document_usage_completion_status as enum ('started', 'incomplete', 'completed', 'abandoned');
  end if;
end $$;

alter table public.profiles
  add column if not exists is_internal_admin boolean not null default false;

create table if not exists public.document_usage_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  opaque_session_id uuid not null,
  document_format text not null default 'docx',
  page_count integer,
  occurrence_count integer not null default 0,
  review_item_count integer not null default 0,
  decisions_made integer not null default 0,
  decisions_avoided integer not null default 0,
  keep_count integer not null default 0,
  change_count integer not null default 0,
  redact_count integer not null default 0,
  ignore_count integer not null default 0,
  export_docx_count integer not null default 0,
  export_csv_audit_count integer not null default 0,
  export_json_decisions_count integer not null default 0,
  export_count integer generated always as (
    export_docx_count + export_csv_audit_count + export_json_decisions_count
  ) stored,
  started_at timestamptz not null,
  completed_at timestamptz,
  last_updated_at timestamptz not null default now(),
  completion_status public.document_usage_completion_status not null default 'started',
  app_version text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, opaque_session_id),
  constraint document_usage_metrics_format_safe check (document_format in ('docx', 'pdf', 'txt', 'unknown')),
  constraint document_usage_metrics_page_count_nonnegative check (page_count is null or page_count >= 0),
  constraint document_usage_metrics_counts_nonnegative check (
    occurrence_count >= 0
    and review_item_count >= 0
    and decisions_made >= 0
    and decisions_avoided >= 0
    and keep_count >= 0
    and change_count >= 0
    and redact_count >= 0
    and ignore_count >= 0
    and export_docx_count >= 0
    and export_csv_audit_count >= 0
    and export_json_decisions_count >= 0
  ),
  constraint document_usage_metrics_decisions_plausible check (
    decisions_made + decisions_avoided <= occurrence_count
    and keep_count <= review_item_count
    and change_count <= review_item_count
    and redact_count <= review_item_count
    and ignore_count <= review_item_count
  ),
  constraint document_usage_metrics_completion_dates_plausible check (
    completed_at is null or completed_at >= started_at
  )
);

create index if not exists document_usage_metrics_user_started_idx
  on public.document_usage_metrics (user_id, started_at desc);

create index if not exists document_usage_metrics_org_started_idx
  on public.document_usage_metrics (organization_id, started_at desc);

create index if not exists document_usage_metrics_status_started_idx
  on public.document_usage_metrics (completion_status, started_at desc);

drop trigger if exists document_usage_metrics_set_updated_at on public.document_usage_metrics;
create trigger document_usage_metrics_set_updated_at
before update on public.document_usage_metrics
for each row execute function public.set_updated_at();

create or replace function public.is_internal_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_internal_admin = true
  )
$$;

create or replace function public.require_internal_admin()
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if public.is_internal_admin() then
    return true;
  end if;

  raise exception 'Internal Admin access is required';
end;
$$;

create or replace function public.upsert_document_usage_metric(
  p_opaque_session_id uuid,
  p_document_format text default 'docx',
  p_organization_id uuid default null,
  p_page_count integer default null,
  p_occurrence_count integer default 0,
  p_review_item_count integer default 0,
  p_decisions_made integer default 0,
  p_decisions_avoided integer default 0,
  p_keep_count integer default 0,
  p_change_count integer default 0,
  p_redact_count integer default 0,
  p_ignore_count integer default 0,
  p_export_docx_count integer default 0,
  p_export_csv_audit_count integer default 0,
  p_export_json_decisions_count integer default 0,
  p_started_at timestamptz default now(),
  p_completed_at timestamptz default null,
  p_last_updated_at timestamptz default now(),
  p_completion_status public.document_usage_completion_status default 'incomplete',
  p_app_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  metric_id uuid;
  resolved_organization_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in before submitting usage metrics';
  end if;

  if p_opaque_session_id is null then
    raise exception 'Usage session id is required';
  end if;

  select coalesce(p_organization_id, p.default_organization_id)
    into resolved_organization_id
  from public.profiles p
  where p.id = auth.uid();

  if resolved_organization_id is not null
    and not public.is_organization_member(resolved_organization_id) then
    raise exception 'Usage metrics organization is not available to this user';
  end if;

  if p_document_format not in ('docx', 'pdf', 'txt', 'unknown') then
    raise exception 'Unsupported document format for usage metrics';
  end if;

  if coalesce(p_page_count, 0) < 0
    or p_occurrence_count < 0
    or p_review_item_count < 0
    or p_decisions_made < 0
    or p_decisions_avoided < 0
    or p_keep_count < 0
    or p_change_count < 0
    or p_redact_count < 0
    or p_ignore_count < 0
    or p_export_docx_count < 0
    or p_export_csv_audit_count < 0
    or p_export_json_decisions_count < 0 then
    raise exception 'Usage metric counts must be non-negative';
  end if;

  if p_decisions_made + p_decisions_avoided > p_occurrence_count then
    raise exception 'Usage metric decision totals are not plausible';
  end if;

  insert into public.document_usage_metrics (
    user_id,
    organization_id,
    opaque_session_id,
    document_format,
    page_count,
    occurrence_count,
    review_item_count,
    decisions_made,
    decisions_avoided,
    keep_count,
    change_count,
    redact_count,
    ignore_count,
    export_docx_count,
    export_csv_audit_count,
    export_json_decisions_count,
    started_at,
    completed_at,
    last_updated_at,
    completion_status,
    app_version
  )
  values (
    auth.uid(),
    resolved_organization_id,
    p_opaque_session_id,
    p_document_format,
    p_page_count,
    p_occurrence_count,
    p_review_item_count,
    p_decisions_made,
    p_decisions_avoided,
    p_keep_count,
    p_change_count,
    p_redact_count,
    p_ignore_count,
    p_export_docx_count,
    p_export_csv_audit_count,
    p_export_json_decisions_count,
    p_started_at,
    p_completed_at,
    coalesce(p_last_updated_at, now()),
    p_completion_status,
    nullif(btrim(coalesce(p_app_version, '')), '')
  )
  on conflict (user_id, opaque_session_id) do update
    set organization_id = coalesce(excluded.organization_id, public.document_usage_metrics.organization_id),
        document_format = excluded.document_format,
        page_count = excluded.page_count,
        occurrence_count = excluded.occurrence_count,
        review_item_count = excluded.review_item_count,
        decisions_made = excluded.decisions_made,
        decisions_avoided = excluded.decisions_avoided,
        keep_count = excluded.keep_count,
        change_count = excluded.change_count,
        redact_count = excluded.redact_count,
        ignore_count = excluded.ignore_count,
        export_docx_count = excluded.export_docx_count,
        export_csv_audit_count = excluded.export_csv_audit_count,
        export_json_decisions_count = excluded.export_json_decisions_count,
        started_at = least(public.document_usage_metrics.started_at, excluded.started_at),
        completed_at = case
          when excluded.completion_status = 'completed' then coalesce(excluded.completed_at, excluded.last_updated_at)
          else public.document_usage_metrics.completed_at
        end,
        last_updated_at = greatest(public.document_usage_metrics.last_updated_at, excluded.last_updated_at),
        completion_status = case
          when public.document_usage_metrics.completion_status = 'completed' then 'completed'::public.document_usage_completion_status
          else excluded.completion_status
        end,
        app_version = coalesce(excluded.app_version, public.document_usage_metrics.app_version)
  returning id into metric_id;

  return jsonb_build_object('id', metric_id, 'status', 'ok');
end;
$$;

create or replace function public.admin_usage_metrics(
  p_range_start timestamptz default null,
  p_range_end timestamptz default null,
  p_scope text default 'system',
  p_organization_id uuid default null,
  p_user_id uuid default null
)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with guard as (
    select public.require_internal_admin() as allowed
  ),
  filtered as (
    select m.*
    from public.document_usage_metrics m, guard
    where guard.allowed
      and (p_range_start is null or m.started_at >= p_range_start)
      and (p_range_end is null or m.started_at < p_range_end)
      and (p_scope <> 'organization' or p_organization_id is null or m.organization_id = p_organization_id)
      and (p_scope <> 'user' or p_user_id is null or m.user_id = p_user_id)
  ),
  summary as (
    select
      count(*)::integer as documents_started,
      count(*) filter (where completion_status = 'completed')::integer as documents_completed,
      coalesce(sum(page_count), 0)::integer as total_pages_processed,
      coalesce(sum(decisions_made), 0)::integer as total_decisions_made,
      coalesce(sum(decisions_avoided), 0)::integer as total_decisions_avoided,
      coalesce(sum(export_count), 0)::integer as export_count,
      count(*) filter (where started_at >= date_trunc('day', now()))::integer as documents_today,
      count(*) filter (where started_at >= date_trunc('week', now()))::integer as documents_this_week,
      count(*) filter (where started_at >= date_trunc('month', now()))::integer as documents_this_month,
      count(distinct user_id) filter (where started_at >= date_trunc('day', now()))::integer as active_users_today,
      count(distinct user_id) filter (where started_at >= date_trunc('week', now()))::integer as active_users_this_week,
      count(distinct user_id) filter (where started_at >= date_trunc('month', now()))::integer as active_users_this_month,
      count(distinct user_id)::integer as active_users,
      round(avg(extract(epoch from completed_at - started_at)) filter (where completion_status = 'completed' and completed_at is not null))::integer as average_completion_seconds,
      max(last_updated_at) as most_recent_activity
    from filtered
  ),
  user_rows as (
    select
      p.id as user_id,
      coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), p.display_name, 'User') as display_name,
      p.email,
      p.is_internal_admin,
      p.onboarding_completed_at,
      count(f.id)::integer as documents_started,
      count(f.id) filter (where f.completion_status = 'completed')::integer as documents_completed,
      count(f.id) filter (where f.completion_status in ('started', 'incomplete'))::integer as documents_incomplete,
      coalesce(sum(f.page_count), 0)::integer as total_pages,
      coalesce(sum(f.occurrence_count), 0)::integer as total_occurrences,
      coalesce(sum(f.review_item_count), 0)::integer as total_review_items,
      coalesce(sum(f.decisions_made), 0)::integer as total_decisions_made,
      coalesce(sum(f.decisions_avoided), 0)::integer as total_decisions_avoided,
      coalesce(sum(f.keep_count), 0)::integer as keep_decisions,
      coalesce(sum(f.change_count), 0)::integer as change_decisions,
      coalesce(sum(f.redact_count), 0)::integer as redact_decisions,
      coalesce(sum(f.ignore_count), 0)::integer as ignore_decisions,
      coalesce(sum(f.export_count), 0)::integer as export_count,
      round(avg(extract(epoch from f.completed_at - f.started_at)) filter (where f.completion_status = 'completed' and f.completed_at is not null))::integer as average_completion_seconds,
      min(f.started_at) as first_document_at,
      max(f.last_updated_at) as most_recent_document_at,
      count(distinct date_trunc('day', f.started_at))::integer as active_days
    from public.profiles p
    left join filtered f on f.user_id = p.id
    where p_scope <> 'organization'
      or p_organization_id is null
      or exists (
        select 1 from public.organization_members om
        where om.user_id = p.id and om.organization_id = p_organization_id
      )
    group by p.id, p.display_name, p.email, p.first_name, p.last_name, p.is_internal_admin, p.onboarding_completed_at, p.created_at
    order by max(f.last_updated_at) desc nulls last, p.created_at desc
    limit 100
  ),
  organization_rows as (
    select
      o.id as organization_id,
      o.name,
      count(distinct om.user_id)::integer as active_member_count,
      count(distinct f.user_id)::integer as active_users,
      count(f.id)::integer as documents_started,
      count(f.id) filter (where f.completion_status = 'completed')::integer as documents_completed,
      coalesce(sum(f.page_count), 0)::integer as total_pages_processed,
      coalesce(sum(f.decisions_made), 0)::integer as total_decisions_made,
      coalesce(sum(f.decisions_avoided), 0)::integer as total_decisions_avoided,
      coalesce(sum(f.export_count), 0)::integer as export_count,
      round(avg(extract(epoch from f.completed_at - f.started_at)) filter (where f.completion_status = 'completed' and f.completed_at is not null))::integer as average_completion_seconds,
      max(f.last_updated_at) as most_recent_activity
    from public.organizations o
    left join public.organization_members om on om.organization_id = o.id
    left join filtered f on f.organization_id = o.id
    where p_scope <> 'user'
      and (p_organization_id is null or o.id = p_organization_id)
    group by o.id, o.name, o.created_at
    order by max(f.last_updated_at) desc nulls last, o.created_at desc
    limit 100
  )
  select jsonb_build_object(
    'summary', jsonb_build_object(
      'totalRegisteredUsers', (select count(*) from public.profiles),
      'usersWhoProcessedDocument', (select count(distinct user_id) from public.document_usage_metrics),
      'totalOrganizations', (select count(*) from public.organizations),
      'documentsStarted', summary.documents_started,
      'documentsCompleted', summary.documents_completed,
      'totalPagesProcessed', summary.total_pages_processed,
      'totalDecisionsMade', summary.total_decisions_made,
      'totalDecisionsAvoided', summary.total_decisions_avoided,
      'overallDecisionsAvoidedPercentage', case
        when summary.total_decisions_made + summary.total_decisions_avoided = 0 then null
        else round((summary.total_decisions_avoided::numeric / (summary.total_decisions_made + summary.total_decisions_avoided)) * 100, 1)
      end,
      'documentsToday', summary.documents_today,
      'documentsThisWeek', summary.documents_this_week,
      'documentsThisMonth', summary.documents_this_month,
      'activeUsersToday', summary.active_users_today,
      'activeUsersThisWeek', summary.active_users_this_week,
      'activeUsersThisMonth', summary.active_users_this_month,
      'completionRate', case
        when summary.documents_started = 0 then null
        else round((summary.documents_completed::numeric / summary.documents_started) * 100, 1)
      end,
      'averageDocumentsPerActiveUser', case
        when summary.active_users = 0 then null
        else round(summary.documents_started::numeric / summary.active_users, 1)
      end,
      'averageDecisionsPerCompletedDocument', case
        when summary.documents_completed = 0 then null
        else round(summary.total_decisions_made::numeric / summary.documents_completed, 1)
      end,
      'averageCompletionSeconds', summary.average_completion_seconds,
      'exportCount', summary.export_count,
      'mostRecentActivity', summary.most_recent_activity
    ),
    'users', coalesce((select jsonb_agg(to_jsonb(user_rows)) from user_rows), '[]'::jsonb),
    'organizations', coalesce((select jsonb_agg(to_jsonb(organization_rows)) from organization_rows), '[]'::jsonb)
  )
  from summary;
$$;

alter table public.document_usage_metrics enable row level security;

drop policy if exists "usage metrics visible to owning user" on public.document_usage_metrics;
create policy "usage metrics visible to owning user"
  on public.document_usage_metrics
  for select
  to authenticated
  using (user_id = auth.uid());

grant select on public.document_usage_metrics to authenticated;
grant execute on function public.is_internal_admin() to authenticated;
grant execute on function public.require_internal_admin() to authenticated;
grant execute on function public.upsert_document_usage_metric(
  uuid, text, uuid, integer, integer, integer, integer, integer, integer,
  integer, integer, integer, integer, integer, integer, timestamptz,
  timestamptz, timestamptz, public.document_usage_completion_status, text
) to authenticated;
grant execute on function public.admin_usage_metrics(timestamptz, timestamptz, text, uuid, uuid) to authenticated;
