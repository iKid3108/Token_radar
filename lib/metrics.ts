// Rank statistics for the token radar's backtest harness.
//
// Every function here is pure over arrays of numbers: no I/O, no clock, no ambient randomness.
// The only generator is the seeded mulberry32 at the bottom, so a harness run reproduces byte
// for byte.
//
// Spearman's rho is Pearson's r over tie-averaged ranks. TVL flow carries many repeated values
// (0.00, and whole per-cents), so ties are the normal case here rather than an edge case.

/** Arithmetic mean; 0 for an empty list. */
export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  let total = 0;
  for (const x of xs) total += x;
  return total / xs.length;
}

/** The median of a list; 0 for an empty list. */
export function median(xs: readonly number[]): number {
  return quantile(xs, 0.5);
}

/**
 * A quantile by linear interpolation between the two neighbouring order statistics. `q` is
 * clamped to [0, 1]; an empty list returns 0 rather than NaN, so a degenerate split cannot
 * poison the output.
 */
export function quantile(xs: readonly number[], q: number): number {
  if (xs.length === 0) return 0;
  const sorted = xs.slice().sort((a, b) => a - b);
  const clamped = Math.min(1, Math.max(0, q));
  const pos = clamped * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

/**
 * Ranks 1..n with ties sharing their average rank, e.g. [10, 20, 20, 30] -> [1, 2.5, 2.5, 4].
 * Sorting indices once, then walking runs of equal values, keeps this O(n log n).
 */
export function rankAverage(xs: readonly number[]): number[] {
  const n = xs.length;
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => xs[a]! - xs[b]! || a - b);
  const ranks = new Array<number>(n);
  let i = 0;
  while (i < n) {
    let j = i + 1;
    while (j < n && xs[order[j]!] === xs[order[i]!]) j++;
    // Positions i..j-1 tie, so they share the mean of ranks i+1..j.
    const shared = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) ranks[order[k]!] = shared;
    i = j;
  }
  return ranks;
}

/** Pearson's r; null when either series is constant (a zero denominator means no correlation). */
export function pearson(a: readonly number[], b: readonly number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i]! - ma;
    const db = b[i]! - mb;
    cov += da * db;
    va += da * da;
    vb += db * db;
  }
  const den = Math.sqrt(va * vb);
  return den === 0 ? null : cov / den;
}

/** Spearman's rho: Pearson's r over tie-averaged ranks. Null below 3 pairs or on a constant series. */
export function spearman(pred: readonly number[], label: readonly number[]): number | null {
  if (pred.length !== label.length || pred.length < 3) return null;
  return pearson(rankAverage(pred), rankAverage(label));
}

/** What the top quartile of a ranking caught. */
export interface QuartileHit {
  /** How many rows the predicted top quartile held. */
  picks: number;
  /** How many of those picks landed in the realized top quartile. */
  hits: number;
  /** hits / picks; null when the split left no picks. */
  rate: number | null;
  /** The share a blind pick would catch: the realized top-quartile size over the whole test set. */
  base_rate: number;
}

/**
 * Hit rate of the top-quartile picks: take the rows whose predicted value sits at or above the
 * 75th percentile, and count how many of them also sit at or above the 75th percentile of the
 * realized label. `base_rate` is what blind picking would score, so `rate` above it is the signal.
 */
export function topQuartileHit(pred: readonly number[], label: readonly number[]): QuartileHit {
  const n = Math.min(pred.length, label.length);
  if (n === 0) return { picks: 0, hits: 0, rate: null, base_rate: 0 };
  const pCut = quantile(pred.slice(0, n), 0.75);
  const lCut = quantile(label.slice(0, n), 0.75);
  let picks = 0;
  let hits = 0;
  let realizedTop = 0;
  for (let i = 0; i < n; i++) {
    const picked = pred[i]! >= pCut;
    const good = label[i]! >= lCut;
    if (picked) picks++;
    if (good) realizedTop++;
    if (picked && good) hits++;
  }
  return { picks, hits, rate: picks === 0 ? null : hits / picks, base_rate: realizedTop / n };
}

/** A point estimate with a percentile interval. */
export interface Interval {
  point: number | null;
  lo: number | null;
  hi: number | null;
  samples: number;
}

/**
 * A percentile bootstrap over paired rows. Each replicate resamples the (prediction, label) pairs
 * with replacement and recomputes rho; the interval is the `level` percentile band of those
 * values. A replicate whose resample is degenerate (constant ranks) contributes nothing, so
 * `samples` may fall below the requested count.
 */
export function bootstrapSpearman(
  pred: readonly number[],
  label: readonly number[],
  options: { samples?: number; seed?: number; level?: number } = {},
): Interval {
  const samples = options.samples ?? 1000;
  const level = options.level ?? 0.95;
  const random = mulberry32(options.seed ?? 1);
  const n = Math.min(pred.length, label.length);
  const point = spearman(pred, label);
  if (n < 3) return { point, lo: null, hi: null, samples: 0 };
  const rhos: number[] = [];
  for (let s = 0; s < samples; s++) {
    const pickPred: number[] = [];
    const pickLabel: number[] = [];
    for (let i = 0; i < n; i++) {
      const at = Math.floor(random() * n);
      pickPred.push(pred[at]!);
      pickLabel.push(label[at]!);
    }
    const r = spearman(pickPred, pickLabel);
    if (r !== null) rhos.push(r);
  }
  if (rhos.length === 0) return { point, lo: null, hi: null, samples: 0 };
  const tail = (1 - level) / 2;
  return { point, lo: quantile(rhos, tail), hi: quantile(rhos, 1 - tail), samples: rhos.length };
}

