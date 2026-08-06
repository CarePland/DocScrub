# Architecture Decision Records — Index

Status: canonical
Last updated: 2026-08-02

How to read this document: the register of DocScrub's architecture
decisions. ADR-001 through ADR-018 are retroactive records, extracted
2026-07-30 from the v0.2 target architecture's own ADR register (§16 of
`../DocScrub-Web_Target_Architecture_v0.2.docx`) and the Architecture
Review Board report (`DocScrub-Web_Architecture_Review_Report.docx`,
repository root). The decisions were made 2026-07-27; the files record
them with their original register priority (Required / Recommended /
Open), their reasoning, and an honest current implementation status.
New significant decisions get the next number at decision time
(`../../standards/documentation-standards.md`, lifecycle rule 8, and the
ADR template there).

| ADR | Title | Register priority | Current status |
|---|---|---|---|
| [ADR-001](ADR-001-browser-first-delivery.md) | Browser-first delivery | Recommended | BUILT |
| [ADR-002](ADR-002-browser-local-processing.md) | Browser-local document processing | Recommended | BUILT |
| [ADR-003](ADR-003-no-document-content-cloud-boundary.md) | No document-content cloud boundary | Required | BUILT (trivially — no cloud yet) |
| [ADR-004](ADR-004-documentparser-documentmodel-separation.md) | DocumentParser and DocumentModel separation | Recommended | BUILT |
| [ADR-005](ADR-005-documentrebuilder-reconstruction-boundary.md) | DocumentRebuilder as reconstruction boundary | Recommended | BUILT |
| [ADR-006](ADR-006-auditexporter-separation.md) | AuditExporter separation | Recommended | BUILT |
| [ADR-007](ADR-007-namespaced-command-dispatcher.md) | Central CommandDispatcher with namespaced command families | Recommended (revised) | BUILT |
| [ADR-008](ADR-008-durable-reviewengine-not-quite.md) | Durable ReviewEngine, including Not Quite sub-state | Required (revised) | BUILT |
| [ADR-009](ADR-009-golden-fixtures-three-families.md) | Golden fixtures as migration specification, in three families | Required (revised) | BUILT / partially (performance family empty) |
| [ADR-010](ADR-010-indexeddb-opfs-persistence.md) | IndexedDB/OPFS local persistence | Recommended | BUILT (quota contract edge open) |
| [ADR-011](ADR-011-worker-thread-processing.md) | Worker-thread processing | **Open** | Still open — engines synchronous |
| [ADR-012](ADR-012-schema-session-versioning.md) | Schema and session versioning | Required | BUILT |
| [ADR-013](ADR-013-entity-resolution-occurrence-classifier-split.md) | EntityResolutionEngine / OccurrenceClassifier separation | Required — new | BUILT |
| [ADR-014](ADR-014-focusnavigator-named-component.md) | FocusNavigator as a named, ported component | Recommended — new | BUILT |
| [ADR-015](ADR-015-scoring-profile-snapshot.md) | ScoringProfileSnapshot for audit reproducibility | Required — new | BUILT |
| [ADR-016](ADR-016-outputverifier-boundary.md) | OutputVerifier as the DocumentRebuilder/AuditExporter boundary | Recommended — new | BUILT |
| [ADR-017](ADR-017-closed-telemetry-schema.md) | Closed, typed telemetry schema | Required — new | DESIGNED, dormant (no telemetry exists) |
| [ADR-018](ADR-018-settingsservice-trust-classification.md) | SettingsService trust classification | Required — new | DESIGNED (types landed) |
| [ADR-019](ADR-019-workspace-analysis-independence.md) | Workspace Analysis as an independent subsystem | n/a — decided at implementation time | BUILT |

Numbering note: ADR numbers cited across findings documents and code
comments (ADR-008, ADR-009, ADR-010, ADR-011, ADR-015, and others) refer
to exactly this register — the numbering was defined by the v0.2 document
and is preserved unchanged here. Never renumber.
