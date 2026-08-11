# Local Semantic Classifier for People Residue — Investigation

**Date:** 2026-08-09
**Status:** investigation / prototype design only. **No production changes. No model dependency added. No workflow redesign.**
**Verdict (§13): A, staged and gated — prototype and benchmark a small local instruct model against the frozen residue, but only after the cheap deterministic pass already queued in `20260809-truncation-confidence-and-x1.md` lands, and only if the benchmark in §7 clears the thresholds in §8 before any integration work starts.**

---

## 0. Where this sits

This is the fourth pass on People today, and it should be read as a continuation, not a restart. The prior three already did real measurement work this document leans on rather than repeats:

- `20260809-people-architecture-verdict.md` — established, empirically, that the lexical evidence layer is a **constant function** over a large slice of People (`Amy Miller` and `Grade Rosters` carry identical categories and identical scores). That is the premise of this investigation, and it is measured, not assumed.
- `20260809-residual-population-evidence-audit.md` / `20260809-people-membership-contract.md` — traced exactly why: the token gate, the witness-scope defect, the branch-order bug, the directional identity-evidence bug.
- `20260809-truncation-confidence-and-x1.md` — the most recent, verdict **D**: a real given-name lexicon (X1) rescues only 2 of 11 real-person controls beyond what a one-line branch-order fix already rescues for free, and recommended landing the cheap representation fixes **before** re-measuring anything else.

None of those four passes evaluated AI. That is the actual gap this document fills, and it is a genuine gap — not a rerun of settled ground.

---

## 1. Architecture finding

Trace, file by file, of how a candidate becomes a People-section row today:

```
DetectionEngine (patterns.ts)
  FALLBACK_PERSON_RE / LAST_FIRST_PERSON_RE — any 2-6 capitalized words.
  No lexicon consulted. High recall by design.
      |
      v  detectedType: "person"  (a regex verdict, not evidence)
CandidateQualityEngine / quality/scoring.ts
  Produces CandidateQualityAssessment: score, reasons[], positiveReasons[],
  filterRules[], quality label. Lexical/structural/frequency features only
  (name-shape regexes, frequency bonuses, curated dictionaries of 23 given
  names + 5 surnames). Optional contextual-person-evidence family composes
  in here as an additive 6th parameter.
      |
      v
EntityResolutionEngine (resolution.ts)
  Ambiguity proposals (bare-name -> full-name candidates) and entity group
  proposals (spelling variants of one person), each carrying per-option
  confidence and reviewer-facing evidence lines.
      |
      v
OccurrenceClassifier (occurrence-classifier.ts)
  Per-OCCURRENCE structured context: {before, match, after}, groupKind
  (standalone/contextual/quoted/header/footer/table/ocr/other), blockKind,
  entityGroupId, quality label, candidateScore. Computed once, already
  cross-referenced, already reviewer-ready.
      |
      +--------------------------+-------------------------------+
      v                          v                                v
semanticTypeFor()          ui/recommendations.ts             residualReviewGate.ts
(domain/semanticTypes.ts)  deriveRecommendation()            evaluateCandidate()
Type Check ONLY.           Item Check's archetype/           Auto-resolves ONLY
Better classifier          conclusion. Independently         single-token,
(no token gate,            re-tests the same category        ordinary-language-
requires positive          vocabulary. Falls to               only candidates
name structure) but        `archetype: "uncertain"` with      to Keep. Rule 1
never called by             two disposition chips when         rejects every
Item Check.                 nothing matches.                   multi-token
                                                                 phrase outright
                                                                 -- explicitly
                                                                 out of scope.
      |                          |
      v                          v
                        triageQueue.ts triageSectionFor()
                        `case null: return detectedType === "person"
                          ? "people" : "other"`
                        -- the ACTUAL membership rule for People is a
                        fallback: "person-typed, and nothing else claimed it."
```

**Where a semantic classifier could enter without becoming a second source of truth.** This codebase already has a precedent for exactly this problem, and it is load-bearing: `residualReviewGate.ts`'s own header states the constraint in these words —

> "Item Check must not accumulate its own parallel classification engine... It is a decision procedure over evidence other stages already computed... If it ever needs a new fact about a candidate, that fact belongs in whichever engine already owns that question, not here."

