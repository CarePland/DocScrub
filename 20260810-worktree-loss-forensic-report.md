# DocScrub — Worktree Loss Forensic Report

**Date:** 2026-08-10
**Status:** INVESTIGATION ONLY — no files changed, nothing restored, nothing deleted.
**Scope correction:** this was reported as a login/account regression. It is not. It is a whole-worktree loss in which the account layer was one casualty among ~200 files.

---

## 1. Root cause

A cleanup operation ran on **2026-08-10 at 21:32 -0700**. It did two things:

1. Created branch `cleanup-safety-20260810`, commit `9426264` — *"Snapshot in-progress worktree before cleanup"* — capturing the entire uncommitted working tree.
2. Reverted the working tree on `main` back to `HEAD` (`b1e6ed0`, dated **2026-08-08 15:42**), discarding everything uncommitted.

Everything built between Aug 8 and Aug 10 lived only in the working tree. It was never committed to `main`. The snapshot is therefore the **only** copy.

The account/auth layer was part of that uncommitted work, which is why login disappeared. But so was the entire review-engine programme from those three days.

### Why it reads as "designed" rather than "broken"

The cleanup did not merely delete `app/src/account/`. It left behind two **replacement stubs** carrying comments that assert the missing behaviour is deliberate:

`app/src/account/localSessionOwner.ts` — current tree (12 lines):

```ts
/**
 * Account-aware ownership is intentionally nullable here: when
 * no signed-in owner is available, records remain local/unowned...
 */
export function currentLocalSessionOwnerId(): string | null {
  return null;
}
```

Same file in the snapshot (27 lines) — real implementation, plus two exports that no longer exist anywhere in the tree:

```ts
const LOCAL_SESSION_OWNER_KEY = "docscrub-local-session-owner-id";

export function setLocalSessionOwnerId(userId: string): void { ... }
export function clearLocalSessionOwnerId(): void { ... }

export function currentLocalSessionOwnerId(): string | null {
  try {
    const value = localStorage.getItem(LOCAL_SESSION_OWNER_KEY);
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
}
```

`usageMetrics.ts` received the same treatment: the Supabase RPC submission path (`upsert_document_usage_metric`, 21 RLS-protected parameters) was replaced with a local `localStorage` queue and a `retryPendingDocumentUsageMetrics()` that returns `Promise.resolve()`.

**Consequence:** `npx tsc --noEmit` passes clean on the current tree. The stubs are internally coherent. Nothing surfaces the loss — which is why this presented as a silent behavioural regression rather than a build failure.

---

## 2. Last known good state

| | Commit | Date | Contains |
|---|---|---|---|
| Current `main` HEAD | `b1e6ed0` | 2026-08-08 15:42 | Pre-auth, pre-Aug-8 review engine |
| **Snapshot (last known good)** | **`9426264`** | **2026-08-10 21:32** | **Everything** |
| `origin/main` | `e48199f` | — | Behind local main by 2 |

**`9426264`'s parent is `b1e6ed0`.** The snapshot is a *descendant* of HEAD, not an ancestor.

This matters: recovering from it moves the tree **forward**, not backward. The instruction "do not reset the whole repo to an older commit" does not apply — there is no older commit involved. `git merge-base --is-ancestor HEAD 9426264` returns true.

**Other recovery sources checked and ruled out:**

- `git stash list` — empty.
- `git fsck --lost-found` — dangling trees only, no dangling commits carrying unique work.
- 20 `refs/codex/turn-diffs/checkpoints/*` refs exist but the branch is the authoritative, complete recovery point.

---

## 3. What differs — HEAD vs snapshot

```
236 files changed, 275,533 insertions(+), 907 deletions(-)
192 added, 44 modified
```

`app/src/ui/app.ts`: **14,910 lines now vs 18,428 in the snapshot — 3,518 lines missing.**

### 3a. Auth / account layer

