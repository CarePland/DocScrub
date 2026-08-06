# Review Scope, Pass 1 — Implementation Findings

**Date:** 2026-08-03 · **Version:** v2026-08-03.02
**Instruction (AG):** Pass 1 only — ReviewScope model + `currentScope` resolver; single-scope-consumer invariant; permanent inspector shell in Item Check; single-item detail experience unchanged; stage-remainder zero state from the current pool; decision provenance at the choke point if clean; report state-model conflicts with the proposed precedence rule before working around them.

---

## 1. What shipped

| Piece | Where |
| --- | --- |
| Scope model + resolver + descriptor (pure) | `src/ui/reviewScope.ts` (new) |
| The single assembler `currentReviewScope()` | `src/ui/app.ts` — the ONLY `resolveReviewScope` call site (ui-smoke-enforced) |
| Permanent inspector (workspace-level 60/40 split) | `renderTriageQueue` → `renderScopeInspector`; CSS `.scope-split`/`.scope-inspector` in `index.html` |
| Zero state (stage-remainder) | Inspector renders the queue's own triage sections — label, count, explanation, member tokens — over the displayed remaining work, both axes (items + relationship cards) |
| Selection state | Same partition presentation over the checked ids, plus Clear selection; actions deliberately remain on the section headings (see §3.4) |
| Scope ladder | Escape widens (item → remainder; card cursor stands down first); Enter/↓ return; `scopeWidenedFrom` reconciled at render top, expiring on any focus movement |
| Mis-target guard | `handleScopeModeKey` — item-targeted keys refuse with narration while a wider scope is active; section digits pass through via the same `sectionActionDigitAssignments` pair the renderer paints |
| Decision provenance | `scope?: string` on the four candidate commands + `bulkApplyDecision` (Commands.ts); stamped once at `dispatchReviewWithVisibleAdvance`; copied into `candidate-decided`/`bulk-decided` **event payloads only** — never onto `CandidateDecision` |
| Verification | `verify/review-scope-verification.ts` (24/24, new) + 9 structural checks in ui-smoke; full 45-suite battery green, `tsc` + full build clean |

Ambiguity Check, Group Check, Type Check, QA: untouched, per the pass boundary. Item Check's List and By Category views: untouched (see §3.1).

## 2. State-model conflicts with the proposed precedence rule — reported, per instruction

These four are the places the approved design's precedence rule ("selection wins over focus") met the shipped state model and could not be implemented as literally stated. None were worked around silently; each resolution is recorded here for your verdict.

**2.1 "Selection wins" vs. the keyboard grammar's first law ("plain key = focused object").**
Making selection outrank focus for *keyboard targeting* would have K silently decide N items — and the grammar's plain-key law, plus the section-scoped digit vocabulary shipped yesterday, already answer "how do wider sets get acted on" (explicit scope-level affordances). **Resolution:** scope precedence governs what the inspector *explains* and what scope-level actions *target*; plain letters stay focus-targeted by law. While the focused row is parked under a wider scope, letters **refuse with guidance** rather than act on a row whose panel is not on screen (the card-targeted-letters lesson) or silently retarget at N items. The command-bar legend switches vocabulary in the same render, off the same resolver, so paint and keystroke agree.

**2.2 "Zero state on arrival" vs. always-reconciled focus.**
`FocusNavigator.reconcile()` keeps focus on an item at all times and records no reviewer-vs-automatic provenance — "nothing is explicitly selected" is *unrepresentable* on arrival. Options were (a) a focus-provenance bit (new state, many touch points, the two-sources-of-truth failure class), (b) changing stage-entry behavior (domain change, out of pass), or (c) an explicit widening act. **Resolution:** (c) — Escape widens to the remainder scope, extending the existing "out one level" ladder upward by one rung; Enter/↓ re-narrow symmetrically. On arrival the inspector shows the focused item (current behavior preserved); the zero state is one Escape away. **Open product question for you:** should entering Item Check land on the zero state instead? That requires (a) or (b) and changes what the reviewer sees first — deliberately not decided in Pass 1.

