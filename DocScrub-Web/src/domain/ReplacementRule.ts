/**
 * ReplacementRule — domain-layer types for Milestone 3, Phase 3's
 * ReplacementRuleEngine (src/engines/ReplacementRuleEngine.ts). Split out
 * here, not defined inline in the engine file, matching this codebase's
 * established layering: domain/ owns the SHAPES a pure engine consumes and
 * produces (e.g. DecisionReuseProposal lives in domain/DecisionReuse.ts,
 * not in engines/DecisionReuseEngine.ts), so Commands.ts (also domain-layer)
 * can reference `ReplacementRuleConfig` for its `setReplacementRuleConfig`
 * ApplicationCommand without domain/ reaching into engines/ -- the reverse
 * of every other import direction in this codebase (engines import FROM
 * domain, never the other way around).
 */

export type ReplacementStrategy = "generic" | "sequential" | "custom";

export interface TypeReplacementRule {
  strategy: ReplacementStrategy;
  /** Only meaningful when strategy is "custom" -- see
   *  ReplacementRuleEngine.ts's top doc comment for the full "custom"
   *  strategy semantics (fixed label vs. "{n}"-templated numbering). */
  customTemplate?: string;
}

/** Keyed by Candidate.detectedType. A missing entry falls back to
 *  "generic" -- see ReplacementRuleEngine.computeReplacements(). */
export type ReplacementRuleConfig = Record<string, TypeReplacementRule>;

const KNOWN_DETECTED_TYPES = ["person", "email", "phone", "cin", "long_numeric_id"] as const;

/** Byte-identical to this app's pre-Milestone-3 fallbackReplacementText()
 *  behavior for every known type -- see ReplacementRuleEngine.ts. */
export function defaultReplacementRuleConfig(): ReplacementRuleConfig {
  const config: ReplacementRuleConfig = {};
  for (const type of KNOWN_DETECTED_TYPES) config[type] = { strategy: "generic" };
  return config;
}
