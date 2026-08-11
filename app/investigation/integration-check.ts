/** INVESTIGATION ONLY -- pre-flight against the live residue using the REAL
 *  production modules, to check §19 stop conditions before reporting. */
import { LIVE_RESIDUE } from "./live-residue.data.js";
import { censusNameEvidenceFor } from "../src/engines/knowledge/CensusNameEvidence.js";
import { personEvidenceReasons } from "../src/engines/cross-candidate/person-evidence-gate.js";
import { evaluateCrossCandidateEvidence } from "../src/engines/cross-candidate/cross-candidate-evidence.js";
import { typeCheckSectionFor } from "../src/domain/semanticTypes.js";
import { scoreCandidateQuality } from "../src/engines/quality/scoring.js";
import { qualityCategoriesOf } from "../src/domain/semanticTypes.js";
import type { Candidate, ContentBlock, Occurrence } from "../src/domain/DocumentModel.js";

const blk = (id: string): ContentBlock => ({ id, kind: "body", text: "", order: 0, sourceMapping: { partId: "w", sourceRef: "" }, runMappings: [] });
const cands = LIVE_RESIDUE.map((u) => ({ id: `person:${u.value.toLowerCase()}`, displayValue: u.value, detectedType: "person", truth: u.truth, occ: Math.max(1, u.standalone + u.contextual) }));

const assess = (c: typeof cands[number]) => {
  const cand: Candidate = { id: c.id, detectedType: "person", source: "regex", confidence: "low", normalizedValue: c.displayValue.toLowerCase(), displayValue: c.displayValue, occurrenceIds: [] };
  const blocks = new Map<string, ContentBlock>(); const occs: Occurrence[] = [];
  for (let i = 0; i < c.occ; i++) { const b = `b${i}`; blocks.set(b, blk(b)); occs.push({ id: `${c.id}:${b}:0:1`, candidateId: c.id, blockId: b, startOffset: 0, endOffset: 1, text: c.displayValue, context: `...${c.displayValue}...`, source: "regex" }); }
  return scoreCandidateQuality(cand, occs, blocks);
};

for (const withCensus of [false, true]) {
  const facts = cands.map((c) => {
    const a = assess(c);
    return {
      candidateId: c.id, qualityCategories: qualityCategoriesOf(a), positiveReasons: a.positiveReasons,
      contextualRules: [] as string[], hasPersonEvidencedLinkage: false,
      hasCensusNameStructure: withCensus && censusNameEvidenceFor(c.displayValue).supportsNameStructure,
    };
  });
  const prot = new Set(facts.filter((f) => personEvidenceReasons(f).length > 0).map((f) => f.candidateId));
  const cross = evaluateCrossCandidateEvidence({ candidates: cands, personEvidencedCandidateIds: prot });
  const moved = cands.filter((c) => cross.byCandidate[c.id]);
  const sections = new Map(cands.map((c) => {
    const a = assess(c);
    return [c.id, typeCheckSectionFor({ detectedType: "person", categories: qualityCategoriesOf(a), relationshipKinds: new Set(), censusNameStructure: censusNameEvidenceFor(c.displayValue).supportsNameStructure }, cross.byCandidate[c.id] !== undefined).section];
  }));
  const peopleLost = cands.filter((c) => c.truth === "person" && sections.get(c.id) !== "people");
  const toOther = cands.filter((c) => sections.get(c.id) === "other" && cross.byCandidate[c.id]);
  console.log(`\n=== census in gate: ${withCensus} ===`);
  console.log(`  protected               ${prot.size}/${cands.length}`);
  console.log(`  cross-candidate fires   ${moved.length}   (${moved.filter((c) => c.truth === "non-person").length} known non-people, ${moved.filter((c) => c.truth === "person").length} known people)`);
  console.log(`  -> Undetermined         ${cands.filter((c) => sections.get(c.id) === "undetermined").length}`);
  console.log(`  -> Other (BUG if >0)    ${toOther.length}`);
  console.log(`  remaining in People     ${cands.filter((c) => sections.get(c.id) === "people").length}`);
  console.log(`  KNOWN PEOPLE NOT IN PEOPLE: ${peopleLost.map((c) => `${c.displayValue}->${sections.get(c.id)}`).join(", ") || "NONE"}`);
}

// ---- final: who survives in People, and why -------------------------------
{
  const facts = cands.map((c) => {
    const a = assess(c);
    return { candidateId: c.id, qualityCategories: qualityCategoriesOf(a), positiveReasons: a.positiveReasons,
      contextualRules: [] as string[], hasPersonEvidencedLinkage: false,
      hasCensusNameStructure: censusNameEvidenceFor(c.displayValue).supportsNameStructure };
  });
  const prot = new Set(facts.filter((f) => personEvidenceReasons(f).length > 0).map((f) => f.candidateId));
  const cross = evaluateCrossCandidateEvidence({ candidates: cands, personEvidencedCandidateIds: prot });
  const rows = cands.map((c) => {
    const a = assess(c);
    const cats = qualityCategoriesOf(a).map((x) => x.replace(/_/g, "-"));
    const section = typeCheckSectionFor({ detectedType: "person", categories: qualityCategoriesOf(a), relationshipKinds: new Set(),
      censusNameStructure: censusNameEvidenceFor(c.displayValue).supportsNameStructure }, cross.byCandidate[c.id] !== undefined).section;
    const why = ["known-personal-name-token","known-first-name","known-name-structure","known-surname","nearby-title"].filter((e) => cats.includes(e));
    return { v: c.displayValue, truth: c.truth, section, why };
  });
  const by = new Map<string, number>();
  for (const r of rows) by.set(r.section, (by.get(r.section) ?? 0) + 1);
  console.log("\n=== FINAL SECTION COUNTS over the live 139 ===");
  for (const [k, n] of [...by].sort((a, b) => b[1] - a[1])) console.log(`  ${k.padEnd(16)} ${n}`);
  console.log("\n=== PEOPLE, and the affirmative evidence that put them there ===");
  for (const r of rows.filter((x) => x.section === "people")) console.log(`  ${r.v.padEnd(24)} [${r.truth}]  ${r.why.join(",")}`);
  console.log("\n=== REAL PEOPLE NOW IN UNDETERMINED (expected, pinned) ===");
  console.log("  " + rows.filter((r) => r.truth === "person" && r.section !== "people").map((r) => r.v).join(" | "));
}