And `contextual-person-evidence` (shipped 2026-08-05) already demonstrates the shape that satisfies this constraint for a new evidence family: a separate, optional, off-by-default-weight pass that produces its own record, is composed additively, and is consumed by name (not folded silently into `qualityCategories`) by the handful of places that need it. `documentNameEvidence.ts` (shipped today) is the second precedent — a distinct top-level fact (`hasKnownNameEvidence`) rather than a mutation of the scoring vocabulary, explicitly to avoid "the gate growing its own classification logic by increments."

A semantic classifier should follow the **same** shape: a new engine (e.g. `src/engines/semantic-classifier/`) that runs after `OccurrenceClassifier` and `EntityResolutionEngine` (it needs their output as input, see §4) and produces its own per-candidate record — `{ candidateId, semanticClass, confidence, rationale, sampledOccurrenceIds, modelId }` — that is:

- **never merged into `qualityCategories`** (the deterministic score stays pure, reproducible from a `ScoringProfileSnapshot`, and every Python-parity suite stays untouched);
- **consumed as a new, explicitly-named top-level fact** by `residualReviewGate.GateFacts`, `RecommendationFacts`, and optionally `SemanticTypeFacts` — the same pattern `hasContextualPersonEvidence` and `hasKnownNameEvidence` already use;
- **off by default**, exactly like `contextual_person_evidence`'s profile weight of 0 disabling the family outright — so "model unavailable" and "model disabled" are the same code path as "feature not built" (see §10).

This is a deletion-free, additive integration. It does not touch `semanticTypeFor`, `deriveRecommendation`'s existing archetypes, or the residual gate's five existing guards — it adds a new fact those functions may optionally read.

**What information is available at that entry point**, all of it already computed by the time a semantic pass could run:

| available | not available / would need building |
|---|---|
| candidate string, detected type, token count | any concept of "message" or sender/author attribution — no such domain object exists in this codebase; correspondence structure is inferred only from `blockKind`/`groupKind` |
| per-occurrence structured context (`before`/`match`/`after`, single-block window) | full-document context beyond one block — `contextSnippet` and `ReviewOccurrence.context` are both scoped to ONE `ContentBlock` by design (see `docscrub-contextual-person-evidence` memory: multi-block spans like signature blocks are already invisible to this window) |
| occurrence count, occurrence structural kind (standalone/contextual/quoted/header/footer/table/ocr) | — |
| message/document attribution proxy via `blockKind` (body/header/footer/table/hyperlink/comment/tracked-deletion) | true sender/recipient identity |
| existing deterministic evidence categories (`reasons`/`positiveReasons`/`filterRules`) | — |
| ambiguity-proposal options + entity-group membership, each with confidence and evidence lines | — |
| relationship kinds (acronym, identifier) | — |

The right design question is not "does the model see everything" — it is which of these actually corroborate a *semantic* verdict vs. which would just re-inject the same constant-function signal the deterministic layer already exhausted. §4 answers that directly.

---

## 2. Is deterministic classification actually at an information ceiling?

Yes, for a specific, boundable, non-trivial part of the population — and this is measured, not asserted. From `20260809-people-architecture-verdict.md` §1, run against the real quality engine:

```
Amy Miller       79   ["moderate_frequency_bonus","strong_name_structure"]
Grade Rosters    79   ["moderate_frequency_bonus","strong_name_structure"]
Academic Senate  79   ["moderate_frequency_bonus","strong_name_structure"]
Reason Code      79   ["moderate_frequency_bonus","strong_name_structure"]
```

Category-identical. Not "hard to separate with more tuning" — **structurally identical inputs to every rule the lexical layer has.** No routing rule, however narrow, can separate two inputs that are the same input. That is a real ceiling, not a euphemism for "we haven't tried hard enough," and today's own falsification attempts back it up: `20260809-truncation-confidence-and-x1.md` measured a 26,411-name lexicon (84 Faker locales) against this exact population and found it rescues exactly **two** additional real-person controls (Amy, Jeffrey) beyond what a one-line branch-order bugfix already recovers for free — while the two hardest real names in the control set (`Chelsye Angelina`, `Chriztopher Johnson`) are missed by **both** the 23-entry and the 26,411-entry lexicon. Lexical coverage is not the bottleneck; it is a bounded, and apparently small, contributor.

**But the ceiling is narrower than "People is unsolvable deterministically."** Two real, cheap, deterministic wins are queued and un-shipped as of this morning's last pass:

