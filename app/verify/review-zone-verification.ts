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

import { ZONE_CAPACITY, partitionByZone, reviewZone, zoneActionLabel } from "../src/ui/reviewZone.ts";
import { sectionDisplayTargets, sectionGridSequence, type ReviewDisplayTarget } from "../src/ui/visibleListAdvance.ts";

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

main();
