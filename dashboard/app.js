// Token Launch Radar, the page. Reads window.RADAR (data.js, written beside dashboard/ by main.ts), then
// REFITS the whole model in the browser with model.js, the same file main.ts ran: the value regression,
// its two held-out tests, the odds logistic and every verdict. The integrity strip compares what this
// page computed with what board.json ranks by. Views come from the hash: the board (#lane=..&vd=..),
// the tokens that trade (#view=trading), the stated assumptions (#view=assume) and one protocol (#p=slug).
(function () {
  'use strict';
  var D = window.RADAR, M = window.RadarModel, app = document.getElementById('app');
  if (!D || !M) { app.innerHTML = '<p class="empty">data.js or model.js is missing: run main.ts to write data.js beside dashboard/.</p>'; return; }
  var A = M.A;

  // ------------------------------------------------------------ refit everything from the raw figures
  var FAM = {};
  Object.keys(D.families).forEach(function (f) { D.families[f].forEach(function (c) { FAM[c] = f; }); });
  function famOf(c) { return (c && FAM[c]) || 'Other'; }
  function inp(slug, cat, tvl, c7, listed, nch) { return { slug: slug, cat: cat || 'Uncategorised', fam: famOf(cat), tvl: tvl, c7: c7, age: M.ageDays(D.as_of, listed), nch: nch }; }
  var peers = D.peers.map(function (p) { var o = inp(p[0], p[2], p[4], p[6], p[7], p[8]); o.mcap = p[5]; o.name = p[1]; o.sym = p[3]; return o; });
  var pop = D.pop.map(function (p) { var o = inp(p[0], p[1], p[2], p[3], p[4], p[5]); o.tok = p[6]; return o; });
  var t0 = performance.now();
  var R = M.build({
    peers: peers, pop: pop,
    rows: D.rows.map(function (r) { var o = inp(r.slug, r.cat, r.tvl, r.c7, r.listed, r.chains.length); o.lane = r.lane; o.plan = r.plan; return o; })
  });
  var ms = performance.now() - t0, F = D.fit;
  D.rows.forEach(function (r, i) { r.m = R.rows[i]; r.vd = r.econ.verdict; });

  // ------------------------------------------------------------ integrity checks, live
  function r4(n) { return Math.round(n * 1e4) / 1e4; }
  function r2(n) { return Math.round(n * 100) / 100; }
  var N = D.rows.length, byRank = D.rows.slice().sort(function (a, b) { return a.rank - b.rank; });
  var covered = D.watchlist.filter(function (w) { return D.rows.some(function (r) { return r.slug === w; }); }).length;
  var mono = byRank.every(function (r, i) { return r.rank === i + 1 && (!i || r.v <= byRank[i - 1].v); });
  var same = D.rows.filter(function (r) {
    var m = r.m;
    return m.v === r.v && m.lo === r.lo && m.hi === r.hi && m.odds === r.odds && m.ev === r.ev && m.econ.verdict === r.econ.verdict && m.econ.cost === r.econ.cost;
  }).length;
  var betaOk = R.value.beta.every(function (b, j) { return r4(b) === F.beta[j]; });
  function gasOf(c) { return (D.gas[c] || D.gas_default)[0]; }
  var costed = D.rows.filter(function (r) {
    var p = r.plan, s = 0;
    p.steps.forEach(function (x) { s += x.fees; });
    return p.steps.length >= 4 && r2(s) === p.fees_total && p.gas_per_tx === gasOf(p.chain) && r4(p.fees_total + r.econ.opp) === r.econ.cost;
  }).length;
  var kf = R.kfold, lc = R.loco, best = R.odds_best;
  var CHECKS = [
    [covered === D.watchlist.length, 'Watchlist ' + covered + '/' + D.watchlist.length, 'every house-list slug ranked'],
    [mono, 'Ranks 1–' + N + ' monotone', 'value never rises with rank'],
    [same === N && betaOk, 'Refit = board ' + same + '/' + N, 'value · odds · EV · verdict, refit in ' + (ms / 1000).toFixed(1) + ' s'],
    [kf.mdae < kf.base_mdae && lc.mdae < lc.base_mdae, 'Held-out ' + kf.mdae.toFixed(2) + ' vs ' + kf.base_mdae.toFixed(2), '|log err| vs naive, 5-fold · by category ' + lc.mdae.toFixed(2) + ' vs ' + lc.base_mdae.toFixed(2)],
    [best.auc > 0.5 && best.logloss < best.base_logloss, 'Odds AUC ' + best.auc.toFixed(2) + ' vs 0.50', 'held-out · log loss ' + best.logloss.toFixed(3) + ' vs ' + best.base_logloss.toFixed(3)],
    [costed === N, 'Costed plans ' + costed + '/' + N, 'steps sum to totals · one gas table']
  ];

  // ------------------------------------------------------------ formatting
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function usd(n) {
    var a = Math.abs(n), s = n < 0 ? '−$' : '$';
    if (a >= 1e9) return s + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return s + (a / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
    if (a >= 1e4) return s + (a / 1e3).toFixed(0) + 'K';
    return s + (a >= 100 ? Math.round(a).toLocaleString('en-US') : a.toFixed(a >= 10 ? 0 : 2));
  }
  function pct(n) { return n === null ? '<span class="sub">n/a</span>' : '<span class="' + (n >= 0 ? 'up' : 'down') + '">' + (n > 0 ? '+' : '') + n.toFixed(1) + '%</span>'; }
  function age(d) { return d === null ? 'no date' : d >= 365 ? (d / 365).toFixed(1) + ' y' : d + ' d'; }
  function sg(n, d) { return (n >= 0 ? '+' : '−') + Math.abs(n).toFixed(d === undefined ? 3 : d); }
  function od(n) { return Math.round(n * 100) + '%'; }
  function hrs(h) { return h.toFixed(1) + ' h'; }
  var LANE = { watchlist: 'watchlist', early: 'early', related: 'related token' };
  function tag(l) { return '<span class="tag ' + l + '">' + LANE[l] + '</span>'; }
  function vtag(v) { return '<span class="vd ' + v + '">' + v + '</span>'; }
  function oddsBar(o) { return '<span class="ob"><i style="width:' + Math.round(o * 100) + '%"></i></span>' + od(o); }

  // ------------------------------------------------------------ state in the hash
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

  // ------------------------------------------------------------ header and integrity strip
  var VC = { Farm: 0, Watch: 0, Skip: 0 };
  D.rows.forEach(function (r) { VC[r.vd]++; });
  document.getElementById('meta').innerHTML = '<span>Snapshot <b>' + esc(D.as_of) + '</b></span><span>DefiLlama · <b>' + D.universe + '</b> protocols</span><span>Model <b>' + esc(D.version) + '</b></span>';
  document.getElementById('checks').innerHTML = CHECKS.map(function (c) {
    return '<div class="chk ' + (c[0] ? 'ok' : 'bad') + '"><i>' + (c[0] ? '✓' : '✗') + '</i><b>' + c[1] + '</b><small>' + c[2] + '</small></div>';
  }).join('');
  document.getElementById('foot').textContent = 'Implied value is this radar’s claim of what a token would be worth if the protocol’s record stayed as it is: TVL times the market-cap/TVL multiple the snapshot’s trading tokens imply. It does not predict whether or when a token is issued; peer odds say how often protocols like this one record a token. A row records no token in the snapshot, which is not proof it has none. Gas costs and airdrop shares are stated assumptions (Assumptions tab). Source: ' + D.source + '.';

  // ------------------------------------------------------------ model panel (rail)
  function modelPanel() {
    var b = R.value, ab = R.ablate;
    var cats = Object.keys(b.cat.groups).map(function (k) { return [k, b.cat.groups[k]]; }).sort(function (x, y) { return Math.abs(y[1].u) - Math.abs(x[1].u); }).slice(0, 4);
    return '<aside class="rail"><div class="panel pad"><h3>Value model · fit on ' + b.n + ' trading tokens</h3>' +
      '<div class="formula">log(mcap/TVL) = β·x + <em>u_fam</em> + <em>u_cat</em><br>implied value = TVL × e<sup>fit</sup></div>' +
      '<table class="mini coef"><thead><tr><th>term x</th><th class="n">β</th><th class="n">± se</th><th class="n">toggled</th></tr></thead><tbody>' +
      M.PARTS.map(function (t, j) {
        var on = !b.off[j], a = j ? ab[j - 1] : null, mid = j === 6 ? '<td class="n" colspan="2">' + (on ? 'τ² ' + b.cat.tau2.toFixed(2) + ' · σ² ' + b.cat.sigma2.toFixed(2) : 'dropped') + '</td>' : on ? '<td class="n">' + sg(b.beta[j]) + '</td><td class="n">' + b.se[j].toFixed(3) + '</td>' : '<td class="n" colspan="2">dropped</td>';
        return '<tr class="' + (on ? '' : 'off') + '"><td>' + esc(t) + '</td>' + mid + '<td class="n">' + (a ? a.mdae.toFixed(3) : '') + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<p><b>toggled</b> = 5-fold error with that term removed, or added back if dropped. Backward elimination: ' + R.path.map(function (s, i) { return (i ? 'drop ' : '') + esc(s[0]) + ' <b>' + s[1].toFixed(3) + '</b>'; }).join(' → ') + '; a term stays only if dropping it raises held-out error. ' +
      (b.off[2] && b.off[3] ? '7-day growth and tokenless time did not predict peers’ multiples, so they move the odds and odds × value, not the value. ' : '') +
      'Empirical-Bayes weight of a category with 1 peer: <b>' + (b.cat.tau2 / (b.cat.tau2 + b.cat.sigma2)).toFixed(2) + '</b>, so one token cannot carry a category. Largest: ' +
      cats.map(function (c) { return esc(c[0]) + ' ' + sg(c[1].u, 2) + ' (n ' + c[1].n + ')'; }).join(', ') + '.</p>' +
      '<table class="mini"><thead><tr><th>held-out</th><th class="n">model</th><th class="n">naive</th><th class="n">ρ</th><th class="n">≤×2</th></tr></thead><tbody>' +
      [['5-fold (picked the terms)', kf], ['leave one category out', lc]].map(function (h) {
        return '<tr><td>' + h[0] + '</td><td class="n good">' + h[1].mdae.toFixed(3) + '</td><td class="n">' + h[1].base_mdae.toFixed(3) + '</td><td class="n">' + h[1].rho.toFixed(2) + '</td><td class="n">' + od(h[1].within2) + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<p>Median absolute error of log(mcap/TVL) on tokens the fit never saw; naive = the training median. Band = 25th–75th percentile of those held-out errors (×' + Math.exp(R.band[0]).toFixed(2) + ' to ×' + Math.exp(R.band[1]).toFixed(2) + ').</p></div>' +
      '<div class="panel pad"><h3>Peer odds · logistic on ' + pop.length + ' protocols</h3><table class="mini"><tbody>' +
      ['intercept', 'ln TVL', 'tanh(7d / 20)', 'ln(1 + years listed)', 'no listing date', 'ln chains'].map(function (t, j) { return '<tr><td>' + t + '</td><td class="n">' + sg(R.odds.b[j]) + '</td></tr>'; }).join('') +
      '</tbody></table><p>Plus ridge-shrunk family and category terms (λ ' + best.lambda + ' by 5-fold log loss). Out of fold: AUC <b>' + best.auc.toFixed(3) + '</b>, log loss ' + best.logloss.toFixed(3) + ' vs ' + best.base_logloss.toFixed(3) + ' for the base rate. ' + (R.odds.b[2] < 0 ? 'Growing' : 'Falling') + ' TVL and ' + (R.odds.b[3] > 0 ? 'fewer' : 'more') + ' years listed make a token less common so far.</p></div>' +
      '<div class="panel pad"><h3>Verdict rule</h3><p>' + vtag('Farm') + ' net ≥ $' + A.farm_hour + '/h, payoff ≥ ' + A.farm_roi + '× cost, odds ≥ ' + od(A.farm_odds) + '<br>' + vtag('Watch') + ' positive but short of one bar, or a related token trades<br>' + vtag('Skip') + ' expected payoff below cost</p></div></aside>';
  }

  // ------------------------------------------------------------ the board
  var COLS = [['rank', '#', 'rk'], ['name', 'Protocol', ''], ['tvl', 'TVL', 'n'], ['c7', '7d', 'n'], ['age', 'Tokenless', 'n'],
    ['v', 'Implied value · 50% band', 'n'], ['odds', 'Peer odds', ''], ['ev', 'Odds × value', 'n'], ['ph', 'Farm verdict', '']];
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
    var e = r.econ;
    return '<tr data-slug="' + esc(r.slug) + '"><td class="rk">' + r.rank + '</td>' +
      '<td><span class="pname">' + esc(r.name) + '</span>' + tag(r.lane) + '<span class="sub">' + esc(r.cat || 'Uncategorised') + ' · ' + esc(r.chains.slice(0, 2).join(', ')) + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') + '</span></td>' +
      '<td class="n">' + usd(r.tvl) + '</td><td class="n">' + pct(r.c7) + '</td><td class="n">' + age(r.age) + '</td>' +
      '<td class="n"><span class="val">' + usd(r.v) + '</span><span class="band">' + usd(r.lo) + ' – ' + usd(r.hi) + ' · ×' + Math.exp(r.y).toFixed(3) + '</span></td>' +
      '<td class="odds">' + oddsBar(r.odds) + '</td><td class="n">' + usd(r.ev) + '</td>' +
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
  function active() {
    var a = [];
    if (S.lane !== 'all') a.push(LANE[S.lane]);
    if (S.vd !== 'all') a.push(S.vd);
    if (S.odds) a.push('odds ≥ ' + od(S.odds));
    if (S.cat) a.push(esc(S.cat));
    if (S.chain) a.push(esc(S.chain));
    if (S.min) a.push('TVL ≥ ' + usd(S.min));
    if (S.q) a.push('“' + esc(S.q) + '”');
    if (S.sort !== 'rank') a.push('sorted by ' + COLS.filter(function (c) { return c[0] === S.sort; })[0][1] + (S.dir > 0 ? ' ↑' : ' ↓'));
    return a.length ? '<span class="chips">Filtered: ' + a.map(function (t) { return '<b>' + t + '</b>'; }).join('') + '</span> <a href="#">Reset</a>' : '';
  }
  function board() {
    app.innerHTML = '<div class="layout"><section class="panel">' + tabs() +
      '<div class="filters"><input type="search" id="q" placeholder="Search name, category, chain" value="' + esc(S.q) + '">' +
      '<select id="cat">' + opts(CATS, S.cat, 'All categories') + '</select><select id="chain">' + opts(CHAINS, S.chain, 'All chains') + '</select>' +
      sel('min', MINS, S.min) + sel('odds', ODDS, S.odds) +
      seg('lane', [['all', 'All lanes'], ['watchlist', 'Watchlist'], ['early', 'Early'], ['related', 'Related']]) +
      seg('vd', [['all', 'All verdicts'], ['Farm', 'Farm · ' + VC.Farm], ['Watch', 'Watch · ' + VC.Watch], ['Skip', 'Skip · ' + VC.Skip]]) +
      '<span class="count" id="count"></span></div>' +
      '<table class="board"><thead><tr>' + COLS.map(function (c) {
        return '<th data-k="' + c[0] + '" class="' + c[2] + '"' + (S.sort === c[0] ? ' aria-sort="' + (S.dir > 0 ? 'ascending' : 'descending') + '"' : '') + '>' + c[1] + '</th>';
      }).join('') + '</tr></thead><tbody id="rows"></tbody></table></section>' + modelPanel() + '</div>';
    body();
    bind();
  }
  function body() {
    var rows = filtered(), sum = 0;
    rows.forEach(function (r) { sum += r.v; });
    document.getElementById('rows').innerHTML = rows.length ? rows.map(rowHtml).join('') : '<tr><td colspan="9" class="empty">No protocol matches these filters.</td></tr>';
    document.getElementById('note').innerHTML = active() || 'Ranked by implied value. Click a row for its fitted terms, odds and farm math.';
    document.getElementById('count').textContent = rows.length + ' of ' + N + ' rows · ' + usd(sum) + ' implied';
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

  // ------------------------------------------------------------ tokens that trade: the fit's own test set
  function trading() {
    var pred = {};
    kf.slug.forEach(function (s, i) { pred[s] = kf.pred[i]; });
    var list = peers.slice().sort(function (a, b) { return b.mcap - a.mcap; });
    app.innerHTML = '<div class="layout"><section class="panel">' + tabs() +
      '<p class="lead">Not ranked: these tokens trade. They are the value fit’s training data, and each one’s held-out column is the multiple the model gave it when its fold was hidden.</p>' +
      '<table><thead><tr><th>Protocol</th><th>Category</th><th class="n">TVL</th><th class="n">Market cap</th><th class="n">mcap / TVL</th><th class="n">Held-out fit</th><th class="n">Error</th></tr></thead><tbody>' +
      list.map(function (p) {
        var y = Math.log(p.mcap / p.tvl), e = y - pred[p.slug];
        return '<tr><td><span class="pname">' + esc(p.name) + '</span><span class="tag trading">' + esc(p.sym || 'token') + '</span></td><td>' + esc(p.cat) + '</td><td class="n">' + usd(p.tvl) + '</td><td class="n">' + usd(p.mcap) + '</td><td class="n">×' + Math.exp(y).toFixed(3) + '</td><td class="n">×' + Math.exp(pred[p.slug]).toFixed(3) + '</td><td class="n ' + (Math.abs(e) <= Math.LN2 ? 'good' : '') + '">' + sg(e, 2) + '</td></tr>';
      }).join('') + '</tbody></table></section>' + modelPanel() + '</div>';
    bindTabs();
  }

  // ------------------------------------------------------------ stated assumptions
  function assume() {
    var chains = Object.keys(D.gas).sort(function (a, b) { return D.gas[b][0] - D.gas[a][0] || (a < b ? -1 : 1); });
    var rows = [
      ['Opportunity cost of capital', (A.opp_rate * 100) + '% a year on the capital, over the plan’s weeks'],
      ['Community allocation', (A.share[0] * 100) + '% / ' + (A.share[1] * 100) + '% / ' + (A.share[2] * 100) + '% of implied value (low / mid / high)'],
      ['Farmers sharing it', 'TVL ÷ $' + A.deposit.toLocaleString('en-US') + ' average deposit, at least ' + A.min_farmers.toLocaleString('en-US')],
      ['Your weight', (A.flat * 100) + '% of the pool split flat per farmer, the rest pro rata to capital ÷ TVL'],
      ['Related-token haircut', '×' + A.related + ' when a same-name token already trades'],
      ['Odds', 'peer odds stand in for the chance a token comes; they are a base rate, not a forecast'],
      ['Folds', A.folds + ' folds by FNV-1a hash of the slug; no clock, no randomness']
    ];
    app.innerHTML = '<div class="layout"><section class="panel">' + tabs() + '<div class="agrid"><div class="pad"><h3>Farm economics · assumptions</h3><table class="mini"><tbody>' +
      rows.map(function (r) { return '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td></tr>'; }).join('') + '</tbody></table>' +
      '<h3 class="gap">Left off the board</h3><table class="mini"><tbody>' + D.excluded.map(function (e) { return '<tr><td>' + esc(e.reason) + ' <span class="sub">' + esc(e.examples.slice(0, 3).join(', ')) + '</span></td><td class="n">' + e.count + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      '<div class="pad"><h3>Gas per chain · assumption, not snapshot data</h3><table class="mini"><thead><tr><th>Chain</th><th class="n">$ per tx</th><th class="n">$ to fund</th><th class="n">rows</th></tr></thead><tbody>' +
      chains.map(function (c) { return '<tr><td>' + esc(c) + '</td><td class="n">' + D.gas[c][0] + '</td><td class="n">' + D.gas[c][1] + '</td><td class="n">' + D.rows.filter(function (r) { return r.plan.chain === c; }).length + '</td></tr>'; }).join('') +
      '<tr><td>any other chain</td><td class="n">' + D.gas_default[0] + '</td><td class="n">' + D.gas_default[1] + '</td><td></td></tr></tbody></table></div></div></section>' + modelPanel() + '</div>';
    bindTabs();
  }

  // ------------------------------------------------------------ one protocol
  function detail(slug) {
    var r = D.rows.filter(function (q) { return q.slug === slug; })[0];
    if (!r) { app.innerHTML = '<p class="empty">No protocol ' + esc(slug) + ' on this board. <a href="#">Back to the board</a></p>'; return; }
    var m = r.m, t = m.terms, e = m.econ, pl = r.plan, cg = R.value.cat.groups[r.cat || 'Uncategorised'], fg = R.value.fam.groups[r.fam];
    var off = R.value.off, vrow = M.TERMS.map(function (name, j) { return '<tr class="' + (off[j] ? 'off' : '') + '"><td>' + esc(name) + '</td><td class="n">' + t.x[j].toFixed(3) + '</td><td class="n">' + (off[j] ? 'dropped' : sg(R.value.beta[j])) + '</td><td class="n">' + sg(t.parts[j]) + '</td></tr>'; }).join('');
    vrow += '<tr><td>family: ' + esc(r.fam) + '<span class="why">' + (fg ? fg.n + ' peers, EB weight ' + fg.w.toFixed(2) : 'no trading peer') + '</span></td><td></td><td></td><td class="n">' + sg(t.fam) + '</td></tr>';
    vrow += '<tr><td>category: ' + esc(r.cat || 'Uncategorised') + '<span class="why">' + (cg ? cg.n + ' peer' + (cg.n > 1 ? 's' : '') + ', mean residual ' + sg(cg.mean, 2) + ' × EB weight ' + cg.w.toFixed(2) : 'no trading peer: stays on the global fit') + '</span></td><td></td><td></td><td class="n">' + sg(t.cat) + '</td></tr>';
    var lr = r.lane === 'related' ? A.related : 1;
    var ob = R.odds.b, od6 = t.x.map(function (v, j) { return v * ob[j]; }), d = R.odds.d;
    var fi = d.fams.indexOf(r.fam), ci = d.cats.indexOf(r.cat || 'Uncategorised');
    var of = fi < 0 ? 0 : ob[6 + fi], oc = ci < 0 ? 0 : ob[6 + d.fams.length + ci], logit = od6.reduce(function (a, v) { return a + v; }, 0) + of + oc;
    var cats = peers.filter(function (p) { return p.cat === (r.cat || 'Uncategorised'); }).slice(0, 3);
    var cost = [['Gas and fees, ' + pl.txs + ' txs on ' + esc(pl.chain), usd(pl.fees_total)], ['Capital idle: ' + usd(pl.capital) + ' × ' + (A.opp_rate * 100) + '% × ' + pl.weeks + '/52', usd(e.opp)], ['<b>Total cost</b>', '<b>' + usd(e.cost) + '</b>'], ['Hands-on time', hrs(e.hours)]];
    var pay = [['Pool: ' + (A.share[1] * 100) + '% of ' + usd(r.v), usd(r.v * A.share[1])], ['Farmers: max(' + A.min_farmers + ', TVL ÷ $' + A.deposit / 1000 + 'K)', e.farmers.toLocaleString('en-US')],
      ['Your weight: ½ ÷ farmers + ½ × ' + usd(pl.capital) + ' ÷ TVL', (e.weight * 1e6).toFixed(2) + ' ppm'], ['Drop if a token comes (low · mid · high)', usd(e.drop[0]) + ' · <b>' + usd(e.drop[1]) + '</b> · ' + usd(e.drop[2])],
      ['× peer odds ' + od(r.odds) + ' = expected', usd(e.ev)], ['Net of cost', usd(e.net)], ['Per hour · per $1k capital', usd(e.per_hour) + ' · ' + usd(e.per_1k)]];
    function kv(list) { return list.map(function (x) { return '<tr><td>' + x[0] + '</td><td class="n">' + x[1] + '</td></tr>'; }).join(''); }
    app.innerHTML = '<a class="back" href="#">← Back to the board</a>' +
      '<section class="panel"><div class="dhead"><div><h1>' + esc(r.name) + tag(r.lane) + '</h1>' +
      '<div class="facts">Rank <b>#' + r.rank + '</b> of ' + N + ' · ' + esc(r.cat || 'Uncategorised') + ' · TVL <b>' + usd(r.tvl) + '</b> ' + pct(r.c7) + ' 7d · listed ' + esc(r.listed || 'n/a') + ' (' + age(r.age) + ' with no token recorded) · ' + esc(r.chains.slice(0, 5).join(', ')) + (r.chains.length > 5 ? ' +' + (r.chains.length - 5) : '') + '</div></div>' +
      '<div class="stats"><div class="big"><b>' + usd(r.v) + '</b><span>implied value · 50% band ' + usd(r.lo) + '–' + usd(r.hi) + '</span></div>' +
      '<div><b>' + od(r.odds) + '</b><span>peer odds</span></div><div><b>' + usd(r.ev) + '</b><span>odds × value</span></div><div>' + vtag(r.vd) + '<span>' + esc(e.why) + '</span></div></div></div>' +
      (r.rel ? '<p class="note-rel">Related token: ' + esc(r.rel) + '. It stays on the board at ×' + A.related + ' and is flagged.</p>' : '') + '</section>' +
      '<div class="dgrid"><section class="panel pad"><h3>Implied value, term by term</h3><table class="mini coef"><thead><tr><th>term</th><th class="n">x</th><th class="n">β</th><th class="n">β·x</th></tr></thead><tbody>' + vrow +
      '<tr class="total"><td>log multiple → ×' + Math.exp(t.y).toFixed(4) + (lr < 1 ? ' × ' + lr + ' related' : '') + ' × TVL ' + usd(r.tvl) + '</td><td></td><td></td><td class="n">' + sg(t.y) + '</td></tr>' +
      '<tr class="total"><td>Implied value<span class="why">bands from held-out errors: 50% ' + usd(r.lo) + '–' + usd(r.hi) + ' · 80% ' + usd(r.v * Math.exp(R.band80[0])) + '–' + usd(r.v * Math.exp(R.band80[1])) + '</span></td><td></td><td></td><td class="n">' + usd(m.v) + '</td></tr></tbody></table>' +
      '<p class="check">' + (m.v === r.v ? '<span class="good">✓</span> Refit in this page: $' + m.v.toLocaleString('en-US') + ', equal to board.json.' : '✗ Page computes $' + m.v + ', board.json says $' + r.v + '.') + '</p>' +
      '<h3 class="gap">Peer odds, term by term</h3><table class="mini"><tbody>' +
      ['intercept', 'ln TVL / $100M', 'tanh(7d / 20)', 'ln(1 + years listed)', 'no listing date', 'ln chains'].map(function (n, j) { return '<tr><td>' + n + '</td><td class="n">' + sg(od6[j]) + '</td></tr>'; }).join('') +
      '<tr><td>family + category terms</td><td class="n">' + sg(of + oc) + '</td></tr><tr class="total"><td>logit ' + sg(logit) + ' → odds</td><td class="n">' + od(r.odds) + '</td></tr></tbody></table>' +
      (cats.length ? '<h3 class="gap">Trading peers in ' + esc(r.cat) + '</h3><table class="mini"><tbody>' + cats.map(function (p) { return '<tr><td>' + esc(p.name) + ' <span class="tag trading">' + esc(p.sym || '') + '</span><span class="why">TVL ' + usd(p.tvl) + ' · mcap ' + usd(p.mcap) + '</span></td><td class="n">×' + (p.mcap / p.tvl).toFixed(3) + '</td></tr>'; }).join('') + '</tbody></table>' : '') +
      '</section><section class="panel"><div class="pad"><h3>Farm verdict · the math</h3><div class="vgrid"><table class="mini"><tbody>' + kv(cost) + '</tbody></table><table class="mini"><tbody>' + kv(pay) + '</tbody></table></div>' +
      '<p class="verdict">' + vtag(r.vd) + ' ' + esc(e.why) + '. Farm needs ≥ $' + A.farm_hour + '/h, ≥ ' + A.farm_roi + '× cost and odds ≥ ' + od(A.farm_odds) + '.</p></div>' +
      '<table class="steps"><thead><tr><th></th><th>Step · ' + esc(pl.chain) + ' at ≈ $' + pl.gas_per_tx + ' a tx</th><th class="n">Capital</th><th class="n">Gas / fees</th><th class="n">Time</th></tr></thead><tbody>' +
      pl.steps.map(function (s, i) {
        return '<tr><td>' + (i + 1) + '</td><td><span class="lbl">' + esc(s.step) + '</span>' + esc(s.action) + '</td><td class="n">' + (s.capital ? usd(s.capital) : '–') + '</td><td class="n">' + (s.fees ? usd(s.fees) : '–') + '</td><td class="n">' + s.minutes + ' min<span class="sub">' + esc(s.span) + '</span></td></tr>';
      }).join('') + '</tbody></table></section></div>';
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
