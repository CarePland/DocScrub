/**
 * SettingsService — architecture v0.2 §6.16 (NEW, ADR-018). Owns thresholds,
 * scoring weights, lexicons, replacement rules, keyboard legend preference,
 * and organization-level configuration, and classifies every setting into
 * one of four trust categories so the "content-derived values must stay
 * local" rule (§7.4) is enforced structurally rather than by policy prose
 * alone.
 */

export type SettingTrustClass =
  | "cloud-syncable"
  | "local-only"
  /** Captured into a session's ScoringProfileSnapshot at scoring time and
   *  not subsequently live-updated for that session, even if the
   *  underlying setting changes later (see domain/ScoringProfileSnapshot.ts). */
  | "session-pinned"
  /** Must never sync regardless of account or organization configuration. */
  | "content-derived-never-sync";

export interface SettingDescriptor<T> {
  key: string;
  trustClass: SettingTrustClass;
  value: T;
}

export interface SettingsService {
  get<T>(key: string): SettingDescriptor<T> | undefined;
  set<T>(key: string, value: T): void;
  /** Every setting this service knows about, for audit/debugging of the
   *  trust boundary itself -- e.g. a startup check that no
   *  content-derived-never-sync setting is reachable by the cloud sync
   *  path. */
  listByTrustClass(trustClass: SettingTrustClass): SettingDescriptor<unknown>[];
}
