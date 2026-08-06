# Conclusion Labels, Both Voices, and the "This is a name" Escape Hatch

**Date:** 2026-08-03 (seventh pass)

---

## 1. Term sections state their conclusion again — and I'm why they stopped

`bulk("Leave all as-is", "Ignore", …)` → I renamed it to `"Ignore all"` this
morning. That fixed a real defect (the label said **Keep**, the button did
**Ignore**) but overshot: it swapped a decision-mismatched label for a
decision-accurate but *conclusion-blind* one, when the right answer was the
third option AG had already circled — state the conclusion, keep the decision
correct underneath. His "I swear I already worked on this" was accurate; I
undid it.

| Section | Now reads | Still dispatches |
| --- | --- | --- |
| Institutional Terminology | These are all institutional terms | Ignore (`Opt I`) |
| Temporal / Calendar Terms | These are all calendar terms | Ignore (`Opt I`) |
| Common English Words | These are all common words | Ignore (`Opt I`) |

**Checked before building:** `termRecommendation` emits `op: {kind:"ignore"}`,
so the per-item ① chip and the section button already produce the *same*
decision. This was never a missing capability — adding a second button would
have been a duplicate. It was a labelling question, so it's a rename.

**The boundary I did not cross:** `Redact all` keeps its action-naming label.
A conclusion is safe to state when nothing happens to the text; when
something does, the button must say what. Pinned as a rule: *"destructive
actions still name the ACTION, never the conclusion."*

## 2. Both voices, by scope

> *"if they happen to process several, the option should exist for the
> remainder, i.e. 'Selected' as elsewhere built."* — AG

The old rule — only "scope-naming" labels get a selected form — was wrong
twice. It keyed on the literal word **"all"**, which *"These are all common
words"* contains while quantifying over *these*, not claiming the section.
And it left a checked subset showing a button that read like a claim about
everything.

Now **every** bulk decision carries both voices, split by scope rather than
by label style:

- **nothing checked** → the authored label, over all remaining work
  (*"These are all common words"*)
- **a subset checked** → the canonical action voice (*"Ignore selected"*),
  because a conclusion asserted over a hand-picked subset tells the reviewer
  nothing they didn't just decide, while what happens to those items still
  does.

`accept-suggestions` carries neither — each item takes its *own* suggestion,
so there is no single decision to name. `bulkScoped` is now just `bulk` with
the canonical label.

The verification rule moved from a word-proxy to the exact property: *every
bulk decision declares a selected form; accept-suggestions declares none.*

## 3. The "Amy" case — a term conclusion needs an escape hatch

> *"this example should have a 'This is a name' option. I am 95% certain I've
> been over this specific example."*

You had — the 2026-08-02 UNCERTAIN DISPOSITION work built exactly this
vocabulary (`① Person's name` / `② Not a name`). **It never reached these
items purely because of ORDER.** In `deriveRecommendation` the term checks run
first and `return`, so a single-token person-typed candidate that matched a
term category never fell through to the branch that would have offered it.
"Amy" matched `common-word` and stopped there.

A term recommendation **overrides the detector** — it says "the detector
called this a person; it's really an ordinary word." When that override is
wrong (Amy, Grace, Frank, Summer, May), the only route back was the generic
`Keep as-is` button, which says what happens without saying why.

So term recommendations on person-typed single tokens now carry the second
chip: **① Common word · ② Person's name**. Same vocabulary, same ops, same
digit machinery — only the reachability changed.

Two deliberate constraints:

- **The claim stays first**, so it keeps ① and remains what every
  section-level accept applies. The detector's override is still the
  recommendation; this only makes *disagreeing* with it a named action.
- **Gated at `personTokenCount <= 1`**, exactly as the uncertain branch is.
  One token is where a name and an ordinary word are genuinely confusable;
  multi-token institutional phrases aren't "speculating on type."

---

## Verification

- `tsc --noEmit` clean; `npm run build` clean; **47 of 47 suites pass**
  (the count rose again mid-session — concurrent work).
- Three suites had failing expectations, all **superseded, not weakened**,
  and each rewritten to assert the new contract:
  - `recommendations-verification` — the common-word header now carries two
    chips, and the identity list correctly continues at **③** rather than ②.
    That's the one-digit-space contract working, not a regression.
  - `triage-queue-verification` — term-section labels, and the label rule
    replaced with the exact property.
  - `section-action-digits-verification` — a stale `find("Ignore all")`.

### Pending live-browser validation

1. The three term sections read as conclusions with no selection, and flip to
   *"Ignore selected"* once a box is checked.
2. `Opt I` still fires them in both states.
3. "Amy" (and any single-token person-typed term match) shows **② Person's
   name**, and pressing `2` keeps it.
4. Possible-identity options on those items now start at **③**.
5. Section-level accept on a term section still applies the *term*, not the
   name disposition.
