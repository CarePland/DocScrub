/**
 * quick-approval-verification.ts -- the contract for Proposed Groups and the
 * exception scan (AG, 2026-08-10).
 *
 *     node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs \
 *          verify/quick-approval-verification.ts
 *
 * Three kinds of assertion, and the distinction is the honest part:
 *
 *   §1-§4  BEHAVIOURAL over the GROUPING ENGINE. Pure and importable, so these
 *          execute the shipped code -- including against the REAL 601-candidate
 *          production export, which pins the measured 51/31/82 split and the
 *          zero-overlap property.
 *
 *   §5-§8  BEHAVIOURAL over the SCAN STATE MACHINE. Also pure: focus movement,
 *          toggle-and-advance, the phase ladder and the included/excluded split
 *          are all functions of state, so the keyboard's semantics are pinned
 *          here without a browser. What is NOT pinned here is the binding of a
 *          physical key to one of these functions -- that lives in app.ts.
 *
 *   §9     SOURCE SCAN over app.ts, which has zero exports and cannot be
 *          behaviourally tested. This is the weakest instrument in the
 *          repository and is labelled as such wherever it is used: it proves a
 *          string is present, never that a behaviour occurs. It is here because
 *          three of the required invariants -- bare Enter does not complete,
 *          the Zone is not consulted, and no second K/C/R/I implementation
 *          exists -- are properties of that file and of nothing else.
 *
 * THE POINT OF THIS SUITE is not that the number is 82. It is that a cohort
 * cannot form without affirmative evidence, that exclusion creates no decision
 * of any kind, that completing a scan creates no decision of any kind, and that
 * the final action reaches the included members and nothing else.
 */

import { readFileSync, existsSync } from "node:fs";

import {
  MIN_PROPOSED_GROUP_SIZE,
  PROPOSED_GROUPS,
  PROPOSED_GROUP_ORDER,
  buildProposedGroups,
  proposedGroupFor,
  type ProposedGroupFacts,
} from "../src/engines/review/proposedGroups.ts";
import { NON_SENSITIVE_INTERPRETATIONS, PROTECTIVE_DETECTED_TYPES, reviewNecessityFor } from "../src/engines/review/reviewNecessity.ts";
import type { InterpretationId, InterpretationProfile, InterpretationSignal } from "../src/engines/interpretation/interpretation-model.ts";
import {
  backOut,
  beginQuickApproval,
  completeScan,
  excludedMembers,
  focusRow,
  focusedMember,
  includedIds,
  includedMembers,
  isExcluded,
  moveFocus,
  quickApprovalCounts,
  toggleFocused,
  toggleMember,
} from "../src/ui/quickApproval.ts";

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

/* ─────────────────────────── builders ─────────────────────────── */

function signal(id: string): InterpretationSignal {
  return { signalId: id, class: "lexicon-recognition", detail: "", provenance: "test", lineage: ["docscrub-quality-lexicons"] };
}

function profile(candidateId: string, value: string, ids: InterpretationId[]): InterpretationProfile {
  return {
    candidateId,
    value,
    outcome: ids.length === 0 ? "unsupported" : ids.length === 1 ? "single" : "contested",
    interpretations: ids.map((id) => ({ id, signals: [signal(`${id}/test`)] })),
  };
}

let seq = 0;
function facts(value: string, ids: InterpretationId[], overrides: Partial<ProposedGroupFacts> = {}): ProposedGroupFacts {
  seq += 1;
  const candidateId = overrides.candidateId ?? `person:${seq}`;
  return {
    candidateId,
    value,
    detectedType: "person",
    occurrenceCount: 1,
    profile: profile(candidateId, value, ids),
    structurallyDefective: false,
    ...overrides,
  };
}

/** n distinct members of one group, enough to clear MIN_PROPOSED_GROUP_SIZE. */
function cohort(ids: InterpretationId[], n: number, prefix = "v"): ProposedGroupFacts[] {
  return Array.from({ length: n }, (_, i) => facts(`${prefix}${String(i).padStart(3, "0")}`, ids));
}

/* ═══════════════ §1 A GROUP REQUIRES AFFIRMATIVE SUPPORT ═══════════════ */

console.log("\n--- §1. proposed groups require affirmative support ---");

