// The radar's tests: one file, no dependencies, run by Node 22 as-is.
//
//   node tests/run-tests.ts            every suite
//   node tests/run-tests.ts metrics    only suites whose name contains "metrics"
//   node tests/run-tests.ts --list     suite and test names, run nothing
//
// Three kinds of test, on purpose:
//
//   metrics     the rank statistics on fixtures whose answers are known by hand, independent of
//               this repository: a tau-b value from the textbook, a Borda count worked out on paper
//   components  scoreComponents() on the sealed snapshot, compared against recorded goldens for four
//               protocols (strongest, first stale week, first global fallback, weakest) plus the
//               invariants every row must satisfy whatever the numbers happen to be
//   smoke       `node main.ts --board` end to end into two temporary directories: exit code, valid
//               JSON, the scorer's caps, and a second run that must repeat the first's bytes
//
// Exit code 0 when every test passes, 1 when one fails, 2 when the command line itself is wrong.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  bordaCount,
  bootstrapSpearman,
  categoryDeciles,
  decileBreaks,
  fnv1a,
  kendallTau,
  mean,
  median,
  mulberry32,
  orderByScore,
  quantile,
  rankAverage,
  reciprocalRank,
  spearman,
  topQuartileHit,
} from '../lib/metrics.ts';
import {
  MODEL,
  MODEL_VERSION,
  buildBoard,
  comparablesBaseline,
  flowAdjust,
  loadProtocols,
  scoreComponents,
  type RowComponents,
  type Snapshot,
} from '../lib/model.ts';

/** This repository's root, wherever the runner is started. */
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const SNAPSHOT_PATH = join(ROOT, 'input', 'snapshot.json');
const GOLDEN_PATH = join(HERE, 'golden', 'components.json');

const USAGE = `token radar tests: node tests/run-tests.ts [name-filter ...] [--list]

Exit codes: 0 every test passed, 1 something failed, 2 bad arguments.
`;

// ---------------------------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------------------------

type TestBody = () => void | Promise<void>;

interface TestCase {
  name: string;
  body: TestBody;
}

interface Suite {
  name: string;
  cases: TestCase[];
}

const suites: Suite[] = [];
let current: Suite | null = null;

/** Declare a suite; every `test()` until the next `suite()` belongs to it. */
function suite(name: string, body: () => void): void {
  const made: Suite = { name, cases: [] };
  suites.push(made);
  current = made;
  body();
  current = null;
}

/** Declare one test. Only legal inside a `suite()` body. */
function test(name: string, body: TestBody): void {
  if (current === null) throw new Error(`test("${name}") declared outside a suite`);
  current.cases.push({ name, body });
}

/** A failed assertion: already words the mismatch, so the runner adds no stack. */
class AssertionError extends Error {}

function fail(message: string): never {
  throw new AssertionError(message);
}

