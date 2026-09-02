/**
 * Burner wallet.
 *
 * The demo runs against a local validator, which a browser extension cannot
 * reach. A burner keypair lives in localStorage, gets airdropped on localnet,
 * and signs exactly like a wallet from the flows' point of view. It is a
 * throwaway key for a fictional market, never use it for anything else.
 */
import { Keypair, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import type { VillageSigner } from "./anchor";

const BURNER_KEY = "sinbazaar.burner.v1";
const MODE_KEY = "sinbazaar.wallet-mode.v1";

export type WalletMode = "burner" | "wallet";

const hasStorage = () => typeof window !== "undefined" && !!window.localStorage;

export function loadBurner(): Keypair | null {
  if (!hasStorage()) return null;
  const raw = window.localStorage.getItem(BURNER_KEY);
  if (!raw) return null;
  try {
    return Keypair.fromSecretKey(bs58.decode(raw));
  } catch {
    window.localStorage.removeItem(BURNER_KEY);
    return null;
  }
}

export function createBurner(): Keypair {
  const kp = Keypair.generate();
  if (hasStorage()) window.localStorage.setItem(BURNER_KEY, bs58.encode(kp.secretKey));
  return kp;
}

export function loadOrCreateBurner(): Keypair {
  return loadBurner() ?? createBurner();
}

export function clearBurner(): void {
  if (hasStorage()) window.localStorage.removeItem(BURNER_KEY);
}

export function loadMode(fallback: WalletMode): WalletMode {
  if (!hasStorage()) return fallback;
  const raw = window.localStorage.getItem(MODE_KEY);
  return raw === "burner" || raw === "wallet" ? raw : fallback;
}

export function saveMode(mode: WalletMode): void {
  if (hasStorage()) window.localStorage.setItem(MODE_KEY, mode);
}

export function burnerSigner(keypair: Keypair): VillageSigner {
  return {
    kind: "burner",
    publicKey: keypair.publicKey,
    async signTransaction(tx: Transaction) {
      tx.partialSign(keypair);
      return tx;
    },
    async signMessage(message: Uint8Array) {
      return nacl.sign.detached(message, keypair.secretKey);
    },
  };
}