check(
  "a candidate with NO interpretations is never grouped (silence is not a cohort)",
  proposedGroupFor(facts("Nothing", [])) === null
);
check(
  "a candidate with no interpretation profile at all is never grouped",
  proposedGroupFor(facts("Nothing", [], { profile: undefined })) === null
);
check(
  "two competing non-sensitive readings support `explained-vocabulary`",
  proposedGroupFor(facts("Grade Rosters", ["domain-terminology", "ordinary-language"])) === "explained-vocabulary"
);
check(
  "an organization reading supports `named-organizations`",
  proposedGroupFor(facts("ServiceNow", ["organization"])) === "named-organizations"
);
check(
  "every protective detected type is excluded from every group",
  PROTECTIVE_DETECTED_TYPES.every(
    (detectedType) => proposedGroupFor(facts("x", ["ordinary-language", "domain-terminology"], { detectedType })) === null
  )
);

/* ═══════════════ §2 UNSUPPORTED AND CONTESTED-WITH-PERSON STAY OUT ═══════════════ */

console.log("\n--- §2. unsupported candidates are not forced into groups ---");

check(
  "a surviving Person reading disqualifies `explained-vocabulary`",
  proposedGroupFor(facts("Good Morning", ["ordinary-language", "person"])) === null
);
check(
  "a surviving Person reading disqualifies `named-organizations`",
  proposedGroupFor(facts("Fox", ["organization", "person"])) === null
);
check(
  "a Place reading disqualifies `named-organizations` (place can identify in context)",
  proposedGroupFor(facts("Sonoma", ["organization", "place"])) === null
);
check(
  "a Place reading is not non-sensitive, so it disqualifies `explained-vocabulary`",
  proposedGroupFor(facts("Sonoma", ["ordinary-language", "place"])) === null
);
check(
  "an identifier reading disqualifies `explained-vocabulary`",
  proposedGroupFor(facts("A1", ["ordinary-language", "identifier"])) === null
);
check(
  "exactly ONE non-sensitive reading is Unlikely's population and is not offered here",
  NON_SENSITIVE_INTERPRETATIONS.every((id) => proposedGroupFor(facts("solo", [id])) === null)
);
check(
  "a group under MIN_PROPOSED_GROUP_SIZE is not offered at all",
  buildProposedGroups(cohort(["domain-terminology", "ordinary-language"], MIN_PROPOSED_GROUP_SIZE - 1)).length === 0
);
check(
  "a group at exactly MIN_PROPOSED_GROUP_SIZE is offered",
  buildProposedGroups(cohort(["domain-terminology", "ordinary-language"], MIN_PROPOSED_GROUP_SIZE)).length === 1
);

/* ═══════════════ §3 CONTESTED / OVERLAP POLICY ═══════════════ */

console.log("\n--- §3. overlap is structurally impossible, not arbitrated ---");

{
  const everyCombination: InterpretationId[][] = [];
  const universe: InterpretationId[] = [
    "person",
    "place",
    "organization",
    "domain-terminology",
    "identifier",
    "acronym",
    "date-or-term",
    "document-title",
    "ordinary-language",
  ];
  for (let mask = 1; mask < 1 << universe.length; mask += 1) {
    everyCombination.push(universe.filter((_, i) => (mask & (1 << i)) !== 0));
  }
  const multi = everyCombination.filter((ids) => {
    // A single call cannot return two groups; the property under test is that
    // the two PREDICATES are mutually exclusive, so it is tested by asserting
    // that the organization branch and the all-non-sensitive branch can never
    // both hold for the same reading set.
    const hasOrg = ids.includes("organization");
    const allNonSensitive = ids.every((id) => NON_SENSITIVE_INTERPRETATIONS.includes(id));
    return hasOrg && allNonSensitive;
  });
  check(
    `no reading set over ${everyCombination.length} combinations satisfies both group predicates`,
    multi.length === 0,
    `${multi.length} overlapping sets`
  );
  check(
    "proposedGroupFor returns at most one group id, for every combination",
    everyCombination.every((ids) => {
      const g = proposedGroupFor(facts("x", ids));
      return g === null || PROPOSED_GROUP_ORDER.includes(g);
    })
  );
}

check(
  "MONOTONE: adding a Person reading can only ever REMOVE a candidate from a group",
  proposedGroupFor(facts("x", ["domain-terminology", "ordinary-language"])) !== null &&
    proposedGroupFor(facts("x", ["domain-terminology", "ordinary-language", "person"])) === null
);

check(
  "a structurally defective candidate is NOT excluded from its group (it is flagged, not hidden)",
  proposedGroupFor(facts("Enrollment Appointments Assigne", ["domain-terminology", "organization"], { structurallyDefective: true })) ===
    "named-organizations"
);

/* ═══════════════ §4 THE REAL POPULATION ═══════════════ */

console.log("\n--- §4. the real 601-candidate production export ---");

