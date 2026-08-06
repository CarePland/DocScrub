/**
 * fingerprint.ts — deterministic feature extraction: plain text in,
 * `DocumentFingerprint` out. Pure, synchronous, no I/O.
 *
 * WHY FRESH HEURISTICS, NOT REUSED ONES: `src/engines/DetectionEngine.ts`
 * and `src/engines/quality/` already contain regex constants and lexicons
 * for finding PII and scoring candidates -- reusing them here would be
 * exactly the semantic dependency on the review pipeline the independence
 * requirement forbids (this subsystem must run, and be tested, with that
 * pipeline entirely absent). Every heuristic below was written fresh,
 * small, and purpose-built for relatedness signals, not PII detection --
 * they answer "is this shared across documents," never "is this
 * sensitive." Two heuristics happen to resemble detection patterns
 * (identifiers, organizations) because both domains reasonably look for
 * similar surface patterns in English business documents; the
 * resemblance is coincidental, not shared code.
 */

import type { DocumentFingerprint, WorkspaceAnalysisInputDocument } from "../domain/WorkspaceAnalysisModel.js";

/** Words that commonly start sentences or appear capitalized by English
 *  convention rather than because they name something specific -- filtered
 *  out of distinctive-term candidates so "The Company" or "This Agreement"
 *  don't register as a shared proper noun. Deliberately small and generic;
 *  not the review pipeline's lexicon. */
const GENERIC_CAPITALIZED_OPENERS = new Set([
  "the", "this", "that", "these", "those", "a", "an", "it", "its", "if", "when", "where", "while",
  "and", "but", "or", "nor", "for", "so", "yet", "as", "at", "by", "in", "of", "on", "to", "with",
  "please", "dear", "sincerely", "regards", "attachment", "attachments", "enclosure", "re", "subject",
  "from", "date", "page", "section", "article", "exhibit", "appendix", "schedule", "table", "figure",
  "note", "notes", "summary", "overview", "introduction", "conclusion", "background", "purpose",
]);

/** A small, purpose-built organization-suffix list -- not
 *  `config/candidate-quality/organization_suffixes.txt`. Matched
 *  case-insensitively as a trailing token of a capitalized phrase. */
const ORGANIZATION_SUFFIXES = [
  "inc", "inc.", "llc", "l.l.c.", "llp", "l.l.p.", "corp", "corp.", "corporation", "co", "co.",
  "company", "ltd", "ltd.", "limited", "group", "partners", "associates", "university", "hospital",
  "agency", "department", "authority", "foundation", "institute", "bank", "trust",
];

/** Public/free email providers -- sharing one of these across documents is
 *  not evidence of anything; excluded from `emailDomains` entirely. */
const GENERIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "hotmail.com", "outlook.com", "aol.com", "icloud.com",
  "protonmail.com", "live.com", "msn.com", "me.com", "mail.com",
]);

/** Ultra-common acronyms that appear in ordinary business documents
 *  regardless of subject matter -- excluded so two unrelated documents
 *  that both happen to say "CEO" or "FAQ" don't register as related. */
const GENERIC_ACRONYMS = new Set([
  "PDF", "CEO", "CFO", "COO", "USA", "US", "UK", "EU", "FAQ", "ID", "OK", "PM", "AM",
  "LLC", "LLP", "INC", "CORP", "LTD", "ASAP", "ETC", "VS", "TBD", "N/A", "NA",
]);

/** Compact English stopword list for vocabulary-overlap scoring --
 *  intentionally small; the weight ceiling on this signal in `scoring.ts`
 *  does most of the "generic words shouldn't create similarity" work. */
const STOPWORDS = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "any", "can", "had", "her", "was", "one",
  "our", "out", "day", "get", "has", "him", "his", "how", "man", "new", "now", "old", "see", "two",
  "way", "who", "boy", "did", "its", "let", "put", "say", "she", "too", "use", "that", "this", "with",
  "from", "have", "will", "your", "which", "their", "would", "there", "what", "about", "when", "make",
  "like", "time", "just", "into", "over", "such", "than", "then", "them", "these", "some", "only",
  "also", "been", "were", "each", "more", "most", "other", "shall", "should", "must", "may", "might",
]);

const IDENTIFIER_PATTERNS: RegExp[] = [
  // "Matter No. 4521", "Case #12345", "File Ref: AB-99"
  /\b(?:matter|case|file|docket|claim|invoice|order|reference|ref|account|acct)\s*(?:no\.?|number|#)?\s*[:#]?\s*([A-Z0-9][A-Z0-9-]{2,15})\b/gi,
  // Bare "AB-12345" style codes.
  /\b([A-Z]{2,6}-\d{2,8})\b/g,
];

const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;
const ACRONYM_PATTERN = /\b[A-Z]{2,6}\b/g;
const DISTINCTIVE_TERM_PATTERN = /\b[A-Z][a-zA-Z'’-]+(?:\s+[A-Z][a-zA-Z'’-]+){1,3}\b/g;
const WORD_PATTERN = /[a-zA-Z]{4,}/g;

