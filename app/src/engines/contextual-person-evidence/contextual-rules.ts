/**
 * contextual-rules.ts -- the seven sentence-level rules of the Contextual
 * Person Evidence pass (AG, 2026-08-05).
 *
 * THE QUESTION THIS FILE ASKS. Not "does this string look like a name?" --
 * the lexical layer (engines/quality/scoring.ts) already asks that, well.
 * This file asks "does the sentence treat this candidate as a person?" A
 * candidate that is the subject of an approval, the target of an email, the
 * owner of a calendar, or the addressee of a greeting is participating in
 * the document the way people participate in documents, whatever it is
 * spelled like.
 *
 * NO LEXICAL MATCHING, ANYWHERE. Not one rule below reads the candidate's
 * own text against a name list. The only place candidate text is touched at
 * all is the possessive rule (which reads a trailing apostrophe-s, a
 * grammatical fact, not a spelling one) and the coordination/list rules
 * (which read CAPITALIZATION SHAPE of the neighbours, not their identity).
 * If a rule here ever needs to know whether a word is a known first name,
 * it has been written at the wrong layer.
 *
 * INPUT IS THE OCCURRENCE CONTEXT STRING, whose format is set by
 * DetectionEngine.contextSnippet(): a +/-70 character window inside ONE
 * ContentBlock, with the matched span wrapped in square brackets and an
 * ellipsis marking either truncated edge --
 *
 *     "...please contact [Jordan] about the transcript..."
 *
 * The brackets are what make this parseable without re-deriving offsets, and
 * they are guaranteed present: contextSnippet() always writes them.
 *
 * WHAT THIS WINDOW CANNOT SEE, and why that is handled elsewhere: it never
 * crosses a block boundary, so it cannot see a signature block's role line
 * or an email address sitting on the next paragraph. Those are the anchor
 * family's job (anchor-rules.ts), which reads block adjacency from the
 * DocumentModel instead. Splitting the two families by INPUT rather than by
 * strength is deliberate -- it keeps each file's reasoning uniform.
 */

import {
  ATTRIBUTION_LEAD_INS,
  ATTRIBUTION_VERBS,
  DIRECTED_AT_PERSON_VERBS,
  DIRECT_ADDRESS_FOLLOW_ONS,
  DIRECT_ADDRESS_OPENERS,
  HUMAN_ACTION_VERBS,
  PERSON_ROLE_NOUNS,
  matchesVerb,
} from "./contextual-lexicons.data.js";

/** The seven sentence-level rule identifiers, in the order they are
 *  evaluated. Snake_case to match the rule vocabulary
 *  scoreCandidateQuality() already emits. */
export type ContextualRuleId =
  | "contextual_direct_address"
  | "contextual_attribution"
  | "contextual_coordination"
  | "contextual_person_list"
  | "contextual_possessive"
  | "contextual_human_subject"
  | "contextual_human_object";

const HUMAN_ACTION_SET = new Set(HUMAN_ACTION_VERBS);
const DIRECTED_AT_PERSON_SET = new Set(DIRECTED_AT_PERSON_VERBS);
const ATTRIBUTION_SET = new Set(ATTRIBUTION_VERBS);
const PERSON_ROLE_SET = new Set(PERSON_ROLE_NOUNS);

/** A candidate-shaped neighbour: one or more capitalized word-parts. Used
 *  ONLY to decide whether a coordination or list neighbour is name-shaped;
 *  never to decide anything about the candidate itself. */
const NAME_SHAPED_RE = /^[A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){0,2}$/;

/** Determiner-led role phrases: "the director", "our chair", "a supervisor". */
const ROLE_PHRASE_RE = new RegExp(
  `(?:^|\\s)(?:the|our|their|his|her|a|an)?\\s*(${PERSON_ROLE_NOUNS.map((r) => r.replace(/\s/g, "\\s+")).join("|")})\\b`,
  "i"
);

export interface ContextParts {
  /** Text preceding the matched span, within the window. */
  before: string;
  /** The matched span itself, brackets removed. */
  match: string;
  /** Text following the matched span, within the window. */
  after: string;
}

/**
 * Splits a context snippet on the brackets contextSnippet() wrote. Returns
 * null when the snippet is not in the expected shape -- callers treat that
 * as "no contextual evidence available" rather than guessing, because a
 * mis-parsed window would attribute a neighbouring sentence's grammar to
 * this candidate.
 */
export function splitContext(context: string): ContextParts | null {
  const open = context.indexOf("[");
  if (open < 0) return null;
  const close = context.indexOf("]", open + 1);
  if (close < 0) return null;
  return {
    before: stripEllipsis(context.slice(0, open)),
    match: context.slice(open + 1, close),
    after: stripEllipsis(context.slice(close + 1)),
  };
}

function stripEllipsis(value: string): string {
  return value.replace(/^\.\.\./, "").replace(/\.\.\.$/, "");
}

/** Words of `after`, in order, punctuation kept so the rules can read it. */
function leadingTokens(after: string, limit = 4): string[] {
  return after.trim().split(/\s+/).filter((t) => t.length > 0).slice(0, limit);
}

