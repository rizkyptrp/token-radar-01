// Token Radar's model, version radar-2: one sealed snapshot in, one ranked board out.
//
// The board ranks pre-token protocols — protocols whose DefiLlama record carries no token
// (no market cap, no CoinGecko id, no symbol) — by the implied value of the token they might
// one day issue. It covers every slug on the snapshot's watchlist, then adds the strongest
// pre-token protocols below the watchlist floor, ranked by the same implied value. Protocols
// whose token already trades are never ranked; they are shown apart, at the market's own
// price, so the board never mixes a model's claim with a market's fact.
//
// Implied value is one function of the snapshot's own figures, the same for every protocol:
//
//   base      = tvl_usd x BASE_MULTIPLE                 (0.30: a launch is priced off TVL)
//   growth    = clamp(change_7d, -60, +150) per cent    (null change reads as 0)
//   growthM   = 1 + growth / 100 x GROWTH_WEIGHT        (0.60: a hot week lifts value)
//   maturityM = 0.70 + min(age_days, 1095) / 1095 x 0.30 (older with no token: steadier)
//   breadthM  = 1 + min(chains - 1, 6) x 0.02            (each extra chain: +2%, to +12%)
//   implied   = max(1, round(base x growthM x maturityM x breadthM))
//
// Age is days from listed_at to the snapshot's as_of date — never the wall clock, so two runs
// of the program write the same bytes. No protocol name is ever special-cased: the same
// function scores every row, and the dashboard's sandbox re-runs it live with its own sliders.

/** One protocol of the snapshot: exactly the ten fields the sealed input carries. */
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

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants: stated in the dashboard, and the sandbox may change them. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  breadth_step: number;
  breadth_max_chains: number;
  unknown_age_days: number;
}

export const MODEL: ModelConstants = {
  base_multiple: 0.3,
  growth_weight: 0.6,
  growth_floor: -60,
  growth_cap: 150,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1095,
  breadth_step: 0.02,
  breadth_max_chains: 6,
  unknown_age_days: 365,
};

export const MODEL_VERSION = 'radar-2';

/** Pre-token protocols below the watchlist floor the early radar carries, by implied value. */
export const EARLY_ROWS = 160;

/** Live-token protocols the dashboard's Live tab carries, by market cap. */
export const LIVE_ROWS = 24;

/** One row of board.json. */
export interface BoardRow {
  rank: number;
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
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_usd: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    age_days: number | null;
  };
  farm: { capital_usd: number; gas_usd: number; hold_days: number };
  farm_steps: string[];
}

/** A board row's compact form for data.js; the page rebuilds the farm plan from the same inputs. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  on_watchlist: boolean;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  growth_pct: number;
  base_usd: number;
  capital_usd: number;
  gas_usd: number;
  hold_days: number;
}

/** A protocol whose token already trades: shown at its market cap, never ranked. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the model and the totals. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  total_implied_usd: number;
  median_implied_usd: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why a snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

export interface Scored {
  implied: number;
  base: number;
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  breadthMult: number;
  age: number | null;
}

/** The four factors and the implied value one protocol gets under `model`. */
export function impliedValue(p: SnapshotProtocol, asOf: string, model: ModelConstants): Scored {
  const age = ageDays(asOf, p.listed_at);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, finite(p.change_7d, 0)));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturityMult = model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const extraChains = Math.min(Math.max(p.chains.length - 1, 0), model.breadth_max_chains);
  const breadthMult = 1 + extraChains * model.breadth_step;
  const base = p.tvl_usd * model.base_multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * breadthMult));
  return { implied, base: Math.round(base), growthPct, growthMult, maturityMult, breadthMult, age };
}

