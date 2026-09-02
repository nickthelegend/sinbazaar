/**
 * Three connections, three jobs — the same split the SDK draws:
 *   base — Solana. Creation, delegation, tombstones, real SOL.
 *   er   — Ephemeral Rollup. Bidding, expiry, VRF, settlement.
 *   tee  — the same rollup read through an authenticated endpoint (see
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
import { BASE_RPC, ER_RPC } from "./config";

export const IDL = idlJson as unknown as Idl;

/**
 * Read-only provider. Every transaction in this app is built with
 * `.instruction()` and sent through `sendIxs`, so the provider never needs to
 * sign — it only carries the connection Anchor fetches accounts over.
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
  if (!baseConn) baseConn = new Connection(BASE_RPC, "confirmed");
  return baseConn;
}

export function erConnection(): Connection {
  if (!erConn) erConn = new Connection(ER_RPC, "confirmed");
  return erConn;
}

export function programFor(connection: Connection, publicKey?: PublicKey): Program<Idl> {
  return new Program(IDL, new ReadonlyProvider(connection, publicKey));
}

/** Anchor's account namespace, untyped — the IDL is loaded at runtime. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const accountsOf = (program: Program<Idl>): any => program.account as any;

/** Anchor's method namespace, untyped, for the same reason. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const methodsOf = (program: Program<Idl>): any => program.methods as any;

/**
 * A key that can sign. Either the burner keypair kept in localStorage or the
 * connected browser wallet — the flows below do not care which.
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
 * bank and preflight against a delegated account is noise, not signal — the
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
  await connection.confirmTransaction({ signature, ...bh }, "confirmed");
  return signature;
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

/** sha256(body || salt) — recomputed by the program when the secret is sealed. */
export async function commitmentHash(body: Uint8Array, salt: Uint8Array): Promise<Uint8Array> {
  const joined = new Uint8Array(body.length + salt.length);
  joined.set(body, 0);
  joined.set(salt, body.length);
  const digest = await crypto.subtle.digest("SHA-256", joined);
  return new Uint8Array(digest);
}

export { BN, PublicKey, Transaction, Connection };
