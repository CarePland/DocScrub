/**
 * other-bucket-trace.ts -- INVESTIGATION ONLY (AG, 2026-08-10).
 *
 * Why is Type Check -> Other / Miscellaneous populated the way it is?
 * Traces the named witnesses end-to-end through the real engines.
 */

import type { Candidate, ContentBlock, Occurrence } from "../src/domain/DocumentModel.js";
import { scoreCandidateQuality } from "../src/engines/quality/scoring.js";
import { qualityCategoriesOf, semanticTypeFor } from "../src/domain/semanticTypes.js";

function block(id: string): ContentBlock {
  return { id, kind: "body", text: "", order: 0, sourceMapping: { partId: "word/document.xml", sourceRef: "" }, runMappings: [] };
}

function trace(value: string, occCount = 2) {
  const id = `person:${value.toLowerCase()}`;
  const candidate: Candidate = {
    id, detectedType: "person", source: "regex", confidence: "low",
    normalizedValue: value.toLowerCase(), displayValue: value, occurrenceIds: [],
  };
  const blocks = new Map<string, ContentBlock>();
  const occurrences: Occurrence[] = [];
  for (let i = 0; i < occCount; i += 1) {
    const b = `b${i}`;
    blocks.set(b, block(b));
    occurrences.push({ id: `${id}:${b}:0:1`, candidateId: id, blockId: b, startOffset: 0, endOffset: value.length, text: value, context: `...${value}...`, source: "regex" });
  }
  const a = scoreCandidateQuality(candidate, occurrences, blocks);
  const categories = qualityCategoriesOf(a);
  const type = semanticTypeFor({ detectedType: "person", categories, relationshipKinds: new Set() });
  return { a, categories, type };
}

const pad = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));

const WITNESSES = [
  "Yazmine Guzmán", "Julie Ford", "Cashay Jackson", "Min Shi",
  "Good Morning", "Term Activation", "The Academic Disqual",
  "Hello All", "Thanks", "What", "Please",
  "Service Indicator Codes", "Grade Processing", "Query Definition",
  "Did Dr", "FYI, Berhanu",
  // controls that DO reach People, for contrast
  "Amy Miller", "Grade Rosters", "Cobb, Christopher",
];

console.log("\n=== WHY IS IT IN OTHER? end-to-end, real engines ===\n");
console.log(pad("candidate", 24) + pad("type", 14) + pad("scr", 5) + pad("classifications (= filterRules)", 44) + "reasons");
console.log("-".repeat(170));
for (const w of WITNESSES) {
  const { a, type } = trace(w);
  console.log(pad(w, 24) + pad(type, 14) + pad(String(a.score), 5) + pad(a.filterRules.join(",") || "(none)", 44) + a.reasons.join(","));
}

console.log("\n=== THE MECHANISM ===\n");
console.log("qualityCategoriesOf() returns `filterRules.length ? filterRules : reasons`.");
console.log("filterRules on the name-structure branches is set to `classifications` -- the DICTIONARY hits.");
console.log("So the moment ANY dictionary fires, the SHAPE reasons (strong_name_structure,");
console.log("surname_given_structure) become invisible to semanticTypeFor, its people branch");
console.log("cannot fire, and the candidate falls through the final `return \"other\"`.\n");
for (const w of ["Julie Ford", "Amy Miller"]) {
  const { a, categories, type } = trace(w);
  console.log(`  ${pad(w, 16)} classifications=${JSON.stringify(a.filterRules)}`);
  console.log(`  ${" ".repeat(16)} reasons=${JSON.stringify(a.reasons)}`);
  console.log(`  ${" ".repeat(16)} categories SEEN BY semanticTypeFor=${JSON.stringify(categories)} -> ${type}\n`);
}

console.log("=== NON-ASCII NAMES: quality's name-shape regexes are ASCII-only ===\n");
console.log(pad("candidate", 24) + pad("type", 12) + pad("scr", 5) + "reasons");
console.log("-".repeat(110));
for (const w of ["Yazmine Guzman", "Yazmine Guzmán", "Jose Martinez", "José Martínez", "Ana Nunez", "Ana Núñez", "Guzmán, Yazmine", "Guzman, Yazmine"]) {
  const { a, type } = trace(w);
  console.log(pad(w, 24) + pad(type, 12) + pad(String(a.score), 5) + a.reasons.join(","));
}
