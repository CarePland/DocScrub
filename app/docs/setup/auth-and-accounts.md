# DocScrub Auth And Accounts Setup

Status: initial account foundation, 2026-08-06.

## Cloud-Stored Fields

This foundation stores only account and organization metadata:

- `profiles`: auth user id, email, display name, avatar URL, default organization, onboarding completion timestamp, future individual pricing/subscription/entitlement fields.
- `companies`: UUID-backed company records created from the optional Company field and linked from `profiles.company_id`.
- `organizations`: name, personal/team type, creator, future organization pricing/subscription/entitlement fields, pooled credit balance, settings.
- `organization_members`: organization id, user id, role, inviter, join timestamps.
- `organization_invitations`: organization id, invitee email, role, hashed invitation token, status, inviter, accepter, expiry timestamps.
- `organization_pending_members`: organization id, invitee email, optional display name, role, pending/fulfilled status, inviter, invite timestamp, and future fulfillment metadata. This is for onboarding team setup without sending invitation emails.
- `document_usage_metrics`: opaque usage session id, user/organization ids, document format label, numeric aggregate counts, export counts, completion status, timestamps, and app version.

Do not add source documents, document text, extracted text, detected entities, replacement values, snippets, filenames, local file paths, per-item decision content, generated documents, or audit contents to Supabase without a new privacy/product decision. DocScrub's reviewer workspace remains browser-local.

## Local Setup

1. Apply the ordered Supabase migrations in `supabase/migrations/`.
2. Copy `env-config.example.js` to `env-config.js`.
3. Fill `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` in `env-config.js`.
4. Keep `.env.example` as the template for server-only tooling. Never paste `SUPABASE_SERVICE_ROLE_KEY` into `env-config.js` or browser code.
5. Run `npm run build` and serve `index.html` over HTTP. Supabase redirects will not work from `file://`.

## Supabase Dashboard

1. Authentication -> Providers -> Google: enable Google and paste the Google OAuth client id/secret.
2. Authentication -> URL Configuration:
   - Site URL: local dev URL, for example `http://localhost:8000`.
   - Redirect URLs: add `http://localhost:8000/index.html`, the production app URL, and any preview URLs used for testing.
3. Authentication -> Email: enable magic links if email sign-in should be available.
4. SQL Editor: apply the ordered migrations above.
5. Table Editor or SQL Editor: confirm RLS is enabled for `profiles`, `organizations`, `organization_members`, `organization_invitations`, `organization_pending_members`, and `document_usage_metrics`.
6. Grant the first internal DocScrub Admin only after the user has signed in and their profile row exists:

   ```sql
   update public.profiles
   set is_internal_admin = true
   where email = 'admin@example.com';
   ```

   Internal Admin is separate from organization `owner`/`admin`; customer organization admins should not receive this flag automatically.

## Google Cloud Console

1. Create or select a Google Cloud project.
2. Configure OAuth consent for DocScrub.
3. Create an OAuth 2.0 Web application client.
4. Add Supabase's Google callback URL from the Supabase Google provider screen as an authorized redirect URI. For the current DocScrub Supabase project, Google is requesting:
   - `https://kvzaammtfumxrubvtdmc.supabase.co/auth/v1/callback`
5. Add local and production DocScrub origins as authorized JavaScript origins when Google asks for them.
6. Copy the client id and secret into Supabase's Google provider settings, not into DocScrub browser files.

## CarePland Reference Adaptation

Reused:

- Browser-safe Supabase client concept with persistent browser sessions.
- Explicit separation between publishable anon keys and server-only service role keys.
- OAuth redirect handling through `exchangeCodeForSession` plus hash token fallback.
- Server-side/database authorization posture instead of UI-only checks.
- Profile row linked to `auth.users`.

Changed:

- DocScrub is static native TypeScript, not Next.js, so the auth gate stays in the existing static loader seam instead of Next routes or middleware.
- CarePland's care-circle model informed the membership/RLS shape, but DocScrub uses neutral `organizations` and `organization_members` for future teams and subscriptions.
- Invitations store only a SHA-256 token hash and return the raw token once through the invite RPC.
- Onboarding team setup creates pending organization members without sending emails or requiring the invited person to already have an account.
- The internal Admin surface borrows CarePland's registered-shell idea and server-side authorization posture, but uses `profiles.is_internal_admin` instead of organization membership.
- Usage metrics reuse DocScrub's existing local decision-reduction calculations and submit only aggregate counts through an idempotent Supabase RPC.
- No document/session content tables were added; future recovery metadata must stay content-free unless explicitly reviewed.

## Unresolved Product Decisions

- Whether email magic-link sign-in remains enabled for production or Google-only is preferred.
- Invitation email delivery, reminder emails, and acceptance links are intentionally separate from onboarding's pending-member records.
- Before onboarding rollout, add a polished confirmation if the user tries to go Back from Invite Team after entering any contact details.
- After pending teammates are created, onboarding must not return to the earlier Ready page because the user completed the invite branch.
- Onboarding is shown after first successful Google auth or email-link signup until `profiles.onboarding_completed_at` is set.
- Member removal, role changes, and invitation revocation have database support foundations but no polished team administration UI.
- Exact pricing tier names, subscription states, entitlement keys, and pooled-credit semantics are placeholders for later product work.
- Future workspace-level permissions and document/session recovery need a separate content-boundary design before any schema stores recovery metadata.
- Usage metrics currently distinguish started/incomplete/completed sessions. “Abandoned” is modeled in the schema but should only be set after a deliberate aging/retention rule exists.
- Organization-owner reporting is intentionally not exposed yet; metrics reporting is internal Admin only.
