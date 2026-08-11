/**
 * interpretation-witnesses.ts -- INVESTIGATION ONLY. What the Phase A
 * interpretation model actually says about the measured collision populations
 * and about a real document's residue (AG, 2026-08-10).
 *
 *     node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs \
 *          investigation/interpretation-witnesses.ts
 *
 * ═══════════════════ WHAT THIS IS FOR ═══════════════════
 *
 * Phase A introduced a representation and NO rules. The only honest way to
 * judge a representation is to point it at populations that were measured
 * independently of it and ask whether it says anything useful about them.
 * That is all this does.
 *
 * ═══════════════════ WHAT IT IS NOT FOR ═══════════════════
 *
 * The witness categories below are NOT desired outcomes. Nothing here is
 * tuned until a witness produces a predetermined answer, and no threshold is
 * fitted to any number. `LIVE_RESIDUE`'s `truth` column is used ONLY to
 * describe what the model would be safe or unsafe about -- it is never an
 * input to a derivation, and there is no derivation here to feed it to.
 *
 * ═══════════════════ THE ABLATION (§5) ═══════════════════
 *
 * Several unrelated evidence families landed within days of each other, so a
 * mechanism can look useful merely by being present when they all arrived.
 * §5 re-derives the same population with channels removed, so each family's
 * actual contribution to the interpretation model is separable.
 *
 * Read-only: imports the shipped derivation and prints. Changes no state,
 * writes no file, and is not part of the verification battery.
 */

import { referenceEvidenceFor, type ReferenceEvidenceChannels } from "../src/engines/knowledge/ReferenceEvidence.js";
import { interpretCandidate, type InterpretationFacts } from "../src/engines/interpretation/candidate-interpretation.js";
import {
  contestKey,
  contestsPerson,
  interpretationIdsOf,
  type InterpretationProfile,
} from "../src/engines/interpretation/interpretation-model.js";
import { LIVE_RESIDUE } from "./live-residue.data.js";

/* ─────────────────────── fact construction ─────────────────────── */

/**
 * A candidate with NO pipeline evidence -- only its phrase.
 *
 * This is the honest default for an investigation harness: quality
 * categories, contextual rules and entity linkage are per-document facts that
 * do not exist outside a loaded document, and inventing plausible-looking
 * ones would measure the invention rather than the model. Where a section
 * below needs pipeline evidence it says so and supplies it explicitly.
 */
function bare(value: string, over: Partial<InterpretationFacts> = {}): InterpretationFacts {
  return {
    candidateId: `w:${value}`,
    displayValue: value,
    detectedType: "person",
    qualityCategories: [],
    positiveReasons: [],
    relationshipKinds: [],
    contextualRules: [],
    hasPersonEvidencedLinkage: false,
    reference: referenceEvidenceFor(value),
    ...over,
  };
}

const readings = (p: InterpretationProfile): string =>
  p.interpretations.map((i) => (i.domain === undefined ? i.id : `${i.id}[${i.domain}]`)).join(" + ") || "(none)";

const personClasses = (p: InterpretationProfile): string =>
  (p.interpretations.find((i) => i.id === "person")?.signals ?? []).map((s) => s.class).join("/") || "";

/* ─────────────────────── 1. the prescribed witness sets ─────────────────────── */

console.log("=== INTERPRETATION WITNESSES (Phase A -- no rules exist) ===");

