/**
 * semantic-types-verification.ts -- Type Check Phase 1 (2026-08-02):
 * the pure semantic-type vocabulary. Assignment is by reviewer
 * semantics, not detection method; summaries are display-ordered,
 * empty-omitted, decision-blind. The stage integration (Phase 2+) is
 * planned separately -- see design-notes v2026-08-02.19.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/semantic-types-verification.ts
 */

// Phase 2 (2026-08-02): module moved src/ui/ -> src/domain/ when the
// navigation engine became a consumer -- see the module's own top doc
// comment. Same module, same source-of-truth status, new home.
import { SEMANTIC_TYPE_LABELS, SEMANTIC_TYPE_ORDER, buildSemanticTypeSummaries, semanticTypeFor, type SemanticTypeFacts } from "../src/domain/semanticTypes.ts";
import type { RelationshipKind } from "../src/domain/StructuralRelationship.ts";

let passCount = 0;
let failCount = 0;
function check(label: string, condition: boolean): void {
  if (condition) {
    passCount += 1;
    console.log(`  PASS ${label}`);
  } else {
    failCount += 1;
    console.log(`  FAIL ${label}`);
  }
}

const facts = (detectedType: string, categories: string[] = [], kinds: RelationshipKind[] = []): SemanticTypeFacts => ({
  detectedType,
  categories,
  relationshipKinds: new Set(kinds),
});

console.log("--- semantic assignment: what the reviewer decides, not how it was detected ---");
check("email detection -> Email Addresses", semanticTypeFor(facts("email")) === "emails");
check("phone -> Phone Numbers", semanticTypeFor(facts("phone")) === "phones");
check("cin/long_numeric_id -> Identifiers", semanticTypeFor(facts("cin")) === "identifiers" && semanticTypeFor(facts("long_numeric_id")) === "identifiers");
check("identifier-pattern relationship member -> Identifiers regardless of type", semanticTypeFor(facts("person", [], ["numeric-identifier"])) === "identifiers");
check('NSC-style acronym -> Acronyms "regardless of how it was detected"', semanticTypeFor(facts("person", ["likely_acronym"])) === "acronyms" && semanticTypeFor(facts("organization", [], ["acronym"])) === "acronyms");
// AFFIRMATIVE person EVIDENCE -> People (AG, 2026-08-10). `surname_given_
// structure` was removed from this assertion deliberately: it is SHAPE, and
// shape no longer assigns a semantic type. The second check pins that.
check("recognized person name -> People", semanticTypeFor(facts("person", ["known_personal_name_token"])) === "people" && semanticTypeFor(facts("person", ["known-first-name"])) === "people");
check("name SHAPE alone is not a semantic type", semanticTypeFor(facts("person", ["surname_given_structure"])) === "other" && semanticTypeFor(facts("person", ["strong_name_structure"])) === "other");
check("departments/systems -> Organizations", semanticTypeFor(facts("person", ["department_organization"])) === "organizations" && semanticTypeFor(facts("organization")) === "organizations");
check("calendar/season -> Dates / Terms", semanticTypeFor(facts("person", ["season_or_academic_term"])) === "dates-terms");
check("document-structure -> Document Titles", semanticTypeFor(facts("person", ["document_structure_term"])) === "document-titles");
check("unrecognized person-shaped token -> Other (Item Check's genuine-individual-attention pool)", semanticTypeFor(facts("person")) === "other");
check("kebab and snake categories both match", semanticTypeFor(facts("person", ["known_first_name"])) === semanticTypeFor(facts("person", ["known-first-name"])));

console.log("--- card summaries: display order, empties omitted, counts factual ---");
{
  const items = [
    { id: "e1", type: "emails" as const, occurrenceCount: 20, decided: false },
    { id: "p1", type: "people" as const, occurrenceCount: 900, decided: true },
    { id: "e2", type: "emails" as const, occurrenceCount: 4, decided: true },
    { id: "p2", type: "people" as const, occurrenceCount: 946, decided: false },
  ];
  const summaries = buildSemanticTypeSummaries(items);
  check("only populated types, in display order (People before Emails)", summaries.map((s) => s.id).join(",") === "people,emails");
  const people = summaries[0]!;
  check("entity/occurrence/decided counts add up", people.entityCount === 2 && people.occurrenceCount === 1846 && people.decidedCount === 1);
  check("labels come from the shared vocabulary", people.label === SEMANTIC_TYPE_LABELS.people && SEMANTIC_TYPE_ORDER[0] === "people");
  check("candidate ids preserved in input order within a type", people.candidateIds.join(",") === "p1,p2");
}

console.log(`\n${passCount}/${passCount + failCount} checks passed`);
process.exitCode = failCount === 0 ? 0 : 1;
