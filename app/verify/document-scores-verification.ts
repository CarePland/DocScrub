/**
 * document-scores-verification.ts -- Diagnostic Scoring UI (2026-07-30).
 * Pure-function suite for src/ui/documentScores.ts: the three metric
 * formulas (Extraction/Review/Overall), the blank-image rule ("blank"
 * images are ignored, per Andrew's note), and the explanation diff --
 * verifying in particular the design requirement that the justification
 * text derives from the SAME factor values the scores were computed from
 * (a factor diff always co-occurs with its score movement, and an
 * unchanged report explains to null).
 *
 * DOM-free by construction, same convention as
 * visible-list-advance-verification.ts. What this suite cannot cover
 * (browser-only, disclosed per standing practice): the stage-tab-row
 * layout, and app.ts's render-to-render lastScoreReport/lastScoreChange
 * carry (the persistence of the last justification across non-scoring
 * renders).
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/document-scores-verification.ts
 */

import {
  collectExtractionSignals,
  computeDocumentScores,
  explainScoreChange,
  formatScoreChange,
  isBlankImage,
  type DocumentScoreInputs,
  type DocumentScoreReport,
  type ExtractionScoreSource,
} from "../src/ui/documentScores.js";
import type { StageStatus, WorkflowStage } from "../src/domain/FocusState.js";
import type { WorkspaceReadiness } from "../src/workspace/Workspace.js";

let passCount = 0;
let failCount = 0;

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passCount += 1;
    console.log(`  PASS ${label}`);
  } else {
    failCount += 1;
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

// --- fixture builders -------------------------------------------------------

function pngBytes(width: number, height: number): Uint8Array {
  // Signature (8) + IHDR chunk header (8) + width (4, BE) + height (4, BE).
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  new DataView(bytes.buffer).setUint32(16, width, false);
  new DataView(bytes.buffer).setUint32(20, height, false);
  return bytes;
}

function gifBytes(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(13);
  bytes.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0); // "GIF89a"
  new DataView(bytes.buffer).setUint16(6, width, true);
  new DataView(bytes.buffer).setUint16(8, height, true);
  return bytes;
}

const jpegBytes = (): Uint8Array => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

function extractionSource(
  parts: Record<string, Uint8Array> = {},
  processingWarnings: string[] = [],
  unsupported: string[] = []
): ExtractionScoreSource {
  return { processingWarnings, features: { unsupported }, sourceArchive: { parts: new Map(Object.entries(parts)) } };
}

// REVIEW ARTIFACTS (AG, 2026-08-02): artifact counts default to zero, so
// every pre-existing case in this suite describes exactly the same
// scenario it always did -- the Review metric's item arithmetic is
// unchanged where there are no artifacts. The two optional parameters let
// the new cases below state artifact work explicitly.
function stageStatus(stage: WorkflowStage, itemCount: number, unresolvedCount: number, artifactCount = 0, unresolvedArtifactCount = 0): StageStatus {
  const anyWork = itemCount + artifactCount;
  return {
    stage,
    hasItems: itemCount > 0,
    available: true,
    completion: anyWork === 0 ? "empty" : unresolvedCount + unresolvedArtifactCount === 0 ? "complete" : "unresolved",
    itemCount,
    unresolvedCount,
    artifactCount,
    unresolvedArtifactCount,
  };
}

function readiness(overrides: Partial<WorkspaceReadiness> = {}): WorkspaceReadiness {
  return {
    reviewComplete: false,
    unresolvedItemCount: 0,
    unresolvedArtifactCount: 0,
    verificationCurrent: false,
    verificationPassed: null,
    verificationWarningCount: 0,
    verificationBlockerCount: 0,
    exportEnabled: false,
    ...overrides,
  };
}

function inputs(overrides: Partial<DocumentScoreInputs> = {}): DocumentScoreInputs {
  return {
    documentId: "doc-1",
    extraction: extractionSource(),
    stageStatuses: [
      stageStatus("ambiguity-check", 0, 0),
      stageStatus("group-check", 0, 0),
      stageStatus("item-check", 0, 0),
    ],
    readiness: readiness(),
    ...overrides,
  };
}

