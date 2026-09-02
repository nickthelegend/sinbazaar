/**
 * The handful of MagicBlock values and calls the browser needs.
 *
 * These mirror `@magicblock-labs/ephemeral-rollups-sdk` exactly, same program
 * ids, same `permission:` PDA, same two-step `/auth/challenge` + `/auth/login`
 * handshake. They are restated here rather than imported because the SDK's entry
 * point re-exports its TEE quote verifier, which pulls a wasm module into the
 * browser bundle that this app never calls.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { defaultWsUrl, TEE_RPC } from "./config";

export const DELEGATION_PROGRAM_ID = new PublicKey(
  "DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh"
);
export const MAGIC_PROGRAM_ID = new PublicKey("Magic11111111111111111111111111111111111111");
export const MAGIC_CONTEXT_ID = new PublicKey("MagicContext1111111111111111111111111111111");
export const PERMISSION_PROGRAM_ID = new PublicKey(
  "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1"
);
export const EPHEMERAL_VAULT_ID = new PublicKey("MagicVau1t999999999999999999999999999999999");

export const PERMISSION_SEED = Buffer.from("permission:");

export function permissionPdaFromAccount(account: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [PERMISSION_SEED, account.toBuffer()],
    PERMISSION_PROGRAM_ID
  )[0];
}

/**
 * Ask the validator for a JWT.
 *
 * Any keypair can obtain one. What the token buys is the *identity* the
 * validator checks against each account's permission member list, which is why
 * a token for the wrong key opens nothing.
 */
export async function getAuthToken(
  rpcUrl: string,
  publicKey: PublicKey,
  signMessage: (message: Uint8Array) => Promise<Uint8Array>
): Promise<{ token: string; expiresAt: number }> {
  const params = new URLSearchParams({ pubkey: publicKey.toBase58() });
  const challengeResponse = await fetch(`${rpcUrl}/auth/challenge?${params.toString()}`);
  const { challenge, error } = await challengeResponse.json();
  if (typeof error === "string" && error.length > 0) {
    throw new Error(`failed to get challenge: ${error}`);
  }
  if (typeof challenge !== "string" || challenge.length === 0) {
    throw new Error("no challenge received");
  }

  const signature = await signMessage(new TextEncoder().encode(challenge));
  const authResponse = await fetch(`${rpcUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pubkey: publicKey.toBase58(),
      challenge,
      signature: bs58.encode(signature),
    }),
  });
  const authJson = await authResponse.json();
  if (authResponse.status !== 200) {
    throw new Error(`failed to authenticate: ${authJson.error}`);
  }
  if (typeof authJson.token !== "string" || authJson.token.length === 0) {
    throw new Error("no token received");
  }
  return {
    token: authJson.token,
    expiresAt: authJson.expiresAt ?? Date.now() + 1000 * 60 * 60 * 24 * 30,
  };
}

/**
 * An authenticated read connection to the private rollup.
 *
 * The token travels as a `?token=` query parameter on BOTH the http and the ws
 * URL. It is never a header.
 */
export async function teeConnection(
  publicKey: PublicKey,
  signMessage: (message: Uint8Array) => Promise<Uint8Array>,
  url: string = TEE_RPC
): Promise<{ connection: Connection; token: string }> {
  const { token } = await getAuthToken(url, publicKey, signMessage);
  const connection = new Connection(`${url}?token=${token}`, {
    commitment: "confirmed",
    wsEndpoint: `${defaultWsUrl(url)}?token=${token}`,
  });
  return { connection, token };
}

export interface PermissionView {
  exists: boolean;
  /** The flag that decides whether an unauthorised RPC read is answered at all. */
  isPrivate: boolean;
  memberKeys: string[];
}

/**
 * Read an account's ephemeral permission.
 *
 * Parsed by hand against the live on-chain layout, the same way the SDK client
 * in sdk/src/index.ts does it:
 *   [0]      discriminator
 *   [1]      bump
 *   [2..34)  permissioned account
 *   [34]     is_private
 *   [35..]   members, 33 bytes each: flags(1) || pubkey(32)
 */
export async function readPermission(
  connection: Connection,
  account: PublicKey,
  programId: PublicKey
): Promise<PermissionView> {
  const info = await connection.getAccountInfo(permissionPdaFromAccount(account));
  if (!info) return { exists: false, isPrivate: false, memberKeys: [] };
  const d = info.data;
  const memberKeys: string[] = [];
  for (let off = 35; off + 33 <= d.length; off += 33) {
    const pubkey = new PublicKey(d.subarray(off + 1, off + 33)).toBase58();
    if (pubkey === programId.toBase58()) continue; // added by the permission program
    memberKeys.push(pubkey);
  }
  return { exists: true, isPrivate: d[34] === 1, memberKeys };
}
