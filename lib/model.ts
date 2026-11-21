// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// pre-token protocols below the watchlist floor: the early rows the radar exists to find. A protocol
// is pre-token when its snapshot entry records no token at all (no market cap, no CoinGecko id and
// no symbol). Protocols whose token already trades are kept apart and shown with the market's own
// values, never mixed into the implied-value ranking.
//
// Implied value is a comparables regression fitted to the snapshot's own live-token protocols.
// It controls for category mix and damps stale weekly-flow outliers before it ranks anything:
//
//   beta      = median within-category Theil-Sen slope of log(mcap) on log(TVL), clamped to
//               [beta_floor, beta_cap]; pairs closer than beta_min_ratio in TVL are skipped
//   anchor    = median TVL of every protocol in the category (the category-mix control)
//   multiple  = cap/TVL at that anchor, the median over the category's live peers, shrunk
//               toward the equal-category global median by multiple_prior_weight pseudo-rows
//   base      = anchor x multiple x (TVL / anchor) ^ beta
//   flow      = robust centre and scale (median and 1.4826 x MAD) of change_7d in the category,
//               or the global pool when it has fewer than flow_min_peers readings
//   growth    = 1 + clamp(winsorized change_7d, growth_floor, growth_cap) / 100 x growth_weight
//   outlier   = bounded penalty for a flow beyond flow_winsor robust sigmas of its median
//   velocity  = 1 + clamp(flow z, 0, velocity_cap) x velocity_weight: a bounded boost for
//               growing faster than the category's own robust flow centre, never a penalty;
//               a stale week earns none, since the outlier penalty already owns that reading
//   concentrate = concentration_single_mult when the snapshot lists a single chain, else 1
//               (the snapshot carries no per-chain TVL split, so chain count is the proxy)
//   maturity  = maturity_floor + min(age_days, maturity_days) / maturity_days x maturity_range
//   implied   = max(1, round(base x growth x outlier x velocity x concentrate x maturity))
//
// The anchor TVL and the flow distribution read every row in input/snapshot.json; only
// positive-TVL live-token protocols fit the regression. No protocol name is special-cased and
// no row is hand-picked. Every row carries its base value, beta, category anchor, flow z and
// each tilt, so the dashboard can explain any rank.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The model's constants: every one is stated on the page and applied to every row. */
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

/** The version label the dashboard prints and the judge can quote. */
export const MODEL_VERSION = 'radar-4/velocity-concentration';

/**
 * Where a board row came from: the house's watchlist; a protocol below its floor that the radar
 * found on its own; or one at or above the floor that the house's screen left off the list.
 */
export type Origin = 'watchlist' | 'below-floor' | 'off-list';

/** A live-token protocol used as a comparable for a category. */
export interface Peer {
  slug: string;
  name: string;
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
  /** What the fitted category regression predicts for this peer's market cap. */
  predicted_mcap_usd: number;
}

/** One category's regression fit, category-mix anchor and robust flow distribution. */
export interface CategoryStat {
  category: string;
  peers: number;
  anchor_tvl_usd: number;
  /** log(cap/TVL) at the category anchor: the fitted category intercept. */
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

/** Every term in a row's implied value, kept for the board and the detail view. */
export interface Score {
  implied: number;
  age: number | null;
  base: number;
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
  /** The flow z floored at zero, or null for no flow or a stale week (which earn no boost). */
  velocity_z: number | null;
  velocity_boost_pct: number;
  velocity_mult: number;
  chain_count: number;
  concentration_single: boolean;
  concentration_mult: number;
  growth_pct: number;
  growth_mult: number;
  maturity_mult: number;
  multiple: number;
  base_multiple: number;
}

/** One row of board.json: the ranked board's row, with its arithmetic and its farm plan. */
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
  model: {
    version: string;
    base_value_usd: number;
    multiple: number;
    base_multiple: number;
    beta: number;
    category_log_multiple:number;
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
  };
  comparables: Peer[];
  farm_steps: string[];
}

/** A protocol whose token already trades: the market's value, never the model's. */
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

/** Everything the dashboard renders: the board, the live set, the model and its category table. */
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

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

