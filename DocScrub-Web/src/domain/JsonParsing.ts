/**
 * JsonParsing -- the shared "parse a raw string into a JSON object" first
 * step every deserializer in this codebase repeats before its own
 * schema-specific validation begins. Architectural cleanup (2026-07-29):
 * `deserializeReviewSession` (engines/review/serialization.ts),
 * `deserializeWorkspaceSaveFile` (workspace/WorkspaceSaveFile.ts), and
 * `deserializeImportedDecisions` (io/DecisionImport.ts) each opened with the
 * identical six lines -- a `JSON.parse` try/catch producing "not valid
 * JSON: ...", then a `typeof !== "object" || === null` check producing
 * "expected a JSON object" -- confirmed by direct inspection, not assumed;
 * `DecisionImport.ts`'s own doc comment already named the other two as
 * following "the same... convention" before this file existed to hold it.
 *
 * Deliberately lives in domain/, not engines/ or io/: it has no dependents
 * of its own and no schema-specific knowledge (schemaVersion checking,
 * required-field validation, and everything else stays in each caller,
 * which is the one part of this shape that genuinely differs per format) --
 * exactly the "zero-dependency, imported by everyone above it" role every
 * other domain/ file already plays, so engines/, io/, and workspace/ can all
 * depend on it without a new, backwards dependency direction.
 *
 * NOT a general schema-validation framework: this function answers exactly
 * one question -- "is this a JSON object at all" -- and nothing more. It
 * deliberately does not accept or reject arrays with a dedicated message,
 * because no existing caller ever did: `typeof [] === "object"` and
 * `[] !== null`, so an array-shaped payload always passed this check before
 * this file existed too, only to be rejected moments later by whichever
 * caller's own schemaVersion check runs next (each with its own,
 * already-existing wording -- see each deserializer's own doc comment).
 * Preserving that exact behavior, rather than "improving" it here, is
 * deliberate: this cleanup pass changes where the duplicated code lives,
 * not what any caller's error message says.
 *
 * `deserializeFocusResumePosition` (domain/FocusResumePosition.ts) does NOT
 * use this helper: it accepts an already-parsed `unknown`, not a raw JSON
 * string, so there is no `JSON.parse` step for it to share.
 */

export type JsonObjectParseResult = { ok: true; value: Record<string, unknown> } | { ok: false; reason: string };

export function parseJsonObject(raw: string): JsonObjectParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { ok: false, reason: `not valid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, reason: "expected a JSON object" };
  }
  return { ok: true, value: parsed as Record<string, unknown> };
}
