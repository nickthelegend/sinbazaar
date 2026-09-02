"use client";

/**
 * Session keys.
 *
 * A villager approves once with their wallet and opens a session scoped to one
 * market, one spend ceiling and one expiry. Every bid after that is signed by a
 * throwaway keypair living in this browser, no wallet popup, no base-layer
 * transaction, and nothing the key can do beyond the scope it was granted.
 *
 * The scope is enforced by the program, not by this file: `place_bid_with_session`
 * checks the session's market, its ceiling and its expiry, and `open_session`
 * binds the key to exactly one market. A leaked session key can bid up to the
 * ceiling on that one market and nothing else, it cannot withdraw the purse,
 * cannot reach another market, and dies on its own.
 *
 * That is why the key is allowed to sit in localStorage. It is not a wallet.
 */
import { BN } from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram } from "@solana/web3.js";
import bs58 from "bs58";
import {
  baseConnection,
  erConnection,
  methodsOf,
  programFor,
  sendIxs,
  type VillageSigner,
} from "./anchor";
import { bidPda, pursePda, sessionPda } from "./pdas";
import { permissionPdaFromAccount } from "./magicblock";
import { rememberBidder } from "./registry";
import type { SideName } from "./rooms";
import { sideArg } from "./rooms";

const KEY = "sinbazaar.sessions.v1";

/** Enough to pay ER fees for a long demo, and trivial to abandon. */
export const SESSION_FUEL = 0.02 * LAMPORTS_PER_SOL;

interface StoredSession {
  secretKey: string;
  market: string;
  maxSpend: number;
  expiresAt: number;
}

function all(): Record<string, StoredSession> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

function persist(map: Record<string, StoredSession>) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* private browsing; the session simply will not survive a reload */
  }
}

export interface SessionView {
  keypair: Keypair;
  publicKey: string;
  market: string;
  maxSpend: number;
  expiresAt: number;
}

export function loadSession(market: string): SessionView | null {
  const row = all()[market];
  if (!row) return null;
  if (row.expiresAt * 1000 < Date.now()) return null;
  try {
    const keypair = Keypair.fromSecretKey(bs58.decode(row.secretKey));
    return {
      keypair,
      publicKey: keypair.publicKey.toBase58(),
      market: row.market,
      maxSpend: row.maxSpend,
      expiresAt: row.expiresAt,
    };
  } catch {
    return null;
  }
}

export function forgetSession(market: string) {
  const map = all();
  delete map[market];
  persist(map);
}

/**
 * One wallet approval: fund a fresh key and grant it a scope on the rollup.
 *
 * The transfer is a real base-layer transaction, the session key has to be able
 * to pay its own ER fees, because it is the fee payer on every bid it signs.
 */
export async function openSession(
  signer: VillageSigner,
  market: PublicKey,
  marketId: BN,
  ttlSecs: number,
  maxSpendLamports: number
): Promise<SessionView> {
  const keypair = Keypair.generate();
  const base = baseConnection();
  const er = erConnection();

  await sendIxs(
    base,
    [
      SystemProgram.transfer({
        fromPubkey: signer.publicKey,
        toPubkey: keypair.publicKey,
        lamports: SESSION_FUEL,
      }),
    ],
    signer
  );

  const pEr = programFor(er, signer.publicKey);
  const ix = await methodsOf(pEr)
    .openSession(marketId, new BN(ttlSecs), new BN(maxSpendLamports), keypair.publicKey)
    .accountsPartial({
      owner: signer.publicKey,
      market,
      session: sessionPda(market, signer.publicKey),
    })
    .instruction();
  await sendIxs(er, [ix], signer);

  const view: SessionView = {
    keypair,
    publicKey: keypair.publicKey.toBase58(),
    market: market.toBase58(),
    maxSpend: maxSpendLamports,
    expiresAt: Math.floor(Date.now() / 1000) + ttlSecs,
  };
  const map = all();
  map[view.market] = {
    secretKey: bs58.encode(keypair.secretKey),
    market: view.market,
    maxSpend: view.maxSpend,
    expiresAt: view.expiresAt,
  };
  persist(map);
  return view;
}

/** A bid the wallet never sees. */
export async function bidWithSession(
  session: SessionView,
  bidder: PublicKey,
  market: PublicKey,
  marketId: BN,
  side: SideName,
  amount: BN
): Promise<string> {
  const er = erConnection();
  // A session key is a burner by construction: it exists only in this browser,
  // it can only reach one market, and it dies at its expiry.
  const sessionSigner: VillageSigner = {
    kind: "burner",
    publicKey: session.keypair.publicKey,
    signTransaction: async (tx) => {
      tx.partialSign(session.keypair);
      return tx;
    },
    // A session key never authenticates to the TEE. It signs rollup
    // transactions and nothing else; reading a secret is the wallet's job.
    signMessage: async () => {
      throw new Error("a session key cannot authenticate to the private rollup");
    },
  };
  const pEr = programFor(er, session.keypair.publicKey);
  const bid = bidPda(market, bidder);
  const purse = pursePda(bidder);

  const bidIx = await methodsOf(pEr)
    .placeBidWithSession(marketId, sideArg(side), amount)
    .accountsPartial({
      signer: session.keypair.publicKey,
      bidder,
      market,
      bid,
      purse,
      session: sessionPda(market, bidder),
    })
    .instruction();
  const fundIx = await methodsOf(pEr)
    .fundBid(marketId)
    .accountsPartial({ signer: session.keypair.publicKey, market, bid, purse })
    .instruction();
  const signature = await sendIxs(er, [bidIx, fundIx], sessionSigner);

  const permIx = await methodsOf(pEr)
    .initBidPermission(marketId)
    .accountsPartial({
      payer: session.keypair.publicKey,
      market,
      bid,
      bidPermission: permissionPdaFromAccount(bid),
    })
    .instruction();
  await sendIxs(er, [permIx], sessionSigner);

  rememberBidder(market.toBase58(), bidder.toBase58());
  return signature;
}

export async function revokeSession(
  signer: VillageSigner,
  market: PublicKey,
  marketId: BN
): Promise<void> {
  const er = erConnection();
  const pEr = programFor(er, signer.publicKey);
  const ix = await methodsOf(pEr)
    .revokeSession(marketId)
    .accountsPartial({
      owner: signer.publicKey,
      market,
      session: sessionPda(market, signer.publicKey),
    })
    .instruction();
  await sendIxs(er, [ix], signer);
  forgetSession(market.toBase58());
}
