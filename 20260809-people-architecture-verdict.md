# Item Check → People: Architecture Verdict

**Date:** 2026-08-09
**Status:** investigation. **No production changes.** No new diagnostics either — the measurement that decides this was already available.
**Verdict (§7):** current evidence is insufficient. Add capability X.

---

## 1. Root cause

Not a routing defect. Not a contract defect. A **representation** defect.

Run the real quality engine over your controls:

```
Amy Miller                    79   ["moderate_frequency_bonus","strong_name_structure"]
Bobbie Galaz                  79   ["moderate_frequency_bonus","strong_name_structure"]
Chelsye Angelina              79   ["moderate_frequency_bonus","strong_name_structure"]
Jeffrey Lam                   79   ["moderate_frequency_bonus","strong_name_structure"]

Grade Rosters                 79   ["moderate_frequency_bonus","strong_name_structure"]
Term Withdrawals              79   ["moderate_frequency_bonus","strong_name_structure"]
Final Exams                   79   ["moderate_frequency_bonus","strong_name_structure"]
Degree Planner                79   ["moderate_frequency_bonus","strong_name_structure"]
Start Date                    79   ["moderate_frequency_bonus","strong_name_structure"]
Reason Code                   79   ["moderate_frequency_bonus","strong_name_structure"]

Student Final Exa             79   ["moderate_frequency_bonus","strong_name_structure"]
Term Withdra                  79   ["moderate_frequency_bonus","strong_name_structure"]
Virtual Clearinghouse Academ  79   ["moderate_frequency_bonus","strong_name_structure"]
```

**Identical.** Not similar — the same two categories and the same score, across real people, interface labels, and mid-word extraction garbage.

For this population the lexical evidence layer is a **constant function**. There is no signal to route on, which is why:

- R1 removing `Amy Miller` was not bad luck. It was **arithmetically inevitable** — any rule that removes `Grade Rosters` removes `Amy Miller`, because they are the same input.
- C3 collapsing to 2 is not over-strictness. It is the true count of units with real person evidence.
- Every previous evidence improvement was real and none of it could have helped here, because none of it touched this population.

**People is polluted because it is the residue of every other classifier, and the residue is exactly the set the evidence layer cannot describe.**

---

## 2. Evidence map

Sorted by what each signal *legitimately proves*, which is the distinction you asked to be explicit.

### Merely structural / shape — proves the string looks like a name

| signal | what it actually asserts |
|---|---|
| `strong_name_structure` | two capitalized tokens (`TWO_NAME_RE`) |
| `surname_given_structure` | `Capitalized, Capitalized` (`LAST_FIRST_RE`) |
| `detectedType: "person"` | a regex matched capitalized words |

### Frequency / confidence — proves nothing about semantic identity

| signal | what it actually asserts |
|---|---|
| `moderate_frequency_bonus`, `small_frequency_bonus`, `frequency_saturated` | how often the string occurs |
| the quality **score** | a weighted sum of the above — **name-likeness, not personhood** |

Your instinct here is right and it is worse than you framed it: capitalization plus frequency contribute *nothing* to semantic identity, and together they are **the entire evidence basis of the 139**.

### Person-positive — genuinely proves a person reading

| signal | trustworthy? |
|---|---|
| `known_first_name` / `known_surname` / `known_personal_name_token` | **yes** — but see §2.1, the lexicon is 23+5 entries |
| anchor rules (signature block, name-with-email, name-with-role, name-with-org) | **yes** — identity claims, weighted 40–50 |
| `nearby_title` | yes, since deviation #6 narrowed it |
| contextual usage rules | **partially** — corrected twice today (Guard 1, clitics); acronym subjects remain genuinely ambiguous |
| ambiguity / entity relationships | yes, **but directional** — §2.2 |
| `email_address_evidence` | yes |

### Non-person-positive — proves another reading

| signal | trustworthy? |
|---|---|
| institutional / organization / calendar / document-structure categories | **yes** — and **absent by construction** from the 139, since `semanticTypeFor` tests them before people |
| `greeting_or_courtesy`, ordinary-language categories | yes, also mostly already routed out by C1 |
| `heading_context` | **contaminated** — fires if *any* occurrence is heading-like, so a real person who appears once in a header is tainted. See §2.3 |
| per-token lexical membership (R1) | **contaminated** — `Amy Miller` and `Grade Rosters` both satisfy it |

