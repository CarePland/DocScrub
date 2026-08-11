/**
 * reference-evidence-verification.ts (AG, 2026-08-10).
 *
 * Verifies the CROSS-FAMILY layer: that several independent reference
 * datasets can attest the same phrase simultaneously, that gathering them
 * resolves nothing, and that the determination path survives the gathering.
 *
 * ══════════════ THE ONE PROPERTY THIS SUITE EXISTS FOR ══════════════
 *
 * Multiple evidence families may independently attest the same phrase, and
 * DocScrub must be able to hold that without picking a winner. Every
 * assertion below is shaped to fail if precedence, weighting, or a collapsing
 * summary field ever appears in `ReferenceEvidence.ts`.
 *
 * The suite is deliberately written to be ROBUST TO NEW FAMILIES: it asserts
 * on named channels and never on channel counts, because packs are being
 * integrated concurrently and a suite that breaks when a colleague adds
 * Medical or Employment/HR is a suite that will be weakened to make it pass.
 *
 * Run:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs \
 *        verify/reference-evidence-verification.ts
 */

import {
  attestingChannels,
  referenceEvidenceAuditRows,
  referenceEvidenceFor,
  terminologyChannelsOf,
} from "../src/engines/knowledge/ReferenceEvidence.js";
import { censusRoleFor } from "../src/engines/knowledge/CensusNameEvidence.js";

