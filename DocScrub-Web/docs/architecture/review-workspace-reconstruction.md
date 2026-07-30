# Review Workspace Reconstruction

**Status:** Specification, gap analysis, and roadmap — no implementation in this
document. Written per Andrew's instruction: "Your task is not to invent a new
interface. Instead, reconstruct the intended production Review Workspace from
the accumulated design decisions."

**Sources used** (primary, read directly for this document, not recalled from
memory): `work/pii_docx_redactor/local_web_app.py` (full route-handler survey
+ the embedded HTML/CSS/JS reviewer UI, ~3,900 lines); `redactor/explanations.py`;
`redactor/replacement_rules.py`; `docs/architecture/DocScrub-Web_Target_Architecture_v0.2.docx`
(all 18 sections, all 3 tables — ADR register, glossary); `docs/detection/phase-9-findings.md`
(FocusNavigator design rationale, the "five stages" decision, deliberately-not-ported
list); `src/domain/FocusState.ts`, `src/engines/navigation/keymap.ts`,
`src/engines/ExplanationEngine.ts`, `src/io/DocumentRebuilder.ts`, `src/ui/app.ts`
(current implementation, read directly, not from recollection of earlier edits).

---

## 1. Review Workspace Specification

### 1.1 Information hierarchy

The Python reviewer experience is a **single, continuously scrollable page**,
not a wizard. From top to bottom:

1. **Header** (sticky) — file picker, Scan/Generate buttons, build tag, a
   one-line summary strip (15 live counts: total, to-review, unlikely,
   resolved, items-in-groups, proposed-groups, ambiguous, standalone,
   category-check count, evidence-bucket count, and per-decision tallies),
   and download links once output has been generated.
2. **Keyboard legend** — a static, always-visible one-line reminder of the
   core letters (K/N/R/I/Q) plus "Arrow keys move. Enter expands context."
3. **Redaction Rules** (collapsed `<details>`, closed by default) — one row
   per entity type, with an Advanced toggle that reveals pattern/scope/
   overwrite controls.
4. **Ambiguity Check** (`<details open>` — open by default) — its own
   search/type-filter/sort/direction/page-size bar and pager.
5. **Group Check** (`<details open>` — open by default) — same per-stage
   toolbar shape, plus a "Done Editing" global action.
6. **Category Check** (`<details>` — closed by default) — a three-column
   drill-down navigator (Review State → Category → Context), not a list.
7. **Results** — an always-visible (never collapsed) exhaustive candidate
   grid: its own results-count line, tabs/pager, search/type/sort/direction/
   page-size, a bulk-selection bar, and a 2–5 column responsive grid of
   candidate cells.
8. **Output** — folded into the header's downloads area once generated, not
   a separate page.
9. A single **non-blocking corner toast** for "applied" acknowledgements,
   and a **context-sensitive command bar** that only appears when the
   reviewer's focus is inside Group Check, showing the 3–6 shortcuts valid
   *right now* (its content changes based on whether a group row, an open
   group, a group's action buttons, or an inline editor has focus).

Every stage is visible and independently workable at all times — a reviewer
can leave Group Check half-finished, decide ten Category Check items, and
come back. Nothing is hidden by "next step" logic. This is a direct
expression of architecture v0.2 principle 4.4, "Completion Beats Movement":
*"Moving work is not progress; completion is progress."* Collapsing a
`<details>` is a reviewer's own visibility choice, never a gate.

**This is the single most consequential structural fact for the Workspace
rebuild**: the product's own architecture doc explicitly designed
`FocusNavigator` so that `moveStage`/`focusStage` can jump to *any* stage in
either direction "regardless of completion... Not a wizard" (`FocusState.ts`
line 55). The current thin UI's tab bar does not violate this at the command
level (tabs still allow free jumps), but it does depart from Python's
*simultaneous-visibility* model — see §2.

### 1.2 Major panels (mapped to the architecture doc's own anticipated
component list, §6.11)

