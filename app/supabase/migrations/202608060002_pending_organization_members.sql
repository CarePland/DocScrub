-- Pending organization members seed future team membership without sending
-- email invitations and without requiring the invited person to have an
-- auth.users row yet. This stores account/team metadata only; no document
-- contents, extracted text, replacements, decisions, or audit contents.

do $$
begin
  if not exists (select 1 from pg_type where typname = 'organization_pending_member_status') then
    create type public.organization_pending_member_status as enum ('pending', 'fulfilled', 'revoked');
  end if;
end $$;

create table if not exists public.organization_pending_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  display_name text,
  role public.organization_role not null default 'member',
  status public.organization_pending_member_status not null default 'pending',
  invited_by_user_id uuid references auth.users(id) on delete set null,
  invited_at timestamptz not null default now(),
  fulfilled_by_user_id uuid references auth.users(id) on delete set null,
  fulfilled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_pending_members_email_lowercase check (email = lower(email)),
  constraint organization_pending_members_email_not_blank check (length(btrim(email)) > 0),
  constraint organization_pending_members_display_name_not_blank check (display_name is null or length(btrim(display_name)) > 0)
);

create unique index if not exists organization_pending_members_one_pending_email
  on public.organization_pending_members (organization_id, email)
  where status = 'pending';

create index if not exists organization_pending_members_email_status_idx
  on public.organization_pending_members (email, status);

drop trigger if exists organization_pending_members_set_updated_at
  on public.organization_pending_members;
create trigger organization_pending_members_set_updated_at
before update on public.organization_pending_members
for each row execute function public.set_updated_at();

create or replace function public.create_organization_pending_members(
  p_organization_id uuid,
  p_members jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  member jsonb;
  normalized_email text;
  normalized_name text;
  created_count integer := 0;
begin
  if not public.can_manage_organization_members(p_organization_id) then
    raise exception 'Only organization owners and admins can invite members';
  end if;

  if jsonb_typeof(p_members) <> 'array' then
    raise exception 'Members must be an array';
  end if;

  for member in select * from jsonb_array_elements(p_members)
  loop
    normalized_email := lower(btrim(coalesce(member->>'email', '')));
    normalized_name := nullif(btrim(coalesce(member->>'display_name', '')), '');

    if normalized_email = '' and normalized_name is null then
      continue;
    end if;

    if normalized_email = '' then
      raise exception 'Email is required for each teammate';
    end if;

    if normalized_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception 'Invalid teammate email address';
    end if;

    if exists (
      select 1
      from public.profiles p
      join public.organization_members om on om.user_id = p.id
      where om.organization_id = p_organization_id
        and p.email = normalized_email
    ) then
      raise exception 'That email is already a member of this organization';
    end if;

    if exists (
      select 1
      from public.organization_pending_members opm
      where opm.organization_id = p_organization_id
        and opm.email = normalized_email
        and opm.status = 'pending'
    ) then
      raise exception 'That email already has a pending organization membership';
    end if;

    insert into public.organization_pending_members (
      organization_id,
      email,
      display_name,
      role,
      status,
      invited_by_user_id,
      invited_at
    )
    values (
      p_organization_id,
      normalized_email,
      normalized_name,
      'member',
      'pending',
      auth.uid(),
      now()
    );

    created_count := created_count + 1;
  end loop;

  return jsonb_build_object('created_count', created_count);
end;
$$;

create or replace function public.fulfill_pending_organization_memberships(
  p_user_id uuid,
  p_email text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  pending_record public.organization_pending_members%rowtype;
  fulfilled_count integer := 0;
  normalized_email text;
begin
  normalized_email := lower(nullif(btrim(coalesce(p_email, '')), ''));

  if normalized_email is null then
    return 0;
  end if;

  for pending_record in
    select *
    from public.organization_pending_members
    where email = normalized_email
      and status = 'pending'
    order by invited_at asc
  loop
    insert into public.organization_members (
      organization_id,
      user_id,
      role,
      invited_by_user_id
    )
    values (
      pending_record.organization_id,
      p_user_id,
      pending_record.role,
      pending_record.invited_by_user_id
    )
    on conflict (organization_id, user_id) do nothing;

    update public.organization_pending_members
    set status = 'fulfilled',
        fulfilled_by_user_id = p_user_id,
        fulfilled_at = now()
    where id = pending_record.id
      and status = 'pending';

    update public.profiles
    set default_organization_id = coalesce(default_organization_id, pending_record.organization_id)
    where id = p_user_id;

    fulfilled_count := fulfilled_count + 1;
  end loop;

  return fulfilled_count;
end;
$$;

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

  perform public.fulfill_pending_organization_memberships(new.id, profile_email);

  return new;
end;
$$;

alter table public.organization_pending_members enable row level security;

drop policy if exists "pending members visible to organization managers"
  on public.organization_pending_members;
create policy "pending members visible to organization managers"
  on public.organization_pending_members
  for select
  to authenticated
  using (public.can_manage_organization_members(organization_id));

drop policy if exists "pending members update by organization managers"
  on public.organization_pending_members;
create policy "pending members update by organization managers"
  on public.organization_pending_members
  for update
  to authenticated
  using (public.can_manage_organization_members(organization_id))
  with check (public.can_manage_organization_members(organization_id));

grant select, update on public.organization_pending_members to authenticated;
grant execute on function public.create_organization_pending_members(uuid, jsonb) to authenticated;
