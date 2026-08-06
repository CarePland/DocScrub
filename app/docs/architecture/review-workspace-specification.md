# Review Workspace Specification

**DocScrub-Web — the mature production reviewer workspace**

Status: canonical — authoritative behavioral specification, reconstructed from existing project sources.
Last updated: 2026-07-30 (sources-note correction below; behavioral content unchanged). Not an implementation document, not a design proposal — a record of what this project's own accumulated evidence says the reviewer experience is, has been explicitly deferred, or has only been speculatively proposed.

---

## How to read this document

This document was produced by product archaeology, not invention. Every capability described below is traced to one of three states, marked inline:

- **[BUILT]** — implemented and confirmed in the current codebase, verification suites, and/or real-browser validation records.
- **[DESIGNED]** — explicitly specified, decided, or committed to by Andrew or the project's architecture documents, but not yet implemented. This is design intent, not speculation — it carries the same authority as built capability, just not yet realized.
- **[SPECULATIVE]** — proposed, hinted at, or logically implied by adjacent decisions, but never explicitly committed to. Included because it is strongly supported by pattern or precedent, not because it is confirmed. Nothing is included that lacks multi-source support.

Every substantive claim carries a citation to its source: a file path (with line numbers where practical), a milestone/feature findings document, or the Architecture Review Board report. Where a capability changed status over time (deferred, then later built; or proposed, then explicitly rejected), that history is preserved rather than collapsed into a single final state, because the reasoning behind a reversal is itself part of the specification.

### Sources consulted

- `docs/architecture/review-workspace-reconstruction.md` — the existing specification/gap-analysis document this one supersedes and extends, reconstructed from the Python UI and the v0.2 architecture doc.
- `DocScrub-Web_Architecture_Review_Report.docx` — the Architecture Review Board's pre-implementation review of the v0.1 target architecture (the source of the ADR register, the Required/Recommended findings, and the "Sock Principle"/"Completion Beats Movement" vocabulary that recurs throughout this project).
- `README.md` and every `docs/detection/{phase-N,milestone-N,feature-NNN}-findings.md` document — the full build history, each carrying its own "Architectural decisions," "Verification results," and "Browser validation" sections.
- Source code: `src/domain/Commands.ts`, `src/domain/ReviewSession.ts`, `src/domain/NotQuite.ts`, `src/domain/FocusState.ts`, `src/engines/review/session.ts`, `src/engines/navigation/{keymap,navigator}.ts`, `src/engines/ReplacementRuleEngine.ts`, `src/domain/ReplacementRule.ts`, `src/ui/{app.ts,decisionProvenance.ts,itemCheckQuery.ts}`, `src/io/{LocalSessionRepository,IndexedDbSessionRepository}.ts`, `index.html`.
- The Python oracle at `work/pii_docx_redactor/` (`local_web_app.py`, `redactor/review_queue.py`, `redactor/replacement_rules.py`, `redactor/explanations.py`) — read directly for behavior the TypeScript side's own comments describe as "ported," "not ported," or "deliberately not ported."
- Every `verify/*.ts` suite's own doc comments, which in this codebase routinely explain *why* a behavior is tested the way it is, not just what is tested.

**Correction (2026-07-30):** an earlier revision of this paragraph claimed that two sources the reconstruction document cites — `DocScrub-Web_Target_Architecture_v0.2.docx` and `phase-1-acceptance-criteria.md` — "no longer exist in the repository tree (confirmed by exhaustive glob)." That claim was false. The glob was exhaustive only over the `app/` subtree; both files existed the whole time at the repository-level `docs/architecture/` path, one directory above. (The general lesson is now codified in `../standards/documentation-standards.md`: repository-wide absence claims require repository-wide verification.) As of the 2026-07-30 documentation-root consolidation, both files live at `app/docs/architecture/` — i.e., in this document's own directory. This specification was written without consulting the v0.2 `.docx` directly; every v0.2 statement it relies on entered via direct quotation inside `review-workspace-reconstruction.md` and is cited as such below. Those quotations can now be checked against the original.

---

## 1. Workspace Layout

### 1.1 Layout philosophy: simultaneous visibility, not a wizard

The single most load-bearing structural fact in this project is that **the reviewer workspace is not a sequence of steps.** Every stage — Ambiguity Check, Group Check, Item Check, QA, Output — is independently reachable and independently workable at all times, with no stage gated on another's completion. **[BUILT]**

This traces to two independent sources that converge on the same conclusion, which the reconstruction document treats as strong evidence of a real product concept rather than incidental implementation: the Python UI's literal layout (a single, continuously scrollable page with every stage's `<details>` panel visible and independently expandable — `review-workspace-reconstruction.md:24-25`), and the v0.2 architecture document's own principle 4.4, quoted directly: *"Moving work is not progress; completion is progress"* — internally called the **Sock Principle**, later formalized as **"Completion Beats Movement"** (`DocScrub-Web_Architecture_Review_Report.docx`, Required finding R1; `review-workspace-reconstruction.md:57-59`).

`FocusNavigator`'s own domain-layer contract encodes this directly: `moveStage`/`focusStage` can jump to *any* stage in either direction "regardless of completion... Not a wizard" (`FocusState.ts:55`, quoted in `review-workspace-reconstruction.md:62-68`).

**Milestone 1 evolution, confirmed by Andrew directly, not inferred:** the current implementation does not literally replicate Python's single-scrolling-page layout. It uses **horizontal, non-linear stage tabs** — Ambiguity Check / Group Check / Item Check / QA / Output — that a reviewer may switch between freely at any time, never gated on completion (`app.ts`'s `renderStageTabs`). Andrew reviewed this directly mid-implementation and confirmed it as the intended design, explicitly superseding the reconstruction document's own suggestion to reconsider it (`docs/detection/milestone-1-review-workspace-phase-1-2.md`, "Design decisions" section). "Completion Beats Movement" is preserved through a different mechanism than Python's single page: **every tab carries a live unresolved/total count**, so what's left elsewhere stays visible without opening that stage (`app.ts:566-583`; `review-workspace-reconstruction.md:401-403`). Collapsing a section is a reviewer's own visibility choice; it is never a workflow gate. **[BUILT]**

### 1.2 The eleven named panel components

The reconstruction document maps every panel in the Python UI to a named component in the v0.2 architecture document, and finds all eleven independently named on both sides — evidence the project treats as confirming these are real, load-bearing product concepts rather than incidental UI (`review-workspace-reconstruction.md:73-94`):

| Component | Python UI id | Purpose | Status |
|---|---|---|---|
| Ambiguity Check | `#ambiguousResolution` | Candidates plausibly belonging to more than one group | **[BUILT]** |
| Group Check | `#entityResolution` | Proposed entity groupings, resolved in bulk | **[BUILT]** |
| Category Check Navigator | `#qualityPanel` | Evidence-category aggregation/drill-down | **[BUILT]**, Milestone 1 |
| Candidate Results Grid | `#rows` | The exhaustive, searchable, sortable safety net | **[BUILT]**, as Item Check |
| Candidate Detail Panel | expanded `.candidate-cell` | Per-candidate evidence/explanation | **[BUILT]**, Milestone 1 |
| Occurrence Browser | occurrence blocks | Grouped, collapsible per-occurrence context | **[BUILT]**, Milestone 1 |
| Redaction Rules Panel | `#rulesPanel` | Configurable placeholder strategy + live preview | **[BUILT]**, Milestone 3 |
| Command Bar | `#groupCommandBar` | Context-sensitive shortcut legend + quick actions | **[BUILT]**, Milestone 2, generalized to every stage |
| Action Toast | `#actionToast` | Non-blocking success acknowledgement | **[DESIGNED]**, partially built (see §11.3) |
| Bulk Action Toolbar | `.bulkbar` | Multi-select + bulk decision application | **[BUILT]**, Milestone 2 |
| Not Quite Panel | inline `.not-quite-panel` | Per-group deferred/partial review | **[BUILT]**, functionally; visual treatment is **[DESIGNED]**, not built (see §5.6) |

### 1.3 Stage inventory and what each holds today

1. **Ambiguity Check** — candidates plausibly belonging to more than one proposed group; resolved through the ordinary candidate-decision vocabulary, not a distinct mechanism (§2.2). **[BUILT]**
2. **Group Check** — proposed entity groupings (same real-world person/entity referenced multiple ways), resolved individually (Not Quite) or in bulk (Confirm/Reject/Flatten). **[BUILT]**
3. **Item Check** — the exhaustive, searchable, sortable, filterable candidate list; also hosts the Category Check aggregation view as a toggled sub-mode. **[BUILT]**
4. **QA** — currently a placeholder stage with no interactive per-item model of its own; Category Check (item 3, above) is the domain answer to what "QA" was originally envisioned as (§2.4). **[BUILT]** as a stub; the richer content lives inside Item Check, not here.
5. **Output** — Generate Output, verification report, Download Redacted Document, the Redaction Rules panel, and audit generation/download controls. **[BUILT]**

### 1.4 Docking, responsive behavior

No source — Python UI, v0.2 architecture document, or any milestone report — specifies docking behavior (detachable/rearrangeable panels) or responsive/mobile layout rules beyond a single CSS media query narrowing the Expert View's evidence grid from three columns to one under 900px (`index.html`). **No panel is ever draggable, resizable, or independently dockable; the workspace is a single-column, top-to-bottom document with horizontal tabs, not a multi-pane IDE-style layout.** This is confirmed absence, not an oversight this document is guessing about — responsive/accessibility polish is explicitly named as **Milestone 4 ("Production Polish")** scope, not yet reached (`docs/detection/milestone-2-review-at-scale.md`, "Remaining work"; `docs/detection/milestone-3-reviewer-productivity.md`, "Remaining work"). **[DESIGNED]** only in the broadest sense (it's on the roadmap); no specific responsive behavior has been decided.

### 1.5 Header and persistent chrome

The current implementation's top bar holds: file picker, "← Documents" (return to Recent Documents landing), Save Session, Resume-session-from-file input, "+ original docx" input (needed only for Generate Output after a storage-only resume, see §9.3), Import prior decisions input, persistence status line, and the Recent Documents list when no document is loaded (`app.ts:1533-1587`). **[BUILT]**

The Python UI's header additionally carried a build tag and a 15-count summary strip (`review-workspace-reconstruction.md:26-30`); no evidence this was carried into the current implementation, and no source explains why — treat as a **[DESIGNED, NOT IMPLEMENTED]** gap, not a deliberate omission (no doc comment states a decision to drop it).

---

## 2. Review Workflow

### 2.1 The intended end-to-end journey

The reconstruction document lays out a six-step "typical session," explicitly ordered by leverage — highest-impact, fewest-clicks-per-resolved-item work first (`review-workspace-reconstruction.md:96-122`):

