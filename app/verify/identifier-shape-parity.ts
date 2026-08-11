/**
 * identifier-shape-parity.ts -- the `identifier-shapes-001` fixture, run as
 * a parity comparison WITH RECORDED DEVIATIONS (AG, 2026-08-09).
 *
 * ---------------------------------------------------------------------
 * WHY THIS SUITE HAS AN UNUSUAL SHAPE
 * ---------------------------------------------------------------------
 *
 * Ordinary parity suites assert "TypeScript output == Python output". That
 * is the wrong assertion here, because DocScrub deliberately differs from
 * the oracle on these shapes: the oracle's answers corrupt the document
 * (deviations #4 and #5, see `20260809-oracle-deviations-4-and-5.md`).
 *
 * Andrew's instruction was explicit -- "the fixture/test structure should
 * make that intentional divergence explicit rather than treating it as
 * accidental parity failure." So this suite asserts THREE things, and the
 * third is the one that matters:
 *
 *   1. where the two agree, they still agree;
 *   2. where DocScrub deviates, it deviates in the EXACT recorded way;
 *   3. NOTHING ELSE DIFFERS -- an undocumented difference fails.
 *
 * (3) is what keeps this from being a rubber stamp. A deviation list that
 * only ever grows to match whatever the code does would prove nothing; the
 * suite therefore computes the full symmetric difference and requires every
 * element of it to be claimed in advance.
 *
 * ---------------------------------------------------------------------
 * WHAT THIS FIXTURE ALREADY CAUGHT
 * ---------------------------------------------------------------------
 *
 * On its first run it exposed DEVIATION #4c: PHONE_RE carried the identical
 * digit-only-guard defect as CIN_RE and LONG_ID_RE, and the earlier pass had
 * explicitly asserted PHONE_RE was "not implicated" and must not change.
 * The oracle emitted `18900663687` as a phone from inside `id=...e4c1a99`,
 * and DocScrub did too. That was a live output-corruption bug surviving a
 * fix that was supposed to have covered it -- which is precisely the gap
 * this fixture was built to close.
 *
 * Run with:
 *   node --experimental-strip-types --experimental-loader ./verify/ts-loader.mjs verify/identifier-shape-parity.ts
 */

import { readFileSync } from "node:fs";
import { OoxmlDocumentParser } from "../src/io/DocumentParser.ts";
import { RegexDetectionEngine } from "../src/engines/DetectionEngine.ts";
import { loadSourceFile } from "./fixture-io.ts";

