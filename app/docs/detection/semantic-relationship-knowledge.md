# Deterministic Semantic Relationship Knowledge — Findings

**Date:** 2026-07-30 · **Version:** v2026-07-30.04 · **Spec:** Andrew's "Deterministic Semantic Relationship Knowledge" prompt + `related_names_scored.csv` (canonical built-in dataset), implemented under `docs/architecture/implementation-philosophy.md`.
**Status:** Phase 1 implemented; Phase 2 architecture built (pass deferred — see below). All automated verification green (29 suites; new suite 30/30; **entity-resolution parity still 13/13**). Browser validation pending (checklist below).

---

## Architecture review (the deliverable, condensed)

**Where providers belong.** Curated semantic knowledge sits in a new `src/engines/knowledge/` layer, consumed by an **optional augmentation pass** (`src/engines/entity-resolution/semantic-augmentation.ts`) that runs *after* the faithful Python port. This placement was the crux: `resolution.ts` is oracle-locked (13-fixture parity suite), so knowledge must live strictly **above** the parity surface. `RegexEntityResolutionEngine` gains an optional constructor parameter; a bare engine — every parity/verification suite, and app.ts's display-recalculation instance — is **byte-identical to Python** (verified by suite: bare output contains no evidence fields and equals its pre-feature self; entity groups are never touched by augmentation). The Workspace wires the built-in providers for real loads. Classification: additive domain requirement (no Python counterpart).

**Common interface — yes.** `SemanticRelationshipProvider` (`id`, `termDomain`, `evidenceLabel`, `describe()`, `relationsOf(term)`, `strengthBetween(a,b)`) with the ordinal `RelationStrength 1–5` and its label vocabulary (Established/Strong/Credible/Weak/Speculative) as shared types. **Providers own knowledge; the augmentation pass owns policy** (which strings to ask about, where evidence lands, how strength maps to confidence). That split is what makes future providers cheap.

**How future providers plug in.** `termDomain` is the seam: `"name-token"` providers (related names; spelling/accented variants; transliterations) are consulted with `cleanToken`-normalized name tokens through the two existing passes; `"full-value"` providers (acronyms, organization aliases) will be consulted with whole normalized values by a third pass at the marked seam in the augmenter. User-confirmed aliases become a per-session provider the Workspace appends. None of these require touching the port, the engine interface again, or the reviewer workflow.

**Evidence weighting vs existing confidence.** A knowledge-derived option starts from the anchor's own **port-computed** confidence (same `scoreAnchorBucket` machinery, reused via newly-exported helpers — export keywords only, no logic change) and subtracts a linear penalty for the inexact name: `penalty = 24 − 4×strength` (S5→−4 … S1→−20), clamped to the port's own [35, 99] band. Proportional, monotonic, and printable in one sentence — no opaque scoring. Port-produced exact matches keep their untouched confidence.

**False positives vs explainability.** Guards: knowledge alone never proposes across *surnames* (Pass B requires exact surname match — "never sufficient by themselves"); Strength 1 entries still surface (deterministic honesty — "Randy" *is* in the curated data) but arrive visibly penalized and labeled *Speculative*; the **less-attested side asks the question** (Pass B proposes one direction only — fewer bucket members, then lower confidence, then greater key — so one relationship never becomes two mirrored proposals); nothing ever merges without `linkAmbiguousCandidate`.

**Persistence — existing machinery suffices, nothing new built.** Confirmed links flow through the unchanged `linkAmbiguousCandidate` → `ambiguityResolutions` + Keep decision + `entityRegistry`, exported/imported by the existing decision-reuse pipeline ("review once, apply everywhere"). No schema change, no new store; verified by the fact that this feature adds **zero** ReviewSession fields.

## What was implemented (Phase 1)

