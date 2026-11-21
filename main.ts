// token-radar-01: build the radar (Node 22, standard library only, runs as-is).
//
// One entrypoint, two modes:
//
//   node main.ts                  score the snapshot and write the board, the page's data, the
//                                 page, the screenshots and the dossier into the output directory
//   BACKTEST=1 node main.ts       run the out-of-sample harness and write backtest.json alone, so
//                                 the validation path can never overwrite or be mistaken for the
//                                 board
//
// Input: --input <file|dir>, else the grader's /input/snapshot.json, else this repository's
// input/snapshot.json. Output: --output, else $MAKEFUN_OUTPUT_DIR, else /output when it exists,
// else ./out.
//
// Board mode writes:
//
//   board.json    the ranked board, every row with its components and its farm plan
//   data.js       window.RADAR and window.BACKTEST, the page's whole dataset in one static file
//   backtest.json the same validation report on its own, for inspection
//   dashboard/    the static page, copied whole
//   screenshots/  the captured views, copied whole
//   dossier.json  buildDossier() of the output, from vendor/makefun-board.ts
//
// Both modes are deterministic: no clock, no randomness, no network, so two runs write the same
// bytes.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot, type Snapshot } from './lib/model.ts';
import { runBacktest } from './lib/backtest.ts';
import { buildDossier } from './vendor/makefun-board.ts';

/** This repository: the root every relative path below hangs from. */
const HERE = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's caps (reference/gate.json): the text cap shapes the dossier, the rest only refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };

/** A file name the dossier and the copy step both accept. */
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** `--name value` or `--name=value`, else the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

/** The snapshot this run reads: --input, else the grader's /input, else this repository's input/. */
function snapshotFile(): string {
  const named = arg('input', '');
  if (named !== '') return named.endsWith('.json') ? named : join(named, 'snapshot.json');
  if (existsSync('/input/snapshot.json')) return '/input/snapshot.json';
  return join(HERE, 'input', 'snapshot.json');
}

/** Where this run writes: --output, else $MAKEFUN_OUTPUT_DIR, else /output, else ./out. */
function outputDir(): string {
  const named = arg('output', '');
  if (named !== '') return named;
  const env = process.env.MAKEFUN_OUTPUT_DIR;
  if (env !== undefined && env !== '') return env;
  return existsSync('/output') ? '/output' : join(HERE, 'out');
}

/** Three decimals for a correlation, which is read to the nearest thousandth at most. */
function fixed3(n: number | null): string {
  return n === null ? 'n/a' : n.toFixed(3);
}

/**
 * Replace `to` with the plain regular files of `from`, in name order; return the names copied. A
 * missing source directory copies nothing, which is how the screenshot count below notices.
 */
function copyPlainFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  rmSync(to, { recursive: true, force: true });
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.') || !PLAIN_NAME.test(name)) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

/** BACKTEST=1: the out-of-sample report, and nothing else. */
function writeBacktest(out: string, snapshot: Snapshot): void {
  const report = runBacktest(snapshot);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'backtest.json'), `${JSON.stringify(report, null, 2)}\n`);
  const ic = report.leak_free.rank_ic;
  process.stdout.write(
    `token radar backtest: ${report.split.scored_rows} held-out rows from ` +
      `${report.split.scored_categories} categories, rank IC ${fixed3(ic.point)} ` +
      `[${fixed3(ic.lo)}, ${fixed3(ic.hi)}] leak-free over ${report.repeated_splits.splits} splits\n` +
      `token radar backtest: wrote ${join(out, 'backtest.json')}\n`,
  );
  for (const warning of report.warnings) process.stderr.write(`token radar backtest: ${warning}\n`);
}

/** The default mode: the board, the page's data, the page, the screenshots and the dossier. */
function writeBoard(out: string, snapshot: Snapshot): void {
  const { board, radar } = buildRadar(snapshot);

  // The gate reads the board's ranks, coverage, implied values and farm steps; a refusal here is
  // cheaper than writing a board the scorer will reject.
  const issue = boardIssue(board, snapshot);
  if (issue !== null) {
    process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
    process.exit(1);
  }

  mkdirSync(out, { recursive: true });

  writeFileSync(
    join(out, 'board.json'),
    `${JSON.stringify({
      schema: 'makefun/token-radar/board/v1',
      as_of: snapshot.as_of,
      source: snapshot.source,
      floor_usd: snapshot.floor_usd,
      model: radar.model_version,
      watchlist_size: radar.watchlist_size,
      rows: board,
    })}\n`,
  );

  // The validation report goes on disk for inspection and into data.js for the page: the shipped
  // page stays one static, offline bundle with no second request to fail.
  const backtest = runBacktest(snapshot);
  writeFileSync(join(out, 'backtest.json'), `${JSON.stringify(backtest, null, 2)}\n`);
  writeFileSync(
    join(out, 'data.js'),
    `${dataScript(radar)}window.BACKTEST=${JSON.stringify(backtest)};\n`,
  );

  copyPlainFiles(join(HERE, 'dashboard'), join(out, 'dashboard'));
  const shots = copyPlainFiles(join(HERE, 'screenshots'), join(out, 'screenshots'));

  // The dossier is written last: the scorer rebuilds it from this directory and compares bytes.
  if (shots.length < 3) {
    process.stderr.write(
      `token radar: screenshots/ holds ${shots.length} image(s): the dossier needs at least 3 ` +
        '(board, detail, filtered)\n',
    );
  } else {
    writeFileSync(
      join(out, 'dossier.json'),
      buildDossier(out, {
        text_max_bytes: TEXT_MAX_BYTES,
        screenshots: SCREENSHOT_CAPS,
        dashboard: DASHBOARD_CAPS,
      }),
    );
  }

  process.stdout.write(
    `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the ` +
      `watchlist, ${board.length} rows scored (${radar.early_size} below the floor, ` +
      `${radar.off_list_size} off-list, ${radar.live_size} live set aside)\n` +
      `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ` +
      `${join(out, 'dashboard')}, ${join(out, 'screenshots')} (${shots.length} images)` +
      `${shots.length >= 3 ? ` and ${join(out, 'dossier.json')}` : ''}\n`,
  );
}

const input = snapshotFile();
if (!existsSync(input)) {
  process.stderr.write(
    `token radar: no snapshot at ${input}: pass --input <snapshot.json|directory>\n`,
  );
  process.exit(2);
}

const snapshot = parseSnapshot(readFileSync(input, 'utf8'));
const out = outputDir();

if (process.env.BACKTEST === '1') {
  writeBacktest(out, snapshot);
} else {
  writeBoard(out, snapshot);
}
