/**
 * header-layout-preview.mjs -- a static, openable rendering of the chrome
 * status row at several viewport widths (AG, 2026-08-06).
 *
 * WHY THIS EXISTS. Every defect in the 2026-08-06 header pass was a
 * RESPONSIVE one: the strip and the command card looked correct at the
 * width they were built at and fell apart at others. That is the one class
 * of bug this repository's verification suites structurally cannot see --
 * they assert values and strings, and the sandbox has no browser (see
 * ui-smoke.ts's own disclosure). Reproducing it previously required loading
 * a real document and dragging the window.
 *
 * WHAT IT IS. The REAL <style> block, lifted verbatim out of index.html at
 * generation time, applied to a static mirror of the markup app.ts emits,
 * laid out at four fixed widths on one page. Because the layout is driven
 * by flex/grid rather than media queries, a fixed-width container
 * reproduces a viewport of that width exactly.
 *
 * WHAT IT IS NOT. The markup below is a hand-written MIRROR of
 * renderReviewStatus / renderDecisionTracker / renderCommandBar, not their
 * output -- app.ts cannot run without a DOM. It can therefore drift, and a
 * clean preview is not a passing test. It answers one question only, the
 * one nothing else here can: does this geometry hold up as the window
 * narrows.
 *
 * Run with:  node verify/header-layout-preview.mjs
 * Writes:    verify/_scratch_output/header-layout-preview.html
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const indexHtml = readFileSync(join(here, "..", "index.html"), "utf8");

// The real stylesheet, verbatim -- the whole point. A copied-out subset
// would preview a CSS file that does not exist.
const styleMatch = indexHtml.match(/<style>([\s\S]*?)<\/style>/);
if (!styleMatch) throw new Error("could not find the <style> block in index.html");
const styles = styleMatch[1];

/** value-over-label, matching renderReviewStatus's order since 2026-08-06. */
const score = (label, value, band) =>
  `<div class="review-status-item"><span class="review-status-value ${band}">${value}</span><span class="review-status-label">${label}</span></div>`;

const trackerCell = (label, value, resting) =>
  `<div class="decision-tracker-cell${resting ? " metric-resting" : ""}">` +
  `<span class="decision-tracker-value${resting ? " metric-resting" : ""}">${value}</span>` +
  `<span class="decision-tracker-label">${label}</span></div>`;

const timeCell = (value, unit, resting) =>
  `<div class="decision-tracker-cell decision-tracker-time${resting ? " metric-resting" : ""}">` +
  `<div class="decision-tracker-time-figure">` +
  `<span class="decision-tracker-value${resting ? " metric-resting" : ""}">${value}</span>` +
  `<span class="decision-tracker-time-label">${unit}</span></div>` +
  `<span class="decision-tracker-info">&#9432;</span></div>`;

const tracker = (cells, time) =>
  `<div class="decision-tracker"><div class="decision-tracker-title">Decision Tracker</div>` +
  `<div class="decision-tracker-row">${cells}${time}</div></div>`;

const cap = (k) => `<kbd class="keycap">${k}</kbd>`;
const seg = (keys, label) =>
  `<span class="legend-entry">${keys.map(cap).join("")}<span class="legend-label">${label}</span></span>`;

const cardRow = (label, segments, app) =>
  (app ? `<span class="command-card-rule"></span>` : "") +
  `<span class="command-card-label">${label}</span>` +
  `<div class="command-card-row${app ? " command-card-row-app" : ""}">${segments.join("")}</div>`;

/** The Ambiguity Check vocabulary from Andrew's own screenshots, now split
 *  across the four semantic rows segmentGroup() assigns. */