let passed = 0;
let failed = 0;
function check(label: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    passed += 1;
    console.log(`  PASS ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

console.log("\n--- 1. THE FAN-OUT ASKS EVERY CHANNEL ---");
{
  const e = referenceEvidenceFor("adjusted gross income");
  check("the phrase is preserved verbatim", e.value, "adjusted gross income");
  check("finance attested", e.financeAccountingTax !== null, true);
  check("legal did not attest", e.legalTerminology, null);
  check("higher-ed did not attest", e.higherEdTerminology, null);
  console.log("    -- census and GNIS always return a record; their own fields say 'nothing found' --");
  check("census record present", typeof e.censusName.supportsNameStructure, "boolean");
  check("census found no name structure here", e.censusName.supportsNameStructure, false);
  check("gnis record present", typeof e.gnisPlace.strength, "string");
  check("gnis found no place here", e.gnisPlace.strength, "none");
}

/*
 * ============================================================================
 * 2. SIMULTANEOUS ATTESTATION BY INDEPENDENT FAMILIES
 * ============================================================================
 *
 * `ADR` is the sharpest case in the repository. The SEC attests it as an
 * American Depositary Receipt. The federal judiciary attests it as
 * Alternative Dispute Resolution. Same string, two authorities, unrelated
 * meanings, both rows correct.
 *
 * NOTHING PICKS BETWEEN THEM, and that is the assertion.
 */
console.log("\n--- 2. TWO FAMILIES ATTEST THE SAME PHRASE, UNRESOLVED ---");
{
  const e = referenceEvidenceFor("ADR");
  check("finance attests ADR", e.financeAccountingTax !== null, true);
  check("legal attests ADR", e.legalTerminology !== null, true);
  check("finance reads it as a securities instrument",
    e.financeAccountingTax?.attestations[0]?.acronymExpansion, "American Depositary Receipt");
  check("legal reads it as dispute resolution",
    e.legalTerminology?.attestations[0]?.parentTerm, "Alternative dispute resolution (ADR)");
  console.log("    -- and the gathered result contains NO field that resolves the conflict --");
  const collapsing = Object.keys(e).filter((k) => /winner|best|primary|resolved|score|weight|rank|precedence|mostlikely|type$/i.test(k));
  check("no precedence/weight/winner field on the channels struct", collapsing, []);
  check("both channels are simply present", [e.financeAccountingTax?.family, e.legalTerminology?.family],
    ["finance-accounting-tax", "legal-terminology"]);
  console.log("    -- attestingChannels lists both, in declaration order, which is NOT a ranking --");
  const channels = attestingChannels(e);
  check("finance is listed", channels.includes("finance-accounting-tax"), true);
  check("legal is listed", channels.includes("legal-terminology"), true);
}

console.log("\n--- 3. TERMINOLOGY EVIDENCE ALONGSIDE PERSON EVIDENCE ---");
console.log("    -- the case that must never become 'therefore not a person' --");
for (const phrase of ["Doe", "Levy", "Chambers"]) {
  const e = referenceEvidenceFor(phrase);
  const role = censusRoleFor(phrase);
  check(`${phrase}: legal terminology AND a Census name token`,
    [e.legalTerminology !== null, (role?.firstAttested ?? false) || (role?.surnameAttested ?? false)], [true, true]);
  check(`${phrase}: both are reported, neither is suppressed`,
    [e.legalTerminology?.attestations.length! > 0, role !== null], [true, true]);
}
for (const phrase of ["stock", "bond", "credit"]) {
  const e = referenceEvidenceFor(phrase);
  const role = censusRoleFor(phrase);
  check(`${phrase}: finance terminology AND a Census name token`,
    [e.financeAccountingTax !== null, (role?.firstAttested ?? false) || (role?.surnameAttested ?? false)], [true, true]);
}

console.log("\n--- 4. NOTHING ATTESTED IS NOT A NEGATIVE FINDING ---");
{
  const e = referenceEvidenceFor("Zathras Quorbelfrimp");
  check("no terminology channel attested", attestingChannels(e).filter((c) => c.includes("terminology") || c === "finance-accounting-tax"), []);
  check("the phrase is still preserved", e.value, "Zathras Quorbelfrimp");
  console.log("    -- and no field anywhere says 'not a person' / 'not a place' / 'unknown type' --");
  const negatives = Object.keys(e).filter((k) => /^not|isnot|excluded|rejected|suppress/i.test(k));
  check("no negative-finding field exists to be misread", negatives, []);
}

/*
 * ============================================================================
 * 5. THE AUDIT TRAIL -- the property Andrew asked for by name
 * ============================================================================
 *
 * "auditability of results to make sure we can improve whatever path will
 * fail down the line."
 *
 * So: for any hit, ONE flat row must carry the whole determination path, with
 * no pointers into the object graph it came from. If a pack gets something
 * wrong, this row is what says which dataset, which authority, which
 * published term, and whether that term was directly attested or derived --
 * i.e. exactly which CSV row to fix.
 */
console.log("\n--- 5. THE DETERMINATION PATH IS RECONSTRUCTIBLE FROM ONE FLAT ROW ---");
{
  const rows = referenceEvidenceAuditRows(referenceEvidenceFor("motion for summary judgment"));
  check("exactly one attesting row", rows.length, 1);
  const r = rows[0]!;
  check("value", r.value, "motion for summary judgment");
  check("evidence family", r.evidenceFamily, "legal-terminology");
  check("source family", r.sourceFamily, "STATE_JUDICIARY_GLOSSARY");
  check("source is named", r.source.length > 0, true);
  check("source URL is present", r.sourceUrl.startsWith("https://"), true);
  check("matched term, verbatim", r.matchedTerm, "Motion for Summary Judgment");
  check("normalized key", r.normalizedTerm, "motion for summary judgment");
  check("semantic hints", r.semanticHints, "DOCUMENT|COURT_PROCEDURE");
  check("source-attested", r.sourceAttested, true);
  check("derived variant", r.derivedVariant, false);
  check("collision risk", r.collisionRisk, "LOW");
  console.log("    -- every field needed to locate and fix the source row is present --");
  const missing = (["value", "evidenceFamily", "sourceFamily", "source", "sourceUrl", "matchedTerm", "normalizedTerm", "collisionRisk"] as const)
    .filter((k) => r[k] === undefined || r[k] === null || r[k] === "");
  check("no empty required provenance field", missing, []);
}
console.log("    -- a phrase attested by two families yields one row per family --");
{
  const rows = referenceEvidenceAuditRows(referenceEvidenceFor("ADR"));
  const families = rows.map((r) => r.evidenceFamily).sort();
  check("both families produce their own audit row", families.includes("finance-accounting-tax") && families.includes("legal-terminology"), true);
  check("and each row carries its OWN source, not a merged one",
    new Set(rows.map((r) => r.sourceFamily)).size >= 2, true);
  console.log("    -- derived rows stay attributable to their parent --");
  const derivedRow = rows.find((r) => r.derivedVariant);
  check("the legal ADR row is derived and names its parent",
    [derivedRow?.evidenceFamily, derivedRow?.parentTerm],
    ["legal-terminology", "Alternative dispute resolution (ADR)"]);
}
console.log("    -- a phrase with multiple authorities in ONE family yields one row each --");
{
  const rows = referenceEvidenceAuditRows(referenceEvidenceFor("interest"));
  const finance = rows.filter((r) => r.evidenceFamily === "finance-accounting-tax");
  check("four separately attributable finance rows", finance.length, 4);
  check("four distinct authorities", new Set(finance.map((r) => r.sourceFamily)).size, 4);
  check("sub-domain distinguishes the tax reading from the finance one",
    new Set(finance.map((r) => r.subDomain)), new Set(["FINANCE", "TAX"]));
}
console.log("    -- and a miss produces no rows, rather than a row saying 'no' --");
check("no audit rows for an unattested phrase", referenceEvidenceAuditRows(referenceEvidenceFor("Zathras Quorbelfrimp")).length, 0);

console.log("\n--- 6. THE UNIFORM VIEW IS A VIEW, NOT A COLLAPSE ---");
{
  const channels = referenceEvidenceFor("interest");
  const view = terminologyChannelsOf(channels);
  const finance = view.find((v) => v.id === "finance-accounting-tax");
  check("the view reports the finance channel", finance?.evidence !== null, true);
  check("and summarises row count without discarding the rows", finance?.evidence?.attestationRows, 4);
  check("the underlying record still carries every attestation", channels.financeAccountingTax?.attestations.length, 4);
  console.log("    -- the view exposes no attestations of its own, by design --");
  check("no attestations field on the view", Object.keys(finance?.evidence ?? {}).includes("attestations"), false);
  console.log("    -- and every family is represented, hit or miss, so a miss is measurable --");
  check("channels with no hit are present with evidence: null",
    view.every((v) => v.evidence === null || typeof v.evidence.matchedTerm === "string"), true);
  check("every view entry has a stable id", view.every((v) => v.id.length > 0), true);
}

console.log("\n--- 7. EACH CHANNEL KEEPS ITS OWN NORMALIZATION ---");
console.log("    -- the same phrase is keyed differently per family, which is CORRECT --");
{
  // `Form 10-K` keeps its hyphen under the finance policy. If a future change
  // unified the normalizers onto the higher-ed policy (punctuation -> space),
  // this key would silently become `form 10 k` and the shipped rows would stop
  // matching. That is the drift this assertion exists to catch.
  const e = referenceEvidenceFor("Form 10-K");
  check("finance keeps the hyphen in its key", e.financeAccountingTax?.normalized, "form 10-k");
  const cm = referenceEvidenceFor("CM / ECF");
  check("legal strips spaces around the slash in its key", cm.legalTerminology?.normalized, "cm/ecf");
}

console.log(`\n=== cross-family reference evidence: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exitCode = 1;
