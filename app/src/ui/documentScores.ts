/**
 * documentScores.ts -- diagnostic scoring model (2026-07-30, "Diagnostic
 * Scoring UI" instruction). TEMPORARY DEVELOPMENT FEATURE: the three
 * metrics (Extraction / Review / Overall) and the "why did the score just
 * change?" justification text rendered in the workspace chrome exist so
 * Andrew can validate that the scoring model behaves intuitively during
 * real document review. The FORMULAS in this file are explicitly expected
 * to change after real-world testing; the STRUCTURE is what should last.
 *
 * DESIGN REQUIREMENT (verbatim from the instruction): "Build the system so
 * the displayed explanation comes from the same calculation path that
 * updates the scores." Made structural here the same way stages.ts made
 * "derive, never duplicate" structural:
 *
 *   computeDocumentScores() produces BOTH the three metric values AND the
 *   leaf factor values (plain numbers, keyed by ScoreFactorId) that those
 *   metrics were computed FROM, in one pass. explainScoreChange() then
 *   derives the justification purely by diffing two of those reports --
 *   it performs no scoring of its own and reads no state the scorer
 *   didn't already emit. There is no way for the explanation to describe
 *   a change the scores didn't actually undergo, or vice versa, because
 *   neither has an independent input.
 *
 * Pure module, no DOM, no imports from app.ts -- unit-tested by
 * verify/document-scores-verification.ts, same convention as
 * itemCheckQuery.ts / visibleListAdvance.ts / itemCheckCategoryView.ts.
 *
 * WHAT EACH METRIC MEANS (per the instruction):
 *
 * - Extraction: automatic document processing success, derived from
 *   extraction results only. Inputs are immutable for the lifetime of a
 *   loaded document (processingWarnings, features.unsupported, and the
 *   embedded-image scan below all come from the parse), so this metric
 *   stabilizes the moment extraction completes -- by construction, not by
 *   caching.
 *
 * - Review: completion of reviewer work, recomputed continuously. Derived
 *   from the SAME StageStatus values stages.ts already computes for the
 *   stage tabs (itemCount/unresolvedCount per stage) -- never a second
 *   "is this resolved" rule. Covers ambiguity-check, group-check, and
 *   item-check today; the instruction also names Extract Review (future)
 *   and QA as reviewer work, but this build has no interactive QA model
 *   and no Extract Review stage yet (see render()'s own qa branch in
 *   app.ts) -- when either gains real reviewer actions, it joins the
 *   reviewStages list below and the factor table, nothing else changes.
 *
 * - Overall: document readiness. Synthesizes extraction quality, reviewer
 *   completion, verification (QA) status, and blocking issues:
 *
 *     overall = 0.30 * extraction
 *             + 0.55 * review
 *             + 0.15 * (verification current AND passed ? 100 : 0)
 *             - 10 per current-verification warning
 *             - 25 per current-verification blocker,  clamped to [0, 100]
 *
 *   Weights are a first guess, expected to evolve; the verification
 *   component is deliberately worth 15 points so "reviewed but never
 *   generated/verified output" visibly reads as not-ready, matching
 *   readiness.exportEnabled's own gate. A STALE verification (decisions
 *   changed since generateOutput) counts as not verified -- same
 *   staleness rule Workspace.currentVerification() already applies; this
 *   module only reads readiness.verificationCurrent, it never re-derives
 *   staleness.
 *
 * EMBEDDED IMAGES ("unsupported image discovered"): this pipeline cannot
 * inspect image content for PII at all (no OCR -- images are not among
 * DocumentParser's text-bearing parts), so every embedded image in the
 * archive is an unsupported object from extraction's point of view and
 * deducts from Extraction. Per Andrew's explicit note, "blank" images are
 * IGNORED -- they carry no content a reviewer could be missing.
 *
 * JUDGMENT CALL (underspecified: what exactly is a "blank" image?):
 * treated as blank here: (a) a zero-byte media part, and (b) a PNG or GIF
 * whose header declares a 0- or 1-pixel dimension (the classic 1x1
 * spacer/placeholder image). Alternatives considered: byte-size
 * thresholds (arbitrary, and a small real photo would be wrongly
 * ignored); actually decoding pixels to detect uniform color (requires an
 * image decoder -- over-engineering for a diagnostic whose formulas will
 * change, and canvas decoding would make this module async and
 * DOM-dependent). Reviewer impact if this definition is too narrow: a
 * visually-blank-but-nonempty image deducts from Extraction when it
 * shouldn't -- visible immediately in the diagnostic text as an
 * "Unsupported image" line, which is exactly the kind of misbehavior this
 * temporary UI exists to surface. JPEG/EMF/WMF are never treated as blank
 * (their headers don't give dimensions at a fixed offset; scanning them
 * is not worth it for a temporary diagnostic).
 */