/** Words of `before`, nearest-first. */
function trailingTokens(before: string, limit = 4): string[] {
  const all = before.trim().split(/\s+/).filter((t) => t.length > 0);
  return all.slice(Math.max(0, all.length - limit)).reverse();
}

function bare(token: string | undefined): string {
  return (token ?? "").toLowerCase().replace(/^[^a-z']+|[^a-z']+$/g, "");
}

// ---- the seven rules ------------------------------------------------------

/**
 * DIRECT ADDRESS -- "Hi Jordan,", "Thanks, Alex.", "Casey, could you review?"
 *
 * Two shapes, either sufficient: an addressing opener immediately before, or
 * a comma immediately after followed by a second-person continuation. The
 * second shape is what catches a name at the START of a sentence addressed
 * to its bearer, which the opener test alone would miss.
 *
 * KNOWN INTERACTION with the lexical layer, disclosed rather than corrected
 * here: pre-normalization, a candidate whose own text is "Thanks Andrew"
 * carries greeting_or_courtesy (-32) while this rule fires on the same
 * words. The two roughly cancel, which is the right outcome for a candidate
 * that genuinely contains a greeting. Post-normalization the candidate is
 * "Andrew", the greeting rule no longer fires on it, and this rule still
 * does -- which is exactly the improvement the Normalization pass exists to
 * produce, now visible in the score as well as in the queue.
 */
function directAddress(parts: ContextParts): boolean {
  const beforeTail = parts.before.toLowerCase().replace(/\s+$/, "");
  for (const opener of DIRECT_ADDRESS_OPENERS) {
    // Allow an optional comma between the opener and the name ("Thanks, Alex").
    const re = new RegExp(`(?:^|[\\s.;!?])${opener.replace(/\s/g, "\\s+")}\\s*,?\\s*$`, "i");
    if (re.test(beforeTail)) return true;
  }
  const afterHead = parts.after.replace(/^\s*[,–—-]\s*/, "").toLowerCase();
  if (afterHead !== parts.after.toLowerCase().trimStart()) {
    for (const followOn of DIRECT_ADDRESS_FOLLOW_ONS) {
      if (afterHead.startsWith(followOn)) return true;
    }
  }
  return false;
}

/**
 * ATTRIBUTION -- "Jordan said...", "according to Alex", "Casey wrote..."
 *
 * Speaking, writing and authorship. Wins over HUMAN SUBJECT when both would
 * fire on the same verb (see contextual-lexicons.data.ts's note on the
 * deliberate overlap) -- evaluateOccurrence() enforces that, not this
 * function.
 */
function attribution(parts: ContextParts): boolean {
  const next = bare(leadingTokens(parts.after, 2)[0]);
  if (next && ATTRIBUTION_SET.has(next)) return true;
  const beforeTail = parts.before.toLowerCase().replace(/\s+$/, "");
  for (const leadIn of ATTRIBUTION_LEAD_INS) {
    if (new RegExp(`(?:^|[\\s.;,])${leadIn.replace(/\s/g, "\\s+")}\\s*$`, "i").test(beforeTail)) return true;
  }
  return false;
}

/**
 * HUMAN COORDINATION -- "Jordan and the director", "Alex and Susan",
 * "the chair and Casey".
 *
 * The candidate is joined by a coordinator to something that clearly denotes
 * a person: a role noun, or a name-shaped neighbour. Deliberately does NOT
 * accept a coordination with a group noun ("Jordan and the committee") --
 * see PERSON_ROLE_NOUNS' exclusion note for why that would prove nothing.
 */
function coordination(parts: ContextParts): boolean {
  const afterMatch = /^\s*(?:,\s*)?(?:and|&)\s+(.{1,40})/i.exec(parts.after);
  if (afterMatch?.[1] && denotesPerson(afterMatch[1])) return true;
  const beforeMatch = /(.{1,40}?)\s+(?:and|&)\s*,?\s*$/i.exec(parts.before);
  if (beforeMatch?.[1] && denotesPerson(beforeMatch[1])) return true;
  return false;
}

function denotesPerson(fragment: string): boolean {
  if (ROLE_PHRASE_RE.test(fragment)) return true;
  const firstWords = fragment.trim().split(/[,.;:]/)[0] ?? "";
  return NAME_SHAPED_RE.test(firstWords.trim());
}

/**
 * PERSON LIST -- "Jordan, Alex, and Casey", "Susan, Jordan, and Michael".
 *
 * Requires a genuine series: the candidate has a comma-separated name-shaped
 * neighbour on one side and a comma-or-"and" separated name-shaped
 * neighbour on the other, OR sits at either end of one. Two items are NOT a
 * list -- that is coordination, and it is already scored above; requiring
 * three keeps the two rules from firing together on the same two names.
 */
function personList(parts: ContextParts): boolean {
  const leftNames = trailingSeriesNames(parts.before);
  const rightNames = leadingSeriesNames(parts.after);
  return leftNames + rightNames >= 2;
}

