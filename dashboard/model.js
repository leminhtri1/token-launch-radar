// Token Launch Radar: the value model, the peer token-odds model and the farm economics.
// main.ts runs this file to write board.json; the page runs it again on data.js and checks every number
// against the board. Nothing here names a protocol. No clock, no randomness: folds come from a slug hash.
//
// VALUE  implied value = TVL × fitted multiple × momentum(7d) × track(days with no token)
//        multiple = exp(a + b·ln(TVL/$100M) + c·ln chains + family + category), least squares on the
//          trading tokens; family/category effects = peers' mean residual × n·τ²/(n·τ² + σ²).
//        momentum = exp(γ·tanh((7d − median 7d)/20)); track = exp(δ·(1 − e^(−days/365))).
//        γ and δ sit in the same regression under a normal prior each (posterior = precision-weighted
//        prior and data), because trading peers alone cannot pin them. γ0 = 4 more weeks of the growth at
//        the fitted TVL elasticity; δ0 = ln(odds of a token at 3 years ÷ at day 0) from the odds model.
//        Prior sd = half the prior mean. Band = 25th..75th pct of held-out residuals. Tested 5-fold and
//        leave-one-category-out against the naive median and the v2 fit (no momentum, no track).
// ODDS   P(protocol records a token): logistic on every non-CEX protocol, ridge-shrunk family and
//        category terms, ridge picked by 5-fold log loss.
// FARM   cost = gas + fees + capital × 5%/yr; payoff = implied × community share × your weight × odds.
(function () {
  'use strict';

  /** Stated assumptions: transforms, priors' shape, fold counts and farm economics. */
  var A = {
    mom_scale: 20, mom_weeks: 4, mom_ref: 20, track_days: 365, track_ref: 1095, prior_sd: 0.5,
    folds: 5, backfit: 10, irls: 25, lambdas: [0.5, 2, 8, 32],
    related: 0.25, band: [0.25, 0.75],
    opp_rate: 0.05, share: [0.05, 0.10, 0.15], deposit: 25000, min_farmers: 1000, flat: 0.5,
    farm_hour: 40, farm_roi: 3, farm_odds: 0.2
  };

  // == numerics
  function sum(xs) { var s = 0; for (var i = 0; i < xs.length; i++) s += xs[i]; return s; }
  function sorted(xs) { return xs.slice().sort(function (a, b) { return a - b; }); }
  function quantile(xs, q) { var a = sorted(xs), p = (a.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p); return a[lo] + (a[hi] - a[lo]) * (p - lo); }
  function median(xs) { return quantile(xs, 0.5); }
  function r4(n) { return Math.round(n * 1e4) / 1e4; }
  function fnv(s) { var h = 2166136261; for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h; }
  function foldOf(slug) { return fnv(slug) % A.folds; }
  /** Whole days from listed_at to the snapshot's as_of (null when DefiLlama gives no date). */
  function ageDays(asOf, listed) {
    if (!listed) return null;
    var d = Math.floor((Date.parse(asOf + 'T00:00:00Z') - Date.parse(listed + 'T00:00:00Z')) / 86400000);
    return isFinite(d) ? Math.max(0, d) : null;
  }

  /** Solve M·x = b by Gaussian elimination with partial pivoting (M is small and symmetric). */
  function solve(M, b) {
    var n = b.length, a = M.map(function (r, i) { return r.concat([b[i]]); });
    for (var c = 0; c < n; c++) {
      var p = c;
      for (var r = c + 1; r < n; r++) if (Math.abs(a[r][c]) > Math.abs(a[p][c])) p = r;
      var t = a[c]; a[c] = a[p]; a[p] = t;
      for (r = c + 1; r < n; r++) { var f = a[r][c] / a[c][c]; for (var k = c; k <= n; k++) a[r][k] -= f * a[c][k]; }
    }
    var x = new Array(n).fill(0);
    for (r = n - 1; r >= 0; r--) { var s = a[r][n]; for (k = r + 1; k < n; k++) s -= a[r][k] * x[k]; x[r] = s / a[r][r]; }
    return x;
  }
  /** Normal-prior least squares: (X'X + diag(R)) b = X'y + R·mu, the posterior mean. */
  function gram(X, R) { var p = R.length; return R.map(function (r, j) { var row = new Array(p).fill(0); X.forEach(function (x) { for (var k = 0; k < p; k++) row[k] += x[j] * x[k]; }); row[j] += r; return row; }); }
  function dot(a, b) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
  /** Ranks, ties sharing their mean rank (for AUC). */
  function ranks(xs) {
    var idx = xs.map(function (x, i) { return i; }).sort(function (a, b) { return xs[a] - xs[b]; }), r = new Array(xs.length);
    for (var i = 0; i < idx.length;) { var j = i; while (j + 1 < idx.length && xs[idx[j + 1]] === xs[idx[i]]) j++; for (var k = i; k <= j; k++) r[idx[k]] = (i + j) / 2 + 1; i = j + 1; }
    return r;
  }

  // == value features
  var TERMS = ['base multiple', 'size: ln(TVL / $100M)', 'reach: ln chains', 'momentum: tanh(Δ7d / 20)', 'track: 1 − e^(−days/365)'];
  var MOM = 3, TRK = 4;
  /** Days with no token as a saturating record: 0 at launch, 0.63 at a year, 0.95 at three. */
  function rec(d) { return d === null ? 0 : 1 - Math.exp(-d / A.track_days); }
  /** p = {tvl, c7, age, nch}; med = the snapshot's median 7-day change. */
  function xv(p, med) {
    return [1, Math.log(p.tvl / 1e8), Math.log(Math.max(1, p.nch)), p.c7 === null ? 0 : Math.tanh((p.c7 - med) / A.mom_scale), rec(p.age)];
  }

  /** Empirical-Bayes group effects of residuals r by key: shrunk group means and the fitted tau². */
  function eb(r, keys) {
    var g = {}, N = r.length, i;
    for (i = 0; i < N; i++) { var e = g[keys[i]] || (g[keys[i]] = { n: 0, s: 0, ss: 0 }); e.n++; e.s += r[i]; e.ss += r[i] * r[i]; }
    var names = Object.keys(g).sort(), G = names.length, mean = sum(r) / N, sw = 0, sb = 0, n2 = 0;
    names.forEach(function (k) { var e = g[k]; e.m = e.s / e.n; sw += e.ss - e.n * e.m * e.m; sb += e.n * (e.m - mean) * (e.m - mean); n2 += e.n * e.n; });
    var s2 = N > G ? sw / (N - G) : sum(r.map(function (v) { return v * v; })) / N;
    var t2 = G > 1 ? Math.max(0, (sb - (G - 1) * s2) / (N - n2 / N)) : 0;
    var out = {};
    names.forEach(function (k) { var e = g[k], w = t2 > 0 ? e.n * t2 / (e.n * t2 + s2) : 0; out[k] = { n: e.n, mean: e.m, w: w, u: w * e.m }; });
    return { groups: out, tau2: t2, sigma2: s2 };
  }

  /** Fit on peers {cat, fam, tvl, mcap, c7, age, nch}; mode 'post' (with priors), 'flat' (data alone), 'v2', 'nomom', 'notrk'. */
  function fitValue(peers, ctx, mode) {
    var X = peers.map(function (p) { return xv(p, ctx.med); }), y = peers.map(function (p) { return Math.log(p.mcap / p.tvl); });
    var fk = peers.map(function (p) { return p.fam; }), ck = peers.map(function (p) { return p.cat; });
    var mu = [0, 0, 0, 0, 0], prec = [0, 0, 0, 0, 0], prior = null, e = null;
    if (mode !== 'flat') {
      if (mode !== 'v2') {
        // γ's prior needs the TVL elasticity: fit the v2 terms first on these same peers
        e = 1 + fitValue(peers, ctx, 'v2').beta[1];
        var g0 = A.mom_weeks * e * Math.log(1 + A.mom_ref / 100) / Math.tanh(A.mom_ref / A.mom_scale);
        prior = [[g0, Math.abs(g0) * A.prior_sd], [ctx.d0, Math.abs(ctx.d0) * A.prior_sd]];
        mu[MOM] = g0; mu[TRK] = ctx.d0; prec[MOM] = 1 / (prior[0][1] * prior[0][1]); prec[TRK] = 1 / (prior[1][1] * prior[1][1]);
      }
      if (mode === 'v2' || mode === 'nomom') { mu[MOM] = 0; prec[MOM] = 1e12; }
      if (mode === 'v2' || mode === 'notrk') { mu[TRK] = 0; prec[TRK] = 1e12; }
    }
    var uf = y.map(function () { return 0; }), uc = uf.slice(), s2 = sum(y.map(function (v) { return v * v; })) / y.length, beta, F, C, R, i;
    for (var it = 0; it < A.backfit; it++) {
      R = prec.map(function (q) { return q >= 1e12 ? 1e12 : q * s2 + 1e-9; });
      var yy = y.map(function (v, j) { return v - uf[j] - uc[j]; }), rhs = R.map(function (r, j) { return r * mu[j]; });
      X.forEach(function (x, n) { for (var j = 0; j < 5; j++) rhs[j] += x[j] * yy[n]; });
      beta = solve(gram(X, R), rhs);
      var r = y.map(function (v, j) { return v - dot(X[j], beta); });
      F = eb(r, fk);
      C = eb(r.map(function (v, j) { return v - F.groups[fk[j]].u; }), ck);
      for (i = 0; i < y.length; i++) { uf[i] = F.groups[fk[i]].u; uc[i] = C.groups[ck[i]].u; }
      s2 = C.sigma2;
    }
    // posterior sd: sigma² × diag((X'X + R)^-1), one solve per term
    var G = gram(X, R), se = TERMS.map(function (t, j) { var u = new Array(5).fill(0); u[j] = 1; return Math.sqrt(s2 * solve(G, u)[j]); });
    return { beta: beta, se: se, fam: F, cat: C, n: peers.length, mode: mode, prior: prior, e: e };
  }
  /** Fitted log multiple and its parts for a protocol {tvl, c7, age, nch, fam, cat}. */
  function predict(fit, p, med) {
    var x = xv(p, med), parts = x.map(function (v, j) { return v * fit.beta[j]; });
    var f = fit.fam.groups[p.fam], c = fit.cat.groups[p.cat];
    var uf = f ? f.u : 0, uc = c ? c.u : 0;
    return { x: x, parts: parts, fam: uf, cat: uc, y: sum(parts) + uf + uc };
  }

  /** Hide each split in turn, fit the rest, score the hidden peers against the naive median. */
  function holdout(peers, split, ctx, mode) {
    var y = [], yh = [], yb = [], slug = [];
    var keys = peers.map(split), names = keys.filter(function (k, i) { return keys.indexOf(k) === i; }).sort();
    names.forEach(function (k) {
      var train = peers.filter(function (p, i) { return keys[i] !== k; }), test = peers.filter(function (p, i) { return keys[i] === k; });
      if (!train.length) return;
      var fit = fitValue(train, ctx, mode), base = median(train.map(function (p) { return Math.log(p.mcap / p.tvl); }));
      test.forEach(function (p) { slug.push(p.slug); y.push(Math.log(p.mcap / p.tvl)); yh.push(predict(fit, p, ctx.med).y); yb.push(base); });
    });
    var e = y.map(function (v, i) { return v - yh[i]; }), e0 = y.map(function (v, i) { return v - yb[i]; });
    return {
      n: y.length, folds: names.length, mdae: r4(median(e.map(Math.abs))), base_mdae: r4(median(e0.map(Math.abs))), slug: slug, resid: e, pred: yh
    };
  }

  // == odds: does a protocol like this record a token?
  var OTERMS = ['intercept', 'ln TVL / $100M', 'tanh(7d / 20)', 'ln(1 + years listed)', 'no listing date', 'ln chains'];
  function xo(p) {
    return [1, Math.log(p.tvl / 1e8), p.c7 === null ? 0 : Math.tanh(p.c7 / A.mom_scale),
      p.age === null ? 0 : Math.log(1 + p.age / 365), p.age === null ? 1 : 0, Math.log(Math.max(1, p.nch))];
  }
  function oddsDesign(pop) {
    var fams = [], cats = [];
    pop.forEach(function (p) { if (fams.indexOf(p.fam) < 0) fams.push(p.fam); if (cats.indexOf(p.cat) < 0) cats.push(p.cat); });
    fams.sort(); cats.sort();
    return { fams: fams, cats: cats, p: 6 + fams.length + cats.length };
  }
  function oddsRow(d, p) {
    var fi = d.fams.indexOf(p.fam), ci = d.cats.indexOf(p.cat);
    return { dense: xo(p), fi: fi < 0 ? -1 : 6 + fi, ci: ci < 0 ? -1 : 6 + d.fams.length + ci };
  }
  function eta(b, row) { return dot(row.dense, b.slice(0, 6)) + (row.fi >= 0 ? b[row.fi] : 0) + (row.ci >= 0 ? b[row.ci] : 0); }
  function sigm(z) { return 1 / (1 + Math.exp(-z)); }
  /** Penalised logistic regression by IRLS on sparse rows (6 dense terms + one family + one category). */
  function fitOdds(pop, lambda) {
    var d = oddsDesign(pop), rows = pop.map(function (p) { return oddsRow(d, p); }), P = d.p, b = new Array(P).fill(0), it, i, j, k;
    for (it = 0; it < A.irls; it++) {
      var M = [], v = new Array(P).fill(0);
      for (j = 0; j < P; j++) { M.push(new Array(P).fill(0)); M[j][j] = j < 6 ? 1e-4 : lambda; }
      for (i = 0; i < rows.length; i++) {
        var row = rows[i], z = eta(b, row), pr = sigm(z), W = Math.max(1e-6, pr * (1 - pr)), zz = z + (pop[i].tok - pr) / W;
        var idx = [0, 1, 2, 3, 4, 5], val = row.dense.slice();
        if (row.fi >= 0) { idx.push(row.fi); val.push(1); }
        if (row.ci >= 0) { idx.push(row.ci); val.push(1); }
        for (j = 0; j < idx.length; j++) { v[idx[j]] += W * val[j] * zz; for (k = 0; k < idx.length; k++) M[idx[j]][idx[k]] += W * val[j] * val[k]; }
      }
      b = solve(M, v);
    }
    return { d: d, b: b, lambda: lambda };
  }
  function oddsOf(fit, p) { return sigm(eta(fit.b, oddsRow(fit.d, p))); }
  function auc(pr, t) {
    var r = ranks(pr), np = 0, sr = 0;
    for (var i = 0; i < t.length; i++) if (t[i]) { np++; sr += r[i]; }
    var nn = t.length - np;
    return np && nn ? (sr - np * (np + 1) / 2) / (np * nn) : 0.5;
  }
  function logloss(pr, t) { return -sum(t.map(function (v, i) { var q = Math.min(1 - 1e-9, Math.max(1e-9, pr[i])); return v ? Math.log(q) : Math.log(1 - q); })) / t.length; }
  function oddsCV(pop, lambda) {
    var pr = new Array(pop.length), base = new Array(pop.length);
    for (var k = 0; k < A.folds; k++) {
      var train = pop.filter(function (p) { return foldOf(p.slug) !== k; });
      var fit = fitOdds(train, lambda), rate = sum(train.map(function (p) { return p.tok; })) / train.length;
      pop.forEach(function (p, i) { if (foldOf(p.slug) === k) { pr[i] = oddsOf(fit, p); base[i] = rate; } });
    }
    var t = pop.map(function (p) { return p.tok; });
    return { lambda: lambda, auc: r4(auc(pr, t)), logloss: r4(logloss(pr, t)), base_logloss: r4(logloss(base, t)) };
  }
  /** δ's prior: log of how much a three-year record raises the mean odds of carrying a token, per unit of track. */
  function trackPrior(ofit, pop) {
    function at(d) { return sum(pop.map(function (p) { return oddsOf(ofit, { tvl: p.tvl, c7: p.c7, age: d, nch: p.nch, fam: p.fam, cat: p.cat }); })) / pop.length; }
    var p0 = at(0), p3 = at(A.track_ref);
    return { p0: p0, p3: p3, d0: Math.log(p3 / p0) / rec(A.track_ref) };
  }

  // == farm economics
  /** r = {tvl, v, lo, hi, odds, lane, plan: {capital, fees_total, hands_on_minutes, weeks}}. */
  function econ(r) {
    var pl = r.plan, opp = pl.capital * A.opp_rate * pl.weeks / 52, cost = pl.fees_total + opp, hours = pl.hands_on_minutes / 60;
    var farmers = Math.max(A.min_farmers, r.tvl / A.deposit);
    var weight = A.flat / farmers + (1 - A.flat) * pl.capital / r.tvl;
    var drop = [r.lo * A.share[0] * weight, r.v * A.share[1] * weight, r.hi * A.share[2] * weight];
    var ev = r.odds * drop[1], net = ev - cost, roi = cost > 0 ? ev / cost : 0, perHour = net / hours;
    var verdict, why;
    if (net <= 0) { verdict = 'Skip'; why = 'expected $' + Math.round(ev) + ' is below its $' + Math.round(cost) + ' cost'; }
    else if (perHour >= A.farm_hour && roi >= A.farm_roi && r.odds >= A.farm_odds && r.lane !== 'related') { verdict = 'Farm'; why = 'pays $' + Math.round(perHour) + '/h at ' + roi.toFixed(1) + '× its cost, ' + Math.round(r.odds * 100) + '% peer odds'; }
    else {
      verdict = 'Watch';
      why = perHour < A.farm_hour ? 'positive, but $' + Math.round(perHour) + '/h is under $' + A.farm_hour + '/h'
        : roi < A.farm_roi ? 'positive, but only ' + roi.toFixed(1) + '× its cost'
        : r.odds < A.farm_odds ? 'peer odds ' + Math.round(r.odds * 100) + '% are under ' + Math.round(A.farm_odds * 100) + '%'
        : 'positive, but a related token already trades, so its own airdrop is less likely';
    }
    return {
      opp: r4(opp), cost: r4(cost), hours: r4(hours), farmers: Math.round(farmers), weight: weight,
      drop: drop.map(Math.round), ev: r4(ev), net: r4(net), roi: r4(roi), per_hour: r4(perHour),
      per_1k: r4(net / pl.capital * 1000), verdict: verdict, why: why
    };
  }

  // == the whole run
  /**
   * input = {peers, pop, rows}: peers trade (value fit), pop is every non-CEX protocol with tok 0/1 (odds
   * fit), rows are the board's candidates {slug, cat, fam, tvl, c7, age, nch, lane, plan}.
   * Returns the fits, their held-out scores and each row's value, its dollar steps, band, odds and verdict.
   */
  function build(input) {
    var peers = input.peers, byFold = function (p) { return foldOf(p.slug); }, byCat = function (p) { return p.cat; };
    // odds first: the track prior is read off it
    var cvs = A.lambdas.map(function (l) { return oddsCV(input.pop, l); });
    var best = cvs.slice().sort(function (a, b) { return a.logloss - b.logloss || a.lambda - b.lambda; })[0];
    var ofit = fitOdds(input.pop, best.lambda), tp = trackPrior(ofit, input.pop);
    var ctx = { med: median(input.pop.filter(function (p) { return p.c7 !== null; }).map(function (p) { return p.c7; })), d0: tp.d0 };
    var fit = fitValue(peers, ctx, 'post'), flat = fitValue(peers, ctx, 'flat');
    var kf = holdout(peers, byFold, ctx, 'post'), lo = holdout(peers, byCat, ctx, 'post');
    // the same two tests for the comparisons the page prints: v2 (no momentum, no track) and each term alone off
    var cmp = ['v2', 'nomom', 'notrk', 'flat'].map(function (m) { return { mode: m, kf: holdout(peers, byFold, ctx, m).mdae, lo: holdout(peers, byCat, ctx, m).mdae }; });
    var band = [quantile(kf.resid, A.band[0]), quantile(kf.resid, A.band[1])];
    var rows = input.rows.map(function (p) {
      var pr = predict(fit, p, ctx.med), rel = p.lane === 'related' ? A.related : 1, m = Math.exp(pr.y) * rel;
      var v = Math.max(1, Math.round(p.tvl * m));
      // dollar steps: TVL, then × each factor in turn; the last step lands exactly on v
      var f = [Math.exp(pr.parts[0]), Math.exp(pr.parts[1]), Math.exp(pr.parts[2]), Math.exp(pr.fam), Math.exp(pr.cat), Math.exp(pr.parts[MOM]), Math.exp(pr.parts[TRK]), rel];
      var run = p.tvl, steps = f.map(function (k) { run *= k; return run; });
      var r = {
        slug: p.slug, y: pr.y, multiple: m, v: v, factors: f, steps: steps,
        lo: Math.max(1, Math.round(v * Math.exp(band[0]))), hi: Math.max(1, Math.round(v * Math.exp(band[1]))),
        odds: r4(oddsOf(ofit, p)), terms: pr
      };
      r.ev = Math.max(1, Math.round(r.odds * v));
      r.econ = econ({ tvl: p.tvl, v: v, lo: r.lo, hi: r.hi, odds: r.odds, lane: p.lane, plan: p.plan });
      return r;
    });
    return {
      A: A, terms: TERMS, value: fit, flat: flat, ctx: ctx, track: tp, cmp: cmp,
      kfold: kf, loco: lo, band: band, odds: ofit, odds_cv: cvs, odds_best: best, rows: rows
    };
  }

  globalThis.RadarModel = {
    A: A, TERMS: TERMS, OTERMS: OTERMS, MOM: MOM, TRK: TRK, ageDays: ageDays, build: build, fitValue: fitValue, predict: predict,
    oddsOf: oddsOf, xo: xo, econ: econ, foldOf: foldOf, median: median, quantile: quantile, rec: rec
  };
})();
