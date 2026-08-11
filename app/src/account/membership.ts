export const ORGANIZATION_ROLES = ["owner", "admin", "member"] as const;

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export type Membership = {
  organizationId: string;
  role: OrganizationRole;
  userId: string;
};

export type Invitation = {
  email: string;
  expiresAt: string;
  organizationId: string;
  role: OrganizationRole;
  status: "pending" | "accepted" | "revoked" | "expired";
};

export type PendingOrganizationMemberInput = {
  email: string;
  displayName?: string;
};

export function normalizeInvitationEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function organizationMemberEmailValid(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeInvitationEmail(email));
}

export function isOrganizationRole(value: string): value is OrganizationRole {
  return ORGANIZATION_ROLES.includes(value as OrganizationRole);
}

export function canManageMembers(role: OrganizationRole | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export function duplicateActiveMembership(
  memberships: readonly Membership[],
  next: Pick<Membership, "organizationId" | "userId">
): boolean {
  return memberships.some(
    (membership) =>
      membership.organizationId === next.organizationId && membership.userId === next.userId
  );
}

export function duplicatePendingInvitation(
  invitations: readonly Invitation[],
  next: Pick<Invitation, "email" | "organizationId">
): boolean {
  const normalizedEmail = normalizeInvitationEmail(next.email);
  return invitations.some(
    (invitation) =>
      invitation.status === "pending" &&
      invitation.organizationId === next.organizationId &&
      normalizeInvitationEmail(invitation.email) === normalizedEmail
  );
}

export function invitationExpired(invitation: Pick<Invitation, "expiresAt">, now = new Date()): boolean {
  const expiresAt = Date.parse(invitation.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= now.getTime();
}

export function usedPendingOrganizationMemberRows(
  rows: readonly PendingOrganizationMemberInput[]
): PendingOrganizationMemberInput[] {
  return rows
    .map((row) => ({
      displayName: row.displayName?.trim() ?? "",
      email: normalizeInvitationEmail(row.email),
    }))
    .filter((row) => row.displayName || row.email);
}

export function pendingOrganizationMemberErrors(
  rows: readonly PendingOrganizationMemberInput[]
): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const row of usedPendingOrganizationMemberRows(rows)) {
    if (!row.email) {
      errors.push("Email is required for each teammate.");
      continue;
    }
    if (!organizationMemberEmailValid(row.email)) {
      errors.push(`Enter a valid email address for ${row.email}.`);
      continue;
    }
    if (seen.has(row.email)) {
      errors.push(`Remove the duplicate email address ${row.email}.`);
      continue;
    }
    seen.add(row.email);
  }

  return errors;
}

export function wouldOrphanOrganizationOwner(
  memberships: readonly Membership[],
  change: {
    organizationId: string;
    targetUserId: string;
    nextRole?: OrganizationRole | null;
    remove?: boolean;
  }
): boolean {
  const ownersAfterChange = memberships.filter((membership) => {
    if (membership.organizationId !== change.organizationId) return false;
    if (membership.userId !== change.targetUserId) return membership.role === "owner";
    if (change.remove) return false;
    return change.nextRole === "owner";
  });

  return ownersAfterChange.length === 0;
}
