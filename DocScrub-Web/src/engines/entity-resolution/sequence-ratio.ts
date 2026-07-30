/**
 * sequenceRatio() -- faithful TypeScript port of Python's
 * difflib.SequenceMatcher(None, a, b).ratio(), used by
 * redactor/entity_resolution.py's `_member_score()` (`SequenceMatcher(None,
 * group_name.casefold(), display_name.casefold()).ratio()`). No JS stdlib
 * equivalent exists, so this ports CPython's actual algorithm
 * (Lib/difflib.py's find_longest_match / get_matching_blocks / ratio) rather
 * than approximating with a different string-similarity metric -- Andrew's
 * Phase 6 instruction requires exact numeric confidence parity, and
 * different similarity algorithms (Levenshtein, Jaro-Winkler, etc.) do not
 * produce the same ratios as Ratcliff/Obershelp for the same inputs.
 *
 * Scope: only `isjunk=None` is ever passed by entity_resolution.py, so
 * `bjunk` is always empty here (no junk-callback support is ported -- there
 * is nothing to call it with). `autojunk` (default True in Python, applies
 * only when len(b) >= 200) IS ported for completeness/faithfulness, even
 * though every real input here is a short person-name string far under
 * that threshold and will never trigger it.
 */

interface Match {
  a: number;
  b: number;
  size: number;
}

class SequenceMatcher {
  private readonly a: string;
  private readonly b: string;
  private readonly b2j: Map<string, number[]>;
  private readonly bjunk: Set<string> = new Set(); // isjunk is always None here
  private readonly bpopular: Set<string> = new Set();
  private matchingBlocks: Match[] | null = null;

  constructor(a: string, b: string) {
    this.a = a;
    this.b = b;
    this.b2j = new Map();
    for (let i = 0; i < b.length; i++) {
      const elt = b[i]!;
      const indices = this.b2j.get(elt);
      if (indices) indices.push(i);
      else this.b2j.set(elt, [i]);
    }
    // autojunk: only kicks in for len(b) >= 200 -- ported for faithfulness,
    // inert for the short name strings this is actually used on.
    const n = b.length;
    if (n >= 200) {
      const ntest = Math.floor(n / 100) + 1;
      for (const [elt, idxs] of this.b2j) {
        if (idxs.length > ntest) this.bpopular.add(elt);
      }
      for (const elt of this.bpopular) this.b2j.delete(elt);
    }
  }

  private findLongestMatch(alo: number, ahi: number, blo: number, bhi: number): Match {
    const { a, b, b2j } = this;
    let besti = alo;
    let bestj = blo;
    let bestsize = 0;
    let j2len = new Map<number, number>();
    const nothing: number[] = [];
    for (let i = alo; i < ahi; i++) {
      const newj2len = new Map<number, number>();
      const indices = b2j.get(a[i]!) ?? nothing;
      for (const j of indices) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) ?? 0) + 1;
        newj2len.set(j, k);
        if (k > bestsize) {
          besti = i - k + 1;
          bestj = j - k + 1;
          bestsize = k;
        }
      }
      j2len = newj2len;
    }

    const isbjunk = (ch: string): boolean => this.bjunk.has(ch);

    while (besti > alo && bestj > blo && !isbjunk(b[bestj - 1]!) && a[besti - 1] === b[bestj - 1]) {
      besti -= 1;
      bestj -= 1;
      bestsize += 1;
    }
    while (besti + bestsize < ahi && bestj + bestsize < bhi && !isbjunk(b[bestj + bestsize]!) && a[besti + bestsize] === b[bestj + bestsize]) {
      bestsize += 1;
    }

    while (besti > alo && bestj > blo && isbjunk(b[bestj - 1]!) && a[besti - 1] === b[bestj - 1]) {
      besti -= 1;
      bestj -= 1;
      bestsize += 1;
    }
    while (besti + bestsize < ahi && bestj + bestsize < bhi && isbjunk(b[bestj + bestsize]!) && a[besti + bestsize] === b[bestj + bestsize]) {
      bestsize += 1;
    }

    return { a: besti, b: bestj, size: bestsize };
  }

  private getMatchingBlocks(): Match[] {
    if (this.matchingBlocks) return this.matchingBlocks;
    const la = this.a.length;
    const lb = this.b.length;
    const queue: Array<[number, number, number, number]> = [[0, la, 0, lb]];
    const matchingBlocks: Match[] = [];
    while (queue.length > 0) {
      const [alo, ahi, blo, bhi] = queue.pop()!;
      const match = this.findLongestMatch(alo, ahi, blo, bhi);
      const { a: i, b: j, size: k } = match;
      if (k > 0) {
        matchingBlocks.push(match);
        if (alo < i && blo < j) queue.push([alo, i, blo, j]);
        if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
      }
    }
    matchingBlocks.sort((x, y) => x.a - y.a || x.b - y.b || x.size - y.size);

    let i1 = 0;
    let j1 = 0;
    let k1 = 0;
    const nonAdjacent: Match[] = [];
    for (const { a: i2, b: j2, size: k2 } of matchingBlocks) {
      if (i1 + k1 === i2 && j1 + k1 === j2) {
        k1 += k2;
      } else {
        if (k1) nonAdjacent.push({ a: i1, b: j1, size: k1 });
        i1 = i2;
        j1 = j2;
        k1 = k2;
      }
    }
    if (k1) nonAdjacent.push({ a: i1, b: j1, size: k1 });
    nonAdjacent.push({ a: la, b: lb, size: 0 });

    this.matchingBlocks = nonAdjacent;
    return nonAdjacent;
  }

  ratio(): number {
    const matches = this.getMatchingBlocks().reduce((sum, m) => sum + m.size, 0);
    const length = this.a.length + this.b.length;
    return length ? (2.0 * matches) / length : 1.0;
  }
}

export function sequenceRatio(a: string, b: string): number {
  return new SequenceMatcher(a, b).ratio();
}
