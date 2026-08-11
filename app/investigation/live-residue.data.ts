/**
 * live-residue.data.ts -- INVESTIGATION ONLY.
 *
 * The ACTUAL C1 residue from Andrew's 2026-08-10 live run of
 * `__docscrub.people()`: 139 units, with production's own occurrence counts
 * and standalone/contextual split, transcribed verbatim from section 1 of
 * that output. This replaces the documented-sample population the first
 * counterfactual used.
 *
 * Live totals from the same run, for calibration:
 *   person-typed candidates      569
 *   Item Check -> People         220
 *   C1 (semanticTypeFor)         139
 *   C2 (any person evidence)      36
 *   C3 (strong / corroborated)     2
 *   total occurrences           5843
 *
 * WHAT THIS FILE DOES NOT HAVE, and why the browser diagnostic still matters:
 * per-candidate contextual-evidence rules, ambiguity/entity-group links, and
 * real occurrence context strings. Any feature below that needs those is
 * computed live, not here.
 */

export interface LiveResidueUnit {
  value: string;
  standalone: number;
  contextual: number;
  /** Andrew's reading where he has given one; "?" otherwise. Used ONLY for
   *  scoring safety/utility, never as an input to any rule. */
  truth: "person" | "non-person" | "?";
}

export const LIVE_RESIDUE: LiveResidueUnit[] = [
  { value: "Goodloe, Andrew", standalone: 355, contextual: 387, truth: "person" },
  { value: "Perias, Nelly", standalone: 0, contextual: 724, truth: "person" },
  { value: "Yamada, Tamara", standalone: 252, contextual: 295, truth: "person" },
  { value: "Collier, Tanesha", standalone: 196, contextual: 204, truth: "person" },
  { value: "Andrew", standalone: 12, contextual: 58, truth: "person" },
  { value: "Tamara", standalone: 7, contextual: 36, truth: "person" },
  { value: "Margaret", standalone: 1, contextual: 39, truth: "person" },
  { value: "Tanesha", standalone: 9, contextual: 30, truth: "person" },
  { value: "Nelly", standalone: 1, contextual: 20, truth: "person" },
  { value: "Grade Rosters", standalone: 0, contextual: 11, truth: "non-person" },
  { value: "Patrick", standalone: 0, contextual: 10, truth: "person" },
  { value: "Joan", standalone: 0, contextual: 9, truth: "person" },
  { value: "Academic Senate", standalone: 0, contextual: 8, truth: "non-person" },
  { value: "Gustavo", standalone: 0, contextual: 7, truth: "person" },
  { value: "Julie", standalone: 0, contextual: 6, truth: "person" },
  { value: "Cobb, Christopher", standalone: 2, contextual: 3, truth: "person" },
  { value: "Term Withdrawals", standalone: 0, contextual: 5, truth: "non-person" },
  { value: "San Diego", standalone: 0, contextual: 4, truth: "non-person" },
  { value: "Amy Miller", standalone: 0, contextual: 4, truth: "person" },
  { value: "Last Day", standalone: 0, contextual: 4, truth: "non-person" },
  { value: "Smart Planner", standalone: 0, contextual: 4, truth: "non-person" },
  { value: "Final Exams", standalone: 0, contextual: 4, truth: "non-person" },
  { value: "Diana", standalone: 0, contextual: 4, truth: "person" },
  { value: "Sarah", standalone: 0, contextual: 4, truth: "person" },
  { value: "External Education", standalone: 0, contextual: 3, truth: "non-person" },
  { value: "Christopher", standalone: 2, contextual: 1, truth: "person" },
  { value: "Chriztopher Johnson", standalone: 0, contextual: 3, truth: "person" },
  { value: "Happy Birthday Eve", standalone: 1, contextual: 2, truth: "non-person" },
  { value: "Message List", standalone: 3, contextual: 0, truth: "non-person" },
  { value: "New Student", standalone: 0, contextual: 3, truth: "non-person" },
  { value: "Student Final Exam", standalone: 0, contextual: 3, truth: "non-person" },
  { value: "Degree Planner", standalone: 0, contextual: 2, truth: "non-person" },
  { value: "Evelyn, Joaquin", standalone: 0, contextual: 2, truth: "person" },
  { value: "Francis, Kyle", standalone: 0, contextual: 2, truth: "person" },
  { value: "Chris, Margaret", standalone: 0, contextual: 2, truth: "person" },
  { value: "Everyone, Same", standalone: 0, contextual: 2, truth: "non-person" },
  { value: "San Marcos", standalone: 0, contextual: 2, truth: "non-person" },
  { value: "Systemwide Registrars", standalone: 0, contextual: 2, truth: "non-person" },
  { value: "VA, VET", standalone: 0, contextual: 2, truth: "non-person" },
  { value: "If Joan", standalone: 0, contextual: 2, truth: "non-person" },
  { value: "Giancarlo", standalone: 0, contextual: 2, truth: "person" },
  { value: "Vince", standalone: 0, contextual: 2, truth: "person" },
  { value: "Adobe Sign", standalone: 0, contextual: 2, truth: "non-person" },
  { value: "Clearinghouse Webinar", standalone: 0, contextual: 2, truth: "non-person" },
  { value: "Fire Marshall", standalone: 0, contextual: 2, truth: "non-person" },
  { value: "First Fight", standalone: 0, contextual: 2, truth: "non-person" },
  { value: "From Melissa", standalone: 0, contextual: 2, truth: "non-person" },
  { value: "Grade Entry", standalone: 0, contextual: 2, truth: "non-person" },
  { value: "Grade Posting Process", standalone: 0, contextual: 2, truth: "non-person" },
  { value: "Grade Rosters Closed", standalone: 0, contextual: 2, truth: "non-person" },
  { value: "Grade Rosters Created", standalone: 0, contextual: 2, truth: "non-person" },
  { value: "Grade Rosters Posted", standalone: 0, contextual: 2, truth: "non-person" },
  { value: "Grading Security", standalone: 0, contextual: 2, truth: "non-person" },
  { value: "Incomplete Grade", standalone: 0, contextual: 2, truth: "non-person" },
  { value: "Last Date", standalone: 0, contextual: 2, truth: "non-person" },
  { value: "Mass Disc", standalone: 0, contextual: 2, truth: "non-person" },
  { value: "Math Option", standalone: 0, contextual: 2, truth: "?" },
  { value: "Preview Day", standalone: 0, contextual: 2, truth: "non-person" },
  { value: "Priority Reg", standalone: 0, contextual: 2, truth: "non-person" },
  { value: "Since Mass Disc", standalone: 0, contextual: 2, truth: "non-person" },
  { value: "Southern California Shredding Coming", standalone: 0, contextual: 2, truth: "non-person" },
  { value: "Stern Mass", standalone: 0, contextual: 2, truth: "non-person" },
  { value: "Timekeeper Overview", standalone: 0, contextual: 2, truth: "non-person" },
  { value: "Town Hall Meeting", standalone: 0, contextual: 2, truth: "non-person" },
  { value: "When Ruth", standalone: 0, contextual: 2, truth: "non-person" },
  { value: "Tanesha,   Any", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Associate Deans", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Computer Science", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Residency Specialists", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Science Teacher Initiativ", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Science Teacher Initiative", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Student Homepage", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Word Documents", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Automate Approvals", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Giancarlo Banuelos", standalone: 0, contextual: 1, truth: "person" },
  { value: "Angeles, CA", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Level, Early", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Fox, Liud", standalone: 0, contextual: 1, truth: "person" },
  { value: "Fox, Liudmila", standalone: 0, contextual: 1, truth: "person" },
  { value: "Acad Struc", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Acad Structure", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Academic Service", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Action Reason", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Associated Deans", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Bobbie Galaz", standalone: 0, contextual: 1, truth: "person" },
  { value: "Chelsye Angelina", standalone: 0, contextual: 1, truth: "person" },
  { value: "Class Level", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Conference Flyer", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Convert Invalid", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Dear All", standalone: 1, contextual: 0, truth: "non-person" },
  { value: "Dear Student", standalone: 1, contextual: 0, truth: "non-person" },
  { value: "Display Self", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Display Self Service", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Drop Placeholder", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "End Date", standalone: 1, contextual: 0, truth: "non-person" },
  { value: "End Time", standalone: 1, contextual: 0, truth: "non-person" },
  { value: "Excluded Data", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Financial Aid", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Fully Graded", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Getting Started", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Go Live", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Grad App", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Grade Pro", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Grades Due", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Happy Holiday Weekend", standalone: 1, contextual: 0, truth: "non-person" },
  { value: "Happy Presidents", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "High School", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Jeffrey Lam", standalone: 0, contextual: 1, truth: "person" },
  { value: "Level Spoofing", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "My Planner", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Not Class Rosters", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Pacific Standard Time", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Priority Registrati", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Pushing Boundaries", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Reason Code", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Reason Codes", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Residency Specialist", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Science Teach", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Science Teacher Initiatives", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Security Request", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Service Indi", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Staff Academic Advisement Report", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Staff Ad", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Staff Homepage", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Start Date", standalone: 1, contextual: 0, truth: "non-person" },
  { value: "Start Time", standalone: 1, contextual: 0, truth: "non-person" },
  { value: "Student Final Exa", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Student Groups", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Student Success", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Systemwide Meeting", standalone: 0, contextual: 1, truth: "?" },
  { value: "Term Activating", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Term Withdra", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Term Withdrawl", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Term Withdrawls", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Transfer Credit", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Unofficial Withdrawals", standalone: 1, contextual: 0, truth: "non-person" },
  { value: "Virtual Clearinghouse Academ", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Welcome Call", standalone: 0, contextual: 1, truth: "non-person" },
  { value: "Workflow Shift", standalone: 0, contextual: 1, truth: "?" },
];

/** Frozen witness set, for the safety constraint. */
export const FROZEN_PEOPLE = [
  "Amy Miller", "Jeffrey Lam", "Bobbie Galaz", "Chelsye Angelina", "Perias, Nelly",
  "Yamada, Tamara", "Cobb, Christopher", "Chriztopher Johnson", "Diana", "Sarah",
  "Goodloe, Andrew", "Collier, Tanesha", "Giancarlo Banuelos", "Fox, Liudmila",
  "Francis, Kyle", "Evelyn, Joaquin", "Chris, Margaret",
];

export const FROZEN_NON_PEOPLE = [
  "Academic Senate", "Grade Rosters", "Financial Aid", "Message List", "Term Withdrawals",
  "Grade Entry", "Academic Service", "Student Final Exam", "Clearinghouse Webinar",
  "Timekeeper Overview", "Computer Science", "External Education", "San Diego",
  "Word Documents", "Residency Specialists", "Reason Code", "Start Date", "Student Groups",
  "Transfer Credit", "Display Self Service", "Security Request",
  "Staff Academic Advisement Report", "Associated Deans", "Final Exams", "End Date",
  "Town Hall Meeting", "Dear All", "Dear Student", "Happy Presidents", "Welcome Call",
];
