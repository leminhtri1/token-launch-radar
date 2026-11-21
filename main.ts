// Token launch radar (Node 22, standard library only, no network).
//
// Reads the sealed snapshot (/input/snapshot.json, or --input <file|dir>), runs the value model in
// lib/model.ts, and writes into the output directory (/output, or MAKEFUN_OUTPUT_DIR, or --output):
//   board.json    { model, summary, excluded, rows }           the ranked board the gate reads
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
import { FAMILIES, GAS, GAS_DEFAULT, MODEL_VERSION, RM, SnapshotError, boardIssue, buildRadar, median, parseSnapshot, recordsToken, stepStrings, verdictLine } from './lib/model.ts';
import type { Row, Snapshot } from './lib/model.ts';
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

let snapshot: Snapshot;
try {
  snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
} catch (err) {
  fail(err instanceof SnapshotError ? err.message : `cannot read ${inputFile}: ${String(err)}`, 2);
}
const radar = buildRadar(snapshot);
const covered = new Set(radar.rows.map((r) => r.slug));
const uncovered = snapshot.watchlist.filter((w) => !covered.has(w));
if (uncovered.length > 0) fail(`watchlist slugs the snapshot does not list: ${uncovered.join(', ')}`);
const fit = radar.fit;

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
  log_multiple: r.log_multiple,
  peer_token_odds: r.odds,
  expected_value_usd: r.expected_value_usd,
  verdict: r.econ.verdict,
  verdict_reason: r.econ.why,
  farm: {
    chain: r.plan.chain, capital_usd: r.plan.capital, gas_and_fees_usd: r.plan.fees_total, opportunity_cost_usd: r.econ.opp,
    total_cost_usd: r.econ.cost, hands_on_hours: r.econ.hours, weeks: r.plan.weeks, airdrop_usd: r.econ.drop,
    expected_payoff_usd: r.econ.ev, net_usd: r.econ.net, net_per_hour_usd: r.econ.per_hour, net_per_1k_usd: r.econ.per_1k,
  },
  farm_steps: [...stepStrings(r.plan), verdictLine(r)],
});
const rows = radar.rows.map(boardRow);
const issue = boardIssue(rows, snapshot);
if (issue !== null) fail(`the board would fail the gate: ${issue}`);
const silent = rows.filter((r) => r.lane !== 'related' && !r.farm_steps.some((t) => t.includes('records no token')));
if (silent.length > 0) fail(`${silent[0]!.slug}'s plan never says it records no token`);

const lanes = { watchlist: 0, early: 0, related: 0 };
const verdicts = { Farm: 0, Watch: 0, Skip: 0 };
for (const r of radar.rows) {
  lanes[r.lane]++;
  verdicts[r.econ.verdict]++;
}
const values = radar.rows.map((r) => r.implied_value_usd);
const summary = {
  rows: rows.length,
  lanes,
  verdicts,
  watchlist_covered: `${snapshot.watchlist.length}/${snapshot.watchlist.length}`,
  value_peers: radar.peers.length,
  odds_population: radar.pop.length,
  total_implied_usd: values.reduce((a, v) => a + v, 0),
  median_implied_usd: median(values),
  top: rows.slice(0, 5).map((r) => `${r.rank}. ${r.name} ${r.implied_value_usd}`),
};

const modelNote = {
  version: MODEL_VERSION,
  code: 'dashboard/model.js (the page runs the same file and checks every value against this board)',
  value: 'implied = TVL x exp(beta.x + family effect + category effect), fitted on the snapshot protocols whose token trades; x = [1, ln(TVL/$100M), tanh(change_7d/20), ln(1 + years listed), no listing date, ln chains]',
  odds: 'peer_token_odds = logistic fit, on every non-CEX snapshot protocol, of whether it records a token',
  verdict: 'cost = gas and fees + capital x 5%/yr over the window; payoff = odds x 10% community share of implied value x (half flat over TVL/$25k farmers, half pro rata)',
  assumptions: { ...RM.A, gas_usd_per_tx_and_funding: GAS },
  fit,
  as_of: snapshot.as_of,
  source: snapshot.source,
  note: 'Implied value is this radar\'s claim of what a token would be worth if the protocol\'s record stayed as it is; it does not predict whether or when a token is issued. A protocol here records no token in the snapshot; that is not proof it has none.',
};
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ model: modelNote, summary, excluded: radar.excluded, rows })}\n`);

// ---------------------------------------------------------------- data.js
// The page refits from these arrays, in this order: peers and pop exactly as buildRadar fed the model.

const usedChains = [...new Set(radar.rows.flatMap((r) => r.chains))].filter((c) => GAS[c] !== undefined).sort();
const data = {
  as_of: snapshot.as_of,
  source: snapshot.source,
  floor_usd: snapshot.floor_usd,
  version: MODEL_VERSION,
  universe: snapshot.protocols.length,
  watchlist: snapshot.watchlist,
  families: FAMILIES,
  gas: Object.fromEntries(usedChains.map((c) => [c, GAS[c]])),
  gas_default: GAS_DEFAULT,
  fit,
  peers: radar.peers.map((p) => [p.slug, p.name, p.category, p.symbol, p.tvl_usd, p.mcap_usd, p.change_7d, p.listed_at, p.chains.length]),
  pop: radar.pop.map((p) => [p.slug, p.category, p.tvl_usd, p.change_7d, p.listed_at, p.chains.length, recordsToken(p) ? 1 : 0]),
  excluded: radar.excluded,
  rows: radar.rows.map((r) => ({
    rank: r.rank, slug: r.slug, name: r.name, cat: r.category, fam: r.family, chains: r.chains,
    tvl: r.tvl_usd, c7: r.change_7d, listed: r.listed_at, age: r.age_days, lane: r.lane, rel: r.related_token,
    v: r.implied_value_usd, lo: r.implied_low_usd, hi: r.implied_high_usd, y: r.log_multiple, odds: r.odds, ev: r.expected_value_usd,
    econ: { ...r.econ, weight: undefined }, plan: r.plan,
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

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols, ${radar.peers.length} value peers, ${radar.pop.length} odds population, ${rows.length} rows ` +
    `(${lanes.watchlist} watchlist, ${lanes.early} early, ${lanes.related} related-token)\n` +
    `token radar: wrote board.json, data.js, dashboard/ (${dash.length} files), screenshots/ (${shots.length}) and dossier.json to ${out}\n`,
);