// --- isBlankImage -----------------------------------------------------------

console.log("isBlankImage:");
check("zero-byte part is blank", isBlankImage(new Uint8Array(0)));
check("1x1 PNG spacer is blank", isBlankImage(pngBytes(1, 1)));
check("100x50 PNG is not blank", !isBlankImage(pngBytes(100, 50)));
check("1x1 GIF spacer is blank", isBlankImage(gifBytes(1, 1)));
check("640x480 GIF is not blank", !isBlankImage(gifBytes(640, 480)));
check("JPEG is never treated as blank (disclosed limit)", !isBlankImage(jpegBytes()));

// --- collectExtractionSignals ----------------------------------------------

console.log("collectExtractionSignals:");
{
  const signals = collectExtractionSignals(
    extractionSource(
      {
        "word/media/image1.png": pngBytes(100, 50), // counts
        "word/media/image2.png": pngBytes(1, 1), // blank -> ignored
        "word/media/image3.gif": gifBytes(1, 1), // blank -> ignored
        "word/media/image4.jpeg": jpegBytes(), // counts
        "word/media/image5.emf": new Uint8Array(0), // zero-byte -> ignored
        "word/document.xml": pngBytes(100, 50), // not under /media/ -> not an image part
      },
      ["warning A", "warning B"],
      ["tracked-change-deletion-rebuild"]
    )
  );
  check("non-blank images counted", signals.unsupportedImageCount === 2, `got ${signals.unsupportedImageCount}`);
  check("processing warnings counted", signals.processingWarningCount === 2);
  check("unsupported features counted", signals.unsupportedFeatureCount === 1);
}

// --- Extraction metric ------------------------------------------------------

console.log("Extraction:");
check("clean document scores 100", computeDocumentScores(inputs()).extraction === 100);
{
  const report = computeDocumentScores(
    inputs({ extraction: extractionSource({ "word/media/image1.png": pngBytes(9, 9) }, ["w1"], ["u1"]) })
  );
  check("deductions: -3 warning, -5 unsupported, -5 image", report.extraction === 87, `got ${report.extraction}`);
}
{
  const report = computeDocumentScores(
    inputs({ extraction: extractionSource({ "word/media/blank.png": pngBytes(1, 1) }) })
  );
  check("blank image does not deduct", report.extraction === 100, `got ${report.extraction}`);
  check("blank image absent from factors", report.factors["unsupported-images"] === 0);
}
{
  const manyWarnings = Array.from({ length: 50 }, (_, i) => `w${i}`);
  const report = computeDocumentScores(inputs({ extraction: extractionSource({}, manyWarnings) }));
  check("extraction clamps at 0", report.extraction === 0, `got ${report.extraction}`);
}

// --- Review metric ----------------------------------------------------------

