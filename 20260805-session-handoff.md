# Session Handoff — 2026-08-04/05

Read this first. Everything below is verified state, not intent.
**§6 (2026-08-06) amends §2 — read it before scoping §2A or §2B.**

**Verification at handoff:** `npx tsc --noEmit` clean · `npm run build` clean ·
**51 real verify suites clean** · `ui-smoke` **144/144**.
(`ls verify/*.ts | wc -l` currently returns **52**: 51 real suites plus
`verify/_probe_tmp.ts`, an inert scratch file slated for deletion (§2D). After
that deletion the count is **51** — that is not a missing-suite regression.
Older notes saying 47 predate the concurrent intake work. Always recount.)

---

## 1. What shipped

### Type Check — member grid (complete)
- Members render as **two auto-fill grid regions**: the first contiguous run
  beside the inspector, the remainder full-width directly below. No float,
  masonry or overlay. `layoutMemberRegions()` is a render-tail measurement
  that moves whole rows only.
- **Inspector on the left**, 2fr/3fr (items take the larger share — People's
  20rem track in a 40% column yields one item per row).
- **One ordered collection, one cursor.** ←/→ are flat ±1 across the seam;
  ↑/↓ step within a region via the shared `gridStep`, crossing the seam by
  **column position**, not index. Per-region column counts are measured
  separately (`memberGridContainerFor`).
- **Cell is name + count only.** Alternating row banding (`bandGridRows`,
  measured per visual row — `nth-child` can't express "every other row" under
  auto-fill).
- `TYPE_TRACK_MIN` — per-type track floors, **starting points, not measured**.
  Tune against a real document.

### Focus panel
- Confidence is a **word**, not a percentage (`confidenceBand`): Highly
  likely / Likely / Uncertain / Unlikely / Highly unlikely. Top three
  thresholds are `confidenceOpener`'s own (95/80/50) so the header can never
  contradict the sentence. **No hue** — deliberately; see §4.
- Verdict lives **inside the `<summary>`**, so collapsing Why? hides the
  reasoning but never the conclusion.
- Evidence is a **signed inline chip flow** — ✓ / ✗ / • — built from the
  dictionary's existing `short` register. Ordered by |weight|, truncation
  disclosed as "+N more", real `·` separator so copy-paste works.
- Sources collapse near-identical snippets ("and similar"); dedupe runs
  **before** the 5-snippet cap.

### Audit schema **v2** (breaking, versioned)
Three raw-PII paths out of the app, closed:
1. `AuditedEntityGroup.canonicalName` — **removed**.
2. `groupId` — now an opaque per-record alias (`group-1`…). The domain id is
   `person:${surname}:${initial}`, i.e. the id *was* a surname.
3. `DecisionReuseEngine` interpolated a canonical name into an evidence
   `description`, which rides into the record as `importEvidence` — reworded.

`AUDIT_RECORD_SCHEMA_VERSION` 1 → 2, so v1 files are cleanly **rejected**
rather than half-parsed.

### Copy / voice
- **Professional tool voice** and **reviewer-vocabulary** principles are in
  `app/CLAUDE.md` — they govern future work, not just this pass.
- All 55 evidence `short` labels rewritten to AG's supplied list; "token"
  eliminated; three frequency rules now render distinctly.
- `confidenceOpener` openers de-anthropomorphised ("We believe this is X" →
  "Almost certainly X").

### Port defect repaired
`CandidateQualityEngine` now carries `DECLARED_EVIDENCE_POLARITY` — Python's
`raw.get("polarity") or _polarity(weight)`, declared-wins. 13 rules were
rendered under a sign Python says they don't have. **Weights untouched;
scores identical.** Neutral signals now render as `•`.

---

## 2. Open — highest value first

**A is blocked** on an architecture/product decision (see §6.1) and is not
ready work. **B, C and D are ready to pick up.** Read §6 before starting A or B.

