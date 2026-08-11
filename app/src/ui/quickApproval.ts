/**
 * quickApproval.ts -- THE EXCEPTION-SCANNING STATE MACHINE (AG, 2026-08-10).
 *
 * ═══════════════════ THE INTERACTION THIS FILE EXISTS TO PROTECT ═══════════════════
 *
 *     scan · scan · ↓ · SPACE on an exception · scan · ↓ · SPACE · scan
 *     · Option+Enter · one group decision
 *
 * Every rule below is in service of that rhythm, and the rhythm is the
 * feature. The reviewer is not filling in fifty small forms; they are reading
 * a list looking for the two or three values that do not belong, and then
 * making ONE decision about the rest. Anything that interrupts the scan --
 * a confirmation, a per-row question, a focus jump -- costs more than it
 * could possibly return.
 *
 * ═══════════════════ DEFAULT INCLUDED, AND WHY THAT IS THE WHOLE DESIGN ═══════════════════
 *
 * Every row starts INCLUDED. The reviewer never checks the correct items,
 * only the wrong ones. Inverting that (start empty, tick the good ones) turns
 * a 3-press task into a 65-press task and turns the reviewer into a data
 * entry clerk for a claim the machine already made. `excludedIds` is
 * therefore the ONLY membership state, and it is empty on entry.
 *
 * ═══════════════════ EXCLUSION IS NOT A SEMANTIC DECISION ═══════════════════
 *
 * This is the invariant most likely to be eroded by a well-meaning future
 * change, so it is stated here as well as in the module that consumes it:
 *
 *     Excluding `Jeffrey Lam` from `Explained vocabulary` means
 *     EXACTLY ONE THING -- that he was rejected from THIS proposed group.
 *
 * It does not mean he is a Person. It does not mean he belongs to some other
 * category. It creates no `CandidateDecision`, no `AutomaticResolution`, no
 * semantic reclassification and no audit claim about what he is. An excluded
 * candidate returns to the remaining review population exactly as it was, and
 * may later appear in another supported group or go to individual review.
 *
 * The reviewer is never asked WHY. Asking would be the single most expensive
 * possible addition to this surface: it converts a one-keystroke exception
 * into a dialog, fifty times over, in the name of information DocScrub has no
 * use for. If a future feature genuinely needs the reason, it has to earn it
 * somewhere that is not the middle of a scan.
 *
 * ═══════════════════ COMPLETING THE SCAN DECIDES NOTHING ═══════════════════
 *
 * `complete()` moves the phase from `scanning` to `deciding` and does nothing
 * else. It means "I have finished identifying exceptions", never Keep,
 * Change, Redact, Ignore or acceptance. The decision is a separate, explicit
 * act in the `deciding` phase, and the reviewer can still back out of it.
 *
 * ═══════════════════ WHY THIS MODULE IS PURE ═══════════════════
 *
 * Same reason `reviewZone.ts` is pure, and the same history behind it: a
 * decision path that can only be verified in a browser is a decision path
 * this repository cannot verify at all (see verify/ui-smoke.ts's own
 * disclosure). Focus movement, toggle-and-advance, phase transitions and the
 * included/excluded split are all pure functions of state here, pinned by
 * verify/quick-approval-verification.ts without a DOM. app.ts owns rendering
 * and raw key events and nothing else.
 *
 * ═══════════════════ SEPARATE FROM THE ZONE, ON PURPOSE ═══════════════════
 *
 * The Review Zone bounds bulk actions BY POSITION (the next 24 unresolved) to
 * keep bulk review honest. Quick Approval bounds them BY EVIDENCE (a cohort
 * the engine can name). Those are different safety arguments, and a scan
 * whose membership silently changed as Zone chunks retired underneath it
 * would be neither. This state machine therefore FREEZES its membership on
 * entry, shares no state with the Zone, and imports nothing from
 * reviewZone.ts. The Zone rework in flight cannot break it and it cannot
 * break the Zone rework.
 */

