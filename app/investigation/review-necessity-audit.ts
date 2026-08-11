/**
 * review-necessity-audit.ts -- INVESTIGATION ONLY. How much human review could
 * DocScrub eliminate BEFORE the user decides anything? (AG, 2026-08-10)
 *
 *     node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs \
 *          investigation/review-necessity-audit.ts \
 *          investigation/data/interpretation-population.json
 *
 * ═══════════════════ THE PRODUCT QUESTION ═══════════════════
 *
 *     Lousy candidates should never reach the user when DocScrub can safely
 *     and affirmatively determine that no useful privacy decision remains.
 *
 * "Affirmatively" is the whole constraint. A candidate does not qualify for
 * removal because nothing is known about it, nor because a semantic priority
 * table says another reading wins. It qualifies only when the system holds
 * positive evidence that explains it AND no privacy-relevant reading survives.
 *
 * ═══════════════════ THREE OPERATIONS, KEPT SEPARATE ═══════════════════
 *
 *   A  reject one interpretation          (P-6 does this)
 *   B  reclassify a candidate             (needs a unique surviving reading)
 *   C  remove a candidate from review     (needs A or B *plus* the absence of
 *                                          any privacy-relevant reading, and
 *                                          a positive explanation)
 *
 * C is strictly stronger than A and B. `First Fight` has its Person reading
 * rejected by P-6 and NOTHING survives -- that is a candidate about which the
 * system knows nothing, and it must stay visible.
 *
 * ═══════════════════ WHAT THIS HARNESS CAN AND CANNOT SEE ═══════════════════
 *
 * The export carries interpretations, signals, section and occurrence count --
 * everything the browser derived, including `occurrence-context` and
 * `document-consistency`, which no offline harness can recompute.
 *
 * It does NOT carry quality categories. Where this audit needs them (extraction
 * -defect shapes), they are RECOMPUTED from the value with the real quality
 * engine over a synthetic single-occurrence document. That is production
 * evidence, not a label -- but it lacks document context, so it UNDERSTATES
 * context-dependent categories. Flagged wherever it matters.
 *
 * It also cannot see `automaticResolutions`: session state is not exported. The
 * already-resolved bucket is therefore reported as unmeasurable rather than
 * guessed at.
 *
 * ═══════════════════ TRUTH LABELS ARE EVALUATION ONLY ═══════════════════
 *
 * `LIVE_RESIDUE` labels are joined by value and used ONLY to score whether a
 * proposed population would have been safe. No bucket assignment reads them.
 * The separation is enforced structurally: labels are attached AFTER every
 * candidate has been bucketed.
 *
 * Read-only. Implements nothing, changes nothing, proposes no rule.
 */

import { readFileSync, existsSync } from "node:fs";
import { adjudicatePerson, personEvidenceScopeOf } from "../src/engines/interpretation/person-adjudication.js";
import type { InterpretationProfile, InterpretationSignal } from "../src/engines/interpretation/interpretation-model.js";
import { scoreCandidateQuality } from "../src/engines/quality/scoring.js";
import { qualityCategoriesOf } from "../src/domain/semanticTypes.js";
import type { Candidate, ContentBlock, Occurrence } from "../src/domain/DocumentModel.js";
import { LIVE_RESIDUE } from "./live-residue.data.js";

const path = process.argv[2] ?? "investigation/data/interpretation-population.json";
if (!existsSync(path)) { console.log(`No export at ${path}.`); process.exit(2); }

interface ExpSignal { signalId: string; class: string; provenance: string; lineage: string[] }
interface ExpInterp { id: string; domain: string | null; signals: ExpSignal[] }
interface ExpRow { candidateId: string; value: string; section: string | null; occurrenceCount: number; interpretations: ExpInterp[] }
const ROWS: ExpRow[] = JSON.parse(readFileSync(path, "utf8"));

/* ─────────────── recomputed quality categories (production evidence) ─────────────── */

