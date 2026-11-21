# token-launch-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/leminhtri1/token-launch-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/leminhtri1/token-launch-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A radar of DeFi protocols that record no token yet, ranked by an implied launch value derived from a sealed DefiLlama snapshot (TVL, 7-day growth, time without a token), with a farm plan per protocol and an offline dashboard.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
node tools/validate.mjs --input /path/to/snapshot.json   # local gate check, runs main.ts twice
node tools/shoot.mjs --out out-a                          # headless Chrome screenshots
```

## How the model works

Everything comes from the snapshot's own fields. No protocol is named anywhere in the code. The fitting lives in `dashboard/model.js`, a plain script that `main.ts` imports and that the page runs again in the browser. The board and the page share one implementation, and the page checks that its refit equals `board.json`.

1. **Universe** (`lib/model.ts`). Rows are every watchlist slug, plus every protocol that records no token (no `gecko_id`, `symbol` or `mcap_usd`). Left out: CEXes, exchange-branded products, and wrapped, staked or bridged assets, because their value is an asset that already trades. A protocol whose first distinctive name word matches a protocol that does record a token is kept, flagged **related token**, and multiplied by 0.25 (a stated assumption).
2. **Value fit.** Peers are the 93 protocols whose token trades (`gecko_id`, `mcap_usd`, TVL) that the house watchlist rule would keep: no CEX, no wrapped, staked or bridged category, no versioned name such as "Aave V2", because those carry a parent token's cap. The fit regresses `log(mcap/TVL)` on `[1, ln(TVL/$100M), tanh(change_7d/20), ln(1 + years listed), no listing date, ln chains]` by least squares, plus family and category effects. Each effect is its peers' mean residual times an empirical-Bayes weight `n·τ²/(n·τ² + σ²)`, with τ² fitted by moments, so a category with one trading peer moves only about 14% of the way toward it. Terms are chosen by backward elimination on 5-fold error, and a term stays only if dropping it makes held-out error worse. On this snapshot the fit keeps ln TVL (elasticity −0.63 ± 0.11), ln chains and the category effects. It drops 7-day change, years listed and the no-date flag: adding any of them back raises held-out error.
3. **Held-out tests.** 5-fold by an FNV-1a hash of the slug, and leave-one-category-out. Median absolute error of log(mcap/TVL): **1.07 vs 1.53** for the naive training median (5-fold, which also chose the terms) and **1.04 vs 1.48** leaving each category out, which played no part in choosing the terms. The 50% band is the 25th to 75th percentile of the 5-fold residuals.
4. **Peer odds.** A penalised logistic on all 702 non-CEX protocols asks how often a protocol like this one records a token. It uses the same six terms plus ridge-shrunk family and category terms, with the ridge picked by 5-fold log loss. Out of fold: AUC 0.77, log loss 0.567 vs 0.683 for the base rate. 7-day growth and tokenless time enter here, so they move **odds × value**. The odds are a base rate, not a forecast of a launch.
5. **Farm plan and verdict.** Each protocol gets steps for its category (a curator vault deposit, a lending loop, a CDP mint, a DEX LP, perp volume and so on) on its cheapest sensible chain. One gas table, `GAS` in `lib/model.ts`, sets dollars per transaction and per funding move. It is an assumption, not snapshot data, and the Assumptions tab prints it. Cost = gas and fees + capital × 5%/yr over the window. Payoff if a token comes = 10% (5–15%) of implied value, split half flat over TVL/$25k farmers and half pro rata to capital, then × peer odds. **Farm** needs at least $40/h net, payoff at least 3× cost and odds of at least 20%. **Watch** is positive but misses one of those. **Skip** expects less than it costs.

Implied value is this radar's claim of what a token would be worth if the protocol's record stayed as it is. It does not predict whether or when a token is issued.

---

<sub>Entered on [make.fun](https://make.fun/?ref=eh1gzvjg&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