1. **Representation defect #1** (branch-order bug) — the known-given-name lookup never runs on `Surname, Given` candidates. Free correctness fix, no new data.
2. **Representation defect #2** (directional identity evidence) — an ambiguity proposal's evidence attaches to the *shortened* form (`Amy`) and never to the *full-name anchor* (`Amy Miller`) that a reviewer actually needs protected. Free correctness fix, no new data, and it is the one change most likely to rescue `Amy Miller` specifically without touching AI at all.
3. **X2** (universal `heading_context`, §2.3 of the verdict doc) — the first genuine B-side (non-person) structural signal available today, currently unusable because any single heading-like occurrence taints the whole candidate rather than requiring *every* occurrence to be heading-like.

None of these three has been measured live yet. `20260809-truncation-confidence-and-x1.md`'s own verdict was **not** "add AI" — it was "land #1 and #2, then re-measure, then decide." That sequencing is correct and this document does not override it. What #1/#2/X2 cannot do, even fully landed, is separate `Academic Senate` from `Agnes Wu` — both are category-identical strings with zero corroborating structural or lexical signal on either side, no ambiguity proposal, no entity group, no heading tell. That specific, real, residual core is where deterministic evidence is genuinely exhausted, and it is exactly the core Andrew's four examples (`Amy Miller`, `Academic Senate`, `Grade Rosters`, `Reason Code`) sit astride once the cheap fixes are applied. It is a **semantic** distinction — "is this phrase functioning as a person's name in these sentences" — not a lexical or structural one, and the pipeline has never had a component that reads a sentence rather than classifying a token shape.

---

## 3. Recommended semantic task

Narrow, exactly as instructed — not a redaction decision, not even a full NER task. The question a local model would answer, per candidate:

> Given up to three short passages in which this exact phrase appears in this document, what kind of thing does this phrase most plausibly denote *in these passages* — the name of a specific person, an organization or group, a place, a document/process/label, ordinary language, or is it genuinely unclear?

Taxonomy (Andrew's illustrative six, kept — nothing in the residue argues for adding a category, and a seventh category would only fragment an already-small sample per class in the benchmark):

`person | organization_or_group | place | document_or_process_label | ordinary_phrase | uncertain`

`uncertain` is not a residual bucket, it is a **first-class, expected, and frequently-correct** answer — see §6/§10.

---

## 4. Proposed input/context strategy

**Occurrence count and selection.** Not all occurrences, not random, not first/last alone:

- if `occurrenceCount <= 3`: show all of them.
- if more: prefer structural **diversity** over volume — one occurrence from each distinct `groupKind` present (standalone, contextual/prose, header, table), capped at 3-4. This is deliberate, not arbitrary: `groupKind` is exactly the signal behind X2 (§2), and showing the model a heading occurrence *and* a prose occurrence lets it register "this only ever appears as a table label" itself, semantically, rather than requiring a separate deterministic universal-heading rule to do the same job less richly. It also directly implements Andrew's "contexts chosen by deterministic disagreement" option — `groupKind` diversity is disagreement, structurally defined.
- context window per occurrence: reuse `ReviewOccurrence.context` (`before`/`match`/`after`) as-is. It already exists, is already single-block-scoped (~70 chars either side, per the contextual-person-evidence precedent), and building a second, wider context extractor would be exactly the kind of parallel machinery §1's constraint forbids. If the single-block window proves too narrow in the benchmark (§7), that is a finding to report, not a reason to build new extraction machinery before the benchmark says so.

**Should the model see existing deterministic evidence?** No, not as the primary signal, and Andrew's own instinct in the prompt is correct: the categories are **the constant function itself** (§2). Passing `["moderate_frequency_bonus","strong_name_structure"]` to the model teaches it nothing and risks anchoring it toward whichever reading is more frequent in its training distribution for that shape. What *is* worth passing, because it is not part of the constant function: token count, occurrence count, and the set of `groupKind`s the candidate appears under — structural facts, not the lexical evidence categories. Existing evidence should inform **aggregation policy** (§ below) but not appear in the prompt.

**Disagreement across occurrences.** Never silently vote or average. If the sampled occurrences disagree on the person/non-person axis, the candidate-level output must be `uncertain` — this is a direct reuse of the residual gate's own Guard 3 (the mixed-use guard: "one person-like occurrence keeps the whole candidate reviewable," all-or-nothing at candidate granularity, because DocScrub cannot split one candidate's occurrences into two dispositions). Same risk posture, same justification, not a new invention.

