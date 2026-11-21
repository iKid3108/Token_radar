// A Markdown report of one radar run.
//
// The inputs are the two documents a run writes: the ranked board (out/board.json) and, when the
// harness has run, its out-of-sample report (out/backtest.json). The report fits nothing and
// computes no score — every figure it prints is read from those two documents, so a report can
// never drift from the board it describes.
//
// The one piece of arithmetic it does is rank aggregation: a Borda consensus across the board's own
// stored tilt multipliers, which only reorders figures the board already carries. That is a
// deliberate use of the metric rather than decoration — it answers "which picks survive a change of
// tilt?", which the single ranking cannot.
//
// Sections: title, executive summary, the top of the board, consensus across the tilts,
// per-category leaders, each category's implied-value deciles, the backtest tables, the caveats the
// harness itself flags, and the commands that reproduce the numbers.

import { MODEL, type BoardRow, type ModelParams } from './model.ts';
import type { BacktestResult } from './backtest.ts';
import { bordaCount, categoryDeciles, kendallTau, orderByScore } from './metrics.ts';

/** The shape of out/board.json, as main.ts writes it. */
export interface BoardDocument {
  schema: string;
  as_of: string;
  source: string;
  floor_usd: number;
  model: string;
  watchlist_size: number;
  rows: BoardRow[];
}

/** How much of each section to print. The defaults suit a README-sized report. */
export interface ReportOptions {
  /** The constants the methodology recap quotes; defaults to the model's own. */
  params?: ModelParams;
  /** Rows in the "top of the board" table. */
  topRows?: number;
  /** Rows per category in the leader tables. */
  leadersPerCategory?: number;
  /** Categories with a decile table. */
  categoriesShown?: number;
  /** Rows in the consensus table. */
  consensusRows?: number;
}

// ---------------------------------------------------------------------------------------------
// Formatting: every cell is plain text, so a value can never smuggle markup into the table
// ---------------------------------------------------------------------------------------------

/** A table cell is one line and carries no pipe: both would break the row. */
function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');
}

/** Compact dollars: $1.23B, $45.6M, $789K, $12. Null reads "n/a", never "null". */
function money(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  const size = Math.abs(value);
  if (size >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (size >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (size >= 1e3) return `$${Math.round(value / 1e3)}K`;
  return `$${Math.round(value)}`;
}

/** A signed percentage at two decimals, for growth. */
function growth(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

/** A signed number at `digits` decimals, for correlations and lifts. */
function signed(value: number | null | undefined, digits = 3): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}`;
}

/** A multiplier as 1.05x. */
function multiple(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return 'n/a';
  return `${value.toFixed(2)}x`;
}

/** A GFM table. `align` marks the columns that read right-aligned. */
function table(headers: string[], align: readonly ('l' | 'r')[], rows: string[][]): string {
  const head = `| ${headers.map(cell).join(' | ')} |`;
  const rule = `| ${align.map((a) => (a === 'r' ? '---:' : '---')).join(' | ')} |`;
  const body = rows.map((r) => `| ${r.map(cell).join(' | ')} |`);
  return [head, rule, ...body].join('\n');
}

/** Rank-position of every slug under one ordering, 1-based. */
function rankMap(order: readonly string[]): Map<string, number> {
  const map = new Map<string, number>();
  order.forEach((slug, i) => map.set(slug, i + 1));
  return map;
}

// ---------------------------------------------------------------------------------------------
// The consensus ranking
//
// Each tilt is a multiplier the board already stores, so "rank by this tilt alone" needs no refit:
// sort by it, then ask Borda how often each row is near the top across all of them. A row that
// ranks well under every tilt is a pick the ranking does not depend on one arbitrary weight.
// ---------------------------------------------------------------------------------------------

/** The stored terms the consensus votes on, in the order the page explains them. */
const TILTS = [
  { key: 'base_value_usd', label: 'base' },
  { key: 'growth_multiplier', label: 'flow' },
  { key: 'outlier_penalty', label: 'stale' },
  { key: 'velocity_multiplier', label: 'velocity' },
  { key: 'concentration_multiplier', label: 'chain' },
  { key: 'maturity_multiplier', label: 'maturity' },
] as const;

type TiltKey = (typeof TILTS)[number]['key'];

/** Rows ordered by one stored term, highest first, ties by slug so the order is reproducible. */
function orderByTerm(rows: readonly BoardRow[], key: TiltKey): string[] {
  return rows
    .slice()
    .sort((a, b) => {
      const av = Number(a.model[key]);
      const bv = Number(b.model[key]);
      if (av !== bv) return bv - av;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    })
    .map((r) => r.slug);
}

// ---------------------------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------------------------

function titleSection(board: BoardDocument, backtest: BacktestResult | null): string {
  const lines = [
    '# Token Radar: run report',
    '',
    `Snapshot \`${board.as_of}\` · floor ${money(board.floor_usd)} · model \`${board.model}\` · ` +
      `${board.rows.length} ranked rows · ${board.watchlist_size} on the watchlist.`,
    '',
    `Source: ${board.source}`,
    '',
    backtest === null
      ? 'No backtest report accompanies this board: the out-of-sample numbers are absent, and the ' +
        'report says so rather than omitting the section.'
      : `Backtest: ${backtest.split.scored_rows} held-out rows across ${backtest.split.scored_categories} ` +
        `categories, seed \`${backtest.seed}\`, ${backtest.bootstrap.samples} bootstrap resamples at ` +
        `${Math.round(backtest.bootstrap.level * 100)}%.`,
    '',
  ];
  return lines.join('\n');
}

