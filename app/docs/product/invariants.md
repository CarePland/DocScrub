# Invariants

Status: canonical
Last updated: 2026-07-30

How to read this document: these are DocScrub's named durable promises —
behavior that must survive refactors, UI revisions, and reviewer-
experience waves. Each entry has a stable kebab-case name (cite it by
name in specs, findings, and reviews), a behavioral definition, the
reason it exists, its practical consequences, and where it is verified.
An invariant is listed because the repository already enforces or
commits to it — not because it merely sounds desirable. Maturity markers
follow `../standards/documentation-standards.md`.

If an implementation change appears to require violating one of these:
**stop and surface the conflict.** Do not implement around an invariant
silently. Changing one is possible — see "Maintaining this set" at the
end — but it is a product decision, not an implementation detail.

---

### import-never-contests-state  [BUILT]

Decision Reuse fills gaps; it never overwrites an existing decision,
whether that decision is reviewer-authored or itself import-sourced.
`review.applyDecisionReuse` is the one review command that deliberately
refuses to replace existing state.

Why: an import that could contest state would let a stale file silently
undo present-session reviewer judgment.

Consequences: import runs at any time without risk; conflict handling is
unnecessary by construction; "re-import to fix" is never a valid design,
because re-import cannot change anything already decided.

Verified by: `verify/decision-reuse-verification.ts` (explicit
never-overwrite cases); `src/engines/review/session.ts`
(`applyDecisionReuse`); `docs/detection/feature-002-decision-reuse.md`.

Changing it: would need an ADR plus an explicit reviewer-facing conflict
UI design; the current rule is quoted in the specification (§9.4) as a
design principle, not an implementation accident.

### reviewer-is-the-decision-maker  [BUILT]

Automation detects, scores, groups, proposes, and recommends; only a
reviewer action creates or changes a decision. Nothing automatic ever
overrides a human decision. The one historical counterexample — entity
resolution silently auto-merging a first-name-only candidate into a
matching bucket — was classified as a defect and removed (ambiguity
anchor correction), not preserved.

Why: DocScrub's output is a legal/professional judgment artifact; its
trustworthiness rests on every decision having a human author (or a
human-authored import, distinguished as such).

Consequences: new automation may propose (recommendations, reuse
proposals, quick-picks) but must terminate in an explicit reviewer
action; bulk actions are reviewer-triggered aggregations, not automatic
resolution; confidence scores inform, never decide.

Verified by: `verify/ambiguity-anchor-verification.ts` (no silent merge);
`verify/decision-reuse-verification.ts` (deterministic tiers, overridable
results); specification §12 principle 2.

Changing it: effectively a different product; treat as out of scope
absent an explicit product decision by Andrew.

### ambiguity-link-preserves-surface-text  [BUILT]

Linking an ambiguous candidate to an identity applies Keep, never
Rename: the document's surface text is unchanged by the act of
identifying who it refers to.

Why: identity resolution and text alteration are different reviewer
intents; conflating them would let a link silently rewrite the document.

Consequences: any future ambiguity UI must keep link ≠ rename; a linked
candidate can still subsequently receive any ordinary decision.

Verified by: `verify/ambiguity-anchor-verification.ts`;
`docs/detection/ambiguity-anchor-correction.md`.

Changing it: requires an ADR; also touches audit semantics (a rename
carries replacement text into exports; a link must not).

### verification-staleness-is-derived  [BUILT]

Whether a verification result is current is computed fresh from state on
every read; it is never a stored boolean that something must remember to
set or clear. Any review command after `generateOutput` makes the prior
verification stale with no explicit invalidation call anywhere.

Why: tracked staleness flags drift; a stale "verified ✓" on a changed
document is precisely the failure a verification feature exists to
prevent.

Consequences: never cache a verification verdict across state changes;
new state-mutating commands get staleness handling for free and must not
add invalidation hooks.

Verified by: `verify/workspace-integration.ts` (staleness invalidation
with no explicit invalidation call in the test);
`docs/detection/phase-10-findings.md`. The same derive-don't-track rule
covers `wentThroughNotQuite` / `wasEverImported` (event-log-derived) and
group display outcomes (`groupDisplayDecision`).

Changing it: no known legitimate reason; a performance concern would be
addressed by memoization keyed on state identity, not by a mutable flag.

### audit-excludes-candidate-text  [BUILT]

Audit export artifacts do not carry raw candidate/source text beyond
what their purpose strictly requires. Two content-leak behaviors present
in the Python oracle's own exports were deliberately **not** replicated.

Why: the audit record proves what was reviewed and decided; shipping the
PII itself inside the audit artifact would recreate the exposure the
tool exists to remove.

Consequences: new audit projections derive from the canonical
`AuditRecord` schema and inherit its exclusions; adding a field that
carries source text requires explicit justification against this
invariant.

