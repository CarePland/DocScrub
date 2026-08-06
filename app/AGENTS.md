# DocScrub-Web — Standing Instructions

STANDING REQUIREMENT (2026-07-30, per Andrew, applies to every chat,
prompt, and build task in this repository regardless of AI tool): follow
`docs/architecture/implementation-philosophy.md` — the Implementation
Philosophy and Documentation Standard — without being told each time.
The short form:

**Implementation Philosophy.** Specification documents are engineering
specifications, not design discussions. Where behavior is explicitly
described, implement it faithfully rather than designing a preferable
alternative — the goal is to reproduce the intended reviewer experience,
not reinterpret it. If a requirement conflicts with the current
architecture: preserve the stated reviewer behavior whenever reasonably
possible; make the smallest architectural adjustment necessary; and if it
cannot reasonably be implemented, stop and explain the constraint rather
than silently substituting a different interaction. Unless explicitly
requested, do not redesign workflows, rename concepts, introduce new
abstractions, simplify by removing specified behavior, or replace
specified interactions with more conventional ones. Screenshots are
behavioral and layout references, not illustrations — small visual
differences are acceptable where the browser requires them, but the
reviewer workflow, information hierarchy, and interaction model must stay
equivalent.

**Documentation Standard.** Document why behavior exists, not merely what
it does. Comments describing reviewer workflow are part of the product
contract, not incidental notes — preserve documented user-facing behavior
unless a specification explicitly changes it, and if a documented behavior
proves incorrect, obsolete, or inconsistent, identify it explicitly in the
implementation report rather than silently changing it. For every judgment
not fully specified, document the assumption made, why it was chosen, the
alternatives considered, and the potential reviewer impact. A future
engineer must be able to understand how the system behaves and why,
without reverse-engineering intent from the code.

Repository practices that operationalize this:

- The Python app (`../work/pii_docx_redactor/`) is the behavioral oracle;
  every intentional deviation is classified and recorded, never silent.
- Every pass ends with a findings report separating suite-verified from
  pending-live-browser-validation, plus an explicit judgment-call list.
- Run `npx tsc --noEmit`, `npm run build` (full emit — the browser serves
  `dist/`), and every `verify/*.ts` suite (count them with
  `ls verify/*.ts | wc -l`; never trust a remembered count). Zero
  regressions; never weaken a suite expectation to pass.
- The domain boundary is hard: `FocusNavigator`/`navigator.ts`/`keymap.ts`
  never depend on rendered/UI-only state; visible ordering, panels, and
  presentation toggles live in the UI layer.
- The durable decision vocabulary (`CandidateDecisionKind`'s "Rename",
  command names, serialized session/audit formats) is display-mapped, never
  renamed.
