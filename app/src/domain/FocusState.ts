/**
 * FocusState — the transient interaction-focus domain model owned by
 * FocusNavigator (architecture v0.2 §6.9, ADR-014). Lives in src/domain/
 * (not src/engines/) for the same reason NotQuite.ts and ReviewSession.ts
 * do: Commands.ts needs to reference WorkflowStage, and domain types must
 * not depend on engine implementation files.
 *
 * ORACLE-GROUNDED STAGE MODEL (Phase 9): local_web_app.py's actual UI has
 * FOUR collapsible review sections in this document order: "Ambiguity
 * Check" (`#ambiguousResolution`), "Group Check" (`#entityResolution`),
 * "Category Check" (`#qualityPanel`, a quality-bucket-filtered view), and
 * an untitled "Results" section (`#review-section`, the exhaustive
 * per-candidate list) -- plus a post-generation "QA metrics" artifact and
 * final "Output" downloads, neither of which is an interactive per-item
 * review surface in the current product (confirmed: no `<details>` panel,
 * no keyboard handling, no item traversal for either -- `qa_metrics_json`
 * and the redacted docx/audit CSV/decisions JSON are simply generated
 * files listed after generation completes).
 *
 * Andrew's Phase 9 instruction lists five canonical stage names (Ambiguity
 * Check, Group Check, Item Check, QA, Output). Reconciling that vocabulary
 * with the actual Python UI: "Item Check" here covers BOTH "Category
 * Check" and "Results" -- they operate on the exact same underlying unit
 * (one `CandidateDecision` per candidate, resolved via the identical
 * `update_decision()`/`ACTION_TO_DECISION` path Ambiguity Check also uses),
 * differing only in which SUBSET of candidates is displayed (a quality-
 * bucket filter vs. the exhaustive list), not in navigation or decision
 * semantics. Collapsing them avoids inventing a fourth distinct stage for
 * what is really one filtered view of another -- see
 * docs/detection/phase-9-findings.md for the full reconciliation record.
 * QA and Output are modeled as real stages (per Andrew's explicit list)
 * but, matching their current lack of any interactive item model in
 * Python, have no traversable item list -- see StageStatus below.
 *
 * CONFIRMED FINDING: Ambiguity Check has NO separate resolution mechanism
 * of its own -- `update_ambiguous_match()` in local_web_app.py just calls
 * the same `update_decision()` any other candidate decision uses. There is
 * no Python behavior corresponding to "explicitly pick which proposed
 * group this candidate belongs to" as a distinct durable fact. This means
 * `ReviewSession.ambiguityResolutions` (added in an earlier ARB pass)
 * still has no real Python behavior to populate it from -- left
 * unpopulated this phase too (already noted as deferred in
 * phase-8-findings.md), and Ambiguity Check's FocusNavigator traversal
 * uses the SAME "does this candidate have any CandidateDecision yet"
 * resolved-check that Item Check uses, not a separate ambiguity-specific
 * resolution.
 */

/**
 * PHASE 2, TYPE CHECK (AG, 2026-08-02): "type-check" joins the union as a
 * FIRST-CLASS stage between group-check and item-check -- "Import →
 * Ambiguity Check → Group Check → Type Check → Item Check → QA → Output".
 * Its traversal units are SEMANTIC TYPE ids (domain/semanticTypes.ts's
 * SemanticTypeId values), not candidateIds -- see
 * navigation/stages.ts's "type-check" cases. A type is resolved when
 * every member candidate is resolved through the EXISTING candidate
 * decision pipeline (the same candidateResolvedStatus rule item-check
 * uses) -- no type-level durable decision exists, deliberately: type
 * review is a batched way of applying ordinary candidate decisions, so
 * audit and session schemas are untouched. Additive for saved
 * FocusResumePosition values: old saves name only the old five stages
 * and restore unchanged; a save naming "type-check" simply resumes there.
 */
export type WorkflowStage = "ambiguity-check" | "group-check" | "type-check" | "item-check" | "qa" | "output";

/** Canonical stage order -- matches the real product's top-to-bottom
 *  document order (Ambiguity Check, Group Check, then the folded
 *  Category-Check-plus-Results "Item Check"), with QA/Output appended as
 *  the post-generation stages Andrew's instruction asks to represent, and
 *  (Phase 2, 2026-08-02) Type Check inserted between Group Check and Item
 *  Check per Andrew's explicit workflow. Not a wizard: `moveStage`/
 *  `focusStage` can move to ANY stage in either direction regardless of
 *  completion -- see FocusNavigator.ts. NOTE (conditional workflow, same
 *  authorization): this is the CANONICAL order, not the VISIBLE workflow --
 *  the active workflow a reviewer sees and traverses is derived from this
 *  order by navigation/workflow.ts's activeWorkflowStages(), which drops
 *  stages that currently contain no reviewable work. */
export const WORKFLOW_STAGE_ORDER: readonly WorkflowStage[] = ["ambiguity-check", "group-check", "type-check", "item-check", "qa", "output"];

