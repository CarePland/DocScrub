/**
 * anchor-rules.ts -- Representative Context ("anchor evidence"), the four
 * identity-bearing rules of the Contextual Person Evidence pass
 * (AG, 2026-08-05).
 *
 * WHAT AN ANCHOR IS. Not a stronger contextual rule -- a different kind of
 * claim. The seven rules in contextual-rules.ts observe how a candidate is
 * USED ("Jordan approved the request"). The four here observe the document
 * IDENTIFYING the candidate ("Jordan Lee, Director of Finance"). A human
 * reviewer deciding whether a word is a person looks for exactly this: the
 * one occurrence that settles it. This file finds that occurrence.
 *
 * ═══ WHY THIS FILE NEEDS THE DOCUMENT, NOT JUST THE CONTEXT STRING ═══
 *
 * The occurrence context window is +/-70 characters INSIDE ONE ContentBlock
 * (DetectionEngine.contextSnippet). A signature block is not one block --
 *
 *     Jordan Lee                <- block N
 *     Director of Finance       <- block N+1
 *     ABC Corporation           <- block N+2
 *
 * -- and neither is a name with the email on the following line. Both of
 * Andrew's headline anchor examples are therefore INVISIBLE to the context
 * string, and any implementation built on it alone would silently never fire
 * them. This is the same class of finding as the CandidateQualityEngine
 * heading-context gap (see that file's INTERFACE DEFECT FIX note): the
 * behavior cannot be implemented from the inputs originally available, so
 * the input set is corrected rather than the behavior quietly dropped.
 *
 * CandidateQualityEngine.evaluate() already receives the DocumentModel, so
 * nothing new has to be threaded through the pipeline to get it here.
 *
 * ═══ SCOPE DISCIPLINE ═══
 *
 * This is NOT document-wide entity resolution, and the boundary is enforced
 * structurally rather than by convention: every function below reads only
 * (a) the occurrence's own block, and (b) the two blocks immediately
 * following it. It cannot reach an occurrence of a different candidate, and
 * it never compares two candidates' text. The rule that a standalone
 * "Jordan" must not inherit anything from a "Jordan Lee" elsewhere in the
 * document is therefore not a check this code performs -- it is a thing this
 * code has no way to do. That is the intended design (Andrew, 2026-08-05:
 * union only for identical normalized candidates), and it matches the
 * exact-key-only rule EntityResolutionEngine already holds to.
 */

import type { ContentBlock, DocumentModel, Occurrence } from "../../domain/DocumentModel.js";
import { EMAIL_RE } from "../detectors/patterns.js";
import { ORGANIZATION_TAIL_TOKENS, PERSON_ROLE_NOUNS } from "./contextual-lexicons.data.js";

export type AnchorRuleId =
  | "anchor_full_name_with_role"
  | "anchor_signature_block"
  | "anchor_name_with_email"
  | "anchor_full_name_with_organization";

const ROLE_LINE_RE = new RegExp(
  `^(?:senior|junior|associate|assistant|deputy|interim|acting|vice|executive|chief)?\\s*` +
    `(?:${PERSON_ROLE_NOUNS.map((r) => r.replace(/\s/g, "\\s+")).join("|")})\\b`,
  "i"
);

const ORGANIZATION_TAIL_SET = new Set(ORGANIZATION_TAIL_TOKENS);

/** Two or more capitalized word-parts -- the shape every anchor rule
 *  requires of the candidate itself. A lone first name is never an anchor:
 *  "Jordan, Director of Finance" identifies a role, but it does not identify
 *  a person well enough to be the occurrence a reviewer is shown as proof.
 *  This is the one place anchor rules look at the candidate's own text, and
 *  they look at its SHAPE, never its spelling. */
const FULL_NAME_SHAPE_RE = /^[A-Z][A-Za-z'’.-]+(?:\s+(?:[A-Z]\.|[A-Z][A-Za-z'’.-]+)){1,3}$/;

/** Separators that can attach an appositive to a name: comma, en/em dash,
 *  or a parenthesis. "Alex Rivera — Senior Counsel" is Andrew's own example
 *  and uses an em dash, so a comma-only implementation would miss it. */
