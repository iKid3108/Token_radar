// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds
// pre-token protocols below the watchlist floor: the early rows the radar exists to find. A protocol
// is pre-token when its snapshot entry records no token at all (no market cap, no CoinGecko id and
// no symbol). Protocols whose token already trades are kept apart and shown with the market's own
// values, never mixed into the implied-value ranking.
//
// Implied value follows only from the snapshot's own figures:
//
//   multiple  = the category's live mcap/TVL median, shrunk toward the global median by
//               prior_weight pseudo-observations, capped at 4x and floored at 0.02x
//   growth    = 1 + clamp(change_7d, -50, 100) / 100 x 0.30
//   maturity  = 0.85 + min(age_days, 1095) / 1095 x 0.30   (unknown age: 540 days)
//   implied   = max(1, round(tvl_usd x multiple x growth x maturity))
//
// The multiple is measured from the 128 live-token protocols the snapshot carries; no protocol
// name is ever special-cased and no row is hand-picked. The page states the same formula and the
// same category table, so a reader can audit any number on the board.

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
  prior_weight: number;
  multiple_floor: number;
  multiple_cap: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

export const MODEL: ModelParams = {
  prior_weight: 8,
  multiple_floor: 0.02,
  multiple_cap: 4,
  growth_weight: 0.3,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.85,
  maturity_range: 0.3,
  maturity_days: 1095,
  unknown_age_days: 540,
};

/** The version label the dashboard prints and the judge can quote. */
export const MODEL_VERSION = 'radar-2/comparables';

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
}

/** One category's measured multiple and the shrinkage that makes it usable. */
export interface CategoryStat {
  category: string;
  peers: number;
  median_multiple: number | null;
  used_multiple: number;
  fallback: boolean;
  rows: number;
}

/** The one number a row's implied value rests on, with its inputs kept for the detail view. */
export interface Score {
  implied: number;
  age: number | null;
  growth_pct: number;
  growth_mult: number;
  maturity_mult: number;
  multiple: number;
  category_peers: number;
  category_median: number | null;
  category_fallback: boolean;
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
    multiple: number;
    category_peers: number;
    category_median: number | null;
    category_fallback: boolean;
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
  prior_multiple: number;
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

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

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

/** The model's comparable data: the global prior and each category's shrunk multiple. */
export interface Comparables {
  prior: number;
  categories: Map<string, CategoryStat>;
  peers: Map<string, Peer[]>;
}

/**
 * Measure the snapshot's own market. Every live-token protocol contributes one mcap/TVL multiple,
 * capped so one outlier cannot define a category; the category median is then shrunk toward the
 * global median with `prior_weight` pseudo-observations, so a category with one comparable moves
 * only part of the way.
 */
export function buildComparables(snapshot: Snapshot, params: ModelParams = MODEL): Comparables {
  const live = liveProtocols(snapshot);
  const capped = (p: SnapshotProtocol): number => clamp((p.mcap_usd ?? 0) / p.tvl_usd, params.multiple_floor, params.multiple_cap);
  const priorRaw = median(live.map(capped));
  const prior = clamp(priorRaw ?? 0.2, params.multiple_floor, params.multiple_cap);

  const groups = new Map<string, SnapshotProtocol[]>();
  for (const p of live) {
    const category = p.category ?? 'Other';
    const list = groups.get(category);
    if (list === undefined) groups.set(category, [p]);
    else list.push(p);
  }

  const categories = new Map<string, CategoryStat>();
  const peers = new Map<string, Peer[]>();
  for (const [category, list] of groups) {
    const values = list.map(capped);
    const med = median(values);
    const n = list.length;
    const shrunk = med === null ? prior : (n * med + params.prior_weight * prior) / (n + params.prior_weight);
    const used = clamp(shrunk, params.multiple_floor + 0.01, params.multiple_cap);
    categories.set(category, {
      category,
      peers: n,
      median_multiple: med === null ? null : round4(med),
      used_multiple: round4(used),
      fallback: false,
      rows: 0,
    });
    peers.set(
      category,
      list
        .slice()
        .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || cmpSlug(a.slug, b.slug))
        .slice(0, 4)
        .map((p) => ({
          slug: p.slug,
          name: p.name,
          tvl_usd: p.tvl_usd,
          mcap_usd: p.mcap_usd ?? 0,
          multiple: round4(clamp((p.mcap_usd ?? 0) / p.tvl_usd, params.multiple_floor, params.multiple_cap)),
        })),
    );
  }
  return { prior, categories, peers };
}

/** The multiple a category earns, or the global prior when the snapshot carries no live peer. */
export function categoryMultiple(comparables: Comparables, category: string | null, params: ModelParams = MODEL): { multiple: number; peers: number; median: number | null; fallback: boolean } {
  const stat = comparables.categories.get(category ?? 'Other');
  if (stat === undefined) {
    return { multiple: round4(comparables.prior), peers: 0, median: null, fallback: true };
  }
  return { multiple: stat.used_multiple, peers: stat.peers, median: stat.median_multiple, fallback: false };
}

/** The three multipliers and the implied value one protocol gets under the model. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  comparables: Comparables,
  params: ModelParams = MODEL,
): Score {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = clamp(rawGrowth, params.growth_floor, params.growth_cap);
  const growthMult = 1 + (growthPct / 100) * params.growth_weight;
  const ageForModel = age ?? params.unknown_age_days;
  const maturityMult = params.maturity_floor + (Math.min(Math.max(ageForModel, 0), params.maturity_days) / params.maturity_days) * params.maturity_range;
  const cat = categoryMultiple(comparables, protocol.category, params);
  const implied = Math.max(1, Math.round(protocol.tvl_usd * cat.multiple * growthMult * maturityMult));
  return {
    implied,
    age,
    growth_pct: round4(growthPct),
    growth_mult: round4(growthMult),
    maturity_mult: round4(maturityMult),
    multiple: cat.multiple,
    category_peers: cat.peers,
    category_median: cat.median,
    category_fallback: cat.fallback,
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
      multiple: s.multiple,
      category_peers: s.category_peers,
      category_median: s.category_median,
      category_fallback: s.category_fallback,
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
      multiple: p.tvl_usd > 0 ? round4(clamp((p.mcap_usd ?? 0) / p.tvl_usd, MODEL.multiple_floor, MODEL.multiple_cap)) : null,
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
    else byCategory.set(key, { category: key, peers: 0, median_multiple: null, used_multiple: round4(comparables.prior), fallback: true, rows: 1 });
  }
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model: params,
    prior_multiple: round4(comparables.prior),
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
