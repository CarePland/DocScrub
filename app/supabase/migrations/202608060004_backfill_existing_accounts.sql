-- BACKFILL: accounts that predate the account-auth foundation trigger.
--
-- THE BUG THIS FIXES (AG, 2026-08-06, live report: "every time I refresh I
-- get the wizard. still."):
--
-- 202608060001 created `on_auth_user_created_create_docscrub_account`, an
-- AFTER INSERT trigger on auth.users. Triggers do not fire retroactively, so
-- every account that already existed when that migration ran has NO row in
-- public.profiles, no personal organization, and no membership.
--
-- The client treats a missing profile as an in-memory default with
-- `onboarding_completed_at: null` (previewGate.ts's loadAccountState), so the
-- setup wizard shows. Completing it calls UPDATE ... WHERE id = <user>, which
-- matches ZERO rows -- and PostgREST returns success for a zero-row UPDATE, so
-- nothing errors and nothing persists. Refresh, wizard, forever.
--
-- Idempotent by construction: every statement is guarded on absence, so this
-- can be re-run safely and does nothing on a database whose accounts all
-- arrived through the trigger.
--
-- Deliberately mirrors create_profile_and_personal_organization()'s own logic
-- rather than inventing a second account shape -- a backfilled account must be
-- indistinguishable from a trigger-created one, or this migration just moves
-- the inconsistency somewhere harder to see. The one difference is that this
-- runs per existing user in a loop instead of per inserted row.

do $$
declare
  existing_user record;
  profile_email text;
  profile_name text;
  profile_first_name text;
  profile_last_name text;
  new_organization_id uuid;
begin
  for existing_user in
    select u.id, u.email, u.raw_user_meta_data
    from auth.users u
    where not exists (select 1 from public.profiles p where p.id = u.id)
       or not exists (select 1 from public.organization_members m where m.user_id = u.id)
  loop
    profile_email := lower(nullif(existing_user.email, ''));
    profile_name := nullif(
      coalesce(existing_user.raw_user_meta_data->>'full_name', existing_user.raw_user_meta_data->>'name'),
      ''
    );
    profile_first_name := nullif(existing_user.raw_user_meta_data->>'given_name', '');
    profile_last_name := nullif(existing_user.raw_user_meta_data->>'family_name', '');

    insert into public.profiles (id, email, display_name, first_name, last_name, avatar_url)
    values (
      existing_user.id,
      profile_email,
      profile_name,
      profile_first_name,
      profile_last_name,
      nullif(existing_user.raw_user_meta_data->>'avatar_url', '')
    )
    on conflict (id) do update
      set email = excluded.email,
          display_name = coalesce(public.profiles.display_name, excluded.display_name),
          first_name = coalesce(public.profiles.first_name, excluded.first_name),
          last_name = coalesce(public.profiles.last_name, excluded.last_name),
          avatar_url = coalesce(public.profiles.avatar_url, excluded.avatar_url);

    -- Only mint a personal organization for a user who has NO membership at
    -- all. A user who was invited into someone else's organization before this
    -- migration ran already has a home, and giving them a second, empty
    -- personal org would silently change which one `default_organization_id`
    -- resolves to on their next sign-in.
    if not exists (select 1 from public.organization_members m where m.user_id = existing_user.id) then
      insert into public.organizations (name, organization_type, created_by_user_id)
      values (
        coalesce(profile_name, split_part(coalesce(profile_email, 'Personal'), '@', 1), 'Personal') || '''s DocScrub',
        'personal',
        existing_user.id
      )
      returning id into new_organization_id;

      insert into public.organization_members (organization_id, user_id, role)
      values (new_organization_id, existing_user.id, 'owner')
      on conflict (organization_id, user_id) do nothing;
    end if;

    update public.profiles
    set default_organization_id = coalesce(
      new_organization_id,
      (select m.organization_id
         from public.organization_members m
        where m.user_id = existing_user.id
        order by m.created_at
        limit 1)
    )
    where id = existing_user.id
      and default_organization_id is null;

    new_organization_id := null;
  end loop;
end;
$$;
