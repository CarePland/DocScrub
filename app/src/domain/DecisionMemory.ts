/**
 * DecisionMemory — "review once, apply everywhere" made automatic across
 * documents in the same browser (AG, 2026-08-03).
 *
 * THE PROBLEM IT SOLVES. A reviewer who corrects "Tanesha Can Collier" to
 * "Tanesha Collier" in one document had to make that same correction again
 * in the next one. Feature 002 (DecisionReuse.ts) already carried decisions
 * ACROSS documents, including the reviewer's own replacement text -- but
 * only through an explicit export-a-file / import-a-file round trip. This
 * artifact is the small amount of state needed to do that automatically.
 *
 * NO RULE INFERENCE, DELIBERATELY. This does NOT try to learn what an edit
 * MEANT -- not "drop middle names", not "the detector over-captured", not
 * any pattern generalized from the shape of the change. AG's own framing
 * (2026-08-03): the stray word in "Tanesha Can Collier" was incidental and
 * "that's not guaranteed in future edits," so inferring a transformation
 * rule from one example would be inventing a claim the reviewer never made.
 * What is stored is only the literal outcome, keyed by the candidate key --
 * a `normalizeCandidate()` output like "person:tanesha can collier", which
 * is a pure function of normalized text + detected type. Replaying that on
 * an EXACT key match asserts nothing beyond "you decided this exact thing
 * before." Every interpretive tier stays behind the explicit file import
 * where the reviewer opted in (see Workspace.applyRememberedDecisions()).
 *
 * WHY ITS OWN ARTIFACT, NOT A FIELD ON ReviewSession. Exactly the
 * FocusResumePosition precedent (see that file's top doc comment):
 * independently versioned, stored as a sibling rather than inside
 * ReviewSession's own schema ladder, and degrading to "no memory at all"
 * when absent or unreadable. Two concrete payoffs: ReviewSession's
 * correctness-bearing schema does not churn for a convenience feature, and
 * the day this becomes user-scoped rather than browser-scoped, the change
 * is a different STORAGE KEY rather than a ReviewSession migration.
 *
 * WHY ITS OWN OBJECT STORE. A SessionRecord carries the original document's
 * `fileBytes`, so deriving this from stored sessions would mean
 * deserializing every prior document's full bytes to answer "what have I
 * decided before" -- on every load. The projection below is a few hundred
 * bytes per document. Same reasoning that already keeps `PersistedUiState`
 * out of SessionRecord.
 *
 * TRUST BOUNDARY -- READ BEFORE MAKING THIS USER-SCOPED. Candidate keys ARE
 * normalized document text, and replacements are operator-authored content
 * about real people. Under SettingsService's trust classes (ADR-018 §7.4)
 * this artifact is `content-derived-never-sync`: it may live on the
 * reviewer's own machine, but it must never be synced to an account or an
 * organization. A "user memory profile" that crosses machines is therefore
 * NOT a storage-key change alone -- it is a policy decision about moving
 * content-derived data off-device, and this comment exists so that question
 * gets asked deliberately rather than discovered late.
 */

import type { ImportedCandidateDecision, ImportedDecisions } from "./DecisionReuse.js";
import type { ReviewSession } from "./ReviewSession.js";

export const DECISION_MEMORY_SCHEMA_VERSION = 1 as const;

/** One document's contribution to the memory. Only DECIDED candidates
 *  appear -- an undecided candidate is not something to remember. */
export interface DecisionMemoryRecord {
  schemaVersion: typeof DECISION_MEMORY_SCHEMA_VERSION;
  documentId: string;
  sessionId: string;
  /** When this projection was taken -- used to break ties when the same
   *  candidate key was decided differently in two documents. */
  updatedAt: string;
  entries: ImportedCandidateDecision[];
}

/**
 * Project a session's decided candidates into the memory shape.
 *
 * Derived fresh from `candidateDecisions` on every save rather than
 * maintained incrementally, per this repo's standing "derive, don't
 * duplicate" rule: an incrementally-updated memory is one more thing that
 * can silently disagree with the decisions it claims to describe, and
 * re-projecting a few hundred entries costs nothing next to the autosave
 * write it rides along with.
 *
 * Note the entries are `ImportedCandidateDecision` -- the SAME type a
 * decisions.json import produces. That is what lets the existing
 * DecisionReuseEngine consume this with no changes at all.
 */
export function projectDecisionMemory(session: ReviewSession, documentId: string, updatedAt: string): DecisionMemoryRecord {
  const entries: ImportedCandidateDecision[] = [];
  for (const decision of Object.values(session.candidateDecisions)) {
    entries.push({
      candidateId: decision.candidateId,
      decision: decision.decision,
      ...(decision.replacement !== undefined ? { replacement: decision.replacement } : {}),
      decidedAt: decision.decidedAt,
    });
  }
  return { schemaVersion: DECISION_MEMORY_SCHEMA_VERSION, documentId, sessionId: session.sessionId, updatedAt, entries };
}

/**
 * Collapse many documents' memories into the single `ImportedDecisions`
 * bundle the reuse engine already accepts.
 *
 * CONFLICTS: the same candidate key can have been decided differently in
 * two documents (the reviewer changed their mind, or context differed).
 * MOST RECENT WINS, by the entry's own `decidedAt` -- the reviewer's latest
 * expressed intent is the best available answer, and it is the same
 * "single current value, last write wins" rule `CandidateDecision` itself
 * follows within a session. Ties fall back to the record's `updatedAt` so
 * the outcome is deterministic rather than dependent on store iteration
 * order.
 *
 * The synthetic documentId/sessionId are honest placeholders: this bundle
 * is an aggregate over many prior reviews, not a copy of any one of them,
 * and `ImportedDecisions.documentId` is explicitly documented as
 * traceability context that is never used as a validation gate.
 * `entityGroups`/`ambiguityResolutions` are deliberately empty -- those are
 * document-structural, not portable facts about a name.
 */
export function mergeDecisionMemory(records: readonly DecisionMemoryRecord[]): ImportedDecisions {
  const best = new Map<string, { entry: ImportedCandidateDecision; at: string }>();
  for (const record of records) {
    for (const entry of record.entries) {
      const at = entry.decidedAt ?? record.updatedAt;
      const existing = best.get(entry.candidateId);
      if (!existing || at > existing.at) best.set(entry.candidateId, { entry, at });
    }
  }
  return {
    schemaVersion: DECISION_MEMORY_SCHEMA_VERSION,
    documentId: "decision-memory",
    sessionId: "decision-memory",
    candidates: [...best.values()].map((v) => v.entry),
    entityGroups: [],
    ambiguityResolutions: [],
  };
}

/** Structural check for a value read back out of storage -- the same
 *  defensive posture every other persisted artifact here takes, so a
 *  corrupt or older-shaped record degrades to "no memory" rather than
 *  throwing on a load path. */
export function isValidDecisionMemoryRecord(value: unknown): value is DecisionMemoryRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record["schemaVersion"] !== DECISION_MEMORY_SCHEMA_VERSION) return false;
  if (typeof record["documentId"] !== "string" || typeof record["sessionId"] !== "string") return false;
  if (typeof record["updatedAt"] !== "string") return false;
  const entries = record["entries"];
  if (!Array.isArray(entries)) return false;
  return entries.every((entry) => {
    if (typeof entry !== "object" || entry === null) return false;
    const e = entry as Record<string, unknown>;
    return typeof e["candidateId"] === "string" && typeof e["decision"] === "string";
  });
}
