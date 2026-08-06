/**
 * StructuralRelationshipEngine -- Structural Relationship Review
 * (2026-07-30, Andrew's feature proposal; see
 * src/domain/StructuralRelationship.ts for the design principles).
 *
 * A REUSABLE RELATIONSHIP-DETECTOR FRAMEWORK: the engine is an ordered
 * registry of RelationshipDetector functions, each a pure, deterministic
 * map from the detection's candidates to zero or more RelationshipProposal
 * values. Adding a new deterministic detector is one entry in
 * DEFAULT_RELATIONSHIP_DETECTORS -- the review model (proposal shape,
 * dismissal semantics, the shared UI presentation, bulk actions via
 * bulkApplyDecision) is detector-agnostic by construction, per the
 * proposal's objective ("new deterministic detectors can be added without
 * creating a new reviewer interaction for each detector").
 *
 * Deliberately NOT part of EntityResolutionEngine: entity ambiguity asks
 * "which known identity is this?" (semantic, resolution-scored);
 * structural relationships ask "do these share a deterministic shape?"
 * (non-semantic, exact). Keeping them separate also keeps this engine out
 * of the Python-parity surface entirely -- GroupingResult and its parity
 * suites are untouched (this feature has no Python oracle; it is a new
 * capability, classified as an additive domain requirement).
 *
 * Everything here is a pure function of its inputs -- no state, no DOM, no
 * randomness, no timestamps -- so the whole engine is Node-verifiable and
 * proposals (and therefore their content-derived ids) are identical on
 * every load of the same document.
 */

import type { Candidate } from "../domain/DocumentModel.js";
import type { DetectionResult } from "./DetectionEngine.js";
import type { RelationshipKind, RelationshipProposal, StructuralRelationshipResult } from "../domain/StructuralRelationship.js";

export interface RelationshipDetector {
  /** Stable identifier, recorded for transparency/debugging. */
  id: string;
  detect(candidates: readonly Candidate[]): RelationshipProposal[];
}

// ---------------------------------------------------------------------------
// Detector 1: acronym / full-name relationships.
// ---------------------------------------------------------------------------

/** The initials of a multi-word value's capitalized words, uppercased --
 *  "California State University, Los Angeles" -> "CSULA"; "Degree Verify"
 *  -> "DV". Returns null for values that cannot plausibly source an
 *  acronym (fewer than two capitalized words). Punctuation is stripped
 *  before word-splitting so commas/periods never break the initials.
 *  Lowercase connector words ("of", "the", "and"...) are skipped by the
 *  capitalization test itself rather than a hardcoded stopword list --
 *  deterministic and language-agnostic. */
