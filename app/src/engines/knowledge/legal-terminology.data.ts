/**
 * legal-terminology.data.ts -- GENERATED. DO NOT HAND-EDIT.
 *
 * Regenerate with:
 *     python3 scripts/generate_domain_terminology_pack.py legal <csv>
 * Source CSV is versioned at investigation/data/docscrub_legal_terms.csv.
 *
 * SOURCE: the U.S. Courts/AO federal glossary, DOJ Justice 101, the Ninth
 * Circuit, federal bankruptcy courts, PACER/CM-ECF, N.D. Cal. ADR and
 * filing-under-seal terminology, the SEC, USPTO, FTC and EEOC, plus
 * California superior-court self-help glossaries. Cornell LII was
 * researched and REJECTED (noncommercial/share-alike licence), and no
 * commercial legal dictionary was scraped. Term labels and provenance
 * only; state-judiciary glossary definitions are explicitly not copied.
 *
 * CONTENT: 449 attestation rows over 445 distinct
 * normalized terms. 4 terms are attested by more than one row and every
 * such row is retained -- corroboration across independent source families is
 * evidence a future combination layer will want, and collapsing to a key set
 * would destroy it. 17 rows are mechanically derived variants rather
 * than direct source labels. Collision risk: LOW 250,
 * MEDIUM 118, HIGH 81.
 *
 * THE ONE CLAIM A MATCH LICENSES: "this phrase is attested legal terminology."
 * Not a semantic type, not a Keep, and NOT evidence of non-personhood --
 * `answer`, `brief`, `file`, `record`, `motion`, `counsel`,
 * `court`, `Doe`, `Judge` and `Levy` are all attested here AND are
 * ordinary English or Census-attested personal names.
 *
 * REPRESENTATION: `DomainReferencePackAsset` (see DomainReferenceEvidence.ts
 * for the column contract). Intern tables plus a TAB-separated row block,
 * sorted by normalized key then source order. Intern-table order is
 * load-bearing: regenerating with a different order invalidates every row.
 */

import type { DomainReferencePackAsset } from "./DomainReferenceEvidence.js";

export const LEGAL_SOURCE = "docscrub-legal-terminology/2026-08-10";
export const LEGAL_ROW_COUNT = 449;
export const LEGAL_TERM_COUNT = 445;

/** Pipe-separated hint combinations, verbatim from the source dataset.
 *  Index-addressed by row column 2. Order is load-bearing. */
const HINT_SETS: readonly string[] = [
  "AMBIGUOUS",
  "COURT_PROCEDURE",
  "COURT_PROCEDURE|LEGAL_CONCEPT",
  "COURT_PROCEDURE|PROCESS_EVENT",
  "DOCUMENT",
  "DOCUMENT|COURT_PROCEDURE",
  "DOCUMENT|LEGAL_CONCEPT",
  "DOCUMENT|OTHER_DOMAIN_TERM",
  "DOCUMENT|PROCESS_EVENT",
  "IDENTIFIER_TYPE",
  "LEGAL_CONCEPT",
  "LEGAL_CONCEPT|COURT_PROCEDURE",
  "LEGAL_CONCEPT|PROCESS_EVENT",
  "ORGANIZATION",
  "ORGANIZATION|LEGAL_CONCEPT",
  "ORGANIZATION|ROLE",
  "OTHER_DOMAIN_TERM",
  "PROCESS_EVENT",
  "PROCESS_EVENT|COURT_PROCEDURE",
  "PROCESS_EVENT|DOCUMENT",
  "PROCESS_EVENT|LEGAL_CONCEPT",
  "ROLE",
  "ROLE|LEGAL_CONCEPT",
  "ROLE|ORGANIZATION",
  "ROLE|OTHER_DOMAIN_TERM",
];

/** Index-addressed by row column 3. Index 0 is "" -- no sub-domain. */
const SUB_DOMAINS: readonly string[] = [
  "",
];

/** Index-addressed by row column 4: [name, url, family, authorityLevel]. */
const SOURCES: readonly (readonly [string, string, string, string])[] = [
  ["California Courts Self-Help — Civil Discovery", "https://selfhelp.courts.ca.gov/discovery-civil/request", "STATE_JUDICIARY_PROCEDURE", "HIGH"],
  ["California Courts Self-Help — Common Words in Probate Cases", "https://selfhelp.courts.ca.gov/probate/terms", "STATE_JUDICIARY_PROBATE", "HIGH"],
  ["Federal Trade Commission — Safeguards Rule Small Entity Compliance Guide", "https://www.ftc.gov/business-guidance/resources/ftc-safeguards-rule-what-your-business-needs-know", "FEDERAL_REGULATOR_PRIVACY_SECURITY", "HIGH"],
  ["PACER — Federal Court Records / CM/ECF FAQs", "https://pacer.uscourts.gov/help/faqs/what-cmecf", "FEDERAL_COURT_EFILING", "HIGH"],
  ["PACER — Notice of Electronic Filing / Notice of Docket Activity FAQ", "https://pacer.uscourts.gov/help/faqs/files-pleading-court-automatically-serve-notification", "FEDERAL_COURT_EFILING", "HIGH"],
  ["Superior Court of California, County of San Bernardino — Glossary of Civil Terms", "https://sanbernardino.courts.ca.gov/divisions/civil/glossary-civil-terms", "STATE_JUDICIARY_GLOSSARY", "HIGH"],
  ["U.S. Bankruptcy Court, District of Nevada — Bankruptcy Terminology", "https://www.nvb.uscourts.gov/filing/bankruptcy-basics/bankruptcy-terminology/", "FEDERAL_BANKRUPTCY_COURT", "HIGH"],
  ["U.S. Bankruptcy Court, Western District of Texas — Compensation of Professionals", "https://www.txwb.uscourts.gov/l-rule-2016-1-compensation-professionals", "FEDERAL_BANKRUPTCY_BILLING", "HIGH"],
  ["U.S. Court of Appeals for the Ninth Circuit — Glossary of Legal Terms", "https://www.ca9.uscourts.gov/guides-resources/glossary/", "FEDERAL_APPELLATE_COURT", "HIGH"],
  ["U.S. Courts — Glossary of Legal Terms", "https://www.uscourts.gov/glossary", "FEDERAL_JUDICIARY_GLOSSARY", "HIGH"],
  ["U.S. Department of Justice — Justice 101 Legal Terms Glossary", "https://www.justice.gov/usao/justice-101/glossary", "DOJ_GLOSSARY", "HIGH"],
  ["U.S. District Court, Northern District of California — E-Filing Case Documents", "https://cand.uscourts.gov/cases-e-filing/cmecf-information/e-filing-case-documents", "FEDERAL_DISTRICT_COURT_PROCEDURE", "HIGH"],
  ["U.S. District Court, Northern District of California — Mediation", "https://cand.uscourts.gov/about-court/court-programs-services/alternative-dispute-resolution-adr/mediation", "FEDERAL_DISTRICT_COURT_ADR", "HIGH"],
  ["U.S. District Court, Northern District of California — Settlement Conferences", "https://cand.uscourts.gov/about-court/court-programs-services/alternative-dispute-resolution-adr/settlement-conferences", "FEDERAL_DISTRICT_COURT_ADR", "HIGH"],
  ["U.S. Equal Employment Opportunity Commission — Small Business Glossary/Resources", "https://www.eeoc.gov/employers/small-business", "FEDERAL_REGULATOR_EMPLOYMENT", "HIGH"],
  ["U.S. Patent and Trademark Office — Glossary", "https://www.uspto.gov/learning-and-resources/glossary", "FEDERAL_REGULATOR_IP", "HIGH"],
  ["U.S. Securities and Exchange Commission — Small Business Capital Formation Glossary", "https://www.sec.gov/resources-small-businesses/glossary", "FEDERAL_REGULATOR_SECURITIES", "HIGH"],
];

