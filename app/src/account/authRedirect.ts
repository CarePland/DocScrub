export type AuthRedirectKind = "invite" | "oauth" | "passwordRecovery" | "unknown";

export type AuthRedirectState = {
  code: string | null;
  errorDescription: string | null;
  hashAccessToken: string | null;
  hashRefreshToken: string | null;
  invitationToken: string | null;
  kind: AuthRedirectKind;
};

export function readAuthRedirectState(location: Pick<Location, "hash" | "search">): AuthRedirectState {
  const searchParams = new URLSearchParams(location.search);
  const hashParams = new URLSearchParams(location.hash.replace(/^#/, ""));
  const invitationToken =
    searchParams.get("invite_token") ??
    searchParams.get("invitation_token") ??
    hashParams.get("invite_token") ??
    hashParams.get("invitation_token");
  const type = searchParams.get("type") ?? hashParams.get("type") ?? "";
  const code = searchParams.get("code");
  const errorDescription =
    searchParams.get("error_description") ?? hashParams.get("error_description");

  return {
    code,
    errorDescription,
    hashAccessToken: hashParams.get("access_token"),
    hashRefreshToken: hashParams.get("refresh_token"),
    invitationToken,
    kind: invitationToken
      ? "invite"
      : type === "recovery"
        ? "passwordRecovery"
        : code || hashParams.get("access_token")
          ? "oauth"
          : "unknown",
  };
}

export function authRedirectUrl(invitationToken?: string | null): string {
  const url = new URL(window.location.href);
  url.hash = "";
  url.search = "";
  if (invitationToken) {
    url.searchParams.set("invite_token", invitationToken);
  }
  return url.toString();
}

export function clearAuthRedirectUrl(): void {
  const url = new URL(window.location.href);
  let changed = false;

  for (const key of ["code", "error", "error_code", "error_description", "type"]) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  }

  if (url.hash) {
    url.hash = "";
    changed = true;
  }

  if (changed) {
    window.history.replaceState({}, document.title, url.toString());
  }
}
