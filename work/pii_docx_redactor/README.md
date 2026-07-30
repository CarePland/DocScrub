# DocScrub Local DOCX PII Redactor

Small local-only utility for checking and redacting possible PII in `.docx` files.

It does not call cloud APIs, does not use an LLM, and does not modify the original document.

## Design Goals

This repository documents product intent, not just implementation details. The code will change as the app improves, but the workflow principles should remain comparatively stable.

Future contributors should be able to understand why the interface behaves the way it does, what user experience rules should not be violated, and how to evaluate new ideas against the existing philosophy. A new feature is not only judged by whether it works; it is judged by whether it reduces reviewer effort, preserves consistency, and helps work reach completion.

DocScrub is designed for fast, careful local document checking. The workflow should:

- minimize reviewer cognitive load
- reduce unnecessary workflow stages
- maximize consistent behavior across screens
- avoid forcing reviewers to learn different words for the same choices
- help reviewers finish decisions while the needed context is already visible

## Workflow Philosophy

Lists are persistent. Choosing **Keep**, **Rename**, **Redact**, **Ignore**, or **Not Quite** must mark the item in place with status text and color; it must not make the row disappear while the reviewer is still working in that list.

The deliberate exception is **Done Editing** in Group Check. That button asks for inline Y/N confirmation and then processes the current Group Check work. Until that explicit completion step, rows stay visible so choices remain verifiable and easy to correct.

This rule is part of the QA design: reviewer choices should remain visible, auditable, and easy to correct until the reviewer explicitly finishes a stage. Never, never, never have things disappear just because they were clicked.

### The Sock Principle

When a reviewer touches a piece of work, prefer helping them finish it rather than moving it somewhere else.

Moving work is not progress. Completion is progress.

Do not create additional queues simply because the workflow is divided into stages. New workflow stages require justification. If the reviewer already has sufficient information to make the correct decision now, the UI should let them complete that decision immediately.

Avoid designs that merely relocate unfinished work. Before introducing a new workflow step, ask: **Am I putting the sock away, or just moving it to another chair?**

If the answer is that the work is only being moved, redesign the workflow. Completion beats movement.

## Reviewer Vocabulary

Reviewer-facing language should stay consistent throughout the application.

The main reviewer stages are:

- **Ambiguity Check**: checks items that could reasonably belong to more than one proposed group.
- **Group Check**: checks proposed groups of related candidates.
- **Category Check**: prioritizes and checks remaining individual candidates.

The core actions are:

- **Keep**: leave the text as-is.
- **Rename**: replace the text with a reviewer-provided value.
- **Redact**: replace the text using the applicable redaction rule.
- **Ignore**: mark the item as not sensitive data.
- **Not Quite**: available in Group Check only, for groups that are close but need lightweight item-level cleanup.

The same concepts should use the same names, keyboard shortcuts, and visual feedback wherever possible. This is intentional. Reviewers build speed through muscle memory, and the app should not make them translate between different vocabularies on different screens. Consistency is a product feature, not merely a documentation preference.

## Category Check

After detection, DocScrub runs deterministic candidate-quality analysis. In the reviewer interface, this appears as **Category Check** after the group-check stages so the visible workflow starts with the grouping decisions that have the highest chance of reducing duplicate work.

The purpose is to remove obvious false positives before the reviewer ever sees them. This stage is intentionally explainable: a candidate is filtered only because deterministic evidence supports that decision, not because an AI or statistical model guessed that it was wrong.

Category Check separates **classification** from **filtering**. A candidate may be classified as a known first name, known surname, common English word, honorific/title, professional credential, organization suffix, document structure term, legal/administrative term, institution acronym, likely acronym, product/system name, department/organization, ambiguous lexical token, unknown capitalized token, OCR artifact, or another evidence category. Filtering happens only after the evidence is collected.

Each recognizer should answer one question: "What does this candidate appear to be?" It should not decide by itself whether the candidate should disappear from reviewer attention. Filtering is a later decision based on the accumulated positive, neutral, and negative evidence.

Unknown buckets are engineering work queues, not failures. Future Category Check work should use diagnostics to find the largest remaining unknown categories, identify recurring deterministic patterns, and replace broad unknown buckets with smaller, explainable evidence categories. A shrinking Unknown bucket is often a better signal of progress than the raw filtering percentage.

Current deterministic rules include:

- pronouns and determiners, such as `She`, `This`, and `Those`
- common verbs, such as `Will`, `Can`, and `Begin`
- greetings and courtesy words, such as `Thank`, `Please`, and `Morning`
- configurable institutional terms, such as `Registrar`, `Records`, `Canvas`, and `Enrollment`
- seasons and academic terms, such as `Fall`, `Semester`, and `Fully Online`
- common abbreviations, such as `FYI`
- simple shape rules for fragments, grammatical phrases, OCR artifacts, unknown tokens, and implausible capitalization

Single-token status alone is not enough to filter a candidate. Single-token names, partial names, misspellings, likely acronyms, and unknown capitalized tokens remain reviewable unless stronger negative evidence exists.