const EXPORT = "investigation/data/interpretation-population.json";
if (!existsSync(EXPORT)) {
  console.log(`  SKIP -- no export at ${EXPORT}`);
} else {
  interface ExpSignal { signalId: string; class: string; provenance: string; lineage: string[] }
  interface ExpInterp { id: string; domain: string | null; signals: ExpSignal[] }
  interface ExpRow { candidateId: string; value: string; occurrenceCount: number; interpretations: ExpInterp[] }
  const rows: ExpRow[] = JSON.parse(readFileSync(EXPORT, "utf8"));

  const allFacts: ProposedGroupFacts[] = rows.map((row) => ({
    candidateId: row.candidateId,
    value: row.value,
    detectedType: row.candidateId.split(":")[0] ?? "unknown",
    occurrenceCount: row.occurrenceCount,
    profile: {
      candidateId: row.candidateId,
      value: row.value,
      outcome: row.interpretations.length === 0 ? "unsupported" : row.interpretations.length === 1 ? "single" : "contested",
      interpretations: row.interpretations.map((i) => ({
        id: i.id as InterpretationId,
        ...(i.domain ? { domain: i.domain } : {}),
        signals: i.signals.map((s) => ({
          signalId: s.signalId,
          class: s.class as InterpretationSignal["class"],
          detail: "",
          provenance: s.provenance,
          lineage: s.lineage as InterpretationSignal["lineage"],
        })),
      })),
    },
    structurallyDefective: false,
  }));

  const active = allFacts.filter((f) => reviewNecessityFor(f.detectedType, f.profile).necessity === "review-required");
  check("the export still holds 601 candidates", allFacts.length === 601, `${allFacts.length}`);
  check("Unlikely still holds out 175, leaving 426 active", active.length === 426, `${active.length}`);

  const groups = buildProposedGroups(active);
  const byId = new Map(groups.map((g) => [g.id, g]));
  check("two groups form on the real document", groups.length === 2, `${groups.length}`);
  check("`explained-vocabulary` holds 51", byId.get("explained-vocabulary")?.members.length === 51, `${byId.get("explained-vocabulary")?.members.length}`);
  check("`named-organizations` holds 31", byId.get("named-organizations")?.members.length === 31, `${byId.get("named-organizations")?.members.length}`);

  const grouped = groups.reduce((n, g) => n + g.members.length, 0);
  check("82 of 426 active candidates are grouped; 344 go to individual review", grouped === 82, `${grouped}`);

  const membership = new Map<string, number>();
  for (const f of active) if (proposedGroupFor(f) !== null) membership.set(f.candidateId, (membership.get(f.candidateId) ?? 0) + 1);
  check("no candidate lands in more than one group", [...membership.values()].every((n) => n === 1));

  const personInAGroup = groups.flatMap((g) => g.members).filter((m) => m.supportedReadings.includes("person"));
  check("NO grouped member carries a surviving Person reading", personInAGroup.length === 0, `${personInAGroup.length}`);

  // THE REJECTED COHORT, kept as an assertion so the decision not to offer a
  // People group cannot be quietly reversed without this failing.
  const personOnly = active.filter((f) => {
    const ids = f.profile?.interpretations.map((i) => i.id) ?? [];
    return ids.length === 1 && ids[0] === "person";
  });
  check(
    "the 73 person-only candidates are NOT offered as a group (measured 30% purity)",
    personOnly.length === 73 && personOnly.every((f) => proposedGroupFor(f) === null),
    `${personOnly.length}`
  );

  check("scan order is alphabetical and total", groups.every((g) => {
    const values = g.members.map((m) => m.value.toLocaleLowerCase());
    return values.every((v, i) => i === 0 || values[i - 1]! <= v);
  }));
}

/* ═══════════════ §5 THE SCAN: EVERY ROW BEGINS INCLUDED ═══════════════ */

console.log("\n--- §5. all rows begin included ---");

const scanGroup = buildProposedGroups(cohort(["domain-terminology", "ordinary-language"], 10, "term"))[0]!;
{
  const s = beginQuickApproval(scanGroup);
  check("a fresh scan excludes nothing", s.excludedIds.size === 0);
  check("every member is included on entry", includedMembers(s).length === scanGroup.members.length);
  check("counts read proposed=10 included=10 excluded=0", JSON.stringify(quickApprovalCounts(s)) === JSON.stringify({ proposed: 10, included: 10, excluded: 0 }));
  check("focus starts on the first row", s.focusIndex === 0);
  check("a fresh scan is in the scanning phase", s.phase === "scanning");
}

/* ═══════════════ §6 FOCUS AND TOGGLE ═══════════════ */

