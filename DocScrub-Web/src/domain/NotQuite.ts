/**
 * Not Quite — the one deliberate, documented exception to "items do not
 * disappear on click" (architecture v0.2 §4.5, §6.8). Modeled explicitly as
 * ReviewEngine sub-state per ADR-008 (revised) / the ARB review's first
 * required finding.
 *
 * Mirrors the current Python/JS implementation's client-side state
 * (notQuiteGroups, notQuiteRemaining, notQuiteEditor, notQuiteEditorDrafts,
 * notQuiteActiveMember, notQuiteControlIndex in local_web_app.py) as a single
 * named, durable, typed structure instead of six loose variables.
 *
 * v2 (Phase 9): MemberAction gained "Ignore". OBJECTIVE INTERFACE DEFECT,
 * found while building the FocusNavigator keymap against Python's real Not
 * Quite per-member keyboard mapping directly: local_web_app.py's handler
 * maps "i" to `completeNotQuiteMember(group, key, "Ignore")` -- a real,
 * reachable per-member action -- but this type only had three of
 * Python's four values. Not caught by Phase 8's own typechecking because
 * a narrower union is always assignable to CandidateDecisionKind (the
 * wider type applyNotQuiteMember's reducer actually decides against), so
 * the gap was a missing CAPABILITY, not a type error. Additive: existing
 * "Keep"/"Rename"/"Redact" usages are unaffected.
 */

export type MemberAction = "Keep" | "Rename" | "Redact" | "Ignore";

export interface NotQuiteMemberState {
  candidateId: string;
  /** Undefined until the reviewer picks an action for this member. */
  action?: MemberAction;
  /** Draft replacement text for Rename/Redact, held here (durable, not UI
   *  state) because it is a real value that could affect the output
   *  document if the group is completed -- see §6.8 and §4.7's v0.2
   *  corollary. */
  draftReplacement?: string;
  /** True once the reviewer has confirmed this member's action within the
   *  Not Quite panel. Distinct from the group's overall completionState. */
  applied: boolean;
}

export type NotQuiteTransactionStatus = "open" | "completing" | "completed" | "cancelled";

export interface NotQuiteState {
  schemaVersion: 1;
  /** Not Quite is always scoped to exactly one candidate group at a time. */
  groupId: string;
  members: Record<string /* candidateId */, NotQuiteMemberState>;
  /** candidateId of the member the FocusNavigator currently has active
   *  inside the Not Quite panel -- NOT durable UI focus; this is which
   *  member the reviewer was last working on, needed to resume correctly
   *  after a refresh. */
  activeMemberId: string | null;
  transactionStatus: NotQuiteTransactionStatus;
  /** True once every member has `applied: true`. Separate from
   *  transactionStatus so "all members handled, not yet confirmed via
   *  completeNotQuite" is representable -- matches the current app's
   *  distinction between "Not Quite" and "Not Quite Complete" actions. */
  allMembersHandled: boolean;
  enteredAt: string; // ISO 8601
  completedAt?: string; // ISO 8601
}
