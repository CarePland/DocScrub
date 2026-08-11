# Item Check Residual-Work Audit

**Date:** 2026-08-09
**Status:** Audit only. No production code modified.
**Method:** shipped pipeline code read directly; the 558 review units in your extract classified programmatically against it.

---

## Headline

**The invariant you proposed is not implemented anywhere, and nothing in the pipeline approximates it.**

`stages.ts:76`

```ts
case "item-check":
  return context.detection.candidates.map((c) => c.id);
```

Item Check's item set is **every candidate the detector produced**, unfiltered. The only narrowing that ever happens is `reviewableItemIdsForStage`, which removes candidates that already carry a *decision* (or group coverage).

So Item Check is not "residual work after Ambiguity, Group Check, Type Check and entity resolution." It is **the complete detection inventory minus whatever happened to get decided earlier**. Upstream stages subtract only what they explicitly decided; they never subtract what they *know*.

That distinction is the whole problem. DocScrub already classifies "The" as `common-word` and "Academic Records" as `institutional-term` — the archetype exists, it drives the section routing you're looking at, and it is confident enough to render a one-key accept. It then asks you anyway.

Your suspicion is right, and it is the larger problem. Category tuning would not touch it.

---

## Quantified: 558 units from your extract

Classified programmatically (script and string set retained). Percentages are of 555 unique units.

| Class | Units | Share |
|---|---|---|
| **A. Non-actionable extraction residue** | **178** | **32%** |
| — single-token function words (`The`, `Also`, `But`, `And`, `Which`, `Whoever`…) | 101 | |
| — greeting/salutation phrases (`Good Morning Everyone`, `Happy Rainy Monday`, `Dear All`) | 29 | |
| — truncation fragments (`Acad Struc`, `Term Withdra`, `Service Indi`, `Staff Ad`) | 23 | |
| — contractions (`It's`, `That's`, `We'll`, `Don't`, `I've`) | 15 | |
| — possessives (`Amy's`, `Berhanu's`, `CSU's`, `OSD's`, `Sonoma's`) | 10 | |
| **B. Duplicate / alias — should already share a decision** | **77** | **13%** |
| — exact duplicate units (`FYI`, `ServiceNow`, `Early`, `Kyle`, `I'm`×3) | 4 keys / 17 redundant | |
| — alias families (44 families over 103 units) | 73 | |
| **C. Remaining — plausibly genuine work** | **293** | **52%** |

**Roughly 45% of the sampled Item Check queue is either non-actionable or a duplicate of another unit in the same queue.**

And class C is not clean either: 44 of those 293 are the acronym block (`NSC`, `WFH`, `PDF`, `FYI`, `ASAP`, `LOL`, `COVID`, `CTRL`). Several are unambiguously non-personal; they're in C only because my classifier was conservative.

### The alias families are worse than the count suggests

```
goodloe:  ['Goodloe, Andrew', 'Goodloe']
yamada:   ['Yamada, Tamara', 'Yamada']
collier:  ['Collier, Tanesha', 'Collier']
fox:      ['Fox, Liud', 'Fox, Liudmila']        ← one is a truncation of the other
kyle:     ['Kyle', 'Kyle']                       ← literally the same string, twice
deans:    ['Assoc Deans', 'Associate Deans', 'Associated Deans']
```

`Fox, Liud` / `Fox, Liudmila` is both an alias pair *and* an extraction artifact. `Kyle` appearing twice is a duplicate unit in a single category.

---

## Trace: which stage let each class through

### A1. Function words, contractions, possessives — **the person detector**

`patterns.ts:112`

```
SINGLE_PERSON_RE = \b[A-Z][a-zA-Z'’-]{2,30}\b
```

Any capitalized word of 3–31 characters. The character class **explicitly includes `'` and `’`**, which is precisely why `It's`, `That's`, `Amy's` and `Don't` are person candidates.

Three gates, all weak:

