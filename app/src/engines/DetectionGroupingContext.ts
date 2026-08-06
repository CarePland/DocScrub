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
import type { SemanticTypeGroup } from "../domain/semanticTypes.js";
import type { RelationshipProposal } from "../domain/StructuralRelationship.js";

export interface DetectionGroupingContext {
  detection: DetectionResult;
  grouping: GroupingResult;
  /**
   * PHASE 2, TYPE CHECK (2026-08-02): the ordered, populated-only semantic
   * type membership the "type-check" stage traverses -- computed ONCE per
   * document load by Workspace (from semanticTypeFor() over the full
   * pipeline facts: detected type + quality categories + structural
   * relationship kinds, which this context deliberately does NOT carry
   * individually) and embedded here as plain membership data, so
   * navigation/stages.ts never needs quality or relationship inputs of its
   * own. OPTIONAL and additive: every pre-existing construction site
   * (parity suites, display-recalculation instances) omits it, and for
   * them the type-check stage simply has no items -- which the conditional
   * workflow derivation (navigation/workflow.ts) then hides, exactly as it
   * hides any other stage with no work.
   */
  semanticTypes?: readonly SemanticTypeGroup[];
  /**
   * REVIEW ARTIFACTS (AG, 2026-08-02): the structural relationship
   * proposals produced once per document load (StructuralRelationshipEngine
   * plus the identity-cleanup pass -- see Workspace.loadDocument()). Carried
   * here because they are REVIEWER WORK: a stage that still has an
   * unaddressed proposal is not done, and the conditional workflow must
   * keep it reachable. Before this, the work model counted candidates
   * only, so a stage could complete and vanish with proposals still on
   * screen (see the 2026-08-02 findings).
   *
   * Plain proposal DATA, exactly as `semanticTypes` above is plain
   * membership data: navigation/stages.ts needs to know which proposals
   * exist and who their members are, never how they were derived. The
   * DISMISSAL state that dissolves a proposal lives in ReviewSession and
   * is read there, not here -- this stays decision-blind like every other
   * context member.
   *
   * OPTIONAL and additive: every pre-existing construction site (parity
   * suites, display-recalculation instances) omits it and simply has no
   * artifacts, which reads as "no outstanding artifact work" -- the same
   * degrade-to-previous-behavior posture `semanticTypes` established.
   */
  structuralRelationships?: readonly RelationshipProposal[];
}
