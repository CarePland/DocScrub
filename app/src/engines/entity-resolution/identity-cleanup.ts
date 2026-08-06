/**
 * identity-cleanup.ts -- Identity-candidate cleanup pass (AG, 2026-08-02,
 * "the reviewer should spend time deciding between plausible identities --
 * not filtering out obvious parsing artifacts").
 *
 * A PURE post-grouping pass over GroupingResult that removes
 * phrase-fragment identity options ("Andrew Are", "Sarah Yes", "Margaret
 * Afternoon") and prefers coherent person identities ("Tanesha Can
 * Collier" -> "Tanesha Collier") BEFORE anything reaches the reviewer.
 *
 * ARCHITECTURE (the semantic-augmentation precedent, deliberately): the
 * bare engines stay byte-identical to the Python oracle -- every parity
 * suite constructs them directly and is untouched. This pass is wired at
 * the WORKSPACE level (Workspace.load, immediately after
 * resolutionEngine.propose()), the same additive-layer slot
 * augmentGroupingWithSemanticKnowledge occupies inside the engine.
 * Running AFTER augmentation also means knowledge-backed options (curated
 * evidence lines) are visible here -- and exempt.
 *
 * EVIDENCE-DRIVEN, NOT LENGTH-DRIVEN (the prompt's own rule). Signals,
 * all pre-existing:
 * - the quality engine's NARROW curated dictionaries (verb / interjection
 *   / greeting / sentence-fragment / pronoun / common-word / calendar)
 *   classify a token as ordinary language. Deliberately NOT
 *   expanded_common_language_token: that expanded list contains real
 *   surnames (miller, ford, collier) and would destroy legitimate
 *   identities -- verified empirically against Andrew's own transcript.
 * - the known-name dictionaries + the curated related-names dataset
 *   classify a token as name evidence; name evidence always beats an
 *   ordinary-language hit ("chris", "will"-as-ambiguous).
 * - ambiguous_lexical_token membership exempts a token from the ordinary
 *   class (the quality data's own "could be a name" judgment -- "Will").
 * - multi-member anchors (a real multi-variant entity group) are exempt
 *   from suppression: independent variants are corroboration, and their
 *   labels belong to the group, not to this pass.
 * - a small ADDITIVE lexicon (SENTENCE_CONTEXT_TOKENS) covers
 *   time-of-day/courtesy words the narrow parity dictionaries lack
 *   ("afternoon" -- the "Margaret Afternoon" class). Additive data owned
 *   by this module, parity data untouched.
 *
 * RULES per person-ambiguity option (solitary, single-member,
 * non-knowledge-backed anchors only):
 * 1. Classify the anchor's name tokens: name | ordinary | unknown.
 * 2. Remove ordinary tokens. If what remains is >= 2 tokens, every one
 *    name/unknown, and the FIRST is not ordinary -- the cleaned identity
 *    is plausible: keep the option with the cleaned canonical name
 *    ("Tanesha Can Collier" -> "Tanesha Collier"). Linking records the
 *    canonical name in the audit event and keeps surface text (the
 *    link-is-identity rule in session.ts), so a cleaned label is safe.
 * 3. Otherwise the option was a sentence continuation wearing a name
 *    shape: suppress it ("Andrew Are" cleans to just "Andrew" -- nothing
 *    left to offer).
 * 4. Duplicate cleaned identities collapse to one option -- preferring an
 *    option that was ALREADY clean over a relabeled one.
 * 5. A proposal left with zero options is dropped: with no plausible
 *    identity to resolve, there is no ambiguity to review (the candidate
 *    itself still flows through Item Check unchanged).
 */

import type { DetectionResult } from "../DetectionEngine.js";
import type { AmbiguityProposal, AmbiguityProposalGroupOption, GroupingResult } from "../EntityResolutionEngine.js";
import type { RelationshipProposal } from "../../domain/StructuralRelationship.js";
import { QUALITY_DICTIONARIES_DATA, KNOWN_GIVEN_NAMES, KNOWN_SURNAMES } from "../quality/quality-dictionaries.data.js";
import { RELATED_NAMES_CSV } from "../knowledge/related-names.data.js";
import { cleanToken } from "./resolution.js";

/** Narrow ordinary-language classes -- curated, high-precision. See the
 *  module doc comment for why expanded_common_language_token and
 *  address_suffix are deliberately absent. */
const ORDINARY_LANGUAGE_CLASSES = [
  "pronoun_or_determiner",
  "common_verb",
  "greeting_or_courtesy",
  "interjection_casual",
  "sentence_fragment_word",
  "common_english_word",
  "calendar_term",
  "season_or_academic_term",
] as const;

