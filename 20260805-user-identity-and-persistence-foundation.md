# User Identity & Persistence Foundation — Architecture Proposal

Status: **working document — proposal, not a decision.** Nothing here is
built. Per `app/docs/README.md`'s document classes, this is a working
document and cannot be cited as canonical authority. The proposed ADRs in
Appendix A are drafts with numbers *reserved*, not accepted; they belong in
`app/docs/architecture/decisions/` only after the decisions are actually
made.

Date: 2026-08-05
Author: prepared for AG
Sources studied: `/Users/agoodloe/Projects/CarePland/carepland-main`
(Next.js 16 / React 19 / `@supabase/supabase-js` ^2.105.4) and this
repository at HEAD.

---

## 0. The one thing to read first

Two of this repository's accepted ADRs currently forbid part of what this
initiative asks for, and the conflict is load-bearing rather than
incidental.

ADR-003 says cloud services must not ordinarily receive "review decisions"
or "replacement values." ADR-018 classifies content-derived settings as
`content-derived-never-sync`. `domain/DecisionMemory.ts`'s own header goes
further and names this exact future request in advance:

> A "user memory profile" that crosses machines is therefore NOT a storage-key
> change alone — it is a policy decision about moving content-derived data
> off-device, and this comment exists so that question gets asked deliberately
> rather than discovered late.

The brief asks for cloud-persisted "reusable decision memory," "persistent
review sessions," and eventually "shared organizational memory." All three
are content-derived. That comment was written to force this conversation, so
this document holds it open rather than resolving it by omission — §5 lays
out three options and recommends one, and §8's implementation order is
deliberately arranged so that **the entire identity, workspace, entitlement
and licensing foundation can be built and shipped before that question has
to be answered.**

That is the central architectural claim of this proposal: identity and
ownership are separable from content sync, and building them in that order
costs nothing and buys the time to decide the hard part properly.

---

## 1. Phase 1 — Analysis of CarePland

### 1.1 The framing constraint

CarePland is a Next.js 16 App Router application: server components, 102 API
route handlers, server-side `service_role` Supabase clients, `process.env`,
and `node:crypto`. DocScrub-Web is a framework-free TypeScript SPA compiled
by `tsc` to `dist/` and served statically, with `typescript` as its only
devDependency and no runtime dependencies at all.

This single difference decides most of the reuse question:

- Anything importing `next/server`, `process.env`, or `node:crypto` **cannot
  be reused as code**, whatever its merit.
- Anything that is dependency-free TypeScript **can be reused nearly
  verbatim**.
- **The SQL is the most portable asset in the entire codebase.** It is
  framework-independent by nature, it encodes the hardest-won product
  thinking (entitlements, metering, offline licensing), and it transfers to a
  static SPA without modification beyond renaming.

There is a second implication worth stating plainly. CarePland has no
`middleware.ts`; route protection is client-side redirect plus per-route
Bearer-token checks. For a client-rendered app that is a reasonable posture,
and DocScrub — being fully static — has no choice but the same one. So:

> **In DocScrub, RLS is the entire authorization model. Route guards are
> UX, not security.** Any check that matters must be expressible as a Postgres
> policy or a `security definer` function. This should be written down before
> the first table exists, because it is very easy to build a client-side
> "permission" system that feels like enforcement and isn't.

### 1.2 Component-by-component verdict

