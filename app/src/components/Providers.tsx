"use client";

/**
 * Wallet plumbing.
 *
 * Two ways to hold a key:
 *   wallet, @solana/wallet-adapter, for devnet.
 *   burner, a keypair in localStorage, airdropped on localnet. The demo runs
 *            against a local validator, which a browser extension cannot reach,
 *            so this is the default there.
 */
import { useBackoffPoll } from "@/hooks/useBackoffPoll";
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

import "@/styles/wallet-adapter.css";

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
  /** null when the base layer did not answer. Zero is a balance; null is not. */
  balance: number | null;
  /** Resolves to whether the base layer answered. */
  refresh: () => Promise<boolean>;
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
  const [balance, setBalance] = useState<number | null>(0);
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

  /**
   * Returns whether the base layer answered.
   *
   * It used to swallow the failure and set the balance to zero, which told the
   * villager they had no SOL when the truth was that nothing had been asked
   * successfully. It also meant every caller believed the poll had succeeded, so
   * the backoff never engaged and a dead validator was polled forever.
   */
  const refresh = useCallback(async (): Promise<boolean> => {
    if (!signer) {
      setBalance(0);
      return true;
    }
    try {
      setBalance(await baseConnection().getBalance(signer.publicKey));
      return true;
    } catch {
      setBalance(null);
      return false;
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

  /**
   * Forget the balance the instant the key changes.
   *
   * Without this the readout kept showing the previous key's balance until the
   * next poll, up to ten seconds later: press `new` on a burner holding 34.94
   * SOL and the fresh, empty key advertises 34.94 SOL. It is the same mistake
   * this project keeps meeting, an unknown rendered as a value, and here it is
   * a number about somebody else's account. `null` renders as "balance
   * unknown", which is exactly what it is until the chain answers.
   *
   * Keyed on the address rather than the signer object so a re-render that
   * merely rebuilds the signer does not blank a balance that is still correct.
   */
  const addressRef = useRef<string | null>(null);
  const currentAddress = signer?.publicKey.toBase58() ?? null;
  useEffect(() => {
    if (addressRef.current !== currentAddress) {
      addressRef.current = currentAddress;
      setBalance(null);
    }
  }, [currentAddress]);

  // Backs off while the base layer is unreachable. This provider is mounted on
  // every route, so a fixed retry here is the loudest poller in the app.
  useBackoffPoll(refresh, 10_000);

  // Localnet burners start empty and nobody wants to run solana airdrop by hand.
  useEffect(() => {
    if (!IS_LOCALNET || mode !== "burner" || !signer || airdropped.current) return;
    if (balance === null || balance >= LAMPORTS_PER_SOL) return;
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