const cmpSlug = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A whole day count from `as_of` back to `listed_at`, clamped at zero; null when unknown. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a list, or null when it is empty. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A wrapped, staked or staking product of a protocol whose token already trades. */
const WRAPPED = /\b(wrapped|staked|staking)\b/i;
/** A product named after a centralized exchange. */
const EXCHANGE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)/i;
/** Categories that are a bridge, a staking receipt, a restaking receipt or an exchange. */
const PRODUCT_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/**
 * Whether a pre-token protocol is a subject of its own: not a bridge, a staking receipt, an
 * exchange or a versioned pool, by the same screen the house's watchlist applies. A protocol the
 * screen rejects is no worse a read of the snapshot; it is a product of some other protocol.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !PRODUCT_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED.test(p.name) &&
    !EXCHANGE.test(p.name)
  );
}

/** Snapshot protocols by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The live-token protocols the comparable model measures: a positive TVL and a positive market cap. */
export function liveProtocols(snapshot: Snapshot): SnapshotProtocol[] {
  return snapshot.protocols.filter((p) => p.tvl_usd > 0 && p.mcap_usd !== null && p.mcap_usd > 0);
}

/** The model's comparable data: one fitted log-log regression and each category's fit. */
export interface Comparables {
  beta: number;
  pairs: number;
  live_peers: number;
  global_log_multiple_at_anchor: number;
  global_anchor_tvl_usd: number;
  global_center_multiple: number;
  global_flow: FlowStat;
  categories: Map<string, CategoryStat>;
  peers: Map<string, Peer[]>;
}

/** A robust centre and scale for one flow distribution. */
export interface FlowStat {
  center: number;
  scale: number;
  peers: number;
}

/** A robust centre and scale over a flow distribution: the median and 1.4826 x MAD. */
function robustFlow(values: number[], params: ModelParams): FlowStat {
  const center = median(values) ?? 0;
  const mad = median(values.map((value) => Math.abs(value - center))) ?? 0;
  return { center, scale: Math.max(params.flow_scale_floor, mad * 1.4826), peers: values.length };
}

/**
 * Fit log(mcap) = category intercept + beta x log(TVL) to the snapshot's own live-token protocols.
 * Beta is the pooled within-category Theil-Sen slope, so one extreme pair cannot set it. The fit is
 * parameterised at each category's anchor: cap = anchor x multiple x (TVL / anchor) ^ beta, with the
 * anchor the median TVL of every protocol the snapshot lists in the category (the category-mix
 * control) and the multiple the median cap/TVL of its live peers at that anchor, shrunk toward the
 * equal-category global median. Weekly flow is centred and scaled by the category's median and
 * 1.4826 x MAD, falling back to the whole snapshot when a category records fewer than
 * `flow_min_peers` readings.
 */
