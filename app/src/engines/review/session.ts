/**
 * session.ts -- the ReviewEngine reducer. Pure, synchronous transitions over
 * ReviewSession (architecture v0.2 §7.2/§6.8). No I/O, no Date.now() calls
 * buried inside -- every transition takes `now` explicitly so the whole
 * reducer stays deterministic and directly testable (see verify/
 * review-engine-verification.ts).
 *
 * ORACLE GROUNDING (Phase 8): the Python application has no single clean
 * "ReviewEngine" module -- decision recording is spread across
 * redactor/models.py (Decision/OccurrenceDecision/CandidateDecision),
 * redactor/decisions.py (build_default_decisions/decisions_to_json/
 * decisions_from_json/save_decisions/load_decisions), redactor/
 * review_queue.py (ACTION_TO_DECISION/DECISION_TO_ACTION vocabulary --
 * navigation-specific functions in that file are Phase 9/FocusNavigator's
 * concern, not ported here), and local_web_app.py's update_decision()/
 * update_entity_group() HTTP handlers (which mix real domain logic with
 * Flask/UI plumbing). Every behavioral claim below cites which of those was
 * read directly, not inferred.
 *
 * WHAT WAS DELIBERATELY NOT PORTED, and why:
 * - `Decision.REVIEW` ("Review Individually") and per-occurrence
 *   `OccurrenceDecision`/`occurrence_decisions`: real fields in Python's
 *   data model, consumed by redactor/docx_writer.py and redactor/audit.py,
 *   but confirmed via exhaustive grep to be NEVER set by local_web_app.py's
 *   actual UI (no `action: "Review"` request anywhere, no per-occurrence
 *   decision endpoint) -- i.e. a real capability in the domain model that
 *   the shipped product does not currently expose. Andrew's Phase 8
 *   instruction's own minimum bar (Keep/Rename/Redact/Ignore/Not Quite) does
 *   not include it either, and the already-ARB-reviewed CandidateDecision
 *   schema (ReviewSession.ts, ADR-008) has no field for it. Porting it now
 *   would be exactly the "premature generalized infrastructure" Andrew's
 *   standing constraints warn against, for a workflow the real product
 *   doesn't use. If a future phase needs it (e.g. DocumentRebuilder wiring),
 *   it can be added additively then, following the same interface-defect-fix
 *   precedent used repeatedly in this migration.
 * - Group-level bulk actions ("Flatten"/"Keep as-is"/"Redact"/"Ignore"/
 *   "Skip" applied to a whole proposed entity group at once, and
 *   entity_group_exclusions' per-member "exclude this candidate from the
 *   group" mechanic) from local_web_app.py's update_entity_group(): real
 *   Python behavior, but inherently tied to the Group Check UI surface --
 *   deferred to Gate C's FocusNavigator/Workspace phases (Phase 9/10) per
 *   Andrew's own explicit Model/Interaction/Interface phase boundary. The
 *   EntityGroupDecision/AmbiguityResolution schema fields exist (ADR-008)
 *   and completeNotQuite() below DOES populate EntityGroupDecision (as
 *   "Refined") -- only the *other* group-level actions were deferred.
 *   **Feature 001 (first post-migration feature) closes this deferral**:
 *   confirmGroup/rejectGroup/flattenGroup below implemented the "Keep
 *   as-is"/"Skip"/"Flatten" vocabulary against the same EntityGroupDecision
 *   schema completeNotQuite already uses. **v9 terminology revision
 *   (Commands.ts) corrects that account**: Feature 001's three-operation
 *   scope was never a deliberate narrowing of Python's five-way vocabulary
 *   -- it was Andrew's own attempt at a standardized, transferable term set
 *   across every review surface, which broke down because "Flatten" reads
 *   as meaningless for a single-member group. redactGroup/ignoreGroup below
 *   fill the two gaps (using the exact same bulk decideCandidate() pattern
 *   confirmGroup/flattenGroup already established), and rejectGroup is
 *   removed -- it has no counterpart in the corrected vocabulary (Rename/
 *   Keep-as-is/Redact/Ignore/Not Quite) and no Python precedent.
 *
 *   **Feature 002 (Decision Reuse -- "Review once. Apply everywhere.") adds
 *   applyDecisionReuse**: bulk-applies an ALREADY-COMPUTED batch of
 *   DecisionReuseProposal (see DecisionReuseEngine.ts for how that batch is
 *   computed -- entirely outside this reducer) via the same decideCandidate()
 *   helper every other command uses, tagged with source "imported" and the
 *   proposal's own evidence. The one new rule this case introduces, not
 *   present anywhere else in this file: it NEVER overwrites a candidate that
 *   already has ANY decision, reviewer- or import-sourced. Every other
 *   command in this file intentionally DOES overwrite (Rename supersedes
 *   Keep, Flatten overwrites a prior manual Redact, etc. -- "whichever
 *   decision was dispatched most recently... simply IS its current
 *   decision," per this file's own note below) because those are all direct,
 *   deliberate reviewer actions. An import is passive and automatic by
 *   comparison -- Andrew's instruction is explicit that "the reviewer should
 *   never lose control," and silently replacing a decision the reviewer (or
 *   an earlier import pass) already made would do exactly that. Import
 *   fills gaps in undecided candidates; it does not contest existing state.
 *
 * WHAT WAS PORTED, confirmed against Python source directly:
 * - Per-candidate decisions (Keep/Rename/Redact/Ignore) are a single
 *   current value, not an accumulating log -- dispatching a new decision
 *   for a candidate REPLACES whatever was there before. This is exactly
 *   how local_web_app.py's update_decision() works (`decision.decision =
 *   ACTION_TO_DECISION.get(action, decision.decision)` -- a plain
 *   overwrite) and is the actual mechanism behind Andrew's "Rename
 *   supersedes Keep": there is no separate precedence table anywhere:
 *   whichever decision was dispatched most recently for a candidate simply
 *   IS its current decision.
 * - "Not Quite" does NOT touch any candidate's decision by itself --
 *   confirmed by tests/test_local_web_app_modes.py's
 *   test_not_quite_marks_proposal_without_hiding_members, which asserts
 *   both candidates remain Decision.UNDECIDED after a bare "Not Quite"
 *   action, and that resolution_routes() still surfaces the group
 *   afterward. This is the literal mechanism behind "Not Quite
 *   intentionally preserves unresolved work."
 * - Per-member decisions inside a Not Quite panel (Python's
 *   completeNotQuiteMember) apply IMMEDIATELY via the same underlying
 *   decision-update path an ordinary Keep/Rename/Redact/Ignore command
 *   uses (confirmed: completeNotQuiteMember's client JS posts straight to
 *   the same /api/decision endpoint update_decision() serves) -- not
 *   staged/deferred until group completion. applyNotQuiteMember() below
 *   reuses the exact same `decideCandidate()` helper the direct per-
 *   candidate commands use, rather than a parallel code path, so this
 *   can't drift.
 * - "Not Quite Complete" does NOT require every member to have been
 *   individually decided first, and does NOT itself decide anything --
 *   confirmed by tests/test_local_web_app_modes.py's
 *   test_not_quite_complete_requires_explicit_stage_completion, which
 *   calls update_decision() directly for both candidates (bypassing any
 *   per-member Not-Quite path entirely), then fires "Not Quite Complete",
 *   and asserts both candidates' decisions are UNCHANGED (Keep stays Keep,
 *   Rename stays Rename) while the group stops being re-proposed
 *   (`resolution_routes()[0] == []`). completeNotQuite() below matches
 *   this exactly: it does not require `allMembersHandled`, and does not
 *   force-decide any member -- it only stamps canonical group membership
 *   (mirrors Python's `canonical_group_id = f"entity:{group_id}"` being
 *   applied to every member regardless of decision status) and records
 *   the group-level event.
 *
 * MILESTONE 2 ("Review at Scale") adds bulkApplyDecision: Item Check's
 * multi-select bulk actions, generalizing Feature 001's group-level bulk
 * commands (Confirm/Reject/Flatten Group) from a group's fixed membership
 * to an arbitrary reviewer-selected candidateId list. Same decideCandidate()
 * helper, same plain-overwrite semantics as every direct per-candidate
 * command (unlike applyDecisionReuse, this DOES overwrite existing
 * decisions -- it is a direct reviewer action, not a passive import). See
 * this case's own comment below and
 * docs/detection/milestone-2-review-at-scale.md.
 *
 * APPROVED DEVIATION: entering Not Quite for a different group while one
 * is already open is REJECTED here, not silently swapped. Python's client
 * JS (`enterNotQuite`) just does `notQuiteGroups.clear(); notQuiteGroups.
 * add(group.id)`, silently discarding any in-progress (but not yet
 * individually-decided) work in the previously open panel. Since
 * ReviewEngine is the durable-state authority (not a disposable UI
 * component), and Andrew's instruction explicitly asks to avoid "implicit
 * precedence rules hidden inside UI code," this makes the constraint
 * explicit and rejects the command with a reason instead of silently
 * losing state. Any actual per-candidate decisions already applied via
 * applyNotQuiteMember are unaffected either way (they're durable the
 * moment they're dispatched, in both Python and here).
 *
 * AMBIGUITY CHECK CORRECTION (v10, 2026-07-28) adds linkAmbiguousCandidate:
 * the first command ever to write to `ambiguityResolutions`, dormant since
 * ADR-008/Phase 8 (see Commands.ts's v10 note and resolution.ts's top doc
 * comment for the full defect trace this closes). Deliberately applies
 * Keep, not Rename -- linking identity is not the same act as rewriting
 * surface text, and conflating them would silently change what "Keep"
 * means for every other candidate in this reducer.
 *
 * ARCHITECTURAL CLEANUP (2026-07-29): confirmGroup/redactGroup/ignoreGroup/
 * flattenGroup/bulkApplyDecision/applyDecisionReuse independently hand-rolled
 * the identical shape -- iterate candidateIds, decideCandidate() each,
 * append one candidate-decided event each, optionally stamp an
 * EntityGroupDecision, append one closing summary event -- confirmed by
 * direct inspection, not assumed. The Review Workspace Specification's own
 * Design Principle #4 ("review once, apply everywhere... group-level bulk
 * actions and Item Check's bulk multi-select are the same idea at different
 * granularities") already named these as one concept; `applyDecisionBatch()`
 * below is the one place that idea now lives in code, not just in six
 * independent copies of it.
 *
 * `applyDecisionReuse` was the one operation that did NOT fit by simply
 * mapping candidateIds to a single shared decision: each proposal carries
 * its OWN decision/replacement/evidence, and it alone never overwrites an
 * existing decision. `DecisionBatchItem` accommodates this by carrying
 * decision/replacement/source/importEvidence PER ITEM (trivial to supply --
 * the five single-decision operations just map every candidateId to the
 * same `{candidateId, decision}` shape); `overwrite` is the one caller-level
 * policy switch, exactly as varied before this change. Group-level stamping
 * (`groupStamp`) and each operation's own per-candidate event fields
 * (`eventPayloadExtra`) remain narrow, explicit, per-call inputs -- not a
 * generic options bag guessed at in advance, but the specific handful of
 * axes direct inspection of all six call sites showed genuinely vary.
 * See `applyDecisionBatch()`'s own doc comment below for the full contract.
 */

