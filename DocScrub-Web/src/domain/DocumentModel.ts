/**
 * DocumentModel — the format-neutral internal representation consumed by the
 * detection/quality/review pipeline. See architecture doc v0.2 §6.2.
 *
 * This decouples detection logic from OOXML details: DocumentParser (src/io/
 * DocumentParser.ts) is the only component that should ever need to know
 * about the raw OOXML shape of a .docx file.
 */

/**
 * v2 (2026-07-27): added ContentBlock.runMappings (RunMapping[]).
 * Confirmed necessary by the Phase 2 OOXML spike
 * (DocScrub-Web/docs/ooxml-spike/phase-2-findings.md), not speculative --
 * DocumentRebuilder has to resolve a logical Occurrence's
 * [startOffset, endOffset) back onto physical <w:t> runs, which routinely
 * span more than one run in real documents (up to 21 runs for one
 * paragraph in a fixture; up to 15 in a real document, per the Phase 1
 * structural spike). v1 had nowhere to carry that mapping, which would
 * have forced DocumentRebuilder to re-parse the original OOXML itself --
 * defeating the point of a format-neutral DocumentModel that only
 * DocumentParser needs to build once.
 *
 * v3 (2026-07-27): added "comment" and "tracked-deletion" to
 * DocumentPartKind, and formalized how "hyperlink" blocks are used. Driven
 * directly by Andrew's Phase 3 architectural decisions
 * (docs/ooxml-spike/phase-2-findings.md, "Phase 2 continued" section, and
 * construct-support-matrix.md):
 *   - Hyperlinks: a hyperlink's relationship target (the URL) is sensitive
 *     content, not just its visible display text. DocumentParser now
 *     produces a "hyperlink" block per hyperlink relationship, whose `text`
 *     is the target URL -- separate from the ordinary body/header/footer
 *     block that carries the hyperlink's visible display text. Detection
 *     runs over both independently.
 *   - Comments: word/comments.xml content is in scope for the same review
 *     pipeline as ordinary text. "comment" blocks carry comment body text.
 *   - Tracked changes: <w:del>/<w:delText> content is "document content"
 *     per Andrew's decision, but cannot yet be safely rebuilt/redacted (see
 *     DocumentRebuilder.ts, OutputVerifier.ts). "tracked-deletion" blocks
 *     exist so DetectionEngine can still surface candidates found there --
 *     enabling OutputVerifier to fail verification loudly rather than
 *     silently claim full redaction, which is the concrete mechanism behind
 *     "do not silently export documents containing tracked changes that
 *     could reveal redacted information."
 *
 * v4 (2026-07-27): added DocumentModel.sourceArchive, and narrowed what
 * ContentBlock.runMappings is actually FOR. Found while implementing the
 * real DocumentRebuilder (src/io/DocumentRebuilder.ts): its interface
 * signature only ever took a DocumentModel (never the original File), so
 * DocumentModel itself has to carry enough of the original OOXML for
 * reconstruction -- there was previously no field for that at all. This is
 * a defect fix (the interface as specified could not actually be
 * implemented), not a redesign.
 *
 * Given DocumentModel now carries the original bytes, DocumentRebuilder
 * re-parses the relevant part fresh at rebuild time (via the same pure,
 * deterministic parse functions DocumentParser used -- ooxml/document-
 * text.ts, ooxml/comments.ts, ooxml/hyperlinks.ts) rather than trusting a
 * second, separately-serialized copy of run offsets in
 * ContentBlock.runMappings for the actual splice. Re-parsing immutable
 * bytes is cheap (spike-measured ~40ms for a 6,134-paragraph real
 * document) and cannot drift out of sync with itself, whereas trusting a
 * duplicated runMappings copy could in principle go stale relative to the
 * bytes it describes. runMappings is kept in the schema -- it's still
 * useful to any future consumer that wants physical run boundaries without
 * re-parsing (e.g. an inline preview UI) -- but it is no longer load-
 * bearing for DocumentRebuilder's correctness. See ooxml/source-ref.ts for
 * the actual pointer format ContentBlock.sourceMapping.sourceRef and
 * DocumentRebuilder now use.
 *
 * v5 (2026-07-27): added Candidate.detectedType (see that interface's own
 * changelog note below). Note: this version number was documented but the
 * constant itself was left at 4 in the same pass -- caught and fixed here
 * while adding v6. Both DocumentParser.ts's returned schemaVersion literal
 * and this constant now agree.
 *
 * v6 (2026-07-27): added Candidate.source/confidence and Occurrence.source.
 * Found while porting redactor/detectors.py (Phase 4, DetectionEngine):
 * Python's Candidate carries `source` (which detector/pattern found it,
 * e.g. "regex", "fallback-name-regex") and `confidence`
 * ("high"/"medium"/"low", assigned once from the first occurrence found),
 * and every individual Occurrence separately carries its OWN `source` --
 * the same candidate can accumulate occurrences from different detectors
 * (e.g. one name found by the last-first-name regex, another instance of
 * the same normalized name found later by the single-name-with-repetition
 * heuristic). Both fields are present in every fixture's
 * expected/candidates.json and expected/occurrences.json and are real
 * detection-time provenance, not CandidateQualityEngine scoring -- so they
 * belong here, not on QualityResult/Evidence (Evidence.ts).
 */