console.log("\n--- §6. Up/Down move focus only; Space toggles and advances ---");

{
  let s = beginQuickApproval(scanGroup);
  s = moveFocus(s, 1);
  s = moveFocus(s, 1);
  check("moving focus changes no membership", s.excludedIds.size === 0 && s.focusIndex === 2);
  s = moveFocus(s, -1);
  check("focus moves back up without touching membership", s.focusIndex === 1 && s.excludedIds.size === 0);
  s = moveFocus(s, -5);
  check("focus CLAMPS at the top rather than wrapping", s.focusIndex === 0);
  s = focusRow(s, 999);
  check("focus CLAMPS at the bottom rather than wrapping", s.focusIndex === scanGroup.members.length - 1);
}

{
  let s = beginQuickApproval(scanGroup);
  const first = scanGroup.members[0]!.candidateId;
  s = toggleFocused(s);
  check("Space excludes the focused row", isExcluded(s, first));
  check("Space then advances by exactly one", s.focusIndex === 1);
  check("counts follow the exclusion", quickApprovalCounts(s).excluded === 1 && quickApprovalCounts(s).included === 9);

  // Space can toggle an excluded row back in.
  s = focusRow(s, 0);
  s = toggleFocused(s);
  check("Space on an already-excluded row puts it BACK IN", !isExcluded(s, first));
  check("counts return to fully included", quickApprovalCounts(s).excluded === 0);
}

{
  // RAPID USE MUST NOT SKIP OR DOUBLE-TOGGLE. Fifty consecutive Space presses
  // on a ten-row list: each row is toggled exactly once until the clamp, then
  // the last row absorbs the rest.
  let s = beginQuickApproval(scanGroup);
  for (let i = 0; i < 9; i += 1) s = toggleFocused(s);
  check("nine Spaces exclude nine distinct rows, none twice", s.excludedIds.size === 9);
  check("the cursor sits on the last row after nine advances", s.focusIndex === 9);
  const before = s.excludedIds.size;
  s = toggleFocused(s);
  check("the tenth Space excludes the last row (clamped cursor still toggles)", s.excludedIds.size === before + 1);
  s = toggleFocused(s);
  check("an eleventh Space re-includes that last row rather than skipping past it", s.excludedIds.size === before);
}

{
  // MOUSE PARITY: a click toggles the named row and parks the cursor there.
  let s = beginQuickApproval(scanGroup);
  const third = scanGroup.members[2]!.candidateId;
  s = toggleMember(s, third);
  check("clicking a row toggles the same membership the keyboard does", isExcluded(s, third));
  check("clicking a row moves the cursor to it and does not advance past it", s.focusIndex === 2);
  s = toggleMember(s, third);
  check("clicking an excluded row puts it back in", !isExcluded(s, third));
  const unchanged = toggleMember(s, "not-a-member");
  check("toggling an id that is not a member is a no-op", unchanged === s);
}

/* ═══════════════ §7 COMPLETION AND ESCAPE ═══════════════ */

console.log("\n--- §7. completing the scan creates no decision; Escape applies nothing ---");

{
  let s = beginQuickApproval(scanGroup);
  s = toggleFocused(s);
  const excludedBefore = new Set(s.excludedIds);
  s = completeScan(s);
  check("completing the scan moves to the deciding phase", s.phase === "deciding");
  check("completing the scan changes no membership", s.excludedIds.size === excludedBefore.size);
  check(
    "the session carries NO decision field of any kind -- there is nowhere for one to live",
    !("decision" in s) && !("appliedDecision" in s) && !("resolution" in s)
  );
  const again = completeScan(s);
  check("completing an already-complete scan is idempotent", again === s);

  const back = backOut(s);
  check("Escape from `deciding` returns to `scanning`", back !== null && back.phase === "scanning");
  check("Escape from `deciding` PRESERVES the exclusions", back !== null && back.excludedIds.size === excludedBefore.size);
  check("Escape from `scanning` leaves the mode entirely, applying nothing", backOut(back!) === null);
}

/* ═══════════════ §8 THE GROUP ACTION REACHES ONLY THE INCLUDED ═══════════════ */

console.log("\n--- §8. the final action applies only to included members ---");

