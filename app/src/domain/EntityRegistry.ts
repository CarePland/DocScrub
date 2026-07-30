/**
 * EntityRegistry — session-scoped, in-memory record of human-confirmed
 * semantic entities, separate from the content-derived `candidateId` that
 * DetectionEngine/EntityResolutionEngine already use for grouping and
 * matching (Decision Reuse's exact-key/grouped-alias/similarity tiers, see
 * DecisionReuse.ts, are unchanged by this file and remain the only matching
 * logic in this codebase).
 *
 * WHY THIS EXISTS: `candidateId` is a pure function of normalized text +
 * detected type (DetectionEngine's normalizeCandidate()) -- an excellent
 * detection/grouping/matching key, but not a stable notion of "this is a
 * real thing a reviewer has confirmed," because it is entirely determined
 * by surface text. `CandidateDecision` (ReviewSession.ts) has, until now,
 * conflated the two: the same record both names a real-world entity AND
 * carries its disposition (Keep/Rename/Redact/Ignore). `EntityId` (opaque,
 * assigned only on confirmation) separates identity from disposition, per
 * Andrew's explicit instruction: "the UUID represents the semantic
 * identity, not the review decision." This is the smallest change that
 * makes that separation real without building anything workspace-scoped or
 * persistent -- see this file's own "NOT included" list at the bottom.
 *
 * ANCHORING: a ConfirmedEntity's membership is keyed by an "anchor" the
 * caller computes, not by this module -- ordinarily a candidateId (a
 * standalone candidate decided directly is its own singleton entity) or a
 * groupId (every member of a Confirmed/Refined entity group shares ONE
 * entity, because the group already represents "same real-world thing,
 * multiple surface forms" -- see EntityResolutionEngine.ts). This module
 * has no opinion on what an anchor means; session.ts's decideCandidate()
 * decides that (candidateId alone for direct per-candidate commands,
 * groupId for group-bulk/Not-Quite-member/ambiguity-link commands).
 *
 * DERIVED, NOT DUPLICATED: isPositiveAcknowledgement() (ReviewSession.ts)
 * decides whether a decision confirms or revokes an entity; this module
 * only maintains the resulting membership index so it cannot drift from
 * that predicate -- there is no separate "is this entity confirmed" flag
 * anywhere in ConfirmedEntity itself, existence in `entities` IS the fact.
 *
 * REASSIGNMENT: dispatching a new decision for a candidate already anchored
 * elsewhere (e.g. an individually-Kept candidate later swept into a
 * flattened group) first detaches it from its old entity -- mirroring the
 * existing "single current value, last write wins" rule CandidateDecision
 * itself already follows (session.ts's own top doc comment) -- so entity
 * membership can never point at a decision that no longer exists.
 *
 * DELIBERATELY NOT INCLUDED (see the architectural review this implements):
 * - No persistence. This registry lives on ReviewSession exactly like
 *   candidateDecisions/groupDecisions do, and rides the SAME existing
 *   save/reload plumbing (serializeReviewSession/WorkspaceSaveFile) --
 *   no new storage, no IndexedDB entity store, nothing that survives
 *   outside a review session's own existing persistence.
 * - No KnowledgeProvider, no cross-document/cross-session matching, no
 *   suggestion mechanism. An EntityId means nothing outside the session
 *   it was minted in.
 * - No new matching tier. Which candidates share an anchor is entirely
 *   decided by existing grouping/group-decision data the caller already
 *   has; this file does not compare candidate text to anything.
 * - No graph structure. `entities` is a flat map; "the workspace entity
 *   graph" discussed as a future possibility is explicitly out of scope.
 */

import type { CandidateDecisionKind } from "./ReviewSession.js";
import { isPositiveAcknowledgement } from "./ReviewSession.js";

export interface ConfirmedEntity {
  entityId: string;
  /** The candidateId (standalone) or groupId (shared group membership)
   *  this entity's membership is keyed by. Not itself opaque -- kept only
   *  so a later decision on the same anchor can find its existing entity
   *  instead of minting a duplicate. */
  anchor: string;
  /** Every candidateId currently confirmed as a member of this entity.
   *  Always non-empty -- an entity with zero members is deleted, not kept
   *  as an empty record (see detachCandidate() below). */
  memberCandidateIds: string[];
  /** When this entity was first confirmed. Does not change on later
   *  disposition changes (Keep -> Redact -> Rename all preserve the same
   *  entity and its confirmedAt) -- only a full detach-then-reconfirm
   *  produces a new entityId with a new confirmedAt. */
  confirmedAt: string;
}

export interface EntityRegistry {
  entities: Record<string /* entityId */, ConfirmedEntity>;
  entityIdByAnchor: Record<string /* anchor */, string /* entityId */>;
  entityIdByCandidateId: Record<string /* candidateId */, string /* entityId */>;
  /** Monotonic mint counter -- the one piece of state here that is NOT
   *  derivable from `entities` alone. Deliberately NOT `Object.keys(entities
   *  ).length` (session.ts's nextEventId() convention): events are
   *  append-only, so a live count is a safe proxy for "how many have ever
   *  existed," but entities can be torn down (Ignore, or detachment during
   *  reassignment -- see applyEntityAcknowledgement()'s doc comment), so a
   *  live-count-based id would collide with an earlier, since-deleted
   *  entity's id the moment one is deleted and another minted in the same
   *  session. A real, always-increasing sequence avoids that, while
   *  remaining just as deterministic and reproducible as the event-id
   *  scheme it deliberately parallels. */
  nextSequence: number;
}

