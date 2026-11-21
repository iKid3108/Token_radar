// The token radar's model.
//
// A protocol snapshot goes in; a ranked board of pre-token protocols comes out. The score is built
// by five pure stages, and each stage is readable on its own:
//
//   1. loadProtocols()       index the snapshot once: category buckets, live peers, flow readings
//   2. comparablesBaseline() fit log(mcap) on log(TVL); median TVL per category is the anchor
//   3. flowAdjust()          robust median/MAD centre and scale for each category's 7-day flow
//   4. velocity(), concentration()   two bounded signals read off a row's flow z and its chains
//   5. scoreComponents()     multiply the regression base by every tilt into one row object
//
// The arithmetic each stage shares:
//
//   beta      = pooled within-category Theil-Sen slope of log(mcap) on log(TVL), clamped to
//               [beta_floor, beta_cap]; pairs closer than beta_min_ratio in TVL are skipped
//   anchor    = median TVL of every protocol the snapshot lists in the category
//   multiple  = cap/TVL at that anchor: the median over the category's live peers, shrunk toward
//               the equal-category global median by multiple_prior_weight pseudo-rows
//   base      = anchor * multiple * (TVL / anchor) ^ beta
//   flow      = median and 1.4826 x MAD of change_7d for the category, or the global pool when a
//               category holds fewer than flow_min_peers readings
//   growth    = 1 + clamp(winsorized flow, growth_floor, growth_cap) / 100 * growth_weight
//   outlier   = bounded damping of a week beyond flow_winsor robust sigmas
//   velocity  = a bounded boost for growing faster than the category's robust centre; one-sided
//   concentrate = concentration_single_mult for a one-chain record, else 1 (chain count is the
//               only concentration proxy the snapshot carries; it has no per-chain TVL split)
//   maturity  = maturity_floor + min(age_days, maturity_days) / maturity_days * maturity_range
//   implied   = max(1, round(base * growth * outlier * velocity * concentrate * maturity))
//
// No protocol is special-cased by name. The watchlist is the floor of the board, never its ceiling:
// pre-token protocols below the floor and ones the watchlist leaves out are ranked too, and
// protocols whose token already trades are kept in a separate set from the implied-value ranking.
// Every term above is stored on the row, so any rank can be recomputed from the output alone.

// ---------------------------------------------------------------------------------------------
// Snapshot: the sealed input's shape
// ---------------------------------------------------------------------------------------------