console.log("Review:");
check("nothing to review scores 100", computeDocumentScores(inputs()).review === 100);
{
  const report = computeDocumentScores(
    inputs({
      stageStatuses: [stageStatus("ambiguity-check", 2, 1), stageStatus("group-check", 3, 3), stageStatus("item-check", 15, 10)],
    })
  );
  // pooled: resolved 1+0+5 = 6 of 20 -> 30.0
  check("pooled resolved fraction across stages", report.review === 30, `got ${report.review}`);
  check("per-stage resolved counts in factors (ambiguity)", report.factors["ambiguity-resolved"] === 1);
  check("per-stage resolved counts in factors (groups)", report.factors["groups-resolved"] === 0);
  check("per-stage resolved counts in factors (items)", report.factors["items-resolved"] === 5);
}
// REVIEW ARTIFACTS pool with items (AG, 2026-08-02): a structural
// relationship proposal is one unit of reviewer work, so Review cannot
// read 100% while the workflow still shows work remaining.
{
  const report = computeDocumentScores(
    inputs({
      // 2 items (1 unresolved) + 2 artifacts (2 unresolved) on ambiguity;
      // item-check fully done. Pooled: resolved 1+0+4 = 5 of 4+2+2 = 8 -> 62.5
      stageStatuses: [stageStatus("ambiguity-check", 2, 1, 2, 2), stageStatus("group-check", 0, 0), stageStatus("item-check", 4, 0)],
    })
  );
  check("artifacts pool into the Review metric alongside items", report.review === 62.5, `got ${report.review}`);
}
{
  const allItemsDone = computeDocumentScores(
    inputs({ stageStatuses: [stageStatus("ambiguity-check", 2, 0, 1, 1), stageStatus("group-check", 0, 0), stageStatus("item-check", 4, 0)] })
  );
  // 6 of 7 units done -- NOT 100, because one proposal still needs review.
  check("every item decided but a proposal outstanding is not 100% reviewed", allItemsDone.review < 100 && allItemsDone.review > 80, `got ${allItemsDone.review}`);
  const artifactDone = computeDocumentScores(
    inputs({ stageStatuses: [stageStatus("ambiguity-check", 2, 0, 1, 0), stageStatus("group-check", 0, 0), stageStatus("item-check", 4, 0)] })
  );
  check("addressing the proposal completes the Review metric", artifactDone.review === 100, `got ${artifactDone.review}`);
}
{
  const report = computeDocumentScores(
    inputs({ stageStatuses: [stageStatus("ambiguity-check", 0, 0), stageStatus("group-check", 0, 0), stageStatus("item-check", 3, 1)] })
  );
  check("sub-integer review rounds to one decimal", report.review === 66.7, `got ${report.review}`);
}

// --- Overall metric ---------------------------------------------------------

console.log("Overall:");
{
  const report = computeDocumentScores(inputs());
  // extraction 100, review 100, unverified: 0.30*100 + 0.55*100 = 85
  check("fully reviewed but unverified is 85 (verification gap visible)", report.overall === 85, `got ${report.overall}`);
}
{
  const report = computeDocumentScores(
    inputs({ readiness: readiness({ verificationCurrent: true, verificationPassed: true, exportEnabled: true }) })
  );
  check("verified passing adds the 15-point component", report.overall === 100, `got ${report.overall}`);
  check("output-verified factor set", report.factors["output-verified"] === 1);
}
{
  const report = computeDocumentScores(
    inputs({
      readiness: readiness({ verificationCurrent: true, verificationPassed: true, verificationWarningCount: 2 }),
    })
  );
  check("QA warnings deduct 10 each from overall", report.overall === 80, `got ${report.overall}`);
  check("qa-warnings factor counted", report.factors["qa-warnings"] === 2);
}
{
  const report = computeDocumentScores(
    inputs({
      readiness: readiness({ verificationCurrent: true, verificationPassed: false, verificationBlockerCount: 1 }),
    })
  );
  // 0.30*100 + 0.55*100 + 0 - 25 = 60
  check("failed verification: no component, blocker deducts 25", report.overall === 60, `got ${report.overall}`);
  check("output-verification-failed factor set", report.factors["output-verification-failed"] === 1);
}
{
  const report = computeDocumentScores(
    inputs({ readiness: readiness({ verificationCurrent: false, verificationWarningCount: 3, verificationBlockerCount: 2 }) })
  );
  check("stale verification contributes NO qa factors", report.factors["qa-warnings"] === 0 && report.factors["qa-blockers"] === 0);
  check("stale verification deducts nothing", report.overall === 85, `got ${report.overall}`);
}

// --- explainScoreChange -----------------------------------------------------

