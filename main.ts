// token-radar-01: build the radar (Node 22, standard library only, runs as-is).
//
// `node main.ts` reads the sealed snapshot (--input, else /input/snapshot.json, else ./input/snapshot.json),
// scores every pre-token protocol with lib/model.ts, and writes:
//
//   board.json    the ranked board: the whole watchlist, the early finds, a farm plan each
//   data.js       the dashboard's dataset, beside the page (window.RADAR)
//   dashboard/    this repository's static page, copied whole
//   screenshots/  the three hand-taken views, copied whole
//   dossier.json  buildDossier() of that output, from vendor/makefun-board.ts
//
// The output goes to --output, else $MAKEFUN_OUTPUT_DIR, else /output when it exists, else ./out, so the
// same file runs bare in this repository. Two runs write identical bytes: no clock, no randomness, no network.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot, type Snapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the dossier's bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** `--name value` or `--name=value`, else the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

/** The snapshot this run reads: --input, else the grader's /input, else this repository's input/. */
function snapshotPath(): string {
  const named = arg('input', '');
  if (named !== '') return named.endsWith('.json') ? named : join(named, 'snapshot.json');
  if (existsSync('/input/snapshot.json')) return '/input/snapshot.json';
  return join(here, 'input', 'snapshot.json');
}

/** Where this run writes: --output, else $MAKEFUN_OUTPUT_DIR, else /output, else ./out. */
function outputPath(): string {
  const named = arg('output', '');
  if (named !== '') return named;
  const env = process.env.MAKEFUN_OUTPUT_DIR;
  if (env !== undefined && env !== '') return env;
  return existsSync('/output') ? '/output' : join(here, 'out');
}

const inputFile = snapshotPath();
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory>\n`);
  process.exit(2);
}

const out = outputPath();
const snapshot: Snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);

const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });

/** Replace `to` with the plain regular files of `from`; return the names copied. */
function copyDir(from: string, to: string): string[] {
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
writeFileSync(join(out, 'data.js'), dataScript(radar));

copyDir(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyDir(join(here, 'screenshots'), join(out, 'screenshots'));

// The dossier is written last: the scorer rebuilds it from this output and compares bytes.
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image(s): the dossier needs 3 (board, detail, filtered)\n`);
} else {
  writeFileSync(
    join(out, 'dossier.json'),
    buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: DASHBOARD_CAPS }),
  );
}

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ` +
    `${board.length} rows scored (${radar.early_size} below the floor, ${radar.off_list_size} off-list, ` +
    `${radar.live_size} live set aside)\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')}, ` +
    `${join(out, 'screenshots')} (${shots.length} images)${shots.length >= 3 ? ` and ${join(out, 'dossier.json')}` : ''}\n`,
);
