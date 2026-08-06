/**
 * metricsWindow.ts -- the Workspace Metrics WINDOW (AG, 2026-08-02): a
 * separate, detachable browser window rendering
 * src/metrics/workspaceMetrics.ts's derived sections for the active
 * workspace.
 *
 * MECHANICS: window.open("", named-target) from the user's click (a real
 * gesture, so no popup blocking) yields a same-context Document this
 * module writes directly -- one module graph, no second URL, no message
 * passing. app.ts calls syncWorkspaceMetricsWindow(state) from render()'s
 * tail, so the window updates on exactly the cadence the workspace
 * re-renders (every decision, bulk action, load, resume); when the window
 * is closed the sync is a constant-time no-op. Closing the window never
 * touches review state -- this module dispatches nothing, ever.
 *
 * The window re-renders by full innerHTML replacement: the content is a
 * read-only list of numbers with no focusable state to preserve, and at
 * this scale the simplicity is worth more than diffing. Styles are
 * inline in the popup document (it shares no CSS with the app); calm,
 * system-font, close to the app's look.
 *
 * If the MAIN page reloads, the popup survives but its updater is gone;
 * the stale banner case is handled by stamping each render -- and
 * reopening from the menu re-adopts the same named window.
 */

import type { WorkspaceState } from "../workspace/Workspace.js";
import { deriveWorkspaceMetrics, type MetricSection } from "../metrics/workspaceMetrics.js";

const WINDOW_NAME = "docscrub-workspace-metrics";

let metricsWindow: Window | null = null;

function windowAlive(): boolean {
  return metricsWindow !== null && !metricsWindow.closed;
}

/** Opens (or refocuses) the metrics window. Returns false when the
 *  browser refused the popup. Caller should follow with a sync. */
export function openWorkspaceMetricsWindow(): boolean {
  if (windowAlive()) {
    metricsWindow!.focus();
    return true;
  }
  const win = window.open("", WINDOW_NAME, "width=440,height=680");
  if (!win) return false;
  metricsWindow = win;
  win.document.title = "DocScrub — Workspace Metrics";
  return true;
}

export function workspaceMetricsWindowOpen(): boolean {
  return windowAlive();
}

const esc = (value: string | number): string =>
  String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function sectionsHtml(sections: MetricSection[], stamp: string): string {
  const body = sections
    .map(
      (section) => `
    <section>
      <h2>${esc(section.title)}</h2>
      <dl>
        ${section.metrics
          .map(
            (metric) => `
        <div class="row">
          <dt>${esc(metric.label)}</dt>
          <dd>${esc(metric.value)}${metric.note ? `<span class="note">${esc(metric.note)}</span>` : ""}</dd>
        </div>`
          )
          .join("")}
      </dl>
    </section>`
    )
    .join("");
  return `
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 0; padding: 1rem 1.2rem; background: #f5f5f3; color: #1a1d21; }
    h1 { font-size: 1rem; margin: 0 0 0.2rem; }
    .stamp { color: #6b7280; font-size: 0.72rem; margin: 0 0 0.9rem; }
    section { background: #fff; border: 1px solid #e2e4e8; border-radius: 6px; padding: 0.65rem 0.85rem; margin-bottom: 0.7rem; }
    h2 { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.04em; color: #6b7280; margin: 0 0 0.45rem; }
    dl { margin: 0; }
    .row { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; padding: 0.18rem 0; }
    dt { font-size: 0.86rem; }
    dd { margin: 0; font-weight: 600; font-variant-numeric: tabular-nums; text-align: right; }
    .note { display: block; font-weight: 400; color: #6b7280; font-size: 0.72rem; }
  </style>
  <h1>Workspace Metrics</h1>
  <p class="stamp">Live view of the active workspace · updated ${esc(stamp)}</p>
  ${body}`;
}

/** Render the current workspace's metrics into the window; constant-time
 *  no-op while the window is closed. Never throws into the caller --
 *  render() must not become hostage to a popup's lifecycle. */
export function syncWorkspaceMetricsWindow(state: WorkspaceState): void {
  if (!windowAlive()) return;
  try {
    const sections = deriveWorkspaceMetrics(state);
    metricsWindow!.document.body.innerHTML = sectionsHtml(sections, new Date().toLocaleTimeString());
  } catch {
    // A dying/detached popup mid-write: forget it; reopening re-adopts.
    metricsWindow = null;
  }
}
