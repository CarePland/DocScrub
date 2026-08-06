# Product Overview

Status: canonical
Last updated: 2026-08-03

How to read this document: what DocScrub is, who it serves, what the
human owns versus what automation is allowed to do, and where the
product's boundaries are. This is an internal product document, not
marketing. Detailed behavior lives in
`../architecture/review-workspace-specification.md`; terminology in
`glossary.md`; protected behavior in `invariants.md`. Claims here use
`[BUILT]` / `[DESIGNED]` / `[SPECULATIVE]` where maturity is mixed.

---

## What DocScrub is

DocScrub is a reviewer-driven PII redaction application for Word
documents. A reviewer loads a `.docx`, DocScrub's deterministic engines
detect and organize candidate PII, and the reviewer works through an
evidence-rich workspace deciding, for every candidate, what happens to
it — keep it, change it, redact it, or ignore it. DocScrub then rebuilds
the document with those decisions applied, verifies the rebuilt output,
and produces audit artifacts that prove what was reviewed and decided
without re-exposing the content that was removed. **[BUILT]**

Everything runs browser-locally: parsing, detection, review state,
rebuild, and verification happen in the reviewer's browser, with
sessions persisted to browser storage. There is no server backend and
the document never leaves the machine. **[BUILT]**

DocScrub-Web (this repository's `app/`) is the production
implementation. It was migrated from, and verified fixture-by-fixture
against, the original Python implementation (`work/pii_docx_redactor/`),
which remains the behavioral oracle for ported scope.

## Who the reviewer is

The reviewer is a professional — the project's own roadmap language says
attorney — who is *accountable* for the redaction: someone whose name,
in effect, goes on the output, working through documents that are large
enough that review efficiency matters and sensitive enough that mistakes
matter more. DocScrub assumes one reviewer per session, working
keyboard-first, whose scarce resource is judgment-attention — not
clicks, not features.

## The problem it solves

Redaction that matters is not string replacement — it is a chain of
judgments: is this a real detection? Are these five spellings the same
person? Is this bare "Andrew" *that* Andrew? What should this become,
and did the output actually come out right? Simple find-and-redact
tools push all of that judgment into the reviewer's head and give them
a text box. DocScrub's position is the inverse: automate the
mechanical work completely (finding, scoring, grouping, classifying,
rebuilding, verifying), structure the judgment work honestly, and leave
every judgment to the human.

## Responsibility split

**The reviewer is responsible for** every decision: each candidate's
disposition, each proposed group's fate, each ambiguous identity link,
each replacement text, and the choice to accept or override anything
automation proposed — including imported prior decisions.

**Automation is allowed to** detect candidates, score and explain them,
propose entity groups and possible identities, classify and order
occurrences, compute confidence, propose reuse of previously exported
decisions where the match is deterministic, and apply the reviewer's own
bulk actions. **[BUILT]**

**Automation is not allowed to decide.** It never creates, changes, or
overrides a decision on its own; it never merges identities without the
reviewer (the one silent auto-merge ever found was classified a defect
and removed); imported decisions fill gaps and never contest existing
state; confidence informs and never triggers. See
`invariants.md#reviewer-is-the-decision-maker` and
`#import-never-contests-state`.

## The central workflow

Load a `.docx` → the pipeline runs (detection → quality → entity
resolution → occurrence classification) → the reviewer works three
review stages — **Ambiguity Check** (who is this short name?), **Group
Check** (are these the same person, and what happens to them?), **Item
Check** (per-candidate decisions, search/filter/sort at scale) — in any
order, since the workspace is deliberately not a wizard → **Output**
rebuilds the document, verifies it, and exports the redacted `.docx`
plus audit artifacts and a reusable decisions file. Sessions autosave
continuously and survive refresh and resume. **[BUILT]**

(A QA stage exists as a stub whose resolution is an open backlog
question — it is not part of the working workflow today.)

**Workspace Analysis** (Feature 003, `[BUILT]`) is a separate, optional
step that can precede all of the above: given a batch of imported
documents, it proposes which ones appear to belong to the same matter,
using only deterministic document-level evidence (shared identifiers,
organizations, email domains, and similar) — never PII, entity, or
redaction judgments, and never anything from a review session. It runs,
and is fully usable, whether or not any document has ever been loaded
for review. See `../detection/feature-003-workspace-analysis.md` and
`../architecture/decisions/ADR-019-workspace-analysis-independence.md`.

## What makes it different from find-and-redact

Four commitments, not a feature list: **evidence** — every candidate
carries explainable reasons, so deciding is evaluating evidence rather
than re-detecting by eye; **identity** — entity resolution and ambiguity
handling treat "which person is this?" as first-class review work;
**verification** — the rebuilt output is checked and explained, never
assumed (*"verify, don't just trust"*); **auditability** — the audit
record proves the review happened without carrying the removed content
itself. All **[BUILT]**.

## Primary Product Principle

Stated by Andrew, 2026-08-02, as the governing principle of the product.
It is not one principle among the others: everything in "Established
principles" below, and the full evidence-cited set in the
specification's §12, elaborates it rather than sitting beside it. His
text, verbatim:

> Every design decision should move DocScrub toward one objective:
>
> **Help the reviewer correctly scrub the document with the least amount
> of effort, while keeping the reviewer in complete control of every
> review decision.**
>
> When two UI designs are otherwise comparable, prefer the one that
> reduces unnecessary reviewer effort without reducing transparency,
> correctness, or reviewer control.

### How to apply it

*This section is documentation's reading of the principle above, not
Andrew's text. It exists because the word doing the most work is
"unnecessary," and an undefined tiebreaker can be cited by both sides of
the same argument.*

**The tiebreaker is asymmetric, and the asymmetry is the point.** Effort
is never bought with control, transparency, or correctness. A design
that saves the reviewer work by deciding something on their behalf, by
hiding why something happened, or by accepting a worse result has not
won the tiebreaker — it has left the principle's terms, because the
clause is a precondition and not a counterweight. Where effort and
control genuinely conflict, control wins and the effort cost is paid.
That is the standing answer to "but it would be fewer clicks."

**Unnecessary effort is effort that is not the judgment itself**, and it
comes in two kinds. Both are in scope; the second is usually the larger
win.

- **Cost per decision** — everything the reviewer does to *express* a
  judgment already formed: keystrokes, clicks, navigation, confirmation,
  mode-switching, re-finding their place. Auto-advance on decision,
  auto-expanding selection, inline editors rather than dialogs, and the
  standing treatment of blocking prompts as defects all reduce this.
- **Number of decisions** — how many separate judgments the reviewer is
  asked to make about what is substantively one question. Entity
  grouping, group-level actions, bulk multi-select, and Decision Reuse
  each amalgamate what would otherwise be repeated identical judgments
  into a single one. **Reducing decision quantity is as much a part of
  this principle as reducing per-decision cost**, and at document scale
  it dominates: halving the keystrokes per decision is a smaller win
  than removing four hundred decisions that were all the same decision.

**Amalgamation has its own bound**, supplied by the control clause: it
is legitimate only where the reviewer can see what was combined and can
separate it. Grouping candidates is not deciding for the reviewer;
grouping them irreversibly, or without showing membership, would be.
This is why proposed groups are confirmed rather than applied, why Not
Quite ("Fix this") exists to refine a proposed group member-by-member
rather than forcing accept-or-reject on the whole, and why Decision
Reuse fills gaps but never contests existing state. A combined decision
is still one reviewer decision — it must not become an automated one.

**What is never unnecessary:** reading evidence, evaluating a
recommendation, judging an identity, choosing a replacement. That work
*is* the product. A design that reduces it is not reducing reviewer
effort; it is reducing review quality, and the principle does not
authorize it.

See `invariants.md#reviewer-is-the-decision-maker` and
`invariants.md#import-never-contests-state` for the enforced form of the
control clause.

## Established principles

The load-bearing philosophy, named and sourced — each an elaboration of
the Primary Product Principle above, at a particular layer of the
product (the specification's §12 holds the full evidence-cited set):

- **The reviewer is the decision maker; automation proposes, the
  reviewer decides.** The responsibility split above, held as an
  invariant.
- **Completion Beats Movement (the Sock Principle).** *"Moving work is
  not progress; completion is progress"* (v0.2 principle 4.4). Stages
  are simultaneously visible and freely navigable; nothing gates on
  ceremony. **[BUILT]**
- **Minimize UI manipulation time; maximize evidence-evaluation time.**
  Andrew's stated interaction philosophy — selection auto-expands,
  decisions auto-advance, editors are inline, prompts and blocking
  dialogs are removed as defects. This is the primary principle's
  *cost per decision* axis at the interaction layer. **[BUILT]**
- **"Review once. Apply everywhere."** One judgment should never need
  restating — bulk actions, group decisions, and Decision Reuse across
  document versions are the same idea at three granularities. This is
  the primary principle's *number of decisions* axis. **[BUILT]**
- **Local-first processing.** Browser-local by architecture; the
  document stays on the machine. **[BUILT]**
- **The original document is never modified.** Output is a newly built
  document; the source file is read, never written. **[BUILT]**
- **Fail closed on ambiguity; be honest about what isn't built.**
  Conservative thresholds where misapplying a decision is worse than
  suggesting nothing; unbuilt capability (undo/redo history) is rejected
  with a stated reason, never faked. **[BUILT]**

## Boundaries — explicitly not

- **Not a general document-format tool.** Input is OOXML
  WordprocessingML (`.docx`) only; within it, construct support is the
  documented matrix (`../ooxml-spike/construct-support-matrix.md`) —
  tracked changes, notably, are detected but have no splice path
  (read-only). No PDF, no scanned images/OCR, no other formats.
  **[BUILT boundary — no other format is designed or committed.]**
- **Not AI/ML.** Detection and every other engine are deterministic
  (regex, rules, arithmetic) — same input, same output, explainable by
  construction. No model, no training, no cloud inference. Nothing in
  the repository designs otherwise.
- **Not a service.** No server backend, no accounts, no multi-user
  collaboration or concurrent review. Decision Reuse via exported files
  is the only cross-session/cross-reviewer channel. **[BUILT]**
- **Not legal advice.** DocScrub structures and records the review; the
  redaction standard applied is entirely the reviewer's professional
  judgment.
- **Not yet accessible.** A confirmed gap, not an oversight: no
  accessibility baseline exists today; it is scheduled work
  (backlog RX-25, production-polish wave). **[DESIGNED]**
- **No undo/redo history engine.** `history.*` commands are honestly
  rejected today. Reversibility is instead guaranteed per-decision
  (`invariants.md#decisions-are-always-reversible`). **[BUILT as
  rejection; a history engine is uncommitted.]**
- **Workspace Analysis proposes groupings; it never merges or decides
  anything.** The same "automation is not allowed to decide" boundary
  above applies here too: a proposed document grouping is only ever
  applied when a reviewer explicitly accepts, splits, or merges it, and
  a merge is refused outright unless the analysis independently confirms
  it — there is no override to force two document groups together.
  **[BUILT]**
