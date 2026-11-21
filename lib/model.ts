// Token launch radar: the universe, the farm-plan generator and the glue to the fitted model.
//
// One sealed snapshot in, one ranked board out. The fitting itself lives in dashboard/model.js, a plain
// script that this file imports and that the page runs again in the browser, so the board and the page
// share one implementation:
//   1. Value. implied value = TVL x fitted multiple x momentum(7d) x track(days with no token). The
//      multiple is fitted on the snapshot's trading tokens (ln TVL, ln chains, empirical-Bayes family and
//      category effects); momentum and track are fitted in the same regression under stated priors.
//   2. Odds. A penalised logistic on every non-CEX protocol: how often one like this records a token.
//   3. Plan. Each row gets a farm plan from its category, its cheapest sensible chain (the GAS table
//      below, an assumption in US dollars per transaction), its TVL (capital) and its age (window).
//   4. Verdict. dashboard/model.js econ(): plan cost + opportunity cost vs odds x airdrop share.
// No protocol name is special-cased anywhere: the same functions score every row.
import '../dashboard/model.js';

/** The fitted model, as dashboard/model.js defines it on globalThis. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const RM: any = (globalThis as any).RadarModel;

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export const MODEL_VERSION = 'radar-fit-5';

/** Categories grouped into families: the value fit shrinks a category toward its family, then the global fit. */
export const FAMILIES: Record<string, string[]> = {
  Lending: ['Lending', 'CDP', 'CDP Manager', 'Uncollateralized Lending', 'Collateral Management'],
  Trading: ['Dexs', 'Derivatives', 'Options', 'Options Vault', 'Prediction Market', 'Interest Rate Derivatives', 'Synthetics', 'OTC Marketplace', 'NFT Marketplace', 'Launchpad'],
  'Vaults & yield': ['Risk Curators', 'Onchain Capital Allocator', 'Yield', 'Yield Aggregator', 'Liquidity Manager', 'Leveraged Farming', 'Farm', 'Basis Trading', 'Indexes', 'Governance Incentives', 'Token Locker'],
  'Stables & RWA': ['RWA', 'Stablecoin Issuer', 'Stablecoin Wrapper', 'Dual-Token Stablecoin', 'Algo-Stables', 'Reserve Currency', 'CeDeFi', 'Payments', 'Crypto Card Issuer'],
  'Chains & infra': ['Chain', 'Bridge', 'Cross Chain Bridge', 'Canonical Bridge', 'Privacy', 'Restaking', 'Collateral Markets', 'Staking Pool', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'Anchor BTC', 'Decentralized BTC', 'AI Agents', 'Decentralized AI', 'DOR', 'Insurance'],
};
const FAMILY_OF = new Map<string, string>();
for (const [fam, cats] of Object.entries(FAMILIES)) for (const c of cats) FAMILY_OF.set(c, fam);
export function familyOf(category: string | null): string {
  return (category !== null && FAMILY_OF.get(category)) || 'Other';
}

/**
 * ASSUMPTION, not snapshot data: [US dollars for one ordinary DeFi transaction (approve, deposit, swap),
 * US dollars to fund the chain (exchange withdrawal or bridge)], typical late-2026 levels. The one table
 * every plan cost, per-chain comparison and verdict reads; the page prints it whole.
 */
