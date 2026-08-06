/**
 * WorkspaceAnalysisCommands.ts — this subsystem's own small command
 * vocabulary, deliberately NOT part of `src/domain/Commands.ts`'s
 * `AnyCommand` union. Mirrors that file's discriminated-union style
 * (matched for a reviewer coming from the review pipeline's code, not
 * imported from it) but stays a completely separate type -- adding a
 * command here can never widen or touch `AnyCommand`, `CommandDispatcher`,
 * or any review-pipeline switch statement that exhausts it.
 *
 * Scope matches the UI actions the spec explicitly permits: accept a
 * proposed grouping as-is, split a grouping into smaller pieces, and
 * merge two groupings ONLY when the analysis independently confirms the
 * combined set still meets the relationship threshold (see
 * `../engine/clustering.ts`'s `canMerge` -- there is deliberately no
 * "combine anyway" command). Loading files and running analysis is async
 * I/O and lives as its own method on `WorkspaceAnalysisSession`, not as a
 * dispatched command -- the same "async orchestration stays off the
 * synchronous reducer path" split `ReviewWorkspace.loadDocument()` /
 * `WorkspaceCommandDispatcher` already establish elsewhere in this
 * codebase, applied independently here rather than reused from there.
 */

export interface AcceptGroupingCommand {
  type: "accept-grouping";
  groupingId: string;
}

/** `newGroups` must be a partition of the target grouping's current
 *  `documentIds` -- every original member appears in exactly one of the
 *  new groups, no member is added or dropped. Splitting never needs a
 *  threshold check: every subset of an already-valid grouping remains
 *  internally valid (see `clustering.ts`'s clique-subset reasoning). */
export interface SplitGroupingCommand {
  type: "split-grouping";
  groupingId: string;
  newGroups: string[][];
}

/** Merges exactly two existing groupings into one, gated by
 *  `canMerge()`. Two at a time, not N at a time -- keeps the validation
 *  and the resulting audit trail ("grouping X and grouping Y were merged
 *  because...") simple to state and simple to reverse one step at a
 *  time; a reviewer wanting to combine three groupings merges twice. */
export interface MergeGroupingsCommand {
  type: "merge-groupings";
  groupingIdA: string;
  groupingIdB: string;
}

/** Discards the current analysis (documents, result, groupings) and
 *  returns to the idle state -- e.g. before analyzing a different batch
 *  of imports in the same session. */
export interface ResetCommand {
  type: "reset";
}

export type WorkspaceAnalysisCommand =
  | AcceptGroupingCommand
  | SplitGroupingCommand
  | MergeGroupingsCommand
  | ResetCommand;

export interface WorkspaceAnalysisCommandResult {
  ok: boolean;
  reason?: string;
}