| Architecture doc's name | Python UI (embedded HTML) | Purpose |
|---|---|---|
| `AmbiguityCheck` | `#ambiguousResolution` | Candidates with 2+ plausible group homes |
| `GroupCheck` | `#entityResolution` | Proposed entity groups (Confirm/Reject/Flatten/Not Quite/Redact/Ignore) |
| `CategoryCheckNavigator` | `#qualityPanel` | Evidence-category drill-down over To-Review/Unlikely/Resolved |
| `CandidateResultsGrid` | `#rows` | Exhaustive per-candidate queue, paged/sorted/filtered |
| `CandidateDetailPanel` | expanded `.candidate-cell` | Per-candidate explanation + evidence + occurrences |
| `OccurrenceBrowser` | occurrence blocks inside detail panel | Grouped, collapsible per-occurrence context list |
| `RedactionRulesPanel` | `#rulesPanel` | Per-type blanket/sequential replacement configuration |
| `CommandBar` | `#groupCommandBar` | Context-sensitive live keyboard legend |
| `ActionToast` | `#actionToast` | Non-blocking "Applied — X" acknowledgement |
| `BulkActionToolbar` | `.bulkbar` | Select-visible + bulk Keep/Rename/Redact/Ignore |
| `NotQuitePanel` | inline `.not-quite-panel` | Per-member checklist inside a Group Check card |

Every one of these is a *named, intentional* component in the v0.2
architecture doc, not an artifact of Python's implementation — meaning this
is not a case of "the Python app happens to have these panels." The
architecture document, written before most of this UI was even re-examined
for this task, independently anticipated the exact same panel set the HTML
implements. That convergence is strong evidence these are load-bearing
product concepts, not incidental UI, and should be treated as the
Workspace's real scope — not a stretch goal.

### 1.3 Reviewer workflow

The intended path through a document is not linear. A typical session:

1. Scan a DOCX. Ambiguity Check and Group Check open automatically
   (highest-leverage, fewest-items-per-decision work first — one Group
   Check decision can resolve many occurrences at once).
2. Work Group Check top-to-bottom or by search/sort, using single-letter
   bulk actions (Confirm/Flatten/Not Quite, or the fuller Python vocabulary
   — Keep as-is/Flatten/Redact/Ignore/Skip/Not Quite/Not Quite Complete).
   "Not Quite" is the one deliberate exception to "items never disappear on
   click" (v0.2 §4.5) — it opens an inline per-member checklist without
   leaving the group's row.
3. Work Category Check by drilling into the highest-volume evidence
   category (e.g., "Known first name," "Ambiguous lexical token"),
   confirming or restoring individual candidates in bulk from an aggregated
   table rather than paging through Results one at a time.
4. Finish with Results/Item Check for anything left — the exhaustive,
   searchable, sortable safety net that guarantees nothing is silently
   skipped.
5. "Done Editing" on Group Check performs a transactional finish (with a
   confirm step) that snapshots and, on failure, rolls back — reviewers are
   never left in a half-committed state.
6. Generate Output once the domain model reports the review complete;
   Python hard-blocks generation with an explicit message if any candidate
   still carries a legacy "Review" disposition, rather than silently
   disabling a button.

### 1.4 Navigation

Two independent axes, both already correctly modeled in `FocusState.ts`/
`FocusNavigator.ts`/`keymap.ts` (Phase 9, verified against 96 checks with zero
regressions since):

- **Stage axis** — Ambiguity Check → Group Check → Item Check → QA → Output,
  jumpable in either direction, never gated on completion.
- **Item axis** — next/previous/first/last within the current stage's item
  list, clamped (not wrapping) at both boundaries, always resolved against
  stable domain IDs rather than array position or rendered DOM order.

Group Check adds a third, nested axis (member navigation within an open
Not Quite panel), and Results adds a `moveNotQuiteMember`-equivalent free
2D grid movement that Phase 9 explicitly and correctly declined to push
into the domain layer, because it depends on rendered column count — a UI
concern, reserved for the Workspace UI itself to translate ArrowLeft/Right
→ next/previous and ArrowUp/Down → "move by visual row."

### 1.5 Keyboard interaction

Confirmed, current, product-intentional vocabulary (not speculative):