/** One protocol record: the ten fields the sealed snapshot carries and no others. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

// ---------------------------------------------------------------------------------------------
// Tunables: stated on the page, applied to every row
// ---------------------------------------------------------------------------------------------

/** Every constant the scoring pipeline uses. The dashboard prints this object verbatim. */
export interface ModelParams {
  beta_floor: number;
  beta_cap: number;
  beta_min_ratio: number;
  multiple_prior_weight: number;
  observed_multiple_floor: number;
  observed_multiple_cap: number;
  flow_min_peers: number;
  flow_scale_floor: number;
  flow_winsor: number;
  flow_penalty_step: number;
  flow_penalty_floor: number;
  flow_penalty_cap: number;
  velocity_cap: number;
  velocity_weight: number;
  concentration_single_mult: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelParams = {
  beta_floor: 0.35,
  beta_cap: 1,
  beta_min_ratio: 1.2,
  multiple_prior_weight: 4,
  observed_multiple_floor: 0.02,
  observed_multiple_cap: 4,
  flow_min_peers: 8,
  flow_scale_floor: 1.5,
  flow_winsor: 3,
  flow_penalty_step: 0.05,
  flow_penalty_floor: 0.5,
  flow_penalty_cap: 1,
  velocity_cap: 2,
  velocity_weight: 0.05,
  concentration_single_mult: 0.92,
  growth_weight: 0.3,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.85,
  maturity_range: 0.3,
  maturity_days: 1095,
  unknown_age_days: 540,
};

/** The label the dashboard prints and a reader can quote. */
export const MODEL_VERSION = 'radar-4/velocity-concentration';

/** How a protocol reached the board: named by the watchlist, found below the floor, or off-list. */
export type Origin = 'watchlist' | 'below-floor' | 'off-list';

// ---------------------------------------------------------------------------------------------
// Output shapes: board.json, data.js and the detail view all read these
// ---------------------------------------------------------------------------------------------

/** A live-token protocol used as a comparable for its category. */
export interface Peer {
  slug: string;
  name: string;
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
  predicted_mcap_usd: number;
}

/** One category's fit plus its robust flow distribution, as the dashboard's table shows it. */
export interface CategoryStat {
  category: string;
  peers: number;
  anchor_tvl_usd: number;
  log_multiple_at_anchor: number;
  raw_log_multiple_at_anchor: number | null;
  multiple_at_anchor: number;
  median_multiple: number | null;
  flow_center: number;
  flow_scale: number;
  flow_peers: number;
  flow_fallback: boolean;
  fallback: boolean;
  rows: number;
}

/** Every term a row's implied value is built from, in the order the page explains them. */
export interface RowModel {
  version: string;
  base_value_usd: number;
  multiple: number;
  base_multiple: number;
  beta: number;
  category_log_multiple: number;
  category_anchor_tvl: number;
  category_peers: number;
  category_multiple: number;
  category_fallback: boolean;
  flow_center: number;
  flow_scale: number;
  flow_peers: number;
  flow_fallback: boolean;
  flow_z: number | null;
  flow_used_pct: number | null;
  flow_stale: boolean;
  outlier_penalty: number;
  velocity_z: number | null;
  velocity_boost_pct: number;
  velocity_multiplier: number;
  chain_count: number;
  concentration_single: boolean;
  concentration_multiplier: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
}

/** One row of the ranked board. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  origin: Origin;
  age_days: number | null;
  implied_value_usd: number;
  model: RowModel;
  comparables: Peer[];
  farm_steps: string[];
}

/** A protocol whose token already trades: the market's multiple, never the model's value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  multiple: number | null;
}

/** The dashboard's whole dataset. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: ModelParams;
  regression: {
    beta: number;
    pairs: number;
    live_peers: number;
    log_multiple_at_anchor: number;
    anchor_tvl_usd: number;
    multiple_at_anchor: number;
    flow_center: number;
    flow_scale: number;
    flow_peers: number;
  };
  watchlist_size: number;
  board_size: number;
  early_size: number;
  off_list_size: number;
  live_size: number;
  token_recorded_size: number;
  rows: BoardRow[];
  live: LiveRow[];
  categories: CategoryStat[];
}

/** Why the input is not a snapshot this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

// ---------------------------------------------------------------------------------------------
// Small shared helpers
// ---------------------------------------------------------------------------------------------

const DAY_MS = 86_400_000;

const cmpSlug = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** The median of a list, or null for an empty list. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Whole UTC days from `asOf` back to `listedAt`, floored at zero; null when unknown. */
export function ageInDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a record carries no token at all: no market cap, no CoinGecko id, no symbol. */
export function hasNoToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** A name ending in a release marker is a pool of another protocol, not a subject of its own. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A wrapped or staked product of a protocol whose token already trades. */
const WRAPPED = /\b(wrapped|staked|staking)\b/i;
/** A product branded by a centralized exchange. */
const EXCHANGE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)/i;
/** Categories that describe a product of another protocol rather than a subject. */
const PRODUCT_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** Whether a pre-token protocol is a subject of its own rather than a product of another one. */
export function isSubject(p: SnapshotProtocol): boolean {
  return (
    hasNoToken(p) &&
    !PRODUCT_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED.test(p.name) &&
    !EXCHANGE.test(p.name)
  );
}

/** The population the comparables regression measures: positive TVL and a positive market cap. */
function isLiveToken(p: SnapshotProtocol): boolean {
  return p.tvl_usd > 0 && p.mcap_usd !== null && p.mcap_usd > 0;
}

// ---------------------------------------------------------------------------------------------
// Stage 1: loadProtocols()
// ---------------------------------------------------------------------------------------------

/** One category's slice of the snapshot. */
export interface CategoryBucket {
  category: string;
  /** Every protocol the snapshot lists in the category, in snapshot order. */
  all: SnapshotProtocol[];
  /** The subset the regression may use as peers. */
  live: SnapshotProtocol[];
  /** The category's non-null 7-day flow readings. */
  flows: number[];
}

/** The snapshot, indexed once so no later stage has to scan it again. */
export interface Universe {
  protocols: SnapshotProtocol[];
  watchlist: string[];
  watchlistSet: Set<string>;
  index: Map<string, SnapshotProtocol>;
  byCategory: Map<string, CategoryBucket>;
  live: SnapshotProtocol[];
  globalFlows: number[];
}

/**
 * Stage 1. Index the snapshot by category, split live peers from pre-token records, and collect
 * every non-null flow reading. This stage scores nothing; it only spares later stages a rescan.
 */
export function loadProtocols(snapshot: Snapshot): Universe {
  const index = new Map<string, SnapshotProtocol>();
  const byCategory = new Map<string, CategoryBucket>();
  const live: SnapshotProtocol[] = [];
  const globalFlows: number[] = [];

  for (const p of snapshot.protocols) {
    index.set(p.slug, p);
    const key = p.category ?? 'Other';
    let bucket = byCategory.get(key);
    if (bucket === undefined) {
      bucket = { category: key, all: [], live: [], flows: [] };
      byCategory.set(key, bucket);
    }
    bucket.all.push(p);
    if (p.change_7d !== null) {
      bucket.flows.push(p.change_7d);
      globalFlows.push(p.change_7d);
    }
  }
  for (const p of snapshot.protocols) {
    if (!isLiveToken(p)) continue;
    live.push(p);
    byCategory.get(p.category ?? 'Other')!.live.push(p);
  }
  return {
    protocols: snapshot.protocols,
    watchlist: snapshot.watchlist,
    watchlistSet: new Set(snapshot.watchlist),
    index,
    byCategory,
    live,
    globalFlows,
  };
}

