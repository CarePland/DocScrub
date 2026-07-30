# OOXML construct support matrix

Consolidates every construct exercised across the 11 synthetic domain-parity
fixtures built for Phase 2 (`run-split-name-001` through `content-control-001`,
plus the diacritics case which isn't an OOXML-structure test but a detection
test run through the same harness). Each row was originally verified
empirically through `spike/redact-and-verify.ts` (Phase 2), then
**re-verified against the real production implementation**
(`src/io/DocumentParser.ts`, `DocumentRebuilder.ts`, `OutputVerifier.ts`) via
`verify/production-parity.ts` (Phase 3, 2026-07-27; see
`spike/SUPERSEDED.md`) — 14/14 checks pass, including the two
architectural-decision-driven closures below. "Verified via" links each
finding back to concrete evidence rather than a claim.

Classification follows four categories, applied consistently:

- **Supported** — parsed, redacted, and rebuilds correctly with no known gap.
- **Supported with Warning** — works today, but carries a real fidelity or
  scope risk that a reviewer or product decision should be aware of.
- **Read-only** — physically preserved through parse/rebuild untouched, but
  content inside it is not in scope for detection/redaction today.
- **Unsupported** — not detected and not redacted; PII inside this construct
  passes through silently if present.

| Construct | Fixture | Classification | Notes |
|---|---|---|---|
| Fragmented runs (text split across many `<w:r>`) | `run-split-name-001` | Supported | 21-run paragraph, 3 candidates, cross-run splice verified against independent `python-docx` re-read. |
| Field codes (cached result text) | `field-codes-001` | Supported | Redaction of field *result* text (what's in `<w:t>` inside the field) verified end to end. |
| Drawing objects / embedded images | `drawing-objects-001` | Supported | Adjacent text redacted correctly; embedded PNG byte-identical after unzip/rezip. |
| Hyperlinks — display text | `hyperlink-001` | Supported | Visible link text redacted correctly. |
| Hyperlinks — relationship target (`Target="mailto:..."`) | `hyperlink-001` | Supported | **Resolved in Phase 3** (Andrew's architectural decision: "not considered successfully redacted until both visible text and target have been processed"). `src/io/ooxml/hyperlinks.ts` parses and surgically splices relationship targets; `OutputVerifier` independently rescans every hyperlink target in the rebuilt output and raises a **blocker**-severity finding if any redacted value is still present. Verified end to end: target spliced correctly, original value confirmed absent via independent zipfile inspection (`verify/production-parity.ts`'s dedicated hyperlink-target-redaction check). Not yet wired to a real DetectionEngine (which doesn't exist in TS yet) -- the mechanism is proven, detection coverage is a later-phase dependency. |
| Nested tables (table inside table cell) | `nested-table-001` | Supported | Depth-2 nesting, candidates in inner table cells redacted correctly. |
| Headers | `footer-001` (incidentally `synthetic-transcript-001`) | Supported | Fixed this phase — an earlier prototype silently never parsed `word/header*.xml`/`word/footer*.xml` at all. Now iterates every text-bearing part. |
| Footers | `footer-001` | Supported | Same fix as headers. |
| Text boxes (`w:txbxContent`, nested `<w:p>`) | `text-box-001` | Supported | Required a real fix: naive paragraph-span matching assumed `<w:p>` never nests, which corrupted output badly enough python-docx couldn't reopen it. Fixed with depth-aware stack-based span matching; verified via re-run + visual soffice/PDF check. |
| Content controls (`w:sdt`/`w:sdtContent`), block-level | `content-control-001` | Supported (approved intentional deviation) | **Resolved in Phase 3**: Andrew approved the browser parser detecting body-level SDT content even though `python-docx`'s `document.paragraphs` does not, as a deliberate product improvement rather than a bug to fix or a decision to keep open. Recorded formally in the fixture's `manifest.json` `deviations[]` (approvedBy "Andrew, 2026-07-27"). No code change was needed -- the production parser's string-scan approach (ported verbatim from the spike) already produced this behavior; the only change was documentation, from "open decision" to "approved". |
| Comments (`word/comments.xml`) | `comments-001` | Supported | **Resolved in Phase 3** (Andrew's architectural decision: "comments should eventually participate in the same review pipeline as ordinary document text"). Closed for real, not just flagged: `src/io/ooxml/comments.ts` extracts per-comment blocks, and redaction reuses the exact same `parseDocumentXml`/`redactDocument` path as body/header/footer text (comments share the same `<w:p>`/`<w:r>`/`<w:t>` structure, so no comments-specific redaction logic was needed). Verified end to end via `verify/production-parity.ts`, including an independent raw-ZIP check that `word/comments.xml` no longer contains the redacted text. `extract_accessible_xml_text()` in Python's `docx_reader.py` remains dead code -- this is a browser-side improvement over the Python oracle, not a port of existing Python behavior. |
| Tracked changes — insertions (`w:ins` wrapping `w:r`/`w:t`) | `tracked-changes-001` | Supported | Ordinary `<w:t>` under `<w:ins>` redacts the same as any other run. |
| Tracked changes — deletions (`w:del` wrapping `w:r`/`w:delText`) | `tracked-changes-001` | Read-only, with an enforced safety net | `<w:delText>` is invisible to `.//w:t` xpath and to the parser's extraction, by design (both follow the document's current visible text) -- and per Andrew's Phase 3 decision, DocumentRebuilder still has NO code path capable of splicing a `<w:delText>` run (not yet proven safe against revision-tracking metadata). What changed in Phase 3: `OutputVerifier` now independently rescans every tracked-deletion run in the rebuilt output. If one still contains text that should have been redacted, verification fails outright with a **blocker**-severity finding rather than silently reporting success -- proven via a dedicated safety-net test in `verify/production-parity.ts` (constructs a candidate pointing at deleted content, marks it for redaction, confirms `DocumentRebuilder` correctly leaves it untouched AND `OutputVerifier` correctly fails the export). This is the concrete mechanism behind "do not silently export documents containing tracked changes that could reveal redacted information." A second, warning-severity finding fires whenever tracked deletions are present at all, regardless of match, since deleted content has never been scanned by detection in the first place. |
| Non-ASCII person names (diacritics) | `diacritics-001` | **Unsupported** | Pre-existing Python-oracle gap, not introduced by this migration: the fallback person regex `[A-Z][a-z]{1,30}` is ASCII-only and produces zero candidates for names like "Tomás Reyes" or "José García". Out of scope to fix here — "reproduce Python behavior before introducing improvements" — but real and worth a product ticket. |

## Summary counts (updated Phase 3, 2026-07-27)

- Supported: 12 constructs (up from 9 -- hyperlink targets and comments closed for real; content controls reclassified from "Supported with Warning" to an approved deviation)
- Read-only, with an enforced safety net: 1 (tracked-change deletions -- cannot yet be redacted, but silent leakage is now structurally prevented by `OutputVerifier`)
- Unsupported: 1 (non-ASCII person names -- a pre-existing Python-oracle detection gap, out of scope for this migration)

## Where this leaves Gate A

Gate A (architecture v0.2 §14, `phase-1-acceptance-criteria.md`) requires
"every fidelity gap is explicitly catalogued as a hard blocker or a
warning-only risk — silently degrades is not an acceptable outcome for any
case." As of Phase 3, three of the four Phase 2 open items have been closed
by architectural decision plus real implementation (hyperlink targets,
comments, content controls); the fourth (tracked-change deletions) remains
a genuine rebuild limitation, but "silently degrades" is no longer possible
for it specifically -- `OutputVerifier` enforces a hard blocker whenever
redacted content would otherwise survive inside a tracked deletion. The
one remaining Unsupported row (non-ASCII names) is a Python-oracle
detection gap unrelated to the OOXML migration itself.

Gate A's remaining path to full closure: (1) run this same production
implementation in an actual browser (verified here under Node's
implementation of the same standardized `CompressionStream`/
`DecompressionStream` APIs, not yet under Chrome/Firefox/Safari itself),
and (2) port DetectionEngine to TypeScript so hyperlink-target and
tracked-deletion content are actually scanned for candidates in practice,
not just provably redactable/verifiable once a candidate exists.
