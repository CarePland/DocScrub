-- DocScrub account/auth foundation.
-- Cloud boundary: these tables store account metadata, organization
-- membership, invitation state, and future entitlement-ready fields only.
-- Do not add source documents, extracted document text, detected entities,
-- replacements, review decisions, generated documents, or audit contents
-- without a new privacy/design review.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'organization_role') then
    create type public.organization_role as enum ('owner', 'admin', 'member');
  end if;

  if not exists (select 1 from pg_type where typname = 'organization_type') then
    create type public.organization_type as enum ('personal', 'team');
  end if;

  if not exists (select 1 from pg_type where typname = 'organization_invitation_status') then
    create type public.organization_invitation_status as enum ('pending', 'accepted', 'revoked', 'expired');
  end if;
end $$;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  normalized_name text not null unique,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint companies_name_not_blank check (length(btrim(name)) > 0),
  constraint companies_normalized_name_not_blank check (length(btrim(normalized_name)) > 0)
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  first_name text,
  last_name text,
  organization_name text,
  company_id uuid references public.companies(id) on delete set null,
  company text,
  job_title text,
  phone text,
  address text,
  city text,
  state_province text,
  postal_code text,
  country text,
  avatar_url text,
  default_organization_id uuid,
  onboarding_completed_at timestamptz,
  individual_pricing_tier_id text,
  individual_subscription_status text,
  individual_entitlements jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_email_lowercase check (email is null or email = lower(email)),
  constraint profiles_individual_entitlements_object check (jsonb_typeof(individual_entitlements) = 'object')
);

-- Existing Supabase projects may already have an earlier/partial `profiles`
-- table. `create table if not exists` will not backfill columns, so make the
-- foundation migration resumable before later constraints/functions refer to
-- these fields.
alter table public.profiles
  add column if not exists email text,
  add column if not exists display_name text,
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists organization_name text,
  add column if not exists company_id uuid references public.companies(id) on delete set null,
  add column if not exists company text,
  add column if not exists job_title text,
  add column if not exists phone text,
  add column if not exists address text,
  add column if not exists city text,
  add column if not exists state_province text,
  add column if not exists postal_code text,
  add column if not exists country text,
  add column if not exists avatar_url text,
  add column if not exists default_organization_id uuid,
  add column if not exists onboarding_completed_at timestamptz,
  add column if not exists individual_pricing_tier_id text,
  add column if not exists individual_subscription_status text,
  add column if not exists individual_entitlements jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  organization_type public.organization_type not null default 'team',
  created_by_user_id uuid references auth.users(id) on delete set null,
  pricing_tier_id text,
  subscription_status text,
  pooled_credit_balance integer not null default 0,
  entitlements jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_name_not_blank check (length(btrim(name)) > 0),
  constraint organizations_pooled_credit_balance_nonnegative check (pooled_credit_balance >= 0),
  constraint organizations_entitlements_object check (jsonb_typeof(entitlements) = 'object'),
  constraint organizations_settings_object check (jsonb_typeof(settings) = 'object')
);

alter table public.organizations
  add column if not exists name text,
  add column if not exists organization_type public.organization_type not null default 'team',
  add column if not exists created_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists pricing_tier_id text,
  add column if not exists subscription_status text,
  add column if not exists pooled_credit_balance integer not null default 0,
  add column if not exists entitlements jsonb not null default '{}'::jsonb,
  add column if not exists settings jsonb not null default '{}'::jsonb,
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists updated_at timestamptz not null default now();

alter table public.profiles
  drop constraint if exists profiles_default_organization_fk,
  add constraint profiles_default_organization_fk
  foreign key (default_organization_id)
  references public.organizations(id)
  on delete set null;

create table if not exists public.organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.organization_role not null default 'member',
  invited_by_user_id uuid references auth.users(id) on delete set null,
  joined_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table if not exists public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role public.organization_role not null default 'member',
  token_hash text not null unique,
  status public.organization_invitation_status not null default 'pending',
  invited_by_user_id uuid not null references auth.users(id) on delete cascade,
  accepted_by_user_id uuid references auth.users(id) on delete set null,
  accepted_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_invitations_email_lowercase check (email = lower(email)),
  constraint organization_invitations_email_not_blank check (length(btrim(email)) > 0),
  constraint organization_invitations_expiry_future check (expires_at > created_at)
);

