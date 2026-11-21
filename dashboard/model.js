// Token Launch Radar: the fitted value model, the peer token-odds model and the farm economics.
// One file, run twice: main.ts runs it to write board.json, and the page runs it again on data.js and
// checks that every number it gets equals the board. Nothing here names a protocol. No clock and no
// randomness: cross-validation folds come from a hash of the slug.
//
// VALUE  log(mcap/TVL) of the protocols whose token trades = X·beta + family effect + category effect
//        X = [1, ln(TVL/$100M), tanh(change_7d/20), ln(1 + years listed), no listing date, ln(chains)]
//        beta by least squares. Terms are kept by backward elimination on 5-fold error: a term (or the
//        category effects) stays only if dropping it makes held-out error worse. Family and category effects
//        are their peers' mean residual times an empirical-Bayes weight w = n·tau² / (n·tau² + sigma²),
//        tau² fitted by moments: a category with one trading peer barely moves off the global fit.
//        implied value = TVL × exp(fitted log multiple); band = the 25th..75th percentile of held-out
//        residuals. Tested held-out twice: 5-fold by slug hash, and leave-one-category-out.
// ODDS   P(protocol records a token), fitted on every snapshot protocol but the CEXes: a logistic on the
//        same six terms plus ridge-shrunk family and category terms, ridge picked by 5-fold log loss.
// FARM   cost = gas + fees + capital × 5%/yr over the window; airdrop = implied × community share
//        (5/10/15%) × your weight (half flat over the farmers, half pro rata to capital) × odds.
(function () {
  'use strict';

  /** Stated assumptions: transforms, fold counts and farm economics. No value-model weight is here. */
  var A = {
    mom_scale: 20, folds: 5, backfit: 10, irls: 25, lambdas: [0.5, 2, 8, 32],
    related: 0.25, band: [0.25, 0.75], band80: [0.1, 0.9],
    opp_rate: 0.05, share: [0.05, 0.10, 0.15], deposit: 25000, min_farmers: 1000, flat: 0.5,
    farm_hour: 40, farm_roi: 3, farm_odds: 0.2
  };

  // ------------------------------------------------------------ numerics
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
  /** Weighted least squares with a ridge vector: (X'WX + diag(ridge)) b = X'Wy. */
  function wls(X, y, w, ridge) {
    var p = X[0].length, M = [], v = new Array(p).fill(0), i, j, k;
    for (j = 0; j < p; j++) M.push(new Array(p).fill(0));
    for (i = 0; i < X.length; i++) for (j = 0; j < p; j++) { v[j] += w[i] * X[i][j] * y[i]; for (k = 0; k < p; k++) M[j][k] += w[i] * X[i][j] * X[i][k]; }
    for (j = 0; j < p; j++) M[j][j] += ridge[j];
    return solve(M, v);
  }
  function dot(a, b) { var s = 0; for (var i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
  /** Spearman rank correlation (ties share their mean rank). */
  function ranks(xs) {
    var idx = xs.map(function (x, i) { return i; }).sort(function (a, b) { return xs[a] - xs[b]; }), r = new Array(xs.length);
    for (var i = 0; i < idx.length;) { var j = i; while (j + 1 < idx.length && xs[idx[j + 1]] === xs[idx[i]]) j++; for (var k = i; k <= j; k++) r[idx[k]] = (i + j) / 2 + 1; i = j + 1; }
    return r;
  }
  function spearman(a, b) {
    var ra = ranks(a), rb = ranks(b), ma = sum(ra) / ra.length, mb = sum(rb) / rb.length, sab = 0, saa = 0, sbb = 0;
    for (var i = 0; i < ra.length; i++) { sab += (ra[i] - ma) * (rb[i] - mb); saa += (ra[i] - ma) * (ra[i] - ma); sbb += (rb[i] - mb) * (rb[i] - mb); }
    return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
  }

  // ------------------------------------------------------------ features
  var TERMS = ['intercept', 'ln TVL / $100M', 'tanh(7d / 20)', 'ln(1 + years listed)', 'no listing date', 'ln chains'];
  var PARTS = TERMS.concat(['category effects']);
  /** p = {tvl, c7, age (days or null), nch}. */
  function x(p) {
    return [1, Math.log(p.tvl / 1e8), p.c7 === null ? 0 : Math.tanh(p.c7 / A.mom_scale),
      p.age === null ? 0 : Math.log(1 + p.age / 365), p.age === null ? 1 : 0, Math.log(Math.max(1, p.nch))];
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

  /**
   * Fit the value model on peers [{slug, cat, fam, tvl, mcap, c7, age, nch}]. off[j] forces term j to 0;
   * off[6] turns the family and category effects off.
   */
  function fitValue(peers, off) {
    var X = peers.map(x), y = peers.map(function (p) { return Math.log(p.mcap / p.tvl); });
    var fk = peers.map(function (p) { return p.fam; }), ck = peers.map(function (p) { return p.cat; });
    var uf = y.map(function () { return 0; }), uc = uf.slice(), w = uf.map(function () { return 1; });
    var n = peers.length, beta, F, C, i;
    var ridge = TERMS.map(function (t, j) { return off[j] ? 1e12 : 1e-9; });
    for (var it = 0; it < A.backfit; it++) {
      var yy = y.map(function (v, j) { return v - uf[j] - uc[j]; });
      beta = wls(X, yy, w, ridge);
      var r = y.map(function (v, j) { return v - dot(X[j], beta); });
      F = eb(r, fk);
      var r2 = r.map(function (v, j) { return v - F.groups[fk[j]].u; });
      C = eb(r2, ck);
      if (off[6]) [F, C].forEach(function (E) { Object.keys(E.groups).forEach(function (k) { E.groups[k].w = E.groups[k].u = 0; }); });
      for (i = 0; i < y.length; i++) { uf[i] = F.groups[fk[i]].u; uc[i] = C.groups[ck[i]].u; }
    }
    // standard errors: sigma² × diag((X'X + ridge)^-1), one solve per term
    var P = TERMS.length, XtX = TERMS.map(function (t, j) { return TERMS.map(function (u, k) { return sum(X.map(function (r) { return r[j] * r[k]; })) + (j === k ? ridge[j] : 0); }); });
    var se = TERMS.map(function (t, j) { var e = new Array(P).fill(0); e[j] = 1; return Math.sqrt(C.sigma2 * solve(XtX, e)[j]); });
    return { beta: beta, se: se, fam: F, cat: C, n: n, off: off.slice() };
  }
  /** Fitted log multiple and its parts for a protocol {tvl, c7, age, nch, fam, cat}. */
  function predict(fit, p) {
    var xv = x(p), parts = xv.map(function (v, j) { return v * fit.beta[j]; });
    var f = fit.fam.groups[p.fam], c = fit.cat.groups[p.cat];
    var uf = f ? f.u : 0, uc = c ? c.u : 0;
    return { x: xv, parts: parts, fam: uf, cat: uc, y: sum(parts) + uf + uc };
  }

  /** Held-out tests: k-fold by slug hash and leave-one-category-out, each against the naive median. */
  function holdout(peers, split, off) {
    var y = [], yh = [], yb = [], cap = [], caph = [], capb = [], slug = [];
    var keys = peers.map(split), names = keys.filter(function (k, i) { return keys.indexOf(k) === i; }).sort();
    names.forEach(function (k) {
      var train = peers.filter(function (p, i) { return keys[i] !== k; }), test = peers.filter(function (p, i) { return keys[i] === k; });
      if (!train.length) return;
      var fit = fitValue(train, off), base = median(train.map(function (p) { return Math.log(p.mcap / p.tvl); }));
      test.forEach(function (p) {
        var h = predict(fit, p).y, l = Math.log(p.tvl);
        slug.push(p.slug); y.push(Math.log(p.mcap / p.tvl)); yh.push(h); yb.push(base);
        cap.push(Math.log(p.mcap)); caph.push(l + h); capb.push(l + base);
      });
    });
    var e = y.map(function (v, i) { return v - yh[i]; }), e0 = y.map(function (v, i) { return v - yb[i]; });
    function w2(es) { return r4(es.filter(function (v) { return Math.abs(v) <= Math.LN2; }).length / es.length); }
    return {
      n: y.length, folds: names.length,
      mdae: r4(median(e.map(Math.abs))), base_mdae: r4(median(e0.map(Math.abs))),
      rho: r4(spearman(yh, y)), cap_rho: r4(spearman(caph, cap)), base_cap_rho: r4(spearman(capb, cap)),
      within2: w2(e), base_within2: w2(e0),
      slug: slug, resid: e, pred: yh
    };
  }

  // ------------------------------------------------------------ odds: does a protocol like this record a token?
  function oddsDesign(pop) {
    var fams = [], cats = [];
    pop.forEach(function (p) { if (fams.indexOf(p.fam) < 0) fams.push(p.fam); if (cats.indexOf(p.cat) < 0) cats.push(p.cat); });
    fams.sort(); cats.sort();
    return { fams: fams, cats: cats, p: 6 + fams.length + cats.length };
  }
  function oddsRow(d, p) {
    var fi = d.fams.indexOf(p.fam), ci = d.cats.indexOf(p.cat);
    return { dense: x(p), fi: fi < 0 ? -1 : 6 + fi, ci: ci < 0 ? -1 : 6 + d.fams.length + ci };
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

  // ------------------------------------------------------------ farm economics
  /** r = {tvl, v, lo, hi, odds, lane, plan: {capital, fees_total, hands_on_minutes, weeks}}. */
  function econ(r) {
    var pl = r.plan, opp = pl.capital * A.opp_rate * pl.weeks / 52, cost = pl.fees_total + opp, hours = pl.hands_on_minutes / 60;
    var farmers = Math.max(A.min_farmers, r.tvl / A.deposit);
    var weight = A.flat / farmers + (1 - A.flat) * pl.capital / r.tvl;
    var drop = [r.lo * A.share[0] * weight, r.v * A.share[1] * weight, r.hi * A.share[2] * weight];
    var ev = r.odds * drop[1], net = ev - cost, roi = cost > 0 ? ev / cost : 0, perHour = net / hours;
    var verdict, why;
    if (net <= 0) { verdict = 'Skip'; why = 'expected $' + Math.round(ev) + ' is below its $' + Math.round(cost) + ' cost'; }
    else if (perHour >= A.farm_hour && roi >= A.farm_roi && r.odds >= A.farm_odds) { verdict = 'Farm'; why = 'pays $' + Math.round(perHour) + '/h at ' + roi.toFixed(1) + '× its cost, ' + Math.round(r.odds * 100) + '% peer odds'; }
    else {
      verdict = 'Watch';
      why = perHour < A.farm_hour ? 'positive, but $' + Math.round(perHour) + '/h is under $' + A.farm_hour + '/h'
        : roi < A.farm_roi ? 'positive, but only ' + roi.toFixed(1) + '× its cost' : 'peer odds ' + Math.round(r.odds * 100) + '% are under ' + Math.round(A.farm_odds * 100) + '%';
    }
    return {
      opp: r4(opp), cost: r4(cost), hours: r4(hours), farmers: Math.round(farmers), weight: weight,
      drop: drop.map(Math.round), ev: r4(ev), net: r4(net), roi: r4(roi), per_hour: r4(perHour),
      per_1k: r4(net / pl.capital * 1000), verdict: verdict, why: why
    };
  }

  // ------------------------------------------------------------ the whole run
  /**
   * input = {peers, pop, rows}: peers trade (value fit), pop is every non-CEX protocol with tok 0/1 (odds
   * fit), rows are the board's candidates {slug, cat, fam, tvl, c7, age, nch, lane, plan}.
   * Returns the fits, their held-out scores and each row's value, band, odds, expected value and verdict.
   */
  function build(input) {
    var peers = input.peers, byFold = function (p) { return foldOf(p.slug); };
    // backward elimination: drop the term (or the category effects) whose removal most lowers the 5-fold
    // error, and repeat while one does; every term left earned its place on tokens the fit did not see
    var off = [false, false, false, false, false, false, false], kf = holdout(peers, byFold, off), path = [['all terms', kf.mdae]];
    for (;;) {
      var bestJ = -1, bestH = null;
      for (var j = 1; j <= 6; j++) if (!off[j]) {
        var o2 = off.slice(); o2[j] = true;
        var h = holdout(peers, byFold, o2);
        if (h.mdae < (bestH ? bestH.mdae : kf.mdae)) { bestJ = j; bestH = h; }
      }
      if (bestJ < 0) break;
      off[bestJ] = true; kf = bestH; path.push([PARTS[bestJ], kf.mdae]);
    }
    var fit = fitValue(peers, off), lo = holdout(peers, function (p) { return p.cat; }, off);
    var ablate = PARTS.map(function (t, j) { var o2 = off.slice(); o2[j] = !o2[j]; return { term: t, kept: !off[j], mdae: j ? holdout(peers, byFold, o2).mdae : null }; }).slice(1);
    var band = [quantile(kf.resid, A.band[0]), quantile(kf.resid, A.band[1])], band80 = [quantile(kf.resid, A.band80[0]), quantile(kf.resid, A.band80[1])];
    var cvs = A.lambdas.map(function (l) { return oddsCV(input.pop, l); });
    var best = cvs.slice().sort(function (a, b) { return a.logloss - b.logloss || a.lambda - b.lambda; })[0];
    var ofit = fitOdds(input.pop, best.lambda);
    var rows = input.rows.map(function (p) {
      var pr = predict(fit, p), rel = p.lane === 'related' ? A.related : 1, m = Math.exp(pr.y) * rel;
      var v = Math.max(1, Math.round(p.tvl * m));
      var r = {
        slug: p.slug, y: pr.y, multiple: m, v: v,
        lo: Math.max(1, Math.round(v * Math.exp(band[0]))), hi: Math.max(1, Math.round(v * Math.exp(band[1]))),
        odds: r4(oddsOf(ofit, p)), terms: pr
      };
      r.ev = Math.max(1, Math.round(r.odds * v));
      r.econ = econ({ tvl: p.tvl, v: v, lo: r.lo, hi: r.hi, odds: r.odds, lane: p.lane, plan: p.plan });
      return r;
    });
    return {
      A: A, terms: TERMS, value: fit, path: path, ablate: ablate,
      kfold: kf, loco: lo, band: band, band80: band80, odds: ofit, odds_cv: cvs, odds_best: best, rows: rows
    };
  }

  globalThis.RadarModel = {
    A: A, TERMS: TERMS, PARTS: PARTS, ageDays: ageDays, build: build, fitValue: fitValue, predict: predict, oddsOf: oddsOf,
    econ: econ, foldOf: foldOf, median: median, quantile: quantile
  };
})();