export function buildComparables(snapshot: Snapshot, params: ModelParams = MODEL): Comparables {
  const categoryOf = (p: SnapshotProtocol): string => p.category ?? 'Other';
  const live = liveProtocols(snapshot);
  const allGroups = new Map<string, SnapshotProtocol[]>();
  const liveGroups = new Map<string, SnapshotProtocol[]>();
  const flowGroups = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    const category = categoryOf(p);
    const all = allGroups.get(category);
    if (all === undefined) allGroups.set(category, [p]);
    else all.push(p);
    if (p.change_7d !== null) {
      const flows = flowGroups.get(category);
      if (flows === undefined) flowGroups.set(category, [p.change_7d]);
      else flows.push(p.change_7d);
    }
  }
  for (const p of live) {
    const category = categoryOf(p);
    const rows = liveGroups.get(category);
    if (rows === undefined) liveGroups.set(category, [p]);
    else rows.push(p);
  }

  // The category-mix control: median TVL over every protocol the snapshot lists in the category.
  const anchors = new Map<string, number>();
  for (const [category, rows] of allGroups) {
    anchors.set(category, median(rows.filter((p) => p.tvl_usd > 0).map((p) => p.tvl_usd)) ?? 1);
  }
  const globalAnchor = median(snapshot.protocols.filter((p) => p.tvl_usd > 0).map((p) => p.tvl_usd)) ?? 1;

  // A within-category Theil-Sen slope stops a category's row count from masquerading as scale;
  // pairs closer than beta_min_ratio in TVL are skipped as numerically unstable.
  const slopes: number[] = [];
  for (const rows of liveGroups.values()) {
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

  // The fit is stated anchor-relative: cap = anchor x multiple x (TVL / anchor) ^ beta. Each live
  // peer yields one estimate of its category's cap/TVL at that category's own anchor, and the
  // category takes the median of those; every category then votes once, so no category's row count
  // decides the global fallback.
  const rawLogMultiples = new Map<string, number>();
  for (const [category, rows] of liveGroups) {
    const anchor = anchors.get(category) ?? globalAnchor;
    rawLogMultiples.set(
      category,
      median(rows.map((p) => Math.log(p.mcap_usd! / p.tvl_usd) - (beta - 1) * Math.log(p.tvl_usd / anchor)))!,
    );
  }
  const globalLogMultiple = median([...rawLogMultiples.values()]) ?? Math.log(0.2);
  const globalFlow = robustFlow(
    snapshot.protocols.flatMap((p) => (p.change_7d === null ? [] : [p.change_7d])),
    params,
  );

  const categories = new Map<string, CategoryStat>();
  const peers = new Map<string, Peer[]>();
  for (const [category, rows] of allGroups) {
    const liveInCategory = liveGroups.get(category) ?? [];
    const raw = rawLogMultiples.get(category) ?? null;
    const n = liveInCategory.length;
    const anchor = anchors.get(category) ?? globalAnchor;
    const logMultiple =
      raw === null
        ? globalLogMultiple
        : (n * raw + params.multiple_prior_weight * globalLogMultiple) / (n + params.multiple_prior_weight);
    const flows = flowGroups.get(category) ?? [];
    const categoryFlow = flows.length >= params.flow_min_peers ? robustFlow(flows, params) : globalFlow;
    const observed = liveInCategory.map((p) =>
      clamp(p.mcap_usd! / p.tvl_usd, params.observed_multiple_floor, params.observed_multiple_cap),
    );
    categories.set(category, {
      category,
      peers: n,
      anchor_tvl_usd: anchor,
      log_multiple_at_anchor: logMultiple,
      raw_log_multiple_at_anchor: raw,
      multiple_at_anchor: Math.exp(logMultiple),
      median_multiple: median(observed),
      flow_center: categoryFlow.center,
      flow_scale: categoryFlow.scale,
      flow_peers: categoryFlow.peers,
      flow_fallback: flows.length < params.flow_min_peers,
      fallback: n === 0,
      rows: 0,
    });
    peers.set(
      category,
      liveInCategory
        .slice()
        .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || cmpSlug(a.slug, b.slug))
        .slice(0, 4)
        .map((p) => ({
          slug: p.slug,
          name: p.name,
          tvl_usd: p.tvl_usd,
          mcap_usd: p.mcap_usd ?? 0,
          multiple: round4(clamp(p.mcap_usd! / p.tvl_usd, params.observed_multiple_floor, params.observed_multiple_cap)),
          predicted_mcap_usd: anchor * Math.exp(logMultiple + beta * Math.log(p.tvl_usd / anchor)),
        })),
    );
  }
  return {
    beta,
    pairs: slopes.length,
    live_peers: live.length,
    global_log_multiple_at_anchor:globalLogMultiple,
    global_anchor_tvl_usd: globalAnchor,
    global_center_multiple: Math.exp(globalLogMultiple),
    global_flow: globalFlow,
    categories,
    peers,
  };
}

