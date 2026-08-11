/**
 * employment-hr-terminology.data.ts -- GENERATED. DO NOT HAND-EDIT.
 *
 * Regenerate with:
 *     python3 scripts/generate_domain_terminology_pack.py employment_hr <csv>
 * Source CSV is versioned at investigation/data/docscrub_employment_hr_terms.csv.
 *
 * SOURCE: OPM (general personnel policy, classification, pay/leave and
 * performance management), DOL/WHD (FMLA), EEOC, NLRB, FLRA, MSPB, OSHA
 * and EBSA. US federal public glossaries only. O*NET/SOC is CC BY 4.0 and
 * was researched but DELIBERATELY NOT bulk-ingested in v1: the occupational
 * title universe would have turned an HR-ADMINISTRATION pack into a
 * role/title dictionary and multiplied name collisions. It is recorded as a
 * separately measured future expansion, not silent scope growth. No
 * commercial HR dictionary and no vendor HRIS vocabulary was ingested;
 * term labels and provenance only, no source definitions reproduced.
 *
 * CONTENT: 267 attestation rows over 252 distinct
 * normalized terms. 15 terms are attested by more than one row and every
 * such row is retained -- corroboration across independent source families is
 * evidence a future combination layer will want, and collapsing to a key set
 * would destroy it. 0 rows are mechanically derived variants rather
 * than direct source labels. Collision risk: LOW 205,
 * MEDIUM 12, HIGH 50.
 * SUB-DOMAINS: classification 26, employee_benefits 30, employee_relations 21, equal_employment_opportunity 23, federal_labor_relations 16, labor_relations 27, leave 24, leave_compensation 26, performance_management 17, personnel_action 36, workplace_safety 21.
 *
 * THE ONE CLAIM A MATCH LICENSES: "this phrase is attested employment/HR terminology."
 * Not a semantic type, not a Keep, and NOT evidence of non-personhood --
 * `Grade`, `detail`, `series`, `transfer`, `appeal`,
 * `beneficiary`, `participant` and the acronyms `ADA`, `EEO`, `FMLA`,
 * `PIP`, `PPP`, `SPD` are all attested here AND are ordinary English,
 * legal or finance terminology, or Census-attested personal names.
 *
 * REPRESENTATION: `DomainReferencePackAsset` (see DomainReferenceEvidence.ts
 * for the column contract). Intern tables plus a TAB-separated row block,
 * sorted by normalized key then source order. Intern-table order is
 * load-bearing: regenerating with a different order invalidates every row.
 */

import type { DomainReferencePackAsset } from "./DomainReferenceEvidence.js";

export const EMPLOYMENT_HR_SOURCE = "docscrub-employment-hr-terminology/2026-08-10";
export const EMPLOYMENT_HR_ROW_COUNT = 267;
export const EMPLOYMENT_HR_TERM_COUNT = 252;

/** Pipe-separated hint combinations, verbatim from the source dataset.
 *  Index-addressed by row column 2. Order is load-bearing. */
const HINT_SETS: readonly string[] = [
  "BENEFIT_CONCEPT",
  "BENEFIT_OR_COMPENSATION",
  "EEO_CONCEPT",
  "EMPLOYEE_RELATIONS_CONCEPT",
  "HR_ADMIN_CONCEPT",
  "LABOR_RELATIONS_CONCEPT",
  "LEAVE_CONCEPT",
  "PERFORMANCE_CONCEPT",
  "PROCESS_EVENT",
  "SAFETY_CONCEPT",
];

/** Index-addressed by row column 3. Index 0 is "" -- no sub-domain. */
const SUB_DOMAINS: readonly string[] = [
  "",
  "classification",
  "employee_benefits",
  "employee_relations",
  "equal_employment_opportunity",
  "federal_labor_relations",
  "labor_relations",
  "leave",
  "leave_compensation",
  "performance_management",
  "personnel_action",
  "workplace_safety",
];

