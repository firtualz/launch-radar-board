// Token radar, round 1: the model, the board and the dossier. No dashboard yet (round 2).
//
// The program reads the sealed snapshot from /input/snapshot.json (or --input <file|dir>), scores
// every clean pre-token protocol with the model in lib/model.ts, writes the ranked board to
// /output/board.json and the dashboard data to /output/data.js, copies this repository's
// screenshots/ to /output, and writes /output/dossier.json with the vendored make.fun library.
//
// The screenshots are real renders of this board, taken in a browser (round 2): the board sorted
// by ROI with the validation panel, one protocol's detail view, and the audit view. The dashboard/
// directory holds the static page the screenshots show.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildBoard, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps (reference/gate.json): the text cap shapes the bytes, the rest refuse. */
const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildBoard(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) {
  process.stderr.write(`token radar: the model wrote a board the gate refuses: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(out, 'data.js'), dataScript(radar));

/** K6: the dashboard data must be the board, re-read from disk: same rows, same slugs, same
 *  ranks, same implied values. The board is the single source; data.js only compacts it. */
function checkConsistency(outDir: string): void {
  const onDisk = JSON.parse(readFileSync(join(outDir, 'board.json'), 'utf8')) as { rows: { slug: string; rank: number; implied_value_usd: number; farm_steps: string[] }[] };
  const dataText = readFileSync(join(outDir, 'data.js'), 'utf8');
  const data = JSON.parse(dataText.replace(/^window\.RADAR=/, '').replace(/;\s*$/, '')) as { rows: { slug: string; rank: number; implied_value_usd: number }[] };
  if (onDisk.rows.length !== data.rows.length) {
    process.stderr.write(`token radar: consistency: board.json has ${onDisk.rows.length} rows, data.js has ${data.rows.length}\n`);
    process.exit(1);
  }
  for (let i = 0; i < onDisk.rows.length; i++) {
    const b = onDisk.rows[i]!;
    const d = data.rows[i]!;
    if (b.slug !== d.slug || b.rank !== d.rank || b.implied_value_usd !== d.implied_value_usd) {
      process.stderr.write(`token radar: consistency: row ${i + 1} differs between board.json and data.js\n`);
      process.exit(1);
    }
    if (b.farm_steps.length < 3 || b.farm_steps.length > 12) {
      process.stderr.write(`token radar: consistency: ${b.slug} has ${b.farm_steps.length} farm steps on disk\n`);
      process.exit(1);
    }
  }
  process.stdout.write(`token radar: consistency: data.js matches board.json on ${onDisk.rows.length} rows (slug, rank, implied value)\n`);
}
checkConsistency(out);

/** Copy one directory's regular files into `to`, skipping names that start with a dot. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`token radar: screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) {
    process.stderr.write(`token radar: screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters\n`);
    process.exit(1);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: SCREENSHOT_CAPS, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored\n` +
    `token radar: fit n=${radar.fit.comps_after} (of ${radar.fit.comps_before} with a value), intercept=${radar.fit.intercept.toFixed(4)}, slope=${radar.fit.slope.toFixed(4)}, R2=${radar.fit.r2.toFixed(4)}\n` +
    `token radar: LOO median APE=${(radar.fit.loo_median_ape * 100).toFixed(2)}%, p25=${(radar.fit.loo_p25_ape * 100).toFixed(2)}%, p75=${(radar.fit.loo_p75_ape * 100).toFixed(2)}%, median fold=${radar.fit.median_fold_error.toFixed(2)}x\n` +
    `token radar: clean pre-token=${radar.clean_size}, watchlist on board=${radar.watchlist_size}, fallback=${radar.fit.fallback}\n` +
    `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')}, ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}\n`,
);