| CarePland component | Verdict | Reasoning |
|---|---|---|
| `lib/platform/sessionValidity.ts` (215 lines) | **Reuse essentially unchanged** | Zero imports. A framework-free store plus `classifySessionLoss()`, which distinguishes transient network failure (`failed to fetch`, `offline`, `timeout`, 5xx) from terminal auth failure (`jwt expired`, `invalid refresh token`, 401). This matters *more* in DocScrub than in CarePland: a reviewer 300 candidates into a document must never be dumped to a sign-in screen because a tunnel dropped. Port it; extend `SessionValiditySurface` to DocScrub's own surfaces. |
| `plans` / `plan_features` / `check_feature_access()` / `consume_feature_usage()` / `refund_feature_usage()` / `feature_usage_period_start()` / `current_plan_feature_row()` (`2026-05-22_plan_feature_metering.sql`) | **Reuse, renaming `care_circle_id` → `workspace_id`** | This *is* the answer to "pricing should fall out of the ownership model." Entitlement is a `security definer` function returning structured JSON (`allowed`, `reason`, `plan_id`, `limit`, `used`, `remaining`, `message`), keyed on the collaboration boundary, with per-plan user-facing copy stored as data. Feature gates become one RPC call. That `refund_feature_usage()` exists is a sign of a mature design — metering you cannot reverse becomes a support burden the first time a generation fails halfway. |
| RLS `exists (select 1 from …memberships where …user_id = auth.uid() and status = 'active')` idiom | **Reuse as the standard policy shape** | Applied consistently across every CarePland table. Adopt verbatim as DocScrub's house policy pattern so no table invents its own. |
| `lib/platform/server/accountStatus.ts` | **Reuse the pattern** | Account lifecycle as a first-class column plus a single `assertAccountActive()` chokepoint and a typed `InactiveAccountError` carrying `status = 403`. Cheap, and retrofitting account suspension later is painful. |
| `authRedirect.ts`'s `normalizedReturnTo()` | **Reuse verbatim** | Eight lines that correctly reject non-`/` and protocol-relative `//` return targets. Small, correct, easy to get wrong. The path-building around it is CarePland-specific. |
| `lib/platform/server/env.ts` | **Adapt** | The `MissingServerEnvError(variableNames[])` shape — collect *all* missing variables, name them, fail loudly — is right. But a static build has no `process.env`. DocScrub needs a generated config module; CarePland's own `scripts/write-build-info.mjs` is the precedent for how. |
| Google OAuth (`CarePlandPers.tsx:7326-7354`, `googleAuthRedirectUrl()`) | **Adapt** | `signInWithOAuth({ provider: "google", options: { redirectTo } })` plus the `?auth_action=google_sign_in` return-marker convention. ~20 lines. The pattern transfers; the surrounding component does not. |
| `lib/platform/server/supabase.ts` (`createSupabasePublicClient` / `UserClient` / `ServiceClient`) | **Adapt down** | The three-client split exists because CarePland has a server. DocScrub at MVP has only the browser client. Keep the *discipline* — a service-role key must never be reachable from client code — and defer the rest to Edge Functions if and when they exist. |
| `lib/platform/server/adminAuth.ts` (`requireAdminCaller`) | **Adapt — but push it into SQL** | The shape (Bearer → active user → role check, with per-caller message and error factories) is correct. DocScrub has no API routes, so its analogue is a `security definer` `require_workspace_role(workspace_id, min_role)` function. Same idea, enforced where it can't be bypassed. Its own header note — that the four-step check was hand-copied into a dozen route files before consolidation — is the argument for writing the function *first*. |
| `offlineAccess.ts` + `offlineAuthorization.ts` + `2026-07-17_extended_offline_access.sql` | **Adapt — and it is more central here than there** | HMAC-SHA256-signed, device-bound, time-limited, cooldown-governed offline entitlement passes, with `timingSafeEqual` verification and an advisory-lock-guarded issuing RPC. DocScrub's entire promise is local processing, so *offline must be the normal case, not an exception*. The signing is `node:crypto` server-side; in DocScrub that becomes a Supabase Edge Function, with browser-side verification via WebCrypto against a published public key (prefer Ed25519/ECDSA over HMAC so the verifying client never holds the signing secret). |
| `sessionSettings.ts` (idle timeouts) | **CarePland-specific** | Idle timeout exists because CarePland holds health data on screen. DocScrub's analogous risk is the opposite shape — an unattended screen showing un-redacted PII — and its answer is different. Do not port the mechanism; port the awareness. |
| `care_circles`, `care_subjects`, `care_circle_memberships` semantics | **CarePland-specific in meaning, reusable in shape** | A care circle is a household organized around a care recipient. A DocScrub workspace is a collaboration boundary organized around documents. The *structure* (container + membership rows + entitlement rows) is exactly right; the *semantics* must not be carried over, and neither should the naming. |
| `app/CarePlandPers.tsx` (22,262 lines) | **Do not reuse — treat as the lesson** | Authentication, OAuth, session restore, care-circle resolution, entitlement loading and thirty other concerns share one component. The extractions that *did* happen (`sessionValidity`, `authRedirect`, `adminAuth`) are precisely the parts that are reusable today. DocScrub should extract an `IdentityService` on day one rather than after 22k lines. |

### 1.3 Four findings from CarePland worth acting on

These are observations about CarePland's evolution, not criticisms of its
current state — each is cheap to get right in a greenfield schema and
expensive to retrofit.

**(a) The foundational tables have no migration.** `supabase/sql/` contains
142 dated files, but `profiles`, `care_circles`, `care_circle_memberships`,
`care_circle_entitlements` and `plans` are only ever `alter`ed, never
`create`d. They were made in the Supabase dashboard. The consequence is that
there is no reproducible path from empty project to working schema, which
makes a staging environment hard to trust and onboarding a second engineer
harder still. `supabase/sql/README.md` and `docs/ENVIRONMENT_AND_RELEASE_POLICY.md`
show the discipline arrived later and is now genuinely good — the gap is
purely that it started after table one.

*For DocScrub:* the very first table gets a numbered migration file. No
dashboard-authored DDL, ever.

**(b) "Signed in, but no care circle membership was found" is reachable.**
`CarePlandPers.tsx:7073` handles it, which means it happens. Personal-container
provisioning is application-level and not atomic with account creation, so a
user can exist in `auth.users` with nothing to belong to.

*For DocScrub:* provision the personal workspace in an `after insert on
auth.users` trigger inside the same transaction as the user row. The state
becomes unreachable by construction rather than handled by a message.

**(c) Plan shape is scattered.** `plan_features` rows are seeded from
whichever feature migration introduced them, with `on conflict do update`.
Feature-local seeding is correct and worth keeping — but there is no single
place to read "what does Pro actually include?", which is the question
pricing pages, sales conversations and support tickets all ask.

*For DocScrub:* keep feature-local seeds, add a `plan_matrix` view that
pivots `plan_features` into one readable row per plan.

**(d) `subscription_tier_at_issue` is a good instinct, generalized.** The
offline-authorization table records the plan at issue time, so a later plan
change cannot retroactively invalidate an already-issued pass. That principle
— *durable artifacts record the entitlement they were created under* —
already exists in this repository as `ScoringProfileSnapshot` (ADR-015).

*For DocScrub:* the same rule should govern exported audit records. An audit
artifact should carry the plan it was produced under.

---

## 2. Phase 2 — The ownership model

### 2.1 Four scopes, and the invariant that keeps them expandable

```
User ──────────── identity, preferences, licensing-of-person, billing
  │
  ├── owns/joins ─→ Workspace ──── the collaboration boundary
  │                     │            members, permissions, entitlements
  │                     │
  │                     ├─→ Document ─── review state, entity registry,
  │                     │                 outputs, audit, review history
  │                     │
  │                     └─→ Workspace Memory (future)
  │
  └── Personal Memory ── never shared, never inherited, never automatic
```

The structure is as the brief describes. The part that determines whether it
expands without redesign is a single invariant:

> **A personal workspace is not a special kind of thing. It is an ordinary
> workspace with exactly one member, whose role is `owner`.**