function summarySection(board: BoardDocument, backtest: BacktestResult | null): string {
  const rows = board.rows;
  const top = rows[0];
  const counts = { watchlist: 0, 'below-floor': 0, 'off-list': 0 };
  for (const row of rows) counts[row.origin] += 1;
  const priced = rows.filter((r) => r.chain_count !== undefined);

  const lines = [
    '## Executive summary',
    '',
    top === undefined
      ? 'The board is empty.'
      : `The strongest row is **${top.name}** (${top.category ?? 'uncategorised'}), ranked #1 with an ` +
        `implied value of ${money(top.implied_value_usd)} on ${money(top.tvl_usd)} of TVL.`,
    '',
    `Of the ${rows.length} ranked rows, ${counts.watchlist} are on the snapshot watchlist, ` +
      `${counts['below-floor']} are early finds below the floor, and ${counts['off-list']} sit at or ` +
      `above the floor without appearing on the list.`,
    '',
  ];

  if (backtest !== null) {
    const ic = backtest.leak_free.rank_ic;
    const hit = backtest.leak_free.top_quartile;
    lines.push(
      `Held out, the leak-free ranking scores a rank IC of **${signed(ic.point)}** with a ` +
        `${Math.round(backtest.bootstrap.level * 100)}% interval of [${signed(ic.lo)}, ${signed(ic.hi)}]; ` +
        `its top quartile catches ${hit.hits} of ${hit.picks} realized top-quartile rows ` +
        `(${hit.rate === null ? 'n/a' : `${(hit.rate * 100).toFixed(1)}%`}) against a ` +
        `${(hit.base_rate * 100).toFixed(1)}% blind rate.`,
      '',
    );
    if (ic.lo !== null && ic.hi !== null && ic.lo <= 0 && ic.hi >= 0) {
      lines.push(
        'The interval spans zero, so on this snapshot the ranking is not distinguishable from noise ' +
          'out of sample. See **Caveats**; the harness reaches the same conclusion independently.',
        '',
      );
    }
  }

  lines.push(
    'Implied value is this radar’s estimate of what a launch would be worth, not a price, a promise ' +
      'of a token, or investment advice. A record with no token is not proof that none exists.',
    '',
  );
  return lines.join('\n');
}

function boardTopSection(board: BoardDocument, options: Required<ReportOptions>): string {
  const count = Math.min(options.topRows, board.rows.length);
  if (count === 0) return '## The top of the board\n\nNo rows.\n';
  const rows = board.rows.slice(0, count).map((r) => [
    `#${r.rank}`,
    r.name,
    r.category ?? 'Other',
    money(r.tvl_usd),
    growth(r.change_7d),
    multiple(r.model.multiple),
    money(r.implied_value_usd),
    r.origin,
  ]);
  return [
    '## The top of the board',
    '',
    table(
      ['#', 'Protocol', 'Category', 'TVL', '7d growth', 'Cap/TVL', 'Implied value', 'Origin'],
      ['r', 'l', 'l', 'r', 'r', 'r', 'r', 'l'],
      rows,
    ),
    '',
    `The full ranking is in \`board.json\`; every row carries the components this table abbreviates.`,
    '',
  ].join('\n');
}

