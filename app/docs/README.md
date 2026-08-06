# DocScrub Documentation Map

Status: canonical
Last updated: 2026-08-03

How to read this document: this is the starting point for the DocScrub
documentation set. It tells you which document answers which question,
which documents are living truth versus historical record, and which are
planned but not yet written. The rules behind the structure are in
`standards/documentation-standards.md`.

---

## The three document classes

**Canonical** documents describe current truth and are updated in the
same change as the behavior they describe. They live under `app/docs/`.

**Historical** documents are the immutable record of what happened and
why it was decided — findings, gate records, spikes, superseded
specifications. They are never rewritten; at most they receive a dated
amendment or a status banner. `app/docs/detection/` is the largest body
of these.

**Working** documents are session-scoped plans, reviews, and findings
from active work. They currently live at the repository root (one level
above `app/`), not inside `app/docs/`. A working document is either
eventually promoted (its durable conclusions land in a canonical or
historical document) or retired. **Working documents cannot be cited as
canonical authority**, whatever their quality.

The canonical layer answers "how does DocScrub behave and why."
The findings archive answers "what happened in each implementation pass."
Do not reconstruct current truth by replaying the archive when a
canonical document exists; do not treat a canonical summary as a
substitute for the archive when investigating a past decision.

## Where to find what

| Question | Document | Class |
|---|---|---|
| What is DocScrub? Who reviews? What may automation do? | `product/product-overview.md` | canonical |
| Two comparable designs — which one do we build? | `product/product-overview.md#primary-product-principle` — the governing principle; every other named principle elaborates it | canonical |
| What does this term mean? Which label is authoritative? | `product/glossary.md` | canonical |
| What behavior must never break? | `product/invariants.md` | canonical |
| What product ideas exist but aren't scheduled? | `product/future-features.md` | canonical (all entries `[SPECULATIVE]`) |
| How does the review workspace behave, in detail? | `architecture/review-workspace-specification.md` | canonical |
| What is the target architecture? | `architecture/DocScrub-Web_Target_Architecture_v0.2.docx` (historical original); a markdown `architecture-overview.md` is **planned, not yet written** (initiative Phase 4). Interim: the specification above plus `../README.md`'s Layout section. | historical / planned |
| Which OOXML constructs are supported? | `ooxml-spike/construct-support-matrix.md` (promotion to a living `architecture/ooxml-support.md` is **planned**, Phase 4) | historical, still accurate |
| How does keyboard interaction work? | `reviewer/keyboard-interaction.md` is **planned, not yet written** (Phase 3, deliberately after the reviewer-experience waves land). Interim: `architecture/review-workspace-specification.md` §7 and §10, `src/engines/navigation/keymap.ts`'s doc comments, and the root-level keyboard working documents (working class — not authority). | planned |
| What happened in implementation pass X? | `detection/` — phase, milestone, feature, and revision findings | historical |
| What were the migration gates and how did they close? | `architecture/phase-1-acceptance-criteria.md` | historical |
| How do I document work? What are the doc rules? | `standards/documentation-standards.md` | canonical |
| How must implementation itself be conducted and reported? | `architecture/implementation-philosophy.md` (standing requirement) | canonical |
| What changed in the UI, version by version? | `architecture/design-notes.md` | canonical (changelog) |
| Why was architectural decision ADR-NNN made? | `architecture/decisions/index.md` — the extracted register, ADR-001..018 (retroactive records; originals in the v0.2 docx §16 and the ARB report at the repository root) plus ADR-019 onward (decided at implementation time, going forward) | canonical |
| What is Workspace Analysis, and how is it independent of the review pipeline? | `detection/feature-003-workspace-analysis.md` (what/how); `architecture/decisions/ADR-019-workspace-analysis-independence.md` (why, as a decision) | historical / canonical |
| How did the project get here? | `architecture/product-evolution.md` — the narrative: oracle era, ARB review, migration gates, features/milestones, interaction waves | historical (narrative) |

## Areas

**`product/`** — canonical product layer: `product/product-overview.md`,
`product/glossary.md`, `product/invariants.md`,
`product/future-features.md` (unscheduled, `[SPECULATIVE]` concepts —
distinct from `architecture/reviewer-experience-backlog.md`'s scoped,
prioritized RX-NN items).

**`architecture/`** — the behavioral specification (canonical anchor),
implementation philosophy, the UI changelog, the historical architecture
originals (`.docx` + acceptance criteria), the product-evolution
narrative, the superseded reconstruction/review documents (each bannered
with its status), and `decisions/` — the ADR register.

**`standards/`** — how documentation and implementation reporting work.
`verification-standards.md` is planned, Phase 4.

**`detection/`** — **the immutable historical findings archive.** It is
deliberately not being reorganized, renamed, or rewritten: dozens of
cross-references depend on these paths, and append-only findings are this
project's decision record. New features continue to land findings here.

**`ooxml-spike/`** — closed historical record of the Phase 1/2 OOXML
feasibility work, plus the construct support matrix.

**`reviewer/`** — planned area (Phase 3): `reviewer-workflow.md`,
`keyboard-interaction.md`, `ui-design-guide.md`. Not yet created;
sequenced after the reviewer-experience waves land so the documents
describe the settled interaction model.

## Planned but not yet written

For clarity, everything referenced above that does not exist yet:
`architecture/architecture-overview.md`, `architecture/domain-model.md`,
`architecture/ooxml-support.md`, `reviewer/` (all three documents), and
`standards/verification-standards.md` are planned under the initiative's
Phases 3–4 (`../../20260730-documentation-initiative-plan.md`). Nothing
in this map should be read as claiming those documents exist today.
Phase 2 (ADR extraction, README split, product-evolution narrative) was
completed 2026-07-30.
