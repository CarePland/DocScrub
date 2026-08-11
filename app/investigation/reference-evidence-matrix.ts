/**
 * reference-evidence-matrix.ts -- INVESTIGATION ONLY. The complete N x N
 * collision measurement across ALL EIGHT shipped reference evidence families
 * (AG, 2026-08-10).
 *
 *     node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs \
 *          investigation/reference-evidence-matrix.ts
 *
 * ══════════════════ WHY THIS EXISTS ALONGSIDE THE OTHERS ══════════════════
 *
 * `domain-reference-overlap.ts` and `employment-hr-overlap.ts` each measured
 * ONE ARRIVING PACK against the families that happened to be present when it
 * landed. That is the right instrument for integrating a pack, and both are
 * left exactly as they are. Neither answers the question this pass asks,
 * because neither could: what does the evidence landscape look like now that
 * all eight families exist SIMULTANEOUSLY?
 *
 * Concretely, the earlier harnesses cannot report:
 *
 *   - a symmetric pairwise matrix (every family x every family, one table);
 *   - the multiplicity histogram -- how many phrases 2, 3, 4, 5+ families
 *     attest, which is the shape a combination layer must be sized against;
 *   - single-token collisions measured over the WHOLE union rather than one
 *     pack's terms;
 *   - acronym-row collisions across families.
 *
 * ══════════════════ THIS IS MEASUREMENT, NOT POLICY ══════════════════
 *
 * Nothing here is tuned, and nothing here may become a rule. No term is
 * dropped because it collides, no threshold is fitted, no dataset is reshaped
 * against these numbers. A high overlap count is not a defect: a term that
 * collides is a term doing its job, telling us the phrase is genuinely
 * ambiguous. The purpose is to know the size and shape of the ambiguity
 * BEFORE anyone designs how to resolve it.
 *
 * ══════════════════ THE TWO CENSUS MEASURES, AND WHY BOTH ══════════════════
 *
 * Census is reported twice and the difference matters:
 *
 *   census-structure   `censusNameEvidenceFor` -- does this PHRASE have
 *                      personal-name structure (two tokens agreeing on
 *                      first-name / surname roles)? This is the channel
 *                      `ReferenceEvidence.ts` exposes and the only one the
 *                      person-protection gate reads. It cannot fire on a
 *                      single token, by construction.
 *
 *   census-token       `censusRoleFor` -- is EVERY token of the phrase a
 *                      Census-attested name token? Weaker, and deliberately
 *                      NOT a channel, but it is the measure that exposes the
 *                      single-token collision population (`White`, `Major`,
 *                      `Levy`, `Case`) that every pack's integration report
 *                      independently rediscovered.
 *
 * Reporting only the first would understate the collision landscape by an
 * order of magnitude; reporting only the second would overstate what the
 * shipped channel actually claims. Both, labelled, is the honest answer.
 *
 * Read-only: imports the shipped providers, prints, writes nothing, and is
 * not part of the verification battery.
 */

import { censusNameEvidenceFor, censusRoleFor } from "../src/engines/knowledge/CensusNameEvidence.js";
import { gnisPlaceEvidenceFor } from "../src/engines/knowledge/GnisPlaceEvidence.js";
import { referenceEvidenceFor, terminologyChannelsOf, type ReferenceEvidenceChannels } from "../src/engines/knowledge/ReferenceEvidence.js";

import { HIGHER_ED_ROWS, HIGHER_ED_TERMINOLOGY_ROW_COUNT, HIGHER_ED_TERMINOLOGY_SOURCE, HIGHER_ED_TERMINOLOGY_TERM_COUNT } from "../src/engines/knowledge/higher-ed-terminology.data.js";
import { MEDICAL_ROWS, MEDICAL_TERMINOLOGY_ROW_COUNT, MEDICAL_TERMINOLOGY_SOURCE, MEDICAL_TERMINOLOGY_TERM_COUNT } from "../src/engines/knowledge/medical-terminology.data.js";
import { LEGAL_PACK, LEGAL_ROW_COUNT, LEGAL_SOURCE, LEGAL_TERM_COUNT } from "../src/engines/knowledge/legal-terminology.data.js";
import { FINANCE_TAX_PACK, FINANCE_TAX_ROW_COUNT, FINANCE_TAX_SOURCE, FINANCE_TAX_TERM_COUNT } from "../src/engines/knowledge/finance-accounting-tax-terminology.data.js";
import { EMPLOYMENT_HR_PACK, EMPLOYMENT_HR_ROW_COUNT, EMPLOYMENT_HR_SOURCE, EMPLOYMENT_HR_TERM_COUNT } from "../src/engines/knowledge/employment-hr-terminology.data.js";
import { GOVERNMENT_PACK, GOVERNMENT_ROW_COUNT, GOVERNMENT_SOURCE, GOVERNMENT_TERM_COUNT } from "../src/engines/knowledge/government-public-admin-terminology.data.js";
import { CENSUS_NAME_ENTRY_COUNT, CENSUS_NAME_SOURCE } from "../src/engines/knowledge/census-names.data.js";
import { GNIS_PLACE_ENTRY_COUNT, GNIS_PLACE_KEYS, GNIS_PLACE_SOURCE } from "../src/engines/knowledge/gnis-places.data.js";

