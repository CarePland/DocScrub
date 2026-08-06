/**
 * DocumentRebuilder — architecture v0.2 §6.13. Creates the revised DOCX from
 * the original DocumentModel, the DetectionResult that identified what's
 * redactable, and a completed ReviewSession's decisions. Its output is the
 * generated DOCX and nothing else -- post-generation verification/rescan
 * lives in OutputVerifier (ADR-016) to remove the hidden coupling the ARB
 * review identified between rebuilding and audit export.
 *
 * PRODUCTION IMPLEMENTATION (Phase 3): OoxmlDocumentRebuilder below is a
 * real, working implementation, ported from the validated spike algorithm
 * (spike/ooxml/rebuild.ts -> src/io/ooxml/rebuild.ts) plus three
 * extensions driven by Andrew's Phase 3 architectural decisions:
 *
 *   - Hyperlink hyperlink relationship targets are spliced via
 *     ooxml/hyperlinks.ts, separately from visible display text (which
 *     goes through the ordinary body/header/footer/comment path).
 *   - Comment blocks are redacted through the exact same
 *     parseDocumentXml/redactDocument path as body/header/footer -- no
 *     comments-specific redaction code exists because none is needed
 *     (word/comments.xml shares the same <w:p>/<w:r>/<w:t> structure).
 *   - Tracked-deletion blocks are deliberately never spliced. There is no
 *     code path here capable of editing a <w:delText> run -- see
 *     ooxml/tracked-changes.ts for why that's not yet proven safe. If a
 *     reviewer marks a candidate whose only occurrence lives in a
 *     tracked-deletion block for redaction, DocumentRebuilder silently
 *     leaves that specific occurrence's underlying XML untouched. This is
 *     intentional and is NOT a silent-redaction-failure in the sense
 *     Andrew's decision prohibits: OutputVerifier independently rescans
 *     the rebuilt output afterward and will find that content and raise a
 *     blocker-severity FidelityFinding. The "surface explicitly, don't
 *     imply full redaction" guarantee is enforced by OutputVerifier as a
 *     separate, independent check, deliberately not by DocumentRebuilder
 *     second-guessing its own output -- matching ADR-016's whole reason
 *     for splitting rebuild from verification in the first place.
 *
 * Corrects a real interface defect found while implementing this for real:
 * the previous signature (rebuild(document, session)) had no way to get
 * from a candidateId to WHERE that candidate occurs in the document --
 * DetectionResult (candidates + occurrences) was never passed in, so
 * nothing here could actually locate text to redact. Fixed by adding
 * `detection: DetectionResult` as a parameter. This is an objective defect
 * fix (the old signature could not be implemented, not a design
 * preference) -- see docs/ooxml-spike/phase-2-findings.md.
 *
 * SCOPE BOUNDARY, UPDATED (Milestone 3, Phase 3): the ReplacementRuleEngine
 * this comment used to describe as future work now exists
 * (src/engines/ReplacementRuleEngine.ts) and closes the gap described
 * below -- sequential person numbering ("[PERSON 001]", "[PERSON 002]",
 * ...) and category-specific/reviewer-defined placeholder templates are
 * now available whenever a caller supplies a `replacements` map (see
 * `rebuild()`'s signature). This module still does NOT compute that map
 * itself (that domain logic correctly stays in the dedicated engine, kept
 * isolated from the OOXML rebuild layer per Andrew's own instruction) --
 * `rebuild()` only CONSUMES an already-resolved map, additively:
 *
 *   - decision.replacement (a reviewer's own explicit text) always wins,
 *     unchanged from before.
 *   - Otherwise, `replacements.get(candidateId)` is used if the caller
 *     supplied one (ReplacementRuleEngine's output -- see Workspace.ts's
 *     generateOutput(), the only real caller that wires this today).
 *   - Otherwise, `fallbackReplacementText()` below is used exactly as
 *     before -- this is now truly a LAST-RESORT default (e.g. a caller
 *     that never wires an engine, such as some of
 *     verify/production-parity.ts's fixture-parity checks, which
 *     deliberately keep exercising the original unconfigured behavior).
 *
 * This is purely additive: `rebuild()`'s existing three-argument callers
 * are unaffected (the new parameter is optional), and behavior is
 * byte-identical to before whenever no `replacements` map is passed.
 */

