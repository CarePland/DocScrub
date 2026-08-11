/**
 * ambiguity-advance-sequence-verification.ts -- the ITS -> PERC sequence,
 * replayed as a REVIEWER SEQUENCE (AG, 2026-08-08).
 *
 * NOT A SOURCE-TEXT CHECK. Every assertion below is on an observable
 * position after a simulated reviewer action, driven through the same pure
 * decision functions app.ts calls in the same order app.ts calls them. The
 * repository's existing app.ts "regression tests" are regular expressions
 * matched against the source file read as text (see
 * `20260808-ambiguity-navigation-forensic-audit.md` §C); those cannot fail
 * for a behavioral reason and must never again stand in for one of these.
 *
 * ---------------------------------------------------------------------
 * THE SEQUENCE THIS REPRODUCES, captured live and not hypothesized
 * ---------------------------------------------------------------------
 *
 *   seq 68  advance.visible      proposal:rel-acronym-ITS -> proposal:rel-acronym-PERC
 *   seq 69  cursor.write L3566   proposalCursor ITS -> PERC
 *   seq 70  advance.completion   anchor proposal:rel-acronym-QBU -> candidate:person:civitas
 *                                {sectionId: "acronyms", remaining: 2}
 *   seq 71  cursor.write L3569   proposalCursor PERC -> (none)
 *   seq 72  render               category=institutional
 *
 * The Acronyms category held one candidate (person:may) and three proposals
 * (ITS, PERC, QBU). The reviewer decided ITS. The per-unit advance chose
 * PERC correctly. The section-completion advance then overrode it and left
 * the category while PERC and QBU were still unresolved.
 *
 * TWO INDEPENDENT DEFECTS produced that, and this suite pins both
 * separately, because either one alone still breaks the invariant:
 *
 *   1. THE OVERWRITE. `advanceAfterSectionCompletion` ran at all. Its call
 *      site fires it whenever a completion anchor merely EXISTS, in the
 *      branch reached precisely when nothing completed.
 *      -> completionAdvanceIsPermitted
 *
 *   2. WHERE IT WENT. Its anchor is the LAST target of the zone scope
 *      (QBU), not the acted-on unit, and the forward-first scan walks out
 *      of the category from there without ever consulting the unresolved
 *      units behind it.
 *      -> advanceWithinCategoryScope
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/ambiguity-advance-sequence-verification.ts
 */

import {
  type ReviewDisplayTarget,
  advanceWithinCategoryScope,
  advanceWithinReviewTargets,
  candidateReviewTarget,
  completionAdvanceIsPermitted,
  firstUnresolvedReviewTarget,
  proposalReviewTarget,
  reviewDisplayTargetKey,
  sectionGridSequence,
} from "../src/ui/visibleListAdvance.ts";
import { ZONE_CAPACITY, ZONE_HALF_CAPACITY, activeQueuePartition, zonePartition } from "../src/ui/reviewZone.ts";