create unique index if not exists organization_invitations_one_pending_email
  on public.organization_invitations (organization_id, email)
  where status = 'pending';

create index if not exists organization_members_user_id_idx
  on public.organization_members (user_id);

create index if not exists organization_invitations_org_status_idx
  on public.organization_invitations (organization_id, status, expires_at);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists companies_set_updated_at on public.companies;
create trigger companies_set_updated_at
before update on public.companies
for each row execute function public.set_updated_at();

drop trigger if exists organizations_set_updated_at on public.organizations;
create trigger organizations_set_updated_at
before update on public.organizations
for each row execute function public.set_updated_at();

drop trigger if exists organization_members_set_updated_at on public.organization_members;
create trigger organization_members_set_updated_at
before update on public.organization_members
for each row execute function public.set_updated_at();

drop trigger if exists organization_invitations_set_updated_at on public.organization_invitations;
create trigger organization_invitations_set_updated_at
before update on public.organization_invitations
for each row execute function public.set_updated_at();

create or replace function public.current_user_organization_role(p_organization_id uuid)
returns public.organization_role
language sql
security definer
set search_path = public
stable
as $$
  select om.role
  from public.organization_members om
  where om.organization_id = p_organization_id
    and om.user_id = auth.uid()
  limit 1
$$;

