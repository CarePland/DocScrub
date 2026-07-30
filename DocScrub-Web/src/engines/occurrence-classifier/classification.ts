/**
 * classification.ts -- faithful port of redactor/occurrence_groups.py's
 * occurrence_group_kind() / group_occurrences() and every helper they
 * depend on. This is the parity-critical core: the ONE semantic rule
 * Python's oracle actually implements (standalone vs. contextual, by
 * whether substantive text remains around a match once it's stripped out
 * of the context snippet). See docs/detection/phase-7-findings.md for the
 * full port record and every documented deviation.
 *
 * CONFIRMED, NOT SILENTLY EXPANDED: Python's `OccurrenceGroupKind` Literal
 * type and `GROUP_LABELS` dict both enumerate 8 possible kinds
 * ("standalone", "contextual", "quoted", "header", "footer", "table",
 * "ocr", "other"), but `GROUP_ORDER` (the tuple group_occurrences()
 * actually iterates) and `occurrence_group_kind()` (the only function that
 * ever assigns a kind) together only ever produce "standalone" or
 * "contextual" -- the other 6 kinds are aspirational vocabulary with no
 * implemented rule behind them anywhere in work/pii_docx_redactor. This
 * port reproduces exactly that: the type still has all 8 values (so a
 * future rule addition on either side doesn't require a schema change),
 * but the classification function below only ever returns "standalone" or
 * "contextual" -- not an oversight, a confirmed characteristic of the
 * oracle.
 */

import type { Occurrence } from "../../domain/DocumentModel.js";
import type { OccurrenceGroupKind } from "../OccurrenceClassifier.js";

/**
 * Bucket shape for THIS module's own parity-critical output only --
 * deliberately NOT the same interface as OccurrenceClassifier.ts's
 * `OccurrenceGroup` (whose `occurrences` field was upgraded to the richer
 * `ReviewOccurrence[]` for the production adapter's output -- see that
 * file's doc comment). This module operates on plain `Occurrence[]` and
 * must keep doing so: it is exercised directly by the fixture-parity
 * harness against Python's occurrence_groups.py, which also only ever
 * knows about plain occurrences, not the additive review-enrichment layer.
 * Generic so the production adapter (occurrence-classifier.ts) could reuse
 * this exact bucketing shape for a richer element type if it ever wanted
 * to, without this module needing to know about ReviewOccurrence at all.
 */
export interface OccurrenceBucket<T = Occurrence> {
  id: string;
  kind: OccurrenceGroupKind;
  label: string;
  occurrenceCount: number;
  occurrences: T[];
}

// GROUP_ORDER: tuple[OccurrenceGroupKind, ...] = ("standalone", "contextual")
// Exported so occurrence-classifier.ts's adapter can bucket its richer
// ReviewOccurrence[] records using the exact same order/labels rather than
// duplicating this constant.
export const GROUP_ORDER: readonly OccurrenceGroupKind[] = ["standalone", "contextual"];

// GROUP_LABELS: dict[OccurrenceGroupKind, str] = {...}
export const GROUP_LABELS: Record<OccurrenceGroupKind, string> = {
  standalone: "Standalone occurrences",
  contextual: "Occurrences in message text",
  quoted: "Quoted occurrences",
  header: "Header occurrences",
  footer: "Footer occurrences",
  table: "Table occurrences",
  ocr: "OCR occurrences",
  other: "Other occurrences",
};