let passCount = 0;
let failCount = 0;
const failed: string[] = [];

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passCount += 1;
    console.log(`  PASS ${label}`);
  } else {
    failCount += 1;
    failed.push(label);
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

const CASE_ID = "identifier-shapes-001";

/**
 * THE DECLARED DIVERGENCES. Each entry is a claim that must hold: the
 * oracle produces `value` for `detectedType` and DocScrub deliberately does
 * not (`present: "oracle-only"`), or the reverse (`"docscrub-only"`).
 *
 * Written out one line per candidate rather than as a rule, because the
 * point is that each is individually justified. A future change that
 * silently alters one of these fails here.
 */
interface Divergence {
  value: string;
  detectedType: string;
  present: "oracle-only" | "docscrub-only";
  deviation: string;
  why: string;
}

const DECLARED: Divergence[] = [
  // ---- DEVIATION #4: identifier guards widened to exclude letters --------
  /*
   * DELIBERATELY NOT LISTED: cin "781237504".
   *
   * The fixture uses that value TWICE -- once legitimately ("Student CIN
   * 781237504 was updated") and once inside the URL. Candidates are keyed by
   * normalized value, so both implementations produce the candidate from the
   * legitimate occurrence and there is no candidate-level divergence to
   * declare.
   *
   * The divergence is at OCCURRENCE level, and that is where section 4
   * asserts it. Keeping the shape this way is deliberate: a value appearing
   * both as a real identifier and inside a blob is the realistic case, and it
   * is the one where a candidate-count test would have reported success while
   * the document was still being corrupted.
   */
  {
    value: "18900663687",
    detectedType: "long_numeric_id",
    present: "oracle-only",
    deviation: "#4a",
    why: "digit run inside id=18900663687e4c1a99 (hex blob)",
  },
  {
    value: "01200067742",
    detectedType: "long_numeric_id",
    present: "oracle-only",
    deviation: "#4a",
    why: "digit run followed by hex letters in 01200067742E5B",
  },
  {
    value: "18900663687",
    detectedType: "phone",
    present: "oracle-only",
    deviation: "#4c",
    why: "PHONE_RE carried the same digit-only guard; an 11-digit run in a hex blob is not a phone number",
  },

  // ---- DEVIATION #5: token ceiling {1,3} -> {1,5} ------------------------
  {
    value: "Post Enrollment Requisite Checking",
    detectedType: "person",
    present: "oracle-only",
    deviation: "#5",
    why: "oracle cuts the phrase at four tokens",
  },
  {
    value: "Background Process",
    detectedType: "person",
    present: "oracle-only",
    deviation: "#5",
    why: "the remainder the oracle emits as a second candidate",
  },
  {
    value: "Post Enrollment Requisite Checking Background Process",
    detectedType: "person",
    present: "docscrub-only",
    deviation: "#5",
    why: "DocScrub keeps the phrase whole, so one review unit and one replacement span",
  },
  {
    value: "Term Session Appt Block",
    detectedType: "person",
    present: "oracle-only",
    deviation: "#5",
    why: "oracle cuts the phrase at four tokens",
  },
  {
    value: "Appt Nbr",
    detectedType: "person",
    present: "oracle-only",
    deviation: "#5",
    why: "the remainder the oracle emits as a second candidate",
  },
  {
    value: "Term Session Appt Block Appt Nbr",
    detectedType: "person",
    present: "docscrub-only",
    deviation: "#5",
    why: "DocScrub keeps the phrase whole",
  },
  {
    value: "Contact Mary Jane Watson",
    detectedType: "person",
    present: "oracle-only",
    deviation: "#5",
    why: "oracle stops at four tokens and drops 'Parker'",
  },
  {
    value: "Contact Mary Jane Watson Parker",
    detectedType: "person",
    present: "docscrub-only",
    deviation: "#5",
    why: "DocScrub reaches the full name; note BOTH over-reach into the sentence-initial verb 'Contact' (pre-existing, unrelated)",
  },
  {
    value: "The Office Of The",
    detectedType: "person",
    present: "oracle-only",
    deviation: "#5",
    why: "oracle's four-token cut of a nine-token heading",
  },
  {
    value: "Registrar And Enrollment Services",
    detectedType: "person",
    present: "oracle-only",
    deviation: "#5",
    why: "the oracle's second fragment of the same heading",
  },
  {
    value: "The Office Of The Registrar And",
    detectedType: "person",
    present: "docscrub-only",
    deviation: "#5",
    why: "DocScrub's six-token cut of the same heading -- the ceiling moved, it did not vanish",
  },
  {
    value: "Enrollment Services Team",
    detectedType: "person",
    present: "docscrub-only",
    deviation: "#5",
    why: "DocScrub's remainder of the same heading",
  },
];

interface OracleCandidate {
  key: string;
  text: string;
  detectedType: string;
}

function keyOf(text: string, detectedType: string): string {
  return `${detectedType}::${text}`;
}

async function main(): Promise<void> {
  console.log(`=== ${CASE_ID}: parity with recorded deviations ===\n`);

  const expected = JSON.parse(
    readFileSync(`fixtures/domain-parity/${CASE_ID}/expected/candidates.json`, "utf8")
  ) as { candidates: OracleCandidate[] };
  const oracle = new Set(expected.candidates.map((c) => keyOf(c.text, c.detectedType)));

  const file = loadSourceFile(CASE_ID);
  const model = await new OoxmlDocumentParser().parse(file);
  const detection = new RegexDetectionEngine().detect(model);
  const docscrub = new Set(detection.candidates.map((c) => keyOf(c.displayValue, c.detectedType)));

  console.log(`  oracle candidates:   ${oracle.size}`);
  console.log(`  docscrub candidates: ${docscrub.size}\n`);

  console.log("--- 1. AGREEMENT: shapes both implementations must get right ---");
  {
    const mustAgree: Array<[string, string]> = [
      ["781237504", "cin"], // the BARE one, from "Student CIN 781237504 was updated"
      ["123456789", "cin"],
      ["987654321", "cin"],
      ["1234567890123", "long_numeric_id"],
      ["123-456-789-012", "long_numeric_id"],
      ["826 0122 9711", "long_numeric_id"],
      ["Andrew Goodloe", "person"],
      ["Tamara Yamada", "person"],
    ];
    for (const [text, type] of mustAgree) {
      const k = keyOf(text, type);
      const inOracle = oracle.has(k);
      const inDocScrub = docscrub.has(k);
      check(`both detect ${type} ${JSON.stringify(text)}`, inOracle && inDocScrub, `oracle=${inOracle} docscrub=${inDocScrub}`);
    }
  }

  console.log("\n--- 2. DECLARED DIVERGENCES: each must hold exactly as recorded ---");
  {
    for (const d of DECLARED) {
      const k = keyOf(d.value, d.detectedType);
      const inOracle = oracle.has(k);
      const inDocScrub = docscrub.has(k);
      const holds = d.present === "oracle-only" ? inOracle && !inDocScrub : !inOracle && inDocScrub;
      check(
        `${d.deviation} ${d.present.padEnd(13)} ${d.detectedType}:${JSON.stringify(d.value)}`,
        holds,
        `oracle=${inOracle} docscrub=${inDocScrub} -- ${d.why}`
      );
    }
  }

  console.log("\n--- 3. NOTHING ELSE DIFFERS (the assertion that makes 1 and 2 meaningful) ---");
  {
    const declaredKeys = new Set(DECLARED.map((d) => keyOf(d.value, d.detectedType)));
    const oracleOnly = [...oracle].filter((k) => !docscrub.has(k) && !declaredKeys.has(k));
    const docscrubOnly = [...docscrub].filter((k) => !oracle.has(k) && !declaredKeys.has(k));

    check(
      "no UNDECLARED oracle-only candidate",
      oracleOnly.length === 0,
      `undeclared: ${JSON.stringify(oracleOnly)}`
    );
    check(
      "no UNDECLARED docscrub-only candidate",
      docscrubOnly.length === 0,
      `undeclared: ${JSON.stringify(docscrubOnly)}`
    );

    // And the declared list must not rot: every entry has to describe a
    // difference that is actually present, or it is stale documentation
    // pretending to be a contract.
    const stale = DECLARED.filter((d) => {
      const k = keyOf(d.value, d.detectedType);
      return oracle.has(k) === docscrub.has(k);
    });
    check("no STALE declared divergence (each names a real difference)", stale.length === 0, JSON.stringify(stale.map((d) => d.value)));
  }

  console.log("\n--- 4. THE CORRUPTION THESE PREVENT, as output strings ---");
  {
    // The point of #4 is not "fewer candidates", it is "the document is not
    // damaged". Asserted on the rebuilt text rather than on candidate counts.
    /*
     * BY BLOCK IDENTITY, NOT BY SUBSTRING. An earlier draft asked whether the
     * URL paragraph `includes` the occurrence text -- which is true for the
     * LEGITIMATE occurrence in a different paragraph, since the digits are the
     * same. That check reported a corruption that was not there, and would
     * equally have missed one that was. Occurrences carry the block they were
     * found in; that is the only sound question.
     */
    const urlBlock = model.blocks.find((b) => b.text.includes("teams.microsoft.com"));
    check("the URL paragraph parsed", urlBlock !== undefined);
    if (urlBlock) {
      // The legitimate occurrence of the SAME digits is still detected, in
      // its own paragraph -- the guard is a boundary, not a ban.
      const cinBlock = model.blocks.find((b) => b.text.startsWith("Student CIN"));
      const legit = detection.occurrences.filter((o) => o.blockId === cinBlock?.id && o.text === "781237504");
      check("the same digits ARE still detected where they are a real identifier", legit.length === 1, String(legit.length));
    }

    /*
     * The other two blob paragraphs, same question -- but asked about
     * NUMERIC occurrences specifically.
     *
     * An earlier draft asked for "no occurrence at all" and failed on
     * `"The"`, detected as a person in "The upload id=... failed to
     * process." That is real, and it is the Phase 2 target (ordinary-language
     * residue reaching review), not an identifier-boundary defect. Asserting
     * it here would conflate two unrelated classes and would break this suite
     * the moment Phase 2 lands. Recorded rather than widened.
     */
    const isNumericIdentifier = (text: string): boolean => /^[\d][\d\s().+-]*$/.test(text) && text.replace(/\D/g, "").length >= 9;
    for (const marker of ["id=18900663687", "01200067742E5B"]) {
      const blk = model.blocks.find((b) => b.text.includes(marker));
      const hits = blk ? detection.occurrences.filter((o) => o.blockId === blk.id && isNumericIdentifier(o.text)) : [];
      check(
        `no numeric identifier inside the ${JSON.stringify(marker)} paragraph`,
        blk !== undefined && hits.length === 0,
        JSON.stringify(hits.map((o) => o.text))
      );
    }

    // And the same narrowing for the URL paragraph, for consistency of claim.
    const urlNumeric = urlBlock ? detection.occurrences.filter((o) => o.blockId === urlBlock.id && isNumericIdentifier(o.text)) : [];
    check("no numeric identifier inside the URL paragraph", urlNumeric.length === 0, JSON.stringify(urlNumeric.map((o) => o.text)));
  }

  console.log(`\n=== ${passCount} passed, ${failCount} failed ===`);
  if (failCount > 0) {
    for (const f of failed) console.log(`  - ${f}`);
    process.exitCode = 1;
  }
}

void main();