let passCount = 0;
let failCount = 0;
const failed: string[] = [];

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passCount += 1;
    console.log(`  PASS ${label}`);
  } else {
    failCount += 1;
    failed.push(label);
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

/* ==========================================================================
 * FIXTURE -- the live Acronyms/Institutional shape from the trace.
 * ========================================================================== */

const ACRONYMS = {
  id: "acronyms",
  candidateIds: ["person:may"],
  relationshipProposalIds: ["rel-acronym-ITS", "rel-acronym-PERC", "rel-acronym-QBU"],
};
const INSTITUTIONAL = {
  id: "institutional",
  candidateIds: ["person:civitas", "person:enrollment", "person:dean", "person:registrar"],
  relationshipProposalIds: [] as string[],
};

/** Proposal members, addressed through the card rather than as rows. */
const MEMBERS: Record<string, string[]> = {
  "rel-acronym-ITS": ["its:a", "its:b"],
  "rel-acronym-PERC": ["perc:a", "perc:b"],
  "rel-acronym-QBU": ["qbu:a", "qbu:b"],
};

interface Session {
  decisions: Record<string, true>;
  dismissals: Record<string, true>;
}

const resolvedOf = (session: Session) => (target: ReviewDisplayTarget): boolean => {
  if (target.kind === "candidate") return Boolean(session.decisions[target.id]);
  if (session.dismissals[target.id]) return true;
  return (MEMBERS[target.id] ?? []).every((id) => Boolean(session.decisions[id]));
};

function decide(session: Session, target: ReviewDisplayTarget): void {
  if (target.kind === "candidate") {
    session.decisions[target.id] = true;
    return;
  }
  for (const id of MEMBERS[target.id] ?? []) session.decisions[id] = true;
}

/** Display order for a category, through the same zone conveyor app.ts uses. */
function categoryTargets(category: typeof ACRONYMS, session: Session): ReviewDisplayTarget[] {
  return sectionGridSequence(category).flatMap((grid) => activeQueuePartition(grid, resolvedOf(session), ZONE_CAPACITY).ordered);
}

function stageTargets(session: Session): ReviewDisplayTarget[] {
  return [...categoryTargets(ACRONYMS, session), ...categoryTargets(INSTITUTIONAL as typeof ACRONYMS, session)];
}

function categoryRemaining(category: typeof ACRONYMS, session: Session): number {
  return categoryTargets(category, session).filter((t) => !resolvedOf(session)(t)).length;
}

function categoryOf(target: ReviewDisplayTarget, session: Session): string {
  const inAcronyms = categoryTargets(ACRONYMS, session).some((t) => reviewDisplayTargetKey(t) === reviewDisplayTargetKey(target));
  return inAcronyms ? "acronyms" : "institutional";
}

/* ==========================================================================
 * THE PIPELINE -- app.ts's decision path, in app.ts's order.
 *
 * Modelled rather than imported, because app.ts exports nothing (the audit's
 * central finding). The ORDER is what matters and is what is reproduced:
 *
 *   1. snapshot the completion anchor  (pre-dispatch, trailing zone target)
 *   2. dispatch the decision
 *   3. per-unit visible advance        (dispatchReviewWithVisibleAdvance)
 *   4. completion advance              (advanceAfterSectionCompletion)
 *
 * Step 4 is the one under test. Steps 1-3 are scaffolding that must be
 * faithful for step 4's inputs to be real.
 * ========================================================================== */

interface Pipeline {
  position: ReviewDisplayTarget;
  completionAdvanceRan: boolean;
}

function reviewerDecides(session: Session, acting: ReviewDisplayTarget, guardsEnabled: boolean): Pipeline {
  // 1. Pre-dispatch anchor: the LAST target of the acted-on category's zone
  //    scope -- exactly what snapshotCurrentScopeCompletionAnchor produces,
  //    and the reason the observed advance started from QBU.
  const preStageTargets = stageTargets(session);
  const preCategory = categoryOf(acting, session) === "acronyms" ? ACRONYMS : (INSTITUTIONAL as typeof ACRONYMS);
  const scope = sectionGridSequence(preCategory).flatMap((grid) => activeQueuePartition(grid, resolvedOf(session), ZONE_CAPACITY).active);
  const anchorTarget = [...scope].reverse()[0]!;
  const anchorKey = reviewDisplayTargetKey(anchorTarget);

  // 2. Dispatch.
  decide(session, acting);

  // 3. Per-unit visible advance, from the ACTED-ON unit.
  const landing = advanceWithinReviewTargets(reviewDisplayTargetKey(acting), preStageTargets, resolvedOf(session));
  let position = landing ?? acting;

  // 4. Completion advance, from the TRAILING anchor.
  let completionAdvanceRan = false;
  const permitted = guardsEnabled
    ? completionAdvanceIsPermitted(reviewDisplayTargetKey(position), preStageTargets, resolvedOf(session))
    : true;
  if (permitted) {
    const afterCategory = categoryOf(anchorTarget, session) === "acronyms" ? ACRONYMS : (INSTITUTIONAL as typeof ACRONYMS);
    const completionLanding = guardsEnabled
      ? advanceWithinCategoryScope(anchorKey, categoryTargets(afterCategory, session), preStageTargets, resolvedOf(session))
      : advanceWithinReviewTargets(anchorKey, preStageTargets, resolvedOf(session));
    if (completionLanding) {
      position = completionLanding;
      completionAdvanceRan = true;
    }
  }
  return { position, completionAdvanceRan };
}

/* ==========================================================================
 * THE REQUIRED SEQUENCE
 * ========================================================================== */

console.log("=== Ambiguity advance sequence (live trace seq 68-72) ===\n");

console.log("--- The defect, unguarded: it must still reproduce ---");
{
  const session: Session = { decisions: {}, dismissals: {} };
  decide(session, candidateReviewTarget("person:may")); // reviewer already handled the candidate
  const result = reviewerDecides(session, proposalReviewTarget("rel-acronym-ITS"), /* guardsEnabled */ false);
  check(
    "WITHOUT the guards, deciding ITS leaves Acronyms for Institutional (the reported failure)",
    reviewDisplayTargetKey(result.position) === "candidate:person:civitas",
    `got ${reviewDisplayTargetKey(result.position)} -- the defect is no longer reproducible; re-check the fixture before trusting the fix`
  );
  check(
    "WITHOUT the guards, it leaves while Acronyms still holds unresolved units",
    categoryRemaining(ACRONYMS, session) === 2,
    `expected 2 unresolved (PERC, QBU), got ${categoryRemaining(ACRONYMS, session)}`
  );
}

console.log("\n--- The required sequence, guarded ---");
{
  const session: Session = { decisions: {}, dismissals: {} };
  decide(session, candidateReviewTarget("person:may"));

  const result = reviewerDecides(session, proposalReviewTarget("rel-acronym-ITS"), /* guardsEnabled */ true);

  check(
    "1. deciding ITS advances to PERC",
    reviewDisplayTargetKey(result.position) === "proposal:rel-acronym-PERC",
    `got ${reviewDisplayTargetKey(result.position)}`
  );
  check(
    "2. PERC REMAINS the active unit -- the completion advance did not override it",
    reviewDisplayTargetKey(result.position) === "proposal:rel-acronym-PERC" && !result.completionAdvanceRan,
    `completionAdvanceRan=${result.completionAdvanceRan}`
  );
  check(
    "3. NO category advance -- the position is still inside Acronyms",
    categoryOf(result.position, session) === "acronyms",
    `landed in ${categoryOf(result.position, session)}`
  );
  check(
    "4. PERC and QBU are still unresolved at that moment",
    categoryRemaining(ACRONYMS, session) === 2,
    `${categoryRemaining(ACRONYMS, session)} unresolved`
  );
  check("5. the active unit is itself unresolved", !resolvedOf(session)(result.position));
}

console.log("\n--- Continuing the category to genuine completion ---");
{
  const session: Session = { decisions: {}, dismissals: {} };
  decide(session, candidateReviewTarget("person:may"));

  const afterITS = reviewerDecides(session, proposalReviewTarget("rel-acronym-ITS"), true);
  check("deciding ITS -> PERC", reviewDisplayTargetKey(afterITS.position) === "proposal:rel-acronym-PERC", reviewDisplayTargetKey(afterITS.position));

  const afterPERC = reviewerDecides(session, afterITS.position, true);
  check(
    "deciding PERC -> QBU, still inside Acronyms",
    reviewDisplayTargetKey(afterPERC.position) === "proposal:rel-acronym-QBU" && categoryOf(afterPERC.position, session) === "acronyms",
    `got ${reviewDisplayTargetKey(afterPERC.position)} in ${categoryOf(afterPERC.position, session)}`
  );
  check("Acronyms still holds exactly one unresolved unit", categoryRemaining(ACRONYMS, session) === 1, `${categoryRemaining(ACRONYMS, session)}`);

  const afterQBU = reviewerDecides(session, afterPERC.position, true);
  check("Acronyms is now complete", categoryRemaining(ACRONYMS, session) === 0, `${categoryRemaining(ACRONYMS, session)}`);
  check(
    "ONLY the last unit permits leaving -- the reviewer advances to Institutional",
    categoryOf(afterQBU.position, session) === "institutional",
    `landed in ${categoryOf(afterQBU.position, session)} on ${reviewDisplayTargetKey(afterQBU.position)}`
  );
}

console.log("\n--- The pulse/completion path must still advance (regression guard) ---");
{
  // On genuine section completion the UI pins the cursor back onto the
  // completed anchor so the section stays visible while it flashes, then
  // advances after the timer. That anchor is RESOLVED, so the gate must
  // OPEN -- if this fails, the fix has broken the acknowledgement pulse.
  const session: Session = { decisions: {}, dismissals: {} };
  for (const id of ACRONYMS.candidateIds) session.decisions[id] = true;
  for (const pid of ACRONYMS.relationshipProposalIds) decide(session, proposalReviewTarget(pid));

  const completedAnchor = proposalReviewTarget("rel-acronym-QBU");
  const permitted = completionAdvanceIsPermitted(reviewDisplayTargetKey(completedAnchor), stageTargets(session), resolvedOf(session));
  check("the completion advance IS permitted when the cursor sits on completed work", permitted);

  const landing = advanceWithinCategoryScope(
    reviewDisplayTargetKey(completedAnchor),
    categoryTargets(ACRONYMS, session),
    stageTargets(session),
    resolvedOf(session)
  );
  check(
    "a completed category releases the advance into the next category",
    landing !== null && reviewDisplayTargetKey(landing) === "candidate:person:civitas",
    `got ${landing ? reviewDisplayTargetKey(landing) : "null"}`
  );
}

console.log("\n--- Bulk action: the legitimate reason the completion advance exists ---");
{
  // A bulk action resolves the block under the cursor. The cursor is then on
  // resolved work, the gate opens, and the reviewer is carried past it. If
  // this fails, the gate has been made too strict.
  const session: Session = { decisions: {}, dismissals: {} };
  decide(session, candidateReviewTarget("person:may"));
  decide(session, proposalReviewTarget("rel-acronym-ITS"));
  decide(session, proposalReviewTarget("rel-acronym-PERC"));

  const cursorOnResolved = proposalReviewTarget("rel-acronym-PERC");
  check(
    "with the cursor left on bulk-resolved work, the completion advance is permitted",
    completionAdvanceIsPermitted(reviewDisplayTargetKey(cursorOnResolved), stageTargets(session), resolvedOf(session))
  );
  const landing = advanceWithinCategoryScope(
    reviewDisplayTargetKey(cursorOnResolved),
    categoryTargets(ACRONYMS, session),
    stageTargets(session),
    resolvedOf(session)
  );
  check(
    "it carries the reviewer to the category's remaining work (QBU), not out of the category",
    landing !== null && reviewDisplayTargetKey(landing) === "proposal:rel-acronym-QBU",
    `got ${landing ? reviewDisplayTargetKey(landing) : "null"}`
  );
}

console.log("\n--- Candidate units obey the identical contract (I8) ---");
{
  // Same shape, candidate-only category: a live cursor on unresolved work
  // must not be overridden, and the category must not be left.
  const session: Session = { decisions: {}, dismissals: {} };
  const candidateCategory = { id: "institutional", candidateIds: INSTITUTIONAL.candidateIds, relationshipProposalIds: [] as string[] };
  session.decisions["person:civitas"] = true;
  const live = candidateReviewTarget("person:enrollment");
  check(
    "a live candidate cursor on unresolved work blocks the completion advance",
    !completionAdvanceIsPermitted(reviewDisplayTargetKey(live), stageTargets(session), resolvedOf(session))
  );
  const landing = advanceWithinCategoryScope(
    "candidate:person:registrar",
    categoryTargets(candidateCategory as typeof ACRONYMS, session),
    stageTargets(session),
    resolvedOf(session)
  );
  check(
    "a trailing candidate anchor stays inside its category",
    landing !== null && categoryOf(landing, session) === "institutional",
    `got ${landing ? reviewDisplayTargetKey(landing) : "null"}`
  );
}

console.log("\n--- Recovery cases: the gate must not strand the reviewer ---");
{
  const session: Session = { decisions: {}, dismissals: {} };
  check("an absent cursor permits the advance", completionAdvanceIsPermitted(null, stageTargets(session), resolvedOf(session)));
  check(
    "a cursor that has fallen off the target list permits the advance",
    completionAdvanceIsPermitted("candidate:person:deleted", stageTargets(session), resolvedOf(session))
  );
}


/* ==========================================================================
 * CATEGORY ARRIVAL (AG, 2026-08-09) -- a RECURRENCE, captured live:
 *
 *   seq 4  category.arrive  selectStageCategoryCursor
 *          category acronyms -> candidate:person:may (ALREADY RESOLVED)
 *          {candidateCount: 1, proposalCount: 3, remaining: 2}
 *
 * The reviewer opened Acronyms -- two unresolved proposals waiting -- and
 * was placed on a candidate they had already decided, then had to pick a
 * card by hand to start working.
 * ========================================================================== */
console.log("\n--- Category arrival: the first unresolved unit, of EITHER kind ---");
{
  const session: Session = { decisions: {}, dismissals: {} };
  // The exact live state at seq 4: the candidate decided, ITS decided,
  // PERC and QBU still open.
  decide(session, candidateReviewTarget("person:may"));
  decide(session, proposalReviewTarget("rel-acronym-ITS"));

  const targets = [
    candidateReviewTarget("person:may"),
    proposalReviewTarget("rel-acronym-ITS"),
    proposalReviewTarget("rel-acronym-PERC"),
    proposalReviewTarget("rel-acronym-QBU"),
  ];

  // The OLD rule, reproduced so the defect cannot quietly stop being real.
  const oldRule = ACRONYMS.candidateIds.find((id) => !session.decisions[id]) ?? ACRONYMS.candidateIds[0];
  check(
    "REGRESSION (seq 4): the OLD arrival rule lands on an already-resolved candidate",
    oldRule === "person:may" && Boolean(session.decisions[oldRule!]),
    "the arrival defect is no longer reproducible -- re-check the fixture before trusting the fix"
  );

  const landing = firstUnresolvedReviewTarget(targets, resolvedOf(session));
  check(
    "arrival lands on the first UNRESOLVED unit (PERC), not the settled candidate",
    landing !== null && reviewDisplayTargetKey(landing) === "proposal:rel-acronym-PERC",
    `got ${landing ? reviewDisplayTargetKey(landing) : "null"}`
  );
  check("the arrival unit is unresolved", landing !== null && !resolvedOf(session)(landing));
  check(
    "arrival crosses the candidate/proposal seam -- a category whose remaining work is proposals opens on a proposal",
    landing !== null && landing.kind === "proposal"
  );
}

console.log("\n--- Arrival: unchanged where it was already correct ---");
{
  // Candidates lead the display order, so a category with unresolved work of
  // BOTH kinds must still open on a candidate exactly as before. If this
  // fails, the fix has changed behavior it had no business touching.
  const session: Session = { decisions: {}, dismissals: {} };
  const targets = [
    candidateReviewTarget("person:may"),
    proposalReviewTarget("rel-acronym-ITS"),
    proposalReviewTarget("rel-acronym-PERC"),
  ];
  const landing = firstUnresolvedReviewTarget(targets, resolvedOf(session));
  check(
    "a category with unresolved work of both kinds still opens on its first CANDIDATE",
    landing !== null && reviewDisplayTargetKey(landing) === "candidate:person:may",
    `got ${landing ? reviewDisplayTargetKey(landing) : "null"}`
  );

  // Partially worked candidates: skip to the first undecided one.
  const s2: Session = { decisions: {}, dismissals: {} };
  s2.decisions["person:civitas"] = true;
  const candTargets = INSTITUTIONAL.candidateIds.map(candidateReviewTarget);
  const l2 = firstUnresolvedReviewTarget(candTargets, resolvedOf(s2));
  check(
    "a partially worked candidate-only category opens on its first undecided candidate",
    l2 !== null && reviewDisplayTargetKey(l2) === "candidate:person:enrollment",
    `got ${l2 ? reviewDisplayTargetKey(l2) : "null"}`
  );
}

console.log("\n--- Arrival: dismissal counts as resolution ---");
{
  // "Unrelated" resolves a proposal. The old raw-decision-map rule could not
  // express this, so a dismissed proposal still looked like work.
  const session: Session = { decisions: {}, dismissals: {} };
  decide(session, candidateReviewTarget("person:may"));
  session.dismissals["rel-acronym-ITS"] = true;
  const targets = [
    candidateReviewTarget("person:may"),
    proposalReviewTarget("rel-acronym-ITS"),
    proposalReviewTarget("rel-acronym-PERC"),
  ];
  const landing = firstUnresolvedReviewTarget(targets, resolvedOf(session));
  check(
    "a DISMISSED proposal is skipped on arrival, like any other resolved unit",
    landing !== null && reviewDisplayTargetKey(landing) === "proposal:rel-acronym-PERC",
    `got ${landing ? reviewDisplayTargetKey(landing) : "null"}`
  );
}

console.log("\n--- Arrival: a finished category is still inspectable ---");
{
  const session: Session = { decisions: {}, dismissals: {} };
  for (const id of ACRONYMS.candidateIds) session.decisions[id] = true;
  for (const pid of ACRONYMS.relationshipProposalIds) decide(session, proposalReviewTarget(pid));
  const targets = [candidateReviewTarget("person:may"), ...ACRONYMS.relationshipProposalIds.map(proposalReviewTarget)];
  const landing = firstUnresolvedReviewTarget(targets, resolvedOf(session));
  check(
    "a fully resolved category arrives on its FIRST unit rather than nowhere",
    landing !== null && reviewDisplayTargetKey(landing) === "candidate:person:may",
    `got ${landing ? reviewDisplayTargetKey(landing) : "null"}`
  );
  check("an empty category yields no arrival at all", firstUnresolvedReviewTarget([], resolvedOf(session)) === null);
}


/* ==========================================================================
 * ITEM CHECK TRIAGE FIXTURES (AG, 2026-08-09, migration prerequisite).
 *
 * WHY THESE EXIST. Item Check Triage shares `sectionedQueueModel`,
 * `renderSectionedQueue`, `handleTriageKey`, `dispatchReviewWithVisibleAdvance`,
 * `advanceAfterSectionCompletion`, `selectStageCategoryCursor` and BOTH
 * stabilization guards with Ambiguity. Every guard landed during the
 * Ambiguity stabilization therefore went live on Item Check at the same
 * moment -- and until now every acceptance check above used an
 * Ambiguity-shaped fixture. Triage was running unverified stabilization
 * code.
 *
 * These re-run the same contract against ITEM CHECK's shapes. The
 * differences that matter are real, not cosmetic:
 *
 *   - Triage sections are CANDIDATE-HEAVY. Several hold no proposals at
 *     all, which is the shape that previously made the arrival rule's
 *     unreachable proposal branch invisible.
 *   - Triage sections can be TIERED ("Strong Recommendations" / "Needs
 *     Review"), so `sectionGridSequence` emits one grid PER TIER plus a
 *     proposal grid. Ambiguity's live categories are untiered, so the
 *     multi-grid path has never been exercised by an acceptance test.
 *   - Item Check runs LAST in WORKFLOW_STAGE_ORDER, so its candidates can
 *     be resolved by group coverage without a direct decision (see
 *     verify/resolved-predicate-verification.ts). The `resolved` predicate
 *     used here models that.
 * ========================================================================== */
console.log("\n--- Item Check Triage: tiered section, same contract ---");
{
  // A tiered Triage section: two tiers of candidates plus one proposal.
  const TRIAGE_PEOPLE = {
    id: "people",
    candidateIds: ["p:alice", "p:bob", "p:carol", "p:dan"],
    tiers: [
      { candidateIds: ["p:alice", "p:bob"] },
      { candidateIds: ["p:carol", "p:dan"] },
    ],
    relationshipProposalIds: ["rel-people-1"],
  };
  const grids = sectionGridSequence(TRIAGE_PEOPLE);
  check(
    "a tiered section emits one grid per tier plus a proposal grid",
    grids.length === 3 && grids[0]!.length === 2 && grids[1]!.length === 2 && grids[2]!.length === 1,
    grids.map((g) => g.length).join(",")
  );

  const targets = grids.flat();
  const session: Session = { decisions: {}, dismissals: {} };
  const resolved = (t: ReviewDisplayTarget): boolean => {
    if (t.kind === "candidate") return Boolean(session.decisions[t.id]);
    if (session.dismissals[t.id]) return true;
    return (MEMBERS[t.id] ?? ["m1"]).every((id) => Boolean(session.decisions[id]));
  };

  // Arrival on a candidate-heavy tiered section.
  const arrival = firstUnresolvedReviewTarget(targets, resolved);
  check(
    "Triage arrival owns the first unresolved candidate of the FIRST tier",
    arrival !== null && reviewDisplayTargetKey(arrival) === "candidate:p:alice",
    `got ${arrival ? reviewDisplayTargetKey(arrival) : "null"}`
  );

  // Advance walks tier 1 -> tier 2 -> proposal, staying in the section.
  session.decisions["p:alice"] = true;
  const a1 = advanceWithinCategoryScope("candidate:p:alice", targets, targets, resolved);
  check("advance stays inside tier 1", a1 !== null && reviewDisplayTargetKey(a1) === "candidate:p:bob", `got ${a1 && reviewDisplayTargetKey(a1)}`);

  session.decisions["p:bob"] = true;
  const a2 = advanceWithinCategoryScope("candidate:p:bob", targets, targets, resolved);
  check("advance CROSSES the tier boundary into tier 2", a2 !== null && reviewDisplayTargetKey(a2) === "candidate:p:carol", `got ${a2 && reviewDisplayTargetKey(a2)}`);

  session.decisions["p:carol"] = true;
  session.decisions["p:dan"] = true;
  const a3 = advanceWithinCategoryScope("candidate:p:dan", targets, targets, resolved);
  check(
    "advance crosses the candidate/proposal seam into the proposal grid",
    a3 !== null && reviewDisplayTargetKey(a3) === "proposal:rel-people-1",
    `got ${a3 && reviewDisplayTargetKey(a3)}`
  );

  // The boundary guard holds on a tiered section too.
  const stillOpen = targets.some((t) => !resolved(t));
  check("the section still holds unresolved work (the proposal)", stillOpen);
  check(
    "the completion advance is DECLINED while the live cursor is on that unresolved proposal",
    !completionAdvanceIsPermitted("proposal:rel-people-1", targets, resolved)
  );
}

console.log("\n--- Item Check Triage: candidate-only section (no proposals at all) ---");
{
  const TRIAGE_ORGS = { id: "orgs", candidateIds: ["o:acme", "o:globex", "o:initech"], relationshipProposalIds: [] as string[] };
  const NEXT = { id: "places", candidateIds: ["pl:boston"], relationshipProposalIds: [] as string[] };
  const orgTargets = sectionGridSequence(TRIAGE_ORGS).flat();
  const stage = [...orgTargets, ...sectionGridSequence(NEXT).flat()];
  const session: Session = { decisions: {}, dismissals: {} };
  const resolved = (t: ReviewDisplayTarget): boolean => Boolean(session.decisions[t.id]);

  check(
    "a candidate-only section arrives on its first candidate",
    reviewDisplayTargetKey(firstUnresolvedReviewTarget(orgTargets, resolved)!) === "candidate:o:acme"
  );

  session.decisions["o:acme"] = true;
  session.decisions["o:globex"] = true;
  // Trailing anchor, one unit still open BEHIND it -- the seq-70 shape,
  // reproduced with Item Check data.
  // The anchor IS the last remaining unit. `null` is the correct answer --
  // advanceWithinVisibleList's documented "REMAIN on the current item, no
  // wrap" contract. What must NEVER happen is a landing in the next
  // section, and that is what this asserts.
  const landing = advanceWithinCategoryScope("candidate:o:initech", orgTargets, stage, resolved);
  check(
    "with only the anchor left, the advance REMAINS (null) rather than leaving the section",
    landing === null,
    `got ${landing && reviewDisplayTargetKey(landing)}`
  );
  // And from a DIFFERENT anchor, the one open unit is still found inside
  // the section rather than skipped past.
  const fromEarlier = advanceWithinCategoryScope("candidate:o:acme", orgTargets, stage, resolved);
  check(
    "from an earlier anchor it lands on the section's one remaining unit",
    fromEarlier !== null && reviewDisplayTargetKey(fromEarlier) === "candidate:o:initech",
    `got ${fromEarlier && reviewDisplayTargetKey(fromEarlier)}`
  );

  session.decisions["o:initech"] = true;
  const released = advanceWithinCategoryScope("candidate:o:initech", orgTargets, stage, resolved);
  check(
    "once complete, it releases into the next Triage section",
    released !== null && reviewDisplayTargetKey(released) === "candidate:pl:boston",
    `got ${released && reviewDisplayTargetKey(released)}`
  );
}

console.log("\n--- Item Check: a candidate resolved WITHOUT a direct decision ---");
{
  /* GROUP-CARRIED RESOLUTION (prerequisite D1). After Not Quite, a member
   * can be resolved by group coverage while carrying no CandidateDecision.
   * Item Check runs after Group Check, so its queue really contains these.
   * The contract that matters: such a unit must be SKIPPED by arrival and
   * by the advance exactly like any other resolved unit -- if the two
   * disagreed, the reviewer would be parked on work they cannot clear. */
  const SECTION = { id: "people", candidateIds: ["c:1", "c:2", "c:3"], relationshipProposalIds: [] as string[] };
  const targets = sectionGridSequence(SECTION).flat();
  const directDecisions = new Set(["c:1"]);
  const groupCarried = new Set(["c:2"]); // resolved by coverage, no decision
  const resolved = (t: ReviewDisplayTarget): boolean => directDecisions.has(t.id) || groupCarried.has(t.id);

  const arrival = firstUnresolvedReviewTarget(targets, resolved);
  check(
    "arrival SKIPS a group-carried member and owns the genuinely open unit",
    arrival !== null && reviewDisplayTargetKey(arrival) === "candidate:c:3",
    `got ${arrival ? reviewDisplayTargetKey(arrival) : "null"}`
  );
  check(
    "the advance also skips it -- one resolved test for both",
    reviewDisplayTargetKey(advanceWithinCategoryScope("candidate:c:1", targets, targets, resolved)!) === "candidate:c:3"
  );
  check(
    "a section whose only remaining work is group-carried counts as COMPLETE",
    !sectionGridSequence({ id: "x", candidateIds: ["c:1", "c:2"], relationshipProposalIds: [] })
      .flat()
      .some((t) => !resolved(t))
  );
}


/* ==========================================================================
 * ITEM CHECK TRIAGE ON THE CONVEYOR RHYTHM (AG, 2026-08-09, approved).
 *
 * Triage previously used the COMPACTING zone -- "the next 24 unresolved",
 * recomputed after every single decision -- while Ambiguity used the
 * conveyor. Both sectioned stages now share
 * `zonePartition(..., "conveyor")`.
 *
 * These prove the five properties Andrew required before any visual work,
 * over an Item Check-shaped section large enough to exercise the bound
 * (40 cells against a 24 zone and 12-cell chunks).
 * ========================================================================== */
console.log("\n--- Triage on the conveyor: stability, retirement, scope, boundary ---");
{
  const CELLS = Array.from({ length: 40 }, (_, i) => candidateReviewTarget(`t:${String(i).padStart(2, "0")}`));
  const decided = new Set<string>();
  const resolved = (t: ReviewDisplayTarget): boolean => decided.has(t.id);
  const zone = (): ReviewDisplayTarget[] =>
    zonePartition(CELLS, resolved, "conveyor", ZONE_CAPACITY, ZONE_HALF_CAPACITY).active;
  const keys = (cells: readonly ReviewDisplayTarget[]): string => cells.map(reviewDisplayTargetKey).join("|");

  // ---- 1. CELLS DO NOT RECOMPACT AFTER EACH DECISION -------------------
  const zone0 = keys(zone());
  check("the initial active zone holds exactly ZONE_CAPACITY cells", zone().length === ZONE_CAPACITY, String(zone().length));

  decided.add("t:00");
  check("deciding one cell does NOT reshuffle the zone", keys(zone()) === zone0, `${keys(zone()).slice(0, 60)}`);
  decided.add("t:03");
  decided.add("t:07");
  check("deciding several scattered cells still does NOT reshuffle the zone", keys(zone()) === zone0);
  check("the decided cells REMAIN visible in the zone (resolved units stay put)", zone().some((t) => t.id === "t:00"));

  // The compacting rhythm would have pulled t:24..t:26 forward by now --
  // asserted explicitly so "no recompaction" is a measured difference and
  // not merely an absence.
  const compacting = zonePartition(CELLS, resolved, "compacting", ZONE_CAPACITY, ZONE_HALF_CAPACITY).active;
  check(
    "the COMPACTING rhythm would have reshuffled by now (the difference is real)",
    keys(compacting) !== zone0,
    "both rhythms agree here -- this fixture no longer distinguishes them"
  );

  // ---- 2. CHUNK RETIREMENT BEHAVES AS DOCUMENTED -----------------------
  for (let i = 0; i < ZONE_HALF_CAPACITY; i += 1) decided.add(`t:${String(i).padStart(2, "0")}`);
  const afterRetire = zonePartition(CELLS, resolved, "conveyor", ZONE_CAPACITY, ZONE_HALF_CAPACITY);
  check(
    "a FULLY resolved half-zone retires out of the active zone",
    afterRetire.retired.length === ZONE_HALF_CAPACITY,
    String(afterRetire.retired.length)
  );
  check("the retired chunk moves to the END of the queue", keys(afterRetire.ordered).endsWith(keys(afterRetire.retired)));
  check("the active zone refills to capacity from the still-open queue", afterRetire.active.length === ZONE_CAPACITY, String(afterRetire.active.length));
  check("retirement happens in whole chunks, never cell-by-cell", afterRetire.retired.length % ZONE_HALF_CAPACITY === 0);
  check(
    "a PARTIALLY resolved chunk does not retire",
    zonePartition(CELLS, (t) => t.id === "t:13", "conveyor", ZONE_CAPACITY, ZONE_HALF_CAPACITY).retired.length === 0
  );

  // ---- 3. BULK SCOPE MATCHES THE ACTIVE CONVEYOR ZONE ------------------
  /* headingActionScope's rule, modelled: the UNRESOLVED members of the
   * active zone. The safety properties are what matter -- the scope is
   * bounded, materialized, and never larger than the zone. */
  const bulkScope = afterRetire.active.filter((t) => !resolved(t)).map((t) => t.id);
  check("bulk scope is drawn from the ACTIVE zone only", bulkScope.every((id) => afterRetire.active.some((t) => t.id === id)));
  check("bulk scope never exceeds ZONE_CAPACITY", bulkScope.length <= ZONE_CAPACITY, String(bulkScope.length));
  check("bulk scope contains no resolved cell", bulkScope.every((id) => !decided.has(id)));
  check(
    "work is genuinely held back, so the bound is doing something",
    afterRetire.rest.some((t) => !resolved(t))
  );
  check(
    "the scope is materialized -- a control can name exactly what it will touch",
    Array.isArray(bulkScope) && bulkScope.length > 0
  );

  // ---- 4. NO CATEGORY ADVANCE WHILE UNRESOLVED WORK REMAINS ------------
  const NEXT_SECTION = [candidateReviewTarget("next:01")];
  const stage = [...zonePartition(CELLS, resolved, "conveyor", ZONE_CAPACITY, ZONE_HALF_CAPACITY).ordered, ...NEXT_SECTION];
  const categoryOrdered = zonePartition(CELLS, resolved, "conveyor", ZONE_CAPACITY, ZONE_HALF_CAPACITY).ordered;
  const trailing = reviewDisplayTargetKey(categoryOrdered[categoryOrdered.length - 1]!);
  const landing = advanceWithinCategoryScope(trailing, categoryOrdered, stage, resolved);
  check(
    "from the TRAILING cell, the advance stays inside the section while work remains",
    landing !== null && CELLS.some((t) => reviewDisplayTargetKey(t) === reviewDisplayTargetKey(landing)),
    `got ${landing && reviewDisplayTargetKey(landing)}`
  );
  check("the completion advance is DECLINED while an unresolved cell owns the cursor", !completionAdvanceIsPermitted("candidate:t:20", stage, resolved));

  // Only once EVERY cell is resolved may the section be left.
  for (const cell of CELLS) decided.add(cell.id);
  const released = advanceWithinCategoryScope(trailing, categoryOrdered, stage, resolved);
  check(
    "once the whole section is resolved, the advance releases into the next section",
    released !== null && reviewDisplayTargetKey(released) === "candidate:next:01",
    `got ${released && reviewDisplayTargetKey(released)}`
  );
}

console.log("\n--- Triage conveyor: group-carried items never re-enter zone or bulk scope ---");
{
  /* A member resolved by Not Quite coverage carries NO CandidateDecision
   * (verify/resolved-predicate-verification.ts proves this is reachable).
   * Under the unified predicate it is resolved, so it must behave exactly
   * like a directly-decided cell: it may stay VISIBLE, but it must never
   * be offered as work again -- not by the zone's unresolved set, not by
   * bulk scope, and not by the advance. */
  const CELLS = Array.from({ length: 20 }, (_, i) => candidateReviewTarget(`g:${String(i).padStart(2, "0")}`));
  const directDecisions = new Set(["g:00", "g:01"]);
  const groupCarried = new Set(["g:02", "g:03"]); // resolved by coverage only
  const resolved = (t: ReviewDisplayTarget): boolean => directDecisions.has(t.id) || groupCarried.has(t.id);

  const partition = zonePartition(CELLS, resolved, "conveyor", ZONE_CAPACITY, ZONE_HALF_CAPACITY);

  check(
    "group-carried cells are treated as resolved by the zone",
    partition.active.filter((t) => !resolved(t)).every((t) => !groupCarried.has(t.id))
  );
  const bulkScope = partition.active.filter((t) => !resolved(t)).map((t) => t.id);
  check("no group-carried cell appears in bulk scope", bulkScope.every((id) => !groupCarried.has(id)));
  check("no directly-decided cell appears in bulk scope either -- one rule, both kinds", bulkScope.every((id) => !directDecisions.has(id)));
  check(
    "the advance skips group-carried cells exactly like decided ones",
    reviewDisplayTargetKey(advanceWithinCategoryScope("candidate:g:01", partition.ordered, partition.ordered, resolved)!) === "candidate:g:04"
  );
  check(
    "arrival skips them too",
    reviewDisplayTargetKey(firstUnresolvedReviewTarget(partition.ordered, resolved)!) === "candidate:g:04"
  );
  check(
    "a section whose remaining work is ALL group-carried counts as complete",
    !CELLS.slice(0, 4).some((t) => !resolved(t))
  );
  // And they must not be resurrected by retirement: a chunk of purely
  // group-carried cells retires like any other.
  const allCarried = zonePartition(CELLS.slice(0, ZONE_HALF_CAPACITY), () => true, "conveyor", ZONE_CAPACITY, ZONE_HALF_CAPACITY);
  check("a fully group-carried chunk retires rather than re-entering the zone", allCarried.retired.length === ZONE_HALF_CAPACITY, String(allCarried.retired.length));
}

console.log(`\n=== ${passCount} passed, ${failCount} failed ===`);
if (failCount > 0) {
  for (const f of failed) console.log(`  - ${f}`);
  process.exitCode = 1;
}
