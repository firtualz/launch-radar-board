// The token radar's model (round 1): one snapshot of the protocol universe in, one ranked board out.
//
// The board is CLEAN: the watchlist exclusion logic applies to every row, not just the watchlist.
// A protocol is dropped when it is an exchange, a bridge, a liquid staking/restaking product, a
// wrapped or staked product, or a versioned pool of another protocol. What is left is ranked by the
// implied value of its launch, fitted from the protocols that already trade (the comps).
//
//   comps      = mcap_usd > 0 and tvl_usd > 0, minus the excluded categories, minus a market-cap/TVL
//                ratio outside [0.005, 5]  (85 of 128)
//   curve      = 10 ^ (a + b * log10(tvl_usd)), a and b fitted by OLS on the comps in log space
//   growth     = clamp(change_7d, -60, 120) per cent, weight 0.5; null change means no growth
//   maturity   = 0.6 + min(age_days, 1095) / 1095 * 0.4   (age unknown: 365 days)
//   category   = 1 + (median ratio of the category / median ratio of all comps - 1) * n / (n + 5),
//                only for categories with 5 or more comps, capped at +-25%
//   implied    = max(1, round(curve * clamp(growth * maturity * category, 0.5, 2.0)))
//
// When the comps are too few (< 30) or the fit fails, the model falls back to the starter's formula
// (0.25 * TVL, growth and maturity only) and says so in the validation record. No protocol name is
// ever special-cased: the same function scores every row. Stablecoins are flagged, never fitted:
// the curve is fitted without them and a stablecoin row says so.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
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

/** The farm cost table (low / base / high), in dollars unless noted. */
export interface CostTable {
  gas_tx: Record<string, [number, number, number]>;
  minutes_per_step: [number, number, number];
  dollars_per_hour: [number, number, number];
  lockup_usd: [number, number, number];
}

export const COSTS: CostTable = {
  gas_tx: {
    ethereum: [1.0, 2.5, 5.0],
    arbitrum: [0.02, 0.05, 0.1],
    base: [0.02, 0.05, 0.1],
    optimism: [0.02, 0.05, 0.1],
    unichain: [0.02, 0.05, 0.1],
    solana: [0.001, 0.005, 0.01],
    bsc: [0.05, 0.1, 0.2],
    other: [0.05, 0.15, 0.5],
  },
  minutes_per_step: [5, 10, 15],
  dollars_per_hour: [10, 15, 25],
  lockup_usd: [0, 3, 10],
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = 'radar-2';

/** The categories the clean board drops, wherever they appear. */
export const EXCLUDED_CATEGORIES = new Set([
  'CEX',
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
]);

/** The comps filter (F2) and the board cleaning (K0) use one rule now: the seven K0
 *  categories. Four cross-chain bridges trade with a value (across, hyperlane, symbiosis,
 *  synapse) and are dropped from the comps too, so the fit is on 81 comps, not 85. */

const VERSIONED_SLUG = /-v\d+$/i;
const NAME_EXCLUDE = /bridge|wrapped|staked/i;

/** The comps filter's ratio band for market cap over TVL. */
export const RATIO_LOW = 0.005;
export const RATIO_HIGH = 5;
/** Below this many comps the fit is not trusted and the starter formula is used instead. */
export const MIN_COMPS = 30;

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
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
  age_days: number | null;
  implied_value_usd: number;
  model: {
    curve_usd: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    category_factor: number;
    combined_multiplier: number;
    age_days: number | null;
  };
  roi_index: number;
  /** B2 (revisi). The farm/thin/skip verdict, computed from this row's own ROI index,
   *  stablecoin flag, TVL, age and 7-day change by the same rule the dashboard states.
   *  It lives in the row so board.json and data.js cannot disagree about it. */
  verdict: Verdict;
  farm_cost_usd: number;
  farm_cost_low_usd: number;
  farm_cost_high_usd: number;
  farm_hours: number;
  stablecoin: boolean;
  farm_steps: string[];
}

/** The fit and the validation numbers, as the dashboard's validation panel states them. */
export interface FitReport {
  comps_before: number;
  comps_after: number;
  dropped_by_category: number;
  dropped_by_ratio: number;
  dropped_by_category_detail: Record<string, number>;
  intercept: number;
  slope: number;
  r2: number;
  loo_median_ape: number;
  loo_p25_ape: number;
  loo_p75_ape: number;
  loo_mean_ape: number;
  median_fold_error: number;
  p25_fold_error: number;
  p75_fold_error: number;
  category_factors: Record<string, number>;
  fallback: boolean;
  /** The same fit on all 128 comps with a value, no filter: the before side of the filter effect. */
  unfiltered: {
    n: number;
    intercept: number;
    slope: number;
    r2: number;
    loo_median_ape: number;
    loo_p25_ape: number;
    loo_p75_ape: number;
    loo_mean_ape: number;
    median_fold_error: number;
    p25_fold_error: number;
    p75_fold_error: number;
  };
}

/** One pre-token protocol's audit record: where it ended up, and why. */
export interface AuditRow {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  disposition: 'board' | 'dropped';
  reason: string;
}