Lexical evidence is loaded from `config/lexical_evidence/` and the older compatibility path `config/candidate-quality/`. Each `.txt` lexicon is normalized locally at startup: lowercase, trimmed, Unicode-normalized, straight apostrophes, with blank lines and `#` comments ignored.

Current lexicons include:

- `common_non_name_words.txt`: negative evidence, reported as Common English word.
- `ambiguous_name_words.txt`: neutral evidence, reported as Ambiguous lexical token.
- `expanded_common_language_words.txt`: neutral evidence, reported as Expanded common language token.
- `address_suffixes.txt`: neutral evidence, reported as Address suffix.
- `calendar_abbreviations.txt`: neutral evidence, reported as Calendar abbreviation.
- `common_abbreviations.txt`: neutral evidence, reported as Common abbreviation.
- `contractions.txt`: neutral evidence, reported as Contraction.
- `honorific_titles.txt`: neutral evidence, reported as Honorific / title.
- `honorifics_and_titles.txt`: neutral evidence, reported as Honorific / title.
- `interjections_and_casual.txt`: neutral evidence, reported as Interjection / casual expression.
- `professional_credentials.txt`: neutral evidence, reported as Professional credential.
- `organization_suffixes.txt`: neutral evidence, reported as Organization suffix.
- `product_and_system_names_seed.txt`: neutral evidence, reported as Product / system name.
- `document_structure_terms.txt`: neutral evidence, reported as Document structure term.
- `legal_administrative_terms.txt`: neutral evidence, reported as Legal / administrative term.

Lexicons are plug-in recognizers, not filtering logic. Adding a future lexicon should mean dropping a file into `config/lexical_evidence/`; the engine will load it as a neutral evidence provider and expose it as a diagnostics bucket. Registering a friendly alias is useful for polished names or for merging related files into the same bucket, but it should not require rewriting the decision engine.

The expanded language lexicons are intentionally first-pass resources. `expanded_common_language_words.txt` is neutral evidence so generated vocabulary can shrink Unknown buckets without broadening auto-ignore behavior. `ambiguous_name_words.txt` protects name-like language such as "Will" or "May" from being treated as ordinary language only. When a token has ambiguous-name evidence, ordinary lexical negatives such as common word, common verb, calendar term, or academic term do not by themselves auto-ignore it. Stronger non-name evidence may still filter it.

Campus- or organization-specific terms can also be tuned in `candidate_quality_terms.json`. Those entries are merged into the built-in deterministic dictionaries at startup, including optional known first-name and surname lists.

Positive evidence overrides filtering. A candidate remains reviewable when it has strong deterministic support, such as appearing near a title, appearing in an email address, appearing in signature/header context, or matching a strong name shape.

Category Check is a deterministic prioritization layer, not a final PII decision. Each candidate receives an internal Candidate Score from explainable evidence and the UI presents that score as **Likelihood**. Candidates are placed into **To Review** or **Unlikely** queues; Unlikely items are still inspectable and are not hidden, ignored, or removed.

Resolution is separate from review priority. Candidates resolved during Group Check remain preserved internally, including their child candidates and occurrence memberships, but move into **Resolved** once every occurrence is covered by a resolved canonical group. Category Check summaries are mutually exclusive: Total = To Review + Unlikely + Resolved. If only some occurrences are covered by a group, Category Check shows only the uncovered occurrence count and flags the partial relationship.

Category Check explanations are generated by a deterministic explanation engine. Detectors and scoring code emit structured evidence, such as known-name structure, nearby-title evidence, frequency evidence, dictionary-word evidence, or product/system evidence. The explanation engine does not invent new reasons; it only translates the recorded evidence into reviewer-facing language.

The same evidence drives both views:

- **Standard View** shows Likelihood, recommendation, occurrence count, representative snippets, and a concise natural-language explanation with no detector names, rule IDs, weights, or implementation details.
- **Expert View** keeps the full tuning detail: detector source, positive evidence, negative evidence, neutral evidence, diagnostic categories, raw scoring explanation, and rule weights.

This keeps reviewer explanations, audit reports, future exports, and API responses synchronized with the scoring model. If a reason is shown to the reviewer, it must be traceable to structured deterministic evidence.

High-frequency items use broad **Occurrence Groups** inside the occurrence browser. These groups classify raw occurrences by observable structure, such as **Standalone occurrences** when the paragraph is essentially just the entity, and **Occurrences in message text** when the entity appears inside a larger sentence or message. They do not infer conversations, topics, or semantic relationships. They do not summarize, deduplicate, merge, hide, or discard matches. Every original occurrence remains individually inspectable inside its group. The principle is: classify by observable structure, and organize, never hide.

## Ambiguity Check

Ambiguity Check comes first when DocScrub finds a candidate with more than one reasonable home.

Example: if the document contains **Andrew Goodloe**, **Andrew Jackson**, and a standalone **Andrew**, DocScrub should not silently choose which Andrew that is. Ambiguity Check asks the reviewer to decide while the possible groups are still visible.