export const DOCUMENT_MODEL_SCHEMA_VERSION = 6 as const;

/** Matches Python's three-level detector confidence vocabulary exactly
 *  (redactor/detectors.py's literal "high"/"medium"/"low" strings passed to
 *  _add_occurrence) -- not a new taxonomy, and deliberately not a numeric
 *  score (that's CandidateQualityEngine's job, via Evidence.weight). */
export type DetectorConfidence = "high" | "medium" | "low";

export type DocumentPartKind =
  | "body"
  | "header"
  | "footer"
  | "table"
  /** A hyperlink relationship's target URL (the string in Target="...",
   *  read from a part's _rels/*.rels file) -- NOT the visible display text,
   *  which lives in an ordinary body/header/footer block instead. See v3
   *  note above. DocumentRebuilder redacts these via
   *  ooxml/hyperlinks.ts's spliceRelationshipTarget, not the ordinary
   *  run-splice path. */
  | "hyperlink"
  /** word/comments.xml comment body text. Redacted via the same run-splice
   *  path as body/header/footer (see ooxml/comments.ts) -- comments use the
   *  same <w:p>/<w:r>/<w:t> structure internally. */
  | "comment"
  /** Text found inside <w:del>/<w:delText> (a tracked-change deletion).
   *  Read-only: DocumentRebuilder must never attempt to splice a
   *  tracked-deletion block's runMappings (unsafe -- see
   *  ooxml/tracked-changes.ts). Exists purely so detection can see this
   *  content and OutputVerifier can flag it, not so it can be redacted. */
  | "tracked-deletion"
  | "metadata"
  | "unsupported";

export interface SourceMapping {
  /** The OOXML part name this block originated from, e.g.
   *  "word/document.xml", "word/header1.xml", "word/comments.xml", or a
   *  .rels part for hyperlink blocks. Opaque outside DocumentParser/
   *  DocumentRebuilder in the sense that other consumers must not need to
   *  interpret it -- but unlike sourceRef below, this is a literal ZIP
   *  entry name, useful even for a human reading a debug dump. */
  partId: string;
  /** Opaque pointer used to re-locate this block's content within the
   *  original OOXML at rebuild time -- see ooxml/source-ref.ts for the
   *  concrete encode/decode functions and format. DocumentModel consumers
   *  other than DocumentParser/DocumentRebuilder must never need to
   *  interpret this themselves. */
  sourceRef: string;
}

/**
 * A physical run's boundaries within its containing block's flat `text`,
 * plus an opaque pointer back to that run in the original OOXML.
 *
 * Logical occurrences (Occurrence, below) are deliberately independent of
 * physical run boundaries -- a candidate's text is whatever it is in the
 * block's joined `text`, regardless of how Word happened to fragment it
 * into runs. Informational/debugging use (e.g. a future UI wanting to show
 * physical run boundaries) rather than load-bearing for redaction
 * correctness -- see the v4 changelog note above: DocumentRebuilder
 * re-derives real run offsets by re-parsing DocumentModel.sourceArchive at
 * rebuild time instead of trusting this serialized copy, so it cannot
 * drift out of sync with the bytes it describes.
 */
export interface RunMapping {
  /** This run's [start, end) within the containing block's `text`. */
  start: number;
  end: number;
  sourceRef: string;
}

export interface ContentBlock {
  id: string;
  kind: DocumentPartKind;
  /** Plain extracted text for this block, already normalized for detection. */
  text: string;
  /** Ordering key; stable across a single parse, not guaranteed stable across
   *  re-parses of an edited document. */
  order: number;
  sourceMapping: SourceMapping;
  /** Physical run boundaries within `text`, in document order. See
   *  RunMapping. DocumentRebuilder owns mapping logical replacements onto
   *  this structure; no other component should read it. */
  runMappings: RunMapping[];
}

export interface DocumentFeatureFlags {
  /** Features DocumentParser recognized and can round-trip. */
  supported: string[];
  /** Features DocumentParser recognized but cannot faithfully round-trip
   *  today (e.g. tracked changes, certain field codes). Surfaced to the
   *  reviewer and to DocumentRebuilder/OutputVerifier as fidelity risk,
   *  never silently dropped. */
  unsupported: string[];
}

/**
 * Every part of the original ZIP archive, keyed by OOXML part name, exactly
 * as read from the source file. Opaque outside DocumentParser/
 * DocumentRebuilder -- DetectionEngine, CandidateQualityEngine,
 * EntityResolutionEngine, ExplanationEngine, and ReviewEngine must never
 * read this field; it exists solely so DocumentRebuilder can reconstruct
 * the output DOCX from a DocumentModel alone (its interface signature
 * takes no separate original-File parameter). Does not represent new
 * privacy exposure: these bytes are already necessarily in memory from the
 * uploaded File the moment DocumentParser runs, browser-local per §4.1;
 * this field just gives them a documented home instead of leaving
 * DocumentRebuilder with no way to reach them at all. See v4 changelog
 * note above.
 */
