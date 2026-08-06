/**
 * renderWorkspaceAnalysisPage.ts — the standalone Workspace Analysis UI.
 * Renders entirely from a `WorkspaceAnalysisSession`'s own state; imports
 * nothing from `src/ui/app.ts`, `src/domain/`, `src/engines/`, or
 * `src/workspace/` (see `./dom.ts` for why even the DOM helpers are
 * local rather than shared). This file IS the "one narrow entry point"
 * the concurrency requirement asks for on the app.ts side -- app.ts will
 * eventually call `renderWorkspaceAnalysisPage(container, session)` and
 * nothing else from this subsystem (see task #263).
 *
 * TONE: explanations here stay understated and factual (evidence
 * descriptions, plain percentages), not confident/marketing language --
 * matching CarePland's existing calm-explainability principle and this
 * subsystem's own conservative design (a proposed grouping is a
 * suggestion to confirm, never an automatic decision).
 */

import type { WorkspaceAnalysisSession, WorkspaceGrouping } from "../state/WorkspaceAnalysisSession.js";
import { extractWorkspaceAnalysisDocuments } from "../io/extractText.js";
import { el, button } from "./dom.js";

interface Feedback {
  kind: "error" | "info";
  message: string;
}

function formatStrength(strength: number | null): string {
  if (strength === null) return "n/a";
  return `${Math.round(strength * 100)}%`;
}

function fileNameFor(state: ReturnType<WorkspaceAnalysisSession["getState"]>, documentId: string): string {
  return state.documents.find((d) => d.documentId === documentId)?.fileName ?? documentId;
}

function renderHeader(): HTMLElement {
  return el(
    "div",
    { class: "wsa-header" },
    el("h2", {}, "Workspace Analysis"),
    el(
      "p",
      { class: "wsa-subtitle" },
      "See which imported documents appear to belong to the same matter before review begins. This runs independently of document review -- nothing here affects redaction decisions."
    )
  );
}

function renderImportControls(
  session: WorkspaceAnalysisSession,
  rerender: (feedback?: Feedback | null) => void
): HTMLElement {
  const state = session.getState();
  const fileInput = el("input", { type: "file", multiple: "multiple", class: "wsa-file-input" });
  fileInput.addEventListener("change", () => {
    const files = fileInput.files ? Array.from(fileInput.files) : [];
    if (files.length === 0) return;
    void (async () => {
      rerender();
      const result = await session.loadFiles(files);
      rerender(result.ok ? null : { kind: "error", message: result.reason ?? "Analysis failed." });
    })();
  });

  const controls = el(
    "div",
    { class: "wsa-import-controls" },
    el("label", { class: "wsa-file-label" }, "Import documents to analyze:", fileInput)
  );

  if (state.status !== "idle") {
    controls.appendChild(
      button("Start over", { class: "wsa-reset-button" }, () => {
        session.dispatch({ type: "reset" });
        rerender();
      })
    );
  }

  return controls;
}

function renderSummary(state: ReturnType<WorkspaceAnalysisSession["getState"]>): HTMLElement {
  const relatedCount = state.groupings.filter((g) => g.documentIds.length >= 2).length;
  const unrelatedCount = state.groupings.filter((g) => g.documentIds.length === 1).length;
  return el(
    "p",
    { class: "wsa-summary" },
    `${state.documents.length} document${state.documents.length === 1 ? "" : "s"} imported -- ` +
      `${relatedCount} proposed grouping${relatedCount === 1 ? "" : "s"}, ` +
      `${unrelatedCount} document${unrelatedCount === 1 ? "" : "s"} without a confident relationship.`
  );
}

function renderEvidenceList(grouping: WorkspaceGrouping): HTMLElement | null {
  if (grouping.reasons.length === 0) return null;
  return el(
    "ul",
    { class: "wsa-evidence-list" },
    ...grouping.reasons.map((item) => el("li", { class: "wsa-evidence-item" }, item.description))
  );
}

