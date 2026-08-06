# Glossary

Status: canonical
Last updated: 2026-08-02

How to read this document: the authoritative vocabulary for DocScrub.
Where the durable (stored) vocabulary and the reviewer-facing display
vocabulary differ, that split is deliberate and documented here — do not
"fix" it in either direction. Definitions are derived from the current
code and `../architecture/review-workspace-specification.md`, not from
memory. Genuinely unresolved naming questions are collected at the end
under "Open terminology notes" rather than silently decided.

---

## Product names

**DocScrub** — the product: reviewer-driven PII redaction of Word
documents. **DocScrub-Web** — this browser-local TypeScript
implementation (`app/`), the production reference implementation since
Gate E. **The Python oracle** — the original Python implementation at
`work/pii_docx_redactor/`, kept as the behavioral reference the migration
was verified against; not fixed or extended (per Andrew's standing
instruction, deviations land in DocScrub-Web, not Python).

## Core domain terms

**Document** — the loaded `.docx`, parsed by `DocumentParser` into a
`DocumentModel` (paragraphs/runs, headers/footers, comments, hyperlink
relationships). Identified by a `documentId` content hash; save/resume is
gated on it (wrong-document restore is rejected).

**Extraction** — pulling reviewable text out of the parsed OOXML
(`src/io/ooxml/document-text.ts`) so detection can run over it. Distinct
from detection itself.

**Candidate** — one detected span of possible PII, the unit a reviewer
decides on. Carries its detected text, entity type, evidence, quality
score, and recommendation. Durable identity is the candidate key/id used
by decisions, focus, and Decision Reuse.

**Occurrence** — one concrete appearance of a candidate's text at a
location in the document. Candidates aggregate occurrences; the
occurrence classifier (`src/engines/occurrence-classifier/`) groups and
orders them in document reading order for the occurrence browser.

**Entity** — the real-world person or thing candidates refer to.
`EntityId` is opaque; an entity's disposition is expressed through
decisions on its candidates/groups.

**Group (entity group)** — the entity-resolution engine's proposal that
several candidates (variant spellings, title prefixes, partial names) are
the same entity, with a computed confidence and reasons. Reviewed in
Group Check.

**Ambiguity** — a proposed possible-identity link between a short-form
candidate (for example, a bare first name) and one or more full-name
anchors found in the document. Reviewed in Ambiguity Check; a reviewer
link is recorded via `review.linkAmbiguousCandidate` into
`ambiguityResolutions`. Since the ambiguity anchor correction, ambiguity
evidence comes from every detected full-name entity, including solitary
ones, and nothing is ever auto-merged without the reviewer.

**Evidence** — the structured, categorized reasons behind a candidate's
detection and quality assessment (`src/domain/Evidence.ts`), rendered for
the reviewer by the `ExplanationEngine` (standard / expert / audit
views).

**Recommendation** — the quality engine's advisory classification of a
candidate: `ToReview` or `Unlikely`. Advice only; it never applies a
decision. (The terms "suggested" / "accepted suggestion" are **not** part
of this model — automation in DocScrub recommends and proposes, the
reviewer decides.)

**Review session** — the durable review state (`ReviewSession`): every
decision, the Not Quite sub-state, ambiguity resolutions, and the
append-only review event log; serialized with an explicit
`schemaVersion` and a documented migration ladder.

**Decision** — the durable record of a reviewer's (or an import's)
disposition of a candidate: a kind (below), optional replacement text,
and a source. Decisions are always re-decidable; a fresh decision
replaces the old one.

**Verification** — `OutputVerifier`'s check of a rebuilt output document,
producing pass/fail plus explained fidelity findings. **Stale
verification** — a verification whose inputs have changed (any review
command after `generateOutput`); staleness is *derived fresh on every
read*, never a stored flag.

**Audit record** — the canonical `AuditRecord` schema every export
projection (audit report, redaction log CSV, decisions.json, QA metrics)
derives from. Deliberately excludes raw candidate text.

## Decision vocabulary

The **durable vocabulary** — what commands, saved sessions, audit CSVs,
and decisions.json carry — is `CandidateDecisionKind`:

**Keep** · **Rename** · **Redact** · **Ignore**

(plus **Undecided** in audit/import contexts, and **Not Quite** as a
durable group sub-state, below).

The **display vocabulary** — what the reviewer reads — is defined in
exactly one place, `src/ui/decisionLabels.ts` (RX-22):

| Durable kind | Display label | Key |
|---|---|---|
| Keep | Keep | `K` |
| Rename | **Change** | `C` |
| Redact | Redact | `R` |
| Ignore | Ignore | `I` |
| (enter Not Quite) | **Fix this** | `F` |