import type { ProposedGroup, ProposedGroupId, ProposedGroupMember } from "../engines/review/proposedGroups.js";

/**
 * `scanning`  -- the reviewer is looking for exceptions. No decision exists.
 * `deciding`  -- the reviewer said they are done scanning and is choosing the
 *                one action to apply. Still no decision exists; Escape from
 *                here returns to `scanning` with every exclusion intact.
 */
export type QuickApprovalPhase = "scanning" | "deciding";

export interface QuickApprovalSession {
  groupId: ProposedGroupId;
  /**
   * The engine's proposal, FROZEN AT ENTRY, in scan order.
   *
   * Frozen rather than recomputed, unlike the Zone, and the difference is
   * deliberate. The Zone is a window onto live remaining work and must move
   * as work is done. A scan is a single reviewer act over a stated set: the
   * header says "68 proposed", the reviewer scans 68 rows, and the action
   * covers what is left of those 68. A membership that changed underneath
   * that would make the header a lie and could sweep an item into a bulk
   * action the reviewer never scanned. Same materialization principle as the
   * Zone ("the record says which four"), different lifetime.
   */
  members: readonly ProposedGroupMember[];
  /** The reviewer's exceptions. Empty on entry -- see the module header. */
  excludedIds: ReadonlySet<string>;
  /** Index into `members`. Always in range while `members` is non-empty. */
  focusIndex: number;
  phase: QuickApprovalPhase;
}

export function beginQuickApproval(group: ProposedGroup): QuickApprovalSession {
  return {
    groupId: group.id,
    members: group.members,
    excludedIds: new Set<string>(),
    focusIndex: 0,
    phase: "scanning",
  };
}

/* ─────────────────────────── read-only queries ─────────────────────────── */

export function isExcluded(session: QuickApprovalSession, candidateId: string): boolean {
  return session.excludedIds.has(candidateId);
}

/** The members the group action will apply to, in scan order. */
export function includedMembers(session: QuickApprovalSession): ProposedGroupMember[] {
  return session.members.filter((m) => !session.excludedIds.has(m.candidateId));
}

/** The members the group action must NOT touch, in scan order. */
export function excludedMembers(session: QuickApprovalSession): ProposedGroupMember[] {
  return session.members.filter((m) => session.excludedIds.has(m.candidateId));
}

export function includedIds(session: QuickApprovalSession): string[] {
  return includedMembers(session).map((m) => m.candidateId);
}

export function focusedMember(session: QuickApprovalSession): ProposedGroupMember | null {
  return session.members[session.focusIndex] ?? null;
}

export interface QuickApprovalCounts {
  proposed: number;
  included: number;
  excluded: number;
}

export function quickApprovalCounts(session: QuickApprovalSession): QuickApprovalCounts {
  const excluded = session.members.filter((m) => session.excludedIds.has(m.candidateId)).length;
  return { proposed: session.members.length, included: session.members.length - excluded, excluded };
}

/* ─────────────────────────── transitions ─────────────────────────── */

/**
 * CLAMPED, NEVER WRAPPED.
 *
 * A scan has a beginning and an end, and both are meaningful: reaching the
 * bottom is how the reviewer knows they are finished. A list that wrapped
 * from the last row to the first would let someone scan silently past the end
 * and start again without noticing -- the one failure this surface cannot
 * afford, because its entire premise is that the reviewer saw every row.
 * Clamping makes "I am at the end" a thing the keyboard tells you.
 */
export function moveFocus(session: QuickApprovalSession, delta: number): QuickApprovalSession {
  if (session.members.length === 0) return session;
  const next = Math.min(Math.max(session.focusIndex + delta, 0), session.members.length - 1);
  if (next === session.focusIndex) return session;
  return { ...session, focusIndex: next };
}

export function focusRow(session: QuickApprovalSession, index: number): QuickApprovalSession {
  if (session.members.length === 0) return session;
  const next = Math.min(Math.max(index, 0), session.members.length - 1);
  if (next === session.focusIndex) return session;
  return { ...session, focusIndex: next };
}