**The B-side of your bidirectional contract is empty for this population.** Everything trustworthy on that side has already fired and already removed the unit under C1. What remains is, by definition, material with no non-person evidence — which is precisely why "ordinary words alone should not mean non-person" is correct, and why R1 broke.

### 2.1 A branch-order defect that costs you an entire class of real people

`scoring.ts`:

```ts
if (LAST_FIRST_RE.test(text)) {
  return scoredResult({ ... "surname_given_structure" ... });   // <-- returns here
}
...
if (TWO_NAME_RE.test(text)) {
  for (const t of tokenSet) if (KNOWN_GIVEN_NAMES_SET.has(t)) hasKnownGivenNameToken = true;
  if (hasKnownGivenNameToken) structureReasons.push("known_personal_name_token");
```

The known-given-name lookup exists **only inside the `TWO_NAME_RE` branch**. The last-first branch returns before reaching it. Same person, two spellings:

```
Christopher Cobb   99  [... "strong_name_structure", "known_personal_name_token"]
Cobb, Christopher  94  [... "surname_given_structure"]              <- no name evidence
Nelly Perias       99  [... "known_personal_name_token"]
Perias, Nelly      94  [... "surname_given_structure"]              <- no name evidence
Tamara Yamada      99  [... "known_personal_name_token"]
Yamada, Tamara     94  [... "surname_given_structure"]              <- no name evidence
```

`christopher`, `nelly` and `tamara` are **all in `KNOWN_GIVEN_NAMES`**. The lexicon has the answer and the branch never asks.

This directly answers your question 8: **yes, `surname_given_structure` can be made useful through corroboration** — and the corroborator is already sitting in the dictionary, unconsulted. It is a defect, not a design choice, and it is cheap.

### 2.2 Identity relationships are directional (question 7)

`Amy` carries an ambiguity proposal pointing at `Amy Miller` (a 90% match, per the 2026-08-06 handoff). The evidence therefore attaches to **`Amy`**, the shortened form — and `Amy Miller`, the full name that anchors the relationship and is the thing a reviewer must not lose, receives nothing.

So the answer to "can identity relationships rescue real names that lack local contextual evidence" is **yes, and the plumbing already exists** — it is pointed the wrong way. A candidate that is the *target* of a high-confidence identity proposal has document-derived evidence of personhood that nothing currently reads.

This is the second-cheapest real win after §2.1, and unlike a lexicon it needs no new data.

### 2.3 `heading_context` is the B-side signal that nearly works

`isHeadingLike()` already exists and already reads block structure. But:

```ts
for (const occurrence of occurrences) { if (heading-ish) return true; }
```

**Any** occurrence taints the candidate, so it cannot distinguish "a UI label that only ever appears in table headers" from "a person who was cc'd in one header." Its useful form is the universal one — *every* occurrence is heading-like, none is prose — and that is a genuinely different claim, on evidence the pipeline already has.

`Grade Rosters`, `Degree Planner`, `Start Date`, `Reason Code` are interface and table labels. `Amy Miller` appears in message prose. **That difference is really in the document**, it is structural rather than lexical, and nothing consults it.

---

## 3. Proposed membership contract

Your hierarchy is the right shape. Populated with what actually exists today:

```
STRONG PERSON          name lexicon · anchors · title · email evidence
CORROBORATED PERSON    surname_given + known given name   (§2.1, currently unreachable)
                       identity-relationship target       (§2.2, currently unread)
                       shape + contextual person evidence
UNRESOLVED             shape only  ..................  ~100 of the 139
CORROBORATED NON-PERSON  every occurrence heading-like    (§2.3, currently unreadable)
STRONG NON-PERSON      institutional · calendar · document · greeting  (already gone under C1)
```

**The contract is sound and the middle bands are empty.** Both CORROBORATED tiers are unreachable today for defect reasons, not design reasons — which is encouraging, because defects are cheaper than capabilities.

But even with both repaired, **UNRESOLVED stays large**, and `Amy Miller` stays in it. Neither fix reaches her: she is not last-first, and whether the `Amy → Amy Miller` proposal exists is a fact about this document rather than a property of the class.

---

## 4. Live counterfactual

Estimated from the measured evidence, not run — and deliberately not run, per your diminishing-returns constraint.