function qualityCategoriesFor(value: string): readonly string[] {
  const block: ContentBlock = {
    id: "b1", kind: "body", text: value, order: 0,
    sourceMapping: { partName: "word/document.xml", nodePath: "/p[1]" }, runMappings: [],
  };
  const occurrence: Occurrence = {
    id: "o1", candidateId: "c1", blockId: "b1", startOffset: 0, endOffset: value.length,
    text: value, context: value, source: "regex",
  };
  const candidate: Candidate = {
    id: "c1", detectedType: "person", source: "regex", confidence: "medium",
    normalizedValue: value.toLowerCase(), displayValue: value, occurrenceIds: ["o1"],
  };
  return qualityCategoriesOf(scoreCandidateQuality(candidate, [occurrence], new Map([["b1", block]])));
}

/* ─────────────── the taxonomy ─────────────── */

/**
 * Buckets, in strict precedence order. Every candidate lands in exactly one,
 * and the FIRST matching rule wins -- so the taxonomy is deterministic and the
 * ordering is itself a claim: privacy-relevant readings are tested before any
 * convenience bucket can claim a candidate.
 */
type Bucket =
  /** A protective typed detection: email, phone, CIN, long numeric id. The
   *  disposition is genuinely the reviewer's; DocScrub never auto-handles PII. */
  | "typed-pii-detection"
  /** A Person reading survives. Privacy-relevant by definition. */
  | "person-possible"
  /** No Person, but two or more affirmative non-Person readings compete. */
  | "contested-non-person"
  /** Exactly one affirmative reading, and it is a non-sensitive class. */
  | "uniquely-explained-non-sensitive"
  /** Exactly one affirmative reading, but of a class that can carry privacy
   *  weight in some documents (organization). Explained, not obviously safe. */
  | "uniquely-explained-organizational"
  /** No affirmative evidence at all. */
  | "unsupported";

/** Classes that explain a candidate WITHOUT implying anything about a person
 *  or an identifiable entity. `organization` is deliberately excluded. */
const NON_SENSITIVE = new Set(["domain-terminology", "ordinary-language", "date-or-term", "document-title", "acronym"]);

interface Audited {
  row: ExpRow;
  profile: InterpretationProfile;
  detectorType: string;
  tokenCount: number;
  categories: readonly string[];
  bucket: Bucket;
  readings: string[];
  personSignals: InterpretationSignal[];
  personScopes: string[];
  p6Fires: boolean;
  p6Disposition: string;
  boundaryShape: string | null;
  /** ATTACHED AFTER BUCKETING. Evaluation only. */
  label: "person" | "non-person" | "?";
}

/**
 * Extraction-boundary tells, from recomputed quality categories.
 *
 * These are SHAPE observations, not semantic judgments: a greeting or
 * interjection fused into a candidate span, an honorific stranded without its
 * name, a sentence fragment. They say the SPAN is suspect, which is a
 * different defect from a weak reading.
 */
function boundaryShapeOf(categories: readonly string[], value: string): string | null {
  const c = new Set(categories.map((x) => x.replace(/_/g, "-")));
  if (c.has("greeting-or-courtesy") || c.has("interjection-casual")) return "greeting/interjection fused into span";
  if (c.has("honorific-title") && value.trim().split(/\s+/).length <= 2) return "stranded honorific";
  if (c.has("sentence-fragment") || c.has("sentence-fragment-word")) return "sentence fragment";
  if (/^(if|when|did|regarding|thanks|hi|hello|dear|from|to|re)\b/i.test(value.trim())) return "leading function/greeting word";
  if (/,\s{2,}/.test(value)) return "multiple-space comma join";
  return null;
}