| Context | Keys | Effect |
|---|---|---|
| Item Check / Ambiguity Check | K / N / R / I | Keep / Rename / Redact / Ignore |
| Item Check / Ambiguity Check | ↑↓←→, Home, End | Move active item |
| Item Check | D or . | Toggle candidate detail panel |
| Item Check | Space | Expand/collapse detail |
| Item Check | / | Focus search |
| Group Check (row focus, no panel open) | ↑↓←→ | Move between groups |
| Group Check | K / X / N | Confirm / Reject / Flatten (Feature 001's letters; Python's fuller vocabulary also has Skip/Redact/Ignore at the group level, deliberately not bound to avoid conflicting with R/I's Item Check meaning — see `keymap.ts`'s own doc comment) |
| Group Check | Q | Enter Not Quite |
| Not Quite panel | ↑↓ | Move member cursor |
| Not Quite panel | K / I | Apply Keep/Ignore directly (no text needed) |
| Not Quite panel | N / R | Open a draft editor (need reviewer-entered text) |
| Not Quite panel | Escape | Exit |
| Inline group/Not-Quite editor | ←→↑↓ | Move field | A | Accept | Esc | Cancel |
| Accept-changes / Finish-editing confirms | Y / N | Confirm / cancel |
| Global | Tab / Shift+Tab | Next/previous focusable item across the whole stage |

The **context-sensitive command bar** (`#groupCommandBar`) is what makes this
vocabulary learnable without a static cheat sheet: it renders only the 3–6
commands valid for wherever focus currently is, and disappears entirely
outside Group Check. This is a real, deliberate, already-designed answer to
"how does a reviewer discover 15+ shortcuts without memorizing all of them
up front" — not a nice-to-have.

### 1.6 Evidence presentation

Every candidate carries the same underlying evidence data whether or not the
reviewer ever opens its detail panel — `candidate_to_json()`'s
`"explanation"` field is populated on every serialization, not computed
lazily on click. The detail panel (`renderCandidateDetailPanel`) shows, in
this order:

1. **Badges** — likelihood % (color-coded good/warn/caution), type,
   recommendation (To Review/Unlikely).
2. **Standard summary** — one plain-English sentence
   (`ExplanationEngine.explain_candidate().standard.summary`), e.g. "We
   believe this is a person's name" for ≥95% likelihood, degrading through
   "This is likely..." / "This may be..." / "This is unlikely to be..." at
   lower bands, followed by up to three evidence phrases joined with
   correct Oxford-comma grammar.
3. **Representative snippets** — up to 5 context strings, always visible,
   no extra click.
