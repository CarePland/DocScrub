# Early OOXML structural spike

Architecture v0.2 §14 moves the OOXML feasibility spike earlier in the
migration sequence, ahead of finalizing ReviewEngine/CommandDispatcher
contracts, because parser/rebuilder fidelity is the single largest named
technical unknown in the whole plan (§15.2).

This directory holds the **Phase 1** half of that spike: a structural,
Python-side investigation (`scripts/ooxml_structural_spike.py`, one level up)
of real .docx files already present in the existing app's working state,
producing concrete counts of the OOXML constructs DocumentParser and
DocumentRebuilder will actually have to handle. It does not extract or
persist any document *text* -- only structural statistics (paragraph/run
counts, presence of headers/footers/tables/hyperlinks/tracked-changes/
comments/fields/content-controls/drawings, nested table depth) -- because the
documents analyzed are the maintainer's real working files, not synthetic
fixtures.

**This is not the Phase 2 browser POC itself.** It cannot be: the sandbox
this was written in has no npm registry access, so no browser-side OOXML/ZIP
library (`docx`, `jszip`, `pizzip`, `mammoth`, ...) could be installed to
prove browser-side round-trip fidelity. What this spike *does* establish is
which fidelity risks are actually present in a real document DocScrub
processes today, so the Phase 2 browser spike has concrete acceptance
criteria to test against instead of a generic "handle OOXML" goal.

See `findings.md` for the analysis and `structural-findings.json` for the
raw numbers.