/** ADDITIVE lexicon: sentence-context words the narrow parity
 *  dictionaries lack, all uncontroversially ordinary language when
 *  sitting beside a person's name ("Good afternoon, Margaret").
 *  Curated here, never in the parity data files. */
export const SENTENCE_CONTEXT_TOKENS: readonly string[] = [
  "afternoon",
  "evening",
  "tonight",
  "today",
  "tomorrow",
  "yesterday",
  "everyone",
  "everybody",
  "okay",
  "ok",
  "sorry",
  "please",
  "hello",
  "hi",
  "welcome",
];

function buildLexicons(): { ordinary: Set<string>; names: Set<string>; ambiguous: Set<string> } {
  const ordinary = new Set<string>(SENTENCE_CONTEXT_TOKENS);
  for (const cls of ORDINARY_LANGUAGE_CLASSES) {
    for (const word of QUALITY_DICTIONARIES_DATA[cls] ?? []) ordinary.add(word.toLowerCase());
  }
  const names = new Set<string>();
  for (const word of QUALITY_DICTIONARIES_DATA["known_first_name"] ?? []) names.add(word.toLowerCase());
  for (const word of QUALITY_DICTIONARIES_DATA["known_surname"] ?? []) names.add(word.toLowerCase());
  for (const word of KNOWN_GIVEN_NAMES) names.add(word.toLowerCase());
  for (const word of KNOWN_SURNAMES) names.add(word.toLowerCase());
  // The related-names dataset: every full_name/related_name entry is a
  // curated person-name token ("existing reviewer knowledge").
  for (const line of RELATED_NAMES_CSV.split("\n").slice(1)) {
    const [a, b] = line.split(",");
    if (a) names.add(a.trim().toLowerCase());
    if (b) names.add(b.trim().toLowerCase());
  }
  const ambiguous = new Set<string>((QUALITY_DICTIONARIES_DATA["ambiguous_lexical_token"] ?? []).map((w) => w.toLowerCase()));
  return { ordinary, names, ambiguous };
}

/**
 * Memoized accessor for the lexicon set (AG, 2026-08-03).
 *
 * buildLexicons() parses the full 2,708-row related-names CSV plus every
 * quality dictionary. That is cheap ONCE and ruinous per token: this file's
 * own callers already hoist it into a local, but
 * classifyIdentityToken()'s `lexicons = buildLexicons()` DEFAULT PARAMETER
 * silently rebuilds the whole thing on every single call. Harmless while
 * the only caller passed its own hoisted copy; measured at 686ms for one
 * document the moment the Normalization pass started calling the
 * one-argument form per token. Memoized here rather than fixed at each
 * call site so the trap cannot be re-sprung by the next caller.
 *
 * Safe to share: the lexicons are built from module-level constant data
 * and are never mutated after construction.
 */
let cachedLexicons: ReturnType<typeof buildLexicons> | null = null;
export function sharedIdentityLexicons(): ReturnType<typeof buildLexicons> {
  if (!cachedLexicons) cachedLexicons = buildLexicons();
  return cachedLexicons;
}

export type IdentityTokenEvidence = "name" | "ordinary" | "unknown";

/** WORKSPACE METRICS (AG, 2026-08-02): the factual record of what this
 *  pass removed, derived by diffing the engine's proposals against the
 *  cleaned result -- recomputable on every load from the same document
 *  bytes (the pass is deterministic), so it participates in persistence
 *  for free: nothing new is stored. */
export interface IdentityCleanupStats {
  proposalsBefore: number;
  proposalsAfter: number;
  proposalsRemoved: number;
  optionsBefore: number;
  optionsAfter: number;
  optionsRemoved: number;
  insertedWordProposals: number;
}

export function identityCleanupStats(before: GroupingResult, after: GroupingResult, insertedWordProposalCount: number): IdentityCleanupStats {
  const optionCount = (g: GroupingResult): number => g.ambiguityProposals.reduce((n, p) => n + p.candidateGroupOptions.length, 0);
  const optionsBefore = optionCount(before);
  const optionsAfter = optionCount(after);
  return {
    proposalsBefore: before.ambiguityProposals.length,
    proposalsAfter: after.ambiguityProposals.length,
    proposalsRemoved: before.ambiguityProposals.length - after.ambiguityProposals.length,
    optionsBefore,
    optionsAfter,
    optionsRemoved: optionsBefore - optionsAfter,
    insertedWordProposals: insertedWordProposalCount,
  };
}