// ---------------------------------------------------------------------------------------------
// Stage 2: comparablesBaseline()
// ---------------------------------------------------------------------------------------------

/** One category's fitted regression, parameterised at the category's own TVL anchor. */
export interface CategoryFit {
  category: string;
  peers: number;
  anchor_tvl: number;
  log_multiple: number;
  raw_log_multiple: number | null;
  multiple_at_anchor: number;
  median_multiple: number | null;
  /** True when the category has no live peer, so the global fit answers for it. */
  fallback: boolean;
}

/** The regression fit: one pooled slope, one anchor-relative multiple per category. */
export interface Baseline {
  beta: number;
  pairs: number;
  live_peers: number;
  global_log_multiple: number;
  global_anchor_tvl: number;
  global_center_multiple: number;
  categories: Map<string, CategoryFit>;
  peers: Map<string, Peer[]>;
}

/**
 * Stage 2. Fit log(mcap) = intercept + beta * log(TVL) over the snapshot's live-token protocols.
 *
 * Beta is a pooled within-category Theil-Sen slope: every pair of live peers in the same category
 * contributes one slope, and the median of those slopes is taken. Category membership is fixed
 * before the fit, so a category's row count never poses as scale. The fit is then restated at each
 * category's median TVL (the anchor), which is what makes the value comparable across categories;
 * a category's anchor multiple is the median peer estimate, shrunk toward the global median with
 * `multiple_prior_weight` pseudo-rows so one peer cannot define a category outright.
 */
export function comparablesBaseline(universe: Universe, params: ModelParams = MODEL): Baseline {
  // Anchor TVL over every record in the category, live or not: this is the category-mix control.
  const anchors = new Map<string, number>();
  for (const [category, bucket] of universe.byCategory) {
    const tvls = bucket.all.filter((p) => p.tvl_usd > 0).map((p) => p.tvl_usd);
    anchors.set(category, median(tvls) ?? 1);
  }
  const globalAnchor =
    median(universe.protocols.filter((p) => p.tvl_usd > 0).map((p) => p.tvl_usd)) ?? 1;

  // A within-category Theil-Sen slope stops a category's row count from masquerading as scale;
  // pairs closer than beta_min_ratio in TVL are skipped as numerically unstable.
  const slopes: number[] = [];
  for (const bucket of universe.byCategory.values()) {
    const rows = bucket.live;
    for (let i = 0; i < rows.length; i++) {
      const a = rows[i]!;
      for (let j = i + 1; j < rows.length; j++) {
        const b = rows[j]!;
        const dx = Math.log(b.tvl_usd) - Math.log(a.tvl_usd);
        if (Math.abs(dx) < Math.log(params.beta_min_ratio)) continue;
        slopes.push((Math.log(b.mcap_usd!) - Math.log(a.mcap_usd!)) / dx);
      }
    }
  }
  const beta = clamp(median(slopes) ?? 0.75, params.beta_floor, params.beta_cap);

  // Each live peer votes once on its category's cap/TVL at that category's anchor. Only categories
  // with a live peer enter this pass; a category with none falls back to the global fit below.
  const rawLogMultiples = new Map<string, number>();
  for (const [category, bucket] of universe.byCategory) {
    const rows = bucket.live;
    if (rows.length === 0) continue;
    const anchor = anchors.get(category) ?? globalAnchor;
    const estimates = rows.map(
      (p) => Math.log(p.mcap_usd! / p.tvl_usd) - (beta - 1) * Math.log(p.tvl_usd / anchor),
    );
    rawLogMultiples.set(category, median(estimates)!);
  }
  // Every category votes once here too, so a large category cannot drag the fallback toward itself.
  const globalLogMultiple = median([...rawLogMultiples.values()]) ?? Math.log(0.2);

  const categories = new Map<string, CategoryFit>();
  const peers = new Map<string, Peer[]>();
  for (const [category, bucket] of universe.byCategory) {
    const rows = bucket.live;
    const n = rows.length;
    const anchor = anchors.get(category) ?? globalAnchor;
    const raw = rawLogMultiples.get(category) ?? null;
    const logMultiple =
      raw === null
        ? globalLogMultiple
        : (n * raw + params.multiple_prior_weight * globalLogMultiple) /
          (n + params.multiple_prior_weight);

    const observed = rows.map((p) =>
      clamp(p.mcap_usd! / p.tvl_usd, params.observed_multiple_floor, params.observed_multiple_cap),
    );
    categories.set(category, {
      category,
      peers: n,
      anchor_tvl: anchor,
      log_multiple: logMultiple,
      raw_log_multiple: raw,
      multiple_at_anchor: Math.exp(logMultiple),
      median_multiple: median(observed),
      fallback: n === 0,
    });

    // The four largest live peers by market cap, with what the fit predicts for each of them.
    peers.set(
      category,
      rows
        .slice()
        .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || cmpSlug(a.slug, b.slug))
        .slice(0, 4)
        .map((p) => ({
          slug: p.slug,
          name: p.name,
          tvl_usd: p.tvl_usd,
          mcap_usd: p.mcap_usd ?? 0,
          multiple: round4(
            clamp(p.mcap_usd! / p.tvl_usd, params.observed_multiple_floor, params.observed_multiple_cap),
          ),
          predicted_mcap_usd: anchor * Math.exp(logMultiple + beta * Math.log(p.tvl_usd / anchor)),
        })),
    );
  }

  return {
    beta,
    pairs: slopes.length,
    live_peers: universe.live.length,
    global_log_multiple: globalLogMultiple,
    global_anchor_tvl: globalAnchor,
    global_center_multiple: Math.exp(globalLogMultiple),
    categories,
    peers,
  };
}