export const GAS: Record<string, [number, number]> = {
  Ethereum: [2.5, 5], Bitcoin: [1.5, 3], Tron: [1.2, 1], Cardano: [0.2, 1], Binance: [0.08, 0.5],
  Avalanche: [0.05, 1], Polygon: [0.02, 0.5], Arbitrum: [0.03, 0.5], Base: [0.02, 0.5], Optimism: [0.02, 0.5],
  Ink: [0.02, 1], Unichain: [0.02, 1], Linea: [0.04, 1], Scroll: [0.04, 1], 'zkSync Era': [0.05, 1],
  Mantle: [0.02, 1], Sonic: [0.02, 1], Berachain: [0.02, 1], Monad: [0.01, 1], 'Hyperliquid L1': [0.02, 1],
  Plasma: [0.01, 1], Katana: [0.02, 1.5], Solana: [0.01, 1], Sui: [0.01, 1], Aptos: [0.01, 1],
  Algorand: [0.002, 0.5], Stellar: [0.001, 0.5], Ripple: [0.001, 0.5], Flare: [0.01, 1.5], TON: [0.03, 0.5],
  Starknet: [0.03, 1.5], Bittensor: [0.01, 1], Noble: [0.01, 0.5], Sei: [0.01, 1], Celo: [0.01, 1],
  'World Chain': [0.02, 1], Fantom: [0.02, 1], xDai: [0.01, 1], Mezo: [0.02, 2], BSquared: [0.05, 2],
  Arc: [0.01, 1], 'Robinhood Chain': [0.02, 1], Provenance: [0.05, 2], Morph: [0.02, 1], RISE: [0.01, 1.5],
  'Plume Mainnet': [0.02, 1], Tempo: [0.01, 1], Pharos: [0.02, 1.5], Stable: [0.01, 1], Fluent: [0.02, 1.5],
  RSK: [0.1, 2], 'X Layer': [0.02, 0.5], Manta: [0.02, 1], Ronin: [0.02, 1], Kava: [0.01, 1], Stacks: [0.3, 2],
  Klaytn: [0.02, 0.5], Hemi: [0.05, 1.5], TAC: [0.02, 1.5], BOB: [0.02, 1], CORE: [0.02, 1], Citrea: [0.05, 2],
  Etherlink: [0.01, 1], Blast: [0.02, 1], Sophon: [0.02, 1], Soneium: [0.02, 1], Mode: [0.02, 1], Near: [0.01, 0.5],
};

/** What to withdraw from an exchange to fund a chain whose DeFi does not start from USDC. */
export const FUND_ASSET: Record<string, string> = {
  Bitcoin: 'BTC', BSquared: 'BTC', Mezo: 'BTC', CORE: 'BTC', Stacks: 'STX', RSK: 'BTC', Bittensor: 'TAO', Cardano: 'ADA',
  Ripple: 'XRP', Tron: 'USDT', TON: 'USDT', Flare: 'XRP (as FXRP) or USDT0', Algorand: 'USDC or ALGO', Kava: 'USDT',
};
export const GAS_DEFAULT: [number, number] = [0.1, 2];

// ------------------------------------------------------------------ helpers

const r4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Whole days from listed_at to as_of (dashboard/model.js ageDays, so the page counts the same). */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  return RM.ageDays(asOf, listedAt);
}

/** Median of numbers (mean of the middle two for an even count). */
export function median(xs: number[]): number {
  return RM.median(xs);
}

export function recordsToken(p: SnapshotProtocol): boolean {
  return p.gecko_id !== null || p.symbol !== null || p.mcap_usd !== null;
}

// ------------------------------------------------------------------ model inputs

/** One protocol as dashboard/model.js reads it. data.js carries the same arrays in the same order. */
export interface ModelInput {
  slug: string;
  cat: string;
  fam: string;
  tvl: number;
  mcap: number | null;
  c7: number | null;
  age: number | null;
  nch: number;
}
export function modelInput(s: Snapshot, p: SnapshotProtocol): ModelInput {
  return { slug: p.slug, cat: p.category ?? 'Uncategorised', fam: familyOf(p.category), tvl: p.tvl_usd, mcap: p.mcap_usd, c7: p.change_7d, age: ageDays(s.as_of, p.listed_at), nch: p.chains.length };
}

/** A name ending in a version marker ("Aave V2", "X 2.0"): the house watchlist rule's own test. */
const VERSION = /\s(v\d+(\.\d+)?|\d+\.\d+)$/i;

/** Why a protocol whose token trades is kept out of the value fit, or null when it is a peer. */
export function peerSkip(p: SnapshotProtocol): string | null {
  if (p.category === 'CEX') return 'centralised exchange';
  if (WRAP_CATEGORIES.has(p.category ?? '')) return 'wrapped, staked or bridged product: its cap is the parent token\'s';
  if (VERSION.test(p.name)) return 'versioned product: its cap is the parent token\'s';
  return null;
}