const WITNESS_SETS: Array<{ label: string; note: string; values: string[] }> = [
  {
    label: "1a. terminology x Census, single token",
    note: "The dominant collision class: 187 of 779 single-token phrases in the terminology universe.",
    values: ["Major", "White", "Course", "Session", "Claim", "Appeal", "Race", "Credit", "Degree", "School", "Role"],
  },
  {
    label: "1b. terminology x Census, multi-token",
    note: "Phrases that are attested vocabulary AND parse as personal-name structures.",
    values: ["active judge", "Blood Cell Count", "cash flow", "basic pay", "Clock hour", "CAGE Code", "Chief Information Officer"],
  },
  {
    label: "1c. GNIS x Census",
    note: "Real witnesses from the 36,119-key measurement. All are strong GNIS matches carrying name structure.",
    values: ["ABE YARBROUGH", "ABRAMS WAY", "ABRAHAM ACRES", "AARONS CREEK", "ABERDEEN PARK", "ABELL CITY"],
  },
  {
    label: "1d. cross-domain terminology",
    note: "Vocabulary two or three independent packs attest. No person or place involved in most.",
    values: ["Appeal", "Arbitration", "Beneficiary", "Claim", "Assets", "Equity", "Depreciation"],
  },
  {
    label: "1e. acronym ambiguity",
    note: "Short forms whose meaning is local to the attesting source and domain.",
    values: ["ADA", "FMLA", "ADR", "ERISA", "SAM", "MAC", "ERA", "CAGE"],
  },
  {
    label: "1f. controls -- should NOT be contested",
    note: "Unambiguous person, unambiguous terminology, and a phrase nothing attests.",
    values: ["Yazmine Guzmán", "Cost of Attendance", "Satisfactory Academic Progress", "Zathras Quorbelfrimp"],
  },
];

for (const set of WITNESS_SETS) {
  console.log(`\n--- ${set.label} ---`);
  console.log(`    ${set.note}`);
  console.table(
    set.values.map((value) => {
      const profile = interpretCandidate(bare(value));
      return {
        phrase: value,
        outcome: profile.outcome,
        readings: readings(profile),
        personSupportClasses: personClasses(profile),
      };
    })
  );
}

console.log("\n    NOTE: these carry NO pipeline evidence -- no quality categories, no contextual");
console.log("    rules, no entity linkage. They show what the REFERENCE datasets alone support.");
console.log("    In a loaded document the same phrases gain lexicon, context and document signals.");

/* ─────────────────────── 2. the same witnesses WITH pipeline evidence ─────────────────────── */

console.log("\n--- 2. THE SAME COLLISION, WITH REALISTIC PIPELINE EVIDENCE ADDED ---");
console.log("    The question a combination layer must answer is not what the datasets say in");
console.log("    isolation, but what happens when document context speaks too. Both overlays are");
console.log("    applied to the SAME phrase so the difference is attributable to the context alone.");
{
  const rows: Array<Record<string, unknown>> = [];
  for (const value of ["Major", "Claim", "White", "Clock hour", "ABE YARBROUGH"]) {
    rows.push({
      phrase: value,
      overlay: "no context",
      readings: readings(interpretCandidate(bare(value))),
    });
    rows.push({
      phrase: value,
      overlay: "+ person context (title, anchor)",
      readings: readings(
        interpretCandidate(bare(value, { positiveReasons: ["nearby_title"], contextualRules: ["anchor_full_name_with_role"] }))
      ),
    });
    rows.push({
      phrase: value,
      overlay: "+ document-local vocabulary",
      readings: readings(
        interpretCandidate(
          bare(value, {
            crossCandidate: {
              candidateId: `w:${value}`,
              rules: ["token_recurrence"],
              tokenShare: 5,
              sharedToken: value.split(" ")[0]!.toLowerCase(),
              sharedTokenWitnesses: [],
              headShare: 0,
              headWitnesses: [],
            },
          })
        )
      ),
    });
  }
  console.table(rows);
  console.log("    Every added signal ADDS a reading. None removes one -- there is no mechanism");
  console.log("    in Phase A that could, which is the property the whole design turns on.");
}

/* ─────────────────────── 3. the live residue ─────────────────────── */