| File | Status |
|---|---|
| `app/src/account/authRedirect.ts` (70 lines) | **absent from tree** |
| `app/src/account/membership.ts` (121 lines) | **absent from tree** |
| `app/src/account/localSessionOwner.ts` | replaced by 12-line stub |
| `app/src/account/usageMetrics.ts` (313 lines) | replaced by 96-line stub |
| `app/src/lib/supabase.ts` | present but reverted (−7) |
| `app/supabase/migrations/202608060001_account_auth_foundation.sql` | **absent** |
| `app/supabase/migrations/202608060002_pending_organization_members.sql` | **absent** |
| `app/supabase/migrations/202608060003_usage_metrics_admin.sql` | **absent** |
| `app/supabase/migrations/202608060004_backfill_existing_accounts.sql` | **absent** |
| `app/verify/account-auth-foundation-verification.ts` | **absent** |
| `app/verify/usage-metrics-verification.ts` | **absent** |
| `app/docs/setup/auth-and-accounts.md` | **absent** |

**The single largest loss is `app/src/ui/previewGate.ts`: 1,364 lines in the snapshot, 211 in the current tree.**

The current 211-line file is the *original 2026-08-01 shared-password preview gate* — the temporary `PREVIEW_PASSWORD = "Scrubadub"` courtesy screen. The cleanup reverted this file to its pre-auth state, which is precisely why the app now presents a shared-password gate instead of a login.

The snapshot's version is the real authentication gate:

- `supabase.auth.signInWithPassword` — password sign-in
- `supabase.auth.signInWithOAuth` — Google OAuth
- `supabase.auth.signInWithOtp` — magic-link signup
- `supabase.auth.setSession` / `exchangeCodeForSession` — redirect session restore
- `supabase.rpc("accept_organization_invitation")` — invitation acceptance
- `supabase.rpc("update_own_profile")` — profile updates
- organisation membership loading
- a full multi-step setup wizard (`showSetupWizard`, `wireSetupWizard`, `renderSetupWizard`, `advanceSetupWizard`, `completeSetupWizard`) with invite rows and pending-member input

**`index.html` account UI** — present in snapshot, absent from HEAD:

`.app-settings-account`, Sign-out row, `.preview-auth-divider`, `.preview-account-switch`, `.preview-gate-status`, and the entire `.account-panel` subsystem (`.account-panel-card`, `.account-panel-header`, `.account-section`, `.account-line`, `.account-invite-form`, `.account-invite-output`).

In the current tree the settings menu instead carries:

```html
<div class="app-settings-item app-settings-item-disabled"
     role="menuitem" aria-disabled="true">User account</div>
```

— a permanently disabled placeholder.

### 3b. Review engine (also missing — not part of the original brief)

**Knowledge / evidence packs (18 files, all absent):**
`CensusNameEvidence`, `DomainReferenceEvidence`, `EmploymentHrEvidence`, `FinanceAccountingTaxEvidence`, `GnisPlaceEvidence`, `GovernmentPublicAdminEvidence`, `HigherEdTerminologyEvidence`, `LegalTerminologyEvidence`, `MedicalEvidence`, `ReferenceEvidence` + their eight `.data.ts` companions.

The current `src/engines/knowledge/` contains only the five pre-existing files (`FullValueAliasProvider`, `RelatedNameProvider`, `SemanticRelationshipProvider`, and two data files).

**Interpretation layer (directory does not exist in the tree):**
`candidate-interpretation.ts` (582), `interpretation-model.ts` (493), `person-adjudication.ts` (268), `variant-form-evidence.ts` (681).

**Cross-candidate (directory does not exist):**
`cross-candidate-evidence.ts` (255), `person-evidence-gate.ts` (151).

**Review engine:**
`CandidateSplit.ts` (309), `splitProposal.ts` (152), `proposedGroups.ts` (367), `residualReviewGate.ts` (387), `reviewNecessity.ts` (171), `documentNameEvidence.ts` (254), `quickApproval.ts` (260), `splitTelemetry.ts` (219), `positionTrace.ts` (408), `percentDisplay.ts` (97).

