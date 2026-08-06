# Reviewer Experience — Wave 2 Findings

**Class: working — active (2026-07-30).** Wave 2 record; browser validation still pending for Steps 3–5 (see Status line below). Not citable as canonical authority.

**Companion to:** `reviewer-experience-wave-2-implementation-plan.md` (followed), `reviewer-experience-wave-1-findings.md` (status line updated to browser-validated, per this plan's precondition note).
**Date:** 2026-07-29
**Status:** Implementation complete. All automated verification green. **Browser validation pending** for Steps 3–5 (sticky chrome / status region / notification channels are largely browser-observable-only; exact steps below). Steps 1–2 are fully Node-verified.
**Note:** the repository moved from `DocScrub-Web/` to `app/` between waves; all work landed in `app/`. The folder is still not a git repository — milestones are described, not committed.

## Milestones

1. **Step 1 closeout** — `three navigation call sites route through visibleItemCheckIds (Category Check narrowing everywhere)`
2. **RX-22** — `single display-label vocabulary (DECISION_DISPLAY_LABEL); durable decision vocabulary untouched`
3. **RX-04 (+RX-26 rider)** — `sticky .workspace-chrome container; measured --workspace-chrome-height; scroll-margin-top on rows; reduced-motion guard`
4. **RX-18** — `static role="status" region + setStatus(); discrete-event narration`
5. **RX-09** — `all 13 window.alert() sites retired into refusal/toast/banner channels; grep returns 0`
6. **Verification** — `8 new ui-smoke structural checks (12/12); 26/26 suites green; tsc + full build clean`

`npx tsc --noEmit` was run after every step; the full battery at the end.

---

## Step 1 — Wave 1 closeout: three call sites gain Category Check narrowing

### Implementation
`renderCommandBar` (Next undecided / Previous decision buttons), `handleScaleNavigationKey` (`]`/`[`), and `jumpToFirstSearchResult` (Enter in the search box — the site the Wave 1 findings doc did not name) all replaced their inline `queryItemCheck(...)` computation with `visibleItemCheckIds(state)`. Scan semantics unchanged — `]`/`[` still wrap, deliberately (recorded divergence, queued for RX-30).

### Files Changed
- `app/src/ui/app.ts`

### Architectural Fit
Removes the last three "what is the visible list" computations that bypassed RX-02a's shared helper. Every navigation path — arrow keys, post-decision advance, `]`/`[`, command-bar buttons, search Enter — now reads one function.

### Automated Verification
`tsc` clean; behavior is call-site wiring with no exported seam, so per the plan it folds into the browser pass (RX-02 step 3 below exercises it).

### Deviations
None.

---

## Step 2 — RX-22: single display-label vocabulary

### Implementation
New `app/src/ui/decisionLabels.ts`: `DECISION_DISPLAY_LABEL: Record<CandidateDecisionKind, string>` (exhaustive by construction; `"Rename" → "Change"`, rest identity) plus `decisionDisplayLabel()`. Substituted at the verified leak sites: the decided-row suffix (was interpolating `decided.decision` directly), the statistics bar (now **iterates the map** rather than hand-writing the template, so a future decision kind cannot be silently omitted), and the filter preset label (`"Renamed"` → `"Changed"`; the never-displayed preset *key* stays `"renamed"`). The command-bar legend strings and group action labels were audited — all already read "Change"; no rewrite needed.

Untouched, per Note #4: `CandidateDecisionKind`'s literal `"Rename"`, all command names, the `InlineEditorTarget` action union, `GROUP_ROW_DECISION_CLASS` keys, and every serialization path. Saved sessions, audit CSV, and decisions.json still carry `"Rename"` (AC #4).

### Files Changed
- `app/src/ui/decisionLabels.ts` (new)
- `app/src/ui/app.ts`
- `app/src/ui/itemCheckQuery.ts`

### Automated Verification
Four new ui-smoke structural checks (no `${decided.decision}` interpolation, no `"Renamed"` label, map imported, zero `window.alert(`); `milestone-2-review-at-scale-verification` still 91/91.

### Deviations
One judgment call beyond the plan's four enumerated sites, disclosed: the **search haystack** (`matchesSearch`) previously matched "rename" but not "change" — a behavioral vocabulary leak (the reviewer sees "Change" on every button but couldn't search it). Fixed **additively**: the haystack now carries both the durable kind and the display label, so everything that matched before still matches. Zero regressions in the suite that owns this code.