export function acronymOfValue(value: string): string | null {
  const words = value
    .replace(/[.,;:()'"/\\]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0);
  const capitalizedInitials = words.filter((word) => /^[A-Z]/.test(word)).map((word) => word[0]!.toUpperCase());
  if (capitalizedInitials.length < 2) return null;
  return capitalizedInitials.join("");
}

/** Whether a value IS a plausible acronym token: 2-10 uppercase letters,
 *  nothing else. Deterministic; deliberately narrow (no digits, no dots --
 *  "U.S.C." style variants are a future detector refinement, not silently
 *  half-supported here). */
export function isAcronymToken(value: string): boolean {
  return /^[A-Z]{2,10}$/.test(value.trim());
}

const acronymDetector: RelationshipDetector = {
  id: "acronym",
  detect(candidates) {
    // Full-name side: every candidate whose capitalized initials form a
    // string; acronym side: every candidate that IS a bare acronym token.
    const fullsByAcronym = new Map<string, Candidate[]>();
    for (const candidate of candidates) {
      if (isAcronymToken(candidate.displayValue.trim())) continue; // a bare acronym is never its own full name
      const acronym = acronymOfValue(candidate.displayValue);
      if (!acronym) continue;
      const list = fullsByAcronym.get(acronym) ?? [];
      list.push(candidate);
      fullsByAcronym.set(acronym, list);
    }

    const proposals: RelationshipProposal[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      const token = candidate.displayValue.trim();
      if (!isAcronymToken(token)) continue;
      const fulls = fullsByAcronym.get(token);
      if (!fulls || fulls.length === 0) continue;
      if (seen.has(token)) continue; // all acronym candidates with the same token join one proposal
      seen.add(token);
      const acronymCandidates = candidates.filter((c) => c.displayValue.trim() === token && isAcronymToken(c.displayValue.trim()));
      const memberIds = [...fulls.map((c) => c.id), ...acronymCandidates.map((c) => c.id)];
      proposals.push({
        proposalId: `rel-acronym-${token}`,
        kind: "acronym",
        candidateIds: memberIds,
        observation: "Possible acronym relationship.",
        evidence: `The initials of ${fulls.map((c) => `"${c.displayValue}"`).join(" / ")} spell "${token}".`,
      });
    }
    return proposals;
  },
};

// ---------------------------------------------------------------------------
// Detector 2: identifier pattern relationships.
// ---------------------------------------------------------------------------

/** The structural shape of a value: digits -> "#", letters -> "A",
 *  everything else kept literally -- "123456789" -> "#########",
 *  "A1234567" -> "A#######", "ABC-12345" -> "AAA-#####". Purely
 *  structural; carries no semantics whatsoever. */
export function shapeSignatureOf(value: string): string {
  return value.replace(/[0-9]/g, "#").replace(/[A-Za-z]/g, "A");
}

/** Whether a candidate participates in identifier-pattern detection at
 *  all. Deterministic gates, each documented:
 *  - single token (no internal whitespace) of length >= 4 -- shorter or
 *    multi-word values produce shape collisions that are noise, not
 *    signal;
 *  - contains at least one digit -- pure-letter tokens are the acronym
 *    detector's territory, and letters-only "patterns" (AAAA) would group
 *    unrelated words;
 *  - only identifier-plausible characters (letters, digits, - . / _);
 *  - detectedType is not email/phone -- those candidates' semantics are
 *    ALREADY known and typed by detection itself; re-proposing "these
 *    share a pattern" over every phone number in the document tells the
 *    reviewer nothing they don't have (a documented judgment, not an
 *    accident). */
export function isIdentifierPatternEligible(candidate: Candidate): boolean {
  const value = candidate.displayValue.trim();
  if (value.length < 4) return false;
  if (/\s/.test(value)) return false;
  if (!/[0-9]/.test(value)) return false;
  if (!/^[A-Za-z0-9._/-]+$/.test(value)) return false;
  if (candidate.detectedType === "email" || candidate.detectedType === "phone") return false;
  return true;
}

const identifierPatternDetector: RelationshipDetector = {
  id: "identifier-pattern",
  detect(candidates) {
    const bySignature = new Map<string, Candidate[]>();
    for (const candidate of candidates) {
      if (!isIdentifierPatternEligible(candidate)) continue;
      const signature = shapeSignatureOf(candidate.displayValue.trim());
      const list = bySignature.get(signature) ?? [];
      list.push(candidate);
      bySignature.set(signature, list);
    }

    const proposals: RelationshipProposal[] = [];
    for (const [signature, members] of bySignature) {
      // A pattern needs at least two DISTINCT values -- five occurrences of
      // one repeated id are one candidate, and a single candidate is not a
      // relationship.
      if (members.length < 2) continue;
      const kind: RelationshipKind = signature.includes("A") ? "alphanumeric-identifier" : "numeric-identifier";
      // The proposal's own vocabulary, verbatim from the spec -- an
      // observation about SHAPE, never a guess at what the values are
      // (never "Student ID", "SSN", "Case Number", ...).
      const noun = kind === "numeric-identifier" ? "numeric" : "alphanumeric";
      proposals.push({
        proposalId: `rel-pattern-${signature}`,
        kind,
        candidateIds: members.map((c) => c.id),
        observation: `These values appear to share the same structural pattern and may represent some ${noun} identifier.`,
        evidence: `Shared pattern: ${signature}  (# = digit, A = letter)`,
      });
    }
    return proposals;
  },
};

// ---------------------------------------------------------------------------
// The engine.
// ---------------------------------------------------------------------------

export const DEFAULT_RELATIONSHIP_DETECTORS: readonly RelationshipDetector[] = [acronymDetector, identifierPatternDetector];

const KIND_ORDER: Record<RelationshipKind, number> = { acronym: 0, "numeric-identifier": 1, "alphanumeric-identifier": 2, "inserted-word-name": 3 };

export class StructuralRelationshipEngine {
  private readonly detectors: readonly RelationshipDetector[];

  constructor(detectors: readonly RelationshipDetector[] = DEFAULT_RELATIONSHIP_DETECTORS) {
    this.detectors = detectors;
  }

  propose(detection: DetectionResult): StructuralRelationshipResult {
    const proposals = this.detectors.flatMap((detector) => detector.detect(detection.candidates));
    // Deterministic presentation order: by kind, then id -- stable across
    // loads, so the reviewer (and the verification suite) always sees the
    // same sequence for the same document.
    proposals.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.proposalId.localeCompare(b.proposalId));
    return { proposals };
  }
}