function trailingSeriesNames(before: string): number {
  let remaining = before.trimEnd();
  let count = 0;
  while (count < 3) {
    const m = /(?:^|[\s(])([A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+)?)\s*,\s*(?:and\s+)?$/.exec(remaining);
    if (!m?.[1]) break;
    count++;
    remaining = remaining.slice(0, remaining.length - m[0].length).trimEnd();
  }
  return count;
}

function leadingSeriesNames(after: string): number {
  let remaining = after.trimStart();
  let count = 0;
  while (count < 3) {
    const m = /^\s*,\s*(?:and\s+)?([A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+)?)/.exec(remaining);
    if (!m?.[1]) break;
    count++;
    remaining = remaining.slice(m[0].length);
  }
  return count;
}

/**
 * POSSESSIVE -- "Jordan's office", "Alex's report", "Casey's calendar".
 *
 * Reads either an apostrophe-s trailing the matched span itself (when the
 * detector included it) or one opening the following text (when it did
 * not). Both spellings of the apostrophe are accepted, matching the
 * normalization the rest of this codebase already applies.
 *
 * DOES NOT REQUIRE the possessed noun to be person-associated. "Jordan's
 * office" and "Jordan's deadline" are equally good evidence: possession by
 * a proper noun is the signal, and narrowing it to a curated list of
 * possessable things would add a lexicon without adding discrimination.
 */
function possessive(parts: ContextParts): boolean {
  if (/['’]s$/.test(parts.match.trim())) return true;
  return /^['’]s\b/.test(parts.after);
}

/**
 * HUMAN SUBJECT -- "Jordan approved the request.", "Alex replied yesterday."
 *
 * The candidate is immediately followed by a verb people perform. One
 * optional adverb or auxiliary is tolerated between them ("Jordan later
 * approved", "Jordan has approved"), because that is common in
 * correspondence and skipping it would lose real evidence; more than one
 * intervening word is not, because the further the verb drifts the more
 * likely it belongs to a different clause.
 */
function humanSubject(parts: ContextParts): boolean {
  const tokens = leadingTokens(parts.after, 3);
  if (tokens.length === 0) return false;
  // A comma directly after the candidate breaks the subject reading -- that
  // is apposition or a list, both handled by their own rules.
  if (/^\s*,/.test(parts.after)) return false;
  const first = bare(tokens[0]);
  if (matchesVerb(first, HUMAN_ACTION_SET)) return true;
  if (AUXILIARIES.has(first) || ADVERB_LIKE_RE.test(first)) {
    const second = bare(tokens[1]);
    if (second && matchesVerb(second, HUMAN_ACTION_SET)) return true;
  }
  return false;
}

const AUXILIARIES = new Set([
  "has", "have", "had", "will", "would", "can", "could", "may", "might",
  "must", "should", "is", "was", "were", "also", "then", "already", "never",
  "just", "recently", "subsequently", "later", "since", "again",
]);
const ADVERB_LIKE_RE = /ly$/;

/**
 * HUMAN OBJECT -- "Contact Jordan.", "Email Alex.", "We asked Casey."
 *
 * The candidate is immediately preceded by a verb directed at a person.
 * The weakest rule in the family, and weighted accordingly: an imperative
 * like "Review Jordan" is genuinely ambiguous in a document that also
 * contains a file, a form or a campus named Jordan.
 */
function humanObject(parts: ContextParts): boolean {
  const previous = bare(trailingTokens(parts.before, 1)[0]);
  if (!previous) return false;
  return matchesVerb(previous, DIRECTED_AT_PERSON_SET);
}

// ---- evaluation -----------------------------------------------------------

/**
 * Evaluates all seven rules against one occurrence's context snippet.
 *
 * Returns rule ids in a FIXED order (strongest family member first), not in
 * evaluation order, so that downstream combination and display are stable
 * regardless of which rules happened to fire.
 *
 * THE ONE SUPPRESSION: attribution suppresses human_subject. "Jordan said"
 * satisfies both by construction -- "said" is in both lexicons on purpose --
 * and counting it twice would inflate a single linguistic observation into
 * two pieces of evidence. Suppressing at the source is clearer than
 * discounting afterwards, and it is the only place two rules in this family
 * can fire on the identical span.
 */
export function evaluateOccurrenceContext(context: string): ContextualRuleId[] {
  const parts = splitContext(context);
  if (!parts) return [];

  const fired: ContextualRuleId[] = [];
  const hasAttribution = attribution(parts);

  if (directAddress(parts)) fired.push("contextual_direct_address");
  if (hasAttribution) fired.push("contextual_attribution");
  if (coordination(parts)) fired.push("contextual_coordination");
  if (personList(parts)) fired.push("contextual_person_list");
  if (possessive(parts)) fired.push("contextual_possessive");
  if (!hasAttribution && humanSubject(parts)) fired.push("contextual_human_subject");
  if (humanObject(parts)) fired.push("contextual_human_object");

  return fired;
}