const AUDITED: Audited[] = ROWS.map((row) => {
  const profile: InterpretationProfile = {
    candidateId: row.candidateId,
    value: row.value,
    outcome: row.interpretations.length === 0 ? "unsupported" : row.interpretations.length === 1 ? "single" : "contested",
    interpretations: row.interpretations.map((i) => ({
      id: i.id as never,
      ...(i.domain ? { domain: i.domain } : {}),
      signals: i.signals.map((s) => ({ signalId: s.signalId, class: s.class as never, detail: "", provenance: s.provenance, lineage: s.lineage as never })),
    })),
  };
  const detectorType = row.candidateId.split(":")[0] ?? "unknown";
  const tokenCount = row.value.replace(/,/g, " ").split(/\s+/).filter(Boolean).length;
  const categories = qualityCategoriesFor(row.value);
  const person = profile.interpretations.find((i) => i.id === "person");
  const personSignals = [...(person?.signals ?? [])];
  const readings = profile.interpretations.map((i) => (i.domain ? `${i.id}[${i.domain}]` : i.id));
  const nonPerson = profile.interpretations.filter((i) => i.id !== "person");
  const adj = adjudicatePerson(profile, tokenCount);

  let bucket: Bucket;
  if (["email", "phone", "cin", "long_numeric_id"].includes(detectorType)) bucket = "typed-pii-detection";
  else if (personSignals.length > 0) bucket = "person-possible";
  else if (nonPerson.length >= 2) bucket = "contested-non-person";
  else if (nonPerson.length === 1) {
    bucket = NON_SENSITIVE.has(nonPerson[0]!.id) ? "uniquely-explained-non-sensitive" : "uniquely-explained-organizational";
  } else bucket = "unsupported";

  return {
    row, profile, detectorType, tokenCount, categories, bucket, readings, personSignals,
    personScopes: [...new Set(personSignals.map((s) => personEvidenceScopeOf(s, tokenCount)))],
    p6Fires: adj.rejectedBy !== null,
    p6Disposition: adj.disposition,
    boundaryShape: boundaryShapeOf(categories, row.value),
    label: "?",
  };
});

/* LABELS ATTACHED ONLY NOW -- after every bucket is fixed. */
const LABELS = new Map(LIVE_RESIDUE.map((u) => [u.value, u.truth as "person" | "non-person" | "?"]));
for (const a of AUDITED) a.label = LABELS.get(a.row.value) ?? "?";

/* ═══════════════ 1. DISTRIBUTION ═══════════════ */

console.log("=== REVIEW-NECESSITY AUDIT ===");
console.log(`    ${AUDITED.length} candidates, ${AUDITED.reduce((s, a) => s + a.row.occurrenceCount, 0)} occurrences.`);
console.log(`    ${LABELS.size} human-labelled values available for EVALUATION only.`);
console.log("    Session state (automaticResolutions) is not exported -- that bucket is unmeasurable here.");

console.log("\n--- 1. REVIEW-NECESSITY DISTRIBUTION ---");
{
  const order: Bucket[] = ["typed-pii-detection", "person-possible", "contested-non-person",
    "uniquely-explained-organizational", "uniquely-explained-non-sensitive", "unsupported"];
  console.table(order.map((b) => {
    const g = AUDITED.filter((a) => a.bucket === b);
    return {
      bucket: b,
      candidates: g.length,
      share: `${((g.length / AUDITED.length) * 100).toFixed(1)}%`,
      occurrences: g.reduce((s, a) => s + a.row.occurrenceCount, 0),
      "review required?": b === "uniquely-explained-non-sensitive" ? "POTENTIALLY NOT" : "yes",
      examples: g.slice(0, 4).map((a) => a.row.value).join(", "),
    };
  }));
}

console.log("\n--- 1b. BUCKET x CURRENT SECTION ---");
{
  const sections = [...new Set(AUDITED.map((a) => a.row.section ?? "(null)"))].sort();
  const order: Bucket[] = ["typed-pii-detection", "person-possible", "contested-non-person",
    "uniquely-explained-organizational", "uniquely-explained-non-sensitive", "unsupported"];
  console.table(order.map((b) => {
    const row: Record<string, unknown> = { bucket: b };
    for (const s of sections) row[s] = AUDITED.filter((a) => a.bucket === b && (a.row.section ?? "(null)") === s).length;
    return row;
  }));
}

/* ═══════════════ 2. THE POTENTIAL-REMOVAL POPULATION ═══════════════ */

/**
 * The ONLY population that could plausibly disappear: exactly one affirmative
 * reading, that reading is non-sensitive, and NO Person reading survives.
 *
 * Note what is deliberately excluded:
 *   - `unsupported` -- absence of evidence is not a reason to hide anything.
 *   - `contested-non-person` -- two readings means the system has not
 *     explained the candidate, only narrowed it.
 *   - `organization` -- can carry privacy weight depending on the document.
 */
const REMOVABLE = AUDITED.filter((a) => a.bucket === "uniquely-explained-non-sensitive");

