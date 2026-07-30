/**
 * ExplanationEngine — architecture v0.2 §6.5. Repositioned in v0.2 from a
 * numbered pipeline stage to a shared, stateless service invoked on demand by
 * the React (here: thin DOM) UI (per candidate, interactively) and by
 * AuditExporter (in batch, for the audit narrative). It must not invent
 * evidence; it only translates a given Evidence[] (wrapped in a richer
 * ExplanationContext -- see Evidence.ts's own doc comment for why) into
 * reviewer- or audit-facing prose.
 *
 * MILESTONE 1, PHASE 1 (2026-07-28): goes from a signature-only stub to a
 * real implementation. All translation logic (dictionary lookup, confidence
 * opener, phrase joining, per-view payload shape) is a direct port of
 * redactor/explanations.py, factored into explanation/explanation-builder.ts
 * as pure functions -- this class is the thin engine wrapper, exactly the
 * same "interface class + pure logic module" split CandidateQualityEngine.ts/
 * quality/scoring.ts already established. See explanation-builder.ts's own
 * doc comment for the interface-signature extension this required
 * (ExplanationContext instead of a bare Evidence[]) and why it is an
 * objective interface defect fix, not a redesign.
 */

import type { Evidence, Explanation, ExplanationContext, ExplanationView } from "../domain/Evidence.js";
import { buildExplanation } from "./explanation/explanation-builder.js";

export interface ExplanationEngine {
  explain(context: ExplanationContext, view: ExplanationView): Explanation;
}

export class DeterministicExplanationEngine implements ExplanationEngine {
  explain(context: ExplanationContext, view: ExplanationView): Explanation {
    return buildExplanation(context, view);
  }
}

// Re-exported so callers that only need the raw evidence type don't have to
// reach into domain/Evidence.js directly for this one type.
export type { Evidence };
