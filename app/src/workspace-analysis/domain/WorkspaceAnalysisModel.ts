/**
 * WorkspaceAnalysisModel.ts — the domain vocabulary for the Workspace
 * Analysis subsystem (2026-08-01).
 *
 * INDEPENDENCE, BY DESIGN: this file, and everything under
 * `src/workspace-analysis/`, is a self-contained subsystem answering one
 * question only -- "which of these imported documents appear to belong to
 * the same semantic world?" -- built to be developed, tested, and
 * demonstrated entirely independently of the existing review pipeline
 * (Ambiguity Check / Group Check / Item Check / Triage), so that work here
 * can proceed concurrently with other active work on that pipeline with
 * minimal file/type/reducer/UI/test overlap. See
 * `docs/architecture/decisions/ADR-019-workspace-analysis-independence.md`
 * for the full boundary rationale and
 * `docs/detection/workspace-analysis-phase-1-findings.md` for what shipped.
 *
 * Nothing in this file (or this subsystem) imports from `src/domain/`,
 * `src/engines/`, `src/workspace/`, or `src/ui/app.ts`. The one exception,
 * documented at each call site, is a small allowlist of genuinely-generic
 * OOXML/hashing primitives in `src/io/` that have no review-domain
 * semantics of their own (see `../io/extractText.ts`). This independence
 * is enforced structurally, not just by convention --
 * `verify/workspace-analysis-verification.ts` greps every import in this
 * subsystem and fails loudly if that allowlist is ever exceeded.
 *
 * NAMING NOTE: "Workspace Analysis" (this subsystem) is unrelated to
 * `src/workspace/Workspace.ts`'s `ReviewWorkspace` (the existing
 * single-document review session orchestrator). The name collision is
 * Andrew's own feature name choice, not a hint of a relationship between
 * the two -- there is none. Everywhere in this subsystem's own code and
 * docs, "workspace" refers to a proposed group of related documents, never
 * a `ReviewWorkspace` instance.
 *
 * PURPOSE, EXPLICITLY BOUNDED: this subsystem decides only "do these
 * documents appear related, and how strongly." It does not decide what is
 * PII, which entities match within a document, what should be kept or
 * redacted, or which reviewer decisions should propagate across related
 * documents -- those remain the review pipeline's job, entirely out of
 * scope here. A confirmed workspace grouping may LATER inform where review
 * knowledge is allowed to be shared (Decision Reuse's natural next
 * evolution), but that hand-off is explicitly not implemented in this
 * phase -- see this module's own doc comments for the exact persistence
 * boundary.
 */

/** One document as WorkspaceAnalysis sees it: already-extracted plain text
 *  plus the minimal identifying metadata needed for evidence and display.
 *  Deliberately NOT a `DocumentModel` (`src/domain/DocumentModel.ts`) --
 *  that type is explicitly framed, in its own top doc comment, as "the
 *  format-neutral internal representation consumed by the detection/
 *  quality/review pipeline." Reusing it would be exactly the semantic
 *  dependency the independence requirement forbids, even though
 *  structurally it is "just" parsed text. `documentId` is a SHA-256 of the
 *  original file's raw bytes (via `../io/extractText.ts`, itself reusing
 *  only `src/io/hash.ts` -- a already-established, genuinely generic
 *  primitive, see that file's own doc comment), independent of and never
 *  compared against a review-session `DocumentModel.documentId`, even
 *  though both happen to use the same hash function on the same bytes for
 *  the same reason (stable content identity). */
export interface WorkspaceAnalysisInputDocument {
  documentId: string;
  fileName: string;
  /** Byte length of the original file -- used only as a coarse structural
   *  signal (see `DocumentFingerprint.structureSignature`), never as
   *  evidence of relatedness on its own. */
  byteLength: number;
  /** Flattened plain text extracted from the document's body/header/footer
   *  paragraphs. No PII detection, no candidate extraction, no entity
   *  resolution runs over this -- it exists only to derive the fingerprint
   *  features below. */
  text: string;
}

/** A category of deterministic, document-level evidence this subsystem
 *  extracts. Each kind has its own extraction heuristic and its own
 *  scoring weight (see `scoring.ts`) -- kept as a closed union, not a
 *  free-form string, so a new evidence kind is a deliberate, reviewable
 *  addition to both extraction and scoring together, never one without
 *  the other. */
export type RelationshipEvidenceKind =
  | "shared-identifier"
  | "shared-email-domain"
  | "shared-organization"
  | "shared-acronym"
  | "shared-distinctive-term"
  | "vocabulary-overlap"
  | "filename-similarity"
  | "structure-similarity";

/** One piece of supporting evidence for a document pair's relationship --
 *  the "reasons" the spec asks for, kept structured (not just a sentence)
 *  so the UI can render them consistently and a future consumer (e.g. an
 *  eventual review-pipeline hand-off) can filter/rank them without
 *  re-parsing prose. */
export interface RelationshipEvidenceItem {
  kind: RelationshipEvidenceKind;
  /** The specific shared value this evidence item is about (a matter
   *  number, an organization name, a domain) -- absent for aggregate
   *  signals that have no single discrete value (vocabulary-overlap,
   *  structure-similarity). */
  value?: string;
  /** Human-readable explanation, e.g. `Both mention "Contoso Legal
   *  Services"` -- always populated, never assembled by the UI from
   *  `value` alone, so a signal kind's phrasing can change in one place. */
  description: string;
  /** This item's contribution to the pair's total score, already capped
   *  per `scoring.ts`'s per-category ceilings -- summed, not averaged, to
   *  produce `DocumentPairRelationship.score`. */
  weight: number;
}