**2.3 "Highlight implies detail" vs. wider scopes.**
Your 2026-08-02 law says a highlighted row always shows its detail. A wider scope needs the pane for the scope content, so the focused row cannot keep full highlight. **Resolution:** the parked cursor — precedent is the rows-then-cards seam, which already parks the row cursor while the card cursor is the working object. Parked = dashed outline + hollow ▷: *position without activation*, so the law's spirit (highlight = working object = detail shown) holds; exactly one surface reads as "what I'm holding." Note the consequence: **checking the first checkbox now visibly parks the focused row and swaps the pane to the selection summary** — this is the proposal's own state 3, but it is a behavior change on yesterday's selection surface; flagged for your real-use verdict.

**2.4 The card cursor (`structuralCardFocusPending`) ranks above selection, not below.**
The design sketch had selection second only to nothing. But the card cursor is an explicit "working the cards now" state whose letters already act on the card by law; ranking it below selection would make the inspector disagree with what K does while a card is expanded. **Resolution:** precedence is artifact-focus > selection > item-focus > stage-remainder (suite-pinned). Card behavior is byte-identical to before; the inspector simply names the card and points at it.

## 3. Judgment calls (underspecified in the instruction, documented per the standard)

1. **Surface: Triage view only.** "The inspector shell in Item Check" was implemented on the sectioned-queue surface — the only Item Check surface with the proposal's left-inspector/right-results geometry (the side-by-side pane shipped there yesterday). By Category and List render detail inline/above and would each need their own layout restructure; whether they adopt the inspector or retire is the Pass 2 decision the architecture already queued (Triage-vs-By-Category consolidation). If you meant the inspector to reach the *default* (By Category) view in Pass 1, say so and I'll treat that as the next increment.
2. **Permanence supersedes "reverts to standard grid."** The always-populated inspector removes the full-width-grid state on this surface, superseding §1 of yesterday's side-by-side finding (its ui-smoke assertion was *revised with a disclosure comment*, not deleted). Ambiguity Check keeps the per-section split verbatim.
3. **Zero state describes the *displayed* queue,** not the un-narrowed pool — the ONE-POOL "rows on screen and counts never disagree" contract; a note appears when search/filters narrow it.
4. **No actions inside the inspector yet.** The zero/selection states point at the section headings' green buttons (which already scope to checked items via `headingActionScope`). One dispatch surface, no duplication; scope-level actions inside the inspector are Pass 3's layer.
5. **Escape does not clear a selection** (one keystroke destroying checkbox work = the tri-state-select-all failure); clearing stays explicit. Escape also releases a Space-held panel when widening (out-one-level applies to it).
6. **Provenance = "scope the reviewer was working in," not "set acted on."** The command's own candidateIds record the applied set; the stamp records context (`item-check/item:…`, `/selection:N`, `/artifact:…`, `/remainder:N`). It lives in the event log (immutable history — no invalidation problem, the exact trap the provenance-gap investigation identified for state-side storage) and is spread-if-present, so unstamped commands are byte-identical to pre-feature. Per-candidate events inside a bulk batch now carry it too, which incidentally makes bulk-vs-individual history distinguishable for the first time.

## 4. Verification

45/45 suites pass (new: review-scope-verification 24/24; ui-smoke extended to 40/40 including the single-call-site invariant, pipeline ordering, and CSS contracts). `tsc --noEmit` and the full `tsc` build both clean. Zero regressions; the one revised assertion is disclosed in §3.2.

**Browser validation pending (Andrew, via `start-server.command`)** — the checklist, in priority order:

1. Triage view: inspector shows the focused item's panel exactly as before (content, scheme, ↓-enters/Tab-leaves, editors).
2. Escape → zero state (sections, counts, explanations, member chips); Enter/↓ → back; arrows from widened → move and re-narrow.
3. Check two boxes → pane swaps to selection summary, focused row parks (dashed, ▷); K refuses with the narrated hint; section digit still fires on the checked subset; Clear selection restores.
4. Card cursor: arrow into cards → inspector names the card; card letters/digits unchanged; Escape stands the cursor down.
5. Legend switches vocabulary in each scope; status-region narration reads sensibly.
6. decisions.json/audit: `scope` values appear on new events; an old session loads unchanged.

## 5. Files touched

`src/ui/reviewScope.ts` (new) · `src/ui/app.ts` · `src/domain/Commands.ts` · `src/engines/review/session.ts` · `index.html` · `src/ui/version.ts` · `docs/architecture/design-notes.md` · `verify/review-scope-verification.ts` (new) · `verify/ui-smoke.ts`
