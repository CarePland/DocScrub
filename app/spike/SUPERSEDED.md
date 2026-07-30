# This directory is superseded by src/io/

As of Phase 3 (2026-07-27), `spike/ooxml/*.ts` and `spike/redact-and-verify.ts`
are no longer the active implementation. They have been ported to
production locations:

| Spike file | Production replacement |
|---|---|
| `spike/ooxml/zip.ts` (node:zlib) | `src/io/ooxml/zip.ts` (real `CompressionStream`/`DecompressionStream`) |
| `spike/ooxml/document-text.ts` | `src/io/ooxml/document-text.ts` (near-verbatim port) |
| `spike/ooxml/rebuild.ts` | `src/io/ooxml/rebuild.ts` (near-verbatim port, `computeSplicesForMatch`/`Match` dropped as unused) |
| `spike/ooxml/document-parts.ts` | `src/io/ooxml/document-parts.ts` (extended: comments, rels) |
| `spike/redact-and-verify.ts` | `verify/production-parity.ts` (exercises `src/io/DocumentParser.ts` / `DocumentRebuilder.ts` / `OutputVerifier.ts` directly) |
| *(none -- new in Phase 3)* | `src/io/ooxml/hyperlinks.ts`, `src/io/ooxml/comments.ts`, `src/io/ooxml/tracked-changes.ts`, `src/io/ooxml/source-ref.ts` |

This directory is kept, unmodified, as the historical record referenced
throughout `docs/ooxml-spike/phase-2-findings.md` and
`construct-support-matrix.md` -- it is not deleted, per the "preserve
auditability" principle, and several findings entries cite specific line
numbers here. But it should not be extended further or treated as a
reference for new work; `src/io/` and `verify/` are now authoritative.