4. **All occurrences** (collapsed `<details>`, closed by default) —
   grouped into labeled blocks (e.g., "In a table," "Near a signature
   block") rather than one flat list.
5. **Expert View** (collapsed `<details>`, closed by default) — likelihood,
   recommendation, current disposition, type, detector; positive/negative/
   neutral evidence lists with signed weights and full expert-tier prose;
   diagnostic categories; raw scoring explanation string.

The three-tier design (standard / expert / audit) is real, load-bearing
product architecture, confirmed independently by v0.2 §6.5: *"Standard View
explanations, Advanced/Expert View evidence breakdowns, audit-oriented
summaries."* This is not Python UI ornamentation — it is the documented
purpose of `ExplanationEngine`.

### 1.7 ExplanationEngine placement

Per v0.2 §5 and §6.5, `ExplanationEngine` is **not a pipeline stage**. It is
a shared, stateless, synchronous service (`explain(evidence, view)`) called
twice: on demand by the UI, per candidate, when a reviewer opens a detail
panel (never speculatively for every candidate up front — that would be
wasted work for the ~90%+ of candidates a reviewer never expands); and in
batch by `AuditExporter` when generating the audit narrative. It consumes
the `Evidence[]` contract `CandidateQualityEngine` already emits — no new
scoring, no new evidence categories, purely a translation layer from
evidence to prose. In the Workspace, this places `ExplanationEngine` as a
dependency of exactly two components: `CandidateDetailPanel` (interactive,
`view: "standard"` by default, `"expert"` behind the Expert View disclosure)
and `AuditExporter` (batch, `view: "audit"`).

### 1.8 DecisionReuse presentation

Feature 002 already establishes the intended pattern and it should be
preserved, not redesigned: reused decisions are tagged inline with the
existing decision label ("Rename (Imported)") rather than a separate
badge/column, and the evidence description rides along as a hover tooltip —
"minimal 'why was this reused?' surfacing ahead of a full ExplanationEngine
UI," per the code's own comment. Once `ExplanationEngine` exists, the
natural evolution (not a redesign) is for an imported decision's tooltip to
become a one-line entry inside the candidate's Standard summary — "Reused
from a prior review (identical entity, 100% match)" — rather than a
separate mechanism. A non-modal summary banner reports the import result
after the fact (the Feature 002 browser-validation fix), consistent with
this app's "alert on failure only" convention.

### 1.9 Ambiguity workflow

Confirmed directly from Python (`update_ambiguous_match()`) and independently
confirmed in `phase-9-findings.md`: **Ambiguity Check has no separate
resolution mechanism.** It is the exact same `update_decision()` (Keep/
Rename/Redact/Ignore) any other candidate uses, filtered to a different
lens ("candidates with multiple plausible group homes"). There is no
distinct "review separately" API — deciding a candidate directly from the
Ambiguity Check view *is* "reviewing it separately" from its candidate
groups. The current TS domain model already reflects this correctly
(`isItemResolved()` uses the identical `candidateResolvedStatus()` helper
for both `ambiguity-check` and `item-check`). This is a case where an
initial hypothesis from partial Python reading (an apparent "review
separately" escape hatch) turned out, on fuller reading, not to be a
distinct concept at all — worth naming explicitly so it is not
miscategorized as a gap below.

### 1.10 QA (Category Check)

"QA" in Andrew's five-stage vocabulary and "Category Check" in Python's UI
are the same concept, and `phase-9-findings.md` already records why it folds
into Item Check at the *domain* level: both resolve against the identical
`CandidateDecision` vocabulary, and neither has a resolution mechanism of
its own — there is no separate "QA decision." What Category Check adds is
**not new domain state; it is a different aggregation and filter view over
the same Item Check candidates**: group by evidence-category rule (35 named
categories, e.g. "Known first name," "Likely acronym," with per-rule
detail tables showing occurrence counts, forms, and a restore action for
anything provisionally filtered to "Unlikely"), rather than one flat
sortable list. This is purely a Workspace-UI-layer feature — it needs no
new `FocusNavigator` stage, no new `ReviewEngine` command, only a
presentation component that queries the existing candidate list with
different groupings.

### 1.11 Output

Output is a single button, gated on `readiness.reviewComplete`, that
triggers `document.generateOutput`; Python additionally hard-blocks with an
explicit reviewer-facing message if legacy per-occurrence "Review"
dispositions remain (a stronger, more explicit gate than a merely-disabled
button). Generation always performs a **post-write rescan** for any
original PII text that survived redaction (`OutputVerifier` in the current
architecture, `rescan_for_originals()` in Python) and reports
`remaining_originals` directly in the output payload — output is not
"trust the redaction happened," it is "verify the redaction happened."
Four artifacts are produced together: the redacted DOCX, an audit CSV, a
decisions JSON (the same format Feature 002's import already consumes —
confirming decisions.json's dual role as both an audit artifact and a
review-reuse input was correct, not incidental), and a QA metrics JSON.

### 1.12 Audit

`AuditExporter` consumes `ReviewSession`, candidate/evidence data,
processing metadata, and `VerificationReport` — deliberately *not*
`DocumentRebuilder` internals (v0.2 §6.14/§10, the OutputVerifier boundary
that fixes a real ARB-flagged coupling defect in v0.1). One place the
current TS implementation should **not** chase Python parity: Python's
`entity_group_reviews` audit trail stores `canonical_value`/
`replacement_value` — i.e., literal candidate text — directly in the audit
log. TS's `AuditRecord` deliberately excludes raw candidate content from
audit artifacts. This is a documented, already-made, correct call (Phase 11)
and should stay that way; it is a genuine improvement over Python, not a
gap to close.

### 1.13 Save/resume and session state

This is the one area where the Workspace should **not** copy Python's
mechanism, because the mechanism only worked because Python has a server.
Python auto-persists to a single `.local_web_state/review_state.json` file,
keyed to nothing but "the one currently uploaded file" — no session
picker, no explicit save action, no session file the reviewer ever sees or
manages; it reloads silently any time the same file is rescanned. A
browser-local, single-tab, no-backend application has no equivalent place to
put that file invisibly, and a tab can be closed without any server-side
process to remember it. The two candidate models both already appear across
this project's own architecture and Feature 002 work, and are not
competing — they serve different needs:

- **`LocalSessionRepository`** (IndexedDB/OPFS, v0.2 §6.12/§8) — the
  intended *primary* persistence: autosave after every domain transition
  (including Not Quite in-progress drafts, per the ARB-driven v0.2
  correction), transparent crash/refresh recovery, no reviewer action
  required. This does not exist yet in the current implementation
  (`LocalSessionRepository` remains signature-only, per project memory).
- **Explicit export/import** (the file Feature 002 already builds on) — a
  *portable*, reviewer-visible session artifact for moving decisions
  between machines, between document versions ("review once, apply
  everywhere"), or as a deliberate backup. This is additive to, not a
  replacement for, autosave.

The Workspace should treat IndexedDB-backed autosave as the default,
invisible safety net, and keep the explicit file-based save/import
(already built) purely for the cross-version reuse and portability use
case it was actually designed for.

---

## 2. Gap Analysis

Classification key: **Critical** (blocks first attorney testing) · **Important**
(usability improvement, not blocking) · **Nice-to-have** · **Already
implemented, not surfaced**.

### Critical before first attorney testing

1. **Replacement Rule Engine has no equivalent at all.** Confirmed by
   `DocumentRebuilder.ts`'s own doc comment: blanket-vs-sequential
   placeholder modes, per-type configuration, and live preview were
   explicitly scoped out as "a future ReplacementRuleEngine... not
   duplicated ad hoc inside the OOXML rebuild layer." Today, redaction
   falls back to generic placeholders (`"[REDACTED PERSON]"`-style) with no
   reviewer control, confirmed live during Feature 002 browser testing
   (a fallback-placeholder warning fired during that session). An
   attorney reviewing a deposition transcript needs consistent,
   distinguishable placeholders ("WITNESS," sequential numbering to
   preserve who-said-what without revealing identity) — this is not a
   cosmetic preference, it's whether the redacted document remains usable
   as a legal work product.
2. **No candidate evidence/explanation is visible anywhere in the current
   UI.** `renderCandidateStage` shows only `"{value} ({type}) — {decision}"`
   in a plain list. There is no likelihood score, no evidence, no context
   snippet, no occurrence list. A reviewer cannot currently answer "why is
   this flagged?" without reading source code. `ExplanationEngine` remains
   signature-only (confirmed directly: `explain()` has no body). This is
   the single biggest trust/adoption risk for a first legal reviewer,
   since v0.2 §4.2 names explainability as an architectural principle, not
   a UI nicety.
3. **Category Check (evidence-category aggregation) does not exist.**
   Reviewers currently have no way to work "all Known-first-name matches"
   or "all Likely-acronym matches" as a batch — only the flat Item Check
   list. For documents with hundreds of low-signal candidates (the
   Unlikely bucket especially), this is the difference between minutes and
   hours of review time.
4. **Output generation still uses a blocking `window.alert()` on
   failure** (`app.ts` line 339) — consistent with this app's established
   "alert on failure only" convention elsewhere, so not a regression, but
   worth flagging alongside the others since output failure is the
   highest-stakes moment to get the messaging right for a first external
   reviewer.

### Important usability improvements

5. **No search/sort/filter/pagination anywhere in the current UI.**
   Python's every stage (Ambiguity, Group, Results) has its own
   search+type-filter+sort+direction+page-size bar. The current Item
   Check/Group Check render every item in one flat, unpaginated list.
   Fine for the fixture corpus; will not hold up on a 50+ page real
   document with hundreds of candidates.
5b. **No bulk multi-select in Item Check.** Group Check has bulk actions
   (Feature 001); Item Check has none — Python's `.bulkbar` (select-visible
   checkbox + bulk Keep/Rename/Redact/Ignore across a multi-selected set)
   has no TS equivalent.
6. **No context-sensitive command bar / discoverable keyboard legend.**
   The full K/N/R/I/Q(/X) vocabulary exists and is correctly wired in
   `keymap.ts`, but nothing in the UI currently surfaces it to a reviewer
   in the moment. Python's `#groupCommandBar` is a real, deliberate answer
   to shortcut discoverability, not decoration.
7. ~~Stages render one-at-a-time via tabs rather than simultaneously.~~
   **SUPERSEDED, Milestone 1 (2026-07-28):** Andrew reviewed this item
   directly and confirmed a deliberate design preference that differs from
   this document's read of Python's layout: keep horizontal tabs for
   Ambiguity Check / Group Check / Item Check / QA / Output, as non-linear
   workspace tabs a reviewer may switch between freely at any time (not
   wizard steps), adapting "Completion Beats Movement" to a modern browser
   workspace rather than porting Python's single-scrolling-page layout
   literally. This is no longer a gap — the existing tab bar already
   satisfies it (see `app.ts`'s `renderStageTabs`, which never disables a
   tab or gates it on another stage's completion), and each tab's label
   carries a live unresolved/total count so "what's left elsewhere" stays
   visible without opening that stage, which is this milestone's answer to
   the cross-stage-visibility concern originally raised here.
8. **`LocalSessionRepository` (autosave/crash-recovery) is unbuilt.**
   Currently the only persistence is Feature 002's explicit
   export/import file, which requires a reviewer action; there is no
   silent, invisible autosave, so a closed tab loses unsaved review
   progress. This is a real risk for long review sessions, flagged
   directly in v0.2 §6.12/§8 as a required UX contract ("must surface a
   blocking warning... rather than silently failing to persist").
9. **Occurrence-level partial coverage is not surfaced.** The domain
   already tracks resolved/covered occurrence counts internally
   (`review/coverage.ts`), but nothing in the UI shows a reviewer "3 of 5
   occurrences of this name are covered by your group decision, 2 are
   not" the way Python's `partial_relationship`/`uncovered_occurrences`
   fields do.
10. **Not Quite's UI is functional but visually undifferentiated** — plain
    `<div>`/`<button>` rows with no styling to distinguish it from the
    surrounding group list, unlike Python's colored, bordered
    `.not-quite-panel`.

### Nice-to-have

11. Group/candidate visual state coloring (decision-tinted rows/cards),
    completion checkmarks, and the "was X%, now Y%" prior-score indicator
    when a group's live confidence shifts after a member is excluded.
12. The non-blocking corner toast for success acknowledgements (currently
    only the failure path uses `window.alert`; there's no equivalent
    lightweight "Applied — Keep" feedback on success actions in Item/Group
    Check, though Feature 002 already established this exact pattern for
    imports).
13. 2D grid keyboard remapping in Results (Phase 9 explicitly left this to
    a future Workspace UI layer as a translation over 1D `moveItem`).
14. Advanced/basic toggle for the Redaction Rules panel (progressive
    disclosure of pattern/scope/overwrite-manual controls).

### Already implemented, not surfaced

15. **Decision provenance (reviewer vs. imported vs. overridden-import)** —
    fully modeled and audited (Feature 002), just not yet given a richer
    visual treatment than an inline "(Imported)" suffix + tooltip.
16. **Group bulk actions (Confirm/Reject/Flatten)** — fully implemented
    (Feature 001) with correct keyboard bindings; only missing is the
    command-bar surfacing from item 6 above.
17. **Not Quite sub-state** — fully modeled as an explicit `ReviewEngine`
    sub-state exactly per v0.2 §6.8 (durable drafts, not UI-only state);
    what's missing is purely visual polish (item 10), not behavior.
18. **Stage/item navigation, including clamped (non-wrapping) boundaries
    and next-unresolved traversal** — fully built and verification-tested
    (Phase 9, 96 checks); the gap is exclusively that the Workspace UI
    doesn't yet expose Home/End/next-unresolved as reachable UI affordances
    beyond raw keystrokes (no visible "Next unresolved" button, for
    instance, though the keystroke works).
19. **Ambiguity Check's "decide it directly, independent of grouping"
    behavior** — already correctly modeled (§1.9 above); nothing to build.
20. **Post-generation rescan/verification (`OutputVerifier`)** — fully
    built and wired into `document.generateOutput`; the gap is only that
    its findings aren't rendered with the same per-item polish Python's
    `remaining_originals` report has (currently a flat list of
    `[severity] category: description` lines — functionally complete,
    visually plain).

---

## 3. Prioritized Implementation Roadmap

**Phase A — Make review decisions explainable (Critical #2, #3).**
Build `ExplanationEngine.explain()` for real (port `EXPLANATION_DICTIONARY`
and `build_standard_explanation()`'s likelihood-bucketed opener + evidence-
phrase joining from `redactor/explanations.py`), then build
`CandidateDetailPanel` (badges, standard summary, snippets, occurrence
list, Expert View) as the first genuinely new Workspace UI component. This
unblocks every subsequent UI phase, since Category Check, Item Check, and
Group Check all want to show "why" inline or on demand. Also build the
Category Check aggregation/filter view (#3) against the same evidence data
— no new domain state needed, confirmed in §1.10.

**Phase B — Make redaction output trustworthy for a legal reviewer
(Critical #1) — IMPLEMENTED as Milestone 3 (2026-07-28).** ~~Build
`ReplacementRuleEngine`...~~ **RESEQUENCED, Milestone 2 (2026-07-28):**
Andrew reviewed this ordering directly and moved `ReplacementRuleEngine`
out of the immediate next phase and into Milestone 3, alongside
`LocalSessionRepository`/recent documents/review statistics. His stated
reasoning: it introduces genuinely new domain logic and answers a
customization question ("how should redacted placeholders
read?"), not the more urgent question a first attorney tester will actually
ask — "can I review a 150-page document efficiently?" Search, filtering,
bulk actions, navigation, and keyboard ergonomics (originally Phase C/D
below) answer that question immediately and were promoted ahead of it as
Milestone 2. This is a sequencing change, not a scope change —
`ReplacementRuleEngine` remains exactly as scoped above, still wired into
`DocumentRebuilder` per that file's own doc comment, still the one item on
this whole roadmap requiring genuinely new domain logic rather than UI atop
existing state. Delivered as Milestone 3 with one recorded consolidation:
the four named placeholder strategies (generic/sequential/category-specific/
reviewer-defined) were implemented as three (`generic`/`sequential`/
`custom`), with `custom` (an optional `{n}` sequencing token) subsuming both
category-specific and reviewer-defined — see
`docs/detection/milestone-3-reviewer-productivity.md` for the full rationale
and "auto/manual override tracking" (a reviewer's own explicit replacement
always takes precedence over the configured rule) and "apply to existing
decisions" (the live preview recomputes from current decisions on every
config change) both landed as scoped. See
`docs/detection/milestone-2-review-at-scale.md` and
`docs/detection/milestone-3-reviewer-productivity.md`.

**Phase C — Scale the Workspace to real documents (Important #5, #5b, #9)
— IMPLEMENTED as Milestone 2 (2026-07-28).** Search/filter/sort for Item
Check (scoped to Item Check only, not Group Check — see that milestone's
findings doc for why); bulk multi-select for Item Check matching Group
Check's existing bulk-action pattern (Feature 001), generalized via a new
`review.bulkApplyDecision` command; cross-stage quick-jump navigation (Next
undecided/Previous decision/Next ambiguity/Jump to category). Occurrence-
level partial-coverage surfacing (#9) remains open — not part of Milestone
2's scope.

**Phase D — Make the keyboard model discoverable (Important #6) —
IMPLEMENTED as Milestone 2 (2026-07-28).** The context-sensitive
`CommandBar` is built, generalized to render on every stage (not just Group
Check, per Andrew's explicit "should always expose" instruction) rather
than the narrower scope originally anticipated here. Reconsidering the
tab-based stage switcher (#7) remains superseded, not reopened — see
Milestone 1's addendum to gap item 7 above; the persistent cross-stage
summary strip this phase originally proposed as an alternative is instead
satisfied by each tab's own live unresolved/total count, already in place
since Milestone 1.

**Phase E — Close the durability gap (Important #8).**
`LocalSessionRepository` (IndexedDB-backed autosave, crash/refresh
recovery, quota-warning UX) — currently the single largest "this could lose
a reviewer's work" risk in the whole Workspace, and the one item on this
list with an existing Required-priority ADR (ADR-010) behind it.

**Phase F — Polish (Nice-to-have #10–14).** Not Quite visual treatment,
decision-state coloring, success-path toast, 2D grid remapping, Rules panel
progressive disclosure. Do this once Phases A–E give reviewers something
substantively more capable to polish.

### Suggested feature ordering (as literal next `feature-NNN` work items)

**SUPERSEDED, Milestone 2 (2026-07-28)** — the project moved from
individual `feature-NNN` items back to named milestones for this batch of
work (see Andrew's own Milestone 2/3/4 instruction). The original ordering
below is kept for history; actual sequencing follows the milestone
structure recorded in the Phase B/C/D notes above:

1. ~~`feature-003`: ExplanationEngine + CandidateDetailPanel~~ — done,
   Milestone 1 Phase 1.
2. ~~`feature-004`: Category Check aggregation/filter view~~ — done,
   Milestone 1 Phase 2.
3. ~~`feature-005`: ReplacementRuleEngine~~ — resequenced into Milestone 3
   (see Phase B above).
4. ~~`feature-006`: Item Check search/filter/sort/pagination + bulk
   multi-select~~ — done, Milestone 2 (see Phase C above; pagination itself
   was not needed — search/filter narrowing plus sorting were sufficient
   for the fixture corpus tested, and virtualized pagination can be added
   later if a real multi-thousand-candidate document proves it necessary).
5. ~~`feature-007`: CommandBar + stage-visibility rework~~ — CommandBar
   done, Milestone 2 (see Phase D above); stage-visibility rework remains
   superseded (Milestone 1).
6. ~~`feature-008` / Milestone 3: `LocalSessionRepository`
   (autosave/crash-recovery), now grouped with `ReplacementRuleEngine`,
   recent documents, and review statistics.~~ — done, Milestone 3
   (2026-07-28); see `docs/detection/milestone-3-reviewer-productivity.md`.
7. `feature-009` / Milestone 4: Visual/interaction polish batch (items
   10–14), now grouped with typography/spacing/iconography/accessibility/
   onboarding per Andrew's Milestone 4 instruction.

This ordering front-loaded the two originally-Critical items
(explainability, then replacement rules) before any scale/discoverability/
durability work; Andrew's Milestone 2 instruction revised that sequencing
once explainability was in place — see Phase B's note above for his
reasoning.

---

## 4. Items That Should Remain Unchanged From Python

- **Simultaneous, collapsible, non-wizard stage visibility** (§1.1) — the
  *principle*, even if the Workspace ultimately renders it with different
  chrome than raw `<details>` elements. Do not adopt a hard sequential
  wizard.
- **The K/N/R/I/Q keyboard vocabulary and its per-context reinterpretation**
  — already correctly ported (Phase 9) and should not be relearned or
  renamed.
- **Ambiguity Check deciding directly against the same candidate-decision
  vocabulary**, with no separate "pick a group" mechanism (§1.9).
- **The "items never disappear on click" invariant, with Not Quite as the
  one named, deliberate exception** (v0.2 §4.5) — do not generalize the
  exception or remove it.
- **Post-generation rescan/verification as a mandatory step**, not an
  optional or best-effort check.
- **The three-tier explanation model** (standard / expert / audit) as the
  shape of `ExplanationEngine`'s output — do not collapse it to a single
  view for simplicity.
- **"Alert on failure only," never on success"** — already this app's own
  established convention (Feature 002's fix), matching Python's own
  toast-on-success/status-on-failure split.
- **decisions.json's dual role** as both an audit artifact and a
  Decision-Reuse import format (§1.11) — do not fork these into two
  formats.

## 5. Items Deliberately NOT Carried Forward From Python (approved deviations, not gaps)

- **Server-side silent autosave to one implicit state file** — replaced by
  explicit `LocalSessionRepository` (browser-appropriate) plus Feature
  002's portable export/import (§1.13). This is a forced, correct
  adaptation to a backend-less architecture, not a regression.
- **`entity_group_reviews`' raw canonical/replacement text in the audit
  log** — TS's audit trail deliberately omits raw candidate content
  (Phase 11). Keep it that way.
- **2D DOM-viewport-dependent arrow remapping inside `FocusNavigator`
  itself** — correctly kept out of the domain layer (Phase 9); any 2D
  feel belongs in the UI layer only.
