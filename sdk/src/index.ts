/**
 * SINBAZAAR client SDK.
 *
 * Three connections, three jobs:
 *   base — Solana. Creation, delegation, tombstones, real SOL.
 *   er   — Ephemeral Rollup. Bidding, expiry, VRF, settlement. ~10-50ms.
 *   tee  — the same rollup, read through an authenticated endpoint. The only
 *          place a private account's contents can be fetched, and only by a key
 *          on that account's permission member list.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet, BN } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  MAGIC_PROGRAM_ID,
  MAGIC_CONTEXT_ID,
  PERMISSION_PROGRAM_ID,
  EPHEMERAL_VAULT_ID,
  DELEGATION_PROGRAM_ID,
  permissionPdaFromAccount,
  deserializePermission,
  getAuthToken,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import * as nacl from "tweetnacl";
import { createHash } from "crypto";

// ---------------------------------------------------------------------------
// endpoints
// ---------------------------------------------------------------------------

export const ENDPOINTS = {
  base: process.env.PROVIDER_ENDPOINT || "https://api.devnet.solana.com",
  baseWs: process.env.WS_ENDPOINT || undefined,
  er: process.env.EPHEMERAL_PROVIDER_ENDPOINT || "https://devnet-as.magicblock.app",
  erWs: process.env.EPHEMERAL_WS_ENDPOINT || undefined,
  /** The authenticated (TEE / query-filtering) read path. */
  tee: process.env.TEE_PROVIDER_ENDPOINT || "https://devnet-tee.magicblock.app",
  teeWs: process.env.TEE_WS_ENDPOINT || undefined,
  router: process.env.ROUTER_ENDPOINT || "https://devnet-router.magicblock.app",
};

/** Validator that must host both the market and its secret. */
export const VALIDATOR = new PublicKey(
  process.env.VALIDATOR || "MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo"
);

/**
 * VRF oracle queue for randomness requested from inside the rollup.
 * Local cluster and devnet use different queues; both come from
 * `ephemeral_vrf_sdk::consts`.
 */
export const VRF_EPHEMERAL_QUEUE = new PublicKey(
  process.env.VRF_EPHEMERAL_QUEUE || "5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc"
);

export {
  MAGIC_PROGRAM_ID,
  MAGIC_CONTEXT_ID,
  PERMISSION_PROGRAM_ID,
  EPHEMERAL_VAULT_ID,
  DELEGATION_PROGRAM_ID,
  permissionPdaFromAccount,
  deserializePermission,
};

// ---------------------------------------------------------------------------
// program + PDAs
// ---------------------------------------------------------------------------

export const SEEDS = {
  village: Buffer.from("village"),
  market: Buffer.from("market"),
  secret: Buffer.from("secret"),
  bid: Buffer.from("bid"),
  purse: Buffer.from("purse"),
  session: Buffer.from("session"),
  tomb: Buffer.from("tomb"),
};

export function loadIdl(): anchor.Idl {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require("../../target/idl/sinbazaar.json");
}

export function programFor(connection: Connection, wallet: Keypair): Program {
  const provider = new AnchorProvider(connection, new Wallet(wallet), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  return new Program(loadIdl(), provider);
}

export const PROGRAM_ID = new PublicKey(loadIdl().address);

const pda = (seeds: (Buffer | Uint8Array)[]) =>
  PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];

export const villagePda = (authority: PublicKey) => pda([SEEDS.village, authority.toBuffer()]);

export const marketPda = (village: PublicKey, marketId: number | BN) =>
  pda([SEEDS.market, village.toBuffer(), u64le(marketId)]);

export const secretPda = (market: PublicKey) => pda([SEEDS.secret, market.toBuffer()]);
export const bidPda = (market: PublicKey, bidder: PublicKey) =>
  pda([SEEDS.bid, market.toBuffer(), bidder.toBuffer()]);
export const pursePda = (owner: PublicKey) => pda([SEEDS.purse, owner.toBuffer()]);
export const sessionPda = (market: PublicKey, owner: PublicKey) =>
  pda([SEEDS.session, market.toBuffer(), owner.toBuffer()]);
export const tombPda = (market: PublicKey) => pda([SEEDS.tomb, market.toBuffer()]);

export function u64le(n: number | BN): Buffer {
  return new BN(n).toArrayLike(Buffer, "le", 8);
}

// ---------------------------------------------------------------------------
// connections
// ---------------------------------------------------------------------------

export function baseConnection(): Connection {
  return new Connection(ENDPOINTS.base, {
    commitment: "confirmed",
    ...(ENDPOINTS.baseWs ? { wsEndpoint: ENDPOINTS.baseWs } : {}),
  });
}

export function erConnection(): Connection {
  return new Connection(ENDPOINTS.er, {
    commitment: "confirmed",
    ...(ENDPOINTS.erWs ? { wsEndpoint: ENDPOINTS.erWs } : {}),
  });
}

/**
 * An authenticated read/write connection to the private rollup.
 *
 * The token is a JWT the validator issues after the holder signs a challenge, and
 * it travels as a `?token=` query parameter on both the HTTP and WS URLs — never
 * as a header. Any keypair can obtain a token; what the token buys you is the
 * *identity* the validator checks against each account's permission member list.
 */
