/**
 * Reads.
 *
 * A delegated market is owned by the delegation program on L1, so a base-layer
 * `getProgramAccounts` returns only the markets that are not on the rollup right
 * now. The rollup returns the rest. The village feed is the union of the two,
 * which is also a fair picture of where each market currently lives.
 */
import { PublicKey } from "@solana/web3.js";
import { accountsOf, baseConnection, erConnection, programFor } from "./anchor";
import { decodeRevealed, toNumber, variantOf } from "./format";
import { knownMarkets } from "./registry";
import { roomOf } from "./rooms";

export type Layer = "base" | "er";

export interface MarketView {
  address: string;
  village: string;
  marketId: string;
  author: string;
  roomVariant: string;
  commitment: number[];
  createdAt: number;
  expiresAt: number;
  sealPot: number;
  readPot: number;
  yesPot: number;
  noPot: number;
  ransomFloor: number;
  ransomSlope: number;
  bidCount: number;
  closedBidCount: number;
  readBidCount: number;
  status: string;
  outcome: string;
  soleReader: string;
  randomness: string;
  resolvedAt: number;
  escrowLamports: number;
  authorPayout: number;
  tombstoned: boolean;
  revealed: string;
  /** Where this copy was read from. */
  layer: Layer;
}

export interface TombstoneView {
  address: string;
  market: string;
  marketId: string;
  author: string;
  roomVariant: string;
  commitment: number[];
  outcome: string;
  sealPot: number;
  readPot: number;
  soleReader: string;
  randomness: string;
  buriedAt: number;
  revealed: string;
  /** Published only with an authorised reveal; all-zero otherwise. */
  salt: number[];
}

/* eslint-disable @typescript-eslint/no-explicit-any */

function toMarketView(address: string, acct: any, layer: Layer): MarketView {
  return {
    address,
    village: acct.village.toBase58(),
    marketId: acct.marketId.toString(),
    author: acct.author.toBase58(),
    roomVariant: roomOf(acct.room).variant,
    commitment: Array.from(acct.commitmentHash as number[]),
    createdAt: toNumber(acct.createdAt),
    expiresAt: toNumber(acct.expiresAt),
    sealPot: toNumber(acct.sealPot),
    readPot: toNumber(acct.readPot),
    yesPot: toNumber(acct.yesPot),
    noPot: toNumber(acct.noPot),
    ransomFloor: toNumber(acct.ransomFloor),
    ransomSlope: toNumber(acct.ransomSlope),
    bidCount: Number(acct.bidCount),
    closedBidCount: Number(acct.closedBidCount),
    readBidCount: Number(acct.readBidCount),
    status: variantOf(acct.status),
    outcome: variantOf(acct.outcome),
    soleReader: acct.soleReader.toBase58(),
    randomness: acct.randomness.toString(),
    resolvedAt: toNumber(acct.resolvedAt),
    escrowLamports: toNumber(acct.escrowLamports),
    authorPayout: toNumber(acct.authorPayout),
    tombstoned: !!acct.tombstoned,
    revealed: decodeRevealed(acct.revealed as number[], toNumber(acct.revealedLen)),
    layer,
  };
}

async function marketsOn(layer: Layer): Promise<MarketView[]> {
  const connection = layer === "er" ? erConnection() : baseConnection();
  try {
    const rows = await accountsOf(programFor(connection)).market.all();
    return rows.map((row: any) => toMarketView(row.publicKey.toBase58(), row.account, layer));
  } catch {
    // Some endpoints refuse getProgramAccounts. The registry fallback below
    // still surfaces everything this browser has touched.
    return [];
  }
}

/**
 * Read one market, asking the base layer first.
 *
 * Which endpoint answers is what tells us where the market actually lives. A
 * delegated market is owned by the delegation program on L1, so an Anchor fetch
 * there fails and we fall through to the rollup. Once it is committed and
 * undelegated the base copy is the authoritative one — and asking the rollup first
 * would keep reporting "on the rollup" forever, because the rollup never drops its
 * stale copy.
 */
export async function fetchMarket(address: string): Promise<MarketView | null> {
  const key = new PublicKey(address);
  for (const layer of ["base", "er"] as Layer[]) {
    const connection = layer === "er" ? erConnection() : baseConnection();
    try {
      const acct = await accountsOf(programFor(connection)).market.fetch(key);
      if (acct) return toMarketView(address, acct, layer);
    } catch {
      /* not here; try the other layer */
    }
  }
  return null;
}

/** The village feed: every market either layer will admit to. */
export async function fetchMarkets(): Promise<MarketView[]> {
  const [er, base] = await Promise.all([marketsOn("er"), marketsOn("base")]);
  const byAddress = new Map<string, MarketView>();
  for (const m of er) byAddress.set(m.address, m);
  // Base-layer `market.all()` only returns markets this program still owns, i.e.
  // the ones that are NOT delegated. Anything it returns has come home, so it wins
  // over the rollup's stale copy — both for the data and for the layer badge.
  for (const m of base) byAddress.set(m.address, m);

  if (byAddress.size === 0) {
    const remembered = await Promise.all(knownMarkets().map((a) => fetchMarket(a)));
    for (const m of remembered) if (m) byAddress.set(m.address, m);
  }

  return [...byAddress.values()].sort((a, b) => b.createdAt - a.createdAt);
}

/** The graveyard. Tombstones only ever exist on the base layer. */
export async function fetchTombstones(): Promise<TombstoneView[]> {
  try {
    const rows = await accountsOf(programFor(baseConnection())).tombstone.all();
    return rows
      .map((row: any) => {
        const acct = row.account;
        return {
          address: row.publicKey.toBase58(),
          market: acct.market.toBase58(),
          marketId: acct.marketId.toString(),
          author: acct.author.toBase58(),
          roomVariant: roomOf(acct.room).variant,
          commitment: Array.from(acct.commitmentHash as number[]),
          outcome: variantOf(acct.outcome),
          sealPot: toNumber(acct.sealPot),
          readPot: toNumber(acct.readPot),
          soleReader: acct.soleReader.toBase58(),
          randomness: acct.randomness.toString(),
          buriedAt: toNumber(acct.buriedAt),
          revealed: decodeRevealed(acct.revealed as number[], toNumber(acct.revealedLen)),
          salt: Array.from(acct.revealedSalt as number[]),
        } satisfies TombstoneView;
      })
      .sort((a: TombstoneView, b: TombstoneView) => b.buriedAt - a.buriedAt);
  } catch {
    return [];
  }
}

/** Ransom the village must raise to bury a blackmail market, at `now`. */
export function ransomDue(market: MarketView, nowSecs: number): number {
  const elapsed = Math.max(0, nowSecs - market.createdAt);
  return market.ransomFloor + market.ransomSlope * elapsed;
}
