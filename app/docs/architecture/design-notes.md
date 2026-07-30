# Design notes

A running log of what each on-page version corresponds to. The version
label shown next to the DocScrub logo in the app header
(`src/ui/version.ts`'s `APP_VERSION`) is bumped by hand alongside a new
entry here, every time a change is visible in the UI -- so opening this
page tells you exactly what changed since the version you last saw,
without digging through commit history or the fuller `docs/detection/`
findings docs (which remain the detailed record for *why*; this file is
the short, dated *what*).

Purely internal engine/domain changes with no visible UI effect don't get
a version bump or an entry here -- see version.ts's own doc comment.

Format: newest entry first. One line per version -- a sentence or two, not
a full findings doc; link to the relevant `docs/detection/*.md` for detail.

---

**v2026-07-29.03** -- Quick-pick chips revision. Rename quick-picks (Group
Check row-level, Item Check bulk toolbar) are no longer radio inputs that
just stage a choice -- each is now a button that commits and advances
immediately on click or Enter, with "Something else…" as a third option
in the same row that reveals the free-text field (pre-filled, for minor
edits) instead of a permanently-visible separate control. Arrow keys rove
focus across the chip row; opening the editor focuses the chip matching
the pre-filled default so a fast reviewer can accept it with one
keystroke. See `docs/detection/group-check-python-parity-revision.md`'s
addendum.

**v2026-07-29.04** -- Group Check keyboard and navigation revision.
"Rename" relabeled "Change" (key C, not N) and "Not Quite" relabeled "Fix
this" (key F, not Q) everywhere they appear -- display/keybinding only,
the underlying decision vocabulary and audit trail are unchanged. The
brief acknowledgement pulse (border + subtle movement) now fires for every
decision path, not just Item/Ambiguity Check's -- Group Check's bulk
actions and Not Quite's per-member actions get it too. K/C/R/I/F always
re-target the button highlight even mid-edit, but a draft's typed text now
survives switching away and back (per-target draft cache). Group Check
rows default to expanded whenever they're the reviewer's current focus (no
more separate manual expand toggle), and arrow keys inside an expanded
group now roam its own checkbox/action-button row and member list
directionally (Left/Right within a row, Up/Down between rows) using real
DOM focus -- Tab/Shift+Tab still always mean "next/previous item," never
"next control." See
`docs/detection/group-check-keyboard-and-navigation-revision.md`.

**v2026-07-29.02** -- Group Check Python-parity revision. Per-member
checkboxes with tri-state "select all" on each Group Check row, subset
bulk actions ("Rename selected", etc.) when fewer than all members are
checked, a new expand/collapse toggle separate from keyboard focus, a
radio quick-pick above the Rename editor so accepting a "found" spelling
never requires typing (Group Check and Item Check's bulk toolbar), and
live per-item/per-group confidence badges that jump to 100% once a member
is reviewer-decided -- see
`docs/detection/group-check-python-parity-revision.md`.

**v2026-07-29.01** -- Command bar + inline editors revision. The command
bar moved above the stage body and its text now changes with focus context
(Not Quite open vs. not, an inline editor open vs. not) instead of being
fixed per stage; every button's redundant "(k)"/"(n)"/etc. hint was removed
to match. `window.prompt()` is gone -- Rename and Redact (Item Check,
Ambiguity Check, the bulk-selection toolbar, and Not Quite's per-member
actions) now open an inline text editor in place. Root-caused and fixed a
real defect where the keyboard "n"/"r" shortcuts silently did nothing in
Item Check/Ambiguity Check and inside an open Not Quite panel -- see
`docs/detection/command-bar-inline-editors-revision.md`. Also: the version
label now always carries a same-day counter (`.01`, `.02`, ...), not just a
bare date, so a same-day refresh can prove it picked up a change.

**v2026-07-29** -- Versioning introduced. The app header's plain-text
"DocScrub-Web" title is replaced with the DocScrub logo
(`assets/docscrub.png`), and this small version label is added next to it
so it's obvious at a glance whether the page you're looking at is current.
Also the day's Group Check revision landed (compact color-coded rows,
arrow-key navigation now follows whatever sort order is on screen instead
of a fixed structural order, Not Quite auto-collapses to a single decision
once every member agrees) -- see `docs/detection/group-check-revision.md`.
