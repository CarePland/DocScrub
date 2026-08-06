# Diagnostic Scoring UI (Temporary Development Feature) — Findings

Date: 2026-07-30. Version: `v2026-07-30.01`.
Spec: Andrew's "Add Diagnostic Scoring UI (Temporary Development Feature)"
instruction (in chat), implemented per the standing Implementation
Philosophy (`docs/architecture/implementation-philosophy.md`).

Status: implementation complete, all suites green, **browser validation
pending** (checklist below — same standing Cowork-sandbox limitation as
prior passes; Andrew runs `start-server.command`).

## What was built

Three metrics on the stage-tab line, flush-right, plain labels with
percentages (no gauges, no new colors, no large type), plus a temporary
diagnostic text area between the tabs and the scores that answers "why did
the score just change?" without logs or devtools. Stage tabs themselves
are byte-identical in behavior and rendering — they now sit inside a
`.stage-tab-row` flex container, nothing else about them changed.

- **Extraction** — automatic processing success, from extraction results
  only: processing warnings (−3 each), unsupported content features (−5
  each), non-blank embedded images (−5 each), from 100, clamped to
  [0, 100]. All three inputs are immutable for a loaded document, so the
  metric stabilizes the moment extraction completes — by construction,
  not caching.
- **Review** — reviewer-work completion: pooled resolved-item fraction
  across ambiguity-check, group-check, and item-check, read from the SAME
  `StageStatus` values the stage tabs already display (stages.ts's rule —
  never a second "is this resolved" formula).
- **Overall** — document readiness:
  `0.30·extraction + 0.55·review + 0.15·(verified-and-passing ? 100 : 0)
  − 10·QA warning − 25·QA blocker`, clamped. QA findings count only while
  the verification is CURRENT (Workspace's existing staleness rule, read
  from `readiness`, never re-derived).

All formulas are first-guess magnitudes and **expected to change** with
real-world tuning — that is this feature's entire purpose.

## Architecture: one calculation path

`src/ui/documentScores.ts` (pure module, no DOM — same convention as
`itemCheckQuery.ts`/`visibleListAdvance.ts`):

- `computeDocumentScores()` emits the three metric values AND the leaf
  factor values (`Record<ScoreFactorId, number>`) they were computed
  from, in one pass.
- `explainScoreChange(prev, next)` derives the justification purely by
  diffing two such reports; it performs no scoring and reads nothing the
  scorer didn't emit. The explanation cannot describe a change the scores
  didn't undergo, or miss one they did, because neither has an
  independent input. This satisfies the spec's "same calculation path"
  requirement structurally, not by discipline.
- Factor phrasings live in the same module as the factors
  (`FACTOR_PHRASING`, a `Record` keyed by `ScoreFactorId` — the compiler
  rejects a factor without an explanation). Refining the model later is
  local: change a formula or add a factor + phrasing in one file; the
  diff/display machinery is untouched.

`app.ts` holds only two render-to-render slots (`lastScoreReport` for
diffing consecutive renders, `lastScoreChange` so the latest
justification survives non-scoring renders like autosave ticks instead of
flickering away) — presentation memory in the `lastRenderedFocusedItemId`
sense, not duplicated domain state; scores are recomputed fresh from
`WorkspaceState` every render.

## Judgment calls (underspecified points, disclosed per the standard)

1. **"Blank" image definition.** Blank = zero-byte media part, or a
   PNG/GIF whose header declares a 0/1-pixel dimension (the classic 1×1
   spacer). Alternatives considered: byte-size threshold (arbitrary;
   wrongly ignores small real images), decoding pixels for uniform color
   (needs a decoder or canvas — async + DOM-dependent, over-engineering
   for a temporary diagnostic). JPEG/EMF/WMF are never treated as blank
   (no fixed-offset dimensions). Reviewer impact if too narrow: a
   visually-blank-but-nonempty image deducts and announces itself in the
   diagnostic line — exactly the misbehavior this UI exists to surface.
   **This is the definition most worth Andrew's correction if "blank"
   meant something else.**
