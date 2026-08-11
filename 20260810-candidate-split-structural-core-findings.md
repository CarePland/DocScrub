# Candidate Split — Structural Core

**Date:** 2026-08-10
**Status: structural core + proposal engine + telemetry seam shipped and verified. Session/Workspace/UI integration deliberately NOT done this pass.**
**86/86 suites green, typecheck and build clean.**

> ⚠️ **Read §12 first if you only read one section.** I built the layer that determines *what a split means* and stopped before the layer that *applies* it. That was a judgement call about merge risk, and you may disagree with it.

---

## 1. Existing candidate-repair machinery found

| Mechanism | What it does | Reusable for Split? |
|---|---|---|
| **`domain/NotQuite.ts`** | Refines an entity **group**: members are candidates that already exist; the reviewer assigns each a `MemberAction` | **No** — it never changes a span |
| `identity-cleanup.ts` | Removes junk options from proposed identities; `insertedWordNameProposals` | No — proposals about grouping |
| `cross-candidate` `truncated_variant` | Observes that one candidate is a prefix of another | No — an observation, not a repair |
| `EffectiveSpan` + `redactionSpanOf()` | Normalization narrows the redacted range within an occurrence | **Yes, as precedent** — see §12 |

**Split is kept distinct from Not Quite deliberately.** Not Quite says *"this group's members need individual actions."* Split says *"this extracted span is more than one review unit."* Overloading Not Quite would make the audit ambiguous — a reader could no longer distinguish "the reviewer refined a group" from "the reviewer said extraction merged two things."

---

## 2. Structural representation

`src/domain/CandidateSplit.ts` — a **token / separator decomposition**:

```
"Chris, Margaret"        tokens ["Chris"]["Margaret"]     separator [", "]
"HR and Payroll"         tokens ["HR"]["Payroll"]         separator [" and "]
"Admissions / Registrar" tokens ["Admissions"]["Registrar"] separator [" / "]
```

**Conjunctions are separators, not tokens.** This is load-bearing: if `and` were a token, `HR and Payroll` would offer a three-way split whose middle piece is the word `and` — a review unit nobody wants and a redaction span that would damage the sentence. As a separator it simply stays in the document.

**Nothing is normalized away.** Separator text is preserved verbatim with exact offsets, and the verification suite proves the decomposition **reconstructs the value exactly, character for character** — a lossy decomposition would silently corrupt output reconstruction.

Token-internal punctuation stays inside the token: `O'Brien-Smith` is one token, not three.

---

## 3. Arbitrary N-token partitions

A partition is **the set of cut boundaries**, indices `0..N-2`, where boundary `i` sits between token `i` and `i+1`.

```
"A B C"   {}    -> A B C        {0}   -> A | B C
          {1}   -> A B | C      {0,1} -> A | B | C
```

O(N) representation, not an O(2^(N-1)) menu — which is why the interaction is "select boundaries" and why it scales to `Smith Jones Brown Davis Clark` without enumeration.

**Cut separators belong to neither piece.** Splitting `Chris, Margaret` yields `Chris` and `Margaret`; the `, ` stays in the document. **Internal separators survive**: `Chris, Margaret Jones` split at boundary 0 yields `Chris` and `Margaret Jones` — space intact.

All 11 partitions of 2/3/4 tokens are pinned individually.

---

## 4. Deterministic proposal logic

`src/engines/review/splitProposal.ts` — three named rules:

| Rule id | Fires on |
|---|---|
| `split-proposal/dividing-punctuation` | `,` `;` `/` `&` `+` `\|` in the separator |
| `split-proposal/coordinating-conjunction` | `and`, `or`, `und`, `y`, `et` |
| `split-proposal/attested-on-both-sides` | caller-supplied name attestation on both tokens |

### ⚠️ The deliberate asymmetry — the design decision worth arguing about

**Attestation corroborates an existing boundary. It never creates one.**