/**
 * TOGGLE THE FOCUSED ROW, THEN ADVANCE. The Space key's whole job.
 *
 * TOGGLE, not "exclude": pressing Space on an already-excluded row puts it
 * back in. The reviewer scanning at speed will occasionally hit the wrong
 * row, and the correction has to be the same key they are already pressing --
 * not an undo, not a different key, not a trip back to the mouse.
 *
 * ADVANCE AFTER, not before, and only ever by one. The reviewer's eyes are
 * already on the next row when their thumb comes down; leaving the cursor
 * behind would make every exception cost a Space AND a Down. Advancing is
 * therefore part of the same gesture. At the last row the cursor stays put --
 * `moveFocus`'s clamp -- so the final row can still be toggled and re-toggled
 * without the cursor falling off the end.
 *
 * NO OTHER KEY DOES THIS. Space is enough; binding a second key to toggling
 * would make an accidental press destructive on a surface built for speed.
 */
export function toggleFocused(session: QuickApprovalSession): QuickApprovalSession {
  const member = focusedMember(session);
  if (!member) return session;
  return advanceAfterToggle(toggleMember(session, member.candidateId));
}

/**
 * Toggle a NAMED row without moving the cursor -- the mouse path.
 *
 * Clicking a row toggles its membership and moves the cursor there, matching
 * what the keyboard does at that row, minus the advance: a click already told
 * us where the reviewer is looking, and advancing the cursor away from the
 * row they just clicked would fight the pointer. `toggleFocused` is the
 * keyboard's compound gesture; this is its component part.
 */
export function toggleMember(session: QuickApprovalSession, candidateId: string): QuickApprovalSession {
  const index = session.members.findIndex((m) => m.candidateId === candidateId);
  if (index < 0) return session;
  const excluded = new Set(session.excludedIds);
  if (excluded.has(candidateId)) excluded.delete(candidateId);
  else excluded.add(candidateId);
  return { ...session, excludedIds: excluded, focusIndex: index };
}

function advanceAfterToggle(session: QuickApprovalSession): QuickApprovalSession {
  return moveFocus(session, 1);
}

/**
 * FINISH THE EXCEPTION-SCANNING PHASE. Creates no decision of any kind.
 *
 * Bound to Option+Enter rather than bare Enter, deliberately and at a real
 * cost in discoverability. Bare Enter already means "commit / go deeper"
 * everywhere else in DocScrub, and it is the key most likely to be struck by
 * reflex while reading a list. Completing a 65-item scan should be a thing
 * the reviewer MEANT; a modifier chord is the cheapest available way to make
 * an accidental completion essentially impossible. The visible Done button
 * carries the same meaning for anyone who never learns the chord, and the
 * chord is printed on it.
 *
 * Idempotent: completing an already-complete scan is a no-op, so a repeated
 * chord cannot skip past the decision step.
 */
export function completeScan(session: QuickApprovalSession): QuickApprovalSession {
  if (session.phase === "deciding") return session;
  return { ...session, phase: "deciding" };
}

/**
 * Back out one level: `deciding` returns to `scanning` with every exclusion
 * intact; `scanning` returns null, meaning the caller should leave the mode
 * entirely and apply nothing.
 *
 * The exclusions survive the first step because a reviewer who reaches the
 * decision step and wants one more look has not changed their mind about the
 * three exceptions they already found. Discarding them there would punish
 * exactly the careful behaviour this surface wants to encourage.
 *
 * Leaving from `scanning` applies NO group decision and creates no state.
 * The scan is simply abandoned; the candidates are untouched and remain in
 * ordinary review. There is nothing to warn about and nothing to confirm,
 * because nothing was ever committed.
 */
export function backOut(session: QuickApprovalSession): QuickApprovalSession | null {
  if (session.phase === "deciding") return { ...session, phase: "scanning" };
  return null;
}
