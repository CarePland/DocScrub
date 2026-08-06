/**
 * semantic-augmentation.ts -- Deterministic Semantic Relationship
 * Knowledge (2026-07-30). The AUGMENTATION pass that lets curated
 * semantic relationship providers (RelatedNameProvider today; acronym/
 * organization-alias/user-alias providers later) contribute explainable
 * evidence to entity resolution -- WITHOUT touching the faithful Python
 * port in resolution.ts.
 *
 * ARCHITECTURAL SEAM, load-bearing: RegexEntityResolutionEngine runs the
 * port EXACTLY as before, then calls this pass only when providers are
 * configured. An engine constructed bare (every parity/verification suite,
 * and app.ts's display-recalculation instance) is byte-identical to
 * Python; the knowledge layer exists strictly ABOVE the oracle surface.
 * Classification: additive domain requirement -- this feature has no
 * Python counterpart, and gating it on provider presence keeps the parity
 * record honest rather than sprinkling conditionals through ported code.
 *
 * WHAT IT ADDS (identity ambiguity only -- ordinary AmbiguityProposals,
 * the existing reviewer workflow; never a merge, never a decision):
 *
 *  PASS A -- short references: a bare first-name candidate ("Andy")
 *  already matches full-name anchors sharing that exact first token; with
 *  a name-token provider it ALSO matches anchors whose first name is
 *  RELATED ("Andrew Goodloe" via andy~andrew, Strength 5). New options
 *  carry the relationship as evidence; the port's own exact-match options
 *  gain an "Exact first-name match" evidence line so every option in the
 *  proposal explains itself.
 *
 *  PASS B -- cross-bucket full names: "Drew Goodloe" and "Andrew Goodloe"
 *  live in different deterministic buckets (person:goodloe:d vs :a), so
 *  the port can never relate them. When their surnames match exactly and
 *  a provider relates their first names, the LESS-ATTESTED side gains an
 *  ambiguity proposal offering the better-attested anchor -- evidence:
 *  same surname + the relationship. ("Andy Goodloe" vs "Andrew Goodloe"
 *  needs no help: same first initial, same bucket, already grouped
 *  deterministically.)
 *
 * CONFIDENCE ("strength should influence confidence proportionally"): a
 * knowledge-derived option starts from the anchor's own port-computed
 * confidence and subtracts a deterministic penalty for the inexact name,
 * linear in strength: penalty = 24 - 4xstrength (5->-4, 4->-8, 3->-12,
 * 2->-16, 1->-20), clamped to the port's own [35, 99] band. Never
 * sufficient by itself: everything else about the option (the anchor, its
 * score, the grouping) still comes from the deterministic pipeline, and
 * nothing links without the reviewer.
 *
 * EXPLAINABILITY: every added or annotated option carries reviewer-facing
 * evidence lines ('Same surname ("goodloe")', 'Related-name relationship:
 * "drew" ~ "andrew" (Strength 5 -- Established)') -- no opaque scoring;
 * each line is one independently checkable fact.
 */

import type { Candidate } from "../../domain/DocumentModel.js";
import type { DetectionResult } from "../DetectionEngine.js";
import type { AmbiguityProposal, AmbiguityProposalGroupOption, GroupingResult } from "../EntityResolutionEngine.js";
import type { RelationStrength, SemanticRelationshipProvider } from "../knowledge/SemanticRelationshipProvider.js";
import { RELATION_STRENGTH_LABELS } from "../knowledge/SemanticRelationshipProvider.js";
import {
  buildFullNameAnchorBuckets,
  cleanToken,
  displayName,
  isShortPersonReference,
  memberScore,
  personGroupKey,
  personTokens,
  scoreAnchorBucket,
  tokens,
  type QualityLookup,
} from "./resolution.js";
import { normalizeFullValue } from "../knowledge/FullValueAliasProvider.js";

/** penalty = 24 - 4*strength: linear, monotonic, documented -- Strength 5
 *  costs 4 points off the anchor's confidence, Strength 1 costs 20. */
export function strengthPenalty(strength: RelationStrength): number {
  return 24 - 4 * strength;
}

/** Phase 2 CONFIDENCE POLICY (deliberately NOT Phase 1's curve, per the
 *  prompt's instruction to review rather than assume): full-value aliases
 *  get penalty = 30 - 5*strength (5->5, 4->10, 3->15, 2->20, 1->25) --
 *  steeper than the name-token 24-4s at every strength. Rationale: a
 *  name-token match still carries residual corroboration from the
 *  surrounding pipeline (Pass B additionally requires an exact surname;
 *  Pass A's anchors share the document's person-name machinery), while a
 *  full-value alias edge IS the entire claim, and short acronym tokens
 *  are the most collision-prone strings in a document (NSC, DV, HR...).
 *  Policy lives HERE in the augmentation layer, not in any provider, so
 *  future full-value datasets inherit it and future policy changes touch
 *  one constant. */
