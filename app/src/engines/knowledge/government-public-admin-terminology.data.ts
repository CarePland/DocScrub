/**
 * government-public-admin-terminology.data.ts -- GENERATED. DO NOT HAND-EDIT.
 *
 * Regenerate with:
 *     python3 scripts/generate_domain_terminology_pack.py government_public_admin <csv>
 * Source CSV is versioned at investigation/data/docscrub_government_public_admin_terms.csv.
 *
 * SOURCE: the Federal Acquisition Regulation (Acquisition.gov Part 2),
 * NARA records-management key terms, Grants.gov, FOIA.gov/DOJ OIP, the
 * Office of the Federal Register, OPM classification, and a deliberately
 * small USA.gov official-organization slice. US federal public glossaries
 * only; deliberately federal-heavy, and NOT an exhaustive ontology of
 * government -- state and local administrative vocabulary is a documented
 * v1 gap, not an absence finding. Term labels and provenance only; no
 * source definitions are reproduced.
 *
 * CONTENT: 412 attestation rows over 409 distinct
 * normalized terms. 3 terms are attested by more than one row and every
 * such row is retained -- corroboration across independent source families is
 * evidence a future combination layer will want, and collapsing to a key set
 * would destroy it. 0 rows are mechanically derived variants rather
 * than direct source labels. Collision risk: LOW 83,
 * MEDIUM 263, HIGH 66.
 * SUB-DOMAINS: ADMINISTRATIVE_PROCEEDING 1, GOVERNMENT_EMPLOYMENT 15, GOVERNMENT_STRUCTURE 9, GRANTS 73, OFFICIAL_ORGANIZATION 29, PROCUREMENT 92, PUBLIC_ADMIN 1, PUBLIC_MEETINGS 3, PUBLIC_RECORDS 42, RECORDS_MANAGEMENT 125, RULEMAKING 22.
 *
 * THE ONE CLAIM A MATCH LICENSES: "this phrase is attested government/public-administration terminology."
 * Not a semantic type, not a Keep, and NOT evidence of non-personhood --
 * `Band`, `Contractor`, `Grade`, `Notice`, `Record`,
 * `Risk`, `Role`, `Rule`, `Search`, `Series`, `State` and `Title` are all
 * attested here AND are ordinary English, Census-attested personal names,
 * or terminology in the legal / employment-HR / finance / higher-ed packs.
 * `Applicant`, `Contract`, `Claim`, `Disposition`, `Budget` and `Asset`
 * are attested here AND elsewhere, and both attestations are correct.
 *
 * REPRESENTATION: `DomainReferencePackAsset` (see DomainReferenceEvidence.ts
 * for the column contract). Intern tables plus a TAB-separated row block,
 * sorted by normalized key then source order. Intern-table order is
 * load-bearing: regenerating with a different order invalidates every row.
 */

import type { DomainReferencePackAsset } from "./DomainReferenceEvidence.js";

export const GOVERNMENT_SOURCE = "docscrub-government-public-admin-terminology/2026-08-10";
export const GOVERNMENT_ROW_COUNT = 412;
export const GOVERNMENT_TERM_COUNT = 409;

/** Pipe-separated hint combinations, verbatim from the source dataset.
 *  Index-addressed by row column 2. Order is load-bearing. */
const HINT_SETS: readonly string[] = [
  "ADMINISTRATIVE_PROCEEDING",
  "DATA_SYSTEM",
  "DOCUMENT",
  "DOCUMENT_SYSTEM",
  "EMPLOYMENT_ADMIN",
  "ENFORCEMENT_COMPLIANCE",
  "FISCAL_ADMIN",
  "GOVERNMENT_STRUCTURE",
  "IDENTIFIER_TYPE",
  "LEGAL_ADMIN",
  "ORGANIZATION",
  "OTHER_DOMAIN_TERM",
  "PROCESS_EVENT",
  "PROCUREMENT",
  "PROGRAM_ADMIN",
  "PROPERTY_ADMIN",
  "PUBLIC_SERVICE",
  "RECORDS_INFORMATION",
  "ROLE",
  "RULEMAKING",
];

/** Index-addressed by row column 3. Index 0 is "" -- no sub-domain. */
const SUB_DOMAINS: readonly string[] = [
  "",
  "ADMINISTRATIVE_PROCEEDING",
  "GOVERNMENT_EMPLOYMENT",
  "GOVERNMENT_STRUCTURE",
  "GRANTS",
  "OFFICIAL_ORGANIZATION",
  "PROCUREMENT",
  "PUBLIC_ADMIN",
  "PUBLIC_MEETINGS",
  "PUBLIC_RECORDS",
  "RECORDS_MANAGEMENT",
  "RULEMAKING",
];

/** Index-addressed by row column 4: [name, url, family, authorityLevel]. */
const SOURCES: readonly (readonly [string, string, string, string])[] = [
  ["Acquisition.gov — Federal Acquisition Regulation Part 2", "https://www.acquisition.gov/far/part-2", "FAR_PART_2", "HIGH"],
  ["FOIA.gov — Glossary", "https://www.foia.gov/data.html", "FOIA_GOV", "HIGH"],
  ["Grants.gov — Grant Terminology", "https://grants.gov/learn-grants/grant-terminology", "GRANTS_GOV", "HIGH"],
  ["NARA — Records Management Key Terms and Acronyms", "https://www.archives.gov/files/records-mgmt/rm-glossary-of-terms.pdf", "NARA_RM", "HIGH"],
  ["OPM — Classification & Qualifications", "https://www.opm.gov/policy-data-oversight/classification-qualifications/", "OPM_CLASSIFICATION", "HIGH"],
  ["Office of the Federal Register — Reader Aids / Rulemaking", "https://www.federalregister.gov/reader-aids", "FEDERAL_REGISTER", "HIGH"],
  ["USAGov — A-Z Index of U.S. Government Departments and Agencies", "https://www.usa.gov/agency-index", "USAGOV_AGENCIES", "HIGH"],
];

/** Shared pool for the sparse columns (source ids, parent terms, acronyms,
 *  acronym expansions, notes). Index 0 is "". */