`Smith Jones Brown` gets **no proposal**, even when every token is name-attested. An attestation-only rule would confidently preselect both boundaries and propose three people — when the value may equally be one person with two surnames, or two people. Whitespace is not evidence of division.

So `Smith Jones Brown` opens with every boundary *available* and none *preselected*. That is the honest state: the mechanism supports the split, the engine does not claim to know where it goes. It also keeps the reviewer out of the correction loop your product principle is aimed at.

**Not a person splitter.** `Admissions / Registrar` and `HR and Payroll` fire the same rules as `Chris, Margaret`. The strongest rule is punctuation, which knows nothing about people. Attestation is injected by the caller, so this module owns no dictionary and cannot grow a classifier.

---

## 5. UI interaction — designed, not built

The interaction the core supports:

```
Chris, Margaret     [ Separate these ]
        ↓
Chris  ┊  Margaret          ┊ = boundary toggle, preselected by proposal
        ↓                     reason shown on hover: "list punctuation"
   [ Confirm ]  [ Cancel ]
        ↓
Chris        Margaret
K/C/R/I      K/C/R/I         ← ordinary review, ordinary keyboard
```

`canOfferSplit()` gates the action (≥2 tokens). Proposal boundaries preselect. **This is not wired up** — see §12.

---

## 6. Resulting-candidate lifecycle — designed, not built

Confirmed design: the split is a **durable session record**, and Workspace re-derives the working candidate set from `detection + splits` on every load. Pieces become ordinary candidates and flow through quality, interpretation and decision machinery untouched. The reviewer never confirms *"Chris is a name"* — semantic interpretation stays DocScrub's job.

---

## 7. Audit / provenance

`CandidateSplitRecord` distinguishes the four things an audit must tell apart:

| Field | Answers |
|---|---|
| `originalValue`, `originalTokenCount` | what extraction produced |
| `proposedBoundaries`, `proposalRuleIds` | what the engine suggested, and why |
| `confirmedBoundaries`, `confirmedAt`, `acceptedProposalExactly` | what the reviewer chose |
| `segments` | the resulting units |

**The original is never deleted.** Verified: a split record carries no decision, no entity/group linkage, and no semantic type.

---

## 8. Decisions and entity reuse

Split creates **no** decision, **no** entity link, **no** merge — asserted structurally. Pieces are independent review units that may receive *different* K/C/R/I. Existing decision-reuse machinery remains available to them later; Split does not depend on it and this pass does not touch entity resolution.

---

## 9. Telemetry seam

`src/metrics/splitTelemetry.ts`. **No network call, no endpoint, no queue, no persistence.**

```ts
SplitTelemetryEvent {
  operation: "split"
  originalTokenCount: number
  proposedPartition: readonly number[]      // segment SIZES
  confirmedPartition: readonly number[]     // segment SIZES
  proposalRuleIds: readonly SplitProposalRuleId[]   // closed union
  exactProposalAccepted: boolean
  resultingUnitCount: number
  outcome: "accepted-exactly" | "accepted-modified" | "rejected"
         | "unproposed-manual" | "unproposed-cancelled"
}
```

Local aggregate: `splitProposals`, `exactAccepts`, `modifiedAccepts`, `rejected`, `unproposedManual`, `unproposedCancelled`, `partitionShapes`, `ruleFireCounts`.

---

## 10. Proof the schema cannot carry content

**Enforced by the type, not by discipline:**

- **No string fields at all** except a closed union of rule ids and outcome enums. A caller physically cannot put a name in `proposalRuleIds` — it would not compile.
- **No hashes, digests or fingerprints.** *Hashing a name is not anonymisation for this purpose*: a hash of `Margaret` is a stable, joinable identifier, and a small candidate space is trivially reversible by enumeration.
- **No property bag** — no `metadata`, `extra`, `tags`, `Record<string, unknown>`.
- **`buildSplitTelemetryEvent` takes counts and boundaries, never a candidate or a decomposition** — the function has no access to text to leak. The signature *is* the enforcement.