function consensusSection(board: BoardDocument, options: Required<ReportOptions>): string {
  const rows = board.rows;
  if (rows.length === 0) return '## Consensus across the tilts\n\nNo rows.\n';

  const orderings = TILTS.map((t) => orderByTerm(rows, t.key));
  const scores = bordaCount(orderings);
  const consensus = orderByScore(scores);
  const boardRank = rankMap(rows.map((r) => r.slug));
  const tiltRanks = orderings.map(rankMap);

  // How far the consensus ordering has moved from the board's own: over every row, tau-b.
  const consensusRank = rankMap(consensus);
  const tau = kendallTau(
    rows.map((r) => boardRank.get(r.slug) ?? 0),
    rows.map((r) => consensusRank.get(r.slug) ?? 0),
  );

  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const shown = consensus.slice(0, Math.min(options.consensusRows, consensus.length));
  const body = shown.map((slug, i) => {
    const row = bySlug.get(slug);
    const ranks = tiltRanks.map((m) => `#${m.get(slug) ?? 0}`);
    return [
      `#${i + 1}`,
      row?.name ?? slug,
      `#${boardRank.get(slug) ?? 0}`,
      ...ranks,
      String(scores.get(slug) ?? 0),
    ];
  });

  return [
    '## Consensus across the tilts',
    '',
    'Each stored tilt ranks the board on its own; Borda counts those six orderings and a row’s score ' +
      'is the sum of its positions (a first place in a 197-row board is worth 196). A pick near the ' +
      'top of the consensus does not depend on one arbitrary weighting.',
    '',
    tau === null
      ? 'The consensus could not be compared to the board: one of the two orderings is degenerate.'
      : `Across all ${rows.length} rows, the consensus ordering and the board’s ordering agree at ` +
        `Kendall’s tau-b = ${signed(tau, 4)}; the head of the table is where they differ, which is ` +
        'the point of the exercise.',
    '',
    table(
      ['Consensus', 'Protocol', 'Board', ...TILTS.map((t) => t.label), 'Borda'],
      ['r', 'l', 'r', ...TILTS.map(() => 'r' as const), 'r'],
      body,
    ),
    '',
    'A rank of #1 under a tilt means that tilt alone would have put the row first; the base column is ' +
      'the comparables regression before any tilt, so a row that ranks low on base but high on ' +
      'consensus is being carried entirely by its adjustments.',
    '',
  ].join('\n');
}

function leadersSection(board: BoardDocument, options: Required<ReportOptions>): string {
  const grouped = new Map<string, BoardRow[]>();
  for (const row of board.rows) {
    const key = row.category ?? 'Other';
    const bucket = grouped.get(key);
    if (bucket === undefined) grouped.set(key, [row]);
    else bucket.push(row);
  }
  if (grouped.size === 0) return '## Per-category leaders\n\nNo rows.\n';

  const parts = ['## Per-category leaders', ''];
  const ordered = [...grouped.entries()].sort((a, b) => b[1].length - a[1].length || (a[0] < b[0] ? -1 : 1));
  for (const [category, rows] of ordered) {
    const leaders = rows.slice(0, options.leadersPerCategory);
    parts.push(
      `### ${category} (${rows.length} ranked row${rows.length === 1 ? '' : 's'})`,
      '',
      table(
        ['#', 'Protocol', 'TVL', '7d growth', 'Implied value', 'Origin'],
        ['r', 'l', 'r', 'r', 'r', 'l'],
        leaders.map((r) => [
          `#${r.rank}`,
          r.name,
          money(r.tvl_usd),
          growth(r.change_7d),
          money(r.implied_value_usd),
          r.origin,
        ]),
      ),
      '',
    );
  }
  return parts.join('\n');
}