1. `SINGLE_PERSON_STOP_WORDS` — **45 entries**, mostly document-structure words (`Header`, `Footer`, `Subject`, month names). Contains none of `The`, `Also`, `But`, `And`, `This`, `That`.
2. `singleNameCounts >= 2` — appear twice and you're in. In an email thread, every function word clears this instantly.
3. `hasCapitalizedNeighbor` — skips `The Reg` but admits `The` before a lowercase word.

**This is a faithful port of the Python oracle** (`detect_people`), and `AGENTS.md` makes Python the behavioral oracle with every deviation classified and recorded. So pruning here is a *deliberate, recordable deviation* — not a bug fix. That matters for how it gets approved.

### A2. Truncation fragments — **document extraction, upstream of detection**

`Acad Struc` / `Acad Structure`, `Priority Registrati` / `Priority Registration…`, `Science Teach` / `Science Teacher Initiative` / `Science Teacher Initiatives`, `Virtual Clearinghouse Academ` / `…Academy`, `Enrollment Appointments Assigne` / `…Assigned`, `Student Final Exa` / `Student Final Exam`, `Term Withdra` / `Term Withdrawl` / `Term Withdrawls` / `Term Withdrawals`, `Sta` / `Staff`, `Prodution` (typo, survives as its own unit).

These are not review questions. They are **text truncated at run, cell or column boundaries** — the same underlying string surfacing at several lengths. 23 detected by strict prefix-matching; the true number is higher because my test required ≤4 characters of difference.

Nothing in the pipeline reconciles them: `groupKey` normalizes case and punctuation but not truncation, so `Term Withdra` and `Term Withdrawals` are different entities by construction.

### A3. Greetings — **detector, then archetype, then no action**

`Good Morning Everyone`, `Happy Rainy Monday`, `Thanks Andrew`, `Yes Thank`, `Geez Exploding`, `Yep Smile`.

`FALLBACK_PERSON_RE` matches consecutive capitalized tokens. `PERSON_STOP_PHRASES` has **6 entries** — all Teams/Word chrome (`Microsoft Teams`, `Subject Re`). Greeting shapes are not modelled at all.

Note `TRIAGE_SECTION_ACCEPT_DEFAULT` already routes the Likely People section's bulk action to **Ignore**, and the section carries a "None are names" button. The system's own default answer for this whole population is already "not a name."

### B1. Aliases — **entity resolution's two mechanisms are both narrow**

- `buildEntityGroups` buckets by `personGroupKey`, requires ≥2 members, and **explicitly skips every single-token name** (`isShortPersonReference`). Documented as deliberate: whether `Andrew` belongs to `Goodloe, Andrew` is Ambiguity Check's question, not resolution's.
- `buildAmbiguousMatches` handles exactly one shape: **single first-name token → full-name anchor, by exact first-name match**.

Neither covers:

| Shape | Example | Why it escapes |
|---|---|---|
| surname-only → last-first | `Goodloe` → `Goodloe, Andrew` | anchor buckets key on *first* name |
| possessive → base | `Berhanu's` → `Berhanu` | possessive is a distinct normalized key |
| truncation → full | `Fox, Liud` → `Fox, Liudmila` | no prefix reconciliation |
| exact duplicate | `Kyle` / `Kyle` | different candidate ids, same display value |

The last one is worth a second look on the live document — two units with identical display text should not be separately decidable, and if they genuinely are distinct candidates that is itself a finding.

### B2. Carryover *does* work where it exists

Worth stating plainly, because it bounds the problem: a decision made in Ambiguity Check or a resolved Group Check group **does** retire the candidate from Item Check, through `candidateResolvedStatus`. The carryover mechanism is sound. What's missing is *reach* — Ambiguity only ever holds `grouping.ambiguityProposals`, which is the first-name→anchor subset and nothing else.

---

## Where each class should be resolved

Ordered by how far upstream the fix belongs.

