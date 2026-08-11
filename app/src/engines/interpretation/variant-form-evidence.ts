/**
 * variant-form-evidence.ts -- evidence that an observed form is CLOSE TO an
 * independently attested form. Never that it is wrong (AG, 2026-08-10).
 *
 * ═══════════════════ THE MOTIVATING GAP ═══════════════════
 *
 * `Chriztopher Johnson` is a real person. No reference dataset contains that
 * spelling, so the interpretation layer reports `unsupported` -- correctly,
 * since `unsupported` means "no affirmative evidence", not "not a person".
 * But DocScrub could say something narrower and true:
 *
 *     the observed form is similar to an independently attested form
 *
 * That is what this module produces, and it is the whole of what it produces.
 *
 * ═══════════════════ THE INVARIANT THAT OUTRANKS EVERYTHING ═══════════════════
 *
 *     THE OBSERVED FORM IS NEVER REWRITTEN, NEVER CORRECTED, AND NEVER
 *     CALLED WRONG.
 *
 * `Chriztopher` is not a misspelling of `Christopher`. It may be intentional,
 * culturally specific, uncommon, newly coined, transliterated, or simply
 * absent from a partial dataset. DocScrub does not know and has no way to
 * know. The vocabulary here is therefore `matchedForm` and `similarity` --
 * never `correction`, `suggestion`, `intended`, `typo` or `misspelled`. A
 * verification suite fails if any of those words appears in this module.
 *
 * This is not squeamishness about wording. A "correction" is a claim about
 * the author; a "near-form" is a claim about two strings. Only the second is
 * one this module can support.
 *
 * ═══════════════════ WHAT THE MEASUREMENT DECIDED ═══════════════════
 *
 * `investigation/variant-form-algorithms.ts` measured every method proposed
 * for this work against the shipped 195,310-token Census corpus, using as the
 * negative corpus the 51,666 ordinary English words the quality engine
 * already recognises. The question was: what share of ORDINARY WORDS -- none
 * of which is a person -- would acquire a "name variant"?
 *
 *   double metaphone, len>=6      93.3%   mean 58 matches   REJECTED
 *   soundex,          len>=3      99.3%                     REJECTED
 *   NYSIIS,           len>=6      27.5%   mean 21 matches   REJECTED
 *   DM + seqRatio>=0.80           28.2%                     REJECTED
 *   damerau<=1, any length        35.8%  (100% at len 3-4)  REJECTED
 *   seqRatio>=0.90, len>=6        15.4%                     REJECTED
 *   seqRatio>=0.90, len>=8         4.0%   mean 1.1 matches  ADOPTED
 *
 * PHONETIC MATCHING IS NOT WRONG HERE -- IT IS UNINFORMATIVE, WHICH IS WORSE.
 * Double Metaphone does find CHRIZTOPHER ~ CHRISTOPHER: both encode to KRST.
 * It also finds 460 other Census names with the same code. A signal that says
 * "this resembles one of 461 attested names" is not evidence of anything, and
 * shipping it would repeat the `token-membership` failure at higher cost.
 * That is why no phonetic encoder ships in this module.
 *
 * ═══════════════════ WHY SEQUENCE RATIO, AND WHY NOT EDIT DISTANCE ═══════════════════
 *
 * `sequenceRatio` is Ratcliff/Obershelp -- ALREADY IN THIS REPOSITORY
 * (engines/entity-resolution/sequence-ratio.ts, a faithful port of Python's
 * difflib used for parity with the oracle), and already used by
 * DecisionReuseEngine at a 0.90 threshold with a documented "fail closed"
 * rationale. Reusing it rather than adding a second similarity algorithm is
 * the instruction's own preference and it happens to be the better choice:
 *
 *   IT IS LENGTH-NORMALIZED BY CONSTRUCTION (2M/T). One character of
 *   difference in an 11-character token scores 0.909; the same one character
 *   in a 4-character token scores ~0.75. A raw edit-distance threshold has to
 *   bolt length-awareness on afterwards, and gets it wrong: `damerau <= 1`
 *   fires on 100% of ordinary words at length 3-4. The ratio protects short
 *   tokens automatically, and the measurement confirms it -- 0% false rate at
 *   length 3-4 versus 100% for a flat edit budget.
 *
 * The minimum length of 8 is on top of that, not instead of it, because the
 * 5-7 band is where the ratio alone still admits 40% of ordinary words.
 *
 * ═══════════════════ CANDIDATE GENERATION IS NOT EVIDENCE ═══════════════════
 *
 * Generation (which reference forms are worth comparing) and admission (which
 * comparisons become evidence) are separate steps on purpose. Generation is a
 * cheap bucketed index lookup and may over-produce; admission is strict and
 * is the only thing that creates a relationship. Nothing downstream ever sees
 * a generated-but-unadmitted form.
 *
 * ═══════════════════ PRODUCTION HARDENING (AG, 2026-08-10) ═══════════════════
 *
 * The offline measurement produced ONE firing. The real 601-candidate document
 * produced FIFTEEN, and thirteen had variant-form as their only Person signal.
 * The explainer (`investigation/variant-form-production-explain.ts`, which
 * reproduces the browser export exactly) showed every false one had the same
 * shape:
 *
 *     Services   ~ SERVIES    surname, 0.933
 *     Scheduler  ~ SCHEDLER   surname, 0.941
 *     Managers   ~ MANGERS    surname, 0.933
 *     Reminders  ~ REINDERS   surname, 0.941
 *     Sesion     ~ SESSION    surname, 0.923
 *
 * versus the true positive:
 *
 *     Chriztopher ~ CHRISTOPHER   given (TOP-1000), 0.909
 *
 * ROOT CAUSE, AND IT IS NOT WHAT IT LOOKS LIKE. It is not plural morphology --
 * none of these is an inflection of its match. It is not the affix guard
 * failing -- all differ internally, so containment does not apply. It is not
 * phonetics -- no phonetic matcher ships. It is not document-local matching --
 * 15 of 17 relationships are reference matches.
 *
 * It is this: THE CENSUS SURNAME TAIL IS A NEAR-COVER OF ENGLISH ORTHOGRAPHY.
 * 195,310 entries include a long tail of rare surnames, and almost any long
 * English word sits one deletion away from one of them. `SERVIES`, `SCHEDLER`,
 * `MANGERS` and `REINDERS` are all real, attested, and all rare. So the
 * relationship is genuine and the inference from it is worthless: discovering
 * that a common word resembles a rare name says nothing about the candidate.
 *
 * THE FIX IS THE PREVALENCE OF THE TARGET, and the asset already carried it.
 * Every false target is Top-1000 in NEITHER role; `CHRISTOPHER` is Top-1000 as
 * a given name. Requiring the matched form to be common leaves 1 of 15.
 *
 * WHY NOT THE ALTERNATIVES, all of which scored identically (1 of 15 kept):
 *   given-names-only         semantically wrong -- surnames are legitimate name
 *                            evidence, and a misspelled `Johnsen` should still
 *                            relate to `JOHNSON`.
 *   partner-required         additionally kills legitimate single-token
 *                            variants and buys nothing here.
 *   common + partner         the extra conjunct changes no row; unearned.
 *
 * DISCOVERY IS NOT DELETED, ONLY DEMOTED. Generation stays broad and every
 * relationship is still recorded and still visible to diagnostics; only
 * relationships to a common form may create PERSON evidence. That is the
 * distinction between "a variant relationship was found" and "a variant
 * relationship supports PERSON".
 *
 * SAFETY SHAPE: this is an admission restriction, so it can only ever REMOVE
 * person-supporting evidence, never add it. It reads no context and no
 * document population, so nothing about the surrounding document can change
 * its answer.
 *
 * KNOWN LIMITATION, stated rather than discovered later: a genuinely rare
 * surname, misspelled, no longer produces person-supporting variant evidence.
 * That person keeps every other evidence channel, and `unsupported` has never
 * meant "not a person".
 *
 * Pure, DOM-free, offline, deterministic.
 */

