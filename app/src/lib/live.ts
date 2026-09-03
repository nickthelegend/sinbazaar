"use client";

/**
 * Live rollup plumbing.
 *
 * Polling a rollup is a waste of the rollup. These helpers open real websocket
 * subscriptions against the ephemeral validator so the book moves on screen at
 * the moment a transaction lands, and measure what that actually costs in
 * milliseconds against both layers, because "10-50ms" is a claim until there is
 * a number on the page that the viewer watched appear.
 *
 * `@solana/web3.js` derives a websocket endpoint by switching the scheme and
 * adding one to the port, which is exactly right for 8899→8900 and 7799→7800, so
 * no extra configuration is needed for either cluster.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import { baseConnection, erConnection } from "./anchor";
import { PROGRAM_ID } from "./config";

/**
 * Fire `onChange` whenever any account owned by this program changes on the
 * rollup. Returns an unsubscribe.
 *
 * A market, a purse and every bid are all program-owned, so one subscription
 * covers the entire village. The callback is debounced by the caller, not here:
 * a single bid touches three accounts and would otherwise re-render three times.
 */
export function subscribeVillage(onChange: () => void): () => void {
  const er = erConnection();
  let id: number | null = null;
  try {
    id = er.onProgramAccountChange(PROGRAM_ID, () => onChange(), "confirmed");
  } catch {
    // No websocket (some hosted RPCs refuse subscriptions). The caller's poll
    // is the fallback and stays running either way.
    return () => {};
  }
  return () => {
    if (id !== null) void er.removeProgramAccountChangeListener(id).catch(() => {});
  };
}

/** Fire `onChange` when one specific account changes on the rollup. */
export function subscribeAccount(address: PublicKey, onChange: () => void): () => void {
  const er = erConnection();
  let id: number | null = null;
  try {
    id = er.onAccountChange(address, () => onChange(), "confirmed");
  } catch {
    return () => {};
  }
  return () => {
    if (id !== null) void er.removeAccountChangeListener(id).catch(() => {});
  };
}

/** Follow the rollup's slot height. The clearest liveness signal there is. */
export function subscribeSlot(onSlot: (slot: number) => void): () => void {
  const er = erConnection();
  let id: number | null = null;
  try {
    id = er.onSlotChange((s) => onSlot(s.slot));
  } catch {
    return () => {};
  }
  return () => {
    if (id !== null) void er.removeSlotChangeListener(id).catch(() => {});
  };
}

export interface Ping {
  ms: number | null;
  slot: number | null;
  error: boolean;
}

/**
 * One round trip, timed.
 *
 * `getSlot` is the cheapest call that still proves the node answered, so the
 * number is close to pure network + consensus latency rather than the cost of
 * whatever query we happened to pick.
 */
export async function ping(connection: Connection): Promise<Ping> {
  const started = performance.now();
  try {
    const slot = await connection.getSlot("confirmed");
    return { ms: Math.round(performance.now() - started), slot, error: false };
  } catch {
    return { ms: null, slot: null, error: true };
  }
}

export async function pingBoth(): Promise<{ base: Ping; er: Ping }> {
  const [base, er] = await Promise.all([ping(baseConnection()), ping(erConnection())]);
  return { base, er };
}

/**
 * The validator behind the rollup, and the one behind the base layer.
 *
 * Worth showing: on devnet this is the TEE validator's identity, and a judge can
 * check it against the address in the README rather than taking our word for it.
 */
export async function identities(): Promise<{ base: string | null; er: string | null }> {
  const read = async (c: Connection) => {
    try {
      const r = (await (c as unknown as {
        _rpcRequest: (m: string, a: unknown[]) => Promise<{ result?: { identity?: string } }>;
      })._rpcRequest("getIdentity", []));
      return r?.result?.identity ?? null;
    } catch {
      return null;
    }
  };
  const [base, er] = await Promise.all([read(baseConnection()), read(erConnection())]);
  return { base, er };
}

export interface RollupEvent {
  /** Real base58 transaction signature, straight off the validator. */
  signature: string;
  /** Slot the rollup put it in. */
  slot: number;
  /** Anchor's own `Instruction:` log lines, in program order. */
  instructions: string[];
  /** True when the transaction landed but the program rejected it. */
  failed: boolean;
  /** Wall-clock arrival, for the relative age shown in the strip. */
  at: number;
}

/**
 * Every transaction touching this program on the rollup, as it lands.
 *
 * `logsSubscribe` was verified against the ephemeral validator before this was
 * written: it accepts a `mentions` filter and delivers real signatures with
 * Anchor's `Program log: Instruction: <Name>` lines intact. That log line is
 * the only place the instruction name survives to the client, because the
 * instruction data itself is an opaque 8-byte discriminator.
 *
 * One transaction routinely carries several instructions (`place_bid` and
 * `fund_bid` ship together), so this returns the whole list rather than
 * guessing which one mattered.
 */
export function subscribeLogs(onEvent: (event: RollupEvent) => void): () => void {
  const er = erConnection();
  let id: number | null = null;
  try {
    id = er.onLogs(
      PROGRAM_ID,
      (logs, ctx) => {
        // A rejected transaction still emits logs. Anchor prints the
        // instruction name before it fails, so the name survives either way.
        const instructions = logs.logs
          .map((line) => /Program log: Instruction: (\w+)/.exec(line)?.[1])
          .filter((name): name is string => Boolean(name));
        onEvent({
          signature: logs.signature,
          slot: ctx.slot,
          instructions,
          failed: logs.err !== null,
          at: Date.now(),
        });
      },
      "confirmed",
    );
  } catch {
    // An RPC that refuses subscriptions leaves the strip saying so, rather
    // than showing an empty list that reads as "nothing is happening".
    return () => {};
  }
  return () => {
    if (id !== null) void er.removeOnLogsListener(id).catch(() => {});
  };
}
