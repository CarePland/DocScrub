# Group Check UI Standardization Pass Findings

Date: 2026-08-10

Group Check now uses a focused-group visual adapter and compact
remaining-group cell adapter while preserving its existing group-shaped
interaction model. The focused group composes the shared focus-panel
surface token; non-focused groups remain in the current two-column layout.

No Group Check behavior was intentionally changed. Bare `K/C/R/I/F` remain
focused-group actions, and this pass deliberately does not add
Option/global/Zone actions to Group Check. The existing expanded-member
workflow, including Separate these, Use, Source, member selection, and Not
Quite/Fix this handling, remains in the original render path.

Verified with `npm run typecheck`, `npm run build`,
`verify/group-check-revision-verification.ts`, `verify/ui-smoke.ts`, and
the full `verify/*.ts` sweep. Browser visual click-through remains the one
pending validation item.