/** Protocols whose token trades, with a market cap and TVL. */
export function tradingOf(s: Snapshot): SnapshotProtocol[] {
  return s.protocols.filter((p) => p.gecko_id !== null && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
}

/**
 * The value fit's peers: the trading protocols the house watchlist rule would keep, so the fit learns
 * from the same kind of protocol the board ranks (no CEX, no wrapped, staked, bridged or versioned product).
 */
export function peersOf(s: Snapshot): SnapshotProtocol[] {
  return tradingOf(s).filter((p) => peerSkip(p) === null);
}

/** The odds fit's population: every protocol but the CEXes, labelled by whether it records a token. */
export function populationOf(s: Snapshot): SnapshotProtocol[] {
  return s.protocols.filter((p) => p.category !== 'CEX');
}


// ------------------------------------------------------------------ the universe

const EXCHANGE_PREFIX = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i;
const WRAP_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC']);
const WRAP_WORD = /\b(wrapped|staked|staking)\b/i;
const GENERIC = new Set('the liquid staked wrapped staking finance protocol network capital bridge defi dao labs money yield vault vaults crypto pool lending dex swap exchange markets market btc eth sol usd stable'.split(' '));

/** A name's first distinctive word: "Gate SOL" -> "gate". Generic words are skipped. */
export function stemOf(name: string): string | null {
  const words = name.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length >= 3 && !GENERIC.has(w));
  return words[0] ?? null;
}

export type Lane = 'watchlist' | 'early' | 'related';

export interface Universe {
  ranked: { p: SnapshotProtocol; lane: Lane; related: string | null }[];
  excluded: { reason: string; count: number; examples: string[] }[];
}

/**
 * Which protocols the board ranks. A protocol that records no token is a candidate; the watchlist is
 * always in; a CEX, an exchange-branded product or a wrapped/staked/bridged product is left out (its
 * value is the asset it wraps, which already trades); a candidate whose distinctive name word matches a
 * protocol that records a token is kept but flagged "related token trades" and haircut.
 */
export function universe(s: Snapshot): Universe {
  const watch = new Set(s.watchlist);
  const tokenStems = new Map<string, SnapshotProtocol>();
  for (const p of s.protocols) {
    if (!recordsToken(p)) continue;
    const st = stemOf(p.name);
    if (st !== null && !tokenStems.has(st)) tokenStems.set(st, p);
  }
  const ranked: Universe['ranked'] = [];
  const ex = new Map<string, string[]>();
  const drop = (why: string, p: SnapshotProtocol): void => {
    if (!ex.has(why)) ex.set(why, []);
    ex.get(why)!.push(p.name);
  };
  for (const p of s.protocols) {
    if (watch.has(p.slug)) {
      ranked.push({ p, lane: 'watchlist', related: null });
      continue;
    }
    if (recordsToken(p)) continue;
    if (p.category === 'CEX') drop('centralised exchange', p);
    else if (EXCHANGE_PREFIX.test(p.name)) drop('exchange-branded product', p);
    else if (WRAP_CATEGORIES.has(p.category ?? '') || WRAP_WORD.test(p.name)) drop('wrapped, staked or bridged asset', p);
    else {
      const st = stemOf(p.name);
      const parent = st === null ? undefined : tokenStems.get(st);
      if (parent !== undefined) {
        const tick = parent.symbol ?? parent.gecko_id ?? 'its token';
        ranked.push({ p, lane: 'related', related: `shares the name "${p.name.split(' ')[0]}" with ${parent.name}, whose token ${tick} already trades` });
      } else ranked.push({ p, lane: 'early', related: null });
    }
  }
  const excluded = [...ex.entries()].map(([reason, names]) => ({ reason, count: names.length, examples: names.slice(0, 4) })).sort((a, b) => b.count - a.count || cmp(a.reason, b.reason));
  return { ranked, excluded };
}

// ------------------------------------------------------------------ farm plans

export interface PlanStep {
  /** Short label for the page. */
  step: string;
  /** What to do, concretely. */
  action: string;
  /** Capital put to work in this step, USD. */
  capital: number;
  /** Gas and fees this step burns, USD. */
  fees: number;
  /** On-chain transactions this step sends. */
  txs: number;
  /** Hands-on minutes. */
  minutes: number;
  /** Elapsed span, as words. */
  span: string;
}

export interface Plan {
  chain: string;
  gas_per_tx: number;
  capital: number;
  fees_total: number;
  hands_on_minutes: number;
  weeks: number;
  txs: number;
  /** The same plan's gas and fees on each of the protocol's chains with a known gas cost. */
  per_chain: { chain: string; gas: number; total: number }[];
  steps: PlanStep[];
}

