const LOCAL_SESSION_OWNER_KEY = "docscrub-local-session-owner-id";

export function setLocalSessionOwnerId(userId: string): void {
  try {
    localStorage.setItem(LOCAL_SESSION_OWNER_KEY, userId);
  } catch {
    // Account ownership of local recents is a convenience boundary; storage
    // failure must not block sign-in or local document review.
  }
}

export function clearLocalSessionOwnerId(): void {
  try {
    localStorage.removeItem(LOCAL_SESSION_OWNER_KEY);
  } catch {
    // Best effort only.
  }
}

export function currentLocalSessionOwnerId(): string | null {
  try {
    const value = localStorage.getItem(LOCAL_SESSION_OWNER_KEY);
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
}
