/**
 * preferred-actions-verification.ts -- Proposal-Specific Preferred
 * Actions (2026-07-30). Node-verifiable core: the PURE action policy
 * (preferredActions.ts) -- which proposals expose which accelerators,
 * labeled as resulting states, capped small -- and the structural
 * guarantees that make the shortcuts provably identical to the generic
 * workflow (single shared apply path; no new commands, events, or
 * persistence anywhere in the feature).
 *
 * NOT coverable here (browser-only, disclosed): button rendering,
 * card-local digit keydown behavior, editor cursor placement, and the
 * non-collision with candidate-focus digit shortcuts -- all in the
 * findings checklist.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/preferred-actions-verification.ts
 */

import { readFileSync } from "node:fs";
import { preferredActionsForRelationship } from "../src/ui/preferredActions.js";
import type { RelationshipProposal } from "../src/domain/StructuralRelationship.js";
import type { Candidate } from "../src/domain/DocumentModel.js";

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

function candidate(id: string, displayValue: string): Candidate {
  return {
    id,
    detectedType: "person",
    source: "regex",
    confidence: "medium" as Candidate["confidence"],
    normalizedValue: displayValue.toLowerCase(),
    displayValue,
    occurrenceIds: [`${id}-occ`],
  };
}

function proposal(kind: RelationshipProposal["kind"], candidateIds: string[]): RelationshipProposal {
  return { proposalId: `rel-test-${kind}`, kind, candidateIds, observation: "obs", evidence: "ev" };
}

console.log("--- acronym proposals: two resulting-state labels, existing bulk Change ops ---");
{
  const members = [candidate("c1", "Query Based Update"), candidate("c2", "QBU")];
  const actions = preferredActionsForRelationship(proposal("acronym", ["c1", "c2"]), members);
  check("exactly two preferred actions (full name, then acronym)", actions.length === 2, `got ${actions.length}`);
  check('labels are the RESULTING VALUES verbatim -- "Query Based Update" / "QBU", no verb phrasing', actions[0]?.label === "Query Based Update" && actions[1]?.label === "QBU");
  check(
    "both ops are the EXISTING bulk-change operation with the label as replacement",
    actions[0]?.op.kind === "bulk-change" && actions[0].op.replacement === "Query Based Update" && actions[1]?.op.kind === "bulk-change" && actions[1].op.replacement === "QBU"
  );
  check("no label contains 'Change'/'Rename'/'Use'/'Replace'", actions.every((a) => !/change|rename|use |replace/i.test(a.label)));
}

console.log("--- identifier proposals: one placeholder-labeled action, opening the existing Redact editor ---");
// LABEL REVISED (AG, 2026-08-02): the old bare "________" label said
// nothing about the outcome ("Clicking 1 ____ led to Redact All. I had no
// idea that was going to happen."). The label is now the engine's default
// placeholder -- still a resulting state, but one that names it.
for (const kind of ["numeric-identifier", "alphanumeric-identifier"] as const) {
  const members = [candidate("n1", "123456789"), candidate("n2", "998211443")];
  const actions = preferredActionsForRelationship(proposal(kind, ["n1", "n2"]), members);
  check(
    `${kind}: exactly one action labeled with the default placeholder whose op opens the existing Redact editor`,
    actions.length === 1 && actions[0]?.label === "[REDACTED ID]" && actions[0]?.op.kind === "open-redact-editor"
  );
}

console.log("--- degenerate shapes stay small and safe ---");
{
  const fullsOnly = preferredActionsForRelationship(proposal("acronym", ["c1"]), [candidate("c1", "Query Based Update")]);
  check("an acronym proposal missing one side exposes only the side it has (never a broken pair)", fullsOnly.length === 1 && fullsOnly[0]?.label === "Query Based Update");
  const many = preferredActionsForRelationship(
    proposal("acronym", ["a", "b", "c", "d"]),
    [candidate("a", "Query Based Update"), candidate("b", "Quarterly Business Unit"), candidate("c", "QBU"), candidate("d", "QBU")]
  );
  check("even with many members, at most TWO actions (first full + the acronym) -- no large menus", many.length === 2 && many[0]?.label === "Query Based Update" && many[1]?.label === "QBU");
  check("labels carry NO baked-in digit prefix -- the keycap hint is rendered by the UI, labels stay pure resulting states", many.every((a) => !/^[\d①-⑨]/.test(a.label)));
}

console.log("--- structural guarantees: shortcuts cannot diverge from the generic workflow ---");
{
  const appSource = readFileSync(new URL("../src/ui/app.ts", import.meta.url), "utf8");
  const commandsSource = readFileSync(new URL("../src/domain/Commands.ts", import.meta.url), "utf8");
  const sessionSource = readFileSync(new URL("../src/domain/ReviewSession.ts", import.meta.url), "utf8");
  check(
    "the inline editor's relationship confirm routes through applyRelationshipBulk -- ONE shared path for generic buttons, editor, and shortcuts",
    appSource.includes("applyRelationshipBulk(target.proposalId, target.candidateIds, target.action")
  );
  check(
    "preferred actions call the same shared path / the same existing editor (no parallel dispatch)",
    appSource.includes('applyRelationshipBulk(proposal.proposalId, candidateIds, "Rename", op.replacement)') &&
      appSource.includes('openInlineEditor({ scope: "relationship", proposalId: proposal.proposalId, candidateIds, action: "Redact" })')
  );
  check("no new review command was introduced by this feature (Commands.ts has no 'preferred' vocabulary)", !/preferred/i.test(commandsSource));
  check("no new persistence: ReviewSession gained nothing for preferred actions", !/preferred/i.test(sessionSource));
  check(
    "digit handling has both card-local and selected-card fallback paths, but both route through the same preferred-action helper",
    appSource.includes("card.addEventListener(\"keydown\"") &&
      appSource.includes("function handleCardPreferredDigitKey(") &&
      appSource.includes("function runRelationshipPreferredAction(") &&
      appSource.includes("runRelationshipPreferredAction(proposal, action.op, selectedIds);")
  );
}

console.log(`\n${passCount}/${passCount + failCount} checks passed`);
process.exitCode = failCount === 0 ? 0 : 1;