/** Pure token classification; name evidence and the quality data's own
 *  ambiguous-lexical judgment both beat an ordinary-language hit. */
export function classifyIdentityToken(token: string, lexicons = buildLexicons()): IdentityTokenEvidence {
  const t = cleanToken(token).toLowerCase();
  if (!t) return "unknown";
  if (lexicons.names.has(t)) return "name";
  if (lexicons.ambiguous.has(t)) return "unknown";
  if (lexicons.ordinary.has(t)) return "ordinary";
  return "unknown";
}

interface CleanupVerdict {
  keep: boolean;
  /** Present when the option survives with a CLEANED canonical name. */
  cleanedName?: string;
  /** The normalized identity key used for duplicate collapsing. */
  identityKey: string;
  /** True when the surviving name was already clean (dedupe preference). */
  wasAlreadyClean: boolean;
}

function evaluateOption(canonicalName: string, lexicons: ReturnType<typeof buildLexicons>): CleanupVerdict {
  const tokens = canonicalName.trim().split(/\s+/).filter(Boolean);
  const classes = tokens.map((t) => classifyIdentityToken(t, lexicons));
  const kept = tokens.filter((_, i) => classes[i] !== "ordinary");
  const identityKey = kept.map((t) => cleanToken(t).toLowerCase()).join(" ");
  // Rule 2/3: a plausible person identity is >= 2 non-ordinary tokens
  // whose first token was not itself ordinary language.
  if (kept.length >= 2 && classes[0] !== "ordinary") {
    if (kept.length === tokens.length) return { keep: true, identityKey, wasAlreadyClean: true };
    return { keep: true, cleanedName: kept.join(" "), identityKey, wasAlreadyClean: false };
  }
  return { keep: false, identityKey, wasAlreadyClean: false };
}

const knowledgeBacked = (option: AmbiguityProposalGroupOption): boolean =>
  option.evidence?.some((line) => /^(Related name|Acronym|Alias):/.test(line)) ?? false;

/** The proposal candidate's own known-name evidence (the recommendation
 *  layer's KNOWN_NAME_CATEGORIES, both spellings) -- the gate on
 *  RELABELING: a cleaned identity is only offered when the SHORT NAME
 *  being resolved is itself name evidence ("Tanesha"). For non-name
 *  candidates ("Good", "May", "Term") cleaning never invents identities
 *  -- the first cut produced "Good Andrew" from "Good Afternoon Andrew",
 *  caught empirically against Andrew's transcript before shipping. */
const KNOWN_NAME_CANDIDATE_CATEGORIES = ["known-personal-name-token", "known-first-name", "known-name-structure"];
function hasKnownNameEvidence(categories: readonly string[]): boolean {
  return categories.some((c) => KNOWN_NAME_CANDIDATE_CATEGORIES.includes(c.replace(/_/g, "-")));
}

/**
 * The pass. Pure: returns a new GroupingResult; entityGroupProposals are
 * untouched (group identities belong to Group Check); only person
 * ambiguity OPTIONS are cleaned/suppressed, and emptied proposals drop.
 *
 * `candidateCategories` supplies each candidate's quality categories
 * (assessment.filterRules/reasons) -- the relabeling gate reads the
 * PROPOSAL candidate's known-name evidence through it.
 */
/**
 * "PROBABLE NAME WITH INSERTED WORD" (AG's decision 2 on the .09
 * follow-ups): when a noisy phrase FORMED A REAL entity group ("Tanesha
 * Can Collier", 2 occurrences), the cleanup pass deliberately leaves the
 * group's identity alone -- instead, this companion produces a
 * structural-relationship proposal over the group's members so the
 * reviewer gets a card in the familiar grammar: a preferred action whose
 * label is the resulting cleaned state ("Tanesha Collier" -- see
 * preferredActions.ts), plus the standard Keep All / Change / Redact All
 * and "Unrelated" dismissal. Every action runs the existing bulk
 * command paths; audit is per-candidate and ordinary.
 *
 * GROUNDING: a group qualifies only when (a) its canonical name cleans
 * to a plausible identity (>= 2 non-ordinary tokens, ordinary interior
 * removed), and (b) some KNOWN-NAME ambiguity candidate actually points
 * at it -- the same gate that stops "Civitas College Scheduler"
 * (product-flavored) from masquerading as a person cleanup.
 */
