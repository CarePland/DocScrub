import { sequenceRatio } from "../src/engines/entity-resolution/sequence-ratio.ts";

const cases: Array<[string, string, number]> = [
  ["andrew goodloe", "andrew goodloe", 1.0],
  ["andrew goodloe", "a. goodloe", 0.75],
  ["andrew goodloe", "andrew jackson", 0.5714285714285714],
  ["goodloe, andrew", "andrew goodloe", 0.4827586206896552],
  ["a goodloe", "andrew goodloe", 0.782608695652174],
  ["", "", 1.0],
  ["a", "", 0.0],
  ["jane smith", "smith jane", 0.5],
  ["maria de la cruz", "maria de la cruz jr", 0.9142857142857143],
];

let failed = 0;
for (const [a, b, expected] of cases) {
  const actual = sequenceRatio(a, b);
  const ok = Math.abs(actual - expected) < 1e-12;
  if (!ok) {
    failed++;
    console.log(`FAIL sequenceRatio(${JSON.stringify(a)}, ${JSON.stringify(b)}) = ${actual}, expected ${expected}`);
  }
}
console.log(`${cases.length - failed}/${cases.length} passed`);
if (failed > 0) process.exit(1);
