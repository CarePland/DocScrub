# Phase 2 spike findings — browser-local OOXML parse/rebuild feasibility

Reference: `docs/architecture/DocScrub-Web_Target_Architecture_v0.2.docx` §14
(Migration Strategy, Phase 2: "Early DocumentParser / DocumentRebuilder
technical spike") and Gate A in `docs/architecture/phase-1-acceptance-criteria.md`.

## Constraint this spike worked under

This sandbox has no npm registry access (confirmed again before starting:
`npm ping` returns `403 Forbidden`, `X-Proxy-Error: blocked-by-allowlist` —
a deliberate policy, not a transient outage). No OOXML/ZIP library (`docx`,
`jszip`, `pizzip`, `mammoth`) could be installed.

Rather than stop at "can't verify," this spike built a **zero-dependency**
prototype using only Node 22's built-ins (`node:zlib`, `node:fs`), run
directly via `node --experimental-strip-types` (no compiler needed either).
This is a legitimate stand-in, not a workaround: Node's
`zlib.inflateRawSync`/`deflateRawSync` implement the same raw DEFLATE
algorithm as the browser-native `CompressionStream`/`DecompressionStream`
with format `"deflate-raw"`. The ZIP central-directory parsing and the OOXML
text-extraction logic are plain binary/string manipulation with nothing
Node-specific about them — they translate directly to a browser
implementation built on those native streaming APIs.

Code: `spike/ooxml/zip.ts`, `spike/ooxml/document-text.ts`,
`spike/ooxml/rebuild.ts`. Validation harness: `spike/validate.ts` (run with
`node --experimental-strip-types spike/validate.ts`).

## What was proven

**1. Zero-dependency ZIP read/write round-trips byte-identically.**
Unzipped and rezipped every part of a real fixture docx; every part came
back byte-for-byte identical. The rezipped file opened correctly in
LibreOffice (`soffice --headless --convert-to pdf`, no errors).

**2. Text extraction matches the Python reference on real data.** Parsed
the actual real document from `work/pii_docx_redactor/.local_web_state/upload.docx`
(the same one the earlier structural spike examined) and got **6,134
paragraphs — an exact match** against the Python/lxml-based structural
spike's independently-computed count. Parsing took under 50ms total for a
1.3MB document (9.9ms unzip, 39.1ms text extraction); rezipping took 62.6ms.
That's a real, if narrow, data point against §15.2's "browser memory usage
may be high for large documents" risk — at minimum, CPU cost for parse/
rebuild looks small relative to typical document sizes seen so far.

One counting discrepancy worth recording, not a bug: the Python spike
counted 15 as the max `<w:r>` elements in one paragraph; this spike found 11
as the max number of *text-bearing* runs (runs containing a `<w:t>` node).
The difference is real and expected — Python counted all direct-child
`<w:r>` elements (including ones containing only a tab, break, or field
marker with no text), while this spike only counts runs that actually carry
text, because those are the only ones that matter for detection or
replacement. The text-bearing count is the one DocumentRebuilder actually
needs.

**3. Extraction parity confirmed against all 4 domain-parity fixtures.**
Every candidate the Python pipeline detected (`expected/candidates.json`)
was found in this spike's independently-extracted flat text, across all
four fixture cases including the run-splitting, field-code, and
drawing-object cases built for Phase 1.

**4. The hard case — cross-run replacement — works, and was independently
verified.** `run-split-name-001`'s 21-run fragmented paragraph
("Priya Natarajan" split into 3-character runs, similarly for the email and
CIN) had all three candidates redacted correctly via a **surgical byte
splice on the original XML string** — not a DOM parse-and-reserialize.
The result was verified three independent ways:
   - Re-parsed by this spike's own extractor: exact text match.
   - The untouched adjacent paragraph confirmed unaffected by the edit.
   - **Re-opened by `python-docx`** (a completely different, mature,
     independent implementation) and the redacted text read back exactly as
     expected. `soffice` also opened the earlier version of this same file
     and rendered it correctly (visually confirmed: heading formatting
     intact, both paragraphs correct).

**5. Binary parts (embedded images) survive untouched.** The `drawing-objects-001`
fixture's embedded PNG came back byte-identical after a full unzip/rezip
cycle, and the file still opened correctly afterward.

## The concrete architectural recommendation this produces

**DocumentRebuilder should perform surgical byte-range edits on the
original `document.xml` string, not parse it into a DOM and reserialize.**
This is the same principle the docx-editing skill used elsewhere in this
environment already follows for hand-edits ("edit `word/document.xml` in
place — do NOT reformat or pretty-print"), for the same underlying reason:
Word's own writer produces exact attribute ordering, whitespace, and
`xml:space="preserve"` markers that a naive reserialization is not
guaranteed to reproduce. A splice-based approach, as implemented in
`rebuild.ts`, leaves everything outside the exact matched text — every
attribute, every untouched run, all formatting — byte-for-byte as Word wrote
it. This should be written into the v0.2 architecture document's §6.13
(DocumentRebuilder) as an implementation constraint, not left as an open
implementation detail.

## What this does not prove

- **No comparison against a real npm-installed OOXML library.** This
  doesn't tell us whether `jszip`/`docx`/`mammoth` would have been easier,
  more correct on edge cases, or more browser-portable than the
  zero-dependency approach — only that the zero-dependency approach *works*
  for the patterns tested. That comparison needs npm access on a normal
  machine.
- **`CompressionStream`/`DecompressionStream` browser support wasn't
  checked here** (this is Node, not a browser). These APIs are Baseline
  widely-available in evergreen browsers as of recent versions, but actual
  target-browser support should be confirmed against whatever list comes
  out of Open Decision #1 ("Which browsers must DocScrub-Web officially
  support at launch?") before relying on them instead of a library.
- **No tracked-changes, comments, or protected-document fixture existed to
  test against** — the earlier structural spike found none in the one real
  document available. §15.2's risks around those constructs remain
  unverified either way.
- **Unicode/multi-byte edge cases in the splice logic are unverified.**
  JavaScript string indices are UTF-16 code units; the splice logic in
  `rebuild.ts` is internally consistent (same indexing scheme throughout),
  but wasn't specifically stress-tested against candidates containing
  surrogate pairs or combining characters.
- **The spike files use explicit `.ts` extensions in import specifiers**
  (`./document-text.ts`, not `./document-text.js`) to run directly under
  Node's experimental type stripping. This differs from `tsconfig.json`'s
  `"moduleResolution": "Bundler"` convention used in `src/`. Not a defect —
  bundler-resolved projects handle extensionless/`.js` imports differently
  from Node's native runner — but it means `spike/` code should be adapted,
  not copy-pasted verbatim, when it moves into `src/io/` as the real
  DocumentParser/DocumentRebuilder implementation.

## Effect on open questions

- **ADR-011 (worker-thread processing), currently Open:** the urgency
  implied by §15.2's "may be required earlier than expected" looks
  overstated for typical documents based on this data point (tens of
  milliseconds for a 1.3MB real document) — but this doesn't resolve the
  ADR, since a worker thread's value is also about keeping the main thread
  responsive during rebuild, not just raw throughput, and pathologically
  large documents weren't tested. Recommend: keep Open, but deprioritize
  relative to other Phase 2 work until real document size distribution
  data justifies revisiting it.
- **Dependency footprint for the compression layer:** if
  `CompressionStream`/`DecompressionStream` browser support is confirmed
  sufficient for the target browser list, DocumentParser/DocumentRebuilder
  may not need a ZIP library dependency at all for compression — only a
  small, auditable, ZIP-central-directory parser (this spike's `zip.ts` is
  ~200 lines and requires no third-party trust). That directly reduces the
  §15.3 risk "third-party dependency supply chain and privacy behavior must
  be vetted," for this layer specifically — fewer dependencies to vet.

## Recommended next step

Port `spike/ooxml/*.ts` into `src/io/DocumentParser.ts` and
`src/io/DocumentRebuilder.ts` as real implementations (reconciling the
import-extension difference noted above), backed by
`CompressionStream`/`DecompressionStream` instead of `node:zlib`, on a
machine with a browser to test against. Expand the fixture corpus with a
tracked-changes and a comments case once real (de-identified) examples are
available, since neither was testable here.

---

## Phase 2 continued (2026-07-27): remaining Gate A cases, and the constructs the spike didn't have fixtures for yet

The recommendation above ("expand the fixture corpus with a tracked-changes
and comments case... since neither was testable here") has now been acted
on, along with closing the two rebuild gaps Gate A's status explicitly
called out as remaining work. `scripts/build_structural_fixtures.py` now
builds 11 synthetic domain-parity cases (up from 3); every one has been
redacted end-to-end via `spike/redact-and-verify.ts` and independently
re-opened and checked by `python-docx`. Full per-construct classification
lives in `docs/ooxml-spike/construct-support-matrix.md` — this section
covers what changed and what was found, not a restated inventory.

### Gate A rebuild gaps closed

Both cases the earlier status noted as "extraction only, not yet tested"
for rebuild are now closed:

- `field-codes-001` — redacting field-result text verified end to end.
- `drawing-objects-001` — redacting text adjacent to an embedded image
  verified end to end; the embedded PNG survives byte-identical.

### A real bug found and fixed: nested `<w:p>` corruption

`document-text.ts`'s paragraph-span finder assumed `<w:p>` elements never
nest — true for ordinary body/table/header/footer content, false for a text
box's `w:txbxContent` (and for a content control's `w:sdtContent`, though
that case didn't trigger this specific bug because of *how* it nests — see
below). Building `text-box-001` surfaced this immediately: `redactParagraph`
produced XML `python-docx` could not even reopen (`ok: false`,
`pythonVerifiedNoResidualText: false`) because the outer paragraph's span
was computed as ending at the *inner* paragraph's `</w:p>`, corrupting
everything after it.

Fixed with a depth-aware, stack-based span finder
(`findAllParagraphSpans`) that walks every `<w:p>`/`<w:p/>`/`</w:p>` token
in document order and matches each to its true closing tag regardless of
nesting depth, then filters to top-level-only spans
(`findParagraphSpans`) to match `python-docx`'s `document.paragraphs`
semantics exactly — nested content's `<w:t>` is still picked up because the
run-scan operates over the whole (superset) span of its containing
top-level paragraph. Verified: `text-box-001` now produces exactly 3
top-level paragraphs (matching Python's count), the full redaction
round-trip passes, and a visual soffice/PDF check confirms the rendered
text reads "Note from [PERSON-REDACTED]" correctly. Full regression re-run
across all 11 fixtures still passes.

### Three confirmed leaks — content physically present in "redacted" output

These are not hypothetical risks; each was reproduced and directly
inspected in redacted spike output.

1. **Hyperlink relationship targets.** Redacting a hyperlink's visible
   display text does nothing to the relationship it points at.
   `word/_rels/document.xml.rels` still contains the real
   `Target="mailto:..."` address verbatim after redaction — confirmed by
   direct inspection of `hyperlink-001`'s redacted output. Neither the
   Python oracle nor the spike scans relationship targets at all today.

2. **Tracked-change deletions.** `<w:del>` wraps `<w:r><w:delText>` instead
   of the ordinary `<w:r><w:t>` that `<w:ins>` uses. `.//w:t` xpath (Python)
   and the spike's `WT_RE` regex both miss `<w:delText>` by design — both
   follow the document's *current* visible text. But the deleted run is
   still physically embedded in the file, and Word/LibreOffice render it
   with strikethrough. Visually confirmed: a soffice-rendered PDF of
   `tracked-changes-001`'s redacted output shows the tracked insertion
   correctly redacted (`[PERSON-REDACTED]`, insertion-colored) sitting right
   next to the tracked deletion, "Beatrice Alcantara", fully legible with
   strikethrough. A "redacted" document can still visibly display a name on
   screen.

3. **Comments.** `word/comments.xml` is a distinct OOXML part, never read by
   the current pipeline — `extract_accessible_xml_text()` in
   `redactor/docx_reader.py` exists but is dead code, never called from
   anywhere. Confirmed by direct inspection of `comments-001`'s redacted
   output: `word/comments.xml` still reads "Confirmed with Priscilla
   Nakamura over email." verbatim.

None of these three are migration regressions — the Python oracle has the
same three gaps today. They're newly *confirmed*, not newly *introduced*.
But porting the spike into a real DocumentParser/DocumentRebuilder without
addressing them would carry all three gaps forward into the new
implementation unchanged, which is worth a deliberate decision rather than
an accident of what happened to get ported.

### One open product decision, not resolved here: body-level content controls

`content-control-001`'s candidate ("Desmond Okonkwo") sits inside a
block-level content control (`<w:sdt>`/`<w:sdtContent>`) whose inner
`<w:p>` is a body-level *sibling*, not nested inside an already-enumerated
paragraph the way a text box's paragraph is. `python-docx`'s
`document.paragraphs` (direct-child-only traversal) never sees it at all —
confirmed via direct `d.paragraphs` inspection: 2 paragraphs enumerated,
neither containing the candidate. The spike's raw-string paragraph scan
finds it regardless, because string scanning doesn't care about XML
ancestry or `<w:sdt>` wrapping.

Today this produces no *observed* divergence, because fixture expected
output is generated from the Python oracle itself — there's nothing for the
spike to diverge against in this harness. But that's an artifact of how the
fixture is built, not a guarantee: a real browser `DocumentParser` built on
the spike's approach would surface MORE candidates than `python-docx` for
body-level content controls generally, which changes what a reviewer sees.
This is exactly the kind of "implementation decision that materially
changes product behavior" called out as a stop condition rather than
something to resolve silently — flagged here for a decision, not resolved
in either direction. Full detail in the fixture's manifest `notes`.

See `construct-support-matrix.md` for the consolidated classification
(Supported / Supported with Warning / Read-only / Unsupported) across all
11 constructs, including the three above plus the pre-existing,
migration-unrelated diacritic name-detection gap found incidentally while
building fixtures.

---

## Phase 3 (2026-07-27): production port, and closing three of the four open items above

Andrew reviewed the four items this document flagged as open (hyperlink
targets, tracked-change deletions, comments, content controls) and made
four architectural decisions, then authorized moving from feasibility spike
to production implementation. This section covers both: what got decided,
and what got built as a result. `spike/` is now superseded (see
`spike/SUPERSEDED.md`) — `src/io/` is the authoritative implementation.

### Decisions

- **Hyperlinks**: targets are sensitive content. A document isn't
  successfully redacted until both display text and target are handled.
  Silent leakage is unacceptable.
- **Tracked changes**: considered document content. Do not silently export
  a document whose tracked changes could still reveal redacted information;
  if deletions can't yet be rebuilt safely, surface that explicitly.
- **Comments**: in scope for review, same pipeline as ordinary text.
  Treat as a coverage limitation until full support exists.
- **Content controls**: approved as an intentional, permanent behavioral
  improvement over the Python oracle. Not an open question anymore.

### What got built

A real, working `CompressionStream`/`DecompressionStream`-backed
implementation replaced the Node-`zlib` spike. This is a meaningfully
stronger fidelity signal than Phase 2's prototype: `CompressionStream`/
`DecompressionStream` with `"deflate-raw"` are themselves Node 22 globals
(confirmed directly, no import, no npm), which means this environment can
run the actual target Web API, not a stand-in for it. Verified: a ZIP
round-trip test through the real `src/io/ooxml/zip.ts` reproduces every
part byte-identically.

New production modules, none of which existed as spike code because they
implement Phase 3's decisions specifically:

- `src/io/ooxml/hyperlinks.ts` — parses and surgically splices relationship
  targets in `.rels` parts.
- `src/io/ooxml/comments.ts` — extracts per-comment blocks; redaction reuses
  `document-text.ts`/`rebuild.ts` unchanged, since comments share the same
  `<w:p>`/`<w:r>`/`<w:t>` structure as body text.
- `src/io/ooxml/tracked-changes.ts` — extracts `<w:delText>` content for
  detection/surfacing only. Deliberately exports no splice function; there
  is no code path anywhere that can edit a tracked deletion.
- `src/io/ooxml/source-ref.ts` — a shared codec so `DocumentParser` (which
  writes `ContentBlock.sourceMapping.sourceRef`) and `DocumentRebuilder`
  (which reads it) can never disagree about the pointer format.

Two interface defects were found and fixed while implementing this for
real, not design preferences:

- `DocumentRebuilder.rebuild()` and `OutputVerifier.verify()` previously
  had no `DetectionResult` parameter, so neither could actually locate what
  to redact or what to rescan for. Both signatures now take
  `detection: DetectionResult` explicitly.
- `DocumentModel` had nowhere to carry the original OOXML bytes, even
  though `DocumentRebuilder`'s signature takes only a `DocumentModel` (no
  separate original-file parameter). Added `DocumentModel.sourceArchive`
  (schema v4) — see its doc comment for why this isn't new privacy
  exposure (the bytes are already in memory the moment `DocumentParser`
  runs).

`Candidate.detectedType` was added (schema v5) — Python's exported
candidates always carry one; the TS `Candidate` had nowhere to carry the
equivalent, which would have forced type-appropriate placeholder text
("[REDACTED EMAIL]" vs "[PERSON REDACTED]" etc.) to be guessed rather than
looked up.

**Explicit scope boundary drawn, not silently narrowed**:
`DocumentRebuilder` does NOT replicate Python's
`default_replacement()`/`ReplacementRuleEngine` (`redactor/decisions.py`,
`redactor/replacement_rules.py`) — sequential person numbering
(`[PERSON 001]`, `[PERSON 002]`, ...) and blanket-vs-sequential modes are
real, nontrivial domain logic that belongs in its own component, not
duplicated ad hoc inside the OOXML rebuild layer. When
`CandidateDecision.replacement` is set, that exact string is used; when
not, a minimal, honestly-labeled, type-aware fallback is used and flagged
(`DocumentRebuilder.ts`'s "SCOPE BOUNDARY" section) — not pretending to be
Python's real default text.

### Verification

`verify/production-parity.ts` exercises the real `OoxmlDocumentParser` ->
`OoxmlDocumentRebuilder` -> `OoxmlOutputVerifier` pipeline (not spike code)
against all 12 fixtures, since `DetectionEngine` doesn't exist in
TypeScript yet, by constructing a synthetic `DetectionResult`/
`ReviewSession` from each fixture's `expected/occurrences.json` — standing
in for "detection already ran and a reviewer decided to redact everything
found." Each fixture is checked three ways: `OutputVerifier.passed`,
independent `python-docx` re-open with residual-text search across
paragraphs/tables/headers/footers, and a raw-ZIP check of
`word/comments.xml`. Two additional fixture-independent checks prove the
hyperlink-target splice and the tracked-deletion safety net specifically,
since no fixture's Python-oracle-derived expected data naturally exercises
either (Python doesn't know about hyperlink targets or deleted text at
all).

**Result: 14/14 checks pass**, including the safety-net test (which
_expects_ `OutputVerifier.passed === false` with a blocker finding — proof
the "surface explicitly, don't imply full redaction" guarantee actually
fires, not just that ordinary redaction works). `tsc --noEmit` passes with
zero errors across all of `src/`, including the new `src/io/ooxml/*`
modules.

One known harness-level (not implementation-level) limitation: two Python
detectors independently classify the same literal span in
`synthetic-transcript-001` ("555-987-6543" as both `phone` and
`long_numeric_id`) — an ambiguity Python's own review pipeline is meant to
resolve via occurrence-groups/ambiguity-proposals, which this simple
verification harness doesn't model. 13/14 of that fixture's expected
occurrences get matched to a block; the 14th is a duplicate-text collision
in the harness's matching logic, not a redaction failure.