// SUBSTANTIVE_RE = re.compile(r"[A-Za-z0-9]")
const SUBSTANTIVE_RE = /[A-Za-z0-9]/;
// BRACKETED_RE = re.compile(r"\[[^\]]+\]") -- no `g` flag: JS .replace() with
// a non-global regex replaces only the first match, matching Python's
// `.sub(..., count=1)` exactly.
const BRACKETED_RE = /\[[^\]]+\]/;
// ARTIFACT_TOKEN_RE = re.compile(r"^(?:l|r|lr|br|cr|lf|nbsp|\\n|\\r|\\t|[\W_]+)$", re.IGNORECASE)
// NOTE: `\\n`/`\\r`/`\\t` here match a literal backslash followed by the
// letter n/r/t (a copy-paste artifact like the two characters "\n"), NOT an
// actual newline/CR/tab control character -- confirmed by reading the
// Python raw-string source (`r"...\\n..."`) rather than assuming.
const ARTIFACT_TOKEN_RE = /^(?:l|r|lr|br|cr|lf|nbsp|\\n|\\r|\\t|[\W_]+)$/i;
const EDGE_PUNCTUATION_RE = /^[.,;:()[\]{}<>]+|[.,;:()[\]{}<>]+$/g;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// def _normalize_text(value: str) -> str:
function normalizeText(value: string): string {
  return value.replace(/\.\.\./g, " ").replace(/ /g, " ").replace(/\s+/g, " ").trim();
}

// def _strip_match_from_context(occurrence: Occurrence) -> str:
function stripMatchFromContext(occurrence: Pick<Occurrence, "context" | "text">): string {
  const context = normalizeText(occurrence.context ?? "");
  const text = normalizeText(occurrence.text ?? "");
  const withoutBracketed = context.replace(BRACKETED_RE, " ");
  if (withoutBracketed !== context) {
    return normalizeText(withoutBracketed);
  }
  if (text) {
    const matchRe = new RegExp(escapeRegExp(text), "i");
    return normalizeText(context.replace(matchRe, " "));
  }
  return context;
}

// def _has_substantive_surrounding_text(remaining_context: str) -> bool:
function hasSubstantiveSurroundingText(remainingContext: string): boolean {
  const tokens = remainingContext.trim().split(/\s+/).filter((t) => t.length > 0);
  return tokens.some((token) => {
    // Substantive check runs on the RAW token; the artifact check runs on
    // the token with edge punctuation stripped -- this asymmetry is
    // exactly what Python's source does (see the two separate expressions
    // in _has_substantive_surrounding_text), not a simplification.
    if (!SUBSTANTIVE_RE.test(token)) return false;
    const stripped = token.replace(EDGE_PUNCTUATION_RE, "");
    return !ARTIFACT_TOKEN_RE.test(stripped);
  });
}

// def occurrence_group_kind(occurrence: Occurrence) -> OccurrenceGroupKind:
export function occurrenceGroupKind(occurrence: Pick<Occurrence, "context" | "text">): OccurrenceGroupKind {
  const remainingContext = stripMatchFromContext(occurrence);
  return hasSubstantiveSurroundingText(remainingContext) ? "contextual" : "standalone";
}

// def group_occurrences(occurrences: list[Occurrence]) -> list[OccurrenceGroup]:
/**
 * Faithful port. Bucket-internal order is simply INPUT order (Python
 * applies no sort here either -- confirmed by reading group_occurrences()
 * directly, it only ever appends in iteration order). Since this is
 * genuinely unspecified/incidental in Python rather than a deliberately
 * tested contract, callers that need a stable, explicitly-defined review
 * order should use buildReviewOccurrences() in occurrence-classifier.ts
 * instead of relying on this array's order -- see that file's doc comment
 * for the explicit ordering rule this port introduces additively.
 */
export function groupOccurrences(occurrences: Occurrence[]): OccurrenceBucket<Occurrence>[] {
  const buckets = new Map<OccurrenceGroupKind, Occurrence[]>(GROUP_ORDER.map((kind) => [kind, []]));
  for (const occurrence of occurrences) {
    const kind = occurrenceGroupKind(occurrence);
    const bucket = buckets.get(kind);
    if (bucket) bucket.push(occurrence);
    else buckets.set(kind, [occurrence]);
  }
  const groups: OccurrenceBucket<Occurrence>[] = [];
  for (const kind of GROUP_ORDER) {
    const bucketOccurrences = buckets.get(kind) ?? [];
    if (bucketOccurrences.length === 0) continue;
    groups.push({
      id: `occurrence-group-${kind}`,
      kind,
      label: GROUP_LABELS[kind],
      occurrenceCount: bucketOccurrences.length,
      occurrences: bucketOccurrences,
    });
  }
  return groups;
}
