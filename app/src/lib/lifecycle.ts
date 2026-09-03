"use client";

/**
 * The life of one market account, reconstructed from both chains.
 *
 * Delegation is the primitive everything here rests on and it is the one the
 * interface never showed. This reads the real signature history for a market on
 * the rollup and on the base layer and returns it as an ordered sequence, so
 * "delegated to an ephemeral rollup" stops being a phrase and becomes a list of
 * transactions a judge can open.
 *
 * ## History is not the same as truth
 *
 * A validator only keeps transaction history for a window. The local base
 * validator was measured retaining roughly 300 slots, about two minutes, so a
 * market older than that returns **zero base-layer signatures** while its
 * account sits there perfectly alive. Reporting that as "0 transactions on
 * Solana" would be a lie of exactly the kind this project keeps having to dig
 * out of its own UI: an absence rendered as a value.
 *
 * So every layer reports one of three things, and they are kept distinct:
 * a count, or "this layer has pruned the window your market lived in", or the
 * error that stopped us asking. `getFirstAvailableBlock` is what makes the
 * difference knowable rather than guessed.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { baseConnection, erConnection } from "./anchor";

export interface Step {
  layer: "base" | "er";
  signature: string;
  slot: number;
  /** Anchor instruction names in this transaction, in program order. */
  instructions: string[];
  failed: boolean;
  blockTime: number | null;
}

export type LayerHistory =
  | { kind: "read"; steps: Step[]; retainedFrom: number | null }
  | { kind: "pruned"; retainedFrom: number; note: string }
  | { kind: "error"; message: string };

export interface Lifecycle {
  market: string;
  base: LayerHistory;
  er: LayerHistory;
}

const NAME = /Program log: Instruction: (\w+)/;

async function readLayer(
  connection: Connection,
  layer: "base" | "er",
  market: PublicKey,
  limit: number
): Promise<LayerHistory> {
  let retainedFrom: number | null = null;
  try {
    try {
      retainedFrom = await connection.getFirstAvailableBlock();
    } catch {
      // Not fatal. It only costs us the ability to explain an empty result.
      retainedFrom = null;
    }

    const sigs = await connection.getSignaturesForAddress(market, { limit });
    if (sigs.length === 0) {
      if (retainedFrom !== null) {
        return {
          kind: "pruned",
          retainedFrom,
          note: `this validator retains history from slot ${retainedFrom.toLocaleString()} only, and nothing for this account survives inside that window`,
        };
      }
      return { kind: "read", steps: [], retainedFrom };
    }

    // Oldest first: this is a life story, and stories start at the beginning.
    const ordered = sigs.slice().reverse();
    const steps: Step[] = [];
    for (const s of ordered) {
      const tx = await connection.getTransaction(s.signature, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      });
      const instructions = (tx?.meta?.logMessages ?? [])
        .map((l) => NAME.exec(l)?.[1])
        .filter((n): n is string => Boolean(n));
      steps.push({
        layer,
        signature: s.signature,
        slot: s.slot,
        instructions,
        failed: Boolean(s.err ?? tx?.meta?.err),
        blockTime: s.blockTime ?? null,
      });
    }
    return { kind: "read", steps, retainedFrom };
  } catch (err) {
    return { kind: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

export async function fetchLifecycle(market: PublicKey, limit = 60): Promise<Lifecycle> {
  const [base, er] = await Promise.all([
    readLayer(baseConnection(), "base", market, limit),
    readLayer(erConnection(), "er", market, limit),
  ]);
  return { market: market.toBase58(), base, er };
}

/** Instructions that move money or place a stake. The trading, as opposed to
 *  the plumbing of creating, delegating and settling an account. */
const TRADING = /^(place_bid|fund_bid|place_bid_with_session|settle_bid|close_bid)$/;

const snakeName = (n: string) => n.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

export interface Compression {
  /** Writes seen on the rollup for this account. */
  rollupWrites: number;
  /** Transactions seen on the base layer for this account. */
  baseWrites: number;
  /** rollupWrites / baseWrites, only when both were actually readable. */
  ratio: number | null;
  /** Why there is no ratio, when there isn't one. */
  unavailable: string | null;
  /** Bidding transactions found on the rollup. */
  rollupTrades: number;
  /** Bidding transactions found on the base layer. Should always be zero. */
  baseTrades: number;
  /** True only when both layers were readable and the base layer held no trades. */
  tradingNeverTouchedL1: boolean;
}

/**
 * How many rollup writes this market bought per base-layer transaction.
 *
 * The economic argument for a rollup, computed from the market on screen rather
 * than quoted from a docs page. It returns a ratio only when **both** layers
 * genuinely answered: a base layer that has pruned its window would otherwise
 * divide by a zero that means "unknown" and produce an impressive, meaningless
 * number.
 */
export function compressionOf(life: Lifecycle): Compression {
  const count = (h: LayerHistory) => (h.kind === "read" ? h.steps.length : 0);
  const trades = (h: LayerHistory) =>
    h.kind === "read"
      ? h.steps.filter((s) => s.instructions.some((i) => TRADING.test(snakeName(i)))).length
      : 0;
  const rollupWrites = count(life.er);
  const baseWrites = count(life.base);
  const rollupTrades = trades(life.er);
  const baseTrades = trades(life.base);
  // Only assertable when both layers actually answered. A pruned base layer
  // cannot be used to claim nothing was there.
  const tradingNeverTouchedL1 =
    life.er.kind === "read" && life.base.kind === "read" && baseTrades === 0;
  const extra = { rollupTrades, baseTrades, tradingNeverTouchedL1 };

  if (life.er.kind !== "read") {
    return { ...extra, rollupWrites, baseWrites, ratio: null, unavailable: "the rollup did not answer" };
  }
  if (life.base.kind === "pruned") {
    return {
      ...extra,
      rollupWrites,
      baseWrites,
      ratio: null,
      unavailable:
        "the base layer has pruned the slots this market lived in, so its transaction count is unknown, not zero",
    };
  }
  if (life.base.kind === "error") {
    return { ...extra, rollupWrites, baseWrites, ratio: null, unavailable: "the base layer did not answer" };
  }
  if (baseWrites === 0) {
    return {
      ...extra,
      rollupWrites,
      baseWrites,
      ratio: null,
      unavailable: "no base-layer transactions for this account inside the retained window",
    };
  }
  return {
    ...extra,
    rollupWrites,
    baseWrites,
    ratio: rollupWrites / baseWrites,
    unavailable: null,
  };
}