// ---------------------------------------------------------------------------------------------
// Stage 3: flowAdjust()
// ---------------------------------------------------------------------------------------------

/** A robust centre and scale for one flow distribution: the median and 1.4826 x MAD. */
export interface FlowStat {
  center: number;
  scale: number;
  peers: number;
}

/** One category's flow adjustment, after the global-pool fallback has been decided. */
export interface CategoryFlow {
  center: number;
  scale: number;
  peers: number;
  /** True when the category held fewer than flow_min_peers readings and the global pool answered. */
  fallback: boolean;
}

/** The flow stage's output: the global pool, each category's pool, and the merged stats table. */
export interface FlowAdjustment {
  global: FlowStat;
  byCategory: Map<string, CategoryFlow>;
  /** The category table with the baseline fit and the flow spread merged, ready for the dashboard. */
  stats: Map<string, CategoryStat>;
}

/** Median centre, MAD scale at 1.4826x, floored so a quiet pool never divides by near-zero. */
function robustSpread(values: number[], params: ModelParams): FlowStat {
  const center = median(values) ?? 0;
  const mad = median(values.map((value) => Math.abs(value - center))) ?? 0;
  return { center, scale: Math.max(params.flow_scale_floor, mad * 1.4826), peers: values.length };
}

/**
 * Stage 3. Measure the 7-day flow distribution per category with a median and a MAD scale, both
 * robust to the fat tails TVL flows carry. A category with fewer than `flow_min_peers` readings is
 * too thin to describe itself, so the global pool answers for it; the fallback is recorded either
 * way so the page can name which pool scored the row. Every flow reading in the snapshot is used.
 */
export function flowAdjust(
  universe: Universe,
  baseline: Baseline,
  params: ModelParams = MODEL,
): FlowAdjustment {
  const global = robustSpread(universe.globalFlows, params);
  const byCategory = new Map<string, CategoryFlow>();
  const stats = new Map<string, CategoryStat>();

  for (const [category, fit] of baseline.categories) {
    const flows = universe.byCategory.get(category)?.flows ?? [];
    const fallback = flows.length < params.flow_min_peers;
    const spread = fallback ? global : robustSpread(flows, params);
    byCategory.set(category, {
      center: spread.center,
      scale: spread.scale,
      peers: spread.peers,
      fallback,
    });
    stats.set(category, {
      category,
      peers: fit.peers,
      anchor_tvl_usd: fit.anchor_tvl,
      log_multiple_at_anchor: fit.log_multiple,
      raw_log_multiple_at_anchor: fit.raw_log_multiple,
      multiple_at_anchor: fit.multiple_at_anchor,
      median_multiple: fit.median_multiple,
      flow_center: spread.center,
      flow_scale: spread.scale,
      flow_peers: spread.peers,
      flow_fallback: fallback,
      fallback: fit.fallback,
      rows: 0,
    });
  }
  return { global, byCategory, stats };
}

// ---------------------------------------------------------------------------------------------
// Stage 4: velocity() and concentration()
// ---------------------------------------------------------------------------------------------

/** The launch-velocity signal: a one-sided, bounded boost for outgrowing the category centre. */
export interface VelocitySignal {
  /** The flow z floored at zero; null when there is no reading or the week is stale. */
  z: number | null;
  boost_pct: number;
  multiplier: number;
}

/** The chain-concentration signal: the snapshot's chain count is the only proxy it carries. */
export interface ConcentrationSignal {
  chain_count: number;
  single: boolean;
  multiplier: number;
}

/**
 * Stage 4a. Launch velocity from a flow z. Growth above the category's robust centre earns a
 * bounded boost; a flow at or below the centre earns nothing, because the outlier test owns the
 * downside. A stale week has already been winsorized and damped, so it earns no credit here.
 */
export function velocity(z: number | null, stale: boolean, params: ModelParams = MODEL): VelocitySignal {
  const eligible = z !== null && !stale;
  const capped = Math.min(eligible ? Math.max(0, z!) : 0, params.velocity_cap);
  return {
    z: eligible ? round4(Math.max(0, z!)) : null,
    boost_pct: round4(capped * 100),
    multiplier: round4(1 + capped * params.velocity_weight),
  };
}