export type FocusPanel =
  | { kind: "none" }
  | {
      kind: "not-quite";
      groupId: string;
      /** Mirrors (never duplicates -- see reconcile()) ReviewSession
       *  .activeNotQuite.activeMemberId at the moment this FocusState was
       *  last reconciled. */
      activeMemberId: string | null;
    };

/**
 * A focus target names WHERE interaction focus is, using stable domain
 * IDs rather than array positions -- Andrew's explicit "prefer stable
 * domain IDs over positional identity" requirement. `itemId` is a
 * candidateId for ambiguity-check/item-check, a groupId for group-check,
 * a SemanticTypeId for type-check (Phase 2 -- the stage's traversal units
 * are types, not candidates), and always null for qa/output (no
 * item-level model exists for either today -- see this file's top doc
 * comment).
 */
export interface FocusTarget {
  stage: WorkflowStage;
  itemId: string | null;
  /** Set only once the reviewer has drilled into a specific occurrence
   *  within the focused candidate (Andrew's explicit "occurrence"
   *  focus-target dimension) -- e.g. jump-to-source. Cleared by
   *  `closeItem`. Only meaningful when stage is "item-check" or
   *  "ambiguity-check" and itemId is a candidateId. */
  occurrenceId?: string;
  panel: FocusPanel;
}

export interface FocusState {
  target: FocusTarget;
  /** True while focus is inside an editable text control (a rename/redact
   *  replacement field, a Not Quite draft field) -- arrow keys/shortcut
   *  letters must not be interpreted as navigation/decision commands in
   *  this mode. Matches architecture v0.2 §13.2's "text-field caret
   *  ownership." */
  textInputActive: boolean;
}

export type StageCompletionStatus = "empty" | "unresolved" | "complete";

/**
 * Stage availability/completion, computed fresh from (DetectionResult,
 * GroupingResult, ReviewSession) every time -- never stored, so it cannot
 * drift out of sync with the durable decisions that determine it. Kept
 * separate from FocusState per Andrew's explicit "represent stage
 * availability and completion separately from current focus."
 */
export interface StageStatus {
  stage: WorkflowStage;
  /** Whether this stage currently has a traversable item list at all
   *  (false for qa/output, and for ambiguity-check/group-check when there
   *  are zero proposals of that kind -- an empty stage can still be
   *  `available`, just with nothing to traverse). */
  hasItems: boolean;
  /** Whether it is currently meaningful to work in this stage --
   *  distinct from `hasItems`/`completion` per Andrew's explicit
   *  "represent stage availability and completion separately from
   *  current focus." Ambiguity/Group/Item Check are always available (a
   *  reviewer can always inspect or work on them). QA/Output become
   *  available once Item Check's completion is "complete" -- an echo of
   *  Python's real generation gate (`generate_outputs()` refuses to run
   *  while any candidate still needs an individual decision), scaled to
   *  what this schema actually tracks (we do not carry Python's
   *  `Decision.REVIEW` state -- see phase-8-findings.md -- so this checks
   *  ordinary unresolved-candidate completion instead). Informational
   *  only: `moveStage`/`focusStage` never refuse to navigate to an
   *  unavailable stage, per "do not invent wizard-style progression."
   *
   *  REVISED (AG, 2026-08-02): QA/Output now become available once NO
   *  work stage has outstanding work of ANY kind -- items or review
   *  artifacts -- rather than keying on Item Check's candidates alone.
   *  The old rule was a second, narrower definition of "review is done"
   *  sitting beside the workflow's own; a document could reach Output
   *  with an unaddressed structural proposal because that rule could not
   *  see one. One definition now answers availability, membership, and
   *  completion. In practice this changes nothing for candidate-only
   *  documents (the other work stages resolve as their members do). */
  available: boolean;
  completion: StageCompletionStatus;
  itemCount: number;
  unresolvedCount: number;
  /**
   * REVIEW ARTIFACTS (AG, 2026-08-02): outstanding reviewer work that is
   * NOT a traversable item. Today: the structural relationship proposals
   * the Ambiguity Check stage presents alongside its candidate rows.
   *
   * Deliberately counted SEPARATELY from `itemCount`/`unresolvedCount`
   * rather than folded into them. Those two mean "traversable items" to
   * every existing consumer -- the navigator walks exactly `itemCount`
   * things, and Workspace derives `reviewedCandidateCount` as
   * `totalCandidateCount - unresolvedCount`. Widening them in place would
   * have silently corrupted that arithmetic. Separate fields let the
   * workflow ask "is there ANY work here" (the single membership rule in
   * navigation/workflow.ts) without changing what an item is.
   *
   * A future artifact kind joins by extending the two switches in
   * navigation/stages.ts (`reviewArtifactIdsForStage` /
   * `isArtifactResolved`) -- the same shape, and the same one place, as
   * `itemIdsForStage`/`isItemResolved`. Nothing downstream needs to know
   * the kind.
   */
  artifactCount: number;
  unresolvedArtifactCount: number;
}