1. **Open a document.** Scan runs the full detection/scoring/grouping pipeline once; Ambiguity Check and Group Check auto-open because they offer the highest leverage — "one Group Check decision can resolve many occurrences at once." **[BUILT]**
2. **Work Group Check** top-to-bottom, or via search/sort, using bulk actions (Confirm/Reject/Flatten) or per-member Not Quite review. **[BUILT]**
3. **Work Category Check** (inside Item Check's "By Category" view) by drilling into the highest-volume evidence categories, confirming or restoring candidates in bulk from an aggregated table rather than paging through the full list one at a time. **[BUILT]**
4. **Finish with Item Check** — the exhaustive, searchable, sortable safety net guaranteeing nothing is silently skipped. **[BUILT]**
5. **Generate Output**, gated on `readiness.reviewComplete`. **[BUILT]**
6. **Save, resume, or walk away at any point** without losing work — the entire premise of Milestone 3. **[BUILT]**

This is described as leverage-ordered guidance, not an enforced sequence — nothing prevents a reviewer from working Item Check first, or bouncing between stages freely, consistent with the non-wizard layout principle in §1.1.

### 2.2 Ambiguity Check has no distinct resolution mechanism

A candidate finding worth stating explicitly because it corrects a natural first assumption: Ambiguity Check is **not** a separate review sub-system. It is the exact same `keepCandidate`/`renameCandidate`/`redactCandidate`/`ignoreCandidate` vocabulary every other stage uses, filtered to a different lens (candidates plausibly belonging to more than one group). Python's own `update_ambiguous_match()` calls the identical `update_decision()` any candidate decision uses (`review-workspace-reconstruction.md:236-249`; confirmed independently in `docs/detection/phase-9-findings.md`). There is no "review separately" API, group-membership picker, or distinct data model for ambiguity resolution. **[BUILT]**

### 2.3 Not Quite: the deliberate exception

Group Check's Not Quite mechanism is the **one deliberate, named exception** to this project's "items never disappear on click" invariant (v0.2 §4.5, per `review-workspace-reconstruction.md:106-108, 589-591`). It exists because a reviewer sometimes needs to resolve a group's members individually rather than accept or reject the group wholesale, without losing the group's context or forcing a premature all-or-nothing decision.

Entering Not Quite changes **zero** candidate decisions by itself — confirmed against Python's own test suite (`test_not_quite_marks_proposal_without_hiding_members`), which is the literal mechanism behind "Not Quite intentionally preserves unresolved work" (`docs/detection/phase-8-findings.md`, "Oracle-corrected assumption #1"). Completing Not Quite (`completeNotQuite`) has **no gate requiring every member to have been individually decided first** — also oracle-corrected against a natural but wrong assumption, confirmed by Python's `test_not_quite_complete_requires_explicit_stage_completion` (same source, assumption #2). Completing only stamps the group's canonical membership (`EntityGroupDecision{decision: "Refined"}`) and records the completion event; it never force-decides a member. **[BUILT]**

Exiting Not Quite without completing does **not** record a group decision, but any per-member action already applied inside the panel persists as an ordinary, real decision regardless of how the transaction ends (`docs/detection/phase-10.1-findings.md`, confirmed via live browser validation). **[BUILT]**

One deliberate, documented divergence from Python: attempting to enter Not Quite for a second group while one is already open is **rejected** ("another Not Quite group is already open; exit it first"), where Python's client JS silently discards the in-progress panel state for the previously-open group. Rationale: `ReviewEngine` is the durable-state authority, not a disposable UI component, and Andrew's own instruction explicitly warns against "implicit precedence rules hidden inside UI code" (`docs/detection/phase-8-findings.md`). **[BUILT]**, and an intentional improvement, not a Python-parity gap.

### 2.4 QA is Category Check, not a separate concept

"QA" as a distinct interactive review stage does not exist as its own domain concept. Both Python's Category Check and the current Item Check's "By Category" view resolve against the identical candidate-decision vocabulary and have no resolution mechanism of their own — there is no separate "QA decision" (`review-workspace-reconstruction.md:251-266`). What Category Check adds is purely a different **aggregation and filter view** over the same Item Check candidates: grouped by evidence-category rule, with per-rule detail tables showing occurrence counts, forms, and a restore action for anything provisionally filtered to "Unlikely." This needs no new `FocusNavigator` stage and no new `ReviewEngine` command — it is UI-layer aggregation only (`app.ts:835-896`). **[BUILT]** as the "List / By Category" toggle inside Item Check.

The **QA tab itself, as a distinct stage in the horizontal tab bar, is currently a stub** — `app.ts` renders only an explanatory placeholder sentence for it ("No interactive QA model in this build"). Whether QA should remain a stub, be removed, or eventually host something distinct from Category Check has not been decided in any source. **[DESIGNED]** in name (the stage exists and is reachable) but its content beyond the placeholder is unresolved — a genuine open question, not a hidden gap.

### 2.5 Output: verify, don't just trust

Generate Output is a single button, gated on `readiness.reviewComplete`. Python hard-blocks generation with an explicit message if any candidate still carries a legacy "Review" disposition, rather than silently disabling the button (`review-workspace-reconstruction.md:119-122`) — a distinction the current implementation preserves through `readiness.reviewComplete`'s own explicit unresolved-count messaging (`app.ts`'s Output stage, confirmed in Milestone 3 browser validation: *"Review is not complete yet — 9 item(s) still unresolved in Item Check."*). **[BUILT]**

Output generation is followed by a **mandatory** post-write rescan for surviving PII text (`OutputVerifier`), not an optional or best-effort check (explicitly named as an item that must NOT change from Python — `review-workspace-reconstruction.md:592-593`). The framing throughout this project is deliberate: *"output is not 'trust the redaction happened,' it is 'verify the redaction happened'"* (`review-workspace-reconstruction.md:277-278`). A real, pre-existing defect was found and fixed here during Feature 001 validation: `OutputVerifier` could set `passed: false` without ever explaining *why* — "a literally unexplainable 'Verification: FAILED, Warnings: 0, Blockers: 0' state," explicitly called out as "exactly the same class of gap ADR's explainability principle exists to prevent" (`docs/detection/feature-001-group-bulk-actions.md`). **[BUILT]**, with the silent-failure defect fixed.

Four artifacts are produced together, not sequentially gated on each other: the redacted DOCX, an audit report, a decisions.json export, and QA metrics (`review-workspace-reconstruction.md:268-282`; confirmed live in `app.ts`'s Output/Audit sections). **[BUILT]**

### 2.6 Save, resume, completion

Covered in full in §9 (Review State). In workflow terms: a reviewer may leave at any point (autosave is continuous, not opt-in), return via the Recent Documents landing page, and resume into the exact prior state — including, per Milestone 3's own explicit success framing, **surviving a real browser refresh**, not just an in-app "are you sure" state reset (`docs/detection/milestone-3-reviewer-productivity.md`, "Browser validation"). **[BUILT]**

---

## 3. Candidate Presentation

Every visible element attached to a single candidate, in the order the detail panel actually renders them (`app.ts:640-769`, cross-referenced against `review-workspace-reconstruction.md:177-196`):

### 3.1 Row-level presentation (always visible, no click required)

- **Candidate text** (the detected value) and **detected type** (person / email / phone / cin / long_numeric_id). **[BUILT]**
- **Confidence badge** — a percentage, color-coded: good (≥ a high threshold), warn (mid), caution (low) (`confidenceBadgeClass`, `app.ts`). **[BUILT]**
- **Decision label**, when decided — "Keep," "Rename," "Redact," "Ignore" — appended to the candidate's row label. **[BUILT]**
- **Decision-provenance suffix** — one of three states computed by the pure `decisionProvenance()` function: nothing (an ordinary reviewer decision), **" (Imported)"** (an untouched imported decision), or **" (Modified from import)"** (a reviewer has since overridden an import) (`src/ui/decisionProvenance.ts`). This is Milestone 3's answer to the reconstruction document's Phase 4 target. **[BUILT]**
- **Occurrence count**, surfaced indirectly through the Occurrence Browser's own header ("All occurrences (N)"), not as a standalone row badge. **[BUILT]** (inside the detail panel, not the row).
- **Decision action buttons** — Keep / Rename / Redact / Ignore, each also carrying its keyboard letter in its own label ("Keep (k)"). **[BUILT]**
- **Detail toggle** — "Detail (d)," opens the full CandidateDetailPanel below the row. **[BUILT]**
- **Selection checkbox** (Item Check only, for bulk operations). **[BUILT]**, Milestone 2.

### 3.2 Candidate Detail Panel (opened on demand, per candidate)

Explanation data is **always populated on every serialization, never computed lazily on click** — the panel opening is cheap because the data is already there (`review-workspace-reconstruction.md:174-176`). Content order, exactly as rendered:

1. **Badges** — likelihood %, type, recommendation (To Review / Unlikely), color-coded. **[BUILT]**
2. **Standard summary** — one plain-English sentence from `ExplanationEngine`, confidence-graded: "We believe this is a person's name" at ≥95%, degrading through "This is likely...", "This may be...", "This is unlikely to be..." at lower bands, plus up to three evidence phrases joined with correct Oxford-comma grammar (`docs/detection/milestone-1-review-workspace-phase-1-2.md`). **[BUILT]**
3. **Representative snippets** — up to 5 context strings, always visible with no additional click. **[BUILT]**
4. **All occurrences** — collapsed `<details>`, closed by default, grouped into labeled blocks (e.g., "In a table," "Near a signature block") rather than a flat list. **[BUILT]** — see §7.2 for the grouping logic.
5. **Expert View** — collapsed `<details>`, closed by default: likelihood, recommendation, current disposition, type, detector; a three-column grid of positive/negative/neutral evidence with signed weights and full expert-tier prose; diagnostic categories; the raw scoring explanation string. **[BUILT]**

### 3.3 Modified/imported status — evolution path

The current inline tag ("Rename (Imported)" / "(Modified from import)") plus a hover tooltip carrying the match evidence (tier, matched prior candidate ID, confidence, human-readable description) is explicitly framed as a **minimal, intentional first step**, not the final design: *"the natural evolution (not a redesign) is for an imported decision's tooltip to become a one-line entry inside the candidate's Standard summary — 'Reused from a prior review (identical entity, 100% match)' — rather than a separate mechanism"* (`review-workspace-reconstruction.md:227-230`). **[BUILT]** in its current minimal form; the richer Standard-summary integration is **[DESIGNED, NOT IMPLEMENTED]**.

### 3.4 Replacement text visibility

A candidate's effective replacement text — whichever the reviewer typed (Rename, or a Redact override) or the configured `ReplacementRuleEngine` strategy would produce — is visible today only inside the Output stage's "Redaction rules" live preview (§8.4), not inline on each candidate's row in Item Check. **[DESIGNED, NOT IMPLEMENTED]**: no source explicitly commits to showing per-candidate resolved replacement text at the row level, but it is strongly implied by the "live preview" language already used for the Rules panel and by the general "explain every recommendation" principle (§13) — flagged in the Gap Analysis (§14) rather than asserted as built.

---

## 4. Group Review

### 4.1 Group presentation

A proposed entity group represents one real-world identity referenced multiple ways across the document (e.g., "Robert Lee," "R. Lee," "Bob Lee"). The Python UI tracked two distinct confidence values per group — an immutable **original proposal confidence** (diagnostic) and a **live confidence**, recalculated from the currently selected/excluded members — a distinction the ARB review flagged as needing an explicit state-ownership decision (original = document state, immutable; live = a `ReviewEngine`-derived value, not separately stored) (`DocScrub-Web_Architecture_Review_Report.docx`, §4.6). **[DESIGNED]**: the underlying `EntityResolutionEngine` output that would supply "original confidence" exists and is real (Gate B, oracle-verified), but no source confirms the current UI actually surfaces a live-recalculated confidence number as members are excluded — this is a named gap (§14), not a confirmed built behavior.

### 4.2 Expand/collapse behavior

Group Check rows are not individually collapsible in the current implementation the way Ambiguity/Category Check's `<details>` sections are — a group's members are inspected via **Not Quite**, which opens an inline per-member checklist without leaving the group's row (`review-workspace-reconstruction.md:106`). **[BUILT]**

### 4.3 Member inspection: Not Quite

Opening Not Quite (`enterNotQuite`, keyboard `q`) surfaces every member of a proposed group with per-member Keep/Rename/Redact/Ignore controls, applied **immediately** via the same `decideCandidate()` helper every other command uses — not staged, not requiring a separate confirm step per member (`src/engines/review/session.ts`). **[BUILT]**

Two navigation axes exist simultaneously while a Not Quite panel is open: the outer Group Check row cursor, and a nested member cursor (`moveNotQuiteMember`, Arrow Up/Down) — a genuinely three-axis interaction model when combined with the stage axis (`review-workspace-reconstruction.md:136-137`). **[BUILT]**

A durable/transient split exists deliberately: `NotQuiteState.activeMemberId` (durable, a resume marker updated only on a *committed* member outcome) is distinct from `FocusPanel.activeMemberId` (transient, the live cursor moved freely by arrow keys), reconciled at one defined sync point — explicitly to avoid "duplicating ReviewEngine state... caches that can silently diverge" (`docs/detection/phase-9-findings.md`). **[BUILT]**

### 4.4 Flattening

**Flatten Group** (keyboard `n`, matching Python's own mapping) bulk-applies a **Rename** decision to every member, using the group's already-computed canonical name as the replacement text, then stamps the group `"Refined"` — the identical value `completeNotQuite` produces, because *"the resulting session state... is exactly what a manual Not-Quite-then-rename-every-member-then-complete pass would produce"* (`docs/detection/feature-001-group-bulk-actions.md`). This is a direct instance of Andrew's own instruction for the feature, quoted in that document: *"should produce the same result a reviewer would obtain by manually confirming every proposed relationship."* **[BUILT]**

A real, pre-existing infrastructure defect was found and fixed while building this: an infinite loop in the OOXML rebuild layer whenever a Rename's replacement text equals (or contains) its own search text — which Flatten Group produces routinely, since flattening a group to its own already-correct canonical name is a common case. Confirmed via direct reproduction (`generateOutput()` never returned); fixed by tracking a search cursor advancing past each replacement's own inserted text (`docs/detection/feature-001-group-bulk-actions.md`). **[BUILT — fixed]**

### 4.5 Renaming (individual)

Within an open Not Quite panel, `n`/`r` (Rename/Redact) do not resolve directly from the keyboard the way `k`/`i` (Keep/Ignore) do, because they require reviewer-entered replacement text a bare keystroke cannot supply — these fall through to a draft editor (`keymap.ts:104-109`). **[BUILT]**

### 4.6 Ambiguity handling at the group level

Covered by §2.2 (Ambiguity Check has no distinct resolution path) and by Decision Reuse's Tier 2 ambiguity guard (§9.4): if candidates in the same proposed group carry conflicting prior decisions, no automatic reuse match is made for the rest of the group rather than silently picking one — *"silently picking one of two conflicting prior decisions would violate 'leave ambiguous entities unresolved'"* (`docs/detection/feature-002-decision-reuse.md`). **[BUILT]**

### 4.7 Confidence updates

See §4.1. A live-recalculating confidence display as group membership changes is **[DESIGNED, NOT IMPLEMENTED]** — real, oracle-verified scoring infrastructure exists to support it, but no source confirms the UI currently recomputes and displays it.

### 4.8 Group-level bulk actions

**Terminology revision (2026-07-28):** the group-level vocabulary described below was originally named Confirm/Reject/Flatten, attributed at the time to a narrower three-operation instruction. Andrew's own subsequent review corrected that account: the three-term set was never a deliberate scope narrowing — it was his own attempt to find transferable terms that read consistently across every "cell" region of this app, and it broke down specifically because "Flatten" reads as meaningless for a single-member group. The vocabulary below is the corrected, standardized one, matching Item Check's own decision terms exactly. This section reflects that revision; see `docs/detection/feature-001-group-bulk-actions.md`'s amendment note for the full history.

Group Check's bulk-action vocabulary now matches Item Check's exactly: **Keep as-is / Rename / Redact / Ignore / Not Quite** — five terms, one vocabulary, reused at every granularity a reviewer decides PII disposition. **[BUILT]**

**Keep as-is** (keyboard `k`; command name `confirmGroup`, unchanged since Feature 001) accepts the proposed grouping as presented: bulk-applies **Keep** to every member, then stamps `EntityGroupDecision{decision: "Confirmed"}`. A real correctness defect was caught before shipping: an earlier draft left member decisions `Undecided` while `resolvedStatus` reported "resolved" via group coverage alone — *"a confusing, unexplainable-looking entry"* in the audit trail, and a state no prior migration phase had ever produced. Fixed to bulk-apply Keep, matching Python's real semantics (`DocumentRebuilder` reads only per-candidate decisions, never group decisions) (`docs/detection/feature-001-group-bulk-actions.md`). **[BUILT — fixed]**

**Rename** (keyboard `n`; command name `flattenGroup`, unchanged) bulk-applies the group's own already-computed canonical name to every member via the same Rename path a reviewer would use one member at a time inside Not Quite, then stamps `EntityGroupDecision{decision: "Refined"}` — the same value a completed Not Quite transaction produces, since the resulting state is equivalent. **[BUILT]**

**Redact** (keyboard `r`) and **Ignore** (keyboard `i`) bulk-apply Redact/Ignore to every member via the same pattern, stamping `EntityGroupDecision{decision: "Confirmed"}` (the grouping is accepted either way; only the per-candidate disposition differs). These fill the `r`/`i` keyboard slots `keymap.ts` deliberately reserved, unbound, since Feature 001, specifically anticipating this extension. `redactGroup` mirrors the direct `redactCandidate` command's optional replacement override. **[BUILT]**

**Reject Group is removed.** It had no counterpart in the corrected five-term vocabulary and no Python precedent; its `x` keybinding and UI button are gone. `EntityGroupDecision`'s `"Rejected"` union member remains in the schema only for backward compatibility with sessions saved before this revision — no command produces it going forward.

Also not built: Python's `entity_group_exclusions` (a per-member "exclude this candidate from the group before confirming" checkbox mechanic). Not Quite's per-member actions already cover the underlying need at finer granularity, so this was judged unnecessary rather than merely deferred (`docs/detection/phase-8-findings.md`; `docs/detection/feature-001-group-bulk-actions.md`).

### 4.9 An open, explicitly-surfaced policy question

Should a Rename whose replacement text equals the candidate's own original text (the common Flatten Group outcome) count as a verification *failure*? The current, conservative answer is **yes** — flagged as a blocker, fully explained in the verification report — but this is explicitly framed in the source as a **product policy call Andrew has not yet made unilaterally resolved**, not a settled engineering fact: *"a PII tool erring toward 'flag for review' is safer than silently treating a no-op rename as success"* is the current default, open to revision (`docs/detection/feature-001-group-bulk-actions.md`). **[DESIGNED — open question]**, included here because a specification should record unresolved product decisions, not just resolved ones.

### 4.10 Visual treatment of Not Quite

Not Quite's UI is functional but plain — undifferentiated `<div>`/`<button>` rows, with no styling to distinguish it from the surrounding group list the way Python's colored, bordered `.not-quite-panel` did (`review-workspace-reconstruction.md:418-421`). Explicitly named as Milestone 4 ("Production Polish") scope, not an oversight of any completed milestone. **[DESIGNED, NOT IMPLEMENTED]**

---

## 5. Item Review

### 5.1 Inline editing

Rename and Redact-with-override both require reviewer-entered replacement text. The current implementation uses `window.prompt()` for this text entry (`docs/detection/phase-10-findings.md`, "The thin UI" section) — a deliberate, acknowledged simplicity trade-off of the thin-UI build, explicitly **not** final visual/interaction polish. **[BUILT]**, with a richer inline editor (matching the Redaction Rules panel's own live-input pattern, or Python's inline editor with arrow-key field movement / Accept / Cancel) named as future work. **[DESIGNED, NOT IMPLEMENTED]**: Python's inline editor supported `←→↑↓` field movement, `A` to accept, `Esc` to cancel (`review-workspace-reconstruction.md:158-160`) — this richer model is documented Python behavior with no confirmed TypeScript equivalent yet.

### 5.2 Review actions

Keep, Rename, Redact, Ignore — the complete, single-level decision vocabulary, available identically whether triggered by mouse (row buttons), keyboard (`k`/`n`/`r`/`i`), or bulk action (checkbox selection + toolbar button). **[BUILT]**

Decisions are a **single current value per candidate, never an accumulating log.** There is no precedence table anywhere in the system — whichever decision was dispatched most recently for a candidate simply *is* its current decision (`docs/detection/phase-8-findings.md`, "What Python's oracle actually does," confirmed as the ported behavior). This is the entire mechanism behind "Rename supersedes Keep": there is no special rule, just last-write-wins. **[BUILT]**

The one deliberate exception: `applyDecisionReuse` (imported decisions) never overwrites a candidate that already carries **any** decision, reviewer- or import-sourced — see §9.4. **[BUILT]**

### 5.3 Replacement editing

Covered by §5.1 and §8. A reviewer's own explicit replacement — from Rename, or a typed-in Redact override — always takes precedence over the configured `ReplacementRuleEngine` strategy (`src/engines/ReplacementRuleEngine.ts`). **[BUILT]**

### 5.4 Occurrence navigation

Within a candidate's detail panel, occurrences are grouped and browsable via the collapsible Occurrence Browser (§7.2), not individually navigable one-at-a-time via keyboard the way items themselves are. `enterItem` drills into a candidate's first occurrence at the domain level (`Commands.ts`), but no confirmed UI wiring surfaces occurrence-by-occurrence keyboard traversal today. **[BUILT]** at the domain/command level; **[DESIGNED, NOT IMPLEMENTED]** as a discoverable UI affordance beyond the raw command.

### 5.5 Explanation panel

Covered fully in §3.2 and §7. **[BUILT]**

### 5.6 Filtering

A single free-text search box, matching case-insensitively against every field Andrew explicitly named: candidate text, replacement text, category, review state, likelihood, ambiguity, and entity type — updating on every keystroke (`src/ui/itemCheckQuery.ts`; `docs/detection/milestone-2-review-at-scale.md`). **[BUILT]**

A real, load-bearing UX defect was found and fixed while building this: because the whole DOM is rebuilt from scratch on every render, a naive keystroke-triggered re-render destroyed and recreated the search `<input>`, losing focus and cursor position after the very first character typed. Fixed by restoring both from a small piece of pending state captured just before each re-render (`docs/detection/milestone-2-review-at-scale.md`). **[BUILT — fixed]**

Eight combinable filter presets, ANDed when more than one is active: Unreviewed only, High confidence, Ambiguous, People, Organizations, Ignored, Renamed, Redacted (`src/ui/itemCheckQuery.ts`). **[BUILT]**

**"Organizations" is a documented honest approximation, not a literal type filter** — `DetectionEngine` never assigns a `detectedType` of `"organization"` (no NER path exists in this pipeline; it faithfully ports Python's own regex-based detectors, which also lack this). A literal filter would silently match zero candidates forever. Instead it matches candidates carrying organization-signaling evidence categories (department-organization, institution-acronym, institution-term, organization-suffix) — "the closest honest match to Andrew's request given what this pipeline actually detects," documented rather than built as a dead control (`docs/detection/milestone-2-review-at-scale.md`). **[BUILT]**

One informative, non-bug finding disclosed in the source and worth preserving in a specification: searching the literal word "person" matches all candidates, including non-person-typed ones, because `CandidateQualityEngine` tags every non-person candidate with a `deterministic-non-person-type` evidence category, and "person" is a literal substring of "non-person." Confirmed as a correct (if occasionally surprising) consequence of substring matching against category content, since Andrew's own instruction explicitly lists "category" as a search field — left as-is, not treated as a defect (`docs/detection/milestone-2-review-at-scale.md`).

### 5.7 Sorting

Five named orders, each with a natural opposite direction, available in List view: confidence, occurrence count, alphabetical, review state, entity type (`src/ui/itemCheckQuery.ts`). **[BUILT]**

### 5.8 Bulk actions

Checkboxes on every Item Check row; a selection toolbar (count, Select all visible, Clear selection); Keep/Rename/Redact/Ignore-selected buttons — all via a new `review.bulkApplyDecision` command that generalizes Feature 001's group-level bulk-action pattern to an arbitrary, reviewer-selected candidate-ID list (`docs/detection/milestone-2-review-at-scale.md`). **[BUILT]**

**Bulk actions DO overwrite existing decisions** (unlike decision-reuse import) — an explicit design decision, framed as *"a direct, deliberate reviewer action, not a passive import"* (same source). No new undo mechanism was built or is needed: a bulk-applied decision is exactly as reversible as a direct one, since both are simply a plain, freely re-decidable `CandidateDecision` object. `history.undo`/`redo` remain honestly rejected by `CommandDispatcher` everywhere in the system — never faked (`docs/detection/phase-10-findings.md`, reconfirmed at every later milestone). **[BUILT]**

### 5.9 Cross-stage quick-jump navigation

- **`]`** — Next undecided, scoped to the currently visible (filtered/sorted) list.
- **`[`** — Previous decision (a new `previousDecided` traversal direction, the deliberate mirror of the existing `nextUnresolved`/`previousUnresolved` pair), same scope.
- **Next ambiguity** — jumps to Ambiguity Check's own next-unresolved item, from anywhere.
- **Jump to category** — a dropdown switching directly to Item Check's By Category view, pre-filtered.
- **`/`** — focuses the search box from anywhere in Item Check.

(`docs/detection/milestone-2-review-at-scale.md`; `app.ts`.) **[BUILT]**

A deliberate architectural decision underlies why `]`/`[` are **UI-composed** (via `goToAdjacentInVisibleList()`), not a direct dispatch of `FocusNavigator`'s own domain-level traversal: `FocusNavigator`'s traversal list is the stage's *full* candidate list, with no notion of Milestone 2's UI-only search/filter narrowing — correctly so, since Phase 9 already established that `FocusNavigator` must never depend on rendered/UI-only state. Jumping within the full list while a filter is active would land a reviewer on an item they cannot currently see, contradicting Andrew's own stated success criterion: *"navigation should require minimal scrolling... a reviewer should never feel lost."* By contrast, "Next ambiguity" dispatches the domain's own `moveItem(nextUnresolved)` directly, because Ambiguity Check has no Milestone 2 filter layer of its own (`docs/detection/milestone-2-review-at-scale.md`). **[BUILT]**

---

## 6. Evidence Presentation

### 6.1 ExplanationEngine

Architecturally a **shared, stateless, synchronous service** — `explain(context, view)` — not a pipeline stage, called on demand: once per candidate when a reviewer opens a detail panel (never speculatively pre-computed for every candidate, since a reviewer typically expands well under 10% of a document's candidates), and in batch by `AuditExporter` when generating the audit narrative (`review-workspace-reconstruction.md:204-217`). The Architecture Review Board explicitly flagged, before implementation, that `ExplanationEngine` was drawn inconsistently as a pipeline stage in one section of the v0.1 architecture doc but absent from its own primary pipeline diagram — recommending it be modeled as a shared utility consumed by exactly two callers, which is precisely how it was ultimately built (`DocScrub-Web_Architecture_Review_Report.docx`, §4.1). **[BUILT]**

### 6.2 Three-tier explanation model

**Standard / Expert / Audit** views are not Python UI ornamentation — they are the documented purpose of `ExplanationEngine`, directly traceable to a v0.2 architecture principle quoted verbatim: *"Standard View explanations, Advanced/Expert View evidence breakdowns, audit-oriented summaries"* (`review-workspace-reconstruction.md:198-202`). This is explicitly named as an item that must **not** be collapsed to a single view for simplicity (`review-workspace-reconstruction.md:594-596`). **[BUILT]**: Standard and Expert are both wired into `CandidateDetailPanel`; the **Audit view exists in `ExplanationEngine` but is confirmed NOT YET consumed by `AuditExporter`** — flagged explicitly, more than once, across multiple milestone reports as an unaddressed, named follow-up, not a silent gap (`docs/detection/phase-11-findings.md`; `docs/detection/milestone-1-review-workspace-phase-1-2.md`). **[DESIGNED, NOT IMPLEMENTED]** for the audit-consumption half specifically.

### 6.3 Expert View

Collapsible, closed by default. A three-column grid: likelihood/recommendation/disposition/type/detector facts; positive/negative/neutral evidence with signed weights and full expert-tier prose; diagnostic categories; the raw scoring explanation string (`app.ts:681-769`). **[BUILT]**

A real bug was found and fixed during Milestone 1 browser validation here: diagnostic category labels rendered raw snake_case identifiers (`Product_system_name`) instead of formatted labels (`Product / system name`), because `CandidateQualityAssessment.reasons`/`filterRules` is a separate, never-kebab-cased representation of the same rule vocabulary `Evidence.category` already normalizes. Fixed by normalizing inside a single labeling function (`categoryRuleLabel()`), rather than fixing the one call site that happened to surface it (`docs/detection/milestone-1-review-workspace-phase-1-2.md`). This reveals a general requirement worth stating explicitly: **every representation of the same underlying vocabulary must be normalized to one label source before being shown to a reviewer together.** **[BUILT — fixed]**

### 6.4 Occurrence Browser

Collapsed by default, grouped into labeled blocks by occurrence kind (e.g., "In a table," "Near a signature block") via `OccurrenceClassifier`'s reviewer-ready enrichment layer, which has no Python equivalent — an additive TypeScript-side improvement, not a port (`docs/detection/phase-7-findings.md`). **[BUILT]**

### 6.5 Confidence explanation

Confidence is presented three ways simultaneously, at increasing depth: a color-coded percentage badge (row + panel header), a plain-English confidence-graded sentence (Standard view), and signed per-evidence-item weights (Expert view) (`app.ts`). **[BUILT]**

### 6.6 Context snippets

Up to 5 representative context strings shown by default in the detail panel with no additional click; the full occurrence list (potentially more than 5) lives behind the collapsed Occurrence Browser (`app.ts:650-661`). **[BUILT]**

### 6.7 Audit-facing evidence presentation

`AuditExporter` deliberately consumes `ReviewSession`, candidate/evidence data, processing metadata, and `VerificationReport` — **never `DocumentRebuilder` internals** — closing a real coupling defect the v0.1 architecture would otherwise have created (the Architecture Review Board flagged this directly: *"AuditExporter... ends up depending on another output module's internals, which cuts against [the architecture's] own claim that rebuilding and audit export 'should remain separate modules'"* — `DocScrub-Web_Architecture_Review_Report.docx`, §4.4). **[BUILT]**

A deliberate, documented improvement over Python: raw candidate text and the ±70-character context window Python's real CSV/QA-metrics exporters embed on every row are **excluded** from every TypeScript audit artifact — confirmed directly by checking that distinctive fixture values are absent from all four produced files. This is framed explicitly as a genuine improvement, not a gap to close (`docs/detection/phase-11-findings.md`; `review-workspace-reconstruction.md:290-296, 610-612`). **[BUILT]**

---

## 7. Workspace Interaction Model

### 7.1 Two independent navigation axes

Modeled explicitly in `FocusState.ts`/`FocusNavigator`/`keymap.ts`, verified against 96+ checks with zero regressions since Phase 9 (`review-workspace-reconstruction.md:126-135`):

- **Stage axis** — Ambiguity Check → Group Check → Item Check → QA → Output, freely jumpable in either direction, never gated on completion.
- **Item axis** — next/previous/first/last within the current stage's item list, **clamped (not wrapping)** at both boundaries, always resolved against stable domain IDs, never array position or rendered DOM order.

**[BUILT]**

A third, nested axis exists specifically while a Not Quite panel is open: the member cursor (§4.3). **[BUILT]**

### 7.2 2D grid movement — a deliberate domain-layer boundary

Python's Results grid supports free 2D arrow movement (Left/Right/Up/Down remapped to visual columns). This was **deliberately not ported into `FocusNavigator`** — the domain layer must never query rendered viewport width, which a 2D remap inherently requires. `moveItem` remains strictly one-dimensional, matching Python's own tested oracle logic underneath the remap. A future UI layer *may* add its own 2D visual translation on top of the 1D domain primitive, but this has not been built (`review-workspace-reconstruction.md:137-141, 433-434, 613-615`; reconfirmed at Gate E, `docs/detection/phase-12-findings.md`). **[DESIGNED, NOT IMPLEMENTED]** — and explicitly, permanently a UI-layer-only concern if it is ever built; it will never move into the domain layer.

### 7.3 Complete keyboard shortcut inventory

| Key(s) | Context | Action | Status |
|---|---|---|---|
| ↑↓←→ / Home / End | Ambiguity Check, Item Check | Move active item (clamped, not wrapping) | **[BUILT]** |
| PageUp / PageDown | Item Check (Python: `page_size=8`) | Page-jump within item list | **[DESIGNED, NOT IMPLEMENTED]** — see note below |
| `k` / `n` / `r` / `i` | Ambiguity Check, Item Check | Keep / Rename / Redact / Ignore | **[BUILT]** |
| Enter | Ambiguity Check, Item Check | Drill into first occurrence | **[BUILT]** |
| Escape | Ambiguity Check, Item Check | Close occurrence drill-down | **[BUILT]** |
| `d` / `.` / Space | Ambiguity Check, Item Check (candidate focused) | Toggle Candidate Detail Panel | **[BUILT]**, Milestone 1 |
| `/` | Item Check, anywhere | Focus search box | **[BUILT]**, Milestone 2 |
| `]` | Item Check (visible/filtered list) | Next undecided | **[BUILT]**, Milestone 2 |
| `[` | Item Check (visible/filtered list) | Previous decision | **[BUILT]**, Milestone 2 |
| ↑↓←→ / Home / End | Group Check (no panel open) | Move active group | **[BUILT]** |
| `q` | Group Check | Enter Not Quite | **[BUILT]** |
| `k` | Group Check | Keep as-is | **[BUILT]**, Feature 001 |
| `n` | Group Check | Rename | **[BUILT]**, Feature 001 |
| `r` | Group Check | Redact | **[BUILT]**, v9 terminology revision (fills the slot reserved since Feature 001) |
| `i` | Group Check | Ignore | **[BUILT]**, v9 terminology revision (fills the slot reserved since Feature 001) |
| `x` | Group Check | *(removed — Reject Group no longer exists)* | — |
| Escape | Not Quite panel open | Exit Not Quite | **[BUILT]** |
| ↑ / ↓ | Not Quite panel open | Move member cursor | **[BUILT]** |
| `k` | Not Quite, member active | Apply Keep directly | **[BUILT]** |
| `i` | Not Quite, member active | Apply Ignore directly | **[BUILT]** |
| `n` / `r` | Not Quite, member active | Open draft editor (needs typed text) | **[BUILT]** |
| Tab / Shift+Tab | Global | Next/previous focusable element | **[BUILT]** (browser-native, not app-specific) |

**Note on PageUp/PageDown:** `docs/detection/phase-9-findings.md` states this was "ported faithfully" from Python's `review_queue.py move_active_key` (`page_size=8`), but a direct check of `Commands.ts`'s `ItemMoveDirection` union and `keymap.ts` finds no page-jump variant bound to any key. This is a genuine discrepancy between an existing document's claim and the current implementation — recorded here as a finding, not silently resolved either way. **[DESIGNED, NOT IMPLEMENTED]** is the honest status: the underlying scan logic exists in spirit inside `moveWithinItems`, but the page-size jump itself is not currently reachable.

**Deliberately not ported, confirmed by keymap.ts's own doc comment:** the Python "c" per-member inline-context toggle, and the ambiguity-panel's "d"/"." context toggle in its original Python meaning — both were pure visual/presentation toggles with zero `ReviewEngine`/`FocusNavigator` effect. (Note: "d"/"." was later repurposed in Milestone 1 as the Candidate Detail Panel toggle — a different, TypeScript-native meaning, not a revival of the Python behavior.)

**Confirmed but not built, found in the Python oracle with no TypeScript equivalent and no prior deferral note** (i.e., a genuine, previously-unflagged gap, not a documented deferral): rich Tab-based focus traversal across group cards/action buttons/inline editors; Shift+Arrow category navigation; Shift+`+`/`-` to expand/collapse all detail panels at once; and a live "accept quality result changes" reconciliation workflow (`qualityPendingChangeKeys`, a y/n confirm dialog when a candidate's score changes mid-review) — this last one has no analog because the current pipeline runs once per document load rather than live-rescoring, so it may not even be applicable to this architecture. **[SPECULATIVE]** whether any of these should be built at all; included here because completeness requires surfacing what exists in the oracle and was never explicitly addressed either way, not because they're recommended.

### 7.4 Context menus

No source — Python, architecture documents, or any milestone report — describes a right-click/context-menu interaction anywhere in this application. **Confirmed absent, not a gap**; this project's entire interaction model is built on direct row-level buttons, keyboard shortcuts, and the Command Bar instead.

### 7.5 Selection model

Item Check supports **multi-select via checkboxes** for bulk operations (§5.8); no other stage has a selection concept beyond the single "focused item" the navigation axes track. **[BUILT]**

### 7.6 Focus behavior across re-renders

A specific, confirmed-intentional property: after every full re-render, `document.activeElement` genuinely reverts to `<body>`. Real browser validation (Phase 10.1) explicitly confirmed this is *"what makes the keyboard-shortcut affordance actually usable between actions in practice, not a defect"* (`docs/detection/phase-10.1-findings.md`). **[BUILT]**, and important context for §7.7.

### 7.7 Discoverability: the Command Bar

A context-sensitive bar rendering only the 3–6 commands valid for wherever focus currently is — explicitly named as *"a real, deliberate, already-designed answer to 'how does a reviewer discover 15+ shortcuts without memorizing all of them up front' — not a nice-to-have"* (`review-workspace-reconstruction.md:165-170`). Originally scoped to Group Check only in the Python oracle; **generalized to render on every stage** in the current implementation, per Andrew's own explicit "should always expose" instruction (`docs/detection/milestone-2-review-at-scale.md`). **[BUILT]**

### 7.8 Search-input focus preservation

A general finding worth stating as an interaction-model principle, not just a bug fix: because this application fully rebuilds its DOM tree on every state change, **any element the DOM was tracking locally (input focus/cursor position, `<details>` open/closed state) is silently reset on every render unless explicitly preserved.** This has been hit twice, independently, with the same root cause: the Item Check search box losing focus/cursor (Milestone 2, fixed via `searchInputFocusPending`), and every `<details>` panel in the app silently collapsing on its own interaction (Milestone 3, fixed via a reusable `detailsEl()` helper — see §11.4). **[BUILT — fixed, both instances]**, and explicitly flagged as a pattern to watch for in any future locally-stateful DOM element.

---

## 8. Replacement Management

### 8.1 ReplacementRuleEngine

A pure, stateless, deterministic engine: `computeReplacements(candidates, decisions, config) → Map<candidateId, replacementText>` (`src/engines/ReplacementRuleEngine.ts`). **[BUILT]**, Milestone 3.

Before this existed, redaction fell back to hardcoded generic placeholders (`"[REDACTED PERSON]"`-style) with zero reviewer control — confirmed live during Feature 002 browser testing, where a fallback-placeholder warning actually fired (`review-workspace-reconstruction.md:339-346`). The rationale for building this at all is stated directly and is worth preserving verbatim: *"An attorney reviewing a deposition transcript needs consistent, distinguishable placeholders ('WITNESS,' sequential numbering to preserve who-said-what without revealing identity) — this is not a cosmetic preference, it's whether the redacted document remains usable as a legal work product"* (same source).

### 8.2 Placeholder strategies

Andrew originally named **four** strategies: generic, sequential, category-specific, reviewer-defined. These were implemented as **three**: `generic` (fixed placeholder text per type), `sequential` (per-type independent counters, e.g. `[PERSON 001]`, `[PERSON 002]`), and `custom` (a reviewer-authored label with an optional `{n}` token for per-type sequential numbering). `custom` subsumes both "category-specific" (a fixed custom label) and "reviewer-defined" (the same mechanism, reviewer-authored) — recorded explicitly as *"one config shape doing the work of two named strategies, not a dropped capability"* (`docs/detection/milestone-3-reviewer-productivity.md`). **[BUILT]**, with the consolidation documented as a deliberate judgment call, not a silent scope reduction.

Sequential numbering was verified to reach the **actual rebuilt .docx**, not just the engine's in-memory map, via a real `python-docx` text extraction against a real fixture (`docs/detection/milestone-3-reviewer-productivity.md`, Part 5 of the Milestone 3 verification suite; independently re-confirmed live in a real browser during this same milestone's validation pass).

### 8.3 Precedence

**A reviewer's own explicit replacement text always wins** — from Rename, or a typed-in Redact override. The configured `ReplacementRuleEngine` strategy only applies to Redact/Rename decisions with no reviewer-supplied text of their own (`src/engines/ReplacementRuleEngine.ts`). Keep/Ignore/undecided candidates are never touched by any replacement logic. **[BUILT]**

### 8.4 Live preview

The Output stage's "Redaction rules" panel recomputes and displays a live preview of resolved replacement text as the reviewer changes any per-type strategy — capped at 5 example lines shown, by deliberate design ("favor clarity over quantity," matching the same instruction that shaped the statistics bar, §10) rather than listing every candidate (`app.ts:1330-1348`). **[BUILT]**

A real, load-bearing usability defect was found live during this exact interaction and fixed the same milestone: changing a strategy dropdown immediately collapsed the very panel the reviewer was looking at, because none of the app's `<details>` elements persisted open/closed state across a full re-render — previously latent, but guaranteed to trigger once Milestone 3's own background-autosave re-renders became routine. Fixed with a reusable `detailsEl()` helper applied to every `<details>` element in the app, not just the one panel that happened to surface the bug (`docs/detection/milestone-3-reviewer-productivity.md`; full detail in §11.4). **[BUILT — fixed]**

### 8.5 Inline replacement editing

Covered by §5.1/§5.3 — a reviewer edits replacement text via Rename/Redact-override, using `window.prompt()` today. A richer inline editing surface directly on the Redaction Rules panel (beyond the per-type strategy select + custom-template text input already there) is **[BUILT]** for the *rule-level* template; per-candidate inline replacement editing inside Item Check itself is **[DESIGNED, NOT IMPLEMENTED]** as anything beyond the existing prompt-based Rename flow.

### 8.6 Propagation behavior

"Apply to existing decisions" — the live preview recomputes from the *current* decision set on every configuration change, so a strategy change is reflected for every already-decided candidate of that type without requiring the reviewer to re-decide anything (`docs/detection/milestone-3-reviewer-productivity.md`; confirmed against `review-workspace-reconstruction.md`'s original Phase B scope, which named exactly this behavior). **[BUILT]**

### 8.7 Validation

The custom-template input accepts an optional `{n}` token; no source describes validation beyond this (e.g., rejecting malformed templates, warning on empty custom text). **[SPECULATIVE]** whether any additional validation is intended — nothing in any source suggests it was ever explicitly considered.

### 8.8 Python's organization default — a confirmed, non-carried-forward difference

Python's `replacement_rules.py` includes a distinct default rule for `"organization"` (`[REDACTED ORGANIZATION]`). This has no TypeScript counterpart, for a confirmed structural reason, not an oversight: `DetectionEngine` never produces an `"organization"` `detectedType` at all (no NER path exists in either the Python or TypeScript pipeline), documented directly in `itemCheckQuery.ts`'s own comment (§5.6's "Organizations" filter discussion applies the identical reasoning here). **Confirmed absent by design, not a gap.**

---

## 9. Review State

### 9.1 Save/resume — an explicit, reasoned departure from Python's mechanism

This is the one area the reconstruction document explicitly says should **not** copy Python's mechanism, because Python's mechanism only worked because Python has a server: it auto-persists to a single `.local_web_state/review_state.json` file, keyed to nothing but "the one currently uploaded file" — no session picker, no explicit save action, reloading silently any time the same file is rescanned (`review-workspace-reconstruction.md:298-327`). *"A browser-local, single-tab, no-backend application has no equivalent place to put that file invisibly, and a tab can be closed without any server-side process to remember it."* Dropping this mechanism is framed explicitly as *"a forced, correct adaptation to a backend-less architecture, not a regression"* (`review-workspace-reconstruction.md:606-609`).

### 9.2 LocalSessionRepository / IndexedDbSessionRepository

The intended replacement, and the one item the Architecture Review Board flagged with an existing **Required-priority ADR (ADR-010)** behind it as *"the single largest 'this could lose a reviewer's work' risk in the whole Workspace"* (`review-workspace-reconstruction.md:529-533`). **[BUILT]**, Milestone 3.

Autosave fires after **every document load and every reviewer action** (via a serialized `autosaveQueue: Promise<void>`, preventing overlapping writes from racing), with no reviewer action required (`docs/detection/milestone-3-reviewer-productivity.md`). `SessionRecord` deliberately reuses `WorkspaceSaveFile` as-is for the actual review state, per Andrew's own quoted instruction: *"preserve the current review state rather than reconstructing it indirectly."* Adds session-level metadata: `documentId`, `fileName`, `savedAt`, `lastOpenedAt`, `completionPercent`. Stored in IndexedDB, capped at the 10 most recently opened documents via LRU eviction. **[BUILT]**

**Real browser validation confirmed the one thing that cannot be proven in a Node-based test suite:** a full navigation reload (not an in-app state reset) correctly preserved a decision made moments earlier, with Recent Documents immediately showing the correct completion percentage and Resume restoring the exact decision. Explicitly called out: *"This is the one thing Milestone 3's own success criteria call out as impossible to prove without a real browser, and it passed."* **[BUILT — verified live]**

### 9.3 Resume does not require re-uploading the original file — with one deliberate exception

A resumed session reconstructs detection, quality, grouping, and full review state from IndexedDB alone (the raw file bytes are persisted as part of the session record) — no re-upload needed to *continue reviewing*. The "+ original docx" file input in the header exists only because **Generate Output** needs the literal original OOXML package to splice replacement text into; re-parsing that package from stored bytes on every resume would be wasteful when the reviewer is only continuing review, not about to export. This is documented as a deliberate scope boundary, confirmed correct via live browser testing (a resumed session correctly showed all real candidates from storage with no re-upload needed for reviewing) (`docs/detection/milestone-3-reviewer-productivity.md`). **[BUILT]**

### 9.4 Imported decisions (Decision Reuse — "Review once, apply everywhere")

A reviewer may import a previously exported `decisions.json` — the identical file "Download Decisions (JSON)" already produces, no new file format — while reviewing a **new version** of the same document. Previously-decided entities are recognized and their decisions reused automatically wherever confidence is deterministically high, via three ordered, deterministic matching tiers, explicitly **not** ML/embeddings/undocumented heuristics (`docs/detection/feature-002-decision-reuse.md`):

- **Tier 1 — exact key match (confidence 100).** The candidate's own `candidateId` is byte-identical to a previously-decided one.
- **Tier 2 — grouped-alias match (confidence 90).** A candidate with no Tier-1 match of its own, but which *this document's own* `EntityResolutionEngine` grouping places in the same proposed group as a Tier-1-matched candidate, reuses the sibling's decision. Guards against ambiguity: if Tier-1-matched siblings in a group disagree, no match is made for the rest of the group.
- **Tier 3 — similarity-threshold match** (confidence = similarity ratio × 100), using the same Ratcliff/Obershelp `sequenceRatio()` `EntityResolutionEngine` already uses. **Threshold: 0.90**, deliberately conservative — well above the ~0.8 a typical "did you mean" UX would use — because *"misapplying a Redact/Keep decision to the wrong real-world entity is a materially worse failure than an unhelpful suggestion."* **Margin: 0.05** — the best match must beat the runner-up by this much among same-detected-type candidates, or the match is dropped as ambiguous (guards against near-miss ties like "Jon Reyes" vs. "John Reyes"). Never fuzzy-compares across detected types even on coincidental text match.

**[BUILT]**

**The one, permanent exception to "every command overwrites":** `applyDecisionReuse` never overwrites a candidate carrying any existing decision — reviewer- or import-sourced. Quoted rationale, attributed directly to Andrew: *"the reviewer should never lose control."* Import fills gaps in undecided candidates only; it never contests existing state, even state an earlier import itself produced. **[BUILT]**

**A real UX defect was found and fixed here during browser validation:** a blocking `window.alert()` fired on successful import — the first alert in the codebase to fire on *success* rather than failure, breaking an established app-wide convention (*"alert on failure only, never on success"*) that every other confirmation in this app follows. Fixed by replacing it with a non-modal inline summary banner; the failure-path alert was left unchanged (`docs/detection/feature-002-decision-reuse.md`). **[BUILT — fixed]**

### 9.5 Modification tracking

Covered fully in §3.3 and §9.4: a candidate's decision carries `source?: "reviewer" | "imported"` and, when imported, `importEvidence` (tier, matched prior candidate ID, confidence, human-readable description). An override fully replaces the decision object, so *whether a decision was ever imported at some point* is answered by walking the append-only event log (`wasEverImported()`), not by inspecting the current snapshot alone — because the snapshot alone cannot distinguish "always a reviewer decision" from "was imported, then overridden" (`src/ui/decisionProvenance.ts`; `src/io/AuditExporter.ts`). **[BUILT]**

### 9.6 Review statistics

A single-line stats bar, visible on **every** stage: completion percentage; Keep/Rename/Redact/Ignore distribution; ambiguity count; estimated time remaining, extrapolated from the reviewer's own observed average pace on already-decided items — explicitly, deliberately **not** an AI/ML estimate: *"no AI here at all, only a rate computed from the reviewer's own observed pace,"* tied directly to this project's "keep AI explainable rather than magical" principle (`app.ts`; `docs/detection/milestone-3-reviewer-productivity.md`). Entity-type counts are tucked behind a collapsed "By type" `<details>` rather than always shown, per Andrew's own instruction to *"favor clarity over quantity."* **[BUILT]**

Category Check (§2.4) additionally exposes, per Review State (Total/To Review/Unlikely/Resolved), a drill-down by evidence category with occurrence counts. **[BUILT]**

### 9.7 Completion

Completion is **derived**, never a stored, independently-trackable flag: `resolvedStatusOf()` computes resolved status fresh from either a direct `CandidateDecision` or occurrence coverage by resolved groups; `readiness.exportEnabled`/`readiness.reviewComplete` are likewise computed fresh on every state read, comparing captured timestamps rather than tracking a settable/clearable boolean. Rationale, stated directly: a settable flag *"requires every future call site that changes ReviewSession to remember to clear it... exactly the kind of thing that quietly rots"* (`docs/detection/phase-10-findings.md`). This has a direct reviewer-facing consequence: the Output stage's verification silently invalidates after any further edit, with no separate flag or button to remember to clear. **[BUILT]**

### 9.8 Never lose reviewer work — the storage-quota question

The v0.1 Architecture Review Board flagged a specific, still partially open risk: IndexedDB/OPFS storage quota behavior is a named risk, but no fallback UX was specified for hitting the quota mid-session — for a tool whose core promise is never losing reviewer progress, silently failing to persist because of a quota ceiling would be a severe, principle-violating failure mode, deserving *"an explicit UX contract (e.g., a blocking warning well before quota is reached, plus a forced export path), not just an engineering risk bullet"* (`DocScrub-Web_Architecture_Review_Report.docx`, §4.10). **[BUILT, partially]**: `getQuotaStatus()` exists and the persistence-status line does surface a warn/error state (`src/io/IndexedDbSessionRepository.ts`; `app.ts`'s persistence status line), but no source confirms a forced-export path or a proactive (pre-failure) warning threshold has been implemented — this remains a partially resolved risk, not a closed one. **[DESIGNED, PARTIALLY IMPLEMENTED]**

A separate, real startup-resilience defect was found and fixed in Milestone 3: if IndexedDB is ever unavailable at all (private browsing, blocked storage, a transient lock), the very first render of the entire application was gated behind an unhandled promise rejection, which would leave a reviewer looking at a **permanently blank page**, unable even to load a new document. Fixed to degrade gracefully — an empty Recent Documents list — rather than blocking the app's first paint (`docs/detection/milestone-3-reviewer-productivity.md`). **[BUILT — fixed]**

---

## 10. Reviewer Ergonomics

### 10.1 Keyboard-first workflow

The complete shortcut vocabulary in §7.3 is designed to make full review possible without ever touching the mouse, for every core decision action; keyboard shortcuts are context-gated by `FocusState`, never global and never ambiguous about what they'll do (`keymap.ts`). **[BUILT]**

### 10.2 Minimizing scrolling / never feeling lost

Explicitly named as Andrew's own stated success criterion for cross-stage navigation (§5.9), directly driving the decision to keep quick-jump navigation scoped to the currently visible/filtered list rather than the full underlying stage list (`docs/detection/milestone-2-review-at-scale.md`). **[BUILT]**

### 10.3 Preserving focus

Covered in §7.6–7.8. Both the intentional post-render focus reset to `<body>` (a designed property, confirmed correct) and the unintentional-but-fixed search-input/details-panel focus losses (real defects, fixed) are part of the same underlying ergonomic commitment: **a reviewer's place in the workspace — literal cursor position, or figurative "where was I" — must never be silently lost by the act of the UI re-rendering.** **[BUILT]**

### 10.4 Progressive disclosure

Recurs throughout: Expert View and the Occurrence Browser are collapsed by default (§3.2); the "By type" statistics breakdown is collapsed by default (§9.6); Redaction Rules starts collapsed (§8.4); Category Check is a toggled sub-mode of Item Check, not always-visible (§2.4). An advanced/basic toggle specifically for the Redaction Rules panel's own controls (pattern/scope/overwrite-manual settings) was named in the original gap analysis as a "nice-to-have" and has not been confirmed built (`review-workspace-reconstruction.md:435-436`). **[DESIGNED, NOT IMPLEMENTED]** for that specific toggle; the broader progressive-disclosure pattern itself is **[BUILT]** and pervasive.

### 10.5 Reducing cognitive load

The explicit, repeated instruction behind Milestone 3's statistics design — *"favor clarity over quantity"* — is treated in this project as a general ergonomic principle, not a one-off instruction for one panel; it's cited as the standard the `<details>`-collapsing bug (§11.4) was found to violate, and as the reasoning behind the 5-line cap on the Redaction Rules live preview (§8.4). **[BUILT]** as an applied, recurring principle.

### 10.6 Avoiding unnecessary dialogs

A clear, consistently-applied convention across every milestone examined: **alert on failure only, never on success** — matching Python's own toast-on-success/status-on-failure split (`review-workspace-reconstruction.md:597-599`). Confirmed applied to Decision Reuse's import flow (§9.4, fixed after violating it once) and Output generation's failure path (still a blocking `window.alert()`, but consistent with this convention rather than a regression from it — flagged as worth extra care given output failure is the highest-stakes moment for a first external reviewer, `review-workspace-reconstruction.md:367-372`). Also explicit: no preview/confirm modal gates Decision Reuse import — reused decisions appear immediately, *"as if a very fast reviewer had just made them,"* consistent with *"this application's existing preference for immediate, reversible actions over modal confirmation dialogs"* (`docs/detection/feature-002-decision-reuse.md`). **[BUILT]**

A non-blocking corner toast for success acknowledgements more broadly (beyond the one instance already built for imports) — matching the Python UI's `#actionToast` component — is named in the gap analysis as a nice-to-have, not yet confirmed built for ordinary Keep/Rename/Redact/Ignore actions (`review-workspace-reconstruction.md:428-432`). **[DESIGNED, NOT IMPLEMENTED]**

---

## 11. Accessibility

No source in this project — Python UI, ARB review, v0.2 architecture document (as quoted secondhand), or any milestone/feature findings document — specifies WCAG conformance targets, ARIA roles, screen-reader behavior, color-contrast requirements, or keyboard-only completeness testing as a *distinct, already-addressed* concern. This is a genuine, confirmed gap in current documentation and implementation, not an oversight of this specification. Every milestone report that touches the subject places it explicitly in **Milestone 4 ("Production Polish")** scope, alongside typography, spacing, color refinement, iconography, empty/loading states, minimal animation, responsive behavior, and onboarding (`docs/detection/milestone-2-review-at-scale.md`; `docs/detection/milestone-3-reviewer-productivity.md`, "Remaining work": *"No accessibility pass has been done on the new controls... deferred to Milestone 4 by design, not an oversight of this milestone"*). **[DESIGNED]** only in the sense that a Milestone 4 slot exists and is named; no specific accessibility requirement has been committed to yet beyond that placeholder.

The one accessibility-adjacent property that *is* confirmed and real, incidentally, is the keyboard-completeness of the core review vocabulary itself (§7.3, §10.1) — every primary review decision is reachable without a mouse. This is a byproduct of the keyboard-first ergonomic design, not a result of an accessibility audit.

---

## 12. Design Principles

These are the principles that recur, independently, across multiple unrelated sources — architecture documents, ARB findings, milestone reports, and code-level doc comments — treated in this project as the load-bearing philosophy underneath every specific feature decision above.

1. **Completion Beats Movement (the "Sock Principle").** *"Moving work is not progress; completion is progress"* — v0.2 principle 4.4, the direct grounding for simultaneous, non-wizard stage visibility (§1.1) and for treating collapsing a panel as a visibility choice, never a workflow gate.

2. **Human reviewer remains authoritative; nothing automatic ever overrides a human decision.** Decision Reuse's absolute never-overwrite rule (§9.4), quoted directly: *"the reviewer should never lose control."* Overrides of any kind — including overrides of an import — are always possible and always simple: a fresh decision object replaces the old one, with no special-casing.

3. **Explain every recommendation; never leave a state unexplained.** `ExplanationEngine`'s three-tier model (§6.2); the OutputVerifier silent-failure bug explicitly framed as *"exactly the same class of gap [the] explainability principle exists to prevent"* (§2.5); `DecisionReuseEvidence` structured specifically to answer "why was this reused?" (§9.4); the audit record always embedding the verification outcome inline even where Python's own on-disk files never did (§6.7).

4. **One decision applies everywhere appropriate — "review once, apply everywhere."** The explicit tagline of Decision Reuse (§9.4); also the underlying logic of the group-level bulk actions (§4.8) and bulk multi-select in Item Check (§5.8) — all three are instances of the same idea at different granularities: don't make a reviewer re-state the same judgment more times than necessary.

5. **Never lose reviewer work; never silently discard state.** Not Quite's rejection of switching groups mid-transaction rather than silently discarding the open one (§2.3); import never overwriting existing decisions (§9.4); autosave firing continuously with no reviewer action required (§9.2); the graceful-degradation fix for IndexedDB unavailability rather than a blank page (§9.8).

6. **Calm, predictable, low cognitive load — information over decoration; favor clarity over quantity.** Explicitly named by Andrew for Milestone 3's statistics design; cited directly as the exact bar the `<details>`-collapsing bug violated (§11.4 below); behind the 5-line cap on the Redaction Rules preview (§8.4); behind replacing a blocking success dialog with a non-modal banner (§9.4, §10.6).

7. **Fail closed on ambiguity, not open.** Decision Reuse Tier 3's conservative 0.90 threshold and 0.05 margin (§9.4): *"misapplying a Redact/Keep decision to the wrong real-world entity is a materially worse failure than an unhelpful suggestion."* Tier 2's group-conflict guard (§4.6). `OutputVerifier`'s conservative stance on no-op renames (§4.9): *"a PII tool erring toward 'flag for review' is safer than silently treating a no-op rename as success."*

8. **Be honest about what isn't built; never fake a capability.** `history.undo`/`redo` are always explicitly rejected with a stated reason, never silently faked, across every phase and milestone where the question comes up (§5.8, §9.7).

9. **Derive facts; don't track redundant state that can silently drift.** Verification staleness is computed fresh on every read, never a settable/clearable boolean (§9.7); `wentThroughNotQuite`/`wasEverImported` are derived from the append-only event log, not the current decision snapshot, specifically to avoid conflating "is currently X" with "was ever X" (§9.5).

10. **Extend interfaces additively; never break an existing caller to add a real capability (the "objective interface defect" pattern).** Recurs across nearly every phase examined: `DocumentRebuilder`'s additive `replacements` parameter (§8.1), `ExplanationEngine`'s context parameter, `OccurrenceClassifier`'s widened signature, `AuditExporter`'s widened signature. Distinguished carefully, project-wide, from a *redesign* — fixing a genuinely missing capability is not the same category of change as reconsidering a working design.

11. **Reuse existing infrastructure instead of building parallel mechanisms.** Decision Reuse literally reuses `EntityResolutionEngine`'s grouping output and the existing `decisions.json` export format rather than inventing new ones (§9.4); `bulkApplyDecision` generalizes Feature 001's group-bulk pattern rather than building a second bulk mechanism (§5.8); `ReplacementRuleEngine` wires into the existing `DocumentRebuilder` via an additive parameter rather than a parallel rebuild path (§8.1).

12. **Immediate, reversible actions over modal confirmation dialogs.** Explicit in Decision Reuse's "no preview/confirm step" rationale (§9.4); consistent with bulk actions being freely re-decidable (§5.8) and with the broader "alert on failure only" convention (§10.6).

13. **Real browser validation is a required, distinct verification step — property/behavior test suites are necessary but not sufficient.** Every milestone and feature examined runs a live browser validation pass as a matter of course, and treats defects found there as more significant findings than gaps in unit coverage — stated most directly in Milestone 3: *"the one thing... impossible to prove without a real browser, and it passed"* (§9.2).

14. **Open, product-level judgment calls are surfaced explicitly, never resolved unilaterally.** This recurs, close to verbatim, across multiple independent decision points: whether Gate C's "Interaction Fixture" criterion was satisfied (Phase 10), whether group bulk-actions retirement was safe (Phase 12), and whether a no-op Flatten-Group rename should count as a verification failure (Feature 001, §4.9, still open). This is a procedural principle as much as a design one.

15. **Minimize sensitive/raw content in exported and audit artifacts.** Andrew's own explicit instruction — *"do not include source document content unnecessarily... minimize sensitive data in the audit report"* — drove the deliberate CSV/QA-metrics deviations from Python's more content-heavy exports (§6.7).

16. **Deterministic, explainable mechanisms over heuristics or machine learning.** Stated repeatedly and independently: regex-based detection over NER (§8.8); Decision Reuse's three named, individually testable matching tiers instead of embeddings or undocumented heuristics (§9.4); the estimated-time-remaining statistic computed from the reviewer's own observed pace, explicitly *not* AI (§9.6), tied directly to *"keep AI explainable rather than magical."*

17. **UI-layer concerns stay out of the domain layer, even under pressure to unify them.** 2D grid arrow remapping is deliberately kept out of `FocusNavigator` because it depends on rendered viewport state (§7.2); Category Check's aggregation view needed zero new domain state (§2.4); `itemCheckQuery.ts`'s search/filter/sort logic never reads or writes `ReviewSession` directly (§5.6).

---

## Part 2 — Gap Analysis

Every reviewer-facing capability referenced above, plus the smaller interaction details the request specifically asked not to be excluded on the grounds of size. **Importance** follows this project's own established classification vocabulary (Critical / Important / Nice-to-have), drawn directly from `review-workspace-reconstruction.md`'s own scheme where a capability was explicitly classified there, and applied by direct analogy elsewhere. **Recommended milestone** reflects either an explicit commitment already made in a source, or — where none exists — this document's own reasoned placement, marked accordingly.

| Capability | Current status | Evidence | Importance | Recommended milestone |
|---|---|---|---|---|
| Non-wizard, simultaneously-workable stages | Built | `review-workspace-reconstruction.md:55-68`; `app.ts` stage tabs | Critical | Done |
| Horizontal stage tabs with live unresolved/total counts | Built | `docs/detection/milestone-1-review-workspace-phase-1-2.md` | Critical | Done (Milestone 1) |
| Ambiguity Check via ordinary candidate-decision vocabulary | Built | `review-workspace-reconstruction.md:236-249` | Critical | Done |
| Not Quite (enter/member actions/complete/exit) | Built | `docs/detection/phase-8-findings.md` | Critical | Done |
| Not Quite visual/styling treatment distinct from surrounding rows | Not implemented | `review-workspace-reconstruction.md:418-421` | Nice-to-have | Milestone 4 |
| Group Confirm / Reject / Flatten (bulk) | Built | `docs/detection/feature-001-group-bulk-actions.md` | Important | Done (Feature 001) |
| Group-level Redact / Ignore | Deliberately deferred, not built | `docs/detection/feature-001-group-bulk-actions.md` | Nice-to-have | Not scheduled — open scope question for Andrew |
| Per-member group-exclusion checkbox (pre-Not-Quite) | Deliberately not built (need covered elsewhere) | `docs/detection/phase-8-findings.md` | Nice-to-have | Not scheduled |
| Live-recalculating group confidence as members change | Not confirmed built | `DocScrub-Web_Architecture_Review_Report.docx` §4.6 | Important | Milestone 4 (recommended by this document) |
| ExplanationEngine (standard/expert views) | Built | `docs/detection/milestone-1-review-workspace-phase-1-2.md` | Critical | Done (Milestone 1) |
| ExplanationEngine audit view consumed by AuditExporter | Not implemented | `docs/detection/phase-11-findings.md` | Important | Milestone 4 (recommended by this document; explicitly flagged as a "natural small follow-up") |
| CandidateDetailPanel (badges, summary, snippets, occurrence browser, expert view) | Built | `docs/detection/milestone-1-review-workspace-phase-1-2.md` | Critical | Done |
| Category Check (List / By Category drill-down) | Built | `docs/detection/milestone-1-review-workspace-phase-1-2.md` | Critical | Done |
| QA stage — distinct interactive content beyond a placeholder | Unresolved / stub | `app.ts` QA stage render | Important | Undecided — open question, no source commits either way |
| Item Check search (multi-field, live) | Built | `docs/detection/milestone-2-review-at-scale.md` | Important | Done |
| Search-input focus/cursor preservation across re-render | Built (fixed defect) | `docs/detection/milestone-2-review-at-scale.md` | Important | Done |
| 8 advanced filter presets | Built | `docs/detection/milestone-2-review-at-scale.md` | Important | Done |
| 5 sort orders + direction | Built | `docs/detection/milestone-2-review-at-scale.md` | Important | Done |
| Bulk multi-select + bulk decision application (Item Check) | Built | `docs/detection/milestone-2-review-at-scale.md` | Important | Done |
| Pagination / virtualization for very large candidate lists | Not built; judged unnecessary so far | `review-workspace-reconstruction.md:555-558` | Nice-to-have (contingent) | Only if a real multi-thousand-candidate document proves it necessary |
| Cross-stage quick-jump nav (`]`/`[`/Next ambiguity/Jump to category) | Built | `docs/detection/milestone-2-review-at-scale.md` | Important | Done |
| Command Bar (all stages) | Built | `docs/detection/milestone-2-review-at-scale.md` | Important | Done |
| PageUp/PageDown page-jump within item list | Documented as ported, but not actually reachable — genuine discrepancy | This document's own source-code check, §7.3 | Important | Should be resolved (build it, or correct the phase-9 doc) before further keyboard work |
| 2D grid arrow remapping (visual-column-aware) | Deliberately deferred to UI layer, not built | `review-workspace-reconstruction.md:137-141` | Nice-to-have | Milestone 4, UI-layer only, never domain layer |
| Rich Tab-based cross-widget focus traversal (Python's full model) | Not built, no prior deferral note | This document's own Python-oracle check, §7.3 | Nice-to-have | Not scheduled — speculative whether needed at all |
| Shift+`+`/`-` expand/collapse all detail panels | Not built | Python oracle, §7.3 | Nice-to-have | Not scheduled |
| "Accept quality result changes" live-rescore reconciliation flow | Not built; likely not applicable to this architecture | Python oracle, §7.3 | Nice-to-have | Not scheduled — pipeline runs once per load, may not apply |
| ReplacementRuleEngine (generic/sequential/custom) | Built | `docs/detection/milestone-3-reviewer-productivity.md` | Critical | Done (Milestone 3) |
| Redaction Rules live preview | Built | `docs/detection/milestone-3-reviewer-productivity.md` | Critical | Done |
| `<details>` panel open-state persistence across re-render | Built (fixed defect, applied app-wide) | `docs/detection/milestone-3-reviewer-productivity.md` | Important | Done |
| Advanced/basic toggle for Redaction Rules panel | Not implemented | `review-workspace-reconstruction.md:435-436` | Nice-to-have | Milestone 4 |
| Per-candidate resolved replacement text visible inline in Item Check row | Not implemented | This document's own synthesis, §3.4 | Nice-to-have | Milestone 4 (recommended by this document) |
| LocalSessionRepository (IndexedDB autosave) | Built | `docs/detection/milestone-3-reviewer-productivity.md` | Critical | Done (Milestone 3) |
| Recent Documents landing page (resume/remove, %, last-opened) | Built | `docs/detection/milestone-3-reviewer-productivity.md` | Important | Done |
| Real page-refresh recovery | Built, verified live | `docs/detection/milestone-3-reviewer-productivity.md` | Critical | Done |
| Persistence status live feedback (saved/saving/error) | Built (fixed 2 defects) | `docs/detection/milestone-3-reviewer-productivity.md` | Important | Done |
| Startup graceful degradation if IndexedDB unavailable | Built (fixed defect) | `docs/detection/milestone-3-reviewer-productivity.md` | Important | Done |
| Storage-quota proactive warning + forced-export path | Partially implemented (status surfaced; forced-export path unconfirmed) | `DocScrub-Web_Architecture_Review_Report.docx` §4.10 | Important | Milestone 4 (recommended by this document) |
| Decision Reuse (import + 3-tier matching) | Built | `docs/detection/feature-002-decision-reuse.md` | Important | Done (Feature 002) |
| Decision provenance labels ("(Imported)" / "(Modified from import)") | Built | `docs/detection/milestone-3-reviewer-productivity.md` | Important | Done |
| Provenance tooltip integrated into Standard-view summary sentence | Not implemented; explicitly named as the intended evolution | `review-workspace-reconstruction.md:227-230` | Nice-to-have | Milestone 4 |
| Import→override→"(Modified from import)" full live browser click-through | Unit-tested, not re-validated live this session | `docs/detection/milestone-3-reviewer-productivity.md` | Important | Milestone 4 (explicitly flagged, "if not sooner") |
| Review statistics bar (all stages) | Built | `docs/detection/milestone-3-reviewer-productivity.md` | Important | Done |
| Non-modal success toast (general, beyond the one import instance) | Not implemented generally | `review-workspace-reconstruction.md:428-432` | Nice-to-have | Milestone 4 |
| Output generation failure — non-blocking alternative to `window.alert()` | Not implemented (consistent convention, but flagged as worth extra care) | `review-workspace-reconstruction.md:367-372` | Important | Milestone 4 (recommended by this document, given output failure is the highest-stakes moment) |
| Occurrence-level partial coverage surfaced to reviewer | Not implemented; domain data exists | `review-workspace-reconstruction.md:412-417` | Important | Explicitly remains open — not scheduled in any milestone yet |
| Post-generation rescan/verification (OutputVerifier) | Built | `review-workspace-reconstruction.md:268-282` | Critical | Done |
| Verification-failure explanation (no silent FAILED state) | Built (fixed defect) | `docs/detection/feature-001-group-bulk-actions.md` | Critical | Done |
| Policy decision: does a no-op Rename count as verification failure? | Open product question, current conservative default in place | `docs/detection/feature-001-group-bulk-actions.md` | Important | Requires Andrew's explicit decision, not an implementation task |
| Audit artifacts exclude raw candidate text (CSV/QA metrics) | Built, deliberate improvement over Python | `docs/detection/phase-11-findings.md` | Critical | Done |
| Typography / spacing / color / iconography polish | Not implemented | Every Milestone 2/3 "Remaining work" section | Important | Milestone 4 |
| Accessibility (WCAG, ARIA, screen reader, contrast, keyboard-only audit) | Not implemented; not yet specified beyond a named future slot | `docs/detection/milestone-3-reviewer-productivity.md` | Critical (for production readiness) | Milestone 4 |
| Responsive / mobile layout behavior | Minimal (one CSS breakpoint only) | `index.html` | Important | Milestone 4 |
| Onboarding for first-time reviewers | Not implemented | Milestone roadmap naming only | Important | Milestone 4 |
| Docking / rearrangeable panels | Not designed anywhere; no source proposes this | This document's own synthesis, §1.4 | Not applicable | Not proposed by any source — speculative only if raised fresh |
| Comparison mode (side-by-side document versions) | Not designed anywhere; no source proposes this | This document's own synthesis | Speculative | Not proposed by any source |
| Saved filters / review bookmarks | Not designed anywhere; no source proposes this | This document's own synthesis | Speculative | Not proposed by any source; would be a natural Milestone-4-or-later extension of the existing filter-preset system if wanted |
| Configurable columns (Item Check list view) | Not designed anywhere; no source proposes this | This document's own synthesis | Speculative | Not proposed by any source |
| Occurrence highlighting within document context snippets | Not designed anywhere; snippets show match markers (`[match]`) already | `app.ts` context-snippet rendering | Nice-to-have | Milestone 4, incremental extension of existing snippet rendering |
| Group/candidate decision-state visual coloring + completion checkmarks | Not implemented | `review-workspace-reconstruction.md:425-427` | Nice-to-have | Milestone 4 |
| Confidence "was X%, now Y%" indicator on group membership change | Not implemented | `review-workspace-reconstruction.md:425-427` | Nice-to-have | Milestone 4 |
| Undo / redo | Deliberately not built, honestly rejected everywhere it's asked for | `docs/detection/phase-10-findings.md` | Important (as a policy) | Not scheduled — no source proposes building real undo; the honest-rejection stance itself is the current design |

---

## Closing note on method

Three findings surfaced by this reconstruction are worth naming explicitly because they are not simple "gap" entries — they are places where the project's own documentation disagrees with itself or with the code, and a specification's job is to surface that rather than silently pick a side:

1. **PageUp/PageDown** is documented in `docs/detection/phase-9-findings.md` as ported faithfully from the Python oracle, but is not reachable in the current keyboard map or command vocabulary (§7.3). This should be resolved one way or the other — built, or the earlier finding corrected — rather than left ambiguous.
2. **The QA stage's intended final content** is genuinely undecided. Category Check answers the underlying need Andrew originally asked "QA" to cover, but the QA tab itself still exists as a separate, empty stub in the tab bar. Whether it should be removed, repurposed, or given distinct content has not been decided by any source (§2.4).
3. **Whether a no-op Flatten-Group rename should count as a verification failure** (§4.9) is an open product policy question the codebase itself flags as unresolved, with a conservative default already shipping. It is included here, not resolved, because a specification of *current design intent* should record known-open questions as open, not quietly close them on this document's own authority.