export interface OpaqueSourceArchive {
  parts: Map<string, Uint8Array>;
}

export interface DocumentModel {
  schemaVersion: typeof DOCUMENT_MODEL_SCHEMA_VERSION;
  /** Stable identity for this source document (e.g. a content hash),
   *  independent of filename. Used to detect "same document, reopened". */
  documentId: string;
  fileName: string;
  metadata: Record<string, string>;
  blocks: ContentBlock[];
  features: DocumentFeatureFlags;
  /** Non-fatal issues encountered while parsing (e.g. "nested table depth
   *  exceeds N", "nonstandard field code ignored"). Always surfaced to the
   *  reviewer; never used to silently change detection behavior. */
  processingWarnings: string[];
  /** See OpaqueSourceArchive. Only DocumentParser and DocumentRebuilder may
   *  read this field. */
  sourceArchive: OpaqueSourceArchive;
}

/**
 * A unique detected value that may require review (glossary, §18).
 * Identity here is deliberately narrow: Candidate does not carry review
 * decisions or scoring — see ReviewSession and Evidence for those.
 *
 * v5 (2026-07-27): added `detectedType`. A real, confirmed domain-parity
 * gap found while implementing DocumentRebuilder for real: the Python
 * oracle's exported candidates.json always carries a `detectedType` field
 * ("person", "email", "phone", "cin", "long_numeric_id", ...;
 * redactor/decisions.py), used to pick a type-appropriate default
 * placeholder ("[REDACTED EMAIL]", etc.) when a reviewer hasn't set an
 * explicit replacement. The TS Candidate had nowhere to carry the
 * equivalent, which would have forced DocumentRebuilder to guess or
 * silently use one generic placeholder for every type -- a real behavioral
 * divergence, not a cosmetic one. Only the field was added here; Python's
 * default_replacement()/ReplacementRuleEngine logic (sequential person
 * numbering, blanket-vs-sequential modes) has NOT been ported -- see
 * DocumentRebuilder.ts's doc comment for the honest scope boundary this
 * draws for now.
 */
export interface Candidate {
  id: string;
  /** e.g. "person", "email", "phone", "cin", "long_numeric_id" -- matches
   *  Python's Candidate.detected_type vocabulary exactly (redactor/
   *  decisions.py) so this stays a domain-parity field, not a new taxonomy. */
  detectedType: string;
  /** Which detector/pattern produced the FIRST occurrence found for this
   *  candidate, e.g. "regex", "fallback-name-regex",
   *  "fallback-single-name-regex" -- matches Python's Candidate.source
   *  exactly, including its quirk of reflecting only the first occurrence
   *  rather than being recomputed as more occurrences are found (ported
   *  faithfully for parity; see Occurrence.source below for full
   *  per-occurrence provenance instead). */
  source: string;
  /** Matches Python's Candidate.confidence -- see DetectorConfidence. Same
   *  "first occurrence only" quirk as `source`. */
  confidence: DetectorConfidence;
  /** Normalized value used for grouping/matching (see EntityResolutionEngine). */
  normalizedValue: string;
  /** One representative literal form, for display only -- e.g. "Jane
   *  Smith". NOT necessarily what appears at every occurrence: the same
   *  candidate can have occurrences reading "Smith, Jane" or other literal
   *  variants that normalize to the same entity. Confirmed by the Phase 2
   *  spike the hard way: an early redaction prototype searched the
   *  document for each candidate's displayValue and silently missed
   *  occurrences whose literal text differed. DocumentRebuilder MUST
   *  redact using each Occurrence's own `text` field below, never
   *  Candidate.displayValue. */
  displayValue: string;
  occurrenceIds: string[];
}

/** A specific location where a candidate appears in the document (glossary, §18). */
export interface Occurrence {
  id: string;
  candidateId: string;
  blockId: string;
  /** Character offsets are only stable within one parse of one DocumentModel;
   *  they are not carried across re-parses (see §15.3, "stable candidate and
   *  occurrence identifiers may change when parsing changes"). Resolved to
   *  physical runs via the containing block's runMappings -- see
   *  RunMapping. */
  startOffset: number;
  endOffset: number;
  /** This occurrence's own literal text -- may differ from
   *  Candidate.displayValue (see above). This is what DocumentRebuilder
   *  must search for/replace, not the candidate's canonical form. */
  text: string;
  context: string;
  /** Which detector/pattern found THIS specific occurrence -- matches
   *  Python's Occurrence.source exactly (e.g. "regex", "fallback-name-
   *  regex", "fallback-single-name-regex"). Unlike Candidate.source, this
   *  is always accurate per-occurrence, not just the first one found. */
  source: string;
}