import type { Candidate } from "../../domain/DocumentModel.js";
import type {
  CandidateDecision,
  CandidateDecisionKind,
  CandidateDecisionSource,
  EntityGroupDecision,
  ReviewEvent,
  ReviewEventKind,
  ReviewSession,
} from "../../domain/ReviewSession.js";
import { EMPTY_ENTITY_REGISTRY, applyEntityAcknowledgement, detachCandidate } from "../../domain/EntityRegistry.js";
import type { DecisionReuseEvidence } from "../../domain/DecisionReuse.js";
import type { NotQuiteMemberState, NotQuiteState } from "../../domain/NotQuite.js";
import type { ReviewCommand, ReviewTransactionResult } from "../../domain/Commands.js";
import type { DetectionResult } from "../DetectionEngine.js";
import type { EntityGroupProposal } from "../EntityResolutionEngine.js";
import type { DetectionGroupingContext } from "../DetectionGroupingContext.js";

export interface ReviewDispatchOutcome {
  session: ReviewSession;
  result: ReviewTransactionResult;
}

function fail(session: ReviewSession, reason: string): ReviewDispatchOutcome {
  return { session, result: { ok: false, reason } };
}

function ok(session: ReviewSession): ReviewDispatchOutcome {
  return { session, result: { ok: true } };
}

/** Deterministic, sequential event IDs -- matches the established
 *  convention elsewhere in this codebase (e.g. occurrence-index numbering)
 *  of simple, reproducible identifiers rather than random UUIDs. Scoped to
 *  the session's own event count so IDs stay stable across a
 *  serialize/deserialize round-trip regardless of process-lifetime state,
 *  with no mutable module-level counter to drift out of sync. */