console.log("explainScoreChange:");
const base = computeDocumentScores(
  inputs({ stageStatuses: [stageStatus("ambiguity-check", 2, 2), stageStatus("group-check", 2, 2), stageStatus("item-check", 16, 16)] })
);
check("identical reports explain to null", explainScoreChange(base, base) === null);
{
  const other = computeDocumentScores(inputs({ documentId: "doc-2" }));
  check("different documents explain to null", explainScoreChange(base, other) === null);
}
{
  const after = computeDocumentScores(
    inputs({ stageStatuses: [stageStatus("ambiguity-check", 2, 1), stageStatus("group-check", 2, 2), stageStatus("item-check", 16, 14)] })
  );
  const change = explainScoreChange(base, after)!;
  check("change detected", change !== null);
  // resolved went 0 -> 3 of 20: review 0 -> 15, delta +15; overall 0.55*15 = +8.3 (rounded)
  const reviewDelta = change.deltas.find((d) => d.metric === "review");
  const overallDelta = change.deltas.find((d) => d.metric === "overall");
  check("review delta present and positive", reviewDelta !== undefined && reviewDelta.delta === 15, `got ${reviewDelta?.delta}`);
  check("overall delta present and positive", overallDelta !== undefined && overallDelta.delta === 8.3, `got ${overallDelta?.delta}`);
  check("extraction unchanged -> no extraction delta", !change.deltas.some((d) => d.metric === "extraction"));
  check("singular ambiguity phrasing", change.reasons.includes("Resolved ambiguity"), change.reasons.join(" | "));
  check("plural item phrasing", change.reasons.includes("2 additional items completed"), change.reasons.join(" | "));
  check("reviewer-work reasons come first", change.reasons[0] === "Resolved ambiguity");
}
{
  // A factor moving DOWN phrases as a decrease (defensive -- resolved
  // counts should not normally regress, but the differ must not lie if
  // they do).
  const after = computeDocumentScores(
    inputs({ stageStatuses: [stageStatus("ambiguity-check", 2, 2), stageStatus("group-check", 2, 2), stageStatus("item-check", 16, 16)] })
  );
  const before = computeDocumentScores(
    inputs({ stageStatuses: [stageStatus("ambiguity-check", 2, 2), stageStatus("group-check", 2, 2), stageStatus("item-check", 16, 15)] })
  );
  const change = explainScoreChange(before, after)!;
  check("decrease phrasing", change.reasons.includes("1 item back to unresolved"), change.reasons.join(" | "));
  const reviewDelta = change.deltas.find((d) => d.metric === "review");
  check("negative delta carried", reviewDelta !== undefined && reviewDelta.delta === -5, `got ${reviewDelta?.delta}`);
}
{
  const before = computeDocumentScores(inputs());
  const after = computeDocumentScores(
    inputs({
      extraction: extractionSource({ "word/media/late.png": pngBytes(4, 4) }),
      readiness: readiness({ verificationCurrent: true, verificationPassed: true, verificationWarningCount: 1 }),
    })
  );
  const change = explainScoreChange(before, after)!;
  check("extraction reason phrased", change.reasons.includes("Unsupported image discovered"), change.reasons.join(" | "));
  check("QA warning reason phrased", change.reasons.includes("QA warning added"), change.reasons.join(" | "));
  check("verification reason phrased", change.reasons.includes("Output verified against current decisions"), change.reasons.join(" | "));
}

// --- formatScoreChange ------------------------------------------------------

console.log("formatScoreChange:");
{
  const text = formatScoreChange({
    deltas: [
      { metric: "review", delta: 0.4 },
      { metric: "overall", delta: 0.3 },
    ],
    reasons: ["Resolved ambiguity", "2 additional items completed"],
  });
  check(
    "deltas, blank line, reasons -- matching the instruction's example shape",
    text === "Review +0.4%\nOverall +0.3%\n\nResolved ambiguity\n2 additional items completed",
    JSON.stringify(text)
  );
}
{
  const text = formatScoreChange({ deltas: [{ metric: "overall", delta: -1.2 }], reasons: ["Unsupported image discovered", "QA warning added"] });
  check("negative delta keeps its sign", text.startsWith("Overall -1.2%"), JSON.stringify(text));
}

// ---------------------------------------------------------------------------

console.log(`\ndocument-scores-verification: ${passCount} passed, ${failCount} failed`);
if (failCount > 0) process.exit(1);