/**
 * One row's score: the fitted regression's base value, the robust-flow growth tilt, the bounded
 * outlier penalty, the launch-velocity boost, the single-chain concentration discount and the
 * maturity tilt. Every component is returned so the dashboard can show the arithmetic behind any
 * rank, and the stored multipliers are the same rounded values used to build `implied`, so the
 * page's recomputation reproduces it exactly.
 */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  comparables: Comparables,
  params: ModelParams = MODEL,
): Score {
  const age = ageDays(asOf, protocol.listed_at);
  const category = comparables.categories.get(protocol.category?? 'Other');
  const logMultiple = category?.log_multiple_at_anchor ??comparables.global_log_multiple_at_anchor;
  const anchor = category?.anchor_tvl_usd ?? comparables.global_anchor_tvl_usd;
  const categoryPeers = category?.peers ?? 0;
  const categoryFallback =category?.fallback ?? true;
  const tvl =Math.max(1, protocol.tvl_usd);
  const base = anchor * Math.exp(logMultiple +comparables.beta * Math.log(tvl / anchor));

  const flowCenter = category?.flow_center ?? comparables.global_flow.center;
  const flowScale = category?.flow_scale ?? comparables.global_flow.scale;
  const flowPeers = category?.flow_peers ?? comparables.global_flow.peers;
  const flowFallback = category?.flow_fallback ?? true;
  const rawFlow = protocol.change_7d;
  const flowZ = rawFlow === null ? null : (rawFlow - flowCenter) / flowScale;
  const flowUsed = flowZ === null ? flowCenter : flowCenter + clamp(flowZ, -params.flow_winsor, params.flow_winsor) * flowScale;
  const stale = flowZ !== null && Math.abs(flowZ) > params.flow_winsor;
  const excess = stale ? Math.abs(flowZ!) - params.flow_winsor : 0;
  const outlierPenalty = round4(clamp(1 - excess * params.flow_penalty_step, params.flow_penalty_floor, params.flow_penalty_cap));

  // Launch velocity: growth above the category's own robust centre earns a bounded boost, and a
  // flow at or below it earns nothing. It never subtracts; the outlier penalty owns the downside.
  // A stale week is already winsorized and damped, so it earns no velocity credit on top of that.
  const velocityZ = flowZ === null || stale ? null : Math.max(0, flowZ);
  const velocityCapped = Math.min(velocityZ ?? 0, params.velocity_cap);
  const velocityBoostPct = round4(velocityCapped * 100);
  const velocityMult = round4(1 + velocityCapped * params.velocity_weight);
  // Chain concentration: the snapshot records which chains a protocol runs on, never how its TVL
  // splits across them, so a single-chain record is the only concentration signal it carries.
  const chainCount = protocol.chains.length;
  const concentrationSingle = chainCount === 1;
  const concentrationMult = concentrationSingle ? params.concentration_single_mult : 1;

  const growthPct = round4(clamp(flowUsed, params.growth_floor, params.growth_cap));
  const growthMult = round4(1 + (growthPct / 100) * params.growth_weight);
  const ageForModel = age ?? params.unknown_age_days;
  const maturityMult = round4(
    params.maturity_floor +
      (Math.min(Math.max(ageForModel, 0), params.maturity_days) / params.maturity_days) * params.maturity_range,
  );
  const implied = Math.max(
    1,
    Math.round(base * growthMult * outlierPenalty * velocityMult * concentrationMult * maturityMult),
  );
  return {
    implied,
    age,
    base,
    beta: round4(comparables.beta),
    category_log_multiple: round4(logMultiple),
    category_anchor_tvl: anchor,
    category_peers: categoryPeers,
    category_multiple: round4(category?.multiple_at_anchor ?? comparables.global_center_multiple),
    category_fallback: categoryFallback,
    flow_center: round4(flowCenter),
    flow_scale: round4(flowScale),
    flow_peers: flowPeers,
    flow_fallback: flowFallback,
    flow_z: flowZ === null ? null : round4(flowZ),
    flow_used_pct: round4(flowUsed),
    flow_stale: stale,
    outlier_penalty: outlierPenalty,
    velocity_z: velocityZ === null ? null : round4(velocityZ),
    velocity_boost_pct: velocityBoostPct,
    velocity_mult: velocityMult,
    chain_count: chainCount,
    concentration_single: concentrationSingle,
    concentration_mult: concentrationMult,
    growth_pct: growthPct,
    growth_mult: growthMult,
    maturity_mult: maturityMult,
    multiple: round4(implied / tvl),
    base_multiple: round4(base / tvl),
  };
}

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
  const c = (p.category ?? '').toLowerCase();
  const exit =
    c.includes('rwa') || c.includes('rwa')
      ? `Before you enter, read ${p.name}'s redemption limits, identity requirements and settlement time on ${chain}, and keep enough USDC outside the position to cover the exit window.`
      : c.includes('risk curator') || c.includes('capital allocator')
        ? `Before you enter, read ${p.name}'s vault terms for lock-ups, withdrawal queues and curator fees on ${chain}, and keep a liquid reserve outside the vault.`
        : `Before you enter, check ${p.name}'s withdrawal rules, fees and any lock-up on ${chain}, and keep a small liquid reserve outside the position.`;
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
    stepText(exit, 'no fee unless the vault or asset charges one', '15 minutes'),
    stepText(
      `Record the wallet address, every deposit date, the gas paid and the position's value in a farm log, and re-check the position whenever the model's category multiple changes.`,
      'nothing but the log',
      '5 minutes',
    ),
  ];
}

/**
 * The protocols the board ranks. The watchlist first (every slug, whatever its figures). Then the
 * pre-token protocols the house's screen keeps but the list leaves out, strongest TVL first: below
 * the floor they are the early radar, at or above it they are the protocols the house's own parent
 * record set aside, and the rules call either no worse a subject than a listed one.
 */
export function boardUniverse(snapshot: Snapshot): SnapshotProtocol[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  const rest = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || cmpSlug(a.slug, b.slug));
  for (const p of rest) chosen.set(p.slug, p);
  return [...chosen.values()];
}