/** Shared pool for the sparse columns (source ids, parent terms, acronyms,
 *  acronym expansions, notes). Index 0 is "". */
const STRINGS: readonly string[] = [
  "",
  "Administrative Office of the United States Courts (AO)",
  "Alternative dispute resolution (ADR)",
  "Business Development Company (BDC)",
  "California practice",
  "Case Management/Electronic Case Files (CM/ECF)",
  "Cross-Complaint",
  "Latin phrase",
  "Latin/ordinary phrase collision",
  "No-asset case",
  "Nolo contendere",
  "Nonexempt assets",
  "Notice of Docket Activity (NDA)",
  "Notice of Electronic Filing (NEF)",
  "Pro se",
  "Rural Business Investment Company (RBIC)",
  "Sister-State Judgment",
  "Temporary restraining order",
  "Trademark Trial and Appeal Board (TTAB)",
  "USPTO system",
  "accounting collision",
  "acronym collision",
  "administrative IP",
  "ambiguous professional title",
  "bankruptcy",
  "billing cross-domain",
  "business collision",
  "business/legal",
  "business/legal collision",
  "common business term",
  "computing collision",
  "computing/finance collision",
  "contains surname placeholder",
  "contract/IP",
  "criminal procedure",
  "cross-domain",
  "cross-domain compliance",
  "cross-domain finance/trust",
  "cross-domain financial term",
  "employment law",
  "employment/securities",
  "explicit alias in U.S. Courts definition",
  "federal e-filing system",
  "finance",
  "finance collision",
  "finance/accounting collision",
  "finance/business collision",
  "generic organizational title",
  "government title",
  "hyphen removal",
  "jurisdiction-specific",
  "language/ordinary collision",
  "legal billing",
  "legal billing/bankruptcy",
  "legal/business collision",
  "mechanical hyphen variant",
  "multiple independent source attestations",
  "notice of allowance (NOA) (trademarks)",
  "numeric/common-context collision",
  "ordinary English collision",
  "ordinary English; bankruptcy/contract sense",
  "ordinary complaint collision",
  "ordinary phrase",
  "ordinary phrase; patent claim transition",
  "ordinary verb collision",
  "ordinary/accounting collision",
  "ordinary/business collision",
  "ordinary/computing collision",
  "ordinary/cross-domain",
  "ordinary/cross-domain collision",
  "ordinary/employment collision",
  "ordinary/finance collision",
  "ordinary/finance/name collision",
  "ordinary/geographic collision",
  "ordinary/geographic/name collision",
  "ordinary/legal collision",
  "ordinary/name collision",
  "ordinary/name/title collision",
  "ordinary/professional collision",
  "parenthetical acronym removed",
  "patent",
  "patent prosecution",
  "placeholder surname; name evidence collision",
  "political/legal collision",
  "privacy law",
  "privacy/security",
  "punctuation variant",
  "securities",
  "securities-law section shorthand",
  "security/compliance cross-domain",
  "source heading",
  "standard abbreviation attested in source definition",
  "standard acronym from source form",
  "standard acronym; collides with nondisclosure agreement",
  "standard acronym; many nonlegal meanings",
  "standard of proof",
  "standard system acronym",
  "surname/ordinary collision",
  "surname/title collision",
  "technology collision",
  "trademark",
  "trust/business collision",
];

/** One line per attestation row, TAB-separated. Columns, in order:
 *  normalized, term, hintSetIdx, subDomainIdx, sourceIdx, sourceIdIdx,
 *  sourceAttested(0|1), derivedVariant(0|1), parentIdx, riskIdx,
 *  acronymIdx, acronymExpIdx, notesIdx */