/** A short rendering of a value for an assertion message. */
function show(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return String(value);
  if (value === undefined) return 'undefined';
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

const assert = {
  ok(value: unknown, what = 'value'): void {
    if (!value) fail(`expected ${what} to be truthy, got ${show(value)}`);
  },

  equal<T>(actual: T, expected: T, what = 'value'): void {
    if (!Object.is(actual, expected)) fail(`expected ${what} ${show(expected)}, got ${show(actual)}`);
  },

  /** Numeric equality at a stated precision. */
  close(actual: number, expected: number, digits = 9, what = 'value'): void {
    if (!Number.isFinite(actual)) fail(`expected ${what} ${expected}, got ${show(actual)}`);
    const slack = 0.5 * 10 ** -digits;
    if (Math.abs(actual - expected) > slack) fail(`expected ${what} ${expected} (±${slack}), got ${actual}`);
  },

  /** Deep equality over JSON-shaped values, naming the first differing path. */
  deep(actual: unknown, expected: unknown, what = 'value'): void {
    const path = firstDifference(actual, expected, what);
    if (path !== null) fail(`expected ${what} to match; ${path}`);
  },

  /** The whole array, so a NaN is visible rather than merely unequal. */
  sameNumbers(actual: readonly number[], expected: readonly number[], what = 'array'): void {
    assert.equal(actual.length, expected.length, `${what} length`);
    for (let i = 0; i < expected.length; i++) {
      if (!Object.is(actual[i], expected[i])) {
        fail(`expected ${what}[${i}] ${expected[i]}, got ${actual[i]} (in ${show(actual)})`);
      }
    }
  },
};

/** The first path where two JSON-shaped values differ, or null when they agree. */
function firstDifference(actual: unknown, expected: unknown, path: string): string | null {
  if (Object.is(actual, expected)) return null;
  if (Array.isArray(expected) || Array.isArray(actual)) {
    if (!Array.isArray(actual) || !Array.isArray(expected)) {
      return `${path} is ${show(actual)}, expected ${show(expected)}`;
    }
    if (actual.length !== expected.length) {
      return `${path} has ${actual.length} items, expected ${expected.length}`;
    }
    for (let i = 0; i < expected.length; i++) {
      const deeper = firstDifference(actual[i], expected[i], `${path}[${i}]`);
      if (deeper !== null) return deeper;
    }
    return null;
  }
  if (expected !== null && actual !== null && typeof expected === 'object' && typeof actual === 'object') {
    const a = actual as Record<string, unknown>;
    const e = expected as Record<string, unknown>;
    for (const key of [...new Set([...Object.keys(e), ...Object.keys(a)])].sort()) {
      if (!(key in a)) return `${path}.${key} is missing`;
      if (!(key in e)) return `${path}.${key} is unexpected (${show(a[key])})`;
      const deeper = firstDifference(a[key], e[key], `${path}.${key}`);
      if (deeper !== null) return deeper;
    }
    return null;
  }
  return `${path} is ${show(actual)}, expected ${show(expected)}`;
}

// ---------------------------------------------------------------------------------------------
// Suite 1: order statistics
// ---------------------------------------------------------------------------------------------

suite('metrics: order statistics', () => {
  test('median and mean, including the empty list', () => {
    assert.equal(median([3, 1, 2]), 2);
    assert.equal(median([4, 1, 3, 2]), 2.5);
    assert.equal(median([]), 0, 'median of an empty list');
    assert.equal(mean([]), 0, 'mean of an empty list');
    assert.equal(mean([1, 2, 3, 4]), 2.5);
  });

  test('quantile interpolates and clamps rather than returning NaN', () => {
    const xs = [10, 20, 30, 40];
    assert.equal(quantile(xs, 0), 10);
    assert.equal(quantile(xs, 1), 40);
    assert.equal(quantile(xs, 0.5), 25);
    assert.equal(quantile(xs, -3), 10, 'a quantile below 0 clamps');
    assert.equal(quantile(xs, 2), 40, 'a quantile above 1 clamps');
    assert.equal(quantile([], 0.5), 0, 'quantile of an empty list');
  });

  test('rankAverage shares a rank among ties', () => {
    assert.sameNumbers(rankAverage([10, 20, 20, 30]), [1, 2.5, 2.5, 4]);
    assert.sameNumbers(rankAverage([5, 5, 5]), [2, 2, 2]);
    assert.sameNumbers(rankAverage([1]), [1]);
  });

  test('spearman is +1 rising, -1 falling, null when undefined', () => {
    assert.close(spearman([1, 2, 3, 4], [10, 20, 30, 40])!, 1);
    assert.close(spearman([1, 2, 3, 4], [40, 30, 20, 10])!, -1);
    assert.equal(spearman([1, 1, 1, 1], [1, 2, 3, 4]), null, 'a constant series');
    assert.equal(spearman([1, 2], [1, 2]), null, 'fewer than three pairs');
    assert.equal(spearman([1, 2, 3], [1, 2]), null, 'unequal lengths');
  });

  test('bootstrapSpearman repeats for a seed and brackets its point', () => {
    const pred = [1, 4, 2, 9, 3, 8, 5, 7, 6];
    const label = [2, 3, 1, 8, 4, 9, 6, 7, 5];
    const a = bootstrapSpearman(pred, label, { samples: 200, seed: 7 });
    const b = bootstrapSpearman(pred, label, { samples: 200, seed: 7 });
    assert.deep(a, b, 'two bootstrap runs at one seed');
    assert.equal(a.point, spearman(pred, label), 'the point estimate is plain rho');
    assert.ok(a.samples > 150, 'most resamples are usable');
    assert.ok(a.lo! <= a.point! && a.point! <= a.hi!, 'the interval brackets its point');
  });

  test('topQuartileHit counts picks against the blind base rate', () => {
    const hit = topQuartileHit([4, 3, 2, 1], [4, 3, 2, 1]);
    assert.equal(hit.picks, 1);
    assert.equal(hit.hits, 1);
    assert.equal(hit.rate, 1);
    assert.equal(hit.base_rate, 0.25);

    const miss = topQuartileHit([4, 3, 2, 1], [1, 2, 3, 4]);
    assert.equal(miss.hits, 0, 'a reversed prediction catches nothing');
    assert.equal(miss.rate, 0);

    assert.equal(topQuartileHit([], []).rate, null, 'no picks means no rate');
  });

  test('the PRNG is seeded, in range, and the hash is a function', () => {
    const first = mulberry32(20_261_114);
    const again = mulberry32(20_261_114);
    const a = [first(), first(), first()];
    const b = [again(), again(), again()];
    assert.sameNumbers(a, b, 'one seed, one stream');
    assert.ok(a.every((x) => x >= 0 && x < 1), 'draws stay in [0, 1)');

    const other = mulberry32(20_261_115);
    assert.ok(other() !== a[0], 'a different seed starts elsewhere');

    assert.equal(fnv1a(''), 2_166_136_261, 'FNV-1a of the empty string is the offset basis');
    assert.equal(fnv1a('radar'), fnv1a('radar'), 'the hash is a function');
    assert.ok(fnv1a('radar') !== fnv1a('radars'), 'a different string hashes differently');
  });
});

// ---------------------------------------------------------------------------------------------
// Suite 2: rank aggregation
// ---------------------------------------------------------------------------------------------

suite('metrics: rank aggregation', () => {
  test('Borda: n - 1 to the top, 0 to the last, summed over voters', () => {
    // Two identical full rankings: a keeps 2 twice, b 1 twice, c 0 twice.
    assert.deep(
      Object.fromEntries(bordaCount([['a', 'b', 'c'], ['a', 'b', 'c']])),
      { a: 4, b: 2, c: 0 },
      'two identical full rankings',
    );
    // Two voters that disagree: each id earns the points of the position each voter gave it.
    assert.deep(
      Object.fromEntries(bordaCount([['a', 'b', 'c'], ['b', 'c', 'a']])),
      { a: 2, b: 3, c: 1 },
      'two voters that rank the same ids differently',
    );
    // A one-id ranking transfers nothing: the top of a one-id list is also its last.
    assert.deep(Object.fromEntries(bordaCount([['a']])), { a: 0 }, 'a one-id ranking transfers nothing');
  });

  test('Borda: a subset voter transfers fewer points', () => {
    // Voter 1 has 2 ids (a 1, b 0); voter 2 has 1 (c 0). b is absent from voter 2 and earns nothing.
    assert.deep(Object.fromEntries(bordaCount([['a', 'b'], ['c']])), { a: 1, b: 0, c: 0 });
    assert.deep(
      Object.fromEntries(bordaCount([['a', 'b', 'c'], ['a']])),
      { a: 2, b: 1, c: 0 },
      'a short ranking is worth less in total',
    );
    assert.equal(bordaCount([]).size, 0, 'no voters');
    assert.equal(bordaCount([[], []]).size, 0, 'empty rankings');
  });

  test('reciprocal rank decays as 1 / position', () => {
    const once = reciprocalRank([['a', 'b', 'c']]);
    assert.close(once.get('a')!, 1);
    assert.close(once.get('b')!, 0.5);
    assert.close(once.get('c')!, 1 / 3);

    const twice = reciprocalRank([['a', 'b'], ['a', 'c']]);
    assert.close(twice.get('a')!, 2);
    assert.close(twice.get('b')!, 0.5);
    assert.close(twice.get('c')!, 0.5);
  });

  test('orderByScore sorts high to low, ties by id', () => {
    const scores = new Map([
      ['c', 1],
      ['a', 1],
      ['b', 2],
    ]);
    assert.deep(orderByScore(scores), ['b', 'a', 'c']);
    assert.deep(orderByScore(bordaCount([['x'], ['y']])), ['x', 'y'], 'a tie falls back to id order');
  });

  test('kendallTau is +1, -1, tie-corrected, and null when undefined', () => {
    assert.close(kendallTau([1, 2, 3, 4], [1, 2, 3, 4])!, 1);
    assert.close(kendallTau([1, 2, 3, 4], [4, 3, 2, 1])!, -1);
    // One tied pair in the first series: tau-b = 2 / sqrt(3 * 2).
    assert.close(kendallTau([1, 1, 2], [1, 2, 3])!, Math.sqrt(2 / 3), 12, 'tau-b of a tied pair');
    assert.close(kendallTau([1, 1, 2], [1, 1, 2])!, 1, 9, 'a joint tie is skipped, not counted');

    assert.equal(kendallTau([1], [1]), null, 'a single pair');
    assert.equal(kendallTau([1, 1, 1], [1, 2, 3]), null, 'a constant first series');
    assert.equal(kendallTau([1, 2, 3], [5, 5, 5]), null, 'a constant second series');
    assert.equal(kendallTau([], []), null);
  });
});

// ---------------------------------------------------------------------------------------------
// Suite 3: per-category deciles
// ---------------------------------------------------------------------------------------------

suite('metrics: per-category deciles', () => {
  test('decileBreaks returns bins - 1 ascending cut points', () => {
    const breaks = decileBreaks([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 10);
    assert.equal(breaks.length, 9, 'ten bins have nine interior cuts');
    for (let i = 1; i < breaks.length; i++) assert.ok(breaks[i]! >= breaks[i - 1]!, 'cuts ascend');
    assert.equal(decileBreaks([1, 2, 3], 1).length, 0, 'one bin has no interior cut');
    assert.equal(decileBreaks([1, 2, 3], 0).length, 0, 'zero bins is refused');
  });

  test('every value lands in a bucket, so counts sum to count', () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => ({ category: 'A', value: i + 1 })),
      { category: 'B', value: 100 },
    ];
    const deciles = categoryDeciles(rows, 10);
    assert.deep([...deciles.keys()], ['A', 'B'], 'keys are sorted');
    for (const [key, d] of deciles) {
      assert.equal(d.counts.reduce((a, b) => a + b, 0), d.count, `${key}: buckets cover every value`);
      assert.equal(d.counts.length, 10, `${key}: ten buckets`);
      assert.equal(d.breaks.length, 9, `${key}: nine cuts`);
    }
    assert.equal(deciles.get('A')!.count, 10);
    assert.equal(deciles.get('A')!.sparse, true, 'ten values are still under two per bucket');
    assert.equal(deciles.get('B')!.count, 1);
  });

  test('a value equal to a cut stays in the lower bucket', () => {
    // Twelve identical values: every cut equals the value, so every row lands in bucket 0.
    const d = categoryDeciles(Array.from({ length: 12 }, () => ({ category: 'flat', value: 7 }))).get('flat')!;
    assert.equal(d.counts[0], 12, 'equal values all fall in the lowest bucket');
    assert.equal(d.counts.slice(1).reduce((a, b) => a + b, 0), 0);
  });

  test('a null category reads as Other, and categories never share values', () => {
    const deciles = categoryDeciles([
      { category: null, value: 5 },
      { category: 'Real', value: 500 },
    ]);
    assert.deep([...deciles.keys()], ['Other', 'Real']);
    assert.equal(deciles.get('Other')!.count, 1);
    assert.equal(deciles.get('Real')!.count, 1, 'each category is measured on its own values');
    assert.equal(categoryDeciles([]).size, 0, 'an empty input is an empty map');
  });
});

