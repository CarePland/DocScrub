# Feature 001: Group Check bulk actions

## Amendment (2026-07-28): terminology and scope revision

Everything below this note is the original Feature 001 record, preserved as-is. It should now be read with one correction in mind, made directly by Andrew:

The "Confirm/Reject/Flatten, deliberately narrower than Python's five-way vocabulary" framing throughout this document (including the "What was not built" and "Keyboard integration" sections) was **not an accurate account of the instruction that produced it**. Andrew's own explanation: the three-term set was his attempt to find transferable, standardized terms that would read consistently across every "cell" region of the app — Item Check, Not Quite, and Group Check alike — not a deliberate scope narrowing. It broke down specifically because "Flatten" reads as meaningless when a group has exactly one member.

The corrected vocabulary matches Item Check's own decision terms exactly: **Rename / Keep-as-is / Redact / Ignore / Not Quite**. Concretely, as implemented in the v9 revision (`src/domain/Commands.ts`'s v9 changelog note):

- `confirmGroup` (`k`) and `flattenGroup` (`n`) are **unchanged** at the command level — only their UI labels changed, to "Keep as-is" and "Rename" respectively.
- `redactGroup` (`r`) and `ignoreGroup` (`i`) are **new**, bulk-applying Redact/Ignore to every group member via the same pattern `confirmGroup` already established. These fill the `r`/`i` keyboard slots this document's own "Keyboard integration" section describes as deliberately reserved — the internal evidence (that reservation, made before this correction was known) turned out to anticipate the eventual intent correctly.
- `rejectGroup` (`x`) is **removed** — command, keybinding, and UI button. It has no counterpart in the corrected vocabulary and no Python precedent. This specific removal was not explicitly named in Andrew's correction (he named the five terms; removing Reject follows from there being no sixth term for it) — flagged here for transparency rather than presented as unambiguously instructed.
- `EntityGroupDecision.decision`'s `"Rejected"` value remains in the schema for backward compatibility with sessions saved before this revision; no command produces it going forward.

See `docs/architecture/review-workspace-specification.md` §4.8 and §7.3 for the corrected specification, and `docs/architecture/review-workspace-specification-validation.md` observation #11 for the design-review finding that prompted this correction. Verification suite (`verify/group-bulk-actions-verification.ts`) and `AuditExporter.ts`/`ReviewSession.ts` doc comments updated accordingly; zero regression across the full suite battery (all 17 suites re-run, one `focus-navigator-verification.ts` test updated to assert the new key resolution rather than the old one, consistent with this project's existing precedent for updating tests whose assertions describe behavior that intentionally changed rather than treating them as a source of truth).

---

First feature built after the migration itself was declared complete (Gates
A-E, `docs/detection/phase-12-findings.md`). This is normal product
evolution, not a migration task -- the existing architecture (ReviewEngine
owns review semantics, Workspace orchestrates, CommandDispatcher routes,
FocusNavigator reconciles) is extended, not redesigned.

## Design rationale

Gate E's side-by-side acceptance review flagged one real, consistently-
documented gap: Python's real UI lets a reviewer resolve an entire proposed
entity group in one action (`local_web_app.py`'s group-level `k`/`n`/`r`/`i`/
`q` keyboard vocabulary -- Keep as-is/Flatten/Redact/Ignore/Not Quite); this
TS port only ever had Not Quite (member-by-member). The gap was deferred at
Phase 8, reaffirmed at Phase 9, and never revisited at Phase 10 -- three
phases of consistent, non-silent deferral, not an oversight discovered late.
Andrew's instruction closes it with exactly three operations -- Confirm,
Reject, Flatten -- deliberately narrower than Python's full five-way
vocabulary (Redact/Ignore-at-the-group-level are NOT implemented; see
"What was not built" below).

## Command semantics

Three additive `ReviewCommand` variants (`src/domain/Commands.ts` v5):
`confirmGroup`, `rejectGroup`, `flattenGroup` -- each takes only a `groupId`.

**Confirm Group** -- accepts the proposed grouping exactly as presented.
Bulk-applies **Keep** to every member (via the exact same `decideCandidate()`
helper every other command already uses -- see "Correctness finding" below
for why this was necessary rather than optional), then stamps an
`EntityGroupDecision` with `decision: "Confirmed"` and
`confirmedMemberCandidateIds` set to every proposed member. Matches Python's
real group-level "k" (Keep as-is) action.