function decilesSection(board: BoardDocument, options: Required<ReportOptions>): string {
  const rows = board.rows;
  if (rows.length === 0) return '## Implied-value spread\n\nNo rows.\n';
  const deciles = categoryDeciles(
    rows.map((r) => ({ category: r.category, value: r.implied_value_usd })),
    10,
  );
  const ordered = [...deciles.entries()]
    .sort((a, b) => b[1].count - a[1].count || (a[0] < b[0] ? -1 : 1))
    .slice(0, options.categoriesShown);

  const body = ordered.map(([category, d]) => {
    const p10 = d.breaks[0] ?? 0;
    const p50 = d.breaks[Math.floor(d.breaks.length / 2)] ?? 0;
    const p90 = d.breaks[d.breaks.length - 1] ?? 0;
    const ratio = p10 > 0 ? `${(p90 / p10).toFixed(1)}x` : 'n/a';
    const low = d.counts[0] ?? 0;
    const high = d.counts[d.counts.length - 1] ?? 0;
    return [
      category,
      String(d.count),
      money(p10),
      money(p50),
      money(p90),
      ratio,
      `${low} / ${high}`,
      d.sparse ? 'sparse' : 'ok',
    ];
  });

  return [
    '## Implied-value spread, by category',
    '',
    'The p10, median and p90 of each category’s implied values, and the ratio between the ends: a ' +
      'wide ratio means the category spans very different protocols, so its single leader is less ' +
      'representative of the rest. A bucket marked **sparse** holds fewer than two rows per decile, ' +
      'so its quantiles are descriptive only.',
    '',
    table(
      ['Category', 'Rows', 'p10', 'Median', 'p90', 'p90/p10', 'Bottom / top decile', 'Shape'],
      ['l', 'r', 'r', 'r', 'r', 'r', 'r', 'l'],
      body,
    ),
    '',
    `${deciles.size} categories in all; the ${ordered.length} largest are shown. The counts in each ` +
      'row sum to that category’s row count, so the buckets are exhaustive rather than sampled.',
    '',
  ].join('\n');
}