| change | effect on the 139 | effect on trust |
|---|---|---|
| §2.1 last-first name lookup | **0 removed** | moves ~5–15 real people from shape-only into STRONG PERSON |
| §2.2 identity-target evidence | **0 removed** | moves an unknown but small number, including probably `Amy Miller` |
| §2.3 universal heading rule | some removed; unknown without a run | genuine B-side evidence, first of its kind |

**Note the first column.** The two cheap fixes remove *nothing* from People.

That is not a failure — it is the point, and it is the most important thing in this document. **The reason R1 was unsafe is that real people were invisible.** Every real person you make visible is a real person a future removal rule cannot kill. The correct sequencing is *make the population separable first, remove second* — and we have been trying to do it in the opposite order all day.

---

## 5. False-inclusion / false-exclusion review

**Your real-person controls, under the contract as it would stand after §2.1 and §2.2:**

| control | tier | why |
|---|---|---|
| `Perias, Nelly` | **STRONG** (was shape-only) | §2.1 — `nelly` is in the lexicon |
| `Yamada, Tamara` | **STRONG** (was shape-only) | §2.1 — `tamara` |
| `Cobb, Christopher` | **STRONG** (was shape-only) | §2.1 — `christopher` |
| `Giancarlo Banuelos` | STRONG already | `giancarlo` is in the lexicon |
| `Diana`, `Sarah` | STRONG already | `known_first_name` |
| `Amy Miller` | **UNRESOLVED** unless §2.2 fires | not in lexicon; needs the identity link |
| `Bobbie Galaz` | **UNRESOLVED** | `bobbie` not in lexicon |
| `Chelsye Angelina` | **UNRESOLVED** | `chelsye` not in lexicon |
| `Jeffrey Lam` | **UNRESOLVED** | `jeffrey` not in lexicon |

**Four of your ten real people remain indistinguishable from `Reason Code`.** Not because the contract is wrong, but because a 23-entry given-name list does not contain Bobbie, Chelsye, Jeffrey or Amy.

**Non-person controls:** every one stays in UNRESOLVED. None acquires non-person evidence from any proposed change. `Academic Senate`, `Financial Aid` and `Message List` are only removable by R1-style lexical rules, and R1 is rejected.

**Conflicting evidence:** none observed. The problem is not conflict, it is **absence on both sides**.

**Cases the system genuinely cannot know:** `Math Option`, `Preview Day`, `Workflow Shift`, `Systemwide Meeting` — plausible as either a label or an unusual name, with no evidence either way. These are the honest UNRESOLVED core and they should stay there.

### Falsifying my own proposal

The strongest objection: **§2.1 and §2.2 remove nothing, so the reviewer sees no improvement.** That is true and I am not going to dress it up. A reviewer opening People tomorrow would see the same 139 items. The value is entirely in what becomes *possible*, and if you judge that too indirect a payoff, "stop working on People" is a defensible read of the same evidence.

Second objection: **§2.1's blast radius is wider than People.** Adding `known_personal_name_token` to last-first candidates changes their score (94 → 99), which moves them across `STATUS_THRESHOLDS` and changes recommendations, tiers and Ambiguity sections. It is a small code change with a broad behavioural surface, and it is an **oracle deviation** — Python has the same branch order.

---

## 6. Confidence language — analysed separately

```ts
export function confidenceOpener(likelihood: number, entityType: string): string {
  const entity = entityPhrase(entityType);        // <- the DETECTOR's type
  if (likelihood >= 95) return `Almost certainly ${entity}`;
  if (likelihood >= 80) return `Likely ${entity}`;
```

**The noun comes from the detector; only the adverb comes from the score.** And the score measures name-*likeness*, so on this population it is measuring capitalization and frequency. `Degree Planner` at 99 reads *"Almost certainly a person's name"* because it is two capitalized words that recur — the sentence is a confident assertion about a subject nothing ever assessed.

**Smallest honest change:** when a candidate's positive evidence is **entirely** structural or frequency-based (`strong_name_structure`, `surname_given_structure`, the frequency bonuses) with no name-lexicon, contextual, anchor, title or email evidence, the opener must state what was assessed rather than what was assumed:

> `Two capitalized words, used 4 times. No name evidence was found.`

Three properties make this the right size:

- it changes **one function**, on a condition computed from evidence already passed to it
- it is **strictly more honest**, never overstating and never understating
- it is **independent of routing** — worth doing even if People is never touched again, and it must not be bundled with a classifier change