console.log(`\n--- 2. POTENTIAL-REMOVAL POPULATION: ${REMOVABLE.length} candidates ---`);
console.log("    Predicate: exactly ONE affirmative reading, non-sensitive class, NO person reading.");
console.log("    No candidate qualifies for looking like junk, and none qualifies on absence.");
console.table(REMOVABLE.map((a) => ({
  value: a.row.value,
  section: a.row.section,
  occ: a.row.occurrenceCount,
  reading: a.readings.join(", "),
  "signal classes": [...new Set(a.profile.interpretations.flatMap((i) => i.signals.map((s) => s.class)))].join(", "),
  "depends on P-6": a.p6Fires,
  "depends on reference/domain evidence": a.profile.interpretations.some((i) => i.signals.some((s) => s.class === "exact-phrase-attestation")),
  "depends on document-local": a.profile.interpretations.some((i) => i.signals.some((s) => s.class === "document-consistency")),
  "privacy-relevant reading survives": false,
  label: a.label,
})));

console.log("\n    Evidence-class composition of the removable population:");
{
  const byClass = new Map<string, number>();
  for (const a of REMOVABLE) for (const i of a.profile.interpretations) for (const s of i.signals) {
    byClass.set(s.class, (byClass.get(s.class) ?? 0) + 1);
  }
  console.table([...byClass.entries()].sort((a, b) => b[1] - a[1]).map(([cls, n]) => ({ "signal class": cls, signals: n })));
}

console.log("\n    Truth-label evaluation of the removable population (EVALUATION ONLY):");
{
  const labelled = REMOVABLE.filter((a) => a.label !== "?");
  console.log(`      labelled: ${labelled.length} of ${REMOVABLE.length}`);
  console.log(`      would have removed a REAL PERSON: ${labelled.filter((a) => a.label === "person").length}`);
  console.log(`      correctly non-person:             ${labelled.filter((a) => a.label === "non-person").length}`);
  const bad = labelled.filter((a) => a.label === "person");
  if (bad.length > 0) console.log(`      ⚠ ${bad.map((a) => a.row.value).join(", ")}`);
}

/* ═══════════════ 3. THE FUNNEL ═══════════════ */

console.log("\n--- 3. REVIEW FUNNEL ---");
{
  const typed = AUDITED.filter((a) => a.bucket === "typed-pii-detection").length;
  const person = AUDITED.filter((a) => a.bucket === "person-possible").length;
  const contested = AUDITED.filter((a) => a.bucket === "contested-non-person").length;
  const org = AUDITED.filter((a) => a.bucket === "uniquely-explained-organizational").length;
  const unsupported = AUDITED.filter((a) => a.bucket === "unsupported").length;
  const explained = AUDITED.length - unsupported;
  console.log(`
    ${AUDITED.length}  extracted candidates
     └─ ${explained}  carry at least one affirmative interpretation
         └─ ${REMOVABLE.length}  uniquely explained as non-sensitive   <- POTENTIALLY REMOVABLE
         └─ ${explained - REMOVABLE.length}  still require attention
              ├─ ${typed}  typed PII detections (never auto-handled)
              ├─ ${person}  Person reading survives
              ├─ ${contested}  contested among non-Person readings
              └─ ${org}  uniquely organizational
     └─ ${unsupported}  no affirmative evidence -- must stay visible

    POTENTIAL REVIEW REDUCTION: ${REMOVABLE.length} of ${AUDITED.length} = ${((REMOVABLE.length / AUDITED.length) * 100).toFixed(1)}%
    REMAINING REVIEW POPULATION: ${AUDITED.length - REMOVABLE.length}`);
}

/* ═══════════════ 4. P-6 DOWNSTREAM ═══════════════ */

console.log("\n--- 4. P-6 DOWNSTREAM: WHAT REVIEW PURPOSE REMAINS? ---");
{
  const fired = AUDITED.filter((a) => a.p6Fires);
  console.log(`    P-6 fires on ${fired.length}. Its effect is operation A (reject a reading), not C (remove from review).`);
  console.table(fired.map((a) => {
    const nonPerson = a.profile.interpretations.filter((i) => i.id !== "person");
    const uniqueNonSensitive = nonPerson.length === 1 && NON_SENSITIVE.has(nonPerson[0]!.id);
    return {
      value: a.row.value,
      section: a.row.section,
      "P-6 disposition": a.p6Disposition,
      "surviving readings": nonPerson.map((i) => i.id).join(", ") || "(none)",
      "would become removable": uniqueNonSensitive,
      "review purpose remaining": uniqueNonSensitive ? "none identified"
        : nonPerson.length === 0 ? "nothing is known about it"
          : "several readings compete",
      label: a.label,
    };
  }));
  const becomes = fired.filter((a) => {
    const np = a.profile.interpretations.filter((i) => i.id !== "person");
    return np.length === 1 && NON_SENSITIVE.has(np[0]!.id);
  });
  console.log(`\n    Of the 17, ${becomes.length} would join the removable population IF P-6 were consumed:`);
  console.log(`      ${becomes.map((a) => a.row.value).join(", ")}`);
  console.log("    The remainder keep a review purpose: nothing known, or several readings compete.");
}

