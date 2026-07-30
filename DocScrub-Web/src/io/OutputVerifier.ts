/**
 * OutputVerifier — architecture v0.2 §6.14 (NEW, ADR-016). Runs
 * post-generation verification/rescan on a rebuilt DOCX and produces a
 * VerificationReport. Sits between DocumentRebuilder and AuditExporter so
 * AuditExporter never depends on DocumentRebuilder's internals directly (see
 * §10):
 *
 *   DocumentRebuilder -> generated DOCX -> OutputVerifier -> VerificationReport
 *
 * PRODUCTION IMPLEMENTATION (Phase 3): OoxmlOutputVerifier below is a real,
 * working implementation. It independently re-reads and re-parses the
 * REBUILT bytes from scratch -- it does not trust anything
 * DocumentRebuilder claims about what it did, matching this component's
 * whole reason for existing (ADR-016: decouple verification from
 * rebuilding so a rebuild bug can't also blind its own audit).
 *
 * This is the concrete mechanism behind two of Andrew's Phase 3
 * architectural decisions:
 *
 *   - Hyperlinks: "A document is not considered successfully redacted
 *     until both visible hyperlink text and underlying hyperlink target
 *     have been processed appropriately. Silent leakage is unacceptable."
 *     Enforced here by rescanning every hyperlink relationship's Target
 *     attribute in the rebuilt output, not just body/header/footer/comment
 *     text -- exactly the surface DocumentRebuilder.ts's doc comment notes
 *     as the confirmed prior leak.
 *   - Tracked changes: "Do not silently export documents containing
 *     tracked changes that could reveal redacted information... surface
 *     this explicitly." Enforced here as a blocker-severity FidelityFinding
 *     whenever a tracked-deletion run in the rebuilt output still contains
 *     text that should have been redacted (DocumentRebuilder never
 *     attempts to splice these -- see its doc comment), which sets
 *     VerificationReport.passed = false rather than silently succeeding.
 *     A second, warning-severity finding is always emitted when ANY
 *     tracked deletion exists, independent of whether it happens to match
 *     a known candidate -- deleted text was never scanned by detection in
 *     the first place, so "no match found" only means "no match against
 *     what was already known to be sensitive," not "confirmed clean."
 *
 * EXPLAINABILITY GAP FOUND AND FIXED (Feature 001 browser validation): the
 * ordinary body/header/footer/comments rescan (the MAIN case, not the
 * hyperlink/tracked-changes special cases above) was already correctly
 * setting rescanFoundOriginalValues -- and therefore passed=false -- when
 * a Redact/Rename candidate's original text was still detectable in the
 * rebuilt output, but never pushed a FidelityFinding to explain WHY,
 * unlike the other two cases. This produced a silent, unexplainable
 * "Verification: FAILED, Warnings: 0, Blockers: 0" state -- a direct
 * violation of "every rejection/failure needs a reason," found while
 * real-browser-validating Flatten Group: Flatten renames every member to
 * the group's own canonical name, and the canonical member's own text is,
 * by construction, frequently IDENTICAL to that canonical name -- a
 * legitimate, common case this gap had never been exercised by before
 * (no prior workflow produced a Rename/Redact decision whose replacement
 * happened to equal the candidate's own original text). Fixed by pushing
 * the same blocker-severity finding pattern the hyperlink/tracked-changes
 * cases already use. This does not change what COUNTS as a failure (that
 * question -- whether a Rename to identical text should even be treated
 * as residual PII -- is a genuine behavioral ambiguity, flagged separately
 * rather than decided unilaterally here) -- only whether a failure is ever
 * silent.
 */

import type { DocumentModel, Occurrence } from "../domain/DocumentModel.js";
import type { DetectionResult } from "../engines/DetectionEngine.js";
import type { ReviewSession } from "../domain/ReviewSession.js";
import type { FidelityFinding, VerificationReport } from "../domain/VerificationReport.js";
import { readZip } from "./ooxml/zip.js";
import { parseDocumentXml } from "./ooxml/document-text.js";
import { listTextBearingParts, hasComments, commentsPartName, relsPartFor } from "./ooxml/document-parts.js";
import { parseHyperlinkRelationships } from "./ooxml/hyperlinks.js";
import { findTrackedDeletions } from "./ooxml/tracked-changes.js";

export interface OutputVerifier {
  verify(
    original: DocumentModel,
    detection: DetectionResult,
    session: ReviewSession,
    rebuilt: Blob
  ): Promise<VerificationReport>;
}