/** Everything the dashboard needs: the board and the model it runs. The rows are the full board
 *  rows, so the detail view reads the farm plan and the factor breakdown from the same data the
 *  board table reads: one source, no fetch, no second copy. The verdict lives in each board row
 *  (field `verdict`) and is surfaced here in data.js with its rule and reasons, so the board and
 *  the dashboard cannot disagree about it. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  fit: FitReport;
  board_size: number;
  watchlist_size: number;
  watchlist: string[];
  clean_size: number;
  dropped_clean: number;
  rows: BoardRow[];
  audit: AuditRow[];
  /** B2. The verdict, per slug, with the rule that fired and the counts: surfaced from the
   *  board rows' `verdict` field, so data.js and board.json always agree. */
  verdict: {
    rules: {
      farm_roi: number;
      skip_roi: number;
      skip_change_7d: number;
      farm_change_7d: number;
      small_tvl_usd: number;
      small_roi: number;
      min_age_days: number;
    };
    counts: { farm: number; thin: number; skip: number };
    by_slug: Record<string, Verdict>;
    reasons: Record<string, string>;
  };
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Whether a protocol is one the clean board drops: an exchange, a bridge, a staking product, a
 *  wrapped or staked product, or a versioned pool of another protocol. */
export function isExcluded(p: SnapshotProtocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return true;
  if (NAME_EXCLUDE.test(p.name)) return true;
  if (VERSIONED_SLUG.test(p.slug)) return true;
  return false;
}

/** Whether a protocol is a stablecoin: its name or category says so, or it is USDD. */
export function isStablecoin(p: SnapshotProtocol): boolean {
  return /stablecoin|stable coin/i.test(p.name) || /stable/i.test(p.category ?? '') || p.slug === 'usdd';
}

/** B2. The farm verdict: farm / thin / skip. A transparent rule, not an airdrop prediction.
 *  It measures value efficiency against cost from the snapshot alone: the ROI index (median 100),
 *  the stablecoin flag, TVL, listing age and the 7-day change. The thresholds are constants
 *  below, so the verdict is reproducible and the dashboard can state the rule. */
export type Verdict = 'farm' | 'thin' | 'skip';

/** farm needs an ROI index at least this high (twice the median value per cost). */
export const VERDICT_FARM_ROI = 200;
/** skip when the ROI index is below this (less than half the median value per cost). */
export const VERDICT_SKIP_ROI = 50;
/** skip when the 7-day change falls below this (the protocol is falling hard). */
export const VERDICT_SKIP_CHANGE_7D = -30;
/** farm needs a 7-day change at least this (not falling). */
export const VERDICT_FARM_CHANGE_7D = -20;
/** a protocol is small below this TVL. */
export const VERDICT_SMALL_TVL_USD = 10_000_000;
/** a small protocol is skipped when its ROI index is below this (below the median). */
export const VERDICT_SMALL_ROI = 100;
/** farm needs the protocol to be at least this old (listed days); unknown age counts as 365. */
export const VERDICT_MIN_AGE_DAYS = 90;

export function verdictFor(row: {
  roi_index: number;
  stablecoin: boolean;
  tvl_usd: number;
  age_days: number | null;
  change_7d: number | null;
}): Verdict {
  const age = row.age_days ?? 365;
  if (row.stablecoin) return 'skip';
  if (row.roi_index < VERDICT_SKIP_ROI) return 'skip';
  if (row.change_7d !== null && row.change_7d < VERDICT_SKIP_CHANGE_7D) return 'skip';
  if (row.tvl_usd < VERDICT_SMALL_TVL_USD && row.roi_index < VERDICT_SMALL_ROI) return 'skip';
  if (
    row.roi_index >= VERDICT_FARM_ROI &&
    (row.change_7d === null || row.change_7d >= VERDICT_FARM_CHANGE_7D) &&
    row.tvl_usd >= VERDICT_SMALL_TVL_USD &&
    age >= VERDICT_MIN_AGE_DAYS
  ) {
    return 'farm';
  }
  return 'thin';
}

/** Why a row got its verdict, naming the rule that fired and the row's own numbers. The reason
 *  names the protocol, so no two rows share the same reason text (the stablecoin reason used to
 *  be one fixed sentence for every stablecoin row). */
export function verdictReason(
  row: { name: string; roi_index: number; stablecoin: boolean; tvl_usd: number; age_days: number | null; change_7d: number | null },
  verdict: Verdict,
): string {
  const age = row.age_days ?? 365;
  const change = row.change_7d === null ? 'not recorded' : `${row.change_7d > 0 ? '+' : ''}${row.change_7d}%`;
  if (row.stablecoin) return `${row.name} is a stablecoin holding $${Math.round(row.tvl_usd).toLocaleString('en-US')} TVL: the curve was fitted without stablecoins, so its implied value is not comparable — skipped.`;
  let body: string;
  if (row.roi_index < VERDICT_SKIP_ROI) body = `ROI index ${row.roi_index} is below ${VERDICT_SKIP_ROI}: the implied value per dollar of farm cost is less than half the median — skipped.`;
  else if (row.change_7d !== null && row.change_7d < VERDICT_SKIP_CHANGE_7D) body = `7-day change ${change} is below ${VERDICT_SKIP_CHANGE_7D}%: the protocol is falling hard — skipped.`;
  else if (row.tvl_usd < VERDICT_SMALL_TVL_USD && row.roi_index < VERDICT_SMALL_ROI) {
    body = `TVL $${Math.round(row.tvl_usd).toLocaleString('en-US')} is below $10M and ROI index ${row.roi_index} is below ${VERDICT_SMALL_ROI}: small and below-median value per cost — skipped.`;
  } else if (verdict === 'farm') {
    body = `ROI index ${row.roi_index} is at least ${VERDICT_FARM_ROI}, 7-day change ${change} is at least ${VERDICT_FARM_CHANGE_7D}%, TVL $${Math.round(row.tvl_usd).toLocaleString('en-US')} is at least $10M, listed ${age} days ago (at least ${VERDICT_MIN_AGE_DAYS}) — farm.`;
  } else if (row.roi_index >= VERDICT_FARM_ROI) {
    const blocks: string[] = [];
    if (row.change_7d !== null && row.change_7d < VERDICT_FARM_CHANGE_7D) blocks.push(`7-day change ${change} is below ${VERDICT_FARM_CHANGE_7D}%`);
    if (row.tvl_usd < VERDICT_SMALL_TVL_USD) blocks.push(`TVL $${Math.round(row.tvl_usd).toLocaleString('en-US')} is below $10M`);
    if (age < VERDICT_MIN_AGE_DAYS) blocks.push(`listed ${age} days ago (below ${VERDICT_MIN_AGE_DAYS})`);
    body = `ROI index ${row.roi_index} is at least ${VERDICT_FARM_ROI}, but ${blocks.join('; ')}: not a farm — thin.`;
  } else {
    body = `ROI index ${row.roi_index} is between ${VERDICT_SKIP_ROI} and ${VERDICT_FARM_ROI}: the value per cost is ordinary — thin.`;
  }
  return `${row.name}: ${body}`;
}

