/**
 * identity-cleanup-verification.ts -- Identity-candidate cleanup pass
 * (2026-08-02, Andrew's "phrase fragments should never become reviewer
 * options" refinement). Node-verifiable core: token evidence
 * classification, bigram fragment suppression, trigram cleaning with the
 * known-name relabel gate, real-group / knowledge-backed exemptions,
 * duplicate collapsing, empty-proposal dropping, and the non-person
 * passthrough. The empirical before/after against Andrew's real
 * transcript lives in the findings narrative (design-notes v2026-08-02.09);
 * this suite pins the RULES.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/identity-cleanup-verification.ts
 */

import { classifyIdentityToken, cleanupIdentityOptions, insertedWordNameProposals } from "../src/engines/entity-resolution/identity-cleanup.ts";
import { preferredActionsForRelationship } from "../src/ui/preferredActions.ts";
import type { GroupingResult } from "../src/engines/EntityResolutionEngine.ts";
import type { DetectionResult } from "../src/engines/DetectionEngine.ts";
import type { Candidate } from "../src/domain/DocumentModel.ts";

let passCount = 0;
let failCount = 0;
function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passCount += 1;
    console.log(`  PASS ${label}`);
  } else {
    failCount += 1;
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

console.log("--- token evidence classification ---");
check("verbs/interjections/greetings/fragments are ordinary", ["can", "are", "yes", "thanks"].every((t) => classifyIdentityToken(t) === "ordinary"));
check('additive sentence-context lexicon covers "afternoon" (the Margaret Afternoon class)', classifyIdentityToken("afternoon") === "ordinary");
check("unknown capitalized tokens are NOT ordinary (real surnames: miller/collier/perias)", ["Miller", "Collier", "Perias", "Yamada"].every((t) => classifyIdentityToken(t) === "unknown"));
check("known names classify as names", ["andrew", "diana", "margaret"].every((t) => classifyIdentityToken(t) === "name"));
check('ambiguous lexical tokens ("Will") are exempt from ordinary', classifyIdentityToken("will") !== "ordinary");

// --- fixture builders -------------------------------------------------
const person = (id: string, displayValue: string): Candidate =>
  ({ id, displayValue, detectedType: "person", occurrenceIds: ["o1"] }) as unknown as Candidate;
const detectionOf = (...candidates: Candidate[]): DetectionResult => ({ candidates }) as unknown as DetectionResult;
const groupingOf = (proposals: GroupingResult["ambiguityProposals"], groups: GroupingResult["entityGroupProposals"] = []): GroupingResult =>
  ({ schemaVersion: 1, ambiguityProposals: proposals, entityGroupProposals: groups }) as GroupingResult;
const option = (groupId: string, canonicalName: string, evidence?: string[]) => ({ groupId, canonicalName, confidence: 80, ...(evidence ? { evidence } : {}) });
const proposal = (candidateId: string, options: ReturnType<typeof option>[]) => ({
  candidateId,
  candidateGroupIds: options.map((o) => o.groupId),
  candidateGroupOptions: options,
});
const knownNameCats = (id: string) => (cats: Record<string, string[]>) => cats[id] ?? [];

console.log("--- bigram fragment suppression ---");
{
  const det = detectionOf(person("p:diana", "Diana"));
  const cats = { "p:diana": ["known_first_name"] };
  const out = cleanupIdentityOptions(groupingOf([proposal("p:diana", [option("yes:d", "Diana Yes")])]), det, knownNameCats("p:diana") ? (id) => cats[id as keyof typeof cats] ?? [] : () => []);
  check('"Diana Yes" suppressed; emptied proposal dropped', out.ambiguityProposals.length === 0);
}

console.log("--- trigram cleaning: known-name candidate gets the cleaned identity ---");
{
  const det = detectionOf(person("p:tanesha", "Tanesha"));
  const cats: Record<string, string[]> = { "p:tanesha": ["known_first_name"] };
  const out = cleanupIdentityOptions(groupingOf([proposal("p:tanesha", [option("cc:t", "Tanesha Can Collier"), option("c:t", "Tanesha Can")])]), det, (id) => cats[id] ?? []);
  const opts = out.ambiguityProposals[0]?.candidateGroupOptions ?? [];
  check('"Tanesha Can Collier" -> "Tanesha Collier"; "Tanesha Can" suppressed', opts.length === 1 && opts[0]!.canonicalName === "Tanesha Collier");
}

console.log("--- relabel gate: non-name candidates never receive invented identities ---");
{
  const det = detectionOf(person("p:good", "Good"));
  const cats: Record<string, string[]> = { "p:good": ["expanded_common_language_token"] };
  const out = cleanupIdentityOptions(
    groupingOf([proposal("p:good", [option("gma:g", "Good Morning Andrew"), option("gm:g", "Good Morning")])]),
    det,
    (id) => cats[id] ?? []
  );
  const opts = out.ambiguityProposals[0]?.candidateGroupOptions ?? [];
  // "Good Morning" (bigram, ordinary tail) suppressed; the trigram would
  // clean to the Frankenstein "Good Andrew" -- the gate keeps it VERBATIM.
  check('"Good Morning" suppressed; "Good Morning Andrew" kept verbatim (no "Good Andrew")', opts.length === 1 && opts[0]!.canonicalName === "Good Morning Andrew");
}

console.log("--- exemptions ---");
{
  const det = detectionOf(person("p:andrew", "Andrew"));
  const cats: Record<string, string[]> = { "p:andrew": ["known_first_name"] };
  const realGroup = [{ groupId: "g:goodloe", candidateIds: ["m1", "m2"], originalProposalConfidence: 62, canonicalName: "Andrew Are Goodloe", detectedType: "person", memberConfidences: {}, reasons: [] }];
  const out = cleanupIdentityOptions(
    groupingOf([proposal("p:andrew", [option("g:goodloe", "Andrew Are Goodloe"), option("t:a", "Andrew Thanks"), option("kb:a", "Andy Goodloe", ["Related name: andy <-> andrew"])])], realGroup),
    det,
    (id) => cats[id] ?? []
  );
  const names = (out.ambiguityProposals[0]?.candidateGroupOptions ?? []).map((o) => o.canonicalName);
  check("real-group option exempt (label belongs to Group Check); knowledge-backed exempt; solitary junk suppressed", names.join("|") === "Andrew Are Goodloe|Andy Goodloe");
}

console.log("--- duplicate collapsing prefers the already-clean identity ---");
{
  const det = detectionOf(person("p:t", "Tanesha"));
  const cats: Record<string, string[]> = { "p:t": ["known_first_name"] };
  const out = cleanupIdentityOptions(
    groupingOf([proposal("p:t", [option("noisy:t", "Tanesha Can Collier"), option("clean:t", "Tanesha Collier")])]),
    det,
    (id) => cats[id] ?? []
  );
  const opts = out.ambiguityProposals[0]?.candidateGroupOptions ?? [];
  check("one surviving option, pointing at the already-clean anchor", opts.length === 1 && opts[0]!.groupId === "clean:t");
}

console.log("--- non-person proposals pass through untouched ---");
{
  const det = detectionOf({ id: "p:x", displayValue: "X-1", detectedType: "long_numeric_id", occurrenceIds: [] } as unknown as Candidate);
  const input = groupingOf([proposal("p:x", [option("o:x", "Whatever Phrase Yes")])]);
  const out = cleanupIdentityOptions(input, det, () => []);
  check("non-person proposal unchanged", out.ambiguityProposals.length === 1 && out.ambiguityProposals[0]!.candidateGroupOptions[0]!.canonicalName === "Whatever Phrase Yes");
}

console.log("--- candidateGroupIds stay in sync with surviving options ---");
{
  const det = detectionOf(person("p:m", "Margaret"));
  const cats: Record<string, string[]> = { "p:m": ["known_first_name"] };
  const out = cleanupIdentityOptions(groupingOf([proposal("p:m", [option("c:m", "Margaret Chris"), option("a:m", "Margaret Afternoon")])]), det, (id) => cats[id] ?? []);
  const p = out.ambiguityProposals[0]!;
  check('"Margaret Afternoon" suppressed; ids mirror options', p.candidateGroupOptions.length === 1 && p.candidateGroupIds.join(",") === p.candidateGroupOptions.map((o) => o.groupId).join(","));
}

console.log('--- "Probable Name with Inserted Word" proposals (AG decision 2, 2026-08-02) ---');
{
  const group = (groupId: string, canonicalName: string, candidateIds: string[], detectedType = "person") => ({
    groupId,
    candidateIds,
    originalProposalConfidence: 70,
    canonicalName,
    detectedType,
    memberConfidences: {},
    reasons: [],
  });
  const det = detectionOf(person("p:tanesha", "Tanesha"), person("m1", "Collier, Tanesha"), person("m2", "Collier,   Tanesha  Can"));
  const cats: Record<string, string[]> = { "p:tanesha": ["known_first_name"] };
  const grounded = groupingOf(
    [proposal("p:tanesha", [option("g:tc", "Tanesha Can Collier")])],
    [group("g:tc", "Tanesha Can Collier", ["m1", "m2"])]
  );
  const proposals = insertedWordNameProposals(grounded, det, (id) => cats[id] ?? []);
  check("qualifying group yields one proposal over its members", proposals.length === 1 && proposals[0]!.candidateIds.join(",") === "m1,m2");
  check('suggestedReplacement is the cleaned display-order identity ("Tanesha Collier")', proposals[0]!.suggestedReplacement === "Tanesha Collier");
  check("kind + content-derived id", proposals[0]!.kind === "inserted-word-name" && proposals[0]!.proposalId === "inserted-word-name:g:tc");
  check("observation and evidence are human sentences naming the inserted word", proposals[0]!.observation.includes('"Tanesha Collier"') && proposals[0]!.evidence.includes('"Can"'));
  // Preferred action: label IS the resulting state, executing bulk Change.
  const members = [person("m1", "Collier, Tanesha"), person("m2", "Collier,   Tanesha  Can")];
  const actions = preferredActionsForRelationship(proposals[0]!, members);
  check("primary preferred action = the cleaned name via bulk-change", actions.length === 1 && actions[0]!.label === "Tanesha Collier" && actions[0]!.op.kind === "bulk-change" && actions[0]!.op.replacement === "Tanesha Collier");
  // Grounding gate: without a known-name ambiguity candidate pointing at
  // the group, no proposal (stops product/institution phrase groups).
  check("ungrounded group yields nothing", insertedWordNameProposals(grounded, det, () => []).length === 0);
  // Nothing inserted -> nothing proposed.
  const cleanGroup = groupingOf([proposal("p:tanesha", [option("g:clean", "Tanesha Collier")])], [group("g:clean", "Tanesha Collier", ["m1"])]);
  check("a clean group name yields nothing", insertedWordNameProposals(cleanGroup, det, (id) => cats[id] ?? []).length === 0);
  // Non-person groups are out of scope.
  const orgGroup = groupingOf([proposal("p:tanesha", [option("g:org", "Enrollment Can Systems")])], [group("g:org", "Enrollment Can Systems", ["m1"], "org")]);
  check("non-person group yields nothing", insertedWordNameProposals(orgGroup, det, (id) => cats[id] ?? []).length === 0);
}

console.log(`\n${passCount}/${passCount + failCount} checks passed`);
process.exitCode = failCount === 0 ? 0 : 1;
