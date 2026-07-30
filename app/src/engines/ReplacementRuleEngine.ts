/**
 * ReplacementRuleEngine — Milestone 3 ("Reviewer Productivity"), Phase 3.
 * Closes the SCOPE BOUNDARY DocumentRebuilder.ts's own doc comment has
 * flagged since Phase 3 of the original migration: this pipeline never
 * replicated Python's default_replacement()/ReplacementRuleEngine
 * (redactor/decisions.py, redactor/replacement_rules.py) -- sequential
 * person numbering ("[PERSON 001]", "[PERSON 002]", ...) and
 * category-specific placeholder text, falling back to a single generic,
 * type-aware placeholder for every candidate instead. This is that
 * component, built now per Andrew's own explicit Milestone 2 resequencing
 * ("I would pull ReplacementRuleEngine into Milestone 3 instead of making
 * it the centerpiece of the next phase... it introduces genuinely new
 * domain logic").
 *
 * WHAT THIS ENGINE OWNS: computing the REPLACEMENT TEXT for every candidate
 * with a Redact or Rename decision and no reviewer-supplied
 * `CandidateDecision.replacement` -- nothing else. It is a pure, stateless,
 * synchronous function of (candidates, decisions, config), matching this
 * codebase's established engine shape (DetectionEngine, CandidateQuality
 * Engine, EntityResolutionEngine, DecisionReuseEngine -- see each one's own
 * "pure engine, no I/O, no session ownership" doc comment).
 *
 * "KEEP IT ISOLATED FROM THE REVIEW WORKFLOW ITSELF" (Andrew's Phase 3
 * instruction), concretely: this engine is never wired into
 * engines/review/session.ts's reducer, never dispatched as a ReviewCommand,
 * and never mutates ReviewSession. It reads `session.candidateDecisions` as
 * a plain, already-computed snapshot (the same read-only access
 * AuditExporter.ts already has) purely to know WHICH candidates need
 * resolved text and what a reviewer has ALREADY explicitly typed -- it does
 * not participate in review state transitions, Not Quite, group decisions,
 * or navigation. Its only consumer is DocumentRebuilder (via an additive
 * parameter -- see that file's own updated doc comment) and, for live
 * preview, the UI's Redaction Rules panel.
 *
 * DETERMINISM: `computeReplacements()` iterates `candidates` in the exact
 * array order DetectionEngine/pipeline output already provides (itself
 * deterministic -- see DetectionEngine.ts), and sequential/`{n}`-templated
 * ordinals are assigned per detectedType in that same order with a single
 * pass and no randomness, no Date.now(), no Math.random() anywhere in this
 * file. Running this twice against the same (candidates, decisions, config)
 * triple always produces byte-identical output -- this is what "maintain
 * deterministic output... ensure replacement behavior remains fully
 * verifiable" (Andrew's Phase 3 instruction) requires, and is exercised
 * directly by verify/milestone-3-reviewer-productivity-verification.ts.
 *
 * STRATEGY CONSOLIDATION, an explicit judgment call, not a silent scope
 * reduction: Andrew's instruction names four placeholder strategies --
 * generic, sequential, category-specific, and reviewer-defined. This engine
 * implements THREE: "generic" (unchanged from today's fallbackReplacement
 * Text() behavior), "sequential" (Python's real [TYPE 001]/[TYPE 002]
 * numbering, closing the long-flagged gap), and "custom" (a reviewer-
 * authored template string, optionally containing an `{n}` token). "Custom"
 * subsumes BOTH "category-specific" (a fixed template with no `{n}`, e.g.
 * "[WITNESS]" applied to every candidate of that type) AND
 * "reviewer-defined" (the same mechanism, reviewer-authored instead of
 * pre-named) -- the two Python-vocabulary strategies differ only in WHO
 * wrote the template text, not in how it is applied, so building two
 * separate strategy branches for them would duplicate the same template-
 * substitution logic twice for no behavioral difference. A reviewer who
 * wants Python's exact "[WITNESS 001]" category-specific-AND-sequential
 * combination gets it for free by using a "custom" template containing
 * `{n}` (e.g. "[WITNESS {n}]") -- something a strategy split could not
 * express any more directly than this does.
 */

import type { Candidate } from "../domain/DocumentModel.js";
import type { CandidateDecision } from "../domain/ReviewSession.js";
import type { TypeReplacementRule, ReplacementRuleConfig } from "../domain/ReplacementRule.js";