**Proved behaviourally, not by regex.** The suite builds an event from `"Margaret, Chriztopher Zzyzx"`, walks every reachable value, and asserts **every one is a number, a boolean, or an allowlisted string** — and that no token text appears anywhere.

`confirmedPartition: [1,1,1]` records *sizes*: every three-token candidate in every document produces the same value, so it identifies nothing.

**One deliberate omission:** no field for semantic type or interpretation. Tempting — *"were splits mostly on people?"* — but it starts narrowing which document a record came from. If that question matters it should be added with its own argument, not inherited from a convenience field.

---

## 11. Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` / production build | **PASS** |
| Full battery (88 files; 86 runnable suites) | **86 / 86 PASS** |
| `candidate-split-verification.ts` (new, 8 sections) | **PASS** |

Covers: lossless decomposition across 8 punctuation shapes · 2-token split · all boundaries in 3- and 4-token candidates · 1+2 and 2+1 · all seven 4-token partitions · 5-token single boundary · deterministic proposals · user override preserved distinctly from proposal · cancellation changes nothing · no decision/entity/semantic field on a split record · repeated execution byte-identical · the full telemetry privacy walk · local aggregation purity · no network or persistence in any of the three modules.

**Not verified, because not built:** output reconstruction after split, pieces entering ordinary review, pieces receiving different K/C/R/I, existing decisions outside the split unaffected. Those are integration properties and I will not claim them.

---

## 12. ⚠️ What I did not build, and why

**I stopped before session persistence, Workspace derivation, UI, and rebuild integration.**

The reason is concurrency, not effort. Applying a split requires changing exactly the four files another workstream is actively rewriting:

| File | Concurrent state |
|---|---|
| `domain/ReviewSession.ts` | modified — schema would need a new durable field + version bump |
| `engines/review/session.ts` | modified (+79) — reducer for a new command |
| `domain/Commands.ts` | modified — new `ReviewCommand` member |
| `workspace/Workspace.ts` | modified (+479) — `loadDocument` candidate-pipeline re-derivation |

Adding a session-schema field and re-deriving the candidate pipeline inside `loadDocument` while that file is being restructured is the "large refactor with merge risk" your own engineering principles warn about, and a botched merge there corrupts review sessions rather than just failing to compile.

**There is also a genuine unsolved problem I would rather surface than paper over:** a piece's span within an *occurrence* is not simply `occurrence.start + segment.start`. `Candidate.displayValue` is explicitly documented as *"one representative literal form… NOT necessarily what appears at every occurrence"* — `Chris, Margaret` may appear as `Margaret, Chris` elsewhere. Mapping segments onto each occurrence needs its own design, and `EffectiveSpan`/`redactionSpanOf()` is the precedent to follow (Normalization already narrows a redaction range within an occurrence — Split needs to *partition* one).

**What Stage 2 needs:** a quieter tree on those four files, plus a decision on per-occurrence segment mapping. The structural semantics are settled and tested, so Stage 2 is integration work against a fixed contract rather than open design.

If you would rather I proceed now and absorb the merge risk, say so — the design is settled and the core is done.

---

## 13. Files

| File | Change |
|---|---|
| `app/src/domain/CandidateSplit.ts` | **new** — decomposition, partitions, segments, provenance record |
| `app/src/engines/review/splitProposal.ts` | **new** — three named rules, proposals only |
| `app/src/metrics/splitTelemetry.ts` | **new** — content-free event + local aggregate |
| `app/verify/candidate-split-verification.ts` | **new** — 8 sections, in the battery |

**No existing file was modified.** Zero merge risk with the concurrent workstream.

---

## Product principle

> DocScrub may propose how a malformed review unit should be separated. The user confirms the structure. Then the user makes the privacy decisions they actually care about.

The core that decides *what a split means* is built, general (names are the witness, not the scope), and honest about what it does not know — `Smith Jones Brown` gets no proposal rather than a confident wrong one. What remains is wiring it to the review machinery.
