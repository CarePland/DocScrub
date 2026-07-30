/**
 * DetectionEngine — architecture v0.2 §6.3. Synchronous and pure: runs
 * deterministic detectors against a DocumentModel and produces candidates +
 * occurrences. No UI, persistence, or review-decision responsibilities.
 *
 * Kept synchronous per ADR-011/§12: this is in-memory, deterministic work
 * today (matching redactor/detectors.py), so it should not be Promise-wrapped
 * ahead of any evidence that a worker-thread boundary is actually needed.
 *
 * PRODUCTION IMPLEMENTATION (Phase 4): RegexDetectionEngine below is a
 * faithful, near-line-for-line port of redactor/detectors.py -- the
 * behavioral oracle. Every regex, stop list, and piece of matching logic
 * traces back to a specific function there (see src/engines/detectors/
 * patterns.ts for the regex/stop-list port, cited inline). See
 * docs/detection/phase-4-findings.md for the full port record and every
 * documented deviation.
 *
 * WHAT WAS PORTED: detect_regex_candidates() (email/phone/cin/
 * long_numeric_id) and detect_people()'s DETERMINISTIC regex-fallback path
 * (LAST_FIRST_PERSON_RE / FALLBACK_PERSON_RE / SINGLE_PERSON_RE with stop-
 * word and capitalized-neighbor filtering, plus the >=2-occurrence
 * threshold for single first names).
 *
 * WHAT WAS NOT PORTED, deliberately: detect_people()'s spaCy NER path.
 * Three independent reasons converge on the same answer here, not just
 * one: (1) spaCy is not installed in the environment this was built or
 * verified in (`ModuleNotFoundError: No module named 'spacy'`), so there
 * is no way to even confirm its exact behavior as an oracle; (2) every
 * existing Python test (tests/test_detectors.py, tests/test_docx_flow.py)
 * explicitly calls `detect_all_candidates(..., use_spacy=False)`, meaning
 * the Python project's OWN test suite treats the regex-fallback path as
 * the behavior worth pinning down, not the spaCy path; (3) Andrew's Phase
 * 4 instructions explicitly say to avoid introducing machine-learning
 * inference into the core detection pipeline, and spaCy's NER model is
 * exactly that. If Python is actually deployed somewhere with spaCy
 * installed, its person-detection behavior would differ from both this
 * port AND from what Python's own test suite verifies -- that's a known,
 * flagged, ACCEPTED divergence, not a silently-missed one.
 *
 * BLOCK COVERAGE, an intentional improvement over Python: this engine runs
 * over every ContentBlock in the DocumentModel, which as of Phase 3
 * includes "hyperlink" (relationship target URLs) and "tracked-deletion"
 * blocks that Python's own text-extraction pipeline never produces at all.
 * This is what actually closes the hyperlink-target and tracked-deletion
 * detection gap in practice (Phase 3 only proved the redaction/
 * verification MECHANISM using synthetic detection results; this is the
 * real detection). Not a silent deviation: Andrew explicitly decided both
 * "hyperlink targets are sensitive content" and "tracked changes are
 * considered document content" in Phase 3.
 */

import type { Candidate, ContentBlock, DetectorConfidence, DocumentModel, Occurrence } from "../domain/DocumentModel.js";
import {
  CIN_RE,
  containsEmail,
  EMAIL_RE,
  FALLBACK_PERSON_RE,
  isDateLikeFullMatch,
  LAST_FIRST_PERSON_RE,
  LONG_ID_RE,
  PERSON_STOP_PHRASES,
  PHONE_RE,
  SINGLE_PERSON_RE,
  SINGLE_PERSON_STOP_WORDS,
} from "./detectors/patterns.js";

export interface DetectionResult {
  schemaVersion: 1;
  candidates: Candidate[];
  occurrences: Occurrence[];
}

export interface DetectionEngine {
  detect(document: DocumentModel): DetectionResult;
}

// ---- Ported helpers (redactor/detectors.py) --------------------------------

// def normalize_candidate(text: str, detected_type: str) -> str:
function normalizeCandidate(text: string, detectedType: string): string {
  let compact = text.trim().replace(/\s+/g, " ");
  if (detectedType === "person" && compact.includes(",")) {
    const commaIndex = compact.indexOf(",");
    const last = compact.slice(0, commaIndex).trim();
    const first = compact.slice(commaIndex + 1).trim();
    compact = `${first} ${last}`;
  }
  if (detectedType === "phone" || detectedType === "cin" || detectedType === "long_numeric_id") {
    compact = compact.replace(/\D/g, "");
  }
  // Python uses str.casefold(), which is more aggressive than JS's
  // toLowerCase() for a handful of non-ASCII characters (e.g. German
  // "ß" -> "ss"). Every candidate type/fixture this engine has been
  // verified against is ASCII-range, so this is a documented, low-risk
  // deviation rather than a justification to hand-roll a casefold table --
  // see phase-4-findings.md.
  return `${detectedType}:${compact.toLowerCase()}`;
}

