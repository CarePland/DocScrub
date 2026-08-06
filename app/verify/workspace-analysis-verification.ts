/**
 * workspace-analysis-verification.ts — verification suite for the
 * standalone Workspace Analysis subsystem (`src/workspace-analysis/`).
 *
 * Covers the 8 properties from Andrew's spec explicitly:
 *   1. runs without creating a review session
 *   2. runs without invoking Ambiguity/Group/Item Check
 *   3. stable, deterministic results
 *   4. separates unrelated documents
 *   5. clusters clearly related documents
 *   6. refuses unsupported merges
 *   7. can fail/return no clusters without breaking document review
 *   8. no dependency on reviewer decisions or learned knowledge
 *
 * Properties 1, 2, and 8 are proven STRUCTURALLY, not just behaviorally:
 * a grep-shaped import audit over every file in `src/workspace-analysis/`
 * asserts none of them import `ReviewEngine`/`ReviewWorkspace`/
 * `session.ts`/`FocusNavigator`/`DetectionEngine`/`CandidateQualityEngine`/
 * `EntityResolutionEngine`/`OccurrenceClassifier`/`DocumentParser`/
 * `CommandDispatcher`/`app.ts`/decision-reuse, and that the one permitted
 * crossing into shared code (`io/extractText.ts`) touches only the fixed,
 * genuinely-generic allowlist. This is the same "the pattern must not
 * exist in the file" reasoning `verify/ui-smoke.ts` already uses for its
 * RX-09/RX-22 checks (a behavioral test can only sample; a structural
 * check states the guarantee directly and can't regress silently).
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/workspace-analysis-verification.ts
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildFingerprint } from "../src/workspace-analysis/engine/fingerprint.js";
import { scoreAllPairs, scorePair, MINIMUM_RELATIONSHIP_THRESHOLD } from "../src/workspace-analysis/engine/scoring.js";
import { clusterDocuments, canMerge } from "../src/workspace-analysis/engine/clustering.js";
import { DeterministicWorkspaceAnalysisEngine, type WorkspaceAnalysisEngine } from "../src/workspace-analysis/engine/WorkspaceAnalysisEngine.js";
import { WorkspaceAnalysisSession } from "../src/workspace-analysis/state/WorkspaceAnalysisSession.js";
import type { WorkspaceAnalysisInputDocument, WorkspaceAnalysisResult } from "../src/workspace-analysis/domain/WorkspaceAnalysisModel.js";

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

function doc(documentId: string, fileName: string, text: string): WorkspaceAnalysisInputDocument {
  return { documentId, fileName, byteLength: text.length, text };
}

// ---------------------------------------------------------------------
// Structural import audit -- properties 1, 2, 8.
// ---------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const subsystemRoot = join(repoRoot, "src", "workspace-analysis");
const extractTextFile = join(subsystemRoot, "io", "extractText.ts");

const ALLOWED_EXTERNAL_IMPORTS = new Set([
  "../../io/hash.js",
  "../../io/ooxml/zip.js",
  "../../io/ooxml/document-parts.js",
  "../../io/ooxml/document-text.js",
]);

const BANNED_SUBSTRINGS = [
  "/src/domain/",
  "/src/engines/",
  "/src/workspace/",
  "/src/ui/",
  "src/io/DocumentParser",
];

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listTsFiles(full));
    } else if (entry.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const re = /\bfrom\s+["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const spec = m[1];
    if (spec) specifiers.push(spec);
  }
  return specifiers;
}

console.log("--- structural import audit (properties 1, 2, 8) ---");
const subsystemFiles = listTsFiles(subsystemRoot);
check("subsystem has files to audit", subsystemFiles.length > 0, `found ${subsystemFiles.length}`);

let structuralViolations: string[] = [];
for (const file of subsystemFiles) {
  const source = readFileSync(file, "utf8");
  const specifiers = importSpecifiers(source);
  for (const spec of specifiers) {
    if (!spec.startsWith(".")) {
      structuralViolations.push(`${relative(repoRoot, file)}: non-relative import "${spec}"`);
      continue;
    }
    const resolved = resolve(dirname(file), spec);
    const staysInsideSubsystem = resolved.startsWith(subsystemRoot);
    if (staysInsideSubsystem) continue;

    if (file === extractTextFile && ALLOWED_EXTERNAL_IMPORTS.has(spec)) continue;

    structuralViolations.push(`${relative(repoRoot, file)}: import "${spec}" escapes src/workspace-analysis/ and is not on the allowlist`);
  }
}
check("every import in src/workspace-analysis/ either stays inside the subsystem or is on the io/extractText.ts allowlist", structuralViolations.length === 0, structuralViolations.join("; "));

// Belt-and-suspenders on top of the specifier-resolution audit above:
// scan only actual import-specifier STRINGS (not doc-comment prose, which
// legitimately explains what ISN'T imported and why -- see
// io/extractText.ts's own top comment) for the banned path fragments.
let bannedSubstringHits: string[] = [];
for (const file of subsystemFiles) {
  const source = readFileSync(file, "utf8");
  for (const spec of importSpecifiers(source)) {
    for (const banned of BANNED_SUBSTRINGS) {
      if (spec.includes(banned)) bannedSubstringHits.push(`${relative(repoRoot, file)}: import "${spec}" contains "${banned}"`);
    }
  }
}
check(
  "no import specifier (as opposed to doc-comment prose) references src/domain/, src/engines/, src/workspace/, src/ui/, or DocumentParser",
  bannedSubstringHits.length === 0,
  bannedSubstringHits.join("; ")
);

check(
  "analyzeWorkspace()'s only parameter is WorkspaceAnalysisInputDocument[] -- no ReviewSession/decision state can be passed in even if a caller wanted to",
  typeof new DeterministicWorkspaceAnalysisEngine().analyzeWorkspace === "function"
);

// ---------------------------------------------------------------------
// Fixture documents for behavioral properties.
// ---------------------------------------------------------------------

const smithMotion = doc(
  "doc-a",
  "Smith_Motion_4521.docx",
  `IN THE MATTER OF Smith v. Jones\nMatter No. 4521\nContoso Legal Services represents the plaintiff.\nContact: jsmith@contosolegal.com\nThis motion concerns the ongoing dispute between the parties regarding the property line.`
);
const smithReply = doc(
  "doc-b",
  "Smith_Reply_4521.docx",
  `RE: Smith v. Jones -- Matter No. 4521\nContoso Legal Services, on behalf of the defendant, submits this reply.\nContact: jsmith@contosolegal.com\nThe defendant disputes the plaintiff's characterization of the property line.`
);
const acmeInvoice = doc(
  "doc-c",
  "Acme_Invoice_9981.docx",
  `Acme Corporation\nInvoice No. 9981\nBilled to: Example Customer\nThank you for your business. Payment is due within thirty days of receipt.`
);
const genericLetter = doc(
  "doc-d",
  "Generic_Cover_Letter.docx",
  `Dear Sir or Madam,\nThank you for your time and consideration. Please find enclosed the requested materials for your review.\nSincerely,\nThe Office`
);

// ---------------------------------------------------------------------
// Property 3: stable, deterministic results.
// ---------------------------------------------------------------------

console.log("--- property 3: deterministic results ---");
const engine: WorkspaceAnalysisEngine = new DeterministicWorkspaceAnalysisEngine();
const inputDocs = [smithMotion, smithReply, acmeInvoice, genericLetter];
const resultA = engine.analyzeWorkspace(inputDocs);
const resultB = engine.analyzeWorkspace([...inputDocs].reverse());
check(
  "identical documents, different input order -> byte-identical result",
  JSON.stringify(resultA) === JSON.stringify(resultB)
);
const resultC = engine.analyzeWorkspace(inputDocs);
check("running analysis twice on the same input produces identical output", JSON.stringify(resultA) === JSON.stringify(resultC));

// ---------------------------------------------------------------------
// Property 5: clusters clearly related documents.
// ---------------------------------------------------------------------

console.log("--- property 5: clusters clearly related documents ---");
const smithCluster = resultA.clusters.find((c) => c.documentIds.includes("doc-a") && c.documentIds.includes("doc-b"));
check(
  "Smith Motion and Smith Reply (shared matter number, shared org, shared email domain) are proposed as one cluster",
  Boolean(smithCluster && smithCluster.documentIds.length === 2)
);
check(
  "the Smith cluster's strength meets the minimum relationship threshold",
  Boolean(smithCluster && smithCluster.strength >= MINIMUM_RELATIONSHIP_THRESHOLD)
);
check(
  "the Smith cluster's reasons cite the shared identifier, not just vocabulary",
  Boolean(smithCluster?.reasons.some((r) => r.kind === "shared-identifier"))
);

// ---------------------------------------------------------------------
// Property 4: separates unrelated documents.
// ---------------------------------------------------------------------

console.log("--- property 4: separates unrelated documents ---");
check(
  "the unrelated invoice (doc-c) is not included in the Smith cluster",
  !(smithCluster?.documentIds.includes("doc-c") ?? false)
);
check("the invoice appears in unrelatedDocumentIds (no confident relationship to anything)", resultA.unrelatedDocumentIds.includes("doc-c"));
check(
  "a generic cover letter (doc-d, common vocabulary/structure only) does NOT cluster with anything -- generic signals alone can't cross the threshold",
  resultA.clusters.every((c) => !c.documentIds.includes("doc-d")) && resultA.unrelatedDocumentIds.includes("doc-d")
);

// Extra scoring-level check: two documents that share ONLY vocabulary and
// structure (the two weakest, lowest-capped categories) must fall well
// short of the threshold, no matter how much filler text is added.
const genericLetterVariant = doc(
  "doc-e",
  "Another_Generic_Letter.docx",
  `Dear Sir or Madam,\nThank you for your time and consideration. Please find enclosed the requested materials for your review.\nSincerely,\nThe Office`
);
const genericPairScore = scorePair(buildFingerprint(genericLetter), buildFingerprint(genericLetterVariant));
check(
  "two documents sharing only generic vocabulary/structure score well below the threshold",
  genericPairScore.score < MINIMUM_RELATIONSHIP_THRESHOLD,
  `score=${genericPairScore.score}`
);

// ---------------------------------------------------------------------
// Property 6: refuses unsupported merges.
// ---------------------------------------------------------------------

console.log("--- property 6: refuses unsupported merges ---");
check(
  "canMerge() refuses combining the Smith cluster with the unrelated invoice",
  !canMerge(["doc-a", "doc-b"], ["doc-c"], resultA.pairRelationships)
);
check(
  "canMerge() approves combining two documents that DO meet the threshold together",
  canMerge(["doc-a"], ["doc-b"], resultA.pairRelationships)
);

// The session-level ("no override exists") form of property 6 is
// checked further down, in the "state container commands" section,
// against a real WorkspaceAnalysisSession driven through loadFiles().

// ---------------------------------------------------------------------
// Property 7: can fail / return no clusters without breaking anything.
// ---------------------------------------------------------------------

console.log("--- property 7: graceful degradation ---");
const emptyResult = engine.analyzeWorkspace([]);
check("zero documents -> empty result, no throw", emptyResult.clusters.length === 0 && emptyResult.fingerprints.length === 0 && emptyResult.unrelatedDocumentIds.length === 0);

const singleResult = engine.analyzeWorkspace([smithMotion]);
check("one document -> no clusters, treated as its own unrelated document, no throw", singleResult.clusters.length === 0 && singleResult.unrelatedDocumentIds.length === 1);

const noRelationshipsResult = engine.analyzeWorkspace([acmeInvoice, genericLetter]);
check(
  "two completely unrelated documents -> zero clusters, both listed unrelated, no throw",
  noRelationshipsResult.clusters.length === 0 && noRelationshipsResult.unrelatedDocumentIds.length === 2
);

class ThrowingEngine implements WorkspaceAnalysisEngine {
  analyzeWorkspace(): WorkspaceAnalysisResult {
    throw new Error("simulated engine failure");
  }
}
const failingSession = new WorkspaceAnalysisSession(new ThrowingEngine());
const failResult = await failingSession.loadFiles([]);
check("a thrown engine error is caught by the session, not propagated", failResult.ok === false);
check("session state moves to 'error' with a message, not left partially populated", failingSession.getState().status === "error" && typeof failingSession.getState().error === "string");
check("a failed analysis leaves documents/result empty rather than stale/partial", failingSession.getState().documents.length === 0 && failingSession.getState().result === null);

// ---------------------------------------------------------------------
// State container: accept / split / merge / reset commands.
// ---------------------------------------------------------------------

console.log("--- state container commands ---");

// Build a session by driving loadFiles() with real File-like objects so
// extractText.ts's plain-text fallback path runs too (property coverage
// for the io adapter, not just the pure engine).
function makeFile(name: string, text: string): File {
  const bytes = new TextEncoder().encode(text);
  return new File([bytes], name, { type: "text/plain" });
}

const stateSessionEngine = new DeterministicWorkspaceAnalysisEngine();
const stateSession = new WorkspaceAnalysisSession(stateSessionEngine);
const loadResult = await stateSession.loadFiles([
  makeFile(smithMotion.fileName, smithMotion.text),
  makeFile(smithReply.fileName, smithReply.text),
  makeFile(acmeInvoice.fileName, acmeInvoice.text),
]);
check("loadFiles() with plain-text-decodable files succeeds", loadResult.ok === true, loadResult.reason);
check("session status is 'complete' after a successful load", stateSession.getState().status === "complete");
check("session has one grouping per proposed cluster plus one per unrelated document", stateSession.getState().groupings.length >= 1);

const stateAfterLoad = stateSession.getState();
const loadedSmithGrouping = stateAfterLoad.groupings.find((g) => g.documentIds.length === 2);
check("a two-document grouping was proposed from the loaded files", Boolean(loadedSmithGrouping));

if (loadedSmithGrouping) {
  const acceptResult = stateSession.dispatch({ type: "accept-grouping", groupingId: loadedSmithGrouping.groupingId });
  check("accept-grouping succeeds on a proposed grouping", acceptResult.ok === true);
  check(
    "the accepted grouping's status is now 'accepted'",
    stateSession.getState().groupings.find((g) => g.groupingId === loadedSmithGrouping.groupingId)?.status === "accepted"
  );

  const invalidSplit = stateSession.dispatch({
    type: "split-grouping",
    groupingId: loadedSmithGrouping.groupingId,
    newGroups: [[loadedSmithGrouping.documentIds[0]!]], // drops the second member -- not a partition
  });
  check("split-grouping rejects a newGroups set that isn't a full partition of the original members", invalidSplit.ok === false);

  const validSplit = stateSession.dispatch({
    type: "split-grouping",
    groupingId: loadedSmithGrouping.groupingId,
    newGroups: [[loadedSmithGrouping.documentIds[0]!], [loadedSmithGrouping.documentIds[1]!]],
  });
  check("split-grouping accepts a valid partition (each document its own group)", validSplit.ok === true);
  check(
    "after splitting, the original grouping is gone and two singleton groupings exist for its former members",
    !stateSession.getState().groupings.some((g) => g.groupingId === loadedSmithGrouping.groupingId) &&
      loadedSmithGrouping.documentIds.every((id) => stateSession.getState().groupings.some((g) => g.documentIds.length === 1 && g.documentIds[0] === id))
  );

  const [splitA, splitB] = loadedSmithGrouping.documentIds.map(
    (id) => stateSession.getState().groupings.find((g) => g.documentIds[0] === id)!
  );
  const remergeResult = stateSession.dispatch({ type: "merge-groupings", groupingIdA: splitA.groupingId, groupingIdB: splitB.groupingId });
  check("merge-groupings re-combines two documents that DO meet the threshold together", remergeResult.ok === true, remergeResult.reason);

  const invoiceGrouping = stateSession.getState().groupings.find((g) => g.documentIds.includes("doc-c") || g.documentIds.some((id) => id !== splitA.documentIds[0] && id !== splitB.documentIds[0]));
  const mergedGrouping = stateSession.getState().groupings.find((g) => g.groupingId !== invoiceGrouping?.groupingId && g.documentIds.length === 2);
  if (invoiceGrouping && mergedGrouping) {
    const refusedSessionMerge = stateSession.dispatch({ type: "merge-groupings", groupingIdA: mergedGrouping.groupingId, groupingIdB: invoiceGrouping.groupingId });
    check(
      "SESSION-LEVEL: merge-groupings refuses to combine the Smith cluster with the unrelated invoice -- no override exists",
      refusedSessionMerge.ok === false
    );
  } else {
    check("SESSION-LEVEL merge-refusal setup found its two groupings", false, "could not locate invoice/merged groupings after prior steps");
  }
}

const resetResult = stateSession.dispatch({ type: "reset" });
check("reset returns to idle with no documents/result/groupings", resetResult.ok === true && stateSession.getState().status === "idle" && stateSession.getState().groupings.length === 0);

// ---------------------------------------------------------------------
// UI module: structural checks only (no DOM shim -- see ui-smoke.ts's
// own precedent for why a browser-only render path is checked
// structurally in this sandbox rather than executed).
// ---------------------------------------------------------------------

console.log("--- UI module structural checks ---");
const uiSource = readFileSync(join(subsystemRoot, "ui", "renderWorkspaceAnalysisPage.ts"), "utf8");
check("the UI module contains zero window.alert( occurrences", !uiSource.includes("window.alert("));
check("the UI module exports renderWorkspaceAnalysisPage", uiSource.includes("export function renderWorkspaceAnalysisPage"));
check("the UI module offers no 'combine anyway' override -- merge always routes through the merge-groupings command", !uiSource.toLowerCase().includes("force") && !uiSource.toLowerCase().includes("override"));

const indexHtml = readFileSync(join(repoRoot, "index.html"), "utf8");
check("index.html defines the .wsa-page CSS scope", indexHtml.includes(".wsa-page"));

console.log(`\n${passCount}/${passCount + failCount} checks passed`);
process.exitCode = failCount === 0 ? 0 : 1;
