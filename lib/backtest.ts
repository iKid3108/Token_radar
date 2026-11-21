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
// THE SCENARIO SUITE. Three questions one holdout cannot answer, measured beside it:
//
//   horizons                does the label's horizon matter? The snapshot carries a single dynamic
//                           field, so the 30-day row compounds the 7-day one at its own rate and
//                           is labelled as such rather than passed off as a reading; a real second
//                           horizon needs a second snapshot
//   leave-one-category-out  does one category carry the result? Every category is removed in turn
//                           and the leak-free IC is re-measured, point estimate only
//   threshold sensitivity   do the z-score cut-offs move the headline? They cannot move the
//                           leak-free IC, whose three label-reading tilts are off — and the table
//                           measures that, beside the shipped configuration, which they do move
//
// DETERMINISM. Splits hash (slug, seed); the bootstrap uses seeded mulberry32. Two runs write
// identical bytes, and the scenario suite inherits the same discipline: no clock, no ordering by
// iteration accident, every sweep listed explicitly.

import {
  MODEL,
  comparablesBaseline,
  flowAdjust,
  isSubject,
  loadProtocols,
  scoreComponents,
  type Baseline,
  type FlowAdjustment,
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
  scenarios: ScenarioBlock;
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

// ---------------------------------------------------------------------------------------------
// The scenario suite
//
// Everything below reuses the primary split's fit and scored rows, so a scenario describes the same
// holdout the headline does rather than a second experiment that happens to share a name. All of it
// is point estimates: the bootstrap belongs to the headline block, and repeating a 2000-replicate
// resample inside every sweep would cost seconds to restate what the point column already says.
// ---------------------------------------------------------------------------------------------

/** One scored held-out row, as every scenario reads it. */
interface ScoredRow {
  category: string;
  label: number;
  /** The leak-free composite: growth, stale and velocity weights at zero. */
  leakFree: number;
}

/** The train-half fit and the held-out rows a scenario measures. */
interface ScenarioFit {
  scored: SnapshotProtocol[];
  baseline: Baseline;
  flow: FlowAdjustment;
}

/**
 * Fit on the train half for `seed` and collect the held-out protocols that carry a label. This
 * mirrors evaluateSplit's population exactly — the watchlist or the screen, and a non-null label —
 * so a scenario can never quietly measure a different set of rows than the headline does.
 */
function scenarioFit(snapshot: Snapshot, seed: number): ScenarioFit {
  const { train, test } = splitByCategory(snapshot.protocols, seed);
  const trainSnapshot: Snapshot = { ...snapshot, protocols: train, watchlist: [] };
  const universe = loadProtocols(trainSnapshot);
  const baseline = comparablesBaseline(universe, MODEL);
  const flow = flowAdjust(universe, baseline, MODEL);
  const watchlist = new Set(snapshot.watchlist);
  const scored = test.filter((p) => (watchlist.has(p.slug) || isSubject(p)) && p.change_7d !== null);
  return { scored, baseline, flow };
}

/**
 * The held-out rows every scenario measures: the label beside the leak-free composite. One fit, one
 * population, taken from the same primary split the headline reports, so a scenario can never
 * quietly measure a different set of rows than the number it is printed next to.
 */
function scenarioRows(snapshot: Snapshot, seed: number): ScoredRow[] {
  const { scored, baseline, flow } = scenarioFit(snapshot, seed);
  const leakFreeParams: ModelParams = {
    ...MODEL,
    growth_weight: 0,
    flow_penalty_step: 0,
    velocity_weight: 0,
  };
  return scored.map((p) => ({
    category: p.category ?? 'Other',
    label: p.change_7d as number,
    leakFree: composite(scoreComponents(p, snapshot.as_of, baseline, flow, leakFreeParams)),
  }));
}

/** Four decimals, with null passing through untouched. */
function roundOrNull(n: number | null): number | null {
  return n === null ? null : round4(n);
}

/** One label horizon's numbers, and whether it was able to move the headline at all. */
export interface ScenarioHorizon {
  horizon_days: number;
  label: string;
  /** True when the label is an extrapolation from the observed week rather than a reading. */
  derived: boolean;
  derivable_rows: number;
  dropped_rows: number;
  rank_ic: number | null;
  picks: number;
  hits: number;
  /** True when this horizon's rank IC equals the observed one's. */
  same_rank_ic_as_observed: boolean;
}

/**
 * The horizons the snapshot can support. `change_7d` is the one dynamic reading it carries. A 30-day
 * label is derived from that week by compounding it at its own rate; that is an extrapolation, so it
 * is labelled one rather than passed off as a reading, and a row whose week implies a non-positive
 * base is dropped instead of being given an invented number. Because the transform is strictly
 * increasing wherever it is defined, every rank statistic over it is identical to the 7-day one: the
 * table reports that invariance rather than presenting the horizon as independent evidence.
 */
function horizonScenarios(rows: readonly ScoredRow[]): ScenarioHorizon[] {
  const observedPred = rows.map((r) => r.leakFree);
  const observedLabel = rows.map((r) => r.label);
  const observedIc = spearman(observedPred, observedLabel);
  const observedHit = topQuartileHit(observedPred, observedLabel);

  const kept = rows.filter((r) => 1 + r.label / 100 > 0);
  const keptPred = kept.map((r) => r.leakFree);
  const derivedLabel = kept.map((r) => 100 * ((1 + r.label / 100) ** (30 / 7) - 1));
  const derivedIc = spearman(keptPred, derivedLabel);
  const derivedHit = topQuartileHit(keptPred, derivedLabel);

  return [
    {
      horizon_days: 7,
      label: 'change_7d (observed)',
      derived: false,
      derivable_rows: rows.length,
      dropped_rows: 0,
      rank_ic: roundOrNull(observedIc),
      picks: observedHit.picks,
      hits: observedHit.hits,
      same_rank_ic_as_observed: true,
    },
    {
      horizon_days: 30,
      label: 'change_7d compounded to 30 days (derived)',
      derived: true,
      derivable_rows: kept.length,
      dropped_rows: rows.length - kept.length,
      rank_ic: roundOrNull(derivedIc),
      picks: derivedHit.picks,
      hits: derivedHit.hits,
      same_rank_ic_as_observed:
        observedIc !== null && derivedIc !== null && round4(observedIc) === round4(derivedIc),
    },
  ];
}

/** What one category's removal did to the leak-free rank IC. */
export interface LeaveOneOutRow {
  category: string;
  rows: number;
  ic_without_category: number | null;
  delta: number | null;
}

/** The leave-one-category-out stability table. */
export interface LeaveOneOutBlock {
  baseline_ic: number | null;
  rows: LeaveOneOutRow[];
  /** The category whose removal moved the IC furthest, by absolute delta. */
  most_influential: string | null;
  /** Largest delta minus smallest, over the categories whose removal left a computable IC. */
  spread: number | null;
}

/** Drop each scored category in turn and re-measure: does one bucket carry the result? */
function leaveOneCategoryOut(rows: readonly ScoredRow[]): LeaveOneOutBlock {
  const baseline = spearman(rows.map((r) => r.leakFree), rows.map((r) => r.label));

  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);

  const table: LeaveOneOutRow[] = [];
  for (const category of counts.keys()) {
    const kept = rows.filter((r) => r.category !== category);
    const ic = spearman(kept.map((r) => r.leakFree), kept.map((r) => r.label));
    table.push({
      category,
      rows: counts.get(category)!,
      ic_without_category: roundOrNull(ic),
      delta: ic === null || baseline === null ? null : round4(ic - baseline),
    });
  }
  table.sort((a, b) => b.rows - a.rows || (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));

  const deltas = table.map((r) => r.delta).filter((d): d is number => d !== null);
  const sorted = deltas.slice().sort((a, b) => a - b);
  const byImpact = table
    .filter((r) => r.delta !== null)
    .slice()
    .sort((a, b) => Math.abs(b.delta!) - Math.abs(a.delta!) || (a.category < b.category ? -1 : 1));

  return {
    baseline_ic: roundOrNull(baseline),
    rows: table,
    most_influential: byImpact.length === 0 ? null : byImpact[0]!.category,
    spread: sorted.length < 2 ? null : round4(sorted[sorted.length - 1]! - sorted[0]!),
  };
}

