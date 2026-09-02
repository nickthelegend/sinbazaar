"use client";

/**
 * Wallet plumbing.
 *
 * Two ways to hold a key:
 *   wallet — @solana/wallet-adapter, for devnet.
 *   burner — a keypair in localStorage, airdropped on localnet. The demo runs
 *            against a local validator, which a browser extension cannot reach,
 *            so this is the default there.
 */
import { Buffer } from "buffer";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ConnectionProvider, WalletProvider, useWallet } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { Keypair, LAMPORTS_PER_SOL, Transaction } from "@solana/web3.js";
import { baseConnection, type VillageSigner } from "@/lib/anchor";
import { BASE_RPC, IS_LOCALNET } from "@/lib/config";
import {
  burnerSigner,
  clearBurner,
  loadBurner,
  loadMode,
  loadOrCreateBurner,
  saveMode,
  type WalletMode,
} from "@/lib/burner";

import "@solana/wallet-adapter-react-ui/styles.css";

// The Anchor browser build reaches for a global Buffer at call time.
if (typeof globalThis !== "undefined") {
  const g = globalThis as unknown as { Buffer?: typeof Buffer };
  if (!g.Buffer) g.Buffer = Buffer;
}

export interface VillageWallet {
  mode: WalletMode;
  setMode: (mode: WalletMode) => void;
  signer: VillageSigner | null;
  address: string | null;
  /** Base-layer lamports held by the signing key itself, not by its purse. */
  balance: number;
  refresh: () => Promise<void>;
  airdrop: () => Promise<void>;
  newBurner: () => void;
  /** False until the burner has been read out of localStorage on the client. */
  ready: boolean;
}

const WalletCtx = createContext<VillageWallet | null>(null);

export function useVillageWallet(): VillageWallet {
  const ctx = useContext(WalletCtx);
  if (!ctx) throw new Error("useVillageWallet outside the provider");
  return ctx;
}

function SignerProvider({ children }: { children: React.ReactNode }) {
  const adapter = useWallet();
  const [mode, setModeState] = useState<WalletMode>(IS_LOCALNET ? "burner" : "wallet");
  const [burner, setBurner] = useState<Keypair | null>(null);
  const [balance, setBalance] = useState(0);
  const [ready, setReady] = useState(false);
  const airdropped = useRef(false);

  useEffect(() => {
    setModeState(loadMode(IS_LOCALNET ? "burner" : "wallet"));
    setBurner(loadBurner() ?? loadOrCreateBurner());
    setReady(true);
  }, []);

  const setMode = useCallback((next: WalletMode) => {
    saveMode(next);
    setModeState(next);
  }, []);

  // Destructured so the memo below keys off the adapter's actual state and not
  // the identity of the context object.
  const { publicKey, signTransaction, signMessage } = adapter;

  const signer = useMemo<VillageSigner | null>(() => {
    if (mode === "burner") return burner ? burnerSigner(burner) : null;
    if (!publicKey || !signTransaction) return null;
    return {
      kind: "wallet",
      publicKey,
      async signTransaction(tx: Transaction) {
        return signTransaction(tx);
      },
      async signMessage(message: Uint8Array) {
        if (!signMessage) {
          throw new Error("this wallet cannot sign messages, so it cannot open the TEE path");
        }
        return signMessage(message);
      },
    };
  }, [mode, burner, publicKey, signTransaction, signMessage]);

  const address = signer?.publicKey.toBase58() ?? null;

  const refresh = useCallback(async () => {
    if (!signer) {
      setBalance(0);
      return;
    }
    try {
      setBalance(await baseConnection().getBalance(signer.publicKey));
    } catch {
      setBalance(0);
    }
  }, [signer]);

  const airdrop = useCallback(async () => {
    if (!signer) return;
    const connection = baseConnection();
    const signature = await connection.requestAirdrop(signer.publicKey, 5 * LAMPORTS_PER_SOL);
    const bh = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature, ...bh }, "confirmed");
    await refresh();
  }, [signer, refresh]);

  const newBurner = useCallback(() => {
    clearBurner();
    setBurner(loadOrCreateBurner());
    airdropped.current = false;
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(id);
  }, [refresh]);

  // Localnet burners start empty and nobody wants to run solana airdrop by hand.
  useEffect(() => {
    if (!IS_LOCALNET || mode !== "burner" || !signer || airdropped.current) return;
    if (balance >= LAMPORTS_PER_SOL) return;
    airdropped.current = true;
    void airdrop().catch(() => {
      airdropped.current = false;
    });
  }, [balance, mode, signer, airdrop]);

  const value = useMemo<VillageWallet>(
    () => ({ mode, setMode, signer, address, balance, refresh, airdrop, newBurner, ready }),
    [mode, setMode, signer, address, balance, refresh, airdrop, newBurner, ready]
  );

  return <WalletCtx.Provider value={value}>{children}</WalletCtx.Provider>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  // Phantom, Solflare and friends register themselves through the Wallet
  // Standard, so the adapter list stays empty and still finds them.
  const wallets = useMemo(() => [], []);

  return (
    <ConnectionProvider endpoint={BASE_RPC}>
      <WalletProvider wallets={wallets} autoConnect={!IS_LOCALNET}>
        <WalletModalProvider>
          <SignerProvider>{children}</SignerProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
