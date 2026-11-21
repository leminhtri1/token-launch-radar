// Token launch radar (Node 22, standard library only, no network).
//
// Reads the sealed snapshot (/input/snapshot.json, or --input <file|dir>), runs the value model in
// lib/model.ts, and writes into the output directory (/output, or MAKEFUN_OUTPUT_DIR, or --output):
//   board.json    { rows: [...], model, calibration, excluded }  the ranked board the gate reads
//   data.js       window.RADAR = {...}                          everything the page renders
//   dashboard/    copied from this repository
//   screenshots/  copied from this repository
//   dossier.json  buildDossier(out, {text_max_bytes: 65536})    written last, from the files above
// Output is a pure function of the snapshot bytes: no clock, no randomness, sorted keys where order
// could vary, so two runs write identical bytes.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../kit/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FAMILIES, GAS, K, MODEL_VERSION, boardIssue, buildRadar, parseSnapshot, stepStrings } from './lib/model.ts';
import type { Row } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const TEXT_MAX_BYTES = 65_536;
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}
function fail(msg: string, code = 1): never {
  process.stderr.write(`token radar: ${msg}\n`);
  process.exit(code);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) fail(`no snapshot at ${inputFile}: pass --input <snapshot.json|dir>`, 2);
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const radar = buildRadar(snapshot);

// ---------------------------------------------------------------- board.json

const boardRow = (r: Row) => ({
  rank: r.rank,
  slug: r.slug,
  name: r.name,
  implied_value_usd: r.implied_value_usd,
  implied_low_usd: r.implied_low_usd,
  implied_high_usd: r.implied_high_usd,
  token_status: r.lane === 'related' ? 'pre-token (related token trades)' : 'pre-token (records no token)',
  lane: r.lane,
  watchlist: r.watchlist,
  related_token: r.related_token,
  category: r.category,
  family: r.family,
  chains: r.chains,
  tvl_usd: r.tvl_usd,
  change_7d: r.change_7d,
  listed_at: r.listed_at,
  tokenless_days: r.age_days,
  score: r.score,
  model: r.factors,
  farm: { chain: r.plan.chain, capital_usd: r.plan.capital, gas_and_fees_usd: r.plan.fees_total, hands_on_minutes: r.plan.hands_on_minutes, weeks: r.plan.weeks },
  farm_steps: stepStrings(r.plan),
});
const rows = radar.rows.map(boardRow);
const issue = boardIssue(rows, snapshot);
if (issue !== null) fail(`the board would fail the gate: ${issue}`);

const modelNote = {
  version: MODEL_VERSION,
  formula: 'implied = tvl_usd x category multiple x momentum x track x breadth x confidence x related',
  multiple: 'median market-cap/TVL of the snapshot protocols whose token trades, per category, shrunk toward its family and the global median by sample size',
  constants: K,
  as_of: snapshot.as_of,
  source: snapshot.source,
  note: 'Implied value is this radar\'s claim of what a token would be worth if the protocol\'s record stayed as it is; it does not predict whether or when a token is issued. A protocol here records no token in the snapshot; that is not proof it has none.',
};
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ model: modelNote, calibration: radar.calibration, excluded: radar.excluded, rows })}\n`);

// ---------------------------------------------------------------- data.js

const usedChains = [...new Set(radar.rows.flatMap((r) => r.chains))].filter((c) => GAS[c] !== undefined).sort();
const data = {
  as_of: snapshot.as_of,
  source: snapshot.source,
  floor_usd: snapshot.floor_usd,
  version: MODEL_VERSION,
  universe: snapshot.protocols.length,
  watchlist: snapshot.watchlist,
  K,
  families: FAMILIES,
  gas: Object.fromEntries(usedChains.map((c) => [c, GAS[c]])),
  calibration: radar.calibration,
  peers: radar.peers.map((p) => [p.name, p.category, p.symbol, p.tvl_usd, p.mcap_usd]),
  excluded: radar.excluded,
  rows: radar.rows.map((r) => ({
    rank: r.rank, slug: r.slug, name: r.name, cat: r.category, fam: r.family, chains: r.chains,
    tvl: r.tvl_usd, c7: r.change_7d, listed: r.listed_at, age: r.age_days, lane: r.lane, rel: r.related_token,
    v: r.implied_value_usd, lo: r.implied_low_usd, hi: r.implied_high_usd, score: r.score, f: r.factors, plan: r.plan,
  })),
};
writeFileSync(join(out, 'data.js'), `window.RADAR=${JSON.stringify(data)};\n`);

// ---------------------------------------------------------------- dashboard, screenshots, dossier

function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names = readdirSync(from).filter((n) => !n.startsWith('.') && statSync(join(from, n)).isFile()).sort();
  for (const n of names) copyFileSync(join(from, n), join(to, n));
  return names;
}
const dash = copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) fail(`screenshots/ holds ${shots.length} images; hand in 3`);
for (const n of shots) if (!IMAGE_NAME.test(n)) fail(`screenshots/${n} is not a plain file name`);

writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: TEXT_MAX_BYTES, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

const lanes = { watchlist: 0, early: 0, related: 0 };
for (const r of radar.rows) lanes[r.lane]++;
process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${radar.peers.length} calibration peers, ${rows.length} rows ` +
    `(${lanes.watchlist} watchlist, ${lanes.early} early, ${lanes.related} related-token)\n` +
    `token radar: wrote board.json, data.js, dashboard/ (${dash.length} files), screenshots/ (${shots.length}) and dossier.json to ${out}\n`,
);
