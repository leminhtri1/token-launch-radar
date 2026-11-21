// Token Launch Radar, the page. Reads window.RADAR (data.js) and REFITS the whole model in the browser with
// model.js, the file main.ts ran; the integrity strip compares the refit with board.json. Views come from
// the hash: the board, #view=trading, #view=assume and one protocol (#p=slug).
(function () {
  'use strict';
  var D = window.RADAR, M = window.RadarModel, app = document.getElementById('app');
  if (!D || !M) { app.innerHTML = '<p class="empty">data.js or model.js is missing: run main.ts to write data.js beside dashboard/.</p>'; return; }
  var A = M.A;

  // == refit everything from the raw figures
  var FAM = {};
  Object.keys(D.families).forEach(function (f) { D.families[f].forEach(function (c) { FAM[c] = f; }); });
  function inp(slug, cat, tvl, c7, listed, nch) { return { slug: slug, cat: cat || 'Uncategorised', fam: (cat && FAM[cat]) || 'Other', tvl: tvl, c7: c7, age: M.ageDays(D.as_of, listed), nch: nch }; }
  var peers = D.peers.map(function (p) { var o = inp(p[0], p[2], p[4], p[6], p[7], p[8]); o.mcap = p[5]; o.name = p[1]; o.sym = p[3]; return o; });
  var pop = D.pop.map(function (p) { var o = inp(p[0], p[1], p[2], p[3], p[4], p[5]); o.tok = p[6]; return o; });
  var t0 = performance.now();
  var R = M.build({
    peers: peers, pop: pop,
    rows: D.rows.map(function (r) { var o = inp(r.slug, r.cat, r.tvl, r.c7, r.listed, r.chains.length); o.lane = r.lane; o.plan = r.plan; return o; })
  });
  var ms = performance.now() - t0, F = D.fit, V = R.value, med = R.ctx.med;
  D.rows.forEach(function (r, i) { r.m = R.rows[i]; r.vd = r.econ.verdict; r.mult = r.m.factors.slice(0, 5).reduce(function (a, k) { return a * k; }, 1); });

  // == integrity checks, live
  function r4(n) { return Math.round(n * 1e4) / 1e4; }
  var N = D.rows.length, byRank = D.rows.slice().sort(function (a, b) { return a.rank - b.rank; });
  var covered = D.watchlist.filter(function (w) { return D.rows.some(function (r) { return r.slug === w; }); }).length;
  var mono = byRank.every(function (r, i) { return r.rank === i + 1 && (!i || r.v <= byRank[i - 1].v); });
  var same = D.rows.filter(function (r) {
    var m = r.m;
    return m.v === r.v && m.lo === r.lo && m.hi === r.hi && m.odds === r.odds && m.ev === r.ev && m.econ.verdict === r.econ.verdict && m.econ.cost === r.econ.cost;
  }).length;
  var betaOk = V.beta.every(function (b, j) { return r4(b) === F.beta[j]; });
  function gasOf(c) { return (D.gas[c] || D.gas_default)[0]; }
  var costed = D.rows.filter(function (r) {
    var p = r.plan, s = 0;
    p.steps.forEach(function (x) { s += x.fees; });
    return p.steps.length >= 4 && Math.round(s * 100) / 100 === p.fees_total && p.gas_per_tx === gasOf(p.chain) && r4(p.fees_total + r.econ.opp) === r.econ.cost;
  }).length;
  function moved(k) { return D.rows.filter(function (r) { return Math.abs(r.m.factors[k] - 1) >= 0.02; }).length; }
  var nMom = moved(5), nTrk = moved(6);
  var kf = R.kfold, lc = R.loco, best = R.odds_best, v2 = R.cmp[0];
  var CHECKS = [
    [covered === D.watchlist.length && mono, 'Watchlist ' + covered + '/' + D.watchlist.length, 'all ranked · ranks 1–' + N + ' by value'],
    [same === N && betaOk, 'Refit = board ' + same + '/' + N, 'value · odds · verdict, refit in ' + (ms / 1000).toFixed(1) + ' s'],
    [nMom > 0 && nTrk > 0, 'TVL · 7d · age in value', 'momentum moves ' + nMom + ' rows ≥2%, track ' + nTrk],
    [kf.mdae < kf.base_mdae && lc.mdae < lc.base_mdae, 'Held-out ' + kf.mdae.toFixed(2) + ' vs ' + kf.base_mdae.toFixed(2), '|log err| vs naive · by category ' + lc.mdae.toFixed(2) + ' vs ' + lc.base_mdae.toFixed(2)],
    [best.auc > 0.5 && best.logloss < best.base_logloss, 'Odds AUC ' + best.auc.toFixed(2) + ' vs 0.50', 'held-out · log loss ' + best.logloss.toFixed(3) + ' vs ' + best.base_logloss.toFixed(3)],
    [costed === N, 'Costed plans ' + costed + '/' + N, 'steps sum to totals · one gas table']
  ];

  // == formatting
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function usd(n) {
    var a = Math.abs(n), s = n < 0 ? '−$' : '$';
    if (a >= 1e9) return s + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return s + (a / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
    if (a >= 1e4) return s + (a / 1e3).toFixed(0) + 'K';
    return s + (a >= 100 ? Math.round(a).toLocaleString('en-US') : a.toFixed(a >= 10 ? 0 : 2));
  }
  function pct(n) { return n === null ? '<span class="dim">n/a</span>' : '<span class="' + (n >= 0 ? 'up' : 'down') + '">' + (n > 0 ? '+' : '') + n.toFixed(1) + '%</span>'; }
  function age(d) { return d === null ? 'no date' : d >= 365 ? (d / 365).toFixed(1) + ' y' : d + ' d'; }
  function sg(n, d) { return (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(d === undefined ? 3 : d); }
  function od(n) { return Math.round(n * 100) + '%'; }
  function hrs(h) { return h.toFixed(1) + ' h'; }
  function xf(k, d) { return '×' + k.toFixed(d || 2); }
  function fx(k) { return '<span class="fx ' + (k > 1.0049 ? 'up' : k < 0.995 ? 'down' : '') + '">' + xf(k) + '</span>'; }
  var LANE = { watchlist: 'watchlist', early: 'early', related: 'related token' };
  function tag(l) { return '<span class="tag ' + l + '">' + LANE[l] + '</span>'; }
  function vtag(v) { return '<span class="vd ' + v + '">' + v + '</span>'; }
  function oddsBar(o) { return '<span class="ob"><i style="width:' + Math.round(o * 100) + '%"></i></span>' + od(o); }

  // == state in the hash
  var S;
  function readHash() {
    var h = new URLSearchParams(location.hash.replace(/^#/, ''));
    S = {
      p: h.get('p'), view: h.get('view') || 'board', q: h.get('q') || '', cat: h.get('cat') || '', chain: h.get('chain') || '',
      lane: h.get('lane') || 'all', vd: h.get('vd') || 'all', odds: +(h.get('odds') || 0), min: +(h.get('min') || 0),
      sort: h.get('sort') || 'rank', dir: +(h.get('dir') || 1)
    };
  }
  function writeHash() {
    var h = new URLSearchParams();
    if (S.view !== 'board') h.set('view', S.view);
    ['q', 'cat', 'chain'].forEach(function (k) { if (S[k]) h.set(k, S[k]); });
    if (S.lane !== 'all') h.set('lane', S.lane);
    if (S.vd !== 'all') h.set('vd', S.vd);
    if (S.odds) h.set('odds', S.odds);
    if (S.min) h.set('min', S.min);
    if (S.sort !== 'rank') { h.set('sort', S.sort); h.set('dir', S.dir); }
    history.replaceState(null, '', '#' + h.toString());
  }

  // == header and integrity strip
  var VC = { Farm: 0, Watch: 0, Skip: 0 }, LC = { watchlist: 0, early: 0, related: 0 };
  D.rows.forEach(function (r) { VC[r.vd]++; LC[r.lane]++; });
  document.getElementById('meta').innerHTML = '<span>Snapshot <b>' + esc(D.as_of) + '</b></span><span>DefiLlama · <b>' + D.universe + '</b> protocols</span><span>Model <b>' + esc(D.version) + '</b></span>';
  document.getElementById('checks').innerHTML = CHECKS.map(function (c) {
    return '<div class="chk ' + (c[0] ? 'ok' : 'bad') + '"><i>' + (c[0] ? '✓' : '✗') + '</i><b>' + c[1] + '</b><small>' + c[2] + '</small></div>';
  }).join('');
  document.getElementById('foot').textContent = 'Implied value is this radar’s claim of what a token would be worth if the protocol’s record stayed as it is; it does not predict whether or when one is issued. A row records no token in the snapshot, which is not proof it has none. Gas and airdrop shares are stated assumptions. Source: ' + D.source + '.';

  // == model panel (rail)
  var mr = [5, 6].map(function (k) { var xs = D.rows.map(function (r) { return r.m.factors[k]; }); return xf(Math.min.apply(null, xs)) + '–' + xf(Math.max.apply(null, xs)); });
  function modelPanel() {
    var P = V.prior, fl = R.flat, cmp = R.cmp, T = R.track;
    var cell = function (b, s, c) { return '<td class="n' + c + '">' + sg(b, 2) + '<span class="why">± ' + s.toFixed(2) + '</span></td>'; };
    var trow = function (n, j, pri) { return '<tr><td>' + n + '</td>' + (pri ? cell(pri[0], pri[1], '') : '<td class="n dim">flat</td>') + cell(fl.beta[j], fl.se[j], '') + cell(V.beta[j], V.se[j], ' good') + '</tr>'; };
    var hrow = function (n, a, b, c) { return '<tr' + (c ? ' class="good"' : '') + '><td>' + n + '</td><td class="n">' + a.toFixed(3) + '</td><td class="n">' + b.toFixed(3) + '</td></tr>'; };
    var dv = function (a, b) { return (a > b ? 'costs ' : 'gains ') + Math.abs(a - b).toFixed(3); };
    return '<aside class="rail"><div class="panel pad"><h3>Value model · ' + V.n + ' trading tokens</h3>' +
      '<div class="formula"><b>implied value</b> = TVL<br>× <em>fitted multiple</em><i>e^(a + b·ln TVL + c·ln chains + fam + cat)</i>× <em>momentum(7d)</em><i>e^(γ·tanh((7d − ' + med.toFixed(1) + '%) / 20))</i>× <em>track(days with no token)</em><i>e^(δ·(1 − e^(−days / 365)))</i></div>' +
      '<table class="mini coef"><thead><tr><th>coefficient</th><th class="n">prior</th><th class="n">data</th><th class="n">posterior</th></tr></thead><tbody>' +
      trow('a base', 0) + trow('b size', 1) + trow('c reach', 2) + trow('γ momentum', 3, P[0]) + trow('δ track', 4, P[1]) + '</tbody></table>' +
      '<p>Trading peers alone cannot pin γ and δ (their cap prices a token that exists), so each has a prior from the snapshot, weighed with the data by precision. <b>γ</b>: 4 more weeks of +20% over the median week at the fitted TVL elasticity ' + V.e.toFixed(2) + '. <b>δ</b>: a 3-year record lifts peer odds of a token from ' + od(T.p0) + ' to ' + od(T.p3) + '. Prior sd = half the mean. On the board momentum runs ' + mr[0] + ', track ' + mr[1] + '.</p>' +
      '<table class="mini"><thead><tr><th>held-out |log error|</th><th class="n">5-fold</th><th class="n">by cat.</th></tr></thead><tbody>' +
      hrow('<b>v3: every term</b>', kf.mdae, lc.mdae, 1) + hrow('v2: no momentum, no track', v2.kf, v2.lo) + hrow('v3 without momentum', cmp[1].kf, cmp[1].lo) + hrow('v3 without track', cmp[2].kf, cmp[2].lo) +
      hrow('data only, no priors', cmp[3].kf, cmp[3].lo) + hrow('naive: training median', kf.base_mdae, lc.base_mdae) + '</tbody></table>' +
      '<p>Median |log(mcap/TVL)| error on tokens each fit never saw. Against v2, v3 ' + dv(kf.mdae, v2.kf) + ' on 5-fold and ' + dv(lc.mdae, v2.lo) + ' by category; both stay well under naive.</p></div>' +
      '<div class="panel pad"><h3>Peer odds · logistic on ' + pop.length + ' protocols</h3><table class="mini"><tbody>' +
      M.OTERMS.map(function (t, j) { return '<tr><td>' + t + '</td><td class="n">' + sg(R.odds.b[j]) + '</td></tr>'; }).join('') +
      '</tbody></table><p>Plus ridge-shrunk family and category terms (λ ' + best.lambda + ' by 5-fold log loss). Out of fold: AUC <b>' + best.auc.toFixed(3) + '</b>, log loss ' + best.logloss.toFixed(3) + ' vs ' + best.base_logloss.toFixed(3) + ' for the base rate.</p></div>' +
      '<div class="panel pad"><h3>Verdict rule</h3><p>' + vtag('Farm') + ' net ≥ $' + A.farm_hour + '/h, payoff ≥ ' + A.farm_roi + '× cost, odds ≥ ' + od(A.farm_odds) + '<br>' + vtag('Watch') + ' positive but short of one bar, or a related token trades<br>' + vtag('Skip') + ' expected payoff below cost</p></div></aside>';
  }

  // == the board
  var COLS = [['rank', '#', 'rk'], ['name', 'Protocol', ''], ['tvl', 'TVL<small>× fitted multiple</small>', 'n'], ['c7', '7d<small>× momentum</small>', 'n'],
    ['age', 'No token for<small>× track</small>', 'n'], ['v', 'Implied value<small>50% band</small>', 'n'], ['odds', 'Peer odds', ''], ['ph', 'Farm verdict<small>cost · hours → net/h</small>', '']];
  function keyOf(r, k) {
    if (k === 'name') return r.name.toLowerCase();
    if (k === 'c7') return r.c7 === null ? -1e9 : r.c7;
    if (k === 'age') return r.age === null ? -1 : r.age;
    if (k === 'ph') return r.econ.per_hour;
    return r[k];
  }
  function filtered() {
    var q = S.q.toLowerCase();
    var rows = D.rows.filter(function (r) {
      return !(q && (r.name + ' ' + (r.cat || '') + ' ' + r.chains.join(' ')).toLowerCase().indexOf(q) < 0) &&
        !(S.cat && (r.cat || 'Uncategorised') !== S.cat) && !(S.chain && r.chains.indexOf(S.chain) < 0) &&
        !(S.lane !== 'all' && r.lane !== S.lane) && !(S.vd !== 'all' && r.vd !== S.vd) && !(S.odds && r.odds < S.odds) && !(S.min && r.tvl < S.min);
    });
    var k = S.sort, d = S.dir;
    return rows.sort(function (a, b) { var x = keyOf(a, k), y = keyOf(b, k); return x < y ? -d : x > y ? d : a.rank - b.rank; });
  }
  function rowHtml(r) {
    var e = r.econ, f = r.m.factors;
    return '<tr class="ln-' + r.lane + '" data-slug="' + esc(r.slug) + '"><td class="rk">' + r.rank + '</td>' +
      '<td><span class="pname">' + esc(r.name) + '</span>' + tag(r.lane) + '<span class="sub">' + esc(r.cat || 'Uncategorised') + ' · ' + esc(r.chains.slice(0, 2).join(', ')) + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') + '</span></td>' +
      '<td class="n">' + usd(r.tvl) + '<span class="sub">' + xf(r.mult, 3) + '</span></td><td class="n">' + pct(r.c7) + '<span class="sub">' + fx(f[5]) + '</span></td><td class="n">' + age(r.age) + '<span class="sub">' + fx(f[6]) + '</span></td>' +
      '<td class="n"><span class="val">' + usd(r.v) + '</span><span class="sub">' + usd(r.lo) + ' – ' + usd(r.hi) + (f[7] < 1 ? ' · ×' + A.related + ' related' : '') + '</span></td>' +
      '<td class="odds">' + oddsBar(r.odds) + '</td>' +
      '<td>' + vtag(r.vd) + '<span class="sub mono">' + usd(e.cost) + ' · ' + hrs(e.hours) + ' → ' + usd(e.per_hour) + '/h</span></td></tr>';
  }
  function opts(list, cur, all) {
    return '<option value="">' + all + '</option>' + list.map(function (v) { return '<option' + (v === cur ? ' selected' : '') + ' value="' + esc(v) + '">' + esc(v) + '</option>'; }).join('');
  }
  function counted(get) {
    var c = {};
    D.rows.forEach(function (r) { [].concat(get(r)).forEach(function (v) { c[v] = (c[v] || 0) + 1; }); });
    return Object.keys(c).sort(function (a, b) { return c[b] - c[a] || (a < b ? -1 : 1); });
  }
  var CATS = counted(function (r) { return r.cat || 'Uncategorised'; }), CHAINS = counted(function (r) { return r.chains; }).slice(0, 40);
  var MINS = [[0, 'Any TVL'], [10e6, 'TVL ≥ $10M'], [25e6, 'TVL ≥ $25M'], [50e6, 'TVL ≥ $50M'], [100e6, 'TVL ≥ $100M']];
  var ODDS = [[0, 'Any odds'], [0.25, 'Odds ≥ 25%'], [0.5, 'Odds ≥ 50%'], [0.75, 'Odds ≥ 75%']];
  function sel(id, list, cur) { return '<select id="' + id + '">' + list.map(function (m) { return '<option value="' + m[0] + '"' + (m[0] === cur ? ' selected' : '') + '>' + m[1] + '</option>'; }).join('') + '</select>'; }
  function seg(key, list) { return '<span class="seg" data-k="' + key + '">' + list.map(function (l) { return '<button data-v="' + l[0] + '" class="' + (S[key] === l[0] ? 'on' : '') + '">' + l[1] + '</button>'; }).join('') + '</span>'; }

  function tabs() {
    return '<div class="tabs">' + [['board', 'Pre-token board · ' + N], ['trading', 'Already trading · ' + peers.length], ['assume', 'Assumptions']].map(function (t) {
      return '<button data-view="' + t[0] + '" class="' + (S.view === t[0] ? 'on' : '') + '">' + t[1] + '</button>';
    }).join('') + '<span class="note" id="note"></span></div>';
  }
  function legend() {
    return '<div class="legend"><span class="lg early"><b>Pre-token · ' + (LC.watchlist + LC.early) + '</b>records no token: ' + LC.watchlist + ' watchlist, ' + LC.early + ' early finds</span>' +
      '<span class="lg related"><b>Related token · ' + LC.related + '</b>a same-name token trades: value ×' + A.related + ', capped at Watch</span>' +
      '<a class="lg trading" href="#view=trading"><b>Already trading · ' + peers.length + '</b>not ranked: their caps fit the multiple →</a></div>';
  }
  function active() {
    var a = [S.lane !== 'all' && LANE[S.lane], S.vd !== 'all' && S.vd, S.odds && 'odds ≥ ' + od(S.odds), S.cat && esc(S.cat), S.chain && esc(S.chain), S.min && 'TVL ≥ ' + usd(S.min), S.q && '“' + esc(S.q) + '”',
      S.sort !== 'rank' && 'sorted by ' + COLS.filter(function (c) { return c[0] === S.sort; })[0][1].split('<')[0] + (S.dir > 0 ? ' ↑' : ' ↓')].filter(Boolean);
    return a.length ? '<span class="chips">Filtered: ' + a.map(function (t) { return '<b>' + t + '</b>'; }).join('') + '</span> <a href="#">Reset</a>' : '';
  }
  function board() {
    app.innerHTML = '<div class="layout"><section class="panel">' + tabs() + legend() +
      '<div class="filters"><input type="search" id="q" placeholder="Search name, category, chain" value="' + esc(S.q) + '">' +
      '<select id="cat">' + opts(CATS, S.cat, 'All categories') + '</select><select id="chain">' + opts(CHAINS, S.chain, 'All chains') + '</select>' +
      sel('min', MINS, S.min) + sel('odds', ODDS, S.odds) +
      seg('lane', [['all', 'All lanes'], ['watchlist', 'Watchlist'], ['early', 'Early'], ['related', 'Related']]) +
      seg('vd', [['all', 'All'], ['Farm', 'Farm · ' + VC.Farm], ['Watch', 'Watch · ' + VC.Watch], ['Skip', 'Skip · ' + VC.Skip]]) +
      '<span class="count" id="count"></span></div>' +
      '<table class="board"><thead><tr>' + COLS.map(function (c) {
        var on = S.sort === c[0], l = c[1].split('<small>');
        return '<th data-k="' + c[0] + '" class="' + c[2] + (on ? ' on' : '') + '">' + l[0] + (on ? (S.dir > 0 ? ' ↑' : ' ↓') : '') + (l[1] ? '<small>' + l[1] : '') + '</th>';
      }).join('') + '</tr></thead><tbody id="rows"></tbody></table></section>' + modelPanel() + '</div>';
    body();
    bind();
  }
  function body() {
    var rows = filtered(), sum = 0;
    rows.forEach(function (r) { sum += r.v; });
    document.getElementById('rows').innerHTML = rows.length ? rows.map(rowHtml).join('') : '<tr><td colspan="8" class="empty">No protocol matches these filters.</td></tr>';
    document.getElementById('note').innerHTML = active() || 'value = TVL × multiple × momentum (7d vs the ' + med.toFixed(1) + '% median week) × track · click a row';
    document.getElementById('count').textContent = rows.length + ' of ' + N + ' · ' + usd(sum) + ' implied';
  }
  function bind() {
    function set(k, v) { S[k] = v; writeHash(); body(); }
    var g = function (id) { return document.getElementById(id); };
    g('q').addEventListener('input', function (e) { set('q', e.target.value.trim()); });
    ['cat', 'chain'].forEach(function (k) { g(k).addEventListener('change', function (e) { set(k, e.target.value); }); });
    ['min', 'odds'].forEach(function (k) { g(k).addEventListener('change', function (e) { set(k, +e.target.value); }); });
    app.querySelectorAll('.seg button').forEach(function (b) { b.addEventListener('click', function () { S[b.parentNode.dataset.k] = b.dataset.v; writeHash(); board(); }); });
    app.querySelectorAll('table.board th').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.dataset.k;
        if (S.sort === k) S.dir = -S.dir; else { S.sort = k; S.dir = (k === 'rank' || k === 'name') ? 1 : -1; }
        writeHash(); board();
      });
    });
    g('rows').addEventListener('click', function (e) { var tr = e.target.closest('tr[data-slug]'); if (tr) location.hash = 'p=' + encodeURIComponent(tr.dataset.slug); });
    bindTabs();
  }
  function bindTabs() {
    app.querySelectorAll('.tabs button').forEach(function (b) { b.addEventListener('click', function () { S.view = b.dataset.view; writeHash(); render(); }); });
  }

  // == tokens that trade: the fit's own test set
  function trading() {
    var pred = {};
    kf.slug.forEach(function (s, i) { pred[s] = kf.pred[i]; });
    var list = peers.slice().sort(function (a, b) { return b.mcap - a.mcap; });
    app.innerHTML = '<div class="layout"><section class="panel">' + tabs() +
      '<p class="lead">Not ranked: these tokens trade. They train the value fit; the held-out column is what the model gave each one with its fold hidden.</p>' +
      '<table><thead><tr><th>Protocol</th><th>Category</th><th class="n">TVL</th><th class="n">Market cap</th><th class="n">mcap / TVL</th><th class="n">Held-out fit</th><th class="n">Error</th></tr></thead><tbody>' +
      list.map(function (p) {
        var y = Math.log(p.mcap / p.tvl), e = y - pred[p.slug];
        return '<tr class="ln-trading"><td><span class="pname">' + esc(p.name) + '</span><span class="tag trading">' + esc(p.sym || 'token') + '</span></td><td>' + esc(p.cat) + '</td><td class="n">' + usd(p.tvl) + '</td><td class="n">' + usd(p.mcap) + '</td><td class="n">' + xf(Math.exp(y), 3) + '</td><td class="n">' + xf(Math.exp(pred[p.slug]), 3) + '</td><td class="n ' + (Math.abs(e) <= Math.LN2 ? 'good' : '') + '">' + sg(e, 2) + '</td></tr>';
      }).join('') + '</tbody></table></section>' + modelPanel() + '</div>';
    bindTabs();
  }

  // == stated assumptions
  function assume() {
    var chains = Object.keys(D.gas).sort(function (a, b) { return D.gas[b][0] - D.gas[a][0] || (a < b ? -1 : 1); });
    var rows = [
      ['Momentum prior', A.mom_weeks + ' more weeks of the week’s excess growth, at the fitted TVL elasticity; sd ' + A.prior_sd * 100 + '% of the mean'],
      ['Track prior', 'ln(peer odds at ' + A.track_ref / 365 + ' years ÷ at day 0), per unit of 1 − e^(−days/' + A.track_days + '); sd ' + A.prior_sd * 100 + '% of the mean'],
      ['Opportunity cost of capital', (A.opp_rate * 100) + '% a year on the capital, over the plan’s weeks'],
      ['Community allocation', (A.share[0] * 100) + '% / ' + (A.share[1] * 100) + '% / ' + (A.share[2] * 100) + '% of implied value (low / mid / high)'],
      ['Farmers sharing it', 'TVL ÷ $' + A.deposit.toLocaleString('en-US') + ' average deposit, at least ' + A.min_farmers.toLocaleString('en-US')],
      ['Your weight', (A.flat * 100) + '% of the pool split flat per farmer, the rest pro rata to capital ÷ TVL'],
      ['Related-token haircut', '×' + A.related + ' when a same-name token already trades']
    ];
    app.innerHTML = '<div class="layout"><section class="panel">' + tabs() + '<div class="agrid"><div class="pad"><h3>Model and farm assumptions</h3><table class="mini"><tbody>' +
      rows.map(function (r) { return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>'; }).join('') + '</tbody></table>' +
      '<h3 class="gap">Left off the board</h3><table class="mini"><tbody>' + D.excluded.map(function (e) { return '<tr><td>' + esc(e.reason) + ' <span class="dim">' + esc(e.examples.slice(0, 3).join(', ')) + '</span></td><td class="n">' + e.count + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      '<div class="pad"><h3>Gas per chain · assumption, not snapshot data</h3><table class="mini"><thead><tr><th>Chain</th><th class="n">$ per tx</th><th class="n">$ to fund</th><th class="n">rows</th></tr></thead><tbody>' +
      chains.map(function (c) { return '<tr><td>' + esc(c) + '</td><td class="n">' + D.gas[c][0] + '</td><td class="n">' + D.gas[c][1] + '</td><td class="n">' + D.rows.filter(function (r) { return r.plan.chain === c; }).length + '</td></tr>'; }).join('') +
      '<tr><td>any other chain</td><td class="n">' + D.gas_default[0] + '</td><td class="n">' + D.gas_default[1] + '</td><td></td></tr></tbody></table></div></div></section>' + modelPanel() + '</div>';
    bindTabs();
  }

  // == one protocol
  function detail(slug) {
    var r = D.rows.filter(function (q) { return q.slug === slug; })[0];
    if (!r) { app.innerHTML = '<p class="empty">No protocol ' + esc(slug) + ' on this board. <a href="#">Back to the board</a></p>'; return; }
    var m = r.m, t = m.terms, e = m.econ, pl = r.plan, f = m.factors, st = m.steps, b = V.beta, cat = r.cat || 'Uncategorised';
    var cg = V.cat.groups[cat], fg = V.fam.groups[r.fam];
    // TVL to implied value: one factor a line, the dollars after it and what it added
    var walk = [
      ['base multiple', 'e<sup>a</sup>, a = ' + sg(b[0], 2)],
      ['size', 'b·ln(' + usd(r.tvl) + ' / $100M) = ' + sg(b[1], 2) + ' × ' + sg(t.x[1], 2)],
      ['reach', 'c·ln ' + r.chains.length + ' chain' + (r.chains.length > 1 ? 's' : '') + ' = ' + sg(b[2], 2) + ' × ' + t.x[2].toFixed(2)],
      ['family: ' + esc(r.fam), fg ? fg.n + ' peers, EB weight ' + fg.w.toFixed(2) : 'no trading peer'],
      ['category: ' + esc(cat), cg ? cg.n + ' peer' + (cg.n > 1 ? 's' : '') + ', mean residual ' + sg(cg.mean, 2) + ' × EB ' + cg.w.toFixed(2) : 'no trading peer: global fit'],
      ['momentum(7d)', r.c7 === null ? 'no 7-day figure: neutral' : 'γ·tanh((' + sg(r.c7, 1) + '% − ' + med.toFixed(1) + '%)/20) = ' + sg(b[3], 2) + ' × ' + sg(t.x[3], 2)],
      ['track(no token)', r.age === null ? 'no listing date: neutral' : 'δ·(1 − e<sup>−' + r.age + '/365</sup>) = ' + sg(b[4], 2) + ' × ' + t.x[4].toFixed(2)],
      ['related token', 'a same-name token trades']
    ];
    var prev = r.tvl, wrows = '<tr><td>TVL<span class="why">snapshot, ' + esc(D.as_of) + '</span></td><td></td><td class="n">' + usd(r.tvl) + '</td><td></td></tr>';
    walk.forEach(function (w, i) {
      if (i === 7 && f[7] === 1) return;
      wrows += '<tr class="' + (i === 5 || i === 6 ? 'key' : '') + '"><td>× ' + w[0] + '<span class="why">' + w[1] + '</span></td><td class="n">' + xf(f[i], 3) + '</td><td class="n">' + usd(st[i]) + '</td><td class="n ' + (st[i] >= prev ? 'up' : 'down') + '">' + (Math.abs(st[i] - prev) < 1 ? '–' : (st[i] > prev ? '+' : '−') + usd(Math.abs(st[i] - prev))) + '</td></tr>';
      if (i === 4) wrows += '<tr class="mid"><td>= TVL × fitted multiple</td><td class="n">' + xf(r.mult, 4) + '</td><td class="n">' + usd(st[4]) + '</td><td></td></tr>';
      prev = st[i];
    });
    var ob = R.odds.b, d = R.odds.d, od6 = M.xo({ tvl: r.tvl, c7: r.c7, age: r.age, nch: r.chains.length }).map(function (v, j) { return v * ob[j]; });
    var fi = d.fams.indexOf(r.fam), ci = d.cats.indexOf(cat);
    var oo = (fi < 0 ? 0 : ob[6 + fi]) + (ci < 0 ? 0 : ob[6 + d.fams.length + ci]), logit = od6.reduce(function (a, v) { return a + v; }, 0) + oo;
    var cost = [['Gas and fees, ' + pl.txs + ' txs on ' + esc(pl.chain), usd(pl.fees_total)], ['Capital idle: ' + usd(pl.capital) + ' × ' + (A.opp_rate * 100) + '% × ' + pl.weeks + '/52', usd(e.opp)], ['<b>Total cost</b>', '<b>' + usd(e.cost) + '</b>'], ['Hands-on time · calendar', hrs(e.hours) + ' · ' + pl.weeks + ' wk']];
    var pay = [['Pool: ' + (A.share[1] * 100) + '% of ' + usd(r.v), usd(r.v * A.share[1])], ['Farmers: max(' + A.min_farmers + ', TVL ÷ $' + A.deposit / 1000 + 'K)', e.farmers.toLocaleString('en-US')],
      ['Your weight: ½ ÷ farmers + ½ × ' + usd(pl.capital) + ' ÷ TVL', (e.weight * 1e6).toFixed(2) + ' ppm'], ['Drop if a token comes (low · mid · high)', usd(e.drop[0]) + ' · <b>' + usd(e.drop[1]) + '</b> · ' + usd(e.drop[2])],
      ['× peer odds ' + od(r.odds) + ' = expected', usd(e.ev)], ['Net of cost', usd(e.net)], ['Per hour · per $1k capital', usd(e.per_hour) + ' · ' + usd(e.per_1k)]];
    function kv(list) { return list.map(function (x) { return '<tr><td>' + x[0] + '</td><td class="n">' + x[1] + '</td></tr>'; }).join(''); }
    app.innerHTML = '<a class="back" href="#">← Back to the board</a>' +
      '<section class="panel ln-' + r.lane + '"><div class="dhead"><div><h1>' + esc(r.name) + tag(r.lane) + '</h1>' +
      '<div class="facts">Rank <b>#' + r.rank + '</b> of ' + N + ' · ' + esc(cat) + ' · TVL <b>' + usd(r.tvl) + '</b> · ' + pct(r.c7) + ' in 7 days · <b>' + age(r.age) + '</b> with no token recorded (listed ' + esc(r.listed || 'n/a') + ') · ' + esc(r.chains.slice(0, 4).join(', ')) + (r.chains.length > 4 ? ' +' + (r.chains.length - 4) : '') + '</div></div>' +
      '<div class="stats"><div class="big"><b>' + usd(r.v) + '</b><span>implied value · 50% band ' + usd(r.lo) + '–' + usd(r.hi) + '</span></div>' +
      '<div><b>' + od(r.odds) + '</b><span>peer odds</span></div><div><b>' + usd(r.ev) + '</b><span>odds × value</span></div><div>' + vtag(r.vd) + '<span>' + esc(e.why) + '</span></div></div></div>' +
      (r.rel ? '<p class="note-rel">Related token: ' + esc(r.rel) + '. It stays on the board at ×' + A.related + ' and is capped at Watch.</p>' : '') + '</section>' +
      '<div class="dgrid"><section class="panel pad"><h3>TVL to implied value, one term a line</h3>' +
      '<div class="formula">' + usd(r.tvl) + ' TVL × ' + xf(r.mult, 4) + ' multiple × ' + xf(f[5], 3) + ' momentum × ' + xf(f[6], 3) + ' track' + (f[7] < 1 ? ' × ' + A.related + ' related' : '') + ' = <em>' + usd(r.v) + '</em></div>' +
      '<table class="mini walk"><thead><tr><th>term</th><th class="n">factor</th><th class="n">value after</th><th class="n">adds</th></tr></thead><tbody>' + wrows +
      '<tr class="total"><td>Implied value<span class="why">held-out bands: 50% ' + usd(r.lo) + '–' + usd(r.hi) + '</span></td><td></td><td class="n">$' + m.v.toLocaleString('en-US') + '</td><td></td></tr></tbody></table>' +
      '<p class="check">' + (m.v === r.v ? '<span class="good">✓</span> Refit in this page equals board.json.' : '✗ Page computes $' + m.v + ', board.json says $' + r.v + '.') + '</p>' +
      '<h3 class="gap">Peer odds, term by term</h3><p class="check">' + M.OTERMS.map(function (n, j) { return sg(od6[j], 2) + ' ' + n; }).join(' · ') + ' · ' + sg(oo, 2) + ' family and category = logit ' + sg(logit, 2) + ' → <b class="good">' + od(r.odds) + '</b></p>' +
      '</section><section class="panel"><div class="pad"><h3>Farm verdict · the math</h3><div class="vgrid"><table class="mini"><tbody>' + kv(cost) + '</tbody></table><table class="mini"><tbody>' + kv(pay) + '</tbody></table></div>' +
      '<p class="verdict">' + vtag(r.vd) + ' ' + esc(e.why) + '. Farm needs ≥ $' + A.farm_hour + '/h, ≥ ' + A.farm_roi + '× cost and odds ≥ ' + od(A.farm_odds) + '.</p></div>' +
      '<table class="steps"><thead><tr><th></th><th>Step · ' + esc(pl.chain) + ' at ≈ $' + pl.gas_per_tx + ' a tx</th><th class="n">Capital</th><th class="n">Gas / fees</th><th class="n">Time</th></tr></thead><tbody>' +
      pl.steps.map(function (s, i) {
        return '<tr><td>' + (i + 1) + '</td><td><span class="lbl">' + esc(s.step) + '</span>' + esc(s.action) + '</td><td class="n">' + (s.capital ? usd(s.capital) : '–') + '</td><td class="n">' + (s.fees ? usd(s.fees) : '–') + '<span class="sub">' + s.txs + ' tx</span></td><td class="n">' + s.minutes + ' min<span class="sub">' + esc(s.span) + '</span></td></tr>';
      }).join('') + '<tr class="tot"><td></td><td>Total · ' + pl.txs + ' transactions</td><td class="n">' + usd(pl.capital) + '</td><td class="n">' + usd(pl.fees_total) + '</td><td class="n">' + hrs(e.hours) + '<span class="sub">' + pl.weeks + ' weeks</span></td></tr></tbody></table></section></div>';
    window.scrollTo(0, 0);
  }

  function render() {
    readHash();
    document.body.classList.toggle('is-detail', !!S.p);
    if (S.p) detail(S.p);
    else if (S.view === 'trading') trading();
    else if (S.view === 'assume') assume();
    else board();
  }
  window.addEventListener('hashchange', render);
  render();
})();