export class OoxmlOutputVerifier implements OutputVerifier {
  async verify(
    original: DocumentModel,
    detection: DetectionResult,
    session: ReviewSession,
    rebuilt: Blob
  ): Promise<VerificationReport> {
    const decoder = new TextDecoder("utf-8");
    const buffer = await rebuilt.arrayBuffer();
    const parts = await readZip(buffer);

    // Every occurrence that a review decision says should have been
    // redacted -- same eligibility rule as DocumentRebuilder.ts, computed
    // independently here rather than trusted from it (ADR-016).
    const shouldBeRedacted: Occurrence[] = detection.occurrences.filter((occ) => {
      const decision = session.candidateDecisions[occ.candidateId];
      return decision !== undefined && (decision.decision === "Redact" || decision.decision === "Rename");
    });
    const forbiddenTexts = [...new Set(shouldBeRedacted.map((o) => o.text))].filter((t) => t.length > 0);
    const occurrenceByText = new Map<string, Occurrence>();
    for (const occ of shouldBeRedacted) if (!occurrenceByText.has(occ.text)) occurrenceByText.set(occ.text, occ);

    const rescanMatches: Array<{ candidateId: string; blockId: string }> = [];
    const fidelityFindings: FidelityFinding[] = [];
    const matchedTexts = new Set<string>();

    // --- body / header / footer / comments: ordinary visible text -------
    const textParts = listTextBearingParts(parts);
    const partsToScanForText = [...textParts, ...(hasComments(parts) ? [commentsPartName()] : [])];
    for (const partName of partsToScanForText) {
      const bytes = parts.get(partName);
      if (!bytes) continue;
      const xml = decoder.decode(bytes);
      const paragraphs = parseDocumentXml(xml);
      for (const paragraph of paragraphs) {
        for (const forbidden of forbiddenTexts) {
          if (paragraph.flatText.includes(forbidden)) {
            matchedTexts.add(forbidden);
            const occ = occurrenceByText.get(forbidden);
            if (occ) {
              rescanMatches.push({ candidateId: occ.candidateId, blockId: occ.blockId });
              // See this file's top "EXPLAINABILITY GAP" doc-comment
              // section: this case previously set rescanFoundOriginalValues
              // (and therefore passed=false) without ever explaining why,
              // unlike the hyperlink-target/tracked-changes cases below.
              fidelityFindings.push({
                category: "body-text-residual-pii",
                severity: "blocker",
                description: `Candidate ${occ.candidateId}'s decision was Redact/Rename, but its original text still appears in the rebuilt document (part ${partName}): "${forbidden}".`,
                blockId: occ.blockId,
              });
            }
          }
        }
      }
    }

    // --- hyperlink relationship targets ------------------------------------
    for (const partName of textParts) {
      const relsPart = relsPartFor(partName);
      const relsBytes = parts.get(relsPart);
      if (!relsBytes) continue;
      const relsXml = decoder.decode(relsBytes);
      const hyperlinks = parseHyperlinkRelationships(relsXml);
      for (const link of hyperlinks) {
        for (const forbidden of forbiddenTexts) {
          if (link.target.includes(forbidden)) {
            matchedTexts.add(forbidden);
            const occ = occurrenceByText.get(forbidden);
            fidelityFindings.push({
              category: "hyperlink-target-residual-pii",
              severity: "blocker",
              description: `Hyperlink target (relationship ${link.id} in ${relsPart}) still contains text that should have been redacted: "${forbidden}".`,
              ...(occ ? { blockId: occ.blockId } : {}),
            });
          }
        }
      }
    }

    // --- tracked-change deletions -------------------------------------------
    let anyTrackedDeletions = false;
    for (const partName of textParts) {
      const bytes = parts.get(partName);
      if (!bytes) continue;
      const xml = decoder.decode(bytes);
      const deletions = findTrackedDeletions(xml);
      for (const deletion of deletions) {
        anyTrackedDeletions = true;
        for (const forbidden of forbiddenTexts) {
          if (deletion.text.includes(forbidden)) {
            matchedTexts.add(forbidden);
            const occ = occurrenceByText.get(forbidden);
            fidelityFindings.push({
              category: "tracked-changes-residual-pii",
              severity: "blocker",
              description: `A tracked-change deletion (w:del id="${deletion.delId}", author "${deletion.author}") in ${partName} still contains text that should have been redacted: "${forbidden}". Tracked deletions cannot yet be safely rebuilt -- see DocumentRebuilder.ts.`,
              ...(occ ? { blockId: occ.blockId } : {}),
            });
          }
        }
      }
    }
    if (anyTrackedDeletions) {
      fidelityFindings.push({
        category: "tracked-changes-present",
        severity: "warning",
        description:
          "This document contains tracked-change deletions. Deleted text is not scanned by detection, so the absence of a confirmed match above means 'no match against already-known candidates', not 'confirmed free of sensitive content'. Per policy, this document should not be treated as fully redacted without a reviewer accepting or rejecting tracked changes first.",
      });
    }

    const rescanFoundOriginalValues = matchedTexts.size > 0;
    const hasBlockerFinding = fidelityFindings.some((f) => f.severity === "blocker");

    return {
      schemaVersion: 1,
      documentId: original.documentId,
      verifiedAt: new Date().toISOString(),
      rescanFoundOriginalValues,
      rescanMatches,
      fidelityFindings,
      passed: !rescanFoundOriginalValues && !hasBlockerFinding,
    };
  }
}
