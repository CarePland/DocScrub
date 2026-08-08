/**
 * visible-list-advance-verification.ts -- RX-02b (Reviewer Experience
 * Wave 1, 2026-07-29). Pure-function suite for
 * src/ui/visibleListAdvance.ts's advanceWithinVisibleList(): the
 * post-decision advance computed over the DISPLAYED order (forward, then
 * backward, then stay; never wrapping), with the backward fallback that is
 * RX-12's acceptance criterion.
 *
 * Everything here is DOM-free by construction -- an id array, a current id,
 * and a resolved-predicate in; an id (or null = remain in place) out.
 * "Sorted" and "narrowed" visible lists are represented exactly the way the
 * caller passes them: as id arrays whose order/membership differ from
 * structural order, since the helper deliberately knows nothing about WHY
 * the list is ordered or narrowed the way it is. What this suite cannot
 * cover (browser-only, disclosed per standing practice): that app.ts's
 * dispatchReviewWithVisibleAdvance snapshots/dispatches/re-selects
 * correctly around this helper -- that path runs through the live
 * dispatcher and DOM render.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/visible-list-advance-verification.ts
 */

import {
  adjacentReviewTarget,
  advanceWithinReviewTargets,
  advanceWithinVisibleList,
  candidateReviewTarget,
  proposalReviewTarget,
  reviewDisplayTargetKey,
  sectionCandidateTargetGroups,
  sectionDisplayTargets,
  sectionGridSequence,
  sectionProposalTargets,
  type ReviewDisplayTarget,
  type ReviewTargetSection,
} from "../src/ui/visibleListAdvance.js";

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

function checkAdvance(label: string, actual: string | null, expected: string | null): void {
  check(label, actual === expected, `expected ${expected === null ? "null (remain)" : expected}, got ${actual === null ? "null (remain)" : actual}`);
}

const resolvedIn = (resolved: string[]) => (id: string) => resolved.includes(id);
const targetKeys = (targets: readonly ReviewDisplayTarget[]): string[] => targets.map(reviewDisplayTargetKey);
const resolvedTargetsIn = (resolved: string[]) => (target: ReviewDisplayTarget) => resolved.includes(reviewDisplayTargetKey(target));
const checkTargetAdvance = (label: string, current: string | null, targets: readonly ReviewDisplayTarget[], resolved: string[], expected: string | null): void => {
  const actual = advanceWithinReviewTargets(current, targets, resolvedTargetsIn(resolved));
  checkAdvance(label, actual ? reviewDisplayTargetKey(actual) : null, expected);
};
const c = (id: string) => candidateReviewTarget(id);
const p = (id: string) => proposalReviewTarget(id);

console.log("--- visible-order advancement (forward) ---");
checkAdvance(
  "advances to the NEXT visible item when it is unresolved",
  advanceWithinVisibleList("b", ["a", "b", "c", "d"], resolvedIn(["b"])),
  "c"
);
checkAdvance(
  "skips resolved items moving forward to the nearest unresolved one",
  advanceWithinVisibleList("a", ["a", "b", "c", "d"], resolvedIn(["a", "b", "c"])),
  "d"
);
checkAdvance(
  "starts strictly AFTER the current item (never re-lands on it)",
  advanceWithinVisibleList("b", ["a", "b", "c"], resolvedIn(["a", "b"])),
  "c"
);

console.log("--- backward fallback (RX-12's acceptance criterion) ---");
checkAdvance(
  "falls back to the nearest EARLIER unresolved item when nothing is unresolved ahead",
  advanceWithinVisibleList("d", ["a", "b", "c", "d"], resolvedIn(["c", "d"])),
  "b"
);
checkAdvance(
  "backward fallback picks the NEAREST earlier item, not the first in the list",
  advanceWithinVisibleList("d", ["a", "b", "c", "d"], resolvedIn(["d"])),
  "c"
);
checkAdvance(
  "last-item decision with several unresolved above lands on the closest one above",
  advanceWithinVisibleList("e", ["a", "b", "c", "d", "e"], resolvedIn(["b", "d", "e"])),
  "c"
);

