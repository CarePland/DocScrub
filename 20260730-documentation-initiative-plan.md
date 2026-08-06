# DocScrub Documentation Initiative — Evaluation and Plan

**Class: working (2026-07-30).** The controlling plan for the documentation initiative. Phases 0–2 were implemented 2026-07-30 (Phase 2: ADR register extracted to `app/docs/architecture/decisions/`, README split, product-evolution narrative written); see `app/docs/README.md` (the documentation map) for the resulting structure. Phases 3–4 remain.

Status: working document (proposal for decision, not yet canonical).
Date: 2026-07-30.
Inputs: the full `app/docs/` corpus, `app/README.md`, root-level working
documents, `docs/architecture/`, the Python oracle's README, and the
CarePland documentation set as the quality benchmark (style only, not
subject matter).

Decisions already made by Andrew for this plan: the deliverable is this
plan document only (documents get written in later sessions), and the
canonical documentation root consolidates under `app/docs/`.

---

## 1. What the benchmark actually is

Distilling the CarePland set into transferable properties, since "match
its quality" needs to be concrete. The properties that matter:

- **Intent before implementation.** Docs open with a principle or purpose
  ("The CarePland Principle", "North Star") before any mechanism.
- **Explicit boundaries.** "What's Explicitly Not V1", "Explicit
  Boundaries", "Architectural Anti-Patterns" — what a thing is *not* is
  documented with the same care as what it is.
- **Named durable invariants.** Product Promises gives each protected
  behavior a stable kebab-case name, a one-paragraph definition, and
  maintenance rules for when the list itself changes.
- **A single living context document** with a "How To Use This Document"
  section, a `Last updated` date, and an explicit rule that obsolete
  content is deleted, not preserved for sentiment.
- **Per-feature foundation documents** with a stable shape: model,
  current surface, explicit boundaries, later connections, TODOs.
- **Terminology as a first-class section**, not a byproduct.
- **Separation of living truth from historical narrative** (Stable
  Project Context vs. Git History and Product Evolution).
- **Templates for recurring records** (release validation) so rigor
  doesn't depend on memory.

DocScrub already exceeds the benchmark in one respect: the
`[BUILT]` / `[DESIGNED]` / `[SPECULATIVE]` status-marking convention in
`review-workspace-specification.md`, with per-claim citations, is
stronger evidence discipline than anything in the CarePland set. This
plan proposes adopting it as a set-wide standard rather than a one-off.

---

## 2. Evaluation of the current documentation

### 2.1 What is already strong

This corpus is unusually good at the thing most projects never achieve:
recording *why*. Specifically:

- **The findings-document discipline.** Every phase, milestone, feature,
  and revision has a findings record separating verified-by-suite from
  pending-live-validation, listing every judgment call with its
  assumption and reviewer impact, and classifying every deviation from
  the Python oracle. This is a complete decision archaeology. Nothing
  needs to be invented here — only indexed and protected.
