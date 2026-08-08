/**
 * workspaceMetrics.ts -- Workspace Metrics (AG, 2026-08-02, "a live,
 * read-only telemetry view for the active workspace").
 *
 * STANDALONE SUBSYSTEM, by construction:
 * - PURE derivation over WorkspaceState (the dispatcher's existing read
 *   surface) -- it observes; it never dispatches, and nothing in the
 *   review pipeline imports this module. Deleting src/metrics/ and the
 *   window that renders it would leave review untouched.
 * - ZERO new persistence. Every number here recomputes from state the
 *   workspace already preserves: the pipeline outputs are re-derived on
 *   every load from the stored document bytes; reviewer activity comes
 *   from the review session's own persisted EVENT LOG (session.events --
 *   the audit trail that already survives save/resume); the cleanup
 *   record is deterministic per load (WorkspaceState.identityCleanup).
 *   Reopening a workspace therefore restores every metric exactly,
 *   through the existing preservation model alone.
 * - EXTENSIBLE as data: the output is MetricSection[] -- a flat,
 *   render-agnostic shape. New metrics are new entries here; the window
 *   renders whatever sections arrive and the review pipeline never
 *   changes.
 *
 * WORDING RULE (from the prompt): factual measurements only. Counts and
 * comparisons of counts; no time-saved or productivity estimates.
 */

import type { WorkspaceState } from "../workspace/Workspace.js";
import { decisionReduction, formatFewerDecisionsPercent } from "./decisionReduction.js";
import { partitionCandidatesByResolution } from "../engines/review/coverage.js";
import { decisionTrackerFigures } from "./decisionTracker.js";

export interface MetricValue {
  id: string;
  label: string;
  value: number | string;
  /** One factual sentence of context, rendered muted under the value. */
  note?: string;
}

export interface MetricSection {
  id: string;
  title: string;
  metrics: MetricValue[];
}

const m = (id: string, label: string, value: number | string, note?: string): MetricValue => ({ id, label, value, ...(note ? { note } : {}) });

/** Event-log tallies -- the reviewer-activity half of the metrics. The
 *  event vocabulary separates surfaces cleanly: individual decisions
 *  append `candidate-decided` (one per act), bulk actions append ONE
 *  `bulk-decided` carrying applied counts, group decisions ONE
 *  `group-decided` with memberCount -- so "actions taken" vs "items
 *  covered" is a straight read, never an estimate. */
interface ActivityTally {
  individualDecisions: number;
  bulkActions: number;
  bulkItemsCovered: number;
  groupActions: number;
  groupItemsCovered: number;
  ambiguityLinks: number;
  fixThisMemberActions: number;
  relationshipDismissals: number;
  importedDecisions: number;
  /** Decision Tracker miscount fix (2026-08-06): app.ts's applyOwnSuggestions
   *  runs ("Accept section" / accept-suggestions), anchored by
   *  "suggestions-accepted" -- see decisionTracker.ts's BATCH_ANCHOR_EVENTS.
   *  A separate bucket from bulkActions because each candidate here takes
   *  its OWN suggestion rather than one shared decision. */
  suggestionActions: number;
  suggestionItemsCovered: number;
  totalActions: number;
}