/** One point on a threshold sweep. */
export interface ThresholdRow {
  parameter: string;
  value: number;
  leak_free_ic: number | null;
  full_model_ic: number | null;
}

/** A threshold sweep, with the one sentence that makes its two columns readable. */
export interface ThresholdBlock {
  note: string;
  rows: ThresholdRow[];
}

/** The z cut-offs to sweep: the outlier bound, and the cap on the velocity boost. */
const Z_SWEEP: readonly number[] = [2, 2.5, 3, 3.5, 4];
const VELOCITY_SWEEP: readonly number[] = [1, 2, 3];

/**
 * Sweep the two z-score thresholds the model turns on, re-scoring the same held-out rows under each
 * value. The leak-free column cannot move: its three label-reading tilts are at zero weight, so a
 * cut-off on a term that no longer enters the product changes nothing. That is the point of printing
 * both columns — the shipped column is where the sweep bites, and that bite is the leakage the
 * headline is measuring, not a tuning knob.
 */
function thresholdScenarios(snapshot: Snapshot, seed: number): ThresholdBlock {
  const { scored, baseline, flow } = scenarioFit(snapshot, seed);
  const labels = scored.map((p) => p.change_7d as number);

  const score = (params: ModelParams): number[] =>
    scored.map((p) => composite(scoreComponents(p, snapshot.as_of, baseline, flow, params)));

  const leakFreeAt = (overrides: Partial<ModelParams>): number[] => {
    const params: ModelParams = {
      ...MODEL,
      ...overrides,
      growth_weight: 0,
      flow_penalty_step: 0,
      velocity_weight: 0,
    };
    return score(params);
  };

  const rows: ThresholdRow[] = [];
  const push = (parameter: string, value: number, leakFree: number[], full: number[]): void => {
    rows.push({
      parameter,
      value,
      leak_free_ic: roundOrNull(spearman(leakFree, labels)),
      full_model_ic: roundOrNull(spearman(full, labels)),
    });
  };

  for (const z of Z_SWEEP) {
    push('flow_winsor', z, leakFreeAt({ flow_winsor: z }), score({ ...MODEL, flow_winsor: z }));
  }
  for (const cap of VELOCITY_SWEEP) {
    push('velocity_cap', cap, leakFreeAt({ velocity_cap: cap }), score({ ...MODEL, velocity_cap: cap }));
  }

  return {
    note:
      'point rank IC on the primary split at each threshold. The leak-free column is flat by ' +
      'construction — its label-reading tilts carry zero weight, so no z cut-off can reach it — and ' +
      'the shipped column is the control that shows the cut-offs acting on terms that do.',
    rows,
  };
}

/** The scenario suite's section of the report. */
export interface ScenarioBlock {
  note: string;
  horizons: ScenarioHorizon[];
  leave_one_category_out: LeaveOneOutBlock;
  thresholds: ThresholdBlock;
}

/**
 * The scenario suite: label horizons, leave-one-category-out stability, and the z-threshold sweep,
 * all on the primary split. Pure and deterministic like the rest of the harness.
 */
function scenarioBlock(snapshot: Snapshot, seed: number): ScenarioBlock {
  const rows = scenarioRows(snapshot, seed);
  return {
    note:
      'reported beside the headline, on the same primary split and the same train-half fit: point ' +
      'estimates only, no second bootstrap',
    horizons: horizonScenarios(rows),
    leave_one_category_out: leaveOneCategoryOut(rows),
    thresholds: thresholdScenarios(snapshot, seed),
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
    scenarios: scenarioBlock(snapshot, seed),
    warnings,
  };
}