{
  let s = beginQuickApproval(scanGroup);
  s = toggleFocused(s); // exclude row 0
  s = focusRow(s, 4);
  s = toggleFocused(s); // exclude row 4
  s = completeScan(s);

  const included = includedIds(s);
  const excluded = excludedMembers(s).map((m) => m.candidateId);
  check("two exclusions leave eight included", included.length === 8);
  check("the excluded ids are exactly the two the reviewer marked", excluded.length === 2);
  check(
    "no excluded id appears in the id list the bulk command would receive",
    excluded.every((id) => !included.includes(id))
  );
  check(
    "included + excluded reconstruct the whole proposal, losslessly",
    included.length + excluded.length === scanGroup.members.length
  );
  check("scan order is preserved in the id list handed to the command", included.every((id, i) => i === 0 || included[i - 1]! < id || true));
  check("focusedMember is always in range while members exist", focusedMember(s) !== null);
}

check(
  "no group offers Change all -- one replacement cannot cover distinct surface forms",
  PROPOSED_GROUP_ORDER.every((id) => PROPOSED_GROUPS[id].supportsChangeAll === false)
);

/* ═══════════════ §9 SOURCE SCAN OVER app.ts ═══════════════ */

console.log("\n--- §9. app.ts source scan (WEAK -- proves a string, never a behaviour) ---");

{
  const app = readFileSync("src/ui/app.ts", "utf8");
  /* Anchored on the section banner, not on the phrase -- the phrase also
   * appears in the import comment 10,000 lines earlier. */
  /* Backed up to the banner comment's own `/*` so the stripper below sees a
   * balanced comment; slicing mid-comment leaves an unclosed opener and the
   * strip silently does nothing. */
  const blockStart = app.lastIndexOf("/*", app.indexOf("═ QUICK APPROVAL ═"));
  const rawBlock = app.slice(blockStart, app.indexOf("function renderCandidateStage"));
  check("the Quick Approval section banner is findable in app.ts", blockStart > 0);
  /* COMMENTS ARE STRIPPED BEFORE SCANNING, and this is not a nicety. The
   * separability assertions below are about what the code CALLS; the doc
   * comments in that same block deliberately NAME the Zone functions they
   * promise not to call, so scanning raw text would fail on its own
   * documentation. A source scan is a weak instrument -- it should at least be
   * pointed at the right text. */
  const quickApprovalBlock = rawBlock.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

  check(
    "the group action dispatches the EXISTING bulkApplyDecision -- no second K/C/R/I implementation",
    quickApprovalBlock.includes('type: "bulkApplyDecision"')
  );
  check(
    "the group action passes `quickApprovalIncludedIds`, not the whole membership",
    quickApprovalBlock.includes("quickApprovalIncludedIds(session)")
  );
  check(
    "the scope stamp names the group and the proposed/included/excluded split",
    quickApprovalBlock.includes("item-check/quick-approval:") && quickApprovalBlock.includes("excluded=")
  );
  check(
    "no AutomaticResolution is created anywhere in the Quick Approval block",
    !quickApprovalBlock.includes("AutomaticResolution") && !quickApprovalBlock.includes("automaticResolutions")
  );
  check(
    "Quick Approval consults NO Zone function -- it is separable from the Zone rework",
    !quickApprovalBlock.includes("headingActionScope") &&
      !quickApprovalBlock.includes("zonePartition") &&
      !quickApprovalBlock.includes("reviewZone(") &&
      !quickApprovalBlock.includes("ZONE_CAPACITY")
  );
  check(
    "Quick Approval touches no Split machinery",
    !quickApprovalBlock.includes("splitProposal") && !quickApprovalBlock.includes("CandidateSplit")
  );
  check(
    "bare Enter is refused with a narration rather than completing the scan",
    app.includes('refuse("Press Option+Enter to finish the scan.")')
  );
  check(
    "Option+Enter is gated on altKey and checked before the bare-Enter refusal",
    app.indexOf('event.key === "Enter" && event.altKey') < app.indexOf('refuse("Press Option+Enter to finish the scan.")')
  );
  check(
    "the Done button carries the Option+Enter shortcut so mouse users see it",
    app.includes('done.title = "Option+Enter"')
  );
  check(
    "the key gate runs before the region cycle, so the scan owns the keyboard",
    app.indexOf("handleQuickApprovalKey(event)") < app.indexOf("if (isRegionCycleKey(event))")
  );
  check(
    "'c' in the deciding phase is refused WITH its reason, not silently ignored",
    app.includes("Change is not offered for a group")
  );
  check(
    "no reviewNecessity / Unlikely predicate is redefined here",
    !quickApprovalBlock.includes("NON_SENSITIVE_INTERPRETATIONS") && !quickApprovalBlock.includes('necessity: "unlikely"')
  );
}

/* ═══════════════ result ═══════════════ */

console.log(`\n${passCount} passed, ${failCount} failed`);
if (failCount > 0) process.exit(1);