Verified by: `verify/audit-exporter-verification.ts` ("absence of
unnecessary source content" checks);
`docs/detection/phase-11-findings.md` (the two non-replicated leak
behaviors, recorded as deliberate).

Changing it: per-field ADR-level justification; default answer is no.

### engines-are-dom-free  [BUILT]

Domain engines (detection, quality, entity resolution, occurrence
classification, review, navigation, explanation, decision reuse) and the
workspace layer have no DOM dependencies. The keymap is the one allowed
thin adapter from a raw key event to a structured command, and even it
owns no DOM listener. UI renders state and dispatches commands; it never
implements domain behavior.

Why: this boundary is what makes the verification battery possible — the
entire engine surface runs and is verified under Node, browserlessly —
and it is why UI-layer revisions repeatedly land with "zero new domain
logic to cover."

Consequences: new reviewer-facing behavior decomposes into engine
capability + UI presentation; if a UI change needs new state semantics,
the semantics go in an engine/domain module and get suite coverage.

Verified by: structurally, every `verify/*.ts` suite (they run under
Node); `src/engines/navigation/keymap.ts`'s own contract;
reviewer-experience review PW-5.

Changing it: not negotiable in practice; it is the project's testing
strategy, not a style preference.

### decisions-are-always-reversible  [BUILT]

Any decision — including an imported one, and including a
bulk-action result — can be replaced at any time by simply making a new
decision. No decision is ever locked, and reversal is the same
interaction as deciding.

Why: reviewers change their minds with better context; a tool that makes
reversal costly or special-cased pressures reviewers toward premature
certainty (and toward not fixing mistakes).

Consequences: no "finalize" step may freeze decisions; stage completion
is derived and recomputes when a decision changes; export readiness
gating must tolerate a completed stage becoming incomplete again.

Verified by: `verify/review-engine-verification.ts` (decision precedence
and replacement); browser validation of reversing an already-decided
candidate (`docs/detection/workspace-interaction-revision.md`);
specification §12 principle 2.

Changing it: a true "lock/sign-off" feature would need to be additive
(an explicit, reviewer-visible state) and ADR'd; it must not quietly
repurpose existing decision mechanics.

### never-lose-reviewer-work  [BUILT — one designed edge open]

Reviewer progress survives interruption: autosave fires on load and
after every reviewer action, an explicit save exists, a real page
refresh recovers the session, wrong-document restores are rejected
rather than corrupting state, and IndexedDB being unavailable degrades
gracefully instead of blanking the app. In-progress Not Quite
transactions are never silently discarded.

The open edge [DESIGNED]: storage-quota exhaustion. `getQuotaStatus()`
exists and the persistence status line surfaces warn/error states, but
the ARB-flagged full contract — a proactive pre-failure warning
threshold plus a forced-export path — is not confirmed implemented
(specification §9.8). Until it is, quota exhaustion is the one known
path by which this promise could fail.

Why: the product's core posture — reviewers trust the tool with hours of
judgment work in a browser tab.

Consequences: any new reviewer-visible state must participate in
save/resume; persistence failures must be surfaced, never swallowed;
work on the quota contract closes a named gap and should say so.

Verified by: `verify/milestone-3-reviewer-productivity-verification.ts`;
`verify/workspace-integration.ts` (save → reload into a brand-new
workspace with exact state equality);
`docs/detection/milestone-3-reviewer-productivity.md` (the four real
bugs fixed, including the blank-page startup failure).

Changing it: not changeable in spirit; the quota edge is expected to be
closed toward the invariant, not relaxed away from it.

### no-silent-oracle-deviations  [BUILT — standing process]

Every intentional behavioral deviation from the Python oracle is
disclosed, classified (Andrew's five-category A–E scheme from Gate E),
and recorded in a findings document and/or fixture manifest — never
silently shipped. Where the oracle itself is defective, the defect is
fixed in DocScrub-Web and the deviation is disclosed (the ambiguity
anchor correction is the model case).

Why: the migration's entire acceptance argument (Gates A–E) rests on the
deviation ledger being complete; one silent deviation invalidates the
"zero unresolved behavioral differences" claim.

Consequences: parity-affecting changes update the relevant fixture
manifests and findings record in the same pass; "the oracle does X, we
do Y" is always written down with its classification, even when Y is
obviously better.

Verified by: `docs/detection/phase-12-findings.md` (the A–E
reclassification of every deviation, zero Category D/E);
`fixtures/domain-parity/*/manifest.json` disclosure notes;
`../architecture/implementation-philosophy.md` (standing requirement).

Changing it: as the product grows beyond ported scope, the oracle's
authority naturally narrows to ported behavior — that narrowing should
be recorded per-area in findings docs, not by dropping the disclosure
discipline.

---

## Maintaining this set

- Changing an invariant's **behavioral scope** requires an explicit,
  recorded decision — an ADR once `architecture/decisions/` exists
  (initiative Phase 2); until then, a dated findings-doc entry approved
  by Andrew.
- An implementation change that appears to violate an invariant must
  stop and surface the conflict rather than proceed — the same rule
  `../architecture/implementation-philosophy.md` already sets for under-specified
  requirements.
- Removal or replacement of an invariant requires the same recorded
  decision as a scope change, plus updating every document that cites it
  by name.
- Wording may be clarified freely; if the clarified wording would change
  what an implementer is allowed to do, it is a scope change, not a
  clarification.
- Add a new invariant when a behavior has become durable enough that
  future work should be stopped by it — with evidence, a verification
  source, and honest maturity markers, exactly as above.
