# Milestone 1 — Review Workspace: Phase 1 (Explainability) + Phase 2 (Category Check)

Implements the first two phases of `docs/architecture/review-workspace-reconstruction.md`'s
roadmap against Andrew's Milestone 1 instruction ("transform the current thin
integration UI into the mature reviewer workspace described in the
specification"). No redesign: every panel, keyboard behavior, and evidence
presentation follows that specification directly, with one explicit,
Andrew-confirmed deviation (horizontal, non-linear stage tabs — see
"Design decisions" below).

## What was implemented

**ExplanationEngine** (`src/engines/ExplanationEngine.ts`,
`src/engines/explanation/explanation-builder.ts`,
`src/engines/explanation/explanation-dictionary.data.ts`) goes from a
signature-only stub to a real, direct port of
`redactor/explanations.py`: the ~50-entry `EXPLANATION_DICTIONARY`
(short/standard/expert text per evidence rule), the four-band confidence
opener ("We believe this is…" / "This is likely…" / "This may be…" / "This
is unlikely to be…"), Oxford-comma phrase joining, and all three of
Python's output views — `standard` (one-sentence summary), `expert`
(structured positive/negative/neutral evidence with weights, diagnostic
categories, raw scoring explanation), and `audit` (plain-text evidence
phrases for the audit narrative, no numeric weights — ready for
`AuditExporter` to consume in a future phase, not yet wired there).

**CandidateDetailPanel** (`src/ui/app.ts`) — an expandable per-candidate
panel matching the specification's exact ordering: likelihood/type/
recommendation badges, the Standard View summary sentence, representative
context snippets, a collapsible occurrence browser (grouped into blocks via
a new `groupReviewOccurrencesForCandidate()` helper on
`OccurrenceClassifier.ts`), and a collapsible Expert View. Opens via a
"Detail (d)" button (mouse discoverability) or the D/./Space keys
(keyboard, matching Python's shortcut and the specification's documented
interaction model) when a candidate has keyboard focus in Ambiguity Check
or Item Check.

**Category Check** (`src/ui/app.ts`,
`src/engines/quality/category-rule-labels.data.ts`) — a "List / By
Category" toggle inside Item Check. By Category shows a two-axis
drill-down (Review State: Total/To Review/Unlikely/Resolved, then Category:
evidence-rule counts within that state), narrowing the same candidate list
Item Check already renders — no new domain state, no second way of
rendering a candidate, matching the specification's finding that Category
Check is a presentation-only aggregation over Item Check's existing pool.

## Architectural decisions

1. **ExplanationEngine's interface signature was extended, not redesigned.**
   The architecture doc's own §12 stub (`explain(evidence: Evidence[],
   view): Explanation`) cannot produce Python's actual output — the
   confidence opener needs `entityType`/`likelihood`, neither of which
   lives on an `Evidence` item. `explain()` now takes an `ExplanationContext`
   (evidence plus the surrounding candidate facts) instead of a bare
   `Evidence[]`. This is the same category of fix already established by
   `CandidateQualityEngine`'s `DocumentModel` parameter and
   `OccurrenceClassifier`'s four-parameter `classify()` — an objective
   interface defect, not a scope change. `ExplanationEngine` remains
   stateless, synchronous, and still never invents evidence beyond what its
   context carries.
2. **`ExplanationView` gained a third value, `"audit"`,** matching Python's
   `explanation_payload()` exactly (it always produces `standard`/`expert`/
   `audit` together). Not yet consumed by `AuditExporter` — flagged as
   follow-up, not silently dropped.
3. **Category Check needed no new `FocusNavigator` stage or `ReviewEngine`
   command.** Its state (`itemCheckViewMode`, `categoryReviewState`,
   `categoryFilter`) lives entirely as ephemeral UI state in `app.ts`,
   exactly like `expandedCandidateIds` — architecture v0.2 §7.3's "expanded
   panels… may be lost or reset without corrupting review decisions."
4. **A real, confirmed bug was found and fixed during browser validation,
   not just unit testing:** Expert View's "Diagnostic Categories" initially
   rendered `Product_system_name` instead of `Product / system name`.
   Root cause: `Evidence.category` is kebab-cased by
   `CandidateQualityEngine` (`item.rule.replace(/_/g, "-")`), but
   `CandidateQualityAssessment.reasons`/`filterRules` (a separate
   representation of the same rule vocabulary, sourced from
   `scoring.ts`'s `ScoredQuality`) were never run through that conversion
   and remain in Python's original snake_case. Fixed by normalizing
   snake_case → kebab-case inside `categoryRuleLabel()` itself (one point
   of truth for "however this rule id is spelled, show the reviewer the
   same label"), with a regression check added to the verification suite.
   This is a genuine, pre-existing inconsistency between two representations
   of the rule vocabulary already in the codebase — not introduced by this
   milestone, but only surfaced by actually rendering both representations
   together for the first time.
5. **Horizontal stage tabs are confirmed, not superseded.** Andrew reviewed
   the reconstruction document's gap item 7 directly (mid-implementation)
   and confirmed the current tab bar — non-linear workspace tabs a reviewer
   may switch between freely at any time, not wizard steps — is the
   intended design, adapting "Completion Beats Movement" (v0.2 §4.4) to a
   modern browser workspace rather than porting Python's single-scrolling-
   collapsible-page layout literally. `docs/architecture/
   review-workspace-reconstruction.md` §2 item 7 has been updated in place
   to record this as superseded rather than silently left stale. No code
   change was needed — `app.ts`'s `renderStageTabs` already never disables
   or gates a tab on another stage's completion; only its "Not yet
   available" tooltip wording was softened to avoid implying restriction.

## Verification results

`verify/explanation-engine-verification.ts` (new, 61 checks): entity-phrase
mapping, all four confidence-opener bands including the exact boundary
(94 vs. 95), Oxford-comma joining for 0/1/2/3+ items, dictionary lookup vs.
fallback-text behavior, all five branches of `buildStandardSummary`
(positive-only / negative-only / both / neutral-only / none-recorded) plus
the "first 3 phrases only" truncation, disposition derivation (with and
without an existing decision), `diagnosticCategories`' `filterRules`-over-
`reasons` preference, all three `explain()` view shapes (verifying
`standard`/`expert`/`audit` never invent evidence beyond what the context
carries), `groupReviewOccurrencesForCandidate`'s per-candidate filtering and
bucket ordering, and `categoryRuleLabel`'s dictionary/fallback/
snake_case-normalization behavior (the last two checks lock in the bug
found during browser validation).

Full regression battery re-run after every change, zero regressions
throughout: `production-parity` 14/14, `detection-parity` 12/12,
`quality-parity` 12/12, `entity-resolution-parity` 13/13,
`occurrence-classification-parity` 13/13, `review-engine-verification`
43/43, `focus-navigator-verification` 99/99, `workspace-integration` 65/65,
`audit-exporter-verification` 63/63, `group-bulk-actions-verification`
83/83, `decision-reuse-verification` 117/117, `explanation-engine-
verification` 61/61, `ui-smoke` 4/4. `tsc --noEmit` and `tsc` (full build)
both clean throughout.

## Browser validation

Real click-through via Claude in Chrome against `synthetic-transcript-001`'s
fixture DOCX (10 candidates, no proposed groups — a good exercise of Item
Check/Category Check specifically). Confirmed: badges render with correct
color banding (44% shown in caution red, 87%/99% in green); the Standard
View summary correctly branches on evidence polarity ("This is unlikely to
be a person's name because it follows a strong personal-name pattern, but
it appears only once in the document and it matches product or system
vocabulary" — three real evidence phrases, positive-then-negative,
Oxford-comma joined correctly); the occurrence browser groups into
"Occurrences in message text" exactly matching `OccurrenceClassifier`'s own
`GROUP_LABELS`; Expert View shows likelihood/recommendation/disposition/
type/detector plus signed evidence weights (`+35 Strong personal-name
structure`, `-4 Single occurrence`, `-22 Product / system name`); Category
Check's state/category chips show live counts (Total 10, To Review 9,
Unlikely 1, Resolved 0 before any decision), clicking a category chip
narrows the candidate list correctly (isolated exactly the one candidate
carrying that evidence), and making a decision from within a filtered
category view updates Item Check's count, Category Check's Resolved count,
and removes the now-resolved candidate from the "To Review" state's
category list — all in one consistent re-render, confirming Category Check
and `ReviewEngine` interact correctly through the existing dispatch path
with no parallel state.

One incident during validation, disclosed for completeness: partway
through, the shared browser tab began showing a real, unrelated document
Andrew was concurrently testing with (a shared-tab collision, not caused by
this milestone's code). Recognized immediately from the mismatched
filename and candidate content; no buttons were clicked on that document,
and remaining validation moved to an isolated new tab. Andrew confirmed
separately this was his own concurrent testing, not a data-handling defect.

## Remaining work for the next milestone

Per the reconstruction document's roadmap, still open: `ReplacementRuleEngine`
(Critical — the one item requiring genuinely new domain logic, not UI atop
existing state), search/filter/sort/pagination and bulk multi-select for
Item Check, the context-sensitive `CommandBar`, `LocalSessionRepository`
(IndexedDB autosave), and the visual/interaction polish batch (Not Quite
styling, decision-state coloring, success-path toast). `AuditExporter` does
not yet consume ExplanationEngine's new `audit` view — a natural, small
follow-up now that the view exists. `docs/architecture/
review-workspace-reconstruction.md` remains the authoritative source for
sequencing this work; its §2 gap list and §3 roadmap are otherwise
unchanged by this milestone except for item 7 (superseded, see above).