/** Index-addressed by row column 4: [name, url, family, authorityLevel]. */
const SOURCES: readonly (readonly [string, string, string, string])[] = [
  ["Employee Benefits Security Administration — Retirement Responsibilities / ERISA", "https://www.dol.gov/agencies/ebsa/employers-and-advisers/small-business-owners/understanding-your-responsibilities", "EBSA", "US_FEDERAL_EMPLOYEE_BENEFITS_AUTHORITY"],
  ["Federal Labor Relations Authority — Federal Service Labor-Management Relations Statute", "https://www.flra.gov/resources-training/resources/statute-and-regulations/statute/statute-subchapter-i-general-2", "FLRA", "US_FEDERAL_LABOR_RELATIONS_AUTHORITY"],
  ["National Labor Relations Board — Employee / Employer / Union Rights", "https://www.nlrb.gov/about-nlrb/rights-we-protect/your-rights/employer-union-rights-and-obligations", "NLRB", "US_FEDERAL_LABOR_RELATIONS_AUTHORITY"],
  ["OPM Classification & Qualifications / Classifying General Schedule Positions", "https://www.opm.gov/policy-data-oversight/classification-qualifications/classifying-general-schedule-positions/", "OPM_CLASSIFICATION", "US_FEDERAL_PERSONNEL_AUTHORITY"],
  ["OPM Guide to Processing Personnel Actions — Glossary of Terms Used in Processing Personnel Actions", "https://www.opm.gov/policy-data-oversight/data-analysis-documentation/personnel-documentation/processing-personnel-actions/gppa35.pdf", "OPM_GPPA", "US_FEDERAL_PERSONNEL_AUTHORITY"],
  ["OPM Pay & Leave / Leave Administration", "https://www.opm.gov/policy-data-oversight/pay-leave/leave-administration/", "OPM_PAY_LEAVE", "US_FEDERAL_PERSONNEL_AUTHORITY"],
  ["OPM Performance Management", "https://www.opm.gov/policy-data-oversight/performance-management/", "OPM_PERFORMANCE", "US_FEDERAL_PERSONNEL_AUTHORITY"],
  ["Occupational Safety and Health Administration — Injury and Illness Recordkeeping", "https://www.osha.gov/laws-regs/regulations/standardnumber/1904/1904.7", "OSHA", "US_FEDERAL_WORKPLACE_SAFETY_AUTHORITY"],
  ["U.S. Department of Labor, Wage and Hour Division — FMLA", "https://www.dol.gov/agencies/whd/fmla", "DOL_FMLA", "US_FEDERAL_LABOR_AUTHORITY"],
  ["U.S. Equal Employment Opportunity Commission — Employment Guidance", "https://www.eeoc.gov/disability-discrimination-and-employment-decisions", "EEOC", "US_FEDERAL_EEO_AUTHORITY"],
  ["U.S. Merit Systems Protection Board — Merit System Principles / Prohibited Personnel Practices", "https://www.mspb.gov/ppp/ppp.htm", "MSPB", "US_FEDERAL_MERIT_SYSTEM_AUTHORITY"],
];

/** Shared pool for the sparse columns (source ids, parent terms, acronyms,
 *  acronym expansions, notes). Index 0 is "". */
const STRINGS: readonly string[] = [
  "",
  "ADA",
  "Acronym/initialism; may have unrelated expansions in other domains.",
  "EEO",
  "ERISA",
  "FMLA",
  "LWOP",
  "MSP",
  "PEP",
  "PIP",
  "PPP",
  "PWFA",
  "QDRO",
  "SF-50",
  "SMM",
  "SPD",
  "Single-token ordinary-English/title/name collision risk; retain as evidence only.",
  "Single-token term; context remains important.",
];

/** One line per attestation row, TAB-separated. Columns, in order:
 *  normalized, term, hintSetIdx, subDomainIdx, sourceIdx, sourceIdIdx,
 *  sourceAttested(0|1), derivedVariant(0|1), parentIdx, riskIdx,
 *  acronymIdx, acronymExpIdx, notesIdx */