**Reject Group** -- rejects the proposed grouping. Touches **no**
`CandidateDecision` at all; stamps `decision: "Rejected"` with
`confirmedMemberCandidateIds: []`. Since `coverage.ts`'s
`coveredOccurrenceIdsByResolvedGroups()` only credits a group's coverage from
`confirmedMemberCandidateIds`, an empty array means every member falls back
to its own ordinary (still-unresolved) status -- "each entity remains
reviewable independently" falls out of the existing coverage rule for free,
with no special-case code needed anywhere.

**Flatten Group** -- bulk-applies **Rename** to every member, with
replacement text equal to the group's own already-computed `canonicalName`
(EntityResolutionEngine's output, not new logic), then stamps
`decision: "Refined"` -- the same value `completeNotQuite` produces, because
the resulting session state (every member individually decided, canonical
group membership stamped) is exactly what a manual Not-Quite-then-rename-
every-member-then-complete pass would produce. This is a direct instance of
Andrew's own instruction: "should produce the same result a reviewer would
obtain by manually confirming every proposed relationship."

**Guard clause, all three**: rejected if a Not Quite transaction is
currently open for the SAME group (`"Not Quite is open for this group; exit
or complete it first"`) -- mirrors `enterNotQuite`'s own existing mutual-
exclusion rule, scoped to the target group only. A bulk action on a
DIFFERENT group while Not Quite is open elsewhere is allowed, matching how
Python's own group-level shortcuts resolve per-group, not globally.

**Precedence**: none of the three commands is exclusive of the others or of
Not Quite. Dispatching any group command overwrites whatever the group's
prior decision was (Confirmed -> Refined via a later Not Quite pass, for
example) -- the same "no precedence table, last write wins" rule every
candidate decision already follows. Verified directly (see "Mixed workflow"
below).

## Why ReviewEngine owns the behavior

All three cases live in `src/engines/review/session.ts`'s
`applyReviewCommand()` switch -- the exact same function every existing
review command is implemented in. `CommandDispatcher.dispatchReview()`
required **zero code changes**: it already routes any `ReviewCommand`
generically to `ReviewEngine.dispatch()` and calls
`Workspace.reconcileFocus()` on success, with no per-command-type branching.
`Workspace` required no orchestration changes either. This is not an
accident of convenience -- it is the architecture doing exactly what it was
built to do: ReviewEngine is the one and only owner of review semantics: no
new command should ever need Workspace or CommandDispatcher to know
anything about it beyond its `family`.

## What was not built

Python's real group-level vocabulary also has Redact and Ignore (bulk-apply
those decisions to every member). Andrew's instruction names exactly three
operations; building the other two would be exactly the "expand scope
beyond these bulk actions" the instruction explicitly rules out. The
keyboard mapping (see below) deliberately leaves `r`/`i` unbound at the
group level rather than repurposing them, so a future feature adding real
group-level Redact/Ignore has a clean, non-conflicting slot to land in.

