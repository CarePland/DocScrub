# Character Normalization — Garble, Accents, Variants

**Status:** Scoping. Nothing implemented.
**Date:** 2026-08-05
**Instruction (AG):** *"We need a garble/accent/variant normalizer. Where are we in the actual implementation?"*

---

## 1. Where we actually are

| Layer | State | What it does |
| --- | --- | --- |
| **Normalization pass** (`normalization.ts`) | ✅ shipped | Strips *conversational* affixes — "Thanks Andrew" → "Andrew". Three gates, conservative. Operates on **words**, never characters. |
| **NFKC** (`scoring.ts`, `resolution.ts`, `FullValueAliasProvider.ts`) | ✅ present | Unifies *compatibility* forms — curly quotes, ligatures, full-width. **Measured: does nothing for accents.** |
| **Diacritic folding** | ❌ none | No NFD+mark-strip, no deburr, nowhere. |
| **Garble / OCR-variant merging** | ❌ none | `ocr-artifact` *scores* garble at −35. Nothing repairs it; nothing merges `Goodl0e` with `Goodloe`. |
| **Tokenizers** | ⚠️ actively lossy | ASCII-only classes, upstream of everything above. |

So: a **phrase** normalizer exists, a **character** normalizer does not, and the tokenizer damage happens before either could help.

### The measurement

`TOKEN_RE` at `scoring.ts:216` is `/[A-Za-z][A-Za-z'’.-]*/g`. Actual output:

| Input | Today | With NFKC first | NFD + strip marks |
| --- | --- | --- | --- |
| `José Martínez` | `Jos, Mart, nez` | *unchanged* | `Jose, Martinez` ✅ |
| `Yazmine Guzmán` | `Yazmine, Guzm, n` | *unchanged* | `Yazmine, Guzman` ✅ |
| `Renée O'Brien` | `Ren, e, O'Brien` | *unchanged* | `Renee, O'Brien` ✅ |
| `Nguyễn Văn An` | `Nguy, n, V, n, An` | *unchanged* | `Nguyen, Van, An` ✅ |
| `Søren Kierkegaard` | `S, ren, Kierkegaard` | *unchanged* | `S, ren, …` ❌ |
| `Łukasz` | `ukasz` | *unchanged* | `ukasz` ❌ |
| `Müller` | `M, ller` | *unchanged* | `Muller` ✅ |

Two conclusions the table forces:

1. **NFKC is not doing the job anyone assumed it was.** It is not a diacritic fold and never was.
2. **NFD + mark-strip is necessary but not sufficient.** `ø`, `ł`, `đ`, `ı`, `ħ`, `ß`, `æ`, `œ`, `þ`, `ð` are *precomposed letters*, not base+combining-mark, so NFD does not decompose them. They need an explicit map. Worse, they fail **silently and asymmetrically**: `Søren` becomes tokens `S` and `ren`, which look like ordinary short words rather than damage.

---

## 2. ⚠️ This is a defect in the oracle, not in the port

`candidate_quality.py:652`:

```python
re.findall(r"[A-Za-z][A-Za-z'’.-]*", unicodedata.normalize(...))
```

Identical ASCII class, identical NFKC-then-ASCII ordering. **The TypeScript port is faithful.** (Python's `\w+` *would* have handled this correctly — `re.findall(r'\w+', 'José')` → `['José']` — but that is not what the oracle uses.)

Consequences, and this is the part to decide before any code:

- Fixing this is a **declared deviation from the behavioral oracle**, not a parity repair.
- It **changes scores** for any document containing a non-ASCII name. `quality-parity`, `detection-parity` and `production-parity` will diverge, and their fixtures need regenerating with the deviation recorded.
- Doing it "quietly as a bugfix" would silently break the parity discipline the repo is built on.

The fix is still clearly right — `José Martínez` scoring as `Jos`/`Mart`/`nez` is wrong by any standard, and every name-evidence rule (`known_first_name`, `known_surname`, `strong_name_structure`) is being evaluated against rubble. But it needs to be taken as a decision, not slipped in.

---

## 3. Three separable problems

They are routinely conflated and have **different risk profiles**. They should not ship as one change.

### 3a. Tokenizer (non-lossy) — do this first

`/[A-Za-z]…/` → `/\p{L}[\p{L}\p{M}'’.-]*/gu`.

Makes `Guzmán` one token instead of two-plus-debris. **Merges nothing** — it only stops destroying input. Everything downstream (name lexicons, structure rules, evidence) starts seeing real words.

Prerequisite for everything else: *a folder placed downstream of an ASCII tokenizer never sees the character it exists to fold.*

### 3b. Fold for identity (lossy, merges) — decide deliberately

Only at the identity-key boundary, `normalizeCandidate()`, which is what decides whether two spellings become **one review item**.

NFD + mark-strip + an explicit map for the precomposed letters above.

**The risk is asymmetric, and it runs the opposite way from OCR fragmentation:**

- Fragmenting costs review time — the reviewer sees two items and decides twice.
- Folding wrongly means **one decision silently covers something the reviewer never saw**.

`Guzman`/`Guzmán` are almost certainly the same person. `Jose`/`José` usually are. But this is a redaction tool, and "usually" is the word that should make us gate it. Recommendation: fold at the *grouping/suggestion* layer, where the reviewer confirms, rather than at the identity key, where it is silent. That keeps the safe direction of error.

### 3c. Garble / OCR variants — hardest, lowest confidence

`Goodl0e` ↔ `Goodloe`, `rn` ↔ `m`, `1` ↔ `l`. This needs edit-distance or confusion-matrix matching, which is exactly the fuzzy matching deliberately rejected for the Sources collapse earlier, for the same reason: a threshold that hides a genuinely distinct item is worse than one that shows a duplicate.

If built, it belongs as a **suggestion** ("these may be the same — merge?"), never as a silent merge, and it should follow `normalization.ts`'s corroboration-gate shape: only propose a merge when an independently detected candidate corroborates the target.

---

## 4. Recommended order

1. **Unicode tokenizer** (3a) — declared oracle deviation, parity fixtures regenerated, scores re-baselined. Fixes the actual damage. No merging behavior changes.
2. **Re-measure** on a real accented document before going further. Much of the apparent "variant" problem may simply disappear once names stop being shredded — worth confirming before building 3b or 3c.
3. **Identity fold** (3b) as a reviewer-confirmable suggestion, not a silent key change.
4. **Garble matching** (3c) only if 1–2 leave a real gap, and only as a proposal.

Step 2 is the one most likely to be skipped and the one most likely to save the most work.

---

## 5. Open questions for AG

- **Does the oracle deviation need Python updated too**, or does DocScrub-Web now lead and Python follow? This is the first deviation that makes the TS app *more correct* rather than merely different.
- **Should folding ever be silent?** My recommendation is no — reviewer-confirmable only — but that trades review time for safety, and that is your call, not mine.
- **Scope of the character map.** Latin-1 + Latin Extended-A covers European names. CJK, Arabic, Cyrillic are a different problem entirely (no folding applies) and would need the tokenizer fix only.