function countOccurrences(haystack: RegExp, text: string, transform: (match: RegExpMatchArray) => string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const match of text.matchAll(haystack)) {
    const key = transform(match);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** Ranks by frequency descending, then alphabetically -- a stable,
 *  deterministic order independent of match position, so fingerprint
 *  output (and therefore every downstream result) never depends on
 *  incidental text ordering beyond the counts themselves. */
function rankedKeys(counts: Map<string, number>, minCount = 1): string[] {
  return [...counts.entries()]
    .filter(([, count]) => count >= minCount)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key]) => key);
}

function extractDistinctiveTerms(text: string): string[] {
  const counts = countOccurrences(DISTINCTIVE_TERM_PATTERN, text, (m) => m[0]);
  const filtered = new Map(
    [...counts.entries()].filter(([term]) => {
      const firstWord = term.split(/\s+/)[0]?.toLowerCase() ?? "";
      return !GENERIC_CAPITALIZED_OPENERS.has(firstWord);
    })
  );
  return rankedKeys(filtered);
}

function extractOrganizations(text: string): string[] {
  const counts = countOccurrences(DISTINCTIVE_TERM_PATTERN, text, (m) => m[0]);
  const orgs = new Map(
    [...counts.entries()].filter(([term]) => {
      const words = term.split(/\s+/);
      const last = (words[words.length - 1] ?? "").toLowerCase().replace(/[.,]+$/, "");
      return ORGANIZATION_SUFFIXES.includes(last);
    })
  );
  return rankedKeys(orgs);
}

function extractEmailDomains(text: string): string[] {
  const counts = countOccurrences(EMAIL_PATTERN, text, (m) => (m[1] ?? "").toLowerCase());
  const filtered = new Map([...counts.entries()].filter(([domain]) => domain && !GENERIC_EMAIL_DOMAINS.has(domain)));
  return rankedKeys(filtered);
}

function extractIdentifiers(text: string): string[] {
  const counts = new Map<string, number>();
  for (const pattern of IDENTIFIER_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const value = (match[1] ?? match[0]).toUpperCase();
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return rankedKeys(counts);
}

function extractAcronyms(text: string): string[] {
  const counts = countOccurrences(ACRONYM_PATTERN, text, (m) => m[0]);
  const filtered = new Map([...counts.entries()].filter(([acronym]) => !GENERIC_ACRONYMS.has(acronym)));
  // Repetition requirement: a one-off all-caps token is noise, not signal.
  return rankedKeys(filtered, 2);
}

function extractTermFrequency(text: string): Record<string, number> {
  const counts = countOccurrences(WORD_PATTERN, text, (m) => m[0].toLowerCase());
  const result: Record<string, number> = {};
  for (const [word, count] of counts) {
    if (STOPWORDS.has(word)) continue;
    result[word] = count;
  }
  return result;
}

const FILENAME_GENERIC_WORDS = new Set([
  "document", "draft", "final", "copy", "untitled", "scan", "signed", "revised", "redacted",
  "version", "new", "old", "letter", "memo", "email", "docx", "doc", "v1", "v2", "v3",
]);

function extractFilenameTokens(fileName: string): string[] {
  const base = fileName.replace(/\.[a-zA-Z0-9]+$/, "");
  const tokens = base
    .split(/[^a-zA-Z0-9]+/)
    .map((t) => t.toLowerCase())
    .filter((t) => t.length >= 3 && !FILENAME_GENERIC_WORDS.has(t));
  return [...new Set(tokens)].sort();
}

function bucketize(value: number, edges: number[]): number {
  let bucket = 0;
  for (const edge of edges) {
    if (value >= edge) bucket++;
  }
  return bucket;
}

/** Coarse shape descriptor -- paragraph-count bucket + average-paragraph-
 *  length bucket, joined into one signature string. Splits on blank lines
 *  as a paragraph-ish approximation over already-flattened plain text
 *  (this subsystem never sees the original OOXML paragraph structure --
 *  see `../io/extractText.ts`). */
function computeStructureSignature(text: string): string {
  const paragraphs = text.split(/\n+/).map((p) => p.trim()).filter((p) => p.length > 0);
  const paragraphCount = paragraphs.length;
  const avgLength = paragraphCount > 0 ? paragraphs.reduce((sum, p) => sum + p.length, 0) / paragraphCount : 0;
  const countBucket = bucketize(paragraphCount, [10, 50, 200, 1000]);
  const lengthBucket = bucketize(avgLength, [40, 100, 250]);
  return `p${countBucket}-l${lengthBucket}`;
}

export function buildFingerprint(document: WorkspaceAnalysisInputDocument): DocumentFingerprint {
  return {
    documentId: document.documentId,
    fileName: document.fileName,
    distinctiveTerms: extractDistinctiveTerms(document.text),
    organizations: extractOrganizations(document.text),
    emailDomains: extractEmailDomains(document.text),
    identifiers: extractIdentifiers(document.text),
    acronyms: extractAcronyms(document.text),
    termFrequency: extractTermFrequency(document.text),
    filenameTokens: extractFilenameTokens(document.fileName),
    structureSignature: computeStructureSignature(document.text),
  };
}