import { sequenceRatio } from "../entity-resolution/sequence-ratio.js";
import {
  censusAttestedTokens,
  censusRoleFor,
  normalizeForCensusLookup,
  CENSUS_EVIDENCE_SOURCE,
} from "../knowledge/CensusNameEvidence.js";

/**
 * Ratcliff/Obershelp similarity a comparison must reach.
 *
 * 0.90 is not a new number: DecisionReuseEngine already uses exactly this
 * threshold with exactly this reasoning -- deliberately well above the ~0.8 a
 * "did you mean" UX would use, because a false positive here is materially
 * worse than an unhelpful suggestion. Adopting the repository's existing
 * conservative constant beats inventing a second one.
 */
export const VARIANT_SIMILARITY_THRESHOLD = 0.9;

/**
 * Minimum token length for a REFERENCE variant lookup.
 *
 * Measured, not chosen. Below 8 the false-candidate rate against ordinary
 * English words rises steeply (4.0% at >=8, 15.4% at >=6, 16.9% unrestricted),
 * and the mean Census neighbour count within one edit goes from 2.0 at length
 * 8 to 19.0 at length 4. Short tokens are where names and ordinary words
 * collide hardest, so they get no reference variant evidence at all.
 *
 * THE COST, STATED RATHER THAN HIDDEN: a genuine 5-letter variant name gets
 * no evidence from this module. That is the deliberate trade -- a review
 * product should fail to add weak evidence rather than add wrong evidence,
 * and `unsupported` already means "no evidence", not "not a person".
 */