/* ─────────────────────────── enumeration ─────────────────────────── */

/** Display terms shipped by a pack, deduplicated.
 *
 *  DISPLAY FORMS, NOT KEYS. Every pack's asset happens to carry the display
 *  term in TSV column 1, which makes this uniform -- but the normalized key in
 *  column 0 is pack-private and comparing keys across packs would be wrong,
 *  because the five normalization policies differ deliberately (see
 *  DomainReferenceEvidence.ts). Every cross-family question below is asked by
 *  running a display form through the OTHER pack's own `...For()` API. */
function displayTerms(rows: string): string[] {
  const seen = new Set<string>();
  for (const line of rows.split("\n")) {
    if (line.length === 0) continue;
    const term = line.split("\t")[1];
    if (term !== undefined && term.length > 0) seen.add(term);
  }
  return [...seen];
}

interface PackDescriptor {
  id: string;
  label: string;
  source: string;
  rowCount: number;
  termCount: number;
  terms: string[];
}

const TERMINOLOGY_PACKS: PackDescriptor[] = [
  { id: "higher-ed-terminology", label: "higher education", source: HIGHER_ED_TERMINOLOGY_SOURCE, rowCount: HIGHER_ED_TERMINOLOGY_ROW_COUNT, termCount: HIGHER_ED_TERMINOLOGY_TERM_COUNT, terms: displayTerms(HIGHER_ED_ROWS) },
  { id: "legal-terminology", label: "legal", source: LEGAL_SOURCE, rowCount: LEGAL_ROW_COUNT, termCount: LEGAL_TERM_COUNT, terms: displayTerms(LEGAL_PACK.rows) },
  { id: "medical-terminology", label: "medical", source: MEDICAL_TERMINOLOGY_SOURCE, rowCount: MEDICAL_TERMINOLOGY_ROW_COUNT, termCount: MEDICAL_TERMINOLOGY_TERM_COUNT, terms: displayTerms(MEDICAL_ROWS) },
  { id: "finance-accounting-tax", label: "finance / accounting / tax", source: FINANCE_TAX_SOURCE, rowCount: FINANCE_TAX_ROW_COUNT, termCount: FINANCE_TAX_TERM_COUNT, terms: displayTerms(FINANCE_TAX_PACK.rows) },
  { id: "employment-hr-terminology", label: "employment / HR", source: EMPLOYMENT_HR_SOURCE, rowCount: EMPLOYMENT_HR_ROW_COUNT, termCount: EMPLOYMENT_HR_TERM_COUNT, terms: displayTerms(EMPLOYMENT_HR_PACK.rows) },
  { id: "government-public-admin", label: "government / public admin", source: GOVERNMENT_SOURCE, rowCount: GOVERNMENT_ROW_COUNT, termCount: GOVERNMENT_TERM_COUNT, terms: displayTerms(GOVERNMENT_PACK.rows) },
];

/** The channel ids reported in the matrix, in a FIXED but MEANINGLESS order.
 *  Declaration order carries no precedence; there is no precedence here. */
const TERMINOLOGY_IDS = TERMINOLOGY_PACKS.map((p) => p.id);
const MATRIX_IDS = [...TERMINOLOGY_IDS, "census-structure", "census-token", "gnis-place"];

/* ─────────────────────────── the universe ─────────────────────────── */

/**
 * Every distinct display form any terminology pack ships, case-folded for
 * dedup only.
 *
 * Census and GNIS terms are NOT enumerated into the universe: at 160k+ and
 * 200k+ entries they would swamp a 4,000-phrase measurement and, more
 * importantly, the question being asked is "what does terminology vocabulary
 * collide with", not "what do two national gazetteers collide with". Census
 * and GNIS appear as LOOKUP TARGETS on every row instead, which is the
 * direction that matters for a document reviewer.
 */
