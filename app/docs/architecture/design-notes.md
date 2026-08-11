# Design notes

A running log of what each on-page version corresponds to. The version
label shown next to the DocScrub logo in the app header
(`src/ui/version.ts`'s `APP_VERSION`) is bumped by hand alongside a new
entry here, every time a change is visible in the UI -- so opening this
page tells you exactly what changed since the version you last saw,
without digging through commit history or the fuller `docs/detection/`
findings docs (which remain the detailed record for *why*; this file is
the short, dated *what*).

Purely internal engine/domain changes with no visible UI effect don't get
a version bump or an entry here -- see version.ts's own doc comment.

Format: newest entry first. One line per version -- a sentence or two, not
a full findings doc; link to the relevant `docs/detection/*.md` for detail.

---

**v2026-08-10.01** -- Preliminary local-AI semantic evidence prototype.
When explicitly enabled against a localhost model endpoint, Item Check can
show a small accessible `AI` provenance badge and use strong,
non-conflicting local-AI semantic evidence to route ambiguous People
residue into the existing term sections. The reviewer still makes every
decision; `__docscrub.aiPeople()` reports the benchmark details. See
`docs/detection/local-ai-semantic-evidence-prototype.md`.

**v2026-08-08.09** -- Proposal-only category shortcuts now recover from
focus-pane / parked-domain-cursor drift. Section-scope shortcuts use the
last rendered sectioned stage as their UI fallback, and group-scope
`Opt`/`Alt+C/R` rehydrates the active proposal id from the focused
`data-proposal-id` card before resolving the visible category action. This
keeps Numeric-style proposal categories answering the `Redact all` keycap
and keeps `Opt`/`Alt` category arrows moving the category the reviewer is
actually looking at.

**v2026-08-08.08** -- Single-item category completion now gets the same fast feedback grammar as bulk completion: the decided item pulses, the completed category or active Review Zone pulses green, and only then does the existing advance move on. Zone-scoped section actions also pulse when they complete the painted Zone even if the category still has more work.

**v2026-08-08.07** -- Bulk review actions now reuse the existing decision-colored acknowledgement pulse for exactly the items whose visible decision changed. When a section action completes a category, the category heading and section pill briefly pulse green before the existing section-advance path moves to the next incomplete work.

**v2026-08-08.06** -- Section-scope shortcuts now resolve proposal-only
categories from the rendered sectioned queue when the domain row cursor is
parked elsewhere. This restores `Opt`+arrow section movement and
`Opt+C`/`Opt+R` structural-group actions on Numeric-style categories, and
lets those action chords run even while focus is in the sticky chrome.

**v2026-08-08.05** -- Refresh restore now saves and restores the visible
sectioned-queue category and proposal-card cursor. Ambiguity/triage
proposal-only categories could previously reload on a stale candidate
cursor from another category because the UI snapshot carried stage/item
state but not the rendered category/card selection.

**v2026-08-08.04** -- Decision-tinted triage rows now fill with the action
color instead of showing only a colored border. The alternating row-color
rules were more specific than the generic `.decision-tinted` surface, so
handled proposal rows could keep a grey/white fill. Triage rows now restate
the same shared decision tint at row-level specificity.

**v2026-08-08.03** -- Compact relationship proposal rows now show handled
state using the unified decision color system. The row derives the proposal
summary from its member decisions, applies the dominant action's
`decisionClass(...)`, and uses the shared `.decision-tinted` surface, so
the right-side proposal list colors match the action colors already used
by candidate rows, group rows, type rows, and the full proposal card.

**v2026-08-08.02** -- Proposal-grid arrow movement now preserves proposal
ids as proposal targets. Numeric and other proposal-only categories had
punctuated proposal ids; a global string escape made the "is this target a
proposal?" lookup fail, so Down could hand a proposal id to the candidate
cursor and jump back to a stale category. The lookup now uses the app's CSS
attribute escape helper and keeps the card cursor active.

**v2026-08-08.01** -- Ambiguity Check section jumps and proposal-only
categories now obey the hard Enter/Esc depth model. `Opt`/`Alt` section
navigation returns keyboard focus to Review mode so the next plain arrow
moves the selected review unit, and relationship proposal cards no longer
use Down-arrow to enter inner buttons or checkboxes. Enter enters the
focus pane; Esc exits it; arrows stay movement.

**v2026-08-06.03** -- Local recent documents are now account-aware and
archive-first. A signed-in reviewer sees active local sessions owned by
that account; older pre-account sessions remain on disk but are hidden from
active recents. "Archive" hides a document without deleting local bytes,
"View archived" shows archived sessions, and "Restore" returns one to
active recents. Future Projects/Folders should sit above this same local
session boundary: project metadata may become account/organization metadata,
but source documents, filenames, paths, detected values, replacements,
snippets, and per-item decision content must stay out of Supabase unless a
separate privacy decision changes the model.

**v2026-08-06.02** -- Internal Admin now has a compact Metrics area backed
by privacy-safe Supabase aggregates. DocScrub submits only numeric usage
counts, timestamps, status, export counts, app version, organization id, and
an opaque local usage-session UUID -- never document text, filenames,
detected values, replacements, snippets, local paths, or per-item decision
content. Admin access is separate from organization ownership via
`profiles.is_internal_admin`.

**v2026-08-06.01** -- Account onboarding now starts from the Supabase auth
foundation and uses a minimal wizard: Welcome, Account, Ready. Ready is the
normal end state with a centered "Start using DocScrub" action. Choosing
"Invite others to join your Organization." branches into an inserted
Invite Team step and then a second end state named Complete; while that
branch is active, the original Ready step/pill is hidden, and Back from
Invite Team restores the original three-step path. Invite Team creates
pending organization-member records only; no invitation emails are sent.
Before rollout, add a polished confirmation when Back would discard filled
invite rows. Once pending members are created, the flow must remain
irreversible to Ready because the user completed a different onboarding
branch.

**v2026-08-03.08** -- The time estimate's observed pace becomes a MEDIAN
rather than a mean (AG). Decision times are a tight cluster of a few
seconds with a long right tail of distraction; a mean prices a ninety-
second glance at the inbox as deliberation, and with a small sample two of
those can multiply the figure. On gaps of 5,5,5,5,110,115 the mean is ~41s
and the median is 5s -- an eightfold difference on identical behavior, so
this was the single largest way the estimate could have silently
overstated itself. The two-minute idle ceiling stays as a coarse "walked
away" filter but is no longer the sole outlier defence, and is
deliberately NOT tightened further: with a robust statistic doing the real
work, a tighter cut would discard genuinely slow-but-real decisions.
Explanation text updated to say the pace is the middle value.

**v2026-08-03.07** -- COMMAND CARD loses its section labels (AG). "Current
Review" and "Navigation" were pinned to the card's far left by
`.command-card-label`'s `margin-right: auto` while the keycaps packed
right, so as the shortcut list grew the labels stranded across a widening
empty gutter -- and they carried no information the rows didn't already
state. Removing them lets the card hug the keycaps, which is where its
border belongs. The grouping survives as `aria-label` on each row. Note
the review row's render guard moved from `childNodes.length > 1` to `> 0`:
the old value existed only to discount the always-present label, and would
have silently dropped a row carrying exactly one shortcut. `.command-card-
label` itself is untouched -- Type Check's "Remaining" bulk bar still uses
it.

**v2026-08-03.06** -- DECISION TRACKER gains a fourth figure: an estimate
of the review work avoided, in time. Laid out differently on purpose --
number at the same size as Made/Avoided/Fewer, with a wrapping phrase
beside it ("3.4 · days of work avoided") rather than a stacked one-word
label, because it is the only MODELED number in a panel of exact counts.
Built to understate, deliberately: it multiplies the same avoided
occurrence-level reviews shown in the `Avoided` cell by the reviewer's OWN
observed pace, measured only across consecutive individual per-item
decisions, using the median so short distractions do not inflate the
figure, with idle gaps discarded rather than capped and wall-clock rather
than working-day units. It is absent entirely until there is an honest
basis -- fewer than three observed individual decisions, or nothing
avoided, renders nothing. An "i" control opens a plain-language
explanation beneath the panel naming the measured pace, the arithmetic,
and the direction of the error. See
`20260803-decision-reduction-metrics-findings.md`.

**v2026-08-03.05** -- NORMALIZATION processing step (AG spec, 2026-08-03).
A new pass between Detection and Grouping collapses deterministic
conversational and formatting variants of an already-detected entity into
the single review candidate the reviewer should actually be asked about:
"Thanks Andrew", "Thanks, Andrew", "Hi Andrew", "Good Afternoon Andrew",
"And Thank You Andrew" and "Andrew Are" all become "Andrew". On Andrew's
real transcript, 19 duplicate candidates disappear from Group / Type /
Item Check and 57 occurrences re-home, with no detection change and no
evidence lost. Every original detector span survives verbatim and Expert
View gains a "Normalized from" list naming each one and the tokens
removed. Redaction now edits only the name itself, so output reads
"Thanks, [REDACTED PERSON]" rather than deleting the greeting. See
`docs/detection/normalization.md`.

**v2026-08-03.04** -- DECISION TRACKER, interaction-forward revision (AG
direction). **Made** now counts HUMAN DECISIONS rather than decision units:
"treat all this way" is one decision even across nine items, and **Avoided**
becomes everything the reviewer never had to touch -- including the eight
items a category action swept up. `Made + Avoided = covered occurrences`
still holds, so the panel remains self-consistent. Fixes a real defect in
`.03`: Made incremented when the reviewer merely CHANGED THEIR MIND about an
item already decided. The rule is now "a decision counts when it newly
resolved something still resolved now," derived by walking the review event
log against the current resolved set -- which also makes group actions over
partly-decided members count once, repeated actions count zero, and reversals
drop out. New pure module `src/metrics/decisionTracker.ts` composing the
unchanged shared reduction calculation with the human-effort count; local
equations unchanged. Because working by category now pushes Avoided *above*
the unit-based figure, Workspace Metrics relabels that figure a FLOOR ("at
least N, more if reviewed by category") rather than a target. See
`20260803-decision-reduction-metrics-findings.md`.

**v2026-08-03.03** -- DECISION TRACKER (AG direction), superseding the
same day's `.01` Avoided / Fewer Decisions pair. One titled panel in the
review-status strip -- **Made / Avoided / Fewer** -- answering "how much
have I completed, and how much repetitive work did DocScrub eliminate."
It measures review EFFORT, not review progress, which is why it sits
behind a hairline seam from Extraction/Review/Overall and takes no status
color. Purely a presentation layer: the three figures are the three fields
of ONE `DecisionReduction` result over the resolved scope, so `Made +
Avoided` is exactly the occurrence-by-occurrence reviews the completed
work would have taken, by construction. **Made counts decision UNITS, not
actions** -- a bulk action over forty items advances it by forty -- which
keeps the panel's arithmetic sound and keeps the metric indifferent to
technique. Local equations (`23 / 418 = 395 decisions avoided`) are
unchanged. Also folded the resolved/remaining split into one shared
`partitionCandidatesByResolution` in `engines/review/coverage.ts`, which
the tracker and the Workspace Metrics Consolidation report had begun
expressing separately. See
`20260803-decision-reduction-metrics-findings.md`.

**v2026-08-03.02** -- REVIEW SCOPE, Pass 1 (AG direction, from the
selection-driven-inspector design discussion): Item Check's Triage view
gains a PERMANENT left inspector that always explains the current review
scope -- the focused item's existing detail panel (unchanged, relocated
from the per-section split to a workspace-level 60/40 split), a
reviewer-built selection (summarized by the queue's own sections), or the
whole remaining workload (the zero state, reached with Escape; Enter/↓
return). New pure module `src/ui/reviewScope.ts` (scope model + resolver,
single consumer `currentReviewScope`); decisions dispatched from Item
Check now stamp the active scope into the review event log
(`scope` on candidate-decided/bulk-decided payloads -- history, never
state). While a wider scope is active the focused row parks (dashed
outline, ▷) and item-targeted keys refuse with guidance; section-action
digits keep working. Ambiguity Check untouched. See
`../../../20260803-review-scope-pass-1-findings.md` (repo-parent root,
the current findings-doc convention).

**v2026-08-03.01** -- DECISION REDUCTION METRICS (AG direction): a new
permanent product metric answering "how many distinct decisions does this
document require, compared with judging every detected occurrence
individually." Globally, two compact figures join the review-status strip
after a hairline seam -- **Avoided** (a count) and **Fewer Decisions** (a
percent) -- separated from Extraction/Review/Overall because those rise
with progress while these mean leverage and are high from load. Locally,
the same figure appears as a compact equation, reviewer workload first
(`23 / 418 = 395 decisions avoided`), on Item Check and Ambiguity Check
section and tier headings, Type Check cards and the opened type surface,
the Group Check toolbar, and the Item Check bulk bar (where it follows the
current selection). One shared pure calculation --
`src/metrics/decisionReduction.ts`, scoped over generalized `ReviewUnit`s
rather than candidate ids -- also now backs the Workspace Metrics window's
Consolidation section, which previously counted occurrences itself. The
figures are STABLE: no reviewer decision, bulk action, group action, or
reused decision moves them, by construction. See
`20260803-decision-reduction-metrics-findings.md`.

**v2026-08-02.33** -- DECISION MEMORY (AG direction): decisions now carry
forward across documents automatically, no export/import round trip. A
reviewer who changes "Tanesha Can Collier" to "Tanesha Collier" in one
document gets that same change applied on sight in the next one. Feature
002 already did the hard part -- `DeterministicDecisionReuseEngine`,
including the reviewer's replacement text -- so this adds only the missing
state: `domain/DecisionMemory.ts`, a small independently-versioned sibling
artifact (FocusResumePosition precedent) projecting each session's decided
candidates, stored in its own IndexedDB object store (DB v2 -> v3) rather
than on SessionRecord, because a SessionRecord carries the document bytes
and this is read on every load. NO RULE INFERENCE: nothing tries to learn
what an edit MEANT -- AG's own point was that the stray word was incidental
and future edits won't share a shape -- so only the literal outcome is
stored, keyed by candidate key. Automatic application is restricted to the
EXACT-KEY tier; grouped-alias and similarity-threshold each involve a
judgement that one string stands for another, and those stay behind the
explicit file import the reviewer opted into. That restriction is what
makes this defensible without the system needing any theory, and it is
pinned by a test asserting a merely-similar key does NOT carry over.
Carried-over decisions land through the same `applyDecisionReuse` command
as a file import, so they are stamped `source: "imported"` with evidence,
never overwrite existing work, are skipped entirely for a restored session,
and are announced in the import-summary banner in plain language. Deleting
a document forgets what it taught. Covered by
`verify/decision-memory-verification.ts` (30 checks). NOTE for the eventual
user-level profile: candidate keys are normalized document text, so this
artifact is `content-derived-never-sync` under ADR-018 §7.4 -- making it
cross-machine is a policy decision about moving content-derived data
off-device, not just a change of storage key.

**v2026-08-02.32** -- DOCUMENT OPEN/REOPEN (AG direction, three items).
(1) A freshly opened document now focuses the first item in DISPLAYED
order. Initial focus came from `createInitialFocusState()`, which walks
`itemIdsForStage()` -- the STRUCTURAL order; since AMBIGUITY CATEGORY-FIRST
(.28) that stage renders a section-grouped queue, so the structurally-first
proposal routinely sat mid-page and the reviewer opened a document looking
at an item below the fold. Corrected in the UI layer (`stages.ts` must stay
display-independent), the same NAV-ORDER correction
`dispatchReviewWithVisibleAdvance()` already applies after a decision.
Fresh loads only -- resume paths keep their saved FocusResumePosition, per
AG. (2) A just-opened document now appears in Recent Documents
immediately. The record was ALREADY being written (`loadDocument()` ends
with a fire-and-forget `scheduleAutosave()`), but the UI's recents refresh
read the repository before that write landed; new `autosaveSettled()` lets
the one caller that must read back its own write wait for it, without
making autosave blocking for any decision path. (3) Picking a file already
in the document list now shows an inline prompt -- continue the existing
workflow (keycap 1), or replace it with a fresh extraction (keycap 2,
destructive), plus Cancel and Escape. The check runs BEFORE extraction:
`documentIdForBytes`/`documentIdForFile` were extracted from
`OoxmlDocumentParser` so identity (a content hash) is answerable from the
raw bytes, and a reviewer choosing "continue" never pays for an extraction
that gets discarded. `findStoredSession()` deliberately reads through
`listRecent()` rather than the repository's `load()`, which stamps
`lastOpenedAt` -- cancelling must leave no trace. File-picker path only;
the dropdown and Recent Documents are already explicit resumes. The region
uses the CAUTION family rather than `.decision-redact`: same red, but a
decision class asserts "this candidate is being redacted," and this is a
destructive-action warning, not a decision. Covered by
`verify/document-reopen-verification.ts` (16 checks).

**v2026-08-02.31** -- CLARIFY REVIEWER ACTIONS (AG direction): every
clickable decision now describes what happens to the DOCUMENT rather than
naming an internal operation. "Keep" becomes "Keep as-is" -- explicit that
the button leaves the document unchanged, which is the decision actually
being made -- and the bulk forms become "Keep all as-is" / "Change all" /
"Redact all" / "Ignore all", with "Keep selected as-is" for the checked-
subset bar. This introduced a deliberate SECOND label map alongside RX-22's
`DECISION_DISPLAY_LABEL`: `DECISION_ACTION_LABEL` for anything inside a
`<button>`, the original for anything REPORTING a decision (statistics bar,
"Reviewed -- Keep", toasts, filter presets, pill tooltips), which read wrong
with the verb phrase substituted in ("Keep as-is 12"). The two are parts of
speech, not rival vocabularies -- RX-22's real defect was "Rename" vs
"Change", two different words for one action; "Keep"/"Keep as-is" share
their head word. Bulk labels are their own maps rather than `${action} all`
because "Keep all as-is" is an infix, which also retired the relationship
card's `" All"`/`" Selected"` string suffix in favour of a scope carried as
data. Section-specific actions ("Keep shortened names", "Leave all as-is",
"Use full names") and "Unrelated" are untouched -- already outcome-phrased,
and more specific than a generic label. Visually, the recommendation chip
is now the row's anchor (taller, wider, decision buttons vertically centred
against it) so the bar reads "Recommendation -> Decision" rather than five
equally weighted buttons.

**v2026-08-02.30** -- An EXPANDED sectioned-queue row no longer repeats its
numbered suggestion chips (AG: "if an item is open, do not show the
numbered button within the pill"). This surface opens its detail panel with
`showHeader: true`, and that header renders the same buttons from the same
recommendation, so an open item showed "① Andrew Goodloe" twice -- once in
the collapsed row, again in the panel directly below it. Gated on
`expanded`, not on the stage: the duplication belongs to this row/panel
pairing rather than to Ambiguity Check. Item Check's own list rows
(`renderCandidateStage`) have the inverse arrangement -- chips ONLY when
expanded, panel opened WITHOUT a header -- so the row is the header there
and nothing was ever duplicated; a stage check would have made two surfaces
with the same underlying rule reason about it differently. Decided rows are
untouched (their "→ label" record is not a control, and
`recommendationForCandidate` already returns null once decided).

**v2026-08-02.29** -- UNIFIED DECISION COLOR SYSTEM (AG direction). Color
now represents review DECISIONS, not review stages or states: Redact red,
Change blue, Keep green, Ignore purple, undecided neutral, everywhere. A
card takes the highest-precedence decision it contains (Redact > Change >
Keep > Ignore) and names the others with small lettered pills (K/C/R/I) at
its upper right, so any pill means "more than one thing happened here."
The ordering and the pure `decisionSummary()` derivation live in
`domain/DecisionPrecedence.ts` (shared with the engine); the hue, letter
and class live in `ui/decisionLabels.ts`. Most of the work was EVICTION --
the palette was fully allocated, so several non-decision meanings had to
give up the decision hues: confidence badges and document scores now speak
in depth of ink (a 72% figure used to render red inside a card the reviewer
had just marked Keep); focus is a ring and never a fill (accent blue was
competing with Change in the same channel); amber means only an open Fix
this session; and the blanket green "done" treatments on triage rows,
relationship cards, reviewed checkmarks, type cards and the
acknowledgement pulse now take the decision actually made -- a redacted row
used to render green. Mixed groups no longer paint amber "needs attention";
`groupDisplayDecision()`'s `needsAttention` survives unchanged and still
drives the Fix this emphasis, it just no longer claims the color channel.
Three parallel per-decision class maps in `app.ts` and ~24 enumerated CSS
rules collapsed into one class per decision setting four custom properties.

**v2026-08-02.28** -- The active workflow now represents ALL remaining
review work, not only unresolved candidates (AG's architectural
correction). Structural relationship proposals are reviewer work, but the
work model counted candidates/groups/types only -- so a stage could read
"complete", lose its tab, and leave an unaddressed proposal unreachable
(found live in .27 validation). `navigation/stages.ts` gains a second,
parallel axis: REVIEW ARTIFACTS (`reviewArtifactIdsForStage` /
`isArtifactResolved`, mirroring the item pair exactly, so a future artifact
kind is two switch cases). Proposals belong to Ambiguity Check, which
renders them unconditionally -- Item Check's Triage view shows the same
cards only in that view, a UI toggle the domain must not depend on.
`StageStatus` gains `artifactCount`/`unresolvedArtifactCount` as SEPARATE
fields (widening `itemCount`/`unresolvedCount` in place would have
corrupted Workspace's `totalCandidateCount - unresolvedCount`
arithmetic), and one membership rule (`isStageActive`) now counts both.
Everything downstream follows from that single definition: tabs (label and
visibility), traversal, focus reconciliation, progress (a proposal is one
unit of reviewer work in the Review score), completion, and -- newly --
QA/Output availability, which asked only about Item Check and could
therefore open Output with a proposal outstanding. The Output stage now
names what is actually blocking instead of reporting "0 items unresolved".
Battery: 40 suites, workflow-navigation 40 -> 64 checks.

**v2026-08-02.27** -- Acronym kind-group section actions + section-action
digit shortcuts. (1) The "Possible acronym" kind-group heading now offers
two explicit reviewer decisions -- "Accept as acronyms" (every remaining
proposal standardizes on its brief value, e.g. ITS) and "Accept written
out" (the verbose value, e.g. Information Technology Services) -- each
running the card's OWN preferred action through applyRelationshipBulk, so
a group press is provably N presses of the card buttons: same descriptor,
same choke point, same audit. The descriptor is selected by a new ROLE
tag, never by position, so a card missing one side is skipped and
narrated rather than silently taking the other. These REPLACE "Accept All
Remaining" on acronym groups only, where it was already "Accept written
out" under a name that didn't say so (disclosed judgment call; other
kinds keep it). (2) The green section buttons are now KEYBOARD
destinations, numbered DOWNWARD from ⑨ -- one action is ⑨, two are ⑧ ⑨,
three ⑦ ⑧ ⑨ -- while items keep numbering upward from ①. One pure
assignment function feeds both the keycaps and the key handler; keycaps
render only on the ACTIVE scope (the focused row's section/tier, or the
selected card's kind group), so the number you read is the number you
press. Where the two populations would meet, the item side truncates
first (the Possible-identities ceiling drops by what its own section
reserves). The legend gains a conditional "7–9 Section actions" segment;
digits stay inert in Split Review Mode, open editors, and Fix this.
Battery: 40 suites (new `section-action-digits-verification.ts`).

**v2026-08-02.26** -- The rows↔cards seam on the sectioned-queue stages
(Ambiguity Check, and Item Check's Triage view). Two live bugs, one root
cause: rows and the structural relationship cards render as ONE displayed
collection, but the post-decision advance and the viewport scroll still
only knew rows. (1) Deciding the LAST unresolved row no longer dead-ends
with cards still unreviewed below -- the advance continues into the first
UNADDRESSED card in displayed order (derived from state via
triageQueue.ts's new pure `structuralCardDisplayOrder`, never from the
rendered tree's classes), the same boundary the arrow keys already
crossed. Covers both row-advance paths: the per-decision choke point and
the section-action buttons. (2) Confirming a card's Change/Redact editor
no longer yanks the viewport back up to the stale, already-decided row:
while the card cursor is set, the CARD is the working object, so the
scroll follows it -- the same cursor the decision letters, detail
expansion, and ⇧A already follow. No CSS needed (cards already carry
`.item-row`, hence RX-04's chrome-clearing `scroll-margin-top`).

**v2026-08-02.25** -- Phase 2: Type Check stage + conditional workflow +
relative stage navigation (AG's full Phase 2 authorization, Task #49).
(1) TYPE CHECK is a first-class sixth stage between Group Check and Item
Check: cards per populated semantic type (Phase 1's semanticTypes.ts, now
in src/domain/, remains the source of truth), the focused card expands
into a per-type surface -- People get the full evidence panel, everything
else compact rows -- with a member cursor (Down enters, letters act,
auto-advance wraps) and type-level bulk actions that fan out through
bulkApplyDecision only (no new decision/audit model; a type is complete
when its members resolve through the existing pipeline). (2) CONDITIONAL
WORKFLOW: the visible workflow = stages that currently CONTAIN WORK plus
the always-required QA/Output -- one derivation
(engines/navigation/workflow.ts) feeds tabs, traversal, progress, focus
reconciliation, and completion; empty/completed stages disappear from
tabs and traversal, and reconcile() now relocates focus off a stage the
moment its work is done (open Fix this pins focus, deliberately).
(3) SHIFT+←/→ = previous/next ACTIVE stage, REPLACING Shift+1–5 entirely
(handler, tab keycaps, legends all removed -- no shortcut/order coupling).
Category Check's Shift+Arrow filter-column navigation deliberately
reassigned to ⌥(Alt)+Arrows -- the four-arrow spatial grammar stays
whole under one modifier. Battery: 38 suites incl. new
workflow-navigation-verification (40/40); one real drift bug found and
fixed by the battery (FocusResumePosition's hand-duplicated stage list
rejected saves made on the new stage). Full findings:
docs/detection/type-check-integration-and-workflow-navigation.md.

**v2026-08-02.24** -- Section actions advance in display order (AG live
report: "Leave all as-is" on Institutional Terminology landed focus on
"New" instead of "Fall"). runSectionAction dispatched through raw
dispatchReview, bypassing the visible-order choke point -- the
dispatcher's own reconcileFocus() then advanced in STRUCTURAL order,
the exact nav-order bug class the interception exists for, at a call
site it never covered. Now: snapshot the displayed order pre-dispatch
and re-select the first still-unresolved item after the completed
SECTION's last member (the section, not whatever held focus, is the
anchor), via the same advanceWithinVisibleList + domain isItemResolved
pair the choke point uses. Applies to all section/tier actions on both
sectioned stages, including ⇧A Accept section.

**v2026-08-02.23** -- Split cursor + Use-button alignment (AG live
feedback on .22). (1) Split Review Mode now has a real MEMBER CURSOR:
entering the split focuses the FIRST member automatically ("you need to
immediately review them"), Up/Down (and Left/Right) move it over ALL
members -- intercepted so arrows no longer fall through to between-item
grid movement -- clicking a row moves it, letters act on it, and after
each choice it auto-advances to the next unchosen member (wrapping,
the Fix this bounded-set precedent). Cursor row takes the full
nav-blue treatment (the .22 subtle ring read as nothing). (2) "Use"
buttons vertically align: within a group's member list every
confidence slot equalizes to the widest one (a "needs attention" note
widens the column for all rows; a group without notes stays naturally
tight, per AG's exact instruction), decided-✓ rows joining the column
via margin instead of a deforming min-width -- all in the existing
alignConfidenceColumns render-tail pass.

**v2026-08-02.22** -- Split Review Mode ("Separate These", AG's spec:
incorrect grouping as a first-class review action). "① Separate these"
is the group's first numbered action (Use accelerators renumber to 2+);
it enters a FULLY BUFFERED split session -- the group row suspends
(greyed, actions disabled, "Split Review Mode" badge) and each member
becomes an independent Keep/Change/Redact/Ignore row (Item Check's
vocabulary; F deliberately absent, as on Item Check rows). Choices
accumulate in a UI-side buffer; NOTHING dispatches until every member
is chosen, which is what makes Esc's contract real: cancel discards the
exploration and restores the exact prior state because no command ever
ran (decisions are single-current-value with no un-decide -- buffering
is the only honest path). Completion auto-fires on the last choice and
REPLAYS through the existing Fix this sequence (enterNotQuite ->
applyNotQuiteMember per member -> completeNotQuite): byte-identical
audit to a manual Fix this, zero new commands (rejectGroup stayed
removed per v9). The completed group leaves Group Check for the session
(visibleGroupIds filter); DISCLOSED: after a reload it reappears as an
ordinary resolved (Refined) group -- durable state IS a completed Fix
this. Keyboard: K/C/R/I act on the first unchosen member, C/R via the
standard inline editor (new "split-member" scope, buffer-committing);
Esc cancels; legend switches to the split vocabulary. Suites 37/37.

**v2026-08-02.21** -- Group Check "① Use" accelerators (AG: "Which
representation should this group use?" as the primary affordance).
Every member row in an expanded group now carries the app's numbered
keycap-button language -- "① Use" / "② Use" -- and digits 1-9 while the
group is focused commit that member's spelling as the group's canonical
identity immediately. DELIBERATELY NO NEW BEHAVIOR: useGroupSpelling
dispatches exactly what confirming the Change editor with that spelling
already dispatches (flattenGroup for the canonical spelling --
preserving its EntityGroupDecision stamp and reviewer-confirmed bonus;
bulkApplyDecision Rename over all members otherwise). Same commands,
audit, and advance. The Use button joins the roving grid between
checkbox and Source; legend gains "1–9 Use spelling"; digits stay inert
inside Fix this and open editors. The Change editor and its quick-picks
remain for narrowed selections and custom text.

**v2026-08-02.20** -- Uncertain disposition chips (AG, from the "Math"
case: "we really need 1) Person's Name 2) Not a name and.. lower below
as-is.. 3) Math option", abstracted per his own ask). New archetype
"uncertain": a SINGLE-TOKEN person-typed item matching no other
archetype -- the detector is speculating on type -- now leads with the
two fundamental dispositions as chips: ① Person's name (new "keep"
SuggestionOp -> keepCandidate, the People section's own accept default)
and ② Not a name (Ignore). Possible identities continue the one digit
space below (③ Math Option), unendorsed -- the recognition gate still
never puts a phrase-completion identity in the header ("Did" gets the
chips but never a "Did Dr" chip; suite-enforced). Deliberately NOT
promoted: tier- and section-wise "uncertain" behaves exactly like a
null archetype, so these items stay in Other / Needs Individual Review
rather than jumping to Strong on the strength of their own chips.
Multi-token proper names still derive nothing. Suites updated to the
new contract (recommendations 43/43; six former derives-nothing checks
reread as uncertain-with-no-identity-endorsement).

**v2026-08-02.19** -- One digit space per item (AG: "if there is an Any
Tanesha button.. and a Possible Identity.. with differing numbers, that
is an issue"). The term archetypes' header now carries ONLY the ① claim
chip -- the identity option is no longer duplicated as a ② chip; it
takes digit ② inside the Possible identities list, which CONTINUES the
header's numbering instead of restarting at 1 (deliberate: "I actually
would prefer they have to read the whole thing if they want to select
2"). One pure derivation (identityDigitAssignments in recommendations.ts)
feeds both the list's keycaps and handleIdentityLinkKey, so the number
a reviewer reads and the number the keyboard acts on cannot disagree --
identity-backed archetypes reuse their header digits in the list
(Andrew=①②③ continuous), no-recommendation items stay plain 1..N.
Supersedes .17's ② header chip. Suites updated (recommendations 40/40).

**v2026-08-02.18** -- Workspace Metrics (AG's standalone-subsystem
task): a live, read-only telemetry window for the active workspace.
Settings gear -> "Workspace Metrics" opens a separate detachable window
(window.open, same module graph) that render()'s tail keeps in step
with every decision/bulk action/load/resume; closing it never touches
review, and review never reads it. Architecture: pure derivation
(`src/metrics/workspaceMetrics.ts`) over the dispatcher's existing
getState() -- five extensible sections (Workspace scale / Review /
Cleanup / Reviewer activity / Consolidation) as render-agnostic data.
Reviewer activity reads the session's own persisted EVENT LOG
(individual candidate-decided acts vs one bulk-decided/group-decided
event per bulk act, via* tags disambiguating), so "actions taken" vs
"items covered" vs "occurrences covered" are counts, never estimates
-- and every metric restores exactly through the EXISTING preservation
model (nothing new persisted; suite proves a resumed workspace derives
byte-identical metrics). One additive exposure:
WorkspaceState.identityCleanup (the cleanup pass's removal record,
recomputed deterministically per load). Factual wording only; no time/
productivity claims (suite-enforced). New suite
workspace-metrics-verification.ts 14/14; battery green. Live-verified:
window opens from the menu, all five sections render real counts, and
a single K decision moved actions/decided/occurrence numbers in the
detached window without touching the review surface.

**v2026-08-02.17** -- Card mis-target fix + honest labels + conclusion-
as-button. THREE items from live review feedback. (1) ROOT CAUSE of
"Change All went to a completely different, already-approved item":
K/C/R/I resolved against the state-focused ROW even while a structural
card was the selected working object -- handleCardDecisionKey now runs
BEFORE resolveKeyboardCommand and routes the letters to THE CARD (same
functions as its buttons; I refuses with narration -- cards have no
Ignore). (2) "Clicking 1 ____ led to Redact All. I had no idea": the
identifier chip's bare "________" label now reads "[REDACTED ID]" (the
engine's own default placeholder -- a resulting state that NAMES the
outcome; custom text still one keystroke away in the editor it opens).
(3) Conclusion-as-button (AG: "offering a numeric button option in lieu
of a static 'I think this is a [blank] type' ... offers the solution
immediately"): the three term archetypes' claims are now the ① chip
("Common word" / "Calendar / academic term" / "Institutional term", op
= Ignore, agreeing with each section's Accept All default); a
recognized identity option follows as ② ("Any" -> ② "Any Tanesha"); the
conclusion sentence is empty -- the chip replaces it. SUPERSEDES the
2026-07-30 refinement's "no manufactured Ignore chips" for exactly
these archetypes, per Andrew's direct instruction; suites updated to
the new spec (recommendations 38/38 incl. the "Any" case verbatim,
preferred-actions 14/14).

**v2026-08-02.16** -- Inside the detail panel: arrows within, Tab
leaves the item (AG: "tab should leave the entire item. arrows should
navigate within. This is opposite of the behavior here."). The keydown
pipeline's detail-panel gate previously kept Tab/arrows NATIVE inside
the panel -- inverting the inside-an-item grammar the Group Check roving
grid documented (2026-07-29 revision, point 5: Tab always next/previous
ITEM, arrows within). Now: arrows rove the panel's visible controls
(movePanelFocus -- no wrap at the bottom, Up past the first control
backs out one level, mirroring Down-enters); Tab/Shift+Tab leave the
whole item via the same visible-order move Review-mode Tab uses
(moveItemFromPanel); Enter/Space stay native (activate/toggle); Escape
and the decision-letter fall-through unchanged. Live-verified:
enter -> rove down/up -> Tab out to next item, and Up-past-first exits.

**v2026-08-02.15** -- Down enters, Tab moves (AG: "the nav needs to
allow down arrow to enter the actual focus area. then Tab to go between
items"). Sectioned-queue grammar (Ambiguity + Triage): ArrowDown on the
focused row hands real DOM focus INTO its expanded detail panel (the
same detailPanelFocusPending path as Enter Details; Escape backs out);
ArrowDown from a selected structural card enters the card's first inner
control (from an inner control it still means next card). Moving BETWEEN
items is Tab / ← / → / ↑; crossing into the cards is now ArrowRight at
the last row (Down no longer doubles as grid-down on these surfaces --
deliberately superseded per Andrew's instruction, matching Group Check's
Down-enters-the-group). Legends updated ("↓ Enter item · ←→↑ Move").
Live-verified: row→panel→Escape→card→into-card all land correctly.

**v2026-08-02.14** -- Structural-card highlight always shows detail
(same bug report as .13, second half: "tab vs arrow behavior ... whether
the nav is selecting an inner item or the total card"). Root cause: card
entry paths relied on the card's focus-listener side effect to trigger
the expanding render, and the cursor-set/focus() ordering could skip it
-- arrows (and the .07 auto-advance) could land on a highlighted-but-
COMPACT card. All three entry paths (sectioned-queue boundary,
moveStructuralCardFocus, advanceStructuralCursor) now set the cursor
first and render deterministically, with the render-tail pendingCardId
restore supplying DOM focus. Row clicks also stand the card cursor down
-- previously a selected card stayed expanded while a row was clicked,
two highlights at once. Live-verified: row->card->row transitions
expand/collapse correctly and repeatably. OPEN QUESTION flagged: while a
card is selected, the state-focused ROW keeps its own panel open beneath
(the item model always points at an item) -- acceptable now that the
card always shows detail, but a single-highlight model would need the
focus-model work the concurrent tab-behavior session owns.

**v2026-08-02.13** -- Triage/section rows expand on focus (bug report:
"if an item is highlighted, it should always expand to show detail --
in all screens"). The triage-grid renderer's expansion condition now
includes the focused row, superseding the original "focus without
opening" triage philosophy -- the last surface to adopt the app-wide
expansion-follows-focus rule. Explicit Space/chevron expansion, editing
auto-expand, decided-row collapse, and the view-state snapshot are
unchanged.

**v2026-08-02.12** -- Workspace Analysis (Feature 003). A new, entirely
standalone subsystem (`src/workspace-analysis/`) that analyzes a batch of
imported documents and proposes which ones belong to the same matter,
before any individual document review begins -- built and made green
independently of the review pipeline (own domain types, engine, state
container, UI, verification suite), then wired into `app.ts` through
exactly one entry point: a "Workspace Analysis" button on the landing
page. Deterministic evidence only (shared matter/case numbers,
organizations, email domains, acronyms, distinctive terms); clique-based
clustering so a "bridge" document can't transitively merge two unrelated
matters; a conservative threshold tuned so generic vocabulary/formatting
similarity alone can never trigger a grouping. Reviewer actions: accept
a proposed grouping, split it (partition its members), or merge two
groupings -- merge is refused unless the analysis independently confirms
the combined set still meets the threshold; no "combine anyway"
override exists. No persistence and no hand-off to the review pipeline
this phase (see `docs/detection/feature-003-workspace-analysis.md`'s
"Intentional limitations"). See that findings doc and
`docs/architecture/decisions/ADR-019-workspace-analysis-independence.md`
for the full design and the concurrency requirement this was built
under. 37/37 new suite checks; full existing battery + tsc green, zero
regressions.

**v2026-08-02.11** -- "Probable Name with Inserted Word" (AG's decisions
on the .09 follow-ups: (1) junk-only names leave Ambiguity as shipped;
(2) noisy-phrase GROUPS get their own category with "Change to <cleaned>"
/ Keep as-is / Redact). Implemented as a new RelationshipKind
"inserted-word-name": identity-cleanup.ts's insertedWordNameProposals()
produces proposals over a noisy group's members when the canonical name
cleans to a plausible identity AND a known-name ambiguity candidate
points at the group (grounding gate -- "Civitas College Scheduler"
stays out); merged into the structural proposal stream at the Workspace
(engine untouched, appended per KIND_ORDER). The card inherits the
entire existing grammar free: digit 1 = the cleaned name via bulk
Change (label rides on the new additive
RelationshipProposal.suggestedReplacement, computed once in display
order -- never re-derived from "Surname, Given" member strings, the
first cut's bug), Keep All / Redact All / Unrelated dismissal, the
kind-group heading with Accept All Remaining, keyboard, audit. On
Andrew's document: two cards materialize -- "Tanesha Can Collier" ->
[1 Tanesha Collier] and (bonus) "Andrew Are Goodloe" -> [1 Andrew
Goodloe]. Suite extended to 20/20; battery green.

**v2026-08-02.10** -- Command card moved up. The two-section command card
(Current Review / Navigation) relocated from the workspace's top band
into the chrome's status row -- the previously empty space right of the
Review Status scores and statistics line, above the stage tabs. Same
panel, same contents, still context-derived and still sticky. The band
survives as a slim workspace top edge (.workspace-top-slim) so the
active tab's termination into the surface is unchanged.

**v2026-08-02.09** -- Identity-candidate cleanup pass (AG: "the reviewer
should spend time deciding between plausible identities -- not filtering
out obvious parsing artifacts"). New pure module
`engines/entity-resolution/identity-cleanup.ts`, wired at the WORKSPACE
level after propose() (the semantic-augmentation slot; bare engines and
every parity suite untouched). Evidence-driven rules over person
ambiguity OPTIONS: tokens classified via the quality engine's NARROW
curated dictionaries + known-name data + related-names dataset + a small
additive sentence-context lexicon (afternoon/evening/everyone/... --
additive data, parity dictionaries untouched); bigram anchors with an
ordinary-language tail are suppressed ("Diana Yes", "Margaret
Afternoon"); trigrams clean interior ordinary tokens INTO a cleaned
identity ONLY when the short candidate itself carries known-name
evidence ("Tanesha Can Collier" -> "Tanesha Collier" -- safe because
linking records identity and keeps surface text); real entity groups and
knowledge-backed options are exempt; duplicates collapse preferring the
already-clean anchor; emptied proposals drop (no plausible identity = no
ambiguity to review; the candidate still flows through Item Check).
Empirical result on Andrew's transcript: 56 -> 40 proposals, 39 junk
options gone, ZERO legitimate identities touched, zero invented names.
Three Frankenstein generators caught by before/after runs against the
real document during development (expanded-common-language would kill
miller/ford/collier; member-count exemption protected repeated junk;
names-lexicon relabel gate minted "May Dates"/"Fall Term") -- each is
now an explicit inline comment + suite check. New suite
identity-cleanup-verification.ts (12/12; battery 35). DISCLOSED
FOLLOW-UPS for Andrew: (1) "Sarah"/"Diana"-class names whose ONLY
option was junk now leave Ambiguity Check entirely (their person
question lives in Item Check's people section) -- if they should
instead stay in Shortened Person Names' Needs Review, the tier gate can
be relaxed in one line; (2) when the noisy phrase formed a REAL group
("Tanesha Can Collier", 2 occurrences), its OPTION label is exempt here
-- renaming the group's canonical identity touches Group Check display,
replacement derivation, and audit, and awaits Andrew's explicit call.

**v2026-08-02.08** -- "Andrew Thanks"/"Diana Yes" chips (AG's research
question) root-caused and fixed. PROVENANCE (traced against Andrew's own
transcript with a pipeline experiment): the options ARE produced by the
ambiguity engine -- deliberately, via the 2026-07-28 solitary-anchor
correction ("Diana" proposed against the solitary name-shaped bigram
"Yes, Diana" the detector carved out of "Diana: Yes, ..."); they are NOT
reintroduced by the renderer (chips render only deriveRecommendation's
suggestions). The recognition gate ADMITTED them because its anchor
vetting looked options up among entityGroupProposals -- solitary anchors
never form one, so they were silently skipped, unflagged = "recognized".
FIX (presentation layer; engine untouched): (1) the vetting now recovers
solitary-anchor members through the shared personGroupKey space and
applies the same all-Unlikely rule (kills "Andrew Thanks"/"Andrew Are"/
"Tamara Thanks"); (2) a second signal, isNonNameAnchorEvidence
(recommendations.ts): anchor members whose quality categories say
"ordinary language" (interjection/greeting/verb/common-word/fragment/
pronoun -- an explicit list, deliberately NOT COMMON_WORD_CATEGORIES:
frequency-saturated is a frequency signal real speakers carry, and
vetoing on it killed the legitimate "Nelly Perias"/"Tamara Yamada"
chips in the first cut, caught empirically before shipping) do not count
as recognition (kills "Diana Yes"/"Sarah Yes"). Vetoed known-name
candidates land exactly where the tier model intends: Shortened Person
Names -> Needs Review with the person-question actions. Verified on the
real document: junk gone; Christopher Cobb / Giancarlo Banuelos / Julie
Ford / Nelly Perias / Tamara Yamada / Tanesha Can Collier all preserved.
DISCLOSED RESIDUAL: "Margaret Chris"/"Margaret Afternoon" survive --
quality classifies "Afternoon, Margaret" as a plain surname-given
structure with no common-word category, so no signal at this layer
distinguishes it; a quality-dictionary addition would be the next lever
if it matters.

**v2026-08-02.07** -- Three fixes from Andrew's first live pass over the
tiers, plus one found reproducing them. (1) KEYBOARD DEAD IN AMBIGUITY
(the "focus does not snap" report): handleTriageKey's
`?.tagName.toLowerCase()` guarded the target but not `tagName` -- a
tagName-less event target threw, and the exception aborted the whole
keydown listener before resolveKeyboardCommand, killing every review
key; the .05 guard reorder made the Ambiguity stage reach that line.
Both accesses now guarded; verified live (arrows walk the sectioned
queue, consumed, ▶ follows). (2) Category action buttons moved INLINE
left -- right of title/progress with a 0.75rem offset -- instead of
margin-left:auto, which stranded them a screen away on wide windows.
(3) The grey section explanation sentences are REMOVED from the body
("remove ... entirely"); each survives only as the section title's
hover tooltip. (4) handleLoadFile/handleResumeSession no longer await
refreshRecentSessions before render() -- a wedged IndexedDB (blocked
version upgrade) hung the promise and silently swallowed a fully-
processed document; render first, recents refresh in the background
(the blank-first-refresh "never hostage to persistence" rule, applied
to the load paths).

**v2026-08-02.06** -- Review confidence tiers + category action
vocabularies (AG: "introduce a reusable concept of review confidence
tiers within a category"). Each ambiguity category may partition into
"Strong Recommendations" / "Needs Review" -- a REVIEWER-EFFORT axis
(`recommendations.ts` `deriveReviewTier`, a pure companion to the
archetype over the same facts: suggestion-bearing + term/identifier
conclusions = strong; named-but-unresolved = needs review; a recognized
NAME with only unrecognized identity homes = the person question,
rescued from "Other" into Shortened Person Names' Needs Review). Bulk
actions are now DATA per category+tier (`AMBIGUITY_TIER_ACTIONS`:
human labels like "Use full names" / "Keep shortened names" / "These
are people's names" / "Leave all as-is" over two op tags --
accept-each-item's-own-suggestion or one bulk Keep/Ignore/Redact, with
Redact taking the default placeholder); the renderer is category-blind
(one tier = actions on the title line, keeping the compact look; two
tiers = quiet sub-headings with per-tier progress + actions). The
single "Accept All Remaining" is retired in Ambiguity (superseded by
the vocabulary; the Triage view deliberately keeps its hybrid). Shift+A
now runs the focused item's TIER's first action. Disclosed trim:
"Not acronym relationships"-style un-categorize actions have no
existing command semantics for candidate rows -- flagged, not invented.
Suites: recommendations 33/33, triage-queue 53/53, battery green.

**v2026-08-02.05** -- Ambiguity Check category-first (AG: "The ambiguity
class is the review unit. The individual candidates are the evidence.").
The stage's flat entity-ambiguity list is replaced by the SAME sectioned
queue as Item Check's Triage view (one shared renderer,
`renderSectionedQueue`), under an ambiguity-specific section vocabulary
(`triageQueue.ts`: Shortened Person Names / Nicknames / Organizational
Aliases / Acronyms / term sections / Identifier Patterns / Other) with
per-section explanation, counts, completion greening, and Accept All;
the structural kind-groups render as the collection's final sections
(triage arrangement) and gain their own Accept All Remaining (each
card's first preferred action through `applyRelationshipBulk`;
identifier cards Redact with the default placeholder). Null-archetype
person-typed candidates land in "Other / Needs Individual Review", NOT a
people section (AG's "many of the 'person' classified items are clearly
not people"). Keyboard: displayed order IS traversal order
(`visibleAmbiguityIds`), rows→cards forward boundary matches triage, and
new Shift+A accepts the focused item's section (grammar: Shift = wider
set). Detection/matching/persistence/audit untouched -- presentation and
dispatch-through-existing-paths only.

**v2026-08-02.04** -- UI-state persistence, document-tied (AG: "tie it
to the document, not the user"). A per-document snapshot of presentation
state -- active stage, focused item (incl. an open Fix-this panel), view
mode, category/search/sort filters, triage expansion, source panel, the
open Change/Redact editor WITH its draft text, and scroll position --
stored in a new IndexedDB "ui-state" store beside the session record
(DB v2, additive upgrade; opaque to the persistence layer; deleted with
its session; travels with the document when accounts arrive). Saved
debounced from render() plus a pagehide flush; applied on every resume
path; a per-tab pointer auto-reopens the last document after a refresh
and restores everything, scroll included. Freshly opened files reset all
of it -- new documents always start at the top left.

**v2026-08-02.03** -- Redact editors show the LIVE default placeholder.
"(blank = default placeholder)" named an invisible value; every Redact
editor (candidate rows, bulk toolbar, relationship cards, Group Check
subsets, Fix-this members) and the command-bar legend now previews the
EXACT text a blank confirm would produce -- computed by the real
ReplacementRuleEngine against the current Redaction Rules config and
current decisions, so sequential/{n} ordinals are real ("blank =
[REDACTED ID]"; multi-candidate sequential sets show "[ID 001] … [ID
013]"). Note: the relationship cards' "Shared pattern: #########" line
is the detector's grouping evidence, NOT the replacement -- the actual
default is now visible right in the editor.

**v2026-08-02.02** -- Preview gate: THE actual bug, found and fixed via
temporary on-gate diagnostics (Andrew's direction) after .01's layers
didn't cure it. `.preview-gate { display: grid; ... }` -- an author
`display` rule overrides the `hidden` attribute's UA `display: none`, so
`gate.hidden = true` NEVER visually closed the gate: the password always
validated, the flag was written, the app loaded and ran BEHIND the
stuck gate, and flag-present boots skip showGate leaving the visible
gate a dead form (whose Enter fell through to a native submit -- the
"dots disappear"). Fix: `.preview-gate[hidden] { display: none; }`.
Diagnostics removed after confirmation; the .01 hardenings stand.
LESSON, now paid for: verify user-visible outcomes visually -- every
earlier check read `gate.hidden` (the attribute), not what was on
screen.

**v2026-08-02.01** -- Preview gate: real-world hardening after Andrew's
"the password does not work!" (a genuinely layered failure; each layer
was real). (1) isPreviewPasswordValid trims pasted whitespace. (2) The
gate drops only after the app import RESOLVES; a load failure keeps the
gate up with an actionable message instead of a silent blank. (3) One
automatic reload on import failure (module-map failures are cached per
page; only a fresh page recovers) before showing that message. (4) The
password input opts OUT of password managers (autocomplete="off",
data-1p-ignore, data-lpignore, data-form-type=other) -- 1Password's
inline overlay was capturing keystrokes. (5) The form carries inline
onsubmit="return false": in some page states the module's submit
listener was observed absent, and Enter fell through to a NATIVE GET
submit -- navigating to index.html?, wiping the field, and re-showing a
fresh gate ("dots disappear"), indistinguishable from rejection. The
markup-level stop makes native navigation impossible regardless of any
script race. Also serve.py (Cache-Control: no-cache) replaced the bare
http.server -- see .03 -- after stale mixed-version module graphs
produced several of the above states.

**v2026-08-01.08** -- Public landing page + preview gate. New
`landing.html` (self-contained, shared palette; deployment mapping in
its header comment: docscrub.app root -> landing.html, www -> 301,
app.docscrub.app reserved/not built) with "Enter DocScrub" -> the app.
`index.html` now loads `dist/ui/previewGate.js` INSTEAD of app.js: a
temporary shared-password access screen (static .preview-gate markup --
disabled "Preview account" email field, live autofocused password,
Enter submits, inline "Incorrect preview password." + brief shake,
immediate retry) that defers the app module's import until access is
granted. ALL gate logic in src/ui/previewGate.ts (isPreviewPasswordValid
= the replacement seam; sessionStorage "docscrub-preview-access"
survives refresh, dies with the browser session; storage failure
degrades to re-asking, never to a broken app). "Exit Preview" is the
settings menu's one live item -- clears the flag, returns to the gate.
app.ts untouched. Deliberately NO accounts/hashing/backend/reset/OAuth,
per the spec's scope restraint.

**v2026-08-01.07** -- Structural cards auto-advance. Completing a card
(Keep All, an editor-confirmed Change/Redact All, a preferred action, or
Unrelated) now moves the keyboard cursor to the next card still needing
attention -- forward first, then backward, then onward into the stage's
first undecided row when no card remains -- the same advance grammar as
every other decision path. Also investigated the reported
"card Redact All opened the focused candidate's editor" mis-target: not
reproducible on a version-consistent build (all editor call sites are
scope-strict); consistent with a mixed-version module graph from the
pre-serve.py cache behavior (.03). Re-test after restarting the server;
report immediately if it recurs.

**v2026-08-01.06** -- Stage encapsulation + command card. Stage tabs are
WORKSPACE tabs (structural file-folder metaphor, no skeuomorphism): the
active tab shares the workspace surface's background/border, drops its
bottom edge, and overlaps the surface's top border by 1px so the surface
terminates into it; a thin inset accent bar marks its top edge; inactive
tabs recede (borderless, muted, hover outline). The workspace is ONE
contained surface: a new .workspace-top band (inside the sticky chrome,
same canvas + side borders, flush) continues seamlessly into .stage-body
(border-top removed, bottom-only radius). The command bar became a
compact two-section CARD at the band's right -- "Current Review" (keycap
legend + selection + Next undecided/Previous decision) over "Navigation"
(⇧1–5 Stages, F6/, Regions, Jump to category), each row anchored by a
small-caps label; stages with no item vocabulary show only Navigation.
Old full-width .command-bar and .nav-card retired. NOTE: a concurrent
session is refining tab BEHAVIOR alongside this visual pass.

**v2026-08-01.05** -- Application frame refinement (findings:
`docs/detection/application-frame-refinement.md`). The header is now the
sticky application frame: logo left; the DOCUMENT center (bold active
name, sibling vault documents as one-click switches, "+N ▾" inline
panel; "No document selected" otherwise); permanent save status ("✓ All
changes saved" / "Saving…" / warn/error states) + a settings gear
(stub menu; About shows the version) right. Subtitle line removed.
Toolbar simplified to New Document / Resume / existing-document select /
Documents; Save Session, session-JSON resume, and decision import
demoted to a "Session tools" disclosure on the documents view (nothing
deleted). Review Status strip (Extraction/Review/Overall, large values,
subtle red/amber/green at <40/40–79/>=80) replaces the small
flush-right scores; stage tabs are equal-width with embedded ⇧1–5
keycaps; the command bar's right side is a compact Navigation card
(⇧1–5 Stages, F6/, Regions, Jump to category — no longer detached).
Sticky obstruction = header + chrome, both measured
(--app-header-height + summed --workspace-chrome-height).

**v2026-08-01.04** -- Command-bar keycaps. The shortcut legend and the
⇧1–5/F6 stage hint now render every key as the app's faux-keycap
(`<kbd class="keycap">`, the digit-accelerator language) with muted
labels -- multi-char keys (Enter, Tab, Space, ⇧1–5, the ↑↓←→ clusters)
as wider rectangles, chords with the modifier in-cap (⇧K). Legend
restructured from prose strings to typed segments (LegendSegment /
kseg() / legendSegmentEl) so every contextual branch shares one
renderer. With the caps carrying their own surfaces the bar drops its
background (transparent, --border-soft border). "Next ambiguity" button
REMOVED as vestigial, confirmed before removal: Milestone 2's
cross-stage jump (focusStage + nextUnresolved) predates stage tabs with
live counts, ⇧1–5 switching, and universal decision auto-advance --
RX-20's review had already flagged its render-everywhere placement.

**v2026-08-01.03** -- Blank-first-refresh fix (root cause + belt). The
long-standing "first refresh is blank, second reload fixes it": the bare
`python3 -m http.server` sends no Cache-Control, so Chrome
heuristic-cached dist/ modules and a post-build refresh could load a
MIXED-VERSION module graph that throws during import, leaving #app empty
(no version label = the module never ran). New `serve.py` sends
`Cache-Control: no-cache` (revalidate -> 304s; reloads stay fast, every
load is version-consistent -- Cmd-Shift-R no longer needed either);
start-server.command/`npm run serve` use it, and the launcher now
replaces a still-running OLD bare http.server instead of reusing it.
Belt: the first render() is no longer hostage to the recent-sessions
IndexedDB read -- if it stalls past 1.2s the landing page renders anyway
and the list fills in when the read completes. RESTART THE SERVER ONCE
(double-click start-server.command) to activate.

**v2026-08-01.02** -- Category-first review ("the category is the
decision; the items are the evidence"). Triage's unit of work shifts
from items to CATEGORIES: reviewer-facing semantic names (Likely People,
Institutional Terminology, Temporal / Calendar Terms, Common English
Words, Acronyms, Identifier Patterns, Other / Needs Individual Review),
each heading now a prominent title line -- name, "N complete • M
remaining", **Accept All Remaining** -- with its one-line conclusion
beneath; every section carries an explanation. Items flatten toward
spreadsheet cells (tighter grid, smaller flatter tiles). A
fully-complete category turns green (✓ title + counts, existing
palette), so the page visibly transitions to green and the eye hunts
remaining categories, not items. Structural kind groups share the same
progress language and completion green. Presentation only: decisions,
keyboard, expansion, audit, and persistence unchanged. NOTE: the
heading emphasis deliberately supersedes .01's "titles recede
(small-caps)" treatment for triage sections, per the category-first
prompt; .01's other changes stand.

**v2026-08-01.01** -- Visual hierarchy refinement (Python side-by-side
lessons; findings: `docs/detection/visual-hierarchy-refinement.md`).
Primary text large in every cell (result/category cells, group/candidate/
member row names) with counts small and muted; button padding pulled back
down; section titles (Results, triage sections) demoted to small-caps
muted; confidence figures larger with member %s measured into vertical
alignment under the parent's (`alignConfidenceColumns`); "needs attention"
moved from the title line into the confidence column under the %;
category cells are light-tinted rectangles on a fixed-track grid where
wrapped labels span exactly two tracks (`sizeCategoryCells`); FILTER
group anchors at the screen midline; the focused item's Why? auto-opens
(explicit closes remembered per candidate); Redaction Rules rebuilt to
the Python layout (Apply to all / Sequential radios, always-visible
Replacement Text, inline Preview, autosaves note, Advanced reveals the
raw strategy/{n}-template controls).

**v2026-07-30.23** -- Canvas color trial: --surface-canvas #f5f5f3 (a
slightly warmer greige) replacing .22's cooler #f7f8fa. One-value swap;
revert freely if it doesn't land.

**v2026-07-30.22** -- Proposal separation (visual polish). The review
workspace canvas is now very light gray (--surface-canvas #f7f8fa) with
proposal panels and rows staying white -- separation through whitespace
and subtle contrast, deliberately no new borders, shadows, or dividers.
Proposal gutters widened to 1.5rem side-by-side with 0.85rem between
rows, and a lone proposal on a line caps at roughly half the row
(max(38rem, 50%−gutter)) instead of stretching oddly across it.

**v2026-07-30.21** -- Structural kind groups. The "Structural
relationships" super-title is gone; each proposal KIND is its own titled
group ("Possible acronym" x/y, "Possible numeric pattern" x/y) in the
same heading language as the triage sections, and the cards inside carry
no per-cell kind label -- smaller cells, one explanation per group,
flowing left-to-right. Kind order = first appearance; cards never
reorder.

**v2026-07-30.20** -- Structural cards: compact until selected. Cards now
show only their header line (kind + accelerators + bulk buttons) until
the card is the selected one (keyboard cursor or click) or has an editor
open; the evidence sentence and member checkboxes appear on selection.
The evidence, now the selected card's clarifying piece, reads as prose --
the app's own font at near-body size, replacing the small monospace
treatment. Addressed cards keep their existing one-line collapse. The
whole title/button line (kind label, keycap accelerators, bulk buttons)
stays on ONE horizontal row -- cards size to their content, so wide
proposals mean fewer cards per line, by design.

**v2026-07-30.19** -- Triage refinement: clearing an inbox, not studying
a database. Triage is now ONE collection (superseding .16's two-column
split): reviewer-oriented sections -- People, Acronyms, Institutional
terminology, Temporal items, Common words, Identifier patterns, Other --
with the structural relationship cards as the collection's final
section. Each heading communicates the conclusion ONCE ("Ordinary
English words, not names."); rows are bare tokens (✓ done, ▶
highlighted) with inline digit keycap chips as the primary interaction
("Andrew ①Andrew Goodloe" -- press 1, done, no expansion). Broad-
conclusion sections gain **Accept all**: each item's own top
recommendation wins when one exists, everything else takes the section
conclusion (People→Keep, term sections→Ignore); identifier/acronym
sections deliberately offer none. Nav boundary flipped to match display
order: forward past the last row enters the first card; backing out of
the first card returns to the last row. Also: Ambiguity flow's cards now
sit two-up from ~900px windows (24rem flex basis, measured live). All
detailed review surfaces unchanged, one Space away.

**v2026-07-30.18** -- Ambiguity Check: one collection (supersedes .17's
two-column split, same day, per Andrew's feedback on seeing it). Cards
and candidate items now flow together in a single wrapping stream --
structural cards first, left-to-right, wrapping into rows; the
individual candidate items fill in behind them naturally, several per
line. Implemented with `display: contents` on the section wrapper and
.item-list so the DOM structure (and every selector, scroll, and
keyboard contract) is unchanged -- traversal order (cards, then
candidates) is exactly the visual order. The Triage view keeps its
two-column workbench.

**v2026-07-30.17** -- Ambiguity Check joins the workbench. The Ambiguity
stage now uses the same two-column layout as Item Check's Triage view:
structural proposal cards left, the entity-ambiguity candidate list
right (independently scrollable side-by-side >= 1200px, single column
below or when no proposals exist). Arrow navigation treats both columns
as one queue here too: backing out of the first candidate lands on the
last card; moving past the last card lands on the first candidate --
identical grammar in both stages, so structural review feels like the
same experience everywhere it appears.

**v2026-07-30.16** -- Unified review workbench. The Triage view becomes
ONE continuous review surface: structural proposals (the same cards,
commands, and audit trail as the Ambiguity stage -- reused, not
duplicated) in a left column, the triage sections in a right column;
independently scrollable side-by-side on wide windows, single column
under 1200px. Shared visual language: cards compressed (tighter padding/
gaps, smaller evidence line, section context trimmed to the count) and
an addressed card now takes the SAME green completed treatment as a done
triage row. Unified navigation: cards joined the one review queue --
arrows walk card-to-card and onward into the triage rows (and back out
of the first row into the last card), Enter on a focused card accepts
its first preferred action -- the same Enter-accepts/arrows-move grammar
as triage rows. Digits 1-9 on cards, K/C/R/I, Space, and every existing
shortcut unchanged. Ambiguity Check still shows the cards as before.

**v2026-07-30.15** -- Triage Queue review mode (throughput experiment).
Item Check gains a third view, "Triage": compact rows grouped into
sections (People / Acronyms / Identifier patterns / Institutional terms /
Calendar terms / Common words / Other), auto-fill grid density (several
rows per line), section heading carries the explanation once. A row with
a recommendation reads "☐ Andrew → Andrew Goodloe"; clicking the arrow or
pressing Enter accepts it and focus advances to the next unresolved item
-- no card opens. Space (or the chevron) expands the row inline into the
EXISTING detail panel (KCRIQ, conclusion, Why?, Sources, occurrences,
Expert View -- reused, not redesigned); a decision collapses it back.
Accepted rows stay put with a green ✓ (the queue never shifts mid-work).
Arrows move spreadsheet-style over the rows; K/C/R/I, 1-9, ], and / all
keep their meanings. Recommendation generation unchanged. Pure sectioning
policy in `src/ui/triageQueue.ts` (new suite, 17/17; battery now 33).

**v2026-07-30.14** -- Reviewer Recommendation Refinement: recommendations
are now RARE, high-confidence, and immediately useful, never invented
because a review item exists. Suggestion buttons appear only for
RECOGNIZED entities: knowledge-backed identity options, or exact-name
anchors passing a recognition gate (candidate token is a known name;
anchor is multi-token, confidence >= 70, and not an all-Unlikely
phrase-completion bucket -- "Did" -> "Did Dr" and junk anchors derive
nothing). New reviewer-oriented term archetypes carry a conclusion with
NO buttons ("This looks more like an institutional or departmental term
than a person's name." / "This appears to refer to an academic term or
calendar period." / "This is probably an ordinary English word rather
than a person's name."); acronyms without a knowledge expansion are named
but not recommended. Detector confidence de-emphasized: the % badge is
gone from undecided rows and the panel pills, disclosed instead inside
Why? as "Detector confidence: NN%" -- the interface communicates
confidence through the presence and quality of recommendations. The ✓
column (reviewer state) survives.

**v2026-07-30.13** -- Addressed relationship cards collapse to one line.
Once every member of a structural relationship proposal has a decision,
the card folds to its header (kind + ✓ + preferred actions + bulk
buttons); the evidence sentence and member checkboxes collapse away.
Re-deciding stays one click away via the header buttons, and an open
Change/Redact editor keeps the card expanded (mid-edit is not "done").

**v2026-07-30.12** -- Header layout refinement: the recommendation
suggestion buttons moved from the panel body into the focused item's own
header row, immediately after the title -- part of the primary decision
bar ("Andrew (person) [1 Andrew Goodloe] [2 Andrew Smith] ... 45% Keep
Change Redact Ignore"). The conclusion sentence and Why? stay in the
panel body as supporting explanation. Same ops, same 1-9 digits; items
without a recommendation render their header exactly as before; many
buttons wrap within the row rather than overlapping the %/✓ column or
decision buttons.

**v2026-07-30.11** -- Fix: relationship-card member cells were ~157px
tall (.10's grid inherited a stretched height). Root-caused live in the
browser: the card inherits `flex-wrap: wrap` from `.item-row`, and a
column-flex container WITH wrap makes Chromium compute the card's
intrinsic height as if the auto-fill grid were one stacked column; the
grid's auto row tracks then stretched to fill that phantom height. One
line: `flex-wrap: nowrap` on `.relationship-card` (wrap was never wanted
on a column of header/evidence/members). Cells now natural ~32px height.

**v2026-07-30.10** -- Relationship cards: multi-item member rows. Members
no longer stack one per line: acronym cards put both members inline on
one row ("Information Technology Services (1)  ITS (14)"); identifier-
pattern cards lay their many uniform-width members out as an auto-fill
spreadsheet-like grid (~2-3 rows for a dozen numbers), echoing Category
Check's Results-grid cell language -- part of converging the sections on
one uniform look (keyboard-nav coherence with the other grids is the
flagged next step). Checkbox/decision behavior unchanged.

**v2026-07-30.09** -- Narrative-language trim. Words that restate what
the UI already shows are dropped from reviewer-facing labels: relationship
card titles "Possible acronym relationship" → "Possible acronym",
"Possible numeric/alphanumeric identifier pattern" → "Possible
numeric/alphanumeric pattern"; evidence-line labels "Related-name
relationship:" → "Related name:", "Acronym relationship:" → "Acronym:",
"Alias relationship:" → "Alias:" (the ↔ line already shows the
relationship). Display-only -- RelationshipKind values, commands, and
serialization untouched.

**v2026-07-30.08** -- Keycap digits. The ①-⑨ circled-glyph prefixes on
suggestion and preferred-action buttons were illegible at button size
(Andrew's feedback); every 1-9 digit hint is now a rendered square keycap
(`<kbd class="keycap">`) -- rounded 5px corners, semibold tabular
numeral sized with the label text, its own surface and 2px bottom edge so
it reads as "press this key" rather than part of the chip. Applied
uniformly to recommendation suggestions, structural-card preferred
actions, and the Possible-identities list (all the same 1-9 keystrokes).
Labels stay pure resulting states with no baked-in prefix (suite-enforced).

**v2026-07-30.07** -- Reviewer Recommendation UX. The candidate detail
panel now leads with a plain-language CONCLUSION ("This looks like a
shortened reference to a larger name.") and numbered suggestion buttons
whose labels are resulting interpretations ("① Giancarlo Banuelos",
"① Department", "① ________"); everything explanatory (summary, Sources,
the full Possible-identities list, All occurrences, Expert View) moves
behind one expandable "Why?" section -- nothing removed, only
reprioritized. Seven archetypes derived purely from existing engine
outputs (shortened name, semantic alias, acronym, department/
organization, institutional phrase, recurring term, identifier); digits
1-9 now read "Accept suggestion" everywhere, keystroke-compatible with
the previous identity-link digits. UI-only: no engine, persistence, or
decision-semantics changes. See
`docs/detection/reviewer-recommendation-ux.md`.

**v2026-07-30.06** -- Proposal-Specific Preferred Actions. Structural
relationship cards gain optional numbered accelerators on the action row:
acronym proposals show "① <full name> ② <acronym>" (each = the existing
bulk Change with that value), identifier-pattern proposals show
"① ________" (opens the existing Redact editor, cursor in the blank).
Digit keys 1-9 are LOCAL to the focused card and cannot collide with the
candidate-focus "1-9 Link identity" shortcuts. Pure UX shortcuts: one
shared apply path with the generic buttons, identical commands/events/
decisions.json, no new persistence; proposals without preferred actions
render exactly as before. See `docs/detection/preferred-actions.md`.

**v2026-07-30.05** -- Semantic Relationship Knowledge, Phase 2:
full-value aliases. Acronyms and organization aliases ("NSC" ↔ "National
Student Clearinghouse", "Cal State LA" ↔ "California State University,
Los Angeles") now raise ordinary Ambiguity Check proposals through the
Phase 1 provider framework's reserved "full-value" seam -- shorter side
asks, direct dataset edges only (no transitive closure), multiple
expansions become ranked reviewer-visible alternatives (the built-in seed
deliberately gives NSC two meanings), steeper strength penalty than name
tokens (30−5s, policy in the augmentation layer), evidence quotes the
document's own spelling. Bare engine still byte-identical to Python;
parity 13/13. Reusable browser-test document at
`fixtures/browser-validation/semantic-relationships-phase2.docx`. See
`docs/detection/semantic-relationship-knowledge.md` (Phase 2 section).

**v2026-07-30.04** -- Deterministic Semantic Relationship Knowledge
(Phase 1: related names). Entity resolution gains curated semantic
knowledge: the built-in related-name library (2,708 relationships with
ordinal strengths 1-5) lets a bare "Andy" propose "Andrew Goodloe" as a
possible identity, and lets cross-bucket full names ("Drew Goodloe" ↔
"Andrew Goodloe") raise ordinary identity ambiguity proposals -- same
reviewer workflow, no automatic merges, reviewer authoritative. Every
option in Possible identities now carries checkable evidence lines
('Same surname ("goodloe")', 'Related-name relationship: "drew" ↔
"andrew" (Strength 5 — Established)'); knowledge-derived options are
confidence-penalized proportionally to strength. The Python-parity
resolution surface is untouched (knowledge is an optional augmentation
layer; bare engines are byte-identical). See
`docs/detection/semantic-relationship-knowledge.md`.

**v2026-07-30.03** -- Structural Relationship Review. The Ambiguity stage
gains a second class of ambiguity: deterministic relationship PROPOSALS
(acronym/full-name pairs like "National Student Clearinghouse" / "NSC";
shared identifier shape patterns like ######### or AAA-#####), rendered as
cards above the entity-ambiguity list with explainable, non-semantic
observations ("Possible acronym relationship." -- never "Student ID"/
"SSN"). Actions: Keep/Change/Redact All-or-Selected (ordinary
per-candidate bulk decisions) and Unrelated (dissolves the proposal only;
members continue through review individually -- durable + audited via the
new review.dismissRelationship command). Detector framework is reusable:
new deterministic detectors slot into StructuralRelationshipEngine without
new reviewer interactions. See
`docs/detection/structural-relationship-review.md`.

**v2026-07-30.02** -- Python-parity feature pass + live-feedback rounds,
one cumulative bump (several of these shipped under .01 without a bump --
a miss against this file's own convention, corrected here). Category
Check rebuilt to the Python layout (By Category default; Review
State/Filter header in distinct colors, filters always visible and
cumulative; category cell grid + tight Results grid with expanded full
view, KCRIQ buttons included; Shift+Arrows drive the narrowing column;
"show empty categories"); Group Check: auto 2-column, member Source
panels (S key), contextual K/C/R/I (member row active = decide that
member, then advance to next unedited member, wrapping to the topmost;
top level = whole item); the item-scheme containment model (pending
Change/Redact previews its target hue; completed items keep their
decision color when selected -- accent only as the active border;
nav-blue containment for unprocessed items; open Fix this = amber, all
cascading to member rows and Source panels); circled ✓ replaces
percentages on addressed items, "was x%" stacked, needs-attention pills,
%/✓ column beside the buttons; Shift+1-5 stage switching. See
`20260730-features-from-python-findings.md` (repo parent) for the full
record and judgment calls.

**v2026-07-30.01** -- Diagnostic Scoring UI (TEMPORARY development
feature). The stage-tab line now carries three flush-right metrics --
Extraction (automatic processing success, stable once extraction
completes), Review (reviewer-work completion, updates continuously), and
Overall (document readiness) -- plus a deliberately plain diagnostic text
area between the tabs and the scores explaining WHY the scores just moved
("Resolved ambiguity", "Unsupported image discovered", ...). The
explanation is a diff of the same factor values the scores are computed
from (`src/ui/documentScores.ts`), never a parallel calculation. Formulas
are first-guess and expected to change with real-world tuning; the
justification area is expected to disappear or become a hidden developer
option later. "Blank" embedded images (zero-byte, or 1x1 PNG/GIF spacers)
are ignored by the Extraction score per Andrew's note. See
`docs/detection/diagnostic-scoring-ui.md`.

**v2026-07-29.03** -- Quick-pick chips revision. Rename quick-picks (Group
Check row-level, Item Check bulk toolbar) are no longer radio inputs that
just stage a choice -- each is now a button that commits and advances
immediately on click or Enter, with "Something else…" as a third option
in the same row that reveals the free-text field (pre-filled, for minor
edits) instead of a permanently-visible separate control. Arrow keys rove
focus across the chip row; opening the editor focuses the chip matching
the pre-filled default so a fast reviewer can accept it with one
keystroke. See `docs/detection/group-check-python-parity-revision.md`'s
addendum.

**v2026-07-29.04** -- Group Check keyboard and navigation revision.
"Rename" relabeled "Change" (key C, not N) and "Not Quite" relabeled "Fix
this" (key F, not Q) everywhere they appear -- display/keybinding only,
the underlying decision vocabulary and audit trail are unchanged. The
brief acknowledgement pulse (border + subtle movement) now fires for every
decision path, not just Item/Ambiguity Check's -- Group Check's bulk
actions and Not Quite's per-member actions get it too. K/C/R/I/F always
re-target the button highlight even mid-edit, but a draft's typed text now
survives switching away and back (per-target draft cache). Group Check
rows default to expanded whenever they're the reviewer's current focus (no
more separate manual expand toggle), and arrow keys inside an expanded
group now roam its own checkbox/action-button row and member list
directionally (Left/Right within a row, Up/Down between rows) using real
DOM focus -- Tab/Shift+Tab still always mean "next/previous item," never
"next control." See
`docs/detection/group-check-keyboard-and-navigation-revision.md`.

**v2026-07-29.02** -- Group Check Python-parity revision. Per-member
checkboxes with tri-state "select all" on each Group Check row, subset
bulk actions ("Rename selected", etc.) when fewer than all members are
checked, a new expand/collapse toggle separate from keyboard focus, a
radio quick-pick above the Rename editor so accepting a "found" spelling
never requires typing (Group Check and Item Check's bulk toolbar), and
live per-item/per-group confidence badges that jump to 100% once a member
is reviewer-decided -- see
`docs/detection/group-check-python-parity-revision.md`.

**v2026-07-29.01** -- Command bar + inline editors revision. The command
bar moved above the stage body and its text now changes with focus context
(Not Quite open vs. not, an inline editor open vs. not) instead of being
fixed per stage; every button's redundant "(k)"/"(n)"/etc. hint was removed
to match. `window.prompt()` is gone -- Rename and Redact (Item Check,
Ambiguity Check, the bulk-selection toolbar, and Not Quite's per-member
actions) now open an inline text editor in place. Root-caused and fixed a
real defect where the keyboard "n"/"r" shortcuts silently did nothing in
Item Check/Ambiguity Check and inside an open Not Quite panel -- see
`docs/detection/command-bar-inline-editors-revision.md`. Also: the version
label now always carries a same-day counter (`.01`, `.02`, ...), not just a
bare date, so a same-day refresh can prove it picked up a change.

**v2026-07-29** -- Versioning introduced. The app header's plain-text
"DocScrub-Web" title is replaced with the DocScrub logo
(`assets/docscrub.png`), and this small version label is added next to it
so it's obvious at a glance whether the page you're looking at is current.
Also the day's Group Check revision landed (compact color-coded rows,
arrow-key navigation now follows whatever sort order is on screen instead
of a fixed structural order, Not Quite auto-collapses to a single decision
once every member agrees) -- see `docs/detection/group-check-revision.md`.
