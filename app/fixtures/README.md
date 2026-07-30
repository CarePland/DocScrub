# Fixtures

Golden fixtures are the migration specification (architecture v0.2 §13,
ADR-009). Split into three families, each in its own subdirectory:

- `domain-parity/` — extracted text, candidates, occurrences, evidence,
  scores, recommendations, ambiguity/entity-resolution proposals, occurrence
  classification, replacement assignments, decisions, exports, final DOCX
  behavior, verification results (§13.1).
- `interaction/` — keyboard/focus navigation scenarios: result/category/
  control navigation, radio-to-input focus movement, text-field caret
  ownership, Tab/Shift+Tab exit, detail-mode entry/exit, Not Quite behavior,
  next-unreviewed behavior, focus restoration after rerender (§13.2). Empty
  today -- these depend on FocusNavigator and the React shell existing
  (Phase 4/5 of the migration strategy), which are not part of this Phase 1
  pass.
- `performance/` — parse/detection/render/memory/persistence/rebuild/
  verification budgets against representative document sizes (§13.3). Empty
  today for the same reason: meaningful budgets require the browser
  DocumentParser/DocumentRebuilder to exist (Phase 2/7), not just the Python
  reference implementation.

Every fixture case is a directory containing a `manifest.json` validated
against `schema/fixture-manifest.schema.json`, plus a `source/` directory
(when applicable) and an `expected/` directory of JSON files the manifest
points to.

## Generating domain-parity fixtures

`scripts/export_fixtures.py` (one level up) imports the existing Python
`redactor` package **read-only** and runs a synthetic document through the
real detection → quality → entity-resolution → occurrence-classification
pipeline, writing the result here. It does not modify anything under
`work/pii_docx_redactor/`.

```
cd DocScrub-Web
python3 scripts/export_fixtures.py
```

This currently produces one case, `domain-parity/synthetic-transcript-001/`,
covering a small synthetic document with a person name in three forms
(`Jane Smith`, `Smith, Jane`, `Jane Q Smith`), an email, a phone number, and
two numeric identifiers, across body paragraphs, a table, a header, and a
footer. It is meant to prove the fixture *format* end-to-end, not to serve as
a full parity corpus — expanding the fixture corpus with fixtures drawn from
real (de-identified) registrar documents is Phase 1 follow-up work, not done
in this pass.

## Adding a new domain-parity case

1. Add a source `.docx` (or a generator function, as `sample_docx_generator.py`
   does) under a new `domain-parity/<case-id>/source/` directory.
2. Extend `export_fixtures.py`'s `build_case()` call list with the new case
   id and source path, or write a small case-specific script that reuses
   `build_case()`.
3. Validate the resulting `manifest.json` against
   `schema/fixture-manifest.schema.json`.
