/**
 * ScoringProfileSnapshot — pins the weights/thresholds/versions in effect at
 * the moment a session was scored, so a later configuration change cannot
 * silently alter an already-scored session's Likelihood or explanation.
 *
 * NEW in architecture v0.2 (ADR-015, Required). See §6.4, §7.2. This is the
 * direct fix for the ARB finding that §4.2's "every recommendation must be
 * traceable to structured evidence" principle had no mechanism preventing
 * live settings drift from invalidating historical explanations.
 */

export const SCORING_PROFILE_SNAPSHOT_SCHEMA_VERSION = 1 as const;

export interface ScoringProfileSnapshot {
  schemaVersion: typeof SCORING_PROFILE_SNAPSHOT_SCHEMA_VERSION;
  /** Identifies which named scoring profile was in effect (e.g. an org's
   *  configured profile, or "default"). */
  profileId: string;
  profileVersion: string;
  /** Serializable scoring weights, keyed by evidence category -- must be
   *  enough to reproduce scoreByCandidate in QualityResult from Evidence[]. */
  weights: Record<string, number>;
  thresholds: Record<string, number>;
  detectorRulesetVersion: string;
  /** Version identifiers or content hashes for every lexicon file that
   *  contributed evidence (see config/lexical_evidence/* in the current
   *  Python app) so a lexicon edit is also reproducible/attributable. */
  lexiconVersions: Record<string, string>;
  applicationVersion: string;
  scoringTimestamp: string; // ISO 8601
}

/**
 * A deliberate rescan under new rules produces a new ProcessingRevision
 * rather than overwriting scoringProfile on the existing one -- see §6.4.
 */
export interface ProcessingRevision {
  revisionId: string;
  createdAt: string; // ISO 8601
  scoringProfile: ScoringProfileSnapshot;
  /** Why this revision exists -- required whenever revisionId is not the
   *  first revision for a session, so silent behavior drift is never
   *  possible without an explicit, recorded reason (see architecture v0.2 §13,
   *  "Intentional deviations must be approved and recorded"). */
  reason?: string;
}