const ROWS =
  "3(c)(1)\t3(c)(1)\t10\t0\t16\t0\t1\t0\t0\t1\t0\t0\t88\n3(c)(7)\t3(c)(7)\t10\t0\t16\t0\t1\t0\t0\t1\t0\t0\t88\n341 meeting\t341 meeting\t18\t0\t8\t0\t1\t0\t0\t0\t0\t0\t24\nabandoned application (trademarks)\tabandoned application (trademarks)\t10\t0\t15\t0\t1\t0\t0\t0\t0\t0\t0\nabandonment (patent)\tabandonment (patent)\t10\t0\t15\t0\t1\t0\t0\t1\t0\t0\t75\nabstract of judgment\tAbstract of Judgment\t4\t0\t5\t0\t1\t0\t0\t0\t0\t0\t0\nabstract of the disclosure\tabstract of the disclosure\t4\t0\t15\t0\t1\t0\t0\t0\t0\t0\t80\naccelerated filer\tAccelerated Filer\t22\t0\t16\t0\t1\t0\t0\t0\t0\t0\t0\naccelerator\tAccelerator\t13\t0\t16\t0\t1\t0\t0\t2\t0\t0\t66\naccounts payable\tAccounts Payable\t16\t0\t16\t0\t1\t0\t0\t2\t0\t0\t45\naccounts receivable\tAccounts Receivable\t16\t0\t16\t0\t1\t0\t0\t2\t0\t0\t45\nacquittal\tAcquittal\t17\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nactive judge\tactive judge\t21\t0\t8\t0\t1\t0\t0\t1\t0\t0\t0\nadministrative law judge\tAdministrative law judge\t21\t0\t9\t0\t1\t0\t0\t1\t0\t0\t0\nadministrative motion to file under seal\tAdministrative Motion to File Under Seal\t5\t0\t11\t0\t1\t0\t0\t0\t0\t0\t0\nadministrative office of the united states courts (ao)\tAdministrative Office of the United States Courts (AO)\t13\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nadmissible\tAdmissible\t10\t0\t9\t0\t1\t0\t0\t1\t0\t0\t59\nadr\tADR\t10\t0\t9\t0\t0\t1\t2\t2\t0\t0\t92\nadversary proceeding\tAdversary proceeding\t1\t0\t9\t0\t1\t0\t0\t0\t0\t0\t24\nadverse employment action\tadverse employment action\t10\t0\t14\t0\t1\t0\t0\t0\t0\t0\t39\naffidavit\tAffidavit\t4\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\naffirmed\tAffirmed\t17\t0\t9\t0\t1\t0\t0\t1\t0\t0\t59\nalford plea\tAlford plea\t2\t0\t10\t0\t1\t0\t0\t0\t0\t0\t34\nallegation\tallegation\t10\t0\t10\t0\t1\t0\t0\t1\t0\t0\t59\nalternate juror\tAlternate juror\t21\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nalternative dispute resolution\talternative dispute resolution\t12\t0\t9\t0\t0\t1\t2\t0\t0\t0\t79\nalternative dispute resolution (adr)\tAlternative dispute resolution (ADR)\t20\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\namend\tAmend\t1\t0\t5\t0\t1\t0\t0\t2\t0\t0\t64\namended vs. amendment\tAmended vs. Amendment\t10\t0\t5\t0\t1\t0\t0\t1\t0\t0\t90\namicus curiae\tAmicus curiae\t22\t0\t9\t0\t1\t0\t0\t0\t0\t0\t7\nanswer\tAnswer\t5\t0\t9\t0\t1\t0\t0\t2\t0\t0\t59\nao\tAO\t13\t0\t9\t0\t0\t1\t1\t2\t0\t0\t92\nappeal\tAppeal\t1\t0\t9\t0\t1\t0\t0\t1\t0\t0\t59\nappeal (trademarks)\tappeal (trademarks)\t1\t0\t15\t0\t1\t0\t0\t0\t0\t0\t22\nappellant\tAppellant\t21\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nappellate\tAppellate\t10\t0\t9\t0\t1\t0\t0\t1\t0\t0\t0\nappellee\tAppellee\t21\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\napplication filing date (trademarks)\tapplication filing date (trademarks)\t9\t0\t15\t0\t1\t0\t0\t0\t0\t0\t0\napplication number (us) (patent)\tApplication number (US) (patent)\t9\t0\t15\t0\t1\t0\t0\t0\t0\t0\t0\narbitrary trademarks\tarbitrary trademarks\t10\t0\t15\t0\t1\t0\t0\t0\t0\t0\t0\narbitration\tArbitration\t17\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\narbitrator\tarbitrator\t21\t0\t12\t0\t1\t0\t0\t0\t0\t0\t0\narraignment\tArraignment\t3\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\narrest warrant\tarrest warrant\t5\t0\t10\t0\t1\t0\t0\t0\t0\t0\t0\narticle iii judge\tArticle III judge\t21\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nasset or no asset cases\tAsset or No Asset Cases\t10\t0\t6\t0\t1\t0\t0\t0\t0\t0\t0\nassets\tAssets\t10\t0\t9\t0\t1\t0\t0\t2\t0\t0\t38\nassignee\tassignee\t21\t0\t15\t0\t1\t0\t0\t1\t0\t0\t33\nassignment (patent)\tassignment (patent)\t6\t0\t15\t0\t1\t0\t0\t1\t0\t0\t0\nassignment (trademarks)\tassignment (trademarks)\t6\t0\t15\t0\t1\t0\t0\t1\t0\t0\t0\nassignment center\tAssignment Center\t16\t0\t15\t0\t1\t0\t0\t1\t0\t0\t19\nassume\tAssume\t10\t0\t9\t0\t1\t0\t0\t2\t0\t0\t60\nauthorized user\tAuthorized user\t21\t0\t2\t0\t1\t0\t0\t2\t0\t0\t30\nautomatic stay\tAutomatic stay\t2\t0\t9\t0\t1\t0\t0\t0\t0\t0\t24\nbail\tBail\t10\t0\t9\t0\t1\t0\t0\t1\t0\t0\t0\nbankruptcy\tBankruptcy\t20\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nbankruptcy administrator\tBankruptcy administrator\t21\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nbankruptcy code\tBankruptcy code\t6\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nbankruptcy court\tBankruptcy court\t13\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nbankruptcy estate\tBankruptcy estate\t10\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nbankruptcy judge\tBankruptcy judge\t21\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nbankruptcy petition\tBankruptcy petition\t5\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nbankruptcy trustee\tbankruptcy trustee\t21\t0\t8\t0\t1\t0\t0\t0\t0\t0\t0\nbdc\tBDC\t14\t0\t16\t0\t0\t1\t3\t2\t0\t0\t92\nbench trial\tBench trial\t18\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nbeneficiary\tBeneficiary\t21\t0\t1\t0\t1\t0\t0\t1\t0\t0\t37\nbeyond a reasonable doubt\tbeyond a reasonable doubt\t10\t0\t10\t0\t1\t0\t0\t0\t0\t0\t95\nbinding precedent\tbinding precedent\t10\t0\t10\t0\t1\t0\t0\t0\t0\t0\t0\nblocked account\tBlocked Account\t10\t0\t5\t0\t1\t0\t0\t1\t0\t0\t0\nblue sky laws\tBlue Sky Laws\t10\t0\t16\t0\t1\t0\t0\t0\t0\t0\t0\nbreach notification requirements\tbreach notification requirements\t10\t0\t2\t0\t1\t0\t0\t0\t0\t0\t85\nbrief\tBrief\t4\t0\t9\t0\t1\t0\t0\t2\t0\t0\t59\nburden of proof\tBurden of proof\t10\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nburn rate\tBurn Rate\t16\t0\t16\t0\t1\t0\t0\t2\t0\t0\t26\nbusiness bankruptcy\tBusiness bankruptcy\t12\t0\t9\t0\t1\t0\t0\t0\t0\t0\t56\nbusiness bankruptcy\tBusiness bankruptcy\t12\t0\t8\t0\t1\t0\t0\t0\t0\t0\t56\nbusiness development company (bdc)\tBusiness Development Company (BDC)\t14\t0\t16\t0\t1\t0\t0\t0\t0\t0\t0\nbypass continuing application\tbypass continuing application\t6\t0\t15\t0\t1\t0\t0\t0\t0\t0\t0\ncanceled claim (patent)\tcanceled claim (patent)\t10\t0\t15\t0\t1\t0\t0\t0\t0\t0\t0\ncanceled registration\tcanceled registration\t10\t0\t15\t0\t1\t0\t0\t0\t0\t0\t0\ncancellation proceeding\tcancellation proceeding\t3\t0\t15\t0\t1\t0\t0\t0\t0\t0\t0\ncapital offense\tCapital offense\t10\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\ncapitalization table\tCapitalization Table\t4\t0\t16\t0\t1\t0\t0\t0\t0\t0\t0\ncase ancillary to a foreign proceeding\tCase ancillary to a foreign proceeding\t1\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\ncase file\tCase file\t4\t0\t9\t0\t1\t0\t0\t1\t0\t0\t0\ncase information\tcase information\t16\t0\t3\t0\t1\t0\t0\t2\t0\t0\t62\ncase law\tCase law\t10\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\ncase management/electronic case files (cm/ecf)\tCase Management/Electronic Case Files (CM/ECF)\t16\t0\t3\t0\t1\t0\t0\t0\t0\t0\t42\ncaseload\tCaseload\t16\t0\t9\t0\t1\t0\t0\t1\t0\t0\t0\ncause of action\tCause of action\t10\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\ncertificate of assignment\tCertificate of Assignment\t4\t0\t5\t0\t1\t0\t0\t0\t0\t0\t0\nchambers\tChambers\t16\t0\t9\t0\t1\t0\t0\t2\t0\t0\t74\nchapter 11\tChapter 11\t10\t0\t9\t0\t1\t0\t0\t1\t0\t0\t0\nchapter 12\tChapter 12\t10\t0\t9\t0\t1\t0\t0\t1\t0\t0\t0\nchapter 13\tChapter 13\t10\t0\t9\t0\t1\t0\t0\t1\t0\t0\t0\nchapter 13 trustee\tChapter 13 trustee\t21\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nchapter 15\tChapter 15\t10\t0\t9\t0\t1\t0\t0\t1\t0\t0\t0\nchapter 7\tChapter 7\t10\t0\t9\t0\t1\t0\t0\t1\t0\t0\t58\nchapter 7 trustee\tChapter 7 trustee\t21\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nchapter 9\tChapter 9\t10\t0\t9\t0\t1\t0\t0\t1\t0\t0\t0\ncharge of discrimination\tcharge of discrimination\t8\t0\t14\t0\t1\t0\t0\t0\t0\t0\t39\nchief judge\tChief judge\t21\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\ncircuit executive\tCircuit Executive\t21\t0\t9\t0\t1\t0\t0\t1\t0\t0\t23\ncivil case\tCivil Case\t10\t0\t5\t0\t1\t0\t0\t1\t0\t0\t0\ncivil case cover sheet\tCivil Case Cover Sheet\t4\t0\t5\t0\t1\t0\t0\t0\t0\t0\t0\nclaim\tClaim\t10\t0\t9\t0\t1\t0\t0\t2\t0\t0\t78\nclass action\tClass action\t2\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nclerk of court\tClerk of court\t21\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\ncm/ecf\tCM/ECF\t16\t0\t3\t0\t0\t1\t5\t1\t0\t0\t96\ncommon stock\tCommon Stock\t10\t0\t16\t0\t1\t0\t0\t1\t0\t0\t44\ncomplaint\tComplaint\t5\t0\t5\t0\t1\t0\t0\t1\t0\t0\t61\ncomplaint in intervention\tComplaint in Intervention\t5\t0\t5\t0\t1\t0\t0\t0\t0\t0\t0\nconcurrent sentence\tConcurrent sentence\t10\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nconfirmation\tConfirmation\t17\t0\t9\t0\t1\t0\t0\t2\t0\t0\t69\nconflicting trademark\tconflicting trademark\t10\t0\t15\t0\t1\t0\t0\t0\t0\t0\t0\nconsecutive sentence\tConsecutive sentence\t10\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nconsent decree\tconsent decree\t6\t0\t12\t0\t1\t0\t0\t0\t0\t0\t0\nconsisting of\tconsisting of\t10\t0\t15\t0\t1\t0\t0\t2\t0\t0\t63\nconsumer bankruptcy\tConsumer bankruptcy\t10\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nconsumer debtor\tConsumer debtor\t22\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nconsumer debts\tConsumer debts\t10\t0\t9\t0\t1\t0\t0\t1\t0\t0\t0\ncontested matter\tContested matter\t1\t0\t9\t0\t1\t0\t0\t0\t0\t0\t24\ncontingent claim\tContingent claim\t10\t0\t9\t0\t1\t0\t0\t1\t0\t0\t0\ncontinuation\tcontinuation\t10\t0\t15\t0\t1\t0\t0\t2\t0\t0\t59\ncontract\tContract\t6\t0\t9\t0\t1\t0\t0\t1\t0\t0\t29\nconviction\tConviction\t20\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\ncoordination\tCoordination\t1\t0\t5\t0\t1\t0\t0\t2\t0\t0\t69\ncosts\tCosts\t10\t0\t5\t0\t1\t0\t0\t2\t0\t0\t66\ncounsel\tCounsel\t21\t0\t9\t0\t1\t0\t0\t2\t0\t0\t77\ncount\tCount\t10\t0\t9\t0\t1\t0\t0\t2\t0\t0\t59\ncourt\tCourt\t13\t0\t9\t0\t1\t0\t0\t2\t0\t0\t76\ncourt of international trade\tCourt of International Trade\t13\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\ncourt reporter\tCourt reporter\t21\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\ncredit counseling\tCredit counseling\t17\t0\t9\t0\t1\t0\t0\t1\t0\t0\t35\ncreditor\tCreditor\t22\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\ncreditor matrix\tCreditor Matrix\t4\t0\t6\t0\t1\t0\t0\t0\t0\t0\t0\ncreditor's meeting (also known as 341 meeting)\tCreditor's Meeting (also known as 341 Meeting)\t18\t0\t6\t0\t1\t0\t0\t0\t0\t0\t0\ncross complaint\tcross complaint\t5\t0\t5\t0\t0\t1\t6\t0\t0\t0\t49\ncross-complaint\tCross-Complaint\t5\t0\t5\t0\t1\t0\t0\t0\t0\t0\t0\ncustomer information\tcustomer information\t10\t0\t2\t0\t1\t0\t0\t2\t0\t0\t68\ndamages\tDamages\t10\t0\t9\t0\t1\t0\t0\t1\t0\t0\t59\nde facto\tDe facto\t10\t0\t9\t0\t1\t0\t0\t1\t0\t0\t7\nde jure\tDe jure\t10\t0\t9\t0\t1\t0\t0\t0\t0\t0\t7\nde novo\tDe novo\t2\t0\t9\t0\t1\t0\t0\t0\t0\t0\t7\ndead application or registration\tdead application or registration\t10\t0\t15\t0\t1\t0\t0\t0\t0\t0\t0\ndebtor\tDebtor\t22\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\ndecedent\tDecedent\t22\t0\t1\t0\t1\t0\t0\t0\t0\t0\t0\ndecedent's estate\tDecedent's estate\t10\t0\t1\t0\t1\t0\t0\t0\t0\t0\t0\ndeclaratory judgment\tDeclaratory judgment\t6\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\ndefault\tDefault\t10\t0\t5\t0\t1\t0\t0\t2\t0\t0\t31\ndefault judgment\tDefault judgment\t5\t0\t9\t0\t1\t0\t0\t0\t0\t0\t56\ndefault judgment\tDefault judgment\t5\t0\t5\t0\t1\t0\t0\t0\t0\t0\t56\ndefendant\tDefendant\t21\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\ndelay reduction\tDelay Reduction\t1\t0\t5\t0\t1\t0\t0\t1\t0\t0\t0\ndemand for inspection\tDemand for Inspection\t5\t0\t0\t0\t1\t0\t0\t0\t0\t0\t0\ndemurrer\tDemurrer\t5\t0\t5\t0\t1\t0\t0\t0\t0\t0\t50\ndeposition\tDeposition\t20\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\ndigital security\tDigital Security\t10\t0\t16\t0\t1\t0\t0\t2\t0\t0\t99\ndigital tool\tDigital Tool\t16\t0\t16\t0\t1\t0\t0\t2\t0\t0\t99\ndilution\tDilution\t10\t0\t16\t0\t1\t0\t0\t2\t0\t0\t71\ndischarge\tDischarge\t20\t0\t9\t0\t1\t0\t0\t2\t0\t0\t69\ndischargeable debt\tDischargeable debt\t10\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\ndisclosure\tDisclosure\t20\t0\t16\t0\t1\t0\t0\t2\t0\t0\t75\ndisclosure of compensation\tdisclosure of compensation\t6\t0\t7\t0\t1\t0\t0\t0\t0\t0\t52\ndisclosure statement\tDisclosure statement\t4\t0\t9\t0\t1\t0\t0\t1\t0\t0\t35\ndiscovery\tDiscovery\t20\t0\t9\t0\t1\t0\t0\t2\t0\t0\t59\ndiscovery request\tdiscovery request\t5\t0\t0\t0\t1\t0\t0\t1\t0\t0\t0\ndiscrimination\tdiscrimination\t10\t0\t14\t0\t1\t0\t0\t1\t0\t0\t68\ndismiss or dismissal\tDismiss or Dismissal\t1\t0\t5\t0\t1\t0\t0\t1\t0\t0\t0\ndismissal with prejudice\tDismissal with prejudice\t1\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\ndismissal without prejudice\tDismissal without prejudice\t1\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\ndisposable income\tDisposable income\t10\t0\t9\t0\t1\t0\t0\t1\t0\t0\t35\ndisposition\tDisposition\t17\t0\t5\t0\t1\t0\t0\t2\t0\t0\t69\ndistrict judge\tdistrict judge\t21\t0\t13\t0\t1\t0\t0\t0\t0\t0\t0\ndiversification\tDiversification\t16\t0\t16\t0\t1\t0\t0\t2\t0\t0\t44\ndocket\tDocket\t7\t0\t9\t0\t1\t0\t0\t1\t0\t0\t0\ndocket entry\tdocket entry\t7\t0\t4\t0\t1\t0\t0\t1\t0\t0\t0\ndoe\tDoe\t0\t0\t5\t0\t1\t0\t0\t2\t0\t0\t82\ndoe amendment\tDoe Amendment\t5\t0\t5\t0\t1\t0\t0\t2\t0\t0\t32\ndue diligence\tDue Diligence\t20\t0\t16\t0\t1\t0\t0\t1\t0\t0\t28\ndue process\tDue process\t10\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nelectronic document stamp\telectronic document stamp\t9\t0\t4\t0\t1\t0\t0\t0\t0\t0\t0\nelectronic filing\telectronic filing\t17\t0\t3\t0\t1\t0\t0\t1\t0\t0\t35\neminent domain\tEminent Domain\t10\t0\t5\t0\t1\t0\t0\t0\t0\t0\t0\nen banc\tEn banc\t1\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nencryption\tEncryption\t16\t0\t2\t0\t1\t0\t0\t1\t0\t0\t99\nequitable\tEquitable\t10\t0\t9\t0\t1\t0\t0\t2\t0\t0\t59\nequitable relief\tequitable relief\t10\t0\t12\t0\t1\t0\t0\t0\t0\t0\t0\nequity\tEquity\t10\t0\t9\t0\t1\t0\t0\t2\t0\t0\t46\nevidence\tEvidence\t10\t0\t9\t0\t1\t0\t0\t1\t0\t0\t59\nex parte\tEx parte\t2\t0\t9\t0\t1\t0\t0\t0\t0\t0\t7\nexclusionary rule\tExclusionary rule\t10\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nexculpatory evidence\tExculpatory evidence\t10\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nexecutor\tExecutor\t21\t0\t1\t0\t1\t0\t0\t1\t0\t0\t30\nexecutory contracts\tExecutory contracts\t10\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nexempt assets\tExempt assets\t10\t0\t9\t0\t1\t0\t0\t1\t0\t0\t0\nexemptions, exempt property\tExemptions, exempt property\t10\t0\t9\t0\t1\t0\t0\t1\t0\t0\t56\nexemptions, exempt property\tExemptions, exempt property\t10\t0\t6\t0\t1\t0\t0\t1\t0\t0\t56\nexpired registration\texpired registration\t10\t0\t15\t0\t1\t0\t0\t0\t0\t0\t0\nfamily farmer\tFamily farmer\t10\t0\t9\t0\t1\t0\t0\t1\t0\t0\t62\n" +
  "federal public defender\tFederal public defender\t21\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nfederal public defender organization\tFederal public defender organization\t13\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nfederal question jurisdiction\tFederal question jurisdiction\t10\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nfelony\tFelony\t10\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nfile\tFile\t19\t0\t9\t0\t1\t0\t0\t2\t0\t0\t67\nfiled under seal\tfiled under seal\t1\t0\t11\t0\t1\t0\t0\t0\t0\t0\t0\nfiling basis\tfiling basis\t10\t0\t15\t0\t1\t0\t0\t1\t0\t0\t0\nfinancial institution\tFinancial institution\t14\t0\t2\t0\t1\t0\t0\t1\t0\t0\t44\nfinancial management\tFinancial management\t17\t0\t9\t0\t1\t0\t0\t2\t0\t0\t35\nfixed fee\tfixed fee\t10\t0\t7\t0\t1\t0\t0\t1\t0\t0\t25\nforeign trademark application\tforeign trademark application\t4\t0\t15\t0\t1\t0\t0\t0\t0\t0\t0\nforeign trademark registration\tforeign trademark registration\t4\t0\t15\t0\t1\t0\t0\t0\t0\t0\t0\nfund of funds\tFund of Funds\t14\t0\t16\t0\t1\t0\t0\t0\t0\t0\t0\ngeneral denial\tGeneral Denial\t5\t0\t5\t0\t1\t0\t0\t1\t0\t0\t0\ngeneral partner\tGeneral Partner\t21\t0\t16\t0\t1\t0\t0\t1\t0\t0\t27\ngeneral solicitation\tGeneral Solicitation\t10\t0\t16\t0\t1\t0\t0\t0\t0\t0\t87\ngoodwill\tGoodwill\t16\t0\t16\t0\t1\t0\t0\t2\t0\t0\t65\nguardian ad litem\tGuardian ad Litem\t21\t0\t5\t0\t1\t0\t0\t0\t0\t0\t0\nharassment\tHarassment\t10\t0\t5\t0\t1\t0\t0\t2\t0\t0\t70\nhedge fund\tHedge Fund\t14\t0\t16\t0\t1\t0\t0\t1\t0\t0\t0\nheir\tHeir\t22\t0\t1\t0\t1\t0\t0\t1\t0\t0\t0\nhourly basis\thourly basis\t16\t0\t7\t0\t1\t0\t0\t1\t0\t0\t25\nimpeachment\tImpeachment\t20\t0\t9\t0\t1\t0\t0\t1\t0\t0\t83\nin camera\tIn camera\t1\t0\t9\t0\t1\t0\t0\t1\t0\t0\t8\nin forma pauperis\tIn forma pauperis\t1\t0\t9\t0\t1\t0\t0\t0\t0\t0\t7\ninculpatory evidence\tInculpatory evidence\t10\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nindictment\tIndictment\t5\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\ninformation\tInformation\t5\t0\t9\t0\t1\t0\t0\t2\t0\t0\t59\ninformation security program\tinformation security program\t10\t0\t2\t0\t1\t0\t0\t1\t0\t0\t89\ninformation system\tInformation system\t16\t0\t2\t0\t1\t0\t0\t2\t0\t0\t99\ninjunction\tInjunction\t6\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\ninsider (bankruptcy)\tInsider (bankruptcy)\t22\t0\t9\t0\t1\t0\t0\t1\t0\t0\t35\nintent to use in commerce\tintent to use in commerce\t10\t0\t15\t0\t1\t0\t0\t0\t0\t0\t100\ninternational registration\tinternational registration\t6\t0\t15\t0\t1\t0\t0\t1\t0\t0\t0\ninterrogatories\tInterrogatories\t5\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nissue\tIssue\t10\t0\t9\t0\t1\t0\t0\t2\t0\t0\t59\nissued and outstanding shares\tIssued and Outstanding Shares\t10\t0\t16\t0\t1\t0\t0\t0\t0\t0\t0\njoinder\tJoinder\t2\t0\t5\t0\t1\t0\t0\t0\t0\t0\t0\njoint administration\tJoint administration\t1\t0\t9\t0\t1\t0\t0\t1\t0\t0\t0\njoint petition\tJoint petition\t5\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\njudge\tJudge\t21\t0\t9\t0\t1\t0\t0\t2\t0\t0\t98\njudgeship\tJudgeship\t21\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\njudgment\tJudgment\t8\t0\t9\t0\t1\t0\t0\t1\t0\t0\t59\njudicial conference of the united states\tJudicial Conference of the United States\t13\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\njudicial council\tJudicial Council\t13\t0\t5\t0\t1\t0\t0\t1\t0\t0\t47\njurisdiction\tJurisdiction\t10\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\njurisprudence\tJurisprudence\t10\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\njury\tJury\t22\t0\t9\t0\t1\t0\t0\t1\t0\t0\t0\njury instructions\tJury instructions\t5\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nlarge accelerated filer\tLarge Accelerated Filer\t22\t0\t16\t0\t1\t0\t0\t0\t0\t0\t0\nlaw and motion\tLaw and Motion\t1\t0\t5\t0\t1\t0\t0\t0\t0\t0\t4\nlawsuit\tLawsuit\t17\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nleave of court\tLeave of Court\t1\t0\t5\t0\t1\t0\t0\t0\t0\t0\t0\nlevy\tLevy\t2\t0\t5\t0\t1\t0\t0\t2\t0\t0\t97\nlien\tLien\t10\t0\t9\t0\t1\t0\t0\t1\t0\t0\t0\nlimited partner\tLimited Partner\t21\t0\t16\t0\t1\t0\t0\t1\t0\t0\t27\nliquidated claim\tLiquidated claim\t10\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nliquidation\tLiquidation\t20\t0\t9\t0\t1\t0\t0\t1\t0\t0\t44\nliquidation preference\tLiquidation Preference\t10\t0\t16\t0\t1\t0\t0\t0\t0\t0\t0\nliquidity\tLiquidity\t16\t0\t16\t0\t1\t0\t0\t2\t0\t0\t44\nlis pendens\tLis Pendens\t6\t0\t5\t0\t1\t0\t0\t0\t0\t0\t7\nlitigation\tLitigation\t20\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nlong-term assets\tLong-Term Assets\t16\t0\t16\t0\t1\t0\t0\t2\t0\t0\t20\nmagistrate judge\tMagistrate judge\t21\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nmeans test\tMeans test\t2\t0\t9\t0\t1\t0\t0\t1\t0\t0\t35\nmediation\tMediation\t17\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nmediator\tmediator\t21\t0\t12\t0\t1\t0\t0\t0\t0\t0\t0\nmisdemeanor\tMisdemeanor\t10\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nmistrial\tMistrial\t17\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nmoot\tMoot\t10\t0\t9\t0\t1\t0\t0\t2\t0\t0\t59\nmotion\tMotion\t5\t0\t9\t0\t1\t0\t0\t2\t0\t0\t59\nmotion for new trial\tMotion for New Trial\t5\t0\t5\t0\t1\t0\t0\t0\t0\t0\t0\nmotion for summary judgment\tMotion for Summary Judgment\t5\t0\t5\t0\t1\t0\t0\t0\t0\t0\t0\nmotion in limine\tMotion in Limine\t5\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nmotion to lift automatic stay\tMotion to Lift Automatic Stay\t5\t0\t6\t0\t1\t0\t0\t0\t0\t0\t0\nmotion to lift the automatic stay\tMotion to lift the automatic stay\t5\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nmotion to strike\tMotion to Strike\t5\t0\t5\t0\t1\t0\t0\t0\t0\t0\t0\nmulti-factor authentication\tMulti-factor authentication\t16\t0\t2\t0\t1\t0\t0\t1\t0\t0\t99\nnda\tNDA\t4\t0\t4\t0\t0\t1\t12\t2\t0\t0\t93\nnef\tNEF\t4\t0\t4\t0\t0\t1\t13\t2\t0\t0\t92\nneutral\tneutral\t21\t0\t12\t0\t1\t0\t0\t2\t0\t0\t59\nno asset case\tno asset case\t10\t0\t9\t0\t0\t1\t9\t0\t0\t0\t49\nno contest\tno contest\t11\t0\t9\t0\t0\t1\t10\t1\t0\t0\t41\nno-asset case\tNo-asset case\t10\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nnoa\tNOA\t4\t0\t15\t0\t0\t1\t57\t2\t0\t0\t94\nnolo contendere\tNolo contendere\t2\t0\t9\t0\t1\t0\t0\t0\t0\t0\t7\nnon-exempt assets\tnon-exempt assets\t10\t0\t9\t0\t0\t1\t11\t0\t0\t0\t55\nnondischargeable debt\tNondischargeable debt\t10\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nnonexempt assets\tNonexempt assets\t10\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nnonfinal office action\tnonfinal office action\t8\t0\t15\t0\t1\t0\t0\t0\t0\t0\t0\nnonpublic personal information\tnonpublic personal information\t10\t0\t2\t0\t1\t0\t0\t0\t0\t0\t84\nnotice of abandonment\tnotice of abandonment\t4\t0\t15\t0\t1\t0\t0\t0\t0\t0\t0\nnotice of abandonment (patent)\tnotice of abandonment (patent)\t4\t0\t15\t0\t1\t0\t0\t0\t0\t0\t0\nnotice of allowability\tnotice of allowability\t4\t0\t15\t0\t1\t0\t0\t0\t0\t0\t80\nnotice of allowance (noa) (trademarks)\tnotice of allowance (NOA) (trademarks)\t4\t0\t15\t0\t1\t0\t0\t0\t0\t0\t0\nnotice of allowance (patent)\tnotice of allowance (patent)\t4\t0\t15\t0\t1\t0\t0\t0\t0\t0\t0\nnotice of docket activity (nda)\tNotice of Docket Activity (NDA)\t4\t0\t4\t0\t1\t0\t0\t0\t0\t0\t0\nnotice of electronic filing (nef)\tNotice of Electronic Filing (NEF)\t4\t0\t4\t0\t1\t0\t0\t0\t0\t0\t0\nnotification event\tnotification event\t20\t0\t2\t0\t1\t0\t0\t1\t0\t0\t0\nobjection to discharge\tObjection to discharge\t5\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nobjection to dischargeability\tObjection to dischargeability\t5\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nobjection to exemptions\tObjection to exemptions\t5\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nopinion\tOpinion\t4\t0\t9\t0\t1\t0\t0\t2\t0\t0\t59\noral argument\tOral argument\t18\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\norap\tORAP\t1\t0\t5\t0\t1\t0\t0\t2\t0\t0\t21\npanel\tPanel\t24\t0\t9\t0\t1\t0\t0\t2\t0\t0\t78\nparole\tParole\t20\t0\t9\t0\t1\t0\t0\t1\t0\t0\t0\npatent applicant\tpatent applicant\t21\t0\t15\t0\t1\t0\t0\t0\t0\t0\t0\npatent application\tpatent application\t4\t0\t15\t0\t1\t0\t0\t0\t0\t0\t0\npersonal service\tPersonal Service\t1\t0\t5\t0\t1\t0\t0\t1\t0\t0\t62\npetition\tPetition\t5\t0\t5\t0\t1\t0\t0\t1\t0\t0\t0\npetition date\tpetition date\t9\t0\t7\t0\t1\t0\t0\t1\t0\t0\t24\npetitioner\tPetitioner\t21\t0\t5\t0\t1\t0\t0\t0\t0\t0\t0\nphysical evidence\tphysical evidence\t10\t0\t0\t0\t1\t0\t0\t1\t0\t0\t0\nplaintiff\tPlaintiff\t21\t0\t5\t0\t1\t0\t0\t0\t0\t0\t0\nplea bargain\tplea bargain\t12\t0\t10\t0\t1\t0\t0\t0\t0\t0\t0\npoints and authorities\tPoints and Authorities\t4\t0\t5\t0\t1\t0\t0\t0\t0\t0\t0\nportfolio company\tPortfolio Company\t14\t0\t16\t0\t1\t0\t0\t1\t0\t0\t0\npreferred stock\tPreferred Stock\t10\t0\t16\t0\t1\t0\t0\t1\t0\t0\t44\nprepetition retainer\tprepetition retainer\t10\t0\t7\t0\t1\t0\t0\t0\t0\t0\t53\npresiding judge\tpresiding judge\t21\t0\t13\t0\t1\t0\t0\t0\t0\t0\t0\npretrial conference\tPretrial conference\t18\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\npretrial services\tPretrial services\t16\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\npriority\tPriority\t10\t0\t9\t0\t1\t0\t0\t2\t0\t0\t69\npriority claim\tPriority claim\t10\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nprivate equity fund\tPrivate Equity Fund\t14\t0\t16\t0\t1\t0\t0\t1\t0\t0\t0\nprivate fund\tPrivate Fund\t14\t0\t16\t0\t1\t0\t0\t1\t0\t0\t0\nprivate offering\tPrivate Offering\t20\t0\t16\t0\t1\t0\t0\t0\t0\t0\t0\npro se\tPro se\t22\t0\t9\t0\t1\t0\t0\t0\t0\t0\t7\npro tem\tPro tem\t22\t0\t9\t0\t1\t0\t0\t1\t0\t0\t7\npro-se\tpro-se\t22\t0\t9\t0\t0\t1\t14\t1\t0\t0\t86\nprobable cause\tprobable cause\t10\t0\t10\t0\t1\t0\t0\t0\t0\t0\t0\nprobate\tprobate\t20\t0\t1\t0\t1\t0\t0\t0\t0\t0\t0\nprobation\tProbation\t20\t0\t9\t0\t1\t0\t0\t1\t0\t0\t0\nprobation officer\tProbation officer\t21\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nprocedure\tProcedure\t10\t0\t9\t0\t1\t0\t0\t2\t0\t0\t69\nproof of claim\tProof of claim\t5\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nproperty of the estate\tProperty of the estate\t10\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nproposed order\tProposed Order\t4\t0\t11\t0\t1\t0\t0\t0\t0\t0\t0\nprosecute\tProsecute\t17\t0\t9\t0\t1\t0\t0\t1\t0\t0\t64\nprosecutor\tprosecutor\t21\t0\t10\t0\t1\t0\t0\t0\t0\t0\t0\nprotected characteristic\tprotected characteristic\t10\t0\t14\t0\t1\t0\t0\t0\t0\t0\t39\npublic docket\tpublic docket\t16\t0\t11\t0\t1\t0\t0\t1\t0\t0\t0\nquash\tQuash\t1\t0\t5\t0\t1\t0\t0\t1\t0\t0\t64\nrbic\tRBIC\t14\t0\t16\t0\t0\t1\t15\t2\t0\t0\t92\nreaffirmation agreement\tReaffirmation agreement\t6\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nreasonable accommodation\treasonable accommodation\t10\t0\t14\t0\t1\t0\t0\t0\t0\t0\t39\nrecalled judge\tRecalled judge\t21\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nrecord\tRecord\t4\t0\t9\t0\t1\t0\t0\t2\t0\t0\t69\nredacted version\tredacted version\t4\t0\t11\t0\t1\t0\t0\t1\t0\t0\t0\nredemption\tRedemption\t20\t0\t9\t0\t1\t0\t0\t2\t0\t0\t71\nregistered filer\tregistered filer\t21\t0\t3\t0\t1\t0\t0\t1\t0\t0\t0\nreissue application\treissue application\t4\t0\t15\t0\t1\t0\t0\t0\t0\t0\t80\nrejoinder\trejoinder\t2\t0\t15\t0\t1\t0\t0\t0\t0\t0\t81\nremand\tRemand\t3\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nrenewal of judgment\tRenewal of Judgment\t5\t0\t5\t0\t1\t0\t0\t0\t0\t0\t0\nrequest for admission\tRequest for Admission\t5\t0\t0\t0\t1\t0\t0\t0\t0\t0\t0\nrequest for production\tRequest for Production\t5\t0\t0\t0\t1\t0\t0\t0\t0\t0\t0\nrequest to reinstate an application\trequest to reinstate an application\t5\t0\t15\t0\t1\t0\t0\t0\t0\t0\t0\nrespondent\tRespondent\t21\t0\t5\t0\t1\t0\t0\t1\t0\t0\t35\nretained earnings/accumulated loss\tRetained Earnings/Accumulated Loss\t16\t0\t16\t0\t1\t0\t0\t2\t0\t0\t20\nretainer\tretainer\t10\t0\t7\t0\t1\t0\t0\t2\t0\t0\t54\nretaliation\tretaliation\t10\t0\t14\t0\t1\t0\t0\t1\t0\t0\t68\nrevenue\tRevenue\t16\t0\t16\t0\t1\t0\t0\t2\t0\t0\t65\nreverse\tReverse\t3\t0\t9\t0\t1\t0\t0\t2\t0\t0\t59\nrisk assessment\trisk assessment\t17\t0\t2\t0\t1\t0\t0\t2\t0\t0\t36\nrural business investment company (rbic)\tRural Business Investment Company (RBIC)\t14\t0\t16\t0\t1\t0\t0\t0\t0\t0\t0\nsafeguards rule\tSafeguards Rule\t6\t0\t2\t0\t1\t0\t0\t0\t0\t0\t0\nsanction\tSanction\t12\t0\t9\t0\t1\t0\t0\t1\t0\t0\t69\nscaled disclosure\tScaled Disclosure\t10\t0\t16\t0\t1\t0\t0\t0\t0\t0\t0\nschedules\tSchedules\t4\t0\t9\t0\t1\t0\t0\t2\t0\t0\t59\nscope\tscope\t10\t0\t15\t0\t1\t0\t0\t2\t0\t0\t59\nsecondary market\tSecondary Market\t10\t0\t16\t0\t1\t0\t0\t1\t0\t0\t44\nsection 341 meeting\tSection 341 meeting\t18\t0\t9\t0\t1\t0\t0\t0\t0\t0\t24\nsection 4(a)(2)\tSection 4(a)(2)\t10\t0\t16\t0\t1\t0\t0\t1\t0\t0\t88\nsecured creditor\tSecured creditor\t22\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nsecured debt\tSecured debt\t10\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nsenior judge\tSenior judge\t21\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nsentence\tSentence\t12\t0\t9\t0\t1\t0\t0\t2\t0\t0\t51\nsentencing guidelines\tSentencing guidelines\t6\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nsequester\tSequester\t1\t0\t9\t0\t1\t0\t0\t1\t0\t0\t64\nservice mark\tservice mark\t10\t0\t15\t0\t1\t0\t0\t0\t0\t0\t0\nservice of process\tService of process\t1\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nservice provider\tservice provider\t23\t0\t2\t0\t1\t0\t0\t2\t0\t0\t66\nsettlement\tSettlement\t20\t0\t9\t0\t1\t0\t0\t1\t0\t0\t69\nsettlement conference\tsettlement conference\t18\t0\t13\t0\t1\t0\t0\t0\t0\t0\t0\nsister state judgment\tsister state judgment\t6\t0\t5\t0\t0\t1\t16\t0\t0\t0\t49\nsister-state judgment\tSister-State Judgment\t6\t0\t5\t0\t1\t0\t0\t0\t0\t0\t0\nstandard of proof\tStandard of proof\t10\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nstate securities regulators\tState Securities Regulators\t15\t0\t16\t0\t1\t0\t0\t0\t0\t0\t0\nstatement of damages\tStatement of Damages\t4\t0\t5\t0\t1\t0\t0\t0\t0\t0\t0\nstatement of financial affairs\tStatement of financial affairs\t4\t0\t9\t0\t1\t0\t0\t0\t0\t0\t24\nstatement of intention\tStatement of intention\t4\t0\t9\t0\t1\t0\t0\t1\t0\t0\t24\nstatute\tStatute\t6\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nstatute of limitations\tStatute of limitations\t10\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nstock\tStock\t10\t0\t16\t0\t1\t0\t0\t2\t0\t0\t72\nstock option\tStock Option\t10\t0\t16\t0\t1\t0\t0\t1\t0\t0\t43\nstock-based compensation\tStock-Based Compensation\t10\t0\t16\t0\t1\t0\t0\t1\t0\t0\t40\nsua sponte\tSua sponte\t1\t0\t9\t0\t1\t0\t0\t0\t0\t0\t7\nsubordination\tSubordination\t10\t0\t9\t0\t1\t0\t0\t1\t0\t0\t44\n" +
  "subpoena\tSubpoena\t5\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nsubpoena duces tecum\tSubpoena duces tecum\t5\t0\t9\t0\t1\t0\t0\t0\t0\t0\t7\nsubstantive consolidation\tSubstantive consolidation\t2\t0\t9\t0\t1\t0\t0\t0\t0\t0\t24\nsubstituted service\tSubstituted Service\t1\t0\t5\t0\t1\t0\t0\t0\t0\t0\t0\nsummary judgment\tSummary judgment\t2\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nsummons\tSummons\t5\t0\t5\t0\t1\t0\t0\t0\t0\t0\t0\nsupporting declaration\tSupporting Declaration\t4\t0\t11\t0\t1\t0\t0\t1\t0\t0\t0\ntangible asset\tTangible Asset\t16\t0\t16\t0\t1\t0\t0\t2\t0\t0\t20\ntemporary restraining order\tTemporary restraining order\t5\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\ntestimony\tTestimony\t20\t0\t9\t0\t1\t0\t0\t1\t0\t0\t0\ntokenized security\tTokenized Security\t10\t0\t16\t0\t1\t0\t0\t1\t0\t0\t99\ntoll\tToll\t10\t0\t9\t0\t1\t0\t0\t2\t0\t0\t59\ntort\tTort\t10\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\ntrademark\ttrademark\t10\t0\t15\t0\t1\t0\t0\t0\t0\t0\t0\ntrademark application\ttrademark application\t4\t0\t15\t0\t1\t0\t0\t0\t0\t0\t0\ntrademark examining attorney\ttrademark examining attorney\t21\t0\t15\t0\t1\t0\t0\t0\t0\t0\t0\ntrademark registration\ttrademark registration\t6\t0\t15\t0\t1\t0\t0\t0\t0\t0\t0\ntrademark trial and appeal board (ttab)\tTrademark Trial and Appeal Board (TTAB)\t13\t0\t15\t0\t1\t0\t0\t0\t0\t0\t0\ntranscript\tTranscript\t4\t0\t9\t0\t1\t0\t0\t1\t0\t0\t35\ntransfer\tTransfer\t20\t0\t9\t0\t1\t0\t0\t2\t0\t0\t69\ntreasury stock\tTreasury Stock\t10\t0\t16\t0\t1\t0\t0\t1\t0\t0\t44\ntrial de novo\tTrial de Novo\t1\t0\t5\t0\t1\t0\t0\t0\t0\t0\t0\ntro\tTRO\t5\t0\t9\t0\t0\t1\t17\t2\t0\t0\t91\ntrustee\tTrustee\t21\t0\t9\t0\t1\t0\t0\t2\t0\t0\t101\nttab\tTTAB\t13\t0\t15\t0\t0\t1\t18\t1\t0\t0\t92\nu.s. attorney\tU.S. attorney\t21\t0\t9\t0\t1\t0\t0\t1\t0\t0\t48\nu.s. trustee\tU.S. trustee\t21\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nunauthorized acquisition\tunauthorized acquisition\t10\t0\t2\t0\t1\t0\t0\t0\t0\t0\t85\nundersecured claim\tUndersecured claim\t10\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nundue hardship\tundue hardship\t10\t0\t8\t0\t1\t0\t0\t1\t0\t0\t35\nundue hardship (bankruptcy)\tUndue hardship (bankruptcy)\t10\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nunlawful detainer action\tUnlawful detainer action\t1\t0\t9\t0\t1\t0\t0\t0\t0\t0\t56\nunlawful detainer action\tUnlawful detainer action\t1\t0\t8\t0\t1\t0\t0\t0\t0\t0\t56\nunliquidated claim\tUnliquidated claim\t10\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nunredacted version\tUnredacted Version\t4\t0\t11\t0\t1\t0\t0\t1\t0\t0\t0\nunscheduled debt\tUnscheduled debt\t10\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nunsecured claim\tUnsecured claim\t10\t0\t9\t0\t1\t0\t0\t0\t0\t0\t0\nuphold\tUphold\t3\t0\t9\t0\t1\t0\t0\t2\t0\t0\t64\nuse in commerce\tuse in commerce\t10\t0\t15\t0\t1\t0\t0\t0\t0\t0\t100\nvenue\tVenue\t10\t0\t5\t0\t1\t0\t0\t2\t0\t0\t73\nverdict\tverdict\t8\t0\t10\t0\t1\t0\t0\t1\t0\t0\t0\nwarrant\tWarrant\t5\t0\t5\t0\t1\t0\t0\t1\t0\t0\t0\nwitness\twitness\t21\t0\t10\t0\t1\t0\t0\t2\t0\t0\t78\nwrit\tWrit\t5\t0\t5\t0\t1\t0\t0\t0\t0\t0\t0\nwrit of execution\tWrit of Execution\t5\t0\t5\t0\t1\t0\t0\t0\t0\t0\t0\nwrit of habeas corpus\tWrit of Habeas Corpus\t5\t0\t5\t0\t1\t0\t0\t0\t0\t0\t0\nwrit of mandate\tWrit of Mandate\t5\t0\t5\t0\t1\t0\t0\t0\t0\t0\t0\nwrit of prohibition\tWrit of Prohibition\t5\t0\t5\t0\t1\t0\t0\t0\t0\t0\t0\nwritten discovery\twritten discovery\t1\t0\t0\t0\t1\t0\t0\t1\t0\t0\t0";

/** The pack asset. Consumed by LegalTerminologyEvidence.ts,
 *  which owns this pack's normalization policy and its evidence contract. */
export const LEGAL_PACK: DomainReferencePackAsset = {
  source: LEGAL_SOURCE,
  rowCount: LEGAL_ROW_COUNT,
  termCount: LEGAL_TERM_COUNT,
  rows: ROWS,
  hintSets: HINT_SETS,
  subDomains: SUB_DOMAINS,
  sources: SOURCES,
  strings: STRINGS,
};