/** Dollars as text, with thousands grouped by hand (no locale data, so every run spells it the same). */
const money = (n: number): string => (n >= 100 ? `$${String(Math.round(n)).replace(/\B(?=(\d{3})+$)/g, ',')}` : n >= 1 ? `$${n.toFixed(2).replace(/\.00$/, '')}` : `$${n.toFixed(2)}`);

/** The weekly touch that keeps a wallet active, by family: what an active user of that kind of app does. */
const WEEKLY_ACTION: Record<string, string> = {
  Lending: 'repay 10% of the loan and borrow it again, or add $50 of supply',
  Trading: 'trade the week\'s volume and close every position by the weekend',
  'Vaults & yield': 'top up $50 or claim and compound the vault\'s rewards',
  'Stables & RWA': 'claim the accrued yield and restake it, or add $50 to the position',
  'Chains & infra': 'make one swap, one deposit and one withdrawal in the ecosystem\'s apps',
  Other: 'claim, compound or top up the position by $50',
};

/** The chain to farm on: the protocol's main (first) chain, unless that costs a dollar or more a transaction and a cheap chain is among its first four. */
export function chainFor(p: SnapshotProtocol): { chain: string; gas: number; fund: number; alt: string | null } {
  const list = p.chains.length > 0 ? p.chains : ['its main chain'];
  const g = (c: string): [number, number] => GAS[c] ?? GAS_DEFAULT;
  let chain = list[0]!;
  let alt: string | null = null;
  if (g(chain)[0] >= 1) {
    const cheap = list.slice(0, 4).filter((c) => g(c)[0] < 0.2).sort((a, b) => g(a)[0] - g(b)[0] || cmp(a, b))[0];
    if (cheap !== undefined) {
      alt = chain;
      chain = cheap;
    }
  }
  return { chain, gas: g(chain)[0], fund: g(chain)[1], alt };
}