export function fullValueStrengthPenalty(strength: RelationStrength): number {
  return 30 - 5 * strength;
}

const clampConfidence = (value: number): number => Math.max(35, Math.min(99, value));

function relationEvidenceLine(provider: SemanticRelationshipProvider, a: string, b: string, strength: RelationStrength): string {
  return `${provider.evidenceLabel}: "${a}" ↔ "${b}" (Strength ${strength} — ${RELATION_STRENGTH_LABELS[strength]})`;
}

interface AnchorInfo {
  key: string;
  canonicalName: string;
  confidence: number;
  firstToken: string;
  lastToken: string;
  memberCount: number;
}

export function augmentGroupingWithSemanticKnowledge(
  grouping: GroupingResult,
  detection: DetectionResult,
  qualityOf: QualityLookup,
  providers: readonly SemanticRelationshipProvider[]
): GroupingResult {
  const nameProviders = providers.filter((p) => p.termDomain === "name-token");
  const fullValueProviders = providers.filter((p) => p.termDomain === "full-value");
  if (nameProviders.length === 0 && fullValueProviders.length === 0) return grouping;

  // The port's own anchor machinery, reused verbatim (exported helpers).
  const anchorBuckets = buildFullNameAnchorBuckets(detection.candidates);
  const anchors: AnchorInfo[] = [];
  for (const [key, members] of anchorBuckets) {
    const option = scoreAnchorBucket(key, members, qualityOf);
    if (!option) continue;
    const nameTokens = tokens(option.canonicalName).map(cleanToken).filter((t) => t.length > 0);
    if (nameTokens.length < 2) continue;
    anchors.push({
      key,
      canonicalName: option.canonicalName,
      confidence: option.confidence,
      firstToken: nameTokens[0]!,
      lastToken: nameTokens[nameTokens.length - 1]!,
      memberCount: members.length,
    });
  }
  anchors.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)); // deterministic iteration

  const groupedIds = new Set<string>();
  for (const group of grouping.entityGroupProposals) for (const id of group.candidateIds) groupedIds.add(id);

  // Working copy of proposals, keyed by candidate; options arrays cloned so
  // the port's result object is never mutated.
  const proposalsByCandidate = new Map<string, AmbiguityProposalGroupOption[]>();
  for (const proposal of grouping.ambiguityProposals) {
    // Annotate the port's own options: every port-produced option for a
    // short reference exists because of an exact first-token match -- say
    // so, so the whole proposal is explainable, not just the new options.
    const candidate = detection.candidates.find((c) => c.id === proposal.candidateId);
    const token = candidate && isShortPersonReference(candidate) ? personTokens(candidate)[0]! : null;
    proposalsByCandidate.set(
      proposal.candidateId,
      proposal.candidateGroupOptions.map((option) => {
        if (option.evidence !== undefined || token === null) return { ...option };
        return { ...option, evidence: [`Exact first-name match ("${token}")`] };
      })
    );
  }

  const addOption = (candidateId: string, option: AmbiguityProposalGroupOption): void => {
    const options = proposalsByCandidate.get(candidateId) ?? [];
    if (options.some((existing) => existing.groupId === option.groupId)) return; // never duplicate a home
    proposalsByCandidate.set(candidateId, [...options, option]);
  };

  // ---- PASS A: short references x related first names -------------------
  for (const candidate of detection.candidates) {
    if (!isShortPersonReference(candidate)) continue;
    if (groupedIds.has(candidate.id)) continue; // port rule: grouped candidates are settled
    const token = personTokens(candidate)[0]!;
    for (const provider of nameProviders) {
      for (const relation of provider.relationsOf(token)) {
        for (const anchor of anchors) {
          if (anchor.firstToken !== relation.term) continue;
          addOption(candidate.id, {
            groupId: anchor.key,
            canonicalName: anchor.canonicalName,
            confidence: clampConfidence(anchor.confidence - strengthPenalty(relation.strength)),
            evidence: [relationEvidenceLine(provider, token, relation.term, relation.strength)],
          });
        }
      }
    }
  }

  // ---- PASS B: cross-bucket full names (same surname, related firsts) ---
  // Only the LESS-ATTESTED side asks the question, so one real-world
  // relationship never produces two mirrored proposals: fewer bucket
  // members loses; then lower anchor confidence; then greater key --
  // deterministic and documented.
  const anchorsByKey = new Map(anchors.map((a) => [a.key, a]));
  for (const candidate of detection.candidates) {
    if (candidate.detectedType !== "person") continue;
    const nameTokens = personTokens(candidate);
    if (nameTokens.length < 2) continue;
    const ownKey = personGroupKey(candidate);
    const own = anchorsByKey.get(ownKey);
    if (!own) continue;
    const firstC = nameTokens[0]!;
    const lastC = nameTokens[nameTokens.length - 1]!;
    for (const anchor of anchors) {
      if (anchor.key === ownKey) continue;
      if (anchor.lastToken !== lastC) continue;
      const lessAttested =
        own.memberCount < anchor.memberCount ||
        (own.memberCount === anchor.memberCount &&
          (own.confidence < anchor.confidence || (own.confidence === anchor.confidence && own.key > anchor.key)));
      if (!lessAttested) continue;
      for (const provider of nameProviders) {
        const strength = provider.strengthBetween(firstC, anchor.firstToken);
        if (strength === null) continue;
        addOption(candidate.id, {
          groupId: anchor.key,
          canonicalName: anchor.canonicalName,
          confidence: clampConfidence(anchor.confidence - strengthPenalty(strength)),
          evidence: [`Same surname ("${lastC}")`, relationEvidenceLine(provider, firstC, anchor.firstToken, strength)],
        });
      }
    }
  }

  // ---- PASS C: full-value aliases (Phase 2 -- acronyms, organization
  // aliases) -- the seam Phase 1 marked, now real. -----------------------
  //
  // ELIGIBILITY: person-type candidates only. This pipeline has NO
  // organization detectedType (established in itemCheckQuery.ts's
  // "Organizations" design note): organization names and acronyms surface
  // as "person" candidates via the capitalized-text fallback detectors, so
  // "person" is the free-text category where a full-value alias can be
  // meaningful. email/phone/cin/long_numeric_id are typed identifiers --
  // an "alias" of a phone number is not a coherent concept, so they are
  // excluded rather than indiscriminately compared.
  //
  // DIRECTION (one-sided, non-mirrored): the SHORTER normalized value asks
  // ("NSC" asks about "National Student Clearinghouse", never the
  // reverse) -- abbreviation-to-expansion is the natural question, and
  // determinism needs exactly one asker. Equal lengths: the
  // lexicographically GREATER value asks (mirrors Pass B's greater-key
  // rule). Never occurrence order, never document uniqueness.
  //
  // TRANSITIVITY: none. Only DIRECT dataset edges propose. Chains
  // converge only through a shared direct target ("CSULA" and "Cal State
  // LA" each propose the full university name when it is present) or an
  // explicit dataset edge between them -- never by inference.
  //
  // MULTIPLE EXPANSIONS: every related anchor becomes an option in the ONE
  // proposal ("NSC" offers National Student Clearinghouse AND National
  // Safety Council when both appear) -- reviewer-visible alternatives,
  // no automatic choice.
  if (fullValueProviders.length > 0) {
    // Full-value anchors: every eligible candidate's whole normalized
    // value, targeting the same group keys the reviewer's
    // linkAmbiguousCandidate flow already accepts. Multi-token candidates
    // reuse their bucket anchors (variants aggregate, port-scored);
    // single-token candidates ("DegreeVerify", "CSULA") get a
    // per-candidate anchor scored by the port's own memberScore -- the
    // same function, so nothing is scored by a second rule.
    interface FullValueAnchor {
      key: string;
      canonicalName: string;
      /** The DOCUMENT form that matched (a member's own text, or the
       *  canonical name) -- used in the evidence line so the reviewer sees
       *  the document's spelling, never a machine-reordered one. */
      displayForm: string;
      confidence: number;
      memberIds: readonly string[];
    }
    const fullValueAnchorsByValue = new Map<string, FullValueAnchor[]>();
    const addFullValueAnchor = (normalized: string, anchor: FullValueAnchor): void => {
      if (normalized.length === 0) return;
      const list = fullValueAnchorsByValue.get(normalized) ?? [];
      if (list.some((existing) => existing.key === anchor.key)) return;
      list.push(anchor);
      fullValueAnchorsByValue.set(normalized, list);
    };
    // FOUND DURING VERIFICATION, disclosed: the port's displayName()
    // applies the person-name comma reversal ("Last, First" -> "First
    // Last") to EVERY comma-bearing value -- including organization names
    // ("California State University, Los Angeles" -> "Los Angeles
    // California State University"). Correct for the person pipeline it
    // was ported for; wrong as a matching key for full-value aliases. So
    // anchors index under BOTH the canonical name's normalization AND
    // every member's RAW displayValue normalization -- the dataset and
    // the document both use natural written order, and the raw text is
    // the truthful comparison key. The port itself is untouched.
    for (const anchor of anchors) {
      const members = anchorBuckets.get(anchor.key) ?? [];
      const memberIds = members.map((m) => m.id);
      addFullValueAnchor(normalizeFullValue(anchor.canonicalName), {
        key: anchor.key,
        canonicalName: anchor.canonicalName,
        displayForm: anchor.canonicalName,
        confidence: anchor.confidence,
        memberIds,
      });
      for (const member of members) {
        addFullValueAnchor(normalizeFullValue(member.displayValue), {
          key: anchor.key,
          canonicalName: anchor.canonicalName,
          displayForm: member.displayValue.trim(),
          confidence: anchor.confidence,
          memberIds,
        });
      }
    }
    for (const candidate of detection.candidates) {
      if (candidate.detectedType !== "person") continue;
      if (personTokens(candidate).length >= 2) continue; // covered by bucket anchors above
      const canonicalName = displayName(candidate.displayValue);
      addFullValueAnchor(normalizeFullValue(candidate.displayValue), {
        key: personGroupKey(candidate), // "person-single:<id>" -- unique, linkable
        canonicalName,
        displayForm: candidate.displayValue.trim(),
        confidence: Math.max(35, Math.min(99, memberScore(canonicalName, candidate, qualityOf))),
        memberIds: [candidate.id],
      });
    }

    // Realized-group membership, for the "already the same entity" skip.
    const groupIdsByCandidate = new Map<string, Set<string>>();
    for (const group of grouping.entityGroupProposals) {
      for (const id of group.candidateIds) {
        const set = groupIdsByCandidate.get(id) ?? new Set<string>();
        set.add(group.groupId);
        groupIdsByCandidate.set(id, set);
      }
    }
    const shareRealizedGroup = (candidateId: string, memberIds: readonly string[]): boolean => {
      const own = groupIdsByCandidate.get(candidateId);
      if (!own) return false;
      return memberIds.some((memberId) => {
        const theirs = groupIdsByCandidate.get(memberId);
        return theirs !== undefined && [...own].some((g) => theirs.has(g));
      });
    };

    for (const candidate of detection.candidates) {
      if (candidate.detectedType !== "person") continue;
      // RAW displayValue, not displayName(): the comma-reversal heuristic
      // must not rewrite the asker's value either (see the anchor-indexing
      // note above).
      const ownValue = normalizeFullValue(candidate.displayValue);
      if (ownValue.length === 0) continue;
      const ownKey = personGroupKey(candidate);
      for (const provider of fullValueProviders) {
        for (const relation of provider.relationsOf(ownValue)) {
          // Direction: shorter normalized value asks; equal-length ties ->
          // the lexicographically greater side asks.
          const asks = ownValue.length < relation.term.length || (ownValue.length === relation.term.length && ownValue > relation.term);
          if (!asks) continue;
          for (const target of fullValueAnchorsByValue.get(relation.term) ?? []) {
            if (target.key === ownKey) continue; // same deterministic identity already
            if (target.memberIds.includes(candidate.id)) continue;
            if (shareRealizedGroup(candidate.id, target.memberIds)) continue; // already grouped together
            addOption(candidate.id, {
              groupId: target.key,
              canonicalName: target.canonicalName,
              confidence: clampConfidence(target.confidence - fullValueStrengthPenalty(relation.strength)),
              evidence: [
                `${relation.label ?? provider.evidenceLabel}: "${candidate.displayValue.trim()}" ↔ "${target.displayForm}" (Strength ${relation.strength} — ${RELATION_STRENGTH_LABELS[relation.strength]})`,
              ],
            });
          }
        }
      }
    }
  }

  // Reassemble: the port's proposal sort (candidateKey, plain codepoint
  // order) over the union; each proposal's port options keep their
  // original order, knowledge-derived options follow (confidence desc,
  // then groupId).
  const ambiguityProposals: AmbiguityProposal[] = [...proposalsByCandidate.entries()]
    .filter(([, options]) => options.length > 0)
    .map(([candidateId, options]) => {
      const portCount = grouping.ambiguityProposals.find((p) => p.candidateId === candidateId)?.candidateGroupOptions.length ?? 0;
      const portOptions = options.slice(0, portCount);
      const added = options.slice(portCount).sort((a, b) => b.confidence - a.confidence || (a.groupId < b.groupId ? -1 : a.groupId > b.groupId ? 1 : 0));
      const ordered = [...portOptions, ...added];
      return { candidateId, candidateGroupIds: ordered.map((o) => o.groupId), candidateGroupOptions: ordered };
    })
    .sort((a, b) => {
      const ak = a.candidateId.toLowerCase();
      const bk = b.candidateId.toLowerCase();
      return ak < bk ? -1 : ak > bk ? 1 : 0;
    });

  return { ...grouping, ambiguityProposals };
}