`workspaces.kind` (`'personal' | 'team'`) exists, but it is *descriptive*: it
drives default naming and which UI affordances are offered. **It must never
appear in an authorization branch.** Every read, write and permission check
goes through `workspace_members` from day one, even when that table is
guaranteed to hold exactly one row per workspace.

This costs almost nothing now — a join that always matches — and it is the
entire difference between "Acme Law Firm" being a data change and being a
migration. The failure mode it prevents is the common one: authorization
written as `if (isPersonal) allow(ownerId)` scattered across twenty call
sites, each of which must then be found and rewritten.

The same reasoning applies to roles. Define `owner | admin | member | viewer`
in the enum at creation time and ship using only `owner`. Adding a role later
to an enum that has one value means auditing every policy that assumed one
value; adding a *user* to an enum that already has four means inserting a row.

### 2.2 What each scope owns

**User** (`auth.users` + `public.profiles`) — account identity, display name,
avatar, reviewer preferences, `account_status`, billing customer id,
`workspace_quota`. Personal memory hangs off the user, not off any workspace.

**Workspace** (`workspaces` + `workspace_members` + `workspace_entitlements`)
— the boundary that owns documents, holds members and their roles, carries
the plan, and will own shared memory. Every content-bearing row in the schema
carries a `workspace_id`, without exception, including rows that at MVP can
only ever have one possible value.

**Document** (`documents` + `document_review_state`) — belongs to exactly one
workspace. Identified by the content hash this repository already computes
(`io/hash.ts`, `DocumentModel.documentId`), which is a genuinely useful
property: the cloud can recognize "this is the same document" across devices
and across users **without ever receiving its contents**. That is worth
naming as a deliberate asset rather than an accident.

**Personal Memory** (`personal_memory_entries`) — one user's durable,
cross-document reusable decisions. Never shared automatically; never
inherited by a workspace; never visible to a workspace admin. See §6.

**Workspace Memory** (`workspace_memory_entries`) — exists in the schema from
day one, unused at MVP. Its rows are always *published* — deliberately
promoted from a personal decision by a person who chose to publish it. There
is no path by which a private judgment becomes organizational knowledge
without an explicit act.

### 2.3 The billing-subject fork — a decision this proposal cannot make for you

The brief's tiers mix two different subjects:

- Pro: "unlimited workspaces" — a property of a **user**.
- Team: "multiple users, shared workspaces" — a property of a **workspace**.

If both are entitlements, they cannot both hang off the same table. CarePland
resolved this by attaching entitlements to the care circle only, and it has
no "unlimited care circles" tier, so the question never arose there.

Three ways to resolve it:

1. **Workspace-scoped entitlements, plus a small user-level workspace quota.**
   `workspace_entitlements` carries the plan (ports CarePland directly);
   `profiles.workspace_quota` gates workspace *creation*. Two enforcement
   surfaces, but each is trivially simple and each sits where the resource
   actually lives.
2. **User-scoped entitlements only.** A workspace inherits its owner's plan.
   Simple until two Pro users share a workspace and you must decide whose plan
   applies — and until a Team plan needs to be paid for by an organization
   that is not any particular member.
3. **Both scopes, resolved by precedence.** Maximum flexibility, and the kind
   of thing that produces "why is this feature locked?" tickets nobody can
   answer.

**Recommendation: (1).** It matches CarePland's shipped shape, keeps the
expensive machinery (metering, limits, user-facing copy) on the workspace
where multi-user billing will eventually need it, and reduces the user-level
surface to a single integer column. The cost is honest and small: two places
to check instead of one.

### 2.4 How the tiers fall out

With workspace-scoped entitlements, no tier requires new mechanism:

| Tier | Expressed as |
|---|---|
| Free | `plans('free', max_members = 1)`, `profiles.workspace_quota = 1`, `plan_features` rows capping stored documents and persistence retention |
| Pro | `workspace_quota = null` (unlimited), `plan_features` enabling `personal_memory`, `version_history`, `advanced_export`, no document cap |
| Team | `plans('team', max_members = n)`, `plan_features` enabling `workspace_memory`, `shared_review`, `approvals`; multi-member workspaces need no schema change because `workspace_members` was always the access path |
| Enterprise | Supabase SSO/SAML at the auth layer; `organizations` becomes a parent of `workspaces` (an added table and a nullable FK, not a redesign); `plan_features` enabling `audit_retention`, `scim`, `org_policy` |

Every one of these is a row in `plan_features` and a `check_feature_access()`
call at the gate. That is what "pricing falls out of the ownership model"
looks like in practice.

The tier design does carry one real risk worth naming: gating *persistence*
by tier means a Free user who lapses could find durable work inaccessible.
For a tool whose promise is that your document stays on your computer, that
would be a bad look and arguably a bad act. **Recommended invariant: local
IndexedDB state is never gated by entitlement.** Tiers gate *cloud* features —
sync, sharing, retention, history. What is already on the reviewer's machine
stays readable regardless of plan, subscription lapse, or sign-out. This also
happens to make the free tier honest rather than a trap, which is the same
instinct as the rest of the product.

---

## 3. Phase 3 — Proposed Supabase schema

Illustrative rather than final; RLS abbreviated. `member_of(w)` denotes the
CarePland membership idiom: `exists (select 1 from workspace_members m where
m.workspace_id = w and m.user_id = auth.uid() and m.status = 'active')`.

### 3.1 Identity and ownership