export async function teeConnection(
  signer: Keypair,
  url: string = ENDPOINTS.tee
): Promise<{ connection: Connection; token: string }> {
  const { token } = await getAuthToken(url, signer.publicKey, async (msg: Uint8Array) =>
    nacl.sign.detached(msg, signer.secretKey)
  );
  const ws = (process.env.TEE_WS_ENDPOINT || url.replace(/^http/, "ws")) + `?token=${token}`;
  const connection = new Connection(`${url}?token=${token}`, {
    commitment: "confirmed",
    wsEndpoint: ws,
  });
  return { connection, token };
}

/** True when the configured TEE endpoint is a real TEE, not a local QFS shim. */
export function isRealTee(url: string = ENDPOINTS.tee): boolean {
  return url.includes("tee");
}

// ---------------------------------------------------------------------------
// commitment
// ---------------------------------------------------------------------------

/** sha256(body || salt) — recomputed by the program when the secret is sealed. */
export function commitmentHash(body: string | Buffer, salt: Buffer): Buffer {
  const b = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
  return createHash("sha256").update(b).update(salt).digest();
}

export function randomSalt(): Buffer {
  return Buffer.from(nacl.randomBytes(32));
}

// ---------------------------------------------------------------------------
// enums (mirror programs/sinbazaar/src/state.rs)
// ---------------------------------------------------------------------------

export const Room = {
  GuiltMarket: { guiltMarket: {} },
  BlackmailEscrow: { blackmailEscrow: {} },
  WhisperIpo: { whisperIpo: {} },
} as const;

export const Side = {
  Seal: { seal: {} },
  Read: { read: {} },
  Yes: { yes: {} },
  No: { no: {} },
} as const;

export type OutcomeName =
  | "pending"
  | "buried"
  | "soleReader"
  | "randomReveal"
  | "publicLeak"
  | "inherited"
  | "forgiven"
  | "slashed"
  | "cancelled";

export const outcomeName = (o: any): OutcomeName => Object.keys(o)[0] as OutcomeName;
export const statusName = (s: any): string => Object.keys(s)[0];

// ---------------------------------------------------------------------------
// misc helpers
// ---------------------------------------------------------------------------

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fundLocal(
  connection: Connection,
  who: PublicKey,
  sol = 5
): Promise<void> {
  const sig = await connection.requestAirdrop(who, sol * LAMPORTS_PER_SOL);
  const bh = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
}

/** Send a transaction built from raw instructions on an arbitrary connection. */
export async function send(
  connection: Connection,
  ixs: anchor.web3.TransactionInstruction[],
  signers: Keypair[],
  opts: { skipPreflight?: boolean } = {}
): Promise<string> {
  const tx = new Transaction().add(...ixs);
  tx.feePayer = signers[0].publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(...signers);
  const sig = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: opts.skipPreflight ?? true,
  });
  const bh = await connection.getLatestBlockhash();
  await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
  return sig;
}

export interface PermissionView {
  exists: boolean;
  /** The flag that decides whether an unauthorised RPC read is answered at all. */
  isPrivate: boolean;
  /** Members, excluding the owning program which the permission program adds itself. */
  members: { pubkey: string; flags: number }[];
  memberKeys: string[];
}

/**
 * Read an account's ephemeral permission.
 *
 * Parsed by hand against the live on-chain layout:
 *   [0]      discriminator
 *   [1]      bump
 *   [2..34)  permissioned account
 *   [34]     is_private
 *   [35..]   members, 33 bytes each: flags(1) || pubkey(32)
 *
 * The SDK's own `deserializePermission` expects an older shape (a `hasMembers`
 * byte plus a u32 count) and reads a garbage length against this layout, so it is
 * deliberately not used here.
 */
export async function readPermission(
  connection: Connection,
  account: PublicKey
): Promise<PermissionView> {
  const info = await connection.getAccountInfo(permissionPdaFromAccount(account));
  if (!info) return { exists: false, isPrivate: false, members: [], memberKeys: [] };
  const d = info.data;
  const isPrivate = d[34] === 1;
  const members: { pubkey: string; flags: number }[] = [];
  for (let off = 35; off + 33 <= d.length; off += 33) {
    const pubkey = new PublicKey(d.subarray(off + 1, off + 33)).toBase58();
    if (pubkey === PROGRAM_ID.toBase58()) continue; // added by the permission program
    members.push({ pubkey, flags: d[off] });
  }
  return { exists: true, isPrivate, members, memberKeys: members.map((m) => m.pubkey) };
}

/** Back-compat shorthand used by the demo scripts. */
export async function permissionMembers(
  connection: Connection,
  account: PublicKey
): Promise<{ exists: boolean; isPrivate: boolean; members: string[] }> {
  const v = await readPermission(connection, account);
  return { exists: v.exists, isPrivate: v.isPrivate, members: v.memberKeys };
}

/** Poll a market until `predicate` holds, or throw after `timeoutMs`. */
export async function waitForMarket(
  program: Program,
  market: PublicKey,
  predicate: (m: any) => boolean,
  timeoutMs = 45_000,
  label = "condition"
): Promise<any> {
  const started = Date.now();
  let last: any = null;
  while (Date.now() - started < timeoutMs) {
    try {
      last = await (program.account as any).market.fetch(market);
      if (predicate(last)) return last;
    } catch {
      /* account may be mid-commit */
    }
    await sleep(700);
  }
  throw new Error(
    `timed out waiting for ${label}; last status=${
      last ? statusName(last.status) : "unreadable"
    } outcome=${last ? outcomeName(last.outcome) : "?"}`
  );
}

export { anchor, BN, PublicKey, Keypair, SystemProgram, Connection, LAMPORTS_PER_SOL };