export const VARIANT_MIN_TOKEN_LENGTH = 8;

/**
 * Minimum token length for a DOCUMENT-LOCAL variant lookup.
 *
 * Lower than the reference floor, and the difference is justified rather than
 * assumed: a document-local comparison runs against the few hundred attested
 * tokens THIS DOCUMENT contains, not against 195,310 national name forms, so
 * the probability of an accidental near-match is smaller by roughly three
 * orders of magnitude. Still not permitted below 5, where ordinary words and
 * names collide regardless of corpus size.
 */
export const DOCUMENT_LOCAL_MIN_TOKEN_LENGTH = 5;

/**
 * How a relationship was established. Kept as data on every relationship so a
 * later policy layer can treat them differently WITHOUT this module having to
 * decide that they should be treated differently.
 */
export type VariantMethod =
  /** Orthographically close to a form attested in an external reference dataset. */
  | "orthographic-near-form"
  /** Orthographically close to a form attested ELSEWHERE IN THIS DOCUMENT. */
  | "document-local-variant";

/**
 * ONE relationship between an observed token and an attested form.
 *
 * Deliberately flat and self-contained: months from now the question is not
 * "did variant evidence fire" but "WHICH comparison produced this, against
 * what, by what method" -- and that has to be answerable without the object
 * graph it came from.
 */
export interface VariantRelationship {
  /** The token EXACTLY as it appeared in the document. Never rewritten. */
  observedForm: string;
  /** The matching key the observed form produced. A matching artifact only,
   *  and never display text. */
  observedNormalized: string;
  /** The attested form this was compared against. NOT a proposed replacement,
   *  NOT a correction, NOT a suggestion. */
  matchedForm: string;
  method: VariantMethod;
  /**
   * Ratcliff/Obershelp similarity, retained for auditability.
   *
   * IT IS A MEASUREMENT, NOT A CONFIDENCE. It may be displayed and compared
   * against the threshold that admitted it. It must never be summed, averaged
   * across relationships, or combined with anything to produce a score.
   */
  similarity: number;
  /** Which authority attests `matchedForm`. */
  source: string;
  /** Role evidence carried by the MATCHED form, where the source has roles.
   *  This is what makes the relationship semantically interpretable at all --
   *  a near-form to a surname supports something different from a near-form
   *  to a first name. */
  matchedFirstAttested: boolean;
  matchedSurnameAttested: boolean;
  /**
   * Is the matched form a COMMON name, or a rare tail entry?
   *
   * Read straight from the Census asset's own Top-1000 flags -- not a
   * threshold, not a score, not a weight. It is the fact that separates
   * `CHRISTOPHER` from `SERVIES`, and it is what `personSupporting` below
   * turns on. See the module header's PRODUCTION HARDENING section.
   */
  matchedFormIsCommon: boolean;
  /**
   * Does this relationship support a PERSON reading, or is it only a
   * DISCOVERED resemblance?
   *
   * The two are deliberately different. Candidate generation stays broad so
   * genuine relationships are still found and remain inspectable; only
   * relationships to a COMMON name form are allowed to create semantic PERSON
   * evidence. A relationship with `personSupporting: false` is retained on the
   * record, reported by diagnostics, and contributes nothing to any reading.
   */
  personSupporting: boolean;
  /** Position of the observed token within the candidate, and how many tokens
   *  there were -- so structural role stays recoverable. */
  tokenIndex: number;
  tokenCount: number;
}

