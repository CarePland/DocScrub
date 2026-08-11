/** INVESTIGATION ONLY -- why 9 witnesses move, and whether a defeasible
 *  Census branch would separate real people from greeting collisions. */
import { LIVE_RESIDUE } from "./live-residue.data.js";
import { censusNameEvidenceFor } from "../src/engines/knowledge/CensusNameEvidence.js";
import { scoreCandidateQuality } from "../src/engines/quality/scoring.js";
import { qualityCategoriesOf } from "../src/domain/semanticTypes.js";
import type { Candidate, ContentBlock, Occurrence } from "../src/domain/DocumentModel.js";

const ORDINARY = ["greeting-or-courtesy","interjection-casual","pronoun-or-determiner","sentence-fragment",
  "sentence-fragment-word","common-english-word","common-verb","all-common-dictionary-words",
  "expanded-common-language-token","contraction","grammatical-phrase-shape","implausible-capitalization","ocr-artifact"];
const cats = (v: string): string[] => {
  const id = `person:${v.toLowerCase()}`;
  const c: Candidate = { id, detectedType:"person", source:"regex", confidence:"low", normalizedValue:v.toLowerCase(), displayValue:v, occurrenceIds:[] };
  const blocks = new Map<string, ContentBlock>(); const occs: Occurrence[] = [];
  for (let i=0;i<2;i++){ const b=`b${i}`; blocks.set(b,{id:b,kind:"body",text:"",order:0,sourceMapping:{partId:"w",sourceRef:""},runMappings:[]});
    occs.push({id:`${id}:${b}:0:1`,candidateId:id,blockId:b,startOffset:0,endOffset:1,text:v,context:`...${v}...`,source:"regex"}); }
  return qualityCategoriesOf(scoreCandidateQuality(c,occs,blocks)).map((x)=>x.replace(/_/g,"-"));
};
const defeasible = (v: string): boolean => censusNameEvidenceFor(v).supportsNameStructure && !cats(v).some((c)=>ORDINARY.includes(c));

console.log("\n=== WITNESSES / COLLISIONS under a DEFEASIBLE census branch ===\n");
for (const v of ["Amy Miller","Jeffrey Lam","Bobbie Galaz","Chelsye Angelina","Evelyn, Joaquin","Francis, Kyle",
  "Fox, Liudmila","Fox, Liud","Chriztopher Johnson","Yazmine Guzmán","Julie Ford","Cashay Jackson","Min Shi",
  "Good Morning","Dear All","Dear Student","San Diego","San Marcos","Last Day","Staff Ad","Happy Birthday Eve",
  "Reason Code","Go Live","From Melissa","Fire Marshall","Level, Early","Angeles, CA"]) {
  const ce = censusNameEvidenceFor(v);
  const ord = cats(v).filter((c)=>ORDINARY.includes(c));
  console.log(`${v.padEnd(22)} census=${(ce.structure).padEnd(16)} ordinary=[${ord.join(",")}]`.padEnd(88) + ` -> ${defeasible(v) ? "PEOPLE" : "undetermined"}`);
}
const P = LIVE_RESIDUE.filter((u)=>u.truth==="person");
const NP = LIVE_RESIDUE.filter((u)=>u.truth==="non-person");
console.log(`\npeople reaching People:      ${P.filter((u)=>defeasible(u.value)).length}/${P.length}`);
console.log(`non-people reaching People:  ${NP.filter((u)=>defeasible(u.value)).length}/${NP.length}`);
console.log(`  ${NP.filter((u)=>defeasible(u.value)).map((u)=>u.value).join(" | ")}`);
console.log(`\npeople still lost: ${P.filter((u)=>!defeasible(u.value)).map((u)=>u.value).join(", ")}`);