/** Category-specific action: [what you do, how many transactions it takes, what you track]. */
const WEEKLY_TRADING_FEE: Record<string, number> = { Derivatives: 1, Options: 1, 'Options Vault': 0.5, 'Interest Rate Derivatives': 1, Dexs: 0.05, 'Prediction Market': 0.5 };
function actionFor(p: SnapshotProtocol, chain: string, capital: number): [string, number, string] {
  const n = p.name;
  const c = p.category ?? '';
  const cap = money(capital);
  switch (c) {
    case 'Risk Curators':
      return [`Deposit ${cap} USDC into ${n}'s largest USDC lending vault on ${chain} (curated vaults are listed on the vault apps it curates for, under the curator's name). Approve, then deposit`, 2, 'vault share price and the curator\'s allocation list'];
    case 'Onchain Capital Allocator':
    case 'Yield Aggregator':
      return [`Deposit ${cap} of USDC (or ETH if the stable vault is capped) into ${n}'s flagship vault on ${chain}. Approve, then deposit; keep the vault receipt token in the same wallet`, 2, 'vault share price, deposit caps and any points balance shown in the app'];
    case 'Yield':
    case 'Basis Trading':
    case 'Stablecoin Wrapper':
      return [`Mint ${n}'s yield-bearing stable with ${cap} USDC on ${chain}, then stake the receipt in its savings or points module so it earns the protocol's own rate`, 3, 'the peg on a DEX, the staking rate and redemption queue length'];
    case 'Lending':
    case 'Uncollateralized Lending':
      return [`Supply ${cap} USDC to ${n} on ${chain}, enable it as collateral, then borrow 25% of it in a second asset and resupply it (one loop, loan-to-value kept under 30%)`, 4, 'health factor (keep it above 2.0), supply and borrow rates'];
    case 'CDP':
    case 'CDP Manager':
      return [`Open a ${n} vault on ${chain} with ${cap} of collateral, mint its stablecoin at a collateral ratio of 250% or more, and park the minted stable in its own savings or stability pool`, 3, 'collateral ratio (keep above 200%), the stable\'s peg and the stability fee'];
    case 'Dexs':
      return [`Add ${cap} of liquidity on ${n} (${chain}) to its deepest stable or major pair, as a full-range or a +/-10% concentrated position, then make two swaps of $50 so the wallet also shows trading volume`, 4, 'fees earned vs impermanent loss, position in range, pool TVL'];
    case 'Derivatives':
    case 'Options':
    case 'Options Vault':
    case 'Interest Rate Derivatives':
      return [`Deposit ${cap} USDC as margin on ${n} (${chain}) and trade $2,000 of notional a week at 1-2x leverage, opening and closing a hedged pair so price risk stays near zero; taker fees on $2,000 are about $1`, 3, 'weekly volume, fees paid, funding and any points per volume'];
    case 'Prediction Market':
      return [`Deposit ${cap} USDC to ${n} and take 3-5 small positions ($20-$50) in liquid markets that resolve within a month, then provide limit-order liquidity on one of them`, 4, 'positions open, resolution dates, maker volume'];
    case 'RWA':
      return [`Complete ${n}'s onboarding (most RWA issuers require KYC; budget a day for approval), then subscribe ${cap} to its tokenised fund or note on ${chain} and hold the token in your wallet`, 2, 'NAV per token, redemption window and the fund\'s attested reserves'];
    case 'Restaking':
    case 'Collateral Markets':
    case 'Staking Pool':
      return [`Deposit ${cap} of a liquid-staked asset (or the chain's native coin) into ${n}'s default vault or pool on ${chain}; note the withdrawal delay before you commit (often 7-21 days)`, 2, 'vault TVL, operator/network set and the unbonding period'];
    case 'Chain':
      return [`Bridge ${cap} to ${chain} through the official bridge and use ${n} plus two other native apps each week (a swap, a lend and a liquidity deposit) so the address shows steady on-chain activity`, 6, 'weekly active days, bridged balance and the chain\'s own points page'];
    case 'Payments':
      return [`Open a ${cap} channel on ${n} from a self-custodial wallet (one on-chain open), then route 5-10 small payments a week through it`, 2, 'channel balance, routing fees and on-chain fee level before closing'];
    case 'CeDeFi':
    case 'Anchor BTC':
    case 'Decentralized BTC':
      return [`Deposit ${cap} of the supported asset into ${n}'s earn product on ${chain}, keeping the receipt token in self-custody where the product allows it`, 2, 'custodian attestations, the earn rate and withdrawal processing time'];
    case 'Insurance':
      return [`Deposit ${cap} into ${n}'s cover or restaking vault on ${chain} as an underwriter, or buy cover worth ${cap} on a position you already hold`, 2, 'vault utilisation, claims paid and the lock period'];
    case 'Governance Incentives':
      return [`Lock or deposit ${cap} of the supported asset into ${n} on ${chain} and cast its gauge or bribe vote every epoch`, 3, 'epoch dates, vote rewards and lock expiry'];
    case 'Farm':
    case 'Leveraged Farming':
    case 'Liquidity Manager':
      return [`Deposit ${cap} into ${n}'s main managed position on ${chain} (a stable pair first), and let the manager rebalance it`, 2, 'position value vs a hold, rebalance cost and pool APR'];
    default:
      return [`Deposit ${cap} of USDC into ${n}'s main product on ${chain} and keep the receipt in the same wallet`, 2, 'position value, the app\'s points page and TVL'];
  }
}

/** Capital size: enough that gas stays under about 1% of it, scaled to the protocol's own depth. */
function capitalFor(p: SnapshotProtocol, gas: number): number {
  let cap = p.tvl_usd >= 1_000_000_000 ? 2_000 : p.tvl_usd >= 200_000_000 ? 1_500 : p.tvl_usd >= 50_000_000 ? 1_000 : p.tvl_usd >= 15_000_000 ? 500 : 250;
  if (gas >= 1) cap = Math.max(cap, 2_500);
  return cap;
}

/** Holding window in weeks: a young protocol's points season has further to run. */
function weeksFor(age: number | null): number {
  if (age === null) return 8;
  if (age < 180) return 12;
  if (age < 540) return 8;
  return 6;
}