/** Everything this module concluded about one candidate. */
export interface VariantFormEvidence {
  /** The candidate's display value, verbatim. Never rewritten. */
  value: string;
  /** Every admitted relationship, in token order then similarity order.
   *  Empty means "no admitted relationship", never a negative finding. */
  relationships: readonly VariantRelationship[];
  /**
   * COMPOSITIONAL CORROBORATION: tokens of this candidate that are EXACTLY
   * attested in Census, other than the ones carrying a variant relationship.
   *
   * This is the load-bearing distinction of the whole module. A variant token
   * ALONE is weak. A variant token sitting beside an exactly-attested token,
   * in a candidate whose shape is a name, is materially more informative --
   * and the measurement agrees: requiring an exactly-attested partner admitted
   * 0 of 23 boundary-fragment and domain-phrase negatives.
   */
  readonly exactAttestedPartnerTokens: readonly string[];
  /** True when a variant relationship and an exact-attested partner co-occur
   *  in the same multi-token candidate. A DESCRIPTION of the evidence shape;
   *  no rule here acts on it. */
  compositionalCorroboration: boolean;
}

const EMPTY: VariantFormEvidence = {
  value: "",
  relationships: [],
  exactAttestedPartnerTokens: [],
  compositionalCorroboration: false,
};

/* ─────────────────────── the generation index ─────────────────────── */

/**
 * Census tokens bucketed by (first letter, length), built lazily on first
 * lookup like every other reference index in this repository.
 *
 * ONLY tokens at or above `VARIANT_MIN_TOKEN_LENGTH - 1` are indexed: a probe
 * must be at least 8 characters and a match must be within one length step,
 * so nothing shorter than 7 can ever be a match. That drops roughly two
 * thirds of the corpus out of the index and is the reason no elaborate search
 * structure is needed -- see the module header on generation vs admission.
 */
interface ReferenceIndex {
  /** Keyed `<first two chars>:<length>`. */
  byHead: Map<string, string[]>;
  /** Keyed `<last two chars>:<length>`. */
  byTail: Map<string, string[]>;
}

let index: ReferenceIndex | null = null;

function ensureIndex(): ReferenceIndex {
  if (index) return index;
  const byHead = new Map<string, string[]>();
  const byTail = new Map<string, string[]>();
  for (const token of censusAttestedTokens()) {
    const n = token.length;
    if (n < VARIANT_MIN_TOKEN_LENGTH - 1) continue;
    const headKey = `${token.slice(0, 2)}:${n}`;
    const head = byHead.get(headKey);
    if (head) head.push(token);
    else byHead.set(headKey, [token]);
    const tailKey = `${token.slice(n - 2)}:${n}`;
    const tail = byTail.get(tailKey);
    if (tail) tail.push(token);
    else byTail.set(tailKey, [token]);
  }
  index = { byHead, byTail };
  return index;
}

/**
 * Reference matches per normalized token, memoized.
 *
 * Keyed on the token alone, which is sound because the reference path depends
 * on nothing else -- the corpus is fixed and bundled. The document-local path
 * is deliberately NOT memoized: it depends on the caller's per-document token
 * set, and a cache keyed only on the token would leak one document's
 * attestations into another's evidence. That is the kind of bug a cache is
 * good at hiding, so the cheaper path simply does not get one.
 */
const referenceMatchMemo = new Map<string, Array<{ form: string; similarity: number }>>();

/**
 * Cheap over-production. Everything yielded here is a CANDIDATE, not evidence.
 *
 * Returns the three relevant buckets rather than a flattened array: a probe
 * touches ~1,200 candidates and spreading them into a fresh array allocated
 * 1,200 strings per token for no benefit. The caller iterates the buckets in
 * place.
 */
function referenceBucketsFor(normalized: string): Array<readonly string[]> {
  const idx = ensureIndex();
  const m = normalized.length;
  const head = normalized.slice(0, 2);
  const tail = normalized.slice(m - 2);
  const buckets: Array<readonly string[]> = [];
  for (let d = -1; d <= 1; d += 1) {
    const n = m + d;
    const byHead = idx.byHead.get(`${head}:${n}`);
    if (byHead) buckets.push(byHead);
    const byTail = idx.byTail.get(`${tail}:${n}`);
    if (byTail) buckets.push(byTail);
  }
  return buckets;
}

/* ─────────────────────── admission ─────────────────────── */

