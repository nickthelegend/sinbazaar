"use client";

/** The village feed. Live markets, polled off the rollup. */
import Link from "next/link";
import { useMemo, useState } from "react";
import { Empty } from "@/components/Bits";
import { MarketCard } from "@/components/MarketCard";
import { useMarkets } from "@/hooks/useMarkets";
import { LIVE_ROOMS } from "@/lib/rooms";
import { CLUSTER, PROGRAM_ID } from "@/lib/config";

type Filter = "all" | "open" | "settled" | string;

export default function VillageFeed() {
  const { data: markets, loading, error, reload } = useMarkets();
  const [filter, setFilter] = useState<Filter>("all");

  const shown = useMemo(() => {
    if (filter === "all") return markets;
    if (filter === "open") return markets.filter((m) => m.status === "open");
    if (filter === "settled")
      return markets.filter((m) => m.status === "settled" || m.status === "resolved");
    return markets.filter((m) => m.roomVariant === filter);
  }, [markets, filter]);

  const openCount = markets.filter((m) => m.status === "open").length;

  return (
    <>
      <section className="hero">
        <p className="eyebrow">
          <b>{openCount} open</b> right now, decided by MagicBlock VRF
        </p>

        {/* One word carries the aurora. The rest of the line stays white. */}
        <h1>
          Somebody has something to <span className="flare">lose</span> tonight.
        </h1>

        <p className="hero-sub">
          The confession stays in a Private Ephemeral Rollup. The market runs in real time on an
          Ephemeral Rollup. VRF picks the reader. Solana only ever receives a tombstone.
        </p>

        <div className="actions" style={{ justifyContent: "center" }}>
          <Link href="/confess" className="keycap">
            <PenGlyph />
            Write a confession
          </Link>
          <Link href="/challenge" className="keycap">
            <LockGlyph />
            Try to read one
          </Link>
        </div>

        <p className="install-caption">
          {PROGRAM_ID.toBase58().slice(0, 8)}...{PROGRAM_ID.toBase58().slice(-6)} on {CLUSTER}
        </p>
      </section>

      <div className="actions" style={{ marginBottom: 18 }}>
        <button
          type="button"
          className={filter === "all" ? "chip on" : "chip"}
          onClick={() => setFilter("all")}
        >
          all {markets.length}
        </button>
        <button
          type="button"
          className={filter === "open" ? "chip on" : "chip"}
          onClick={() => setFilter("open")}
        >
          open {openCount}
        </button>
        <button
          type="button"
          className={filter === "settled" ? "chip on" : "chip"}
          onClick={() => setFilter("settled")}
        >
          decided
        </button>
        {LIVE_ROOMS.map((room) => (
          <button
            key={room.variant}
            type="button"
            className={filter === room.variant ? "chip on" : "chip"}
            onClick={() => setFilter(room.variant)}
          >
            {room.label}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button type="button" className="chip" onClick={() => void reload()}>
          refresh
        </button>
        <Link href="/confess" className="chip">
          confess
        </Link>
      </div>

      {error ? <div className="err">feed: {error}</div> : null}

      {shown.length === 0 ? (
        loading ? (
          <Empty>reading the stalls…</Empty>
        ) : (
          <Empty>
            No markets standing. <Link href="/confess" className="explorer">Open one</Link>, the
            village is only interesting when somebody has something to lose.
          </Empty>
        )
      ) : (
        <div className="grid">
          {shown.map((market) => (
            <MarketCard key={market.address} market={market} />
          ))}
        </div>
      )}
      <div style={{ display: "flex", justifyContent: "center", marginTop: 34 }}>
        <Link href="/rooms" className="ghost">
          Twenty-five ways to lose a secret
          <span aria-hidden="true">-&gt;</span>
        </Link>
      </div>
    </>
  );
}

function PenGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M11.2 2.3a1.6 1.6 0 0 1 2.3 2.3l-7.4 7.4-3 .7.7-3 7.4-7.4Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LockGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="1.6" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.6 7V5.2a2.4 2.4 0 0 1 4.8 0V7" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}