const STRINGS: readonly string[] = [
  "",
  "AAC",
  "ACF",
  "ACHP",
  "ACUS",
  "AHRQ",
  "ALN",
  "AMS",
  "ANPRM",
  "AOR",
  "APAL",
  "ARC",
  "ARCIS",
  "ARO",
  "ARS",
  "ATF",
  "Activity Address Code",
  "Administration for Children and Families",
  "Administrative Conference of the United States",
  "Advance Notice of Proposed Rulemaking",
  "Advisory Council on Historic Preservation",
  "Agency Records Officer",
  "Agency for Healthcare Research and Quality",
  "Agricultural Marketing Service",
  "Agricultural Research Service",
  "Alcohol and Tobacco Tax and Trade Bureau",
  "Annual Publication of Assistance Listings",
  "Appalachian Regional Commission",
  "Archives Records Center Information System",
  "Assistance Listing Number",
  "Authorized Organization Representative",
  "BIA",
  "BPA",
  "Bureau of Alcohol, Tobacco, Firearms and Explosives",
  "Business Impact Analysis",
  "Business Process Analysis",
  "CAGE",
  "CFDA",
  "CFR indexing term",
  "CIO",
  "COR",
  "CPIC",
  "Capital Planning and Investment Control",
  "Catalog of Federal Domestic Assistance",
  "Chief Information Officer",
  "Commercial and Government Entity",
  "Commercial and Government Entity Code",
  "Contracting Officer's Representative",
  "DAA",
  "DAL",
  "DMA",
  "Disposition Authority Agency",
  "Disposition Authority Legacy",
  "Document Management Application",
  "E-Business Point of Contact",
  "EBiz POC",
  "EDMS",
  "EIS",
  "ERA",
  "ERK",
  "ERKS",
  "ERMS",
  "Electronic Document Management System",
  "Electronic Information System",
  "Electronic Recordkeeping",
  "Electronic Recordkeeping System",
  "Electronic Records Archives",
  "Electronic Records Management System",
  "Explicit acronym/abbreviation attested by source; parent expansion preserved.",
  "FAIN",
  "FAR 2.101",
  "FAR contract-dispute sense",
  "FAR cross-reference to acquisition",
  "FAR definition",
  "FAR provision/clause sense",
  "FAR-defined calendar-day term; high ambiguity",
  "FEA",
  "FFRDC",
  "FOA",
  "FOIA",
  "FOIA glossary sense",
  "FOIA retrieval sense; very ambiguous",
  "FON",
  "FRA",
  "FRC",
  "FRCP",
  "Federal Award Identification Number",
  "Federal Enterprise Architecture",
  "Federal Records Act",
  "Federal Records Center",
  "Federal Records Center Program",
  "Federal Register common indexing vocabulary",
  "Federal Register document type",
  "Federal Register notice subtype",
  "Federal Register publishing process",
  "Federally Funded Research and Development Centers",
  "Freedom of Information Act",
  "Funding Opportunity Announcement",
  "Funding Opportunity Number",
  "GRS",
  "General Records Schedules",
  "Grants.gov system term",
  "ICT",
  "IT",
  "Information Technology",
  "Information and Communication Technology",
  "LS",
  "Legacy Schedules",
  "MAC",
  "Multi-Agency Contract",
  "NARA",
  "NARA acronym table",
  "NARA internal-audit sense",
  "NPRM",
  "National Archives and Records Administration",
  "Notice of Proposed Rulemaking",
  "OPM classification FAQ",
  "OPM classification sense",
  "OPM occupational-series sense",
  "PBA",
  "PII",
  "PWS",
  "Performance Work Statement",
  "Performance-Based Acquisition",
  "Personally Identifiable Information",
  "QPL",
  "Qualified Products List",
  "R&D",
  "RM",
  "RMA",
  "Records Management",
  "Records Management Application",
  "Research and Development",
  "SAM",
  "SAO",
  "SF 115",
  "SFA",
  "SORN",
  "Senior Agency Official",
  "Standard Form 115",
  "Student Financial Aid",
  "System for Award Management",
  "System of Records Notice",
  "TTB",
  "U.S. Agency for International Development",
  "U.S. Arctic Research Commission",
  "U.S. Department of Agriculture",
  "USAID",
  "USARC",
  "USDA",
  "cross-domain higher-ed overlap",
  "explicit rulemaking acronym",
  "explicit source abbreviation",
  "explicit source acronym",
  "explicit source acronym; not a PII list",
  "finance overlap",
  "grant-source jurisdictional term",
  "grant-source sense; overlaps legal/procurement",
  "legacy source terminology",
  "official organization name",
  "official organization name; not generic terminology",
  "procurement criterion",
  "records scheduling sense",
  "records survey sense",
  "records transfer sense",
  "records-management sense",
  "source alias",
  "source alias for Cutoff",
  "source form",
  "source term",
  "source-attested glossary heading",
  "source-listed alternate",
  "very broad source term",
];

/** One line per attestation row, TAB-separated. Columns, in order:
 *  normalized, term, hintSetIdx, subDomainIdx, sourceIdx, sourceIdIdx,
 *  sourceAttested(0|1), derivedVariant(0|1), parentIdx, riskIdx,
 *  acronymIdx, acronymExpIdx, notesIdx */