console.log("--- all visible items resolved: remain in place ---");
checkAdvance(
  "returns null (remain on the current item) when every visible item is resolved",
  advanceWithinVisibleList("b", ["a", "b", "c"], resolvedIn(["a", "b", "c"])),
  null
);
checkAdvance("single-item list, that item resolved: remain", advanceWithinVisibleList("a", ["a"], resolvedIn(["a"])), null);

console.log("--- no wrapping (unlike ']'/'[', which wrap by design) ---");
checkAdvance(
  "deciding the last item does NOT wrap to an unresolved first item when items between are resolved -- backward finds the nearest above instead",
  advanceWithinVisibleList("d", ["a", "b", "c", "d"], resolvedIn(["b", "c", "d"])),
  "a"
);
checkAdvance(
  "from the FIRST item, never wraps to the end: forward only",
  advanceWithinVisibleList("a", ["a", "b", "c"], resolvedIn(["a", "b"])),
  "c"
);
checkAdvance(
  "from the last item with nothing unresolved anywhere, no wrap-and-spin: remain",
  advanceWithinVisibleList("c", ["a", "b", "c"], resolvedIn(["a", "b", "c"])),
  null
);

console.log("--- sorted visible lists (order-following, not structural) ---");
// Structural order is a,b,c,d; the reviewer's alphabetical sort displays
// them as d,c,b,a. Advancement must follow the DISPLAYED order.
checkAdvance(
  "follows the displayed (sorted) order, not the structural one",
  advanceWithinVisibleList("d", ["d", "c", "b", "a"], resolvedIn(["d"])),
  "c"
);
checkAdvance(
  "sorted list, forward exhausted: backward fallback also follows displayed order",
  advanceWithinVisibleList("b", ["d", "c", "b", "a"], resolvedIn(["b", "a"])),
  "c"
);

console.log("--- narrowed visible lists (filter active) ---");
// Structural pool a..f; the active filter shows only [b, e, f]. The
// just-decided item was snapshotted pre-decision, so it is still present.
checkAdvance(
  "advances only within the narrowed membership -- hidden items can never be landed on",
  advanceWithinVisibleList("b", ["b", "e", "f"], resolvedIn(["b"])),
  "e"
);
checkAdvance(
  "narrowed list fully resolved: remain, even if hidden structural items are unresolved (the predicate only ever sees visible ids)",
  advanceWithinVisibleList("f", ["b", "e", "f"], resolvedIn(["b", "e", "f"])),
  null
);

console.log("--- defensive edges ---");
checkAdvance("empty visible list: null", advanceWithinVisibleList("a", [], resolvedIn([])), null);
checkAdvance(
  "null currentId scans the whole list forward from the start",
  advanceWithinVisibleList(null, ["a", "b", "c"], resolvedIn(["a"])),
  "b"
);
checkAdvance(
  "currentId absent from the list scans forward from the start (no backward leg exists)",
  advanceWithinVisibleList("zz", ["a", "b", "c"], resolvedIn(["a"])),
  "b"
);

console.log("--- parity with navigator.ts findByPredicate(dir: 'forward') semantics ---");
// Same scan discipline as the domain's own advance (forward from idx+1,
// then backward from idx-1), minus its final remain-in-place fallback,
// which the caller expresses as `?? currentId`.
checkAdvance(
  "forward-then-backward ordering: a nearer BACKWARD candidate never beats an available forward one",
  advanceWithinVisibleList("c", ["a", "b", "c", "d", "e"], resolvedIn(["c", "d"])),
  "e"
);