/**
 * Stage 4b. Concentration from the chain record. The snapshot says which chains a protocol runs on
 * but never how its TVL splits across them, so a single-chain record is the only concentration it
 * can evidence; a one-chain row takes the discount and every multi-chain row is left at 1.
 */
export function concentration(
  chains: readonly string[],
  params: ModelParams = MODEL,
): ConcentrationSignal {
  const chainCount = chains.length;
  const single = chainCount === 1;
  return {
    chain_count: chainCount,
    single,
    multiplier: single ? params.concentration_single_mult : 1,
  };
}

// ---------------------------------------------------------------------------------------------
// Stage 5: scoreComponents()
// ---------------------------------------------------------------------------------------------

/** One row's score, term by term: the nested object the detail view walks top to bottom. */
export interface RowComponents {
  implied_usd: number;
  age_days: number | null;
  /** The regression's value before any tilt, in dollars. */
  base_usd: number;
  base_multiple: number;
  multiple: number;
  beta: number;
  category: {
    log_multiple: number;
    anchor_tvl: number;
    peers: number;
    multiple: number;
    fallback: boolean;
  };
  flow: {
    center: number;
    scale: number;
    peers: number;
    fallback: boolean;
    z: number | null;
    used_pct: number | null;
    stale: boolean;
    outlier_penalty: number;
  };
  growth: {
    pct: number;
    multiplier: number;
  };
  velocity: VelocitySignal;
  concentration: ConcentrationSignal;
  maturity_multiplier: number;
}

/**
 * Stage 5. Score one pre-token protocol. The regression base is multiplied, in this order, by the
 * growth tilt, the stale-week damping, the velocity boost, the concentration discount and the
 * maturity tilt. Stored multipliers are the rounded values actually multiplied together, so the
 * page's recomputation reproduces `implied_value_usd` exactly rather than approximately.
 */
export function scoreComponents(
  protocol: SnapshotProtocol,
  asOf: string,
  baseline: Baseline,
  flow: FlowAdjustment,
  params: ModelParams = MODEL,
): RowComponents {
  const age = ageInDays(asOf, protocol.listed_at);
  const key = protocol.category ?? 'Other';
  const fit = baseline.categories.get(key);
  const flowFit = flow.byCategory.get(key);

  const logMultiple = fit?.log_multiple ?? baseline.global_log_multiple;
  const anchor = fit?.anchor_tvl ?? baseline.global_anchor_tvl;
  const tvl = Math.max(1, protocol.tvl_usd);
  const base = anchor * Math.exp(logMultiple + baseline.beta * Math.log(tvl / anchor));

  const center = flowFit?.center ?? flow.global.center;
  const scale = flowFit?.scale ?? flow.global.scale;
  const flowPeers = flowFit?.peers ?? flow.global.peers;
  const flowFallback = flowFit?.fallback ?? true;
  const rawFlow = protocol.change_7d;
  const flowZ = rawFlow === null ? null : (rawFlow - center) / scale;
  const flowUsed =
    flowZ === null ? center : center + clamp(flowZ, -params.flow_winsor, params.flow_winsor) * scale;
  const stale = flowZ !== null && Math.abs(flowZ) > params.flow_winsor;
  const excess = stale ? Math.abs(flowZ!) - params.flow_winsor : 0;
  const outlierPenalty = round4(
    clamp(1 - excess * params.flow_penalty_step, params.flow_penalty_floor, params.flow_penalty_cap),
  );

  const launchVelocity = velocity(flowZ, stale, params);
  const chainConcentration = concentration(protocol.chains, params);

  const growthPct = round4(clamp(flowUsed, params.growth_floor, params.growth_cap));
  const growthMult = round4(1 + (growthPct / 100) * params.growth_weight);
  const ageForModel = age ?? params.unknown_age_days;
  const maturityMult = round4(
    params.maturity_floor +
      (Math.min(Math.max(ageForModel, 0), params.maturity_days) / params.maturity_days) *
        params.maturity_range,
  );

  const implied = Math.max(
    1,
    Math.round(
      base *
        growthMult *
        outlierPenalty *
        launchVelocity.multiplier *
        chainConcentration.multiplier *
        maturityMult,
    ),
  );

  return {
    implied_usd: implied,
    age_days: age,
    base_usd: base,
    base_multiple: round4(base / tvl),
    multiple: round4(implied / tvl),
    beta: round4(baseline.beta),
    category: {
      log_multiple: round4(logMultiple),
      anchor_tvl: anchor,
      peers: fit?.peers ?? 0,
      multiple: round4(fit?.multiple_at_anchor ?? baseline.global_center_multiple),
      fallback: fit?.fallback ?? true,
    },
    flow: {
      center: round4(center),
      scale: round4(scale),
      peers: flowPeers,
      fallback: flowFallback,
      z: flowZ === null ? null : round4(flowZ),
      used_pct: round4(flowUsed),
      stale,
      outlier_penalty: outlierPenalty,
    },
    growth: { pct: growthPct, multiplier: growthMult },
    velocity: launchVelocity,
    concentration: chainConcentration,
    maturity_multiplier: maturityMult,
  };
}