const APPOSITIVE_LEAD_RE = /^\s*[,–—-]\s*|^\s*\(\s*/;

function isRoleLine(text: string): boolean {
  return ROLE_LINE_RE.test(text.trim());
}

function isOrganizationLine(text: string): boolean {
  const words = text.trim().toLowerCase().replace(/[.,]/g, "").split(/\s+/);
  if (words.length === 0 || words.length > 6) return false;
  return words.some((w) => ORGANIZATION_TAIL_SET.has(w));
}

/** A block short enough to be a signature line rather than prose. Signature
 *  lines are names, roles and organizations -- never sentences -- so length
 *  is a good proxy and does not need a grammar. */
function isShortLine(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length <= 60 && !/[.!?]\s+\S/.test(trimmed);
}

/**
 * FULL NAME WITH ROLE -- "Jordan Lee, Director of Finance",
 * "Alex Rivera — Senior Counsel".
 *
 * Same-block appositive. The strongest anchor: the document is telling the
 * reader who this person is, in the same breath as naming them.
 */
function fullNameWithRole(occurrenceText: string, after: string): boolean {
  if (!FULL_NAME_SHAPE_RE.test(occurrenceText.trim())) return false;
  const lead = APPOSITIVE_LEAD_RE.exec(after);
  if (!lead) return false;
  return isRoleLine(after.slice(lead[0].length));
}

/**
 * FULL NAME WITH ORGANIZATION -- "Jordan Lee, Human Resources".
 *
 * Weaker than the role form because an organization can follow a name for
 * reasons other than employment (a routing line, an address), and because
 * organization vocabulary overlaps with the department_organization lexicon
 * that counts AGAINST personhood when it is the candidate itself. Those two
 * facts are consistent, not contradictory: "Human Resources" as a candidate
 * is not a person; "Human Resources" following a full name identifies one.
 */
function fullNameWithOrganization(occurrenceText: string, after: string): boolean {
  if (!FULL_NAME_SHAPE_RE.test(occurrenceText.trim())) return false;
  const lead = APPOSITIVE_LEAD_RE.exec(after);
  if (!lead) return false;
  const tail = after.slice(lead[0].length);
  return !isRoleLine(tail) && isOrganizationLine(tail);
}

/**
 * SIGNATURE BLOCK -- a short name-only line followed by a role and/or
 * organization line.
 *
 * Reads the two blocks after the occurrence's own. Requires the occurrence's
 * block to be essentially just the name (nothing substantive around it),
 * because a name mentioned mid-sentence followed by a paragraph that happens
 * to start with "Director" is not a signature block.
 */
function signatureBlock(
  occurrence: Occurrence,
  block: ContentBlock,
  following: readonly ContentBlock[]
): boolean {
  const blockText = block.text.trim();
  const occurrenceText = occurrence.text.trim();
  if (!isShortLine(blockText)) return false;
  // The block must be the name and little else -- allow a trailing comma or
  // a credential ("Jordan Lee, PhD") but not a sentence around it.
  const residue = blockText.replace(occurrenceText, "").replace(/[,;:()\s.]/g, "");
  if (residue.length > 6) return false;

  let identifyingLines = 0;
  for (const next of following) {
    const text = next.text.trim();
    if (!isShortLine(text)) break;
    if (isRoleLine(text) || isOrganizationLine(text)) identifyingLines++;
    else break;
  }
  return identifyingLines >= 1;
}

/**
 * NAME PAIRED WITH EMAIL -- "Jordan Lee jlee@example.org",
 * "Casey Morgan (cmorgan@example.edu)".
 *
 * Same block, or the immediately following short block (the common
 * directory-listing and signature layout). The candidate's surname token
 * must appear INSIDE the local part.
 *
 * DELIBERATELY MORE PERMISSIVE THAN scoring.ts's _appears_in_email, and this
 * is the point of having it: that ported rule splits the local part on
 * `[a-z]+` and asks for a whole-token match, so "cmorgan" yields the single
 * token "cmorgan", which equals neither "casey" nor "morgan" -- Andrew's own
 * second example does not fire it. Substring containment of a token at
 * least four characters long fires it correctly while staying far away from
 * the coincidental matches a shorter threshold would produce.
 */
function nameWithEmail(occurrenceText: string, sameBlockAfter: string, nextBlock: ContentBlock | undefined): boolean {
  const nameTokens = occurrenceText
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length >= 4);
  if (nameTokens.length === 0) return false;

  const haystacks = [sameBlockAfter.slice(0, 80)];
  if (nextBlock && isShortLine(nextBlock.text)) haystacks.push(nextBlock.text);

  for (const haystack of haystacks) {
    for (const match of haystack.matchAll(EMAIL_RE)) {
      const local = (match[0].split("@")[0] ?? "").toLowerCase();
      if (nameTokens.some((t) => local.includes(t))) return true;
    }
  }
  return false;
}

// ---- evaluation -----------------------------------------------------------

export interface AnchorContext {
  document: DocumentModel;
  /** Index of every block by id, plus its position, so the two following
   *  blocks can be reached without scanning. Built once per pass. */
  blockIndexById: ReadonlyMap<string, number>;
}

export function buildAnchorContext(document: DocumentModel): AnchorContext {
  const blockIndexById = new Map<string, number>();
  document.blocks.forEach((block, index) => blockIndexById.set(block.id, index));
  return { document, blockIndexById };
}

/**
 * Evaluates the four anchor rules against one occurrence. Returns rule ids
 * in fixed strongest-first order.
 *
 * Anchors are mutually reinforcing rather than mutually exclusive -- a
 * signature block routinely also carries a role line and an email, and all
 * three firing is a genuinely stronger identification than any one alone.
 * The diminishing-returns combination in contextual-person-evidence.ts is
 * what keeps that from being counted three times over.
 */
export function evaluateOccurrenceAnchors(occurrence: Occurrence, context: AnchorContext): AnchorRuleId[] {
  const index = context.blockIndexById.get(occurrence.blockId);
  if (index === undefined) return [];
  const block = context.document.blocks[index];
  if (!block) return [];

  const after = block.text.slice(occurrence.endOffset);
  const following = [context.document.blocks[index + 1], context.document.blocks[index + 2]].filter(
    (b): b is ContentBlock => b !== undefined
  );

  const fired: AnchorRuleId[] = [];
  if (fullNameWithRole(occurrence.text, after)) fired.push("anchor_full_name_with_role");
  if (signatureBlock(occurrence, block, following)) fired.push("anchor_signature_block");
  if (nameWithEmail(occurrence.text, after, following[0])) fired.push("anchor_name_with_email");
  if (fullNameWithOrganization(occurrence.text, after)) fired.push("anchor_full_name_with_organization");
  return fired;
}