function tallyActivity(state: WorkspaceState): ActivityTally {
  const tally: ActivityTally = {
    individualDecisions: 0,
    bulkActions: 0,
    bulkItemsCovered: 0,
    groupActions: 0,
    groupItemsCovered: 0,
    ambiguityLinks: 0,
    fixThisMemberActions: 0,
    relationshipDismissals: 0,
    importedDecisions: 0,
    suggestionActions: 0,
    suggestionItemsCovered: 0,
    totalActions: 0,
  };
  for (const event of state.reviewSession?.events ?? []) {
    const payload = event.payload as Record<string, unknown>;
    switch (event.kind) {
      case "candidate-decided":
        // Bulk/group/suggestion-accept commands append BOTH per-candidate
        // candidate-decided events (tagged viaBulkApply / viaGroup* /
        // viaSuggestionAccept) AND their own single action event carrying
        // the counts -- count the ACTION once via the latter, and treat
        // only untagged candidate-decided events as individual reviewer
        // acts.
        if (
          payload["viaBulkApply"] === true ||
          payload["viaGroupConfirm"] === true ||
          payload["viaGroupRedact"] === true ||
          payload["viaGroupIgnore"] === true ||
          payload["viaGroupFlatten"] === true ||
          payload["viaSuggestionAccept"] === true
        ) {
          break;
        }
        tally.individualDecisions += 1;
        if (payload["viaAmbiguityLink"] === true) tally.ambiguityLinks += 1;
        break;
      case "bulk-decided":
        tally.bulkActions += 1;
        tally.bulkItemsCovered += typeof payload["appliedCount"] === "number" ? (payload["appliedCount"] as number) : 0;
        break;
      case "group-decided":
        tally.groupActions += 1;
        tally.groupItemsCovered += typeof payload["memberCount"] === "number" ? (payload["memberCount"] as number) : 0;
        break;
      case "not-quite-member-applied":
        tally.fixThisMemberActions += 1;
        break;
      case "relationship-dismissed":
        tally.relationshipDismissals += 1;
        break;
      case "decisions-imported":
        tally.importedDecisions += typeof payload["appliedCount"] === "number" ? (payload["appliedCount"] as number) : 0;
        break;
      case "suggestions-accepted":
        tally.suggestionActions += 1;
        tally.suggestionItemsCovered += typeof payload["appliedCount"] === "number" ? (payload["appliedCount"] as number) : 0;
        break;
      default:
        break;
    }
  }
  // One deliberate reviewer act per event, whatever its reach.
  tally.totalActions =
    tally.individualDecisions +
    tally.bulkActions +
    tally.groupActions +
    tally.fixThisMemberActions +
    tally.relationshipDismissals +
    tally.suggestionActions;
  return tally;
}