// ---------------------------------------------------------------------------------------------
// Farm plans: derived from the protocol's own record, never from a list of names
// ---------------------------------------------------------------------------------------------

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, scaled from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 200_000_000) return 100;
  if (p.tvl_usd >= 50_000_000) return 75;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols need a longer window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 120) return 90;
  if (age < 365) return 60;
  if (age < 730) return 45;
  return 30;
}

/** The capital action, in the words of the protocol's own category. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('risk curator') || c.includes('capital allocator') || c.includes('yield aggregator') || c.includes('liquidity manager')) {
    return `Deposit $${capital} of USDC into one vault ${p.name} curates on ${chain}, picking the senior or blue-chip tranche rather than the highest advertised yield.`;
  }
  if (c.includes('lending') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${capital} of USDC to ${p.name} on ${chain}, then borrow about 20% of it and repay on schedule so both sides of the market count as activity.`;
  }
  if (c.includes('dex') || c.includes('farm')) {
    return `Provide $${capital} of liquidity to ${p.name}'s deepest pool on ${chain}, and keep the position in range instead of chasing the highest-fee pool.`;
  }
  if (c.includes('rwa') || c.includes('stablecoin')) {
    return `Mint or buy $${capital} of ${p.name}'s yield asset on ${chain}, complete any identity check it asks for, and hold the asset in the issuing app.`;
  }
  if (c.includes('basis')) {
    return `Deposit $${capital} of USDC into ${p.name}'s delta-neutral basis vault on ${chain} and leave the hedge running rather than closing it weekly.`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('option') || c.includes('interest rate')) {
    return `Deposit $${capital} of USDC as margin on ${p.name} on ${chain} and keep one small, hedged position open instead of trading in and out.`;
  }
  if (c.includes('prediction')) {
    return `Fund $${capital} on ${p.name} on ${chain} and take one position in a liquid market you already understand, then leave it to resolve.`;
  }
  if (c.includes('insurance')) {
    return `Buy $${capital} of cover from ${p.name} on ${chain} for an asset you already hold, and keep the policy active through its term.`;
  }
  if (c.includes('staking') || c.includes('restak')) {
    return `Stake $${capital} of the chain's staking asset through ${p.name} on ${chain}, and keep the receipt token in the same wallet rather than selling it.`;
  }
  if (c.includes('chain') || c.includes('payments')) {
    return `Bridge $${capital} of USDC onto ${chain} through ${p.name}'s official route, then use the funds in one of its native apps so both the bridge and the app see activity.`;
  }
  if (c.includes('governance') || c.includes('incentive')) {
    return `Lock or deposit $${capital} into ${p.name}'s incentive program on ${chain} and vote in at least one governance round while it is locked.`;
  }
  if (c.includes('cefi') || c.includes('crypto card')) {
    return `Open a ${p.name} account on ${chain}, complete its identity check, and keep $${capital} of USDC active in the product rather than idle.`;
  }
  return `Deposit $${capital} of USDC into ${p.name} on ${chain}, use the product once, and keep the position open.`;
}

/** The weekly action that keeps a position from looking like a one-off deposit. */
function weeklyFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lending') || c.includes('cdp') || c.includes('collateral')) {
    return `Once a week, add a little collateral or repay a little debt on ${p.name} and leave the position healthy; one transaction a week is enough.`;
  }
  if (c.includes('risk curator') || c.includes('capital allocator') || c.includes('yield aggregator')) {
    return `Once a week, check ${p.name}'s vault page, add a small amount to the position, or move it to another vault the same curator runs on ${chain}.`;
  }
  if (c.includes('dex') || c.includes('farm')) {
    return `Once a week, rebalance ${p.name}'s pool position if it has left its range, or add a small amount of liquidity to the same pool.`;
  }
  if (c.includes('rwa') || c.includes('stablecoin')) {
    return `Once a week, confirm ${p.name}'s redemption window and mint or buy a small additional amount so the position stays active across snapshots.`;
  }
  return `Once a week, make one small qualifying action on ${p.name} on ${chain}: a deposit, a withdrawal, a swap, a borrow or a governance vote.`;
}