// ---------------------------------------------------------------------------------------------
// Suite 4: scoreComponents() on the sealed snapshot
// ---------------------------------------------------------------------------------------------

interface GoldenRow {
  slug: string;
  rank: number;
  implied: number;
  components: RowComponents;
}

type GoldenTable = Record<'top' | 'stale' | 'fallback' | 'last', GoldenRow>;

let cached: { snapshot: Snapshot; rows: ReturnType<typeof buildBoard>; golden: GoldenTable } | null = null;

/**
 * The snapshot, the board built from it, and the recorded goldens, computed once. The goldens were
 * recorded from this same snapshot by rule: the strongest row, the first row with a stale week, the
 * first row whose category has no live peer, and the weakest row.
 */
function fixture(): NonNullable<typeof cached> {
  if (cached !== null) return cached;
  if (!existsSync(SNAPSHOT_PATH)) fail(`no snapshot at ${SNAPSHOT_PATH}`);
  if (!existsSync(GOLDEN_PATH)) fail(`no golden table at ${GOLDEN_PATH}`);
  const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as Snapshot;
  const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as GoldenTable;
  cached = { snapshot, rows: buildBoard(snapshot, MODEL), golden };
  return cached;
}

suite('components: the pipeline on the sealed snapshot', () => {
  test('the four golden rows are the ones the model picks by rule', () => {
    const { rows, golden } = fixture();
    const board = rows.board;
    const picks = {
      top: board[0]!.slug,
      stale: board.find((r) => r.model.flow_stale === true)!.slug,
      fallback: board.find((r) => r.model.category_fallback === true)!.slug,
      last: board[board.length - 1]!.slug,
    };
    const expected = Object.fromEntries(
      (Object.keys(golden) as Array<keyof GoldenTable>).map((k) => [k, golden[k].slug]),
    );
    assert.deep(picks, expected, 'which rows the goldens describe');
  });

  test('scoreComponents reproduces every recorded component', () => {
    const { snapshot, golden } = fixture();
    const universe = loadProtocols(snapshot);
    const baseline = comparablesBaseline(universe, MODEL);
    const flow = flowAdjust(universe, baseline, MODEL);
    for (const key of Object.keys(golden) as Array<keyof GoldenTable>) {
      const g = golden[key];
      const protocol = universe.index.get(g.slug);
      assert.ok(protocol !== undefined, `snapshot holds ${g.slug}`);
      const components = scoreComponents(protocol!, snapshot.as_of, baseline, flow, MODEL);
      assert.deep(components, g.components, `${key} (${g.slug}) components`);
      assert.equal(components.implied_usd, g.implied, `${key} implied value`);
    }
  });

  test('the board and scoreComponents agree on every row', () => {
    const { snapshot, rows } = fixture();
    const universe = loadProtocols(snapshot);
    const baseline = comparablesBaseline(universe, MODEL);
    const flow = flowAdjust(universe, baseline, MODEL);
    for (const row of rows.board) {
      const protocol = universe.index.get(row.slug)!;
      const components = scoreComponents(protocol, snapshot.as_of, baseline, flow, MODEL);
      assert.equal(components.implied_usd, row.implied_value_usd, `implied value of ${row.slug}`);
    }
  });

  test('every component stays inside the model bounds', () => {
    const { snapshot, rows } = fixture();
    const universe = loadProtocols(snapshot);
    const baseline = comparablesBaseline(universe, MODEL);
    const flow = flowAdjust(universe, baseline, MODEL);
    for (const row of rows.board) {
      const c = scoreComponents(universe.index.get(row.slug)!, snapshot.as_of, baseline, flow, MODEL);
      assert.ok(c.base_usd > 0, `${row.slug}: base is positive`);
      assert.ok(c.beta >= MODEL.beta_floor && c.beta <= MODEL.beta_cap, `${row.slug}: beta is clamped`);
      assert.ok(c.growth.multiplier >= 0.85 && c.growth.multiplier <= 1.3, `${row.slug}: growth is bounded`);
      assert.ok(c.flow.outlier_penalty >= MODEL.flow_penalty_floor && c.flow.outlier_penalty <= MODEL.flow_penalty_cap, `${row.slug}: penalty is bounded`);
      assert.ok(c.velocity.multiplier >= 1 && c.velocity.multiplier <= 1 + MODEL.velocity_cap * MODEL.velocity_weight, `${row.slug}: velocity is one-sided`);
      assert.ok(c.maturity_multiplier >= MODEL.maturity_floor && c.maturity_multiplier <= MODEL.maturity_floor + MODEL.maturity_range, `${row.slug}: maturity is bounded`);
      if (c.flow.stale) {
        assert.equal(c.velocity.z, null, `${row.slug}: a stale week earns no velocity`);
        assert.equal(c.velocity.multiplier, 1, `${row.slug}: a stale week is left at 1`);
      }
    }
  });

  test('the implied value is the product of the stored terms', () => {
    const { snapshot, rows } = fixture();
    const universe = loadProtocols(snapshot);
    const baseline = comparablesBaseline(universe, MODEL);
    const flow = flowAdjust(universe, baseline, MODEL);
    for (const row of rows.board.slice(0, 40)) {
      const c = scoreComponents(universe.index.get(row.slug)!, snapshot.as_of, baseline, flow, MODEL);
      const product = Math.max(
        1,
        Math.round(
          c.base_usd * c.growth.multiplier * c.flow.outlier_penalty *
            c.velocity.multiplier * c.concentration.multiplier * c.maturity_multiplier,
        ),
      );
      assert.equal(product, c.implied_usd, `${row.slug}: the product recomputes its implied value`);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Suite 5: the entrypoint, end to end
// ---------------------------------------------------------------------------------------------

/** One `node main.ts --board` run into `out`; returns what it printed and its exit code. */
function runBoard(out: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [join(ROOT, 'main.ts'), '--board', '--output', out], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** The documented per-row component fields the gate reads. */
const REQUIRED_MODEL_KEYS = [
  'base_value_usd', 'growth_multiplier', 'outlier_penalty', 'velocity_multiplier',
  'concentration_multiplier', 'maturity_multiplier', 'category_anchor_tvl', 'category_fallback',
  'flow_stale', 'chain_count',
];

suite('smoke: main.ts --board', () => {
  test('writes a valid board, backtest and page, and repeats its bytes', () => {
    const a = mkdtempSync(join(tmpdir(), 'radar-a-'));
    const b = mkdtempSync(join(tmpdir(), 'radar-b-'));
    try {
      const first = runBoard(a);
      assert.equal(first.status, 0, `exit code (stderr: ${first.stderr.trim().slice(0, 400)})`);

      const board = JSON.parse(readFileSync(join(a, 'board.json'), 'utf8'));
      assert.equal(board.schema, 'makefun/token-radar/board/v1', 'board schema');
      // The exact version, which also covers the looser "the board names some model" check.
      assert.equal(board.model, MODEL_VERSION, 'board names the model version');
      assert.ok(Array.isArray(board.rows) && board.rows.length >= 100, `board has ${board.rows?.length} rows`);

      for (let i = 0; i < board.rows.length; i++) {
        const row = board.rows[i];
        assert.equal(row.rank, i + 1, `row ${i} has a contiguous rank`);
        assert.ok(row.implied_value_usd >= 1 && row.implied_value_usd <= 1e14, `${row.slug}: implied value is in range`);
        assert.ok(row.farm_steps.length >= 3 && row.farm_steps.length <= 12, `${row.slug}: 3-12 farm steps`);
        for (const step of row.farm_steps) {
          assert.ok(step.length >= 20 && step.length <= 600, `${row.slug}: a step is 20-600 chars`);
        }
        for (const key of REQUIRED_MODEL_KEYS) {
          assert.ok(row.model && key in row.model, `${row.slug}: model carries ${key}`);
        }
      }

      const backtest = JSON.parse(readFileSync(join(a, 'backtest.json'), 'utf8'));
      assert.equal(backtest.schema, 'makefun/token-radar/backtest/v1', 'backtest schema');
      assert.ok(Array.isArray(backtest.warnings), 'backtest carries warnings');

      const data = readFileSync(join(a, 'data.js'), 'utf8');
      assert.ok(data.includes('window.RADAR='), 'data.js defines window.RADAR');
      assert.ok(data.includes('window.BACKTEST='), 'data.js defines window.BACKTEST');

      const dossier = JSON.parse(readFileSync(join(a, 'dossier.json'), 'utf8'));
      assert.equal(dossier.schema, 'makefun/dossier/v1', 'dossier schema');
      assert.ok(Buffer.byteLength(dossier.text) <= 65_536, 'dossier text fits its cap');
      assert.ok(!dossier.text.includes('[Cut at'), 'dossier text is not truncated');
      assert.ok(dossier.images.length >= 3, 'dossier carries at least three screenshots');

      const second = runBoard(b);
      assert.equal(second.status, 0, 'the second run succeeds');
      for (const name of ['board.json', 'data.js', 'backtest.json', 'dossier.json']) {
        assert.equal(
          readFileSync(join(a, name), 'utf8'),
          readFileSync(join(b, name), 'utf8'),
          `${name} is byte-identical across runs`,
        );
      }
    } finally {
      rmSync(a, { recursive: true, force: true });
      rmSync(b, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

async function main(argv: readonly string[]): Promise<void> {
  let listOnly = false;
  const filters: string[] = [];

  for (const arg of argv) {
    if (arg === '--list') listOnly = true;
    else if (arg === '-h' || arg === '--help') {
      process.stdout.write(USAGE);
      return;
    } else if (arg.startsWith('-')) {
      process.stderr.write(`token radar tests: unknown option ${arg}\n\n${USAGE}`);
      process.exit(2);
    } else filters.push(arg);
  }

  const chosen = suites.filter((s) => filters.length === 0 || filters.some((f) => s.name.includes(f)));
  if (chosen.length === 0) {
    process.stderr.write(`token radar tests: no suite matches ${filters.join(', ')}\n`);
    process.exit(2);
  }

  if (listOnly) {
    for (const s of chosen) {
      process.stdout.write(`${s.name}\n`);
      for (const c of s.cases) process.stdout.write(`  ${c.name}\n`);
    }
    return;
  }

  let passed = 0;
  const failures: string[] = [];
  for (const s of chosen) {
    for (const c of s.cases) {
      const started = Date.now();
      try {
        await c.body();
        passed += 1;
        process.stdout.write(`ok   ${s.name} > ${c.name} (${Date.now() - started}ms)\n`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failures.push(`${s.name} > ${c.name}: ${message}`);
        process.stdout.write(`FAIL ${s.name} > ${c.name}\n     ${message}\n`);
      }
    }
  }

  const total = passed + failures.length;
  process.stdout.write(`\n${passed}/${total} tests passed across ${chosen.length} suites\n`);
  if (failures.length > 0) {
    process.stdout.write(`\nfailures:\n${failures.map((f) => `  - ${f}`).join('\n')}\n`);
    process.exit(1);
  }
}

await main(process.argv.slice(2));
