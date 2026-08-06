// Milestone 1, Phase 1 + Phase 2 verification: ExplanationEngine (dictionary
// lookup, confidence opener, phrase joining, per-view payload shape),
// buildExplanationContext's disposition derivation, groupReviewOccurrences-
// ForCandidate's per-candidate occurrence grouping, and categoryRuleLabel's
// dictionary/fallback behavior. Cross-checked directly against
// redactor/explanations.py's own branch structure and constants (read in
// full for this milestone), not just internal self-consistency.

import type { Evidence } from "../src/domain/Evidence.ts";
import {
  buildExplanation,
  buildExplanationContext,
  buildStandardSummary,
  confidenceOpener,
  entityPhrase,
  joinPhrases,
  normalizeEvidenceText,
} from "../src/engines/explanation/explanation-builder.ts";
import { DeterministicExplanationEngine } from "../src/engines/ExplanationEngine.ts";
import { groupReviewOccurrencesForCandidate, type ReviewOccurrence } from "../src/engines/OccurrenceClassifier.ts";
import { categoryRuleLabel } from "../src/engines/quality/category-rule-labels.data.ts";

let passed = 0;
let failed = 0;

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
  } else {
    failed++;
    console.log(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function checkTrue(label: string, condition: boolean): void {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.log(`FAIL ${label}`);
  }
}

function evidence(id: string, category: string, weight: number, source = "candidate-quality-engine"): Evidence {
  return { id, kind: weight > 0 ? "positive" : weight < 0 ? "negative" : "neutral", category, weight, source };
}

// --- entityPhrase / confidenceOpener: direct port of Python's _entity_phrase/_confidence_opener ---
check("entityPhrase(person)", entityPhrase("person"), "a person's name");
check("entityPhrase(email)", entityPhrase("email"), "an email address");
check("entityPhrase(phone)", entityPhrase("phone"), "a phone number");
check("entityPhrase(cin)", entityPhrase("cin"), "an identifying number");
check("entityPhrase(long_numeric_id)", entityPhrase("long_numeric_id"), "an identifying number");
check("entityPhrase(other_identifier)", entityPhrase("other_identifier"), "an identifier");
check("entityPhrase(unknown_type) falls back to 'a {type}'", entityPhrase("street_address"), "a street address");

check("confidenceOpener >=95", confidenceOpener(95, "person"), "Almost certainly a person's name");
check("confidenceOpener >=80 <95", confidenceOpener(84, "person"), "Likely a person's name");
check("confidenceOpener >=50 <80", confidenceOpener(50, "email"), "Possibly an email address");
check("confidenceOpener <50", confidenceOpener(12, "phone"), "Unlikely to be a phone number");
check("confidenceOpener boundary 95 exact", confidenceOpener(95, "person"), "Almost certainly a person's name");
check("confidenceOpener boundary 94", confidenceOpener(94, "person"), "Likely a person's name");

// --- joinPhrases: Oxford-comma joining for 0/1/2/3+ items (Python's _join_phrases) ---
check("joinPhrases([])", joinPhrases([]), "");
check("joinPhrases(['a'])", joinPhrases(["a"]), "a");
check("joinPhrases(['a','b'])", joinPhrases(["a", "b"]), "a and b");
check("joinPhrases(['a','b','c'])", joinPhrases(["a", "b", "c"]), "a, b, and c");
check("joinPhrases(['a','b','c','d'])", joinPhrases(["a", "b", "c", "d"]), "a, b, c, and d");
check("joinPhrases filters empty strings", joinPhrases(["", "a", ""]), "a");

// --- normalizeEvidenceText: dictionary lookup + fallback ---
const knownFirstName = normalizeEvidenceText(evidence("c1:known-first-name", "known-first-name", 20));
// DECLARED DEVIATION (AG, 2026-08-04): `short` is reviewer copy now, not a
// verbatim port -- see explanation-dictionary.data.ts's header for why the
// oracle has no equivalent surface to diverge from. The two registers that
// ARE reviewer-invisible and DO feed the audit narrative stay pinned to
// Python's exact strings on the next two lines; that is the parity that
// matters and it is deliberately still asserted.
check("normalizeEvidenceText known category short (reviewer copy, deviation declared)", knownFirstName.short, "Common first name");
check("normalizeEvidenceText known category standard (VERBATIM from Python)", knownFirstName.standard, "it matches a known first name");
check("normalizeEvidenceText known category expert (VERBATIM from Python)", knownFirstName.expert, "Known first name");
check("normalizeEvidenceText preserves polarity/weight/id", [knownFirstName.polarity, knownFirstName.weight, knownFirstName.id], [
  "positive",
  20,
  "c1:known-first-name",
]);

const unknownCategory = normalizeEvidenceText(evidence("c2:some-new-rule", "some-new-rule", -5));
check("normalizeEvidenceText fallback short is title-cased", unknownCategory.short, "Some New Rule");
check("normalizeEvidenceText fallback standard", unknownCategory.standard, "it has some new rule evidence");
checkTrue("normalizeEvidenceText never invents a different polarity than the source Evidence", unknownCategory.polarity === "negative");

// --- buildStandardSummary: every branch Python's build_standard_explanation covers ---
const positiveOnly = buildStandardSummary(
  buildExplanationContext({
    candidateId: "c1",
    entityType: "person",
    likelihood: 96,
    recommendation: "ToReview",
    occurrenceCount: 3,
    evidence: [evidence("c1:known-first-name", "known-first-name", 20), evidence("c1:known-surname", "known-surname", 20)],
    assessment: undefined,
  })
);
check(
  "buildStandardSummary: positive-only branch",
  positiveOnly,
  "Almost certainly a person's name because it matches a known first name and it matches a known surname."
);

const negativeOnly = buildStandardSummary(
  buildExplanationContext({
    candidateId: "c2",
    entityType: "person",
    likelihood: 30,
    recommendation: "Unlikely",
    occurrenceCount: 1,
    evidence: [evidence("c2:common-english-word", "common-english-word", -20)],
    assessment: undefined,
  })
);
check(
  "buildStandardSummary: negative-only branch",
  negativeOnly,
  "Unlikely to be a person's name because it is also a common English word."
);

const positiveAndNegative = buildStandardSummary(
  buildExplanationContext({
    candidateId: "c3",
    entityType: "person",
    likelihood: 60,
    recommendation: "ToReview",
    occurrenceCount: 1,
    evidence: [evidence("c3:known-first-name", "known-first-name", 20), evidence("c3:common-english-word", "common-english-word", -10)],
    assessment: undefined,
  })
);
check(
  "buildStandardSummary: positive-but-negative branch",
  positiveAndNegative,
  "Possibly a person's name because it matches a known first name, but it is also a common English word."
);

const neutralOnly = buildStandardSummary(
  buildExplanationContext({
    candidateId: "c4",
    entityType: "email",
    likelihood: 55,
    recommendation: "ToReview",
    occurrenceCount: 1,
    evidence: [evidence("c4:single-occurrence", "single-occurrence", 0)],
    assessment: undefined,
  })
);
check(
  "buildStandardSummary: neutral-only branch",
  neutralOnly,
  "Possibly an email address based on deterministic evidence: it appears only once in the document."
);

const noEvidence = buildStandardSummary(
  buildExplanationContext({
    candidateId: "c5",
    entityType: "phone",
    likelihood: 40,
    recommendation: "Unlikely",
    occurrenceCount: 1,
    evidence: [],
    assessment: undefined,
  })
);
check("buildStandardSummary: no-evidence branch", noEvidence, "Unlikely to be a phone number. No explanatory evidence was recorded.");

const truncatedToThree = buildStandardSummary(
  buildExplanationContext({
    candidateId: "c6",
    entityType: "person",
    likelihood: 99,
    recommendation: "ToReview",
    occurrenceCount: 5,
    evidence: [
      evidence("c6:known-first-name", "known-first-name", 20),
      evidence("c6:known-surname", "known-surname", 20),
      evidence("c6:strong-name-structure", "strong-name-structure", 15),
      evidence("c6:nearby-title", "nearby-title", 10),
    ],
    assessment: undefined,
  })
);
checkTrue(
  "buildStandardSummary: only the first 3 positive phrases are used, matching Python's [:3] slice",
  !truncatedToThree.includes("appears near a title") && truncatedToThree.includes("known first name")
);

// --- buildExplanationContext: disposition derivation ---
const withDecision = buildExplanationContext({
  candidateId: "c7",
  entityType: "person",
  likelihood: 90,
  recommendation: "ToReview",
  occurrenceCount: 1,
  evidence: [],
  assessment: undefined,
  existingDecision: "Keep",
});
check("buildExplanationContext: disposition reflects an existing decision", withDecision.disposition, "Resolved: Keep");

const withoutDecision = buildExplanationContext({
  candidateId: "c8",
  entityType: "person",
  likelihood: 20,
  recommendation: "Unlikely",
  occurrenceCount: 1,
  evidence: [],
  assessment: undefined,
});
check("buildExplanationContext: disposition falls back to recommendation label", withoutDecision.disposition, "Unlikely");

const withAssessmentFilterRules = buildExplanationContext({
  candidateId: "c9",
  entityType: "person",
  likelihood: 40,
  recommendation: "Unlikely",
  occurrenceCount: 1,
  evidence: [],
  assessment: {
    quality: "Unlikely",
    explanation: "raw scoring text",
    reasons: ["common-english-word", "known-first-name"],
    positiveReasons: ["known-first-name"],
    filterRules: ["common-english-word"],
  },
});
check(
  "buildExplanationContext: diagnosticCategories prefers filterRules over reasons (Python's `or` semantics)",
  withAssessmentFilterRules.diagnosticCategories,
  ["common-english-word"]
);
check("buildExplanationContext: rawScoringExplanation passthrough", withAssessmentFilterRules.rawScoringExplanation, "raw scoring text");

// --- buildExplanation / DeterministicExplanationEngine: per-view payload shape ---
const engine = new DeterministicExplanationEngine();
const richContext = buildExplanationContext({
  candidateId: "c10",
  entityType: "person",
  likelihood: 88,
  recommendation: "ToReview",
  occurrenceCount: 4,
  evidence: [evidence("c10:known-first-name", "known-first-name", 20), evidence("c10:common-english-word", "common-english-word", -10)],
  assessment: {
    quality: "Possible",
    explanation: "raw",
    reasons: ["known-first-name", "common-english-word"],
    positiveReasons: ["known-first-name"],
    filterRules: [],
  },
});

const standardView = engine.explain(richContext, "standard");
checkTrue("standard view has the right discriminant", standardView.view === "standard");
if (standardView.view === "standard") {
  check("standard view likelihood", standardView.likelihood, 88);
  check("standard view occurrenceCount", standardView.occurrenceCount, 4);
  checkTrue("standard view summary is non-empty prose", standardView.summary.length > 10);
}

const expertView = engine.explain(richContext, "expert");
checkTrue("expert view has the right discriminant", expertView.view === "expert");
if (expertView.view === "expert") {
  check("expert view splits evidence by polarity: 1 positive", expertView.positiveEvidence.length, 1);
  check("expert view splits evidence by polarity: 1 negative", expertView.negativeEvidence.length, 1);
  check("expert view splits evidence by polarity: 0 neutral", expertView.neutralEvidence.length, 0);
  check("expert view currentDisposition falls back to recommendation label", expertView.currentDisposition, "To Review");
  check("expert view diagnosticCategories passthrough", expertView.diagnosticCategories, ["known-first-name", "common-english-word"]);
}

const auditView = engine.explain(richContext, "audit");
checkTrue("audit view has the right discriminant", auditView.view === "audit");
if (auditView.view === "audit") {
  check("audit view positiveEvidence is plain expert-tier strings, not structured objects", auditView.positiveEvidence, ["Known first name"]);
  check("audit view negativeEvidence is plain expert-tier strings", auditView.negativeEvidence, ["Common English word"]);
  checkTrue("audit view carries no numeric weight fields", typeof auditView.positiveEvidence[0] === "string");
}

checkTrue(
  "buildExplanation never invents evidence beyond what the context carries",
  standardView.view === "standard" &&
    expertView.view === "expert" &&
    expertView.positiveEvidence.length + expertView.negativeEvidence.length + expertView.neutralEvidence.length === richContext.evidence.length
);

// --- groupReviewOccurrencesForCandidate: filters + groups using precomputed groupKind ---
function reviewOccurrence(candidateId: string, groupKind: ReviewOccurrence["groupKind"], match: string): ReviewOccurrence {
  return {
    occurrenceId: `${candidateId}:${groupKind}:${match}`,
    candidateId,
    detectedType: "person",
    blockId: "block-1",
    blockKind: "body",
    sourceRef: "word/document.xml",
    startOffset: 0,
    endOffset: match.length,
    groupKind,
    context: { before: "before ", match, after: " after" },
    detectorConfidence: "high",
    order: 0,
  };
}

// NOTE: classification.ts's own top doc comment confirms GROUP_ORDER only
// ever contains "standalone"/"contextual" in practice -- the other 6
// OccurrenceGroupKind values are aspirational type vocabulary with no
// implemented classification rule anywhere in the Python oracle. Test data
// below deliberately only uses the two real kinds, matching what a live
// OccurrenceClassifier could actually produce.
const mixedOccurrences: ReviewOccurrence[] = [
  reviewOccurrence("candidate-a", "standalone", "Jane Smith"),
  reviewOccurrence("candidate-a", "contextual", "J. Smith"),
  reviewOccurrence("candidate-b", "standalone", "Other Person"),
  reviewOccurrence("candidate-a", "standalone", "Jane Smith again"),
];

const groupedForA = groupReviewOccurrencesForCandidate("candidate-a", mixedOccurrences);
check(
  "groupReviewOccurrencesForCandidate: excludes other candidates' occurrences",
  groupedForA.reduce((sum, g) => sum + g.occurrenceCount, 0),
  3
);
check("groupReviewOccurrencesForCandidate: two buckets present (standalone, contextual)", groupedForA.length, 2);
check("groupReviewOccurrencesForCandidate: bucket order follows GROUP_ORDER (standalone before contextual)", groupedForA[0]?.kind, "standalone");
check("groupReviewOccurrencesForCandidate: standalone bucket has 2 occurrences", groupedForA.find((g) => g.kind === "standalone")?.occurrenceCount, 2);
check("groupReviewOccurrencesForCandidate: empty buckets are omitted, not returned as zero-count groups", groupReviewOccurrencesForCandidate("candidate-c", mixedOccurrences).length, 0);

// --- categoryRuleLabel: dictionary + fallback ---
check("categoryRuleLabel known entry", categoryRuleLabel("known-first-name"), "Known first name");
check("categoryRuleLabel known entry with slash", categoryRuleLabel("department-organization"), "Department / organization");
check("categoryRuleLabel unknown category falls back to title case", categoryRuleLabel("brand-new-rule-id"), "Brand New Rule Id");
// Regression check (found during Milestone 1 Phase 1 real-browser validation):
// CandidateQualityAssessment.reasons/filterRules are snake_case (Python's
// original rule ids), not kebab-case like Evidence.category -- Expert View's
// "Diagnostic Categories" rendered "Product_system_name" before
// categoryRuleLabel() normalized snake_case -> kebab-case internally.
check("categoryRuleLabel normalizes snake_case (assessment.reasons/filterRules) input", categoryRuleLabel("product_system_name"), "Product / system name");
check("categoryRuleLabel normalizes snake_case fallback too", categoryRuleLabel("brand_new_rule_id"), "Brand New Rule Id");

console.log(`${passed}/${passed + failed} checks passed`);
if (failed > 0) process.exit(1);