/* ═══════════════ 5. THE PEOPLE SECTION ═══════════════ */

console.log("\n--- 5. ALL CANDIDATES CURRENTLY ROUTED TO PEOPLE ---");
{
  const people = AUDITED.filter((a) => a.row.section === "people");
  console.table(people.map((a) => {
    const classes = [...new Set(a.personSignals.map((s) => s.class))];
    const hasSpan = a.personScopes.includes("candidate-span");
    const shape = a.boundaryShape ? "likely extraction defect"
      : classes.length === 0 ? "no person signal (routed on quality categories alone)"
        : hasSpan && classes.length >= 2 ? "clearly review-worthy person"
          : a.readings.length > 1 ? "contested but review-worthy"
            : "weak person interpretation";
    return {
      value: a.row.value,
      occ: a.row.occurrenceCount,
      "person signal classes": classes.join(", ") || "(none)",
      scope: a.personScopes.join("+") || "-",
      "other readings": a.readings.filter((r) => r !== "person").join(", ") || "(none)",
      assessment: shape,
      boundary: a.boundaryShape ?? "",
      label: a.label,
    };
  }));
  const withBoundary = people.filter((a) => a.boundaryShape);
  console.log(`\n    ${people.length} in People; ${withBoundary.length} carry an extraction-defect shape.`);
  console.log("    NO DEMOTION RULE IS PROPOSED. This is measurement.");
}

/* ═══════════════ 6. EXTRACTION DEFECTS ═══════════════ */

console.log("\n--- 6. EXTRACTION / BOUNDARY DEFECT POPULATION ---");
console.log("    Shape observations from recomputed quality categories. Because the recomputation");
console.log("    has no document context, this UNDERSTATES the true population.");
{
  const defects = AUDITED.filter((a) => a.boundaryShape !== null);
  const byShape = new Map<string, Audited[]>();
  for (const a of defects) {
    const bucket = byShape.get(a.boundaryShape!) ?? [];
    bucket.push(a);
    byShape.set(a.boundaryShape!, bucket);
  }
  console.table([...byShape.entries()].sort((a, b) => b[1].length - a[1].length).map(([shape, group]) => ({
    shape,
    candidates: group.length,
    occurrences: group.reduce((s, a) => s + a.row.occurrenceCount, 0),
    "in People": group.filter((a) => a.row.section === "people").length,
    "person reading survives": group.filter((a) => a.personSignals.length > 0).length,
    examples: group.slice(0, 5).map((a) => a.row.value).join(", "),
  })));
  console.log(`\n    ${defects.length} of ${AUDITED.length} candidates (${((defects.length / AUDITED.length) * 100).toFixed(1)}%) show a boundary shape.`);
  console.log(`    ${defects.filter((a) => a.personSignals.length > 0).length} of those still carry a Person reading.`);
  console.log("\n    Review burden attributable to EXTRACTION vs SEMANTIC uncertainty:");
  const semanticOnly = AUDITED.filter((a) => a.boundaryShape === null && (a.bucket === "unsupported" || a.bucket === "contested-non-person"));
  console.table([
    { source: "extraction/boundary shape", candidates: defects.length },
    { source: "semantic uncertainty (unsupported or contested, clean span)", candidates: semanticOnly.length },
    { source: "neither -- explained or protective detection", candidates: AUDITED.length - defects.length - semanticOnly.length },
  ]);
}

/* ═══════════════ 7. POPULATIONS WORTH INVESTIGATING ═══════════════ */