/** Which of the three ways a protocol reached the board. */
export function originOf(snapshot: Snapshot, slug: string, tvl: number): Origin {
  if (snapshot.watchlist.includes(slug)) return 'watchlist';
  return tvl < snapshot.floor_usd ? 'below-floor' : 'off-list';
}

/** The ranked board: every chosen protocol scored once, strongest implied value first. */
export function buildBoard(snapshot: Snapshot, params: ModelParams = MODEL): { board: BoardRow[]; comparables: Comparables } {
  const comparables = buildComparables(snapshot, params);
  const watchlist = new Set(snapshot.watchlist);
  const scored = boardUniverse(snapshot).map((p) => ({ p, s: impliedValue(p, snapshot.as_of, comparables, params) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || cmpSlug(a.p.slug, b.p.slug));
  const board = scored.map(({ p, s }, i) => ({
    rank: i + 1,
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
    token_status: 'pre-token' as const,
    watchlist: watchlist.has(p.slug),
    origin: originOf(snapshot, p.slug, p.tvl_usd),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      version: MODEL_VERSION,
      base_value_usd: s.base,
      multiple: s.multiple,
      base_multiple: s.base_multiple,
      beta: s.beta,
      category_log_multiple: s.category_log_multiple,
      category_anchor_tvl: s.category_anchor_tvl,
      category_peers: s.category_peers,
      category_multiple: s.category_multiple,
      category_fallback: s.category_fallback,
      flow_center: s.flow_center,
      flow_scale: s.flow_scale,
      flow_peers: s.flow_peers,
      flow_fallback: s.flow_fallback,
      flow_z: s.flow_z,
      flow_used_pct: s.flow_used_pct,
      flow_stale: s.flow_stale,
      outlier_penalty: s.outlier_penalty,
      velocity_z: s.velocity_z,
      velocity_boost_pct: s.velocity_boost_pct,
      velocity_multiplier: s.velocity_mult,
      chain_count: s.chain_count,
      concentration_single: s.concentration_single,
      concentration_multiplier: s.concentration_mult,
      growth_pct: s.growth_pct,
      growth_multiplier: s.growth_mult,
      maturity_multiplier: s.maturity_mult,
    },
    comparables: comparables.peers.get(p.category ?? 'Other') ?? [],
    farm_steps: farmSteps(p, s.age),
  }));
  return { board, comparables };
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
      multiple: p.tvl_usd > 0 ? round4(clamp((p.mcap_usd ?? 0) / p.tvl_usd, MODEL.observed_multiple_floor, MODEL.observed_multiple_cap)) : null,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, params: ModelParams = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, comparables } = buildBoard(snapshot, params);
  const watchlist = new Set(snapshot.watchlist);
  const live = liveRows(snapshot);
  const categories = [...comparables.categories.values()].map((c) => ({ ...c, rows: 0 }));
  const byCategory = new Map(categories.map((c) => [c.category, c]));
  for (const row of board) {
    const key = row.category ?? 'Other';
    const stat = byCategory.get(key);
    if (stat !== undefined) stat.rows += 1;
    else
      byCategory.set(key, {
        category: key,
        peers: 0,
        anchor_tvl_usd:comparables.global_anchor_tvl_usd,
        log_multiple_at_anchor: comparables.global_log_multiple_at_anchor,
        raw_log_multiple_at_anchor:null,
        multiple_at_anchor: comparables.global_center_multiple,
        median_multiple: null,
        flow_center: comparables.global_flow.center,
        flow_scale: comparables.global_flow.scale,
        flow_peers: comparables.global_flow.peers,
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
      beta: round4(comparables.beta),
      pairs: comparables.pairs,
      live_peers: comparables.live_peers,
      log_multiple_at_anchor: round4(comparables.global_log_multiple_at_anchor),
      anchor_tvl_usd: comparables.global_anchor_tvl_usd,
      multiple_at_anchor: round4(comparables.global_center_multiple),
      flow_center: round4(comparables.global_flow.center),
      flow_scale: round4(comparables.global_flow.scale),
      flow_peers: comparables.global_flow.peers,
    },
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => r.origin === 'below-floor').length,
    off_list_size: board.filter((r) => r.origin === 'off-list').length,
    live_size: live.length,
    token_recorded_size: snapshot.protocols.filter((p) => !isPreToken(p)).length,
    rows: board,
    live,
    categories: [...byCategory.values()].sort((a, b) => b.rows - a.rows || b.peers - a.peers || cmpSlug(a.category, b.category)),
  };
  return { board, radar };
}

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
    if (!isPreToken(row)) return `${row.slug} does not record a token but the model treats it as pre-token`;
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
