/**
 * Three connections, three jobs, the same split the SDK draws:
 *   base, Solana. Creation, delegation, tombstones, real SOL.
 *   er , Ephemeral Rollup. Bidding, expiry, VRF, settlement.
 *   tee, the same rollup read through an authenticated endpoint (see
 *          lib/magicblock.ts). The only place a private account can be fetched,
 *          and only by a key on that account's permission member list.
 */
import { BN, Program, type Idl, type Provider } from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import idlJson from "@/idl/sinbazaar.json";
import { BASE_RPC, defaultWsUrl, ER_RPC } from "./config";

export const IDL = idlJson as unknown as Idl;

/**
 * Read-only provider. Every transaction in this app is built with
 * `.instruction()` and sent through `sendIxs`, so the provider never needs to
 * sign, it only carries the connection Anchor fetches accounts over.
 */
export class ReadonlyProvider implements Provider {
  constructor(
    readonly connection: Connection,
    readonly publicKey?: PublicKey
  ) {}
}

let baseConn: Connection | null = null;
let erConn: Connection | null = null;

export function baseConnection(): Connection {
  if (!baseConn) {
    baseConn = new Connection(BASE_RPC, {
      commitment: "confirmed",
      wsEndpoint: defaultWsUrl(BASE_RPC),
    });
  }
  return baseConn;
}

export function erConnection(): Connection {
  if (!erConn) {
    // The websocket endpoint is passed explicitly rather than left to web3.js to
    // derive, so the IPv4 pinning in `defaultWsUrl` actually applies.
    erConn = new Connection(ER_RPC, {
      commitment: "confirmed",
      wsEndpoint: defaultWsUrl(ER_RPC),
    });
  }
  return erConn;
}

export function programFor(connection: Connection, publicKey?: PublicKey): Program<Idl> {
  return new Program(IDL, new ReadonlyProvider(connection, publicKey));
}

/** Anchor's account namespace, untyped, the IDL is loaded at runtime. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const accountsOf = (program: Program<Idl>): any => program.account as any;

/** Anchor's method namespace, untyped, for the same reason. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const methodsOf = (program: Program<Idl>): any => program.methods as any;

/**
 * A key that can sign. Either the burner keypair kept in localStorage or the
 * connected browser wallet, the flows below do not care which.
 */
export interface VillageSigner {
  kind: "burner" | "wallet";
  publicKey: PublicKey;
  signTransaction(tx: Transaction): Promise<Transaction>;
  /** Needed for the TEE auth handshake. */
  signMessage(message: Uint8Array): Promise<Uint8Array>;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Build, sign and send a transaction on an arbitrary connection.
 *
 * `skipPreflight` defaults to true because the ER simulates against its own
 * bank and preflight against a delegated account is noise, not signal, the
 * same choice sdk/src/index.ts `send()` makes.
 */
export async function sendIxs(
  connection: Connection,
  ixs: TransactionInstruction[],
  signer: VillageSigner,
  opts: { skipPreflight?: boolean } = {}
): Promise<string> {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = signer.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  const signed = await signer.signTransaction(tx);
  const signature = await connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: opts.skipPreflight ?? true,
  });
  const bh = await connection.getLatestBlockhash();
  const result = await connection.confirmTransaction({ signature, ...bh }, "confirmed");

  // `confirmTransaction` resolves for a transaction that LANDED, whether or not it
  // succeeded, a reverted instruction comes back in `value.err` rather than being
  // thrown. Ignoring it makes every on-chain failure render as a green tick, which
  // is exactly what it did here: a bid larger than the purse "succeeded" in the UI
  // while the market recorded no bid at all.
  if (result.value.err) throw await explainFailure(connection, signature, result.value.err);
  return signature;
}

/**
 * Turn a landed-but-failed transaction into something a person can act on.
 *
 * Anchor writes the human-readable reason into the program logs
 * ("Error Message: purse has insufficient available lamports."), so pull that out
 * rather than showing the caller a raw `{"InstructionError":[0,{"Custom":6017}]}`.
 */
async function explainFailure(
  connection: Connection,
  signature: string,
  err: unknown
): Promise<Error> {
  let logs: string[] = [];
  try {
    const tx = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    logs = tx?.meta?.logMessages ?? [];
  } catch {
    /* the logs are a courtesy; the failure is real either way */
  }
  const message = logs.find((l) => l.includes("Error Message:"));
  if (message) {
    return new Error(message.slice(message.indexOf("Error Message:") + 15).trim());
  }
  const panic = logs.find((l) => l.includes("failed:"));
  if (panic) return new Error(panic.slice(panic.indexOf("failed:") + 7).trim());
  return new Error(`transaction failed: ${JSON.stringify(err)}`);
}

/** Wait for a delegated account to show up on the rollup. */
export async function waitForAccount(
  connection: Connection,
  key: PublicKey,
  label: string,
  timeoutMs = 30_000
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const info = await connection.getAccountInfo(key);
    if (info) return;
    await sleep(600);
  }
  throw new Error(`${label} never appeared on the rollup`);
}

/** 32 random bytes for the commitment. Never leaves the private secret account. */
export function randomSalt(): Uint8Array {
  const salt = new Uint8Array(32);
  crypto.getRandomValues(salt);
  return salt;
}

/** sha256(body || salt), recomputed by the program when the secret is sealed. */
export async function commitmentHash(body: Uint8Array, salt: Uint8Array): Promise<Uint8Array> {
  const joined = new Uint8Array(body.length + salt.length);
  joined.set(body, 0);
  joined.set(salt, body.length);
  const digest = await crypto.subtle.digest("SHA-256", joined);
  return new Uint8Array(digest);
}

export { BN, PublicKey, Transaction, Connection };
