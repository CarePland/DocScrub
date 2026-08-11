// Quick smoke test for scoring.ts, cross-checked against specific assertions
// read directly out of tests/test_candidate_quality.py (not a substitute for
// the real fixture-driven quality-parity harness -- verify/quality-parity.ts
// -- which is task #47 and will be the authoritative comparison against
// Python's actual expected/candidates.json quality fields).

import type { Candidate, ContentBlock, Occurrence } from "../src/domain/DocumentModel.js";
import { scoreCandidateQuality } from "../src/engines/quality/scoring.js";

let passed = 0;
let failed = 0;

function block(id: string, kind: ContentBlock["kind"] = "body"): ContentBlock {
  return { id, kind, text: "", order: 0, sourceMapping: { partId: "word/document.xml", sourceRef: "" }, runMappings: [] };
}

function occ(candidateId: string, blockId: string, text: string, context: string): Occurrence {
  return { id: `${candidateId}:${blockId}:0:1`, candidateId, blockId, startOffset: 0, endOffset: text.length, text, context, source: "regex" };
}

function candidate(displayValue: string, detectedType = "person"): Candidate {
  return {
    id: `person:${displayValue.toLowerCase()}`,
    detectedType,
    source: "regex",
    confidence: "low",
    normalizedValue: displayValue.toLowerCase(),
    displayValue,
    occurrenceIds: [],
  };
}

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
  } else {
    failed++;
    console.log(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const blocksById = new Map([["b1", block("b1")], ["hdr", block("hdr", "header")]]);

// Every expected value below is the LITERAL output of Python's
// score_candidate_quality() on an equivalent Candidate/Occurrence,
// captured by running the live module directly (see this file's own
// commit message / phase-5-findings.md for the exact python3 invocation
// used to generate these expectations) -- not hand-guessed.

// "Smith, Jane" -- LAST_FIRST_RE
//
// ORACLE DEVIATION #8 (AG, 2026-08-10, representation defect #1). Python
// emits ["single_occurrence", "surname_given_structure"] here because its
// known-given-name lookup sits inside the TWO_NAME_RE branch, which the
// last-first branch returns before reaching. "jane" IS in KNOWN_GIVEN_NAMES,
// so the oracle's own lexicon had the answer and its own branch order hid it.
//
// This expectation is UPDATED rather than preserved: the previous value
// depended on the defect. The deviation is documented at the hoisted lookup
// in scoring.ts and pinned in both directions by
// verify/last-first-name-evidence-verification.ts.
{
  const c = candidate("Smith, Jane");
  const occs = [occ(c.id, "b1", "Smith, Jane", "...Smith, Jane...")];
  const result = scoreCandidateQuality(c, occs, blocksById);
  check("Smith, Jane quality", result.quality, "Strong");
  check("Smith, Jane reasons (deviation #8)", result.reasons, ["single_occurrence", "surname_given_structure", "known_personal_name_token"]);
}

// "Smith, Zeeb" -- LAST_FIRST_RE, given name NOT in the lexicon. The control
// that proves deviation #8 attaches evidence rather than inventing it.
{
  const c = candidate("Smith, Zeeb");
  const occs = [occ(c.id, "b1", "Smith, Zeeb", "...Smith, Zeeb...")];
  const result = scoreCandidateQuality(c, occs, blocksById);
  check("Smith, Zeeb reasons (unchanged by deviation #8)", result.reasons, ["single_occurrence", "surname_given_structure"]);
}

// "Gustavo Reyes" -- TWO_NAME_RE + known given name token
{
  const c = candidate("Gustavo Reyes");
  const occs = [occ(c.id, "b1", "Gustavo Reyes", "...Gustavo Reyes...")];
  const result = scoreCandidateQuality(c, occs, blocksById);
  check("Gustavo Reyes quality", result.quality, "Strong");
  check("Gustavo Reyes reasons", result.reasons, ["single_occurrence", "strong_name_structure", "known_personal_name_token"]);
}

// Single common English word repeated 8x -- frequency must NOT dominate.
{
  const c = candidate("the");
  const occs = Array.from({ length: 8 }, () => occ(c.id, "b1", "the", "...the day..."));
  const result = scoreCandidateQuality(c, occs, blocksById);
  check("'the' x8 quality", result.quality, "Unlikely");
  check("'the' x8 reasons", result.reasons, [
    "frequency_saturated",
    "sentence_fragment_word",
    "expanded_common_language_token",
    "implausible_capitalization",
    "all_common_dictionary_words",
    "no_positive_person_evidence",
  ]);
}

// Single-occurrence known first name -- reviewable despite rarity.
{
  const c = candidate("Julie");
  const occs = [occ(c.id, "b1", "Julie", "...met with Julie...")];
  const result = scoreCandidateQuality(c, occs, blocksById);
  check("Julie quality", result.quality, "Possible");
  check("Julie reasons", result.reasons, [
    "single_occurrence",
    "known_first_name",
    "expanded_common_language_token",
    "single_name_candidate",
  ]);
}

// Non-person detected type (email) -- always deterministic Strong.
{
  const c = candidate("jane@example.com", "email");
  const occs = [occ(c.id, "b1", "jane@example.com", "...jane@example.com...")];
  const result = scoreCandidateQuality(c, occs, blocksById);
  check("email quality", result.quality, "Strong");
  check("email reasons", result.reasons, ["deterministic_non_person_type"]);
}

// Heading-context two-name phrase, no other positive evidence -- demoted.
{
  const c = candidate("Course Overview");
  const occs = [occ(c.id, "hdr", "Course Overview", "[Course Overview]")];
  const result = scoreCandidateQuality(c, occs, blocksById);
  check("heading quality", result.quality, "Possible");
  check("heading reasons", result.reasons, ["single_occurrence", "strong_name_structure", "heading_context"]);
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
