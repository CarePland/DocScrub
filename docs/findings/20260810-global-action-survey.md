# Global / Bulk Action Survey — all stages

**AG, 2026-08-10. SURVEY ONLY — no code changed.**

Prompted by: *"they feel extremely inconsistent from step to step, and I am not
sure they exist on each step."* They are inconsistent, and the inconsistency is
structural rather than cosmetic. Three separate defects, listed by severity.

---

## 1. The inventory

| Stage | Bulk actions offered | Built by | Scope resolver | Zone-bounded? |
|---|---|---|---|---|
| **Type Check** | Keep all as-is · Change all… · Redact all… · None are personal (emails/phones only) | `typeBulkActions` (12351) | `headingActionScope(ids, state)` — **stage arg omitted** | Partially — see §2 |
| **Item Check** | Accept Next N · declared section actions · declared tier actions · Reset Zone / Reset Category | `headingSectionActions` (8880) | `headingActionScope(ids, state, "item-check")` | Yes |
| **Ambiguity Check** | same shape as Item Check | `headingSectionActions` (8880) | `headingActionScope(ids, state, "ambiguity-check")` | Yes |
| **Group Check** | *none* — bare `K/C/R/I/F` act at group scope because the group **is** the focused item | — | — | n/a (deliberate) |

Group Check's absence is documented and correct (`groupScopeActions`, 12455):
a modifier meaning "wider scope" is meaningless when the reviewer is already
standing at that scope. **That one is not a gap.** The other three are.

### Chord vocabulary as it actually stands

| Chord | Type Check | Item Check | Ambiguity Check |
|---|---|---|---|
| `Opt K` | Keep all as-is | — | — |
| `Opt C` | Change all… | — | — |
| `Opt R` | Redact all… | — | — |
| `Opt N` | None are personal *(emails/phones only)* | — | — |
| `Opt I` | — | Ignore all | Ignore all |
| digits `1–9` | — | assigned per declared action | assigned per declared action |
| `Alt Shift A` | **absent** | Reset All in Category | Reset All in Category |
| `Alt Shift R` | **absent** | Reset Zone | Reset Zone |

Two of the three stages share almost nothing with the third. Type Check speaks
in fixed letters; the queues speak in digits assigned per section. A reviewer
crossing stages has to relearn the bar.

---

## 2. ⚠️ DEFECT — Type Check has **two paths to the same action with two different scopes**

The same conclusion is reachable two ways, and they cover different populations:

```
app.ts:12385   applyTypeBulk(group, "Keep",  state, scope.ids)   // toolbar / Opt K  → ZONE-BOUNDED
app.ts:12428   applyTypeBulk(group, "Ignore", state, scope.ids)  // toolbar / Opt N  → ZONE-BOUNDED
app.ts:12840   applyTypeBulk(group, "Keep"|"Ignore", state)      // bare K / I on a type CARD → NO ids
app.ts:12849   openInlineEditor({ …, candidateIds: remaining })  // bare C / R on a type CARD → NO bound
```

`applyTypeBulk`'s own signature documents the divergence:

```ts
/** The scoped subset (a checked selection). Absent = every remaining
 *  member, which is the pre-selection behavior verbatim. */
ids?: readonly string[]
```

`ids` absent ⇒ `unresolvedTypeMembers(group, state)` ⇒ **every remaining member,
unbounded**. So bare `K` from a type card can decide 44 items in one keystroke
while `Opt K` on the identical type decides at most `ZONE_CAPACITY`.

**This is the direct cause of "I used Keep All and it updated a lot more than
the Zone."** It is also why it was consistent across Organizations/Departments
and Acronyms — it is a property of the path, not of the data.

*Honest caveat:* an unbounded path predicts *zero* remaining afterwards, and you
observed 17 of 61 and 9 of 50 surviving. So the unbounded call explains the
"more than the Zone" half but not the "but not everything" half. Something is
also excluding a subset from `unresolvedTypeMembers`. I have not chased that
yet and am not going to guess at it.

---

## 3. ⚠️ DEFECT — Type Check computes its zone with the **wrong stage's** resolution predicate

```ts
// 12369, typeBulkActions
const scope = headingActionScope(group.candidateIds, state);
```

```ts
// 9072 — the parameter Type Check never passes
stage: "item-check" | "ambiguity-check" = "item-check"
```

Type Check silently takes the `"item-check"` default. `headingActionScope` uses
that stage to decide which cells count as resolved when it partitions the zone,
so Type Check's bound is computed over Item Check's notion of "done". The two
stages do not resolve the same candidates at the same time.

The type union is also the reason `type-check` cannot be passed: **Type Check is
not expressible in the scope resolver's own vocabulary.** The default masks
that rather than surfacing it.

---

## 4. ⚠️ DEFECT — the Reset chords do not exist on Type Check

`handleResetScopeKey` opens with:

```ts
const queueStage = activeSectionedQueueStage(state);   // "item-check" | "ambiguity-check" | null
if (!queueStage) return false;
```

On Type Check this is `null`, so `Alt Shift A` / `Alt Shift R` return `false`
and nothing happens — no action, no refusal, no status line. This is confirmed
by your position trace: 39 events, every one a `render` at `stage=type-check`,
and **zero reset or refuse events**.

Not a regression — the binding was never wired there. But the failure mode is
the one this codebase specifically tries not to have: *a key that is silent
rather than refusing.* Elsewhere the app calls `refuse(...)` so the reviewer
learns the key exists but does not apply. Here it dead-ends.

The same union appears here as in §3. `activeSectionedQueueStage` and
`headingActionScope` both encode "there are two review stages," and Type Check
is the third one neither knows about.

---

## 5. What this suggests, without proposing an implementation

The three defects have **one shared cause**: Type Check was built before the
sectioned-queue vocabulary existed and was retrofitted in 2026-08-03
(*"Type Check — Keep all as-is, change all etc need to have the same Opt/Alt
controls"*). That pass converted its buttons into `QueueSectionAction`
descriptors — the right move, and it is why one chord renderer serves all three
stages today. But it stopped at the **descriptors**. It did not bring across:

- the scope resolver's stage vocabulary (§3),
- the single-path discipline for applying a bulk (§2),
- the review-management controls (§4).

So Type Check *looks* like it joined the shared model and only partly did.

Three questions I think have to be answered before any of it is standardized,
and all three are yours:

1. **Is `Opt`+letter or digit assignment the standard?** They are currently
   split cleanly by stage. Unifying means one of the two stages relearns its bar.
2. **Should bare letters on a Type Check card be bulk actions at all?**
   Everywhere else, a bare letter acts on the focused *item* and a modifier
   widens scope. Type Check's card is the one place where a bare letter is
   itself a bulk — which is the §2 defect stated as a design question rather
   than as a bug.
3. **Is the Zone bound a property of the review model or of the queue stages?**
   §3 is only a defect if the answer is "the model." If Type Check is
   intentionally unbounded, then the toolbar path is the wrong one, not the
   card path.

I would not change the bound until 3 is settled, per the Review Zone doc's
reservation of that decision to you.

---

## Verification status

No code changed. Last known state: 88/88 suites green.
