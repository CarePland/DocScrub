/**
 * localSessionOwner.ts -- browser-local ownership boundary for stored
 * sessions. Account-aware ownership is intentionally nullable here: when
 * no signed-in owner is available, records remain local/unowned and the
 * repository shows only other unowned records. This preserves the existing
 * one-reviewer local workflow while giving IndexedDB a narrow extension
 * point for account-backed sessions.
 */

export function currentLocalSessionOwnerId(): string | null {
  return null;
}
