// Token Launch Radar, the page. Reads window.RADAR (data.js, written beside dashboard/ by main.ts) and
// renders three views from the URL hash: the board (#lane=..&cat=..&sort=..), the already-trading
// calibration set (#view=trading) and one protocol's detail (#p=<slug>).
//
// The page does not trust the board's numbers: calibrate() rebuilds every category multiple from the
// tokens that trade (data.js "peers"), factorsOf() rebuilds each row's factors from its raw snapshot
// figures, and impliedOf() multiplies them out. The rail and each detail view report whether that
// recomputation matches the value board.json ranks by. Same arithmetic as lib/model.ts.
(function () {
  'use strict';
  var D = window.RADAR;
  var app = document.getElementById('app');
  if (!D) { app.innerHTML = '<p class="empty">data.js is missing: run main.ts to write it beside dashboard/.</p>'; return; }
  var K = D.K;

  // ------------------------------------------------------------ the model, recomputed
  function r4(n) { return Math.round(n * 1e4) / 1e4; }
  function clamp(x, lo, hi) { return Math.min(hi, Math.max(lo, x)); }
  function sorted(xs) { return xs.slice().sort(function (a, b) { return a - b; }); }
  function median(xs) { var a = sorted(xs), m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; }
  function quantile(xs, q) { var a = sorted(xs), p = (a.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p); return a[lo] + (a[hi] - a[lo]) * (p - lo); }
  function spreadOf(logs) { return logs.length < 4 ? 1 : (quantile(logs, 0.75) - quantile(logs, 0.25)) / 1.349; }
  var FAM = {};
  Object.keys(D.families).forEach(function (f) { D.families[f].forEach(function (c) { FAM[c] = f; }); });
  function familyOf(cat) { return (cat && FAM[cat]) || 'Other'; }
  // peers: [name, category, symbol, tvl_usd, mcap_usd] for every protocol whose token trades
  function logMult(p) { return Math.log(p[4] / p[3]); }

  /** Category multiples from the trading peers: log-median per category, shrunk to family, then global. */
  function calibrate(peers, cats) {
    var all = peers.map(logMult), gMed = median(all), gSpread = spreadOf(all), fams = {}, out = {};
    Object.keys(D.families).concat('Other').forEach(function (f) {
      var logs = peers.filter(function (p) { return familyOf(p[1]) === f; }).map(logMult), n = logs.length;
      var med = n ? median(logs) : null;
      var lm = med === null ? gMed : (n * med + K.shrink * gMed) / (n + K.shrink);
      fams[f] = { n: n, multiple: r4(clamp(Math.exp(lm), K.mult_min, K.mult_max)), spread: r4((n * (n >= 4 ? spreadOf(logs) : gSpread) + K.shrink * gSpread) / (n + K.shrink)) };
    });
    cats.forEach(function (c) {
      var f = familyOf(c === 'Uncategorised' ? null : c);
      var logs = peers.filter(function (p) { return (p[1] || 'Uncategorised') === c; }).map(logMult), n = logs.length;
      var fl = Math.log(fams[f].multiple), lm = n ? (n * median(logs) + K.shrink * fl) / (n + K.shrink) : fl;
      out[c] = { n: n, family: f, median: n ? Math.exp(median(logs)) : null, multiple: r4(clamp(Math.exp(lm), K.mult_min, K.mult_max)) };
    });
    return { global: Math.exp(gMed), families: fams, categories: out };
  }

  function ageOf(listed) {
    if (!listed) return null;
    return Math.max(0, Math.floor((Date.parse(D.as_of + 'T00:00:00Z') - Date.parse(listed + 'T00:00:00Z')) / 86400000));
  }
  function momentum(c7) { return c7 === null ? 1 : 1 + K.mom_amp * Math.tanh(c7 / K.mom_scale); }
  function track(age) {
    if (age === null) return K.track_unknown;
    if (age <= K.track_plateau_days) return K.track_start + (K.track_peak - K.track_start) * Math.min(age, K.track_ramp_days) / K.track_ramp_days;
    return K.track_peak - (K.track_peak - K.track_late) * Math.min(age - K.track_plateau_days, K.track_fade_days) / K.track_fade_days;
  }
  function breadth(n) { return Math.min(K.breadth_cap, K.breadth_base + K.breadth_slope * Math.log(Math.max(1, n))); }
  function confidence(tvl) { return K.conf_floor + (1 - K.conf_floor) * clamp(Math.log10(tvl / K.conf_tvl_lo) / Math.log10(K.conf_tvl_span), 0, 1); }

  function factorsOf(r) {
    var age = ageOf(r.listed);
    return {
      multiple: CAL.categories[r.cat || 'Uncategorised'].multiple,
      momentum: r4(momentum(r.c7)), track: r4(track(age)), breadth: r4(breadth(r.chains.length)),
      confidence: r4(confidence(r.tvl)), related: r.lane === 'related' ? K.related_haircut : 1, age: age
    };
  }
  function impliedOf(r, f) { return Math.max(1, Math.round(r.tvl * f.multiple * f.momentum * f.track * f.breadth * f.confidence * f.related)); }
  function bandOf(r, f) {
    var c = CAL.categories[r.cat || 'Uncategorised'], s = CAL.families[c.family].spread;
    var h = clamp(1.2533 * s / Math.sqrt(c.n + K.shrink) + (f.age === null ? 0.1 : 0), K.band_min, K.band_max);
    return [Math.max(1, Math.round(r.v * Math.exp(-h))), Math.max(1, Math.round(r.v * Math.exp(h))), h];
  }

  var catList = [];
  D.rows.concat(D.peers.map(function (p) { return { cat: p[1] }; })).forEach(function (r) { var c = r.cat || 'Uncategorised'; if (catList.indexOf(c) < 0) catList.push(c); });
  var CAL = calibrate(D.peers, catList);
  var MATCH = 0;
  D.rows.forEach(function (r) { r.calc = impliedOf(r, factorsOf(r)); if (r.calc === r.v) MATCH++; });
  var CAT_OK = catList.filter(function (c) { return D.calibration.categories[c] && D.calibration.categories[c].multiple === CAL.categories[c].multiple; }).length;

  // ------------------------------------------------------------ formatting
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function usd(n) {
    if (n === null || n === undefined) return 'n/a';
    var a = Math.abs(n);
    if (a >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return '$' + (n / 1e6).toFixed(a >= 1e8 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (a >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + (a >= 10 ? n.toFixed(0) : n.toFixed(2));
  }
  function dollars(n) { return n >= 100 ? '$' + Math.round(n).toLocaleString('en-US') : '$' + n.toFixed(2); }
  function pct(n) { return n === null ? '<span class="sub">n/a</span>' : '<span class="' + (n >= 0 ? 'up' : 'down') + '">' + (n > 0 ? '+' : '') + n.toFixed(1) + '%</span>'; }
  function age(d) { return d === null ? 'unknown' : d >= 365 ? (d / 365).toFixed(1) + ' y' : d + ' d'; }
  function x(n) { return '×' + n.toFixed(n < 0.1 ? 4 : 3); }
  function mins(m) { return m >= 90 ? (m / 60).toFixed(1) + ' h' : m + ' min'; }
  var LANE = { watchlist: 'watchlist', early: 'early', related: 'related token' };
  function tag(l) { return '<span class="tag ' + l + '">' + LANE[l] + '</span>'; }

  // ------------------------------------------------------------ state in the hash
  var S;
  function readHash() {
    var h = new URLSearchParams(location.hash.replace(/^#/, ''));
    S = {
      p: h.get('p'), view: h.get('view') || 'board', q: h.get('q') || '', cat: h.get('cat') || '', chain: h.get('chain') || '',
      lane: h.get('lane') || 'all', min: +(h.get('min') || 0), hide: h.get('hide') === '1',
      sort: h.get('sort') || 'rank', dir: +(h.get('dir') || 1)
    };
  }
  function writeHash() {
    var h = new URLSearchParams();
    if (S.view !== 'board') h.set('view', S.view);
    ['q', 'cat', 'chain'].forEach(function (k) { if (S[k]) h.set(k, S[k]); });
    if (S.lane !== 'all') h.set('lane', S.lane);
    if (S.min) h.set('min', S.min);
    if (S.hide) h.set('hide', '1');
    if (S.sort !== 'rank') { h.set('sort', S.sort); h.set('dir', S.dir); }
    history.replaceState(null, '', '#' + h.toString());
  }

  // ------------------------------------------------------------ header, KPIs, rail
  var lanes = { watchlist: 0, early: 0, related: 0 };
  D.rows.forEach(function (r) { lanes[r.lane]++; });
  var covered = D.watchlist.filter(function (w) { return D.rows.some(function (r) { return r.slug === w; }); }).length;
  var total = D.rows.reduce(function (a, r) { return a + r.v; }, 0);
  document.getElementById('meta').innerHTML =
    '<span>Snapshot <b>' + esc(D.as_of) + '</b></span><span>DefiLlama · <b>' + D.universe + '</b> protocols</span><span>Model <b>' + esc(D.version) + '</b></span>';
  document.getElementById('kpis').innerHTML = [
    ['Protocols ranked', D.rows.length, lanes.watchlist + ' watchlist · ' + lanes.early + ' early · ' + lanes.related + ' related'],
    ['Watchlist covered', covered + ' / ' + D.watchlist.length, 'floor ' + usd(D.floor_usd) + ' TVL, no token recorded'],
    ['Total implied value', usd(total), 'sum of ranked rows; top ' + usd(D.rows[0].v)],
    ['Median mcap / TVL', x(D.calibration.global.multiple), 'across ' + D.calibration.global.n + ' tokens that trade'],
    ['Page recomputation', MATCH + ' / ' + D.rows.length, 'rows rebuilt here from raw figures']
  ].map(function (k, i) { return '<div class="kpi' + (i === 1 || i === 4 ? ' accent' : '') + '"><span>' + k[0] + '</span><b>' + k[1] + '</b><small>' + k[2] + '</small></div>'; }).join('');
  document.getElementById('foot').textContent = 'Implied value is this radar’s claim of what a token would be worth if the protocol’s record stayed as it is; it does not predict whether or when a token is issued. A row records no token in the snapshot, which is not proof it has none. Gas figures are per-transaction estimates per chain. Source: ' + D.source + '.';

  function rail() {
    var cats = {};
    D.rows.forEach(function (r) { var c = r.cat || 'Uncategorised'; cats[c] = (cats[c] || 0) + 1; });
    var top = Object.keys(cats).sort(function (a, b) { return cats[b] - cats[a] || (a < b ? -1 : 1); }).slice(0, 7);
    return '<aside class="rail">' +
      '<div class="panel pad"><h3>How implied value is set</h3>' +
      '<div class="formula">implied = TVL × <em>multiple</em><br>  × momentum(change_7d)<br>  × track(days with no token)<br>  × breadth(chains) × confidence(TVL)<br>  × ' + K.related_haircut + ' if a related token trades</div>' +
      '<p><b>Multiple</b> = median market cap / TVL of the snapshot’s ' + D.peers.length + ' protocols whose token trades, per category, shrunk toward its family and the global median by sample size (K = ' + K.shrink + '). No name is hard-coded.</p>' +
      '<div class="legend">' + tag('watchlist') + '<span>house list: TVL ≥ ' + usd(D.floor_usd) + '</span>' + tag('early') + '<span>off the list, no token</span>' + tag('related') + '<span>same-name token, ×' + K.related_haircut + '</span></div>' +
      '<p class="check"><span class="ok">✓</span> This page re-ran the calibration: ' + CAT_OK + '/' + catList.length + ' category multiples and ' + MATCH + '/' + D.rows.length + ' implied values equal board.json.</p></div>' +
      '<div class="panel pad"><h3>Multiples used most</h3><table class="mini"><tbody>' +
      top.map(function (c) { var m = CAL.categories[c]; return '<tr><td>' + esc(c) + ' <span class="sub">' + m.n + ' trading peers · ' + esc(m.family) + '</span></td><td class="n mono">' + x(m.multiple) + '</td></tr>'; }).join('') +
      '</tbody></table></div>' +
      '<div class="panel pad"><h3>Left off the board</h3><table class="mini"><tbody>' +
      D.excluded.map(function (e) { return '<tr><td>' + esc(e.reason) + ' <span class="sub">' + esc(e.examples.slice(0, 3).join(', ')) + '</span></td><td class="n mono">' + e.count + '</td></tr>'; }).join('') +
      '</tbody></table><p>Their value is the asset they hold or wrap, which already trades.</p></div></aside>';
  }

  // ------------------------------------------------------------ the board
  var COLS = [
    ['rank', '#', 'rk'], ['name', 'Protocol', ''], ['cat', 'Category', ''], ['chains', 'Chains · farm plan', ''],
    ['tvl', 'TVL', 'n'], ['c7', '7d', 'n'], ['age', 'Tokenless', 'n'], ['v', 'Implied value · band', 'n'], ['score', 'Score', '']
  ];
  function keyOf(r, k) {
    if (k === 'name') return r.name.toLowerCase();
    if (k === 'cat') return (r.cat || '').toLowerCase();
    if (k === 'chains') return r.chains.length;
    if (k === 'c7') return r.c7 === null ? -1e9 : r.c7;
    if (k === 'age') return r.age === null ? -1 : r.age;
    return r[k];
  }
  function filtered() {
    var q = S.q.toLowerCase();
    var rows = D.rows.filter(function (r) {
      if (q && (r.name + ' ' + (r.cat || '') + ' ' + r.chains.join(' ')).toLowerCase().indexOf(q) < 0) return false;
      if (S.cat && (r.cat || 'Uncategorised') !== S.cat) return false;
      if (S.chain && r.chains.indexOf(S.chain) < 0) return false;
      if (S.lane !== 'all' && r.lane !== S.lane) return false;
      if (S.min && r.tvl < S.min) return false;
      if (S.hide && r.lane === 'related') return false;
      return true;
    });
    var k = S.sort, d = S.dir;
    return rows.sort(function (a, b) { var A = keyOf(a, k), B = keyOf(b, k); return A < B ? -d : A > B ? d : a.rank - b.rank; });
  }
  function rowHtml(r) {
    var more = r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '';
    return '<tr data-slug="' + esc(r.slug) + '"><td class="rk">' + r.rank + '</td>' +
      '<td><span class="pname">' + esc(r.name) + '</span>' + tag(r.lane) + '</td>' +
      '<td class="catc">' + esc(r.cat || 'Uncategorised') + '<span class="sub">' + x(r.f.multiple) + ' multiple</span></td>' +
      '<td class="chains">' + esc(r.chains.slice(0, 2).join(', ')) + more + '<span class="sub farm">' + dollars(r.plan.capital) + ' · ' + dollars(r.plan.fees_total) + ' gas · ' + r.plan.weeks + 'w</span></td>' +
      '<td class="n">' + usd(r.tvl) + '</td><td class="n">' + pct(r.c7) + '</td><td class="n">' + age(r.age) + '</td>' +
      '<td class="n"><span class="val">' + usd(r.v) + '</span><span class="band">' + usd(r.lo) + ' – ' + usd(r.hi) + '</span></td>' +
      '<td><span class="bar' + (r.lane === 'related' ? ' rel' : '') + '"><i style="width:' + r.score + '%"></i></span><span class="sc">' + r.score + '</span></td></tr>';
  }
  function opts(list, cur, all) {
    return '<option value="">' + all + '</option>' + list.map(function (v) { return '<option' + (v === cur ? ' selected' : '') + ' value="' + esc(v) + '">' + esc(v) + '</option>'; }).join('');
  }
  function counted(get) {
    var c = {};
    D.rows.forEach(function (r) { [].concat(get(r)).forEach(function (v) { c[v] = (c[v] || 0) + 1; }); });
    return Object.keys(c).sort(function (a, b) { return c[b] - c[a] || (a < b ? -1 : 1); });
  }
  var CATS = counted(function (r) { return r.cat || 'Uncategorised'; });
  var CHAINS = counted(function (r) { return r.chains; }).slice(0, 40);
  var MINS = [[0, 'Any TVL'], [10e6, 'TVL ≥ $10M'], [25e6, 'TVL ≥ $25M'], [50e6, 'TVL ≥ $50M'], [100e6, 'TVL ≥ $100M'], [250e6, 'TVL ≥ $250M']];

  function tabs() {
    return '<div class="tabs"><button data-view="board" class="' + (S.view === 'board' ? 'on' : '') + '">Pre-token board · ' + D.rows.length + '</button>' +
      '<button data-view="trading" class="' + (S.view === 'trading' ? 'on' : '') + '">Already trading · ' + D.peers.length + '</button>' +
      '<span class="note" id="note">' + (S.view !== 'board' ? 'Not ranked: these tokens trade, and set the multiples.' : active() || 'Ranked by implied value. Click a row for its math and farm plan.') + '</span></div>';
  }
  function active() {
    var a = [];
    if (S.lane !== 'all') a.push(S.lane === 'related' ? 'related token' : S.lane);
    if (S.cat) a.push(esc(S.cat));
    if (S.chain) a.push(esc(S.chain));
    if (S.min) a.push('TVL ≥ ' + usd(S.min));
    if (S.q) a.push('“' + esc(S.q) + '”');
    if (S.hide) a.push('related hidden');
    if (S.sort !== 'rank') a.push('sorted by ' + (COLS.filter(function (c) { return c[0] === S.sort; })[0] || [0, S.sort])[1] + (S.dir > 0 ? ' ↑' : ' ↓'));
    return a.length ? '<span class="chips">Filtered: ' + a.map(function (t) { return '<b>' + t + '</b>'; }).join('') + '</span> <a href="#">Reset</a>' : '';
  }
  function board() {
    var lanesSeg = [['all', 'All'], ['watchlist', 'Watchlist'], ['early', 'Early'], ['related', 'Related']].map(function (l) {
      return '<button data-lane="' + l[0] + '" class="' + (S.lane === l[0] ? 'on' : '') + '">' + l[1] + '</button>';
    }).join('');
    app.innerHTML = '<div class="layout"><section class="panel">' + tabs() +
      '<div class="filters"><input type="search" id="q" placeholder="Search name, category, chain" value="' + esc(S.q) + '">' +
      '<select id="cat">' + opts(CATS, S.cat, 'All categories') + '</select>' +
      '<select id="chain">' + opts(CHAINS, S.chain, 'All chains') + '</select>' +
      '<select id="min">' + MINS.map(function (m) { return '<option value="' + m[0] + '"' + (m[0] === S.min ? ' selected' : '') + '>' + m[1] + '</option>'; }).join('') + '</select>' +
      '<span class="seg">' + lanesSeg + '</span>' +
      '<label class="chk"><input type="checkbox" id="hide"' + (S.hide ? ' checked' : '') + '> Hide related-token rows</label>' +
      '<span class="count" id="count"></span></div>' +
      '<table><thead><tr>' + COLS.map(function (c) {
        return '<th data-k="' + c[0] + '" class="' + c[2] + '"' + (S.sort === c[0] ? ' aria-sort="' + (S.dir > 0 ? 'ascending' : 'descending') + '"' : '') + '>' + c[1] + '</th>';
      }).join('') + '</tr></thead><tbody id="rows"></tbody></table></section>' + rail() + '</div>';
    body();
    bindBoard();
  }
  function body() {
    var rows = filtered();
    document.getElementById('rows').innerHTML = rows.length ? rows.map(rowHtml).join('') : '<tr><td colspan="9" class="empty">No protocol matches these filters.</td></tr>';
    var sum = rows.reduce(function (a, r) { return a + r.v; }, 0);
    document.getElementById('note').innerHTML = active() || 'Ranked by implied value. Click a row for its math and farm plan.';
    document.getElementById('count').textContent = rows.length + ' of ' + D.rows.length + ' rows · ' + usd(sum) + ' implied';
  }
  function bindBoard() {
    function set(k, v) { S[k] = v; writeHash(); body(); }
    document.getElementById('q').addEventListener('input', function (e) { set('q', e.target.value.trim()); });
    document.getElementById('cat').addEventListener('change', function (e) { set('cat', e.target.value); });
    document.getElementById('chain').addEventListener('change', function (e) { set('chain', e.target.value); });
    document.getElementById('min').addEventListener('change', function (e) { set('min', +e.target.value); });
    document.getElementById('hide').addEventListener('change', function (e) { set('hide', e.target.checked); });
    app.querySelectorAll('.seg button').forEach(function (b) { b.addEventListener('click', function () { S.lane = b.dataset.lane; writeHash(); board(); }); });
    app.querySelectorAll('th').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.dataset.k;
        if (S.sort === k) S.dir = -S.dir; else { S.sort = k; S.dir = (k === 'rank' || k === 'name' || k === 'cat') ? 1 : -1; }
        writeHash(); board();
      });
    });
    document.getElementById('rows').addEventListener('click', function (e) {
      var tr = e.target.closest('tr[data-slug]');
      if (tr) location.hash = 'p=' + encodeURIComponent(tr.dataset.slug);
    });
    bindTabs();
  }
  function bindTabs() {
    app.querySelectorAll('.tabs button').forEach(function (b) { b.addEventListener('click', function () { S.view = b.dataset.view; writeHash(); render(); }); });
  }

  // ------------------------------------------------------------ already trading
  function trading() {
    var peers = D.peers.slice().sort(function (a, b) { return b[4] - a[4]; });
    app.innerHTML = '<div class="layout"><section class="panel">' + tabs() + '<table><thead><tr><th>Protocol</th><th>Category</th><th class="n">TVL</th><th class="n">Market cap</th><th class="n">mcap / TVL</th><th class="n">Category multiple</th></tr></thead><tbody>' +
      peers.map(function (p) {
        var c = CAL.categories[p[1] || 'Uncategorised'];
        return '<tr><td><span class="pname">' + esc(p[0]) + '</span><span class="tag trading">' + esc(p[2] || 'token') + '</span></td><td>' + esc(p[1] || 'Uncategorised') + '</td><td class="n">' + usd(p[3]) + '</td><td class="n">' + usd(p[4]) + '</td><td class="n">' + x(p[4] / p[3]) + '</td><td class="n">' + x(c.multiple) + '</td></tr>';
      }).join('') + '</tbody></table></section>' + rail() + '</div>';
    bindTabs();
  }

  // ------------------------------------------------------------ one protocol
  function detail(slug) {
    var r = D.rows.filter(function (q) { return q.slug === slug; })[0];
    if (!r) { app.innerHTML = '<p class="empty">No protocol ' + esc(slug) + ' on this board. <a href="#">Back to the board</a></p>'; return; }
    var f = factorsOf(r), c = CAL.categories[r.cat || 'Uncategorised'], fam = CAL.families[c.family], band = bandOf(r, f);
    var run = r.tvl, steps = [];
    function line(label, k, why) { run = run * k; steps.push('<tr><td>' + label + '<span class="why">' + why + '</span></td><td class="n mono">' + x(k) + '</td><td class="n mono">' + usd(run) + '</td></tr>'); }
    line('Category multiple', f.multiple, esc(r.cat || 'Uncategorised') + ': ' + (c.n ? 'median ' + x(c.median) + ' over ' + c.n + ' trading peer' + (c.n > 1 ? 's' : '') + ', ' : 'no trading peer, ') + 'shrunk toward ' + esc(c.family) + ' ' + x(fam.multiple) + ' (' + fam.n + ' peers)');
    line('Momentum', f.momentum, '7-day TVL change ' + (r.c7 === null ? 'unreported → neutral' : (r.c7 > 0 ? '+' : '') + r.c7.toFixed(2) + '% → 1 + 0.25·tanh(' + r.c7.toFixed(1) + '/20)'));
    line('Tokenless track record', f.track, f.age === null ? 'no listing date → 0.85' : f.age + ' days listed with no token recorded → 0.70 rising to 1.10 at 540 d' + (f.age > K.track_plateau_days ? ', easing after 3 y' : ''));
    line('Chain breadth', f.breadth, r.chains.length + ' chain' + (r.chains.length > 1 ? 's' : '') + ' → 0.97 + 0.055·ln(' + r.chains.length + '), cap 1.15');
    line('Size confidence', f.confidence, 'TVL ' + usd(r.tvl) + ' → 0.85 at $5M rising to 1.00 at $1B');
    if (r.lane === 'related') line('Related token haircut', f.related, 'a related token already trades, so most value may accrue to it');
    function byMcap(a, b) { return b[4] - a[4]; }
    var peers = D.peers.filter(function (p) { return (p[1] || 'Uncategorised') === (r.cat || 'Uncategorised'); }).sort(byMcap).slice(0, 3);
    D.peers.filter(function (p) { return familyOf(p[1]) === c.family && peers.indexOf(p) < 0; }).sort(byMcap).forEach(function (p) { if (peers.length < 3) peers.push(p); });
    var span = Math.log(r.hi * 1.6) - Math.log(r.lo / 1.6);
    function pos(v) { return ((Math.log(v) - Math.log(r.lo / 1.6)) / span * 100).toFixed(1) + '%'; }
    var p = r.plan;
    app.innerHTML = '<a class="back" href="#">← Back to the board</a>' +
      '<section class="panel"><div class="dhead"><div><h1>' + esc(r.name) + tag(r.lane) + '</h1>' +
      '<div class="facts">Rank <b>#' + r.rank + '</b> of ' + D.rows.length + ' · ' + esc(r.cat || 'Uncategorised') + ' · TVL <b>' + usd(r.tvl) + '</b> ' + pct(r.c7) + ' 7d · listed ' + esc(r.listed || 'n/a') + ' (' + age(r.age) + ' with no token recorded) · ' + esc(r.chains.slice(0, 6).join(', ')) + (r.chains.length > 6 ? ' +' + (r.chains.length - 6) : '') + '</div></div>' +
      '<div class="big' + (r.lane === 'related' ? ' rel' : '') + '"><b>' + usd(r.v) + '</b><span>implied value · band ' + usd(r.lo) + ' – ' + usd(r.hi) + '</span></div></div>' +
      (r.rel ? '<p class="note-rel">Related token: ' + esc(r.rel) + '. It stays on the board, haircut ×0.25 and flagged, and can be hidden with one filter.</p>' : '') + '</section>' +
      '<div class="dgrid"><section class="panel pad"><h3>Value breakdown</h3><table class="waterfall"><tbody>' +
      '<tr><td>TVL<span class="why">snapshot tvl_usd</span></td><td></td><td class="n mono">' + usd(r.tvl) + '</td></tr>' + steps.join('') +
      '<tr class="total"><td>Implied value</td><td></td><td class="n mono">' + usd(r.calc) + '</td></tr></tbody></table>' +
      '<div class="bandviz"><div class="axis"></div><div class="rng" style="left:' + pos(r.lo) + ';width:calc(' + pos(r.hi) + ' - ' + pos(r.lo) + ')"></div><div class="pt" style="left:' + pos(r.v) + '"></div></div>' +
      '<div class="bandlbl"><span>low ' + usd(r.lo) + '</span><span>band ±' + band[2].toFixed(2) + ' log (standard error of the ' + esc(r.cat || '') + ' multiple)</span><span>high ' + usd(r.hi) + '</span></div>' +
      '<p class="check">' + (r.calc === r.v ? '<span class="ok">✓</span> Recomputed in this page from the raw figures: ' + dollars(r.calc) + ', equal to board.json.' : '✗ Page computes ' + dollars(r.calc) + ', board.json says ' + dollars(r.v) + '.') + '</p>' +
      '<h3 style="margin-top:16px">Comparable tokens that trade</h3><table class="mini"><tbody>' +
      peers.map(function (q) { return '<tr><td>' + esc(q[0]) + ' <span class="tag trading">' + esc(q[2] || '') + '</span> <span class="sub">' + esc(q[1] || '') + ' · TVL ' + usd(q[3]) + '</span></td><td class="n mono">' + usd(q[4]) + ' mcap</td><td class="n mono">' + x(q[4] / q[3]) + '</td></tr>'; }).join('') +
      '</tbody></table></section>' +
      '<section class="panel"><div class="pad" style="padding-bottom:0"><h3>Farm plan · ' + esc(p.chain) + ' · ' + p.txs + ' transactions at ≈ ' + dollars(p.gas_per_tx) + '</h3>' +
      '<p class="perchain">Same plan, gas + fees by chain: ' + p.per_chain.map(function (q) { return '<span' + (q.chain === p.chain ? ' class="on"' : '') + '>' + esc(q.chain) + ' <b>' + dollars(q.total) + '</b></span>'; }).join('') + '</p></div>' +
      '<div class="totals"><div><span>Capital at work</span><b>' + dollars(p.capital) + '</b></div><div><span>Gas + fees, all in</span><b>' + dollars(p.fees_total) + '</b></div><div><span>Hands-on time</span><b>' + mins(p.hands_on_minutes) + '</b></div><div><span>Window</span><b>' + p.weeks + ' weeks</b></div></div>'+
      '<table class="steps"><thead><tr><th></th><th>Step</th><th class="n">Capital</th><th class="n">Gas / fees</th><th class="n">Time</th></tr></thead><tbody>' +
      p.steps.map(function (s, i) {
        return '<tr><td>' + (i + 1) + '</td><td><span class="lbl">' + esc(s.step) + '</span>' + esc(s.action) + '</td><td class="n">' + (s.capital ? dollars(s.capital) : '–') + '</td><td class="n">' + (s.fees ? dollars(s.fees) : '–') + '</td><td class="n">' + mins(s.minutes) + '<span class="sub">' + esc(s.span) + '</span></td></tr>';
      }).join('') + '</tbody></table>' +
      '</section></div>';
    window.scrollTo(0, 0);
  }

  function render() {
    readHash();
    document.body.classList.toggle('is-detail', !!S.p);
    if (S.p) detail(S.p);
    else if (S.view === 'trading') trading();
    else board();
  }
  window.addEventListener('hashchange', render);
  render();
})();
