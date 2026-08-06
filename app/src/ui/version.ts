/**
 * version.ts -- single source of truth for the small version label shown
 * next to the DocScrub logo in the app header (index.html/app.ts). Added
 * 2026-07-29 at Andrew's request: "so I know if the page is current."
 *
 * Deliberately manual, not build-generated: this repo has no build step
 * beyond plain `tsc` (no bundler, by design -- see README.md's environment
 * constraints), and a manually-bumped version tied to a real, dated entry
 * in `docs/architecture/design-notes.md` is more informative than an
 * automatic timestamp would be -- it tells Andrew not just "was this
 * rebuilt" but "does what I'm looking at match the last change I know
 * about." Bump this string, in the same commit/session as the change,
 * every time app.ts, index.html, or a stage's UI behavior changes visibly
 * -- and add a one-line entry to design-notes.md explaining what changed.
 * Purely-internal engine/domain changes with no visible UI effect don't
 * need a bump.
 *
 * Format REVISED 2026-07-29 (same day, second change): every version now
 * carries a zero-padded two-digit counter, `v<date>.NN`, starting at `.01`
 * for the FIRST change of the day too -- not just `v<date>` bare. Andrew's
 * own instruction: "append a version number after the date, e.g.
 * v2026-07-29.01 so I can see changes upon refresh" -- a bare same-day
 * `v2026-07-29` can't visibly change again that same day, which defeats the
 * label's one job (proving a refresh picked up the latest build) on exactly
 * the days with more than one change. Bump the counter (`.01` -> `.02` ->
 * ...) for every subsequent same-day change; reset to `.01` on the first
 * change of a new date.
 */
export const APP_VERSION = "v2026-08-03.11";