// def context_snippet(text: str, start: int, end: int, window: int = 70) -> str:
function contextSnippet(text: string, start: number, end: number, window = 70): string {
  const left = Math.max(0, start - window);
  const right = Math.min(text.length, end + window);
  const prefix = left > 0 ? "..." : "";
  const suffix = right < text.length ? "..." : "";
  return prefix + text.slice(left, start) + "[" + text.slice(start, end) + "]" + text.slice(end, right) + suffix;
}

// def _is_date_or_page_number(text, block_text, start, end) -> bool:
function isDateOrPageNumber(text: string, blockText: string, start: number, end: number): boolean {
  const value = text.trim();
  if (isDateLikeFullMatch(value)) return true;
  const digits = value.replace(/\D/g, "");
  const nearbyStart = Math.max(0, start - 15);
  const nearbyEnd = Math.min(blockText.length, end + 15);
  const nearby = blockText.slice(nearbyStart, nearbyEnd).toLowerCase();
  if (digits.length <= 4 && nearby.includes("page")) return true;
  return false;
}

// def _has_capitalized_neighbor(text, start, end) -> bool:
// (Python's `text` parameter here is the whole block's text, not the match.)
const PREV_CAPITALIZED_TOKEN_RE = /([A-Z][a-zA-Z'’-]{1,30})[,]?$/;
const NEXT_CAPITALIZED_TOKEN_RE = /^[,]?\s*([A-Z][a-zA-Z'’-]{1,30})\b/;
function hasCapitalizedNeighbor(blockText: string, start: number, end: number): boolean {
  const before = blockText.slice(0, start).replace(/\s+$/, "");
  const after = blockText.slice(end).replace(/^\s+/, "");
  return PREV_CAPITALIZED_TOKEN_RE.test(before) || NEXT_CAPITALIZED_TOKEN_RE.test(after);
}

// ---- Working (mutable, pre-flatten) candidate representation ---------------
// Mirrors Python's OrderedDict[str, Candidate] where Candidate.occurrences
// is a growable list -- JS's Map preserves insertion order the same way
// OrderedDict does, which matters here: first-seen order determines the
// final DetectionResult.candidates order, matching Python exactly.

interface WorkingOccurrence {
  block: ContentBlock;
  /** Unstripped match span, matching Python's match.start()/match.end(). */
  matchStart: number;
  matchEnd: number;
  /** Stripped text -- matches Python's match.group(0).strip(). */
  text: string;
  source: string;
}

interface WorkingCandidate {
  key: string;
  detectedType: string;
  /** First occurrence's stripped text -- Python's Candidate.text, used as
   *  the eventual Candidate.displayValue. */
  displayText: string;
  /** First-occurrence-only, matching Python's Candidate.source/confidence
   *  quirk exactly -- see DocumentModel.ts's v6 changelog note. */
  source: string;
  confidence: DetectorConfidence;
  occurrences: WorkingOccurrence[];
}

// def _add_occurrence(found, block, match, detected_type, source, confidence) -> None:
function addOccurrence(
  found: Map<string, WorkingCandidate>,
  block: ContentBlock,
  matchText: string,
  matchStart: number,
  matchEnd: number,
  detectedType: string,
  source: string,
  confidence: DetectorConfidence
): void {
  const text = matchText.trim();
  if (!text) return;
  const key = normalizeCandidate(text, detectedType);
  let candidate = found.get(key);
  if (!candidate) {
    candidate = { key, detectedType, displayText: text, source, confidence, occurrences: [] };
    found.set(key, candidate);
  }
  candidate.occurrences.push({ block, matchStart, matchEnd, text, source });
}

// def detect_regex_candidates(blocks) -> OrderedDict[str, Candidate]:
function detectRegexCandidates(blocks: ContentBlock[]): Map<string, WorkingCandidate> {
  const found = new Map<string, WorkingCandidate>();
  for (const block of blocks) {
    for (const match of block.text.matchAll(EMAIL_RE)) {
      const start = match.index ?? 0;
      addOccurrence(found, block, match[0], start, start + match[0].length, "email", "regex", "high");
    }
    for (const match of block.text.matchAll(PHONE_RE)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (!isDateOrPageNumber(match[0], block.text, start, end)) {
        addOccurrence(found, block, match[0], start, end, "phone", "regex", "medium");
      }
    }
    for (const match of block.text.matchAll(CIN_RE)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (!isDateOrPageNumber(match[0], block.text, start, end)) {
        addOccurrence(found, block, match[0], start, end, "cin", "regex", "high");
      }
    }
    for (const match of block.text.matchAll(LONG_ID_RE)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      const digits = match[0].replace(/\D/g, "");
      if (digits.length >= 10 && !isDateOrPageNumber(match[0], block.text, start, end)) {
        addOccurrence(found, block, match[0], start, end, "long_numeric_id", "regex", "medium");
      }
    }
  }
  return found;
}

// def detect_people(blocks, use_spacy=True) -> OrderedDict[str, Candidate]:
// use_spacy path always behaves as if unavailable -- see this file's doc
// comment "WHAT WAS NOT PORTED, deliberately".
function detectPeople(blocks: ContentBlock[]): Map<string, WorkingCandidate> {
  const found = new Map<string, WorkingCandidate>();

  for (const block of blocks) {
    for (const pattern of [LAST_FIRST_PERSON_RE, FALLBACK_PERSON_RE]) {
      for (const match of block.text.matchAll(pattern)) {
        const value = match[0];
        if (PERSON_STOP_PHRASES.has(value)) continue;
        if (containsEmail(value)) continue;
        const start = match.index ?? 0;
        addOccurrence(found, block, value, start, start + value.length, "person", "fallback-name-regex", "low");
      }
    }
  }

  const singleNameOccurrences: Array<{ block: ContentBlock; value: string; start: number; end: number; key: string }> = [];
  const singleNameCounts = new Map<string, number>();
  for (const block of blocks) {
    for (const match of block.text.matchAll(SINGLE_PERSON_RE)) {
      const value = match[0];
      if (SINGLE_PERSON_STOP_WORDS.has(value)) continue;
      const start = match.index ?? 0;
      const end = start + value.length;
      if (hasCapitalizedNeighbor(block.text, start, end)) continue;
      const key = normalizeCandidate(value, "person");
      singleNameCounts.set(key, (singleNameCounts.get(key) ?? 0) + 1);
      singleNameOccurrences.push({ block, value, start, end, key });
    }
  }

  for (const { block, value, start, end, key } of singleNameOccurrences) {
    if ((singleNameCounts.get(key) ?? 0) >= 2) {
      addOccurrence(found, block, value, start, end, "person", "fallback-single-name-regex", "low");
    }
  }

  return found;
}

// def detect_all_candidates(blocks, use_spacy=True) -> List[Candidate]:
function detectAllCandidatesWorking(blocks: ContentBlock[]): Map<string, WorkingCandidate> {
  const merged = detectRegexCandidates(blocks);
  for (const [key, candidate] of detectPeople(blocks)) {
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, candidate);
    } else {
      existing.occurrences.push(...candidate.occurrences);
    }
  }
  return merged;
}

// ---- Flatten into DocumentModel's Candidate[]/Occurrence[] shape ----------
// Python's Candidate nests its own Occurrence list; the TS domain model
// uses flat, cross-referenced arrays (Candidate.occurrenceIds /
// Occurrence.candidateId) instead -- this is where that shape difference
// gets bridged, once, at the boundary. occurrence_index numbering (the
// trailing segment of each occurrence's id) matches Python's
// `len(existing_occurrences) + 1` exactly.
function flatten(working: Map<string, WorkingCandidate>): DetectionResult {
  const candidates: Candidate[] = [];
  const occurrences: Occurrence[] = [];

  for (const wc of working.values()) {
    const occurrenceIds: string[] = [];
    wc.occurrences.forEach((occ, index) => {
      const occurrenceIndex = index + 1;
      // Python: f"{key}:{block.location}:{match.start()}:{occurrence_index}"
      // Substitutes block.id for Python's human-readable block.location
      // string (which this parser does not compute -- see
      // phase-4-findings.md "documented deviations"). Cosmetically
      // different ID content; structurally the same guarantee (stable and
      // unique within one parse).
      const id = `${wc.key}:${occ.block.id}:${occ.matchStart}:${occurrenceIndex}`;
      occurrences.push({
        id,
        candidateId: wc.key,
        blockId: occ.block.id,
        startOffset: occ.matchStart,
        endOffset: occ.matchEnd,
        text: occ.text,
        context: contextSnippet(occ.block.text, occ.matchStart, occ.matchEnd),
        source: occ.source,
      });
      occurrenceIds.push(id);
    });

    candidates.push({
      id: wc.key,
      detectedType: wc.detectedType,
      source: wc.source,
      confidence: wc.confidence,
      normalizedValue: wc.key.slice(wc.key.indexOf(":") + 1),
      displayValue: wc.displayText,
      occurrenceIds,
    });
  }

  return { schemaVersion: 1, candidates, occurrences };
}

export class RegexDetectionEngine implements DetectionEngine {
  detect(document: DocumentModel): DetectionResult {
    const blocks = [...document.blocks].sort((a, b) => a.order - b.order);
    const working = detectAllCandidatesWorking(blocks);
    return flatten(working);
  }
}
