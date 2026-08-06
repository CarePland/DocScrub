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

**Avoid classifier vocabulary. Favor reviewer vocabulary.** (AG,
2026-08-04.) Internal rule ids, evidence categories and model diagnostics
are engineering artifacts; reviewer-facing text is a separate register and
must be written as one, never surfaced by copying the internal name. In
practice: 2–4 words where practical; name what the reviewer should
CONCLUDE, not what the algorithm did; recognizable without training; if a
reviewer has to stop and think, rename it. "Token" is the canonical
offender — nobody outside engineering thinks in tokens; they think in
words, names, phrases, emails and organizations.

**Professional tool voice. DocScrub presents evidence; it does not think.**
(AG, 2026-08-04.) DocScrub is a professional analysis tool — not an
assistant, chatbot, coach, friend, or colleague. The reviewer is the
decision-maker. Copy must be objective, precise, calm, and evidence-driven.

- **No anthropomorphism.** The software never thinks, believes, knows,
  finds, notices, decides, determines, or recommends. Describe the
  evidence, the assessment, the detected characteristics, the confidence,
  or the reviewer's decision — never an actor producing them.
  *"We believe this is a person's name"* → *"Almost certainly a person's
  name."*
- **No first-person pronouns.** Not "I", "we", "our", "us" — ever.
- **No conversational companionship.** No "Let's…", "You're all set!",
  "Great job!", "Don't worry", "Thanks for using…". Never promotional,
  never emotionally supportive unless the situation genuinely requires it.
- **Observations over narration.** State what is true, not what the
  software is doing. *"We found several matching names"* → *"Several
  matching names."* *"We couldn't determine…"* → *"Insufficient
  evidence."*

Second person is acceptable where it refers to the reviewer's OWN state or
actions ("your checked items", "the item you were on") — that is objective
description, not companionship. It is narration about the reviewer that is
banned ("You're opening a document you've already worked on" → "This
document has a previous review session").

This applies to exported artifacts too, not only on-screen text: an audit
record written in the first person is exactly what this principle exists to
prevent.

Note this and the vocabulary principle both interact with the oracle rule
above, and the interaction has a
worked precedent: `explanation-dictionary.data.ts`'s `short` register was
a verbatim Python port until it became reviewer-facing, at which point
copying labels written for a different presentation was fidelity to the
letter against the intent. The deviation was taken, declared in the file
that carries it, and the registers that DO feed parity (`standard`,
`expert`) stayed verbatim. Follow that shape: deviate on the reviewer
surface if warranted, never on the compared one, and always in writing.