function buildUniverse(): string[] {
  const byFold = new Map<string, string>();
  for (const pack of TERMINOLOGY_PACKS) {
    for (const term of pack.terms) {
      const fold = term.toLocaleLowerCase();
      if (!byFold.has(fold)) byFold.set(fold, term);
    }
  }
  return [...byFold.values()];
}

/** Every channel that attested this phrase, using BOTH census measures.
 *  See the module header for why census is reported twice. */
function channelsFor(phrase: string): { channels: ReferenceEvidenceChannels; attesting: string[] } {
  const channels = referenceEvidenceFor(phrase);
  const attesting: string[] = [];
  for (const view of terminologyChannelsOf(channels)) if (view.evidence) attesting.push(view.id);
  if (channels.censusName.supportsNameStructure) attesting.push("census-structure");
  if (everyTokenIsCensusAttested(phrase)) attesting.push("census-token");
  if (channels.gnisPlace.strength !== "none") attesting.push("gnis-place");
  return { channels, attesting };
}

/** Every alphabetic token of the phrase is a Census-attested name token.
 *  The weak measure -- see the module header. */
function everyTokenIsCensusAttested(phrase: string): boolean {
  const tokens = phrase.split(/[^A-Za-z]+/).filter((t) => t.length > 0);
  if (tokens.length === 0) return false;
  return tokens.every((t) => censusRoleFor(t) !== null);
}

function tokenCount(phrase: string): number {
  return phrase.split(/\s+/).filter((t) => t.length > 0).length;
}

/* ─────────────────────────── the measurement ─────────────────────────── */

const universe = buildUniverse();

console.log("=== REFERENCE EVIDENCE COLLISION MATRIX ===");
console.log(`    ${universe.length} distinct display forms across ${TERMINOLOGY_PACKS.length} terminology packs,`);
console.log(`    each asked of all 8 evidence families. Measurement only -- nothing here is a rule.`);

console.log("\n--- 0. FAMILY INVENTORY ---");
console.table([
  ...TERMINOLOGY_PACKS.map((p) => ({ family: p.id, kind: "domain terminology", rows: p.rowCount, terms: p.termCount, source: p.source })),
  { family: "census-name", kind: "identity / human-name", rows: CENSUS_NAME_ENTRY_COUNT, terms: CENSUS_NAME_ENTRY_COUNT, source: CENSUS_NAME_SOURCE },
  { family: "gnis-place", kind: "identity / geographic-name", rows: GNIS_PLACE_ENTRY_COUNT, terms: GNIS_PLACE_ENTRY_COUNT, source: GNIS_PLACE_SOURCE },
]);

/* Evaluate the universe once. Every section below reads this. */
interface Row {
  phrase: string;
  attesting: string[];
  tokens: number;
  highRisk: boolean;
  acronymRow: boolean;
  gnisStrength: string;
  censusStructure: string;
}

const started = Date.now();
const rows: Row[] = universe.map((phrase) => {
  const { channels, attesting } = channelsFor(phrase);
  let highRisk = false;
  let acronymRow = false;
  for (const view of terminologyChannelsOf(channels)) {
    if (!view.evidence) continue;
    if (view.evidence.highestCollisionRisk === "HIGH") highRisk = true;
  }
  for (const family of [channels.legalTerminology, channels.financeAccountingTax, channels.employmentHr, channels.governmentPublicAdmin]) {
    if (family && family.attestations.some((a) => a.acronym !== null)) acronymRow = true;
  }
  return {
    phrase,
    attesting,
    tokens: tokenCount(phrase),
    highRisk,
    acronymRow,
    gnisStrength: channels.gnisPlace.strength,
    censusStructure: channels.censusName.structure,
  };
});
const elapsedMs = Date.now() - started;
console.log(`\n    (${universe.length} phrases x 8 families evaluated in ${elapsedMs} ms)`);

/* 1. PAIRWISE MATRIX. Symmetric; the diagonal is the family's own hit count
 *    within the universe, which for a terminology pack is its own vocabulary
 *    plus whatever the other packs share with it. */
