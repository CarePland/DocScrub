/**
 * ui-smoke.ts — Phase 10. A bounded, honest sanity check for src/ui/app.ts,
 * NOT a substitute for opening the page in a real browser. This sandbox has
 * no GUI browser or browser-automation tool available (see phase-10-
 * findings.md's disclosure), so this suite exists to catch the class of bug
 * a real browser would catch immediately and a plain `tsc --noEmit` cannot:
 * wrong DOM API usage, a top-level throw during initial render, or an
 * import that resolves at typecheck time but not at actual module-load
 * time.
 *
 * Provides the minimum fake `document`/`window` surface app.ts's initial
 * ("no document loaded yet") render path and keydown-listener registration
 * actually touch, then imports the REAL compiled dist/ui/app.js (produced
 * by a plain `tsc` emit -- see README.md's Phase 10 section) and confirms
 * module evaluation completes without throwing. It does not simulate
 * clicking buttons, loading a document, or any interactive flow -- that
 * requires either a real browser or a much larger DOM shim, neither of
 * which is a good use of effort for a "deliberately plain," functional-
 * integration-only UI. A real click-through in a browser remains a
 * recommended follow-up (see this suite's own final note).
 *
 * Run with (after `tsc` has emitted dist/ -- see package.json's "build" script):
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/ui-smoke.ts
 */

import { existsSync, readFileSync, statSync } from "node:fs";

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

class FakeClassList {
  private readonly classes = new Set<string>();
  add(name: string): void {
    this.classes.add(name);
  }
}

class FakeElement {
  tagName: string;
  children: FakeElement[] = [];
  attributes: Record<string, string> = {};
  textContent = "";
  disabled = false;
  title = "";
  classList = new FakeClassList();
  className = "";
  private listeners: Record<string, Array<() => void>> = {};
  files: unknown[] | null = null;

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }
  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }
  removeChild(child: FakeElement): FakeElement {
    this.children = this.children.filter((c) => c !== child);
    return child;
  }
  addEventListener(kind: string, handler: () => void): void {
    (this.listeners[kind] ??= []).push(handler);
  }
  set innerHTML(_value: string) {
    this.children = [];
  }
  get innerHTML(): string {
    return "";
  }
}

function installFakeDom(): { app: FakeElement } {
  const app = new FakeElement("div");
  const body = new FakeElement("body");
  const documentListeners: Record<string, Array<(e: unknown) => void>> = {};

  const fakeDocument = {
    getElementById: (id: string) => (id === "app" ? app : null),
    createElement: (tag: string) => new FakeElement(tag),
    addEventListener: (kind: string, handler: (e: unknown) => void) => {
      (documentListeners[kind] ??= []).push(handler);
    },
    body,
    activeElement: null,
  };

  const fakeWindow = {
    alert: (_message: string) => {},
    prompt: (_message: string) => null,
  };

  const fakeURL = {
    createObjectURL: (_blob: unknown) => "blob:fake",
    revokeObjectURL: (_url: string) => {},
  };

  // @ts-expect-error -- deliberately installing minimal fakes for a Node smoke test, not real DOM types.
  globalThis.document = fakeDocument;
  // @ts-expect-error -- see above.
  globalThis.window = fakeWindow;
  // @ts-expect-error -- see above.
  globalThis.URL = { ...URL, ...fakeURL };

  return { app };
}

