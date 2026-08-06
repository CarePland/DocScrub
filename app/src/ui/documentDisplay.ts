/**
 * documentDisplay.ts — Application Frame Refinement (AG, 2026-08-01).
 *
 * Pure truncation policy for the header's document identity display: "Up
 * to three document names when multiple documents are open. If more than
 * three documents are open: Document A • Document B • Document C • +4 ▼"
 * (spec's own example). DOM-free by construction, exactly like
 * visibleListAdvance.ts / triageQueue.ts — the renderer in app.ts decides
 * how names become elements; this decides only WHICH names show and how
 * many overflow.
 *
 * SPEC INTERPRETATION, documented per the standing documentation standard:
 * DocScrub's domain model has exactly ONE active document per workspace
 * (Workspace/ReviewSession own a single documentId). The spec's "open
 * documents" is therefore mapped to the reviewer's WORKING SET: the active
 * document first, followed by the other in-progress documents in the local
 * vault (the Recent Documents list, which is what one click of Resume
 * reopens). Alternatives considered: (a) showing only the active document
 * — rejected, the spec explicitly shows multiple names and an expansion
 * arrow; (b) a true multi-open-document model — a domain extension far
 * beyond a frame refinement, not attempted here. Reviewer impact: the
 * header names are one-click switches, which is what "what documents am I
 * working on?" practically means in a single-active-document application.
 */

export interface DocumentDisplaySummary {
  /** Names to render inline, in the order given (active document first). */
  shown: string[];
  /** How many additional names sit behind the "+N" expansion arrow. */
  overflow: number;
}

export function documentDisplaySummary(names: string[], limit = 3): DocumentDisplaySummary {
  if (limit < 1) return { shown: [], overflow: names.length };
  if (names.length <= limit) return { shown: [...names], overflow: 0 };
  return { shown: names.slice(0, limit), overflow: names.length - limit };
}
