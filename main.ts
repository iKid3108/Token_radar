// token-radar-01: build the radar (Node 22, standard library only, runs as-is).
//
// One entrypoint, three modes:
//
//   node main.ts              (alias: --board) score the snapshot and write the board, the page's
//                             data, the page, the screenshots and the dossier into the output dir
//   node main.ts --backtest   run the out-of-sample harness and write backtest.json alone, so the
//                             validation path can never overwrite or be mistaken for the board;
//                             BACKTEST=1 node main.ts is the older spelling and still works
//   node main.ts --report     render docs/REPORT.md from the board and backtest already written.
//                             The report fits nothing: it reads two documents and joins them.
//
// Input: --input <file|dir>, else the grader's /input/snapshot.json, else this repository's
// input/snapshot.json. Output: --output, else $MAKEFUN_OUTPUT_DIR, else /output when it exists,
// else ./out. The report reads from that same directory and writes to --report-out, else
// docs/REPORT.md beside this file.
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
// Every mode is deterministic: no clock, no randomness, no network, so two runs write the same
// bytes, and the report is a pure function of the two documents it reads.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot, type Snapshot } from './lib/model.ts';
import { runBacktest, type BacktestResult } from './lib/backtest.ts';
import { renderReport, type BoardDocument } from './lib/report.ts';
import { buildDossier } from './vendor/makefun-board.ts';

/** This repository: the root every relative path below hangs from. */
const HERE = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's caps (reference/gate.json): the text cap shapes the dossier, the rest only refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };

/** A file name the dossier and the copy step both accept. */
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

const USAGE = `token radar — a ranked board of pre-token protocols from a sealed snapshot

Usage:
  node main.ts [--board]     write board.json, data.js, backtest.json, dashboard/, screenshots/
                             and dossier.json into the output directory
  node main.ts --backtest    write backtest.json alone (older spelling: BACKTEST=1 node main.ts)
  node main.ts --report      render docs/REPORT.md from the documents already in the output dir

Options:
  --input <path>       a snapshot JSON file, or a directory holding snapshot.json
  --output <dir>       where the board mode writes, and where --report reads from
                       (default: $MAKEFUN_OUTPUT_DIR, else /output, else ./out)
  --report-out <path>  where --report writes (default: docs/REPORT.md beside this file)
  -h, --help           this text

Flags are strict: an unknown option, a repeated option, an option with no value, an option the
chosen mode would ignore, and two different modes in one run each stop the run with exit 2 rather
than being quietly dropped. Every output file is written through a temporary and renamed into
place, so a failed run never leaves a half-written board.json or data.js behind.

Exit codes: 0 success, 1 the model's own gate refused the board, 2 a bad flag or a missing,
unreadable or malformed input document.
`;

/**
 * A failure worth one clean line rather than a stack trace: a bad flag, a path that is not there,
 * a document that is not the shape it claims to be. Bugs do not use this and keep their stack.
 */
class RadarError extends Error {}

/** A flag or argument problem: printed under the usage block. */
class UsageError extends RadarError {}

/** The three things this entrypoint can do. */
type Mode = 'board' | 'backtest' | 'report';

/** Everything the command line said, once parsed. `null` means "not given: use the default". */
interface Cli {
  mode: Mode;
  input: string | null;
  output: string | null;
  reportPath: string | null;
  help: boolean;
}

/** The options that take a value, each naming the Cli field it fills. */
const VALUE_FLAGS: Record<string, 'input' | 'output' | 'reportPath'> = {
  '--input': 'input',
  '--output': 'output',
  '--report-out': 'reportPath',
};

/**
 * Parse argv (already without `node` and the script path). Accepts `--name value` and
 * `--name=value`, rejects an unknown option, a missing value, a flag given twice and two
 * different modes at once — silence about a mistyped flag is how a run writes the wrong file.
 * `BACKTEST=1` selects --backtest when no mode flag is given, so the old invocation still works.
 */