async function main(): Promise<void> {
  console.log("--- dist/ build output exists ---");
  const distExists = existsSync(new URL("../dist/ui/app.js", import.meta.url));
  check("dist/ui/app.js exists (run `tsc` from DocScrub-Web/ first if this fails)", distExists);
  if (!distExists) {
    console.log(`\n${passCount}/${passCount + failCount} checks passed`);
    process.exitCode = 1;
    return;
  }

  /* ------------------------------------------------------------------
   * THE STALE-BUILD TRAP, CLOSED (2026-08-07). Cost a full session an hour.
   *
   * `npm run typecheck` is `tsc --noEmit` and writes NOTHING. `npm run build`
   * is a plain `tsc` and emits to dist/. The browser loads dist/ui/app.js,
   * and index.html is not compiled -- so CSS edits appear on refresh while TS
   * edits silently do not, which is exactly what makes the state hard to
   * notice from the outside.
   *
   * This suite was complicit: every structural check below reads
   * src/ui/app.ts while the module-load check imports dist/ui/app.js, so a
   * stale dist validated happily against fresh source and reported all green
   * -- and then someone was told to refresh a page running code that no
   * longer matched the assertions that had just passed.
   *
   * An mtime comparison is the cheap, honest guard: it cannot tell whether
   * the emit was CORRECT, only whether it happened after the last source
   * edit, which is the failure that actually occurs. Sources checked are the
   * ones this suite reasons about; a broader glob would add false positives
   * from files tsc does not emit (index.html) for no extra signal.
   * ------------------------------------------------------------------ */
  console.log("--- dist/ is not stale against src/ ---");
  {
    const distMtime = statSync(new URL("../dist/ui/app.js", import.meta.url)).mtimeMs;
    const watched = ["../src/ui/app.ts", "../src/ui/visibleListAdvance.ts", "../src/ui/reviewZone.ts", "../src/ui/triageQueue.ts"];
    const newer = watched.filter((rel) => {
      const url = new URL(rel, import.meta.url);
      return existsSync(url) && statSync(url).mtimeMs > distMtime;
    });
    check(
      "dist/ui/app.js is newer than the sources this suite asserts against (run `./node_modules/.bin/tsc` -- NOT --noEmit)",
      newer.length === 0,
      newer.length > 0 ? `stale build: ${newer.map((r) => r.replace("../", "")).join(", ")} modified after the last emit` : ""
    );
  }

  // REVIEWER EXPERIENCE WAVE 2 (2026-07-29) -- structural source
  // assertions for RX-22 (single display-label vocabulary) and RX-09
  // (no blocking alerts). Deliberately source-text checks: these ACs are
  // "this pattern must not exist in the file," which a grep-shaped
  // assertion states exactly and a behavioral test can only sample.
  // MUST run before installFakeDom(): that helper replaces globalThis.URL
  // with a plain object, after which `new URL(...)` throws.
  console.log("--- RX-22 / RX-09 structural source checks ---");
  const appSource = readFileSync(new URL("../src/ui/app.ts", import.meta.url), "utf8");
  const querySource = readFileSync(new URL("../src/ui/itemCheckQuery.ts", import.meta.url), "utf8");
  // 2026-08-07: the sectioned-queue order rules moved into this pure module,
  // so the paint/target agreement checks below have to read it.
  const visibleListAdvanceSource = readFileSync(new URL("../src/ui/visibleListAdvance.ts", import.meta.url), "utf8");
  const indexHtml = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  // 2026-08-04: the focus-panel checks below assert that the panel got
  // PLAINER without the Python-ported explanation layer being touched, so
  // they have to read that layer too.
  const explanationBuilder = readFileSync(new URL("../src/engines/explanation/explanation-builder.ts", import.meta.url), "utf8");
  const explanationDictionary = readFileSync(new URL("../src/engines/explanation/explanation-dictionary.data.ts", import.meta.url), "utf8");
  const qualityEngine = readFileSync(new URL("../src/engines/CandidateQualityEngine.ts", import.meta.url), "utf8");
  const claudeMd = readFileSync(new URL("../CLAUDE.md", import.meta.url), "utf8");
  const decisionTracker = readFileSync(new URL("../src/metrics/decisionTracker.ts", import.meta.url), "utf8");
  check("RX-09 AC#1: app.ts contains zero window.alert( occurrences (calls or comments)", !appSource.includes("window.alert("));
  check(
    "RX-22: no rendering site interpolates the durable decision kind directly (`${decided.decision}` absent -- decisionDisplayLabel() is the only path)",
    !appSource.includes("${decided.decision}")
  );
  check('RX-22: the filter preset no longer displays "Renamed"', !querySource.includes('"Renamed"'));
  check(
    "RX-22: app.ts consumes the display map (decisionDisplayLabel/DECISION_DISPLAY_LABEL imported)",
    appSource.includes('from "./decisionLabels.js"')
  );
  const appDivIndex = indexHtml.indexOf('<div id="app">');
  const statusIndex = indexHtml.indexOf('role="status"');
  check(
    "RX-18: index.html carries a static role=\"status\" aria-live region outside #app (after it, never inside render()'s clear-and-rebuild territory)",
    appDivIndex !== -1 && statusIndex > appDivIndex && indexHtml.includes('aria-live="polite"') && indexHtml.includes('aria-atomic="true"')
  );
  check(
    "RX-09: index.html carries the static toast host outside #app",
    indexHtml.indexOf('class="toast-host"') > appDivIndex
  );
  check("RX-04: rows carry a scroll-margin-top tied to the measured chrome height", indexHtml.includes("scroll-margin-top: calc(var(--workspace-chrome-height)"));
  check("RX-26: reduced-motion guard on the acknowledgement pulse", indexHtml.includes("prefers-reduced-motion"));
  // 2026-07-30 feature spec (Python-parity pass) renames:
  // Prose mentions in doc comments are fine (one quotes the original
  // instruction); what must be gone is the RENDERED heading string.
  check(
    '2026-07-30: "Representative snippets" renamed "Sources" (no rendered heading uses the old label)',
    !appSource.includes(', "Representative snippets")') && appSource.includes('"detail-section-title" }, "Sources")')
  );
  check('2026-07-30: member context button is "Source", toggled by the S key handler', appSource.includes('button("Source"') && appSource.includes("handleSourceToggleKey"));
  // Triage Queue (2026-07-30) added a third view mode; the DEFAULT remains
  // By Category -- the check pins the initializer, not the union.
  check("2026-07-30: By Category is Item Check's default view", appSource.includes('let itemCheckViewMode: "list" | "category" | "triage" = "category"'));

  // SIDE-BY-SIDE FOCUS PANE (AG, 2026-08-03). Structural source checks
  // for the same reason as the RX-22 block above: each of these is "this
  // arrangement must hold," and the layout itself is geometry the fake
  // DOM cannot evaluate (it implements no offsetTop and no CSS). What CAN
  // be pinned here is the markup contract the geometry rests on.
  console.log("--- Side-by-side focus pane structural checks ---");
  check(
    "focus pane: the detail panel is collected, never appended into the grid flow (the old full-width `grid.appendChild(panelHost)` split the collection in two)",
    !appSource.includes("grid.appendChild(panelHost)") && appSource.includes("focusPanels.push(panelHost)")
  );
  check(
    "focus pane: pane precedes the grid in DOM order, so visual order and tab order agree and stacking puts the pane on top",
    appSource.indexOf("split.appendChild(focusPane)") !== -1 &&
      appSource.indexOf("split.appendChild(focusPane)") < appSource.indexOf("split.appendChild(grid)")
  );
  check(
    "focus pane: duplicate proposal ids cannot break grid arrows -- the grid anchor lookup skips the earlier focus-pane copy",
    appSource.includes("A selected proposal is rendered twice") &&
      appSource.includes("document.querySelectorAll<HTMLElement>(cellSelector)") &&
      appSource.includes("const container = cell.closest<HTMLElement>(containerSelector);") &&
      !appSource.includes("const cell = document.querySelector<HTMLElement>(cellSelector);")
  );
  // REVISED by REVIEW SCOPE Pass 1 (2026-08-03): with a workspace-level
  // inspector (Item Check triage), panels ALWAYS leave the section, so
  // the bare-grid condition gained the workspacePane arm. Ambiguity
  // Check (no sink) still reverts to the standard grid exactly as the
  // original side-by-side finding specified -- the assertion pins the
  // widened condition rather than being silently deleted.
  check(
    "focus pane: a grid with no open panel (or with a workspace inspector taking the panels) still renders bare and full-width",
    appSource.includes("if (workspacePane || focusPanels.length === 0) {") && appSource.includes("sectionEl.appendChild(grid);")
  );
  check(
    "focus pane: index.html gives the panel the wider share (3fr) and the items the narrower (2fr)",
    indexHtml.includes(".triage-split { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr)")
  );
  check(
    "focus pane: the split stacks below the width at which the item column can still hold two tracks",
    indexHtml.includes("@media (max-width: 1239.98px) { .triage-split { grid-template-columns: minmax(0, 1fr); } }")
  );
  check(
    // SUPERSEDED 2026-08-06. The auto-fill track was preserved for a year
    // under "don't mess up the responsiveness" -- but tuned live in the
    // browser against the real document, auto-fill was the problem, not the
    // protection: it stretched cells across 1600px and produced a different
    // column count per section. Andrew: "we don't have to resize
    // horizontally." The track is a FIXED 34rem cap now, and the column
    // count is a deterministic 1-or-2 from the item count.
    "zone grid: a FIXED track, not auto-fill -- one column to 14, two from 15, column-major",
    indexHtml.includes(".triage-grid { display: grid; grid-template-columns: minmax(0, 34rem); grid-auto-flow: row; gap: 0.4rem; }") &&
      indexHtml.includes(".triage-grid.zone-two-col { grid-template-columns: repeat(2, minmax(0, 34rem)); grid-template-rows: repeat(var(--zone-rows, 1), auto); grid-auto-flow: column;") &&
      appSource.includes("const ZONE_TWO_COLUMN_THRESHOLD = 15;")
  );
  check(
    "stage tabs count COMPLETED work, not remaining -- (14/14) must mean finished, never untouched (AG: 'feels like 2/50 means I have a long way to go')",
    appSource.includes("const completed = total - outstanding;") &&
      appSource.includes("` (${completed}/${total})`") &&
      !appSource.includes("` (${outstanding}/${total})`")
  );

  check(
    "a FINISHED stage tab stays on screen -- visibility asks 'does this document have work of this kind', not 'is work outstanding' (AG: 'that's going to be a problem if someone wants to go back')",
    appSource.includes("status.stage === activeStage || status.itemCount + status.artifactCount > 0")
  );
  check(
    "isStageActive keeps its meaning -- traversal and focus reconcile still carry the reviewer onward off a finished stage",
    appSource.includes("import { isStageActive } from \"../engines/navigation/workflow.js\";")
  );
  check(
    "a finished tab shows the CHECK INSTEAD OF the fraction, and wears the app's existing completion green",
    appSource.includes("const complete = total > 0 && outstanding === 0;") &&
      appSource.includes("complete ? `\u2713 ${STAGE_LABELS[status.stage]}`") &&
      appSource.includes('if (complete) tab.classList.add("tab-complete");') &&
      indexHtml.includes(".stage-tabs .tab.tab-complete { color: var(--good); }")
  );
  check(
    "a finished tab and a not-yet-relevant one carry different tooltips (both zero-states can now render)",
    appSource.includes("if (complete) tab.title =") && appSource.includes('else if (!status.available) tab.title = "Nothing to review here yet";')
  );

  check(
    "separation re-anchors focus: the group is hidden AFTER the advance, so the caller that hides it must repair the cursor (AG: 'there is no focused item at all')",
    appSource.includes("function reanchorFocusAfterSeparation(") &&
      appSource.includes("reanchorFocusAfterSeparation(group.groupId, orderBefore);") &&
      appSource.indexOf("separatedGroupIds.add(group.groupId);") < appSource.indexOf("reanchorFocusAfterSeparation(group.groupId, orderBefore);")
  );
  check(
    "separation captures the pre-hide order BEFORE dispatching -- the only moment the separated group's position is knowable",
    appSource.includes("const orderBefore = visibleGroupIds(dispatcher.getState());") &&
      appSource.indexOf("const orderBefore = visibleGroupIds(dispatcher.getState());") <
        appSource.indexOf('dispatchReviewWithVisibleAdvance({ family: "review", type: "completeNotQuite"')
  );
  check(
    "separation never leaves focus on a row it just hid -- it lands on a visible group, or leaves the finished stage alone",
    appSource.includes("if (remaining.length === 0) return;") && appSource.includes("(anchor !== null ? anchor : remaining[0]!)")
  );

  check(
    "Type Check's bulk bar is built from DESCRIPTORS, so its Opt/Alt caps and the chord handler mint from one list",
    appSource.includes("function typeBulkActions(") && appSource.includes("for (const action of typeBulkActions(summary.id, group, remaining, state)) {")
  );
  check(
    "ONE 'larger population' resolver covers every stage -- no surface can advertise a key it does not answer",
    appSource.includes("function groupScopeActions(") && appSource.includes("const actions = groupScopeActions(state);")
  );
  check(
    "the type chord works from a MEMBER row too -- scope is the open type, not wherever the cursor descended to",
    appSource.includes('if (target?.stage === "type-check") {') && appSource.includes("(state.semanticTypes ?? []).find((g) => g.typeId === target.itemId)")
  );
  check(
    "a finished type offers no chords (its disabled buttons must not advertise keys that would refuse)",
    appSource.includes("if (remaining.length === 0) return []; // a finished type offers nothing")
  );
  check(
    "Type Check's member cursor is a SCROLL target -- the highlight and the viewport followed different cursors (AG: 'focused item needs to stay visible')",
    appSource.includes("const memberId = typeCheckCursor?.candidateId;") &&
      appSource.includes('container.querySelector<HTMLElement>(`[data-type-member-id="${escape(memberId)}"]`)') &&
      // `.triage-section` joined the same rule on 2026-08-06 (the section
      // snap made a heading a scroll target). Matched loosely on the two
      // selectors that matter here so a THIRD target joining later does not
      // fail this check for no reason.
      indexHtml.includes(".item-row, .type-member-row") &&
      /\.item-row, \.type-member-row[^{]*\{ scroll-margin-top: calc\(var\(--workspace-chrome-height\)/.test(indexHtml)
  );
  check(
    // LIVE BUG, 2026-08-06: "shift + side arrows no longer works all the
    // way across stages ... got me from Ambiguity to Group then stalled."
    // Clicking a row focuses its CHECKBOX, and a blanket `tag === "input"`
    // refusal killed stage movement from that moment on. Caret ownership is
    // what the guard protects, and a checkbox owns no caret.
    "stage keys: Shift+Arrow refuses only for TEXT ENTRY -- a focused checkbox must not disable stage movement",
    appSource.includes("function isTextEntryElement(el: HTMLElement | null | undefined): boolean") &&
      appSource.includes("if (isTextEntryElement(activeEl)) return false;") &&
      !/if \(tag === "input" \|\| tag === "textarea" \|\| tag === "select"\) return false;/.test(appSource) &&
      appSource.includes('NON_TEXT_INPUT_TYPES = new Set(["checkbox", "radio", "button"')
  );
  check(
    "section snap: a section heading is a scroll target, and it snaps only on ARRIVAL in a new section",
    appSource.includes('section.scrollIntoView({ block: "start" })') &&
      appSource.includes("let lastSnappedSectionId: string | null = null;") &&
      appSource.includes('"data-section-id": String(section.id)') &&
      indexHtml.includes(".item-row, .type-member-row, .triage-section { scroll-margin-top:")
  );
  check(
    "section keys: Opt/Alt section jumps return to Review mode, so the next plain arrow is not swallowed by chrome focus",
    appSource.includes("SECTION JUMP RETURNS TO REVIEW MODE") &&
      appSource.includes("const queueStage = activeSectionedQueueStage(state);") &&
      appSource.indexOf("const active = document.activeElement as HTMLElement | null;") <
        appSource.indexOf("jumpToStageCategory(categories[0]!);") &&
      appSource.indexOf('if (active && typeof active.blur === "function") active.blur();') <
        appSource.indexOf("jumpToStageCategory(categories[0]!);") &&
      appSource.indexOf('if (active && typeof active.blur === "function") active.blur();') < appSource.indexOf("jumpToStageCategory(target);")
  );
  check(
    "refresh restore: sectioned queues persist their visible category and proposal-card cursor, so proposal-only categories do not reopen on a stale candidate category",
    appSource.includes("sectionedCategoryId: string | null;") &&
      appSource.includes("sectionedProposalId: string | null;") &&
      appSource.includes("SECTIONED QUEUE RESTORE") &&
      appSource.includes("structuralCardFocusPending = savedProposalId;") &&
      appSource.includes("restoredSectionedCursor = selectStageCategoryCursor(savedCategory);")
  );
  check(
    "proposal-only shortcuts: Opt/Alt arrows and Opt/Alt C/R resolve from the rendered sectioned queue when the row cursor is parked elsewhere",
    appSource.includes("function activeSectionedQueueStage(") &&
      appSource.includes("return structuralCardFocusPending !== null ? sectionedQueueStage(lastRenderedActiveStage ?? undefined) : null;") &&
      appSource.includes("lastRenderedActiveStage = activeStage;") &&
      appSource.includes("lastRenderedActiveStage = null;") &&
      appSource.includes("if (handleGroupScopeChordKey(event)) {") &&
      appSource.indexOf("if (handleSectionArrowKey(event)) {") < appSource.indexOf("if (handleGroupScopeChordKey(event)) {")
  );

  // COMPLETION-PATH AUDIT (AG, 2026-08-03). Every path that finishes work
  // must leave the cursor somewhere real and visible. Four bugs of this
  // shape surfaced in one day; these pin the answers.
  console.log("--- Completion-path audit checks ---");
  check(
    "ONE section-completion advance: runSectionAction and acceptAllInSection share it (the audit found the second still ending at a bare render)",
    appSource.includes("function advanceAfterSectionCompletion(") &&
      appSource.split("advanceAfterSectionCompletion(").length - 1 >= 3
  );
  /* 2026-08-07 completion-path audit. The old form of this check asserted a
   * `visiblePre` array of candidate IDS was snapshotted pre-dispatch -- true,
   * but the advance then ran over targets recomputed from the POST-decision
   * state, so under a review-state filter the completed section was gone from
   * that list and the anchor matched nothing. Both halves must now be
   * pre-decision: the anchor AND the target list it indexes into. */
  check(
    "both section-clearing paths snapshot the ANCHOR (not just an id list) before dispatching",
    appSource.includes("function snapshotSectionCompletionAnchor(") &&
      appSource.split("snapshotSectionCompletionAnchor(").length - 1 >= 3 &&
      appSource.includes("advanceAfterSectionCompletion(completionAnchor)")
  );
  check(
    "the section-completion advance indexes into the PRE-decision target list, reading `after` only for resolved-ness",
    /function snapshotSectionCompletionAnchor\([\s\S]{0,900}?displayedReviewTargetsForSectionedStage\(stage, before\)/.test(appSource) &&
      /function advanceAfterSectionCompletion\([\s\S]{0,600}?advanceWithinDisplayedReviewTargets\(anchor\.stage, anchor\.anchorKey, anchor\.targets, after\)/.test(
        appSource
      )
  );
  check(
    "no bare candidate id can reach the advance as an anchor -- every anchor goes through reviewDisplayTargetKey",
    !appSource.includes("[...visiblePre].reverse().find(") && !/const anchor = anchorTarget\s*\?/.test(appSource)
  );
  /* THE REVIEW ZONE BOUNDS REVIEW TARGETS, NOT CANDIDATES (2026-08-07).
   * `const proposalIds = restSet ? [] : (section.relationshipProposalIds ?? []);`
   * meant a section over ZONE_CAPACITY painted no proposal cells while still
   * emitting their targets -- a cursor destination drawn nowhere. */
  check(
    "the zone's band/rest split is the pure partitionByZone, not an inline candidate-id filter",
    appSource.includes("partitionByZone(gridTargets, (target) => !isReviewDisplayTargetResolved(stage, target, state))") &&
      !appSource.includes("const proposalIds = restSet ? [] :") &&
      !appSource.includes("gridIds.filter((id) => !state.reviewSession?.candidateDecisions[id])")
  );
  check(
    "proposal bulk actions are scoped from the active Review Zone band, never from the whole section collection",
    appSource.includes("function proposalTargetsInActiveReviewZone(") &&
      appSource.includes("sectionGridSequence(section).flatMap((gridTargets)") &&
      appSource.includes("partitionByZone(gridTargets, (target) => !isReviewDisplayTargetResolved(stage, target, state)).band.filter((target) => target.kind === \"proposal\")") &&
      appSource.includes("const collectionProposals = relationshipProposalsInActiveReviewZone(stage, section, state);") &&
      !appSource.includes("const collectionProposals = (section.relationshipProposalIds ?? [])")
  );
  check(
    "proposal digit/chord/Shift+A scope uses the same active-zone proposal subset as the visible collection buttons",
    appSource.includes("const ofKind = relationshipProposalsInActiveReviewZone(queueStage, section, state).filter((p) => p.kind === current.kind);") &&
      appSource.includes("const activeZoneProposals = section ? relationshipProposalsInActiveReviewZone(queueStage, section, state).filter((p) => p.kind === current.kind) : [];") &&
      !appSource.includes("acceptAllInRelationshipKind(proposals.filter((p) => p.kind === current.kind))")
  );
  check(
    "the sectioned grid walks review targets, so candidates and proposals share one painted order",
    appSource.includes("const renderGrid = (gridTargets: readonly ReviewDisplayTarget[]): void =>") &&
      appSource.includes('if (target.kind === "proposal") {')
  );
  /* PAINT ORDER AND TARGET ORDER ARE ONE DERIVATION. Both live in the pure
   * visibleListAdvance.ts so the identity
   * `sectionGridSequence(s).flat() === sectionDisplayTargets(s)` is an
   * executable assertion (visible-list-advance-verification.ts) rather than a
   * comment; app.ts must CONSUME them, never restate them. */
  check(
    "the section-order helpers live in the pure module and app.ts imports rather than restates them",
    appSource.includes("sectionDisplayTargets,") &&
      appSource.includes("sectionGridSequence,") &&
      !appSource.includes("function sectionDisplayTargets(") &&
      !appSource.includes("function sectionCandidateTargetGroups(") &&
      appSource.includes("return sections.flatMap(sectionDisplayTargets);")
  );
  check(
    "visibleListAdvance.ts states the grid rule once, and the flatten identity holds by construction",
    visibleListAdvanceSource.includes("export function sectionGridSequence(") &&
      visibleListAdvanceSource.includes("export function sectionDisplayTargets(") &&
      visibleListAdvanceSource.includes("if (groups.length <= 1) return [[...(groups[0] ?? []), ...proposals]];")
  );
  /* A tiered, proposal-bearing section must paint each proposal ONCE.
   * renderGrid runs per tier, so the proposal grid is a separate entry in the
   * sequence rather than something drawn inside that loop -- structurally,
   * not by relying on today's data never producing such a section. */
  check(
    "every grid the renderer draws is an entry from sectionGridSequence, proposals included",
    appSource.includes("const gridSequence = sectionGridSequence(section);") &&
      appSource.includes("renderGrid(gridSequence[0] ?? []);") &&
      appSource.includes("renderGrid(gridSequence[tierGroups.indexOf(tier)] ?? []);") &&
      appSource.includes("const proposalGrid = gridSequence[tierGroups.length];") &&
      !/renderGrid\(tier\.candidateIds\)/.test(appSource)
  );
  check(
    "the retired rows-then-cards seam is gone rather than kept as a callerless wrapper",
    !appSource.includes("function continueIntoStructuralCards(")
  );
  check(
    "the kind group's Accept All Remaining advances through the unified review-target model, not a card-only cursor pass",
    appSource.includes("function advanceWithinDisplayedReviewTargets(") &&
      appSource.includes("advanceWithinReviewTargets(currentKey, targets") &&
      appSource.includes("function acceptAllInRelationshipKind(") &&
      !appSource.includes("advanceStructuralCursor(")
  );
  check(
    "relationship editor confirms rely on the same unified dispatch path as card buttons, never a parked-row or card-only fallback",
    /else if \(target\.scope === "relationship-kind"\) \{[\s\S]{0,700}?dispatchReviewWithVisibleAdvance\(/.test(appSource) &&
      appSource.includes("const preReviewTargetKey = currentReviewDisplayTargetKey(stage, preItemId, before);") &&
      appSource.includes("if (queueStage !== null && visibleTargets !== null && preReviewTargetKey !== null)") &&
      !appSource.includes("advanceStructuralCursor(")
  );
  check(
    // Bumped 9 -> 10 (2026-08-06, Decision Tracker miscount fix): the new
    // site is anchorSuggestionsAccepted()'s `suggestionsAccepted` dispatch --
    // audited and exempt from needing its OWN advance for the same reason a
    // panel-lifecycle command is: it touches no candidateDecisions (see
    // Commands.ts's doc comment), completes no item, and both of its two
    // call sites (runSectionAction, acceptAllInSection) already reach the
    // existing advanceAfterSectionCompletion() call one line later.
    //
    // Bumped 10 -> 11 (2026-08-08, Reset): confirmReset dispatches the
    // durable reset command and then deliberately reanchors to the first
    // newly-unresolved target from the reset scope. That is not a
    // completion path, so dispatchReviewWithVisibleAdvance's "advance off a
    // just-resolved item" grammar is the wrong tool.
    "no completion path is left with a bare dispatchReview + render: every raw-dispatch site is followed by an advance or is a panel-lifecycle command",
    appSource.split("dispatcher.dispatchReview({").length - 1 <= 11
  );

  check(
    "chord caps are advertised on EVERY group button; only DIGITS keep the scarce-space active-scope gate",
    appSource.includes("const cap = chordCap ?? (active ? digitAssignments.get(action) ?? null : null);") &&
      appSource.includes("const cap = chordCap ?? (active ? digit : null);") &&
      appSource.split("const cap = chordCap ??").length - 1 === 3
  );
  check(
    "reset controls are heading actions with key-styled Opt+Shift caps, but excluded from 1-9 digit assignment",
    appSource.includes("excludeFromDigits: true,") &&
      appSource.includes('keycap: `${OPTION_KEY_LABEL} Shift ${scope.scope === "zone" || collapsed ? "R" : "A"}`,') &&
      appSource.includes("const chordCap = action.keycap ?? (action.chord !== null ? groupScopeChordLabel(action.chord) : null);") &&
      appSource.includes("function digitAssignableSectionActions(") &&
      appSource.includes("sectionActionDigitAssignments(digitAssignableSectionActions(actions),")
  );
  check(
    "reset shortcuts use event.code with Opt/Alt+Shift and open inline confirmation; confirmation owns R/Esc with visible keycaps",
    appSource.includes('const match = /^Key([RA])$/.exec(event.code ?? "");') &&
      appSource.includes("openResetConfirmation(scope);") &&
      appSource.includes("function handleResetConfirmationKey(event: KeyboardEvent): boolean") &&
      appSource.includes('if ((event.code ?? "") === "KeyR")') &&
      appSource.includes('const confirm = keycapButton("R", "Confirm Reset", confirmReset);') &&
      appSource.includes('prompt.appendChild(keycapButton("Esc", "Cancel", cancelResetConfirmation));') &&
      appSource.includes("handleResetConfirmationKey(event)")
  );
  check(
    "an inactive chord cap dims rather than vanishing -- vanishing is what taught reviewers the feature was absent",
    appSource.includes('if (chordCap !== null && !active) btn.classList.add("action-chord-idle");') &&
      indexHtml.includes(".action-chord-idle .keycap-chord { opacity: 0.45; }")
  );
  check(
    "a chord pressed where no group resolves REFUSES with narration on group-bearing stages, and still falls through elsewhere",
    appSource.includes('refuse(`${groupScopeChordLabel(chord)} applies to a group — move into one first.`);') &&
      appSource.includes('if (stage === "type-check" || sectionedQueueStage(stage) !== null) {')
  );

  check(
    /*
     * 2026-08-04 -- A DELIBERATE REVERSAL, RECORDED RATHER THAN DELETED.
     *
     * These two checks guarded inline numbered conclusion chips ON THE
     * MEMBER ROWS, added 2026-08-03 ("these are well-suited to add an
     * inline numbered option. plenty of space"). AG then instructed the
     * opposite for this surface: "simply the text in the cell, the count,
     * and let the main panel do the work."
     *
     * The ROUTE is what mattered and the route survives -- Type Check was
     * once the only decision surface offering no way to state what a thing
     * IS, and it still is not. The chips now render in the inspector for
     * the active member, and the digit keys still act on the cursor member
     * (Type Check remains in the digit handler's stage list, asserted
     * separately below). So this is re-pointed at where the capability
     * lives now, not dropped.
     */
    "Type Check offers the inline numbered route for its active member -- in the inspector now rather than in every cell (AG: 'let the main panel do the work'), reversing the 2026-08-03 in-cell placement",
    appSource.includes("showHeader: true,") && appSource.includes('renderCandidateDetailPanel(pane, paneCandidate,')
  );
  check(
    "...and the inspector shows exactly ONE member, so a conclusion can never be offered for an item the reviewer is not looking at",
    appSource.includes("const paneMemberId = activeMemberId ?? remaining[0] ?? summary.candidateIds[0] ?? null;")
  );

  check(
    "a painted keycap is always pressable: Type Check joins the digit handler's stages, so its inline chips are not decoration",
    appSource.includes('if (target.stage !== "ambiguity-check" && target.stage !== "item-check" && target.stage !== "type-check") return false;')
  );
  check(
    "the digit acts on Type Check's MEMBER cursor, not the type -- and only while that cursor sits inside the focused type",
    appSource.includes('target.stage === "type-check"\n      ? typeCheckCursor?.typeId === target.itemId\n        ? typeCheckCursor.candidateId\n        : null') &&
      appSource.includes("const recommendation = recommendationForCandidate(candidateId, state);")
  );

  check(
    "Type Check reuses the queue's selection scope rule -- selected when checked, all-remaining when not (AG: 'if no items are selected I want the Keep all options to work')",
    appSource.includes("const scope = headingActionScope(group.candidateIds, state);") &&
      appSource.includes('const bulkLabel = (kind: "Keep" | "Rename" | "Redact" | "Ignore"): string => decisionBulkLabel(kind, scope.selected ? "selected" : "all");')
  );
  check(
    "Type Check reuses the generic tri-state select-all rather than a second implementation",
    appSource.includes("appendHeadingSelectionControls(bulkBar, group.candidateIds, state);")
  );
  check(
    "Type Check row checkboxes sit on undecided rows only, in a fixed-width slot",
    appSource.includes('const checkSlot = el("span", { class: "type-member-check" });') &&
      indexHtml.includes(".type-member-check { display: inline-flex;")
  );

  // ══ FOCUS PANEL DENSITY (AG, 2026-08-04) ══════════════════════════════
  console.log("--- Focus panel structural checks ---");
  check(
    "confidence: a WORD, not a percentage -- '28%' invites a good/bad reading the value does not carry ('Records Office 28%' looks like a poor result and is a correct one)",
    appSource.includes("function confidenceBand(likelihood: number): { label: string; className: string }") &&
      appSource.includes('return { label: "Highly likely"') &&
      appSource.includes('return { label: "Highly unlikely"') &&
      appSource.includes("const figure = el(\"span\", { class: `detail-confidence ${band.className}` }, band.label);")
  );
  check(
    "confidence: the band thresholds are confidenceOpener's OWN (95/80/50), so the header word can never contradict the sentence beside it",
    appSource.includes('if (likelihood >= 95) return { label: "Highly likely"') &&
      appSource.includes('if (likelihood >= 80) return { label: "Likely"') &&
      appSource.includes('if (likelihood >= 50) return { label: "Uncertain"') &&
      explanationBuilder.includes("if (likelihood >= 95) return `Almost certainly ${entity}`;") &&
      explanationBuilder.includes("if (likelihood >= 80) return `Likely ${entity}`;") &&
      explanationBuilder.includes("if (likelihood >= 50) return `Possibly ${entity}`;")
  );
  check(
    // PROFESSIONAL TOOL VOICE (AG, 2026-08-04). DocScrub presents evidence;
    // it does not think, believe or find. The openers were the app's
    // highest-traffic copy and the only place it spoke in the first person.
    "voice: no first-person pronoun reaches the reviewer through the confidence openers -- 'We believe this is X' became 'Almost certainly X'",
    !/return `We\b/.test(explanationBuilder) && explanationBuilder.includes("DECLARED DEVIATION: PROFESSIONAL TOOL VOICE")
  );
  check(
    "voice: the standing principle is recorded where future passes will read it, not only in the files it touched",
    claudeMd.includes("Professional tool voice. DocScrub presents evidence; it does not think.") &&
      claudeMd.includes("No first-person pronouns.") &&
      claudeMd.includes("Observations over narration.")
  );
  // The "work avoided, never time saved" constraint is deliberately NOT
  // re-asserted here. decision-reduction-verification.ts already enforces
  // it at RUNTIME, over the actual returned strings
  // (`!/\bsaved\b/i.test(paragraphs.join(" "))`), which is strictly
  // stronger than any source-text grep -- and a source grep additionally
  // trips over the code comment explaining the constraint. Two checks of
  // one property, one of them weaker and more fragile, is how a suite
  // starts getting edited to pass.
  check(
    "confidence: still NO hue -- it was removed on purpose (a red 72% inside a green Keep card) and this panel is decision-tinted; emphasis carries certainty instead",
    !/\.detail-confidence \{[^}]*color:/.test(indexHtml)
  );
  check(
    "evidence: the run-on 'because X, but Y' paragraph is replaced by a SIGNED chip list built from the dictionary's `short` register",
    appSource.includes('emit(expert.positiveEvidence, "positive");') &&
      appSource.includes('emit(expert.negativeEvidence, "negative");') &&
      appSource.includes('const SIGN = { positive: "✓", negative: "✗", neutral: "•" } as const;')
  );
  check(
    // PORT DEFECT REPAIR. Python: `raw.get("polarity") or _polarity(weight)`
    // -- a declared polarity WINS and the weight sign is only the fallback.
    // The port kept the fallback and dropped the table, so 13 rules were
    // rendered under a sign Python says they do not have.
    "polarity: a DECLARED polarity wins over the weight's sign, matching Python's `raw.get('polarity') or _polarity(weight)` -- the weight sign is the fallback, not the rule",
    qualityEngine.includes("const DECLARED_EVIDENCE_POLARITY: Readonly<Record<string, EvidencePolarity>>") &&
      qualityEngine.includes("return DECLARED_EVIDENCE_POLARITY[rule] ?? evidencePolarityForWeight(weight);") &&
      qualityEngine.includes("kind: evidencePolarityFor(item.rule, item.weight),")
  );
  check(
    "polarity: all fourteen of Python's declared rules are carried, including the one that already agreed with its weight -- the table is the whole declaration, not a diff of the mismatches",
    (() => {
      const block = qualityEngine.slice(qualityEngine.indexOf("const DECLARED_EVIDENCE_POLARITY"));
      const body = block.slice(0, block.indexOf("};"));
      const entries = [...body.matchAll(/^\s+(\w+):\s*"(positive|negative|neutral)"/gm)];
      return entries.length === 14 && entries.filter((e) => e[2] === "neutral").length === 13;
    })()
  );
  check(
    "polarity: the WEIGHTS are untouched -- this changes which column an item is presented in, never the score, so every scoring parity suite is unaffected by construction",
    // ASSERTION RELAXED, INTENT UNCHANGED (AG, 2026-08-05). This used to pin
    // the literal call string
    // `scoreCandidateQuality(candidate, occurrences, blocksById, profile.weights, reviewThreshold)`,
    // which broke the moment that call gained the Contextual Person Evidence
    // argument and was reformatted across lines -- a false failure about
    // whitespace, not about weights. What the check is FOR is that this
    // engine passes the PROFILE's weights straight through and never reaches
    // into the ported constants to rewrite one. That is what is asserted
    // now, and it is asserted more directly than the old string did.
    !qualityEngine.includes("EVIDENCE_WEIGHTS[") &&
      /scoreCandidateQuality\(\s*candidate,\s*occurrences,\s*blocksById,\s*profile\.weights,\s*reviewThreshold/.test(qualityEngine)
  );
  check(
    "evidence: NEUTRAL signals render as • -- context the reviewer keeps, with no glyph or hue implying it moved the score (AG)",
    appSource.includes('emit(expert.neutralEvidence, "neutral");') &&
      /\.evidence-neutral \.evidence-sign \{ color: var\(--border\)/.test(indexHtml)
  );
  check(
    "evidence: neutral is emitted LAST -- the reviewer's question is 'for or against', and material answering neither must not be interleaved with the answer",
    appSource.indexOf('emit(expert.negativeEvidence, "negative");') < appSource.indexOf('emit(expert.neutralEvidence, "neutral");')
  );
  check(
    "evidence: an item whose evidence is ALL neutral still renders chips rather than falling through to the sentence -- newly possible now the declared-polarity table is honoured",
    appSource.includes("expert.positiveEvidence.length > 0 || expert.negativeEvidence.length > 0 || expert.neutralEvidence.length > 0")
  );
  check(
    "evidence: ✓/✗ carry the meaning and the hue only REINFORCES it -- these are the decision palette's green and red inside a decision-tinted panel, so a colour-only cue could read as an outcome (and would fail a colour-blind reviewer)",
    /\.evidence-positive \.evidence-sign \{ color: var\(--good\)/.test(indexHtml) &&
      /\.evidence-negative \.evidence-sign \{ color: var\(--caution\)/.test(indexHtml) &&
      /\.evidence-sign \{[^}]*font-size: 0\.9em/.test(indexHtml)
  );
  check(
    "evidence: chips are ordered by |weight|, so truncation drops the WEAKEST signal rather than whatever sorted last -- the chip that explains the verdict is always shown",
    appSource.includes("[...items].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))")
  );
  check(
    "evidence: truncation is DISCLOSED ('+N more') -- a chip list reads as exhaustive where a sentence read as a summary, so hidden evidence made the verdict look unsupported by its own panel",
    appSource.includes('el("span", { class: "evidence-more" }, `+${ranked.length - 3} more`)')
  );
  check(
    "evidence: chips carry a REAL separator character, not CSS gap -- copying yielded '+Strong name structure−Single occurrence' when pasted into Slack",
    indexHtml.includes('.evidence-item::after { content: " · ";') && indexHtml.includes('.evidence-item:last-child::after { content: ""')
  );
  check(
    /*
     * THE TRIPWIRE FIRED, AND THIS IS THE DECLARATION (2026-08-04).
     *
     * The previous version of this check asserted that no dictionary string
     * had been reworded, with a note saying that if a future pass reworded
     * it, the failure was "the prompt to declare the deviation, not a
     * reason to delete the check." AG then supplied reviewer copy for all
     * 55 `short` labels. So the check is re-aimed at what must remain true
     * AFTER the deviation, which is the part that actually protects parity:
     *
     *   - `standard` and `expert` are still VERBATIM Python. These are what
     *     the audit narrative and Expert View render, and what every parity
     *     suite compares. `short` never had a Python-side reviewer surface.
     *   - the deviation is DECLARED in the file that carries it, so the
     *     next reader finds the reasoning before the strings.
     *   - the composed sentence still exists and is still built.
     */
    "evidence: `short` is declared reviewer copy, while `standard`/`expert` -- the registers the audit narrative and parity suites read -- remain verbatim Python",
    explanationDictionary.includes("DECLARED DEVIATION FROM THE ORACLE") &&
      explanationDictionary.includes("Avoid classifier vocabulary. Favor reviewer vocabulary.") &&
      explanationDictionary.includes('standard: "it matches a known first name"') &&
      explanationDictionary.includes('standard: "it is associated with an email address"') &&
      explanationDictionary.includes('expert: "Known first name"') &&
      explanationBuilder.includes("export function buildStandardSummary(")
  );
  check(
    "evidence: the word 'token' is gone from every reviewer-facing label -- it was in seven of them and means nothing outside engineering (AG: 'nobody thinks token')",
    !/short: "[^"]*[Tt]oken[^"]*"/.test(explanationDictionary)
  );
  check(
    "evidence: the three frequency rules render DISTINCTLY -- a reviewer does not care that it is +4 vs +14, but does care whether a thing appears twice or fifty times (AG)",
    explanationDictionary.includes('short: "Seen before"') &&
      explanationDictionary.includes('short: "Repeated"') &&
      explanationDictionary.includes('short: "Highly repeated"')
  );
  check(
    "evidence: no two rules render the SAME label -- the collision AG asked to remove must not be re-minted by the rename",
    (() => {
      // 56 since 2026-08-05: "Used as a person", the single chip the whole
      // Contextual Person Evidence family renders as. The count is asserted
      // alongside uniqueness on purpose -- it is what catches a new rule
      // being added without anyone deciding what it should say -- so it is
      // meant to be updated deliberately, exactly like this, when one is.
      const shorts = [...explanationDictionary.matchAll(/^\s+short: "([^"]+)"/gm)].map((m) => m[1]);
      return shorts.length === 56 && new Set(shorts).size === 56;
    })()
  );
  check(
    "evidence: the flow truncates at the SAME 3-per-polarity the sentence does, so the two can never disagree about how much evidence exists",
    explanationBuilder.includes("positive.slice(0, 3)") && explanationBuilder.includes("negative.slice(0, 3)")
  );
  check(
    "evidence: rendered INLINE and wrapping, so the line count follows panel width rather than evidence count (the panel's scarce axis is vertical)",
    appSource.includes('const evidenceFlow = el("div", { class: "evidence-flow" });') &&
      /\.evidence-flow \{[^}]*flex-wrap: wrap/.test(indexHtml) &&
      !indexHtml.includes(".evidence-list {")
  );
  check(
    "verdict: lives INSIDE the <summary> as the expander itself -- no Why? label, with the caret on the right",
    appSource.includes('const whySummary = el("summary", { class: "why-summary" });') &&
      appSource.includes('whySummary.appendChild(el("span", { class: "detail-verdict" }') &&
      appSource.includes('whySummary.appendChild(el("span", { class: "why-caret", "aria-hidden": "true" }));') &&
      /\.detail-verdict \{[^}]*font-size: 1\.05rem/.test(indexHtml) &&
      /\.why-caret::before \{[^}]*font-size: 1\.35rem/.test(indexHtml) &&
      !indexHtml.includes(".why-label")
  );
  check(
    "evidence: the verdict line is the ENGINE's opener, not a UI paraphrase -- reviewer prose and audit prose come from one function",
    appSource.includes("confidenceOpener(likelihood, candidate.detectedType)") &&
      appSource.includes("import { buildExplanationContext, confidenceOpener }")
  );
  check(
    "sources: near-identical snippets collapse to one with an italic 'and similar' beside it (AG: '[Andrew 20:24] [Andrew 9:38]' are the same evidence twice)",
    appSource.includes("function collapseSimilarSnippets(") &&
      appSource.includes('el("em", { class: "snippet-similar" }, " and similar")')
  );
  check(
    "sources: the collapse can ONLY merge snippets differing in digits, whitespace or case -- a fuzzy threshold could silently hide genuinely distinct evidence, which is worse than repetition on a panel whose job is showing evidence",
    appSource.includes('.replace(/\\d+/g, "#")') && appSource.includes('.replace(/\\s+/g, " ")') && appSource.includes(".toLowerCase()")
  );
  check(
    "sources: dedupe runs BEFORE the 5-snippet cap, so the cap spends its slots on five DISTINCT snippets rather than five copies of one",
    appSource.includes("collapseSimilarSnippets(allOccurrences.map((o) => `${o.context.before}[${o.context.match}]${o.context.after}`)).slice(0, 5)")
  );
  check(
    "sources: the retained text is a REAL snippet from the document in document order, never a synthesised representative",
    appSource.includes("const entry = { text: snippet, similarCount: 0 };")
  );

  // ══ TYPE CHECK MEMBER GRID (AG, 2026-08-04) ═══════════════════════════
  console.log("--- Type Check member grid structural checks ---");
  check(
    "member grid: an auto-fill grid like every other item collection -- the column count follows the viewport ('2 items per row if the data fits best, or 3 if there're more room')",
    indexHtml.includes(".type-member-rows { display: grid; grid-template-columns: repeat(auto-fill, minmax(var(--type-track, 18rem), 1fr));")
  );
  check(
    "member grid: the track FLOOR is per semantic type -- one global minimum is necessarily wrong for a list holding both 'Information Technology Services' and 'PDF'",
    appSource.includes("const TYPE_TRACK_MIN: Record<SemanticTypeId, string> = {") &&
      appSource.includes('rows.style.setProperty("--type-track", TYPE_TRACK_MIN[summary.id]);')
  );
  check(
    "member grid: every type has a floor, and none is below the 14rem the four-button action cluster needs on one line (a narrower track would wrap it, and wrapping is a height change)",
    (() => {
      const table = appSource.slice(appSource.indexOf("const TYPE_TRACK_MIN"));
      const body = table.slice(0, table.indexOf("};"));
      const values = [...body.matchAll(/"(\d+(?:\.\d+)?)rem"/g)].map((m) => Number(m[1]));
      return values.length === 9 && values.every((v) => v >= 14);
    })()
  );
  check(
    // 2026-08-04, SUPERSEDED BY A LATER INSTRUCTION. The assertions that
    // stood here guarded a height-reserved control band inside each cell --
    // the mechanism that made "decision buttons on the active cell only"
    // safe against reflow. AG then reduced the cell to "simply the text in
    // the cell, the count, and let the main panel do the work", which
    // removes the per-cell controls entirely: there is nothing to reveal,
    // so the reflow failure mode is GONE rather than defended against.
    // Retiring a guard whose hazard no longer exists is not weakening the
    // suite; what replaces it is the property that now matters -- that the
    // cell really is only name and count, so the hazard cannot return by
    // accident.
    "member cell: name and count ONLY -- no decision buttons and no inline conclusion chips, so nothing in a cell can change its height (AG: 'let the main panel do the work')",
    !appSource.includes('decisionButtons(candidateId, "type-check", actions') &&
      !appSource.includes('recommendationSuggestionButtons(candidateId, "type-check"') &&
      !indexHtml.includes(".type-member-band") &&
      appSource.includes('const label = el("span", { class: "type-member-value" }, candidate.displayValue);')
  );
  check(
    "member cell: the reduction did NOT take selection with it -- a checkbox is not a decision control, and the type-level bulk bar acts through it",
    appSource.includes('const checkSlot = el("span", { class: "type-member-check" });') &&
      appSource.includes("selectedCandidateIds.has(candidateId)")
  );
  check(
    "member cell: a decided cell keeps the app's ONE completion glyph (.reviewed-check -- 'candidate rows, group rows, member rows, result cells') rather than a worded label competing with the name",
    appSource.includes('row.appendChild(el("span", { class: "reviewed-check" }, "✓"));')
  );
  check(
    "member cell: modelled on .result-cell -- the name is the cell (large, bold, fills it) and the count is small muted reference information",
    /\.type-member-value \{[^}]*font-weight: 700[^}]*font-size: 1\.05rem/.test(indexHtml) &&
      /\.type-member-count \{[^}]*color: var\(--text-muted\)/.test(indexHtml) &&
      /\.type-member-row \{[^}]*padding: 0\.5rem 0\.7rem/.test(indexHtml)
  );
  check(
    "member cell: the value can never wrap, which is what gives both regions uniform row heights without a fixed grid-auto-rows magic number",
    /\.type-member-value \{[^}]*white-space: nowrap/.test(indexHtml) && !/\.type-member-rows \{[^}]*grid-auto-rows/.test(indexHtml)
  );

  // ── TWO REGIONS, ONE COLLECTION (AG, 2026-08-04) ──────────────────────
  check(
    "regions: the inspector is on the LEFT and first in the DOM, so reading order, tab order and visual order agree and the sub-breakpoint stack puts it on top",
    indexHtml.includes(".type-split { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);") &&
      appSource.indexOf("split.appendChild(pane);") < appSource.indexOf("split.appendChild(rows);")
  );
  check(
    "regions: the first contiguous run renders beside the inspector and the REMAINDER continues in a full-width grid below -- no float, no masonry, no overlay, just two ordinary auto-fill grids",
    appSource.includes('const rest = el("div", { class: "type-member-rows type-member-region-rest" });') &&
      appSource.includes("surface.appendChild(rest);") &&
      !/\.type-member|\.type-split|\.type-focus/.test(indexHtml.match(/float:\s*(left|right)/)?.[0] ?? "") &&
      indexHtml.includes(".type-member-rows:empty { display: none; }")
  );
  check(
    "regions: the cut is a RENDER-TAIL measurement (only the attached tree knows how many whole rows fit beside the inspector) and runs with the other geometry passes, before the focus scroll",
    appSource.includes("function layoutMemberRegions(container: HTMLElement): void") &&
      appSource.includes("layoutMemberRegions(container);") &&
      appSource.indexOf("layoutMemberRegions(container);\n") < appSource.indexOf("scrollFocusedRowIntoView(container, state);")
  );
  check(
    "regions: WHOLE ROWS only -- a row is moved when its bottom would fall past the inspector, so region 2 never begins mid-row and no partially-clipped row renders beside the pane",
    appSource.includes("if (cell.getBoundingClientRect().bottom > paneBottom) {")
  );
  check(
    "regions: cells are REPARENTED, not rebuilt -- listeners, checkbox state and the acknowledgement pulse survive the move",
    appSource.includes("for (const cell of rows[r]!) rest.appendChild(cell);")
  );
  check(
    "regions: row banding is measured per visual row, because with auto-fill the column count is a layout result and no nth-child modulus can express 'every other row'",
    appSource.includes("function bandGridRows(grid: HTMLElement): void") &&
      appSource.includes('cell.classList.toggle("type-member-row-band", rowIndex % 2 === 1);') &&
      appSource.includes("bandGridRows(top);") &&
      appSource.includes("bandGridRows(rest);") &&
      indexHtml.includes(".type-member-row-band { background: var(--surface-muted); }")
  );
  check(
    "cursor: ONE ordered collection -- Left/Right are flat ±1 over the whole member list, so the seam between the regions is invisible to sequential movement",
    appSource.includes('if (key === "ArrowRight") return Math.min(total - 1, idx + 1);\n  if (key === "ArrowLeft") return idx === 0 ? "out" : idx - 1;')
  );
  check(
    "cursor: WITHIN a region the step is the shared gridStep, so the two regions and the Results/triage grids cannot drift -- only the seam is local logic",
    appSource.includes("const within = gridStep(idx - base, count, cols, key);") && appSource.includes("if (within !== null) return base + within;")
  );
  check(
    "cursor: the seam is crossed by COLUMN POSITION, not by index -- landing on the next region's first cell would move the cursor sideways as well as down, which a spreadsheet cursor must never do",
    appSource.includes("return Math.min(topCount + Math.min((idx - base) % cols, restCols - 1), total - 1);") &&
      appSource.includes("return Math.min(topCols * Math.floor((topCount - 1) / topCols) + ((idx - base) % cols), topCount - 1);")
  );
  check(
    "cursor: each region's column count is measured from THAT region -- they have different widths by design, so a single page-wide measurement would skip rows in one of them",
    appSource.includes('measuredColumnCount(".type-member-region-top .type-member-row"') &&
      appSource.includes('measuredColumnCount(".type-member-region-rest .type-member-row"')
  );
  check(
    "cursor: Up off the first row of the TOP region backs out to the card level; Up from region 2's first row crosses the seam instead of leaving",
    appSource.includes('if (inTop) return "out"; // above region 1\'s first row is the card level') &&
      appSource.includes('if (next === "out") {')
  );
  check(
    "cursor: an empty region 1 (narrow viewport, inspector full width) still has a working escape rung rather than a dead Up key",
    appSource.includes('if (topCount === 0) return "out";')
  );
  check(
    "member grid: the legend names BOTH arrow axes once the list is 2-D -- '↑↓ Members' was true only while the list was one column",
    appSource.includes('kseg("←→", "Member"),') && appSource.includes('kseg("↑↓", "Row"),')
  );
  check(
    // HONEST SCOPE: this pins gridStep's four edge behaviors by structure,
    // not by executing them. app.ts deliberately exports NOTHING (it is a
    // browser entry module), and adding an export solely to make a helper
    // callable from a test would trade a real property for a testing
    // convenience. The arithmetic is simple enough that the branch
    // expressions ARE the specification; what a browser must still confirm
    // is the `cols` that feeds them, which is layout and untestable here.
    "member grid: gridStep's edges -- Left/Right CLAMP (non-wrapping, matching moveWithinVisibleList), Up/Down return null at a grid edge so a caller can tell 'no row above' from 'moved to the boundary'",
    appSource.includes('if (key === "ArrowRight") return Math.min(count - 1, idx + 1);') &&
      appSource.includes('if (key === "ArrowLeft") return Math.max(0, idx - 1);') &&
      appSource.includes('if (key === "ArrowDown") return idx + cols < count ? idx + cols : null;') &&
      appSource.includes('if (key === "ArrowUp") return idx - cols >= 0 ? idx - cols : null;')
  );

  check(
    "editor-opening actions ship BOTH label forms, spelled out where there is room and terse below the breakpoint",
    appSource.includes("function applyVerboseLabel(") &&
      appSource.includes("verboseLabel: `${bulkLabel(\"Rename\")} — enter replacement`") &&
      appSource.includes("verboseLabel: `${bulkLabel(\"Redact\")} — choose placeholder`") &&
      indexHtml.includes("@media (min-width: 1240px) {\n        .action-label-short { display: none; }")
  );
  check(
    "only editor-opening actions declare a spelled-out form -- one that commits immediately has nothing to spell out",
    appSource.split("verboseLabel:").length - 1 === 4
  );

  // GROUP-SCOPE CHORDS (AG, 2026-08-03).
  console.log("--- Group-scope chord structural checks ---");
  check(
    "chords: matched on event.code, never event.key -- Option+R emits \u00ae on macOS, so the character cannot identify the key",
    appSource.includes('const match = /^Key([KCRNU])$/.exec(event.code ?? "");')
  );
  check(
    "chords: resolve scope through activeScopeSectionActions -- the SAME list the renderer paints and the digit handler runs, so a chord can only fire a button the reviewer can see",
    appSource.includes("const actions = activeScopeSectionActions(state);") && appSource.includes("actions.find((action) => action.chord === chord)")
  );
  check(
    "chords: an open inline editor owns every key, as everywhere else",
    /function handleGroupScopeChordKey[\s\S]{0,900}?if \(inlineEditor \|\| splitReview\) return false;/.test(appSource)
  );
  check(
    "chords: a chorded action is NEVER also numbered (one control, one accelerator) -- the chord cap wins, and the assigner gives it no digit to begin with",
    appSource.includes("const chordCap = action.chord !== null ? groupScopeChordLabel(action.chord) : null;") &&
      appSource.includes("const cap = chordCap ?? (active ? digit : null);") &&
      !appSource.includes("groupScopeChordLabel(action.chord) : digit")
  );
  check(
    "chords: the modifier is SPELLED OUT and platform-detected (AG: 'I never have memorized the weird glyphs')",
    appSource.includes("const OPTION_KEY_LABEL: string") &&
      appSource.includes('return /mac|iphone|ipad|ipod/i.test(`${platform} ${agent}`) ? "Opt" : "Alt";') &&
      !appSource.includes('return `\u2325${chord}`')
  );
  check(
    "chords: platform detection is guarded for the fake DOM and defaults to Alt (a Mac keyboard prints Alt too; a PC has no Opt key at all)",
    appSource.includes('if (typeof navigator === "undefined" || !navigator) return "Alt";')
  );
  check(
    // 2026-08-06: matched by segment BUILDER-agnostic regex. The command
    // card groups its rows now, and "Decide the group" is built with
    // sseg() rather than kseg() because it acts on the scope rather than
    // the focused item -- a change to which ROW it renders in, not to the
    // property under test, which is that the legend spells the modifier
    // through OPTION_KEY_LABEL instead of hardcoding a glyph.
    "chords: ONE spelling function feeds both the keycap and the legend",
    appSource.includes("function groupScopeChordLabel(chord: GroupScopeChord): string") &&
      /[ks]seg\(`\$\{OPTION_KEY_LABEL\} K\/C\/R\/N`, "Decide the group"\)/.test(appSource)
  );
  check(
    "chords: index.html gives the chord cap its own wider treatment",
    indexHtml.includes(".keycap-chord { min-width: 0;")
  );

  check(
    // 2026-08-04: the anchor is now the resolved CONTAINER rather than an
    // item id (measuredColumnCount's own doc comment records why -- Type
    // Check members are keyed by a different attribute and would have
    // resolved to the type card). The property under test is unchanged and
    // asserted more precisely: this caller still measures the cursor's own
    // grid rather than the page.
    "focus pane: Up/Down measure the CURSOR'S grid -- sections differ in column count, so a page-wide measurement would skip rows",
    appSource.includes("const cols = measuredColumnCount(cellSelector, anchor);") &&
      appSource.includes("function gridContainerForItem(")
  );
  check(
    "grid geometry: ONE definition of what an arrow key means on a grid -- the Results/triage mover and Type Check's member cursor both call it, so they cannot drift",
    appSource.includes("function gridStep(idx: number, count: number, cols: number, key: string, columnMajorRows?: number): number | null") &&
      appSource.includes("gridStep(idx, list.length, cols, key, columnMajorRowsOf(anchor))") &&
      // Type Check reaches it through memberGridTarget, which applies it
      // per region (two grids, two column counts) and adds only the seam.
      // It passes no flow, so it keeps row-major arithmetic unchanged.
      appSource.includes("gridStep(idx - base, count, cols, key)")
  );
  check(
    "grid geometry: index, length, columns and rows all come from ONE coordinate space -- the anchor grid's own cells, never a stage-wide list measured with a grid-local row count",
    appSource.includes("const list = gridIds.length > 0 ? gridIds : visibleIds;") &&
      appSource.includes("const idx = currentId ? list.indexOf(currentId) : -1;") &&
      appSource.includes('anchor.querySelectorAll<HTMLElement>("[data-item-id], [data-proposal-id]")')
  );
  check(
    // 2026-08-06: the flow is TOLD, not measured, and this is the assertion
    // that keeps it that way. measuredColumnCount counts cells sharing the
    // first cell's offsetTop IN DOM ORDER -- under column-major the second
    // DOM cell is directly below the first, so it returns 1 and every
    // horizontal move would silently no-op.
    "grid geometry: column-major flow is read from the published class/property, never inferred from a measurement",
    appSource.includes("function columnMajorRowsOf(grid: HTMLElement | null | undefined): number | undefined") &&
      appSource.includes('grid.classList.contains("zone-two-col")')
  );
  check(
    // The 2026-08-02 "DOWN ENTERS" rule was spatially true while the panel
    // rendered below its row; the side-by-side pane moved the panel beside
    // the list and the metaphor went with it.
    "keyboard grammar: arrows are pure MOVEMENT -- ArrowDown no longer enters the panel, and Enter does",
    !appSource.includes('if (event.key === "ArrowDown" && currentId !== null && visibleIds.includes(currentId))') &&
      !appSource.includes('kseg("↓", "Enter item")') &&
      appSource.includes("if (!primary) return false;")
  );
  check(
    "keyboard grammar: Esc is the SINGLE exit from the panel -- Up past the first control no longer backs out",
    !appSource.includes("exitDetailPanel(); // Up past the top: out one level, Review mode") &&
      appSource.includes("function exitDetailPanel(): void")
  );

  // ROW SELECTION (AG, 2026-08-03).
  console.log("--- Row selection structural checks ---");
  check(
    "row selection: scope is computed inside headingSectionActions -- the ONE builder both the renderer and activeScopeSectionActions consult, so the button read and the digit pressed cannot scope differently",
    appSource.includes("function headingActionScope(") &&
      appSource.indexOf("function headingActionScope(") > appSource.indexOf("function headingSectionActions(") &&
      appSource.includes("headingActionScope(tier.candidateIds, state)") &&
      appSource.includes("headingActionScope(section.candidateIds, state)")
  );
  check(
    "row selection: scope excludes already-decided rows, so a heading's count can never overstate what its button changes",
    appSource.includes("const undecided = ids.filter((id) => !state.reviewSession?.candidateDecisions[id]);\n  const checked = undecided.filter((id) => selectedCandidateIds.has(id));")
  );
  check(
    "row selection: reuses the existing selectedCandidateIds set rather than introducing a second selection model",
    !appSource.includes("triageSelectedIds") && appSource.includes("selectedCandidateIds.has(candidateId)")
  );
  check(
    "row selection: checkboxes render on undecided rows only, inside a fixed-width slot that keeps decided rows column-aligned",
    appSource.includes('const checkSlot = el("span", { class: "triage-check-slot" });') &&
      appSource.includes("if (!decided) {") &&
      indexHtml.includes(".triage-check-slot { display: inline-flex;")
  );
  check(
    "row selection: a checkbox click does not also move the cursor (stopPropagation over the row's own click handler)",
    appSource.includes("check.addEventListener(\"click\", (event) => event.stopPropagation());")
  );
  check(
    "row selection: select-all is tri-state -- a partially-checked group must not read as unchecked",
    appSource.includes("input.indeterminate = checked.length > 0 && checked.length < remaining.length;")
  );
  check(
    "row selection: the select-all follows the BUTTONS -- title line at 0/1 tiers, tier heading at 2 (a checkbox no visible button acts on looks broken)",
    appSource.includes("if ((section.tiers ?? []).length <= 1) appendHeadingSelectionControls(titleLine, section.candidateIds, state, isMixedCategory);") &&
      appSource.includes("appendHeadingSelectionControls(tierHeading, tier.candidateIds, state);")
  );
  check(
    "mixed category: no select-all and no category-level bulk action -- two review-unit types mean two action vocabularies, and one control over both would lie about its scope",
    appSource.includes("if (mixedCategory) return;") &&
      appSource.includes("const sectionLevel = isMixedCategory ? [] : headingSectionActions(policy, section, null, state);") &&
      appSource.includes("const isMixedCategory = (section.relationshipProposalIds ?? []).length > 0 && section.candidateIds.length > 0;")
  );
  check(
    "mixed category: relationship proposals render as ordinary rows in the SAME grid, and dim by unit type rather than hiding",
    appSource.includes('const row = el("div", { class: "triage-row", "data-proposal-id": proposalId });') &&
      appSource.includes('row.classList.add("triage-row-inactive-unit")') &&
      indexHtml.includes(".triage-row-inactive-unit { opacity: 0.45; }")
  );
  check(
    "proposal rows follow the unified decision color standard -- dominant decision summary + decisionClass + decision-tinted, no custom proposal palette",
    appSource.includes("const proposalSummary = decisionSummary(proposal.candidateIds.map((id) => state.reviewSession?.candidateDecisions[id]?.decision));") &&
      appSource.includes('if (pendingProposalAction) row.classList.add(decisionClass(pendingProposalAction), "decision-tinted");') &&
      appSource.includes('else if (addressed && proposalSummary.dominant) row.classList.add(decisionClass(proposalSummary.dominant), "decision-tinted");') &&
      indexHtml.includes(".decision-tinted { border-color: var(--decision-border); background: var(--decision-tint); }")
  );
  check(
    "proposal row decision fills are not defeated by alternating row colors -- triage rows restate the shared tint at row-level specificity",
    indexHtml.includes(".triage-row.decision-tinted { background: var(--decision-tint); border-color: var(--decision-border); }")
  );
  check(
    "proposal-only categories: the structural card cursor gets Escape/Enter/digits before stale candidate fallback, and grid arrows do not bail on an empty candidate list",
    appSource.includes("function handleCardPreferredDigitKey(") &&
      appSource.indexOf("STRUCTURAL CARD KEYS BEFORE THE DOMAIN KEYMAP") < appSource.indexOf("const command = dispatcher.resolveKeyboardCommand") &&
      appSource.includes("ENTERED FOCUS PANE ESCAPE") &&
      appSource.indexOf("ENTERED FOCUS PANE ESCAPE") < appSource.indexOf("const command = dispatcher.resolveKeyboardCommand") &&
      appSource.indexOf("if (handleCardPreferredDigitKey(event))") < appSource.indexOf("if (handleIdentityLinkKey(event))") &&
      appSource.includes("if (visibleIds.length === 0 && !anchor) return;")
  );
  check(
    "proposal grid arrows keep proposal ids on the proposal cursor -- CSS escaping, not global escape(), decides whether the target cell is a proposal",
    appSource.includes('anchor?.querySelector(`[data-proposal-id="${cssAttrEscape(targetId)}"]`)') &&
      !appSource.includes('anchor?.querySelector(`[data-proposal-id="${escape(targetId)}"]`)')
  );
  check(
    "relationship cards: arrows stay on the review-unit axis -- Down/Right move to the next card instead of focusing inner buttons/check boxes",
    appSource.includes('if (event.key === "ArrowDown" || event.key === "ArrowRight")') &&
      appSource.includes("ARROWS STAY ON THE REVIEW-UNIT AXIS") &&
      !appSource.includes('card.querySelector<HTMLElement>("input:not([disabled]), button:not([disabled]), select, a[href]")')
  );
  check(
    // 5 -> 6 on 2026-08-06: the Review Zone routed Shift+A through
    // headingActionScope, so that path now has a selection to release too.
    // The count is the point -- it is what catches a NEW bulk path that
    // forgets to release.
    "row selection: a completed bulk action leaves no lingering selection (releaseSelection on every declared-action path, queue and Type Check alike)",
    appSource.split("releaseSelection(scope);").length - 1 === 6
  );
  check(
    // 2026-08-06: the "NO new key binding" rule this used to assert was
    // REVERSED by Andrew ("space bar should select the checkbox, not scroll
    // down the page ... a global rule in cell areas"). Native Space on a
    // Tab-focused checkbox still works and is still asserted; what changed
    // is that a cell now also selects without requiring that Tab.
    "row selection: the checkbox stays a native input, so Tab reaches it and the input guard leaves native Space alone",
    appSource.includes('if (tag === "input" || tag === "textarea" || tag === "select" || tag === "button" || tag === "a") return false;')
  );
  check(
    "row selection: ONE shared toggle for every cell area, not a copy per key handler (AG: 'a global rule in cell areas')",
    appSource.includes("function toggleCandidateSelection(candidateId: string): void") &&
      appSource.split("toggleCandidateSelection(").length - 1 >= 3
  );
  check(
    "row selection: Space never falls through to a page scroll from a cell -- both cell-area handlers preventDefault",
    /if \(event\.key === " "\) \{\s*\n\s*event\.preventDefault\(\);[\s\S]{0,200}?toggleCandidateSelection/.test(appSource) &&
      /if \(key === " "\) \{\s*\n\s*event\.preventDefault\(\);\s*\n\s*toggleCandidateSelection/.test(appSource)
  );
  check(
    "row selection: a decided candidate cannot be selected by key -- the surfaces omit its checkbox, so the count must agree",
    appSource.includes('if (isItemResolvedInState("item-check", candidateId, dispatcher.getState())) return;')
  );
  check(
    "details: D took Space's place as the disclosure key, and Space is no longer bound to expansion",
    appSource.includes('if (event.key.toLowerCase() === "d") {') &&
      appSource.includes('kseg("D", "Details")') &&
      !appSource.includes('kseg("Space", "Details")')
  );
  // REVIEW ZONE (AG, 2026-08-06). The pure rules live in
  // verify/review-zone-verification.ts; these are the WIRING assertions --
  // that the bound is applied at the one choke point and that no path
  // slips around it.
  console.log("--- Review Zone wiring ---");
  check(
    "zone: the bound lands in headingActionScope, the one function both the buttons and the digits read",
    appSource.includes("const zone = reviewZone(undecided, ZONE_CAPACITY);") &&
      appSource.includes("return { ids: zone.ids, selected: false, available: zone.available, bounded: zone.bounded };")
  );
  check(
    "zone: explicit selection stays UNBOUNDED -- the checked branch returns before the zone is applied",
    /const checked = undecided\.filter[\s\S]{0,120}?if \(checked\.length > 0\) return \{ ids: checked, selected: true/.test(appSource)
  );
  check(
    "zone: Shift+A goes through the same choke point rather than handing over the whole section (the one bypass that existed)",
    appSource.includes("const scope = headingActionScope(section.candidateIds, state);") &&
      !appSource.includes("acceptAllInSection(config, section.label, section.candidateIds, queueStage);")
  );
  check(
    // 2026-08-06 (second pass): the zone became a hard 24, so the measured
    // size -- and with it the LAST impure input to a decision path -- was
    // deleted rather than defended. This asserts the deletion stayed
    // deleted: reintroducing a measured zone size would put the bound back
    // in the one blind spot this suite cannot see into.
    "zone: NOTHING is measured to size the zone -- the capacity is a constant",
    !appSource.includes("function syncZoneColumnCount") &&
      !appSource.includes("let zoneColumnCount") &&
      appSource.includes("ZONE_CAPACITY")
  );
  // THE BAND-DRAWING CHECKS WERE REMOVED WITH THE FEATURE (2026-08-06).
  // Drawing the zone as a band beside the panel rendered wrong in the
  // browser and was reverted the same day. Nothing here asserted that it
  // LOOKED right -- which is exactly the point, and the reason it shipped
  // broken: this suite reads source text, so a layout defect is invisible
  // to it. The BOUND is still fully covered above and in
  // verify/review-zone-verification.ts; only its visual expression is gone.

  check(
    "auto-advance: ONE ladder decides which cursor advances, and the suggestion/digit paths use it (2026-08-06 regression)",
    appSource.includes("function decideThroughOwningCursor(command: AnyCommand, candidateId: string, stage: WorkflowStage): void") &&
      // the chip path, the identity-digit path, and the inline editor
      appSource.split("decideThroughOwningCursor(").length - 1 >= 6
  );

  // ACTION CLUSTER (AG, 2026-08-03): content-vs-controls reflow.
  console.log("--- Action cluster structural checks ---");
  check(
    "action cluster: declared ONCE as a reusable utility, not inline on the card that reported the bug (AG: 'abstract this in case it needs to be applied elsewhere')",
    indexHtml.includes(".action-cluster-host {") && indexHtml.includes(".action-cluster {") && indexHtml.includes(".action-cluster-content {")
  );
  check(
    "action cluster: applied by COMPOSITION in app.ts, so a second surface adopts it by adding class names rather than copying CSS",
    appSource.includes('class: "relationship-card-header action-cluster-host"') &&
      appSource.includes('class: "group-row-actions action-cluster"') &&
      appSource.includes('class: "preferred-actions action-cluster-content"')
  );
  check(
    "action cluster: the CONTROLS yield (wrap, right-aligned) and shrink far more eagerly than the content -- the whole priority statement",
    /\.action-cluster \{[^}]*flex-wrap: wrap[^}]*justify-content: flex-end[^}]*flex-shrink: 100/.test(indexHtml)
  );
  check(
    "action cluster: the cluster keeps its automatic min-content floor (NO min-width:0) -- that floor is the widest single button, and is what stops the ladder short of clipping a label",
    !/\.action-cluster \{[^}]*min-width:\s*0/.test(indexHtml) && /\.action-cluster-content \{[^}]*min-width:\s*0/.test(indexHtml)
  );
  check(
    "action cluster: the old rules that made the CHIPS absorb every squeeze are gone",
    !indexHtml.includes(".relationship-card-header .preferred-actions { flex-wrap: nowrap;") &&
      !indexHtml.includes(".relationship-card-header .group-row-actions { flex-wrap: nowrap; }")
  );
  check(
    "action cluster: truncation moved off the inline-flex button (where text-overflow never worked) and onto keycapButton's label span (where it does)",
    indexHtml.includes(".action-cluster-content .preferred-action > span { overflow: hidden; text-overflow: ellipsis;") &&
      appSource.includes('b.appendChild(el("span", {}, label));')
  );

  // GROUP CHECK STANDARDIZATION PASS (2026-08-10): focused group panel +
  // compact remaining group cells only. This pins the deliberate scope: the
  // stage does not gain the Item/Zone global action model, and the existing
  // member-splitting workflow remains rendered from the old branches.
  console.log("--- Group Check focus panel/cell structural checks ---");
  const groupCheckLegend = appSource.slice(appSource.indexOf('"group-check": ['), appSource.indexOf("  // TYPE CHECK", appSource.indexOf('"group-check": [')));
  check(
    "group check: focused group spans the two-column grid and uses a focus-panel presentation class",
    indexHtml.includes(".group-cell-focused { grid-column: 1 / -1; order: -1; }") &&
      indexHtml.includes(".group-focus-panel {") &&
      appSource.includes('if (isFocused) groupCell.classList.add("group-cell-focused");') &&
      appSource.includes('row.classList.add(isFocused ? "group-focus-panel" : "group-review-cell");')
  );
  check(
    "group check: non-focused groups use the standardized compact review-cell treatment without replacing the group row renderer",
    indexHtml.includes(".group-review-cell { min-width: 0; padding: 0.5rem 0.7rem; }") &&
      indexHtml.includes(".group-review-cell .group-row-label") &&
      appSource.includes('const row = el("div", { class: "item-row group-row", "data-item-id": group.groupId });')
  );
  check(
    "group check: cell click only changes focus; existing buttons, inputs, and editors keep their own handlers",
    appSource.includes('closest?.("button, input, select, textarea, a")') &&
      appSource.includes('dispatcher.dispatchNavigation({ family: "navigation", type: "selectItem", itemId: group.groupId });')
  );
  check(
    "group check: the pass did not add Option/global actions; bare group K/C/R/I/F remains the action model",
    !groupCheckLegend.includes("Opt") &&
      groupCheckLegend.includes('kseg("K", "Keep as-is")') &&
      groupCheckLegend.includes('kseg("C", "Change")') &&
      groupCheckLegend.includes('kseg("R", "Redact")') &&
      groupCheckLegend.includes('kseg("I", "Ignore")') &&
      groupCheckLegend.includes('kseg("F", "Fix this")')
  );
  check(
    "group check: expanded-member workflow stayed in the same render path",
    appSource.includes('keycapButton(1, "Separate these", () => startSplitReview(group))') &&
      appSource.includes('keycapButton(memberIndex + 2, "Use", () => useGroupSpelling(group, candidate.displayValue))') &&
      appSource.includes('const sourceBtn = button("Source", () => toggleSourcePanel(group.groupId, candidateId));')
  );

  // REVIEW SCOPE, Pass 1 (AG, 2026-08-03). The single-scope-consumer
  // invariant is exactly the kind of arrangement a grep states and a
  // behavioral test can only sample: ONE resolver call site, every
  // scope-reading surface going through it, and the pipeline order that
  // keeps Enter from reaching the triage accept while widened.
  console.log("--- Review scope (Pass 1) structural checks ---");
  check(
    "scope: resolveReviewScope has EXACTLY ONE call site in app.ts (currentReviewScope, the single assembler)",
    appSource.split("resolveReviewScope(").length - 1 === 1
  );
  check(
    "scope: every consumer reads currentReviewScope -- inspector (renderTriageQueue), keyboard gate, legend, provenance stamp (4 calls + 1 definition)",
    appSource.split("currentReviewScope(").length - 1 === 5
  );
  check(
    "scope: the provenance stamp lives at the dispatch choke point and never overwrites a caller's own stamp",
    appSource.includes("command = { ...command, scope: scopeDescriptor(scope) };") && appSource.includes("command.scope === undefined")
  );
  check(
    "scope: the scope-mode gate runs BEFORE handleTriageKey, so Enter from the widened state can never accept a recommendation on the parked row",
    appSource.indexOf("if (handleScopeModeKey(event)) {") !== -1 &&
      appSource.indexOf("if (handleScopeModeKey(event)) {") < appSource.indexOf("if (handleTriageKey(event)) {")
  );
  check(
    "scope: the gate's digit pass-through consults the SAME assignment pair the renderer paints keycaps from",
    // The accessor argument arrived with SEVERITY-FIXED DIGITS and changed
    // again with GROUP-SCOPE CHORDS, both 2026-08-03. The invariant this
    // pins is unchanged throughout -- the gate and the renderer read ONE
    // assignment -- so only the literal has moved, twice.
    appSource.includes("sectionActionDigitAssignments(activeScopeSectionActions(state), (a) => a.chord)")
  );
  check(
    "scope: the inspector precedes the queue in DOM order (visual order = tab order; stacking puts it on top)",
    appSource.indexOf("split.appendChild(inspector)") !== -1 &&
      appSource.indexOf("split.appendChild(inspector)") < appSource.indexOf("split.appendChild(queueHost)")
  );
  check(
    "scope: index.html carries the workspace split (same 3fr/2fr share and 1239.98px stack as the section split it graduates from)",
    indexHtml.includes(".scope-split { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr)") &&
      indexHtml.includes("@media (max-width: 1239.98px) { .scope-split { grid-template-columns: minmax(0, 1fr); } }")
  );
  check(
    "scope: the parked cursor stands the activation treatment down without losing position (dashed outline rule present)",
    indexHtml.includes(".triage-row-focused.triage-row-parked { box-shadow: none; border-style: dashed; }")
  );
  check(
    "scope: widening validity is reconciled at render()'s top, never managed by scattered clears",
    appSource.includes("reconcileScopeWidening(state);") && appSource.includes("function reconcileScopeWidening(")
  );

  console.log("--- Importing the real compiled UI module against a fake DOM ---");
  const { app } = installFakeDom();
  let threw: unknown = null;
  try {
    await import("../dist/ui/app.js");
  } catch (error) {
    threw = error;
  }
  check("importing dist/ui/app.js does not throw during initial module evaluation", threw === null, threw instanceof Error ? threw.message : String(threw));
  check("the initial ('no document loaded') render populated #app with content", app.children.length > 0);
  check(
    "the initial render shows the 'no document loaded' message, not a stale or empty state",
    app.children.some((child) => child.textContent.includes("No document loaded"))
  );

  console.log("\nNOTE: this is a structural sanity check against a minimal fake DOM, not a");
  console.log("real-browser click-through. No GUI browser or browser-automation tool was");
  console.log("available in this sandbox -- see phase-10-findings.md. Recommended follow-up:");
  console.log("open ui/index.html (served over http, not file://) in an actual browser and");
  console.log("click through load -> review -> save/reload -> generate output by hand.");

  console.log(`\n${passCount}/${passCount + failCount} checks passed`);
  process.exitCode = failCount === 0 ? 0 : 1;
}

main();
