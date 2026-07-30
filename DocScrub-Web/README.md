# DocScrub-Web

Browser-local review application — target architecture v0.2. See
`../docs/architecture/DocScrub-Web_Target_Architecture_v0.2.docx` for the full
architecture, and `../docs/architecture/DocScrub-Web_Architecture_Review_Report.docx`
(filed as `DocScrub-Web_Architecture_Review_Report.docx` at the project root today)
for the review that produced it.

## Status: migration complete, in feature-based development

The Python-to-TypeScript migration (architecture v0.2 §14's phased plan)
finished at **Gate E, Phase 12** (2026-07-28) -- see
`docs/detection/phase-12-findings.md` for the full side-by-side acceptance
record (all 13 domain-parity fixtures, zero unresolved behavioral
differences against the Python oracle) and `docs/architecture/
phase-1-acceptance-criteria.md` for the gate-by-gate closure history
(Gate A parser/rebuilder, Gate B domain parity, Gate C review interaction,
Gate D output/audit parity, Gate E side-by-side acceptance). Every engine
named in the architecture doc is real, production code, independently
fixture-verified, and has been click-tested in a real browser with zero
defects (`docs/detection/phase-10.1-findings.md`). The full phase-by-phase
build history (which Python module each component ports, what was
deliberately not ported and why, every documented deviation) lives in
`docs/detection/phase-4-findings.md` through `phase-12-findings.md` --
consult those for archaeology; this README describes current state, not
how it was built.

**The TypeScript implementation is the production reference implementation**
for its supported scope: OOXML parse/redact/rebuild/verify, detection,
quality scoring, entity resolution, occurrence classification, durable
review state (including Group Check bulk actions and Decision Reuse -- see
"Features" below), interaction focus, save/resume, audit export, and (as of
Milestone 1) reviewer-facing evidence/explanation and Category Check
aggregation. As of Milestone 3, `LocalSessionRepository` is real too --
persistent browser-local review sessions (autosave, refresh recovery,
explicit save, Recent Documents), a configurable `ReplacementRuleEngine`,
imported-decision provenance, and reviewer-facing statistics throughout the
workspace.

**As of Gate E, this project moved from migration milestones ("Phase N")
to normal feature-based development.** New work is tracked as numbered
features (`docs/detection/feature-NNN-*.md`), each with its own design
rationale, verification, and browser validation record, following the same
rigor the migration itself established -- oracle-first where a Python
behavior exists to compare against, deterministic property/behavior
verification where it doesn't, zero silent regressions, real browser
validation before considering a feature done.

## Review Workspace reconstruction and Milestone 1 (2026-07-28)

The thin integration UI described below is being replaced, milestone by
milestone, by the production reviewer workspace specified in
`docs/architecture/review-workspace-reconstruction.md` (reconstructed from
the Python reviewer UI's embedded HTML/CSS/JS, `redactor/explanations.py`/
`replacement_rules.py`, and the v0.2 architecture doc's own anticipated
component list -- a specification, a gap analysis
Critical/Important/Nice-to-have/Already-implemented-but-not-surfaced, a
prioritized roadmap, and an explicit list of what should and should not
carry forward from Python).

**Milestone 1, Phase 1 + Phase 2** (2026-07-28,
`docs/detection/milestone-1-review-workspace-phase-1-2.md`) implements the
first two roadmap phases: `ExplanationEngine` is now a real, direct port of
`explanations.py` (standard/expert/audit views, confidence-band openers,
evidence phrasing), surfaced through a new `CandidateDetailPanel`
(likelihood/type/recommendation badges, context snippets, an occurrence
browser, and a collapsible Expert View), plus a Category Check aggregation
view (Review State x Category drill-down) inside Item Check. One real bug
found and fixed during browser validation: Expert View's diagnostic
category labels rendered raw snake_case identifiers instead of formatted
labels, because `CandidateQualityAssessment.reasons`/`filterRules` are a
separate, never-kebab-cased representation of the same rule vocabulary as
`Evidence.category` -- fixed by normalizing inside `categoryRuleLabel()`.
Andrew also confirmed, mid-implementation, that the workspace's horizontal
non-linear stage tabs (not a wizard) are the intended design, superseding
the reconstruction document's own gap-analysis suggestion to the contrary
(see that doc's gap item 7, and the findings doc's "Design decisions"
section). 61 new checks (620 total), zero regressions.

**Milestone 2, Review at Scale** (2026-07-28,
`docs/detection/milestone-2-review-at-scale.md`) implements Item Check
search (a single free-text box matching text/replacement/category/review
state/likelihood/ambiguity/entity type, updating on every keystroke),
eight combinable advanced-filter presets, five sort orders, multi-select
bulk actions (Keep/Rename/Redact/Ignore selected, via a new
`review.bulkApplyDecision` command generalizing Feature 001's group-level
bulk pattern), cross-stage quick-jump navigation (Next undecided/Previous
decision/Next ambiguity/Jump to category), and an always-visible Command
Bar (generalized to every stage, not just Group Check, per Andrew's
explicit instruction). Andrew also explicitly resequenced the roadmap
during this milestone, moving `ReplacementRuleEngine` out of the immediate
next phase into Milestone 3 -- his reasoning (quoted in the findings doc):
it's new domain logic answering a customization question, not the more
urgent "can I review a large document efficiently" question this
milestone's tools answer directly. 91 new checks (711 total), zero
regressions.

**Milestone 3, Reviewer Productivity** (2026-07-28,
`docs/detection/milestone-3-reviewer-productivity.md`) implements persistent
browser-local review sessions via a real `IndexedDbSessionRepository`
(autosave on load and every reviewer action, explicit save, full recovery
after a real page refresh), a Recent Documents landing experience (resume/
remove, completion percentage, last-opened time), a new
`ReplacementRuleEngine` (generic/sequential/custom placeholder strategies
per entity type, wired into `DocumentRebuilder` via an additive parameter,
with a live preview in the Output stage), richer imported-decision
provenance (distinguishing an unmodified import from one a reviewer has
since overridden), and a reviewer statistics bar on every stage. Four real
bugs found and fixed during browser/Node validation, not designed around:
autosave never firing for a freshly loaded zero-decision document; the
persistence-status UI not re-rendering after a background autosave
completed; every `<details>` panel in the app (Redaction rules, By type,
Occurrence Browser, Expert View) silently collapsing on its own interaction
once background re-renders became routine; and a blank-page startup failure
if IndexedDB is ever unavailable. 70 new checks (781 total), zero
regressions.

## Features

**Feature 001 -- Group Check bulk actions** (2026-07-28,
`docs/detection/feature-001-group-bulk-actions.md`). Closes the one gap
Gate E flagged: Confirm Group / Reject Group / Flatten Group, three new
`review.*` commands letting a reviewer resolve an entire proposed entity
group in one action instead of member-by-member through Not Quite. Found
and fixed two real, pre-existing latent defects while validating this in a
real browser: an infinite loop in `ooxml/rebuild.ts`'s replace logic
(triggered whenever a Rename's replacement text equals its own search
text, which Flatten Group produces routinely), and a silent
"Verification: FAILED" state in `OutputVerifier.ts` with no explaining
finding. 83 new checks (442 total, up from Gate E's 356), zero regression.

**Terminology and scope revision** (2026-07-28, same-day amendment --
`docs/detection/feature-001-group-bulk-actions.md`'s amendment note). Group
Check's bulk-action labels changed from Confirm/Reject/Flatten Group to
match Item Check's own vocabulary exactly: Keep as-is (`k`) / Rename (`n`) /
Redact (`r`) / Ignore (`i`) / Not Quite (`q`). `redactGroup`/`ignoreGroup`
are new commands filling the `r`/`i` keyboard slots reserved since Feature
001; `rejectGroup`/`x` is removed (no counterpart in the corrected
vocabulary). Zero regression across all 18 verify suites (one
`focus-navigator-verification.ts` test updated to assert the new key
resolution).

**Feature 002 -- Decision Reuse ("Review once. Apply everywhere.")**
(2026-08-01, `docs/detection/feature-002-decision-reuse.md`). Lets a
reviewer import a previously exported decisions.json (the same file
"Download Decisions (JSON)" already produces) while reviewing a new version
of the same document; previously-decided entities are recognized and their
decisions reused automatically wherever confidence is deterministically
high, via three tiers -- exact candidate-key match, grouped-alias reuse
through this document's own entity resolution, and a conservative
(0.90 threshold, 0.05 margin) deterministic text-similarity match, all
computed by a new stateless `DecisionReuseEngine`. Reused decisions are
tagged `(Imported)` inline, remain fully overridable exactly like any other
decision, and the audit record distinguishes reviewer decisions, imported
decisions, and reviewer overrides of imports. Never overwrites an existing
decision (reviewer- or import-sourced) -- import fills gaps, it does not
contest state. One real UX defect found and fixed during browser
validation: a blocking `window.alert()` success dialog was replaced with a
non-modal summary line. 117 new checks (559 total), zero regressions.

**Ambiguity anchor correction** (2026-07-28,
`docs/detection/ambiguity-anchor-correction.md`). Andrew traced a real
document where `Andrew Goodloe` was detected once but five bare `Andrew`
occurrences elsewhere never triggered Ambiguity Check. Root cause: two
compounding defects inside `entity-resolution/resolution.ts` (a faithful
port of a genuine, pre-existing Python oracle bug, not a TS regression) --
`buildAmbiguousMatches()` only considered entities that had ALREADY formed a
real `>=2`-member group, so a person mentioned with just one spelling was
invisible to ambiguity matching; `buildEntityGroups()` separately
auto-merged a first-name-only candidate into a bucket silently whenever
exactly one full-name bucket matched, with no reviewer confirmation. Fixed
by sourcing ambiguity evidence from every detected full-name entity
(including solitary ones) via a new `buildFullNameAnchorBuckets()`, removing
the silent auto-merge entirely, and adding `review.linkAmbiguousCandidate` --
the first command to write to the `ambiguityResolutions` schema that has
existed unused since ADR-008/Phase 8 -- plus one link button per proposed
option in Ambiguity Check. Applies Keep, never Rename, so surface text is
always preserved; declining needs no new command (dispatch
Keep/Rename/Redact/Ignore directly, as Ambiguity Check already allowed). An
unrelated pre-existing fixture (`entity-resolution-001`) turned out to
independently exercise the same defect via its own `Maria`/`Maria Alvarez`
pairing -- confirmed as an approved, disclosed deviation from the Python
export, not a regression (see the findings doc and
`fixtures/domain-parity/entity-resolution-001/manifest.json`). 45 new checks
(604 total), zero regressions, real browser validation confirmed both
linking and suppression from Item Check.

**Workspace interaction revision** (2026-07-29,
`docs/detection/workspace-interaction-revision.md`). Not a feature -- a
refinement of the reviewer interaction model, per Andrew's own philosophy:
minimize UI manipulation time, maximize evidence-evaluation time. Selecting
a candidate now auto-expands it (expansion is derived directly from
`FocusState`, not tracked as separate UI state); the Detail button and its
D/./Space shortcut are removed entirely, since their only purpose was
toggling that now-eliminated separate state. Ambiguity resolution moved out
of the top-level row and into the detail panel as a "Possible identities"
list, ordered Explanation -> Representative snippets -> Possible identities
-> Occurrences -> Expert View; selecting an identity (whether one option or
several, displayed identically) links immediately with no confirmation
step, the same interaction shape as Keep/Rename/Redact/Ignore. Every
per-candidate decision, from mouse or keyboard, now shows a brief (~500ms)
green acknowledgement before the just-decided row collapses and the next
unresolved candidate expands automatically. The notable finding: automatic
progression required no new navigation logic --
`WorkspaceCommandDispatcher.dispatchReview()` has called `reconcileFocus()`
after every decision since Phase 9/10, so the revision only needed to delay
*revealing* an already-computed focus advance, not compute one. Zero
regressions across all 18 verification suites (604 total, unchanged --
this was a UI-layer-only change with no new domain logic to cover); real
browser validation confirmed every item on Andrew's checklist, including
keyboard-driven decisions and reversibility of an already-decided
candidate.

**Group Check revision** (2026-07-29, `docs/detection/group-check-revision.md`).
Andrew shared screenshots of local_web_app.py's (the Python oracle) Group
Check layout, explicitly directing the work into DocScrub-Web instead ("Do
not fix Python... Incorporate these into the new version"). Root-caused a
systemic arrow-key navigation defect: `FocusNavigator`'s `moveItem` always
traversed each stage's raw structural order, never the currently
displayed/sorted one -- Item Check already had sort (Milestone 2) that
arrow keys silently ignored; Group Check had no sort at all until this
revision added one. Fixed via a UI-layer interception
(`moveWithinVisibleList()` in app.ts) generalizing Milestone 2's own
`goToAdjacentInVisibleList()` pattern to plain sequential movement over
whatever's on screen, for both Item Check and the new Group Check sort.
Group Check rows are now compact and color-coded by decision (muted
background, checkmark replacing the confidence score once uniformly
decided, the active decision's button solid-colored -- "emphatic but not
aggressive"), with a 2-column layout toggle, via a new derived
`groupDisplayDecision()` (coverage.ts) that reads the group's real outcome
from its members' own decisions rather than the coarser stored
`EntityGroupDecision.decision`. Andrew's Not-Quite-auto-collapse request
("a uniformly-decided group should just read as that decision once you
leave it") required zero new code -- it falls out for free from
`groupDisplayDecision` being derived fresh every render plus
`reconcileFocus()`'s pre-existing auto-advance (same mechanism the
workspace interaction revision above already established); a mixed outcome
correctly stays flagged rather than being collapsed to a guess, per
Andrew's confirmed rule. 17 new checks (all 20 verification suites, zero
regressions); real browser validation confirmed the nav-order fix, the
compact layout, and both the uniform-collapse and mixed-stays-flagged
paths end to end.

**Command bar + inline editors revision** (2026-07-29,
`docs/detection/command-bar-inline-editors-revision.md`). Andrew reported
per-button "(k)"/"(n)"/etc. hints as redundant clutter (screenshots of
Python's own dynamic top bar as reference), `window.prompt()` for Rename/
Redact/Not Quite text entry as "unacceptable for both scope and UX," and a
"buttons don't visibly update" bug. Investigation (reading, not assuming)
found the real cause of the third item: `keymap.ts`'s
`resolveKeyboardCommand()` had always, intentionally, returned `null` for
the "n"/"r" keys in Item Check/Ambiguity Check and inside an open Not Quite
panel, awaiting a UI-layer editor that was never built -- K/I and every
mouse click already worked. Fixed all three together: `window.prompt()`
replaced everywhere it appeared with an inline text editor (Item Check/
Ambiguity Check per-candidate, the Milestone 2 bulk toolbar, Not Quite
per-member), Redact gained the same optional inline text Rename already
needed (previously Redact never offered typed text, mouse or keyboard), a
keyboard fallback opens that same editor for "n"/"r" (closing the root-
caused gap), and the command bar -- moved above the stage body -- now
derives its legend text fresh every render from focus context (Not Quite
open vs. not, an editor open vs. not) instead of being fixed per stage.
The version label also gained an always-present same-day counter
(`v2026-07-29.01`) so a refresh can prove it picked up a change. Zero
regressions across all 22 verification suites (UI-layer-only change, no
new domain logic). Live browser click-through was not completed this
session -- Claude in Chrome drives Andrew's own real browser, which cannot
reach this sandbox's local server; disclosed rather than assumed passing.

**Group Check Python-parity revision** (2026-07-29,
`docs/detection/group-check-python-parity-revision.md`). From two Group
Check screenshots of Python's `local_web_app.py`, Andrew asked for
per-member checkboxes with subset-scoped bulk actions ("Rename selected"
etc.), a radio quick-pick so accepting a "found" spelling never requires
typing, and live per-item confidence that jumps to 100% once a member is
reviewer-decided -- extended (his explicit choice) to Item Check/Ambiguity
Check's flat candidates too, not just Group Check. Reused a pre-existing,
previously-unused (zero call sites) faithful port of Python's
`calculate_entity_confidence()` rather than reimplementing the formula,
extending it with one optional, additive parameter so the engine itself
stays review-session-agnostic (matching Python's own layering: the
"decided member = 100" substitution lives in the review layer, not the
resolution engine) -- new `groupLiveConfidence()`/`memberLiveConfidence()`/
`candidateLiveConfidence()` in `src/engines/review/coverage.ts`. The
group-level "+10 reviewer confirmed" bonus is deliberately excluded from
individual member scores, matching a real asymmetry in Python's own
`dynamicGroupConfidence` vs. `scoreMemberAgainstCanonical`. Disclosed trim:
confidence does not recompute live against an in-progress rename draft
(would require per-keystroke re-rendering, reversing the command-bar
revision's own focus-loss fix) -- it recomputes against the last
*committed* name only. New verification suite
(`verify/live-confidence-verification.ts`, 13/13) plus zero regressions
across the full 24-suite battery. Live browser click-through not completed
this session for the same sandbox-network-isolation reason as above.

**Group Check keyboard and navigation revision** (2026-07-29,
`docs/detection/group-check-keyboard-and-navigation-revision.md`). Six
follow-ups from Andrew after using the shipped Group Check UI, all
verified together as one revision since several depend on each other:
"Rename" relabeled "Change" (key C) and "Not Quite" relabeled "Fix this"
(key F) everywhere -- display/keybinding only, decision vocabulary and
audit trail unchanged, and this closed a real pre-existing inconsistency
where Group Check's keyboard Change/Redact used to bypass the inline
editor while the buttons never did. The brief acknowledgement pulse now
covers every decision path (Group Check bulk actions, Not Quite per-member
actions), not just Item/Ambiguity Check's, via a generalized
`AcknowledgementTarget` union and a new CSS pulse animation. K/C/R/I/F
always re-target the button highlight mid-edit, but a per-target draft
cache means typed text survives switching decisions and back. Group Check
rows now default to expanded whenever they're the reviewer's current
focus (the earlier same-day manual expand toggle is removed). Arrow keys
inside an expanded group now roam its own controls directionally using
real DOM focus (a roving-tabindex grid, Group Check only this revision --
Item/Ambiguity Check's decision buttons are a disclosed, cheap follow-up
if wanted) while Tab/Shift+Tab always mean "next/previous item." Zero
regressions across all 24 verification suites; live browser click-through
not completed this session for the standing sandbox-network-isolation
reason.

Every domain/interaction/integration/audit component is independently
verified (`verify/production-parity.ts`, `verify/detection-parity.ts`,
`verify/quality-parity.ts`, `verify/entity-resolution-parity.ts`,
`verify/occurrence-classification-parity.ts`,
`verify/review-engine-verification.ts`,
`verify/focus-navigator-verification.ts`,
`verify/workspace-integration.ts`, `verify/ui-smoke.ts`,
`verify/audit-exporter-verification.ts`,
`verify/group-bulk-actions-verification.ts`,
`verify/decision-reuse-verification.ts`,
`verify/explanation-engine-verification.ts`,
`verify/milestone-2-review-at-scale-verification.ts`,
`verify/milestone-3-reviewer-productivity-verification.ts`,
`verify/ambiguity-anchor-verification.ts`).

## Layout

```
DocScrub-Web/
  src/
    domain/       -- versioned schema types: DocumentModel, ReviewSession,
                      Evidence, Commands, ScoringProfileSnapshot,
                      VerificationReport, NotQuite sub-state, AuditRecord
                      (NEW, Phase 11 -- the canonical audit schema every
                      AuditExporter projection derives from)
    engines/       -- DetectionEngine (RegexDetectionEngine) is REAL as of
                      Phase 4 -- a faithful port of redactor/detectors.py.
                      CandidateQualityEngine (RegexCandidateQualityEngine)
                      is REAL as of Phase 5 -- a faithful port of
                      redactor/candidate_quality.py. EntityResolutionEngine
                      (RegexEntityResolutionEngine) is REAL as of Phase 6
                      -- a faithful port of redactor/entity_resolution.py.
                      OccurrenceClassifier (RegexOccurrenceClassifier) is
                      REAL as of Phase 7 -- a faithful port of
                      redactor/occurrence_groups.py's classification rule,
                      plus an additive reviewer-ready enrichment layer with
                      no Python equivalent. ReviewEngine
                      (DurableReviewEngine) is REAL as of Phase 8 -- durable
                      candidate decisions and Not Quite deferred review,
                      backed by src/engines/review/. FocusNavigator
                      (DeterministicFocusNavigator) is REAL as of Phase 9
                      -- transient interaction focus (stage/item/occurrence/
                      Not Quite member cursor), backed by src/engines/
                      navigation/. (CommandDispatcher moved to src/workspace/ as
                      of Phase 10 -- see below; it is real, not a
                      signature.) ExplanationEngine
                      (DeterministicExplanationEngine) is REAL as of
                      Milestone 1 -- a faithful port of
                      redactor/explanations.py's dictionary-driven
                      standard/expert/audit views, backed by
                      src/engines/explanation/, and consumed by app.ts's
                      new CandidateDetailPanel. See
                      docs/detection/milestone-1-review-workspace-phase-1-2.md.
                      DecisionReuseEngine
                      (DeterministicDecisionReuseEngine) is NEW as of
                      Feature 002 -- the first genuinely new engine since
                      Gate E closed (no Python module to port): a stateless,
                      pure engine computing which prior decisions apply to
                      the current document's candidates, via three
                      deterministic tiers (exact candidate-key match,
                      grouped-alias reuse through this document's own
                      EntityResolutionEngine output, and a conservative
                      deterministic-similarity fallback). See
                      docs/detection/feature-002-decision-reuse.md.
      detectors/   -- patterns.ts: line-for-line ported regex constants and
                      stop lists from detectors.py, cited inline against
                      the exact Python source
      quality/     -- scoring.ts: line-cited port of
                      candidate_quality.py's score_candidate_quality() and
                      every helper it depends on.
                      quality-dictionaries.data.ts: GENERATED lexicon data
                      dumped directly from the live Python module (see
                      scripts/generate_quality_dictionaries.py) -- do not
                      hand-edit
      entity-resolution/ -- resolution.ts: line-cited port of
                      entity_resolution.py's build_entity_groups() /
                      build_ambiguous_matches() / calculate_entity_
                      confidence(). sequence-ratio.ts: a from-scratch port
                      of Python's difflib.SequenceMatcher.ratio(), which
                      has no JS equivalent
      occurrence-classifier/ -- classification.ts: line-cited port of
                      occurrence_groups.py's occurrence_group_kind() /
                      group_occurrences() -- the parity-critical core,
                      verified against live Python for 22 cases.
                      occurrence-classifier.ts: additive enrichment adapter
                      (StructuredContext, ReviewOccurrence) with no Python
                      equivalent -- cross-references Detection/Quality/
                      EntityResolution output and introduces an explicit
                      document-reading-order sort
      review/         -- session.ts: the ReviewEngine reducer
                      (applyReviewCommand()/createReviewSession()), ported
                      against redactor/models.py + redactor/decisions.py +
                      local_web_app.py's update_decision()/
                      update_entity_group() and their own test suite --
                      see this file's top doc comment for what was and
                      was not ported, and why. serialization.ts: versioned
                      save/load with an explicit schemaVersion and a
                      documented migration ladder, an additive improvement
                      over Python's own unversioned save_state(). As of
                      Feature 001, session.ts also implements
                      confirmGroup/redactGroup/ignoreGroup/flattenGroup
                      (terminology revised same-day; rejectGroup removed --
                      see feature-001-group-bulk-actions.md's amendment
                      note) -- the Group Check bulk actions -- in the exact
                      same switch every other review command lives in; no
                      other file in this directory needed to change.
      navigation/     -- stages.ts: per-stage item lists + resolved/
                      completion status, derived fresh from (Detection,
                      Grouping, ReviewSession) every call, sharing
                      review/coverage.ts's resolved-status helper with
                      ReviewEngine.candidateStatus() so the two can never
                      diverge. navigator.ts: the FocusNavigator reducer
                      (applyNavigationCommand()/reconcile()/
                      restoreFocusState()), a faithful port of
                      redactor/review_queue.py's visible_items/
                      first_active_key/reconcile_active_key/move_active_key/
                      next_undecided_after_decision, plus a documented
                      symmetric bidirectional extension for
                      previousUnresolved. keymap.ts: resolveKeyboardCommand()
                      -- the one allowed "thin adapter" from a raw key event
                      to a structured command, context-resolved (not one
                      global switch), with no DOM listener of its own. As of
                      Feature 001, Group Check's keyboard vocabulary gained
                      k/x/n (Confirm/Reject/Flatten) -- see this file's
                      Feature 001 doc-comment note for the exact letter
                      choices and why r/i remain unbound at the group level.
                      session.ts also implements applyDecisionReuse as of
                      Feature 002 -- bulk-applies an already-computed
                      DecisionReuseProposal[] batch (computed entirely
                      outside this reducer, by DecisionReuseEngine) via the
                      same decideCandidate() helper, tagged source:
                      "imported" -- the one command in this file that
                      deliberately never overwrites an existing decision.
    io/            -- DocumentParser, DocumentRebuilder, OutputVerifier are
                      REAL implementations as of Phase 3 (OoxmlDocumentParser
                      / OoxmlDocumentRebuilder / OoxmlOutputVerifier). As of
                      Feature 001, OutputVerifier.ts also pushes a
                      body-text-residual-pii FidelityFinding for the
                      ordinary body/header/footer/comments rescan case (a
                      pre-existing explainability gap found during Feature
                      001's browser validation -- see this file's own
                      "EXPLAINABILITY GAP" doc-comment section).
                      AuditExporter (DeterministicAuditExporter) is REAL as
                      of Phase 11 -- see AuditRecord.ts (domain/) for the
                      audit schema and AuditExporter.ts's own doc comment
                      for the Python-oracle research and design decisions.
                      As of Feature 001, also derives wentThroughNotQuite
                      from the review event log rather than the decision
                      label alone (see AuditExporter.ts's Feature 001 note).
                      hash.ts: the shared sha256Hex primitive, extracted
                      this phase from DocumentParser.ts so AuditExporter's
                      output-identity hash and DocumentParser's
                      documentId hash can't silently drift apart.
                      LocalSessionRepository remains a signature only.
                      As of Feature 002, AuditExporter.ts also derives
                      source/wasImported/importEvidence per candidate (the
                      wasImported flag via the same event-log-derivation
                      pattern wentThroughNotQuite() established), and
                      DecisionImport.ts (NEW) parses a previously exported
                      decisions.json back in -- the deliberate inverse of
                      toDecisionsJson(), not a new file format.
      ooxml/       -- the actual parse/redact/rebuild mechanics: zip.ts
                      (CompressionStream/DecompressionStream-backed ZIP
                      read/write), document-text.ts (paragraph/run
                      extraction), rebuild.ts (cross-run surgical
                      replacement -- as of Feature 001, redactParagraph()'s
                      replace loop tracks a searchFrom cursor instead of
                      rescanning from index 0, fixing a real infinite loop
                      whenever a replacement's text equals or contains its
                      own search text -- see docs/detection/
                      feature-001-group-bulk-actions.md), document-parts.ts,
                      hyperlinks.ts (relationship target parse/splice),
                      comments.ts, tracked-changes.ts (detection-only, no
                      splice path), source-ref.ts (shared block-pointer
                      codec)
    settings/       -- SettingsService trust-classification types
    workspace/      -- NEW as of Phase 10, the composition layer -- coordinates
                      engines, never reimplements their behavior.
                      Workspace.ts: ReviewWorkspace, the orchestration root
                      (File -> DocumentModel -> Detection -> Quality ->
                      Grouping -> Classification -> DurableReviewEngine ->
                      DeterministicFocusNavigator, plus generateOutput()'s
                      rebuild+verify and a derived WorkspaceReadiness that
                      never duplicates OutputVerifier's own pass/fail rule).
                      As of Phase 11, also generateAudit() -- calls
                      AuditExporter with CURRENT document/detection/
                      grouping/session/verification-or-null/rebuiltOutput-
                      or-null (reusing the same staleness derivation
                      getState()/getRebuiltOutput() already use, factored
                      into a private currentVerification() helper).
                      WorkspaceSaveFile.ts: versioned save/load bundling
                      ReviewSession + FocusResumePosition, revalidated by
                      reusing their own existing serialize/deserialize
                      functions rather than duplicating shape-checking.
                      CommandDispatcher.ts: WorkspaceCommandDispatcher, the
                      REAL implementation as of Phase 10 (moved here from
                      src/engines/ -- see phase-10-findings.md's "structural
                      reorganization" note) -- routes review.*/navigation.*/
                      document.*/history.* to the correct engine, triggers
                      focus reconciliation after review commands, and
                      honestly rejects history.* (no engine owns reversible
                      history yet). explainCommandRouting() answers "why did
                      this command resolve where it did." As of Phase 11,
                      also routes document.generateAudit -- a single-line
                      passthrough to ReviewWorkspace.generateAudit(); all
                      audit assembly logic lives on Workspace, per Andrew's
                      explicit instruction not to move it into the
                      dispatcher. As of Feature 002, Workspace.ts also has
                      importDecisions(file) -- reads the file (the async I/O
                      boundary), calls DecisionReuseEngine.proposeReuse(),
                      dispatches review.applyDecisionReuse to its own
                      ReviewEngine, then reconcileFocus() -- and
                      CommandDispatcher.ts routes document.importDecisions
                      to it, structurally identical to document.generateAudit.
    ui/             -- NEW as of Phase 10. app.ts: a single, deliberately
                      plain entry point wiring one ReviewWorkspace + one
                      WorkspaceCommandDispatcher into visible DOM -- no
                      framework, no bundler (compiles via plain `tsc` to
                      dist/, loaded as a native browser ES module -- see
                      ../index.html and package.json's "build"/"serve"
                      scripts). Full re-render on every state change,
                      window.prompt() for Rename/Redact text entry. As of
                      Phase 11, the Output stage also has a "Generate Audit
                      Record" button plus four download buttons (audit
                      report / redaction log CSV / decisions / QA metrics),
                      deliberately available regardless of review
                      completeness or verification status. Click-tested in
                      a real browser as of Phase 10.1 (2026-07-28) -- zero
                      defects found. See phase-10.1-findings.md for the
                      full record. As of Feature 002, also has an "Import
                      prior decisions" file input (visible once a document
                      is loaded) and a non-modal import-summary banner
                      (renderImportSummaryBanner) -- deliberately NOT a
                      window.alert() on success (see feature-002-decision-
                      reuse.md's browser-validation section for the real
                      UX defect this replaced); candidate rows show an
                      "(Imported)" suffix with a hover tooltip carrying the
                      match evidence.
  index.html        -- the thin UI's static shell (NEW, Phase 10) -- loads
                      dist/ui/app.js as a native <script type="module">.
                      Must be served over http (e.g. `npm run serve`), not
                      opened via file://.
  verify/
    production-parity.ts -- full pipeline (parse -> REAL detect -> rebuild
                             -> verify) against all 12 domain-parity
                             fixtures, cross-checked by python-docx and raw
                             ZIP inspection. Run with:
                             `node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/production-parity.ts`
    detection-parity.ts   -- diffs RegexDetectionEngine's output directly
                             against Python's expected/candidates.json +
                             expected/occurrences.json for all 12 fixtures.
                             Run with:
                             `node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/detection-parity.ts`
    quality-parity.ts     -- diffs RegexCandidateQualityEngine's output
                             (quality/status/score/reasons) directly against
                             Python's expected/candidates.json for all 12
                             fixtures. Run with:
                             `node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/quality-parity.ts`
    scoring-smoke.ts      -- lightweight direct unit-style check of
                             scoring.ts against 6 hand-picked cases, each
                             cross-checked against live Python output
    entity-resolution-parity.ts -- diffs RegexEntityResolutionEngine's
                             output (group membership/ordering/confidence/
                             reasons, ambiguity proposals) directly against
                             Python's expected/entity-groups.json +
                             expected/ambiguity-proposals.json for all 13
                             fixtures. Run with:
                             `node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/entity-resolution-parity.ts`
    sequence-ratio-smoke.ts -- byte-exact check of sequence-ratio.ts
                             against 9 string pairs, cross-checked against
                             live Python difflib output
    occurrence-classification-parity.ts -- diffs RegexOccurrenceClassifier's
                             output (group kind/label/membership, context
                             extraction, navigation metadata, deterministic
                             ordering, entity-group cross-reference) against
                             Python's expected/occurrence-groups.json for
                             all 13 fixtures. Run with:
                             `node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/occurrence-classification-parity.ts`
    review-engine-verification.ts -- NOT a fixture-parity harness (no
                             Python-exported review-session fixture exists
                             to diff against -- see phase-8-findings.md).
                             A 43-check property/behavior suite against
                             DurableReviewEngine, using real candidate/group
                             IDs pulled through the full pipeline: decision
                             persistence and precedence, rename validation,
                             deterministic serialization, reload fidelity,
                             repeated save/load cycles, malformed-save-file
                             rejection, the full Not Quite lifecycle against
                             a real entity group, and cross-engine
                             determinism. Run with:
                             `node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/review-engine-verification.ts`
    focus-navigator-verification.ts -- NOT a fixture-parity harness (no
                             Python-exported focus-state fixture exists to
                             diff against -- see phase-9-findings.md). A
                             96-check property/behavior suite against
                             DeterministicFocusNavigator, using real
                             candidate/group IDs pulled through the full
                             pipeline plus a real DurableReviewEngine:
                             initial-focus determinism, traversal and
                             boundary clamping, unresolved-only traversal,
                             stage transitions, focus reconciliation after
                             each decision kind, the full Not Quite
                             lifecycle (open/navigate/complete, and a
                             separate cancel scenario) against a real
                             entity group, focus recovery from a stale
                             active item, all-complete stage status,
                             command-namespace resolution across every
                             context, the resume-position lifecycle,
                             deterministic focus after a ReviewSession
                             save/load cycle, and property-style checks
                             (round-trip traversal, bounded termination,
                             target validity, unresolved reachability,
                             idempotent reconciliation). Run with:
                             `node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/focus-navigator-verification.ts`
    workspace-integration.ts -- NEW, Phase 10. NOT a fixture-parity harness
                             (no Python "workspace" module exists to port --
                             see phase-10-findings.md). A 65-check
                             end-to-end integration suite: real fixtures
                             through ReviewWorkspace/WorkspaceCommandDispatcher's
                             OWN command surface only (never reaching into
                             engine internals) -- load, review ambiguity/
                             groups/items, full Not Quite lifecycle with
                             automatic focus reconciliation, Escape-to-exit
                             routed end-to-end through the keyboard
                             resolver, review-complete + export-readiness
                             gating, verification staleness invalidation
                             with no explicit invalidation call anywhere in
                             the test, save -> full reload into a BRAND NEW
                             Workspace/dispatcher with exact state equality,
                             wrong-document restore rejection, and resuming
                             an in-progress Not Quite transaction across a
                             reload. Run with:
                             `node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/workspace-integration.ts`
    audit-exporter-verification.ts -- NEW, Phase 11. NOT a fixture-parity
                             harness (no stable Python audit-export
                             contract exists to diff against -- Python's own
                             CSV/QA-metrics/decisions writers have
                             negligible test coverage -- see
                             phase-11-findings.md). A 63-check property/
                             behavior suite against DeterministicAuditExporter:
                             determinism (identical state -> identical
                             substantive output), ordering stability,
                             complete decision representation (Keep/Rename/
                             Redact/Ignore/Undecided), a Not-Quite-refined
                             entity group, unresolved-state handling,
                             verification warnings/blockers, output-identity
                             hashing + rebuild determinism, save/reload
                             equivalence, wrong-document/wrong-session
                             protection, schema-version validation, and
                             absence of unnecessary source content. Run
                             with:
                             `node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/audit-exporter-verification.ts`
    ui-smoke.ts           -- NEW, Phase 10. A bounded, honestly-scoped sanity
                             check for src/ui/app.ts against a minimal fake
                             DOM (this sandbox has no GUI browser or
                             browser-automation tool -- see
                             phase-10-findings.md's disclosed limitation):
                             confirms a real `tsc` emit (`npm run build`)
                             produces dist/ui/app.js, and that importing it
                             completes initial ("no document loaded")
                             render without throwing. Requires `npm run
                             build` first. Run with:
                             `node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/ui-smoke.ts`
    group-bulk-actions-verification.ts -- Feature 001, expanded same-day for
                             the terminology revision. 94 checks against the
                             real ReviewWorkspace/WorkspaceCommandDispatcher:
                             Keep as-is/Redact/Ignore/Rename Group in
                             isolation, Flatten Group +
                             generateOutput() (regression coverage for the
                             rebuild.ts infinite-loop fix and the
                             OutputVerifier.ts explainability fix), bulk
                             after partial individual review, a mixed
                             bulk-then-Not-Quite workflow, guard-clause
                             rejection/allowance, focus reconciliation,
                             unresolved-count updates, export readiness,
                             save/reload equivalence, and audit
                             representation. Run with:
                             `node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/group-bulk-actions-verification.ts`
    decision-reuse-verification.ts -- NEW, Feature 002. 117 checks in two
                             parts: Part 1 calls DeterministicDecisionReuseEngine.
                             proposeReuse() directly against a real fixture's
                             detection/grouping (engine-level, same precedent
                             as review-engine-verification.ts) to hit exact
                             tier boundaries -- Tier 1 exact-key, Tier 2
                             grouped-alias agreement + a hand-built conflict
                             case, Tier 3 above/below/cross-type/ambiguous-tie
                             similarity cases, computed against the real
                             sequenceRatio(). Part 2 exercises the real
                             ReviewWorkspace/WorkspaceCommandDispatcher stack
                             via document.importDecisions with a REAL
                             decisions.json (produced by fully reviewing a
                             prior session through generateAudit(), not
                             hand-crafted): identical-document reuse,
                             reviewer override of an imported decision, the
                             never-overwrite-existing-decision rule,
                             malformed/wrong-schema-version file rejection,
                             no-document-loaded rejection, a zero-match
                             import, save/reload equivalence, the audit's
                             three-way reviewer/imported/overridden-import
                             distinction, and output generation from an
                             entirely import-derived session. Run with:
                             `node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/decision-reuse-verification.ts`
    ts-loader.mjs         -- Node module-resolution hook so `.js`-suffixed
                             import specifiers in src/ (the bundler
                             convention) resolve to sibling `.ts` files when
                             run directly under Node for verification
  fixtures/
    schema/         -- fixture-manifest.schema.json (JSON Schema for fixture
                       files) and versioning notes
    domain-parity/  -- Domain Parity Fixtures (§13.1 of the architecture doc)
    interaction/    -- Interaction Fixtures (§13.2)
    performance/    -- Performance Fixtures (§13.3)
  scripts/
    export_fixtures.py           -- read-only exporter that imports the existing
                                     Python redactor modules and writes their
                                     output as JSON fixtures. Does not modify
                                     anything under work/pii_docx_redactor.
    ooxml_structural_spike.py    -- read-only structural analysis of real .docx
                                     files (run-splitting, field codes, drawing
                                     objects, etc.)
    build_structural_fixtures.py -- builds synthetic fixtures that deliberately
                                     reproduce the structural patterns the spike
                                     above found. Both this script and
                                     export_fixtures.py now `os.chdir` into
                                     the Python app's own directory before
                                     importing it -- redactor/
                                     candidate_quality.py resolves its lexicon
                                     directories via Path.cwd(), and running
                                     these scripts from DocScrub-Web/ (as
                                     documented below) silently loaded a
                                     degraded, mostly-empty lexicon for every
                                     fixture ever generated until Phase 5
                                     found and fixed this -- see
                                     docs/detection/phase-5-findings.md
    generate_quality_dictionaries.py -- regenerates
                                     src/engines/quality/quality-dictionaries.data.ts
                                     from the live Python candidate_quality
                                     module (see that script's own header for
                                     invocation)
    build_entity_resolution_fixtures.py -- builds the entity-resolution-001
                                     fixture (Phase 6), deliberately
                                     exercising variant-name grouping,
                                     ambiguity between same-first-name
                                     people, a must-not-merge pair, a
                                     title-prefix grouping quirk, and a
                                     singleton
  spike/
    SUPERSEDED.md   -- retired as of Phase 3; maps each spike file to its
                       production replacement in src/io/. Kept unmodified
                       as the historical record phase-2-findings.md cites,
                       but no longer the active implementation.
  docs/
    ooxml-spike/    -- findings.md (Phase 1 structural spike),
                       phase-2-findings.md (Phase 2 parser/rebuilder spike,
                       now including a "Phase 3" section for the production
                       port), and construct-support-matrix.md (consolidated
                       Supported/Warning/Read-only/Unsupported
                       classification across all 12 fixture cases)
    detection/      -- phase-4-findings.md: the DetectionEngine port
                       record -- what Python's oracle actually is, what was
                       ported, fixture-parity results, and every documented
                       deviation. phase-5-findings.md: the
                       CandidateQualityEngine port record, including the
                       fixture lexicon-loading bug found and fixed this
                       pass. phase-6-findings.md: the EntityResolutionEngine
                       port record, including the confirmed scoping finding
                       that most "variant matching" is actually detection's
                       job, and the title-prefix grouping quirk.
                       phase-7-findings.md: the OccurrenceClassifier port
                       record -- the additive ReviewOccurrence/
                       StructuredContext enrichment layer, the explicit
                       document-order sort (and proof it's non-trivial),
                       and a fixture-manifest data-loss bug found and fixed
                       via "re-run all prior verification suites." Gate B
                       (Domain Parity) is closed as of this phase.
                       phase-8-findings.md: the ReviewEngine (durable
                       review state) port record -- why this phase has no
                       fixture-parity harness, two oracle-corrected
                       assumptions about Not Quite behavior found by
                       reading Python's own test suite directly, what was
                       deliberately not ported (Decision.REVIEW/per-
                       occurrence decisions, confirmed dead in the actual
                       product UI; entity-group bulk actions, deferred to
                       Phase 9/10), and the versioned-persistence
                       improvement over Python's unversioned save format.
                       phase-9-findings.md: the FocusNavigator (interaction/
                       focus) port record -- why this phase also has no
                       fixture-parity harness, the faithful port of
                       redactor/review_queue.py, the five-stage model and
                       the confirmed Item Check fold, what was deliberately
                       not ported (2D grid arrow movement, entity-group
                       bulk actions, presentation-only context toggles),
                       four interface corrections (NavigationCommand,
                       FocusNavigator's own interface, CommandDispatcher's
                       dispatchNavigation return type, NotQuite's
                       MemberAction gaining "Ignore" -- plus the keymap bug
                       that gap uncovered), the documented bidirectional
                       findUnresolved() extension, the transient/durable
                       Not Quite active-member split, and the optional
                       FocusResumePosition model.
                       phase-10-findings.md: the Workspace/CommandDispatcher
                       integration record -- why this phase also has no
                       fixture-parity harness, the pipeline orchestration
                       Workspace performs (and the one arithmetic step it
                       owns: exportEnabled), the derived (never tracked)
                       verification-staleness rule, the documentId-gated
                       session-restore rule, the honest history.* rejection,
                       the CommandDispatcher structural move from
                       src/engines/ to src/workspace/, the WorkspaceState
                       gap found and fixed while building the UI (pipeline
                       outputs were missing), the thin UI's disclosed
                       not-click-tested-in-a-real-browser limitation, and an
                       open judgment call surfaced for Andrew about whether
                       Gate C's literal "Interaction Fixture" criterion is
                       satisfied by the property/behavior-suite pattern.
                       phase-10.1-findings.md: the real browser-validation
                       record. First attempt stalled on a `computer-use`
                       desktop-access grant timing out twice; Andrew then
                       started `npm run serve` himself, unblocking a full
                       real-Chrome click-through -- document loading
                       (success and failure), the full pipeline, keyboard
                       commands, all four decision kinds, the complete Not
                       Quite lifecycle (entry/member actions/completion/
                       cancellation), save/resume including wrong-document
                       rejection, verification staleness, export gating,
                       and audit-record generation. Zero defects found; zero
                       code changes made. Also notes a session-local
                       `computer` tool input-delivery quirk (isolated via
                       direct DOM/KeyboardEvent testing, confirmed NOT an
                       application defect). Gate C's Phase 10 addendum
                       judgment call was resolved earlier in this same
                       combined instruction -- see the acceptance-criteria
                       doc's own Gate C update.
                       phase-11-findings.md: the AuditExporter port record
                       -- the Python oracle research (three export
                       artifacts, two confirmed content-leak behaviors NOT
                       replicated, unconditional-export behavior kept), the
                       canonical AuditRecord schema and its explicit design
                       decisions, the document/detection-first interface
                       correction, a real ReviewSession.processingRevisions
                       wiring gap found and fixed while integrating (not
                       designing), wrong-document/wrong-session protection,
                       and the 63-check verification suite. Gate D (Output
                       and Audit Parity) is closed as of this phase.
                       phase-12-findings.md: the Gate E side-by-side
                       acceptance record -- methodology, the full 13-fixture
                       corpus, every deviation documented across Phases 3-11
                       reclassified under Andrew's five-category A-E scheme
                       (zero Category D, zero Category E findings), the
                       fixture-by-fixture acceptance matrix, and the flagged
                       entity-group-bulk-actions scope gap surfaced for an
                       explicit decision rather than resolved unilaterally.
                       Gates A-E are all complete as of this phase.
                       feature-001-group-bulk-actions.md: the first
                       post-migration feature -- Confirm/Reject/Flatten
                       Group, closing Gate E's flagged scope gap. Design
                       rationale, exact command semantics, why ReviewEngine
                       owns the behavior with zero CommandDispatcher/
                       Workspace changes required, two real pre-existing
                       defects found and fixed during browser validation
                       (an infinite loop in rebuild.ts, a silent
                       verification-failure state in OutputVerifier.ts), an
                       open product question for Andrew (should a Rename to
                       identical text count as a verification failure), the
                       83-check verification suite, and the real browser
                       validation record.
    feature-002-decision-reuse.md -- Feature 002's own findings doc: design
                       rationale, the three deterministic matching tiers
                       (exact-key/grouped-alias/similarity-threshold) and
                       why each threshold/margin value was chosen, why
                       DecisionReuseEngine is a new stateless engine rather
                       than logic inside ReviewEngine, the never-overwrite-
                       existing-decision rule, the reviewer/imported/
                       overridden-import three-way audit distinction, the
                       117-check verification suite, the real browser
                       validation record (including the window.alert()
                       success-dialog defect found and fixed), and
                       intentional scope limitations (no group-level
                       decision replay, no provenance carried across a
                       re-export).
                       milestone-1-review-workspace-phase-1-2.md: the
                       Review Workspace reconstruction's first
                       implementation milestone -- ExplanationEngine's
                       extended ExplanationContext interface (an objective
                       interface defect fix, same category as
                       CandidateQualityEngine's/OccurrenceClassifier's own
                       earlier signature extensions), the
                       CandidateDetailPanel and Category Check UI, the
                       categoryRuleLabel() snake_case/kebab-case
                       normalization fix (a real bug found during browser
                       validation, not introduced by this milestone), the
                       confirmed non-linear stage-tab design (superseding
                       reconstruction gap item 7), the 61-check
                       verification suite, and the real browser validation
                       record (including a disclosed shared-tab collision
                       with Andrew's own concurrent testing).
```

Every type in `src/` is named to match the v0.2 architecture document exactly,
so a reader can go from a component name in the doc straight to its interface
here.

## Environment constraints (read before running anything)

This sandbox has **no npm registry access** (`npm ping` returns `403
Forbidden`, `X-Proxy-Error: blocked-by-allowlist` -- a deliberate policy,
not a transient outage) and no persisted `pytest` install across sessions.
As of Phase 3, this constraint is less limiting than it was in Phase 1/2:

- `tsc` (real TypeScript 5.9.3, installed by `npm install` on Andrew's
  machine and synced back into this mounted folder) is available and
  passes with zero errors across all of `src/`, including `src/io/ooxml/`.
- **No npm-installed OOXML/ZIP library was ever actually needed.**
  `CompressionStream`/`DecompressionStream` with format `"deflate-raw"` --
  the real target Web API `src/io/ooxml/zip.ts` uses -- are themselves
  Node 22 globals (confirmed directly: `typeof CompressionStream ===
  "function"`, no import). `src/io/` is therefore genuinely production
  code today, verified under Node's implementation of the same
  standardized API the browser build will use, not a stand-in for it. What
  Gate A still needs is running this same code in an actual browser tab
  (Chrome/Firefox/Safari), not an npm package.
- `pytest` is not installed in this particular session, so the Python
  suite could not be re-run as part of this pass (`work/pii_docx_redactor/`
  was not modified regardless). `pytest.ini` already exists from an
  earlier pass; re-verify with `pytest` on a machine that has it before
  treating any pass as fully validated end to end.
- **The UI HAS now been click-tested in a real browser (Phase 10.1,
  2026-07-28).** This sandbox's own shell still can't reach a server
  started inside it from the user's real Chrome (confirmed empirically --
  a different machine, network-wise), but once Andrew ran `npm run build &&
  npm run serve` himself, a full real-Chrome click-through against
  `http://localhost:8000/index.html` found zero defects across document
  loading (success and failure), the full pipeline, keyboard commands, all
  four decision kinds, the complete Not Quite lifecycle, save/resume
  including wrong-document rejection, verification staleness, export
  gating, and audit-record generation. See docs/detection/
  phase-10.1-findings.md for the full record. A double-click launch script
  (`start-server.command`, at the repo root) remains available for a
  future session that has `computer-use` desktop access but not Andrew
  directly at the keyboard.

To reproduce the full verification battery on a normal machine:

```
cd DocScrub-Web
npm install
npm run typecheck
node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/production-parity.ts
node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/detection-parity.ts
node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/quality-parity.ts
node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/entity-resolution-parity.ts
node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/occurrence-classification-parity.ts
node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/sequence-ratio-smoke.ts
node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/scoring-smoke.ts
node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/review-engine-verification.ts
node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/focus-navigator-verification.ts
node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/workspace-integration.ts
node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/audit-exporter-verification.ts
node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/group-bulk-actions-verification.ts
node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/decision-reuse-verification.ts
node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/explanation-engine-verification.ts
node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/milestone-2-review-at-scale-verification.ts
npm run build
node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/ui-smoke.ts
npm run serve   # then open http://localhost:8000/index.html and click through by hand
# or: double-click start-server.command in Finder (does the build + serve for you)
cd ../work/pii_docx_redactor
pip install -r requirements.txt pytest
pytest
```