/** A name ending in a version marker is a pool of another protocol, not a launch of its own. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether the record carries no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether the board may rank a protocol: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest implied value first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug it names, whatever its score.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: pre-token protocols below the floor, strongest implied value first.
  // Ranked by the model's own number, not by raw TVL, so a fast-growing small protocol
  // can outrank a flat big one — that is what a radar is for.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .map((p) => ({ p, implied: impliedValue(p, snapshot.as_of, model).implied }))
    .sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);
  for (const e of early) chosen.set(e.p.slug, e.p);

  const watchlist = new Set(snapshot.watchlist);
  const scored = [...chosen.values()].map((p) => ({ p, s: impliedValue(p, snapshot.as_of, model) }));
  scored.sort((a, b) => b.s.implied - a.s.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((entry, i) => {
    const { p, s } = entry;
    const plan = farmPlan(p, s.age);
    return {
      rank: i + 1,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      mcap_usd: p.mcap_usd,
      listed_at: p.listed_at,
      gecko_id: p.gecko_id,
      symbol: p.symbol,
      token_status: 'pre-token',
      on_watchlist: watchlist.has(p.slug),
      age_days: s.age,
      implied_value_usd: s.implied,
      model: {
        base_usd: s.base,
        growth_pct: s.growthPct,
        growth_multiplier: round4(s.growthMult),
        maturity_multiplier: round4(s.maturityMult),
        breadth_multiplier: round4(s.breadthMult),
        age_days: s.age,
      },
      farm: { capital_usd: plan.capital, gas_usd: plan.gas, hold_days: plan.hold },
      farm_steps: plan.steps.map(stepText),
    };
  });
}

// ---------------------------------------------------------------- farm plans

/** One farm step: the action, what it costs, how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

export interface FarmPlan {
  capital: number;
  gas: number;
  hold: number;
  steps: FarmStep[];
}

/** A step as one string: action, then cost and time, inside the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
export function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 2_000_000_000) return 250;
  if (p.tvl_usd >= 500_000_000) return 150;
  if (p.tvl_usd >= 50_000_000) return 100;
  return 50;
}

/** Chains where a transaction costs about a dollar or less. */
const CHEAP_GAS = new Set([
  'Solana', 'Sui', 'Aptos', 'Base', 'Arbitrum', 'Optimism', 'Polygon', 'zkSync Era', 'Linea',
  'Scroll', 'Blast', 'Mode', 'Mantle', 'Starknet', 'Binance', 'Avalanche', 'Fantom', 'Celo',
  'Gnosis', 'xDai', 'Sei', 'Injective', 'Near', 'Cosmos', 'Osmosis', 'Kava', 'Boba', 'Metis',
  'Zora', 'Manta', 'Taiko', 'Soneium', 'Unichain', 'World Chain', 'Katana', 'MegaETH', 'Monad',
  'Plasma', 'Stable', 'Tempo', 'BSC', 'Tron', 'Hedera', 'Algorand', 'Stellar', 'TON',
]);