console.log("\n--- 1. PAIRWISE COLLISIONS (phrases attested by BOTH families) ---");
const pairwise: Array<Record<string, unknown>> = [];
for (const a of MATRIX_IDS) {
  const row: Record<string, unknown> = { family: a };
  for (const b of MATRIX_IDS) {
    row[b] = rows.filter((r) => r.attesting.includes(a) && r.attesting.includes(b)).length;
  }
  pairwise.push(row);
}
console.table(pairwise);
console.log("    Diagonal = that family's hits within this universe. Off-diagonal = joint attestation.");
console.log("    A high count is NOT a defect: it is the ambiguity a combination layer must represent.");

/* 2. MULTIPLICITY HISTOGRAM. The number a combination layer must be sized
 *    against: how often do independent families speak at once? */
console.log("\n--- 2. MULTIPLICITY: how many families attest the same phrase ---");
const histogram = new Map<number, number>();
for (const r of rows) histogram.set(r.attesting.length, (histogram.get(r.attesting.length) ?? 0) + 1);
console.table([...histogram.entries()].sort((x, y) => x[0] - y[0]).map(([n, count]) => ({
  familiesAttesting: n,
  phrases: count,
  pctOfUniverse: `${((count / rows.length) * 100).toFixed(1)}%`,
})));

/* 3. THE DEEP COLLISIONS: 3+ and 4+ families. These are the witnesses a
 *    combination layer will be judged on, because they are the phrases where
 *    no single family's claim can be taken at face value. */
for (const threshold of [3, 4, 5]) {
  const deep = rows.filter((r) => r.attesting.length >= threshold);
  console.log(`\n--- 3.${threshold - 2}. PHRASES ATTESTED BY ${threshold}+ FAMILIES: ${deep.length} ---`);
  console.table(deep.slice(0, 40).map((r) => ({
    phrase: r.phrase,
    n: r.attesting.length,
    families: r.attesting.join(" + "),
    tokens: r.tokens,
  })));
  if (deep.length > 40) console.log(`    (${deep.length - 40} more not shown)`);
}

/* 4. SINGLE-TOKEN COLLISIONS. The GNIS benchmark established single-token
 *    matches as the dangerous case for reference datasets generally; this is
 *    that population measured across the whole union rather than one pack. */
console.log("\n--- 4. SINGLE-TOKEN COLLISIONS (phrase is one token AND 2+ families attest) ---");
const singleToken = rows.filter((r) => r.tokens === 1 && r.attesting.length >= 2);
console.log(`    ${singleToken.length} of ${rows.filter((r) => r.tokens === 1).length} single-token phrases in the universe.`);
console.table(singleToken.slice(0, 50).map((r) => ({
  phrase: r.phrase,
  families: r.attesting.join(" + "),
  packFlagsHighRisk: r.highRisk,
  gnis: r.gnisStrength,
})));
if (singleToken.length > 50) console.log(`    (${singleToken.length - 50} more not shown)`);

/* 5. ACRONYM COLLISIONS. An acronym row is evidence LOCAL to its source and
 *    domain; where two families claim the same short form, that locality is
 *    the whole finding. */
console.log("\n--- 5. ACRONYM-ROW COLLISIONS (a family recorded this as an acronym AND another family attests) ---");
const acronymCollisions = rows.filter((r) => r.acronymRow && r.attesting.length >= 2);
console.log(`    ${acronymCollisions.length} of ${rows.filter((r) => r.acronymRow).length} phrases carrying an acronym row.`);
console.table(acronymCollisions.slice(0, 40).map((r) => ({
  phrase: r.phrase,
  families: r.attesting.join(" + "),
  tokens: r.tokens,
})));
if (acronymCollisions.length > 40) console.log(`    (${acronymCollisions.length - 40} more not shown)`);

/* 6. IDENTITY x TERMINOLOGY. The collision class every pack integration
 *    rediscovered independently, stated once, over the whole universe. */
console.log("\n--- 6. IDENTITY EVIDENCE meeting DOMAIN TERMINOLOGY ---");
console.table(TERMINOLOGY_IDS.map((id) => {
  const inFamily = rows.filter((r) => r.attesting.includes(id));
  return {
    family: id,
    terms: inFamily.length,
    alsoCensusStructure: inFamily.filter((r) => r.attesting.includes("census-structure")).length,
    alsoCensusEveryToken: inFamily.filter((r) => r.attesting.includes("census-token")).length,
    alsoGnisPlace: inFamily.filter((r) => r.attesting.includes("gnis-place")).length,
    gnisStrong: inFamily.filter((r) => r.gnisStrength === "strong").length,
  };
}));
console.log("    census-structure fires only on multi-token personal-name shapes, by construction.");
console.log("    census-every-token is the weaker measure and is where the single-token danger lives.");