**Verification: 52 files** in `app/verify/` differ (mostly additions).
**Investigation: 41 files** in `app/investigation/` absent.
**Findings docs: 42** dated `.md` files at repo root absent.

### 3c. Ruled out as causes

- **Local config** — `app/env-config.js` is present, gitignored, and holds valid credentials (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`). Not the cause.
- **Stale build** — `dist/` was rebuilt at 22:25, newer than every source file; `dist/ui/previewGate.js` exists. The build faithfully reflects the reverted source. Not a runtime/artifact problem.
- **Routing/startup bypass** — `index.html` correctly loads `./dist/ui/previewGate.js` as the module entry point, `.preview-gate` markup is intact, the Exit Preview wiring is intact. The gate is working exactly as its (reverted) source specifies.

---

## 4. Group Check collision — the two implementations

Your current uncommitted work re-implements the Group Check UI standardization pass. **The snapshot already contains a different implementation of the same pass.** Neither contains the other; they diverge architecturally.

### Version A — snapshot (`9426264`)

Panel classes go on the **wrapper** (`groupCell`):

```ts
const groupCell = el("div", { class: "group-cell group-review-cell" });
...
if (isFocused) groupCell.classList.add("group-focus-panel");
```

Click target is the **label only**:

```ts
const label = el("span", { class: "group-row-label" }, group.canonicalName);
label.appendChild(el("span", { class: "row-count" }, ...));
label.addEventListener("click", () => {
  dispatcher.dispatchNavigation({ family: "navigation", type: "selectItem", itemId: group.groupId });
  render();
});
```

CSS styles the wrapper and reaches into the row via child selectors:

```css
.group-review-cell { min-width: 0; }
.group-focus-panel {
  order: -1;
  grid-column: 1 / -1;
  background: var(--focus-panel-surface);
  border-radius: 8px;
  padding: 0.5rem 0.6rem;
  margin-bottom: 0.35rem;
}
.group-focus-panel > .group-row {
  padding: 0.72rem 0.78rem;
  background: var(--surface);
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}
.group-focus-panel > .group-row.decision-tinted {
  background: var(--decision-tint); border-color: var(--decision-border);
}
.group-focus-panel > .group-row .group-row-label { font-size: 1.32rem; }
.group-review-cell:not(.group-focus-panel) > .group-row {
  min-width: 0;
  cursor: pointer;
}
.group-review-cell:not(.group-focus-panel) > .group-row:hover { border-color: var(--accent); }
```

### Version B — current working tree (uncommitted)

Wrapper gets only a layout class; panel classes go on the **row**:

```ts
if (isFocused) groupCell.classList.add("group-cell-focused");
...
row.classList.add(isFocused ? "group-focus-panel" : "group-review-cell");
row.addEventListener("click", (event) => {
  if ((event.target as HTMLElement | null)?.closest?.("button, input, select, textarea, a")) return;
  dispatcher.dispatchNavigation({ family: "navigation", type: "selectItem", itemId: group.groupId });
  render();
});
```

The label click handler is **removed**.

```css
.group-cell-focused { grid-column: 1 / -1; order: -1; }
.group-review-cell { min-width: 0; padding: 0.5rem 0.7rem; }
.group-review-cell:hover { border-color: var(--accent); }
.group-review-cell .group-row-label { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.group-review-cell .group-row-actions { flex-basis: 100%; justify-content: flex-end; }
.group-focus-panel { align-items: flex-start; gap: 0.55rem 0.75rem; padding: 0.85rem 1rem; border-radius: 8px; }
.group-focus-panel .group-row-label { font-size: 1.3rem; }
.group-focus-panel .group-row-actions { flex-basis: 100%; margin-left: 0; }
.group-focus-panel > .confidence-plain, .group-focus-panel > .reviewed-check, .group-focus-panel > .decision-pills { margin-left: auto; }
.group-cell-focused .group-members { margin-left: 0; padding: 0.15rem 0 0 0; }
.group-cell-focused .not-quite-panel { margin-left: 0; }
```

### Comparison

| | A — snapshot | B — working tree |
|---|---|---|
| Panel classes on | wrapper (`groupCell`) | row (`.group-row`) |
| Layout class on wrapper | `.group-focus-panel` carries it | separate `.group-cell-focused` |
| Focused surface | `--focus-panel-surface` wrapper + accent-ringed inner row (two nested surfaces) | single row surface |
| Click target | label text only | whole row, with `closest()` guard for interactive children |
| Handles `decision-tinted` when focused | yes | not addressed |
| Label overflow/ellipsis | no | yes |
| Actions-row layout | no | yes (`flex-basis: 100%`) |
| Nested member/Not-Quite margin reset | no | yes |

**Two observations, offered as findings rather than a recommendation:**

1. **A has a latent inconsistency.** Its CSS sets `cursor: pointer` on the whole non-focused `.group-row`, but only the label is clickable. Clicking the row's empty space shows a pointer and does nothing. B resolves this by making the row itself the target.
2. **A does something B currently drops.** A's two-surface treatment (`--focus-panel-surface` wrapper containing an accent-ringed `--surface` row) is what visually matches the Ambiguity / Item / Type inspector columns, and A explicitly preserves `decision-tinted` on the focused row. B's flatter single-surface treatment does not carry either.

These are separable: B's interaction model and A's focused-surface treatment are not mutually exclusive.

---

## 5. Recommendation

Restore the full snapshot state, not the account layer alone. Reasons:

- A narrow auth-only restore leaves ~190 files of review-engine work destroyed, with the snapshot branch as the sole remaining copy.
- The restored auth code may not compile in isolation: the snapshot's `usageMetrics.ts` imports `partitionCandidatesByResolution` from `engines/review/coverage.js` and `decisionTrackerFigures` from `metrics/decisionTracker.js`, both of which differ in the current tree; the snapshot's `app.ts` (3,518 lines larger) is where the account wiring actually lives, and that file also carries the interpretation-layer integration.
- Recovery is forward-moving (`9426264` descends from `HEAD`), so it carries none of the risk of a historical reset.

Suggested sequence, once you decide:

1. Branch from current `main` to preserve tonight's uncommitted group-check work as its own commit.
2. Restore from `9426264` — either by merging the branch or by checking out paths.
3. Reconcile the Group Check pass per your decision in §4.
4. Rebuild `dist/`, then run `npx tsc --noEmit`, the verification suite, and the production build.
5. Commit — the underlying failure is that three days of work sat uncommitted.

---

## 6. Caveat on the original framing

Two constraints in the brief cannot both be met:

- *"Everything is local… not an external-service problem"* and *"restore the previous local implementation"* — the previous implementation is **Supabase-backed**. It requires the hosted project at `kvzaammtfumxrubvtdmc.supabase.co`, and four SQL migrations must be applied to that database for `accept_organization_invitation`, `update_own_profile`, and `upsert_document_usage_metric` to resolve. Restoring the client code alone will surface RPC errors if the migrations were never applied, or were rolled back.
- *"Do not rebuild auth"* is satisfiable — the full prior implementation exists verbatim in `9426264` and needs no redesign. But it is not a local implementation, and it will not function as one.

Worth confirming the state of that Supabase project before or alongside any restore.

---

## Appendix — verification commands used

```bash
git log --format="%h parent=%p %s" -1 9426264      # parent = b1e6ed0
git merge-base --is-ancestor HEAD 9426264          # true: snapshot descends from HEAD
git diff --shortstat HEAD 9426264                  # 236 files, +275,533 / -907
git stash list                                     # empty
git fsck --no-reflogs --lost-found                 # dangling trees only
npx tsc --noEmit                                   # exit 0 on current tree
```
