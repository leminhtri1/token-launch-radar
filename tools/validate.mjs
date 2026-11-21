// Local gate check for the token radar (RULES.txt "The gate"), standard library only.
//
//   node tools/validate.mjs --input <snapshot.json> [--out out]
//
// Runs main.ts twice (into <out>-a and <out>-b), requires byte-identical outputs, then checks the
// seven gate rows on <out>-a plus this entry's own stricter targets (dashboard source under 60 KB, the
// page's refit replayed in Node and equal to board.json, held-out scores beating their baselines, every
// value term (size, reach, family, category, momentum, track) moving some row and none called dropped,
// dollar steps that land on the implied value, 4-8 farm steps, screenshots under 350 KB). Exits 1 on any failure.

import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, readFileSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { buildDossier } from '../vendor/makefun-board.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const input = opt('input', '/input/snapshot.json');
const outBase = opt('out', join(root, 'out'));

const results = [];
const check = (row, ok, detail = '') => { results.push({ row, ok, detail }); };

// ------------------------------------------------------------ two runs, identical bytes
const outs = [`${outBase}-a`, `${outBase}-b`];
for (const o of outs) {
  rmSync(o, { recursive: true, force: true });
  mkdirSync(o, { recursive: true });
  execFileSync(process.execPath, [join(root, 'main.ts'), '--input', input], { env: { ...process.env, MAKEFUN_OUTPUT_DIR: o }, stdio: ['ignore', 'ignore', 'inherit'] });
}
function walk(dir, base = '') {
  const files = [];
  for (const n of readdirSync(dir).sort()) {
    const p = join(dir, n);
    const rel = base ? `${base}/${n}` : n;
    if (lstatSync(p).isDirectory()) files.push(...walk(p, rel));
    else files.push(rel);
  }
  return files;
}
{
  const [a, b] = outs.map((o) => walk(o));
  const diff = a.length !== b.length ? ['file lists differ'] : a.filter((f, i) => f !== b[i] || !readFileSync(join(outs[0], f)).equals(readFileSync(join(outs[1], f))));
  check('deterministic', diff.length === 0, diff.length ? `differs: ${diff.slice(0, 5).join(', ')}` : `${a.length} files identical across two runs`);
}
const out = outs[0];
const snap = JSON.parse(readFileSync(input, 'utf8'));