```sql
-- 0001_identity_foundation.sql

create table public.profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  display_name        text,
  avatar_url          text,
  account_status      text not null default 'active'
                        check (account_status in ('active','inactive')),
  workspace_quota     integer,          -- null = unlimited (Pro and above)
  billing_customer_id text,
  is_admin            boolean not null default false,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  kind        text not null default 'personal'
                check (kind in ('personal','team')),   -- DESCRIPTIVE ONLY.
                -- Never branch authorization on this column. See §2.1.
  created_by  uuid not null references auth.users(id),
  created_at  timestamptz not null default now(),
  archived_at timestamptz
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'member'
                 check (role in ('owner','admin','member','viewer')),
  status       text not null default 'active'
                 check (status in ('active','invited','suspended')),
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
```

Provisioning is a trigger, not application code — the fix for finding (b):

```sql
create function public.provision_personal_workspace()
returns trigger language plpgsql security definer set search_path = public as $$
declare new_workspace_id uuid;
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)));

  insert into public.workspaces (name, kind, created_by)
  values (coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)) || '''s Workspace',
          'personal', new.id)
  returning id into new_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role, status)
  values (new_workspace_id, new.id, 'owner', 'active');

  insert into public.workspace_entitlements (workspace_id, plan_id, status)
  values (new_workspace_id, 'free', 'active');

  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.provision_personal_workspace();
```

One authorization chokepoint, so no policy hand-rolls role comparison —
the SQL analogue of `requireAdminCaller`:

```sql
create function public.require_workspace_role(p_workspace_id uuid, p_min_role text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and case p_min_role
            when 'viewer' then true
            when 'member' then m.role in ('owner','admin','member')
            when 'admin'  then m.role in ('owner','admin')
            when 'owner'  then m.role = 'owner'
          end
  );
$$;
```

### 3.2 Entitlements — ported from CarePland

`plans`, `plan_features`, `workspace_entitlements`, `workspace_feature_usage`,
and the functions `feature_usage_period_start()`, `current_plan_feature_row()`,
`check_feature_access()`, `consume_feature_usage()`, `refund_feature_usage()`
— structurally identical to `2026-05-22_plan_feature_metering.sql` with
`care_circle_id` → `workspace_id`, plus the `plan_matrix` view from finding
(c). Seeded:

```sql
insert into public.plans (id, name, max_members) values
  ('free','Free',1), ('pro','Pro',1), ('team','Team',25), ('enterprise','Enterprise',null);
```

### 3.3 Documents — metadata only

```sql
create table public.documents (
  id                    uuid primary key default gen_random_uuid(),
  workspace_id          uuid not null references public.workspaces(id) on delete cascade,
  -- The existing content hash from io/hash.ts. Identity without content:
  -- the cloud recognizes the same document across devices while never
  -- receiving a byte of it.
  content_hash          text not null,
  file_name             text not null,      -- see the caveat below
  byte_size             bigint,
  candidate_count       integer,
  reviewed_count        integer,
  first_reviewed_at     timestamptz not null default now(),
  last_reviewed_at      timestamptz not null default now(),
  last_reviewed_by      uuid references auth.users(id),
  unique (workspace_id, content_hash)
);

alter table public.documents enable row level security;
create policy documents_read  on public.documents for select to authenticated
  using (public.require_workspace_role(workspace_id, 'viewer'));
create policy documents_write on public.documents for all to authenticated
  using (public.require_workspace_role(workspace_id, 'member'))
  with check (public.require_workspace_role(workspace_id, 'member'));
```

**`file_name` is the boundary's soft spot and deserves an explicit decision.**
Filenames in this problem domain routinely *are* PII —
`Smith_v_Anderson_Deposition.docx`, `Jane-Doe-Intake.docx`. Storing them
plainly means the "no document content in the cloud" promise is technically
kept while the cloud accumulates a list of matter names and litigant names.
Options: store the filename plaintext (best UX, weakest promise); store only
an extension plus a reviewer-supplied label (strong promise, worse UX);
encrypt the filename with the same key as everything else in §5 and show it
locally (best of both, only available if §5 lands). This should be decided
consciously, not defaulted into.

### 3.4 Review sessions — a deliberately empty envelope at MVP

```sql
create table public.review_sessions (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  document_id     uuid not null references public.documents(id) on delete cascade,
  user_id         uuid not null references auth.users(id),
  schema_version  integer not null,
  status          text not null default 'in_progress'
                    check (status in ('in_progress','completed','abandoned')),
  -- Non-content progress metrics. Safe to store plainly: counts, not values.
  total_candidates    integer,
  decided_candidates  integer,
  -- Content-derived payload. NULL at MVP. See §5 before ever populating.
  encrypted_state     bytea,
  encryption_key_id   text,
  started_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (document_id, user_id)
);
```

The `encrypted_state` / `encryption_key_id` columns exist from day one and
stay null. That is the cheapest possible way to keep §5 an added behavior
rather than a schema migration, and a null column is an honest statement that
the question is open.

### 3.5 Memory — three scopes, one shape

```sql
create table public.personal_memory_entries (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  -- Content-derived: candidate_key IS normalized document text and
  -- replacement IS operator-authored text about real people.
  -- NULL at MVP; ADR-018 class `content-derived-never-sync`. See §5.
  encrypted_entry   bytea,
  encryption_key_id text,
  -- Non-content metadata, safe plaintext. Mirrors CandidateDecisionSource's
  -- promotable values plus the explicit-promotion escape hatch (§6.4).
  origin         text not null check (origin in ('reviewer','explicit-promotion')),
  decided_at     timestamptz not null,
  updated_at     timestamptz not null default now()
);

create table public.workspace_memory_entries (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  published_by      uuid not null references auth.users(id),
  published_at      timestamptz not null default now(),
  encrypted_entry   bytea,
  encryption_key_id text,
  -- Workspace memory is always deliberately published. There is no
  -- automatic path from a personal decision to an organizational one.
  origin            text not null default 'explicit-promotion'
                      check (origin = 'explicit-promotion')
);
```