console.log("--- SEPARATION: the anchor itself LEAVES the list (AG, 2026-08-03 regression) ---");
// "Separate these" is the one action that removes a row from view as a
// side effect of deciding it. The choke point's own last resort -- remain
// on the item just decided -- therefore parked focus on a group that no
// longer rendered, which reads to the reviewer as "there is no focused
// item at all". completeSplitReview re-anchors on the removed group's
// PREDECESSOR against the post-hide list; these pin that composition.
{
  const before = ["g1", "g2", "g3"]; // g2 is the one being separated
  const afterHide = ["g1", "g3"];
  checkAdvance(
    "unresolved work remains: focus continues FORWARD from the separated group's position, never onto the hidden group",
    advanceWithinVisibleList("g1", afterHide, resolvedIn(["g1", "g2"])),
    "g3"
  );
  checkAdvance(
    "everything resolved: returns null, so the caller falls back to a VISIBLE anchor rather than the hidden one",
    advanceWithinVisibleList("g1", afterHide, resolvedIn(["g1", "g2", "g3"])),
    null
  );
  checkAdvance(
    "the separated group is the FIRST row: a null anchor scans from the start of what is left",
    advanceWithinVisibleList(null, ["g2", "g3"], resolvedIn(["g1"])),
    "g2"
  );
  checkAdvance(
    "an anchor that was itself hidden earlier resolves to -1 and still scans the whole remaining list",
    advanceWithinVisibleList("gone", afterHide, resolvedIn(["g1"])),
    "g3"
  );
  check(
    "the hidden group can never be the landing, in any of these",
    [
      advanceWithinVisibleList("g1", afterHide, resolvedIn(["g1", "g2"])),
      advanceWithinVisibleList("g1", afterHide, resolvedIn(["g1", "g2", "g3"])),
      advanceWithinVisibleList("gone", afterHide, resolvedIn(["g1"])),
    ].every((landing) => landing !== "g2"),
    ""
  );
  check("the pre-hide order still knows where the separated group was", before.indexOf("g2") === 1 && before[before.indexOf("g2") - 1] === "g1", "");
}

console.log("--- unified review targets: candidates plus proposals ---");
{
  const acronyms = [c("may"), p("its-acronym"), p("csu-acronym"), c("num-1"), c("other")];
  checkTargetAdvance(
    "final candidate in a mixed category advances to an unresolved proposal in that same category",
    "candidate:may",
    acronyms,
    ["candidate:may"],
    "proposal:its-acronym"
  );
  checkTargetAdvance(
    "resolving the last proposal in a kind advances to later unresolved Numeric work, not completed Other Words",
    "proposal:csu-acronym",
    acronyms,
    ["candidate:may", "proposal:its-acronym", "proposal:csu-acronym", "candidate:other"],
    "candidate:num-1"
  );
  checkTargetAdvance(
    "fully completed categories between two incomplete categories are skipped",
    "candidate:first",
    [c("first"), c("done-a"), p("done-p"), c("next")],
    ["candidate:first", "candidate:done-a", "proposal:done-p"],
    "candidate:next"
  );
  checkTargetAdvance(
    "proposal-only category participates in the same advancement order",
    "candidate:before",
    [c("before"), p("only-proposal"), c("after")],
    ["candidate:before"],
    "proposal:only-proposal"
  );
  checkTargetAdvance(
    "candidate-only category remains ordinary candidate advancement",
    "candidate:one",
    [c("one"), c("two")],
    ["candidate:one"],
    "candidate:two"
  );
  checkTargetAdvance(
    "completion of the final remaining target in a stage returns null",
    "proposal:last",
    [c("done"), p("last")],
    ["candidate:done", "proposal:last"],
    null
  );
  checkTargetAdvance(
    "structural-card completion can move out to mixed review content after it",
    "proposal:rel",
    [c("before"), p("rel"), c("numeric")],
    ["candidate:before", "proposal:rel"],
    "candidate:numeric"
  );
}