`entity_group_exclusions` (Python's per-member "exclude this candidate from
the group before confirming" mechanic) also remains unbuilt -- not
requested, and Not Quite's per-member actions already cover the same need
at finer granularity.

## Correctness finding: Confirm Group must decide candidates too

`DocumentRebuilder` (`src/io/DocumentRebuilder.ts`) reads only
`session.candidateDecisions` when deciding what to redact -- it has no
awareness of `groupDecisions` at all. An earlier draft of `confirmGroup`
recorded only the `EntityGroupDecision` and left every member's
`candidateDecisions` entry untouched, reasoning that group coverage alone
would make them read as "resolved." That is true for FocusNavigator/
readiness purposes (`coverage.ts` already credits group coverage), but it
produces an audit record showing `decision: "Undecided"` next to
`resolvedStatus: "resolved"` for the same candidate -- a confusing,
unexplainable-looking entry, and a state no prior phase of this migration
ever produced (every earlier path to "resolved via group coverage" also
happened to leave a real per-candidate decision behind). Fixed by having
Confirm Group bulk-apply Keep to every member, matching Python's real
"Keep as-is" semantics exactly rather than inventing new behavior.

## Two real defects found during implementation and browser validation

Both are pre-existing latent defects that predate this feature -- Flatten
Group is simply the first code path capable of triggering them in normal,
expected usage (not an edge case; it happens whenever the canonical member
of a flattened group is renamed to its own already-correct text, which is
common).

**1. Infinite loop in `ooxml/rebuild.ts`'s `redactParagraph()`.** Its
replace-loop re-scanned from index 0 on every iteration
(`flatText.indexOf(search)`); if `replace === search` (or `replace`
contains `search`), the just-inserted replacement is itself a fresh match,
and the loop never terminates. Confirmed via direct reproduction:
`generateOutput()` never returned after flattening a group whose canonical
name equalled one member's own text. Fixed by tracking a `searchFrom`
cursor that advances past each replacement's own inserted text
(`matchStart + replace.length`) rather than rescanning from 0 -- the
standard fix for this class of bug, and behaviorally IDENTICAL to the old
code for every one of the 13 existing fixtures (none of which ever produced
`replace` containing `search`) -- confirmed by a full, zero-regression
re-run of all prior suites (442 checks total, up from 356 at Gate E) after
the fix.

**2. Silent verification failure in `OutputVerifier.ts`.** The ordinary
body/header/footer/comments rescan already correctly set
`rescanFoundOriginalValues` (and therefore `passed: false`) whenever a
Redact/Rename candidate's original text was still detectable post-rebuild,
but -- unlike the hyperlink-target and tracked-changes cases in the same
file -- never pushed a `FidelityFinding` to explain why. This produced a
literally unexplainable "Verification: FAILED, Warnings: 0, Blockers: 0"
state, confirmed live in the real browser. This is exactly the same class
of gap ADR's explainability principle exists to prevent. Fixed by pushing a
blocker-severity `body-text-residual-pii` finding, matching the existing
hyperlink-target/tracked-changes pattern exactly. This does not change what
counts as failure -- see "Open question for Andrew" below -- only ensures a
failure is never silent.

## Open question for Andrew

Should a Rename whose replacement text is identical to the candidate's own
original text (the common case for Flatten Group, whenever the canonical
member IS the flattened text) count as a verification failure at all? The
current, conservative answer -- yes, flagged as a blocker, fully explained
-- was chosen because a PII tool erring toward "flag for review" is safer
than silently treating a no-op rename as success. But this is a product
policy call, not a pure engineering one, and changing it would touch
`OutputVerifier`'s shared verification semantics for every fixture, not
just Group Check -- deliberately not decided unilaterally here.

## Focus behavior

No special-case logic exists for bulk commands. `CommandDispatcher
.dispatchReview()` calls `Workspace.reconcileFocus()` after every
successful `review.*` command, bulk or not, exactly as it already did for
Keep/Rename/Redact/Ignore/Not Quite. Verified directly: focus remains a
valid, resolvable target after every bulk action, unresolved counts update
correctly, and readiness/export-gating follow the same pre-existing rules
with no bulk-specific branches anywhere in `Workspace.ts`.

## Keyboard integration

`src/engines/navigation/keymap.ts`'s `groupCheckShortcut()` gained three
letters: `k` (Confirm, matching Python's real "Keep as-is" letter exactly),
`n` (Flatten, matching Python's own "n" -> Flatten mapping documented in
Phase 9's findings), and `x` (Reject -- a new letter, since Andrew's
three-command vocabulary has no Python analog for this specific action).
`q` (Not Quite) is unchanged. `r`/`i` remain deliberately unbound at the
group level (see "What was not built" above) -- reviewers already read `r`
as Redact everywhere else in this app; binding it to something else at the
group level would be exactly the "conflicting shortcuts" risk the feature
instruction warns against.

## Save/Resume

No new persistence mechanism. `EntityGroupDecision` (the schema `Confirmed`/
`Rejected`/`Refined` already lived in since ADR-008) serializes exactly like
every other review decision, through the same `WorkspaceSaveFile`/
`ReviewSession` machinery. Verified directly: save, reload into a brand-new
Workspace/dispatcher, and confirm `groupDecisions`/`candidateDecisions`
match exactly; verification correctly reads as stale (null) immediately
after a fresh reload, same as any other reload scenario.

## Verification

`verify/group-bulk-actions-verification.ts` (new, 83 checks), exercised
through the real `ReviewWorkspace`/`WorkspaceCommandDispatcher` against
`entity-resolution-001` (the only fixture with real multi-candidate entity
groups) -- never by reaching into `ReviewEngine`/`session.ts` internals.
Covers: Confirm Group, Reject Group, Flatten Group (each in isolation);
Flatten Group followed by `generateOutput()` (regression coverage for both
defects above -- confirms termination under 5 seconds and confirms any
verification failure carries a real finding); bulk action after a prior
manual decision (Flatten correctly overwrites it, last-write-wins); a mixed
workflow (Confirm Group, then Not Quite on the SAME group, then complete --
the group decision correctly moves Confirmed -> Refined); rejection of a
bulk action while Not Quite is open for the same group; a bulk action on a
DIFFERENT group succeeding while Not Quite is open elsewhere; unknown-group
rejection for all three commands; focus reconciliation (no error, valid
target); unresolved-count updates (drops by exactly the confirmed group's
member count); export readiness (a mixed bulk + individual workflow reaches
`reviewComplete` and `exportEnabled` via the pre-existing rules only);
save/reload equivalence; and audit representation (Confirmed/Rejected/
Refined groups all present, `confirmedMemberCandidateIds` correct for each,
the `wentThroughNotQuite` fix -- see below -- verified false for a Flatten-
produced Refined group, a Confirm-Group member's audited decision reading
Keep rather than Undecided, and no raw candidate text leaking into the
audit report from any bulk-produced entry).

**AuditExporter fix, found while building this suite**: `flattenGroup`
deliberately produces the same `EntityGroupDecision.decision` value
(`"Refined"`) `completeNotQuite` does, since the resulting state is
equivalent -- but `AuditExporter.ts`'s `buildEntityGroups()` previously
inferred `wentThroughNotQuite: decision === "Refined"`, which was only ever
correct because `"Refined"` had exactly one producer before this feature.
Fixed by deriving `wentThroughNotQuite` from the event log instead (the
most recent event affecting the group -- `not-quite-completed` vs.
`group-decided` -- correctly distinguishes the two paths). No `AuditRecord`
schema change was needed.

All prior suites re-run with zero regression: production-parity 14/14,
detection-parity 12/12, quality-parity 12/12, entity-resolution-parity
13/13, occurrence-classification-parity 13/13, sequence-ratio-smoke 9/9,
scoring-smoke 12/12, review-engine-verification 43/43,
focus-navigator-verification 99/99 (up from 96/96 -- one pre-existing test
asserted `"k"` had no meaning at Group Check; updated to assert the new,
intended resolution instead of the now-outdated absence, plus new checks
for `x`/`n` and confirming `r` remains unbound), workspace-integration
65/65, audit-exporter-verification 63/63, ui-smoke 4/4. `tsc --noEmit` and
a real `tsc` emit both clean. **442 total checks**, up from Gate E's 356.

## Browser validation

Real Chrome via `claude-in-chrome`, against `http://localhost:8000/
index.html` served by Andrew's own `npm run serve`, using the same
`entity-resolution-001` fixture. Confirmed: all three bulk buttons render
correctly on every Group Check row alongside the existing Not Quite button;
mouse clicks on Confirm/Flatten/Reject each produce the correct group label
suffix (`-- Confirmed`/`-- Refined`/`-- Rejected`) and correct Group Check/
Item Check unresolved-count updates; all three keyboard shortcuts (`k`/`n`/
`x`) produce byte-identical results to the equivalent mouse clicks, with
focus genuinely at `<body>` at dispatch time (matching Phase 10.1's
confirmed finding about focus behavior after a full re-render); Reject
Group's members correctly remain individually reviewable in Item Check
afterward; Flatten Group's members correctly show `-- Rename` with the
canonical text; `Generate Output` after a Flatten-heavy workflow completes
promptly (not the infinite loop reproduced before the rebuild.ts fix) and
the resulting "Verification: FAILED" state now shows real, explained
blocker findings (not a silent 0/0) -- both defects above were found and
fixed as a direct result of this browser pass, not discovered separately.
Zero console errors throughout.

## Intentional differences from Python

Beyond the three-vs-five command-count difference already covered above:
Python's group-level bulk actions are a client-side keydown convenience
layered on top of the same `/api/decision`/`/api/entity-group` endpoints
ordinary per-candidate/per-group actions use, with no distinct server-side
concept of "this decision came from a bulk action" at all. This TS
implementation is the same in spirit (bulk actions reuse `decideCandidate()`
exactly, producing ordinary `CandidateDecision`/`EntityGroupDecision`
records indistinguishable in shape from any other path) -- except for the
one place provenance genuinely matters for honest auditing:
`wentThroughNotQuite`, which now correctly reads `false` for a
Flatten-produced `"Refined"` group rather than conflating it with a real
manual Not Quite completion. This is a strictly more honest audit record
than Python's own, which has no equivalent distinction to make in the first
place (its `entity_group_reviews` log records real provenance for every
group action, bulk or Not-Quite, so this same conflation risk never existed
there -- a genuine architectural advantage of building the projection from
the event log rather than from the decision label alone, worth carrying
forward as a general pattern).