// ------------------------------------------------------------ dashboard_files
{
  const dir = join(out, 'dashboard');
  const NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
  const files = existsSync(dir) ? walk(dir) : [];
  let bytes = 0;
  let bad = null;
  for (const f of files) {
    const parts = f.split('/');
    if (parts.some((p) => !NAME.test(p))) bad ??= `${f}: bad name`;
    if (!lstatSync(join(dir, f)).isFile()) bad ??= `${f}: not a regular file`;
    const text = readFileSync(join(dir, f), 'utf8');
    bytes += Buffer.byteLength(text);
    const ext = f.slice(f.lastIndexOf('.') + 1);
    if (ext === 'css' && /https?:\/\//i.test(text)) bad ??= `${f}: URL in CSS`;
    if (ext === 'html') {
      for (const m of text.matchAll(/\s[\w:-]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g)) if (/https?:\/\//i.test(m[1])) bad ??= `${f}: URL in attribute ${m[0].trim().slice(0, 60)}`;
      for (const m of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) if (/https?:\/\//i.test(m[1])) bad ??= `${f}: URL in <style>`;
    }
    if (ext === 'js' || ext === 'mjs' || ext === 'html') {
      const spec = /(?:\bimport\s*(?:[\w*{}\s,]+from\s*)?|\bexport\s*[\w*{}\s,]*from\s*|\brequire\s*\(\s*|\bimport\s*\(\s*)["'`](https?:\/\/[^"'`]*)/g;
      const m = spec.exec(text);
      if (m) bad ??= `${f}: network import ${m[1]}`;
    }
  }
  const has = (re) => files.some((f) => re.test(f));
  const ok = files.includes('index.html') && has(/\.css$/) && has(/\.js$/) && files.length <= 400 && bytes <= 4 * 1024 * 1024 && bad === null;
  check('dashboard_files', ok, bad ?? `${files.length} files, ${bytes} bytes`);
  check('target: dashboard source < 60 KB', bytes < 60 * 1024, `${bytes} bytes`);
}

// ------------------------------------------------------------ board_file, sorted_by_value, coverage, farm_steps
const boardText = readFileSync(join(out, 'board.json'));
let rows = [];
{
  let ok = boardText.length <= 8 * 1024 * 1024;
  let detail = `${boardText.length} bytes`;
  try {
    const j = JSON.parse(boardText.toString('utf8'));
    rows = Array.isArray(j) ? j : j.rows;
    if (!Array.isArray(rows)) throw new Error('rows is not an array');
  } catch (e) { ok = false; detail = String(e); rows = []; }
  const known = new Set(snap.protocols.map((p) => p.slug));
  const seen = new Set();
  const invented = [];
  for (const r of rows) {
    if (typeof r.slug !== 'string' || r.slug.length < 1 || r.slug.length > 128 || /\s/.test(r.slug) || seen.has(r.slug)) { ok = false; detail = `bad or repeated slug ${r.slug}`; }
    if (!known.has(r.slug)) invented.push(r.slug);
    seen.add(r.slug);
    if (typeof r.name !== 'string' || r.name.trim() === '') { ok = false; detail = `${r.slug}: empty name`; }
    if (!Number.isSafeInteger(r.rank) || r.rank < 1) { ok = false; detail = `${r.slug}: rank ${r.rank}`; }
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd < 1 || r.implied_value_usd > 1e14) { ok = false; detail = `${r.slug}: value ${r.implied_value_usd}`; }
    if (!Array.isArray(r.farm_steps)) { ok = false; detail = `${r.slug}: no farm_steps`; }
  }
  if (invented.length) { ok = false; detail = `invented slugs: ${invented.slice(0, 3).join(', ')}`; }
  if (rows.length < 100 || rows.length > 4000) { ok = false; detail = `${rows.length} rows`; }
  check('board_file', ok, ok ? `${rows.length} rows, ${detail}` : detail);

  const byRank = [...rows].sort((a, b) => a.rank - b.rank);
  let sorted = byRank.every((r, i) => r.rank === i + 1);
  let sd = sorted ? 'ranks 1..N' : 'ranks are not exactly 1..N';
  for (let i = 1; sorted && i < byRank.length; i++) if (byRank[i].implied_value_usd > byRank[i - 1].implied_value_usd) { sorted = false; sd = `rank ${i + 1} worth more than rank ${i}`; }
  if (rows.length >= 2 && new Set(rows.map((r) => r.implied_value_usd)).size === 1) { sorted = false; sd = 'all values equal'; }
  check('sorted_by_value', sorted, `${sd}; ${new Set(rows.map((r) => r.implied_value_usd)).size} distinct values`);

  const missing = snap.watchlist.filter((w) => !seen.has(w));
  check('coverage', missing.length === 0, missing.length ? `missing ${missing.join(', ')}` : `${snap.watchlist.length}/${snap.watchlist.length} watchlist slugs`);
  check('target: >= 60 rows outside the watchlist', rows.filter((r) => !snap.watchlist.includes(r.slug)).length >= 60, `${rows.length - snap.watchlist.length} outside`);

  let fs = true, fd = '', minS = 99, maxS = 0, minL = 1e9, maxL = 0;
  for (const r of rows) {
    const st = r.farm_steps ?? [];
    minS = Math.min(minS, st.length); maxS = Math.max(maxS, st.length);
    if (st.length < 3 || st.length > 12) { fs = false; fd = `${r.slug}: ${st.length} steps`; }
    for (const t of st) {
      const n = typeof t === 'string' ? t.trim().length : -1;
      minL = Math.min(minL, n); maxL = Math.max(maxL, n);
      if (n < 20 || n > 600) { fs = false; fd = `${r.slug}: step of ${n} chars`; }
    }
  }
  check('farm_steps', fs, fd || `${minS}-${maxS} steps a row, ${minL}-${maxL} chars a step`);
  check('target: 4-8 farm steps', minS >= 4 && maxS <= 8, `${minS}-${maxS}`);
  const says = rows.flatMap((r) => r.farm_steps).filter((t) => /\bhas no token\b|\bhas none\b/i.test(t));
  check('target: says "records no token", never "has none"', says.length === 0, says[0] ?? 'ok');
}

// ------------------------------------------------------------ the page's own refit, replayed in Node
// Loads data.js and dashboard/model.js in a sandbox exactly as index.html does, rebuilds the model inputs
// the way app.js does, and requires the refit to equal board.json row for row.
{
  const ctx = { window: {}, Date, Math, isFinite };
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(out, 'data.js'), 'utf8'), ctx);
  vm.runInContext(readFileSync(join(out, 'dashboard', 'model.js'), 'utf8'), ctx);
  const D = ctx.window.RADAR;
  const M = ctx.RadarModel;
  const fam = {};
  for (const [f, cats] of Object.entries(D.families)) for (const c of cats) fam[c] = f;
  const inp = (slug, cat, tvl, c7, listed, nch) => ({ slug, cat: cat || 'Uncategorised', fam: (cat && fam[cat]) || 'Other', tvl, c7, age: M.ageDays(D.as_of, listed), nch });
  const R = M.build({
    peers: D.peers.map((p) => ({ ...inp(p[0], p[2], p[4], p[6], p[7], p[8]), mcap: p[5] })),
    pop: D.pop.map((p) => ({ ...inp(p[0], p[1], p[2], p[3], p[4], p[5]), tok: p[6] })),
    rows: D.rows.map((r) => ({ ...inp(r.slug, r.cat, r.tvl, r.c7, r.listed, r.chains.length), lane: r.lane, plan: r.plan })),
  });
  const byslug = new Map(rows.map((r) => [r.slug, r]));
  const bad = D.rows.filter((r, i) => {
    const m = R.rows[i];
    const b = byslug.get(r.slug);
    return !b || m.v !== b.implied_value_usd || m.lo !== b.implied_low_usd || m.hi !== b.implied_high_usd || m.odds !== b.peer_token_odds || m.ev !== b.expected_value_usd || m.econ.verdict !== b.verdict;
  });
  check('target: page refit equals board.json', bad.length === 0, bad.length ? `${bad.length} rows differ, first ${bad[0].slug}` : `${D.rows.length}/${D.rows.length} rows (value, band, odds, EV, verdict)`);
  const kf = R.kfold;
  const lc = R.loco;
  check('target: value fit beats naive held-out twice', kf.mdae < kf.base_mdae && lc.mdae < lc.base_mdae, `5-fold ${kf.mdae} vs ${kf.base_mdae}; by category ${lc.mdae} vs ${lc.base_mdae}`);
  check('target: odds beat the base rate held-out', R.odds_best.logloss < R.odds_best.base_logloss && R.odds_best.auc > 0.5, `AUC ${R.odds_best.auc}, log loss ${R.odds_best.logloss} vs ${R.odds_best.base_logloss}`);
  const noVerdict = rows.filter((r) => !['Farm', 'Watch', 'Skip'].includes(r.verdict) || !r.farm_steps.some((t) => t.startsWith(`Verdict: ${r.verdict}`)) || !(r.farm.total_cost_usd > 0) || !(r.farm.hands_on_hours > 0));
  check('target: every row has a costed verdict', noVerdict.length === 0, noVerdict.length ? `${noVerdict[0].slug}` : `${rows.length} rows with cost, hours and verdict`);
  // every value term moves some row's value, and nothing on the page or the board calls a term dropped
  const NAMES = ['base multiple', 'size', 'reach', 'family', 'category', 'momentum(7d)', 'track(days with no token)'];
  const moved = NAMES.map((n, k) => R.rows.filter((r) => Math.abs(r.factors[k] - 1) >= 0.01).length);
  const still = NAMES.filter((n, k) => moved[k] === 0);
  const dash = readdirSync(join(out, 'dashboard')).map((f) => readFileSync(join(out, 'dashboard', f), 'utf8')).join('\n');
  const dropped = /\bdropped\b/i.test(dash) || /\bdropped\b/i.test(boardText.toString('utf8'));
  check('target: every value term non-neutral, none dropped', still.length === 0 && !dropped && R.value.beta.every((b) => Math.abs(b) > 0.01),
    still.length ? `neutral on every row: ${still.join(', ')}` : dropped ? 'the word "dropped" appears' : NAMES.map((n, k) => `${n.split('(')[0]} ${moved[k]}`).join(', '));
  const walk = rows.filter((r) => !Array.isArray(r.value_steps) || r.value_steps.length !== 8 || r.value_steps[7].usd !== r.implied_value_usd);
  check('target: value_steps walk TVL to the implied value', walk.length === 0, walk.length ? `${walk[0].slug}` : `${rows.length} rows, 8 steps each, last = implied_value_usd`);
  const v2 = R.cmp.find((c) => c.mode === 'v2');
  check('target: v3 held-out well under naive, cost vs v2 shown', kf.mdae < 0.8 * kf.base_mdae && lc.mdae < 0.8 * lc.base_mdae,
    `5-fold v3 ${kf.mdae} / v2 ${v2.kf} / naive ${kf.base_mdae}; by category v3 ${lc.mdae} / v2 ${v2.lo} / naive ${lc.base_mdae}`);
  const src = ['app.js', 'model.js'].map((f) => readFileSync(join(out, 'dashboard', f), 'utf8')).join('\n');
  const named = rows.filter((r) => r.name.length > 4 && src.includes(r.name));
  check('target: no protocol named in the page code', named.length === 0, named.length ? named.slice(0, 3).map((r) => r.name).join(', ') : 'none');
}

// ------------------------------------------------------------ screenshots
function imageSize(buf) {
  if (buf.length > 24 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    const whole = buf.subarray(buf.length - 8, buf.length - 4).toString('latin1') === 'IEND';
    return { kind: 'png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), whole };
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) return null;
      const m = buf[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { kind: 'jpeg', h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7), whole: buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9 };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}
{
  const dir = join(out, 'screenshots');
  const names = existsSync(dir) ? readdirSync(dir).filter((n) => !n.startsWith('.')).sort() : [];
  let ok = names.length >= 3 && names.length <= 4;
  const details = [];
  let big = false;
  for (const n of names) {
    const buf = readFileSync(join(dir, n));
    const im = imageSize(buf);
    if (!/^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(n) || buf.length > 524288 || im === null || !im.whole) { ok = false; details.push(`${n}: bad`); continue; }
    const long = Math.max(im.w, im.h), short = Math.min(im.w, im.h);
    if (long > 1440 || short < 800) ok = false;
    if (buf.length > 350 * 1024) big = true;
    details.push(`${n} ${im.kind} ${im.w}x${im.h} ${Math.round(buf.length / 1024)}KB`);
  }
  check('screenshots', ok, details.join('; ') || 'none');
  check('target: each screenshot <= 350 KB', !big, big ? 'one is over 350 KB' : 'ok');
}

// ------------------------------------------------------------ dossier_matches
{
  const want = Buffer.from(buildDossier(out, { text_max_bytes: 65536 }));
  const got = readFileSync(join(out, 'dossier.json'));
  check('dossier_matches', want.equals(got) && got.length <= 1.5 * 1024 * 1024, `${got.length} bytes${want.equals(got) ? '' : ', differs from buildDossier'}`);
  const text = JSON.parse(got.toString('utf8'));
  const flat = JSON.stringify(text);
  check('target: dossier shows every source file whole', !/lines? (are|is) not shown|left out/.test(flat), 'no cut line');
}

let failed = 0;
for (const r of results) {
  if (!r.ok) failed++;
  process.stdout.write(`${r.ok ? 'PASS' : 'FAIL'}  ${r.row.padEnd(48)} ${r.detail}\n`);
}
process.stdout.write(failed ? `\n${failed} check(s) failed\n` : '\nall checks pass\n');
process.exit(failed ? 1 : 0);