function renderGroupingCard(
  grouping: WorkspaceGrouping,
  state: ReturnType<WorkspaceAnalysisSession["getState"]>,
  session: WorkspaceAnalysisSession,
  otherGroupings: WorkspaceGrouping[],
  rerender: (feedback?: Feedback | null) => void
): HTMLElement {
  const card = el("div", { class: `wsa-grouping-card wsa-status-${grouping.status}` });
  const isMultiDoc = grouping.documentIds.length >= 2;

  card.appendChild(
    el(
      "div",
      { class: "wsa-grouping-header" },
      el("span", { class: "wsa-grouping-strength" }, isMultiDoc ? `Confidence: ${formatStrength(grouping.strength)}` : "No related documents found"),
      el("span", { class: "wsa-grouping-status-badge" }, grouping.status)
    )
  );

  const memberList = el("ul", { class: "wsa-grouping-members" });
  for (const documentId of grouping.documentIds) {
    const item = el("li", { class: "wsa-member-item" });
    if (isMultiDoc) {
      const checkbox = el("input", { type: "checkbox", value: documentId, class: "wsa-member-checkbox" });
      item.appendChild(checkbox);
    }
    item.appendChild(document.createTextNode(fileNameFor(state, documentId)));
    memberList.appendChild(item);
  }
  card.appendChild(memberList);

  const evidenceList = renderEvidenceList(grouping);
  if (evidenceList) card.appendChild(evidenceList);

  const actions = el("div", { class: "wsa-grouping-actions" });

  if (isMultiDoc && grouping.status === "proposed") {
    actions.appendChild(
      button("Accept grouping", { class: "wsa-accept-button" }, () => {
        session.dispatch({ type: "accept-grouping", groupingId: grouping.groupingId });
        rerender();
      })
    );
  }

  if (isMultiDoc) {
    actions.appendChild(
      button("Split selected into new group", { class: "wsa-split-button" }, () => {
        const checked = Array.from(card.querySelectorAll<HTMLInputElement>(".wsa-member-checkbox"))
          .filter((c) => c.checked)
          .map((c) => c.value);
        if (checked.length === 0 || checked.length === grouping.documentIds.length) {
          rerender({ kind: "error", message: "Select at least one, but not all, documents to split into a new group." });
          return;
        }
        const remaining = grouping.documentIds.filter((id) => !checked.includes(id));
        const result = session.dispatch({
          type: "split-grouping",
          groupingId: grouping.groupingId,
          newGroups: [checked, remaining],
        });
        rerender(result.ok ? null : { kind: "error", message: result.reason ?? "Split failed." });
      })
    );
  }

  if (otherGroupings.length > 0) {
    const select = el(
      "select",
      { class: "wsa-merge-select" },
      ...otherGroupings.map((other) =>
        el(
          "option",
          { value: other.groupingId },
          other.documentIds.map((id) => fileNameFor(state, id)).join(", ")
        )
      )
    );
    actions.appendChild(select);
    actions.appendChild(
      button("Merge with selected", { class: "wsa-merge-button" }, () => {
        const result = session.dispatch({
          type: "merge-groupings",
          groupingIdA: grouping.groupingId,
          groupingIdB: select.value,
        });
        rerender(
          result.ok
            ? null
            : { kind: "error", message: result.reason ?? "These groups do not meet the relationship threshold together, so they were not merged." }
        );
      })
    );
  }

  card.appendChild(actions);
  return card;
}

function renderGroupings(
  state: ReturnType<WorkspaceAnalysisSession["getState"]>,
  session: WorkspaceAnalysisSession,
  rerender: (feedback?: Feedback | null) => void
): HTMLElement {
  const wrapper = el("div", { class: "wsa-groupings" });
  const related = state.groupings.filter((g) => g.documentIds.length >= 2);
  const unrelated = state.groupings.filter((g) => g.documentIds.length === 1);

  wrapper.appendChild(el("h3", {}, "Proposed groupings"));
  if (related.length === 0) {
    wrapper.appendChild(el("p", { class: "wsa-empty-note" }, "No document relationships met the confidence threshold -- every imported document is being treated as independent."));
  } else {
    for (const grouping of related) {
      const others = state.groupings.filter((g) => g !== grouping);
      wrapper.appendChild(renderGroupingCard(grouping, state, session, others, rerender));
    }
  }

  if (unrelated.length > 0) {
    wrapper.appendChild(el("h3", {}, "Documents that appear unrelated"));
    const list = el("ul", { class: "wsa-unrelated-list" });
    for (const grouping of unrelated) {
      const documentId = grouping.documentIds[0];
      if (!documentId) continue;
      list.appendChild(el("li", { class: "wsa-unrelated-item" }, fileNameFor(state, documentId)));
    }
    wrapper.appendChild(list);
  }

  return wrapper;
}

export function renderWorkspaceAnalysisPage(
  container: HTMLElement,
  session: WorkspaceAnalysisSession,
  feedback: Feedback | null = null
): void {
  container.innerHTML = "";
  const rerender = (nextFeedback: Feedback | null = null): void => renderWorkspaceAnalysisPage(container, session, nextFeedback);

  const root = el("div", { class: "wsa-page" });
  root.appendChild(renderHeader());

  if (feedback) {
    root.appendChild(el("p", { class: `wsa-feedback wsa-feedback-${feedback.kind}` }, feedback.message));
  }

  root.appendChild(renderImportControls(session, rerender));

  const state = session.getState();
  if (state.status === "analyzing") {
    root.appendChild(el("p", { class: "wsa-status" }, "Analyzing imported documents..."));
  } else if (state.status === "error") {
    root.appendChild(el("p", { class: "wsa-status wsa-status-error" }, `Analysis could not complete: ${state.error ?? "unknown error"}`));
  } else if (state.status === "idle") {
    root.appendChild(el("p", { class: "wsa-status" }, "Import a set of documents above to see how strongly they relate to each other."));
  } else {
    root.appendChild(renderSummary(state));
    root.appendChild(renderGroupings(state, session, rerender));
  }

  container.appendChild(root);
}

// Re-exported so a host page can wire a drag-and-drop zone without
// reaching into ../io/extractText.js directly -- keeps the subsystem's
// public surface to this one module plus WorkspaceAnalysisSession.
export { extractWorkspaceAnalysisDocuments };