const ROWS =
  "aac\tAAC\t8\t6\t0\t0\t1\t0\t16\t1\t1\t16\t68\naccess\tAccess\t17\t10\t3\t0\t1\t0\t0\t2\t0\t0\t0\naccession\tAccession\t12\t10\t3\t0\t1\t0\t0\t2\t0\t0\t0\nacf\tACF\t10\t5\t6\t0\t1\t0\t17\t1\t2\t17\t68\nachp\tACHP\t10\t5\t6\t0\t1\t0\t20\t1\t3\t20\t68\nacquisition\tAcquisition\t13\t6\t0\t0\t1\t0\t0\t2\t0\t0\t70\nacquisition planning\tAcquisition Planning\t12\t6\t0\t0\t1\t0\t0\t1\t0\t0\t0\nactive records\tActive Records\t17\t10\t3\t0\t1\t0\t0\t1\t0\t0\t0\nactivity address code\tActivity Address Code\t8\t6\t0\t0\t1\t0\t0\t1\t1\t16\t153\nacus\tACUS\t10\t5\t6\t0\t1\t0\t18\t1\t4\t18\t68\nadequate evidence\tAdequate Evidence\t9\t6\t0\t0\t1\t0\t0\t1\t0\t0\t0\nadministration for children and families\tAdministration for Children and Families\t10\t5\t6\t0\t1\t0\t0\t1\t2\t17\t159\nadministrative conference of the united states\tAdministrative Conference of the United States\t10\t5\t6\t0\t1\t0\t0\t1\t4\t18\t159\nadministrative foia appeal\tAdministrative FOIA Appeal\t0\t9\t1\t0\t1\t0\t0\t0\t0\t0\t0\nadministrative office of the u.s. courts\tAdministrative Office of the U.S. Courts\t10\t5\t6\t0\t1\t0\t0\t0\t0\t0\t159\nadministrative practice and procedure\tAdministrative Practice and Procedure\t19\t11\t5\t0\t1\t0\t0\t0\t0\t0\t38\nadministrative records\tAdministrative Records\t17\t10\t3\t0\t1\t0\t0\t1\t0\t0\t0\nadvance notice of proposed rulemaking\tAdvance Notice of Proposed Rulemaking\t19\t11\t5\t0\t1\t0\t0\t1\t8\t19\t151\nadvisory and assistance services\tAdvisory and Assistance Services\t13\t6\t0\t0\t1\t0\t0\t0\t0\t0\t0\nadvisory committees\tAdvisory Committees\t7\t8\t5\t0\t1\t0\t0\t1\t0\t0\t38\nadvisory council on historic preservation\tAdvisory Council on Historic Preservation\t10\t5\t6\t0\t1\t0\t0\t1\t3\t20\t159\naffiliates\tAffiliates\t10\t6\t0\t0\t1\t0\t0\t2\t0\t0\t0\nagency\tAgency\t7\t9\t1\t0\t1\t0\t0\t2\t0\t0\t80\nagency component\tAgency Component\t7\t9\t1\t0\t1\t0\t0\t1\t0\t0\t0\nagency docket\tAgency Docket\t3\t11\t5\t0\t1\t0\t0\t1\t0\t0\t0\nagency for healthcare research and quality\tAgency for Healthcare Research and Quality\t10\t5\t6\t0\t1\t0\t0\t1\t5\t22\t159\nagency head\tAgency Head\t18\t3\t0\t0\t1\t0\t0\t1\t0\t0\t0\nagency mission\tAgency Mission\t14\t10\t3\t0\t1\t0\t0\t1\t0\t0\t0\nagency record\tAgency Record\t17\t9\t1\t0\t1\t0\t0\t1\t0\t0\t0\nagency records officer\tAgency Records Officer\t18\t10\t3\t0\t1\t0\t0\t1\t13\t21\t153\nagency records schedule\tAgency Records Schedule\t2\t10\t3\t0\t1\t0\t0\t0\t0\t0\t0\nagency specific data sets\tAgency Specific Data Sets\t1\t4\t2\t0\t1\t0\t0\t0\t0\t0\t170\nagricultural marketing service\tAgricultural Marketing Service\t10\t5\t6\t0\t1\t0\t0\t1\t7\t23\t159\nagricultural research service\tAgricultural Research Service\t10\t5\t6\t0\t1\t0\t0\t1\t14\t24\t159\nahrq\tAHRQ\t10\t5\t6\t0\t1\t0\t22\t1\t5\t22\t68\nalcohol and tobacco tax and trade bureau\tAlcohol and Tobacco Tax and Trade Bureau\t10\t5\t6\t0\t1\t0\t0\t1\t143\t25\t159\nalienated records\tAlienated Records\t17\t10\t3\t0\t1\t0\t0\t1\t0\t0\t0\naln\tALN\t8\t4\t2\t0\t1\t0\t29\t1\t6\t29\t68\nalternate\tAlternate\t2\t6\t0\t0\t1\t0\t0\t2\t0\t0\t74\nams\tAMS\t10\t5\t6\t0\t1\t0\t23\t1\t7\t23\t68\nannual foia report\tAnnual FOIA Report\t2\t9\t1\t0\t1\t0\t0\t0\t0\t0\t0\nannual foia report handbook\tAnnual FOIA Report Handbook\t2\t9\t1\t0\t1\t0\t0\t0\t0\t0\t0\nannual publication of assistance listings\tAnnual Publication of Assistance Listings\t3\t4\t2\t0\t1\t0\t0\t1\t10\t26\t153\nanprm\tANPRM\t19\t11\t5\t0\t1\t0\t19\t1\t8\t19\t68\naor\tAOR\t18\t4\t2\t0\t1\t0\t30\t1\t9\t30\t68\napal\tAPAL\t3\t4\t2\t0\t1\t0\t26\t1\t10\t26\t68\nappalachian regional commission\tAppalachian Regional Commission\t10\t5\t6\t0\t1\t0\t0\t1\t11\t27\t159\napplicant\tApplicant\t18\t4\t2\t0\t1\t0\t0\t2\t0\t0\t0\napplication\tApplication\t2\t4\t2\t0\t1\t0\t0\t2\t0\t0\t0\napplication package template\tApplication Package Template\t3\t4\t2\t0\t1\t0\t0\t0\t0\t0\t0\narc\tARC\t10\t5\t6\t0\t1\t0\t27\t1\t11\t27\t68\narchitect-engineer services\tArchitect-Engineer Services\t13\t6\t0\t0\t1\t0\t0\t0\t0\t0\t0\narchives records center information system\tArchives Records Center Information System\t1\t10\t3\t0\t1\t0\t0\t1\t12\t28\t153\narcis\tARCIS\t1\t10\t3\t0\t1\t0\t28\t1\t12\t28\t68\naro\tARO\t18\t10\t3\t0\t1\t0\t21\t1\t13\t21\t68\nars\tARS\t10\t5\t6\t0\t1\t0\t24\t1\t14\t24\t68\nasset\tAsset\t15\t10\t3\t0\t1\t0\t0\t2\t0\t0\t0\nasset management\tAsset Management\t15\t10\t3\t0\t1\t0\t0\t1\t0\t0\t0\nassignment of claims\tAssignment of Claims\t6\t6\t0\t0\t1\t0\t0\t0\t0\t0\t0\nassistance listing number\tAssistance Listing Number\t8\t4\t2\t0\t1\t0\t0\t1\t6\t29\t153\nassistance listings\tAssistance Listings\t14\t4\t2\t0\t1\t0\t0\t1\t0\t0\t0\nassisted acquisition\tAssisted Acquisition\t13\t6\t0\t0\t1\t0\t0\t1\t0\t0\t0\natf\tATF\t10\t5\t6\t0\t1\t0\t33\t1\t15\t33\t68\nauthorized organization representative\tAuthorized Organization Representative\t18\t4\t2\t0\t1\t0\t0\t1\t9\t30\t153\naward\tAward\t14\t4\t2\t0\t1\t0\t0\t2\t0\t0\t0\nbacklog\tBacklog\t12\t9\t1\t0\t1\t0\t0\t2\t0\t0\t0\nband\tBand\t4\t2\t4\t0\t1\t0\t0\t2\t0\t0\t0\nbasic research\tBasic Research\t14\t6\t0\t0\t1\t0\t0\t1\t0\t0\t0\nbest value\tBest Value\t13\t6\t0\t0\t1\t0\t0\t1\t0\t0\t0\nbia\tBIA\t5\t10\t3\t0\t1\t0\t34\t1\t31\t34\t68\nbid sample\tBid Sample\t2\t6\t0\t0\t1\t0\t0\t1\t0\t0\t0\nbig bucket/large aggregation schedule\tBig Bucket/Large Aggregation Schedule\t2\t10\t3\t0\t1\t0\t0\t0\t0\t0\t0\nbiobased product\tBiobased Product\t13\t6\t0\t0\t1\t0\t0\t1\t0\t0\t0\nblocking\tBlocking\t12\t10\t3\t0\t1\t0\t0\t2\t0\t0\t162\nbpa\tBPA\t12\t10\t3\t0\t1\t0\t35\t1\t32\t35\t68\nbudget\tBudget\t6\t4\t2\t0\t1\t0\t0\t2\t0\t0\t0\nbureau of alcohol, tobacco, firearms and explosives\tBureau of Alcohol, Tobacco, Firearms and Explosives\t10\t5\t6\t0\t1\t0\t0\t1\t15\t33\t159\nbusiness impact analysis\tBusiness Impact Analysis\t5\t10\t3\t0\t1\t0\t0\t1\t31\t34\t111\nbusiness process analysis\tBusiness Process Analysis\t12\t10\t3\t0\t1\t0\t0\t1\t32\t35\t111\ncage\tCAGE\t8\t6\t0\t0\t1\t0\t46\t1\t36\t45\t68\ncage code\tCAGE Code\t8\t4\t2\t0\t1\t0\t0\t1\t0\t0\t0\ncapital planning and investment control\tCapital Planning and Investment Control\t6\t10\t3\t0\t1\t0\t0\t1\t41\t42\t111\ncase management system\tCase Management System\t1\t9\t1\t0\t1\t0\t0\t0\t0\t0\t0\ncatalog of federal domestic assistance\tCatalog of Federal Domestic Assistance\t3\t4\t2\t0\t1\t0\t0\t1\t37\t43\t158\ncertification of identity\tCertification of Identity\t2\t9\t1\t0\t1\t0\t0\t0\t0\t0\t0\ncfda\tCFDA\t3\t4\t2\t0\t1\t0\t43\t1\t37\t43\t68\ncfr indexing terms\tCFR Indexing Terms\t3\t11\t5\t0\t1\t0\t0\t0\t0\t0\t91\nchief foia officer\tChief FOIA Officer\t18\t9\t1\t0\t1\t0\t0\t0\t0\t0\t0\nchief information officer\tChief Information Officer\t18\t10\t3\t0\t1\t0\t0\t1\t39\t44\t111\ncio\tCIO\t18\t10\t3\t0\t1\t0\t44\t1\t39\t44\t68\nclaim\tClaim\t9\t6\t0\t0\t1\t0\t0\t2\t0\t0\t71\nclassified acquisition\tClassified Acquisition\t13\t6\t0\t0\t1\t0\t0\t1\t0\t0\t0\nclassified contract\tClassified Contract\t13\t6\t0\t0\t1\t0\t0\t1\t0\t0\t0\nclassified information\tClassified Information\t17\t6\t0\t0\t1\t0\t0\t1\t0\t0\t0\nclose date\tClose Date\t12\t4\t2\t0\t1\t0\t0\t1\t0\t0\t0\ncloseout\tCloseout\t12\t4\t2\t0\t1\t0\t0\t2\t0\t0\t0\ncloud computing\tCloud Computing\t1\t10\t3\t0\t1\t0\t0\t1\t0\t0\t0\ncognizant federal agency\tCognizant Federal Agency\t7\t6\t0\t0\t1\t0\t0\t0\t0\t0\t0\ncommercial and government entity code\tCommercial and Government Entity Code\t8\t6\t0\t0\t1\t0\t0\t1\t36\t45\t169\ncommercial component\tCommercial Component\t13\t6\t0\t0\t1\t0\t0\t1\t0\t0\t0\ncommercial computer software\tCommercial Computer Software\t13\t6\t0\t0\t1\t0\t0\t0\t0\t0\t0\ncommercial product\tCommercial Product\t13\t6\t0\t0\t1\t0\t0\t1\t0\t0\t0\ncommercial service\tCommercial Service\t13\t6\t0\t0\t1\t0\t0\t1\t0\t0\t0\ncompetition id\tCompetition ID\t8\t4\t2\t0\t1\t0\t0\t1\t0\t0\t0\ncompetitive service appointment\tCompetitive Service Appointment\t4\t2\t4\t0\t1\t0\t0\t0\t0\t0\t0\ncomprehensive schedule\tComprehensive Schedule\t2\t10\t3\t0\t1\t0\t0\t1\t0\t0\t0\ncomputer database\tComputer Database\t1\t6\t0\t0\t1\t0\t0\t1\t0\t0\t0\ncomputer software\tComputer Software\t13\t6\t0\t0\t1\t0\t0\t1\t0\t0\t0\ncomputer software documentation\tComputer Software Documentation\t2\t6\t0\t0\t1\t0\t0\t0\t0\t0\t0\ncongressional district\tCongressional District\t7\t4\t2\t0\t1\t0\t0\t1\t0\t0\t0\nconsent to subcontract\tConsent to Subcontract\t12\t6\t0\t0\t1\t0\t0\t0\t0\t0\t0\nconsolidated requirement\tConsolidated Requirement\t13\t6\t0\t0\t1\t0\t0\t1\t0\t0\t0\nconstruction\tConstruction\t13\t6\t0\t0\t1\t0\t0\t2\t0\t0\t0\ncontingent records\tContingent Records\t17\t10\t3\t0\t1\t0\t0\t1\t0\t0\t0\ncontinuation grant\tContinuation Grant\t14\t4\t2\t0\t1\t0\t0\t1\t0\t0\t0\ncontract\tContract\t13\t6\t0\t0\t1\t0\t0\t2\t0\t0\t73\ncontract\tContract\t13\t4\t2\t0\t1\t0\t0\t2\t0\t0\t157\ncontracting officer's representative\tContracting Officer's Representative\t18\t6\t0\t0\t1\t0\t0\t1\t40\t47\t153\ncontractor\tContractor\t18\t4\t2\t0\t1\t0\t0\t2\t0\t0\t0\ncooperative agreement\tCooperative Agreement\t14\t4\t2\t0\t1\t0\t0\t1\t0\t0\t0\ncor\tCOR\t18\t6\t0\t0\t1\t0\t47\t1\t40\t47\t68\ncost or pricing data\tCost or Pricing Data\t6\t6\t0\t0\t1\t0\t0\t0\t0\t0\t0\ncost realism\tCost Realism\t6\t6\t0\t0\t1\t0\t0\t1\t0\t0\t0\ncost sharing\tCost Sharing\t6\t6\t0\t0\t1\t0\t0\t1\t0\t0\t0\ncost sharing or matching\tCost Sharing or Matching\t6\t4\t2\t0\t1\t0\t0\t0\t0\t0\t0\ncpic\tCPIC\t6\t10\t3\t0\t1\t0\t42\t1\t41\t42\t68\ncrosswalk\tCrosswalk\t3\t10\t3\t0\t1\t0\t0\t2\t0\t0\t0\ncustody\tCustody\t17\t10\t3\t0\t1\t0\t0\t2\t0\t0\t0\ncutoff\tCutoff\t12\t10\t3\t0\t1\t0\t0\t2\t0\t0\t0\ndaa\tDAA\t8\t10\t3\t0\t1\t0\t51\t1\t48\t51\t68\ndal\tDAL\t8\t10\t3\t0\t1\t0\t52\t1\t49\t52\t68\ndata migration\tData Migration\t12\t10\t3\t0\t1\t0\t0\t1\t0\t0\t0\ndata other than certified cost or pricing data\tData Other Than Certified Cost or Pricing Data\t6\t6\t0\t0\t1\t0\t0\t0\t0\t0\t0\ndate of completion\tDate of Completion\t12\t4\t2\t0\t1\t0\t0\t0\t0\t0\t0\nday\tDay\t11\t6\t0\t0\t1\t0\t0\t2\t0\t0\t75\ndebarment\tDebarment\t5\t6\t0\t0\t1\t0\t0\t2\t0\t0\t0\ndegaussing\tDegaussing\t12\t10\t3\t0\t1\t0\t0\t2\t0\t0\t0\ndeletion\tDeletion\t12\t10\t3\t0\t1\t0\t0\t2\t0\t0\t0\ndelivery order\tDelivery Order\t2\t6\t0\t0\t1\t0\t0\t1\t0\t0\t0\ndepreciation\tDepreciation\t6\t6\t0\t0\t1\t0\t0\t2\t0\t0\t155\ndescriptive literature\tDescriptive Literature\t2\t6\t0\t0\t1\t0\t0\t1\t0\t0\t0\ndesign-to-cost\tDesign-to-Cost\t6\t6\t0\t0\t1\t0\t0\t0\t0\t0\t0\ndestruction\tDestruction\t12\t10\t3\t0\t1\t0\t0\t2\t0\t0\t0\ndigital\tDigital\t11\t10\t3\t0\t1\t0\t0\t2\t0\t0\t172\ndirect final rule\tDirect Final Rule\t19\t11\t5\t0\t1\t0\t0\t0\t0\t0\t0\ndirect offer\tDirect Offer\t12\t10\t3\t0\t1\t0\t0\t1\t0\t0\t0\ndiscretionary grant\tDiscretionary Grant\t14\t4\t2\t0\t1\t0\t0\t1\t0\t0\t0\ndisposal\tDisposal\t12\t10\t3\t0\t1\t0\t0\t2\t0\t0\t0\ndisposition\tDisposition\t12\t10\t3\t0\t1\t0\t0\t2\t0\t0\t0\ndisposition authority\tDisposition Authority\t9\t10\t3\t0\t1\t0\t0\t1\t0\t0\t0\ndisposition authority agency\tDisposition Authority Agency\t8\t10\t3\t0\t1\t0\t0\t1\t48\t51\t153\ndisposition authority legacy\tDisposition Authority Legacy\t8\t10\t3\t0\t1\t0\t0\t1\t49\t52\t153\ndma\tDMA\t1\t10\t3\t0\t1\t0\t53\t1\t50\t53\t68\ndocument management application\tDocument Management Application\t1\t10\t3\t0\t1\t0\t0\t1\t50\t53\t111\ndonation\tDonation\t12\t10\t3\t0\t1\t0\t0\t2\t0\t0\t0\ne-business point of contact\tE-Business Point of Contact\t18\t4\t2\t0\t1\t0\t0\t0\t55\t54\t152\ne-government\te-Government\t16\t10\t3\t0\t1\t0\t0\t1\t0\t0\t0\nearmark\tEarmark\t6\t4\t2\t0\t1\t0\t0\t2\t0\t0\t0\nebiz poc\tEBiz POC\t18\t4\t2\t0\t1\t0\t54\t1\t55\t54\t68\nedms\tEDMS\t1\t10\t3\t0\t1\t0\t62\t1\t56\t62\t68\neducational institutions\tEducational Institutions\t10\t9\t1\t0\t1\t0\t0\t1\t0\t0\t150\neffective date\tEffective Date\t12\t11\t5\t0\t1\t0\t0\t1\t0\t0\t0\neis\tEIS\t1\t10\t3\t0\t1\t0\t63\t1\t57\t63\t68\nelectronic case files\tElectronic Case Files\t1\t10\t3\t0\t1\t0\t0\t0\t0\t0\t0\nelectronic document management system\tElectronic Document Management System\t1\t10\t3\t0\t1\t0\t0\t1\t56\t62\t153\nelectronic information system\tElectronic Information System\t1\t10\t3\t0\t1\t0\t0\t1\t57\t63\t153\nelectronic mail\tElectronic Mail\t17\t10\t3\t0\t1\t0\t0\t1\t0\t0\t0\nelectronic recordkeeping\tElectronic Recordkeeping\t12\t10\t3\t0\t1\t0\t0\t1\t59\t64\t153\nelectronic recordkeeping system\tElectronic Recordkeeping System\t1\t10\t3\t0\t1\t0\t0\t1\t60\t65\t153\nelectronic records\tElectronic Records\t17\t10\t3\t0\t1\t0\t0\t1\t0\t0\t0\nelectronic records archives\tElectronic Records Archives\t1\t10\t3\t0\t1\t0\t0\t1\t58\t66\t153\nelectronic records management system\tElectronic Records Management System\t1\t10\t3\t0\t1\t0\t0\t1\t61\t67\t153\nelectronically stored information\tElectronically Stored Information\t17\t10\t3\t0\t1\t0\t0\t0\t0\t0\t0\nemulation\tEmulation\t12\t10\t3\t0\t1\t0\t0\t2\t0\t0\t0\nenergy savings performance contract\tEnergy Savings Performance Contract\t13\t6\t0\t0\t1\t0\t0\t0\t0\t0\t0\nenvironmentally preferable\tEnvironmentally Preferable\t5\t6\t0\t0\t1\t0\t0\t1\t0\t0\t161\nequivalent full-time foia employees\tEquivalent Full-Time FOIA Employees\t4\t9\t1\t0\t1\t0\t0\t0\t0\t0\t0\nera\tERA\t1\t10\t3\t0\t1\t0\t66\t1\t58\t66\t68\nerk\tERK\t12\t10\t3\t0\t1\t0\t64\t1\t59\t64\t68\nerks\tERKS\t1\t10\t3\t0\t1\t0\t65\t1\t60\t65\t68\nerms\tERMS\t1\t10\t3\t0\t1\t0\t67\t1\t61\t67\t68\nessential records management\tEssential Records Management\t17\t10\t3\t0\t1\t0\t0\t0\t0\t0\t0\nevaluation\tEvaluation\t5\t10\t3\t0\t1\t0\t0\t2\t0\t0\t112\nexcess personal property\tExcess Personal Property\t15\t6\t0\t0\t1\t0\t0\t0\t0\t0\t0\nexclusions\tExclusions\t9\t9\t1\t0\t1\t0\t0\t2\t0\t0\t0\nexecutive agency\tExecutive Agency\t7\t3\t0\t0\t1\t0\t0\t1\t0\t0\t0\nexemptions\tExemptions\t9\t9\t1\t0\t1\t0\t0\t2\t0\t0\t0\nexpanded authorized organization representative\tExpanded Authorized Organization Representative\t18\t4\t2\t0\t1\t0\t0\t1\t9\t30\t0\nexpedited processing\tExpedited Processing\t12\t9\t1\t0\t1\t0\t0\t1\t0\t0\t0\nfain\tFAIN\t8\t4\t2\t0\t1\t0\t86\t1\t69\t86\t68\nfea\tFEA\t1\t10\t3\t0\t1\t0\t87\t1\t76\t87\t68\nfederal agency\tFederal Agency\t7\t3\t0\t0\t1\t0\t0\t1\t0\t0\t0\nfederal agency\tFederal Agency\t7\t4\t2\t0\t1\t0\t0\t1\t0\t0\t0\nfederal award\tFederal Award\t14\t4\t2\t0\t1\t0\t0\t1\t0\t0\t0\nfederal award date\tFederal Award Date\t12\t4\t2\t0\t1\t0\t0\t0\t0\t0\t0\nfederal award identification number\tFederal Award Identification Number\t8\t4\t2\t0\t1\t0\t0\t1\t69\t86\t153\nfederal awarding agency\tFederal Awarding Agency\t7\t4\t2\t0\t1\t0\t0\t0\t0\t0\t0\nfederal enterprise architecture\tFederal Enterprise Architecture\t1\t10\t3\t0\t1\t0\t0\t1\t76\t87\t153\nfederal financial assistance\tFederal Financial Assistance\t14\t4\t2\t0\t1\t0\t0\t0\t0\t0\t0\nfederal position classification\tFederal Position Classification\t4\t2\t4\t0\t1\t0\t0\t0\t0\t0\t0\n" +
  "federal program\tFederal Program\t14\t4\t2\t0\t1\t0\t0\t1\t0\t0\t0\nfederal records act\tFederal Records Act\t9\t10\t3\t0\t1\t0\t0\t1\t83\t88\t153\nfederal records center\tFederal Records Center\t7\t10\t3\t0\t1\t0\t0\t1\t84\t89\t153\nfederal records center program\tFederal Records Center Program\t14\t10\t3\t0\t1\t0\t0\t1\t85\t90\t153\nfederal share\tFederal Share\t6\t4\t2\t0\t1\t0\t0\t1\t0\t0\t0\nfederal wage classification system\tFederal Wage Classification System\t4\t2\t4\t0\t1\t0\t0\t0\t0\t0\t0\nfederal wage system qualifications\tFederal Wage System Qualifications\t4\t2\t4\t0\t1\t0\t0\t0\t0\t0\t0\nfederally funded research and development centers\tFederally Funded Research and Development Centers\t10\t3\t0\t0\t1\t0\t0\t1\t77\t95\t153\nfederally-controlled facilities\tFederally-Controlled Facilities\t15\t3\t0\t0\t1\t0\t0\t0\t0\t0\t0\nfederally-controlled information system\tFederally-Controlled Information System\t1\t3\t0\t0\t1\t0\t0\t0\t0\t0\t0\nfee waiver\tFee Waiver\t6\t9\t1\t0\t1\t0\t0\t1\t0\t0\t0\nffrdc\tFFRDC\t10\t3\t0\t0\t1\t0\t95\t1\t77\t95\t68\nfile break\tFile Break\t12\t10\t3\t0\t1\t0\t0\t1\t0\t0\t167\nfile plan\tFile Plan\t2\t10\t3\t0\t1\t0\t0\t1\t0\t0\t0\nfiling system\tFiling System\t1\t10\t3\t0\t1\t0\t0\t1\t0\t0\t0\nfinal indirect cost rate\tFinal Indirect Cost Rate\t6\t6\t0\t0\t1\t0\t0\t0\t0\t0\t0\nfinal rule\tFinal Rule\t19\t11\t5\t0\t1\t0\t0\t1\t0\t0\t0\nfirst article\tFirst Article\t13\t6\t0\t0\t1\t0\t0\t1\t0\t0\t0\nfirst article testing\tFirst Article Testing\t12\t6\t0\t0\t1\t0\t0\t0\t0\t0\t0\nfirst-party request\tFirst-Party Request\t2\t9\t1\t0\t1\t0\t0\t0\t0\t0\t0\nflexible retention\tFlexible Retention\t12\t10\t3\t0\t1\t0\t0\t1\t0\t0\t0\nflexible schedule\tFlexible Schedule\t2\t10\t3\t0\t1\t0\t0\t1\t0\t0\t0\nfoa\tFOA\t2\t4\t2\t0\t1\t0\t97\t1\t78\t97\t68\nfoia\tFOIA\t9\t9\t1\t0\t1\t0\t0\t2\t79\t96\t153\nfoia contact\tFOIA Contact\t18\t9\t1\t0\t1\t0\t0\t1\t0\t0\t0\nfoia library\tFOIA Library\t3\t9\t1\t0\t1\t0\t0\t1\t0\t0\t0\nfoia public liaison\tFOIA Public Liaison\t18\t9\t1\t0\t1\t0\t0\t0\t0\t0\t0\nfoia request\tFOIA Request\t2\t9\t1\t0\t1\t0\t0\t1\t0\t0\t0\nfoia requester service center\tFOIA Requester Service Center\t7\t9\t1\t0\t1\t0\t0\t0\t0\t0\t0\nfon\tFON\t8\t4\t2\t0\t1\t0\t98\t1\t82\t98\t68\nformal comment\tFormal Comment\t12\t11\t5\t0\t1\t0\t0\t1\t0\t0\t0\nformula grant\tFormula Grant\t14\t4\t2\t0\t1\t0\t0\t1\t0\t0\t0\nfra\tFRA\t9\t10\t3\t0\t1\t0\t88\t1\t83\t88\t68\nfrc\tFRC\t7\t10\t3\t0\t1\t0\t89\t1\t84\t89\t68\nfrcp\tFRCP\t14\t10\t3\t0\t1\t0\t90\t1\t85\t90\t68\nfrozen records\tFrozen Records\t17\t10\t3\t0\t1\t0\t0\t1\t0\t0\t0\nfunctional arrangement\tFunctional Arrangement\t12\t10\t3\t0\t1\t0\t0\t1\t0\t0\t0\nfunding opportunity announcement\tFunding Opportunity Announcement\t2\t4\t2\t0\t1\t0\t0\t1\t78\t97\t153\nfunding opportunity number\tFunding Opportunity Number\t8\t4\t2\t0\t1\t0\t0\t1\t82\t98\t153\nfunding period\tFunding Period\t6\t4\t2\t0\t1\t0\t0\t1\t0\t0\t0\ngeneral records schedules\tGeneral Records Schedules\t2\t10\t3\t0\t1\t0\t0\t1\t99\t100\t153\ngeneral schedule\tGeneral Schedule\t4\t2\t4\t0\t1\t0\t0\t1\t0\t0\t0\ngrace period\tGrace Period\t12\t4\t2\t0\t1\t0\t0\t1\t0\t0\t0\ngrade\tGrade\t4\t2\t4\t0\t1\t0\t0\t2\t0\t0\t0\ngrant agreement\tGrant Agreement\t2\t4\t2\t0\t1\t0\t0\t1\t0\t0\t0\ngrs\tGRS\t2\t10\t3\t0\t1\t0\t100\t1\t99\t100\t68\nhead of the agency\tHead of the Agency\t18\t3\t0\t0\t1\t0\t0\t0\t0\t0\t171\nict\tICT\t1\t6\t0\t0\t1\t0\t105\t1\t102\t105\t68\ninactive records\tInactive Records\t17\t10\t3\t0\t1\t0\t0\t1\t0\t0\t0\nindirect cost\tIndirect Cost\t6\t6\t0\t0\t1\t0\t0\t1\t0\t0\t0\nindirect cost rate\tIndirect Cost Rate\t6\t6\t0\t0\t1\t0\t0\t0\t0\t0\t0\nineligible\tIneligible\t5\t6\t0\t0\t1\t0\t0\t2\t0\t0\t0\ninformal rulemaking\tInformal Rulemaking\t19\t11\t5\t0\t1\t0\t0\t1\t0\t0\t0\ninformation and communication technology\tInformation and Communication Technology\t1\t6\t0\t0\t1\t0\t0\t1\t102\t105\t153\ninformation security\tInformation Security\t17\t6\t0\t0\t1\t0\t0\t1\t0\t0\t0\ninformation system\tInformation System\t1\t10\t3\t0\t1\t0\t0\t1\t0\t0\t0\ninformation technology\tInformation Technology\t1\t6\t0\t0\t1\t0\t0\t1\t103\t104\t0\ninherently governmental function\tInherently Governmental Function\t7\t7\t0\t0\t1\t0\t0\t0\t0\t0\t0\ninspection\tInspection\t5\t10\t3\t0\t1\t0\t0\t2\t0\t0\t0\ninterim final rule\tInterim Final Rule\t19\t11\t5\t0\t1\t0\t0\t0\t0\t0\t0\ninventory\tInventory\t12\t10\t3\t0\t1\t0\t0\t2\t0\t0\t163\nit\tIT\t1\t6\t0\t0\t1\t0\t104\t1\t103\t104\t68\njob grading\tJob Grading\t4\t2\t4\t0\t1\t0\t0\t1\t0\t0\t0\njob opportunity announcement\tJob Opportunity Announcement\t2\t2\t4\t0\t1\t0\t0\t0\t0\t0\t0\nlegacy schedules\tLegacy Schedules\t2\t10\t3\t0\t1\t0\t0\t1\t106\t107\t153\nlocal government\tLocal Government\t7\t4\t2\t0\t1\t0\t0\t1\t0\t0\t0\nls\tLS\t2\t10\t3\t0\t1\t0\t107\t1\t106\t107\t68\nmac\tMAC\t13\t6\t0\t0\t1\t0\t109\t1\t108\t109\t68\nmandatory form\tMandatory Form\t2\t4\t2\t0\t1\t0\t0\t1\t0\t0\t0\nmandatory grant\tMandatory Grant\t14\t4\t2\t0\t1\t0\t0\t1\t0\t0\t0\nmicro-purchase\tMicro-Purchase\t13\t6\t0\t0\t1\t0\t0\t1\t0\t0\t0\nmicro-purchase threshold\tMicro-Purchase Threshold\t13\t6\t0\t0\t1\t0\t0\t0\t0\t0\t0\nmulti-agency contract\tMulti-Agency Contract\t13\t6\t0\t0\t1\t0\t0\t1\t108\t109\t153\nmultiple-award contract\tMultiple-Award Contract\t13\t6\t0\t0\t1\t0\t0\t0\t0\t0\t0\nnara\tNARA\t10\t5\t6\t0\t1\t0\t114\t1\t110\t114\t68\nnational archives and records administration\tNational Archives and Records Administration\t10\t5\t6\t0\t1\t0\t0\t1\t110\t114\t159\nnational defense\tNational Defense\t14\t3\t0\t0\t1\t0\t0\t1\t0\t0\t0\nnear-line storage\tNear-Line Storage\t1\t10\t3\t0\t1\t0\t0\t0\t0\t0\t0\nneutral person\tNeutral Person\t18\t1\t0\t0\t1\t0\t0\t1\t0\t0\t0\nnon-federal entity\tNon-Federal Entity\t7\t4\t2\t0\t1\t0\t0\t0\t0\t0\t0\nnoncommercial scientific institution\tNoncommercial Scientific Institution\t10\t9\t1\t0\t1\t0\t0\t0\t0\t0\t0\nnondevelopmental item\tNondevelopmental Item\t13\t6\t0\t0\t1\t0\t0\t1\t0\t0\t0\nnonprofit organization\tNonprofit Organization\t10\t4\t2\t0\t1\t0\t0\t1\t0\t0\t0\nnonrecord materials\tNonrecord Materials\t17\t10\t3\t0\t1\t0\t0\t1\t0\t0\t0\nnotice\tNotice\t2\t11\t5\t0\t1\t0\t0\t2\t0\t0\t92\nnotice of proposed rulemaking\tNotice of Proposed Rulemaking\t19\t11\t5\t0\t1\t0\t0\t1\t113\t115\t151\nnotice-and-comment rulemaking\tNotice-and-Comment Rulemaking\t19\t11\t5\t0\t1\t0\t0\t0\t0\t0\t0\nnovation agreement\tNovation Agreement\t2\t6\t0\t0\t1\t0\t0\t1\t0\t0\t0\nnprm\tNPRM\t19\t11\t5\t0\t1\t0\t115\t1\t113\t115\t68\nobligations\tObligations\t6\t4\t2\t0\t1\t0\t0\t2\t0\t0\t0\noffer\tOffer\t13\t6\t0\t0\t1\t0\t0\t2\t0\t0\t0\nofferor\tOfferor\t18\t6\t0\t0\t1\t0\t0\t2\t0\t0\t0\nopportunity category\tOpportunity Category\t1\t4\t2\t0\t1\t0\t0\t1\t0\t0\t0\nopportunity package\tOpportunity Package\t3\t4\t2\t0\t1\t0\t0\t1\t0\t0\t0\noptional forms\tOptional Forms\t2\t4\t2\t0\t1\t0\t0\t1\t0\t0\t0\norganization applicant\tOrganization Applicant\t18\t4\t2\t0\t1\t0\t0\t1\t0\t0\t0\norganizational arrangement\tOrganizational Arrangement\t12\t10\t3\t0\t1\t0\t0\t1\t0\t0\t0\noversight agency for audit\tOversight Agency for Audit\t7\t4\t2\t0\t1\t0\t0\t0\t0\t0\t0\npartial grant/partial denial\tPartial Grant/Partial Denial\t12\t9\t1\t0\t1\t0\t0\t0\t0\t0\t0\npast performance\tPast Performance\t13\t6\t0\t0\t1\t0\t0\t1\t0\t0\t0\npay system\tPay System\t4\t2\t4\t0\t1\t0\t0\t1\t0\t0\t0\npba\tPBA\t13\t6\t0\t0\t1\t0\t123\t1\t119\t123\t68\npending request or pending appeal\tPending Request or Pending Appeal\t12\t9\t1\t0\t1\t0\t0\t0\t0\t0\t0\nperfected request\tPerfected Request\t2\t9\t1\t0\t1\t0\t0\t1\t0\t0\t0\nperformance work statement\tPerformance Work Statement\t2\t6\t0\t0\t1\t0\t0\t1\t121\t122\t153\nperformance-based acquisition\tPerformance-Based Acquisition\t13\t6\t0\t0\t1\t0\t0\t1\t119\t123\t153\npermanent record\tPermanent Record\t17\t10\t3\t0\t1\t0\t0\t1\t0\t0\t0\npersonal papers\tPersonal Papers\t17\t10\t3\t0\t1\t0\t0\t1\t0\t0\t0\npersonal services contract\tPersonal Services Contract\t13\t6\t0\t0\t1\t0\t0\t0\t0\t0\t0\npersonally identifiable information\tPersonally Identifiable Information\t17\t9\t1\t0\t1\t0\t0\t1\t120\t124\t154\npetition for rulemaking\tPetition for Rulemaking\t2\t11\t5\t0\t1\t0\t0\t0\t0\t0\t0\npii\tPII\t17\t9\t1\t0\t1\t0\t124\t1\t120\t124\t68\nplant clearance officer\tPlant Clearance Officer\t18\t6\t0\t0\t1\t0\t0\t0\t0\t0\t0\nposition classification\tPosition Classification\t4\t2\t4\t0\t1\t0\t0\t1\t0\t0\t116\nposition classification standards\tPosition Classification Standards\t2\t2\t4\t0\t1\t0\t0\t0\t0\t0\t0\npre-accessioning\tPre-Accessioning\t12\t10\t3\t0\t1\t0\t0\t1\t0\t0\t0\npreaward survey\tPreaward Survey\t12\t6\t0\t0\t1\t0\t0\t1\t0\t0\t0\npresidential document\tPresidential Document\t2\t11\t5\t0\t1\t0\t0\t1\t0\t0\t92\npricing\tPricing\t6\t6\t0\t0\t1\t0\t0\t2\t0\t0\t0\nproactive disclosures\tProactive Disclosures\t16\t9\t1\t0\t1\t0\t0\t1\t0\t0\t0\nprocessed request or processed appeal\tProcessed Request or Processed Appeal\t12\t9\t1\t0\t1\t0\t0\t0\t0\t0\t0\nprocurement\tProcurement\t13\t6\t0\t0\t1\t0\t0\t2\t0\t0\t72\nprocuring activity\tProcuring Activity\t7\t6\t0\t0\t1\t0\t0\t1\t0\t0\t0\nprogram records\tProgram Records\t17\t10\t3\t0\t1\t0\t0\t1\t0\t0\t0\nproper invoice\tProper Invoice\t2\t6\t0\t0\t1\t0\t0\t1\t0\t0\t0\nproposed rule\tProposed Rule\t19\t11\t5\t0\t1\t0\t0\t1\t0\t0\t92\npublic comment\tPublic Comment\t12\t11\t5\t0\t1\t0\t0\t1\t0\t0\t0\npublic hearing\tPublic Hearing\t0\t8\t5\t0\t1\t0\t0\t1\t0\t0\t0\npublic inspection\tPublic Inspection\t12\t11\t5\t0\t1\t0\t0\t1\t0\t0\t94\npurchase order\tPurchase Order\t2\t6\t0\t0\t1\t0\t0\t1\t0\t0\t0\npws\tPWS\t2\t6\t0\t0\t1\t0\t122\t1\t121\t122\t68\nqpl\tQPL\t3\t6\t0\t0\t1\t0\t126\t1\t125\t126\t68\nqualification requirement\tQualification Requirement\t5\t6\t0\t0\t1\t0\t0\t1\t0\t0\t0\nqualification requirements\tQualification Requirements\t4\t2\t4\t0\t1\t0\t0\t1\t0\t0\t0\nqualified products list\tQualified Products List\t3\t6\t0\t0\t1\t0\t0\t1\t125\t126\t153\nr&d\tR&D\t14\t4\t2\t0\t1\t0\t132\t1\t127\t132\t68\nrecipient\tRecipient\t18\t4\t2\t0\t1\t0\t0\t2\t0\t0\t0\nrecord\tRecord\t17\t10\t3\t0\t1\t0\t0\t2\t0\t0\t0\nrecord series\tRecord Series\t17\t10\t3\t0\t1\t0\t0\t1\t0\t0\t0\nrecord values\tRecord Values\t17\t10\t3\t0\t1\t0\t0\t1\t0\t0\t0\nrecorded information\tRecorded Information\t17\t10\t3\t0\t1\t0\t0\t1\t0\t0\t0\nrecords management\tRecords Management\t17\t10\t3\t0\t1\t0\t0\t1\t128\t130\t111\nrecords management application\tRecords Management Application\t1\t10\t3\t0\t1\t0\t0\t1\t129\t131\t111\nrecords retention\tRecords Retention\t12\t10\t3\t0\t1\t0\t0\t1\t0\t0\t0\nrecords schedule\tRecords Schedule\t2\t10\t3\t0\t1\t0\t0\t1\t0\t0\t0\nrecords schedule item\tRecords Schedule Item\t2\t10\t3\t0\t1\t0\t0\t0\t0\t0\t0\nregulatory text\tRegulatory Text\t2\t11\t5\t0\t1\t0\t0\t1\t0\t0\t0\nrequest for records disposition authority\tRequest for Records Disposition Authority\t2\t10\t3\t0\t1\t0\t0\t0\t0\t0\t0\nrequester\tRequester\t18\t9\t1\t0\t1\t0\t0\t2\t0\t0\t0\nrequester category\tRequester Category\t18\t9\t1\t0\t1\t0\t0\t1\t0\t0\t0\nresearch and development\tResearch and Development\t14\t4\t2\t0\t1\t0\t0\t1\t127\t132\t152\nretention\tRetention\t12\t10\t3\t0\t1\t0\t0\t2\t0\t0\t0\nretirement\tRetirement\t12\t10\t3\t0\t1\t0\t0\t2\t0\t0\t164\nreview fees\tReview Fees\t6\t9\t1\t0\t1\t0\t0\t1\t0\t0\t0\nrisk\tRisk\t11\t10\t3\t0\t1\t0\t0\t2\t0\t0\t0\nrisk analysis\tRisk Analysis\t5\t10\t3\t0\t1\t0\t0\t1\t0\t0\t0\nrisk assessment\tRisk Assessment\t5\t10\t3\t0\t1\t0\t0\t1\t0\t0\t0\nrisk factor\tRisk Factor\t5\t10\t3\t0\t1\t0\t0\t1\t0\t0\t0\nrisk management\tRisk Management\t5\t10\t3\t0\t1\t0\t0\t1\t0\t0\t0\nrm\tRM\t17\t10\t3\t0\t1\t0\t130\t1\t128\t130\t68\nrma\tRMA\t1\t10\t3\t0\t1\t0\t131\t1\t129\t131\t68\nrole\tRole\t18\t4\t2\t0\t1\t0\t0\t2\t0\t0\t101\nrole manager\tRole Manager\t18\t4\t2\t0\t1\t0\t0\t1\t0\t0\t0\nrule\tRule\t19\t11\t5\t0\t1\t0\t0\t2\t0\t0\t92\nsam\tSAM\t3\t4\t2\t0\t1\t0\t141\t1\t133\t141\t68\nsao\tSAO\t18\t10\t3\t0\t1\t0\t138\t1\t134\t138\t68\nscheduled records\tScheduled Records\t17\t10\t3\t0\t1\t0\t0\t1\t0\t0\t0\nscheduling\tScheduling\t12\t10\t3\t0\t1\t0\t0\t2\t0\t0\t165\nsearch\tSearch\t12\t9\t1\t0\t1\t0\t0\t2\t0\t0\t81\nsearch fees\tSearch Fees\t6\t9\t1\t0\t1\t0\t0\t1\t0\t0\t0\nsenior agency official\tSenior Agency Official\t18\t10\t3\t0\t1\t0\t0\t1\t134\t138\t153\nseries\tSeries\t17\t10\t3\t0\t1\t0\t0\t2\t0\t0\t166\nseries\tSeries\t4\t2\t4\t0\t1\t0\t0\t2\t0\t0\t118\nsf 115\tSF 115\t2\t10\t3\t0\t1\t0\t139\t1\t135\t139\t68\nsfa\tSFA\t14\t4\t2\t0\t1\t0\t140\t1\t136\t140\t68\nshared drives\tShared Drives\t1\t10\t3\t0\t1\t0\t0\t1\t0\t0\t0\nsimple request\tSimple Request\t2\t9\t1\t0\t1\t0\t0\t1\t0\t0\t0\nsimplified acquisition procedures\tSimplified Acquisition Procedures\t13\t6\t0\t0\t1\t0\t0\t0\t0\t0\t0\nsimplified acquisition threshold\tSimplified Acquisition Threshold\t13\t6\t0\t0\t1\t0\t0\t0\t0\t0\t0\nsingle, governmentwide point of entry\tSingle, Governmentwide Point of Entry\t1\t6\t0\t0\t1\t0\t0\t0\t0\t0\t0\nsmall business concern\tSmall Business Concern\t10\t6\t0\t0\t1\t0\t0\t0\t0\t0\t0\nsmall business subcontractor\tSmall Business Subcontractor\t18\t6\t0\t0\t1\t0\t0\t0\t0\t0\t0\nsmall business teaming arrangement\tSmall Business Teaming Arrangement\t13\t6\t0\t0\t1\t0\t0\t0\t0\t0\t0\nsmall disadvantaged business concern\tSmall Disadvantaged Business Concern\t10\t6\t0\t0\t1\t0\t0\t0\t0\t0\t0\nsocial media\tSocial Media\t1\t10\t3\t0\t1\t0\t0\t1\t0\t0\t0\nsole source acquisition\tSole Source Acquisition\t13\t6\t0\t0\t1\t0\t0\t0\t0\t0\t0\nsorn\tSORN\t2\t9\t5\t0\t1\t0\t142\t1\t137\t142\t68\nspecial records/special media\tSpecial Records/Special Media\t17\t10\t3\t0\t1\t0\t0\t0\t0\t0\t0\nstakeholder\tStakeholder\t18\t10\t3\t0\t1\t0\t0\t2\t0\t0\t0\nstandard authorized organization representative\tStandard Authorized Organization Representative\t18\t4\t2\t0\t1\t0\t0\t1\t9\t30\t0\nstandard form 115\tStandard Form 115\t2\t10\t3\t0\t1\t0\t0\t1\t135\t139\t168\nstate\tState\t7\t4\t2\t0\t1\t0\t0\t2\t0\t0\t156\nstudent financial aid\tStudent Financial Aid\t14\t4\t2\t0\t1\t0\t0\t1\t136\t140\t150\nsubaward\tSubaward\t14\t4\t2\t0\t1\t0\t0\t2\t0\t0\t0\nsubrecipient\tSubrecipient\t18\t4\t2\t0\t1\t0\t0\t2\t0\t0\t0\nsunshine act meeting notice\tSunshine Act Meeting Notice\t2\t8\t5\t0\t1\t0\t0\t0\t0\t0\t93\nsynopsis of funding opportunity\tSynopsis of Funding Opportunity\t2\t4\t2\t0\t1\t0\t0\t0\t0\t0\t0\nsystem for award management\tSystem for Award Management\t3\t4\t2\t0\t1\t0\t0\t1\t133\t141\t153\nsystem of records notice\tSystem of Records Notice\t2\t9\t5\t0\t1\t0\t0\t1\t137\t142\t93\nthird party request\tThird Party Request\t2\t9\t1\t0\t1\t0\t0\t0\t0\t0\t0\n" +
  "title\tTitle\t4\t2\t4\t0\t1\t0\t0\t2\t0\t0\t117\ntotal number of full-time foia staff\tTotal Number of Full-Time FOIA Staff\t4\t9\t1\t0\t1\t0\t0\t0\t0\t0\t0\nttb\tTTB\t10\t5\t6\t0\t1\t0\t25\t1\t143\t25\t68\nu.s. access board\tU.S. Access Board\t10\t5\t6\t0\t1\t0\t0\t0\t0\t0\t160\nu.s. agency for international development\tU.S. Agency for International Development\t10\t5\t6\t0\t1\t0\t0\t1\t147\t144\t159\nu.s. arctic research commission\tU.S. Arctic Research Commission\t10\t5\t6\t0\t1\t0\t0\t1\t148\t145\t159\nu.s. army corps of engineers\tU.S. Army Corps of Engineers\t10\t5\t6\t0\t1\t0\t0\t0\t0\t0\t159\nu.s. department of agriculture\tU.S. Department of Agriculture\t10\t5\t6\t0\t1\t0\t0\t1\t149\t146\t159\nunusual circumstances\tUnusual Circumstances\t9\t9\t1\t0\t1\t0\t0\t1\t0\t0\t0\nusaid\tUSAID\t10\t5\t6\t0\t1\t0\t144\t1\t147\t144\t68\nusarc\tUSARC\t10\t5\t6\t0\t1\t0\t145\t1\t148\t145\t68\nusda\tUSDA\t10\t5\t6\t0\t1\t0\t146\t1\t149\t146\t68";