function parseArgs(argv: readonly string[]): Cli {
  let mode: Mode | null = null;
  let help = false;
  const values = new Map<'input' | 'output' | 'reportPath', string>();

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;

    if (token === '-h' || token === '--help') {
      help = true;
      continue;
    }
    if (!token.startsWith('--')) {
      throw new UsageError(`unexpected argument: ${token}`);
    }

    // `--name=value` splits at the first `=`, but only past the two leading dashes.
    const equals = token.indexOf('=');
    const name = equals > 2 ? token.slice(0, equals) : token;
    const inline = equals > 2 ? token.slice(equals + 1) : null;

    if (name === '--board' || name === '--backtest' || name === '--report') {
      if (inline !== null) throw new UsageError(`${name} takes no value`);
      const chosen = name.slice(2) as Mode;
      if (mode === chosen) throw new UsageError(`${name} given twice`);
      if (mode !== null) {
        throw new UsageError(`--${mode} and ${name} are two different modes: pass one`);
      }
      mode = chosen;
      continue;
    }

    const field = VALUE_FLAGS[name];
    if (field === undefined) throw new UsageError(`unknown option: ${token}`);

    let value = inline;
    if (value === null) {
      const next = argv[i + 1];
      // A following flag is a missing value, not a path that happens to start with dashes.
      if (next === undefined || next.startsWith('--')) {
        throw new UsageError(`${name} needs a value`);
      }
      value = next;
      i += 1;
    }
    if (value === '') throw new UsageError(`${name} needs a value`);
    if (values.has(field)) throw new UsageError(`${name} given twice`);
    values.set(field, value);
  }

  if (help) {
    return { mode: mode ?? 'board', input: null, output: null, reportPath: null, help: true };
  }

  const resolved: Mode = mode ?? (process.env.BACKTEST === '1' ? 'backtest' : 'board');
  return {
    mode: resolved,
    input: values.get('input') ?? null,
    output: values.get('output') ?? null,
    reportPath: values.get('reportPath') ?? null,
    help: false,
  };
}

/** The one-line text of a caught value, whether or not it was an Error. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Read a file, turning a permission or existence failure into a message that names the path. */
function readText(path: string, what: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    throw new RadarError(`cannot read the ${what} at ${path}: ${messageOf(error)}`);
  }
}

/** Parse a JSON document, naming the path in the failure rather than printing a character offset. */
function readJson(path: string, what: string): unknown {
  const text = readText(path, what);
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new RadarError(`the ${what} at ${path} is not valid JSON: ${messageOf(error)}`);
  }
}

/**
 * Write a file so that no reader ever sees half of one: the bytes go to a sibling temporary first
 * and are then renamed over the target, and a rename within a directory is atomic, so the target
 * is either the old file or the new one and never a partial write. A failed write removes its own
 * temporary and leaves the previous file intact. The temporary's name carries the pid, so two
 * concurrent runs cannot collide, and it never survives a successful run.
 */
function writeText(path: string, text: string): void {
  const temp = `${path}.tmp-${process.pid}`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(temp, text);
    renameSync(temp, path);
  } catch (error) {
    // The cleanup can fail for the same reason the write did (a parent that is not a directory),
    // and a throw here would replace the real message with its own: the failure below is the one
    // worth reporting, so the removal's outcome is deliberately discarded.
    try {
      rmSync(temp, { force: true });
    } catch {
      /* nothing to clean up, or nothing cleanable */
    }
    throw new RadarError(`cannot write ${path}: ${messageOf(error)}`);
  }
}

/**
 * The paths the snapshot search considers, in order. `--input` names either a JSON file or a
 * directory that holds one, so both spellings resolve to the same candidate.
 */
function snapshotCandidates(named: string | null): string[] {
  if (named !== null) return [named.endsWith('.json') ? named : join(named, 'snapshot.json')];
  return ['/input/snapshot.json', join(HERE, 'input', 'snapshot.json')];
}

/**
 * The snapshot to score, plus the paths that were considered. Every candidate is reported when
 * none exists, because "no snapshot at <last candidate>" hides the grader path that was skipped.
 */
function requireSnapshot(named: string | null): { snapshot: Snapshot; path: string } {
  const tried = snapshotCandidates(named);
  const path = tried.find((candidate) => existsSync(candidate));
  if (path === undefined) {
    throw new RadarError(
      `no snapshot found. Tried:\n${tried.map((candidate) => `  ${candidate}`).join('\n')}\n` +
        'Pass --input <snapshot.json|directory>.',
    );
  }
  try {
    return { snapshot: parseSnapshot(readText(path, 'snapshot')), path };
  } catch (error) {
    if (error instanceof RadarError) throw error;
    throw new RadarError(`the snapshot at ${path} is unusable: ${messageOf(error)}`);
  }
}

/**
 * A board document, or a message saying what the file actually is. The check is deliberately
 * shallow — `model` and a rows array — because renderReport reads the fields it needs and a
 * deeper schema would duplicate the model's own types.
 */
function boardFrom(value: unknown, path: string): BoardDocument {
  const doc = value as Partial<BoardDocument> | null;
  if (
    doc === null ||
    typeof doc !== 'object' ||
    !Array.isArray(doc.rows) ||
    typeof doc.model !== 'string'
  ) {
    throw new RadarError(`the file at ${path} is not a board document (expected model and rows)`);
  }
  return doc as BoardDocument;
}