- **`related-names.data.ts`** — the canonical CSV embedded **verbatim** as data (generated from `related_names_scored.csv`; dataset version constant). *Judgment call:* embedded rather than `fetch()`ed because this repo deliberately has no bundler and the Node harness has no network; the file is still application data — replacing the dataset = regenerating one file + bumping its version string, no architectural change (the prompt's requirement). Alternative (runtime fetch of `assets/…csv`) rejected for the async startup failure path and harness invisibility.
- **`RelatedNameProvider`** — validates header and every row (3 fields, non-empty names, integer 1–5, no self-relations), skips bad rows with per-line warnings, degrades to an empty provider on an unusable file (app behaves exactly as pre-feature — graceful). Lowercase/trim normalization matching `cleanToken`; bidirectional index; duplicate pairs keep the strongest strength. Built-in load is memoized (`builtInSemanticRelationshipProviders`), warnings → console.
- **Augmentation Pass A** — bare first-name candidates gain anchor options whose first names are *related* (not just exact); the port's own exact-match options gain an `Exact first-name match ("andy")` evidence line so the whole proposal explains itself.
- **Augmentation Pass B** — cross-bucket full names (`Drew Goodloe` ↔ `Andrew Goodloe`: different first-initial buckets, invisible to the port) raise one ordinary identity proposal on the less-attested side with evidence `Same surname ("goodloe")` + the relationship line. (`Andy Goodloe` needs no help — same initial, same bucket, already grouped; verified.)
- **UI** — Possible identities options render their evidence as ✓-prefixed muted lines under the name/confidence row; options without evidence render exactly as before. Confidence % was already displayed (`Confidence: XX%` satisfied).

## Phase 2 (acronyms) — architecture built, pass deferred

The provider interface, strength vocabulary, evidence-line format, and the augmenter's `full-value` seam all accommodate an `AcronymProvider` as data + one additional pass. Deferred per the prompt's own gate ("do not implement… unless the architecture naturally accommodates it with **minimal additional complexity**"): the pass itself is small, but acronym candidates are typically *non-person* candidates, and non-person ambiguity proposals interact with `isShortPersonReference`-shaped stage assumptions that deserve their own careful pass rather than a rider on this one. The chain `Cal State LA ↔ CSULA ↔ California State University, Los Angeles` also wants a transitive-closure decision that should be designed deliberately. Both documented at the seam.

## Judgment calls (assumption · why · alternatives · impact)

1. **Penalty curve 24−4×strength** — linear per "proportionally"; anchored so S5 costs less than any port quality adjustment and S1 lands visibly low. Constants, trivially tunable.
2. **Strength 1 surfaces rather than being thresholded out** — the reviewer sees it labeled Speculative at low confidence; silently hiding curated data would be an opaque judgment. Flag if you'd prefer a floor (one constant).
3. **One-sided Pass B proposing** (less-attested asks) — avoids mirrored duplicates; deterministic tie-break documented in code.
4. **Every candidate in the less-attested bucket proposes** (buckets are usually size 1); a per-bucket single proposal would hide members. Disclosed.
5. **"Similar surrounding context" evidence** (from the prompt's example list) is not implemented — no deterministic context-similarity source exists yet; listed as a future evidence contributor, not silently faked.
6. **Empty provider still enables the augmenter** (annotating exact matches with evidence) — explainability shouldn't depend on the dataset being non-empty.

## Files changed

| File | Change |
|---|---|
| `src/engines/knowledge/SemanticRelationshipProvider.ts` | new — provider interface + strength vocabulary |
| `src/engines/knowledge/related-names.data.ts` | new — embedded canonical dataset (generated) |
| `src/engines/knowledge/RelatedNameProvider.ts` | new — loader/validator/provider + built-in memo |
| `src/engines/entity-resolution/semantic-augmentation.ts` | new — Passes A & B, penalties, evidence |
| `src/engines/entity-resolution/resolution.ts` | export keywords on existing helpers only (parity output unchanged) |
| `src/engines/EntityResolutionEngine.ts` | optional providers param; additive `evidence?` on options |
| `src/workspace/Workspace.ts` | built-in providers wired into the real engine |
| `src/ui/app.ts` + `index.html` | evidence lines in Possible identities |
| `verify/semantic-relationship-verification.ts` | new — 30 checks |
| `src/ui/version.ts` + `design-notes.md` | v2026-07-30.04 |

## Automated verification

29/29 suites green (counted); **entity-resolution parity 13/13 unchanged**; `tsc --noEmit` and full build clean. New suite: dataset integrity (2,708 rows, zero warnings, spec's exact examples andrew↔andy 5 / drew 5 / randy 1), loader validation and graceful failure, bidirectionality, strongest-wins merges, penalty curve, both passes end-to-end with exact expected confidences (95→91 at S5, 95→75 at S1), evidence content, one-sided proposing, no-merge guarantee, and the byte-identical bare-engine guarantee.

## Browser validation checklist

1. Load a document containing "Andrew Goodloe" and a bare "Andy" → Ambiguity Check shows Andy with the Andrew Goodloe option; the option lists `✓ Related name: "andy" ↔ "andrew" (Strength 5 — Established)`; version label v2026-07-30.04.
2. A "Drew Goodloe" + "Andrew Goodloe" document → one proposal on the Drew side with `✓ Same surname` + the relationship line; confirm no automatic grouping occurred.
3. Click the option → links as Keep exactly as before (existing flow); export decisions.json and re-import on a copy → link reuses (existing persistence, nothing new).
4. Exact-match proposals (bare "Maria" + "Maria Alvarez") now show `✓ Exact first-name match ("maria")`; confidence unchanged from pre-feature.
5. Console shows no related-name warnings on startup (clean dataset).

## Intentionally deferred (as of Phase 1)

Acronym pass (seam marked), organization aliases, user-confirmed alias provider, spelling/accented/transliteration datasets, context-similarity evidence, a strength floor option, transitive alias chains.

---

# Phase 2 — Full-Value Aliases (Acronyms & Organization Aliases)

**Date:** 2026-07-30 · **Version:** v2026-07-30.05 · **Spec:** Andrew's "Phase 2 — Acronyms and Full-Value Semantic Relationships" prompt.
**Status:** Implemented at the seam Phase 1 reserved. All automated verification green (30 suites; new suite 34/34; **parity still 13/13**). Browser validation pending — reusable test document provided.

## Architecture decision

No redesign — the Phase 1 architecture held as built. `FullValueAliasProvider` (`termDomain: "full-value"`) implements the **existing** `SemanticRelationshipProvider` interface with one additive extension: `SemanticRelation.label?` lets the dataset's curated `kind` column (acronym | alias) drive the evidence label, so one provider carries both "Acronym relationship" and "Alias relationship" without shape-guessing. Augmentation **Pass C** lives at the marked seam in `semantic-augmentation.ts`; the bare engine remains byte-identical to Python (suite-verified again) and no parity suite changed.

## Eligible entity types

**`person` only.** This pipeline has no organization `detectedType` — organization names and acronyms surface as person-type candidates via the capitalized-text fallback detectors (the same fact behind Item Check's "Organizations" filter design). `email`/`phone`/`cin`/`long_numeric_id` are typed identifiers where "alias" is not a coherent concept; they are excluded rather than indiscriminately compared (suite-verified: a cin-typed "NSC" and an email produce no proposals).

## Normalization policy (`normalizeFullValue`, one function used on both sides)

NFKC → lowercase → periods/apostrophes removed as characters (`N.S.C.` → `nsc`) → commas/hyphens/dashes become spaces → whitespace collapsed → trim. **Preserved deliberately** (the erase-no-distinctions boundary): every word (no stopword removal), digits, `&` (≠ "and"), and word order. The dataset adds explicit rows for variants normalization refuses to collapse.

**Found during verification, disclosed:** the port's `displayName()` applies its person-name comma reversal to *every* comma-bearing value — `"California State University, Los Angeles"` → `"Los Angeles California State University"` — correct for the person pipeline, wrong as an alias-matching key. Pass C therefore matches on **raw document text** (anchors index under each member's `displayValue` normalization as well as the canonical name; the asker normalizes its own raw value), and evidence lines quote the document's spelling. The port is untouched; the group's canonical label remains the port's own (reversed) name, which the option displays truthfully as the link target.

## Confidence policy

`fullValuePenalty = 30 − 5×strength` (S5→−5 … S1→−25) off the target anchor's port-computed confidence, clamped [35, 99] — deliberately **steeper** than Phase 1's `24 − 4s`: a name-token match retains residual corroboration (Pass B demands an exact surname; Pass A rides the person-name machinery), while a full-value edge *is* the entire claim and short acronym tokens are the most collision-prone strings in a document. Policy lives in the augmentation layer, not the provider. Exact expected outputs verified: NSC→Clearinghouse S5 = 95−5 = **90**; NSC→Safety Council S3 = 95−15 = **80**; DV→DegreeVerify S3 = **80**.

## Transitivity policy

**Direct dataset edges only — no closure.** `CSULA` and `Cal State LA` each propose the full university name because each has a direct edge to it; they propose *each other* only because the seed dataset contains an explicit `Cal State LA|CSULA` row. The suite's counter-example proves the negative: with the same two full-name edges but no direct row, no CSULA↔Cal State LA option appears. Chains converge only through a shared direct target or explicit reviewer confirmation — bounded, deterministic, explainable.

## Ambiguous acronyms

One term → many values, natively: `relationsOf("nsc")` returns both expansions; the reviewer sees **one proposal with ranked alternatives** (90 vs 80 in the seed), never an automatic choice, never occurrence-order tie-breaking, never document-uniqueness-as-proof. The built-in seed deliberately ships NSC with two meanings so this behavior is exercised by the default data.

## Direction

Bidirectional lookup; one-sided proposing: **the shorter normalized value asks** (`NSC` asks about the Clearinghouse — abbreviation-to-expansion is the natural question), equal lengths tie-break to the lexicographically greater side. Differs from Pass B's attestation rule, deliberately: full-value pairs are abbreviation→expansion shaped, and the short form is the ambiguous one. No mirrored proposals (suite: exactly one).

## Interaction with existing state

Already-grouped-together values (two spellings in one realized bucket) are skipped — grouping settled them (suite-verified). Confirmed links ride the unchanged `linkAmbiguousCandidate` → Keep + `ambiguityResolutions` + `entityRegistry` flow (suite-verified end-to-end against an augmented grouping) and therefore export/import through existing decision reuse. A resolved proposal's item reads *resolved* — it cannot reappear as an unresolved duplicate (the existing derived-status mechanism; suite-verified). A future user-confirmed alias provider asserting an existing relationship dedupes at `addOption` (by groupId).

## Files changed

`src/engines/knowledge/full-value-aliases.data.ts` (new — pipe-separated seed, 7 rows; pipes because org names contain commas), `FullValueAliasProvider.ts` (new — loader + normalization), `SemanticRelationshipProvider.ts` (additive `label?`), `semantic-augmentation.ts` (Pass C + `fullValueStrengthPenalty`), `RelatedNameProvider.ts` (built-in set gains the provider), `resolution.ts` (export keywords on `displayName`/`memberScore` only), `verify/full-value-alias-verification.ts` (new — 34 checks), `fixtures/browser-validation/semantic-relationships-phase2.docx` (new), version/design-notes → v2026-07-30.05.

## Automated verification

30/30 suites (counted), parity 13/13 unchanged, tsc + full build clean. The new suite covers all twelve required cases: single proposal, no merge, exact evidence wording + strength, bidirectionality, bare-engine byte-identity, parity, multiple expansions as alternatives, the transitivity policy including its counter-example, `N.S.C.` normalization, the reviewer flow through existing persistence, resolved-not-duplicated, and Phase 1 invariance under the combined provider set.

## Browser validation checklist (with `fixtures/browser-validation/semantic-relationships-phase2.docx`)

1. Load the document; version label reads v2026-07-30.05; console shows no dataset warnings.
2. **Proposal count/direction:** Ambiguity Check shows proposals on the short sides — NSC, N.S.C., DV, PII(→ if "Personally Identifiable Information" was detected), CSULA, Cal State LA; never on the expansions.
3. **Ambiguous acronym:** NSC's single proposal lists *both* National Student Clearinghouse (90) and National Safety Council (80), Clearinghouse first; nothing auto-selected.
4. **Evidence wording:** `✓ Acronym: "NSC" ↔ "National Student Clearinghouse" (Strength 5 — Established)`; N.S.C.'s evidence quotes "N.S.C.".
5. **No automatic grouping:** Group Check shows no group joining an acronym to its expansion.
6. **Accept** NSC→Clearinghouse (link): resolves as Keep; proposal item shows resolved; no duplicate reappears. **Reject** by deciding the candidate normally instead (Keep/Ignore) — same result, no forced link.
7. **Save/resume** and **decisions export → import** on a copy: the link reuses through existing machinery.
8. Note for observation: whether detection captures each all-caps token ("PII", "DV") as a candidate at all is detector behavior worth watching in this pass — if one is missed, that is a detection-coverage observation, not a Phase 2 defect.

## Intentionally deferred (Phase 2)

Larger curated alias library (data-only), user-confirmed alias provider, spelling/accented/transliteration datasets, context-similarity evidence, any transitive-closure relaxation.
