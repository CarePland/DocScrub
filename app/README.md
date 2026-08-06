# DocScrub-Web

Status: canonical (current state only — history lives elsewhere, see below)
Last updated: 2026-07-30

Browser-local PII redaction review for `.docx` documents: everything —
parse, detection, review, rebuild, verification, audit — runs in the
browser; the document never leaves the machine. **This README describes
how to orient and run the project today.** What the product is and why:
`docs/product/product-overview.md`. The full documentation map:
`docs/README.md`. How it got here (migration, gates, milestones,
revisions): `docs/architecture/product-evolution.md` — build history is
deliberately no longer kept in this file.

## Status

The Python-to-TypeScript migration closed at Gate E (2026-07-28): all 13
domain-parity fixtures, zero unresolved behavioral differences against
the Python oracle (`work/pii_docx_redactor/`, one level up — the
behavioral reference for ported scope, not maintained as a product).
**The TypeScript implementation is the production reference
implementation.** Work since is normal feature-based development —
numbered features, milestones, and interaction revisions, each with its
own findings document under `docs/detection/` and a dated entry in
`docs/architecture/design-notes.md` (the UI changelog). The
reviewer-experience waves (backlog:
`docs/architecture/reviewer-experience-backlog.md`) are in progress:
Waves 1–2 landed, 3–5 open.

## Layout

```
src/
  domain/      versioned schema types (DocumentModel, ReviewSession,
               Evidence, Commands, AuditRecord, NotQuite, FocusState, ...)
  engines/     deterministic domain engines: detection, normalization,
               quality, entity-resolution, occurrence-classifier, review,
               navigation, explanation, decision reuse
  io/          parse/rebuild/verify/audit + persistence
               (ooxml/ mechanics, IndexedDbSessionRepository)
  settings/    SettingsService trust-classification types
  workspace/   composition layer: ReviewWorkspace + CommandDispatcher —
               coordinates engines, never reimplements them
  ui/          app.ts — the one DOM entry point; no framework, no bundler
verify/        the verification battery (see below)
fixtures/      golden fixtures (domain-parity / interaction / performance)
scripts/       Python-side fixture exporters/generators
docs/          the documentation set — start at docs/README.md
```

Type names in `src/` match the v0.2 architecture document
(`docs/architecture/DocScrub-Web_Target_Architecture_v0.2.docx`) exactly;
the extracted decision register is `docs/architecture/decisions/`. The
authoritative behavioral reference for the reviewer workspace is
`docs/architecture/review-workspace-specification.md`.

## Build, run, verify

```
npm install
npm run typecheck
npm run build
npm run serve    # then open http://localhost:8000/index.html
```

`index.html` loads `dist/ui/app.js` as a native ES module — it must be
served over http, not opened via `file://`. `start-server.command` (repo
root) does build + serve on double-click.

Every suite in `verify/` runs the same way:

```
node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/<suite>.ts
```

Run them all:

```
for f in verify/*-*.ts; do
  node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs "$f" || break
done
```

(`ui-smoke` requires `npm run build` first. Each suite's own doc comment
explains what it covers and why it's shaped the way it is —
fixture-parity where a Python oracle export exists, property/behavior
suites where none does.) The Python oracle's own tests: `pip install -r
requirements.txt pytest && pytest` in `../work/pii_docx_redactor/`.

Regenerating fixtures or quality dictionaries: see the headers of
`scripts/export_fixtures.py`, `scripts/build_structural_fixtures.py`, and
`scripts/generate_quality_dictionaries.py` — these `os.chdir` into the
Python app deliberately (lexicon paths resolve via `Path.cwd()`; see
`docs/detection/phase-5-findings.md` for the bug that made this rule).

## Environment constraints (Claude-sandbox sessions)

The sandbox used for implementation sessions has **no npm registry
access** (deliberate allowlist policy) — `tsc` and all of `verify/` work
because dependencies are synced in, and `src/io/` needs no npm OOXML/ZIP
library (`CompressionStream`/`DecompressionStream` are Node 22 / browser
globals). A server started inside the sandbox is not reachable from
Andrew's real Chrome; live browser validation therefore happens with
Andrew running `npm run serve` himself, and findings documents disclose
when a live pass is pending rather than assuming it passed.

## Rules of the road

Before writing code here, read
`docs/architecture/implementation-philosophy.md` (standing requirement:
faithful behavior, documented judgment calls, no silent deviations),
`docs/product/invariants.md` (behavior that must not break), and
`docs/product/glossary.md` (the durable-vs-display vocabulary split —
"Rename" in files, "Change" on buttons — is deliberate). Findings
documents in `docs/detection/` are append-only.