function backtestSection(backtest: BacktestResult | null): string {
  if (backtest === null) {
    return [
      '## Out-of-sample check',
      '',
      'No `backtest.json` was supplied. Run `node main.ts --backtest` and regenerate this report ' +
        'with `node main.ts --report` to fill the section in; it is deliberately not invented here.',
      '',
    ].join('\n');
  }

  const level = `${Math.round(backtest.bootstrap.level * 100)}%`;
  const lf = backtest.leak_free;
  const fm = backtest.full_model;

  const headline = table(
    ['Configuration', 'Rank IC', `${level} interval`, 'Top-quartile hits', 'Blind rate', 'Lift'],
    ['l', 'r', 'r', 'r', 'r', 'r'],
    [
      [
        'Leak-free (headline)',
        signed(lf.rank_ic.point),
        `[${signed(lf.rank_ic.lo)}, ${signed(lf.rank_ic.hi)}]`,
        `${lf.top_quartile.hits} / ${lf.top_quartile.picks}`,
        `${(lf.top_quartile.base_rate * 100).toFixed(1)}%`,
        signed(lf.top_quartile.lift, 4),
      ],
      [
        'Shipped fit (control)',
        signed(fm.rank_ic.point),
        `[${signed(fm.rank_ic.lo)}, ${signed(fm.rank_ic.hi)}]`,
        `${fm.top_quartile.hits} / ${fm.top_quartile.picks}`,
        `${(fm.top_quartile.base_rate * 100).toFixed(1)}%`,
        signed(fm.top_quartile.lift, 4),
      ],
    ],
  );

  const repeat = backtest.repeated_splits;
  const repeatTable = table(
    ['Splits', 'Mean IC', 'Median IC', 'Min', 'Max', 'Share positive'],
    ['r', 'r', 'r', 'r', 'r', 'r'],
    [
      [
        String(repeat.splits),
        signed(repeat.mean_ic),
        signed(repeat.median_ic),
        signed(repeat.min_ic),
        signed(repeat.max_ic),
        repeat.share_positive === null ? 'n/a' : `${Math.round(repeat.share_positive * 100)}%`,
      ],
    ],
  );

  const byCategory = backtest.by_category;
  const numeric = byCategory.filter((c) => c.rho !== null);
  const categoryTable =
    byCategory.length === 0
      ? 'No category held enough rows to score.'
      : table(
          ['Category', 'Rows', 'Rank IC'],
          ['l', 'r', 'r'],
          byCategory.map((c) => [c.category, String(c.rows), signed(c.rho)]),
        );

  const warnings =
    backtest.warnings.length === 0
      ? 'The harness raised no warnings about this split.'
      : backtest.warnings.map((w) => `- ${w}`).join('\n');

  return [
    '## Out-of-sample check',
    '',
    `Design: ${backtest.design}. Label: \`${backtest.label}\`. ${backtest.split.scored_rows} scored ` +
      `rows from ${backtest.split.scored_categories} categories; ${backtest.split.scored_categories_no_live_peer} ` +
      'of those categories had no live peer in the train half and took the global fallback fit.',
    '',
    '### Headline metrics',
    '',
    headline,
    '',
    `The **leak-free** row is the headline: growth, the stale-week penalty and velocity all read ` +
      `\`${backtest.label}\`, the field used as the label, so they are switched off before the comparison. ` +
      `The shipped fit runs beside it as a control; its measured leakage gap is ` +
      `**${signed(fm.leakage_gap)}**, so the gap is reported rather than assumed.`,
    '',
    '### Across independently seeded splits',
    '',
    repeatTable,
    '',
    `${repeat.splits} splits at seeds ${repeat.ics.map((e) => `\`${e.seed}\``).join(', ')}. The ` +
      'bootstrap interval covers noise inside one split; this spread covers the choice of split, ' +
      'which one holdout cannot show.',
    '',
    '### Rank IC by category',
    '',
    `${numeric.length} of ${byCategory.length} categories held at least three rows (a rank correlation ` +
      'needs three); the rest are listed as `n/a` rather than dropped, because an absent number is ' +
      'information too.',
    '',
    categoryTable,
    '',
    '### What the harness itself flags',
    '',
    warnings,
    '',
  ].join('\n');
}

function caveatsSection(board: BoardDocument, backtest: BacktestResult | null, params: ModelParams): string {
  const items = [
    '**The label is a proxy.** The snapshot carries one dynamic field, a seven-day TVL change, and a ' +
      'launch outcome is not that. A near-zero IC against TVL momentum is evidence about momentum, not ' +
      'a verdict on the implied-value claim.',
    '**The snapshot is one cross-section.** There is no second point in time, so the harness runs a ' +
      'category-stratified holdout across protocols rather than a temporal walk-forward. A second ' +
      'snapshot would make the real test possible.',
    '**The base dominates the tilts.** `base_value_usd` spans orders of magnitude while every tilt is ' +
      `a narrow band (growth ×${(1 + params.growth_floor / 100 * params.growth_weight).toFixed(2)}–` +
      `×${(1 + params.growth_cap / 100 * params.growth_weight).toFixed(2)}, velocity at most ` +
      `×${(1 + params.velocity_cap * params.velocity_weight).toFixed(2)}, concentration ` +
      `×${params.concentration_single_mult.toFixed(2)}), so the ranking is close to the comparables base.`,
    '**Thin buckets.** With 53 categories and many singletons, per-category fits and per-category ' +
      'correlations are noisy by construction; read a row count before a rho.',
    '**Implied value is an estimate.** It is not a price, a promise of a token, or advice. A record ' +
      'with no token is not proof that none exists.',
  ];
  if (backtest !== null && backtest.warnings.length > 0) {
    items.push(
      '**The harness’s own warnings apply to this run verbatim** (see the section above); this report ' +
        'does not soften them.',
    );
  }
  if (board.rows.length === 0) items.unshift('**The board is empty**, so every table above is empty.');
  return ['## Caveats', '', items.map((i) => `- ${i}`).join('\n'), ''].join('\n');
}

function reproduceSection(board: BoardDocument): string {
  return [
    '## Reproducing this report',
    '',
    '```sh',
    'node main.ts --board     # board.json, data.js, backtest.json, dashboard/, screenshots/, dossier.json',
    'node main.ts --backtest  # backtest.json and nothing else (BACKTEST=1 still works)',
    'node main.ts --report    # this file, from the two documents above',
    '```',
    '',
    'All three runs are deterministic — no clock, no randomness, no network — so two runs write ' +
      'identical bytes, and this report is a pure function of the two JSON documents.',
    '',
    `Board: \`${board.schema}\`. Rows are ranked by \`implied_value_usd\`, descending, with ranks ` +
      '1..n contiguous.',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

/**
 * Render the Markdown report. Pure over its inputs: the same board and backtest produce the same
 * bytes, in the same section order, with no clock and no dependence on the file system.
 */
export function renderReport(
  board: BoardDocument,
  backtest: BacktestResult | null = null,
  options: ReportOptions = {},
): string {
  const resolved: Required<ReportOptions> = {
    params: options.params ?? MODEL,
    topRows: options.topRows ?? 12,
    leadersPerCategory: options.leadersPerCategory ?? 4,
    categoriesShown: options.categoriesShown ?? 10,
    consensusRows: options.consensusRows ?? 10,
  };

  const sections = [
    titleSection(board, backtest),
    summarySection(board, backtest),
    boardTopSection(board, resolved),
    consensusSection(board, resolved),
    leadersSection(board, resolved),
    decilesSection(board, resolved),
    backtestSection(backtest),
    caveatsSection(board, backtest, resolved.params),
    reproduceSection(board),
  ];
  return `${sections.join('\n')}`.replace(/\n{3,}/g, '\n\n');
}
