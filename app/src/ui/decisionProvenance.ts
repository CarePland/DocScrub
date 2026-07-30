/**
 * decisionProvenance.ts — Milestone 3, Phase 4 ("Imported Decision
 * Visibility"). Pulled out of app.ts into its own pure module for the same
 * reason itemCheckQuery.ts was in Milestone 2: non-trivial UI-adjacent
 * logic deserves independent unit-testability without a DOM, per this
 * app's own established precedent (see itemCheckQuery.ts's own doc
 * comment). Remains UI-layer, not domain -- it only INTERPRETS
 * already-computed ReviewSession/CandidateDecision data for display, the
 * same "narrows/labels an already-computed result, never reads or writes
 * ReviewSession" boundary itemCheckQuery.ts's own SCOPE DECISION note
 * describes.
 */

import type { ReviewSession, CandidateDecision } from "../domain/ReviewSession.js";
import { wasEverImported } from "../io/AuditExporter.js";

/** The three states Andrew's Phase 4 instruction names explicitly: a
 *  decision made directly in the current review (never touched by an
 *  import), one still exactly as an import left it, and one that WAS
 *  imported at some point but has since been overridden by a direct
 *  reviewer action. */
export type DecisionProvenance = "reviewer" | "imported" | "imported-then-overridden";

/** `wasEverImported` (reused from AuditExporter.ts, not reimplemented) is
 *  only consulted when the current decision is NOT itself import-sourced --
 *  an unmodified import never needs the full event-log walk to answer
 *  "imported", it already knows from CandidateDecision.source alone. */
export function decisionProvenance(
  session: ReviewSession | null | undefined,
  candidateId: string,
  decided: CandidateDecision | undefined
): DecisionProvenance {
  if (!decided) return "reviewer";
  if (decided.source === "imported") return "imported";
  if (session && wasEverImported(session, candidateId)) return "imported-then-overridden";
  return "reviewer";
}

export function decisionProvenanceSuffix(provenance: DecisionProvenance): string {
  if (provenance === "imported") return " (Imported)";
  if (provenance === "imported-then-overridden") return " (Modified from import)";
  return "";
}