const ROWS =
  "12-month period\t12-month period\t6\t7\t8\t0\t1\t0\t0\t0\t0\t0\t0\n401(k) plan\t401(k) plan\t0\t2\t0\t0\t1\t0\t0\t0\t0\t0\t0\nabuse of authority\tabuse of authority\t3\t3\t10\t0\t1\t0\t0\t0\t0\t0\t0\naccession\taccession\t8\t10\t4\t0\t1\t0\t0\t1\t0\t0\t17\nada\tADA\t2\t4\t9\t0\t1\t0\t0\t2\t1\t0\t2\nadverse action\tadverse action\t2\t4\t9\t0\t1\t0\t0\t0\t0\t0\t0\nadverse action\tadverse action\t3\t3\t10\t0\t1\t0\t0\t0\t0\t0\t0\nagency action\tagency action\t3\t3\t10\t0\t1\t0\t0\t0\t0\t0\t0\namericans with disabilities act\tAmericans with Disabilities Act\t2\t4\t9\t0\t1\t0\t0\t0\t0\t0\t0\nannual leave\tannual leave\t1\t8\t5\t0\t1\t0\t0\t0\t0\t0\t0\nappeal\tappeal\t3\t3\t10\t0\t1\t0\t0\t2\t0\t0\t16\nappellant\tappellant\t3\t3\t10\t0\t1\t0\t0\t2\t0\t0\t16\nappointment\tappointment\t8\t10\t4\t0\t1\t0\t0\t2\t0\t0\t16\narbitration\tarbitration\t5\t5\t1\t0\t1\t0\t0\t2\t0\t0\t16\narbitrator\tarbitrator\t5\t5\t1\t0\t1\t0\t0\t2\t0\t0\t16\nassessing\tassessing\t7\t9\t6\t0\t1\t0\t0\t2\t0\t0\t16\nbackpay\tbackpay\t5\t6\t2\t0\t1\t0\t0\t1\t0\t0\t17\nbargain in good faith\tbargain in good faith\t5\t6\t2\t0\t1\t0\t0\t0\t0\t0\t0\nbargaining impasse\tbargaining impasse\t5\t5\t1\t0\t1\t0\t0\t0\t0\t0\t0\nbargaining impasse\tbargaining impasse\t5\t6\t2\t0\t1\t0\t0\t0\t0\t0\t0\nbargaining representative\tbargaining representative\t5\t6\t2\t0\t1\t0\t0\t0\t0\t0\t0\nbargaining unit\tbargaining unit\t5\t5\t1\t0\t1\t0\t0\t0\t0\t0\t0\nbargaining unit\tbargaining unit\t5\t6\t2\t0\t1\t0\t0\t0\t0\t0\t0\nbasic pay\tbasic pay\t1\t8\t5\t0\t1\t0\t0\t0\t0\t0\t0\nbeneficiary\tbeneficiary\t0\t2\t0\t0\t1\t0\t0\t2\t0\t0\t16\nblue collar position\tblue collar position\t4\t1\t3\t0\t1\t0\t0\t0\t0\t0\t0\nbreak in service\tbreak in service\t8\t10\t4\t0\t1\t0\t0\t0\t0\t0\t0\ncareer appointment\tcareer appointment\t8\t10\t4\t0\t1\t0\t0\t0\t0\t0\t0\ncareer-conditional appointment\tcareer-conditional appointment\t8\t10\t4\t0\t1\t0\t0\t0\t0\t0\t0\nchange in duty station\tchange in duty station\t8\t10\t4\t0\t1\t0\t0\t0\t0\t0\t0\nchange in hours\tchange in hours\t8\t10\t4\t0\t1\t0\t0\t0\t0\t0\t0\nchange in work schedule\tchange in work schedule\t8\t10\t4\t0\t1\t0\t0\t0\t0\t0\t0\nchange to lower grade\tchange to lower grade\t8\t10\t4\t0\t1\t0\t0\t0\t0\t0\t0\nclassification appeal\tclassification appeal\t4\t1\t3\t0\t1\t0\t0\t0\t0\t0\t0\nclassification standard\tclassification standard\t4\t1\t3\t0\t1\t0\t0\t0\t0\t0\t0\nclassifier\tclassifier\t4\t1\t3\t0\t1\t0\t0\t2\t0\t0\t16\ncobra continuation coverage\tCOBRA continuation coverage\t0\t2\t0\t0\t1\t0\t0\t0\t0\t0\t0\ncollective bargaining\tcollective bargaining\t5\t5\t1\t0\t1\t0\t0\t0\t0\t0\t0\ncollective bargaining\tcollective bargaining\t5\t6\t2\t0\t1\t0\t0\t0\t0\t0\t0\ncollective bargaining agreement\tcollective bargaining agreement\t5\t5\t1\t0\t1\t0\t0\t0\t0\t0\t0\ncollective bargaining agreement\tcollective bargaining agreement\t5\t6\t2\t0\t1\t0\t0\t0\t0\t0\t0\ncompensatory time off\tcompensatory time off\t1\t8\t5\t0\t1\t0\t0\t0\t0\t0\t0\ncompetitive appointment\tcompetitive appointment\t8\t10\t4\t0\t1\t0\t0\t0\t0\t0\t0\nconcerted activity\tconcerted activity\t5\t6\t2\t0\t1\t0\t0\t0\t0\t0\t0\nconditions of employment\tconditions of employment\t5\t5\t1\t0\t1\t0\t0\t0\t0\t0\t0\ncontinuation of group health benefits\tcontinuation of group health benefits\t6\t7\t8\t0\t1\t0\t0\t0\t0\t0\t0\nconversion\tconversion\t8\t10\t4\t0\t1\t0\t0\t1\t0\t0\t17\ncorrective action\tcorrective action\t3\t3\t10\t0\t1\t0\t0\t0\t0\t0\t0\ncovered employer\tcovered employer\t6\t7\t8\t0\t1\t0\t0\t0\t0\t0\t0\ncredit hours\tcredit hours\t1\t8\t5\t0\t1\t0\t0\t0\t0\t0\t0\ncritical element\tcritical element\t7\t9\t6\t0\t1\t0\t0\t0\t0\t0\t0\ncurrent employee\tcurrent employee\t2\t4\t9\t0\t1\t0\t0\t0\t0\t0\t0\ndays away case\tdays away case\t9\t11\t7\t0\t1\t0\t0\t0\t0\t0\t0\ndays away from work\tdays away from work\t9\t11\t7\t0\t1\t0\t0\t0\t0\t0\t0\ndefined contribution plan\tdefined contribution plan\t0\t2\t0\t0\t1\t0\t0\t0\t0\t0\t0\ndemotion\tdemotion\t3\t3\t10\t0\t1\t0\t0\t1\t0\t0\t17\ndemotion\tdemotion\t8\t10\t4\t0\t1\t0\t0\t1\t0\t0\t17\ndesignation notice\tdesignation notice\t6\t7\t8\t0\t1\t0\t0\t0\t0\t0\t0\ndetail\tdetail\t8\t10\t4\t0\t1\t0\t0\t2\t0\t0\t16\ndeveloping\tdeveloping\t7\t9\t6\t0\t1\t0\t0\t2\t0\t0\t16\ndisability discrimination\tdisability discrimination\t2\t4\t9\t0\t1\t0\t0\t0\t0\t0\t0\ndisciplinary action\tdisciplinary action\t3\t3\t10\t0\t1\t0\t0\t0\t0\t0\t0\neconomic striker\teconomic striker\t5\t6\t2\t0\t1\t0\t0\t0\t0\t0\t0\neeo\tEEO\t2\t4\t9\t0\t1\t0\t0\t2\t3\t0\t2\nelection petition\telection petition\t5\t6\t2\t0\t1\t0\t0\t0\t0\t0\t0\neligibility notice\teligibility notice\t6\t7\t8\t0\t1\t0\t0\t0\t0\t0\t0\neligible employee\teligible employee\t6\t7\t8\t0\t1\t0\t0\t0\t0\t0\t0\nemployee benefit plan\temployee benefit plan\t0\t2\t0\t0\t1\t0\t0\t0\t0\t0\t0\nemployee retirement income security act\tEmployee Retirement Income Security Act\t0\t2\t0\t0\t1\t0\t0\t0\t0\t0\t0\nemployment discrimination\temployment discrimination\t2\t4\t9\t0\t1\t0\t0\t0\t0\t0\t0\nequal employment opportunity\tequal employment opportunity\t2\t4\t9\t0\t1\t0\t0\t0\t0\t0\t0\nequivalent position\tequivalent position\t6\t7\t8\t0\t1\t0\t0\t0\t0\t0\t0\nerisa\tERISA\t0\t2\t0\t0\t1\t0\t0\t2\t4\t0\t2\nexcepted appointment\texcepted appointment\t8\t10\t4\t0\t1\t0\t0\t0\t0\t0\t0\nexclusive representative\texclusive representative\t5\t5\t1\t0\t1\t0\t0\t0\t0\t0\t0\nextension\textension\t8\t10\t4\t0\t1\t0\t0\t1\t0\t0\t17\nfamily and medical leave act\tFamily and Medical Leave Act\t6\t7\t8\t0\t1\t0\t0\t0\t0\t0\t0\nfamily and medical leave act\tFamily and Medical Leave Act\t1\t8\t5\t0\t1\t0\t0\t0\t0\t0\t0\nfederal service impasses panel\tFederal Service Impasses Panel\t5\t5\t1\t0\t1\t0\t0\t0\t0\t0\t0\nfederal wage system\tFederal Wage System\t4\t1\t3\t0\t1\t0\t0\t0\t0\t0\t0\nfiduciary\tfiduciary\t0\t2\t0\t0\t1\t0\t0\t2\t0\t0\t16\nfirst aid\tfirst aid\t9\t11\t7\t0\t1\t0\t0\t0\t0\t0\t0\nfitness-for-duty certification\tfitness-for-duty certification\t6\t7\t8\t0\t1\t0\t0\t0\t0\t0\t0\nfmla\tFMLA\t6\t7\t8\t0\t1\t0\t0\t2\t5\t0\t2\nfmla\tFMLA\t1\t8\t5\t0\t1\t0\t0\t2\t5\t0\t2\nfmla leave\tFMLA leave\t6\t7\t8\t0\t1\t0\t0\t0\t0\t0\t0\nform 5500\tForm 5500\t0\t2\t0\t0\t1\t0\t0\t0\t0\t0\t0\nformer employee\tformer employee\t2\t4\t9\t0\t1\t0\t0\t0\t0\t0\t0\ngeneral recording criteria\tgeneral recording criteria\t9\t11\t7\t0\t1\t0\t0\t0\t0\t0\t0\ngeneral schedule\tGeneral Schedule\t4\t1\t3\t0\t1\t0\t0\t0\t0\t0\t0\ngeneral schedule pay system\tGeneral Schedule pay system\t4\t1\t3\t0\t1\t0\t0\t0\t0\t0\t0\ngoal setting\tgoal setting\t7\t9\t6\t0\t1\t0\t0\t0\t0\t0\t0\ngood faith bargaining\tgood faith bargaining\t5\t6\t2\t0\t1\t0\t0\t0\t0\t0\t0\ngrade\tgrade\t4\t1\t3\t0\t1\t0\t0\t2\t0\t0\t16\ngrade level\tgrade level\t4\t1\t3\t0\t1\t0\t0\t0\t0\t0\t0\ngrade retention\tgrade retention\t1\t8\t5\t0\t1\t0\t0\t0\t0\t0\t0\ngrievance\tgrievance\t5\t5\t1\t0\t1\t0\t0\t2\t0\t0\t16\ngrievance\tgrievance\t5\t6\t2\t0\t1\t0\t0\t2\t0\t0\t16\ngroup health plan\tgroup health plan\t0\t2\t0\t0\t1\t0\t0\t0\t0\t0\t0\nharassment\tharassment\t2\t4\t9\t0\t1\t0\t0\t2\t0\t0\t16\nholiday premium pay\tholiday premium pay\t1\t8\t5\t0\t1\t0\t0\t0\t0\t0\t0\nindividual benefit statement\tindividual benefit statement\t0\t2\t0\t0\t1\t0\t0\t0\t0\t0\t0\ninteractive process\tinteractive process\t2\t4\t9\t0\t1\t0\t0\t0\t0\t0\t0\nintermittent leave\tintermittent leave\t6\t7\t8\t0\t1\t0\t0\t0\t0\t0\t0\njob applicant\tjob applicant\t2\t4\t9\t0\t1\t0\t0\t0\t0\t0\t0\njob grading\tjob grading\t4\t1\t3\t0\t1\t0\t0\t0\t0\t0\t0\njob transfer\tjob transfer\t9\t11\t7\t0\t1\t0\t0\t0\t0\t0\t0\njob-protected leave\tjob-protected leave\t6\t7\t8\t0\t1\t0\t0\t0\t0\t0\t0\nlabor organization\tlabor organization\t5\t5\t1\t0\t1\t0\t0\t0\t0\t0\t0\nleave bank\tleave bank\t1\t8\t5\t0\t1\t0\t0\t0\t0\t0\t0\nleave sharing\tleave sharing\t1\t8\t5\t0\t1\t0\t0\t0\t0\t0\t0\nleave transfer\tleave transfer\t1\t8\t5\t0\t1\t0\t0\t0\t0\t0\t0\nleave without pay\tleave without pay\t1\t8\t5\t0\t1\t0\t0\t0\t0\t0\t0\nlocality pay\tlocality pay\t1\t8\t5\t0\t1\t0\t0\t0\t0\t0\t0\nloss of consciousness\tloss of consciousness\t9\t11\t7\t0\t1\t0\t0\t0\t0\t0\t0\nlwop\tLWOP\t1\t8\t5\t0\t1\t0\t0\t2\t6\t0\t2\nmandatory subjects of bargaining\tmandatory subjects of bargaining\t5\t6\t2\t0\t1\t0\t0\t0\t0\t0\t0\nmedical certification\tmedical certification\t6\t7\t8\t0\t1\t0\t0\t0\t0\t0\t0\nmedical treatment beyond first aid\tmedical treatment beyond first aid\t9\t11\t7\t0\t1\t0\t0\t0\t0\t0\t0\nmerit system principles\tMerit System Principles\t3\t3\t10\t0\t1\t0\t0\t0\t0\t0\t0\nmerit-based selection\tmerit-based selection\t3\t3\t10\t0\t1\t0\t0\t0\t0\t0\t0\nmilitary caregiver leave\tmilitary caregiver leave\t6\t7\t8\t0\t1\t0\t0\t0\t0\t0\t0\nmilitary leave\tmilitary leave\t1\t8\t5\t0\t1\t0\t0\t0\t0\t0\t0\nmonitoring\tmonitoring\t7\t9\t6\t0\t1\t0\t0\t2\t0\t0\t16\nmsp\tMSP\t3\t3\t10\t0\t1\t0\t0\t2\t7\t0\t2\nnature of action\tnature of action\t8\t10\t4\t0\t1\t0\t0\t0\t0\t0\t0\nnature of action code\tnature of action code\t8\t10\t4\t0\t1\t0\t0\t0\t0\t0\t0\nnegotiability\tnegotiability\t5\t5\t1\t0\t1\t0\t0\t1\t0\t0\t17\nnegotiated grievance procedure\tnegotiated grievance procedure\t5\t5\t1\t0\t1\t0\t0\t0\t0\t0\t0\nnew case\tnew case\t9\t11\t7\t0\t1\t0\t0\t0\t0\t0\t0\nnight pay\tnight pay\t1\t8\t5\t0\t1\t0\t0\t0\t0\t0\t0\nnoncompetitive action\tnoncompetitive action\t8\t10\t4\t0\t1\t0\t0\t0\t0\t0\t0\nnotification of personnel action\tNotification of Personnel Action\t8\t10\t4\t0\t1\t0\t0\t0\t0\t0\t0\noccupational family\toccupational family\t4\t1\t3\t0\t1\t0\t0\t0\t0\t0\t0\noccupational group\toccupational group\t4\t1\t3\t0\t1\t0\t0\t0\t0\t0\t0\noccupational series\toccupational series\t4\t1\t3\t0\t1\t0\t0\t0\t0\t0\t0\nofficial position title\tofficial position title\t4\t1\t3\t0\t1\t0\t0\t0\t0\t0\t0\nofficial time\tofficial time\t5\t5\t1\t0\t1\t0\t0\t0\t0\t0\t0\nosha 300 log\tOSHA 300 Log\t9\t11\t7\t0\t1\t0\t0\t0\t0\t0\t0\novertime pay\tovertime pay\t1\t8\t5\t0\t1\t0\t0\t0\t0\t0\t0\npaid leave\tpaid leave\t6\t7\t8\t0\t1\t0\t0\t0\t0\t0\t0\npaid parental leave\tpaid parental leave\t1\t8\t5\t0\t1\t0\t0\t0\t0\t0\t0\nparticipant\tparticipant\t0\t2\t0\t0\t1\t0\t0\t2\t0\t0\t16\npay plan\tpay plan\t4\t1\t3\t0\t1\t0\t0\t0\t0\t0\t0\npay plan code\tpay plan code\t4\t1\t3\t0\t1\t0\t0\t0\t0\t0\t0\npay rate\tpay rate\t1\t8\t5\t0\t1\t0\t0\t0\t0\t0\t0\npay retention\tpay retention\t1\t8\t5\t0\t1\t0\t0\t0\t0\t0\t0\npay scale\tpay scale\t1\t8\t5\t0\t1\t0\t0\t0\t0\t0\t0\npay schedule\tpay schedule\t1\t8\t5\t0\t1\t0\t0\t0\t0\t0\t0\npay system\tpay system\t4\t1\t3\t0\t1\t0\t0\t0\t0\t0\t0\npension plan\tpension plan\t0\t2\t0\t0\t1\t0\t0\t0\t0\t0\t0\npep\tPEP\t0\t2\t0\t0\t1\t0\t0\t2\t8\t0\t2\nperformance appraisal\tperformance appraisal\t7\t9\t6\t0\t1\t0\t0\t0\t0\t0\t0\nperformance award\tperformance award\t7\t9\t6\t0\t1\t0\t0\t0\t0\t0\t0\nperformance element\tperformance element\t7\t9\t6\t0\t1\t0\t0\t0\t0\t0\t0\nperformance improvement plan\tperformance improvement plan\t7\t9\t6\t0\t1\t0\t0\t0\t0\t0\t0\nperformance management\tperformance management\t7\t9\t6\t0\t1\t0\t0\t0\t0\t0\t0\nperformance management cycle\tperformance management cycle\t7\t9\t6\t0\t1\t0\t0\t0\t0\t0\t0\nperformance plan\tperformance plan\t7\t9\t6\t0\t1\t0\t0\t0\t0\t0\t0\nperformance rating\tperformance rating\t7\t9\t6\t0\t1\t0\t0\t0\t0\t0\t0\nperformance standard\tperformance standard\t7\t9\t6\t0\t1\t0\t0\t0\t0\t0\t0\nperformance-based action\tperformance-based action\t3\t3\t10\t0\t1\t0\t0\t0\t0\t0\t0\npersonal favoritism\tpersonal favoritism\t3\t3\t10\t0\t1\t0\t0\t0\t0\t0\t0\npersonnel action\tpersonnel action\t3\t3\t10\t0\t1\t0\t0\t0\t0\t0\t0\npicket line\tpicket line\t5\t6\t2\t0\t1\t0\t0\t0\t0\t0\t0\npip\tPIP\t7\t9\t6\t0\t1\t0\t0\t2\t9\t0\t2\nplan administrator\tplan administrator\t0\t2\t0\t0\t1\t0\t0\t0\t0\t0\t0\nplan sponsor\tplan sponsor\t0\t2\t0\t0\t1\t0\t0\t0\t0\t0\t0\nplan year\tplan year\t0\t2\t0\t0\t1\t0\t0\t0\t0\t0\t0\npooled employer plan\tpooled employer plan\t0\t2\t0\t0\t1\t0\t0\t0\t0\t0\t0\npooled plan provider\tpooled plan provider\t0\t2\t0\t0\t1\t0\t0\t0\t0\t0\t0\nposition change\tposition change\t8\t10\t4\t0\t1\t0\t0\t0\t0\t0\t0\nposition change action\tposition change action\t8\t10\t4\t0\t1\t0\t0\t0\t0\t0\t0\nposition classification\tposition classification\t4\t1\t3\t0\t1\t0\t0\t0\t0\t0\t0\nposition classification standard\tposition classification standard\t4\t1\t3\t0\t1\t0\t0\t0\t0\t0\t0\nposition description\tposition description\t4\t1\t3\t0\t1\t0\t0\t0\t0\t0\t0\nposition title\tposition title\t4\t1\t3\t0\t1\t0\t0\t0\t0\t0\t0\nppp\tPPP\t3\t3\t10\t0\t1\t0\t0\t2\t10\t0\t2\npreexisting condition\tpreexisting condition\t9\t11\t7\t0\t1\t0\t0\t0\t0\t0\t0\npregnancy discrimination\tpregnancy discrimination\t2\t4\t9\t0\t1\t0\t0\t0\t0\t0\t0\npregnant workers fairness act\tPregnant Workers Fairness Act\t2\t4\t9\t0\t1\t0\t0\t0\t0\t0\t0\npremium pay\tpremium pay\t1\t8\t5\t0\t1\t0\t0\t0\t0\t0\t0\nprofit sharing plan\tprofit sharing plan\t0\t2\t0\t0\t1\t0\t0\t0\t0\t0\t0\nprohibited personnel practices\tProhibited Personnel Practices\t3\t3\t10\t0\t1\t0\t0\t0\t0\t0\t0\npromotion\tpromotion\t8\t10\t4\t0\t1\t0\t0\t2\t0\t0\t16\nprotected activity\tprotected activity\t2\t4\t9\t0\t1\t0\t0\t0\t0\t0\t0\nprotected concerted activity\tprotected concerted activity\t5\t6\t2\t0\t1\t0\t0\t0\t0\t0\t0\npwfa\tPWFA\t2\t4\t9\t0\t1\t0\t0\t2\t11\t0\t2\nqdro\tQDRO\t0\t2\t0\t0\t1\t0\t0\t2\t12\t0\t2\nqualification requirements\tqualification requirements\t4\t1\t3\t0\t1\t0\t0\t0\t0\t0\t0\nqualification standard\tqualification standard\t4\t1\t3\t0\t1\t0\t0\t0\t0\t0\t0\nqualified domestic relations order\tqualified domestic relations order\t0\t2\t0\t0\t1\t0\t0\t0\t0\t0\t0\nqualifying exigency\tqualifying exigency\t6\t7\t8\t0\t1\t0\t0\t0\t0\t0\t0\nrating of record\trating of record\t7\t9\t6\t0\t1\t0\t0\t0\t0\t0\t0\nreasonable accommodation\treasonable accommodation\t2\t4\t9\t0\t1\t0\t0\t0\t0\t0\t0\nreassignment\treassignment\t8\t10\t4\t0\t1\t0\t0\t2\t0\t0\t16\nrecertification\trecertification\t6\t7\t8\t0\t1\t0\t0\t1\t0\t0\t17\nrecordable case\trecordable case\t9\t11\t7\t0\t1\t0\t0\t0\t0\t0\t0\nrecordkeeping\trecordkeeping\t9\t11\t7\t0\t1\t0\t0\t2\t0\t0\t16\nreduced schedule leave\treduced schedule leave\t6\t7\t8\t0\t1\t0\t0\t0\t0\t0\t0\n" +
  "reinstatement\treinstatement\t5\t6\t2\t0\t1\t0\t0\t2\t0\t0\t16\nreinstatement\treinstatement\t8\t10\t4\t0\t1\t0\t0\t2\t0\t0\t16\nreligious accommodation\treligious accommodation\t2\t4\t9\t0\t1\t0\t0\t0\t0\t0\t0\nreligious discrimination\treligious discrimination\t2\t4\t9\t0\t1\t0\t0\t0\t0\t0\t0\nremoval\tremoval\t3\t3\t10\t0\t1\t0\t0\t2\t0\t0\t16\nremoval\tremoval\t8\t10\t4\t0\t1\t0\t0\t2\t0\t0\t16\nrepresentation petition\trepresentation petition\t5\t5\t1\t0\t1\t0\t0\t0\t0\t0\t0\nrepresentation petition\trepresentation petition\t5\t6\t2\t0\t1\t0\t0\t0\t0\t0\t0\nreprisal\treprisal\t3\t3\t10\t0\t1\t0\t0\t1\t0\t0\t17\nresignation\tresignation\t8\t10\t4\t0\t1\t0\t0\t2\t0\t0\t16\nrestoration\trestoration\t6\t7\t8\t0\t1\t0\t0\t2\t0\t0\t16\nrestricted work\trestricted work\t9\t11\t7\t0\t1\t0\t0\t0\t0\t0\t0\nrestricted work activity\trestricted work activity\t9\t11\t7\t0\t1\t0\t0\t0\t0\t0\t0\nrestricted work case\trestricted work case\t9\t11\t7\t0\t1\t0\t0\t0\t0\t0\t0\nretaliation\tretaliation\t2\t4\t9\t0\t1\t0\t0\t2\t0\t0\t16\nretirement\tretirement\t8\t10\t4\t0\t1\t0\t0\t2\t0\t0\t16\nretirement plan\tretirement plan\t0\t2\t0\t0\t1\t0\t0\t0\t0\t0\t0\nrewarding\trewarding\t7\t9\t6\t0\t1\t0\t0\t2\t0\t0\t16\nrights and responsibilities notice\trights and responsibilities notice\t6\t7\t8\t0\t1\t0\t0\t0\t0\t0\t0\nroutine job functions\troutine job functions\t9\t11\t7\t0\t1\t0\t0\t0\t0\t0\t0\nsecret ballot election\tsecret ballot election\t5\t6\t2\t0\t1\t0\t0\t0\t0\t0\t0\nsenior executive service\tSenior Executive Service\t4\t1\t3\t0\t1\t0\t0\t0\t0\t0\t0\nseparation\tseparation\t8\t10\t4\t0\t1\t0\t0\t1\t0\t0\t17\nseries\tseries\t4\t1\t3\t0\t1\t0\t0\t2\t0\t0\t16\nserious health condition\tserious health condition\t6\t7\t8\t0\t1\t0\t0\t0\t0\t0\t0\nservice computation date\tservice computation date\t8\t10\t4\t0\t1\t0\t0\t0\t0\t0\t0\nsexual harassment\tsexual harassment\t2\t4\t9\t0\t1\t0\t0\t0\t0\t0\t0\nsf-50\tSF-50\t8\t10\t4\t0\t1\t0\t0\t2\t13\t0\t2\nshowing of interest\tshowing of interest\t5\t6\t2\t0\t1\t0\t0\t0\t0\t0\t0\nsick leave\tsick leave\t1\t8\t5\t0\t1\t0\t0\t0\t0\t0\t0\nsmm\tSMM\t0\t2\t0\t0\t1\t0\t0\t2\t14\t0\t2\nspd\tSPD\t0\t2\t0\t0\t1\t0\t0\t2\t15\t0\t2\nspecial rate\tspecial rate\t1\t8\t5\t0\t1\t0\t0\t0\t0\t0\t0\nstandard form 50\tStandard Form 50\t8\t10\t4\t0\t1\t0\t0\t0\t0\t0\t0\nsummary annual report\tsummary annual report\t0\t2\t0\t0\t1\t0\t0\t0\t0\t0\t0\nsummary of material modification\tsummary of material modification\t0\t2\t0\t0\t1\t0\t0\t0\t0\t0\t0\nsummary plan description\tsummary plan description\t0\t2\t0\t0\t1\t0\t0\t0\t0\t0\t0\nsuspension\tsuspension\t3\t3\t10\t0\t1\t0\t0\t2\t0\t0\t16\nsuspension\tsuspension\t8\t10\t4\t0\t1\t0\t0\t2\t0\t0\t16\ntemporary appointment\ttemporary appointment\t8\t10\t4\t0\t1\t0\t0\t0\t0\t0\t0\nterm appointment\tterm appointment\t8\t10\t4\t0\t1\t0\t0\t0\t0\t0\t0\ntermination\ttermination\t8\t10\t4\t0\t1\t0\t0\t2\t0\t0\t16\nterms and conditions of employment\tterms and conditions of employment\t2\t4\t9\t0\t1\t0\t0\t0\t0\t0\t0\nterms and conditions of employment\tterms and conditions of employment\t5\t6\t2\t0\t1\t0\t0\t0\t0\t0\t0\ntransfer\ttransfer\t8\t10\t4\t0\t1\t0\t0\t2\t0\t0\t16\nundue hardship\tundue hardship\t2\t4\t9\t0\t1\t0\t0\t0\t0\t0\t0\nunfair labor practice\tunfair labor practice\t5\t5\t1\t0\t1\t0\t0\t0\t0\t0\t0\nunfair labor practice\tunfair labor practice\t5\t6\t2\t0\t1\t0\t0\t0\t0\t0\t0\nunfair labor practice charge\tunfair labor practice charge\t5\t6\t2\t0\t1\t0\t0\t0\t0\t0\t0\nunfair labor practice striker\tunfair labor practice striker\t5\t6\t2\t0\t1\t0\t0\t0\t0\t0\t0\nunilateral change\tunilateral change\t5\t6\t2\t0\t1\t0\t0\t0\t0\t0\t0\nunion dues\tunion dues\t5\t6\t2\t0\t1\t0\t0\t0\t0\t0\t0\nunion organizing campaign\tunion organizing campaign\t5\t6\t2\t0\t1\t0\t0\t0\t0\t0\t0\nunion-security agreement\tunion-security agreement\t5\t6\t2\t0\t1\t0\t0\t0\t0\t0\t0\nunpaid leave\tunpaid leave\t6\t7\t8\t0\t1\t0\t0\t0\t0\t0\t0\nvested benefits\tvested benefits\t0\t2\t0\t0\t1\t0\t0\t0\t0\t0\t0\nvesting\tvesting\t0\t2\t0\t0\t1\t0\t0\t1\t0\t0\t17\nveterans' preference\tveterans' preference\t3\t3\t10\t0\t1\t0\t0\t0\t0\t0\t0\nwhistleblower\twhistleblower\t3\t3\t10\t0\t1\t0\t0\t1\t0\t0\t17\nwhite collar position\twhite collar position\t4\t1\t3\t0\t1\t0\t0\t0\t0\t0\t0\nwithin-grade increase\twithin-grade increase\t1\t8\t5\t0\t1\t0\t0\t0\t0\t0\t0\nwork environment\twork environment\t9\t11\t7\t0\t1\t0\t0\t0\t0\t0\t0\nwork restriction\twork restriction\t9\t11\t7\t0\t1\t0\t0\t0\t0\t0\t0\nwork-related illness\twork-related illness\t9\t11\t7\t0\t1\t0\t0\t0\t0\t0\t0\nwork-related injury\twork-related injury\t9\t11\t7\t0\t1\t0\t0\t0\t0\t0\t0\nwork-related injury or illness\twork-related injury or illness\t9\t11\t7\t0\t1\t0\t0\t0\t0\t0\t0\nworkweek\tworkweek\t6\t7\t8\t0\t1\t0\t0\t2\t0\t0\t16";

