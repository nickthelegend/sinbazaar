"use client";

/** The persistent furniture: fiction banner, nav, wallet stall. */
import Link from "next/link";
import { usePathname } from "next/navigation";
import dynamic from "next/dynamic";
import { useCallback, useState } from "react";
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useVillageWallet } from "./Providers";
import { CLUSTER, ER_RPC, TEE_RPC, BASE_RPC } from "@/lib/config";
import { shortKey } from "@/lib/format";
import { usePulse } from "@/hooks/usePulse";

const WalletMultiButton = dynamic(
  async () => (await import("@solana/wallet-adapter-react-ui")).WalletMultiButton,
  { ssr: false, loading: () => <span className="muted small">wallet…</span> }
);

const NAV = [
  { href: "/", label: "Village" },
  { href: "/confess", label: "Confess" },
  { href: "/rooms", label: "Rooms" },
  { href: "/graveyard", label: "Graveyard" },
  { href: "/challenge", label: "Challenge" },
];

export function FictionBanner() {
  return (
    <div className="fiction-banner" role="note">
      <span className="fiction-dot" aria-hidden="true" />
      FICTION MODE · STARTUP VILLAGE SINS ONLY
      <span className="fiction-tail">
        every confession here is satire about demos, decks and cofounders
      </span>
    </div>
  );
}

export function TopNav() {
  const pathname = usePathname();
  return (
    <header className="topnav">
      <Link href="/" className="brand">
        <span className="brand-mark">◈</span>
        <span className="brand-name">SINBAZAAR</span>
      </Link>
      <nav className="nav-links">
        {NAV.map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={active ? "nav-link active" : "nav-link"}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
      <WalletStall />
    </header>
  );
}

function WalletStall() {
  const wallet = useVillageWallet();
  const [busy, setBusy] = useState(false);

  const onAirdrop = useCallback(async () => {
    setBusy(true);
    try {
      await wallet.airdrop();
    } catch {
      /* the validator said no; the balance readout tells the story */
    } finally {
      setBusy(false);
    }
  }, [wallet]);

  return (
    <div className="wallet-stall">
      <div className="mode-toggle" role="group" aria-label="wallet mode">
        <button
          type="button"
          className={wallet.mode === "burner" ? "chip on" : "chip"}
          onClick={() => wallet.setMode("burner")}
        >
          burner
        </button>
        <button
          type="button"
          className={wallet.mode === "wallet" ? "chip on" : "chip"}
          onClick={() => wallet.setMode("wallet")}
        >
          wallet
        </button>
      </div>

      {wallet.mode === "wallet" ? (
        <WalletMultiButton />
      ) : (
        <div className="burner-readout">
          <code className="key">{wallet.address ? shortKey(wallet.address, 4) : "…"}</code>
          <span className="balance">
            {(wallet.balance / LAMPORTS_PER_SOL).toFixed(2)} SOL
          </span>
          <button type="button" className="chip" onClick={onAirdrop} disabled={busy}>
            {busy ? "…" : "airdrop"}
          </button>
          <button type="button" className="chip" onClick={wallet.newBurner} title="new burner key">
            new
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * The endpoint footer, with a live pulse.
 *
 * Every page of this product asserts that the market runs on an Ephemeral
 * Rollup. This is where that stops being an assertion: the rollup's slot height
 * arrives by websocket push, and the two round-trip latencies sit next to each
 * other so the difference between the layers is a number the reader watched
 * appear rather than a claim in a paragraph.
 */
export function EndpointFooter() {
  const pulse = usePulse();

  const lat = (p: { ms: number | null; error: boolean }) =>
    p.error ? "unreachable" : p.ms === null ? "…" : `${p.ms} ms`;

  return (
    <footer className="endpoints">
      <div>
        <span className="lbl">base</span>
        <code>{BASE_RPC}</code>
        <code className={pulse.base.error ? "lat bad" : "lat"}>{lat(pulse.base)}</code>
      </div>
      <div>
        <span className="lbl">rollup</span>
        <code>{ER_RPC}</code>
        <code className={pulse.er.error ? "lat bad" : "lat fast"}>{lat(pulse.er)}</code>
      </div>
      <div>
        <span className="lbl">slot</span>
        <code>{pulse.slot === null ? "…" : pulse.slot.toLocaleString()}</code>
        <span className={pulse.live ? "pill live-pill" : "pill"}>
          {pulse.live ? "live" : "polling"}
        </span>
      </div>
      <div>
        <span className="lbl">tee</span>
        <code>{TEE_RPC}</code>
      </div>
      <div>
        <span className="lbl">cluster</span>
        <code>{CLUSTER}</code>
      </div>
    </footer>
  );
}