export const EMPTY_ENTITY_REGISTRY: EntityRegistry = {
  entities: {},
  entityIdByAnchor: {},
  entityIdByCandidateId: {},
  nextSequence: 0,
};

/** Deterministic, sequential entity IDs -- matches session.ts's own
 *  nextEventId() convention (simple, reproducible identifiers, not
 *  crypto.randomUUID()) while avoiding that function's live-count pitfall
 *  for state that can shrink -- see `nextSequence`'s own doc comment. */
function nextEntityId(registry: EntityRegistry): { entityId: string; nextSequence: number } {
  const nextSequence = registry.nextSequence + 1;
  return { entityId: `entity-${nextSequence}`, nextSequence };
}

/** Removes candidateId from whatever entity currently holds it, if any --
 *  deleting that entity entirely (and its anchor mapping) if it becomes
 *  empty. A no-op if candidateId is not currently a member of any entity. */
function detachCandidate(registry: EntityRegistry, candidateId: string): EntityRegistry {
  const existingEntityId = registry.entityIdByCandidateId[candidateId];
  if (!existingEntityId) return registry;
  const entity = registry.entities[existingEntityId];
  if (!entity) return registry; // defensive; indices should never point at a missing entity

  const remainingMembers = entity.memberCandidateIds.filter((id) => id !== candidateId);
  const { [candidateId]: _removedFromCandidateIndex, ...restByCandidateId } = registry.entityIdByCandidateId;

  if (remainingMembers.length === 0) {
    const { [existingEntityId]: _removedEntity, ...restEntities } = registry.entities;
    const { [entity.anchor]: _removedAnchor, ...restByAnchor } = registry.entityIdByAnchor;
    return { entities: restEntities, entityIdByAnchor: restByAnchor, entityIdByCandidateId: restByCandidateId, nextSequence: registry.nextSequence };
  }
  return {
    ...registry,
    entities: { ...registry.entities, [existingEntityId]: { ...entity, memberCandidateIds: remainingMembers } },
    entityIdByCandidateId: restByCandidateId,
  };
}

/**
 * The one write path into EntityRegistry, called from session.ts's
 * decideCandidate() for every command in the reducer -- never called
 * anywhere else, so entity state cannot drift from the decision that
 * produced it. `anchor` is `groupId ?? candidateId`, computed by the
 * caller (see this file's top doc comment).
 *
 * - A positive decision (isPositiveAcknowledgement(decision) === true)
 *   attaches candidateId to the anchor's entity, minting a new EntityId
 *   only the first time that anchor is ever positively decided. A later
 *   change between Keep/Rename/Redact for the SAME anchor reuses the same
 *   EntityId -- the real-world entity hasn't changed, only its disposition.
 * - Ignore detaches candidateId from any entity and creates none: per
 *   Andrew's instruction, "Ignore means this is not a meaningful entity."
 *   If Ignore follows an earlier positive decision, the previously-minted
 *   entity is torn down (or shrunk, if other members remain) -- it does
 *   not linger as stale confirmed knowledge.
 */
export function applyEntityAcknowledgement(
  registry: EntityRegistry,
  candidateId: string,
  decision: CandidateDecisionKind,
  anchor: string,
  now: string
): EntityRegistry {
  // Short-circuit: if this candidate is already the anchor's own confirmed
  // entity and the new decision is still positive, nothing about MEMBERSHIP
  // changes -- this is precisely the common "Keep -> Redact -> Rename" case
  // (and the group-level equivalent: re-deciding a group that already
  // shares one entity). Skipping straight to detach-then-reattach here
  // would tear down and re-mint the entity even though its real-world
  // identity hasn't changed -- exactly the bug this guard exists to avoid.
  const currentEntityId = registry.entityIdByCandidateId[candidateId];
  const currentEntity = currentEntityId ? registry.entities[currentEntityId] : undefined;
  if (isPositiveAcknowledgement(decision) && currentEntity && currentEntity.anchor === anchor) {
    return registry;
  }

  const detached = detachCandidate(registry, candidateId);
  if (!isPositiveAcknowledgement(decision)) return detached;

  const existingEntityId = detached.entityIdByAnchor[anchor];
  if (existingEntityId) {
    const entity = detached.entities[existingEntityId]!;
    const memberCandidateIds = entity.memberCandidateIds.includes(candidateId)
      ? entity.memberCandidateIds
      : [...entity.memberCandidateIds, candidateId];
    return {
      ...detached,
      entities: { ...detached.entities, [existingEntityId]: { ...entity, memberCandidateIds } },
      entityIdByCandidateId: { ...detached.entityIdByCandidateId, [candidateId]: existingEntityId },
    };
  }

  const { entityId, nextSequence } = nextEntityId(detached);
  const entity: ConfirmedEntity = { entityId, anchor, memberCandidateIds: [candidateId], confirmedAt: now };
  return {
    entities: { ...detached.entities, [entityId]: entity },
    entityIdByAnchor: { ...detached.entityIdByAnchor, [anchor]: entityId },
    entityIdByCandidateId: { ...detached.entityIdByCandidateId, [candidateId]: entityId },
    nextSequence,
  };
}
