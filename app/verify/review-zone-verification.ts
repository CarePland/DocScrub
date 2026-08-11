/**
 * review-zone-verification.ts -- the REVIEW ZONE (AG, 2026-08-06).
 * Design record: `20260806-review-zone-design.md` (repo-parent root).
 *
 * WHAT THIS SUITE IS DEFENDING. The zone bounds every bulk action in the
 * queue surfaces, so its rules are the difference between "this button
 * clears four items" and "this button clears a hundred and fifty." That
 * makes it a correctness surface, not a presentation one, and it is
 * verified here WITHOUT A BROWSER on purpose -- reviewZone.ts is pure and
 * takes the measured column count as a parameter precisely so that this
 * file can exist. If a future change makes zone membership depend on a
 * live DOM read, these tests stop being able to see it, which is the same
 * blind spot that let the Type Check member-cursor advance regress three
 * times.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/review-zone-verification.ts
 */

import { ZONE_CAPACITY, ZONE_HALF_CAPACITY, activeQueuePartition, completedQueuePartition, partitionByZone, reviewZone, zoneActionLabel, zonePartition } from "../src/ui/reviewZone.ts";
import { advanceWithinReviewTargets, candidateReviewTarget, proposalReviewTarget, sectionDisplayTargets, sectionGridSequence, type ReviewDisplayTarget } from "../src/ui/visibleListAdvance.ts";

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

const ids = (n: number, prefix = "c"): string[] => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