/* ----------------------------------------------------------------------
 * SECTION-COMPLETION ANCHORING (2026-08-07 completion-path audit).
 *
 * `advanceAfterSectionCompletion` continues from the completed section's
 * LAST member. Two ways that went wrong, both reproduced here as pure
 * properties of the helper the app.ts path delegates to.
 * -------------------------------------------------------------------- */
console.log("--- section completion: the anchor must be a review-target KEY ---");
{
  // Numeric (unresolved, earlier) / Institutional (just completed) / Fall
  // (unresolved, next) -- the 2026-08-02 NAV-ORDER report's own shape.
  const stageTargets = [c("numeric-1"), c("inst-1"), c("inst-2"), c("fall-1")];
  const resolved = ["candidate:inst-1", "candidate:inst-2"];
  checkTargetAdvance(
    "a namespaced anchor continues to the work AFTER the completed section",
    "candidate:inst-2",
    stageTargets,
    resolved,
    "candidate:fall-1"
  );
  /* THE DEFECT THIS PINS. app.ts's fallback used to hand back a BARE
   * candidate id ("inst-2") while every key here is namespaced. indexOf
   * misses, the forward scan restarts at index 0, and the reviewer is thrown
   * back to the first unresolved target in the STAGE -- past Institutional,
   * all the way up to Numeric. Asserting the WRONG landing is deliberate:
   * it documents that a non-key anchor is silently accepted, which is
   * exactly why the call site must never produce one. */
  checkTargetAdvance(
    "a bare candidate id does NOT anchor -- it silently restarts the scan at the top",
    "inst-2",
    stageTargets,
    resolved,
    "candidate:numeric-1"
  );
  check(
    "so the two spellings disagree, which is the whole bug",
    advanceWithinReviewTargets("candidate:inst-2", stageTargets, resolvedTargetsIn(resolved))?.id !==
      advanceWithinReviewTargets("inst-2", stageTargets, resolvedTargetsIn(resolved))?.id
  );
}

console.log("--- section completion: the anchor must come from the PRE-decision list ---");
{
  /* Under a review-state filter ("Unreviewed only"), completing a section
   * removes its candidates from the post-decision model entirely. Anchoring
   * in the POST list therefore finds nothing under EITHER spelling --
   * namespacing alone does not save it -- and the scan restarts at the top.
   * The fix is to anchor and advance within the PRE-decision snapshot,
   * reading the post-decision state only for resolved-ness. */
  const pre = [c("numeric-1"), c("inst-1"), c("inst-2"), c("fall-1")];
  const postFiltered = [c("numeric-1"), c("fall-1")]; // Institutional filtered away
  const resolved = ["candidate:inst-1", "candidate:inst-2"];
  checkTargetAdvance(
    "advancing over the PRE-decision snapshot lands on the next section",
    "candidate:inst-2",
    pre,
    resolved,
    "candidate:fall-1"
  );
  checkTargetAdvance(
    "advancing over the POST-decision list loses the anchor and restarts at the top",
    "candidate:inst-2",
    postFiltered,
    resolved,
    "candidate:numeric-1"
  );
  check(
    "the completed section is genuinely absent from the post-decision list",
    !targetKeys(postFiltered).includes("candidate:inst-2") && targetKeys(pre).includes("candidate:inst-2")
  );
  // The backward fallback still applies from a pre-snapshot: a section
  // completed at the BOTTOM of the stage carries the reviewer back up to
  // remaining work above it rather than stranding them.
  checkTargetAdvance(
    "completing the last section carries the cursor back to earlier remaining work",
    "candidate:tail-2",
    [c("numeric-1"), c("tail-1"), c("tail-2")],
    ["candidate:tail-1", "candidate:tail-2"],
    "candidate:numeric-1"
  );
}