import { redactionSpanOf, type DocumentModel, type Occurrence } from "../domain/DocumentModel.js";
import type { DetectionResult } from "../engines/DetectionEngine.js";
import type { ReviewSession } from "../domain/ReviewSession.js";
import { parseDocumentXml } from "./ooxml/document-text.js";
import { redactDocument, type CandidateReplacement } from "./ooxml/rebuild.js";
import { spliceRelationshipTarget } from "./ooxml/hyperlinks.js";
import { decodeSourceRef } from "./ooxml/source-ref.js";
import { writeZip, type ZipEntry } from "./ooxml/zip.js";

export interface DocumentRebuilder {
  /** `replacements`, if supplied, is ReplacementRuleEngine's already-
   *  computed candidateId -> resolved text map (Milestone 3, Phase 3) --
   *  see this file's top doc comment "SCOPE BOUNDARY, UPDATED" for the
   *  precedence order it participates in. Optional and additive; omitting
   *  it reproduces this method's original, unconfigured behavior exactly. */
  rebuild(document: DocumentModel, detection: DetectionResult, session: ReviewSession, replacements?: ReadonlyMap<string, string>): Promise<Blob>;
}

const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

function fallbackReplacementText(detectedType: string): string {
  switch (detectedType) {
    case "email":
      return "[REDACTED EMAIL]";
    case "phone":
      return "[REDACTED PHONE]";
    case "cin":
    case "long_numeric_id":
      return "[REDACTED ID]";
    case "person":
      // Python's default_replacement() uses sequential numbering
      // ("[PERSON 001]", "[PERSON 002]", ...), which requires document-
      // wide ordinal context this function does not have. See this file's
      // doc comment "SCOPE BOUNDARY".
      return "[PERSON REDACTED]";
    default:
      return `[REDACTED ${detectedType.toUpperCase()}]`;
  }
}