/**
 * A SOUND, CHEAP LOWER BOUND on Ratcliff/Obershelp similarity.
 *
 * Added after measurement, not before: the first implementation ran
 * `sequenceRatio` against every generated candidate and cost 2,529 µs per
 * candidate -- 1.44 SECONDS for a 569-candidate document, roughly 500x the
 * entire existing evidence layer. Generation produces ~1,200 candidates per
 * probe and Ratcliff/Obershelp is O(m*n) with map allocation, so the cost was
 * entirely in comparisons that could never have passed.
 *
 * `sequenceRatio` is 2M/(m+n) where M is the total size of the matching
 * blocks. M can never exceed the size of the multiset intersection of the two
 * strings' characters, so if
 *
 *     2 * |intersection| / (m + n)  <  threshold
 *
 * the real ratio cannot reach the threshold either. This test is O(m+n) with
 * one small scratch array and NEVER rejects a pair the full comparison would
 * have admitted -- it is a filter, not an approximation, and the verification
 * suite pins that equivalence directly.
 */
const ALPHABET = 26;
/** The probe's character counts, computed ONCE per observed token rather than
 *  once per generated candidate -- the first version recomputed them ~1,200
 *  times per token, which was most of the remaining cost after the filter
 *  itself landed. */
const probeCounts = new Int32Array(ALPHABET);
const working = new Int32Array(ALPHABET);

function loadProbeCounts(a: string): void {
  probeCounts.fill(0);
  for (let i = 0; i < a.length; i += 1) {
    const c = a.charCodeAt(i) - 65;
    if (c >= 0 && c < ALPHABET) probeCounts[c]! += 1;
  }
}

/**
 * THE CHEAPEST SOUND FILTER, applied before everything else.
 *
 * Ratcliff/Obershelp is 2M/(m+n). At the shipped threshold of 0.90 with
 * m >= 8 and |m - n| <= 1, M >= 0.9(m+n)/2 forces at most ONE unmatched
 * character position in the shorter string. One differing position cannot lie
 * inside both the first two characters and the last two characters at once,
 * so a genuine match must agree on one end or the other:
 *
 *     (a[0]==b[0] && a[1]==b[1])  ||  (a[m-1]==b[n-1] && a[m-2]==b[n-2])
 *
 * Four character comparisons. It never rejects a pair the full comparison
 * would admit, and the verification suite proves that by brute force rather
 * than by this argument.
 *
 * WHY IT EXISTS: without it a cold document load cost 460 µs per candidate
 * (262 ms for 569 candidates) -- user-perceptible, and roughly 100x the whole
 * eight-family reference layer. Generation legitimately over-produces ~1,200
 * candidates per token; the fix is to reject them cheaply, not to generate
 * fewer and risk missing real matches.
 */
function endsAgree(a: string, b: string): boolean {
  if (a.length < 2 || b.length < 2) return true;
  if (a[0] === b[0] && a[1] === b[1]) return true;
  return a[a.length - 1] === b[b.length - 1] && a[a.length - 2] === b[b.length - 2];
}

function couldReachThreshold(aLength: number, b: string, threshold: number): boolean {
  working.set(probeCounts);
  let shared = 0;
  for (let i = 0; i < b.length; i += 1) {
    const c = b.charCodeAt(i) - 65;
    if (c >= 0 && c < ALPHABET && working[c]! > 0) {
      working[c]! -= 1;
      shared += 1;
    }
  }
  return (2 * shared) / (aLength + b.length) >= threshold;
}

/**
 * PURE AFFIX DIFFERENCES ARE CONTAINMENT, NOT VARIANT FORMS.
 *
 * The second thing measurement caught. On the live residue, three of the four
 * relationships the first implementation produced were inflections:
 *
 *     Graded      ~ GRADE       (GRADE is a Census-attested surname)
 *     Grades      ~ GRADE
 *     Presidents  ~ PRESIDENT
 *
 * All three score 0.909 -- above the threshold -- and all three are wrong in
 * the specific way this module must not be wrong: they manufacture person
 * evidence for ordinary inflected vocabulary. Note that compositional
 * corroboration did NOT save two of them, because `HAPPY` and `DUE` are
 * themselves Census-attested tokens.
 *
 * When one form is a proper prefix of the other, the entire difference is a
 * suffix, and in English a suffix difference is overwhelmingly inflectional or
 * derivational morphology rather than a spelling variant. This module already
 * forbids stemming as a semantic claim; admitting a relationship that is
 * indistinguishable from stemming would be that claim by another route.
 *
 * THE MIRROR CASE, found by the verification suite after the trailing case was
 * fixed: a LEADING affix is the same failure from the other end.
 *
 *     Transfer  ~ RANSFER      (RANSFER is a Census-attested surname, 0.933)
 *
 * That is a truncation relationship -- a concept DocScrub already models
 * elsewhere as `truncated_variant` in cross-candidate evidence -- and it is
 * the exact shape an extraction-boundary error takes. Admitting it would let
 * variant matching manufacture person evidence for a domain phrase, which is
 * the one thing this module must never do. So containment is refused at both
 * ends, symmetrically.
 *
 * THE COST: a genuine variant that differs only by a leading or trailing
 * character -- `Yazmin` / `Yazmine` -- is refused. That is the conservative
 * direction, and such forms are usually attested in their own right anyway.
 */