export function buildPlan(p: SnapshotProtocol, age: number | null, lane: Lane): Plan {
  const { chain, gas, fund, alt } = chainFor(p);
  const capital = capitalFor(p, gas);
  const weeks = weeksFor(age);
  const [action, txs, track] = actionFor(p, chain, capital);
  const weeklyFee = WEEKLY_TRADING_FEE[p.category ?? ''] ?? 0;
  const mom = p.change_7d;
  const steps: PlanStep[] = [];
  steps.push({
    step: 'Fund',
    action: `Use a fresh wallet that holds only this farm. Withdraw ${money(capital)} of ${FUND_ASSET[chain] ?? 'USDC'} from an exchange straight to ${chain}${alt !== null ? ` (one transaction on ${alt} costs about ${money((GAS[alt] ?? GAS_DEFAULT)[0])})` : ''} and keep ${money(Math.max(2, gas * 20))} of its gas coin for fees.`,
    capital: 0, fees: r2(fund + gas), txs: 1, minutes: 15, span: 'day 0',
  });
  steps.push({ step: 'Enter', action: `${action}.`, capital, fees: r2(txs * gas), txs, minutes: 10 + txs * 5, span: 'day 0' });
  steps.push({
    step: 'Repeat',
    action: `Once a week for ${weeks} weeks, ${WEEKLY_ACTION[familyOf(p.category)]}, so the address is active in every weekly snapshot: ${weeks * 2} transactions in all${weeklyFee > 0 ? `, plus about ${money(weeklyFee)} a week in trading fees` : ''}.`,
    capital: 0, fees: r2(weeks * (2 * gas + weeklyFee)), txs: weeks * 2, minutes: weeks * 10, span: `${weeks} weeks`,
  });
  if (p.chains.length >= 3) {
    const second = p.chains.find((c) => c !== chain && GAS[c] !== undefined && GAS[c][0] < 0.2);
    if (second !== undefined) {
      const [g2, f2] = GAS[second]!;
      steps.push({
        step: 'Spread',
        action: `${p.name} runs on ${p.chains.length} chains: in week 3 move ${money(Math.round(capital * 0.2))} of the position to ${second} (bridge about ${money(f2)}, then about ${money(g2)} a transaction) so the wallet is counted on two deployments.`,
        capital: 0, fees: r2(f2 + 3 * g2), txs: 3, minutes: 20, span: 'week 3',
      });
    }
  }
  steps.push({
    step: 'Track',
    action: `${p.name} records no token in the snapshot; watch its own site for a points page or token news. Track ${track} every week. Its TVL moved ${mom === null ? 'an unreported amount' : `${mom > 0 ? '+' : ''}${mom.toFixed(1)}%`} in the snapshot week; a fall of 25% or more in a week, or a paused withdrawal, is the signal to exit.`,
    capital: 0, fees: 0, txs: 0, minutes: weeks * 5, span: 'weekly',
  });
  steps.push({
    step: 'Exit',
    action: `${lane === 'related' ? 'A related token already trades, so a separate airdrop is less likely: keep this farm at the stated capital. ' : ''}Withdraw, then claim only through links on the app itself; never sign a "claim" from a direct message. Unwinding is ${txs} transactions plus the move back to an exchange.`,
    capital: 0, fees: r2(txs * gas + fund), txs, minutes: 15, span: `after week ${weeks}`,
  });
  const fees = r2(steps.reduce((a, s) => a + s.fees, 0));
  const minutes = steps.reduce((a, s) => a + s.minutes, 0);
  const txTotal = steps.reduce((a, s) => a + s.txs, 0);
  const extra = weeks * weeklyFee;
  const per_chain = p.chains
    .filter((c) => GAS[c] !== undefined)
    .slice(0, 6)
    .map((c) => ({ chain: c, gas: GAS[c]![0], total: r2(txTotal * GAS[c]![0] + 2 * GAS[c]![1] + extra) }));
  return { chain, gas_per_tx: gas, capital, fees_total: fees, hands_on_minutes: minutes, weeks, txs: txTotal, per_chain, steps };
}

/** One-line budget that opens the board's farm_steps. */
export function budgetLine(p: Plan): string {
  const dear = [...p.per_chain].sort((a, b) => b.total - a.total)[0];
  const cmpTo = dear !== undefined && dear.chain !== p.chain && dear.total > p.fees_total * 1.5 ? ` The same plan on ${dear.chain} would burn about ${money(dear.total)} in gas and fees.` : '';
  return `Budget: ${money(p.capital)} of capital for ${p.weeks} weeks on ${p.chain}, about ${money(p.fees_total)} of gas and fees in all (${p.txs} transactions at about ${money(p.gas_per_tx)} each), and ${(p.hands_on_minutes / 60).toFixed(1)} hours hands-on.${cmpTo}`;
}

const r2 = (n: number): number => Math.round(n * 100) / 100;