console.log("\n--- 3. LIVE RESIDUE: 139 real units from a real document ---");
console.log("    `truth` is Andrew's reading, used ONLY to describe safety below. It is never an input.");
{
  const profiles = LIVE_RESIDUE.map((unit) => ({ unit, profile: interpretCandidate(bare(unit.value)) }));

  const byOutcome = new Map<string, { person: number; nonPerson: number; unknown: number }>();
  for (const { unit, profile } of profiles) {
    const bucket = byOutcome.get(profile.outcome) ?? { person: 0, nonPerson: 0, unknown: 0 };
    if (unit.truth === "person") bucket.person += 1;
    else if (unit.truth === "non-person") bucket.nonPerson += 1;
    else bucket.unknown += 1;
    byOutcome.set(profile.outcome, bucket);
  }
  console.table([...byOutcome.entries()].map(([outcome, b]) => ({
    outcome,
    total: b.person + b.nonPerson + b.unknown,
    "truth: person": b.person,
    "truth: non-person": b.nonPerson,
    "truth: ?": b.unknown,
  })));

  const contested = profiles.filter((p) => p.profile.outcome === "contested");
  console.log(`\n    ${contested.length} contested units, grouped by what collides:`);
  const byKey = new Map<string, Array<{ value: string; truth: string }>>();
  for (const { unit, profile } of contested) {
    const key = contestKey(profile);
    const bucket = byKey.get(key) ?? [];
    bucket.push({ value: unit.value, truth: unit.truth });
    byKey.set(key, bucket);
  }
  console.table([...byKey.entries()].sort((a, b) => b[1].length - a[1].length).map(([key, group]) => ({
    collision: key,
    units: group.length,
    people: group.filter((g) => g.truth === "person").length,
    nonPeople: group.filter((g) => g.truth === "non-person").length,
    examples: group.slice(0, 5).map((g) => g.value).join(", "),
  })));

  /*
   * THE SAFETY QUESTION, ASKED THE ONLY WAY IT CAN HONESTLY BE ASKED.
   *
   * If some future rule were allowed to demote a person reading that rests
   * ONLY on token membership, which real people would it hit? That number is
   * the cost of such a rule, and it should be known before anyone writes one.
   */
  const tokenOnlyPerson = profiles.filter(({ profile }) => {
    const person = profile.interpretations.find((i) => i.id === "person");
    return person !== undefined && person.signals.every((s) => s.class === "token-membership");
  });
  console.log(`\n    Person readings resting ONLY on token membership: ${tokenOnlyPerson.length}`);
  console.log(`      of which Andrew read as REAL PEOPLE: ${tokenOnlyPerson.filter((p) => p.unit.truth === "person").length}`);
  console.log(`      of which Andrew read as non-people:  ${tokenOnlyPerson.filter((p) => p.unit.truth === "non-person").length}`);
  console.log("    A demotion rule keyed on that class alone would cost the first number.");
  console.table(tokenOnlyPerson.slice(0, 20).map(({ unit, profile }) => ({
    value: unit.value,
    truth: unit.truth,
    readings: readings(profile),
  })));

  const unsupported = profiles.filter((p) => p.profile.outcome === "unsupported");
  console.log(`\n    Unsupported (thin evidence, NOT ambiguity): ${unsupported.length}`);
  console.log(`      real people among them: ${unsupported.filter((p) => p.unit.truth === "person").length}`);
  console.log("    These are the candidates a review product must NOT quietly drop: no evidence");
  console.log("    is not evidence of nothing. Reference data alone cannot see them.");
  console.table(unsupported.slice(0, 15).map(({ unit }) => ({ value: unit.value, truth: unit.truth })));
}

/* ─────────────────────── 4. person-contested detail ─────────────────────── */

console.log("\n--- 4. PERSON-CONTESTED UNITS IN THE LIVE RESIDUE ---");
{
  const rows = LIVE_RESIDUE.map((unit) => ({ unit, profile: interpretCandidate(bare(unit.value)) }))
    .filter(({ profile }) => contestsPerson(profile));
  console.table(rows.slice(0, 30).map(({ unit, profile }) => ({
    value: unit.value,
    truth: unit.truth,
    readings: interpretationIdsOf(profile).join(" + "),
    personSupport: personClasses(profile),
  })));
  console.log(`    ${rows.length} units where a person reading competes with something else.`);
}

/* ─────────────────────── 5. ablation ─────────────────────── */

/**
 * Re-derive the residue with channels selectively silenced.
 *
 * The silencing is done on the CHANNELS value, not by editing any dataset:
 * a channel is replaced with its own "found nothing" shape, which is exactly
 * what the provider returns on a miss. So each row below answers "what would
 * this model say if that family had never shipped".
 */