/** A backtest report, or a message naming the shape it was expected to have. */
function backtestFrom(value: unknown, path: string): BacktestResult {
  const doc = value as Partial<BacktestResult> | null;
  if (
    doc === null ||
    typeof doc !== 'object' ||
    typeof doc.schema !== 'string' ||
    doc.leak_free === undefined ||
    !Array.isArray(doc.warnings)
  ) {
    throw new RadarError(
      `the file at ${path} is not a backtest report (expected schema, leak_free and warnings)`,
    );
  }
  return doc as BacktestResult;
}

/** Where this run writes: --output, else $MAKEFUN_OUTPUT_DIR, else /output, else ./out. */
function outputDir(named: string | null): string {
  if (named !== null) return named;
  const env = process.env.MAKEFUN_OUTPUT_DIR;
  if (env !== undefined && env !== '') return env;
  return existsSync('/output') ? '/output' : join(HERE, 'out');
}

/**
 * Where --report looks for its documents: --output, else $MAKEFUN_OUTPUT_DIR, else ./out. It
 * deliberately stops short of /output: the report is a repository tool, and the grader's staging
 * directory is not a place anyone expects a board to be waiting.
 */
function reportSourceDir(named: string | null): string {
  if (named !== null) return named;
  const env = process.env.MAKEFUN_OUTPUT_DIR;
  if (env !== undefined && env !== '') return env;
  return join(HERE, 'out');
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

/** --backtest: the out-of-sample report, and nothing else. */
function writeBacktest(out: string, snapshot: Snapshot): void {
  const report = runBacktest(snapshot);
  writeText(join(out, 'backtest.json'), `${JSON.stringify(report, null, 2)}\n`);
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

  writeText(
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
  writeText(join(out, 'backtest.json'), `${JSON.stringify(backtest, null, 2)}\n`);
  writeText(
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
    writeText(
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

/**
 * --report: read the board and, when present, the backtest report out of `out`, then render the
 * Markdown to `target`. A missing board is an error with the command that would create it; a
 * missing backtest is not — the report has a section that says so. A backtest that exists but
 * does not parse is an error, because rendering without it would quietly hide a broken run.
 */
function writeReport(out: string, target: string): void {
  const boardPath = join(out, 'board.json');
  if (!existsSync(boardPath)) {
    throw new RadarError(
      `no board at ${boardPath}: run \`node main.ts\` first, or point --output at a run that wrote one`,
    );
  }
  const board = boardFrom(readJson(boardPath, 'board'), boardPath);

  const backtestPath = join(out, 'backtest.json');
  const backtest =
    existsSync(backtestPath) ? backtestFrom(readJson(backtestPath, 'backtest report'), backtestPath) : null;

  const markdown = renderReport(board, backtest);
  writeText(target, markdown);

  process.stdout.write(
    `token radar report: ${board.rows.length} rows, ` +
      (backtest === null
        ? 'no backtest report beside them'
        : `rank IC ${fixed3(backtest.leak_free.rank_ic.point)} leak-free`) +
      `\n` +
      `token radar report: wrote ${target} (${Buffer.byteLength(markdown)} bytes)\n`,
  );
}

/** Dispatch, then let the two expected failure classes print one line and exit 2. */
function main(argv: readonly string[]): void {
  const cli = parseArgs(argv);

  if (cli.help) {
    process.stdout.write(USAGE);
    return;
  }

  // A flag that this mode would ignore is a typo or a stale script: say so instead of writing.
  if (cli.mode === 'report' && cli.input !== null) {
    throw new UsageError(
      '--input has no meaning with --report: it reads the board and backtest in --output',
    );
  }
  if (cli.mode !== 'report' && cli.reportPath !== null) {
    throw new UsageError('--report-out only applies to --report');
  }
  // A report path that names an existing directory would only fail later, inside the write.
  if (cli.reportPath !== null && existsSync(cli.reportPath) && statSync(cli.reportPath).isDirectory()) {
    throw new UsageError(`--report-out ${cli.reportPath} is a directory: name the file to write`);
  }

  // The report only reads documents, so it never touches the snapshot.
  if (cli.mode === 'report') {
    writeReport(reportSourceDir(cli.output), cli.reportPath ?? join(HERE, 'docs', 'REPORT.md'));
    return;
  }

  const { snapshot } = requireSnapshot(cli.input);
  const out = outputDir(cli.output);
  if (cli.mode === 'backtest') writeBacktest(out, snapshot);
  else writeBoard(out, snapshot);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`token radar: ${error.message}\n\n${USAGE}`);
    process.exit(2);
  }
  if (error instanceof RadarError) {
    process.stderr.write(`token radar: ${error.message}\n`);
    process.exit(2);
  }
  throw error;
}