import type { StageStatus, WorkflowStage } from "../domain/FocusState.js";
import type { WorkspaceReadiness } from "../workspace/Workspace.js";

/** The extraction-derived slice of DocumentModel this module reads --
 *  structural (DocumentModel is assignable) so the verify suite can build
 *  minimal inputs without constructing a full parsed document. */
export interface ExtractionScoreSource {
  processingWarnings: readonly string[];
  features: { unsupported: readonly string[] };
  sourceArchive: { parts: ReadonlyMap<string, Uint8Array> };
}

export interface DocumentScoreInputs {
  documentId: string;
  extraction: ExtractionScoreSource;
  stageStatuses: readonly StageStatus[];
  readiness: WorkspaceReadiness;
}

/** Leaf signals the metrics are computed from. Every id has a phrasing
 *  entry in FACTOR_PHRASING below -- the compiler enforces the pairing via
 *  the Record type, so a new factor cannot silently lack an explanation. */
export type ScoreFactorId =
  | "processing-warnings" // count of DocumentModel.processingWarnings
  | "unsupported-content" // count of features.unsupported flags
  | "unsupported-images" // count of NON-BLANK embedded images (see above)
  | "ambiguity-resolved" // resolved item count, ambiguity-check
  | "groups-resolved" // resolved item count, group-check
  | "items-resolved" // resolved item count, item-check
  | "qa-warnings" // current-verification warning findings
  | "qa-blockers" // current-verification blocker findings
  | "output-verified" // 1 while verification is current AND passed
  | "output-verification-failed"; // 1 while verification is current AND failed

export interface DocumentScoreReport {
  documentId: string;
  /** 0-100, rounded to one decimal (deltas between renders are routinely
   *  sub-integer -- e.g. one decision among many items). */
  extraction: number;
  review: number;
  overall: number;
  factors: Record<ScoreFactorId, number>;
}

export type ScoreMetric = "extraction" | "review" | "overall";

export interface ScoreChange {
  /** Only metrics whose rounded value actually moved, in fixed
   *  extraction/review/overall order. */
  deltas: { metric: ScoreMetric; delta: number }[];
  /** Human phrasings of the factor diffs that caused the movement --
   *  derived from the SAME factor values the scores were computed from. */
  reasons: string[];
}

const round1 = (value: number): number => Math.round(value * 10) / 10;
const clamp = (value: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, value));

// ---------------------------------------------------------------------------
// Extraction signals
// ---------------------------------------------------------------------------

const IMAGE_PART_PATTERN = /\/media\/[^/]+\.(png|jpe?g|gif|bmp|tiff?|emf|wmf|svg)$/i;

function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

function isGif(bytes: Uint8Array): boolean {
  return bytes.length >= 10 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38;
}

/** See this file's top doc comment ("what exactly is a 'blank' image?")
 *  for the definition and its disclosed limits. Exported for the verify
 *  suite. */
export function isBlankImage(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return true;
  if (isPng(bytes)) {
    // IHDR is always the first chunk: width at bytes 16-19, height at
    // 20-23, both big-endian (PNG spec §11.2.2).
    const width = (bytes[16]! << 24) | (bytes[17]! << 16) | (bytes[18]! << 8) | bytes[19]!;
    const height = (bytes[20]! << 24) | (bytes[21]! << 16) | (bytes[22]! << 8) | bytes[23]!;
    return width <= 1 && height <= 1;
  }
  if (isGif(bytes)) {
    // Logical screen width at bytes 6-7, height at 8-9, little-endian.
    const width = bytes[6]! | (bytes[7]! << 8);
    const height = bytes[8]! | (bytes[9]! << 8);
    return width <= 1 && height <= 1;
  }
  return false;
}

export interface ExtractionSignals {
  processingWarningCount: number;
  unsupportedFeatureCount: number;
  /** Non-blank embedded images only -- blank ones are ignored entirely
   *  (they appear in neither the score nor the justification text). */
  unsupportedImageCount: number;
}