export function insertedWordNameProposals(
  grouping: GroupingResult,
  detection: DetectionResult,
  candidateCategories: (candidateId: string) => readonly string[]
): RelationshipProposal[] {
  const lexicons = buildLexicons();
  const proposals: RelationshipProposal[] = [];
  for (const group of grouping.entityGroupProposals) {
    if (group.detectedType !== "person" || group.candidateIds.length === 0) continue;
    const verdict = evaluateOption(group.canonicalName, lexicons);
    if (!verdict.keep || !verdict.cleanedName) continue; // nothing inserted, or nothing plausible left
    const grounded = grouping.ambiguityProposals.some(
      (p) => p.candidateGroupIds.includes(group.groupId) && hasKnownNameEvidence(candidateCategories(p.candidateId))
    );
    if (!grounded) continue;
    const removed = group.canonicalName
      .trim()
      .split(/\s+/)
      .filter((t) => classifyIdentityToken(t, lexicons) === "ordinary");
    proposals.push({
      proposalId: `inserted-word-name:${group.groupId}`,
      kind: "inserted-word-name",
      candidateIds: [...group.candidateIds],
      observation: `"${group.canonicalName}" looks like the person "${verdict.cleanedName}" with an ordinary word inserted.`,
      evidence: `"${removed.join('", "')}" is ordinary language (curated dictionaries), while the remaining tokens form a plausible person name.`,
      suggestedReplacement: verdict.cleanedName,
    });
  }
  return proposals;
}

export function cleanupIdentityOptions(
  grouping: GroupingResult,
  detection: DetectionResult,
  candidateCategories: (candidateId: string) => readonly string[]
): GroupingResult {
  const lexicons = buildLexicons();
  const cleanedProposals: AmbiguityProposal[] = [];
  for (const proposal of grouping.ambiguityProposals) {
    const candidate = detection.candidates.find((c) => c.id === proposal.candidateId);
    if (!candidate || candidate.detectedType !== "person") {
      cleanedProposals.push(proposal);
      continue;
    }
    // Relabeling gate: only a known-name short candidate may receive a
    // cleaned identity; other candidates get suppression only (their
    // noisy long options either fail outright or stay verbatim).
    // Deliberately the QUALITY CATEGORIES alone, not the names lexicon:
    // "may"/"fall" are given names in the related-names dataset, and the
    // lexicon fallback minted "May Dates"/"Fall Term" identities for
    // what the quality engine had already classified as calendar terms
    // -- caught empirically against Andrew's transcript.
    const mayRelabel = hasKnownNameEvidence(candidateCategories(proposal.candidateId));
    const byIdentity = new Map<string, AmbiguityProposalGroupOption & { __alreadyClean?: boolean }>();
    const passedThrough: AmbiguityProposalGroupOption[] = [];
    for (const option of proposal.candidateGroupOptions) {
      // Exemptions: curated knowledge, and REAL entity groups -- the
      // engine's own corroboration standard; their labels are the
      // group's identity, not this pass's to rewrite. (Deliberately NOT
      // "any multi-member anchor": the same junk phrase repeated twice
      // is the same parse artifact twice, not independent evidence --
      // caught empirically when "Tanesha Can Collier" x2 dodged the
      // first cut's member-count exemption.)
      if (knowledgeBacked(option) || grouping.entityGroupProposals.some((g) => g.groupId === option.groupId)) {
        passedThrough.push(option);
        continue;
      }
      const verdict = evaluateOption(option.canonicalName, lexicons);
      if (!verdict.keep) continue; // Rule 3: sentence continuation -- suppressed
      const surviving = verdict.cleanedName ? (mayRelabel ? { ...option, canonicalName: verdict.cleanedName } : option) : option;
      const identityKey = mayRelabel ? verdict.identityKey : surviving.canonicalName.toLowerCase();
      const existing = byIdentity.get(identityKey);
      // Rule 4: duplicates collapse; already-clean beats relabeled.
      if (!existing || (verdict.wasAlreadyClean && !existing.__alreadyClean)) {
        byIdentity.set(identityKey, { ...surviving, __alreadyClean: verdict.wasAlreadyClean });
      }
    }
    const options = [...passedThrough, ...[...byIdentity.values()].map(({ __alreadyClean, ...option }) => option)];
    if (options.length === 0) continue; // Rule 5: no plausible identity left -- no ambiguity to review
    cleanedProposals.push({
      ...proposal,
      candidateGroupOptions: options,
      candidateGroupIds: options.map((o) => o.groupId),
    });
  }
  return { ...grouping, ambiguityProposals: cleanedProposals };
}