Note `workspace_memory_entries.origin` has a single legal value enforced by a
check constraint. That is intentional: the database itself refuses to record
organizational knowledge that nobody chose to publish.

### 3.6 Audit metadata

```sql
create table public.audit_records (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  document_id    uuid not null references public.documents(id) on delete cascade,
  user_id        uuid not null references auth.users(id),
  exported_at    timestamptz not null default now(),
  schema_version integer not null,
  -- Per CarePland finding (d) and ADR-015's precedent: durable artifacts
  -- record the entitlement they were produced under.
  plan_id_at_export text,
  decision_counts   jsonb,   -- {"Keep":12,"Rename":4,"Redact":31,"Ignore":2}
  content_hash      text     -- of the exported artifact, for tamper evidence
);
```

This is the shape ADR-003's invariant `audit-excludes-candidate-text` already
demands: counts and hashes, never values.

---

## 4. Phase 4 — Authentication flow

### 4.1 Configuration in a static build

DocScrub has no `process.env` at runtime. Add a build step mirroring
CarePland's `scripts/write-build-info.mjs` that emits
`src/config/supabase-config.ts` from environment variables at build time,
gitignored, with `env.ts`'s "collect and name every missing variable" error
shape. The anon key is public by design; RLS is the boundary (§1.1).

### 4.2 The flow

```
Reviewer opens DocScrub
  └─ App loads and is FULLY USABLE. No auth gate. No spinner.
     Document processing, review, export: all work signed out.
        │
        ├─ Signed out: local-only mode. IndexedDB as today.
        │              A quiet, non-modal "Sign in to sync" affordance.
        │
        └─ Clicks Sign in
             └─ supabase.auth.signInWithOAuth({ provider: "google",
                  options: { redirectTo: appUrl + "?auth_action=google_sign_in" } })
                  └─ Google consent → redirect back
                       └─ supabase-js restores session from the URL
                            └─ IdentityService resolves:
                                 profile, workspaces (via workspace_members),
                                 active workspace, entitlements
                                 └─ Local adoption (§7.2) runs once
```

Sign-out clears the Supabase session and the active workspace. **It does not
clear IndexedDB and does not close the open document.** The reviewer's local
work is theirs.

### 4.3 Three rules that are more important here than in CarePland

1. **Never gate a loaded document on auth.** Auth state may change at any
   moment — token expiry, revocation, network loss. A review in progress must
   survive all of it. This is `sessionValidity`'s exact job and the strongest
   single reason to port it early.
2. **`temporarily_offline` must never escalate to a sign-in prompt.**
   CarePland's `classifySessionLoss()` already draws this line correctly.
   For DocScrub, offline is not a degraded state — it is the *expected* state
   of a tool that processes documents locally.
3. **Sign-in is additive, never destructive.** Signing in must not replace,
   reconcile-with-loss, or overwrite local state. It adopts it (§7.2).

### 4.4 `IdentityService` — the extraction CarePland made 22,000 lines late

```ts
export interface IdentityService {
  getState(): IdentityState;              // signed-out | signing-in | signed-in
  subscribe(listener: () => void): () => void;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
  getActiveWorkspace(): WorkspaceRef | null;
  setActiveWorkspace(id: string): Promise<void>;
  checkFeature(featureKey: string, quantity?: number): Promise<FeatureAccess>;
}
```

Same store-plus-subscribe shape as `sessionValidityStore`, so it composes with
this repository's existing idioms. Critically: **nothing in `src/domain/`,
`src/engines/` or `src/io/` may import this.** Identity is a UI-and-workspace
concern. `FocusNavigator` must not know whether anyone is signed in, for the
same reason the existing domain boundary forbids it depending on rendered
state.

---

## 5. The local-first boundary — the decision this initiative actually turns on

Three positions. Each is coherent; they are not equally good.

### Option A — the boundary holds, cloud stores no content

Cloud holds workspace metadata, document identity and counts, ownership,
entitlements, audit metadata. Review sessions and decision memory stay in
IndexedDB.

*Delivers:* accounts, workspaces, licensing, tiers, cross-device *recognition*
("you reviewed this document on another device, 47 of 61 decided"), the full
Free/Pro billing surface. ADR-003 and ADR-018 are untouched. No key management
of any kind.

*Does not deliver:* cross-device continuity of actual decisions, and — fatally
for the roadmap — Team tier's shared review memory, which is content-derived
by definition.

### Option B — the boundary moves, cloud stores content in plaintext

Standard RLS over a `decisions` table.

*Delivers:* everything, quickly, with mechanisms every engineer already knows.

*Costs:* it retracts a shipped promise, and it does so in the worst possible
shape for this specific product. A plaintext decision-memory table is an index
of real people's names paired with what a reviewer decided to call them
instead — assembled from documents whose entire reason for passing through
DocScrub was that they contained information that should not leave. Breach
consequences are not proportional to the feature's value.

**Recommend against.** Not on principle alone: on the specific observation
that the data is worse than the documents it came from, because it is
pre-extracted, pre-normalized and pre-labelled.

### Option C — the boundary holds by construction: client-side encryption

Content-derived payloads are encrypted in the browser; Supabase stores
ciphertext plus a non-content index. RLS governs who may *fetch*; key custody
governs who may *read*.

*Delivers:* everything in B, while ADR-003's literal wording stays true — the
cloud service never receives review decisions, only opaque bytes.

*Costs:* key custody, which with Google-only sign-in is a genuinely hard UX
problem. There is no password to derive from. Three sub-options:

- **C1 — user-held recovery phrase.** Strongest guarantee; the server
  provably cannot read the data. Costs: a phrase to store, and *losing it
  means losing the memory permanently*. That is real friction of exactly the
  kind this product otherwise works hard to remove.
