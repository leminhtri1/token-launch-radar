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

Everything comes from the snapshot's own fields (`lib/model.ts`). No protocol is named anywhere in the code.

1. **Universe.** Rows are every watchlist slug, plus every protocol that records no token (no `gecko_id`, `symbol` or `mcap_usd`). Left out: CEXes, exchange-branded products, and wrapped, staked or bridged assets, because their value is an asset that already trades. A protocol whose first distinctive name word matches a protocol that does record a token is kept, but flagged **related token** and multiplied by 0.25.
2. **Calibration.** The 119 protocols whose token trades (with a `gecko_id`, `mcap_usd` and TVL, CEXes left out) each give a market-cap/TVL multiple. The model takes log-medians per category and per family of categories, then shrinks each toward its parent level by sample size: `(n·median + 3·parent) / (n + 3)`.
3. **Implied value** = TVL × category multiple × momentum × track × breadth × confidence × related.
   - momentum = `1 + 0.25·tanh(change_7d / 20)`, bounded between 0.75 and 1.25
   - track (days listed with no token) = 0.70 rising to 1.10 at 540 days, then easing to 0.95 at 5 years
   - breadth = `0.97 + 0.055·ln(chains)`, capped at 1.15
   - confidence = 0.85 at $5M TVL, rising to 1.00 at $1B
4. **Band.** low and high = value × e^∓h, where h is the standard error of the category's median multiple.
5. **Farm plan.** Each protocol gets steps for its category (a curator vault deposit, a lending loop, a CDP mint, a DEX LP, perp volume and so on). The plan runs on its cheapest sensible chain. Costs use a stated gas table in dollars per transaction, capital scales with TVL, and the holding window depends on age. Each step lists its capital, gas, fees and time. The plan also shows the same plan's cost on each of the protocol's chains.

The page (`dashboard/app.js`) does not trust these numbers. It re-runs the calibration from the peer set in `data.js`, rebuilds every row's factors from the raw figures, and reports whether its results match `board.json`. Implied value is this radar's claim of what a token would be worth if the protocol's record stayed as it is. It does not predict whether or when a token is issued.

---

<sub>Entered on [make.fun](https://make.fun/?ref=eh1gzvjg&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
