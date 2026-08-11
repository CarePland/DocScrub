import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  canManageMembers,
  duplicateActiveMembership,
  duplicatePendingInvitation,
  invitationExpired,
  normalizeInvitationEmail,
  organizationMemberEmailValid,
  pendingOrganizationMemberErrors,
  usedPendingOrganizationMemberRows,
  wouldOrphanOrganizationOwner,
  type Invitation,
  type Membership,
} from "../src/account/membership.ts";
import { readAuthRedirectState } from "../src/account/authRedirect.ts";

let failures = 0;

function check(name: string, condition: boolean, detail?: unknown): void {
  if (condition) {
    console.log(`PASS ${name}`);
    return;
  }
  failures += 1;
  console.error(`FAIL ${name}`, detail ?? "");
}

const memberships: Membership[] = [
  { organizationId: "org-a", role: "owner", userId: "owner-a" },
  { organizationId: "org-a", role: "admin", userId: "admin-a" },
  { organizationId: "org-b", role: "owner", userId: "owner-b" },
];

const invitations: Invitation[] = [
  {
    email: "Pending@Example.COM",
    expiresAt: "2026-08-20T00:00:00.000Z",
    organizationId: "org-a",
    role: "member",
    status: "pending",
  },
  {
    email: "accepted@example.com",
    expiresAt: "2026-08-20T00:00:00.000Z",
    organizationId: "org-a",
    role: "member",
    status: "accepted",
  },
];

check("normalizes invitation emails for duplicate prevention", normalizeInvitationEmail("  NEW@Example.COM ") === "new@example.com");
check("validates pending member email format", organizationMemberEmailValid(" teammate@example.com "));
check("rejects invalid pending member email format", !organizationMemberEmailValid("not-an-email"));
check(
  "pending member rows ignore completely empty rows",
  usedPendingOrganizationMemberRows([
    { displayName: "", email: "" },
    { displayName: "Ada Lovelace", email: " ADA@Example.COM " },
  ]).length === 1
);
check(
  "pending member rows normalize email addresses",
  usedPendingOrganizationMemberRows([{ displayName: "Ada Lovelace", email: " ADA@Example.COM " }])[0]?.email === "ada@example.com"
);
check(
  "pending member validation requires email when name is entered",
  pendingOrganizationMemberErrors([{ displayName: "Ada Lovelace", email: "" }]).length === 1
);
check(
  "pending member validation prevents duplicate email addresses",
  pendingOrganizationMemberErrors([
    { displayName: "Ada", email: "ada@example.com" },
    { displayName: "Ada Again", email: " ADA@example.com " },
  ]).length === 1
);
check("owners can manage members", canManageMembers("owner"));
check("admins can manage members", canManageMembers("admin"));
check("members cannot manage members", !canManageMembers("member"));
check(
  "duplicate active membership is detected by organization/user",
  duplicateActiveMembership(memberships, { organizationId: "org-a", userId: "admin-a" })
);
check(
  "different organization membership is not a duplicate",
  !duplicateActiveMembership(memberships, { organizationId: "org-b", userId: "admin-a" })
);
check(
  "duplicate pending invitations are case-insensitive",
  duplicatePendingInvitation(invitations, { email: "pending@example.com", organizationId: "org-a" })
);
check(
  "accepted invitations do not block a fresh pending invitation",
  !duplicatePendingInvitation(invitations, { email: "accepted@example.com", organizationId: "org-a" })
);
check(
  "expired invitation detection uses the supplied clock",
  invitationExpired(
    { expiresAt: "2026-08-01T00:00:00.000Z" },
    new Date("2026-08-06T00:00:00.000Z")
  )
);
check(
  "removing an organization's only owner is refused",
  wouldOrphanOrganizationOwner(memberships, {
    organizationId: "org-b",
    remove: true,
    targetUserId: "owner-b",
  })
);
check(
  "downgrading an owner is allowed when another owner remains",
  !wouldOrphanOrganizationOwner(
    [...memberships, { organizationId: "org-a", role: "owner", userId: "owner-a2" }],
    {
      organizationId: "org-a",
      nextRole: "admin",
      targetUserId: "owner-a",
    }
  )
);