/** The comps the curve is fitted on, and how many the filter dropped for each reason. */
export function filterComps(protocols: SnapshotProtocol[]): { comps: SnapshotProtocol[]; before: number; byCategory: number; byRatio: number; byCategoryDetail: Record<string, number> } {
  const withValue = protocols.filter((p) => (p.mcap_usd ?? 0) > 0 && (p.tvl_usd ?? 0) > 0);
  const comps: SnapshotProtocol[] = [];
  let byCategory = 0;
  let byRatio = 0;
  const byCategoryDetail: Record<string, number> = {};
  for (const p of withValue) {
    if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) {
      byCategory++;
      byCategoryDetail[p.category] = (byCategoryDetail[p.category] ?? 0) + 1;
      continue;
    }
    const ratio = (p.mcap_usd as number) / (p.tvl_usd as number);
    if (ratio < RATIO_LOW || ratio > RATIO_HIGH) {
      byRatio++;
      continue;
    }
    comps.push(p);
  }
  return { comps, before: withValue.length, byCategory, byRatio, byCategoryDetail };
}

/** Ordinary least squares on two equal-length arrays: intercept, slope and R squared. */
function ols(xs: number[], ys: number[]): { a: number; b: number; r2: number } {
  const n = xs.length;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let sst = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i]! - mx) * (ys[i]! - my);
    sxx += (xs[i]! - mx) * (xs[i]! - mx);
    sst += (ys[i]! - my) * (ys[i]! - my);
  }
  const b = sxx === 0 ? 0 : sxy / sxx;
  const a = my - b * mx;
  let ssr = 0;
  for (let i = 0; i < n; i++) ssr += (ys[i]! - (a + b * xs[i]!)) ** 2;
  return { a, b, r2: sst === 0 ? 0 : 1 - ssr / sst };
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function percentile(sorted: number[], q: number): number {
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

/** The curve fit and its leave-one-out validation, from the already-filtered comps. */
export function fitCurve(comps: SnapshotProtocol[]): FitReport {
  const xs = comps.map((p) => Math.log10(p.tvl_usd));
  const ys = comps.map((p) => Math.log10(p.mcap_usd as number));
  const { a, b, r2 } = ols(xs, ys);
  const apes: number[] = [];
  const folds: number[] = [];
  for (let i = 0; i < comps.length; i++) {
    const xsLoo = xs.filter((_, j) => j !== i);
    const ysLoo = ys.filter((_, j) => j !== i);
    const f = ols(xsLoo, ysLoo);
    const pred = 10 ** (f.a + f.b * xs[i]!);
    const actual = comps[i]!.mcap_usd as number;
    apes.push(Math.abs(pred - actual) / actual);
    folds.push(Math.abs(Math.log10(pred / actual)));
  }
  const apesSorted = [...apes].sort((x, y) => x - y);
  const foldsSorted = [...folds].sort((x, y) => x - y);
  return {
    comps_before: 0,
    comps_after: comps.length,
    dropped_by_category: 0,
    dropped_by_ratio: 0,
    dropped_by_category_detail: {},
    intercept: a,
    slope: b,
    r2,
    loo_median_ape: median(apes),
    loo_p25_ape: percentile(apesSorted, 0.25),
    loo_p75_ape: percentile(apesSorted, 0.75),
    loo_mean_ape: apes.reduce((s, v) => s + v, 0) / apes.length,
    median_fold_error: 10 ** median(folds),
    p25_fold_error: 10 ** percentile(foldsSorted, 0.25),
    p75_fold_error: 10 ** percentile(foldsSorted, 0.75),
    category_factors: {},
    fallback: false,
    unfiltered: { n: 0, intercept: 0, slope: 0, r2: 0, loo_median_ape: 0, loo_p25_ape: 0, loo_p75_ape: 0, loo_mean_ape: 0, median_fold_error: 0, p25_fold_error: 0, p75_fold_error: 0 },
  };
}

/** The category factors from the comps: median ratio of the category over the global median ratio,
 *  shrunk by n / (n + 5), capped at +-25%, only for categories with 5 or more comps. */
export function categoryFactors(comps: SnapshotProtocol[]): Record<string, number> {
  const ratios = comps.map((p) => (p.mcap_usd as number) / p.tvl_usd);
  const global = median(ratios);
  const byCat = new Map<string, number[]>();
  for (const p of comps) {
    const key = p.category ?? 'unknown';
    const arr = byCat.get(key) ?? [];
    arr.push((p.mcap_usd as number) / p.tvl_usd);
    byCat.set(key, arr);
  }
  const out: Record<string, number> = {};
  for (const [cat, arr] of [...byCat.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (arr.length < 5) continue;
    const raw = 1 + (median(arr) / global - 1) * (arr.length / (arr.length + 5));
    out[cat] = Math.max(0.75, Math.min(1.25, raw));
  }
  return out;
}

/** The gas price of one transaction on a chain, at the low (0), base (1) or high (2) level. */
function gasTx(chain: string, level: 0 | 1 | 2): number {
  const c = chain.toLowerCase();
  const table = COSTS.gas_tx;
  if (c.includes('ethereum') || c === 'eth') return table.ethereum[level]!;
  if (c.includes('arbitrum')) return table.arbitrum[level]!;
  if (c.includes('base')) return table.base[level]!;
  if (c.includes('optimism') || c === 'op') return table.optimism[level]!;
  if (c.includes('unichain') || c.includes('uni')) return table.unichain[level]!;
  if (c.includes('solana') || c === 'sol') return table.solana[level]!;
  if (c.includes('bsc') || c.includes('bnb') || c.includes('binance')) return table.bsc[level]!;
  return table.other[level]!;
}

/** The cost of farming one protocol: gas for each step's transaction, the time at its hourly value,
 *  and the lockup opportunity cost. Level 0 is low, 1 is base, 2 is high. */
export function farmCost(p: SnapshotProtocol, steps: number, level: 0 | 1 | 2): { usd: number; hours: number } {
  const chains = p.chains.length > 0 ? p.chains : ['other'];
  let gas = 0;
  for (let i = 0; i < steps; i++) gas += gasTx(chains[i % chains.length]!, level);
  const minutes = steps * COSTS.minutes_per_step[level]!;
  const hours = minutes / 60;
  const usd = gas + hours * COSTS.dollars_per_hour[level]! + COSTS.lockup_usd[level]!;
  return { usd: Math.round(usd * 100) / 100, hours: Math.round(hours * 100) / 100 };
}

/** How much capital one farm position needs, from the protocol's own TVL band. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The category's one action, in cautious words: the snapshot names a category, not a mechanism,
 *  so every action says "if the protocol offers it" and tells the farmer to check the docs first. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const docs = `check the protocol's own docs first for the exact steps.`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `If ${name} lets you supply USDC on ${chain}, deposit $${capital} and ${docs}`;
  if (c.includes('dex')) return `If ${name} lets you provide liquidity on ${chain}, add $${capital} to its main pool; ${docs}`;
  if (c.includes('yield') || c.includes('leveraged farm')) return `If ${name} offers a vault on ${chain}, deposit $${capital} of USDC; ${docs}`;
  if (c.includes('perpetual') || c.includes('derivative')) return `If ${name} lets you trade with margin on ${chain}, deposit $${capital} of USDC as margin and open one small hedged position; ${docs}`;
  if (c.includes('prediction')) return `If ${name} lists open markets, fund $${capital} and place one position; ${docs}`;
  if (c.includes('curator') || c.includes('allocator')) return `If ${name} offers a vault on ${chain}, deposit $${capital} and keep the vault shares; ${docs}`;
  if (c.includes('stable')) return `If ${name} lets you mint or deposit its stable asset on ${chain}, put in $${capital}; ${docs}`;
  if (c.includes('rwa')) return `If ${name} offers its yield asset on ${chain}, mint $${capital} and hold it; ${docs}`;
  if (c.includes('insurance')) return `If ${name} sells cover on ${chain}, buy $${capital} of cover and keep the policy; ${docs}`;
  if (c.includes('basis')) return `If ${name} offers a basis position on ${chain}, deposit $${capital} of USDC; ${docs}`;
  if (c.includes('restak') || c.includes('staking')) return `If ${name} lets you stake on ${chain}, stake $${capital} of the chain's staking asset and keep the receipt; ${docs}`;
  return `If ${name} accepts deposits on ${chain}, deposit $${capital} of USDC; ${docs}`;
}

/** A richer action for the top 40: the mechanism again, on a second chain or with a second leg,
 *  in the same cautious words as the main action. */
function actionDetail(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const docs = `check the protocol's own docs first.`;
  if (c.includes('dex')) return `If ${name} has a router on ${chain}, swap once through it so the wallet is recorded, then add the same $${capital} as liquidity; ${docs}`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `If ${name} lets you adjust a borrow, repay a small part and re-borrow it, so the position shows two-way activity; ${docs}`;
  if (c.includes('yield') || c.includes('leveraged farm')) return `If ${name} lets you claim yield, claim the accrued yield once and redeposit it; ${docs}`;
  if (c.includes('perpetual') || c.includes('derivative')) return `If ${name} lets you close and reopen a position, close the hedge and reopen it smaller, so the account shows two fills; ${docs}`;
  if (c.includes('curator') || c.includes('allocator')) return `If ${name} offers a second vault on ${chain}, move another $${Math.floor(capital / 2)} into it to spread the position; ${docs}`;
  if (c.includes('rwa')) return `If ${name} publishes a backing report, read it and hold the position through its next update; ${docs}`;
  return `If ${name} offers a second action on ${chain}, repeat the main action with half the capital; ${docs}`;
}

/** The wallet step, varied by how many chains the protocol runs on and how large it is — and
 *  always naming the protocol, its capital and its TVL, so no two rows share the sentence.
 *  Only snapshot data is cited; nothing is invented about the protocol. */
function walletText(p: SnapshotProtocol, chains: string[], capital: number): string {
  const tvl = Math.round(p.tvl_usd).toLocaleString('en-US');
  const n = chains.length;
  if (n >= 3) return `Use one fresh wallet across ${p.name}'s ${n} chains (or a separate wallet per chain), holding only the $${capital} you plan to farm (TVL $${tvl}), and keep every seed phrase offline.`;
  if (n === 2) return `Use one fresh wallet for ${p.name} on ${chains[0]} and ${chains[1]}, holding only the $${capital} you plan to farm (TVL $${tvl}), and keep its seed phrase offline.`;
  if (p.tvl_usd >= 1_000_000_000) return `For ${p.name}, a protocol with $${tvl} TVL, use a fresh wallet on ${chains[0]} that holds only the $${capital} you plan to farm, and keep its seed phrase offline.`;
  return `Use a fresh wallet on ${chains[0]} for ${p.name}, holding only the $${capital} you plan to farm (TVL $${tvl}), and keep its seed phrase offline.`;
}

/** The hold step, built from the protocol's own numbers: its name, its listing age, its TVL and
 *  its 7-day change, so the sentence is about this protocol and no other. The hold itself still
 *  comes from the age alone (30/45/60 days via holdDaysFor) — the numbers justify it, they do
 *  not invent it. */
function holdText(p: SnapshotProtocol, age: number | null, hold: number, capital: number): string {
  const tvl = Math.round(p.tvl_usd).toLocaleString('en-US');
  const change = p.change_7d === null ? null : `${p.change_7d > 0 ? '+' : ''}${p.change_7d}%`;
  if (age === null) {
    const changePart = change === null ? `7-day change not recorded` : `7-day change ${change}`;
    return `Hold the $${capital} position in ${p.name} for at least ${hold} days. ${p.name}'s listing date is not recorded (TVL $${tvl}, ${changePart}), so keep the position through the next snapshot to make sure the activity registers.`;
  }
  if (age < 180) return `Hold the $${capital} position in ${p.name} for at least ${hold} days. ${p.name} was listed ${age} days ago with $${tvl} TVL, so the longer window is what counts — the activity needs two snapshots to register.`;
  if (age < 365) {
    const changePart = change === null ? `7-day change not recorded` : `7-day change ${change}`;
    return `Hold the $${capital} position in ${p.name} for at least ${hold} days. ${p.name} was listed ${age} days ago and holds $${tvl} TVL (${changePart}), so the position needs to stay through the next snapshot.`;
  }
  return `Hold the $${capital} position in ${p.name} for at least ${hold} days. ${p.name} was listed ${age} days ago and holds $${tvl} TVL, so a month is enough to register the activity.`;
}

/** The claim step, varied by the protocol's category: each branch names the kind of claim to
 *  look for in that category, and every branch names the protocol, so no two rows share the
 *  sentence. Cautious words: a branch only says what kind of claim to look for — it never
 *  guarantees the mechanism exists. Every claim is taken only from the link the protocol
 *  itself publishes. */
function claimText(p: SnapshotProtocol, chains: string[]): string {
  const c = (p.category ?? '').toLowerCase();
  const chain = chainOf(p);
  const tvl = Math.round(p.tvl_usd).toLocaleString('en-US');
  const multi = chains.length > 1 ? ` Check the rewards page on each of the ${chains.length} chains you farmed.` : ``;
  const log = ` Then write the wallet, the dates and every transaction in a farm log.`;
  const fromLink = `claim only from the link ${p.name} publishes`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Before you withdraw from ${p.name}, open its rewards page and ${fromLink}, then unwind any borrow before the deposit.${multi}${log}`;
  if (c.includes('dex')) return `Before you withdraw from ${p.name} on ${chain}, open the pool's rewards page and ${fromLink}; a DEX may also pay trading fees, so check the fee claim too.${multi}${log}`;
  if (c.includes('yield') || c.includes('leveraged farm')) return `Before you withdraw from ${p.name}, open the vault page and claim the accrued yield once, ${fromLink}.${multi}${log}`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Before you withdraw from ${p.name}, close the hedge on ${chain} first, then ${fromLink}.${multi}${log}`;
  if (c.includes('prediction')) return `Before you withdraw from ${p.name}, settle any open market positions first, then ${fromLink}.${multi}${log}`;
  if (c.includes('curator') || c.includes('allocator')) return `Before you withdraw from ${p.name}, open the vault page and claim the accrued yield once, ${fromLink}.${multi}${log}`;
  if (c.includes('stable')) return `Before you withdraw from ${p.name}, redeem the stable asset if the protocol offers it, then ${fromLink}.${multi}${log}`;
  if (c.includes('rwa')) return `Before you withdraw from ${p.name}, check its backing report first, then ${fromLink}.${multi}${log}`;
  if (c.includes('insurance')) return `Before you withdraw from ${p.name}, check the cover is settled first, then ${fromLink}.${multi}${log}`;
  if (c.includes('basis')) return `Before you withdraw from ${p.name}, close the basis position on ${chain} first, then ${fromLink}.${multi}${log}`;
  if (c.includes('restak') || c.includes('staking')) return `Before you withdraw from ${p.name}, unstake and claim rewards first, ${fromLink}.${multi}${log}`;
  return `Before you withdraw from ${p.name} on ${chain}, open its own points or rewards page and ${fromLink}. ${p.name} holds $${tvl} TVL — claim before the position is closed.${multi}${log}`;
}

/** B3. The weekly step for rows outside the top 40: the category's recurring action, on the
 *  protocol's chain, naming the protocol — varied by category and chain, never the same sentence
 *  on every row. Cautious words: the snapshot names a category, not a mechanism, so the step
 *  says to check the protocol's own docs for what counts as activity. */
function weeklyText(p: SnapshotProtocol, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  const docs = `check ${name}'s own docs first for what counts as activity`;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Each week, top up or adjust the lending position on ${chain} through ${name} to keep it active; ${docs}.`;
  if (c.includes('dex')) return `Each week, make one swap or add a little liquidity on ${chain} through ${name} to keep the position active; ${docs}.`;
  if (c.includes('yield') || c.includes('leveraged farm')) return `Each week, check the vault on ${chain} through ${name} and top up or claim the yield; ${docs}.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Each week, open or close one small hedged position on ${chain} through ${name} to keep the account active; ${docs}.`;
  if (c.includes('prediction')) return `Each week, place one small position in an open market on ${chain} through ${name}; ${docs}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Each week, check the vault on ${chain} through ${name} and top up the position; ${docs}.`;
  if (c.includes('stable')) return `Each week, mint or deposit a little more of the stable asset on ${chain} through ${name}; ${docs}.`;
  if (c.includes('rwa')) return `Each week, top up the yield asset on ${chain} through ${name}; ${docs}.`;
  if (c.includes('insurance')) return `Each week, check the cover on ${chain} through ${name} and keep the policy active; ${docs}.`;
  if (c.includes('basis')) return `Each week, top up the basis position on ${chain} through ${name}; ${docs}.`;
  if (c.includes('restak') || c.includes('staking')) return `Each week, top up the stake on ${chain} through ${name}; ${docs}.`;
  return `Each week, make one qualifying deposit on ${chain} through ${name} to keep the position active; ${docs}.`;
}

/** One sentence about the protocol, from the snapshot alone: its TVL, its chains, its age and its
 *  7-day change. Nothing here is invented; a missing value is said to be missing. */
function dataSentence(p: SnapshotProtocol, age: number | null): string {
  const tvl = Math.round(p.tvl_usd).toLocaleString('en-US');
  const n = p.chains.length;
  const agePart = age === null ? `listing date not recorded` : `listed ${age} days ago`;
  const changePart = p.change_7d === null ? `7-day change not recorded` : `7-day change ${p.change_7d > 0 ? '+' : ''}${p.change_7d}%`;
  return `Snapshot data: ${p.name} holds $${tvl} TVL across ${n} chain${n === 1 ? '' : 's'}, ${agePart}, ${changePart}.`;
}

/** The verdict step: the first step of every farm plan. It states the verdict and the rule
 *  that fired, with the row's own numbers (ROI index, TVL, age, 7-day change) — so it is
 *  specific to this protocol by construction. It costs nothing to read, so it is NOT counted
 *  in the farm cost: the cost is computed from the action steps only (see buildBoard). That
 *  also breaks the circle — the verdict comes from the ROI index, which comes from the cost,
 *  which must not depend on the verdict step. */
export function verdictStep(verdict: Verdict, reason: string): FarmStep {
  return { text: `Verdict: ${verdict}. ${reason}`, cost: 'no cost to read the verdict', time: '1 minute' };
}

/**
 * A protocol's farm plan. The step count is 6 + (chains - 1), at most 9: the verdict step first,
 * then one step per extra chain, the rest fixed. The top 40 get a mechanism-specific weekly step;
 * every row gets a snapshot-data sentence on the main action, citing its own TVL, age and 7-day
 * change. The wallet, hold and claim steps cite the protocol's name, capital, TVL, age and
 * change, so no boilerplate repeats word for word across rows. Every step carries its own cost
 * and time, from the cost table at the base level.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, top40: boolean, verdict: Verdict, reason: string): FarmStep[] {
  return [verdictStep(verdict, reason), ...actionSteps(p, age, top40)];
}

/** The action steps of a farm plan (5 + (chains - 1), at most 8): wallet, main action, one step
 *  per extra chain, a weekly step, hold, claim. The verdict step is added by farmSteps, not
 *  here — the farm cost is computed from these steps alone, and the verdict is computed from
 *  that cost, so the verdict step must not be one of them. */
function actionSteps(p: SnapshotProtocol, age: number | null, top40: boolean): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const chains = p.chains.length > 0 ? p.chains : [chain];
  const extra = Math.min(chains.length - 1, 3);
  const weekly = top40 ? actionDetail(p, capital, chain) : weeklyText(p, chain);
  const mainAction = `${actionFor(p, capital, chain)} ${dataSentence(p, age)}`;
  const steps: FarmStep[] = [
    { text: walletText(p, chains, capital), cost: 'under $3 of gas for the first transaction', time: '5 minutes' },
    { text: mainAction, cost: `$${capital} of capital and a few dollars of gas`, time: '15 minutes to set up' },
  ];
  for (let i = 1; i <= extra; i++) {
    const half = capital / 2;
    const ordinal = i === 1 ? 'second' : i === 2 ? 'third' : 'fourth';
    steps.push({
      text: `On ${chains[i]}, do the same ${p.category ?? 'protocol'} action for ${p.name} again with half the capital ($${half}), so the position is recorded on a ${ordinal} chain; check the protocol's own docs first.`,
      cost: `$${half} of capital and a few dollars of gas`,
      time: '15 minutes to set up',
    });
  }
  steps.push(
    { text: weekly, cost: 'about $2 of gas a week', time: '10 minutes a week' },
    { text: holdText(p, age, hold, capital), cost: `the $${capital} stays in the position`, time: `${hold} days` },
    { text: claimText(p, chains), cost: 'no fee to check, and never pay to claim', time: '15 minutes' },
  );
  return steps;
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round2 = (n: number): number => Math.round(n * 100) / 100;

/** B5. Round a fit report's statistics to 6 decimals for data.js. The board's implied values are
 *  already computed from the unrounded fit when this runs, so rounding here changes no row. */
function roundFit(f: FitReport): void {
  f.intercept = round6(f.intercept);
  f.slope = round6(f.slope);
  f.r2 = round6(f.r2);
  f.loo_median_ape = round6(f.loo_median_ape);
  f.loo_p25_ape = round6(f.loo_p25_ape);
  f.loo_p75_ape = round6(f.loo_p75_ape);
  f.loo_mean_ape = round6(f.loo_mean_ape);
  f.median_fold_error = round6(f.median_fold_error);
  f.p25_fold_error = round6(f.p25_fold_error);
  f.p75_fold_error = round6(f.p75_fold_error);
  const u = f.unfiltered;
  u.intercept = round6(u.intercept);
  u.slope = round6(u.slope);
  u.r2 = round6(u.r2);
  u.loo_median_ape = round6(u.loo_median_ape);
  u.loo_p25_ape = round6(u.loo_p25_ape);
  u.loo_p75_ape = round6(u.loo_p75_ape);
  u.loo_mean_ape = round6(u.loo_mean_ape);
  u.median_fold_error = round6(u.median_fold_error);
  u.p25_fold_error = round6(u.p25_fold_error);
  u.p75_fold_error = round6(u.p75_fold_error);
}

/** The protocols the board ranks: every clean pre-token protocol, no floor. The board is the
 *  whole watchlist plus every other clean protocol: 202 rows (40 watchlist + 162 others). */
export function buildBoard(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const filtered = filterComps(snapshot.protocols);
  const comps = filtered.comps;
  const fallback = comps.length < MIN_COMPS;
  const fit = fitCurve(comps);
  fit.comps_before = filtered.before;
  fit.dropped_by_category = filtered.byCategory;
  fit.dropped_by_ratio = filtered.byRatio;
  fit.dropped_by_category_detail = filtered.byCategoryDetail;
  fit.fallback = fallback;
  const allWithValue = snapshot.protocols.filter((p) => (p.mcap_usd ?? 0) > 0 && (p.tvl_usd ?? 0) > 0);
  const uf = fitCurve(allWithValue);
  fit.unfiltered = {
    n: uf.comps_after,
    intercept: uf.intercept,
    slope: uf.slope,
    r2: uf.r2,
    loo_median_ape: uf.loo_median_ape,
    loo_p25_ape: uf.loo_p25_ape,
    loo_p75_ape: uf.loo_p75_ape,
    loo_mean_ape: uf.loo_mean_ape,
    median_fold_error: uf.median_fold_error,
    p25_fold_error: uf.p25_fold_error,
    p75_fold_error: uf.p75_fold_error,
  };
  const factors = fallback ? {} : categoryFactors(comps);
  fit.category_factors = factors;

  const clean = snapshot.protocols.filter((p) => isPreToken(p) && !isExcluded(p));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined && isPreToken(p) && !isExcluded(p)) chosen.set(slug, p);
  }
  const rest = clean
    .filter((p) => !chosen.has(p.slug))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of rest) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const age = ageDays(snapshot.as_of, p.listed_at);
    const rawGrowth = finite(p.change_7d, 0);
    const growthPct = Math.min(120, Math.max(-60, rawGrowth));
    const growthMult = 1 + (growthPct / 100) * 0.5;
    const ageForModel = age ?? 365;
    const maturityMult = 0.6 + (Math.min(Math.max(ageForModel, 0), 1095) / 1095) * 0.4;
    const catFactor = factors[p.category ?? ''] ?? 1;
    let curve: number;
    let combined: number;
    if (fallback) {
      curve = p.tvl_usd * 0.25;
      combined = Math.max(0.5, Math.min(2.0, growthMult * maturityMult));
    } else {
      curve = 10 ** (fit.intercept + fit.slope * Math.log10(p.tvl_usd));
      combined = Math.max(0.5, Math.min(2.0, growthMult * maturityMult * catFactor));
    }
    const implied = Math.max(1, Math.round(curve * combined));
    return { p, age, growthPct, growthMult, maturityMult, catFactor, curve, combined, implied };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  /** The farm cost is computed from the action steps alone: the verdict step costs nothing to
   *  read, and the verdict itself is computed from the ROI index, which is computed from this
   *  cost — so the verdict step must not feed the cost, or the verdict would depend on itself.
   *  The verdict step is added to the steps in the board map below, after the verdict is known. */
  const withCost = scored.map((s, i) => {
    const steps = actionSteps(s.p, s.age, i < 40);
    const base = farmCost(s.p, steps.length, 1);
    const low = farmCost(s.p, steps.length, 0);
    const high = farmCost(s.p, steps.length, 2);
    return { ...s, steps, base, low, high };
  });
  const ratios = withCost.map((w) => w.implied / w.base.usd).sort((a, b) => a - b);
  const medRatio = median(ratios);

  const board: BoardRow[] = withCost.map((w, i) => {
    const base = w.base;
    const low = w.low;
    const high = w.high;
    const roi = Math.round(((w.implied / base.usd) / medRatio) * 100);
    const verdict = verdictFor({
      roi_index: roi,
      stablecoin: isStablecoin(w.p),
      tvl_usd: w.p.tvl_usd,
      age_days: w.age,
      change_7d: w.p.change_7d,
    });
    const reason = verdictReason(
      {
        name: w.p.name,
        roi_index: roi,
        stablecoin: isStablecoin(w.p),
        tvl_usd: w.p.tvl_usd,
        age_days: w.age,
        change_7d: w.p.change_7d,
      },
      verdict,
    );
    const steps = [verdictStep(verdict, reason), ...w.steps];
    return {
      rank: i + 1,
      slug: w.p.slug,
      name: w.p.name,
      category: w.p.category,
      chains: w.p.chains,
      tvl_usd: w.p.tvl_usd,
      change_7d: w.p.change_7d,
      mcap_usd: w.p.mcap_usd,
      listed_at: w.p.listed_at,
      gecko_id: w.p.gecko_id,
      symbol: w.p.symbol,
      token_status: 'pre-token',
      age_days: w.age,
      implied_value_usd: w.implied,
      model: {
        curve_usd: round2(w.curve),
        growth_multiplier: round4(w.growthMult),
        maturity_multiplier: round4(w.maturityMult),
        category_factor: round4(w.catFactor),
        combined_multiplier: round4(w.combined),
        age_days: w.age,
      },
      roi_index: roi,
      verdict,
      farm_cost_usd: base.usd,
      farm_cost_low_usd: low.usd,
      farm_cost_high_usd: high.usd,
      farm_hours: base.hours,
      stablecoin: isStablecoin(w.p),
      farm_steps: steps.map(stepText),
    };
  });

  /** Why a clean pre-token protocol is not on the board, or why a dropped one was dropped. */
  function auditReason(p: SnapshotProtocol, onBoard: boolean): { disposition: AuditRow['disposition']; reason: string } {
    if (onBoard) return { disposition: 'board', reason: 'On the board.' };
    if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return { disposition: 'dropped', reason: `Category ${p.category} is excluded: an exchange, a bridge, or a staking product is not a launch candidate.` };
    if (/bridge/i.test(p.name)) return { disposition: 'dropped', reason: `Name contains "bridge": a bridge is not a launch candidate.` };
    if (/wrapped/i.test(p.name)) return { disposition: 'dropped', reason: `Name contains "wrapped": a wrapped product of a token that trades.` };
    if (/staked/i.test(p.name)) return { disposition: 'dropped', reason: `Name contains "staked": a staked product of a token that trades.` };
    return { disposition: 'dropped', reason: `Versioned slug: a pool of another protocol, not a launch of its own.` };
  }
  const boardSlugs = new Set(board.map((r) => r.slug));
  const audit: AuditRow[] = snapshot.protocols
    .filter((p) => isPreToken(p))
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .map((p) => {
      const r = auditReason(p, boardSlugs.has(p.slug));
      return { slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, disposition: r.disposition, reason: r.reason };
    });

  /** B2. The verdict per row, read from the board rows (each row carries its own `verdict`
   *  field): data.js only presents it again, with the rule and the reasons, so the board and
   *  the dashboard cannot disagree. The rule itself is unchanged, so the counts are the same
   *  as before. */
  const verdictBySlug: Record<string, Verdict> = {};
  const verdictReasons: Record<string, string> = {};
  const verdictCounts = { farm: 0, thin: 0, skip: 0 };
  for (const r of board) {
    const v = r.verdict;
    verdictBySlug[r.slug] = v;
    verdictReasons[r.slug] = verdictReason(r, v);
    verdictCounts[v]++;
  }

  /** B5. Round the fit statistics to 6 decimals for data.js. The board above is already
   *  computed from the unrounded fit, so no implied value changes. */
  roundFit(fit);

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    fit,
    board_size: board.length,
    watchlist_size: snapshot.watchlist.length,
    watchlist: [...snapshot.watchlist],
    clean_size: clean.length,
    dropped_clean: snapshot.protocols.filter((p) => isPreToken(p)).length - clean.length,
    rows: board,
    audit,
    verdict: {
      rules: {
        farm_roi: VERDICT_FARM_ROI,
        skip_roi: VERDICT_SKIP_ROI,
        skip_change_7d: VERDICT_SKIP_CHANGE_7D,
        farm_change_7d: VERDICT_FARM_CHANGE_7D,
        small_tvl_usd: VERDICT_SMALL_TVL_USD,
        small_roi: VERDICT_SMALL_ROI,
        min_age_days: VERDICT_MIN_AGE_DAYS,
      },
      counts: verdictCounts,
      by_slug: verdictBySlug,
      reasons: verdictReasons,
    },
  };
  return { board, radar };
}

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
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