/** The exit check, in the words the category's own risks call for. */
function exitCheckFor(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('rwa')) {
    return `Before you enter, read ${p.name}'s redemption limits, identity requirements and settlement time on ${chain}, and keep enough USDC outside the position to cover the exit window.`;
  }
  if (c.includes('risk curator') || c.includes('capital allocator')) {
    return `Before you enter, read ${p.name}'s vault terms for lock-ups, withdrawal queues and curator fees on ${chain}, and keep a liquid reserve outside the vault.`;
  }
  return `Before you enter, check ${p.name}'s withdrawal rules, fees and any lock-up on ${chain}, and keep a small liquid reserve outside the position.`;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(text: string, cost: string, time: string): string {
  let s = `${text.trim()} Cost: ${cost.trim()}. Time: ${time.trim()}.`;
  if (s.length > 600) s = `${s.slice(0, 597)}...`;
  if (s.length < 20) s = `${s} Check the protocol's own page before you act.`;
  return s;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chain, TVL, age), never from a list of names.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = capital >= 150 ? 6 : 3;
  return [
    stepText(
      `Open the official ${p.name} app for ${chain} from a bookmark you type yourself, create a fresh wallet for this farm only, and fund it with the amount you can leave in place for ${hold} days.`,
      'under $3 of setup gas',
      '10 minutes',
    ),
    stepText(actionFor(p, capital, chain), `$${capital} of capital and about $${gas} of gas`, '15 to 20 minutes'),
    stepText(weeklyFor(p, chain), 'about $2 to $5 of gas a week', '10 minutes a week'),
    stepText(
      `Keep at least $${capital} in the position for ${hold} days: a points snapshot usually follows activity across several weeks, not a single deposit.`,
      `the $${capital} stays at work`,
      `${hold} days`,
    ),
    stepText(
      `Watch ${p.name}'s own site, docs and governance forum for a points or token announcement, check eligibility from that page only, and never pay a wallet or a third party to claim.`,
      'no fee to check; never pay to claim',
      '10 minutes a week',
    ),
    stepText(exitCheckFor(p, chain), 'no fee unless the vault or asset charges one', '15 minutes'),
    stepText(
      `Record the wallet address, every deposit date, the gas paid and the position's value in a farm log, and re-check the position whenever the model's category multiple changes.`,
      'nothing but the log',
      '5 minutes',
    ),
  ];
}

// ---------------------------------------------------------------------------------------------
// Board assembly
// ---------------------------------------------------------------------------------------------

/**
 * The protocols the board ranks. The watchlist first (every slug, whatever its figures). Then the
 * pre-token protocols the house's screen keeps but the list leaves out, strongest TVL first: below
 * the floor they are the early radar, at or above it they are the protocols the house's own parent
 * record set aside, and the rules call either no worse a subject than a listed one.
 */