---

## Step 3 — RX-04: sticky workspace chrome (+ RX-26 rider)

### Implementation
- **Real container:** `render()` now builds one `.workspace-chrome` node — file line, persistence status, import summary banner, failure banner (Step 5), statistics, warnings, stage tabs, command bar all render *into it*; it is appended once. The top bar (raw file inputs) stays outside and scrolls away (RX-20 deletes it later). This is the chrome/body DOM seam RX-27 will cut along.
- **Sticky rule:** `position: sticky; top: 0; z-index: 20` with an opaque background; a small `padding-bottom` keeps the command bar's bottom margin (and background coverage) inside the container instead of collapsing through its bottom edge.
- **`scroll-margin-top` shipped in the same commit** (Hidden Dependency #1): `.item-row { scroll-margin-top: calc(var(--workspace-chrome-height) + 0.4rem) }` — covers `.group-row` too (it also carries `.item-row`); the 0.4rem is the list's own row gap as a visual cushion. Without this, RX-01's `block:"nearest"` parks the focused row underneath the sticky chrome — an intermittent, misleading regression of already-validated Wave 1 behavior.
- **The chrome height is measured, never assumed** — per Andrew's explicit Wave 2 instruction. The chrome's contents demonstrably change height: flex-wrapped rows re-wrap at narrow widths, processing warnings appear per document, the import and failure banners come and go, the statistics bar's "By type" `<details>` opens and closes, and the command-bar legend varies per stage. So `--workspace-chrome-height` is written from the **rendered element**: `syncWorkspaceChromeHeight()` reads `chrome.offsetHeight` in `render()`'s tail — synchronously *before* `scrollFocusedRowIntoView()` consumes the margin — and a `ResizeObserver` on the chrome element re-publishes it for height changes that occur *without* a render (viewport resize re-wrapping, the `<details>` toggle). The landing branch resets to `0px` and disconnects the observer (AC #3: no sticky chrome on landing — none is built). The custom property therefore represents the actual obstruction at all times, including narrow windows.
- **RX-26 rider:** `@media (prefers-reduced-motion: reduce) { .row-acknowledged-pulse { animation: none } }` — post-RX-14, the pulse fires on every decision; the colour change and `✓ Saved` badge carry the meaning unaided.

### Files Changed
- `app/index.html`
- `app/src/ui/app.ts`

### Architectural Fit
The chrome is a real DOM boundary, not cosmetic CSS (Note #3). RX-20 changes chrome contents freely without touching the offset — the measurement follows, which also discharges the Future-Rework asymmetry the plan flagged (hard-coded height = silent second RX-01 regression). Fake-DOM guards follow the established precedent (no `documentElement`, no `offsetHeight`, no `ResizeObserver` in the harness).

### Automated Verification
Two structural checks (scroll-margin rule present; reduced-motion guard present); ui-smoke's fake-DOM eval passes through the new landing-branch reset path.

### Browser Validation Required
Yes — the wave's principal regression risk. Steps below, including narrow-window behavior per Andrew's instruction.

### Deviations
None. (The height-measurement approach is Andrew's instruction taken as the requirement — the "conservative fixed value" alternative was rejected because the chrome verifiably wraps.)

---

## Step 4 — RX-18: persistent status region

### Implementation
- Static markup in `index.html`, **outside `#app`** (Note #2, Hidden Dependencies #2/#3): `<div class="status-region" role="status" aria-live="polite" aria-atomic="true">` — the application's first accessibility primitives (Hidden Dependency #4: one element, one writer, atomic, so RX-25 extends rather than replaces). Rendered as a fixed bar along the bottom edge — conventional ambient-status placement, `pointer-events: none`, hidden while `:empty`, and being a fixed overlay it never shifts layout. `render()` never creates, clears, or writes it; it works from the landing view where the most probable first error of a session fires.
- One writer: `setStatus(text)` — latest message only, not a log. Never calls `render()` (Note #6).
- Discrete-event writers (AC #3 minimum, all present): **filter re-application** — `announceItemCheckNarrowing()` ("Showing N of M candidate(s).") on search keystrokes, preset toggles, all Category Check chips, the List/By Category switch, and `jumpToCategory`; the narrated count reads the same `visibleItemCheckIds()` as the renderer, so it is definitionally the rendered count. **Bulk action results** — "Change applied to 12 candidate(s)." via the RX-22 map (Item Check bulk, inline-editor bulk confirm, Group Check subset bulk). **Decision-import results** — one-line summary from `getLastDecisionReuseSummary()`. **Refusals and no-ops** — the three former refusal alerts plus `goToAdjacentInVisibleList`'s previously-silent no-target branch (Hidden Dependency #6): "No undecided items in the current list." — narrated now that Step 1 makes it a common, legitimate outcome inside a narrow category.

### Files Changed
- `app/index.html`
- `app/src/ui/app.ts`

### Browser Validation Required
Yes — message persistence across incidental re-renders (background autosave) and landing-view messaging.

### Deviations
The backlog placed the region "in the sticky chrome (RX-04)"; the plan itself corrects that (Hidden Dependency #2), and the correction was followed — static, outside `#app`. Position chosen: fixed bottom bar (the plan required "positioned by CSS to read as part of the chrome" without prescribing an edge; bottom avoids competing with the sticky top chrome for vertical space and is immune to its height changes).

---

## Step 5 — RX-09: retire `window.alert()`

### Implementation
All 13 live sites converted; `grep -c 'window.alert(' app/src/ui/app.ts` → **0** (AC #1), enforced by a ui-smoke structural check. Sorted into the plan's three buckets (Note #5) exactly:

| Bucket | Channel | Sites |
|---|---|---|
| **Refusals** (app declining, with reason) | `refuse()` → status region + console.info; nothing to dismiss | no-document-to-save; no-output-to-download; pick-both-resume-files |
| **Recoverable failures** | `notifyToast()` → ~1.3s toast (CSS fade, fixed overlay, `pointer-events:none`) + a status write that **persists after the fade** + console.error | bulk failed (×2: Item Check, editor confirm), group action failed, save-file unreadable, resume-from-files failed, audit failed, import failed |
| **Failures requiring action** | `showFailureBanner()` → persistent dismissible inline banner + status + console.error | document load failed, resume-from-recent failed, **output generation failed** (the highest-stakes moment) |

Banner mechanics: state-driven (`failureBanner`), rendered by `render()` on **both** branches — normal flow on the landing view (where load/resume failures actually fire, Hidden Dependency #3) and as the **first child of the sticky chrome** on the workspace view, so an unaddressed failure cannot be scrolled out of sight. Reuses the `.warnings` box shape (the import-banner precedent) plus an explicit Dismiss. Its appearance changes chrome height — which the measured `--workspace-chrome-height` absorbs automatically. A successful load/resume/generation clears a superseded banner.

The toast host is static `index.html` markup outside `#app`, `aria-hidden` (its text is always also in the status region — announcing both would double-speak). Toast uses the same cancel-then-restart timer discipline as `acknowledge()`.

The `app.ts:938` doc comment (Feature 002's deliberate no-success-dialog decision) was **reworded, not deleted** (Hidden Dependency #5) — the rationale survives; the literal string does not. The file's top-of-file comment claiming it "uses window.prompt()" — stale since the inline-editor revision — was corrected in the same pass (adjacent stale-doc fix, disclosed).

### Files Changed
- `app/index.html`
- `app/src/ui/app.ts`
- `app/verify/ui-smoke.ts`

### Architectural Fit
No render from any notification function; one render per user action holds throughout (Note #6). All channels are UI-layer; no domain contact anywhere in the wave — `FocusNavigator.ts`, `navigator.ts`, `keymap.ts`, `stages.ts` remain byte-identical, and no verify suite expectation changed.

### Browser Validation Required
Yes — especially the output-generation failure path.

### Deviations
- `CommandResult.reason` is optional (`reason?: string`); the old alerts interpolated `undefined` into user-visible text at four sites. Converted sites use `?? "no reason given"` — a strict improvement, noted because it slightly rewords a (degenerate) message.
- Banner-clearing on superseding success (load/resume/generate) is not in the plan's text; without it a stale "Failed to load" banner would sit above a successfully loaded document. Disclosed as the minimal state hygiene the persistent banner requires.

---

## Verification summary

- Suite count confirmed by counting: **26** (unchanged — no new suite; ui-smoke extended from 4 to **12 checks**).
- All 26 suites green, exit 0. `npx tsc --noEmit` clean. `npm run build` clean — **`dist/` is freshly emitted** (Note #7).
- Wave 1 findings doc's status line updated to browser-validated (Note #8).

## Limits of the Node harness (what is NOT verified)

Steps 1–2 are fully Node-verified (structural checks + existing suites). For Steps 3–5, honestly: the fake DOM has no layout, no `offsetHeight`, no `ResizeObserver`, no CSS, and no live `document.querySelector` — so sticky behavior, the measured height property, scroll-margin correctness, status-region persistence, toast timing, and banner visibility are all **browser-only**. The structural checks prove the markup/rules/wiring exist, not that they behave.

## Manual browser validation steps

Prereqs: `npm run build` has been run (it has); Andrew serves via `start-server.command`; document with ≥ 100 candidates.

**Step 1 / RX-02 closeout**
1. By Category view, pick a category chip: `]` and `[` now move only among displayed candidates; Enter in the search box lands on the first *displayed* candidate; the command-bar buttons match.
2. In a category where everything is decided, press `]` — no movement, and the status bar reads "No undecided items in the current list."

**RX-22**
3. Decide a candidate via Change: row suffix reads "-- Change", statistics bar reads "Keep n · Change n · Redact n · Ignore n", the filter chip reads "Changed". Export decisions.json / audit CSV and confirm they still say `"Rename"` (AC #4).
4. Search "change" — renamed candidates match; search "rename" — they still match.

**RX-04** (the wave's regression risk — check first)
5. Scroll deep into a long list: file line, stats, tabs, and command bar stay pinned; rows vanish beneath them cleanly (no bleed-through in the command bar's bottom margin).
6. RX-01 re-check per AC #2: Arrow Up through the whole list to the **first** row and down to the **last**, both scroll directions — the focused row must never sit underneath the chrome. Decide items near the top edge of travel and confirm the advanced-to row lands fully below the chrome.
7. **Narrow-window check (Andrew's instruction):** shrink the window until the chrome wraps to more lines, repeat step 6 — the scroll margin must track the *taller* wrapped chrome. Open the stats bar's "By type" details and repeat once more (height changed without a render — the observer path).
8. Landing page: no sticky chrome, and no phantom top margin on later scrolling (property reset to 0).
9. Reduced motion (macOS: Accessibility → Display → Reduce motion): decisions still show the colour change and ✓ Saved badge, no pulse animation.

**RX-18**
10. Toggle a filter preset: status bar shows "Showing N of M candidate(s)." and — critically — is still showing it ~5s later after an autosave has re-rendered the page.
11. Run a bulk action: "Change applied to N candidate(s)." Import a decisions.json: one-line result. Click Save Session with no document (from the landing view after ← Documents): refusal appears in the status bar, no dialog.

**RX-09**
12. **Output-generation failure** (the highest-stakes path — e.g. temporarily corrupt a rule/fixture or use a doc known to fail rebuild): persistent banner appears at the top of the sticky chrome, stays while scrolling, Dismiss removes it; console carries the error; no dialog anywhere.
13. Load a non-.docx file renamed to .docx: failure banner on the *landing* view.
14. Force a recoverable failure (e.g. resume with a JSON that isn't a save file): toast appears top-right, fades ~1.3s, message persists in the status bar; nothing shifts layout.
15. Whole session: confirm no native dialog ever appears.

## Stop conditions

None triggered.

## Complete file manifest

| File | Change |
|---|---|
| `app/src/ui/app.ts` | Step 1 wiring; RX-22 substitutions; `.workspace-chrome` container + `syncWorkspaceChromeHeight` + observer; notification channels (`setStatus`/`refuse`/`notifyToast`/`showFailureBanner`/`renderFailureBanner`); all 13 alert conversions; discrete-event narration; two stale doc comments corrected |
| `app/src/ui/decisionLabels.ts` | new (RX-22 map) |
| `app/src/ui/itemCheckQuery.ts` | "Changed" label; additive display-label search haystack |
| `app/index.html` | sticky chrome CSS + `--workspace-chrome-height` + row scroll-margin; status region + toast host (static, outside `#app`) + their CSS; reduced-motion guard |
| `app/verify/ui-smoke.ts` | 8 new structural checks (12 total) |

`FocusNavigator.ts`, `navigator.ts`, `keymap.ts`, `stages.ts`, and all domain/workspace/io modules untouched. No suite expectation changed.
