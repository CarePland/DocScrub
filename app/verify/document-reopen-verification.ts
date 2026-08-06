/**
 * Verification harness for the DOCUMENT REOPEN / LIFECYCLE work (AG,
 * 2026-08-03) -- see docs/architecture/design-notes.md's v2026-08-02.32
 * entry. Three independently-motivated changes, all in the
 * "opening a document" path:
 *
 * Part A -- documentIdForBytes/documentIdForFile (src/io/DocumentParser.ts).
 * The reopen prompt must answer "have I seen this file before?" BEFORE
 * paying for an extraction, which is only sound if the pre-parse identity
 * is IDENTICAL to the one a full parse would assign. That equality is the
 * whole load-bearing claim of the feature, so it is asserted directly
 * against a real fixture rather than assumed from shared code.
 *
 * Part B -- ReviewWorkspace.findStoredSession(). Must find a known
 * document, must return null for an unknown one, and -- the subtle
 * requirement -- must NOT mutate `lastOpenedAt`. It runs before the
 * reviewer has decided to open anything, so a reviewer who picks a file and
 * then cancels must leave no trace in the recents ordering. This is exactly
 * why it reads through listRecent() instead of the repository's load(),
 * which stamps lastOpenedAt as a documented side effect.
 *
 * Part C -- ReviewWorkspace.autosaveSettled(). loadDocument() ends with a
 * fire-and-forget autosave so a freshly opened document is immediately
 * resumable; the UI then re-reads the recents list. Before this change that
 * read raced the write and the just-opened document was routinely missing.
 * Verified as the property the UI actually depends on: after awaiting
 * autosaveSettled(), the load's own record is readable.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/document-reopen-verification.ts
 */

import { ReviewWorkspace } from "../src/workspace/Workspace.ts";
import { WorkspaceCommandDispatcher } from "../src/workspace/CommandDispatcher.ts";
import { InMemorySessionRepository } from "./support/InMemorySessionRepository.ts";
import { loadSourceFile } from "./fixture-io.ts";
import { documentIdForBytes, documentIdForFile, OoxmlDocumentParser } from "../src/io/DocumentParser.ts";

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

const FIXTURE = "synthetic-transcript-001";
let clockTick = 0;
/** Distinct, strictly increasing timestamps so a `lastOpenedAt` mutation
 *  would be VISIBLE rather than coincidentally equal to what it replaced. */
function makeSteppingClock(): () => string {
  return () => new Date(Date.UTC(2026, 7, 3, 0, 0, clockTick++)).toISOString();
}

async function flushAutosave(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

console.log("=== Part A: pre-parse identity matches parsed identity ===\n");

{
  const file = loadSourceFile(FIXTURE);
  const preParse = await documentIdForFile(file);
  const parsed = await new OoxmlDocumentParser().parse(file);
  check(
    "documentIdForFile equals the documentId a full parse assigns",
    preParse === parsed.documentId,
    `pre-parse=${preParse.slice(0, 12)}… parsed=${parsed.documentId.slice(0, 12)}…`
  );

  const bytes = new Uint8Array(await file.arrayBuffer());
  check("documentIdForBytes agrees with documentIdForFile", (await documentIdForBytes(bytes)) === preParse);
  check("identity is stable across repeated calls", (await documentIdForFile(file)) === preParse);

  // Different bytes must not collide -- otherwise the prompt would offer to
  // "continue" a genuinely different document's decisions.
  const other = await documentIdForBytes(new Uint8Array([1, 2, 3, 4]));
  check("different bytes yield a different identity", other !== preParse);
}

console.log("\n=== Part B: findStoredSession ===\n");

{
  const repo = new InMemorySessionRepository();
  const workspace = new ReviewWorkspace({ clock: makeSteppingClock(), sessionRepository: repo });
  const dispatcher = new WorkspaceCommandDispatcher(workspace);

  const unknownFirst = await workspace.findStoredSession("no-such-document-id");
  check("unknown document -> null (before anything is loaded)", unknownFirst === null);

  const file = loadSourceFile(FIXTURE);
  const loadResult = await dispatcher.dispatchApplication({ family: "document", type: "load", file });
  check("fixture loads cleanly", loadResult.ok === true, loadResult.ok ? undefined : loadResult.reason);
  await workspace.autosaveSettled();

  const documentId = dispatcher.getState().documentId;
  check("load produced a documentId", typeof documentId === "string" && documentId.length > 0);
  if (!documentId) {
    console.log(`\nFAILURES: ${passCount} passed, ${failCount} failed`);
    process.exit(1);
  }

  // The identity the UI computes from the picked file must be the identity
  // the stored record is keyed by -- the two halves of the feature meeting.
  check("pre-parse identity of the same file matches the loaded documentId", (await documentIdForFile(file)) === documentId);

  const found = await workspace.findStoredSession(documentId);
  check("known document -> a summary", found !== null);
  check("summary is for the right document", found?.documentId === documentId, found?.documentId);

  const unknownAfter = await workspace.findStoredSession("still-no-such-document-id");
  check("unknown document -> null (with a record present)", unknownAfter === null);

  // THE SUBTLE ONE: asking must not disturb recents ordering, or cancelling
  // the prompt would silently reshuffle the reviewer's document list.
  const before = (await workspace.listRecentSessions()).find((s) => s.documentId === documentId);
  await workspace.findStoredSession(documentId);
  await workspace.findStoredSession(documentId);
  const after = (await workspace.listRecentSessions()).find((s) => s.documentId === documentId);
  check(
    "findStoredSession does NOT mutate lastOpenedAt (a cancelled prompt leaves no trace)",
    before?.lastOpenedAt === after?.lastOpenedAt,
    `before=${before?.lastOpenedAt} after=${after?.lastOpenedAt}`
  );
}

console.log("\n=== Part C: autosaveSettled closes the recents race ===\n");

{
  const repo = new InMemorySessionRepository();
  const workspace = new ReviewWorkspace({ clock: makeSteppingClock(), sessionRepository: repo });
  const dispatcher = new WorkspaceCommandDispatcher(workspace);

  const loadResult = await dispatcher.dispatchApplication({ family: "document", type: "load", file: loadSourceFile(FIXTURE) });
  check("fixture loads cleanly", loadResult.ok === true, loadResult.ok ? undefined : loadResult.reason);

  // The exact sequence the UI performs: load, then await settled, then read.
  await workspace.autosaveSettled();
  const recents = await workspace.listRecentSessions();
  const documentId = dispatcher.getState().documentId;
  check(
    "the just-opened document is in Recent Documents immediately after autosaveSettled()",
    recents.some((s) => s.documentId === documentId),
    `recents=${recents.length}`
  );
  check("findStoredSession sees it too", (await workspace.findStoredSession(documentId!)) !== null);

  // Idempotent and safe to await when nothing is pending -- the UI calls it
  // on every load, including ones where the queue is already drained.
  await workspace.autosaveSettled();
  await flushAutosave();
  await workspace.autosaveSettled();
  check("autosaveSettled is safe to await repeatedly", true);
}

console.log(`\n${failCount === 0 ? "ALL PASS" : "FAILURES"}: ${passCount} passed, ${failCount} failed`);
if (failCount > 0) process.exit(1);
