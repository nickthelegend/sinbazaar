"use client";

/** The village feed. Live markets, polled off the rollup. */
import Link from "next/link";
import { useMemo, useState } from "react";
import { Empty } from "@/components/Bits";
import { MarketCard } from "@/components/MarketCard";
import { useMarkets } from "@/hooks/useMarkets";
import { LIVE_ROOMS } from "@/lib/rooms";

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
      <section className="page-head">
        <div className="kicker">the village</div>
        <h1>Somebody has something to lose tonight.</h1>
        <p className="pitch">
          The confession stays in a <em>Private Ephemeral Rollup</em>. The market runs in real
          time on an <em>Ephemeral Rollup</em>. <em>MagicBlock VRF</em> picks the reader. Solana
          only receives a <em>tombstone</em>.
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
            No markets standing. <Link href="/confess" className="explorer">Open one</Link> — the
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
    </>
  );
}