function isPureAffixDifference(a: string, b: string): boolean {
  return a.startsWith(b) || b.startsWith(a) || a.endsWith(b) || b.endsWith(a);
}

/**
 * The single admission test, shared by both methods so they cannot drift.
 *
 * `loadProbeCounts(observed)` MUST have been called for this observed token.
 * The coupling is unpleasant but it is contained to this file, it is the
 * difference between 2,529 µs and single-digit µs per candidate, and the
 * verification suite pins the filtered result against an unfiltered brute
 * force so the optimization cannot silently change an answer.
 */
function admits(observed: string, reference: string, threshold: number): number | null {
  if (reference === observed) return null;
  if (!endsAgree(observed, reference)) return null;
  if (isPureAffixDifference(observed, reference)) return null;
  if (!couldReachThreshold(observed.length, reference, threshold)) return null;
  const similarity = sequenceRatio(observed, reference);
  return similarity >= threshold ? similarity : null;
}

/* ─────────────────────── tokenization ─────────────────────── */

/** Alphabetic tokens with their original surface, in candidate order. Commas
 *  drop so `Goodloe, Andrew` yields both tokens -- the same rule
 *  entity-resolution and the reference layer already use. */
function candidateTokens(displayValue: string): Array<{ surface: string; normalized: string }> {
  return displayValue
    .replace(/,/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((surface) => ({ surface, normalized: normalizeForCensusLookup(surface) }))
    .filter((t) => t.normalized.length > 0);
}

/* ─────────────────────── the lookup ─────────────────────── */

export interface VariantFormOptions {
  /**
   * Normalized tokens appearing in OTHER candidates in this document that are
   * EXACTLY Census-attested. Supplied by the caller because this module owns
   * no view of the document -- the same discipline the protection gate and
   * the residual-review gate follow.
   *
   * Omit to disable document-local matching entirely.
   */
  documentAttestedTokens?: ReadonlySet<string>;
}

/**
 * Every admitted variant relationship for one candidate.
 *
 * A TOKEN THAT IS ALREADY EXACTLY ATTESTED GETS NO VARIANT LOOKUP. Exact
 * evidence is stronger and differently-shaped, and routing an exactly-attested
 * form through fuzzy matching would both waste work and blur the distinction
 * the whole design exists to keep -- `Johnson` is attested, full stop, and
 * saying it is "similar to Johnsen" adds nothing and confuses the record.
 */
export function variantFormEvidenceFor(displayValue: string, options: VariantFormOptions = {}): VariantFormEvidence {
  const tokens = candidateTokens(displayValue);
  if (tokens.length === 0) return { ...EMPTY, value: displayValue };

  const relationships: VariantRelationship[] = [];
  const exactPartners: string[] = [];
  let variantTokenCount = 0;

  for (let i = 0; i < tokens.length; i += 1) {
    const { surface, normalized } = tokens[i]!;

    /* Exact attestation short-circuits: no variant lookup, and the token
     * becomes compositional corroboration for its neighbours instead. */
    if (censusRoleFor(normalized) !== null) {
      exactPartners.push(normalized);
      continue;
    }

    const admitted: VariantRelationship[] = [];
    loadProbeCounts(normalized);

    /* 1. REFERENCE VARIANTS -- against the national corpus, length >= 8. */
    if (normalized.length >= VARIANT_MIN_TOKEN_LENGTH) {
      let matches = referenceMatchMemo.get(normalized);
      if (!matches) {
        matches = [];
        /* A reference can sit in both the head and the tail bucket, so
         * admitted forms are deduplicated. The set stays tiny -- admission is
         * strict by design, and a token with many matches is itself a signal
         * that the corpus is too dense there to be informative. */
        const seen = new Set<string>();
        for (const bucket of referenceBucketsFor(normalized)) {
          for (const reference of bucket) {
            if (seen.has(reference)) continue;
            const similarity = admits(normalized, reference, VARIANT_SIMILARITY_THRESHOLD);
            if (similarity === null) continue;
            seen.add(reference);
            matches.push({ form: reference, similarity });
          }
        }
        referenceMatchMemo.set(normalized, matches);
      }
      for (const match of matches) {
        const role = censusRoleFor(match.form);
        if (!role) continue;
        admitted.push({
          observedForm: surface,
          observedNormalized: normalized,
          matchedForm: match.form,
          method: "orthographic-near-form",
          similarity: match.similarity,
          source: CENSUS_EVIDENCE_SOURCE,
          matchedFirstAttested: role.firstAttested,
          matchedSurnameAttested: role.surnameAttested,
          matchedFormIsCommon: role.firstTop1000 || role.surnameTop1000,
          personSupporting: role.firstTop1000 || role.surnameTop1000,
          tokenIndex: i,
          tokenCount: tokens.length,
        });
      }
    }

    /* 2. DOCUMENT-LOCAL VARIANTS -- against tokens this document itself
     *    attests, length >= 5. A much smaller corpus, hence a lower floor. */
    const local = options.documentAttestedTokens;
    if (local && normalized.length >= DOCUMENT_LOCAL_MIN_TOKEN_LENGTH) {
      for (const attested of local) {
        const similarity = admits(normalized, attested, VARIANT_SIMILARITY_THRESHOLD);
        if (similarity === null) continue;
        const role = censusRoleFor(attested);
        if (!role) continue;
        admitted.push({
          observedForm: surface,
          observedNormalized: normalized,
          matchedForm: attested,
          method: "document-local-variant",
          similarity,
          source: "document-local",
          matchedFirstAttested: role.firstAttested,
          matchedSurnameAttested: role.surnameAttested,
          matchedFormIsCommon: role.firstTop1000 || role.surnameTop1000,
          personSupporting: role.firstTop1000 || role.surnameTop1000,
          tokenIndex: i,
          tokenCount: tokens.length,
        });
      }
    }

    if (admitted.length > 0) {
      variantTokenCount += 1;
      /* Strongest similarity first, then alphabetically -- stable and
       * diffable. Ordering is presentation, not precedence. */
      admitted.sort((a, b) => b.similarity - a.similarity || a.matchedForm.localeCompare(b.matchedForm));
      relationships.push(...admitted);
    }
  }

  return {
    value: displayValue,
    relationships,
    exactAttestedPartnerTokens: exactPartners,
    compositionalCorroboration: variantTokenCount > 0 && exactPartners.length > 0 && tokens.length > 1,
  };
}

/**
 * Reviewer-facing lines. States a resemblance between two strings and nothing
 * else.
 *
 * Read the wording carefully before changing it. "similar to", "attested",
 * "resembles" are claims about forms. "should be", "meant", "corrected to"
 * are claims about the author, and this module cannot support one.
 */
export function explainVariantFormEvidence(evidence: VariantFormEvidence): string[] {
  if (evidence.relationships.length === 0) return [];
  const lines: string[] = [];
  const byToken = new Map<string, VariantRelationship[]>();
  for (const r of evidence.relationships) {
    const bucket = byToken.get(r.observedForm) ?? [];
    bucket.push(r);
    byToken.set(r.observedForm, bucket);
  }
  for (const [observed, group] of byToken) {
    const forms = group.map((r) => `"${r.matchedForm}"`).join(", ");
    const where = group[0]!.method === "document-local-variant" ? "elsewhere in this document" : "in U.S. Census name data";
    lines.push(`The observed form "${observed}" is closely similar to ${forms}, attested ${where}.`);
    lines.push("The observed spelling is what appears in the document and is not being questioned.");
  }
  if (evidence.compositionalCorroboration) {
    lines.push(
      `Another token of this candidate (${evidence.exactAttestedPartnerTokens.join(", ")}) is itself attested name data, so the similarity sits inside a name-shaped structure rather than standing alone.`
    );
  }
  return lines;
}