export function collectExtractionSignals(source: ExtractionScoreSource): ExtractionSignals {
  let unsupportedImageCount = 0;
  for (const [name, bytes] of source.sourceArchive.parts) {
    if (!IMAGE_PART_PATTERN.test(name)) continue;
    if (!isBlankImage(bytes)) unsupportedImageCount += 1;
  }
  return {
    processingWarningCount: source.processingWarnings.length,
    unsupportedFeatureCount: source.features.unsupported.length,
    unsupportedImageCount,
  };
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** The stages whose per-item completion constitutes "reviewer work" today
 *  -- see the Review metric note in this file's top doc comment for why qa
 *  is absent and how a future stage joins. */
const REVIEW_STAGES: readonly WorkflowStage[] = ["ambiguity-check", "group-check", "item-check"];

function resolvedCount(statuses: readonly StageStatus[], stage: WorkflowStage): number {
  const status = statuses.find((s) => s.stage === stage);
  return status ? status.itemCount - status.unresolvedCount : 0;
}

export function computeDocumentScores(inputs: DocumentScoreInputs): DocumentScoreReport {
  const signals = collectExtractionSignals(inputs.extraction);

  // Extraction: start from a fully successful parse (the document DID
  // load -- a failed parse never reaches scoring at all) and deduct per
  // degradation. Per-item deductions are first-guess magnitudes, expected
  // to evolve.
  const extraction = clamp(
    100 -
      3 * signals.processingWarningCount -
      5 * signals.unsupportedFeatureCount -
      5 * signals.unsupportedImageCount,
    0,
    100
  );

  // Review: resolved fraction across all review stages' items, pooled --
  // one item is one unit of reviewer work regardless of which stage it
  // sits in (a 3-item ambiguity list should not weigh as much as a
  // 200-item Item Check). A document with nothing to review is 100.
  // REVIEW ARTIFACTS (AG, 2026-08-02): a structural relationship proposal
  // is one unit of reviewer work exactly as a row is -- it must be acted
  // on before the stage (and the document) is finished, and the workflow
  // now treats it that way. Excluding it here would have let Review read
  // 100% while the workflow still, correctly, showed work remaining: two
  // answers to one question, which is the divergence this whole pass
  // removes. Same pooling rule as items, same "nothing to review is 100".
  let totalItems = 0;
  let totalResolved = 0;
  for (const stage of REVIEW_STAGES) {
    const status = inputs.stageStatuses.find((s) => s.stage === stage);
    if (!status) continue;
    totalItems += status.itemCount + status.artifactCount;
    totalResolved += status.itemCount - status.unresolvedCount + (status.artifactCount - status.unresolvedArtifactCount);
  }
  const review = totalItems === 0 ? 100 : (100 * totalResolved) / totalItems;

  const verifiedPassing = inputs.readiness.verificationCurrent && inputs.readiness.verificationPassed === true;
  const verifiedFailing = inputs.readiness.verificationCurrent && inputs.readiness.verificationPassed === false;
  const qaWarnings = inputs.readiness.verificationCurrent ? inputs.readiness.verificationWarningCount : 0;
  const qaBlockers = inputs.readiness.verificationCurrent ? inputs.readiness.verificationBlockerCount : 0;

  const overall = clamp(
    0.3 * extraction + 0.55 * review + 0.15 * (verifiedPassing ? 100 : 0) - 10 * qaWarnings - 25 * qaBlockers,
    0,
    100
  );

  return {
    documentId: inputs.documentId,
    extraction: round1(extraction),
    review: round1(review),
    overall: round1(overall),
    factors: {
      "processing-warnings": signals.processingWarningCount,
      "unsupported-content": signals.unsupportedFeatureCount,
      "unsupported-images": signals.unsupportedImageCount,
      "ambiguity-resolved": resolvedCount(inputs.stageStatuses, "ambiguity-check"),
      "groups-resolved": resolvedCount(inputs.stageStatuses, "group-check"),
      "items-resolved": resolvedCount(inputs.stageStatuses, "item-check"),
      "qa-warnings": qaWarnings,
      "qa-blockers": qaBlockers,
      "output-verified": verifiedPassing ? 1 : 0,
      "output-verification-failed": verifiedFailing ? 1 : 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Explanation (the diff side of the same calculation path)
// ---------------------------------------------------------------------------

interface FactorPhrasing {
  increase(by: number): string;
  decrease(by: number): string;
}

/** Kept in THIS module, beside the factors it phrases, so the model and
 *  its explanations evolve together -- a factor cannot gain a new meaning
 *  without its wording being one screen away. Wording follows the
 *  instruction's own examples where it gave them ("Resolved ambiguity",
 *  "Unsupported image discovered", "QA warning added"); item-check items
 *  are called "items" (the UI's own Item Check vocabulary) rather than
 *  the example's "entities", which this codebase reserves for entity
 *  groups. */
const FACTOR_PHRASING: Record<ScoreFactorId, FactorPhrasing> = {
  "processing-warnings": {
    increase: (n) => (n === 1 ? "Processing warning added" : `${n} processing warnings added`),
    decrease: (n) => (n === 1 ? "Processing warning cleared" : `${n} processing warnings cleared`),
  },
  "unsupported-content": {
    increase: (n) => (n === 1 ? "Unsupported content discovered" : `${n} unsupported content types discovered`),
    decrease: (n) => (n === 1 ? "Unsupported content no longer flagged" : `${n} unsupported content types no longer flagged`),
  },
  "unsupported-images": {
    increase: (n) => (n === 1 ? "Unsupported image discovered" : `${n} unsupported images discovered`),
    decrease: (n) => (n === 1 ? "Unsupported image no longer counted" : `${n} unsupported images no longer counted`),
  },
  "ambiguity-resolved": {
    increase: (n) => (n === 1 ? "Resolved ambiguity" : `Resolved ${n} ambiguities`),
    decrease: (n) => (n === 1 ? "1 ambiguity back to unresolved" : `${n} ambiguities back to unresolved`),
  },
  "groups-resolved": {
    increase: (n) => (n === 1 ? "Entity group completed" : `${n} entity groups completed`),
    decrease: (n) => (n === 1 ? "1 entity group back to unresolved" : `${n} entity groups back to unresolved`),
  },
  "items-resolved": {
    increase: (n) => (n === 1 ? "1 additional item completed" : `${n} additional items completed`),
    decrease: (n) => (n === 1 ? "1 item back to unresolved" : `${n} items back to unresolved`),
  },
  "qa-warnings": {
    increase: (n) => (n === 1 ? "QA warning added" : `${n} QA warnings added`),
    decrease: (n) => (n === 1 ? "QA warning cleared" : `${n} QA warnings cleared`),
  },
  "qa-blockers": {
    increase: (n) => (n === 1 ? "QA blocker added" : `${n} QA blockers added`),
    decrease: (n) => (n === 1 ? "QA blocker cleared" : `${n} QA blockers cleared`),
  },
  "output-verified": {
    increase: () => "Output verified against current decisions",
    decrease: () => "Verification no longer current (decisions changed)",
  },
  "output-verification-failed": {
    increase: () => "Output verification failed",
    decrease: () => "Output verification failure cleared",
  },
};

/** Fixed iteration order so the justification reads reviewer-work-first
 *  (the common case during review), then extraction, then QA. */
const FACTOR_ORDER: readonly ScoreFactorId[] = [
  "ambiguity-resolved",
  "groups-resolved",
  "items-resolved",
  "processing-warnings",
  "unsupported-content",
  "unsupported-images",
  "qa-warnings",
  "qa-blockers",
  "output-verified",
  "output-verification-failed",
];

const METRIC_ORDER: readonly ScoreMetric[] = ["extraction", "review", "overall"];

/**
 * Why did the scores move between `previous` and `next`? Returns null when
 * nothing changed (renders happen for plenty of non-scoring reasons --
 * autosave, panel toggles -- and the last real justification should stay
 * on screen through them), and null when the two reports describe
 * different documents (a fresh load is not a "change" to explain).
 */
export function explainScoreChange(previous: DocumentScoreReport, next: DocumentScoreReport): ScoreChange | null {
  if (previous.documentId !== next.documentId) return null;

  const deltas: ScoreChange["deltas"] = [];
  for (const metric of METRIC_ORDER) {
    const delta = round1(next[metric] - previous[metric]);
    if (delta !== 0) deltas.push({ metric, delta });
  }

  const reasons: string[] = [];
  for (const id of FACTOR_ORDER) {
    const diff = next.factors[id] - previous.factors[id];
    if (diff > 0) reasons.push(FACTOR_PHRASING[id].increase(diff));
    else if (diff < 0) reasons.push(FACTOR_PHRASING[id].decrease(-diff));
  }

  if (deltas.length === 0 && reasons.length === 0) return null;
  return { deltas, reasons };
}

const METRIC_LABELS: Record<ScoreMetric, string> = { extraction: "Extraction", review: "Review", overall: "Overall" };

/** The exact multi-line text the diagnostic area shows: signed metric
 *  deltas (one decimal), a blank line, then the reasons. Deliberately
 *  plain -- "this text is intentionally ugly. It exists solely so I can
 *  validate that the scoring logic behaves intuitively." */
export function formatScoreChange(change: ScoreChange): string {
  const deltaLines = change.deltas.map(({ metric, delta }) => `${METRIC_LABELS[metric]} ${delta > 0 ? "+" : ""}${delta.toFixed(1)}%`);
  if (deltaLines.length === 0) return change.reasons.join("\n");
  if (change.reasons.length === 0) return deltaLines.join("\n");
  return [...deltaLines, "", ...change.reasons].join("\n");
}

export { METRIC_LABELS };