2. **Where images are detected.** DocumentParser never looked at
   `word/media/*` at all; rather than extending the parser and the
   DocumentModel schema (v6 — fixture/serialization blast radius), the
   scorer scans `sourceArchive.parts` (already on the model) directly.
   Smallest change; extraction signals still come only from the parse.
   If image handling ever becomes a real pipeline concern (alt-text,
   OCR), it should move into DocumentParser then.
3. **Every non-blank embedded image counts as an unsupported object**,
   because this pipeline cannot inspect image content for PII (no OCR).
4. **Review pools items across stages** (one item = one unit of work,
   however many the stage has) rather than averaging per-stage
   percentages — a 3-item ambiguity list shouldn't outweigh a 200-item
   Item Check. A group and its members are separate work units; deciding
   all members resolves the group too, so one action can honestly emit
   both "Entity group completed" and "N additional items completed".
5. **QA and Extract Review are named by the spec as reviewer work but
   excluded from Review for now** — this build has no interactive QA
   model (`render()`'s own qa branch says so) and no Extract Review
   stage. Each joins `REVIEW_STAGES` + the factor table when it gains
   real reviewer actions; QA meanwhile affects Overall via verification
   findings.
6. **Overall weights** (0.30/0.55/0.15, −10/−25) are first-guess; the
   0.15 verified component makes "reviewed but never verified" visibly
   not-ready, matching `readiness.exportEnabled`'s gate. Consequence
   worth knowing before live use: changing any decision after Generate
   Output drops Overall by ~15 points with the reason "Verification no
   longer current (decisions changed)" — intended, but it will be the
   most dramatic single movement Andrew sees.
7. **Wording**: item-check completions phrase as "items", not the spec
   example's "entities" (this codebase reserves "entity" for entity
   groups). Spec examples were treated as illustrative shapes, which the
   output matches exactly (signed one-decimal deltas, blank line,
   reasons).
8. **Precision**: scores computed to 0.1 (deltas are routinely
   sub-integer); the three labels display whole percentages per the
   spec's mock; deltas display one decimal per the spec's examples.
9. **Persistence of the justification**: it stays until superseded by
   the next real change (autosave/panel renders don't clear it) and
   clears on loading a different document. No timers, no animation.
10. **No keyboard surface added** — the diagnostic is read-only text;
    nothing joins the key grammar or focus regions.

## Verification

- New suite `verify/document-scores-verification.ts` — **45/45**:
  blank-image rule, extraction deductions/clamp, pooled review fraction +
  rounding, overall composition (unverified gap, verified component,
  warning/blocker deductions, stale-verification neutrality), diff
  behavior (null on no change, null across documents, singular/plural
  phrasing, decrease phrasing, delta signs/rounding), and the exact
  formatted text shape from the spec's example.
- Full battery: **all 27 `verify/*.ts` files pass** (26 pre-existing —
  zero regressions; `ls verify/*.ts | wc -l` = 27 including the
  `fixture-io.ts` helper). `npx tsc --noEmit` clean; full `npm run build`
  (emit to `dist/`) clean.
- Not coverable in Node (disclosed): the `.stage-tab-row` layout, and the
  render-to-render carry of the justification across autosave renders.

## Browser validation checklist (pending — Andrew)

1. Load a real document: three metrics appear flush-right on the
   stage-tab line; tabs unchanged; nothing wraps oddly at your usual
   window width. Extraction settles immediately and stays fixed.
2. Decide one Item Check candidate: Review/Overall deltas + "1 additional
   item completed" appear; the text SURVIVES the next autosave re-render
   (watch the persistence line change without the diagnostic clearing).
3. Resolve an ambiguity: "Resolved ambiguity" (singular phrasing).
4. Bulk-apply to several candidates: plural phrasing, one line.
5. Complete a group (any path — bulk button or per-member): expect BOTH a
   group line and an items line (judgment call 4).
6. Generate Output on a fully reviewed doc: Overall jumps ~+15, "Output
   verified against current decisions". Then change any decision:
   Overall −15, "Verification no longer current (decisions changed)".
7. A document with embedded images: each real image −5 Extraction; a 1×1
   spacer or zero-byte image is silently ignored (no line, no deduction).
8. Load a second document: diagnostic area starts empty (no cross-
   document ghost).
