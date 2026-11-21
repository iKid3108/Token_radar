// Out-of-sample validation for the token radar's value model.
//
// THE LABEL. The sealed snapshot is one cross-section: a single `as_of` and no future TVL, so a
// temporal walk-forward cannot be built from it. The harness runs a category-stratified holdout
// instead, the walk-forward shape the data does support:
//
//   1. split every category's protocols into two halves (deterministic, by hashed slug)
//   2. fit the comparables baseline and the robust flow on the TRAIN half only
//   3. score the TEST half's pre-token protocols with that fit
//   4. compare the ranking to `change_7d` — the only dynamic field the snapshot carries — with
//      Spearman rank IC, a top-quartile hit rate, and a seeded percentile bootstrap
//
// THE LEAKAGE. Three of the model's tilts read `change_7d`: growth, the stale-week outlier
// penalty, and velocity. The headline result therefore uses a LEAK-FREE configuration
// (growth_weight = 0, flow_penalty_step = 0, velocity_weight = 0), leaving base x concentration
// x maturity, none of which touch the label. The shipped configuration runs beside it as a
// control. Whether it is inflated is MEASURED (`leakage_gap`), not assumed: on this snapshot the
// tilts are narrow multiplicative bands against a base value that spans orders of magnitude, so
// they barely reorder the board and the gap is small.
//
// THE SPLIT IS ITSELF RANDOM. One holdout at ~90 rows cannot separate "no signal" from "unlucky
// split", so the same design is replayed over `repeats` independently seeded splits and their
// ICs are summarised. The bootstrap CI covers sampling noise within a split; the repeat block
// covers the choice of split. They answer different questions and are reported separately.
//
// DETERMINISM. Splits hash (slug, seed); the bootstrap uses seeded mulberry32. Two runs write
// identical bytes.

import {
  MODEL,
  comparablesBaseline,
  flowAdjust,
  isSubject,
  loadProtocols,
  scoreComponents,
  type ModelParams,
  type RowComponents,
  type Snapshot,
  type SnapshotProtocol,
} from './model.ts';
import {
  bootstrapSpearman,
  fnv1a,
  mean,
  spearman,
  topQuartileHit,
  type Interval,
  type QuartileHit,
} from './metrics.ts';

/** The default split seed, fixed so the primary report is reproducible. */
const DEFAULT_SEED = 20_261_114;

/** How far apart the repeat seeds sit; a prime keeps the hash orderings from correlating. */
const SEED_STRIDE = 7919;

/** How the harness was run. */
export interface BacktestOptions {
  seed?: number;
  /** Bootstrap replicates; 2000 is plenty for a stable 95% percentile band at n ~ 100. */
  samples?: number;
  /** Interval width, 0..1. */
  level?: number;
  /** Independent splits to replay, including the primary one. 1 disables the repeat block. */
  repeats?: number;
}

/** How the protocols were divided and how many survived into the scored set. */
export interface SplitSummary {
  train_protocols: number;
  test_protocols: number;
  train_live_peers: number;
  scored_rows: number;
  dropped_without_label: number;
  categories: number;
  scored_categories: number;
  scored_categories_no_live_peer: number;
}

/** One configuration's validation numbers. */
export interface MetricsBlock {
  rank_ic: Interval;
  top_quartile: QuartileHit & { lift: number | null };
}

/** Per-category rank IC under the leak-free configuration. */
export interface CategoryResult {
  category: string;
  rows: number;
  rho: number | null;
}

/** The spread of leak-free rank IC across independently seeded splits. */
export interface RepeatBlock {
  splits: number;
  mean_ic: number | null;
  median_ic: number | null;
  min_ic: number | null;
  max_ic: number | null;
  /** Share of splits whose point IC was above zero. */
  share_positive: number | null;
  ics: Array<{ seed: number; ic: number | null }>;
}

/** One split's evaluation, before it is shaped into the report. */
interface Evaluation {
  split: SplitSummary;
  leakFree: MetricsBlock;
  full: MetricsBlock;
  byCategory: CategoryResult[];
  leakFreePoint: number | null;
}

/** The harness's whole report, written to backtest.json. */
export interface BacktestResult {
  schema: string;
  as_of: string;
  source: string;
  label: string;
  design: string;
  seed: number;
  bootstrap: { samples: number; level: number };
  split: SplitSummary;
  leak_free: MetricsBlock & { neutralised: string[] };
  full_model: MetricsBlock & { note: string; leakage_gap: number | null };
  repeated_splits: RepeatBlock;
  by_category: CategoryResult[];
  warnings: string[];
}

/** Four decimal places, matching the board's own rounding convention. */
function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

function roundInterval(interval: Interval): Interval {
  return {
    point: interval.point === null ? null : round4(interval.point),
    lo: interval.lo === null ? null : round4(interval.lo),
    hi: interval.hi === null ? null : round4(interval.hi),
    samples: interval.samples,
  };
}

/**
 * The continuous implied value: exactly the product `scoreComponents` rounds into
 * `implied_usd`. Ranking on the unrounded product avoids the display ties whole-dollar rounding
 * would create, without changing any order the board could produce.
 */
