# Local AI Semantic Evidence Prototype

Status: preliminary / experimental
Last updated: 2026-08-10

## Scope

This prototype adds local AI as a separate semantic evidence source for
person-typed, name-shaped candidates. It does not create
`CandidateDecision` records, does not create automatic resolutions, and
does not rewrite deterministic scores. The reviewer remains responsible for
the final disposition.

The experiment asks whether a small local model can distinguish candidates
such as real people from administrative/document phrases when deterministic
evidence has collapsed to shape and frequency signals.

## Runtime

- Model: `Qwen2.5-0.5B-Instruct`.
- Model version: developer-selected GGUF build from
  `Qwen/Qwen2.5-0.5B-Instruct-GGUF`.
- Runtime: `llama.cpp` local HTTP server, expected on
  `http://127.0.0.1:39219/v1/chat/completions` unless overridden.
- Approximate download size: the upstream safetensors model card lists
  about 1.0 GB; a quantized GGUF such as Q4 is expected to be smaller, but
  the exact size depends on the file chosen.
- License: Qwen model card and GGUF repository report Apache-2.0; llama.cpp
  reports MIT. These are recorded from current upstream metadata checked on
  2026-08-10, not from vendored files.
- Inference location: the reviewer/developer machine.
- Network during inference: no cloud call is made by DocScrub. The browser
  sends requests only to the configured local endpoint when explicitly
  enabled. Model download/setup, if performed by a developer, is outside
  DocScrub inference and may require network access.
- Expected resources: practical on modern laptops for a 0.5B quantized
  model; expect hundreds of MB to roughly 1-2 GB RAM depending on
  quantization/runtime overhead. CPU inference is acceptable for this
  benchmark if the evaluated candidate count stays narrow.

## Enabling

The feature is disabled by default. In the browser console:

```js
localStorage.setItem("DOCSCRUB_LOCAL_AI_ENABLED", "true");
localStorage.setItem("DOCSCRUB_LOCAL_AI_ENDPOINT", "http://127.0.0.1:39219/v1/chat/completions");
```

Then reload the document. With the default endpoint, run a compatible local
OpenAI-style llama.cpp server separately. If the endpoint is unavailable,
DocScrub records no decisions and treats model responses as unavailable
evidence.

## Prompt Contract

The model receives:

- candidate text;
- detected type;
- a small list of real occurrence contexts;
- deterministic evidence categories already computed.

The model must return a tiny taxonomy:

- `person`
- `organization_or_group`
- `document_or_system_term`
- `ordinary_phrase`
- `calendar_or_date_term`
- `uncertain`

`uncertain` is a first-class result. Malformed responses are converted to
uncertain evidence.

## Routing Use

Only local AI records with `routingUse: "non_person_evidence"` can move an
item out of Item Check's Likely People section. If competing deterministic
person evidence exists, the record becomes `conflict_retained` and the item
stays in People.

AI `person` results reinforce People as `person_evidence`. Weak/uncertain,
malformed, unavailable, disabled, and conflict results do not move items out
of People.

## Provenance

Session state may store `localAiEvidence` with the contexts used, because
the session is browser-local and needed for reproducibility. Audit export
uses only a content-minimized projection:

- local AI assistance yes/no;
- model/version/runtime;
- semantic classification;
- routing use;
- confidence when supplied;
- evidence summary;
- context occurrence IDs/count.

Audit export does not copy candidate text or context strings from AI
evidence.

The UI shows a small text `AI` badge on assisted rows and focus headers.
The badge has an accessible name and tooltip explaining that local AI
contributed semantic evidence and the reviewer remains responsible for the
final decision.

## Diagnostic

Use:

```js
__docscrub.aiPeople()
```

The diagnostic reports model/runtime/version, evaluated count, class counts,
uncertain count, before/after People counts, routed items, named evaluation
controls, false-exclusion review, inference time, and approximate input
characters.

## Judgment Calls

- Assumption: a localhost OpenAI-compatible endpoint is the smallest
  developer-oriented runtime integration that keeps DocScrub browser-local
  and avoids adding a bundled model-management subsystem.
- Alternative considered: adding a required Ollama service. Rejected for
  this pass because the request specifically warned against introducing an
  external required service if it conflicts with local/self-contained
  architecture.
- Reviewer impact: enabling the prototype requires developer setup, but
  disabled behavior is unchanged and no document text leaves the machine
  during inference.
- Assumption: conflict safety is more important than People-count reduction.
  A non-person AI answer loses to deterministic person evidence for routing
  and is surfaced for review.