function nextEventId(session: ReviewSession): string {
  return `review-event-${session.events.length + 1}`;
}

function appendEvent(session: ReviewSession, kind: ReviewEventKind, now: string, payload: Record<string, string | number | boolean>): ReviewEvent[] {
  const event: ReviewEvent = { id: nextEventId(session), kind, at: now, payload };
  return [...session.events, event];
}

function findCandidate(detection: DetectionResult, candidateId: string): Candidate | undefined {
  return detection.candidates.find((c) => c.id === candidateId);
}

/** Shared entry-point validation for all three group-level bulk commands:
 *  the group must exist, and a Not Quite transaction must not currently be
 *  open for THIS group (mirrors enterNotQuite's own "don't silently clobber
 *  in-progress panel state" rule, scoped to the target group only -- a bulk
 *  action on a DIFFERENT group while Not Quite is open elsewhere is fine,
 *  matching how Python's own group-level keyboard shortcuts resolve
 *  per-group, not globally). */
function validateGroupBulkCommand(
  session: ReviewSession,
  context: DetectionGroupingContext,
  groupId: string
): { ok: true; group: EntityGroupProposal } | { ok: false; reason: string } {
  const group = context.grouping.entityGroupProposals.find((g) => g.groupId === groupId);
  if (!group) return { ok: false, reason: `no such entity group: ${groupId}` };
  if (session.activeNotQuite && session.activeNotQuite.groupId === groupId) {
    return { ok: false, reason: "Not Quite is open for this group; exit or complete it first" };
  }
  return { ok: true, group };
}

/**
 * Shared candidate-decision transition used by BOTH the direct per-
 * candidate commands (keepCandidate/renameCandidate/redactCandidate/
 * ignoreCandidate) and applyNotQuiteMember, so the two paths cannot drift
 * apart -- see this file's top doc comment on Python's completeNotQuiteMember
 * using the exact same underlying update path as a direct decision.
 *
 * ENTITY/DECISION SEPARATION (schema v2): this is also the one place
 * entityRegistry is maintained -- every command in this reducer already
 * funnels through decideCandidate(), so this is the least invasive
 * integration point, requiring no new command and no parallel state
 * machine (see EntityRegistry.ts's own doc comment on why this file, not a
 * second engine, owns that call). `groupId`, when the caller has one (the
 * four group-bulk commands, applyNotQuiteMember, linkAmbiguousCandidate),
 * is the anchor every member of that proposed entity group shares -- one
 * EntityId for the whole group, not one per member. Direct per-candidate
 * commands, bulkApplyDecision (an arbitrary, not-necessarily-one-entity
 * selection), and applyDecisionReuse (each proposal already carries its
 * own independently-matched candidateId) omit it, so the candidate is its
 * own anchor -- a singleton entity.
 *
 * OPTIONS BAG (2026-08-06): the optional tail (groupId/source/
 * importEvidence, now joined by `rationale`) moved from four positional
 * parameters into one object. At four optionals a caller supplying only the
 * last one reads `(..., now, undefined, undefined, undefined, x)` -- three
 * undefineds whose meaning is positional and therefore silently wrong if
 * miscounted. The first five parameters stay positional because every
 * caller supplies all five and they read as a sentence. `applyDecisionBatch`
 * below already took an options object for the same reason, so this is the
 * established shape in this file rather than a new convention.
 */
interface DecideCandidateOptions {
  groupId?: string;
  source?: CandidateDecisionSource;
  importEvidence?: DecisionReuseEvidence;
  /** DECISION RATIONALE (2026-08-06): the named claim the reviewer accepted,
   *  supplied only by the paths that HAVE one (a suggestion chip, an identity
   *  option). Every other caller omits it and the decision carries no
   *  rationale -- see ReviewSession.ts's field comment on why absence is
   *  meaningful rather than merely unset. */
  rationale?: string;
}

function decideCandidate(
  session: ReviewSession,
  candidateId: string,
  decision: CandidateDecisionKind,
  replacement: string | undefined,
  now: string,
  options: DecideCandidateOptions = {}
): ReviewSession {
  const { groupId, source = "reviewer", importEvidence, rationale } = options;
  const entry: CandidateDecision = {
    candidateId,
    decision,
    decidedAt: now,
    source,
    ...(replacement !== undefined ? { replacement } : {}),
    ...(importEvidence !== undefined ? { importEvidence } : {}),
    ...(rationale !== undefined ? { rationale } : {}),
  };
  const anchor = groupId ?? candidateId;
  return {
    ...session,
    candidateDecisions: { ...session.candidateDecisions, [candidateId]: entry },
    entityRegistry: applyEntityAcknowledgement(session.entityRegistry, candidateId, decision, anchor, now),
    updatedAt: now,
  };
}

/** One item in a DecisionBatch: which candidate, what decision, and (for
 *  applyDecisionReuse alone) which source/evidence that decision carries.
 *  The five single-decision operations (confirmGroup/redactGroup/
 *  ignoreGroup/flattenGroup/bulkApplyDecision) map every candidateId in
 *  their batch to the identical `decision`/`replacement` -- `source`/
 *  `importEvidence` are omitted, so decideCandidate()'s own defaults
 *  ("reviewer", no evidence) apply. Only applyDecisionReuse supplies a
 *  genuinely different decision/source/evidence per item. */
interface DecisionBatchItem {
  candidateId: string;
  decision: CandidateDecisionKind;
  /** `| undefined` explicit (not just `?`) so callers holding an already-
   *  validated `string | undefined` local (every one of them -- Redact's
   *  optional override, Rename's required text, bulkApplyDecision's
   *  conditional replacement) can assign it directly under this project's
   *  `exactOptionalPropertyTypes` without an extra spread-to-omit dance. */
  replacement?: string | undefined;
  source?: CandidateDecisionSource;
  importEvidence?: DecisionReuseEvidence;
}

/** Present only for the four group-bulk commands: accepting a proposed
 *  group's grouping as one entity, with `decision` distinguishing an
 *  ordinary accept ("Confirmed" -- confirmGroup/redactGroup/ignoreGroup)
 *  from the "same outcome a completed Not Quite pass would produce"
 *  case ("Refined" -- flattenGroup). Absent for bulkApplyDecision
 *  (an arbitrary, not-necessarily-one-group selection) and
 *  applyDecisionReuse (no group semantics of its own). */
