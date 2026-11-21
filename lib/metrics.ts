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