/** A document's extracted, purpose-built features -- "deterministic
 *  document-level features derived specifically for workspace analysis,"
 *  per the hard architectural boundary. None of these are produced by, or
 *  shared with, `DetectionEngine`/`CandidateQualityEngine`/the quality
 *  dictionaries under `src/engines/quality/` -- see `fingerprint.ts` for
 *  why a fresh, small, purpose-built extraction was written rather than
 *  reusing that machinery. */
export interface DocumentFingerprint {
  documentId: string;
  fileName: string;
  /** Multi-word capitalized phrases (candidate person/case/matter names),
   *  frequency-ranked, generic-opener-filtered. Not the same concept as a
   *  review-pipeline `Candidate` -- no evidence, no quality score, no
   *  entity identity, just a plain string used for set-overlap scoring. */
  distinctiveTerms: string[];
  /** Terms matching a small, purpose-built organization-suffix heuristic
   *  (Inc/LLC/Corp/...), NOT `config/candidate-quality/
   *  organization_suffixes.txt` or any other review-pipeline lexicon. */
  organizations: string[];
  /** Domains from email addresses found in the text, EXCLUDING a fixed
   *  stoplist of large public providers (gmail.com and similar) -- a
   *  shared public-provider domain is not evidence of anything. */
  emailDomains: string[];
  /** Matter/case/file/docket numbers and generic alphanumeric identifier
   *  patterns (e.g. `AB-12345`). The single strongest evidence category --
   *  see `scoring.ts`'s weight table and its own reasoning. */
  identifiers: string[];
  /** All-caps tokens (2-6 letters) appearing at least twice in the
   *  document, excluding a small stoplist of ultra-common acronyms
   *  (PDF, CEO, USA, ...). The repetition requirement and stoplist both
   *  exist for the same reason: an acronym that appears once, or that is
   *  common formatting boilerplate, is not distinguishing evidence. */
  acronyms: string[];
  /** Lowercase word -> frequency, restricted to words of length >= 4 with
   *  a compact stopword list removed -- the input to vocabulary-overlap
   *  cosine similarity. Intentionally the WEAKEST signal in this model
   *  (see `scoring.ts`'s low weight ceiling for this category) precisely
   *  because generic vocabulary is the easiest way to manufacture false
   *  similarity -- the hard boundary this subsystem was asked to respect
   *  explicitly. */
  termFrequency: Record<string, number>;
  /** Filename tokens (split on non-alphanumeric separators, lowercased,
   *  length >= 3, generic-filename-word-filtered) -- e.g.
   *  "Smith_v_Jones_Matter_4521_Complaint.docx" contributes
   *  ["smith","jones","matter","4521","complaint"]. */
  filenameTokens: string[];
  /** A coarse, low-resolution shape descriptor (paragraph-count bucket +
   *  average-paragraph-length bucket) -- deliberately the LOWEST-weighted
   *  signal in scoring (two documents merely sharing "medium length,
   *  medium density" is common formatting, not relatedness). Exists only
   *  as a tie-breaking corroborator, never a primary driver -- see
   *  `scoring.ts`. */
  structureSignature: string;
}

/** The computed relationship between exactly one pair of documents.
 *  `meetsThreshold` is the single gate every clustering and merge decision
 *  in this subsystem reads -- see `MINIMUM_RELATIONSHIP_THRESHOLD` in
 *  `scoring.ts` for the conservative value and its reasoning. */
export interface DocumentPairRelationship {
  documentIdA: string;
  documentIdB: string;
  /** Composite score in [0, 1] -- the additive, per-category-capped sum
   *  described in `scoring.ts`, clamped. Not a probability; a conservative
   *  ranking/gating signal only. */
  score: number;
  evidence: RelationshipEvidenceItem[];
  meetsThreshold: boolean;
}

/** A proposed grouping of related documents. `strength` is the MINIMUM
 *  pairwise score among every pair inside the cluster (the "weakest link,"
 *  not an average) -- a deliberate conservative choice, matching
 *  `clustering.ts`'s clique semantics: every member of a cluster is
 *  required to independently relate to every other member, not merely be
 *  transitively reachable through an intermediate document. See
 *  `clustering.ts`'s own top doc comment for why. */
export interface WorkspaceClusterProposal {
  clusterId: string;
  documentIds: string[];
  strength: number;
  /** Deduplicated, weight-sorted evidence drawn from every pair inside the
   *  cluster -- the "reasons supporting each cluster" the spec asks for. */
  reasons: RelationshipEvidenceItem[];
}

/** The complete, self-contained output of one analysis run -- everything
 *  the UI, the state container, or any future consumer needs, and nothing
 *  that requires a review session, reviewer decisions, or any other
 *  review-pipeline state to interpret. Deliberately carries no wall-clock
 *  timestamp or other non-deterministic field -- `analyzeWorkspace()` is a
 *  pure function of its input documents, and this result is asserted
 *  byte-stable for identical input in
 *  `verify/workspace-analysis-verification.ts`. */
export interface WorkspaceAnalysisResult {
  fingerprints: DocumentFingerprint[];
  pairRelationships: DocumentPairRelationship[];
  clusters: WorkspaceClusterProposal[];
  /** Every documentId not included in any cluster -- "documents that
   *  appear unrelated," rendered as their own explicit section rather than
   *  left to be inferred by absence. */
  unrelatedDocumentIds: string[];
}
