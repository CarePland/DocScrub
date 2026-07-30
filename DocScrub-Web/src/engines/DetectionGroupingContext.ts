/**
 * DetectionGroupingContext -- the read-only, already-computed
 * DetectionEngine + EntityResolutionEngine output a reducer or query needs
 * to validate a candidateId/groupId against, or look up a proposed group's
 * membership from. Both consumers only ever read this; neither owns or
 * mutates it (DetectionEngine/EntityResolutionEngine remain the sole
 * producers -- see Workspace.ts's own "does not reimplement anything any
 * engine already owns" doc comment).
 *
 * ARCHITECTURAL CLEANUP (2026-07-29): this exact `{detection, grouping}`
 * shape was independently declared twice, byte-for-byte identical --
 * `StageContext` (engines/navigation/stages.ts) and `ReviewContext`
 * (engines/review/session.ts) -- confirmed by direct inspection, not
 * assumed. Neither name survives; both files, `engines/ReviewEngine.ts`,
 * and `engines/navigation/navigator.ts` (whose own `NavigationContext`
 * still layers `classification` on top for its additional occurrence-lookup
 * needs) now import this one type instead. Type-level only: no runtime
 * object, no behavior change, nothing here is constructed or injected --
 * see Andrew's own instruction that this is a type-level unification, not
 * a dependency-injection boundary.
 */

import type { DetectionResult } from "./DetectionEngine.js";
import type { GroupingResult } from "./EntityResolutionEngine.js";

export interface DetectionGroupingContext {
  detection: DetectionResult;
  grouping: GroupingResult;
}