function main(): void {
  console.log("\n--- zone capacity: a hard constant, chosen to be a rectangle ---");
  {
    check("the zone holds 24", ZONE_CAPACITY === 24, String(ZONE_CAPACITY));
    // THE PROPERTY 24 WAS CHOSEN FOR. The zone is a subset of a longer
    // list, so its bottom edge has to be visible; a ragged half-row would
    // hide where a bulk action stops. This is what makes 24 better than 20
    // or 25 rather than merely "about a screenful".
    const ragged = [2, 3, 4, 6, 8, 12].filter((cols) => ZONE_CAPACITY % cols !== 0);
    check("it is a whole number of rows at 2, 3, 4, 6, 8 and 12 columns", ragged.length === 0, `ragged at ${ragged.join(",")} columns`);
    // Regression guard on the 2026-08-06 simplification: the size used to
    // be `columns x 2 rows`, which made a DECISION SCOPE depend on a DOM
    // measurement. If a future change reintroduces a measured size, this
    // suite's whole no-browser premise goes with it.
    check("capacity takes no arguments -- nothing measured feeds it", typeof ZONE_CAPACITY === "number");
    check("the default parameter IS the capacity, so a caller cannot silently pick another size", reviewZone(ids(50)).ids.length === ZONE_CAPACITY);
  }

  console.log("\n--- membership: the next N unresolved, in display order ---");
  {
    const zone = reviewZone(ids(37), 4);
    check("holds exactly N", zone.ids.length === 4);
    check("takes them from the FRONT, in display order", zone.ids.join(",") === "c0,c1,c2,c3", zone.ids.join(","));
    check("reports what it was drawn from, so a label can say '4 of 37'", zone.available === 37);
    check("knows the bound is doing something", zone.bounded);
  }
  {
    // The bound must be invisible when it is not holding anything back --
    // otherwise every short section renders as if work were being withheld.
    const zone = reviewZone(ids(3), 4);
    check("a section shorter than the zone yields all of it", zone.ids.length === 3 && zone.available === 3);
    check("and does NOT report itself as bounded", !zone.bounded);
    const exact = reviewZone(ids(4), 4);
    check("a section exactly the zone size is not bounded either (boundary)", !exact.bounded && exact.ids.length === 4);
  }
  {
    check("an empty scope is empty and unbounded, never a throw", reviewZone([], 4).ids.length === 0 && !reviewZone([], 4).bounded);
    check("a degenerate size still yields at least one item rather than a no-op button", reviewZone(ids(5), 0).ids.length === 1);
  }

  console.log("\n--- skipped items roll forward (AG: 'for simplicity') ---");
  {
    // The property that makes this need NO new persistence: the caller
    // hands in what is still unresolved, so an item passed over is simply
    // still at the front. There is no skip list to keep, and nothing to
    // save or restore.
    const all = ids(10);
    const first = reviewZone(all, 4);
    // The reviewer decides c1 and c3, and SKIPS c0 and c2.
    const stillUndecided = all.filter((id) => id !== "c1" && id !== "c3");
    const second = reviewZone(stillUndecided, 4);
    check("the skipped items lead the next zone", second.ids.slice(0, 2).join(",") === "c0,c2", second.ids.join(","));
    check("and the zone is topped up with fresh work behind them", second.ids.slice(2).join(",") === "c4,c5", second.ids.join(","));
    check("decided items never reappear", !second.ids.includes("c1") && !second.ids.includes("c3"));
    check("the first zone is unchanged by any of this -- membership is derived, not stored", first.ids.join(",") === "c0,c1,c2,c3");
  }
  {
    // Nothing decided => the zone is stable across consults. This is what
    // makes "no freeze on entry" safe: re-deriving cannot shuffle members.
    const a = reviewZone(ids(20), 6);
    const b = reviewZone(ids(20), 6);
    check("re-deriving an unchanged queue gives an identical zone", a.ids.join(",") === b.ids.join(","));
  }

  console.log("\n--- Ambiguity active queue: half-zone rotation, not per-cell compaction ---");
  {
    type Cell = { id: string };
    const cells = (n: number): Cell[] => ids(n).map((id) => ({ id }));
    const activeIds = (all: readonly Cell[], done: ReadonlySet<string>) => activeQueuePartition(all, (cell) => done.has(cell.id)).active.map((cell) => cell.id);
    const restIds = (all: readonly Cell[], done: ReadonlySet<string>) => activeQueuePartition(all, (cell) => done.has(cell.id)).rest.map((cell) => cell.id);
    const mutationIds = (all: readonly Cell[], done: ReadonlySet<string>) => activeIds(all, done).filter((id) => !done.has(id));

    check("half-zone size is 12", ZONE_HALF_CAPACITY === 12, String(ZONE_HALF_CAPACITY));
    check("8 items all sit in the side active zone with no continuation", activeIds(cells(8), new Set()).join(",") === ids(8).join(",") && restIds(cells(8), new Set()).length === 0);
    check("12 items all sit in the side active zone with no continuation", activeIds(cells(12), new Set()).join(",") === ids(12).join(",") && restIds(cells(12), new Set()).length === 0);
    check("20 items all sit in the side active zone with no continuation", activeIds(cells(20), new Set()).join(",") === ids(20).join(",") && restIds(cells(20), new Set()).length === 0);
    check("exactly 24 items fill the active zone with no continuation", activeIds(cells(24), new Set()).join(",") === ids(24).join(",") && restIds(cells(24), new Set()).length === 0);
    check("25 items put only the 25th into the continuation", activeIds(cells(25), new Set()).join(",") === ids(24).join(",") && restIds(cells(25), new Set()).join(",") === "c24");
    check("more than 24 items keep the first 24 active and continue underneath", activeIds(cells(30), new Set()).join(",") === ids(24).join(",") && restIds(cells(30), new Set()).join(",") === ids(6, "c").map((_, i) => `c${i + 24}`).join(","));

    const partialFirstHalf = new Set(ids(11));
    check("partially completing the first half does not reshuffle the zone", activeIds(cells(36), partialFirstHalf).join(",") === ids(24).join(","));
    const firstHalfDone = new Set(ids(12));
    check("completing the first 12 rotates exactly that half-zone away", activeIds(cells(36), firstHalfDone).join(",") === ids(24).map((_, i) => `c${i + 12}`).join(","));
    check("after rotation, old 13-24 become the first half", activeIds(cells(36), firstHalfDone).slice(0, 12).join(",") === ids(12).map((_, i) => `c${i + 12}`).join(","));
    check("after rotation, the next 12 queued items populate the second half", activeIds(cells(36), firstHalfDone).slice(12).join(",") === ids(12).map((_, i) => `c${i + 24}`).join(","));

    const twoHalvesDone = new Set(ids(24));
    check("repeated half-zone rotations preserve deterministic ordering", activeQueuePartition(cells(60), (cell) => twoHalvesDone.has(cell.id)).ordered.map((cell) => cell.id).join(",") === [...ids(36).map((_, i) => `c${i + 24}`), ...ids(24)].join(","));

    const bulkAllUnresolved = new Set(ids(24));
    check("bulk over 24 unresolved mutates all active unresolved items", mutationIds(cells(48), new Set()).join(",") === ids(24).join(","));
    check("after that bulk, all 24 active members retire and the next 24 promote", activeIds(cells(48), bulkAllUnresolved).join(",") === ids(24).map((_, i) => `c${i + 24}`).join(","));

    const fivePredecided = new Set(["c0", "c3", "c7", "c14", "c23"]);
    check("bulk with preexisting decisions mutates only unresolved active members", mutationIds(cells(48), fivePredecided).length === 19);
    const afterMixedBulk = new Set([...ids(24)]);
    check("preexisting decisions survive bulk unchanged by staying outside the mutation list", !mutationIds(cells(48), fivePredecided).some((id) => fivePredecided.has(id)));
    check("bulk retirement scope is the whole active zone, so next 24 promote", activeIds(cells(60), afterMixedBulk).join(",") === ids(24).map((_, i) => `c${i + 24}`).join(","));

    const finalPartialDone = new Set(ids(36));
    check("final partial zones behave sensibly", activeIds(cells(42), finalPartialDone).join(",") === "c36,c37,c38,c39,c40,c41");

    const targetsBeforeDecision = cells(36).map((cell) => candidateReviewTarget(cell.id));
    const next = advanceWithinReviewTargets("candidate:c11", targetsBeforeDecision, (target) => firstHalfDone.has(target.id));
    check("focus remains on a valid promoted item after rotation", next?.kind === "candidate" && next.id === "c12", next ? `${next.kind}:${next.id}` : "null");

    const proposalTargets = ["may", "its", "perc", "qbu"].map(proposalReviewTarget);
    const afterSecondProposal = advanceWithinReviewTargets("proposal:its", proposalTargets, (target) => target.id === "may" || target.id === "its");
    check("completing proposal 2 of 4 advances within the category to proposal 3", afterSecondProposal?.kind === "proposal" && afterSecondProposal.id === "perc", afterSecondProposal ? `${afterSecondProposal.kind}:${afterSecondProposal.id}` : "null");

    const resetDone = new Set(["c0", "c1"]);
    check("reset-style active-zone derivation keeps decided cells in a partial half-zone", activeIds(cells(30), resetDone).slice(0, 4).join(",") === "c0,c1,c2,c3");
    check("resetting decisions cannot corrupt ordering: clearing done restores the original active zone", activeIds(cells(30), new Set()).join(",") === ids(24).join(","));
    const anchoredCells = cells(30);
    const anchored = activeQueuePartition(anchoredCells, () => false, ZONE_CAPACITY, ZONE_HALF_CAPACITY, anchoredCells[24]!);
    check("category arrival can anchor a later first-unreviewed cell at the top of the active zone", anchored.active[0]?.id === "c24" && anchored.active.length === 24);
    check("anchored category arrival keeps every cell exactly once across active plus continuation", new Set([...anchored.active, ...anchored.rest].map((cell) => cell.id)).size === 30);
  }

  console.log("\n--- Ambiguity completed-category presentation: canonical first-24 display ---");
  {
    type Cell = { id: string; decision: "Keep" | "Ignore" | "Rename" | "Redact" };
    const cells = (n: number): Cell[] => ids(n).map((id, index) => ({ id, decision: index % 2 === 0 ? "Keep" : "Ignore" }));
    const activeIds = (all: readonly Cell[]) => completedQueuePartition(all).active.map((cell) => cell.id);
    const restIds = (all: readonly Cell[]) => completedQueuePartition(all).rest.map((cell) => cell.id);
    const decisions = (all: readonly Cell[]) => completedQueuePartition(all).ordered.map((cell) => cell.decision).join(",");

    check("fewer than 24 completed items all repopulate the side Zone", activeIds(cells(8)).join(",") === ids(8).join(",") && restIds(cells(8)).length === 0);
    check("exactly 24 completed items all stay beside the panel", activeIds(cells(24)).join(",") === ids(24).join(",") && restIds(cells(24)).length === 0);
    check("25+ completed items put only item 25 onward into the continuation", activeIds(cells(30)).join(",") === ids(24).join(",") && restIds(cells(30)).join(",") === ids(6).map((_, i) => `c${i + 24}`).join(","));
    check("completed-category ordering is canonical, not retired-to-tail incidental ordering", completedQueuePartition(cells(30)).ordered.map((cell) => cell.id).join(",") === ids(30).join(","));
    check("completed-category display preserves the cells' final decision state", decisions(cells(4)) === "Keep,Ignore,Keep,Ignore");
    check("the completed display is display-only: clearing decisions returns normal conveyor order", activeQueuePartition(cells(30), () => false).active.map((cell) => cell.id).join(",") === ids(24).join(","));
  }

  console.log("\n--- the label names the blast radius ---");
  {
    // "A button that cannot SAY 150 cannot DO 150."
    check("the count rides in the label", zoneActionLabel("These are all words, not names", 4) === "These are all words, not names (4)");
    const zone = reviewZone(ids(150), 4);
    check("a 150-item section still labels a 4-item action", zoneActionLabel("Leave all as-is", zone.ids.length) === "Leave all as-is (4)");
    check("...and the action really does cover 4, not 150", zone.ids.length === 4 && zone.available === 150);
  }

  // THE "STUCK ZONE" tests were REMOVED on 2026-08-06 along with the
  // zoneIsStuck() detector they covered. Andrew ruled the state is not a
  // defect ("That's on the user, frankly... this is not a UI issue"), and
  // he is right: decisionButtons() renders all four decisions on every
  // candidate, so no item is ever undecidable. A zone full of items the
  // reviewer has avoided is the queue surfacing work that is owed. See
  // reviewZone.ts's own note -- the reasoning is kept, the machinery is
  // not, because a detector nothing acts on is speculative.

  /* ------------------------------------------------------------------
   * THE BAND/REST PARTITION, OVER UNIFIED REVIEW TARGETS (2026-08-07).
   *
   * Regression origin: the sectioned grid used to partition CANDIDATE ids
   * and then draw proposals only when no band was in effect
   * (`restSet ? [] : section.relationshipProposalIds`), so any section with
   * more than ZONE_CAPACITY remaining candidates painted NO proposal cells
   * at all -- while target derivation kept emitting their `proposal:*`
   * targets. The cursor could advance onto a cell drawn nowhere, and a
   * section whose candidates were all decided never read as complete.
   * ------------------------------------------------------------------ */
  console.log("\n--- band/rest partition over review targets ---");
  {
    type Cell = { key: string; done: boolean };
    const cell = (key: string, done = false): Cell => ({ key, done });
    const unresolved = (c: Cell) => !c.done;
    const keys = (cells: readonly Cell[]) => cells.map((c) => c.key).join(",");

    // Proposals are cells like any other: capacity counts them.
    const mixed = [cell("candidate:a"), cell("candidate:b"), cell("proposal:p1"), cell("candidate:c")];
    const tight = partitionByZone(mixed, unresolved, 2);
    check("capacity counts proposals, not just candidates", keys(tight.band) === "candidate:a,candidate:b", keys(tight.band));
    check("targets beyond the bound are withheld, not dropped", keys(tight.rest) === "proposal:p1,candidate:c", keys(tight.rest));
    check(
      "every cell is painted exactly once across band and rest",
      [...tight.band, ...tight.rest].length === mixed.length &&
        new Set([...tight.band, ...tight.rest].map((c) => c.key)).size === mixed.length
    );

    // A proposal enters the band once the candidates ahead of it fit.
    const roomy = partitionByZone(mixed, unresolved, 24);
    check("no band when remaining work fits the bound", roomy.banded === false && roomy.rest.length === 0);
    check("an unbanded grid still paints every cell, proposals included", keys(roomy.band) === keys(mixed), keys(roomy.band));

    // THE INVARIANT THE ADVANCE RIDES ON. The painted band includes
    // already-resolved cells that sort before the zone end, so band+rest
    // preserves cell order AND the unresolved subsequence, which is the
    // sequence a post-decision advance traverses. This is what lets the
    // target derivation stay zone-unaware.
    const withDecided = [
      cell("candidate:done1", true),
      cell("candidate:u1"),
      cell("proposal:done-p", true),
      cell("candidate:u2"),
      cell("proposal:u3"),
      cell("candidate:u4"),
    ];
    const split = partitionByZone(withDecided, unresolved, 2);
    check("the band ends at the Nth unresolved cell", keys(split.band.filter(unresolved)) === "candidate:u1,candidate:u2", keys(split.band));
    check("resolved cells before the zone end stay in the painted band", keys(split.band) === "candidate:done1,candidate:u1,proposal:done-p,candidate:u2", keys(split.band));
    check("cells after the zone end are withheld", keys(split.rest) === "proposal:u3,candidate:u4", keys(split.rest));
    check(
      "painted unresolved subsequence equals derived unresolved subsequence",
      keys([...split.band, ...split.rest].filter(unresolved)) === keys(withDecided.filter(unresolved)),
      `${keys([...split.band, ...split.rest].filter(unresolved))} vs ${keys(withDecided.filter(unresolved))}`
    );

    // AGREEMENT WITH headingActionScope. Targets are ordered
    // candidates-then-proposals within a grid, so a proposal can only reach
    // the band once every undecided candidate is already in it -- which
    // makes the band's candidate subset identical to the candidate-only zone
    // the bulk buttons compute. The buttons cover precisely the candidate
    // cells the band shows.
    const many = [
      ...Array.from({ length: 30 }, (_, i) => cell(`candidate:c${i}`)),
      cell("proposal:p1"),
      cell("proposal:p2"),
    ];
    const banded = partitionByZone(many, unresolved, ZONE_CAPACITY);
    const bandCandidates = banded.band.filter((c) => unresolved(c) && c.key.startsWith("candidate:")).map((c) => c.key);
    const buttonScope = reviewZone(
      many.filter(unresolved).filter((c) => c.key.startsWith("candidate:")).map((c) => c.key),
      ZONE_CAPACITY
    ).ids;
    check("the band's unresolved-candidate subset equals the bulk buttons' own zone", bandCandidates.join(",") === buttonScope.join(","));
    check("proposals stay withheld while candidates still fill the bound", banded.rest.some((c) => c.key === "proposal:p1"));

    // A proposal-only grid (the tiered section's separate proposal grid).
    const proposalsOnly = [cell("proposal:a"), cell("proposal:b"), cell("proposal:c")];
    const pOnly = partitionByZone(proposalsOnly, unresolved, 2);
    check("a proposal-only grid bands by the same rule", keys(pOnly.band) === "proposal:a,proposal:b" && keys(pOnly.rest) === "proposal:c");

    check("an empty grid partitions to nothing and is not banded", (() => {
      const empty = partitionByZone([] as Cell[], unresolved, ZONE_CAPACITY);
      return empty.band.length === 0 && empty.rest.length === 0 && empty.banded === false;
    })());
    check("a fully decided grid is never banded", (() => {
      const allDone = partitionByZone([cell("candidate:x", true), cell("proposal:y", true)], unresolved, 1);
      return allDone.banded === false && allDone.band.length === 2;
    })());
  }

  console.log("\n--- proposal bulk scope follows the active Review Zone ---");
  {
    type ProposalCell = { key: string; done: boolean; kind: "acronym" | "numeric"; roles: readonly ("acronym" | "written-out")[] };
    const proposal = (
      id: string,
      roles: readonly ("acronym" | "written-out")[] = ["acronym"],
      done = false,
      kind: "acronym" | "numeric" = "acronym"
    ): ProposalCell => ({ key: `proposal:${id}`, done, kind, roles });
    const unresolved = (cell: ProposalCell) => !cell.done;
    const activeZone = (cells: readonly ProposalCell[], size = 2) => partitionByZone(cells, unresolved, size).band;
    const applicable = (cells: readonly ProposalCell[], role: "acronym" | "written-out") =>
      activeZone(cells)
        .filter((cell) => cell.kind === "acronym" && !cell.done && cell.roles.includes(role))
        .map((cell) => cell.key);

    const proposals = [
      proposal("active-acronym", ["acronym"]),
      proposal("active-written", ["written-out"]),
      proposal("withheld-acronym", ["acronym"]),
      proposal("withheld-written", ["written-out"]),
    ];
    check("an applicable proposal in the active zone is in proposal bulk scope", applicable(proposals, "acronym").join(",") === "proposal:active-acronym");
    check("an applicable proposal in the withheld remainder is not in proposal bulk scope", !applicable(proposals, "acronym").includes("proposal:withheld-acronym"));

    const afterActiveZoneAdvances = proposals.map((cell) =>
      cell.key === "proposal:active-acronym" || cell.key === "proposal:active-written" ? { ...cell, done: true } : cell
    );
    check(
      "when the zone advances, the formerly withheld proposal enters the same bulk scope normally",
      applicable(afterActiveZoneAdvances, "acronym").join(",") === "proposal:withheld-acronym"
    );

    const mixed = [
      { key: "candidate:c0", done: false },
      { key: "candidate:c1", done: false },
      { key: "proposal:p0", done: false },
      { key: "proposal:p1", done: false },
    ];
    const mixedSplit = partitionByZone(mixed, (cell) => !cell.done, 3);
    check("mixed candidate/proposal grids keep capacity by review cell", mixedSplit.band.map((cell) => cell.key).join(",") === "candidate:c0,candidate:c1,proposal:p0");
    check("structural order remains the full unresolved sequence, independent of the band/rest split", mixed.map((cell) => cell.key).join(",") === "candidate:c0,candidate:c1,proposal:p0,proposal:p1");

    const tierProposalGrid = [proposal("tier-p0"), proposal("tier-p1"), proposal("tier-p2")];
    const tierSplit = partitionByZone(tierProposalGrid, unresolved, 2);
    check("tiered proposal grids apply the same zone-scope rule", tierSplit.band.map((cell) => cell.key).join(",") === "proposal:tier-p0,proposal:tier-p1");
    check("proposal-only grids with no unresolved work are safe", partitionByZone([proposal("done", ["acronym"], true)], unresolved, 2).band.length === 1);
  }

  console.log("\n--- reset scope uses the painted band, not bulk-action undecided ids ---");
  {
    const targetKey = (target: ReviewDisplayTarget): string => `${target.kind}:${target.id}`;
    const resettable = (targets: readonly ReviewDisplayTarget[], decided: ReadonlySet<string>): string[] =>
      targets.filter((target) => target.kind === "candidate" && decided.has(target.id)).map((target) => target.id);

    const activeGrid = ids(30).map((id) => ({ kind: "candidate" as const, id }));
    const decided = new Set(["c0", "c1", "c29"]);
    const painted = partitionByZone(activeGrid, (target) => !decided.has(target.id), 24).band;
    const resetIds = resettable(painted, decided);
    check("Reset Zone includes decided candidates that still sort inside the painted band", resetIds.join(",") === "c0,c1", resetIds.join(","));
    check("decided candidates in the same category but outside the active painted Zone are untouched", !resetIds.includes("c29"));

    const tiered = {
      candidateIds: ids(8, "t"),
      tiers: [{ candidateIds: ["t0", "t1", "t2", "t3"] }, { candidateIds: ["t4", "t5", "t6", "t7"] }],
    };
    const tierGrids = sectionGridSequence(tiered);
    const tierDecided = new Set(["t1", "t5"]);
    const firstTierReset = resettable(partitionByZone(tierGrids[0] ?? [], (target) => !tierDecided.has(target.id), 24).band, tierDecided);
    const categoryReset = resettable(sectionDisplayTargets(tiered), tierDecided);
    check("tiered section: Zone Reset affects only the cursor's grid/tier", firstTierReset.join(",") === "t1", firstTierReset.join(","));
    check("tiered section: Category Reset still spans all tiers", categoryReset.join(",") === "t1,t5", categoryReset.join(","));

    const untiered = { candidateIds: ["u0", "u1"], relationshipProposalIds: ["p0"] };
    const untieredGrid = sectionGridSequence(untiered);
    const untieredPartition = partitionByZone(untieredGrid[0] ?? [], () => false, 24);
    check(
      "Zone == Category collapse is computed from one unbanded grid's real target set",
      untieredGrid.length === 1 && !untieredPartition.banded && untieredPartition.band.map(targetKey).join(",") === sectionDisplayTargets(untiered).map(targetKey).join(",")
    );
  }

  console.log(`\nreview-zone-verification: ${passCount} passed, ${failCount} failed\n`);
  if (failCount > 0) process.exitCode = 1;
}