/** A small deterministic PRNG (mulberry32): the same seed gives the same stream on every machine. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** FNV-1a over UTF-16 code units: a stable 32-bit hash for deterministic category splits. */
export function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// ---------------------------------------------------------------------------------------------
// Rank aggregation: many orderings into one
// ---------------------------------------------------------------------------------------------

/** One ordering of ids, best first. */
export type Ranking = readonly string[];

/**
 * Borda count: in a ranking of n ids the top earns n - 1 points and the last 0, so a voter that
 * ranks only a subset transfers fewer points than one that ranks every id. Points are summed
 * across voters; an id absent from a voter's ranking simply earns nothing from that voter.
 */
export function bordaCount(rankings: readonly Ranking[]): Map<string, number> {
  const scores = new Map<string, number>();
  for (const ranking of rankings) {
    const n = ranking.length;
    for (let i = 0; i < n; i++) {
      const id = ranking[i]!;
      scores.set(id, (scores.get(id) ?? 0) + (n - i - 1));
    }
  }
  return scores;
}

/**
 * Reciprocal-rank fusion: a ranking gives its top id 1, the next 1/2, the next 1/3, and so on.
 * The decay punishes a low position far harder than Borda does, so the head of each ranking
 * dominates and a single strong voter can carry an id.
 */
export function reciprocalRank(rankings: readonly Ranking[]): Map<string, number> {
  const scores = new Map<string, number>();
  for (const ranking of rankings) {
    for (let i = 0; i < ranking.length; i++) {
      const id = ranking[i]!;
      scores.set(id, (scores.get(id) ?? 0) + 1 / (i + 1));
    }
  }
  return scores;
}

/** An aggregate's ids, highest score first, ties broken by id so the order is reproducible. */
export function orderByScore(scores: ReadonlyMap<string, number>): string[] {
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([id]) => id);
}

/**
 * Kendall's tau-b over paired observations: (concordant - discordant) / sqrt of the pairs that
 * are not tied in either series. tau-b is the tie-corrected form, which matters here because
 * both the board and a 7-day flow produce many repeated values. Null below 2 pairs or when
 * either series is constant.
 */
export function kendallTau(a: readonly number[], b: readonly number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;
  let concordant = 0;
  let discordant = 0;
  let tiedA = 0;
  let tiedB = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const da = Math.sign(a[j]! - a[i]!);
      const db = Math.sign(b[j]! - b[i]!);
      if (da === 0 && db === 0) continue; // a joint tie carries no ordering information
      if (da === 0) tiedA++;
      else if (db === 0) tiedB++;
      else if (da === db) concordant++;
      else discordant++;
    }
  }
  const den = Math.sqrt((concordant + discordant + tiedA) * (concordant + discordant + tiedB));
  return den === 0 ? null : (concordant - discordant) / den;
}

/**
 * The interior decile cut points of a list: the 10th, 20th, ... 90th percentiles. A list shorter
 * than the bin count still returns the requested count of cut points, so the caller decides
 * whether a bucket is dense enough to read.
 */
export function decileBreaks(values: readonly number[], bins = 10): number[] {
  if (bins < 2 || !Number.isSafeInteger(bins)) return [];
  const breaks: number[] = [];
  for (let k = 1; k < bins; k++) breaks.push(quantile(values, k / bins));
  return breaks;
}

/** One category's decile shape. */
export interface CategoryDeciles {
  /** How many values the category holds. */
  count: number;
  /** Interior cut points, ascending: bins - 1 of them. */
  breaks: number[];
  /** How many values fall in each of the `bins` buckets; sums to `count`. */
  counts: number[];
  /** True when the category holds fewer than two values per bucket, so the shape is noise. */
  sparse: boolean;
}

/**
 * Decile shapes per category. A value equal to a cut point stays in the lower bucket, so every
 * value lands somewhere and `counts` always sums to `count`. The map's keys are sorted, and each
 * category's buckets are computed over its own values only, never over the pooled board.
 */
export function categoryDeciles(
  rows: ReadonlyArray<{ category: string | null; value: number }>,
  bins = 10,
): Map<string, CategoryDeciles> {
  const grouped = new Map<string, number[]>();
  for (const row of rows) {
    const key = row.category ?? 'Other';
    const bucket = grouped.get(key);
    if (bucket === undefined) grouped.set(key, [row.value]);
    else bucket.push(row.value);
  }
  const out = new Map<string, CategoryDeciles>();
  for (const key of [...grouped.keys()].sort()) {
    const values = grouped.get(key)!;
    const breaks = decileBreaks(values, bins);
    const counts = new Array<number>(bins).fill(0);
    for (const value of values) {
      let bin = 0;
      while (bin < breaks.length && value > breaks[bin]!) bin++;
      counts[bin]! += 1;
    }
    out.set(key, { count: values.length, breaks, counts, sparse: values.length < bins * 2 });
  }
  return out;
}