function boardUniverse(universe: Universe): SnapshotProtocol[] {
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of universe.watchlist) {
    const p = universe.index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const rest = universe.protocols
    .filter((p) => !chosen.has(p.slug) && isSubject(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || cmpSlug(a.slug, b.slug));
  for (const p of rest) chosen.set(p.slug, p);
  return [...chosen.values()];
}

/** Which of the three ways a protocol reached the board. */
function originOf(universe: Universe, slug: string, tvl: number, floorUsd: number): Origin {
  if (universe.watchlistSet.has(slug)) return 'watchlist';
  return tvl < floorUsd ? 'below-floor' : 'off-list';
}

/** Attach the snapshot record, the component object and the farm plan to one ranked row. */
function toBoardRow(
  p: SnapshotProtocol,
  rank: number,
  c: RowComponents,
  universe: Universe,
  baseline: Baseline,
  floorUsd: number,
): BoardRow {
  const category = p.category ?? 'Other';
  return {
    rank,
    slug: p.slug,
    name: p.name,
    category: p.category,
    chains: p.chains,
    tvl_usd: p.tvl_usd,
    change_7d: p.change_7d,
    mcap_usd: p.mcap_usd,
    listed_at: p.listed_at,
    gecko_id: p.gecko_id,
    symbol: p.symbol,
    token_status: 'pre-token',
    watchlist: universe.watchlistSet.has(p.slug),
    origin: originOf(universe, p.slug, p.tvl_usd, floorUsd),
    age_days: c.age_days,
    implied_value_usd: c.implied_usd,
    model: {
      version: MODEL_VERSION,
      base_value_usd: c.base_usd,
      multiple: c.multiple,
      base_multiple: c.base_multiple,
      beta: c.beta,
      category_log_multiple: c.category.log_multiple,
      category_anchor_tvl: c.category.anchor_tvl,
      category_peers: c.category.peers,
      category_multiple: c.category.multiple,
      category_fallback: c.category.fallback,
      flow_center: c.flow.center,
      flow_scale: c.flow.scale,
      flow_peers: c.flow.peers,
      flow_fallback: c.flow.fallback,
      flow_z: c.flow.z,
      flow_used_pct: c.flow.used_pct,
      flow_stale: c.flow.stale,
      outlier_penalty: c.flow.outlier_penalty,
      velocity_z: c.velocity.z,
      velocity_boost_pct: c.velocity.boost_pct,
      velocity_multiplier: c.velocity.multiplier,
      chain_count: c.concentration.chain_count,
      concentration_single: c.concentration.single,
      concentration_multiplier: c.concentration.multiplier,
      growth_pct: c.growth.pct,
      growth_multiplier: c.growth.multiplier,
      maturity_multiplier: c.maturity_multiplier,
    },
    comparables: baseline.peers.get(category) ?? [],
    farm_steps: farmSteps(p, c.age_days),
  };
}

/** Everything the board needs: the rows and the two fitted contexts behind them. */
export interface BoardResult {
  board: BoardRow[];
  baseline: Baseline;
  flow: FlowAdjustment;
}

/** The ranked board: every chosen protocol scored once, strongest implied value first. */
export function buildBoard(snapshot: Snapshot, params: ModelParams = MODEL): BoardResult {
  const universe = loadProtocols(snapshot);
  const baseline = comparablesBaseline(universe, params);
  const flow = flowAdjust(universe, baseline, params);
  const scored = boardUniverse(universe).map((p) => ({
    p,
    c: scoreComponents(p, snapshot.as_of, baseline, flow, params),
  }));
  scored.sort((a, b) => b.c.implied_usd - a.c.implied_usd || cmpSlug(a.p.slug, b.p.slug));
  const board = scored.map(({ p, c }, i) =>
    toBoardRow(p, i + 1, c, universe, baseline, snapshot.floor_usd),
  );
  return { board, baseline, flow };
}

/** The live-token protocols, by market cap, for the dashboard's live-token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0)
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || cmpSlug(a.slug, b.slug))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd ?? 0,
      change_7d: p.change_7d,
      multiple:
        p.tvl_usd > 0
          ? round4(clamp((p.mcap_usd ?? 0) / p.tvl_usd, MODEL.observed_multiple_floor, MODEL.observed_multiple_cap))
          : null,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(
  snapshot: Snapshot,
  params: ModelParams = MODEL,
): { board: BoardRow[]; radar: RadarData } {
  const { board, baseline, flow } = buildBoard(snapshot, params);
  const live = liveRows(snapshot);

  // Copy the category table so the board's row counts do not leak back into the fitted stats.
  const categories = [...flow.stats.values()].map((s) => ({ ...s, rows: 0 }));
  const byCategory = new Map(categories.map((c) => [c.category, c]));
  for (const row of board) {
    const key = row.category ?? 'Other';
    const stat = byCategory.get(key);
    if (stat !== undefined) stat.rows += 1;
    else
      byCategory.set(key, {
        category: key,
        peers: 0,
        anchor_tvl_usd: baseline.global_anchor_tvl,
        log_multiple_at_anchor: baseline.global_log_multiple,
        raw_log_multiple_at_anchor: null,
        multiple_at_anchor: baseline.global_center_multiple,
        median_multiple: null,
        flow_center: flow.global.center,
        flow_scale: flow.global.scale,
        flow_peers: flow.global.peers,
        flow_fallback: true,
        fallback: true,
        rows: 1,
      });
  }

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model: params,
    regression: {
      beta: round4(baseline.beta),
      pairs: baseline.pairs,
      live_peers: baseline.live_peers,
      log_multiple_at_anchor: round4(baseline.global_log_multiple),
      anchor_tvl_usd: baseline.global_anchor_tvl,
      multiple_at_anchor: round4(baseline.global_center_multiple),
      flow_center: round4(flow.global.center),
      flow_scale: round4(flow.global.scale),
      flow_peers: flow.global.peers,
    },
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => r.origin === 'below-floor').length,
    off_list_size: board.filter((r) => r.origin === 'off-list').length,
    live_size: live.length,
    token_recorded_size: snapshot.protocols.filter((p) => !hasNoToken(p)).length,
    rows: board,
    live,
    categories: [...byCategory.values()].sort(
      (a, b) => b.rows - a.rows || b.peers - a.peers || cmpSlug(a.category, b.category),
    ),
  };
  return { board, radar };
}

// ---------------------------------------------------------------------------------------------
// Input validation, board gate, serialization
// ---------------------------------------------------------------------------------------------

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, not 100 to 4000`;
  const slugs = new Set<string>();
  const watchlist = new Set(snapshot.watchlist);
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const row of board) {
    if (!known.has(row.slug)) return `${row.slug} is not one of the snapshot's protocols`;
    if (slugs.has(row.slug)) return `${row.slug} appears twice`;
    slugs.add(row.slug);
    if (row.name.trim() === '') return `${row.slug} has no name`;
    if (!hasNoToken(row)) return `${row.slug} does not record a token but the model treats it as pre-token`;
  }
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const outside = board.filter((r) => !watchlist.has(r.slug)).length;
  if (outside < 60) return `the board holds only ${outside} rows outside the watchlist, under the 60 a valid board needs`;
  const origins = new Set(board.map((r) => r.origin).filter((o) => o !== 'watchlist'));
  if (board.length > watchlist.size + 40 && origins.size === 0) return 'the board holds no row the watchlist does not name';
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 0; i < board.length; i++) {
    const v = board[i]!.implied_value_usd;
    if (!Number.isSafeInteger(v) || v <= 0) return `${board[i]!.slug} has implied value ${v}`;
    if (v > 100_000_000_000_000) return `${board[i]!.slug} is past the implied-value cap`;
    if (i > 0 && v > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const row of board) {
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) return `${row.slug} has ${row.farm_steps.length} farm steps`;
    for (const step of row.farm_steps) {
      const n = step.trim().length;
      if (n < 20 || n > 600) return `${row.slug} has a farm step of ${n} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, with no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}