/** The plan as the board's farm_steps strings: action, then cost and time, 20..600 characters. */
export function stepStrings(plan: Plan): string[] {
  return [budgetLine(plan)].concat(plan.steps.map((s) => {
    const cost = `${s.capital > 0 ? `${money(s.capital)} capital + ` : ''}${s.fees > 0 ? `~${money(s.fees)} gas/fees` : 'no gas'}`;
    let t = `${s.step}: ${s.action} Cost: ${cost}. Time: ${s.minutes} min hands-on, ${s.span}.`;
    if (t.length > 600) t = `${t.slice(0, 597)}...`;
    return t;
  }));
}

// ------------------------------------------------------------------ the board

export interface Econ {
  opp: number;
  cost: number;
  hours: number;
  farmers: number;
  weight: number;
  drop: number[];
  ev: number;
  net: number;
  roi: number;
  per_hour: number;
  per_1k: number;
  verdict: 'Farm' | 'Watch' | 'Skip';
  why: string;
}

export interface Row {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  family: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  lane: Lane;
  watchlist: boolean;
  related_token: string | null;
  implied_value_usd: number;
  implied_low_usd: number;
  implied_high_usd: number;
  log_multiple: number;
  /** [base, size, reach, family, category, momentum, track, related] multipliers, applied to TVL in turn. */
  factors: number[];
  /** Dollar value after each factor; the last equals implied_value_usd. */
  steps: number[];
  odds: number;
  expected_value_usd: number;
  econ: Econ;
  plan: Plan;
}

/** The verdict as one farm_steps string: the cost, the airdrop assumption, the payoff and the call. */
export function verdictLine(r: Row): string {
  const e = r.econ;
  const m = (n: number): string => (n < 0 ? '-' : '') + (Math.abs(n) >= 1e6 ? `$${(Math.abs(n) / 1e6).toFixed(1)}M` : money(Math.abs(n)));
  return `Verdict: ${e.verdict}, ${e.why}. Cost ${m(e.cost)} (${m(r.plan.fees_total)} gas and fees + ${m(e.opp)} of capital idle at ${Math.round(RM.A.opp_rate * 100)}%/yr for ${r.plan.weeks} weeks) and ${e.hours.toFixed(1)} h. ` +
    `If a token comes, ${Math.round(RM.A.share[1] * 100)}% of ${m(r.implied_value_usd)} to the community, split half flat over ~${money(e.farmers).slice(1)} farmers and half pro rata, gives this wallet ~${m(e.drop[1])} (${m(e.drop[0])}-${m(e.drop[2])}); ` +
    `at ${Math.round(r.odds * 100)}% peer odds that is ${m(e.ev)} expected, ${m(e.net)} net, ${m(e.per_hour)}/h.`;
}

export interface Radar {
  rows: Row[];
  fit: ReturnType<typeof summary>;
  peers: SnapshotProtocol[];
  pop: SnapshotProtocol[];
  candidates: { p: SnapshotProtocol; lane: Lane; related: string | null }[];
  excluded: Universe['excluded'];
}

/** What the page prints and checks: fitted terms, priors, shrinkage, held-out scores, odds fit. */
function summary(R: any) {
  const hold = (h: any) => ({ n: h.n, folds: h.folds, mdae: h.mdae, base_mdae: h.base_mdae });
  const groups = (E: any) => Object.fromEntries(Object.entries(E.groups).map(([k, g]: [string, any]) => [k, [g.n, r4(g.mean), r4(g.w), r4(g.u)]]));
  return {
    terms: R.terms,
    beta: R.value.beta.map(r4),
    se: R.value.se.map(r4),
    data_beta: R.flat.beta.map(r4),
    data_se: R.flat.se.map(r4),
    prior: R.value.prior.map((p: number[]) => p.map(r4)),
    elasticity: r4(R.value.e),
    median_7d: r4(R.ctx.med),
    track_odds: { at_0: r4(R.track.p0), at_3y: r4(R.track.p3) },
    tau2: { family: r4(R.value.fam.tau2), category: r4(R.value.cat.tau2) },
    sigma2: r4(R.value.cat.sigma2),
    families: groups(R.value.fam),
    categories: groups(R.value.cat),
    kfold: hold(R.kfold),
    loco: hold(R.loco),
    compare: R.cmp,
    band: R.band.map(r4),
    odds: { lambda: R.odds.lambda, b: R.odds.b.map(r4), fams: R.odds.d.fams, cats: R.odds.d.cats, cv: R.odds_cv },
    holdout: R.kfold.slug.map((s: string, i: number) => [s, r4(R.kfold.pred[i])]),
  };
}