/** A rough gas price in dollars for one transaction on the protocol's first chain. */
export function gasFor(p: SnapshotProtocol): number {
  const chain = chainOf(p);
  if (chain === 'Ethereum') return 12;
  if (CHEAP_GAS.has(chain)) return 1;
  return 3;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
export function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 90) return 90;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's one action, in words a farmer can follow. Matched on the category string only. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Supply $${capital} of USDC to ${n} on ${chain} as a lender, then borrow a small amount against it to register both sides of the market.`;
  }
  if (c.includes('dex') || c.includes('liquidity manager') || c.includes('leveraged farm') || c.includes('yield') || c === 'farm') {
    return `Provide $${capital} of liquidity to ${n}'s deepest pool on ${chain} and keep the LP position open.`;
  }
  if (c.includes('bridge')) {
    return `Bridge $${capital} of USDC into ${chain} through ${n}, then use the bridged funds in its own app so the volume is yours.`;
  }
  if (c.includes('liquid staking') || c.includes('liquid restaking') || c.includes('restak') || c.includes('staking pool')) {
    return `Stake $${capital} of the chain's staking asset through ${n} on ${chain} and hold the receipt token it issues.`;
  }
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options') || c.includes('synthetic') || c.includes('basis')) {
    return `Deposit $${capital} of USDC as margin on ${n} on ${chain} and open one small hedged position, then close it after a day.`;
  }
  if (c.includes('prediction')) return `Fund $${capital} on ${n} and place one market position on ${chain}, then let it settle.`;
  if (c.includes('curator') || c.includes('allocator')) {
    return `Deposit $${capital} into a ${n} vault on ${chain} and hold the vault shares for the full qualifying window.`;
  }
  if (c.includes('stablecoin') || c.includes('algo-stables')) {
    return `Mint or hold $${capital} of the stable asset ${n} issues on ${chain} and keep it in your wallet.`;
  }
  if (c.includes('rwa')) return `Mint $${capital} of ${n}'s yield-bearing asset on ${chain} and hold it in your wallet.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${n} on ${chain} and keep the policy active.`;
  if (c.includes('launchpad')) return `Stake or hold $${capital} through ${n}'s launchpad on ${chain} and join one sale allocation.`;
  if (c.includes('nft')) return `List or buy one item worth about $${capital} on ${n} on ${chain} and keep the trade receipt.`;
  if (c.includes('payment') || c.includes('card')) return `Move $${capital} through ${n} on ${chain} as a payment and keep the receipt.`;
  if (c.includes('locker')) return `Lock $${capital} of tokens in ${n}'s locker on ${chain} for the shortest term it offers.`;
  if (c.includes('governance')) return `Deposit $${capital} into ${n}'s incentive pool on ${chain} and cast one vote.`;
  if (c.includes('index')) return `Buy $${capital} of ${n}'s index token on ${chain} and hold it.`;
  if (c.includes('chain')) return `Bridge $${capital} to ${n}'s chain and use one of its native apps for a week.`;
  if (c.includes('privacy') || c.includes('ai')) return `Run $${capital} through ${n} on ${chain} and use its main feature at least once a week.`;
  if (c.includes('otc')) return `Complete one $${capital} trade on ${n}'s marketplace on ${chain}.`;
  if (c.includes('reserve') || c === 'dor') return `Hold $${capital} of ${n}'s reserve asset on ${chain} in your wallet.`;
  return `Deposit $${capital} of USDC into ${n} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, seven when it runs on more than one chain. Every number
 * comes from the protocol's own record — category, chains, TVL and age — never from a list of names.
 */
export function farmPlan(p: SnapshotProtocol, age: number | null): FarmPlan {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const gas = gasFor(p);
  const hold = holdDaysFor(age);
  const second = p.chains.length > 1 ? p.chains[1]! : null;
  const steps: FarmStep[] = [
    {
      text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.',
      cost: `about $${gas} of gas for the first transaction`,
      time: '5 minutes',
    },
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about $${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote, so your wallet stays active.',
      cost: `about $${gas} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
  ];
  if (second !== null) {
    steps.push({
      text: `Repeat a smaller position on ${second}, the protocol's second chain, so your activity is counted on two networks.`,
      cost: `$${Math.round(capital / 2)} more capital and about $${gas} of gas`,
      time: '15 minutes',
    });
  }
  steps.push(
    {
      text: "Before you withdraw, open the protocol's own points or rewards page and claim only from the link it publishes.",
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    },
    {
      text: 'Write the wallet, the dates and every transaction in a farm log, then unwind half the position first and check the exit works.',
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  );
  return { capital, gas, hold, steps };
}

// ---------------------------------------------------------------- live set and dashboard data

/** The live-token protocols, by market cap, for the dashboard's Live tab. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    on_watchlist: row.on_watchlist,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    growth_pct: row.model.growth_pct,
    base_usd: row.model.base_usd,
    capital_usd: row.farm.capital_usd,
    gas_usd: row.farm.gas_usd,
    hold_days: row.farm.hold_days,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.on_watchlist).length;
  const values = board.map((r) => r.implied_value_usd).sort((a, b) => a - b);
  const median = values.length % 2 === 1 ? values[(values.length - 1) / 2]! : Math.round((values[values.length / 2 - 1]! + values[values.length / 2]!) / 2);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    total_implied_usd: board.reduce((n, r) => n + r.implied_value_usd, 0),
    median_implied_usd: median,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

// ---------------------------------------------------------------- parsing and validation

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
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
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, flat values, farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'the board repeats a slug';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const invented = board.filter((r) => !known.has(r.slug)).map((r) => r.slug);
  if (invented.length > 0) return `the board names protocols the snapshot does not: ${invented.slice(0, 5).join(', ')}`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (typeof r.name !== 'string' || r.name.length === 0) return `${r.slug} has no name`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
