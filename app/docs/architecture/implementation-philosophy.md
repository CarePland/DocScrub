# Implementation Philosophy & Documentation Standard

**Status: STANDING REQUIREMENT.** Adopted 2026-07-30 by Andrew's explicit
instruction (`20260730-DocScrub-responsetoClaude-ImplementationFindings.docx`):
"a philosophy about documentation that needs to be incorporated henceforth
for all chats, prompts, builds, regardless of AI tool or interpreter. Thus,
the documentation needs to be explicit enough to make it clear this is a
requirement without my mentioning it every time I ask for something."

This applies to every specification document, prompt, chat instruction, and
build task for this repository, from any AI tool or human engineer. The two
sections below are Andrew's own text, verbatim.

---

## Implementation Philosophy

This document is intended to function as an engineering specification
rather than a design discussion.

Where behavior is explicitly described, implement that behavior faithfully
rather than designing an alternative that seems preferable. The goal is to
reproduce the intended reviewer experience, not to reinterpret it.

If a requirement appears inconsistent with the current implementation or
architecture:

- Preserve the stated reviewer behavior whenever reasonably possible.
- If implementation requires an architectural adjustment, make the smallest
  change necessary.
- If the requirement cannot reasonably be implemented, stop and explain the
  constraint rather than silently substituting a different interaction.

Unless explicitly requested, do not:

- redesign workflows
- rename concepts
- introduce new abstractions
- simplify by removing specified behavior
- replace specified interactions with ones that appear more conventional

When screenshots are provided, they are behavioral and layout references,
not merely illustrations. Small visual differences are acceptable where
required by the browser implementation, but the reviewer workflow,
information hierarchy, and interaction model should remain equivalent.

## Documentation Standard

This specification intentionally documents why behavior exists, not merely
what it does.

When modifying or extending the implementation:

- Preserve documented user-facing behavior unless the specification
  explicitly changes it.
- Treat comments describing reviewer workflow as part of the product
  contract, not incidental implementation notes.
- If a documented behavior is discovered to be incorrect, obsolete, or
  internally inconsistent, identify it explicitly in the implementation
  report rather than silently changing it.

When making an implementation judgment that is not fully specified,
document:

- the assumption made,
- why it was chosen,
- any reasonable alternatives considered,
- and the potential reviewer impact.

The objective is that a future engineer should be able to understand both
how the system behaves and why that behavior exists, without
reverse-engineering intent from the code.

---

## How this repository already embodies it (orientation for new sessions)

- `src/ui/app.ts` and every engine carry doc comments recording the
  *reasoning* behind decisions (who asked, why, what alternatives were
  rejected). Those comments are product contract. Update them in the same
  commit as any behavior change; never delete the rationale to satisfy a
  grep or a lint.
- Every implementation pass ends with a findings/implementation report
  (repo-parent root `*-findings.md` and `docs/detection/*-findings.md`)
  that separates verified-by-suite from pending-live-validation, and lists
  every judgment call with its assumption, reasoning, and reviewer impact.
- The Python application (`work/pii_docx_redactor/`) is the behavioral
  oracle; intentional deviations are always classified and recorded, never
  silent.
- Where this document governs *how* work is conducted and reported, the
  **Primary Product Principle**
  (`../product/product-overview.md#primary-product-principle`) governs
  *which* design to choose when the specification leaves a genuine choice
  open. The two are complementary: this document says do not redesign
  what is specified; that one says what to prefer where nothing is
  specified. Neither authorizes trading reviewer control for reviewer
  effort.
