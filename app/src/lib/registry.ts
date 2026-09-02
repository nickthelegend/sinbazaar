/**
 * A small local index.
 *
 * Bids are hidden behind a private permission listing only the bidder, so the
 * browser cannot enumerate a market's book by asking the rollup. What it can do
 * is remember the bids it placed itself, which is enough for the settlement
 * crank in the demo, and honest about why: the book is private by design.
 */
const MARKETS_KEY = "sinbazaar.markets.v1";
const BIDDERS_KEY = "sinbazaar.bidders.v1";

const hasStorage = () => typeof window !== "undefined" && !!window.localStorage;

function read<T>(key: string, fallback: T): T {
  if (!hasStorage()) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  if (!hasStorage()) return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota or private mode; the index is a convenience, not state */
  }
}

/** Markets this browser created, newest first. */
export function knownMarkets(): string[] {
  return read<string[]>(MARKETS_KEY, []);
}

export function rememberMarket(address: string): void {
  const all = knownMarkets().filter((a) => a !== address);
  all.unshift(address);
  write(MARKETS_KEY, all.slice(0, 64));
}

/** Bidders this browser placed bids for, per market. */
export function knownBidders(market: string): string[] {
  return read<Record<string, string[]>>(BIDDERS_KEY, {})[market] ?? [];
}

export function rememberBidder(market: string, bidder: string): void {
  const all = read<Record<string, string[]>>(BIDDERS_KEY, {});
  const list = all[market] ?? [];
  if (!list.includes(bidder)) list.push(bidder);
  all[market] = list;
  write(BIDDERS_KEY, all);
}