- **C2 — server-wrapped key (KMS).** Zero user friction; protects against
  database compromise, backup leakage and casual internal access — but not
  against a compromised application server. The honest description is
  "encrypted at rest with managed keys," not "we cannot read it."
- **C3 — C2 by default, C1 available.** Calm by default; strong for reviewers
  whose work requires it. Costs a second code path and clear enough copy to
  explain the difference without a lecture.

### Recommendation

**Ship Option A. Build the schema so Option C is a column population rather
than a redesign. Decide between C1/C2/C3 when cross-device sync is actually
being built, not now.**

Reasoning: A delivers everything the brief needs *first* — accounts, Google
auth, workspaces, tiers, licensing, persistent metadata — without touching
the review engine, without a key-management design, and without amending a
single ADR. The encryption question then gets decided against a real feature
with real users rather than in the abstract, which is when it will be decided
well. `review_sessions.encrypted_state` sitting null in the meantime is a
cheap and honest placeholder.

The one thing to be candid about: this means **Team tier's shared memory is
gated behind the §5 decision**, not merely behind implementation effort. That
is a real roadmap dependency and should be visible on the roadmap rather than
discovered when Team is scoped.

---

## 6. Decision Memory — separating the scopes

### 6.1 The defect, precisely

`Workspace.autosave()` (line ~885) calls `projectDecisionMemory(session, …)`
on **every save**, and `projectDecisionMemory()` iterates
`session.candidateDecisions` **unconditionally**. Every decided candidate
becomes durable cross-document memory.

So a group bulk action — one keystroke deciding forty candidates — produces
forty durable personal memory entries, weighted identically to forty
deliberate one-at-a-time judgments. On the next document, `mergeDecisionMemory()`
resolves conflicts by `decidedAt` most-recent-wins, so a hasty bulk sweep
silently outranks a careful earlier decision.

The brief's instinct — "bulk review actions should not automatically become
durable personal knowledge" — is correct, and this is where it bites.

There is a second, subtler leak in the same path: a decision applied *by*
`applyRememberedDecisions()` is written back into memory with a fresh
`decidedAt`. Reused decisions therefore refresh their own recency on every
document they touch, so an old decision can outrank a newer contradicting one
indefinitely. That is a self-reinforcing loop, not a decision.

### 6.2 Provenance: extend the field that already exists

The obvious move is a new `decisionOrigin` field. **Don't.** `CandidateDecision`
already carries provenance:

```ts
// domain/ReviewSession.ts, as built today
export type CandidateDecisionSource = "reviewer" | "imported";
```

with a documented legacy rule (absent → `"reviewer"`), a documented invariant
(`evidence` present iff `source === "imported"`), serialization into the audit
record (`AuditExporter.ts:174`, `entry.source = decision.source ?? "reviewer"`),
and a consumer in `wasEverImported()`. Adding a parallel field would leave two
overlapping answers to "where did this decision come from," which is exactly
the drift the existing "derive, don't duplicate" rule exists to prevent.

The correct change is to widen the existing union along the axis it is already
missing — *how* a reviewer decision was made:

```ts
export type CandidateDecisionSource =
  | "reviewer"          // one candidate, decided deliberately
  | "reviewer-group"    // one action across a group
  | "reviewer-type"     // one action across a type
  | "reviewer-section"  // one action across a section
  | "imported";         // DecisionReuseEngine — file import OR decision memory
```

Four properties make this the cheap change rather than the expensive one:

- Every added member is *new*. `"reviewer"` and `"imported"` keep their exact
  meanings, so the durable-vocabulary rule (never rename a serialized value)
  is honored, `wasEverImported()`'s `=== "imported"` test stays correct, and
  the `evidence`-iff-`imported` invariant is untouched.
- The existing legacy rule already says absent → `"reviewer"`. Pre-existing
  sessions keep promoting exactly as they do today; nobody loses memory they
  already had.
- `"imported"` already covers decision-memory replay — `applyRememberedDecisions()`
  routes through the same `applyDecisionReuse` command that sets
  `source: "imported"` (`engines/review/session.ts:740`). So excluding
  `"imported"` from promotion closes the recency loop of §6.1 for free, with
  no new enum member at all.
- `ImportedCandidateDecision` carries no `source` field, so the
  export/import round trip is unaffected.

Costs, stated honestly: `REVIEW_SESSION_SCHEMA_VERSION` goes 2 → 3 under
ADR-012, and because `source` is serialized into the audit record, the audit
schema's own version must move with it. Both are additive-value changes to a
closed union, which is the mildest kind of schema change this repository
makes.

*Residual imprecision worth recording rather than fixing:* `"imported"`
conflates file import with decision-memory replay. For memory scoping this is
immaterial — both are non-promotable — so splitting it now would add a value
to a durable vocabulary to serve no current consumer. If a later feature needs
to tell a reviewer "this came from your own memory" versus "this came from a
file you imported," that is the time to split it.

### 6.3 The scope model

```ts
export type MemoryScope = "document" | "personal" | "workspace";
```

| Scope | Lives in | Written by | Read by | Precedence |
|---|---|---|---|---|
| `document` | `ReviewSession.candidateDecisions` | every review command | this document only | **highest** |
| `personal` | IndexedDB now; cloud iff §5 | promotion filter (§6.4) | this user, every document | middle |
| `workspace` | cloud only, future | explicit publication only | every workspace member | **lowest** |

Precedence is the point. The reviewer's decision *in this document* always
wins. Their own prior decision beats their organization's. Workspace memory is
a default of last resort, never an override — an organization may suggest, it
may not overrule.