const commandCard =
  `<div class="command-card">` +
  cardRow("Decide", [
    seg(["Enter"], "Accept"),
    seg(["Space"], "Details"),
    seg(["K"], "Keep"),
    seg(["C"], "Change"),
    seg(["R"], "Redact"),
    seg(["I"], "Ignore"),
    seg(["1–9"], "Accept suggestion"),
  ]) +
  cardRow("Move", [seg(["↓"], "Enter item"), seg(["←→↑"], "Move"), seg(["Tab"], "Next item")]) +
  cardRow("Scope", [seg(["⇧A"], "Accept section"), seg(["9"], "Section actions")]) +
  cardRow("App", [seg(["⇧← ⇧→"], "Stages"), seg(["F6", ","], "Regions")], true) +
  `</div>`;

/** Two states worth seeing side by side: a freshly opened document (every
 *  figure resting, which is what Andrew's screenshots show) and one under
 *  way (nothing resting, the diagnostic carrying its longest real text). */
const STATES = {
  fresh: {
    scores: score("Extraction", "0%", "score-none") + score("Review", "0%", "score-none") + score("Overall", "0%", "score-none"),
    tracker: tracker(trackerCell("Made", "0", true) + trackerCell("Avoided", "0", true) + trackerCell("Fewer", "0%", true), timeCell("~0.0", "minutes avoided", true)),
    diagnostic: "",
    stats: "0% complete (0/607)   Keep 0 · Change 0 · Redact 0 · Ignore 0   41 ambiguous",
  },
  working: {
    scores: score("Extraction", "92%", "score-high") + score("Review", "48%", "score-mid") + score("Overall", "~100%", "score-high"),
    tracker: tracker(trackerCell("Made", "37", false) + trackerCell("Avoided", "2,324", false) + trackerCell("Fewer", "~100%", false), timeCell("~3.4", "hours avoided", false)),
    diagnostic: "Review -2.4%\nOverall -1.3%\n\n8 ambiguities back to unresolved\n8 items back to unresolved",
    stats: "~100% complete (606/607)   Keep 214 · Change 61 · Redact 118 · Ignore 92   3 ambiguous",
  },
};

const WIDTHS = [1600, 1280, 1024, 860];

function frame(width, stateName) {
  const s = STATES[stateName];
  return `
    <section class="preview-frame">
      <h2>${width}px &middot; ${stateName === "fresh" ? "freshly opened" : "under way"}</h2>
      <div class="preview-viewport" style="width:${width}px">
        <div class="workspace-chrome">
          <div class="chrome-status-row">
            <div class="chrome-status-left">
              <div class="review-status">
                ${s.scores}
                ${s.tracker}
                <div class="review-status-diagnostic">${s.diagnostic}</div>
              </div>
              <div class="review-stats"><span class="review-stats-item">${s.stats}</span></div>
            </div>
            ${commandCard}
          </div>
        </div>
      </div>
    </section>`;
}

const body = WIDTHS.map((w) => frame(w, "working")).join("") + WIDTHS.map((w) => frame(w, "fresh")).join("");

const page = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" />
<title>DocScrub header layout preview</title>
<style>${styles}</style>
<style>
  body { padding: 1.5rem; background: #fff; }
  .preview-frame { margin-bottom: 2rem; }
  .preview-frame h2 { font-size: 0.78rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #8a8f9a; margin: 0 0 0.4rem; }
  /* The frames are wider than the page on purpose -- each one is a
     viewport of its stated width, so the page scrolls rather than
     reflowing them. */
  .preview-viewport { border: 1px dashed #c9ced8; padding: 0.6rem; overflow: hidden; }
  .preview-note { max-width: 46rem; margin: 0 0 2rem; font-size: 0.85rem; line-height: 1.5; color: #4a505c; }
</style></head>
<body>
<p class="preview-note"><strong>Static mirror, not live output.</strong> The stylesheet is lifted verbatim from
index.html at generation time; the markup is hand-written to match what app.ts emits and can drift from it.
This answers one question: does the header geometry hold as the window narrows. Regenerate with
<code>node verify/header-layout-preview.mjs</code>.</p>
${body}
</body></html>`;

const outDir = join(here, "_scratch_output");
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, "header-layout-preview.html");
writeFileSync(outPath, page, "utf8");
console.log(`wrote ${outPath}`);
