/**
 * ui-smoke.ts — Phase 10. A bounded, honest sanity check for src/ui/app.ts,
 * NOT a substitute for opening the page in a real browser. This sandbox has
 * no GUI browser or browser-automation tool available (see phase-10-
 * findings.md's disclosure), so this suite exists to catch the class of bug
 * a real browser would catch immediately and a plain `tsc --noEmit` cannot:
 * wrong DOM API usage, a top-level throw during initial render, or an
 * import that resolves at typecheck time but not at actual module-load
 * time.
 *
 * Provides the minimum fake `document`/`window` surface app.ts's initial
 * ("no document loaded yet") render path and keydown-listener registration
 * actually touch, then imports the REAL compiled dist/ui/app.js (produced
 * by a plain `tsc` emit -- see README.md's Phase 10 section) and confirms
 * module evaluation completes without throwing. It does not simulate
 * clicking buttons, loading a document, or any interactive flow -- that
 * requires either a real browser or a much larger DOM shim, neither of
 * which is a good use of effort for a "deliberately plain," functional-
 * integration-only UI. A real click-through in a browser remains a
 * recommended follow-up (see this suite's own final note).
 *
 * Run with (after `tsc` has emitted dist/ -- see package.json's "build" script):
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/ui-smoke.ts
 */

import { existsSync } from "node:fs";

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

class FakeClassList {
  private readonly classes = new Set<string>();
  add(name: string): void {
    this.classes.add(name);
  }
}

class FakeElement {
  tagName: string;
  children: FakeElement[] = [];
  attributes: Record<string, string> = {};
  textContent = "";
  disabled = false;
  title = "";
  classList = new FakeClassList();
  className = "";
  private listeners: Record<string, Array<() => void>> = {};
  files: unknown[] | null = null;

  constructor(tag: string) {
    this.tagName = tag.toUpperCase();
  }
  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
  appendChild(child: FakeElement): FakeElement {
    this.children.push(child);
    return child;
  }
  removeChild(child: FakeElement): FakeElement {
    this.children = this.children.filter((c) => c !== child);
    return child;
  }
  addEventListener(kind: string, handler: () => void): void {
    (this.listeners[kind] ??= []).push(handler);
  }
  set innerHTML(_value: string) {
    this.children = [];
  }
  get innerHTML(): string {
    return "";
  }
}

function installFakeDom(): { app: FakeElement } {
  const app = new FakeElement("div");
  const body = new FakeElement("body");
  const documentListeners: Record<string, Array<(e: unknown) => void>> = {};

  const fakeDocument = {
    getElementById: (id: string) => (id === "app" ? app : null),
    createElement: (tag: string) => new FakeElement(tag),
    addEventListener: (kind: string, handler: (e: unknown) => void) => {
      (documentListeners[kind] ??= []).push(handler);
    },
    body,
    activeElement: null,
  };

  const fakeWindow = {
    alert: (_message: string) => {},
    prompt: (_message: string) => null,
  };

  const fakeURL = {
    createObjectURL: (_blob: unknown) => "blob:fake",
    revokeObjectURL: (_url: string) => {},
  };

  // @ts-expect-error -- deliberately installing minimal fakes for a Node smoke test, not real DOM types.
  globalThis.document = fakeDocument;
  // @ts-expect-error -- see above.
  globalThis.window = fakeWindow;
  // @ts-expect-error -- see above.
  globalThis.URL = { ...URL, ...fakeURL };

  return { app };
}

async function main(): Promise<void> {
  console.log("--- dist/ build output exists ---");
  const distExists = existsSync(new URL("../dist/ui/app.js", import.meta.url));
  check("dist/ui/app.js exists (run `tsc` from DocScrub-Web/ first if this fails)", distExists);
  if (!distExists) {
    console.log(`\n${passCount}/${passCount + failCount} checks passed`);
    process.exitCode = 1;
    return;
  }

  console.log("--- Importing the real compiled UI module against a fake DOM ---");
  const { app } = installFakeDom();
  let threw: unknown = null;
  try {
    await import("../dist/ui/app.js");
  } catch (error) {
    threw = error;
  }
  check("importing dist/ui/app.js does not throw during initial module evaluation", threw === null, threw instanceof Error ? threw.message : String(threw));
  check("the initial ('no document loaded') render populated #app with content", app.children.length > 0);
  check(
    "the initial render shows the 'no document loaded' message, not a stale or empty state",
    app.children.some((child) => child.textContent.includes("No document loaded"))
  );

  console.log("\nNOTE: this is a structural sanity check against a minimal fake DOM, not a");
  console.log("real-browser click-through. No GUI browser or browser-automation tool was");
  console.log("available in this sandbox -- see phase-10-findings.md. Recommended follow-up:");
  console.log("open ui/index.html (served over http, not file://) in an actual browser and");
  console.log("click through load -> review -> save/reload -> generate output by hand.");

  console.log(`\n${passCount}/${passCount + failCount} checks passed`);
  process.exitCode = failCount === 0 ? 0 : 1;
}

main();