// Re-exported so existing callers that only knew this engine file (before
// the domain-layer split -- see domain/ReplacementRule.ts's own doc
// comment on why the types moved) do not need a second import line.
export type { ReplacementStrategy, TypeReplacementRule, ReplacementRuleConfig } from "../domain/ReplacementRule.js";
export { defaultReplacementRuleConfig } from "../domain/ReplacementRule.js";

/** Matches DocumentRebuilder.ts's own fallbackReplacementText() exactly
 *  (including its "cin"/"long_numeric_id" -> "[REDACTED ID]" collapse) --
 *  duplicated here rather than imported because DocumentRebuilder's version
 *  becomes dead code once this engine is wired in (see that file's updated
 *  doc comment); keeping ONE canonical copy, in the engine that now owns
 *  this decision, is more correct than an import that reaches back into a
 *  module whose own placeholder logic this engine is replacing. */
function genericPlaceholder(detectedType: string): string {
  switch (detectedType) {
    case "email":
      return "[REDACTED EMAIL]";
    case "phone":
      return "[REDACTED PHONE]";
    case "cin":
    case "long_numeric_id":
      return "[REDACTED ID]";
    case "person":
      return "[PERSON REDACTED]";
    default:
      return `[REDACTED ${detectedType.toUpperCase()}]`;
  }
}

function padOrdinal(n: number): string {
  return String(n).padStart(3, "0");
}

function sequentialPlaceholder(detectedType: string, ordinal: number): string {
  return `[${detectedType.toUpperCase()} ${padOrdinal(ordinal)}]`;
}

function applyCustomTemplate(template: string, ordinal: number | null): string {
  if (!template.includes("{n}")) return template;
  return template.replace(/\{n\}/g, padOrdinal(ordinal ?? 1));
}

export interface ReplacementRuleEngine {
  /**
   * Computes resolved replacement text for every candidate that has a
   * Redact or Rename decision and NO reviewer-supplied
   * `CandidateDecision.replacement` -- candidates with an explicit
   * reviewer replacement, or with Keep/Ignore/no decision at all, are
   * simply absent from the returned map (never overridden; see this
   * file's top doc comment on "reviewer-explicit always wins"). Callers
   * that need to know the FINAL text for a candidate should therefore
   * check `decision.replacement` first and only fall back to this map's
   * entry when it is unset -- the exact `??` chain DocumentRebuilder.ts
   * already used for the old hardcoded fallback, extended by one step.
   */
  computeReplacements(
    candidates: readonly Candidate[],
    decisions: Readonly<Record<string, CandidateDecision>>,
    config: ReplacementRuleConfig
  ): Map<string, string>;
}

export class DeterministicReplacementRuleEngine implements ReplacementRuleEngine {
  computeReplacements(
    candidates: readonly Candidate[],
    decisions: Readonly<Record<string, CandidateDecision>>,
    config: ReplacementRuleConfig
  ): Map<string, string> {
    const result = new Map<string, string>();
    const ordinalByType = new Map<string, number>();

    for (const candidate of candidates) {
      const decision = decisions[candidate.id];
      if (!decision || (decision.decision !== "Redact" && decision.decision !== "Rename")) continue;
      if (decision.replacement !== undefined) continue; // reviewer-explicit always wins -- nothing for this engine to resolve

      const rule: TypeReplacementRule = config[candidate.detectedType] ?? { strategy: "generic" };
      if (rule.strategy === "sequential") {
        const next = (ordinalByType.get(candidate.detectedType) ?? 0) + 1;
        ordinalByType.set(candidate.detectedType, next);
        result.set(candidate.id, sequentialPlaceholder(candidate.detectedType, next));
      } else if (rule.strategy === "custom") {
        const template = rule.customTemplate?.trim() ? rule.customTemplate : genericPlaceholder(candidate.detectedType);
        if (template.includes("{n}")) {
          const next = (ordinalByType.get(candidate.detectedType) ?? 0) + 1;
          ordinalByType.set(candidate.detectedType, next);
          result.set(candidate.id, applyCustomTemplate(template, next));
        } else {
          result.set(candidate.id, template);
        }
      } else {
        result.set(candidate.id, genericPlaceholder(candidate.detectedType));
      }
    }

    return result;
  }
}