interface DecisionBatchGroupStamp {
  groupId: string;
  confirmedMemberCandidateIds: string[];
  decision: "Confirmed" | "Refined";
}

interface DecisionBatchOutcome {
  session: ReviewSession;
  appliedCount: number;
  skippedCount: number;
}

interface DecisionResetOutcome {
  session: ReviewSession;
  resetCount: number;
  skippedCount: number;
}

/**
 * The shared operational lifecycle behind every command in this reducer
 * that applies a decision to more than one candidate in a single
 * transaction: confirmGroup, redactGroup, ignoreGroup, flattenGroup,
 * bulkApplyDecision, applyDecisionReuse. See this file's top doc comment
 * ("ARCHITECTURAL CLEANUP") for why this exists and what stayed out of it.
 *
 * Owns exactly the steps direct inspection of all six call sites showed are
 * identical across every one of them:
 *   1. Skip (never fail the whole batch over) a candidateId not present in
 *      the current DetectionResult -- defensive; should not happen for a
 *      real proposal/selection, but every prior call site tolerated it the
 *      same way, one bad id at a time.
 *   2. Skip an already-decided candidate INSTEAD of overwriting it, but
 *      only when `overwrite` is false -- applyDecisionReuse's own
 *      "import fills gaps, it never contests existing state" rule; every
 *      other caller passes `overwrite: true` and this skip never triggers.
 *   3. Apply the decision via decideCandidate() -- the same helper every
 *      direct per-candidate command already uses, so a batch-applied
 *      decision is byte-identical to what a reviewer would get deciding
 *      each candidate individually, one at a time, in the order given.
 *   4. Append one candidate-decided event per actually-applied candidate,
 *      via `eventPayloadExtra` for whatever that operation's own event
 *      needs beyond {candidateId, decision} (viaGroupConfirm, importTier,
 *      etc.) -- the one place these six operations' events genuinely
 *      diverge, so it stays an explicit, narrow, per-call input rather than
 *      a guessed-at generic shape.
 *   5. Optionally stamp an EntityGroupDecision (`groupStamp`) once, after
 *      the loop -- present for the four group-bulk commands, absent for
 *      bulkApplyDecision/applyDecisionReuse.
 *
 * Deliberately does NOT append the CLOSING summary event
 * (group-decided/bulk-decided/decisions-imported) -- those three payloads
 * share no common shape (different field names entirely: action vs.
 * decision vs. proposalCount) and are one line each at the call site;
 * forcing them through a generic callback here would trade six lines of
 * real duplication for a callback contract with no less code. Each case
 * appends its own summary event using this function's returned
 * appliedCount/skippedCount, immediately after calling this.
 */
function applyDecisionBatch(
  session: ReviewSession,
  context: DetectionGroupingContext,
  items: readonly DecisionBatchItem[],
  now: string,
  options: {
    /** Shared entity anchor for every item in this batch (see
     *  decideCandidate()'s own doc comment) -- one groupId for the four
     *  group-bulk commands, absent (each candidate anchors on its own
     *  candidateId) for bulkApplyDecision/applyDecisionReuse. */
    groupId?: string;
    /** false only for applyDecisionReuse; true for every direct, deliberate
     *  reviewer bulk action. */
    overwrite: boolean;
    eventPayloadExtra: (item: DecisionBatchItem) => Record<string, string | number | boolean>;
    groupStamp?: DecisionBatchGroupStamp;
  }
): DecisionBatchOutcome {
  let next = session;
  let appliedCount = 0;
  let skippedCount = 0;
  for (const item of items) {
    if (!findCandidate(context.detection, item.candidateId)) {
      skippedCount++;
      continue;
    }
    if (!options.overwrite && item.candidateId in next.candidateDecisions) {
      skippedCount++;
      continue;
    }
    // Conditional spreads, not plain assignment: `exactOptionalPropertyTypes`
    // distinguishes an absent key from one explicitly set to undefined, and
    // these three are genuinely absent for most batches.
    //
    // No rationale, deliberately: a batch applies ONE disposition to a list,
    // so no member carries a claim of its own. Decision reuse in particular
    // must not inherit the prior reviewer's wording -- see ReviewSession.ts's
    // rationale field comment.
    next = decideCandidate(next, item.candidateId, item.decision, item.replacement, now, {
      ...(options.groupId !== undefined ? { groupId: options.groupId } : {}),
      ...(item.source !== undefined ? { source: item.source } : {}),
      ...(item.importEvidence !== undefined ? { importEvidence: item.importEvidence } : {}),
    });
    next = {
      ...next,
      events: appendEvent(next, "candidate-decided", now, {
        candidateId: item.candidateId,
        decision: item.decision,
        ...options.eventPayloadExtra(item),
      }),
    };
    appliedCount++;
  }
  if (options.groupStamp) {
    const groupDecision: EntityGroupDecision = {
      groupId: options.groupStamp.groupId,
      confirmedMemberCandidateIds: options.groupStamp.confirmedMemberCandidateIds,
      decision: options.groupStamp.decision,
      decidedAt: now,
    };
    next = { ...next, groupDecisions: { ...next.groupDecisions, [options.groupStamp.groupId]: groupDecision }, updatedAt: now };
  }
  return { session: next, appliedCount, skippedCount };
}

/**
 * Reset is the inverse of the CURRENT decision value, not an undo of the
 * historical act that created it. The audit log remains append-only, and
 * EntityRegistry detachment uses the same teardown path Ignore/reassignment
 * already rely on without decrementing its monotonic id sequence.
 */
function resetDecisionBatch(
  session: ReviewSession,
  context: DetectionGroupingContext,
  candidateIds: readonly string[],
  now: string,
  scope: "zone" | "category"
): DecisionResetOutcome {
  let next = session;
  let resetCount = 0;
  let skippedCount = 0;
  for (const candidateId of candidateIds) {
    if (!findCandidate(context.detection, candidateId) || !(candidateId in next.candidateDecisions)) {
      skippedCount++;
      continue;
    }
    const { [candidateId]: removed, ...remainingDecisions } = next.candidateDecisions;
    next = {
      ...next,
      candidateDecisions: remainingDecisions,
      entityRegistry: detachCandidate(next.entityRegistry, candidateId),
      updatedAt: now,
    };
    next = {
      ...next,
      events: appendEvent(next, "candidate-reset", now, {
        candidateId,
        previousDecision: removed!.decision,
        scope,
      }),
    };
    resetCount++;
  }
  return { session: next, resetCount, skippedCount };
}