console.log("\n--- 7. POPULATIONS WORTH INVESTIGATING NEXT (not proposed rules) ---");
{
  interface Population { id: string; predicate: (a: Audited) => boolean; monotone: string; needs: string }
  const POPULATIONS: Population[] = [
    {
      id: "R-1/uniquely-explained-non-sensitive",
      predicate: (a) => a.bucket === "uniquely-explained-non-sensitive",
      monotone: "yes -- adding any evidence can only add a reading, which removes the candidate from the population",
      needs: "confirm the non-sensitive class list with product; verify no document type makes date-or-term or acronym privacy-relevant",
    },
    {
      id: "R-2/uniquely-explained + P-6 applied",
      predicate: (a) => {
        if (a.bucket === "uniquely-explained-non-sensitive") return true;
        if (!a.p6Fires) return false;
        const np = a.profile.interpretations.filter((i) => i.id !== "person");
        return np.length === 1 && NON_SENSITIVE.has(np[0]!.id);
      },
      monotone: "yes, conditional on P-6 which is itself monotone",
      needs: "a routing decision to consume P-6 at all",
    },
    {
      id: "R-3/multi-occurrence uniquely explained",
      predicate: (a) => a.bucket === "uniquely-explained-non-sensitive" && a.row.occurrenceCount >= 3,
      monotone: "yes",
      needs: "whether occurrence count should modulate removal at all",
    },
    {
      id: "R-4/single-occurrence unsupported (NOT removable -- sized for contrast)",
      predicate: (a) => a.bucket === "unsupported" && a.row.occurrenceCount === 1,
      monotone: "n/a -- would rely on absence of evidence, which is forbidden",
      needs: "nothing; included to show how large the tempting-but-forbidden population is",
    },
  ];
  console.table(POPULATIONS.map((p) => {
    const g = AUDITED.filter(p.predicate);
    const labelled = g.filter((a) => a.label !== "?");
    return {
      population: p.id,
      size: g.length,
      "labelled people in it": labelled.filter((a) => a.label === "person").length,
      "labelled non-people": labelled.filter((a) => a.label === "non-person").length,
      "false-removal risk": labelled.filter((a) => a.label === "person").length > 0 ? "MEASURED NON-ZERO" : "none in labelled subset",
      monotone: p.monotone.startsWith("yes") ? "yes" : "no",
    };
  }));
  for (const p of POPULATIONS) console.log(`\n      ${p.id}\n        monotone: ${p.monotone}\n        needs: ${p.needs}`);
}

/* ═══════════════ 8. BLOCKERS ═══════════════ */

console.log("\n--- 8. WHAT PREVENTS FURTHER SAFE ELIMINATION ---");
{
  const remaining = AUDITED.filter((a) => a.bucket !== "uniquely-explained-non-sensitive");
  const blocker = (a: Audited): string => {
    if (a.bucket === "typed-pii-detection") return "protective typed detection -- reviewer's call by policy";
    if (a.boundaryShape) return "extraction boundary problem";
    if (a.bucket === "person-possible") {
      return a.personScopes.every((s) => s === "component") ? "person evidence is component-scoped only"
        : a.personScopes.includes("neighbourhood") && !a.personScopes.includes("candidate-span") ? "person evidence is neighbourhood-scoped only"
          : "possible PERSON / privacy relevance";
    }
    if (a.bucket === "contested-non-person") return "competing affirmative interpretations";
    if (a.bucket === "uniquely-explained-organizational") return "organizational reading may carry privacy weight";
    return "insufficient semantic evidence";
  };
  const byBlocker = new Map<string, Audited[]>();
  for (const a of remaining) {
    const b = blocker(a);
    const bucket = byBlocker.get(b) ?? [];
    bucket.push(a);
    byBlocker.set(b, bucket);
  }
  console.table([...byBlocker.entries()].sort((a, b) => b[1].length - a[1].length).map(([b, group]) => ({
    blocker: b,
    candidates: group.length,
    share: `${((group.length / remaining.length) * 100).toFixed(1)}%`,
    occurrences: group.reduce((s, a) => s + a.row.occurrenceCount, 0),
    examples: group.slice(0, 4).map((a) => a.row.value).join(", "),
  })));
}

console.log("\n=== END. Measurement only: nothing implemented, no rule proposed, no routing touched. ===");