console.log("--- section completion: proposals are part of what a section completes ---");
{
  /* A mixed category (candidates + an acronym pair). Clearing the candidate
   * rows must NOT report the category complete while its proposal is still
   * unaddressed -- the cursor continues into the proposal, in the same
   * category, before moving on. This is the "Keep as-is on MAY jumped to
   * Institutional, skipping the remaining Acronyms" report. */
  const acronymsThenInstitutional = [c("may"), p("its-acronym"), c("inst-1")];
  checkTargetAdvance(
    "clearing a category's candidates continues into its own unaddressed proposal",
    "candidate:may",
    acronymsThenInstitutional,
    ["candidate:may"],
    "proposal:its-acronym"
  );
  checkTargetAdvance(
    "only once the proposal is addressed does the cursor leave the category",
    "proposal:its-acronym",
    acronymsThenInstitutional,
    ["candidate:may", "proposal:its-acronym"],
    "candidate:inst-1"
  );
  /* Bulk-accepting a kind group with unresolved work EARLIER in the stage:
   * the backward fallback carries the reviewer to Numeric rather than
   * forward into an already-complete Other Words. The third face of the
   * original defect. */
  checkTargetAdvance(
    "bulk acceptance falls back to earlier incomplete work, not a completed later category",
    "proposal:csu-acronym",
    [c("numeric-1"), p("its-acronym"), p("csu-acronym"), c("other-done")],
    ["proposal:its-acronym", "proposal:csu-acronym", "candidate:other-done"],
    "candidate:numeric-1"
  );
}

console.log("--- unified review targets: forward/backward adjacency ---");
{
  const mixed = [c("may"), p("its"), p("csu"), c("numeric")];
  check("target keys preserve heterogeneous display order", targetKeys(mixed).join(",") === "candidate:may,proposal:its,proposal:csu,candidate:numeric");
  checkAdvance(
    "forward movement crosses candidate-to-proposal boundary",
    adjacentReviewTarget("candidate:may", mixed, "forward")?.id ?? null,
    "its"
  );
  checkAdvance(
    "forward movement crosses proposal-to-candidate boundary",
    adjacentReviewTarget("proposal:csu", mixed, "forward")?.id ?? null,
    "numeric"
  );
  checkAdvance(
    "backward movement returns from proposal to candidate inside the same category",
    adjacentReviewTarget("proposal:its", mixed, "backward")?.id ?? null,
    "may"
  );
  checkAdvance("backward movement at the first target stays put", adjacentReviewTarget("candidate:may", mixed, "backward")?.id ?? null, null);
}

/* ----------------------------------------------------------------------
 * PAINT ORDER == TARGET ORDER, AS AN EXECUTABLE IDENTITY.
 *
 * `sectionGridSequence` is what the renderer walks (one entry per rendered
 * grid); `sectionDisplayTargets` is what the cursor walks. The whole point of
 * deriving both from `sectionCandidateTargetGroups` + `sectionProposalTargets`
 * is that flattening the first gives the second -- for every section shape,
 * not just the ones today's data produces.
 * -------------------------------------------------------------------- */
