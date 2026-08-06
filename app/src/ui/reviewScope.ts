/**
 * REVIEW SCOPE — Pass 1 of the scope-inspector architecture (AG,
 * 2026-08-03; design discussion "Selection-Driven Inspector" → "review
 * scope is the abstraction, selection is one way a scope is produced").
 *
 * A ReviewScope is the set of review-work units the reviewer is currently
 * "holding" — the thing the inspector pane explains and the thing
 * scope-level actions act on. A single focused entity is the smallest
 * possible scope; the stage's whole remaining workload is the largest;
 * a reviewer-assembled selection and a structural-relationship card sit
 * between. The resolver below is TOTAL: there is always a current scope,
 * because the stage remainder is always a scope.
 *
 * SINGLE-CONSUMER INVARIANT (the keystone): `resolveReviewScope` is called
 * from exactly ONE place in app.ts (`currentReviewScope`), and every
 * surface that explains or acts on "the current scope" — the inspector
 * pane, the scope-mode keyboard gate, the command-bar legend, the decision
 * provenance stamp — reads that one function. A second, independent answer
 * to "what is the current scope" anywhere is the seed of the
 * card-targeted-letters bug class (see app.ts's handleCardDecisionKey doc
 * comment), one level up. `verify/ui-smoke.ts` asserts the single call
 * site structurally.
 *
 * PRECEDENCE, and why it looks the way it does. The design discussion
 * proposed "selection wins over focus"; reconciling that with the shipped
 * state model surfaced three real conflicts, resolved as follows rather
 * than worked around silently (full record in the Pass 1 findings doc):
 *
 *  1. artifact-focus (the structural-card cursor) ranks FIRST. The card
 *     cursor is an explicit "working the cards now" state, and the
 *     card-targeted-letters law already makes the card the working object
 *     for K/C/R/I. Ranking it below selection would make the inspector
 *     disagree with what the letters do — the exact disagreement this
 *     module exists to prevent.
 *  2. selection ranks above item-focus (the design's own rule: a
 *     deliberately assembled set outranks a positional cursor). While a
 *     selection scope is active the focused row renders as a PARKED
 *     cursor (precedent: the rows-then-cards seam parks the row cursor
 *     while cards are the working object) and plain decision letters
 *     REFUSE with narration instead of acting on a row whose panel is not
 *     on screen — "plain key = focused object" is preserved by making the
 *     refusal explicit, never by silently retargeting letters at N items.
 *  3. stage-remainder is reachable by an explicit reviewer act (Escape =
 *     out one level, from the item to the workload), NOT by focus
 *     emptiness: FocusNavigator reconciles focus onto an item at all
 *     times and records no reviewer-vs-automatic provenance, so "nothing
 *     is explicitly selected" is unrepresentable in the shipped state
 *     model. `widened` carries that reviewer act. Whether stage ENTRY
 *     should also land on the remainder scope (the design's "initial
 *     arrival" state) needs either a focus-provenance bit or an
 *     entry-behavior change — a product decision deliberately NOT taken
 *     in Pass 1.
 *
 * Pass 1 scope: item-check only. The types carry the stage so later
 * passes can generalize without reshaping serialized descriptors.
 */

/** The two axes of reviewer work (the active-work model's item/artifact
 *  distinction, stages.ts): traversable candidate rows, and review
 *  artifacts (structural-relationship cards) that carry work but are not
 *  FocusNavigator items. */
export type ScopeUnitAxis = "item" | "artifact";

export interface ScopeUnitRef {
  axis: ScopeUnitAxis;
  id: string;
}

export type ScopeSource =
  | { kind: "stage-remainder"; stage: "item-check" }
  | { kind: "selection"; stage: "item-check" }
  | { kind: "item-focus"; stage: "item-check"; itemId: string }
  | { kind: "artifact-focus"; stage: "item-check"; artifactId: string };

export interface ReviewScope {
  source: ScopeSource;
  /** The units the scope holds, in display order. For item-focus and
   *  artifact-focus this is the single unit; for stage-remainder it is
   *  every displayed remaining item followed by every remaining artifact. */
  units: ScopeUnitRef[];
}

/** Inputs are handed in rather than read from module state so this stays a
 *  pure derivation — recomputed fresh on every consult, never cached (the
 *  same purity contract the Item Check work queue is verified under). */
export interface ScopeResolutionInputs {
  /** Remaining work as currently DISPLAYED (the visible queue ids, in
   *  queue order) — kept deliberately consistent with the "rows on screen
   *  and counts never disagree" contract of itemCheckPoolIds/
   *  visibleItemCheckIds rather than the un-narrowed pool. */
  remainderItemIds: readonly string[];
  /** Undismissed, unaddressed structural-relationship proposal ids — the
   *  artifact half of the remaining work. */
  remainderArtifactIds: readonly string[];
  /** The reviewer's checked rows, already intersected with the displayed
   *  list and in display order. Empty = no selection scope. */
  selectedItemIds: readonly string[];
  /** The state-focused item, when focus sits in this stage. */
  focusedItemId: string | null;
  /** The structural-card cursor (structuralCardFocusPending), when set. */
  artifactCursorId: string | null;
  /** True while the reviewer has explicitly widened out of the focused
   *  item (Escape); skips item-focus, never selection or the card. */
  widened: boolean;
}

export function resolveReviewScope(inputs: ScopeResolutionInputs): ReviewScope {
  if (inputs.artifactCursorId !== null) {
    return {
      source: { kind: "artifact-focus", stage: "item-check", artifactId: inputs.artifactCursorId },
      units: [{ axis: "artifact", id: inputs.artifactCursorId }],
    };
  }
  if (inputs.selectedItemIds.length > 0) {
    return {
      source: { kind: "selection", stage: "item-check" },
      units: inputs.selectedItemIds.map((id) => ({ axis: "item" as const, id })),
    };
  }
  if (!inputs.widened && inputs.focusedItemId !== null) {
    return {
      source: { kind: "item-focus", stage: "item-check", itemId: inputs.focusedItemId },
      units: [{ axis: "item", id: inputs.focusedItemId }],
    };
  }
  return {
    source: { kind: "stage-remainder", stage: "item-check" },
    units: [
      ...inputs.remainderItemIds.map((id) => ({ axis: "item" as const, id })),
      ...inputs.remainderArtifactIds.map((id) => ({ axis: "artifact" as const, id })),
    ],
  };
}

/**
 * Compact, greppable serialization of a scope for the decision-provenance
 * stamp (Commands.ts `scope?` / the review event log). Records the scope
 * the reviewer was WORKING IN when an action fired — not the set the
 * action applied to (the command's own candidateId(s) already record
 * that). Stable format; treat as append-only vocabulary:
 *
 *   item-check/item:<candidateId>
 *   item-check/selection:<count>
 *   item-check/artifact:<proposalId>
 *   item-check/remainder:<count>
 */
export function scopeDescriptor(scope: ReviewScope): string {
  const s = scope.source;
  switch (s.kind) {
    case "item-focus":
      return `${s.stage}/item:${s.itemId}`;
    case "selection":
      return `${s.stage}/selection:${scope.units.length}`;
    case "artifact-focus":
      return `${s.stage}/artifact:${s.artifactId}`;
    case "stage-remainder":
      return `${s.stage}/remainder:${scope.units.length}`;
  }
}