export function buildRadar(s: Snapshot): Radar {
  const peers = peersOf(s);
  const pop = populationOf(s);
  const uni = universe(s);
  const watch = new Set(s.watchlist);
  const plans = uni.ranked.map(({ p, lane }) => buildPlan(p, ageDays(s.as_of, p.listed_at), lane));
  const R = RM.build({
    peers: peers.map((p) => modelInput(s, p)),
    pop: pop.map((p) => ({ ...modelInput(s, p), tok: recordsToken(p) ? 1 : 0 })),
    rows: uni.ranked.map(({ p, lane }, i) => ({ ...modelInput(s, p), lane, plan: plans[i] })),
  });
  const scored = uni.ranked.map((u, i) => ({ ...u, m: R.rows[i], plan: plans[i]! }));
  scored.sort((a, b) => b.m.v - a.m.v || cmp(a.p.slug, b.p.slug));
  const rows: Row[] = scored.map((x, i) => ({
    rank: i + 1,
    slug: x.p.slug,
    name: x.p.name,
    category: x.p.category,
    family: familyOf(x.p.category),
    chains: x.p.chains,
    tvl_usd: x.p.tvl_usd,
    change_7d: x.p.change_7d,
    listed_at: x.p.listed_at,
    age_days: ageDays(s.as_of, x.p.listed_at),
    lane: x.lane,
    watchlist: watch.has(x.p.slug),
    related_token: x.related,
    implied_value_usd: x.m.v,
    implied_low_usd: x.m.lo,
    implied_high_usd: x.m.hi,
    log_multiple: r4(x.m.y),
    factors: x.m.factors.map(r4),
    steps: x.m.steps.map((v: number, k: number) => (k === 7 ? x.m.v : Math.round(v))),
    odds: x.m.odds,
    expected_value_usd: x.m.ev,
    econ: x.m.econ,
    plan: x.plan,
  }));
  return { rows, fit: summary(R), peers, pop, candidates: uni.ranked, excluded: uni.excluded };
}


// ------------------------------------------------------------------ input and checks

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((x) => typeof x !== 'string')) throw new SnapshotError('snapshot.json has no watchlist');
  const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' && v !== '-' ? v : null);
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const protocols = o.protocols.map((v, i) => {
    const p = (v ?? {}) as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || num(p.tvl_usd) === null) throw new SnapshotError(`protocol ${i} lacks a slug, name or TVL`);
    return {
      slug: p.slug,
      name: p.name,
      category: str(p.category),
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: num(p.tvl_usd)!,
      change_7d: num(p.change_7d),
      mcap_usd: num(p.mcap_usd),
      listed_at: str(p.listed_at),
      gecko_id: str(p.gecko_id),
      symbol: str(p.symbol),
    };
  });
  return {
    as_of: o.as_of,
    source: typeof o.source === 'string' ? o.source : '',
    floor_usd: num(o.floor_usd) ?? 50_000_000,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why the gate would refuse this board, or null. */
export function boardIssue(rows: { slug: string; rank: number; implied_value_usd: number; farm_steps: string[] }[], s: Snapshot): string | null {
  if (rows.length < 100 || rows.length > 4000) return `${rows.length} rows; the gate takes 100 to 4000`;
  const known = new Set(s.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const r of rows) {
    if (!known.has(r.slug)) return `${r.slug} is not a snapshot protocol`;
    if (seen.has(r.slug)) return `${r.slug} appears twice`;
    seen.add(r.slug);
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const t of r.farm_steps) if (t.trim().length < 20 || t.trim().length > 600) return `${r.slug} has a ${t.trim().length}-character farm step`;
  }
  const missing = s.watchlist.filter((w) => !seen.has(w));
  if (missing.length > 0) return `watchlist slugs missing: ${missing.join(', ')}`;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i]!.rank !== i + 1) return `row ${i} has rank ${rows[i]!.rank}`;
    if (i > 0 && rows[i]!.implied_value_usd > rows[i - 1]!.implied_value_usd) return `rank ${i + 1} is worth more than rank ${i}`;
  }
  if (rows[0]!.implied_value_usd === rows[rows.length - 1]!.implied_value_usd) return 'every row has the same implied value';
  return null;
}