console.log("--- paint order and target order are one derivation ---");
{
  const keysOf = (targets: readonly ReviewDisplayTarget[]) => targets.map(reviewDisplayTargetKey).join(",");
  const agrees = (label: string, section: ReviewTargetSection, expected: string): void => {
    check(`${label}: grids flatten to the target order`, keysOf(sectionGridSequence(section).flat()) === keysOf(sectionDisplayTargets(section)));
    check(`${label}: that order is ${expected}`, keysOf(sectionDisplayTargets(section)) === expected, keysOf(sectionDisplayTargets(section)));
  };

  agrees("plain section", { candidateIds: ["a", "b"] }, "candidate:a,candidate:b");
  agrees("mixed section", { candidateIds: ["may"], relationshipProposalIds: ["its"] }, "candidate:may,proposal:its");
  agrees("proposal-only section", { candidateIds: [], relationshipProposalIds: ["p1", "p2"] }, "proposal:p1,proposal:p2");

  /* An UNTIERED mixed section is ONE grid, deliberately: candidates and
   * proposals share a zone capacity there, which is what makes "the bound
   * applies to review targets" true rather than "candidates get 24 and
   * proposals ride free". Only tiering forces separate grids. */
  check(
    "an untiered mixed section draws ONE grid holding both unit types",
    sectionGridSequence({ candidateIds: ["may"], relationshipProposalIds: ["its"] }).length === 1
  );
  check(
    "a proposal-only untiered section is still one grid",
    sectionGridSequence({ candidateIds: [], relationshipProposalIds: ["p1"] }).length === 1
  );
  agrees(
    "single tier is treated as untiered",
    { candidateIds: ["a", "b"], tiers: [{ candidateIds: ["a", "b"] }] },
    "candidate:a,candidate:b"
  );
  agrees(
    "two tiers flatten in tier order",
    { candidateIds: ["a", "b", "c"], tiers: [{ candidateIds: ["a", "b"] }, { candidateIds: ["c"] }] },
    "candidate:a,candidate:b,candidate:c"
  );

  /* THE TIERED + PROPOSAL-BEARING SECTION -- synthetic, because no data
   * produces one today (tiers come from deriveReviewTier over term
   * archetypes, proposals from RELATIONSHIP_KIND_SECTION). The queued tier
   * work for Other Words would make it reachable, and the old renderer drew
   * proposals INSIDE the per-tier loop, so each would have been painted once
   * per tier against a derivation that emitted it once -- a cursor landing on
   * one of two identical rows. */
  const tieredWithProposals: ReviewTargetSection = {
    candidateIds: ["strong-1", "weak-1"],
    tiers: [{ candidateIds: ["strong-1"] }, { candidateIds: ["weak-1"] }],
    relationshipProposalIds: ["pair-1", "pair-2"],
  };
  agrees("tiered section with proposals", tieredWithProposals, "candidate:strong-1,candidate:weak-1,proposal:pair-1,proposal:pair-2");
  const grids = sectionGridSequence(tieredWithProposals);
  check("a tiered, proposal-bearing section draws one grid per tier PLUS one proposal grid", grids.length === 3, `${grids.length} grids`);
  check(
    "each proposal is painted exactly once across every grid",
    (() => {
      const painted = grids.flat().filter((t) => t.kind === "proposal").map((t) => t.id);
      return painted.length === new Set(painted).size && painted.join(",") === "pair-1,pair-2";
    })()
  );
  check("the proposal grid is last, after every tier grid", keysOf(grids[grids.length - 1]!) === "proposal:pair-1,proposal:pair-2");
  check(
    "no tier grid contains a proposal",
    grids.slice(0, -1).every((g) => g.every((t) => t.kind === "candidate"))
  );
  check(
    "a section with no proposals draws no empty proposal grid",
    sectionGridSequence({ candidateIds: ["a"], tiers: [{ candidateIds: ["a"] }, { candidateIds: [] }] }).length === 2
  );
  check(
    "the helpers agree with each other about membership",
    sectionCandidateTargetGroups(tieredWithProposals).flat().length === 2 && sectionProposalTargets(tieredWithProposals).length === 2
  );
  // Advancement over the flattened order crosses a tier boundary the same
  // way it crosses a category boundary -- tiers are a heading, not a wall.
  checkTargetAdvance(
    "advancement crosses a tier boundary into the next tier's first unresolved cell",
    "candidate:strong-1",
    sectionDisplayTargets(tieredWithProposals),
    ["candidate:strong-1"],
    "candidate:weak-1"
  );
  checkTargetAdvance(
    "and then out of the last tier into the section's proposal grid",
    "candidate:weak-1",
    sectionDisplayTargets(tieredWithProposals),
    ["candidate:strong-1", "candidate:weak-1"],
    "proposal:pair-1"
  );
}

console.log(`\n${passCount}/${passCount + failCount} checks passed`);
process.exitCode = failCount === 0 ? 0 : 1;
