# Application Frame Refinement (2026-08-01, v2026-08-01.05)

Spec: Andrew's "Header & Application Frame Refinement" prompt + annotated
screenshot (chat, 2026-08-01) — "a usability and information architecture
refinement, not merely a cosmetic redesign"; the annotated image is
direction, not pixel specification. The header must answer: what
document(s), is my work saved, where am I, what can I do next — and the
frame should separate application identity / review health / workflow
navigation / reviewer commands / application navigation into distinct
visual homes.

## What changed

1. **Header = sticky application frame** (static markup outside `#app`,
   the `.app-version` precedent — render() clears `#app`). Three-column
   grid: logo + version left; DOCUMENT center; save status + settings
   gear right. The old subtitle line (an implementation pointer) is gone.
   `syncAppHeader()` writes the dynamic slots on every render, both
   branches; one-time listeners (gear toggle, outside-click dismissal)
   are wired at startup beside the version-label block, fully fake-DOM
   guarded.
2. **Document identity, center.** States per spec: "No document
   selected"; the active document bold; up to three names inline; "+N ▾"
   expanding an inline panel listing every document. Truncation policy is
   a pure module (`src/ui/documentDisplay.ts`, new suite
   `document-display-verification` 10/10 — exercises the spec's own
   "+4" example literally).
3. **Toolbar simplification.** Left-aligned: **New Document** (fronting a
   hidden file input), **Resume** + "Choose an existing document…"
   select (vault documents via the existing recents/resume machinery),
   **Documents** (opens the documents view; **Back to review** returns).
   Save Session / session-JSON resume / decision import moved to a
   **Session tools** disclosure on the documents view.
4. **Permanent save status** in the header: "✓ All changes saved" /
   "Saving…" / "✓ Saved — storage nearly full" / "⚠ Not saving — …",
   derived by the same staleness/quota logic the old chrome row used
   (`saveStatusView()`, replacing `renderPersistenceStatus`).
5. **Settings gear**, upper right: menu with Preferences / User account /
   DocScrub Vault / Licensing / Updates (all visibly inert placeholders)
   and an About line showing the version.
6. **Review Status strip** (`renderReviewStatus`, replacing
   `renderScoreDiagnostics`' placement): Extraction / Review / Overall as
   large labeled values directly beneath the document name and above the
   tabs; value color = existing muted hues at thresholds <40 red /
   40–79 amber / ≥80 green. The temporary "why did the score change"
   diagnostic text survives, quiet, at the strip's right.
7. **Stage tabs**: equal width across the row (flex: 1 1 0 — QA/Output no
   longer smaller), each embedding its ⇧n keycap as permanent visual
   language (same order as the Shift+digit handler).
8. **Navigation card** at the command bar's far right: small-caps
   "Navigation" label + ⇧1–5 Stages + F6/, Regions + the Jump to
   category select (previously visually detached). Item-command legend
   stays left; card is bordered/surfaced, no bar-height increase.
9. **Sticky obstruction contract extended** (RX-04): the header is a
   second sticky layer. `syncWorkspaceChromeHeight` now publishes
   `--app-header-height` (chrome offsets its sticky top by it) and sums
   both into `--workspace-chrome-height` (scroll margins + workbench
   max-height calcs). Measured, never assumed, as before.

## Judgment calls (documented per the standing standard)

- **"Open documents" = the working set** (active document + in-progress
  vault documents), because the domain model has exactly one active
  document per workspace. Sibling names and the panel are one-click
  Resume switches. Alternatives and reviewer impact documented in
  `documentDisplay.ts`'s header comment. A true multi-open-document model
  would be a domain extension, out of scope for a frame refinement —
  flagged for Andrew if he intended literal concurrent documents.
- **Session tools demoted, not deleted.** Autosave (Milestone 3) already
  makes explicit Save unnecessary in normal review; the portable-copy,
  resume-from-files, and decision-import paths remain — they're the
  cross-machine/versioned-document paths IndexedDB autosave cannot cover.
- **Save-status vocabulary**: spec's "Offline" example rendered as
  "⚠ Not saving — <reason>" instead — the app has no network dependency,
  so "Offline" would misdescribe the actual failure (local persistence).
- **Score color thresholds** (<40 / 40–79 / ≥80) are first-guess, like
  the score formulas themselves (see diagnostic-scoring findings);
  one-line change to revise.
- **Gear placement of stubs**: visibly inert menu items rather than
  hidden — the spec names the gear's future contents explicitly, and an
  empty menu would read as broken.
- **`.command-bar-stagehint` / `.stage-tab-row` / `.score-*` /
  `.persistence-status` CSS retired** with their renderers.
- **Returning from the documents view**: a "Back to review" toolbar
  button appears when a document is loaded — the old "← Documents"
  one-way trip previously required re-resuming to get back.

## Verification

- `npx tsc --noEmit` clean; full `npm run build` (browser serves dist/).
- All **34** suites green (33 prior + document-display-verification;
  counted via `ls verify/*.ts`), zero regressions. One real fake-DOM
  break found BY ui-smoke during this pass (the hidden file input's
  `.style.display` — fake elements have `setAttribute` but no
  CSSStyleDeclaration) and fixed by styling via the attribute; ui-smoke
  back to 15/15.
- Keyboard-region contract untouched: `.top-bar` / `.workspace-chrome` /
  `.keyboard-region` wrappers all survive; F6/, cycling and Escape
  behavior unchanged.

## Browser validation (see status below)

1. Header sticky with document name centered (bold) + siblings + "+N ▾"
   panel opening/closing (outside click closes); "No document selected"
   on a fresh landing.
2. Save status transitions ✓ All changes saved ↔ Saving… during review.
3. Gear menu opens/closes; About shows the version.
4. Review Status strip prominent, colors sensible; diagnostic text still
   appears on score changes.
5. Tabs equal width with ⇧1–5 keycaps; Shift+digit still switches.
6. Navigation card right of the command bar with Jump to category inside;
   category jump still narrows Item Check.
7. New Document opens the file picker; Resume + select switch documents;
   Documents view shows recents + Session tools (all three utilities
   functional); Back to review returns.
8. Long list: focused-row scrolling clears BOTH sticky layers (header +
   chrome).