create or replace function public.is_organization_member(p_organization_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.current_user_organization_role(p_organization_id) is not null
$$;

create or replace function public.can_manage_organization_members(p_organization_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.current_user_organization_role(p_organization_id) in ('owner', 'admin')
$$;

create or replace function public.shares_organization_with_current_user(p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select p_user_id = auth.uid()
    or exists (
      select 1
      from public.organization_members mine
      join public.organization_members theirs
        on theirs.organization_id = mine.organization_id
      where mine.user_id = auth.uid()
        and theirs.user_id = p_user_id
    )
$$;

create or replace function public.prevent_orphaned_organization_owner()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  owner_count integer;
  target_organization_id uuid;
begin
  target_organization_id := coalesce(old.organization_id, new.organization_id);

  if tg_op = 'DELETE' and old.role <> 'owner' then
    return old;
  end if;

  if tg_op = 'UPDATE' and old.role = new.role then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.role <> 'owner' then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.role = 'owner' then
    return new;
  end if;

  select count(*)
    into owner_count
  from public.organization_members
  where organization_id = target_organization_id
    and role = 'owner'
    and id <> old.id;

  if owner_count = 0 then
    raise exception 'Organization must keep at least one owner';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$$;

drop trigger if exists organization_members_prevent_orphaned_owner
  on public.organization_members;
create trigger organization_members_prevent_orphaned_owner
before update or delete on public.organization_members
for each row execute function public.prevent_orphaned_organization_owner();

create or replace function public.create_profile_and_personal_organization()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_email text;
  profile_name text;
  profile_first_name text;
  profile_last_name text;
  organization_id uuid;
begin
  profile_email := lower(nullif(new.email, ''));
  profile_name := nullif(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'), '');
  profile_first_name := nullif(new.raw_user_meta_data->>'given_name', '');
  profile_last_name := nullif(new.raw_user_meta_data->>'family_name', '');

  insert into public.profiles (id, email, display_name, first_name, last_name, avatar_url)
  values (
    new.id,
    profile_email,
    profile_name,
    profile_first_name,
    profile_last_name,
    nullif(new.raw_user_meta_data->>'avatar_url', '')
  )
  on conflict (id) do update
    set email = excluded.email,
        display_name = coalesce(public.profiles.display_name, excluded.display_name),
        first_name = coalesce(public.profiles.first_name, excluded.first_name),
        last_name = coalesce(public.profiles.last_name, excluded.last_name),
        avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url);

  insert into public.organizations (name, organization_type, created_by_user_id)
  values (
    coalesce(profile_name, split_part(coalesce(profile_email, 'Personal'), '@', 1), 'Personal') || '''s DocScrub',
    'personal',
    new.id
  )
  returning id into organization_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (organization_id, new.id, 'owner')
  on conflict (organization_id, user_id) do nothing;

  update public.profiles
  set default_organization_id = organization_id
  where id = new.id
    and default_organization_id is null;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created_create_docscrub_account
  on auth.users;
create trigger on_auth_user_created_create_docscrub_account
after insert on auth.users
for each row execute function public.create_profile_and_personal_organization();

create or replace function public.update_own_profile(
  p_email text,
  p_first_name text,
  p_last_name text,
  p_organization_name text,
  p_company text,
  p_job_title text,
  p_phone text,
  p_address text,
  p_city text,
  p_state_province text,
  p_postal_code text,
  p_country text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_email text;
  normalized_company text;
  linked_company_id uuid;
  clean_first_name text;
  clean_last_name text;
  clean_company text;
  clean_display_name text;
begin
  if auth.uid() is null then
    raise exception 'Sign in is required';
  end if;

  normalized_email := lower(nullif(btrim(coalesce(p_email, '')), ''));
  clean_first_name := nullif(btrim(coalesce(p_first_name, '')), '');
  clean_last_name := nullif(btrim(coalesce(p_last_name, '')), '');
  clean_company := nullif(btrim(coalesce(p_company, '')), '');
  normalized_company := lower(clean_company);
  clean_display_name := nullif(btrim(concat_ws(' ', clean_first_name, clean_last_name)), '');

  if clean_company is not null then
    insert into public.companies (name, normalized_name, created_by_user_id)
    values (clean_company, normalized_company, auth.uid())
    on conflict (normalized_name) do update
      set name = excluded.name
    returning id into linked_company_id;
  end if;

  update public.profiles
  set email = coalesce(normalized_email, email),
      first_name = clean_first_name,
      last_name = clean_last_name,
      display_name = clean_display_name,
      organization_name = nullif(btrim(coalesce(p_organization_name, '')), ''),
      company_id = linked_company_id,
      company = clean_company,
      job_title = nullif(btrim(coalesce(p_job_title, '')), ''),
      phone = nullif(btrim(coalesce(p_phone, '')), ''),
      address = nullif(btrim(coalesce(p_address, '')), ''),
      city = nullif(btrim(coalesce(p_city, '')), ''),
      state_province = nullif(btrim(coalesce(p_state_province, '')), ''),
      postal_code = nullif(btrim(coalesce(p_postal_code, '')), ''),
      country = nullif(btrim(coalesce(p_country, '')), '')
  where id = auth.uid();

  return jsonb_build_object('company_id', linked_company_id);
end;
$$;

create or replace function public.invite_organization_member(
  p_organization_id uuid,
  p_email text,
  p_role public.organization_role default 'member',
  p_redirect_origin text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_email text;
  raw_token text;
  invitation_id uuid;
  invite_url text;
begin
  if auth.uid() is null then
    raise exception 'Sign in before inviting members';
  end if;

  if not public.can_manage_organization_members(p_organization_id) then
    raise exception 'Only organization owners and admins can invite members';
  end if;

  normalized_email := lower(btrim(p_email));
  if normalized_email = '' or normalized_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Enter a valid invitation email';
  end if;

  if exists (
    select 1
    from public.organization_members om
    join public.profiles p on p.id = om.user_id
    where om.organization_id = p_organization_id
      and p.email = normalized_email
  ) then
    raise exception 'That email is already a member of this organization';
  end if;

  raw_token := encode(gen_random_bytes(32), 'hex');

  insert into public.organization_invitations (
    organization_id,
    email,
    role,
    token_hash,
    invited_by_user_id,
    expires_at
  )
  values (
    p_organization_id,
    normalized_email,
    coalesce(p_role, 'member'),
    encode(digest(raw_token, 'sha256'), 'hex'),
    auth.uid(),
    now() + interval '7 days'
  )
  returning id into invitation_id;

  invite_url := coalesce(nullif(p_redirect_origin, ''), '') ||
    case when coalesce(nullif(p_redirect_origin, ''), '') like '%?%' then '&' else '?' end ||
    'invite_token=' || raw_token;

  return jsonb_build_object(
    'invitation_id', invitation_id,
    'invitation_url', invite_url,
    'expires_at', (now() + interval '7 days')
  );
end;
$$;

create or replace function public.accept_organization_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  invitation public.organization_invitations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in before accepting an invitation';
  end if;

  select *
    into invitation
  from public.organization_invitations
  where token_hash = encode(digest(p_token, 'sha256'), 'hex')
    and status = 'pending'
  for update;

  if not found then
    raise exception 'Invitation is invalid or no longer pending';
  end if;

  if invitation.expires_at <= now() then
    update public.organization_invitations
    set status = 'expired'
    where id = invitation.id;
    raise exception 'Invitation has expired';
  end if;

  if exists (
    select 1
    from public.organization_members
    where organization_id = invitation.organization_id
      and user_id = auth.uid()
  ) then
    update public.organization_invitations
    set status = 'accepted',
        accepted_by_user_id = auth.uid(),
        accepted_at = now()
    where id = invitation.id;

    return jsonb_build_object('status', 'already_member', 'organization_id', invitation.organization_id);
  end if;

  insert into public.organization_members (
    organization_id,
    user_id,
    role,
    invited_by_user_id
  )
  values (
    invitation.organization_id,
    auth.uid(),
    invitation.role,
    invitation.invited_by_user_id
  );

  update public.organization_invitations
  set status = 'accepted',
      accepted_by_user_id = auth.uid(),
      accepted_at = now()
  where id = invitation.id;

  update public.profiles
  set default_organization_id = coalesce(default_organization_id, invitation.organization_id)
  where id = auth.uid();

  return jsonb_build_object('status', 'accepted', 'organization_id', invitation.organization_id);
end;
$$;

alter table public.profiles enable row level security;
alter table public.companies enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_invitations enable row level security;

drop policy if exists "profiles visible to self or shared organization" on public.profiles;
create policy "profiles visible to self or shared organization"
  on public.profiles
  for select
  to authenticated
  using (public.shares_organization_with_current_user(id));

drop policy if exists "profiles update own basic account" on public.profiles;
create policy "profiles update own basic account"
  on public.profiles
  for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists "companies visible to linked profiles" on public.companies;
create policy "companies visible to linked profiles"
  on public.companies
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.company_id = companies.id
        and public.shares_organization_with_current_user(p.id)
    )
  );

drop policy if exists "organizations visible to members" on public.organizations;
create policy "organizations visible to members"
  on public.organizations
  for select
  to authenticated
  using (public.is_organization_member(id));

drop policy if exists "members visible to organization members" on public.organization_members;
create policy "members visible to organization members"
  on public.organization_members
  for select
  to authenticated
  using (public.is_organization_member(organization_id));

drop policy if exists "members insert by organization managers" on public.organization_members;
create policy "members insert by organization managers"
  on public.organization_members
  for insert
  to authenticated
  with check (public.can_manage_organization_members(organization_id));

drop policy if exists "members update by organization managers" on public.organization_members;
create policy "members update by organization managers"
  on public.organization_members
  for update
  to authenticated
  using (public.can_manage_organization_members(organization_id))
  with check (public.can_manage_organization_members(organization_id));

drop policy if exists "members delete by organization managers" on public.organization_members;
create policy "members delete by organization managers"
  on public.organization_members
  for delete
  to authenticated
  using (public.can_manage_organization_members(organization_id));

drop policy if exists "invitations visible to organization managers" on public.organization_invitations;
create policy "invitations visible to organization managers"
  on public.organization_invitations
  for select
  to authenticated
  using (public.can_manage_organization_members(organization_id));

grant select, update on public.profiles to authenticated;
grant select on public.companies to authenticated;
grant select on public.organizations to authenticated;
grant select, insert, update, delete on public.organization_members to authenticated;
grant select on public.organization_invitations to authenticated;
grant execute on function public.invite_organization_member(uuid, text, public.organization_role, text) to authenticated;
grant execute on function public.accept_organization_invitation(text) to authenticated;
grant execute on function public.update_own_profile(text, text, text, text, text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.current_user_organization_role(uuid) to authenticated;
grant execute on function public.is_organization_member(uuid) to authenticated;
grant execute on function public.can_manage_organization_members(uuid) to authenticated;