This stage exists to prevent uncertain items from being forced into a likely group or drifting into Category Check without the context that made them ambiguous.

## Group Check

Group Check evaluates proposed groups before the reviewer reaches individual items.

Typical reviewer questions are:

- Do these items belong together?
- Is the proposed grouping correct?
- Should this group be kept, renamed, redacted, ignored, or refined with Not Quite?

Group confidence is live. The percentage reflects the currently selected members of the proposed group, so removing a weak member or confirming a group can immediately change the score. The original proposal confidence is retained internally for diagnostics.

Use **Not Quite** when a proposed group is mostly correct but needs a little item-level cleanup. Not Quite opens an inline checklist where each member can be kept, renamed, or redacted without creating another pass. Completed members stay visible with status and color so the reviewer can verify and adjust them. Use **Back** or Escape to leave Not Quite without clearing the checklist; applied choices and in-progress Rename/Redact drafts remain available if you reopen it in the same browser session.

Not Quite exists to honor the Sock Principle: if the reviewer already has enough context to finish the remaining items, the app should let them finish those items here.

Group Check shortcuts are **K** Keep, **N** Rename, **R** Redact, **I** Ignore, and **Q** Not Quite after a group row is active.

## Category Check Results

Category Check Results are the final pass for remaining individual candidates. These items are already at the smallest practical unit of work, so the available actions are intentionally limited to **Keep**, **Rename**, **Redact**, and **Ignore**.

There is no Not Quite action in Category Check Results because there is no smaller group to refine. If an item needs a decision, the goal is to complete that decision in place.

## Fast Local UI

For keyboard-heavy checking, use the local browser app:

```bash
cd /Users/agoodloe/Documents/Codex/2026-07-24/before-making-any-implementation-decisions-read/work/pii_docx_redactor
python3 run_local_web_app.py
```

It opens at `http://127.0.0.1:8765/`. Category Check uses a compact grid with confidence tabs. Use `[K] Keep`, `[N] Rename`, `[R] Redact`, and `[I] Ignore`; the active record advances after each completed choice. Use Rename when you want to substitute one name or value for another. Redact shows the default redaction label, while Keep and Ignore leave replacement text blank and disabled. Press Enter to expand or collapse the active record's context and replacement preview.

The app checks the full candidate list but renders it in pages of 25-250 rows so large documents stay responsive. Generated files are written directly to your Mac's `Downloads` folder when available. Your uploaded DOCX and choices are saved under `.local_web_state/` so a browser refresh can restore the current session. Use the Streamlit app below only as a fallback.

For development, use **Restart local app** in the small developer-controls area after code changes. That button only relaunches the app when it was started with `python3 run_local_web_app.py`; if you run `python3 local_web_app.py` directly, the button can stop the app but nothing will restart it.

## Streamlit Fallback

Use Python 3.11+ if you have it installed.

```bash
cd /Users/agoodloe/Documents/Codex/2026-07-24/before-making-any-implementation-decisions-read/work/pii_docx_redactor
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
streamlit run app.py
```

If your Mac only has `python3`, try:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
streamlit run app.py
```

Optional, for better local person-name detection on Python 3.11+:

```bash
pip install spacy
python -m spacy download en_core_web_sm
```

If the spaCy model is not installed, the app falls back to conservative local name-pattern detection, including `First Last` and `Last, First`.

## Outputs

For an uploaded `example.docx`, the app generates downloads named:

- `example_redacted.docx`
- `example_redaction_log.csv`
- `example_decisions.json`
- `example_qa_metrics.json`

The CSV log includes the original value, replacement, detector type, decision, occurrence count, context, timestamp, and the SHA-256 hash of the input file.

The JSON decisions file can be uploaded on a future run against the same or revised document.

The QA metrics JSON captures review start/finish time, elapsed review time, decisions per minute, confidence bucket counts, decision rates, detector counts, and candidate-level detector attribution for future quality analysis.

## What It Scans

- Body paragraphs
- Tables, including nested tables where python-docx exposes them
- Headers
- Footers
- Hyperlink display text when represented as normal Word text nodes
- Core document metadata, listed separately for review

Footnotes, endnotes, comments, text boxes, SmartArt, embedded objects, tracked changes, and unusual Word XML structures may not be redacted perfectly in this MVP. Always perform a final human review of the output document before sharing it.

## Redaction Behavior

- Candidate detection is intentionally imperfect and requires human decisions.
- Names default to consistent pseudonyms like `[PERSON 001]`.
- You can override replacement labels, such as `[STUDENT 01]`.
- Global redactions use longest-match-first replacement to reduce partial-name corruption.
- Dates and page numbers are filtered from numeric identifier detection where practical.

## Tests

```bash
pytest
```

## Synthetic Sample

Generate a fake DOCX for testing:

```bash
python sample_docx_generator.py
```

The sample contains invented people and identifiers only.
