# Local AI Semantic Evidence Findings

Status: implementation report
Date: 2026-08-10

## Implemented

- Added `LocalAiEvidence` / `LocalAiRun` as a separate evidence and
  provenance record.
- Added an optional browser-local AI evidence engine, disabled by default,
  targeting a local OpenAI-compatible llama.cpp endpoint.
- Persisted AI evidence in `ReviewSession.localAiEvidence` for fresh
  sessions; restored sessions keep their prior AI evidence rather than
  re-running.
- Added conservative Item Check routing use: high-confidence non-person AI
  evidence may move an item out of Likely People only when there is no
  competing deterministic person evidence.
- Added a small accessible `AI` provenance marker to local-AI-assisted rows
  and focus headers.
- Added content-minimized audit provenance for AI-assisted candidates.
- Added `__docscrub.aiPeople()` to benchmark the live document.

## Verified By Suite

- `verify/local-ai-evidence-verification.ts`
  - AI disabled
  - model unavailable
  - malformed model response
  - uncertain response
  - AI person evidence
  - AI non-person evidence
  - deterministic/AI conflict
  - provenance persistence
  - audit provenance
  - accessibility marker source
  - no automatic `CandidateDecision`
  - AI-absent session shape unchanged

## Pending Live Validation

- Run against the real profiled document with a local llama.cpp server.
- Capture `__docscrub.aiPeople()` output.
- Review all false-exclusion rows before considering the experiment a GO.

## Benchmark Status

No real-model benchmark has been run in this implementation pass. Until the
live document is loaded with the local model enabled, GO / NO-GO remains
undetermined.

## Audit (2026-08-10, pre-run, no code changed)

Read every file this pass touched (`LocalAiEvidence.ts`, `LocalAiEvidenceEngine.ts`,
`Workspace.ts`'s wiring, `triageQueue.ts`'s routing branch, `app.ts`'s
`aiPeople()`), ran `tsc --noEmit` (clean) and
`verify/local-ai-evidence-verification.ts` (20/20 pass, injected-engine only --
no real inference exercised by the suite). Confirmed `dist/` is newer than
`src/` for every touched file, so the running app is already serving this
code.

**Finding: `enabled: false` is not a defect. It is the documented default,
working exactly as implemented.** `BrowserLocalAiEvidenceEngine` is wired as
the real default engine (`Workspace.ts` constructs it, not the disabled
stub), and it reads `enabled` from `localStorage.DOCSCRUB_LOCAL_AI_ENABLED`
at evaluate() time -- `=== "true"` or the flag is absent/anything else, it
reports `enabled:false` / `"Local AI disabled."` by construction. There is
exactly one read site for that flag (grepped), no second writer, no CSP
header in `index.html`/`serve.py` that would separately block it. The
implementation is internally coherent: prompt construction, response
parsing (JSON first, bare-keyword fallback), the conflict/routing rules
in `triageQueue.ts`, and the audit-provenance minimization all match what
`local-ai-semantic-evidence-prototype.md` describes. No changes made.

**The one real gotcha, not a bug either, but easy to hit by accident:**
local AI only runs on a *fresh* session (`Workspace.loadDocument`'s
`sessionRestored` branch skips it entirely and carries forward whatever --
possibly empty -- AI evidence the session already had). `sessionRestored`
is true whenever the document is opened via **Recent Documents** (which
passes the persisted `ReviewSession` back in). Opening the same file again
through the plain file picker / drag-and-drop does **not** pass a
`restoreSession`, so it is always fresh regardless of `documentId`. Given
this document has been open across many sessions today, the most likely
reason a `localStorage` flag change appeared to do nothing is reopening via
Recent Documents rather than a fresh open -- not the flag itself.

### Exact startup procedure (nothing above required a code change)

1. Install and run a local llama.cpp server with the model the code already
   names (`app/src/engines/local-ai/LocalAiEvidenceEngine.ts`'s `MODEL`/
   `MODEL_VERSION` constants):
   ```
   brew install llama.cpp
   llama-server -hf Qwen/Qwen2.5-0.5B-Instruct-GGUF:Q4_K_M --port 39219
   ```
   (`~491MB` download on first run, cached after. llama-server's default
   CORS is `Access-Control-Allow-Origin: *`, so the browser fetch from a
   different origin/port is not blocked.) Confirm it answers:
   ```
   curl http://127.0.0.1:39219/v1/chat/completions \
     -H "content-type: application/json" \
     -d '{"model":"qwen","messages":[{"role":"user","content":"say ok"}]}'
   ```
2. `npm run build` (only needed if `src/` has changed since the last build;
   currently `dist/` is already current).
3. `./start-server.command` (serves `dist/` on `:8000`, or the next free
   port -- read what it prints).
4. Open the app in the browser, then in the console, **before** loading the
   document:
   ```js
   localStorage.setItem("DOCSCRUB_LOCAL_AI_ENABLED", "true");
   localStorage.setItem("DOCSCRUB_LOCAL_AI_ENDPOINT", "http://127.0.0.1:39219/v1/chat/completions");
   ```
5. Load the document via the plain "Choose an existing document…" file
   picker or drag-and-drop -- **not** Recent Documents, even if it is the
   same file. This is the step that decides whether the engine runs at
   all (see the gotcha above).
6. In the console:
   ```js
   __docscrub.aiPeople()
   ```
   `summary.enabled` should read `true`, `summary.model` should read
   `Qwen2.5-0.5B-Instruct`, and `summary.evaluated` should be a nonzero
   count matching the eligible People population. If `unavailableReason`
   is populated instead, it will name the actual failure (HTTP status,
   fetch error) rather than "disabled" -- that is the next thing to read,
   not a reason to change code speculatively.

