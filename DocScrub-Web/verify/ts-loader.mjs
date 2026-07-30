// Node module resolution hook used ONLY by the verification harness
// (verify/*.ts), never shipped and never part of the browser build.
//
// src/io/**/*.ts uses `.js`-suffixed relative import specifiers
// (`./document-text.js`), matching tsconfig.json's `"moduleResolution":
// "Bundler"` convention that the rest of src/ already follows -- a real
// bundler (webpack/vite/esbuild) resolves those against the sibling `.ts`
// file at build time. Node's own ESM resolver has no such convention: a
// `.js` specifier only resolves to a file literally named `.js`.
//
// Rather than write import specifiers two different ways in src/ (one for
// the bundler, one for Node), which would be exactly the kind of
// prototype-specific accommodation Phase 3 is supposed to eliminate, this
// loader teaches Node's resolver the same rule a bundler already applies:
// if a `.js` specifier doesn't resolve to a file that exists, and a `.ts`
// sibling does, resolve to that instead. This lets the verification
// harness run the actual, unmodified src/io/*.ts files -- not a copy, not
// a transpiled build artifact -- directly under
// `node --experimental-strip-types`.
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  if (specifier.endsWith(".js") && (specifier.startsWith("./") || specifier.startsWith("../"))) {
    const candidateUrl = new URL(specifier, context.parentURL);
    const candidatePath = fileURLToPath(candidateUrl);
    if (!existsSync(candidatePath)) {
      const tsPath = candidatePath.replace(/\.js$/, ".ts");
      if (existsSync(tsPath)) {
        return nextResolve(pathToFileURL(tsPath).href, context);
      }
    }
  }
  return nextResolve(specifier, context);
}