/**
 * SOURCE LICENSING AND RETRIEVAL, one row per source family:
 *   [sourceFamily, sourceTier, licenseStatus, retrievalDate]
 *
 * `sourceTier` is "" for packs whose dataset ships no tier grade; the licence
 * and retrieval date are what every such pack carries and they are the two
 * that matter for redistribution.
 *
 * A SIDE TABLE, not a row column, for two reasons. These values are constant
 * per source family in the dataset (the generator asserts it), so per-row
 * storage would be 412 copies of 7 facts. And
 * licensing is provenance ABOUT a dataset, not evidence about a phrase --
 * folding it into `notes` would put it in front of reviewers, who are reading
 * that field to judge a candidate.
 *
 * Downstream redistribution should carry this attribution forward.
 */
export const GOVERNMENT_SOURCE_LICENSING: readonly (readonly [string, string, string, string])[] = [
  ["FAR_PART_2", "", "US_GOVERNMENT_WORK; definitions not redistributed", "2026-08-10"],
  ["FEDERAL_REGISTER", "", "US_GOVERNMENT_WORK; terminology only", "2026-08-10"],
  ["FOIA_GOV", "", "DOJ_PUBLIC_DOMAIN_UNLESS_INDICATED; definitions not redistributed", "2026-08-10"],
  ["GRANTS_GOV", "", "US_GOVERNMENT_WORK; definitions not redistributed", "2026-08-10"],
  ["NARA_RM", "", "NARA_US_GOVERNMENT_WORK_CC0; definitions not redistributed", "2026-08-10"],
  ["OPM_CLASSIFICATION", "", "US_GOVERNMENT_WORK; terminology only", "2026-08-10"],
  ["USAGOV_AGENCIES", "", "US_GOVERNMENT_WORK; official organization names only", "2026-08-10"],
];