**It is an oracle deviation** (`confidenceOpener` is a direct port of Python's `_confidence_opener`) and would need classifying and recording. It also changes **audit narrative text**, which the module's own comment flags as a deliberate, called-out consequence.

**Recommendation: do this one.** It is the only change discussed today that improves the reviewer's experience immediately and carries essentially no false-exclusion risk — because it excludes nothing.

---

## 7. Diminishing-returns verdict

### **Current evidence is insufficient. Add capability X.**

Chosen over "implement this architecture" because the architecture is right and **its middle bands would still be empty**, and over "one smaller correction and stop" because the smaller corrections remove nothing from the reviewer's screen. Chosen over "stop working on People" because the highest-leverage capability is identified, bounded, and unusually cheap.

**Capability X, ranked by leverage:**

**X1 — a real given-name reference lexicon.** `KNOWN_GIVEN_NAMES` has **23 entries**, and they are the cast of one sample document. That is not a lexicon, it is a seed. A standard given-name list of a few thousand entries would light up Amy, Bobbie, Chelsye, Jeffrey, Diana, Sarah, Giancarlo, Nelly, Tamara, Christopher — and would **not** light up Grade, Term, Final, Math, Preview, Workflow, Systemwide, Degree, Start, Reason, Message, Transfer, Academic or Financial. It is the one signal that separates your two control sets.

*This contradicts a documented principle, and the contradiction is worth stating rather than sliding past.* `recommendations.ts` says widening name dictionaries "makes the failure rarer without changing its shape, and the next unlisted surname repeats it." That reasoning is correct **about a lexicon that is already comprehensive**. At 23 entries the failure is not rare — it is *universal*, which is why `Amy Miller` reduces to shape. Going from 23 to 5,000 does change the shape: the residual becomes unusual and non-Western given names, which is a bounded, nameable, auditable gap rather than "essentially everyone."

*Adversarially, against my own recommendation:* a real name lexicon creates new false inclusions in exactly this domain — `Summer Session`, `May Term`, `Will Call`, `Grant Application`, `Mark Sheet` all lead with a given name. `ambiguous_lexical_token` already fires on summer/may/will and mitigates much of it, but not all, and I would want that measured before it lands. It also will not rescue `Chelsye`.

**X2 — occurrence-distribution evidence (§2.3).** The universal form of `isHeadingLike`. The first genuine **B-side** signal available, structural rather than lexical, on data the pipeline already holds. Lower leverage than X1 but it is the only thing that would ever let People shed junk *safely*.

**X3 — truncation, as an upstream correctness issue, not a People problem** (your question 9). `Student Final Exa`, `Term Withdra`, `Virtual Clearinghouse Academ`, `Priority Registrati` are mid-word cuts. **This is not a routing concern and it is more serious than the People section's tidiness:** redacting `Term Withdra` writes `[REDACTED]wals` into the document. That is the same output-corruption class as oracle deviation #4, and `__docscrub.truncations()` already exists to enumerate it. **I would fix this before any further People work**, on severity grounds alone.

### On question 10 — is "Other" the right destination?

**No, and this is a product answer rather than a technical one.** Today's taxonomy has no state for *"name-shaped, genuinely unresolved."* Sending ~100 units to "Other / Needs Individual Review" is honest but reads as a dumping ground, and it makes Other the largest section on the stage.

If X1 lands and People becomes credible, the residue deserves its own visible, honestly-named home — *"Possible names — unconfirmed"* — with **no bulk vocabulary**. That is not a euphemism: it says exactly what is true, and it lets People's bulk actions become trustworthy, which is your actual objective. But that section is only worth building once there is a credible People section for it to sit beside.

---

## 8. Implementation plan

**Withheld.** Per §7 I am not recommending the architecture for implementation yet, and per your instruction the plan comes only with the evidence to justify it.

What I would do next, in this order, if you want a sequence:

1. **Truncation** (X3) — correctness, separate from all of this, highest severity.
2. **Confidence language** (§6) — immediate reviewer benefit, no exclusion risk, needs a deviation record.
3. **Measure X1** — take a real given-name list, run it against the live 139 offline, and count both what it rescues and what it falsely admits. That is a measurement, not an implementation, and it is the fact that decides whether People can be fixed at all.
4. Only then: §2.1, §2.2, and a routing contract.

**If X1's measurement is disappointing, stop working on People.** At that point the honest conclusion is that this document's population cannot be separated with available evidence, and the right product move is to make the section's *label and bulk actions* tell the truth rather than to keep trying to purify its contents.