**Abstention triggers**, any one of which forces `uncertain` before the candidate-level result is ever used downstream:

- the model itself reports `uncertain` or low confidence;
- sampled occurrences disagree (above);
- the model's structured response fails schema validation (never silently coerced — see §5);
- fewer than one occurrence is available with any genuine sentence context (e.g. every occurrence is a bare table cell) — the model should not be asked to guess from shape alone, that is exactly what the deterministic layer already does and already fails at.

---

## 5. Proposed output schema

```json
{
  "candidateId": "c-4821",
  "semanticClass": "organization_or_group",
  "confidence": "high",
  "rationale": "Referred to as the body that reviews petitions (\"submit to the Academic Senate\"), never addressed or described as a person.",
  "perOccurrence": [
    { "occurrenceId": "o-101", "class": "organization_or_group" },
    { "occurrenceId": "o-303", "class": "organization_or_group" }
  ]
}
```

- `confidence` is a **band** (`high`/`medium`/`low`), not a raw float — matches this codebase's existing discipline (`QualityLabel: Strong/Possible/Unlikely`) rather than inventing false precision an LLM cannot actually back up numerically.
- `rationale` is short, plain-language, and mandatory — every `review`/`resolve` outcome elsewhere in this codebase carries a `because`/`reason` string (`residualReviewGate`'s `GateOutcome`, `AutomaticResolution.reason`); AI evidence should meet the same bar or it is a regression in auditability, not an enhancement.
- Machine-validated: JSON-schema/enum-constrained, and where the runtime supports it (grammar-constrained decoding, see §6) enforced at the token level rather than merely hoped for via prompting. Any response that fails validation is **not retried into a guess** — it collapses to `uncertain` server-side, deterministically, per §4.
- No `Keep`/`Change`/`Redact`/`Ignore` field exists anywhere in this schema, deliberately — matching Andrew's own "AI must not make CandidateDecisions" constraint structurally, not just by convention.

---

## 6. Local model / runtime candidates

**The constraint that changes this section's shape:** DocScrub is not a general "local app" free to embed any runtime. It is confirmed, from `package.json` and `start-server.command`, to be a **pure static browser app** — no bundler ("by design," per existing convention), no Node backend, no Electron/Tauri shell, served by a plain `python3 serve.py`. And `app/docs/product/product-overview.md` currently states, as a documented architectural boundary alongside "not a service" and "not a general document-format tool":

> **"Not AI/ML."** Detection and every other engine are deterministic (regex, rules, arithmetic) — same input, same output, explainable by construction. No model, no training, no cloud inference. Nothing in the repository designs otherwise.

Both facts bound every option below. (The second is a product-positioning fact addressed head-on in §12, not a technical one, but it changes what "prototype" is allowed to mean before Andrew has ruled on it — see §7's "offline, outside the app" framing.)

### Approach A — in-browser inference (WASM/WebGPU)
`transformers.js` (`@huggingface/transformers`) or `onnxruntime-web`, or a WASM build of llama.cpp (`wllama`), running inside the same tab, weights shipped as static assets.
- **Strongest fit for "local-first," truest reading of the constraint.** No install beyond the app itself; matches DocScrub's "point a browser at index.html" simplicity philosophy at the *usage* layer even though it changes the *distribution* footprint substantially.
- Real friction against **existing** conventions: the "no bundler, ever" rule was built around ESM-via-import-map for a thin dependency (`@supabase/supabase-js`, types-only). `transformers.js` does publish browser-ready ESM/CDN builds, so the same pattern may extend — this needs verifying, not assuming, before it's treated as free. Model weights (tens of MB even for small quantized encoders, hundreds of MB to ~1-2GB for a small instruct LLM in GGUF/ONNX) are a new, large static-asset category this app has never shipped. WebGPU support is uneven (notably Safari, historically), so a CPU/WASM fallback path is required, not optional.

### Approach B — external local runtime process (Ollama, llama.cpp server, LM Studio)
The page calls `http://localhost:<port>` from the browser.
- Fast to **prototype** with (§7 should use this or a native CLI harness, not the app itself).
- Wrong as a **shipped** dependency: it requires the user to separately install and keep running a background service DocScrub does not control — a real installation dependency the app has never had, and Andrew's own instinct in the prompt agrees ("Ollama might be convenient for experimentation but undesirable as a required installed product dependency"). It also turns "model unavailable" from an edge case into a routine, every-launch state (§10), and raises a CORS/permission question DocScrub has never had to answer.

### Approach C — small non-LLM local classifier (fine-tuned encoder, ONNX)
A tens-to-a-few-hundred-MB sequence classifier (e.g. a distilled/quantized BERT-family encoder) fine-tuned to the six-way taxonomy, served via `onnxruntime-web`.
- Structurally the cleanest for "uncertain": a confidence-threshold or entropy check on a fixed-size softmax is principled, not a model choosing to say a word. 100%-schema-valid by construction — no JSON to parse or fail.
- **Requires labeled training data DocScrub does not have.** Off-the-shelf NER (spaCy, generic BERT-NER) is trained on well-formed prose, not truncated PeopleSoft/CMS field labels and table headers — exactly the population this problem is about — so a zero-shot attempt is a reasonable cheap check but should not be expected to beat a purpose-tuned model. Real investment (data collection + fine-tuning + a retraining/maintenance story this org has never needed before) is a second-phase question, not a first prototype.

### Approach D — small local instruct LLM, zero-shot, grammar-constrained JSON output
1-4B parameter instruct model (Qwen2.5-1.5B/3B-Instruct, Llama-3.2-1B/3B-Instruct, Phi-3.5-mini-instruct, SmolLM2-1.7B-Instruct) via `llama.cpp`.
- Needs **no training data** — the single biggest practical advantage given DocScrub has none and no ML-maintenance capability today. Genuinely reads semantic context rather than matching shape, which is precisely the capability §2 identified as missing. `llama.cpp`'s GBNF grammar-constrained decoding enforces the JSON schema (§5) at the **token** level, not merely via prompting — this materially de-risks the "structured-output reliability" concern more than it first appears to. Produces a free-text `rationale`, which a discriminative classifier (C) cannot.
- Heavier: 0.7-2.5GB quantized (Q4) download; slower per-item, though this is a **batch, offline pass over ~100-300 residual candidates run once per document**, not a per-keystroke interactive path — realistically seconds to low minutes on CPU, which is inside an acceptable "click Analyze, wait" budget, not a real-time constraint.

**Runtime recommendation for the prototype/benchmark specifically: llama.cpp**, run natively (not via Ollama) on Andrew's own machine, with a model from the Qwen2.5-Instruct family (Apache-2.0, cleanest license, strong structured-output compliance at small sizes). **MLX is a nonstarter for anything beyond Andrew's own dev-machine benchmarking** — it is Apple-Silicon-only, and DocScrub cannot assume its reviewers are on Apple hardware. Whether the eventual *shipped* runtime is native llama.cpp, a WASM build of it, or ONNX Runtime Web is an Approach-A-vs-nothing question that should not be decided before §7's benchmark says the task is worth shipping at all.

---

## 7. Benchmark design

**Population.** The live document's current People section (post the cheap deterministic fixes from `20260809-truncation-confidence-and-x1.md`, once landed — benchmarking against the pre-fix population would double-count what those fixes already solve for free), plus deliberately-included negative controls already routed elsewhere (institutional/calendar candidates) to check the model doesn't just learn to call everything "person."

**Ground truth.** Andrew hand-labels every item **A. clearly a person / B. clearly not a person / C. genuinely ambiguous**, frozen before any model output is seen, stored as a versioned fixture (`fixtures/semantic-classifier-benchmark/`) in the same pinned-expectation style as the domain-parity fixtures already in this repo. No relabeling after seeing predictions — the same discipline `docscrub-web-conventions`'s fixture-drift lesson already established the hard way.

**Run.** Offline, outside the running app (a standalone script against `llama.cpp`), over every item, using the context strategy in §4.

**Metrics, reported separately, never blended into one accuracy number** — per Andrew's explicit instruction:

1. obvious non-people (B) correctly reclassified out of People
2. real people (A) correctly retained/confirmed
3. genuine ambiguities (C) correctly routed to `uncertain`
4. **false non-person classifications of real people (A misclassified as B), at any confidence** — the one number that decides §8
5. confident-but-wrong count, any direction (measures whether `confidence` is honest, not just present)
6. overall `uncertain` rate
7. **overlap with the deterministic capability-X findings already measured today** — does the model add value beyond #1/#2/X2, or is it redundant with cheaper fixes still in flight? This is the comparison nothing has run yet and the one that actually justifies or kills this investigation.
8. **stability**: run each candidate through the model twice (independent sampling of context / nonzero temperature) and measure verdict flips. This is a failure mode the deterministic pipeline structurally cannot have — everything else in this codebase is provably reproducible (same input, same output) — and an unstable classifier undermines reviewer trust regardless of point-in-time accuracy. Worth measuring even if nothing else in this benchmark motivates it.

---

## 8. GO / NO-GO thresholds — set before results, per instruction

**Gate 1 (disqualifying, hard).** Zero confident (high/medium) false-non-person classifications of a real person anywhere in the benchmark. A single one fails this gate outright — matches Andrew's explicit "moves 90 junk items but incorrectly excludes Amy Miller is not automatically better" standard. Low-confidence misses are tolerated **only if** they are structurally incapable of auto-resolving anything (see §9 — AI evidence should never independently trigger an `AutomaticResolution` at launch, only adjust routing/recommendation with the reviewer still seeing every item). A benchmark of realistic size (dozens of real-person controls) cannot statistically prove a rate below roughly 1/N — the actual safety net is the structural guard in §9, not the benchmark number alone, and that should be stated plainly rather than oversold.

**Gate 2 (materiality, must also be met).** Reclassifies or corroborates at least a strong majority — proposing **60%+** — of the class-B (clearly-not-people) population, while abstaining rather than guessing on class C. Framed against the current population: moving a ~140-item People section down to something in the 60-90 range with zero confident false exclusions is the "substantially calmer queue, not eight items" bar Andrew set.

**Gate 3 (calibration).** `uncertain` outputs must correlate with human-labeled class C at a rate materially above chance. A model that abstains on 90% of everything technically clears Gate 1 for free and adds zero value — Gate 3 exists specifically to close that loophole.

All three numeric thresholds are proposed, not derived from first principles, and are Andrew's to move — stated per his own instruction to choose defensible numbers rather than inherit the illustrative ones.

---

## 9. Integration point if the benchmark clears §8

Exactly the shape described in §1: a new, optional, off-by-default evidence engine, consumed as a named top-level fact by three existing consumers, none of which change their existing precedence:

- **`residualReviewGate`** — a new, narrow rule scoped to the population its existing rule 1 explicitly excludes today (multi-token phrases). Proposed shape: `semanticClass === "organization_or_group" | "place" | "document_or_process_label"` at `confidence: "high"`, **combined with** an existing non-contradicting signal (no contextual person evidence, no ambiguity proposal, no entity-group membership) → resolves to the same narrow `Keep` disposition the existing ordinary-language rule uses, never `Ignore`/`Redact`. AI evidence alone, at launch, should **not** be sufficient to auto-resolve anything — require it to corroborate an existing weak signal rather than stand alone, which is both safer and cheaper to justify to a future auditor.
- **`ui/recommendations.ts`** — a new low-priority archetype/conclusion that fires only when nothing else has already claimed the candidate (i.e., after every existing branch, never ahead of a real archetype) — "AI reads this as an organization" as a conclusion sentence with a Keep-flavored chip, exactly the term-archetype shape already established for institutional/calendar/common-word.
- **`semanticTypeFor`** — lower priority than the above two; Type Check is a secondary consumer of this fix, not the primary pain point.

## 10. Failure / abstention behavior

- **Model unavailable, disabled, or not installed:** identical code path to "feature not built" — the pipeline behaves exactly as it does today. This falls out of §9's design for free, the same way `contextual_person_evidence`'s weight-0 already disables that family outright without special-casing anywhere else.
- **Schema-invalid or malformed model response:** collapses to `uncertain`, never retried into a best-effort guess, never silently defaulted to any concrete class.
- **`uncertain` at the candidate level:** no downstream consumer treats it as evidence of anything — it is exactly equivalent to "no semantic-classifier evidence exists for this candidate," which is the honest state.

## 11. Privacy / licensing / distribution

- **Privacy** is satisfied by construction only if the chosen runtime makes zero outbound network calls — this needs an explicit audit of whichever runtime ships (some "local" tools phone home for update checks/telemetry by default) before any "no cloud inference" claim is made about it; do not assume.
- **Licensing:** recommend an Apache-2.0-family model (Qwen2.5) and MIT-licensed runtime (llama.cpp) specifically because they are the cleanest for redistribution inside a commercial product — the same due-diligence muscle `20260809-truncation-confidence-and-x1.md` §9 already exercised on Faker's name-list provenance applies again here, and should be applied again rather than assumed clean by license name alone.
- **Distribution:** adds real, new weight to whatever DocScrub's install/first-load footprint means today (currently: open `index.html`, served by a two-file Python script). Hundreds of MB to low GB is not a rounding error against that baseline and should be opt-in / downloaded on demand rather than bundled unconditionally, independent of any other decision in this document.

## 12. Product-positioning consequences

This is not a minor footnote. `app/docs/product/product-overview.md` currently states, as a documented architectural boundary with the same status as "not a service" and "not a general document-format tool":

> **"Not AI/ML."** ... No model, no training, no cloud inference. Nothing in the repository designs otherwise.

A shipped local semantic classifier makes that sentence **false as written**, not just in need of softer wording. It does not make "local/private" false — a genuinely local, no-network model preserves that claim entirely, and "no cloud inference" specifically survives untouched. But "Not AI/ML" as an absolute boundary would need to become something like "No cloud AI; an optional, disclosed, local-only semantic-evidence pass may run entirely on-device, off by default, and every engine that makes redaction decisions remains deterministic" — a real, deliberate repositioning, not a copy-edit. That is Andrew's call, not a technical one, but the technical recommendation in §13 should not be read as free of this consequence. Practically, it argues for the feature being genuinely optional (§9 already designs it that way) so the boundary claim stays true for any installation where it is off.

Other consequences, more mechanical: AI-derived evidence must be visibly distinguished from deterministic evidence in the UI — not folded into the existing evidence-panel contract, where "displayed weights sum to the score" is already a guarded invariant (`docscrub-decision-color-system` / `docscrub-contextual-person-evidence` memory) that an unweighted AI verdict would break if merged in. It belongs in a separate "additional context" surface, never inside the "why does this score 79" breakdown. The audit log should record model id/version/quantization/runtime alongside the classification, rationale, and sampled occurrence ids — reusing `AutomaticResolution`'s existing `ruleId`/`reason`/`evidence` shape rather than inventing a second provenance concept.

---

## 13. Recommendation

**A — prototype and benchmark, staged and gated, not "adopt now."**

Reasoning, weighed against the other three options:

- **Not C ("deterministic still has a materially better path").** The residual core this document targets (`Academic Senate` vs. `Agnes Wu`, category-identical, zero corroborating structural signal on either side) survives every deterministic fix currently queued or measured today, including a 26,411-name lexicon. That specific gap is real and measured, not hypothetical.
- **Not D ("leave the residue to human review, stop").** Andrew's own risk framing — thirty reviewed cases are an acceptable price for catching three real people, never the reverse — describes exactly the shape a bounded, abstention-heavy semantic signal is good at, and this codebase already has a clean, low-risk, off-by-default slot to put one in (§9) without disturbing anything shipped. Refusing to even benchmark that would be declining a cheap option on an expensive problem.
- **Not B as the first move.** A non-LLM classifier (Approach C) is architecturally the cleanest long-term answer but requires labeled training data and an ongoing ML-maintenance capability DocScrub has neither built nor needed before. It is the right **second-phase** optimization if and only if A's benchmark proves the task is learnable at all and DocScrub later wants a smaller, faster, train-once footprint instead of a general instruct model.
- **Full A, unstaged, is also wrong.** It would skip §0's still-unlanded, cheaper, already-measured deterministic wins, and it would treat a product-positioning boundary (§12) as a technical footnote rather than a real decision Andrew has not yet made.

**What "A" concretely means next, in order:** land the representation fixes from `20260809-truncation-confidence-and-x1.md` and re-measure People (already queued, not new work this document adds); then build the frozen benchmark fixture (§7) against the corrected population; then run one small instruct model (§6, Approach D, offline, outside the app) against it; then score against §8's thresholds before writing a single line of integration code. If the benchmark misses Gate 1 or Gate 2, the honest conclusion is the same one `20260809-people-architecture-verdict.md` already reached for X1: report the gap plainly and stop, rather than integrate something that only looks like it worked.