export function deriveWorkspaceMetrics(state: WorkspaceState): MetricSection[] {
  if (!state.documentLoaded) {
    return [{ id: "workspace", title: "Workspace", metrics: [m("no-document", "Document", "none loaded")] }];
  }
  const candidates = state.detection?.candidates ?? [];
  const decisions = state.reviewSession?.candidateDecisions ?? {};
  const decidedIds = Object.keys(decisions);
  // DECISION REDUCTION (AG, 2026-08-03): every figure below comes from the
  // ONE shared calculation in decisionReduction.ts rather than being
  // counted again here. This module used to sum `occurrenceIds.length`
  // itself in two places; that was a second implementation of the same
  // arithmetic, and the kind of quiet divergence this codebase keeps
  // removing (see engines/review/coverage.ts's own header on exactly this
  // hazard).
  //
  // TWO SCOPES, and the distinction is the whole point of this section:
  //   `fullReduction`     -- every detected candidate. The CEILING: what
  //                          this document's reduction will be once review
  //                          is finished. Fixed for the document.
  //   `resolvedReduction` -- only what the reviewer has resolved so far.
  //                          The RUNNING TALLY the review-status strip
  //                          shows; climbs from zero and lands exactly on
  //                          the ceiling at completion.
  //
  // Resolution comes from the SHARED partition in engines/review/
  // coverage.ts -- the same function the Decision Tracker's own scope uses,
  // so the two can never disagree about what "done" means. (Both used to
  // express this rule separately; see that function's own note.)
  const session = state.reviewSession;
  const resolvedCandidates = session && state.detection ? partitionCandidatesByResolution(session, state.detection).resolved : [];
  const fullReduction = decisionReduction(candidates);
  const tracker = decisionTrackerFigures(session, resolvedCandidates);
  const totalOccurrences = fullReduction.occurrenceCount;
  const decidedOccurrences = tracker.coveredOccurrenceCount;
  const groups = state.grouping?.entityGroupProposals ?? [];
  const groupedCandidateIds = new Set(groups.flatMap((g) => g.candidateIds));
  const structural = state.structuralRelationships?.proposals ?? [];
  const cleanup = state.identityCleanup;
  const tally = tallyActivity(state);

  const sections: MetricSection[] = [
    {
      id: "workspace",
      title: "Workspace",
      metrics: [
        m("document", "Document", state.fileName ?? "—"),
        m("occurrences", "Detected occurrences", totalOccurrences),
        m("candidates", "Unique candidates", candidates.length),
        m("groups", "Entity groups", groups.length, `${groupedCandidateIds.size} candidates grouped`),
      ],
    },
    {
      id: "review",
      title: "Review",
      metrics: [
        m(
          "ambiguity",
          "Ambiguity proposals",
          state.grouping?.ambiguityProposals.length ?? 0,
          cleanup ? `${cleanup.proposalsBefore} initially proposed` : undefined
        ),
        m("structural", "Structural proposals", structural.length),
        m("decided", "Candidates decided", `${decidedIds.length} / ${candidates.length}`),
        m("unresolved", "Unresolved items", state.readiness.unresolvedItemCount),
      ],
    },
    {
      id: "cleanup",
      title: "Cleanup",
      metrics: [
        m("proposals-removed", "Ambiguity proposals removed before review", cleanup?.proposalsRemoved ?? 0),
        m("options-removed", "Implausible identity options removed", cleanup?.optionsRemoved ?? 0, cleanup ? `${cleanup.optionsBefore} before, ${cleanup.optionsAfter} after` : undefined),
        m("inserted-word", "Inserted-word name proposals raised", cleanup?.insertedWordProposals ?? 0),
      ],
    },
    {
      id: "decisions",
      title: "Reviewer activity",
      metrics: [
        m("actions", "Decision actions taken", tally.totalActions),
        m("individual", "Individual decisions", tally.individualDecisions),
        m(
          "category",
          "Category and bulk actions",
          tally.bulkActions + tally.groupActions + tally.suggestionActions,
          `covering ${tally.bulkItemsCovered + tally.groupItemsCovered + tally.suggestionItemsCovered} items`
        ),
        m("links", "Identity links accepted", tally.ambiguityLinks),
        m("fix-this", "Fix-this member actions", tally.fixThisMemberActions),
        m("dismissals", "Relationship dismissals", tally.relationshipDismissals),
        m("reused", "Decisions reused from a prior review", tally.importedDecisions),
      ],
    },
    {
      id: "consolidation",
      title: "Consolidation",
      // DECISION TRACKER (AG, 2026-08-03, third revision): `made` and
      // `avoided` are the review-status panel's own figures -- necessarily
      // identical, because they are the same call on the same scope.
      //
      // `decision-units` is now labelled a FLOOR, not a ceiling. When Made
      // counted units there was a fixed end state ("2,324 when finished").
      // Now that Made counts human decisions, working by category pushes
      // Avoided ABOVE the unit-based figure -- so the honest statement is
      // "at least this many, more if you work by category," and the
      // unit-based number becomes the worst case rather than the target.
      //
      // The rest are reviewer ACTIVITY. `actions-so-far` counts every
      // deliberate act including ones that resolved nothing new (a changed
      // mind), which is precisely why the tracker's Made is derived
      // separately and is NOT this number -- see decisionTracker.ts.
      metrics: [
        m(
          "decision-units",
          "Distinct decisions this document requires",
          fullReduction.decisionUnitCount,
          `covering ${fullReduction.occurrenceCount.toLocaleString()} detected occurrences`
        ),
        m("made", "Decisions made", tracker.decisionsMade, `covering ${tracker.coveredOccurrenceCount.toLocaleString()} occurrences`),
        m(
          "avoided",
          "Repeated decisions avoided so far",
          tracker.avoidedDecisionCount,
          `${formatFewerDecisionsPercent(tracker)} fewer across the work completed so far; at least ${fullReduction.avoidedDecisionCount.toLocaleString()} when this document is finished, more if reviewed by category`
        ),
        m("actions-so-far", "Reviewer decision actions so far", tally.totalActions),
        m("items-covered", "Decision units those actions covered", decidedIds.length),
        m("occurrences-covered", "Document occurrences those actions covered", decidedOccurrences),
      ],
    },
  ];
  return sections;
}
