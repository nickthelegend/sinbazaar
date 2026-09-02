/**
 * Endpoints and fixed addresses.
 *
 * Every value is a build-time inline (`NEXT_PUBLIC_*`), so the references below
 * must stay literal, a computed `process.env[name]` is not replaced by Next.
 * Defaults mirror scripts/local-env.sh.
 */
import { PublicKey } from "@solana/web3.js";

export const CLUSTER = process.env.NEXT_PUBLIC_CLUSTER ?? "localnet";
export const IS_LOCALNET = CLUSTER === "localnet";

/** Base Solana. Creation, delegation, tombstones, real SOL. */
export const BASE_RPC = process.env.NEXT_PUBLIC_BASE_RPC ?? "http://localhost:8899";

/** Ephemeral Rollup. Bidding, expiry, VRF, settlement. */
export const ER_RPC = process.env.NEXT_PUBLIC_ER_RPC ?? "http://localhost:7799";

/** Authenticated TEE / QFS read path. The only place a private account opens. */
export const TEE_RPC = process.env.NEXT_PUBLIC_TEE_RPC ?? "http://localhost:6699";

export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID ?? "2WF8eFT97sGVYwGe5DNtLkGFW3kMJ6WXozGvT3eSzvEN"
);

/** The validator that must host both the market and its secret. */
export const VALIDATOR = new PublicKey(
  process.env.NEXT_PUBLIC_VALIDATOR ?? "mAGicPQYBMvcYveUZA5F5UNNwyHvfYh5xkLS2Fr1mev"
);

/** VRF oracle queue for randomness requested from inside the rollup. */
export const VRF_QUEUE = new PublicKey(
  process.env.NEXT_PUBLIC_VRF_QUEUE ?? "Sc9MJUngNbQXSXGP3F67KvKwVnhaYn6kcioxXNVowYT"
);

/**
 * web3.js derives a websocket endpoint by switching the scheme and adding one to
 * the port, which is exactly right for 8899 -> 8900, 7799 -> 7800 and
 * 6699 -> 6700. The TEE path needs the URL spelled out anyway, because the token
 * has to be appended to it.
 */
export function defaultWsUrl(httpUrl: string): string {
  const url = new URL(httpUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  if (url.port) url.port = String(Number(url.port) + 1);
  // The ephemeral validator and the query-filtering service bind 127.0.0.1 only.
  // A browser resolves "localhost" to ::1 first; fetch quietly falls back to
  // IPv4 after the refusal, but a WebSocket does not retry, so every
  // subscription died with ERR_CONNECTION_REFUSED while HTTP looked fine.
  // Pinning the loopback literal is what makes live updates work locally.
  if (url.hostname === "localhost") url.hostname = "127.0.0.1";
  return url.toString().replace(/\/$/, "");
}

/**
 * Explorer link for a given layer.
 *
 * The rollup is a different chain with its own accounts, so a market that is
 * currently delegated does not exist at that address on the base explorer in the
 * form you are looking at. Pointing both at the base layer quietly sent people
 * to a stale snapshot.
 */
export function explorerUrlFor(address: string, layer: "base" | "er" = "base"): string {
  const endpoint = layer === "er" ? ER_RPC : BASE_RPC;
  return `https://explorer.solana.com/address/${address}?cluster=custom&customUrl=${encodeURIComponent(
    endpoint
  )}`;
}

/** Explorer link for the base layer. Local validators have no hosted explorer. */
export function explorerUrl(address: string): string {
  if (IS_LOCALNET) {
    return `https://explorer.solana.com/address/${address}?cluster=custom&customUrl=${encodeURIComponent(
      BASE_RPC
    )}`;
  }
  return `https://explorer.solana.com/address/${address}?cluster=${CLUSTER}`;
}