This split is deliberate and permanent: "Rename" → "Change" and
"Not Quite" → "Fix this" were display/keybinding relabels only
(2026-07-29); the durable vocabulary kept its names for audit-trail and
session-file continuity. Anything the reviewer reads goes through the
label map; anything a file or command carries stays the raw kind.

**Not Quite** — the durable sub-state for refining a proposed group
member-by-member (`src/domain/NotQuite.ts`, ADR-008 revised): per-member
actions Keep / Rename / Redact / Ignore, an explicit
complete-or-cancel transaction, and the one deliberate exception to
"items do not disappear on click." Its reviewer-facing entry button is
labeled **Fix this**.

**Legacy synonyms** (for reading historical records only; not current
display terms): "Rename" and "Not Quite" as button labels (pre
2026-07-29); Feature 001's original group bulk labels "Confirm Group /
Reject Group / Flatten Group" (superseded same-day by the Item Check
vocabulary; `rejectGroup` was removed entirely); Python's "Category
Check" and "Results" as separate stages (folded into Item Check in
DocScrub-Web).

## Stages and workflow terms

**Review workspace** — the whole reviewer environment: one
`ReviewWorkspace` (pipeline orchestration) plus one
`WorkspaceCommandDispatcher` wired into the UI, presenting the stages
below. Deliberately **not a wizard** (the Sock Principle): stages are
horizontal, non-linear tabs.

**Workspace Analysis** — an unrelated, separate feature (Feature 003,
`src/workspace-analysis/`) despite the name collision with "Review
workspace"/`ReviewWorkspace` above. It proposes which imported documents
belong to the same matter, using only document-level evidence, and never
touches a `ReviewWorkspace`, `ReviewSession`, or any review-pipeline
state — the shared English word "workspace" here means "a proposed group
of related documents," never a `ReviewWorkspace` instance. See
`../detection/feature-003-workspace-analysis.md` and
`../architecture/decisions/ADR-019-workspace-analysis-independence.md`.

**Stages** (`WorkflowStage` ids in parentheses):

- **Ambiguity Check** (`ambiguity-check`) — resolve possible-identity
  links.
- **Group Check** (`group-check`) — confirm, refine (Fix this), or
  redirect proposed entity groups; group review happens here.
- **Item Check** (`item-check`) — per-candidate review; item review
  happens here. Folds Python's Category Check + Results; **Category
  Check** survives as the Review State × Category aggregation view
  inside Item Check.
- **QA** (`qa`) — currently a stub stage; its resolution is an open
  backlog item (RX-21). Do not document QA behavior as existing.
- **Output** (`output`) — rebuild, verify, and export: redacted
  document, audit artifacts, decisions.json.

The three review stages are always reachable regardless of completion;
QA/Output availability keys off Item Check completion
(`src/engines/navigation/stages.ts`).