function validateReplacementText(replacement: string): { ok: true; value: string } | { ok: false; reason: string } {
  const trimmed = replacement.trim();
  if (!trimmed) return { ok: false, reason: "replacement text cannot be blank" };
  return { ok: true, value: trimmed };
}

export function applyReviewCommand(session: ReviewSession, command: ReviewCommand, context: DetectionGroupingContext, now: string): ReviewDispatchOutcome {
  // DECISION PROVENANCE (Pass 1, 2026-08-03): the optional scope stamp
  // (Commands.ts doc comment) rides on the EVENT payloads only — durable
  // history of the act — never on CandidateDecision itself. Spread-if-
  // present so a stampless command's payload is byte-identical to before.
  const scopeStamp = (c: { scope?: string }): Record<string, string> => (c.scope !== undefined ? { scope: c.scope } : {});
  // DECISION TRACKER MISCOUNT FIX (2026-08-06): see Commands.ts's doc
  // comment on viaSuggestionAccept for why this exists alongside scopeStamp.
  const suggestionAcceptStamp = (c: { viaSuggestionAccept?: boolean }): Record<string, boolean> =>
    c.viaSuggestionAccept ? { viaSuggestionAccept: true } : {};
  switch (command.type) {
    case "keepCandidate": {
      if (!findCandidate(context.detection, command.candidateId)) return fail(session, `no such candidate: ${command.candidateId}`);
      let next = decideCandidate(session, command.candidateId, "Keep", undefined, now, {
        ...(command.rationale !== undefined ? { rationale: command.rationale } : {}),
      });
      next = {
        ...next,
        events: appendEvent(next, "candidate-decided", now, {
          candidateId: command.candidateId,
          decision: "Keep",
          ...scopeStamp(command),
          ...suggestionAcceptStamp(command),
        }),
      };
      return ok(next);
    }

    case "renameCandidate": {
      if (!findCandidate(context.detection, command.candidateId)) return fail(session, `no such candidate: ${command.candidateId}`);
      const validated = validateReplacementText(command.replacement);
      if (!validated.ok) return fail(session, validated.reason);
      let next = decideCandidate(session, command.candidateId, "Rename", validated.value, now, {
        ...(command.rationale !== undefined ? { rationale: command.rationale } : {}),
      });
      next = {
        ...next,
        events: appendEvent(next, "candidate-decided", now, {
          candidateId: command.candidateId,
          decision: "Rename",
          replacement: validated.value,
          ...scopeStamp(command),
          ...suggestionAcceptStamp(command),
        }),
      };
      return ok(next);
    }

    case "redactCandidate": {
      if (!findCandidate(context.detection, command.candidateId)) return fail(session, `no such candidate: ${command.candidateId}`);
      let replacement: string | undefined;
      if (command.replacement !== undefined) {
        const validated = validateReplacementText(command.replacement);
        if (!validated.ok) return fail(session, validated.reason);
        replacement = validated.value;
      }
      let next = decideCandidate(session, command.candidateId, "Redact", replacement, now, {
        ...(command.rationale !== undefined ? { rationale: command.rationale } : {}),
      });
      next = {
        ...next,
        events: appendEvent(next, "candidate-decided", now, {
          candidateId: command.candidateId,
          decision: "Redact",
          ...(replacement !== undefined ? { replacement } : {}),
          ...scopeStamp(command),
        }),
      };
      return ok(next);
    }

    case "ignoreCandidate": {
      if (!findCandidate(context.detection, command.candidateId)) return fail(session, `no such candidate: ${command.candidateId}`);
      let next = decideCandidate(session, command.candidateId, "Ignore", undefined, now, {
        ...(command.rationale !== undefined ? { rationale: command.rationale } : {}),
      });
      next = {
        ...next,
        events: appendEvent(next, "candidate-decided", now, {
          candidateId: command.candidateId,
          decision: "Ignore",
          ...scopeStamp(command),
          ...suggestionAcceptStamp(command),
        }),
      };
      return ok(next);
    }

    case "enterNotQuite": {
      const group = context.grouping.entityGroupProposals.find((g) => g.groupId === command.groupId);
      if (!group) return fail(session, `no such entity group: ${command.groupId}`);
      if (session.activeNotQuite !== null) {
        return fail(
          session,
          session.activeNotQuite.groupId === command.groupId
            ? "Not Quite is already open for this group"
            : "another Not Quite group is already open; exit it first"
        );
      }
      const members: Record<string, NotQuiteMemberState> = {};
      for (const candidateId of group.candidateIds) {
        members[candidateId] = { candidateId, applied: false };
      }
      const activeNotQuite: NotQuiteState = {
        schemaVersion: 1,
        groupId: command.groupId,
        members,
        activeMemberId: group.candidateIds[0] ?? null,
        transactionStatus: "open",
        allMembersHandled: group.candidateIds.length === 0,
        enteredAt: now,
      };
      let next: ReviewSession = { ...session, activeNotQuite, updatedAt: now };
      next = { ...next, events: appendEvent(next, "not-quite-entered", now, { groupId: command.groupId, memberCount: group.candidateIds.length }) };
      return ok(next);
    }

    case "applyNotQuiteMember": {
      const active = session.activeNotQuite;
      if (!active || active.groupId !== command.groupId) return fail(session, `no open Not Quite group matching ${command.groupId}`);
      const member = active.members[command.candidateId];
      if (!member) return fail(session, `${command.candidateId} is not a member of Not Quite group ${command.groupId}`);
      if (!findCandidate(context.detection, command.candidateId)) return fail(session, `no such candidate: ${command.candidateId}`);

      let replacement: string | undefined;
      if (command.action === "Rename") {
        const validated = validateReplacementText(command.draftReplacement ?? "");
        if (!validated.ok) return fail(session, validated.reason);
        replacement = validated.value;
      } else if (command.action === "Redact" && command.draftReplacement !== undefined) {
        const validated = validateReplacementText(command.draftReplacement);
        if (!validated.ok) return fail(session, validated.reason);
        replacement = validated.value;
      }

      const decisionKind: CandidateDecisionKind = command.action; // "Keep" | "Rename" | "Redact" all valid CandidateDecisionKind values
      let next = decideCandidate(session, command.candidateId, decisionKind, replacement, now, { groupId: command.groupId });

      const updatedMembers: Record<string, NotQuiteMemberState> = {
        ...active.members,
        [command.candidateId]: {
          candidateId: command.candidateId,
          action: command.action,
          ...(command.draftReplacement !== undefined ? { draftReplacement: command.draftReplacement } : {}),
          applied: true,
        },
      };
      const allMembersHandled = Object.values(updatedMembers).every((m) => m.applied);
      const memberOrder = Object.keys(active.members);
      const currentIndex = memberOrder.indexOf(command.candidateId);
      const nextUnapplied = memberOrder.slice(currentIndex + 1).find((id) => !updatedMembers[id]!.applied);
      const activeMemberId = nextUnapplied ?? (allMembersHandled ? null : memberOrder.find((id) => !updatedMembers[id]!.applied) ?? null);

      const updatedActiveNotQuite: NotQuiteState = { ...active, members: updatedMembers, allMembersHandled, activeMemberId };
      next = { ...next, activeNotQuite: updatedActiveNotQuite, updatedAt: now };
      next = {
        ...next,
        events: appendEvent(next, "not-quite-member-applied", now, { groupId: command.groupId, candidateId: command.candidateId, action: command.action }),
      };
      return ok(next);
    }

    case "completeNotQuite": {
      const active = session.activeNotQuite;
      if (!active || active.groupId !== command.groupId) return fail(session, `no open Not Quite group matching ${command.groupId}`);
      const memberIds = Object.keys(active.members);
      const groupDecision: EntityGroupDecision = {
        groupId: command.groupId,
        confirmedMemberCandidateIds: memberIds,
        decision: "Refined",
        decidedAt: now,
      };
      let next: ReviewSession = {
        ...session,
        groupDecisions: { ...session.groupDecisions, [command.groupId]: groupDecision },
        activeNotQuite: { ...active, transactionStatus: "completed", completedAt: now },
        updatedAt: now,
      };
      next = { ...next, events: appendEvent(next, "not-quite-completed", now, { groupId: command.groupId, memberCount: memberIds.length }) };
      return ok(next);
    }

    case "exitNotQuite": {
      const active = session.activeNotQuite;
      if (!active || active.groupId !== command.groupId) return fail(session, `no open Not Quite group matching ${command.groupId}`);
      const wasCompleted = active.transactionStatus === "completed";
      let next: ReviewSession = { ...session, activeNotQuite: null, updatedAt: now };
      next = { ...next, events: appendEvent(next, "not-quite-exited", now, { groupId: command.groupId, wasCompleted }) };
      return ok(next);
    }

    case "confirmGroup": {
      const validated = validateGroupBulkCommand(session, context, command.groupId);
      if (!validated.ok) return fail(session, validated.reason);
      const { group } = validated;
      // IMPORTANT, found while implementing (not designing): DocumentRebuilder
      // (src/io/DocumentRebuilder.ts) reads ONLY session.candidateDecisions
      // when deciding what to redact -- it has no knowledge of groupDecisions
      // at all. If this case recorded only an EntityGroupDecision and left
      // candidateDecisions untouched, every member would read as "resolved"
      // (via coverage.ts's group-coverage rule) while carrying no actual
      // CandidateDecision -- AuditExporter would then show
      // decision:"Undecided" next to resolvedStatus:"resolved" for the same
      // candidate, a confusing, unexplainable-looking audit entry. Bulk-
      // applying "Keep" to every member (the same decideCandidate() helper
      // every other command uses) avoids that mismatch AND matches what
      // Python's real group-level "k" shortcut actually does (Phase 9
      // findings: local_web_app.py's groupKeyActions maps group-level
      // k/n/r/i to Keep-as-is/Flatten/Redact/Ignore, bulk-applying that
      // literal per-candidate decision to every member) -- "Keep as-is"
      // (UI label; command name `confirmGroup` is unchanged) is that same
      // operation, not a new one.
      const batch = applyDecisionBatch(
        session,
        context,
        group.candidateIds.map((candidateId) => ({ candidateId, decision: "Keep" as const })),
        now,
        {
          groupId: command.groupId,
          overwrite: true,
          eventPayloadExtra: () => ({ viaGroupConfirm: true }),
          groupStamp: { groupId: command.groupId, confirmedMemberCandidateIds: group.candidateIds, decision: "Confirmed" },
        }
      );
      const next = { ...batch.session, events: appendEvent(batch.session, "group-decided", now, { groupId: command.groupId, action: "confirm", memberCount: group.candidateIds.length }) };
      return ok(next);
    }

    case "redactGroup": {
      const validated = validateGroupBulkCommand(session, context, command.groupId);
      if (!validated.ok) return fail(session, validated.reason);
      const { group } = validated;
      // v9 terminology revision: fills the `r` (Redact) slot at the group
      // level -- deliberately reserved, not repurposed, since Feature 001
      // (see keymap.ts's top doc comment). Same bulk-decideCandidate()
      // pattern confirmGroup uses, same optional-replacement-override
      // semantics the direct redactCandidate command already has (defaults
      // to a type-appropriate placeholder at output-generation time when
      // unset). Stamps EntityGroupDecision as "Confirmed", matching
      // confirmGroup: both operations mean "accept this grouping as one
      // entity, apply the same disposition to every member" -- they differ
      // only in which CandidateDecision.decision gets bulk-applied, not in
      // whether the grouping itself was accepted.
      let replacement: string | undefined;
      if (command.replacement !== undefined) {
        const validated2 = validateReplacementText(command.replacement);
        if (!validated2.ok) return fail(session, validated2.reason);
        replacement = validated2.value;
      }
      const batch = applyDecisionBatch(
        session,
        context,
        group.candidateIds.map((candidateId) => ({ candidateId, decision: "Redact" as const, replacement })),
        now,
        {
          groupId: command.groupId,
          overwrite: true,
          eventPayloadExtra: (item) => ({ viaGroupRedact: true, ...(item.replacement !== undefined ? { replacement: item.replacement } : {}) }),
          groupStamp: { groupId: command.groupId, confirmedMemberCandidateIds: group.candidateIds, decision: "Confirmed" },
        }
      );
      const next = { ...batch.session, events: appendEvent(batch.session, "group-decided", now, { groupId: command.groupId, action: "redact", memberCount: group.candidateIds.length }) };
      return ok(next);
    }

    case "ignoreGroup": {
      const validated = validateGroupBulkCommand(session, context, command.groupId);
      if (!validated.ok) return fail(session, validated.reason);
      const { group } = validated;
      // v9 terminology revision: fills the `i` (Ignore) slot at the group
      // level -- see redactGroup's comment above; same reasoning, no
      // replacement text involved.
      const batch = applyDecisionBatch(
        session,
        context,
        group.candidateIds.map((candidateId) => ({ candidateId, decision: "Ignore" as const })),
        now,
        {
          groupId: command.groupId,
          overwrite: true,
          eventPayloadExtra: () => ({ viaGroupIgnore: true }),
          groupStamp: { groupId: command.groupId, confirmedMemberCandidateIds: group.candidateIds, decision: "Confirmed" },
        }
      );
      const next = { ...batch.session, events: appendEvent(batch.session, "group-decided", now, { groupId: command.groupId, action: "ignore", memberCount: group.candidateIds.length }) };
      return ok(next);
    }

    case "flattenGroup": {
      const validated = validateGroupBulkCommand(session, context, command.groupId);
      if (!validated.ok) return fail(session, validated.reason);
      const { group } = validated;
      const validatedName = validateReplacementText(group.canonicalName);
      if (!validatedName.ok) return fail(session, `group ${command.groupId}'s canonical name is blank; cannot flatten`);
      // "Rename" at the group level (UI label; command name `flattenGroup`
      // is unchanged -- see Commands.ts's v9 note). Bulk-applies the
      // existing canonical-selection behavior (the group's own already-
      // computed canonicalName -- EntityResolutionEngine's output, not new
      // logic) to every member via the exact same decideCandidate() helper
      // direct Rename and applyNotQuiteMember already use, one member at a
      // time, in candidateIds order -- so this produces byte-identical
      // CandidateDecision entries to what a reviewer would get by manually
      // renaming every member inside Not Quite themselves. Then stamps
      // EntityGroupDecision as "Refined" --
      // the same value completeNotQuite uses -- because the resulting
      // session state (every member individually decided, canonical group
      // membership stamped) is exactly what a manual Not-Quite-then-rename-
      // every-member-then-complete pass would produce, per Andrew's own
      // "should produce the same result a reviewer would obtain by manually
      // confirming every proposed relationship."
      const batch = applyDecisionBatch(
        session,
        context,
        group.candidateIds.map((candidateId) => ({ candidateId, decision: "Rename" as const, replacement: validatedName.value })),
        now,
        {
          groupId: command.groupId,
          overwrite: true,
          eventPayloadExtra: (item) => ({ replacement: item.replacement!, viaGroupFlatten: true }),
          groupStamp: { groupId: command.groupId, confirmedMemberCandidateIds: group.candidateIds, decision: "Refined" },
        }
      );
      const next = { ...batch.session, events: appendEvent(batch.session, "group-decided", now, { groupId: command.groupId, action: "flatten", memberCount: group.candidateIds.length }) };
      return ok(next);
    }

    case "applyDecisionReuse": {
      // See this file's top doc comment ("Feature 002 ... adds
      // applyDecisionReuse") for why this is the one command in this whole
      // reducer that deliberately does NOT overwrite an existing decision --
      // `overwrite: false` below is the ONLY call site among the six
      // applyDecisionBatch() callers that passes it. Also the only one
      // whose items carry a genuinely different decision/replacement/
      // evidence each (every other caller maps a single shared decision
      // over its candidateIds) -- see applyDecisionBatch()'s own doc
      // comment and this file's top "ARCHITECTURAL CLEANUP" note.
      const batch = applyDecisionBatch(
        session,
        context,
        command.proposals.map((proposal) => ({
          candidateId: proposal.candidateId,
          decision: proposal.decision,
          replacement: proposal.replacement,
          source: "imported" as const,
          importEvidence: proposal.evidence,
        })),
        now,
        {
          overwrite: false,
          eventPayloadExtra: (item) => ({
            source: "imported",
            importTier: item.importEvidence!.tier,
            ...(item.replacement !== undefined ? { replacement: item.replacement } : {}),
          }),
        }
      );
      const next = {
        ...batch.session,
        events: appendEvent(batch.session, "decisions-imported", now, {
          proposalCount: command.proposals.length,
          appliedCount: batch.appliedCount,
          skippedCount: batch.skippedCount,
        }),
      };
      return ok(next);
    }

    case "bulkApplyDecision": {
      // MILESTONE 2 ("Review at Scale"): the generalization of
      // confirmGroup/rejectGroup/flattenGroup's "apply one decision to a
      // whole list of candidateIds in one transaction" shape (Feature 001)
      // to an arbitrary, reviewer-selected list rather than a group's fixed
      // membership. Uses the exact same decideCandidate() helper -- a
      // bulk-applied decision is byte-identical to what a reviewer would
      // get by deciding each candidate individually, one at a time, in the
      // order given.
      if (command.candidateIds.length === 0) return fail(session, "no candidates selected for bulk action");

      let replacement: string | undefined;
      if (command.decision === "Rename") {
        const validated = validateReplacementText(command.replacement ?? "");
        if (!validated.ok) return fail(session, validated.reason);
        replacement = validated.value;
      } else if (command.decision === "Redact" && command.replacement !== undefined) {
        const validated = validateReplacementText(command.replacement);
        if (!validated.ok) return fail(session, validated.reason);
        replacement = validated.value;
      }

      // Unlike applyDecisionReuse, a bulk action IS a direct, deliberate
      // reviewer action (the reviewer explicitly selected these candidates
      // and clicked "Redact selected"), so it overwrites any existing
      // decision exactly like keepCandidate/renameCandidate/etc. do --
      // there is no "fill gaps only" restraint here, matching Andrew's
      // "Redact selected / Keep selected / Ignore selected / Rename
      // selected" phrasing (an ordinary decision, just batched). No
      // groupId/groupStamp: an arbitrary reviewer-selected list is not
      // asserted to be one entity the way a proposed group's fixed
      // membership is (see applyDecisionBatch()'s own doc comment) -- each
      // selected candidate anchors on its own candidateId.
      const batch = applyDecisionBatch(
        session,
        context,
        command.candidateIds.map((candidateId) => ({ candidateId, decision: command.decision, replacement })),
        now,
        {
          overwrite: true,
          // DECISION PROVENANCE (Pass 1): the scope stamp joins each
          // per-candidate event too, so a bulk-applied decision's history
          // is distinguishable from an individually-made one even when the
          // summary event is not at hand.
          eventPayloadExtra: (item) => ({ viaBulkApply: true, ...(item.replacement !== undefined ? { replacement: item.replacement } : {}), ...scopeStamp(command) }),
        }
      );

      if (batch.appliedCount === 0) {
        return fail(session, "none of the selected candidates exist in this document -- no decisions applied");
      }

      const next = {
        ...batch.session,
        events: appendEvent(batch.session, "bulk-decided", now, {
          decision: command.decision,
          requestedCount: command.candidateIds.length,
          appliedCount: batch.appliedCount,
          skippedCount: batch.skippedCount,
          ...scopeStamp(command),
        }),
      };
      return ok(next);
    }

    case "resetDecisions": {
      if (command.candidateIds.length === 0) return fail(session, "no decisions selected for reset");
      const batch = resetDecisionBatch(session, context, command.candidateIds, now, command.scope);
      if (batch.resetCount === 0) return fail(session, "none of the selected candidates currently have decisions to reset");
      const next = {
        ...batch.session,
        events: appendEvent(batch.session, "decisions-reset", now, {
          scope: command.scope,
          requestedCount: command.candidateIds.length,
          resetCount: batch.resetCount,
          skippedCount: batch.skippedCount,
        }),
      };
      return ok(next);
    }

    case "linkAmbiguousCandidate": {
      // Ambiguity Check correction (v10) -- activates the
      // ambiguityResolutions/ "ambiguity-resolved" schema that has existed
      // since ADR-008/Phase 8 but was never written to (see this file's top
      // doc comment and Commands.ts's v10 note). groupId must be one of
      // THIS candidate's own currently-proposed options -- validated
      // against the live GroupingResult, not trusted blindly, mirroring
      // every other command's "validate against current proposal state"
      // precedent (validateGroupBulkCommand above, findCandidate elsewhere).
      if (!findCandidate(context.detection, command.candidateId)) return fail(session, `no such candidate: ${command.candidateId}`);
      const proposal = context.grouping.ambiguityProposals.find((p) => p.candidateId === command.candidateId);
      if (!proposal) return fail(session, `${command.candidateId} is not a currently-proposed ambiguity`);
      const option = proposal.candidateGroupOptions.find((o) => o.groupId === command.groupId);
      if (!option) return fail(session, `${command.groupId} is not one of ${command.candidateId}'s proposed entity options`);

      // Keep, not Rename-to-canonical: linking an ambiguous first name to a
      // full-name entity is a statement about IDENTITY ("this occurrence of
      // 'Andrew' refers to Andrew Goodloe"), not an instruction to rewrite
      // the document's surface text -- that remains a separate, explicit
      // Rename/Redact choice like every other candidate gets, preserving
      // the original text by default exactly as keepCandidate always has.
      let next: ReviewSession = decideCandidate(session, command.candidateId, "Keep", undefined, now, {
        groupId: command.groupId,
        ...(command.rationale !== undefined ? { rationale: command.rationale } : {}),
      });
      next = {
        ...next,
        events: appendEvent(next, "candidate-decided", now, {
          candidateId: command.candidateId,
          decision: "Keep",
          viaAmbiguityLink: true,
          resolvedGroupId: command.groupId,
          ...suggestionAcceptStamp(command),
        }),
      };
      next = {
        ...next,
        ambiguityResolutions: { ...next.ambiguityResolutions, [command.candidateId]: { candidateId: command.candidateId, resolvedGroupId: command.groupId, decidedAt: now } },
        updatedAt: now,
      };
      next = { ...next, events: appendEvent(next, "ambiguity-resolved", now, { candidateId: command.candidateId, resolvedGroupId: command.groupId, canonicalName: option.canonicalName }) };
      return ok(next);
    }

    case "suggestionsAccepted": {
      // Decision Tracker miscount fix (2026-08-06) -- see Commands.ts's doc
      // comment. Touches no candidateDecisions (those already landed via the
      // individually-dispatched, viaSuggestionAccept-tagged commands that
      // preceded this one); it exists purely as the anchor event
      // decisionTracker.ts's BATCH_ANCHOR_EVENTS closes the gesture on.
      const next = {
        ...session,
        events: appendEvent(session, "suggestions-accepted", now, {
          requestedCount: command.requestedCount,
          appliedCount: command.appliedCount,
          skippedCount: command.skippedCount,
        }),
      };
      return ok(next);
    }

    case "dismissRelationship": {
      // Structural Relationship Review (2026-07-30): "Unrelated" dissolves
      // the PROPOSED RELATIONSHIP and nothing else. Deliberately touches no
      // candidateDecisions, no groupDecisions, no entityRegistry -- it is a
      // judgment about the proposal, not about any candidate, and every
      // member continues through the normal review pipeline unchanged (the
      // proposal's own hard requirement: "Unrelated" must not classify the
      // candidates as non-sensitive or remove them from later review).
      // Validated only for shape (a non-empty member list) -- the proposal
      // itself is DERIVED state recomputed per load, so there is nothing
      // durable to validate against; carrying its facts into the dismissal
      // and the event log is what makes the session self-describing.
      if (command.candidateIds.length === 0) return fail(session, "a relationship proposal has no members -- nothing to dismiss");
      const next: ReviewSession = {
        ...session,
        relationshipDismissals: {
          ...(session.relationshipDismissals ?? {}),
          [command.proposalId]: {
            proposalId: command.proposalId,
            kind: command.relationshipKind,
            candidateIds: command.candidateIds,
            dismissedAt: now,
          },
        },
        updatedAt: now,
        events: appendEvent(session, "relationship-dismissed", now, {
          proposalId: command.proposalId,
          relationshipKind: command.relationshipKind,
          memberCount: command.candidateIds.length,
          candidateIds: command.candidateIds.join(", "),
        }),
      };
      return ok(next);
    }

    default: {
      const exhaustive: never = command;
      return fail(session, `unknown review command: ${JSON.stringify(exhaustive)}`);
    }
  }
}

// Re-exported so ReviewEngine.ts's concrete class and the verification
// harness can construct fresh sessions without duplicating field defaults.
export function createReviewSession(sessionId: string, documentId: string, now: string): ReviewSession {
  return {
    schemaVersion: 2,
    sessionId,
    documentId,
    createdAt: now,
    updatedAt: now,
    candidateDecisions: {},
    groupDecisions: {},
    ambiguityResolutions: {},
    entityRegistry: EMPTY_ENTITY_REGISTRY,
    activeNotQuite: null,
    processingRevisions: [],
    events: [],
  };
}
