# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/leminhtri1/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/leminhtri1/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A radar of DeFi protocols that record no token yet, ranked by an implied launch value derived from a sealed DefiLlama snapshot: TVL × a fitted multiple × momentum(7-day growth) × track(time without a token), with a farm plan per protocol and an offline dashboard.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
node tools/validate.mjs --input /path/to/snapshot.json   # local gate check, runs main.ts twice
node tools/shoot.mjs --out out-a                          # headless Chrome screenshots
```

## How the model works

Everything comes from the snapshot's own fields. No protocol is named anywhere in the code. The fitting lives in `dashboard/model.js`, a plain script that `main.ts` imports and that the page runs again in the browser. The board and the page share one implementation, and the page checks that its refit equals `board.json`.

```
implied value = TVL × fitted multiple × momentum(7d) × track(days with no token)
  fitted multiple = e^(a + b·ln(TVL/$100M) + c·ln chains + family effect + category effect)
  momentum(7d)    = e^(γ·tanh((change_7d − median change_7d) / 20))
  track           = e^(δ·(1 − e^(−days with no token / 365)))
```

1. **Universe** (`lib/model.ts`). Rows are every watchlist slug, plus every protocol that records no token (no `gecko_id`, `symbol` or `mcap_usd`). Left out: CEXes, exchange-branded products, and wrapped, staked or bridged assets, because their value is an asset that already trades. A protocol whose first distinctive name word matches a protocol that does record a token is kept, flagged **related token**, multiplied by 0.25 (a stated assumption) and capped at Watch. The 93 protocols whose token trades are not ranked: they are the **Already trading** tab and the value fit's training data.
2. **Fitted multiple.** Peers are the 93 trading protocols the house watchlist rule would keep (no CEX, no wrapped, staked or bridged category, no versioned name such as "Aave V2"). `log(mcap/TVL)` is regressed on size, reach, momentum and track by least squares, plus family and category effects. Each effect is its peers' mean residual times an empirical-Bayes weight `n·τ²/(n·τ² + σ²)`, so a category with one trading peer moves only about 11% of the way toward it. Fitted: size b = −0.62 ± 0.11 (a TVL elasticity of 0.37), reach c = −0.17.
3. **Momentum and track.** Trading peers cannot pin these two well, because their cap prices a token that already exists. Each therefore gets a normal prior from the snapshot, and the fit combines prior and data by precision (a ridge with a prior mean):
   - γ, momentum: the prior is 4 more weeks of +20% growth over the snapshot's median week (−8.1%), at the fitted TVL elasticity: γ0 = 4 × 0.37 × ln 1.2 / tanh 1 = +0.35 ± 0.18. The data alone give −0.57 ± 0.58. Posterior **+0.29 ± 0.17**. On the board momentum runs from ×0.75 to ×1.33.
   - δ, track: the odds model (below) says a 3-year record lifts the average odds of carrying a token from 21% to 67%, so δ0 = ln(0.67/0.21) / 0.95 = +1.22 ± 0.61. The data alone give +0.36 ± 0.48. Posterior **+0.72 ± 0.38**. Track runs from ×1.00 at launch to ×2.05 and levels off after about 3 years. A row with no listing date or no 7-day figure gets a neutral factor.
   - Prior sd = half the prior mean: the prior is sure of the sign, not the size.
4. **Held-out tests.** 5-fold by an FNV-1a hash of the slug, and leave-one-category-out. Median absolute error of log(mcap/TVL) on tokens each fit never saw:

   | model | 5-fold | by category |
   |---|---|---|
   | **v3: every term** | **1.095** | **1.001** |
   | v2: no momentum, no track | 1.072 | 1.038 |
   | v3 without momentum | 1.119 | 1.044 |
   | v3 without track | 1.038 | 1.041 |
   | data only, no priors | 1.167 | 1.140 |
   | naive training median | 1.528 | 1.479 |

   v3 costs 0.024 on 5-fold and gains 0.037 by category against v2, and both stay well under naive. The 50% band is the 25th to 75th percentile of the 5-fold residuals. Each detail view walks TVL to the implied value in dollars, one factor a line; `board.json` carries the same walk as `value_steps`.
5. **Peer odds.** A penalised logistic on all 702 non-CEX protocols asks how often a protocol like this one records a token, from ln TVL, tanh(7d/20), ln(1 + years listed), a no-date flag, ln chains and ridge-shrunk family and category terms, with the ridge picked by 5-fold log loss. Out of fold: AUC 0.77, log loss 0.567 vs 0.683 for the base rate. The odds are a base rate, not a forecast of a launch.
6. **Farm plan and verdict.** Each protocol gets steps for its category (a curator vault deposit, a lending loop, a CDP mint, a DEX LP, perp volume and so on) on its cheapest sensible chain, each with capital, gas and fees, transactions, hands-on minutes and calendar span. One gas table, `GAS` in `lib/model.ts`, sets dollars per transaction and per funding move. It is an assumption, not snapshot data, and the Assumptions tab prints it. Cost = gas and fees + capital × 5%/yr over the window. Payoff if a token comes = 10% (5–15%) of implied value, split half flat over TVL/$25k farmers and half pro rata to capital, then × peer odds. **Farm** needs at least $40/h net, payoff at least 3× cost and odds of at least 20%. **Watch** is positive but misses one of those, or is a related-token row. **Skip** expects less than it costs.

Implied value is this radar's claim of what a token would be worth if the protocol's record stayed as it is. It does not predict whether or when a token is issued.

---

<sub>Entered on [make.fun](https://make.fun/?ref=eh1gzvjg&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