export class OoxmlDocumentRebuilder implements DocumentRebuilder {
  async rebuild(document: DocumentModel, detection: DetectionResult, session: ReviewSession, replacements?: ReadonlyMap<string, string>): Promise<Blob> {
    const candidateById = new Map(detection.candidates.map((c) => [c.id, c]));
    const blockById = new Map(document.blocks.map((b) => [b.id, b]));

    // Only occurrences whose candidate has an explicit Redact or Rename
    // decision are eligible. Keep/Ignore/undecided candidates are left
    // untouched -- ReviewSession.resolvedStatusOf() (ReviewSession.ts)
    // governs whether that's an acceptable state to export from; that's a
    // review-workflow concern, not DocumentRebuilder's.
    const toRedact = new Map<string, { occurrence: Occurrence; replacement: string }>();
    let usedFallbackForAnyPerson = false;

    for (const occurrence of detection.occurrences) {
      const decision = session.candidateDecisions[occurrence.candidateId];
      if (!decision || (decision.decision !== "Redact" && decision.decision !== "Rename")) continue;
      const candidate = candidateById.get(occurrence.candidateId);
      // Precedence: reviewer-explicit text, then ReplacementRuleEngine's
      // already-resolved map (if the caller supplied one), then the
      // original hardcoded fallback -- see this file's top doc comment
      // "SCOPE BOUNDARY, UPDATED".
      const replacement =
        decision.replacement ?? replacements?.get(occurrence.candidateId) ?? fallbackReplacementText(candidate?.detectedType ?? "unknown");
      const usedHardcodedFallback = !decision.replacement && !replacements?.has(occurrence.candidateId);
      if (usedHardcodedFallback && candidate?.detectedType === "person") usedFallbackForAnyPerson = true;
      toRedact.set(occurrence.id, { occurrence, replacement });
    }

    // Group eligible occurrences by which OOXML part they live in (for
    // body/header/footer/comment blocks) or which hyperlink relationship
    // they target (for hyperlink blocks). Tracked-deletion blocks are
    // deliberately excluded here -- see this file's doc comment.
    const replacementsByPart = new Map<string, CandidateReplacement[]>();
    const hyperlinkEdits = new Map<string, Array<{ relationshipId: string; replacement: string }>>();

    for (const { occurrence, replacement } of toRedact.values()) {
      const block = blockById.get(occurrence.blockId);
      if (!block) continue; // occurrence references a block that no longer exists -- nothing to redact

      if (block.kind === "body" || block.kind === "header" || block.kind === "footer" || block.kind === "comment") {
        const partName = block.sourceMapping.partId;
        const list = replacementsByPart.get(partName) ?? [];
        // NORMALIZATION (2026-08-03): search for the REDACTION span, not
        // the raw detector span. For an ordinary occurrence these are the
        // same string. For one the Normalization pass folded into another
        // candidate ("Thanks, Andrew" -> "Andrew") the detector span
        // includes the reviewer's own prose, and editing it would delete
        // that prose from the output -- so the search text is the narrowed
        // sub-range and the result reads "Thanks, [REDACTED PERSON]".
        // Routed through redactionSpanOf() rather than reading
        // occurrence.effectiveSpan directly -- see that helper.
        list.push({ search: redactionSpanOf(occurrence).text, replace: replacement });
        replacementsByPart.set(partName, list);
      } else if (block.kind === "hyperlink") {
        const ref = decodeSourceRef(block.sourceMapping.sourceRef);
        if (ref.kind !== "hyperlink") continue;
        const list = hyperlinkEdits.get(ref.relsPartName) ?? [];
        list.push({ relationshipId: ref.relationshipId, replacement });
        hyperlinkEdits.set(ref.relsPartName, list);
      }
      // "tracked-deletion": intentionally not handled -- see doc comment.
      // "table" / "metadata" / "unsupported": not yet produced by
      // DocumentParser as redaction targets; nothing to do if encountered.
    }

    const decoder = new TextDecoder("utf-8");
    const encoder = new TextEncoder();
    const newParts = new Map(document.sourceArchive.parts);

    for (const [partName, replacements] of replacementsByPart) {
      const original = newParts.get(partName);
      if (!original) continue;
      const xml = decoder.decode(original);
      const paragraphs = parseDocumentXml(xml);
      const { xml: redactedXml } = redactDocument(xml, paragraphs, replacements);
      newParts.set(partName, encoder.encode(redactedXml));
    }

    for (const [relsPartName, edits] of hyperlinkEdits) {
      let relsXml = decoder.decode(newParts.get(relsPartName) ?? new Uint8Array());
      for (const { relationshipId, replacement } of edits) {
        relsXml = spliceRelationshipTarget(relsXml, relationshipId, replacement);
      }
      newParts.set(relsPartName, encoder.encode(relsXml));
    }

    if (usedFallbackForAnyPerson) {
      // No dedicated warnings channel on this interface (rebuild()
      // returns only a Blob, deliberately -- see this file's doc comment
      // on why DocumentRebuilder does not self-report fidelity findings).
      // Surfaced here via console as a development-time signal until
      // AuditExporter/ReviewEngine have a place to record "fallback
      // placeholder text was used" as a durable, reviewer-visible fact.
      console.warn(
        "OoxmlDocumentRebuilder: one or more person candidates redacted with the hardcoded generic fallback placeholder because neither CandidateDecision.replacement nor a ReplacementRuleEngine `replacements` map supplied resolved text. Sequential [PERSON 001]/[PERSON 002] numbering and other configured strategies are available via ReplacementRuleEngine -- see DocumentRebuilder.ts's SCOPE BOUNDARY and Workspace.ts's generateOutput()."
      );
    }

    const entries: ZipEntry[] = [...newParts.entries()].map(([name, data]) => ({ name, data }));
    const zipped = await writeZip(entries);
    return new Blob([zipped as BlobPart], { type: DOCX_MIME_TYPE });
  }
}