function composite(c: RowComponents): number {
  return (
    c.base_usd *
    c.growth.multiplier *
    c.flow.outlier_penalty *
    c.velocity.multiplier *
    c.concentration.multiplier *
    c.maturity_multiplier
  );
}

/** Rank IC plus the top-quartile hit rate for one configuration. */
function metricsBlock(
  pred: number[],
  label: number[],
  samples: number,
  level: number,
  seed: number,
): MetricsBlock {
  const hit = topQuartileHit(pred, label);
  return {
    rank_ic: roundInterval(bootstrapSpearman(pred, label, { samples, seed, level })),
    top_quartile: {
      picks: hit.picks,
      hits: hit.hits,
      rate: hit.rate === null ? null : round4(hit.rate),
      base_rate: round4(hit.base_rate),
      lift: hit.rate === null ? null : round4(hit.rate - hit.base_rate),
    },
  };
}

/**
 * Split every category's protocols in half. Rows are ordered by a hash of (seed, slug), so the
 * split depends on neither the snapshot's own order nor the engine's sort stability; the
 * alternating pick keeps the halves within one row of each other inside every category.
 */
function splitByCategory(
  protocols: SnapshotProtocol[],
  seed: number,
): { train: SnapshotProtocol[]; test: SnapshotProtocol[] } {
  const grouped = new Map<string, SnapshotProtocol[]>();
  for (const p of protocols) {
    const key = p.category ?? 'Other';
    const bucket = grouped.get(key);
    if (bucket === undefined) grouped.set(key, [p]);
    else bucket.push(p);
  }
  const train: SnapshotProtocol[] = [];
  const test: SnapshotProtocol[] = [];
  for (const key of [...grouped.keys()].sort()) {
    const rows = grouped.get(key)!;
    const ordered = rows.slice().sort((a, b) => {
      const ha = fnv1a(`${seed}:${a.slug}`);
      const hb = fnv1a(`${seed}:${b.slug}`);
      if (ha !== hb) return ha - hb;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
    ordered.forEach((p, i) => (i % 2 === 0 ? train : test).push(p));
  }
  return { train, test };
}

/** Fit on TRAIN only, then score and measure the held-out half under both configurations. */
function evaluateSplit(
  snapshot: Snapshot,
  seed: number,
  samples: number,
  level: number,
): Evaluation {
  const { train, test } = splitByCategory(snapshot.protocols, seed);

  // The fit sees only the train half: neither the slope, the category anchors nor the flow
  // spread has been shaped by a row it will later be scored against.
  const trainSnapshot: Snapshot = { ...snapshot, protocols: train, watchlist: [] };
  const trainUniverse = loadProtocols(trainSnapshot);
  const baseline = comparablesBaseline(trainUniverse, MODEL);
  const flow = flowAdjust(trainUniverse, baseline, MODEL);

  // The scored population mirrors the board's: pre-token protocols the screen keeps (or that the
  // watchlist names), with a label to measure against.
  const watchlist = new Set(snapshot.watchlist);
  const eligible = test.filter((p) => watchlist.has(p.slug) || isSubject(p));
  const scored = eligible.filter((p) => p.change_7d !== null);

  // The three tunables that read the label, switched off, are no longer tunables about it.
  const leakFreeParams: ModelParams = {
    ...MODEL,
    growth_weight: 0,
    flow_penalty_step: 0,
    velocity_weight: 0,
  };

  const rows = scored.map((p) => ({
    p,
    label: p.change_7d as number,
    leakFree: composite(scoreComponents(p, snapshot.as_of, baseline, flow, leakFreeParams)),
    full: composite(scoreComponents(p, snapshot.as_of, baseline, flow, MODEL)),
  }));

  const labels = rows.map((r) => r.label);
  const leakFreePred = rows.map((r) => r.leakFree);
  const fullPred = rows.map((r) => r.full);

  // Per-category IC under the leak-free configuration: which categories carry the signal.
  const grouped = new Map<string, { pred: number[]; label: number[] }>();
  for (const r of rows) {
    const key = r.p.category ?? 'Other';
    const bucket = grouped.get(key);
    if (bucket === undefined) grouped.set(key, { pred: [r.leakFree], label: [r.label] });
    else {
      bucket.pred.push(r.leakFree);
      bucket.label.push(r.label);
    }
  }
  const byCategory: CategoryResult[] = [...grouped.entries()]
    .map(([category, g]) => {
      const rho = spearman(g.pred, g.label);
      return { category, rows: g.label.length, rho: rho === null ? null : round4(rho) };
    })
    .sort((a, b) =>
      b.rows - a.rows || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0),
    );

  const scoredCategories = new Set(rows.map((r) => r.p.category ?? 'Other'));
  const noLivePeer = [...scoredCategories].filter(
    (c) => baseline.categories.get(c)?.fallback ?? true,
  ).length;

  // Same seed for both blocks, so the two bootstraps resample the same rows and the comparison
  // between configurations is paired rather than two independent estimates.
  const leakFree = metricsBlock(leakFreePred, labels, samples, level, seed);
  const full = metricsBlock(fullPred, labels, samples, level, seed);

  return {
    split: {
      train_protocols: train.length,
      test_protocols: test.length,
      train_live_peers: trainUniverse.live.length,
      scored_rows: rows.length,
      dropped_without_label: eligible.length - scored.length,
      categories: new Set(snapshot.protocols.map((p) => p.category ?? 'Other')).size,
      scored_categories: scoredCategories.size,
      scored_categories_no_live_peer: noLivePeer,
    },
    leakFree,
    full,
    byCategory,
    leakFreePoint: leakFree.rank_ic.point,
  };
}

/**
 * Replay the holdout over `repeats` independent splits and summarise the leak-free ICs. The
 * bootstrap CI already covers within-split noise; this covers the split choice itself.
 */
function repeatSplits(
  snapshot: Snapshot,
  seed: number,
  repeats: number,
  samples: number,
  level: number,
): RepeatBlock {
  const ics: Array<{ seed: number; ic: number | null }> = [];
  for (let i = 0; i < repeats; i++) {
    const splitSeed = seed + i * SEED_STRIDE;
    const evaluation = evaluateSplit(snapshot, splitSeed, samples, level);
    ics.push({ seed: splitSeed, ic: evaluation.leakFreePoint });
  }
  const values = ics.map((e) => e.ic).filter((v): v is number => v !== null);
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return {
    splits: repeats,
    mean_ic: values.length === 0 ? null : round4(mean(values)),
    median_ic:
      sorted.length === 0
        ? null
        : round4(sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2),
    min_ic: sorted.length === 0 ? null : round4(sorted[0]!),
    max_ic: sorted.length === 0 ? null : round4(sorted[sorted.length - 1]!),
    share_positive: values.length === 0 ? null : round4(values.filter((v) => v > 0).length / values.length),
    ics,
  };
}

/**
 * Run the holdout and return the report. Pure over (snapshot, options): no I/O, no clock, no
 * ambient randomness, so the caller can compare two runs byte for byte.
 */
export function runBacktest(snapshot: Snapshot, options: BacktestOptions = {}): BacktestResult {
  const seed = options.seed ?? DEFAULT_SEED;
  const samples = options.samples ?? 2000;
  const level = options.level ?? 0.95;
  const repeats = options.repeats ?? 5;

  const primary = evaluateSplit(snapshot, seed, samples, level);
  const repeated = repeatSplits(snapshot, seed, Math.max(1, repeats), samples, level);

  const gap =
    primary.leakFree.rank_ic.point === null || primary.full.rank_ic.point === null
      ? null
      : round4(primary.full.rank_ic.point - primary.leakFree.rank_ic.point);

  const warnings: string[] = [];
  const ic = primary.leakFree.rank_ic;
  if (primary.split.scored_rows < 30) {
    warnings.push(`only ${primary.split.scored_rows} test rows carry a label: the IC interval is wide`);
  }
  if (primary.leakFree.top_quartile.picks < 8) {
    warnings.push(
      `the predicted top quartile holds ${primary.leakFree.top_quartile.picks} rows: the hit rate is noisy`,
    );
  }
  if (ic.lo !== null && ic.hi !== null && ic.lo <= 0 && ic.hi >= 0) {
    warnings.push('the 95% interval spans zero: this split shows no reliable out-of-sample signal');
  }
  if (ic.hi !== null && ic.hi < 0) {
    warnings.push('the whole interval sits below zero: the ranking is anti-correlated with the label on this split');
  }
  if (repeated.share_positive !== null && repeated.share_positive <= 0.2) {
    warnings.push(
      `only ${Math.round(repeated.share_positive * 100)}% of ${repeated.splits} splits score a positive IC: the result is not an artefact of one unlucky split`,
    );
  }
  if ((gap ?? 0) < 0.02 && primary.split.scored_rows > 0) {
    warnings.push('the leaked and leak-free ICs agree to within 0.02: the label-reading tilts barely move this ranking');
  }
  if (primary.split.scored_categories_no_live_peer > 0) {
    warnings.push(
      `${primary.split.scored_categories_no_live_peer} scored categories had no live peer in the train half and took the global fallback fit`,
    );
  }

  return {
    schema: 'makefun/token-radar/backtest/v1',
    as_of: snapshot.as_of,
    source: snapshot.source,
    label: 'change_7d',
    design:
      'category-stratified holdout over independently seeded splits (the sealed snapshot carries no future TVL, so this is the walk-forward shape the data supports)',
    seed,
    bootstrap: { samples, level },
    split: primary.split,
    leak_free: {
      ...primary.leakFree,
      neutralised: ['growth_weight', 'flow_penalty_step', 'velocity_weight'],
    },
    full_model: {
      ...primary.full,
      note:
        'the shipped configuration reads change_7d through growth, the outlier penalty and velocity; leakage_gap is the measured difference, reported rather than assumed',
      leakage_gap: gap,
    },
    repeated_splits: repeated,
    by_category: primary.byCategory,
    warnings,
  };
}