The exact-key-only replay rule stays exactly as it is. Personal memory replays
on exact key match and nothing weaker. **Workspace memory should be no looser
than personal memory, and arguably stricter**, because being wrong there is
wrong across people rather than merely across documents.

### 6.4 The promotion rules

**document → personal.** Automatic, but filtered:

```ts
// Absent is the documented legacy reading of `source` and stays permissive,
// so pre-existing sessions keep the memory they already have.
const PROMOTABLE: readonly CandidateDecisionSource[] = ["reviewer"];

export function projectDecisionMemory(session, documentId, updatedAt) {
  const entries = Object.values(session.candidateDecisions)
    .filter((d) => PROMOTABLE.includes(d.source ?? "reviewer"))
    .map(toMemoryEntry);
  // …
}
```

Bulk sources are excluded because a bulk action expresses a judgment about
*this document's* structure — "every occurrence in this exhibit is the same
person" — not a portable fact about a name. Extending it silently to future
documents asserts something the reviewer never said. This is precisely the
reasoning `DecisionMemory.ts` already applies to rule inference ("the stray
word in 'Tanesha Can Collier' was incidental"), applied one level up: same
principle, same conclusion.

`"imported"` is excluded for two reasons at once. A decision replayed from
memory is already in memory, so re-promoting it only refreshes its own
timestamp — the recency loop of §6.1. And a decision applied from a
`decisions.json` file means the reviewer opted into that file, not into
permanent memory; the file remains available and the import remains explicit.

**Bulk outcomes remain promotable — by asking.** After a bulk action, an
unobtrusive affordance: *"Remember these 12 decisions for future documents?"*
Declining is free and silent; accepting rewrites those entries' origin to
`explicit-promotion`. This preserves the feature's value without converting a
speed action into a permanent commitment, and it keeps the reviewer the
decision-maker — which is the house voice, not just the house architecture.

**personal → workspace.** Never automatic under any circumstances. Always an
explicit publication act, always attributed (`published_by`, `published_at`),
always revocable. The check constraint in §3.5 enforces this in the database
so no future code path can bypass it.

### 6.5 What this changes in the existing engine

Small and contained, which is the point:

- `CandidateDecisionSource` gains three members; `REVIEW_SESSION_SCHEMA_VERSION`
  2 → 3, and the audit schema version moves with it (§6.2).
- Command handlers that apply bulk decisions stamp the source they already
  know — the group/type/section scope is right there in the command.
- `projectDecisionMemory()` gains a filter.
- `applyRememberedDecisions()` needs **no change** — it already routes through
  `applyDecisionReuse`, which already stamps `"imported"`.
- `DecisionReuseEngine` is **unchanged** — it consumes `ImportedDecisions`,
  and filtering happens upstream of it.
- No detection, classification, scoring, normalization or navigation code is
  touched at all.

---

## 7. Migration strategy

### 7.1 Database

Create `supabase/migrations/` with numbered, forward-only files, from table
one — CarePland finding (a). Nothing authored in the dashboard.

```
0001_identity_foundation.sql     profiles, workspaces, workspace_members, trigger, RLS
0002_entitlements.sql            plans, plan_features, workspace_entitlements,
                                 workspace_feature_usage, check/consume/refund, plan_matrix
0003_documents.sql               documents, review_sessions (encrypted_state null)
0004_memory.sql                  personal_memory_entries, workspace_memory_entries
0005_audit.sql                   audit_records
```

### 7.2 Local data — adoption, never migration

DocScrub today has real users with real IndexedDB state and no user identity.
On first sign-in that state must be adopted without loss and without asking.

Under Option A the local records never move. Adoption is:

1. Stamp local `SessionRecord`s and `DecisionMemoryRecord`s with the resolved
   `workspaceId` (a new optional field; absent means "pre-account, adopt on
   next sign-in").
2. For each local session, upsert a `documents` row from `content_hash` plus
   counts. Metadata only.
3. Show the reviewer what happened, once, factually. Not a wizard.

Three rules:

- **Adoption never blocks.** Failure leaves the reviewer exactly as they were,
  signed in and working, with adoption retried later. Same posture
  `applyRememberedDecisions()` already takes.
- **Sign-out never deletes.** Local state survives sign-out, account switch,
  and account deletion. It is on their machine; it is theirs.
- **No account, no degradation.** Every capability DocScrub has today keeps
  working with no account, forever. Accounts add; they do not unlock.

### 7.3 Session schema

Widening `CandidateDecisionSource` bumps `REVIEW_SESSION_SCHEMA_VERSION` 2 → 3
under ADR-012, and the audit schema version with it (§6.2). Existing sessions
load with `source` absent, read as `"reviewer"` — which is the rule already
documented in `ReviewSession.ts` today, not a new one. Because the promotion
filter treats absent as promotable, no reviewer loses memory they already had.

---

## 8. Implementation order

Ordered so the review engine is untouched for as long as possible, each step
ships independently, and the §5 decision is deferred as far as it can be.

**Step 0 — Migration hygiene.** `supabase/migrations/`, forward-only policy,
a documented "no dashboard DDL" rule. *Touches the review engine: no.*

**Step 1 — Identity substrate.** `0001` and `0002`: profiles, workspaces,
members, provisioning trigger, `require_workspace_role()`, RLS, and the ported
CarePland entitlement machinery seeded with the four plans. Verifiable
entirely in SQL against a throwaway project before any client code exists.
*Touches the review engine: no.*

**Step 2 — Client identity.** Port `sessionValidity.ts`. Build
`IdentityService`. Add build-time config generation. Add Google sign-in and
the workspace indicator to the UI. DocScrub remains fully functional signed
out throughout. *Touches the review engine: no.* First user-visible step.

**Step 3 — Decision provenance and scope split.** §6, entirely local. Widen
`CandidateDecisionSource`, bump the session and audit schema versions, stamp
bulk sources at the commands that already know them, filter
`projectDecisionMemory()`, add the explicit-promotion affordance. *Touches the
review engine: yes — minimally, and this is the only step that does.*

Deliberately placed **before** any sync work. Whatever eventually syncs should
already be correctly filtered; the alternative is syncing a known-polluted
memory and then trying to unpick it across devices. It also stands on its own:
it improves the product with no cloud involvement at all, so it is worth doing
even if the rest of this proposal is never built.

**Step 4 — Document registry.** `0003`. Register document metadata on save.
Cross-device Recent Documents. Decide the `file_name` question from §3.3
explicitly here. *Touches the review engine: no* — a `Workspace` autosave hook.

**Step 5 — Entitlement enforcement.** Wire `check_feature_access()` into
workspace creation and the first real feature gates. Free vs Pro becomes
functional. *Touches the review engine: no.*

**Step 6 — [GATED on §5] Content sync.** Only after the encryption and key-custody
decision. Populates `encrypted_state` and the memory tables.

**Step 7 — [GATED on Step 6] Multi-member workspaces.** Invitations, roles beyond
`owner`, workspace memory publication, Team tier. No schema redesign required —
`workspace_members` was the access path from Step 1.

**Step 8 — [FUTURE] Enterprise.** Supabase SSO/SAML, an `organizations` parent
table, SCIM, retention policy. Additive.

Steps 0–5 deliver Google authentication, accounts, workspaces, pricing tiers,
licensing, saved workspaces, persistent review metadata, and a correctly
scoped personal decision memory — **without a single amendment to ADR-003 or
ADR-018, and with exactly one contained change to the review engine.**

---

## Appendix A — Proposed ADRs (drafts; numbers reserved, not accepted)

These are written in the register's template and are ready to move into
`app/docs/architecture/decisions/` **at decision time, not before** — per the
lifecycle rule that ADRs record decisions rather than propose them. If the
proposals here are revised, the drafts should be revised with them; if they
are rejected, the numbers should be released.

**ADR-020 — Workspace as the collaboration boundary.**
*Decision:* every content-bearing row carries a `workspace_id`; a personal
workspace is an ordinary workspace with one `owner` member; `workspaces.kind`
is descriptive and never appears in an authorization branch. *Alternatives:*
user-owned documents with sharing bolted on later (rejected — converts every
authorization site into a migration). *Consequences:* multi-member support
becomes a data change; a permanently trivial join at MVP.

**ADR-021 — RLS is the authorization model; route guards are UX.**
*Decision:* DocScrub is a static SPA with no server, so every authorization
rule must be expressible as a Postgres policy or `security definer` function.
Client-side guards are affordances only. *Alternatives:* an API tier
(rejected at MVP — contradicts ADR-001/002 and adds an operational surface for
no security gain over RLS). *Consequences:* no permission may exist that RLS
cannot express; `require_workspace_role()` is the single chokepoint.

**ADR-022 — Entitlements are workspace-scoped and data-driven.**
*Decision:* port CarePland's `plans` / `plan_features` /
`check_feature_access()` model, keyed on workspace, with a user-level
`workspace_quota` for the create-side check. *Alternatives:* user-scoped
entitlements (rejected — cannot express Team billing); dual-scope with
precedence (rejected — unexplainable gates). *Consequences:* new tiers are
rows, not code; two enforcement surfaces; **local IndexedDB state is never
gated by entitlement.**

**ADR-023 — Decision memory scopes and promotion rules.**
*Decision:* three scopes (`document` > `personal` > `workspace` by
precedence); the existing `CandidateDecisionSource` is widened rather than
joined by a parallel provenance field; only `"reviewer"` (and its absent
legacy reading) promotes automatically to personal memory; personal →
workspace is always an explicit, attributed, revocable publication, enforced
by a database check constraint. *Alternatives:* a new `decisionOrigin` field
(rejected — two overlapping answers to one question); promoting everything
(rejected — the current defect); promoting nothing without confirmation
(rejected — destroys the feature's calm). *Consequences:* session and audit
schema version bumps; `applyRememberedDecisions()` and `DecisionReuseEngine`
unchanged; closes the previously noted decision-provenance gap.

**ADR-024 — [OPEN] Content-derived data and the cloud boundary.**
*Status:* **open — deliberately not decided.** *Context:* ADR-003 and ADR-018
forbid content-derived data leaving the device; cross-device sync and shared
workspace memory require it to. *Position at this date:* ship Option A
(nothing content-derived leaves the device); shape the schema so Option C
(client-side encryption) is a column population; decide key custody
(C1/C2/C3) when cross-device sync is scoped. *Consequences:* Team tier's
shared memory is gated on this ADR, not merely on effort. This should be
visible on the roadmap.

---

## Appendix B — Open questions

1. **Billing subject** (§2.3) — workspace-scoped entitlements plus a user
   quota is recommended, not decided.
2. **Filenames in the cloud** (§3.3) — plaintext, label-only, or encrypted.
   Genuinely a PII question, not a UX one.
3. **Key custody** (§5) — C1, C2, or C3, when the time comes.
4. **Anonymous durability** — does an account holder get *more* local
   retention than an anonymous user? Recommendation: no. Local behavior should
   not depend on identity.
5. **Google-only, or Google plus email?** CarePland supports both. Google-only
   is calmer and removes password reset, recovery and update flows entirely;
   it also excludes reviewers at organizations that block Google sign-in —
   which, in legal and healthcare settings, is not a small population.
6. **Multiple devices, one document, simultaneously.** `review_sessions` has
   `unique (document_id, user_id)`. Two devices reviewing the same document is
   a last-writer-wins conflict today. Worth deciding before Step 6, not after.