- **`review-workspace-specification.md`** is already a canonical-grade
  document: authoritative behavioral specification, status-marked claims,
  citations, preserved reversals ("the reasoning behind a reversal is
  itself part of the specification"). It is the anchor the rest of the
  set should be built around.
- **`implementation-philosophy.md`** is a standing requirement that
  already codifies the documentation culture (comments as product
  contract, judgment calls documented, oracle deviations never silent).
  It is the seed of the future Implementation Standards document.
- **`design-notes.md`** is a healthy lightweight pattern: dated,
  one-entry-per-visible-version, explicitly the "short, dated *what*"
  deferring to findings docs for the *why*.
- **`ooxml-spike/construct-support-matrix.md`** and
  **`fixtures/README.md`** are quiet examples of durable reference docs.
- **`spike/SUPERSEDED.md`** proves the supersession-marker pattern
  already exists in this repo. It just isn't applied consistently.

### 2.2 Structural weaknesses

**W1 — The corpus is chronological, not canonical.** Almost every
document is a record of a session (phase, milestone, feature, revision,
wave). Current truth must be reconstructed by reading history in order
and mentally applying each amendment. Only the specification escapes
this. The benchmark's core move — a living current-truth layer distinct
from an immutable historical layer — is missing.

**W2 — The README demonstrates W1's failure mode.** It declares "this
README describes current state, not how it was built," then spends ~90%
of its length on accreted build history. It now contradicts itself:
the Layout section still says the UI uses "`window.prompt()` for
Rename/Redact text entry" (line ~541) while the Features section
records the revision that removed every `window.prompt()` call. Both
statements are in the same file today. Running check-counts in prose
("(604 total)", "(711 total)", "(781 total)") appear in a dozen places
and age the same way.

**W3 — No product overview exists.** Nothing states what DocScrub is,
who the reviewer is, or the core philosophy. The project's own
load-bearing vocabulary — the Sock Principle, "Completion Beats
Movement", "minimize UI manipulation time, maximize evidence-evaluation
time" — lives in a `.docx` review report and in quoted fragments inside
other docs. A new contributor cannot currently find the product's
purpose in any text file.

**W4 — The canonical architecture is a `.docx` outside the text
corpus.** `DocScrub-Web_Target_Architecture_v0.2.docx` is not
greppable, diffable, or citable by line. This has already caused a real
defect: `review-workspace-specification.md` asserts the v0.2 doc and
`phase-1-acceptance-criteria.md` "no longer exist in the repository
tree (confirmed by exhaustive glob)" — they exist, at top-level
`docs/architecture/`, outside the `app/` subtree the search covered.
A canonical spec now contains a confidently-worded false claim.

**W5 — ADRs are cited but do not exist as documents.** At least
ADR-008 through ADR-011 and ADR-015 are referenced by number across
findings docs, the specification, and code comments — ADR-011 is even
described as "currently Open" — but the register itself lives only in
the Architecture Review Board `.docx`. There is no `decisions/`
directory, so the project's most important tradeoff records are
unaddressable by link and their register is un-diffable.

**W6 — Terminology has no home.** The decision vocabulary
(Keep as-is / Change / Redact / Ignore / Fix this), the
display-label-vs-decision-vocabulary distinction, stage names, "Not
Quite" as durable state vs. "Fix this" as its display label — these are
defined across three revision docs and a keymap comment. RX-22
("terminology drifts within a single screen") is an open backlog item
precisely because no glossary exists to drift from.

**W7 — Keyboard interaction has no unified specification.** Keyboard-
first is arguably DocScrub's central interaction philosophy, and Wave 1
of the current backlog is literally "Restore keyboard trust" — yet the
keyboard model is spread across `keymap.ts` doc comments, four revision
docs, RX items, and a root-level completeness review. This is the
highest-value missing spec after the product overview.

**W8 — Named invariants exist only implicitly.** The corpus is full of
rules stated once, in passing, inside a findings doc: import fills
gaps, it does not contest state; ambiguity linking applies Keep, never
Rename, so surface text is always preserved; verification staleness is
derived, never tracked; engines are DOM-free; audit artifacts exclude
raw candidate text; the reviewer — never automation — is the decision
maker (the silent auto-merge was *removed* on exactly this principle).
These are DocScrub's Product Promises, and nothing protects them today
except memory and the verification suites.

**W9 — Root-level working documents have no lifecycle.** Wave findings,
wave implementation plans, dated notes, and two `.docx` files accumulate
at the repo root with no marker distinguishing live from superseded, and
no rule for when their durable content gets promoted into `app/docs/`.

**W10 — Supersession is inconsistently marked.** The specification says
it "supersedes and extends" `review-workspace-reconstruction.md`, but
the reconstruction doc carries no banner saying so. A reader landing on
it first has no way to know.

### 2.3 Document-by-document disposition

| Document | Disposition |
|---|---|
| `app/docs/architecture/review-workspace-specification.md` | Keep as canonical anchor. Add one-line correction for the false-absence claim (W4). |
| `app/docs/architecture/review-workspace-reconstruction.md` | Add superseded-by banner pointing at the specification; retain as historical record. |
| `app/docs/architecture/reviewer-experience-review.md` | Historical once the waves complete; banner it as the source review for the backlog. |
| `app/docs/architecture/reviewer-experience-backlog.md` | Live tracker; stays until the waves land, then archives. |
| `app/docs/architecture/design-notes.md` | Keep as-is — the UI changelog. Healthy pattern. |
| `app/docs/architecture/implementation-philosophy.md` | Keep; becomes the seed of Implementation Standards (Phase 4). |
| `app/docs/architecture/review-workspace-specification-validation.md` | Historical record of a reconciliation pass; keep, no action. |
| `app/docs/detection/*` (all findings/milestones/features/revisions) | Immutable historical archive, exactly where it is. Do **not** move or rewrite — dozens of cross-references depend on these paths, and their append-only amendment pattern (Feature 001's same-day note) is correct. |
| `app/docs/ooxml-spike/` | Closed historical record — except `construct-support-matrix.md`, which is current truth (what OOXML constructs are supported today) and should be promoted to a living reference. |
| `app/README.md` | Split (Phase 2): a short current-state README, with history extracted to a product-evolution narrative. |
| `docs/architecture/phase-1-acceptance-criteria.md` | Move to `app/docs/architecture/` (closed gate record) per the consolidation decision. |
| `docs/architecture/DocScrub-Web_Target_Architecture_v0.2.docx` | Move alongside it; supersede its *content* with a markdown architecture overview (Phase 4); the docx remains the historical original. |
| Root `DocScrub-Web_Architecture_Review_Report.docx` | Historical original; its ADR register and Required/Recommended findings get extracted into text ADRs (Phase 2). |
| Root wave/dated working docs | Define the lifecycle rule (Phase 0); promote durable content, then mark retired. |
| `app/fixtures/README.md`, `app/spike/SUPERSEDED.md` | Keep as-is. |

---

## 3. The documentation model: three document classes

The single most important structural proposal. Every document in the
set belongs to exactly one class, declared in a short header:

**Canonical (living).** Describes current truth. Carries `Status:
canonical`, `Last updated:`, and a "How to read this document" section
where warranted. Updated in the same change as the behavior it
describes (this is already a standing requirement via
`implementation-philosophy.md`). Obsolete content is deleted, not
preserved — history lives in class 2. Claims use the
`[BUILT]`/`[DESIGNED]`/`[SPECULATIVE]` convention where status is not
uniform.

**Historical record (immutable).** Findings docs, gate records, closed
spikes, superseded specs. Never rewritten; amended only by dated
appendix (the pattern Feature 001 already established). Superseded docs
get a banner naming their successor (the `SUPERSEDED.md` pattern).

**Working (session-scoped).** Root-level plans, reviews, and findings
produced during active work. The lifecycle rule: durable conclusions
are promoted into a canonical or historical doc, then the working doc
is marked retired. Working docs are never cited as authority by
canonical docs.

This model is what fixes W1/W2/W9/W10 as a class rather than
one document at a time.

---

## 4. Proposed documentation hierarchy

Additive, not a reorganization. Existing paths keep their meaning;
`docs/detection/` findings stay put. New canonical documents slot in
around them. All under `app/docs/`:

```
app/docs/
  README.md                      -- NEW: the documentation map. Lists every
                                    doc, its class, and its role. The one
                                    place a new contributor starts.
  product/
    product-overview.md          -- NEW: purpose, target reviewer, core
                                    philosophy (Sock Principle, evidence-
                                    evaluation-over-UI-manipulation,
                                    reviewer-is-the-decision-maker),
                                    design principles, what DocScrub is not.
    glossary.md                  -- NEW: terminology. Decision vocabulary vs.
                                    display labels, stage names, entity/
                                    candidate/occurrence/group, Not Quite,
                                    provenance terms (reviewer/imported/
                                    overridden-import).
    invariants.md                -- NEW: DocScrub's named durable promises
                                    (Product Promises pattern). See §6.
  architecture/                  -- existing directory, gains:
    architecture-overview.md     -- NEW (Phase 4): markdown successor to the
                                    v0.2 docx. Subsystems (domain/engines/io/
                                    workspace/ui), boundaries (engines are
                                    DOM-free; workspace composes, never
                                    reimplements; ui renders, never decides),
                                    data flow, lifecycle.
    domain-model.md              -- NEW (Phase 4): entities, relationships,
                                    review-state lifecycle, schema versioning
                                    and the migration ladder.
    ooxml-support.md             -- construct-support-matrix.md promoted to a
                                    living reference (or the matrix gains
                                    canonical status in place).
    decisions/                   -- NEW: ADR-NNN-*.md plus index.md. Seeded
                                    retroactively (§7 Phase 2), then used for
                                    new significant decisions.
    review-workspace-specification.md   -- existing canonical anchor.
    (reconstruction, reviewer-experience-*, validation, design-notes,
     phase-1-acceptance-criteria.md + v0.2 docx move in here)
  reviewer/
    reviewer-workflow.md         -- NEW: the review pipeline as the reviewer
                                    experiences it -- stages, non-linear
                                    navigation philosophy, decision model,
                                    workflow invariants. Largely extracted
                                    from specification §1-§2, made
                                    standalone and less citation-dense.
    keyboard-interaction.md      -- NEW: the unified keyboard spec -- keys,
                                    focus rules, roving vs. Tab semantics,
                                    editor interactions, command bar
                                    behavior, discoverability.
    ui-design-guide.md           -- NEW: layout philosophy, information
                                    hierarchy, color semantics ("emphatic
                                    but not aggressive"), acknowledgement
                                    pulse, progressive disclosure,
                                    accessibility baseline (RX-25's
                                    landing place).
  detection/                     -- existing: the immutable findings archive.
                                    New features keep landing findings here.
  ooxml-spike/                   -- existing: closed historical record.
  standards/
    implementation-philosophy.md -- existing doc relocated (with pointer
                                    left behind) or referenced in place.
    verification-standards.md    -- NEW (Phase 4): oracle-first policy,
                                    fixture families, when a parity harness
                                    vs. property suite is right, findings-
                                    doc and browser-validation requirements.
    documentation-standards.md   -- NEW (Phase 0, small): the three classes,
                                    status markers, templates, lifecycle
                                    rules from §3.
```

Feature documentation stays as the established `feature-NNN` findings
pattern; for larger features, a short spec (intent, boundaries,
non-goals) precedes the findings doc — the CarePland foundation-doc
shape — rather than the findings doc carrying both jobs.

---

## 5. Priorities

Ordered by leverage against active risk, not by hierarchy position:

1. **Documentation map + class/lifecycle rules** (`app/docs/README.md`,
   `documentation-standards.md`, supersession banners, root
   consolidation). Cheap, and every later document depends on it.
2. **Glossary + invariants.** RX-22 (terminology drift) is an open
   defect class, and the reviewer-experience waves are actively
   reworking the UI right now — the invariants doc is what keeps
   "import never contests state" and "reviewer is the decision maker"
   safe *while* the surface churns. Highest protection value per page.
3. **Product overview.** Small, and it un-buries the philosophy from
   the `.docx`.
4. **Keyboard interaction specification.** Core philosophy, active
   wave, currently the most fragmented topic.
5. **README split + product-evolution narrative.** Fixes the standing
   self-contradiction (W2) and gives the migration story a permanent,
   honest home.
6. **ADR extraction.** Valuable but not urgent — the decisions are
   recorded, just not addressable. Retroactive register of roughly
   10–15 ADRs from the review report + findings docs.
7. **Reviewer workflow + UI design guide.** Much of this is extraction
   from the specification and revision docs.
8. **Architecture overview + domain model + verification standards.**
   Important, least time-sensitive — the specification and README
   layout section cover the gap adequately in the interim.

---

## 6. Template recommendations

Templates should codify the repo's own best existing examples, not
import foreign formats.

**Canonical-doc header** (all class-1 docs):

```
# <Title>
Status: canonical | historical | working (+ superseded-by link if any)
Last updated: YYYY-MM-DD
How to read this document: <1 short paragraph; status-marker legend if used>
```

**ADR template** — modeled on how findings docs already argue:
Context / Decision / Alternatives considered (with the reason each was
rejected) / Consequences and tradeoffs / Status (accepted, superseded-by)
/ Sources (findings doc or review-report citation for retroactive ones).

**Feature spec template** (pre-implementation, larger features only) —
the foundation-doc shape: Intent (the reviewer problem) / Behavior /
Explicit boundaries (what this feature is *not*) / Invariants touched /
Open questions for Andrew / Later connections.

**Findings/implementation report template** — codify the structure the
best existing findings docs already converged on, so it stops being
convention-by-imitation: What was asked / Design decisions and judgment
calls (assumption, reasoning, alternatives, reviewer impact) / Oracle
deviations (classified A–E) / Verification results / Browser validation
(or its honest absence, with reason) / Defects found and fixed / Open
questions.

**Invariant entry template** — the Product Promises shape: kebab-case
name, one-paragraph behavioral definition, why it exists, where it is
verified (suite name), plus the list's own maintenance rules. Seed
candidates: `import-never-contests-state`,
`reviewer-is-the-decision-maker`, `ambiguity-link-preserves-surface-text`,
`verification-staleness-is-derived`, `audit-excludes-candidate-text`,
`engines-are-dom-free`, `decisions-are-always-reversible`,
`never-lose-reviewer-work`, `no-silent-oracle-deviations`.

---

## 7. Phased plan

**Phase 0 — Foundation (smallest, do first).** Consolidate top-level
`docs/` into `app/docs/architecture/`. Write `app/docs/README.md` (the
map) and `documentation-standards.md` (§3's rules + §6's templates).
Add superseded/status banners to the reconstruction doc and retired
working docs. Correct the specification's false-absence claim. One
session.

**Phase 1 — Protect current truth.** `glossary.md`, `invariants.md`,
`product-overview.md`. These are small documents with outsized
protective value while the reviewer-experience waves are in flight.
One session.

**Phase 2 — Repay the history debt.** Split `app/README.md` into a
short current-state README plus a product-evolution narrative (the
CarePland Git History analog — the migration, the gates, the turning
points, told once, honestly, in a doc whose job is history). Extract
the retroactive ADR register. One to two sessions.

**Phase 3 — The reviewer layer.** `keyboard-interaction.md`,
`reviewer-workflow.md`, `ui-design-guide.md`. Sequence this *after* the
current waves land, so the specs describe the settled interaction model
rather than chasing it. One to two sessions.

**Phase 4 — The engineering layer.** `architecture-overview.md`,
`domain-model.md`, `verification-standards.md`, `ooxml-support.md`
promotion. One to two sessions.

**Ongoing discipline (already standing, now explicit):** canonical docs
update in the same change as behavior; findings docs remain append-only;
new significant decisions get an ADR at decision time; working docs get
promoted-then-retired.

---

## 8. What this plan deliberately does not do

- **No mass file moves of the findings archive.** Path stability beats
  tidiness; the cross-reference web through `docs/detection/` is dense
  and correct.
- **No rewriting of historical records** to match new templates.
  Templates govern new documents.
- **No speculative architecture documentation.** The architecture
  overview documents the six directories that exist and the boundaries
  the code already enforces — not future frameworks.
- **No documentation for its own sake.** Each proposed document earns
  its place by answering a question the corpus currently answers only
  through archaeology. If a Phase 3/4 document turns out to be mostly
  duplication of the specification, the right move is a pointer, not a
  parallel text.
