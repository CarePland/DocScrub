/**
 * full-value-aliases.data.ts -- the built-in full-value alias library
 * (Deterministic Semantic Relationship Knowledge, Phase 2, 2026-07-30).
 * APPLICATION DATA, same pattern as related-names.data.ts: the text below
 * is parsed and validated at startup by FullValueAliasProvider.ts's
 * loader; replacing/expanding the dataset means editing this text (or
 * regenerating the file) and bumping the version -- no architectural
 * change.
 *
 * FORMAT: pipe-separated, `value_a|value_b|kind|score`, because
 * organization names legitimately contain commas ("California State
 * University, Los Angeles") -- a naive CSV would need quoting for its own
 * seed rows. `kind` is curated (acronym | alias), never inferred from
 * shape, and becomes the evidence line's label ("Acronym relationship" /
 * "Alias relationship"). `score` is the shared ordinal strength 1-5
 * (5 Established .. 1 Speculative).
 *
 * DELIBERATELY SMALL: this phase establishes and verifies the
 * architecture, not an exhaustive acronym library (the prompt's own
 * scope). "NSC" appears TWICE on purpose -- National Student
 * Clearinghouse (Established) and National Safety Council (Credible) --
 * so the multiple-expansion behavior (reviewer-visible alternatives,
 * never an automatic choice) is exercised by the built-in data itself.
 */

export const FULL_VALUE_ALIASES_DATASET_VERSION = "built-in seed v1 (2026-07-30, 7 rows)";

export const FULL_VALUE_ALIASES_DATA = `value_a|value_b|kind|score
NSC|National Student Clearinghouse|acronym|5
NSC|National Safety Council|acronym|3
DV|DegreeVerify|acronym|3
PII|Personally Identifiable Information|acronym|5
CSULA|California State University, Los Angeles|acronym|5
Cal State LA|California State University, Los Angeles|alias|5
Cal State LA|CSULA|acronym|4
`;