/**
 * SOURCE AUTHORITY, one row per source family: [sourceFamily, authority]
 *
 * The source family is the machine key an attestation carries; this names the
 * body behind it in the words the dataset used. Constant per family (the
 * generator asserts it), so it is stored once per family rather than
 * 412 times. An audit path that wants to print "why does DocScrub
 * say this is government/public-administration terminology" resolves it here.
 */
export const GOVERNMENT_SOURCE_AUTHORITIES: readonly (readonly [string, string])[] = [
  ["FAR_PART_2", "Federal Acquisition Regulation"],
  ["FEDERAL_REGISTER", "Office of the Federal Register"],
  ["FOIA_GOV", "U.S. Department of Justice, Office of Information Policy"],
  ["GRANTS_GOV", "U.S. federal government grants portal"],
  ["NARA_RM", "National Archives and Records Administration"],
  ["OPM_CLASSIFICATION", "U.S. Office of Personnel Management"],
  ["USAGOV_AGENCIES", "USAGov / U.S. General Services Administration"],
];

/**
 * The `jurisdiction` every row in this pack carries -- asserted
 * single-valued at generation. A pack-level constant rather than a row
 * column, because storing one value 412 times would have meant
 * widening `DomainReferencePackAsset` and regenerating every other pack's
 * asset to carry a field that does not vary.
 *
 * IF A LATER VERSION OF THIS DATASET VARIES IT, the generator stops. That is
 * deliberate: the conversion to a row column is a shared-contract change and
 * should be a decision, not a silent widening.
 */
export const GOVERNMENT_JURISDICTION = "US_FEDERAL";

/** The pack asset. Consumed by GovernmentPublicAdminEvidence.ts,
 *  which owns this pack's normalization policy and its evidence contract. */
export const GOVERNMENT_PACK: DomainReferencePackAsset = {
  source: GOVERNMENT_SOURCE,
  rowCount: GOVERNMENT_ROW_COUNT,
  termCount: GOVERNMENT_TERM_COUNT,
  rows: ROWS,
  hintSets: HINT_SETS,
  subDomains: SUB_DOMAINS,
  sources: SOURCES,
  strings: STRINGS,
};