/* 7. THE MOST CONTESTED PHRASES: the witness set for the next pass. */
/* 6b. WHY THE GNIS ROW IS ZERO, STATED SO NOBODY READS IT AS A BUG.
 *
 * `gnisPlaceEvidenceFor` returns "none" for any single-token phrase, because
 * single-token names are EXCLUDED AT GENERATION from the GNIS pack -- see
 * GnisPlaceEvidence.ts. `Salem`, `Madison` and `Lincoln` are all real GNIS
 * populated places and all correctly return "none" here. So a zero in the
 * gnis-place column of section 1 measures the pack's deliberate exclusion
 * policy, NOT an absence of geographic ambiguity in the terminology packs.
 *
 * The honest measurement therefore runs in the OTHER direction: take the
 * multi-token place names GNIS does ship and ask what else attests them. */
console.log("\n--- 6b. THE OTHER DIRECTION: GNIS multi-token place names met by other families ---");
{
  const gnisKeys = GNIS_PLACE_KEYS.split("\n").filter((k) => k.length > 0);
  const perFamily = new Map<string, number>();
  let censusStructureHits = 0;
  let suppressedWeak = 0;
  let anyTerminology = 0;
  const witnesses: Array<Record<string, unknown>> = [];
  const censusWitnesses: Array<Record<string, unknown>> = [];
  for (const key of gnisKeys) {
    const channels = referenceEvidenceFor(key);
    const hit: string[] = [];
    for (const view of terminologyChannelsOf(channels)) {
      if (!view.evidence) continue;
      hit.push(view.id);
      perFamily.set(view.id, (perFamily.get(view.id) ?? 0) + 1);
    }
    const structure = channels.censusName.supportsNameStructure;
    if (structure) {
      censusStructureHits += 1;
      if (channels.gnisPlace.strength === "weak") suppressedWeak += 1;
      if (censusWitnesses.length < 25) {
        censusWitnesses.push({
          gnisKey: key,
          censusStructure: channels.censusName.structure,
          gnisStrength: channels.gnisPlace.strength,
          suppression: channels.gnisPlace.suppressionReason ?? "",
          classes: channels.gnisPlace.featureClasses.join("/"),
        });
      }
    }
    if (hit.length > 0) {
      anyTerminology += 1;
      if (witnesses.length < 30) {
        witnesses.push({ gnisKey: key, terminology: hit.join(" + "), censusStructure: structure, gnis: channels.gnisPlace.strength });
      }
    }
  }
  console.log(`    ${gnisKeys.length} GNIS place keys; ${anyTerminology} also attested by at least one terminology pack.`);
  console.table(TERMINOLOGY_IDS.map((id) => ({ family: id, gnisPlacesAlsoAttested: perFamily.get(id) ?? 0 })));
  if (witnesses.length > 0) console.table(witnesses);

  /* THE LOAD-BEARING NUMBER OF THIS WHOLE HARNESS. Place evidence and human-name
   * evidence are the two families most likely to be jointly true, and this is
   * the size of that population. Policy B already downgrades part of it to
   * "weak"; the remainder is an UNRESOLVED conflict that survives to the
   * interpretation boundary intact, which is exactly what it should do. */
  console.log(`\n    Census personal-name STRUCTURE also present on ${censusStructureHits} of ${gnisKeys.length} GNIS keys ` +
    `(${((censusStructureHits / gnisKeys.length) * 100).toFixed(1)}%).`);
  console.log(`    Of those, ${suppressedWeak} are downgraded to "weak" by GNIS Policy B; ` +
    `${censusStructureHits - suppressedWeak} remain "strong" WITH a person structure -- an unresolved conflict, by design.`);
  console.table(censusWitnesses);
}

console.log("\n--- 7. MOST CONTESTED PHRASES (ranked by families attesting) ---");
console.table(
  [...rows]
    .filter((r) => r.attesting.length >= 3)
    .sort((a, b) => b.attesting.length - a.attesting.length || a.phrase.localeCompare(b.phrase))
    .slice(0, 25)
    .map((r) => ({
      phrase: r.phrase,
      n: r.attesting.length,
      families: r.attesting.join(" + "),
      censusStructure: r.censusStructure,
      gnis: r.gnisStrength,
    }))
);

console.log("\n=== END. Nothing above was used to change any dataset, threshold or decision. ===");