**1. Extraction/normalization — truncation reconciliation (Class A2).**
Before detection. If a candidate's normalized form is a strict prefix of another with high co-occurrence, they are one string that got cut. This is the only class that is a *correctness* problem rather than a volume problem: `Term Withdra` isn't a bad review question, it's damaged data, and it will also corrupt replacement output.

**2. Detection — widen the person stop lists (Class A1, A3).**
Contractions and possessives are mechanical: a token ending in `'s`/`'t`/`'ll`/`'ve`/`'re` is not a name. Function words need a real closed-class list, not 45 entries. Greeting shapes need phrase patterns. **All of these are oracle deviations and must be recorded as such.**

**3. Entity resolution — widen alias reach (Class B).**
Surname-only → last-first, possessive → base, prefix → full. These extend `buildAmbiguousMatches`'s existing model rather than inventing one; each becomes a *proposal*, not an automatic merge, preserving the documented "resolution never decides unilaterally" stance.

**4. A new pruning gate between detection and Item Check — and this is the structural one.**
Even with 1–3, nothing enforces your invariant. The gate should be explicit and auditable: a candidate whose archetype is a term class, with no competing evidence, has one defensible decision and does not belong in a review queue. It should arrive **pre-decided with provenance**, not suppressed silently — the reviewer must be able to see and reverse it, which is what `decisionProvenance.ts` already exists for.

**Do not put this in the UI.** Filtering the Item Check queue at render time would leave the domain thinking the work is outstanding, which is exactly the paint/keystroke split that cost the last four days.

---

## Regression risks

**Highest — the oracle boundary.** Every pruning rule in 1–3 is a deliberate deviation from the Python behavioral oracle. `AGENTS.md` requires each to be classified and recorded. This is process cost, not technical risk, but it is not optional and it is the reason this shouldn't be done as a quiet tuning pass.

**Highest — false suppression of real names.** `Amy`, `May`, `Grace`, `Frank`, `Summer`, `Early`, `Fox`, `Collier` are all in your extract and all genuinely ambiguous. The recommendation layer already knows this: `couldBeAName` adds a "Person's name" escape hatch to term recommendations for exactly this reason. **Any pruning gate must inherit that guard** — single-token, no known-name evidence — or it will silently redact-or-keep a real person. A pre-decided-with-provenance design contains this risk; silent suppression does not.

**High — metrics become incoherent.** "2,846 decisions avoided" counts against the full detection inventory. Prune the inventory and the denominator moves; the reduction figures will drop sharply while the product gets better. Decide deliberately whether pruned candidates count as avoided decisions, or the numbers will look like a regression.

**Medium — Group Check and Type Check populations shift.** Both derive from the same candidate set. Aggressive pruning empties groups, and `activeWorkflowStages` hides stages with no work — so a stage could vanish from the workflow. That interacts with the conditional-workflow logic in `navigator.ts`.

**Medium — audit completeness.** `AuditExporter` reports per-candidate resolved status. A pruned candidate must still appear with a recorded reason, or the export stops being a defensible record of what was examined.

**Low but real — collapsing distinct people.** Surname-only linking is the risky one: two people can share a surname. Must stay a proposal, never an automatic merge.

---

## What I'd want before implementing

Two things I could not get from the repository:

1. **Your actual document**, or an export of its candidate set. I classified 558 units from your extract against the shipped rules; that is real evidence but it is a sample you assembled, not the full 3,115. The per-class shares are likely stable; the absolute numbers are not.
2. **A decision on the Class A2 question**: are the truncations an artifact of *this* export, or of DocScrub's own text extraction? If it's ours, that's a parser defect and outranks everything else here — it corrupts output, not just the queue. `Prodution` and `Sta` suggest source-side typos and column truncation respectively, so it's probably mixed, and the split matters.

My recommendation: **fix A2 first if it's ours**, then the pruning gate (4), then detection stop lists (2), then alias reach (3). The gate is what makes the invariant real; the rest reduce how much it has to catch.