/* ==========================================================================
 * ONE ZONE ENTRY POINT (AG, 2026-08-09, migration prerequisite D3).
 *
 * `zonePartition` exists so the conveyor/compacting choice becomes a
 * DECLARED ARGUMENT rather than an `if (stage !== "ambiguity-check")`
 * buried inside a shared helper -- which is how two Zone algorithms came
 * to live behind one facade in the first place.
 *
 * The whole safety of the eventual switch rests on one property: for each
 * rhythm, `zonePartition` must be BYTE-IDENTICAL to the function that
 * rhythm replaces. These assert exactly that, over shapes that exercise
 * chunk retirement, the bound, and the anchor rotation.
 * ========================================================================== */
function runZonePartitionEquivalence(): void {
  console.log("\n--- zonePartition: equivalence with the two existing rhythms ---");

  const keys = <T,>(cells: readonly T[]): string => cells.map((c) => String(c)).join("|");

  // Shapes: under-bound, over-bound, a fully retired leading chunk, and a
  // ragged tail.
  const shapes: Array<{ label: string; cells: string[]; resolved: Set<string> }> = [
    { label: "empty", cells: [], resolved: new Set() },
    { label: "under the bound, none resolved", cells: Array.from({ length: 10 }, (_, i) => `c${i}`), resolved: new Set() },
    {
      label: "over the bound, none resolved",
      cells: Array.from({ length: 40 }, (_, i) => `c${i}`),
      resolved: new Set(),
    },
    {
      label: "a fully resolved leading half-zone (retirement)",
      cells: Array.from({ length: 40 }, (_, i) => `c${i}`),
      resolved: new Set(Array.from({ length: ZONE_HALF_CAPACITY }, (_, i) => `c${i}`)),
    },
    {
      label: "scattered resolution",
      cells: Array.from({ length: 37 }, (_, i) => `c${i}`),
      resolved: new Set(["c0", "c5", "c11", "c12", "c13", "c30"]),
    },
  ];

  for (const shape of shapes) {
    const isResolved = (c: string): boolean => shape.resolved.has(c);

    const conveyorExpected = activeQueuePartition(shape.cells, isResolved, ZONE_CAPACITY, ZONE_HALF_CAPACITY);
    const conveyorActual = zonePartition(shape.cells, isResolved, "conveyor", ZONE_CAPACITY, ZONE_HALF_CAPACITY);
    check(
      `zonePartition("conveyor") == activeQueuePartition -- ${shape.label}`,
      keys(conveyorActual.active) === keys(conveyorExpected.active) &&
        keys(conveyorActual.rest) === keys(conveyorExpected.rest) &&
        keys(conveyorActual.ordered) === keys(conveyorExpected.ordered) &&
        keys(conveyorActual.retired) === keys(conveyorExpected.retired) &&
        conveyorActual.bounded === conveyorExpected.bounded,
      `active ${keys(conveyorActual.active)} vs ${keys(conveyorExpected.active)}`
    );

    const bandExpected = partitionByZone(shape.cells, (c) => !isResolved(c), ZONE_CAPACITY);
    const compactActual = zonePartition(shape.cells, isResolved, "compacting", ZONE_CAPACITY, ZONE_HALF_CAPACITY);
    const expectedRest = bandExpected.banded ? bandExpected.rest : [];
    check(
      `zonePartition("compacting") == partitionByZone -- ${shape.label}`,
      keys(compactActual.active) === keys(bandExpected.band) &&
        keys(compactActual.rest) === keys(expectedRest) &&
        keys(compactActual.ordered) === keys([...bandExpected.band, ...expectedRest]),
      `active ${keys(compactActual.active)} vs band ${keys(bandExpected.band)}`
    );
  }

  // The anchor rotation is conveyor-only and must survive the wrapper.
  {
    const cells = Array.from({ length: 30 }, (_, i) => `c${i}`);
    const isResolved = (c: string): boolean => ["c0", "c1"].includes(c);
    const anchor = "c20";
    const expected = activeQueuePartition(cells, isResolved, ZONE_CAPACITY, ZONE_HALF_CAPACITY, anchor);
    const actual = zonePartition(cells, isResolved, "conveyor", ZONE_CAPACITY, ZONE_HALF_CAPACITY, anchor);
    check(
      "zonePartition passes the arrival anchor through to the conveyor",
      keys(actual.active) === keys(expected.active) && actual.active[0] === "c20",
      `${keys(actual.active).slice(0, 40)}`
    );
    const noAnchor = zonePartition(cells, isResolved, "conveyor", ZONE_CAPACITY, ZONE_HALF_CAPACITY);
    check("omitting the anchor is not the same as passing undefined-as-anchor", noAnchor.active[0] === "c0", String(noAnchor.active[0]));
  }

  // THE RHYTHMS GENUINELY DIFFER -- otherwise the parameter is theatre and
  // the migration decision is meaningless.
  {
    const cells = Array.from({ length: 40 }, (_, i) => `c${i}`);
    const resolved = new Set(Array.from({ length: ZONE_HALF_CAPACITY }, (_, i) => `c${i}`));
    const isResolved = (c: string): boolean => resolved.has(c);
    const conveyor = zonePartition(cells, isResolved, "conveyor", ZONE_CAPACITY, ZONE_HALF_CAPACITY);
    const compacting = zonePartition(cells, isResolved, "compacting", ZONE_CAPACITY, ZONE_HALF_CAPACITY);
    check(
      "the two rhythms produce DIFFERENT active zones once a half-zone has retired",
      keys(conveyor.active) !== keys(compacting.active),
      "the rhythms are indistinguishable -- the migration decision would be a no-op; re-check before switching Item Check"
    );
    check("the conveyor retires the completed chunk out of the active zone", conveyor.retired.length === ZONE_HALF_CAPACITY, String(conveyor.retired.length));
    check("the compacting model retires nothing", compacting.retired.length === 0);
  }
}


runZonePartitionEquivalence();

main();