### ⚠️ A. Raw names still in every artifact (OPEN DEFECT, not fixed)
`Candidate.id === normalizeCandidate(text)` — the candidate's own text,
lowercased. Candidate ids are all over the audit record, so **every detected
name is in the output in lowercase form**. v2 closed three paths; this is the
fourth and largest.

`audit-exporter-verification.ts` **prints this loudly on every run and does
not count it as a failure**, with the reason stated in-file: nobody is
authorized to fix it yet, and a permanently-red suite gets tuned out.
**Promote it to `check()` the moment ids are de-identified.**

Safe to fix without changing interpretation *if* the new id is a
deterministic pure function of the current key (hash → identical equivalence
classes, cross-document reuse still works). Cost is readability, not
correctness. But it changes the domain's primary key → `ReviewSession`,
`WorkspaceSaveFile`, decision reuse. **Scope it properly.**

> **Superseded in part — see §6.1.** Do not assume the fix requires changing
> `Candidate.id`. Evaluate an export-boundary alias layer first. The hashing
> option described above should also be weighed against §4's group-alias
> reasoning.

### B. Character normalization
See `20260805-character-normalization-scoping.md`. Headline:
- Tokenizers are ASCII-only → `José Martínez` scores as `Jos`/`Mart`/`nez`.
- **NFKC does nothing for accents** (measured). NFD+mark-strip fixes most but
  **not** `ø ł đ ı ß æ œ þ ð` (precomposed, don't decompose) — needs a map.
- **Python has the same ASCII regex** (`candidate_quality.py:652`). The port
  is faithful; the oracle is wrong. Fixing it is a **declared deviation** that
  moves scores and requires regenerating parity fixtures.
- Recommended order: Unicode tokenizer → **re-measure on a real document** →
  identity fold only as reviewer-confirmable → garble matching last.
- **Declare the deviation using the mechanism that already exists** — the
  `short` register (§4) is the precedent for a deliberate, recorded departure
  from the oracle. Do not invent a second mechanism. See §6.3.

### C. Two-region layout for Item Check / Ambiguity Check
Same dead space beside their panels (AG: "they should all be a similar
experience"). Generalize `layoutMemberRegions` + `memberGridTarget`. Would be
the moment to consolidate the **four** copies of the split geometry into one
`.focus-split` (ui-smoke pins the literal text of the existing ones).

### D. Smaller
- Evidence chips carry no **magnitude** — a +4 and a +50 look identical.
- No **live browser validation** all session. The server is reachable from
  Chrome; the **preview password gate** stops automated checks. If you sign in
  and leave the tab open, the region cut / banding / track values can be
  verified directly.
- `verify/_probe_tmp.ts` — leftover scratch, blanked to an inert `export {}`.
  The mount refused `rm`/`mv`/`chmod`. **Delete it.**

---

## 3. Traps worth knowing

- **Rebuild before sweeping.** A stale `dist/` produced a dozen phantom
  non-zero exits and cost real time. `npm run build` then run suites.
- **`git` may be locked** by AG's concurrent work. A partial
  `git checkout HEAD -- <files>` silently reverted two files mid-command.
  Back up before any git operation on the working tree.
- **Deliberate constraints that look like wording preferences:**
  - `decisionTracker` copy must never say time was **"saved"** — only work
    *avoided*. Enforced at runtime by `decision-reduction-verification`.
  - `.action-cluster` must keep `flex-wrap: wrap` — three surfaces depend on
    it; Type Check scopes its `nowrap` override locally.
  - The decision palette is **fully allocated**. Check before adding any
    colour to the review UI.

---

## 4. Decisions taken, with reasoning (don't silently reopen)

- **No hue on confidence.** It was removed once on purpose (a red 72% inside a
  green Keep card). The panel is decision-tinted. Low confidence also isn't
  *bad* — "Records Office, Unlikely" is a correct result. Word carries
  direction; ink weight carries certainty.
- **✓/✗ glyph-led, colour subordinate.** Those are the decision palette's
  green and red; the glyph must be sufficient alone (also serves colour-blind
  reviewers).
- **`short` register deviates from the oracle; `standard`/`expert` do not.**
  Those two feed the audit narrative and parity suites. Keep that split.
- **Group alias is a counter, not a hash.** An unsalted hash of a surname is a
  dictionary attack; a salted one either breaks reproducibility or ships the
  salt in the same file.
- **Sources collapse merges only digits/whitespace/case.** No fuzzy matching:
  on a panel whose job is showing evidence, silently hiding a distinct snippet
  is worse than showing a duplicate.
- **↓ at the last member row clamps**, deliberately not entering the pane
  (unlike the sectioned queue) — the cursor is already inside the type and the
  pane follows it. Most likely of these to want revisiting.

---

## 5. Correction to carry forward

Earlier in the session I linked two things from one stray output: accent
mangling **and** "non-people being called people in intake". The accent damage
is **confirmed in code**. The misclassification claim was **never verified** —
org names being evaluated by a person-evidence path is exactly what that path
is for. Don't let it harden into an established bug.

---

## 6. Amendment — 2026-08-06 (AG)

§§1–5 stand as verified state. The following corrects the *direction of the
proposed work* in §2; it does not contradict any measured fact above. Original
§2 text is left intact deliberately — the reasoning it records is still worth
reading, it is the conclusion that moved.

### 6.1 §2A — evaluate an export-boundary alias layer before touching `Candidate.id`

Do **not** assume de-identification requires changing `Candidate.id`.

§2A's hashing proposal raises the same privacy concern discussed in §4. A
candidate id is likewise derived from a personal name, so the reasoning from the
group-alias discussion should be evaluated here as well.

The reason groups could take a counter is that group ids only need to be stable
*within* a record. Candidate ids need cross-document stability — but only the
**internal** key does. The exported artifact does not need to carry the reuse
key at all.

**Evaluate first:** keep the durable/internal candidate key exactly as it is for
`ReviewSession`, `WorkspaceSaveFile` and decision reuse, and emit **opaque
per-record aliases** in audit artifacts, analogous to the group aliases shipped
in v2. This confines the change to the export boundary, leaves the domain's
primary key and decision reuse untouched, and reuses a pattern already in the
codebase rather than introducing a second de-identification scheme.

Whether an export-boundary alias layer fully satisfies downstream audit and
import requirements remains to be demonstrated.

Changing `Candidate.id` remains an available fallback if the alias layer proves
insufficient — but it is the second option to consider, not the first.

**Status: blocked** on an architecture/product decision (AG). Not ready work.

### 6.2 Preserve the known-leak regression signal

`audit-exporter-verification.ts` should continue **not** to fail on the
currently acknowledged leak — the reason stated in-file is right, a
permanently-red suite gets tuned out.

But the warning as written is blanket: a *fifth* leak path would produce
identical output. Record the explicitly acknowledged set of leaking artifact
fields, and **fail if the set grows beyond it**. That keeps the known defect
quiet and restores the regression signal for new ones. Promote the whole block
to `check()` once ids are de-identified, as §2A already says.

### 6.3 §2B — use the existing declared-deviation precedent

The Unicode tokenizer fix is a declared deviation from the Python oracle. The
repo already has a mechanism for that: the `short` register (§4) is a
deliberate, recorded departure, while `standard`/`expert` stay faithful. Record
the normalization deviation the same way. Do not invent a second mechanism.

### 6.4 v1 audit artifacts are privacy-legacy records

Schema v2 rejects v1 files, which is correct for parsing — but v1 artifacts
contain raw personal names by construction (`canonicalName`, surname-bearing
`groupId`, the interpolated `importEvidence` description). Rejecting them at
read time does not remove them from disk.

Treat any v1 audit artifact as a **privacy-legacy record: delete or
regenerate**. A privacy fix that leaves the leaking generation sitting in the
workspace is half-done.

### 6.5 Ready work

**A is blocked** (§6.1). **B, C and D are ready to pick up.** The §2 ordering is
by value, not by readiness — do not read it as a queue.