function silence(channels: ReferenceEvidenceChannels, keep: {
  census?: boolean; gnis?: boolean; terminology?: boolean;
}): ReferenceEvidenceChannels {
  return {
    ...channels,
    censusName: keep.census ? channels.censusName : { structure: "none", roles: [], supportsNameStructure: false },
    gnisPlace: keep.gnis
      ? channels.gnisPlace
      : { strength: "none", normalized: "", featureClasses: [], censusPersonStructure: false, source: channels.gnisPlace.source },
    higherEdTerminology: keep.terminology ? channels.higherEdTerminology : null,
    medicalTerminology: keep.terminology ? channels.medicalTerminology : null,
    financeAccountingTax: keep.terminology ? channels.financeAccountingTax : null,
    legalTerminology: keep.terminology ? channels.legalTerminology : null,
    employmentHr: keep.terminology ? channels.employmentHr : null,
    governmentPublicAdmin: keep.terminology ? channels.governmentPublicAdmin : null,
  };
}

console.log("\n--- 5. ABLATION: what each family actually contributes ---");
{
  const CONFIGS: Array<{ label: string; keep: { census?: boolean; gnis?: boolean; terminology?: boolean } }> = [
    { label: "no reference evidence", keep: {} },
    { label: "Census only", keep: { census: true } },
    { label: "GNIS only", keep: { gnis: true } },
    { label: "terminology only", keep: { terminology: true } },
    { label: "all eight (shipped)", keep: { census: true, gnis: true, terminology: true } },
  ];

  console.table(CONFIGS.map(({ label, keep }) => {
    let unsupported = 0;
    let single = 0;
    let contested = 0;
    let personReadings = 0;
    let tokenOnly = 0;
    for (const unit of LIVE_RESIDUE) {
      const channels = silence(referenceEvidenceFor(unit.value), keep);
      const profile = interpretCandidate(bare(unit.value, { reference: channels }));
      if (profile.outcome === "unsupported") unsupported += 1;
      else if (profile.outcome === "single") single += 1;
      else contested += 1;
      const person = profile.interpretations.find((i) => i.id === "person");
      if (person) {
        personReadings += 1;
        if (person.signals.every((s) => s.class === "token-membership")) tokenOnly += 1;
      }
    }
    return { config: label, unsupported, single, contested, personReadings, "person via token-membership only": tokenOnly };
  }));

  console.log("    Read the `contested` column against `unsupported`: a family earns its place by");
  console.log("    converting silence into a NAMED competing reading, not by raising a hit count.");
}

/* ─────────────────────── 6. performance ─────────────────────── */

console.log("\n--- 6. PERFORMANCE: the interpretation layer alone ---");
{
  const sample = LIVE_RESIDUE.map((u) => bare(u.value));
  for (let i = 0; i < 2000; i += 1) interpretCandidate(sample[i % sample.length]!);
  const iterations = 50_000;
  const t0 = performance.now();
  for (let i = 0; i < iterations; i += 1) interpretCandidate(sample[i % sample.length]!);
  const t1 = performance.now();
  const perCandidateUs = ((t1 - t0) * 1000) / iterations;

  /* The realistic shape: reference channels are computed ONCE per candidate by
   * Workspace and reused, so the marginal cost of the interpretation layer is
   * what is measured above -- derivation only. The end-to-end number includes
   * the channel fan-out for comparison. */
  const t2 = performance.now();
  for (let i = 0; i < iterations; i += 1) {
    const value = LIVE_RESIDUE[i % LIVE_RESIDUE.length]!.value;
    interpretCandidate(bare(value));
  }
  const t3 = performance.now();
  const endToEndUs = ((t3 - t2) * 1000) / iterations;

  console.table([{
    "derivation only µs/candidate": Number(perCandidateUs.toFixed(2)),
    "with channel fan-out µs/candidate": Number(endToEndUs.toFixed(2)),
    "569-candidate derivation ms": Number(((perCandidateUs * 569) / 1000).toFixed(2)),
    "2,000-candidate derivation ms": Number(((perCandidateUs * 2000) / 1000).toFixed(2)),
  }]);
  console.log("    Computed once per candidate at load and stored. Navigating between review");
  console.log("    items recomputes nothing -- the map is read, never rebuilt.");
}

console.log("\n=== END. No rule was introduced and no dataset was tuned. ===");