/**
 * SOURCE LICENSING AND RETRIEVAL, one row per source family:
 *   [sourceFamily, sourceTier, licenseStatus, retrievalDate]
 *
 * A SIDE TABLE, not a row column, for two reasons. These values are constant
 * per source family in the dataset (the generator asserts it), so per-row
 * storage would be 267 copies of 11 facts. And
 * licensing is provenance ABOUT a dataset, not evidence about a phrase --
 * folding it into `notes` would put it in front of reviewers, who are reading
 * that field to judge a candidate.
 *
 * Downstream redistribution should carry this attribution forward.
 */
export const EMPLOYMENT_HR_SOURCE_LICENSING: readonly (readonly [string, string, string, string])[] = [
  ["DOL_FMLA", "A", "US federal government source; short terminology/provenance only", "2026-08-10"],
  ["EBSA", "A", "US federal government source; short terminology/provenance only", "2026-08-10"],
  ["EEOC", "A", "US federal government source; short terminology/provenance only", "2026-08-10"],
  ["FLRA", "A", "US federal government/statutory source; short terminology/provenance only", "2026-08-10"],
  ["MSPB", "A", "US federal government source; short terminology/provenance only", "2026-08-10"],
  ["NLRB", "A", "US federal government source; short terminology/provenance only", "2026-08-10"],
  ["OPM_CLASSIFICATION", "A", "US federal government source; short terminology/provenance only", "2026-08-10"],
  ["OPM_GPPA", "A", "US federal government work; terms only retained; no definitions redistributed", "2026-08-10"],
  ["OPM_PAY_LEAVE", "A", "US federal government source; short terminology/provenance only", "2026-08-10"],
  ["OPM_PERFORMANCE", "A", "US federal government source; short terminology/provenance only", "2026-08-10"],
  ["OSHA", "A", "US federal government/regulatory source; short terminology/provenance only", "2026-08-10"],
];

/** The pack asset. Consumed by EmploymentHrEvidence.ts,
 *  which owns this pack's normalization policy and its evidence contract. */
export const EMPLOYMENT_HR_PACK: DomainReferencePackAsset = {
  source: EMPLOYMENT_HR_SOURCE,
  rowCount: EMPLOYMENT_HR_ROW_COUNT,
  termCount: EMPLOYMENT_HR_TERM_COUNT,
  rows: ROWS,
  hintSets: HINT_SETS,
  subDomains: SUB_DOMAINS,
  sources: SOURCES,
  strings: STRINGS,
};