**Candidate detail panel** — the per-candidate expansion (the "expanded
evidence panel"): Explanation → Representative snippets → Possible
identities → Occurrences → Expert View. Expansion is *derived from
focus*, not tracked as separate UI state.

**Focused / active item** — the item the reviewer's cursor is on
(`FocusState.activeItemId`), maintained by the `FocusNavigator` and
reconciled after every decision (`reconcileFocus`). The focused row is
the expanded one.

**Resolved / unresolved / partial** — an item's review status, derived
fresh from (detection, grouping, session) — a candidate is resolved once
it has a decision; a group once its outcome is fully determined; partial
covers a group with some members decided. **Undecided** is the
per-candidate "no decision yet" state (navigation offers "Next
undecided"). Stage completion is **empty / complete / unresolved**.

## Provenance vocabulary

`DecisionProvenance` (`src/ui/decisionProvenance.ts`):

- **reviewer** (reviewer-authored) — decided directly in this session's
  UI.
- **imported** — applied by Decision Reuse from a previously exported
  decisions.json; displayed with the "(Imported)" suffix.
- **imported-then-overridden** (overridden import) — imported at some
  point, since replaced by a direct reviewer decision; displayed as
  "(Modified from import)". Derived from the append-only event log
  (`wasEverImported`), not from the current decision snapshot.

**Detected** — produced by the `DetectionEngine`; every candidate is
detected before it is anything else.

## Decision Reduction vocabulary

Added 2026-08-03. Defined in `src/metrics/decisionReduction.ts`; every
figure in the product comes from that one module.

**Decision unit** — one thing a review surface presents for judgment,
together with the document occurrences that judging it disposes of.
Deliberately *not* "an action the reviewer has taken." Which entity is a
decision unit depends on the surface, and that is the point: a candidate
is the unit in Item Check, Ambiguity Check and Type Check; a **group row**
is a single unit in Group Check, covering every occurrence of every
member. At document scope, every detected candidate is one unit.

**Scope** — the set of decision units a figure is computed over, and the
only thing it is computed over. Global scope is the document; local scopes
are the review surfaces (a section, a tier, a type, the visible list, the
current selection).

**Covered occurrences** — the deduplicated union of the occurrences the
units in a scope cover. An occurrence covered by two units counts once: it
is one place in the document and would have been read once.

**Decision Tracker** — the panel in the review-status strip carrying the
metric: **Made / Avoided / Fewer**. It measures review *effort*, not
review *progress* — which is what distinguishes it from Extraction /
Review / Overall beside it. Purely presentational: its three figures are
three fields of one Decision Reduction result over the resolved scope.

**Made** — **human decisions** the reviewer has made. "Treat all this way"
is *one* decision even across nine items. Counted by the rule *a decision
counts when it newly resolved at least one candidate that is still
resolved now*, so changing your mind about an item already decided does
not advance it, a group action over partly-decided members counts once,
and a reversed decision takes its gesture with it. Derived from the review
event log against the current resolved set — history-derived, but it
describes the present.

**Avoided** (*repeated decisions avoided*) — covered occurrences minus
Made: every occurrence-level review the reviewer never had to perform,
*including* the items a category action swept up without their being
opened. `Made + Avoided` is exactly the occurrence-by-occurrence reviews
the completed work would otherwise have required.

**Fewer** — Avoided ÷ covered occurrences, as a percent. (Displayed as
"Fewer Decisions" before the Decision Tracker panel gave it a title.)

**Work avoided (time)** — the tracker's fourth figure, and the only
**estimate** in the product. Avoided decision *units* × the reviewer's own
observed pace on individual per-item decisions, rendered one-decimal in the
largest sensible unit ("3.4 days of work avoided"). Deliberately low: it
prices only the items themselves, never their repeated occurrences, and
ignores the discovery cost DocScrub removes entirely. Suppressed until at
least three individual decisions have been observed. Distinguished from the
exact counts by its layout, and explained on demand via the "i" control —
the claim is meant to survive a skeptic.

**Observed pace** — mean seconds between consecutive *individual* per-item
decisions. Bulk, group and imported decisions are excluded: one keystroke
over forty items says nothing about how long one decision takes. Gaps over
two minutes are discarded rather than capped, since capping would drag the
mean upward and inflate the estimate.

**Floor** — the unit-based reduction over every detected candidate: what
this document avoids if reviewed item by item. Because working by category
lowers Made, Avoided rises *above* this figure — so it is a worst case,
not a target. (It was framed as a *ceiling* while Made counted units.)

**Running tally** — the global figures are computed over the units
resolved *so far*, so they start at zero, only climb, and land exactly on
the document's full reduction at completion. Local equations are computed
over what *remains* on their surface, and disappear once it is finished.

**Decision Reduction** — the underlying model: decision units, covered
occurrences, and the reduction between them. It is what every **local
equation** (`23 / 418 = 395 decisions avoided`) reports, and what supplies
the Decision Tracker's occurrence coverage. Note the two use the word
*avoided* against different denominators — locally against decision units
(a prospective scope has no human decisions in it yet), globally against
Made. The panel title carries the distinction.

Distinct from **Decision Reuse**, which answers how many of a document's
required decisions prior work already resolved. A reused decision is still
a decision unit; importing a prior review counts as **one** decision made,
because it was one gesture. The two concepts are never combined.

## Document-status vocabulary

Defined in `../standards/documentation-standards.md`: **canonical**,
**historical**, **working** (document classes); **superseded**,
**retired** (end-of-life states); `[BUILT]`, `[DESIGNED]`,
`[SPECULATIVE]` (claim-level maturity markers).

## Open terminology notes

Genuine unresolved naming questions — flagged, not silently decided:

1. **"Keep as-is" vs. "Keep."** `src/ui/decisionLabels.ts` (the single display
   vocabulary, RX-22) maps Keep → "Keep", and Item Check's button says
   "Keep" — but Group Check's command-bar legend still reads "K Keep
   as-is" (`app.ts:3740`) and several comments use "Keep as-is." Either
   the legend is a residual RX-22 leak site or group-level phrasing is
   intentionally different; the repository does not currently say which.
2. **The QA stage.** Its name, purpose, and continued existence are
   explicitly open (backlog RX-21: "Resolve the QA stage stub").
3. **"DocScrub" vs. "DocScrub-Web" in reviewer-facing surfaces.** The app
   header shows the DocScrub logo; the repository and docs say
   DocScrub-Web. Fine internally; a deliberate user-facing choice has
   not been recorded.