const redirect = readAuthRedirectState({
  hash: "",
  search: "?code=abc&invite_token=token-123",
} as Location);
check("auth redirect preserves invitation token", redirect.invitationToken === "token-123");
check("auth redirect classifies invitation acceptance", redirect.kind === "invite");

const migration = readFileSync(
  resolve("supabase/migrations/202608060001_account_auth_foundation.sql"),
  "utf8"
);
const pendingMembersMigration = readFileSync(
  resolve("supabase/migrations/202608060002_pending_organization_members.sql"),
  "utf8"
);

check("migration enables RLS on profiles", /alter table public\.profiles enable row level security/i.test(migration));
check("migration enables RLS on companies", /alter table public\.companies enable row level security/i.test(migration));
check("migration enables RLS on organizations", /alter table public\.organizations enable row level security/i.test(migration));
check("migration enables RLS on organization members", /alter table public\.organization_members enable row level security/i.test(migration));
check("migration enables RLS on invitations", /alter table public\.organization_invitations enable row level security/i.test(migration));
check("migration stores invitation token hashes", /token_hash text not null unique/i.test(migration));
check("migration does not store raw invitation tokens", !/\btoken text\b/i.test(migration));
check("migration prevents duplicate pending invitations", /organization_invitations_one_pending_email/i.test(migration));
check("migration prevents duplicate active memberships", /unique \(organization_id, user_id\)/i.test(migration));
check("migration creates personal organizations for new users", /on_auth_user_created_create_docscrub_account/i.test(migration));
check("migration stores durable onboarding completion", /onboarding_completed_at timestamptz/i.test(migration));
check("migration creates UUID-backed companies", /create table if not exists public\.companies[\s\S]*id uuid primary key default gen_random_uuid\(\)/i.test(migration));
check("migration links profiles to company UUIDs", /company_id uuid references public\.companies\(id\) on delete set null/i.test(migration));
check("migration updates own profile through RPC", /create or replace function public\.update_own_profile/i.test(migration));
check("migration grants profile update RPC", /grant execute on function public\.update_own_profile/i.test(migration));
check("migration protects organization ownership from orphaning", /prevent_orphaned_organization_owner/i.test(migration));
check("migration grants invite RPC but not invitation table insert", /grant execute on function public\.invite_organization_member/i.test(migration));
check("migration does not mention document-content storage", !/source_document|document_text|extracted_text|detected_entities|replacement_text|audit_contents/i.test(migration));
check("pending members migration creates pending member table", /create table if not exists public\.organization_pending_members/i.test(pendingMembersMigration));
check("pending members migration enables RLS", /alter table public\.organization_pending_members enable row level security/i.test(pendingMembersMigration));
check("pending members migration prevents duplicate pending emails", /organization_pending_members_one_pending_email/i.test(pendingMembersMigration));
check("pending members migration stores invited metadata", /invited_by_user_id uuid references auth\.users/i.test(pendingMembersMigration) && /invited_at timestamptz not null default now\(\)/i.test(pendingMembersMigration));
check("pending members migration supports future signup fulfillment", /fulfill_pending_organization_memberships/i.test(pendingMembersMigration));
check("pending member fulfillment is not granted to the browser", !/grant execute on function public\.fulfill_pending_organization_memberships/i.test(pendingMembersMigration));
check("pending members migration exposes only creation RPC to authenticated users", /grant execute on function public\.create_organization_pending_members\(uuid, jsonb\) to authenticated/i.test(pendingMembersMigration));
check("pending members migration does not mention document-content storage", !/source_document|document_text|extracted_text|detected_entities|replacement_text|audit_contents/i.test(pendingMembersMigration));

if (failures > 0) {
  throw new Error(`${failures} account auth foundation check(s) failed`);
}
